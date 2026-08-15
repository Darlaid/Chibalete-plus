# M1_B_INTEGRATION_REHEARSAL_01 — M1-B sobre M1-A final (0ff76b6)

Unidad: **CHP-IDDB-M1-B-INTEGRATION-REHEARSAL-01** (2026-08-15, offline).
Demuestra que el runtime de M1-B integra limpio y seguro sobre el source FINAL de
M1-A. Nada desplegado; canary GROUPS intacto. **`M1_B_INTEGRATED_REHEARSAL_SHA=8bc4c0b`**
(rama `chp/m1-b-integration-rehearsal-01`; NO es SHA productivo aún).

## Veredicto

**GREEN — M1-B INTEGRATION AGAINST FINAL M1-A SOURCE REHEARSED AND POST-M1-A DEPLOY
TREE IS READY.**

## C. Ancestry

- `M1_A_FINAL_BASE=0ff76b6` (cf36852 → f1c002b → 0ff76b6, lineal).
- `M1_B_ORIGINAL_BASE=f1c002b`; `COMMON_ANCESTOR(0ff76b6, 7f05ed7)=f1c002b`.
- `M1_B_RUNTIME_COMMITS`: `142934b` (feat tenant authz), `7f05ed7` (fix test-hermético +
  workflow step); `48e0644` docs-only.
- Docs-only excluidos del runtime base: M1-A `a684aaa`, M1-B `102643a`.

## D–E. Deltas

- **M1-A R1** (`f1c002b..0ff76b6`, runtime): server.js (reqUserId + lectores inline
  session-first + access-preflight + requireAdminRole), 21 archivos frontend (retiro
  x-user-id), 2 tests nuevos.
- **M1-B** (`f1c002b..7f05ed7`, runtime): `server/lib/tenantAuthz.js`, server.js (tenant
  guards + scopeUsers/Groups + membershipMutationGuard + wiring), metrics.js (counters
  tenant), operationalRouter.mjs (studentGuard), 4 tests.

## F. Integration strategy

`merge --no-ff 7f05ed7` sobre `0ff76b6` (rama de ensayo desde 0ff76b6). Merge de 3 vías
desde el ancestro común `f1c002b` → aflora los conflictos reales preservando provenance
de ambas ramas. Sin force-push; ramas source intactas.

## G. Conflicts (POTENTIAL_CONFLICT_SET = 3, resueltos)

| File | M1-A intent | M1-B intent | Resolución |
|---|---|---|---|
| `server/server.js` | reqUserId + lectores session-first + access-preflight | tenant guards + scoping + membership governance | **auto-merge limpio** (regiones distintas: R1 en middlewares/lectores de identidad, M1-B en guards de tenant/rutas) |
| `.github/workflows/identity-preflight.yml` | step `test:session-browser` | step `test:identity-integration` | **ambos steps** coexisten |
| `package.json` | `test:identity`+=guard; script `test:session-browser` | `test:identity`+=tenant tests; script `test:identity-integration` | **unión**: test:identity con guard+tenant tests; ambos scripts |

Ningún conflicto resuelto por "ours/theirs" ciego: cada uno preserva ambas intenciones.

## I. Authority chain (integrada)

`cookie → verificación de sesión M1-A → req.auth.userId → resolución tenant/rol M1-B →
autorización de recurso`. Nunca x-user-id / body.organizationId / body.role / query tenant
como fuente de confianza (en enforce). El helper `reqUserId = req.auth ?? req.user ??
header` sirve la identidad al plano de tenant; en enforce+session-enforce el header no
autentica (M1-A lo rechaza).

## J. Browser x-user-id guard

`browserNoXUserIdGuard` sobre el árbol integrado: **`PRODUCT_BROWSER_X_USER_ID_EMITTERS=0`**
(127 archivos). M1-B no reintrodujo x-user-id.

## K. Session matrix (M1-A preservada)

sessionIdentity **42/42**, sessionIdentityIntegration **34/34** (two-instance, revocación
cruzada, disabled, mismatch, enforce rechaza x-user-id externo, CSRF, logout/logout-all),
sessionBrowserCookieOnly **13/13** (compat+enforce). M1-B no degrada M1-A.

## L. Tenant golden matrix (M1-B preservada)

tenantAuthzIntegration **36/36** (`CROSS_TENANT_READ_ALLOWED=0`, escalation 403, unscoped/
ambiguous fail-closed, admin override explícito), tenantAuthz unit **35/35**, bridge
tenantAuthzM1aIntegration **6/6**.

## M–N. Mode interaction + invalid-mode guard

Dos familias independientes: `SESSION_AUTH_MODE` (off/compat/enforce) y `TENANT_AUTHZ_MODE`
(off/shadow/enforce). **`modeInteractionMatrix` 13/13**: combos válidos arrancan
(off+off, compat+off, enforce+off, compat/enforce+shadow, **enforce+enforce**); la combinación
**INVÁLIDA** `TENANT_AUTHZ_MODE=enforce ∧ SESSION_AUTH_MODE!=enforce` (autorizaría scope de
tenant sobre identidad autoafirmada) hace **fail-fast al arranque** (guard nuevo en server.js;
el boot log declara `MODE_GUARD`), salvo el bypass explícito de test
`TENANT_AUTHZ_ALLOW_UNSAFE=1`. **`M1_B_ENFORCE_REQUIRES_M1_A_ENFORCE=true`**. El guard no
rompe ninguna fase legítima: el runbook nunca pone tenant=enforce antes de M1-A enforce.

## O. Inline readers (colisión R1×M1-B)

R1 tocó ~14 lectores de identidad; M1-B usa `req.auth.userId` primero vía sus helpers. En el
árbol integrado la identidad se resuelve UNA vez (session/reqUserId) y luego la política de
tenant; sin doble interpretación ni cadena que confíe en x-user-id tras M1-A enforce
(verificado: enforce rechaza x-user-id externo en las rutas de tenant).

## P–Q. Progress / Aula Viva / Leo

Contrato combinado probado (golden + bridge): disabled→401 (M1-A), self permitido, otro-usuario
deny (M1-B), mediador-scope permitido, cross-tenant deny; Aula Viva `/students/*` y Leo-mediador
scoped; sin cambios pedagógicos.

## R. Admin authority

Humano: sesión + rol server-side. Máquina: x-admin-secret (sin cambio). Sin admin-secret en
navegador; sin autoridad admin por x-user-id. Override global solo donde la ruta M1-B lo
declara.

## S. Frontend

Build integrado GREEN; cookie-only; emitters=0; bootstrap `/auth/me`; logout; listas scoped
server-side (M1-B) sobre respuestas sin x-user-id (R1). El backend es correcto sin depender de
la UI.

## T. Off/shadow safety

M1-B off = comportamiento M1-A intacto (no-op); M1-B shadow = no cambia respuesta, solo
telemetría/audit (probado en tenantAuthzIntegration OFF/SHADOW == respuesta; enforce filtra).

## U. Route coverage

`tenantRouteCoverage` sobre el server.js INTEGRADO **6/6**, `UNCLASSIFIED_SENSITIVE_ROUTES=0`
(los cambios de handler de R1 no dejaron rutas sensibles sin política de tenant).

## V. Store isolation

Todas las integraciones POSIX redirigen INSIGHTS/EVENTS/SESSIONS y stores a temp →
`PRODUCTION_STORE_WRITES_FROM_TESTS=0`. Validadas en imagen `cf36852` aislada `--network none`.

## W. Full suites

M1-A (42/34/13), M1-B (35/36/6/6), mode-matrix 13, route-coverage 6, guard 2, GAP1 53, GAP3 41,
GAP2 50, shadowCompare 95, memberships 51, Aula Viva 31, typecheck/build/evidence GREEN.

## X. CI

Push de la rama de ensayo; exact-tree identity-preflight + security. Delta gate esperado GREEN
(cookie-only + tenant integrations + mode matrix en steps propios server-real; store-isolation
intacto); heredados gitleaks-history/trivy-image baseline. Ver run del push.

## Y. Future deploy base

`M1_B_INTEGRATED_REHEARSAL_SHA=8bc4c0b` **NO es SHA productivo aún**. Tras el deploy y close
REALES de M1-A, re-verificar equivalencia de tree contra el tip productivo de M1-A; si la
ancestría exact-tree se mantiene, el deploy de M1-B integra desde este ensayo (re-CI exact-tree).

## Z. Deploy order (futuro)

M1-A CLOSED GREEN → M1-B B0 (`TENANT_AUTHZ_MODE=off`) → B1 (shadow api_2) → B2 (shadow ambas) →
B3 (GET/list enforce api_2) → B4 (ambas) → B5 (membership writes) → B6 (resto tenant) → B7
(golden closeout). Sin ejecución.

## AA. Rollback boundary

El rollback de M1-B NUNCA cambia `SESSION_AUTH_MODE`, ni reabre x-user-id externo, ni toca la
signing key / sessions.db / `IDENTITY_READ_DOMAINS`. Rollback semántico M1-B: enforce → shadow →
off. Reabrir acceso cross-tenant exige acknowledgement de seguridad explícito.

## AB. Groups-canary non-interference

`docker inspect --format` (sin probes): api_1 `cf36852` json, api_2 `cf36852` sqlite/groups,
ambos healthy, restarts=0 → RUNNING.

## AD. M1_B_POST_M1A_DEPLOY_READY

**true** — integración limpia/determinista, contratos M1-A y M1-B preservados, guard de modos,
suites GREEN. Condicionado a: M1-A desplegado+cerrado primero, y re-verificación exact-tree.

## AE. Exact next step

**CHP-IDDB-M1-C1-GROUPS-CANARY-CLOSE-01** (tras resume 2026-08-16T14:25Z) → **M1-A-DEPLOY**
(desde 0ff76b6) → **M1-B-DEPLOY** (integra desde este ensayo tras re-verificación exact-tree,
B0→B7) → M1-C → M1-D.
