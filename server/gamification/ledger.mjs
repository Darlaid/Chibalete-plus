/**
 * ledger.mjs — CHP-GAMIFICACION-G3-01.
 *
 * Primitivas transaccionales internas del ledger (GAMIFICACION_MODELO_DATOS_V1).
 * Sin rutas HTTP ni ganchos de origen: nadie del producto llama todavía aquí.
 *
 * Reglas que este módulo hace cumplir (además de los CHECK/UNIQUE/triggers):
 *  - toda escritura va en `BEGIN IMMEDIATE` (serializa las dos réplicas);
 *  - un hecho `(source, source_event_id, fact_type)` se registra una sola vez;
 *    su emisión (XP/PM) ocurre en la MISMA transacción, así que un reintento
 *    no emite dos veces;
 *  - el snapshot `gm_pm_balances` solo cambia junto con su movimiento;
 *  - el llamador NUNCA fija montos, grado ni decisión: los decide
 *    `policy.mjs` con las reglas vigentes y los topes, en la misma transacción;
 *  - solo se emite desde evidencia de grado A/B; la lectura terminada sigue en
 *    observación (READING_EMISSION_LOCKED) hasta que G4 apruebe su validador;
 *  - reservas y canjes NO se exponen en G3-01 (solo existen sus tablas);
 *  - ningún ajuste fija un saldo: siempre es un movimiento con motivo y actor.
 *
 * No importa nada de server/royalties/ ni escribe otro store (P6).
 */
import crypto from 'node:crypto';
import { ulid } from '../ulid.js';
import { GamificationError, isEarningEnabled } from './db.mjs';
import { ELIGIBILITY, SOURCE_GRADE, decideEmission, validateRules } from './policy.mjs';

export const FACT_SOURCES = Object.freeze(Object.keys(SOURCE_GRADE));
export const FACT_DECISIONS = Object.freeze([
    'awarded', 'capped', 'observed', 'disabled_source',
    'rejected_self_review', 'rejected_excluded_user', 'rejected_inactive_account',
    'rejected_implausible', 'rejected_insufficient_data', 'rejected_not_eligible',
]);
const FACT_FIELDS = new Set(['source', 'sourceEventId', 'factType', 'userId', 'actorId', 'occurredAt', 'eligibility', 'features', 'now']);

/** Claves admitidas en `features_json` por fuente (Modelo de datos V1 §4). Nada de texto libre. */
export const FEATURE_ALLOWLIST = Object.freeze({
    mook_review: ['experienceVersionId', 'decision', 'reviewerIsSelf'],
    mook_experience: ['experienceVersionId'],
    reading_completion: ['verdict', 'reasons', 'activeMinutes', 'sessions', 'distinctDays', 'maxProgressPct', 'monotonic', 'lengthUnits', 'mode'],
    offline_validation: [],
    mission: [],
});

/**
 * Cota técnica por movimiento: protege contra montos absurdos por error de
 * programación. NO es una tarifa doctrinal; los topes reales (D13/D14/D46)
 * vivirán en `gm_rule_sets` y se aplican en una unidad posterior.
 */
export const MAX_AMOUNT_PER_MOVEMENT = 10_000;
const MAX_ID = 128;
const MAX_FEATURE_STRING = 64;
const ID_RX = /^[A-Za-z0-9._:@-]+$/;
const BOGOTA_OFFSET_MS = 5 * 3_600_000; // UTC−5, sin horario de verano

const bad = (code, message) => new GamificationError(code, message);
const isId = (s) => typeof s === 'string' && s.length > 0 && s.length <= MAX_ID && ID_RX.test(s);
const isInt = (n) => Number.isSafeInteger(n);

/** Periodos de topes en America/Bogota: `YYYY-MM-DD` y semana ISO `YYYY-Www`. */
export function periodsFor(ms) {
    const d = new Date(ms - BOGOTA_OFFSET_MS);
    const day = d.toISOString().slice(0, 10);
    const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const dow = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - dow);
    const yearStart = Date.UTC(t.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((t - yearStart) / 86_400_000 + 1) / 7);
    return { day, week: `${t.getUTCFullYear()}-W${String(week).padStart(2, '0')}` };
}

function validateFeatures(source, features) {
    if (features == null) return '{}';
    if (typeof features !== 'object' || Array.isArray(features)) throw bad('INVALID_FEATURES', 'features debe ser un objeto');
    const allowed = new Set(FEATURE_ALLOWLIST[source] || []);
    for (const [k, v] of Object.entries(features)) {
        if (!allowed.has(k)) throw bad('INVALID_FEATURES', `clave no admitida para ${source}: ${k}`);
        const okScalar = (x) => typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x))
            || (typeof x === 'string' && x.length <= MAX_FEATURE_STRING);
        const fine = Array.isArray(v) ? v.length <= 16 && v.every(okScalar) : okScalar(v);
        if (!fine) throw bad('INVALID_FEATURES', `valor no admitido en ${k}`);
    }
    return JSON.stringify(features);
}

function requireRuleVersion(db, ruleVersion) {
    if (!isId(ruleVersion)) throw bad('INVALID_RULE_VERSION');
    if (!db.prepare('SELECT 1 FROM gm_rule_sets WHERE rule_version = ?').get(ruleVersion)) {
        throw bad('UNKNOWN_RULE_VERSION', ruleVersion);
    }
}

/** Conjunto de reglas vigente en `now` (D48: el más reciente ya en vigor). */
export function getActiveRuleSet(db, now = Date.now()) {
    const row = db.prepare(`SELECT rule_version, rules_json FROM gm_rule_sets WHERE effective_from <= ?
        ORDER BY effective_from DESC, created_at DESC, rule_version DESC LIMIT 1`).get(now);
    return row ? { ruleVersion: row.rule_version, rules: JSON.parse(row.rules_json) } : null;
}

/** PM `earn` ya emitidos al usuario en el día y semana (Bogotá) de `now`. */
function earnedUsage(db, userId, source, now) {
    const p = periodsFor(now);
    const sum = (sql, ...a) => db.prepare(sql).get(...a).n;
    return {
        day: sum("SELECT COALESCE(SUM(amount),0) n FROM gm_pm_movements WHERE user_id=? AND kind='earn' AND period_day=?", userId, p.day),
        week: sum("SELECT COALESCE(SUM(amount),0) n FROM gm_pm_movements WHERE user_id=? AND kind='earn' AND period_week=?", userId, p.week),
        daySource: sum("SELECT COALESCE(SUM(amount),0) n FROM gm_pm_movements WHERE user_id=? AND kind='earn' AND source=? AND period_day=?", userId, source, p.day),
    };
}

function checkAmount(n, { allowNegative }) {
    if (!isInt(n) || n === 0) throw bad('INVALID_AMOUNT', 'monto entero distinto de 0');
    if (!allowNegative && n < 0) throw bad('INVALID_AMOUNT', 'monto positivo requerido');
    if (Math.abs(n) > MAX_AMOUNT_PER_MOVEMENT) throw bad('AMOUNT_OUT_OF_BOUNDS');
}

/** Inserta un movimiento y aplica su delta al snapshot. Llamar SOLO dentro de una transacción. */
function insertMovement(db, m) {
    const p = periodsFor(m.createdAt);
    const movementId = ulid(m.createdAt);
    const info = db.prepare(`
        INSERT INTO gm_pm_movements (movement_id, user_id, kind, amount, source, idempotency_key, fact_id,
            redemption_id, related_movement_id, reason_code, actor_id, rule_version, period_day, period_week, created_at)
        VALUES (@movementId, @userId, @kind, @amount, @source, @idempotencyKey, @factId,
            NULL, @relatedMovementId, @reasonCode, @actorId, @ruleVersion, @day, @week, @createdAt)
    `).run({ movementId, factId: null, relatedMovementId: null, ...m, day: p.day, week: p.week });
    const seq = Number(info.lastInsertRowid);
    db.prepare(`
        INSERT INTO gm_pm_balances (user_id, available, reserved, lifetime_earned, last_seq, updated_at)
        VALUES (@userId, @amount, 0, @earned, @seq, @createdAt)
        ON CONFLICT(user_id) DO UPDATE SET
            available = available + excluded.available,
            lifetime_earned = lifetime_earned + excluded.lifetime_earned,
            last_seq = excluded.last_seq,
            updated_at = excluded.updated_at
    `).run({ userId: m.userId, amount: m.amount, earned: m.kind === 'earn' ? m.amount : 0, seq, createdAt: m.createdAt });
    return movementId;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Registra un conjunto de reglas (append-only, prospectivo D48), validado por
 * la política: sin topes no hay reglas. Idempotente si el contenido coincide.
 */
export function createRuleSet(db, { ruleVersion, rules, createdBy, effectiveFrom, now = Date.now() }) {
    if (!isId(ruleVersion)) throw bad('INVALID_RULE_VERSION');
    if (!isId(createdBy)) throw bad('INVALID_ACTOR');
    validateRules(rules, { featureAllowlist: FEATURE_ALLOWLIST });
    const rulesJson = JSON.stringify(rules);
    const digest = sha256(rulesJson);
    const from = effectiveFrom ?? now;
    if (!isInt(from) || from < now) throw bad('RETROACTIVE_RULES', 'las reglas solo rigen hacia adelante');
    return db.transaction(() => {
        const prev = db.prepare('SELECT rules_sha256 FROM gm_rule_sets WHERE rule_version = ?').get(ruleVersion);
        if (prev) {
            if (prev.rules_sha256 !== digest) throw bad('IDEMPOTENCY_CONFLICT', `rule_version ${ruleVersion} ya existe con otro contenido`);
            return { ruleVersion, created: false };
        }
        db.prepare('INSERT INTO gm_rule_sets VALUES (?, ?, ?, ?, ?, ?)').run(ruleVersion, now, createdBy, rulesJson, digest, from);
        return { ruleVersion, created: true };
    }).immediate();
}

/**
 * Registra un hecho de evidencia. El llamador aporta SOLO el hecho y su
 * elegibilidad; el grado (por fuente), la decisión y los montos los fija la
 * política con las reglas VIGENTES y los topes del usuario, dentro de la misma
 * transacción `IMMEDIATE` (dos réplicas no pueden exceder un tope). Un
 * reintento del mismo hecho devuelve el registro original sin emitir.
 *
 * @param {object} fact  source, sourceEventId, factType, userId, actorId?, occurredAt, eligibility, features?, now?
 * @param {{ env?: object }} [opts]  `PM_EARNING_ENABLED` se lee aquí, por llamada
 * @returns {{ inserted: boolean, factId: string, decision: string, xp: number, pm: number, xpEntryId: string|null, movementId: string|null }}
 */
export function recordFact(db, fact, { env = process.env } = {}) {
    const unknown = Object.keys(fact || {}).filter((k) => !FACT_FIELDS.has(k));
    if (unknown.length) throw bad('CALLER_FIELD_NOT_ALLOWED', `el llamador no fija ${unknown.join(',')}`);
    const { source, sourceEventId, factType, userId, actorId = null, occurredAt, eligibility, features = null, now = Date.now() } = fact;
    if (!FACT_SOURCES.includes(source)) throw bad('UNKNOWN_SOURCE', String(source));
    if (!isId(sourceEventId) || !isId(factType) || !isId(userId)) throw bad('INVALID_FACT');
    if (actorId !== null && !isId(actorId)) throw bad('INVALID_ACTOR');
    if (!isInt(occurredAt) || occurredAt <= 0) throw bad('INVALID_FACT', 'occurredAt');
    if (!ELIGIBILITY.includes(eligibility)) throw bad('INVALID_ELIGIBILITY', String(eligibility));
    const featuresJson = validateFeatures(source, features);
    // La autoconcesión nunca emite, aunque el llamador la declare elegible.
    const effectiveEligibility = eligibility === 'eligible' && actorId !== null && actorId === userId ? 'rejected_self_review' : eligibility;
    const earningEnabled = isEarningEnabled(env);

    return db.transaction(() => {
        const existing = db.prepare('SELECT * FROM gm_source_facts WHERE source = ? AND source_event_id = ? AND fact_type = ?')
            .get(source, sourceEventId, factType);
        if (existing) {
            if (existing.user_id !== userId) throw bad('IDEMPOTENCY_CONFLICT', 'el mismo hecho con otro sujeto');
            const xpRow = db.prepare("SELECT entry_id, xp FROM gm_xp_entries WHERE fact_id = ? AND kind = 'award'").get(existing.fact_id);
            const mvRow = db.prepare('SELECT movement_id, amount FROM gm_pm_movements WHERE idempotency_key = ?').get(`fact:${existing.fact_id}`);
            return { inserted: false, factId: existing.fact_id, decision: existing.decision, xp: xpRow?.xp ?? 0, pm: mvRow?.amount ?? 0,
                xpEntryId: xpRow?.entry_id ?? null, movementId: mvRow?.movement_id ?? null };
        }
        const active = getActiveRuleSet(db, now);
        if (!active) throw bad('NO_ACTIVE_RULES', 'no hay reglas vigentes');
        const d = decideEmission({ rules: active.rules, source, factType, eligibility: effectiveEligibility,
            features: features || {}, earningEnabled, usage: earnedUsage(db, userId, source, now) });
        const factId = ulid(now);
        db.prepare(`
            INSERT INTO gm_source_facts (fact_id, source, source_event_id, fact_type, user_id, actor_id, occurred_at,
                recorded_at, grade, decision, rule_version, features_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(factId, source, sourceEventId, factType, userId, actorId, occurredAt, now, d.grade, d.decision, active.ruleVersion, featuresJson);
        let xpEntryId = null;
        let movementId = null;
        if (d.xp > 0) {
            xpEntryId = ulid(now);
            db.prepare("INSERT INTO gm_xp_entries VALUES (?, ?, 'award', ?, ?, NULL, ?, ?)").run(xpEntryId, userId, d.xp, factId, active.ruleVersion, now);
        }
        if (d.pm > 0) {
            movementId = insertMovement(db, { userId, kind: 'earn', amount: d.pm, source, idempotencyKey: `fact:${factId}`,
                factId, reasonCode: `${source}.${factType}`.slice(0, MAX_ID), actorId: 'system', ruleVersion: active.ruleVersion, createdAt: now });
        }
        return { inserted: true, factId, decision: d.decision, xp: d.xp, pm: d.pm, xpEntryId, movementId };
    }).immediate();
}

/** Lee el movimiento previo con la misma clave; si difiere del pedido, conflicto. */
function replayOrConflict(db, idempotencyKey, expect) {
    const prev = db.prepare('SELECT * FROM gm_pm_movements WHERE idempotency_key = ?').get(idempotencyKey);
    if (!prev) return null;
    const same = Object.entries(expect).every(([k, v]) => prev[k] === v);
    if (!same) throw bad('IDEMPOTENCY_CONFLICT', 'misma clave con otro contenido');
    return { inserted: false, movementId: prev.movement_id };
}

/**
 * Ajuste administrativo (D30): un movimiento con motivo y actor humano.
 * Nunca deja el saldo disponible por debajo de 0.
 */
export function appendAdjustment(db, { userId, amount, reasonCode, actorId, idempotencyKey, relatedMovementId = null,
    ruleVersion, now = Date.now() }) {
    if (!isId(userId) || !isId(reasonCode) || !isId(idempotencyKey)) throw bad('INVALID_ADJUSTMENT');
    if (!isId(actorId) || actorId === 'system') throw bad('INVALID_ACTOR', 'un ajuste exige un actor humano');
    checkAmount(amount, { allowNegative: true });
    const key = `adj:${actorId}:${idempotencyKey}`;
    return db.transaction(() => {
        requireRuleVersion(db, ruleVersion);
        const replay = replayOrConflict(db, key, { user_id: userId, kind: 'adjustment', amount, reason_code: reasonCode });
        if (replay) return replay;
        if (relatedMovementId !== null) {
            const rel = db.prepare('SELECT user_id FROM gm_pm_movements WHERE movement_id = ?').get(relatedMovementId);
            if (!rel || rel.user_id !== userId) throw bad('INVALID_RELATED_MOVEMENT');
        }
        const bal = db.prepare('SELECT available FROM gm_pm_balances WHERE user_id = ?').get(userId);
        if ((bal?.available ?? 0) + amount < 0) throw bad('INSUFFICIENT_BALANCE', 'un ajuste no puede dejar el saldo negativo');
        const movementId = insertMovement(db, { userId, kind: 'adjustment', amount, source: 'admin', idempotencyKey: key,
            relatedMovementId, reasonCode, actorId, ruleVersion, createdAt: now });
        db.prepare("INSERT INTO gm_admin_audit VALUES (?, ?, 'adjustment', ?, ?, ?)").run(ulid(now), actorId, userId, movementId, now);
        return { inserted: true, movementId };
    }).immediate();
}

/**
 * Compensación (D30): corrige un movimiento previo del mismo usuario. Es el
 * único tipo que puede dejar `available` < 0 (Contratos V1 §5.4).
 */
export function appendCompensation(db, { userId, amount, reasonCode, actorId, relatedMovementId, idempotencyKey,
    ruleVersion, now = Date.now() }) {
    if (!isId(userId) || !isId(reasonCode) || !isId(idempotencyKey) || !isId(relatedMovementId)) throw bad('INVALID_COMPENSATION');
    if (!isId(actorId)) throw bad('INVALID_ACTOR');
    checkAmount(amount, { allowNegative: true });
    const key = `comp:${relatedMovementId}:${idempotencyKey}`;
    return db.transaction(() => {
        requireRuleVersion(db, ruleVersion);
        const replay = replayOrConflict(db, key, { user_id: userId, kind: 'compensation', amount, reason_code: reasonCode });
        if (replay) return replay;
        const rel = db.prepare('SELECT user_id FROM gm_pm_movements WHERE movement_id = ?').get(relatedMovementId);
        if (!rel || rel.user_id !== userId) throw bad('INVALID_RELATED_MOVEMENT');
        const movementId = insertMovement(db, { userId, kind: 'compensation', amount, source: 'admin', idempotencyKey: key,
            relatedMovementId, reasonCode, actorId, ruleVersion, createdAt: now });
        return { inserted: true, movementId };
    }).immediate();
}

// ── Consultas ───────────────────────────────────────────────────────────────

export function getBalance(db, userId) {
    const row = db.prepare('SELECT available, reserved, lifetime_earned, last_seq FROM gm_pm_balances WHERE user_id = ?').get(userId);
    return row
        ? { available: row.available, reserved: row.reserved, lifetimeEarned: row.lifetime_earned, lastSeq: row.last_seq }
        : { available: 0, reserved: 0, lifetimeEarned: 0, lastSeq: 0 };
}

export function listMovements(db, userId, { afterSeq = 0, limit = 50 } = {}) {
    const n = Math.min(Math.max(1, limit | 0), 200);
    return db.prepare(`
        SELECT seq, movement_id AS movementId, kind, amount, source, reason_code AS reasonCode, created_at AS createdAt
        FROM gm_pm_movements WHERE user_id = ? AND seq > ? ORDER BY seq LIMIT ?
    `).all(userId, afterSeq, n);
}

/** XP total: asientos `award` no anulados (P1: el XP nunca se gasta). */
export function getXp(db, userId) {
    return db.prepare(`
        SELECT COALESCE(SUM(a.xp), 0) AS xp FROM gm_xp_entries a
        WHERE a.user_id = ? AND a.kind = 'award'
          AND NOT EXISTS (SELECT 1 FROM gm_xp_entries v WHERE v.kind = 'void' AND v.voids_entry_id = a.entry_id)
    `).get(userId).xp;
}

const COMPUTED_SQL = `
    SELECT m.user_id,
           SUM(m.amount) AS available,
           COALESCE(SUM(CASE WHEN m.kind = 'earn' THEN m.amount END), 0) AS lifetime_earned,
           COALESCE((SELECT SUM(-r.amount) FROM gm_pm_movements r JOIN gm_redemptions d ON d.redemption_id = r.redemption_id
                     WHERE r.user_id = m.user_id AND r.kind = 'reserve' AND d.state IN ('RESERVED','DELIVERED')), 0) AS reserved,
           MAX(m.seq) AS last_seq
    FROM gm_pm_movements m GROUP BY m.user_id`;

/**
 * Verifica (solo lectura) que el snapshot coincide con el ledger para todos
 * los usuarios, y que no hay snapshots sin movimientos.
 */
export function verifyLedger(db) {
    const computed = new Map(db.prepare(COMPUTED_SQL).all().map((r) => [r.user_id, r]));
    const snapshots = db.prepare('SELECT * FROM gm_pm_balances').all();
    const divergences = [];
    for (const s of snapshots) {
        const c = computed.get(s.user_id);
        if (!c || c.available !== s.available || c.reserved !== s.reserved || c.lifetime_earned !== s.lifetime_earned || c.last_seq !== s.last_seq) {
            divergences.push({ userId: s.user_id, snapshot: s, computed: c ?? null });
        }
        computed.delete(s.user_id);
    }
    for (const [userId, c] of computed) divergences.push({ userId, snapshot: null, computed: c });
    return { ok: divergences.length === 0, users: snapshots.length, divergences };
}

/** Reconstruye todos los snapshots desde el ledger (recuperación, ADR §7). */
export function rebuildBalances(db, { now = Date.now() } = {}) {
    return db.transaction(() => {
        const rows = db.prepare(COMPUTED_SQL).all();
        const up = db.prepare(`
            INSERT INTO gm_pm_balances (user_id, available, reserved, lifetime_earned, last_seq, updated_at)
            VALUES (@user_id, @available, @reserved, @lifetime_earned, @last_seq, @now)
            ON CONFLICT(user_id) DO UPDATE SET available = excluded.available, reserved = excluded.reserved,
                lifetime_earned = excluded.lifetime_earned, last_seq = excluded.last_seq, updated_at = excluded.updated_at
        `);
        for (const r of rows) up.run({ ...r, now });
        return { users: rows.length };
    }).immediate();
}
