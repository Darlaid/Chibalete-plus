/**
 * settlement.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / V1.4 U3 · F4-A-01.
 *
 * Liquidación pura sobre vistas previas sintéticas (U2): bolsas, resto mayor,
 * S, alfa, matriz con terceros, presencia sin duplicados, cambios dentro del
 * mes, retenciones, decisiones pendientes, INS=0, Q=0, conciliación al peso
 * (también aleatoria) y reproducibilidad. Incluye una cadena real U2 → U3 con
 * computePeriodPreview. Sin disco, sin bases, sin red.
 */
import { RULE_SET_RS_2026_01_V1 as RS } from '../economicEpisodes.mjs';
import { computePeriodPreview } from '../periodPreview.mjs';
import { computeSettlement, largestRemainder } from '../settlement.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const throws = (fn) => { try { fn(); return false; } catch { return true; } };
const sum = (xs) => xs.reduce((s, x) => s + x, 0);

const PUB_A = 'pub-a', PUB_B = 'pub-b', AUTORA = 'pub-autora';
const PUBS = new Map([[PUB_A, { id: PUB_A, status: 'active' }], [PUB_B, { id: PUB_B, status: 'active' }], [AUTORA, { id: AUTORA, status: 'active' }]]);
const POL = { presenceHolder: 'responsible_publisher' };
const GEN = '2026-12-01T00:00:00.000Z';

const days = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `2026-11-${String(from + i).padStart(2, '0')}`);
let vseq = 0;
const V = (o = {}) => ({ versionId: o.id ?? `rv-${++vseq}`, versionNo: o.no ?? 1, actRef: 'ACTA-FX', publisherId: o.pub ?? PUB_A,
    alpha: o.alpha ?? 0.7, expectedMinutes: 10, shares: o.shares ?? [{ publisherId: o.pub ?? PUB_A, shareBp: 10000 }], Q: o.Q ?? 1, activeSecondsQualified: 0 });
const W = (id, o = {}) => {
    const versions = o.versions ?? (o.S > 0 ? [V({ Q: o.Q ?? 1, pub: o.pub, alpha: o.alpha, shares: o.shares })] : []);
    return { contentId: id, title: `Obra ${id}`, tipo: 'libro', responsiblePublisherId: o.pub ?? PUB_A, publisherChanges: o.changes ?? [],
        rightsRegime: true, eligibleDays: (o.days ?? days(1, 30)).length, eligibleDayList: o.days ?? days(1, 30),
        Q: o.Q ?? sum(versions.map((v) => v.Q)), R: o.S > 0 ? 0.5 : null, S: o.S ?? 0, versions, flags: [] };
};
const P = (works) => ({ status: 'PROVISIONAL', month: '2026-11',
    period: { fromDay: '2026-11-01', toDay: '2026-11-30', timezone: 'America/Bogota', start: '2026-11-01T05:00:00.000Z', end: '2026-12-01T05:00:00.000Z' },
    ruleSet: { id: RS.id }, works, totals: { sumS: sum(works.map((w) => w.S)) },
    trace: { presenceDayRule: 'eligible_at_day_start_or_day_end', resultDigest: 'fx' } });
const settle = (works, o = {}) => computeSettlement(P(works), { ins: { amountCop: 1_000_000 }, ruleSet: RS, policies: POL, publishersById: PUBS, generatedAt: GEN, ...o });
const H = (s, id) => s.holders.find((h) => h.publisherId === id);
const Wk = (s, id) => s.works.find((w) => w.contentId === id);
const allInts = (s) => JSON.stringify(s, (k, v) => (typeof v === 'number' && ['amount', 'base', 'variable', 'total', 'montoObra', 'retained'].includes(k) && !Number.isInteger(v) ? (() => { throw new Error(k); })() : v));

section('[1] resto mayor');
{
    ok('10 entre 3 iguales = 4/3/3', JSON.stringify(largestRemainder(10, [1n, 1n, 1n])) === '[4,3,3]');
    ok('suma exacta con pesos dispares', sum(largestRemainder(1_000_003, [2500n, 7500n])) === 1_000_003);
    ok('total 0 con pesos 0 → ceros', JSON.stringify(largestRemainder(0, [0n, 0n])) === '[0,0]');
    ok('importe positivo con pesos 0 → error', throws(() => largestRemainder(5, [0n, 0n])));
    ok('total no entero → error', throws(() => largestRemainder(1.5, [1n])));
    ok('restos: gana el mayor (7 en 30/70 → 2/5)', JSON.stringify(largestRemainder(7, [3n, 7n])) === '[2,5]');
}

section('[2] bolsas 25 / 30 / 70');
{
    const s = settle([W('W1', { S: 1 })]);
    ok('INS 1.000.000 → BRD 250.000, BGP 75.000, BLC 175.000', s.pools.brd === 250_000 && s.pools.bgp === 75_000 && s.pools.blc === 175_000 && s.pools.insOutsideBrd === 750_000);
    const odd = settle([W('W1', { S: 1 })], { ins: { amountCop: 1_000_003 } });
    ok('INS impar: BRD + resto = INS y BGP + BLC = BRD', odd.pools.brd + odd.pools.insOutsideBrd === 1_000_003 && odd.pools.bgp + odd.pools.blc === odd.pools.brd);
    ok('INS impar: BRD = 250.001 (resto 0,75 > 0,25)', odd.pools.brd === 250_001);
    ok('una sola obra con S: MontoObra = BLC entera', Wk(s, 'W1').montoObra === 175_000);
    ok('alfa 0,7: variable 122.500 y complemento 52.500', Wk(s, 'W1').parts[0].variable === 122_500 && s.destinations.alphaComplement === 52_500);
    ok('titular único: base 75.000 + variable 122.500', H(s, PUB_A).base === 75_000 && H(s, PUB_A).variable === 122_500 && H(s, PUB_A).total === 197_500);
    ok('conciliación OK', s.reconciliation.ok && Object.values(s.reconciliation.checks).every(Boolean));
    ok('no vinculante y PROVISIONAL', s.binding === false && s.status === 'PROVISIONAL');
}

section('[3] INS = 0, Q = 0 y S = 0');
{
    const z = settle([W('W1', { S: 1.4, Q: 4 }), W('W2', { S: 0 })], { ins: { amountCop: 0 } });
    ok('INS = 0 → todas las bolsas y destinos en 0', z.pools.brd === 0 && z.destinations.payable === 0 && z.destinations.alphaComplement === 0 && z.holders.every((h) => h.total === 0));
    ok('INS = 0 → conciliación OK', z.reconciliation.ok);
    const q0 = settle([W('W1', { S: 0, pub: PUB_A, days: days(1, 30) }), W('W2', { S: 0, pub: PUB_B, days: days(1, 15) })]);
    ok('Σ S = 0 → la BLC pasa a la BGP', q0.pools.blcToBgp === true && q0.pools.bgpEffective === 250_000 && q0.pools.blcEffective === 0);
    ok('Q = 0: nadie cobra variable; la BRD se reparte por presencia 30:15', H(q0, PUB_A).base + H(q0, PUB_B).base === 250_000 && H(q0, PUB_A).base === 166_667 && H(q0, PUB_B).base === 83_333 && q0.holders.every((h) => h.variable === 0));
    const mix = settle([W('W1', { S: 2 }), W('W2', { S: 0, pub: PUB_B })]);
    ok('obra con S = 0 junto a otra con S > 0: MontoObra 0 y no hay traslado', Wk(mix, 'W2').montoObra === 0 && mix.pools.blcToBgp === false && Wk(mix, 'W1').montoObra === 175_000);
    ok('…pero su titular sí tiene presencia', H(mix, PUB_B).presenceDays === 30 && H(mix, PUB_B).base > 0);
}

section('[4] S, alfa y matriz de terceros');
{
    const s = settle([W('W1', { S: 1 }), W('W2', { S: 3, pub: PUB_B, alpha: 0.5, shares: [{ publisherId: PUB_B, shareBp: 6000 }, { publisherId: AUTORA, shareBp: 4000 }] })]);
    ok('MontoObra proporcional a S (1:3)', Wk(s, 'W1').montoObra === 43_750 && Wk(s, 'W2').montoObra === 131_250);
    const p2 = Wk(s, 'W2').parts[0];
    ok('alfa 0,5 de 131.250 → variable 65.625', p2.variable === 65_625 && p2.alphaComplement === 65_625);
    ok('matriz 60/40: editorial 39.375, autora 26.250', p2.shares.find((x) => x.publisherId === PUB_B).amount === 39_375 && p2.shares.find((x) => x.publisherId === AUTORA).amount === 26_250);
    ok('la autora (tercero) cobra solo por la matriz: sin base', H(s, AUTORA).variable === 26_250 && H(s, AUTORA).base === 0 && H(s, AUTORA).presenceDays === 0);
    ok('sin doble remuneración: variable total = Σ matriz', sum(s.holders.map((h) => h.variable)) === sum(s.works.flatMap((w) => w.parts.map((p) => p.variable))));
    ok('importes enteros en todo el resultado', !throws(() => allInts(s)));
}

section('[5] titulares compartidos y presencia sin duplicaciones');
{
    const sh = [{ publisherId: PUB_A, shareBp: 5000 }, { publisherId: AUTORA, shareBp: 5000 }];
    const s = settle([W('W1', { S: 1, shares: sh, days: days(1, 10) }), W('W2', { S: 1, shares: sh, days: days(1, 10) }), W('W3', { S: 0, pub: PUB_B, days: days(1, 30) })]);
    ok('A con dos obras los mismos 10 días cuenta 10 días, no 20', H(s, PUB_A).presenceDays === 10);
    ok('base 10:30 → A 18.750, B 56.250', H(s, PUB_A).base === 18_750 && H(s, PUB_B).base === 56_250);
    ok('P_titular = días / días del mes', Math.abs(H(s, PUB_A).presenceShare - 10 / 30) < 1e-12);
    ok('la autora suma su variable de las dos obras', H(s, AUTORA).variable === sum(s.works.flatMap((w) => w.parts.flatMap((p) => p.shares.filter((x) => x.publisherId === AUTORA).map((x) => x.amount)))));
    const u = settle([W('W1', { S: 0, days: days(1, 10) }), W('W2', { S: 0, days: days(11, 20) })]);
    ok('dos obras en días distintos: unión = 20 días', H(u, PUB_A).presenceDays === 20);
}

section('[6] cambios dentro del mes: versiones, alfa, matriz y reasignación');
{
    const same = settle([W('W1', { S: 2, Q: 4, versions: [V({ no: 1, Q: 3 }), V({ no: 2, Q: 1 })] })]);
    ok('versiones sucesivas con mismas condiciones → una parte, sin decisión', Wk(same, 'W1').parts.length === 1 && Wk(same, 'W1').parts[0].versionNos.join() === '1,2' && same.destinations.pendingDecision.versionSplit === 0);
    const diffVersions = () => [V({ no: 1, Q: 3, alpha: 0.6 }), V({ no: 2, Q: 1, alpha: 0.8, shares: [{ publisherId: PUB_A, shareBp: 7000 }, { publisherId: AUTORA, shareBp: 3000 }] })];
    const pend = settle([W('W1', { S: 2, Q: 4, versions: diffVersions() }), W('W2', { S: 2, pub: PUB_B })]);
    ok('alfa/matriz distintos sin política → MontoObra pendiente de decisión', Wk(pend, 'W1').status === 'pending_decision' && pend.destinations.pendingDecision.versionSplit === Wk(pend, 'W1').montoObra);
    ok('…sin tocar las demás obras', Wk(pend, 'W2').montoObra === 87_500 && Wk(pend, 'W2').status === 'settled');
    ok('…y la decisión D1 queda marcada', pend.decisions.find((d) => d.id === 'D1_VERSION_SPLIT').needed === true);
    ok('pendiente ≠ cobrable: la autora no cobra nada de W1', !H(pend, AUTORA) || H(pend, AUTORA).variable === 0);
    const q = settle([W('W1', { S: 2, Q: 4, versions: diffVersions() })], { policies: { ...POL, versionSplit: 'proportional_q' } });
    const [p1, p2] = Wk(q, 'W1').parts;
    ok('candidata proporcional a Q: 3:1 de 175.000', p1.amount === 131_250 && p2.amount === 43_750);
    ok('cada parte con su alfa: 0,6 y 0,8', p1.variable === 78_750 && p2.variable === 35_000);
    ok('las lecturas de v1 no pagan a la matriz de v2 (autora solo en v2)', !p1.shares.some((x) => x.publisherId === AUTORA) && p2.shares.find((x) => x.publisherId === AUTORA).amount === 10_500);

    const re = settle([W('W1', { S: 0, pub: PUB_B, days: days(1, 30), changes: [{ from: PUB_A, to: PUB_B, changedAt: '2026-11-11T05:00:00.000Z' }] })]);
    ok('reasignación el 11/11 00:00 Bogotá: A 10 días, B 20 días', H(re, PUB_A).presenceDays === 10 && H(re, PUB_B).presenceDays === 20);
    const mid = settle([W('W1', { S: 0, pub: PUB_B, days: days(1, 30), changes: [{ from: PUB_A, to: PUB_B, changedAt: '2026-11-11T17:00:00.000Z' }] })]);
    ok('reasignación a mediodía: el día 11 cuenta para las dos (regla candidata)', H(mid, PUB_A).presenceDays === 11 && H(mid, PUB_B).presenceDays === 20);
    const expired = settle([W('W1', { S: 1, days: days(1, 12) }), W('W2', { S: 0, pub: PUB_B, days: [] })]);
    ok('derechos vencidos el 12/11: presencia solo 12 días; obra sin días elegibles no suma', H(expired, PUB_A).presenceDays === 12 && !H(expired, PUB_B));
}

section('[7] retenciones y montos no distribuibles');
{
    const base = [W('W1', { S: 1 }), W('W2', { S: 1, pub: PUB_B, shares: [{ publisherId: PUB_B, shareBp: 5000 }, { publisherId: AUTORA, shareBp: 5000 }] })];
    const free = settle(base);
    const disp = settle(base, { holds: [{ scope: 'work', id: 'W2', reason: 'disputed' }] });
    ok('obra en disputa: MontoObra retenido entero', Wk(disp, 'W2').status === 'retained' && Wk(disp, 'W2').retained === Wk(free, 'W2').montoObra && disp.destinations.retainedByReason.disputed === Wk(free, 'W2').montoObra);
    ok('…y no se redistribuye: W1 cobra lo mismo', Wk(disp, 'W1').montoObra === Wk(free, 'W1').montoObra && H(disp, PUB_A).total === H(free, PUB_A).total);
    const hold = settle(base, { holds: [{ scope: 'holder', id: AUTORA, reason: 'disputed' }] });
    ok('titular en disputa: su parte de la matriz queda retenida', H(hold, AUTORA).variable === 0 && H(hold, AUTORA).variableRetained === H(free, AUTORA).variable);
    ok('…sin aumentar la de la editorial', H(hold, PUB_B).variable === H(free, PUB_B).variable);
    const inactive = settle(base, { publishersById: new Map([...PUBS, [AUTORA, { id: AUTORA, status: 'inactive' }]]) });
    ok('titular no activo al liquidar → retenido «title_not_proven»', inactive.destinations.retainedByReason.title_not_proven === H(free, AUTORA).variable);
    const bpHold = settle(base, { holds: [{ scope: 'holder', id: PUB_A, reason: 'disputed' }] });
    ok('titular retenido: también su base de presencia', H(bpHold, PUB_A).base === 0 && H(bpHold, PUB_A).baseRetained === H(free, PUB_A).base);
    const bad = settle([W('W1', { S: 1, shares: [{ publisherId: PUB_A, shareBp: 9000 }] })]);
    ok('matriz que no suma 100 % → variable retenida «shares_incomplete»', bad.destinations.retainedByReason.shares_incomplete === Wk(bad, 'W1').parts[0].variable);
    const none = settle([W('W1', { S: 0, days: [] })]);
    ok('Σ S = 0 y Σ P = 0 → la BRD queda sin destinatario, explícita', none.destinations.bgpWithoutHolders === 250_000 && none.destinations.payable === 0);
    for (const s of [disp, hold, inactive, bpHold, bad, none]) ok(`conciliación OK (${Object.keys(s.destinations.retainedByReason).join('+') || 'sin destinatario'})`, s.reconciliation.ok);
}

section('[8] decisión de presencia pendiente');
{
    const s = settle([W('W1', { S: 1 })], { policies: {} });
    ok('sin política de presencia: la BGP entera queda pendiente', s.destinations.pendingDecision.presence === 75_000 && H(s, PUB_A).base === 0);
    ok('…la variable sí se liquida', H(s, PUB_A).variable === 122_500);
    ok('…D2 marcada con la regla diaria de U2', s.decisions.find((d) => d.id === 'D2_PRESENCE_RULE').needed && s.decisions[1].presenceDayRule === 'eligible_at_day_start_or_day_end');
    const q0 = settle([W('W1', { S: 0 })], { policies: {} });
    ok('Σ S = 0 sin política: toda la BRD pendiente (BLC→BGP→pendiente)', q0.destinations.pendingDecision.presence === 250_000);
}

section('[9] redondeo y conciliación aleatoria al peso');
{
    const r3 = settle([W('W1', { S: 1 }), W('W2', { S: 1 }), W('W3', { S: 1 })], { ins: { amountCop: 400 } });
    ok('BLC 70 entre 3 S iguales → 24/23/23', r3.works.map((w) => w.montoObra).join() === '24,23,23');
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let allOk = true, msg = '';
    for (let it = 0; it < 400; it++) {
        const n = 1 + Math.floor(rnd() * 6);
        const ws = [];
        for (let i = 0; i < n; i++) {
            const pub = [PUB_A, PUB_B][Math.floor(rnd() * 2)];
            const two = rnd() < 0.3;
            const shares = two ? [{ publisherId: pub, shareBp: 1 + Math.floor(rnd() * 9998) }] : [{ publisherId: pub, shareBp: 10000 }];
            if (two) shares.push({ publisherId: AUTORA, shareBp: 10000 - shares[0].shareBp });
            const S = rnd() < 0.25 ? 0 : Math.sqrt(1 + Math.floor(rnd() * 50)) * (0.4 + 0.6 * rnd());
            const from = 1 + Math.floor(rnd() * 30);
            ws.push(W(`W${i}`, { S, pub, shares, alpha: Math.round((0.05 + rnd() * 0.95) * 100) / 100, Q: 1 + Math.floor(rnd() * 9), days: rnd() < 0.2 ? [] : days(from, Math.min(30, from + Math.floor(rnd() * 30))) }));
        }
        const ins = Math.floor(rnd() * 50_000_000);
        const holds = rnd() < 0.3 ? [{ scope: rnd() < 0.5 ? 'work' : 'holder', id: rnd() < 0.5 ? 'W0' : AUTORA, reason: 'disputed' }] : [];
        try {
            const s = settle(ws, { ins: { amountCop: ins }, holds, policies: rnd() < 0.2 ? {} : POL });
            const d = s.destinations;
            const total = d.payable + d.retained + d.pendingDecision.versionSplit + d.pendingDecision.presence + d.alphaComplement + d.bgpWithoutHolders;
            const nonNeg = JSON.stringify(s).match(/"(amount|base|variable|total|montoObra|retained)":-/);
            if (!s.reconciliation.ok || total !== s.pools.brd || nonNeg) { allOk = false; msg = `it ${it}`; break; }
            allInts(s);
        } catch (e) { allOk = false; msg = `it ${it}: ${e.message}`; break; }
    }
    ok('400 liquidaciones aleatorias: enteros ≥ 0 y BRD = Σ destinos al peso', allOk, msg);
}

section('[10] reproducibilidad, inmutabilidad y validación');
{
    const ws = [W('W1', { S: 1.3 }), W('W2', { S: 0.7, pub: PUB_B })];
    const pv = P(ws);
    const snap = JSON.stringify(pv);
    const a = computeSettlement(pv, { ins: { amountCop: 123_457 }, ruleSet: RS, policies: POL, generatedAt: GEN });
    const b = computeSettlement(P([...ws].reverse()), { ins: { amountCop: 123_457 }, ruleSet: RS, policies: POL, generatedAt: GEN });
    ok('misma entrada (aunque reordenada) → mismo resultado y digest', JSON.stringify(a) === JSON.stringify(b) && /^[0-9a-f]{16}$/.test(a.trace.resultDigest));
    ok('la vista previa de entrada no se modifica', JSON.stringify(pv) === snap);
    ok('Q, R y S se copian tal cual de U2', a.works.every((w) => { const x = ws.find((y) => y.contentId === w.contentId); return w.Q === x.Q && w.R === x.R && w.S === x.S; }));
    ok('otro INS → otro digest', computeSettlement(pv, { ins: { amountCop: 123_458 }, ruleSet: RS, policies: POL }).trace.resultDigest !== a.trace.resultDigest);
    ok('enlaza el digest de U2', a.inputs.previewDigest === 'fx');
    ok('rule_set distinto → error', throws(() => computeSettlement(pv, { ins: { amountCop: 1 }, ruleSet: { ...RS, id: 'otro' } })));
    ok('INS no entero o negativo → error', throws(() => settle(ws, { ins: { amountCop: 10.5 } })) && throws(() => settle(ws, { ins: { amountCop: -1 } })));
    ok('política desconocida → error', throws(() => settle(ws, { policies: { versionSplit: 'por_tiempo' } })));
    ok('retención mal formada → error', throws(() => settle(ws, { holds: [{ scope: 'work', id: 'W1', reason: 'porque_si' }] })));
    ok('BGP + BLC ≠ 100 % → error', throws(() => settle(ws, { ruleSet: { ...RS, blcShareOfBrd: 0.6 } })));
    ok('vista previa ajena → error', throws(() => computeSettlement({ works: [] }, { ins: { amountCop: 1 }, ruleSet: RS })));
    ok('Σ S incoherente → error', throws(() => computeSettlement({ ...pv, totals: { sumS: 99 } }, { ins: { amountCop: 1 }, ruleSet: RS })));
    ok('umbral de 50.000 COP solo informativo', a.holders.every((h) => h.belowPayoutThreshold === (h.total < 50_000)));
}

section('[11] cadena real U2 → U3 (computePeriodPreview)');
{
    const ALL = Object.fromEntries(['subscription_reading', 'tts', 'ai_leo', 'offline', 'indexing', 'promo_fragments', 'cover_metadata'].map((c) => [c, true]));
    const rv = (id, contentId, o = {}) => ({ id, contentId, versionNo: 1, publisherId: o.pub ?? PUB_A, actRef: 'ACTA-FX', actSignedOn: '2026-01-01',
        validFrom: '2026-01-01', validUntil: o.validUntil ?? null, effectiveAt: '2026-01-01T05:00:00.000Z', legalStatus: o.legal ?? 'active',
        economicStatus: 'active', settlementClass: 'liquidable', alpha: 0.7, expectedMinutes: 10,
        shares: o.shares ?? [{ publisherId: o.pub ?? PUB_A, shareBp: 10000 }], permissions: ALL });
    const book = (id, pub) => ({ id, titulo: id, tipo: 'libro', status: 'disponible', publisherId: pub });
    let seq = 0;
    const read = (user, content, start, minutes, cls = 'paid_b2c') => {
        const sid = `s-${++seq}`; const t0 = Date.parse(`${start}-05:00`);
        const mk = (event, t, payload) => ({ event_id: `ev-${String(++seq).padStart(7, '0')}`, event, mode: 'pdf', user_id: user, content_id: content,
            session_id: sid, client_ts: t, server_ts: t + 2000, payload_json: JSON.stringify(payload) });
        const out = [mk('pdf.session_start', t0, { econAccess: { ruleId: 'r', commercialClass: cls } })];
        for (let s = 15; s <= minutes * 60; s += 15) out.push(mk('econ_tick', t0 + s * 1000, { windowMs: 15_000, visible: true, humanSignalAgoMs: 5_000, firstHumanSignalAgoMs: 5_000 }));
        return out;
    };
    const rows = [
        ...read('LECTOR-1', 'B1', '2026-11-03T10:00:00', 10), ...read('LECTOR-2', 'B1', '2026-11-04T10:00:00', 5),
        ...read('LECTOR-1', 'B2', '2026-11-20T10:00:00', 10),                    // B2 vencida el 15/11
        ...read('LECTOR-3', 'B3', '2026-11-05T10:00:00', 10),                    // B3 suspendida
        ...read('LECTOR-4', 'B1', '2026-11-06T10:00:00', 10, 'courtesy'),        // acceso gratuito
    ];
    const pv = computePeriodPreview({ rows, month: '2026-11', ruleSet: RS, clock: { clockSkewToleranceMs: 120_000, maxIngestDelayMs: 600_000 },
        contents: new Map([['B1', book('B1', PUB_A)], ['B2', book('B2', PUB_B)], ['B3', book('B3', PUB_B)]]),
        versionsByContent: new Map([['B1', [rv('v1', 'B1', { shares: [{ publisherId: PUB_A, shareBp: 8000 }, { publisherId: AUTORA, shareBp: 2000 }] })]],
            ['B2', [rv('v2', 'B2', { pub: PUB_B, validUntil: '2026-11-15' })]], ['B3', [rv('v3', 'B3', { pub: PUB_B, legal: 'suspended' })]]]),
        publisherHistoryByContent: new Map(), publishersById: PUBS, excludedUsers: new Map(), generatedAt: GEN });
    const s = computeSettlement(pv, { ins: { amountCop: 2_000_000 }, ruleSet: RS, policies: POL, publishersById: PUBS, generatedAt: GEN });
    ok('B1: Q = 2 pagados (la cortesía no cuenta)', Wk(s, 'B1').Q === 2 && Wk(s, 'B1').S > 0);
    ok('B2 vencida y B3 suspendida: S = 0 y MontoObra 0', Wk(s, 'B2').montoObra === 0 && Wk(s, 'B3').montoObra === 0);
    ok('B1 recibe toda la BLC (350.000)', Wk(s, 'B1').montoObra === 350_000);
    ok('presencia: A 30 días; B 15 (B2 hasta el 15/11; B3 suspendida no suma)', H(s, PUB_A).presenceDays === 30 && H(s, PUB_B).presenceDays === 15);
    ok('BGP 150.000 por presencia 30:15 → 100.000 / 50.000', H(s, PUB_A).base === 100_000 && H(s, PUB_B).base === 50_000);
    ok('matriz 80/20 de 245.000 → 196.000 / 49.000', H(s, PUB_A).variable === 196_000 && H(s, AUTORA).variable === 49_000);
    ok('conciliación OK y digest de U2 enlazado', s.reconciliation.ok && s.inputs.previewDigest === pv.trace.resultDigest);
    ok('sin identificadores de lectores', !/LECTOR-/.test(JSON.stringify(s)));
}

console.log(`\nsettlement: ${pass} ok, ${fail} fallos`);
if (fail) process.exit(1);
