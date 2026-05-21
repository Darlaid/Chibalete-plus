# AUDITORÍA ESTRUCTURAL PROFUNDA — CHIBALETE+

**Fecha:** 2026-05-19
**Rama auditada:** `sprint-022/operational-stack`
**Tipo:** Auditoría read-only. No se modificó código de producción.
**Método:** Lectura directa de fuente + 4 auditores especializados en paralelo + verificación primaria de los 5 hallazgos CRÍTICOS.

> Principio rector: *"No estás auditando una app web simple. Estás auditando un sistema operativo de lectura."* — La conclusión confirma esa premisa. Chibalete+ es un sistema con un runtime de medios en tiempo real, un modelo de acceso por capas server-authoritative, y una topología multi-proceso con persistencia de archivos plana. La complejidad es real y mayormente está **bien intencionada pero estructuralmente sobre-extendida**.

---

## FASE 1 — MAPA GLOBAL (ARQUITECTURA REAL, NO IDEALIZADA)

### 1.1 Árbol arquitectónico efectivo

```
INTERNET :80/:443
   │
   ▼  [chibalete_edge — nginx:alpine]  ◄── SPOF · TLS solo en VPS (NO en repo)
   │   chibalete_net (bridge)
   ├──────────────┬───────────────────┐
   ▼              ▼                   ▼
chibalete_front  chibalete_api_1   chibalete_api_2     ◄── 2 procesos Node
(estático)        └────────┬──────────┘                    NO son réplicas:
                           ▼  BIND MOUNTS COMPARTIDOS       mutan los MISMOS archivos
              /var/www/chibalete/{data, data-critical, public/uploads, server, utils}

PERSISTENCIA EFECTIVA (híbrida — hallazgo clave):
  ├─ SQLite WAL  → progress.db, events, insights      [path caliente, YA migrado ✅]
  └─ Flat JSON   → users, groups, content, access, schools, sections,
                   bundles, submissions, leo_memory, analytics, interventions,
                   user_audit_log                      [techo de escalabilidad ⚠️]
```

### 1.2 Mapa de runtimes (4 runtimes coexistiendo)

| Runtime | Ubicación | Estado real |
|---|---|---|
| **Frontend SPA** | React 19 + Vite, archivos en raíz (no `/src`), HashRouter, 2 contexts (Auth/Offline), estado global en singleton `dataService` (4.8 kLOC, NO reactivo a React) | Productivo |
| **Backend API** | `server/server.js` (**8.701 líneas** — CLAUDE.md dice 1.946, **dato desactualizado**), Express 5, JSON flat-file + SQLite WAL | Productivo, 2 procesos |
| **Runtime Inmersivo V1** | `hooks/useImmersivePlayback.ts` (3.341 L) + `utils/immersivePlaybackMachine.js` + `pages/VisorInmersivo.tsx` (2.999 L) — acoplado al render React | **Productivo (el peor de los dos)** |
| **Runtime Inmersivo V2** | `engines/*.mjs` + `utils/immersiveV2/*` — FSM real, independiente de React, isolation-audited | **Construido, probado, MUERTO tras dev-flag** |

### 1.3 Mapa de dependencias críticas

```
Frontend ──► dataService (singleton) ──► /api/* (header x-user-id)
         ──► geminiService ──► GoogleGenAI DIRECTO ⚠️ (key en bundle)
         ──► CDN: Tailwind, PDF.js, fonts, aistudiocdn.com (importmap fantasma)
Backend  ──► OpenAI SDK + Gemini SDK (keys en process.env, proxied OK)
         ──► better-sqlite3 (MIT, EN USO real para progreso)
         ──► firebase@12.10 ──► protobufjs 7.5.4 ⚠️ RCE (GHSA-xq3m-2v4x-88gg)
         ──► multer 1.4.5-lts.1 (EOL), pdf-parse, file-type (zip-bomb), archiver
```

### 1.4 Flujos principales

1. **Acceso a contenido (robusto):** `useAccessCheck`/`AccessWrapper` → `GET /api/content/:id/access` → engine por capas `user→group→organization→legacy→fallback`, árbitro temporal server-side, anti-spoof de `userId`. **Bien diseñado, preservar.**
2. **Progreso de lectura (robusto):** heartbeat → `dataService` (dedupe por hash, `keepalive`, cola de fallidos persistida, LWW por `updatedAt`) → `/api/progress/.../sync` → **SQLite WAL** (resolvió la race cross-proceso). **Modelo a replicar.**
3. **Lectura inmersiva (frágil):** ver FASE 3.
4. **Membresía Aula Viva (robusto):** locks anidados consistentes `groups→users`, invariante `studentIds==memberIds`, fallback-extinction guard con audit trail. **Preservar.**
5. **Deploy (sólido en código, frágil en datos):** swap atómico de bind-mount + restart escalonado api_1→validar→api_2 con auto-rollback. Backups solo on-host.

### 1.5 Estado de madurez global

| Subsistema | Madurez | Veredicto |
|---|---|---|
| Modelo de acceso por capas | ★★★★☆ | Maduro, server-authoritative real |
| Integridad de membresía (Aula Viva) | ★★★★☆ | Maduro, locks + invariantes + audit |
| Sync de progreso (resiliencia) | ★★★★☆ | Maduro (cola fallidos + LWW + SQLite) |
| Accesibilidad (Modo Accesible) | ★★★★★ | Excelente, WCAG 2.2 + axe-CI — pero **siloado** |
| Persistencia (JSON flat-file) | ★★☆☆☆ | Techo de escala, riesgo de corrupción multi-proceso |
| Runtime Inmersivo | ★★☆☆☆ | Beta desktop happy-path; no production-grade |
| Seguridad (auth perimetral) | ★☆☆☆☆ | **GET-bypass + creds en history = explotable hoy** |
| Observabilidad | ★☆☆☆☆ | `console.log` efímero, sin métricas/alertas |
| DevOps / DR | ★★☆☆☆ | Scripts buenos; SPOF + backups on-host |
| Supply chain | ★★☆☆☆ | 17 vulns (1 crítica RCE), sin SCA en CI |

---

## FASE 2 — FRONTEND (resumen de hallazgos)

- **2 contexts reales** (Auth/Offline) — *no* hay context-explosion; el problema es el opuesto: **todo el estado de datos vive en un singleton `dataService` no reactivo** → clase entera de bugs de UI stale (parchados con `reloadUsers()` y refetches manuales). **ALTO, estructural.**
- **`dataService.ts`**: 4.832 líneas, god-object, motor de sync resiliente (esto último **excelente**). Cache de acceso/school con stale-while-revalidate bien hecho, pero **falla OPEN** en cold-cache de school config (fuga de títulos, no de contenido — server es autoritativo).
- **`geminiService.ts:35,43`**: API key Gemini embebible en el bundle (`VITE_*` se inlinea). Hay intento defensivo pero la ruta existe. **CRÍTICO si la key está en build env (lo está).**
- **Offline roto:** sin service worker, PDF.js solo CDN, `offlineService.getBook()` sin consumidores. La promesa de "descargar 3 libros y leer offline" **no está cableada end-to-end. CRÍTICO de integridad de producto.**
- **Accesibilidad: REAL, no cosmética** — `components/accesible/` + `scripts/a11y-baseline.mjs` (axe-core wcag2a/2aa/21aa/22aa en CI). **El subsistema mejor diseñado de la app.** Pero confinado al Modo Accesible; el resto de la UI no cumple ese estándar.
- **Mobile: parcial/frágil.** `useDevice` solo `resize`, flash desktop→mobile, `MobileOrientationOverlay` bloquea portrait sin escape (problema a11y). HashRouter + CDN-everything + sin SW → un wrapper nativo requeriría retrabajo significativo.
- **Bundle:** `index.html` tiene un **importmap fantasma a `aistudiocdn.com`** duplicando deps ya bundleadas por Vite — footgun supply-chain. ErrorBoundary único en raíz, solo `console.error` (sin telemetría).

---

## FASE 3 — RUNTIME INMERSIVO (el corazón frágil)

**Veredicto: frágil y sobre-ingenierizado, NO estructuralmente estable.** El happy-path desktop funciona; los bordes (tab-hide, autoplay-block, audio chunked, red lenta, mobile) son riesgosos.

- **V1 vs V2:** V2 (`engines/*.mjs`) es la **arquitectura correcta** (FSM real, independiente de React, OperationQueue, store observable, isolation-audited). **Pero V1 — el inferior, acoplado al render React — es lo que corre todo usuario.** Dual-maintenance severo: se construye y testea V2 mientras se shippea V1.
- **Máquina de estados observacional, no autoritativa:** el reducer puro (`immersivePlaybackMachine.js`) existe y es correcto en aislamiento, pero `executeMachineEffects` **no ejecuta** `play_audio/pause/save/cancel` (no-ops, solo logs). El control real lo ejercen **3 planos concurrentes** (timers del hook / `SyncStrategyExecutor` / cuerpo imperativo) reconciliados por **≥5 capas de guards anti-stale**. Es ad-hoc, no FSM.
- **Drift: parchado, no resuelto.** El piso de duración mínima (INV-7) es **ingeniería real y sólida**. El resto: el detector de drift fue **demolido** (M-5.4.6) — el drift ya no se corrige *ni se detecta*, solo se silencia. El modelo de buffer A/B es **estructuralmente incorrecto para audio chunked**, parchado con re-validación por play. El fix de chunk-boundary está **test-green pero verificado solo por regex; el smoke real (S-2-mini) nunca se ejecutó** (evidencia en blanco en `M5.4.9`).
- **Acoplamiento React: CRÍTICO.** El índice activo *es* un `useState`; los `<audio>` son JSX; el sync depende de timing de commit React + rAF; `queueMicrotask` para coreografiar el batching de React. **El runtime DEBE independizarse — y el equipo ya lo probó: eso es exactamente V2.**
- **Crash latente verificado:** `useImmersivePlayback.ts:3040` invoca `canStartAudio(index)` — función eliminada, sin definición. Llamada desde `VisorInmersivo.tsx:1623` 1.5s tras un play atascado. **El diagnóstico que existe para depurar playback atascado crashea.** Los tests no lo detectan porque hacen grep de fuente, no ejecutan.
- **Tests = teatro estructural.** ~1000 asserts que grep-ean strings de fuente; no detectaron NINGUNO de los hallazgos de esta auditoría. `npm run verify:immersive` da falsa confianza en cada deploy.

---

## FASE 4 — BACKEND (resumen)

- **Persistencia híbrida (hallazgo clave):** progreso/eventos/insights **ya migrados a SQLite WAL** (correcto, resuelve race cross-proceso). El resto sigue en JSON flat-file con lock `O_EXCL`.
- **Lock cross-proceso `usersLock.js`: bien implementado** (O_EXCL atómico, re-lectura dentro del lock, locks anidados consistentes groups→users en TODOS los call-sites). **PERO** stale-reclaim a 15s por `mtime` nunca refrescado, sin liveness por PID → un writer lento (>15s, DB creciente + GC + disco) pierde el lock → **dos writers concurrentes → corrupción last-write-wins.** Verificado en `usersLock.js:34-38`.
- **Sin atomicidad cross-archivo** (documentado en `server.js:4900-4919`): USERS_DB luego GROUPS_DB; crash intermedio = inconsistencia bidireccional. Mitigado por reparación, no por transacción.
- **IDs `Date.now()` puro** en groups/schools/access/bundles → colisión cross-proceso (rechaza operación legítima). ULID ya disponible y usado en users/submissions/backbone — inconsistencia.
- **Sin graceful shutdown:** no hay handler SIGTERM. El deploy escalonado mata procesos en medio de audit fire-and-forget / lastLoginAt / WAL checkpoint → **pérdida de datos garantizada en cada deploy.**
- **`express.json()` sin `limit`** + **sin error-middleware** → `/api/gemini/analizar-ilustracion` roto (>100kb) y errores de body devuelven HTML, no JSON.
- **Robusto y a preservar:** integridad bidireccional user↔group, migración SQLite de progreso, fallback-extinction guard, validación de uploads en 3 capas + path-traversal canónico, `writeJSON` tmp+rename atómico, auth de progreso correcta (`requireProgressOwner` header==param), proxies `/api/gemini/*` que sacaron las keys del bundle.

---

## FASE 5 — DEVOPS Y PRODUCCIÓN (resumen)

- **Infra-as-code DIVERGENTE (ALTO):** `docker-compose.prod.yml` (2 servicios, volúmenes nombrados) y `nginx.conf` **NO describen producción** (4 containers + bind mounts). El compose real solo existe en el VPS, **fuera de control de versiones**. TLS/443 solo en VPS, inauditable.
- **Imágenes:** sin `.dockerignore` (contexto de build = repo completo incl. `.env`, PII, tarball 1.1GB), **containers corren como root** con bind-mounts del host writable (RCE Node = root-write al host), bases sin pinear (`node:20-alpine`, `npm install` sin lockfile en api).
- **nginx:** sin TLS en repo, **sin security headers** en HTML/assets, **sin rate-limit en el edge**, sin gzip, **round-robin sin sticky** (rate-limits per-worker → ~2× efectivo y bypasseable; `_jsonCache` per-proceso → lecturas stale cross-worker hasta 30s, incl. `access_db` revocado).
- **DR: CRÍTICO.** Single VPS = SPOF total. **Backups solo on-host, sin cifrar, 7-día `rm -rf`.** `uploads/` solo respaldado por manifest. Fallo de disco/ransomware = datos **y** backups perdidos simultáneamente. Sin resource limits → un upload de 2GB o memory-leak OOM-ea el VPS completo.
- **Sin CI/CD de deploy ni SCA/secret-scanning** (solo workflow de a11y). Explica las 17 vulns y las creds-en-history sin detectar.
- **Observabilidad nula:** `console.log` → `docker logs` efímero (se pierde en cada recreate de container = cada deploy), **sin rotación** (puede llenar disco), sin métricas, sin alertas, sin HEALTHCHECK Docker.

---

## FASE 6 — SEGURIDAD (hallazgos verificados contra fuente)

| # | Hallazgo (verificado) | Evidencia | Severidad |
|---|---|---|---|
| S1 | **GET-bypass universal de auth.** `requireAdminAccess`/`requireAuth`/`requireAdminRole` retornan `next()` para TODO GET. Expone sin credenciales: lista completa de usuarios (email/nombre/colegio), miembros de cualquier grupo, status de cualquier estudiante, historial pedagógico Leo, métricas de sistema, catálogo y reglas de acceso. Contradice CLAUDE.md ("nunca delegar acceso al frontend"). | `server.js:319` (`if(req.method==='GET')return next()`); `:346,415,934,5255,5329,7333-7559` | **CRÍTICO** |
| S2 | **Credenciales en texto plano permanentes en git history, en `main` y TODAS las ramas.** `admin123` (rol `administrador`, Gmail real), `Mediador101`, `M4r140rt1z`, `lector123`, `password123` mezcladas con hashes bcrypt. `git rm`+`.gitignore` NO borra history. | `git show f7f0c5c:data/users_db.json`; `git branch --contains 2a2da85` → main+todas | **CRÍTICO** |
| S3 | **protobufjs 7.5.4 RCE** (GHSA-xq3m-2v4x-88gg) vía `firebase@12.10` → `@grpc/proto-loader`. | `npm audit` | **CRÍTICO** |
| S4 | **API key Gemini en bundle frontend** si `VITE_GEMINI_API_KEY` está en build env (lo está) → robo de cuota/billing. | `geminiService.ts:35,43` | **CRÍTICO** (condicional) |
| S5 | IDOR: `requireUserAuth` no valida `:userId`/`:studentId` del path → leer memoria Leo / exportar portfolio de cualquier estudiante. | `server.js:367-389`; rutas `:6205,6515,8157` | ALTO |
| S6 | `/api/leo/ask|chat|recap` sin rate-limit dedicado → abuso de coste API / DoS económico. | `server.js:6165,6311,6329` | ALTO |
| S7 | Reset password token devuelto en el body HTTP → account-takeover si email conocido. | `server.js:2780` | MEDIO |
| S8 | express-rate-limit 8.2.1 bypass IPv6 (GHSA-46wh-pxpv-q5gq) — defeats la defensa anti-bruteforce primaria. | `npm audit`; `server.js:189` | ALTO |
| S9 | `parentId` de upload sin sanitizar (path) ; `/uploads/*` estático sin enforcement de `access_db`. | `server.js:1567,8677` | MEDIO |
| S10 | file-type 21.3.1 zip-bomb DoS — es el validador MIME de uploads. multer 1.x EOL. pdf-parse en-proceso sobre PDFs no confiables. | `npm audit` | MEDIO |

**Comparación con estándares:** OWASP ASVS — falla V1 (Access Control: GET-bypass + IDOR), V2 (Auth: token reset en body), V6 (Stored Crypto: creds plaintext en history), V14 (Config: sin headers edge, sin SCA). WCAG 2.2 / EN 301 549 — **el Modo Accesible cumple**; el resto de la UI no se sostiene a ese nivel. EPUB Accessibility 1.1 — N/A (no es EPUB; el modelo de contenido es propietario).

---

## FASE 7 — OPORTUNIDADES OPEN SOURCE (solo MIT / Apache-2.0 / BSD)

Cada recomendación responde a un problema **estructural verificado**, no genérico.

### OSS-1 · Persistencia: extender SQLite a users/groups/access (✅ máxima palanca)
- **Problema actual:** JSON flat-file + reescritura completa por mutación + lock `O_EXCL` con stale-reclaim inseguro → techo de escala y riesgo de corrupción cross-proceso.
- **Causa estructural:** sin transacciones, sin atomicidad cross-archivo, lock-hold crece con el tamaño del archivo.
- **Solución OSS:** **`better-sqlite3` (MIT) — YA es dependencia y YA está en producción para `progress.db`.** Replicar el patrón WAL para `users/groups/access/analytics`. (Alternativa a futuro: **PostgreSQL**, licencia PostgreSQL/BSD-like, si se requiere multi-host.)
- **Compatibilidad:** total — el patrón ya existe en `progressService.js`; cero deps nuevas.
- **Dificultad:** Media (capa de acceso por entidad + migración de datos + adaptación de los `mutateX`).
- **Riesgo de migración:** Medio (requiere doble-escritura transitoria + el flujo de deploy de schema-change no cubierto por scripts — ver Master Plan).
- **Impacto:** Elimina la race de lock, la corrupción cross-archivo y el techo de escala. **El cambio arquitectónico de mayor retorno.**

### OSS-2 · Estado compartido cross-proceso: Valkey
- **Problema actual:** rate-limits per-worker (2× efectivo, bypasseables), `_jsonCache` per-proceso (acceso revocado vigente hasta 30s en el otro worker), semáforos TTS 2×.
- **Causa estructural:** estado en memoria en una topología de 2 procesos sin store compartido.
- **Solución OSS:** **Valkey** (BSD-3-Clause, fork Linux Foundation de Redis — *evitar Redis ≥7.4 por RSALv2/SSPL*) + **`rate-limit-redis`** (MIT) como store de express-rate-limit + pub/sub para invalidación de cache cross-worker.
- **Compatibilidad:** alta (un container más en el compose; cliente `ioredis` MIT).
- **Dificultad:** Media. **Riesgo:** Bajo (degradación graceful si Valkey cae). **Impacto:** rate-limits reales, cache coherente, base para escalar a N workers.

### OSS-3 · Observabilidad: pino + OpenTelemetry + Prometheus + GlitchTip
- **Problema:** `console.log` → `docker logs` efímero, sin rotación, sin métricas, sin alertas, sin error-tracking. ErrorBoundary frontend solo `console.error`.
- **Causa estructural:** nunca se construyó capa de observabilidad.
- **Solución OSS:** **pino** (MIT) logging estructurado + Docker `json-file` `max-size`/`max-file`; **OpenTelemetry** (Apache-2.0) traces/metrics; **Prometheus** (Apache-2.0) + **Perses** o **VictoriaMetrics** (Apache-2.0) para dashboards (*evitar Grafana — AGPL desde v8*); **GlitchTip** (MIT, API-compat Sentry) para errores front+back.
- **Dificultad:** Media. **Riesgo:** Bajo. **Impacto:** detección de incidentes deja de ser manual; visibilidad de la fragilidad del runtime inmersivo en campo.

### OSS-4 · CI/CD security gate: Trivy + gitleaks + OSV
- **Problema:** sin SCA/secret-scanning; explica las 17 vulns y las creds-en-history.
- **Solución OSS (sobre GitHub Actions ya en uso para a11y):** **Trivy** (Apache-2.0) escaneo de imagen+deps, **gitleaks** (MIT) secret-scanning en PR + history, **OSV-Scanner** (Apache-2.0) / `npm audit --audit-level=high` como gate bloqueante.
- **Dificultad:** Baja. **Riesgo:** Muy bajo. **Impacto:** evita reincidencia de S2/S3/S8.

### OSS-5 · Runtime inmersivo: formalizar la FSM con XState + automatizar smoke con Playwright
- **Problema:** "máquina de estados" reducida a side-car observacional; 3 planos de control + ≥5 guards anti-stale; tests = regex-theater; smoke crítico nunca ejecutado.
- **Causa estructural:** FSM no autoritativa + acoplamiento a React + ausencia de tests behaviorales.
- **Solución OSS:** **XState** (MIT) para formalizar la máquina (visualizer + model-based testing) **dentro del runtime V2 ya independiente de React**; **Vitest** (MIT) + **@testing-library/react** (MIT) + **jsdom** (MIT) para tests behaviorales; **Playwright** (Apache-2.0 — ya en uso para a11y) para automatizar el smoke S-2-mini que nunca corrió.
- **Dificultad:** Alta (es la pieza más compleja). **Riesgo:** Alto si se toca V1; **Bajo si se canaliza vía V2**. **Impacto:** runtime determinista, testeable y verificable — condición para mobile y escala.

### OSS-6 · Offline real: Workbox + PDF.js self-hosted + Tailwind build
- **Problema:** offline roto (sin SW, PDF.js solo CDN), Tailwind CDN runtime, importmap fantasma.
- **Solución OSS:** **Workbox** (MIT) service worker + precache del app-shell; **PDF.js** (Apache-2.0) self-hosted servido por nginx; **Tailwind** (MIT) como build-step Vite (purge + sin CDN).
- **Dificultad:** Media. **Riesgo:** Medio (cambia el pipeline de build front — usar el flujo de deploy frontend ya documentado). **Impacto:** cumple la promesa de producto; habilita wrapper nativo.

### OSS-7 · DR / backups: restic
- **Problema:** backups on-host, sin cifrar, retención `rm -rf` 7d.
- **Solución OSS:** **restic** (BSD-2-Clause) o **borgbackup** (BSD) — backup cifrado, deduplicado, offsite a object-storage; restore testeado.
- **Dificultad:** Baja. **Riesgo:** Bajo. **Impacto:** elimina el escenario "disco/ransomware = datos + backups perdidos juntos".

### OSS-8 · Uploads: migrar multer 1.x (EOL) → busboy
- **Problema:** multer 1.4.5-lts.1 EOL; file-type zip-bomb.
- **Solución OSS:** **busboy** (MIT) directo o **multer 2.x** (MIT) + límites de descompresión en la capa 2.
- **Dificultad:** Media. **Riesgo:** Medio (toca el pipeline de upload validado en 3 capas — preservar las 3). **Impacto:** elimina dep EOL del path de ingest.

---

## FASE 8 — CONCLUSIÓN EJECUTIVA

### Estado REAL de la plataforma
Chibalete+ es un **sistema operativo de lectura funcional para el piloto actual (1 colegio, baja concurrencia)**, con **subsistemas de calidad genuina** (acceso por capas, integridad de membresía, resiliencia de sync, accesibilidad WCAG-2.2) **conviviendo con tres deudas estructurales graves**: (1) seguridad perimetral rota y explotable HOY, (2) persistencia plana que no escala y puede corromperse en multi-proceso, (3) un runtime inmersivo frágil que el propio equipo intentó reemplazar (V2) pero no shippeó.

### Nivel de madurez: **PILOTO AVANZADO — no production-grade para crecimiento.**
La documentación operacional y los scripts de deploy son **sólidos**. El conocimiento del equipo es alto. Las brechas son de **ejecución de seguridad, capa de datos, automatización y decisión sobre el runtime**, no de desconocimiento.

### Riesgos CRÍTICOS (explotables / pérdida de datos AHORA)
1. **S1 GET-bypass** — PII de todos los usuarios/estudiantes sin auth.
2. **S2 Credenciales plaintext en git history** (admin incluido) — account-takeover.
3. **S3 protobufjs RCE** vía firebase.
4. **S4 API key Gemini en bundle** (condicional al build env, que la tiene).
5. **DR: backups on-host únicos** — un fallo de disco = pérdida total.
6. **canStartAudio ReferenceError** — el diagnóstico de playback atascado crashea.

### Riesgos MEDIOS
Race de stale-lock, IDOR `:userId`, sin graceful shutdown (pérdida de datos por deploy), cache `access_db` stale cross-worker, `express.json()` sin límite, offline no funcional, IaC divergente.

### Riesgos FUTUROS
Techo de escala JSON a ~1000 usuarios, dual-maintenance V1/V2 indefinido, mobile no listo (HashRouter+CDN+sin SW), supply-chain sin gate.

### Cuellos de botella
1. RMW O(n) sobre `analytics_db.json`/`leo_interactions_db.json` bajo lock cross-proceso único (serializador global de eventos).
2. Lecturas síncronas de JSON en el event loop por request mutante.
3. Estado en memoria 2× inválido (rate-limits/semáforos/cache) sin store compartido.
4. Acoplamiento del runtime inmersivo al ciclo de render React.

### Arquitectura SANA — preservar (no tocar sin entender los tests)
Modelo de acceso por capas server-authoritative · integridad bidireccional user↔group + locks anidados + fallback-extinction guard · migración SQLite WAL de progreso · motor de sync resiliente (cola fallidos + LWW + keepalive) · validación de uploads en 3 capas + path-traversal canónico · subsistema de accesibilidad + a11y-CI · proxies `/api/gemini/*` · scripts de deploy con auto-rollback.

### Sistemas a refactorizar (prioridad)
1. Auth perimetral (eliminar GET-bypass) — **P0**
2. Persistencia users/groups/access → SQLite — **P1**
3. Decisión V1/V2 runtime inmersivo — **P1**
4. Observabilidad + CI security gate — **P2**
5. Offline/mobile (Workbox+PDF.js self-host) — **P3**
6. `dataService` singleton → reactividad incremental — **P3**

---

## MASTER PLAN CHIBALETE+

Sprints de ~1-2 semanas. Respeta las reglas de CLAUDE.md: **cambios mínimos, localizados, sin romper funcionalidad, sin refactor masivo no instruido.** Cada sprint con criterio de verificación.

### 🔴 SPRINT P0 — "STOP THE BLEED" (seguridad explotable hoy · 3-5 días)
*Quick wins de máximo impacto, cambios quirúrgicos.*
1. **Eliminar el GET-bypass** de `requireAdminAccess/requireAuth/requireAdminRole` (`server.js:319,346,415`); introducir `requireMediatorAuth`; aplicar auth real a GETs con PII. Replicar el patrón correcto de `/api/progress/my/:contentId` (sesión, no path param) en los IDOR S5.
2. **Rotar TODAS las credenciales** presentes en history (admin `monicauribe22@`, mediador, demos) en el `usuarios_colegios_oro.json` de producción. **Purgar history** con `git-filter-repo` (MIT) + force-push coordinado. Añadir `gitleaks` pre-commit.
3. **Bump `firebase`/forzar `protobufjs ≥7.5.6`** + `express-rate-limit` patch (vía el flujo de deploy de imagen api — `package.json` cambia).
4. **Mover TODA la IA del frontend al backend** (extender el patrón `/api/leo/*` ya existente); eliminar `GoogleGenAI` cliente + `VITE_GEMINI_API_KEY`.
5. **Backup offsite cifrado YA** (restic → object storage) antes de cualquier otra cosa estructural.
6. **Fix 1-línea `useImmersivePlayback.ts:3040`** (`canStartAudio` → check estructural) + 1 test behavioral que ejecute `getStartDiagnostic`.

**Verificación:** intento de `GET /api/users` sin header → 401; `git log --all -S "admin123"` → vacío; `npm audit --audit-level=critical` → 0; restore de backup offsite probado.

### 🟠 SPRINT P1-A — FUNDACIÓN DE DATOS (1.5 semanas)
- Migrar `users`, `groups`, `access` a **better-sqlite3 WAL** replicando `progressService.js` (doble-escritura transitoria JSON↔SQLite con feature-flag). Adaptar `mutateX` y locks anidados.
- Añadir **graceful shutdown** (SIGTERM → `server.close()` → drain audit/lastLoginAt → `closeProgressDb()`).
- IDs `Date.now()` → `ulid()` en groups/schools/access/bundles.
- `express.json({limit})` + error-middleware JSON final.

**Verificación:** test de concurrencia (200 req mutantes paralelas a 2 workers) sin pérdida de escritura; deploy escalonado sin pérdida de audit log.

### 🟠 SPRINT P1-B — DECISIÓN RUNTIME INMERSIVO (1.5 semanas)
- **Decisión ejecutiva:** productivizar **V2** detrás de kill-switch flag y migrar, **O** congelar V2 formalmente y dejar de mantener dos. (Recomendación de la auditoría: **productivizar V2** — es la arquitectura correcta.)
- Si V2: formalizar la FSM con **XState**; suite **Vitest+jsdom** behavioral; automatizar el smoke **S-2-mini con Playwright** sobre contenido `perChunkNoAnchors` real.
- Gatear todo `console.log` del hot-path tras el flag `immersive_debug`.

**Verificación:** smoke S-2-mini automatizado verde en CI; un test behavioral falla si se reintroduce el bug de `canStartAudio`.

### 🟡 SPRINT P2 — ESTADO COMPARTIDO + OBSERVABILIDAD (1.5 semanas)
- **Valkey** + `rate-limit-redis` (rate-limits reales) + pub/sub invalidación de `_jsonCache`/`access_db`.
- **pino** structured logging + Docker logging driver con límites + rotación.
- **OpenTelemetry + Prometheus + Perses/VictoriaMetrics** + **GlitchTip** (errores front+back; reemplaza el ErrorBoundary console-only).
- Docker **HEALTHCHECK** + uptime/alerta real.

**Verificación:** dashboard con p99 de `/api/progress/sync` y tasa de `AUDIO_SPLIT_BRAIN`; alerta dispara en container hung.

### 🟡 SPRINT P3 — CI/CD HARDENING + IaC FIDELITY (1 semana)
- GitHub Actions: **Trivy + gitleaks + OSV** como gates bloqueantes en PR; build+test+`npm run verify`.
- Commitear el `docker-compose.yml` real del VPS + edge `nginx.conf` (TLS) como fuente de verdad; eliminar/marcar los divergentes. `.dockerignore`. `USER` no-root + drop caps en Dockerfiles. Resource limits + logging limits en compose.

### 🟢 SPRINT P4 — OFFLINE/MOBILE REAL (1.5 semanas)
- **Workbox** SW + precache app-shell; **PDF.js self-hosted**; cablear `VisorPDF` ↔ IndexedDB cuando `isDownloaded(id)`; **Tailwind build-step** + eliminar importmap fantasma.
- `useDevice` con `matchMedia` + lectura síncrona inicial; `MobileOrientationOverlay` dismissible (fix a11y).

### 🟢 SPRINT P5 — MANTENIBILIDAD (continuo)
- `dataService` no-reactivo → `useSyncExternalStore` incremental sobre las entidades de mayor churn (progress/users/groups) **sin reescribir la capa**.
- Extraer `useReadingSession` para centralizar progress+heartbeat (hoy copy-paste por viewer; Audio/Video no registran progreso).
- migrar multer 1.x (EOL) → busboy/multer 2.x preservando las 3 capas de validación.
- Limpieza de history bloat + árboles de drift (`_prod_snapshot_`, `chibaleteplus/`, tarballs).

### Preparación para IA / mobile / alto tráfico
- **IA:** toda IA mediada por backend (P0) → único punto para rate-limit, caching, observabilidad de coste, y futuros modelos. Reusar el patrón `/api/leo/*`.
- **Mobile:** P4 (SW + self-host + sin CDN) es prerequisito para Capacitor/nativo; el runtime V2 (P1-B) es prerequisito para sync estable en timers throttled de mobile.
- **Alto tráfico:** P1-A (SQLite/Postgres) + P2 (Valkey, estado compartido) eliminan el techo. Tras ello, escalar a N workers es viable; multi-host requiere Postgres (post-roadmap).

### Secuenciación crítica (dependencias)
```
P0 (seguridad) ──► P1-A (datos) ──┬──► P2 (estado compartido + observabilidad)
                                  └──► P3 (CI/IaC)
P0 (canStartAudio) ──► P1-B (V2) ──► P4 (mobile)
P1-A es prerequisito DURO de escalar; P0 no tiene prerequisitos: empezar HOY.
```

---

### Resumen de una frase
**Chibalete+ tiene huesos sanos (acceso, membresía, sync, a11y) y tres heridas estructurales (seguridad perimetral explotable, persistencia que no escala, runtime inmersivo frágil con su reemplazo correcto ya construido pero no shippeado): el camino no es embellecer la app, es ejecutar P0 esta semana, migrar la capa de datos, y tomar la decisión V2 — en ese orden.**
