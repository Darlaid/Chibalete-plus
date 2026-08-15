# M1_B_TENANT_AUTHZ_00 — aislamiento tenant + gobernanza de membership (diseño)

Unidad: **CHP-IDDB-M1-B-TENANT-AUTHZ-00** (2026-08-15, read-only, design-only).
Veredicto: **GREEN — TENANT ISOLATION AND MEMBERSHIP GOVERNANCE ARCHITECTURE
DEFINED AND M1-B IMPLEMENTATION UNIT READY.**
Base de código: `cf36852`. Nada desplegado; canary GROUPS intacto.

## B. Production/canary freeze

Verificado por `docker inspect --format` (sin probes a `/api/groups`): api_1 `READ=json`,
api_2 `READ=sqlite`+`DOMAINS=groups`, ambos `cf36852` healthy, restarts=0 → RUNNING.

## C. Tenant model — la unidad de aislamiento es INSTITUTION

Autoridad canónica de tenancy = **institución** (`institutions.institution_id` en
identity.db; 4 registradas). No es `group` (los grupos pertenecen a una institución) ni el
`colegio`/`school` textual (display/legacy, nunca autoridad — `organizationScope.mjs` ya lo
codifica: solo `organizationId` registrado concede scope). `organizationId` del usuario y la
institución de sus memberships son las dos vías canónicas; el resto (`colegio` string,
`legacy_school`) es metadato.

## D. Grafo de relaciones canónico

```
USER ──(0..N)── MEMBERSHIP ──(N..1)── GROUP ──(N..1)── INSTITUTION
  │                  │ role∈{mediator,member}, institution_id (== group.institution_id: 227/227)
  └─ organizationId (0..1, opcional; autoridad secundaria de tenant)
```
- `memberships.institution_id == groups.institution_id` en **227/227** (sin drift).
- **MEMB_MULTI_INST = 0**: las memberships de cada usuario viven en **una sola** institución
  → resolución de tenant no ambigua por membership.
- `user.organizationId`: presente y registrado en una fracción; ausente en la mayoría (dato).

## E. Clases de scope de los 247 reales (conteos exactos, evidencia canónica)

| Clase | Definición | N |
|---|---|---|
| A | institución solo por membership (org ausente) | **124** |
| B | institución solo por `organizationId` (sin membership) | **4** |
| C | ambas y **consistentes** | **102** |
| E | ambas y **en conflicto** | **0** |
| D | ninguna (sin membership ni org registrado) | **17** |

226 resuelven por membership (A∪C), 4 por org (B), **17 sin scope (D)**. **E=0 ⇒ no existe
autoridad ambigua en producción** → la aislación es enforçable sin resolver conflictos (evita el
STOP). Política de D: **fail-closed** para rutas tenant-scoped (deny), preservando login / perfil
propio / contenido abierto. No auto-asignar. Los 17 (+2 externado, §W) son la superficie de
decisión humana OPCIONAL — **no bloquean deploy** porque deny-closed es seguro.

## F. Roles

1 `administrador` (global), 23 `mediador` (22 con rol `mediator` en alguna membership; 1 sin —
revisar en la unidad), 223 `lector`. Fuente = padrón JSON (`roles[]`) espejado en
`users.global_role`. El **rol de membership** (`mediator`/`member`) es la autoridad de scope
por-grupo, distinta del `global_role`.

## G. Global admin contract

`requireGlobalAdmin(req.auth)`: rol `administrador` resuelto server-side. Excepción **explícita
por ruta** — nunca "admin = bypass implícito". Una ruta tenant-scoped que admita override global
lo declara; el helper `requireGlobalAdmin` es el único punto donde se concede cross-tenant.

## H. Mediator contract (mínimo privilegio)

Un mediador opera SOLO en el scope donde tiene rol `mediator` en una membership:
- **su(s) institución(es)** (hoy 1 por MEMB_MULTI_INST=0) y **sus grupos** de mediación;
- **leer**: perfiles/progreso/Aula Viva de los **miembros de sus grupos**;
- **membership**: crear/retirar/cambiar-rol **dentro de sus grupos autorizados** (§O), nunca
  otorgar `administrador` ni actuar en otra institución;
- **NO**: crear usuarios (queda admin-global salvo decisión de producto), ni ver otras
  instituciones, ni gestionar content/access (fuera de M1-B). Nunca "mediador global".

## I. Reader contract

Lector: su perfil, sus memberships, su progreso, el contenido que su `access` autoriza. **No**
listado global de usuarios/grupos. Listas institucionales solo si un consumidor real las
necesita (§L/§AF) — hoy no se identifica ninguna que las requiera para el lector.

## J. Route inventory (sensibles) — scope actual → objetivo

| Método/Ruta | MW actual | Resource tenant | Scope actual | Scope objetivo |
|---|---|---|---|---|
| GET /api/users | requireAuth | todos | **global (647 sanit.)** | admin: all; mediador: su institución; lector: — |
| GET /api/users/:id | requireAuth | del user | **global** | self ∪ mediador-misma-inst ∪ admin |
| PUT/DELETE /api/users/:id | requireAdminAccess | del user | admin global | admin global (crea/borra) |
| GET /api/groups | requireAuth | del group | **global (20)** | admin: all; mediador: su inst + compat; lector: sus grupos |
| GET /api/groups/:id, /members, /candidates, /diagnosis | requireAuth | del group | **global** | scoped por institución/membership |
| POST/PUT/DELETE groups, members add/remove/move | requireAdminAccess | del group | admin global | admin global **o mediador-en-scope** (§O) |
| POST /api/groups/:id/join | requireUserAuth | del group | self (club∧open) | self + validación de institución |
| GET /api/students/:id/status | requireAuth | del user | **global** | self ∪ mediador-scope ∪ admin |
| GET /api/aula-viva/students/:userId/* | requireUserAuth | del user | **global (cualquiera)** | self ∪ mediador-scope ∪ admin |
| GET /api/aula-viva/... cohorts/recommendations | requireUserAuth | inst/grupo | **global** | mediador-scope ∪ admin |
| GET /api/aula-viva/institutional/* | requireUserAuth | institución | **global** | mediador/admin de esa institución |
| GET /api/leo/mediator/student/:userId(/content) | requireAuth | del user | **global** | mediador-scope ∪ admin |
| GET /api/progress/user/:userId, item/:userId/:contentId | (ninguno) | del user | **abierto** | self ∪ mediador-scope ∪ admin |
| POST /api/progress/:userId/*/sync,complete | requireProgressOwner | del user | self (M1-A: +active) | self |
| GET /api/reports/course/:courseId, school/:schoolId | (async) | inst/grupo | **abierto** | mediador/admin de scope |
| GET /api/metrics/student/:userId, course, school | legacy metrics | user/inst | por organizationId (v2) | mantener + scope de sesión |

**Superficie de exposición cross-tenant confirmada** (todas hoy accesibles por cualquier
autenticado, cerrando M1-A la autoafirmación pero NO el scope): `/api/users` global,
`/api/users/:id`, groups list/get/members, Aula Viva `/students/*` e `/institutional/*`,
`/api/leo/mediator/*`, `/api/progress/user|item/*` (sin MW), reports. Es `CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01`.

## K. Cross-tenant matrix (objetivo)

Fixtures: Inst A {admin_g (global), mediador_A, member_A, group_A, user_A}; Inst B {mediador_B,
member_B, group_B, user_B}. Para LIST/GET/CREATE/UPDATE/DEACTIVATE/membership×3/progress r-w/access:
`actor_A → resource_A` = permitido según rol; `actor_A → resource_B` = **DENY**. Único escape:
`admin_g` con override explícito por ruta. Objetivo agregado (§AE): **CROSS_TENANT_READ_ALLOWED=0,
CROSS_TENANT_WRITE_ALLOWED=0** salvo `EXPLICIT_GLOBAL_ADMIN_CASES`.

## L. Users list contract

`GET /api/users` → admin: universo; mediador: usuarios de su institución (los de sus grupos +
miembros de su institución); lector: **no** (o solo self). **Filtro server-side antes de responder**
(§AA), no en frontend. Mapear consumidores: AdminUsuarios (admin), asignación de grupos (mediador,
candidatos de su institución), selección de miembros. Los consumidores de lector no dependen del
listado global (verificar en la unidad, §AF).

## M. User GET contract

`GET /api/users/:id` → **self ∪ mediador-de-su-institución ∪ admin**. Sin GET global autenticado.
404 vs 403 según §AB.

## N. Groups list/get contract

Canónicos (4): scoped por institución. **15 legacy compat**: visibilidad **admin/histórica
explícita** (nunca inferir tenant por nombre; `organizationScope.mjs` ya los marca
HISTORICAL_OUT_OF_SCOPE). **1 sintético**: admin/histórico only. La compat de GAP3 **no** debe
saltarse el scoping: la vista compuesta de groups se filtra por scope del actor ANTES de responder.

## O. Membership governance (crítico)

| Operación | WHO | Scope | Rol asignable | Audit |
|---|---|---|---|---|
| create | admin global; mediador en su grupo | misma institución del actor y del grupo | member (mediador); cualquiera (admin) | MEMBERSHIP_CREATED |
| role change | admin global; mediador en su grupo | ídem; **nunca** a `administrador` | member↔mediator (admin); (mediador: según política, mín. no auto-promote) | MEMBERSHIP_ROLE_CHANGED |
| deactivate/remove | admin global; mediador en su grupo | ídem | — | MEMBERSHIP_REVOKED |
| self-join | el propio usuario | club∧open **de su institución** | member | MEMBERSHIP_SELF_JOIN |

Regla dura: un mediador **solo** gestiona memberships de grupos donde él es `mediator`, y solo
para usuarios/grupos de **su** institución. Nunca mediador global. Toda mutación emite evento de
auditoría (§AC).

## P. Escalation controls (deben ser 403)

member no puede auto-promoverse a mediador; mediador no puede otorgar `administrador`; mediador_A
no crea membership en institución B; mediador_A no asigna user_B cross-tenant; lector no crea
membership; self-join nunca concede `mediator`.

## Q. Tenant resolver

`resolveUserInstitutionScope(userId) → { status: RESOLVED|UNSCOPED|AMBIGUOUS, institutionId }`:
- prioridad EXPLÍCITA: **membership institution** (autoridad primaria) → si ausente, `organizationId`
  registrado → si ambos y difieren, `AMBIGUOUS` (hoy 0 casos). MEMB_MULTI_INST=0 ⇒ membership da un
  único id.
- `UNSCOPED` (D, 17) y `AMBIGUOUS` (0) ⇒ **fail-closed** en rutas tenant-scoped; login/self/contenido
  abierto siguen. Server-side canónico; nunca `req.body`/cookie.

## R. Policy helpers (explícitos, no framework)

`requireGlobalAdmin(auth)`, `requireSelfOrScopedMediator(auth, targetUserId)`,
`requireGroupScope(auth, groupId)`, `requireMembershipManagementScope(auth, groupId)`,
`requireSameInstitution(auth, institutionId)`. Todos consumen `req.auth.userId`, resuelven
rol/institución server-side, devuelven allow/deny (+razón para telemetría). Testeables uno a uno.

## S. M1-A interface

Las policies consumen **solo** `req.auth.userId` (identidad firmada, revocable, active-checked de
M1-A). Roles/status/institución = lookup server-side. Prohibido confiar en `req.body.organizationId`,
`x-user-id`, rol/tenant desde cookie. Los IDs de tenant/recurso de la request son **input** a
autorizar, no claims de autoridad. M1-B **no** puede desplegarse antes que M1-A (enforce).

## T. Admin-secret flows

`x-admin-secret` file-only sigue siendo autoridad de **máquina** global explícita (metrics,
shadow-compare, ops). `req.authMethod` distingue `session` vs `admin_secret`. El navegador nunca
adquiere el secreto. Rutas que exigen sesión humana no aceptan solo secreto salvo declaración.

## U. Legacy groups (15)

Sin institución canónica → **admin/histórico explícito** (opción A/C combinadas): visibles a admin
global y como compat histórica declarada; nunca scoped a un tenant por heurística de nombre. Su
retiro es `CHP-IDDB-PURGE-GROUPS-01` (aparte).

## V. Unscoped real users (17)

Reales sin membership ni org registrado. **No auto-asignar.** En rutas tenant-scoped: **fail-closed**.
Preservado: login, perfil propio, contenido abierto/global (donde el tenant es irrelevante). Roster
exacto (conteo 17, sin PII) disponible para una decisión de producto OPCIONAL (§AG); no bloquea deploy.

## W. school-externado

Institución registrada, `addressable=0`, 0 grupos, **2** usuarios reales solo con
`organizationId=school-externado` (0 memberships). Trato: **intencionalmente inactiva** (histórica/
futura). No crear grupo. Resolución de tenant: esos 2 resuelven a `school-externado` por org (clase B),
pero al no haber grupos ni rutas de esa institución, en la práctica operan como scoped-vacío → las
rutas tenant devuelven vacío/deny sin exponer otras instituciones. Documentado, sin cambio de datos.

## X. Content access boundary

M1-B **no** rediseña licencias de contenido. Separación: la **autorización de identidad/tenant**
(¿este actor puede ver este recurso de identidad?) es independiente de la **política de acceso a
contenido** (`accessService`, incluido el `LEGACY_OPEN` deliberado de la deuda zero-rule). El scoping
de M1-B NO amplía ni deniega catálogo: no toca `/api/content/:id/access`. Frontera explícita.

## Y. Aula Viva

Todas las rutas operativas e institucionales son hoy `requireUserAuth` (cualquiera). Objetivo:
`/students/:userId/*` → self ∪ mediador-scope ∪ admin; cohorts/recommendations/`/institutional/*` →
mediador/admin **de esa institución/grupo**. Sin cambios en ranking/diagnóstico pedagógico — solo
scoping de quién ve la evidencia. El emisor de auditoría de Aula Viva ya existe
(`aulaVivaAuditEmitter.mjs`).

## Z. Progress authorization

self (user only, ya con active en M1-A); lecturas de mediador solo de miembros/grupos autorizados;
cross-institución deny; write-as-other deny (sin autoridad de sistema salvo declaración). Cerrar
`/api/progress/user/:userId` y `/item/*` (hoy sin MW) con `requireSelfOrScopedMediator`. **No** usar
comparación `header==param` como primitiva de seguridad (M1-A ya da identidad firmada).

## AA. List scoping / pagination

Filtrado **server-side pre-respuesta** (query o service layer), nunca solo frontend. Los
totales/counts no deben filtrar información cross-tenant (contar solo el scope del actor).

## AB. Error semantics

Recurso cross-tenant: **404** cuando revelar existencia filtra pertenencia institucional (users,
groups, students); **403** cuando el actor legítimamente sabe que el recurso existe pero le falta
capacidad (p. ej. membership management en su propio grupo sin rol suficiente). Documentar por clase
de ruta; no filtrar existencia/identificadores innecesariamente.

## AC. Audit trail

Infra existente: `writeAuditLog` (ULID server-owned, timestamp server-owned, override-proof) +
`recordCanonicalEvent`/`aulaVivaAuditEmitter` (events.db). Eventos M1-B: `MEMBERSHIP_CREATED`,
`MEMBERSHIP_ROLE_CHANGED`, `MEMBERSHIP_REVOKED`, `MEMBERSHIP_SELF_JOIN`, `TENANT_AUTHZ_DENIED`.
Sin PII en labels de métricas (`tenant_authz_denied_total{route_class,reason}`). Mecanismo inmutable
para las mutaciones de gobernanza.

## AD. Test matrix

Admin global: A→A y A→B (override explícito) permitido. Mediador_A: user_A read ok / user_B deny;
group_A ok / group_B deny; membership_A gestionar según política / membership_B deny. Lector_A: self
ok / other_A según contrato / B deny; membership mutation deny; progreso ajeno deny. Unscoped:
tenant-scoped deny. Ambiguous: deny (0 en prod, fixture artificial). Legacy: según contrato compat.

## AE. Golden isolation suite

Aserción agregada sobre TODAS las rutas del inventario (§J): `CROSS_TENANT_READ_ALLOWED=0`,
`CROSS_TENANT_WRITE_ALLOWED=0` salvo `EXPLICIT_GLOBAL_ADMIN_CASES` (lista blanca declarada). **Guard
de cobertura**: ninguna ruta sensible puede quedar fuera de la matriz sin fallar el guard (test que
enumera rutas montadas vs rutas cubiertas).

## AF. Frontend impact

Páginas que hoy dependen de listas globales: AdminUsuarios (admin, ok), asignación multi-grupo /
selección de miembros (mediador → recibirá solo su institución), vistas de mediador de Aula Viva /
Leo (scoped). Distinguir **requisito de seguridad backend** (obligatorio) de **adaptación UX** (el
backend filtra; el frontend puede necesitar ajustar mensajes/estados vacíos). Sin implementación ahora.

## AG. Data/migration requirements

**No se requiere migración de datos para desplegar** (E=0 → sin ambigüedad; D=17 + externado 2 se
manejan por deny-closed seguro). OPCIONAL, como unidad de datos controlada separada: atestación/
linkage institucional para los 17 unscoped + 2 externado si producto quiere que operen scoped. No
inventar links. Rosters por conteo (17 / 2), sin PII en este reporte.

## AH. Deploy strategy (tras M1-A, no ejecutar)

A: helpers de policy desplegados **dormant** (flag `TENANT_AUTHZ_MODE=off`). B: **shadow authz** —
las policies computan allow/deny y lo registran (`tenant_authz_denied_total`) SIN aplicar → mide el
impacto real y detecta falsos-deny antes de enforce. C: **canary de GET scoped en api_2**. D:
enforce de gobernanza de membership. E: enforce en todas las rutas. El **shadow mode (B) es útil**
aquí: revela consumidores legítimos que romperían con deny antes de bloquear.

## AI. Rollback

No reabrir la autoafirmación de M1-A. Rollback de M1-B = `enforce→shadow/off` por
flag/config (los datos no cambian) — pero si eso reabre lecturas cross-tenant, exige
`--acknowledge-security-risk` y evento de seguridad. Preferir rollback de política, no de identidad.

## AJ. Implementation unit — CHP-IDDB-M1-B-TENANT-AUTHZ-01

Una unidad coherente con modo dormant/shadow/enforce: (1) `resolveUserInstitutionScope`; (2) helpers
§R; (3) scoping de users list/GET; (4) scoping de groups list/get/members (respeta compat GAP3); (5)
gobernanza de membership (create/role/remove/self-join) + escalation guards; (6) scoping de progress
(+ cerrar rutas sin MW); (7) scoping de Aula Viva y Leo-mediator; (8) telemetría + audit events; (9)
suite §AD/§AE con guard de cobertura; (10) adaptaciones de frontend. **Split solo si** el frontend
exige su propia ventana (posible front/back), o si la gobernanza de membership merece unidad aparte
del scoping de lectura (evaluable: leer-scoping en enforce es de bajo riesgo con shadow previo;
membership governance cambia flujos de escritura).

## AK. M1 impact

M1-B pasa **TENANT_ISOLATION: RED→GREEN**, **MEMBERSHIP_GOVERNANCE: YELLOW→GREEN**,
**ROLE_GOVERNANCE: YELLOW→GREEN**, y cierra/acota materialmente `CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01`.
**No** completa M1: siguen los controlled canaries (GROUPS en curso; ACCESS/USERS pendientes) + el
closeout M1-D.

## AL. Documentation/CI

Este doc en rama docs-only `chp/m1-b-tenant-authz-audit` (desde `cf36852`). `lint:evidence` GREEN.
Sin update de ref productiva.

## AM. Groups-canary non-interference

Sin recreate/flags/probes/build/ref. api_1 json, api_2 sqlite+groups, ambos cf36852 healthy,
restarts=0 → RUNNING.

## AN. Exact next step

Secuencia: [GROUPS-CANARY-CLOSE] → **M1-A-DEPLOY** (sesión firmada) → **CHP-IDDB-M1-B-TENANT-AUTHZ-01**
(esta unidad, requiere M1-A enforce) → M1-C (ACCESS/USERS canaries) → M1-D closeout. M1-B es
design-ready; su implementación arranca cuando M1-A esté en enforce.
