# STATS_EVENT_CONTRACT_01_PREP — Envelope canónico + registry + validación (dormant)

Unidad: **CHP-STATS-EVENT-CONTRACT-01-PREP** (2026-08-15). Implementación OFFLINE, **DORMANT**
(sin cablear a ningún writer productivo), del diseño GREEN `-00`. Sin migrar events.db, sin
escribir/abrir events.db/insights.db, sin materializer, sin instrumentar lectores, sin deploy,
GROUPS canary intacto. `EVENT_CONTRACT_BASE_SHA=70bcf4b` (rama `chp/stats-event-contract-00`,
docs sobre `cf36852`). Rama `chp/stats-event-contract-01`.

## A. Veredicto

**🟢 GREEN PREP — CANONICAL EVENT CONTRACT IMPLEMENTED AS DORMANT VALIDATION LAYER AND READY FOR
INGESTION/INSTRUMENTATION WORK.** `EVENT_CONTRACT_IMPLEMENTATION_READY=true`,
`EVENT_CONTRACT_PRODUCTION_ACTIVE=false`. Ninguna condición STOP.

## D. Módulos (nuevos, dormidos)

- `server/analytics/canonicalEvent.mjs` — sobre canónico (Zod `.strict()`) + validación
  estructural pura (`validateCanonicalEnvelope`), constantes, `EVENT_ERROR`, escaneo PII,
  requisitos por tipo. Reusa `eventRegistry.js` (autoridad de payload) y `ulid.js`.
- `server/analytics/normalizeCanonicalEvent.mjs` — frontera de confianza `normalizeCanonicalEvent(raw, verifiedContext)`.
- `server/analytics/canonicalEventAdapters.mjs` — aliases legacy/v1→canónico, `adaptBackboneV1ToRaw`, `classifyMigration`.
**Runtime non-interference verificado:** ningún módulo productivo los importa (solo tests + entre sí).

## E. Canonical envelope (Zod strict)

REQUIRED: `eventId`(ULID), `schemaVersion`, `eventType`(∈ registry), `mode`(enum), `actorId`,
`occurredAt`, `receivedAt`(server-owned), `provenance`(enum). OPTIONAL: `institutionId`/`groupId`
(snapshot verificado), `contentId`, `subresourceId`, `interactionSessionId`, `offline`, `payload`.
`.strict()` **rechaza** claves de sobre desconocidas; `REJECTED_ENVELOPE_KEYS`
(authSessionId/sid/role/tenant/x-user-id) → `FORBIDDEN_FIELD`. La identidad de sobre
(`contentId`/`interactionSessionId`) se **hoistea** y se inyecta al registry (que la espera como
`contentId`/`sessionId`) para validar el payload, retirándose del payload final (events.db la guarda
en columnas). `requirementsFor(type)` exige content/session en el sobre para tipos de lectura/sesión.

## F. Event ID

**ULID** (`server/ulid.js`/`utils/clientUlid.ts`, `isValidUlid`). Validado estructuralmente; ULID
inválido → `INVALID_EVENT`; ausente en normalize → `MISSING_EVENT_ID` (**no se fabrica**). Sin
paquete UUID/JWT nuevo. Estable en retry (el emisor lo asigna en la creación).

## G. Idempotency

`eventId` = **autoridad de idempotencia** (sin `idempotencyKey` separado). Arnés en memoria prueba:
primer evento→accepted; mismo eventId+mismo material→**duplicate**; mismo eventId+material
alterado (actor)→**conflict** (no duplicate silencioso); acción legítima repetida+nuevo eventId→
accepted. Sin persistencia real.

## H. Verified-context normalization

`normalizeCanonicalEvent(raw, verifiedContext)`. `verifiedContext = {authenticatedUserId,
verifiedInstitutionId?, verifiedGroupId?, provenance, receivedAt}` es la **única autoridad**.
Contexto inválido (sin auth / provenance no-enum / receivedAt no-finito) → `INSUFFICIENT_PROVENANCE`.
No fabrica id/actor/tiempo. `verifiedContext` es la frontera de abstracción: **sin dependencia de
código M1-A/M1-B** en el validador.

## I. Actor authority

Autoridad = `verifiedContext.authenticatedUserId`. `actorId` crudo distinto → **`ACTOR_MISMATCH`**.
Nunca x-user-id/body/cookie como autoridad. El adapter v1 pasa `userId` como CLAIMED; el normalizer
lo confronta con el contexto.

## J. Tenant snapshots

`institutionId`/`groupId` sólo confiables desde `verifiedContext`. Cliente aporta tenant que NO
coincide con el verificado → **`TENANT_MISMATCH`**; cliente aporta tenant y el contexto NO lo
verifica → `TENANT_MISMATCH` (spoof rechazado). Sin claim crudo, el snapshot verificado se sella.
Sin dependencia de código M1-B (el contexto es la abstracción).

## K. Content identity

`contentId`/`subresourceId` validados por tipo (`requirementsFor`); no requerido donde el contrato
legítimamente carece (LU/system/session). Nunca título/nombre como identidad.

## L. Session semantics

`interactionSessionId` ≠ `sid` de seguridad M1-A. `authSessionId` en el sobre → `FORBIDDEN_FIELD`.
`interactionSessionId` requerido sólo donde el tipo lo exige. events.db `session_id`→`interactionSessionId`.

## M. Time / offline

`occurredAt`(client-origin, acotado) + `receivedAt`(server-owned, se ignora cualquier receivedAt
crudo). UTC epoch ms. Cotas: futuro > `MAX_FUTURE_SKEW_MS`(5min) → `INVALID_TIME`; piso de sanidad
`MIN_PLATFORM_TS`(2020) para occurredAt/receivedAt; **pasado viejo NO se rechaza** (backlog offline
legítimo, probado con evento de 2021). Skew ≠ old-but-valid. `offline` = boolean server-normalized,
NO prueba de autorización. Estado de cola (queued/retryCount) es transporte, fuera del sobre.

## N. Provenance

Enum `{web, lu, server, leo, experience, migration}`, sellada por `verifiedContext`. `provenance`
crudo distinto → **`INVALID_PROVENANCE`** (cliente NO puede afirmar server/migration).

## O. Synthetic exclusion handoff

El evento **NO** lleva `_loadtest_marker` ni `synthetic` client-controlado. La exclusión de la
cohorte sintética la resuelve el materializer uniendo `actorId` contra la autoridad canónica de
exclusión (CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01) — cohorte atemporal ⇒ lookup determinista en
replay. Sin dependencia de `e412e5a`. Documentado en comentarios/tests.

## P. Versioning

`schemaVersion` requerido; `SUPPORTED_SCHEMA_VERSIONS=[1]`. Versión futura → **`UNSUPPORTED_VERSION`**
(fail-closed, no interpretación silenciosa). Sin versiones por-campo.

## Q. Payload / PII

`payload` ≤ **4KB** (`PAYLOAD_TOO_LARGE`). Zod `.strict()` del registry = allowlist por tipo; el
canónico además **rechaza** claves de payload desconocidas (`UNKNOWN_PAYLOAD_KEY`) en vez de
`.strip()` silencioso. `scanForbiddenKeys` (deep) rechaza PII directa (email/ip/userAgent/rawPrompt/
rawResponse/password/token/…) → `FORBIDDEN_FIELD`. `__proto__` vía JSON.parse = asignación de
prototipo descartada por spread (sin polución global, probado); own-key inyectada → `UNKNOWN_PAYLOAD_KEY`.
Sin `{...rawPayload}` sin validar.

## R. Derived state

`progressPercentage`/`streak`/`level`/`xp`/`blocksCompleted`/`readCount` **NO** son autoridad
canónica: no están en ningún schema de tipo → el canónico los rechaza (`UNKNOWN_PAYLOAD_KEY`).
`progress_fraction`/`elapsedMs` (señales factuales) sí se permiten donde el tipo las declara. El
adapter v1 NO copia derived state como autoridad (probado: `streak` del v1 → rechazado).

## S. Reader / media / Leo / activity types

Sólo tipos que existen/aceptados por contrato (registry). Reader: `reading_started/progress/
completed/paused/resumed`, `pdf_page_changed`, `album_page_changed`, `session_*`. Media: `audio_*`
donde el emisor existe (nunca WATCHED/LISTENED_FULLY inferido). Leo: hechos PII-free
(`leo_interaction_*`), texto crudo rechazado. Activity: `teacher_reviewed_recommendation`
(`accepted:boolean`), sin score automático. RESUME/COMPLETE faltantes = gaps de instrumentación
(§AH), no se inventan emisores.

## T. Compatibility adapters

`legacyNameToCanonical` (aliases DELIBERADOS 1:1; sin equivalente → `null`, NO se inventa),
`adaptBackboneV1ToRaw` (v1→raw; sin eventId/clientTs → `INSUFFICIENT_PROVENANCE`; sin canónico →
`NO_CANONICAL_MAPPING`; nunca fabrica actor/tiempo). Preservan significado factual.

## U. Migration classification

`classifyMigration`: `DIRECTLY_COMPATIBLE` (native v1 verificado), `NORMALIZABLE` (legacy con
actor+tiempo suficientes, provenance=legacy/migration), `INSUFFICIENT_PROVENANCE` (sin actor/tiempo),
`INVALID_FOR_CANONICAL_REPLAY` (sin eventId — p.ej. playback_events.log; o sin tipo canónico). Sin
backfill, sin ids fabricados.

## V. Append-only contract

events.db = INSERT / INSERT OR IGNORE; ningún path canónico normal hace UPDATE/DELETE de hechos
(verificado en -00: sólo rotación de archivo gated). Correcciones = evento correctivo. Sin código de
DB productiva aquí.

## W. Failure types

`EVENT_ERROR`: INVALID_EVENT, UNSUPPORTED_VERSION, UNKNOWN_EVENT_TYPE, ACTOR_MISMATCH,
TENANT_MISMATCH, INVALID_PROVENANCE, INVALID_TIME, PAYLOAD_TOO_LARGE, FORBIDDEN_FIELD,
UNKNOWN_PAYLOAD_KEY, INSUFFICIENT_PROVENANCE, MISSING_EVENT_ID. Ningún error filtra payload crudo.

## X. Duplicate harness

En memoria (fake persistence, sin SQLite): accepted/duplicate/conflict/accepted (§G). Prueba que un
duplicado con material alterado es **conflict**, no duplicate inocuo.

## Y. Golden fixtures

`ONLINE_READER`, `OFFLINE_LU`, `MEDIA`, `LEO`, `ACTIVITY`, `MIGRATION` — cada uno separa **RAW CLIENT
EVENT → VERIFIED CONTEXT → NORMALIZED CANONICAL EVENT** y normaliza GREEN con su provenance sellada.
Sin PII.

## Z. Security matrix

45 aserciones core + 23 adapter GREEN: valid online, missing eventId, invalid ULID, duplicate,
conflicting duplicate, tampered actor, client tenant mismatch/spoof, client role/authSession field,
invalid provenance, client-claims-migration, oversized payload, unknown payload key, forbidden PII,
nested PII, derived state, prototype-pollution shape, invalid/future time, offline valid/old,
future schemaVersion, unknown eventType. Outcome exacto por caso.

## AA. events.db mapping

`event_id→eventId`, `schema_version→schemaVersion`, `event→eventType`(via alias), `user_id→actorId`,
`content_id→contentId`, `session_id→interactionSessionId`, `client_ts→occurredAt`,
`server_ts→receivedAt`, `payload_json→payload`. Probado con fila simulada (sin abrir DB). Sin migración.

## AB. Runtime non-interference

Módulos nuevos **no referenciados** por rutas productivas (grep verificado). `eventRegistry.js`
**sin cambios** (analyticsCanon 46/0). `/api/v1/events` y demás endpoints intactos; sin rechazo nuevo
en runtime. Default productivo idéntico.

## AC. Store isolation

`verify-test-store-isolation test:event-contract`: 0 creados/modificados/eliminados, 367 stores
intactos → **`EVENTS_DB_WRITES=0`, `INSIGHTS_DB_ACCESSES=0`, `PRODUCTION_STORE_WRITES_FROM_TESTS=0`**
(los tests son puros en memoria, no abren ninguna DB).

## AD. Performance

Validador puro O(1): lookup de registry por nombre (objeto), sin disco, sin lookup de identidad
(`verifiedContext` inyectado), payload ≤4KB. Sin coste patológico.

## AE. Full tests

event-contract 45+23, analyticsCanon 46 (registry intacto), metric-contract completo GREEN (EXIT=0,
incl. equivalence 23/23), store-isolation PASS, typecheck sin regresiones, build GREEN, evidence
736/0. Sin regresión M1 (no se tocó código M1).

## AF. CI

`test:event-contract` añadido a `test:metric-contract` (se ejecuta en identity-preflight por
`server/**`+`package.json`). Push de la rama; gates exact-tree. Baseline heredado
(gitleaks-history/trivy-image) separado; sin excepción nueva.

## AG. EVENT_CONTRACT_IMPLEMENTATION_READY

**true** (`EVENT_CONTRACT_PRODUCTION_ACTIVE=false`). Sin ingestión productiva cambiada.

## AH. Instrumentation handoff (CHP-STATS-INSTRUMENTATION-00)

RESUME ausente en TODOS los modos; COMPLETE explícito sólo Álbum/Inmersivo (resto inferido);
audio/video standalone sin emisor; cola offline sólo en a11y (backbone/LU incompleta). No se repara aquí.

## AI. Ingestion handoff (CHP-STATS-INGEST-01)

Consumirá: registry canónico + `normalizeCanonicalEvent` + contrato `verifiedContext` (actor via
M1-A, tenant snapshot via M1-B, provenance sellada por canal, receivedAt server) + `EVENT_ERROR` +
dedupe por `event_id UNIQUE`. No se implementa ingestión.

## AJ. Materializer handoff

Garantías estables: `eventId`, `schemaVersion`, `eventType`, `actorId`, snapshots verificados si
presentes, `occurredAt`/`receivedAt`, `provenance`. El materializer deriva, no muta. Exclusión
sintética = join por `actorId` (§O).

## AK. Groups-canary non-interference

Sólo `docker inspect --format`: api_1 `cf36852` json / api_2 `cf36852` sqlite+groups, healthy,
restarts=0 → `GROUP_CANARY_STATE=RUNNING`.

## AL. Documentación / commit

Este doc + código en `chp/stats-event-contract-01`. `lint:evidence` GREEN. Sin productive ref, sin
backup/restic, sin prune, sin force-push.

## AM. Exact next step

CI exact-tree GREEN. Luego **CHP-STATS-INGEST-01** (cablear normalizer a una ingestión shadow,
gated, tras M1-A/M1-B) y **CHP-STATS-INSTRUMENTATION-00** (matriz §AH) — ninguna en esta unidad.
