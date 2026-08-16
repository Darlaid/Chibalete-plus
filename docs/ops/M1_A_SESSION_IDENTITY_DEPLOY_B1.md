# CHP-IDDB-M1-A-SESSION-IDENTITY-DEPLOY-B1 — Canary de sesión COMPAT en api_2

**Veredicto:** `GREEN WITH EXPLICIT LOGIN-SMOKE DEBT — M1-A B1 API_2 COMPAT SESSION AUTHORITY VERIFIED`

- `M1_A_DEPLOY_B1_GREEN=true`
- `LOGIN_PRODUCTION_SMOKE_PENDING=true`
- `CROSS_INSTANCE_SESSION_TESTED=false` · `CROSS_INSTANCE_SESSION_GREEN=NOT_YET_ELIGIBLE`
- Fecha: 2026-08-16 (~15:55–16:05Z)

## Estado final

| Instancia | Imagen | SESSION_AUTH_MODE | IDENTITY_READ |
|---|---|---|---|
| api_1 (control) | `0ff76b6` (`f2935d0f`) | **off** | json |
| api_2 (canary) | `0ff76b6` (`f2935d0f`) | **compat** | json |

Clave de firma `current` instalada; `sessions.db` creada, healthy, 1 fila (revocada). Frontend sin cambio. Sin M1-B/M2/canary de identidad.

## Gates previos

- **G1:** Deploy A remoto (`chp/m1-a-deploy-a-01` `e98578d`), `M1_A_DEPLOY_A_GREEN=true`; ref productiva `chp/backup-capacity-01b=0ff76b6` sin avanzar en B1.
- **G2:** baseline `0ff76b6` off/off, json, sin DOMAINS, healthy, restarts=0, sessions.db y key ausentes.
- **G3 (alcance):** `B1_RUNTIME_CODE_DELTA=0` — el código ya está vivo desde Deploy A. B1 solo: clave inicial + api_2 off→compat + creación de sessions.db por uso.

## Clave de firma (FASES 2–4)

- `/app/secrets/session_signing_key`, root:root **0400**, fingerprint SHA-256 `81a0361027ec…` (nunca se imprime el material). Sin `.previous` (no se fabricó una clave anterior falsa).
- Jamás en `.env`, compose, imagen, repo ni logs.
- Ambos contenedores ven la clave (`-r--------`); api_1 OFF no la requiere ni la usa; api_1 **no** se recreó para probar visibilidad.
- `/var/www/chibalete/sessions` root:root 0700; `sessions.db` ausente pre-compat; excluida del structured backup (no crítica, reconstruible por re-login).

## Activación (FASES 5–6)

`B1_CONFIG_DELTA=API_2_SESSION_AUTH_MODE_ONLY` (off→compat) en el override, más la clave recién instalada. Preservado: `IDENTITY_READ=json`, DOMAINS vacío, imagen `0ff76b6`, sin flags M1-B/M2. Recreate acotado solo de api_2 (drain→up→rejoin), misma imagen, restarts=0; api_1 y frontend/edge sin restart.

## Desviación autorizada: emisión server-side (FASE 9 sustituida)

**Motivo:** no se dispuso de una credencial real funcional. Tres contraseñas provistas para `acceso001@chibalete.com` no coincidieron — verificado por bcrypt **offline fiel** (mismo store `USERS_DB=/app/data-critical/usuarios_colegios_oro.json`, mismo `bcrypt.compare`, contraseña sin `.trim` en `loginSchema`) contra las 647 cuentas del padrón (0 coincidencias), y por login directo a api_2 → `401 "Credenciales inválidas"` (con `RateLimit-Remaining: 6`, no rate-limit).

**Método (autorizado por el operador):** minteo de una sesión real de acceso001 con los **helpers ya implementados** de M1-A (`createSessionAuth().issueSession`) ejecutados **dentro de api_2**, usando la misma clave file-only, la misma `sessions.db`, el mismo contrato de token/cookie/revocación. Las validaciones HTTP se hicieron contra `http://127.0.0.1:3000` (= api_2). El token **nunca** se imprimió ni se escribió a disco; solo se leyó el padrón. **Sin cambio de código, sin endpoint temporal, sin bypass persistente.** Intentos de login en esta fase: **0** (presupuesto del limiter conservado).

Limitación conservada explícitamente:
```
PRODUCTION_LOGIN_ENDPOINT_WITH_REAL_CREDENTIAL_TESTED=false
PRODUCTION_LOGIN_COOKIE_ISSUANCE_EVIDENCE=image-canary 13/13 (sessionBrowserCookieOnly)
SERVER_SIDE_SESSION_PRODUCTION_PATH_TESTED=true
LOGIN_PRODUCTION_SMOKE_PENDING=true
```
El endpoint de login productivo **no** queda validado; esta desviación **no** es una excepción permanente.

## sessions.db (FASES 7 / 19)

- `SESSIONS_DB_CREATED=true`, `/app/sessions/sessions.db`, no existía antes del issue; `journal_mode=wal`, `integrity_check=ok`.
- Esquema: `sid_hash` (PK), `user_id`, `issued_at`, `expires_at`, `revoked_at`, `credential_version`. **El sid se almacena hasheado** (`sid_hash`) — nunca en claro; el token tampoco toca el store.
- Permisos endurecidos a **0600 root:root** (db + wal + shm). El dir padre 0700 root ya gateaba el acceso; deuda menor `CHP-SEC-SESSIONS-DB-UMASK-01` porque un checkpoint futuro podría recrear WAL/SHM en 0644 por umask (fix durable = umask/mode a nivel app). Sin token/sid en logs.

## Validación de sesión (FASES 10–15), dirigida a api_2 COMPAT

| Prueba | Resultado |
|---|---|
| issueSession (fila en sessions.db, cv=0) | ✓, ttl 12h |
| `GET /api/auth/me` cookie-only | **200**, id == acceso001 |
| ruta normal cookie-only (`GET /api/groups`) | **200** |
| cookie A + `x-user-id` B (mismatch) | **401** (`subject_mismatch`) |
| `POST /api/auth/logout` (CSRF same-origin) | **200**, cookie limpiada, sid revocado |
| misma cookie tras logout → `/api/auth/me` | **401** (`revoked`) |

El logout revocó **solo** ese sid (no logout-all, sin `credentialVersion++`).

## Compatibilidad legacy (FASE 12)

`x-user-id` sin cookie de un lector activo → **200** (groups y progress). Comportamiento **temporal** de COMPAT, no autoridad final; api_1 OFF mantiene el camino legacy de forma independiente. Telemetría `legacy_x_user_id{browser}=7`.

## Regresión disabled (FASE 14)

Sintético disabled → progress write **401**. Sin reactivación, sin cambio de `credentialVersion`.

## Telemetría (FASE 20)

`subject_mismatch_total=1`, `revoked_total{logout}=1`, `failure{revoked}=1`, `legacy_x_user_id{browser}=7`, `failure{disabled}=4`, `failure{no_identity}=12`. Sin etiquetas de alta cardinalidad (userId/sessionId). El contador de éxito por **login-path=0** es esperado y consistente con `LOGIN_PRODUCTION_SMOKE_PENDING` (la sesión se mintó server-side, no vía el endpoint de login).

## Invariantes de identidad (FASE 22)

`acceso001`: `credentialVersion` 0→0, hash bcrypt `1680aebeca6d…` **byte-idéntico** pre/post, status active. Padrón 647=247+400 (400 disabled). **`CANONICAL_IDENTITY_MUTATIONS=0`.** Única mutación productiva de B1: `sessions.db` (1 fila, revocada).

## api_1 control / frontend / salud (FASES 18, 21, 23)

- api_1: StartedAt `2026-08-16T15:36:21Z` **sin cambio**, restarts=0, imagen `0ff76b6`, `SESSION_AUTH_MODE=off`, `IDENTITY_READ=json`. No recreado.
- Frontend: `chibalete/front:hf4a-r2-coherence-82fba6e`, `FRONTEND_RUNTIME_DELTA=0` (sigue enviando x-user-id, esperado; el drenaje se mide tras Deploy C).
- Salud: ambas healthy; `unexpected_5xx=0` (APIs y edge), errores de firma/sessions-db/SQLite=0, sin restart loops.

## Rollback (FASE 25)

api_2 compat→off restaurando `override.pre-b1.yml` (misma imagen `0ff76b6`) + drain/recreate/rejoin de api_2. `sessions.db` y la clave pueden permanecer inertes en OFF. No revierte identidad. Copia en `/root/chp-m1-a-deploy-b1-01/override.pre-b1.yml`.

## Limpieza

`/root/b1-smoke.env` eliminado (`shred`+`rm`) → **ausente**.

## Deuda y siguiente paso

- **Deuda de login (bloqueante del cierre final de M1-A, no de B1):** resolver `LOGIN_PRODUCTION_SMOKE_PENDING` con **una** credencial real conocida antes del cierre de M1-A. No debe provocar más intentos de contraseña ahora.
- **Siguiente unidad (NO ejecutar automáticamente):** `CHP-IDDB-M1-A-SESSION-IDENTITY-DEPLOY-B2` — api_1 off→compat; solo entonces cross-instance (cookie api_1↔api_2, revocación cruzada).
