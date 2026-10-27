/**
 * closesStore.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / V1.4 U4 · F4-B-01.
 *
 * Cierres mensuales y acumulados trimestrales en `royalties.db` (migración
 * 0004: rule_sets, period_inputs, closes, adjustments; todas solo inserciones).
 * Plan V1.1 §3.1 y §6.6.
 *
 * - El cierre calcula él mismo la vista previa (U2) y la liquidación (U3) con
 *   las entradas que recibe; no acepta importes ya calculados desde fuera.
 * - Snapshot = JSON canónico (claves ordenadas, sin `generatedAt`) con reglas,
 *   INS y soporte, políticas, versiones de derechos, titulares, U2, U3 y los
 *   traslados de saldo que entran. sha256 del texto guardado ⇒ integridad;
 *   recalcular con las mismas entradas ⇒ el mismo hash.
 * - Un cierre por periodo (UNIQUE). `technical` no autoriza pagos ni causación;
 *   `official` exige una referencia de autorización. Ninguno ejecuta pagos: el
 *   pago se REGISTRA como movimiento. `simulate` calcula sin guardar.
 * - Movimientos posteriores en `adjustments`; el cierre nunca se modifica. Los
 *   saldos (cobrable, retenido, pagado, trasladado, pendiente) se derivan del
 *   snapshot + movimientos y concilian al peso con la BRD.
 * - Retenidos y pendientes (D1, D4, D5) nunca se presentan como cobrables; solo
 *   un movimiento explícito, con motivo, puede asignarlos.
 * - Sin datos de lectores: U2 y U3 ya entregan solo agregados.
 */
import crypto from 'node:crypto';

import { getRoyaltiesDb, PublisherError } from './publishersStore.mjs';
import { computePeriodPreview, monthBounds } from './periodPreview.mjs';
import { computeSettlement } from './settlement.mjs';
import { ulid } from '../ulid.js';

export const CLOSE_SCHEMA = 'chp-royalties-close-v1';
export const CLOSE_MODES = Object.freeze(['technical', 'official']);
/**
 * D1 · política PROVISIONAL de Dirección (U4): reparto de MontoObra entre
 * versiones por número de sesiones cualificadas (Q). Identificada y versionada;
 * no es la regla contractual definitiva. Cambiarla = nuevo `id`.
 */
export const D1_PROVISIONAL_POLICY = Object.freeze({
    id: 'D1-PROV-2026-10-v1', versionSplit: 'proportional_q', status: 'provisional',
    basis: 'número de sesiones cualificadas (Q) por versión', source: 'Dirección, V1.4 U4 · F4-B-01',
});
const MOVEMENT_SOURCES = Object.freeze({
    adjustment: ['none', 'pending_version_split', 'pending_alpha_complement', 'pending_bgp_without_holders'],
    retention: ['none'],
    release: ['holder_retained', 'unattributed_retained'],
    payment_recorded: ['none'],
    balance_transfer: ['none'],
});
const PENDING_KEY = { pending_version_split: 'versionSplit', pending_alpha_complement: 'alphaComplement', pending_bgp_without_holders: 'bgpWithoutHolders' };
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const bad = (code, message, status = 400) => new PublisherError(status, code, message);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/** JSON canónico: claves ordenadas en todos los niveles, sin `undefined`. */
export function canonicalJson(v) {
    if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canonicalJson(x))).join(',')}]`;
    if (v && typeof v === 'object') {
        return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
}

// ── rule_sets y period_inputs ───────────────────────────────────────────────

/** Registra el rule_set si no existe. Mismo id con otros parámetros ⇒ error (cambiar = versión nueva). */
export function ensureRuleSet(ruleSet, { now = new Date().toISOString(), db = getRoyaltiesDb() } = {}) {
    const params = canonicalJson(ruleSet);
    const hash = sha256(params);
    const row = db.prepare('SELECT params_sha256 FROM rule_sets WHERE id = ?').get(ruleSet.id);
    if (row) {
        if (row.params_sha256 !== hash) throw bad('rule_set_conflict', `El rule_set ${ruleSet.id} ya existe con otros parámetros`, 409);
        return { id: ruleSet.id, paramsSha256: hash, created: false };
    }
    db.prepare('INSERT INTO rule_sets (id, params, params_sha256, created_at) VALUES (?, ?, ?, ?)').run(ruleSet.id, params, hash, now);
    return { id: ruleSet.id, paramsSha256: hash, created: true };
}

const inputToApi = (r) => r && ({ id: r.id, period: r.period, grossCop: r.gross_cop, deductionsCop: r.deductions_cop, insCop: r.ins_cop,
    supportRef: r.support_ref, notes: r.notes, createdBy: r.created_by, createdAt: r.created_at });

/** INS del periodo (P11): recaudo elegible − deducciones, con su soporte. Solo inserciones: corregir = fila nueva. */
export function recordPeriodInput(input, { actor, now = new Date().toISOString(), db = getRoyaltiesDb() }) {
    const { period, grossCop, deductionsCop, supportRef, notes = null } = input || {};
    if (!MONTH_RE.test(String(period || ''))) throw bad('invalid_period', 'period debe ser YYYY-MM');
    for (const [k, v] of [['grossCop', grossCop], ['deductionsCop', deductionsCop]]) {
        if (!Number.isSafeInteger(v) || v < 0) throw bad('invalid_amount', `${k} debe ser un entero de COP ≥ 0`);
    }
    if (deductionsCop > grossCop) throw bad('invalid_amount', 'Las deducciones superan el recaudo');
    if (typeof supportRef !== 'string' || !supportRef.trim() || supportRef.length > 300) throw bad('support_required', 'El soporte del INS es obligatorio');
    if (!actor) throw bad('actor_required', 'actor requerido');
    const id = ulid();
    db.prepare(`INSERT INTO period_inputs (id, period, gross_cop, deductions_cop, ins_cop, support_ref, notes, created_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, period, grossCop, deductionsCop, grossCop - deductionsCop, supportRef.trim(), notes, actor, now);
    return getPeriodInput(id, db);
}

export function getPeriodInput(id, db = getRoyaltiesDb()) {
    return inputToApi(db.prepare('SELECT * FROM period_inputs WHERE id = ?').get(id));
}

export function listPeriodInputs(period, db = getRoyaltiesDb()) {
    return db.prepare('SELECT * FROM period_inputs WHERE period = ? ORDER BY created_at, id').all(period).map(inputToApi);
}

// ── cierre ──────────────────────────────────────────────────────────────────

const freezeVersion = (v) => ({ id: v.id, contentId: v.contentId, versionNo: v.versionNo, publisherId: v.publisherId, actRef: v.actRef,
    actSignedOn: v.actSignedOn, validFrom: v.validFrom, validUntil: v.validUntil ?? null, effectiveAt: v.effectiveAt,
    legalStatus: v.legalStatus, economicStatus: v.economicStatus, settlementClass: v.settlementClass, alpha: v.alpha ?? null,
    expectedMinutes: v.expectedMinutes ?? null, shares: v.shares || [], permissions: v.permissions || {} });
const freezePublisher = (p) => ({ id: p.id, kind: p.kind ?? null, legalName: p.legalName ?? null, tradeName: p.tradeName ?? null, status: p.status ?? null });
const withoutGeneratedAt = ({ generatedAt, ...rest }) => rest; // eslint-disable-line no-unused-vars

/**
 * Cálculo puro del cierre (sin base): U2 → U3 → snapshot canónico + hash.
 * @param {object} p  month, mode, ruleSet, periodInput, carriedIn, holds y las entradas de U2
 *                    (rows, contents, versionsByContent, publisherHistoryByContent, publishersById, excludedUsers, clock)
 */
export function buildCloseSnapshot(p) {
    if (!CLOSE_MODES.includes(p.mode)) throw bad('invalid_mode', 'mode debe ser technical u official');
    const b = monthBounds(p.month);
    if (!p.periodInput || p.periodInput.period !== b.month) throw bad('period_input_mismatch', 'El INS no corresponde al periodo');
    const publishersById = p.publishersById || new Map();
    const versionsByContent = p.versionsByContent || new Map();
    const preview = computePeriodPreview({ rows: p.rows || [], month: b.month, ruleSet: p.ruleSet, clock: p.clock, contents: p.contents,
        versionsByContent, publisherHistoryByContent: p.publisherHistoryByContent, publishersById, excludedUsers: p.excludedUsers, generatedAt: null });
    const settlement = computeSettlement(preview, { ins: { amountCop: p.periodInput.insCop, ref: p.periodInput.id }, ruleSet: p.ruleSet,
        policies: { versionSplit: D1_PROVISIONAL_POLICY.versionSplit }, holds: p.holds || [], publishersById, generatedAt: null });
    const workIds = preview.works.map((w) => w.contentId);
    const refIds = new Set();
    for (const id of workIds) for (const v of versionsByContent.get(id) || []) { refIds.add(v.publisherId); (v.shares || []).forEach((s) => refIds.add(s.publisherId)); }
    for (const w of preview.works) if (w.responsiblePublisherId) refIds.add(w.responsiblePublisherId);
    for (const h of settlement.holders) refIds.add(h.publisherId);
    const carriedIn = [...(p.carriedIn || [])].map((m) => ({ id: m.id, fromCloseId: m.closeId, fromPeriod: m.fromPeriod, publisherId: m.publisherId, amountCop: m.amountCop }))
        .sort((x, y) => cmpStr(x.id, y.id));
    const snapshot = {
        schema: CLOSE_SCHEMA,
        period: b.month,
        mode: p.mode,
        status: p.mode === 'official' ? 'OFFICIAL_CLOSE' : 'TECHNICAL_CLOSE',
        paymentsAuthorized: false, // un cierre nunca autoriza ni ejecuta pagos: se registran como movimientos
        ruleSet: p.ruleSet,
        periodInput: { id: p.periodInput.id, period: p.periodInput.period, grossCop: p.periodInput.grossCop, deductionsCop: p.periodInput.deductionsCop,
            insCop: p.periodInput.insCop, supportRef: p.periodInput.supportRef },
        policies: {
            D1: D1_PROVISIONAL_POLICY,
            D2: { presenceHolders: preview.trace.presenceHolders, presenceDayRule: preview.trace.presenceDayRule, source: 'U3 · F4-A-02' },
            D3: { rule: 'retain_not_exclude', source: 'U3 · F4-A-02' },
            D4: { rule: 'pending_not_payable' },
            D5: { rule: 'pending_not_payable' },
        },
        holds: [...(p.holds || [])],
        rights: workIds.flatMap((id) => (versionsByContent.get(id) || []).map(freezeVersion)).sort((x, y) => cmpStr(x.id, y.id)),
        publishers: [...refIds].sort(cmpStr).map((id) => freezePublisher(publishersById.get(id) || { id })),
        preview: withoutGeneratedAt(preview),
        settlement: withoutGeneratedAt(settlement),
        carriedIn,
    };
    const text = canonicalJson(snapshot);
    return { snapshot, text, sha256: sha256(text), preview, settlement };
}

const closeRow = (db, period) => db.prepare('SELECT * FROM closes WHERE period = ?').get(period);
const transfersInto = (db, period) => db.prepare(`SELECT a.id, a.close_id AS closeId, c.period AS fromPeriod, a.publisher_id AS publisherId, a.amount_cop AS amountCop
    FROM adjustments a JOIN closes c ON c.id = a.close_id WHERE a.kind = 'balance_transfer' AND a.target_period = ? ORDER BY a.id`).all(period);

/**
 * Cierra (o simula) un mes. `simulate: true` ⇒ nada se guarda.
 * Oficial ⇒ `authorizationRef` obligatorio. Un cierre por periodo.
 */
export function closeMonth(p, { actor, now = new Date().toISOString(), simulate = false, db = getRoyaltiesDb() }) {
    if (!actor) throw bad('actor_required', 'actor requerido');
    if (p.mode === 'official' && !(typeof p.authorizationRef === 'string' && p.authorizationRef.trim())) {
        throw bad('authorization_required', 'Un cierre oficial exige la referencia de autorización');
    }
    const run = () => {
        if (closeRow(db, p.month)) throw bad('close_exists', `El periodo ${p.month} ya está cerrado`, 409);
        const periodInput = getPeriodInput(p.periodInputId, db);
        if (!periodInput) throw bad('period_input_not_found', 'INS no encontrado');
        const built = buildCloseSnapshot({ ...p, periodInput, carriedIn: transfersInto(db, p.month) });
        if (simulate) return { simulation: true, period: p.month, snapshot: built.snapshot, snapshotSha256: built.sha256 };
        ensureRuleSet(p.ruleSet, { now, db });
        const id = ulid();
        db.prepare(`INSERT INTO closes (id, period, mode, rule_set_id, period_input_id, preview_digest, settlement_digest, snapshot, snapshot_sha256,
            authorization_ref, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, p.month, p.mode, p.ruleSet.id,
            periodInput.id, built.preview.trace.resultDigest, built.settlement.trace.resultDigest, built.text, built.sha256,
            p.mode === 'official' ? p.authorizationRef.trim() : null, actor, now);
        return getClose(p.month, db);
    };
    return simulate ? run() : db.transaction(run).immediate();
}

/** Cierre por periodo con verificación de integridad (hash del texto guardado). */
export function getClose(period, db = getRoyaltiesDb()) {
    const r = closeRow(db, period);
    if (!r) return null;
    return { id: r.id, period: r.period, mode: r.mode, ruleSetId: r.rule_set_id, periodInputId: r.period_input_id,
        previewDigest: r.preview_digest, settlementDigest: r.settlement_digest, snapshotSha256: r.snapshot_sha256,
        integrityOk: sha256(r.snapshot) === r.snapshot_sha256, authorizationRef: r.authorization_ref,
        createdBy: r.created_by, createdAt: r.created_at, snapshot: JSON.parse(r.snapshot) };
}

/** Recalcula el cierre con las mismas entradas de U2 y compara el hash. */
export function verifyCloseReproduction(period, inputs, db = getRoyaltiesDb()) {
    const c = getClose(period, db);
    if (!c) throw bad('close_not_found', 'Cierre no encontrado', 404);
    const s = c.snapshot;
    const built = buildCloseSnapshot({ ...inputs, month: period, mode: s.mode, ruleSet: s.ruleSet, holds: s.holds,
        periodInput: s.periodInput, carriedIn: s.carriedIn.map((m) => ({ id: m.id, closeId: m.fromCloseId, fromPeriod: m.fromPeriod, publisherId: m.publisherId, amountCop: m.amountCop })) });
    return { reproduced: built.sha256 === c.snapshotSha256, storedSha256: c.snapshotSha256, recomputedSha256: built.sha256, integrityOk: c.integrityOk };
}

// ── movimientos y saldos ────────────────────────────────────────────────────

const movementToApi = (r) => ({ id: r.id, closeId: r.close_id, kind: r.kind, source: r.source, publisherId: r.publisher_id, amountCop: r.amount_cop,
    targetPeriod: r.target_period, reason: r.reason, ref: r.ref, createdBy: r.created_by, createdAt: r.created_at });

export function listMovements(closeId, db = getRoyaltiesDb()) {
    return db.prepare('SELECT * FROM adjustments WHERE close_id = ? ORDER BY created_at, id').all(closeId).map(movementToApi);
}

/** Aplica un movimiento a un libro mayor en memoria; lanza si excede un saldo. */
function applyMovement(L, m) {
    const h = L.holder(m.publisherId);
    const need = (cond, msg) => { if (!cond) throw bad('insufficient_balance', msg, 409); };
    const a = m.amountCop;
    if (m.kind === 'adjustment' && m.source === 'none') { need(h.payable + a >= 0, 'El ajuste deja el saldo cobrable en negativo'); h.payable += a; h.adjustments += a; L.netAdjustments += a; return; }
    if (m.kind === 'adjustment') { const k = PENDING_KEY[m.source]; need(L.pending[k] >= a, `Excede el pendiente ${k}`); L.pending[k] -= a; h.payable += a; h.assignedFromPending += a; return; }
    if (m.kind === 'retention') { need(h.payable >= a, 'Excede el saldo cobrable'); h.payable -= a; h.retained += a; return; }
    if (m.kind === 'release' && m.source === 'holder_retained') { need(h.retained >= a, 'Excede lo retenido del titular'); h.retained -= a; h.payable += a; return; }
    if (m.kind === 'release') { need(L.unattributedRetained >= a, 'Excede lo retenido sin titular'); L.unattributedRetained -= a; h.payable += a; return; }
    if (m.kind === 'payment_recorded') { need(h.payable >= a, 'El pago registrado excede el saldo cobrable'); h.payable -= a; h.paid += a; return; }
    need(h.payable >= a, 'El traslado excede el saldo cobrable'); h.payable -= a; h.transferredOut += a; // balance_transfer
}

/** Saldos del cierre = snapshot + traslados recibidos (congelados) + movimientos. Concilia al peso con la BRD. */
export function closeLedger(period, db = getRoyaltiesDb(), extra = []) {
    const c = getClose(period, db);
    if (!c) throw bad('close_not_found', 'Cierre no encontrado', 404);
    const st = c.snapshot.settlement;
    const holders = new Map();
    const names = new Map(c.snapshot.publishers.map((p) => [p.id, p]));
    const L = {
        holder: (id) => {
            if (!holders.has(id)) holders.set(id, { publisherId: id, tradeName: names.get(id)?.tradeName ?? null, settledBase: 0, settledVariable: 0, settledTotal: 0,
                carriedIn: 0, adjustments: 0, assignedFromPending: 0, payable: 0, retained: 0, paid: 0, transferredOut: 0 });
            return holders.get(id);
        },
        pending: { ...st.destinations.pendingDecision },
        unattributedRetained: st.destinations.retained - sum(st.holders.map((h) => h.retained)),
        netAdjustments: 0,
    };
    for (const h of st.holders) Object.assign(L.holder(h.publisherId), { settledBase: h.base, settledVariable: h.variable, settledTotal: h.total, payable: h.total, retained: h.retained });
    for (const t of c.snapshot.carriedIn) { const h = L.holder(t.publisherId); h.carriedIn += t.amountCop; h.payable += t.amountCop; }
    const movements = [...listMovements(c.id, db), ...extra];
    for (const m of movements) applyMovement(L, m);
    const hs = [...holders.values()].sort((a, b) => cmpStr(a.publisherId, b.publisherId));
    for (const h of hs) h.belowPayoutThreshold = h.payable < c.snapshot.ruleSet.payoutThresholdCop;
    const carriedInTotal = sum(c.snapshot.carriedIn.map((t) => t.amountCop));
    const totals = {
        brd: st.pools.brd, carriedIn: carriedInTotal, netAdjustments: L.netAdjustments,
        payable: sum(hs.map((h) => h.payable)), retained: sum(hs.map((h) => h.retained)) + L.unattributedRetained,
        unattributedRetained: L.unattributedRetained, paid: sum(hs.map((h) => h.paid)), transferredOut: sum(hs.map((h) => h.transferredOut)),
        pending: L.pending, pendingTotal: sum(Object.values(L.pending)),
    };
    const left = totals.brd + totals.carriedIn + totals.netAdjustments;
    const right = totals.payable + totals.retained + totals.paid + totals.transferredOut + totals.pendingTotal;
    return { closeId: c.id, period: c.period, mode: c.mode, integrityOk: c.integrityOk, payoutThresholdCop: c.snapshot.ruleSet.payoutThresholdCop, holders: hs, totals, movements: movements.length,
        reconciliation: { ok: left === right, brdPlusInflows: left, destinations: right } };
}

/** Registra un movimiento posterior (nunca modifica el cierre). Valida saldos en una transacción inmediata. */
export function addMovement(input, { actor, now = new Date().toISOString(), db = getRoyaltiesDb() }) {
    const { period, kind, source = 'none', publisherId, amountCop, targetPeriod = null, reason, ref = null } = input || {};
    if (!actor) throw bad('actor_required', 'actor requerido');
    if (!MOVEMENT_SOURCES[kind]) throw bad('invalid_kind', 'Tipo de movimiento inválido');
    if (!MOVEMENT_SOURCES[kind].includes(source)) throw bad('invalid_source', `Origen ${source} no válido para ${kind}`);
    if (!Number.isSafeInteger(amountCop) || amountCop === 0 || (kind !== 'adjustment' && amountCop < 0)) throw bad('invalid_amount', 'Importe entero de COP no válido');
    if (source !== 'none' && amountCop < 0) throw bad('invalid_amount', 'Las asignaciones y liberaciones son positivas');
    if (typeof publisherId !== 'string' || !publisherId) throw bad('publisher_required', 'publisherId requerido');
    if (typeof reason !== 'string' || !reason.trim()) throw bad('reason_required', 'El motivo es obligatorio');
    return db.transaction(() => {
        const c = getClose(period, db);
        if (!c) throw bad('close_not_found', 'Cierre no encontrado', 404);
        if (!c.integrityOk) throw bad('close_integrity_failed', 'El snapshot del cierre no supera la verificación de integridad', 409);
        if (kind === 'balance_transfer') {
            if (!MONTH_RE.test(String(targetPeriod || '')) || targetPeriod <= period) throw bad('invalid_target_period', 'El traslado va a un periodo posterior');
            if (closeRow(db, targetPeriod)) throw bad('target_closed', 'El periodo de destino ya está cerrado', 409);
        } else if (targetPeriod != null) throw bad('invalid_target_period', 'Solo los traslados llevan periodo de destino');
        const m = { kind, source, publisherId, amountCop, targetPeriod };
        const ledger = closeLedger(period, db, [m]); // lanza si excede un saldo
        if (!ledger.reconciliation.ok) throw bad('reconciliation_failed', 'El movimiento rompe la conciliación', 409);
        const id = ulid();
        db.prepare(`INSERT INTO adjustments (id, close_id, kind, source, publisher_id, amount_cop, target_period, reason, ref, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, c.id, kind, source, publisherId, amountCop, targetPeriod, reason.trim(), ref, actor, now);
        return movementToApi(db.prepare('SELECT * FROM adjustments WHERE id = ?').get(id));
    }).immediate();
}

// ── acumulado trimestral ────────────────────────────────────────────────────

/** Trimestre = Σ de sus cierres (+ movimientos). Sin recalcular episodios ni leer estados actuales. */
export function quarterSummary(quarter, db = getRoyaltiesDb()) {
    const m = /^(\d{4})-Q([1-4])$/.exec(String(quarter || ''));
    if (!m) throw bad('invalid_quarter', 'quarter debe ser YYYY-Qn');
    const months = [0, 1, 2].map((i) => `${m[1]}-${String((Number(m[2]) - 1) * 3 + 1 + i).padStart(2, '0')}`);
    const ledgers = months.map((p) => (closeRow(db, p) ? closeLedger(p, db) : null));
    const present = ledgers.filter(Boolean);
    const missingMonths = months.filter((_, i) => !ledgers[i]);
    const holders = new Map();
    const FIELDS = ['settledBase', 'settledVariable', 'settledTotal', 'carriedIn', 'adjustments', 'assignedFromPending', 'payable', 'retained', 'paid', 'transferredOut'];
    for (const l of present) {
        for (const h of l.holders) {
            if (!holders.has(h.publisherId)) holders.set(h.publisherId, { publisherId: h.publisherId, tradeName: h.tradeName, ...Object.fromEntries(FIELDS.map((f) => [f, 0])) });
            const q = holders.get(h.publisherId);
            for (const f of FIELDS) q[f] += h[f];
        }
    }
    const T = (k) => sum(present.map((l) => l.totals[k]));
    const totals = { brd: T('brd'), carriedIn: T('carriedIn'), netAdjustments: T('netAdjustments'), payable: T('payable'), retained: T('retained'),
        unattributedRetained: T('unattributedRetained'), paid: T('paid'), transferredOut: T('transferredOut'), pendingTotal: T('pendingTotal'),
        pending: Object.fromEntries(['versionSplit', 'alphaComplement', 'bgpWithoutHolders'].map((k) => [k, sum(present.map((l) => l.totals.pending[k]))])) };
    const complete = missingMonths.length === 0;
    const definitive = complete && present.every((l) => l.mode === 'official');
    const hs = [...holders.values()].sort((a, b) => cmpStr(a.publisherId, b.publisherId));
    return {
        quarter, months, missingMonths, complete, definitive,
        status: !complete ? 'PROVISIONAL_INCOMPLETE' : definitive ? 'DEFINITIVE' : 'PROVISIONAL_TECHNICAL',
        closes: present.map((l) => ({ period: l.period, closeId: l.closeId, mode: l.mode, integrityOk: l.integrityOk, reconciliationOk: l.reconciliation.ok })),
        holders: hs.map((h) => ({ ...h, belowPayoutThreshold: present.length ? h.payable < present[present.length - 1].payoutThresholdCop : null })),
        totals,
        reconciliation: {
            ok: present.every((l) => l.reconciliation.ok && l.integrityOk)
                && totals.brd + totals.carriedIn + totals.netAdjustments === totals.payable + totals.retained + totals.paid + totals.transferredOut + totals.pendingTotal
                && sum(hs.map((h) => h.payable)) === totals.payable,
        },
    };
}
