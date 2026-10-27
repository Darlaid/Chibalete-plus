/**
 * periodPreview.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / V1.4 U2 · F3-B-01.
 *
 * Vista previa mensual (PROVISIONAL) de Q, R y S por obra. Puro: no lee disco,
 * no abre bases, no usa la red ni el reloj del sistema (el llamador inyecta
 * `generatedAt`). Mismas entradas ⇒ misma salida. No liquida ni cierra nada.
 *
 * Reparto del trabajo (PLAN_GENERAL_V1_1.md §4, DECISIONES_F0C.md §3):
 *  - `computeEconomicEpisodes` (F3-A1, sin cambios) construye los episodios:
 *    deduplicación, unión de modos/pestañas, franjas, una obra por franja,
 *    exclusión de usuarios, procedencia del acceso, mínimo activo y anomalías.
 *    Se le pasan TODAS las obras de las filas como «elegibles»: la elegibilidad
 *    contractual no es estática en el mes y la decide esta capa.
 *  - Esta capa añade lo que el motor no puede saber con una lista fija:
 *      · derechos y editorial responsable evaluados EN EL INICIO de cada
 *        episodio (`economicEligibility`, `publisherAt`);
 *      · minutos esperados de la versión vigente en ese instante;
 *      · el tope diario (DECISIONES §3) se vuelve a aplicar con la
 *        elegibilidad ya evaluada (misma regla que el paso 6 del motor);
 *      · R = mediana de min(cap, minutos / esperados) y S = √Q·(0,40 + 0,60·R);
 *      · U3-02 (PLAN §6.5): los episodios de una versión en disputa, retenida
 *        o sin titularidad acreditada CUENTAN en Q/R/S, marcados como
 *        retenidos, para que su parte de la BLC no se redistribuya;
 *      · presencia por día con los beneficiarios de la matriz vigente (glosario:
 *        «Beneficiarios… es lo único que define quién cobra»).
 *    Con derechos y minutos constantes en el mes, Q y R coinciden con los del
 *    motor (prueba de equivalencia en periodPreview.test.mjs).
 *
 * La salida no contiene identificadores de lectores: solo agregados por obra.
 */
import crypto from 'node:crypto';
import { computeEconomicEpisodes } from './economicEpisodes.mjs';
import { economicEligibility, effectiveVersion } from './rightsStore.mjs';
import { publisherAt } from './publisherAssignment.mjs';

export const PREVIEW_STATUS = 'PROVISIONAL';
/** Única fórmula aprobada (Doctrina): cualquier otra detiene la vista previa. */
export const SUPPORTED_SCORE_FORMULA = 'sqrt(Q) * (0.40 + 0.60 * R)';
/** Margen de lectura alrededor del mes: episodios que cruzan el borde y fusiones de 30 min. */
export const PREVIEW_MARGIN_MS = 24 * 3600_000;
const BOGOTA_OFFSET_MS = 5 * 3600_000; // America/Bogota: UTC−5 sin horario de verano
const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const DAY_MS = 24 * 3600_000;
/**
 * Motivos de no elegibilidad que el PLAN §6.5 manda RETENER (no excluir): si
 * todos los motivos de un instante están aquí, la lectura cuenta y su importe
 * se retiene con este motivo. Suspensión, revocación, vigencia y demás siguen
 * excluyendo.
 */
export const RETAINABLE_REASONS = Object.freeze({
    LEGAL_DISPUTED: 'disputed',
    ECONOMIC_RETAINED: 'economic_retained',
    SHARES_INVALID: 'shares_incomplete',
    SHARE_HOLDER_NOT_ACTIVE: 'title_not_proven',
});

const cmpStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const digest = (v) => crypto.createHash('sha256').update(typeof v === 'string' ? v : JSON.stringify(v)).digest('hex').slice(0, 16);
const isoOf = (ms) => new Date(ms).toISOString();

/** Límites del mes contractual (America/Bogota). Lanza ante un mes inválido o una zona no soportada. */
export function monthBounds(month, timezone = 'America/Bogota') {
    const m = MONTH_RE.exec(String(month || ''));
    if (!m) throw new RangeError('month debe tener la forma YYYY-MM');
    if (timezone !== 'America/Bogota') throw new RangeError(`zona horaria no soportada: ${timezone}`);
    const y = Number(m[1]), mo = Number(m[2]);
    const startMs = Date.UTC(y, mo - 1, 1) + BOGOTA_OFFSET_MS;
    const endMs = Date.UTC(y, mo, 1) + BOGOTA_OFFSET_MS;
    const days = [];
    for (let t = startMs; t < endMs; t += DAY_MS) days.push(new Date(t - BOGOTA_OFFSET_MS).toISOString().slice(0, 10));
    return { month: `${m[1]}-${m[2]}`, startMs, endMs, fromDay: days[0], toDay: days[days.length - 1], days };
}

/** Ventana de `server_ts` que hay que leer para el mes (margen + retraso de ingesta admitido). */
export function previewReadWindow(month, { maxIngestDelayMs }) {
    const b = monthBounds(month);
    return { fromServerTs: b.startMs - PREVIEW_MARGIN_MS, toServerTs: b.endMs + PREVIEW_MARGIN_MS + maxIngestDelayMs };
}

/** S de la Doctrina. Q = 0 ⇒ 0. Exige un R en [0, 1] cuando Q > 0. */
export function scoreS(Q, R, ruleSet) {
    if (ruleSet?.scoreFormula !== SUPPORTED_SCORE_FORMULA) throw new Error(`scoreFormula no soportada: ${ruleSet?.scoreFormula}`);
    if (!Number.isInteger(Q) || Q < 0) throw new RangeError('Q debe ser un entero ≥ 0');
    if (Q === 0) return 0;
    if (typeof R !== 'number' || !Number.isFinite(R) || R < 0 || R > 1) throw new RangeError('R debe estar en [0, 1] cuando Q > 0');
    return Math.sqrt(Q) * (0.40 + 0.60 * R);
}

function median(sorted) {
    const n = sorted.length;
    if (n === 0) return null;
    return n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
}

const reasonCode = (r) => (r.startsWith('rights:') ? r : r.split(':')[0]);
const bump = (obj, k, n = 1) => { obj[k] = (obj[k] || 0) + n; };
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort((a, b) => cmpStr(a[0], b[0])));

/**
 * @param {object} p
 * @param {Array<object>} p.rows                    filas de econ_events (forma de readEconRows)
 * @param {string} p.month                          YYYY-MM
 * @param {object} p.ruleSet                        p. ej. RULE_SET_RS_2026_01_V1
 * @param {{clockSkewToleranceMs:number, maxIngestDelayMs:number}} p.clock
 * @param {Map<string, object>} p.contents          contentId → ficha actual del catálogo
 * @param {Map<string, object[]>} p.versionsByContent  rightsIndex()
 * @param {Map<string, object[]>} p.publisherHistoryByContent  listPublisherHistory por obra
 * @param {Map<string, object>} p.publishersById    titulares actuales
 * @param {Map<string, string>} p.excludedUsers     userId → motivo (P7, QA, administración)
 * @param {{fromServerTs:number, toServerTs:number}} [p.readWindow]  solo para la trazabilidad
 * @param {string} [p.generatedAt]                  ISO (lo aporta el llamador)
 */
export function computePeriodPreview(p) {
    const rs = p.ruleSet;
    if (rs?.scoreFormula !== SUPPORTED_SCORE_FORMULA) throw new Error(`scoreFormula no soportada: ${rs?.scoreFormula}`);
    const b = monthBounds(p.month, rs.timezone);
    const contents = p.contents || new Map();
    const versionsByContent = p.versionsByContent || new Map();
    const historyByContent = p.publisherHistoryByContent || new Map();
    const publishersById = p.publishersById || new Map();
    const excludedUsers = p.excludedUsers || new Map();
    const publisherById = (id) => publishersById.get(id) || null;
    const rows = p.rows || [];

    // 1. Episodios con el motor F3-A1. Toda obra presente es «elegible» para el
    //    motor: la elegibilidad contractual la decide esta capa por episodio.
    const rowContentIds = [...new Set(rows.map((r) => r.content_id).filter(Boolean))].sort();
    const engine = computeEconomicEpisodes(rows, {
        ruleSet: rs,
        eligibleContentIds: rowContentIds,
        expectedMinutesByContent: {},
        excludedUsers,
        clockSkewToleranceMs: p.clock.clockSkewToleranceMs,
        maxIngestDelayMs: p.clock.maxIngestDelayMs,
        period: { fromDay: b.fromDay, toDay: b.toDay },
    });

    // Elegibilidad contractual en un instante (editorial responsable de ese instante).
    const eligibilityAt = (contentId, atMs) => {
        const content = contents.get(contentId) || null;
        const versions = versionsByContent.get(contentId) || [];
        if (!content) return { eligible: false, reasons: ['CONTENT_NOT_FOUND'], version: null };
        const at = new Date(atMs);
        const contentAt = { ...content, publisherId: publisherAt(historyByContent.get(contentId) || [], content.publisherId ?? null, isoOf(atMs)) };
        const v = economicEligibility({ content: contentAt, versions, publisherById, at });
        const version = v.versionId ? versions.find((x) => x.id === v.versionId) || null : effectiveVersion(versions, at);
        const retained = !v.eligible && version && v.reasons.length && v.reasons.every((r) => RETAINABLE_REASONS[r])
            ? [...new Set(v.reasons.map((r) => RETAINABLE_REASONS[r]))].sort() : null;
        return { eligible: v.eligible, retained, reasons: v.reasons, version };
    };

    // 2. Derechos en el inicio de cada episodio + tope diario con la elegibilidad ya resuelta.
    const episodes = engine.episodes.map((e) => {
        const base = e.reasons.filter((r) => r !== 'daily_cap' && r !== 'work_not_eligible');
        const el = eligibilityAt(e.contentId, e.startMs);
        const counts = el.eligible || !!el.retained;
        const reasons = counts ? base : [...base, ...el.reasons.map((r) => `rights:${r}`)];
        return { ...e, reasons, version: counts ? el.version : null, retained: el.retained };
    });
    const capGroups = new Map();
    for (const e of episodes) {
        if (e.reasons.length) continue;
        const g = `${e.userId}\u0000${e.contentId}\u0000${e.day}`;
        if (!capGroups.has(g)) capGroups.set(g, []);
        capGroups.get(g).push(e);
    }
    for (const list of capGroups.values()) {
        list.sort((x, y) => x.startMs - y.startMs);
        list.forEach((e, i) => { if (i >= rs.maxQualifiedEpisodesPerUserWorkDay) e.reasons.push('daily_cap'); });
    }

    // 3. Obras: las de los episodios del mes y las que tienen régimen de derechos.
    const workIds = new Set([...episodes.map((e) => e.contentId), ...versionsByContent.keys()]);
    const works = [];
    const totals = { works: 0, worksWithQ: 0, Q: 0, sumS: 0, episodes: 0, qualifiedEpisodes: 0, qualifiedActiveSeconds: 0, excludedByReason: {}, flaggedEpisodes: {} };
    for (const contentId of [...workIds].sort()) {
        const content = contents.get(contentId) || null;
        const eps = episodes.filter((e) => e.contentId === contentId).sort((x, y) => x.startMs - y.startMs);
        const history = historyByContent.get(contentId) || [];
        const agg = { Q: 0, r: [], activeSecondsQualified: 0, excludedByReason: {}, flags: {}, modeSeconds: {}, byVersion: new Map() };
        for (const e of eps) {
            for (const f of e.flags) { bump(agg.flags, f); bump(totals.flaggedEpisodes, f); }
            if (e.reasons.length) {
                // Acceso no pagado: se distingue la clase (gratuito, QA, `unclassified`…).
                const codes = e.reasons.map((r) => (r === 'access_not_paid' ? `access_not_paid:${e.accessClasses.join('+')}` : reasonCode(r)));
                for (const r of new Set(codes)) { bump(agg.excludedByReason, r); bump(totals.excludedByReason, r); }
                continue;
            }
            const v = e.version;
            agg.Q++;
            agg.activeSecondsQualified += e.activeSeconds;
            agg.r.push(Math.min(rs.retentionCap, (e.activeSeconds / 60) / v.expectedMinutes));
            for (const [m, s] of Object.entries(e.modeSeconds)) bump(agg.modeSeconds, m, s);
            if (!agg.byVersion.has(v.id)) {
                agg.byVersion.set(v.id, {
                    versionId: v.id, versionNo: v.versionNo, actRef: v.actRef, publisherId: v.publisherId, alpha: v.alpha,
                    expectedMinutes: v.expectedMinutes, shares: v.shares.map((s) => ({ publisherId: s.publisherId, shareBp: s.shareBp })),
                    retainedReasons: e.retained || [], Q: 0, activeSecondsQualified: 0,
                });
            }
            const bv = agg.byVersion.get(v.id);
            bv.Q++;
            bv.activeSecondsQualified += e.activeSeconds;
        }
        const R = agg.Q ? median([...agg.r].sort((x, y) => x - y)) : null;
        const S = scoreS(agg.Q, R, rs);
        // Presencia (§6.3): un día cuenta si la obra estuvo activa en algún momento del día. La
        // elegibilidad solo cambia en effectiveAt y en las reasignaciones (la vigencia es por día),
        // así que basta evaluarla al empezar el día y en cada uno de esos instantes. Titulares =
        // beneficiarios de la matriz vigente; los de versiones retenidas se separan.
        const cuts = [...(versionsByContent.get(contentId) || []).map((v) => Date.parse(v.effectiveAt)), ...history.map((h) => Date.parse(h.changedAt))];
        const presenceDayList = [];
        if ((versionsByContent.get(contentId) || []).length) {
            b.days.forEach((day, i) => {
                const t0 = b.startMs + i * DAY_MS;
                const payable = new Set(), retained = new Set();
                for (const t of [t0, ...cuts.filter((t) => t > t0 && t < t0 + DAY_MS)]) {
                    const el = eligibilityAt(contentId, t);
                    if (el.eligible) el.version.shares.forEach((s) => payable.add(s.publisherId));
                    else if (el.retained) el.version.shares.forEach((s) => retained.add(s.publisherId));
                }
                if (payable.size || retained.size) {
                    presenceDayList.push({ day, payable: [...payable].sort(cmpStr), retained: [...retained].filter((id) => !payable.has(id)).sort(cmpStr) });
                }
            });
        }
        const eligibleDays = presenceDayList.filter((x) => x.payable.length).map((x) => x.day);
        const changes = history.filter((h) => h.changedAt >= isoOf(b.startMs) && h.changedAt < isoOf(b.endMs))
            .map((h) => ({ from: h.from, to: h.to, changedAt: h.changedAt }));
        const flags = [];
        if (agg.byVersion.size > 1) flags.push('rights_version_changed_in_period');
        if ([...agg.byVersion.values()].some((v) => v.retainedReasons.length)) flags.push('retained_readings');
        if (changes.length) flags.push('publisher_changed_in_period');
        if (!content) flags.push('content_not_in_catalog');
        works.push({
            contentId,
            title: content?.titulo ?? null,
            tipo: content?.tipo ?? null,
            responsiblePublisherId: publisherAt(history, content?.publisherId ?? null, isoOf(b.endMs - 1)),
            publisherChanges: changes,
            rightsRegime: (versionsByContent.get(contentId) || []).length > 0,
            eligibleDays: eligibleDays.length,
            eligibleDayList: eligibleDays,
            presenceDayList,
            Q: agg.Q,
            R,
            S,
            activeSecondsQualified: agg.activeSecondsQualified,
            episodes: { total: eps.length, qualified: agg.Q, excludedByReason: sortObj(agg.excludedByReason), flagged: sortObj(agg.flags) },
            modeSeconds: sortObj(agg.modeSeconds),
            versions: [...agg.byVersion.values()].sort((x, y) => x.versionNo - y.versionNo),
            flags,
        });
        totals.works++;
        if (agg.Q > 0) totals.worksWithQ++;
        totals.Q += agg.Q;
        totals.sumS += S;
        totals.episodes += eps.length;
        totals.qualifiedEpisodes += agg.Q;
        totals.qualifiedActiveSeconds += agg.activeSecondsQualified;
    }
    totals.excludedByReason = sortObj(totals.excludedByReason);
    totals.flaggedEpisodes = sortObj(totals.flaggedEpisodes);

    const body = {
        status: PREVIEW_STATUS,
        month: b.month,
        period: { fromDay: b.fromDay, toDay: b.toDay, timezone: rs.timezone, start: isoOf(b.startMs), end: isoOf(b.endMs) },
        ruleSet: { id: rs.id, scoreFormula: rs.scoreFormula, retentionCap: rs.retentionCap, retentionAggregate: rs.retentionAggregate,
            qualifyingActiveSeconds: rs.qualifyingActiveSeconds, maxQualifiedEpisodesPerUserWorkDay: rs.maxQualifiedEpisodesPerUserWorkDay,
            equivalentProgress: rs.equivalentProgress },
        works,
        totals,
        trace: {
            engine: 'computeEconomicEpisodes (F3-A1)',
            eligibilityEvaluatedAt: 'episode_start',
            presenceDayRule: 'active_at_any_moment_of_day',
            presenceHolders: 'rights_version_shares',
            readWindow: p.readWindow ? { from: isoOf(p.readWindow.fromServerTs), to: isoOf(p.readWindow.toServerTs) } : null,
            rowsRead: rows.length,
            rowsDigest: digest(rows.map((r) => String(r.event_id)).sort().join('|')),
            rightsDigest: digest([...versionsByContent.entries()].sort((x, y) => cmpStr(x[0], y[0])).map(([k, vs]) => [k, vs.map((v) => v.id)])),
            publisherHistoryDigest: digest([...historyByContent.entries()].sort((x, y) => cmpStr(x[0], y[0])).map(([k, hs]) => [k, hs.map((h) => h.id)])),
            excludedUsers: excludedUsers.size,
            invalidEvents: engine.audit.invalidByReason,
            ignoredNonEconomic: engine.audit.ignoredNonEconomic,
            crossWorkDroppedSlots: engine.audit.crossWorkDroppedSlots,
        },
    };
    body.trace.resultDigest = digest({ works: body.works, totals: body.totals, ruleSet: body.ruleSet, month: body.month });
    return { ...body, generatedAt: p.generatedAt ?? null };
}
