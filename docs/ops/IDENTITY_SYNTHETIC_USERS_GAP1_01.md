# IDENTITY_SYNTHETIC_USERS_GAP1_01 — retiro reversible de la cohorte sintética

Unidad: **CHP-IDDB-02C-GAP1-SYNTHETIC-USERS-01** (prep 2026-08-13; **NO
desplegada**). Deriva de `IDENTITY_SYNTHETIC_USERS_GAP1_AUDIT.md` (GAP1-00).
Baseline: `f885e31`, 647 JSON (400 sintéticos + 247 reales), regla
`lt-access-v2` activa (64 títulos = 96 % del catálogo real).

## Corrección al hallazgo de GAP1-00

La credencial compartida **NUNCA se versionó**: `scripts/loadtest/` está
cubierto por `.gitignore` (`/scripts/*`) y `git log -S` en toda la historia da
vacío. Registrado: `PLAINTEXT_SYNTHETIC_CREDENTIAL_IN_HEAD=false`,
`IN_GIT_HISTORY=false`, `ACTIVE_RUNTIME_DEPENDENCY=false` (solo el tooling de
loadtest local la lee). La exposición real: working trees locales con
`seed_users.js`/`users.json`/`session_data.json` en claro + **credencial
VÁLIDA en producción para 400 cuentas activas**. El retiro sigue siendo el
cierre correcto; no hay nada que limpiar de HEAD ni de la historia.

## Semántica del retiro (F1)

```
SYNTHETIC_RETIRED :=
  AUTHENTICATION_DISABLED  (accountStatus='disabled')
∧ ACCESS_RULE_INACTIVE     (lt-access-v2 con expiresAt=1, pasado)
∧ USER_RECORDS_PRESERVED ∧ PROGRESS_PRESERVED ∧ GROUP_PRESERVED ∧ AUDIT_PRESERVED
```

Sin delete, sin purge, sin tocar credenciales. Contrato existente
(`isUserActive`: `!status || status==='active'`) — ningún mecanismo nuevo.

## Selección de cohorte — doble atestación estricta

`(_loadtest_marker en el padrón) ∧ (h16(id) ∈ migration_exclusions(user,
SYNTHETIC_LOADTEST_QUARANTINED))`. Cualquier discrepancia en cualquiera de
las tres direcciones (marcado sin exclusión, excluido sin marcador, exclusión
sin registro) ⇒ STOP `COHORT SELECTION AMBIGUOUS`. Seleccionar un usuario
real es estructuralmente imposible. La derivación de hash (h16(id) =
`legacy_identity_hash` de la proyección v2) quedó validada contra las
exclusiones reales por el dry-run productivo (400/400 casan, 0 huérfanas).

## Writers y orden (F3–F5)

- **Usuarios**: `PUT /api/users/:id` por usuario — JSON físico authority,
  locks del server, mirror hook, atribución `server.writeJSON`. El marcador
  `_loadtest_marker` sobrevive al merge (`normalizeUser` hace spread).
- **Regla**: `POST /api/access` (upsert secret-only) con la regla ÍNTEGRA y
  `expiresAt=1` — queda presente como evidencia; `mirrorAccess` la espeja.
- **Orden**: 1º expirar la regla (cerrar la concesión), 2º deshabilitar
  cuentas. Probado el estado intermedio: jamás cuentas habilitadas con más
  acceso que antes (la concesión solo decrece).
- No hay atomicidad entre stores y no se finge: el proceso es idempotente y
  reanudable por delta (re-ejecutar completa lo pendiente).

## Herramienta

`scripts/identity/retireSyntheticCohort.mjs` — `--dry-run` (default,
read-only, agregados sin PII), `--apply` (HTTP real; snapshot previo
obligatorio en el runbook), `--rollback` (desde snapshot; exige
`--acknowledge-security-risk`). Transporte inyectable (tests). Snapshot:
estados previos + expiración previa, **sin credenciales**, 0600.

## Sesiones (F11) — sin gap

El sistema NO persiste sesiones (sin tokens/JWT/cookies): cada request con
`x-user-id` relee el usuario y `isUserActive`. Probado con el server real:
tras el disable, la MISMA cabecera de sesión sintética pasa de 200 → 401 al
instante. `SESSION_REVOCATION_GAP` = no existe. `USERS_DB` está en
`UNCACHED_JSON_FILES` → coherencia multi-instancia inmediata; la regla tarda
≤30 s (TTL de caché de `ACCESS_DB`).

## Evidencia (suite de 53 casos, server real, 647 usuarios de fixture)

PRE probado funcional (login sintético 200 + sesión + 64-títulos) →
APPLY por writers reales (400 PUTs + upsert; 45 s) → POST:
`SYNTHETIC_LOGIN_DISABLED=true`, sesión previa 401,
`SYNTHETIC_RULE_APPLIES=false`, `REAL_LOGIN_REGRESSION=0`, acceso real
intacto. Preservación total: 647 registros, 400 disabled con credencial
intacta, 247 reales activos, regla presente-expirada campo a campo, grupo
con sus 400 memberIds, progreso fingerprint-idéntico, espejo 247 sin insert
sintético, exclusiones 400 intactas, `mirrorAccess` espejó la expiración.
Comparador: gap `SYNTHETIC_USER=400` **se mantiene** (GAP-1 no se maquilla),
0 inesperadas/0 seguridad. `RETIREMENT_IDEMPOTENT=true` (2ª pasada 0/0/0).
`RETIREMENT_RESUMABLE=true` (interrupción a 150 → estado intermedio seguro →
resume completa 250). Rollback probado (400+1 restaurados; login sintético
vuelve en fixture) con gate de reconocimiento.
`SYNTHETIC_IDOR_AMPLIFICATION_REMOVED=true` solo en el sentido de nuevas
sesiones; el IDOR base (`CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01`) NO se declara
cerrado.

## Rollback y su riesgo (F20–F21)

`ROLLBACK_REINTRODUCES_SECURITY_RISK=true` — declarado en el snapshot y en el
gate del tool. Si un rollback productivo fuese necesario: **exigir mitigación
de credencial (nueva credencial no versionada o equivalente) ANTES de
reactivar autenticación**, salvo emergencia estrictamente justificada. La
rotación de credenciales NO se implementa aquí.

## Consecuencias

- **Espejo/exclusiones (F14)**: sin cambios; los 400 siguen excluidos; el
  comparador mantiene el gap atestado.
- **GAP-3 (F15)**: el grupo sintético pasa a retirement-candidate. Antes del
  deploy de GAP3-01 hay que revalidar su aserción
  `SYNTHETIC_ACCESS_COMPAT_PRESERVED=true` → se convierte en
  `SYNTHETIC_COMPAT_PRESENT_BUT_ACCESS_INACTIVE=true` (el grupo se sirve por
  compat pero la regla ya no concede). Registrado como requisito de
  revalidación de la rama GAP3 si GAP1 se despliega primero.
- **Stats (F17)**: `CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01` sigue abierta.
- **Readiness (F22)**: `GAP1_FUNCTIONAL_RISK_CLOSED=true` pero
  `USERS_READINESS=BLOCKED` (registros presentes, gap atestado, frontera de
  lecturas pendiente, GAP-2 authority pendiente). No confundir.

## Política futura de load-test (F13)

Contrato mínimo para campañas futuras (Policy C): credenciales generadas en
runtime (jamás committeadas), ciclo de vida explícito con teardown
OBLIGATORIO en el mismo runbook, expiración obligatoria de toda regla,
marcador de cohorte aislado, cero entitlement productivo permanente.

## Dry-run productivo (ejecutado read-only)

`400/400 activos, 0 disabled, regla presente y activa (expiración null),
247 canónicos, 0 reales seleccionados, esperado: 400 updates + 1 regla.`

## Deploy unit — CHP-IDDB-02C-GAP1-SYNTHETIC-USERS-01-DEPLOY (congelada)

Orden obligatorio: (1) GAP-4 F27 GREEN; (2) BACKUP-CAPACITY-01B-DEPLOY GREEN;
(3) `backup-capacity-preflight` GREEN; (4) recovery point pre GREEN; (5) CI
de la rama GREEN; (6) **image canary** (PRE login sintético OK → apply →
POST sintético 401/sesión 401/acceso denegado, real intacto, 647/247/400/
7.087 preservados, PENDING=0) ; (7) dry-run productivo (agregados exactos);
(8) expirar regla; (9) deshabilitar 400 (snapshot previo obligatorio);
(10) reconcile/comparator (LIVE=MATCH, gap atestado, 0 inesperadas);
(11) ventana runtime (0 intentos sintéticos esperados; logins reales sin
anomalías); (12) post-backup; (13) revalidar aserciones de GAP3.
