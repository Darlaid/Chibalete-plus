# M3.1 Frontend Deploy Guide

**Branch:** `m31/cdn-frontend-resolver` (creada en local repo, sin commit pendiente)
**Pre-requisito:** Fase 6 observación 72h post-CDN aprobada (cache hit >80%, sin regresiones)

---

## Cambios introducidos

| Archivo | Tipo | Cambio |
|---|---|---|
| `utils/mediaBaseUrl.js` | NEW | Helper ESM con `initMediaBaseUrl()`, `resolveMediaUrl()`, `uploadsUrl()` |
| `utils/mediaBaseUrl.d.ts` | NEW | Type declarations para callers TS |
| `utils/__tests__/mediaBaseUrl.test.mjs` | NEW | 23 tests del helper |
| `index.tsx` | EDIT | `initMediaBaseUrl()` fire-and-forget al boot |
| `services/dataService.ts` | EDIT | manifest fetch usa `resolveMediaUrl` |
| `hooks/useImmersivePlayback.ts` | EDIT | TTS chunk URL usa `uploadsUrl` |
| `pages/VisorTexto.tsx` | EDIT | manifest fetch + TTS chunk URL usan helpers |
| `engines/StartupEngine.ts` | EDIT | manifest + anchors + prefetch via `resolveMediaUrl` |
| `utils/immersiveV2/manifestAdapter.mjs` | EDIT | URL builder via `resolveMediaUrl` |
| `utils/immersiveV2/audioAdapter.mjs` | EDIT | MANIFEST_PREFIX combinado con `resolveMediaUrl` |

Total: 7 archivos modificados, 3 archivos nuevos. **+33/-11 líneas de cambio diff**.

---

## Validación pre-deploy

Antes de buildear, verificar local:

```bash
cd "D:\001 - app - Chibalete+"
git checkout m31/cdn-frontend-resolver

# 1. Test del helper nuevo
node utils/__tests__/mediaBaseUrl.test.mjs
# Esperar: pass=23 fail=0

# 2. Tests de adapters modificados
node utils/immersiveV2/__tests__/manifestAdapter.test.mjs
node utils/immersiveV2/__tests__/audioAdapter.test.mjs
# Esperar: ambos pass=N fail=0

# 3. TypeScript regression check
node scripts/typecheck-baseline.mjs
# Esperar: "✅ Sin regresiones TS"

# 4. Build local (verifica que Vite resuelve todo)
npm run build
# Esperar: dist/ generado sin errores
```

---

## Build + deploy

### A. Commit (cuando el operator apruebe)

```bash
git add utils/mediaBaseUrl.js utils/mediaBaseUrl.d.ts utils/__tests__/mediaBaseUrl.test.mjs \
        index.tsx services/dataService.ts hooks/useImmersivePlayback.ts \
        pages/VisorTexto.tsx engines/StartupEngine.ts \
        utils/immersiveV2/manifestAdapter.mjs utils/immersiveV2/audioAdapter.mjs

git commit -m "M3.1: frontend CDN resolver — runtime-config bootstrap + media URL prefixing

- utils/mediaBaseUrl.js: centralized resolver, fire-and-forget bootstrap
- index.tsx: initMediaBaseUrl() at boot (defaults safely if no CDN)
- All TTS manifest/chunk fetches now via resolveMediaUrl()
- Album/inmersivo paths consume CDN when MEDIA_BASE_URL set
- 23 new tests, 0 TS regressions, 154 existing tests still pass
- Backward-compatible: with MEDIA_BASE_URL empty, URLs stay relative"
```

### B. Build Docker image

```bash
cd "D:\001 - app - Chibalete+"

# Build v4.0.8 — incremento desde v4.0.7 actual en prod
docker build -f Dockerfile.front -t chibalete/front:v4.0.8 .

# Verificar tamaño + assets
docker run --rm chibalete/front:v4.0.8 du -sh /usr/share/nginx/html
docker run --rm chibalete/front:v4.0.8 ls -la /usr/share/nginx/html/assets/ | head

# Save + ship a VPS
docker save chibalete/front:v4.0.8 | gzip > chibalete-front-v4.0.8.tar.gz
scp chibalete-front-v4.0.8.tar.gz root@72.60.158.97:/opt/chibaleteplus/releases/
```

### C. Load + deploy en VPS

```bash
ssh root@72.60.158.97

# Load image
gunzip -c /opt/chibaleteplus/releases/chibalete-front-v4.0.8.tar.gz | docker load

# Verificar imagen disponible
docker images | grep chibalete/front

# Backup compose actual
SNAP=$(cat /opt/chibaleteplus/M3_SNAPSHOT.txt)
cp /opt/chibaleteplus/docker-compose.yml $SNAP/configs/docker-compose.yml.preM31

# Editar compose: cambiar image: chibalete/front:v4.0.7 → v4.0.8
sed -i 's|chibalete/front:v4.0.7|chibalete/front:v4.0.8|' /opt/chibaleteplus/docker-compose.yml

# Validate
cd /opt/chibaleteplus && docker compose config -q && echo VALID

# Recreate front
docker compose up -d --no-deps --force-recreate front
sleep 15
docker ps --filter name=chibalete_front --format "table {{.Names}}\t{{.Status}}"

# Probe
curl -s -o /dev/null -w "code=%{http_code} time=%{time_total}s\n" https://chibaleteplus.chibaleteeditores.com/
```

### D. Validar end-to-end con CDN activo

Si en este punto Cloudflare ya está delante:

```bash
# 1. Verificar bundle nuevo se sirve
curl -sI https://chibaleteplus.chibaleteeditores.com/ | grep -iE "server|cf-cache-status"

# 2. Verificar runtime-config sigue funcionando
curl -s https://chibaleteplus.chibaleteeditores.com/api/runtime-config | jq

# 3. Test funcional en browser:
#    - Abrir https://chibaleteplus.chibaleteeditores.com
#    - DevTools → Network → recargar
#    - Verificar:
#      * /api/runtime-config llamada al boot (200)
#      * Assets /assets/*.js → CDN cf-cache-status: HIT después del primer load
#      * /uploads/ → CDN cf-cache-status: HIT
#      * Si MEDIA_BASE_URL está set en backend: ver URLs absolutas en /api/content
#      * Si MEDIA_BASE_URL está vacío: URLs relativas (Cloudflare cachea transparente)
```

### E. Rollback

```bash
# 1. Revertir compose
sed -i 's|chibalete/front:v4.0.8|chibalete/front:v4.0.7|' /opt/chibaleteplus/docker-compose.yml

# 2. Recreate front con imagen vieja (ya está en docker images)
cd /opt/chibaleteplus
docker compose up -d --no-deps --force-recreate front
sleep 15

# 3. Validar
curl -s -o /dev/null -w "code=%{http_code}\n" https://chibaleteplus.chibaleteeditores.com/
docker ps --filter name=chibalete_front --format "table {{.Names}}\t{{.Status}}"

# Si rollback OK: image v4.0.8 queda en disco para investigar después
# Si querés borrar: docker rmi chibalete/front:v4.0.8
```

---

## Comportamiento esperado por modo

| Backend `MEDIA_BASE_URL` | Frontend v4.0.8 hace |
|---|---|
| **Vacío** (default actual) | Boot llama `/api/runtime-config` → recibe `mediaBaseUrl: null` → todas las URLs siguen `/uploads/...` relativas. **Cero cambio visible.** Cloudflare cachea via su proxy del mismo dominio. |
| **Set** (e.g., `https://cdn.example.com`) | Boot recibe el valor → todas las URLs se prefijan con CDN. Frontend hace fetch directamente al CDN para audio/PDF/imágenes. **Backend nunca toca media bytes.** |

**Backward compatibility 100%:** si el frontend v4.0.8 corre contra un backend WITHOUT `/api/runtime-config` (versión < M3), el fetch al boot devuelve 404, el helper queda en default (relativo). App funciona idéntica.

---

## Failure modes y mitigación

| Problema | Síntoma | Mitigación |
|---|---|---|
| `/api/runtime-config` falla al boot | Helper queda en default (relativo). App funciona via VPS edge. | Ninguna acción — comportamiento documentado |
| CDN devuelve 5xx para asset | Browser ve error 5xx en /uploads/foo.mp3 (vía CDN) | Pause Cloudflare on Site → tráfico vuelve directo |
| Browser cachea bundle v4.0.7 viejo | Usuario sigue con código sin runtime-config | El SPA tiene cache busting via filename hash (e.g., `index-RxH4u0QK.js`). Forzar refresh con Ctrl+Shift+R si es crítico |
| TTS manifest contiene paths corruptos | Audio no carga | Rollback front a v4.0.7 — manifest backend no cambió |
| TS errors aparecen | Build falla | Pre-validation en sección "Validación pre-deploy" catches this |
| Tests fallan | CI falla | Same — pre-validation block |

---

## Diff inspection

```bash
git diff sprint-022/operational-stack...m31/cdn-frontend-resolver --stat
git diff sprint-022/operational-stack...m31/cdn-frontend-resolver -- utils/mediaBaseUrl.js
git diff sprint-022/operational-stack...m31/cdn-frontend-resolver -- index.tsx
```

---

## Post-deploy observation (24h)

Verificar:
- [ ] Network tab en browser muestra fetch a `/api/runtime-config` exitoso al boot
- [ ] Si CDN activo: `cf-cache-status: HIT` en assets+uploads
- [ ] Visor inmersivo carga audio correctamente
- [ ] Visor álbum reproduce ambient + narration
- [ ] PDF abre con Range support
- [ ] Sin 5xx nuevos en api logs
- [ ] Grafana muestra reducción adicional en VPS bandwidth (vs solo backend M3)
