# CHP-EDITORIAL-ROYALTIES-2026-01 — F1-C / CATÁLOGOS-03 · Preparación del despliegue multieditorial

**Fecha:** 2026-10-26 (21:00–21:30Z) · **Candidato:** `b3dd8a9` (docs `3e3a08a`) · **Producción:** `editoriales-beb11e4` · **Alcance:** verificación y preparación; **no se desplegó nada**

**Veredicto:** **GO técnico**, pendiente de autorización expresa (§I).

---

## A. Baseline y CI

| Control | Resultado |
|---|---|
| Repo | HEAD `3e3a08a` = origin; árbol limpio (solo carpetas no versionadas ajenas) |
| CI `b3dd8a9` (código) | security ✅, content-rmw ✅, identity-preflight ✅ |
| CI `3e3a08a` (docs) | security ✅, content-rmw ✅ |
| Producción | api_1, api_2 y front `editoriales-beb11e4` (api `2bb58b4be9f5`, front `bf5571175d73`), healthy, 0 reinicios, ready 200; edge healthy |
| Diferencias ejecutables `beb11e4..b3dd8a9` | Servidor: `server/server.js`, `server/royalties/publisherAssignment.mjs`. Front: `pages/{Biblioteca,Busqueda,SubirContenido,AdminEditoriales}.tsx`, `services/dataService.ts`, `types/index.ts` y 4 módulos en `utils/`. `package.json` solo cambia scripts de test. **Sin cambios** en `package-lock.json`, Dockerfiles, nginx, compose ni migraciones |
| Consumidores de `my-catalog` | **Producción, edge, últimas 72 h:** 7 llamadas, todas del front web en navegador (Windows/Chrome e iPhone/Chrome, referer del dominio). **Ninguna de Android LU.** **Código:** solo Biblioteca y, desde F1-C, Búsqueda. LU 0.9.0 no lo llama y, si lo hiciera, su parser (Gson) ignora claves nuevas. El cambio es aditivo: `success` y `catalog` (5 claves por fila) no cambian |

## B. Imágenes candidatas y seguridad

Construidas desde `git archive b3dd8a9` (sin `data/`, `data-critical/` ni uploads), con los mismos Dockerfiles que producción.

| Imagen | ID (manifest, lo que muestran el VPS y el equipo local) | Tarball | sha256 del tarball |
|---|---|---|---|
| `chibalete/api:catalogos-b3dd8a9` | `f8812c438bab` (`GIT_SHA=b3dd8a9`, `CHIBALETE_RELEASE=catalogos-b3dd8a9`; base `node:20-alpine@sha256:fb4cd12c…`, la misma de producción) | 152 159 649 B | `50ce149c55be5558…` |
| `chibalete/front:catalogos-b3dd8a9` | `a3fed246dd15` | 28 581 631 B | `ca95e59599ef4ade…` |

- Tarballs y `SHA256SUMS` preparados en local (`scratchpad/f1c-images/`); **no transferidos**. Config digest dentro del tarball: api `cb32ad468927…`, front `846e611c8315…`. El VPS (containerd) muestra el ID de manifest, como pasó con `beb11e4` (`2bb58b4be9f5` en local y en el VPS).
- **Correcciones de seguridad conservadas:** front con `curl` y `libcurl` 8.23.0-r0 (SEC-FRONT-CURL-01) y `brotli-libs` 1.2.1-r0; la API mantiene base y lockfile idénticos a producción.
- **Trivy 0.69.3** (`HIGH,CRITICAL`, `--ignore-unfixed`, `.trivyignore` del repo, `--exit-code 1`): api ✅ 0, front ✅ 0. Las imágenes de producción también dan 0.
- Sin `.trivyignore`, la única excepción aplicable es `CVE-2023-54404` (zod, API). Ya estaba en producción, la cubre `test:zod-exposure` y **caduca el 2026-11-23**. El front no tiene ninguna.

## C. Integridad del catálogo (producción, solo lectura)

La huella `/root/chp-f1b/snapshot-c03.json` es **idéntica** a la de EDITORIALES-05 (`snapshot-05.json`):

- `content.json` `9faaf68566e513f0`: **109** fichas, 109/109 con `pub-chibalete-editores`, **52** libros (0 sin editorial), **57** recursos; huella id→editorial `33f443b01ccd9847`.
- **0** fichas con `imprint`: no hay asignación automática de sellos y el despliegue no la crea.
- `royalties.db`: `quick_check ok`; migraciones `0001`–`0003` (el candidato **no** trae migraciones); `content_publisher_history` 0 filas con sus triggers append-only; **0** `rights_versions`.
- `events.db`: `ok`, **0** `econ_events`, 0 `econ_tick`.
- `access_db.json` (reglas y clasificación comercial F2-B), `groups_db`, `schools_db` y padrón: mismos hashes.
- Editorial: Chibalete Editores, activa, sellos «Chibalete Editores» y «Estado Sólido» (`updated_at` 19:35:12Z, el guardado de Dirección).
- Flags: `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` ausentes (= off).

**Permisos:** el candidato no amplía el catálogo.
- `catalog` de `my-catalog` sale del mismo `visibleCatalogForUser` y del mismo filtro F2-A.
- `publishers` solo nombra editoriales con libros ya visibles para quien consulta.
- La pestaña «Editoriales» dibuja el mismo conjunto que «Libros».
- Los filtros administrativos siguen bajo la ruta `admin` y `requireAdminRole`.

Lo verifican `publisherCatalogHttp` (33/33) y el navegador del laboratorio (`F1C_CATALOGOS_02.md` §G).

## D. Respaldos y rollback

| Elemento | Estado |
|---|---|
| Respaldo estructurado | Cada 6 h (`structured-backup.timer`). Último: `structured-20261026T180421Z-3b364608`, `result ok`, 32 stores, 0 avisos. Próximo: 2026-10-27 00:02Z |
| Advertencia | Ese respaldo es **anterior** al guardado de datos de la editorial (19:35Z). El **respaldo PRE del despliegue es obligatorio** (paso 2) |
| Recuperabilidad | Última restauración aislada verificada: POST de F1-B (`fd2b873e`, 2026-10-26 16:16Z), idéntica al vivo. El despliegue repite la restauración en el paso 9 |
| Rollback | Imágenes vigentes `editoriales-beb11e4` (api `2bb58b4be9f5`, front `bf5571175d73`) presentes y con tarballs en `/root/chp-f1b/`. Se etiquetarán `rollback-pre-f1c`. También siguen los `rollback-pre-f1b`. Override actual `d75810d39970…` con `image:` en las líneas **40, 85 y 130** |
| Datos que revertir | Ninguno: el despliegue no escribe en `content.json`, `royalties.db` ni `events.db`, y no hay migraciones |

## E. Espacio disponible

- `/`: 106 G, **8,7 G libres (92 %)**; inodos al 30 %.
- Carga prevista: tarballs 0,18 G más la capa nueva de la API (comparte base y dependencias con `beb11e4`) y el front (~100 M). Margen de sobra para mantener las imágenes de rollback.
- Docker reporta 41 G de imágenes recuperables y 23 G de caché de build: **no se limpia** (fuera de alcance y necesario para rollback).

## F. Procedimiento de despliegue (preparado, NO ejecutado)

**Ventana sin edición:** entre los pasos 5 y 8 conviven versiones. Durante la ventana **no se editan contenidos ni editoriales**: una edición que llegue a la réplica antigua guardaría un `imprint` sin validar (la versión antigua no conoce el campo).

0. **Autorización expresa.** Docker Desktop lo abre la titular (las imágenes ya están construidas).
1. **Preflight (solo lectura):** contenedores healthy con `editoriales-beb11e4`; override `d75810d3…`; flags off; ≥ 3 G libres; huella igual a `snapshot-c03.json` (`content.json` `9faaf685…`, 0 `imprint`, 3 migraciones, historial 0, 0 derechos, 0 `econ_events`). STOP si algo difiere.
2. **Respaldo PRE** (`systemctl start structured-backup.service`): `result ok`, `royalties.db` `integrity ok`, `content.json` = `9faaf685…`.
3. **Transferencia:** `scp` de `f1c-images/*` a `/root/chp-f1c/` → `sha256sum -c SHA256SUMS` → `docker load` → IDs `f8812c438bab` / `a3fed246dd15`. STOP si no coinciden.
4. **Rollback preparado:** `docker tag` de `editoriales-beb11e4` a `rollback-pre-f1c` (api y front); copia `docker-compose.override.yml.bak-pre-f1c-<ts>`; `/root/chp-f1c/ROLLBACK.txt`.
5. **api_1:** solo la línea 40 → `catalogos-b3dd8a9`; `docker compose up -d --no-deps api_1`; esperar healthy.
6. **Gate api_1 (paso separado; api_2 no se toca):**
   - Log sin `ERROR`/`FATAL` y **sin** `[royalties-migrate] applied`.
   - `GIT_SHA=b3dd8a9`; health y ready 200.
   - Huella igual a la del paso 1.
   - Anónimo: 401 en `/api/content/my-catalog`, `/api/admin/publishers` y `/api/admin/publisher-audit`.
   - Dentro de la réplica, `publicPublishersForCatalog` sobre el catálogo vivo devuelve solo `{ id, name }` de Chibalete Editores.
7. **api_2:** línea 85; `up -d --no-deps api_2`; gate equivalente, en un paso separado.
8. **front:** línea 130; recrear `chibalete_front`; `nginx -t` y recarga del edge (cuidando la trampa del inodo de `nginx.conf`); healthy. El bundle público contiene `Biblioteca-Dqq7QIgo.js`, `Busqueda-B5CAfy2D.js` y `AdminEditoriales-DnZBOHSM.js`, y el texto «Editoriales» en la pestaña. Fin de la ventana.
9. **Respaldo POST + restauración aislada** (contenedor desechable sin red): huella restaurada = viva.
10. **Smokes** (§G).
11. **Rollback (si falla un gate):** restaurar el override `.bak-pre-f1c-*` y `up -d --no-deps` api_1 → validar → api_2 → front → recargar el edge. No hay datos ni esquema que revertir. Un `imprint` escrito por error en la ventana se ignoraría en la versión anterior y quedaría documentado.

No se crean editoriales, no se asignan sellos ni se reasignan obras durante el despliegue.

## G. Smokes productivos (tras el paso 9)

Sesiones abiertas por la titular en Chrome; **sin escrituras**.

| Perfil | Comprobación | Esperado |
|---|---|---|
| Anónimo | `GET /api/content/my-catalog`, `/api/admin/publishers`, `/api/admin/publisher-audit` | 401 |
| Administración | `GET /api/content/my-catalog` | Mismos ids de `catalog` que antes del despliegue (se capturan en el paso 1); filas con 5 claves; `publishers` = `[{ id: 'pub-chibalete-editores', name: 'Chibalete Editores' }]`, sin NIT ni contacto |
| Administración | Biblioteca → «Editoriales» | Un bloque «Chibalete Editores» sin subtítulos de sello (ninguna obra tiene sello) con los mismos libros de «Libros» de tipo libro y libro-álbum; abrir uno → `/contenido/:id` |
| Administración | Búsqueda (p. ej. «a») | Grupo «Libros de Chibalete Editores» que incluye libros-álbum; ningún «Libros del sello Chibalete» ni «editoriales aliadas» |
| Administración | `/admin/editoriales` | Chibalete Editores, 52 → `clase=libros`, +57 recursos → `clase=recursos`; el catálogo filtrado muestra Libros (52) / Recursos (57); sin selector de sello (todo sin sello) |
| Administración | Editor de un libro | «Editorial responsable» preseleccionada; «Sello (Opcional)» en «Sin sello» con las opciones «Chibalete Editores» y «Estado Sólido»; **salir sin guardar** |
| Mediación y lectura | «Editoriales» y endpoints administrativos | Solo sus libros autorizados, agrupados; 403 en `/api/admin/publishers` y `/api/admin/publisher-audit`; `#/admin/editoriales` redirige. **Esto cierra también el control pendiente de F1-B** |
| Invariantes | Huella final | `content.json` `9faaf685…`, 0 `imprint`, historial 0, 0 derechos, 0 `econ_events`, `access_db` `d4182a1d…`, flags off, 0 errores ni 5xx nuevos |

## H. Riesgos residuales

| Riesgo | Tratamiento |
|---|---|
| Ventana de versiones mixtas | Congelar ediciones entre los pasos 5 y 8 (≈ 2 min en F1-B) |
| Respaldo programado anterior al último guardado de la editorial | Respaldo PRE obligatorio (paso 2) |
| Excepción zod `CVE-2023-54404` caduca el 2026-11-23 | Preexistente; se revisará antes de esa fecha (fuera de esta unidad) |
| Disco al 92 % | Margen suficiente; sin limpiezas; vigilar en el preflight |
| Búsqueda lista títulos no abribles (deuda `GENERAL_CATALOG_METADATA_EXPOSURE`) | Preexistente; F1-C no la amplía y no atribuye editorial a esos títulos |
| «Selección Chibalete» desaparece de Biblioteca | Vacía en producción (0 colecciones); endpoints y datos conservados |
| `libraryInstitutionalPersonal` falla 1 aserción en local | Igual en la baseline y en verde en CI; ajeno a F1-C |
| Control F1-B pendiente (403 con sesión de mediador y lector) | Se cubre en los smokes de §G |

## I. Veredicto

**GO técnico** para desplegar `catalogos-b3dd8a9` (api_1 → api_2 → front) con el procedimiento de §F:
- CI verde y seguridad sin hallazgos no exceptuados.
- Imágenes identificadas sin ambigüedad.
- Datos productivos idénticos a la última huella.
- Sin migraciones ni ampliación de permisos.
- Rollback disponible y espacio suficiente.

Ninguna condición de parada de §5 del prompt se cumple. **No se ha desplegado:** requiere autorización expresa.
