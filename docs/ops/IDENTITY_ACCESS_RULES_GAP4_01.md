# IDENTITY_ACCESS_RULES_GAP4_01 — cierre del gap de cobertura `access_rules`

Unidad: **CHP-IDDB-GAP4-ACCESS-RULES-01** · Baseline: `2610d4c` · 2026-08-13

## Qué cierra

`identity.db.access_rules` estaba vacía mientras las lecturas runtime de
`access` dependían del store canónico JSON. Esta unidad demuestra la cadena
sostenible completa:

```
access_db.json (CANONICAL, autoridad intacta)
  → modelo semántico canónico (contrato Scope Engine)
  → identity.db.access_rules (backfill con el mirrorAccess REAL)
  → sincronización de escrituras futuras (writeJSON → identityWriteHook, ya existente)
  → reconciliación LIVE (sección access propia)
  → comparación sombra runtime (evalAccess, ya existente)
```

**JSON sigue siendo autoridad de escritura, lectura y login. Nada de esta
unidad activa `IDENTITY_READ=sqlite` ni añade dominios oficiales.**

## Autoridad canónica de access (auditada)

- **Store:** `ACCESS_DB` → `data/access_db.json` (prod:
  `/var/www/chibalete/data/access_db.json`, contenedor `/app/data/access_db.json`).
- **Lector único:** `accessService.resolveUserContentAccess` vía el seam
  `readJSON` (conmutable + observado por el comparador sombra). Consumidores:
  `GET /api/access/by-user/:userId`, `GET /api/content/:id/access` (capa 4,
  Scope Engine), preflight de contenido, métricas (`getAccessibleContentIds`).
- **Writers (ambos por `mutateAccessRules` → `writeJSON` → hook de espejo):**
  1. `POST /api/access` (upsert por id; admin-secret only).
  2. `syncNewContentToOrgAccessRules` (creación de contenido; solo scope
     `organization`; en prod hay 0 reglas org → hoy no-op).
- **No existe endpoint de borrado.** Revocación = `expiresAt` (se salta en
  lectura, no se borra) o edición fuera de banda (detectable por
  reconciliación y comparador, ver abajo).
- La base de lectura de mutación es el JSON físico fail-closed
  (`readCanonicalStoreForMutation`, RMW-SEAM-01): el guard
  `IDENTITY_MUTATION_SQLITE_GUARD` sigue vigente.

## Por qué `access_rules=0` (causa demostrada)

Combinación **C + ausencia de escrituras**:

- El import v2 (02A/02B) **omitió deliberadamente** el dominio access
  (`importIdentityCandidate.mjs` no lo proyecta; la migración `0002` conserva
  la tabla v1 «con sus filas», que eran 0).
- La integración del writer **ya existía** (`identityWriteHook` →
  `mirrorAccess`, full re-sync v1 conservado explícitamente bajo v2), pero
  **nunca hubo un write productivo** de `ACCESS_DB` desde que existe
  identity.db → el hook jamás se disparó.

No es schema mismatch ni modelo irrepresentable: el schema `0001` ya modela la
regla completa con `raw_json` lossless.

## Contrato semántico canónico

Regla = `{ id, scope ∈ {user,group,organization}, scopeId, titleIds[],
collectionIds[], expiresAt: number|null }`.

- **Semántica aditiva por unión**: toda regla aplicable suma titleIds y
  collectionIds; no hay precedencia ni reglas deny.
- **Ausencia de reglas aplicables** → `legacyFallback` según
  `ACCESS_FALLBACK_MODE` (prod: `open`).
- **Presencia de ≥1 regla aplicable** → modo estricto (default-deny para
  contenido no autorizado por la unión).
- **Expirada** → se salta en lectura (server clock), no se borra.
- **Duplicados por id**: imposibles vía writers (upsert por id). El backfill
  los trata como gate bloqueante (un upsert colapsaría filas).
- **Representación SQLite**: `access_rules(id PK, scope, scope_id,
  title_ids_json, collection_ids_json, expires_at, raw_json, …, deleted_at)`.
  La lectura del repo (`repo.access.all()`) devuelve `raw_json` parseado →
  el input de decisión es byte-equivalente al registro JSON.

## Arquitectura del espejo (sin sistema paralelo)

El canal es el **mismo `mirrorAccess` del runtime** (full re-sync
transaccional, idempotente por construcción —estado, no operaciones—, nunca
lanza, audita en `shadow_audit`). Cambios de esta unidad:

- `mirrorAccess(db, rules, log, provenance)` — provenance opcional registrado
  en `shadow_audit.detail` cuando ok=1 (writer + versión de fuente). El gate
  de lectura del facade solo consulta `ok`: sin cambio de contrato.
- `identityWriteHook` atribuye el write de access:
  `<instancia>::server.writeJSON src=<sha256:32> seq=<mtimeMs>`.
- Superficie registrada nueva (contrato 1.2.0): `backfillAccessRules.apply`
  (OUT_OF_BAND, dominio access).
- **Política de exclusión: NINGUNA.** El espejo es copia lossless del store
  (incluye reglas expiradas y reglas que apunten a grupos sintéticos): la
  equivalencia exigida es la del input de decisión, no una curaduría.

## Instrumento: `scripts/identity/backfillAccessRules.mjs`

```
node scripts/identity/backfillAccessRules.mjs \
  --sources-root <root con data/ y data-critical/> \
  --identity-db <identity.db> [--dry-run|--apply|--verify] [--fallback-mode open]
```

- `--dry-run` (default, read-only): censo, gates (INVALID=0, DUPLICATES=0,
  CONFLICTS=0, EXCLUDED=0), diff predicho, equivalencia fuente↔proyección.
- `--apply`: una pasada de `mirrorAccess` con provenance `GAP4_BACKFILL …`;
  reporta attempted/inserted/updated/soft_deleted/noop/failed, diff residual
  (=0), equivalencia contra el espejo real (repo real) y el audit resultante.
  Idempotente y restart-safe: re-ejecutar converge al mismo estado.
- `--verify` (read-only): NEW_CHANGES + equivalencia + último audit.
- Fuentes con el contrato LIVE completo (`identityLiveSources.mjs`): rutas
  derivadas, basenames vetados, forma validada, hashes como evidencia.
  `access_db.json` admite array vacío (estado canónico legal).

La equivalencia de decisión evalúa el **motor real** (`createAccessService`)
con reglas JSON vs reglas SQLite sobre el corpus completo
(principals × títulos/colecciones referidas + negativos). Cualquier
`DENY→ALLOW` o pérdida de modo estricto cuenta como
`security_relevant_mismatch` (gate = 0).

## Reconciliación LIVE

`reconcileIdentityShadow.mjs --check --source-mode live` incluye ahora la
sección `counts.access` (MATCH / MISSING / STALE / UNEXPECTED) y el estado de
access participa del veredicto global. **El modo FROZEN no cambia ni un
byte** (la atestación 02A no incluye access; la sección solo corre si la
corrida trae la fuente).

## Comparador sombra runtime

Sin cambios de código: `evalAccess` ya comparaba registro a registro. Con la
tabla poblada, el gap `EXPECTED_COVERAGE_GAP:ACCESS_RULES` desaparece por sí
solo y las lecturas cuentan MATCH; una regla presente solo en SQLite es
`EXTRA_IN_SQLITE` → `SECURITY_RELEVANT_DIVERGENCE`.

## Rollback

- El schema no cambió (tabla de `0001`): una imagen anterior (`2610d4c`,
  `89407f0`) opera sin problema con `access_rules` poblada — el rollback de
  imagen **no destruye** las filas.
- Deshacer solo el backfill: `--apply` con un `access_db.json` vacío NO es el
  camino (borraría el espejo de reglas reales). El espejo converge al store
  canónico en cada write; si hiciera falta vaciarlo, la vía es operativa
  (soft-delete manual documentado), no automática.

## Tests

`scripts/identity/__test__/backfillAccessRules.test.mjs` (69 aserciones, en
`test:identity-candidate`): contrato, censo, dry-run sin escritura, apply +
provenance + equivalencia real, verify/idempotencia, semántica positiva y
negativa en ambos orígenes, mismatch de seguridad artificial (decisión,
reconciliador y comparador), revocación, write-sync futuro con el hook real y
gates fail-closed. Fixtures de `reconcileSourceModes` y
`compareReadEquivalence` actualizadas con `access_db.json` (vacío legal).
