#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Chibalete+ — Rollback Drill
# Sprint 022 / Fase 2B.8
#
# OBJETIVO:
#   Demostrar que el rollback de código funciona realmente sobre el VPS,
#   sin esperar a un incidente real. Es la versión "ensayo controlado"
#   de rollback_code() de deploy-backend.sh.
#
# DOS MODOS:
#
#   1. Discovery (DEFAULT, sin --execute):
#      - Describe lo que pasaría
#      - Capta el estado actual
#      - Imprime los comandos exactos
#      - NO toca nada
#
#   2. Execute (con --execute):
#      - Confirma con el operador en cada fase
#      - Ejecuta el rollback paso a paso
#      - Verifica el resultado
#      - Registra el drill en /root/deploys.log
#
# FILOSOFÍA:
#   - JAMÁS toca data/, data-critical/, ni uploads/
#   - JAMÁS hace docker compose down
#   - SIEMPRE restart staggered (api_1 → validate → api_2)
#   - SIEMPRE preserva el server.failed-* para forensics
#   - Pide confirmación entre fases
#
# PRECONDICIONES:
#   - Existe al menos un /var/www/chibalete/server.old-<TS> en el VPS
#   - El operador acaba de hacer un smoke deploy y quiere validar el rollback
#   - ADMIN_SECRET disponible en env o .env
#
# Uso:
#   bash scripts/rollback-drill.sh                    # discovery
#   bash scripts/rollback-drill.sh --execute          # ejecuta paso a paso
#   bash scripts/rollback-drill.sh --execute --yes    # ejecuta sin prompts
#                                                       (CI; use con cuidado)
#
# Exit codes:
#   0  → drill OK (discovery o execute)
#   1  → precondiciones fallidas
#   2  → operador canceló mid-drill
#   3  → rollback falló (estado del VPS posiblemente degradado)
#   11 → otro deploy en curso (lock activo)
# ─────────────────────────────────────────────────────────────────────

set -Eeuo pipefail

# ── Config ────────────────────────────────────────────────────────────
VPS_HOST="${VPS_HOST:-root@72.60.158.97}"
PUBLIC_URL="${PUBLIC_URL:-https://chibaleteplus.chibaleteeditores.com}"
REMOTE_BASE="${REMOTE_BASE:-/var/www/chibalete}"
REMOTE_DEPLOY_LOG="${REMOTE_DEPLOY_LOG:-/root/deploys.log}"
REMOTE_LOCK_DIR="${REMOTE_LOCK_DIR:-/var/run/chib-deploy.lock}"
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-30}"
HEALTH_POLL_INT_S="${HEALTH_POLL_INT_S:-1}"

SSH_OPTS=(
    -o "ConnectTimeout=15"
    -o "ServerAliveInterval=15"
    -o "ServerAliveCountMax=3"
    -o "BatchMode=yes"
)

# ── Args ──────────────────────────────────────────────────────────────
EXECUTE=0
ASSUME_YES=0
ACTOR=""

while [ $# -gt 0 ]; do
    case "$1" in
        --execute) EXECUTE=1; shift ;;
        --yes|-y)  ASSUME_YES=1; shift ;;
        --actor)   ACTOR="$2"; shift 2 ;;
        -h|--help)
            cat <<EOF
Uso: bash scripts/rollback-drill.sh [opciones]

DEFAULT (sin --execute): modo discovery — describe qué pasaría, NO toca nada.

OPCIONES:
  --execute      Ejecuta el rollback paso a paso, con confirmación
  --yes, -y      Salta confirmaciones intermedias (sólo CI; cuidado)
  --actor <X>    Identifica al operador en deploys.log
  -h, --help     Esta ayuda

REGLA:
  Este drill SIEMPRE se ejecuta DESPUÉS de un smoke deploy exitoso, NUNCA
  durante un deploy en progreso, NUNCA en horario de tráfico productivo
  alto sin coordinación previa.

EJEMPLO:
  bash scripts/deploy-smoke-release.sh                     # 1. preparar smoke
  bash scripts/deploy-backend.sh --release-tag <TAG>       # 2. desplegar
  bash scripts/rollback-drill.sh                           # 3. discovery
  bash scripts/rollback-drill.sh --execute                 # 4. drill real
EOF
            exit 0
            ;;
        *) echo "Argumento desconocido: $1" >&2; exit 1 ;;
    esac
done

[ -z "$ACTOR" ] && ACTOR="$(git config user.email 2>/dev/null || echo unknown)"

# ── Helpers ───────────────────────────────────────────────────────────
ts_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log()  { echo "[$(ts_now)] [INFO]  $*"; }
warn() { echo "[$(ts_now)] [WARN]  $*"; }
err()  { echo "[$(ts_now)] [ERROR] $*" >&2; }
ok()   { echo "[$(ts_now)] [OK]    $*"; }
phase(){ echo ""; echo "═════ $* ═════"; }

ssh_run() { ssh "${SSH_OPTS[@]}" "$VPS_HOST" "$@"; }

confirm() {
    [ "$ASSUME_YES" = "1" ] && return 0
    local prompt="${1:-¿Continuar? [y/N]}"
    echo -n "$prompt "
    read -r answer
    case "$answer" in
        y|Y|yes|YES) return 0 ;;
        *) err "operador canceló el drill"; exit 2 ;;
    esac
}

# HTTP GET intra-container vía Node — la imagen `chibalete/api` no incluye
# `curl`. Imprime body en stdout y exit 0 si HTTP 200; vacío + exit !=0 si
# fail. Mismo helper que en deploy-backend.sh (duplicado para evitar source).
docker_node_health() {
    local container="$1"
    ssh_run "docker exec -i '$container' node" <<'NODE'
const http = require("http");
const req = http.get({host:"localhost",port:3000,path:"/api/health",timeout:5000}, r => {
  let d = "";
  r.on("data", c => d += c);
  r.on("end", () => {
    if (r.statusCode !== 200) process.exit(1);
    process.stdout.write(d);
    process.exit(0);
  });
});
req.on("timeout", () => { req.destroy(); process.exit(4); });
req.on("error", () => process.exit(3));
NODE
}

# Espera health ok dentro de un container.
poll_health() {
    local container="$1"
    local timeout="${2:-$HEALTH_TIMEOUT_S}"
    local elapsed=0
    while [ "$elapsed" -lt "$timeout" ]; do
        local resp
        resp=$(docker_node_health "$container" 2>/dev/null || echo "")
        if [ -n "$resp" ] && echo "$resp" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
            log "  ✓ $container healthy (${elapsed}s)"
            return 0
        fi
        sleep "$HEALTH_POLL_INT_S"
        elapsed=$((elapsed + HEALTH_POLL_INT_S))
    done
    err "  ✗ $container NO healthy en ${timeout}s"
    return 1
}

# Carga ADMIN_SECRET de .env si no está en env (compartido con deploy-backend.sh)
load_secrets() {
    if [ -z "${ADMIN_SECRET:-}" ] && [ -f .env ]; then
        local val
        val=$(grep -E '^ADMIN_SECRET=' .env | head -1 | sed 's/^ADMIN_SECRET=//' | sed 's/^["'"'"']//;s/["'"'"']$//')
        [ -n "$val" ] && export ADMIN_SECRET="$val"
    fi
}
load_secrets

# Validate edge sin leakear secret a argv
validate_edge() {
    if [ -z "${ADMIN_SECRET:-}" ]; then
        warn "ADMIN_SECRET no disponible — saltando validate (informativo)"
        return 0
    fi
    local resp
    resp=$(curl -sS --max-time 30 \
        --config <(printf 'header = "x-admin-secret: %s"\n' "$ADMIN_SECRET") \
        "$PUBLIC_URL/api/admin/membership/validate" 2>&1) || {
            err "  curl validate edge FALLÓ: $resp"
            return 1
        }
    if echo "$resp" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true'; then
        log "  ✓ validate edge ok=true"
        return 0
    else
        err "  ✗ validate edge ok=false"
        echo "$resp" | sed "s|${ADMIN_SECRET}|<REDACTED>|g" | head -50 >&2
        return 1
    fi
}

# ─────────────────────────────────────────────────────────────────────
# FASE D0 — Discovery: capturar estado actual del VPS
# ─────────────────────────────────────────────────────────────────────
phase "D0 — Discovery (estado actual)"

# Sanity: ssh funciona
if ! ssh_run "echo OK" >/dev/null 2>&1; then
    err "ssh a $VPS_HOST falla. Verificar conectividad."
    exit 1
fi
log "  ✓ ssh $VPS_HOST OK"

# Sanity: no hay otro deploy en curso
if ssh_run "test -d '$REMOTE_LOCK_DIR'"; then
    err "lock $REMOTE_LOCK_DIR EXISTE — otro deploy/drill en curso."
    err "  Owner:"
    ssh_run "cat '$REMOTE_LOCK_DIR/owner.txt' 2>/dev/null" | sed 's/^/    /' >&2
    err "Si seguro que es residual:  ssh $VPS_HOST \"rm -rf '$REMOTE_LOCK_DIR'\""
    exit 11
fi
log "  ✓ no hay lock activo"

# Capturar /api/health actual
log "  → capturando /api/health actual"
HEALTH_PRE=$(curl -sS --max-time 10 "$PUBLIC_URL/api/health" 2>/dev/null || echo "")
COMMIT_PRE=$(echo "$HEALTH_PRE" | grep -oE '"commit"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"commit"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
VERSION_PRE=$(echo "$HEALTH_PRE" | grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
DEPLOYED_AT_PRE=$(echo "$HEALTH_PRE" | grep -oE '"deployed_at"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"deployed_at"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
log "    commit pre-rollback   = $COMMIT_PRE"
log "    version pre-rollback  = $VERSION_PRE"
log "    deployed_at pre-rb    = $DEPLOYED_AT_PRE"

# Listar server.old-* disponibles (rollback candidates)
log "  → listando server.old-* disponibles para rollback"
SERVER_OLD_LIST=$(ssh_run "ls -1dt $REMOTE_BASE/server.old-* 2>/dev/null" || echo "")
if [ -z "$SERVER_OLD_LIST" ]; then
    err "NO hay server.old-* en $REMOTE_BASE — rollback imposible automáticamente."
    err "Recovery alternativo:"
    err "  - extraer desde backup tar: ssh $VPS_HOST \"tar -xzf /root/backups/chibalete/<TS>/server.tar.gz -C /tmp/restore/\""
    err "  - o checkout previo de git en /var/www/chibalete/server"
    exit 1
fi
echo "$SERVER_OLD_LIST" | sed 's/^/      /'

ROLLBACK_TARGET=$(echo "$SERVER_OLD_LIST" | head -1)
ROLLBACK_TS=$(basename "$ROLLBACK_TARGET" | sed 's/^server\.old-//')
log "  → target del rollback (más reciente): $ROLLBACK_TARGET"
log "    TS       = $ROLLBACK_TS"

# Verificar contenido razonable del rollback target
ROLLBACK_SERVER_JS_SIZE=$(ssh_run "stat -c%s '$ROLLBACK_TARGET/server.js' 2>/dev/null || echo 0")
if [ "$ROLLBACK_SERVER_JS_SIZE" -lt 50000 ]; then
    err "rollback target $ROLLBACK_TARGET no parece sano:"
    err "  server.js size = $ROLLBACK_SERVER_JS_SIZE bytes (esperado > 50KB)"
    err "Inspeccionar manualmente antes de continuar."
    exit 1
fi
log "  ✓ rollback target tiene server.js de $ROLLBACK_SERVER_JS_SIZE bytes (sano)"

# Capturar metadata del rollback target (.deploy-info anterior)
ROLLBACK_DEPLOY_INFO=$(ssh_run "cat '$ROLLBACK_TARGET/.deploy-info' 2>/dev/null" || echo "(.deploy-info ausente — deploy pre-Sprint-2B.7)")
log "  → .deploy-info del target del rollback:"
echo "$ROLLBACK_DEPLOY_INFO" | sed 's/^/      /'

# Capturar baseline de validate
log "  → capturando baseline validate"
if validate_edge; then
    BASELINE_OK=true
else
    warn "  validate edge devolvió ok=false ANTES del drill. Inusual — investigar."
    BASELINE_OK=false
fi

# ─────────────────────────────────────────────────────────────────────
# FASE D1 — Plan
# ─────────────────────────────────────────────────────────────────────
phase "D1 — Plan del rollback drill"

cat <<EOF

Estado actual:
  commit live      = $COMMIT_PRE
  version live     = $VERSION_PRE
  deployed_at      = $DEPLOYED_AT_PRE

Rollback target:
  server.old-*     = $ROLLBACK_TARGET
  TS               = $ROLLBACK_TS

Acciones que $([ "$EXECUTE" = "1" ] && echo "VAN A EJECUTARSE" || echo "se ejecutarían") (en orden):

  1. mv $REMOTE_BASE/server  →  $REMOTE_BASE/server.failed-drill-$(date -u +%Y-%m-%d-%H%M%S)
     (preserva el código actual como evidencia)

  2. mv $ROLLBACK_TARGET  →  $REMOTE_BASE/server
     (restaura el código previo)

  3. test -s $REMOTE_BASE/server/server.js
     (verifica swap exitoso)

  4. docker stop chibalete_api_1 --time=30
     docker start chibalete_api_1
     poll /api/health en api_1 (max ${HEALTH_TIMEOUT_S}s)

  5. docker stop chibalete_api_2 --time=30
     docker start chibalete_api_2
     poll /api/health en api_2 (max ${HEALTH_TIMEOUT_S}s)

  6. curl /api/health vía edge (verificar commit cambió)
     curl /api/admin/membership/validate (verificar ok=true)

  7. echo entry en $REMOTE_DEPLOY_LOG: 'DRILL ROLLBACK ...'

GARANTÍAS:
  - JAMÁS toca data/, data-critical/, uploads/
  - Restart staggered REAL (api_1 → poll → api_2)
  - server.failed-drill-* preserva el código actual
  - Si algo falla → exit 3, server.failed-drill-* preservado

EOF

if [ "$EXECUTE" != "1" ]; then
    log ""
    log "Modo DISCOVERY — nada se ejecutó."
    log "Para ejecutar el drill: bash scripts/rollback-drill.sh --execute"
    exit 0
fi

# ─────────────────────────────────────────────────────────────────────
# FASE D2 — Confirmación final
# ─────────────────────────────────────────────────────────────────────
phase "D2 — Confirmación final"

if [ "$BASELINE_OK" != "true" ]; then
    warn "Baseline validate ya estaba ok=false ANTES del drill."
    warn "El drill se ejecutará igualmente, pero la verificación post"
    warn "no podrá distinguir 'rollback OK' de 'estado pre-existente'."
fi

confirm "¿Confirmas ejecutar el rollback drill ahora? [y/N]"

# ─────────────────────────────────────────────────────────────────────
# FASE D3 — Snapshot del código actual (forensics)
# ─────────────────────────────────────────────────────────────────────
phase "D3 — Snapshot código actual → server.failed-drill-*"

DRILL_TS=$(date -u +%Y-%m-%dT%H-%M-%SZ)
FAILED_NAME="server.failed-drill-$DRILL_TS"

log "  → mv $REMOTE_BASE/server  →  $REMOTE_BASE/$FAILED_NAME"
if ! ssh_run "mv '$REMOTE_BASE/server' '$REMOTE_BASE/$FAILED_NAME'"; then
    err "mv falló — abortando drill ANTES del rollback (estado actual intacto)"
    exit 3
fi
log "  ✓ snapshot creado: $REMOTE_BASE/$FAILED_NAME"

# ─────────────────────────────────────────────────────────────────────
# FASE D4 — Restaurar código previo
# ─────────────────────────────────────────────────────────────────────
phase "D4 — Restaurar código previo"

log "  → mv $ROLLBACK_TARGET  →  $REMOTE_BASE/server"
if ! ssh_run "mv '$ROLLBACK_TARGET' '$REMOTE_BASE/server'"; then
    err "mv falló — INTENTAR RECOVERY MANUAL:"
    err "  ssh $VPS_HOST \"mv '$REMOTE_BASE/$FAILED_NAME' '$REMOTE_BASE/server'\""
    exit 3
fi

# Sanity post-swap
if ! ssh_run "test -s '$REMOTE_BASE/server/server.js'"; then
    err "🔴 server.js missing post-swap — RECOVERY MANUAL OBLIGATORIO:"
    err "  ssh $VPS_HOST \"ls -la $REMOTE_BASE/\""
    err "  ssh $VPS_HOST \"mv '$REMOTE_BASE/$FAILED_NAME' '$REMOTE_BASE/server'\""
    exit 3
fi
log "  ✓ server/ restaurado (server.js presente)"

# ─────────────────────────────────────────────────────────────────────
# FASE D5 — Restart staggered api_1
# ─────────────────────────────────────────────────────────────────────
phase "D5 — Restart staggered api_1"

confirm "¿Continuar con docker stop/start chibalete_api_1? [y/N]"

log "  → docker stop chibalete_api_1 --time=30"
ssh_run "docker stop chibalete_api_1 --time=30 >/dev/null"
log "  → docker start chibalete_api_1"
ssh_run "docker start chibalete_api_1 >/dev/null"

if ! poll_health chibalete_api_1; then
    err "🔴 api_1 NO healthy con código rolled-back. ESCALAR."
    err "  Inspeccionar:  ssh $VPS_HOST \"docker logs --tail 100 chibalete_api_1\""
    exit 3
fi

# ─────────────────────────────────────────────────────────────────────
# FASE D6 — Restart staggered api_2
# ─────────────────────────────────────────────────────────────────────
phase "D6 — Restart staggered api_2"

confirm "¿api_1 OK. Continuar con api_2? [y/N]"

log "  → docker stop chibalete_api_2 --time=30"
ssh_run "docker stop chibalete_api_2 --time=30 >/dev/null"
log "  → docker start chibalete_api_2"
ssh_run "docker start chibalete_api_2 >/dev/null"

if ! poll_health chibalete_api_2; then
    err "🔴 api_2 NO healthy con código rolled-back."
    err "  api_1 sí healthy → tráfico funciona pero degradado."
    err "  Inspeccionar:  ssh $VPS_HOST \"docker logs --tail 100 chibalete_api_2\""
    exit 3
fi

# ─────────────────────────────────────────────────────────────────────
# FASE D7 — Validación post-rollback
# ─────────────────────────────────────────────────────────────────────
phase "D7 — Validación post-rollback"

# Health vía edge
HEALTH_POST=$(curl -sS --max-time 10 "$PUBLIC_URL/api/health" 2>/dev/null || echo "")
COMMIT_POST=$(echo "$HEALTH_POST" | grep -oE '"commit"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"commit"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')
VERSION_POST=$(echo "$HEALTH_POST" | grep -oE '"version"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 | sed -E 's/.*"version"[[:space:]]*:[[:space:]]*"([^"]*)".*/\1/')

log "  Health POST-rollback:"
log "    commit   = $COMMIT_POST   (pre era $COMMIT_PRE)"
log "    version  = $VERSION_POST  (pre era $VERSION_PRE)"

if [ "$COMMIT_POST" = "$COMMIT_PRE" ]; then
    warn "  ⚠ commit NO cambió — ¿el rollback realmente afectó algo?"
    warn "    Posibles causas:"
    warn "    - el smoke release no había cambiado /api/health.commit"
    warn "    - .deploy-info del rollback target tenía mismo SHA"
else
    ok "  ✓ commit cambió: rollback se reflejó en /api/health"
fi

if validate_edge; then
    log "  ✓ validate ok=true post-rollback"
else
    err "  ✗ validate ok=false post-rollback — INVESTIGAR"
fi

# ─────────────────────────────────────────────────────────────────────
# FASE D8 — Registrar drill en deploys.log
# ─────────────────────────────────────────────────────────────────────
phase "D8 — Registrar drill"

DRILL_ENTRY="$(ts_now) DRILL-ROLLBACK backend $ROLLBACK_TS actor=$ACTOR pre_commit=$COMMIT_PRE post_commit=$COMMIT_POST snapshot=$FAILED_NAME"
ssh_run "echo '$DRILL_ENTRY' >> '$REMOTE_DEPLOY_LOG'"
log "  ✓ drill registrado en $REMOTE_DEPLOY_LOG"

# ─────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────
echo ""
cat <<EOF
╔══════════════════════════════════════════════════════════════════╗
║  ✅ ROLLBACK DRILL COMPLETADO                                     ║
╚══════════════════════════════════════════════════════════════════╝

Pre-rollback:    commit=$COMMIT_PRE   version=$VERSION_PRE
Post-rollback:   commit=$COMMIT_POST  version=$VERSION_POST
Snapshot:        $REMOTE_BASE/$FAILED_NAME
Drill log:       $REMOTE_DEPLOY_LOG (línea más reciente)

NEXT STEPS:

  Si el drill validó que rollback funciona:
    - Decidir si re-aplicar el smoke release (deploy normal hacia adelante).
    - Si es producción real, considerar deshacer el snapshot tras 7 días:
        ssh $VPS_HOST "rm -rf $REMOTE_BASE/$FAILED_NAME"
      (o dejar que cleanup de deploy-backend.sh lo limpie automáticamente)

  Si el drill falló:
    - server.failed-drill-* preserva el código que estaba activo.
    - Revisar logs de api_1/api_2: docker logs --tail 200 chibalete_api_X
    - Comparar diff entre snapshot y server actual: diff -r

⚠️  data/, data-critical/, uploads/ NO fueron modificados — eso es
    invariante del drill, no necesita verificación adicional.
EOF
