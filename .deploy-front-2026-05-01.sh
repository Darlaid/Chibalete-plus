#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────
# HOTFIX DEPLOY — VisorTexto MessageCircle import
# Fecha: 2026-05-01
# Commit: 7767c4f (fix(VisorTexto): import MessageCircle from lucide-react)
#
# Topología (auditada):
#   - Compose real:  /opt/chibaleteplus/docker-compose.yml
#   - Container:     chibalete_front (sin mounts; bundle en imagen)
#   - Edge:          chibalete_edge (NO se toca)
#   - API pool:      chibalete_api_1 / chibalete_api_2 (NO se tocan)
#   - Data:          /var/www/chibalete (NO se toca)
# ─────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Config ───────────────────────────────────────────────────────────
RELEASE="rel-2026-05-01-visortexto-messagecircle-import"
NEW_TAG="chibalete/front:2026-05-01-messagecircle-import"
OLD_TAG="chibalete/front:2026-04-27-album-fix"
EXPECTED_COMMIT="7767c4f"
VPS="root@72.60.158.97"
COMPOSE="/opt/chibaleteplus/docker-compose.yml"

# ── Helpers ──────────────────────────────────────────────────────────
log()  { echo "[$(date +%H:%M:%S)] $*"; }
fail() { echo "[ERROR] $*" >&2; exit 1; }

trap 'fail "Deploy ABORTED en línea $LINENO"' ERR

# ─────────────────────────────────────────────────────────────────────
# FASE 1 — PRE-FLIGHT LOCAL
# ─────────────────────────────────────────────────────────────────────
log "FASE 1: pre-flight local"

HEAD_SHA=$(git rev-parse --short HEAD)
[ "$HEAD_SHA" = "$EXPECTED_COMMIT" ] || \
  fail "HEAD=$HEAD_SHA, esperado $EXPECTED_COMMIT. Checkout hotfix/visortexto-messagecircle-import primero."
log "  ✓ HEAD = $HEAD_SHA"

[ -z "$(git status --porcelain pages/VisorTexto.tsx Dockerfile.front nginx.prod.conf 2>&1)" ] || \
  fail "Hay cambios sin commitear en archivos críticos. Commitear o stash antes."
log "  ✓ Working tree limpio en archivos críticos"

grep -q "MessageCircle.*from 'lucide-react'" pages/VisorTexto.tsx || \
  fail "MessageCircle NO está en el import de pages/VisorTexto.tsx"
log "  ✓ Import MessageCircle presente en pages/VisorTexto.tsx"

for f in Dockerfile.front nginx.prod.conf package.json package-lock.json index.html index.tsx App.tsx; do
  [ -f "$f" ] || fail "Archivo requerido falta: $f"
done
log "  ✓ Archivos requeridos presentes"

# ─────────────────────────────────────────────────────────────────────
# FASE 2 — EMPAQUETAR SOURCE
# ─────────────────────────────────────────────────────────────────────
log "FASE 2: empaquetar source"

TARBALL="/tmp/${RELEASE}.tgz"
rm -f "$TARBALL"

tar --exclude=node_modules \
    --exclude=dist \
    --exclude=.git \
    --exclude=data \
    --exclude='public/uploads' \
    --exclude='*.log' \
    --exclude='_prod_snapshot_' \
    --exclude='deployment_package' \
    -czf "$TARBALL" \
    Dockerfile.front nginx.prod.conf \
    package.json package-lock.json \
    index.html index.tsx index.css App.tsx metadata.json \
    vite.config.ts tsconfig.json \
    pages components context hooks services types utils config engines public

[ -f "$TARBALL" ] || fail "Tarball no generado"
log "  ✓ $(ls -lh "$TARBALL" | awk '{print $9, "—", $5}')"

# ─────────────────────────────────────────────────────────────────────
# FASE 3 — TRANSFERIR AL VPS
# ─────────────────────────────────────────────────────────────────────
log "FASE 3: scp tarball → VPS"
scp -q "$TARBALL" "${VPS}:/tmp/"
log "  ✓ Transferencia completa"

# ─────────────────────────────────────────────────────────────────────
# FASE 4 — BUILD + VERIFICACIÓN DE BUNDLE EN VPS (sin tocar prod aún)
# ─────────────────────────────────────────────────────────────────────
log "FASE 4: build remoto + verificación de bundle"

ssh "$VPS" bash -s <<EOF_BUILD
set -euo pipefail
RELEASE="${RELEASE}"
NEW_TAG="${NEW_TAG}"
RELEASE_DIR="/opt/chibaleteplus/releases/\${RELEASE}"
TARBALL="/tmp/\${RELEASE}.tgz"

echo "[VPS] preparar release dir: \$RELEASE_DIR"
mkdir -p "\$RELEASE_DIR"
tar -xzf "\$TARBALL" -C "\$RELEASE_DIR"

echo "[VPS] verificar fix presente en source extraído"
grep -q "MessageCircle.*lucide-react" "\$RELEASE_DIR/pages/VisorTexto.tsx" || \
  { echo "[VPS][ERROR] MessageCircle NO está en source extraído"; exit 1; }

echo "[VPS] docker build (--no-cache) → \$NEW_TAG"
cd "\$RELEASE_DIR"
# NOTA: --no-cache fuerza rebuild completo. NO --pull para evitar
# dependencia con docker hub durante incidente; bases ya están locales.
docker build --no-cache -f Dockerfile.front -t "\$NEW_TAG" .

echo "[VPS] verificar imagen creada"
docker image inspect "\$NEW_TAG" >/dev/null || { echo "[VPS][ERROR] imagen no creada"; exit 1; }

echo "[VPS] verificar que el bundle generado contiene MessageCircle"
TMPC=\$(docker create "\$NEW_TAG")
CHECK_DIR="/tmp/front-bundle-check-\${RELEASE}"
rm -rf "\$CHECK_DIR"
docker cp "\$TMPC:/usr/share/nginx/html/assets/" "\$CHECK_DIR"
docker rm -f "\$TMPC" >/dev/null

BUNDLE=\$(ls "\$CHECK_DIR"/VisorTexto*.js 2>/dev/null | head -1 || true)
[ -n "\$BUNDLE" ] || { echo "[VPS][ERROR] no se encontró VisorTexto*.js en imagen"; exit 1; }

HITS=\$(grep -c "MessageCircle" "\$BUNDLE" || true)
[ "\$HITS" -ge 1 ] || { echo "[VPS][ERROR] MessageCircle ausente en bundle (\$HITS hits)"; exit 1; }
echo "[VPS]   ✓ \$BUNDLE tiene \$HITS hits de MessageCircle"

rm -rf "\$CHECK_DIR"

echo "[VPS] imagen lista — todavía NO swap"
docker images "\$NEW_TAG" --format "{{.Repository}}:{{.Tag}}  {{.ID}}  {{.CreatedSince}}  {{.Size}}"
EOF_BUILD

log "  ✓ Imagen $NEW_TAG construida y bundle validado en VPS"

# ─────────────────────────────────────────────────────────────────────
# FASE 5 — SWAP EN PRODUCCIÓN (backup + edit + recreate)
# ─────────────────────────────────────────────────────────────────────
log "FASE 5: backup compose + edit validado + recreate front"

ssh "$VPS" bash -s <<EOF_SWAP
set -euo pipefail
COMPOSE="${COMPOSE}"
NEW_TAG="${NEW_TAG}"
OLD_TAG="${OLD_TAG}"
TS=\$(date +%Y%m%d-%H%M%S)
BAK="\${COMPOSE}.bak-\${TS}"

# 5a. Backup obligatorio
echo "[VPS] backup → \$BAK"
cp -p "\$COMPOSE" "\$BAK"
[ -f "\$BAK" ] || { echo "[VPS][ERROR] backup no creado"; exit 1; }

# 5b. Verificar imagen vieja sigue cargada (para rollback)
docker image inspect "\$OLD_TAG" >/dev/null || \
  { echo "[VPS][ERROR] imagen vieja \$OLD_TAG no está localmente — rollback imposible. ABORTAR."; exit 1; }
echo "[VPS]   ✓ imagen vieja \$OLD_TAG sigue disponible (rollback OK)"

# 5c. Validación pre-edit: contar ocurrencias
OLD_COUNT=\$(grep -c "image: \${OLD_TAG}" "\$COMPOSE" || true)
NEW_COUNT=\$(grep -c "image: \${NEW_TAG}" "\$COMPOSE" || true)
echo "[VPS]   OLD_TAG count = \$OLD_COUNT,  NEW_TAG count = \$NEW_COUNT"

if [ "\$OLD_COUNT" = "0" ] && [ "\$NEW_COUNT" = "1" ]; then
  echo "[VPS]   ⚠ compose YA referencia NEW_TAG. Skip edit, ir directo a recreate."
elif [ "\$OLD_COUNT" = "1" ] && [ "\$NEW_COUNT" = "0" ]; then
  # 5d. Edit con awk usando index()/substr() — substitución LITERAL,
  #     no regex. Evita que el "." del tag matchee cualquier char.
  echo "[VPS]   editando compose con awk (replace literal)..."
  awk -v old="image: \${OLD_TAG}" -v new="image: \${NEW_TAG}" '
    {
      idx = index(\$0, old)
      if (idx > 0) {
        print substr(\$0, 1, idx-1) new substr(\$0, idx + length(old))
      } else {
        print
      }
    }' "\$COMPOSE" > "\${COMPOSE}.new"

  # 5e. Validación post-edit
  grep -q "image: \${NEW_TAG}" "\${COMPOSE}.new" || \
    { echo "[VPS][ERROR] NEW_TAG no quedó en compose.new"; rm -f "\${COMPOSE}.new"; exit 1; }
  if grep -q "image: \${OLD_TAG}" "\${COMPOSE}.new"; then
    echo "[VPS][ERROR] OLD_TAG aún presente en compose.new"
    rm -f "\${COMPOSE}.new"
    exit 1
  fi

  # 5f. Diff y commit atómico
  echo "[VPS]   diff propuesto:"
  diff "\$COMPOSE" "\${COMPOSE}.new" || true
  mv "\${COMPOSE}.new" "\$COMPOSE"
  echo "[VPS]   ✓ compose actualizado"
else
  echo "[VPS][ERROR] estado inesperado del compose (OLD=\$OLD_COUNT NEW=\$NEW_COUNT). ABORTAR."
  exit 1
fi

# 5g. Recreate SOLO front (--no-deps protege api_1, api_2, edge)
echo "[VPS] docker compose up -d --no-deps front"
cd /opt/chibaleteplus
docker compose up -d --no-deps front

# 5h. Verificar contenedor con imagen nueva
sleep 2
RUNNING_IMG=\$(docker inspect chibalete_front --format '{{.Config.Image}}' 2>/dev/null || echo "")
[ "\$RUNNING_IMG" = "\$NEW_TAG" ] || \
  { echo "[VPS][ERROR] chibalete_front corre con \$RUNNING_IMG, esperado \$NEW_TAG"; exit 1; }
echo "[VPS]   ✓ chibalete_front corriendo con \$NEW_TAG"

# 5i. CRÍTICO: esperar a que front responda en su red interna
#     antes de reload de edge (evita ventana de 502).
echo "[VPS] esperando que chibalete_front responda HTTP 200 (max 15s)..."
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

# 5j. CRÍTICO: reload de edge nginx para invalidar IP cacheada del
#     upstream "chibalete_front" (nginx open-source NO re-resuelve
#     nombres en upstream blocks sin reload).
echo "[VPS] validando nginx config en edge..."
docker exec chibalete_edge nginx -t 2>&1 || \
  { echo "[VPS][ERROR] nginx -t falló en edge — ABORTAR antes de reload"; exit 1; }
echo "[VPS] reload de edge nginx (graceful, no downtime)..."
docker exec chibalete_edge nginx -s reload
echo "[VPS]   ✓ edge nginx reloaded — upstream re-resolved"

docker ps --filter name=chibalete_front --format "table {{.Names}}\t{{.Image}}\t{{.Status}}"
EOF_SWAP

log "  ✓ Swap completo"

# ─────────────────────────────────────────────────────────────────────
# FASE 6 — VALIDACIÓN POST-DEPLOY
# ─────────────────────────────────────────────────────────────────────
log "FASE 6: validación post-deploy"

ssh "$VPS" bash -s <<'EOF_VAL'
set +e
URL="https://chibaleteplus.chibaleteeditores.com"

echo "[VAL] 1. HTTP / status"
curl -sI -m 5 "$URL/" | head -3
echo

echo "[VAL] 2. resolver bundle nuevo desde index.html"
INDEX=$(curl -s -m 5 "$URL/")
NEW=$(echo "$INDEX" | grep -oE '/assets/VisorTexto[^"]*\.js' | head -1)
echo "  Bundle servido: $NEW"
[ -n "$NEW" ] || { echo "[VAL][FAIL] no hay VisorTexto bundle en index.html"; exit 1; }
echo

echo "[VAL] 3. MessageCircle en bundle servido"
# Forzar Accept-Encoding: identity para que nginx NO devuelva gzipped
HITS=$(curl -s -m 10 -H "Accept-Encoding: identity" "${URL}${NEW}" | grep -c MessageCircle)
echo "  hits: $HITS"
if [ "$HITS" -ge 1 ]; then
  echo "  ✓ PASS — MessageCircle presente en bundle servido"
else
  echo "  ✗ FAIL — MessageCircle ausente. ROLLBACK INMEDIATO RECOMENDADO."
  exit 2
fi
echo

echo "[VAL] 4. API pool sigue OK"
curl -sI -m 5 "$URL/api/health" | head -2 || echo "  (404 es esperable si no hay /api/health)"
echo

echo "[VAL] 5. estado contenedores"
docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}" | grep chibalete
EOF_VAL

log ""
log "═══════════════════════════════════════════════════"
log "DEPLOY COMPLETO. Validación manual pendiente:"
log "  1. Abrir https://chibaleteplus.chibaleteeditores.com"
log "  2. Login + abrir un libro tipo TEXTO"
log "  3. DevTools console: 0 errores 'MessageCircle is not defined'"
log "  4. Burbuja de Leo (icono MessageCircle) renderiza"
log "═══════════════════════════════════════════════════"
log "Rollback disponible: bash .rollback-front-2026-05-01.sh"
