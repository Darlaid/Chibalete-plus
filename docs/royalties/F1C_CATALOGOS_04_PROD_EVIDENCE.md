# CHP-EDITORIAL-ROYALTIES-2026-01 — F1-C / CATÁLOGOS-04 · Despliegue en producción

**Fecha:** 2026-10-26 (UTC) · **Imágenes desplegadas:** `chibalete/api:catalogos-b3dd8a9` (`f8812c438bab`) y `chibalete/front:catalogos-b3dd8a9` (`a3fed246dd15`) · **Plan:** `F1C_CATALOGOS_03.md` §F
**Autorización:** desplegar exclusivamente esas dos imágenes; sin modificar obras ni editoriales, sin migraciones, sin activar la ingesta económica ni el cumplimiento de derechos.

**Veredicto:** **GREEN_PRODUCTIVO**. El control condicional con sesiones reales de mediación y lectura **no se ejecutó** (no había sesiones disponibles) y queda registrado aparte (§D.3), sin darlo por aprobado.

---

## A. Baseline y respaldo PRE

| Control | Resultado |
|---|---|
| Repo | HEAD `d45d536` = origin; árbol limpio; sin cambios ejecutables después de `b3dd8a9` (solo docs) |
| CI | `b3dd8a9`: security ✅, content-rmw ✅, identity-preflight ✅; `d45d536`: security ✅, content-rmw ✅ |
| Producción previa | api_1, api_2 y front `editoriales-beb11e4` healthy, 0 reinicios; edge healthy; override `d75810d3…`; ingesta y cumplimiento off; 8,7 G libres |
| Huella PRE (`/root/chp-f1c/snapshot-pre.json`) | Idéntica a CATÁLOGOS-03: `content.json` `9faaf68566e513f0`, 109/109 con editorial, 52 libros, 0 `imprint`, migraciones 0001–0003, historial 0, 0 derechos, 0 `econ_events` |
| `my-catalog` de administración (referencia) | 109 ids, sha de ids `1388b4b510d20589`, claves `success` y `catalog` |
| Congelación de ediciones | Desde el preflight hasta el cierre de §F |
| Respaldo PRE | `structured-20261026T212459Z-6206eae3` (snapshot `d46cd820`): `result ok`, 32 stores, 0 avisos; `royalties.db` `integrity ok` (`cd90c673…`), `content.json` `9faaf685…` |
| Verificación del PRE | Restauración aislada en `/root/chp-f1c/restore-pre-H7Ec/` en un contenedor sin red: **idéntica al vivo** e **incluye el guardado administrativo de 19:35:12Z** (sellos «Chibalete Editores» y «Estado Sólido») |

## B. Imágenes y checksums

| | Tarball sha256 | `sha256sum -c` en el VPS | ID tras `docker load` | Esperado |
|---|---|---|---|---|
| api | `50ce149c55be5558…` | OK | `f8812c438bab` (`GIT_SHA=b3dd8a9`, `CHIBALETE_RELEASE=catalogos-b3dd8a9`) | ✅ |
| front | `ca95e59599ef4ade…` | OK | `a3fed246dd15` | ✅ |

- Trivy 0.69.3: 0 HIGH/CRITICAL no exceptuados (`F1C_CATALOGOS_03.md` §B).
- Sin limpiezas Docker.
- Rollback preparado:
  - Etiquetas `rollback-pre-f1c` (api `2bb58b4be9f5`, front `bf5571175d73`).
  - Override `docker-compose.override.yml.bak-pre-f1c-20261026T212826Z`.
  - `/root/chp-f1c/ROLLBACK.txt`.

## C. Resultado por etapa

| Etapa | Hora (UTC) | Gate |
|---|---|---|
| api_1 (línea 40) | 21:28:38 → healthy 21:28:50 | Log `[PUBLISHERS] royalties.db ready` → `[ECON] … (ingest=off)` → `Server running`; **sin** `royalties-migrate applied`; 0 errores; `GIT_SHA=b3dd8a9`; health y ready 200. Anónimo 401 en `my-catalog`, `/api/admin/publishers`, `/api/admin/publisher-audit` y `/api/content`; `x-user-id` falsificado 401. Huella = PRE. `publicPublishersForCatalog` = `[{ id: 'pub-chibalete-editores', name: 'Chibalete Editores' }]`. api_2 (versión previa) healthy y sin errores. **GREEN** |
| api_2 (línea 85, paso separado) | 21:29:37 → healthy 21:30:00 | Sin migración; 0 errores; health y ready 200; anónimo 401; mismo archivo `royalties.db` (inodo 817635) y mismo DDL (`fc7aa26585da`) en las dos réplicas; huella = PRE. **GREEN** |
| front (línea 130) + edge | 21:30:44 → healthy 21:30:57; reload del edge 21:30:58 | `nginx -t` OK en front y edge (avisos `ssl_stapling` de Studio preexistentes); edge healthy; público 200; bundle con `Biblioteca-Dqq7QIgo.js`, `Busqueda-B5CAfy2D.js`, `AdminEditoriales-DnZBOHSM.js` y la pestaña «Editoriales». **GREEN** |

- Ventana de versiones mezcladas: 21:28:38–21:30:58 (≈ 2 min 20 s), sin ediciones (0 `POST`/`PUT`/`DELETE` de contenido o editoriales en ambas réplicas).
- Override final `e9b904361d92…`, con las líneas 40, 85 y 130 en `catalogos-b3dd8a9`.

**Incidencia transitoria (no regresión):**
- A las 21:31:45 el edge recibió `Connection reset by peer` de **ambas** réplicas nuevas en `uploads-authz`. Marcó el pool como sin upstreams vivos durante unos 8 s: dos `GET /api/content` y una subpetición de cubierta recibieron 502 en la recarga del smoke.
- Se recuperó sola: 0 errores en las API y 0 respuestas 5xx en el edge desde 21:32.
- **Patrón preexistente:** en los 10 días anteriores hubo 9 episodios aislados (17, 18, 19, 20, 22 y 24/10, varios en días de despliegue). La causa probable es que el edge mantiene conexiones ociosas hasta 60 s (`keepalive_timeout 60s`) mientras Node las cierra a los 5 s (sin `keepAliveTimeout` explícito).
- No cambió en este candidato. Se registra como deuda (§G) y no motivó rollback.

## D. Smokes por rol y permisos

### D.1 Anónimo (Internet) — GREEN

401 en `/api/content/my-catalog`, `/api/admin/publishers`, `/api/admin/publisher-audit` y `/api/content`.

### D.2 Administración (sesión abierta por la titular en Chrome; sin escrituras) — GREEN

| Comprobación | Resultado |
|---|---|
| `GET /api/content/my-catalog` | 200, `no-store`. Claves `success`, `catalog` y **`publishers`**. **Mismos 109 ids** (sha `1388b4b510d20589`, igual que antes del despliegue). Filas con las 5 claves de siempre. `publishers` = `[{ id: 'pub-chibalete-editores', name: 'Chibalete Editores' }]` (sin NIT, contacto ni sellos) |
| `GET /api/admin/publisher-audit` | 200: `books 52`, `booksWithPublisher 52`, `nonBooks 57`, `missing []`, `unknown []` |
| Biblioteca | 8 pestañas; «Editoriales» en lugar de «Selección Chibalete». Un bloque «Chibalete Editores» sin subtítulos de sello con **42 libros, exactamente los mismos de tipo libro y libro-álbum de la pestaña «Libros»**. Los 10 restantes son capítulos «Para Experiencias», ocultos como antes. Los 9 libros-álbum están en «Libros Álbum» y en «Editoriales» |
| Búsqueda («los») | «Libros de Chibalete Editores» (10, libros y libros-álbum) y «Videos y podcasts» (2); ningún grupo «sello Chibalete», «aliadas» ni «comunidad» |
| `/admin/editoriales` | Sin banner de regularización. «52» → `clase=libros` (52 filas, «Libros (52)») y «+57 recursos» → `clase=recursos` (57 filas). Sin selector de sello (ninguna obra tiene sello) |
| Editor de «La metamorfosis» (`libro`) | «Editorial responsable» obligatoria con Chibalete Editores preseleccionada; «Sello (Opcional)» en **«Sin sello»** con las opciones «Chibalete Editores» y «Estado Sólido»; sin avisos. **Se salió sin guardar**: 0 escrituras en ambas réplicas y `content.json` `9faaf685…` |

### D.3 Mediación y lectura — NO EJECUTADO (registrado aparte)

Chrome solo tenía la sesión administrativa y no se introducen credenciales reales, así que **no se observó en producción** el 403 en `/api/admin/publishers` y `/api/admin/publisher-audit` ni la vista «Editoriales» con sesión de mediador o lector.

Cobertura disponible, que **no** sustituye la observación productiva:
- `publisherCatalogHttp` y el laboratorio aislado de `F1C_CATALOGOS_02.md` §G (lector y mediador: 403, solo sus libros, redirección).
- Para cerrarlo: abrir una sesión de cada rol en Chrome y comprobar, sin escribir nada:
  - 403 en esos dos endpoints.
  - Redirección desde `#/admin/editoriales`.
  - «Editoriales» con solo sus libros.
- Esto cierra también el control pendiente de F1-B (`F1B_EDITORIALES_04_PROD_EVIDENCE.md` §J).

## E. Integridad de datos

La huella final (`snapshot-final.json`, desde api_2) es **idéntica a la PRE**:
- `content.json` `9faaf68566e513f0`: 109 fichas, 52 libros (52/52 con editorial válida), 57 recursos; huella id→editorial `33f443b01ccd9847`.
- **0** `imprint`: no se asignó ningún sello.
- `royalties.db`: `quick_check ok`, mismas 3 migraciones (ninguna nueva), historial 0 filas con triggers, 0 `rights_versions`; editorial sin cambios.
- `events.db`: 0 `econ_events`, 0 `econ_tick`.
- `access_db` (reglas y clasificación comercial), `groups_db`, `schools_db` y padrón: mismos hashes.
- `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` off en ambas réplicas.

## F. Respaldo POST y restauración

- `structured-20261026T213435Z-87abf5a9` (snapshot `7634ac5e`): `result ok`, 32 stores, 0 avisos, 0 ausentes.
- `royalties.db` `cd90c673…`, `events.db` `5a981818…` y `content.json` `9faaf685…`: **los mismos sha que el PRE** (el despliegue no escribió).
- Restauración aislada en `/root/chp-f1c/restore-post-3diN/` (contenedor `catalogos-b3dd8a9` sin red): **idéntica al vivo**.
- **Congelación levantada** a las 21:35Z: las tres piezas están en `catalogos-b3dd8a9` y la integridad está confirmada.

## G. Estado del VPS, espacio y rollback

- api_1, api_2 y front `catalogos-b3dd8a9` healthy, 0 reinicios; 0 errores y 0 5xx en las API desde el despliegue; 0 5xx en el edge desde 21:32; edge healthy. Studio Editor BI sin tocar (Up 10 días).
- Disco: **7,9 G libres (93 %)** tras cargar las imágenes. Sin limpiezas.
- Rollback disponible:
  - Etiquetas `rollback-pre-f1c` y `editoriales-beb11e4`.
  - Override `.bak-pre-f1c-20261026T212826Z`.
  - `/root/chp-f1c/ROLLBACK.txt`.
  - Sin datos ni esquema que revertir.
- Evidencias en `/root/chp-f1c/`: huellas pre, pre-live, api1, api2, final, restore-pre y restore-post; tarballs; `SHA256SUMS`; `ROLLBACK.txt`.
- **Deudas registradas, no abiertas:**
  1. Desajuste de keepalive entre el edge (60 s) y Node (5 s), con 502 esporádicos (§C).
  2. Excepción zod `CVE-2023-54404`, que caduca el 2026-11-23.
  3. Disco al 93 %.

## H. Documentación y commit

Este documento y el seguimiento (fila 3i), en el commit documental de esta unidad.

## I. Veredicto

**GREEN_PRODUCTIVO.**
- Despliegue escalonado con los tres gates en verde.
- Imágenes idénticas a las aprobadas.
- Datos productivos intactos (huella final = PRE; respaldos PRE y POST restaurados idénticos al vivo).
- Sin migraciones ni ampliación de permisos.
- Smokes anónimos y administrativos en verde.
- Ingesta y cumplimiento de derechos apagados.

**Pendiente, sin inferirlo como aprobado:** los smokes con sesiones reales de mediación y lectura (§D.3).
