# Leo Longitudinal Events — Fase 2A LEC

> **Estado:** Fase 2A — primer cableo Leo ↔ events.db.
>
> Cierra el único gap estructural identificado en la auditoría Fase 2A:
> Leo no emitía a events.db. Ahora sí, gated por flag.

## 1. Qué cambió

Antes de Fase 2A, Leo persistía sus interacciones SOLO en JSON paralelos
(`leo_memory_db.json`, `leo_profile_db.json`, `leo_evidence_db.json`,
`leo_interactions_db.json`). Los 6 events `leo_*` del `eventRegistry.js`
estaban definidos pero ningún código los emitía.

Fase 2A introduce `server/leoBackboneEmitter.mjs` y lo cablea en
`leoOrchestrator.dispatchInteraction(...)`. Cuando el flag
`LEO_EVENTS_BACKBONE_ENABLED=1` está activo, cada interacción Leo emite
hasta 4 eventos al events.db canónico:

| Evento                       | Cuándo                                            | Schema (registry)                          |
|------------------------------|---------------------------------------------------|--------------------------------------------|
| `leo_interaction_started`    | Antes del switch de surface (companion/chatbot/recap) | `{ sessionId, kind }`                     |
| `leo_memory_updated`         | Inmediatamente después de `recordInteraction(...)`    | `{ userId, keys: string[] }`              |
| `leo_evidence_recorded`      | Inmediatamente después de `persistLeoEvidence(...)`   | `{ userId, kind, sourceEvent? }`          |
| `leo_interaction_completed`  | Cierre del lifecycle, con `durationMs` real           | `{ sessionId, kind, durationMs? }`        |

El `sessionId` es un ULID único por interacción que correlaciona los 4
eventos. `mode: 'leo'` en todos los rows (queryable por PASO 3/6).

## 2. Qué NO cambió

- Flujo Leo end-to-end (request → answer) — idéntico. Latencia agregada
  por los emisores es <1ms en flag ON (validateEvent + insertEvent sync
  sobre SQLite WAL) y exactamente 0 en flag OFF.
- `leo_memory_db.json`, `leo_profile_db.json`, `leo_evidence_db.json`,
  `leo_interactions_db.json` — intactos. Siguen siendo autoridad del
  contenido detallado (texto del estudiante, respuesta Leo, evidencia
  estructurada).
- PASO 3 (interventionEngine, 29/29 tests ✓) — intacto.
- PASO 6 (outcomeEngine + 5 engines, 307/307 tests ✓) — intacto.
- Schemas del eventRegistry — sin cambios.
- Endpoint HTTP `/api/v1/events` — sin cambios.

## 3. Activación segura

### 3.1 Pre-requisitos

| Pre-check                                                          | Cómo verificar                                            |
|--------------------------------------------------------------------|-----------------------------------------------------------|
| `events.db` existe y es escribible                                  | `ls -la data-critical/events.db && sqlite3 ... '.tables'` |
| Pipeline shadow (`analyticsShadow.recordCanonicalEvent`) responde   | Ya probado por `test:analytics` (analyticsCanon)          |
| `eventRegistry` no ha cambiado los schemas Zod LEO                  | `node server/__test__/leoBackboneEmitter.test.js`         |
| `npm run test:analytics` verde                                      | CI gate                                                   |

### 3.2 Activación

En el VPS productivo:

```bash
# /opt/chibaleteplus/.env (o equivalente para Docker Compose)
LEO_EVENTS_BACKBONE_ENABLED=1
```

Restart api containers para que el cambio quede limpio:

```bash
docker compose restart chibalete_api_1
# verificar logs: cualquier 'leoBackboneEmitter' debería aparecer al primer /api/leo/ask
docker compose restart chibalete_api_2
```

### 3.3 Verificación post-activación

```sql
-- En events.db (data-critical/events.db):
SELECT event, COUNT(*) AS n
FROM events
WHERE mode = 'leo'
  AND server_ts >= strftime('%s','now','-1 hour')*1000
GROUP BY event;
```

Esperado tras ~5 interacciones Leo: 5 rows por evento, total ≤20.

### 3.4 Rollback inmediato

```bash
LEO_EVENTS_BACKBONE_ENABLED=0   # o unset
docker compose restart chibalete_api_1 chibalete_api_2
```

El emisor lee el flag per-call; sin restart, las próximas interacciones
dejan de emitir. Restart es defensivo (asegura estado limpio del
prom-client labels).

## 4. Relación con PASO 3 / PASO 6

PASO 3 (`interventionEngine.mjs`) y PASO 6 (6 engines de outcomes) ya
están preparados para consumir events.db. Hoy NO consumen eventos Leo
porque no existían. Con Fase 2A:

- **PASO 3 puede empezar a observar señales pedagógicas de Leo** (frecuencia
  de interacción, tipos de interaction más solicitados, abandono de
  conversación). Las reglas pedagógicas (8 reglas determinísticas, todas
  documentadas) pueden ampliarse para considerar señales Leo.

- **PASO 6 puede correlacionar outcomes con uso de Leo** (¿estudiantes que
  conversan más mejoran outcome rate? ¿alguna interaction kind correlaciona
  con outcome positivo?). Esto NO se calcula automáticamente — requiere
  habilitar `AULA_VIVA_OUTCOME_ENGINE_ENABLED=1` y dar a snapshot_history
  ≥14 días de baseline con datos Leo incluidos.

**Importante**: activar `LEO_EVENTS_BACKBONE_ENABLED` NO activa PASO 3/6.
Cada uno tiene su propio flag (ver `docs/AULA-VIVA-PASO-5-OPERACIONAL.md`).
La activación recomendada es:

1. Activar `LEO_EVENTS_BACKBONE_ENABLED=1` en staging primero. Validar
   que los 4 events aparecen en events.db tras smoke Leo.
2. Esperar ≥14 días en staging para acumular baseline.
3. Promover a prod con `LEO_EVENTS_BACKBONE_ENABLED=1`.
4. (Decisión separada) Activar `AULA_VIVA_OUTCOME_ENGINE_ENABLED=1` cuando
   se quiera que outcomes considere la nueva señal Leo.

## 5. Pendientes (próximas fases)

Schemas ya definidos en el registry, pero el wiring queda para fases
siguientes:

- `leo_profile_updated` — emitir cuando el LeoReaderProfile cambia con
  delta real (no en cada interactionCount++). Requiere identificar el
  punto exacto en `leoMemoryService.updateLeoProfile()` donde el delta
  no es trivial.
- `leo_recommendation_generated` — emitir cuando `leoActivationService`
  genera una recomendación pedagógica. Requiere auditar el flujo de
  `leoActivationService` (está en `/server/leoActivationService.js`).

Ambos están **stubbed** en `leoBackboneEmitter.mjs` (`emitProfileUpdated`,
`emitRecommendationGenerated`) — la API existe; falta cablearla a los
puntos correctos del lifecycle.

## 6. Riesgos restantes

| Riesgo                                                              | Mitigación                                                                       |
|---------------------------------------------------------------------|----------------------------------------------------------------------------------|
| Saturación de events.db con Leo events                              | Cap implícito: ~1 conversación Leo/min/usuario. Throughput máximo ~4 events/conv. Negligible vs reading events. |
| Schema del registry cambia y emisor envía payload inválido          | Test `[3]` valida cada payload contra `validateEvent` real. CI gate.            |
| PII filtra por error en payload                                     | Test `[5]` valida ausencia de `text/answer/message/prompt/response/content/body`. |
| recordCanonicalEvent falla y rompe Leo                              | Test `[4]` valida que insertEvent throwing NO propaga. `_safeEmit` doble guard. |
| Flag activado en multi-instance sin coordinar                       | El flag se lee per-call; ambas instances pueden tener estados diferentes durante un rolling restart. Sin impacto funcional. |
| Pérdida de events durante rolling restart                           | events.db es WAL + dedup ULID. Pérdida posible solo si el insertEvent estuviera in-flight durante kill -9; aceptable. |

## 7. Cómo verificar local

```bash
# Test del emisor (60 asserts)
node server/__test__/leoBackboneEmitter.test.js

# Pipeline completo de analytics (incluye el emisor)
npm run test:analytics
```
