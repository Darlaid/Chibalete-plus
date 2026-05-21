# Aula Viva — PASO 2 · Materializer Engine

## 1 · Arquitectura actual (auditada)
`events.db` = log canónico (PASO 1, 2114+ eventos, schema_version, payload zod, índices longitudinales). `insightsStore.js` ya provee infraestructura SQLite WAL para **alertas** con 3 tablas (`insight_snapshots` blob por corrida, `insight_states` máquina de estados ACTIVE/ACKNOWLEDGED/RESOLVED/DISMISSED, `insight_notifications` cola dashboard), API idempotente (INSERT OR IGNORE + ON CONFLICT) y env override `INSIGHTS_SQLITE_PATH`. Aula Viva todavía calcula gran parte de sus dashboards ad-hoc (history.reduce per-request) sobre JSON/SQLite — NO escala a 5000+.

## 2 · Arquitectura objetivo (PASO 2)
```
events.db  ──(getEventsSince > watermark)──>  insightMaterializer.runOnce()
                                                    │
                                                    ├─> signals.compute() [15 contratos PASO 1]
                                                    ├─> user_reading_profiles    (upsert por user_id)
                                                    ├─> cohort_rollups           (upsert por scope_type/scope_id/period)
                                                    ├─> signal_snapshots         (longitudinal por signal_id)
                                                    ├─> riskEngine.evaluate()    (reglas determinísticas)
                                                    └─> insightsStore.insertNotification() (reusa P1 alerts infra)
                                                              │
                                                              ▼
                                                        insights.db
                                                              │
                                            Aula Viva ─── insightReader (PHASE 1: dual-read)
```
**Modelo:** *log canónico + materialización incremental con watermark + read model en insights.db*. NO event sourcing dogmático, NO CQRS enterprise, NO Kafka, NO microservicios. Mismo Docker Compose, mismo SQLite WAL.

## 3 · Diagrama write → materialize → read
`POST /api/(analytics/)events` → `eventsService.insertEvent` → `events.db` *(write path P1 intacto)* · cron/admin/loop → `insightMaterializer.runOnce()` *(GATED `INSIGHTS_MATERIALIZER_ENABLED=1`; default OFF)* → upserts en `insights.db` · Aula Viva → `insightReader.*` *(Phase-1 dual-read; legacy intacto)* → snapshots/perfiles/cohortes pre-computados.

## 4 · Estado actual `insightsStore.js`
**Maduro y funcional para alertas:** WAL, busy_timeout=5000, INSERT OR IGNORE, ON CONFLICT upsert, índices `(scope_level,scope_id,severity)` + `(status,last_seen_at)` + `(status,created_at)`, API completa (insert/upsert/list/ack/dismiss/getScopeSummary). **Reutilizable tal cual** para notificaciones del PASO 2.
**Lagunas PASO 2:** sin tablas materializer (`materializer_state`, `cohort_rollups`, `user_reading_profiles`, `signal_snapshots`); sin engine de proyección; sin watermark. **Decisión:** agregar tablas nuevas como extensión idempotente (`CREATE TABLE IF NOT EXISTS`) en `insightsDbExt.mjs`, SIN modificar `insightsStore.js` (alerts API intacta).

## 5 · Riesgos actuales
- Aula Viva ad-hoc reduce p95 latency bajo carga institucional.
- Sin watermark, un eventual loop sin idempotencia recomputaría todo (no-go a 5000+).
- `insight_states` (alertas) y un futuro "insight_states" de watermark colisionan por nombre — resuelto: tabla del watermark se llama **`materializer_state`** (distinta).
- Dual-write activo (PASO 1) ya genera presión; el materializer agrega lecturas, **debe ser incremental**.

## 6 · Riesgos de recomputación
Rebuild completo de 5000 users × 30 días × 50 eventos = ~7.5M filas. **Inaceptable como default.** Mitigación: `runOnce()` siempre incremental por watermark; `rebuildInsights()` solo manual (admin), con `scopes` y `dryRun` obligatorios para ventanas amplias.

## 7 · Riesgos WAL
2 APIs leen events.db + 1 escribe; el materializer agrega 1 reader + 1 writer en insights.db (DB separada — sin contención con events). WAL absorbe; `busy_timeout=5000` ya configurado. Vacuum periódico solo off-hours (no en `runOnce`).

## 8 · Riesgos cardinalidad
Labels de métricas controlados (PASO 1): nunca userId/contentId. Nuevas métricas P2 usan labels acotados: `materializer_runs_total` sin labels libres; `snapshot_updates_total{table}` con `table` ∈ {profiles,cohorts,signals,notifications}. Las TABLAS materializadas SÍ explotan en filas (1/user, 1/group/period) — eso es deseado y queda acotado por la naturaleza institucional (5000 users × 7 periods × 8 objectives ≈ 280k filas — trivial para SQLite).

## 9 · Riesgos cohort analytics
Scope ambiguo si `groups` carece de id natural (deuda PASO 1). Mitigación: rollup usa `scope_type` + `scope_id` (group_key sintético de P1 sigue siendo estable a renames si school/grade/name no cambian — riesgo conocido, documentado, fix en PASO siguiente).

## 10 · Estrategia incremental
- `runOnce()` lee `materializer_state.last_event_id`, query `SELECT * FROM events WHERE id > ? ORDER BY id LIMIT N`, procesa, upsert, avanza watermark **dentro de UNA transacción** en insights.db → idempotente, parcial, reanudable.
- Sin batch backlog: si `lag_events` grande, runs sucesivos drenan progresivamente.
- Default OFF (`INSIGHTS_MATERIALIZER_ENABLED!=1`); activación manual o cron VPS off-hours.

## 11 · Estrategia replay
`rebuildInsights({fromTs, toTs, dryRun, scopes})`: lee ventana, recomputa proyecciones, en `apply` upserta marcadas con `source:'replay'` (las normales son `'incremental'`). NO mueve watermark. Usable para reparar tras incidente sin reprocesar todo.

## 12 · Estrategia rollback
- Apagar materializer = `INSIGHTS_MATERIALIZER_ENABLED=0` + restart → cero processing.
- Aula Viva sigue leyendo legacy (Phase-1 dual-read: si insightReader devuelve `degraded:true` o sin datos, fallback al cálculo ad-hoc).
- Borrar `data-critical/insights.db*` = reset total (alertas se pierden — backup previo).
- Reset solo materializer (preservar alertas): `DELETE FROM materializer_state; DELETE FROM cohort_rollups; DELETE FROM user_reading_profiles; DELETE FROM signal_snapshots;` (NO toca `insight_states`/`insight_notifications`/`insight_snapshots`).

## 13 · Qué NO tocar
`insightsStore.js` (alerts API funcional); `eventsService.js` (canon write path P1); `progressService.js`; el dual-write F-0 en `/api/analytics/events`; endpoints Aula Viva existentes (Phase-1 = leer de insights opcionalmente, NO reemplazar); runtime inmersivo V1/V2; modos accesible/guiado/álbum/PDF; login/onboarding/uploads.
