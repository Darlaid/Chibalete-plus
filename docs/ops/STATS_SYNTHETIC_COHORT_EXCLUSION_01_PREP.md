# STATS_SYNTHETIC_COHORT_EXCLUSION_01_PREP — Filtro canónico de cohorte (legacy)

Unidad: **CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01-PREP** (2026-08-15). Implementación
OFFLINE del diseño GREEN `-00`. **NADA desplegado; flag por defecto `off`; GROUPS canary
intacto; sin tocar events.db/insights.db/materializer/M1.**

- `STATS_EXCLUSION_BASE_SHA=cf36852` (source productivo de métricas)
- `STATS_EXCLUSION_SOURCE_BRANCH=chp/stats-synthetic-cohort-exclusion-00`
- rama de implementación `chp/stats-synthetic-cohort-exclusion-01` (desde `42ddcc6`)

## A. Veredicto

**🟢 GREEN PREP — LEGACY ANALYTICS SYNTHETIC COHORT EXCLUSION IMPLEMENTED AND READY FOR
STAGED SHADOW DEPLOYMENT.** `SYNTHETIC_EXCLUSION_IMPLEMENTATION_READY=true`
(NO `SYNTHETIC_EXCLUSION_PRODUCTION_CLOSED`).

## D. Módulo central de exclusión

`server/metrics/analyticsExclusion.mjs` — puro, sin I/O, sin estado global, `crypto` sólo
para h16 (inyectable). Primitivas: `resolveExclusionMode`, `isAnalyticsExcludedUser`,
`getAnalyticsExcludedUserIds`, `getAnalyticsAttestationState`, `isMarkerAuthorityProven`,
`isAnalyticsExcludedGroup`, `classifyAnalyticsGroup`, `filterCanonicalMemberIds`,
`classifyDifferential`, `h16`. Sin sobre-ingeniería; sin lectura de disco por registro.

## E. Clasificador de usuario

Único predicado = **marcador de padrón** `user._loadtest_marker`
(`isAnalyticsExcludedUser`). El conjunto de excluidos se construye **una vez por `init()`**
del motor (O(usuarios)). Jamás por email/nombre/rango/patrón de PK. Test:
`disabled` real (sin marcador) NO excluido; sintético `active` SÍ excluido (marcador manda).

## F. Estados de atestación (política congelada)

`_loadtest_marker` es autoridad PRIMARIA (disponible en el JSON que el legacy ya carga).
`migration_exclusions` (h16) es guard independiente. Estados:
- **ATTESTATION_OK** = markerSet == attestedSet.
- **ATTESTATION_DEGRADED** = marcador disponible, atestación ausente (`attestedExclusionHashes` null).
- **ATTESTATION_DRIFT** = ambos disponibles, difieren (igualdad estricta conteo+pertenencia).
- **AUTHORITY_INVALID** = autoridad de marcador malformada.

**Política por modo (UNA, implementada):**
- `off`: sin efecto.
- `shadow`: nunca altera respuesta. OK→diferencial; DEGRADED→diferencial marcado degraded;
  DRIFT/INVALID→`failClosed` en el diferencial (no publica comparación como confiable),
  respuesta legacy intacta.
- `on`: OK→filtra; **DEGRADED→filtra SÓLO si `isMarkerAuthorityProven` (marcador es autoridad
  primaria), con telemetría degradada**; **DRIFT/INVALID→FAIL CLOSED** (lanza
  `AnalyticsExclusionAuthorityError`, nunca fallback contaminado).

## G. Clasificador de grupo

`CANONICAL | LEGACY_COMPAT | SYNTHETIC_COMPAT | UNKNOWN`. Un grupo es SINTÉTICO sii tiene
≥1 miembro resoluble y **todos** están excluidos (por IDENTIDAD, no por nombre). Un grupo
legacy con ≥1 miembro real NO es sintético → su actividad real no se borra. Atestación de
grupo (h16 `SYNTHETIC_LOADTEST_EXCLUDED` / `LEGACY_TEST_GROUP_PENDING_RETIREMENT`) manda si
se aporta. **`LEGACY_COMPAT` nunca == `SYNTHETIC_COMPAT`.**

## H. Cohorte user-first

Orden: usuarios elegibles → excluir identidades sintéticas → resolver atribución canónica →
agregar. Nunca «agregar todo y restar». Nunca descartar un real por metadata de grupo legacy.

## I. Semántica de grupo legacy

Grupo legacy = dimensión analítica no-canónica; su actividad humana real permanece elegible.
Sin inventar membresía canónica. (En el motor legacy, un grupo legacy real conserva a sus
miembros reales en course/school; sólo los grupos 100%-sintéticos se vacían.)

## J. Costuras de cohorte (seams, delta mínimo)

Filtro en el **borde de selección**, ANTES de agregar (espejo de `referenceEngine.mjs:179`):
- `metricsService.resolveGroupMemberIds(group, exclude)` — filtra ids excluidos.
- `computeCourseMetrics`/`courseMetricsFrom` y `computeSchoolMetrics`/`schoolMetricsFrom`
  — threquean `exclude` (default = modo `on`).
- `computeStudentMetrics` — guard de entidad sintética directa → forma canónica-vacía.
- `server.js legacyMetricsSchoolsHandler` — en `on`, excluye grupos 100%-sintéticos de la
  lista de escuelas (fix de school compartido por IDENTIDAD). **Único cambio en server.js;
  no-op en off/shadow.**
No se tocaron funciones behavioral (0 eventos sintéticos).

## K. Denominadores

Recomputados desde la cohorte filtrada (nunca reemplazo global 647→247): course =
miembros reales del grupo; school = unión de miembros reales de sus grupos; nunca se asume
247 ni 647. Golden en el fixture: course g-canon=3, g-synth=0; school "Colegio Real"=3.

## L. Rutas de entidad sintética directa

En `on`: `computeStudentMetrics(syntheticId)` → canónico-vacío (`canonicalExcluded:true`,
contentStats 0); `computeCourseMetrics(syntheticGroup)` → studentCount 0 (cohorte vacía,
resultado canónico vacío coherente con el shape existente). En shadow: respuesta = OFF,
diferencial registra la remoción esperada.

## M. Contaminación por school compartido

Fixture: g-canon y g-synth comparten string `school="Colegio Real"`. `on` → school
studentCount 5→3 por **filtro de identidad antes de agregar** (no por comparar texto de
school). Reales quedan, sintéticos fuera.

## N. Exclusión de progreso

7.087 filas NO se borran. En agregación por usuario, los ids excluidos se retiran ANTES de
contribuir. Autoridad runtime = `userId ∈ set excluidos` (marcador); el patrón de PK fue
sólo evidencia histórica, no se usa en runtime. Contador `analytics_excluded_progress_rows`
cuenta filas de usuarios excluidos (fixture=3), sin borrar.

## O. Métricas por eventos

0 eventos sintéticos (analytics_db/events.db). No se reescriben métricas behavioral. Test de
regresión: behavioral de reales intacto; el helper no fabrica eventos ausentes.

## P. 0 / no-data

No se colapsa la taxonomía ni se fabrica cero. La forma legacy se preserva; la semántica
`NO_ACTIVITY`/`NO_DATA` de v2 queda como handoff (no se introducen estados nuevos en legacy).

## Q. Modos del flag

`LEGACY_ANALYTICS_COHORT_EXCLUSION = off|shadow|on` (default `off`, valor inválido = error
explícito). OFF: sin construcción de estado, cálculo idéntico (probado 23/23 EXACT_MATCH en
`metricsEquivalenceHarness`). SHADOW: computa old+filtered, devuelve OLD, registra
diferencial. ON: devuelve filtered. Sin activación productiva.

## R. Diferencial sombra

`computeCohortExclusionDifferential({kind,id})` recomputa OFF vs ON sobre los mismos datos y
clasifica cada escalar: `MATCH | EXPECTED_SYNTHETIC_REMOVAL | EXPECTED_LEGACY_GROUP_NORMALIZATION
| UNEXPECTED_REGRESSION` (+ estados de atestación). Sin ids en telemetría. Nunca altera la
respuesta servida.

## S. Seguridad de deltas numéricos

Ratios/porcentajes y únicos se **recomputan** desde la cohorte filtrada (no resta). Tiempos =
conjunto de contribuyentes filtrado. `classifyDifferential` nunca resta valores: recibe ambos
ya recomputados. Tests obligatorios cubren studentCount/active/completionRate/readingTime.

## T. Observabilidad

`analyticsExclusionCounters` + `getAnalyticsExclusionSnapshot()`: excludedUsers,
excludedProgressRows, excludedGroups, legacyGroupRecords, shadowDifferences,
shadowUnexpectedRegressions, `attestationGauge{ok,degraded,drift,invalid}`, mode. Sin labels
userId/groupId/schoolId; sin reason de cardinalidad no acotada.

## U. Fallo seguro

Tests: marker malformado (INVALID), atestación ausente (DEGRADED), drift (DRIFT), OK. OFF
nunca afectado; SHADOW respuesta intacta; ON+DRIFT/INVALID **fail closed** (lanza), nunca
revierte silenciosamente a cálculo contaminado.

## V. Fixture

Hermético en memoria (`server/__test__/analyticsExclusionEngine.test.mjs`): A/B reales
activos, C real disabled histórico, D real sólo-legacy, S1/S2 sintéticos; g-canon / g-legacy
/ g-synth (g-synth comparte school con canónico); progress A/B/C/S1/S2; eventos sólo reales.
Sin PII, sin disco → store-isolation trivial.

## W. Golden

course g-canon 3/2, g-synth 0/0; school Real 5→3, Legacy 1→1; student S1 canónico-vacío;
student C disabled preservado (completed=1 en OFF y ON); snapshot excludedUsers=2,
excludedProgressRows=3. Valores exactos, sin aserciones difusas.

## X. Corpus diferencial

OFF/SHADOW/ON sobre el fixture: OFF==legacy exacto; SHADOW respuesta==OFF; ON difiere sólo en
`EXPECTED_SYNTHETIC_REMOVAL` (course/school sintéticos) y MATCH en canónico/legacy real;
**`UNEXPECTED_REGRESSION=0`** en todos los diferenciales.

## Y. Cardinalidad real

Frozen (no re-derivado de prod, sin copiar datos): technical=647, synthetic-marker=400,
real=247; grupos 4/15/1. Test estructural asserta el clasificador (fixture 2 sintéticos / 4
reales) + invariante 647==400+247. No se consulta/muta DB productiva.

## Z. Rendimiento

Set de excluidos O(1) lookup, construido una vez por `init()` (estado de módulo, patrón
`_generation`; sin singleton global nuevo). Sin lookup a disco por fila. `off` no construye
nada.

## AA. Tests legacy / API

`test:stats-exclusion` (unit 34 + engine 36) añadido a `test:metric-contract`. Legacy
completo GREEN con `off` (referenceEngine, metricsApiV2, metricsShadowBoundary,
legacy-perf incl. **metricsEquivalenceHarness 23/23 EXACT_MATCH**, metricsRequestContext 40,
metricsContextRatchet 19). No se cambian endpoints fuera de alcance; el único cambio de ruta
(schools list) es no-op en off.

## AB. Regresión frontend

`FRONTEND_RUNTIME_DELTA=0`: sin cambio de fuente frontend; build de producción GREEN. No hubo
cambio de shape de respuesta.

## AC. Frontera de abandonment

`CHP-STATS-ABANDONMENT-TEMPORAL-01` NO se toca. El filtro actúa en cohorte, no en el umbral
`Date.now`-30d de `computeContentStats`. Sin expansión de alcance.

## AD. Frontera eventos/materializer

Sin cambios a events.db/schema de eventos/ingesta/materializer/insights.db. Handoff: la
materialización futura debe reproducir la exclusión de forma determinista desde la identidad
canónica (marcador/atestación). El schema de marcador de eventos lo decide
**CHP-STATS-EVENT-CONTRACT-01**, no esta unidad.

## AE. Store isolation

`PRODUCTION_STORE_WRITES_FROM_TESTS=0` — verificado (`verify-test-store-isolation
test:stats-exclusion`: 0 creados/modificados/eliminados, 367 stores intactos). Ningún test
escribe data/, data-critical/, events.db, insights.db, identity.db, sessions.db ni progress.

## AF. Full suites

stats-exclusion 34+36, metric-contract completo GREEN (EXIT=0), request-context-telemetry
87, store-isolation PASS, GAP1 retire 53, organizationScope 36, typecheck sin regresiones,
build GREEN, evidence 736 archivos/0 violaciones. Sin regresión M1 (no se tocó código M1).

## AG. CI

Push de la rama; gates aplicables. `identity-preflight` se dispara por `server/**` +
`package.json`; su paso de métricas ejecuta `test:metric-contract` (incl. stats-exclusion) +
store-isolation. Baseline heredado (gitleaks-history/trivy-image) separado; sin excepción
nueva.

## AH. Etapas de despliegue (congeladas, sin ejecutar)

S0 código default off → S1 shadow api_2 → S2 shadow ambas → S3 recolectar corpus diferencial
→ S4 on superficie acotada/api_2 → S5 on ambas → S6 closeout. No solapar con mutaciones de
identidad M1 sin decisión de release separada. PREP offline.

## AI. Rollback

`on → shadow → off`. Nunca borra usuarios sintéticos, progreso ni muta identidad/grupos/eventos.

## AJ. M2 readiness

`SYNTHETIC_EXCLUSION_IMPLEMENTATION_READY=true`; **NO** `SYNTHETIC_EXCLUSION_PRODUCTION_CLOSED`.
Fase 2 recibe progreso de implementación, no cierre productivo. No se infla el % de M2.

## AK. Groups-canary non-interference

Sólo `docker inspect --format`: api_1 `cf36852` json / api_2 `cf36852` sqlite+groups, healthy,
restarts=0 → `GROUP_CANARY_STATE=RUNNING`.

## AL. Documentación / commit

Este doc + código en `chp/stats-synthetic-cohort-exclusion-01`. `lint:evidence` GREEN. Sin
productive ref, sin backup/restic, sin prune, sin force-push.

## AN. Exact next step

CI exact-tree GREEN de la rama; luego **decisión de release** para la secuencia S0→S6 (no en
esta unidad), sin solapar con mutaciones de identidad M1. Deuda paralela:
`CHP-STATS-ABANDONMENT-TEMPORAL-01`.
