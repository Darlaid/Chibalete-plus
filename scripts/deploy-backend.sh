#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Chibalete+ — Deploy backend canónico
# Sprint 022 / Fase 2B.7
#
# Autoridad operacional REAL del deploy backend de producción.
# Este script materializa la guía operacional `deployment_guide.md` §12
# (FASE B0–B9) + cleanup §10.3 + rollback §15.
#
# Modelo:
#   Corre LOCALMENTE en la máquina del operador. Usa ssh root@VPS para
#   cada operación remota. NO requiere agent en el VPS más allá de un
#   ssh sano y `bash`. NO usa CI/CD.
#
# Topología asumida (ver deployment_guide.md §2):
#   - Compose canónico: /opt/chibaleteplus/docker-compose.yml
#   - Bind mounts vivos: /var/www/chibalete/{data,data-critical,server,public/uploads}
#   - api_1 / api_2 corren chibalete/api:latest con bind mount → /app/server
#   - Backend deploy = swap atómico de server/ + restart staggered
#
# Uso:
#   bash scripts/deploy-backend.sh \
#        --release-tag rel-2026-05-07-membership-cache \
#        [--actor email@host] \
#        [--dry-run] \
#        [--abort-on-warn] \
#        [--retry-tag rel-...] \
#        [--skip-verify]    # PROHIBIDO en master
#
# Exit codes (diferenciados por fase para diagnóstico):
#   0   → deploy OK + post-validate OK
#   1   → B0 fail (preflight LOCAL)        → nada tocado
#   2   → B1 fail (empaquetado)            → nada tocado
#   3   → B2 fail (transferencia)          → tarball local presente
#   4   → B3 fail (preflight REMOTO)       → backup ya creado, server intacto
#   5   → B4 fail (staging)                → staging limpio, server intacto
#   6   → B5 fail (swap)                   → estado incierto, INSPECCIÓN
#   7   → B6 fail (api_1) → ROLLBACK AUTO  → server VIEJO restaurado
#   8   → B7 fail (api_2) → ROLLBACK AUTO  → server VIEJO restaurado en ambos
#   9   → B8 fail (post-validate edge)     → NO rollback auto, decisión humana
#   10  → B9 warn (logs/registro)          → deploy OK pero sucio
#   11  → lock no adquirido / otro deploy en progreso
#   12  → timeout global (watchdog)
#   99  → ROLLBACK FAILED — escalar inmediatamente
#
# Garantías:
#   - JAMÁS modifica /var/www/chibalete/data o /data-critical o /uploads
#   - JAMÁS hace `docker compose down` ni recrea imágenes
#   - JAMÁS reinicia api_1 y api_2 simultáneamente
#   - SIEMPRE backup pre-deploy vía scripts/backup-vps.sh (Fase 2B.5)
#   - SIEMPRE validate pre y post (BLOQUEANTE pre-, decisión humana post-)
#   - Restart staggered REAL: api_1 → validate aislado → api_2
#   - Rollback automático sólo de CÓDIGO (server/), nunca de data
# ─────────────────────────────────────────────────────────────────────

set -Eeuo pipefail

# ═════════════════════════════════════════════════════════════════════
# CONFIG (overridable vía env para test; defaults son producción real)
# ═════════════════════════════════════════════════════════════════════
VPS_HOST="${VPS_HOST:-root@72.60.158.97}"
PUBLIC_URL="${PUBLIC_URL:-https://chibaleteplus.chibaleteeditores.com}"
REMOTE_BASE="${REMOTE_BASE:-/var/www/chibalete}"
REMOTE_COMPOSE="${REMOTE_COMPOSE:-/opt/chibaleteplus/docker-compose.yml}"
REMOTE_BACKUP_BASE="${REMOTE_BACKUP_BASE:-/root/backups/chibalete}"
REMOTE_BACKUP_SCRIPT="${REMOTE_BACKUP_SCRIPT:-/root/scripts/backup-vps.sh}"
REMOTE_DEPLOY_LOG="${REMOTE_DEPLOY_LOG:-/root/deploys.log}"

# Timeouts y polls
HEALTH_TIMEOUT_S="${HEALTH_TIMEOUT_S:-30}"     # poll inicial post-restart
HEALTH_POLL_INT_S="${HEALTH_POLL_INT_S:-1}"    # entre intentos
HEALTH_GRACE_AFTER_S="${HEALTH_GRACE_AFTER_S:-3}"  # espera tras healthy antes de validate
GLOBAL_TIMEOUT_S="${GLOBAL_TIMEOUT_S:-1800}"   # watchdog: 30 min total

# Disk space thresholds (justificados en §DISK SPACE CHECK abajo)
MIN_FREE_GB_LOCAL="${MIN_FREE_GB_LOCAL:-2}"    # /tmp local: 2 GB
MIN_FREE_GB_REMOTE="${MIN_FREE_GB_REMOTE:-5}"  # /var en VPS: 5 GB

# Cleanup retention
CLEANUP_KEEP_OLD="${CLEANUP_KEEP_OLD:-3}"      # server.old-* a conservar
CLEANUP_KEEP_STAGING="${CLEANUP_KEEP_STAGING:-2}"  # server.staging-* residuales
CLEANUP_KEEP_FAILED="${CLEANUP_KEEP_FAILED:-5}"    # server.failed-* (forensics)

# Lock (ver §LOCK STRATEGY abajo)
REMOTE_LOCK_DIR="${REMOTE_LOCK_DIR:-/var/run/chib-deploy.lock}"

# SSH options — ControlMaster deshabilitado deliberadamente.
# En clientes Windows/Git-Bash y sandboxes CI, ControlMaster=auto +
# múltiples invocaciones SSH concurrentes (acquire_lock) reproducen un
# race condition: el primer SSH master crea el lock dir vía mkdir, la
# sesión master muere por mux_client_request_session, el SSH siguiente
# encuentra el dir existente sin metadata válida y aborta exit 11.
# Con ControlMaster=no cada SSH es independiente y el race desaparece.
# Trade-off aceptado: pequeño overhead por handshake en health-poll.
# ConnectTimeout/ServerAlive evitan ssh zombie en redes flaky.
# SSH_CM_DIR queda como dir residual benigno para preservar compatibilidad
# con las funciones de cleanup (mkdir/rm-rf idempotentes); si en el futuro
# se reactiva mux, las referencias existentes siguen funcionando.
SSH_CM_DIR="${SSH_CM_DIR:-/tmp/chib-deploy-cm-$$}"
SSH_OPTS=(
    -o "ControlMaster=no"
    -o "ConnectTimeout=15"
    -o "ServerAliveInterval=15"
    -o "ServerAliveCountMax=3"
    -o "BatchMode=yes"        # falla rápido si pide password (no interactivo)
)

# ═════════════════════════════════════════════════════════════════════
# ESTADO Y CONSTANTES
# ═════════════════════════════════════════════════════════════════════
RELEASE_TAG=""
ACTOR=""
DRY_RUN=0
ABORT_ON_WARN=0
ACCEPT_LEGACY_VALIDATE=0
RETRY_TAG=0
SKIP_VERIFY=0

GIT_SHA=""
GIT_SHA_FULL=""
TARBALL=""
TARBALL_SHA=""
TARBALL_SIZE=0
REMOTE_TARBALL=""
BACKUP_TS=""
STAGING=""
DEPLOY_STATE="pre"          # pre | staged | swapped | api1_new | api2_new | done
LOCK_ACQUIRED=0
WATCHDOG_PID=""
START_EPOCH=$(date +%s)
SUMMARY_LINES=()
BASELINE_VALIDATE_RESP=""

# ═════════════════════════════════════════════════════════════════════
# LOGGING
# ═════════════════════════════════════════════════════════════════════
ts_now() { date -u +%Y-%m-%dT%H:%M:%SZ; }

log()   { echo "[$(ts_now)] [INFO]  $*"; }
warn()  { echo "[$(ts_now)] [WARN]  $*"; }
err()   { echo "[$(ts_now)] [ERROR] $*" >&2; }
ok()    { echo "[$(ts_now)] [OK]    $*"; }
phase() { echo ""; echo "═════ $* ═════"; }

# Redacta valores sensibles antes de imprimir.
redact() {
    # Recibe línea; reemplaza ADMIN_SECRET en cualquier formato.
    if [ -n "${ADMIN_SECRET:-}" ]; then
        echo "$*" | sed "s|${ADMIN_SECRET}|<REDACTED-SECRET>|g"
    else
        echo "$*"
    fi
}

fail() {
    local code="${2:-1}"
    err "$1"
    exit "$code"
}

# ═════════════════════════════════════════════════════════════════════
# TRAPS — ERR captura comando fallido, EXIT siempre cierra recursos.
# ═════════════════════════════════════════════════════════════════════
on_error() {
    local exit_code=$?
    local line="${BASH_LINENO[0]:-?}"
    local cmd="${BASH_COMMAND:-?}"
    err "FALLO inesperado en línea $line — comando: '$(redact "$cmd")' — exit=$exit_code"
    err "DEPLOY_STATE=$DEPLOY_STATE  CURRENT_PHASE=${CURRENT_PHASE:-?}"
    # NO disparar rollback automático aquí: las fases ya tienen su propio
    # manejo explícito de rollback. Si llegamos a este trap, es un fallo no
    # anticipado y la decisión es humana (D4).
    err "Inspeccionar manualmente. NO se ejecuta rollback automático desde el trap."
    exit "${exit_code:-99}"
}

on_exit() {
    local exit_code=$?
    # Cerrar watchdog si vivo
    if [ -n "$WATCHDOG_PID" ] && kill -0 "$WATCHDOG_PID" 2>/dev/null; then
        kill "$WATCHDOG_PID" 2>/dev/null || true
    fi
    # Cerrar ssh control master para que próximas conexiones no reusen socket
    if [ -d "$SSH_CM_DIR" ]; then
        ssh "${SSH_OPTS[@]}" -O exit "$VPS_HOST" 2>/dev/null || true
        rm -rf "$SSH_CM_DIR" 2>/dev/null || true
    fi
    # Liberar lock SOLO si lo adquirimos en este run
    if [ "$LOCK_ACQUIRED" = "1" ]; then
        ssh "${SSH_OPTS[@]}" "$VPS_HOST" "rm -rf '$REMOTE_LOCK_DIR'" 2>/dev/null \
            && log "lock liberado" \
            || warn "no se pudo liberar lock $REMOTE_LOCK_DIR (revisar manualmente)"
    fi
    # Limpiar tarball local en cualquier exit (éxito o fallo)
    if [ -n "$TARBALL" ] && [ -f "$TARBALL" ]; then
        rm -f "$TARBALL"
    fi
    print_summary "$exit_code"
}

trap on_error ERR
trap on_exit EXIT

# ═════════════════════════════════════════════════════════════════════
# WATCHDOG GLOBAL — protege contra ssh freeze, poll infinito, zombies.
# Patrón: spawn bg con sleep, mata al parent al expirar. Trap EXIT mata
# el watchdog cuando el script termina antes (caso normal).
# ═════════════════════════════════════════════════════════════════════
start_watchdog() {
    local parent_pid=$$
    (
        sleep "$GLOBAL_TIMEOUT_S"
        # Si el parent sigue vivo después del timeout → matarlo con TERM
        if kill -0 "$parent_pid" 2>/dev/null; then
            echo "[$(ts_now)] [TIMEOUT] watchdog: ${GLOBAL_TIMEOUT_S}s excedidos — kill TERM al parent $parent_pid" >&2
            kill -TERM "$parent_pid" 2>/dev/null || true
            sleep 5
            # Si TERM no funcionó, KILL
            kill -KILL "$parent_pid" 2>/dev/null || true
        fi
    ) &
    WATCHDOG_PID=$!
    log "watchdog activo — timeout global ${GLOBAL_TIMEOUT_S}s (PID=$WATCHDOG_PID)"
}

# ═════════════════════════════════════════════════════════════════════
# UTILIDADES
# ═════════════════════════════════════════════════════════════════════

# Wrapper de ssh que respeta SSH_OPTS y retorna stdout limpio.
ssh_run() {
    ssh "${SSH_OPTS[@]}" "$VPS_HOST" "$@"
}

# Espacio libre en GB (entero) del filesystem que contiene el path.
free_gb_local() {
    local path="$1"
    df -BG --output=avail "$path" 2>/dev/null | tail -1 | tr -dc '0-9'
}

free_gb_remote() {
    local path="$1"
    ssh_run "df -BG --output=avail '$path' 2>/dev/null | tail -1 | tr -dc '0-9'"
}

# HTTP GET intra-container vía Node — la imagen `chibalete/api` no incluye
# `curl`. Imprime body en stdout y exit 0 si HTTP 200; vacío + exit !=0 si
# fail. Timeout 5s. Reemplaza el patrón previo `docker exec ... curl`.
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

# Validate intra-container con ADMIN_SECRET. El secret se pasa por env var
# `CHIB_ADMIN_SECRET` vía `docker exec -e` para que no aparezca en `ps` del
# host ni del container. Devuelve el body siempre (incluso si HTTP !=200)
# para que el caller pueda parsear `ok=false` con json_ok_true.
docker_node_validate() {
    local container="$1"
    ssh_run "docker exec -i -e CHIB_ADMIN_SECRET=\"$ADMIN_SECRET\" '$container' node" <<'NODE'
const http = require("http");
const sec = process.env.CHIB_ADMIN_SECRET || "";
const req = http.get({
  host:"localhost", port:3000, path:"/api/admin/membership/validate",
  timeout:30000, headers:{"x-admin-secret":sec}
}, r => {
  let d = "";
  r.on("data", c => d += c);
  r.on("end", () => { process.stdout.write(d); process.exit(r.statusCode === 200 ? 0 : 1); });
});
req.on("timeout", () => { req.destroy(); process.exit(4); });
req.on("error", () => process.exit(3));
NODE
}

# Extrae un campo string de JSON usando grep — evita dependencia jq para
# checks binarios. Sólo válido para JSON plano sin escapes complejos.
# Para parsing complejo (counts) sí usamos jq con `command -v jq` guard.
json_field_string() {
    # uso: json_field_string '{"ok":true,"x":"y"}' ok
    # devuelve "true" o "y" — un valor tal cual aparece (sin quotes JSON).
    local body="$1" key="$2"
    echo "$body" | grep -oE "\"$key\"[[:space:]]*:[[:space:]]*(\"[^\"]*\"|[a-zA-Z0-9_.-]+)" \
                 | head -1 \
                 | sed -E "s|\"$key\"[[:space:]]*:[[:space:]]*\"?([^\"]*)\"?|\1|"
}

# Validate boolean ok=true en respuesta JSON. Usa grep, no jq.
json_ok_true() {
    echo "$1" | grep -qE '"ok"[[:space:]]*:[[:space:]]*true'
}

# Comparación de counts: si jq disponible, comparación profunda.
# Fallback: comparación textual.
counts_equivalent() {
    local a="$1" b="$2"
    if command -v jq >/dev/null 2>&1; then
        # Re-serializar canónicamente para comparar deep-equal sin
        # depender de orden de keys.
        local an bn
        an=$(echo "$a" | jq -cS .) || return 1
        bn=$(echo "$b" | jq -cS .) || return 1
        [ "$an" = "$bn" ]
    else
        [ "$a" = "$b" ]
    fi
}

# ═════════════════════════════════════════════════════════════════════
# PARSING DE ARGUMENTOS
# ═════════════════════════════════════════════════════════════════════
usage() {
    cat <<EOF
Uso: bash scripts/deploy-backend.sh --release-tag <TAG> [opciones]

OBLIGATORIO:
  --release-tag <TAG>     Convención: rel-YYYY-MM-DD-<slug-kebab>

OPCIONES:
  --actor <email>         Quien dispara. Default: \$(git config user.email)
  --dry-run               Imprime plan, no toca VPS ni mueve archivos
  --abort-on-warn         Trata warnings como errores (CI estricto)
  --retry-tag             Permite reusar tag git existente (post-rollback)
  --skip-verify           PROHIBIDO en master. Salta npm run verify (sólo dev)
  --accept-legacy-validate
                          OPT-IN: B6/B7/B8 aceptan validate ok=false como WARN
                          en lugar de rollback. Pensado SOLO para el primer
                          deploy del operational stack del Sprint 022, donde
                          la data legacy (lectores sin grupo, etc.) genera
                          ok=false legítimo. Imprime los counts en WARN.
                          NO usar en deploys subsiguientes — debe pasar a
                          strict una vez la data esté consistente.
  -h | --help             Muestra esta ayuda

VARS DE ENTORNO:
  ADMIN_SECRET            Requerido. Leído desde .env si no está en env.
  VPS_HOST                Default root@72.60.158.97
  GLOBAL_TIMEOUT_S        Default 1800 (30 min)
  HEALTH_TIMEOUT_S        Default 30
EOF
}

parse_args() {
    while [ $# -gt 0 ]; do
        case "$1" in
            --release-tag)    RELEASE_TAG="$2"; shift 2 ;;
            --actor)          ACTOR="$2"; shift 2 ;;
            --dry-run)        DRY_RUN=1; shift ;;
            --abort-on-warn)  ABORT_ON_WARN=1; shift ;;
            --retry-tag)      RETRY_TAG=1; shift ;;
            --skip-verify)    SKIP_VERIFY=1; shift ;;
            --accept-legacy-validate) ACCEPT_LEGACY_VALIDATE=1; shift ;;
            -h|--help)        usage; exit 0 ;;
            *)                err "Argumento desconocido: $1"; usage; exit 1 ;;
        esac
    done

    if [ -z "$RELEASE_TAG" ]; then
        err "--release-tag es obligatorio"
        usage
        exit 1
    fi

    # Validar formato del tag (defensivo, no Draconiano)
    if ! [[ "$RELEASE_TAG" =~ ^rel-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$ ]]; then
        warn "RELEASE_TAG no sigue convención rel-YYYY-MM-DD-<slug-kebab>: $RELEASE_TAG"
        if [ "$ABORT_ON_WARN" = "1" ]; then exit 1; fi
    fi

    [ -z "$ACTOR" ] && ACTOR="$(git config user.email 2>/dev/null || echo unknown)"

    if [ "$SKIP_VERIFY" = "1" ]; then
        warn "🔴 --skip-verify activo — esto SOLO debe usarse en dev. NO en master."
        if [ "$ABORT_ON_WARN" = "1" ]; then exit 1; fi
    fi
}

# ═════════════════════════════════════════════════════════════════════
# CARGA DE SECRETOS — no leakear ADMIN_SECRET a logs/ps
# ═════════════════════════════════════════════════════════════════════
load_secrets() {
    if [ -z "${ADMIN_SECRET:-}" ] && [ -f .env ]; then
        # Leer ADMIN_SECRET de .env sin sourcearlo (evita ejecución arbitraria).
        # Patron: ADMIN_SECRET=valor (sin quotes o con quotes simples/dobles).
        local val
        val=$(grep -E '^ADMIN_SECRET=' .env | head -1 | sed 's/^ADMIN_SECRET=//' | sed 's/^["'"'"']//;s/["'"'"']$//')
        [ -n "$val" ] && export ADMIN_SECRET="$val"
    fi
    [ -n "${ADMIN_SECRET:-}" ] || fail "ADMIN_SECRET no disponible (env ni .env). Configurar antes de deploy." 1
}

# ═════════════════════════════════════════════════════════════════════
# LOCK STRATEGY — mkdir atómico + metadata file con actor/pid/ts
# ═════════════════════════════════════════════════════════════════════
acquire_lock() {
    log "intentando adquirir lock en $VPS_HOST:$REMOTE_LOCK_DIR"
    # mkdir es atómico en POSIX. Si el dir ya existe → fail.
    if ssh_run "mkdir '$REMOTE_LOCK_DIR' 2>/dev/null"; then
        # Escribir metadata DENTRO del lock dir (no sustituye el lock; documenta)
        local meta="actor=$ACTOR
pid=$$
host=$(hostname 2>/dev/null || echo unknown)
release_tag=$RELEASE_TAG
acquired_at=$(ts_now)
"
        ssh_run "cat > '$REMOTE_LOCK_DIR/owner.txt'" <<EOF
$meta
EOF
        LOCK_ACQUIRED=1
        ok "lock adquirido"
    else
        # Lock ya existe — leer metadata y abortar
        local owner
        owner=$(ssh_run "cat '$REMOTE_LOCK_DIR/owner.txt' 2>/dev/null || echo '<sin metadata>'")
        err "DEPLOY EN PROGRESO. Lock ocupado por:"
        err "$owner"
        err "Si seguro que el otro deploy falló y dejó residuo:"
        err "  ssh $VPS_HOST \"rm -rf '$REMOTE_LOCK_DIR'\""
        exit 11
    fi
}

# ═════════════════════════════════════════════════════════════════════
# FASE B0 — Pre-flight LOCAL
# ═════════════════════════════════════════════════════════════════════
phase_b0() {
    CURRENT_PHASE="B0"
    phase "FASE B0 — Pre-flight LOCAL"

    # 1. git status limpio
    if [ -n "$(git status --porcelain 2>/dev/null)" ]; then
        fail "working tree dirty. commit o stash antes." 1
    fi
    log "  ✓ git status limpio"

    # 2. branch tracking + ahead/behind con origin
    if ! git fetch --quiet origin 2>/dev/null; then
        warn "  ⚠ git fetch origin falló (offline?) — continuar bajo tu responsabilidad"
        if [ "$ABORT_ON_WARN" = "1" ]; then exit 1; fi
    else
        local local_sha remote_sha
        local_sha=$(git rev-parse @ 2>/dev/null)
        remote_sha=$(git rev-parse '@{u}' 2>/dev/null || echo "")
        if [ -n "$remote_sha" ] && [ "$local_sha" != "$remote_sha" ]; then
            warn "  ⚠ HEAD local difiere de upstream"
            warn "      local:  $local_sha"
            warn "      remote: $remote_sha"
            if [ "$ABORT_ON_WARN" = "1" ]; then exit 1; fi
        else
            log "  ✓ HEAD == upstream"
        fi
    fi

    # 3. RELEASE_TAG no colisiona con tag git existente (a menos que --retry-tag)
    # Process substitution para evitar SIGPIPE bajo `pipefail`.
    if grep -qF "$RELEASE_TAG" <(git tag -l "$RELEASE_TAG" 2>/dev/null); then
        if [ "$RETRY_TAG" = "1" ]; then
            warn "  ⚠ RELEASE_TAG '$RELEASE_TAG' ya existe — proceder con --retry-tag"
        else
            fail "RELEASE_TAG '$RELEASE_TAG' ya existe como tag git. Usar --retry-tag o cambiar tag." 1
        fi
    else
        log "  ✓ RELEASE_TAG '$RELEASE_TAG' libre"
    fi

    # 4. Capturar GIT_SHA
    GIT_SHA=$(git rev-parse --short HEAD 2>/dev/null) || fail "git rev-parse HEAD falló" 1
    GIT_SHA_FULL=$(git rev-parse HEAD 2>/dev/null)
    log "  ✓ GIT_SHA=$GIT_SHA"

    # 5. Confirmar que HEAD está pushado a origin (commit existe en remote)
    # Process substitution para evitar SIGPIPE bajo `pipefail`.
    if grep -q '^[[:space:]]*origin/' <(git branch -r --contains "$GIT_SHA_FULL" 2>/dev/null); then
        log "  ✓ HEAD pushado a origin"
    else
        warn "  ⚠ HEAD no encontrado en origin — push primero recomendado"
        if [ "$ABORT_ON_WARN" = "1" ]; then exit 1; fi
    fi

    # 6. Detectar cambios en package*.json desde último deploy backend
    local last_backend_sha
    last_backend_sha=$(ssh_run "grep ' backend ' '$REMOTE_DEPLOY_LOG' 2>/dev/null | tail -1 | awk '{for(i=1;i<=NF;i++) if(\$i ~ /^sha=/) print substr(\$i,5)}'" || true)
    last_backend_sha=$(echo "$last_backend_sha" | tr -d '[:space:]')
    if [ -n "$last_backend_sha" ]; then
        if git rev-parse "$last_backend_sha" >/dev/null 2>&1; then
            if ! git diff --quiet "$last_backend_sha..HEAD" -- package.json package-lock.json 2>/dev/null; then
                fail "package.json/package-lock.json cambiaron desde último deploy ($last_backend_sha). \
                      Este sprint NO cubre rebuild de imagen api. Sprint dedicado requerido." 1
            fi
            log "  ✓ package*.json sin cambios desde $last_backend_sha"
        else
            warn "  ⚠ último deploy SHA ($last_backend_sha) no encontrado en git local — saltando comparación"
        fi
    else
        # Sprint 022.10 noise reduction: el primer deploy canónico es un
        # estado ESPERADO, no una anomalía. Etiquetar como INFO evita
        # confundir al operador (especialmente en horario de baja energía).
        log "  ℹ deploys.log sin entries previos — primer deploy backend canónico (estado esperado, NO es error)"
    fi

    # 7. Espacio local
    local free_local
    free_local=$(free_gb_local /tmp)
    if [ -z "$free_local" ] || [ "$free_local" -lt "$MIN_FREE_GB_LOCAL" ]; then
        fail "espacio en /tmp insuficiente: ${free_local}GB < ${MIN_FREE_GB_LOCAL}GB" 1
    fi
    log "  ✓ /tmp local: ${free_local}GB libres"

    # 8. npm run verify
    if [ "$SKIP_VERIFY" = "1" ]; then
        warn "  ⚠ saltando npm run verify (--skip-verify)"
    else
        log "  → npm run verify (puede tardar varios segundos)"
        if ! npm run verify >/dev/null 2>&1; then
            err "  ✗ npm run verify FAILED — corre 'npm run verify' manualmente para detalles"
            exit 1
        fi
        log "  ✓ npm run verify OK"
    fi

    # 9. npm run validate:local
    log "  → npm run validate:local"
    if ! npm run validate:local >/dev/null 2>&1; then
        err "  ✗ npm run validate:local FAILED — corre manualmente para detalles"
        exit 1
    fi
    log "  ✓ npm run validate:local OK"

    ok "B0 completado"
    SUMMARY_LINES+=("B0 ✓  preflight local — RELEASE_TAG=$RELEASE_TAG GIT_SHA=$GIT_SHA")
}

# ═════════════════════════════════════════════════════════════════════
# FASE B1 — Empaquetado
# ═════════════════════════════════════════════════════════════════════
phase_b1() {
    CURRENT_PHASE="B1"
    phase "FASE B1 — Empaquetado"

    TARBALL="/tmp/chib-server-${RELEASE_TAG}.tgz"
    rm -f "$TARBALL"

    # Generar server/.deploy-info dentro del staging temporal antes de tarear.
    # Patrón: copiamos los dirs a un staging tmp, escribimos .deploy-info dentro
    # de su server/, y empaquetamos. Más simple que --append (que requiere tar
    # no comprimido).
    local pkg_root="/tmp/chib-pkg-${RELEASE_TAG}"
    rm -rf "$pkg_root"
    mkdir -p "$pkg_root"

    # Copiar (no mover) las carpetas — preserva el repo intacto.
    # CHP-ID-METRICS-DEPLOY-01A-R1: `engines` entra al paquete porque
    # server/metrics/metricsRouterV2.mjs importa engines/metrics/*. Sin él el
    # router v2 no monta y la API se despliega incompleta sin fallar.
    for d in server utils types engines; do
        [ -d "$d" ] || fail "directorio fuente '$d' no existe en repo" 2
        cp -a "$d" "$pkg_root/"
    done

    # Guard de empaquetado: los módulos que el router v2 importa deben viajar.
    for f in engines/metrics/eventContract.mjs engines/metrics/referenceEngine.mjs; do
        [ -f "$pkg_root/$f" ] || fail "paquete incompleto: falta $f" 2
    done

    # Escribir .deploy-info — fuente canónica D2 leída por healthHandler.js
    cat > "$pkg_root/server/.deploy-info" <<EOF
{
  "release_tag": "$RELEASE_TAG",
  "git_sha": "$GIT_SHA_FULL",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

    # Tarear con exclusiones del § design
    if ! tar --exclude='node_modules' \
            --exclude='__test__' \
            --exclude='*.log' \
            --exclude='_prod_snapshot_' \
            --exclude='_api_snapshot_' \
            --exclude='.DS_Store' \
            -czf "$TARBALL" \
            -C "$pkg_root" server utils types engines; then
        rm -rf "$pkg_root"
        fail "tar falló" 2
    fi
    rm -rf "$pkg_root"

    [ -s "$TARBALL" ] || fail "tarball vacío post-tar" 2

    TARBALL_SHA=$(sha256sum "$TARBALL" | awk '{print $1}')
    TARBALL_SIZE=$(stat -c%s "$TARBALL" 2>/dev/null || stat -f%z "$TARBALL" 2>/dev/null || echo 0)

    log "  ✓ tarball: $TARBALL"
    log "    size: $(numfmt --to=iec --suffix=B "$TARBALL_SIZE" 2>/dev/null || echo "${TARBALL_SIZE}B")"
    log "    sha256: ${TARBALL_SHA:0:16}…"

    # Sanity: verificar que el tarball contiene .deploy-info.
    # Usar process substitution en lugar de pipe, porque `grep -q` cierra
    # stdin al primer match → tar recibe SIGPIPE → con `pipefail` activo el
    # pipeline retorna 141 aunque grep haya hecho match. Process substitution
    # evita este antipattern clásico de bash.
    if ! grep -q '^server/\.deploy-info$' <(tar -tzf "$TARBALL"); then
        fail "tarball NO contiene server/.deploy-info" 2
    fi
    log "  ✓ server/.deploy-info presente en tarball"

    SUMMARY_LINES+=("B1 ✓  tarball $(numfmt --to=iec --suffix=B "$TARBALL_SIZE" 2>/dev/null || echo "${TARBALL_SIZE}B") sha=${TARBALL_SHA:0:12}")
}

# ═════════════════════════════════════════════════════════════════════
# FASE B2 — Transferencia
# ═════════════════════════════════════════════════════════════════════
phase_b2() {
    CURRENT_PHASE="B2"
    phase "FASE B2 — Transferencia"

    REMOTE_TARBALL="/tmp/chib-server-${RELEASE_TAG}.tgz"

    if [ "$DRY_RUN" = "1" ]; then
        log "  [DRY-RUN] saltando scp $TARBALL → $VPS_HOST:$REMOTE_TARBALL"
        SUMMARY_LINES+=("B2 ⊘  saltado por --dry-run")
        return 0
    fi

    log "  → scp $TARBALL → $VPS_HOST:$REMOTE_TARBALL"
    if ! scp "${SSH_OPTS[@]}" "$TARBALL" "$VPS_HOST:$REMOTE_TARBALL"; then
        fail "scp falló" 3
    fi

    # Verificar checksum en remoto
    local remote_sha
    remote_sha=$(ssh_run "sha256sum '$REMOTE_TARBALL' 2>/dev/null | awk '{print \$1}'")
    if [ "$remote_sha" != "$TARBALL_SHA" ]; then
        fail "checksum mismatch: local=${TARBALL_SHA:0:16} remote=${remote_sha:0:16}" 3
    fi
    log "  ✓ checksum verificado en VPS"

    # backup-vps.sh: chequear sha256 sin sobrescribir (D3)
    if ssh_run "test -f '$REMOTE_BACKUP_SCRIPT'"; then
        local remote_backup_sha local_backup_sha
        remote_backup_sha=$(ssh_run "sha256sum '$REMOTE_BACKUP_SCRIPT' 2>/dev/null | awk '{print \$1}'")
        local_backup_sha=$(sha256sum scripts/backup-vps.sh | awk '{print $1}')
        if [ "$remote_backup_sha" != "$local_backup_sha" ]; then
            warn "  ⚠ backup-vps.sh en VPS difiere del local (D3)"
            warn "      local:  ${local_backup_sha:0:16}"
            warn "      remote: ${remote_backup_sha:0:16}"
            warn "      NO sobrescribiendo automáticamente. Si quieres actualizar:"
            warn "        scp scripts/backup-vps.sh $VPS_HOST:$REMOTE_BACKUP_SCRIPT"
            if [ "$ABORT_ON_WARN" = "1" ]; then exit 1; fi
        else
            log "  ✓ backup-vps.sh en VPS coincide con repo"
        fi
    else
        log "  → backup-vps.sh ausente en VPS, transfiriendo (primera vez)"
        ssh_run "mkdir -p '$(dirname "$REMOTE_BACKUP_SCRIPT")'"
        scp "${SSH_OPTS[@]}" scripts/backup-vps.sh "$VPS_HOST:$REMOTE_BACKUP_SCRIPT"
        ssh_run "chmod 700 '$REMOTE_BACKUP_SCRIPT'"
        log "  ✓ backup-vps.sh transferido"
    fi

    SUMMARY_LINES+=("B2 ✓  tarball + backup-vps.sh en VPS")
}

# ═════════════════════════════════════════════════════════════════════
# FASE B3 — Pre-flight REMOTO + backup
# ═════════════════════════════════════════════════════════════════════
phase_b3() {
    CURRENT_PHASE="B3"
    phase "FASE B3 — Pre-flight REMOTO + backup"

    if [ "$DRY_RUN" = "1" ]; then
        log "  [DRY-RUN] saltando preflight remoto y backup"
        SUMMARY_LINES+=("B3 ⊘  saltado por --dry-run")
        return 0
    fi

    # 1. docker ps esperado
    local ps_out
    ps_out=$(ssh_run "docker ps --format '{{.Names}}'")
    for c in chibalete_edge chibalete_front chibalete_api_1 chibalete_api_2; do
        if ! echo "$ps_out" | grep -qx "$c"; then
            fail "container faltante o caído: $c" 4
        fi
    done
    log "  ✓ 4 containers UP (edge, front, api_1, api_2)"

    # 2. compose existe
    ssh_run "test -f '$REMOTE_COMPOSE'" || fail "compose no encontrado: $REMOTE_COMPOSE" 4
    log "  ✓ compose canónico presente"

    # 2bis. INVARIANTE: $REMOTE_BASE/server DEBE existir antes de iniciar B5.
    # Su ausencia indica que un deploy previo crasheó entre los dos `mv` del
    # swap atómico, o que algún operador movió/borró server/ manualmente.
    # En ambos casos, NO podemos continuar — el siguiente swap (B5) movería
    # un directorio que no existe, dejando el sistema en estado inconsistente.
    # Recovery manual requerido — ver mensaje de error.
    if ! ssh_run "test -d '$REMOTE_BASE/server'"; then
        err "INVARIANTE VIOLADA: $REMOTE_BASE/server NO existe."
        err "Causa probable: deploy previo crasheó entre los dos mv del swap"
        err "(ssh disconnect, kill, disk full)."
        err ""
        err "Recovery manual antes de re-correr deploy:"
        err "  1) Inspeccionar restos de runs previos:"
        err "       ssh $VPS_HOST 'ls -la $REMOTE_BASE/'"
        err "  2) Recuperar desde server.old-* más reciente:"
        err "       ssh $VPS_HOST 'mv \$(ls -1dt $REMOTE_BASE/server.old-* | head -1) $REMOTE_BASE/server'"
        err "     o desde server.staging-* del run anterior:"
        err "       ssh $VPS_HOST 'mv $REMOTE_BASE/server.staging-<TAG>/server $REMOTE_BASE/server'"
        err "  3) Restart staggered manual + validate"
        err "  4) Re-intentar este deploy"
        exit 4
    fi
    log "  ✓ $REMOTE_BASE/server existe (no hay crash mid-swap residual)"

    # 3. Espacio remoto
    local free_remote
    free_remote=$(free_gb_remote /var)
    if [ -z "$free_remote" ] || [ "$free_remote" -lt "$MIN_FREE_GB_REMOTE" ]; then
        fail "espacio en VPS /var insuficiente: ${free_remote}GB < ${MIN_FREE_GB_REMOTE}GB" 4
    fi
    log "  ✓ /var en VPS: ${free_remote}GB libres"

    # 4. Validate endpoint pre-deploy — capturar baseline.
    # Acepta 3 estados:
    #   - HTTP 200 + ok=true        → baseline normal, capturar counts
    #   - HTTP 404 / endpoint absent → BASELINE_ABSENT (primer deploy del
    #     operational stack del Sprint 022; el endpoint /api/admin/membership/
    #     /validate lo introduce el commit 941ee9d, NO existe aún en main)
    #   - cualquier otro estado     → ABORT exit 4
    # B8 post-deploy SÍ exige strict ok=true (handled abajo en phase_b8).
    log "  → validate vía edge (capturar baseline)"
    local validate_resp validate_code _validate_out
    # Usamos --config - con secret por stdin via pipe (no por argv ni process
    # substitution; <(...) genera /dev/fd/N que curl no resuelve en
    # Git Bash/MSYS — el FD pertenece al subshell bash, curl es binario nativo).
    # `-w '\nHTTP_CODE_=N'` añade el HTTP status en línea separada para parsear.
    _validate_out=$(printf 'header = "x-admin-secret: %s"\n' "$ADMIN_SECRET" \
        | curl -sS --max-time 30 \
            -w '\nHTTP_CODE_=%{http_code}' \
            --config - \
            "$PUBLIC_URL/api/admin/membership/validate" 2>&1) || \
        fail "curl validate edge FAILED: $_validate_out" 4
    validate_code=$(echo "$_validate_out" | grep -E '^HTTP_CODE_=' | tail -1 | sed 's/^HTTP_CODE_=//')
    validate_resp=$(echo "$_validate_out" | sed '/^HTTP_CODE_=/d')

    case "$validate_code" in
        200)
            if ! json_ok_true "$validate_resp"; then
                err "validate pre-deploy HTTP 200 pero ok!=true. ABORT — limpiar drift antes."
                err "$(redact "$validate_resp")"
                exit 4
            fi
            BASELINE_VALIDATE_RESP="$validate_resp"
            log "  ✓ validate pre-deploy ok=true (baseline capturado)"
            ;;
        404)
            # Endpoint nuevo del Sprint 022: en producción actual (main viejo)
            # no existe → 404 esperado para el PRIMER deploy del operational
            # stack. Aceptar como BASELINE_ABSENT y proseguir; B8 post-deploy
            # va a exigir ok=true.
            warn "  ℹ validate endpoint absent pre-deploy (HTTP 404)"
            warn "    Expected for FIRST Sprint 022 deploy: endpoint introduced by"
            warn "    commit 941ee9d (membership integrity). Post-deploy enforces ok=true."
            BASELINE_VALIDATE_RESP="BASELINE_ABSENT"
            log "  ✓ validate pre-deploy: BASELINE_ABSENT (proseguir, B8 va a validar strict)"
            ;;
        *)
            err "validate pre-deploy HTTP=$validate_code (inesperado). ABORT."
            err "$(redact "$validate_resp")"
            exit 4
            ;;
    esac

    # 5. Ejecutar backup vía script canónico
    log "  → ejecutando $REMOTE_BACKUP_SCRIPT"
    local backup_out backup_rc
    set +e
    backup_out=$(ssh_run "bash '$REMOTE_BACKUP_SCRIPT'")
    backup_rc=$?
    set -e
    if [ "$backup_rc" != "0" ]; then
        # exit 3 de backup-vps.sh = retention falló pero backup OK; aceptable.
        if [ "$backup_rc" = "3" ]; then
            warn "  ⚠ backup-vps.sh exit 3 (retention falló pero backup OK)"
        else
            err "backup-vps.sh exit $backup_rc — ABORT"
            err "$backup_out"
            exit 4
        fi
    fi

    # 6. Capturar BACKUP_TS desde sentinel (D1)
    BACKUP_TS=$(echo "$backup_out" | grep '^BACKUP_TS=' | tail -1 | sed 's/^BACKUP_TS=//')
    if [ -z "$BACKUP_TS" ]; then
        fail "no se pudo capturar BACKUP_TS desde stdout de backup-vps.sh" 4
    fi
    log "  ✓ BACKUP_TS=$BACKUP_TS"

    # 7. Validar metadata.status == "ok" (sin requerir jq remoto)
    local meta_status
    meta_status=$(ssh_run "grep -E '\"status\"[[:space:]]*:[[:space:]]*\"[^\"]*\"' '$REMOTE_BACKUP_BASE/$BACKUP_TS/metadata.json' | head -1 | sed -E 's/.*\"status\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/'")
    if [ "$meta_status" != "ok" ]; then
        fail "backup metadata.status='$meta_status' (esperado 'ok')" 4
    fi
    log "  ✓ metadata.status=ok"

    # 8. Confirmar 7 archivos esperados
    for f in data.tar.gz data-critical.tar.gz server.tar.gz docker-compose.yml uploads-manifest.txt metadata.json backup.log; do
        ssh_run "test -s '$REMOTE_BACKUP_BASE/$BACKUP_TS/$f'" \
            || fail "backup file missing or empty: $f" 4
    done
    log "  ✓ 7 artefactos backup presentes"

    SUMMARY_LINES+=("B3 ✓  backup OK — BACKUP_TS=$BACKUP_TS")
}

# ═════════════════════════════════════════════════════════════════════
# FASE B4 — Staging
# ═════════════════════════════════════════════════════════════════════
phase_b4() {
    CURRENT_PHASE="B4"
    phase "FASE B4 — Staging"

    if [ "$DRY_RUN" = "1" ]; then
        log "  [DRY-RUN] saltando staging"
        SUMMARY_LINES+=("B4 ⊘  saltado por --dry-run")
        return 0
    fi

    STAGING="$REMOTE_BASE/server.staging-$RELEASE_TAG"

    # Limpieza idempotente de staging previo del mismo tag
    ssh_run "rm -rf '$STAGING' && mkdir -p '$STAGING'" \
        || fail "no se pudo preparar staging dir $STAGING" 5

    # Extracción
    ssh_run "tar -xzf '$REMOTE_TARBALL' -C '$STAGING'" \
        || fail "tar -xzf falló en staging" 5

    # Sanity: archivos canónicos presentes
    for f in server/server.js server/healthHandler.js server/groupMembershipService.js; do
        ssh_run "test -s '$STAGING/$f'" || fail "missing en staging: $f" 5
    done
    log "  ✓ archivos canónicos presentes (server.js, healthHandler.js, groupMembershipService.js)"

    # Sanity: server.js tamaño mínimo (regression guard contra tarball corrupto)
    local sz
    sz=$(ssh_run "stat -c%s '$STAGING/server/server.js' 2>/dev/null || echo 0")
    if [ "$sz" -lt 50000 ]; then
        fail "server.js sospechosamente pequeño: $sz bytes" 5
    fi
    log "  ✓ server.js size=$sz bytes"

    # Sanity: .deploy-info presente y bien formado
    local deploy_info
    deploy_info=$(ssh_run "cat '$STAGING/server/.deploy-info' 2>/dev/null")
    if ! echo "$deploy_info" | grep -q "\"release_tag\".*\"$RELEASE_TAG\""; then
        fail ".deploy-info en staging no contiene release_tag esperado" 5
    fi
    log "  ✓ .deploy-info válido (release_tag=$RELEASE_TAG)"

    # Permisos razonables
    local perms
    perms=$(ssh_run "stat -c%a '$STAGING/server/server.js'")
    case "$perms" in
        6??|7??) log "  ✓ perms server.js: $perms" ;;
        *)       fail "perms server.js anómalos: $perms" 5 ;;
    esac

    DEPLOY_STATE="staged"
    SUMMARY_LINES+=("B4 ✓  staging extraído en $STAGING")
}

# ═════════════════════════════════════════════════════════════════════
# FASE B5 — Swap atómico
# 🔴 PUNTO SIN RETORNO
# ═════════════════════════════════════════════════════════════════════
phase_b5() {
    CURRENT_PHASE="B5"
    phase "FASE B5 — Swap atómico (🔴 punto sin retorno)"

    if [ "$DRY_RUN" = "1" ]; then
        log "  [DRY-RUN] saltando swap"
        SUMMARY_LINES+=("B5 ⊘  saltado por --dry-run")
        return 0
    fi

    # Verificar que server.old-$BACKUP_TS no existe ya (idempotencia)
    if ssh_run "test -e '$REMOTE_BASE/server.old-$BACKUP_TS'"; then
        fail "$REMOTE_BASE/server.old-$BACKUP_TS ya existe — estado residual, abortar" 6
    fi

    # Swap: server/ Y utils/ a la vez. Ambos directorios se promueven desde
    # staging/ a la posición operativa, y los activos se preservan como
    # server.old-$TS / utils.old-$TS para rollback. Ambos mv son atómicos
    # a nivel kernel (mismo filesystem); ejecutados en una sola sesión SSH
    # para minimizar la ventana entre operaciones.
    #
    # utils/ es opcional: solo se mueve si el staging lo trae (Sprint 022+
    # introduce utils/groupDiagnosis.mjs y similares; pre-Sprint 022 utils/
    # no existe en producción y server.js viejo no lo importa).
    log "  → swap mv (server, utils → .old-$BACKUP_TS, staging/{server,utils} → live)"
    if ! ssh_run "
set -e
mv '$REMOTE_BASE/server' '$REMOTE_BASE/server.old-$BACKUP_TS'
if [ -d '$REMOTE_BASE/utils' ]; then
    mv '$REMOTE_BASE/utils' '$REMOTE_BASE/utils.old-$BACKUP_TS'
fi
mv '$STAGING/server' '$REMOTE_BASE/server'
if [ -d '$STAGING/utils' ]; then
    mv '$STAGING/utils' '$REMOTE_BASE/utils'
fi
test -s '$REMOTE_BASE/server/server.js'
"; then
        err "🔴 SWAP ATÓMICO FALLÓ — estado incierto"
        err "Inspeccionar manualmente:"
        err "  ssh $VPS_HOST 'ls -la $REMOTE_BASE/'"
        err "Si server/ ausente: mv server.old-$BACKUP_TS server"
        err "Si utils/ ausente: mv utils.old-$BACKUP_TS utils"
        exit 6
    fi
    DEPLOY_STATE="swapped"
    log "  ✓ server/ + utils/ NUEVOS en disco — api_X siguen sirviendo VIEJO en RAM"
    SUMMARY_LINES+=("B5 ✓  swap completo (server.old-$BACKUP_TS, utils.old-$BACKUP_TS preservados)")
}

# ═════════════════════════════════════════════════════════════════════
# Health poll INTERNO al container — usa docker exec node, no edge
# (la imagen `chibalete/api` no incluye `curl`; ver docker_node_health).
# ═════════════════════════════════════════════════════════════════════
poll_internal_health() {
    local container="$1"
    local timeout="${2:-$HEALTH_TIMEOUT_S}"
    local elapsed=0
    local resp

    while [ "$elapsed" -lt "$timeout" ]; do
        resp=$(docker_node_health "$container" 2>/dev/null || echo "")
        if [ -n "$resp" ] && echo "$resp" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
            log "    healthy: $container (${elapsed}s)"
            # Pequeña gracia adicional para que loaders terminen
            sleep "$HEALTH_GRACE_AFTER_S"
            return 0
        fi
        sleep "$HEALTH_POLL_INT_S"
        elapsed=$((elapsed + HEALTH_POLL_INT_S))
    done
    err "    NO healthy en ${timeout}s: $container"
    return 1
}

# Validate aislado dentro del container — secret pasado vía env var del
# `docker exec -e` (no argv) para que no aparezca en `ps`. Implementación
# en docker_node_validate (la imagen no incluye `curl`).
validate_in_container() {
    local container="$1"
    docker_node_validate "$container"
}

# ═════════════════════════════════════════════════════════════════════
# FASE B6 — Restart api_1 + validate aislado
# ═════════════════════════════════════════════════════════════════════
phase_b6() {
    CURRENT_PHASE="B6"
    phase "FASE B6 — Restart api_1 + validate aislado"

    if [ "$DRY_RUN" = "1" ]; then
        log "  [DRY-RUN] saltando restart api_1"
        SUMMARY_LINES+=("B6 ⊘  saltado por --dry-run")
        return 0
    fi

    log "  → docker stop chibalete_api_1 --time=30"
    ssh_run "docker stop chibalete_api_1 --time=30 >/dev/null"
    log "  → docker start chibalete_api_1"
    ssh_run "docker start chibalete_api_1 >/dev/null"

    if ! poll_internal_health chibalete_api_1 "$HEALTH_TIMEOUT_S"; then
        rollback_code "api1_failed_health"
        exit 7
    fi

    log "  → validate aislado en api_1"
    local resp
    resp=$(validate_in_container chibalete_api_1)
    if ! json_ok_true "$resp"; then
        if [ "$ACCEPT_LEGACY_VALIDATE" = "1" ]; then
            warn "  ⚠ api_1 validate ok=false ACEPTADO (--accept-legacy-validate)"
            if command -v jq >/dev/null 2>&1; then
                warn "    counts: $(echo "$resp" | jq -c '.counts // {}' 2>/dev/null || echo '{}')"
            fi
            warn "    Pensado SOLO para primer deploy Sprint 022 (data legacy esperada)."
        else
            err "    api_1 validate ok=false"
            rollback_code "api1_failed_validate"
            exit 7
        fi
    else
        log "  ✓ api_1 validate ok=true"
    fi

    # Verificar commit reportado por /api/health = nuestro GIT_SHA
    local health resp_commit
    health=$(docker_node_health chibalete_api_1)
    resp_commit=$(json_field_string "$health" commit)
    if [ "$resp_commit" != "$GIT_SHA_FULL" ] && [ "$resp_commit" != "$GIT_SHA" ]; then
        warn "  ⚠ api_1 reporta commit='$resp_commit', esperado='$GIT_SHA' (.deploy-info no se cargó?)"
        if [ "$ABORT_ON_WARN" = "1" ]; then
            rollback_code "api1_commit_mismatch"
            exit 7
        fi
    else
        log "  ✓ api_1 reporta commit=$resp_commit"
    fi

    DEPLOY_STATE="api1_new"
    SUMMARY_LINES+=("B6 ✓  api_1 NUEVO healthy + validated")
}

# ═════════════════════════════════════════════════════════════════════
# FASE B7 — Restart api_2
# ═════════════════════════════════════════════════════════════════════
phase_b7() {
    CURRENT_PHASE="B7"
    phase "FASE B7 — Restart api_2"

    if [ "$DRY_RUN" = "1" ]; then
        log "  [DRY-RUN] saltando restart api_2"
        SUMMARY_LINES+=("B7 ⊘  saltado por --dry-run")
        return 0
    fi

    log "  → docker stop chibalete_api_2 --time=30"
    ssh_run "docker stop chibalete_api_2 --time=30 >/dev/null"
    log "  → docker start chibalete_api_2"
    ssh_run "docker start chibalete_api_2 >/dev/null"

    if ! poll_internal_health chibalete_api_2 "$HEALTH_TIMEOUT_S"; then
        rollback_code "api2_failed_health"
        exit 8
    fi

    log "  → validate aislado en api_2"
    local resp
    resp=$(validate_in_container chibalete_api_2)
    if ! json_ok_true "$resp"; then
        if [ "$ACCEPT_LEGACY_VALIDATE" = "1" ]; then
            warn "  ⚠ api_2 validate ok=false ACEPTADO (--accept-legacy-validate)"
            if command -v jq >/dev/null 2>&1; then
                warn "    counts: $(echo "$resp" | jq -c '.counts // {}' 2>/dev/null || echo '{}')"
            fi
            warn "    Pensado SOLO para primer deploy Sprint 022 (data legacy esperada)."
        else
            err "    api_2 validate ok=false"
            rollback_code "api2_failed_validate"
            exit 8
        fi
    else
        log "  ✓ api_2 validate ok=true"
    fi

    DEPLOY_STATE="api2_new"
    SUMMARY_LINES+=("B7 ✓  api_2 NUEVO healthy + validated")
}

# ═════════════════════════════════════════════════════════════════════
# FASE B8 — Post-validate vía edge
# ═════════════════════════════════════════════════════════════════════
phase_b8() {
    CURRENT_PHASE="B8"
    phase "FASE B8 — Post-validate vía edge"

    if [ "$DRY_RUN" = "1" ]; then
        log "  [DRY-RUN] saltando post-validate"
        SUMMARY_LINES+=("B8 ⊘  saltado por --dry-run")
        return 0
    fi

    # 1. Health vía edge
    local resp
    resp=$(curl -sS --max-time 10 "$PUBLIC_URL/api/health") \
        || fail "curl edge /api/health falló" 9
    if ! echo "$resp" | grep -q '"status"[[:space:]]*:[[:space:]]*"ok"'; then
        err "health vía edge != ok"
        err "$(redact "$resp")"
        # NO rollback automático aquí — el código nuevo puede ser correcto;
        # podría ser un problema de edge, no de api.
        exit 9
    fi
    log "  ✓ health edge ok"

    # 2. Validate vía edge — STRICT post-deploy. Acepta solo HTTP 200 + ok=true.
    # 404 post-deploy = endpoint NUEVO no respondió a pesar del swap exitoso →
    # FAIL (server.js no se cargó correctamente, módulo no importado, etc.).
    # Cualquier otro estado o ok=false = decisión humana (exit 9).
    local _post_validate_out post_validate_code
    _post_validate_out=$(printf 'header = "x-admin-secret: %s"\n' "$ADMIN_SECRET" \
        | curl -sS --max-time 30 \
            -w '\nHTTP_CODE_=%{http_code}' \
            --config - \
            "$PUBLIC_URL/api/admin/membership/validate" 2>&1)
    post_validate_code=$(echo "$_post_validate_out" | grep -E '^HTTP_CODE_=' | tail -1 | sed 's/^HTTP_CODE_=//')
    resp=$(echo "$_post_validate_out" | sed '/^HTTP_CODE_=/d')

    case "$post_validate_code" in
        200)
            if ! json_ok_true "$resp"; then
                if [ "$ACCEPT_LEGACY_VALIDATE" = "1" ]; then
                    warn "validate edge HTTP 200 ok=false ACEPTADO (--accept-legacy-validate)"
                    if command -v jq >/dev/null 2>&1; then
                        warn "    counts: $(echo "$resp" | jq -c '.counts // {}' 2>/dev/null || echo '{}')"
                    fi
                    warn "    Pensado SOLO para primer deploy Sprint 022 (data legacy esperada)."
                else
                    err "validate post-deploy HTTP 200 pero ok=false vía edge"
                    err "ESTADO DEGRADADO. NO se aplica rollback automático en B8."
                    err "Decisión humana: revisar issues, decidir rollback código solamente"
                    err "o restore data desde backup BACKUP_TS=$BACKUP_TS (último recurso, manual)."
                    exit 9
                fi
            else
                log "  ✓ validate edge ok=true (HTTP 200)"
            fi
            ;;
        404)
            err "validate post-deploy HTTP 404 vía edge"
            err "El endpoint /api/admin/membership/validate NO responde a pesar del swap"
            err "y restart staggered exitosos. Posible: server.js no se cargó, módulo"
            err "membershipService no importado, ruta no registrada. NO rollback automático."
            err "Decisión humana: investigar logs api_X y decidir rollback (rollback-drill.sh)"
            err "o restore data desde backup BACKUP_TS=$BACKUP_TS (último recurso, manual)."
            exit 9
            ;;
        *)
            err "validate post-deploy HTTP=$post_validate_code (inesperado) vía edge"
            err "$(redact "$resp")"
            exit 9
            ;;
    esac

    # 3. Comparar counts
    if [ "$BASELINE_VALIDATE_RESP" = "BASELINE_ABSENT" ]; then
        log "  ℹ baseline pre-deploy ABSENT (primer deploy del operational stack);"
        log "    saltando comparación counts. Post-deploy ok=true es suficiente."
    elif command -v jq >/dev/null 2>&1; then
        local baseline_counts current_counts
        baseline_counts=$(echo "$BASELINE_VALIDATE_RESP" | jq -cS '.counts // {}' 2>/dev/null || echo "{}")
        current_counts=$(echo "$resp" | jq -cS '.counts // {}' 2>/dev/null || echo "{}")
        if [ "$baseline_counts" = "$current_counts" ]; then
            log "  ✓ counts == baseline"
        else
            warn "  ⚠ counts cambiaron entre pre- y post-deploy."
            warn "      baseline: $baseline_counts"
            warn "      current:  $current_counts"
            warn "  Causas POSIBLES (ordenadas por probabilidad):"
            warn "    1. Escrituras legítimas durante el deploy (lectores marcando"
            warn "       progreso, mediador asignando contenido). NORMAL si el delta"
            warn "       es pequeño (±5 entries) y consistente con tráfico vivo."
            warn "    2. El deploy introdujo lógica que afecta cómo se cuenta."
            warn "       INVESTIGAR si el delta es grande o no se explica."
            warn "    3. Drift estructural causado por el deploy. INVESTIGAR YA:"
            warn "         curl -sH 'x-admin-secret: \$SECRET' \\"
            warn "           '$PUBLIC_URL/api/admin/membership/validate' | jq .issues"
            warn "  Si caso 2 o 3: considerar rollback con scripts/rollback-drill.sh --execute"
            if [ "$ABORT_ON_WARN" = "1" ]; then exit 9; fi
        fi
    else
        warn "  ⚠ jq no disponible localmente — saltando comparación profunda de counts"
    fi

    DEPLOY_STATE="done"
    SUMMARY_LINES+=("B8 ✓  validate edge OK")
}

# ═════════════════════════════════════════════════════════════════════
# FASE B9 — Smoke logs + registro
# ═════════════════════════════════════════════════════════════════════
phase_b9() {
    CURRENT_PHASE="B9"
    phase "FASE B9 — Smoke logs + registro"

    if [ "$DRY_RUN" = "1" ]; then
        log "  [DRY-RUN] saltando smoke logs y registro"
        SUMMARY_LINES+=("B9 ⊘  saltado por --dry-run")
        return 0
    fi

    # Logs últimos 5 min: contar ERROR/SECURITY (sin bloquear si > 0)
    local bad
    bad=$(ssh_run "(docker logs --since 5m chibalete_api_1 2>&1; docker logs --since 5m chibalete_api_2 2>&1) | grep -cE 'ERROR|SECURITY' || true")
    if [ "${bad:-0}" -gt 0 ]; then
        warn "  ⚠ $bad líneas ERROR/SECURITY en últimos 5min — REVISAR manualmente"
        warn "    docker logs --since 5m chibalete_api_1 | grep -E 'ERROR|SECURITY'"
        # No abort: pueden ser pre-existentes no relacionadas
    else
        log "  ✓ logs últimos 5min: 0 ERROR/SECURITY"
    fi

    # Memoria actual (informativo)
    log "  → memoria api_1 / api_2:"
    ssh_run "docker stats --no-stream --format '    {{.Name}}: {{.MemUsage}}' chibalete_api_1 chibalete_api_2 2>/dev/null" || true

    # Registrar en /root/deploys.log
    local entry
    entry="$(ts_now) backend $RELEASE_TAG sha=$GIT_SHA actor=$ACTOR backup=$BACKUP_TS"
    ssh_run "echo '$entry' >> '$REMOTE_DEPLOY_LOG'"
    log "  ✓ deploys.log actualizado"

    SUMMARY_LINES+=("B9 ✓  registrado en $REMOTE_DEPLOY_LOG")
}

# ═════════════════════════════════════════════════════════════════════
# FASE B10 — Cleanup + summary
# ═════════════════════════════════════════════════════════════════════
phase_b10() {
    CURRENT_PHASE="B10"
    phase "FASE B10 — Cleanup remoto"

    if [ "$DRY_RUN" = "1" ]; then
        log "  [DRY-RUN] saltando cleanup"
        SUMMARY_LINES+=("B10 ⊘  saltado por --dry-run")
        return 0
    fi

    # Cleanup de tarball remoto (ya no se necesita)
    ssh_run "rm -f '$REMOTE_TARBALL'" || true
    log "  ✓ tarball remoto eliminado"

    # Cleanup de staging del propio deploy (ya extraído + mv'd; el dir
    # padre puede quedar con utils/ types/ residuales)
    ssh_run "rm -rf '$STAGING'" || true
    log "  ✓ staging dir eliminado"

    # Cleanup retention: server.old-* (conservar CLEANUP_KEEP_OLD = 3)
    # Critical: NO borrar el server.old-$BACKUP_TS recién creado (es nuestro rollback inmediato).
    log "  → retention server.old-* (keep $CLEANUP_KEEP_OLD)"
    ssh_run "
ls -1dt '$REMOTE_BASE'/server.old-* 2>/dev/null | tail -n +$((CLEANUP_KEEP_OLD + 1)) | while read -r d; do
    [ -d \"\$d\" ] && [ \"\$d\" != '$REMOTE_BASE/server.old-$BACKUP_TS' ] && rm -rf \"\$d\" && echo \"  removed \$d\"
done
" || warn "retention server.old-* tuvo issue (no crítico)"

    # Cleanup retention: utils.old-* — paralela a server.old-* (Sprint 022+)
    log "  → retention utils.old-* (keep $CLEANUP_KEEP_OLD)"
    ssh_run "
ls -1dt '$REMOTE_BASE'/utils.old-* 2>/dev/null | tail -n +$((CLEANUP_KEEP_OLD + 1)) | while read -r d; do
    [ -d \"\$d\" ] && [ \"\$d\" != '$REMOTE_BASE/utils.old-$BACKUP_TS' ] && rm -rf \"\$d\" && echo \"  removed \$d\"
done
" || warn "retention utils.old-* tuvo issue (no crítico)"

    # Cleanup retention: server.staging-* residuales (de runs fallidos previos)
    log "  → retention server.staging-* residuales (keep $CLEANUP_KEEP_STAGING)"
    ssh_run "
ls -1dt '$REMOTE_BASE'/server.staging-* 2>/dev/null | tail -n +$((CLEANUP_KEEP_STAGING + 1)) | while read -r d; do
    [ -d \"\$d\" ] && rm -rf \"\$d\" && echo \"  removed \$d\"
done
" || warn "retention server.staging-* tuvo issue (no crítico)"

    # Cleanup retention: server.failed-* (forensics, conservar CLEANUP_KEEP_FAILED)
    log "  → retention server.failed-* (keep $CLEANUP_KEEP_FAILED para forensics)"
    ssh_run "
ls -1dt '$REMOTE_BASE'/server.failed-* 2>/dev/null | tail -n +$((CLEANUP_KEEP_FAILED + 1)) | while read -r d; do
    [ -d \"\$d\" ] && rm -rf \"\$d\" && echo \"  removed \$d\"
done
" || warn "retention server.failed-* tuvo issue (no crítico)"

    # Cleanup retention: utils.failed-* — paralela a server.failed-* (Sprint 022+)
    log "  → retention utils.failed-* (keep $CLEANUP_KEEP_FAILED)"
    ssh_run "
ls -1dt '$REMOTE_BASE'/utils.failed-* 2>/dev/null | tail -n +$((CLEANUP_KEEP_FAILED + 1)) | while read -r d; do
    [ -d \"\$d\" ] && rm -rf \"\$d\" && echo \"  removed \$d\"
done
" || warn "retention utils.failed-* tuvo issue (no crítico)"

    SUMMARY_LINES+=("B10 ✓  cleanup completado")
}

# ═════════════════════════════════════════════════════════════════════
# ROLLBACK
# Restaura server.old-$BACKUP_TS, restart staggered según DEPLOY_STATE.
# JAMÁS toca data/ ni data-critical/.
# ═════════════════════════════════════════════════════════════════════
rollback_code() {
    local reason="$1"
    err ""
    err "═════ ROLLBACK INICIADO ═════"
    err "  razón: $reason"
    err "  estado: DEPLOY_STATE=$DEPLOY_STATE"
    err "  backup: BACKUP_TS=$BACKUP_TS"

    # Snapshot del server + utils fallidos para forensics
    if ssh_run "test -d '$REMOTE_BASE/server'"; then
        ssh_run "mv '$REMOTE_BASE/server' '$REMOTE_BASE/server.failed-$BACKUP_TS'" \
            || warn "no se pudo renombrar server fallido (continuar)"
    fi
    if ssh_run "test -d '$REMOTE_BASE/utils'"; then
        ssh_run "mv '$REMOTE_BASE/utils' '$REMOTE_BASE/utils.failed-$BACKUP_TS' 2>/dev/null" \
            || true
    fi

    # Restaurar server VIEJO (si existe)
    if ssh_run "test -d '$REMOTE_BASE/server.old-$BACKUP_TS'"; then
        if ! ssh_run "mv '$REMOTE_BASE/server.old-$BACKUP_TS' '$REMOTE_BASE/server' && test -s '$REMOTE_BASE/server/server.js'"; then
            err "🔴 ROLLBACK FAILED — server.old-$BACKUP_TS no se pudo restaurar"
            err "  ssh $VPS_HOST 'ls -la $REMOTE_BASE/'"
            err "ESCALAR INMEDIATAMENTE."
            ssh_run "echo '$(ts_now) ROLLBACK-FAILED backend $RELEASE_TAG actor=$ACTOR reason=$reason' >> '$REMOTE_DEPLOY_LOG'" || true
            exit 99
        fi
        err "  ✓ server VIEJO restaurado desde server.old-$BACKUP_TS"

        # Restaurar utils VIEJO si existe (Sprint 022+ con bind mount).
        # Si no existe utils.old-$BACKUP_TS = pre-Sprint-022 (no había utils
        # en la posición operativa); aceptable porque server viejo no lo usa.
        if ssh_run "test -d '$REMOTE_BASE/utils.old-$BACKUP_TS'"; then
            if ssh_run "mv '$REMOTE_BASE/utils.old-$BACKUP_TS' '$REMOTE_BASE/utils'"; then
                err "  ✓ utils VIEJO restaurado desde utils.old-$BACKUP_TS"
            else
                warn "  ⚠ no se pudo restaurar utils.old-$BACKUP_TS (no crítico:"
                warn "    server VIEJO no importa de utils/, utils nuevo queda swap-failed)"
            fi
        else
            err "  ℹ utils.old-$BACKUP_TS no existe — pre-Sprint-022 baseline (OK)"
        fi
    else
        err "🔴 server.old-$BACKUP_TS NO EXISTE — rollback imposible automático"
        err "ESCALAR INMEDIATAMENTE. Posibles caminos:"
        err "  1) restaurar desde backup tar: $REMOTE_BACKUP_BASE/$BACKUP_TS/server.tar.gz"
        err "  2) checkout previo: cd $REMOTE_BASE/server && git checkout <SHA_PREVIO>"
        ssh_run "echo '$(ts_now) ROLLBACK-FAILED backend $RELEASE_TAG actor=$ACTOR reason=$reason no-server-old' >> '$REMOTE_DEPLOY_LOG'" || true
        exit 99
    fi

    # Restart staggered de las instancias que ya tenían código nuevo
    case "$DEPLOY_STATE" in
        api1_new|api2_new|swapped)
            err "  → restart staggered api_1 hacia código VIEJO"
            ssh_run "docker stop chibalete_api_1 --time=30 >/dev/null && docker start chibalete_api_1 >/dev/null"
            if ! poll_internal_health chibalete_api_1 "$HEALTH_TIMEOUT_S"; then
                err "🔴 api_1 NO healthy con código VIEJO post-rollback. ESCALAR."
                exit 99
            fi
            err "  ✓ api_1 restaurado a código VIEJO"
            ;;
    esac

    if [ "$DEPLOY_STATE" = "api2_new" ]; then
        err "  → restart staggered api_2 hacia código VIEJO"
        ssh_run "docker stop chibalete_api_2 --time=30 >/dev/null && docker start chibalete_api_2 >/dev/null"
        if ! poll_internal_health chibalete_api_2 "$HEALTH_TIMEOUT_S"; then
            err "🔴 api_2 NO healthy con código VIEJO post-rollback. ESCALAR."
            exit 99
        fi
        err "  ✓ api_2 restaurado a código VIEJO"
    fi

    # Validate post-rollback (informativo, no bloqueante en este punto)
    local resp
    resp=$(printf 'header = "x-admin-secret: %s"\n' "$ADMIN_SECRET" \
        | curl -sS --max-time 30 \
            --config - \
            "$PUBLIC_URL/api/admin/membership/validate" 2>/dev/null || echo "")
    if json_ok_true "$resp"; then
        err "  ✓ validate post-rollback ok=true — código antiguo restaurado limpio"
    else
        err "  ⚠ validate post-rollback ok=false"
        err "    POSIBLE corrupción de data durante el deploy fallido."
        err "    Decisión humana: aceptar o restore data desde backup."
        err "    Ver §15 PASO RB.5 del deployment_guide.md."
    fi

    # Registrar el rollback
    ssh_run "echo '$(ts_now) ROLLBACK backend $RELEASE_TAG → $BACKUP_TS reason=$reason actor=$ACTOR' >> '$REMOTE_DEPLOY_LOG'" || true

    err ""
    err "ROLLBACK CÓDIGO completado. data/ NO modificado."
    err "server.failed-$BACKUP_TS preservado para forensics."
    err "═════ FIN ROLLBACK ═════"
}

# ═════════════════════════════════════════════════════════════════════
# SUMMARY FINAL
# ═════════════════════════════════════════════════════════════════════
print_summary() {
    local exit_code="${1:-?}"
    # Suprimir summary si parse_args no completó (--help, args inválidos).
    # Ese caso no es un "deploy" — sólo CLI. Imprimir el banner sería
    # engañoso (ej. "✅ DEPLOY BACKEND EXITOSO" en exit de --help).
    if [ -z "$RELEASE_TAG" ]; then
        return 0
    fi
    local elapsed=$(( $(date +%s) - START_EPOCH ))
    echo ""
    echo "╔═════════════════════════════════════════════════════════════════╗"
    if [ "$exit_code" = "0" ]; then
        echo "║                  ✅ DEPLOY BACKEND EXITOSO                       ║"
    elif [ "$exit_code" = "10" ]; then
        echo "║          ⚠️  DEPLOY OK con warnings (logs/registro)             ║"
    elif [ "$exit_code" = "11" ]; then
        echo "║              🔒  LOCK NO ADQUIRIDO                               ║"
    elif [ "$exit_code" = "12" ]; then
        echo "║              ⏰  TIMEOUT GLOBAL                                   ║"
    elif [ "$exit_code" = "99" ]; then
        echo "║         🔴  ROLLBACK FALLIDO — ESCALAR INMEDIATAMENTE            ║"
    else
        echo "║              ❌ DEPLOY ABORTADO                                   ║"
    fi
    echo "╠═════════════════════════════════════════════════════════════════╣"
    printf "║ release_tag: %-49s ║\n" "${RELEASE_TAG:-<none>}"
    printf "║ git_sha:     %-49s ║\n" "${GIT_SHA:-<none>}"
    printf "║ actor:       %-49s ║\n" "${ACTOR:-<none>}"
    printf "║ backup_ts:   %-49s ║\n" "${BACKUP_TS:-<none>}"
    printf "║ state:       %-49s ║\n" "$DEPLOY_STATE"
    # failed_at: visible sólo si fallamos. CURRENT_PHASE indica la fase
    # exacta donde el script se detuvo (B0..B10). Operador cansado lo lee
    # antes de buscar en logs.
    if [ "$exit_code" != "0" ]; then
        printf "║ failed_at:   %-49s ║\n" "${CURRENT_PHASE:-(antes de fases)}"
    fi
    printf "║ exit_code:   %-49s ║\n" "$exit_code"
    printf "║ elapsed:     %-49s ║\n" "${elapsed}s"
    echo "╠═════════════════════════════════════════════════════════════════╣"
    if [ "${#SUMMARY_LINES[@]}" -gt 0 ]; then
        for line in "${SUMMARY_LINES[@]}"; do
            printf "║ %-63s ║\n" "$line"
        done
    fi
    echo "╚═════════════════════════════════════════════════════════════════╝"

    # ─────────────────────────────────────────────────────────────────
    # SIGUIENTE ACCIÓN — guía explícita por exit code para reducir la
    # carga cognitiva del operador (especialmente cansado / 3am).
    # No reemplaza el runbook; lo complementa con un puntero literal.
    # ─────────────────────────────────────────────────────────────────
    case "$exit_code" in
        1|2|3|4|5)
            echo ""
            echo " SIGUIENTE ACCIÓN: nada se modificó en VPS. El fallo fue antes"
            echo "                   del swap atómico (B5)."
            echo "                   1) Investigar el error arriba"
            echo "                   2) Fix en local"
            echo "                   3) Re-correr este mismo comando con MISMO --release-tag"
            ;;
        6)
            echo ""
            echo " 🔴 SIGUIENTE ACCIÓN: ESTADO INCIERTO en VPS. Recovery MANUAL:"
            echo "    Inspeccionar:"
            echo "      ssh $VPS_HOST 'ls -la $REMOTE_BASE/'"
            echo "    Si server/ ausente, restaurar:"
            echo "      ssh $VPS_HOST \"cd $REMOTE_BASE && OLD=\\\$(ls -1dt server.old-* | head -1) && mv \\\"\\\$OLD\\\" server\""
            echo "    Luego restart staggered manual: runbook §10.1"
            ;;
        7|8)
            echo ""
            echo " SIGUIENTE ACCIÓN: rollback automático COMPLETADO."
            echo "    server/ VIEJO restaurado, api_X reiniciados."
            echo "    1) Investigar por qué falló:"
            echo "         ssh $VPS_HOST 'docker logs --tail 200 chibalete_api_1'"
            echo "         ssh $VPS_HOST 'ls -1dt $REMOTE_BASE/server.failed-* | head -1'"
            echo "    2) Fix code"
            echo "    3) Re-deploy con tag NUEVO (no el mismo)"
            ;;
        9)
            echo ""
            echo " ⚠️  SIGUIENTE ACCIÓN: DECISIÓN HUMANA — runbook §7."
            echo "    El código nuevo PUEDE estar bien; el drift PUEDE ser de data."
            echo "    NO se ejecutó rollback automático."
            echo "    1) Inspeccionar issues:"
            echo "         curl -sH \"x-admin-secret: \$ADMIN_SECRET\" \\"
            echo "           $PUBLIC_URL/api/admin/membership/validate | jq .issues"
            echo "    2) Si decides que el deploy es la causa:"
            echo "         bash scripts/rollback-drill.sh --execute"
            ;;
        11)
            echo ""
            echo " SIGUIENTE ACCIÓN: lock activo en VPS. Coordinar con el otro operador."
            echo "    Si confirmado orphan (kill -9 previo, no hay deploy real corriendo):"
            echo "      ssh $VPS_HOST \"rm -rf $REMOTE_LOCK_DIR\""
            ;;
        12)
            echo ""
            echo " 🔴 SIGUIENTE ACCIÓN: watchdog disparó (timeout ${GLOBAL_TIMEOUT_S}s)."
            echo "    Verificar estado VPS antes de re-correr:"
            echo "      ssh $VPS_HOST 'ls -la $REMOTE_BASE/'"
            echo "    Si lock orphan:"
            echo "      ssh $VPS_HOST 'rm -rf $REMOTE_LOCK_DIR'"
            echo "    Si server/ ausente: recovery manual runbook §10.1"
            ;;
        99)
            echo ""
            echo " 🔴🔴 ESCALAR INMEDIATAMENTE — rollback automático FALLÓ."
            echo "    Inspeccionar:  ssh $VPS_HOST 'ls -la $REMOTE_BASE/'"
            echo "    Posibles caminos:"
            echo "      a) extraer server.tar.gz del backup más reciente:"
            echo "         ssh $VPS_HOST 'ls -1dt $REMOTE_BACKUP_BASE/'"
            echo "         ssh $VPS_HOST 'tar -xzf <BACKUP>/server.tar.gz -C /tmp/recovery/'"
            echo "      b) checkout previo de git en /var/www/chibalete/server"
            echo "      c) NO restaurar data automáticamente; runbook §15 RB.5"
            ;;
    esac

    # Hints útiles según outcome (success path mantiene su mensaje extenso)
    if [ "$exit_code" = "0" ]; then
        echo ""
        echo " ⚠️  MONITORING WINDOW — NO cerrar esta sesión por al menos 30 min."
        echo "    Los containers acaban de reiniciar; cualquier crash latente o"
        echo "    memory-leak nuevo aparece típicamente en los primeros 5–15 min."
        echo ""
        echo "    Comandos para vigilar (en otra terminal):"
        echo "      ssh $VPS_HOST 'docker logs --since 1m -f chibalete_api_1' \\"
        echo "        | grep -iE 'error|warn|exception'"
        echo "      ssh $VPS_HOST 'docker logs --since 1m -f chibalete_api_2' \\"
        echo "        | grep -iE 'error|warn|exception'"
        echo ""
        echo "      curl -s $PUBLIC_URL/api/health | head -1   # spot-check periódico"
        echo ""
        echo " Smoke manual recomendado (deployment_guide.md §19.2 + runbook §5):"
        echo "   - Smoke A: assignTeacherToGroup → mediador ve grupo nuevo"
        echo "   - Smoke B: edits cross-admin → checkboxes correctos"
        echo "   - Smoke C: deleteGroup → no aparece en form"
        echo "   - Smoke D: deleteUser → no aparece como huérfano"
        echo ""
        echo " Si en los próximos 30 min ves algo raro:"
        echo "   bash scripts/rollback-drill.sh             # discovery primero"
        echo "   bash scripts/rollback-drill.sh --execute    # rollback real"
        echo "   (server.old-$BACKUP_TS preservado 7 días)"
    fi
}

# ═════════════════════════════════════════════════════════════════════
# MAIN
# ═════════════════════════════════════════════════════════════════════
main() {
    parse_args "$@"
    load_secrets

    # Setup directorios y watchdog
    mkdir -p "$SSH_CM_DIR"
    chmod 700 "$SSH_CM_DIR" 2>/dev/null || true
    start_watchdog

    log "Chibalete+ deploy-backend.sh — inicio"
    log "  RELEASE_TAG = $RELEASE_TAG"
    log "  ACTOR       = $ACTOR"
    log "  VPS_HOST    = $VPS_HOST"
    log "  DRY_RUN     = $DRY_RUN"
    log "  TIMEOUT     = ${GLOBAL_TIMEOUT_S}s"

    # Lock antes de cualquier cosa que toque VPS
    if [ "$DRY_RUN" = "0" ]; then
        acquire_lock
    else
        log "  [DRY-RUN] saltando adquisición de lock"
    fi

    phase_b0
    phase_b1
    phase_b2
    phase_b3
    phase_b4
    phase_b5
    phase_b6
    phase_b7
    phase_b8
    phase_b9
    phase_b10

    ok "DEPLOY EXITOSO"
    exit 0
}

# Guard de testing: la suite mock (scripts/__test__/deploy-backend-mocked.sh)
# sourcea este script para invocar funciones internas (json_ok_true,
# phase_b1, etc.) sin disparar la ejecución completa. Producción no setea
# esta env var → main corre normal.
if [ "${DEPLOY_BACKEND_TEST_NO_MAIN:-0}" != "1" ]; then
    main "$@"
fi
