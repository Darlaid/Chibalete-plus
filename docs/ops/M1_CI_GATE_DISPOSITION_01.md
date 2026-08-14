# CHP-M1-CI-GATE-DISPOSITION-01 — fallos de CI heredados: equivalencia de baseline y gate de release

Fecha: 2026-08-14 · Unidad read-only/CI-only. Sin mutación productiva, sin
deploy, sin build, sin debilitamiento de workflows.

## 1. Contexto

BACKUP-CAPACITY-01B-DEPLOY quedó técnicamente GREEN con hotfix tip `72d5f5e`
y runtime API `chibalete/api:f885e31`, pero dos jobs de CI están en rojo:
`gitleaks-history` y `trivy-image`. El contrato de release M1 exige CI
exact-tree antes de cualquier siguiente release. Esta unidad convierte la
afirmación «preexistentes» en evidencia con fingerprint y fija la
disposición formal.

## 2. Reproducción de baseline (F1)

| job | baseline `f885e31` | actual `72d5f5e` | árbol integrado GAP1 (`3920098`) |
|---|---|---|---|
| gitleaks-history | failure — 10 leaks | failure — 10 leaks | failure — 10 leaks |
| trivy-image | failure — Total 2 HIGH / 0 CRITICAL | failure — Total 2 HIGH / 0 CRITICAL | failure — Total 2 HIGH / 0 CRITICAL |

Fuente: logs completos de los jobs descargados por API
(runs 31711072853 / 31722670095 / rama `chp/m1-gap1-ci-simulation`),
no el estado visual de GitHub.

## 3. gitleaks-history (F2)

Set-diff exacto de los **10 fingerprints** (`commit:path:rule:línea`):
`comm` da **0 solo-en-72d5f5e, 0 solo-en-baseline, 10 idénticos**. Los
mismos 10 en el árbol integrado con GAP1.

**`NEW_HISTORY_SECRET_FINDINGS=0`** (demostrado por igualdad de conjuntos,
no por inspección visual).

Findings (todos en commits HISTÓRICOS, ninguno en HEAD — `gitleaks-head`
GREEN en los tres árboles):

- `376f6dd` — `server/__test__/adminSecretFile.test.js` ×3
  (`generic-api-key`, líneas 44–46): fixtures de test.
- `f7f0c5c` — `chibalete-admin-secret` ×5 en `ecosystem.config.cjs`,
  `server/test_persistence_flow.js`, `server/simulate_novelty.js`,
  `server/test_user_flow.js`, `verify_pipeline.cjs`: el ADMIN_SECRET
  histórico. **Neutralizado**: rotado (unidades de rotación de
  ADMIN_SECRET; hoy file-only 0400 root:root).
- `f7f0c5c` — `studio-editor-bi/assets/index-CqLdlylq.js`
  (`gcp-api-key` + `chibalete-gemini-key`): claves de proveedor AI en un
  bundle histórico. **Neutralizadas**: rotadas
  (CHP-AI-PROVIDER-KEYS-ROTATE-01A).

Sin rewrite de historia, sin force-push: la historia git conserva los
valores viejos ya revocados; el job seguirá rojo por diseño hasta que se
decida una remediación de historia (ver deuda §7).

## 4. trivy-image (F3/F4)

El job **construye** `chibalete/api:ci` desde el árbol (Dockerfile.api,
base pineada por digest `node:20-alpine@sha256:fb4cd12c…`) y la escanea
con la CVE-DB viva. El delta 01B no toca Dockerfile/package.json → la
imagen construida es equivalente en los tres árboles.

Filas de vulnerabilidad **byte-idénticas** en baseline, 72d5f5e y árbol
integrado. Los «2 HIGH» son **un único CVE en dos paquetes**:

| CVE | paquete | instalada | fix | severidad |
|---|---|---|---|---|
| CVE-2026-45447 (openssl: heap use-after-free en `PKCS7_verify()`) | `libcrypto3` | 3.5.6-r0 | 3.5.7-r0 | HIGH |
| ídem | `libssl3` | 3.5.6-r0 | 3.5.7-r0 | HIGH |

**`NEW_IMAGE_VULNERABILITIES_FROM_72D5F5E=0`**. La aparición del CVE con
digest de base sin cambios = **LIVE_DATABASE_DRIFT**, no delta de fuente.

Disposición de alcanzabilidad (verificada en la imagen productiva):

- `libcrypto3/libssl3 3.5.6-r0` SÍ están presentes en
  `chibalete/api:f885e31` (apk list en contenedor productivo).
- **Node NO los usa**: `process.versions.openssl = 3.0.19` (OpenSSL
  ESTÁTICO propio del binario node; sin linkage dinámico a ssl/crypto).
- `PKCS7_verify()` es ruta S/MIME; la API Node/Express no la invoca y el
  módulo `crypto` de Node ni la expone.
- Contenedor non-root; ningún otro proceso del contenedor consume las
  libs del sistema en caliente.

**Clasificación: `RELEASE_DEBT` + `DATABASE_DRIFT`. NO `ROUTE_BLOCKER`**
— no hay explotación plausible de alta gravedad en el runtime actual.
Remediación: bump deliberado del digest base (o `apk upgrade` en build)
en una unidad propia; NO como efecto colateral de un build de identidad.

## 5. Matriz de atribución (F5)

| JOB | BASELINE | 72d5f5e | NEW_FINDINGS | ATTRIBUTABLE_TO_DELTA | SECURITY_IMPACT |
|---|---|---|---|---|---|
| gitleaks-history | 10 (fingerprints exactos) | 10 idénticos | 0 | ninguna | ninguno nuevo (valores rotados) |
| trivy-image | CVE-2026-45447 ×2 pkgs | idéntico byte a byte | 0 | ninguna | no alcanzable por la app |

`72d5f5e` no empeoró ninguno de los dos jobs — demostrado por igualdad de
fingerprints/filas, no por «preexisting» declarativo.

## 6. Modelo de gate de release (F6/F7)

Dos ejes explícitos, sin debilitar CI (ningún job deshabilitado, ningún
allow_failure, ninguna exclusión/supresión, configs de gitleaks/trivy
intactas):

**A. EXACT_TREE_DELTA_GATE (obligatorio GREEN):** 0 secretos nuevos
(gitleaks-head + set-diff de history), 0 vulnerabilidades nuevas
atribuibles, tests aplicables GREEN (identity-preflight/capacity/security
delta). — GREEN en `72d5f5e` y en el árbol integrado GAP1.

**B. INHERITED_SECURITY_DEBT (puede seguir RED):** demostrada en baseline
productivo (sí), no empeora (fingerprints idénticos), deuda registrada
(§7), no route-blocker (§4), con owner y camino de remediación (§7).

Estado resultante — nunca se afirma CI_ALL_GREEN:

```
CI_RAW_STATUS=RED
CI_RELEASE_GATE=GREEN_WITH_BASELINE_EXCEPTION
```

## 7. Deudas registradas (F10)

- **CHP-SEC-CI-HISTORY-LEAKS-01** (nueva): 10 findings históricos de
  gitleaks-history (fixtures + secretos ya ROTADOS en `376f6dd`/`f7f0c5c`).
  Owner: operador/seguridad. Camino: decidir entre baseline-file de
  gitleaks (documentado, no oculto), limpieza de historia (alto coste,
  hoy prohibida) o aceptación permanente documentada. Sin urgencia: los
  valores están revocados.
- **CHP-SEC-IMAGE-CVE-01** (nueva; sucesora natural de la línea
  SEC-DEPS-01): CVE-2026-45447 en base alpine pineada. Owner: release
  engineering. Camino: unidad de bump de digest base + rebuild + canary,
  posterior al train M1 (o antes si el CVE se vuelve alcanzable).

## 8. Simulación del árbol GAP1 (F8)

Rama temporal `chp/m1-gap1-ci-simulation` = `72d5f5e` + `merge --no-ff
806fce4` (estrategia congelada; merge limpio, 4 archivos aditivos).
**Árbol byte-idéntico al estado post-GAP1 del rehearsal (`889254b`)**, que
ya había pasado la suite identity completa local.

CI de GitHub sobre el árbol integrado exacto (9 jobs):
`identity-preflight`, `capacity-suite`, `gitleaks-head`, `trivy` (fs),
`osv-scanner`, `evidence-hardening`, `image-integrity` **GREEN**;
`gitleaks-history` y `trivy-image` en rojo **con findings idénticos al
baseline** (set-diff = ∅). GAP1 no introduce ningún finding nuevo. El
árbol integrado exacto es seguro para construir.

## 9. Contrato de CI para GAP1-DEPLOY (F9)

Antes del build de GAP1 se exige, sobre el árbol integrado EXACTO (no el
CI de `806fce4` a solas):

```
NEW_SECRET_FINDINGS=0
NEW_SOURCE_VULNERABILITIES=0
NEW_IMAGE_VULNERABILITIES_ATTRIBUTABLE_TO_GAP1=0
INHERITED_FINDINGS_UNCHANGED=true
```

La simulación de §8 ya lo satisface para el árbol `72d5f5e+806fce4`; si
la integración productiva produce el MISMO árbol (esperado: merge sin
conflictos), esta evidencia es directamente reutilizable; cualquier árbol
distinto re-ejecuta el contrato.

## 10. B2 (F11)

Solo revisión de la conclusión existente de 01B (sin restic, sin
preflight, sin consumo): repository GREEN, CACHE_REUSE_PROVEN,
`quota_blocks_today=0`, sin presión Class B durante el deploy.
`B2_ACCOUNT_CAP=UNKNOWN` + `B2_CAP_OPERATOR_CONFIRMATION_REQUIRED=true`
se mantiene. **`NON_BLOCKING_FOR_GAP1=true`**.

## 11. Decisión de release (F12)

Todos los requisitos demostrados →

**GREEN — INHERITED CI FAILURES ARE BASELINE-EQUIVALENT AND M1 RELEASE
GATE ALLOWS GAP1**

```
CI_RAW_STATUS=RED
CI_RELEASE_GATE=GREEN_WITH_BASELINE_EXCEPTION
GAP1_DEPLOY_ALLOWED=true
```
