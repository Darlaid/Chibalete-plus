# IDENTITY_USERS_AUTHORITY_GAP2_01 — frontera de autoridad de lectura de users

Unidad: **CHP-IDDB-02C-GAP2-USERS-AUTHORITY-01** (prep 2026-08-13; **NO
desplegada**). Deriva de `IDENTITY_USERS_AUTHORITY_GAP2_AUDIT.md`. Cierra el
diseño de M1 para el dominio users.

## Matriz de autoridad final (contrato M1)

| Surface | Autoridad | Mecanismo |
|---|---|---|
| canonical user reads / list operativo / get / authz identity / membership resolution | **SQLite** (bajo cutover) | vista operacional `composeCanonicalUserView` (247, clasificados antes de backend) |
| login / credential verification | **JSON físico** | `readCanonicalStoreForMutation` (RMW-SEAM); el espejo no tiene credenciales |
| user mutations | **JSON físico** | writers reales + dual-write |
| synthetic historical (post-GAP1) | **JSON vía compat explícita, solo admin** | `composeUserAdminView` (etiquetada, SIN credenciales) |
| métricas legacy | **JSON físico SIEMPRE** | `readJSONMetricsLegacy` + `metricsProvider` ya-físico |
| tombstones (11) | NOT_FOUND explícito | clase `TOMBSTONED` |
| unknown | fail-closed | clase `UNKNOWN` |

Sin ambigüedad de fuente; jamás `SQLite miss → JSON fallback` silencioso.

## Clasificador (`identityUserDomains.js`)

`classifyUserReadDomain`: orden tombstone > exclusión atestada
(`SYNTHETIC_LOADTEST_QUARANTINED` ⇒ compat; **cualquier otra disposition ⇒
UNKNOWN**) > fila canónica (v2 por `canonical_id`; rama v1 legacy preserva el
contrato byte-equivalente del toolchain de pruebas) > UNKNOWN. Defensas
probadas: el schema v2 rechaza por TRIGGER una fila canónica que colisione
con un tombstone, y el clasificador evalúa tombstone antes que la fila.

## Política por superficie (implementada, 4 call sites tocados)

- **Default del seam** (`readJSON(USERS_DB)`, 16 sitios + módulos
  adminAuth/accessService/cis): vista OPERACIONAL canónica bajo cutover.
- **`readUsersAdminHistorical()`** (3 sitios: `GET /api/users`, exports de
  submissions por task y por student): canónico ∪ compat sintética atestada
  — el listado admin conserva su universo histórico (647 post-GAP1) sin
  exponer jamás material de credencial en los registros compat.
- **`readJSONMetricsLegacy()`** (1 sitio: `loadAndInitMetrics`): físico
  SIEMPRE. Junto con `metricsProvider` (que ya leía con `fs.readFileSync`
  propio), **los denominadores de métricas existentes no pueden cambiar por
  el cutover**: `METRICS_AUTHORITY=JSON_LEGACY`,
  `METRICS_CUTOVER_DEFERRED_TO_PHASE2=true`
  (el 647→247 pertenece a `CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01`).

## Sanitización endurecida (higiene de GAP2-00)

`CREDENTIAL_FIELDS` = lista ÚNICA compartida (password, passwordHash,
resetToken/ExpiresAt, inviteToken/ExpiresAt) consumida por: `sanitizeUser`
(proyección v2), `stripCredentials` (comparador — un token presente en JSON y
ausente del espejo ya NO puede aflorar como divergencia falsa: probado) y el
credential-guard de tests. La absence policy del comparador consume
`attestedUserExclusionMap` (misma fuente que el clasificador).

## Evidencia (suite de 50 casos, server real, fixture post-GAP1 de 648)

- **Modo JSON = no-op absoluto** (lista 648, logins como hoy).
- **Cutover simulado**: admin 647 (fantasma y tombstones fuera); operacional
  canónico 200 / sintético 404 / fantasma 404 / tombstone 404; sesión:
  canónico 200, **canónico DISABLED 401 (fidelidad de status,
  `STATUS_PRIVILEGE_EXPANSION=0`)**, sintético 401, fantasma 401.
- **`LOGIN_AUTHORITY=JSON`**: login real 200 bajo cutover (el espejo no tiene
  credenciales ⇒ `LOGIN_SQLITE_LOOKUPS=0` estructural) + aserción de código
  (login usa `readCanonicalStoreForMutation`).
- **AUTHZ equivalence**: 0 divergencias en roles/status/org/groupIds para los
  247 (`ALLOW_JSON_DENY_SQLITE=0`, `DENY_JSON_ALLOW_SQLITE=0`).
- **Membership**: `MEMBERSHIP_USER_UNRESOLVED=0`.
- **RMW**: PUT bajo cutover → 648→648, credenciales y fantasma preservados;
  **WRITE=JSON** con convergencia al espejo (SQLite jamás primary writer).
- **Comparador**: 247 MATCH; `SYNTHETIC_USER=400` atestado + fantasma como
  gap estructural (no proyectable) — nada se maquilla.
- **Credential guard**: 0 material de credencial en 247 raw_json (incluido el
  usuario con resetToken del fixture); `credential_excluded=1` en 247/247.
- **`M1_USER_AUTHORITY_CONTRACT=true`** (test agregado de 10 autoridades; se
  rompe ante fallback silencioso, credencial en SQLite, cutover accidental de
  métricas, login vía SQLite, sintético operativo, tombstone reactivado o
  unknown con fallback).
- Performance local: lookup p50 JSON≈3 µs vs SQLite≈8 µs (sin regresión).

## Dry-run productivo (ejecutado read-only)

`CANONICAL=247, SYNTHETIC_COMPAT=400, TOMBSTONED(padrón)=0
(11 atestadas fuera del padrón), UNKNOWN=0, AUTHZ_CANONICAL_UNRESOLVED=0,
MEMBERSHIP_USER_UNRESOLVED=0 (226 ids), CREDENTIALS_IN_SQLITE=0.`

## Integración con GAP1/GAP3 (ramas aisladas)

- Fixture = estado contractual post-GAP1 (sin merge de ramas); tras el ff de
  GAP1 la suite se re-ejecuta contra la implementación real.
- GAP3 y GAP2 editan ambos `identityReadFacade.js`,
  `identityShadowCompare.js` y `package.json`: **conflictos de merge
  ESPERADOS y triviales** (ramas aditivas sobre los mismos puntos de
  extensión). El orden de integración es el del deploy: GAP1 → GAP3 → GAP2,
  re-ejecutando `test:identity` completo tras cada ff. Consolidación mínima
  opcional en la integración: un `identityDomainAttestations` común (loaders
  de exclusiones/tombstones) — sin framework.

## Opción futura (no M1)

Credential store separado (Option B del audit): mejora post-M1 con unidad
propia; el contrato actual (credenciales solo-JSON) es explícito y suficiente.

## Deploy unit — CHP-IDDB-02C-GAP2-USERS-AUTHORITY-01-DEPLOY (congelada)

Precondiciones: (1) GAP4 F27 GREEN; (2) BACKUP-CAPACITY-01B-DEPLOY GREEN;
(3) GAP1 retirement GREEN; (4) GAP3 deploy GREEN; (5) CI exacto GREEN;
(6) `backup-capacity-preflight` GREEN; (7) recovery point GREEN. Después:
integración/ff controlado (orden GAP1→GAP3→GAP2 con suites tras cada paso) →
build única → image canary (secuencia congelada: baseline JSON → cutover →
247 SQLite / compat admin / tombstone 404 / unknown 404 / login real 200 /
sintético 401 / authz+membership equivalence / métricas intactas / RMW
647→647 / fallbacks oficiales=0) → deploy neutral → dry-run productivo →
activación controlada del dominio users → canary una instancia → ventana
runtime con telemetría de autoridad → readiness → post-backup →
**evaluación M1**.
