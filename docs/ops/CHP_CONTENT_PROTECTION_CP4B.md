# CHP-CONTENT-PROTECTION-2026-01 · CP-4B — PRODUCTION ROLLOUT (disuasión de extracción + capacidad licensed_strict)

Fecha: 2026-10-19 · VPS de producción · Ventana 15:09Z–15:46Z · Evidencia en `/root/chp-cp4b/`

## A. Veredicto

```
CP4B_PRODUCTION_ROLLOUT:             GREEN_PRODUCTION
CONTENT_PROTECTION_POLICY:           DEPLOYED
DEFAULT_POLICY:                      STANDARD
STANDARD_BEHAVIOR:                   UNCHANGED_PRODUCTION
LICENSED_STRICT_CAPABILITY:          DEPLOYED_NOT_ACTIVATED
LICENSED_STRICT_REAL_CONTENT_COUNT:  0
LICENSED_STRICT_PRODUCTION_TITLE_TESTED: NO (no se modificaron datos reales; probado en canario aislado)
WEB_COPY_FRICTION:                   GREEN_PRODUCTION
WEB_PRINT_PROTECTION:                GREEN_PRODUCTION
MEDIA_NATIVE_DOWNLOAD_UI:            REMOVED_PRODUCTION
WATERMARK_POLICY:                    PROHIBITED
VISIBLE_WATERMARK:                   NONE
ACCESSIBILITY_REGRESSION:            ZERO
CATALOG_PERFORMANCE:                 GREEN
PRODUCTION_DATA_MUTATION:            ZERO
```

## B. Baseline (PRE, 15:05Z)

- **API:** `chibalete/api:contentprotect-cp3d-935a515` (`31c99a93`) en api_1 y api_2.
- **Front:** `chibalete/front:contentprotect-cp3-598bfb4` (`fd6303c8`).
- **Edge:** sin cambios desde 10-16.
- **LU:** 0.9.2 / 12.
- **Flags:** `UPLOADS_AUTHZ_MODE=strict`, `SESSION_AUTH_MODE=enforce`, `ACCESS_FALLBACK_MODE=restricted`, identidad SQLite dual-write/shadow. Ninguno cambió.
- **Estado:** 0 reinicios. Disco 88 %.
- **Datos:**
  - content 109 (`d8cf6abd`), con `contentProtectionPolicy` ausente en los 109.
  - access_db 22 (`d4182a1d`).
  - groups `43503119`, school_configs `de83151c`, library `67ff6972`, mook `dd056fbe`, landing_banner `d25811e9`, lu_config `ea86a666`.
  - uploads: 3.364 ficheros / 6.010.151.892 B.

## C. Backups JIT

| Unidad | rc | Result | ID |
|---|---|---|---|
| structured-backup | 0 | success | `structured-20261019T150953Z-d790f8de` |
| uploads-backup | 0 | success | `uploads-20261019T151006Z-77f0737a` |

## D. Artefactos

Construidos desde `git -c core.autocrlf=false archive 3b9bff6`.

| Pieza | Tag | Image ID | GIT_SHA | Tarball sha256 |
|---|---|---|---|---|
| API | `chibalete/api:contentprotect-cp4-3b9bff6` | `3083495a538e` | `3b9bff66c40f…` (env + label) | `29fc329c…` |
| Front | `chibalete/front:contentprotect-cp4-3b9bff6` | `803fc09eadf8` | (sin label) | `fce5a16e…` |

- **Transferencia:** `sha256sum -c` correcto en el VPS, y los IDs coinciden con los locales.
- **Bundle:** `index-g17Zcq5x.js`, más `epub-reader.html`.
- **Marca de agua:** 0 referencias de Chibalete+. La única coincidencia de «watermark» en el bundle es el parámetro `addWatermark` del SDK de Google GenAI (generación de imágenes), que ya estaba en el front anterior.

### Suites dentro de la imagen API

| Grupo | Resultado |
|---|---|
| contentProtectionPolicy | 91/0, con la sección [7] de front en SKIP (la imagen no tiene `pages/`) |
| catalogAccessPerformance | 20/0 |
| catalogResourceLocators | 33/0 |
| catalogAccessLogNoise | 48/0 |
| uploadsAuthzStrict | 157/0 |
| authzListingScope | 79/0 |
| leoMemoryOwnership | 72/0 |
| sessionIdentity | 42/0 |
| sessionIdentityIntegration | 34/0 |
| sessionBrowserCookieOnly | 13/0 |
| epubOriginalEndpoint | 32/0 |
| epubProgressSync | 39/0 |
| adminEpubAttach | 42/0 |
| adminEpubUpload | 13/0 |
| uploadDedupCanonical | 10/0 |
| uploadDedupOwnership | 34/0 |
| progressReadIdentity | 27/0 |
| b2c (unit) | 42/0 y 15/0 |
| memberships (servidor) | 62 / 57 / 53 / 40 / 80 / 43 / 37, sin fallos |

Excepciones, todas preexistentes:
- `b2cProvisioning.integration`: SKIP, requiere sandbox.
- `libraryInstitutionalPersonal`: 1 ✗ (el no-store de CP-3).
- `libraryServerAuthoritative`: no corre en ninguna imagen API, tampoco en la de CP-3D, porque lee `services/dataService.ts`. En el árbol completo da 133/0.

### En el árbol exacto `3b9bff6` (front y scripts)

| Suite | Resultado |
|---|---|
| ContentExtractionDeterrence | 80/0 |
| contentProtectionPolicy (completo) | 99/0 |
| libraryServerAuthoritative | 133/0 |
| epubProgress | 32/0 |
| test:a11y-reader | verde |
| test:explicit-access | verde |
| test:memberships | verde |

## E. Canario strict aislado

- **Montaje:** la misma imagen API en un contenedor fuera del upstream (`--network bridge`, `127.0.0.1:3999`), con el entorno de api_1. IA y TTS en mock, sin claves, y `ARCHIVE_ROTATION` desactivado.
- **Datos:** copias de `data/`, `data-critical/`, `identity/` y `sessions/`, más una copia mínima de los ficheros de 3 títulos reales (90 ficheros, 142 MB). Los secrets se montaron `:ro`. Los uploads de producción no se montaron.
- **Usuarios sintéticos:** administración, lector con regla y lector sin regla, añadidos solo al padrón copiado (`usuarios_colegios_oro.json`). La contraseña era aleatoria y no se imprimió.
- **Cambios en la copia:** los 3 títulos (PDF+TXT `content-1775664683377`, EPUB `content-1773325007384`, álbum `content-1776006983915`) se marcaron `licensed_strict`.
- **Limpieza:** contenedor y copia eliminados (`rm -rf` del directorio del canario). En producción no se persistió nada.

| Política | Acceso | PDF | EPUB | Canónico / TXT | Álbum |
|---|---|---|---|---|---|
| STANDARD | sí | 200 · Range 206 | 200 | 200 | 200 |
| STANDARD | no | 403 | 403 | 403 | 403 |
| STRICT | sí | **403** (Range 403; edge 403) | **403** `original_not_licensed` | 200 (edge 204) | 200 |
| STRICT | no | 403 | 403 | 403 | 403 |
| STRICT | administración | 200 | 200 | — | — |
| cualquiera | anónimo | 401 | 401 | — | — |

- **Catálogo del lector en estricto:** sin `url_recurso` PDF ni `epub_url`; con texto y `album_data`.
- **Catálogo de administración:** íntegro.

## F. Gate de publicación (canario, admin sintético, `Origin` permitido)

| Caso | Resultado |
|---|---|
| strict + canónico | 200 |
| strict + TXT | 200 |
| strict + visual (álbum) | 200 |
| strict + solo PDF | 422 `licensed_strict_requires_reading` |
| strict + solo EPUB (edición adjunta, sin texto) | 422 |
| standard + solo PDF | 200 |
| política inválida | 400 `invalid_content_protection_policy` |

## G. Rendimiento

**Canario** (misma copia, 3 rondas alternadas, 40 peticiones de catálogo como lector):

| | ronda 1 | ronda 2 | ronda 3 |
|---|---|---|---|
| CP-3 `935a515` (p50 / p95 ms) | 42.3 / 60.6 | 42.7 / 62.7 | 48.7 / 79.8 |
| CP-4 `3b9bff6` (p50 / p95 ms) | 45.1 / 65.0 | 42.2 / 56.3 | 42.7 / 61.9 |

- **Logging:** 1 catálogo = 0 líneas por título y 1 `CATALOG_ACCESS_FILTER`. `STORE_READ_AMPLIFICATION: REMOVED`.

**Producción, sesión lectora real del operador (89 títulos), pino por réplica:**

| Momento | Réplica | n | p50 | p95 | máx |
|---|---|---|---|---|---|
| PRE (23 h de tráfico real en CP-3) | ambas | 146 | 40 ms | 112 ms | 309 ms |
| gate api_1, en caliente | api_1 (CP-4) | 40 | 40 ms | 55 ms | 1808 ms (1 muestra aislada) |
| gate api_1, en caliente | api_2 (CP-3) | 40 | 41 ms | 54 ms | 68 ms |
| POST, ambas réplicas en CP-4 | ambas | 52 | 42 ms | 97 ms | — |

- **Medición descartada:** la primera tanda en api_1 (p95 204 ms) cayó dentro de la construcción de `[HASH_INDEX]` (CPU al 105 %, ~70 s tras el arranque; preexistente). Se repitió después de «Built: 3332 entries».

## H. Rollback (preparado, no ejecutado)

- **Ficheros:** `/root/chp-cp4b/ROLLBACK.txt` y override `docker-compose.override.yml.bak-pre-cp4b-20261019T152006Z` (sha `56bc5199…`).
- **API:** imagen `contentprotect-cp3d-935a515`, también etiquetada `rollback-pre-cp4b`. Pasos: `sed` de las líneas 40 y 85 → recrear api_1 → recrear api_2.
- **Front:** imagen `contentprotect-cp3-598bfb4`, también etiquetada `rollback-pre-cp4b`. Pasos: línea 130 → recrear el front → reload del edge.
- **Datos:** no hay migración que deshacer.

## I. Deploy API

| Réplica | Hora | Estado | Smoke (TXT anónimo · portada · EPUB crudo · endpoint EPUB anónimo · catálogo anónimo · health) |
|---|---|---|---|
| api_1 | 15:21:20Z | healthy, 0 reinicios, `GIT_SHA=3b9bff6`, `[BOOT] UPLOADS_AUTHZ_MODE=strict`, flags intactos | 401 · 200 · 403 · 401 · 401 · 200 |
| api_2 | 15:27:01Z | ídem | ídem |

La primera conexión SSH para api_2 dio timeout antes de conectar (límite conocido del VPS). Se comprobó que api_2 no se había tocado y se repitió.

## J. Comportamiento STANDARD en producción

Sesión lectora real; ningún título tiene el campo.

| Superficie | Resultado |
|---|---|
| PDF | 200 / 206; el visor dibuja 86 canvas |
| EPUB | endpoint 200; el lector abre Alicia |
| Guiado | texto real, unos 121 k caracteres |
| Accesible | texto real, enlaces de salto y landmarks |
| Inmersivo | texto real |
| Álbum | página 200 |
| Galería | 20 imágenes |
| Podcast | 206; play, seek, velocidad ×1,5 y volumen |
| Detalle del EPUB | ofrece Leer Ahora, Inmersivo, Guiado, Accesible, «Ver PDF Original» y «Ver EPUB original» |

- **Catálogo del lector frente a `content.json`:** 89 títulos, 33 localizadores PDF y 1 EPUB. Las banderas P/E/T/A por título coinciden una a una con el almacén crudo (sha `9b828c279184570d` en ambos lados). Ningún localizador histórico desapareció.

`STANDARD_BEHAVIOR: UNCHANGED_PRODUCTION`.

## K. Catálogo

- **Lector:** 200 y `no-store`; 0 líneas por título y 1 `CATALOG_ACCESS_FILTER` por request en ambas réplicas.
- **Administración:** 200, 109 títulos íntegros (51 PDF, 1 EPUB, 0 campos de política).

## L. Deploy front

- **Hora:** 15:29:56Z.
- **Estado:** `803fc09eadf8` healthy; `nginx -t` correcto y reload del edge.
- **Verificación:** `/` 200, `/epub-reader.html` 200, el bundle servido es `index-g17Zcq5x.js`.

## M. Disuasión (producción, sesión lectora, bundle nuevo)

| Superficie | copy | menú contextual | drag | impresión | descarga | PiP |
|---|---|---|---|---|---|---|
| Guiado | bloqueado (Ctrl+C real → «Contenido protegido en Chibalete+») | bloqueado | bloqueado | protegida | — | — |
| Accesible | **permitido** | permitido | permitido | protegida | — | — |
| Inmersivo | bloqueado | bloqueado | bloqueado | protegida | — | — |
| PDF | bloqueado (canvas) | bloqueado | bloqueado | protegida | sin botón | — |
| EPUB | bloqueado, también dentro del iframe (Ctrl+C real) | bloqueado | — | protegida | sin botón | — |
| Álbum | bloqueado | bloqueado | bloqueado | protegida | — | — |
| Galería | bloqueado | bloqueado | bloqueado (20 `draggable=false`) | protegida | — | — |
| Podcast | bloqueado | bloqueado | bloqueado | protegida | `nodownload`, sin botón falso | — |
| Vídeo | producción no tiene vídeo local: los 5 vídeos son YouTube (embed sin cambios, superficie presente). `nodownload` y PiP deshabilitado verificados en CP-4A con un MP4 local | | | | | |

- **Inputs dentro de la superficie:** copy y menú contextual intactos.
- **Páginas sin superficie** (Detalle, Biblioteca): sin `data-chp-protected`.

## N. Impresión

- **Método:** no se abrió el diálogo de impresión en el Chrome del operador, porque bloquearía la sesión del navegador. Se aplicaron por un momento las reglas `@media print` reales que sirve producción (leídas de `#chp-protected-print`) en `screen` y se retiraron. Es el mismo CSS que en CP-4A1 produjo PDF de 1 página con `printToPDF`.

| Superficie | Hijos visibles | Texto visible | Aviso | `::after` |
|---|---|---|---|---|
| Guiado, Accesible, Inmersivo, PDF, Álbum, EPUB | 0 | 0 | «Contenido protegido en Chibalete+» | none |
| Detalle, Biblioteca (sin superficie) | 1 | 2.169 y 3.661 caracteres | none | none |

```
BOOK_CONTENT_IN_PRINT:     NONE
PRINT_PROTECTION_NOTICE:   PRESENT
PRINT_WATERMARK:           NONE
```

## O. Marca de agua

```
WATERMARK_POLICY: PROHIBITED · VISIBLE_WATERMARK: NONE
WATERMARK_NODES: 0 · WATERMARK_TEXT: 0 · WATERMARK_OVERLAY: 0
```

Verificado en Guiado, Accesible, Inmersivo, PDF, EPUB, Álbum, Galería y Podcast: sin overlays de pantalla completa, sin fondos SVG, sin `data-chp-mark` y sin marcador en `innerText`. `find` sobre el árbol de accesibilidad de Accesible solo encontró texto propio del libro.

## P. Accesibilidad

| Prueba | Resultado |
|---|---|
| Texto real (Guiado, Accesible, Inmersivo) | sí |
| Enlaces de salto en Accesible | 3: contenido, índice y controles |
| Landmarks | `main` y `nav` |
| `lang` | `es` |
| Primer Tab | «Saltar al contenido», con foco visible (outline + ring) |
| Copia en Accesible | permitida, `user-select: auto` |

`ACCESSIBILITY_REGRESSION: ZERO`.

## Q. Admin UI

- **Sesión:** administración real.
- **Formulario nuevo:** control «Protección del contenido» (Estándar / Licencia estricta) con ayuda y `aria-describedby`.
- **Edición de «La metamorfosis»:** carga «Estándar».
- **Escritura:** no se guardó nada; la sesión salió del formulario.

`ADMIN_POLICY_CONTROL: GREEN_PRODUCTION`. Ningún contenido real modificado.

## R. licensed_strict

```
CONTENT_PROTECTION_POLICY:                 DEPLOYED
LICENSED_STRICT_CAPABILITY:                DEPLOYED_NOT_ACTIVATED
LICENSED_STRICT_REAL_CONTENT_COUNT:        0
LICENSED_STRICT_PRODUCTION_TITLE_TESTED:   NO
```

La evidencia de la capacidad es la misma imagen (`3083495a538e`, `GIT_SHA 3b9bff6`) que pasó el canario aislado y las suites, ahora en api_1 y api_2.

## S. Invariantes (PRE 15:05Z vs POST 15:46Z)

| Store | PRE | POST | Estado |
|---|---|---|---|
| content.json | `d8cf6abd` (109, sin política) | `d8cf6abd` (109, sin política) | idéntico |
| access_db | `d4182a1d` (22) | `d4182a1d` | idéntico |
| groups | `43503119` | `43503119` | idéntico |
| school_configs / schools | `de83151c` / `a0301221` | ídem | idéntico |
| library | `67ff6972` | `67ff6972` | idéntico |
| mook | `dd056fbe` | `dd056fbe` | idéntico |
| landing_banner / lu_config | `d25811e9` / `ea86a666` | ídem | idéntico |
| users_db (legacy) | `9fb0bd98` | `9fb0bd98` | idéntico |
| uploads (incluye canónico, TTS y EPUB) | 3.364 / 6.010.151.892 B | ídem; 0 ficheros nuevos o modificados | idéntico |
| `usuarios_colegios_oro.json` | `63c2a6b1` | `70d3c8ab` | **cambio esperado**: `lastLoginAt` de los logins del operador (lector y administrador) |
| progress, events, insights, identity, leo_memory, analytics | — | actividad | uso normal: lecturas del smoke y tráfico real; sin escrituras de CP-4 |

## T. Monitoreo (15:21Z–15:46Z)

| Métrica | Resultado |
|---|---|
| 5xx de la API | 1 (api_2): `POST /api/leo/recap` 500. Gemini respondió 503 «high demand» y el fallback de OpenAI 429 «no credits». Ajeno a CP-4 |
| 5xx del edge | 2: el anterior y un 504 (timeout de 60 s) del mismo recap |
| Errores de `auth_request` / uploads-authz | 0 / 0 |
| CPU / memoria | API ~1 %, 78–92 MiB en reposo; pico de `[HASH_INDEX]` tras cada boot (~70 s, preexistente) |
| Reinicios | 0 en los 4 contenedores |
| Latencia del catálogo | p50 42 ms, p95 97 ms (n=52) |
| 401 / 403 | 3 / 1 por réplica (sesiones y anónimos del smoke) |
| Errores de front | ninguno observado en el smoke |
| Otros | TTS on-demand 429 de OpenAI (cuota, preexistente); `anchors.json` ausente (404, preexistente) |

## U. SHAs e imágenes

| Pieza | Valor |
|---|---|
| Web/API | `3b9bff66c40f17a1a2ed23e9349ae2460b1535cf` |
| API | `chibalete/api:contentprotect-cp4-3b9bff6` (`3083495a538e`) en api_1 y api_2 |
| Front | `chibalete/front:contentprotect-cp4-3b9bff6` (`803fc09eadf8`) |
| Edge | sin cambios |
| LU | 0.9.2 / 12, sin cambios |
| Docs | este documento |

## V. Deudas

- **Preexistentes:**
  - `libraryInstitutionalPersonal` (no-store).
  - `libraryServerAuthoritative` no corre en la imagen API.
  - SKIP de `b2cProvisioning.integration`.
  - Cuotas de IA agotadas (OpenAI 429) y Gemini 503: `/api/leo/recap` falla con 500/504.
  - `[HASH_INDEX]` ~70 s de CPU en cada boot.
  - `anchors.json` ausente.
  - Disco al 88 %.
  - Los 12 errores de `tsc`.
- **CP-4, no bloqueantes:**
  - Producción no tiene vídeo local: `nodownload`/PiP en vídeo solo se verificó en local.
  - La impresión en producción se verificó aplicando el CSS real, no con el diálogo de impresión.
  - Una muestra aislada de 1,8 s en el catálogo de api_1; p50 y p95 normales.
  - La parte de front de `contentProtectionPolicy` no corre dentro de la imagen API (SKIP declarado).
- **Bloqueantes:** ninguna.

## W. Siguiente

`CP-4C — CLASSIFY AND ACTIVATE LICENSED_STRICT TITLES` (no iniciado). Requiere que la editorial decida, título a título, qué contratos exigen `licensed_strict`.
