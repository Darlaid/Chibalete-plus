# CHP-EDITORIAL-ROYALTIES-2026-01 — F1-B / EDITORIALES-04 · Despliegue en producción

**Fecha:** 2026-10-26 (UTC) · **Código desplegado:** `beb11e4` (HEAD `9c14bac` = `beb11e4` + docs) · **Plan:** `F1B_EDITORIALES_03.md` §F
**Autorización:** desplegar F1-B exclusivamente; sin crear editoriales reales, sin reasignar libros, sin activar la ingesta económica.

**Veredicto (cierre EDITORIALES-05, 2026-10-26 19:53Z):** **YELLOW justificado por un único control**: el rechazo en el servidor (403) con sesión real de mediador y lector no se observó en producción (§F.2, §K). Todo lo demás, incluida la verificación administrativa con sesión, está en GREEN; al observar ese 403 pasa a GREEN_PRODUCTIVO sin cambios en producción. Despliegue, migración, integridad, permisos anónimos, respaldo y restauración: GREEN.

---

## A. Baseline y respaldo previo

| Control | Resultado |
|---|---|
| Repo | HEAD `9c14bac` = origin; `git diff beb11e4..HEAD` = solo docs; árbol limpio |
| CI | `9c14bac`: security ✅, content-rmw ✅; `beb11e4`: security, content-rmw, backup-capacity ✅; `8ec9b44` (mismo servidor): identity-preflight ✅ |
| Docker / VPS | Docker Desktop 29.4.2; SSH por clave |
| Salud previa (16:10Z) | api_1/api_2 `selfpw-91634d2` (`042eb8bf11a2`) ready 200, 0 reinicios; front `368267b53bbf`; edge healthy; público 200 |
| Flags | `SESSION_AUTH_MODE=enforce`; `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` ausentes (= off) |
| Disco | 9,6 G libres (92 %), inodos 30 % |
| Huella PRE (`/root/chp-f1b/snapshot-pre.json`) | `content.json` `9faaf68566e513f0`, **109** registros, **109** con `pub-chibalete-editores`, **52** libros, **0** sin editorial; `royalties.db` `quick_check ok`, migraciones `0001`,`0002`, 1 titular activo, **0** `rights_versions`; `events.db` `ok`, **0** `econ_events`, 0 `econ_tick`; `access_db` `d4182a1d…`, `groups_db` `852c8f20…`, `schools_db` `a0301221…`, padrón `31aae95d…` |
| Respaldo PRE | `structured-20261026T161113Z-13f3c057` (snapshot `ed5d808a`): `result ok`, 32 stores, 0 avisos, 0 ausentes; hashes = vivo |

## B. Imágenes antes y después

| Componente | Antes | Después | Línea override |
|---|---|---|---|
| api_1 | `chibalete/api:selfpw-91634d2` `042eb8bf11a2` | `chibalete/api:editoriales-beb11e4` `2bb58b4be9f5` (`GIT_SHA=beb11e4`) | 40 |
| api_2 | ídem | ídem | 85 |
| front | `chibalete/front:selfpw-91634d2` `368267b53bbf` | `chibalete/front:editoriales-beb11e4` `bf5571175d73` (`curl`/`libcurl` 8.23.0-r0) | 130 |

Transferencia: tarballs gzip (api 152 150 280 B, sha256 `93036fcf…`; front 28 579 831 B, `9319afb2…`) en `/root/chp-f1b/`; `sha256sum -c` OK; `docker load`: IDs idénticos a los locales. Override `aeb983ba…` → `d75810d3…` (solo las líneas 40, 85 y 130).

## C. Resultado por etapa

| Etapa | Hora (UTC) | Gate |
|---|---|---|
| api_1 | 16:13:22 | healthy, 0 reinicios; log: `[royalties-migrate] applied 0003_content_publisher_history` → `[PUBLISHERS] royalties.db ready` → `[ECON] econ_events schema ready (ingest=off)` → `Server running`; 0 errores; anónimo 401 en `/api/content`, `/api/admin/publishers`, `/api/admin/publisher-audit`, `…/history`; `x-user-id` sin sesión 401; huella = PRE salvo 0003 (§D). api_2 (versión previa) siguió healthy y sin errores con la base migrada. **GREEN** |
| api_2 | 16:14:11 | healthy, 0 reinicios; migración **no** reaplicada (0 `applied`); 0 errores; anónimo 401; mismo archivo (inodo 817635) y mismo DDL (`bafc4f90ba07`) en las dos réplicas; huella api_2 = huella api_1. **GREEN** |
| front | 16:15:13 | healthy; `nginx -t` OK en front y edge; reload del edge (avisos `ssl_stapling` de Studio preexistentes); edge healthy. Público 200, health 200; bundle `index-yDspumLu.js` con `/admin/editoriales` y `AdminEditoriales-BNsA6del.js`. **GREEN** |

Ventana de versiones mezcladas: 16:13:22–16:15:13 (≈ 2 min), con ediciones congeladas.

## D. Migración 0003 y auditoría

- Aplicada una sola vez (api_1). `_migrations` = `0001_publishers`, `0002_rights_versions`, `0003_content_publisher_history`.
- `content_publisher_history` creada con **0 filas** (sin registros artificiales) y sus triggers `content_publisher_history_no_update` / `_no_delete`; `rights_versions` y sus triggers intactos.
- `royalties.db` `quick_check ok`.

## E. Integridad de las 109 fichas

- `content.json` **sin escrituras**: sha `9faaf68566e513f0` antes, tras api_1, tras api_2, al final y en el respaldo restaurado; huella id→editorial `33f443b01ccd9847` idéntica.
- 109/109 con `pub-chibalete-editores`; 52 libros (43 `libro` + 9 `libro_album`) con editorial válida; 0 reasignaciones; 0 eliminaciones.
- Censo con el mismo módulo del endpoint (`publisherCompliance`, solo lectura dentro de la réplica): `books 52`, `booksWithPublisher 52`, `nonBooks 57`, **`missing []`**, **`unknown []`**, `byPublisher` = Chibalete Editores 52 libros / 109 contenidos.
- Derechos: 0 versiones. Eventos económicos: 0 `econ_events`, 0 `econ_tick`. `access_db`, `groups_db`, `schools_db` y padrón con los mismos hashes.

## F. Permisos y pruebas productivas

### F.1 Sin sesión (desde Internet) — GREEN

`/api/content`, `/api/admin/publishers`, `?withCounts=1`, `/api/admin/publisher-audit`, `…/x/history` → 401; `x-user-id` falsificado → 401; `POST /api/admin/publishers` anónimo → 401.

### F.2 Con sesión — GREEN salvo el 403 de mediador y lector (EDITORIALES-05)

Sesiones abiertas por Dirección; no se introdujeron credenciales.

| Control | Fuente | Resultado |
|---|---|---|
| `/admin/editoriales` con sesión administrativa | Dirección (Chrome) y verificación propia 19:52Z | Accesible; título «Editoriales — Chibalete+» |
| Chibalete Editores activa, 52 libros + 57 recursos, sin aviso de regularización | Dirección y verificación propia | «52 de 52 libros con editorial responsable válida»; fila «52 · +57 recursos · Activa»; sin banner |
| Formulario de edición y datos administrativos; guardado | Dirección (19:35:12Z) | `PUT /api/admin/publishers/pub-chibalete-editores` 200; `user_audit` `publisher_update` con actor = la cuenta administradora (no `admin-secret`); columnas cambiadas frente al respaldo POST: `contact_email`, `contact_name`, `contact_phone`, `imprints`, `tax_id`, `updated_at`. Estado, razón social y tipo sin cambios. Es completar datos de la editorial existente, no un alta ni una reasignación |
| Opción «Editoriales» ausente del menú de mediación | Dirección (Chrome) | Ausente |
| `GET /api/admin/publisher-audit` con sesión administrativa | Verificación propia 19:52Z | 200, `cache-control: no-store`; `books 52`, `booksWithPublisher 52`, `nonBooks 57`, **`missing []`**, **`unknown []`**, `byPublisher` Chibalete Editores 52/109 |
| Enlace del conteo de libros al catálogo filtrado | Verificación propia | El «52» enlaza a `#/subir-contenido?editorial=pub-chibalete-editores`; el gestor muestra «Editorial: Chibalete Editores · 109» con «Quitar filtro» (el filtro es por editorial y abarca libros y recursos) |
| Editorial preseleccionada al editar un libro, sin guardar | Verificación propia («La metamorfosis», `tipo libro`) | Etiqueta «Editorial responsable», `required`, valor `pub-chibalete-editores`; opciones: marcador deshabilitado «Selecciona una editorial…» + Chibalete Editores; sin «Sin editorial asignada»; sin casilla de reasignación. Se salió sin guardar: 0 `POST /api/content` en ambas réplicas desde 19:40Z y `content.json` `9faaf68566e513f0` |
| 403 en rutas administrativas con sesión de mediador y lector | — | **PENDIENTE.** Dirección inició sesión con ambas cuentas (cambió solo `lastLoginAt`), pero Chrome solo conserva la sesión administrativa y los logs de las API no registran ninguna petición de esas sesiones a `/api/admin/publisher*`. No se sustituye por evidencia sintética; la cobertura automática (`publisherMandatoryHttp`, `publishersHttp`) sigue siendo solo de CI |

## G. Respaldo posterior y restauración aislada — GREEN

- `structured-20261026T161652Z-1ee36b3c` (snapshot `fd2b873e`): `result ok`, 32 stores, 0 avisos; `royalties.db` `ok` (sha `321be1d8…`, cambia por la tabla nueva); `content.json`, `events.db`, `access`, `groups`, `schools`, padrón con los mismos hashes que PRE.
- Restauración de `fd2b873e` en `/root/chp-f1b/restore-post-Au8r/` y verificación en contenedor desechable **sin red**: huella **idéntica** al vivo (catálogo, `royalties.db` con 3 migraciones e historial 0, eventos, almacenes protegidos).

## H. Estado del VPS y rollback

- api_1, api_2, front y edge healthy, 0 reinicios; 0 errores y 0 respuestas 5xx en las API desde el despliegue; 0 5xx de Chibalete+ en el edge; `ECONOMIC_INGEST_MODE=off`, `RIGHTS_ENFORCEMENT_MODE=off`; Studio Editor BI sin tocar.
- Disco 8,8 G libres (92 %). Sin limpiezas.
- Rollback: tags `chibalete/api:rollback-pre-f1b` (`042eb8bf11a2`) y `chibalete/front:rollback-pre-f1b` (`368267b53bbf`); override `docker-compose.override.yml.bak-pre-f1b-20261026T161305Z` (`aeb983ba…`); `/root/chp-f1b/ROLLBACK.txt`. La tabla 0003 puede quedarse (la imagen previa la ignora).
- Evidencias en el VPS: `/root/chp-f1b/` (`snapshot-pre.json`, `snapshot-api1.json`, `snapshot-api2.json`, `snapshot-final.json`, `snapshot-restore-post.json`, tarballs, `SHA256SUMS`, `ROLLBACK.txt`, `restore-post-Au8r/`).

## I. Commit documental

Este documento (ver §J para el cierre).

## J. Veredicto

**YELLOW justificado** (EDITORIALES-05). Único motivo: el 403 en el servidor con sesión real de mediador y lector no está observado en producción (§F.2); la ausencia del menú para mediación sí lo está, y el resto de controles están en GREEN. No bloquea F1-C / CATÁLOGOS-01 (auditoría). Pasa a **GREEN_PRODUCTIVO** con una sesión de cada rol que reciba 403 en `GET /api/admin/publisher-audit` y la redirección desde `#/admin/editoriales`, sin cambios en producción.

## K. Cierre EDITORIALES-05 (2026-10-26 19:45–19:53Z, solo lecturas)

- **Repo y CI:** HEAD `135da49` = origin; árbol limpio salvo carpetas no versionadas ajenas; `135da49`: security ✅, content-rmw ✅.
- **Producción:** api_1, api_2 y front `editoriales-beb11e4`, healthy, 0 reinicios; edge healthy; público 200; `publisher-audit` anónimo 401; 0 errores en las API desde el despliegue; `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` ausentes (= off); disco 8,7 G libres (92 %).
- **Huella** (`/root/chp-f1b/snapshot-05.json`) frente a `snapshot-final.json`: `content.json` `9faaf68566e513f0`, 109/109 con `pub-chibalete-editores`, 52 libros, 0 sin editorial, huella id→editorial `33f443b01ccd9847`; `royalties.db` `ok`, migraciones 0001–0003, **historial 0 filas** (sin reasignaciones), triggers append-only presentes, **0** `rights_versions`; `events.db` `ok`, **0** `econ_events`, 0 `econ_tick`; `access_db`, `groups_db`, `schools_db` idénticos. Única diferencia: el padrón, solo `lastLoginAt` de 3 cuentas (administración, mediación, lectura: los inicios de sesión de Dirección); 670 usuarios, 0 altas, 0 bajas.
- **Única escritura posterior al despliegue:** la actualización de datos administrativos de Chibalete Editores por Dirección (§F.2).
