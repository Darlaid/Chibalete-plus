# CHP-STATS-INSTRUMENTATION-01A — Transporte compartido de eventos (offline)

**Veredicto:** `GREEN PREP — SHARED DURABLE EVENT TRANSPORT IMPLEMENTED AND READY FOR CRITICAL READER MIGRATION` · `INSTRUMENTATION_01A_READY=true`

- 2026-08-16, **implementación offline / dormant**. Sin producción, sin cambio de semántica de lectores, sin ingestión/materializer/events.db/insights.db.
- `INSTRUMENTATION_01A_BASE_SHA=0ff76b6` (frontend cookie-only desplegado; base correcta — el árbol `9fbe7e0` es pre-R1 y aún emite x-user-id, incompatible con FASE 10).
- Rama `chp/stats-instrumentation-01a`.

## Alcance y no-alcance

**Implementa (solo transporte):** capa compartida mínima que garantiza eventId/occurredAt en el hecho, cola durable, retry seguro, cero silent drop, payload bounded, envelope canónico-compatible.

**NO toca (queda para 01B/後):** `elapsedMs` de Texto/PDF/Álbum, `interactionSessionId`, completion, semántica de lectores, Audio/Video, ingestión backend, materialización. Ningún lector se recableó.

## Archivos (aditivos)

| Archivo | Rol |
|---|---|
| `utils/eventTransport.mjs` | Núcleo framework-agnóstico node-testable (DORMANT: no importado por ningún lector) |
| `utils/__tests__/eventTransport.test.mjs` | 17 tests herméticos (storage/fetch mockeados) |
| `package.json` | script `test:event-transport` (una línea) |

El `hooks/useA11yAnalytics.ts` **no se modificó** (byte-idéntico) → A11y sin regresión.

## Base: patrón extraído de A11y

De `useA11yAnalytics` se extrajo **solo el transporte genérico**: cola `localStorage` con cap drop-oldest, ULID en el enqueue, `clientTs`/occurredAt en el enqueue, persist-before-send, clear-solo-en-2xx, partición multi-usuario, triggers de retry (online/interval/beacon). **No** se copió lógica de accesibilidad (sesión, heartbeat, IntersectionObserver, nombres, progressFraction). Dos endurecimientos sobre A11y: (1) clasificación de fallos 5xx/429/network vs 4xx permanente; (2) telemetría explícita en overflow/quota/payload (A11y hacía silent drop en QuotaExceeded).

## API del transporte

`createEventTransport(opts)` → `{ createEvent, enqueue, emit, flush, retryQueued, queueSize, loadQueue, ... }`. Deps inyectables: `endpoint`, `storageKey`, `maxQueue`, `storage`, `fetchImpl`, `sendBeacon`, `now`, `generateId`, `onTelemetry`.

- **`createEvent(input)`** — fija `eventId` (ULID) y `occurredAt` **una sola vez, en el momento del hecho**. Envelope: `{eventId, schemaVersion:1, occurredAt, type, mode, contentId, interactionSessionId, payload?}` (compatible con el contrato canónico `9fbe7e0`).
- **`enqueue(evt, {scope?})`** — persiste durable; idempotente por `eventId`; rechaza payload >4KB (explícito).
- **`flush({scope?, useBeacon?})` / `retryQueued(...)`** — envía; persist-before-send; retira solo tras confirmación; reenvía el MISMO evento.

## Ciclo de vida de eventId (FASE 4)

`FACT CREATED → createEvent() → eventId=ULID una vez`. En `flush`/retry el evento se reenvía **verbatim**: nunca se regenera el id en `send()`. Test 3 verifica `retry#1 == retry#2 == original` (3 intentos con reloj avanzando 500→1.000.000; los 3 bodies llevan el mismo `eventId`).

## Ciclo de vida de occurredAt (FASE 5)

`occurredAt` se fija en `createEvent` con `now()` y se preserva verbatim. Test 3 confirma que los 3 reenvíos llevan `occurredAt=500` pese a que el reloj avanzó. Test 2: `occurredAt` no cambia aunque el reloj avance tras crear el evento. **NO se reemplaza por hora de transmisión.**

## Cola durable (FASE 6)

`localStorage` (clave por defecto `chp_event_transport_queue`), cap `maxQueue=200`, **drop-oldest** con telemetría `queue_overflow` (explícito, no silent). Sobrevive:
- **pérdida de red** (test 4: evento queda en cola tras fallo);
- **reload** (test 5: transporte nuevo sobre el mismo storage ve el evento con su eventId original y lo envía);
- **cierre/reapertura** (persistencia localStorage estándar).

Persistencia **durable-first**: `enqueue` escribe directo a la cola (sin buffer solo-en-memoria que pudiera perderse). QuotaExceeded → telemetría `storage_error` (explícito).

## Semántica de retry y clases de fallo (FASES 7–8)

`classifyResponse` → `success | retryable | permanent`:

| Resultado | Clase | Acción |
|---|---|---|
| 2xx (incluye idempotent/duplicate) | success | retira de la cola |
| network error | retryable | **conserva** (attempts++) + telemetría |
| 5xx | retryable | conserva |
| 429 | retryable | conserva |
| 4xx permanente (400/401/403/404/422/…) | permanent | **retira** (poison-pill) + telemetría `permanent_failure` |
| status desconocido | retryable | conserva (seguro) |

Sin loop infinito: un 4xx permanente se retira con estado explícito (no se reintenta para siempre). El evento se elimina **solo** tras confirmación de éxito (o descarte permanente atestado). Tests 7/8/9 cubren 5xx/network/4xx.

## Payload bound (FASE 9)

`≤4096 bytes` (igual que el contrato canónico). Payload mayor → `enqueue` devuelve `{ok:false, reason:'payload_too_large'}` + telemetría, **no** se encola (test 12). Sin transformación semántica, sin PII/free-text añadido.

## Auth (FASE 10)

El transporte **NO define identidad**. `fetch` con `credentials:'same-origin'` (cookie HttpOnly de sesión); **no** envía header `x-user-id`; el envelope de red **no** incluye `actorId`/`userId`/`tenant`/`role` autoafirmados (test 11 verifica ausencia de `x-user-id` y de actor en el body). La autoridad del actor la resolverá la normalización server-side futura (`normalizeCanonicalEvent`).

## Disposición multi-tab (FASE 15)

Dos pestañas comparten la clave `localStorage`; ambas pueden enviar el mismo evento. **Aceptable temporalmente**: ambos envíos llevan el **mismo eventId** y el backend deduplica (`UNIQUE(event_id)` / `INSERT OR IGNORE`). El campo opcional `scope` particiona la cola por usuario (dispositivo de colegio compartido) sin lock distribuido. No se sobre-ingeniería con locking. Test 13 confirma multi-send con mismo eventId; el enqueue es idempotente por eventId.

## Cero silent drop (FASE 13)

`SILENT_DROP_PATHS_IN_SHARED_TRANSPORT=0`. Todo camino no-exitoso es observable: red/5xx → cola; 4xx → telemetría `permanent_failure`; overflow → telemetría `queue_overflow`; quota → `storage_error`; payload grande → `payload_too_large`. Test 14 recorre los cuatro caminos.

## Tests (FASES 17–19)

`npm run test:event-transport` → **17 ✓, 0 ✗**. Cubre los 14 requeridos: (1) eventId una vez, (2) occurredAt una vez, (3) retry preserva ambos, (4) enqueue offline, (5) persistencia reload, (6/6b) éxito/duplicate retira, (7) 5xx conserva, (8) network conserva, (9) 4xx sin retry infinito, (10) cola acotada, (11) sin x-user-id, (12) payload bound, (13) multi-send mismo eventId, (14) cero silent drop; + `classifyResponse` + beacon.

- **Store isolation:** `verify-test-store-isolation.mjs` → PASS, **0 stores reales modificados/creados/eliminados** (`PRODUCTION_STORE_WRITES_FROM_TESTS=0`; storage/fetch mockeados en memoria).
- **ULID compatible:** 1000/1000 IDs generados cumplen el regex del backend `/^[0-9A-HJKMNP-TV-Z]{26}$/i`.
- **Build:** `vite build` GREEN (el módulo dormido no se bundea, no importado).
- **A11y:** hook sin cambios → equivalente (FASE 16).
- **lint:evidence:** GREEN.

## Handoff a 01B (FASE 21)

`CHP-STATS-INSTRUMENTATION-01B` usará `createEventTransport` para reparar **solo** los emisores P0/P1 de **Texto, PDF, Álbum** (y a11y opcionalmente unificando sobre esta capa):
- crear un hook `.ts` fino (`useEventTransport` o similar) que inyecte `ulid` de `clientUlid.ts` como `generateId` y monte los triggers de retry (mount/online/interval/visibilitychange/beacon), igual que A11y;
- cablear cada emisor para: **`elapsedMs` incremental** (deltas como Inmersivo, no acumulado), **`interactionSessionId` por apertura de lector** (no vida-de-app), **payload fact-only** (retirar derived state streak/level/percentage), y **`reading_completed` explícito**;
- mapear nombres a los tipos canónicos vía `CANONICAL_ALIASES`.

01B **no** debe reimplementar transporte/idempotencia/retry: eso lo provee esta capa. Audio/Video quedan para P2 (unidad posterior).

## No interferencia con M1 (FASE 22)

Verificado read-only al cierre: api_1/api_2 `0ff76b6` COMPAT/json, front `m1a-0ff76b6`, healthy, restarts=0. Implementación 100% offline; no se generó tráfico M1.

## Condiciones STOP — ninguna disparada

eventId/occurredAt nunca se regeneran en retry; ningún fallo de red pierde eventos; sin x-user-id; sin cambio de semántica de lectores; tests solo con storage/fetch mock (cero stores reales); build/tests GREEN; M1 intacto.
