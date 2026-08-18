# CHP-M1A-EVENTS-COOKIE-AUTH-GAP-01

Fix local del gap de autenticación en las rutas de escritura de eventos: el navegador
cookie-only recibía 401 (pérdida de todos los eventos de lectura desde DEPLOY-C) y el
header `x-user-id` crudo era autoridad de atribución suficiente incluso bajo un futuro
ENFORCE. Implementación + tests sobre base `0ff76b6` (ref productiva). **SIN deploy.**

- Rama: `chp/m1a-events-cookie-auth-gap-01` (desde `0ff76b6`)
- Origen del hallazgo: `CHP_IDDB_M1_A_API2_ENFORCE_ROLLBACK_ANALYSIS_01.md` (`5e627eb`)

---

## A. Veredicto

**GREEN-LOCAL.** Confianza: **alta**. **Deploy ejecutado: NO.**

Las CUATRO rutas de escritura de eventos (se descubrió una cuarta durante la auditoría:
el alias legacy `/api/events`, que también escribe a events.db) quedan detrás de un guard
de sesión dedicado. Cookie-only escribe; header-only no escribe en compat/enforce; el
modo `off` queda byte-idéntico. Demostración red→green con test estructural; 42/42 de
sesión sin regresión.

## B. Causa raíz

- `reqUserId(req) = req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id']`
  (server.js:2469 en la base): correcto DENTRO de rutas con middleware de sesión
  (`req.auth`/`req.user` poblados), pero las rutas de eventos no corrían NINGÚN
  middleware → `req.auth` siempre undefined → cae al header crudo.
- Efecto 1: frontend cookie-only (DEPLOY-C) no envía header → 401 `x-user-id required`
  → **cero eventos de navegador en events.db desde DEPLOY-C**.
- Efecto 2: cualquier cliente con un header inventado escribía eventos atribuidos a otro
  usuario — sin pasar por el modo de sesión, es decir **también bajo enforce** (bypass).

## C. Rutas auditadas

| Ruta | Antes | Después | Middleware | Riesgo previo |
|---|---|---|---|---|
| `POST /api/v1/events` (backbone canónico, :9199→) | header crudo, sin middleware | sesión firmada en compat/enforce; off intacto | `requireEventsWriteAuth` | atribución falsificable en events.db |
| `POST /api/playback-events` (:9116→) | ídem | ídem | ídem | ídem + log playback |
| `POST /api/analytics/events` (:7500→) | ídem (con filtro userId==header) | ídem; el filtro compara ahora contra identidad canónica | ídem | ídem |
| `POST /api/events` (alias legacy, :9176→) — **descubierta en la auditoría** | ídem (dual-write a events.db) | ídem | ídem | ídem |
| Resto de call-sites de `reqUserId` (tts, album/tts, leo/ask, leo/chat, leo/recap) | — | sin cambio | ya corren `requireUserAuth` (session-aware) | ninguno nuevo |

```text
routes_using_raw_reqUserId (antes): 4 (las de la tabla)
routes_without_session_middleware (antes): 4 → 0
routes_accepting_x_user_id_raw (después, con sesión habilitada): 0
routes_rejecting_cookie_only (después): 0
session_helpers_available: sessionAuth.authenticate / sessionIssuanceEnabled / authSessionFailure
canonical_ingest_available: sí (chp/stats-ingest-01b, dormido) — NO se activa en esta fase
recommended_hook_point (elegido): guard de factoría reutilizando sessionAuth.authenticate
```

## D. Fix implementado

**Archivos:** `server/lib/eventsWriteAuth.js` (nuevo, factoría ~20 líneas),
`server/server.js` (+18/−5: 1 import, 1 instanciación, 4 registros de ruta),
`package.json` (1 línea: cableado de tests en `test:identity`), 2 tests nuevos.

**Estrategia:** `createEventsWriteAuth({sessionEnabled, authenticate, onFailure})` →
middleware que:
- con sesión deshabilitada (`off`): `next()` puro — los handlers conservan su contrato
  legacy byte-idéntico (mundo pre-M1-A; también preserva dev local);
- con sesión habilitada (compat/enforce): delega en `sessionAuth.authenticate` (toda la
  validación existente: firma, revocación, cv, active, y mismatch cookie↔header) y
  **rechaza `authMethod !== 'session'`** con razón dedicada
  `session_required_event_write` — el header validado que compat acepta en otras rutas
  NO es autoridad de atribución para escrituras de eventos, y una futura allowlist
  `SESSION_LEGACY_ALLOW` tampoco las reabre;
- fail-closed (excepción interna ⇒ 503); `req.auth` canónico poblado para que
  `reqUserId` en los handlers resuelva la identidad de sesión (handlers sin cambios).

**Por qué es la opción más segura:** reutiliza la única superficie de autenticación
existente (cero lógica de verificación nueva), es más estricta que `requireUserAuth`
exactamente donde hace falta (atribución de datos), no toca `sessionAuth` ni el contrato
de las demás rutas, y deja el modo off intacto. `canonicalIngest` (stats-ingest-01b)
sigue siendo el destino estructural; este guard no compite con él — cuando se active,
recibirá `req.auth` ya canónico.

**Qué NO se cambió:** handlers de las 4 rutas (líneas internas intactas), frontend,
`sessionAuth`, compose/env, ninguna otra ruta.

## E. Pruebas (todas locales, Windows; integración POSIX hace SKIP limpio)

| Test | Objetivo | Resultado |
|---|---|---|
| `eventsRoutesSessionGuard.test.mjs` (nuevo, estructural) | las 4 rutas registran el guard; instanciado desde el lib | **RED pre-fix** (demostración del bug) → **GREEN post-fix** |
| `eventsWriteAuth.test.mjs` (nuevo, unit, 9 escenarios) | matriz A–D + off byte-neutro + enforce+allowlist rechaza + fail-closed 503 + onFailure resiliente + validación de factoría | GREEN 9/9 |
| `node --check server/server.js` | sintaxis | OK |
| `sessionIdentity.test.mjs` | no-regresión sesión | 42 ✓ / 0 ✗ |
| `browserNoXUserIdGuard.test.mjs` | frontend sigue 0 emisores | 2 ✓ (127 archivos) |
| `realStoreGuard.test.js` (store isolation) | tests no tocan stores reales | 16 ✓ |
| `sessionIdentityIntegration.test.mjs` | integración | SKIP limpio (POSIX-only, corre en CI Linux) |

Cableado CI: ambos tests nuevos añadidos a `test:identity` (que ya ejecuta el workflow
identity-preflight) — trampa conocida de tests-no-cableados evitada.

**CI remoto del commit `77c0f3b`: identity-preflight SUCCESS con verificación a nivel de
step** (el log del job muestra `eventsWriteAuth.test.mjs OK — 9 escenarios`,
`eventsRoutesSessionGuard.test.mjs OK — 4 rutas` y sesión 42/42, con la suite de
integración POSIX corriendo en Linux). trivy/osv/gitleaks-head/evidence/image-integrity
SUCCESS. Los 2 rojos (`gitleaks-history`, `trivy-image`) son los heredados
baseline-equivalentes documentados del gate M1 — idénticos en el commit docs-only
`0a25407` sobre la misma base (verificado en la misma corrida).

Matriz de casos del encargo: A (cookie válida sin header → acepta) ✓, B (header sin
cookie → rechaza) ✓, C (cookie A + header B → 401 subject_mismatch, resuelto por
authenticate) ✓, D (sin auth → 401) ✓, E (escritura usa userId canónico: `req.auth`
poblado y `reqUserId` lo prioriza; los filtros de ownership de analytics/v1 comparan
contra él) ✓ por construcción + estructural, F (evento inválido no escribe: validaciones
de shape de los handlers intactas) ✓ sin cambio.

## F. Seguridad y compatibilidad

| Escenario | Resultado tras el fix | Cobertura | Riesgo |
|---|---|---|---|
| Navegador cookie-only logueado | escribe eventos; identidad = sesión | unit A + estructural | — |
| Header-only sin cookie (compat) | 401 `session_required_event_write` (con métrica) | unit B | telemetría legacy residual se pierde — deseado |
| Cookie usuario A + header usuario B | 401 `subject_mismatch` | unit C (vía authenticate) | — |
| Sin credencial alguna | 401 | unit D | — |
| Android legacy sin cookie | sus eventos (si algún día los emite) 401 — esperado; sus rutas actuales (offline/progress) NO se tocan en esta fase | diseño | se trata en fase Android |
| Futuro ENFORCE (incl. `SESSION_LEGACY_ALLOW=1`) | eventos jamás por header → bypass cerrado | unit enforce+allowlist | — |
| COMPAT/COMPAT actual (si se despliega) | único delta observable: cookie-only 401→200 y header-only en eventos 401 con razón nueva; resto byte-idéntico | matriz completa | bajo |
| Modo `off` (dev / pre-M1-A) | byte-idéntico (guard = next() puro) | unit off | — |

¿Puede un cliente falsificar eventos de otro usuario? Con sesión habilitada, NO por
header; necesitaría una cookie firmada válida de la víctima. En `off` el mundo legacy
persiste (conocido, pre-existente, fuera del alcance: `off` ya no existe en producción).

## G. STATS

```text
stats_unblocked: SÍ tras deploy — el navegador cookie-only volverá a escribir en
  events.db por las 4 rutas (el bloqueo activo era este 401)
canonical_ingest_used: NO (sigue dormido en chp/stats-ingest-01b; este guard le es
  compatible: cuando se active recibirá req.auth canónico)
events_db_receives_browser_events: sí, post-deploy
lost_events_recoverable: NO — los eventos 401eados desde DEPLOY-C (2026-08-16T17:52Z)
  nunca se persistieron en ningún lado; la pérdida es irrecuperable y sigue creciendo
  hasta el deploy. progress_db/progress.db NO se vieron afectados (otro path, sí
  autenticaba), así que las métricas de progreso están íntegras — solo falta el grano
  de eventos.
additional_stats_phase_needed: la agenda existente (INGEST activación + MAT-01) sigue
  igual; este fix es prerequisito, no sustituto.
```

## H. Riesgos residuales

- **Android legacy sigue pendiente** (fases ANDROID-AUDIT/MIGRATION del rollback-analysis).
- **Eventos ya perdidos: irrecuperables**; la pérdida continúa hasta que esta unidad se
  despliegue → conviene priorizar el deploy.
- Suite completa `test:identity` tiene skips POSIX en Windows (conocido); el gate real es
  el CI remoto exact-tree.
- La razón nueva `session_required_event_write` añade un valor al label `reason` del
  contador de fallos (cardinalidad +1, enumerada — aceptable y diagnóstica).
- `off` conserva el contrato legacy de eventos por diseño (producción ya no usa off).

## I. Plan de deploy posterior (NO ejecutado)

1. Preflight: COMPAT/COMPAT verificado, CI exact-tree GREEN del SHA a desplegar,
   backup estructurado reciente.
2. El cambio es solo de código backend → **swap de bind mount `server/` + restart
   staggered api_1→validar→api_2** (flujo estándar de deployment_guide; sin rebuild de
   imagen: `package.json` cambia solo en scripts de test — verificar si el flujo exige
   rebuild por política; si sí, build imagen nueva del SHA).
3. Smoke productivo: (a) usuario cookie-only real o smoke-credencial → POST evento
   → 200 y fila en events.db con userId de sesión; (b) header-only sintético
   (lt-user-001) → 401 `session_required_event_write`; (c) progress sync sigue 200;
   (d) login/logout intactos.
4. Métricas: `failure{session_required_event_write}` aparece solo para legacy residual;
   tasa de 401 en `/api/v1/events` del edge cae a ~0 para clientes logueados.
5. Rollback: revertir el swap de `server/` al release anterior (mismo mecanismo
   estándar); sin cambios de datos ni de esquema.

Siguiente fase sugerida: **CHP-M1A-EVENTS-COOKIE-AUTH-GAP-DEPLOY-01**.

## J. Siguiente prompt sugerido

`CHP-M1A-EVENTS-COOKIE-AUTH-GAP-DEPLOY-01`

## K. Confirmación final

Esta fase fue local/read-only productivo. No se activó ENFORCE, no se modificaron flags, variables, contenedores, datos ni configuración productiva.
