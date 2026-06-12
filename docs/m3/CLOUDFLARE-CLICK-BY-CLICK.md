# Cloudflare Free — Click-by-click Activation Guide

**Tiempo estimado:** 30-45 min (la mayoría = espera de propagación DNS, ~15-60 min)
**Costo:** $0 (plan Free)
**Riesgo:** bajo — Cloudflare puede desactivarse con 1 click ("Pause Cloudflare on Site")
**Lo que se gana:** CDN, HTTP/3 al cliente, TLS termination, WAF básico, DDoS protection

---

## Pre-requisitos

- [ ] Email corporativo accesible (para confirmar cuenta Cloudflare)
- [ ] Acceso al registrador donde está registrado `chibaleteeditores.com` (probablemente Hostinger; necesitarás credenciales)
- [ ] Saber qué subdominios usa el cliente:
  - `chibaleteplus.chibaleteeditores.com` ← lo que vamos a proxiear
  - `studio.chibaleteeditores.com` ← Let's Encrypt cert lo usa; **NO proxiear esto**
  - `editores.chibaleteeditores.com` ← si existe
  - Otros subdominios activos
- [ ] **NO empezar en horario de tráfico alto** (mañana/tarde escolar). Recomendado: noche o fin de semana.

---

## Paso 1 — Crear cuenta Cloudflare

1. Ir a https://dash.cloudflare.com/sign-up
2. Email + password
3. Verificar email
4. **NO** activar 2FA en este momento si querés que yo entre vía API después; activar 2FA después si solo vas a manejar manualmente

## Paso 2 — Add Site

1. Dashboard → "Add a Site"
2. Ingresar: `chibaleteeditores.com` ← **el dominio raíz**, no el subdominio
3. Plan: **Free** (scroll abajo, está como "Free / $0")
4. Continue

## Paso 3 — DNS Scan Review

Cloudflare hace scan automático del DNS actual y muestra los records. **REVISAR CUIDADOSAMENTE** antes de continuar:

| Record | Acción CRÍTICA |
|---|---|
| `A chibaleteplus → 72.60.158.97` | ✅ activar **Proxy (orange cloud)** — esto es lo que queremos cachear |
| `A chibaleteeditores.com → ...` (raíz) | 🟡 **DNS only (gris)** si no es la app; consultar |
| `A studio → ...` | ❌ **DNS only (gris) OBLIGATORIO** — Let's Encrypt cert renewal lo usa, Cloudflare proxy lo rompe |
| `A editores → ...` | depende — DNS only es lo seguro |
| `MX records` (correo) | ❌ **DNS only siempre** (mail nunca via Cloudflare Free) |
| `TXT records` (SPF, DKIM, DMARC) | ❌ **DNS only siempre** |
| `CAA records` si existen | mantener tal cual |
| `_acme-challenge` si existe | ❌ **DNS only** |

5. Continue

## Paso 4 — Cambiar nameservers (acción en registrador)

Cloudflare te muestra 2 nameservers, algo como:
```
amelia.ns.cloudflare.com
todd.ns.cloudflare.com
```

(los nombres varían — son únicos por cuenta)

1. Ir al **registrador** del dominio (Hostinger, GoDaddy, Namecheap, etc.)
2. Buscar "Nameservers" o "DNS Management"
3. Cambiar de "Default nameservers" a **"Custom nameservers"**
4. Pegar los 2 nameservers de Cloudflare
5. Guardar

**Tiempo de propagación:** 5 min - 24h (típico 30 min)

Verificar desde tu máquina:
```bash
dig NS chibaleteeditores.com +short
# Debe devolver los 2 NS de Cloudflare cuando propague
```

O https://www.whatsmydns.net (pegar dominio, ver progreso global)

6. Cloudflare envía email "Site activated" cuando detecta el cambio

## Paso 5 — Configurar SSL/TLS

En Cloudflare dashboard del site:

1. **SSL/TLS → Overview**
   - Modo: **Full (Strict)** ← Cloudflare valida cert del origin
   - **NO usar "Flexible"** (rompe la cadena TLS)
   - **NO usar "Off"** obviamente

2. **SSL/TLS → Edge Certificates**
   - Always Use HTTPS: **ON**
   - Automatic HTTPS Rewrites: **ON**
   - Minimum TLS Version: **1.2**
   - Opportunistic Encryption: ON
   - TLS 1.3: **ON**
   - HSTS: **ON** (max-age 1 año, includeSubDomains, preload OFF inicialmente)

## Paso 6 — Activar HTTP/3 + Brotli + WAF básico

1. **Speed → Optimization**
   - Brotli: **ON**
   - Auto Minify: HTML **OFF**, CSS **OFF**, JS **OFF** ← el bundle vite ya está minificado; doble minify rompe sourcemaps
   - **Rocket Loader: OFF** (rompe React)
   - Mirage: **OFF** (compresión agresiva de imágenes; afecta visor álbum)
   - Polish: **OFF** o "Lossless" (jamás "Lossy"; afecta imágenes editoriales)
   - APO (Automatic Platform Optimization): **OFF** (es para WordPress)

2. **Network**
   - HTTP/2: **ON** (default)
   - HTTP/3 (with QUIC): **ON**
   - 0-RTT Connection Resumption: **ON** (seguro con HTTP/3)
   - WebSockets: **ON** (no usamos, pero por si acaso)
   - IP Geolocation: **ON**
   - Maximum Upload Size: **100 MB** (Free max; uploads grandes >100MB siguen funcionando porque van al origin con Cache Bypass, ver Paso 7)

3. **Security → Bots**
   - Bot Fight Mode: **ON** (Free) — bloquea bots conocidos automáticamente
   - **Verified Bots Allowed: ON** — no bloquea Googlebot, Bingbot

4. **Security → WAF → Managed Rules**
   - Cloudflare Free Managed Ruleset: **ON** (incluido)

5. **Security → Settings**
   - Security Level: **Medium** (Low si reportan falsos positivos)
   - Challenge Passage: **30 min**
   - Browser Integrity Check: **ON**

## Paso 7 — Cache Rules (CRÍTICO)

**Caching → Cache Rules → Create rule**

### Rule 1: Bypass /api/* (primera prioridad)
- Name: `Bypass API`
- Match: `URI Path` `starts with` `/api/`
- Then:
  - Cache eligibility: **Bypass cache**
- **Deploy → mover esta regla AL TOP de la lista**

### Rule 2: Cache /uploads/* aggressively
- Name: `Cache uploads media`
- Match: `URI Path` `starts with` `/uploads/`
- Then:
  - Cache eligibility: **Eligible for cache**
  - Edge TTL: **Use cache-control header from origin** (respeta `max-age=2592000 immutable` que ya envía edge nginx)
  - Browser TTL: **Use cache-control header from origin**
- Deploy

### Rule 3: Cache /assets/* (frontend bundle)
- Name: `Cache frontend assets`
- Match: `URI Path` `starts with` `/assets/`
- Then:
  - Cache eligibility: **Eligible for cache**
  - Edge TTL: 1 month
  - Browser TTL: 1 year (immutable)
- Deploy

### Rule 4 (opcional): No cachear /metrics, /healthz, /admin
- Name: `Bypass admin + metrics`
- Match: `URI Path` `starts with` `/metrics` OR `/healthz` OR `/admin`
- Then: Bypass cache

## Paso 8 — Page Rules legacy (si Cache Rules no soporta algo)

Plan Free permite 3 Page Rules. Usar solo si Cache Rules nuevas no cubren. Idealmente vacío.

## Paso 9 — Configurar Origin (sin tocar nada)

Cloudflare hace pull al origin (`72.60.158.97` vía SSL strict). El edge nginx ya tiene HTTPS y Let's Encrypt cert válido — no requiere cambios.

**Verificar:** desde Cloudflare dashboard → Caching → Configuration:
- Cache TTL by status code: defaults OK
- Browser Cache TTL: **Respect Existing Headers**
- Always Online™: ON (Free incluye limitado)
- Crawler Hints: ON

## Paso 10 — Validación pre-flight (ANTES de tocar MEDIA_BASE_URL)

```bash
# 1. Verificar Cloudflare está delante
dig chibaleteplus.chibaleteeditores.com +short
# Debe devolver IPs Cloudflare (ej: 104.21.x.x o 172.67.x.x), NO 72.60.158.97

# 2. Headers cf-* visibles
curl -sI https://chibaleteplus.chibaleteeditores.com/
# Debe incluir: server: cloudflare, cf-ray: ..., cf-cache-status: ...

# 3. Test pull-through directo a /uploads/
curl -sI https://chibaleteplus.chibaleteeditores.com/uploads/audio/content-1776006983915/album/a30ae164a424.mp3
# Esperar:
#   cf-cache-status: MISS (primera vez) o HIT (segunda)
#   accept-ranges: bytes
#   content-length: 275130
#   age: <N> (segundos desde cached)

# 4. Range request OK
curl -sI -H "Range: bytes=0-1023" https://chibaleteplus.chibaleteeditores.com/uploads/audio/content-1776006983915/album/a30ae164a424.mp3
# Esperar: HTTP/2 206 Partial Content

# 5. /api/ NO cacheado
curl -sI https://chibaleteplus.chibaleteeditores.com/api/health
# Esperar: cf-cache-status: DYNAMIC o BYPASS
```

Si todo el Paso 10 da los resultados esperados → **CDN está activo**. **Confirmar a Claude para que ejecute Fase 2 (MEDIA_BASE_URL)**.

## Paso 11 — Reportar a Claude para Fase 2

Cuando termines, decirme:
1. **Confirmar:** "Cloudflare activo, paso 10 todo OK"
2. **MEDIA_BASE_URL value a usar:**
   - **Opción A (recomendada inicial):** dejar vacío — Cloudflare ya está proxiando el mismo dominio, no necesitás cambiar URLs. La app sigue usando `/uploads/...` y Cloudflare cachea transparente.
   - **Opción B (opcional, full offload):** crear subdominio dedicado `cdn-media.chibaleteplus.chibaleteeditores.com` apuntando al mismo origin via Cloudflare, y setear `MEDIA_BASE_URL=https://cdn-media.chibaleteplus.chibaleteeditores.com`. Requiere CORS headers en edge nginx.

**Recomendado: Opción A.** En ese caso **Fase 2 no requiere setear MEDIA_BASE_URL** — el CDN ya está delante y las URLs relativas funcionan a través de él. Solo querés validar que cf-cache-status: HIT aparezca en `/uploads/`.

## Paso 12 — Si algo se rompe (rollback inmediato)

**Cloudflare → Overview → "Pause Cloudflare on Site"** (botón abajo a la derecha)

Esto desactiva Cloudflare en ~1 minuto, el tráfico vuelve directo al origin (72.60.158.97). DNS sigue resolviendo a IPs Cloudflare, pero ellos pasan-through.

Rollback completo (revertir nameservers):
1. Cloudflare → Overview → "Remove Site"
2. Volver al registrador → cambiar nameservers a los originales del registrador
3. Esperar 24h propagación
4. App funciona idéntico a pre-Cloudflare

---

## Checklist post-activación (próximas 2h)

- [ ] Dashboard Cloudflare → Analytics → Traffic muestra requests entrantes
- [ ] cf-cache-status: HIT aparece en al menos 50% de requests `/uploads/`
- [ ] Origin requests (en Cloudflare Analytics) bajaron vs total requests
- [ ] Tu Grafana muestra reducción en `rate(node_network_transmit_bytes_total[5m])`
- [ ] 0 nuevos alerts en Alertmanager
- [ ] App funciona en browser real (no solo curl)

## Checklist 24h

- [ ] Cache HIT ratio > 70%
- [ ] VPS bandwidth reducido > 50% vs baseline
- [ ] Sin 5xx nuevos en api logs
- [ ] Audio/PDF cargan más rápido (subjective check con user real)
- [ ] Cloudflare → Security → "Events" — bots bloqueados pero nada legítimo

## Checklist 72h (criterio go/no-go M3.1)

- [ ] HIT ratio > 80%
- [ ] VPS bandwidth promedio cayó > 70%
- [ ] 0 incidentes que requirieron rollback
- [ ] Reportes de usuarios estables (no degradaciones reportadas)

→ Si todo ✅ : aprobar M3.1 frontend deploy (la branch ya está lista en local repo, ver `docs/m3/M31-FRONTEND-CHANGES.md`)
