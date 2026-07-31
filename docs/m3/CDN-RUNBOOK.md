# Chibalete+ — CDN Activation Runbook (M3)

**Estado:** plataforma **lista para activar CDN**, código backend desplegado en producción con `MEDIA_BASE_URL` vacío (default no-op). Operador puede activar siguiendo este runbook.

**Backup snapshot:** `/opt/chibaleteplus/m3-snapshot-20260525-233649/`
**Server.js pre-M3:** `/opt/chibaleteplus/m3-snapshot-20260525-233649/code/server.js.preM3`

---

## 1. Decisión recomendada de CDN — Cloudflare Free → BunnyCDN si saturación

### Opción A — Cloudflare Free (RECOMENDADA primer paso)

**Por qué:**
- Plan gratuito incluye: CDN cache ilimitado, HTTP/3, TLS 1.3, WAF básico, DNS, DDoS protection
- **0 costo** hasta empezar a saturar (entonces escalar a Pro $20/mes)
- Setup en ~30 min vía web UI
- Funciona como **pull-cache proxy** delante del dominio actual (no requiere mover archivos)
- HTTP/3 ya configurado en edge nginx en M2 — Cloudflare lo extiende al cliente

**Riesgos:**
- Free no garantiza SLA, ocasionalmente cachea menos agresivo
- Logs limitados (sin Cloudflare Logpush)
- DDoS protection es básico (no enterprise)

**Setup vía Cloudflare:**
1. Crear cuenta en https://dash.cloudflare.com
2. Add Site: `chibaleteeditores.com` (o el dominio del cliente)
3. Cloudflare hace scan DNS automático
4. Cambiar nameservers en registrador (~24h propagation)
5. Activar Proxy (orange cloud) en el A record de `chibaleteplus.chibaleteeditores.com`
6. **NO activar Proxy en otros subdominios** (e.g., `studio.chibaleteeditores.com` para Let's Encrypt — debe quedar "DNS only" gris)
7. Configurar Page Rule o Cache Rule para `chibaleteplus.chibaleteeditores.com/uploads/*`:
   - Cache Level: Cache Everything
   - Edge Cache TTL: 1 month
   - Origin Cache Control: ON (respeta los headers `immutable max-age=2592000` que ya envía edge nginx)
   - Browser Cache TTL: Respect Existing Headers
8. SSL/TLS: Full (Strict) — Cloudflare valida cert del origin
9. Speed → Optimization → Brotli ON
10. Network → HTTP/3 (QUIC) ON
11. **Decisión MEDIA_BASE_URL**: vacío para empezar (CDN proxy delante del mismo dominio, transparente), o subdominio dedicado `cdn-` si se quiere offload total.

### Opción B — BunnyCDN (recomendada si Cloudflare no alcanza)

**Por qué:**
- Más barato por GB (~$0.01-0.025/GB) que Cloudflare Pro
- Pull Zone setup más explícito para media
- Cache hit ratio público en dashboard
- Performance superior para audio streaming en LatAm

**Setup:**
1. Crear cuenta en https://bunny.net
2. Create Pull Zone:
   - Origin URL: `https://chibaleteplus.chibaleteeditores.com`
   - Pull Zone hostname: `chibalete-media.b-cdn.net` (o configurar custom CNAME)
3. Cache Settings:
   - Caching Enabled: Yes
   - Cache Control: Honor Origin Cache-Control
   - Vary Cache by Query String: NO (URLs son immutable)
   - Strip Response Cookies: YES
4. Edge Rules:
   - "Cache /uploads/*" → Max Cache Time: 30 days
   - "Bypass /api/*" → Cache Mode: Bypass Cache (NUNCA cachear API)
5. Performance Settings:
   - Enable HTTP/3: Yes
   - Enable Brotli: Yes
   - TLS 1.3: Yes
6. (opcional) custom domain `cdn.chibaleteplus.chibaleteeditores.com` con CNAME

### Opción C — R2/S3 (M4, NO M3)

Object storage requiere migración real de archivos (5 GB de uploads). Documentado en sección 9.

---

## 2. Activación gradual (zero-risk path)

### Fase 0 — Sólo CDN, sin tocar app
Después de cualquier opción A o B:
1. Verificar manualmente desde curl/browser que `<CDN_URL>/uploads/audio/<algún_mp3>.mp3` responde 200 con Range support
2. Probar audio en navegador: `<CDN_URL>/uploads/audio/.../sample.mp3`
3. **La app sigue funcionando idéntico** porque MEDIA_BASE_URL está vacío

### Fase 1 — Activar MEDIA_BASE_URL en producción (staggered)

```bash
ssh root@72.60.158.97
# 1. Evidencia del .env ANTES de tocarlo — sin copiarlo.
#
#    Copiar el archivo entero es lo que dejó `m3-snapshot-*/configs/.env.original`
#    con las dos claves de IA dentro, vivas durante meses (saneado en
#    CHP-SEC-AI-PROVIDER-KEYS-ROTATE-01A). Lo que hace falta para un rollback no
#    es el valor de las claves —que no cambian aquí— sino QUÉ VARIABLES había:
SNAP=$(cat /opt/chibaleteplus/M3_SNAPSHOT.txt)
install -m 0600 /dev/null "$SNAP/configs/env-names.preCdnActivation.txt"
grep -oE '^[A-Za-z_][A-Za-z0-9_]*' /opt/chibaleteplus/.env \
  > "$SNAP/configs/env-names.preCdnActivation.txt"
#    Rollback: si MEDIA_BASE_URL no estaba en esa lista, se elimina la línea.

# 2. Agregar línea (sustituir URL real del CDN)
echo "" >> /opt/chibaleteplus/.env
echo "# M3 — CDN activation $(date +%Y-%m-%d)" >> /opt/chibaleteplus/.env
echo "MEDIA_BASE_URL=https://cdn.chibaleteplus.chibaleteeditores.com" >> /opt/chibaleteplus/.env

# 3. Recreate api_2 PRIMERO (api_1 mantiene tráfico)
cd /opt/chibaleteplus
docker compose up -d --no-deps --force-recreate api_2
sleep 45  # esperar healthcheck

# 4. Validar api_2 directamente
docker run --rm --network chibalete_net curlimages/curl:latest \
  curl -s http://chibalete_api_2:3000/api/runtime-config
# Esperar: {"mediaBaseUrl":"https://cdn...","cdnEnabled":true}

# 5. Probar /api/content via api_2
docker run --rm --network chibalete_net curlimages/curl:latest \
  curl -s -H "x-user-id: user-1774362611303" http://chibalete_api_2:3000/api/content \
  | jq '.[0] | {url_recurso, portada_url}'
# Esperar URLs prefijadas con CDN

# 6. Si todo OK, recreate api_1
docker compose up -d --no-deps --force-recreate api_1
sleep 45
docker ps --format "table {{.Names}}\t{{.Status}}"  # 4/4 healthy esperado

# 7. Validación end-to-end via edge:
curl -s -H "x-user-id: user-1774362611303" \
  https://chibaleteplus.chibaleteeditores.com/api/content \
  | jq '.[0] | {url_recurso, portada_url}'
# Esperar URLs apuntando al CDN
```

### Fase 2 — Validación funcional (usar app real)

Test manual en browser:
- [ ] Biblioteca carga (lista de libros con portadas)
- [ ] Portadas cargan desde CDN (devTools → Network → fuente debería ser CDN host)
- [ ] Abrir libro PDF: descarga desde CDN, Range requests funcionan
- [ ] Abrir libro inmersivo: audio chunks cargan
- [ ] Abrir libro álbum: imágenes + ambient audio desde CDN
- [ ] TTS narrador funciona (manifest.json viene de origin, chunks via /uploads/ via CDN si los URLs internos se reescriben)
- [ ] Aula Viva carga datos (no debería tener URLs media)
- [ ] Admin Usuarios (no debería tener URLs media)

### Rollback inmediato

```bash
ssh root@72.60.158.97
# Eliminar MEDIA_BASE_URL
sed -i '/^MEDIA_BASE_URL=/d; /^# M3 — CDN activation/d' /opt/chibaleteplus/.env

# Recreate staggered
cd /opt/chibaleteplus
docker compose up -d --no-deps --force-recreate api_2
sleep 45
docker compose up -d --no-deps --force-recreate api_1
sleep 45

# Validar
curl -s https://chibaleteplus.chibaleteeditores.com/api/runtime-config | jq
# Esperar: mediaBaseUrl: null, cdnEnabled: false
```

Total rollback time: **~3 minutos**, sin downtime visible.

---

## 3. CORS / Headers necesarios en origin (ya cumplidos por M1)

Edge nginx ya emite estos headers para `/uploads/`:
- `Accept-Ranges: bytes` ✓ (verificado en M2 Track C — 206 Partial Content funciona)
- `Cache-Control: public, max-age=2592000, immutable` ✓
- `X-Content-Type-Options: nosniff` ✓
- `Content-Type` correcto (auto vía mime.types) ✓
- `ETag` y `Last-Modified` ✓ (auto)
- **`Access-Control-Allow-Origin`** ⚠️ **NO presente actualmente** — si el CDN está en otro dominio (e.g., `cdn-media.example.com`), el browser RECHAZA audio/PDF cross-origin sin CORS

**Acción requerida ANTES de activar CDN con subdominio distinto:**

Editar `/opt/chibaleteplus/nginx/nginx.conf` en el bloque `location ^~ /uploads/`:
```nginx
location ^~ /uploads/ {
    alias /var/uploads/;
    access_log off;
    expires 30d;
    add_header Cache-Control "public, max-age=2592000, immutable";
    add_header X-Content-Type-Options "nosniff";
    add_header Access-Control-Allow-Origin "*" always;
    add_header Access-Control-Allow-Methods "GET, HEAD, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Range, If-Range" always;
    add_header Access-Control-Expose-Headers "Content-Length, Content-Range, Accept-Ranges, ETag" always;

    if ($request_method = OPTIONS) {
        add_header Access-Control-Max-Age 86400;
        return 204;
    }
}
```

Si el CDN está SOBRE el mismo dominio (Cloudflare Proxy en el mismo hostname), **NO** se necesita CORS.

---

## 4. Estructura del cambio backend (qué se desplegó en M3)

**Helpers en `/var/www/chibalete/server/server.js`** (after L843, antes de `resolveCollectionContentIds`):

| Función | Propósito |
|---|---|
| `resolveMediaUrl(url)` | Prefija URL relativa `/uploads/...` con `MEDIA_BASE_URL` si está set; pasa-through si vacío o ya absoluta |
| `rewriteAlbumRegion(region)` | Reescribe `audioUrl`, `imageUrl`, `action.audioUrl/imageUrl` |
| `rewriteAlbumPage(page)` | Reescribe `imageUrl`, `audioUrl`, `ambientAudioUrl`, + array `regions` |
| `rewriteContentMediaUrls(content)` | Función principal — cubre top-level URLs + arrays + `album_data` nested |

**Routes modificados:**
- `GET /api/content` — wraps response con `rewriteContentMediaUrls`
- `GET /api/content/my-catalog` — `coverImage` pasa por `resolveMediaUrl`

**Route nuevo:**
- `GET /api/runtime-config` (público, sin auth) — retorna `{mediaBaseUrl, release, features: {metrics, cdnEnabled}}`

**Routes NO modificados (defer M3.1):**
- `POST /api/content/:id/retry` — devuelve content actualizado pero solo admin lo ve
- `POST /api/content` — admin crea, response es echo del input

---

## 5. CDN observability

### Cloudflare Analytics
- Dashboard: https://dash.cloudflare.com → Site → Analytics → Traffic
- Métricas clave: Cache Hit Ratio, Bandwidth Saved, Requests by Status, p99 response time
- Logs (Free): última hora vía Logpush limitado; para retención full requiere Cloudflare Pro/Enterprise

### BunnyCDN Analytics
- Dashboard: https://panel.bunny.net → Pull Zones → tu zona → Statistics
- Cache hit ratio en tiempo real
- Bandwidth desglosado por geo y origen
- Logs descargables vía API

### Métricas en Grafana (post-CDN)
Una vez CDN activado, monitorear:
- **Origin requests (chibalete-api):** `rate(chibalete_http_requests_total{route=~"/api/.*"}[5m])` — solo API, sin /uploads/
- **VPS bandwidth:** `rate(node_network_transmit_bytes_total[5m])` — debe BAJAR drásticamente
- **Edge cache hits sobre uploads:** Cloudflare Analytics API → puede exportarse a Prometheus vía exporter (M3.1)

---

## 6. Security checklist (Track K)

- [x] **NO cachear /api/*** — Cloudflare Page Rule "Bypass /api/*" debe estar primero en orden
- [x] **NO directory listing** — nginx `autoindex off` (default) ✓
- [x] **NO secrets via CDN** — `.env`, `*.bak`, `*.sql` ya devuelven 404 desde front nginx (M1)
- [x] **CDN solo cachea /uploads/ y /assets/** — explícito via Page Rule
- [ ] **Hotlinking policy:** Cloudflare Hotlink Protection (Free) — opcional, si se quiere bloquear sites copiando assets
- [ ] **WAF básico (Cloudflare):** Bot Fight Mode + reglas managed básicas — RECOMENDADO
- [ ] **CORS Allow-Origin** — agregar si CDN está en subdominio distinto (ver sección 3)

---

## 7. Bench esperado post-CDN

| Workload | Pre-CDN (M2 medido) | Post-CDN (esperado) |
|---|---|---|
| `/api/health` c=100 | 977 RPS via VPS | igual (API no cambia) |
| `/uploads/` audio c=100 | 67 MB/s (VPS NIC ceiling) | **CDN-bound, libera VPS** ~500 MB/s factible |
| `/uploads/` PDF c=50 | 67 MB/s VPS saturado | **CDN-bound**, p50 baja a <500ms |
| VPS network egress | ~534 Mbps sostenido | **<50 Mbps** (solo API + CDN cache misses) |
| Concurrencia multimedia | ~100-150 | **500+** sin saturación VPS |

---

## 8. Riesgos restantes post-activación

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Manifest TTS chunks usan rutas internas no reescritas | 🟡 | Manifest se sirve via CDN, pero las refs internas a `audio/<contentId>/chunk_xxx.mp3` requieren resolución frontend. Defer M3.1: frontend release que use `/api/runtime-config` para componer URLs |
| Frontend no consume `/api/runtime-config` aún | 🟡 | Defer M3.1: agregar bootstrap call en index.tsx + propagar a contexts |
| Range requests por CDN | 🟢 | Cloudflare y Bunny soportan Range nativo; verificado en pre-flight |
| Costo inesperado por bandwidth alto | 🟡 | Cloudflare Free es ilimitado; Bunny es ~$0.01/GB → 1TB = $10/mes |
| Cache poisoning si Cloudflare cachea response con `Set-Cookie` | 🟢 | El edge nginx no setea Cookies en /uploads/ |
| Cache hits stale después de upload nuevo | 🟡 | Filenames incluyen timestamp único → URL es immutable; nuevo asset = nueva URL = MISS automático |

---

## 9. Object storage roadmap (M4 — NO ejecutar en M3)

Si la app crece más allá de 50 GB de uploads, el storage local en VPS deja de escalar. Migración a R2/S3:

### Fase A — Preparación (sin cambio de app)
1. Crear bucket: `chibalete-media-prod` en Cloudflare R2 (R2 es gratis hasta 10 GB egress/mes, $0.015/GB después)
2. `aws s3 sync /var/www/chibalete/public/uploads/ s3://chibalete-media-prod/uploads/` (one-time, ~5 GB)
3. Configurar pull origin de Cloudflare/Bunny → R2 (en lugar de origin VPS para uploads)
4. **Validar** que cada upload existing tiene equivalente en R2 (checksum)

### Fase B — Cambio app (uploads nuevos van a R2)
1. Editar multer storage en `server.js`: implementar `multer-s3` para R2
2. Mantener fallback a disk si R2 falla
3. Mantener `/uploads/` legacy hasta migrar todos
4. Lifecycle policy en R2: nada se borra automáticamente
5. Backup: snapshot diario del bucket vía rclone a otra región/proveedor

### Fase C — Decommissioning del bind-mount
1. Verificar que CDN-cache hace 100% miss vs R2, 0% vs VPS
2. Mantener `/var/www/chibalete/public/uploads/` archived por 90 días
3. Después: remover bind mount de compose, liberar 5 GB del VPS

**No ejecutar M4 hasta:**
- M3 lleva al menos 1 mes en producción estable
- Costo R2 estimado se valida con tráfico real (medido en CDN Analytics)
- Plan de migración revisado por equipo editorial (algunos workflows pueden depender de paths VPS)
