# CHP-STATS-INGEST-01-PREP — Ingestión canónica idempotente append-only (offline)

**Veredicto:** `GREEN PREP — CANONICAL IDEMPOTENT EVENT INGESTION IMPLEMENTED OFFLINE AND VERIFIED`

- 2026-08-16, **offline / dormant**. Sin producción, sin escribir events.db productiva, sin insights.db, sin materializer, sin backfill, sin filtrado sintético, sin M1-B.
- Base `chp/stats-ingest-01-prep` desde `087b55b` (tip lineal 01A+01B). M1 intacto (`0ff76b6` COMPAT ×2, front `m1a-0ff76b6`).
- Referencia semántica: contrato canónico `9fbe7e0` (NO base runtime; sus módulos `canonicalEvent.mjs`/`normalizeCanonicalEvent.mjs` **no existen** en esta base — sí existe `eventRegistry.js`).

## 1. Auditoría del path existente

`POST /api/v1/events` (`server.js:9199`) + `server/eventsService.js` (events.db) es el path canónico-ish vivo. Ya es un backbone fuerte: **append-only** (`insertEvent` = `INSERT OR IGNORE` sobre `event_id UNIQUE`, `eventsService.js:106-114,382-401`), `server_ts`/`created_at` **server-side**, `client_ts` preservado, payload ≤4KB (`validateBackboneEvent`), WAL + busy_timeout. Consumidores (no romper): `getEventsSince`/`getBackboneEventsForMetrics`/`getBackboneEventStats`, `backboneMetrics`, `backboneFunnels`, `analytics/signals`, `observability/analyticsHealth`.

**Gaps auditados (lo que este PREP endurece):**
| Gap | Path vivo | Clasificación |
|---|---|---|
| Actor = `reqUserId` = `req.auth?.userId ?? req.user?.id ?? **x-user-id header**` (`server.js:2469`); sin middleware de auth en el endpoint → en OFF lee x-user-id autoafirmado | **BLOCKING_SECURITY_GAP** |
| Sin detección de conflicto: mismo eventId + hecho distinto → `INSERT OR IGNORE` lo ignora en silencio | **MIGRATION_REQUIRED** |
| Sin scan de PII / derived-state; payload guardado verbatim | **MIGRATION_REQUIRED** |
| Sin tenant verificado (schema sin columna institución/grupo) | **MIGRATION_REQUIRED** (dep M1-B + columna) |
| `validateBackboneEvent` no consulta `eventRegistry` (solo `{mode}.{action}`) | SAFE_COMPAT (vocabulario backbone) |

**Regla FASE 1 respetada:** NO se creó un segundo endpoint. Se implementó un **módulo dormido** que será la autoridad de validación/persistencia del path existente en una activación futura controlada (no en esta unidad → sin cambio de runtime).

## 2–8. Módulo `server/analytics/canonicalIngest.mjs` (dormant)

`ingestCanonicalEvent(raw, verifiedContext, deps)` + `normalizeForIngest(raw, verifiedContext, receivedAt)`. Deps inyectables: `persist(fact)→{inserted}`, `lookup(eventId)→fact|null`, `now()`. Modelo del hecho persistido (columnas events.db): `event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts(=occurredAt), server_ts(=receivedAt, server), payload_json`; contexto no-persistido hoy: `_provenance`, `_tenant`, `_receivedAt`.

- **Store canónico (FASE 2):** reutiliza `eventsService.insertEvent`/`getEventById` (events.db). No guarda derived state/streak/ranking/diagnóstico/insights.
- **Idempotencia (FASE 3):** `event_id` = clave lógica. Primer POST → `ACCEPTED` (201). Mismo eventId + mismo hecho → `DUPLICATE` idempotente (200). Mismo eventId + hecho distinto → `CONFLICT` (409), **no sobrescribe**. Implementado con `INSERT OR IGNORE` atómico + comparación post-hoc de `factFingerprint` (sin carrera check-then-insert): el ganador queda fijo, el perdedor solo LEE y compara. `ONE_EVENT_ID = ONE_LOGICAL_FACT`.
- **Append-only (FASE 4):** el módulo nunca UPDATE/DELETE/reescribe occurredAt/actor/payload. (El único DELETE del repo es `aulaViva/archiveRotation.mjs`, rotación por antigüedad, ajena a la ingestión.)
- **Autoridad de identidad (FASE 5):** actor = `verifiedContext.authenticatedUserId` (server). El crudo NO manda: `raw.userId/actorId` distinto → `ACTOR_MISMATCH` (403). **No lee x-user-id** (test lo verifica: el módulo no recibe req/headers). Funciona con auth cookie/sesión M1-A vía el `verifiedContext` que el wiring futuro poblará desde `req.auth`.
- **Tenant (FASE 6):** solo desde `verifiedContext.tenant` verificado. Cliente afirma tenant sin contexto verificado → `TENANT_MISMATCH`; crudo ≠ verificado → `TENANT_MISMATCH`. **No fabrica** tenant; hecho personal sin tenant es válido (no se bloquea). No adelanta ni duplica M1-B.
- **Validación (FASE 7):** ULID; `schemaVersion∈[1]`; `{mode}.{action}` + `mode∈{pdf,text,immersive,album,a11y,lu}`; `sessionId` no vacío; provenance∈enum sellada por contexto; `occurredAt` finito, ≥2020, ≤receivedAt+5min (offline viejo OK); receivedAt server-side, jamás sustituye occurredAt.
- **Privacidad (FASE 8):** deep-scan de PII (`email/ip/user_agent/rawPrompt/rawResponse/token/password/phone/fullName/schoolName/cookie/authorization/sid`) y derived-state (`streak/level/xp/readCount/blocksCompleted/ranking/recommendation/diagnostic/insights/progressPercentage/score`) → `FORBIDDEN_FIELD`. Claves de identidad/rol/tenant autoafirmadas en el sobre → rechazo. No almacena headers/cookies; no usa auth sid como interactionSessionId.

## 9–10. Retry y failures

Contrato de retry con 01A: evento en T1 (red falla → cola) reenviado en T2 lleva **mismo eventId + mismo occurredAt** → primera = `ACCEPTED`, retry = `DUPLICATE` (aceptación inequívoca para que 01A retire la cola). Semántica de status: `201 accepted` · `200 duplicate` · `409 conflict` · `400` (invalid/eventType/schema/session/time/forbidden) · `401 unauthenticated` · `403` (actor/tenant/provenance) · `413 payload too large` · `503` (fallo transitorio de persistencia). **Nunca éxito sin persistencia confirmada; cero silent drop.**

## 11. SQLite / concurrencia

Reutiliza el patrón del repo (WAL, prepared `INSERT OR IGNORE`, `busy_timeout`). Test de integración contra events.db temporal: dos ingestas del mismo hecho → exactamente **una fila**, ambas coherentes (accepted+duplicate); mismo eventId + hecho distinto → conflicto con la fila original intacta. Sin infraestructura distribuida nueva.

## 14. Tests

`npm run test:canonical-ingest` → **26 ✓** (16 requeridos + fingerprint + tiempo/schema/sesión/provenance + integración). Cubre: persiste una vez, retry mismo eventId una vez, duplicado idempotente, mismo eventId/hecho distinto rechazado (409), receivedAt server, occurredAt preservado, actor de auth, actor spoof rechazado, tenant spoof rechazado, eventType inválido, payload>4KB, PII/derived rechazado, unauthenticated, fallo transitorio ≠ éxito, sin dependencia de x-user-id, e **integración real** (append-only + idempotencia + conflicto + concurrente-safe).

## 12. Store isolation

`PRODUCTION_EVENTS_DB_WRITES=0`, `PRODUCTION_INSIGHTS_DB_WRITES=0`, `PRODUCTION_IDENTITY_WRITES=0`. Puros con deps mock; integración con `EVENTS_SQLITE_PATH` en `os.tmpdir()`. `verify-test-store-isolation` PASS (367 stores reales intactos). No se copió DB productiva.

## 15. Sin filtrado sintético

events.db almacena HECHOS. No se excluye/borra por cohorte sintética/disabled/heurística; no se añade marcador sintético al evento. La exclusión pertenece a la proyección/materialización (diseño aprobado, fuera de esta unidad).

## 16. CI

Tests cableados a `identity-preflight.yml` en esta misma unidad (paso «Ingestión canónica de eventos (01-PREP)») y el guard de store-isolation extendido a `test:canonical-ingest`. Se **evita** el problema de 01A/01B (tests no ejecutados por CI).

**CI remoto exact-tree GREEN sobre `9fedb99` (attempt 1, sin flake):** identity-preflight (run `31977206914`) + security = **success**. Verificado a nivel de STEP: step 12 «Ingestión canónica de eventos (01-PREP)» = success (corre `test:canonical-ingest`), step 18 «La suite no escribe stores reales» = success (cubre `test:canonical-ingest`), typecheck + build = success. security = success → `NEW_FINDINGS=0` (baseline heredado separado). `INGEST_REMOTE_CI_GREEN=true`.

## 17. M1 no interferido

Read-only: api_1/api_2 `0ff76b6` COMPAT/json, front `m1a-0ff76b6`, healthy, restarts=0. Sin tráfico de prueba productivo.

## 18. Handoff

```
INGEST_CANONICAL_PATH = server/analytics/canonicalIngest.mjs (dormant) — autoridad futura de POST /api/v1/events
EVENTS_STORE_SCHEMA_READY = true   (events.db reutilizado; tenant necesita columna → MIGRATION_REQUIRED)
EVENT_IDEMPOTENCY_READY = true      (INSERT OR IGNORE + conflict detection)
AUTH_ACTOR_AUTHORITY_READY = true   (verifiedContext.authenticatedUserId; sin x-user-id)
TENANT_VERIFIED_CONTEXT_READY = partial  (punto de integración listo; persistencia requiere columna + M1-B desplegado)
INGEST_REMOTE_CI_GREEN = true (run 31977206914, exact-tree 9fedb99, step-verified)
```

**Dependencias reales de M1-B:** la persistencia de tenant/institución verificada necesita (a) M1-B desplegado para poblar el snapshot en `req.auth`, y (b) una columna `institution_id`/`group_id` en events.db (migración de schema). Mientras tanto el módulo valida no-spoof y acepta hechos personales sin tenant.

**La siguiente unidad NO es el materializer automáticamente.** La activación de INGEST (cablear el módulo dormido al endpoint vivo `/api/v1/events`, resolviendo `verifiedContext` desde `req.auth` con auth middleware) es una integración controlada aparte, tras los gates de M1 (M1-A enforce da `req.auth` fiable; M1-B da tenant). Decidir entre: (i) activación/integración adicional, o (ii) listo para deploy controlado post-M1.

## STOP — ninguna disparada

path existente endurecible sin segundo endpoint; el writer no muta hechos previos; actor no depende de identidad del cliente; tenant no se fabrica; duplicado no crea múltiples hechos; tests solo con store temporal; M1 intacto.
