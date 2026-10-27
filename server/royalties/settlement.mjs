/**
 * settlement.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / V1.4 U3 · F4-A-01.
 *
 * Liquidación PROVISIONAL de un mes como función pura: vista previa de U2
 * (`computePeriodPreview`) + INS ⇒ reparto en COP enteros por obra y titular.
 * No lee disco, no abre bases, no usa la red ni el reloj (el llamador inyecta
 * `generatedAt`). No guarda cierres ni crea obligaciones de pago: eso es F4-B.
 * No toca Q, R ni S ni recalcula episodios: los toma tal cual de U2.
 *
 * Reglas (PLAN_GENERAL_V1_1.md §6, DECISIONES_F0C.md §3):
 *   BRD = 25 % × INS; BGP = 30 % × BRD; BLC = 70 % × BRD (una sola BRD).
 *   MontoObra = BLC × S_obra / Σ S; si Σ S = 0, la BLC pasa a la BGP.
 *   Base = BGP × P_titular / Σ P (cada titular cuenta una vez). Titular =
 *   beneficiario de la matriz vigente ese día (glosario: la editorial
 *   responsable «no define quién cobra»); día = obra activa en algún momento.
 *   Variable = Σ MontoObra × alfa, repartida por la matriz (pb, suma 100 %).
 *   Retenidos (disputa, titularidad no acreditada, matriz incompleta): quedan
 *   en la liquidación como retenidos y nunca se redistribuyen. Las lecturas de
 *   versiones retenidas llegan de U2 con su S (no salen de Σ S) y la presencia
 *   de esos días se retiene para sus beneficiarios.
 *   Redondeo: COP enteros, resto mayor en cada reparto (las partes suman el todo).
 *
 * Lo que los documentos no determinan no se decide aquí (U3_F4A_02 §D):
 *   D1 reparto de MontoObra entre versiones con condiciones distintas (sin
 *      `policies.versionSplit` ⇒ pendiente);
 *   D4 destino del complemento de alfa y D5 BGP sin beneficiarios: se
 *      informan exactos como pendientes, nunca como cobrables.
 */
import crypto from 'node:crypto';
import { PREVIEW_STATUS } from './periodPreview.mjs';

export const SETTLEMENT_STATUS = 'PROVISIONAL';
export const SUPPORTED_ROUNDING = 'cop_integer_largest_remainder';
/** Candidatos documentados para las decisiones pendientes (no son valores por defecto). */
export const VERSION_SPLIT_POLICIES = Object.freeze(['proportional_q', 'proportional_seconds']);
export const HOLD_REASONS = Object.freeze(['disputed', 'economic_retained', 'title_not_proven', 'shares_incomplete']);
const RETAINED_PRESENCE = 'retained_work_presence';
/** Resolución de los pesos no enteros: fracciones (porcentajes, alfa) a 1e-6 y S a 1e-9. */
export const FRACTION_SCALE = 1_000_000;
export const SCORE_SCALE = 1_000_000_000;
const FULL_SHARE_BP = 10000;
const DAY_MS = 24 * 3600_000;

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

/**
 * Resto mayor: reparte `total` COP enteros según pesos enteros (BigInt ≥ 0).
 * Suma exacta = total. Empates de resto: gana el índice menor (orden estable de entrada).
 */
export function largestRemainder(total, weights) {
    if (!Number.isSafeInteger(total) || total < 0) throw new RangeError('total debe ser un entero ≥ 0');
    const ws = weights.map((w) => { if (typeof w !== 'bigint' || w < 0n) throw new RangeError('pesos BigInt ≥ 0'); return w; });
    const W = ws.reduce((s, w) => s + w, 0n);
    if (W === 0n) {
        if (total === 0) return ws.map(() => 0);
        throw new RangeError('no se puede repartir un importe positivo entre pesos nulos');
    }
    const T = BigInt(total);
    const floors = ws.map((w) => (T * w) / W);
    const rems = ws.map((w) => (T * w) % W);
    let left = Number(T - floors.reduce((s, f) => s + f, 0n));
    const order = ws.map((_, i) => i).sort((a, b) => (rems[b] > rems[a] ? 1 : rems[b] < rems[a] ? -1 : a - b));
    const out = floors.map(Number);
    for (const i of order) { if (left <= 0) break; out[i]++; left--; }
    return out;
}

/** Fracción en [0, 1] → entero a FRACTION_SCALE. Lanza si no es representable a esa resolución. */
function scaledFraction(x, label) {
    if (typeof x !== 'number' || !Number.isFinite(x) || x < 0 || x > 1) throw new RangeError(`${label} debe estar en [0, 1]`);
    const s = Math.round(x * FRACTION_SCALE);
    if (Math.abs(x * FRACTION_SCALE - s) > 1e-6) throw new RangeError(`${label} no es representable a 1e-6`);
    return BigInt(s);
}

/** Clave de condiciones económicas de una versión: alfa + matriz + retención (sin depender del orden). */
const termsKey = (v) => JSON.stringify([scaledFraction(v.alpha, 'alpha').toString(),
    [...v.shares].map((s) => [s.publisherId, s.shareBp]).sort((a, b) => cmpStr(a[0], b[0])), [...(v.retainedReasons || [])].sort()]);

function validateInputs(preview, o) {
    if (!preview || preview.status !== PREVIEW_STATUS || !Array.isArray(preview.works)) throw new Error('preview: se espera la salida de computePeriodPreview (U2)');
    const rs = o.ruleSet;
    if (!rs || preview.ruleSet?.id !== rs.id) throw new Error('ruleSet distinto del de la vista previa');
    if (rs.rounding !== SUPPORTED_ROUNDING) throw new Error(`redondeo no soportado: ${rs.rounding}`);
    if (rs.blcFallbackToBgp !== true) throw new Error('blcFallbackToBgp debe ser true (Doctrina)');
    const bgp = scaledFraction(rs.bgpShareOfBrd, 'bgpShareOfBrd'), blc = scaledFraction(rs.blcShareOfBrd, 'blcShareOfBrd');
    if (bgp + blc !== BigInt(FRACTION_SCALE)) throw new Error('BGP + BLC debe ser el 100 % de la BRD');
    const ins = o.ins;
    if (!ins || !Number.isSafeInteger(ins.amountCop) || ins.amountCop < 0) throw new RangeError('ins.amountCop debe ser un entero de COP ≥ 0');
    const pol = o.policies || {};
    if (pol.versionSplit != null && !VERSION_SPLIT_POLICIES.includes(pol.versionSplit)) throw new Error(`versionSplit desconocida: ${pol.versionSplit}`);
    if (pol.presenceHolder != null) throw new Error('presenceHolder ya no es una opción: los titulares de presencia son los de la matriz (U3-02)');
    for (const h of o.holds || []) {
        if (!h || !['work', 'holder'].includes(h.scope) || typeof h.id !== 'string' || !HOLD_REASONS.includes(h.reason)) {
            throw new Error('hold inválido: { scope: work|holder, id, reason }');
        }
    }
    let sumS = 0;
    for (const w of preview.works) {
        if (typeof w.S !== 'number' || !Number.isFinite(w.S) || w.S < 0) throw new Error(`S inválido en ${w.contentId}`);
        sumS += w.S;
        if (!Array.isArray(w.presenceDayList)) throw new Error(`vista previa sin presenceDayList (anterior a U3-02): ${w.contentId}`);
        if (w.S > 0) {
            if (!w.versions?.length) throw new Error(`obra con S > 0 sin versiones: ${w.contentId}`);
            if (sum(w.versions.map((v) => v.Q)) !== w.Q) throw new Error(`Q por versión no suma el Q de ${w.contentId}`);
        }
    }
    if (Math.abs(sumS - preview.totals.sumS) > 1e-9) throw new Error('totals.sumS no concuerda con las obras');
}

/**
 * @param {object} preview  salida de computePeriodPreview (U2), sin modificar
 * @param {object} o
 * @param {{amountCop:number, ref?:string}} o.ins          INS del mes (P11), COP enteros
 * @param {object} o.ruleSet                               el mismo rule_set de la vista previa
 * @param {{versionSplit?:string|null}} [o.policies]  decisión D1 de Dirección (U3_F4A_02 §D)
 * @param {Array<{scope:'work'|'holder', id:string, reason:string}>} [o.holds]  retenciones declaradas
 * @param {Map<string, {status:string}>} [o.publishersById]  titulares al liquidar (titularidad acreditada)
 * @param {string} [o.generatedAt]
 */
export function computeSettlement(preview, o) {
    validateInputs(preview, o);
    const rs = o.ruleSet;
    const pol = { versionSplit: o.policies?.versionSplit ?? null };
    const holds = [...(o.holds || [])].sort((a, b) => cmpStr(`${a.scope}:${a.id}`, `${b.scope}:${b.id}`));
    const workHold = new Map(holds.filter((h) => h.scope === 'work').map((h) => [h.id, h.reason]));
    const holderHold = new Map(holds.filter((h) => h.scope === 'holder').map((h) => [h.id, h.reason]));
    const pubs = o.publishersById || null;
    const holderIssue = (id) => holderHold.get(id) ?? (pubs && pubs.get(id)?.status !== 'active' ? 'title_not_proven' : null);

    // 1. Bolsas.
    const ins = o.ins.amountCop;
    const brdW = scaledFraction(rs.brdShareOfIns, 'brdShareOfIns');
    const [brd, insOutsideBrd] = largestRemainder(ins, [brdW, BigInt(FRACTION_SCALE) - brdW]);
    const [bgp, blc] = largestRemainder(brd, [scaledFraction(rs.bgpShareOfBrd, 'bgpShareOfBrd'), scaledFraction(rs.blcShareOfBrd, 'blcShareOfBrd')]);
    const works = [...preview.works].sort((a, b) => cmpStr(a.contentId, b.contentId));
    const scored = works.filter((w) => w.S > 0);
    const blcToBgp = scored.length === 0;
    const bgpEffective = blcToBgp ? bgp + blc : bgp;
    const blcEffective = blcToBgp ? 0 : blc;

    const holders = new Map();
    const holder = (id) => {
        if (!holders.has(id)) holders.set(id, { publisherId: id, presenceDays: 0, presenceShare: 0, base: 0, baseRetained: 0, variable: 0, variableRetained: 0, retainedReasons: {} });
        return holders.get(id);
    };
    const retainedByReason = {};
    const retain = (reason, amount) => { if (amount > 0) retainedByReason[reason] = (retainedByReason[reason] || 0) + amount; };
    let alphaComplement = 0, pendingVersionSplit = 0, bgpWithoutHolders = 0;

    // 2. Lectura cualificada: MontoObra por S, luego versiones, alfa y matriz.
    const montos = blcToBgp ? [] : largestRemainder(blcEffective, scored.map((w) => BigInt(Math.round(w.S * SCORE_SCALE))));
    const montoBy = new Map(scored.map((w, i) => [w.contentId, montos[i]]));
    const outWorks = [];
    for (const w of works) {
        const monto = montoBy.get(w.contentId) || 0;
        const ow = { contentId: w.contentId, title: w.title, Q: w.Q, R: w.R, S: w.S, montoObra: monto, status: 'none', parts: [], pendingDecision: 0, retained: 0, retainedReason: null };
        outWorks.push(ow);
        if (monto === 0) continue;
        // Versiones con las mismas condiciones económicas forman una sola parte (no hay decisión que tomar).
        const groups = new Map();
        for (const v of [...w.versions].sort((a, b) => a.versionNo - b.versionNo)) {
            const k = termsKey(v);
            if (!groups.has(k)) groups.set(k, { versionIds: [], versionNos: [], alpha: v.alpha, shares: v.shares, retainedReasons: v.retainedReasons || [], Q: 0, seconds: 0 });
            const g = groups.get(k);
            g.versionIds.push(v.versionId); g.versionNos.push(v.versionNo); g.Q += v.Q; g.seconds += v.activeSecondsQualified;
        }
        const gs = [...groups.values()];
        let amounts;
        if (gs.length === 1) amounts = [monto];
        else if (pol.versionSplit === 'proportional_q') amounts = largestRemainder(monto, gs.map((g) => BigInt(g.Q)));
        else if (pol.versionSplit === 'proportional_seconds') amounts = largestRemainder(monto, gs.map((g) => BigInt(Math.round(g.seconds))));
        else { ow.status = 'pending_decision'; ow.pendingDecision = monto; pendingVersionSplit += monto; continue; }
        ow.status = 'settled';
        if (workHold.has(w.contentId)) {
            // Importe de la obra en disputa: se retiene entero, sin aplicar alfa ni matriz.
            ow.status = 'retained'; ow.retained = monto; ow.retainedReason = workHold.get(w.contentId);
            retain(ow.retainedReason, monto);
        }
        gs.forEach((g, i) => {
            const amount = amounts[i];
            const part = { versionIds: g.versionIds, versionNos: g.versionNos, alpha: g.alpha, Q: g.Q, amount, variable: 0, alphaComplement: 0, retained: 0, retainedReason: null, shares: [] };
            ow.parts.push(part);
            if (ow.status === 'retained') return;
            if (g.retainedReasons.length) {
                // Lecturas de una versión retenida en U2 (§6.5): la parte entera queda retenida.
                part.retained = amount; part.retainedReason = g.retainedReasons.join('+');
                ow.retained += amount; retain(part.retainedReason, amount);
                return;
            }
            const a = scaledFraction(g.alpha, 'alpha');
            const [variable, rest] = largestRemainder(amount, [a, BigInt(FRACTION_SCALE) - a]);
            part.variable = variable; part.alphaComplement = rest; alphaComplement += rest;
            const bpSum = sum(g.shares.map((s) => s.shareBp));
            if (bpSum !== FULL_SHARE_BP || g.shares.some((s) => !Number.isInteger(s.shareBp) || s.shareBp <= 0)) {
                part.shares = [{ publisherId: null, shareBp: bpSum, amount: variable, status: 'retained', reason: 'shares_incomplete' }];
                retain('shares_incomplete', variable);
                return;
            }
            const sorted = [...g.shares].sort((x, y) => cmpStr(x.publisherId, y.publisherId));
            const split = largestRemainder(variable, sorted.map((s) => BigInt(s.shareBp)));
            sorted.forEach((s, j) => {
                const issue = holderIssue(s.publisherId);
                const h = holder(s.publisherId);
                if (issue) { h.variableRetained += split[j]; h.retainedReasons[issue] = (h.retainedReasons[issue] || 0) + split[j]; retain(issue, split[j]); }
                else h.variable += split[j];
                part.shares.push({ publisherId: s.publisherId, shareBp: s.shareBp, amount: split[j], status: issue ? 'retained' : 'payable', reason: issue });
            });
        });
    }

    // 3. Presencia: días con ≥1 obra activa por beneficiario (unión de días: cada titular cuenta una vez).
    //    Los días que un titular solo tiene por obras retenidas cuentan para P, y esa parte de su base se retiene.
    const daysInMonth = Math.round((Date.parse(preview.period.end) - Date.parse(preview.period.start)) / DAY_MS);
    const presence = new Map();
    const pdays = (id) => { if (!presence.has(id)) presence.set(id, { payable: new Set(), retained: new Set() }); return presence.get(id); };
    for (const w of works) {
        for (const x of w.presenceDayList) {
            if (!(x.day >= preview.period.fromDay && x.day <= preview.period.toDay)) throw new Error(`día fuera del mes en ${w.contentId}: ${x.day}`);
            for (const id of x.payable) pdays(id).payable.add(x.day);
            for (const id of x.retained) pdays(id).retained.add(x.day);
        }
    }
    const ids = [...presence.keys()].sort(cmpStr);
    const days = ids.map((id) => new Set([...presence.get(id).payable, ...presence.get(id).retained]).size);
    if (sum(days) === 0) bgpWithoutHolders = bgpEffective;
    else {
        const base = largestRemainder(bgpEffective, days.map(BigInt));
        ids.forEach((id, i) => {
            const h = holder(id);
            h.presenceDays = days[i];
            h.presenceShare = days[i] / daysInMonth;
            const onlyRetained = [...presence.get(id).retained].filter((d) => !presence.get(id).payable.has(d)).length;
            const [free, held] = largestRemainder(base[i], [BigInt(days[i] - onlyRetained), BigInt(onlyRetained)]);
            const issue = holderIssue(id);
            if (!issue) h.base += free;
            for (const [reason, amt] of issue ? [[issue, free + held]] : [[RETAINED_PRESENCE, held]]) {
                if (!amt) continue;
                h.baseRetained += amt; h.retainedReasons[reason] = (h.retainedReasons[reason] || 0) + amt; retain(reason, amt);
            }
        });
    }

    const outHolders = [...holders.values()].sort((a, b) => cmpStr(a.publisherId, b.publisherId)).map((h) => {
        const total = h.base + h.variable;
        return { ...h, retainedReasons: Object.fromEntries(Object.entries(h.retainedReasons).sort((a, b) => cmpStr(a[0], b[0]))),
            total, retained: h.baseRetained + h.variableRetained, belowPayoutThreshold: total < rs.payoutThresholdCop };
    });

    // 4. Conciliación al peso: cada bolsa = suma de sus destinos.
    const payable = sum(outHolders.map((h) => h.total));
    const retained = sum(Object.values(retainedByReason));
    const sharesTotal = sum(outWorks.flatMap((w) => w.parts.flatMap((p) => p.shares.map((s) => s.amount))));
    const variableTotal = sum(outWorks.flatMap((w) => w.parts.map((p) => p.variable)));
    const workRetained = sum(outWorks.map((w) => w.retained));
    const checks = {
        ins_eq_brd_plus_outside: ins === brd + insOutsideBrd,
        brd_eq_bgp_plus_blc: brd === bgp + blc,
        pools_after_fallback: bgpEffective + blcEffective === bgp + blc,
        blc_eq_sum_montos: blcEffective === sum(outWorks.map((w) => w.montoObra)),
        montos_eq_parts_plus_pending: sum(outWorks.map((w) => w.montoObra)) === sum(outWorks.flatMap((w) => w.parts.map((p) => p.amount))) + pendingVersionSplit,
        parts_eq_variable_complement_retained: sum(outWorks.flatMap((w) => w.parts.map((p) => p.amount))) === variableTotal + alphaComplement + workRetained,
        variable_eq_shares: variableTotal === sharesTotal,
        bgp_eq_base_destinations: bgpEffective === sum(outHolders.map((h) => h.base + h.baseRetained)) + bgpWithoutHolders,
        brd_eq_all_destinations: brd === payable + retained + pendingVersionSplit + alphaComplement + bgpWithoutHolders,
    };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);
    if (failed.length) throw new Error(`conciliación fallida: ${failed.join(', ')}`);

    const body = {
        status: SETTLEMENT_STATUS,
        binding: false,
        month: preview.month,
        currency: 'COP',
        inputs: {
            ins: { amountCop: ins, ref: o.ins.ref ?? null },
            previewDigest: preview.trace?.resultDigest ?? null,
            ruleSetId: rs.id,
            policies: pol,
            holds,
            holderStatusChecked: !!pubs,
        },
        pools: { ins, brd, insOutsideBrd, bgp, blc, blcToBgp, bgpEffective, blcEffective, sumS: preview.totals.sumS, daysInMonth },
        works: outWorks,
        holders: outHolders,
        destinations: {
            payable,
            retained,
            retainedByReason: Object.fromEntries(Object.entries(retainedByReason).sort((a, b) => cmpStr(a[0], b[0]))),
            // Pendientes de decisión (D1, D4, D5): ninguno es cobrable.
            pendingDecision: { versionSplit: pendingVersionSplit, alphaComplement, bgpWithoutHolders },
            alphaComplement,
            bgpWithoutHolders,
        },
        decisions: [
            { id: 'D1_VERSION_SPLIT', needed: outWorks.some((w) => w.status === 'pending_decision') || (pol.versionSplit != null && outWorks.some((w) => w.parts.length > 1)), policy: pol.versionSplit, amountPending: pendingVersionSplit },
            { id: 'D4_ALPHA_COMPLEMENT', needed: alphaComplement > 0, policy: null, amountPending: alphaComplement },
            { id: 'D5_BGP_WITHOUT_HOLDERS', needed: bgpWithoutHolders > 0, policy: null, amountPending: bgpWithoutHolders },
        ],
        reconciliation: { ok: true, checks },
        trace: { presenceDayRule: preview.trace?.presenceDayRule ?? null, presenceHolders: preview.trace?.presenceHolders ?? null, rounding: rs.rounding, fractionScale: FRACTION_SCALE, scoreScale: SCORE_SCALE, tieBreak: 'lower_index_in_sorted_input' },
    };
    body.trace.resultDigest = digest({ ...body, trace: undefined });
    return { ...body, generatedAt: o.generatedAt ?? null };
}
