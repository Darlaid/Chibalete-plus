# CHP-IDDB-M1-A-ANDROID-COOKIE-SESSION-AUDIT-01

Fecha: 2026-08-18 (12:19–12:30Z, mañana lectiva COT)
Tipo: auditoría read-only (codebase Android + evidencia backend). Sin cambios en producción.
Contexto: fase 2 del plan post-rollback de M1-A ENFORCE (ver `docs/ops/CHP_IDDB_M1_A_API2_ENFORCE_ROLLBACK_ANALYSIS_01.md` y deploy `CHP_M1A_EVENTS_COOKIE_AUTH_GAP_DEPLOY_01.md`).

---

## A. Veredicto

**ANDROID-AUDIT-COMPLETE**

- Confianza: **ALTA**. El codebase Android completo está disponible localmente y la evidencia backend (edge logs 7 días, analytics_db.json, events.db copia read-only, código productivo `c9f323e`) es consistente con él en todos los puntos verificables.
- Frase ejecutiva: **la app Android (Chibalete LU) no tiene CookieJar — descarta el Set-Cookie del login y autentica todo con un interceptor que inyecta `x-user-id`; ENFORCE la bloquea correctamente. Hallazgo nuevo CRÍTICO: desde el deploy del events-guard (hoy 04:47Z), `POST /api/analytics/events` responde 401 a header-only YA EN COMPAT, y el cliente LU trata ese 401 como sesión revocada → purga sesión + libro offline + progreso local y expulsa a login; como la cola de analytics se conserva tras logout por diseño, la app entra en LOOP de logout (~30s) en cuanto un usuario LU lea con red. Aún no observado en producción (0 tráfico okhttp desde 04:47Z), pero es determinista con la versión desplegada.**
- Producción modificada: **no**.

---

## B. Fuentes auditadas

| Fuente | Disponible | Hallazgos | Limitaciones |
|---|---|---|---|
| Codebase Android `D:\001 - app - Chibalete LU` | SÍ (local) | Kotlin + Compose, Retrofit/OkHttp 4.12.0, sin CookieJar, interceptor x-user-id, coordinadores de sync | **NO está bajo git** (hay `.gitignore` pero no repo) — sin trazabilidad de qué commit produjo cada APK |
| Auditoría previa del propio proyecto LU (`AUDITORIA_CHIBALETE_LU_ANDROID_A_IOS.md`) | SÍ | Confirma que el cliente NO invoca `/api/lu/version` | — |
| Edge logs (`chibalete_edge`, docker logs) | SÍ | Ventana ≈7 días (desde 11/Ago 01:33Z); 7 líneas okhttp de app real | Retención corta por rotación; sin cabeceras (solo UA/status) |
| Código backend productivo (`git show c9f323e:server/server.js`) | SÍ | Middleware por ruta verificado | — |
| `analytics_db.json` (lectura) | SÍ | 125 eventos `source='lu_android'`, 5 usuarios | `timestamp` es client_ts (reloj del dispositivo) |
| `events.db` (COPIA en `/root/chp-m1a-android-cookie-session-audit-01/`, mode=ro) | SÍ | 393 filas `mode='lu'` de 19.495 | — |
| Métricas Prometheus in-process | SÍ | 0 `session_required_event_write` no atribuidos desde el deploy | Contadores se resetean con recreate |
| Fingerprint de APK instalado por dispositivo | NO | — | El UA okhttp no lleva versión de app; sin observabilidad de versión instalada |

Fábrica de evidencia VPS: `/root/chp-m1a-android-cookie-session-audit-01/` (edge-okhttp-lines.log, events.copy.db, scripts de consulta read-only).

## C. Evidencia backend

Todo el tráfico okhttp de app real en la ventana retenida (IP única 186.84.20.3, UA `okhttp/4.12.0`, todo del 18/Ago, ventana ENFORCE canary 01:11–01:19Z, pre-rollback 03:12Z):

| timestamp (Z) | user | route | status | instancia inferida | auth | interpretación |
|---|---|---|---|---|---|---|
| 01:11:42 | user-1781223321961 | POST /api/progress/.../sync | 401 | api_2 (enforce) | x-user-id sin cookie | bloqueado por enforce |
| 01:11:42 | idem | GET /api/offline/assignment | 200 | api_1 (compat) | x-user-id | patrón 50/50 round-robin |
| 01:11:42 | idem | POST /api/progress/.../sync | 401 | api_2 (enforce) | x-user-id | retry, bloqueado |
| 01:15:38 | idem | POST /api/auth/login | 200 | — | credenciales | re-login; Set-Cookie emitido y DESCARTADO por el cliente |
| 01:15:38 | idem | GET /api/offline/assignment | 401 | api_2 (enforce) | x-user-id | 401 inmediato tras login OK = prueba de que la cookie no se conservó |
| 01:18:58 | idem | POST /api/auth/login | 200 | — | credenciales | segundo re-login |
| 01:18:58 | idem | GET /api/offline/assignment | 401 | api_2 (enforce) | x-user-id | abandono |

Claves adicionales:
- **0 requests okhttp desde el rollback (03:12Z) y desde el events-guard deploy (04:47Z)** — el loop de logout previsto en §E aún no se ha manifestado (auditoría hecha ~07:25 COT, mañana escolar apenas iniciando).
- **0 POSTs de okhttp a `/api/analytics/events` en toda la ventana de logs** — consistente: en los 8 min observados el usuario casi nunca tuvo sesión válida y no llegó al reader.
- **0 escrituras de eventos de NINGÚN cliente desde 04:47Z** (browser incluido) — el spot-check natural del events-gap deploy sigue pendiente.
- Histórico `analytics_db.json`: **5 usuarios LU** — user-1774362611303 (85 ev, 18/Abr→22/Jul), user-1779493121246-171 (32 ev, 19/Jun→02/Jul), user-1779493121246-091 (4 ev), user-1779493121246-142 (2 ev), user-1781223321961 (2 ev, 12/Jun). Tipos: session_start/heartbeat/session_end. **Prueba de que las versiones desplegadas SÍ postean analytics.**
- `events.db`: 393 filas `mode='lu'` (dual-write del endpoint analytics).
- okhttp/5.3.0 desde IP AWS = scanner, no es la app.

## D. Evidencia código Android

Proyecto: `D:\001 - app - Chibalete LU` — app "Chibalete LU" (lector offline ultraliviano, applicationId `com.chibalete.lu`, versionName **0.8.0** / versionCode 9, minSdk 24, Kotlin+Compose, Retrofit 2.11 + **OkHttp 4.12.0** — coincide con el UA productivo).

```text
android_codebase_available: true
android_codebase_path: D:\001 - app - Chibalete LU
repo_url_or_local_path: local only — SIN git (riesgo de trazabilidad)
branch/commit: n/a
build_system: Gradle Kotlin DSL
language: Kotlin (Jetpack Compose)
distribution_channel: sideload APK servido por el propio backend (public/uploads)
installed_version_known: parcialmente (publicadas 0.7.1 y 0.8.0; por-dispositivo desconocido)
backend_logs_available: true (ventana ≈7 días)
production_access_required: solo lectura (usada)
```

Archivos clave:

| Pregunta | Respuesta | Evidencia |
|---|---|---|
| ¿CookieJar en OkHttp? | **NO** — `OkHttpClient.Builder()` solo con timeouts + AuthInterceptor | `data/network/ApiClient.kt:28-32` |
| ¿Persistencia de cookies? | **NO** existe ninguna capa de cookies (ni JavaNetCookieJar ni manual) | grep global sin hits |
| ¿Interceptor x-user-id? | **SÍ** — inyecta `x-user-id` en toda request no-auth desde SessionStore | `data/network/AuthInterceptor.kt:42` |
| ¿Qué guarda el login? | `user.id/nombre/email/accountStatus` en EncryptedSharedPreferences; **el Set-Cookie del login (COMPAT lo emite) se descarta** | `session/SessionStore.kt` (saveSession), `AuthRepository.kt` |
| Política de sesión cliente | TTL 30 días + 7 de gracia offline; revalida con `GET /api/offline/assignment` | `session/SessionManager.kt` |
| Reacción a 401 | `AuthInterceptor` → `SessionManager.revokeBlocking(REVOKED)` = clearSession + **`LocalDataCleaner.clearAll()`** (borra libro offline descargado, progreso local completo, cache assignment) + expulsión a login | `AuthInterceptor.kt:52-57`, `SessionManager.kt:184-192`, `LocalDataCleaner.kt:73-79` |
| Cola analytics tras logout | **SE CONSERVA por decisión de producto** (Room `pending_analytics_events`) | `LocalDataCleaner.kt:14-17` |
| Sync analytics | Room → `POST /api/analytics/events` batch ≤50; periódico 30s + on-network + tras cada trackEvent; **en 401/403 limpia la sesión** y NO drena la cola | `data/sync/AnalyticsSyncCoordinator.kt:118-122` |
| Sync progreso | `POST /api/progress/{userId}/{contentId}/sync` filas PENDING/FAILED | `data/sync/ProgressSyncCoordinator.kt` |
| ¿WebView/auth dual? | NO — una sola capa nativa | — |
| ¿Update-check? | **NO implementado en el cliente** (el backend tiene `GET /api/lu/version` con forceUpdate/minSupportedVersion, la app no lo llama) | `AUDITORIA_CHIBALETE_LU_ANDROID_A_IOS.md:1178`, server.js:1274 |

## E. Causa raíz

```text
root_cause: la app fue diseñada header-first sobre el contrato legacy: login devuelve
  {user} sin artefacto, el cliente persiste user.id y AuthInterceptor lo reenvía como
  x-user-id en cada request. Nunca existió manejo de cookies (escenario 1 del brief:
  "No existe CookieJar"), así que el Set-Cookie que COMPAT emite en el login se pierde.
  ENFORCE en api_2 la bloqueó CORRECTAMENTE (session_required).
confidence: alta
evidence: ApiClient.kt sin cookieJar; AuthInterceptor.kt:42; secuencia edge 01:15:38Z
  login 200 → assignment 401 el mismo segundo (cookie recién emitida no reenviada).
affected_paths: todas las rutas autenticadas del cliente LU.
affected_users_scope: 5 usuarios LU históricos conocidos; 1 dispositivo activo en los
  últimos 7 días (user-1781223321961); 3 usuarios con prefijo user-1779493121246-* que
  sugieren una cohorte escolar. Población instalada real desconocida (sin telemetría de versión).
```

**Hallazgo nuevo crítico (no estaba en el análisis de rollback): LOOP DE LOGOUT EN COMPAT desde el events-guard deploy (04:47Z de hoy).** Cadena determinista con la app desplegada:

1. Usuario LU lee → `trackEvent(session_start)` encola en Room y dispara sync.
2. `POST /api/analytics/events` va con `x-user-id` sin cookie → `requireEventsWriteAuth` (imagen `c9f323e`) responde **401 ya en COMPAT** (rechaza `authMethod !== 'session'`).
3. El 401 dispara DOS demoliciones en el cliente: el propio coordinator limpia la sesión, y `AuthInterceptor` ejecuta `revokeBlocking` → **borra el libro offline descargado, TODO el progreso local (incluido lo no sincronizado) y la cache de assignment**; el usuario cae a login.
4. Tras re-login, la cola de analytics **persiste por diseño** → el sync periódico (30s) o el próximo evento repite el 401 → **sesiones de ~30 segundos en bucle**, con re-descarga del libro en cada vuelta.

La cola nunca drena por el camino 401 (no incrementa retryCount, no marca failed). El guard de eventos rechaza header-only por diseño (correcto para atribución), pero su interacción con el manejo de 401 del cliente LU convierte la pérdida de un canal de telemetría en **denegación de servicio funcional de la app**. No observado aún en producción únicamente porque no ha habido tráfico okhttp desde las 04:47Z.

## F. Matriz de endpoints Android

| endpoint | method | propósito | auth actual (c9f323e) | cookie_ready | dep. x-user-id | compat | enforce | migración | riesgo |
|---|---|---|---|---|---|---|---|---|---|
| /api/auth/login | POST | login | pública (limiter) | emite cookie (descartada) | no | ✅ | ✅ | guardar cookie | — |
| /api/offline/assignment | GET | libro asignado + ping de vida | requireUserAuth | sí (session-aware) | sí | ✅ | ❌ 401 | cookie | alto |
| /api/offline/assignment | POST/DELETE | reservado (no usado en flujo normal) | requireUserAuth | sí | sí | ✅ | ❌ | cookie | bajo |
| /api/progress/{u}/{c}/sync | POST | subir progreso | requireProgressOwner | sí | sí (header==param) | ✅ | ❌ 401 | cookie | alto |
| /api/progress/item/{u}/{c} | GET | bajar progreso | **SIN middleware** | n/a | no | ✅ | ✅ | — | **deuda: lectura de progreso SIN auth (IDOR de lectura); anotar como `CHP-SEC-PROGRESS-READ-UNAUTH-01`** |
| /api/analytics/events | POST | batch analytics | **requireEventsWriteAuth** | sí | sí | **❌ 401 HOY** | ❌ | cookie (o dejar de postear) | **crítico: dispara el loop §E** |
| /api/lu/version | GET | update-check | pública | n/a | no | ✅ | ✅ | implementar el CLIENTE | — |
| /uploads/* (APK, texto plano del libro) | GET | descarga estática | pública | n/a | no | ✅ | ✅ | — | — |
| /api/auth/me | GET | no usado por LU | — | — | — | — | — | adoptarlo como ping de sesión | — |

## G. Migración recomendada (diseño, NO aplicar sin autorización)

Preferida: **sesión cookie real en LU** (opción 1 del rollback-analysis), en una sola release:

1. **CookieJar persistente**: implementación propia respaldada en EncryptedSharedPreferences (JavaNetCookieJar en memoria NO sobrevive el cierre de la app → insuficiente). Persistir solo la cookie `chp_session` (nombre, valor, expiry); cifrada igual que la sesión actual.
2. **Login**: conservar el flujo actual + capturar Set-Cookie vía el CookieJar. Mantener `SessionStore` para metadata de UX offline (nombre, estado), pero **el userId deja de viajar como credencial**.
3. **AuthInterceptor**: eliminar la inyección de `x-user-id`. Nunca enviar cookie∧header simultáneos (mismatch = 401 en backend). Transición opcional en un solo release intermedio NO recomendada: población mínima, mejor corte limpio.
4. **Rutas con userId en el path** (`/api/progress/{userId}/…`): seguir usando el userId de metadata para construir la URL; la autoridad la da la cookie (requireProgressOwner ya es session-aware).
5. **Manejo de expiración**: la sesión backend expira a las **12h absolutas** — incompatible con el modelo LU de 30 días + gracia offline (app para niños, uso offline). El diseño DEBE resolverlo; opciones (decisión de backend en la fase de migración):
   - (a) re-login silencioso NO posible sin almacenar credenciales (descartado), 
   - (b) endpoint de refresh/rotación de sesión para client_type=lu, 
   - (c) TTL de sesión diferenciado por cliente (claim/flag emitido en login LU).
   La lectura offline nunca debe bloquearse por expiración de cookie (regla producto existente): cookie expirada ⇒ modo OFFLINE_GRACE local, re-login solo al necesitar red.
6. **401/403**: el 401 de analytics NUNCA debe purgar datos locales (aprendizaje del loop §E). Rediseñar: solo `GET /api/offline/assignment` (ping de vida) puede revocar sesión; los canales de telemetría degradan en silencio con backoff.
7. **Logout**: borrar cookie del jar + `POST /api/auth/logout` (revoca sid server-side) + limpieza local actual.
8. **Update-check**: implementar el cliente de `GET /api/lu/version` (ya existe server-side con forceUpdate/minSupportedVersion) — es el mecanismo para retirar versiones legacy en el futuro.
9. **Identificación de versión**: enviar `User-Agent: ChibaleteLU/<versionName> okhttp/4.12.0` (o header propio) para que la observabilidad segmentada distinga versión nueva/vieja sin heurísticas.
10. **Poner el proyecto LU bajo git** antes de tocar una línea (hoy no hay control de versiones: no se puede reconstruir qué código produjo 0.7.1/0.8.0).

## H. Evaluación de SESSION_LEGACY_ALLOW

```text
legacy_allow_needed: NO
recommended: no usar allowlist
scope_if_any: n/a
expiration: n/a
risks: reabrir la falsificación de x-user-id; para eventos NI SIQUIERA funcionaría
  (eventsWriteAuth rechaza authMethod != 'session' por diseño, inmune a legacy-allow)
conditions_to_accept: solo si la población instalada resultara mucho mayor a la conocida
  y la actualización manual tomara semanas; entonces: por-ruta (assignment+progress sync
  únicamente), por client_type=okhttp, con expiración dura, métricas y kill switch.
```

Justificación: población conocida ≤5 usuarios / 1 dispositivo activo en 7 días; el costo de un puente auditable supera al de actualizar los APK manualmente. **Decisión urgente aparte (no es legacy-allow):** mitigar el loop §E — ver §M.

## I. Observabilidad requerida (fase LEGACY-OBSERVABILITY-SEGMENTED-01)

Mínimos: `client_type` derivado de UA (browser/okhttp-legacy/ChibaleteLU-nuevo), `app_version` (cuando el UA nuevo lo lleve), `cookie_present`, `x_user_id_present` (caso cookie∧header explícito), `auth_method`, `route_group`, resultado.

```text
android_auth_attempt_total{app_version, route_group, cookie_present, x_user_id_present, result}
session_auth_attempt_total{client_type, route_group, auth_method, result}
legacy_header_usage_total{client_type, app_version, route_group}   # reemplaza el label 'browser' hardcodeado que ocultó a LU
session_required_total{client_type, app_version, route_group, reason}
```

Además: log estructurado por request denegada (`requester`, client_type, ruta) y panel de adopción de versión LU (`/api/lu/version` hits por versión reportada).

## J. Plan de pruebas (antes de release)

Local/dev (contra server local en compat y enforce):
login guarda cookie persistente · kill+relaunch conserva sesión · assignment cookie-only sin x-user-id → 200 · progress sync cookie-only → 200 · analytics batch cookie-only → 200 y **fila en events.db** · logout borra cookie y revoca sid · cookie expirada → OFFLINE_GRACE local, no purga, re-login al volver red · sin cookie → 401 · header-only → 401 · cookie∧header (build de transición accidental) → 401 mismatch · **401 de analytics NO purga libro/progreso**.

Staging/producción controlada:
usuario smoke LU dedicado · UA nuevo identificable · assignment/progreso/lectura/eventos end-to-end · métricas segmentadas §I mostrando client_type=lu con auth_method=session · contador legacy sin incrementos del dispositivo migrado.

## K. Plan de distribución

```text
distribution_channel: sideload — APKs en /var/www/chibalete/public/uploads/
  (chibalete-lu-0.7.1.apk, chibalete-lu-0.8.0.apk, alias chibalete-lu.apk = bytes de 0.7.1);
  histórico también en studio.chibaleteeditores.com. No hay Play Store.
update_control: NINGUNO efectivo hoy — GET /api/lu/version existe en backend
  (forceUpdate/minSupportedVersion) pero el cliente desplegado NO lo consulta.
can_force_update: no (hasta que una versión con update-check esté instalada)
estimated_devices: ≤5 usuarios históricos; 1 dispositivo activo en la última semana;
  población instalada real DESCONOCIDA (sin telemetría de versión)
legacy_version_retirement_plan: (1) release nuevo con cookies + update-check + UA versionado;
  (2) distribución dirigida (operador contacta a la(s) institución(es) — cohorte
  user-1779493121246-* sugiere un colegio concreto); (3) cuando ENFORCE esté activo, las
  versiones viejas quedan bloqueadas por el backend (401) — el bloqueo es intrínseco;
  (4) subir minSupportedVersion/forceUpdate para las futuras.
```

Preguntas abiertas para el operador:
1. ¿Cuántos dispositivos/colegios recibieron el APK realmente (canal de entrega: enlace directo, presencial)?
2. ¿El alias `chibalete-lu.apk` (bytes 0.7.1) debe seguir publicado o se retira para no sembrar más clientes viejos?
3. ¿Existe contacto directo con los usuarios LU activos para coordinar la actualización?

## L. Condiciones para reintentar ENFORCE (gates)

| # | Gate | Estado hoy |
|---|---|---|
| 1 | Events cookie-auth desplegado GREEN | ✅ (c9f323e, 04:47Z) — spot-check natural pendiente |
| 2 | Mitigación del loop analytics-401 de LU en compat | ❌ NUEVO — ver §M |
| 3 | App LU nueva con cookies publicada | ❌ |
| 4 | Observabilidad segmentada por client_type desplegada | ❌ |
| 5 | Adopción: dispositivos LU activos todos en versión cookie (legacy_header_usage{client_type=okhttp} delta=0) | ❌ |
| 6 | Drain-redo v2: ≥48h en días HÁBILES, delta=0 POR SEGMENTO (browser Y android), mínimos de tráfico/logins/móvil, 0 patrón 50/50 | ❌ |
| 7 | 0 session_required no atribuibles en toda la ventana | — |
| 8 | Rollback config ensayado y backup de override vigente | ✅ (mecanismo probado 2 veces) |

Secuencia de fases confirmada: `ANDROID-SESSION-MIGRATION-01` → `LEGACY-OBSERVABILITY-SEGMENTED-01` (puede ir en paralelo/antes) → `DRAIN-REDO-WEEKDAY-TRAFFIC-01` → `ENFORCE-RETRY-PREFLIGHT-01` → `ENFORCE-RETRY-EXECUTE-01`.

## M. Siguiente fase recomendada

**CHP-IDDB-M1-A-ANDROID-SESSION-MIGRATION-01**, con una **micro-unidad urgente previa dentro de su alcance o como hotfix separado: `CHP-M1A-LU-ANALYTICS-401-LOOP-MITIGATION-01`** (decisión del operador; NO ejecutada en esta auditoría):

- El loop §E es un riesgo activo HOY para cualquier lector LU con red (mañana lectiva en curso). Opciones: (a) hotfix server mínimo — en compat, responder al header-only de `/api/analytics/events` con **202 accept-and-drop** en lugar de 401 (no escribe, no reabre atribución, desarma el loop; se retira al llegar ENFORCE); (b) acelerar el APK con cookies; (c) aceptar el riesgo (población ≈1 dispositivo activo). Recomendada: (a) por ser 1 línea de decisión de status y reversible.
- Se recomienda MIGRATION antes que OBSERVABILITY porque: la población es mínima y ya está censada (este doc); el bloqueo real de ENFORCE es la app, no la visibilidad; y la observabilidad segmentada necesita el UA versionado que introduce la migración para ser útil. OBSERVABILITY-SEGMENTED-01 sigue siendo obligatoria antes del drain-redo (gate 4), pero no es el camino crítico inmediato.

## N. Confirmación final

“Esta fase fue de auditoría. Producción permanece COMPAT/COMPAT. No se activó ENFORCE, no se modificaron flags, variables, contenedores, datos ni configuración productiva.”
