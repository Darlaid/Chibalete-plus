# CHP-CONTENT-PROTECTION-2026-01 · CP-4E — PRODUCTION ROLLOUT de la política global de solo lectura

Fecha: 2026-10-19 · VPS de producción · Ventana 16:24Z–16:54Z · Evidencia en `/root/chp-cp4e/`

## A. Veredicto

```
CP4E_PRODUCTION_ROLLOUT:               GREEN_PRODUCTION
CP4_GLOBAL_POLICY_CLOSED:              YES
GLOBAL_CONTENT_POLICY:                 READ_ONLY_PROTECTED
ALL_TITLES_SAME_PROTECTION:            YES
PER_TITLE_PROTECTION_CLASSIFICATION:   DEPRECATED_PRODUCTION
ALL_AVAILABLE_READING_MODES:           PRESERVED
READER_DOWNLOAD_CONTROLS:              ZERO
PDF_MODE / PDF_EXPLICIT_DOWNLOAD:      AVAILABLE / DISABLED
EPUB_MODE / EPUB_EXPLICIT_DOWNLOAD:    AVAILABLE / DISABLED
MOOK_TRANSCRIPT_READING:               PRESERVED
MOOK_TRANSCRIPT_DOWNLOAD:              REMOVED_PRODUCTION
RAW_ORIGINAL_PUBLIC_ACCESS:            DENIED
WEB_BYTE_EXTRACTION_PREVENTION:        NOT_ABSOLUTE
WATERMARK_POLICY:                      PROHIBITED
VISIBLE_WATERMARK:                     NONE
ACCESSIBILITY_REGRESSION:              ZERO
CATALOG_PERFORMANCE_PRODUCTION:        GREEN
PRODUCTION_DATA_MUTATION:              ZERO_EXPECTED_CONFIGLESS_ROLLOUT
```

## B. Baseline (PRE, 16:24Z)

- **API:** `chibalete/api:contentprotect-cp4-3b9bff6` (`3083495a538e`) en api_1 y api_2.
- **Front:** `chibalete/front:contentprotect-cp4-3b9bff6` (`803fc09eadf8`).
- **Edge:** sin cambios.
- **LU:** 0.9.2 / 12 (`lu_config` `ea86a666`).
- **Flags:** `strict` / `enforce` / `restricted`. 0 reinicios.
- **Disco:** 88 %.
- **Datos:**
  - content 109 (`d8cf6abd`; 0 títulos con `licensed_strict`).
  - access_db 22 (`d4182a1d`).
  - groups `43503119`, school_configs `de83151c`, schools `a0301221`, library `67ff6972`, mook `dd056fbe`, banner `d25811e9`.
  - uploads: 3.364 ficheros / 6.010.151.892 B.

## C. Backups JIT

| Unidad | rc | Result | ID |
|---|---|---|---|
| structured-backup | 0 | success | `structured-20261019T162806Z-cfd10c95` |
| uploads-backup | 0 | success | `uploads-20261019T162820Z-a1ee9534` |

## D. Artefactos

Construidos desde `git -c core.autocrlf=false archive 73f45d6`.

| Pieza | Tag | Image ID | GIT_SHA | Tarball sha256 |
|---|---|---|---|---|
| API | `chibalete/api:contentprotect-global-73f45d6` | `b5e6f59c60db` | `73f45d6aa61f…` (env + label); 0 referencias a `licensed_strict` / `contentProtectionPolicy` en `server.js` y `accessService.js` | `4ee295f1…` |
| Front | `chibalete/front:contentprotect-global-73f45d6` | `79cd440ee6b0` | por construcción | `221abccd…` |

Verificación: `sha256sum -c` correcto en el VPS, y los IDs coinciden con los locales.

**Contenido del bundle** (`index-OxpU5CXA.js` + `epub-reader.html`):

| Texto | Ficheros que lo contienen |
|---|---|
| «Leer en PDF» | 1 |
| «Leer EPUB» | 2 |
| «Ver transcripción» | 1 |
| «Contenido protegido en Chibalete+» | 1 |
| «Descargar transcripción» | 0 |
| «Descargar podcast» | 0 |
| selector «Protección del contenido» | 0 |
| marca de agua propia | 0 |

«Ver EPUB original» solo aparece en un texto de ayuda de SubirContenido (administración). Ver §Z.

## E. Tests previos al deploy

| Suite | Resultado | Clasificación |
|---|---|---|
| `contentGlobalReadOnlyPolicy` | 31/0 en la imagen (front en SKIP) · 38/0 en el árbol completo | GREEN |
| catalogAccessPerformance 20 · catalogResourceLocators 33 · catalogAccessLogNoise 48 · uploadsAuthzStrict 157 · authzListingScope 79 · leoMemoryOwnership 72 | 0 fallos | GREEN |
| sessionIdentity 42 · sessionIdentityIntegration 34 · sessionBrowserCookieOnly 13 | 0 fallos | GREEN |
| epubOriginalEndpoint 32 · epubProgressSync 39 · epubProgress 32 · adminEpubAttach 42 · adminEpubUpload 13 | 0 fallos | GREEN |
| uploadDedupCanonical 10 · uploadDedupOwnership 34 · progressReadIdentity 27 | 0 fallos | GREEN |
| b2c unit 42 + 15 | 0 fallos | GREEN |
| memberships (7 suites de servidor + `test:memberships`) · `test:explicit-access` | 0 fallos | GREEN |
| content-rmw (imagen + `test:content-rmw` completo) | 0 fallos | GREEN |
| `test:mook` (árbol completo) | 0 fallos | GREEN |
| `test:a11y-reader` · ContentExtractionDeterrence 80 · ClientContentProtection 19 · EpubOriginalLink 15 · libraryServerAuthoritative 133 (árbol completo) | 0 fallos | GREEN |
| MOOK (7 suites) y libraryServerAuthoritative dentro de la imagen API | ENOENT: leen `pages/` o `services/`, que la imagen no incluye | SKIPPED_BY_PLATFORM |
| b2cProvisioning.integration | requiere sandbox | SKIPPED |
| libraryInstitutionalPersonal | 1 ✗ (no-store desde CP-3) | PREEXISTING_FAILURE |

NEW_FAILURE: ninguna.

## F. Canario aislado del servidor

- **Montaje:** misma imagen fuera del upstream; copias de data, data-critical, identity y sessions; copia mínima de uploads de 4 títulos reales (PDF+TXT, EPUB, álbum y podcast); usuarios sintéticos solo en la copia; IA y TTS en mock.
- **Limpieza:** contenedor y copia eliminados. En producción no se persistió nada.

| Actor | PDF | EPUB (endpoint) | TXT | Álbum | Audio | EPUB crudo |
|---|---|---|---|---|---|---|
| autorizado | 200 · Range 206 | 200 | 200 | 200 | 206 | 403 |
| sin acceso | 403 | 403 | 403 | 403 | 403 | — |
| anónimo | 401 | 401 | 401 | — | — | — |

- **Edge:** PDF y TXT autorizados → 204.
- **Catálogo:** el lector autorizado recibe los localizadores (PDF, EPUB y texto); quien no tiene acceso no los recibe (R2).
- **Campo histórico:** con los 4 títulos marcados `licensed_strict` en la copia, todos los resultados son **idénticos**. El log tiene 0 líneas `LICENSED_STRICT` y 0 `original_not_licensed`.

## G. Interfaz de descargas (front candidato)

- **En el navegador local** (CP-4D, árbol idéntico a `73f45d6`), 12 superficies:
  - 0 `a[download]`, 0 textos de descarga y 0 enlaces crudos a `/uploads`.
  - PDF y EPUB disponibles como «Leer en PDF» y «Leer EPUB».
  - Audio y vídeo con `nodownload`; PiP deshabilitado en vídeo propio.
- **En el bundle de la imagen:** confirmado (§D).
- **En producción:** confirmado (§N–§Q).

`READER_DOWNLOAD_CONTROLS: ZERO`.

## H. Rendimiento del canario

3 rondas alternadas, misma copia, 40 peticiones de catálogo como lector:

| | Ronda 1 | Ronda 2 | Ronda 3 |
|---|---|---|---|
| CP-4 `3b9bff6` p50 / p95 (ms) | 40.3 / 62.3 | 41.6 / 66.7 | 46.8 / 86.0 |
| Global `73f45d6` p50 / p95 (ms) | 42.5 / 85.8 | 53.8 / 100.6 | 42.6 / 63.0 |

- **Variación:** dentro del ruido; sin degradación material.
- **Logging:** un catálogo escribe 0 líneas por título y 1 de resumen. `STORE_READ_AMPLIFICATION: REMOVED`.

`CATALOG_PERFORMANCE_CANARY: GREEN`.

## I. Rollback (preparado, no ejecutado)

- **Ficheros:** `/root/chp-cp4e/ROLLBACK.txt` y override `docker-compose.override.yml.bak-pre-cp4e-20261019T164211Z` (sha `ede9982b…`).
- **Imágenes previas:** `contentprotect-cp4-3b9bff6`, también etiquetadas `rollback-pre-cp4e`.
- **API:** líneas 40 y 85 del override → recrear api_1 → recrear api_2.
- **Front:** línea 130 → recrear el front → reload del edge.
- **Datos:** no hay que restaurar nada.

`ROLLBACK_READY: YES`.

## J. Deploy API

- **api_1** (16:42:11Z):
  - healthy, 0 reinicios, `GIT_SHA=73f45d6`, strict / enforce / restricted.
  - Smoke: health 200 · TXT anónimo 401 · portada 200 · EPUB crudo 403 · endpoint EPUB anónimo 401 · catálogo anónimo 401.
  - `[HASH_INDEX] Built` a las 16:43:38Z.
  - Gate de latencia (sesión real, en caliente), por réplica: api_1 nueva **p50 37 / p95 59 ms**; api_2 vieja **p50 37 / p95 55 ms**. Una muestra aislada de 1,8 s en api_1: el primer catálogo tras el arranque, mismo patrón que en CP-4B.
- **api_2** (16:44:57Z): ídem. Desde ese momento api_1 = api_2 = `b5e6f59c60db`.

## K. Política global en el servidor (producción, sesión autorizada)

- **Recursos:** PDF 200 y Range 206; endpoint EPUB 200; TXT 200; álbum 200; EPUB crudo 403.
- **Catálogo:** 109 títulos con 51 localizadores PDF, 1 EPUB y 0 campos de política.
- **Sin acceso:** cubierto en el canario, sobre datos productivos copiados.

`ALL_TITLES_SAME_PROTECTION: YES` · `PER_TITLE_PROTECTION_CLASSIFICATION: DEPRECATED_PRODUCTION`.

## L. Catálogo

- **Estado:** 200 para lector y administración.
- **Logging:** 1 `CATALOG_ACCESS_FILTER` por request y 0 líneas por título.
- **Rendimiento POST** (60 peticiones controladas, ambas réplicas nuevas): **p50 42 / p95 88 / máx 169 ms**. Referencia CP-4B POST: p50 42 / p95 97.
- **R2:** intacto (§F).

`CATALOG_PERFORMANCE_PRODUCTION: GREEN`.

## M. Deploy front

- **Imagen:** `79cd440ee6b0` (16:47:17Z), healthy.
- **Edge:** `nginx -t` correcto y reload.
- **Verificación:** `/` 200 y `/epub-reader.html` 200; el bundle servido es `index-OxpU5CXA.js`, confirmado en el navegador tras recargar.

## N. Modos de lectura (producción, bundle nuevo)

| Modo | Resultado |
|---|---|
| Biblioteca | carga; 0 descargas; sin superficie (se imprime normal) |
| Detalle | «Leer en PDF»; en el título con EPUB, también «Leer EPUB»; sin «Ver … original» |
| Guiado | texto real (122 k caracteres); copy, menú y drag bloqueados |
| Accesible | texto real; copy, menú y drag **permitidos**; 3 enlaces de salto; `lang=es` |
| Inmersivo | texto real; fricción activa |
| PDF | 85 canvas (PDF.js) |
| EPUB | Foliate abre Alicia; 0 descargas; progreso «Carga del libro» |
| Álbum | página visible; menú y drag bloqueados |
| Galería | imágenes visibles; fricción activa |
| Podcast | `nodownload`; velocidad 1,5×; seek; reproduce con un clic real (un `play()` por script lo rechaza la política de autoplay de Chrome, `NotAllowedError` con el audio ya cargado; no es una regresión) |
| MOOK | vista previa de «¿Estás aquí?» (mismo renderer `NodeShell`; sin guardar) |
| Vídeo | los vídeos de producción son de YouTube (embed sin cambios); no hay vídeo propio |

`ALL_AVAILABLE_READING_MODES: PRESERVED`.

## O. PDF

- `PDF_MODE`: AVAILABLE.
- **CTA:** «Leer en PDF».
- **Control de descarga:** NONE (0 `a[download]`, 0 textos).
- **Range:** 206.
- **Anónimo:** 401.

## P. EPUB

- `EPUB_MODE`: AVAILABLE.
- **CTA:** «Leer EPUB».
- **Control de descarga:** NONE.
- **Endpoint autorizado:** 200.
- **Crudo:** 403.

## Q. MOOK

- **Transcripción:** «Ver transcripción» se abre con Enter (`<details>` nativo) y muestra 2.363 caracteres en la página. `MOOK_TRANSCRIPT_READING: PRESERVED`.
- **Descarga:** «Descargar transcripción» ausente; 0 `a[download]`. `MOOK_TRANSCRIPT_DOWNLOAD: REMOVED_PRODUCTION`.
- **Audio:** controles nativos con `nodownload` y menú contextual bloqueado.
- **Sin escrituras:** no se envió ninguna bitácora ni evidencia. El recorrido del administrador estaba en un formulario de bitácora y no se tocó.

## R. Copia e impresión

- **Fricción de copia:** activa en Guiado, Inmersivo, PDF, Álbum, Galería, Podcast y EPUB (contenedor; los iframes, sin cambios desde CP-4B).
- **Excepción de Accesible:** copia, corte, menú contextual y arrastre permitidos.
- **Impresión** (reglas `@media print` reales de producción aplicadas en pantalla un momento, en Guiado, Accesible, Inmersivo, PDF, Álbum y EPUB): 0 hijos visibles, 0 texto, aviso presente y `::after` none. Detalle se imprime normal.

`BOOK_CONTENT_IN_PRINT: NONE` · `PRINT_PROTECTION_NOTICE: PRESENT` · `PRINT_WATERMARK: NONE`.

## S. Marca de agua

`WATERMARK_POLICY: PROHIBITED` · `VISIBLE_WATERMARK: NONE` · `WATERMARK_NODES: 0` en las 12 superficies revisadas.

## T. Accesibilidad

| Prueba | Resultado |
|---|---|
| Texto real en el árbol de accesibilidad (Accesible) | sí: el primer párrafo de la obra está en `main` |
| Enlaces de salto | 3 |
| `lang` | `es` |
| Primer Tab | «Saltar al contenido», con outline visible |
| Landmarks `main` / `nav` | sí |
| Copia en Accesible | permitida |
| Transcripción de MOOK con teclado | Enter abre el `<details>` |

`ACCESSIBILITY_REGRESSION: ZERO`.

## U. Administración

- El formulario de SubirContenido (sesión de administración, sin guardar) ya no tiene el selector «Protección del contenido» y no hay reemplazo. `PER_TITLE_PROTECTION_ADMIN_SELECTOR: REMOVED_PRODUCTION`.
- Ningún contenido real modificado.
- Matriz editorial: `SUPERSEDED_BY_GLOBAL_POLICY`; no queda ningún gate editorial pendiente.

## V. Invariantes (PRE 16:24Z vs POST 16:53Z)

| Store | PRE | POST | Estado |
|---|---|---|---|
| content | `d8cf6abd` (109, 0 con la política) | `d8cf6abd` | idéntico |
| access_db | `d4182a1d` | `d4182a1d` | idéntico |
| groups | `43503119` | `43503119` | idéntico |
| schools / school_configs | `a0301221` / `de83151c` | ídem | idéntico |
| library | `67ff6972` | `67ff6972` | idéntico |
| mook | `dd056fbe` | `dd056fbe` | idéntico (mtime nuevo al abrir la experiencia; mismo contenido) |
| banner / lu_config | `d25811e9` / `ea86a666` | ídem | idéntico |
| users_db (legacy) | `9fb0bd98` | `9fb0bd98` | idéntico |
| uploads (incluye canónico, TTS y EPUB) | 3.364 / 6.010.151.892 B | ídem; 0 ficheros nuevos o modificados | idéntico |
| `usuarios_colegios_oro.json` | `446bad99` | `446bad99` | idéntico |
| progress, events, insights, analytics, leo_memory/evidence | — | actividad | uso normal |

`PRODUCTION_DATA_MUTATION: ZERO_EXPECTED_CONFIGLESS_ROLLOUT`.

## W. Monitoreo (16:42Z–16:54Z)

| Métrica | Resultado |
|---|---|
| 5xx de la API | 2: `POST /api/leo/recap` 500 (Gemini 503 «high demand» y fallback de OpenAI sin créditos). **Externo a CP-4** |
| 5xx del edge | 2: los mismos de Leo recap |
| Errores de `auth_request` / uploads-authz | 0 / 0 |
| CPU / memoria | API ~1 %, 84–89 MiB |
| Reinicios | 0 en los 4 contenedores |
| Latencia del catálogo | p50 42 / p95 88 ms |
| 401 / 403 | 3 / 1 por réplica (smoke anónimo) |
| Errores de front | ninguno observado |
| Errores de MOOK / PDF / EPUB | 0 / 0 / 0 |
| Veredictos `LICENSED_STRICT` | 0 |

## X. SHAs, imágenes y docs

| Pieza | Valor |
|---|---|
| Runtime | `73f45d6aa61f6223ca06e6c184aa46c41a00c624` |
| API | `chibalete/api:contentprotect-global-73f45d6` (`b5e6f59c60db`) en api_1 y api_2 |
| Front | `chibalete/front:contentprotect-global-73f45d6` (`79cd440ee6b0`) |
| Edge | sin cambios |
| LU | 0.9.2 / 12, sin cambios |
| Docs | este documento + `CHP_CONTENT_PROTECTION_GLOBAL_POLICY.md` (estado DEPLOYED_PRODUCTION) |

## Y. Limitación

`WEB_BYTE_EXTRACTION_PREVENTION: NOT_ABSOLUTE`. Chibalete+ no ofrece funciones de descarga, exige autorización y protege el acceso a los recursos. Los visores del navegador necesitan recibir los bytes, y un usuario autorizado con conocimientos técnicos puede recuperarlos.

## Z. Deudas

- **CP-4, no bloqueantes:**
  - El texto de ayuda de SubirContenido (administración, `ILLUSTRATED_KEEPS_ORIGINAL_MESSAGE`) todavía menciona «Ver EPUB original»; el botón ya dice «Leer EPUB». No se cambió porque la unidad prohíbe tocar código durante el rollout.
  - La muestra aislada de 1,8 s en el primer catálogo tras cada arranque.
  - La política global en producción se probó con una sesión de administración. Los caminos de lector y de usuario sin acceso se verificaron en el canario, sobre una copia de los datos productivos.
- **Preexistentes:**
  - Cuotas de IA: Gemini 503 y OpenAI 429, que hacen fallar `/api/leo/recap`.
  - `libraryInstitutionalPersonal`.
  - Las suites de MOOK y de library no corren dentro de la imagen API.
  - `[HASH_INDEX]` ocupa una CPU tras cada arranque.
  - Disco al 89 %.
  - Los 12 errores de `tsc`.
- **Bloqueantes:** ninguna.

**NEXT:** CP-4 FINAL AUDIT + PUBLISHER EVIDENCE PACK (no ejecutado).
