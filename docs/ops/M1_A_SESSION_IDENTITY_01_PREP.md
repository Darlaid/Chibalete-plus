# M1_A_SESSION_IDENTITY_01_PREP — sesión firmada + store de revocación (implementación)

Unidad: **CHP-IDDB-M1-A-SESSION-IDENTITY-01-PREP** (2026-08-15). Implementación
OFFLINE completa y probada; **sin desplegar**. Cierra el diseño de 00/00-R1.
Rama: `chp/m1-a-session-identity-01` (desde `cf36852`). Commit: `0c84ecd`.
Canary GROUPS intacto durante todo el trabajo.

## Arquitectura desplegable

`SIGNED_HTTPONLY_COOKIE_PLUS_REVOCATION_STORE`. Token HMAC-SHA256 con `crypto`
nativo (sin dependencia JWT), en cookie **HttpOnly; Secure(prod); SameSite=Strict;
Path=/**. Claims mínimos `{sub, sid, iat, exp, cv}`; roles/institución/memberships
se resuelven server-side. Modos (`SESSION_AUTH_MODE`):
- **off** (default): sin emisión ni verificación → comportamiento actual (x-user-id) **byte-idéntico**.
- **compat**: login emite cookie; sesión autoritativa si presente; x-user-id legacy aún aceptado; `sub != x-user-id` ⇒ deny.
- **enforce**: sesión requerida; x-user-id externo rechazado (allowlist interna explícita vía `SESSION_LEGACY_ALLOW=1`).

## Módulos nuevos

- `server/db/sessionsDb.js` — SQLite **dedicada** (`SESSIONS_DB`, junto a `IDENTITY_DB` en el mount persistente compartido; WAL/busy_timeout probados). Lazy: no abre nada en modo off.
- `server/db/sessionStore.js` — persist/getState/revoke/revokeAll/cleanup. Persiste **SHA-256(sid)**, nunca el token.
- `server/lib/sessionToken.js` — sign/verify HMAC, base64url, comparación timing-safe, multi-clave.
- `server/lib/sessionSigningKey.js` — claves **file-only 0400** (current + previous), modelo endurecido de `admin_secret`.
- `server/lib/sessionAuth.js` — servicio central: `issueSession`, `verifyRequestSession`, `authenticate` (modos), `credentialVersion` helpers, `csrfCheck`, cookie opts. Autoridad de revocación = **padrón físico** (sin lag del espejo).

## Cadena de autoridad (por request)

`cookie → verificación de firma (current|previous) → sid en sessions.db (revoked?/expired?) → lookup canónico FÍSICO → isUserActive → credentialVersion match → req.auth = {userId, sessionId, authenticatedAt, authMethod}`. Nunca rol/tenant desde cookie; nunca override por x-user-id. **Fail-closed**: sessions.db o clave no disponibles ⇒ 401/503, jamás x-user-id.

## Integración en server.js

- Login válido → `issueSessionCookie` (no-op en off). Respuesta sigue `{success, user}`.
- Envoltorios session-aware de `requireAdminAccess` / `requireAuth` / `allowAuthenticatedGetOrReject` (delegan a los legacy en off; admin humano por **rol resuelto server-side**, no por header). `x-admin-secret` file-only se conserva como autoridad de máquina.
- `requireUserAuth` resuelve por sesión en compat/enforce.
- **Gap active cerrado**: `requireProgressOwner` ahora rechaza cuenta deshabilitada (antes solo comprobaba existencia) — incondicional.
- Endpoints: `POST /api/auth/logout` (revoca sid + borra cookie), `POST /api/auth/logout-all` (`credentialVersion++` + revoca filas). `GET /api/auth/me` sirve de bootstrap por cookie.
- `credentialVersion++` en: disable (PUT users active→no-active), cambio de password (PUT users), reset de password — con revocación de sesiones vivas.
- Guard **CSRF** global para métodos mutantes autenticados por cookie (no-op en off / sin cookie / máquina): `Sec-Fetch-Site` ∈ {same-origin,same-site,none} ó `Origin` en allowlist (`SESSION_ALLOWED_ORIGINS` → fallback `ALLOWED_ORIGINS`). CORS es la capa externa que ya corta orígenes ajenos.

## credentialVersion

Campo en el padrón JSON (camelCase). **Ausente ⇒ 0** (`credentialVersionOf`). No es credencial (fuera de `CREDENTIAL_FIELDS`). Incremento atómico bajo `withUsersLock`. Preservado por `normalizeUser` (spread) y los writers RMW.

## Store de sesiones y backup

`sessions.db` SQLite dedicada. **BACKUP_REQUIRED=false**: efímera y reconstruible; su pérdida ⇒ fail-closed ⇒ re-login (preferible a restaurar sesiones revocadas). NO se añade a los 25 stores. La signing key va por el canal de secretos (no restic-data).

## Frontend

`context/AuthContext.tsx`: bootstrap rehidrata por **cookie** (`/api/auth/me`) cuando no hay id local (la cookie es autoridad; el id local pasa a informativo); logout llama `serverLogout()`. `services/dataService.ts`: `fetchSessionMe()` y `serverLogout()` (`credentials: same-origin`). Same-origin ⇒ la cookie viaja automáticamente; el x-user-id que aún se envía coincide con el sujeto de sesión y es aceptado en todos los modos (su retirada externa es hardening de la fase de deploy, no requisito de función).

## Telemetría

`auth_session_success_total{auth_method}`, `auth_session_failure_total{reason}`,
`auth_session_legacy_x_user_id_total{source_class}`, `auth_session_subject_mismatch_total`,
`auth_session_revoked_total{kind}`. Cardinalidad fija, **sin userId como label**; nunca token/cookie/clave en logs.

## Evidencia de tests

- **42/42** unit (`sessionIdentity.test.mjs`): token (firma/tamper/exp/multi-clave), store (revoke/expire/revoke-all/cleanup), cv helpers, CSRF, y los 3 modos con mismatch/revocación/active/cv.
- **34/34** integración (`sessionIdentityIntegration.test.mjs`, POSIX-only, server real ×2 con clave 0400 + sessions.db compartida): login emite cookie HttpOnly/SameSite; `/auth/me`; cookie manipulada/expirada/robada→401; subject_mismatch→401; **two-instance** (cookie de api_1 vale en api_2; logout en api_2 revoca en api_1); logout-all/disable/reset invalidan; CSRF (sin señales→403, allowed→ok, ajeno→CORS); **active gap** (progreso de cuenta deshabilitada→401); RMW cv (647→647, credenciales intactas); enforce (x-user-id externo→401, cookie→200); **fail-closed** (sessions.db inaccesible→no-2xx, nunca x-user-id).
- No-regresión en **modo off**: memberships 51, identity chain (GAP1 53 / GAP3 41 / GAP2 50 / M1 fixture 19 / shadowCompare 95), typecheck y build GREEN. `lint:evidence` 0 violaciones.

## Deploy phases (congeladas, NO ejecutar)

- **A**: desplegar imagen con `sessions.db` schema + migración lazy de `credentialVersion`; `SESSION_AUTH_MODE=off` (dormant, comportamiento actual).
- **B**: `compat` — login emite cookie; verificación activa; x-user-id aún aceptado (dual-auth). Instalar `session_signing_key` 0400 en el mount de secretos.
- **C**: frontend con bootstrap/logout por cookie (ya implementado).
- **Observación**: `auth_session_legacy_x_user_id_total{browser}` → 0.
- **D**: `enforce` **canary en api_2** (rechazo de x-user-id externo), api_1 control.
- **E**: `enforce` en ambas.
- **CLOSE**: x-user-id externo rechazado. **No solapar con el canary GROUPS.**

## Rollback

- **Antes de enforce**: rollback de código/imagen vuelve a compat sin reabrir autoafirmación.
- **Tras enforce**: `enforce → compat` solo por incidente, registrando evento de seguridad; un rollback que reabra x-user-id externo autoritativo exige `--acknowledge-security-risk`.
- **Clave**: doble clave con gracia = vida máx. de sesión (12 h).

## Prerrequisitos de producción (para la unidad de deploy)

1. Cerrar/resolver el canary GROUPS (no solapar dos cambios de identidad en observación).
2. Generar e instalar `session_signing_key` (≥32 bytes, 0400 root, bind-mount en ambas API).
3. Montar `SESSIONS_DB` en el volumen persistente compartido.
4. Configurar `SESSION_ALLOWED_ORIGINS` (o reutilizar `ALLOWED_ORIGINS`).
5. CI delta gate GREEN sobre el árbol exacto.

## M1 impact

Cierra **SESSION_IDENTITY: RED → GREEN** y el gap active de progreso. Entrega
`req.auth.userId` confiable para **M1-B** (tenant/authz). No cierra por sí solo
aislamiento tenant ni los IDOR de lectura cross-tenant.
