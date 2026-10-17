# CHP-CONTENT-PROTECTION-2026-01 · CP-1 — PROTECTED DELIVERY FOUNDATION

Fecha: 2026-10-17 · Base: `chp/epub-mainfile-r1-release` @ `f116248` (prod API `398c8f1`, front `f116248`).

**Veredicto: `CP1_PROTECTED_DELIVERY_FOUNDATION: GREEN_LOCAL_READY_FOR_ROLLOUT`.**

Esta unidad no incluyó deploy de API, front ni edge, ni publicación del APK. `PRODUCTION_UPLOADS: STILL_PUBLIC`, como estaba previsto.

```
PROTECTED_UPLOAD_AUTHORIZER:          GREEN_LOCAL
CONTENT_ASSET_ACCESS:                 SERVER_AUTHORITATIVE (decideContentAccess)
PUBLIC_ASSET_ALLOWLIST:               GREEN
UNMAPPED_DEFAULT:                     DENY (salvo administrador)
WEB_PROTECTED_UPLOAD_COMPATIBILITY:   GREEN_LOCAL
LU_AUTHENTICATED_DOWNLOAD:            GREEN_LOCAL
LU_PUBLIC_UPLOAD_DEPENDENCY:          REMOVED_IN_CANDIDATE
IDENTITY_ARCHITECTURE:                UNCHANGED
PRODUCTION_UPLOADS:                   STILL_PUBLIC (expected)
```

## 1. Arquitectura reutilizada

| Pieza | Dónde | Uso en CP-1 |
|---|---|---|
| `location ^~ /uploads/` + `auth_request /internal/uploads-authz` | `ops/edge/nginx.conf:198-208` (== prod, CP-0) | **Sin cambios.** Ya propaga 401/403 y mapea `X-CHP-Cache: private` → `private, no-store` |
| `GET /api/internal/uploads-authz` | `server/server.js` | Se extiende con una rama estricta |
| `normalizeUploadRequestPath` | `server/accessService.js` | Sin cambios: decodifica una vez y bloquea traversal, backslash y NUL |
| `classifyUploadPath` (01D-B) | `server/accessService.js` | **Intacto**: contrato legacy |
| Convenciones de dueño TTS (`audio/<id>/`, `safeAudioSegment`) y canonical (`<id>/canonical/`) | `server/accessService.js` | Reutilizadas |
| `resolveViewerPrincipal` / `viewerSeesPedagogy` | `server/server.js` | Identidad: cookie en `compat`/`enforce`, máquina vía admin-secret |
| `decideContentAccess(userId, contentId)` | `server/server.js` | **Única autoridad** para los assets de contenido |

Motivo del 204 actual: `uploads-authz` devuelve 204 a todo lo que `classifyUploadPath` no marca como `PEDAGOGY_RESTRICTED`, sin consultar identidad (01D-B solo protegía la pedagogía).

## 2. Inventario productivo de rutas (read-only, 2026-10-17)

Se ejecutó en `chibalete_api_1` con el `classifyUploadPath` desplegado. Solo se leyó metadata: no se abrió ningún cuerpo editorial.

**Catálogo:** 109 contenidos (GENERAL 74 · PEDAGOGY_RESTRICTED 20 · EMBEDDED_EXPERIENCE 15). Contienen 1.081 rutas `/uploads` distintas.

| Familia | Ref. | Disco | Asociación a contentId | Pública deliberada | Compartida | Huérfanos / sin dueño |
|---|---|---|---|---|---|---|
| `/uploads/<content-id>/<file>` | 1.049 | 1.066 | Por referencia: 1.046 con 1 dueño, 3 con 2 dueños. 35 están en una carpeta distinta de la del dueño | Portadas (301 hoy públicas con `ilustraciones_url`) | 3 (1 portada, 1 página de álbum, 1 `url_recurso`) | 17 sin referencia + 2 carpetas de contenidos borrados |
| `/uploads/<file>` (raíz) | 31 | 40 | Por referencia, 1 dueño cada uno (mp3/txt de la era MOOK) | 3 slides de `landing_banner.json` | — | 6 sin referencia |
| `/uploads/audio/<id>/…` (TTS, álbum TTS) | 0 | 580 | Por convención: 578 con dueño | — | — | 2 (contenido borrado, `verify-…`) |
| `/uploads/audio/immersive/…` | 0 | 1.670 | **Sin dueño** (caché por hash de texto) | — | — | Se sirve por `POST /api/tts` como bytes, **nunca por URL** |
| `/uploads/<id>/canonical/…` | 1 | 1 | Por referencia y por convención | — | — | — |
| `/uploads/*.apk` | 0 (lu_config: 1) | 4 | — | Sí (distribución LU) | — | — |
| `/uploads/experience-covers/…` | 0 (mook_db: 1) | 1 | — | Sí (carátula) | — | — |

Otros stores con `/uploads`: solo `landing_banner.json` (3), `lu_config.json` (1) y `mook_db.json` (1).

## 3. Coverage gate

```
REFERENCED_EDITORIAL_ASSETS_CLASSIFIED:  100 %  (1.081/1.081 por referencia; TTS por convención)
PUBLIC_ASSETS_CLASSIFIED:                100 %  (portadas, banner, APK, experience-covers)
UNMAPPED_REFERENCED_ASSETS:              0
```

Los UNMAPPED son siempre ficheros **no referenciados**: huérfanos, restos de contenidos borrados y la caché inmersiva. Ninguna superficie los pide por URL. No hace falta ninguna heurística, ninguna migración de datos ni ningún store nuevo.

## 4. Clasificación estricta (`resolveUploadAsset`)

| Clase | Regla | Sin sesión | Sin derecho | Con derecho |
|---|---|---|---|---|
| PUBLIC_ASSET | Referenciada como `portada_url` (prevalece aunque otro registro la use como contenido); slide de `landing_banner.json`; `/uploads/experience-covers/`; `*.apk` en la raíz | 204 | 204 | 204 (caché pública) |
| CONTENT_ASSET | Referenciada en cualquier otro campo (incluye `ilustraciones_url` y `album_data`); si no hay referencia, dueño TTS o canonical por convención | **401** | **403** | **204 + `X-CHP-Cache: private`** |
| PEDAGOGY | Dueño `PEDAGOGY_RESTRICTED`: contrato 01D-B por **rol**, sin rediseño | 401 | lector 403 | mediador/admin 204 |
| RAW EPUB | `*.epub` | 403 | 403 | 403 (solo `GET /api/content/:id/epub`) |
| UNMAPPED | Nada de lo anterior | 403 | 403 | administrador 204 (vista previa de subidas aún no guardadas) |

Asset con varios dueños: se autoriza si el usuario tiene acceso a **cualquiera** de los registros que lo referencian explícitamente. Ejemplo: un fichero pedagógico y general a la vez se autoriza por la referencia general o por el rol.

**Cambio deliberado frente a legacy:** `ilustraciones_url` deja de ser pública en modo estricto. Son ilustraciones interiores que solo se usan en Galería y VisorTexto.

**Excepción observada en local:** si la página 1 de un álbum es el mismo fichero que su portada, queda pública por la regla de portada. Las demás páginas son privadas.

## 5. Resolución contentId

Es siempre **server-authoritative**: los dueños salen de las referencias del catálogo (`content.json`) y de las convenciones de ruta ya existentes. Nunca de parámetros del request: el query string se descarta y la carpeta no se usa como dueño salvo en las convenciones TTS/canonical.

No hay índice ni store nuevo. Se recorre el catálogo en cada request, igual que `classifyUploadPath`.

La ruta del request **no se decodifica dos veces**: lo que se compara es exactamente lo que sirve nginx. Esto corrige una ambigüedad latente del legacy.

## 6. Autorizador general

- **Flag:** `UPLOADS_AUTHZ_MODE`. Vale `legacy` por defecto o ante cualquier valor desconocido; con `strict` activa la rama nueva. El valor efectivo se registra al arrancar: `[BOOT] UPLOADS_AUTHZ_MODE=…`.
- **`decideUploadAssetAccess`** (pura, en `accessService.js`) devuelve `PUBLIC | AUTHORIZED | UNAUTHENTICATED | FORBIDDEN | UNMAPPED`.
- **`strictUploadVerdict`** (en `server.js`) la conecta a `resolveViewerPrincipal`, `viewerSeesPedagogy`, `decideContentAccess` y al banner. La usan:
  - `GET /api/internal/uploads-authz` (edge): 204/401/403, más `X-CHP-Cache: private`;
  - `app.use('/uploads', …)` delante de `express.static`, solo en modo strict: 401/403 o `Cache-Control: private, no-store`. Cierra la ruta paralela de Node (contenedor front y desarrollo local).

## 7. Identidad

Arquitectura sin cambios. En el test `enforce` (cookie real):
- sin cookie → 401;
- solo `x-user-id` → 401;
- cookie sin acceso → 403;
- cookie con acceso → ALLOW;
- cookie revocada por logout → 401.

## 8. Compatibilidad web (strict + enforce, local)

Todas las peticiones a `/uploads` son same-origin sin `credentials: 'omit'` ni `crossOrigin`, así que el navegador envía `chp_session` solo. PDF.js usa `credentials: same-origin`. **No hubo que modificar ningún visor.**

Montaje: API en contenedor Linux (`Dockerfile.api` del árbol actual), Vite en `localhost:5173` y Chrome. Fixture temporal con 3 títulos propios (TXT+PDF+EPUB, álbum y podcast en la raíz), un lector con acceso y otro sin acceso.

| Superficie | Lector con acceso | Lector sin acceso |
|---|---|---|
| Biblioteca / Detalle | OK (portadas públicas) | portadas OK |
| Guiado | OK (TXT completo + manifest TTS) | sin bytes (gate de UI) |
| Accesible | OK | — |
| Inmersivo | OK (TXT + manifest) | **TXT/manifest 403, 0 bytes** + overlay «Acceso no autorizado» |
| PDF | OK (113 peticiones por rango 200, canvas pintado) | denegado, sin bytes |
| Álbum | OK (páginas + audio ambiente) | denegado (solo portada) |
| Galería (ilustraciones) | OK (13 imágenes) | 403 |
| Audio/podcast (mp3 en raíz) | OK (`readyState 4`, reproduce) | 403 |
| EPUB (`epub-reader.html`) | OK (renderiza; `/epub` 200 `private, no-cache`) | `/epub` 403 |

**R6 (Inmersivo pide los bytes antes de autorizar) sigue existiendo en el código**, pero en strict el servidor ya no entrega bytes sin derecho. La corrección del orden queda para CP-2/CP-3.

## 9. LU

- **Autenticación actual (sin cambios):** login → `Set-Cookie: chp_session` → `PersistentCookieJar` (solo esa cookie, cifrada en `EncryptedSharedPreferences`) → `AuthInterceptor` (UA, `Sec-Fetch-Site`, política 401/403). La descarga del TXT usaba un `URLConnection` aparte, **sin cookie**.
- **Cambio mínimo:**
  - `ApiClient.httpClient`: expone el **mismo** OkHttp de la API.
  - `OfflineBookRepository.downloadToPart` usa ese cliente; una respuesta no-2xx lanza `DownloadHttpException(code)`, que no escribe nada ni toca el libro previo.
  - `AuthFailurePolicy`: un 403 en `/uploads/` → IGNORE (sin derecho al título, re-login no lo arregla); un 401 sigue en REQUIRE_REAUTH.
- **Sin token nuevo:** no se envían `x-user-id`, admin-secret ni credenciales en la URL.
- **Fuera de alcance (CP-3):** FLAG_SECURE, cifrado del `book.txt`, purga por revocación, expiración offline. Ante 401/403 el libro previo **no** se borra.

## 10. Tests

| Suite | Resultado |
|---|---|
| `server/__test__/uploadsAuthzStrict.test.mjs` (nuevo; Linux, server.js real, `enforce` + cookie) | **157/0**: matriz A–M, rutas reales (compartidas, raíz, carpeta ajena), seguridad de ruta, logout, regresión legacy |
| LU `ProtectedBookDownloadTest` (nuevo, MockWebServer) | 4/4: 401 sin sesión · 200 con cookie enviada y book.txt intacto · 403 sin purga · logout → 401 |
| LU `ProtectedBookDownloadLiveTest` (nuevo, opcional por variables de entorno) | **1/1 contra la API strict real del contenedor**: 401 / 200 / 401 tras logout / 403. Omitido por defecto |
| LU suite completa | 55/55 (+1 live omitido) · `assembleDebug` + `assembleRelease` OK |

`uploadsAuthzStrict` entra en `test:content-rmw`, que es el gate de CI en ubuntu. En plataformas sin POSIX se declara **SKIP** explícito, porque la sesión firmada es fail-closed en Windows.

**Regresiones:**
- **Linux (contenedor):** epubOriginalEndpoint 32/0, sessionIdentityIntegration 34/0, sessionBrowserCookieOnly 13/0, sessionIdentity 42/0, authzListingScope 79/0, leoMemoryOwnership 72/0, progressReadIdentity 27/0, epubProgressSync 39/0, adminEpubAttach 42/0.
- **Windows:** pedagogyAccess01dB 100/0, explicit-access, memberships, b2c, content-rmw (todo verde), uploadDedup 34/0 y 10/0.
- **Front:** `npm run build` OK. No hay cambios de front, así que el typecheck no cambia.

**Preexistente ajeno a CP-1:** `libraryInstitutionalPersonal` §13 da 4 fallos, con y sin los cambios (`git stash`): el fixture de entitlement depende de la fecha.

## 11. Seguridad de ruta (cubierta en el test)

| Caso | Resultado |
|---|---|
| `../` y `%2e%2e` | 404 |
| `%252e%252e` | 403 (sin doble decode) |
| Backslash literal o `%5c` | 404 |
| Fuera de `/uploads` | 404 |
| Query que intenta cambiar dueño | ignorado → 403 |
| Percent-encoding legítimo | 204 |
| Dueño ajeno | 403 |
| Segmento TTS ajeno | 403 |
| Canonical ajeno | 403 |
| Contenido borrado o carpeta inexistente | 403 |
| Static: traversal codificado | sin bytes |

## 12. Archivos

**Chibalete+:**
- `server/accessService.js`: `UPLOAD_ASSET_DECISION`, `resolveUploadAsset`, `decideUploadAssetAccess`.
- `server/server.js`: flag, `strictUploadVerdict`, rama strict del autorizador, guard de `express.static`.
- `server/__test__/uploadsAuthzStrict.test.mjs`.
- `package.json` (`test:content-rmw`).
- Docs CP-0/CP-1.

**LU:** `ApiClient.kt`, `OfflineBookRepository.kt`, `AuthFailurePolicy.kt`, `ProtectedBookDownloadTest.kt`, `ProtectedBookDownloadLiveTest.kt`.

## 13. Riesgos y deudas restantes

1. **Producción sigue pública** (R1/R4) hasta CP-2.
2. **Coste por asset:** cada petición a `/uploads` pasa por `auth_request` → `decideContentAccess`, que lee los JSON de users/content/access/groups. Un álbum de 600+ imágenes multiplica las subpeticiones. **Medirlo en el canario de CP-2**; si hiciera falta, un índice en memoria derivado del catálogo, sin store nuevo.
3. **`private, no-store`** obliga a volver a descargar PDF y audio grandes en cada apertura. PDF.js ya pide por rangos. Revisarlo con datos en CP-2.
4. **R2:** `GET /api/content` sigue entregando las URLs de todo el catálogo a cualquier sesión. Con strict ya no basta para obtener bytes, pero es una fuga de metadatos.
5. **R6/R7:** el Inmersivo sigue pidiendo bytes antes del veredicto, y `localStorage` conserva el texto tras el logout.
6. **LU:** un libro ya descargado sobrevive a 401/403 (CP-3). La población con APK ≤ 0.9.0 **depende de `/uploads` público**.
7. La pedagogía sigue protegida por rol y no por título (contrato 01D-B).
8. 5 PNG huérfanos en la raíz, 17 en carpetas de contenido y 2 restos TTS: quedan denegados en strict. Limpieza opcional.
9. `/api/internal/uploads-authz` es alcanzable vía `/api/` y responde solo un veredicto, sin bytes (preexistente).

## 14. Condiciones para CP-2 (ROLLOUT + ENFORCE)

1. Deploy de la API con este código y **`UPLOADS_AUTHZ_MODE` ausente o `legacy`**: comportamiento idéntico al actual. Verificar `[BOOT] UPLOADS_AUTHZ_MODE=legacy`.
2. Publicar LU **0.9.1+** con la descarga autenticada y medir la adopción por UA. Decidir qué se hace con los dispositivos ≤ 0.9.0: forzar la actualización o aceptar que no descarguen libros nuevos.
3. Canario: `UPLOADS_AUTHZ_MODE=strict` en **una** réplica (drain del edge por instancia), con matriz en vivo:
   - sin sesión, sin derecho y con derecho;
   - portadas y banner públicos;
   - PDF por rangos, álbum, galería, audio, TTS y EPUB;
   - latencia del autorizador.
4. Activar `strict` en ambas réplicas. El edge no cambia: `X-CHP-Cache: private` ya produce `private, no-store`.
5. Rollback: quitar la variable y reiniciar la réplica (vuelve a legacy).
6. Después: R2 (sanear `GET /api/content`), R6 (Inmersivo), R7 (limpieza en logout) y CP-3 en LU.
