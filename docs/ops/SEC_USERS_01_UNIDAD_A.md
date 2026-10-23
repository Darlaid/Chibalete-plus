# SEC-USERS-01 · Unidad A — Reinvitación y desactivación seguras

**Fecha:** 2026-10-23 · **Base:** `d1b837b` · **Modo:** implementación local, pruebas y CI. **Sin despliegue.**
**Alcance:** mecanismo de gestión de credenciales. Las ocho cuentas heredadas en texto plano **no se tocan** (Unidad B).

## A. Auditoría del mecanismo previo

| Punto | Antes | Riesgo |
|---|---|---|
| Modo de sesión productivo | `SESSION_AUTH_MODE=enforce` en `api_1` y `api_2`, sin `SESSION_LEGACY_ALLOW` (verificado en solo lectura) | — |
| Restablecer contraseña de una cuenta existente | Sin interfaz: el campo de contraseña de Admin → Usuarios solo aparecía al **crear** | No había forma segura de sanear cuentas |
| Desactivar | Sin interfaz; solo con un `PUT` manual de `accountStatus` | Ídem |
| `invite-user` / `resend-invite` | Solo con secreto de máquina (`requireAuth` en no-GET) y solo para cuentas `invited` | No servían para cuentas activas |
| `PUT /api/users/:id` | Sin política. Aceptaba la predeterminada `chibalete123` y cualquier valor `$2…` como hash ya hecho. Un `password: ''` sobrescribía el hash. El body podía fijar `inviteToken`/`credentialVersion` | Credenciales débiles o elegidas por el cliente |
| `POST /api/users`, `accept-invite`, `reset-confirm` | `hashPasswordIfNeeded` dejaba pasar `$2…` tal cual; la UI y `dataService` rellenaban `chibalete123` | Ídem |
| Login de un registro sin `id` | Comparaba la contraseña y, si coincidía, escribía `lastLoginAt` y convertía a bcrypt. La sesión (`sub = id`) quedaba inutilizable | Escritura sobre un registro que nadie puede gestionar |
| Revocación | Correcta: `credentialVersion++` + `revokeAllUserSessions`; `verifyRequestSession` rechaza cuentas no activas | — |
| Logs / auditoría | El logger redacta `req.body.password` y `req.body.token`; la auditoría de `update_user` excluye `password` | — |
| `identity.db` | `credential_excluded` en todas las filas; no replica contraseñas | — |

## B. Implementación mínima

| Archivo | Cambio |
|---|---|
| `server/lib/passwordPolicy.js` (nuevo) | `checkNewPassword()` rechaza predeterminadas conocidas, valores con formato bcrypt y la contraseña igual al email o a su parte local; `hashNewPassword()` siempre genera bcrypt (coste 10) en el servidor. No añade longitudes nuevas: cada ruta conserva la suya |
| `server/server.js` | Política en `POST /api/users`, `PUT /api/users/:id`, `accept-invite` y `reset-confirm`. `PUT` ignora `password` vacío o nulo. Creación y edición descartan `inviteToken`, `inviteExpiresAt`, `resetToken`, `resetExpiresAt` y `credentialVersion` del body. Login: un registro sin `id` → 401 genérico **antes** de comparar ni escribir. Nuevas `POST /api/users/:id/reinvite` y `POST /api/users/:id/disable` (`requireAdminAccess`) |
| `services/dataService.ts` | `reinviteUser()` / `disableUser()`. El enlace se devuelve al caller y no entra en `this.users`, `saveState` ni almacenamiento local. Se retiran los rellenos `|| 'chibalete123'` |
| `pages/AdminUsuarios.tsx` | Dos acciones en el modal de edición, con confirmación. El enlace de activación vive solo en el estado del componente, se muestra una vez y se descarta al cerrar el modal. La creación ya no precarga una contraseña y exige la inicial |
| `package.json`, `.github/workflows/identity-preflight.yml` | Script `test:credential-reset` y paso bloqueante en el job |

**Reinvitar:** elimina el hash, pone la cuenta en `invited` con un token de 32 bytes (48 h), incrementa `credentialVersion` y revoca las sesiones. El titular elige su contraseña en `ActivarCuenta` (`/api/accept-invite`, que consume el token). La respuesta es `no-store` y el token solo aparece dentro de `activationUrl`.
**Desactivar:** `accountStatus = 'disabled'`; credencial y tokens pendientes eliminados; sesiones revocadas. Solo se revierte con una nueva reinvitación de un administrador.
Ambas preservan `id`, roles, grupos, progreso y reglas de acceso, añaden `accountStatusChangedAt` y registran `reinvite_user` / `disable_user` en auditoría sin secretos. Un administrador no puede aplicarlas sobre su propia cuenta desde su sesión (409).

## C. Pruebas de identidad y seguridad

- `passwordPolicy.test.mjs` — 21/0 (unitaria, cualquier plataforma).
- `userCredentialReset.test.mjs` — 66/0. Servidor real en `enforce` con stores temporales (POSIX; ejecutado en `node:20-bookworm`). Cubre los 12 requisitos:
  - solo administración (401/403/409/404);
  - desactivación con sesión previa rechazada y registro, grupo y regla intactos;
  - reinvitación con contraseña y sesión anteriores invalidadas;
  - token de un solo uso, caducado → 410, y una reinvitación nueva invalida el token anterior;
  - activación vía `accept-invite` y login con la contraseña nueva;
  - hash solo del servidor;
  - predeterminadas y bcrypt rechazados en creación, activación y `PUT`, sin consumir el token;
  - sin secretos en `GET /api/users`, auditoría ni log del servidor;
  - registro sin id: 401 y sin escritura;
  - progreso previo disponible tras recuperar la cuenta;
  - sin regresión en creación, login legacy (texto plano → bcrypt), edición ordinaria (no toca hash ni sesión) y login de mediador y lector;
  - tres escrituras concurrentes sin pérdida y store compatible.
- `AdminUsuariosCredentialActions.structural.test.mjs` — 17/0.

## D. Regresiones y CI

Comparación baseline `d1b837b` contra Unidad A en `node:20-bookworm`, `npm ci` limpio y en secuencia: **mismo código de salida en las 55 suites**. Entre ellas:
- typecheck y build;
- `test:identity-preflight` (3207 ✓ en ambos);
- session-browser, auth-reset, memberships, b2c, royalties, content-rmw, store, metric-contract, mook, evidence, image-integrity, explicit-access, reading-runtime y a11y-reader;
- 26 suites de admin-secret, Aula Viva, authz, eventos, membresías, login y sesión.

Fallos previos con aserciones idénticas en los dos árboles:
- `test:analytics` (7);
- `test:library` dentro de `identity-preflight` (aserción no-store desactualizada);
- `verify:immersive` (cabecera x-user-id);
- `realStoreGuard`: la copia del contenedor no tiene `data/`.

## E. Despliegue y rollback (no ejecutado)

1. **Backend primero.** Las rutas nuevas deben existir antes que los botones.
   - Swap atómico del bind mount de `server/` según `deployment_guide.md`.
   - Reinicio escalonado: `api_1`; validar health, login de administrador y `POST /api/users/<id-de-prueba>/reinvite` sobre una cuenta sintética creada para ello; leer los logs de `api_1`; después `api_2`, en un paso separado.
   - No hay cambios en `package.json` de dependencias ni en Dockerfiles.
2. **Frontend.** Build de imagen con Docker Desktop, recreate de `chibalete_front` y reload del edge.
3. **Compatibilidad:**
   - Front antiguo con backend nuevo: crear con la predeterminada devuelve 400 con mensaje. Por eso el frontend va justo después del backend.
   - Front nuevo con backend antiguo: los botones devuelven 404.
   - Datos: `invited`, `disabled` y `accountStatusChangedAt` ya los entiende el código anterior.
4. **Rollback:**
   - Backend: volver al bind mount previo y reiniciar escalonado.
   - Frontend: tag de imagen anterior.
   - Datos: no requiere migración inversa; las cuentas reinvitadas o desactivadas siguen siendo válidas para el código anterior.

## F. Riesgos pendientes

- Las ocho cuentas heredadas siguen con contraseña legible hasta la Unidad B. Necesitan este mecanismo desplegado y la decisión cuenta por cuenta.
- El enlace de activación lo entrega el administrador por un canal seguro fuera de la plataforma; no hay correo saliente.
- El token de invitación se guarda en `users_db.json`, como en el flujo de invitación existente. No se introdujo un almacén paralelo.
- `invite-user` y `resend-invite` siguen limitadas al secreto de máquina (sin cambios).
- No se impide desactivar al último administrador distinto del actor.
