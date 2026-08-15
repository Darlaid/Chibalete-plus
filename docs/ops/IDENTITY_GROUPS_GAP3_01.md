# IDENTITY_GROUPS_GAP3_01 — dominio canónico de grupos y compat atestada

Unidad: **CHP-IDDB-02C-GAP3-GROUPS-01** (prep 2026-08-13; **NO desplegada**).
Deriva de la auditoría `IDENTITY_GROUPS_GAP3_AUDIT.md` (GAP3-00, GREEN).
Baseline: `chibalete/api:f885e31`, 20 grupos JSON / 4 canónicos SQLite /
227 membresías / 1 access rule.

## Contrato

```
groupId → classifyGroupReadDomain(db, groupId)
  CANONICAL                 → candidato SQLite (JSON oficial mientras dure shadow)
  ATTESTED_LEGACY_COMPAT    → JSON explícito + telemetría (15 hoy)
  ATTESTED_SYNTHETIC_COMPAT → JSON explícito + telemetría (1 hoy)
  UNKNOWN                   → fail-closed: fuera de toda vista compuesta
```

- **Fuente única y ATESTADA**: `identity.db.migration_exclusions(entity='group')`
  — la `disposition` distingue legacy (`LEGACY_TEST_GROUP_PENDING_RETIREMENT`)
  de sintético (`SYNTHETIC_LOADTEST_EXCLUDED`). Son las exclusiones de
  01C-R1/02A: ninguna segunda lista manual, cero heurísticas de nombre/grade.
- **Canónico ≠ «existe en SQLite»**: exige fila viva + institución registrada
  (mismo contrato que mirror/reconciler/absence-policy). Doble defensa
  probada: el schema v2 rechaza por FK una fila con institución fantasma, y
  ante una base manipulada (FK off) el clasificador devuelve UNKNOWN.
- **La clasificación ocurre ANTES de elegir backend**: jamás
  `SQLite miss → JSON fallback` silencioso. El fallback recovery-first del
  facade (error ⇒ lectura oficial JSON completa, contada) se conserva: esa
  degradación restaura el comportamiento íntegro actual, no un subconjunto.

## Composición bajo cutover (`composeGroupReadView`)

`canónico (SQLite) ∪ compat atestada (JSON ∩ exclusiones)`, con dedupe por id
EXACTO, precedencia canónica, UNKNOWN excluido, provenance por registro
(Symbol no enumerable `chp.identity.groupDomain`) y telemetría bounded.
Con `IDENTITY_READ=json` (producción actual) **es un no-op absoluto**:
`CURRENT_JSON_BEHAVIOR_UNCHANGED=true` probado con el server real.

## Semántica demostrada (suite `identityGroupDomains.test.mjs`, 41 casos)

- Cutover simulado (`IDENTITY_READ=sqlite`, `DOMAINS=groups`): listado = 20
  (4 SQLite + 16 compat); UNKNOWN → 404 contractual (`SILENT_FALLBACKS=0`);
  membresías canónicas resuelven desde SQLite
  (`CANONICAL_MEMBERSHIP_COMPAT_HITS=0` — ninguna exige compat).
- **`SYNTHETIC_ACCESS_COMPAT_PRESERVED=true`**: `lt-access-v2` sigue
  concediendo a los sintéticos vía compat (JSON sigue autoridad de access).
  Compatibilidad TEMPORAL acoplada a GAP-1.
- **Authz sin expansión**: un grupo UNKNOWN jamás concede bajo cutover (la
  única diferencia con el modo JSON es en dirección DENY); contenido no
  concedido deniega en ambos modos. Cero `DENY→ALLOW`.
- **RMW**: bajo cutover, la base de mutación sigue siendo el JSON físico
  (21→21 tras PUT; legacy/sintético/unknown sobreviven; guard intacto).
- **Comparador alineado (fuente compartida)**: `makeAbsencePolicy.group`
  consume `attestedGroupExclusionMap` — la MISMA tabla que el clasificador —
  y el motivo del gap declara la clase
  (`migration_exclusion:legacy|synthetic`). Cobertura NO se maquilla: los 16
  compat siguen contando `EXPECTED_COVERAGE_GAP:LEGACY_GROUP`; un grupo
  org-válido fuera de banda ausente de SQLite sigue aflorando como
  divergencia inesperada (probado); un org-less no atestado cae en el gap
  ESTRUCTURAL preexistente (motivo distinto de la exclusión atestada).

## Telemetría (F15) y señal de retiro (F16)

Prometheus: `chibalete_identity_group_domain_reads_total{class}` con
`class ∈ {canonical, compat_legacy, compat_synthetic, unknown_excluded}` —
cardinalidad fija, sin IDs, sin PII. Módulo: contadores bounded
(`getGroupDomainTelemetry`) incl. `group_listing_compat_items`.

**Señal de retiro**: los 15 legacy serán retirables cuando, durante una
ventana a definir por política, se sostenga `compat_legacy` sin crecimiento
atribuible a ellos + 0 dependencias de membresía/access/authz (el dry-run
`classifyGroupDomains.mjs` reporta las tres). La purga sigue siendo
`CHP-IDDB-PURGE-GROUPS-01` con sus gates atestados (snapshot, dry-run,
rollback, zero consumers) — esta unidad NO la modifica ni la ejecuta.

## Readiness (F14)

GROUPS podrá declararse `READY_FOR_CONTROLLED_CANARY` cuando, con esta
frontera desplegada: canónicos ≡ SQLite; compat explícitamente clasificada;
UNKNOWN fail-closed; fallbacks silenciosos = 0; resolución canónica de
membresías = 100 %; dependencia sintética de access preservada; expansión de
authz = 0; contrato de listados preservado; comparador con inesperadas = 0.
**No exige migrar los 16.**

## Dry-run productivo read-only

`scripts/identity/classifyGroupDomains.mjs --sources-root … --identity-db …`
→ conteos por dominio + membresías fuera de canónico + dependencias access.
Baseline productiva esperada: **4 / 15 / 1 / 0**, memberships fuera = 0,
access→compat_synthetic = 1.

## Unidad de deploy — CHP-IDDB-02C-GAP3-GROUPS-01-DEPLOY (congelada)

Orden obligatorio previo: (1) GAP-4 F27 GREEN; (2) BACKUP-CAPACITY-01B-DEPLOY
GREEN; (3) CI de esta rama GREEN; (4) pre-backup/preflight GREEN. Después:
ff a hotfix → build única desde git archive → **image canary** (JSON 20 →
cutover simulado 4+15+1, unknown 404, membresías 227, `lt-access-v2`
preservada, authz sin expansión, RMW 20→20) → deploy neutral (flags 1/1/json:
frontera inerte) → dry-run productivo (4/15/1/0) → ventana shadow →
actualización de readiness → post-backup.
