# CHP-STATS-SHADOW-01A — Shadow de métricas legacy ↔ canónico

> **Estado: implementado localmente. NO desplegado.** `METRICS_ENGINE` sigue en
> `legacy` en producción y el shadow queda **inerte** mientras
> `METRICS_SHADOW_SAMPLE_RATE` no se fije explícitamente.

## 1. Los tres modos

| Modo | Respuesta pública | Trabajo canónico |
|---|---|---|
| `legacy` (default) | handler legacy, intacto | **ninguno** |
| `shadow` | handler legacy, intacto | encolado y ejecutado **fuera** del camino de respuesta |
| `canonical` | canónico proyectado al shape legacy | sí, síncrono |

`metricsEngineMode()` lee `process.env` **por request**; un valor desconocido
cae a `legacy`.

## 2. Rutas conectadas

Las cuatro pasan por una **frontera única**, `mountLegacyMetricsRoute` →
`executeMetricsRoute`:

| routeKind | ruta | autorización | fuente legacy |
|---|---|---|---|
| `metrics.schools` | `GET /api/metrics/schools` | admin secret o requester autenticado | texto `group.school` |
| `metrics.school` | `GET /api/metrics/school/:schoolId` | **solo admin secret** | `computeSchoolMetrics(schoolName)` |
| `metrics.course` | `GET /api/metrics/course/:courseId` | admin o mediador del curso | `computeCourseMetrics(courseId)` |
| `metrics.student` | `GET /api/metrics/student/:userId` | admin o **el propio usuario** | `computeStudentMetrics(userId)` |

La autorización ocurre **dentro de cada handler legacy, antes** de la frontera.
La frontera no decide accesos y no los duplica: si el handler responde 403, no
hay trabajo canónico.

## 3. Periodos — por qué casi nada es comparable

| Ruta | cuerpo legacy | bloque `backboneMetrics` |
|---|---|---|
| `metrics.schools` | `NONE` (listado, no métrica) | — |
| `metrics.school` | `ACCUMULATED` (histórico, sin ventana) | `FIXED_WINDOW` 30 d |
| `metrics.course` | `ACCUMULATED` | `FIXED_WINDOW` 30 d |
| `metrics.student` | `ACCUMULATED` | `FIXED_WINDOW` 30 d |

El cuerpo legacy es un **acumulado histórico sin ventana declarada**. El motor
canónico usa periodo explícito (30 d por defecto). Comparar uno contra otro
produciría divergencias falsas, así que se marca `PERIOD_NOT_COMPARABLE` y **no
se calcula delta ni se emite alerta**.

El único terreno común real es `backboneMetrics`, que sí lee `events.db` con
ventana de 30 días.

## 4. Matriz de comparabilidad

Solo dos métricas llegan al comparador:

| Métrica | Clasificación | Razón |
|---|---|---|
| `sessions` | `COMPARABLE_WITH_NORMALIZATION` | `SESSION_RECONSTRUCTION_DIFFERENCE` |
| `distinctContents` | `COMPARABLE_WITH_NORMALIZATION` | `UNATTRIBUTED_EVENTS_EXCLUDED` |

Excluidas y por qué:

- `registeredUsers` → `EXPECTED_CONTRACT_DIFFERENCE`: legacy cuenta por texto
  `school`, canónico por `organizationId`. Poblaciones distintas por definición.
- `registeredReaders`, `eligibleReaders`, `readersWithoutGroup`, `coverage`,
  `measurementStatus` → `NOT_AVAILABLE_IN_LEGACY`.
- `usersWithActivity` → `PERIOD_NOT_COMPARABLE`.
- `platformTimeMs` → `SEMANTICALLY_UNSAFE`: `elapsed_ms` es **acumulado** por
  sesión; sumarlo infla el total.
- `engagementRate` → `SEMANTICALLY_UNSAFE` / `NO_DATA_SEMANTICS`: legacy devuelve
  **0 cuando `studentCount` es 0**, un cero que en realidad significa «sin datos».
- `readingTimeMs` → `NOT_AVAILABLE_IN_CANONICAL`: el contrato lo declara
  `NOT_DEFINED`; no se publica ni se compara.
- `readingLevels`, `icdli`, `alerts` → `SEMANTICALLY_UNSAFE`: indicadores
  evaluativos o prescriptivos, fuera del contrato de seguimiento.

## 5. Taxonomía de diferencias

Razones: `LEGACY_SOURCE_DIFFERENCE`, `POPULATION_CONTRACT_DIFFERENCE`,
`LEGACY_TEXT_JOIN`, `SESSION_RECONSTRUCTION_DIFFERENCE`, `PERIOD_DIFFERENCE`,
`NO_DATA_SEMANTICS`, `UNATTRIBUTED_EVENTS_EXCLUDED`, `METRIC_NOT_COMPARABLE`,
`CANONICAL_SOURCE_ERROR`, `CANONICAL_SHAPE_INVALID`, `LEGACY_SHAPE_INVALID`,
`UNKNOWN_DIFFERENCE`.

Severidades: `EXPECTED` · `REVIEW` · `ALERT` · `ENGINE_ERROR`.
**Una diferencia esperada por contrato no es un fallo.**

### Campos emitidos (y solo estos)

`routeKind`, `organizationId`, `period` (solo `fromTs`/`toTs`/`days`),
`metricKey`, `legacyValue`, `canonicalValue`, `absoluteDelta`, `relativeDelta`,
`reasonCode`, `severity`, `contractVersion`.

Nunca: `userId`, email, nombre, token, payload, cabeceras, path con
identificadores ni contenido de evento.

## 6. Ejecutor shadow — límites

| Variable | Default | Efecto |
|---|---|---|
| `METRICS_SHADOW_SAMPLE_RATE` | **0** | 0 ⇒ shadow inerte |
| `METRICS_SHADOW_TIMEOUT_MS` | 2000 | abandona un canónico lento |
| `METRICS_SHADOW_MAX_CONCURRENCY` | 2 | trabajo simultáneo |
| `METRICS_SHADOW_QUEUE_LIMIT` | 50 | al llenarse descarta y cuenta |
| `METRICS_SHADOW_ERROR_THRESHOLD` | 10 | fallos consecutivos → breaker |
| `METRICS_SHADOW_BREAKER_COOLDOWN_MS` | 60000 | suspensión temporal |

**Ninguna variable ausente activa el shadow.** `submit()` es síncrono: encola y
vuelve; la respuesta pública nunca lo espera.

Contadores: `shadow_requests_total`, `shadow_comparisons_started`,
`shadow_comparisons_completed`, `shadow_comparisons_skipped`,
`shadow_queue_full`, `shadow_timeouts`, `shadow_canonical_errors`,
`shadow_shape_errors`, `shadow_differences_by_reason`, `shadow_duration_ms`,
`shadow_legacy_response_duration_ms`. Sin base nueva, sin persistir payloads.

## 7. Compatibilidad del shape legacy

| Ruta | Estado |
|---|---|
| `metrics.schools` | `CANONICAL_COMPATIBLE` |
| `metrics.school` | **`CANONICAL_BLOCKED`** |
| `metrics.course` | **`CANONICAL_BLOCKED`** |
| `metrics.student` | **`CANONICAL_BLOCKED`** |

Las tres bloqueadas comparten el mismo motivo: su `summary` no puede expresar
`NO_DATA` / `NO_ACTIVITY` / `NOT_DEFINED` sin colapsarlos en un `0` engañoso. En
lugar de improvisar ese cero, `canonical` **lanza `CanonicalBlocked`**. El shadow
sí está permitido en ellas.

## 8. Estados del programa

- **SHADOW READY** — frontera única, legacy idéntico, ejecutor acotado, tests en verde. ← *estado actual*
- **SHADOW OBSERVED** — desplegado con `sampleRate` > 0 y diferencias explicadas en las 4 instituciones.
- **CANONICAL COMPATIBLE** — la ruta puede proyectarse sin falsear estados.
- **CANONICAL BLOCKED** — el shape legacy no admite los estados canónicos.
- **CANONICAL APPROVED** — decisión humana tras SHADOW OBSERVED.

Criterios `legacy → shadow`: imagen inmutable desplegada · `sampleRate` bajo ·
cero 5xx atribuibles · p95 público sin degradar.
Criterios `shadow → canonical`: cero `ALERT` sin explicación · diferencias
estables y justificadas · ruta `CANONICAL_COMPATIBLE` · consumidores migrados.

## 9. Rollback conceptual

`METRICS_ENGINE=legacy` restaura el comportamiento exacto: la frontera devuelve
el handler legacy sin tocar nada. No hay migración de datos que revertir.

## 10. Pendiente declarado

**El ejecutor canónico NO está enlazado al proveedor real.** `mountLegacyMetricsRoute`
pasa `canonicalExecutor: null`, así que hoy `shadow` responde legacy y no compara.
Enlazarlo exige extraer de `metricsRouterV2` un cómputo canónico reutilizable y
alineado por periodo — una refactorización de los handlers v2 que merece su
propia unidad. La frontera, el comparador y el ejecutor ya están probados con
ejecutores canónicos inyectados.
