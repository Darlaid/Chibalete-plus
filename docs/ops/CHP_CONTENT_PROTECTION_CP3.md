# CHP-CONTENT-PROTECTION-2026-01 — CP-3: protección en el cliente

**Veredicto: `CP3_CLIENT_PROTECTION: GREEN_LOCAL_READY_FOR_ROLLOUT`**, con una decisión pendiente antes del rollout: el volumen de log de `GET /api/content` (§9).

```
R2_CATALOG_RESOURCE_LEAK:                  FIXED_LOCAL
R6_IMMERSIVE_AUTH_ORDER:                   FIXED_LOCAL
UNAUTHORIZED_IMMERSIVE_REQUESTS:           ZERO
R7_BROWSER_LOCAL_TEXT_PERSISTS:            FIXED_LOCAL
POST_LOGOUT_CONTROLLED_EDITORIAL_STORAGE:  ZERO
LU_SCREEN_CAPTURE_PROTECTION:              GREEN_LOCAL
LU_OFFLINE_STORAGE:                        ENCRYPTED
LU_LOGOUT_PURGE:                           GREEN
LU_CONFIRMED_REVOCATION_PURGE:             GREEN
LU_OFFLINE_READING:                        PRESERVED
ACCESSIBILITY_REGRESSION:                  ZERO
IDENTITY_ARCHITECTURE:                     UNCHANGED
PRODUCTION:                                UNCHANGED (sin deploy, sin APK publicado)
```

Baseline: producción `chibalete/api:contentprotect-2357ea0` con `UPLOADS_AUTHZ_MODE=strict`, front `librarytabs-f116248`, LU 0.9.1/11 (`01001ae`). No se tocó: identidad, `decideContentAccess`, autorizador estricto de `/uploads`, nginx, EPUB, ingestión canónica, TTS.

## 1. Consumidores de `GET /api/content`

| Consumidor | Clase | Campos que usa |
|---|---|---|
| `dataService.initializeFromApi` → `this.content` + `localStorage.chibalete_content` | CATÁLOGO / LECTORES | todo el registro: metadata para tarjetas, Home, Búsqueda, Experiencias; localizadores solo cuando se abre un título |
| Biblioteca (`libraryCatalogSelection`) | CATÁLOGO | ids de `my-catalog` + presentación desde la caché (`titulo`, `autor`, `portada_url`, `etiquetas`, `metricas`, `sectionIds`, `standalone`) |
| Detalle (`PaginaDetalleLibro`) | LECTORES | presencia de `texto_plano_url`, `url_recurso`, `ilustraciones_url`, `epub_url` para mostrar modos. Para un título sin acceso, `ContentRouter` ya muestra «Acceso no autorizado» antes del Detalle |
| Visores (Guiado, Accesible, PDF, Álbum, Galería, Audio, Vídeo, Inmersivo, EPUB) | LECTORES | localizadores del título abierto, siempre detrás de `/access` |
| `ContentQueue` (siguiente libro del Inmersivo) | LECTORES | `texto_plano_url` de otros títulos (precarga) |
| Admin (SubirContenido, AttachEpubPanel) | ADMIN | registro íntegro |
| LU | — | no lo usa (Fase 5: solo `/api/offline/assignment`) |

Campos editoriales: cualquier campo con una ruta `/uploads/…`, salvo `portada_url` — la misma regla del autorizador estricto (`texto_plano_url*`, `url_recurso`, `epub_url`, `canonicalBookUrl`, `ilustraciones_url`, `album_data`, `mediaAssets`…). Las URLs externas (YouTube, archive.org) no son bytes de Chibalete+ y se conservan.

## 2. R2 — catálogo saneado

`catalogForViewer` en `server.js` + `withoutEditorialLocators` en `accessService.js`. Sin store ni catálogo nuevos: se serializa el mismo registro.

- Veredicto por título = el del autorizador estricto: pedagogía por rol, resto por `decideContentAccess`. Error de la decisión → sin localizadores (fail-closed).
- Con acceso → registro íntegro. Sin acceso → metadata pública + portada, sin campos editoriales (ausentes, no `null`). Autoridad de máquina → íntegro.
- Respuesta `Cache-Control: no-store` (depende de la identidad).
- Efecto colateral deseado: `ContentQueue` ya no precarga títulos sin acceso (filtra por `texto_plano_url`).

## 3. R6 — Inmersivo

**Antes:** `ImmersiveWrapper` monta el visor sin bloquear. En el mismo commit: el efecto del engine (`[content.id]`) crea el `StartupEngine` y llama a `start()` → TXT + `manifest.json` + `anchors.json`; el efecto de `/access` corre en paralelo y, si deniega, pone un overlay.

**Después:** el engine se sigue creando con el contenido (los resets de transición entre libros no cambian), pero `start()` lo dispara un efecto que exige `accessAllowedFor === content.id`. `accessAllowedFor` solo se fija con `allowed === true` del mismo `/access` de siempre. Sin endpoint ni capa nueva. Audio/TTS dependen de las frases, que solo llegan tras `start()`.

## 4. R7 — persistencia web

| Store | Estado PRE | Contenido | Acción |
|---|---|---|---|
| `localStorage.chibalete_offline_texto` | ACTIVO (VisorTexto lo escribía en cada lectura) | libro entero | ya no se escribe ni se lee; se purga al arrancar y en logout |
| `localStorage.chibalete_content` | ACTIVO | catálogo (ahora saneado por R2) | se conserva la caché saneada; se borra en logout |
| `localStorage.gemini_cache_*` | ACTIVO | respuestas IA con fragmentos | logout |
| `sessionStorage leo_session_*`, `leo-chat-*` | ACTIVO | memoria y chat de Leo | logout |
| IndexedDB `ChibaleteDB/libros` (offlineService) | LATENTE (ninguna UI descarga) | — | sin cambios |
| Cache Storage (`registerSW`) | LATENTE (no se importa) | — | sin cambios |
| Caché HTTP | ACTIVO | copias de la época `public, immutable` | `Clear-Site-Data: "cache"` en logout |

Lectura offline web: no es una funcionalidad de producto. No hay botón de descarga (lo reemplazó la asignación a LU, `offlineAssignmentClient`); el texto solo servía de respaldo pasivo si fallaba la red. Se eliminó sin sustituto.

**Clear-Site-Data:** solo `"cache"`. Con `"storage"` se perderían las preferencias de accesibilidad y la cola de progreso pendiente (`chibalete_failed_syncs`). No se usa `"cookies"`: el logout ya revoca la sesión. Chrome 155 de escritorio: tras el logout, la portada se descargó entera (24 182 B) y la carga siguiente revalidó desde caché (300 B), así que la caché sí se vació. El re-login funciona sin bucle. No se probó en el navegador de Android.

## 5. LU (repo local, sin remoto)

- **FLAG_SECURE**: composable `SecureContentWindow()` dentro de `ReaderScreen`. Pone el flag al entrar en el lector y lo quita al salir. No hay Activity nueva. Home y Login quedan capturables (solo muestran metadata).
- **Cifrado** (`OfflineBookCipher`): AES-256-GCM de la JCA con una clave de Android Keystore no exportable, alias dedicado `chibalete_lu_offline_book_v1`. Formato `CHPLU1 | len(iv) | iv | ct+tag`, con el prefijo como AAD. El texto en claro nunca toca el disco: la descarga va a memoria (tope 32 MiB) y se escribe ya cifrada en `.part`, que luego se renombra. El texto solo existe en memoria mientras se lee. No se añade ninguna dependencia.
- **Migración desde 0.9.1**: `MigrationRunner` v3 (al arrancar) y, por si acaso, `OfflineBookRepository` (cada vez que se toca el libro) cifran `book.txt` y lo borran. Funciona con o sin red: cifrar no da ningún acceso nuevo, y el derecho se sigue comprobando por el flujo normal. Si falla, el `book.txt` legado se queda y se reintenta. Nunca se borra un libro válido.
- **Logout / cambio de usuario**: `clearOfflineBook` borra los archivos y también el alias del Keystore. Una copia residual queda ilegible.
- **401 frente a 403**: un 401 es sesión (se pide re-login y no se borra nada). Un 403 del asset protegido con sesión válida significa que el servidor confirma que ya no hay derecho: se purga el libro y se muestra «Ya no tenés acceso a este libro.». Con red y el libro listo, se hace un `HEAD` autenticado del asset (mismo veredicto que la descarga). 5xx, timeout o sin red: se conserva el libro.
- **Offline**: sin red, el libro cifrado se abre sin hacer ninguna petición. No hay expiración por tiempo.

## 6. Tests

**Web/API:**
- Contenedor Linux (`Dockerfile.api` del árbol): catalogResourceLocators 33/0 *(nuevo)*, uploadsAuthzStrict 157/0, sessionIdentityIntegration, sessionBrowserCookieOnly, sessionIdentity, epubOriginalEndpoint, progressReadIdentity, leoMemoryOwnership, authzListingScope 79/0, epubProgressSync, adminEpubAttach, b2c ×3, uploadDedup ×2, contentStoreRmwConcurrency 27/0. Todo verde.
- Windows: `test:content-rmw`, `test:memberships`, `test:explicit-access`, `test:a11y-reader` y `test:session-browser` verdes. libraryServerAuthoritative 133/0, browserNoXUserIdGuard 2/0, ClientContentProtection.structural 19/0 *(nuevo)*, contentStoreRmwSuiteIntegrity 29/0.
- `test:immersive`: 1 fallo **preexistente y ajeno** (`playbackTelemetryNonBlocking`: «fetch /api/events incluye header x-user-id», retirado en M1-A; `hooks/` no se tocó).
- Typecheck: 12 errores, todos preexistentes (mismas líneas en HEAD), 0 nuevos. `npm run build` OK.

**LU (JVM/Robolectric): 67/67 + 1 skip (live).** Nuevos:
- OfflineBookProtectionTest 11: ciphertext sin texto recuperable, modo avión, logout que borra archivo y clave + redescarga, 403 → purga, 401/5xx/sin respuesta → conservar, mismo usuario, migración sin red, MigrationRunner v3, archivo ilegible, GCM alterado.
- SecureContentWindowTest 1.

Adaptados al formato cifrado: OfflineBookRepositoryTest y ProtectedBookDownloadTest (el caso D pasa de «403 no purga (CP-1)» a «403 purga (CP-3)»). `assembleDebug` y `assembleRelease` OK; el release incluye el código CP-3 (`CHPLU1` está en el dex).

## 7. Integración local

API strict + enforce en contenedor, con un fixture temporal: 4 títulos con copias de ficheros locales, lectora con acceso a A y AL, lector sin reglas. Vite, Chrome y emulador API 37 con `adb reverse`.

| Prueba | Resultado |
|---|---|
| Catálogo de la lectora | A y AL completos; B y BL solo metadata + portada |
| `/uploads` | B → 403, A → 200, sin sesión → 401, portada pública |
| Inmersivo B (denegado), también con refresh | solo `/access`, **0 peticiones a `/uploads`**, overlay |
| Inmersivo A | `/access` termina (31 096 ms) antes de que empiece el TXT (31 103 ms) |
| `/access` retrasado 3 s | 0 bytes y sin texto mientras está pendiente; después carga normal |
| Biblioteca / Detalle A / Guiado / Accesible / PDF / Galería / Álbum | OK, sin errores |
| Detalle B | «Acceso no autorizado» (`ContentRouter`, como antes) |
| Guiado | `chibalete_offline_texto` = null tras leer |
| Logout | stores editoriales vacíos; preferencias y `chibalete_failed_syncs` intactos; `/api/content` y `/uploads` → 401 |
| LU 0.9.1 → candidata | `book.txt` en claro (156 375 B) → `book.enc` (156 410 B, `CHPLU1`, 0 apariciones de texto); lector OK |
| FLAG_SECURE | captura del lector = negro (0/0); grabación = negro; Recientes = miniatura negra; Home capturable; TalkBack/uiautomator ve el texto real |
| Modo avión | «Listo · sin conexión»; el lector abre |
| 401 (sesión expirada) | «Tu sesión expiró», libro conservado |
| 403 (acceso revocado en el servidor) | `confirmed_revocation_purge`, archivo borrado, mensaje |
| Logout / login / otro usuario | purga / redescarga cifrada / sin herencia |

## 8. Rendimiento

- `GET /api/content` con el catálogo local (61 títulos), 40 peticiones: lectora p50 8.0 → 17.3 ms (p95 30 → 38); administrador p50 7.7 → 12.1 ms. Sin regresión material en latencia.
- LU: migración completa de un libro real de 156 KB (generar clave + leer + cifrar + escribir + renombrar) en 82 ms en el emulador, una sola vez. El descifrado al abrir no se nota.

## 9. Deuda y decisión previa al rollout

1. **Volumen de log (decisión requerida):** `decideContentAccess` escribe 2 líneas por título (`[ACCESS]` y `[ACCESS_DECISION]`). Un `GET /api/content` de lector pasa de 2 a 229 líneas con 61 títulos; con los 109 de producción serán unas 400, y el front lo pide 1–2 veces por carga. Arreglarlo exige tocar `decideContentAccess` (por ejemplo, un flag de silencio en el log que no cambie la decisión), y eso está fuera del alcance autorizado de CP-3. Opciones: autorizar ese cambio, o aceptar el volumen vigilando el CPU de `dockerd`.
2. El release de LU sigue en `0.9.1/11`. El bump de versión, el QA en dispositivo real con release firmado y la publicación del APK son parte del rollout.
3. El cambio de usuario en LU sin logout no tiene ruta en la UI (después de un 401 no hay botón de login salvo «Cerrar sesión»). El purgado por otro usuario (`clearForOtherUser`) es el mismo código que el del logout. Es preexistente.
4. Audio, Vídeo y EPUB no se recorrieron en el navegador con el fixture: su código no cambia y, con acceso, reciben el registro íntegro. El EPUB queda cubierto por epubOriginalEndpoint.
5. Hay estado muerto en VisorTexto (`offlineMode` ya nunca es true) y en `offlineTextCache` (solo queda `clearOfflineText` en uso). Se dejan para no ampliar el diff.

## 10. Condiciones para el rollout de CP-3 (no ejecutado)

1. Ventana de CP-2 en producción revisada: 5xx, errores de `auth_request`, 401/403 anómalos, descargas de LU, quejas y rendimiento.
2. Decisión sobre §9.1.
3. API: imagen nueva y restart escalonado `api_1` → `api_2`. Front: imagen nueva. Rollback: imágenes anteriores (R2/R6/R7 no tienen flag).
4. LU: bump a 0.9.2/12, QA del release firmado en el Xiaomi (migración desde 0.9.1, FLAG_SECURE, modo avión, 403) y después publicar el APK.
