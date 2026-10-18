# CHP-CONTENT-PROTECTION-2026-01 · CP-3 — PRODUCTION ROLLOUT (CP-3C → CP-3D → CP-3E)

Fecha: 2026-10-18 · VPS de producción · Evidencia en `/root/chp-cp3/` (CP-3C) y `/root/chp-cp3e/` (CP-3E).

## A. Veredicto

```
CP3_PRODUCTION_ROLLOUT:                    GREEN_PRODUCTION (segundo intento)
CP3_CLOSED:                                YES
R2_CATALOG_RESOURCE_LEAK:                  FIXED_PRODUCTION
R6_IMMERSIVE_AUTH_ORDER:                   FIXED_PRODUCTION
R7_BROWSER_LOCAL_TEXT_PERSISTS:            FIXED_PRODUCTION
POST_LOGOUT_CONTROLLED_EDITORIAL_STORAGE:  ZERO
CATALOG_PERFORMANCE_PRODUCTION:            GREEN
LU_VERSION:                                0.9.2 (publicada)
LU_SCREEN_CAPTURE_PROTECTION:              GREEN_PRODUCTION
LU_OFFLINE_STORAGE:                        ENCRYPTED_PRODUCTION
LU_OFFLINE_READING:                        PRESERVED
ACCESSIBILITY_REGRESSION:                  ZERO
UNAUTHORIZED_EDITORIAL_BYTES:              ZERO
IDENTITY_ARCHITECTURE:                     UNCHANGED
```

## B. Cronología

| Hora (UTC) | Hecho |
|---|---|
| 15:25 | CP-3C. Backups JIT `structured-20261018T152549Z-71c34a98` / `uploads-20261018T152603Z-21257612`. |
| 15:28–15:30 | API `contentprotect-cp3-598bfb4` desplegada en api_1 y api_2. Smoke GREEN. |
| 15:31 | Front `contentprotect-cp3-598bfb4` desplegado y reload del edge. **Sigue en producción.** |
| 15:34–15:49 | Smoke web GREEN, R6 y R7 verificados en vivo. Se detecta que `GET /api/content` pasa de p50 94 ms a 522 ms (máx. 1,8 s). |
| **15:50** | **ROLLBACK de la API** a `contentprotect-2357ea0` por degradación material. El front se queda. LU sin publicar. |
| — | CP-3D (`935a515`): snapshot de stores por request. Ver `CHP_CONTENT_PROTECTION_CP3` y el commit. |
| 16:41 | CP-3E. Backups JIT `structured-20261018T164108Z-cefc7bbc` / `uploads-20261018T164122Z-be4f4abb`. |
| 16:53 / 16:55 | API `contentprotect-cp3d-935a515` en api_1 y luego en api_2. |
| 17:03 | LU 0.9.2 publicada. |

## C. Primer intento (CP-3C) y rollback

- **Causa:** `catalogForViewer` llamaba a `decideContentAccess` por título. Cada llamada volvía a leer y parsear de forma síncrona `users_db` (unos 335 KB, que no usa caché en proceso a propósito), ejecutaba el observador de sombra de identidad, normalizaba todos los grupos y resolvía el scope del usuario. Con 109 títulos, eso bloqueaba el event loop unos 0,3–0,4 s por request.
- **Por qué no se detectó antes:** los fixtures de CP-3 tenían stores pequeños (unos 12 ms).
- **Rollback (15:50:08Z–15:50:37Z):** api_1 y luego api_2 a `contentprotect-2357ea0`, healthy y con strict activo. Datos idénticos.

## D. Corrección (CP-3D, `935a515`)

`createRequestStoreReader()` crea un snapshot dentro de `catalogForViewer`: cada store se lee una vez por request a través de `readJSON` y el snapshot se descarta al terminar. Dentro de ese mismo ciclo de vida, `derived()` memoiza los grupos normalizados y el scope del usuario. Sin `readStore`, el comportamiento es idéntico al de antes en todos los callers. Test permanente: `catalogAccessPerformance`, con stores de tamaño productivo.

Medición local en el mismo contenedor:

| API | p50 |
|---|---|
| `2357ea0` (producción previa) | 15 ms |
| CP-3 | 606 ms |
| **CP-3D** | **21 ms** |

Los hashes del catálogo y de `/access` coinciden con `0c6d479` para 9 actores.

## E. Segundo intento (CP-3E)

- **Imagen:** `chibalete/api:contentprotect-cp3d-935a515`, `sha256:31c99a93d152…`, construida desde `git archive 935a515`. `GIT_SHA` y label correctos. Tarball `eecf7aa8…`.
- **Suites en la imagen:** todas GREEN, salvo `libraryInstitutionalPersonal` (no-store, preexistente) y `canonicalBookTxt` (falta typescript en la imagen).
- **Smoke por réplica:**

  | Comprobación | Resultado |
  |---|---|
  | TXT anónimo | 401 |
  | Portada | 200 |
  | `.epub` crudo | 403 |
  | Endpoint EPUB anónimo | 401 |
  | `[BOOT]` | strict |
  | Reinicios | 0 |

- **Arranque:** el índice `[HASH_INDEX]` (3.331 entradas, preexistente) ocupa una CPU durante unos 70 s tras cada boot. Las muestras tomadas en esa ventana se descartaron y la medición se repitió en caliente.

### Rendimiento en producción (`GET /api/content`, sesión lectora, 89 títulos)

| métrica | PRE (`2357ea0`) | POST (`935a515`) | delta |
|---|---|---|---|
| servidor (pino) p50 | 28 ms | 38 ms | ×1,36 |
| servidor p95 | 65 ms | 68 ms | ×1,05 |
| servidor máx. | 548 ms | 201 ms | — |
| navegador p50 (de extremo a extremo) | 171 ms | 171–187 ms | ≈ |
| muestras | 33 | 104 | |

`CATALOG_PERFORMANCE_PRODUCTION: GREEN` (umbral: p50 ≤ ×1,5).

## F. Verificación en vivo

- **R2:**
  - Admin: 109 títulos íntegros, `no-store`.
  - Lectora de CP-0B: 89 títulos, `allowed=89 filtered=0`. Tiene derecho a todo lo que ve, así que no hay ningún título general denegado que observar.
  - Caso denegado: cubierto por la suite automática y por la pedagogía (fuera del listado del lector). No se crearon grants.
  - Logging: 1 línea `CATALOG_ACCESS_FILTER` por request y 0 líneas por título.
- **R6:** con acceso permitido, TXT y manifest empiezan unos 4 ms después de que termine `/access`; 0 peticiones editoriales antes del veredicto. Con acceso denegado (pedagógico como lectora), 0 peticiones.
- **R7:**
  - El arranque purga la clave heredada `chibalete_offline_texto`, y Guiado no la vuelve a crear.
  - Tras el logout: `chibalete_offline_texto`, `chibalete_content`, `gemini_cache_*`, `leo_session_*` y `leo-chat-*` quedan en 0; las 10 preferencias y la cola de progreso son idénticas; `/uploads` editorial, `/api/content` y `/api/auth/me` devuelven 401.
  - `Clear-Site-Data: "cache"` observado con tcpdump (solo la cabecera) entre el edge y la API. Chrome no la expone a `fetch()`.
- **Web (front CP-3 sobre la API nueva):** Biblioteca, Detalle, Guiado, Accesible, Inmersivo, PDF (206 + 10 canvas), Álbum, Galería, Audio y EPUB funcionan. 0 respuestas 4xx/5xx en recursos y 0 errores JS.
- **Accesibilidad:** texto real presente; Tab llega a «Saltar a controles de lectura» con foco visible; `user-select: auto`. `ACCESSIBILITY_REGRESSION: ZERO`.
- **Relogin:** sin bucle; Biblioteca carga y las preferencias se conservan.

## G. LU 0.9.2

- **Paquete:** `com.chibalete.lu` 0.9.2 / 12, código `cd24fda`.
- **APK:** `4c7e29e67988891011feda2fef6618176ce79825e7289c5c1f2d69b5fa1de902`, 2.010.794 B, certificado `7cd34ce8…` (el mismo que 0.9.1).
- **Publicación:** `/uploads/chibalete-lu-0.9.2.apk` (644); la descarga HTTPS es byte-idéntica. `lu_config.json` pasa de 0.9.1 a 0.9.2 (backup `lu_config.json.bak-pre-0.9.2-cp3e-20261018T165019Z`). `/api/lu/version` devuelve 0.9.2. `forceUpdate` sigue en false.
- **Xiaomi 25078RA3EL** (APK instalado = APK publicado):

  | Prueba | Resultado |
  |---|---|
  | Logout | el siguiente login da `same_user=false had_previous=false`: purga confirmada |
  | Descarga autenticada | `download_success` 124.375 B en 0,5 s |
  | Lector | texto completo en el árbol de accesibilidad |
  | Captura | negra (99,8 %), ventana `SECURE` |
  | Grabación | negra |
  | Recientes | tarjeta en blanco |
  | Modo avión | lector OK, «Sin conexión — usando datos guardados» |
  | 401 | probado en CP-3B: el libro se conserva y el reauth no es destructivo |
  | 403 | `LU_403_DEVICE_TEST: NOT_EXECUTED_NO_SAFE_FIXTURE`; cobertura automática GREEN |

## H. Monitoreo (16:53Z–17:07Z)

| Métrica | Resultado |
|---|---|
| 5xx de la API | 0 |
| 5xx del edge | 1: `POST /api/analytics/events` 502 por un `recv() reset` del upstream (aislado; el mismo patrón ya visto en la ventana de CP-2) |
| Errores de `auth_request` | 0 |
| Reinicios | 0 |
| CPU / memoria | API ~1 %, 79–94 MiB en reposo |
| Latencia del catálogo | p50 39 ms, p95 94 ms (n=109) |
| 401 / 403 | 3 / 0: sesiones cerradas |
| Errores de LU | 0. Tráfico `ChibaleteLU/0.9.2` todo 200 |
| Otros errores | TTS on-demand `429 no credits` de OpenAI (cuota, preexistente) |

Se recomienda revisar de nuevo a las 24 h.

## I. Invariantes (PRE 16:41Z vs POST 17:07Z)

- content (109, `d8cf6abd`), access_db (22, `d4182a1d`), groups, users, schools, library, school_configs, landing_banner y mook: **idénticos**.
- **uploads:** 3.363 → 3.364. El único archivo nuevo es `chibalete-lu-0.9.2.apk`; ningún archivo existente cambió.
- **Cambio esperado:** `lu_config.json`.

## J. Estado final y rollback

| Pieza | Valor |
|---|---|
| Web/API | `935a515` |
| API | `chibalete/api:contentprotect-cp3d-935a515` (`31c99a93`) en api_1 y api_2 |
| Front | `chibalete/front:contentprotect-cp3-598bfb4` (`fd6303c8`) |
| Edge | sin cambios |
| LU | 0.9.2 publicada |
| Flags | `UPLOADS_AUTHZ_MODE=strict`, `SESSION_AUTH_MODE=enforce`, `ACCESS_FALLBACK_MODE=restricted` |

- **Rollback:** `/root/chp-cp3e/ROLLBACK.txt`.
  - **API:** cambiar la imagen a `contentprotect-2357ea0` y recrear api_1 y luego api_2.
  - **LU:** restaurar el backup de `lu_config`.
  - **Front:** `/root/chp-cp3/ROLLBACK.txt`, volver a `librarytabs-f116248` y recargar el edge.

## K. Riesgos

| Riesgo | Estado |
|---|---|
| R1 `/uploads` público | FIXED_PRODUCTION |
| R2 catálogo | FIXED_PRODUCTION |
| R4 caché pública | FIXED_PRODUCTION |
| R5 acceso tras logout | FIXED_FOR_NEW_REQUESTS |
| R6 orden del Inmersivo | FIXED_PRODUCTION |
| R7 texto en el navegador | FIXED_PRODUCTION |
| R8 dependencia de LU de `/uploads` público | FIXED_PRODUCTION |

## L. Deudas

- **Preexistentes, no bloqueantes:**
  - test no-store de `libraryInstitutionalPersonal`;
  - `canonicalBookTxt` necesita typescript, que no está en la imagen;
  - test legacy x-user-id de `test:immersive`;
  - disco al 86–87 % (`DiskNearFull`);
  - `.deploy-info` desfasado desde agosto;
  - `anchors.json` ausente;
  - cuota TTS de OpenAI agotada;
  - LU no tiene updater;
  - `[HASH_INDEX]` ocupa una CPU unos 70 s en cada boot;
  - resets aislados del upstream en `keepalive`;
  - `no-store` obliga a volver a descargar EPUB y PDF grandes (unos 47 MB) en cada apertura.
- **CP-3, no bloqueantes:**
  - la API nueva añade unos 10 ms de p50 en el catálogo (×1,36);
  - el 403 por revocación no se probó en dispositivo;
  - la ausencia de `book.txt` no es observable en un dispositivo release;
  - el progreso offline muestra el valor local.
- **Bloqueantes:** ninguna.

**NEXT:** CP-4 — USER-SIDE EXTRACTION DETERRENCE + EXTERNAL PUBLISHER POLICY (no iniciado).
