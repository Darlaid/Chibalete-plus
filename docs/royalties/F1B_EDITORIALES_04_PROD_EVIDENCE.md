# CHP-EDITORIAL-ROYALTIES-2026-01 — F1-B / EDITORIALES-04 · Despliegue en producción

**Fecha:** 2026-10-26 (UTC) · **Código desplegado:** `beb11e4` (HEAD `9c14bac` = `beb11e4` + docs) · **Plan:** `F1B_EDITORIALES_03.md` §F
**Autorización:** desplegar F1-B exclusivamente; sin crear editoriales reales, sin reasignar libros, sin activar la ingesta económica.

**Veredicto:** **YELLOW → pendiente solo de los smokes con sesión** (§F.2). Despliegue, migración, integridad, permisos anónimos, respaldo y restauración: GREEN.

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

### F.2 Con sesión — PENDIENTE

Requiere que la titular abra en Chrome las sesiones de administración, mediación y lectura (no se introducen credenciales reales). Pendiente: `/admin/editoriales` para administración con «Chibalete Editores» 52 libros + 57 recursos y sin banner; `GET /api/admin/publisher-audit` por HTTP con `missing []`; editor de un libro con la editorial preseleccionada, salir sin guardar; mediador y lector 403 y redirección.

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

**YELLOW** hasta ejecutar §F.2. Si los smokes con sesión resultan como se espera, el veredicto pasa a **GREEN** sin más cambios en producción.
