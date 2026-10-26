# CHP-EDITORIAL-ROYALTIES-2026-01 — F1-B / EDITORIALES-03

## Verificación funcional en navegador y preparación del despliegue

**Fecha:** 2026-10-26 · **Rama:** `chp/epub-mainfile-r1-release` · **Base:** `7c3db5a` → **HEAD candidato:** `beb11e4`
**Alcance:** laboratorio aislado y comprobaciones de producción **solo lectura**. Sin despliegue, sin editoriales productivas, sin activación económica, sin tocar `data/`, `data-critical/`, uploads, Studio Editor BI ni Docker (sin limpiezas).

**Veredicto:** **GO técnico** para desplegar `beb11e4`, condicionado a la autorización expresa y al plan de §F. La verificación encontró y corrigió **dos defectos** (§B.3 y §D.2); con `7c3db5a` el veredicto habría sido NO-GO.

---

## A. Baseline y CI

| Commit | Contenido | CI |
|---|---|---|
| `7c3db5a` | base: F1-B + SEC-FRONT-CURL-01 | security ✅ · content-rmw ✅ · identity-preflight ✅ |
| `8ec9b44` | fix: actor de los cambios de editorial con sesión firmada (§B.3) | security ✅ (40346561476) · content-rmw ✅ (40346561498) · identity-preflight ✅ (40346561540) |
| `beb11e4` | test: RY04 de la batería de respaldos cubre la migración 0003 (§D.2) | security ✅ (40350174329) · content-rmw ✅ (40350174254) · backup-capacity ✅ (40350174169); identity-preflight no se dispara con `ops/backup/**` (servidor idéntico a `8ec9b44`) |

SEC-FRONT-CURL-01 GREEN. Imágenes candidatas construidas en local desde `git archive beb11e4` (no enviadas al VPS):

| Imagen | ID | Verificación |
|---|---|---|
| `chibalete/api:editoriales-beb11e4` | `2bb58b4be9f5` | `GIT_SHA=beb11e4`; migraciones 0001–0003; incluye la corrección del actor; sin `data/` ni `data-critical/`; Trivy HIGH/CRITICAL = 0 |
| `chibalete/front:editoriales-beb11e4` | `bf5571175d73` | `curl`/`libcurl` 8.23.0-r0, `brotli-libs` 1.2.1-r0; bundle con `/admin/editoriales`; Trivy HIGH/CRITICAL = 0 |

## B. Pruebas en navegador

**Entorno:** contenedor `chp-f1blab` desde `git archive 7c3db5a` (`npm ci`), API solo dentro del contenedor (`SESSION_AUTH_MODE=enforce`, ingesta económica **off**, todos los stores en `/tmp/chp_f1blab`), Vite publicado solo en `127.0.0.1:5173`. Datos 100 % sintéticos: cuentas `@f1b-lab.test` (administración, mediación, lectura), editoriales «Sintética Alfa/Beta/Gamma (LAB)», 5 libros y 1 guía sintéticos, una versión de derechos liquidable de laboratorio. Chrome real con inicio de sesión por el formulario.

### B.1 Resultados

| # | Prueba | Resultado |
|---|---|---|
| 1 | Abrir `/admin/editoriales` como administración | ✅ título, aviso de trazabilidad, banner «1 libro por regularizar» (el histórico sintético) |
| 2 | Crear editorial (razón social, sellos, correo) | ✅ «Editorial «… Gamma (LAB)» creada», fila nueva |
| 3 | Editar (nombre comercial) | ✅ «Cambios guardados.» |
| 4 | Desactivar / activar | ✅ «Inactiva» con aviso «Sus libros conservan la asociación…»; vuelve a «Activa» |
| 5 | Sin eliminación | ✅ 0 controles de eliminar/borrar en la página (4 «Editar», 4 «Desactivar/Activar») |
| 6 | Libros asociados | ✅ Alfa «4» libros «+1 recursos»; el resto 0 |
| 7 | Catálogo filtrado | ✅ enlace → «Editorial: Sintética Alfa · 5» con «Quitar filtro» |
| 8 | Crear libro con editorial | ✅ portada, PDF y TXT sintéticos + «Sintética Alfa» → ficha `tipo: libro` con la editorial; fila de historial (alta) |
| 9 | Rechazar libro sin editorial | ✅ el navegador bloquea el envío (select `required`, «Selecciona un elemento de la lista»), 0 subidas, 0 POST. Por API con la sesión real: `400 publisher_required` |
| 10 | Editar metadatos sin alterar la editorial | ✅ título cambiado, `publisherId` igual, **0 filas** de historial |
| 11 | Reasignar con confirmación | ✅ sin marcar la casilla: «Confirma expresamente el cambio…», 0 POST; marcada: `Alfa → Beta`, historial + `content_publisher_change`; la bandera no se persiste |
| 12 | Mensaje de elegibilidad | ✅ formulario: «…por sí sola no acredita derechos económicos»; confirmación: «…no traslada derechos ni regalías ya causados»; página: «…no acredita por sí sola derechos económicos ni la condición de beneficiario» |
| 13 | Lector y mediador | ✅ API: 403 en las 4 rutas administrativas, alta, edición y guardado de contenido; catálogo sin NIT, contacto ni `legalName`. UI (cerrar sesión e iniciar por el formulario): sin entrada «Editoriales» en el menú y `/admin/editoriales` redirige a Inicio |
| 14 | Retirada y vacío por API (sesión real) | ✅ `null` y `''` → `400 publisher_removal_forbidden` |

Capturas: `screenshot-1793026685503-0.jpg` (página) y `screenshot-1793026756217-1.jpg` (catálogo filtrado), en el directorio temporal de capturas de Chrome de la sesión.

### B.2 Observaciones menores (no bloqueantes)

- A ~960 px la columna «Acciones» de `/admin/editoriales` exige desplazamiento horizontal (la tabla tiene 7 columnas).
- El nombre accesible del selector «Tipo de titular» se lee como el valor seleccionado.
- **Preexistente, ajeno a F1-B:** si la cookie cambia de usuario sin pasar por el formulario de acceso, el front sigue pintando el usuario de `sessionStorage.chibalete_user_id` (menú de administración visible) aunque el servidor responde 403 a todo. Con el flujo real de cierre e inicio de sesión no ocurre. Autenticación fuera de alcance.

### B.3 Defecto encontrado y corregido: actor `admin-secret`

Con sesión firmada (`enforce`, como en producción) **todos** los cambios de editorial hechos desde el gestor quedaban con `actor = 'admin-secret'` en `content_publisher_history` y en `user_audit`: `POST /api/content` pasa por `requireAdminRole`, que deja la identidad en `req.user`, y `publisherActorOf` solo miraba `req.auth` y `x-user-id`. Las suites lo usaban con `x-user-id` y la autenticación apagada, por eso no lo vieron. Las altas/ediciones de titulares (F1-A, `requireAdminAccess`) sí registraban bien al usuario.

- **Corrección (`8ec9b44`):** `publisherActorOf` añade `req.user?.id` antes de `x-user-id`.
- **Regresión:** `server/royalties/__test__/publisherActorSession.test.mjs` (enforce, login por cookie; POSIX): **rojo en `7c3db5a`** (actor `admin-secret`), **verde con la corrección** 8/8; incluye que un `x-user-id` distinto de la sesión da 401 sin cambios. Registrada en `test:royalties`.
- **Verificado en el laboratorio vivo** tras reiniciar su API: reasignación desde la UI → `actor = LAB-ADM`. Las 3 filas previas del laboratorio conservan `admin-secret` (solo inserciones): **por eso la corrección debe llegar a producción antes de cualquier cambio de editorial**.

## C. Integridad editorial y económica

| Comprobación | Resultado (laboratorio, sesión real) |
|---|---|
| Historial de reasignación | ✅ fila con obra, anterior, nueva, actor y fecha; consultable en `/api/admin/publisher-audit/:id/history` |
| Sin cambio de editorial ⇒ sin fila | ✅ edición de metadatos: 0 filas |
| Versiones de derechos | ✅ idénticas byte a byte antes/después de reasignar; siguen a nombre de la editorial original (matriz incluida) |
| `PUBLISHER_MISMATCH` | ✅ `lab-libro-4`: `eligible: true` → tras reasignar `eligible: false, reasons: [PUBLISHER_MISMATCH]` |
| Sin atribución retroactiva | ✅ ninguna versión nueva ni modificada; ninguna matriz trasladada |
| Fichas no tocadas | ✅ guía y libro histórico idénticos a la instantánea posterior al arranque |
| F3-A1 / F3-A2 / F3-A3 y motor | ✅ `git diff 84d7b30..HEAD` vacío en `economicEpisodes.mjs`, `econEvents.mjs`, `commercialClass.mjs`, `rightsStore.mjs`, `economicTick.mjs`, `useEconomicTick.ts`, migraciones 0001/0002. Ingesta off en el laboratorio |

**Producción (solo lectura, 2026-10-26 ~15:20Z):** `content.json` sha `9faaf68566e5…` (sin cambios desde 2026-10-22T14:10:09, asignación F1-A), **109 registros, 109 con `pub-chibalete-editores`**, 52 libros (43 `libro` + 9 `libro_album`), **0 libros sin editorial**, 57 recursos; `royalties.db` `quick_check ok`, migraciones `0001`, `0002`, titular único activo, **0 versiones de derechos**, `content_publisher_history` aún inexistente.

## D. Validación de la migración `0003`

### D.1 Revisión

- `CREATE TABLE/INDEX/TRIGGER IF NOT EXISTS`: idempotente; una réplica la aplica y la otra la ve aplicada (el runner reintenta ante la carrera, patrón de 0001/0002).
- Solo añade una tabla vacía, un índice y dos triggers; no toca `publishers` ni `rights_versions`; no modifica `content.json`.
- **Rollback de imagen:** el runner recorre las migraciones **de disco** y omite las aplicadas; una versión aplicada que el código no conoce se ignora ⇒ la imagen `selfpw-91634d2` convive con la tabla 0003 (no la lee). No hace falta `DOWN`.
- **Respaldo:** `royalties.db` ya es store CANON por SQLite online backup; la tabla viaja dentro. `stores.py` no cambia.

### D.2 Defecto encontrado y corregido: batería de respaldos

`ops/backup/CHP-BACKUP-01B/tests/test_suite.py` RY04 aplica **todas** las migraciones reales y fijaba la lista a `0001/0002` y 2 triggers ⇒ con 0003 fallaba (**133/134**, verificado). CI no lo vio porque `backup-capacity` solo corre con cambios en `ops/backup/**`. **Corrección (`beb11e4`):** espera las 3 migraciones y 4 triggers y siembra una fila de historial que debe restaurarse idéntica ⇒ **134/134** en Linux (`chibalete-backup-toolchain:local`) y en CI. El runner no cambia.

## E. Backups, espacio y rollback (producción, solo lectura)

| Elemento | Estado |
|---|---|
| Servicios | `chibalete_api_1`/`api_2` `selfpw-91634d2` (`042eb8bf11a2`, `GIT_SHA=91634d2`), `chibalete_front` `selfpw-91634d2` (`368267b53bbf`), todos healthy 2 días; override `aeb983ba6ed5…` (líneas 40/85/130) |
| Flags | `NODE_ENV=production`, `SESSION_AUTH_MODE=enforce`, `UPLOADS_AUTHZ_MODE=strict`, `ACCESS_FALLBACK_MODE=restricted`; `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` ausentes (= off) |
| Respaldos | estructurado cada 6 h; último `structured-20261026T120127Z-6e0c5332` `result ok`, 32 stores, 0 avisos, 0 ausentes: `royalties.db` `integrity ok` (sqlite online backup), `content.json` 109 / sha `9faaf685…` (= vivo), `access_db.json` 22, padrón 670 |
| Recuperabilidad | última restauración aislada verificada = vivo el 2026-10-24 (SEC-ACCOUNT-01, mismo runner); esta unidad **no** ejecutó una nueva (solo lectura): se hará en el despliegue (§F paso 9) |
| Disco | `/` 106 G, **9,5 G libres (92 %)**. Carga prevista ≈ 1,3 G (imágenes 860 M + 102 M y tarballs) ⇒ ~8 G libres tras cargar |
| Rollback | imágenes etiquetadas presentes (`rollback-pre-selfpw`, F3-A2, F2-B…); el cron `docker image prune -f --filter until=24h` sin `-a` solo borra imágenes **sin etiqueta** ⇒ las de rollback no corren riesgo |

## F. Plan exacto de despliegue (NO ejecutado)

Ventana sin actividad editorial: entre el paso 5 y el 8 conviven versiones; **no editar contenidos ni editoriales** hasta cerrar el paso 8 (una edición enrutada a la réplica antigua no aplicaría F1-B ni dejaría historial).

0. **Autorización expresa** y Docker Desktop abierto por la titular.
1. **Preflight (solo lectura):** contenedores healthy con `selfpw-91634d2`; override `aeb983ba…`; flags de §E; ≥ 3 G libres; `content.json` `9faaf685…`, 109/109; `royalties.db` migraciones `[0001, 0002]`, 0 `rights_versions`.
2. **Respaldo PRE** con el runner (`structured_backup.py`); comprobar `result ok`, `royalties.db` `integrity ok` y `content.json` = `9faaf685…`.
3. **Transferencia:** `docker save` de `chibalete/api:editoriales-beb11e4` (`2bb58b4be9f5`) y `chibalete/front:editoriales-beb11e4` (`bf5571175d73`) → gzip → `scp` a `/root/chp-f1b/` → `sha256sum -c` → `docker load` → IDs iguales a los locales.
4. **Rollback preparado:** tags `rollback-pre-f1b` (api `042eb8bf11a2`, front `368267b53bbf`); copia `docker-compose.override.yml.bak-pre-f1b-<ts>`; `/root/chp-f1b/ROLLBACK.txt`.
5. **api_1:** solo la línea 40 → `editoriales-beb11e4`; `docker compose up -d --no-deps api_1`; esperar healthy.
6. **Gate api_1 (paso separado, sin tocar api_2):** log con `[royalties-migrate] applied 0003_content_publisher_history` **una vez**, `[PUBLISHERS] royalties.db ready`, 0 `ERROR`/`FATAL`; `/api/health` y `/api/health/ready` 200; `GIT_SHA=beb11e4`; `_migrations` = 3; `content_publisher_history` = 0 filas; `content.json` sigue en `9faaf685…`; anónimo 401 en `/api/content`, `/api/admin/publishers` y `/api/admin/publisher-audit`.
7. **api_2:** línea 85; `up -d --no-deps api_2`; gate equivalente: migración **no** reaplicada, mismo inodo de `royalties.db`, mismo esquema.
8. **front:** línea 130; recrear `chibalete_front`; recargar `chibalete_edge` (cuidando la trampa del inodo de `nginx.conf`); healthy.
9. **Respaldo POST + restauración aislada** de `royalties.db` y `content.json` en `/root/chp-f1b/restore-*` (contenedor desechable sin red): `integrity ok`, 3 migraciones, historial 0 filas, `content.json` `9faaf685…`.
10. **Smokes (sesiones abiertas por la titular en Chrome; sin escrituras):**
    - Admin: `/admin/editoriales` muestra «Chibalete Editores» con **52** libros **+57** recursos y **sin** banner de regularización; `GET /api/admin/publisher-audit` → `books 52`, `booksWithPublisher 52`, `nonBooks 57`, **`missing []`**, **`unknown []`**; abrir el editor de un libro → «Editorial responsable» con «Chibalete Editores» preseleccionada, sin «Sin editorial asignada»; salir **sin guardar**.
    - Mediador y lector: 403 en `/api/admin/publishers` y `/api/admin/publisher-audit`; `/admin/editoriales` redirige; catálogo y lectura como antes.
    - Invariantes finales: `content.json` `9faaf685…` (109/109 sin cambios), 0 `rights_versions`, `content_publisher_history` 0 filas, `access_db.json` `d4182a1d…`, ingesta y cumplimiento off, 0 errores nuevos en ambas réplicas.
11. **Rollback (si un gate falla):** restaurar el override `.bak-pre-f1b-*`, `up -d --no-deps` api_1 → validar → api_2 → front. La tabla 0003 puede quedarse (la imagen anterior la ignora); no hay datos que revertir porque no se escribe en `content.json`.

No se crea ninguna editorial productiva ni se reasigna nada durante el despliegue.

## G. Riesgos residuales

| Riesgo | Mitigación |
|---|---|
| Ventana de versiones mixtas (pasos 5–8) | congelar ediciones editoriales y de contenido durante la ventana |
| Sin historial previo a F1-B (asignación F1-A 2026-10-22) | documentado en `F1B_EDITORIALES_02.md` §H; `content.json` no ha cambiado desde entonces (sha idéntico) ⇒ la editorial vigente es la del periodo |
| Disco al 92 % | ~8 G libres tras cargar; sin limpiezas en esta unidad; vigilar en el preflight |
| Acciones con `admin-secret` (sin sesión) siguen registrando `admin-secret` | por diseño, como F1-A; los cambios desde la UI registran al usuario |
| `content-rmw` con intermitencia histórica entre réplicas | deuda preexistente; verde en los tres commits de esta serie |
| Observaciones de UX/a11y de §B.2 y comportamiento de `sessionStorage` | no bloqueantes; el servidor es la autoridad (403) |
| Recuperabilidad no re-ensayada hoy | restauración aislada obligatoria en el paso 9 |

## H. Veredicto

**GO técnico** para desplegar `beb11e4` (`chibalete/api:editoriales-beb11e4` + `chibalete/front:editoriales-beb11e4`) con el plan de §F, **pendiente de autorización expresa**. Las 109 fichas productivas y la integridad de derechos quedan preservadas por diseño (no hay escritura de datos en el despliegue) y por prueba (laboratorio y suites). Con `7c3db5a` el veredicto habría sido **NO-GO** por el actor `admin-secret` (§B.3).

**STOP:** no se despliega sin autorización. El laboratorio `chp-f1blab` queda **detenido** (no borrado) con sus datos sintéticos; las imágenes candidatas quedan cargadas en el Docker local.
