# CHP-CONTENT-PROTECTION-AUDIT-2026-01

Auditoría de protección de contenidos editoriales. **Solo diagnóstico — 0 cambios de código, 0 deploy, 0 datos modificados.**

Fecha: 2026-10-17 · Autor: Claude (sesión local) · Solicitante: Nicolás Jiménez

---

> ## Estado verificado en producción (CP-0 / CP-0B, 2026-10-17)
>
> El diagnóstico siguiente es el **histórico estático** y no se reescribió. Evidencia en vivo en `CHP_CONTENT_PROTECTION_CP0_LIVE_VERIFICATION.md`. Leyenda: `STATIC_FINDING` · `LIVE_CONFIRMED` · `LIVE_NOT_CONFIRMED` · `LATENT_ARCHITECTURAL_RISK`.
>
> | Afirmación de este audit | Estado en vivo |
> |---|---|
> | `/uploads/` editorial sin sesión ni control por título (riesgo 1) | **LIVE_CONFIRMED**: TXT/PDF/MP3/MP4/JPG 200 sin sesión |
> | Catálogo con URLs de todos los títulos (riesgo 2) | **LIVE_NOT_CONFIRMED**: la única cuenta lectora disponible tiene acceso a los 89 títulos generales; el handler no filtra por título → **LATENT_ARCHITECTURAL_RISK** |
> | Derivados canonical del EPUB públicos (riesgo 3) | **LATENT_ARCHITECTURAL_RISK**: no existe ningún `canonical/` de EPUB en producción; el único canonical (pedagógico) da 401/403. El título con EPUB sí expone su **PDF y su TXT legacy** sin sesión |
> | `Cache-Control: public, immutable` 30 d (riesgo 4) | **LIVE_CONFIRMED** (además, la cabecera sale duplicada) |
> | Logout/revocación sin efecto en bytes (riesgo 5) | **LIVE_CONFIRMED** para logout; revoke no ejecutado (sin fixture seguro) |
> | Inmersivo descarga antes de autorizar (riesgo 6) | **LIVE_CONFIRMED**: TXT y manifest llegan 238 ms antes del veredicto `/access` |
> | Texto completo en localStorage tras logout (riesgo 7) | **LIVE_CONFIRMED**, más el TXT en la caché HTTP |
> | LU descarga el TXT sin credencial (riesgo 9) | **LIVE_CONFIRMED** (TXT 200 anónimo + repo LU sin cookie) |
> | Riesgo `compat` / `x-user-id` (§N) | **Descartado hoy**: `SESSION_AUTH_MODE=enforce`, `SESSION_LEGACY_ALLOW` ausente, `x-user-id` → 401 |
> | Vídeo mp4 propio (§I) | Los 5 vídeos del catálogo son YouTube; existe 1 mp4 **sin referencia** servido en público |
> | Edge (§0) | `nginx -T` == `ops/edge/nginx.conf` (**LIVE_CONFIRMED**) |
> | Cabeceras (§P) | Corrección: `/` (SPA) tampoco recibe HSTS/XFO/Referrer; `/api/*` lleva `X-Frame-Options` duplicado y contradictorio (SAMEORIGIN + DENY) |
> | EPUB endpoint (§F) | **LIVE_CONFIRMED**: 401 sin sesión, 200 `private, no-cache` con derecho, 401 tras logout, `/uploads/*.epub` 403 |
>
> **CP0_LIVE_VERIFICATION: CLOSED · CP1_PROTECTED_DELIVERY_REQUIRED: YES.**

---

## 0. BASELINE Y LÍMITES DE ESTA AUDITORÍA

| Ítem | Valor |
|---|---|
| Branch | `chp/epub-mainfile-r1-release` (pushed a origin) |
| HEAD | `f116248` fix(library): reorder navigation tabs |
| Commits sobre el último deploy EPUB documentado (`epubprog-2a900a6`, 2026-10-16) | `4e99d0e` (admin EPUB create/attach), `398c8f1` (hrefs percent-encoded), `f116248` (tabs) — **estado de deploy no verificado** |
| Android LU | repo local `D:\001 - app - Chibalete LU`, HEAD `31325c0`, `versionName 0.9.0` / `versionCode 10` |
| Topología | edge `nginx:alpine` (`ops/edge/nginx.conf`) → front (nginx, `nginx.prod.conf`) + `api_1`/`api_2` (Express 5) |
| Flags de auth (último estado documentado, `CHP_V6_FINAL_EVIDENCE_PACK_01.md:63-64`, 2026-09-23) | `SESSION_AUTH_MODE=enforce`, `ACCESS_FALLBACK_MODE=restricted` |
| CDN | ninguno (single-host Hostinger) |
| Service worker | existe (`public/sw.js`) pero **no registrado** (`utils/registerSW.ts`) |

### ⚠️ Limitación declarada: NO hubo verificación en vivo

Las sondas de producción (SSH de solo lectura al VPS y `curl` anónimo/autenticado contra el dominio) **fueron bloqueadas por el clasificador de permisos** de la sesión. Por lo tanto:

- Todo lo que sigue es **análisis estático del código y configs del repo**, con citas `archivo:línea`.
- Se asume que `ops/edge/nginx.conf` del repo == config activa del edge (el evidence pack V6 indica edge sin cambios salvo `nginx -s reload`). **No verificado hoy.**
- Las pruebas de matriz NO SESSION / AUTH WITHOUT ACCESS / AUTH WITH ACCESS / ADMIN, logout y revoke **quedan como runbook pendiente** (§Z). Ningún veredicto de esta auditoría depende de una prueba que no se ejecutó sin decirlo: donde el resultado se infiere del código, se marca `[CÓDIGO]`; donde requiere confirmación en vivo, `[PENDIENTE-VIVO]`.
- Capturas/grabación de pantalla, impresión y copy se evaluaron por código y por comportamiento conocido de navegadores/OS; no se ejecutaron en dispositivo.

---

## A. VEREDICTO EJECUTIVO

**El contenido editorial de Chibalete+ NO está protegido contra descarga.** Para la gran mayoría de los formatos la protección es **P0 — PUBLIC / DIRECT**: los bytes completos y originales viven bajo `/uploads/`, el edge los sirve **sin exigir sesión ni comprobar acceso al título**, con `Cache-Control: public, max-age=2592000, immutable`.

- El control de acceso por título (`decideContentAccess`, grupo/organización/temporal) es real **solo como gate de UI**: decide si se monta el visor, no si se entregan los bytes.
- Las dos únicas excepciones con protección real de bytes son:
  1. **EPUB original** → `GET /api/content/:id/epub` autoriza por título en cada request (**P1**: autorizado pero extraíble trivialmente por el usuario legítimo). Pero sus **derivados** (`canonical/book.txt`, `canonical/book.json`, `canonical/media/*` = texto íntegro + todas las imágenes) son **públicos** (P0) para títulos no pedagógicos → la protección del EPUB es en la práctica **nominal**.
  2. **Pedagogía independiente** → protegida por **rol** (mediador/admin), no por título (P1).
- El catálogo `GET /api/content` entrega **a cualquier sesión** (incluido un comprador B2C de un solo título) las URLs de **todos** los archivos del catálogo.
- No existe DRM, URL firmada, watermark, bloqueo de copia, de impresión ni de captura en ninguna superficie web. Android no usa `FLAG_SECURE`.
- Revocar acceso o cerrar sesión **no impide** volver a descargar (URLs públicas permanentes) ni borra copias locales (localStorage, caché HTTP, `book.txt` Android).

**Afirmación contractual “el contenido no es descargable”: NO.** (Ver §U.)

---

## B. MAPA DE SUPERFICIES

Leyenda protección: A real · B fricción · C solo UI · D ninguna. Nivel: P0–P4. Impacto: L/M/H/C.

| Superficie | Formato | Endpoint de bytes | Autorización de bytes | Protección | Nivel | Impacto |
|---|---|---|---|---|---|---|
| Modo Visual (PDF) | PDF original | `/uploads/<…>.pdf` (`url_recurso`) vía edge | ninguna (204) | D (+C: visor canvas sin toolbar) | **P0** | **CRITICAL** |
| Modo Guiado | `.txt` completo | `/uploads/<id>/…txt` (`texto_plano_url`, en/pt) | ninguna | D | **P0** | **HIGH** |
| Modo Accesible | `.txt` completo | ídem | ninguna | D (correcto no añadir fricción) | **P0** | **HIGH** |
| Modo Inmersivo | `.txt` + manifest + mp3 TTS | `/uploads/<id>/…`, `/uploads/audio/<id>/manifest.json`, chunks mp3 | ninguna; además descarga **antes** del veredicto de acceso | D (`select-none` = C) | **P0** | **HIGH** |
| EPUB original | `.epub` completo | `GET /api/content/:id/epub` | sesión + `decideContentAccess` por request | A (endpoint) | **P1** | **HIGH** |
| EPUB derivados canónicos | `book.txt`, `book.json`, `canonical/media/*` | `/uploads/<id>/canonical/…` | ninguna (heredan clase GENERAL) | D | **P0** | **CRITICAL** (texto + imágenes originales del EPUB) |
| Libro Álbum | imágenes de página | `<img src=/uploads/…>` | ninguna | C (`draggable=false`, `select-none`) | **P0** | **HIGH** |
| Audio / podcasts | mp3/m4a original | `<audio src=/uploads/…>` | ninguna | D | **P0** | **HIGH** |
| Vídeo | mp4 original | `<video src=/uploads/…>` (sin `controlsList`) | ninguna | D (botón “Descargar” nativo visible) | **P0** | **HIGH** |
| Vídeo YouTube | embed | iframe YouTube | la de YouTube | n/a | n/a | L |
| MOOK nodos audio/vídeo | archivos de recurso | `/uploads/…` | ninguna (`EMBEDDED_EXPERIENCE`) | C (`useAccessCheck` UI) | **P0** | HIGH |
| MOOK transcripción | texto | blob generado (función deliberada de descarga) | — | — (feature) | — | M (decisión editorial) |
| Material pedagógico independiente | pdf/txt/… | `/uploads/…` + `auth_request` | **rol** mediador/admin (no por título) | A (rol) | **P1** | M |
| Portadas | imagen | `/uploads/…` | ninguna (`PUBLIC_ASSET`, por diseño) | D | P0 | LOW |
| Caché TTS inmersivo genérica | mp3 | `/uploads/audio/immersive/…` | ninguna (`UNMAPPED_ASSET`) | D | P0 | M |
| `POST /api/tts` | mp3 sintetizado | API | sesión + entitlement B2C, texto arbitrario | B | P1 | L |
| Android LU | `.txt` | `textoPlanoUrl` descargado **sin cookie** (`URLConnection`) | ninguna | D en tránsito; sandbox en reposo | **P0** | HIGH |
| APK | apk | `/downloads/`, `/uploads/…apk`, `/api/lu/version` | ninguna (por diseño) | — | — | L |

---

## C. ARCHIVOS ORIGINALES — qué llega hoy al cliente

| Formato | ¿Original completo al cliente? | Clasificación |
|---|---|---|
| PDF | Sí. PDF.js pide por Range, pero la URL es del archivo completo y pública. | **FULL_BYTES_DELIVERED_TO_CLIENT** + **FULL_BYTES_PUBLIC** |
| EPUB | Sí, al usuario autorizado (stream completo → `File` en memoria, `components/epub-reader/EpubReaderApp.tsx:82-109`). | **FULL_BYTES_DELIVERED_TO_CLIENT** (autorizado) |
| EPUB → texto e imágenes | Sí, a cualquiera (canónicos públicos). | **FULL_BYTES_PUBLIC** |
| Audio | Sí. | **FULL_BYTES_PUBLIC** |
| Vídeo | Sí (mp4 progresivo). | **FULL_BYTES_PUBLIC** |
| Imágenes álbum | Sí, el archivo subido tal cual (sin derivado ni resize del servidor). | **ORIGINAL**, público |
| TXT | Sí, el libro entero de una vez. | **FULL_BYTES_PUBLIC** |

Cabeceras de `/uploads/` (`ops/edge/nginx.conf:198-208`, `:77-84`) `[CÓDIGO]`:
- `Cache-Control: public, max-age=2592000, immutable` + `Expires` 30 d (pedagogía autorizada: `private, no-store`).
- Range, HEAD, ETag, Last-Modified y Content-Length: nativos de nginx (`sendfile on`). No hay `Content-Disposition` → el navegador los abre inline y “Guardar como” funciona.
- La URL es visible en Network, en el DOM (`src=`) y en `localStorage.chibalete_content`.
- Se puede repetir la request: sí, sin cookie.
- Acceso después del logout: sí (no se exige identidad).

Ocultar el botón de descarga **no** impide recuperar ninguno de estos archivos.

---

## D. TEXTO (Guiado / Accesible / Inmersivo / derivados EPUB)

- **Granularidad:** el cliente recibe el **libro completo** de una vez (`pages/VisorTexto.tsx:262-284`, `pages/VisorAccesible.tsx:272-284`, `engines/StartupEngine.ts:142-163`). Recibe mucho más texto del que necesita la pantalla actual.
- **APIs que dan el texto íntegro:** `texto_plano_url` (+ en/pt), `canonical/book.txt`, `canonical/book.json` (estructura + texto), y `manifest.json` del TTS (`sentences[]` = texto completo segmentado). Todas públicas.
- **Copy, selección, menú contextual y drag:** sin bloqueos. El texto real está en el DOM. El único `select-none` está en el contenedor del Inmersivo (`pages/VisorInmersivo.tsx:2755`, `VisorInmersivoV2.tsx:1183`) → **C**, y se salta con DevTools o con Ctrl+A en el inspector.
- **DevTools:** Elements (copy outerHTML), Network (respuesta .txt) y árbol de accesibilidad: todo expone el texto.
- **Print:** sin `@media print` ni `beforeprint` → Ctrl+P / Guardar como PDF imprime lo visible.
- **Screenshot:** sin barreras (ver L).
- **Inmersivo:** se salta `AccessWrapper` a propósito (`App.tsx:236-245`). Descarga texto y audio y los pinta **antes** de recibir el veredicto de `/access`; la denegación es solo un overlay. Un usuario sin derecho tiene el texto en el DOM.
- **Accesibilidad (restricción para el plan):** Accesible, Guiado y EPUB dependen de texto real en el DOM (lectores de pantalla, `lang`, “seleccionar para leer”, OpenDyslexic). Bloquear la selección o rasterizar rompería WCAG 1.3.1/1.4.5 y no impediría la extracción. **No es una vía válida.**

## E. PDF

| Aspecto | Estado | Clase |
|---|---|---|
| UI DOWNLOAD | Visor propio en `<canvas>`, sin toolbar de PDF.js ni botón de descarga (`pages/VisorPDF.tsx:358-393`) | C |
| RAW FILE ACCESS | `pdfjsLib.getDocument(url_recurso)` → `/uploads/*.pdf` público, cacheable 30 d inmutable (`VisorPDF.tsx:115-139`) | **D** |
| COPY | Sin capa de texto → no se puede copiar desde la UI; el PDF descargado sí lo permite | C |
| PRINT | Ctrl+P imprime el canvas visible; el PDF crudo se imprime entero desde el archivo | D |
| SCREEN CAPTURE | sin barrera | D |
| Accesibilidad | Sin capa de texto, el PDF es inaccesible para lectores de pantalla (deuda propia, ajena a la protección) | — |
| Offline | IndexedDB `ChibaleteDB/libros` puede guardar el `ArrayBuffer` completo (`services/offlineService.ts:66-75`); hoy ninguna UI lo invoca (código latente) | — |

## F. EPUB

| Aspecto | Estado |
|---|---|
| Endpoint | `GET /api/content/:id/epub` (`server/server.js:3018-3070`): sesión (`authenticatedUserIdOf`) + `decideContentAccess` **por request**; `private, no-cache`, `nosniff`, `Content-Disposition: inline; filename="<id>.epub"`, sin Range/ETag. **SERVER_AUTHORIZATION: GREEN.** |
| `/uploads/**.epub` | 403 siempre en el edge (`server.js:3100`) y en Node static (`server.js:11780`). |
| Descarga completa | Sí: stream → `File` en memoria. En Network la respuesta completa se puede guardar (DevTools “Save response”, o copiar como cURL y repetir con la propia cookie). |
| Blob lifetime | foliate crea blob URLs por recurso y los revoca (`vendor/foliate-js/epub.js:454/479, 727/753, 907`); el `File` vive mientras la pestaña esté abierta. |
| Cache | `private, no-cache` → la caché del navegador puede guardarlo pero revalida; no hay caché compartida. |
| Tras logout | La URL de API deja de servir (401) `[CÓDIGO]`. La copia ya guardada por el usuario sobrevive. |
| Reconstrucción | Trivial: es el archivo original. **Además** `canonical/book.txt`, `book.json` y `canonical/media/*` del mismo título son públicos → texto íntegro + todas las imágenes **sin sesión**. |
| Copy/select/print/drag | Sin bloqueos: el texto XHTML está en iframes seleccionables. `keydown` solo para flechas (`foliateAdapter.mjs:196-199`). |
| DevTools DOM | Expone el XHTML renderizado. |
| CFI/progreso | Metadatos de posición; no exponen contenido adicional. |

Conclusión: **autorizar el endpoint ≠ impedir la descarga.** Hoy el endpoint está bien autorizado, pero (1) el usuario legítimo obtiene el archivo original y (2) los derivados lo dejan en P0.

## G. IMÁGENES / LIBRO ÁLBUM

- `<img src={imageUrl}>` directo desde `/uploads` (`pages/VisorAlbum.tsx:1995-2025`). Se entrega el **ORIGINAL** (no hay pipeline de derivados, resize ni watermark).
- `draggable={false}` + `select-none` → C. Clic derecho → “Guardar imagen”, Network y caché 30 d siguen funcionando.
- Las rutas son predecibles bajo `/uploads/<contentId>/` y aparecen en el catálogo.
- Las imágenes internas de EPUB materializadas en `canonical/media/<sha256>.<ext>` son públicas y se listan en el `book.json` público.
- Portadas: `PUBLIC_ASSET` por diseño (aceptable).
- `alt=""` en las páginas del álbum: deuda de accesibilidad.

## H. AUDIO

- Audio editorial/podcast: `<audio src=url_recurso>` (`pages/VisorAudio.tsx:47`), archivo completo público, sin `controlsList`.
- TTS Inmersivo: `manifest.json` público lista **todas** las URLs de chunks mp3 + el texto de cada uno. Los chunks se piden uno a uno y pasan a blob URL (`hooks/useImmersivePlayback.ts:1576-1591`), con revocación. **Recomponer el libro en audio es trivial**: leer el manifest y concatenar los mp3 (mismo códec/bitrate; `cat` o `ffmpeg -f concat`). Nivel 2.
- Álbum TTS: WAV en blob, revocado (`utils/AlbumAudioManager.ts:53,197`); el origen se puede pedir de nuevo vía `POST /api/album/tts`.
- Range: sí (nginx). Caché: pública 30 d.

## I. VÍDEO

- MP4 progresivo directo (`pages/VisorVideo.tsx:81-86`), **sin `controlsList="nodownload"` ni `disablePictureInPicture`**: Chrome muestra “Descargar” en el menú del reproductor (nivel 1).
- **No hay HLS/DASH, URLs firmadas, expiración ni EME/DRM** (Widevine/FairPlay/PlayReady: 0 referencias). DRM real: **NO**.
- YouTube (iframe): fuera del perímetro de Chibalete+.

## J. CACHE / OFFLINE / STORAGE

| Almacén | Contenido editorial | ¿Se limpia en logout? |
|---|---|---|
| Caché HTTP del navegador | PDF, TXT, mp3, mp4, imágenes y canónicos (`public, immutable`, 30 d) | **No** (no se puede limpiar desde JS; `Clear-Site-Data` no se usa) |
| Cachés intermedias (proxy escolar/ISP) | Lo mismo: `public` permite almacenarlo en cachés compartidas | No controlable |
| `localStorage.chibalete_offline_texto` | **Texto completo del último libro leído** en Guiado (`utils/offlineTextCache.ts:35,61-63`) | **No** (`context/AuthContext.tsx:125-135` solo borra `chibalete_user_id`) |
| `localStorage.chibalete_content` | Catálogo con todas las URLs | **No** |
| `localStorage.gemini_cache_*` | Respuestas IA (pueden citar texto) | No |
| IndexedDB `ChibaleteDB/libros` | PDF completo (código latente, sin UI) | No |
| Cache Storage / SW | PDFs cache-first si se activara el SW (`public/sw.js:39-60`); hoy inactivo | Solo `unregisterSW()` |
| sessionStorage | memoria de Leo y del chatbot | Al cerrar la pestaña |
| Blobs | audio/EPUB, revocados | Al cerrar la pestaña |

**Respuesta a la pregunta:** después de cerrar sesión o de perder el acceso **sí queda contenido recuperable** en el dispositivo (texto completo en localStorage y archivos en la caché HTTP). En equipos compartidos de colegio, el siguiente usuario tiene el texto del último libro. `[CÓDIGO]`; la confirmación en vivo está en el runbook §Z.

## K. ANDROID (LU 0.9.0, `31325c0`)

- Lector 100 % nativo con Compose (`Text` dentro de `Column`); **sin WebView**. Solo descarga el `.txt` (`offline/OfflineBookRepository.kt:125-126`).
- La descarga usa `URL.openConnection()` **sin cookie** (`OfflineBookRepository.kt:210-229`), así que depende de que el `.txt` sea público. Cerrar `/uploads` rompería LU: **dependencia crítica para el plan**.

| Control | Resultado | Justificación |
|---|---|---|
| SCREENSHOT_BLOCK | **NO** | sin `FLAG_SECURE` (`MainActivity.kt:18-37`) |
| SCREEN_RECORDING_BLOCK | **NO** | ídem; cast y proyección permitidos |
| RECENTS_PREVIEW_PROTECTED | **NO** | sin `FLAG_SECURE` ni `setRecentsScreenshotEnabled(false)` |
| CLIPBOARD | **PROTECTED** (incidental) | `Text` sin `SelectionContainer`; no se usa ClipboardManager |
| LOCAL_CONTENT_AT_REST | **EXPOSED** | `filesDir/offline_books/current/book.txt` en claro; Room sin SQLCipher; protegido solo por el sandbox |

- **Revocación:** 401/403 **no** borra el libro (diseño M1-A, `AuthFailurePolicy.kt:11-14,46-53`). Solo se purga si el servidor responde 200 sin assignment. Un dispositivo que no vuelve a conectarse lo conserva indefinidamente. El logout explícito y el cambio de usuario sí borran (`LocalDataCleaner.kt:73-89`).
- **Manifest:** `allowBackup="false"` sin `dataExtractionRules` (D2D Android 12+ sin excluir explícitamente). No es `debuggable`. No hay cleartext en release, pero `network_security_config.xml:3-7` (main) permite cleartext a IPs LAN de desarrollo. Solo se exporta `MainActivity`. No hay FileProvider ni intents de compartir.
- **Release:** R8 activo; `keepattributes SourceFile,LineNumberTable`. Hay keystore local, no versionado.
- No hay DRM, watermark ni cifrado del contenido.

## L. SCREENSHOT / SCREEN RECORDING

**WEB_SCREENSHOT_PREVENTION: NOT_RELIABLY_POSSIBLE.**

- **Prevención:** la web no puede impedir PrintScreen, Recortes, Cmd+Shift+4, la captura del OS móvil, la grabación de pantalla ni la cámara externa. No existe ninguna API para eso. La única prevención real en navegador es la **salida protegida por EME/DRM de vídeo** (Widevine L1/FairPlay con HDCP): la ventana sale negra en capturas, y **solo para vídeo/audio cifrado**, no para texto, imágenes ni PDF.
- **Detección:** solo heurística (`visibilitychange`, `blur`, la tecla PrintScreen en Windows en algunos navegadores). No es fiable y se evita con la captura del OS.
- **Disuasión:** watermark visible o dinámico por usuario/sesión (no existe hoy).
- **Android:** `FLAG_SECURE` **sí** bloquea capturas, grabación y la miniatura de recientes a nivel de plataforma (no la cámara externa ni el root). Hoy no se usa.
- **Estado actual:** web D; Android D.

## M. COPY / PASTE / PRINT

| Lector | COPY_BLOCK_UI | COPY_BLOCK_BROWSER | COPY_BLOCK_TECHNICALLY_ROBUST | Print |
|---|---|---|---|---|
| Guiado | NO | NO | NO | permitido |
| Accesible | NO (correcto) | NO | NO | permitido |
| Inmersivo | parcial (`select-none` en mouse) | NO | NO | permitido |
| EPUB | NO | NO | NO | permitido (iframe) |
| PDF | n/a (canvas, sin texto) | archivo crudo copiable | NO | permitido |
| Álbum | `draggable=false` | NO (guardar imagen) | NO | permitido |
| Android | SÍ (incidental) | n/a | NO (accesibilidad/OCR) | n/a |

Ningún bloqueo de copia sería técnicamente robusto en web: los bytes ya llegan al cliente. `user-select:none` no es protección.

## N. AUTORIZACIÓN / REVOCACIÓN

| Endpoint | A sin sesión | B sin derecho | C con derecho | D revocado con el recurso abierto | E/F tras logout | SERVER_AUTHORIZATION |
|---|---|---|---|---|---|---|
| `/uploads/` general (PDF, TXT, audio, vídeo, álbum, canónicos, TTS) | **200** | **200** | 200 | **sigue 200** | **200** | **RED** |
| `/uploads/` pedagogía independiente | 401 | lector 403; mediador sin vínculo al título **200** | 200 | por rol, no por título | 401 | YELLOW |
| `/uploads/**.epub` | 403 | 403 | 403 | — | 403 | GREEN |
| `GET /api/content/:id/epub` | 401 | 403 | 200 | la siguiente request da 403; la copia ya descargada sobrevive | 401 | **GREEN** |
| `GET /api/content/:id/access` | 401 | `allowed:false` | `allowed:true` | re-evalúa en cada request | 401 | GREEN (solo gate) |
| `GET /api/content` (catálogo) | 401 | **200 con todas las URLs** | 200 | — | 401 | **RED** (fuga de URLs) |
| `GET /api/content/my-catalog` | 401 | filtrado | filtrado | — | 401 | GREEN |
| `POST /api/offline/assignment` (LU) | 401 | `evaluateOfflineAccess` ≠ `decideContentAccess` (`server.js:4648-4662`) | 200 | — | 401 | YELLOW |

- **POST_LOGOUT_ACCESS: POSSIBLE** (todo `/uploads/` general + copias locales). Para el EPUB, BLOCKED en el endpoint.
- **POST_REVOKE_ACCESS: POSSIBLE** (mismas razones; Android además conserva el `.txt` offline).
- **Sesión:** `chp_session` HMAC, TTL absoluto de 12 h, `httpOnly`, `SameSite=Strict`; revocación server-side en logout (`server.js:10955-10985`). Último estado documentado: `enforce`. **Si `SESSION_LEGACY_ALLOW=1` o el modo volviera a `compat`, `x-user-id` bastaría como identidad (`server/lib/sessionAuth.js:163-187`), también para `/epub`** `[PENDIENTE-VIVO]`.
- **Inmersivo:** entrega antes de autorizar (§D).

## O. WATERMARKING ACTUAL

**Ninguno**: ni visible, ni por usuario, institución o sesión, ni timestamp, ni forense, en ninguna superficie web ni Android. (`watermark` en el repo es solo el cursor del materializador de analítica.)

Superficies que podrían aceptar watermark sin romper la UX (a evaluar en el plan, sin implementar):

| Formato | Visible | Forense | Nota |
|---|---|---|---|
| PDF | sí (overlay en canvas o estampado server-side por usuario) | sí (estampado por descarga) | el overlay en canvas no marca el archivo crudo |
| EPUB | sí (CSS inyectado) | sí (marcas por usuario en el XHTML al servir) | debe preservar la accesibilidad |
| Imágenes / álbum | sí (overlay o derivado marcado) | sí (derivado por usuario) | requiere un pipeline de derivados |
| Texto HTML | overlay discreto | “canary” textual por usuario (variantes invisibles) | cuidado con lectores de pantalla y TTS |
| Vídeo | overlay visible en el player | forense requiere un proveedor (A/B segmentado) | |
| Audio | no aplica visible | forense (marca inaudible) requiere un proveedor | |

## P. HEADERS

| Header | Respuestas de Node (helmet 8, `server.js:284-287`) | Edge general (`nginx.conf:138-142`) | Edge `/uploads/` |
|---|---|---|---|
| Cache-Control | `/epub` `private, no-cache`; biblioteca `no-store`; **`/api/content` ninguno** | — | **`public, max-age=2592000, immutable`** |
| Pragma / Expires | — | — | `Expires` +30 d |
| Content-Disposition | `/epub` inline | — | ausente |
| Content-Type | correcto | — | por extensión (nginx mime) |
| X-Content-Type-Options | nosniff | nosniff | nosniff |
| CSP | **desactivada** (`contentSecurityPolicy:false`); el lector EPUB lleva CSP de build (`vite.config.ts:23-34`) | — | — |
| Referrer-Policy | `no-referrer` | `strict-origin-when-cross-origin` | **ausente** (herencia de `add_header`) |
| Permissions-Policy | ausente | ausente | ausente |
| CORP / COOP | `same-origin` (helmet) | — | **ausente** → hotlinking posible |
| COEP | desactivada | — | — |
| HSTS / X-Frame-Options | helmet | sí | **ausentes en `/uploads/`** |

Ninguna de estas cabeceras es protección de contenido. Las que sí afectan a la extracción son `Cache-Control: public, immutable` (persistencia y cachés compartidas) y la falta de CORP (embebido desde terceros).

## Q. ATTACKER MODEL

| Formato | Nivel 1 (solo UI) | Nivel 2 (navegador/DevTools) | Nivel 3 (requests con credenciales propias) |
|---|---|---|---|
| Vídeo mp4 | **basta** (menú “Descargar” nativo) | — | — |
| Audio editorial | **basta** (clic derecho → guardar audio / abrir URL) | — | — |
| Imágenes álbum | **basta** (guardar imagen) | — | — |
| PDF original | casi (captura/print del canvas) | **basta** (Network → URL → guardar) | — |
| Texto Guiado/Accesible | **basta** (seleccionar + copiar) | — | — |
| Texto Inmersivo | Ctrl+A/teclado | **basta** | — |
| Audio TTS completo | — | **basta** (manifest + concatenar) | — |
| EPUB original | — | **basta** (Network → Save response) | trivial |
| EPUB texto/imágenes | — | **basta** (`canonical/*` públicos) | — |
| Catálogo completo (todos los títulos) | — | **basta**: cualquier sesión obtiene todas las URLs de `GET /api/content` y luego las descarga **sin sesión** | — |
| Android `.txt` | captura/OCR | — | root/forense del dispositivo o URL pública |

**No hace falta el nivel 3 para obtener una copia reutilizable de ningún formato.** Y en todos menos el EPUB original, la copia ni siquiera requiere tener derecho al título.

## R. TOP 10 RIESGOS (impacto × facilidad)

1. **`/uploads/` editorial público y sin sesión** (PDF, TXT, audio, vídeo, álbum): CRITICAL × trivial. `server.js:3104-3106`, `ops/edge/nginx.conf:198-208`.
2. **Catálogo `GET /api/content` con URLs de todo el catálogo para cualquier sesión** (incluidos los B2C de un título): CRITICAL × trivial. `server.js:2725-2735`. Combinado con el 1, permite descargar el catálogo entero en bloque.
3. **Derivados canónicos del EPUB públicos** (`book.txt`, `book.json`, `media/*`): anulan la protección del EPUB original. CRITICAL × fácil. `accessService.js:263-271`.
4. **`Cache-Control: public, immutable` 30 d** en contenido de pago: persistencia en el dispositivo y en proxies compartidos (colegios). HIGH × pasivo.
5. **Revocación y logout sin efecto** sobre los bytes (URLs permanentes y deterministas): HIGH × trivial.
6. **Inmersivo descarga y pinta antes de autorizar**: HIGH × trivial para el usuario sin derecho. `App.tsx:236-245`.
7. **Texto completo en `localStorage` sin limpieza en logout** (equipos compartidos de colegio): HIGH (privacidad + contenido) × fácil. `utils/offlineTextCache.ts`, `AuthContext.tsx:125-135`.
8. **Vídeo/audio con descarga nativa del player** (sin `controlsList`): HIGH × trivial (nivel 1).
9. **Android: `.txt` descargado sin credencial y conservado tras 401/403/revocación; sin `FLAG_SECURE`**: HIGH × media.
10. **Divergencia `evaluateOfflineAccess` ≠ `decideContentAccess`** y protección pedagógica por rol en vez de por título: MEDIUM × media.

(Fuera del top: `/uploads/` sin HSTS/XFO/Referrer/CORP; CSP desactivada; código latente de IndexedDB/SW con PDFs; `x-user-id` aceptado si alguna vez se vuelve a compat o `LEGACY_ALLOW`.)

## S. GARANTÍAS POSIBLES (alcanzables con trabajo)

- **Solo un usuario autenticado y con derecho al título recibe sus bytes** (autorización por título en el edge o en Node para todo `/uploads/` editorial, sin caché pública). Es protección real (A) contra terceros, ex-usuarios y cuentas sin derecho.
- **La revocación y el logout cortan el acceso a nuevas entregas** (autorización por request y/o URLs firmadas de vida corta ligadas a sesión).
- **Sin persistencia pasiva:** `private, no-store` en contenido de pago, limpieza de almacenamiento local en logout (`Clear-Site-Data`) y no guardar libros en localStorage.
- **Entrega parcial:** servir texto por capítulo o sección en lugar del libro entero eleva el coste de extracción (B), sin romper la accesibilidad.
- **Trazabilidad:** watermark visible y/o forense por usuario/institución (disuasión + atribución de filtraciones).
- **Vídeo:** DRM real (Widevine/FairPlay/PlayReady vía EME + HLS/DASH cifrado), que impide la descarga reutilizable y, con salida protegida, también la captura del OS.
- **Android:** `FLAG_SECURE` (bloquea capturas, grabación y recientes); cifrado del contenido en reposo; purga por expiración de licencia offline.

## T. GARANTÍAS IMPOSIBLES

- Impedir capturas o grabaciones de pantalla en **web** para texto, PDF o imágenes.
- Impedir la **cámara externa** (cualquier formato, cualquier plataforma).
- Ocultar al usuario legítimo los **bytes ya entregados** a su navegador (Network, memoria, DOM).
- Ocultar el texto del **árbol de accesibilidad** sin romper la accesibilidad, y no se debe intentar.
- Impedir la **captura analógica** del audio (salida de altavoz o línea) y la de vídeo con cámara (incluso con DRM).
- Impedir la extracción de texto vía OCR de capturas.
- Garantizar el borrado de copias que el usuario **ya guardó** fuera de la app.
- En Android, proteger contra un dispositivo **rooteado** (solo se encarece).

Conclusión: lo alcanzable es **“solo usuarios autorizados reciben el contenido, por canales controlados, con trazabilidad”**, no **“el contenido no puede copiarse”**.

## U. EXTERNAL_PUBLISHER_CONTENT

**¿Se puede afirmar hoy, contractualmente, “el contenido no es descargable”? → NO.**

Por qué:
1. Los originales (PDF, audio, vídeo, imágenes) y el texto íntegro son **descargables sin cuenta** por URL directa.
2. Cualquier cuenta obtiene las URLs de **todos** los títulos.
3. El vídeo y el audio muestran la opción de descarga en el propio reproductor (nivel 1).
4. El EPUB original, aunque bien autorizado, se entrega completo al usuario, y su texto e imágenes son públicos por los derivados.
5. Ni revocar ni cerrar sesión impiden volver a descargar, y quedan copias locales.

**Qué se puede afirmar hoy con verdad (con matices):**
- “Las interfaces de lectura no ofrecen botón de descarga de PDF ni de EPUB.” (Es cierto, pero **no** describe una protección, y para vídeo y audio es falso.)
- “El acceso al lector está condicionado a una licencia del usuario o institución.” (Cierto para la UI, falso para los bytes.)
- “El archivo EPUB original solo se entrega a usuarios autenticados con derecho al título.” (Cierto para el `.epub`; **no** para su contenido, que se expone vía `canonical/`.)

Incluso tras las correcciones estructurales, la formulación defendible será **ONLY_WITH_QUALIFICATION**: del estilo de “el contenido se entrega solo a usuarios autorizados mediante lectores sin función de descarga, con medidas técnicas razonables y trazabilidad; ninguna plataforma web puede impedir la captura de pantalla”. No se redactan cláusulas en esta unidad.

## V. QUICK WINS (solo identificados, NO ejecutados)

1. Quitar las URLs de archivo de la respuesta de `GET /api/content` para quien no administra (o para todos, salvo los campos estrictamente necesarios por título autorizado).
2. Cambiar `Cache-Control` de `/uploads/` editorial a `private`, sin `immutable` (portadas aparte).
3. `controlsList="nodownload noplaybackrate"` + `disablePictureInPicture` en `<video>` y `<audio>` (C: elimina el nivel 1, no protege los bytes).
4. Limpiar `chibalete_offline_texto`, `chibalete_content` y `gemini_cache_*` en logout; valorar `Clear-Site-Data: "cache","storage"` en `/api/auth/logout`.
5. Que el Inmersivo no pida texto ni audio hasta tener el veredicto de `/access`.
6. Clasificar `canonical/*` de títulos con EPUB con al menos la misma restricción que el `.epub` (requiere que el lector EPUB no dependa de ellos; Accesible y Guiado sí dependen hoy).
7. Restaurar en `/uploads/` las cabeceras perdidas (HSTS, Referrer, CORP `same-origin`).
8. Android: `FLAG_SECURE` en la Activity del lector; `dataExtractionRules` explícito; retirar las IPs LAN del `network_security_config` de main.
9. Alinear `evaluateOfflineAccess` con `decideContentAccess`.
10. Eliminar o aislar el código latente de IndexedDB/SW que guarda PDFs completos.

⚠️ Los quick wins 2, 5 y 6 interactúan con LU (descarga sin cookie) y con el rendimiento (caché): requieren diseño en el plan.

## W. CAMBIOS ESTRUCTURALES POSIBLES (solo identificados)

1. **Autorización por título de todo `/uploads/` editorial** en `auth_request` (reutilizando `decideContentAccess`), o paso a un endpoint de entrega `/api/content/:id/asset/...` con `X-Accel-Redirect`. Requiere migrar LU a descargar con cookie.
2. **URLs firmadas de vida corta** ligadas a usuario y sesión (HMAC + expiración) para los medios. Aportan contra URLs compartidas y post-revocación; **no** resuelven la extracción por el usuario legítimo.
3. **Entrega fragmentada de texto** (capítulo o ventana) desde el CanonicalBook con autorización por request, manteniendo el texto real en el DOM para accesibilidad.
4. **PDF:** rasterizado server-side por página (imágenes por página autorizadas) o estampado del PDF por usuario; evaluar el coste en accesibilidad, porque el PDF ya es inaccesible hoy.
5. **EPUB:** servirlo por recurso (spine item por request) en lugar del zip completo, y/o estampado forense por usuario al servir.
6. **Vídeo:** HLS/DASH + DRM (EME, Widevine/FairPlay/PlayReady), vía proveedor gestionado; es la única protección P4 disponible en web.
7. **Audio:** segmentos autorizados y no listables públicamente; watermark forense si lo exigen los editores.
8. **Watermark** visible dinámico (usuario, institución, fecha) en los lectores, y forense server-side en PDF, EPUB e imágenes.
9. **Android:** licencias offline con expiración, contenido cifrado en reposo (EncryptedFile / Keystore) y purga ante revocación verificada.
10. **Pipeline de derivados de imagen** (resolución de pantalla, no el original).

## X. DEUDAS (detectadas, fuera del alcance de la corrección)

- La pedagogía se restringe por rol, no por título (un mediador ve toda la pedagogía).
- `/uploads/` pierde HSTS, XFO y Referrer-Policy por la herencia de `add_header`.
- CSP global desactivada.
- `express.static(UPLOAD_DIR)` en Node (`server.js:11780-11781`) y proxy `/uploads/` del contenedor front (`nginx.prod.conf:52-61`) sin autorizador: hoy no se alcanzan desde el edge, pero son una ruta paralela no protegida.
- Código latente con PDFs completos en IndexedDB y SW.
- PDF sin capa de texto (inaccesible); `alt=""` en el álbum y en las imágenes de EPUB.
- LU descarga sin credencial; 401/403 no purga.
- `.env` productivo con `ACCESS_FALLBACK_MODE=open` (el valor efectivo `restricted` depende de un override; deuda previa `ACCESS_FALLBACK_ENV_SOURCE`).
- `POST /api/tts` con `Cache-Control: public` y texto arbitrario (coste y abuso, no contenido).

## Y. RECOMENDACIÓN PARA EL PLAN DE ACCIÓN

1. **Antes de cualquier conversación con editoriales externas**, cerrar los riesgos 1–3 (bytes públicos, fuga del catálogo, derivados EPUB). Es el cambio que pasa la protección de “P0 público” a “P1 autorizado”, y es requisito de todo lo demás.
2. Diseñar ese cierre **con LU dentro del alcance**: hoy la app Android depende de que el `.txt` sea público.
3. Tratar la caché (`public, immutable`) y el almacenamiento local en la misma unidad: sin eso, la revocación sigue sin efecto.
4. Después, quick wins de UX (`controlsList`, orden de autorización del Inmersivo, limpieza en logout, `FLAG_SECURE`).
5. Decidir por formato y con los editores qué nivel se compromete: P2 (fricción + watermark) para texto, EPUB y PDF; P4 (DRM) solo si hay vídeo de terceros que lo exija.
6. Mantener como principio que **la accesibilidad no se sacrifica por medidas cosméticas**: la protección vive en la entrega (servidor), no en el DOM.
7. Antes del plan, ejecutar el runbook en vivo §Z para convertir las marcas `[CÓDIGO]` en evidencia.

---

## Z. RUNBOOK DE VERIFICACIÓN EN VIVO (pendiente; no ejecutado por bloqueo de permisos)

Solo lectura, con contenido de prueba o la cuenta propia del operador. Sin credenciales ajenas.

1. **Baseline:** `docker ps --format '{{.Names}} {{.Image}}'`; `docker inspect` de los env `SESSION_AUTH_MODE`, `SESSION_LEGACY_ALLOW` y `ACCESS_FALLBACK_MODE` en api_1/api_2; `docker exec chibalete_edge nginx -T | sed -n '/location \^~ \/uploads/,/}/p'`, comparado con `ops/edge/nginx.conf`.
2. **NO SESSION:** `curl -sI https://<dominio>/uploads/<id-no-pedagógico>/<archivo>.pdf|.txt|.mp3|.mp4` y `…/canonical/book.txt` de un título EPUB → se espera 200 + `public, immutable`.
3. `curl -sI …/<x>.epub` → 403; `curl -s -o /dev/null -w '%{http_code}' https://<dominio>/api/content/<id>/epub` → 401; `curl -H 'x-user-id: <id-propio>' …/epub` → debe dar 401 en enforce.
4. **AUTH WITHOUT ACCESS** (cuenta de prueba sin el título): `GET /api/content` → ¿lista `texto_plano_url`/`url_recurso` de títulos no asignados? `/epub` del título → 403.
5. **AUTH WITH ACCESS:** `/epub` → 200, `private, no-cache`.
6. **Logout:** repetir los puntos 2 y 5 con la cookie revocada → 2 sigue 200; 5 da 401. En el navegador, tras logout, comprobar `localStorage.chibalete_offline_texto`.
7. **Revoke:** retirar una regla de prueba en `access_db` (operación autorizada aparte) → `/access` false, `/epub` 403 y `/uploads` sigue 200.
8. **Headers:** `curl -sI` a `/`, `/api/content` (con sesión) y `/uploads/...` para registrar CSP, Referrer, CORP, HSTS y XFO.
