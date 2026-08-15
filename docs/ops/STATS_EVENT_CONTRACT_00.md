# STATS_EVENT_CONTRACT_00 — Modelo canónico de eventos (auditoría + congelación)

Unidad: **CHP-STATS-EVENT-CONTRACT-00** (2026-08-15). DESIGN ONLY — sin migración de
schema, sin escribir events.db, sin abrir/tocar insights.db, sin materializer, sin deploy,
GROUPS canary intacto. Rama `chp/stats-event-contract-00` desde el source productivo
`cf36852` (no integra M1/M2).

## A. Veredicto

**🟢 GREEN — CANONICAL EVENT CONTRACT DEFINED AND CHP-STATS-EVENT-CONTRACT-01 READY.**
Ninguna condición STOP disparada: actor confiable via M1-A (`req.auth.userId`); tenant nunca
client-asserted (server-verified snapshot o resolución downstream); retry idempotente por
`eventId` ULID; offline atribuible (claimed→verified en sync); el contrato prohíbe diagnóstico
pedagógico en el evento; sin PII innecesaria (IDs); events.db/insights.db no tocadas; canary
intacto.

## B. Groups-canary freeze

`docker inspect --format` al cierre (§AT): api_1 `cf36852` json / api_2 `cf36852` sqlite+groups,
healthy, restarts=0 → `GROUP_CANARY_STATE=RUNNING`. Cero `/api/groups` probe.

## C. Event surfaces (inventario)

**Cuatro endpoints de ingestión de cliente + emisión canónica server-internal:**
| Canal | Endpoint | Store | Actor |
|---|---|---|---|
| Legacy reading analytics | `POST /api/analytics/events` (server.js:7323) | `analytics_db.json` (+dual-write events.db) | header `x-user-id` + `userId` por evento (deben coincidir; user debe existir) |
| Backbone v1 (canónico) | `POST /api/v1/events` (server.js:8986) | **events.db** (`insertBackboneEvent`) | header `x-user-id`; valida por evento; max 50/batch |
| Playback rhythm | `POST /api/playback-events` (server.js:8903) | `playback_events.log` (JSONL) | header `x-user-id`; `serverTs` asignado |
| Immersive warn | `POST /api/events` | process log (+dual-write events.db) | header `x-user-id` |
| Server-internal | (llamada directa) | events.db via `recordCanonicalEvent` | actor server-supplied (Leo/AulaViva) |

Emisores cliente por modo (§Z). Emisores server: `leoBackboneEmitter.mjs` (mode `leo`, flag
`LEO_EVENTS_BACKBONE_ENABLED` off), `aulaVivaAuditEmitter.mjs` (mode `aula_viva`, flag
`AULA_VIVA_AUDIT_EVENTS_ENABLED` off), `writeAuditLog` (audit JSON). Recorder único native/server
= `analyticsShadow.recordCanonicalEvent` (valida via `eventRegistry` Zod, recovery-first,
idempotente en `UNIQUE(event_id)`).

Clasificación: CANONICAL_CANDIDATE = backbone v1 + native recorder; LEGACY_ANALYTICS =
analytics_db.json path; PROGRESS_STATE = progress_db (aparte); AUDIT_EVENT = writeAuditLog +
aula_viva; OBSERVABILITY = immersive watchdog (console-only, no persiste); PRODUCT_TELEMETRY =
aula-viva UI `_track/*`, LU download/version.

## D. Stores (inventario)

events.db `events` (**CANÓNICO, append-only**), events.archive.db (mirror, rotación gated off),
analytics_db.json (legacy sink, mutable rolling 50k), playback_events.log (JSONL append-only),
leo_interactions_db.json (append rolling), leo_memory_db.json (mutable keyed `userId__contentId`),
leo_profile_db.json (mutable keyed userId), leo_evidence_db.json (**sink de contenido PII**,
append trim), user_audit_log.json (append, `auditReferenceId`=ulid server-owned + timestamp
server ISO, override-proof), offline_assignments.db (current-STATE, upsert+delete — NO es cola de
eventos), insights.db (**proyección reconstruible, nunca autoridad**, watermark `last_event_id`).
No se abrió ningún `.db`.

## E. events.db — schema actual (eventsService.js:81-103)

```sql
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
  schema_version INTEGER NOT NULL, event TEXT NOT NULL, mode TEXT NOT NULL,
  user_id TEXT NOT NULL, content_id TEXT, session_id TEXT NOT NULL,
  client_ts INTEGER NOT NULL, server_ts INTEGER NOT NULL,
  elapsed_ms INTEGER, progress_fraction REAL, payload_json TEXT, created_at INTEGER NOT NULL);
```
Índices por (user_id,content_id,server_ts), (session_id), (event,server_ts), (mode,server_ts).
Write = `insertEvent` (**INSERT OR IGNORE**, `server_ts`/`created_at`=Date.now() server, `client_ts`
pass-through). Sin UPDATE/DELETE salvo rotación de archivo (gated off).

Clasificación de columnas contra el contrato objetivo:
- **KEEP:** `event_id`(ULID, idempotencia), `schema_version`, `event`, `mode`, `user_id`(actor),
  `content_id`, `session_id`(sesión de lectura), `client_ts`, `server_ts`(autoridad),
  `progress_fraction`, `created_at`.
- **SEMANTICALLY_RENAME (contrato, no DDL):** `server_ts`→`receivedAt`; `client_ts`→`occurredAt`
  (claimed). `elapsed_ms` = señal de corroboración, NO duración sumable (documentado).
- **EXTEND (futuro, OPCIONAL, no ahora):** `institution_id`/`group_id` (snapshot server-verified),
  `provenance` (enum), `offline` flag, `actor_verification`. Hoy `provenance`/`source` viven dentro
  de `payload_json._source` ('native'|'legacy'|'unknown') — EXTEND a columna/enum en -01+.
- **DEPRECATE:** ninguno (todas las columnas son útiles).
events.db **ya cumple la mayor parte del contrato**: append-only, dedupe atómico, tiempo servidor,
versión de schema, ID ULID cliente/servidor compatible.

## F. Event type registry (F)

**TRES vocabularios coexisten (hallazgo clave):**
1. **Legacy** (`analyticsService.track`): `session_start`, `session_heartbeat`, `session_end`,
   `block_complete`, `page_change`, `streak_break`, `level_up`, `transition_to_next_content`,
   Álbum `album_*`/`reread_*`/`route_*`/`leo_intervention_shown` → analytics_db.json.
2. **Backbone v1** (`{mode}.{suffix}`): `<mode>.session_start|session_heartbeat|session_end|
   progress|audio_play|audio_pause`, `a11y.error`, `lu.page_view|version_check|download_*|install_*`
   → events.db.
3. **Registry canónico Zod** (`server/analytics/eventRegistry.js`): `reading_*`, `session_*`,
   `immersive_*`, `audio_*`, `accessibility_*`, `pdf_*`, `guided_*`, `album_*`, `teacher_*`/
   `mediator_*`/`intervention_*`, lifecycle institucional, `leo_*`, system deploy/migration/archive.

Dominios: READING (session/block/page/progress), NAVIGATION (page_change, album route/action),
MEDIA (audio_play/pause, album_media_played; **video/audio standalone ausente**), LEO
(leo_interaction_started/completed/memory_updated/evidence_recorded), ACTIVITY (album completion,
uploads), PRODUCTION (album_media_uploaded), OFFLINE_SYNC (LU download/version; a11y queue),
SYSTEM/AUDIT (aula_viva teacher_*, deploy/migration/archive/shadow).

**Aliases/duplicados/typos:** el mismo hecho tiene ≥2 nombres (`session_start` legacy vs
`text.session_start` v1 vs `session_started` registry). `mode='leo'`/`'aula_viva'` **eluden** el
allowlist de modos del HTTP (entran como free string via recordCanonicalEvent). Eventos con
métricas DERIVADAS embebidas (§G). Congelar la unificación de nombres = trabajo de -01 (registry
canónico único + adaptadores legacy→canónico), NO se normaliza aquí.

## G. Action vs state (violaciones registradas)

FACT correcto: `session_start`, `page_change`, `audio_play/pause`, `block_complete` (ocurrencia),
`album_route_completed`, `progress_fraction` (fracción en un instante = señal factual válida),
ack/dismiss `accepted:boolean`.
**Violaciones (state/derived embebido en evento):** `progressPercentage` (VisorTexto/PDF/Inmersivo
session_end), `blocksCompleted` (cumulativo), `streak`/`level`/`xp`/`oldLevel`/`newLevel`/
`previousStreak` (estado de gamificación), `newReadCount`/`readCount` (contadores). Remediación
(-01 contrato, no runtime): el evento porta el HECHO (p.ej. `block_index`), la proyección deriva el
acumulado. `elapsed_ms` = corroboración, nunca autoridad de duración (contrato ya lo impone).
**Bien:** abandonment NO se emite (derivado downstream via JOIN, `analyticsSeam.ts`).

## H. Event ID

**ULID** (`utils/clientUlid.ts` ↔ `server/ulid.js`, 26 chars Crockford Base32 = 10 time + 16 random
Web Crypto, regex `/^[0-9A-HJKMNP-TV-Z]{26}$/i`). Cumple: único-suficiente, cliente/offline
compatible, ordenable por tiempo, sin PII, **estable por evento** (generado una vez en la creación).
**Congelado: `eventId`=ULID.** Sin dependencia nueva (ya existe cliente+servidor). Si el cliente no
lo envía, el servidor genera (`incoming.eventId || ulid()`), pero el contrato EXIGE que el emisor lo
asigne en la creación del hecho (requisito de idempotencia offline).

## I. Idempotency

**`eventId` ES la autoridad de idempotencia.** Asignado en la creación del hecho (acción de
cliente o emisor server), inmutable a través de reintentos de transporte; la ingestión dedupa por
`event_id UNIQUE` (`INSERT OR IGNORE`). **No se requiere `idempotencyKey` separado**: sólo haría
falta si un mismo hecho lógico pudiera crearse bajo múltiples eventIds (no es el caso — el emisor
persiste el evento con su eventId y reenvía el MISMO en retry; patrón ya usado por la cola a11y).
Regla congelada: mismo hecho lógico ⇒ mismo `eventId` ⇒ una persistencia. Dedupe **nunca** por
timestamp+actor+action difuso.

## J. Actor identity

Online autenticado (tras M1-A): **`req.auth.userId`** = autoridad. **PROHIBIDO** confiar en
`x-user-id`/body.userId/cookie-claims como autoridad de actor para eventos server-observados (hoy
los 4 endpoints usan `x-user-id`; el legacy además exige match y existencia en padrón — mitiga pero
no es autoridad criptográfica). Contrato: envelope porta `actorId`; para eventos creados offline
por cliente = `claimedActorId` en creación → **`verifiedActorId` en sync**, verificado contra la
identidad M1-A de la sesión que sincroniza. Separación `claimed`/`verified` sólo donde haya offline.
**No es STOP:** M1-A hace al actor confiable en el path online.

## K. Tenant / group semantics

**Decisión: HÍBRIDO (C).** El evento canónico porta `actorId` (REQUIRED). OPCIONAL
`institutionId`/`groupId` = **snapshot server-verified capturado en ingestión** (resuelto por
M1-B server-side, **nunca client-asserted**). Si el snapshot está ausente (eventos pre-M1-B), el
materializer resuelve por membresía canónica vigente. Da corrección histórica (membresías evolucionan)
sin confiar en el cliente. **Dependencia:** el snapshot exige M1-B desplegado; hasta entonces
actor-only + materializer-join. Prohibido meter tenant client-asserted (evita STOP).

## L. Content identity

`contentId` (id de catálogo, nullable para LU). Subrecurso hoy va en payload: `pageNumber`
(PDF), `currentSentenceIndex`/`totalSentences` (inmersivo), `paragraphId`/`chapterIndex` (a11y),
`routeId`/`regionId`/`pageId` (álbum). Contrato: `contentId` REQUIRED (salvo eventos no-lectura),
`subresourceId`/`nodeId` OPTIONAL tipado por dominio. **Nunca** título/nombre como identidad. No se
rediseña el catálogo.

## M. Session semantics

**Separadas:** `sid` de M1-A = **sesión de SEGURIDAD** (no usar como sesión pedagógica).
`sessionId` del backbone = **sesión de LECTURA/INTERACCIÓN** (ULID por userId×contentId×mode,
`useBackboneReadingSession`). Leo usa un `interactionId` ULID por interacción. Contrato: persistir
**`interactionSessionId`** (= reading/interaction session, ya es `session_id` en events.db);
`authSessionId` NO se persiste en el evento (es seguridad, correlacionable aparte si hiciera falta).
Minimizar identificadores: uno persistido (`session_id`). `session_id` **no es autoridad** de
sesión analítica (eventContract lo reconstruye por ventana de inactividad).

## N. Time

**`occurredAt`** (= `client_ts`, claimed por el emisor; relevante offline; **validado con cotas**:
no futuro > skew, no anterior a época de la plataforma) + **`receivedAt`** (= `server_ts`,
asignado por el servidor, **AUTORIDAD**). Ambos epoch ms UTC. Online confiable: domina el servidor.
Offline: `occurredAt` importa pero no se confía ciegamente (cotas + `receivedAt` como ancla).
Formato/precisión congelados: entero ms UTC; el reader engine ordena por `server_ts` desempatando
por `event_id`.

## O. Timezone

Timestamps canónicos **siempre UTC** (epoch ms). Si importa el día/semana pedagógico local, la zona
se conoce **por separado** (fuente = timezone de la institución; fallback usuario/cliente).
**PROHIBIDO** codificar zona convirtiendo el timestamp canónico a hora local de pared. La conversión
a día local ocurre downstream (materializer) con el timezone de la institución.

## P. Offline

Hoy: **sólo `useA11yAnalytics` tiene cola offline** (localStorage `a11y_events_queue`, cap 200
drop-oldest, drena en mount + evento `online`, limpia sólo en 2xx, multi-user aware, depende del
dedupe server por `eventId`). Backbone/LU **no persisten** (fail-silent). Contrato: metadata offline
= flag `offline:true` + `occurredAt` de creación + estado de cola (created/queued/synced) en el
emisor (no en el hecho). **La cola a11y es el patrón de referencia**; LU y backbone deben adoptarlo
(gap de instrumentación, no del contrato). **Una sola ontología de eventos**: LU emite hechos
compatibles con la misma cadena canónica (mismo envelope, `provenance='lu'`).

## Q. Retry / dedupe

Reintento de transporte **no crea un segundo hecho** (mismo `eventId`). Los intentos de transporte
son observabilidad, no hechos pedagógicos. Persistencia canónica = un evento (INSERT OR IGNORE).
Dedupe en ingestión por `event_id UNIQUE`; acción repetida legítima (OPEN lunes vs OPEN martes) =
distinto `eventId` ⇒ dos eventos. **Sin dedupe difuso por timestamp.** Ya implementado; congelado.

## R. Versioning

**`schemaVersion`** en el envelope (ya `=1` en events.db `schema_version` y en el hook). Estrategia
mínima: versión del SOBRE (no por-campo). La semántica por-tipo la lleva el nombre del evento + el
registry. Un consumidor debe poder interpretar eventos de versiones previas (compat hacia atrás por
versión de sobre). Congelado: `schemaVersion` entero monotónico; no versionar cada campo de metadata.

## S. Canonical envelope (propuesto)

| Campo | Estado |
|---|---|
| `eventId` (ULID) | **REQUIRED** |
| `schemaVersion` | **REQUIRED** |
| `eventType` (nombre canónico) | **REQUIRED** |
| `mode` | **REQUIRED** (reading modes + lu/leo/aula_viva/system) |
| `actorId` | **REQUIRED** (verifiedActorId server-side) |
| `institutionId` | **OPTIONAL** (server-verified snapshot; DERIVED si ausente) |
| `groupId` | **OPTIONAL** (server-verified snapshot) |
| `contentId` | **REQUIRED** salvo eventos no-lectura (LU) |
| `subresourceId`/`nodeId` | **OPTIONAL** |
| `interactionSessionId` (`session_id`) | **REQUIRED** para eventos de sesión |
| `occurredAt` (client_ts) | **REQUIRED** (validado) |
| `receivedAt` (server_ts) | **DERIVED** (server-assigned autoridad) |
| `provenance` | **REQUIRED** (enum §U) |
| `offline` | **OPTIONAL** (default false) |
| `payload` (payload_json) | **OPTIONAL**, gobernado por tipo (§T) |
| `authSessionId` | **REJECTED** en el evento (seguridad, no pedagógico) |
| client-asserted `institutionId`/`role` | **REJECTED** |
| derived (`progressPercentage`,`streak`,`level`,`blocksCompleted`) | **REJECTED** como campo canónico (van a proyección; `progress_fraction` señal se conserva) |

## T. Metadata

`payload_json` ≤4KB (ya). Contrato: payload **gobernado por tipo de evento** (registry Zod define
las claves permitidas por `eventType`); límites de tamaño (≤4KB) y profundidad. Hoy `payload` es
free-form (junk-drawer risk) y carga derivados/`_source`. Congelar: sin texto libre arbitrario, sin
PII, sin objetos enormes, sin métricas derivadas como autoridad. Migrar `_source`→`provenance`
columna/enum.

## U. Provenance

Enum acotado: **`web` | `lu` | `server` | `leo` | `experience` | `migration`** (mapea el `_source`
actual native/legacy/unknown + `mode`). **PROHIBIDO** exponer string de cliente arbitrario como
provenance confiable — la provenance la sella el servidor en ingestión según el canal + identidad.

## V. Synthetic / test provenance (handoff de -01)

**Decisión: A (materializer-join).** El evento **NO** copia `_loadtest_marker`. El materializer
resuelve exclusión uniendo `actorId` contra la autoridad canónica de exclusión (marcador +
`migration_exclusions`, de CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01). Justificación: la cohorte de
carga es **atemporal y permanentemente excluida** → el lookup por `actorId` es determinista para el
replay. **Ningún cliente puede marcar un evento como sintético** (no hay campo client-controlado de
exclusión). Sin dependencia de patrones PII. Hoy events.db tiene **0 eventos sintéticos** (los 400
nunca emitieron).

## W. Replay semantics

Para la cohorte actual (atemporal): `actorId` lookup basta y es determinista en replay 2027→2026.
El contrato **no asume** que toda exclusión futura sea atemporal: si apareciera una exclusión
con vigencia temporal, se requeriría **provenance verificada a nivel de evento** (actor-class
snapshot) **o** un **registro de exclusión versionado** (por ventana). Se documenta la semántica de
replay explícita; no se sobre-ingeniera (no se construye el registro versionado ahora).

## X. Privacy / minors

Auditoría de PII en payloads: el evento canónico usa **IDs** (actorId/contentId/sessionId).
**Prohibidos por defecto** en el evento: nombre, email, nombre de colegio display, texto libre, IP,
user-agent, conversaciones Leo crudas. El contenido pedagógico PII vive **separado** en
`leo_evidence_db.json`/`leo_memory_db.json` (events.db sólo markers — ya así). **Minores:**
minimización de datos conductuales — sólo hechos necesarios para el fin pedagógico declarado; evitar
granularidad de vigilancia (keystroke/scroll-pixel NO son eventos, §AP), fingerprinting de
dispositivo, señales de ranking. Regla de minimización documentada (contrato técnico, sin expandir
política legal). No se borra dato productivo.

## Y. Leo

Frontera **ya correcta**: `leoBackboneEmitter` (mode `leo`, flag off) emite HECHOS PII-free
(`leo_interaction_started/completed`, `leo_memory_updated` keys[], `leo_evidence_recorded`
kind/objetivo) → events.db; el CONTENIDO (prompt/respuesta/texto del alumno) vive en
`leo_evidence_db.json`/`leo_memory_db.json`. Contrato: analítica canónica consume hechos
(`LEO_SESSION_STARTED`/`LEO_INTERACTION_OCCURRED`), **nunca** texto crudo. No se rediseña Leo.

## Z. Reader-mode matrix

| Modo | START | RESUME | PROGRESS | COMPLETE | CLOSE | OTHER |
|---|---|---|---|---|---|---|
| Texto/Guiado | ✓ | ✗ | ✓ (text.progress, block_complete) | ✗ (inferido de session_end+pct) | ✓ | — |
| Inmersivo | ✓ | ✗ (resume no emite evento) | ✓ (immersive.progress, audio_play/pause) | ✓ (session_end source=completion, transition) | ✓ | block_complete, streak_break, level_up |
| PDF | ✓ | ✗ | ✓ (page_change, pdf.progress) | ✗ (inferido) | ✓ | — |
| Álbum | ✓ | ✗ (reread_started ≈) | ✓ (album.progress, route_step) | ✓ (album_completed, route_completed) | ✓ | action_triggered, media_played |
| a11y | ✓ | ✗ | ✓ (a11y.progress) | ✗ (inferido) | ✓ | error; **cola offline** |
| audio standalone | ✗ | ✗ | ✗ | ✗ | ✗ | **sin emisor** |
| video standalone | ✗ | ✗ | ✗ | ✗ | ✗ | **sin emisor** |

Celdas vacías = **gap de instrumentación** → entrada a CHP-STATS-INSTRUMENTATION-00 (§AR):
RESUME ausente en todos; COMPLETE explícito sólo en Álbum/Inmersivo; audio/video standalone sin
emisor.

## AA. Media

`immersive.audio_play`/`audio_pause` existen (hechos). `album_media_played`. **VisorAudio/VisorVideo
standalone NO emiten** (gap). Contrato: hechos factuales PLAY/PAUSE/POSITION/ENDED **si la señal
existe**; **no inferir "watched" de un play click**; sin juicio de completitud sin contrato. Las
celdas media faltantes → instrumentación.

## AB. Activities / production

Hoy: `album_media_uploaded` (producción de contenido), álbum completion. Contrato: distinguir
`ACTIVITY_CREATED`/`SUBMITTED`/`REVIEWED` de calidad/evaluación. El resultado de revisión humana =
**evento/estado de review explícito** (`teacher_reviewed_*` ya factual con `accepted:boolean`),
nunca score inferido automático. No hay hoy submission de actividad de alumno (gap futuro).

## AC. Progress compatibility

`progress_db` (estado) coexistirá con events.db durante la migración. Invariante futuro: **una
acción de usuario ⇒ una persistencia lógica**. El progreso materializado se deriva de los eventos
(events.db→insights.db o proyección de progreso), NO un dual-write que duplique el hecho. No se
implementa dual-write aquí; se congela el invariante anti-duplicación.

## AD. Ingestion boundary

Contrato futuro `ingestCanonicalEvent(event, verifiedContext)`: validar (Zod registry) → autenticar
(actor via M1-A) → autorizar (clase de fuente §AE) → normalizar (nombre canónico, provenance) →
asignar `receivedAt` → dedupe (`event_id UNIQUE`) → persistir (append-only). **NO**: calcular
analítica, actualizar insights inline, diagnosticar. (El `/api/v1/events` actual ya hace validate/
dedupe/persist/receivedAt; falta actor confiable M1-A + provenance/tenant sellados.)

## AE. Authorization (clases de fuente)

`SERVER_GENERATED` (Leo/AulaViva, identidad server-supplied), `AUTHENTICATED_WEB_CLIENT`
(req.auth.userId M1-A), `OFFLINE_LU_SYNC` (sesión M1-A del dispositivo; claimed→verified),
`INTERNAL_MIGRATION_BACKFILL` (provenance=migration, gated admin). **No** usar admin-secret
compartido para toda fuente. Consumir identidad confiable M1-A/M1-B donde aplique.

## AF. Failure semantics

`invalid` → **reject** (no persist; contado, sin PII); `duplicate` → **accept idempotent** (IGNORE);
`store unavailable` → **retryable** (503, sin drop silencioso); `unauthorized actor` → **reject**
(401/403); `unknown content` → accept si el hecho es válido (contentId puede resolverse tarde) o
reject por política — congelar: aceptar con `contentId` opaco, no inventar; `expired/offline event` →
accept con `offline:true` + cotas de `occurredAt`; `future schemaVersion` → **reject retryable-later**
o cuarentena (no interpretar a ciegas). **Sin drop silencioso** (el a11y actual limpia cola sólo en
2xx — compatible).

## AG. Append-only invariant

events.db = **hechos append-only**. Implementación: sólo `INSERT OR IGNORE`; **sin UPDATE/DELETE**
de contenido factual en operación normal (verificado: eventsService no tiene UPDATE/DELETE; la única
DELETE es rotación de archivo por `server_ts<cutoff`, gated off, que MUEVE a archive.db no reescribe).
Excepciones permitidas (dedupe record, estado de ingestión) **no reescriben el hecho**. Correcciones
= **nuevo evento correctivo** o mecanismo gobernado explícito, jamás UPDATE in-place. Congelado.

## AH. Materializer handoff

El materializer (insights.db, proyección reconstruible, watermark `last_event_id`) **puede asumir**:
identidad de evento estable (`event_id`), tipo/versión estable, actor/provenance verificados, semántica
de tiempo (`receivedAt` autoridad), identidad de contenido, persistencia idempotente. **Puede derivar**
counts/durations/completion/signals; **NO puede mutar el evento**. Reconstruible desde events.db en
cualquier momento (`rebuildInsights`).

## AI. Gap matrix

| Deficiencia | Clase |
|---|---|
| Actor por `x-user-id` (no `req.auth`) | EVENT_CONTRACT_BLOCKER (resuelto por M1-A; dependencia) |
| Tres vocabularios de nombres (legacy/v1/registry) | INGESTION_GAP + LEGACY_COMPAT (unificar en -01) |
| Sin columna `provenance`/`institution_id` (en payload) | EVENT_CONTRACT (EXTEND en -01+) |
| Derived state en eventos (streak/level/progressPercentage) | EVENT_CONTRACT (contrato -01 define fact-only) |
| Sin offline/retry en backbone/LU (sólo a11y) | INSTRUMENTATION_GAP |
| RESUME ausente; COMPLETE inconsistente; audio/video standalone sin emisor | INSTRUMENTATION_GAP |
| Materializer join de exclusión sintética | MATERIALIZER_GAP (V) |
| `mode` free-string elude allowlist (leo/aula_viva) | NON_BLOCKING (server-trusted) |
Evita que -01 absorba toda la Fase 2: los gaps de instrumentación/materializer son unidades aparte.

## AJ. Validation architecture

**Reusar Zod** (ya es dependencia; `server/analytics/eventRegistry.js` ya define esquemas Zod por
tipo). Contrato -01 = extender/consolidar el `eventRegistry` como registry canónico único +
validador de sobre. **No añadir dependencia nueva**. Validación en el borde de ingestión, fail-closed
para inválidos, recovery-first sólo si el marco lo exige (hoy `recordCanonicalEvent` inserta inválidos
con marker — revisar en -01: preferir reject sobre insert-con-marker para el canon).

## AK. Test matrix (diseño)

valid canonical event · missing eventId (→ server genera pero contrato exige emisor) · duplicate
retry (dedupe IGNORE) · same action/different eventId (dos eventos) · tampered actor (rechazo:
actor≠req.auth) · client-supplied tenant mismatch (ignorado; snapshot server) · invalid timestamp
(cotas) · offline valid · offline retry (mismo eventId) · future schemaVersion (reject/cuarentena) ·
unknown eventType (reject o UNKNOWN_REVIEW) · oversized metadata (>4KB reject) · forbidden PII field
(reject) · synthetic/test provenance spoof (cliente NO puede marcar; materializer-join) · server
verified provenance (sellada). Sin implementación aquí.

## AL. Golden fixtures (diseño)

`ONLINE_READER` (web, text.session_start, actorId verificado, occurredAt+receivedAt, provenance=web),
`OFFLINE_LU` (lu.page_view, offline:true, claimed→verified, provenance=lu), `MEDIA`
(immersive.audio_play, subresource sentenceIndex), `LEO` (leo_interaction_started, PII-free, mode=leo),
`ACTIVITY` (teacher_reviewed_recommendation accepted:bool), `MIGRATION/BACKFILL` (provenance=migration,
gated). Cada uno muestra envelope+payload+provenance+time+identity. Sin PII real.

## AM. Migration compatibility

Registros actuales vs contrato: **DIRECTLY_COMPATIBLE** = eventos v1/native de events.db (ya llevan
eventId/schema/mode/session/ts). **NORMALIZABLE** = eventos legacy de analytics_db.json (mapear
nombre legacy→canónico, `timestamp`→occurredAt, sin provenance sellada → provenance=legacy).
**INSUFFICIENT_PROVENANCE** = eventos sin actor confiable pre-M1-A (provenance no verificable, se
marcan `legacy`, no re-atribuibles a M1-A retroactivamente). **INVALID_FOR_CANONICAL_REPLAY** =
playback_events.log (sin eventId, sin dedupe). No se hace backfill ni se fabrica provenance ausente.

## AN. Observability

Ingestión (futura, acotada): `events_ingested_total{type,source,result}`, `events_duplicate_total`,
`events_rejected_total{reason}`, `events_ingest_latency`, `events_offline_age`. **Sin labels**
`actorId`/`contentId`/`institutionId`; sin logging de payload; `reason` acotado (enum). Coherente con
el patrón de contadores del repo.

## AO. Security

`client controls actorId` → autoridad M1-A, no header; `client controls tenant` → snapshot
server-verified, nunca client; `oversized payload` → cap 4KB reject; `prototype pollution/object
injection` → validación Zod + sin merge no seguro del payload (revisar el spread `...incoming.payload`
en /api/v1/events); `arbitrary eventType` → registry allowlist (los server emitters que eluden el
allowlist quedan server-trusted, no cliente); `PII logging` → prohibido; `replay abuse` → dedupe por
eventId; `offline queue forgery` → verifiedActorId en sync, no claimed. Mitigaciones en el contrato,
sin implementación.

## AP. Performance / granularity

Volumen medido (snapshot read-only, doc v2): 19.465 eventos históricos / 11.984 en 30 días; carga de
eventos ~145 ms p50 / 3,1 MB en memoria para 30 días. Sin inventar MAU. Principio de granularidad:
hechos suficientes para **reconstruir la interacción pedagógica**, no vigilancia continua. Un keystroke
o un pixel de scroll **NO** son eventos canónicos (hoy scroll/keydown sólo renuevan actividad local,
no emiten). Heartbeat gated por visibilidad+actividad (15s) es el checkpoint aceptado.

## AQ. CHP-STATS-EVENT-CONTRACT-01 (boundary)

**Incluye:** envelope/types canónicos (TS/JS) + Zod schema (extender eventRegistry); registry de
eventos unificado (nombres canónicos + mapa legacy↔canónico); validador de sobre; contrato de
idempotencia/provenance/tiempo/offline como tipos + validadores **dormidos** (flag off); fixtures de
test; adaptadores de compat legacy→canónico **si mínimos**. **NO incluye:** reparación de
instrumentación, rollout de ingestión productiva, materializer, backfill, Aula Viva. Todo offline,
sin escribir events.db.

## AR. Instrumentation handoff (CHP-STATS-INSTRUMENTATION-00)

Matriz §Z: RESUME ausente en TODOS los modos; COMPLETE explícito sólo Álbum/Inmersivo (resto inferido
de session_end+progressPercentage); audio/video standalone sin emisor; backbone/LU sin cola offline
(sólo a11y). Estos se REPARAN en CHP-STATS-INSTRUMENTATION-00, no aquí.

## AS. Rollout / rollback

Rollout futuro (derivado de la arquitectura real, no ejecutado): **E0** contrato/types only → **E1**
validadores/adaptadores dormidos (flag off) → **E2** ingestión shadow (valida y compara, no cambia
persistencia) → **E3** emisores seleccionados a nombre canónico → **E4** emisores amplios → **E5**
ingestión canónica (actor M1-A + provenance/tenant sellados). **Rollback:** NUNCA borrar eventos
canónicos ni `TRUNCATE events.db`; fallback = versión de sobre previa + adaptadores de compat +
volver el flag a off. La append-only garantiza que un rollback de contrato no pierde hechos.

## AT. Groups-canary non-interference

Sólo `docker inspect --format`: api_1 `cf36852` json / api_2 `cf36852` sqlite+groups, healthy,
restarts=0 → `GROUP_CANARY_STATE=RUNNING`.

## AU. Documentación / commit

Este doc en `chp/stats-event-contract-00` (desde `cf36852`). `lint:evidence` GREEN. Docs-only. Sin
productive ref, sin backup/restic, sin prune, sin force-push.

## AV. EVENT_CONTRACT_READY

**true.** Emisores inventariados; canonical-vs-state/log explícito; eventId/idempotencia congelados;
actor confiable (M1-A) congelado; tenant snapshot server-verified congelado; content identity
congelada; time/offline congelados; retry/dedupe congelados; versioning congelado; provenance acotada;
replay sintético definido (materializer-join, atemporal); PII/minores minimizados; gaps de reader-mode
conocidos; append-only explícito; materializer handoff explícito; boundary de -01 estrecho; canary
intacto.

## AW. Exact next step

**CHP-STATS-EVENT-CONTRACT-01** (envelope/types + registry unificado + validación Zod + fixtures,
offline, dormido) — no antes de que M1-A/M1-B provean actor/tenant confiables para el path de
ingestión productivo (dependencia de secuencia, no de esta unidad de tipos). Handoff paralelo:
**CHP-STATS-INSTRUMENTATION-00** (matriz §Z/§AA).
