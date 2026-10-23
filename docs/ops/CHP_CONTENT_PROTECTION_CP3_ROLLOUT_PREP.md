# CHP-CONTENT-PROTECTION-2026-01 · CP-3B — ROLLOUT PREPARATION

Fecha: 2026-10-18 (14:58Z–15:25Z) · Sin deploy · Producción sin cambios.

## A. Veredicto

```
CP3_ROLLOUT_PREPARATION:   GREEN
CP3_ROLLOUT_READY:         YES
PRODUCTION_CHANGE:         ZERO
```

## B. Baseline (14:58Z, read-only)

- **Web/API:** `chp/epub-mainfile-r1-release` en `598bfb4` (igual a origin).
- **LU:** `chp/content-protection-cp3` en `61dde15`, sin cambios en archivos trackeados. Repo local sin remoto.
- **Producción:**

  | Contenedor | Imagen | Estado | Reinicios |
  |---|---|---|---|
  | api_1 | `chibalete/api:contentprotect-2357ea0` (`3b0570270e6f…`), arrancado 2026-10-17T15:16:09Z | healthy | 0 |
  | api_2 | igual que api_1, arrancado 15:16:21Z | healthy | 0 |
  | front | `librarytabs-f116248` (`ee48a1fb853c…`) | healthy | 0 |
  | edge | `nginx:alpine` | healthy | 0 |

- **Flags efectivos (api_1 y api_2):** `UPLOADS_AUTHZ_MODE=strict`, `SESSION_AUTH_MODE=enforce`, `ACCESS_FALLBACK_MODE=restricted`, `GIT_SHA=2357ea05…`.
- **Datos:**
  - content: 109 registros (`d8cf6abd…`).
  - access_db: 22 reglas (`d4182a1d…`).
  - uploads: 3.363 archivos, 6.008.141.098 B.
  - `lu_config.json`: 0.9.1. APKs publicados: 0.7.1, 0.8.0, 0.9.0, 0.9.1 y `chibalete-lu.apk`.

## C. Estabilidad CP-2 (2026-10-17T15:16Z → 2026-10-18T15:16:42Z)

Fuentes: `docker logs` de edge, api_1 y api_2; metadatos de contenedor con `node scripts/security/safeOperationalEvidence.mjs container-summary`; Alertmanager. Solo se usaron agregados.

| Métrica | Resultado | Observación |
|---|---|---|
| Edge 5xx | **0** | 346 líneas: 2xx 214, 3xx 108, 4xx 24 |
| API 5xx | **0 / 0** | api_1: 4.367 respuestas · api_2: 4.376 |
| Errores de `auth_request` | **0** | |
| Error log del edge | 2 | 1 `recv() reset` en `/api/leo/memory` a las 15:17:25Z, justo tras el recreate de strict, un caso aislado · 1 `anchors.json` ausente, 404 que ya existía |
| Reinicios / OOM | 0 / no | api_1, api_2, front y edge |
| CPU / memoria | API alrededor del 0,8 %, 80–89 MiB por réplica | Las consultas de Prometheus por `name` no devolvieron series. Se tomó `docker stats` puntual |
| 403 del autorizador `/uploads` | 7 | `UNMAPPED_ASSET`×3 y `RAW_EPUB`×2 son el smoke anónimo de CP-2 (15:16:50Z). `NO_CONTENT_ACCESS`×2 es el smoke «sin derecho» con la cuenta lectora de CP-0B (15:32Z). **Todo esperado** |
| 401 / 403 de la API | 21 | **Esperados**: sesión expirada (ráfaga de navegador `/api/auth/me`, users, groups…; LU, `progress/sync`), un login fallido de LU 0.9.1 seguido de login 200, un 401 de bot en el endpoint EPUB y un 403 de `/access` |
| Sospechosos | **0** | Ningún lector legítimo bloqueado y ninguna repetición anómala |
| LU 0.9.1 | 39 peticiones, 2 IPs | `progress/sync` 200×20, analytics 200×14, login/logout/assignment 200 |
| LU 0.9.0 y okhttp ≤0.8 | 0 | |
| PDF Range, álbum, audio | sin señal | `/uploads` tiene `access_log off`. No se registró ningún error asociado |
| Rendimiento | p50 11 ms | El p95 de la API (alrededor de 1,8 s) lo explica `/api/health/ready`, el healthcheck (p50 1,6 s). Las rutas de usuario van de 14 a 46 ms de p95 |
| Alertas | `DiskNearFull` | Activa desde 2026-10-16T18:39Z, antes de CP-2. Disco al 86 % (16 GB libres; 31 GB recuperables en imágenes) |
| Incidencias | ninguna | No hay fuente de quejas fuera de logs |

`CP2_24H_STABILITY: GREEN`

## D. Candidato Web/API

- **SHA:** `598bfb4c623265325bc9cbbaf950843d65f3a12d`.
- **Commits sobre producción (`2357ea0`):** `bfd9b35` (test), `093d6d0` (docs), `a363f7b` (CP-3), `0c6d479` (docs) y `598bfb4` (CP-3A).
- **Runtime:**
  - `server/server.js` y `server/accessService.js`: catálogo saneado y logging masivo suprimido.
  - `context/AuthContext.tsx` y `utils/clientEditorialStorage.ts`: limpieza al hacer logout.
  - `pages/VisorInmersivo.tsx`: el arranque espera al veredicto de acceso.
  - `pages/VisorTexto.tsx`: el texto no se persiste.
  - El resto son tests y docs.
- **Front respecto a `f116248`:** solo esos 4 archivos, más `package.json` (scripts de test).
- **Fuente:** `git -c core.autocrlf=false archive 598bfb4`. El primer intento sin esa opción metía CRLF en los estáticos y se descartó.

## E. Tests (Linux, imagen API, sobre `git archive 598bfb4`)

| Suite | Resultado | Clasificación |
|---|---|---|
| test:content-rmw: catalogResourceLocators 33/0, catalogAccessLogNoise 48/0, uploadsAuthzStrict 157/0, epubOriginalEndpoint 32/0, epubProgressSync 39/0, epubProgress 31/0, ClientContentProtection.structural 19/0 y el resto | OK | GREEN |
| canonicalBookTxt | `Cannot find package 'typescript'` (sin devDeps en la imagen) | SKIPPED_BY_PLATFORM (pasa en Windows) |
| test:explicit-access, test:memberships | OK | GREEN |
| test:b2c (unidad) / integración en contenedor desechable | OK / 55/0 | GREEN |
| authzListingScope 79/0 · leoMemoryOwnership 72/0 · sessionIdentityIntegration 34/0 · sessionBrowserCookieOnly 13/0 · progressReadIdentity 27/0 | OK | GREEN |
| test:library → libraryInstitutionalPersonal «no-store» | 1 ✗ | PREEXISTING_FAILURE |
| test:a11y-reader (Windows) | 53 + 27 + 18 + 26 ✓ | GREEN |
| Build del front | Docker `npm run build` correcto | GREEN |

NEW_FAILURE: ninguno.

## F/G. Imágenes (locales, sin transferir al VPS)

| Imagen | ID | Notas |
|---|---|---|
| `chibalete/api:contentprotect-cp3-598bfb4` | `sha256:d8101582ac9fd34aa4b6d388a0b7a1b9546a393786317e2b530878fea59a2c5a` | Label `revision` y `GIT_SHA` = `598bfb4c…`; `RELEASE_TAG` = `contentprotect-cp3-598bfb4`. El servidor arranca en strict+enforce en las suites integradas, con código de `/app` |
| `chibalete/front:contentprotect-cp3-598bfb4` | `sha256:fd6303c85bbc34ab82391de1b524e45be3e4e43c6581a229e5092609a418895a` | Arranca y sirve `index` 200, rutas SPA 200 y `epub-reader.html` 200 (con upstream stub) |

**Bundle front respecto a producción:**
- 76 archivos.
- Los únicos chunks con contenido distinto, una vez normalizados los hashes de import, son `index`, `VisorInmersivo` y `VisorTexto`. El resto de chunks solo cambia de nombre por la cascada de hashes.
- EPUB reader y `vendor/` son byte-idénticos.
- Marcadores:
  - `saveOfflineText` y `offlineTextCache`: 1 → 0.
  - `chibalete_content`: 0 → 1.
  - `gemini_cache_`, `leo_session_` y `leo-chat-` añadidos al limpiador.

Artefactos en `deployment_package/cp3-rollout/` (gitignored), con `SHA256SUMS`:

```
b85439cc80596816a3c08e941a1361e90024a034c61c243aea9d91800a10e1bd  api-contentprotect-cp3-598bfb4.tar.gz   (154.257.976 B)
0fbdb42804853cf3ffc216afa9d6051998898a09b65675d961c143c7c7f6592b  front-contentprotect-cp3-598bfb4.tar.gz (22.459.379 B)
4c7e29e67988891011feda2fef6618176ce79825e7289c5c1f2d69b5fa1de902  chibalete-lu-0.9.2.apk                  (2.010.794 B)
```

## H. LU 0.9.2

- **Commits:** `61dde15` → `cd24fdafaaf0ab1d231fdfcba8e6a174ee90b6e1` `chore(release): LU 0.9.2 (versionCode 12)`. Solo cambia `build.gradle.kts`, 2 líneas.
- **Tests:** JVM/Robolectric 68 pass, 0 fallos, 1 omitido (el test live). `assembleRelease` correcto.
- **APK:**
  - `com.chibalete.lu` 0.9.2 / 12, firma V2.
  - Certificado `CN=Chibalete Editores, O=Chibalete Editores, C=CO`, SHA-256 `7cd34ce8438e28aee2c91bb73e295f8ed1c0981afc8134d2443c7cc59fa45f66`. Es **el mismo** que el de la 0.9.1 instalada, que es byte-idéntica a la publicada (`64e7f2e4…`).
  - `CHPLU1` presente en el dex.
- **No publicado.**

## I–M. Dispositivo real

Xiaomi 25078RA3EL, Android 15 / SDK 35, serie `Y965TCGIXOF67LFE`.

| Paso | Evidencia |
|---|---|
| Estado previo | 0.9.1/11, `firstInstallTime` 2026-08-29 14:29:58, libro offline descargado por 0.9.1 (formato en claro) |
| Upgrade | `install -r` → Success (15:02:52Z–15:02:57Z). Queda 0.9.2/12 con `firstInstallTime` **intacto** y sin borrar datos |
| Migración | `MigrationRunner v2→v3`, `legacy_plaintext_migrated` y `Migration applied`. **48 ms** (10:02:59.209 → .257 local). Sin `legacy_plaintext_migration_failed` |
| Lector tras la migración | Abre y el árbol de accesibilidad expone el texto completo (unos 101 K caracteres en el nodo del lector) → `book.enc` se descifra correctamente |
| Captura | **BLACK**: 99,8 % de píxeles negros; la ventana lleva el flag `SECURE` |
| Grabación | **BLACK**: `screenrecord` de 4 s y un fotograma negro |
| Recientes | La tarjeta de Chibalete sale **en blanco**, sin contenido |
| Fuera del lector | Home/Login se capturan con normalidad |
| Modo avión | `airplane_mode_on=1` y la red inalcanzable. Tras un force-stop, la app muestra «Sin conexión — usando datos guardados» y «Listo — sin conexión». El lector abre con el texto completo |
| 401 real | La sesión expiró por TTL en el servidor (edge: `ChibaleteLU/0.9.1` sync 401 a las 15:00Z). La app muestra «Tu sesión expiró…» y conserva el libro («Listo para leer»). Al volver la red registra `session_requires_reauth (no destructivo)`. El re-login da `same_user=true had_previous=true` y **no hay descarga**: se reutiliza `book.enc` |
| Logout | Menú → «Cerrar sesión» → Login. El siguiente login da `same_user=false had_previous=false` y **descarga de nuevo** (`download_start` → `download_success`, 124.375 B, 0,5 s). El libro y la metadata se purgaron, y el re-login descarga |
| 403 por revocación | **NOT_EXECUTED_NO_SAFE_FIXTURE**: no se crean grants ni deudas. Cubierto por OfflineBookProtectionTest y ProtectedBookDownloadTest (Robolectric) |

**Límites:**
- La app es release y no depurable (`run-as` denegado, `allowBackup=false`), así que la ausencia de `book.txt` y la presencia de `book.enc` en disco no se listan directamente en el dispositivo. La evidencia son los logs de migración y el contenido que muestra el lector.
- La lista directa de ficheros, con 0 apariciones del texto, se hizo en el emulador durante CP-3.
- El borrado del alias de Keystore se verifica por código (`OfflineBookCipher` → `delete()` → `KeyStore.deleteEntry`) y por tests.

## N–P. Catálogo, Inmersivo y storage web

- **R2:** catalogResourceLocators 33/0 y catalogAccessLogNoise 48/0 con el código de la imagen candidata.
  - Usuario autorizado: registro íntegro.
  - Usuario sin acceso: metadata y portada, sin localizadores.
  - Admin: íntegro.
  - Pedagogía: por rol.
  - **0 líneas de log por título.**
- **R6:** ClientContentProtection.structural 19/0. `StartupEngine.start()` se ejecuta una sola vez, gateado por `accessAllowedFor === content.id`, que solo se fija con `allowed === true`. Hay un único fetch a `/access` y ningún fetch directo del texto. La prueba con navegador (pending/denied → 0 peticiones editoriales) está en CP-3.
- **R7:** el logout llama a `clearEditorialClientStorage`, que borra:
  - `chibalete_offline_texto`
  - `chibalete_content`
  - `gemini_cache_*`
  - `leo_session_*`
  - `leo-chat-*`

  No hay `localStorage.clear()`, así que las preferencias de accesibilidad y la cola de progreso se conservan. La respuesta lleva `Clear-Site-Data: "cache"` (no `"storage"`), verificado en catalogResourceLocators [R7].

## Q. Accesibilidad

- El diff de CP-3 en `VisorTexto` y `VisorInmersivo` no toca `aria-*`, `role`, `tabIndex`, foco ni teclado. El chunk de VisorAccesible tiene el mismo contenido que en producción.
- test:a11y-reader: GREEN.
- En LU, el árbol de accesibilidad del lector conserva el texto con FLAG_SECURE.

`ACCESSIBILITY_REGRESSION: ZERO`

## S. Rollback (preparado, no ejecutado)

No hay feature flag específico de CP-3: el rollback es por imagen.

```bash
cd /opt/chibaleteplus
# Antes del deploy (ventana de rollout):
docker tag chibalete/api:contentprotect-2357ea0  chibalete/api:rollback-pre-cp3
docker tag chibalete/front:librarytabs-f116248   chibalete/front:rollback-pre-cp3
cp -p docker-compose.override.yml docker-compose.override.yml.bak-pre-cp3-$(date -u +%Y%m%dT%H%M%SZ)

# Rollback API (líneas 40 y 85 del override):
sed -i 's#chibalete/api:contentprotect-cp3-598bfb4#chibalete/api:contentprotect-2357ea0#' docker-compose.override.yml
docker compose up -d --no-deps api_1   # esperar healthy
docker compose up -d --no-deps api_2   # esperar healthy

# Rollback front (línea 130):
sed -i 's#chibalete/front:contentprotect-cp3-598bfb4#chibalete/front:librarytabs-f116248#' docker-compose.override.yml
docker compose up -d --no-deps front
docker exec chibalete_edge nginx -s reload
```

- `UPLOADS_AUTHZ_MODE: "strict"` (líneas 60 y 103) **no se toca** en ninguno de los dos sentidos.
- **LU:** el APK 0.9.1 sigue en `/uploads/chibalete-lu-0.9.1.apk`. Antes de publicar se guarda `lu_config.json.bak-pre-0.9.2-<ts>` y el rollback es restaurarlo. No hay updater en el APK, así que no hay un canal que revertir.

## Plan de rollout (no ejecutado)

Orden: **API → front → LU.** El backend CP-3 es compatible con LU 0.9.1: LU solo usa `/api/offline/assignment` y `/uploads` autenticado, que no cambian. Así el riesgo web se aísla primero y la publicación de LU queda desacoplada y revertible por `lu_config`. No se impone ninguna actualización (`forceUpdate` sigue en false).

1. **Backups JIT:** structured y uploads, como en CP-2.
2. **Transferencia** de los tarballs (`scp`) → `sha256sum -c` → `docker load` → verificar los IDs `d8101582…` y `fd6303c8…`.
3. Tags `rollback-pre-cp3` y backup del override.
4. **API:** cambiar la imagen de api_1 → recreate → healthy → smoke:
   - `GET /api/content` de lector sin derecho: sin `/uploads` salvo la portada;
   - autorizado: íntegro;
   - 1 línea `CATALOG_ACCESS_FILTER`;
   - TXT anónimo 401;
   - portada 204.
5. Lo mismo para api_2.
6. **Front:** recreate + reload del edge.
7. **Smoke de navegador:** Guiado, Accesible, Inmersivo (sin peticiones editoriales antes del veredicto), PDF, Álbum, EPUB; logout con `Clear-Site-Data: "cache"` y las claves borradas.
8. **LU:** subir el APK 0.9.2 como `/uploads/chibalete-lu-0.9.2.apk` (nombre nuevo) → descarga HTTPS byte-idéntica (`4c7e29e6…`) → `lu_config.json` a 0.9.2 (con backup) → `/api/lu/version`.
9. **Smoke LU:** el Xiaomi ya está en 0.9.2 y reinstala el artefacto publicado con `install -r`.
10. **Monitorización:** 30 min (5xx, `auth_request`, 401/403 por UA) y revisión a las 24 h.
11. **Rollback** (sección S) si falla cualquier gate.

## T. Invariantes

No se tocaron:
- contenedores, imágenes en el VPS, el override, nginx o edge;
- `lu_config`, `/uploads`, content y access_db;
- cuentas y grants.

El único efecto lateral es el Xiaomi de QA del operador, que queda en LU 0.9.2 (no publicada), con sesión válida y el libro re-descargado.

## U. Deudas

- **Preexistentes, no bloqueantes:**
  - fallo no-store de libraryInstitutionalPersonal;
  - `canonicalBookTxt` necesita typescript, que no está en la imagen;
  - el test legacy x-user-id de test:immersive;
  - `DiskNearFull` (86 %);
  - `/uploads` con `access_log off` y 401 del autorizador sin log;
  - consultas de Prometheus por nombre de contenedor sin series;
  - `/api/health/ready` en alrededor de 1,6 s;
  - sin canal de actualización en LU.
- **CP-3, no bloqueantes:** el 403 por revocación no se ejecutó en dispositivo por falta de fixture seguro (cubierto por tests); la ausencia de `book.txt` en disco no es observable en un dispositivo release.
- **Bloqueantes:** ninguna.

## V. Gate

```
CP2_24H_STABILITY:          GREEN
CP3_WEB_API_CANDIDATE:      GREEN
CP3_API_IMAGE:              READY
CP3_FRONT_IMAGE:            READY
LU_0_9_2_RELEASE:           READY
LU_DEVICE_UPGRADE:          GREEN
LU_PLAINTEXT_MIGRATION:     GREEN
LU_FLAG_SECURE_DEVICE:      GREEN
LU_OFFLINE_DEVICE:          GREEN
LU_403_DEVICE_TEST:         NOT_EXECUTED_NO_SAFE_FIXTURE
ACCESSIBILITY_REGRESSION:   ZERO
ROLLBACK_READY:             YES
CP3_ROLLOUT_READY:          YES
```

**NEXT:** CP-3 PRODUCTION ROLLOUT (no ejecutado).
