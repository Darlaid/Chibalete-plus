/**
 * ledger.mjs — CHP-GAMIFICACION-G3-01.
 *
 * Primitivas transaccionales internas del ledger (GAMIFICACION_MODELO_DATOS_V1).
 * Sin rutas HTTP ni ganchos de origen: nadie del producto llama todavía aquí.
 *
 * Reglas que este módulo hace cumplir (además de los CHECK/UNIQUE/triggers):
 *  - toda escritura va en `BEGIN IMMEDIATE` (serializa las dos réplicas);
 *  - un hecho `(source, source_event_id, fact_type)` se registra una sola vez;
 *    su emisión de XP ocurre en la MISMA transacción, así que un reintento
 *    no emite dos veces;
 *  - el llamador NUNCA fija montos, grado ni decisión: los decide
 *    `policy.mjs` con las reglas vigentes, en la misma transacción;
 *  - solo se emite desde evidencia de grado A/B; la lectura terminada sigue en
 *    observación (READING_EMISSION_LOCKED) hasta que G4 apruebe su validador;
 *  - V8-UNIFIED-XP-01: XP es la ÚNICA escala. Los Puntos de Magia (PM) están
 *    retirados: este módulo no escribe ni expone movimientos, saldos, canjes ni
 *    ajustes. Sus tablas siguen en el esquema solo por compatibilidad: no se
 *    borran ni migran filas antiguas, y ninguna ruta de código las escribe;
 *  - PRIV-01B: el ledger no guarda identidad. La API recibe `userId` y lo resuelve
 *    con `subjects.mjs`; solo se escriben `subject_ref` y claves HMAC, ids sin
 *    tiempo y fechas con precisión de día. Un hecho que no emite no deja fila;
 *  - la clave de sujeto es obligatoria: sin ella no se registra nada;
 *  - PRIV-01D: sin registro de exclusiones válido no se escribe nada, y una
 *    persona excluida no vuelve a tener sujeto;
 *
 *  - V8.1-CLOSE-06A (G-01): ningún XP sin A1 concedida, verificada y vigente, con
 *    fecha del acto ≤ el día del hecho (`a1Gate`). Es la puerta común de escritura:
 *    barrido, gancho de revisión y cualquier fuente pasan por aquí. Sin registro
 *    de decisiones verificable, nada se emite. La consulta no cambia;
 *
 * No importa nada de server/royalties/ ni escribe otro store (P6).
 */
import crypto from 'node:crypto';
import { GamificationError, isXpEarningEnabled } from './db.mjs';
import { ELIGIBILITY, SOURCE_GRADE, XP_LOCKED_SOURCES, decideEmission, isEmissionLocked, validateRules } from './policy.mjs';
import { WORK_CYCLE_ACTS, decideRecognition, hasRetiredPm, validateApprovedRecognition } from './recognition.mjs';
import { exclusionGate } from './exclusions.mjs';
import { deriveSourceKey, deriveWorkKey, ensureSubject, findSubject, isExcluded } from './subjects.mjs';
import { getSubjectKey } from './subjectKey.mjs';
import { a1Gate } from '../privacy/a2Registry.mjs';

export const FACT_SOURCES = Object.freeze(Object.keys(SOURCE_GRADE));
/** Decisiones que puede contener `gm_source_facts`. `capped` solo en filas anteriores a V8-UNIFIED-XP-01 (topes de PM). */
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

const MAX_ID = 128;
const MAX_FEATURE_STRING = 64;
const ID_RX = /^[A-Za-z0-9._:@-]+$/;
const BOGOTA_OFFSET_MS = 5 * 3_600_000; // UTC−5, sin horario de verano

const bad = (code, message) => new GamificationError(code, message);
/** G-01: `a1` es la puerta del lote (como `gate`); sin ella se lee el registro. Registro no verificable ⇒ no. */
function a1Allows(a1, env, now, userId, atMs) {
    let g = a1;
    if (!g) { try { g = a1Gate(env, now); } catch { return false; } }
    return g.allowsAt(userId, atMs) === true;
}
const isId = (s) => typeof s === 'string' && s.length > 0 && s.length <= MAX_ID && ID_RX.test(s);
const isInt = (n) => Number.isSafeInteger(n);
const randomId = () => crypto.randomUUID();
/** Inicio del día en Bogotá: la única precisión temporal que se persiste. */
const dayStart = (ms) => Math.floor((ms - BOGOTA_OFFSET_MS) / 86_400_000) * 86_400_000 + BOGOTA_OFFSET_MS;

/** Periodos en America/Bogota (fecha de día que se persiste): `YYYY-MM-DD` y semana ISO `YYYY-Www`. */
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

/** Conjunto de reglas vigente en `now` (D48: el más reciente ya en vigor). */
export function getActiveRuleSet(db, now = Date.now()) {
    const row = db.prepare(`SELECT rule_version, rules_json, effective_from FROM gm_rule_sets WHERE effective_from <= ?
        ORDER BY effective_from DESC, created_at DESC, rule_version DESC LIMIT 1`).get(now);
    return row ? { ruleVersion: row.rule_version, rules: JSON.parse(row.rules_json), effectiveFrom: row.effective_from } : null;
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/**
 * Registra un conjunto de reglas (append-only, prospectivo D48), validado por
 * la política. Solo XP: una regla con PM se rechaza (`PM_RETIRED`). Idempotente
 * si el contenido coincide.
 */
export function createRuleSet(db, { ruleVersion, rules, createdBy, effectiveFrom, now = Date.now() }) {
    if (!isId(ruleVersion)) throw bad('INVALID_RULE_VERSION');
    if (!isId(createdBy)) throw bad('INVALID_ACTOR');
    validateRules(rules, { featureAllowlist: FEATURE_ALLOWLIST });
    if (rules.recognition !== undefined && hasRetiredPm(rules.recognition)) {
        throw bad('PM_RETIRED', 'recognition: los Puntos de Magia están retirados (amounts.pm, reread.pmFactors)');
    }
    if (rules.recognition !== undefined && !validateApprovedRecognition(rules.recognition).ok) {
        throw bad('INVALID_RULES', `recognition: ${validateApprovedRecognition(rules.recognition).errors.join(',')}`);
    }
    // Revisión y ruta comparten clave con `recordFact`: pagarlas por `facts` esquivaría el techo por obra.
    if (rules.recognition !== undefined && Object.entries(rules.facts ?? {}).some(([k, r]) => /^mook_(review|experience)\//.test(k) && (r.xp ?? 0) > 0)) {
        throw bad('RECOGNITION_RULE_CONFLICT', 'con recognition, MOOK no paga por facts');
    }
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
 * elegibilidad; el grado (por fuente), la decisión y el XP los fija la
 * política con las reglas VIGENTES, dentro de la misma transacción `IMMEDIATE`.
 * Un reintento del mismo hecho devuelve el registro original sin emitir.
 *
 * @param {object} fact  source, sourceEventId, factType, userId, actorId?, occurredAt, eligibility, features?, now?
 * @param {{ env?: object }} [opts]  `XP_EARNING_ENABLED` se lee aquí, por llamada
 * @returns {{ inserted: boolean, persisted: boolean, factId: string|null, decision: string, xp: number, xpEntryId: string|null }}
 */
export function recordFact(db, fact, { env = process.env, gate = null, a1 = null } = {}) {
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

    // PRIV-01C: lo que no puede emitir no toma el lock de escritura. Un barrido
    // reevalúa estos hechos cada vez, porque no dejan fila.
    const noRow = (decision) => ({ inserted: false, persisted: false, factId: null, decision, xp: 0, xpEntryId: null });
    if (effectiveEligibility !== 'eligible') return noRow(effectiveEligibility === 'observe' ? 'observed' : effectiveEligibility);
    if (isEmissionLocked(source)) return noRow('observed');

    getSubjectKey(); // sin clave no se evalúa nada: nunca se escribe una fila que no se pueda deduplicar
    if (!xpEnabled) return noRow('disabled_source');
    const open = gate ?? exclusionGate(db, env);
    if (open.excludes(userId) || (actorId !== null && open.excludes(actorId))) return noRow('rejected_excluded_user');
    if (!a1Allows(a1, env, now, userId, occurredAt)) return noRow('rejected_not_eligible');

    return db.transaction(() => {
        // La puerta se leyó fuera de la transacción: esta comprobación cierra la
        // carrera con una exclusión simultánea en otra réplica.
        if (isExcluded(db, userId) || (actorId !== null && isExcluded(db, actorId))) return noRow('rejected_excluded_user');
        let subject = findSubject(db, userId);
        const existing = subject && db.prepare('SELECT * FROM gm_source_facts WHERE source = ? AND source_event_id = ? AND fact_type = ?')
            .get(source, deriveSourceKey(subject, source, factType, sourceEventId), factType);
        if (existing) {
            const xpRow = db.prepare("SELECT entry_id, xp FROM gm_xp_entries WHERE fact_id = ? AND kind = 'award'").get(existing.fact_id);
            return { inserted: false, persisted: true, factId: existing.fact_id, decision: existing.decision, xp: xpRow?.xp ?? 0,
                xpEntryId: xpRow?.entry_id ?? null };
        }
        const active = getActiveRuleSet(db, now);
        if (!active) throw bad('NO_ACTIVE_RULES', 'no hay reglas vigentes');
        // D48: un hecho sin emisión no deja fila y volverá a evaluarse; una regla
        // posterior no puede premiarlo con efecto retroactivo.
        const prospective = occurredAt >= active.effectiveFrom;
        const d = decideEmission({ rules: active.rules, source, factType, eligibility: prospective ? 'eligible' : 'observe',
            features: features || {}, xpEnabled });
        if (d.xp === 0) return noRow(d.decision);
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
        const xpEntryId = randomId();
        db.prepare("INSERT INTO gm_xp_entries VALUES (?, ?, 'award', ?, ?, NULL, ?, ?)").run(xpEntryId, subjectRef, d.xp, factId, active.ruleVersion, at);
        return { inserted: true, persisted: true, factId, decision: d.decision, xp: d.xp, xpEntryId };
    }).immediate();
}

export const REVIEW_SOURCE = 'mook_review';
export const REVIEW_FACT = 'evidence_reviewed';

/**
 * Historial de una obra de un sujeto, tal como lo usa `decideRecognition`.
 * Solo lectura. G4-UX-U2: lo comparte el progreso visible, para proyectar
 * con la misma entrada que el escritor.
 */
export function workCycleHistory(db, subjectRef, workKey) {
    return db.prepare(`SELECT c.fact_id AS evidenceId, c.work_key AS workRef, c.cycle, c.act, c.xp, f.occurred_at AS at
            FROM gm_work_cycles c JOIN gm_source_facts f USING (fact_id) WHERE c.subject_ref = ? AND c.work_key = ?`).all(subjectRef, workKey);
}

/**
 * G4-05A-4. Registra una evidencia MOOK ya atribuida: hecho, XP y actos por obra y
 * ciclo, juntos en una transacción `IMMEDIATE`. Una fila aquí es definitiva: el
 * hecho ocupa su clave para siempre, así que **solo se escribe si se emite XP**.
 *
 * Sin escritura, y con la clave libre, si:
 *  - `XP_EARNING_ENABLED` está apagado;
 *  - `mook_review` está en `XP_LOCKED_SOURCES` (interruptor de código: hoy fuera, V8-ACTIVATE-PREP-01);
 *  - la regla activa no trae `recognition` aprobado y completo;
 *  - no queda XP que emitir para esta evidencia.
 *
 * Solo XP (la columna heredada `gm_work_cycles.pm` se escribe siempre a 0). Actos, ciclo e importes los decide `decideRecognition` con la
 * regla vigente; el llamador solo aporta la evidencia.
 * @param {{ evidenceId, userId, actorId, at, workRef, decision }} evidence
 * @returns {{ inserted: boolean, factId: string|null, acts: string[], xp: number, reason: string|null }}
 */
export function recordWorkRecognition(db, evidence, { env = process.env, gate = null, a1 = null, now = Date.now() } = {}) {
    const { evidenceId, userId, actorId, at, workRef, decision } = evidence ?? {};
    if (!isId(evidenceId) || !isId(userId) || !isId(actorId) || !isId(workRef) || !isInt(at) || at <= 0) throw bad('INVALID_FACT');
    const none = (reason) => ({ inserted: false, factId: null, acts: [], xp: 0, reason });
    if (!isXpEarningEnabled(env)) return none('disabled');
    if (XP_LOCKED_SOURCES.includes(REVIEW_SOURCE)) return none('source_locked');
    getSubjectKey();
    const open = gate ?? exclusionGate(db, env);
    if (open.excludes(userId) || open.excludes(actorId)) return none('subject_excluded');
    if (!a1Allows(a1, env, now, userId, at)) return none('a1_not_effective');
    return db.transaction(() => {
        if (isExcluded(db, userId) || isExcluded(db, actorId)) return none('subject_excluded');
        let subject = findSubject(db, userId);
        const keyOf = (s) => deriveSourceKey(s, REVIEW_SOURCE, REVIEW_FACT, evidenceId);
        const prior = subject && db.prepare('SELECT fact_id FROM gm_source_facts WHERE source = ? AND source_event_id = ? AND fact_type = ?')
            .get(REVIEW_SOURCE, keyOf(subject), REVIEW_FACT);
        if (prior) {
            const acts = db.prepare('SELECT act FROM gm_work_cycles WHERE fact_id = ? ORDER BY act').all(prior.fact_id).map((r) => r.act);
            return { inserted: false, factId: prior.fact_id, acts, xp: 0, reason: null };
        }
        const active = getActiveRuleSet(db, now);
        if (!active) return none('no_active_rules');
        if (!validateApprovedRecognition(active.rules.recognition).ok) return none('recognition_not_configured');
        if (at < active.effectiveFrom) return none('predates_rules');
        const workKey = subject ? deriveWorkKey(subject, workRef) : 'new-subject';
        const history = subject ? workCycleHistory(db, subject.subject_ref, workKey) : [];
        const d = decideRecognition({
            evidence: { source: REVIEW_SOURCE, userId, actorId, evidenceId, at, workRef: workKey, decision },
            subject: { exists: true, active: true, synthetic: false },
            history, config: active.rules.recognition, flags: { xpEarning: true },
        });
        if (d.outcome !== 'recognized') return none(d.reasons[0] ?? d.outcome);
        if (d.entries.some((e) => !WORK_CYCLE_ACTS.includes(e.act))) throw bad('INVALID_RECOGNITION');
        const xp = d.entries.reduce((sum, e) => sum + e.xp, 0);
        if (xp <= 0) return none('no_xp_to_emit');
        const day = periodsFor(now).day;
        subject ??= ensureSubject(db, userId, { roleClass: 'reader', day });
        const actorRef = ensureSubject(db, actorId, { roleClass: 'actor', day }).subject_ref;
        const factId = randomId();
        const stamp = dayStart(now);
        db.prepare(`INSERT INTO gm_source_facts (fact_id, source, source_event_id, fact_type, subject_ref, actor_ref, occurred_at,
            recorded_at, grade, decision, rule_version, features_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'awarded', ?, '{}')`)
            .run(factId, REVIEW_SOURCE, keyOf(subject), REVIEW_FACT, subject.subject_ref, actorRef, dayStart(at), stamp, SOURCE_GRADE[REVIEW_SOURCE], active.ruleVersion);
        db.prepare("INSERT INTO gm_xp_entries VALUES (?, ?, 'award', ?, ?, NULL, ?, ?)").run(randomId(), subject.subject_ref, xp, factId, active.ruleVersion, stamp);
        const finalKey = deriveWorkKey(subject, workRef);
        const row = db.prepare('INSERT INTO gm_work_cycles VALUES (?, ?, ?, ?, ?, ?, 0)');
        for (const e of d.entries) row.run(factId, subject.subject_ref, finalKey, e.cycle, e.act, e.xp);
        return { inserted: true, factId, acts: d.entries.map((e) => e.act), xp, reason: null };
    }).immediate();
}

/** ¿Ya existe este hecho? Solo lectura, para el barrido de reconciliación. */
export function hasFact(db, { source, sourceEventId, factType, userId }) {
    const subject = findSubject(db, userId);
    if (!subject) return false;
    return !!db.prepare('SELECT 1 FROM gm_source_facts WHERE source = ? AND source_event_id = ? AND fact_type = ?')
        .get(source, deriveSourceKey(subject, source, factType, sourceEventId), factType);
}

// ── Consultas ───────────────────────────────────────────────────────────────

/** XP total: asientos `award` no anulados (P1: el XP nunca se gasta). */
export function getXp(db, userId) {
    return db.prepare(`
        SELECT COALESCE(SUM(a.xp), 0) AS xp FROM gm_xp_entries a
        WHERE a.subject_ref = ? AND a.kind = 'award'
          AND NOT EXISTS (SELECT 1 FROM gm_xp_entries v WHERE v.kind = 'void' AND v.voids_entry_id = a.entry_id)
    `).get(findSubject(db, userId)?.subject_ref ?? '').xp;
}
