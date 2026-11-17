/**
 * pedagogicalContextEngine.test.mjs — CHP V9 F7-C2R-U1.
 *
 * Motor de contexto pedagógico para indicadores derivados (`aulaViva/pedagogicalContext.mjs`) y su registro de
 * procedencia temporal (`aulaViva/contextLedger.mjs`), sin servidor: eventos sintéticos en un events.db temporal con el
 * esquema real y el registro en un insights.db temporal. Nunca toca data/ ni data-critical/.
 *
 *   [1] registro de procedencia              [6] evidencia insuficiente y ausencia de actividad
 *   [2] lectura del curso y compra personal  [7] equivalencia con el cálculo original
 *   [3] obra de otro curso y obra compartida [8] impacto de intervenciones
 *   [4] asignación y membresía posteriores   [9] agregado del curso
 *   [5] curso sin obras
 *
 *   node server/__test__/pedagogicalContextEngine.test.mjs
 */
import './helpers/testMode.mjs';
import assert from 'node:assert/strict';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 600)), fail++);
const same = (a, b) => { try { assert.deepStrictEqual(a, b); return true; } catch { return false; } };
const section = (t) => console.log(`\n${t}`);

const Ledger = await import('../aulaViva/contextLedger.mjs');
const Engine = await import('../aulaViva/pedagogicalContext.mjs');
const { computeUserSignals, computeUserProfile } = await import('../services/signalCompute.mjs');
const { evaluateAllRules } = await import('../pedagogy/pedagogicalRules.js');
const eventsService = await import('../eventsService.js');
const Mat = await import('../services/insightMaterializer.mjs');
const { getInsightsExtDb } = await import('../db/insightsDbExt.mjs');

const DAY = 86_400_000, NOW = Date.now(), at = (d) => NOW - d * DAY;
const edb = eventsService.getEventsDb();
let n = 0;
const ins = edb.prepare(`INSERT INTO events (event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
    VALUES (@event_id, 1, @event, 'text', @user_id, @content_id, @session_id, @ts, @ts, @elapsed_ms, NULL, @payload_json, @ts)`);
const ev = (user_id, content_id, event, ts, extra = {}) => ins.run({ event_id: `e-${++n}`, event, user_id, content_id, session_id: extra.session ?? `s-${user_id}-${content_id}-${Math.floor(ts / 3_600_000)}`,
    ts, elapsed_ms: extra.elapsed ?? null, payload_json: extra.payload ? JSON.stringify(extra.payload) : null });
/** Una sesión de lectura completa de `minutes` minutos en el día `d` (días atrás). */
const read = (u, c, d, minutes = 10) => { const t = at(d);
    ev(u, c, 'session_started', t); ev(u, c, 'reading_started', t + 1000);
    ev(u, c, 'session_heartbeat', t + minutes * 60_000, { elapsed: minutes * 60_000 }); ev(u, c, 'reading_completed', t + minutes * 60_000 + 1000); };
/** Un abandono temprano (menos del 10 %). */
const abandon = (u, c, d) => { const t = at(d); ev(u, c, 'reading_started', t); ev(u, c, 'reading_abandoned', t + 30_000, { payload: { percentage: 3 } }); };
const history = (u) => Mat.readOwnEventHistory(u, at(28));

// ── Estado de las asociaciones en el tiempo (lo que el servidor habría observado) ──
const GA = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
const state = (g1works, g1members, extra = []) => [
    { groupId: 'g1', works: g1works, members: g1members },
    { groupId: 'g2', works: ['c9', 'cs'], members: ['r1'] },
    { groupId: 'g0', works: [], members: ['rz'] },                 // curso SIN obras asociadas
    ...extra,
];
const scope = (ids, all = false) => ({ all, ids });
const ctxOf = (readerId, groups) => Engine.buildPedagogicalContext({ readerId, groups, intervals: Ledger.contextIntervals(groups.map((g) => g.groupId)) });
const G1 = (ids = ['c1', 'c2', 'cs']) => ({ groupId: 'g1', works: scope(ids) });
const G2 = { groupId: 'g2', works: scope(['c9', 'cs']) };
const compute = (readerId, groups, extra = {}) => Engine.computeContextualIndicators({ context: ctxOf(readerId, groups), events: history(readerId), nowTs: NOW, ...extra });
const idsOf = (u, pred) => edb.prepare('SELECT event_id, content_id, server_ts FROM events WHERE user_id = ? ORDER BY id').all(u).filter(pred).map((r) => r.event_id).sort();

// ── Actividad ──
// r1: obra del curso (c1), compra personal (c3, con muchos abandonos), obra de OTRO curso (c9), obra asignada después (c2)
//     y obra compartida entre dos cursos (cs).
read('r1', 'c1', 20); read('r1', 'c1', 19); read('r1', 'c1', 12); read('r1', 'c1', 6); read('r1', 'c1', 3);
for (const d of [18, 17, 16, 9, 8, 4]) abandon('r1', 'c3', d);
read('r1', 'c3', 2, 300);
read('r1', 'c9', 7);
read('r1', 'c2', 15);                       // antes de que c2 se asignara al curso (día 10)
read('r1', 'c2', 2);                        // después
read('r1', 'cs', 8);                        // cs ya era de g2, todavía no de g1 (día 5)
read('r1', 'cs', 1);
ev('r1', null, 'session_started', at(5));   // fila sin obra
// r2: toda su actividad es del curso y posterior a la línea base → debe coincidir con el cálculo original.
read('r2', 'c1', 21); read('r2', 'c1', 14); read('r2', 'c1', 9); abandon('r2', 'c1', 5); read('r2', 'c1', 2, 25);
// r3: entra al curso el día 10; había leído c1 por su cuenta el día 15.
read('r3', 'c1', 15); read('r3', 'c1', 4);
// r4: abandono alto DENTRO del curso (la recomendación debe salir con su señal).
// Mediodía UTC: los abandonos de un día caen en la MISMA fecha sea cual sea la hora a la que corra la suite.
{ const noon = (d) => Math.floor(at(d) / DAY) * DAY + DAY / 2;
  for (const d of [9, 8]) for (const k of [0, 1]) { const t = noon(d) + k * 600_000; ev('r4', 'c1', 'reading_started', t); ev('r4', 'c1', 'reading_abandoned', t + 30_000, { payload: { percentage: 3 } }); }
  ev('r4', 'c1', 'reading_started', noon(8) + 3_600_000); }
// r5: una sola fila del curso, sin inicio de lectura (poca evidencia: riesgo no calculable).
ev('r5', 'c1', 'session_started', at(3));
// r6: sin actividad.
// rz: curso sin obras; lee solo una compra personal.
read('rz', 'c3', 4); read('rz', 'c3', 2);

// ───────────────────────────── [1] registro de procedencia ─────────────────────────────
section('[1] registro de procedencia');
{
    ok('apagado por defecto: no observa', Ledger.observeContext(state(['c1'], GA)).skipped === 'disabled');
    ok('apagado: sin intervalos', Ledger.contextIntervals(['g1']).size === 0);
    const off = Engine.computeContextualIndicators({ context: Engine.buildPedagogicalContext({ readerId: 'r2', groups: [G1()], intervals: Ledger.contextIntervals(['g1']) }), events: history('r2'), nowTs: NOW });
    ok('sin registro, la actividad del curso no es atribuible: insufficient / unverifiable_history, sin perfil',
        off.result.data_state === 'insufficient' && off.result.reason === 'unverifiable_history' && off.result.profile_current === null && off.result.risks.length === 0, JSON.stringify(off.result));
    ok('apagado: el almacén no tiene la tabla del registro', !getInsightsExtDb().prepare(`SELECT name FROM sqlite_master WHERE name = 'pedagogical_context_intervals'`).get());

    process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
    const b = Ledger.observeContext(state(['c1'], ['r1', 'r2', 'r4', 'r5', 'r6']), { nowTs: at(40) });
    ok('primera observación = línea base', b.ok && b.baseline && b.opened === 1 + 5 + 2 + 1 + 1, JSON.stringify(b));
    const again = Ledger.observeContext(state(['c1'], ['r1', 'r2', 'r4', 'r5', 'r6']), { nowTs: at(39) });
    ok('idempotente: la misma observación no abre ni cierra', again.ok && again.opened === 0 && again.closed === 0 && !again.baseline);
    const empty = Ledger.observeContext([], { nowTs: at(38) });
    ok('una lectura vacía no cierra los intervalos abiertos', empty.skipped === 'empty_snapshot' && Ledger.contextIntervals(['g1']).get('g1').work.get('c1')[0].until === null);
    const later = Ledger.observeContext(state(['c1', 'c2'], [...['r1', 'r2', 'r4', 'r5', 'r6'], 'r3']), { nowTs: at(10) });      // c2 y r3 llegan el día 10
    ok('asociaciones nuevas se abren como observadas', later.opened === 2 && later.closed === 0);
    Ledger.observeContext(state(['c1', 'c2', 'cs'], GA), { nowTs: at(5) });                                                    // cs se asocia a g1 el día 5
    const iv = Ledger.contextIntervals(['g1']).get('g1');
    ok('orígenes: c1 línea base; c2, cs y r3 observados', iv.work.get('c1')[0].origin === 'baseline' && iv.work.get('c2')[0].origin === 'observed'
        && iv.work.get('cs')[0].since === at(5) && iv.member.get('r3')[0].origin === 'observed' && iv.member.get('r3')[0].since === at(10));
    // Supresión de datos de una persona: sus filas se localizan por la convención de columna (`user_id`).
    const { residualSubjectIds } = await import('../privacy/suppression.mjs');
    const none = '/nonexistent/chp-u1';
    const found = residualSubjectIds({ eventsDb: none, archiveDb: none, progressDb: none, progressJson: none, leoMemory: none, leoProfile: none, leoInteractions: none,
        leoEvidence: none, audit: none, access: none, identityDb: null, insightsDb: process.env.INSIGHTS_SQLITE_PATH });
    ok('la supresión de una persona alcanza sus filas del registro (lector solo presente aquí)', [...found].includes('r6') && ![...found].includes('c1'), JSON.stringify([...found]));
    const st = Ledger.ledgerStatus();
    ok('estado agregado sin identificadores', st.enabled && st.baseline_ts === at(40) && !/r1|c1|g1/.test(JSON.stringify(st)), JSON.stringify(st));
}

// ───────────────────────────── [2] lectura del curso y compra personal ─────────────────────────────
section('[2] lectura del curso y compra personal');
let R1;
{
    R1 = compute('r1', [G1()]);
    const expected = idsOf('r1', (r) => (r.content_id === 'c1') || (r.content_id === 'c2' && r.server_ts >= at(10)) || (r.content_id === 'cs' && r.server_ts >= at(5)));
    const crypto = await import('node:crypto');
    ok('la lectura asignada al curso contribuye', R1.result.data_state === 'ok' && R1.result.provenance.events === expected.length, JSON.stringify(R1.result.provenance));
    ok('la huella de entradas coincide con las filas del curso', R1.result.provenance.digest === crypto.createHash('sha256').update(expected.join('\n')).digest('hex'));
    ok('diversidad = obras del contexto (3), no las 5 que leyó', R1.result.signals_current.find((s) => s.signal_id === 'diversidad_lectora').metric_value === 3);
    ok('sin abandonos en el curso: abandono_temprano 0 y sin recomendación de abandono',
        R1.result.signals_current.find((s) => s.signal_id === 'abandono_temprano').metric_value === 0 && !R1.result.recommendations.some((r) => r.rule_id === 'abandono_alto'));
    const all = edb.prepare('SELECT * FROM events WHERE user_id = ? ORDER BY server_ts').all('r1');
    const global = computeUserSignals(all, { nowTs: NOW, windowDays: 28, userId: 'r1' });
    ok('el cálculo global SÍ ve los abandonos de la compra personal (contraste)', global.abandono_temprano.value > 0.3 && global.diversidad_lectora.value === 5);
    ok('el recuento de lo ajeno no figura en la salida', !/"c3"|"c9"|outside|excluded/.test(JSON.stringify(R1.result)));

    // Privacidad: multiplicar la actividad personal no cambia ni un byte del resultado.
    const before = JSON.stringify(R1.result);
    for (let i = 0; i < 40; i++) abandon('r1', 'c3', 1 + i * 0.5);
    read('r1', 'c9', 1, 200);
    const after = compute('r1', [G1()]);
    ok('40 abandonos personales y una lectura larga de otro curso: resultado idéntico', JSON.stringify(after.result) === before);
    ok('auditoría interna sin recuento de lo ajeno', same(Object.keys(after.audit).sort(), ['in_context_works', 'included', 'last_unverifiable_ts', 'outside_period', 'unverifiable']));
}

// ───────────────────────────── [3] obra de otro curso y obra compartida ─────────────────────────────
section('[3] obra de otro curso y obra compartida');
{
    const ctx = ctxOf('r1', [G1()]);
    ok('obra de otro curso: fuera del contexto', ctx.classify('c9', at(7)) === 'outside_context' && !ctx.includeContent('c9', at(7)));
    ok('compra personal: fuera del contexto', ctx.classify('c3', at(2)) === 'outside_context');
    ok('fila sin obra: no se atribuye', ctx.classify(null, at(5)) === 'no_work');
    ok('fila de otro sujeto: no entra', !ctx.includeEvent({ user_id: 'r2', content_id: 'c1', server_ts: at(3) }) && ctx.includeEvent({ user_id: 'r1', content_id: 'c1', server_ts: at(3) }));
    ok('obra compartida: en g1 solo desde que se asoció a g1', ctx.classify('cs', at(8)) === 'outside_period' && ctx.classify('cs', at(1)) === 'in');
    const both = compute('r1', [G1(), G2]);
    const g1only = compute('r1', [G1()]);
    ok('quien media los dos cursos recibe además la lectura de cs hecha en g2 y la obra de g2',
        both.result.provenance.events === g1only.result.provenance.events + 4 + idsOf('r1', (r) => r.content_id === 'c9').length, `${both.result.provenance.events} vs ${g1only.result.provenance.events}`);
    ok('sin fecha comprobable no entra', !ctx.includeContent('c1', undefined) && ctx.classify('c1', undefined) === 'unverifiable');
}

// ───────────────────────────── [4] asignación y membresía posteriores ─────────────────────────────
section('[4] asignación y membresía posteriores');
{
    ok('c2 leída antes de asignarse al curso: no se incorpora', ctxOf('r1', [G1()]).classify('c2', at(15)) === 'outside_period');
    ok('c2 leída después: se incorpora', ctxOf('r1', [G1()]).classify('c2', at(2)) === 'in');
    ok('r1: las lecturas previas a la asignación constan como excluidas en la auditoría interna', R1.audit.outside_period === 8 && R1.audit.unverifiable === 0, JSON.stringify(R1.audit));
    const r3 = compute('r3', [G1()]);
    ok('r3: lo leído antes de entrar al curso no cuenta', r3.result.data_state === 'ok' && r3.result.provenance.events === 4 && r3.audit.outside_period === 4, JSON.stringify(r3.audit));
    ok('r3: última actividad = la del curso', r3.result.profile_current.last_active_at === Math.max(...edb.prepare(`SELECT server_ts FROM events WHERE user_id = 'r3'`).all().map((r) => r.server_ts)));

    // Sale del curso y vuelve: el hueco no se atribuye; retirada y reasignación de una obra, igual.
    Ledger.observeContext(state(['c1', 'c2', 'cs'], GA.filter((x) => x !== 'r2')), { nowTs: at(4.5) });
    Ledger.observeContext(state(['c1', 'c2', 'cs'], GA), { nowTs: at(3.5) });
    const c2 = ctxOf('r2', [G1()]);
    ok('membresía interrumpida: dentro, hueco, dentro', c2.classify('c1', at(5)) === 'in' && c2.classify('c1', at(4)) === 'outside_period' && c2.classify('c1', at(2)) === 'in');
    ok('antes de la línea base: no verificable (no «fuera»)', c2.classify('c1', at(45)) === 'unverifiable');
    ok('grupo con «todas las obras»: vale el intervalo del comodín', (() => {
        Ledger.observeContext(state(['c1', 'c2', 'cs'], GA, [{ groupId: 'gall', works: [Ledger.ALL_WORKS], members: ['r1'] }]), { nowTs: at(3) });
        const c = Engine.buildPedagogicalContext({ readerId: 'r1', groups: [{ groupId: 'gall', works: scope([], true) }], intervals: Ledger.contextIntervals(['gall']) });
        return c.classify('cualquiera', at(2)) === 'in' && c.classify('cualquiera', at(6)) === 'outside_period' && c.hasWorks;
    })());
}

// ───────────────────────────── [5] curso sin obras ─────────────────────────────
section('[5] curso sin obras');
{
    const z = compute('rz', [{ groupId: 'g0', works: scope([]) }]);
    ok('estado no_course_works', z.result.data_state === 'no_course_works');
    ok('sin perfil, señales, riesgo, recomendaciones ni vector', z.result.profile_current === null && z.result.signals_current.length === 0 && z.result.risks.length === 0
        && z.result.recommendations.length === 0 && z.result.feature_vector === null && z.result.provenance === null);
    ok('su lectura personal no aparece ni como recuento', !/c3/.test(JSON.stringify(z)) && z.audit.in_context_works === 0);
}

// ───────────────────────────── [6] evidencia insuficiente y ausencia de actividad ─────────────────────────────
section('[6] evidencia insuficiente y ausencia de actividad');
{
    const r6 = compute('r6', [G1()]);
    ok('sin actividad en la ventana: no_activity, distinto de insufficient', r6.result.data_state === 'no_activity' && r6.result.reason === 'no_activity_in_window' && r6.result.profile_current === null);
    const r5 = compute('r5', [G1()]);
    ok('poca evidencia: el riesgo queda como insufficient, no como 0', r5.result.data_state === 'ok' && r5.result.profile_current.abandono_risk === null
        && r5.result.indicator_states.abandono_risk === 'insufficient' && r5.result.indicator_states.persistencia_score === 'insufficient', JSON.stringify(r5.result.indicator_states));
    ok('puntajes que el algoritmo no calcula: not_computed', r5.result.indicator_states.fluidez_score === 'not_computed' && r5.result.indicator_states.autonomia_score === 'not_computed');
    ok('poca evidencia: ninguna recomendación ni riesgo', r5.result.recommendations.length === 0 && r5.result.risks.length === 0);
    // Historia no verificable: una lectura del curso anterior a la línea base del grupo nuevo.
    Ledger.observeContext(state(['c1', 'c2', 'cs'], GA, [{ groupId: 'gall', works: [Ledger.ALL_WORKS], members: ['r1'] }, { groupId: 'gn', works: ['c1'], members: ['r2'] }]), { nowTs: at(1) });
    const closedBase = Engine.buildPedagogicalContext({ readerId: 'r2', groups: [{ groupId: 'gn', works: scope(['c1']) }], intervals: new Map([['gn', { work: new Map([['c1', [{ since: at(1), until: null, origin: 'baseline' }]]]), member: new Map([['r2', [{ since: at(1), until: null, origin: 'baseline' }]]]) }]]) });
    const unv = Engine.computeContextualIndicators({ context: closedBase, events: history('r2'), nowTs: NOW });
    ok('actividad anterior a una línea base: insufficient / unverifiable_history', unv.result.data_state === 'insufficient' && unv.result.reason === 'unverifiable_history' && unv.result.profile_current === null && unv.result.signals_current.length === 0);
    ok('indica desde cuándo será calculable', unv.result.provenance.verifiable_from === unv.audit.last_unverifiable_ts + 28 * DAY && unv.result.provenance.verifiable_from > NOW);
    const r4 = compute('r4', [G1()]);
    const rec = r4.result.recommendations.find((r) => r.rule_id === 'abandono_alto');
    ok('abandono alto dentro del curso: recomendación con su señal', !!rec && rec.explanation.signals_used.some((s) => s.id === 'abandono_temprano' && s.value >= 0.6), JSON.stringify(r4.result.recommendations));
    ok('…y riesgo activo del mismo tipo', r4.result.risks.some((r) => r.risk_type === 'abandono_alto' && r.resolved_at === null));
}

// ───────────────────────────── [7] equivalencia con el cálculo original ─────────────────────────────
section('[7] equivalencia con el cálculo original');
{
    // r2 antes de la interrupción simulada de membresía: se evalúa con un registro limpio de su curso.
    const clean = new Map([['g1', { work: new Map([['c1', [{ since: at(40), until: null, origin: 'baseline' }]]]), member: new Map([['r2', [{ since: at(40), until: null, origin: 'baseline' }]]]) }]]);
    const ctx = Engine.buildPedagogicalContext({ readerId: 'r2', groups: [G1(['c1'])], intervals: clean });
    const c = Engine.computeContextualIndicators({ context: ctx, events: history('r2'), nowTs: NOW }).result;
    const refSignals = computeUserSignals(history('r2'), { nowTs: NOW, windowDays: 28, userId: 'r2' });
    const refProfile = computeUserProfile(refSignals, { nowTs: NOW });
    ok('señales = computeUserSignals sobre las mismas filas', c.signals_current.every((s) => same(s.metric_value, typeof refSignals[s.signal_id].value === 'number' ? refSignals[s.signal_id].value : null) && s.confidence === refSignals[s.signal_id].confidence));
    ok('perfil = computeUserProfile', Object.keys(refProfile).every((k) => same(c.profile_current[k], refProfile[k])), JSON.stringify([c.profile_current, refProfile]));
    // Contra el materializador REAL: mismas filas, misma ventana, mismo instante.
    const run = Mat.runOnce({ nowTs: NOW });
    const idb = getInsightsExtDb();
    const row = idb.prepare('SELECT * FROM user_reading_profiles WHERE user_id = ?').get('r2');
    ok('el materializador global corrió', run.ok && !!row, JSON.stringify(run));
    ok('perfil contextual = fila materializada (lector con solo actividad del curso)', ['persistencia_score', 'diversidad_score', 'engagement_score', 'abandono_risk', 'last_active_at'].every((k) => same(c.profile_current[k], row[k])), JSON.stringify([c.profile_current, row]));
    const snaps = idb.prepare(`SELECT signal_id, metric_value, confidence FROM signal_snapshots WHERE scope_type = 'user' AND scope_id = 'r2'`).all();
    ok('señales contextuales = instantáneas materializadas', snaps.length > 0 && snaps.every((s) => { const m = c.signals_current.find((x) => x.signal_id === s.signal_id); return m && same(m.metric_value, s.metric_value) && m.confidence === s.confidence; }));
    const refRules = evaluateAllRules({ profile: row, snapshots: snaps, previousProfile: null, previousSnapshots: null, nowTs: NOW }).map((r) => r.rule_id).sort();
    ok('mismas reglas disparadas que sobre el perfil materializado', same(c.recommendations.map((r) => r.rule_id).sort(), refRules));
    // r1: el perfil global (contaminado) difiere del contextual, y la diferencia la explica el contexto.
    const g1row = idb.prepare('SELECT * FROM user_reading_profiles WHERE user_id = ?').get('r1');
    const c1 = compute('r1', [G1()]).result;
    ok('r1: el perfil global incluye lo personal y difiere del contextual', g1row.diversidad_score !== c1.profile_current.diversidad_score && g1row.abandono_risk !== c1.profile_current.abandono_risk);
    ok('vector de rasgos con la fórmula vigente y sin serie global', c.feature_vector.features.continuidad === refSignals.continuidad_semanal.value && c.feature_vector.features.progression_slope === null
        && c.feature_vector.features.abandono_risk === refProfile.abandono_risk);
    ok('no escribe en el almacén global', idb.prepare(`SELECT COUNT(*) AS n FROM user_reading_profiles WHERE updated_at > ?`).get(NOW).n === 0);
}

// ───────────────────────────── [8] impacto de intervenciones ─────────────────────────────
section('[8] impacto de intervenciones');
{
    const T = at(7);
    const imp = Engine.computeContextualImpact({ context: ctxOf('r1', [G1()]), events: history('r1'), interventionTs: T, interventionType: 'lectura_guiada', nowTs: NOW });
    ok('impacto calculado con las ventanas vigentes', imp.result.baseline_window.from === T - 14 * DAY && imp.result.followup_window.to === NOW && ['ok', 'insufficient'].includes(imp.result.data_state));
    ok('la línea de base no incluye la compra personal (diversidad ≤ obras del contexto)', imp.result.baseline_metrics.diversidad <= 3 && imp.result.followup_metrics.diversidad <= 3, JSON.stringify(imp.result.baseline_metrics));
    const few = Engine.computeContextualImpact({ context: ctxOf('r5', [G1()]), events: history('r5'), interventionTs: at(2), nowTs: NOW });
    ok('poca evidencia: insufficient con la etiqueta del clasificador vigente', few.result.data_state === 'insufficient' && few.result.outcome_label === 'insufficient_data');
    const none = Engine.computeContextualImpact({ context: ctxOf('rz', [{ groupId: 'g0', works: scope([]) }]), events: history('rz'), interventionTs: at(3), nowTs: NOW });
    ok('curso sin obras: sin impacto', none.result.data_state === 'no_course_works' && none.result.outcome_label === null);
}

// ───────────────────────────── [9] agregado del curso ─────────────────────────────
section('[9] agregado del curso');
{
    const clean = (u) => Engine.computeContextualIndicators({ context: ctxOf(u, [G1()]), events: history(u), nowTs: NOW }).result;
    const six = GA.map(clean);
    const agg = Engine.aggregateContextualIndicators(six);
    ok('seis lectores: agregado divulgable y sin filas por lector', agg.suppressed === false && agg.metrics.reader_cohort === 6 && !/r1|r2|user_id/.test(JSON.stringify(agg)), JSON.stringify(agg));
    ok('estados contados por separado', agg.by_state.no_activity === 1 && agg.by_state.ok === 5, JSON.stringify(agg.by_state));
    ok('un promedio sostenido por menos de cinco lectores no se publica', agg.metrics.avg_abandono_risk === null && agg.metrics.at_risk_users === null && typeof agg.metrics.avg_engagement_score === 'number', JSON.stringify(agg.metrics));
    ok('menos de cinco lectores: suprimido', same(Engine.aggregateContextualIndicators(six.slice(0, 4)), { suppressed: true, reason: 'min_cohort', minCohort: 5 }));
    const before = JSON.stringify(agg);
    for (let i = 0; i < 20; i++) abandon('r2', 'c3', 1 + i * 0.3);
    ok('la actividad personal de un miembro no cambia el agregado', JSON.stringify(Engine.aggregateContextualIndicators(GA.map(clean))) === before);
}

Ledger.closeContextLedger();
console.log(`\n${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
