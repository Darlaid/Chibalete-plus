# M1_A_SESSION_IDENTITY_DEPLOY_REHEARSAL_01 — ensayo de release + runbook congelado

Unidad: **CHP-IDDB-M1-A-SESSION-IDENTITY-DEPLOY-REHEARSAL-01** (2026-08-15, offline).
Ensaya el despliegue productivo de **CHP-IDDB-M1-A-SESSION-IDENTITY-01** y congela
el runbook para ejecutar **después de cerrar el canary GROUPS**. Nada desplegado;
canary GROUPS intacto.

## Veredicto

**GREEN — M1-A PRODUCTION RELEASE REHEARSED AND STAGED DEPLOY RUNBOOK FROZEN.**
`M1_A_PRODUCTION_DEPLOY_READY=true` (condicionado a GROUPS-canary-close primero).

## Fuentes e integración

- Baseline productivo: `cf36852` (runtime actual, ambas API).
- **`M1_A_SOURCE_SHA=f1c002b`** (tip de `chp/m1-a-session-identity-01`, contiene `0c84ecd`).
- Parentage: **cf36852 es ancestro de f1c002b** (2 commits lineales: `0c84ecd` feat + `f1c002b` docs). → **integración = FAST-FORWARD puro** (misma política que BACKUP-01B/GAP1: descendiente directo, provenance lineal, sin merge-commit, sin force-push). Rama de ensayo `chp/m1-a-deploy-rehearsal` (ff desde cf36852): **`M1_A_REHEARSAL_TREE_SHA=f1c002b`, tree == f1c002b tree** (`M1_A_RUNTIME_DELTA_PRESERVED=true`).
- **Nota de baseline real**: el deploy futuro parte del resultado del **close de GROUPS**, no de cf36852 tal cual. Si el close deja groups en SQLite oficial o revierte a json, el ff de M1-A se aplica sobre ESE tip; M1-A no toca `IDENTITY_READ`/`DOMAINS` (ortogonal). Re-verificar el ancestro antes del ff.

## Delta audit (`cf36852..f1c002b`, 13 archivos, sin accidentales/untracked)

- **BACKEND_RUNTIME (7)**: `server/server.js`, `server/observability/metrics.js`, `server/db/sessionStore.js`, `server/db/sessionsDb.js`, `server/lib/sessionAuth.js`, `server/lib/sessionSigningKey.js`, `server/lib/sessionToken.js`.
- **FRONTEND_RUNTIME (3)**: `context/AuthContext.tsx`, `services/dataService.ts`, `package.json`.
- **TESTS (2)**: `sessionIdentity.test.mjs`, `sessionIdentityIntegration.test.mjs`.
- **DOCS (1)**: `M1_A_SESSION_IDENTITY_01_PREP.md`.
- DEPLOY_INFRA: ninguno (la clave/sessions.db/compose se aplican por runbook, no viajan en el tree).

## VPS architecture (read-only)

- Mounts actuales: `/var/www/chibalete/secrets → /app/secrets` (host `dr-x------ root`, `admin_secret` `-r-------- root:root 0400`) y `/var/www/chibalete/identity → /app/identity` (host `drwx------ root`, `identity.db`+wal+shm).
- Override: `docker-compose.override.yml` fija `image:`, `IDENTITY_DB`, y monta identity + `.deploy-info`. Contenedor corre **como root** (contrato uid de `secretFile.js`; por eso `admin_secret` 0400 root valida).

## sessions.db — ruta productiva

**Mount dedicado** (separación de radio con identity.db, intención del diseño R1):
- `HOST_PATH = /var/www/chibalete/sessions/sessions.db`
- `CONTAINER_PATH = /app/sessions/sessions.db` (env `SESSIONS_DB=/app/sessions/sessions.db`)
- owner `root:root`, dir `0700`, host-persistente, compartido por api_1/api_2, writable por runtime (root).
- **Excluido del structured backup**: `stores.py` enumera stores por **ruta explícita** (`SqliteStore("identity/identity.db", …)`), no por glob de dir → un archivo en `sessions/` **nunca** entra a los 25 stores. NO añadirlo. (Alternativa válida: `identity/sessions.db`, también excluido por enumeración explícita, y `sessionsDb.js` lo resolvería solo junto a `IDENTITY_DB`; se prefiere el dir dedicado por claridad de radio.)
- No container-local; no bajo `data-critical/`.

## Semántica de pérdida/reinicio (probado)

`sessions.db` ausente al boot → se crea lazy solo si el modo lo abre (off no la toca). Corrupta/no-writable/perdida → `getSessionsDb()` lanza → `verifyRequestSession` traduce a **503** (fail-closed) para requests con cookie; **nunca** cae a x-user-id. Ningún caso impide el boot (apertura es lazy per-request). Re-login seguro tras pérdida (sesiones reconstruibles). **BACKUP_REQUIRED=false**.

## Claves de firma — rutas productivas

- `CURRENT = /var/www/chibalete/secrets/session_signing_key → /app/secrets/session_signing_key`
- `PREVIOUS = /var/www/chibalete/secrets/session_signing_key.previous → /app/secrets/session_signing_key.previous` (opcional, solo verificación en gracia de rotación)
- owner `root:root`, mode **0400** (idéntico a admin_secret; `sessionSigningKey.js` usa esas rutas por defecto). Nunca en Git/.env/imagen (verificado: 0 material en el tree; Dockerfile.api crea `/app/secrets` vacío 0500).

## Runbook de generación/rotación de clave (no ejecutar)

Generación (root, en host): `umask 077; head -c 48 /dev/urandom | xxd -p -c 999 > /var/www/chibalete/secrets/session_signing_key; chmod 0400 …; chown root:root …`. Nunca imprimir la clave; registrar solo `sha256sum` (fingerprint no reversible) en la evidencia. Rotación: escribir la actual en `.previous`, generar nueva `current` por `rename(2)` atómico; retirar `.previous` tras 12 h (vida máxima de sesión). Rollback de clave = restaurar `.previous` como `current`.

## Compose delta (offline, para DEPLOY A dormant)

En `docker-compose.override.yml`, por servicio (api_1 y api_2), **añadir**: mount `source: /var/www/chibalete/sessions target: /app/sessions` y `environment: SESSION_AUTH_MODE: "off"`, `SESSIONS_DB: /app/sessions/sessions.db`. La clave se monta vía el mount de secrets ya existente (crear el archivo en host). **NO** tocar `IDENTITY_READ`/`IDENTITY_READ_DOMAINS`/groups. En off, **la clave y sessions.db no son necesarias** (probado) — pueden instalarse en DEPLOY B.

## Pruebas (imagen `cf36852` aislada, `--network none`, /tmp; tree de ensayo)

- **OFF neutral (5/5)**: login legacy 200, **sin Set-Cookie**, x-user-id autentica `/api/users` y `/auth/me`, **sessions.db NO creada** (lazy). DEPLOY A neutral, sin key/DB.
- **COMPAT+ENFORCE (34/34)** (`sessionIdentityIntegration`): login emite cookie HttpOnly/SameSite; `/auth/me` 200; legacy x-user-id temporal; `sub A + x-user-id B` → 401; disabled → 401; **two-instance** (cookie de api_1 vale en api_2; logout revoca cross-instance); logout-all/disable/reset invalidan (cv); **enforce** rechaza x-user-id externo, cookie válida 200, allowlist interna explícita; **fail-closed** sessions.db caída. admin-secret sin cambio.
- **Session unit 42/42**; typecheck sin regresiones; frontend build OK; cookie flow presente (`fetchSessionMe`/`serverLogout`/`credentials`).

## credentialVersion — superficies de escritura (auditadas)

Bump SOLO en: **password reset** (server.js:3426), **PUT /api/users disable-o-password** (3639), **logout-all** (8727). **Login = 0 bumps** (verificado). Normal logout = revoca sid, sin bump. GET/perfil/grupo/membership NO bumpean (no llaman bump). Es dato canónico del padrón JSON → **cubierto por structured backup** (recovery point fresco requerido tras eventos de credencial masivos, no por login normal).

## Runbooks de despliegue (congelados, NO ejecutar)

**DEPLOY A (dormant, off)** — A0 preflight (CI green sobre el tree exacto post-ff; backup/cache health) · A1 congelar rollback (imagen `cf36852` = rollback-current; override pre en snapshot) · A2 crear dir `sessions/` (root 0700) · A3 **no requiere clave** en off (instalar en B) · A4 **ff del ref productivo → f1c002b** (o sobre el tip post-GROUPS-close) · A5 **CI exact-tree GREEN** · A6 build imagen `chibalete/api:f1c002b` (OCI revision f1c002b; sin key/sessions.db/secret baked — verificado) · A7 frontend build **diferido a fase C** · A8 deploy neutral api_2→api_1 con `SESSION_AUTH_MODE=off` (flags identity intactos) · A9 smoke neutral (login real 200, sintético 401, sin cookie, backend json, groups sin cambio) · A10 verificar cero cambio funcional/auth.

**DEPLOY B (compat)** — capacity/backup decision (recovery point fresco) · instalar `session_signing_key` 0400 root · dir `sessions/` listo · `SESSION_AUTH_MODE=compat` en **api_2 primero** (api_1 off control) · verificar emisión de cookie, `/auth/me`, logout, revocación cross-instance, telemetría `legacy_x_user_id`, sin regresión de auth · luego api_1 compat.

**FRONTEND (fase C)** — tras backend compat en ambas: build+deploy imagen frontend (recreate único de `chibalete_front` + reload edge, runbook sprint022-frontend). Validar login/refresh-bootstrap(`/auth/me`)/multi-tab/logout/admin/reader/mediador/Aula Viva. Monitor `auth_session_legacy_x_user_id_total{browser}` → objetivo **0** sostenido (ventana ≥ un ciclo de sesión activo, ~24-48 h de tráfico real).

**ENFORCE canary (D)** — api_2 `SESSION_AUTH_MODE=enforce`, api_1 compat control. **No combinar con ningún canary de lectura de identidad** (no con GROUPS). Corpus determinístico: reader/mediador/admin-humano/machine-admin-secret/logout-revoke/disabled/progress/Aula Viva/Leo. Exigir: x-user-id-only externo → 401; cookie válida → 200; sin heurística IP.

**ENFORCE both (E)** — tras canary GREEN, api_1 enforce. **M1-A NO cierra** hasta que x-user-id externo ya no establezca identidad y los flujos normales usen sesión.

## Rollback matrix

| Fase | Fallo | Rollback |
|---|---|---|
| A | deploy/boot | imagen `cf36852` + override pre (config), sin data mutation |
| B compat | regresión de auth | `SESSION_AUTH_MODE=off` (config) |
| Frontend | fallo UI | imagen frontend anterior; backend sigue compat |
| D enforce api_2 | fallo | `enforce→compat` api_2 (config) |
| E enforce both | fallo | `enforce→compat` con **evento de seguridad registrado** |
Tras el close de M1-A, reabrir x-user-id autoafirmado externo exige **`--acknowledge-security-risk`**. Ningún rollback toca `IDENTITY_READ_DOMAINS` innecesariamente. El enforcement de sesión no se revierte por rollback ajeno.

## Backup/data gates

DEPLOY A/B/frontend/enforce: **no mutan padrón** (login solo crea filas en sessions.db, NO en 25 stores). `credentialVersion` empieza a escribirse orgánicamente tras eventos soportados (reset/disable/logout-all) → dato crítico cubierto por structured backup; recovery point fresco requerido si se ejecuta una operación masiva de credenciales, no por login. Pruebas de logout-all/disable/reset en producción: usar fixture dedicada, nunca mutar usuarios reales/sintéticos.

## CI gates (tree exacto de deploy)

Tree `f1c002b`: **identity-preflight GREEN** (run 31894215563), **security**: evidence-hardening/gitleaks-head/trivy-fs/osv/image-integrity GREEN (run 31894215605); heredados `gitleaks-history`/`trivy-image` RED **baseline-idénticos** (`NEW_FINDINGS=0`). Sin nueva excepción de baseline. Frontend build GREEN. El ff sobre el tip post-GROUPS-close exige **re-correr CI exact-tree** antes del build.

## M1-B handoff

Tras el close productivo de M1-A, la fuente de M1-B (`chp/m1-b-tenant-authz-01`, `7f05ed7`, basada en `f1c002b`) se integra sobre el **tip productivo de M1-A**. Conflictos esperados: mínimos/ninguno si M1-A entra por ff limpio (M1-B se creó desde el tip de M1-A). M1-B consume `req.auth` de M1-A → **requiere M1-A en enforce** antes de su propio enforce. No integrar ahora.

## Groups-canary non-interference

Verificado por `docker inspect --format` (sin probes): api_1 `cf36852` json, api_2 `cf36852` sqlite/groups, ambos healthy, restarts=0 → RUNNING.

## Exact next step

**CHP-IDDB-M1-C1-GROUPS-CANARY-CLOSE-01** (tras resume 2026-08-16T14:25Z) → **M1-A-DEPLOY** (este runbook, sobre el tip post-close) → M1-B-DEPLOY (requiere M1-A enforce) → M1-C → M1-D.

---

# R1 — retiro de x-user-id del navegador + semántica off + secuenciación compat

Corrige tres inconsistencias del ensayo antes de autorizar el deploy. **`M1_A_FINAL_SOURCE_SHA=0ff76b6`** (commit lineal sobre `f1c002b` en `chp/m1-a-session-identity-01`, sin force-push; f1c002b intacto).

## R1-D/E. Contradicción del header (reproducida)

Inventario real en `f1c002b`: **46 emisores de x-user-id en 22 archivos de producto** (services/pages/components/hooks), NO cubiertos por el M1-A PREP (que solo tocó AuthContext + dataService parcial). Con el frontend previo, una request con cookie de sesión válida **seguía enviando x-user-id** → `legacy_x_user_id{browser}` no podía drenar. `CURRENT_BROWSER_LEGACY_HEADER_DRAIN_POSSIBLE=false` sin cambio de frontend.

## R1-F/G. Contrato final y retiro

Contrato: tras la migración de frontend, el navegador autentica **solo por cookie HttpOnly**; nunca construye x-user-id como header. `user.id` puede vivir en estado UI para render, pero `USER_ID_IN_UI != AUTHORITY`. Retirados los **46 emisores → 0** (`PRODUCT_BROWSER_X_USER_ID_EMITTERS=0`, guard estático `browserNoXUserIdGuard.test.mjs`, 127 archivos escaneados). XHR de upload usa `withCredentials=true` (cookie same-origin). Sin header de reemplazo.

## R1-backend. Lectores inline session-aware (completa el retiro)

El retiro del header rompía backend que leía identidad del header inline. Corregido sin redesign: helper **`reqUserId(req) = req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id']`** (sesión primero; header solo fallback off), aplicado a ~14 lectores de handler + args de Leo; **`/api/content/:id/access`** (preflight de todo visor) y **`requireAdminRole`** (upload/content admin) resuelven identidad por sesión en compat/enforce, header en off. Los middlewares de auth (requireUserAuth/requireProgressOwner/requireAdminAccess) ya eran session-aware.

## R1-H/I/J. Bootstrap, logout, guard

Bootstrap por `GET /api/auth/me` (cookie) sin depender de `localStorage`; logout por `POST /api/auth/logout` (revoca sid + borra cookie) → `/auth/me` 401. Guard estático falla si vuelve un emisor de producto (distingue producto de tests/tooling).

## R1-K/L/M. Pruebas cookie-only (13/13, imagen aislada)

`sessionBrowserCookieOnly.test.mjs` (server real, POSIX): **COMPAT** cookie-only sin x-user-id → `/auth/me`, `/api/users`, `/api/groups`, **`/api/content/:id/access` (preflight)**, `/api/content/my-catalog` todos 200; preflight sin identidad → 401; query userId≠sesión → 401. **ENFORCE**: cookie-only 200; solo x-user-id externo → 401 (incl. preflight); cookie + x-user-id mismatch → 401. Compat sigue aceptando cliente viejo con x-user-id (rolling), marcado `source_class=browser`, no estado final.

## R1-N. Métrica de drenaje (contador monotónico)

Un counter monotónico NUNCA "vuelve a 0". `BROWSER_LEGACY_DRAIN_METRIC = rate(auth_session_legacy_x_user_id_total{source_class="browser"}[15m]) == 0` sostenido durante la ventana. Criterio de cierre: `NEW_BROWSER_LEGACY_REQUESTS=0` durante una ventana ≥ propagación de caché de frontend + un ciclo de sesión activo (evidencia: caché edge/navegador ~horas + sesión 12 h → **ventana ≥ 24 h**). No usar `total==0`.

## R1-O. Allowlist interno/test

Clientes legítimos que sigan usando x-user-id (tests/smokes/scripts internos) entran en ENFORCE solo por `SESSION_LEGACY_ALLOW` (mecanismo ya implementado). No allowlist por IP; ningún navegador externo permitido.

## R1-P/Q/R/S. Semántica OFF (auditada)

**`OFF_MODE_BYTE_IDENTICAL=false`**: `requireProgressOwner` en M1-A añade un active-check **incondicional** — un usuario deshabilitado con x-user-id legacy que en `cf36852` podía escribir progreso, en M1-A OFF → **401**. Clasificado **INTENTIONAL_SECURITY_TIGHTENING**. Impacto: `ACTIVE_REAL_USER_REGRESSION=0` (247 activos intactos; 400 sintéticos disabled ya no pueden escribir progreso — deseado). **DEPLOY A ≠ "zero auth change"**; su contrato real = **DORMANT SESSION INFRASTRUCTURE + DISABLED_USER_PROGRESS_DENIAL** (`DEPLOY_A_EXPECTED_BEHAVIOR_CHANGE=DISABLED_USER_PROGRESS_DENIAL_ONLY`). El smoke de A debe verificar explícitamente que un usuario deshabilitado NO escribe progreso, y que reader/mediador/admin-secret/login legacy activos quedan intactos.

## R1-T/U/V. Secuenciación compat corregida

**B1**: api_2→COMPAT, api_1→OFF control. Probar SOLO api_2 (emisión, `/auth/me`, logout/revoke local, compat legacy, health). **NO** afirmar aún `CROSS_INSTANCE_SESSION_GREEN`. **B2**: tras B1 GREEN, api_1→COMPAT (ambas compat, key + sessions.db compartidas). **Solo AHORA** probar cross-instance: login api_1→cookie vale api_2, logout api_2→rechazado api_1, logout-all api_1→rechazado api_2. `CROSS_INSTANCE_SESSION_GREEN=true` **solo en esta fase**. Orden definitivo: A(off ambas) → B1(api_2 compat) → **B2(api_1 compat + verificación cross-instance)** → C(frontend cookie-only) → observación drenaje → D(api_2 enforce) → E(api_1 enforce) → CLOSE. **No adelantar frontend antes de B2.**

## R1-W. Contrato de cierre de M1-A

M1-A cierra solo con: ambas API ENFORCE; frontend cookie-only; `PRODUCT_BROWSER_X_USER_ID_EMITTERS=0`; x-user-id-only externo→401; subject mismatch→401; drenaje de navegador legacy según la métrica de tasa; cross-instance GREEN; logout/revocación GREEN; disabled→401; admin-secret machine authority intacta.

## R1-X/Y. Source final e impacto M1-B

`M1_A_FINAL_SOURCE_SHA=0ff76b6`. M1-B PREP (`7f05ed7` + doc `102643a`) se construyó sobre M1-A pre-R1; el delta R1 es frontend + backend inline-readers. Conflictos potenciales con el frontend de M1-B (si lo hubiera) y con `server.js` (M1-B añadió tenant guards; R1 tocó lectores de identidad — regiones distintas, conflicto improbable). **Antes del deploy de M1-B**: rehearsal de integración contra el tip productivo FINAL de M1-A + CI exact-tree. M1-B NO queda invalidada.

## R1-CI

Tree `0ff76b6`: guard estático + cookie-only en CI (paso propio `test:session-browser`, store-hermético); store-isolation `test:identity` sigue presente. Delta gate esperado GREEN; heredados baseline. Ver run del push.

## R1 disposición

**GREEN — M1-A BROWSER AUTHORITY RETIREMENT AND DEPLOY SEQUENCING ARE PRODUCTION-READY.**
`M1_A_PRODUCTION_DEPLOY_READY=true` (tras GROUPS-canary-close). Canary GROUPS intacto.
