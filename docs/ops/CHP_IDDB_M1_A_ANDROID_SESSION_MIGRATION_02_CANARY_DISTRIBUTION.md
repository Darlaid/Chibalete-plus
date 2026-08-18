# CHP-IDDB-M1-A-ANDROID-SESSION-MIGRATION-02-CANARY-DISTRIBUTION

Fecha: 2026-08-18 (14:16–14:25Z). Tipo: distribución canaria controlada de Chibalete LU 0.9.0.
Sin rollout general, sin ENFORCE, sin tocar COMPAT ni la mitigación 202-drop, sin borrar datos de ningún dispositivo.

---

## A. Veredicto

**GREEN-CANARY** — el artefacto publicado es byte-idéntico al APK GREEN-DEVICE en cada salto (build local = staging = publicado = descarga HTTPS), el dispositivo canario lo instaló por `install -r` conservando instalación, libro, progreso y **sesión viva sin re-login**, y la población no canaria permanece intacta y protegida (lu_config sin cambios, alias legacy intacto, 202-drop activo). Cohorte canaria efectiva: 1 dispositivo (límite documentado en §J).

## B. Preflight

- Chibalete+ limpio en `chp/m1a-android-session-migration-01a` (`f449acb`); repo LU limpio en `31325c0` (baseline `9fdaeb0`).
- Artefacto candidato = **exactamente el GREEN-DEVICE**: `app-release.apk` sha256 `a925033054a4846a3ecff779e738f5abd7c55ca1831544f3219b809895888e0b`, 2.010.794 bytes, `com.chibalete.lu`, versionCode 10, versionName 0.9.0, firma V2 `CN=Chibalete Editores` (digest `7cd34ce8…`). Sin RED-ARTIFACT-MISMATCH.
- Producción: `chibalete/api:8ed4e5e` ambas APIs, healthy, restarts 0/0, COMPAT/COMPAT, métrica `legacy_analytics_accept_drop` viva (=1, sin incrementos nuevos), 0 5xx.
- Mecanismo de distribución inspeccionado: APKs en `/var/www/chibalete/public/uploads/` (0.7.1, 0.8.0, alias `chibalete-lu.apk`=0.7.1, bak 0.1.0); `data/lu_config.json` en versión 0.8.0 con `forceUpdate:false` / `minSupportedVersion:0.7.1`; **ningún cliente desplegado consulta `GET /api/lu/version`** (confirmado en la auditoría 01 y en 01A: el cliente 0.9.0 tampoco lo implementa aún — límite explícito de esa unidad).
- `chibalete-lu-0.9.0.apk` NO existía en uploads → publicación con nombre nuevo, cero reemplazo silencioso.

## C. Publicación

1. APK subido por SCP a staging (`/root/…staging`), sha256 verificado = `a9250330…`.
2. Movido a `/var/www/chibalete/public/uploads/chibalete-lu-0.9.0.apk` (644 root:root, mismo patrón que los existentes); sha256 re-verificado en destino.
3. **Descarga real por HTTPS** desde una máquina externa: `https://chibaleteplus.chibaleteeditores.com/uploads/chibalete-lu-0.9.0.apk` → 2.010.794 bytes, sha256 **idéntico**. URL final registrada.
4. Peculiaridad observada (no bloqueante, no corregida): la location `/uploads` no aparece en el access log del edge (0 líneas en 30+ min pese a descargas reales) — anotar para la fase de observabilidad.

**Configuración canaria (decisión):** `lu_config.json` **NO se modificó**. Justificación: el archivo no tiene mecanismo de segmentación y hoy no tiene consumidores; mantenerlo en 0.8.0 es la forma más fuerte de garantizar "cero rollout general" mientras el alcance canario se acota por URL versionada + coordinación manual dispositivo a dispositivo. No aplica `YELLOW-CANARY-MECHANISM` porque no hubo que improvisar nada global: la publicación con nombre nuevo no altera el comportamiento de ningún cliente existente. El bump de `lu_config` (version/apkUrl) queda reservado para la unidad de rollout general.

## D. Cohorte canaria

| Dispositivo | Estado inicial | Estado final |
|---|---|---|
| Xiaomi 25078RA3EL, Android 15 (el equipo GREEN-DEVICE; serial truncado `Y965…7LFE`) | 0.9.0/vc10 (instalada horas antes desde build local en 01B-A; firstInstall 2026-05-26) | 0.9.0/vc10 **reinstalada desde el artefacto PUBLICADO** |

Dispositivos de campo conocidos (cohorte escolar `user-1779493121246-*`, user-1774362611303, user-1781223321961) NO integrados en esta sesión: requieren coordinación física del operador con los usuarios/instituciones — ver §J.

## E. Resultados de actualización

`adb install -r` del **APK descargado del URL publicado** → `Success`; post-install: versionCode 10 / 0.9.0, **firstInstallTime intacto** (2026-05-26, lastUpdate 14:20:25Z) = actualización en sitio, sin desinstalación, sin flags destructivos. (El salto 0.8.0→0.9.0 con datos vivos quedó probado en 01B-A sobre este mismo dispositivo y con un binario byte-idéntico; esta unidad añade la evidencia del artefacto servido por el mecanismo real.)

## F. Sesión, lectura y sync

Al reabrir tras la reinstalación: **directo al home del libro, sin pedir login** — la cookie persistente sobrevivió a la reinstalación del artefacto publicado; libro "Me desconecto, luego existo" en "Listo para leer" y **Progreso 5% — "Progreso guardado"** (el acumulado de la sesión QA, sin retroceso). Lectura/sync/analytics end-to-end ya validados sobre este dispositivo y backend en 01B-A (misma hora, mismo binario); no se reabrió ese QA por ausencia de regresión.

## G. Telemetría

Edge (sanitizado): reapertura post-canario = `GET /api/offline/assignment` → **200** con UA **`ChibaleteLU/0.9.0 Android/35`**, cookie-only. **0×401, 0×403, 0×5xx atribuibles a LU** en la ventana. Métrica del 202-drop sin incrementos (ningún cliente legacy afectado). Sin duplicaciones ni crashes (logcat de la sesión previa limpio; sin nuevas entradas de error).

## H. Salud productiva

api_1/api_2 `8ed4e5e` healthy, **restarts 0/0**, 0 5xx globales en la ventana. Sin cambios de imagen, flags, compose, nginx ni datos productivos (la única escritura fue el archivo NUEVO en `public/uploads`, que es contenido de distribución, no configuración ni datos de usuarios).

## I. Cambios realizados

- VPS: + `/var/www/chibalete/public/uploads/chibalete-lu-0.9.0.apk` (nuevo, 644, sha `a9250330…`). Nada más.
- `lu_config.json`: sin cambios (decisión §C).
- Repos: solo este documento (commit documental en `chp/m1a-android-session-migration-01a`).

## J. Límites y riesgos

- **Cobertura real del canario = 1 dispositivo** (el único físicamente accesible), que además ya corría 0.9.0 de build local — la evidencia nueva de esta unidad es del MECANISMO (publicación → descarga → instalación → conservación), no de nuevos usuarios. La extensión a los dispositivos de campo (cohorte escolar + 2 usuarios individuales) requiere que el operador coordine la instalación manual desde la URL publicada (`Ajustes → permitir orígenes desconocidos` + descarga desde el navegador del dispositivo), con credenciales tecleadas por cada usuario.
- Los clientes desplegados no tienen update-check: nadie migra solo; el 202-drop sigue protegiendo a 0.7.1/0.8.0 mientras tanto.
- `/uploads` invisible en el access log del edge → la adopción del canario de campo no podrá medirse por descargas; medirla por UA `ChibaleteLU/0.9.0` en requests de API (insumo directo para LEGACY-OBSERVABILITY-SEGMENTED-01).
- lu_config sigue anunciando 0.8.0 (intencional hasta el rollout general).

## K. Próximo paso

**`CHP-IDDB-M1-A-LEGACY-OBSERVABILITY-SEGMENTED-01`** (métricas por client_type/app_version/route_group — el UA versionado ya emite en producción), en paralelo con la extensión operador-coordinada del canario de campo. Después, en unidades separadas: `DRAIN-REDO-WEEKDAY-TRAFFIC-01` y, solo si sus gates lo permiten, el reintento de ENFORCE. No se ejecutó rollout general ni ENFORCE; COMPAT y 202-drop intactos.
