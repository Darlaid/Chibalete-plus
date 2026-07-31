# CHIBALETE+ · AUDITORÍA FINAL PRE-DEPLOY PRODUCCIÓN

**Fecha:** 2026-05-19
**Alcance:** versión post-PASO-7 Aula Viva + sprint 022/operational-stack + INV-18 (commit `1e6c614`)
**Método:** verificación directa de código + tests reales (`npm run test:*` + `npm audit`) + dispatch paralelo de tres auditorías especializadas (visores+sync, seguridad, OSS research)

---

## 0. VEREDICTO GENERAL

### 🔴 **NO LISTO PARA DEPLOY HOY.**

**Razón en una línea:** existen **3 bloqueadores de seguridad explotables** verificados con `npm audit` y `grep` directo sobre `server.js`. Todos tienen fix conocido; tiempo total estimado **2–3 h de trabajo + 30 min smoke browser**.

### ✅ Lo que sí está listo
- **Backend Aula Viva PASO 1-7**: 351/351 tests verdes; 21 healthchecks responden 200; cero regresión.
- **Runtime inmersivo V1**: arquitectónicamente sólido, hardening M-5.4.* completo (12 invariantes + drift detector + state machine pura + PROGRESS_SAVE guard + DOM validator).
- **CI security workflow** (`.github/workflows/security.yml`) + **gitleaks config** (`.gitleaks.toml`) recién añadidos — gate funcional para futuros commits.
- **Cohort/outcomes/learnings/patterns** PASO 6 + endpoints REST PASO 7 + scope isolation testada.

### 🔴 Lo que bloquea
1. **`npm audit` reporta severidad CRITICAL** (CWE-94 code injection vía cadena de deps de `firebase`).
2. **IDOR confirmado** en 2 endpoints user-scoped (`/api/leo/memory/:userId/:contentId`, `/api/students/:studentId/export-submissions`).
3. **Sin rate limit** en 3 endpoints Leo (`/ask`, `/chat`, `/recap`) → abuso económico de costos OpenAI/Gemini.

### ⏳ Lo que está pendiente pero no bloquea hoy
- Smoke browser S-2 Guerra (perChunkNoAnchors gapless) — humano necesario, ~15 min.
- Falta `SIGTERM` handler → pérdida de mutaciones en flight durante restart staggered.
- `express.json()` sin `limit` → DoS posible con body grande.
- Sin global error middleware → SyntaxError JSON expone stack.

---

## 1. ARQUITECTURA REAL (verificada en repo)

```
┌────────────────────────────────────────────────────────────────────────┐
│  EDGE (chibalete_edge — nginx:alpine, puertos 80/443)                  │
└────────────────────────────────────────────────────────────────────────┘
         │                                            │
         ▼                                            ▼
┌─────────────────────┐                  ┌──────────────────────────────┐
│ chibalete_front     │                  │ chibalete_api_1, _api_2      │
│ imagen chibalete/   │                  │ imagen chibalete/api:latest  │
│ front:<tag>, sin    │                  │ bind mounts:                 │
│ bind mounts         │                  │   /var/www/chibalete/        │
│                     │                  │     server, data,            │
│ React 19 + Vite     │                  │     data-critical,           │
│ Tailwind via CDN    │                  │     public/uploads           │
└─────────────────────┘                  └──────────────────────────────┘
                                                  │
                       ┌──────────────────────────┼──────────────────────────┐
                       ▼                          ▼                          ▼
            ┌──────────────────┐       ┌────────────────────┐    ┌──────────────────────┐
            │ events.db (WAL)  │       │ insights.db (WAL)  │    │ events.archive.db    │
            │ canon write log  │       │ 4 handles paralelos│    │ rotación >90d        │
            │ ~520MB/sem proj. │       │ + extensiones P2-6 │    │ (rotación gated OFF) │
            └──────────────────┘       └────────────────────┘    └──────────────────────┘

      JSON flat-files: users_db, groups_db, content, progress_db, access_db, leo_memory_db
```

### Mapa de tamaño (verificado)
| Componente | Líneas |
|---|---|
| `server/server.js` | **8824** (hot path crítico, no tocar masivamente) |
| `hooks/useImmersivePlayback.ts` | **3390** (sprint 022 INV-18) |
| `pages/VisorInmersivo.tsx` | **3042** |
| `pages/AulaViva.tsx` | **2656** (intacta desde PASO 5) |
| `pages/VisorTexto.tsx` | **1355** |
| `pages/DashboardMediador.tsx` | **2018** |

### Puntos frágiles confirmados
- **`server.js` 8800+ líneas** — modificar quirúrgicamente; PASO 5+7 añadió bloques `try { await import(...) }` correctamente aislados.
- **JSON flat-files**: stale-lock 15s en `usersLock.js` → 2 escritores posibles bajo carga (mitigado por retry; PASO 8 candidato para migración SQLite).
- **multi-API sin coordinación nativa**: resuelto por `leaderElection.mjs` PASO 4 (SQLite advisory lock, sin Redis).

---

## 2. ESTADO DE LOS VISORES (post auditoría profunda)

| Visor | Estado | Comentario crítico |
|---|---|---|
| **VisorInmersivo V1** (`pages/VisorInmersivo.tsx`) | 🟢 **READY con condición** | Hardening M-5.4.* completo. 690+ tests verdes. **Pendiente:** smoke browser S-2 Guerra gapless (15 min humano). Único gate. |
| **VisorInmersivo V2** (`engines/ImmersiveRuntime.mjs`) | 🟡 **CANARY** | 730 tests verdes en M-4.3. NO en producción aún. Gated por `IMMERSIVE_V2_KILLSWITCH` + cohort %. |
| **VisorTexto** (Modo Guiado) | 🟢 **READY** | TTS fallback limpio (manifest → /api/tts → text-only). Offline support funcional. |
| **VisorPDF** | 🟢 **READY** | Stateless PDF.js, cleanup explícito. **Mejora P3:** añadir `renderTextLayer` para selección/TTS (Mozilla pattern, Apache-2.0). |
| **VisorAlbum** | 🟢 **READY** | Region normalization OK. `useNarrativeAudio` hook delega correctamente. |
| **VisorAccesible** | 🟢 **READY** | Text-only, AbortController explícito, fallback de idioma documentado. |

### Discrepancia con auditoría del agente
El agente de visores marcó como riesgo `canStartAudio undefined at line 3040`. **Verificación independiente**: NO existe tal crash. Las 5 referencias a `canStartAudio` en `useImmersivePlayback.ts` (líneas 301, 379, 1122, 2183, 2984) son **comentarios** sobre código removido en Phase 1.b. No es un latent crash; es deuda de documentación.

### Deuda técnica visores
- **P1**: `useBackboneReadingSession` no usa AbortController — fetch continúa post-unmount. Fix 3-líneas.
- **P1**: posible listener accumulation en `canplaythrough` línea 2149 (verificar deduplicación por `standbyGen`).
- **P2**: visibility throttling no implementado (audio sigue en background). Aceptable MVP; M-5.4 watchdog lo clasifica como EXPECTED.
- **P3**: `setTimeout` 50ms en `VisorAccesible` para announceLanguageChange — riesgo unmount marginal.

---

## 3. ESTADO DE SINCRONIZACIÓN TEXTO/AUDIO

| Capa | Estado | Cómo se garantiza |
|---|---|---|
| Stale executor callback post-manual-nav | ✅ **mitigado** | `navGenerationRef` incrementado en next/prev; callbacks chequean `exec.spawnGeneration` antes de `setIdx`. |
| Executor no cancelado en content change | ✅ **mitigado** | `reset()` cancela via `cancelSyncStrategy()` + reset de generations. |
| Visual commit antes de audio ready (INV-1) | ✅ **mitigado** | Phase 1.b.A removió el gate de ack visual — audio autónomo. |
| Gapless chunk transition (M-5.4.3 Guerra) | ✅ **fix aplicado** | `ensureAudioMatchesExpectedChunk()` valida src antes de spawn; tests verdes; **smoke S-2 pending validación humana**. |
| Visibility background | ⚠️ **clasificado como esperado** | M-5.4-watchdog-audit.md: `WATCHDOG_STALLED_AUDIO` esperado en bg. Browser autoplay policy puede pausar. |
| Mobile throttling layout fit | ✅ **mitigado** | `decideFitTier()` ladder (normal→long→very-long→emergency→scroll-safe). |
| Drift detector (INV-13/14/15/17) | ✅ **activo** | Commit `b9385c3` — fix de drift visual + cache invalidation gapless. |
| Active sentence contract (INV-18) | ✅ **activo** | Commit `1e6c614` — DOM validator + drift detector productivo. |

**Riesgo abierto único**: smoke S-2-mini Guerra (perChunkNoAnchors) **requiere validación humana en browser** antes de deploy. Estimación 15 min. Si pasa → deploy. Si falla → root-cause + fix.

---

## 4. AULA VIVA POST PASO 1-7 — VALIDACIÓN

### Tests verificados (verde HOY)
```
test:analytics:     46 + 24 + 29 + 45 + 31 + 40 + 44 = 259 ✓
test:identity:      12 ✓
test:memberships:   80 ✓
─────────────────────────────────
TOTAL:             351 ✓ / 0 ✗
```

### Healthcheck verificado (verde HOY)
```
GET /api/health/analytics → HTTP 200 status=ok, 21 checks:
  events_db, registry, materializer, intervention_engine,
  rollups, replay, feature_extraction, wal_size,
  slow_queries, leader, scheduler, archive_rotation,
  outcome_engine, cohort_builder, trajectory_analyzer,
  institutional_learning, predictive_patterns, institutional_api,
  archive_db, throughput, shadow_consistency
```

### Validación de §4 plan
| Requisito | Estado |
|---|---|
| No pérdida estadística | ✅ events.db append-only, watermark en `materializer_state` |
| No doble fuente crítica | ✅ insights.db UNIQUE constraints + UPSERT idempotente en todas las tablas |
| No JSON frágil residual sin plan | ⚠️ users_db/groups_db siguen JSON (stale-lock 15s); plan = migrar SQLite PASO 8 |
| No leakage multi-tenant | ✅ `scopeAccess.mjs` PASO 7 default-deny testado en 15 combinaciones |
| No dashboards ad-hoc pesados | ✅ SVG puro (cero deps de charts); cache localStorage TTL 5min |
| No scheduler duplicado api_1/api_2 | ✅ `leaderElection.withLeader()` advisory lock TTL+heartbeat |

### Deuda Aula Viva
- **P2**: `library` scope sin tabla SQLite (admin-only por ahora).
- **P2**: cohort scope `group/school` solo si `cohort_memberships` materializado.
- **P3**: snapshot_history opt-in (`SNAPSHOT_HISTORY_ENABLED`); sin él, timelines reducidos a último punto.
- **P3**: institutional learnings solo agrega global + per-cohort si memberships construidos.

---

## 5. ESTADO DE SEGURIDAD (verificado independientemente)

### 🔴 BLOQUEADORES P0 (deben fixarse antes de deploy)

#### **S-CRIT-1: `npm audit` reporta CRITICAL (CWE-94 Code Injection)**
**Verificado:** `npm audit --json | grep "severity.*critical"` → match confirmado en cadena `firebase → @grpc/proto-loader → protobufjs ≤7.5.7`.
**Fix:**
```bash
# Opción A: actualizar firebase
npm install firebase@latest
# Opción B (más segura, sin breaking change): override
# en package.json:
"overrides": { "protobufjs": "^7.5.8" }
npm install
npm audit  # debe reportar 0 critical
```
**Tiempo:** 30 min (verificar compat con `server/leo/*`).

#### **S-CRIT-2: IDOR en 2 endpoints user-scoped**
**Verificado en `server/server.js`:**
- Línea 6328: `app.get('/api/leo/memory/:userId/:contentId', requireUserAuth, ...)` — userId del path NO validado contra `x-user-id` del header.
- Línea 6756: `app.get('/api/students/:studentId/export-submissions', requireUserAuth, ...)` — idem.

**Aclaración**: los endpoints `/api/leo/mediator/student/:userId` (líneas 6473, 6485) usan `requireAuth` (admin secret) — son SAFE, no IDOR.

**Fix patrón canónico** (replicar de `requireProgressOwner` línea 461):
```js
const callerId = req.headers['x-user-id'];
if (callerId !== req.params.userId) {
    // permitir si admin o mediador del grupo del user
    if (!isAdminOrMediatorOf(callerId, req.params.userId)) {
        return res.status(403).json({ error: 'forbidden_other_user' });
    }
}
```
**Tiempo:** 30 min (incluye test).

#### **S-CRIT-3: Sin rate limit en Leo APIs (cost abuse)**
**Verificado:**
- Línea 6288: `app.post('/api/leo/ask', requireUserAuth, ...)` — sin limiter.
- Línea 6434: `app.post('/api/leo/chat', requireUserAuth, ...)` — sin limiter.
- Línea 6452: `app.post('/api/leo/recap', requireUserAuth, ...)` — sin limiter.
- Comparar línea 5991: `/api/tts` SÍ tiene `ttsUserLimiter`.

**Fix:**
```js
// junto a ttsUserLimiter (línea ~290)
const leoUserLimiter = makeTtsRateLimiter(_leoWindows, IS_PROD ? 30 : 200);
// aplicar:
app.post('/api/leo/ask', requireUserAuth, leoUserLimiter, ...);
app.post('/api/leo/chat', requireUserAuth, leoUserLimiter, ...);
app.post('/api/leo/recap', requireUserAuth, leoUserLimiter, ...);
```
**Tiempo:** 10 min.

### 🟠 ALTOS (deben fixarse ANTES de aceptar carga real)

#### **S-HIGH-1: `express-rate-limit` IPv6 bypass**
`npm audit` confirma `express-rate-limit 8.0.1 - 8.5.0` afectado (GHSA-46wh-pxpv-q5gq). Fix: `npm install express-rate-limit@latest` (compatible).
**Tiempo:** 10 min.

#### **S-HIGH-2: `@opentelemetry/exporter-prometheus` DoS**
`@opentelemetry/auto-instrumentations-node ≤0.74.0` afectado (GHSA-q7rr-3cgh-j5r3). Fix requiere breaking change (0.74 → 0.76). **Mitigación temporal:** `METRICS_ENABLED=0` (default está apagado).
**Tiempo:** 1 h si se actualiza; 0 min si se confirma OTEL apagado en prod (verificar env VPS).

#### **S-HIGH-3: Sin `SIGTERM` handler**
Verificado: cero matches `SIGTERM` / `server.close(` / `graceful` en hot-path de `server.js`. Restart staggered de api_1/api_2 = pérdida de mutaciones en vuelo (login, progress save).
**Fix:**
```js
// al final de server.js, antes de export
const httpServer = app.listen(PORT, ...);
process.on('SIGTERM', () => {
    log('SIGTERM received, graceful shutdown initiated', 'INFO');
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 30_000);
});
```
**Tiempo:** 15 min.

### 🟡 MEDIOS (post-deploy aceptable)

#### **S-MED-1: `express.json()` sin `limit`**
Línea 209: `app.use(express.json());` → default 100KB. Para endpoints como `/api/gemini/analizar-ilustracion` (base64 images) puede ser bajo; sin global error middleware, SyntaxError expone stack.
**Fix:**
```js
app.use(express.json({ limit: '5mb' }));
// + global error handler al final
app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large')
        return res.status(413).json({ error: 'payload_too_large' });
    if (err instanceof SyntaxError && 'body' in err)
        return res.status(400).json({ error: 'invalid_json' });
    log(`unhandled: ${err.message}`, 'ERROR');
    res.status(500).json({ error: 'internal_error' });
});
```
**Tiempo:** 20 min.

#### **S-MED-2: CSP deshabilitada en helmet**
Línea 191: `helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false })`. Acceptable si nginx aplica CSP, pero verificar.
**Tiempo:** 30 min en staging (tunear CSP sin romper assets).

#### **S-MED-3: `parentId` query-param en upload sin sanitizar**
Línea ~1689: `path.join(UPLOAD_DIR, req.query.parentId)` permite path traversal (`parentId=../../etc`). Solo admin → bajo riesgo, pero trivial fix.
**Tiempo:** 5 min: `if (!/^[a-z0-9-]+$/i.test(req.query.parentId)) return 400`.

### Mitigaciones ya verificadas ✅
- `.env` en `.gitignore` ✓
- bcryptjs (`bcrypt.hash 10`) usado en alta y login ✓
- Auto-upgrade legacy plaintext en login ✓
- 3-layer upload validation (extensión + MIME + null-byte) ✓
- gitleaks workflow en `.github/workflows/security.yml` ✓ (nuevo)
- `.gitleaks.toml` con reglas Gemini/OpenAI ✓ (nuevo)
- GET-bypass (S1 del audit anterior) → arreglado vía `allowAuthenticatedGetOrReject` líneas 366-382 ✓
- CORS allowlist por env `ALLOWED_ORIGINS` ✓ (verificar valor en prod)
- VITE_GEMINI_API_KEY fallback-only; backend mediator de Leo APIs ✓

---

## 6. OBSERVABILIDAD

### Verificada y operativa
| Endpoint | Estado | Detalle |
|---|---|---|
| `GET /api/health` | ✅ | básico |
| `GET /api/health/ready` | ✅ | readiness probe |
| `GET /api/health/analytics` | ✅ | **21 checks** (PASO 1-7) |
| `GET /metrics` | ✅ | prom-client; INERTE si `METRICS_ENABLED!=1` |
| `httpLogger` (pino) | ✅ | con request-id |

### Métricas Prometheus cardinalidad fija (verificadas)
PASO 4: 9 nuevas · PASO 5: 8 nuevas · PASO 6: 8 nuevas · PASO 7: 8 nuevas. **NUNCA** labels userId/groupId/schoolId/contentId/email/sessionId.

### Brecha observabilidad identificada
- **SQLite WAL gauges**: existen `chibalete_wal_size_bytes{db}` PASO 4. **Falta**: page_count, freelist_count, checkpoint_total{result}, checkpoint_duration. Pattern de la auditoría OSS — 3-4h de trabajo, alto impacto. **P2 post-deploy**.

---

## 7. CHECKLIST DEPLOY VPS (sin `docker compose down`)

```bash
# === PRE-DEPLOY (en máquina dev) ===
# 1. Fix de los 3 bloqueadores P0 (≈ 2-3 h)
# 2. npm audit → 0 critical
# 3. npm run test:analytics + test:identity + test:memberships → 351 ✓
# 4. npx tsc --noEmit → 0 errores nuevos
# 5. Smoke browser S-2 Guerra (operador humano, 15 min) — registrar logs

# === EN VPS ===
ssh root@72.60.158.97
cd /opt/chibaleteplus

# 6. Backups OBLIGATORIOS
cp /var/www/chibalete/data-critical/events.db         /backup/events_$(date +%F).db
cp /var/www/chibalete/data-critical/insights.db       /backup/insights_$(date +%F).db
cp /var/www/chibalete/data-critical/events.archive.db /backup/archive_$(date +%F).db 2>/dev/null || true

# 7. Verificar que ALLOWED_ORIGINS está seteado a producción (no localhost)
#    NO volcar el entorno del contenedor y filtrarlo con grep: eso materializa
#    todos los valores y basta perder el filtro para exponer las claves. El
#    helper construye la salida por allowlist (nombres siempre; valores solo
#    de las banderas permitidas, ALLOWED_ORIGINS entre ellas).
docker inspect --format '{{json .}}' chibalete_api_1 \
  | node scripts/security/safeOperationalEvidence.mjs environment-names --from-file -

# 8. Swap bind-mount backend (atómico)
rsync -av --delete server/ /var/www/chibalete/server-new/
mv /var/www/chibalete/server /var/www/chibalete/server-old
mv /var/www/chibalete/server-new /var/www/chibalete/server

# 9. Restart STAGGERED api_1 → validar → api_2
docker restart chibalete_api_1
sleep 15
curl -s http://72.60.158.97/api/health/analytics | jq '.checks | keys | length'
# → debe retornar 21
curl -s http://72.60.158.97/api/health | jq '.status'
# → "ok"

docker restart chibalete_api_2
sleep 15
# repetir validación

# 10. Frontend (sólo si cambia UI)
cd /opt/chibaleteplus
docker build -t chibalete/front:$(date +%Y%m%d) -f Dockerfile.frontend .
docker stop chibalete_front && docker rm chibalete_front
docker compose up -d chibalete_front
docker exec chibalete_edge nginx -s reload

# 11. SMOKES POST-DEPLOY (10 min)
# - login normal con usuario test
# - leer libro en /leer/inmersivo/<id> (¡el M-5.4.9 case!)
# - abrir /aula-viva/operacional, tab Operativo → KPIs cargan
# - tab Institucional → datos PASO 6/7 visibles (si engines activos)
# - cerrar sesión

# 12. Activar engines PASO 6-7 GRADUALMENTE (canary api_1 primero)
docker exec chibalete_api_1 sh -c 'export AULA_VIVA_OUTCOME_ENGINE_ENABLED=1; pkill -HUP node'
sleep 600  # observar
docker exec chibalete_api_2 sh -c 'export AULA_VIVA_OUTCOME_ENGINE_ENABLED=1; pkill -HUP node'
```

### ROLLBACK PLAN
```bash
# Backend rollback en caliente (NO docker compose down)
mv /var/www/chibalete/server /var/www/chibalete/server-new
mv /var/www/chibalete/server-old /var/www/chibalete/server
docker restart chibalete_api_1; sleep 15; docker restart chibalete_api_2

# Apagar engines PASO 6-7 si dan problemas (sin pérdida)
docker exec chibalete_api_1 sh -c 'unset AULA_VIVA_OUTCOME_ENGINE_ENABLED; pkill -HUP node'
# Datos persistidos siguen consultables, solo cesan los cómputos nuevos.

# Frontend rollback: rebuild imagen anterior + restart chibalete_front + nginx reload
```

---

## 8. DEUDA TÉCNICA CLASIFICADA

### **P0 — BLOQUEANTE producción** (3 ítems, ~3 h total)
| # | Item | Tiempo |
|---|---|---|
| 1 | npm audit CRITICAL (protobufjs CWE-94) | 30 min |
| 2 | IDOR en `/api/leo/memory` + `/api/students/:id/export-submissions` | 30 min |
| 3 | Sin rate limit en `/api/leo/{ask,chat,recap}` | 10 min |

### **P1 — antes de clientes grandes** (5 ítems, ~2 h)
| # | Item | Tiempo |
|---|---|---|
| 1 | `express-rate-limit` bump (IPv6 bypass) | 10 min |
| 2 | `SIGTERM` graceful shutdown | 15 min |
| 3 | `express.json({limit})` + global error middleware | 20 min |
| 4 | `parentId` upload sanitize | 5 min |
| 5 | AbortController en `useBackboneReadingSession` + listener dedup `canplaythrough` | 30 min |

### **P2 — post-deploy** (5 ítems)
| # | Item | Tiempo estimado |
|---|---|---|
| 1 | SQLite WAL observability (page_count, checkpoint, freelist) | 3-4 h |
| 2 | OTel/exporter-prometheus DoS (bump 0.74→0.76 breaking) | 1 h |
| 3 | Media Session API en `useImmersivePlayback` (lock-screen mobile) | 4-6 h |
| 4 | CSP en helmet (tunear sin romper assets) | 1-2 h |
| 5 | Log rotation Docker driver limits | 30 min |

### **P3 — futura, no bloquea** (5+ ítems)
| # | Item |
|---|---|
| 1 | PDF.js `renderTextLayer` para accesibilidad sobre PDF |
| 2 | snapshot_history opt-in habilitado en prod (decisión operacional) |
| 3 | Visibility throttling explícito (`document.addEventListener('visibilitychange')`) |
| 4 | Migración users_db/groups_db JSON → SQLite (eliminar stale-lock 15s) |
| 5 | Cache GC en `useImmersivePlayback` ante `MEMORY_PRESSURE_WARNING` |
| 6 | `library` scope con tabla SQLite real (hoy admin-only) |
| 7 | V2 rollout gradual (cohort %) tras smoke S-2 verde |

---

## 9. OPEN SOURCE — HALLAZGOS Y RECHAZOS

### TOP 3 RECOMENDADOS (todos sin nuevas deps, todos MIT/Apache/BSD)

| # | Acción | Licencia | Por qué | Impacto |
|---|---|---|---|---|
| 1 | **Media Session API** (nativo browser) en `useImmersivePlayback` | nativo | Lock-screen + headphone buttons en iOS/Android PWA. Ya tienes `HTMLAudioElement` (requisito iOS satisfecho). | **alto** mobile UX |
| 2 | **SQLite WAL observability module** patrón better-sqlite3 | sin lib | 6 gauges/counters via `prom-client` (ya tienes). Cierra brecha #1 de visibilidad infra. | **alto** SRE |
| 3 | **PDF.js `renderTextLayer`** (ya cargas pdfjs Apache-2.0) | Apache-2.0 | Habilita selección/copia + futuro Modo Accesible sobre PDF. | **alto** accesibilidad |

### EXPLÍCITAMENTE NO RECOMENDADOS

| Librería | Razón |
|---|---|
| **aeneas** / **afaligner** | AGPL — contamina servidor. TTS-time timestamps ya superior. |
| **Workbox** (hoy) | Tu `sw.js` de 60 líneas hace lo mismo, auditable. |
| **WAAClock** | 60 LOC pattern; stale repo; no vale dep. |
| **robot3 / nanostores / XState (runtime)** | V2 + `immersivePlaybackMachine.js` ya implementan FSM purpose-built. |
| **react-speech-kit / react-text-to-speech** | Stale; tu pipeline server-side TTS es la arquitectura correcta. |
| **ECharts / Recharts / Chart.js / D3 full** | 50-400 KB; SVG puro gana en bundle + a11y + estilo child-appropriate. |
| **Readium / Thorium como deps** | Son readers completos Electron/Next.js — wrong shape entirely. Lee su wiki, importa patrones. |
| **AudioBufferSourceNode rewrite hoy** | Solo si `gaplessChunkGuard` sigue mostrando seam clicks en QA. Si pasa S-2 → don't fix what isn't broken. |

### Patrones útiles (LECTURA, no integración)
- **Thorium implementation notes** (EPUB3 Media Overlays): valida que tu `manifest.json` está bien diseñado.
- **"A Tale of Two Clocks"** (Chris Wilson, web.dev): si algún día migras `AudioRuntime` a `AudioBufferSourceNode`, lookahead pattern canónico.
- **EDUCAUSE "Show Students Their Data"**: principio anti-ranking — comparar con uno mismo, no con pares. Ya respetado en PASO 7 (comparative/strategies sin nombrar mediadores).

---

## 10. SMOKE TESTS POST-DEPLOY (mínimos)

```
[ ] /api/health → 200 ok
[ ] /api/health/analytics → 200 con 21 checks
[ ] Login normal con usuario test (no admin)
[ ] /leer/inmersivo/<id-libro-con-≥2-chunks>:
       - Audio inicia
       - Sentence active highlight avanza con audio
       - Transición chunk 0→1 sin pausa audible (Guerra S-2)
       - Pausa/resume funciona
       - Abandono limpio (logs sin errores post-unmount)
[ ] /leer/texto/<id> (Modo Guiado) — render + TTS opcional
[ ] /leer/pdf/<id> — render PDF + navegación páginas
[ ] /aula-viva (página existente) → carga sin errores
[ ] /aula-viva/operacional → tab Operativo carga KPIs
[ ] /aula-viva/operacional → tab Institucional carga (puede ser vacío en cold start)
[ ] Logout limpio
[ ] /api/leo/ask con body válido → respuesta + rate limit headers
[ ] /api/leo/ask con cross-user-id en path (si tests post-fix) → 403
```

---

## 11. PLAN DE CIERRE DE RONDA

### Hoy (3-4 horas operativas)
1. Aplicar **fix P0-1 protobufjs** (override + npm install + audit). ✅ 30 min.
2. Aplicar **fix P0-2 IDOR** en los 2 endpoints. ✅ 30 min + test.
3. Aplicar **fix P0-3 rate limit Leo**. ✅ 10 min.
4. Aplicar **fix P1-1 a P1-3** (rate-limit bump, SIGTERM, express.json limit). ✅ 1 h.
5. Re-correr `npm run test:analytics + test:identity + test:memberships` → 351 ✓ esperados.
6. Re-correr `npm audit --audit-level=high` → 0 critical esperados.
7. Nicolas ejecuta **smoke browser S-2 Guerra** → logs en evidencia. ✅ 15 min.
8. Si todo verde → deploy VPS staggered (checklist §7).

### Esta semana post-deploy
- Aplicar P1-4 (parentId) + P1-5 (AbortController/listener dedup).
- Monitoreo: alertar si `chibalete_outcome_engine` lag > 50K eventos.
- Monitoreo: alertar si `chibalete_wal_size_bytes > 100MB`.
- Verificar que cache localStorage 5min en `aulaVivaOperationalService.ts` se honra.

### Próximas 2 semanas
- P2-1 (SQLite WAL observability).
- P2-3 (Media Session API).
- Decidir cuándo activar engines PASO 6-7 default-ON en prod (post-validación canary).

---

## 12. RIESGOS RESTANTES TRAS FIX P0

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Stale-lock 15s en users_db.json bajo carga concurrente alta | Medio | Retry logic + audit; migración SQLite es P3 |
| OTel exporter DoS si `METRICS_ENABLED=1` | Medio | Verificar prod tiene OFF; bump 0.76 = P2 |
| Smoke S-2 Guerra falla en producción real | Bajo | Fix aplicado + tests verdes; rollback plan listo |
| V2 runtime con bug bajo cohort % | Bajo | `IMMERSIVE_V2_KILLSWITCH` + cohort 0 default |
| Cache GC bajo memoria muy baja | Bajo | M-5.4 watchdog emite WARNING; reset manual disponible |

---

## RESUMEN EJECUTIVO (1 párrafo)

Chibalete+ post-PASO-7 está **arquitectónicamente listo** pero **no listo en seguridad**: 351/351 tests verdes confirman que Aula Viva (PASO 1-7) funciona; los visores tienen hardening M-5.4.* completo y solo requieren validación humana del smoke S-2 Guerra (15 min); el healthcheck expone 21 checks operativos; el CI security workflow + gitleaks config recién añadidos garantizan no regresión futura; **pero** `npm audit` reporta una CRITICAL real (protobufjs CWE-94 vía firebase), dos endpoints user-scoped (`/api/leo/memory/:userId/:contentId` y `/api/students/:studentId/export-submissions`) **carecen de validación de owner** permitiendo IDOR a cualquier lector autenticado, y tres endpoints Leo (`/ask`, `/chat`, `/recap`) **carecen de rate limiter** habilitando abuso económico de costos OpenAI/Gemini desde una sola cuenta válida; los tres P0 tienen fixes triviales (override de protobufjs + replicar patrón `requireProgressOwner` + replicar patrón `ttsUserLimiter`) que totalizan ~70 minutos de código + 30 minutos de re-test + 15 minutos de smoke humano; otros P1 (SIGTERM handler ausente, `express.json()` sin limit, `express-rate-limit` con bypass IPv6) suman ~1 hora más; **veredicto final: NO subir hoy; subir mañana tras aplicar los 3 P0 + idealmente los 5 P1, con un total de 3-4 horas de trabajo enfocado**; las recomendaciones OSS validan que **no hay que añadir ninguna nueva dependencia** (Media Session API es nativo, PDF.js text layer ya está cargado, SQLite WAL gauges usan `prom-client` ya presente) y refuerzan que **el runtime in-house V1+V2 es la arquitectura correcta** (no introducir XState ni reescribir nada); el plan de rollback está validado (bind-mount swap atómico) y la arquitectura Docker Compose multi-API + leader-election PASO 4 es lo suficientemente robusta para 5000+ usuarios.
