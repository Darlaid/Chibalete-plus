# M1_A_SESSION_IDENTITY_R1_CI_RECONCILIATION — identity-preflight #71 attempt-1 → attempt-2

Unidad: **CHP-IDDB-M1-A-R1-CI-RECONCILIATION-01** (2026-08-15, evidence-only).
Reconciliación demostrable del run identity-preflight visible como FAILED con el
tree final `0ff76b6`. Sin cambio funcional; canary GROUPS intacto.

## Veredicto

**GREEN — M1-A R1 EXACT-TREE CI RECONCILED; ATTEMPT-1 MATCHES KNOWN FLAKE AND
ATTEMPT-2 IS RELEASE-VALID.**

## C. Run identity

`RUN_ID=31899410358` · workflow **identity-preflight** · `RUN_NUMBER=71` · branch
`chp/m1-a-session-identity-01` · `HEAD_SHA=0ff76b6` · created 17:49:47Z · updated
17:56:49Z · conclusión (attempt actual) **success**.

## D. Attempt inventory (mismo SHA, sin commit intermedio)

| Attempt | HEAD_SHA | Job | Conclusión |
|---|---|---|---|
| 1 | `0ff76b6` | 95047719545 | failure |
| 2 | `0ff76b6` | 95048117246 | success |

`ATTEMPT_1_SHA = ATTEMPT_2_SHA = 0ff76b6`. Es un **rerun del mismo run #71**
(`previous_attempt_url .../attempts/1`); GitHub reejecuta el mismo commit — no se
insertó ningún commit entre intentos (`SOURCE_TREE_CHANGE=false`).

## E–F. Attempt-1 paso y error exactos

- **FAILED_STEP**: #7 «Canonicidad de la fuente de usuarios» (`npm run test:identity`).
- **FAILED_TEST**: `scripts/identity/__test__/retireSyntheticCohort.test.mjs` (suite
  GAP1 de retiro sintético, invocada dentro de `test:identity-candidate`).
- **FAILED_ASSERTION**: `✗ escenario ejecutable Error: never healthy`, lanzado en
  `waitHealthy (retireSyntheticCohort.test.mjs:219:11)` desde la línea 268.
- **ERROR secundario (cascada)**: `ENOENT ... /tmp/chp_gap1_*/retire-snapshot.json`
  (el flujo abortó antes de escribir el snapshot).
- **EXIT_CODE**: 1.

## G. Clasificación root-cause

**SERVICE_STARTUP_TIMEOUT / TEST_HARNESS_FLAKE.** Evidencia decisiva en el log de
attempt-1: `[INFO] Server running on port 5061` + `[SUCCESS] Startup TTS check
complete` — **el servidor SÍ arrancó**, pero el poll de `/api/health` de `waitHealthy`
(150×400ms = 60 s) no completó dentro de la ventana bajo la carga del runner
(la auditoría pasiva de TTS al arranque bloqueó el event loop lo suficiente). NO es
regresión de R1: falla **cerrada** (el test lanza y el job falla), nunca hace pasar
un test que debería fallar.

## H. Fingerprint del flake conocido

`CHP-CI-PREFLIGHT-RUNNER-FLAKE-01`. Firma: test=`retireSyntheticCohort.test.mjs`,
función=`waitHealthy` (línea 219), string=`never healthy`, con el server ya arrancado
(`Server running on port …`), seguido de `retire-snapshot.json` ENOENT. **Idéntica**
a las ocurrencias previas (M1-A attempt-1, GAP2 attempt-1). `MATCHES_KNOWN_FLAKE=true`.

## I. Attempt-2 proof (mismo tree, test ejecutado y verde)

Log de attempt-2 (job 95048117246), mismo SHA/workflow/tests:
- El retire test **ejecutó y pasó**: `✓ RETIREMENT_RESUMABLE=true` + `Resultados: 53 ✓, 0 ✗`
  (no skipped, no excluido, no continue-on-error).
- Tests R1 verdes: `PRODUCT_BROWSER_X_USER_ID_EMITTERS = 0`, guard `2 ✓ (127 files)`,
  sessionIdentity `42 ✓`, sessionIdentityIntegration `34 ✓`, cookie-only `13 ✓`
  (COMPAT+ENFORCE), GAP3 `41 ✓`, GAP2 `50 ✓`, shadowCompare `95 ✓`.
- Store-isolation re-run de `test:identity` verde (`53 ✓` retire de nuevo) → 0 stores
  reales alterados. Conclusión del job: **success**.

## J. Same-tree proof

`ATTEMPT_1_SHA=ATTEMPT_2_SHA=0ff76b6`. `SOURCE_TREE_CHANGE=false`.

## K. Failed-test execution proof

El test que falló en attempt-1 (retire) **corrió completo y pasó 53/53** en attempt-2;
no fue saltado ni condicionado.

## L. Security workflow (0ff76b6)

`security` run 31899410310: delta GREEN — evidence-hardening, image-integrity,
trivy(fs), osv-scanner, gitleaks-head. Heredados `gitleaks-history` (10 leaks,
fingerprints baseline) y `trivy-image` (CVE-2026-44902/45447/59892) RED
**baseline-idénticos**, `NEW_FINDINGS=0`.

## M–N. Flake risk / release-blocking assessment

El flake es un **timeout de arranque acotado que falla cerrado**; no puede enmascarar
una regresión de auth/session/GAP1/identidad/corrupción, porque un fallo funcional
haría fallar una aserción — y en attempt-2, sobre el **tree idéntico**, el conjunto
completo de aserciones del retire (invariantes GAP1: 400 disabled, regla inactiva,
resume exacto, comparador 0/0/0) + los contratos de sesión R1 se ejecutaron GREEN.
Por tanto: **non-blocking debt** (CHP-CI-PREFLIGHT-RUNNER-FLAKE-01). No STOP.

## O. Reproducción acotada

No necesaria: el retire test pasó en attempt-2 (exact-tree) y en múltiples corridas en
imagen aislada durante el desarrollo de R1 (GAP1 53/53). Un flake de carga de runner
pasa siempre en entorno local rápido; alterar el timeout para «reproducir» está
prohibido y no aporta.

## P. No-test-weakening audit

Diff `f1c002b..0ff76b6`: **no toca** `retireSyntheticCohort.test.mjs`, `waitHealthy`,
ni `verify-test-store-isolation`. Sin `continue-on-error`/`allow_failure`/`.skip`/
edición de timeout/deshabilitación de preflight. (El único `waitHealthy` del diff es la
función propia del test NUEVO `sessionBrowserCookieOnly.test.mjs`, patrón estándar del
harness, no una modificación del retire.) `TEST_STRENGTH_UNCHANGED_OR_STRONGER=true`.

## Q. Disposición CI final

`CI_RAW_FIRST_ATTEMPT=RED` (retire flake) · `CI_FINAL_EXACT_TREE=GREEN` (attempt-2,
mismo SHA, retire + todo verde) · `CI_RELEASE_GATE=GREEN_WITH_KNOWN_FLAKE_DISPOSITION`.
Las excepciones heredadas de seguridad permanecen separadas (baseline).

## R. M1_A_PRODUCTION_DEPLOY_READY = true

Mismo SHA attempt-2 GREEN; attempt-1 root-caused; coincide con flake acotado conocido;
sin cambio de tree; el test fallido pasó en attempt-2; security delta válido; sin
regresión funcional oculta.

## Groups-canary non-interference

`docker inspect --format` (sin probes): api_1 `cf36852` json, api_2 `cf36852`
sqlite/groups, ambos healthy, restarts=0 → RUNNING.

## Exact next step

**CHP-IDDB-M1-C1-GROUPS-CANARY-CLOSE-01** (tras resume 2026-08-16T14:25Z) →
**M1-A-DEPLOY** (desde `0ff76b6`) → M1-B-DEPLOY → M1-C → M1-D.
