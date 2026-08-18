# CHP-IDDB-M1-A-ANDROID-SESSION-MIGRATION-01B-A-DEVICE-QA

Fecha: 2026-08-18 (14:00Z). Tipo: QA en dispositivo real de Chibalete LU 0.9.0 (upgrade sobre 0.8.0).
Estado: **preflight completado; ejecución bloqueada a la espera de una acción física del operador.**

---

## A. Veredicto

**YELLOW-OPERATOR-STEP** — todos los prerrequisitos de software y de producción están verificados y GREEN, pero **no hay ningún dispositivo Android conectado por ADB** en la máquina de trabajo. La unidad no puede ejecutar las fases B–F (instalación, sesión, persistencia, offline, sync) sin el dispositivo físico. Nada fue instalado, distribuido ni modificado.

### Acción exacta requerida del operador

1. Conectar por USB el **Xiaomi Android 14 usado en el QA previo de LU** (el de las sesiones `qa/chibalete-lu-v0.2…v0.7`), con la app 0.8.0 instalada y sus datos intactos (libro asignado + progreso).
2. Activar **Depuración USB** (Ajustes → Opciones de desarrollador) y aceptar el diálogo de autorización RSA del PC al conectar.
3. Verificar que aparece con `adb devices` (el adb usado es el del SDK: `%LOCALAPPDATA%\Android\Sdk\platform-tools\adb.exe`).
4. Tener a mano la credencial del usuario de QA — el login lo teclea el operador; el asistente no introduce ni registra contraseñas.
5. Relanzar la unidad (`CHP-IDDB-M1-A-ANDROID-SESSION-MIGRATION-01B-A-DEVICE-QA`): el preflight de abajo se revalida y se continúa con `adb install -r` (sin flags destructivos) y las fases C–F.

## B. Preflight ya verificado (2026-08-18 14:00Z)

| Ítem | Estado |
|---|---|
| Repo LU (`D:\001 - app - Chibalete LU`) | limpio; commits esperados `9fdaeb0` (baseline) + `31325c0` (migración) en HEAD |
| APK 0.9.0 | `app/build/outputs/apk/release/app-release.apk`, **2.010.794 bytes**, sha256 `a925033054a4846a3ecff779e738f5abd7c55ca1831544f3219b809895888e0b` |
| Metadata | applicationId `com.chibalete.lu`, versionCode **10**, versionName **0.9.0** |
| Firma | V2, certificado original `CN=Chibalete Editores` (sha256 digest `7cd34ce8438e28…`) — misma firma que 0.8.0 ⇒ `install -r` sin desinstalar |
| Tests locales | 51/51 GREEN (ver `CHP_IDDB_M1_A_ANDROID_SESSION_MIGRATION_01A.md`) |
| Producción | api_1/api_2 = `chibalete/api:8ed4e5e`, healthy, **restarts 0/0**, COMPAT/COMPAT, 0 tráfico okhttp reciente, 0 5xx |
| Dispositivo | **`adb devices` vacío — ninguno conectado** (daemon ADB arrancado limpio) |

## C–G. Fases B–F

NO ejecutadas (bloqueadas por el dispositivo). El plan congelado es el de la unidad: `install -r` conservador → verificación de datos → login del operador → lectura breve → force-stop/cierre MIUI → modo avión → reconexión y correlación read-only del sync en producción.

## D. Límites

- Sin dispositivo no se generó ningún baseline de libro/progreso en device.
- No se tocó backend, producción, ni el APK publicado (0.8.0 sigue siendo lo distribuido).
- Expiración de cookie a 12h y logout explícito quedarán como límites no observados en dispositivo (cubiertos por tests), según define la propia unidad.

## E. Próximo paso

Relanzar esta misma unidad con el dispositivo conectado. Si el resultado es `GREEN-DEVICE`, seguirá una unidad separada de **distribución canaria controlada**.
