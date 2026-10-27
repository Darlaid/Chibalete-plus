/**
 * settlement.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / V1.4 U3 · F4-A-01/02.
 *
 * Liquidación pura sobre vistas previas sintéticas (U2): bolsas, resto mayor,
 * S, alfa, matriz con terceros, presencia por beneficiarios sin duplicados,
 * cambios dentro del mes (D1 con sus dos alternativas), retención sin
 * redistribución (D3), complemento de alfa (D4) y BGP sin destinatario (D5)
 * como pendientes, INS=0, Q=0, conciliación al peso (también aleatoria) y
 * reproducibilidad. Incluye una cadena real U2 → U3 con computePeriodPreview.
 * Sin disco, sin bases, sin red.
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
const GEN = '2026-12-01T00:00:00.000Z';

const days = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => `2026-11-${String(from + i).padStart(2, '0')}`);
let vseq = 0;
const V = (o = {}) => ({ versionId: o.id ?? `rv-${++vseq}`, versionNo: o.no ?? 1, actRef: 'ACTA-FX', publisherId: o.pub ?? PUB_A,
    alpha: o.alpha ?? 0.7, expectedMinutes: 10, shares: o.shares ?? [{ publisherId: o.pub ?? PUB_A, shareBp: 10000 }],
    retainedReasons: o.retained ?? [], Q: o.Q ?? 1, activeSecondsQualified: o.seconds ?? 600 });
/** Obra de U2: presencia = beneficiarios de la matriz en `days` (cobrables) y en `retainedDays` (retenidos). */
const W = (id, o = {}) => {
    const shares = o.shares ?? [{ publisherId: o.pub ?? PUB_A, shareBp: 10000 }];
    const versions = o.versions ?? (o.S > 0 ? [V({ Q: o.Q ?? 1, pub: o.pub, alpha: o.alpha, shares, retained: o.retained })] : []);
    const holders = shares.map((s) => s.publisherId).sort();
    const retainedDays = o.retainedDays ?? [];
    const payDays = o.days ?? (o.retained ? [] : days(1, 30));
    const all = [...new Set([...payDays, ...retainedDays])].sort();
    return { contentId: id, title: `Obra ${id}`, tipo: 'libro', responsiblePublisherId: o.pub ?? PUB_A, publisherChanges: [],
        rightsRegime: true, eligibleDays: payDays.length, eligibleDayList: payDays,
        presenceDayList: all.map((day) => ({ day, payable: payDays.includes(day) ? holders : [], retained: payDays.includes(day) ? [] : holders })),
        Q: o.Q ?? sum(versions.map((v) => v.Q)), R: o.S > 0 ? 0.5 : null, S: o.S ?? 0, versions, flags: [] };
};
const P = (works) => ({ status: 'PROVISIONAL', month: '2026-11',
    period: { fromDay: '2026-11-01', toDay: '2026-11-30', timezone: 'America/Bogota', start: '2026-11-01T05:00:00.000Z', end: '2026-12-01T05:00:00.000Z' },
    ruleSet: { id: RS.id }, works, totals: { sumS: sum(works.map((w) => w.S)) },
    trace: { presenceDayRule: 'active_at_any_moment_of_day', presenceHolders: 'rights_version_shares', resultDigest: 'fx' } });
const settle = (works, o = {}) => computeSettlement(P(works), { ins: { amountCop: 1_000_000 }, ruleSet: RS, publishersById: PUBS, generatedAt: GEN, ...o });
const H = (s, id) => s.holders.find((h) => h.publisherId === id);
const Wk = (s, id) => s.works.find((w) => w.contentId === id);
const MONEY = ['amount', 'base', 'baseRetained', 'variable', 'variableRetained', 'total', 'montoObra', 'retained', 'alphaComplement'];
const allInts = (s) => JSON.stringify(s, (k, v) => (typeof v === 'number' && MONEY.includes(k) && !(Number.isInteger(v) && v >= 0) ? (() => { throw new Error(`${k}=${v}`); })() : v));
const brdDestinations = (s) => { const d = s.destinations; return d.payable + d.retained + d.pendingDecision.versionSplit + d.pendingDecision.alphaComplement + d.pendingDecision.bgpWithoutHolders; };

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
    ok('alfa 0,7: variable 122.500; complemento 52.500 pendiente (D4)', Wk(s, 'W1').parts[0].variable === 122_500 && s.destinations.pendingDecision.alphaComplement === 52_500);
    ok('titular único: base 75.000 + variable 122.500', H(s, PUB_A).base === 75_000 && H(s, PUB_A).variable === 122_500 && H(s, PUB_A).total === 197_500);
    ok('cobrable = 197.500; BRD = Σ destinos', s.destinations.payable === 197_500 && brdDestinations(s) === 250_000);
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
    ok('Q = 0: la BRD se reparte por presencia 30:15 → 166.667 / 83.333', H(q0, PUB_A).base === 166_667 && H(q0, PUB_B).base === 83_333 && q0.holders.every((h) => h.variable === 0));
    const mix = settle([W('W1', { S: 2 }), W('W2', { S: 0, pub: PUB_B })]);
    ok('obra con S = 0 junto a otra con S > 0: MontoObra 0 y no hay traslado', Wk(mix, 'W2').montoObra === 0 && mix.pools.blcToBgp === false && Wk(mix, 'W1').montoObra === 175_000);
    ok('…pero su titular sí tiene presencia', H(mix, PUB_B).presenceDays === 30 && H(mix, PUB_B).base === 37_500);
}

section('[4] S, alfa y matriz de terceros');
{
    const s = settle([W('W1', { S: 1 }), W('W2', { S: 3, pub: PUB_B, alpha: 0.5, shares: [{ publisherId: PUB_B, shareBp: 6000 }, { publisherId: AUTORA, shareBp: 4000 }] })]);
    ok('MontoObra proporcional a S (1:3)', Wk(s, 'W1').montoObra === 43_750 && Wk(s, 'W2').montoObra === 131_250);
    const p2 = Wk(s, 'W2').parts[0];
    ok('alfa 0,5 de 131.250 → variable 65.625 y complemento 65.625', p2.variable === 65_625 && p2.alphaComplement === 65_625);
    ok('matriz 60/40: editorial 39.375, autora 26.250', p2.shares.find((x) => x.publisherId === PUB_B).amount === 39_375 && p2.shares.find((x) => x.publisherId === AUTORA).amount === 26_250);
    ok('la autora es beneficiaria: también tiene presencia (30 días, 25.000)', H(s, AUTORA).presenceDays === 30 && H(s, AUTORA).base === 25_000 && H(s, PUB_B).base === 25_000 && H(s, PUB_A).base === 25_000);
    ok('sin doble remuneración: variable total = Σ matriz', sum(s.holders.map((h) => h.variable)) === sum(s.works.flatMap((w) => w.parts.map((p) => p.variable))));
    ok('complemento total = 13.125 + 65.625 (pendiente D4, no cobrable)', s.destinations.alphaComplement === 78_750 && s.decisions.find((d) => d.id === 'D4_ALPHA_COMPLEMENT').amountPending === 78_750);
    ok('importes enteros ≥ 0 en todo el resultado', !throws(() => allInts(s)));
}

section('[5] presencia con varios titulares y obras, sin duplicaciones');
{
    const sh = [{ publisherId: PUB_A, shareBp: 5000 }, { publisherId: AUTORA, shareBp: 5000 }];
    const s = settle([W('W1', { S: 1, shares: sh, days: days(1, 10) }), W('W2', { S: 1, shares: sh, days: days(1, 10) }), W('W3', { S: 0, pub: PUB_B, days: days(1, 30) })]);
    ok('A con dos obras los mismos 10 días cuenta 10, no 20; la autora igual', H(s, PUB_A).presenceDays === 10 && H(s, AUTORA).presenceDays === 10);
    ok('base 10:10:30 → 15.000 / 15.000 / 45.000', H(s, PUB_A).base === 15_000 && H(s, AUTORA).base === 15_000 && H(s, PUB_B).base === 45_000);
    ok('P_titular = días / días del mes', Math.abs(H(s, PUB_A).presenceShare - 10 / 30) < 1e-12);
    const u = settle([W('W1', { S: 0, days: days(1, 10) }), W('W2', { S: 0, days: days(11, 20) })]);
    ok('dos obras en días distintos: unión = 20 días', H(u, PUB_A).presenceDays === 20);
    const t = settle([W('W1', { S: 0, days: days(1, 15) }), W('W2', { S: 0, pub: PUB_B, days: days(15, 30) })]);
    ok('transición (reasignación con Acta nueva el 15): A 1–15, B 15–30', H(t, PUB_A).presenceDays === 15 && H(t, PUB_B).presenceDays === 16);
}

section('[6] D1 · alfa y matriz cambiantes dentro del mes');
{
    const same = settle([W('W1', { S: 2, Q: 4, versions: [V({ no: 1, Q: 3 }), V({ no: 2, Q: 1 })] })]);
    ok('versiones sucesivas con mismas condiciones → una parte, sin decisión', Wk(same, 'W1').parts.length === 1 && Wk(same, 'W1').parts[0].versionNos.join() === '1,2' && same.destinations.pendingDecision.versionSplit === 0);
    const diff = () => [V({ no: 1, Q: 3, seconds: 300, alpha: 0.6 }), V({ no: 2, Q: 1, seconds: 600, alpha: 0.8, shares: [{ publisherId: PUB_A, shareBp: 7000 }, { publisherId: AUTORA, shareBp: 3000 }] })];
    const pend = settle([W('W1', { S: 2, Q: 4, versions: diff() }), W('W2', { S: 2, pub: PUB_B })]);
    ok('sin política → MontoObra entero pendiente (D1), no cobrable', Wk(pend, 'W1').status === 'pending_decision' && pend.destinations.pendingDecision.versionSplit === 87_500 && pend.decisions.find((d) => d.id === 'D1_VERSION_SPLIT').needed);
    ok('…sin tocar las demás obras', Wk(pend, 'W2').montoObra === 87_500 && Wk(pend, 'W2').status === 'settled');
    ok('…y nadie cobra variable de W1', (H(pend, AUTORA)?.variable ?? 0) === 0 && H(pend, PUB_A).variable === 0);
    const q = settle([W('W1', { S: 2, Q: 4, versions: diff() })], { policies: { versionSplit: 'proportional_q' } });
    const [q1, q2] = Wk(q, 'W1').parts;
    ok('D1(a) por Q 3:1 → 131.250 / 43.750; variable 78.750 + 35.000', q1.amount === 131_250 && q2.amount === 43_750 && q1.variable === 78_750 && q2.variable === 35_000);
    ok('D1(a) autora (solo en v2, 30 %) 10.500; complemento 61.250', H(q, AUTORA).variable === 10_500 && q.destinations.alphaComplement === 61_250);
    const sec = settle([W('W1', { S: 2, Q: 4, versions: diff() })], { policies: { versionSplit: 'proportional_seconds' } });
    const [s1, s2] = Wk(sec, 'W1').parts;
    ok('D1(b) por segundos 300:600 → 58.333 / 116.667; variable 35.000 + 93.334', s1.amount === 58_333 && s2.amount === 116_667 && s1.variable === 35_000 && s2.variable === 93_334);
    ok('D1(b) autora 28.000; complemento 46.666', H(sec, AUTORA).variable === 28_000 && sec.destinations.alphaComplement === 46_666);
    ok('las lecturas de v1 no pagan a la matriz de v2', !q1.shares.some((x) => x.publisherId === AUTORA) && !s1.shares.some((x) => x.publisherId === AUTORA));
}

section('[7] D3 · controversia y retención sin redistribución');
{
    const w1 = () => W('W1', { S: 1 });
    const sh = [{ publisherId: PUB_B, shareBp: 5000 }, { publisherId: AUTORA, shareBp: 5000 }];
    const free = settle([w1(), W('W2', { S: 1, pub: PUB_B, shares: sh })]);
    const disp = settle([w1(), W('W2', { S: 1, pub: PUB_B, shares: sh, retained: ['disputed'], retainedDays: days(1, 30) })]);
    ok('versión en disputa (U2): su MontoObra queda retenido entero', Wk(disp, 'W2').retained === Wk(free, 'W2').montoObra && disp.destinations.retainedByReason.disputed === 87_500);
    ok('…y no se redistribuye: W1 recibe lo mismo (87.500, no 175.000)', Wk(disp, 'W1').montoObra === Wk(free, 'W1').montoObra && H(disp, PUB_A).total === H(free, PUB_A).total);
    ok('…su presencia se retiene para B y la autora; A no sube', H(disp, PUB_B).base === 0 && H(disp, PUB_B).baseRetained === H(free, PUB_B).base && H(disp, PUB_A).base === H(free, PUB_A).base);
    const mixed = settle([W('W1', { S: 0, days: days(1, 10) }), W('W2', { S: 0, retained: ['disputed'], retainedDays: days(5, 20) })]);
    ok('A con días cobrables (1–10) y solo retenidos (11–20): 20 días, la mitad de su base retenida', H(mixed, PUB_A).presenceDays === 20 && H(mixed, PUB_A).base === 125_000 && H(mixed, PUB_A).baseRetained === 125_000);
    const hold = settle([w1(), W('W2', { S: 1, pub: PUB_B, shares: sh })], { holds: [{ scope: 'holder', id: AUTORA, reason: 'disputed' }] });
    ok('titular en disputa declarado al liquidar: matriz y base retenidas', H(hold, AUTORA).variable === 0 && H(hold, AUTORA).base === 0 && H(hold, AUTORA).retained === H(free, AUTORA).total);
    ok('…sin aumentar la de la editorial', H(hold, PUB_B).total === H(free, PUB_B).total);
    const wh = settle([w1(), W('W2', { S: 1, pub: PUB_B, shares: sh })], { holds: [{ scope: 'work', id: 'W2', reason: 'economic_retained' }] });
    ok('obra retenida declarada: MontoObra retenido, W1 igual', Wk(wh, 'W2').retained === 87_500 && Wk(wh, 'W1').montoObra === 87_500);
    const inactive = settle([w1(), W('W2', { S: 1, pub: PUB_B, shares: sh })], { publishersById: new Map([...PUBS, [AUTORA, { id: AUTORA, status: 'inactive' }]]) });
    ok('titular no activo al liquidar → retenido «title_not_proven»', inactive.destinations.retainedByReason.title_not_proven === H(free, AUTORA).total);
    const bad = settle([W('W1', { S: 1, shares: [{ publisherId: PUB_A, shareBp: 9000 }] })]);
    ok('matriz que no suma 100 % → variable retenida «shares_incomplete»', bad.destinations.retainedByReason.shares_incomplete === Wk(bad, 'W1').parts[0].variable);
    for (const s of [disp, mixed, hold, wh, inactive, bad]) ok(`conciliación OK y BRD = Σ destinos (${Object.keys(s.destinations.retainedByReason).join('+')})`, s.reconciliation.ok && brdDestinations(s) === s.pools.brd);
}

section('[8] D4 y D5 · importes pendientes, nunca cobrables');
{
    const s = settle([W('W1', { S: 1, alpha: 0.4 })]);
    ok('complemento de alfa 0,4: 105.000 pendientes (D4), fuera de lo cobrable', s.destinations.pendingDecision.alphaComplement === 105_000 && s.destinations.payable === 75_000 + 70_000);
    const none = settle([W('W1', { S: 0, days: [] })]);
    ok('Σ S = 0 y Σ P = 0 → BRD 250.000 sin destinatario, pendiente (D5)', none.destinations.pendingDecision.bgpWithoutHolders === 250_000 && none.destinations.payable === 0
        && none.decisions.find((d) => d.id === 'D5_BGP_WITHOUT_HOLDERS').amountPending === 250_000);
    ok('sin D4 ni D5 cuando no aplican', settle([W('W1', { S: 1, alpha: 1 })]).decisions.filter((d) => d.id !== 'D1_VERSION_SPLIT').every((d) => !d.needed));
    ok('la opción responsible_publisher ya no existe (contradice el glosario)', throws(() => settle([W('W1', { S: 1 })], { policies: { presenceHolder: 'responsible_publisher' } })));
    const old = P([W('W1', { S: 1 })]); delete old.works[0].presenceDayList;
    ok('vista previa anterior a U3-02 (sin presenceDayList) → error', throws(() => computeSettlement(old, { ins: { amountCop: 1 }, ruleSet: RS })));
}

section('[9] redondeo y conciliación aleatoria al peso');
{
    const r3 = settle([W('W1', { S: 1 }), W('W2', { S: 1 }), W('W3', { S: 1 })], { ins: { amountCop: 400 } });
    ok('BLC 70 entre 3 S iguales → 24/23/23', r3.works.map((w) => w.montoObra).join() === '24,23,23');
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    let allOk = true, msg = '';
    for (let it = 0; it < 500; it++) {
        const n = 1 + Math.floor(rnd() * 6);
        const ws = [];
        for (let i = 0; i < n; i++) {
            const pub = [PUB_A, PUB_B][Math.floor(rnd() * 2)];
            const shares = [{ publisherId: pub, shareBp: 10000 }];
            if (rnd() < 0.3) { shares[0].shareBp = 1 + Math.floor(rnd() * 9998); shares.push({ publisherId: AUTORA, shareBp: 10000 - shares[0].shareBp }); }
            const S = rnd() < 0.25 ? 0 : Math.sqrt(1 + Math.floor(rnd() * 50)) * (0.4 + 0.6 * rnd());
            const from = 1 + Math.floor(rnd() * 30), to = Math.min(30, from + Math.floor(rnd() * 30));
            const alpha = Math.round((0.05 + rnd() * 0.95) * 100) / 100;
            const mode = rnd();
            if (S > 0 && mode < 0.15) {
                ws.push(W(`W${i}`, { S, Q: 4, shares, versions: [V({ no: 1, Q: 3, seconds: 200, alpha, shares }), V({ no: 2, Q: 1, seconds: 900, alpha: 1, shares })] }));
            } else if (mode < 0.3) {
                ws.push(W(`W${i}`, { S, pub, shares, alpha, retained: ['disputed'], days: days(from, from), retainedDays: days(from, to) }));
            } else {
                ws.push(W(`W${i}`, { S, pub, shares, alpha, Q: 1 + Math.floor(rnd() * 9), days: rnd() < 0.2 ? [] : days(from, to) }));
            }
        }
        const ins = Math.floor(rnd() * 50_000_000);
        const holds = rnd() < 0.3 ? [{ scope: rnd() < 0.5 ? 'work' : 'holder', id: rnd() < 0.5 ? 'W0' : AUTORA, reason: 'disputed' }] : [];
        const policies = [{}, { versionSplit: 'proportional_q' }, { versionSplit: 'proportional_seconds' }][Math.floor(rnd() * 3)];
        try {
            const s = settle(ws, { ins: { amountCop: ins }, holds, policies });
            if (!s.reconciliation.ok || brdDestinations(s) !== s.pools.brd || s.pools.brd + s.pools.insOutsideBrd !== ins) { allOk = false; msg = `it ${it}`; break; }
            allInts(s);
        } catch (e) { allOk = false; msg = `it ${it}: ${e.message}`; break; }
    }
    ok('500 liquidaciones aleatorias (retenidas, D1 a/b/pendiente, holds): enteros ≥ 0 y BRD = Σ destinos al peso', allOk, msg);
}

section('[10] reproducibilidad, inmutabilidad y validación');
{
    const ws = [W('W1', { S: 1.3 }), W('W2', { S: 0.7, pub: PUB_B })];
    const pv = P(ws);
    const snap = JSON.stringify(pv);
    const a = computeSettlement(pv, { ins: { amountCop: 123_457 }, ruleSet: RS, generatedAt: GEN });
    const b = computeSettlement(P([...ws].reverse()), { ins: { amountCop: 123_457 }, ruleSet: RS, generatedAt: GEN });
    ok('misma entrada (aunque reordenada) → mismo resultado y digest', JSON.stringify(a) === JSON.stringify(b) && /^[0-9a-f]{16}$/.test(a.trace.resultDigest));
    ok('la vista previa de entrada no se modifica', JSON.stringify(pv) === snap);
    ok('Q, R y S se copian tal cual de U2', a.works.every((w) => { const x = ws.find((y) => y.contentId === w.contentId); return w.Q === x.Q && w.R === x.R && w.S === x.S; }));
    ok('otro INS → otro digest', computeSettlement(pv, { ins: { amountCop: 123_458 }, ruleSet: RS }).trace.resultDigest !== a.trace.resultDigest);
    ok('otra política D1 → registrada en inputs y en el digest', computeSettlement(pv, { ins: { amountCop: 123_457 }, ruleSet: RS, policies: { versionSplit: 'proportional_q' } }).inputs.policies.versionSplit === 'proportional_q');
    ok('enlaza el digest de U2 y su regla de presencia', a.inputs.previewDigest === 'fx' && a.trace.presenceDayRule === 'active_at_any_moment_of_day');
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
        ...read('LECTOR-5', 'B4', '2026-11-07T10:00:00', 10),                    // B4 en disputa
    ];
    const run = (b4Legal) => computePeriodPreview({ rows, month: '2026-11', ruleSet: RS, clock: { clockSkewToleranceMs: 120_000, maxIngestDelayMs: 600_000 },
        contents: new Map([['B1', book('B1', PUB_A)], ['B2', book('B2', PUB_B)], ['B3', book('B3', PUB_B)], ['B4', book('B4', PUB_B)]]),
        versionsByContent: new Map([['B1', [rv('v1', 'B1', { shares: [{ publisherId: PUB_A, shareBp: 8000 }, { publisherId: AUTORA, shareBp: 2000 }] })]],
            ['B2', [rv('v2', 'B2', { pub: PUB_B, validUntil: '2026-11-15' })]], ['B3', [rv('v3', 'B3', { pub: PUB_B, legal: 'suspended' })]],
            ['B4', [rv('v4', 'B4', { pub: PUB_B, legal: b4Legal })]]]),
        publisherHistoryByContent: new Map(), publishersById: PUBS, excludedUsers: new Map(), generatedAt: GEN });
    const pv = run('disputed');
    const s = computeSettlement(pv, { ins: { amountCop: 2_000_000 }, ruleSet: RS, publishersById: PUBS, generatedAt: GEN });
    ok('B1: Q = 2 pagados (la cortesía no cuenta)', Wk(s, 'B1').Q === 2 && Wk(s, 'B1').S > 0);
    ok('B2 vencida y B3 suspendida: S = 0 y MontoObra 0', Wk(s, 'B2').montoObra === 0 && Wk(s, 'B3').montoObra === 0);
    ok('B4 en disputa: cuenta en Σ S y su MontoObra queda retenido', Wk(s, 'B4').S > 0 && Wk(s, 'B4').retained === Wk(s, 'B4').montoObra && Wk(s, 'B4').montoObra > 0);
    ok('B1 + B4 = BLC 350.000 (la disputa no engorda a B1)', Wk(s, 'B1').montoObra + Wk(s, 'B4').montoObra === 350_000 && Wk(s, 'B1').montoObra < 350_000);
    const active = computeSettlement(run('active'), { ins: { amountCop: 2_000_000 }, ruleSet: RS, publishersById: PUBS, generatedAt: GEN });
    ok('B1 cobra lo mismo con B4 en disputa que con B4 activa', Wk(active, 'B1').montoObra === Wk(s, 'B1').montoObra && H(active, PUB_A).total === H(s, PUB_A).total);
    ok('presencia por matriz: A 30, autora 30, B 30 (15 cobrables + 15 solo retenidos)', H(s, PUB_A).presenceDays === 30 && H(s, AUTORA).presenceDays === 30 && H(s, PUB_B).presenceDays === 30);
    ok('BGP 150.000 / 3 = 50.000; de B la mitad retenida', H(s, PUB_A).base === 50_000 && H(s, AUTORA).base === 50_000 && H(s, PUB_B).base === 25_000 && H(s, PUB_B).baseRetained === 25_000);
    ok('conciliación OK y digest de U2 enlazado', s.reconciliation.ok && brdDestinations(s) === 500_000 && s.inputs.previewDigest === pv.trace.resultDigest);
    ok('sin identificadores de lectores', !/LECTOR-/.test(JSON.stringify(s)));
}

console.log(`\nsettlement: ${pass} ok, ${fail} fallos`);
if (fail) process.exit(1);
