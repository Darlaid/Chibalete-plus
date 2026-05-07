#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# ROLLBACK — VisorTexto MessageCircle deploy 2026-05-01
#
# Restaura la imagen anterior (chibalete/front:2026-04-27-album-fix)
# usando el último backup .bak-* generado por el deploy script.
#
# NO toca: edge, api_1, api_2, data, data-critical, uploads.
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────
OLD_TAG="chibalete/front:2026-04-27-album-fix"
NEW_TAG="chibalete/front:2026-05-01-messagecircle-import"
VPS="root@72.60.158.97"
COMPOSE="/opt/chibaleteplus/docker-compose.yml"

log()  { echo "[$(date +%H:%M:%S)] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

trap 'fail "Rollback ABORTADO en línea $LINENO"' ERR

log "ROLLBACK iniciado — restaurar $OLD_TAG"

ssh "$VPS" bash -s <<EOF_ROLLBACK
set -euo pipefail
COMPOSE="${COMPOSE}"
OLD_TAG="${OLD_TAG}"
NEW_TAG="${NEW_TAG}"
TS=\$(date +%Y%m%d-%H%M%S)

# 1. Verificar que la imagen vieja sigue cargada en disco
echo "[VPS] verificar imagen vieja \$OLD_TAG existe localmente"
docker image inspect "\$OLD_TAG" >/dev/null || \
  { echo "[VPS][ERROR] imagen vieja NO existe — rollback IMPOSIBLE."; exit 1; }
echo "[VPS]   ✓ imagen vieja disponible"

# 2. Encontrar último backup
BAK=\$(ls -t \${COMPOSE}.bak-* 2>/dev/null | head -1 || true)
[ -n "\$BAK" ] || { echo "[VPS][ERROR] no se encontró backup \${COMPOSE}.bak-*"; exit 1; }
echo "[VPS] backup más reciente: \$BAK"

# 3. Verificar backup contiene OLD_TAG
grep -q "image: \$OLD_TAG" "\$BAK" || \
  { echo "[VPS][ERROR] backup \$BAK NO referencia \$OLD_TAG"; exit 1; }
echo "[VPS]   ✓ backup contiene \$OLD_TAG"

# 4. Snapshot del estado actual antes de revertir (por si hay que post-mortem)
FAILED_STATE="\${COMPOSE}.failed-\${TS}"
cp -p "\$COMPOSE" "\$FAILED_STATE"
echo "[VPS] estado actual guardado en \$FAILED_STATE"

# 5. Restaurar
cp -p "\$BAK" "\$COMPOSE"
echo "[VPS]   ✓ compose restaurado desde \$BAK"

# 6. Verificar contenido del compose
grep -q "image: \$OLD_TAG" "\$COMPOSE" || \
  { echo "[VPS][ERROR] compose restaurado NO contiene \$OLD_TAG"; exit 1; }
if grep -q "image: \$NEW_TAG" "\$COMPOSE"; then
  echo "[VPS][ERROR] compose restaurado AÚN contiene \$NEW_TAG"; exit 1
fi
echo "[VPS]   ✓ compose validado"

# 7. Recreate front (--no-deps protege backend y edge)
echo "[VPS] docker compose up -d --no-deps front"
cd /opt/chibaleteplus
docker compose up -d --no-deps front

# 8. Verificar imagen actual del contenedor
sleep 2
RUNNING_IMG=\$(docker inspect chibalete_front --format '{{.Config.Image}}' 2>/dev/null || echo "")
[ "\$RUNNING_IMG" = "\$OLD_TAG" ] || \
  { echo "[VPS][ERROR] chibalete_front corre con \$RUNNING_IMG, esperado \$OLD_TAG"; exit 1; }
echo "[VPS]   ✓ chibalete_front corriendo con \$OLD_TAG"

# 9. CRÍTICO: esperar front listo + reload edge (mismo motivo
#    que en deploy: nginx upstream tiene IP cacheada).
echo "[VPS] esperando que front responda (max 15s)..."
READY=0
for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
  if docker exec chibalete_edge sh -c 'wget -q -O /dev/null --tries=1 --timeout=1 http://chibalete_front:80/ && echo OK' 2>/dev/null | grep -q OK; then
    READY=1
    echo "[VPS]   ✓ front listo en intento \$i"
    break
  fi
  sleep 1
done
[ "\$READY" = "1" ] || { echo "[VPS][ERROR] front no respondió en 15s"; exit 1; }

echo "[VPS] reload de edge nginx..."
docker exec chibalete_edge nginx -t 2>&1 || \
  { echo "[VPS][ERROR] nginx -t falló en edge"; exit 1; }
docker exec chibalete_edge nginx -s reload
echo "[VPS]   ✓ edge reloaded"

docker ps --filter name=chibalete_front --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
EOF_ROLLBACK

log "Verificando endpoint público..."

ssh "$VPS" bash -s <<'EOF_VAL'
set +e
URL="https://chibaleteplus.chibaleteeditores.com"
echo "[VAL] HTTP /"
curl -sI -m 5 "$URL/" | head -3
echo
echo "[VAL] containers"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | grep chibalete
EOF_VAL

log ""
log "═══════════════════════════════════════════════════"
log "ROLLBACK COMPLETO."
log ""
log "Verificación manual:"
log "  1. Abrir https://chibaleteplus.chibaleteeditores.com en hard reload"
log "  2. Confirmar que el sitio carga (vuelve al estado pre-deploy)"
log ""
log "El bug original (MessageCircle ReferenceError) volverá a estar"
log "presente. Revisar logs del deploy fallido en el VPS:"
log "  ${COMPOSE}.failed-* (estado fallido guardado)"
log "═══════════════════════════════════════════════════"
