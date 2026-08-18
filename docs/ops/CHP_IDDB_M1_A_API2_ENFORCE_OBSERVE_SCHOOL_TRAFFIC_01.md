# CHP-IDDB-M1-A-API2-ENFORCE-OBSERVE-SCHOOL-TRAFFIC-01

Observación del canary `api_2 ENFORCE` con tráfico real. El primer tráfico real de la
ventana **activó una stop condition** (usuario real con cliente legacy parcialmente
bloqueado) y se ejecutó el **rollback pre-autorizado** antes del bloque escolar de lunes.

- Ejecutada: 2026-08-18T03:07:28Z → 03:14:00Z (UTC); rollback a las 03:12:47Z
- Evidencia cruda: `/root/chp-m1-a-observe-school-01/` (+ estado enforce preservado en
  `override.enforce-state-preserved.yml`)
- Referencias: OBSERVE-02H `7129afe`, EXECUTE `e334edf`, backup `7579228b…`

---

## A. Veredicto

**ROLLED-BACK.** Confianza en el diagnóstico: **alta**. **Rollback usado: SÍ** (03:12:47Z,
limpio, verificado).

El canary hizo exactamente su trabajo: el primer usuario real de la ventana (domingo
~20:00 Colombia) evidenció una **población legacy viva que el drenaje nunca vio — la app
Android nativa de Chibalete+** (cliente okhttp que autentica por `x-user-id` y no persiste
la cookie de sesión). Sus escrituras de progreso fueron denegadas al caer en `api_2`
enforce (patrón 50/50 en el mismo segundo), cumpliendo dos stop conditions («usuario real
confirmado bloqueado» y «patrón fuerte 50/50»). Con el bloque escolar a ~9h y población
Android de tamaño desconocido, se ejecutó el rollback pre-autorizado. Producción quedó en
el estado conocido-bueno COMPAT/COMPAT.

## B. Ventana observada

| Campo | Valor |
|---|---|
| enforce_started_at | 2026-08-17T22:48:55Z |
| school_observe_started_at | 2026-08-18T03:07:28Z (preflight) |
| school_observe_ended_at | 2026-08-18T03:14:00Z (post-rollback) |
| Tráfico real analizado | 2026-08-18T00:52–01:19Z (domingo 19:52–20:19 Colombia) |
| window_type | non_school_hours (noche de domingo; el bloque escolar empezaba ~9h después) |
| traffic_sufficiency | **partial** — 1 usuario real multi-dispositivo bastó para veredicto |

## C. Estado de contenedores (post-rollback)

| Contenedor | Modo | ContainerID | StartedAt | Restarts | Health |
|---|---|---|---|---|---|
| `chibalete_api_1` | compat (nunca tocada) | `a7fc56524aec` | 2026-08-16T16:45:14Z | 0 | healthy |
| `chibalete_api_2` | **compat (rollback)** | `9351be57d54c` (antes enforce: `c2c97e3fbdd7`) | 2026-08-18T03:12:47Z | 0 | healthy |
| `chibalete_front` | — | `685fdf0ca59e` | intacto | 0 | healthy |
| `chibalete_edge` | — | `84453f116969` | intacto | 0 | healthy |

## D. Métricas por instancia (ventana de tráfico real, previa al rollback)

```yaml
api_1 (compat):
  legacy_counter: 2 -> 3 (+1)          # EMISOR LEGACY VIVO — atribuido: app Android okhttp,
                                       # GET /api/offline/assignment 200 a las 01:11:42Z
  success{session}: 2 -> 5 (+3)        # 3 logins reales
  no_identity: 21 -> 23 (+2)           # ráfagas sin cookie (idénticas en compat)
  5xx auth/session: 0
api_2 (enforce, proceso retirado):
  legacy_counter: 0 (nunca inicializado — ningún legacy ACEPTADO)
  session_required: 3 -> 10 (+7)
  session_required_attributed:
    ~4 app Android okhttp con x-user-id sin cookie (2 progress sync 01:11:42Z,
      2 offline/assignment post-login 01:15/01:18) -> ENFORCE-CAUSED, real_user
    ~3 ráfaga navegador pre-login 00:52 sin cookie ni header -> expected_unauthenticated
      (mismo 401 en compat; enforce solo re-etiqueta la razón)
  session_required_unattributed: 0
  5xx auth/session: 0
up: continuo en ambas (target api_2 re-scrapeado tras cada recreate)
```

## E. Logs

- api_1: 0 WARN, 8 ERROR — **todos `[TTS] on-demand error`** (incidente separado, §J.3).
- api_2: 3 WARN (`GET progress denied requester=none`, ráfagas sin identidad), 6 ERROR
  (mismos TTS). 0 líneas `[SESSION]`, 0 restarts en ambas.
- edge (00:51→03:07): 306 líneas, 1 IP real (`186.84.20.3`), estados:
  119×200, 72×401, 65×206, 20×304, **13×503 (TODOS `POST /api/tts` — incidente TTS,
  no de sesión)**, 7×499 (aborts del cliente), 4×403 (progress `requester=none` +
  metrics), 3×400.
- Desglose de los 72×401: **53×`POST /api/v1/events` + 7×playback-events +
  3×analytics/events** (§J.2, gap pre-existente, idéntico en compat), 2×progress sync +
  2×offline/assignment (app Android vs enforce), 5×ráfaga pre-login, 1×auth/me.

## F. Tráfico real e impacto en usuarios

```text
real_logins: 3 (todos 200; 1 navegador Firefox 00:53 + 2 app Android okhttp 01:15/01:18)
real_sessions: 3 filas nuevas en sessions.db (todas de user-1781223321961), vivas
real_sessions_through_api_2: sí — la sesión cookie del navegador operó en ambas instancias
  (18×progress sync 200, leo/memory 200, schools config 200)
protected_routes_through_api_2: sí (cookie-path OK en enforce)
suspected_blocked_users: —
confirmed_blocked_users: 1 (dispositivo Android del mismo usuario):
  01:11:42Z mismo segundo: sync->401(api_2) / offline-assignment->200(api_1,legacy+1) /
  sync-retry->401(api_2); tras CADA login (01:15, 01:18) offline-assignment->401 en api_2
  (okhttp no persiste la cookie; la app no puede salir del path legacy por sí sola)
retry_pattern_50_50: CONFIRMADO
real_user_impact: confirmed (parcial: escrituras de progreso y assignment de la app
  Android denegadas ~50%; la experiencia navegador del mismo usuario NO fue afectada
  por enforce)
```

## G. DB / journal / DLQ

- Journal: APPLIED 101234 → 101975 (**+741 = exactamente 3 logins × ~247 resync de
  `lastLoginAt`**, patrón benigno documentado en LOGIN-SMOKE-01); NOOP 251; **PENDING=0,
  FAILED=0**. DLQ relacionada: 0.
- Padrón: 647 usuarios, **cv=0 en los 647 verificado post-logins**; el hash cambió
  (`645a8148…`→`960ff5c5…`) solo por `lastLoginAt` (no es campo de autoridad).
- sessions.db: 3 filas nuevas (vivas); las 7 filas antiguas (expiradas/revocadas) fueron
  **purgadas por el prune propio del sessionStore** (`DELETE FROM sessions…`,
  `server/db/sessionStore.js:82`) — benigno, por diseño (BACKUP_REQUIRED=false).

## H. Smoke / probes

- Probe compat post-rollback: `lt-user-001` sin cookie contra api_2 → 401 con
  **`failure{disabled}`++** (firma compat; en enforce incrementaba `session_required`) —
  atribuido. Health directo + vía edge OK (edge alcanza el contenedor nuevo).
- No se usó ningún usuario activo con x-user-id (regla de no contaminación).

## I. Rollback

**USADO** (03:12:45–03:13:00Z aprox., pre-autorizado por stop condition):
1. Estado enforce preservado (`override.enforce-state-preserved.yml`, sha `da827674…`).
2. Backup restaurado byte-idéntico (sha `7579228b…` verificado con diff).
3. Config resuelta: api_1 compat / api_2 compat.
4. `docker compose up -d --no-deps api_2` → healthy, restarts=0, `SESSION_AUTH_MODE=compat`.
5. api_1/front/edge intactos (mismos IDs/StartedAt). Probe confirma firma compat.
6. Post-rollback (~5 min): 0 WARN/ERROR, 0 5xx.
El backup original sigue disponible en `/root/chp-m1-a-api2-enforce-execute-01/`.

## J. Riesgos residuales y hallazgos colaterales

1. **BLOQUEANTE M1-A: población legacy nativa** — la app Android (okhttp/4.12.0, usa
   `GET /api/offline/assignment` y progress sync) autentica por `x-user-id` y no maneja
   la cookie de sesión. Nunca apareció en la ventana de drenaje (primera request:
   01:11Z del 18). **Ningún reintento de enforce hasta migrar la app a sesión cookie
   (CookieJar en okhttp) o diseñar un mecanismo explícito (p.ej. `SESSION_LEGACY_ALLOW`
   acotado + plan de migración).** El contador legacy la cuenta como `browser`
   (label hardcodeado) — punto ciego ya documentado, ahora materializado.
2. **CRÍTICO STATS (pre-existente, NO causado por enforce): `/api/v1/events` descarta
   TODOS los eventos del navegador cookie-only desde DEPLOY-C** — la ruta usa
   `reqUserId(req)` pero ningún middleware de sesión corre ahí → sin `x-user-id` responde
   `401 "x-user-id required"` (53×401 en 27 min de un usuario LOGUEADO cuyo progreso
   sincronizaba 200; histórico edge: 68×401 vs 25×200). Igual `playback-events` y
   `analytics/events`. Deuda nueva: **CHP-M1A-EVENTS-COOKIE-AUTH-GAP-01** (hacer las
   rutas de eventos session-aware o activar el canonicalIngest preparado en
   `chp/stats-ingest-01b`).
3. **INCIDENTE TTS (separado): OpenAI sin créditos** ("You have no credits remaining") +
   breaker abierto + fallback Gemini fallando ("Model tried to generate text…" / "No audio
   data") → 13×503 en `POST /api/tts`; el usuario real se quedó sin audio on-demand.
   Requiere recarga de créditos o revisión del fallback (relación con HF4B).
4. El navegador del usuario re-logueó 2 veces (posible borrado de cookies del navegador
   al cerrar) — comportamiento del cliente, no del servidor; observar si se repite.
5. Health commit stale (`.deploy-info` congelado) sigue aplicando (cosmético).

## K. Recomendación

- **Producción queda COMPAT/COMPAT (estado conocido-bueno de DEPLOY-C)** — el lunes
  escolar corre sin riesgo de enforce. La cookie-sesión sigue activa y conviviendo con
  el legacy header (como antes del EXECUTE).
- Bloquear nuevos intentos de enforce hasta: (a) migrar/planificar la app Android
  (unidad nueva de descubrimiento: qué app es, versión, población, cómo autentica el
  login okhttp), (b) resolver CHP-M1A-EVENTS-COOKIE-AUTH-GAP-01, (c) recargar créditos
  TTS (independiente pero urgente para UX).
- El rollback-analysis debe además decidir si el criterio de drenaje se re-formula para
  poblaciones no-navegador (el contador actual no las distingue).

## L. Siguiente prompt sugerido

`CHP-IDDB-M1-A-API2-ENFORCE-ROLLBACK-ANALYSIS-01`

## M. Confirmación final

Rollback ejecutado. api_2 volvió a compat. api_1 permaneció en compat. No se tocaron frontend, edge/nginx, datos, uploads ni migraciones.
