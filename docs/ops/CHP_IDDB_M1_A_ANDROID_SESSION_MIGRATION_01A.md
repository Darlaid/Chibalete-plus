# CHP-IDDB-M1-A-ANDROID-SESSION-MIGRATION-01A

Fecha: 2026-08-18 (13:30–13:50Z). Tipo: implementación + validación LOCAL en el proyecto Android Chibalete LU.
Sin distribución de APK, sin cambios en backend/VPS/producción (verificable: producción sigue COMPAT/COMPAT en `chibalete/api:8ed4e5e`; solo se leyó un hash por SSH).

---

## A. Veredicto

**YELLOW-DEVICE-QA** — implementación completa, 51/51 tests GREEN, builds debug y release GREEN, APK release firmado con el certificado original y bajo el límite de tamaño. Falta únicamente QA en dispositivo real contra el backend (compat) antes de considerar distribución — ese paso es una unidad posterior.

## B. Baseline y Git

- Proyecto: `D:\001 - app - Chibalete LU` — Kotlin + Compose, Retrofit 2.11 / OkHttp 4.12.0, compileSdk 34 / minSdk 24, versión previa 0.8.0 (vc 9). APK release previo: 2.010.794 bytes.
- **No existía Git.** Antes del baseline se encontraron secretos embebidos: contraseñas del keystore hardcodeadas en `app/build.gradle.kts:23-25` (riesgo ya documentado por la auditoría propia del proyecto, con remedio prescrito). Existía vía segura → no aplicó STOP-SECURITY:
  - credenciales extraídas mecánicamente a `keystore.properties` (gitignored; los valores no se imprimieron en ningún log);
  - `build.gradle.kts` las lee del archivo; sin él, el release sale sin firmar en lugar de romper el sync;
  - `.gitignore` reforzado: `*.jks`, `keystore.properties`, `*.apk/*.aab`, `build/`, `.claude/`, `local.properties`;
  - verificación pre-commit: 0 secretos/keystores/APKs/outputs en el índice (los logs de QA solo contienen ruido de teclado Android, sin credenciales).
- Commits (repo local, **sin remoto**):
  - `9fdaeb0` — `chore: establish Chibalete LU baseline` (181 archivos)
  - `31325c0` — `fix(auth): migrate LU to persistent session cookies`

## C. Contrato de endpoints (verificado contra el código productivo `8ed4e5e`)

| Endpoint | Uso LU | Auth backend | ¿Cookie-only opera? | Notas |
|---|---|---|---|---|
| POST /api/auth/login | login | pública (limiter) | ✅ emite Set-Cookie en compat/enforce | el jar la captura |
| GET /api/offline/assignment | descubrir libro + ping de sesión | `requireUserAuth` **session-aware** | ✅ (en enforce, SOLO cookie) | el x-user-id del navegador ahí es **redundante** (emisor legacy residual del frontend, hallazgo del spot-check) — no es dependencia del backend |
| GET /uploads/… (libro .txt) | descarga | pública | ✅ | — |
| POST /api/progress/{u}/{c}/sync | subir progreso | `requireProgressOwner` session-aware | ✅ (probado en producción por el spot-check del navegador: 200 cookie-only) | userId del path = dato; autoridad = cookie |
| POST /api/analytics/events | telemetría | `requireEventsWriteAuth` (solo sesión) | ✅ | header-only recibe 202-drop (mitigación) — ya no rompe nada |
| POST /api/auth/logout | logout server-side (NUEVO en LU) | cookie | ✅ | revoca el sid |
| GET /api/progress/item/{u}/{c} | **declarado pero SIN llamadores en runtime** | ownership por header crudo en el handler | ❌ (403 cookie-only — deuda backend conocida, fuera de alcance) | no bloquea: clasificada como degradación silenciosa; el progreso local es fuente de verdad |
| GET /api/lu/version | no consumido aún | pública | ✅ | no se implementó el cliente (límite explícito de la unidad) |
| **CSRF global** | todo no-GET con cookie | exige `Sec-Fetch-Site`/`Origin` allowlisted | — | okhttp no envía ninguno → **LU declara `Sec-Fetch-Site: same-origin`** como cliente de primera parte (no envía `Origin` para no interactuar con la allowlist CORS previa) |

Ninguna ruta imprescindible exige `x-user-id` → no aplicó STOP-BACKEND-CONTRACT.

## D. Implementación de CookieJar

`data/network/PersistentCookieJar.kt` (nuevo): conserva EXCLUSIVAMENTE la cookie `chp_session`, cifrada en el mismo `EncryptedSharedPreferences` que ya usa la sesión (cero dependencias nuevas de runtime; en JVM/test cae al fallback plano ya existente). Dominio/path/secure delegados en `okhttp3.Cookie.matches()` (host-only, prefijo de path, secure→https). Cookie expirada → se purga y no se envía; `Set-Cookie` con expiración pasada (logout server) → borra la almacenada. Restauración tras kill/reopen: el jar rehidrata desde el store al primer uso. El valor jamás se loggea.

## E. Retiro de `x-user-id`

`AuthInterceptor` ya no inyecta el header en ninguna request. El id local del usuario se conserva en `SessionStore` **como dato** (rutas con userId en el path, scoping Room, política de cambio de usuario) — nunca como prueba de identidad. Se añadió `User-Agent: ChibaleteLU/<versionName> Android/<sdkInt>` (observabilidad segmentada del drenaje) y el marcador CSRF. Comentarios obsoletos actualizados (`ApiService`, `AssignmentRepository`).

## F. Política de 401 y reautenticación (`session/AuthFailurePolicy.kt`)

| Clase | Rutas | Acción |
|---|---|---|
| Telemetría | analytics/v1-events/playback/alias | `PAUSE_TELEMETRY`: el coordinador pausa reintentos (`authPaused`), conserva la cola íntegra, NO cierra sesión, NO borra nada; reanuda en el próximo login (`onReauthenticated()`) |
| Esencial | assignment, progress sync, resto | `REQUIRE_REAUTH`: retira SOLO la cookie, marca `NEEDS_REVALIDATION`, notifica a la UI para pedir re-login con conectividad. Conserva libro, progreso, colas Y la metadata de sesión (así el re-login del MISMO usuario no dispara la limpieza de cambio de usuario — antes `clearSession()` en 401 nulificaba el prevUserId y el siguiente login purgaba todo por `clearForOtherUser(null,…)`). Anti-loop: notificación solo en la transición desde estado válido |
| Degradación silenciosa | progress/item (hidratación), logout | `IGNORE` |
| Logout explícito | — | ÚNICA vía destructiva: revoca server-side best-effort (cookie capturada antes de limpiar, enviada por header explícito), borra credencial + sesión + limpieza local existente |

Un 403 nunca se interpreta como "cuenta deshabilitada" (puede ser CSRF): misma vía no destructiva. La expiración de la cookie backend (~12h) NO afecta la lectura offline: el modelo local de 30 días + gracia sigue gobernando el acceso al libro; la cookie solo gobierna operaciones de red, que al fallar piden re-login sin tocar datos. `revokeBlocking` (la purga por 401) fue eliminado.

## G. Tests y build

Suite nueva `SessionCookieMigrationTest` (12 casos, Robolectric + MockWebServer test-only): captura de Set-Cookie en login · cookie en la siguiente request · persistencia tras recrear cliente/store · expirada no viaja y se purga · host ajeno y secure-por-http no reciben cookie · `x-user-id` ausente + UA versionado + marcador CSRF · matriz completa de `AuthFailurePolicy` · 401 de analytics repetido no destruye sesión local (anti-loop) · 401 esencial retira cookie conservando metadata · logout limpia cookie y sesión · cambio de usuario no hereda cookie · Set-Cookie expirada del servidor borra la local.

Resultado: **51/51 GREEN** (12 nuevos + 39 preexistentes: AssignedBookState 3, OfflineBookRepository 10, ProgressCalculation 5, ReaderScreen 6, ReadingProgressRepository 9, SessionStoreHealing 7 — offline, progreso e idempotencia de sync intactos). `assembleDebug` y `assembleRelease` GREEN.

## H. Tamaño del APK

| | versión | bytes |
|---|---|---|
| Anterior | 0.8.0 (vc9) | 2.010.794 |
| Nuevo | 0.9.0 (vc10) | **2.010.794** (≪ 5 MB; coincidencia exacta por padding de zipalign — hash distinto del 0.8.0 publicado: `a9250330…` vs `b3bc7fc1…`) |

Firmado V2 con el certificado original `CN=Chibalete Editores` (digest `7cd34ce8…`) → actualiza sobre 0.8.0 con `install -r` sin desinstalar. Metadata: versionCode 10 / versionName 0.9.0. Cero dependencias nuevas de runtime (mockwebserver es testImplementation).

## I. Archivos y commits

Nuevos: `PersistentCookieJar.kt`, `session/AuthFailurePolicy.kt`, `test/SessionCookieMigrationTest.kt`, `keystore.properties` (NO versionado). Modificados: `ApiClient.kt` (jar), `AuthInterceptor.kt` (reescrito), `ApiService.kt` (+logout), `SessionStore.kt` (+persistencia de cookie), `SessionManager.kt` (política no destructiva, logout server-side, hook de tests), `AnalyticsSyncCoordinator.kt` (pausa/reanudación), `AssignmentRepository.kt` (comentario), `app/build.gradle.kts` (firma externalizada, versión, dep de test), `.gitignore`. Total implementación: 8 modificados + 3 nuevos, +213/−65 sobre el baseline.

## J. Riesgos y límites

- **QA en dispositivo real pendiente** (login real contra compat, force-stop/reopen, modo avión, cambio de usuario, upgrade `install -r` sobre 0.8.0 con el healing de EncryptedSharedPreferences en MIUI).
- La app nueva REQUIERE que el backend emita cookie: contra un backend en `SESSION_AUTH_MODE=off` (default dev) no autentica — para QA local levantar el server con `compat`.
- Re-login ~cada 12h cuando hay red (TTL de sesión backend sin refresh): aceptado por diseño de la unidad; la lectura offline no se interrumpe. Un refresh/TTL por client_type queda como evolución backend futura.
- Eventos/telemetría acumulados durante una pausa auth se entregan tras el re-login (idempotentes por eventId).
- La hidratación de progreso backend (`GET /api/progress/item`) sigue sin usarse y hoy no opera cookie-only (deuda backend, fuera de alcance).
- Cliente de `/api/lu/version` / force-update: NO implementado (límite explícito).
- Copia local del artefacto `chibalete-lu-0.8.0.apk` en `app/build/outputs/` fue limpiada por `assembleRelease` (artefacto de build; el canónico sigue publicado en el VPS).
- Repo LU sin remoto (por diseño de la unidad); el APK 0.9.0 NO se distribuyó ni se subió a uploads.

## K. Próximo paso

QA en dispositivo real + distribución controlada (unidad siguiente, p. ej. `CHP-IDDB-M1-A-ANDROID-SESSION-MIGRATION-01B-DEVICE-QA`), seguida de `LEGACY-OBSERVABILITY-SEGMENTED-01` → `DRAIN-REDO-WEEKDAY-TRAFFIC-01` → reintento de ENFORCE. No se activó ENFORCE ni se inició canary alguno.
