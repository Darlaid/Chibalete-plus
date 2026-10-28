/**
 * royaltyReports.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / V1.4 U5 · REPORTES-01.
 *
 * Informes de regalías para el Panel Admin. Puro: no calcula importes. Toma lo
 * que ya produjeron U2/U3/U4 —snapshot de un cierre (o de su simulación), su
 * libro de saldos y movimientos, o el acumulado trimestral— y lo normaliza en
 * un único objeto `report`. La pantalla, el CSV y el HTML salen de ese mismo
 * objeto, identificado por `reference` (sha256 del snapshot o del trimestre):
 * nada se recalcula por separado.
 *
 * Exportación (decisión V14-1): CSV endurecido (UTF-8 con BOM, `;`, CRLF,
 * celdas de texto neutralizadas contra inyección de fórmulas) y HTML imprimible
 * (sin scripts, todo escapado) que el navegador guarda como PDF.
 * Sin datos de lectores: U2/U3/U4 solo entregan agregados por obra y titular.
 *
 * REPORTES-FILTROS-01: desglose por obra (cobrable / retenido / pendiente y
 * reparto entre titulares) leído de las participaciones ya liquidadas, sello
 * (solo en vista previa y simulación: el cierre no lo congela) y subtotales
 * filtrados por obra. Nada de esto entra en `reference`: las referencias de
 * cierre, simulación, vista previa y trimestre no cambian.
 */
import crypto from 'node:crypto';
import { canonicalJson } from './closesStore.mjs';

export const POOL_FORMULA = 'BRD = 25 % × INS; BGP = 30 % × BRD; BLC = 70 % × BRD (si Σ S = 0, la BLC pasa a la BGP); '
    + 'MontoObra = BLC × S / Σ S; Variable = MontoObra × alfa, por la matriz; Base = BGP × P / Σ P';
const sum = (xs) => xs.reduce((s, x) => s + x, 0);
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
const STATUS_LABEL = {
    PROVISIONAL: 'PROVISIONAL', TECHNICAL: 'TÉCNICO', OFFICIAL: 'OFICIAL',
    PROVISIONAL_INCOMPLETE: 'PROVISIONAL (incompleto)', PROVISIONAL_TECHNICAL: 'PROVISIONAL (cierres técnicos)', DEFINITIVE: 'DEFINITIVO',
};
const exigibleStatus = (s) => s === 'OFFICIAL' || s === 'DEFINITIVE';

const nameMap = (publishers) => new Map((publishers || []).map((p) => [p.id, p.tradeName || p.legalName || p.id]));

// Beneficiarios de una obra: matrices de sus versiones con lecturas y de sus días de presencia (U2).
const beneficiariesOf = (pw) => [...new Set([...(pw?.versions || []).flatMap((v) => v.shares.map((s) => s.publisherId)),
    ...(pw?.presenceDayList || []).flatMap((d) => [...d.payable, ...d.retained])])].sort();

/**
 * Importes de una obra liquidada (U3), sin recalcular: cobrable = participaciones
 * `payable`; retenido = obra/parte retenida + participaciones `retained`;
 * pendiente = D1 (reparto entre versiones) + D4 (complemento de alfa).
 * Identidad: payable + retained + pending = MontoObra. La Base (presencia, BGP)
 * se reparte por titular y días, no por obra: no aparece aquí.
 */
export function workAmounts(w) {
    if (w.montoObra == null) return null;
    const shares = (w.parts || []).flatMap((p) => p.shares || []);
    const byHolder = new Map();
    for (const s of shares) {
        const k = s.publisherId ?? null;
        if (!byHolder.has(k)) byHolder.set(k, { publisherId: k, payable: 0, retained: 0 });
        byHolder.get(k)[s.status === 'payable' ? 'payable' : 'retained'] += s.amount;
    }
    const pendingD4 = sum((w.parts || []).map((p) => p.alphaComplement || 0));
    return {
        payable: sum(shares.filter((s) => s.status === 'payable').map((s) => s.amount)),
        retained: (w.retained || 0) + sum(shares.filter((s) => s.status !== 'payable').map((s) => s.amount)),
        pending: (w.pendingDecision || 0) + pendingD4, pendingD1: w.pendingDecision || 0, pendingD4,
        byHolder: [...byHolder.values()].sort((a, b) => String(a.publisherId).localeCompare(String(b.publisherId))),
    };
}
const named = (a, names) => (a ? { ...a, byHolder: a.byHolder.map((h) => ({ ...h, name: h.publisherId ? (names.get(h.publisherId) ?? h.publisherId) : null })) } : null);
const addAmounts = (acc, a) => {
    if (!a) return acc;
    const out = acc || { payable: 0, retained: 0, pending: 0, pendingD1: 0, pendingD4: 0, byHolder: [] };
    for (const k of ['payable', 'retained', 'pending', 'pendingD1', 'pendingD4']) out[k] += a[k];
    for (const h of a.byHolder) {
        const x = out.byHolder.find((y) => y.publisherId === h.publisherId);
        if (x) { x.payable += h.payable; x.retained += h.retained; } else out.byHolder.push({ ...h });
    }
    out.byHolder.sort((x, y) => String(x.publisherId).localeCompare(String(y.publisherId)));
    return out;
};
// Elegibilidad económica de la obra en el mes (U2): episodios, exclusiones y avisos. No son métricas pedagógicas.
const eligibilityOf = (pw) => (pw ? {
    rightsRegime: pw.rightsRegime ?? null, eligibleDays: pw.eligibleDays ?? null,
    episodes: pw.episodes ? { total: pw.episodes.total, qualified: pw.episodes.qualified, excludedByReason: pw.episodes.excludedByReason || {} } : null,
    flags: pw.flags || [], publisherChanges: pw.publisherChanges || [],
} : null);

function worksFrom(settlementOrPreview, names, preview = settlementOrPreview) {
    const pw = new Map(preview.works.map((w) => [w.contentId, w]));
    return settlementOrPreview.works.map((w) => {
        const rp = pw.get(w.contentId)?.responsiblePublisherId ?? null;
        return {
            contentId: w.contentId, title: w.title ?? null,
            responsiblePublisherId: rp, responsibleName: names.get(rp) ?? rp,
            Q: w.Q, R: w.R, S: w.S,
            montoObra: w.montoObra ?? null, status: w.status ?? null, retained: w.retained ?? 0, pendingDecision: w.pendingDecision ?? 0,
            parts: (w.parts || []).map((p) => ({ versionNos: p.versionNos, alpha: p.alpha, Q: p.Q, amount: p.amount, variable: p.variable,
                alphaComplement: p.alphaComplement, retained: p.retained ?? 0, shares: p.shares.map((s) => ({ publisherId: s.publisherId, shareBp: s.shareBp, amount: s.amount, status: s.status })) })),
            beneficiaries: beneficiariesOf(pw.get(w.contentId)),
            amounts: settlementOrPreview === preview ? null : named(workAmounts(w), names),
            eligibility: eligibilityOf(pw.get(w.contentId)),
            imprint: null, imprintStatus: 'unknown',
        };
    });
}

/**
 * Informe mensual desde un snapshot de U4 (cierre o simulación). `ledger` solo existe si hay cierre.
 * @param {{ snapshot:object, sha256:string, close?:object|null, ledger?:object|null, movements?:object[] }} p
 */
export function monthReportFromSnapshot({ snapshot: s, sha256: ref, close = null, ledger = null, movements = [] }) {
    const names = nameMap(s.publishers);
    const st = s.settlement;
    const status = close ? (close.mode === 'official' ? 'OFFICIAL' : 'TECHNICAL') : 'PROVISIONAL';
    const byId = new Map((ledger?.holders || []).map((h) => [h.publisherId, h]));
    const holders = st.holders.map((h) => {
        const l = byId.get(h.publisherId);
        return { publisherId: h.publisherId, name: names.get(h.publisherId) ?? h.publisherId, presenceDays: h.presenceDays,
            base: h.base, variable: h.variable, settledTotal: h.total, settledRetained: h.retained,
            carriedIn: l?.carriedIn ?? 0, adjustments: l?.adjustments ?? 0, assignedFromPending: l?.assignedFromPending ?? 0,
            payable: l ? l.payable : h.total, retained: l ? l.retained : h.retained, paid: l?.paid ?? 0, transferredOut: l?.transferredOut ?? 0,
            belowPayoutThreshold: (l ? l.payable : h.total) < s.ruleSet.payoutThresholdCop };
    });
    for (const l of ledger?.holders || []) { // titulares que solo tienen traslados recibidos
        if (!holders.some((h) => h.publisherId === l.publisherId)) {
            holders.push({ publisherId: l.publisherId, name: names.get(l.publisherId) ?? l.publisherId, presenceDays: 0, base: 0, variable: 0, settledTotal: 0, settledRetained: 0,
                carriedIn: l.carriedIn, adjustments: l.adjustments, assignedFromPending: l.assignedFromPending, payable: l.payable, retained: l.retained, paid: l.paid,
                transferredOut: l.transferredOut, belowPayoutThreshold: l.payable < s.ruleSet.payoutThresholdCop });
        }
    }
    holders.sort((a, b) => (a.publisherId < b.publisherId ? -1 : a.publisherId > b.publisherId ? 1 : 0));
    const totals = ledger ? ledger.totals : {
        brd: st.pools.brd, carriedIn: 0, netAdjustments: 0, payable: st.destinations.payable, retained: st.destinations.retained,
        unattributedRetained: st.destinations.retained - sum(st.holders.map((h) => h.retained)), paid: 0, transferredOut: 0,
        pending: st.destinations.pendingDecision, pendingTotal: sum(Object.values(st.destinations.pendingDecision)),
    };
    const reconciliation = ledger ? ledger.reconciliation.ok && ledger.integrityOk : st.reconciliation.ok;
    return {
        kind: 'month', period: s.period, status, statusLabel: STATUS_LABEL[status], notExigible: !exigibleStatus(status),
        source: close ? 'close' : 'simulation',
        reference: { kind: 'snapshot_sha256', value: ref },
        closeId: close?.id ?? null, closedAt: close?.createdAt ?? null, authorizationRef: close?.authorizationRef ?? null,
        cutoff: s.preview.period.end, ruleSetId: s.ruleSet.id, scoreFormula: s.ruleSet.scoreFormula, poolFormula: POOL_FORMULA,
        policies: s.policies,
        ins: { periodInputId: s.periodInput.id, grossCop: s.periodInput.grossCop, deductionsCop: s.periodInput.deductionsCop, insCop: s.periodInput.insCop, supportRef: s.periodInput.supportRef },
        pools: st.pools,
        works: worksFrom(st, names, s.preview),
        holders,
        totals,
        movements: movements.map((m) => ({ ...m, name: names.get(m.publisherId) ?? m.publisherId })),
        rightsVersions: s.rights.map((v) => ({ id: v.id, contentId: v.contentId, versionNo: v.versionNo, actRef: v.actRef, effectiveAt: v.effectiveAt,
            legalStatus: v.legalStatus, alpha: v.alpha, shares: v.shares })),
        reconciliation: { ok: reconciliation },
    };
}

/** Mes sin INS registrado: solo Q, R y S de U2 (sin importes). */
export function monthReportFromPreview(preview, publishers) {
    const names = nameMap(publishers);
    return {
        kind: 'month', period: preview.month, status: 'PROVISIONAL', statusLabel: 'PROVISIONAL (sin INS)', notExigible: true, source: 'preview',
        reference: { kind: 'preview_digest', value: preview.trace.resultDigest },
        closeId: null, closedAt: null, authorizationRef: null, cutoff: preview.period.end, ruleSetId: preview.ruleSet.id,
        scoreFormula: preview.ruleSet.scoreFormula, poolFormula: POOL_FORMULA, policies: null, ins: null, pools: null,
        works: worksFrom(preview, names), holders: [], totals: null, movements: [], rightsVersions: [], reconciliation: { ok: true },
    };
}

/** Acumulado trimestral desde los cierres congelados (U4 `quarterSummary`) y sus snapshots. */
export function quarterReport(q, closes) {
    const names = new Map();
    const works = new Map();
    const extras = new Map(); // fuera de la referencia: desglose acumulado y editorial por mes
    const movements = [];
    for (const c of closes) {
        for (const [id, n] of nameMap(c.close.snapshot.publishers)) names.set(id, n);
        for (const w of c.close.snapshot.settlement.works) {
            const pw = c.close.snapshot.preview.works.find((x) => x.contentId === w.contentId);
            if (!works.has(w.contentId)) works.set(w.contentId, { contentId: w.contentId, title: w.title, responsiblePublisherId: pw?.responsiblePublisherId ?? null,
                Q: 0, montoObra: 0, retained: 0, pendingDecision: 0, months: [], beneficiaries: new Set() });
            const a = works.get(w.contentId);
            a.Q += w.Q; a.montoObra += w.montoObra; a.retained += w.retained; a.pendingDecision += w.pendingDecision;
            a.months.push({ period: c.close.period, Q: w.Q, R: w.R, S: w.S, montoObra: w.montoObra });
            beneficiariesOf(pw).forEach((id) => a.beneficiaries.add(id));
            const e = extras.get(w.contentId) || { amounts: null, publishers: new Set() };
            e.amounts = addAmounts(e.amounts, workAmounts(w));
            e.publishers.add(pw?.responsiblePublisherId ?? null);
            extras.set(w.contentId, e);
        }
        for (const m of c.movements) movements.push({ ...m, period: c.close.period });
    }
    const status = q.status;
    const body = {
        kind: 'quarter', period: q.quarter, status, statusLabel: STATUS_LABEL[status], notExigible: !exigibleStatus(status), source: 'quarter_closes',
        months: q.months, missingMonths: q.missingMonths, complete: q.complete, definitive: q.definitive,
        closes: q.closes.map((c) => ({ ...c, snapshotSha256: closes.find((x) => x.close.period === c.period)?.close.snapshotSha256 ?? null })),
        scoreFormula: closes[0]?.close.snapshot.ruleSet.scoreFormula ?? null, poolFormula: POOL_FORMULA,
        ruleSetIds: [...new Set(closes.map((c) => c.close.snapshot.ruleSet.id))],
        works: [...works.values()].map((w) => ({ ...w, responsibleName: names.get(w.responsiblePublisherId) ?? w.responsiblePublisherId, beneficiaries: [...w.beneficiaries].sort() }))
            .sort((a, b) => (a.contentId < b.contentId ? -1 : 1)),
        holders: q.holders.map((h) => ({ ...h, name: names.get(h.publisherId) ?? h.tradeName ?? h.publisherId })),
        totals: q.totals,
        movements: movements.map((m) => ({ ...m, name: names.get(m.publisherId) ?? m.publisherId })),
        reconciliation: { ok: q.reconciliation.ok },
    };
    const reference = { kind: 'quarter_sha256', value: sha256(canonicalJson(body)) };
    const works2 = body.works.map((w) => {
        const e = extras.get(w.contentId);
        return { ...w, amounts: named(e?.amounts ?? null, names), imprint: null, imprintStatus: 'unknown',
            eligibility: { publisherChangedInQuarter: (e?.publishers.size || 0) > 1 } };
    });
    return { ...body, works: works2, reference };
}

export const NO_IMPRINT = '__sin_sello__';

/**
 * Sello de cada obra. Solo la vista previa y la simulación (resultados vivos) lo
 * toman del catálogo actual, y solo si la editorial actual de la obra es la del
 * periodo; el cierre congelado no guarda sello y no se reescribe con el actual.
 * No altera `reference`.
 */
export function attachImprints(report, contentsById) {
    const live = report.source === 'preview' || report.source === 'simulation';
    const works = report.works.map((w) => {
        if (!live) return { ...w, imprint: null, imprintStatus: 'not_historical' };
        const c = contentsById.get(w.contentId);
        if (!c) return { ...w, imprint: null, imprintStatus: 'not_in_catalog' };
        if ((c.publisherId ?? null) !== (w.responsiblePublisherId ?? null)) return { ...w, imprint: null, imprintStatus: 'publisher_changed' };
        const imprint = typeof c.imprint === 'string' && c.imprint.trim() ? c.imprint.trim() : null;
        return { ...w, imprint, imprintStatus: imprint ? 'current' : 'none' };
    });
    return { ...report, works, dimensions: { responsiblePublisher: 'historical', imprint: live ? 'current_catalog' : 'unavailable' } };
}

/**
 * Filtros de presentación (editorial responsable, sello, titular, obra). Los
 * totales del informe NO se tocan. El subtotal filtrado se suma por obra (sin
 * redistribuir bolsas, sin recalcular S, sin sumar R): MontoObra y sus destinos;
 * con titular, solo sus participaciones en las obras visibles. La Base
 * (presencia) no se atribuye a obras: el saldo completo del titular solo se da
 * cuando se filtra por titular.
 */
export function filterReport(report, { editorial = null, sello = null, titular = null, obra = null } = {}) {
    if (!editorial && !sello && !titular && !obra) return { ...report, filters: null, visibleTotals: null };
    const works = report.works.filter((w) => (!editorial || w.responsiblePublisherId === editorial)
        && (!sello || (sello === NO_IMPRINT ? !w.imprint : w.imprint === sello))
        && (!titular || w.beneficiaries.includes(titular)) && (!obra || w.contentId === obra));
    const keep = new Set(titular ? [titular] : works.flatMap((w) => w.beneficiaries));
    if (editorial && !titular) keep.add(editorial);
    const visibleShare = (id) => {
        const t = { payable: 0, retained: 0 };
        for (const w of works) for (const h of w.amounts?.byHolder || []) if (h.publisherId === id) { t.payable += h.payable; t.retained += h.retained; }
        return t;
    };
    const holders = report.holders.filter((h) => keep.has(h.publisherId)).map((h) => ({ ...h, visibleWorks: visibleShare(h.publisherId) }));
    const movements = report.movements.filter((m) => keep.has(m.publisherId));
    const hasAmounts = works.some((w) => w.amounts);
    const workSum = (k) => (hasAmounts ? sum(works.map((w) => w.amounts?.[k] || 0)) : null);
    const tShare = titular ? visibleShare(titular) : null;
    const th = titular ? holders.find((h) => h.publisherId === titular) : null;
    return {
        ...report, works, holders, movements, filters: { editorial, sello, titular, obra },
        visibleTotals: {
            works: works.length, holders: holders.length, Q: sum(works.map((w) => w.Q || 0)),
            montoObra: hasAmounts ? sum(works.map((w) => w.montoObra || 0)) : null,
            // Destinos del MontoObra de las obras visibles (con titular: solo su parte).
            worksPayable: titular ? (hasAmounts ? tShare.payable : null) : workSum('payable'),
            worksRetained: titular ? (hasAmounts ? tShare.retained : null) : workSum('retained'),
            worksPending: titular ? null : workSum('pending'),
            // Saldo completo del titular (Base + Variable + movimientos): solo con filtro por titular.
            payable: th ? th.payable : null, retained: th ? th.retained : null,
        },
    };
}

// ── exportación ─────────────────────────────────────────────────────────────

/** Celda CSV: números tal cual; texto entre comillas y neutralizado si empieza por = + - @ tab o CR. */
export function csvCell(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Number(v.toFixed(6))).replace('.', ',');
    let s = String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return `"${s.replace(/"/g, '""')}"`;
}
const csvRow = (cells) => cells.map(csvCell).join(';');
const filtersText = (f) => `editorial=${f.editorial || '-'}; sello=${f.sello === NO_IMPRINT ? 'sin sello asignado' : (f.sello || '-')}; titular=${f.titular || '-'}; obra=${f.obra || '-'}`;
const IMPRINT_DIMENSION = { current_catalog: 'Sello del catálogo actual (sin historial; solo si la editorial no cambió)', unavailable: 'No reconstruible: el cierre no congela el sello' };
const imprintCell = (w) => w.imprint ?? (w.imprintStatus === 'not_historical' ? 'no reconstruible' : w.imprintStatus === 'publisher_changed' ? 'editorial cambiada' : 'sin sello');
const exclusions = (w) => Object.entries(w.eligibility?.episodes?.excludedByReason || {}).map(([k, n]) => `${k}=${n}`).join(', ');
const episodesCell = (w) => (w.eligibility?.episodes ? `${w.eligibility.episodes.qualified}/${w.eligibility.episodes.total}` : null);
const pct = (bp) => (bp == null ? null : bp / 100);

/** CSV endurecido (UTF-8 con BOM, `;`, CRLF), compatible con Excel en es-CO. */
export function reportToCsv(r) {
    const L = [];
    L.push(csvRow(['Informe de regalías Chibalete+', r.kind === 'month' ? 'Mensual' : 'Trimestral']));
    L.push(csvRow(['Periodo', r.period]));
    L.push(csvRow(['Estado', r.statusLabel]));
    L.push(csvRow(['Exigible', r.notExigible ? 'NO EXIGIBLE' : 'Cierre oficial (los pagos se registran como movimientos)']));
    L.push(csvRow(['Referencia', `${r.reference.kind}:${r.reference.value}`]));
    if (r.kind === 'month') {
        L.push(csvRow(['Rule set', r.ruleSetId]));
        L.push(csvRow(['Corte', r.cutoff]));
        if (r.closedAt) L.push(csvRow(['Cierre registrado', r.closedAt]));
        if (r.policies?.D1) L.push(csvRow(['D1', `${r.policies.D1.id} (${r.policies.D1.status}): ${r.policies.D1.basis}`]));
    } else {
        L.push(csvRow(['Meses', r.months.join(', ')]));
        L.push(csvRow(['Meses faltantes', r.missingMonths.join(', ') || 'ninguno']));
    }
    L.push(csvRow(['Fórmula S', r.scoreFormula]));
    L.push(csvRow(['Bolsas', r.poolFormula]));
    if (r.dimensions) L.push(csvRow(['Dimensión sello', IMPRINT_DIMENSION[r.dimensions.imprint]]));
    if (r.filters) {
        // U6: con filtro, los totales de abajo son del periodo completo; lo visible va aparte.
        const v = r.visibleTotals;
        L.push(csvRow(['Filtros', filtersText(r.filters)]));
        L.push(csvRow(['Ámbito de los totales', 'Periodo completo (sin filtrar)']));
        L.push(csvRow(['Subtotal visible: titulares', v.holders]), csvRow(['Subtotal visible: obras', v.works]), csvRow(['Subtotal visible: Q', v.Q]),
            csvRow(['Subtotal visible: MontoObra (COP)', v.montoObra]),
            csvRow([`Subtotal visible: cobrable por obras${r.filters.titular ? ' (solo el titular)' : ''} (COP)`, v.worksPayable]),
            csvRow([`Subtotal visible: retenido por obras${r.filters.titular ? ' (solo el titular)' : ''} (COP)`, v.worksRetained]));
        if (!r.filters.titular) L.push(csvRow(['Subtotal visible: pendiente por obras (COP)', v.worksPending]));
        if (v.payable != null) L.push(csvRow(['Subtotal visible: cobrable (COP)', v.payable]), csvRow(['Subtotal visible: retenido (COP)', v.retained]));
        L.push(csvRow(['Nota', 'Base (presencia, BGP) se reparte por titular y no se atribuye a obras; R y S no se suman']));
    }
    if (r.ins) L.push(csvRow(['INS (COP)', r.ins.insCop]), csvRow(['Recaudo (COP)', r.ins.grossCop]), csvRow(['Deducciones (COP)', r.ins.deductionsCop]), csvRow(['Soporte INS', r.ins.supportRef]));
    if (r.pools) {
        L.push(csvRow(['BRD 25 % (COP)', r.pools.brd]), csvRow(['BGP 30 % (COP)', r.pools.bgp]), csvRow(['BLC 70 % (COP)', r.pools.blc]),
            csvRow(['BLC trasladada a BGP', r.pools.blcToBgp ? 'sí' : 'no']));
    }
    if (r.totals) {
        L.push(csvRow(['Cobrable (COP)', r.totals.payable]), csvRow(['Retenido (COP)', r.totals.retained]), csvRow(['Pagado registrado (COP)', r.totals.paid]),
            csvRow(['Trasladado (COP)', r.totals.transferredOut]), csvRow(['Traslados recibidos (COP)', r.totals.carriedIn]), csvRow(['Ajustes netos (COP)', r.totals.netAdjustments]),
            csvRow(['Pendiente D1 reparto entre versiones (COP)', r.totals.pending.versionSplit]), csvRow(['Pendiente D4 complemento de alfa (COP)', r.totals.pending.alphaComplement]),
            csvRow(['Pendiente D5 BGP sin destinatario (COP)', r.totals.pending.bgpWithoutHolders]));
    }
    L.push(csvRow(['Conciliación', r.reconciliation.ok ? 'OK' : 'FALLIDA']));
    L.push('');
    if (r.kind === 'month') {
        L.push(csvRow(['Obra', 'Título', 'Editorial responsable', 'Sello', 'Q', 'R', 'S', 'MontoObra (COP)', 'Estado', 'Cobrable por obra (COP)', 'Retenido por obra (COP)',
            'Pendiente D1+D4 (COP)', 'Episodios cualificados/total', 'Exclusiones', 'Avisos']));
        for (const w of r.works) {
            L.push(csvRow([w.contentId, w.title, w.responsibleName, imprintCell(w), w.Q, w.R, w.S, w.montoObra, w.status, w.amounts?.payable, w.amounts?.retained,
                w.amounts?.pending, episodesCell(w), exclusions(w), (w.eligibility?.flags || []).join(', ')]));
        }
        L.push('');
        L.push(csvRow(['Obra', 'Versiones', 'Alfa', 'Q', 'Parte (COP)', 'Variable (COP)', 'Complemento alfa (COP)', 'Titular', 'Participación %', 'Importe (COP)', 'Estado']));
        for (const w of r.works) for (const p of w.parts) for (const s of p.shares) {
            L.push(csvRow([w.contentId, p.versionNos.join('+'), p.alpha, p.Q, p.amount, p.variable, p.alphaComplement, s.publisherId, pct(s.shareBp), s.amount, s.status]));
        }
    } else {
        L.push(csvRow(['Obra', 'Título', 'Editorial responsable', 'Sello', 'Q acumulado', 'MontoObra acumulado (COP)', 'Cobrable por obra (COP)', 'Retenido por obra (COP)',
            'Pendiente D1+D4 (COP)', 'Editorial cambió en el trimestre']));
        for (const w of r.works) {
            L.push(csvRow([w.contentId, w.title, w.responsibleName, imprintCell(w), w.Q, w.montoObra, w.amounts?.payable, w.amounts?.retained, w.amounts?.pending,
                w.eligibility?.publisherChangedInQuarter ? 'sí' : 'no']));
        }
        L.push('');
        L.push(csvRow(['Obra', 'Titular', 'Nombre', 'Cobrable acumulado (COP)', 'Retenido acumulado (COP)']));
        for (const w of r.works) for (const h of w.amounts?.byHolder || []) L.push(csvRow([w.contentId, h.publisherId ?? '', h.name ?? 'sin titular (matriz incompleta)', h.payable, h.retained]));
    }
    L.push('');
    L.push(csvRow(['Titular', 'Nombre', 'Días de presencia', 'Base (COP)', 'Variable (COP)', 'Liquidado (COP)', 'Traslados recibidos (COP)', 'Ajustes (COP)',
        'Pagado registrado (COP)', 'Trasladado (COP)', 'Retenido (COP)', 'Saldo cobrable (COP)', 'Bajo umbral']));
    for (const h of r.holders) {
        L.push(csvRow([h.publisherId, h.name, h.presenceDays ?? null, h.base ?? h.settledBase, h.variable ?? h.settledVariable, h.settledTotal, h.carriedIn, h.adjustments,
            h.paid, h.transferredOut, h.retained, h.payable, h.belowPayoutThreshold ? 'sí' : 'no']));
    }
    if (r.movements.length) {
        L.push('');
        L.push(csvRow(['Movimiento', 'Periodo', 'Tipo', 'Origen', 'Titular', 'Importe (COP)', 'Destino', 'Motivo', 'Referencia', 'Fecha']));
        for (const m of r.movements) L.push(csvRow([m.id, m.period ?? r.period, m.kind, m.source, m.publisherId, m.amountCop, m.targetPeriod, m.reason, m.ref, m.createdAt]));
    }
    return `﻿${L.join('\r\n')}\r\n`;
}

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cop = (n) => (n == null ? '—' : `${esc(Number(n).toLocaleString('es-CO'))}`);
const num = (n, d = 4) => (n == null ? '—' : esc(Number(n).toFixed(d)));
const table = (head, rows) => `<table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.length ? rows.map((r) => `<tr>${r.join('')}</tr>`).join('') : `<tr><td colspan="${head.length}">Sin filas</td></tr>`}</tbody></table>`;
const td = (v, cls = '') => `<td${cls ? ` class="${cls}"` : ''}>${v}</td>`;

/** HTML imprimible (sin scripts ni recursos externos; todo escapado). */
export function reportToHtml(r) {
    const kv = [['Periodo', esc(r.period)], ['Estado', esc(r.statusLabel)], ['Referencia', `<code>${esc(r.reference.kind)}:${esc(r.reference.value)}</code>`]];
    if (r.kind === 'month') {
        kv.push(['Rule set', esc(r.ruleSetId)], ['Corte', esc(r.cutoff)]);
        if (r.closedAt) kv.push(['Cierre registrado', esc(r.closedAt)]);
        if (r.policies?.D1) kv.push(['D1', `${esc(r.policies.D1.id)} (${esc(r.policies.D1.status)}): ${esc(r.policies.D1.basis)}`]);
    } else {
        kv.push(['Meses', esc(r.months.join(', '))], ['Meses faltantes', esc(r.missingMonths.join(', ') || 'ninguno')]);
    }
    kv.push(['Fórmula S', esc(r.scoreFormula)], ['Bolsas', esc(r.poolFormula)]);
    if (r.dimensions) kv.push(['Dimensión sello', esc(IMPRINT_DIMENSION[r.dimensions.imprint])]);
    if (r.filters) {
        const v = r.visibleTotals;
        const who = r.filters.titular ? ' (solo el titular)' : '';
        kv.push(['Filtros', esc(filtersText(r.filters))],
            ['Ámbito de los totales', '<strong>Periodo completo (sin filtrar)</strong>'],
            ['Subtotal visible', `${esc(v.holders)} titulares · ${esc(v.works)} obras · Q ${esc(v.Q)} · MontoObra ${cop(v.montoObra)} COP`],
            [`Subtotal por obras${who}`, `cobrable ${cop(v.worksPayable)} COP · retenido ${cop(v.worksRetained)} COP${r.filters.titular ? '' : ` · pendiente ${cop(v.worksPending)} COP`}`]);
        if (v.payable != null) kv.push(['Saldo del titular', `cobrable ${cop(v.payable)} COP · retenido ${cop(v.retained)} COP (incluye Base de presencia y movimientos)`]);
        kv.push(['Nota', 'La Base (presencia, BGP) se reparte por titular y no se atribuye a obras; R y S no se suman.']);
    }
    if (r.ins) kv.push(['INS', `${cop(r.ins.insCop)} COP (recaudo ${cop(r.ins.grossCop)} − deducciones ${cop(r.ins.deductionsCop)}; soporte ${esc(r.ins.supportRef)})`]);
    if (r.pools) kv.push(['BRD 25 %', `${cop(r.pools.brd)} COP`], ['BGP 30 % / BLC 70 %', `${cop(r.pools.bgp)} / ${cop(r.pools.blc)} COP${r.pools.blcToBgp ? ' (BLC trasladada a BGP)' : ''}`]);
    if (r.totals) {
        kv.push(['Cobrable', `${cop(r.totals.payable)} COP`], ['Retenido', `${cop(r.totals.retained)} COP`], ['Pagado registrado', `${cop(r.totals.paid)} COP`],
            ['Pendientes (no cobrables)', `D1 ${cop(r.totals.pending.versionSplit)} · D4 ${cop(r.totals.pending.alphaComplement)} · D5 ${cop(r.totals.pending.bgpWithoutHolders)} COP`]);
    }
    kv.push(['Conciliación', r.reconciliation.ok ? 'OK' : '<strong>FALLIDA</strong>']);
    const worksTable = r.kind === 'month'
        ? table(['Obra', 'Título', 'Editorial', 'Sello', 'Q', 'R', 'S', 'MontoObra', 'Estado', 'Cobrable', 'Retenido', 'Pendiente D1+D4', 'Episodios', 'Exclusiones'],
            r.works.map((w) => [td(esc(w.contentId)), td(esc(w.title)), td(esc(w.responsibleName)), td(esc(imprintCell(w))), td(esc(w.Q), 'n'), td(num(w.R), 'n'), td(num(w.S), 'n'),
                td(cop(w.montoObra), 'n'), td(esc(w.status)), td(cop(w.amounts?.payable), 'n'), td(cop(w.amounts?.retained), 'n'), td(cop(w.amounts?.pending), 'n'),
                td(esc(episodesCell(w) ?? '—'), 'n'), td(esc(exclusions(w)))]))
        : table(['Obra', 'Título', 'Editorial', 'Sello', 'Q acumulado', 'MontoObra acumulado', 'Cobrable', 'Retenido', 'Pendiente D1+D4'],
            r.works.map((w) => [td(esc(w.contentId)), td(esc(w.title)), td(esc(w.responsibleName)), td(esc(imprintCell(w))), td(esc(w.Q), 'n'), td(cop(w.montoObra), 'n'),
                td(cop(w.amounts?.payable), 'n'), td(cop(w.amounts?.retained), 'n'), td(cop(w.amounts?.pending), 'n')]));
    const distRows = r.works.flatMap((w) => (w.amounts?.byHolder || []).map((h) => [td(esc(w.title || w.contentId)), td(esc(h.name ?? 'sin titular (matriz incompleta)')),
        td(cop(h.payable), 'n'), td(cop(h.retained), 'n')]));
    const distTable = distRows.length ? `<h2>Reparto de la variable por obra y titular</h2>${table(['Obra', 'Titular', 'Cobrable', 'Retenido'], distRows)}` : '';
    const holdersTable = table(['Titular', 'Días', 'Base', 'Variable', 'Liquidado', 'Recibido', 'Ajustes', 'Pagado', 'Trasladado', 'Retenido', 'Saldo cobrable'],
        r.holders.map((h) => [td(esc(h.name)), td(esc(h.presenceDays ?? '—'), 'n'), td(cop(h.base ?? h.settledBase), 'n'), td(cop(h.variable ?? h.settledVariable), 'n'),
            td(cop(h.settledTotal), 'n'), td(cop(h.carriedIn), 'n'), td(cop(h.adjustments), 'n'), td(cop(h.paid), 'n'), td(cop(h.transferredOut), 'n'), td(cop(h.retained), 'n'), td(cop(h.payable), 'n')]));
    const movTable = r.movements.length ? `<h2>Movimientos</h2>${table(['Periodo', 'Tipo', 'Origen', 'Titular', 'Importe', 'Destino', 'Motivo', 'Referencia', 'Fecha'],
        r.movements.map((m) => [td(esc(m.period ?? r.period)), td(esc(m.kind)), td(esc(m.source)), td(esc(m.name)), td(cop(m.amountCop), 'n'), td(esc(m.targetPeriod ?? '')), td(esc(m.reason)), td(esc(m.ref ?? '')), td(esc(m.createdAt))]))}` : '';
    const banner = r.notExigible ? '<div class="banner">PROVISIONAL — NO EXIGIBLE. No constituye liquidación ni obligación de pago.</div>' : '<div class="banner ok">Cierre oficial. Los pagos solo se registran como movimientos.</div>';
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Regalías ${esc(r.period)} · ${esc(r.statusLabel)}</title>
<style>body{font:13px/1.45 system-ui,sans-serif;color:#111;margin:24px}h1{font-size:20px;margin:0 0 8px}h2{font-size:15px;margin:22px 0 6px}
.banner{border:2px solid #b91c1c;color:#b91c1c;font-weight:700;padding:8px 12px;margin:8px 0 16px}.banner.ok{border-color:#15803d;color:#15803d}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}dt{font-weight:600}dd{margin:0}code{font-size:11px;word-break:break-all}
table{border-collapse:collapse;width:100%;margin-top:4px}th,td{border:1px solid #ccc;padding:3px 6px;text-align:left;vertical-align:top}th{background:#f3f4f6}td.n{text-align:right;font-variant-numeric:tabular-nums}
@media print{body{margin:0}.banner{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body>
<h1>Informe de regalías — ${r.kind === 'month' ? 'mensual' : 'trimestral'} ${esc(r.period)}</h1>${banner}
<dl>${kv.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>
<h2>Obras</h2>${worksTable}${distTable}<h2>Titulares</h2>${holdersTable}${movTable}
<p><small>Importes en COP enteros (resto mayor). Generado desde ${esc(r.reference.kind)} ${esc(r.reference.value)}. Sin datos de lectores.</small></p>
</body></html>`;
}
