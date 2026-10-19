# CHP-CONTENT-PROTECTION-2026-01 — CP-4F: auditoría final de producción (documento interno)

Fecha: 2026-10-19 · Rama `chp/epub-mainfile-r1-release` · Documento técnico interno. El documento para editoriales es `CHP_CONTENT_PROTECTION_PUBLISHER_EVIDENCE_PACK.md`.

```
CP4_FINAL_AUDIT:                    GREEN_PRODUCTION
CP4_PROJECT_STATUS:                 CLOSED
PUBLISHER_EVIDENCE_PACK:            READY
GLOBAL_CONTENT_POLICY:              READ_ONLY_PROTECTED
ALL_TITLES_SAME_PROTECTION:         YES
ALL_AVAILABLE_READING_MODES:        PRESERVED
READER_DOWNLOAD_CONTROLS:           ZERO
RAW_ORIGINAL_PUBLIC_ACCESS:         DENIED
WEB_BYTE_EXTRACTION_PREVENTION:     NOT_ABSOLUTE
WATERMARK_POLICY:                   PROHIBITED
VISIBLE_WATERMARK:                  NONE
ACCESSIBILITY_REGRESSION:           ZERO
BLOCKING_CONTENT_PROTECTION_DEBTS:  ZERO
```

## A. Baseline (18:5xZ, antes del microfix)

| Pieza | Valor |
|---|---|
| Runtime | `73f45d6aa61f6223ca06e6c184aa46c41a00c624` |
| API | `chibalete/api:contentprotect-global-73f45d6` (`b5e6f59c60db`), api_1 y api_2, healthy, 0 reinicios |
| Front | `chibalete/front:contentprotect-global-73f45d6` (`79cd440ee6b0`) |
| LU | 0.9.2 / versionCode 12 (`cd24fda`) |
| Flags | `UPLOADS_AUTHZ_MODE=strict`, `SESSION_AUTH_MODE=enforce`, `ACCESS_FALLBACK_MODE=restricted` |
| Datos | ver §L; idénticos a CP-4E POST |

## B. Microfix (única modificación runtime)

- **Archivo:** `utils/epubAdmin.mjs`, constante `ILLUSTRATED_KEEPS_ORIGINAL_MESSAGE` (ayuda del formulario de administración al subir un EPUB ilustrado).
- **PRE:** «… y se habilitará su lector («Ver EPUB original»), …»
- **POST:** «… y se habilitará su lector («Leer EPUB»), …»
- «Se conservará la edición EPUB original» se mantiene: describe el archivo fuente que guarda el sistema, no un CTA del lector.
- **Comportamiento:** sin cambios. Solo texto; no se tocan endpoint, Foliate, catálogo, permisos, uploads ni lector.
- **Test:** aserción nueva en `contentGlobalReadOnlyPolicy` §[6].
- **Commit:** `cbc8e2d` `fix(content-protection): align remaining epub copy`.
- **Barrido de cadenas** («Ver PDF Original», «Ver EPUB original», «Descargar libro/EPUB/PDF/transcripción») en código fuente fuera de `docs/`: solo quedan aserciones negativas de tests. Bundle de producción: 0 de todas.
- **Imagen:** `chibalete/front:contentprotect-final-cbc8e2d` (`7265576a7feb`), bundle `index-BIrJjVje.js`. tarball sha256 `f369e40d…`, `sha256sum -c` OK en el VPS, mismo ID en local y en el VPS.
- **Bundle:** «Leer en PDF» 1 · «Leer EPUB» 3 · «Ver transcripción» 1 · aviso de impresión presente · «Descargar transcripción» / «Ver EPUB original» / «Ver PDF Original» / «Descargar libro|EPUB|PDF» / `sc-proteccion` / `chp-watermark` / «Descarga del libro» = 0.
- **Deploy:** 18:55:12Z, línea 130 del override; healthy; `nginx -t` OK y reload del edge. `/` 200, `/epub-reader.html` 200, el HTML sirve `index-BIrJjVje.js`.
- **Rollback preparado:** `/root/chp-cp4f/ROLLBACK.txt`; override `docker-compose.override.yml.bak-pre-cp4f-*`; imagen previa etiquetada `chibalete/front:rollback-pre-cp4f` (= `79cd440ee6b0`). No se usó.
- **API y LU:** sin cambios.

### Tests del microfix (árbol completo, Windows)

| Suite | Resultado |
|---|---|
| `npm run build` | OK |
| `contentGlobalReadOnlyPolicy` | 39/0 |
| `EpubOriginalLink.structural` | 15/0 |
| `ClientContentProtection.structural` | 19/0 |
| `ContentExtractionDeterrence` | 80/0 |
| `epubAdmin` / `SubirContenidoEpubAdmin` / `SubirContenidoEpub` | 17/0 · 21/0 · 17/0 |
| `npm run test:content-rmw` | GREEN (0 ✗) |
| `npm run test:mook` | GREEN |

`NEW_FAILURE: ZERO`.

## C. Matriz de acceso server-side

Anónimo: medido en producción. Autorizado y sin acceso: canario aislado de la **imagen de producción** (`b5e6f59c60db`) sobre una copia de los datos productivos de hoy, con usuarios y regla sintéticos solo en la copia (copia borrada al terminar). Títulos: libro PDF+TXT, el único EPUB, un álbum y un podcast.

| Actor | TXT / canónico | PDF | PDF Range | EPUB (endpoint) | EPUB crudo | Álbum | Audio |
|---|---|---|---|---|---|---|---|
| anónimo (prod) | 401 | 401 | 401 | 401 | 403 | 401 | 401 |
| sin acceso | 403 | 403 | — | 403 | — | 403 | 403 |
| autorizado | 200 | 200 | 206 | 200 | 403 | 200 | 206 |

- Edge (`auth_request`) autorizado: 204 para PDF y TXT.
- Producción con sesión de administración (CP-4E, misma imagen API): PDF 200/206, EPUB 200, TXT 200, álbum 200, EPUB crudo 403.
- Portada anónima 200: es metadato público por diseño (CP-3), no contenido editorial.
- La decisión depende solo del derecho a leer el título; el campo histórico `contentProtectionPolicy` es inerte (CP-4E fase 2: resultados idénticos; 0 líneas `LICENSED_STRICT` en producción desde el deploy).

## D. Catálogo

| Medida | Resultado |
|---|---|
| Status | admin 200 · autorizado 200 · sin acceso 200 · anónimo 401 |
| R2 (sin acceso) | 89 títulos visibles, 89 no autorizados, **0** con localizadores editoriales |
| R2 (autorizado) | 85 no autorizados, **0** con localizadores; los 4 autorizados conservan PDF, EPUB y TXT |
| Logging | 3 catálogos con sesión → 3 `CATALOG_ACCESS_FILTER`, 0 `[ACCESS_DECISION]` por título |
| Producción desde CP-4E | 112 líneas de resumen, 0 por título |
| Rendimiento (canario, 3 rondas × 40) | autorizado p50 35,9–39,6 / p95 49,5–54,6 ms · sin acceso p50 38,0–43,6 / p95 49,8–65,4 ms |
| Producción (CP-4E, 60 peticiones) | p50 42 / p95 88 ms |

`CATALOG_PERFORMANCE: GREEN`. Sin lecturas O(n × store): el catálogo usa un único lector de stores por petición.

## E. Modos (producción, bundle nuevo, sesión de administración en el Chrome del usuario)

| Modo | Resultado | Fricción | Impresión |
|---|---|---|---|
| Biblioteca | OK | — | normal |
| Detalle PDF | «Leer Ahora · Inmersivo · Guiado · Accesible · Leer en PDF» | — | normal (metadatos) |
| Detalle EPUB | «Inmersivo · Guiado · Accesible · Leer en PDF · Leer EPUB» | — | — |
| Guiado | OK, 279 k caracteres reales | copy/cut/contextmenu/drag bloqueados | solo aviso |
| Accesible | OK, 279 k caracteres | **todo permitido** | solo aviso |
| Inmersivo | OK | bloqueado | solo aviso |
| PDF | OK, canvases renderizados | bloqueado | solo aviso |
| EPUB (Foliate) | Alicia abre, 9.616 caracteres en la sección visible | bloqueado dentro del iframe | solo aviso |
| Álbum | OK, imágenes | bloqueado | solo aviso |
| Galería | «La metamorfosis», 20 imágenes | bloqueado | — |
| Podcast | audio listo (readyState 4), `nodownload` | bloqueado | — |
| MOOK | vista previa del Studio (sin guardar): audio con controles + `nodownload`, menú contextual bloqueado | — | — |
| Vídeo | YouTube (`youtube-nocookie`), sin cambios | — | — |

Impresión emulada aplicando en pantalla, por un momento, las reglas `@media print` reales: 0 hijos visibles, 0 texto, `body::before` = «Contenido protegido en Chibalete+», `::after` = none.

`ALL_AVAILABLE_READING_MODES: PRESERVED`.

## F. Download UI

En todas las superficies anteriores: `a[download]` 0 · botones/enlaces de descarga 0 · `href` crudos a `/uploads/*.pdf|epub|txt` 0 · «Ver … original» 0 · nodos de marca de agua 0. Los elementos `<audio>` del Guiado y del Inmersivo son internos del motor de TTS (sin `controls`, ocultos), no controles para el usuario. Formulario de administración: sin selector «Protección del contenido» y sin «Ver … original».

`READER_DOWNLOAD_CONTROLS: ZERO`.

## G. MOOK

`Ver transcripción` PRESENT · `Descargar transcripción` ABSENT · con foco en el `<summary>`, Enter la abre (2.345 caracteres legibles en la página) · outline visible · audio 177 s cargado · `nodownload` activo.

## H. Android LU (evidencia vigente, sin repetir pruebas)

| Control | Evidencia |
|---|---|
| Versión | 0.9.2 / 12, `cd24fda`; `lu_config` 0.9.2 sin cambios |
| Descarga autenticada | `download_success` en Xiaomi 25078RA3EL (CP-3E) |
| Cifrado offline | AES-256-GCM, clave Android Keystore no exportable `chibalete_lu_offline_book_v1`; logout borra archivo y alias (CP-3) |
| FLAG_SECURE | `SecureContentWindow.kt` en `ReaderScreen`; captura negra (99,8 %), grabación negra, Recientes en blanco (CP-3E) |
| Lectura offline | modo avión: lector OK (CP-3E) |
| Export | ninguno: sin `PrintManager`, `ACTION_SEND`, `ClipboardManager` ni `SelectionContainer` en `app/src/main`; `allowBackup="false"` (revisión estática en `cd24fda`) |
| Accesibilidad | TalkBack/uiautomator ven el texto real con FLAG_SECURE |
| Marca de agua | ninguna |

## I. Accesibilidad

Accesible: primer Tab → «Saltar al contenido» con outline sólido 2 px · 1 `main`, 3 `nav` · `lang="es"` · h1 real · 279 k caracteres de texto DOM (no imagen) · copia permitida. EPUB `lang="es"`. MOOK operable por teclado.

`ACCESSIBILITY_REGRESSION: ZERO`.

## J. Risk register R1–R8

| Riesgo | Estado |
|---|---|
| R1 `/uploads` público | FIXED_PRODUCTION |
| R2 fuga de recursos en el catálogo | FIXED_PRODUCTION |
| R4 caché pública | FIXED_PRODUCTION |
| R5 acceso a uploads tras logout | FIXED_FOR_NEW_REQUESTS |
| R6 orden de autorización del Inmersivo | FIXED_PRODUCTION |
| R7 texto local en el navegador | FIXED_PRODUCTION |
| R8 dependencia de LU de `/uploads` público | FIXED_PRODUCTION |

El registro no define R3.

## K. Estabilidad (16:42Z CP-4E → 19:02Z)

| Métrica | Resultado |
|---|---|
| 5xx edge | 3, todos `POST /api/leo/recap` (16:49, 16:53, 18:58): Gemini 503 «high demand» + respaldo OpenAI 429 «no credits». **Externos** |
| 5xx en PDF / EPUB / MOOK / uploads | 0 |
| Errores `auth_request` | 0 |
| Errores del autorizador de uploads | 0 |
| `LICENSED_STRICT` | 0 |
| Reinicios | 0 en los 4 contenedores |
| CPU | api ~1 %, front/edge ~0 % |
| Memoria | anon api_1 88 MiB, api_2 91 MiB (el total de `docker stats` incluye page cache) |
| Errores de front | ninguno observado en la auditoría |
| Circuit breaker | OpenAI TTS abierto 5 min por 429 (cuota, externo) |

## L. Invariantes de datos

| Store | PRE | POST |
|---|---|---|
| content | `d8cf6abd` (109, 0 campos de política) | `d8cf6abd` |
| access_db | `d4182a1d` | `d4182a1d` |
| groups | `43503119` | `43503119` |
| schools / school_configs | `a0301221` / `de83151c` | igual |
| library | `67ff6972` | `67ff6972` |
| mook | `dd056fbe` | `dd056fbe` |
| banner / lu_config | `d25811e9` / `ea86a666` | igual |
| users_db / padrón | `9fb0bd98` / `446bad99` | igual |
| uploads | 3.364 | 3.366: +2 a las 19:00:03Z en la caché de TTS del Inmersivo (`audio/immersive/*.wav` + `.json`), generados por TTS bajo demanda en actividad de lectura. Caché runtime, no contenido editorial; ningún archivo editorial nuevo o modificado |

Progreso/eventos: actividad normal.

## M. Deudas

- **Bloqueantes de protección:** ninguna.
- **No bloqueantes CP-4:** la verificación en producción de lector y sin acceso se hace con el canario sobre datos copiados (producción con sesión de administración); muestra aislada lenta en el primer catálogo tras arranque (CP-4E).
- **Preexistentes ajenas:** cuotas de IA (Leo recap, TTS OpenAI); `libraryInstitutionalPersonal`; suites que necesitan `pages/` no corren en la imagen API; `HASH_INDEX` al arrancar; disco 89 %; 12 errores de `tsc`.

## N. SHAs

Runtime API `73f45d6` · front `cbc8e2d` (`contentprotect-final-cbc8e2d`, `7265576a7feb`) · LU 0.9.2 / 12 · docs: commit de este documento.
