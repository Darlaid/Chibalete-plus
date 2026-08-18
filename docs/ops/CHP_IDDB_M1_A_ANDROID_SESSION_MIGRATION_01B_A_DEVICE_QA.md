# CHP-IDDB-M1-A-ANDROID-SESSION-MIGRATION-01B-A-DEVICE-QA

Fecha: 2026-08-18 (13:55–14:15Z). Tipo: QA en dispositivo real de Chibalete LU 0.9.0, actualización sobre 0.8.0 con datos vivos.
El APK NO se distribuyó; backend y producción intactos (solo consultas read-only). Credenciales tecleadas exclusivamente por el operador.

> Nota: la primera pasada de esta unidad quedó `YELLOW-OPERATOR-STEP` (sin dispositivo conectado). El operador conectó el equipo y la unidad se re-ejecutó completa el mismo día. Este documento sustituye ese estado.

---

## A. Veredicto

**GREEN-DEVICE** — los 12 criterios del gate se cumplieron. Un solo 401 en toda la sesión (el ping pre-login sin cookie, esperado y no destructivo); 0 errores desde el login; libro y progreso sobrevivieron a upgrade, force-stops, cierre offline y reconexión; la cola offline sincronizó una sola vez.

## B. Preflight y dispositivo

- Repo LU limpio en `31325c0` (baseline `9fdaeb0`). APK 0.9.0: sha256 `a9250330…`, 2.010.794 bytes, `com.chibalete.lu`, vc10, firma V2 `CN=Chibalete Editores` (digest `7cd34ce8…`).
- Dispositivo: Xiaomi **25078RA3EL** (dew_global), **Android 15 / SDK 35** (el equipo del QA histórico, hoy en Android 15; serial truncado `Y965…7LFE`). Conexión ADB inicialmente inestable (offline) — se estabilizó con `adb reconnect`.
- Instalada: **0.8.0 (vc9)**, firstInstall 2026-05-26, lastUpdate 2026-05-27 — baseline de upgrade válido.
- Certificado del APK instalado (base.apk extraído): digest `7cd34ce8…` = **idéntico** al del 0.9.0 → sin STOP-SIGNATURE.
- Baseline visual pre-upgrade (screenshot local, no versionado): libro **"Me desconecto, luego existo"**, badge "Listo para leer", **Progreso: 3% — "Progreso guardado"**, sesión local activa, WiFi arriba.
- Producción pre y post QA: `chibalete/api:8ed4e5e` ambas, healthy, **restarts 0/0**, COMPAT/COMPAT.

## C. Actualización 0.8.0 → 0.9.0

`adb install -r` (sin flags destructivos) → `Success`. Post-install: **versionCode=10, versionName=0.9.0, firstInstallTime INTACTO** (2026-05-26) = actualización en sitio con datos conservados. La app arranca sin crash y muestra la pantalla de login — comportamiento previsto: 0.8.0 nunca almacenó cookie canónica y la política nueva exige sesión para operaciones de red.

## D. Conservación de libro y progreso

Tras el login del operador (mismo usuario), el home es idéntico al baseline: mismo libro "Listo para leer", **Progreso 3% intacto**. Logcat LU: `login_success same_user=true had_previous=true` — la metadata sobrevivió al 401 pre-login (diseño no destructivo) y `clearForOtherUser` fue no-op. En ningún punto de la sesión (upgrade, 401, force-stops, offline) se perdió libro, progreso ni cola.

## E. Sesión y persistencia

Secuencia backend completa (edge, sanitizado; TODA la sesión con UA **`ChibaleteLU/0.9.0 Android/35`** y sin `x-user-id` — el código no lo emite, verificado por test en el alambre):

| t (Z) | request | status | lectura |
|---|---|---|---|
| 14:04:05 | GET /api/offline/assignment | **401** | ping pre-login sin cookie — ÚNICO 401 de la sesión, sin loop, sin purga |
| 14:05:56 | POST /api/auth/login | 200 | cookie emitida (compat) |
| 14:05:57 | GET /api/offline/assignment | **200** | **cookie-only autenticado** |
| 14:07:44–14:08:48 | 3× POST analytics + 2× POST progress sync | **200 todos** | lectura online (~36 s reales, progreso 3%→4%) — el 200 de analytics prueba auth por sesión (header-only recibiría 202-drop) |

Persistencia: **2× force-stop + relaunch** (el segundo tras la ventana MIUI) → la app reabre directo en el home del libro **sin pedir login** (cookie persistente rehidratada del almacenamiento cifrado), progreso actualizado 4% guardado.

## F. Prueba offline

Modo avión activado por ADB y verificado real (`ping 8.8.8.8` → Network is unreachable). Offline: el reader abre el libro descargado en la posición guardada; lectura real (~26 s, progreso 4%→5%); cierre y **force-stop + reopen aún offline** → banner "Sin conexión — usando datos guardados", badge "Listo · sin conexión", **Progreso 5% — "Sin sincronizar — se intentará después"**. Logcat de la ventana offline: `AnalyticsSyncCoordinator: Sync failed — network error` con backoff creciente (~24→32 s) — **error de red ≠ 401: sin logout, sin purga, cola intacta**. 0 crashes (AndroidRuntime limpio).

## G. Reconexión y sincronización

Al desactivar el avión, el NetworkCallback drenó las colas en segundos (14:12:12Z): **1× POST progress sync 200 + 1× POST analytics 200** — una sola entrega lógica, sin reintentos, sin duplicados en el edge. UI final: **"Progreso: 5% — Progreso guardado"** (no retrocede; el banner "Sin conexión" tardó unos segundos más en refrescar — cosmético). Idempotencia por eventId/updatedAt del lado servidor sin cambios.

## H. Salud productiva

Post-QA: 0×401/403/5xx de LU desde el login (12 requests totales de la sesión), APIs healthy, restarts 0/0, 0 5xx globales en la ventana. La sesión QA además constituye el **primer tráfico real end-to-end del UA segmentable `ChibaleteLU/0.9.0`** — base para la observabilidad segmentada del drenaje.

## I. Documento y commit

Este documento; screenshots y logcat quedan como evidencia local en el scratchpad de sesión (no versionados: contienen contenido de pantalla del dispositivo). Commit documental único en la rama `chp/m1a-android-session-migration-01a`.

## J. Límites y riesgos

- Expiración de cookie a 12h NO observada en dispositivo (cubierta por tests automatizados) — límite declarado por la unidad, no bloquea el GREEN.
- Logout explícito NO ejercitado en device (borraría datos locales reales; cubierto por tests).
- Dispositivo corre Android 15 (no 14 como esperaba el brief) — sin efectos observados; el healing MIUI de EncryptedSharedPreferences no se disparó (no hubo corrupción que sanar).
- El APK 0.9.0 sigue SIN distribuir; la población instalada real continúa en 0.7.1/0.8.0 (protegida del loop por la mitigación 202-drop).
- Un solo dispositivo/usuario/modo probado.

## K. Próximo paso

Unidad separada de **distribución canaria controlada** (publicar 0.9.0 en uploads + actualizar `lu_config.json` + coordinar upgrade de los dispositivos conocidos), seguida de `LEGACY-OBSERVABILITY-SEGMENTED-01` → `DRAIN-REDO-WEEKDAY-TRAFFIC-01` → reintento de ENFORCE. No se activó ENFORCE ni se distribuyó el APK en esta unidad.
