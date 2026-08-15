# M1_B_TENANT_AUTHZ_01_PREP — aislamiento tenant + gobernanza de membership (implementación)

Unidad: **CHP-IDDB-M1-B-TENANT-AUTHZ-01-PREP** (2026-08-15). Implementación
OFFLINE completa y probada; **sin desplegar**, **sin enforcement en producción**.
Base: `M1_A_PREP_BASE=f1c002b` (tip de `chp/m1-a-session-identity-01`, contiene
`0c84ecd`). Rama: `chp/m1-b-tenant-authz-01`. Canary GROUPS intacto.

## Modo (default vinculante)

`TENANT_AUTHZ_MODE`: **off** (default) | **shadow** | **enforce**.
- **off**: comportamiento actual **byte-idéntico** (guards y filtros son no-op).
- **shadow**: computa la decisión y emite telemetría/audit `TENANT_AUTHZ_SHADOW_DENY`,
  **NO** bloquea ni cambia la respuesta (probado: shadow == off en respuesta).
- **enforce**: aplica scoping real (deny 403/404 + filtrado server-side de listas).
No se activa enforce en este PREP.

## Autoridad de tenant

Unidad = **institución**, resuelta server-side por `resolveUserInstitutionScope`
desde memberships (grupos JSON físico: `memberIds`/`studentIds`/`mediatorIds` →
`group.organizationId` registrado) con `organizationId` del usuario como autoridad
secundaria. Prioridad membership → org; conflicto o multi-institución ⇒
**AMBIGUOUS (fail-closed)**; sin membership ni org ⇒ **UNSCOPED (fail-closed)**.
Nunca confía en x-user-id / body / query / cookie-role / cookie-tenant como
autoridad; consume `req.auth.userId` de M1-A (en transición previa a M1-A enforce,
`req.user.id`/x-user-id que server.js ya resolvió). Los IDs de la request son
**input** a autorizar.

## Módulo `server/lib/tenantAuthz.js` (puro)

Resolver + `buildActorContext` + helpers explícitos (sin framework RBAC):
`requireGlobalAdmin`, `requireSameInstitution`, `requireGroupScope`,
`requireSelfOrScopedMediator`, `requireMembershipManagementScope`, y `scopeList`.
Cada helper devuelve `{decision, reason, resourceClass}` y falla cerrado ante
UNSCOPED/AMBIGUOUS donde el tenant es requerido.

## Integración en server.js (off = no-op)

- `tenantGuard(policy, {notFoundReasons})`: middleware por-modo. off/shadow → next;
  enforce deny → 404 (razones anti-enumeración) o 403.
- `scopeUsersForActor` / `scopeGroupsForActor`: filtran **server-side** el listado;
  en off/shadow la respuesta NO cambia, en enforce devuelven la vista del actor.
- `membershipMutationGuard`: en off/shadow delega a `requireAdminAccess` (admin-only
  actual); en enforce concede a admin global **o** mediador con scope del grupo
  (misma institución, jamás otorga rol mediador/administrador).
- Rutas cableadas: `GET /api/users` (filtro), `GET /api/groups` (filtro),
  `/api/groups/:id/members|candidates|diagnosis`, `/api/students/:id/status`,
  `/api/progress/user|item/*` (cierra rutas antes sin middleware — solo en
  enforce), `/api/leo/mediator/student/*`, `/api/aula-viva/students/*` (guard
  inyectado, lazy por TDZ del top-level await), membership: `POST/DELETE members`,
  `members/move`, `members/materialize-fallback`. CRUD de usuario
  (`PUT/DELETE /api/users/:id`) permanece **admin-global** por diseño.

## Contratos por rol

- **Global admin**: rol `administrador` server-side o `admin-secret` (máquina).
  Excepción explícita por ruta; nunca bypass implícito.
- **Mediador**: solo sus grupos (rol `mediator`), su institución; lee perfiles/
  progreso/Aula Viva/Leo de sus miembros; gestiona membership en sus grupos;
  **no** otorga admin ni mediador, **no** cruza institución.
- **Lector**: self + sus memberships + su progreso + contenido autorizado; sin
  listado global; sin writes de membership.
- **UNSCOPED / AMBIGUOUS**: fail-closed en rutas tenant; login/self/contenido
  abierto preservados.

## Separaciones

- **Contenido**: M1-B NO toca `accessService`/`LEGACY_OPEN` (planos distintos:
  autorización de identidad ≠ licencia de contenido).
- **GAP3 compat**: la frontera canónico/compat de groups no se altera; el scoping
  se aplica sobre la vista compuesta sin cambiar su autoridad.

## Telemetría y audit (bounded, sin PII)

Counters `tenant_authz_decision_total{mode,resource_class,decision,reason}` y
`membership_governance_decision_total{action,decision,reason}` (nunca userId/
groupId/institutionId como label). Eventos de audit (ULID/timestamp server-owned):
`TENANT_AUTHZ_SHADOW_DENY`, `TENANT_AUTHZ_DENIED`, y las decisiones de gobernanza.

## Semántica de error

404 cuando revelar existencia filtra pertenencia (users/groups/students/progress
cross-tenant); 403 cuando el actor conoce el recurso pero le falta capacidad
(gobernanza de membership fuera de scope); 401 solo por fallo de autenticación.

## Frontend

El backend filtra server-side, así que el frontend recibe listas ya acotadas sin
cambio de **seguridad**. La adaptación **UX** (estados vacíos para mediadores) es
opcional y diferida; nunca se confía en la UI para seguridad.

## Evidencia de tests (GREEN)

- **35** unit (`tenantAuthz.test.mjs`): resolver A/B/C/D/E (E=0), helpers,
  escalation, `scopeList`.
- **36** golden integración (`tenantAuthzIntegration.test.mjs`, server real A/B):
  off intacto, shadow == off, enforce aísla por institución (listas filtradas,
  GET cross → 404, self/scoped allow), escalation de membership 403, admin
  override explícito, fail-closed unscoped/ambiguous, agregado
  `CROSS_TENANT_READ_ALLOWED=0`.
- **6** puente M1-A⨯M1-B (`tenantAuthzM1aIntegration.test.mjs`, POSIX): sesión
  firmada → scope; sesión + x-user-id divergente → **401 de M1-A antes de M1-B**;
  claim de request no da autoridad.
- **6** route-coverage guard (`tenantRouteCoverage.test.mjs`): ninguna ruta
  sensible sin política; falla si aparece una nueva sin scoping.
- No-regresión **off**: memberships 51, Aula Viva 31, sesión M1-A 42+34, typecheck
  y build GREEN, `lint:evidence` 0 violaciones. Validado además en imagen `cf36852`
  en Linux aislado (`--network none`, /tmp) — sin tocar producción.
- Nota de plataforma: los handlers de `/students/:id/status` y `/api/progress/*`
  devuelven 500 en la fixture hermética sin SQLite de progreso en Linux; es
  ortogonal a la capa tenant (que decide allow/deny), por eso las ALLOW se afirman
  como «no denegado por tenant» y las DENY como 404 (el guard dispara antes del
  handler).

## Deploy plan (tras M1-A enforce, no ejecutar)

B0 código + policies **dormant** (`TENANT_AUTHZ_MODE=off`) → B1 **shadow api_2** →
B2 shadow ambas + observación (`tenant_authz_decision_total` detecta consumidores
legítimos que romperían) → B3 GET/list enforce api_2 → B4 GET/list enforce ambas →
B5 membership writes enforce → B6 resto de rutas tenant enforce → B7 closeout golden
matrix. El **shadow es útil**: revela falsos-deny antes de bloquear.

## Rollback

`enforce → shadow` (semántico preferido) → `shadow → off`. Cualquier rollback que
reabra lecturas cross-tenant confirmadas exige `--acknowledge-security-risk`. **El
enforcement de sesión de M1-A NUNCA se revierte como parte del rollback de M1-B.**

## M1_B_DEPLOY_ALLOWED

**true**, condicionado a **M1-A en enforce** primero (M1-B consume `req.auth`).
Sin migración de datos requerida (E=0; D/externado por deny-closed seguro).

## Cierra

TENANT_ISOLATION RED→GREEN, MEMBERSHIP_GOVERNANCE YELLOW→GREEN, ROLE_GOVERNANCE
YELLOW→GREEN, `CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01`. No completa M1 (siguen
controlled canaries + closeout M1-D).

---

# R1 — CI reconciliation (identity-preflight #69 FAILED → #70 GREEN)

Trazabilidad documental del intermedio fallido al árbol final. Sin cambio de código
de seguridad; solo hermeticidad de tests y orquestación de CI.

## Run fallido (root cause)

- **identity-preflight run #69** — `RUN_ID=31895989760`, `JOB_ID=95039274145`,
  `FAILED_SHA=48e0644`, conclusion **failure**.
- **FAILED_STEP**: #15 «La suite no escribe stores reales».
- **FAILED_COMMAND**: `node scripts/verify-test-store-isolation.mjs test:identity test:memberships`.
- **FAILED_ASSERTION**: `✗ archivos modificados: 1 — data-critical/insights.db-shm (contenido)`.
- **EXPECTED**: 0 archivos modificados. **ACTUAL**: 1 (`data-critical/insights.db-shm`).
  `FAIL — suites fallidas: 0; stores alterados: sí` → **EXIT_CODE 1**.
- Las suites en sí pasaron (`test:identity` ✓, `test:memberships` ✓, `suites fallidas: 0`):
  el único fallo fue la escritura de un store real.

## Clasificación: **A (store-isolation por path real)** — no B

No fue doble-ejecución (suites fallidas=0). Causa: la integración
`tenantAuthzIntegration.test.mjs` ejerce rutas de Aula Viva (`/students/:userId/*`)
que abren `getInsightsExtDb()`; con `INSIGHTS_SQLITE_PATH` ausente, ese repo resuelve
a `DEFAULT_PATH = data-critical/insights.db` (insightsDbExt.mjs:19-20) y, en modo WAL,
crea/actualiza el sidecar `insights.db-shm`. El store-isolation lo detectó bajo el
snapshot de `data-critical/`.

## Fix mapping (diff `48e0644..7f05ed7`, 4 archivos / +12 −3)

| Archivo | Cambio | Cierra |
|---|---|---|
| `server/__test__/tenantAuthzIntegration.test.mjs` (+1) | `INSIGHTS_SQLITE_PATH`/`EVENTS_SQLITE_PATH` → temp | la escritura de `insights.db-shm` (#69) |
| `server/__test__/tenantAuthzM1aIntegration.test.mjs` (+1) | ídem | misma clase, preventivo |
| `package.json` | `test:identity-integration` separado de `test:identity` | robustez: evita re-ejecutar las integraciones server-real bajo el store-guard |
| `.github/workflows/identity-preflight.yml` (+6) | paso propio `npm run test:identity-integration` | mantiene las integraciones en CI, una vez, fuera del store-guard |

`INSIGHTS_SQLITE_PATH` presente: **0** en 48e0644 → **1** en 7f05ed7 (verificado).

## Commit chain (sin reescribir historia)

`48e0644` (M1-B, con el bug de path) → **`7f05ed7`** (fix único, fast-forward,
sin force). Los amends intermedios locales no se publicaron; origin fue
`48e0644 → 7f05ed7` por ff.

## Reproducción (por evidencia determinística)

Ejecutar el test viejo escribiría `data-critical/insights.db-shm` en el working tree
(mutación de store real), por lo que se declara por diff+log determinístico
(FASE 5 fallback): (1) 48e0644 carece de `INSIGHTS_SQLITE_PATH`; (2)
`DB_PATH = process.env.INSIGHTS_SQLITE_PATH || data-critical/insights.db`; (3) el log
#69 muestra exactamente `data-critical/insights.db-shm (contenido)`. El árbol final se
validó además en imagen `cf36852` aislada (`--network none`, /tmp): store-isolation
**archivos modificados: 0**.

## Run final (GREEN)

- **identity-preflight run #70** — `FINAL_RUN_ID=31896611028`, `FINAL_SHA=7f05ed7`,
  conclusion **success** (incluye el paso store-isolation, no excluido; línea 131 del
  workflow: `verify-test-store-isolation.mjs test:identity test:memberships`).
- **security run #107** (`31896611040`): delta gate GREEN — evidence-hardening,
  image-integrity, gitleaks-head, trivy(fs), osv. Heredados
  `gitleaks-history` (10 leaks) y `trivy-image` (CVE-2026-44902/45447/59892)
  **baseline-idénticos**, `NEW_FINDINGS=0`.

## Auditoría de no-debilitamiento

`SECURITY_TEST_STRENGTH_UNCHANGED_OR_STRONGER=true`. El diff `48e0644..7f05ed7` **no**
toca `tenantAuthz.js`, `server.js`, ni las aserciones de la golden matrix / route-coverage
/ unit; **no** hay `continue-on-error`/`allow_failure`/`.skip`/exclusión del store-guard
/ eliminación de tests. Grep de debilitamiento: vacío. La golden matrix ya pasaba en
48e0644 (el fallo fue solo el sidecar de store); el fix añade hermeticidad, no relaja.

## Disposición

**GREEN — M1-B FAILED INTERMEDIATE PREFLIGHT ROOT-CAUSED AND FINAL PREP TREE VERIFIED
GREEN.** `FAILED_SHA=48e0644`, `FINAL_SHA=7f05ed7`, `FINAL_IDENTITY_PREFLIGHT=GREEN`,
`PRODUCTION_STORE_WRITES_FROM_TESTS=0`, `M1_B_PREP_VALID=true`. Canary GROUPS intacto.
