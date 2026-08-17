# CHP-STATS-MAT-00 — Diseño del materializador canónico (events.db → insights.db)

**Veredicto:** `GREEN — CANONICAL MATERIALIZER DESIGN FROZEN AND READY FOR OFFLINE IMPLEMENTATION` · `MAT_00_DESIGN_READY=true`

- 2026-08-16, **audit + design only** (read-only). Sin implementar materializador, sin escribir events.db/insights.db, sin producción, sin activar ingest, sin M1-B.
- Rama `chp/stats-mat-00` desde `c160a52` (tip 01B). M1 intacto (`0ff76b6` COMPAT ×2, front `m1a-0ff76b6`).

## 1. Estado actual (auditoría)

**insights.db = un archivo, DOS capas** (`data-critical/insights.db`, `INSIGHTS_SQLITE_PATH`):
- **Alerts** (`server/insightsStore.js`): `insight_snapshots`, `insight_states`, `insight_notifications`.
- **Read-model del materializador** (`server/db/insightsDbExt.mjs`): `materializer_state` (**watermark** `last_event_id` INTEGER monotónico), `signal_snapshots`, `user_reading_profiles`, `cohort_rollups`.

**Materializador existente** `server/services/insightMaterializer.mjs` (`aula_viva_pedagogical_v1`), **DORMANT** (solo lo arranca el scheduler de Aula Viva bajo `AULA_VIVA_SCHEDULER_ENABLED=1`). Características y **limitaciones** que el diseño canónico corrige:
- Lee events.db RAW (bypass del mapper); watermark por `id` monotónico, **sin dedup por eventId**.
- **Tiempo = `server_ts` (receivedAt) para TODO** — no usa `client_ts`/occurredAt. → el bucketing por período no es factual.
- **elapsedMs sumado incremental** (`ms += payload.elapsedMs`) — **coincide con el contrato 01B**; pero `backboneMetrics.js` lo trata como acumulado (max-por-heartbeat). **Discrepancia de semántica** a unificar.
- **Sin exclusión sintética** (no abre identity.db ni el padrón; hoy inocuo porque events.db tiene 0 eventos sintéticos, pero no future-proof).
- Rebuild = re-upsert parcial **sin DROP** → no es reconstrucción-desde-cero determinista.
- `cohort_rollups` escribe **una** fila global; **sin tenant**. El mapper `rowToBackboneEvent` y `metricsProvider.EVENT_COLUMNS` **NO exponen** `institution_id`/`group_id` (columnas 01B) ni (provider) `client_ts`.

**Reutilizable:** el patrón `materializer_state` (watermark), la infra WAL de insightsDbExt, y las lecturas de `eventsService`. **Legacy a superar:** el materializador dormido con time=server_ts, sin exclusión, sin tenant y sin rebuild real; `signals.js` stubs.

**Exclusión sintética:** `analyticsExclusion.mjs` NO está en esta base (vive en `chp/stats-synthetic-cohort-exclusion-01`, `e412e5a`). En esta base: `referenceEngine` (single-attestation `_loadtest_marker` sobre el padrón JSON) + `identityUserDomains.classifyUserReadDomain` (**doble atestación** `migration_exclusions` disposition `SYNTHETIC_LOADTEST_QUARANTINED` keyed `h16(id)` + tombstones). Ambos deterministas; el materializador usa **ninguno**.

## 2. Principio de autoridad (congelado)

```
events.db  = HECHOS canónicos append-only (única fuente de verdad)
insights.db = PROYECCIÓN reconstruible (nunca autoridad)
```
Requisito: **borrar insights.db + reprocesar el mismo conjunto de eventos ⇒ mismo resultado lógico.** El materializador **jamás** modifica events.db (solo `SELECT`). Todo insight es derivable; ninguna corrección se hace mutando eventos (append-only), sino recomputando la proyección.

## 3. Proyecciones mínimas

Solo estadísticas base (sin dashboards/rankings/diagnósticos/recomendaciones):
- **actor_activity** — actividad por lector (sesiones, tiempo, recursos distintos) por período.
- **interaction_sessions** — una fila por `interactionSessionId` (apertura factual).
- **resource_activity** — actividad por recurso/libro (lectores distintos, sesiones, tiempo).
- **completions** — hechos explícitos de finalización (solo donde existen).
- **scope_rollup** — agregación institucional/grupo **solo cuando el hecho lleva contexto verificado**.

## 4. Matriz evento → proyección

| eventType ({mode}.{action}) | HECHO usado | Proyección | Regla de agregación | Fuente |
|---|---|---|---|---|
| `{mode}.session_start` | occurredAt, actor, content, session, tenant? | interaction_sessions (crea), actor/resource_activity (cuenta sesión) | 1 sesión por interactionSessionId | DIRECT_FACT |
| `{mode}.session_heartbeat` | elapsedMs (Δ), progress_fraction, session | Σ tiempo; last_activity | Σ elapsedMs incremental por sesión | DIRECT_FACT |
| `{mode}.progress` | occurredAt, sentenceIndex/page (payload), progress_fraction, elapsedMs (Δ) | interaction_sessions.last_checkpoint; Σ tiempo | último checkpoint factual; Σ elapsedMs | DIRECT_FACT |
| `{mode}.session_end` | elapsedMs (Δ), progress_fraction | cierra sesión (best-effort); Σ tiempo | Σ elapsedMs; duración = Σ deltas | DIRECT_FACT |
| `album.*completed` / `reading_completed` (explícito) | occurredAt, content, session | completions | 1 completion por (actor,content,session) | DIRECT_FACT (solo Álbum hoy) |
| `immersive.audio_play/pause` | occurredAt | (opcional) media plays | conteo | DIRECT_FACT |
| reading_time global | Σ elapsedMs de heartbeat/progress/end | actor/resource/scope rollup | DERIVED_FROM_FACTS | DERIVED |
| "probable completado" (Texto/PDF) | — | — | **UNSUPPORTED** (no hay hecho; derivable como insight aparte en V3) | UNSUPPORTED |
| ranking/streak/nivel/diagnóstico | — | — | **UNSUPPORTED** (fuera de alcance) | UNSUPPORTED |

**Regla:** no se fabrica métrica sin evidencia factual suficiente → `UNSUPPORTED`.

## 5. Reading time

`reading_time = Σ elapsedMs` de eventos con delta incremental (heartbeat/progress/session_end), **por sesión** y luego agregado. Protecciones: **dedup por eventId** (mismo evento no suma dos veces — garantizado por `event_id UNIQUE` en events.db + replay idempotente), descartar `elapsedMs<0`, descartar/clampear valores absurdos si el contrato define cota (hoy no hay cota dura → se registra outlier, no se infla), ignorar eventos incompatibles (sin elapsedMs). **NUNCA reconvertir deltas en acumulado** (la instrumentación 01B ya entrega deltas; sumarlos es correcto). **NO** usar wall-clock START→CLOSE como fuente primaria (CLOSE es best-effort). Unifica la discrepancia auditada: la semántica canónica es **suma-de-deltas**, no max-heartbeat.

## 6. Interaction session

`interactionSessionId` = una **apertura/interacción** (NO auth sid). Proyección por sesión: `session_start` (occurredAt del primer evento), `last_activity_at` (occurredAt del último), `duration_ms` (Σ elapsedMs), `resource` (content_id), `reader_mode` (mode), `actor` (user_id), `institution_id`/`group_id` nullable. **No exige CLOSE perfecto:** una sesión existe si tiene ≥1 evento; la duración se acumula de los deltas presentes; la ausencia de `session_end` no la invalida (heartbeats cubren el tiempo).

## 7. Completion — sin fabricación

Solo `reading_completed`/`album_*completed` cuando existe como **hecho explícito válido**. Texto/PDF hoy **no tienen** completion explícito → **NO se infiere** por última página / porcentaje / elapsed / cierre de navegador. `completions` proyecta solo hechos reales (Álbum). Un futuro "probable terminado" sería un **insight derivado claramente etiquetado**, no un hecho; no se implementa aquí.

## 8. Progress

Separar **hechos** (`page`, `sentenceIndex`/location, `checkpoint`/`anchor`, `block`) de **porcentajes derivados** (`progress_fraction`/`globalPercentage`). Por recurso:
- PDF: página / total → fracción fiable (denominador = totalPages en payload).
- Texto: scroll% / anchor → fracción aproximada (sin páginas discretas).
- Inmersivo: sentenceIndex / total → fiable.
- Álbum: página / total slides → fiable.
- Audio/Video: **UNSUPPORTED** (sin instrumentación).
Si falta denominador/contexto → `UNSUPPORTED` (no se calcula). **Nunca 0 = "sin datos".**

## 9. Zero / NULL / no-data (congelado)

```
0                 = valor factual medido como cero (p.ej. 0 completions reales)
NULL / no-row     = sin evidencia suficiente (no medido)
```
Cada métrica declara explícitamente su estado no-medido como NULL/ausencia de fila, nunca 0. `NO_DATA_NEVER_COLLAPSES_TO_ZERO=true`. (Preserva la semántica que el stack legacy ya distingue: 0/NO_DATA/NO_ACTIVITY.)

## 10. Exclusión sintética (en proyección, NO en events.db)

Autoridad = **doble atestación** (diseño ya preparado): `_loadtest_marker` (padrón) ∧ `migration_exclusions` disposition `SYNTHETIC_LOADTEST_QUARANTINED` (`identityUserDomains`/`analyticsExclusion.mjs` cuando su rama esté disponible). **Prohibidas heurísticas** por email/nombre/disabled/rol. El materializador resuelve `actorId → synthetic|real` construyendo el Set de excluidos **1× por corrida** (O(1) lookup), y **excluye en el borde de cohorte ANTES de agregar** (nunca agregar-y-restar, que rompería únicos/ratios). Determinista y reproducible en rebuild (misma autoridad → mismo Set). Fail-closed si `markerSet≠attestedSet` con identity.db disponible (DRIFT/INVALID → no publicar métricas contaminadas). Hoy events.db tiene 0 eventos sintéticos (inocuo), pero la exclusión queda diseñada para future-proof. **No** se copia el marcador al evento ni a insights.

## 11. Contexto tenant

Eventos con `institution_id=NULL`/`group_id=NULL` (personal o histórico) son soportados. **No fabricar** institución/grupo por joins heurísticos posteriores; el contexto institucional solo cuando el **hecho canónico** lo lleve verificado (01B). Alcances:
```
PERSONAL      : institution_id NULL → rollup solo a nivel actor
INSTITUTIONAL : institution_id verificado → scope_rollup(institution)
GROUP_SCOPED  : institution_id + group_id verificados → scope_rollup(group)
```
**Dependencia (MIGRATION_REQUIRED):** el reader actual (`rowToBackboneEvent`, `metricsProvider.EVENT_COLUMNS`) **no expone** `institution_id`/`group_id` ni `client_ts` → MAT-01 debe extender el mapper/provider (o un `getEventsSinceId` nuevo que incluya tenant + client_ts). Además la migración 01B debe haberse aplicado (columnas presentes). Sin contexto verificado → todo queda PERSONAL (no bloquea).

## 12. Idempotencia del materializador

`eventId` es la clave lógica de idempotencia. Procesar E una vez ≡ procesarlo y volver a recibirlo, sin doble conteo, porque:
- events.db ya deduplica en ingesta (`event_id UNIQUE`), así que un retry no crea segunda fila → el materializador ve el hecho una sola vez.
- El watermark por `id` monotónico (reutilizar `materializer_state.last_event_id`) avanza sobre filas ya únicas.
- Las proyecciones se escriben con **UPSERT sobre PK/UNIQUE** (scope×period×metric, sessionId, actor×period), de modo que reprocesar recomputa sin duplicar.
Preferencia: idempotencia por **checkpoint explícito** (watermark) + UPSERT determinista. (Dedup extra por eventId no es necesario porque events.db ya lo garantiza; se documenta el supuesto.)

## 13. Rebuild (dos modos)

- **INCREMENTAL:** desde el watermark, procesar `id > last_event_id`, recomputar los scopes/períodos afectados, UPSERT, avanzar watermark en la misma transacción de insights.db.
- **REBUILD_FROM_ZERO:** **DROP de las tablas de proyección** (o insights.db-de-proyección efímera) → `last_event_id=0` → releer TODOS los hechos canónicos → aplicar exclusión sintética → reconstruir proyecciones → resultado **determinista** independiente del estado previo. (El materializador actual NO tiene esto — MAT-01 lo añade.) El rebuild no depende del estado previo de insights.db; su resultado solo depende de events.db + autoridad de exclusión (versionada).

## 14. Ordering

`occurredAt` (client_ts) = tiempo **factual** → **bucketing por período** (cuándo ocurrió la lectura). `receivedAt` (server_ts) + `id` = orden de **procesamiento/watermark/lag** (llegada). Un evento puede llegar tarde (`occurredAt`=T1, `receivedAt`=T3) tras otros de T2. **El diseño no asume orden-de-llegada = orden-factual:** las agregaciones por período usan occurredAt; el avance del materializador usa receivedAt/id. (Corrige el materializador actual, que usa server_ts para el bucketing.)

## 15. Late events

Una llegada tardía (occurredAt viejo, receivedAt nuevo) se procesa en orden de watermark; su `occurredAt` la ubica en el **período factual correcto** → se recomputa/UPSERT el agregado de ese scope×período de forma determinista (no se bloquea porque el período "ya se proyectó"). Estrategia mínima: al procesar un batch, marcar los (scope,period) tocados y recomputarlos desde events.db (ventana acotada por occurredAt). Sin ventanas complejas de watermarking. Eventos fuera de cualquier ventana de recomputación incremental se reconcilian en el próximo REBUILD_FROM_ZERO (determinista).

## 16. Provenance

`provenance` (web/lu/server/leo/experience/migration) se conserva como dimensión **solo si** una estadística lo requiere operativamente (p.ej. separar actividad `server`/`migration` de la humana). **No** sustituye `eventType`. No se crean dimensiones sin valor operativo. Diseño base: no proyectar provenance salvo un filtro para excluir provenance no-humana (`server`/`migration`) de las métricas de lectura si procede — decisión de MAT-01, no obligatoria.

## 17. Privacidad

insights.db contiene **agregados/proyecciones**, no copias del payload factual. **No propagar** PII / raw text / tokens / cookies / auth sid. `interactionSessionId` (apertura de lectura) ≠ auth sid; se persiste como id de sesión de lectura, no de seguridad. Minimizar almacenamiento derivado (solo lo necesario para las métricas base). Los identificadores institucionales persistidos son los IDs verificados (no display names/PII).

## 18. Reconciliación legacy (futura, solo claves)

Claves de reconciliación para comparar el nuevo materializador vs métricas legacy más adelante: **`actor` / `resource` / `period` / `metric`**. No se implementa reconciliación aquí, ni se intenta cuadrar cifras legacy contaminadas por definición (legacy no excluye sintéticos/disabled; denominadores = membresía de grupo). El diff canónico usará estas claves como grano común.

## 19. Schema propuesto (insights.db, mínimo)

| Tabla | Propósito | PK | Source events | Rebuildable | Synthetic-excl |
|---|---|---|---|---|---|
| `materializer_state` | watermark/checkpoint (reusar) | `materializer_name` | — | true | n/a |
| `mat_interaction_sessions` | 1 fila por apertura de lectura | `session_id` | session_start/heartbeat/progress/session_end | true | true (actor) |
| `mat_actor_activity` | actor × período | `(actor_id, period)` | todos los de lectura | true | true |
| `mat_resource_activity` | recurso × período | `(content_id, period)` | todos los de lectura | true | true |
| `mat_completions` | hechos de finalización explícitos | `(actor_id, content_id, session_id)` | reading_completed/album_*completed | true | true |
| `mat_scope_rollup` | institución/grupo × período × métrica (solo verificado) | `(scope_type, scope_id, period, metric_key)` | eventos con tenant verificado | true | true |

Cada fila lleva `source_watermark` y `occurred_period` (derivado de occurredAt). Métricas guardan NULL/ausencia para no-data (no 0). Sin tablas redundantes; sin diseño especulativo. (Las tablas del materializador dormido `signal_snapshots`/`user_reading_profiles`/`cohort_rollups` se consideran **legacy pedagógico**; el materializador canónico usa el set `mat_*` — decisión de MAT-01 sobre conservar/retirar las viejas, no se asume conservarlas.)

## 20. Plan de implementación (mínimo)

- **MAT-01** — Materializador canónico offline + tests con events.db temporal. Implementa: reader con occurredAt/tenant (extiende mapper), watermark, exclusión sintética en borde, proyecciones `mat_*`, INCREMENTAL + REBUILD_FROM_ZERO, no-data≠0. Dormant (no scheduler prod).
- **MAT-02** — Dry-run sobre COPIA de events.db productiva + preview de reconciliación (claves actor/resource/period/metric) contra legacy, **sin escribir insights.db productiva**.
- **MAT-03** — Apply controlado (activar el materializador en prod tras gates M1/ingest) **fusionado con** el procedimiento de operación/rebuild (MAT-04 plegado): runbook de INCREMENTAL + REBUILD_FROM_ZERO, watermark, rollback = re-drop+rebuild (insights.db es reconstruible).

Justificación de fusión MAT-03+04: rebuild/ops es parte del apply controlado (insights.db reconstruible ⇒ el rollback ES el rebuild); no amerita microfase separada.

## 21. Contrato de tests (futuro, MAT-01)

same events→same projection · duplicate event no double count · retry no double count · late event handled (bucket por occurredAt) · elapsedMs suma incremental correcta · synthetic excluido · actor real retenido · NULL tenant permanece NULL · no-data ≠ zero · rebuild == incremental (mismo resultado) · completion solo explícito · **events.db unchanged**. Solo con events.db temporal/fixtures (store isolation).

## 22. Independencia de ingest

El diseño **no asume** que canonical ingest esté live. MAT-01 trabaja con **fixtures/temp events.db** que respetan el schema canónico preparado (incl. columnas tenant de 01B). No se bloquea por M1-B ni por el runtime wiring de ingest: MAT lee events.db (schema), sea quien sea el que escribe. Las columnas tenant pueden estar NULL (personal) sin bloquear.

## Condiciones STOP — ninguna disparada

toda métrica requerida tiene fuente factual o se marca UNSUPPORTED (no se fabrica); el materializador solo lee events.db (append-only intacto); exclusión sintética = atestación determinista (sin heurística); no-data≠0 por diseño; rebuild determinista (drop+replay); el diseño usa fixtures/temp (no exige ingest live); M1 intacto.

## Veredicto

`MAT_00_DESIGN_READY=true`. Mapeo evento→proyección completo; schema mínimo de insights definido; semántica de elapsed correcta (suma de deltas); completion no fabricado; no-data≠0; exclusión sintética definida (atestación); tenant nullable soportado; idempotencia (watermark+UPSERT, eventId lógico); late-event determinista (bucket por occurredAt + recompute); rebuild determinista; claves de reconciliación legacy definidas; plan MAT-01→02→03(+04) mínimo. **Siguiente: CHP-STATS-MAT-01** (implementación offline), no automático.
