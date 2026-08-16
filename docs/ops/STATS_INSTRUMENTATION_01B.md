# CHP-STATS-INSTRUMENTATION-01B — Reparación crítica de eventos (Texto/PDF/Álbum)

**Veredicto:** `GREEN PREP — CRITICAL READER P0/P1 INSTRUMENTATION REPAIRED AND READY FOR CANONICAL INGESTION WORK`

```
INSTRUMENTATION_01B_LOCAL_READY=true
REMOTE_CI_CONFIRMATION_PENDING=true      (sin gh/token en el entorno)
INSTRUMENTATION_01A_REMOTE_CI_CONFIRMED=false
NEW_CANONICAL_DUPLICATE_RISK=0
```

- 2026-08-16, **implementación offline / no producción**. `INSTRUMENTATION_01B_BASE_SHA=c7d5797` (tip de 01A). Rama `chp/stats-instrumentation-01b`.
- Solo P0/P1. **NO** Audio/Video, **NO** ingestión/events.db/insights.db/materializer, **NO** abandonment (`CHP-STATS-ABANDONMENT-TEMPORAL-01` intacto). M1 no tocado.

## Enfoque: migrar el emisor compartido, no añadir canales

Texto, PDF, Álbum (e Inmersivo) comparten `hooks/useBackboneReadingSession.ts`, que **ya** emitía `{mode}.session_start/heartbeat/progress/session_end` a `/api/v1/events` con **ULID por apertura** — pero era **fail-silent** (sin cola) y con **`elapsedMs` acumulado**. La reparación P0/P1 es **quirúrgica sobre ese emisor**: transporte durable 01A + `elapsedMs` incremental. **No se añadió ningún tipo/canal de evento nuevo** → `NEW_CANONICAL_DUPLICATE_RISK=0`. Los `getPayload` de los 3 lectores ya eran fact-only (source/language/sentenceCount/page/slide; sin streak/level/xp/percentage). El único cambio a lectores es instrumentación; rendering/navegación/TTS/PDF/Álbum sin cambios.

## Archivos

| Archivo | Cambio |
|---|---|
| `utils/readerEventCore.mjs` (nuevo) | Lógica pura node-testable: `createElapsedTracker` (delta incremental) + `buildReaderEvent` (evento dual-shape: cola 01A + endpoint backbone) |
| `utils/eventTransport.mjs` (edit) | Opción `maxBatch` en `flush` (≤50/tanda; evita silent-loss al drenar colas offline grandes). Aditivo, retrocompatible |
| `hooks/useBackboneReadingSession.ts` (edit) | Transporte durable 01A en vez de fetch fail-silent; `elapsedMs` incremental; `sendBeacon` rehabilitado (cookie-only); retry en `online`; drain al abrir |
| `utils/__tests__/readerEventCore.test.mjs` (nuevo) | 12 tests |
| `utils/__tests__/eventTransport.test.mjs` (edit) | +1 test `maxBatch` (18 total) |
| `package.json` | script `test:reader-instrumentation` |

## elapsedMs — semántica incremental (FASE 2/3/4/12)

Antes: cada evento llevaba `Date.now() - sessionStart` = **acumulado** (Texto/PDF/Álbum) → inflación / doble conteo. Ahora: `createElapsedTracker` devuelve el **delta desde el último checkpoint** y avanza el checkpoint. Golden (test): apertura 0 → +10s → +25s total → +40s total emite `0, 10s, 15s, 15s` (**no** `10, 25, 40`). Se reinicia por apertura (`tracker.reset(startTs)`). Aplica a `session_start`(0)/`session_heartbeat`/`progress`(emitEvent)/`session_end`.

## interactionSession — ciclo real (FASE 5/13)

`interactionSessionId = ulid()` **por apertura** (effect keyed en `[enabled, userId, contentId, mode]`) — ya era correcto pre-01B; se conserva y se le ancla el checkpoint de elapsed. Contrato: abrir → nueva sesión; checkpoints durante la apertura → misma sesión; cerrar y reabrir → nueva sesión (S1≠S2). **NO** usa `dataService.currentSessionId` (el UUID de vida-de-app queda solo en el camino de progreso `/sync`, fuera de este emisor). **NO** usa el sid de auth M1-A. Reload = nuevo mount = nueva apertura = nueva sesión (el materializador podrá derivar continuidad; no se fabrica RESUME).

## Transporte compartido (FASE 8) y offline (FASE 11)

El hook delega en `createEventTransport` (01A, `c7d5797`): cola durable `chp_reader_event_queue`, `generateId=ulid` (clientUlid), `sendBeacon` (Blob JSON), `maxBatch=50`. `enqueue` construye el evento (identidad estable) y lo persiste; el flush periódico (5s) + `online` + `visibilitychange`/`beforeunload` (beacon) + drain al abrir lo envían por lote. **No se reimplementó** ULID/queue/retry/occurredAt/payload-bound. Offline→online reenvía el **mismo eventId/occurredAt** (test). **Mejora habilitada por cookie-only:** `sendBeacon` (antes retirado por no poder setear `x-user-id`) vuelve a usarse en cierre, porque la cookie de sesión viaja sola.

## Evento dual-shape (compatibilidad)

`buildReaderEvent` produce un objeto que satisface **ambos** contratos: la cola 01A (`eventId` ULID, `occurredAt`, `type`) y el endpoint vivo `validateBackboneEvent` (`event`={mode}.{action}, `userId`, `sessionId`, `clientTs`). `occurredAt≡clientTs` (mismo hecho), `type≡event`. Así se reusa el transporte sin romper el endpoint y el evento sobrevive reload (la guarda de la cola exige `occurredAt`/`type`).

## Completion — sin fabricación (FASE 7)

| Lector | COMPLETION_EXPLICIT | COMPLETION_TRIGGER | 01B emite reading_completed |
|---|---|---|---|
| Texto | **false** | NONE | NO |
| PDF | **false** | NONE | NO |
| Álbum | **true** | `album_completed`/`marcarComoTerminado` (`VisorAlbum.tsx:1096`) | **NO** (evitar duplicado; ya cubierto por legacy `album_completed` + `/complete`) |

Completion explícito canónico es **P2** (la unidad es P0/P1). No se añadió ningún evento de finalización → sin duplicado. El materializador/INGEST podrá derivar `reading_completed` del trigger existente de Álbum (alias ya en `CANONICAL_ALIASES`). No se infiere completion de última página / % / cierre / media play.

## Matriz legacy/nuevo (FASE 9) — `NEW_CANONICAL_DUPLICATE_RISK=0`

| Acción | Legacy write | Evento backbone (01B) | Riesgo |
|---|---|---|---|
| abrir | `session_start` → `/api/analytics/events` | `{mode}.session_start` (durable) | preexistente (mismo canal, mejor transporte) — 0 nuevo |
| progreso/heartbeat | `block_complete`/`page_change` | `{mode}.progress`/`session_heartbeat` (delta) | preexistente; el delta **reduce** el doble conteo — 0 nuevo |
| cerrar | `session_end` | `{mode}.session_end` | preexistente — 0 nuevo |
| completar (Álbum) | `album_completed` + `/complete` | **ninguno añadido** | 0 nuevo |

01B **no** creó tipos/canales nuevos: actualizó el transporte y la semántica de elapsed del canal backbone existente. Los writers legacy se conservan (migración controlada, no eliminación — FASE 9).

## Privacidad (FASE 14)

Sin `x-user-id` (cookie same-origin), sin email/name/school/token/raw-Leo/free-text. El body lleva `userId` (campo del contrato backbone vivo, no header ni PII) — la autoridad la resolverá la normalización server-side. Payload ≤4KB (transporte). Test lo verifica.

## Tests (FASE 12/13/15/18)

- `test:event-transport` → **18 ✓** (14 base + classifyResponse + beacon + **maxBatch**).
- `test:reader-instrumentation` (`readerEventCore`) → **12 ✓**: elapsed golden 0/10/15/15, reset, no-negativo, evento dual-shape, action/guest/no-session inválidos → null, fracción [0..1], fact-only (sin streak/level/xp/…), sesión por apertura (S1≠S2), secuencia dorada Texto (OPEN→PROGRESS×2→CLOSE, deltas + sessionId estable + eventId único), offline→online mismo eventId/occurredAt (PDF), privacidad (sin x-user-id/PII).
- **store-isolation** PASS — `PRODUCTION_STORE_WRITES_FROM_TESTS=0` (367 stores intactos; storage/fetch mock).
- **typecheck:baseline** sin regresiones; **build** GREEN; **lint:evidence** GREEN.
- No mega-suite: un flujo representativo por familia (Texto secuencia dorada, PDF offline/retry, Álbum fact-only/privacidad).

## No-regresión (FASE 19)

`FRONTEND_PRODUCT_BEHAVIOR_REGRESSION=0`: solo instrumentación. No se tocó rendering, navegación, TTS, comportamiento PDF ni Álbum. API pública del hook (`sessionId/emitEvent/markActivity/endSession`) sin cambios → los 4 consumidores (Texto/PDF/Álbum/Inmersivo) siguen igual; el efecto colateral en Inmersivo es solo que su canal backbone también gana durabilidad + elapsed incremental (mejora consistente, no cambio de conducta). typecheck sin regresiones confirma equivalencia de tipos.

## CI (FASE 1/20)

Sin `gh`/token en el entorno → no se pudo consultar CI remoto de `c7d5797` ni de esta rama. Se **replicaron los gates localmente** (typecheck:baseline, build, store-isolation, evidence-ratchet, tests) todos GREEN. `REMOTE_CI_CONFIRMATION_PENDING=true`. **Ninguna promoción productiva de 01A/01B puede hacerse sin CI remoto confirmado.**

## Handoff a INGEST (FASE 21)

Para Texto/PDF/Álbum ya puede afirmarse: **eventId estable** (ULID en el hecho), **occurredAt estable** (preservado en retry), **interactionSessionId real** (por apertura), **elapsedMs incremental**, **payload fact-only**, **retry-safe** (idempotente por eventId), **payload bounded** (≤4KB). Input para `CHP-STATS-INGEST-01` (no implementado aquí). Pendiente futuro: `reading_completed` explícito canónico (P2) y unificación de nombres `{mode}.{action}`→registry vía `CANONICAL_ALIASES` en la normalización.

## M1 no interferido (FASE 22)

Read-only al cierre: api_1/api_2 `0ff76b6` COMPAT/json, front `m1a-0ff76b6`, healthy, restarts=0. Implementación offline; sin tráfico M1.

## STOP — ninguna disparada

eventId/occurredAt nunca se regeneran en retry; sin pérdida en fallo de red; sin x-user-id; sin cambio de conducta de lectores; tests solo con storage/fetch mock; sin duplicado canónico nuevo; M1 intacto.
