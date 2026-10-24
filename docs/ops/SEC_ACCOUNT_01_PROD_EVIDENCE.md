# SEC-ACCOUNT-01 · PROD — Evidencia de producción

**Fecha:** 2026-10-24 · **Código:** `91634d2` (docs `22e9b45`) · **Veredicto:** GREEN

## A. Gate y respaldos

| Control | Resultado |
|---|---|
| Repo | HEAD `22e9b45` = remoto; árbol limpio |
| CI | `91634d2`: `identity-preflight` verde; `22e9b45`: `security` completo verde salvo `gitleaks-history` (conocido) |
| Imágenes | `chibalete/api:selfpw-91634d2` `042eb8bf11a2`, `chibalete/front:selfpw-91634d2` `368267b53bbf`; `sha256sum -c` correcto en el VPS |
| Salud previa | `api_1`/`api_2` ready 200, `enforce`, sin `SESSION_LEGACY_ALLOW`; front y edge healthy; público 200 |
| Disco | 92 % (9,5 GB libres) antes y después; inodos 30 % |
| Huella PRE | 649 cuentas reales; `groups_db`, `access_db`, `schools_db`, `school_configs`, `content`, `sections` con SHA-256 registrado; principal activa |
| Respaldo PRE | `structured-20261024T015354Z-0475a7be` (snapshot `87af5ac7`). Restauración aislada = vivo (huella de reales y 6 ficheros iguales); 6 SQLite `integrity_check ok` |
| `sessions.db` | Copia con la API de backup de SQLite: `/root/chp-selfpw/sessions-pre-20261024T015449Z.db` (0600, `ok`, 11 filas) |

## B. `api_1` (01:56:19Z)

Solo la línea 40 del override. Healthy, ready 200, `enforce`. Smoke dentro de la red de compose contra `api_1`: **34/34**. Cubre:
- sin sesión, solo `x-user-id` → 401;
- política en la creación;
- login con sesión firmada `Secure` de administrador, mediador y lector sintéticos;
- permisos (lector y mediador → 403) y acceso administrativo sin credenciales en la respuesta;
- validaciones del cambio: actual incorrecta, confirmación, longitud, predeterminada y reutilización;
- cambio propio de los tres roles: 200 `no-store`, cookie borrada, `credentialVersion` +1, bcrypt del servidor, sesión anterior revocada, la anterior → 401, la nueva → 200.

Logs: 0 errores, 0 contraseñas sintéticas, 0 secreto de máquina, 0 hashes.

Incidencias del harness, no del producto:
1. El lector no puede crearse sin grupo (`GROUP_REQUIRED`). Se crea como mediador y se cambia el rol, sin tocar grupos.
2. Un primer smoke completo superó el limitador por IP del endpoint (20 / 15 min) y recibió 429: el control funciona en producción. Se recortó el smoke y se repitió tras la ventana.

## C. `api_2` (02:13:35Z)

Solo la línea 85. Healthy, ready 200, `enforce`. Smoke contra `api_2`: **38/38**, con la consistencia entre réplicas: una sesión emitida en una réplica vale en la otra; un cambio de contraseña en `api_2` revoca las sesiones emitidas en ambas réplicas; la nueva contraseña entra por `api_1`. Logs de ambas réplicas: 0 errores, 0 secretos.

## D. Frontend (02:14:54Z)

Solo la línea 130; recreate de `front`; `nginx -t` correcto en front y edge; reload del edge (los avisos `ssl_stapling` de Studio son preexistentes). El bundle público `Perfil-CrZjlhdv.js` contiene la pestaña condicionada al perfil propio y el panel `PasswordChangeSection` también condicionado. La ruta `auth/change-password` vive en `index-D-ULT0e-.js`. No se usaron credenciales en el navegador de producción; el recorrido de interfaz se validó con las mismas imágenes en el sandbox local.

## E. Pruebas productivas y salud

- Desde Internet: público 200, health 200; `change-password` sin sesión → 401; `x-user-id` falsificado → 401; `/auth/me` sin sesión → 401; login inválido → 401.
- Un único 502 durante la verificación: el edge reutilizó una conexión keepalive que la API ya había cerrado (`recv() ... Connection reset by peer`). La petición no llegó a la API y ninguna réplica se reinició. **Preexistente:** 22 casos iguales en el log del edge entre el 25/09 y el 22/10. La causa es que el keepalive de Node (5 s) es menor que el del pool del edge.
- Estado final: `api_1`/`api_2` healthy, ready 200, `enforce`, 0 reinicios; front y edge healthy; Studio Editor BI sin tocar.

## F. Datos e integridad

- POST frente a PRE: 649 cuentas reales, **0 cambiadas, 0 nuevas, 0 eliminadas** (huella global igual; se excluye `lastLoginAt`). Grupos, reglas de acceso, colegios, configuración de colegios, contenido y secciones con el mismo SHA-256.
- Cuenta principal `admin@chibaleteeditores.com`: activa, administradora, `credentialVersion` sin cambios y el mismo hash. No se modificó.
- Cuentas sintéticas `@smoke.chibaleteplus.invalid` (`_loadtest_marker=sec-account-01-prod`): 12, todas desactivadas y sin credencial; se conservan.
- Respaldo POST `structured-20261024T021859Z-3b0d71a3` (snapshot `ea4d7c20`): restauración aislada = vivo; 6 SQLite `ok`.

## G. Espacio y rollback

- Disco 92 % (9,5 GB). Sin limpieza.
- Override `aeb983ba…` (antes `6557ba3f…`, copia `.bak-pre-selfpw-20261024T015617Z`).
- Rollback por componente: `chibalete/api:rollback-pre-selfpw` (`f2a3e511`), `chibalete/front:rollback-pre-selfpw` (`055537db`); plan en `/root/chp-selfpw/ROLLBACK.txt`. No hace falta revertir datos.

## H. Imágenes productivas

| Componente | Imagen | ID | Línea override |
|---|---|---|---|
| `api_1` | `chibalete/api:selfpw-91634d2` | `042eb8bf11a2` | 40 |
| `api_2` | `chibalete/api:selfpw-91634d2` | `042eb8bf11a2` | 85 |
| `front` | `chibalete/front:selfpw-91634d2` | `368267b53bbf` | 130 |
