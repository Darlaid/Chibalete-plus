# CHP-CONTENT-PROTECTION-2026-01 · CP-0 — LIVE PRODUCTION VERIFICATION

Fecha: 2026-10-17 · Solo lectura · 0 cambios de código/config/datos · sin commit · sin deploy.
Base: `docs/ops/CHP_CONTENT_PROTECTION_AUDIT_2026_01.md`.

## A. Veredicto CP-0

**CP0_LIVE_VERIFICATION: STOP_PARTIAL**

- Verificado en vivo, sin sesión: R1, R4 y R8. También la configuración del edge, los flags de auth y las cabeceras.
- Faltan las sondas autenticadas (§G, §H, §J, §K, §M y la mitad de R7). No dispongo de una sesión **no-admin** propia o de prueba. No usé credenciales ajenas ni creé cuentas.
- Dirección provisional: **GREEN_WITH_STATIC_AUDIT_CORRECTIONS**. R3 no se confirma tal como estaba formulado (ver §S), aunque el riesgo de fondo se mantiene por otra vía.

## B. Baseline productivo

| Ítem | Valor |
|---|---|
| Branch / HEAD local | `chp/epub-mainfile-r1-release` / `f116248` (= origin) |
| `main` remoto | `7767c4f` |
| api_1 / api_2 | `chibalete/api:adminepub-398c8f1`, imagen `sha256:18d98cee…`, `GIT_SHA=398c8f1`, healthy, 0 reinicios, arranque 2026-10-16T18:28Z |
| front | `chibalete/front:librarytabs-f116248`, imagen `sha256:ee48a1fb…`, healthy, 0 reinicios, arranque 2026-10-16T21:32Z |
| edge | `nginx:alpine`, imagen `sha256:582c496c…`, healthy, 0 reinicios |
| `/api/health` | 200 |

## C. Flags de auth efectivos (entorno del contenedor)

| Flag | api_1 | api_2 |
|---|---|---|
| `SESSION_AUTH_MODE` | `enforce` | `enforce` |
| `SESSION_LEGACY_ALLOW` | **ausente** (= OFF) | **ausente** |
| `ACCESS_FALLBACK_MODE` | `restricted` | `restricted` |

Sonda: `GET /api/content/<epub>/epub` con solo `x-user-id` (id sintético documentado e inexistente) da 401. En `enforce` sin `LEGACY_ALLOW` el código responde 401 **antes** de buscar el usuario (`server/lib/sessionAuth.js:164-167`), así que la cabecera legacy no se acepta para ningún id. No probé con un id real ajeno, a propósito.

## D. Edge real vs repo

`docker exec chibalete_edge nginx -T`: `/etc/nginx/nginx.conf` es **byte-idéntico** a `ops/edge/nginx.conf`. La única diferencia es una línea vacía final. El include `dynamic/upstream-api.conf` es el pool `least_conn` api_1 + api_2.

**EDGE_CONFIG_MATCH_REPO: YES.** `location ^~ /uploads/` con `auth_request /internal/uploads-authz`, maps de caché `public, max-age=2592000, immutable` / `private, no-store`, y bloqueo de `.epub` en el autorizador.

## E. Recursos usados

Todo el catálogo productivo (109 registros) lleva `editorial = "Chibalete"`: no se tocó contenido de editoriales externas.

| Clave | contentId | Tipo | Recurso |
|---|---|---|---|
| A TXT | `content-1765751139919` | libro | `…/la_metamorfosis_esp-….txt` (124 KB) |
| B PDF | `content-1765751139919` | libro | `…/la_metamorfosis___taco-….pdf` (42 MB) |
| C Audio | `child-content-1765751724398-0-…` | podcast | `…/war_of_the_worlds_1938_….mp3` (55 MB) |
| D Vídeo | (sin referencia en el catálogo) | mp4 en `/uploads/content-1765751724398/` | `…/le_voyage_dans_la_lune_….mp4` (87 MB). Los 5 vídeos del catálogo son YouTube; este mp4 está en disco sin referencia → `UNMAPPED_ASSET` |
| E Álbum | `content-1776006983915` | libro_album | `…/sol_de_los_venados-….jpg` |
| F EPUB + canonical | `content-1773325007384` | libro (Alicia) | **No tiene `canonical/`** (el directorio no existe). El único `canonical/` de producción es `content-1765837262553` (articulo_pedagogico, piloto TXT 2C) |
| G EPUB original | `content-1773325007384` | libro | `epub_url` presente (49 MB). Es el **único** registro con EPUB en producción |

No se guardó ningún cuerpo: sondas `HEAD`, más un `GET` con `Range: bytes=0-0` descartado a `/dev/null`.

## F. Matriz NO SESSION (medida)

| Recurso | Status | Content-Type | Cache-Control | Length | ETag / Last-Mod | Disposition | Accept-Ranges | HSTS / XFO / Referrer / CORP |
|---|---|---|---|---|---|---|---|---|
| TXT (A) | **200** | text/plain | `max-age=2592000` **+** `public, max-age=2592000, immutable` | 124375 | sí / sí | ausente | bytes | **ausentes** |
| PDF (B) | **200** | application/pdf | ídem | 42492695 | sí / sí | ausente | bytes (Range → **206**, `Content-Range 0-0/42492695`) | ausentes |
| MP3 (C) | **200** | audio/mpeg | ídem | 55412113 | sí / sí | ausente | bytes | ausentes |
| MP4 (D) | **200** | video/mp4 | ídem | 87327132 | sí / sí | ausente | bytes | ausentes |
| JPG álbum (E) | **200** | image/jpeg | ídem | 120896 | sí / sí | ausente | bytes | ausentes |
| TXT de Alicia (título con EPUB) | **200** | text/plain | ídem | 156375 | sí / sí | ausente | bytes | ausentes |
| `.epub` directo bajo `/uploads` | **403** | text/html | — | — | — | — | — | — |
| `content-1765837262553/canonical/book.json` (pedagogía) | **401** | text/html | — | — | — | — | — | — |
| `content-1773325007384/canonical/book.txt` | **404** (no existe) | — | — | — | — | — | — | — |
| `GET /api/content` | 401 | json | — | | | | | presentes |
| `GET /api/content/my-catalog` | 401 | json | | | | | | presentes |
| `GET /api/content/<epub>/access` | 401 | json | | | | | | presentes |
| `GET /api/content/<epub>/epub` | **401** | json | | | | | | presentes |

## G. AUTH WITHOUT ACCESS — **NO EJECUTADO** (falta una sesión no-admin de prueba)
## H. AUTH WITH ACCESS — **NO EJECUTADO** (ídem)

## I. EPUB

- Sin sesión: 401. Con solo `x-user-id`: 401. `/uploads/**.epub`: 403. **Medido.**
- Sesión autorizada (200 + cabeceras) y sesión sin derecho (403): **pendientes**.
- **El título con EPUB (`content-1773325007384`) tiene su PDF (75 MB) y su TXT íntegros en `/uploads/` público.** El TXT da 200 sin sesión (medido); el PDF es de la misma clase. Proteger el `.epub` no protege el contenido de ese título.

## J. GET /api/content — **PENDIENTE**

Sin sesión: 401 (medido). La fuga de URLs para un no-admin requiere una sesión de prueba.
**CATALOG_RESOURCE_URL_LEAK: NO MEDIDO.** El código desplegado (`398c8f1`) solo filtra pedagogía para el lector (`server/server.js:2725-2735`). Esto es evidencia estática y no la sustituye.

## K. Logout

- **POST_LOGOUT_NETWORK_ACCESS: POSSIBLE (medido indirectamente).** Los recursos editoriales de `/uploads/` dan 200 **sin ninguna sesión**, así que cerrar sesión no puede afectarles.
- `/access` y `/epub` tras logout: pendiente de una sesión. Sin sesión ya dan 401.
- **POST_LOGOUT_LOCAL_CONTENT: NO MEDIDO** (requiere navegador con sesión de prueba).

## L. Revoke

**REVOKE_LIVE_TEST: NOT_EXECUTED_NO_SAFE_FIXTURE.** No se creó ni modificó ninguna regla. Como `/uploads/` no exige identidad, revocar no puede afectar a esos bytes. Para `/epub` y `/access`, pendiente.

## M. Inmersivo

**IMMERSIVE_AUTH_ORDER: NO MEDIDO** (requiere navegador con un usuario sin acceso).

## N. Cache

**CACHE_POLICY_EDITORIAL: PUBLIC_IMMUTABLE (medido).** TXT, PDF, MP3, MP4 y JPG llevan `public, max-age=2592000, immutable` y `Expires` a +30 d.

Anomalía nueva: salen **dos** cabeceras `Cache-Control`, `max-age=2592000` (de la directiva `expires`) y la de `add_header`. Los navegadores las combinan; la política resultante sigue siendo pública e inmutable.

## O. Android LU (repo, sin dispositivo)

- Repo **sin cambios** desde la auditoría: HEAD `31325c0`, `0.9.0` / vc 10, árbol limpio.
- Descarga del TXT con `URL(url).openConnection()` (`OfflineBookRepository.kt:210-229`), sin `CookieHandler` global ni ningún otro: **no envía cookie ni token**. La URL de release apunta al mismo host medido en §F, donde el TXT da 200 anónimo.
- No hay `FLAG_SECURE`, `setRecentsScreenshotEnabled`, `EncryptedFile` ni SQLCipher en `app/src/main`.

| Control | Resultado |
|---|---|
| LU_DEPENDS_ON_PUBLIC_UPLOADS | **YES** |
| LU_SCREENSHOT_PROTECTION | **NO** |
| LU_LOCAL_BOOK_ENCRYPTED | **NO** |

Logout purge y comportamiento ante 401/403: sin cambios respecto a la auditoría (el logout purga; 401/403 no).

## P. Headers (en vivo)

| Header | `/` (SPA) | `/api/*` | `/uploads/` editorial | `/api/content/:id/epub` (401) |
|---|---|---|---|---|
| Cache-Control | `no-store` | (ninguno en 401) | `public, max-age=2592000, immutable` (×2) | — (200 pendiente) |
| CSP | ausente | ausente | ausente | ausente |
| Referrer-Policy | **ausente** | **doble**: `no-referrer` (helmet) + `strict-origin-when-cross-origin` (edge) | **ausente** | doble |
| CORP | ausente | `same-origin` | **ausente** | `same-origin` |
| COOP | ausente | `same-origin` | ausente | `same-origin` |
| COEP | ausente | ausente | ausente | ausente |
| HSTS | **ausente** | **doble** (idénticas) | **ausente** | doble |
| X-Frame-Options | **ausente** | **doble y contradictoria**: `SAMEORIGIN` (helmet) + `DENY` (edge) | **ausente** | doble |
| Permissions-Policy | ausente | ausente | ausente | ausente |

## Q. Matriz final

| Recurso | Sin sesión | Sin derecho | Con derecho | Logout | Protección de bytes |
|---|---|---|---|---|---|
| TXT | **200** | n/m (≡200: no se pide identidad) | n/m | **200** (≡ sin sesión) | **RED** |
| PDF | **200** (+206 Range) | ≡200 | n/m | ≡200 | **RED** |
| Audio | **200** | ≡200 | n/m | ≡200 | **RED** |
| Vídeo (mp4 sin referencia) | **200** | ≡200 | n/m | ≡200 | **RED** |
| Imagen álbum | **200** | ≡200 | n/m | ≡200 | **RED** |
| canonical/book.txt (EPUB) | **404** (no existe en prod) | — | — | — | n/a hoy (latente) |
| canonical (pedagogía, único existente) | **401** | n/m | n/m | n/m | YELLOW (por rol) |
| canonical/media | **no existe ninguno en prod** | — | — | — | n/a hoy (latente) |
| EPUB original | **401** (`/epub`), **403** (`/uploads`) | n/m | n/m | n/m | GREEN en el endpoint |

`≡200`: deducido de la medición sin sesión. Si sin credenciales da 200, con cualquier credencial también; el autorizador devuelve 204 sin consultar la identidad. `n/m`: no medido.

## R. Hallazgos críticos

```
R1_UPLOADS_PUBLIC:               CONFIRMED
R2_CATALOG_URL_LEAK:             NOT_CONFIRMED (no medido: falta sesión no-admin)
R3_CANONICAL_PUBLIC:             NOT_CONFIRMED (no existe ningún canonical de EPUB en prod;
                                 el único canonical, pedagógico, da 401)
R4_PUBLIC_CACHE:                 CONFIRMED
R5_LOGOUT_REVOKE_WEAK:           PARTIAL (bytes /uploads: confirmado por ausencia de auth;
                                 API/local storage: no medido; revoke no ejecutado)
R6_IMMERSIVE_BYTES_BEFORE_AUTH:  NOT_CONFIRMED (no medido)
R7_BROWSER_LOCAL_TEXT_PERSISTS:  NOT_CONFIRMED (no medido)
R8_LU_PUBLIC_UPLOAD_DEPENDENCY:  CONFIRMED
```

## S. Diferencias frente a la auditoría estática

1. **R3 queda reformulado.** En producción no hay derivados `canonical/` de EPUB: la ingesta 3C.2 no se ha ejecutado sobre el título con EPUB. El riesgo pasa a **latente**: se activará en cuanto se materialice un canonical de un título no pedagógico. Pero el contenido del único título con EPUB **ya es público hoy por su PDF y su TXT legacy**. La conclusión de la auditoría («proteger el `.epub` no protege el título») se mantiene por esta otra vía.
2. **Vídeo:** el catálogo no referencia ningún mp4 (los 5 vídeos son YouTube). Sí hay un mp4 sin referencia en disco, servido en público (`UNMAPPED_ASSET`). La superficie VisorVideo con mp4 propio no tiene hoy contenido real.
3. **EPUB en producción = 1 título.** La exposición de EPUB es mínima en volumen.
4. **Cabeceras:** `/` (la SPA) tampoco recibe HSTS, XFO ni Referrer-Policy; la auditoría solo lo señalaba para `/uploads/`. En `/api/*` hay cabeceras duplicadas y contradictorias (`X-Frame-Options` SAMEORIGIN + DENY). `/uploads/` emite `Cache-Control` duplicado.
5. Confirmado que `x-user-id` no sirve como identidad en producción (enforce, sin `LEGACY_ALLOW`). El riesgo «compat» de la auditoría queda descartado para el estado actual.

## T. Gate CP-1

R1 CONFIRMED, R2 **no medido**, R3 NOT_CONFIRMED (reformulado como latente) → **no** se cumple GREEN_CONFIRMED_RISK.

Para cerrar CP-0 hace falta:
1. Una **cuenta de prueba no-admin** (lector) con acceso limitado y conocido, aportada por el operador. Con ella: §G, §H, §J (R2), §K (`/access`, `/epub` y almacenamiento local tras logout), §M (R6) y R7.
2. Opcional: un título con derecho asignado a esa cuenta, para medir «con derecho».

Sin esa sesión, la dirección provisional es **GREEN_WITH_STATIC_AUDIT_CORRECTIONS** (cambios en §S). El riesgo central (R1 + R4 + R8) está **confirmado en vivo** y basta para justificar CP-1.

## U. Evidencia y archivos generados (CP-0 sin sesión)

- Este documento (sin commit).
- Scratchpad de sesión, fuera del repo: `edge_nginx_T.txt` y `edge_active_main.conf` (configuración nginx activa; sin secretos, sin contenido editorial).
- No se guardó ningún cuerpo de contenido. Las sondas fueron `HEAD` y un `GET` de 1 byte enviado a `/dev/null`.
- Bloqueos de permisos durante CP-0: la lectura de `users_db.json` en producción (para localizar una cuenta de prueba) la denegó el clasificador. No se reintentó por otra vía.


---

# CP-0B — AUTHENTICATED LIVE VERIFICATION (2026-10-17)

Leyenda de evidencia: `LIVE_CONFIRMED` · `LIVE_NOT_CONFIRMED` · `STATIC_FINDING` · `LATENT_ARCHITECTURAL_RISK`.

## A. Veredicto CP-0B

**CP0_LIVE_VERIFICATION: CLOSED.** R1 sigue confirmado y la verificación autenticada está completa dentro de lo que permite la cuenta disponible.

**CP1_PROTECTED_DELIVERY_REQUIRED: YES.**

## B. Cuenta usada

- Cuenta existente con rol `lector`, `accountStatus=active` y vínculo a un colegio.
- El operador inició sesión a mano en Chrome.
- No se pidieron, registraron ni imprimieron contraseñas ni cookies.
- El id de la cuenta solo se usó en memoria, como parámetro `userId` de `/access`.

**Característica relevante:**
- La cuenta tiene `allowed=true` en los **89 títulos generales** que ve (motivo: «Aprobado por Título explícito (Scope Engine)»).
- Los 20 títulos pedagógicos no aparecen en su catálogo y se le deniegan por rol.
- **No existe ningún título general denegado para esta cuenta.**

## C. TITLE_ALLOWED / TITLE_DENIED

| Rol | contentId | Tipo | Acceso esperado → medido |
|---|---|---|---|
| TITLE_ALLOWED | `content-1765751139919` | libro (TXT + PDF) | allowed → **allowed=true (200)** |
| TITLE_ALLOWED (EPUB) | `content-1773325007384` | libro (PDF + TXT + EPUB) | allowed → **allowed=true** |
| TITLE_ALLOWED (audio) | `child-content-1765751724398-0-…` | podcast | allowed → allowed=true |
| TITLE_ALLOWED (álbum) | `content-1776006983915` | libro_album | allowed → allowed=true |
| TITLE_DENIED (por rol) | `content-1765837262553` | articulo_pedagogico | denied → **403 «Material pedagógico reservado a mediadores.»** |
| TITLE_DENIED general | — | — | **no existe para esta cuenta** |

Según la regla de la unidad, la matriz «sin derecho» solo puede usar el título denegado por rol (pedagogía). No hay matriz «sin derecho» para un título general.

## D. Access gate

`GET /api/content/:id/access?userId=<self>`:
- 89/89 títulos generales → 200, `allowed=true`.
- Título pedagógico → 403, `allowed=false`.

Sin el parámetro `userId`, el endpoint responde 401 «Sesión no válida.» aunque haya sesión. Es el contrato anti-spoofing, no un fallo.

## E. GET /api/content (R2)

- 200, **89 registros**, sin `Cache-Control`.
- Incluye estos campos de cada título: `texto_plano_url`, `url_recurso`, `epub_url`, `album_data` (con `imageUrl` y `ambientAudioUrl`), `portada_url`, `ilustraciones_url`.
- El título con EPUB expone: `portada_url`, `url_recurso`, `texto_plano_url`, `texto_ingles_url`, `ilustraciones_url`, `epub_url`.
- **Para esta cuenta, el conjunto devuelto coincide exactamente con el conjunto autorizado.** No aparece ningún título sin acceso, y el pedagógico denegado no figura.

**R2_CATALOG_URL_LEAK: NOT_CONFIRMED (LIVE).** La cuenta no tiene ningún título general denegado, así que no se pudo observar una fuga.

`STATIC_FINDING` que se mantiene como **LATENT_ARCHITECTURAL_RISK**: el handler (`server/server.js:2725-2735`) solo filtra pedagogía, no por título. Con una cuenta de licencia parcial sobre títulos generales, la fuga se produciría. Hoy no se pudo demostrar en vivo con la cuenta disponible.

## F. my-catalog

`GET /api/content/my-catalog` → 200, `{success, catalog}`:
- 89 ítems, con solo `id, title, type, coverImage, collectionId`.
- Es el mismo conjunto que `/api/content`, pero **sin campos de recurso**.
- El pedagógico denegado **no aparece**.

## G. Sin derecho (título denegado por rol)

| Recurso | Status |
|---|---|
| `/access` | **403** (`allowed=false`) |
| `/uploads/<ped>/canonical/book.json` (con sesión lectora) | **403** |
| `/api/content/<ped>/epub` | 404 (no tiene EPUB) |
| Presencia en `/api/content` / my-catalog | no aparece |

- **BYTES_AUTH_DIVERGENCE (pedagogía): NOT_CONFIRMED.** El gate de UI y el de bytes coinciden (los dos por rol).
- **BYTES_AUTH_DIVERGENCE (general): CONFIRMED (LIVE), medido sin sesión.** `/access` → 401 y `/uploads` → 200 para el mismo título (§F de CP-0 y §K de esta sección).

## H. Con derecho

| Recurso | Status | Cache-Control |
|---|---|---|
| `/access` | 200 `allowed=true` | — |
| TXT (`…/la_metamor….txt`) | 200 | `max-age=2592000, public, max-age=2592000, immutable` |
| PDF (`…/la_metamor….pdf`, 42 MB) | 200 | ídem |
| Audio (`…/war_of_the_w….mp3`, 55 MB) | 200 | ídem |
| Imagen álbum (`…/sol_de_los_v….jpg`) | 200 | ídem |
| EPUB API | **200** · `Content-Length: 49272977` · **sin `Accept-Ranges`** | `private, no-cache` |
| `.epub` directo bajo `/uploads` | 403 | — |

Método: `HEAD` para los recursos de `/uploads`. Para el EPUB, `GET` abortado al recibir las cabeceras, sin leer el cuerpo.

El filtro de la herramienta del navegador ocultó `Content-Type` y `Content-Disposition` del EPUB. Por código son `application/epub+zip` e `inline` (`STATIC_FINDING`).

## I. Inmersivo (R6)

Medido con **TITLE_ALLOWED** (`content-1765751139919`): recarga completa de `#/leer/inmersivo/…` y lectura de Resource Timing. La cuenta no tiene ningún título general denegado.

| t (ms relativos a la navegación) | Request | Status |
|---|---|---|
| 1826 → **2069** | `GET /api/content/<id>/access?userId=<self>` | 200 |
| 1827 → **1830** | `GET /uploads/audio/<id>/manifest.json` (2 B, vacío) | 200 |
| 1827 → **1831** | `GET /uploads/<id>/…txt` (44 KB comprimido) | 200 |
| 1827 → 1985 | `GET /uploads/audio/<id>/anchors.json` | 404 |
| 2049 → 2360… | 7 × `POST /api/tts` (≈2,2 MB de audio sintetizado) | 200 |

- El TXT completo y el manifest se pidieron **en paralelo** con `/access` y llegaron **238 ms antes** que el veredicto.
- La síntesis TTS arrancó (2049 ms) antes de que terminara el veredicto (2069 ms).
- El código no condiciona estas peticiones al veredicto (`App.tsx:236-245`, `engines/StartupEngine.ts`). El mismo orden aplica a un título denegado.

**IMMERSIVE_AUTH_ORDER: BYTES_BEFORE_AUTH.**

**R6_IMMERSIVE_BYTES_BEFORE_AUTH: CONFIRMED (LIVE, título permitido).** La medición con un título denegado sigue pendiente por falta de fixture.

Colateral: el manifest de este título está vacío, por eso el Inmersivo cae a `POST /api/tts`.

## J. localStorage PRE (tras abrir Guiado del TITLE_ALLOWED)

| Clave | Existe | Tipo | Tamaño | Contenido |
|---|---|---|---|---|
| `chibalete_offline_texto` | sí | objeto `{contentId, title, autor, portada_url, texto, language, cachedAt}` | 122 KB (`texto` = 121.346 caracteres = libro completo) | **texto editorial íntegro** de `content-1765751139919` |
| `chibalete_content` | sí | array (catálogo) | 363 KB | **1.035 referencias `/uploads/`** |
| `gemini_cache_*` | 1 clave | — | 46 B | sin contenido editorial relevante |

## K. Logout (flujo normal: botón «Cerrar Sesión»)

| Comprobación | Resultado |
|---|---|
| A. `GET /api/auth/me` | **401** |
| A. `GET /api/content` | **401** |
| A. `GET /access` (mismo userId) | **401** |
| B. `GET /api/content/<epub>/epub` | **401** |
| C. TXT de `/uploads` (URL tomada del catálogo en localStorage) | **200** |
| C. PDF de `/uploads` | **200** |
| C'. Caché HTTP del navegador (`fetch` `only-if-cached` del TXT) | **200**: el libro sigue en la caché del navegador |
| D. `chibalete_offline_texto` | **sigue presente** (mismo contentId, 121.346 caracteres) |
| D. `chibalete_content` | **sigue presente** (363 KB, 1.035 referencias `/uploads/`) |
| D. `chibalete_user_id` | borrado; es lo único que limpia el logout |
| E. Reabrir `#/leer/texto/<id>` por la UI | redirige a `#/bienvenida`: **la UI no lo reabre**, pero el texto sigue accesible desde DevTools (nivel 2) |

```
POST_LOGOUT_API_ACCESS:          BLOCKED
POST_LOGOUT_UPLOAD_ACCESS:       POSSIBLE
POST_LOGOUT_LOCAL_CONTENT:       PRESENT
R7_BROWSER_LOCAL_TEXT_PERSISTS:  CONFIRMED
```

## L. Cache

- Recursos editoriales, tanto con derecho como sin sesión: misma política.
  - `Cache-Control` combinado: `max-age=2592000, public, max-age=2592000, immutable`.
  - ETag y Last-Modified presentes.
  - Sin `Age` (no hay caché intermedia propia).
- EPUB API: `private, no-cache`.
- `/api/content`: sin `Cache-Control`.
- Tras el logout, el TXT sigue servible **desde la caché HTTP local**, sin red.

**CACHE_POLICY_EDITORIAL: PUBLIC_IMMUTABLE (LIVE_CONFIRMED).**

## M. EPUB

| Situación | Status |
|---|---|
| Sin sesión | 401 |
| Solo `x-user-id` | 401 |
| Sesión con derecho | **200** (`private, no-cache`, 49.272.977 B, sin Range) |
| Sesión sin derecho | **no medible**: ningún título con EPUB está denegado a esta cuenta. Por código, 403 (`STATIC_FINDING`) |
| Tras logout | **401** |
| `.epub` directo bajo `/uploads`, con o sin sesión | 403 |
| TXT y PDF del mismo título bajo `/uploads` | **200 sin sesión** |

## N. Matriz final

| Recurso | Sin sesión | Sin derecho | Con derecho | Tras logout |
|---|---|---|---|---|
| TXT | 200 | n/d general (pedagogía: canonical 403) | 200 | **200** (+ localStorage + caché HTTP) |
| PDF | 200 | n/d | 200 | **200** |
| Audio | 200 | n/d | 200 | 200 (≡ sin sesión) |
| Imagen álbum | 200 | n/d | 200 | 200 (≡ sin sesión) |
| Vídeo | 200 (mp4 sin referenciar) | n/d | n/a (los vídeos del catálogo son YouTube) | 200 (≡ sin sesión) |
| EPUB original (`/api/.../epub`) | 401 | n/d (por código: 403) | 200 | 401 |

`n/d`: no hay ningún título general denegado a la cuenta disponible. Los recursos generales no consultan identidad: si dan 200 sin sesión, dan 200 con cualquier sesión.

## O. R1–R8 final

```
R1_UPLOADS_PUBLIC:               CONFIRMED (LIVE)
R2_CATALOG_URL_LEAK:             NOT_CONFIRMED (LIVE; cuenta sin títulos generales denegados)
                                 → LATENT_ARCHITECTURAL_RISK (handler sin filtro por título)
R3_CANONICAL_PUBLIC:             LATENT_CONFIRMED_BY_ARCHITECTURE
                                 (NOT_CURRENTLY_PRESENT_IN_PRODUCTION; canonical pedagógico = 401/403)
R4_PUBLIC_CACHE:                 CONFIRMED (LIVE)
R5_LOGOUT_REVOKE_WEAK:           CONFIRMED para logout (LIVE: API 401, /uploads 200, contenido local PRESENT);
                                 revoke NOT_EXECUTED_NO_SAFE_FIXTURE (se infiere de R1)
R6_IMMERSIVE_BYTES_BEFORE_AUTH:  CONFIRMED (LIVE, título permitido)
R7_BROWSER_LOCAL_TEXT_PERSISTS:  CONFIRMED (LIVE)
R8_LU_PUBLIC_UPLOAD_DEPENDENCY:  CONFIRMED
```

REVOKE_LIVE_TEST: NOT_EXECUTED_NO_SAFE_FIXTURE.

## P. Correcciones al audit

Se añadió una sección «Estado verificado en producción (CP-0 / CP-0B)» al principio de `CHP_CONTENT_PROTECTION_AUDIT_2026_01.md`. El diagnóstico histórico no se reescribió.

## Q. Gate CP-1

```
CP0_LIVE_VERIFICATION:            CLOSED
CP1_PROTECTED_DELIVERY_REQUIRED:  YES
```

**Fundamento:**
- Confirmados en vivo: R1, R4, R5 (logout), R6, R7 y R8.
- R2 y R3 son riesgos arquitectónicos latentes que CP-1 debe cubrir por diseño.

**Deuda de verificación para CP-1:** un fixture con una cuenta de **licencia parcial** (algún título general denegado). Hace falta para medir R2, la matriz «sin derecho» general y R6 con un título denegado.

## Evidencia CP-0B

- Sin archivos nuevos. Todas las mediciones se hicieron en el navegador con salidas de solo metadatos.
- No se guardó ningún libro, cookie ni credencial.
- La pestaña de prueba se cerró.
- El navegador del operador queda **como lo dejó el logout**: `chibalete_offline_texto` y `chibalete_content` siguen en localStorage y el TXT sigue en la caché HTTP. No se limpiaron, por instrucción. El operador puede limpiarlos cuando quiera.
