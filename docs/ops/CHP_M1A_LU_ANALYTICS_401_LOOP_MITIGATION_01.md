# CHP-M1A-LU-ANALYTICS-401-LOOP-MITIGATION-01

Fecha: 2026-08-18 (12:37–12:55Z, mañana lectiva COT)
Tipo: micro-hotfix backend + deploy escalonado. MITIGACIÓN TEMPORAL — se retira con la migración de LU a sesión por cookie.
Contexto: hallazgo crítico de `docs/ops/CHP_IDDB_M1_A_ANDROID_COOKIE_SESSION_AUDIT_01.md` (commit `3a4d9f8`).

---

## A. Veredicto

**MITIGATION-GREEN**

- Confianza: **ALTA** (matriz de smoke 9/9 idéntica al diseño en AMBAS instancias, cero escrituras verificadas por conteo/bytes, canary 99 tests GREEN dentro de la imagen).
- Rollback usado: **NO**.
- Frase ejecutiva: **producción corre `chibalete/api:8ed4e5e` en ambas APIs (COMPAT/COMPAT intacto): `POST /api/analytics/events` header-only ahora responde 202 accept-and-drop en compat — sin escritura, sin identidad, sin tocar el guard estricto de las otras 3 rutas de eventos — desarmando el loop de logout destructivo de la app Android LU antes de que se manifestara (0 tráfico okhttp entre el hallazgo y el deploy).**

## B. Causa del loop

La app Chibalete LU (sin CookieJar) postea batches de analytics con `x-user-id` sin cookie. Desde el events-guard (`c9f323e`, 04:47Z), esa request recibía 401 incluso en compat. El cliente LU trata cualquier 401 como sesión revocada: borra sesión, libro offline descargado y progreso local (incluido lo no sincronizado) y expulsa a login. Como su cola de analytics **se conserva tras logout por diseño**, tras el re-login el sync periódico (~30s) repetía el 401 → loop indefinido con purga de datos en cada vuelta.

## C. Mitigación aplicada

- Ruta exacta: **solo `POST /api/analytics/events`** (verificado estructuralmente: las otras 3 rutas no llevan la mitigación).
- Condición: `SESSION_AUTH_MODE === 'compat'` ∧ `x-user-id` presente ∧ **sin** cookie `chp_session`. No depende de User-Agent (falsificable e innecesario: no hay escritura que proteger).
- Respuesta: `202 {ok:true, accepted:false, dropped:true, reason:"legacy_android_analytics_requires_session"}` — antes del guard estricto y del handler.
- No escritura confirmada: events.db 19.496 → 19.496; analytics_db.json 451.923 → 451.923 bytes tras los probes en ambas instancias.
- Observabilidad: contador `chibalete_auth_session_failure_total{reason="legacy_analytics_accept_drop"}` + log WARN `[EVENTS] analytics header-only accept-and-drop (LU legacy, compat)`.
- Todo lo demás pasa intacto al guard estricto: `off` → next() puro (byte-idéntico); `enforce` → 401 estricto (la mitigación NO aplica — sin bypass futuro); cookie presente (válida/expirada/mismatch) → `authenticate` decide; sin auth alguna → 401 estricto (navegador pre-login, cliente no destructivo).

## D. Diff (`8ed4e5e`, mínimo: 4 archivos, +206/−4)

| Archivo | Cambio |
|---|---|
| `server/lib/eventsWriteAuth.js` | +factoría `createLegacyAnalyticsDropGuard` (guard aditivo, documentado como TEMPORAL) |
| `server/server.js` | +import, +instanciación con `sessionAuthMode`/`parseCookies`/métrica, +1 middleware en la línea de la ruta analytics (3 líneas de cableado) |
| `server/__test__/legacyAnalyticsDropGuard.test.mjs` | nuevo — 10 escenarios + guard estructural de alcance |
| `package.json` | test cableado en `test:identity` |

## E. Tests

| Caso | Esperado | Obtenido |
|---|---|---|
| compat + header-only sin cookie | 202 drop, next NO llamado, onDrop 1 | ✅ |
| cookie-only | next() (guard estricto escribe) | ✅ |
| cookie + header (mismatch/match) | next() (authenticate decide) | ✅ |
| sin auth alguna | next() (401 estricto) | ✅ |
| modo off | next() puro | ✅ |
| modo enforce | next() (401 estricto, sin bypass) | ✅ |
| predicado lanza | next() (fail-closed aguas abajo) | ✅ |
| onDrop lanza | 202 igual | ✅ |
| factoría valida deps | throw | ✅ |
| estructural: mitigación SOLO en analytics; v1/alias/playback con guard estricto sin mitigación | ✅ | ✅ |

Suites completas: legacyAnalyticsDropGuard 10 ✓, eventsWriteAuth 9 ✓, eventsRoutesSessionGuard 4 ✓, browserNoXUserIdGuard 2 ✓, sessionIdentity 42 ✓ (local Windows) — y dentro de la imagen (canary `--network none`): 10+9+4+42 ✓ + **sessionIdentityIntegration 34 ✓**. CI remoto: identity-preflight lanzado sobre `8ed4e5e` (gitleaks-head/trivy/image-integrity success; trivy-image y gitleaks-history rojos = heredados baseline-equivalentes conocidos).

## F. Deploy

- Mecanismo real (el de `c9f323e`): git archive byte-exacto de `8ed4e5e` (tar sha256 `31eef440…`) → `docker build -f Dockerfile.api` en el VPS → `chibalete/api:8ed4e5e` (`8c99e8f4f191`).
- Override: **diff = exactamente 2 líneas** (image de api_1 y api_2, `c9f323e`→`8ed4e5e`); backup `override.pre-mitigation-20260818T125200Z.yml` sha256 `f8aa67ad…` en `/root/chp-m1a-lu-analytics-401-loop-mitigation-01/`.
- Escalonado: `up -d --no-deps api_2` (12:44Z, `05754597c416`, healthy) → smoke → `api_1` (12:47Z, `2799ef82e66a`, healthy) → smoke. Front y edge byte-intactos. `SESSION_AUTH_MODE=compat` verificado en env de ambas.
- Ref productiva: `chp/backup-capacity-01b` ff `c9f323e..8ed4e5e` pushed. Imagen de rollback `c9f323e` retenida en host.

## G. Smoke productivo (idéntico en api_2 y api_1; sesión emitida server-side con helpers reales, token nunca impreso; sujeto = usuario activo del padrón, sid revocado al final)

| Probe | Resultado ambas instancias |
|---|---|
| A analytics header-only (`lt-user-001` sintético) | **202 accept-and-drop** con cuerpo controlado |
| B analytics cookie-only + body inválido | **400 tras auth** (truco 400-vs-401: auth pasó SIN escribir) |
| C analytics cookie + header divergente | 401 (subject_mismatch=1/instancia) |
| D /api/v1/events header-only | 401 |
| E alias /api/events header-only | 401 |
| F /api/playback-events header-only | 401 |
| H analytics sin auth alguna | 401 |
| G logout | 200; cookie post-logout 401 (revocación viva) |
| events.db | 19.496 pre == post |
| analytics_db.json | 451.923 bytes pre == post |
| edge | 200×6 vía edge, **0 5xx** desde el deploy |
| logs | solo boot benigno + 1×400 atribuible a un probe propio mangleado |
| métricas | `legacy_analytics_accept_drop`=1/instancia (probe A); serie legacy x-user-id **ni inicializada** (probes con sintético disabled → 0 contaminación) |

**Baseline de contadores post-deploy: ambos recreates resetean los contadores in-process → legacy api_1=0/api_2=0 (el histórico api_1=3 pre-recreate queda en Prometheus).**

## H. Seguridad

```text
does_header_only_write_to_events_db:      NO (202 antes del handler; conteos byte-idénticos)
does_header_only_get_202_only_for_analytics: SÍ (estructural: v1/alias/playback sin mitigación, 401 verificado en vivo)
does_cookie_only_still_write:             SÍ (auth pasa; 400 solo por body inválido del probe)
does_mismatch_fail:                       SÍ (401, contador subject_mismatch)
does_v1_events_remain_strict:             SÍ
does_alias_events_remain_strict:          SÍ
does_playback_remain_strict:              SÍ
does_future_enforce_bypass_reopen:        NO (mode!=='compat' ⇒ next() ⇒ 401 estricto; test dedicado)
```

Bypass NO reabierto: la mitigación jamás produce identidad ni escritura; STATS no recibe eventos no atribuibles (se dropean antes de cualquier persistencia). El futuro ENFORCE sigue bloqueado por la app Android exactamente igual que antes.

## I. Riesgos residuales

- LU sigue sin CookieJar: assignment y progress sync siguen dependiendo de compat; ENFORCE sigue bloqueado.
- El manejo destructivo de 401 en el cliente LU sigue existiendo para otras rutas (p.ej. un 401 real de assignment seguirá purgando datos locales — correcto para revocación, brutal para fallos transitorios).
- Los eventos analytics de LU header-only se **pierden** (drop consciente; ya se perdían con 401, ahora sin daño colateral).
- La app instalada no tiene update-check efectivo (no consulta `/api/lu/version`).
- La migración Android sigue siendo obligatoria; esta mitigación es temporal y debe retirarse en esa fase.
- CI identity-preflight del commit desplegado estaba in_progress al cierre de este doc (canary in-image 99/99 GREEN cubre las mismas suites); verificar su cierre.

## J. Siguiente fase

**CHP-IDDB-M1-A-ANDROID-SESSION-MIGRATION-01** (CookieJar persistente cifrado, retiro de x-user-id, 401 de telemetría no destructivo, cliente de `/api/lu/version`, UA versionado, proyecto LU bajo git primero). Al desplegarla y confirmar adopción, retirar `createLegacyAnalyticsDropGuard`.

## K. Confirmación final

“Mitigación LU analytics 401 desplegada. Producción permanece COMPAT/COMPAT. No se activó ENFORCE, no se tocaron frontend, edge/nginx, datos, uploads ni migraciones.”
