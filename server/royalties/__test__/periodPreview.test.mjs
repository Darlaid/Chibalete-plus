/**
 * periodPreview.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / V1.4 U2 · F3-B-01.
 *
 * Vista previa mensual (pura) sobre fixtures sintéticos de econ_events:
 * fórmula S, equivalencia con el motor, derechos que cambian dentro del mes,
 * editorial reasignada, procedencia del acceso, exclusiones, tope diario con
 * elegibilidad por episodio, bordes de mes, mes vacío, reproducibilidad y
 * ausencia de identificadores de lectores. Sin disco, sin bases, sin red.
 */
import { computeEconomicEpisodes, RULE_SET_RS_2026_01_V1 as RS } from '../economicEpisodes.mjs';
import { computePeriodPreview, monthBounds, previewReadWindow, scoreS, PREVIEW_STATUS } from '../periodPreview.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-12;
const section = (t) => console.log(`\n${t}`);

const CLOCK = { clockSkewToleranceMs: 120_000, maxIngestDelayMs: 600_000 };
const PUB_A = 'pub-a', PUB_B = 'pub-b', HOLDER = 'pub-autora';
const PUBS = new Map([[PUB_A, { id: PUB_A, status: 'active' }], [PUB_B, { id: PUB_B, status: 'active' }], [HOLDER, { id: HOLDER, status: 'active' }]]);
const PAID = { ruleId: 'r-paid', commercialClass: 'paid_b2c' };
const book = (id, publisherId = PUB_A, extra = {}) => ({ id, titulo: `Obra ${id}`, tipo: 'libro', status: 'disponible', publisherId, ...extra });
const ALL = Object.fromEntries(['subscription_reading', 'tts', 'ai_leo', 'offline', 'indexing', 'promo_fragments', 'cover_metadata'].map((c) => [c, true]));
let vseq = 0;
const version = (contentId, o = {}) => ({
    id: o.id ?? `rv-${++vseq}`, contentId, versionNo: o.versionNo ?? 1, publisherId: o.publisherId ?? PUB_A, actRef: 'ACTA-FX',
    actSignedOn: '2026-01-01', validFrom: o.validFrom ?? '2026-01-01', validUntil: o.validUntil ?? null,
    effectiveAt: o.effectiveAt ?? '2026-01-01T05:00:00.000Z', legalStatus: o.legalStatus ?? 'active', economicStatus: o.economicStatus ?? 'active',
    settlementClass: o.settlementClass ?? 'liquidable', alpha: o.alpha ?? 0.7, expectedMinutes: o.expectedMinutes ?? 10,
    shares: o.shares ?? [{ publisherId: o.publisherId ?? PUB_A, shareBp: 10000 }], permissions: ALL,
});

// Hora de Bogotá → ms (UTC−5).
const bog = (s) => Date.parse(`${s}-05:00`);
let seq = 0;
function rows({ user = 'U1', content = 'W1', mode = 'pdf', start, minutes = 10, access = PAID }) {
    const sid = `s-${++seq}`;
    const t0 = bog(start);
    const mk = (event, t, payload) => ({ event_id: `ev-${String(++seq).padStart(7, '0')}`, event, mode, user_id: user, content_id: content,
        session_id: sid, client_ts: t, server_ts: t + 2000, payload_json: JSON.stringify(payload) });
    const out = [mk(`${mode}.session_start`, t0, { econAccess: access })];
    for (let s = 15; s <= minutes * 60; s += 15) {
        out.push(mk('econ_tick', t0 + s * 1000, { windowMs: 15_000, visible: true, humanSignalAgoMs: 5_000, firstHumanSignalAgoMs: 5_000 }));
    }
    return out;
}
const preview = (o) => computePeriodPreview({
    month: '2026-11', ruleSet: RS, clock: CLOCK, publishersById: PUBS, excludedUsers: new Map(), generatedAt: '2026-12-01T00:00:00.000Z', ...o,
});
const work = (p, id) => p.works.find((w) => w.contentId === id);

section('[1] mes, ventana de lectura y fórmula S');
{
    const b = monthBounds('2026-11');
    ok('noviembre en Bogotá: 1–30, de 05:00Z a 05:00Z', b.fromDay === '2026-11-01' && b.toDay === '2026-11-30' && b.days.length === 30
        && new Date(b.startMs).toISOString() === '2026-11-01T05:00:00.000Z' && new Date(b.endMs).toISOString() === '2026-12-01T05:00:00.000Z');
    ok('febrero bisiesto: 29 días', monthBounds('2028-02').days.length === 29);
    for (const bad of ['2026-13', '2026-1', 'noviembre', '', '2026-11-01']) {
        let threw = false; try { monthBounds(bad); } catch { threw = true; }
        ok(`mes inválido rechazado: «${bad}»`, threw);
    }
    const w = previewReadWindow('2026-11', CLOCK);
    ok('ventana = mes ± 24 h (+ retraso de ingesta al final)', w.fromServerTs === b.startMs - 86_400_000 && w.toServerTs === b.endMs + 86_400_000 + 600_000);
    ok('S(Q=0) = 0', scoreS(0, null, RS) === 0);
    ok('S(1, R=1) = 1', near(scoreS(1, 1, RS), 1));
    ok('S(4, R=0) = 0,8', near(scoreS(4, 0, RS), 0.8));
    ok('S(4, R=0,5) = 2 × 0,7 = 1,4', near(scoreS(4, 0.5, RS), 1.4));
    ok('S(9, R=1) = 3', near(scoreS(9, 1, RS), 3));
    let threw = false; try { scoreS(1, 0.5, { ...RS, scoreFormula: 'Q * R' }); } catch { threw = true; }
    ok('fórmula distinta de la Doctrina → error', threw);
    threw = false; try { preview({ rows: [], ruleSet: { ...RS, scoreFormula: 'Q' } }); } catch { threw = true; }
    ok('la vista previa también se niega con otra fórmula', threw);
}

section('[2] equivalencia con el motor (derechos estables) y obra multimodo');
{
    const rs = [
        ...rows({ content: 'W1', mode: 'pdf', start: '2026-11-03T10:00:00', minutes: 4 }),
        ...rows({ content: 'W1', mode: 'text', start: '2026-11-03T10:04:00', minutes: 3 }),
        ...rows({ content: 'W1', mode: 'a11y', start: '2026-11-03T10:07:00', minutes: 3 }),
        ...rows({ user: 'U2', content: 'W1', mode: 'epub', start: '2026-11-04T18:00:00', minutes: 5 }),
        ...rows({ user: 'U2', content: 'W2', mode: 'album', start: '2026-11-06T09:00:00', minutes: 20 }),
    ];
    const versions = new Map([['W1', [version('W1')]], ['W2', [version('W2', { expectedMinutes: 15 })]]]);
    const p = preview({ rows: rs, contents: new Map([['W1', book('W1')], ['W2', book('W2')]]), versionsByContent: versions });
    const eng = computeEconomicEpisodes(rs, { ruleSet: RS, eligibleContentIds: ['W1', 'W2'], expectedMinutesByContent: { W1: 10, W2: 15 },
        excludedUsers: {}, ...CLOCK, period: { fromDay: '2026-11-01', toDay: '2026-11-30' } });
    for (const id of ['W1', 'W2']) {
        const a = work(p, id), e = eng.works.find((x) => x.contentId === id);
        ok(`${id}: Q y R iguales a los del motor (${a.Q}, ${a.R})`, a.Q === e.Q && near(a.R, e.R), JSON.stringify({ a: [a.Q, a.R], e: [e.Q, e.R] }));
    }
    const w1 = work(p, 'W1');
    ok('W1: 3 modos seguidos = 1 episodio (Q = 2 con el de U2)', w1.Q === 2 && w1.episodes.total === 2);
    ok('W1: desglose por modo descriptivo y sin duplicar tiempo', w1.modeSeconds.pdf + w1.modeSeconds.text + w1.modeSeconds.a11y + w1.modeSeconds.epub === w1.activeSecondsQualified);
    // Franjas completas (S-4): cada sesión pierde su primera franja parcial → 4+3+3 min = 555 s; 5 min → 285 s.
    ok('W1: R = mediana(555/600, 285/600) = 0,7; S = √2 × (0,40 + 0,60 × 0,7)', near(w1.R, 0.7) && near(w1.S, Math.sqrt(2) * (0.40 + 0.60 * 0.7)), JSON.stringify([w1.R, w1.S]));
    ok('W2: 20 min / 15 esperados → r con tope 1 (retención máxima), S = 1', near(work(p, 'W2').R, 1) && near(work(p, 'W2').S, 1));
    ok('estado PROVISIONAL y versión de reglas', p.status === PREVIEW_STATUS && p.ruleSet.id === 'rs-2026-01-v1' && p.ruleSet.scoreFormula === RS.scoreFormula);
    ok('totales de control: Q = Σ Q, ΣS = Σ S', p.totals.Q === 3 && near(p.totals.sumS, w1.S + work(p, 'W2').S) && p.totals.worksWithQ === 2);
    ok('titularidad aplicable por versión (alfa, minutos, matriz)', w1.versions.length === 1 && w1.versions[0].alpha === 0.7 && w1.versions[0].shares[0].shareBp === 10000 && w1.versions[0].Q === 2);
}

section('[3] derechos que vencen y cambian dentro del mes');
{
    const v1 = version('W1', { id: 'rv-w1-1', versionNo: 1, validUntil: '2026-11-10', expectedMinutes: 10 });
    const v2 = version('W1', { id: 'rv-w1-2', versionNo: 2, validFrom: '2026-11-15', effectiveAt: '2026-11-15T05:00:00.000Z', expectedMinutes: 20,
        shares: [{ publisherId: PUB_A, shareBp: 6000 }, { publisherId: HOLDER, shareBp: 4000 }] });
    const rs = [
        ...rows({ start: '2026-11-05T10:00:00', minutes: 10 }), // v1 vigente
        ...rows({ start: '2026-11-12T10:00:00', minutes: 10 }), // v1 vencida, v2 aún no
        ...rows({ start: '2026-11-20T10:00:00', minutes: 10 }), // v2
    ];
    const p = preview({ rows: rs, contents: new Map([['W1', book('W1')]]), versionsByContent: new Map([['W1', [v1, v2]]]) });
    const w = work(p, 'W1');
    ok('Q = 2 (el episodio del día 12 no cualifica)', w.Q === 2 && w.episodes.total === 3);
    ok('motivo: rights:OUT_OF_VALIDITY', w.episodes.excludedByReason['rights:OUT_OF_VALIDITY'] === 1, JSON.stringify(w.episodes.excludedByReason));
    ok('r con los minutos de cada versión: 585 s/10 y 585 s/20 → R = (0,975 + 0,4875)/2', near(w.R, (0.975 + 0.4875) / 2), String(w.R));
    ok('desglose por versión con su matriz', w.versions.length === 2 && w.versions[0].versionId === 'rv-w1-1' && w.versions[1].shares.length === 2 && w.versions[0].Q === 1 && w.versions[1].Q === 1);
    ok('se señala el cambio de versión en el periodo', w.flags.includes('rights_version_changed_in_period'));
    ok('días elegibles: 1–10 y 15–30 = 26', w.eligibleDays === 26 && !w.eligibleDayList.includes('2026-11-12') && w.eligibleDayList.includes('2026-11-10') && w.eligibleDayList.includes('2026-11-15'));
}

section('[4] editorial reasignada durante el mes');
{
    const v = version('W2', { publisherId: PUB_A });
    const history = [{ id: 'cph-1', from: PUB_A, to: PUB_B, changedAt: '2026-11-15T15:00:00.000Z' }];
    const rs = [...rows({ content: 'W2', start: '2026-11-05T10:00:00' }), ...rows({ content: 'W2', start: '2026-11-20T10:00:00' })];
    const p = preview({ rows: rs, contents: new Map([['W2', book('W2', PUB_B)]]), versionsByContent: new Map([['W2', [v]]]),
        publisherHistoryByContent: new Map([['W2', history]]) });
    const w = work(p, 'W2');
    ok('antes del cambio cualifica con la editorial de entonces (Q = 1)', w.Q === 1);
    ok('después: PUBLISHER_MISMATCH (el Acta es de la editorial anterior)', w.episodes.excludedByReason['rights:PUBLISHER_MISMATCH'] === 1);
    ok('responsable al cierre del mes = la nueva, con el cambio listado', w.responsiblePublisherId === PUB_B && w.publisherChanges.length === 1 && w.flags.includes('publisher_changed_in_period'));
}

section('[5] procedencia del acceso y exclusiones');
{
    const cls = (c) => ({ ruleId: `r-${c}`, commercialClass: c });
    const rs = [
        ...rows({ user: 'P1', start: '2026-11-03T10:00:00', access: cls('paid_b2c') }),
        ...rows({ user: 'P2', start: '2026-11-03T11:00:00', access: cls('paid_institutional') }),
        ...rows({ user: 'F1', start: '2026-11-03T12:00:00', access: cls('courtesy') }),
        ...rows({ user: 'F2', start: '2026-11-03T13:00:00', access: cls('unclassified') }),
        ...rows({ user: 'F3', start: '2026-11-03T14:00:00', access: cls('internal') }),
        ...rows({ user: 'N1', start: '2026-11-03T15:00:00', access: null }),
        ...rows({ user: 'QA1', start: '2026-11-03T16:00:00' }),
        ...rows({ user: 'INT1', start: '2026-11-03T17:00:00' }),
        ...rows({ user: 'P1', start: '2026-11-03T18:00:00', minutes: 0.5 }), // 30 s < 45 s
    ];
    const excludedUsers = new Map([['QA1', 'current_user_excluded'], ['INT1', 'internal_p7']]);
    const p = preview({ rows: rs, contents: new Map([['W1', book('W1')]]), versionsByContent: new Map([['W1', [version('W1')]]]), excludedUsers });
    const w = work(p, 'W1');
    const ex = w.episodes.excludedByReason;
    ok('solo los dos accesos pagados cualifican (Q = 2)', w.Q === 2, JSON.stringify(ex));
    ok('gratuito, unclassified e interno por regla: no pagados, con su clase', ex['access_not_paid:courtesy'] === 1 && ex['access_not_paid:unclassified'] === 1 && ex['access_not_paid:internal'] === 1);
    ok('sin atribución: access_unattributed', ex.access_unattributed === 1);
    ok('QA e internos (P7) excluidos por usuario', ex.user_excluded === 2);
    ok('menos de 45 s activos: below_min_active', ex.below_min_active === 1);
    ok('el total de control cuadra: 9 episodios = 2 + 7 excluidos', w.episodes.total === 9 && w.episodes.total - w.Q === 7);
}

section('[6] tope diario con elegibilidad evaluada por episodio');
{
    // La versión entra en efecto a las 12:00 de Bogotá: el episodio de las 08:00 no es elegible
    // y no debe consumir uno de los 3 cupos del día.
    const v = version('W3', { effectiveAt: '2026-11-07T17:00:00.000Z', validFrom: '2026-11-07' });
    const rs = ['08', '13', '14', '15', '16'].flatMap((h) => rows({ content: 'W3', start: `2026-11-07T${h}:00:00`, minutes: 5 }));
    const p = preview({ rows: rs, contents: new Map([['W3', book('W3')]]), versionsByContent: new Map([['W3', [v]]]) });
    const w = work(p, 'W3');
    ok('08:00 sin versión en efecto (rights:NO_EFFECTIVE_VERSION)', w.episodes.excludedByReason['rights:NO_EFFECTIVE_VERSION'] === 1);
    ok('13, 14 y 15 h cualifican; 16 h queda en el tope (Q = 3)', w.Q === 3 && w.episodes.excludedByReason.daily_cap === 1, JSON.stringify(w.episodes.excludedByReason));
    const eng = computeEconomicEpisodes(rs, { ruleSet: RS, eligibleContentIds: ['W3'], expectedMinutesByContent: { W3: 10 }, excludedUsers: {}, ...CLOCK });
    ok('(el motor con una lista fija habría gastado un cupo en las 08:00)', eng.episodes.filter((e) => e.reasons.includes('daily_cap')).length === 2);
}

section('[7] bordes del mes');
{
    const rs = [
        ...rows({ start: '2026-10-31T23:50:00', minutes: 20 }), // empieza en octubre
        ...rows({ start: '2026-11-30T23:50:00', minutes: 20 }), // empieza en noviembre, termina en diciembre
    ];
    const p = preview({ rows: rs, contents: new Map([['W1', book('W1')]]), versionsByContent: new Map([['W1', [version('W1')]]]) });
    const w = work(p, 'W1');
    ok('el episodio que empezó en octubre no cuenta en noviembre', w.episodes.total === 1);
    ok('el que empieza el 30 cuenta entero, también lo de diciembre (20 min → 1185 s)', w.Q === 1 && w.activeSecondsQualified === 1185, String(w.activeSecondsQualified));
}

section('[8] obra sin lecturas, mes sin eventos y sin derechos');
{
    const p = preview({ rows: [], contents: new Map([['W1', book('W1')], ['W9', book('W9')]]), versionsByContent: new Map([['W1', [version('W1')]]]) });
    const w = work(p, 'W1');
    ok('obra con régimen y sin lecturas: Q = 0, R = null, S = 0, 30 días elegibles', w.Q === 0 && w.R === null && w.S === 0 && w.eligibleDays === 30);
    ok('obra sin régimen ni lecturas: no aparece', !work(p, 'W9'));
    ok('totales a cero', p.totals.Q === 0 && p.totals.sumS === 0 && p.totals.episodes === 0 && p.trace.rowsRead === 0);
    const empty = preview({ rows: [], contents: new Map(), versionsByContent: new Map() });
    ok('mes sin nada: works = [] y estado PROVISIONAL', empty.works.length === 0 && empty.status === 'PROVISIONAL');
    const noRights = preview({ rows: rows({ content: 'W9', start: '2026-11-03T10:00:00' }), contents: new Map([['W9', book('W9')]]), versionsByContent: new Map() });
    ok('lecturas de una obra sin derechos: Q = 0, motivo NO_RIGHTS_VERSION', work(noRights, 'W9').Q === 0 && work(noRights, 'W9').episodes.excludedByReason['rights:NO_RIGHTS_VERSION'] === 1 && work(noRights, 'W9').eligibleDays === 0);
}

section('[9] reproducibilidad y privacidad');
{
    const rs = [...rows({ user: 'lector-777', content: 'W1', start: '2026-11-03T10:00:00' }), ...rows({ user: 'lector-888', content: 'W2', start: '2026-11-04T10:00:00' })];
    const ctx = { contents: new Map([['W1', book('W1')], ['W2', book('W2')]]), versionsByContent: new Map([['W1', [version('W1')]], ['W2', [version('W2')]]]) };
    const a = preview({ rows: rs, ...ctx });
    const b = preview({ rows: [...rs].reverse(), ...ctx, generatedAt: '2027-01-01T00:00:00.000Z' });
    ok('mismas entradas en otro orden → mismo resultDigest', a.trace.resultDigest === b.trace.resultDigest && JSON.stringify(a.works) === JSON.stringify(b.works));
    ok('generatedAt fuera del digest', a.generatedAt !== b.generatedAt);
    const text = JSON.stringify(a);
    ok('sin identificadores de lectores ni de sesiones en la salida', !/lector-777|lector-888|"s-\d+"|userId|sessionId/.test(text));
    const frozen = JSON.stringify(rs);
    preview({ rows: rs, ...ctx });
    ok('no muta sus entradas', JSON.stringify(rs) === frozen);
}

section('[10] U3-02: disputa retenida (no excluida) y presencia por beneficiarios');
{
    const sh = [{ publisherId: PUB_A, shareBp: 7000 }, { publisherId: HOLDER, shareBp: 3000 }];
    const v1 = version('W1', { id: 'rv-d-1', versionNo: 1, shares: sh });
    const v2 = version('W1', { id: 'rv-d-2', versionNo: 2, effectiveAt: '2026-11-15T05:00:00.000Z', legalStatus: 'disputed', shares: sh });
    const rs = [...rows({ start: '2026-11-05T10:00:00' }), ...rows({ start: '2026-11-20T10:00:00' })];
    const p = preview({ rows: rs, contents: new Map([['W1', book('W1')]]), versionsByContent: new Map([['W1', [v1, v2]]]) });
    const w = work(p, 'W1');
    ok('versión en disputa: la lectura cuenta en Q (2) y no se excluye', w.Q === 2 && !w.episodes.excludedByReason['rights:LEGAL_DISPUTED']);
    ok('…marcada como retenida en su versión', w.versions[1].retainedReasons.join() === 'disputed' && w.versions[0].retainedReasons.length === 0 && w.flags.includes('retained_readings'));
    const d = (n) => w.presenceDayList.find((x) => x.day === `2026-11-${String(n).padStart(2, '0')}`);
    ok('presencia: beneficiarios de la matriz (editorial y tercero)', d(5).payable.join() === [HOLDER, PUB_A].sort().join() && d(5).retained.length === 0);
    ok('días en disputa: presencia retenida, no cobrable', d(20).payable.length === 0 && d(20).retained.length === 2 && w.eligibleDays === 14);
    const vs = version('W3', { legalStatus: 'suspended' });
    const ps = preview({ rows: rows({ content: 'W3', start: '2026-11-05T10:00:00' }), contents: new Map([['W3', book('W3')]]), versionsByContent: new Map([['W3', [vs]]]) });
    ok('suspendida: sigue excluida, sin presencia', work(ps, 'W3').Q === 0 && work(ps, 'W3').episodes.excludedByReason['rights:LEGAL_SUSPENDED'] === 1 && work(ps, 'W3').presenceDayList.length === 0);
    const r = version('W4', { id: 'rv-r', versionNo: 1, validUntil: '2026-11-09' });
    const m = version('W4', { id: 'rv-m', versionNo: 2, validFrom: '2026-11-12', effectiveAt: '2026-11-12T15:00:00.000Z' });
    const x = version('W4', { id: 'rv-x', versionNo: 3, effectiveAt: '2026-11-12T20:00:00.000Z', legalStatus: 'revoked' });
    const pm = preview({ rows: [], contents: new Map([['W4', book('W4')]]), versionsByContent: new Map([['W4', [r, m, x]]]) });
    ok('activa solo de 10:00 a 15:00 del día 12: el día cuenta (algún momento del día)', work(pm, 'W4').eligibleDayList.join() === [...Array.from({ length: 9 }, (_, i) => `2026-11-0${i + 1}`), '2026-11-12'].join());
    const history = [{ id: 'cph-9', from: PUB_A, to: PUB_B, changedAt: '2026-11-15T15:00:00.000Z' }];
    const pr = preview({ rows: [], contents: new Map([['W2', book('W2', PUB_B)]]), versionsByContent: new Map([['W2', [version('W2', { publisherId: PUB_A })]]]),
        publisherHistoryByContent: new Map([['W2', history]]) });
    ok('reasignada el 15 a las 10:00: presencia del Acta vigente hasta ese día (1–15)', work(pr, 'W2').eligibleDays === 15 && work(pr, 'W2').presenceDayList.at(-1).day === '2026-11-15');
    ok('regla y titulares de presencia en la traza', p.trace.presenceDayRule === 'active_at_any_moment_of_day' && p.trace.presenceHolders === 'rights_version_shares');
}

console.log(`\nperiodPreview — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
