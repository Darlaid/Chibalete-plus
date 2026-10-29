# GAMIFICACION — Modelo de datos V1

**Unidad:** GAMIFICACION-G2-01 · **Fecha:** 2026-10-29 · **Baseline:** `ce450ea`.
**Estado:** BORRADOR de esquema, **no aplicado**. G3 lo convierte en `server/gamification/migrations/0001_ledger.sql`, y para eso necesita autorización expresa de la migración.
**Relacionados:** [ADR G2](GAMIFICACION_ADR_G2_V1.md) y [Eventos y API V1](GAMIFICACION_EVENTOS_API_V1.md).

## 0. Convenciones

- **Archivo:** `data-critical/gamification.db` (ADR §2).
- **Prefijo `gm_`** en todas las tablas.
- **Tiempos:**
  - `INTEGER` en ms UTC, siempre con el reloj del servidor.
  - `period_day` (`YYYY-MM-DD`) y `period_week` (`YYYY-Www`, ISO) calculados en **America/Bogota** (UTC−5, sin horario de verano). Solo se usan para los topes.
- **Identificadores:** ULID (`server/ulid.js` existente) o derivados deterministas cuando la idempotencia lo exige.
- **Montos:** `INTEGER` (PM enteros); XP como `INTEGER ≥ 0`.
- **Append-only:** un trigger `BEFORE UPDATE` y otro `BEFORE DELETE` con `RAISE(ABORT, '<tabla> is append-only')`. Es el mismo patrón que `econ_events`.

## 1. Mapa de tablas

| Tabla | Naturaleza | Propósito |
|---|---|---|
| `gm_rule_sets` | Append-only | Reglas versionadas (montos, topes, curvas, catálogos); `rule_version` |
| `gm_source_facts` | Append-only | Cada hecho de evidencia recibido **y su decisión** |
| `gm_xp_entries` | Append-only | Asientos de XP (`award` / `void`) |
| `gm_achievements` | Append-only | Logros concedidos y anulados |
| `gm_pm_movements` | Append-only | El ledger de PM |
| `gm_pm_balances` | **Mutable**, solo dentro de la transacción del movimiento | Snapshot: `available`, `reserved`, `lifetime_earned` |
| `gm_redemptions` | Mutable, con transiciones vigiladas por trigger | Estado de la saga de canje |
| `gm_redemption_transitions` | Append-only | Historial de estados de cada canje |
| `gm_reward_grants` | Append-only | Lo entregado (activo, regla de acceso o cupón) con su referencia externa |
| `gm_admin_audit` | Append-only | Lecturas y acciones de administración (soporte) |

**No forman parte de G3:**
- el catálogo de recompensas, que en G3 sale de `gm_rule_sets` y llega con G5;
- las misiones (G7);
- los vínculos con familias (GATED, D35).

## 2. Esquema propuesto

```sql
-- ── Reglas ────────────────────────────────────────────────────────────────
CREATE TABLE gm_rule_sets (
  rule_version  TEXT PRIMARY KEY,                 -- p.ej. 'gm-2026-11-v1'
  created_at    INTEGER NOT NULL,
  created_by    TEXT    NOT NULL,                 -- actor (admin) o 'migration'
  rules_json    TEXT    NOT NULL,                 -- montos, topes, curvas (CONFIGURABLE)
  rules_sha256  TEXT    NOT NULL,
  effective_from INTEGER NOT NULL                 -- prospectivo (D48): nunca < created_at
);

-- ── Hechos de evidencia y decisión ───────────────────────────────────────
CREATE TABLE gm_source_facts (
  fact_id         TEXT PRIMARY KEY,
  source          TEXT NOT NULL CHECK (source IN ('mook_review','mook_experience','reading_completion','offline_validation','mission')),
  source_event_id TEXT NOT NULL,
  fact_type       TEXT NOT NULL,
  user_id         TEXT NOT NULL,
  actor_id        TEXT,
  occurred_at     INTEGER NOT NULL,
  recorded_at     INTEGER NOT NULL,
  grade           TEXT NOT NULL CHECK (grade IN ('A','B','C','D')),
  decision        TEXT NOT NULL CHECK (decision IN (
                    'awarded','capped','observed','disabled_source',
                    'rejected_self_review','rejected_excluded_user','rejected_inactive_account',
                    'rejected_implausible','rejected_insufficient_data','rejected_not_eligible')),
  rule_version    TEXT NOT NULL REFERENCES gm_rule_sets(rule_version),
  features_json   TEXT NOT NULL DEFAULT '{}',     -- resumen mínimo, sin texto libre (ver §4)
  UNIQUE (source, source_event_id, fact_type)     -- I1
);
CREATE INDEX ix_gm_facts_user ON gm_source_facts(user_id, recorded_at);

-- ── XP y logros (P1: no gastables) ───────────────────────────────────────
CREATE TABLE gm_xp_entries (
  entry_id        TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('award','void')),
  xp              INTEGER NOT NULL CHECK (xp >= 0),
  fact_id         TEXT REFERENCES gm_source_facts(fact_id),
  voids_entry_id  TEXT REFERENCES gm_xp_entries(entry_id),
  rule_version    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  CHECK ((kind = 'award' AND fact_id IS NOT NULL AND voids_entry_id IS NULL)
      OR (kind = 'void'  AND voids_entry_id IS NOT NULL AND xp = 0)),
  UNIQUE (fact_id, kind)
);
CREATE UNIQUE INDEX ux_gm_xp_void ON gm_xp_entries(voids_entry_id) WHERE kind = 'void';
CREATE INDEX ix_gm_xp_user ON gm_xp_entries(user_id, created_at);

CREATE TABLE gm_achievements (
  row_id          TEXT PRIMARY KEY,
  user_id         TEXT NOT NULL,
  achievement_id  TEXT NOT NULL,                  -- del catálogo en gm_rule_sets
  kind            TEXT NOT NULL CHECK (kind IN ('award','void')),
  fact_id         TEXT REFERENCES gm_source_facts(fact_id),
  rule_version    TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  UNIQUE (user_id, achievement_id, kind)
);

-- ── Ledger de PM ─────────────────────────────────────────────────────────
CREATE TABLE gm_pm_movements (
  seq              INTEGER PRIMARY KEY AUTOINCREMENT, -- orden total para el snapshot
  movement_id      TEXT    NOT NULL UNIQUE,
  user_id          TEXT    NOT NULL,
  kind             TEXT    NOT NULL CHECK (kind IN ('earn','reserve','reserve_release','redeem_confirm','compensation','adjustment')),
  amount           INTEGER NOT NULL CHECK (amount <> 0 OR kind = 'redeem_confirm'),
  source           TEXT    NOT NULL,              -- 'mook_review' | ... | 'redemption' | 'admin'
  idempotency_key  TEXT    NOT NULL UNIQUE,       -- fact_id | redemption_id+fase | actor+Idempotency-Key
  fact_id          TEXT REFERENCES gm_source_facts(fact_id),
  redemption_id    TEXT REFERENCES gm_redemptions(redemption_id),
  related_movement_id TEXT REFERENCES gm_pm_movements(movement_id),
  reason_code      TEXT    NOT NULL,
  actor_id         TEXT    NOT NULL,              -- 'system' o el admin
  rule_version     TEXT    NOT NULL,
  period_day       TEXT    NOT NULL,
  period_week      TEXT    NOT NULL,
  created_at       INTEGER NOT NULL,
  CHECK ((kind = 'earn'            AND amount > 0 AND fact_id IS NOT NULL)
      OR (kind = 'reserve'         AND amount < 0 AND redemption_id IS NOT NULL)
      OR (kind = 'reserve_release' AND amount > 0 AND redemption_id IS NOT NULL)
      OR (kind = 'redeem_confirm'  AND amount = 0 AND redemption_id IS NOT NULL)
      OR (kind = 'compensation'    AND related_movement_id IS NOT NULL)
      OR (kind = 'adjustment'      AND actor_id <> 'system'))
);
CREATE INDEX ix_gm_mov_user_seq  ON gm_pm_movements(user_id, seq);
CREATE INDEX ix_gm_mov_caps      ON gm_pm_movements(user_id, kind, source, period_day, period_week);

CREATE TABLE gm_pm_balances (
  user_id          TEXT PRIMARY KEY,
  available        INTEGER NOT NULL,
  reserved         INTEGER NOT NULL CHECK (reserved >= 0),
  lifetime_earned  INTEGER NOT NULL CHECK (lifetime_earned >= 0),
  last_seq         INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL
);

-- ── Canjes (saga) ────────────────────────────────────────────────────────
CREATE TABLE gm_redemptions (
  redemption_id    TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL,
  idempotency_key  TEXT NOT NULL,
  reward_id        TEXT NOT NULL,
  reward_kind      TEXT NOT NULL CHECK (reward_kind IN ('digital_asset','content_access','woo_coupon')),
  price_pm         INTEGER NOT NULL CHECK (price_pm > 0),
  rule_version     TEXT NOT NULL,
  state            TEXT NOT NULL CHECK (state IN ('RESERVED','DELIVERED','CONFIRMED','RELEASED')),
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  UNIQUE (user_id, idempotency_key)
);
-- Trigger: solo RESERVED→DELIVERED, RESERVED→RELEASED, DELIVERED→CONFIRMED, DELIVERED→RELEASED;
-- estados finales (CONFIRMED, RELEASED) inmutables; campos distintos de state/updated_at inmutables.

CREATE TABLE gm_redemption_transitions (
  row_id         TEXT PRIMARY KEY,
  redemption_id  TEXT NOT NULL REFERENCES gm_redemptions(redemption_id),
  from_state     TEXT,
  to_state       TEXT NOT NULL,
  reason_code    TEXT NOT NULL,
  actor_id       TEXT NOT NULL,                  -- 'system' | 'reconciler' | admin
  created_at     INTEGER NOT NULL
);

CREATE TABLE gm_reward_grants (
  grant_id       TEXT PRIMARY KEY,               -- derivado de redemption_id (idempotente)
  redemption_id  TEXT NOT NULL UNIQUE REFERENCES gm_redemptions(redemption_id),
  user_id        TEXT NOT NULL,
  reward_kind    TEXT NOT NULL,
  external_ref   TEXT,                           -- id de regla de acceso | id de cupón Woo | asset id
  expires_at     INTEGER,                        -- acceso temporal (D17-B) / vigencia cupón (D24)
  created_at     INTEGER NOT NULL
);

-- ── Auditoría de administración ──────────────────────────────────────────
CREATE TABLE gm_admin_audit (
  row_id      TEXT PRIMARY KEY,
  actor_id    TEXT NOT NULL,
  action      TEXT NOT NULL,                     -- 'read_ledger' | 'adjustment' | 'reconcile' | 'rule_set_created'
  target_user TEXT,
  ref         TEXT,
  created_at  INTEGER NOT NULL
);

-- + triggers append-only (BEFORE UPDATE / BEFORE DELETE → RAISE(ABORT)) en:
--   gm_rule_sets, gm_source_facts, gm_xp_entries, gm_achievements, gm_pm_movements,
--   gm_redemption_transitions, gm_reward_grants, gm_admin_audit
```

**Notas del borrador**, para cerrarlas en G3:
- `compensation` exige `related_movement_id`. `adjustment` lo admite como opcional, pero exige un actor humano (`actor_id <> 'system'`).
- `gm_pm_movements` referencia `gm_redemptions` antes de que esta se declare. SQLite lo admite porque las FK se resuelven al insertar. Este borrador se cargó tal cual en una base `:memory:` durante G2: crea las 10 tablas y sus CHECK y UNIQUE rechazan las formas inválidas probadas.
- `redeem_confirm` tiene monto 0 a propósito: el débito ya ocurrió en la `reserve`. La confirmación solo cierra la reserva, y `reserved` baja en el snapshot.

## 3. Saldo derivado y snapshot

Para un usuario `u`:
- `available(u) = Σ amount` de todos sus movimientos;
- `reserved(u) = Σ |amount|` de las `reserve` cuyo canje está en `RESERVED` o `DELIVERED`;
- `lifetime_earned(u) = Σ amount` de sus movimientos `earn`.

Cada transacción de escritura:
1. inserta el movimiento;
2. actualiza `gm_pm_balances` con el delta;
3. actualiza `last_seq`.

Si el snapshot no existe, se crea en esa misma transacción. La verificación A3/M3 recalcula las tres sumas desde cero y las compara.

**Saldo negativo** (Contratos V1 §5.4): solo un `compensation` puede dejar `available < 0`. `reserve` y `adjustment` lo rechazan dentro de la transacción. Con saldo negativo no se aceptan canjes.

**Topes:** se calculan en la transacción con `SUM(amount)` sobre `ix_gm_mov_caps` (por usuario, `kind='earn'`, fuente, día y semana) y sobre la bolsa mensual global. Con este volumen no hace falta una tabla de contadores, y así no hay un segundo estado que pueda divergir.

## 4. Minimización (`features_json`)

| Fuente | Campos admitidos | Prohibido |
|---|---|---|
| `mook_review` | `experienceVersionId`, `decision` (`aprobado` / `con_comentarios`) y `reviewerIsSelf` (bool) | Respuestas, feedback y texto del revisor |
| `reading_completion` | `verdict`, `reasons[]`, `activeMinutes`, `sessions`, `distinctDays`, `maxProgressPct`, `monotonic`, `lengthUnits`, `mode` | Texto de la obra, frases e IP |
| todas | — | Nombres, correos y PII de cualquier tipo |

## 5. Retención

**PENDIENTE de la DPIA** (ADR §8). Hasta que se decida:
- no se activa con usuarios reales;
- `gm_source_facts.features_json` se mantiene mínimo, porque es el candidato natural a expirar antes que el ledger.

## 6. Invariantes verificables y pruebas para G3

| # | Invariante | Prueba en G3 |
|---|---|---|
| M1 | `UNIQUE(source, source_event_id, fact_type)` impide el doble hecho; `idempotency_key UNIQUE` impide el doble movimiento | `idempotency.test.mjs` |
| M2 | UPDATE y DELETE abortan en las 8 tablas append-only | `appendOnly.test.mjs` |
| M3 | `gm_pm_balances` es igual a las sumas de §3 para todo usuario y toda secuencia aleatoria | `ledgerInvariant.test.mjs` (propiedades) |
| M4 | Los CHECK de signo por `kind` rechazan combinaciones inválidas (`earn` ≤ 0, `reserve` ≥ 0, `earn` sin `fact_id`, etc.) | `movementShape.test.mjs` |
| M5 | Solo se permiten las transiciones de canje legales; los estados finales son inmutables; cada transición deja una fila en `gm_redemption_transitions` | `redemptionStateMachine.test.mjs` |
| M6 | Ningún canje queda con `reserve` sin `reserve_release` ni `redeem_confirm` después del reconciliador | `wooCompensation.test.mjs` / `reconcile.test.mjs` |
| M7 | `available < 0` solo después de un `compensation`; `reserve` y `adjustment` lo rechazan | `negativeBalance.test.mjs` |
| M8 | El XP nunca disminuye: `Σ xp` de `award` no anulados es monotónico; un `void` no resta, solo excluye | `xpMonotonic.test.mjs` |
| M9 | `rule_version` presente y existente en cada hecho, asiento y movimiento; un conjunto nuevo nunca reescribe decisiones pasadas | `ruleVersioning.test.mjs` |
| M10 | `features_json` solo contiene las claves permitidas (§4) | `featuresAllowlist.test.mjs` |
| M11 | Los topes por día y semana se calculan en America/Bogota y son estables en el cambio de día UTC | `periodBoundaries.test.mjs` |
