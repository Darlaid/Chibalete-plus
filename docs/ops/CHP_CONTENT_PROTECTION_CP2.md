# CHP-CONTENT-PROTECTION-2026-01 · CP-2 — PROTECTED DELIVERY ROLLOUT

Fecha: 2026-10-17 (14:34Z–15:40Z) · VPS de producción · Evidencia en `/root/chp-cp2/`.

## A. Veredicto

```
CP2_PROTECTED_DELIVERY_ROLLOUT:   GREEN_PRODUCTION
UPLOADS_EDITORIAL_PUBLIC:         NO
EDITORIAL_ASSET_AUTHORIZATION:    SERVER_AUTHORITATIVE
PUBLIC_ASSETS:                    AVAILABLE
WEB_READERS:                      GREEN_PRODUCTION
LU_PROTECTED_DOWNLOAD:            GREEN_PRODUCTION
LU_PUBLIC_UPLOAD_DEPENDENCY:      REMOVED
POST_LOGOUT_NEW_UPLOAD_ACCESS:    BLOCKED
EDITORIAL_PUBLIC_CACHE:           REMOVED
UNAUTHORIZED_EDITORIAL_BYTES:     ZERO (en la matriz probada)
IDENTITY_ARCHITECTURE:            UNCHANGED
```

## B. Baseline (PRE, 14:34:37Z)

- **Código:**
  - Chibalete+ `2357ea0`, igual a origin; árbol limpio.
  - LU `93eb7ea`, árbol limpio.
- **Producción:**
  - api_1 y api_2: `chibalete/api:adminepub-398c8f1` (`18d98cee…`).
  - front: `librarytabs-f116248`.
  - edge: `nginx:alpine`.
  - Los cuatro contenedores healthy, con 0 reinicios.
  - Flags: `enforce` / `restricted`, `UPLOADS_AUTHZ_MODE` ausente.
- **Datos:**
  - content: 109 registros (`d8cf6abd…`).
  - access_db: 22 reglas (`d4182a1d…`).
  - uploads: 3.362 archivos, 6.006.130.304 B, manifest `6830644c…`.

## C. Backups JIT

`structured-20261017T143447Z-d8a98d0c` y `uploads-20261017T143459Z-2231418a`, ambos con rc=0 y Result=success.

## D. Imagen API

- **Imagen:** `chibalete/api:contentprotect-2357ea0` = `sha256:3b0570270e6f…`. Construida en el VPS desde un git bundle con `2357ea0` exacto. Label/`GIT_SHA` = `2357ea05cd3a…`.
- **Suites dentro de la imagen** (`--network none`):
  - uploadsAuthzStrict 157/0. Una aserción del test se corrigió en `bfd9b35`, cambio solo de test que no afecta al runtime: la auditoría TTS de arranque escribe `ttsStatus` en el fixture.
  - epubOriginalEndpoint 32/0 · sessionIdentityIntegration 34/0 · sessionBrowserCookieOnly 13/0 · leoMemoryOwnership 72/0 · progressReadIdentity 27/0 · epubProgressSync 39/0 · adminEpubAttach 42/0 · uploadDedupOwnership 34/0 · uploadDedupCanonical 10/0.
- **Deuda de entorno:** `authzListingScope` no llega a «healthy» en el VPS **tampoco con la imagen de producción anterior** (`adminepub-398c8f1`). Pasó 79/0 en Docker local con la imagen candidata y 79/0 en el VPS el 16/10. Es ajena a CP-2.

## E. Deploy en legacy (14:49Z–14:53Z)

- **Rollback preparado:** `chibalete/api:rollback-pre-contentprotect` = `18d98cee…`. Override de respaldo: `docker-compose.override.yml.bak-pre-contentprotect-<ts>` (líneas 40/84).
- **Recreate:** api_1, luego api_2. Las dos réplicas healthy, 0 reinicios, `[BOOT] UPLOADS_AUTHZ_MODE=legacy`.
- **Veredictos del autorizador por réplica:** TXT 204 · PDF 204 · `.epub` 403 · pedagogía 401, idénticos a los anteriores.
- **Desde fuera, sin sesión:**
  - TXT/PDF/MP3/IMG → 200 con `public, max-age=2592000, immutable`;
  - `.epub` en `/uploads` → 403;
  - endpoint EPUB → 401.

```
API_CP1_CODE_DEPLOYED: YES · UPLOADS_AUTHZ_MODE: LEGACY · PRODUCTION_BEHAVIOR_CHANGE: ZERO
```

## F. Release LU

- **Mecanismo real auditado:** **no existe un updater en ningún APK, tampoco en 0.9.0.** `/api/lu/version` solo lo consume la página web `ChibaleteLU.tsx`. La distribución consiste en el APK en `/uploads/chibalete-lu-<v>.apk` y `data/lu_config.json`. Ver `CHP_IDENTITY_FIELD_UPDATE_CHANNEL_01`.
- **Versión:** `01001ae` (`chore(release): LU 0.9.1 (versionCode 11)`), encima de `93eb7ea`. El único cambio funcional es el de CP-1.
- **APK:** `com.chibalete.lu` 0.9.1 / 11. Firma V2 `CN=Chibalete Editores`, digest `7cd34ce8…`, el mismo certificado que 0.9.0. 2.010.794 B. SHA-256 `64e7f2e43a80ea7835ac68a48e270419a3f151ac3b8525d0d9199f42ce9cddb4`. Tests 56/0 (1 omitido: el test live).
- **Publicación:**
  - `/uploads/chibalete-lu-0.9.1.apk` (644, mismo SHA tras la copia);
  - `lu_config.json` → `version 0.9.1`, `apkUrl /uploads/chibalete-lu-0.9.1.apk`, con backup `lu_config.json.bak-pre-0.9.1-<ts>`;
  - `/api/lu/version` → 0.9.1;
  - el APK responde 200 y se sirve público, como asset deliberado.

## G. Gate de actualización LU

- **Condición A (0.9.0 no puede seguir sin actualizar): imposible por construcción**, porque no hay receptor de actualización en el binario.
- **Condición B (telemetría existente, UA en el log del edge, 30 días):**
  - `ChibaleteLU/0.9.0`: **1 sola IP** (hash `4f5b8bd9e3`), la del dispositivo QA del operador (Xiaomi 25078RA3EL, Android 15). Coincide con el canario de distribución de 0.9.0 a un único equipo.
  - Ese dispositivo se actualizó con `install -r` 0.9.0 → 0.9.1: Success, `firstInstallTime` intacto. Las peticiones posteriores llegan como `ChibaleteLU/0.9.1` desde la misma IP.
  - LU ≤0.8.0 (`okhttp/4.12.0`): solo 2 peticiones en 30 días, ambas `GET /api/offline/assignment` → **401**. Con `SESSION_AUTH_MODE=enforce` **ya no pueden autenticarse ni descargar libros nuevos**, así que strict no les quita ninguna capacidad. Su libro ya descargado sigue legible offline, igual que antes.
- **Límite declarado:** la IP es un indicador y no la identidad del equipo, y la retención del log es de 30 días.

```
LU_STRICT_ROLLOUT_GATE: GREEN (condición B)
OLD_LU_CAN_READ_WITHOUT_UPDATE: solo el libro ya descargado, offline (sin cambios por strict); descargas nuevas: NO (≤0.8.0 ya 401 por enforce; 0.9.0 sin dispositivos activos)
```

## H. Canario strict aislado (14:54Z–15:05Z)

- **Montaje:**
  - Contenedor temporal `chp_cp2_strict_canary`: misma imagen, `UPLOADS_AUTHZ_MODE=strict`.
  - Red `bridge` y puerto **solo** en `127.0.0.1:3999`, fuera de `chibalete_net` y del upstream del edge.
  - Copia de `data/`, `data-critical/`, `identity/` y `sessions/`; uploads y secrets montados `:ro`.
  - Jobs de fondo desactivados, IA y TTS en modo mock.
  - **Eliminado** al terminar, junto con la copia de datos.
- **Matriz anónima:**

  | Recurso | Resultado (edge y static) |
  |---|---|
  | TXT, PDF, MP3, página de álbum, ilustración, mp3 en la raíz, manifest y chunk TTS | **401** |
  | canonical pedagógico | 401 |
  | `.epub` | 403 |
  | caché inmersiva y huérfano | 403 |
  | portada, banner, APK, carátula MOOK | 204 / 200 |

- **Cobertura total sobre datos reales:**
  - 1.086 rutas referenciadas (catálogo, banner, lu_config, mook): 72 públicas, 1.013 protegidas (401) y 1 con 403, el `.epub`. **Referenciadas sin dueño: 0.**
  - 3.362 archivos en disco: 75 públicos y 1.591 con 401. Los 1.696 con 403 son la caché inmersiva (1.670), 2 restos TTS, 17 huérfanos más el `.epub` en carpetas de contenido y 6 huérfanos en la raíz. **Ningún 5xx.**
- **Matriz autorizada en el canario:** no ejecutable sin una sesión de QA utilizable contra un puerto aislado. Se cubrió con los tests de la imagen (cookie real, `enforce`) y con el smoke inmediato tras el cambio (§N–§P), con rollback preparado.

## J. Rendimiento

- **Canario** (200 peticiones, catálogo real): el autorizador para asset editorial anónimo da **p50 7,7 ms · p95 10,9 ms · max 19 ms**; para portada pública, p50 4,1 ms · p95 7,6 ms. La primera petición tras el arranque tardó 8 s (en frío).
- **Producción con strict** (Chrome, sesión admin, sin caché por petición): los visores abren con tiempos del mismo orden que la línea base legacy:
  - Guiado: último upload a los 0,56 s.
  - Inmersivo: 0,55 s.
  - PDF: 6 × 206 y primera página pintada.
  - Álbum: 2,0 s.
  - Galería: 20 imágenes, p95 146 ms.

  La línea base legacy estaba dominada por la caché `immutable` del navegador.
- **Recursos** tras el cambio: CPU de la API alrededor del 1 %, memoria 76–83 MiB por réplica, 0 reinicios.

`STRICT_AUTHZ_PERFORMANCE: ACCEPTABLE`

## K. Cache headers (producción, strict)

| Recurso | Cache-Control |
|---|---|
| TXT, PDF, ilustración, página de álbum, audio, manifest TTS (con sesión) | **`private, no-store`** |
| PDF con Range | 206 `bytes 0-1023/42492695`, `private, no-store` |
| Portada / banner / APK | `public, max-age=2592000, immutable` (deliberado) |
| EPUB API | `private, no-cache` (sin cambios) |

`STRICT_EDITORIAL_CACHE: PROTECTED`. La cabecera `Cache-Control` duplicada en los públicos ya existía (directiva `expires` más `add_header`).

## L. Activación strict (15:16:07Z–15:16:32Z)

- **Override:** `docker-compose.override.yml.bak-pre-strict-<ts>` (en `/root/chp-cp2/strict_ts`). Se añadió `UPLOADS_AUTHZ_MODE: "strict"` tras la línea 59 (api_1) y la 101 (api_2); el diff son exactamente 2 líneas y `docker compose config` sale OK.
- **Rolling:**
  - api_1 recreado → healthy → `[BOOT] …=strict` → smoke: TXT anónimo 401, portada 204;
  - api_2, lo mismo.
  - Intervalo mixto: unos 12 s.
- **Edge:** sin cambios.

## M. Smoke público sin sesión (producción)

| Recurso | Resultado |
|---|---|
| TXT, PDF, MP3, imagen de álbum, mp3 en la raíz, manifest TTS, canonical pedagógico | **401** |
| mp4 sin dueño, `.epub` en `/uploads` | **403** |
| APK, banner | **200** públicos |
| Endpoint EPUB | 401 |

## N. Smoke web autorizado (producción, sesión admin)

Todo en verde:
- **Biblioteca:** 28 portadas.
- **Guiado y Accesible:** TXT 200.
- **Inmersivo:** TXT y manifest 200. El 404 de `anchors.json` ya existía en legacy.
- **PDF:** 206 por rangos, 85 canvas.
- **Álbum:** 200/206, imágenes OK.
- **Galería:** 20/20.
- **Podcast:** `readyState 4`. El `play()` lo bloquea la política de autoplay del navegador, no la autorización.
- **EPUB:** 200, renderiza.

Sin cascadas de 401/403 ni pantallas de error.

## O. Smoke sin derecho (producción, sesión **lectora** de CP-0B)

No hay ningún título general denegado a esa cuenta, así que se usaron el título pedagógico y un asset sin dueño, sin crear grants:

| Comprobación | Resultado |
|---|---|
| `/access` pedagógico | 403 `allowed=false` |
| `canonical/book.json` pedagógico | **403, 548 B** (página de error de nginx, no contenido) |
| manifest TTS pedagógico | **403, 548 B** |
| mp4 sin dueño | 403 |
| Control: TXT del título permitido | 200 `private, no-store` |

El servidor no entrega bytes sin derecho: lo deniega en el propio edge, no solo con un overlay de la UI.

## P. Smoke LU 0.9.1 (dispositivo real, producción)

- **Antes de strict:** login 200 → `assignment 200` → el operador reasignó, por el flujo normal, «La metamorfosis» (`content-1765751139919`) → `download_success 124375 B`.
- **Con strict:**
  - logout desde el menú (`POST /api/auth/logout 200`);
  - login 200 a las 15:24:31Z → `assignment 200` → **`download_success 124375 B`** a las 15:24:32Z. Como el archivo responde 401 sin sesión, esto prueba que la descarga fue con cookie;
  - en modo avión: «Listo · sin conexión» y el lector abre el texto.
- **Sin sesión:** la app no intenta descargar; el servidor responde 401 (CP-0 + §M).
- **403 sin derecho:** no hay fixture en dispositivo. Cubierto por `ProtectedBookDownloadTest` y por el test live contra la API estricta real (CP-1).

`LU_PUBLIC_UPLOAD_DEPENDENCY: REMOVED_PRODUCTION`

## Q. Monitorización (15:16Z–15:30Z)

- **Edge:** 2xx 57 · 3xx 11 · 4xx 2 · **5xx 0**. Errores de `auth_request`: 0. Los accesos a `/uploads` no entran en el log (`access_log off`).
- **API** (por réplica): errores del autorizador 0, 5xx 0, reinicios 0. Veredictos 403 registrados: RAW_EPUB y UNMAPPED, que corresponden a las sondas.
- **LU:** 0 errores de descarga.

Ventana corta, de tráfico bajo. **Revisar 24–48 h** de logs (401/403 por UA, quejas de usuarios).

## R. Riesgos R1 / R4 / R5 / R8

```
R1_UPLOADS_PUBLIC:               FIXED_PRODUCTION
R4_PUBLIC_CACHE:                 FIXED_PRODUCTION (editorial private, no-store)
R5_LOGOUT_UPLOAD_ACCESS:         FIXED_FOR_NEW_REQUESTS (copias ya guardadas → CP-3)
R8_LU_PUBLIC_UPLOAD_DEPENDENCY:  FIXED_PRODUCTION
```

## S. Abiertos (no tocados en CP-2)

```
R2_CATALOG_URL_LEAK:                     OPEN_LATENT_METADATA (las URLs ya no dan bytes)
R6_IMMERSIVE_BYTES_BEFORE_ACCESS_CHECK:  OPEN_UI_ORDER — con strict: UNAUTHORIZED_BYTES_DELIVERED: ZERO
R7_BROWSER_LOCAL_TEXT_PERSISTS:          OPEN
```

## T. Invariantes (POST vs PRE)

- **Sin cambios:** content (109, `d8cf6abd…`), access_db (22, `d4182a1d…`), groups, users, schools, library, school_configs, landing_banner y mook_db, todos **idénticos**.
- **uploads:** 3.362 → 3.363. El único archivo nuevo es `chibalete-lu-0.9.1.apk`; **0** archivos existentes con cambio de tamaño o mtime.
- **Cambios esperados:** `lu_config.json` (publicación de 0.9.1).
- **Fuera del alcance de la unidad:** `offline_assignments.db` cambió por la reasignación humana del smoke LU.
- **Sin deploy:** front y edge. Sin migraciones de datos.

## U. Rollback (preparado y documentado en `/root/chp-cp2/ROLLBACK.txt`)

- **strict → legacy** (sin rollback de código):

  ```
  cd /opt/chibaleteplus && cp -p docker-compose.override.yml.bak-pre-strict-<ts> docker-compose.override.yml
  docker compose up -d --no-deps api_1   # esperar healthy
  docker compose up -d --no-deps api_2
  ```

- **Código:** override `…bak-pre-contentprotect-<ts>` + imagen `chibalete/api:rollback-pre-contentprotect` (`18d98cee…`).
- **LU:** `lu_config.json.bak-pre-0.9.1-<ts>`. El APK 0.9.0 sigue publicado.

## V. SHAs e imágenes

| Pieza | Valor |
|---|---|
| Chibalete+ | `2357ea0` (runtime) · `bfd9b35` (fix de test) · docs CP-2 en el commit de esta unidad |
| API | `chibalete/api:contentprotect-2357ea0` = `3b0570270e6f…` en api_1/api_2 |
| Front | `librarytabs-f116248`, sin cambios |
| Edge | sin cambios |
| LU | `01001ae` (0.9.1/11, rama local `chp/content-protection-cp1`, sin remoto). APK `64e7f2e4…` |

## W. Deudas reales

1. **Campo LU:** los equipos ≤0.8.0 (campaña escolar) siguen sin poder autenticarse por `enforce` (situación previa). Para recuperarlos hay que instalar 0.9.1 físicamente.
2. **No hay canal de actualización** dentro del APK.
3. `authzListingScope` no arranca en el VPS (entorno; también con la imagen anterior).
4. **Coste de `no-store`:** los PDF y audios grandes se vuelven a descargar en cada apertura. Vigilar ancho de banda y quejas.
5. Las denegaciones 401 del autorizador no se registran (solo las 403) y `/uploads` sigue con `access_log off`: la observabilidad de accesos denegados es limitada.
6. **Pendientes de CP-3:**
   - R2: sanear `GET /api/content`;
   - R6: orden del Inmersivo;
   - R7: limpieza en logout;
   - purga y cifrado en LU;
   - `FLAG_SECURE`.

**NEXT:** CP-3 — CLIENT PERSISTENCE + CATALOG + IMMERSIVE (no iniciado).
