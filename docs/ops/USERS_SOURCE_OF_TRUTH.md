# Fuente de verdad de usuarios — Chibalete+

**Establecido en:** cierre de SEC-USERS-01 (2026-10-23). **Producción:** `secusers-a-2ec37f7`.

## 1. Cuál es el padrón

| Archivo (host → contenedor) | Rol | ¿Lo usa el servidor? |
|---|---|---|
| `/var/www/chibalete/data-critical/usuarios_colegios_oro.json` → `/app/data-critical/usuarios_colegios_oro.json` | **Padrón canónico.** Login, sesiones, Admin → Usuarios, invitaciones, reinvitar/desactivar, autorización | **Sí: es la única fuente** |
| `/var/www/chibalete/data/users_db.json` → `/app/data/users_db.json` | **Copia histórica** `LEGACY_NON_CANONICAL` (STAT-03 / SEC-03). Casi disjunta del canónico | **No.** Ninguna ruta de runtime la lee ni la escribe |

Garantías en el código (`server/config.js`):
- `resolveUsersDb()` con `NODE_ENV=production` solo acepta `USERS_DB = /app/data-critical/usuarios_colegios_oro.json`. Si apunta a la copia histórica (`production_legacy_forbidden`) o a cualquier otra ruta (`production_path_not_container_canonical`), **el arranque aborta**.
- En desarrollo solo se admite el canónico del repo. En test solo se admiten fixtures temporales; la copia histórica y los stores reales están prohibidos.
- `USERS_DB_LEGACY_NON_CANONICAL` existe solo para que tests y documentación puedan nombrar el archivo: `DO NOT DELETE — DO NOT WRITE — DO NOT READ AT RUNTIME`.

Otros almacenes: grupos `data/groups_db.json` (por defecto en `server/config.js`), reglas `data/access_db.json`, progreso `progress.db`, sesiones `sessions/sessions.db`. `identity.db` es un espejo **sin credenciales** (`credential_excluded` en todas las filas).

Ningún script operativo escribe en la copia histórica:
- `seed-local-admin` escribe en el padrón resuelto (canónico) y solo en local;
- `snapshotCore`, `stores.py` (respaldo) y las auditorías `perf/shadow` solo la leen o la copian para conservarla.

## 2. Cómo verificar qué almacén usa una réplica (sin exponer nada)

```bash
# Ruta efectiva (es una ruta, no un secreto)
ssh root@VPS 'docker exec chibalete_api_1 printenv USERS_DB'
# Línea de arranque que la registra
ssh root@VPS 'docker logs chibalete_api_1 2>&1 | grep -m1 "USERS_DB"'
```

En cualquier script de auditoría que corra dentro del contenedor, lee **siempre** `process.env.USERS_DB`; nunca una ruta escrita a mano. Envía el script por stdin (`docker exec -i <c> node - < script.js`) e imprime solo recuentos, booleanos o ids técnicos: nunca contraseñas, hashes, tokens ni emails personales.

## 3. Advertencia

**No saques conclusiones de seguridad de un archivo que el servidor no usa.** Antes de auditar credenciales, cuentas o roles, confirma la ruta con el paso 2. Una cuenta «insegura» en la copia histórica no puede iniciar sesión, pero sí es un riesgo de **datos en reposo** (ver §6).

## 4. Corrección del diagnóstico anterior (SEC-ROOT-01 y auditoría de SEC-USERS-01)

Esas auditorías leyeron `data/users_db.json`, la copia histórica de 496 registros. De ahí salieron conclusiones que **no** describen producción:

| Se afirmó | Realidad en el padrón canónico (verificado en ambas réplicas) |
|---|---|
| 8 cuentas activas con contraseña en texto plano | **0** contraseñas legibles: las 649 cuentas reales usan bcrypt |
| Cuenta principal = `admin-super-1` | Cuenta principal = `user-1774362611303` (`admin@chibaleteeditores.com`) |
| 4 cuentas administrativas activas | **1** cuenta administrativa activa real: la principal |
| Ningún admin tenía `lastLoginAt` | Artefacto de la copia histórica, cuyo esquema no tiene ese campo |
| La cuenta admin ya no acepta la contraseña histórica | **Se mantiene**, ahora verificado sobre el canónico (bcrypt compare dentro del contenedor, valor por stdin): la principal no la acepta y ninguna otra cuenta la usa |

La protección de la cuenta principal (`server/lib/protectedAccounts.js`) no se ve afectada: identifica la cuenta por **email**, no por id.

## 5. Estado de SEC-USERS-01

- **Unidad A / A-PROD:** en producción (`docs/ops/SEC_USERS_01_A_PROD_EVIDENCE.md`).
- **Unidad B — CANCELADA.** Estaba diseñada para desactivar o reinvitar ocho cuentas productivas con contraseña legible, pero esas cuentas no existen en el padrón canónico. No se ejecuta.
- **Cuentas sintéticas del despliegue:** 9 cuentas `@smoke.chibaleteplus.invalid` con `_loadtest_marker=sec-users-01-a-prod`. Están desactivadas y sin credencial; se conservan.

## 6. Deuda registrada (sin ejecutar)

1. **Contraseñas legibles en copias históricas.** `data/users_db.json` (8 en texto plano y el resto en bcrypt de un padrón antiguo) está en el host y entra en los respaldos estructurados. También hay copias locales ignoradas por git y aparece en el historial de GitHub (`f7f0c5c`). No da acceso, pero expone datos en reposo. Tratarlo en una unidad propia (cifrar, archivar o redactar con decisión explícita), coordinada con el Lote F.
2. **`sessions.db` fuera del respaldo estructurado.** En A-PROD se hizo una copia consistente manual.
3. **Documentación de despliegue desactualizada.** `deployment_guide.md` y la sección de deployment de `CLAUDE.md` describen un swap de bind mount de `server/`; producción despliega el backend por imagen (ver §H de `SEC_USERS_01_UNIDAD_A.md`).
4. **Disco al 95 %** (6,4 GB libres; unos 39 GB de imágenes recuperables). Limpieza solo con autorización.

## 7. Guía de smoke manual (navegador, sin tocar cuentas reales)

Usa tu sesión habitual de `admin@chibaleteeditores.com`. **No** reinvites ni desactives ninguna cuenta real.

Admin → Usuarios solo lista las cuentas del **colegio seleccionado**. Las 9 sintéticas del despliegue no tienen colegio y no aparecen. Por eso la prueba se hace en el colegio **`loadtest`**, que solo contiene cuentas sintéticas (400, `__loadtest__`, 0 reales), con una cuenta desechable creada desde la propia interfaz. No uses ninguna de las 400 cuentas de carga: reinvitarlas les quitaría la credencial que usan las pruebas de carga.

**Creación (prueba también la política)**
1. Selecciona el colegio `loadtest`. Pulsa **Nuevo Usuario**: la contraseña **no** viene precargada. Guardar sin ella → «La contraseña inicial es obligatoria».
2. Rellena con nombre `SMOKE manual SEC-USERS-01`, email `smoke-manual-secusers@smoke.chibaleteplus.invalid` y rol mediador. Prueba `chibalete123` → error «Esa contraseña es predeterminada o demasiado común». Después usa una contraseña única desechable y crea la cuenta.

**Reinvitar**
3. Abre la cuenta recién creada. El modal muestra «Acceso de la cuenta: active» y los botones **Reinvitar usuario** y **Desactivar usuario**.
4. Pulsa **Reinvitar usuario** y acepta la confirmación. Deben aparecer el mensaje «Cuenta reinvitada…», el **enlace de activación** (con el aviso «se muestra solo ahora; caduca en 48 h») y el botón **Copiar**. El estado pasa a `invited`.
5. Copia el enlace y **cierra el modal**. Al reabrirlo, el enlace **ya no aparece**.

**Activación (ventana privada)**

6. Abre el enlace. En `ActivarCuenta`, prueba `chibalete123`: debe rechazarla con «Esa contraseña es predeterminada o demasiado común», y el formulario sigue disponible para reintentar.
7. Fija otra contraseña desechable (mínimo 8). Después inicia sesión con esa cuenta: entra como mediador. Deja la ventana privada abierta.

**Desactivar**

8. En Admin → Usuarios, abre de nuevo la cuenta y pulsa **Desactivar usuario**, con confirmación. El mensaje es «Cuenta desactivada…» y el estado `disabled`. En la ventana privada, recargar o navegar debe pedir login de nuevo, y el login con esa contraseña falla. Esa cuenta queda desactivada en `loadtest`: no la borres.

**Recorridos normales** (con tus cuentas habituales de smoke, como en despliegues anteriores)

9. **Mediador:** login, Inicio, Biblioteca, abrir una lectura, Aula Viva y su grupo. Logout.
10. **Lector:** login, Inicio, Biblioteca, abrir una lectura (PDF o Guiado) y comprobar que conserva el progreso. Logout.

Nota: la cuenta de los pasos 1–8 no lleva `_loadtest_marker`, porque la interfaz no permite fijarlo. Vive en un colegio 100 % sintético y queda desactivada.

**Qué reportar:** cualquier paso que no coincida, el mensaje exacto y la hora. No hace falta probar la protección de la cuenta principal desde la interfaz: está verificada por API en ambas réplicas (5 intentos → 409 sin cambios).
