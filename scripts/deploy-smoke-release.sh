#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# Chibalete+ — Smoke Release Helper
# Sprint 022 / Fase 2B.8
#
# OBJETIVO:
#   Preparar un "smoke release" — un cambio MÍNIMO INOCUO en el código
#   backend cuya única función es ejercitar TODO el pipeline operacional
#   construido en Sprint 022:
#
#     deploy-backend.sh → backup-vps.sh → swap → restart staggered →
#     validate aislado → validate edge → /api/health → .deploy-info →
#     deploys.log → cleanup retention
#
#   La premisa fundacional:
#     "El primer deploy productivo NO debe estar probando lógica de negocio.
#      Debe estar probando que la infraestructura operacional realmente
#      sobrevive operación real."
#
# QUÉ HACE EXACTAMENTE:
#   1. Genera un RELEASE_TAG nuevo (auto-numerado por fecha)
#   2. Actualiza un único archivo: server/.release-marker
#      (texto plano, NO leído por código de runtime — sólo evidencia humana)
#   3. Stage + commit con mensaje convencional
#   4. Imprime los próximos pasos manuales que el operador debe ejecutar
#      (verify, deploy, post-deploy verification)
#
# QUÉ NO HACE:
#   - NO toca server/server.js ni ningún archivo de lógica
#   - NO ejecuta deploy-backend.sh (esa es decisión separada del operador)
#   - NO sube nada al VPS
#   - NO modifica datos
#
# POR QUÉ server/.release-marker (y no otro archivo):
#   - Vive en server/ → entra en el tarball que deploy-backend.sh empaqueta
#   - NO es leído por código (cero riesgo de side-effect)
#   - Es plain text → cero riesgo de parse error
#   - Cada smoke release lo SOBREESCRIBE → no acumula histórico en repo
#   - Un humano puede `cat server/.release-marker` post-deploy y verificar
#     visualmente qué release está activo
#
# Uso:
#   bash scripts/deploy-smoke-release.sh                 # genera tag automático
#   bash scripts/deploy-smoke-release.sh --tag rel-...   # tag explícito
#   bash scripts/deploy-smoke-release.sh --dry-run       # imprime plan, no commit
#
# Exit codes:
#   0  → marker actualizado y commiteado, próximos pasos impresos
#   1  → working tree dirty (no toleramos commits desordenados pre-deploy)
#   2  → tag colisiona con uno existente sin --force-tag
#   3  → archivo de cambio no es coherente
# ─────────────────────────────────────────────────────────────────────

set -Eeuo pipefail

# ── Config ────────────────────────────────────────────────────────────
MARKER_FILE="server/.release-marker"
TAG_PREFIX="rel-$(date -u +%Y-%m-%d)-smoke"

# ── Args ──────────────────────────────────────────────────────────────
RELEASE_TAG=""
DRY_RUN=0
FORCE_TAG=0
NOTES=""

while [ $# -gt 0 ]; do
    case "$1" in
        --tag|--release-tag) RELEASE_TAG="$2"; shift 2 ;;
        --dry-run)           DRY_RUN=1; shift ;;
        --force-tag)         FORCE_TAG=1; shift ;;
        --notes)             NOTES="$2"; shift 2 ;;
        -h|--help)
            cat <<EOF
Uso: bash scripts/deploy-smoke-release.sh [opciones]

OPCIONES:
  --tag <TAG>      Release tag explícito (formato rel-YYYY-MM-DD-<slug>).
                   Si se omite, se genera automáticamente: $TAG_PREFIX-NNN
  --notes <TEXT>   Texto libre que se incluye en el marker (max 200 chars)
  --dry-run        Imprime plan sin escribir ni commitear
  --force-tag      Permite reusar un tag git existente (uso excepcional)
  -h, --help       Esta ayuda

EJEMPLO:
  bash scripts/deploy-smoke-release.sh --notes "smoke 1: validar pipeline"

DESPUÉS DE ESTE SCRIPT EJECUTAR (orden estricto):
  1. npm run verify
  2. npm run validate:local
  3. bash scripts/deploy-backend.sh --release-tag <TAG_GENERADO>
  4. Verificar /api/health.commit y /api/health.version coinciden con TAG
  5. Verificar /var/www/chibalete/server/.release-marker en VPS
EOF
            exit 0
            ;;
        *) echo "Argumento desconocido: $1" >&2; exit 1 ;;
    esac
done

# ── Helpers ───────────────────────────────────────────────────────────
log()  { echo "[$(date -u +%H:%M:%SZ)] $*"; }
warn() { echo "[$(date -u +%H:%M:%SZ)] [WARN] $*" >&2; }
fail() { echo "[$(date -u +%H:%M:%SZ)] [ERROR] $*" >&2; exit "${2:-1}"; }

# ── Generar tag automático si no se dio uno ──────────────────────────
auto_generate_tag() {
    # Buscar tags git que coincidan con el prefijo del día y elegir el siguiente
    local n=1
    while git tag -l "${TAG_PREFIX}-$(printf '%03d' "$n")" 2>/dev/null | grep -qF "${TAG_PREFIX}-$(printf '%03d' "$n")"; do
        n=$((n + 1))
    done
    echo "${TAG_PREFIX}-$(printf '%03d' "$n")"
}

if [ -z "$RELEASE_TAG" ]; then
    RELEASE_TAG="$(auto_generate_tag)"
    log "RELEASE_TAG auto-generado: $RELEASE_TAG"
else
    log "RELEASE_TAG provisto: $RELEASE_TAG"
fi

# ── Validar formato del tag (mismo regex que deploy-backend.sh) ──────
if ! [[ "$RELEASE_TAG" =~ ^rel-[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-z0-9-]+$ ]]; then
    fail "RELEASE_TAG no sigue convención rel-YYYY-MM-DD-<slug-kebab>: $RELEASE_TAG"
fi

# ── Validar working tree limpio (B0 lo va a re-validar después) ──────
DIRTY_FILES=$(git status --porcelain | grep -v "^?? " | grep -v "$MARKER_FILE" || true)
if [ -n "$DIRTY_FILES" ]; then
    fail "working tree tiene cambios NO relacionados con $MARKER_FILE:
$DIRTY_FILES

Stash o commit primero. El smoke release exige que sea el ÚNICO cambio."
fi

# ── Validar tag git no colisiona ──────────────────────────────────────
if git tag -l "$RELEASE_TAG" | grep -qF "$RELEASE_TAG"; then
    if [ "$FORCE_TAG" = "1" ]; then
        warn "tag git '$RELEASE_TAG' ya existe — proceder con --force-tag"
    else
        fail "tag git '$RELEASE_TAG' ya existe. Usar --force-tag o cambiar tag." 2
    fi
fi

# ── Capturar SHA actual para metadata del marker ─────────────────────
GIT_SHA="$(git rev-parse --short HEAD)"
GIT_SHA_FULL="$(git rev-parse HEAD)"
ACTOR="$(git config user.email 2>/dev/null || echo unknown)"
GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# Truncar notes si es muy largo (sanity)
if [ -n "$NOTES" ] && [ "${#NOTES}" -gt 200 ]; then
    NOTES="${NOTES:0:200}…"
fi
[ -z "$NOTES" ] && NOTES="smoke release operacional Sprint 022"

# ── Construir contenido del marker ────────────────────────────────────
MARKER_CONTENT=$(cat <<EOF
# Chibalete+ — server/.release-marker
# Generado por scripts/deploy-smoke-release.sh — NO editar a mano.
# Plain text. NO leído por código de runtime — sólo evidencia humana.
# Cada smoke release sobreescribe este archivo.
release_tag=$RELEASE_TAG
git_sha=$GIT_SHA_FULL
parent_sha=$GIT_SHA
actor=$ACTOR
generated_at=$GENERATED_AT
notes=$NOTES
EOF
)

# ── Imprimir plan ────────────────────────────────────────────────────
log ""
log "─────────────────────────────────────────────────"
log " PLAN smoke release"
log "─────────────────────────────────────────────────"
log " RELEASE_TAG  : $RELEASE_TAG"
log " GIT_SHA      : $GIT_SHA"
log " ACTOR        : $ACTOR"
log " GENERATED_AT : $GENERATED_AT"
log " NOTES        : $NOTES"
log " MARKER_FILE  : $MARKER_FILE"
log "─────────────────────────────────────────────────"
log ""
log "Contenido nuevo de $MARKER_FILE:"
echo "$MARKER_CONTENT" | sed 's/^/    /'
log ""

if [ "$DRY_RUN" = "1" ]; then
    log "[DRY-RUN] saltando escritura y commit"
    exit 0
fi

# ── Escribir archivo ─────────────────────────────────────────────────
mkdir -p "$(dirname "$MARKER_FILE")"
echo "$MARKER_CONTENT" > "$MARKER_FILE"
log "  ✓ $MARKER_FILE escrito"

# ── Stage + commit ───────────────────────────────────────────────────
git add "$MARKER_FILE"

# Mensaje de commit alineado con convención del repo
COMMIT_MSG="chore(release): $RELEASE_TAG smoke release marker

Sprint 022 Fase 2B.8 — smoke release operacional.
Cambio inocuo en server/.release-marker para ejercitar el pipeline:
deploy-backend.sh → backup → swap → restart staggered → validate.

NO afecta lógica de negocio.

generated_at=$GENERATED_AT
parent_sha=$GIT_SHA
notes=$NOTES"

if ! git commit -m "$COMMIT_MSG" >/dev/null; then
    fail "git commit falló (posiblemente nada que commitear si marker no cambió)"
fi
NEW_SHA="$(git rev-parse --short HEAD)"
log "  ✓ commit creado: $NEW_SHA"

# ── Próximos pasos ────────────────────────────────────────────────────
cat <<EOF

╔══════════════════════════════════════════════════════════════════╗
║  ✅ SMOKE RELEASE PREPARADO                                       ║
╚══════════════════════════════════════════════════════════════════╝

Próximos pasos OBLIGATORIOS (orden estricto):

1.  Validar local antes de tocar VPS:
      npm run verify
      npm run validate:local

2.  Confirmar baseline en producción:
      curl -s https://chibaleteplus.chibaleteeditores.com/api/health \\
        | grep -E 'commit|version'
      curl -sH "x-admin-secret: \$ADMIN_SECRET" \\
        https://chibaleteplus.chibaleteeditores.com/api/admin/membership/validate \\
        | grep -E '"ok"|counts'

3.  (Opcional) Push a origin para trazabilidad:
      git push origin HEAD

4.  Deploy:
      bash scripts/deploy-backend.sh --release-tag $RELEASE_TAG

5.  Verificación POST-deploy (5 puntos críticos):
      a) /api/health.commit         debe ser $GIT_SHA_FULL
      b) /api/health.version        debe ser $RELEASE_TAG
      c) /api/health.deployed_at    debe ser ~ahora
      d) /api/admin/membership/validate ok=true (counts coincide con baseline)
      e) ssh root@72.60.158.97 "cat /var/www/chibalete/server/.release-marker"
         → debe coincidir con el commiteado arriba

6.  Si TODO OK → smoke release exitoso. Sprint 022 validado operacionalmente.
    Si CUALQUIERA falla → rollback inmediato:
      bash scripts/rollback-drill.sh --execute

EOF
