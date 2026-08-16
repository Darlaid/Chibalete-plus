# CHP-STATS-INGEST-01B — Migración de contexto en events.db + bridge verifiedContext (offline)

**Veredicto:** `GREEN PREP — EVENTS SCHEMA AND VERIFIED CONTEXT BRIDGE READY FOR FUTURE CANONICAL INGEST ACTIVATION`

- 2026-08-16, **offline / dormant**. Sin activar `/api/v1/events`, sin migrar la events.db productiva, sin M1-B deploy, sin materializer, sin backfill.
- Rama `chp/stats-ingest-01b` desde `6b200fb` (tip 01-PREP; código `9fedb99`). M1 intacto (`0ff76b6` COMPAT ×2, front `m1a-0ff76b6`).

## 1. Modelo de contexto (FASE 1)

Snapshot factual mínimo del contexto que un evento puede persistir:
```
actor_id         (ya = user_id, autoridad server)
institution_id   nullable
group_id         nullable
```
Reglas: **hecho personal legítimo** → `institution_id=NULL`, `group_id=NULL`; **hecho institucional verificado** → `institution_id` server-resuelto; `group_id` solo si el grupo es parte real del contexto verificado. **No se fabrica contexto ausente.** No se duplican display names/roles.

## 2–3. Migración de schema (aditiva/idempotente)

`server/analytics/eventsTenantMigration.mjs` — `migrateEventsTenantColumns(db)` (handle better-sqlite3 inyectado; no toca la conexión de `eventsService`). Añade `institution_id TEXT` + `group_id TEXT` **nullable** con `ALTER TABLE ADD COLUMN`. Garantías: **solo aditivo** (sin DROP/DELETE/TRUNCATE/rewrite), **idempotente** (comprueba `PRAGMA table_info`; 2ª corrida = no-op), en transacción. Eventos históricos → `NULL` (ADD COLUMN nullable), **sin backfill inventado**. Exige que la tabla `events` exista (no fabrica schema base). **DORMANT:** no se invoca en el arranque en esta unidad; se ejecutará en la activación controlada futura, nunca contra la DB productiva aquí.

## 4. canonicalIngest — persiste contexto verificado

`normalizeForIngest` ahora toma `institution_id`/`group_id` **solo** de `verifiedContext` (server). El crudo no puede autoafirmarlos: `raw.institutionId/organizationId/tenant.institutionId` ≠ verificado (o presente sin verificar) → `TENANT_MISMATCH` (403); ídem `groupId`. Contexto ausente → `NULL` (personal, aceptado). El `fact` lleva `institution_id`/`group_id` de primera clase; `factFingerprint` los incluye (parte del hecho persistido). Actor sigue = `verifiedContext.authenticatedUserId` (spoof → `ACTOR_MISMATCH`).

## 5–6. Bridge `verifiedContext` + dependencia M1-B

`server/analytics/verifiedContext.mjs` — `verifiedContextFromAuth(req, {provenance})` construye `{authenticatedUserId, institutionId?, groupId?, provenance}` **solo desde `req.auth`** (M1-A actor; M1-B tenant). Sin fallback a `req.user`/`x-user-id`/body: sin sesión verificada → sin contexto. Tolera la convención real de M1-B (`auth.institutionId ?? auth.organizationId ?? auth.tenant?.institutionId`; `auth.groupId ?? auth.tenant?.groupId`). **DORMANT:** no cablea el endpoint productivo.

**Dependencia M1-B explícita (FASE 6):** el snapshot institucional verificado solo existe cuando M1-B esté desplegado y poble `req.auth`. Hasta entonces el bridge soporta **contexto personal autenticado** (actor solo, tenant NULL) **sin bloquear** hechos personales legítimos. No duplica la lógica de resolución de M1-B; solo lee lo que M1-B haya verificado.

## 7. Tests (47 ✓)

`npm run test:canonical-ingest` (ahora encadena las 3 suites):
- **canonicalIngest** 26 ✓ (contrato base 01-PREP, reajustado a institution/group).
- **eventsTenantMigration** 5 ✓: schema antiguo migra; 2ª corrida idempotente; eventos históricos intactos (contexto NULL, sin backfill); tabla ausente → error; aditivo (sin DROP/DELETE).
- **ingestTenantContext** 16 ✓: hecho personal → NULL; institución verificada persiste; grupo verificado persiste; institución/grupo autoafirmado (body) → `TENANT_MISMATCH`; tenant opcional ausente pero verificado → persiste verificado; actor auth-autoritativo con contexto; sin dependencia de x-user-id (headers/body no aportan identidad ni tenant; x-user-id en el sobre → `FORBIDDEN_FIELD`); **duplicado conserva contexto original**; **conflicto NO sobrescribe contexto**; adapter personal/institucional/sin-auth; adapter→ingest end-to-end.

## 8. Store isolation

`PRODUCTION_EVENTS_DB_WRITES=0`, `PRODUCTION_INSIGHTS_DB_WRITES=0`, `PRODUCTION_IDENTITY_WRITES=0`. Migración e ingestión probadas contra events.db **temporal** (`os.tmpdir()`, schema antiguo → migrado). `verify-test-store-isolation` PASS (367 stores intactos). No se abrió ni migró la DB productiva.

## 9. Sin runtime wiring

`canonicalIngest` sigue **DORMANT**; **no** sustituye el handler vivo de `POST /api/v1/events`; la migración **no** se activa en producción. Esta unidad prepara componentes.

## 10. CI

Los tests nuevos se ejecutan vía el script `test:canonical-ingest` (expandido a las 3 suites), **ya cableado** al workflow `identity-preflight` (paso «Ingestión canónica de eventos (01-PREP)») y cubierto por el guard de store-isolation — sin cambiar el workflow. Evidencia remota exact-tree: ver §CI-evidence tras el push.

## 11. Handoff de activación

```
EVENTS_TENANT_COLUMNS_READY = true
EVENTS_SCHEMA_MIGRATION_READY = true       (aditiva, idempotente, dormant)
VERIFIED_CONTEXT_ADAPTER_READY = true      (verifiedContextFromAuth, dormant)
CANONICAL_INGEST_RUNTIME_WIRED = false
M1_B_REQUIRED_FOR_INSTITUTIONAL_CONTEXT = true  (personal funciona sin M1-B)
INGEST_ACTIVATION_GATE_READY = true
```
La **activación** es una unidad separada: (a) ejecutar la migración contra la events.db productiva (aditiva, segura), (b) cablear `canonicalIngest` al handler de `/api/v1/events` resolviendo `verifiedContext` con `verifiedContextFromAuth` desde `req.auth` (requiere auth middleware en el endpoint), (c) M1-A enforce para `req.auth.userId` fiable, (d) M1-B para el tenant verificado. No en esta unidad.

## 12. M1 no interferido

Read-only: api_1/api_2 `0ff76b6` COMPAT/json, front `m1a-0ff76b6`, healthy, restarts=0. Sin tráfico de prueba productivo.

## STOP — ninguna disparada

migración aditiva/idempotente; históricos intactos; personal puede quedar tenant-null; institución/grupo solo server-verificado; spoof rechazado; ingest persiste contexto verificado; adapter listo; sin x-user-id; solo DB temporal; M1 intacto.
