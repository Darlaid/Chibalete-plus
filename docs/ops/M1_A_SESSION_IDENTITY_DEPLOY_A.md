# CHP-IDDB-M1-A-SESSION-IDENTITY-DEPLOY-A — Infraestructura de sesión DORMIDA en producción

**Veredicto:** `GREEN — M1-A DEPLOY A LIVE WITH SESSION INFRASTRUCTURE DORMANT AND OFF-MODE SECURITY TIGHTENING VERIFIED` · `M1_A_DEPLOY_A_GREEN=true`

- Fecha: 2026-08-16 (~15:31–15:45Z)
- Runtime desplegado: `M1_A_DEPLOY_A_RUNTIME_SHA=0ff76b6` en ambas APIs, `SESSION_AUTH_MODE=off`, `IDENTITY_READ=json`.
- La sesión cookie NO es autoridad productiva: OFF = infraestructura sola, sin clave, sin `sessions.db`, sin cookie emitida.

## 1. Gates previos

| Gate | Resultado |
|---|---|
| G1 evidencia GROUPS-close | remoto `chp/m1-c1-groups-canary-close-01` = `d33fdd0`, ancestría `97cdcab→d33fdd0` OK, 4 claves congeladas presentes |
| G2 baseline producción | `cf36852` JSON/JSON ambas, sin DOMAINS, healthy, restarts=0, sin canary activo |
| G3 fuente exacta | `BUILD_SOURCE_SHA=0ff76b694defc3a9949a54901031af526db15b04`, tree `c48f7acd…`, linaje ff puro `cf36852→0c84ecd→f1c002b→0ff76b6`; **`M1_B_RUNTIME_INCLUDED=false`, `M2_RUNTIME_INCLUDED=false`** (grep de `tenantAuthz`/`TENANT_AUTHZ_MODE`/`analyticsExclusion`/`normalizeCanonicalEvent` = ausentes del árbol runtime); `package.json` delta = solo scripts de test, 0 dependencias nuevas; `a684aaa` = docs-only, NO usado como fuente |
| G4 evidencia release | CI identity-preflight run 31899410358 #71 **attempt-2 success sobre `0ff76b6` exacto** (attempt-1 = flake conocido `CHP-CI-PREFLIGHT-RUNNER-FLAKE-01`, dispuesto en `a684aaa`); security run 31899410310 delta GREEN, `NEW_FINDINGS=0`; `PRODUCT_BROWSER_X_USER_ID_EMITTERS=0` (frontend cookie-only NO desplegado en Deploy A — el frontend actual sigue legacy-compatible con backend off) |

## 2. Construcción aislada (worktree safety)

El working tree ordinario estaba en `chp/stats-event-contract-01` y NO se usó. Se creó un **worktree git aislado detached en exactamente `0ff76b6`** (limpio, 0 untracked) y la fuente viajó como `git archive` del commit (`src-0ff76b6.tar`, sha256 `9aef9ab251fd…` verificado byte-exacto en el VPS) → `/root/chp-m1-a-deploy-a-01/build/`. Por construcción, ningún archivo no versionado pudo entrar al contexto.

## 3. Recovery point (FASE 1)

Runner establecido `structured_backup.py` (protocolo CHP-BACKUP-01B):

- `RECOVERY_POINT_TIMESTAMP=2026-08-16T15:21:52Z`
- `RECOVERY_POINT_ID=structured-20260816T152152Z-6a3f4171` · snapshot restic `10dce935`
- 25 stores, integridad ok, `run_complete result=ok` (caché B2 caliente, ~10 s)
- `ROLLBACK_RUNTIME_SHA=cf36852` · `ROLLBACK_API_IMAGE_ID=sha256:080069663542…`
- data/, data-critical/, uploads/ intactos (solo lectura/captura). Sin prune.

## 4. Imagen inmutable (FASES 5–6)

- Build: `Dockerfile.api` multi-stage reproducible desde `build/` → **`chibalete/api:0ff76b6`**, `API_IMAGE_ID=sha256:f2935d0f12093d10e111713936f566d2360c9b16617989425f7a333447e17f3d`, `OCI revision=0ff76b694defc…`, version label `chp-iddb-m1-a-session-identity-deploy-a`.
- Verificación de contenido: `/app/secrets` vacío, sin `admin_secret`, sin `session_signing_key(.previous)`, sin `sessions.db`, sin `.env`, sin `/app/data` (0 hallazgos).
- Delta de compose: `DEPLOY_INFRA_DELTA=SESSION_OFF_CONFIG_AND_SESSIONS_MOUNT_ONLY` + swap de imagen. Por servicio: `image: chibalete/api:0ff76b6`, `SESSION_AUTH_MODE: "off"` (quoted — trampa YAML `off`≡bool), `SESSIONS_DB: /app/sessions/sessions.db`, mount `/var/www/chibalete/sessions → /app/sessions`. **No se tocó:** IDENTITY_READ/DOMAINS, METRICS/request-context, TENANT_AUTHZ, exclusión de cohortes, flags M2, frontend. Copia pre-deploy: `override.pre-deploy.yml`.

## 5. Directorio de sesiones y clave (FASES 3–4)

- `/var/www/chibalete/sessions/` creado root:root **0700**, vacío. `sessions.db` NO pre-creada.
- **Clave de firma NO instalada** (contrato OFF del rehearsal): 0 ficheros `session_signing_key*` en `secrets/`. El arranque OFF no la requirió (probado en imagen aislada).

## 6. Pre-deploy image canary (FASE 7, `--network none`, fixtures)

| Suite | Resultado |
|---|---|
| `sessionIdentity.test.mjs` | 42/42 |
| `sessionIdentityIntegration.test.mjs` (compat/enforce, two-instance, CSRF, fail-closed) | 34/34 |
| `sessionBrowserCookieOnly.test.mjs` | 13/13 |
| Arnés OFF explícito (`offModeDeployA.harness.mjs`) | 11/11 |

Arnés OFF: boot healthy **sin clave**, login legacy 200 **sin Set-Cookie**, x-user-id activo usable, progress activo permitido por auth, **disabled progress → 401** (tightening), mediador 200, `sessions.db` NO creada, dir vacío. Nota atestada: el 500 del handler de progress con fixture mínima Linux es artefacto conocido (memoria M1-B) — el contrato es allow=no-denegado; en producción el path devolvió 200 real.

## 7. Rolling deploy (FASES 8–12)

Orden: `drain api_2` → recreate (imagen nueva) → smoke drenada → `rejoin` → `drain api_1` → recreate → `rejoin`. api_1 jamás tocada durante el rollout de api_2; sin `compose down`; frontend y edge sin restart.

**Smoke api_2 (drenada, IP directa):** reader real x-user-id groups=200, progress/user=200; mediador=200; admin-secret shadow-compare=200; login liveness 401 con `cookie_hits=0`; sintético disabled: progress write=**401**, groups=**401**; `sessions.db=ABSENT`.

**Smoke ambas por routing normal (edge HTTPS):** reader groups 200×4 (cubre ambos upstreams por least_conn), mediador 200, progress 200, admin-secret 200, disabled write 401, login 401 sin cookie, root 200.

Estado final: ambas APIs `imageID=f2935d0f…`, `rev=0ff76b6`, `SESSION_AUTH_MODE=off`, `IDENTITY_READ=json` sin DOMAINS, healthy, restarts=0.

## 8. Dormancia (FASES 10/13)

- `SESSIONS_DB_CREATED=false` (fichero ausente, dir 0 entradas tras todo el smoke)
- `SESSION_KEY_PRESENT=false`
- Ninguna cookie `chp_session` emitida; subsistema de sesión NO es autoridad; x-user-id sigue vigente para activos.
- Delta intencional único vs `cf36852`: **`DISABLED_USER_PROGRESS_DENIAL_ONLY`** (cierre incondicional del gap active de `requireProgressOwner`, atestado en rehearsal R1). Sin deltas de comportamiento sin clasificar.

## 9. Invariantes de identidad (FASE 14)

Padrón 647 = 247 reales + 400 sintéticos (400 disabled / 0 activos); memberships **227**; groups canónicos 4 (+15 legacy +1 sintético compat); progreso sintético **7087**/7215; journal `APPLIED=100246 / NOOP=251 / PENDING=0 / FAILED=0` **idéntico pre/post-deploy**; `groups_db.json` sha16 `c938f6ea667ffa04` idéntico → `CANARY/DEPLOY_DATA_MUTATIONS=0`. Sin canary nuevo de ACCESS/USERS/GROUPS; `IDENTITY_READ=json` ambas.

## 10. Logs / salud (FASE 15)

`unexpected_5xx=0` (APIs y edge), `session_init_error=0`, `secret_error=0`, `identity_error=0`, `restart_loop=0`, sin errores SQLite de sesión. Los matches de "error" en logs = líneas informativas de boot (rutas SQLite, dotenv), benignas.

## 11. Frontend / edge (FASES 16–17)

- Frontend intacto: `chibalete/front:hf4a-r2-coherence-82fba6e`, `imageID=sha256:9141cfb4fa96…`, StartedAt 2026-07-07 sin cambio → `FRONTEND_RUNTIME_DELTA=0`. El frontend cookie-only pertenece a después de B2.
- Edge: sin cambio permanente; solo drain/rejoin acotado por instancia; upstream final con ambos servers activos sin `down`; 5xx=0.

## 12. Ref productiva y rollback (FASES 18–19)

- Ref: `chp/backup-capacity-01b` avanzada **ff** `cf36852..0ff76b6` y pushed (sin force). Ninguna rama M2/rehearsal avanzada.
- Alias `rollback-current` → `cf36852` (`080069663542…`); N-1 preservada, sin prune.
- **Contrato de rollback (NO ejecutado):** restaurar `override.pre-deploy.yml` sobre el override vivo (retira SESSION_AUTH_MODE/SESSIONS_DB/mount y devuelve `image: cf36852`) → `drain api_2` → `up -d --no-deps api_2` → verificar env/health → `rejoin` → ídem api_1. No toca data/, data-critical/, uploads/, stores de identidad, frontend, M1-B ni M2; `sessions/` queda vacío e inerte.

## 13. Evidencia

Workspace `/root/chp-m1-a-deploy-a-01/` (0700/0600): manifiesto `M1-A-DEPLOY-A-01.json`, `src-0ff76b6.tar`, `override.pre-deploy.yml`, `pre-deploy-state.txt`, arnés OFF, build context.

## 14. Siguiente paso (NO ejecutado)

`CHP-IDDB-M1-A-SESSION-IDENTITY-DEPLOY-B1`: instalar clave de firma productiva + activar COMPAT **solo api_2** (api_1 queda OFF control), verificar comportamiento local de sesión de api_2 — **sin reclamar cross-instance** (eso es B2 con ambas en COMPAT). Sin frontend, sin enforce, sin M1-B.
