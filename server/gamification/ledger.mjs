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
 *  - XP y PM tienen flags independientes y bloqueos por fuente (`policy.mjs`);
 *  - PRIV-01B: el ledger no guarda identidad. La API recibe `userId` y lo resuelve
 *    con `subjects.mjs`; solo se escriben `subject_ref` y claves HMAC, ids sin
 *    tiempo y fechas con precisión de día. Un hecho que no emite no deja fila;
 *  - la clave de sujeto es obligatoria: sin ella no se registra nada;
 *  - reservas y canjes NO se exponen en G3-01 (solo existen sus tablas);
 *  - ningún ajuste fija un saldo: siempre es un movimiento con motivo y actor.
 *
 * No importa nada de server/royalties/ ni escribe otro store (P6).
 */
import crypto from 'node:crypto';
import { GamificationError, isEarningEnabled, isXpEarningEnabled } from './db.mjs';
import { ELIGIBILITY, SOURCE_GRADE, decideEmission, isEmissionLocked, validateRules } from './policy.mjs';
import { deriveSourceKey, ensureSubject, findSubject } from './subjects.mjs';
import { getSubjectKey } from './subjectKey.mjs';

export const FACT_SOURCES = Object.freeze(Object.keys(SOURCE_GRADE));
export const FACT_DECISIONS = Object.freeze([
    'awarded', 'capped', 'observed', 'disabled_source',
    'rejected_self_review', 'rejected_excluded_user', 'rejected_inactive_account',
    'rejected_implausible', 'rejected_insufficient_data', 'rejected_not_eligible',
]);
const FACT_FIELDS = new Set(['source', 'sourceEventId', 'factType', 'userId', 'actorId', 'occurredAt', 'eligibility', 'features', 'now']);

/** Claves admitidas en `features_json` por fuente (Modelo de datos V1 §4). Nada de texto libre. */
export const FEATURE_ALLOWLIST = Object.freeze({
    mook_review: [],
    mook_experience: [],
    reading_completion: ['verdict'],
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
const randomId = () => crypto.randomUUID();
/** Inicio del día en Bogotá: la única precisión temporal que se persiste. */
const dayStart = (ms) => Math.floor((ms - BOGOTA_OFFSET_MS) / 86_400_000) * 86_400_000 + BOGOTA_OFFSET_MS;

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
    const row = db.prepare(`SELECT rule_version, rules_json, effective_from FROM gm_rule_sets WHERE effective_from <= ?
        ORDER BY effective_from DESC, created_at DESC, rule_version DESC LIMIT 1`).get(now);
    return row ? { ruleVersion: row.rule_version, rules: JSON.parse(row.rules_json), effectiveFrom: row.effective_from } : null;
}

/** PM `earn` ya emitidos al sujeto en el día y semana (Bogotá) de `now`. */
function earnedUsage(db, subjectRef, source, now) {
    if (!subjectRef) return { day: 0, week: 0, daySource: 0 };
    const p = periodsFor(now);
    const sum = (sql, ...a) => db.prepare(sql).get(...a).n;
    return {
        day: sum("SELECT COALESCE(SUM(amount),0) n FROM gm_pm_movements WHERE subject_ref=? AND kind='earn' AND period_day=?", subjectRef, p.day),
        week: sum("SELECT COALESCE(SUM(amount),0) n FROM gm_pm_movements WHERE subject_ref=? AND kind='earn' AND period_week=?", subjectRef, p.week),
        daySource: sum("SELECT COALESCE(SUM(amount),0) n FROM gm_pm_movements WHERE subject_ref=? AND kind='earn' AND source=? AND period_day=?", subjectRef, source, p.day),
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
    const createdAt = dayStart(m.createdAt);
    const movementId = randomId();
    const info = db.prepare(`
        INSERT INTO gm_pm_movements (movement_id, subject_ref, kind, amount, source, idempotency_key, fact_id,
            redemption_id, related_movement_id, reason_code, actor_ref, rule_version, period_day, period_week, created_at)
        VALUES (@movementId, @subjectRef, @kind, @amount, @source, @idempotencyKey, @factId,
            NULL, @relatedMovementId, @reasonCode, @actorRef, @ruleVersion, @day, @week, @createdAt)
    `).run({ movementId, factId: null, relatedMovementId: null, ...m, createdAt, day: p.day, week: p.week });
    const seq = Number(info.lastInsertRowid);
    db.prepare(`
        INSERT INTO gm_pm_balances (subject_ref, available, reserved, lifetime_earned, last_seq, updated_at)
        VALUES (@subjectRef, @amount, 0, @earned, @seq, @createdAt)
        ON CONFLICT(subject_ref) DO UPDATE SET
            available = available + excluded.available,
            lifetime_earned = lifetime_earned + excluded.lifetime_earned,
            last_seq = excluded.last_seq,
            updated_at = excluded.updated_at
    `).run({ subjectRef: m.subjectRef, amount: m.amount, earned: m.kind === 'earn' ? m.amount : 0, seq, createdAt });
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
 * @param {{ env?: object }} [opts]  `XP_EARNING_ENABLED` y `PM_EARNING_ENABLED` se leen aquí, por llamada
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
    const xpEnabled = isXpEarningEnabled(env);
    const pmEnabled = isEarningEnabled(env);

    // PRIV-01C: lo que no puede emitir no toma el lock de escritura. Un barrido
    // reevalúa estos hechos cada vez, porque no dejan fila.
    const noRow = (decision) => ({ inserted: false, persisted: false, factId: null, decision, xp: 0, pm: 0, xpEntryId: null, movementId: null });
    if (effectiveEligibility !== 'eligible') return noRow(effectiveEligibility === 'observe' ? 'observed' : effectiveEligibility);
    if (isEmissionLocked(source)) return noRow('observed');

    getSubjectKey(); // sin clave no se evalúa nada: nunca se escribe una fila que no se pueda deduplicar
    if (!xpEnabled && !pmEnabled) return noRow('disabled_source');

    return db.transaction(() => {
        let subject = findSubject(db, userId);
        const existing = subject && db.prepare('SELECT * FROM gm_source_facts WHERE source = ? AND source_event_id = ? AND fact_type = ?')
            .get(source, deriveSourceKey(subject, source, factType, sourceEventId), factType);
        if (existing) {
            const xpRow = db.prepare("SELECT entry_id, xp FROM gm_xp_entries WHERE fact_id = ? AND kind = 'award'").get(existing.fact_id);
            const mvRow = db.prepare('SELECT movement_id, amount FROM gm_pm_movements WHERE idempotency_key = ?').get(`fact:${existing.fact_id}`);
            return { inserted: false, persisted: true, factId: existing.fact_id, decision: existing.decision, xp: xpRow?.xp ?? 0, pm: mvRow?.amount ?? 0,
                xpEntryId: xpRow?.entry_id ?? null, movementId: mvRow?.movement_id ?? null };
        }
        const active = getActiveRuleSet(db, now);
        if (!active) throw bad('NO_ACTIVE_RULES', 'no hay reglas vigentes');
        // D48: un hecho sin emisión no deja fila y volverá a evaluarse; una regla
        // posterior no puede premiarlo con efecto retroactivo.
        const prospective = occurredAt >= active.effectiveFrom;
        const d = decideEmission({ rules: active.rules, source, factType, eligibility: prospective ? 'eligible' : 'observe',
            features: features || {}, xpEnabled, pmEnabled, usage: earnedUsage(db, subject?.subject_ref, source, now) });
        if (d.xp === 0 && d.pm === 0) return noRow(d.decision);
        const day = periodsFor(now).day;
        subject ??= ensureSubject(db, userId, { roleClass: 'reader', day });
        const subjectRef = subject.subject_ref;
        const actorRef = actorId === null ? null : ensureSubject(db, actorId, { roleClass: 'actor', day }).subject_ref;
        const at = dayStart(now);
        const factId = randomId();
        db.prepare(`
            INSERT INTO gm_source_facts (fact_id, source, source_event_id, fact_type, subject_ref, actor_ref, occurred_at,
                recorded_at, grade, decision, rule_version, features_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(factId, source, deriveSourceKey(subject, source, factType, sourceEventId), factType, subjectRef, actorRef, dayStart(occurredAt), at,
            d.grade, d.decision, active.ruleVersion, featuresJson);
        let xpEntryId = null;
        let movementId = null;
        if (d.xp > 0) {
            xpEntryId = randomId();
            db.prepare("INSERT INTO gm_xp_entries VALUES (?, ?, 'award', ?, ?, NULL, ?, ?)").run(xpEntryId, subjectRef, d.xp, factId, active.ruleVersion, at);
        }
        if (d.pm > 0) {
            movementId = insertMovement(db, { subjectRef, kind: 'earn', amount: d.pm, source, idempotencyKey: `fact:${factId}`,
                factId, reasonCode: `${source}.${factType}`.slice(0, MAX_ID), actorRef: 'system', ruleVersion: active.ruleVersion, createdAt: now });
        }
        return { inserted: true, persisted: true, factId, decision: d.decision, xp: d.xp, pm: d.pm, xpEntryId, movementId };
    }).immediate();
}

/** ¿Ya existe este hecho? Solo lectura, para el barrido de reconciliación. */
export function hasFact(db, { source, sourceEventId, factType, userId }) {
    const subject = findSubject(db, userId);
    if (!subject) return false;
    return !!db.prepare('SELECT 1 FROM gm_source_facts WHERE source = ? AND source_event_id = ? AND fact_type = ?')
        .get(source, deriveSourceKey(subject, source, factType, sourceEventId), factType);
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
    getSubjectKey();
    return db.transaction(() => {
        requireRuleVersion(db, ruleVersion);
        const day = periodsFor(now).day;
        const subjectRef = ensureSubject(db, userId, { roleClass: 'reader', day }).subject_ref;
        const actorRef = ensureSubject(db, actorId, { roleClass: 'actor', day }).subject_ref;
        const key = `adj:${actorRef}:${idempotencyKey}`;
        const replay = replayOrConflict(db, key, { subject_ref: subjectRef, kind: 'adjustment', amount, reason_code: reasonCode });
        if (replay) return replay;
        if (relatedMovementId !== null) {
            const rel = db.prepare('SELECT subject_ref FROM gm_pm_movements WHERE movement_id = ?').get(relatedMovementId);
            if (!rel || rel.subject_ref !== subjectRef) throw bad('INVALID_RELATED_MOVEMENT');
        }
        const bal = db.prepare('SELECT available FROM gm_pm_balances WHERE subject_ref = ?').get(subjectRef);
        if ((bal?.available ?? 0) + amount < 0) throw bad('INSUFFICIENT_BALANCE', 'un ajuste no puede dejar el saldo negativo');
        const movementId = insertMovement(db, { subjectRef, kind: 'adjustment', amount, source: 'admin', idempotencyKey: key,
            relatedMovementId, reasonCode, actorRef, ruleVersion, createdAt: now });
        db.prepare("INSERT INTO gm_admin_audit VALUES (?, ?, 'adjustment', ?, ?, ?)").run(randomId(), actorRef, subjectRef, movementId, dayStart(now));
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
    getSubjectKey();
    const key = `comp:${relatedMovementId}:${idempotencyKey}`;
    return db.transaction(() => {
        requireRuleVersion(db, ruleVersion);
        const subject = findSubject(db, userId);
        if (!subject) throw bad('INVALID_RELATED_MOVEMENT');
        const subjectRef = subject.subject_ref;
        const replay = replayOrConflict(db, key, { subject_ref: subjectRef, kind: 'compensation', amount, reason_code: reasonCode });
        if (replay) return replay;
        const rel = db.prepare('SELECT subject_ref FROM gm_pm_movements WHERE movement_id = ?').get(relatedMovementId);
        if (!rel || rel.subject_ref !== subjectRef) throw bad('INVALID_RELATED_MOVEMENT');
        const actorRef = ensureSubject(db, actorId, { roleClass: 'actor', day: periodsFor(now).day }).subject_ref;
        const movementId = insertMovement(db, { subjectRef, kind: 'compensation', amount, source: 'admin', idempotencyKey: key,
            relatedMovementId, reasonCode, actorRef, ruleVersion, createdAt: now });
        return { inserted: true, movementId };
    }).immediate();
}

// ── Consultas ───────────────────────────────────────────────────────────────

export function getBalance(db, userId) {
    const ref = findSubject(db, userId)?.subject_ref;
    const row = ref && db.prepare('SELECT available, reserved, lifetime_earned, last_seq FROM gm_pm_balances WHERE subject_ref = ?').get(ref);
    return row
        ? { available: row.available, reserved: row.reserved, lifetimeEarned: row.lifetime_earned, lastSeq: row.last_seq }
        : { available: 0, reserved: 0, lifetimeEarned: 0, lastSeq: 0 };
}

export function listMovements(db, userId, { afterSeq = 0, limit = 50 } = {}) {
    const n = Math.min(Math.max(1, limit | 0), 200);
    return db.prepare(`
        SELECT seq, movement_id AS movementId, kind, amount, source, reason_code AS reasonCode, created_at AS createdAt
        FROM gm_pm_movements WHERE subject_ref = ? AND seq > ? ORDER BY seq LIMIT ?
    `).all(findSubject(db, userId)?.subject_ref ?? '', afterSeq, n);
}

/** XP total: asientos `award` no anulados (P1: el XP nunca se gasta). */
export function getXp(db, userId) {
    return db.prepare(`
        SELECT COALESCE(SUM(a.xp), 0) AS xp FROM gm_xp_entries a
        WHERE a.subject_ref = ? AND a.kind = 'award'
          AND NOT EXISTS (SELECT 1 FROM gm_xp_entries v WHERE v.kind = 'void' AND v.voids_entry_id = a.entry_id)
    `).get(findSubject(db, userId)?.subject_ref ?? '').xp;
}

const COMPUTED_SQL = `
    SELECT m.subject_ref,
           SUM(m.amount) AS available,
           COALESCE(SUM(CASE WHEN m.kind = 'earn' THEN m.amount END), 0) AS lifetime_earned,
           COALESCE((SELECT SUM(-r.amount) FROM gm_pm_movements r JOIN gm_redemptions d ON d.redemption_id = r.redemption_id
                     WHERE r.subject_ref = m.subject_ref AND r.kind = 'reserve' AND d.state IN ('RESERVED','DELIVERED')), 0) AS reserved,
           MAX(m.seq) AS last_seq
    FROM gm_pm_movements m GROUP BY m.subject_ref`;

/**
 * Verifica (solo lectura) que el snapshot coincide con el ledger para todos
 * los usuarios, y que no hay snapshots sin movimientos.
 */
export function verifyLedger(db) {
    const computed = new Map(db.prepare(COMPUTED_SQL).all().map((r) => [r.subject_ref, r]));
    const snapshots = db.prepare('SELECT * FROM gm_pm_balances').all();
    const divergences = [];
    for (const s of snapshots) {
        const c = computed.get(s.subject_ref);
        if (!c || c.available !== s.available || c.reserved !== s.reserved || c.lifetime_earned !== s.lifetime_earned || c.last_seq !== s.last_seq) {
            divergences.push({ subjectRef: s.subject_ref, snapshot: s, computed: c ?? null });
        }
        computed.delete(s.subject_ref);
    }
    for (const [subjectRef, c] of computed) divergences.push({ subjectRef, snapshot: null, computed: c });
    return { ok: divergences.length === 0, users: snapshots.length, divergences };
}

/** Reconstruye todos los snapshots desde el ledger (recuperación, ADR §7). */
export function rebuildBalances(db, { now = Date.now() } = {}) {
    return db.transaction(() => {
        const rows = db.prepare(COMPUTED_SQL).all();
        const up = db.prepare(`
            INSERT INTO gm_pm_balances (subject_ref, available, reserved, lifetime_earned, last_seq, updated_at)
            VALUES (@subject_ref, @available, @reserved, @lifetime_earned, @last_seq, @now)
            ON CONFLICT(subject_ref) DO UPDATE SET available = excluded.available, reserved = excluded.reserved,
                lifetime_earned = excluded.lifetime_earned, last_seq = excluded.last_seq, updated_at = excluded.updated_at
        `);
        for (const r of rows) up.run({ ...r, now: dayStart(now) });
        return { users: rows.length };
    }).immediate();
}
