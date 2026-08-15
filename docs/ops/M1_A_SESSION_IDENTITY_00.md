# M1_A_SESSION_IDENTITY_00 — identidad de sesión firmada (diseño + plan)

Unidad: **CHP-IDDB-M1-A-SESSION-IDENTITY-00** (2026-08-15, read-only, design-only).
Veredicto: **GREEN — SIGNED SESSION IDENTITY ARCHITECTURE DEFINED AND M1-A IMPLEMENTATION UNIT READY.**
Baseline de código: `cf36852`. No se desplegó nada; el canary GROUPS quedó intacto.

## B. Production / canary freeze

api_1 `READ=json` (control), api_2 `READ=sqlite`+`DOMAINS=groups` (canary RUNNING), ambos
`cf36852` healthy restarts=0. Esta auditoría fue 100 % lectura de código + un único
`docker inspect` no intrusivo (sin requests a `/api/groups`, sin flags, sin recreate).

## C. Authentication mechanisms (inventario real)

| Mecanismo | Fuente | Consumidores | Firmado | Expira | Revocable | Active check | Productivo |
|---|---|---|---|---|---|---|---|
| `x-user-id` | header (navegador, desde localStorage/sessionStorage) | `requireUserAuth`, `getRequestHasValidPrincipal`, `requireProgressOwner`, rama B de `requireAdminAccess`, `/api/content/:id/access`, ~40 actor-logs | **NO** | **NO** | solo vía disable de cuenta | **parcial** (ver G) | **SÍ (sesión de facto)** |
| `x-admin-secret` | header → archivo `/app/secrets/admin_secret` (0400 root) | `requireAdminAccess/requireAuth/isAdminRequest` | n/a (secreto compartido) | no | por rotación (rename) | n/a | SÍ (máquina/ops) |
| `requireOperationalAdminSecret` | variante del secreto para telemetría | shadow-compare, request-context | — | — | rotación | — | SÍ (ops) |
| tokens invite/reset | body, un solo uso, TTL | accept-invite/reset-confirm | opacos aleatorios | SÍ | consumo | — | SÍ (onboarding) |

**No hay** cookies de sesión, `Authorization`/Bearer, JWT, ni API keys de cliente. `bcryptjs`
es la única dependencia de credenciales; **no hay `jsonwebtoken` ni `cookie-parser`**.

## D. Middleware graph

```
request
 └─ identity extraction ── x-user-id (header)            ← autoafirmado, sin verificar origen
        │                └─ x-admin-secret (archivo)     ← seguro (file-only)
        ├─ user lookup ── readJSON(USERS_DB).find(id)
        ├─ status check ── isUserActive(user)            ← PRESENTE en requireUserAuth,
        │                                                   getRequestHasValidPrincipal,
        │                                                   requireAdminAccess;
        │                                                   AUSENTE en requireProgressOwner
        ├─ role check ──── roles.includes('administrador') (solo requireAdminAccess)
        ├─ tenant check ── (NINGUNO — gap M1-B)
        └─ resource authz ── por endpoint (mayoría solo autenticación, no propiedad)
```

Bifurcaciones inconsistentes: (1) los GET usan `allowAuthenticatedGetOrReject` (active OK);
(2) `requireProgressOwner` salta el active check; (3) `/api/content/:id/access` valida con
un "anti-spoofing" que solo compara `header === query.userId` — **ambos autoafirmados**, luego
trivialmente satisfacible fijando los dos al id objetivo.

## E. Route coverage (clases)

- **PUBLIC** (sin identidad): `/api/server-time`, `/api/runtime-config`, `/api/health*`,
  `/api/lu/version`, `/api/bundles` GET, `/api/content` GET, `/api/sections` GET,
  `/api/content/:id/access` (auth inline débil), `/api/analytics/events`, `/api/events`,
  `/api/playback-events`, `/api/offline/assignment` POST-no… (en realidad `requireUserAuth`).
- **AUTHENTICATED** (`requireAuth`/`requireUserAuth`, cualquier usuario activo): `/api/users` GET
  (¡647!), `/api/groups` GET, `/api/schools`, `/api/students/:id/status`, `/api/auth/me`,
  `/api/content/my-catalog`, Leo, submissions, interventions, `/api/access/by-user/:userId`.
- **SELF** (dueño del recurso): `/api/progress/:userId/*` (`requireProgressOwner`, sin active),
  `/api/progress/my/*`, `/api/offline/assignment`.
- **ADMIN_GLOBAL** (`requireAdminAccess`): users/groups/schools writes, members CRUD, invite,
  gemini, membership-governance, tts admin.
- **SERVICE_INTERNAL**: rutas con `x-admin-secret` (metrics, shadow-compare).
- **UNKNOWN/none**: `/api/content` write (async inline), `/api/upload*` (revisar en M1-B).

Ninguna ruta tiene **TENANT_SCOPED** hoy — todo AUTHENTICATED es global (gap M1-B).

## F. x-user-id exposure (matriz de autoafirmación)

Un cliente que conoce el id de otro usuario **activo** obtiene hoy, sin credencial:

| Rol afirmado | Recurso | READ | WRITE | ADMIN |
|---|---|---|---|---|
| lector→lector | perfil/status/catálogo/progreso ajenos | **ALLOWED** (IDOR) | progreso ajeno vía `requireProgressOwner` header==param (**ALLOWED**, sin active) | DENIED |
| lector→cualquiera | `/api/users` (647 sanitizados), `/api/groups`, memberships | **ALLOWED** | DENIED (writes exigen rol admin) | DENIED |
| lector→admin id | operaciones admin | — | **ALLOWED si afirma el id del admin global** (rama B de `requireAdminAccess` confía en x-user-id) | **ALLOWED** |

La última fila es la más grave: como el header no está firmado, **afirmar el id del único
administrador global concede autoridad admin completa**. Es exactamente
`CHP-SEC-SESSION-SELF-ASSERTED-ID-01` + amplifica `CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01`.

## G. Active/disabled enforcement

`isUserActive` se aplica en `requireUserAuth`, `getRequestHasValidPrincipal` (GETs) y
`requireAdminAccess`. **Gap confirmado:** `requireProgressOwner` (server.js:454-466) valida
`header===param` y **existencia**, no `isUserActive` → un id deshabilitado autoafirmado puede
escribir progreso (sync/complete). Es blocker de **AUTHZ** (no de sesión: sin firma da igual),
pero M1-A lo cierra de paso al centralizar la resolución de identidad.

## H. Login contract

`POST /api/auth/login` → bcrypt sobre `password` del JSON, gate active POST-credencial,
401 genérico sin enumeración, `loginLimiter` 10/IP/15min, `lastLoginAt` best-effort.
**Respuesta = `{ success:true, user: sanitizeUserForClient(user) }` — NO emite ningún
artefacto autenticador.** Confirmado: `x-user-id` funciona como "credencial de sesión" de facto.
El login JSON authority NO cambia.

## I. Frontend/client flow

`context/AuthContext.tsx`: al login guarda `chibalete_user_id` en localStorage (remember) o
sessionStorage; bootstrap re-hidrata desde ese id; logout lo borra. `dataService.ts`
lee ese id y lo envía como `x-user-id` en ~25 sitios. **Solo hay cliente web** (los consumidores
offline usan el mismo dataService). Cambios requeridos: (1) login guarda/usa la nueva sesión;
(2) `adminWriteHeaders`/fetch dejan de construir `x-user-id`; (3) logout invalida server-side.

## J. Internal/admin auth

`x-admin-secret` file-only (0400 root, rotable por rename, sin caché, fail-closed) es
**autoridad de máquina** y NO se sustituye por la sesión humana. Rutas que la conservan:
metrics/shadow-compare/ops scripts + rama A de `requireAdminAccess` (server-to-server). La sesión
humana solo reemplaza la **rama B** (x-user-id con rol admin) — hoy insegura.

## K. Session requirements

AUTHENTICATED_IDENTITY, ISSUED_BY_SERVER, TAMPER_PROOF, EXPIRING, REVOCABLE, ACTIVE_RECHECK
(cada request), ROLE/TENANT server-side, NO client role/tenant assertion, NO credentials in
token, LOGOUT semantics, KEY_ROTATION con grace, MULTI_INSTANCE (api_1/api_2 verifican igual),
XSS/CSRF documentados.

## L. Options considered

| | A. JWT stateless | B. opaque id + server store | C. **HMAC firmado en cookie HttpOnly** | D. Bearer a JS |
|---|---|---|---|---|
| Firma/tamper | sí | sí (store) | **sí (HMAC file-key)** | sí |
| Revocación | débil (solo exp) | fuerte (store) | **fuerte (credential_version canónico)** | débil |
| XSS exposure | alta (JS lee token) | baja | **nula (HttpOnly)** | alta |
| CSRF | n/a (header) | n/a | requiere SameSite+guard | n/a |
| Dos instancias | key compartida | **store compartido** | **key compartida (patrón admin_secret)** | key compartida |
| Store nuevo | no | **sí** | **no** | no |
| Complejidad | media | alta | **media** | media |

## M. Selected architecture

**Opción C con minimización de claims y revocación canónica (híbrido A+C):**
token de sesión **HMAC-SHA256** (clave desde archivo `/app/secrets/session_signing_key`, mismo
modelo endurecido que `admin_secret`) transportado en **cookie HttpOnly; Secure; SameSite=Strict;
Path=/**. Sin JWT librería: `crypto` nativo (`base64url(payload).signature`), payload mínimo.
Verificación en cada request contra autoridad canónica (JSON users ya se lee por request).
**No requiere store server-side nuevo** para el caso base (revocación por `credential_version`);
tabla de sesiones opcional para revocación por sesión individual (ver R).

## N. Claim minimization

Payload = `{ sub: userId, sid: jti, iat, exp, cv: credential_version }`. **Nada mutable** en el
token: roles, accountStatus, institución y memberships se resuelven server-side cada request
desde la autoridad vigente. Un cambio de rol/status/tenant tiene efecto inmediato sin esperar exp.

## O. Revocation model

`credential_version` (entero) por usuario en el padrón JSON. La sesión es válida solo si
`token.cv === user.credential_version` **y** `isUserActive(user)`. Se incrementa `credential_version`
en: logout-all, disable de cuenta, reset/rotación de password, forced logout admin. Logout normal:
además borra la cookie. **Disable de cuenta invalida toda sesión existente en la siguiente request**
(no depende de exp). exp corto (p. ej. 12 h) como defensa en profundidad; refresh por re-login.

## P. Two-instance model

Clave HMAC compartida vía bind-mount del archivo de secreto en api_1 y api_2 (idéntico a
`admin_secret`); ambas verifican sin store compartido. `credential_version` vive en el padrón JSON
que las dos instancias ya leen por request → revocación consistente cross-instance sin dependencia
nueva. No resuelve rate-limiting distribuido (`CHP-SEC-RATE-LIMIT-DISTRIBUTED-01`, fuera de alcance).

## Q. Secret/key management

`session_signing_key` (≥32 bytes aleatorios) como archivo **0400 root:root**, montado read-only,
leído explícitamente (sin caché, sin `.env` versionado). Rotación con **grace de doble clave**:
verificar contra `{current, previous}`, firmar con `current`; retirar `previous` tras exp máximo.
Generación/rotación por runbook de ops; **no se genera clave productiva en esta unidad**.

## R. Session storage

**Base: sin store** (stateless firmado + `credential_version`). **Opcional (recomendado para
revocación por-sesión y "cerrar otras sesiones"):** tabla `sessions` en `identity.db` (ya
two-process-safe, backup ya cubierto por 01B) — pero ver AC: se declara **NO recovery-critical**.
Criterios que descartan Redis/servicio nuevo: two-process seguro ya disponible en SQLite,
frecuencia de escritura baja (1/login), limpieza por TTL, reconstruible (sesión perdida = re-login).

## S. Browser security

Cookie **HttpOnly** (invisible a JS → inmune a robo por XSS), **Secure** (solo TLS, ya hay edge
TLS), **SameSite=Strict** (mitiga CSRF en navegación cross-site). Como las mutaciones usan métodos
no-GET con `Content-Type: application/json`, se añade **guard CSRF** (doble-submit token o
verificación de `Origin`/`Sec-Fetch-Site`) para POST/PUT/DELETE. No se expone el token a JS
(descarta bearer visible / opción D).

## T. x-user-id migration contract

Clasificación de usos: **PRODUCTIVE_BROWSER** (dataService, AuthContext), **TRUSTED_INTERNAL**
(ninguno hoy — la máquina usa admin_secret), **TEST_ONLY** (suites que fijan x-user-id),
**LEGACY_COMPAT** (transición). Fases:
- **A**: sesión firmada aceptada; `x-user-id` aún observado (dual-auth).
- **B**: el navegador deja de enviar `x-user-id`; sesión firmada autoritativa.
- **C**: `x-user-id` rechazado de requests externas no confiables.
- **D**: compat explícita solo para tests/internos (allowlist).

## U. Dual-auth safety

Con sesión firmada presente, **el sujeto firmado es autoritativo**. Si además llega `x-user-id`
y `x-user-id !== token.sub` → **DENY 401 + `auth_session_subject_mismatch_total`**. Nunca elegir
uno en silencio; `x-user-id` jamás sobrescribe al sujeto firmado.

## V. M1-B tenant interface

M1-A entrega identidad confiable, **no** resuelve tenant por claim de cliente:
```
req.auth = { userId, sessionId, authenticatedAt, authMethod: 'session'|'admin_secret' }
```
M1-B resolverá server-side (desde autoridad canónica) `roles`, `institution`, `memberships` y el
scoping. **Prohibido** `req.auth.organizationId` desde el token.

## W. Admin/role interface

1 admin global / 23 mediadores / 223 lectores. M1-A produce identidad confiable y **cierra la
rama B insegura** (afirmar id admin ya no basta: requiere sesión firmada de ese usuario con rol
admin resuelto server-side). **No** implementa scoping institucional ni convierte mediadores en
admins — eso es M1-B.

## X. Failure semantics

| Caso | Código |
|---|---|
| sin sesión (ruta protegida) | 401 |
| firma inválida / malformado / expirado / revocado (cv mismatch) | 401 |
| usuario disabled o desconocido | 401 |
| `x-user-id` != sujeto firmado | 401 + telemetría |
| autenticado pero sin permiso de recurso (M1-B) | 403 |

Sin filtrar causa interna al cliente (mensaje genérico).

## Y. Telemetry

`auth_session_success_total`, `auth_session_failure_total{reason}`,
`auth_session_legacy_x_user_id_total`, `auth_session_subject_mismatch_total`,
`auth_session_revoked_total`. **Sin userId como label.** Nunca loguear cookie/token/clave.
Los request-logs pueden seguir incluyendo el userId actual (política vigente).

## Z. Security test matrix

valid→200; missing/tampered/expired/revoked/disabled/unknown→401; role-change→nuevo rol
server-side efectivo sin re-login; membership-change→estado server-side efectivo; `sub A + x-user-id B`→deny;
sintético disabled→401; real→200; sesión admin→autoridad admin correcta; lector NO se vuelve admin
por header; **cross-instance api_1==api_2 mismo resultado**; `credential_version++`→sesiones previas 401.

## AA. Backward compatibility

Congelar comportamiento no-auth de groups/users/progress/content/Aula Viva tras el cambio de
identidad. El payload de login cambia (setea cookie; el body puede conservar `user`). Los tests
que dependen de x-user-id como **contrato de producto** se reclasifican a **mecanismo de test**
(allowlist fase D); ningún test debe consagrar la autoafirmación insegura.

## AB. Data model (tabla opcional `sessions`)

```
session_id TEXT PK        -- jti
user_id    TEXT NOT NULL
created_at TEXT NOT NULL
expires_at TEXT NOT NULL
revoked_at TEXT           -- null = viva
credential_version INTEGER NOT NULL
-- índices: (user_id), (expires_at) para limpieza
```
Sin `last_seen`/tracking innecesario. TTL cleanup por `expires_at`. Solo si se adopta revocación
por-sesión; el caso base (cv canónico) no la necesita.

## AC. Backup policy

**BACKUP_REQUIRED=false.** Las sesiones son revocables y reconstruibles (sesión perdida = re-login);
convertirlas en dato recovery-critical sería contraproducente. **No** se añade a los 25 stores del
backup 01B. El `session_signing_key` sí se respalda por el canal de secretos (fuera de restic-data),
igual que admin_secret.

## AD. Rollback

- **code rollback**: imagen anterior (mismo patrón deploy neutral).
- **config rollback**: la clave/flag de enforcement.
- **compat window**: fase A/B con dual-auth permite revertir a "x-user-id observado" sin reabrir
  autoafirmación **si el enforcement ya está activo** → un rollback que reintroduzca x-user-id
  externo autoritativo **exige `--acknowledge-security-risk`** (reabre el blocker M1 conocido).
- **key rollback**: doble-clave con grace.

## AE. Implementation unit — CHP-IDDB-M1-A-SESSION-IDENTITY-01 (una sola unidad)

Coherente como unidad única: (1) emisión de sesión firmada en login + endpoint logout;
(2) middleware de verificación (`resolveSession`) que puebla `req.auth`, con `credential_version`
y active recheck; (3) guard de conflicto x-user-id≠sub; (4) cierre del gap active de
`requireProgressOwner`; (5) integración frontend (AuthContext/dataService: cookie en vez de header);
(6) telemetría; (7) CSRF guard; (8) tabla `sessions` opcional; (9) suite Z; (10) plan de canary.
**No se parte** salvo que el frontend requiera su propia ventana de release (posible split
front/back, decidir en la unidad 01).

## AF. Deploy strategy (futura, no ejecutar)

1. deploy neutral: código de sesión desplegado, enforcement **off**, `x-user-id` sigue autoritativo;
2. login emite sesión firmada; ambas aceptadas (dual-auth, sujeto firmado gana si presente);
3. verificar que el frontend envía la sesión (telemetría `legacy_x_user_id` cae);
4. **canary de enforcement en api_2** (rechazar x-user-id externo cuando hay sesión), api_1 control;
5. enforcement global; x-user-id externo rechazado;
6. cierre; x-user-id queda solo como mecanismo de test (allowlist).

## AG. Groups-canary non-interference

Esta unidad no hizo: recreate de API, cambio de flags, requests a `/api/groups`, build, ni update
de ref productiva. Verificación final no intrusiva: **api_2 sigue `READ=sqlite`+`DOMAINS=groups`,
ambos healthy, restarts=0 → GROUP_CANARY_STATE=RUNNING (no cerrado).**

## AH. M1 impact

M1-A cierra **SESSION_IDENTITY: RED → GREEN** y de paso el gap active de progreso. **Habilita**
M1-B (tenant-authz) al entregar identidad confiable. **No cierra por sí solo** aislamiento tenant,
gobernanza de membership ni los IDOR de lectura cross-tenant (siguen a M1-B). Sin porcentaje inflado:
M1-A es un gate crítico de 3 puntos; su cierre sube el overall pero deja M1-B y M1-C pendientes.

## AJ. Exact next step

Ejecutar **CHP-IDDB-M1-A-SESSION-IDENTITY-01** (implementación) — pero **no antes** de cerrar o
resolver el canary GROUPS en curso (evitar dos cambios de identidad solapados en observación).
Orden global: [canary GROUPS close] → **M1-A** → M1-B → M1-C (access/users canaries) → M1-D closeout.
