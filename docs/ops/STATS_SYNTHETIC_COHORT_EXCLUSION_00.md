# STATS_SYNTHETIC_COHORT_EXCLUSION_00 — Contaminación sintética/compat de métricas legacy

Unidad: **CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-00** (2026-08-15).
DESIGN + IMPLEMENTATION-PLAN ONLY. Cero cambio de producción, cero mutación de
datos, cero apertura de `insights.db`/`events.db`, GROUPS canary intacto. Rama de
auditoría `chp/stats-synthetic-cohort-exclusion-00` desde el **source productivo
`cf36852`** (no desde el ensayo M1).

## A. Veredicto

**🟢 GREEN — SYNTHETIC/COMPAT ANALYTICS CONTAMINATION MAPPED AND EXCLUSION
IMPLEMENTATION UNIT READY.** El clasificador sintético es determinista y sin
heurística; la cohorte de 400 y las 7.087 filas son atribuibles por doble
atestación; `LEGACY_COMPAT ≠ SYNTHETIC` es explícito en el código; ningún filtro
propuesto borra historia real; los denominadores están inventariados; la
arquitectura de exclusión central está definida; fixtures/golden definidos;
handoff a V2/materializer definido; deploy/rollback conocidos. `SYNTHETIC_EXCLUSION_DESIGN_READY=true`.

## B. Groups-canary freeze

Producción sin tocar. Runtime `cf36852`; api_1 `IDENTITY_READ=json`, api_2
`IDENTITY_READ=sqlite`+`IDENTITY_READ_DOMAINS=groups`. `GROUP_CANARY_STATE=RUNNING`
verificado al cierre solo por `docker inspect --format` (§AG). Cero `/api/groups`
probe.

## C. Metrics surfaces (inventario exacto)

**Existen DOS stacks de métricas con semántica de población OPUESTA.**

### LEGACY_ENGINE — `server/metricsService.js` (sirve producción, `METRICS_ENGINE=legacy`)
- `computeStudentMetrics(userId)` (L797) — behavioral, readingLevels, ICDLI, leoMetrics, **contentStats** (`computeContentStats` L691), dataWindow.
- `computeCourseMetrics(courseId)` (L823) — `studentCount`, `activeStudentCount`, promedios, distribuciones, breakdown.
- `computeSchoolMetrics(schoolId)` (L867) — `courseCount`, `studentCount`, `activeStudentCount`, courseBreakdown; población = unión de miembros de grupos cuyo `group.school` casa (case-insensitive).
- **NO hay filtro `_loadtest_marker`/`accountStatus`/`disabled`/`migration_exclusions` en ninguna función** (verificado línea a línea).

### API (rutas HTTP, `server/server.js`) — todas legacy vía `mountLegacyMetricsRoute` (L7870, `canonicalExecutor:null`, `metricsEngineMode()` default `legacy`)
`GET /api/metrics/schools` (L7914) · `/api/metrics/student/:userId` (L7945) ·
`/api/metrics/course/:courseId` (L8069) · `/api/metrics/school/:schoolId` (L8106, admin) ·
`/api/metrics/backbone` (L8120) · `/api/metrics/funnels` (L8179) · `/api/metrics/insights`
(L8223, **insights.db — FUERA DE ALCANCE**) · snapshot/states/ack (insights.db, fuera) ·
`/api/reports/course/:courseId` (L8452) · `/api/reports/school/:schoolId` (L8495, admin) ·
`/api/students/:id/status` (L6097) · `/api/groups/:id/diagnosis` (L6044) ·
`/api/admin/membership/validate` (L5771).

### V2 (canónico read-only, aditivo) — `engines/metrics/referenceEngine.mjs` + `/api/v2/metrics/*`
**Ya excluye sintéticos** por `_loadtest_marker` en el borde de cohorte
(`organizationPopulation` L179) y en atribución de eventos (`SYNTHETIC_SCOPE` L223-225).
NO filtra `disabled`. Es la implementación de referencia a espejar.

### SERVICE/HELPER/BACKBONE
`groupMembershipService.getGroupMembers` (denominador legacy), `backboneMetrics.js`/
`backboneFunnels.js`/`backboneInsights.js` (sobre `events.db`), `eventsService.js`,
`interventionAnalyticsService.js`, Aula Viva routers (insights.db), `organizationScope.mjs`
(clasificador de grupos inyectado a V2), `groupDiagnosis.mjs`, `studentStatus.mjs`.

### FRONTEND_ONLY
`pages/AdminDashboard.tsx` (`allGroups.length`, memberCount por grupo),
`pages/DashboardAdminLectura.tsx`, `pages/AdminDashboardLectura`, merge helpers.

## D. Data sources

| Métrica/stack | Fuente | Key | Join | Filtros | Denominador |
|---|---|---|---|---|---|
| Legacy student/course/school | `usuarios_colegios_oro.json` (users, **tiene `_loadtest_marker`**), `groups_db.json`, SQLite progress (`getAllProgressAsMap`, **7.087 sint.**), `analytics_db.json` (events, **0 sint.**), leo json | `userId`, `group.id`, `group.school` | membership vía `getGroupMembers` | **ninguno** | miembros de grupo (NO 647) |
| Legacy backbone/funnels | `events.db` (readonly) | `userId`/mode | — | ninguno (pero 0 sint. en events) | activeUsers de eventos |
| V2 reference | mismos JSON + `events.db` | idem | classifyGroup inyectado | **`_loadtest_marker`** | registered/eligibleReaders |

No se abrió `insights.db` ni `events.db`. Auditoría sobre código/JSON-schema.

## E. Synthetic USER authority

**`SYNTHETIC_USER_CLASSIFIER_SOURCE = doble atestación`** (sin heurística de email/nombre/rango):
1. **Marcador de padrón** `user._loadtest_marker` — `isSyntheticUser(user)` (`server/identity/organizationScope.mjs:62`). **Presente en el JSON que el motor legacy ya carga** → disponible con `METRICS_ENGINE=legacy`, sin depender de SQLite.
2. **Tabla atestada** `migration_exclusions(entity='user', disposition='SYNTHETIC_LOADTEST_QUARANTINED')` clave `h16(id)` (SHA-256 primeros 16 hex, **sin PII**) — `classifyUserReadDomain` (`server/db/identityUserDomains.js:68-112`); schema `server/db/migrations/0002_identity_v2.sql:213-226`. Autoridad versionada/auditable, requiere `identity.db`.

La cohorte de 400 = `{ id : (_loadtest_marker) ∧ (h16(id) ∈ atestadas) }` con **igualdad estricta de conjuntos o STOP** (`scripts/identity/retireSyntheticCohort.mjs:72-97 selectCohort`). `REAL_USERS_SELECTED=0` es estructural. Un usuario sin marcador **jamás** entra.

## F. Synthetic GROUP authority

`migration_exclusions(entity='group')` (`server/db/identityGroupDomains.js:45-94`):
- **1 sintético** = disposition `SYNTHETIC_LOADTEST_EXCLUDED` (`lt-test-group-v2`/`GRP_0a98e5b5`).
- **15 legacy-compat** = disposition `LEGACY_TEST_GROUP_PENDING_RETIREMENT`.
- **4 canónicos** = fila viva en `groups` con `institution_id` registrado en `institutions` (existir en SQLite NO basta).

Clasificador runtime paralelo `organizationScope.classifyGroup` → `ACTIVE_REAL` /
`SYNTHETIC_OUT_OF_SCOPE` (todos los miembros con marcador) / `HISTORICAL_OUT_OF_SCOPE`.
**`LEGACY_COMPAT` y `SYNTHETIC` son dispositions distintas — nunca se equiparan.**

## G. 7087 attribution

`SYNTHETIC_PROGRESS_ROWS = 7.087` (histórico verificado GAP1-01B, congelado desde
2026-04-19; `progress` global = 7.215, real = 128/36 usuarios). **ATTRIBUTION_METHOD:**
una fila es sintética sólo si su **clave primaria embebe el id sintético**
(`lt-user-#__content-#`) **Y** cae en la ventana de la corrida — no basta «tiene
progreso» (una prueba de carga PRODUCE progreso). 7.087 cumplen ambas, 0 fuera.
Equivalente por identidad: una fila de progreso es sintética sii su `userId` es un
usuario sintético (marcador). No se leyó `progress.db` en esta unidad; cifra tomada
de la evidencia de migración atestada.

## H. Contamination matrix

| Métrica | Numerador sint. | Denominador sint. | Contam. grupo legacy | Severidad |
|---|---|---|---|---|
| `/api/metrics/student/:syntheticId` → contentStats | **SÍ** (7.087 filas) | n/a | no | **ALTA** (entidad sintética consultada directo) |
| `/api/metrics/course/lt-test-group-v2` | SÍ | **SÍ** (400 miembros) | no | **ALTA** |
| `/api/metrics/school/:realSchool` (student/activeStudentCount) | sólo si grupo sint./legacy comparte string `school` | sólo por unión de grupo | **posible** (legacy con `school`) | MEDIA |
| `/api/metrics/schools` (lista) | — | — | grupos sint./legacy con `school` aparecen como pseudo-escuela | MEDIA |
| `/api/metrics/course/:realGroup` | NO (sint. no están en grupos reales, groupIds=[]) | NO | no | BAJA/NULA |
| behavioral/sessions/readingTime (student/course/school) | **NO** (0 eventos sint. en analytics_db) | — | — | NULA por eventos |
| `/api/metrics/backbone|funnels` (events.db) | NO (0 eventos sint.) | — | — | NULA |
| `/api/students/:syntheticId/status` (booksStarted/Completed) | **SÍ** (progress SQLite) | — | — | ALTA (directo) |
| Frontend `allGroups.length` (=20), memberCount (=400) | — | — | **SÍ** (1 sint.+15 legacy) | MEDIA (vía `/api/groups`, no metricsService) |

**Corrección clave:** el motor legacy **no** usa un denominador plano de 647; sus
denominadores son membresía de grupo. La contaminación real se concentra en (1)
consultar una entidad sintética directamente y (2) el string `school` compartido, no
en un «647» global. Los eventos (sessions/tiempo/completion behavioral) están limpios
porque `analytics_db.json`/`events.db` tienen 0 filas sintéticas.

## I. Legacy-group semantics (NO es AMBER)

Los 15 grupos legacy son grupos históricos con miembros potencialmente **reales**
(`applyLegacyColegioFallback` atribuye lectores reales por `user.colegio` cuando la
escuela tiene 1 grupo; `getExplicitGroupMembers` por `studentIds/memberIds/groupIds`).
**Borrar toda actividad asociada a un grupo legacy suprimiría historia humana real.**
Distinción obligatoria:
- **Excluir el grupo legacy como DIMENSIÓN analítica** (no es institución canónica) — correcto.
- **Excluir la actividad humana de usuarios reales** — prohibido.

Resolución determinista (ya implementada en V2): usuario real sólo en grupo legacy →
su actividad se conserva a nivel de usuario/sistema y cae en `UNATTRIBUTED_GROUP`, no
se borra. Por eso **no hay ambigüedad que exija decisión humana** para excluir la
cohorte sintética. Decisión de producto OPCIONAL y no bloqueante: promover algún grupo
legacy a canónico (si resultara ser un grupo real mal etiquetado) — no requerido por
esta unidad.

## J. User-first exclusion

Modelo preferido y **soportado por los datos**: cohorte analítica canónica =
`REAL_CANONICAL_USERS` = usuarios − excluidos-por-identidad (marcador). La exclusión
ocurre PRIMERO por identidad de usuario; la agrupación resuelve luego a membresías
canónicas. No se descarta actividad real por existir un identificador de grupo antiguo
si hay atribución canónica posible. Los sintéticos tienen `groupIds=[]` y sólo
pertenecen al grupo sintético → user-first los quita limpio sin tocar grupos reales.

## K. Denominators (auditoría)

| Métrica | CURRENT_DENOMINATOR | EXPECTED_CANONICAL | FILTER_REQUIRED |
|---|---|---|---|
| course `studentCount` | unión `getGroupMembers(group)` (incl. sint. si es el grupo sint.) | miembros reales del grupo | excluir marcador en `resolveGroupMemberIds` |
| school `studentCount` | unión de grupos con `school` match (incl. legacy/sint. si comparten string) | lectores reales atribuibles a la institución canónica | excluir marcador + limitar a grupos canónicos/reales de la org |
| `activeStudentCount` | `totalSessions>0` sobre el conjunto anterior | ídem sobre cohorte real | heredado del filtro de cohorte |
| `/api/metrics/schools` | dedup de `group.school` (incl. sint./legacy) | instituciones canónicas registradas | excluir grupos sint.; decidir legacy como dimensión |
| V2 `registeredUsers/eligibleReaders` | ya excluye marcador | — | ninguno (ya correcto) |
| identidad `/api/users` (no-métrica) | 647 | fuera de esta unidad | — |

Elegibilidad por métrica: institución → sólo usuarios elegibles de la institución
canónica; grupo → miembros reales del grupo; adopción de sistema → usuarios canónicos
elegibles. **No se asume 247 ni 647 universalmente.**

## L. Disabled vs synthetic

`disabled ≠ synthetic`. El único clasificador válido es el **marcador/atestación**, no
`accountStatus='disabled'`. Un lector real puede quedar `disabled` más tarde
conservando historia legítima. Nunca implementar «excluir todos los disabled». (Nota:
los 400 sintéticos están además `disabled` desde GAP1-01-DEPLOY, pero la exclusión
analítica se ancla al marcador, no al status — así un real disabled no se borra y un
sintético reactivado seguiría excluido.)

## M. Temporal semantics

Elegibilidad de cohorte:
- **Sintéticos de carga: SIEMPRE excluidos** (estado actual, sin fecha efectiva) — el marcador es inmutable.
- **Reales: el `disabled` actual NO borra actividad histórica** — la historia se mide por evidencia, no por estado presente.
- **Grupos: transición canónico/legacy** — atribución por membresía canónica vigente; el histórico real sin grupo canónico cae en `UNATTRIBUTED`, no se pierde.
Contrato M2 más simple correcto: exclusión de identidad por marcador (atemporal) +
atribución de grupo por membresía canónica. **No construir historia temporal de
membresía** salvo que los datos lo exijan (no lo exigen hoy).

## N. 0 / no-data semantics (doctrina preservada)

`0 ≠ NO_DATA ≠ NO_ACTIVITY ≠ DATA_INCOMPLETE ≠ NOT_DEFINED`. Estados del contrato v2
(`engines/metrics/eventContract.mjs`): `MEASURED` · `NO_ACTIVITY` (0 legítimo) ·
`NO_DATA` (null) · `NOT_MATERIALIZED` · `UNATTRIBUTED` · `NOT_DEFINED` · `ERROR`.
Tras excluir, si una cohorte elegible queda vacía **no se devuelve 0 numérico
automáticamente**: población conocida con 0 actividad → `NO_ACTIVITY` (0); población
inexistente → `NO_DATA` (null). El motor legacy hoy NO tiene estos estados (devuelve
0 crudo); el diseño-01 debe **preservar la forma legacy** para las rutas legacy y sólo
corregir la COHORTE, dejando la semántica de estados como handoff a la migración v2
(no fabricar estados nuevos en el motor legacy dentro de -01).

## O. Abandonment debt boundary (FASE 13, registrado APARTE)

`computeContentStats` (`metricsService.js:713`) marca `abandoned` con
`Date.now()-lastReadAt > 30d ∧ pct<50`; existe un brazo pareado en
`server.js computeReadingProgress` (comentario L689 «kept in sync manually»). La deuda
temporal `Date.now`/cruce-de-día y la igualdad de brazos pareados **NO se corrige en
esta unidad**: la exclusión sintética actúa en el borde de cohorte y **no toca** el
umbral de días. Se registra como deuda separada (**CHP-STATS-ABANDONMENT-TEMPORAL-01**,
ya conocida). Sin expansión de alcance.

## P. API impact

| Ruta | Métrica | Dirección esperada | Clientes |
|---|---|---|---|
| `/api/metrics/course/lt-test-group-v2` | studentCount 400→0 (o 404 si se oculta el grupo sint.) | ↓ | admin |
| `/api/metrics/student/:syntheticId` | contentStats poblado→vacío/404 | ↓ | admin |
| `/api/students/:syntheticId/status` | books→0/404 | ↓ | admin/mediador |
| `/api/metrics/schools` | lista pierde pseudo-escuelas sint. | ↓ nº escuelas | admin dashboards |
| `/api/metrics/school/:realSchool` | studentCount baja sólo si compartía grupo sint./legacy | ↓ o = | admin/mediador |
| `/api/reports/{course,school}` | heredan lo anterior | ↓/= | reports |
| `/api/metrics/backbone|funnels` | **sin cambio** (0 eventos sint.) | = | admin |
Reales sin grupo sintético: **sin cambio numérico**. Ninguna respuesta cambia en -00.

## Q. Frontend impact

`AdminDashboard.tsx:405` «Grupos totales» = `allGroups.length` (=20 → 4 canónicos si se
depura la dimensión) y memberCount por grupo (sint. 400). Estos valores vienen de
`/api/groups` (dominio identity, canary), no de metricsService — su saneo pertenece a
la frontera de grupos (GAP3/M1), no a -01, salvo que -01 exponga un conteo canónico de
grupos. `DashboardAdminLectura.tsx` consume school metrics (studentCount) → hereda el
saneo del backend. Sin implementación de frontend en -00.

## R. Exclusion helper (arquitectura central)

Un único módulo puro reusable — `server/metrics/analyticsExclusion.mjs` (nuevo, en -01):
```
isAnalyticsExcludedUser(user)            // !!user._loadtest_marker
getAnalyticsExcludedUserIds(users, {attested?})  // Set<id>; si attested→ igualdad estricta o fail-closed
isAnalyticsExcludedGroup(groupId, {attestedGroupSet}) // grupo sintético
filterCanonicalMemberIds(ids, excludedSet)      // borde de cohorte
```
Prohibido dispersar `if disabled` / `if email includes load` / `if group name matches
test` por las funciones de métrica. Determinista, marcador-primero, atestación como
guard.

## S. Registry source (elección)

**Fuente primaria = campo `_loadtest_marker` del padrón** (determinista, versionado con
el propio padrón, sin PII/heurística, **disponible con `METRICS_ENGINE=legacy` sin
cutover de SQLite**). **Guard de atestación = `migration_exclusions`** (identity.db):
cuando `identity.db` esté disponible, al construir la cohorte se valida
`markerSet == attestedSet` (igualdad estricta) → **fail-closed si hay drift**. Si
`identity.db` no está montada (entorno legacy-only), se usa marcador-solo con estado
`ATTESTATION_DEGRADED` logueado. Así se obtiene determinismo + auditabilidad sin acoplar
las métricas legacy a la lectura SQLite.

## T. Legacy integration seams

Filtrar en el **borde de selección de cohorte, ANTES de agregar** (espejo de
`referenceEngine.mjs:179`):
- `metricsService.resolveGroupMemberIds` (L608) → filtrar ids excluidos.
- `computeSchoolMetrics` (L870) → excluir grupos sintéticos de la unión y limitar a
  grupos reales/canónicos de la institución.
- `legacyMetricsSchoolsHandler` (server.js L7885) → excluir `group.school` de grupos sintéticos.
- `computeContentStats` recibe sólo ids ya filtrados (no cambia su lógica interna).
**Prohibido** el patrón «agregar contaminado y luego restar» (falla en ratios, conteos
únicos, ventanas de tiempo y semántica de grupo).

## U. V2 / materializer handoff

V2 `referenceEngine` YA excluye por marcador → -01 alinea legacy con V2. Invariante
futuro (handoff **CHP-STATS-EVENT-CONTRACT-01** + **CHP-STATS-MAT-\***): cualquier
materialización canónica (insights.db) debe entender la misma cohorte excluida, o los
eventos sintéticos deben identificarse/excluirse por el mismo marcador/atestación. Hoy
`events.db` tiene 0 eventos sintéticos, pero una futura campaña de carga DEBE emitir el
marcador y aislar sus eventos. No crear una semántica legacy que V2 no pueda reproducir
(la elección marcador-primero + guard atestado es reproducible por V2). No se construye
materializer aquí.

## V. Test fixture (hermético, diseño para -01)

`server/__test__/fixtures/analyticsExclusion/` — sin PII, sin red, sin stores reales:
- Usuario real activo **A** (institución inst-1, grupo canónico, con eventos+progress).
- Usuario real activo **B** (inst-1, grupo canónico, con eventos+progress).
- Usuario real **disabled histórico C** (`accountStatus='disabled'`, con progress e historia — DEBE conservarse).
- Sintéticos **S1/S2** (`_loadtest_marker='__loadtest__'`, en grupo sintético, con progress; atestación `SYNTHETIC_LOADTEST_QUARANTINED`).
- Grupo canónico `g-canon` (inst-1, A+B), grupo legacy real `g-legacy` (`LEGACY_TEST_GROUP_PENDING_RETIREMENT`, con un real sólo-legacy **D**), grupo sintético `g-synth` (`SYNTHETIC_LOADTEST_EXCLUDED`, S1+S2).
- Progress para todas las clases; eventos sólo para reales (paridad con producción: 0 eventos sintéticos).
Esperado: A/B incluidos donde elegibles; C preservado según contrato de periodo; S1/S2
excluidos SIEMPRE; g-synth excluido; g-legacy acotado como dimensión (D real →
`UNATTRIBUTED`, no borrado); actividad real nunca borrada por metadata legacy.

## W. Golden cases (valores exactos, para -01)

Sobre el fixture V (denominadores exactos):
1. system user denominator (canónico) = |reales| (A,B,C,D) — sintéticos fuera.
2. institution inst-1 eligibleReaders = 2 (A,B); C disabled → según periodo; D sin grupo canónico → no elegible pero no borrado.
3. group `g-canon` studentCount = 2; `g-synth` studentCount = 0 (o 404); `g-legacy` como dimensión no canónica.
4. activeReaders inst-1 = |{A,B} con READING_ACTIVITY|.
5. completion/abandonment/readingTime: sólo reales; sintéticos no contribuyen.
6. zero activity: institución real con población y 0 actividad → `NO_ACTIVITY` (0), no `NO_DATA`.
7. no data: institución sin población → `NO_DATA` (null), nunca 0.
8. legacy group: actividad de D preservada como `UNATTRIBUTED_GROUP`.
9. synthetic group: 0 en toda métrica canónica.
10. dataset mixto real/sintético: cifras == subconjunto real puro (diferencial = sólo remoción sintética).
Diferencial legacy_current vs legacy_filtered en el fixture: sólo remoción sintética +
normalización de dimensión legacy; 0 regresión sobre reales.

## X. Real baseline

Cardinalidades de identidad (evidencia atestada, sin inventar valores de métrica):
`TECHNICAL_TOTAL=647`, `SYNTHETIC_EXCLUDED=400`, `REAL_CANONICAL=247`
(1 admin / 23 mediadores / 223 lectores). Grupos: 4 canónicos / 15 legacy / 1 sintético.
Progress: 7.087 sintéticas / 128 reales (36 usuarios). Denominador POR MÉTRICA difiere
(institución/grupo/sistema) — documentado en §K; no se publican valores de métrica
productiva calculados aquí.

## Y. Differential plan

Futuro -01: comparar `LEGACY_CURRENT` vs `LEGACY_FILTERED` sobre el mismo fixture/corpus;
clasificar cada diferencia en `EXPECTED_SYNTHETIC_REMOVAL` / `EXPECTED_LEGACY_GROUP_NORMALIZATION`
/ `UNEXPECTED_REGRESSION`. Cualquier `UNEXPECTED_REGRESSION` = STOP. Modo `shadow` del flag
computa ambas y registra el diferencial sin cambiar la respuesta servida.

## Z. Performance

Construir el `Set` de ids excluidos **una vez** por `init()` (junto al estado de módulo,
patrón `_generation`), O(1) lookup por id; sin lookup a disco por registro. Ciclo de vida
= por proceso, reconstruido en cada `init()` (consistente con el request-context legacy).
Sin singleton global nuevo más allá del estado de módulo ya existente.

## AA. Observability

Contadores acotados (patrón `metricsContextCounters`, sin labels de alta cardinalidad):
`analytics_excluded_users_total`, `analytics_excluded_progress_rows_total`,
`analytics_excluded_groups_total`, `analytics_legacy_group_records_total`,
`analytics_attestation_state{ok|degraded|drift}`. Hacen visible la exclusión. Sin deploy.

## AB. Failure semantics

Analítica canónica **fail-closed**: si la autoridad de exclusión no puede resolverse
cuando se requiere (atestación exigida y `identity.db` ilegible, o drift marcador≠atestado),
**no servir números potencialmente contaminados** → estado `ERROR`/degradado explícito,
nunca 0 ni cifra contaminada silenciosa. En entorno legacy-only sin identity.db: marcador-solo
con `ATTESTATION_DEGRADED` logueado (no es fallo, es modo declarado). No se altera la
producción legacy hoy.

## AC. Implementation unit — CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01

Alcance EXACTO (sólo lo necesario):
- Módulo central `server/metrics/analyticsExclusion.mjs` (marcador-primero + guard atestado).
- Filtrar la métrica legacy en el **borde de cohorte** (§T seams).
- Acotar semántica de grupo legacy (dimensión no canónica; preservar reales).
- Preservar actividad histórica real; corregir denominadores (§K).
- Flag `LEGACY_ANALYTICS_COHORT_EXCLUSION=off|shadow|on` (default `off`=byte-idéntico).
- Tests (fixture §V + golden §W + diferencial §Y) y observabilidad (§AA).
- Documentar deltas numéricos.
NO incluye: event contract, reparación de instrumentación, materializer, Aula Viva,
cambios en insights.db, corrección de abandonment temporal (§O).

## AD. Deploy strategy

Rollout escalonado, **flag dedicado justificado** (el `metricsEngineMode` legacy/canonical
NO cubre este cambio, que es interno al motor legacy; el flag da rollback numérico instantáneo):
A. dormant (`off`, byte-idéntico) → B. `shadow` (computa filtered en paralelo, no cambia
respuesta, registra diferencial) → C. comparar current vs filtered (diferencial esperado) →
D. `on` en superficie acotada → E. `on` global → F. closeout. Sin ejecución en -00.

## AE. Rollback

Rollback = poner el flag en `off` (o `shadow`) → restaura el cálculo legacy previo, **sin
borrar historia sintética, sin mutar identidad**. Reversible al instante, byte-idéntico en `off`.

## AF. M2 readiness

`SYNTHETIC_EXCLUSION_DESIGN_READY=true`. Impacto en Fase 2: prepara el corte de
contaminación que M2 (eventos/materialización) hereda vía el invariante §U; **no** avanza
funcionalmente la Fase 2 (esto es preparación). El motor de referencia v2 ya es cohorte-limpio;
-01 alinea el legacy y congela el contrato de exclusión que el materializer debe reproducir.

## AG. Groups-canary non-interference

Al cierre, sólo `docker inspect --format` (sin `/api/groups`): api_1 `cf36852` json /
api_2 `cf36852` sqlite+groups, healthy, restarts=0 → `GROUP_CANARY_STATE=RUNNING`.

## AH. Documentation / commit

Este doc en rama `chp/stats-synthetic-cohort-exclusion-00` (desde `cf36852`). Sin ref
productiva. `lint:evidence` GREEN. Sin backup/restic, sin prune, sin force-push.

## AI. Exact next step

**CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01** (implementación del módulo central + seams +
flag + tests + observabilidad, offline, sin deploy), tras — y sin bloquear — la secuencia
de identidad en curso (GROUPS-canary-close → M1-A-deploy → M1-B-deploy). Deuda paralela
registrada: **CHP-STATS-ABANDONMENT-TEMPORAL-01** (§O).
