# CHP-M1A-EVENTS-COOKIE-AUTH-GAP-DEPLOY-01

Deploy productivo del fix de cookie-auth en rutas de escritura de eventos
(`77c0f3b`+`c9f323e`, rama `chp/m1a-events-cookie-auth-gap-01`).

- Ejecutado: 2026-08-18T04:28:45Z → 04:47:20Z (UTC)
- Evidencia: `/root/chp-m1a-events-cookie-auth-gap-deploy-01/`
- Imagen nueva: **`chibalete/api:c9f323e`** (`52aff344e659…`), desde tar byte-exacto
  `src-c9f323e.tar` (sha `db795dbc77ed…`, idéntico local/VPS), `Dockerfile.api` del repo.

---

## A. Veredicto

**DEPLOY-GREEN.** Confianza: **alta**. **Rollback usado: NO.**

Las 4 rutas de escritura de eventos exigen sesión firmada en producción: cookie-only
autentica (probado con sesión real emitida server-side), header-only rechazado en ambas
instancias (incluido el alias `/api/events` que ANTES escribía a events.db con header de
usuario activo), mismatch rechazado, cero escrituras espurias, cero 5xx, COMPAT/COMPAT
intacto. Caveat menor documentado en §I: el primer evento natural end-to-end quedará
verificado con el tráfico de la mañana (el usuario real que apareció en la observación
hizo login pero no entró a leer; el write-path del handler no cambió ni un byte).

**Nota de mecanismo (desviación prevista):** el preflight confirmó que las APIs NO montan
`server/` (docker inspect --format de mounts: 0 coincidencias) — el código viaja en la
imagen desde `2945fa8`. El "swap de bind mount" del plan previo no aplica; se usó el
mecanismo vigente real: build de imagen del SHA + recreate escalonado, igual que
DEPLOY-A/GAP-2/GAP-3.

## B. Preflight (Gate A PASS, 04:28:45Z)

| Componente | Estado previo | Health | Modo |
|---|---|---|---|
| api_1 | `a7fc56524aec` @ `0ff76b6` (desde 08-16) | healthy | compat |
| api_2 | `9351be57d54c` @ `0ff76b6` (post-rollback enforce) | healthy | compat |
| front | `685fdf0ca59e` intacto | healthy | — |
| edge | `84453f116969` intacto | healthy | — |

0 errores/5xx en 30 min previos; sin deploy concurrente; Gate B: diff remoto `c9f323e`
vs `0ff76b6` = exactamente los 6 archivos esperados (0 frontend/compose/env).

## C. Diff desplegado

- Runtime: `server/server.js` (+18/−5: import + guard + 4 rutas) y
  `server/lib/eventsWriteAuth.js` (nuevo) — dentro de la imagen `c9f323e` (los tests/docs
  viajan en la imagen sin efecto runtime; `package.json` solo cambió scripts de test).
- Delta compose: SOLO las 2 líneas `image:` de api_1/api_2 (`0ff76b6`→`c9f323e`),
  verificado con diff (4 líneas = 2 pares) y config resuelta filtrada
  (`SESSION_AUTH_MODE: compat` intacto en ambas).
- Canary de imagen (aislado `--network none`): sintaxis OK + 9 escenarios guard +
  4 rutas estructural + sesión 42/42 — GREEN dentro de la imagen exacta desplegada.

## D. Backup (Gate C PASS)

`/root/chp-m1a-events-cookie-auth-gap-deploy-01/`: `override.pre-deploy.yml`
(sha `7579228b…`, byte-verificado), inspects pre de ambas APIs, logs 1h, métricas pre
(api_1 7 series / api_2 2), `events.pre.db` (19.496 filas), compose ps.
**Restauración:** `cp override.pre-deploy.yml` sobre el override + `docker compose up -d
--no-deps api_2` → validar → ídem `api_1` (la imagen `0ff76b6` sigue presente en el host).

## E. Restart escalonado (Gate G PASS)

| Contenedor | Anterior | Nuevo | StartedAt | Health | Errores arranque |
|---|---|---|---|---|---|
| api_2 (primero) | `9351be57d54c` | `8078240fb222` | 04:32:23Z | healthy ~10s | 0 |
| api_1 (tras smoke api_2) | `a7fc56524aec` | `e872fe449559` | 04:34:07Z | healthy ~10s | 0 |
| front / edge | — | **sin cambio** | intactos | healthy | — |

Edge balanceando 4/4 a ambos contenedores nuevos; ruta pública 200 vía edge.

## F. Smoke (Gate H PASS — matriz completa, CERO escrituras)

| Prueba | Esperado | Obtenido | Resultado |
|---|---|---|---|
| header-only `lt-user-001` → v1/events (api_2 y api_1) | 401 | 401 «se requiere sesión activa» (+`failure{disabled}`) | ✅ |
| header-only usuario ACTIVO → `/api/events` (alias) | 401 (ANTES: escribía a events.db) | 401 + `failure{session_required_event_write}` | ✅ cierre del bypass |
| cookie-only real (sesión smoke server-side, técnica B1/B2, token no impreso) + body inválido → v1/events | 400 `events array required` (= auth PASÓ sin escribir) | 400 | ✅ prueba central |
| cookie + `x-user-id` divergente → v1/events | 401 | 401 + `subject_mismatch` | ✅ |
| cookie-only body inválido → playback-events | 400 | 400 `events[] required` | ✅ |
| logout de la sesión smoke | 200 + revocada | 200, `revoked{logout}` | ✅ |
| events.db tras todo el smoke | 19.496 sin cambio | 19.496 | ✅ cero contaminación |
| `/api/health` + `/ready` ambas, pública vía edge | 200 | 200 | ✅ |
| progress/login | intactos | login natural 04:38Z exitoso (§H) | ✅ |

Diseño del smoke: se probó la frontera de auth con **400-vs-401** (body inválido) para
validar cookie-only real SIN inyectar eventos smoke en el backbone canónico.

## G. Logs / métricas / DB (post-deploy, ventana 04:32→04:47Z)

- api_1: 91 líneas, 0 ERROR, 1 WARN benigno (`progress denied requester=none`, clase
  pre-existente); api_2: 103 líneas, 0 WARN/ERROR. **0 apariciones de
  `x-user-id required`** (el literal viejo ya no existe en el path).
- Edge: 50 líneas, **0×5xx**; 5×401 = bootstrap sin cookie de pestaña que vuelve
  (04:38:13Z, idéntico a compat previo); 2×403 = clase `requester=none` pre-existente.
- Métricas: razón nueva `session_required_event_write` operativa (1, del probe);
  baselines nuevos post-recreate documentados: api_1 {disabled:1 probe, no_identity:2},
  api_2 {legacy:1 **artefacto del probe 2 del smoke** (authenticate cuenta la aceptación
  compat antes del veto del guard), mismatch:1 probe, success:1 login natural,
  session_required_event_write:1 probe}. Prometheus `up`=1 ambas.
- events.db: 19.496 → 19.496 (0 escrituras en toda la ventana — no hubo tráfico natural
  de lectura aún).

## H. Observación corta

~15 min (04:32→04:47Z). 0 restarts, 0 errores, 0 5xx. **Apareció tráfico real**:
`user-1774362611303` (el usuario recurrente) hizo **login natural exitoso vía api_2 en
la imagen nueva** (04:38:25Z, sesión viva) y navegó (22×200/21×304); no entró a una
lectura, así que no emitió eventos. Android/okhttp: sin apariciones en la ventana.

## I. STATS

```text
navegador_cookie_only_vuelve_a_escribir_eventos: SÍ a nivel de auth (probado con sesión
  real: la ruta ya no devuelve 401 a cookie-only; devolvió 400 de validación de body).
  End-to-end natural: PENDIENTE del primer lector de la mañana — el write-path del
  handler no cambió ni un byte, riesgo residual ≈ 0. Spot-check recomendado.
events_db_recibe_eventos_validos: no ejercitado aún por tráfico natural (0 lecturas en
  la ventana nocturna); ninguna escritura espuria.
eventos_perdidos_recuperables: NO (pérdida DEPLOY-C→este deploy es definitiva).
siguiente_fase_stats: la agenda INGEST/MAT queda desbloqueada tras confirmar el primer
  evento natural.
```

## J. Seguridad (confirmado en producción)

- Header-only rechazado en AMBAS instancias y en el alias legacy. ✅
- Mismatch cookie/header rechazado. ✅
- No queda bypass de `x-user-id` crudo en escrituras de eventos. ✅
- Un futuro ENFORCE (incluso con `SESSION_LEGACY_ALLOW=1`) no reabre la escritura de
  eventos por header (veto por `authMethod`). ✅

## K. Riesgos residuales

- Android legacy sigue pendiente (audit/migración; sus rutas offline/progress no se
  tocaron en este deploy).
- Eventos perdidos desde DEPLOY-C: irrecuperables.
- Primer evento natural end-to-end pendiente de tráfico de mañana (spot-check).
- STATS ingest/materializer requieren sus propias fases (este deploy solo destapa el
  flujo de entrada).
- TTS sigue caído por créditos OpenAI (fase aparte, no relacionada).
- ENFORCE sigue BLOQUEADO; producción queda COMPAT/COMPAT por diseño.
- Contadores prom reseteados por los recreates (baselines nuevos en §G — no confundir
  con drenaje).

## L. Siguiente prompt sugerido

**`CHP-IDDB-M1-A-ANDROID-COOKIE-SESSION-AUDIT-01`** — justificación: el desbloqueo de
STATS ya solo depende de confirmar el primer evento natural (spot-check trivial, puede
hacerse al inicio de cualquier fase); el camino crítico del programa M1-A vuelve a ser la
app Android (único bloqueante estructural del enforce y del cierre de M1-A), y su audit
necesita información del operador (codebase, distribución, población) que conviene
arrancar cuanto antes. Si se prefiere continuidad STATS inmediata:
`CHP-STATS-INGEST-MATERIALIZER-RESUME-01` es viable tras el spot-check.

## M. Confirmación final

Fix events cookie-auth desplegado. Producción permanece COMPAT/COMPAT. No se activó ENFORCE, no se tocaron frontend, edge/nginx, datos, uploads ni migraciones.
