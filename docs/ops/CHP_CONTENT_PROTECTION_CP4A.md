# CHP-CONTENT-PROTECTION-2026-01 — CP-4A: disuasión de extracción + política para editoriales externas

Fecha: 2026-10-19 · Local, sin deploy · Rama `chp/epub-mainfile-r1-release`

## A. Veredicto

```
CP4A_EXTRACTION_DETERRENCE:      GREEN_LOCAL
CP4_POLICY_DECISION_REQUIRED:    YES  (campo de política para contenido licenciado — §F)
WEB_COPY_FRICTION:               GREEN_LOCAL
WEB_PRINT_PROTECTION:            GREEN_LOCAL
MEDIA_NATIVE_DOWNLOAD_UI:        REMOVED_LOCAL
WEB_DYNAMIC_WATERMARK:           GREEN_LOCAL
SCREENSHOT_TRACEABILITY:         GREEN_LOCAL
WEB_SCREENSHOT_PREVENTION:       NOT_RELIABLY_POSSIBLE
EXTERNAL_CONTENT_CLASSIFICATION: ABSENT
EXTERNAL_CONTENT_POLICY:         NEEDS_DECISION (diseño cerrado, sin implementar)
LICENSED_STRICT_PDF_ORIGINAL:    DENIED_BY_DESIGN — NOT_ENFORCED (requiere el campo)
LICENSED_STRICT_EPUB_ORIGINAL:   DENIED_BY_DESIGN — NOT_ENFORCED (requiere el campo)
ACCESSIBLE_COPY_POLICY:          ALLOWED_FOR_ACCESSIBILITY
ACCESSIBILITY_REGRESSION:        ZERO
PRODUCTION:                      UNCHANGED
```

Se aplicó una condición de STOP del encargo (§32): **no hay forma fiable de identificar contenido externo**. Por eso la parte LICENSED_STRICT queda diseñada pero sin código, a la espera de que se apruebe el campo. Todo lo demás (fricción, impresión, marca de agua, media) es independiente de esa decisión y queda GREEN_LOCAL.

Principio: lo que añade CP-4A es **FRICCIÓN** y **TRAZABILIDAD**, no prevención. La protección fuerte sigue estando en la autorización del servidor (CP-1/2/3), en la futura política de originales (§G/§H) y en FLAG_SECURE de LU.

## B. Baseline

- Producción: API `chibalete/api:contentprotect-cp3d-935a515` (`935a515515b70da71a1d2ceabd277e2458766378`), front `chibalete/front:contentprotect-cp3-598bfb4`, LU 0.9.2 / versionCode 12.
- R1, R2, R4, R6, R7 y R8: FIXED_PRODUCTION. R5: FIXED_FOR_NEW_REQUESTS. UNAUTHORIZED_EDITORIAL_BYTES = ZERO.
- Código local: HEAD `8dc3fa2`. `server/` no cambia en CP-4A: el backend de las pruebas es la misma imagen de producción.

## C. Matriz de superficies (después de CP-4A, web)

| Superficie | copy/cut | print / Save as PDF | menú contextual | drag | descarga nativa | PiP | captura | marca de agua | bytes originales |
|---|---|---|---|---|---|---|---|---|---|
| Guiado | bloqueado | aviso + marcador | bloqueado | bloqueado | — | — | posible | sí | TXT íntegro |
| Accesible | **permitido** (§I) | aviso + marcador | permitido | permitido | — | — | posible | sí | TXT íntegro |
| Inmersivo | bloqueado | aviso + marcador | bloqueado | bloqueado | — (audio sin controles) | — | posible | sí | TXT íntegro + fragmentos TTS |
| PDF | n/a (canvas sin capa de texto) | aviso + marcador | bloqueado | bloqueado | sin botón | — | posible | sí | **PDF íntegro** |
| EPUB original | bloqueado (también dentro de los iframes de Foliate) | aviso + marcador | bloqueado | bloqueado | sin botón | — | posible | sí | **EPUB íntegro** |
| Álbum | n/a | aviso + marcador | bloqueado | bloqueado | — | — | posible | sí | imágenes de página |
| Galería | n/a | aviso + marcador | bloqueado | bloqueado (`draggable=false`) | — | — | posible | sí | imágenes |
| Podcast | — | aviso + marcador | bloqueado | bloqueado | `nodownload` + se quitó el botón falso «Descargar» | — | n/a | no (audio) | MP3 íntegro |
| Vídeo local | — | aviso + marcador | bloqueado | bloqueado | `nodownload` | **deshabilitado** | posible | sí | MP4 íntegro |
| Vídeo YouTube | sin cambios (embed ajeno) | aviso + marcador | — | — | (YouTube) | (YouTube) | posible | sí (overlay) | no son bytes de Chibalete+ |
| MOOK | sin cambios (contenido propio) | sin cambios | bloqueado sobre el reproductor | — | `nodownload` | — | posible | no | MP3 íntegro; la transcripción se puede descargar (alternativa accesible) |
| Material pedagógico | se abre en los visores de arriba y hereda su política | | | | | | | | |
| Detalle / Biblioteca / admin | sin cambios | impresión normal | normal | normal | — | — | — | no | solo metadata |
| Android LU | — | — | — | — | — | — | **bloqueada** (FLAG_SECURE) | no | TXT cifrado en reposo |

Antes de CP-4A ninguna superficie tenía controles de copia, impresión, menú contextual, `controlsList`, PiP ni marca de agua. Solo había `select-none` en el Inmersivo y `draggable={false}` en el Álbum. Ver la auditoría de 2026-01.

## D. Bytes originales

| Formato | Entrega actual | Clase | Riesgo | Política propuesta |
|---|---|---|---|---|
| PDF (`url_recurso`) | `/uploads` autorizado → PDF.js en el navegador | ORIGINAL_FULL | quien tiene derecho de lectura obtiene el fichero (DevTools / red) | STANDARD: igual. LICENSED_STRICT: **403 en el servidor** y sin modo PDF |
| EPUB (`epub_url`) | `GET /api/content/:id/epub` transmite el fichero entero; `/uploads/*.epub` siempre 403 | ORIGINAL_FULL | idem | STANDARD: igual. LICENSED_STRICT: **403 en el servidor** y sin botón |
| TXT / canónico (`texto_plano_url`, `canonical/book.txt\|json`) | `/uploads` autorizado | CANONICAL_TEXT (libro completo) | el texto entero llega al navegador | se mantiene: es la representación de consumo. No es «no descargable» (§T) |
| Audio podcast / MOOK | `/uploads` (Range) | ORIGINAL_FULL | reconstruible | `nodownload` (fricción). DRM queda fuera de alcance |
| TTS (`audio/<id>/chunk_*`) | fragmentos + manifest | STREAM_SEGMENT / DERIVATIVE | reconstruible concatenando | sin cambios |
| Vídeo local | `/uploads` progresivo | ORIGINAL_FULL | idem | `nodownload` + sin PiP. DRM en una unidad aparte |
| Ilustraciones / páginas de álbum / media canónica | `/uploads` autorizado | ORIGINAL_FULL (resolución subida) | idem | sin cambios. Para LICENSED_STRICT se recomienda subir derivados de resolución de pantalla |
| Portada | pública | ORIGINAL_FULL (promoción) | aceptado | sin cambios |
| ZIP / masters | no hay endpoint | NOT_DELIVERED | — | — |
| YouTube / archive.org | proveedor externo | NOT_DELIVERED (por Chibalete+) | — | — |

«Autorizado» no significa «no descargable»: todo lo que el navegador recibe, el usuario legítimo lo puede guardar.

## E. Metadata de derechos

**EXTERNAL_CONTENT_CLASSIFICATION: ABSENT**

- El catálogo local tiene 61 registros con 26 claves. No existe ninguna de estas: `publisher`, `proveedor`, `licencia`/`license`, `derechos`/`rights`, `origen`/`source`/`fuente`, `contrato`, `propietario`/`owner`, `isbn`, `sku`.
- `editorial`:
  - Vale `"Chibalete"` en los 61 registros, y en los 109 de producción según CP-0.
  - El servidor no lo valida ni lo lee: `POST /api/content` guarda el body tal cual.
  - La UI lo fija a mano (`SubirContenido.tsx:1053,1136`). El tipo admite `"Aliada X" | "Comunidad"`, pero son ramas muertas de Búsqueda.
  - Conclusión: **no es una señal fiable**.
- `autor`: texto libre. No indica derechos.
- Capa EDITORIAL de Biblioteca: es curaduría (colecciones), no propiedad.
- «Dueño» de upload (`uploadOwnership.js`): es el primer segmento de la ruta, para deduplicar. No tiene valor jurídico.
- woo / b2c: proxy de la tienda sin relación con `content.id`. El entitlement es por usuario.

## F. Modelo de política (propuesta; necesita aprobación)

Un solo campo, opcional y compatible hacia atrás, en el registro de contenido:

```
contentProtectionPolicy: "standard" | "licensed_strict"     // ausente = "standard"
```

- **STANDARD**: contenido propio, o derechos que permiten originales. El acceso lo decide el servidor (CP-1/2/3), el lector no tiene botones de descarga y se aplican la fricción de copia e impresión y la marca de agua. PDF y EPUB originales permitidos.
- **LICENSED_STRICT**: contenido de terceros cuyo contrato no autoriza entregar el original. PDF, EPUB y masters no se entregan. Se consume por las representaciones de Chibalete+ (canónico → Guiado, Accesible, Inmersivo y Álbum cuando exista), con la misma fricción, la marca de agua y la trazabilidad.

No se presupone que toda editorial exija strict: lo decide el contrato, título a título. Del campo se derivan todos los comportamientos, sin booleanos por cada uno. No hay sistema de derechos, contratos ni proveedores.

Decisiones abiertas para la persona responsable:
1. Aprobar el nombre y los valores del campo.
2. Quién lo fija: solo el administrador, en SubirContenido.
3. Si un título strict **sin** texto canónico puede publicarse. Recomendación: no, porque se quedaría sin modo de lectura.

## G. PDF

- **STANDARD:** contrato actual. Detalle → «Ver PDF Original» → `/leer/pdf/:id` → `url_recurso` → PDF.js (canvas) → `/uploads` con autorización estricta. El navegador recibe **los bytes completos** del PDF.
- **LICENSED_STRICT:** `PDF_ORIGINAL_DELIVERY: DENIED`. No hay modo PDF; los demás modos del título siguen disponibles. No existe rasterizador en el servidor (no hay pdftoppm, sharp ni canvas; solo `pdf-parse` para Leo) y no se diseña uno aquí.
- **Enforcement en el servidor (diseño, unos 3 archivos):**
  1. `decideUploadAssetAccess` (`server/accessService.js`, bucle de dueños): si la ruta es el `url_recurso` `.pdf` de un dueño `licensed_strict` → `FORBIDDEN`, aunque `decideContentAccess` lo permita. Lo aplica el edge (`/api/internal/uploads-authz`) y el guard de `express.static`. Excepción: administrador, para gestionar. Si la ruta tiene varios dueños, se deniega si la referencia viene de un dueño strict.
  2. `catalogForViewer`: en títulos strict omite `url_recurso` (`.pdf`) incluso con acceso. Así, Detalle y `ReaderModeSelector` dejan de ofrecer el modo PDF con el mecanismo de CP-3 (ausencia del campo).
  3. Esto solo funciona con `UPLOADS_AUTHZ_MODE=strict`, que ya está activo en producción. En legacy no se resuelven dueños.

## H. EPUB

- **STANDARD:** `GET /api/content/:id/epub` exige sesión, `decideContentAccess` y ruta dentro de `/uploads/<id>/`, y transmite el fichero entero a Foliate. `/uploads/*.epub` siempre devuelve 403.
- **LICENSED_STRICT:** `EPUB_ORIGINAL_DELIVERY: DENIED`. La ingestión EPUB → CanonicalBook sigue siendo válida y el consumo va por Guiado, Accesible e Inmersivo. Foliate no se convierte en DRM.
- **Enforcement en el servidor (diseño):** en `/api/content/:id/epub`, después del veredicto de acceso, si el título es strict → 403 `ORIGINAL_NOT_LICENSED`. `catalogForViewer` omite `epub_url`, así que `hasEpubOriginal()` da false y desaparece el botón. Derecho a leer ≠ derecho a recibir el fichero original. Se reutiliza la identidad actual; no hay un sistema de acceso nuevo.

## I. Copy / cut / drag

Componente común `components/ProtectedContentSurface.tsx` + helper puro `utils/contentProtection.mjs`.

- Montaje:
  - `AccessWrapper` (PDF, Guiado, Álbum, Galería, Accesible), **después** del veredicto de `/access`.
  - `ImmersiveWrapper`.
  - `ContentRouter` (podcast y vídeo).
  - `EpubReaderApp`, además de cada iframe de Foliate vía `attachExtractionFriction` en el evento `load` del adapter.
- `display: contents`: no crea caja, así que el layout de los visores no cambia.
- Intercepta `copy`/`cut` (el portapapeles recibe solo «Contenido protegido en Chibalete+»), `contextmenu` y `dragstart` **solo** dentro del área editorial.
- No toca `input`, `textarea`, `select`, `contenteditable` ni `[data-chp-allow-copy]`. Tampoco el portapapeles global, el teclado, la selección ni el árbol de accesibilidad.
- Evidencia (Chrome real, fixture sintético, API = imagen de producción):

| Prueba | Guiado | Inmersivo | EPUB (iframe) | Álbum | Accesible |
|---|---|---|---|---|---|
| Ctrl+C real sobre la selección → pegado | «Contenido protegido en Chibalete+» | — | «Contenido protegido en Chibalete+» | — | — |
| copy / cut | bloqueado | bloqueado | bloqueado | — | **permitido** |
| contextmenu | bloqueado | bloqueado | bloqueado (toolbar incluida) | bloqueado (imagen) | permitido |
| dragstart | bloqueado | — | — | bloqueado (imagen) | permitido |
| input dentro de la superficie: copy / contextmenu / drag | intacto | | | | |
| `user-select` del texto | `auto` (se puede seleccionar) | `none` (como antes) | | | `auto` |

**ACCESSIBLE_COPY_POLICY: ALLOWED_FOR_ACCESSIBILITY.** Bloquear `copy` no altera el árbol de accesibilidad: en Guiado, con copy bloqueado, el lector de pantalla ve el texto real. Lo que sí rompe son las ayudas que **usan el portapapeles**: lectores TTS de portapapeles (Read&Write, ClaroRead), pegar en un editor de letra grande o de braille, o en un traductor. Por eso Accesible conserva copiar, menú contextual (leer en voz alta, traducir) y arrastre. La impresión protegida y la marca de agua siguen aplicando. Consecuencia asumida: para títulos con texto, Accesible es un camino de copia. Se documenta en §T.

## J. Impresión y Save as PDF

Mientras haya una superficie montada, `html[data-chp-protected]` está presente (con contador de montajes). Al desmontar se retira. Con `@media print`: `body > *` se oculta, y `body::before`/`::after` muestran «Contenido protegido en Chibalete+» y el marcador (`attr(data-chp-mark)`). Sin atributo, la impresión no cambia.

Chrome headless real, `Page.printToPDF` (= Guardar como PDF), con el texto extraído con `pdf-parse`:

| Superficie | Pantalla | PDF impreso |
|---|---|---|
| Guiado, Accesible, Inmersivo, PDF, Álbum, Galería, Vídeo, Podcast, EPUB | contenido y marca de agua normales | **1 página**: aviso + `Chibalete+ · <colegio> · <marcador> · <fecha>`. **0** texto del libro |
| Detalle (sin superficie, tras navegar desde un visor) | normal | 4 páginas con la ficha: se imprime normal. El atributo se retiró correctamente |

La emulación `media: print` coincide con el PDF. En pantalla no hay contaminación.

## K. Audio / vídeo

- **Vídeo local:** `controls controlsList="nodownload" disablePictureInPicture`. El menú ⋮ nativo solo ofrece «Velocidad de reproducción»: sin Descargar ni PiP. `requestPictureInPicture()` → `InvalidStateError`. El clic derecho se intercepta. Se conservan play, seek, pantalla completa y volumen.
- **YouTube:** sin tocar (`allow` sigue con picture-in-picture).
- **Podcast:** `controlsList="nodownload"` (el `<audio>` no tiene controles nativos; queda como defensa). Se eliminó el botón «Descargar podcast», que solo hacía `alert('…no implementada')`. Funcionan play, seek a 10 s, volumen y **velocidad 1.5×**. No se usa `noplaybackrate`.
- **MOOK:** `controlsList="nodownload"` + menú contextual bloqueado en el `<audio controls>`. Los controles nativos se conservan. La descarga de la transcripción se mantiene (alternativa accesible, contenido propio).
- Clasificación: FRICTION_ONLY. `nodownload` ≠ DRM.

## L. Marca de agua

- Contenido: `Chibalete+ · <colegio abreviado ≤28> · <marcador> · dd/mm/aa`.
- Marcador: FNV-1a 32 bits del `user.id`, 6 hex (p. ej. `67E24A`). No muestra id, correo, nombre, documento ni la hora exacta.
- Correlación interna: se recalcula el marcador sobre `users_db` (son datos que ya existen). No hay base nueva de marcas de agua ni criptografía; con 24 bits, la colisión en una población escolar es improbable y, si ocurre, se desambigua con el colegio y la fecha.
- Implementación:
  - Un solo `<div>` fijo con fondo SVG en data URI, repetido y rotado −24°, gris al 22 % (se lee sobre fondo claro y oscuro).
  - Desplazamiento aleatorio fijado al montar, sin animación.
  - `aria-hidden`, `role=presentation`, `pointer-events:none`, **0 nodos de texto**, fuera del árbol de accesibilidad (verificado con read_page/find).
- Superficies: Guiado, Accesible, Inmersivo, PDF, EPUB, Álbum, Galería y vídeo. Podcast no.
- Responsive: escritorio 1280, tablet 804 y ventana mínima 500 px. Sin scroll horizontal; el clic en los controles pasa a través del overlay (hit-test OK).
- Captura: visible en las capturas de PDF, EPUB, Álbum, vídeo y Guiado.

## M. Capturas de pantalla

```
WEB_SCREENSHOT_PREVENTION:  NOT_RELIABLY_POSSIBLE
SCREENSHOT_TRACEABILITY:    GREEN_LOCAL (marcador visible en una captura normal)
ANDROID_SCREENSHOT:         BLOCKED   (FLAG_SECURE en ReaderScreen, GREEN_PRODUCTION)
ANDROID_SCREEN_RECORDING:   BLOCKED
ANDROID_RECENTS:            PROTECTED
```

LU no se modifica y no lleva marca de agua: FLAG_SECURE ya cumple el objetivo.

## N. Accesibilidad

| Prueba | Resultado |
|---|---|
| Accesible: enlaces de salto (3), landmarks, `lang="es"`, h1/h2 | intactos |
| Accesible: primer Tab → «Saltar al contenido» con foco visible | OK |
| Accesible: copy / menú contextual / arrastre / selección | permitidos |
| Guiado: árbol con el texto real y copy bloqueado | OK; marca ausente del árbol |
| Marca de agua en `innerText` o en el árbol | no |
| Zoom / layout | `display: contents` y overlay fijo sin caja: sin cambios de layout ni scroll horizontal |
| OpenDyslexic / ajustes | sin cambios (no se tocaron los visores) |
| `test:a11y-reader` | 53 + 27 + 18 + 26 ✓, 0 ✗ |

**ACCESSIBILITY_REGRESSION: ZERO.**

## O. Rendimiento

Guiado, scroll programático de 2,5 s con requestAnimationFrame:

| | frames | p50 | p95 | tareas largas |
|---|---|---|---|---|
| con marca | 151 | 16,7 ms | 16,8 ms | 0 |
| sin marca | 151 | 16,7 ms | 16,8 ms | 0 |

Sin timers, observers, canvas ni animación. Un nodo DOM y dos efectos al montar. Sin regresión.

## P. Tests

| Suite | Resultado | Clasificación |
|---|---|---|
| `ContentExtractionDeterrence` *(nueva, en `test:content-rmw`)* | 76 ✓ / 0 ✗ | nueva |
| `test:content-rmw` | verde; `contentStoreRmwConcurrency` falló una vez («nunca healthy») y dio 27/0 al repetir | flake de arranque, preexistente |
| `test:a11y-reader` | verde | — |
| `test:mook` | verde (capa B: SKIP en win32, como siempre) | — |
| `test:library` | `libraryInstitutionalPersonal`: «/api/content general NO cambia su política no-store» ✗ | **preexistente**: CP-3 puso `no-store` en `/api/content`; `server/` no cambia aquí |
| `epubZipEntryResolver` | 11 ✓ | — |
| `tsc --noEmit` | 12 errores, igual que la base | preexistente |
| `npm run build` | OK | — |

## Q. Archivos

- Nuevos: `utils/contentProtection.mjs`, `components/ProtectedContentSurface.tsx`, `pages/__tests__/ContentExtractionDeterrence.test.mjs` y este documento.
- Modificados: `App.tsx` (AccessWrapper + ImmersiveWrapper), `components/ContentRouter.tsx`, `components/epub-reader/EpubReaderApp.tsx`, `components/epub-reader/foliateAdapter.mjs`, `components/GaleriaIlustraciones.tsx`, `pages/VisorAudio.tsx`, `pages/VisorVideo.tsx`, `pages/Experiencias.tsx` y `package.json` (registro del test).
- Sin cambios: `server/`, identidad, autenticación, modelo de datos, LU, nginx.

## R. Producción

`DEPLOY: NONE` · `PRODUCTION_CHANGE: ZERO`. CP-4A es **solo front**: su rollout es una imagen de front nueva.

## S. Qué podemos prometer a editoriales externas

1. **Solo lee quien tiene derecho.** El servidor decide el acceso a cada título y a cada fichero (usuario → grupo → organización, con ventanas temporales). Sin sesión o sin derecho, los ficheros responden 401/403. El catálogo no revela la ubicación de títulos sin acceso.
2. **Sin descarga desde la interfaz.** Los lectores no tienen botones de descarga, y los reproductores de audio y vídeo propios ocultan la descarga nativa y el Picture-in-Picture.
3. **Impresión neutralizada.** Imprimir o «Guardar como PDF» desde un lector produce una página con un aviso y un identificador, no el libro.
4. **Copia trivial bloqueada** en los lectores estándar (copiar, cortar, menú contextual, arrastrar). En el Modo Accesible se mantiene por razones de accesibilidad.
5. **Marca de agua visible y trazable** en los lectores web: institución, un identificador de cuenta seudónimo y la fecha. Una captura de pantalla normal la incluye y Chibalete+ puede relacionarla internamente con la cuenta.
6. **En la app Android (LU) no se pueden capturar ni grabar** las pantallas de lectura, y la copia offline está cifrada en el dispositivo con una clave no exportable. Se borra al cerrar sesión o al confirmarse la revocación.
7. **Política de originales por título** (cuando se active §F): para contenido licenciado en modo estricto, el PDF y el EPUB originales no se entregan a nadie salvo administración, con la restricción aplicada en el servidor y no solo ocultando botones.
8. **Revocación efectiva:** al retirar un derecho, el acceso web deja de funcionar en la siguiente petición, y LU purga su copia cuando el servidor confirma la revocación.

## T. Qué no podemos prometer

1. **Que lo que se muestra no pueda copiarse.** Cualquier contenido que se muestra en pantalla llega al dispositivo. Con herramientas de desarrollador, extensiones, «Guardar página», OCR o la cámara de otro dispositivo se puede extraer. La fricción web solo impide la copia **trivial**.
2. **Que no haya capturas de pantalla en la web.** No es técnicamente posible; solo se garantiza que la captura lleve la marca de agua.
3. **DRM.** Hoy no hay Widevine, FairPlay ni PlayReady. El audio y el vídeo autorizados son ficheros completos que se pueden reconstruir. Un requisito de DRM exige una unidad aparte, probablemente con un proveedor gestionado.
4. **Que el texto no llegue completo al navegador.** Las representaciones de Chibalete+ (Guiado, Accesible, Inmersivo) reciben el texto íntegro del libro para leerlo y narrarlo. «Estricto» significa no entregar **el fichero original de la editorial** (maquetación, PDF, EPUB), no que el texto sea inaccesible.
5. **Bloqueo de copia en el Modo Accesible.** Se mantiene a propósito para no perjudicar a lectores con discapacidad.
6. **Que la marca identifique a una persona por sí sola.** Es un identificador seudónimo de cuenta, correlacionable solo por Chibalete+. No es una marca forense ni resiste recortes o retoques.
7. **Marca de agua forense en audio o vídeo.** No existe.

## U. Deudas

- **Bloqueantes (para LICENSED_STRICT):** aprobar el campo de §F; después, implementar el gate de §G y §H con tests (403 PDF/EPUB strict, STANDARD sin cambios, otros modos operativos, catálogo sin `url_recurso`/`epub_url` en strict).
- **CP-4A, no bloqueantes:**
  - En el Inmersivo, la marca de agua también cubre el panel de Leo y la copia del texto de las respuestas de Leo queda bloqueada (no así su campo de entrada).
  - El texto de los nodos MOOK no tiene superficie (es contenido propio).
  - Las flechas del EPUB no se pudieron ejercitar con un fixture de una sola doble página; el listener `keydown` no cambia.
  - El fixture tuvo un problema de codificación propio («Mart�n»): el script de prueba escribió el colegio en cp1252. Es del fixture, no del código.
- **Preexistentes:**
  - `libraryInstitutionalPersonal` espera la política de caché anterior a CP-3 en `/api/content`.
  - El primer arranque de `contentStoreRmwConcurrency` es intermitente.
  - Hay 12 errores de tsc.
  - `editorial` está fijado a mano en SubirContenido y la rama «Aliada X» de Búsqueda está muerta.
  - Las ilustraciones y páginas de álbum se sirven a la resolución subida.

## V. Gate

```
EXTERNAL_CONTENT_POLICY:        NEEDS_DECISION
LICENSED_STRICT_PDF_ORIGINAL:   DENIED_BY_DESIGN (sin implementar hasta aprobar el campo)
LICENSED_STRICT_EPUB_ORIGINAL:  DENIED_BY_DESIGN (sin implementar hasta aprobar el campo)
WEB_COPY_FRICTION:              GREEN_LOCAL
WEB_PRINT_PROTECTION:           GREEN_LOCAL
WEB_DYNAMIC_WATERMARK:          GREEN_LOCAL
SCREENSHOT_TRACEABILITY:        GREEN_LOCAL
ACCESSIBILITY_REGRESSION:       ZERO
CP4A_READY_FOR_ROLLOUT_PLAN:    YES — para la disuasión (front). NO para LICENSED_STRICT.
```

## W. Siguiente

`CP-4B — PRODUCTION ROLLOUT OF EXTRACTION DETERRENCE` (solo imagen de front). En paralelo: decidir el campo de §F, que habilitaría una unidad de implementación del gate de originales.
