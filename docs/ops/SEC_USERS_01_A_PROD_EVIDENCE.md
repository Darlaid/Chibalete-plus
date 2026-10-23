# SEC-USERS-01 · Unidad A-PROD — Evidencia de producción

**Fecha:** 2026-10-23 · **Código:** `2ec37f7` (Unidad A `0523db6` + protección `250be3e`) · **Veredicto:** GREEN

## A. Gate y respaldos

| Control | Resultado |
|---|---|
| HEAD | `2ec37f7`; CI `identity-preflight` y los jobs de seguridad del lote en verde (trivy-image y gitleaks-history: lotes E/F) |
| Imágenes | `chibalete/api:secusers-a-2ec37f7` (`f2a3e5118108`), `chibalete/front:secusers-a-2ec37f7` (`055537dbbdd1`). Tar SHA-256 `9f56b34b…` (api) y `45b2e7f7…` (front), verificados en el VPS; IDs cargados = locales. image-integrity 51/0; gate dentro de la imagen 126/0 |
| Salud previa | `api_1`, `api_2` ready 200, `enforce`; front y edge healthy; público 200 |
| Disco | 94 % (7,1 GB) antes; 95 % (6,4 GB) después. Sin limpieza |
| Respaldo PRE | `structured-20261023T153336Z-523c6fa0` (snapshot `a81f0588`, 32 stores). Restauración aislada: padrón canónico 649 cuentas, todas bcrypt, principal activa; groups/access idénticos al vivo |
| `sessions.db` | Copia consistente con la API de backup de SQLite (origen abierto en solo lectura): `/root/chp-secusers-a/sessions-pre-20261023T155257Z.db`, 0600, `integrity_check ok` |
| Rollback | Tags `rollback-pre-secusers-a` (api `921fd77f`, front `fd45a980`); override `.bak-pre-secusers-a-20261023T153437Z`; `/root/chp-secusers-a/ROLLBACK.txt` |

## B. `api_1` (15:54:39Z)

Solo la línea 40 del override; `docker compose up -d --no-deps api_1`. Healthy, ready 200, `enforce`. Smoke dentro de la réplica, **25/25**, con cuentas sintéticas creadas por la autoridad de máquina:
- política rechaza predeterminada y bcrypt en la creación;
- login real de administrador sintético con sesión firmada;
- `GET /api/users` sin secretos;
- desactivar → la sesión previa cae y el login da 401;
- reinvitar → token de 64 hex, no-store, la contraseña anterior deja de valer;
- `accept-invite` rechaza la predeterminada; activación válida; token de un solo uso;
- login con la nueva y `GET /api/groups` como mediador;
- sobre la principal: disable/reinvite/PUT/DELETE → 409, sin cambios.

Logs desde el recreate: 0 errores; 0 tokens, hashes o predeterminadas; los 16 avisos son los 4xx esperados del smoke.

## C. `api_2` (15:58:36Z)

Solo la línea 85; recreate solo de `api_2`. Healthy, ready 200, `enforce`. Smoke dentro de `api_2`: **27/27**. Incluye la consistencia entre réplicas: una sesión de admin emitida en `api_2` es válida en `api_1`, y una sesión revocada en `api_2` también se rechaza en `api_1`. Logs: 0 errores, 0 secretos.

## D. Frontend (15:59Z)

Solo la línea 130; recreate de `front` y reload de `chibalete_edge`. Los avisos `ssl_stapling` de Studio ya existían. Healthy, público 200. Bundle público (50 assets JS): contiene «Reinvitar usuario», «Desactivar usuario», la ruta `/reinvite` y el aviso de enlace de un solo uso; no contiene `chibalete123`.

## E. Smokes e integridad

- Desde Internet, sin credenciales: health 200; `/auth/me`, disable y PUT → 401; `x-user-id` falsificado → 401; token inexistente → 404; login inválido → 401.
- `SESSION_AUTH_MODE=enforce` en ambas réplicas, sin `SESSION_LEGACY_ALLOW`.
- Cuenta principal `admin@chibaleteeditores.com` = `user-1774362611303`: activa, bcrypt, `credentialVersion` 0, huella sin cambios durante todo el despliegue.
- Datos reales frente a PRE: las 649 cuentas reales son idénticas campo a campo (las 9 de diferencia son las sintéticas); `groups_db.json` y `access_db.json` con el mismo SHA-256. Sin cambios en grupos, reglas ni colegios.
- Cuentas sintéticas (9, `@smoke.chibaleteplus.invalid`, `_loadtest_marker=sec-users-01-a-prod`): desactivadas y sin credencial al terminar. No se han eliminado.
- Respaldo POST: `structured-20261023T160237Z-d842ce3b` (snapshot `0b586c0b`, 32 stores). Restauración aislada: padrón = vivo (`88fa73e0…`), grupos = vivo.

## F. Corrección de premisas (importante)

El padrón canónico de producción es `USERS_DB=/app/data-critical/usuarios_colegios_oro.json`. Las mediciones de SEC-ROOT-01 y de la auditoría de SEC-USERS-01 leyeron `/app/data/users_db.json`, que **no es el padrón vivo**: es una copia antigua (496 registros) que ya no usa el servidor. En el padrón canónico:

- **0 contraseñas en texto plano** (649 reales, todas bcrypt). Las «ocho cuentas heredadas» solo existen como texto plano en esa copia antigua y en sus respaldos.
- La cuenta principal es `user-1774362611303`, no `admin-super-1`. Es la única cuenta administrativa real; las otras tres «administrativas» del inventario anterior no figuran en el padrón vivo.
- La protección no se ve afectada, porque identifica la cuenta por email.

La Unidad B quedó **cancelada** en el cierre (ver `docs/ops/USERS_SOURCE_OF_TRUTH.md`). El riesgo restante de esas ocho contraseñas es **de datos en reposo** (la copia antigua y sus respaldos), no de inicio de sesión.

`deployment_guide.md` y `CLAUDE.md` describen el backend como un swap de bind mount de `server/`. En producción el código viaja en la imagen.

## G. Imágenes productivas

| Componente | Imagen | ID | Línea override |
|---|---|---|---|
| `api_1` | `chibalete/api:secusers-a-2ec37f7` | `f2a3e5118108` | 40 |
| `api_2` | `chibalete/api:secusers-a-2ec37f7` | `f2a3e5118108` | 85 |
| `front` | `chibalete/front:secusers-a-2ec37f7` | `055537dbbdd1` | 130 |

Override final `6557ba3f…` (antes `c7d2e403…`). Rollback: `rollback-pre-secusers-a` por componente o restaurar el `.bak`, y recrear solo el servicio afectado. No hace falta revertir datos.

## Pendiente

Falta un smoke humano en navegador de Admin → Usuarios (botones y enlace de una sola vista) y del recorrido de mediador y lector. Las verificaciones de este despliegue fueron por API y bundle; no se usaron credenciales reales.
