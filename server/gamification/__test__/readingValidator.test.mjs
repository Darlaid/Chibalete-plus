/**
 * readingValidator.test.mjs — CHP-GAMIFICACION-G4-01.
 *
 * Validador de lectura en observación, con datos sintéticos:
 *  [1] finalización prematura o artificial
 *  [2] finalización legítima por modalidad (inmersivo, guiado, PDF, álbum)
 *  [3] relectura (se evalúa el último recorrido por sí mismo)
 *  [4] evidencia insuficiente (sin eventos, EPUB, accesible, otro modo, fin no observado)
 *  [5] el ritmo no cuenta: misma lectura en 30 s o en 3 días ⇒ mismo veredicto
 *  [6] reintentos e idempotencia (registro y clave deterministas)
 *  [7] fallos del validador sin lanzar
 *  [8] stores REALES (events.db y progress.db temporales) en solo lectura
 *  [9] sin emisión, sin escrituras económicas, sin ganchos
 *
 *   node server/gamification/__test__/readingValidator.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const REAL = ['data-critical/gamification.db', 'data-critical/royalties.db'].map((p) => path.join(REPO, p));
const realBefore = REAL.map((p) => fs.existsSync(p) && crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));

const V = await import('../readingValidator.mjs');
const T0 = Date.UTC(2026, 10, 3, 14);
let n = 0;
/** Sesión sintética de un modo: fracciones de progreso observadas en orden. */
function session(mode, fractions, { start = T0, stepMs = 60_000, sessionId = `s-${++n}`, contentId = 'c-1', userId = 'u-1' } = {}) {
    const rows = [{ eventId: `e-${n}-start`, event: 'reading_started', mode, userId, contentId, sessionId, serverTs: start }];
    fractions.forEach((f, i) => rows.push({ eventId: `e-${n}-${i}`, event: i % 2 ? 'reading_progress' : 'session_heartbeat', mode, userId, contentId, sessionId,
        serverTs: start + (i + 1) * stepMs, progressFraction: f }));
    rows.push({ eventId: `e-${n}-end`, event: 'session_ended', mode, userId, contentId, sessionId, serverTs: start + (fractions.length + 1) * stepMs });
    return rows;
}
const claimAt = (rows) => Math.max(...rows.map((r) => r.serverTs)) + 1000;
const ev = (rows, { units = 40, epub = false, claim } = {}) => V.evaluateReadingCompletion({
    claim: claim ?? { userId: 'u-1', contentId: 'c-1', at: claimAt(rows), source: 'sync_100' },
    progress: { isCompleted: true, canonicalProgress: { globalPercentage: 100, totalSentences: units, ...(epub ? { epub: { fraction: 1 } } : {}) } },
    events: rows,
});
const ladder = (k) => Array.from({ length: k }, (_, i) => (i + 1) / k);

try {
    section('[1] finalización prematura o artificial');
    const pre = ev(session('immersive', [0.05, 0.1, 0.2, 0.3]));
    ok('declara fin con lo observado en 30 % ⇒ implausible (completion_far_beyond_observed_progress)', pre.verdict === 'implausible' && pre.reasons.includes('completion_far_beyond_observed_progress'), JSON.stringify(pre));
    const jump = ev(session('pdf', [0.02, 1.0]), { units: 120 });
    ok('salto directo del inicio al final en una obra de 120 páginas ⇒ implausible (jump_to_end)', jump.verdict === 'implausible' && jump.reasons.includes('jump_to_end'));
    const mid = ev(session('text', [0.1, 0.4, 0.7]));
    ok('fin no observado pero avance real (70 %) ⇒ insufficient_data, nunca implausible', mid.verdict === 'insufficient_data' && mid.reasons.includes('end_not_observed'));

    section('[2] finalización legítima por modalidad');
    for (const mode of ['immersive', 'text', 'pdf', 'album']) {
        const r = ev(session(mode, ladder(10)));
        ok(`${mode}: recorrido con avance intermedio hasta el final ⇒ plausible`, r.verdict === 'plausible' && r.features.mode === mode && r.features.maxProgressPct === 100, JSON.stringify(r));
    }
    const shortAlbum = ev(session('album', [0.34, 1.0]), { units: 3 });
    ok('álbum de 3 páginas sin observación intermedia: no se acusa salto (insufficient_data)', shortAlbum.verdict !== 'implausible', JSON.stringify(shortAlbum));
    const unknownLen = ev(session('pdf', [0.02, 1.0]), { units: 0 });
    ok('longitud desconocida: un salto no se acusa (insufficient_data)', unknownLen.verdict === 'insufficient_data' && unknownLen.reasons.includes('no_intermediate_progress'));
    const multi = ev([...session('pdf', [0.1, 0.3, 0.5], { start: T0 }), ...session('pdf', [0.6, 0.8, 1.0], { start: T0 + 2 * 86_400_000 })]);
    ok('lectura en dos sesiones y dos días ⇒ plausible, con sesiones y días contados', multi.verdict === 'plausible' && multi.features.sessions === 2 && multi.features.distinctDays === 2);

    section('[3] relectura: se evalúa el último recorrido');
    const first = session('immersive', ladder(10), { start: T0 });
    const rereadOk = ev([...first, ...session('immersive', [0.02, 0.3, 0.6, 1.0], { start: T0 + 5 * 86_400_000 })]);
    ok('relectura completa ⇒ plausible y marcada reread_segment', rereadOk.verdict === 'plausible' && rereadOk.reasons.includes('reread_segment') && rereadOk.evidenceRefs.rereadSegments === 1);
    const rereadJump = ev([...first, ...session('immersive', [0.02, 1.0], { start: T0 + 5 * 86_400_000 })]);
    ok('relectura que salta al final ⇒ implausible por sí misma (no hereda la primera lectura)', rereadJump.verdict === 'implausible' && rereadJump.reasons.includes('jump_to_end'));
    const rereadPremature = ev([...first, ...session('immersive', [0.02, 0.1, 0.2], { start: T0 + 5 * 86_400_000 })]);
    ok('relectura abandonada al 20 % y declarada terminada ⇒ implausible', rereadPremature.verdict === 'implausible');
    const backAndForth = ev(session('pdf', [0.2, 0.5, 0.4, 0.7, 1.0]));
    ok('volver atrás dentro de la misma lectura no es relectura ni penaliza (plausible, no monotónica)', backAndForth.verdict === 'plausible' && backAndForth.features.monotonic === false && !backAndForth.reasons.includes('reread_segment'));

    section('[4] evidencia insuficiente');
    const none = ev([], { claim: { userId: 'u-1', contentId: 'c-1', at: T0, source: 'complete_endpoint' } });
    ok('sin eventos de la obra ⇒ insufficient_data (no_reading_events), no implausible', none.verdict === 'insufficient_data' && none.reasons[0] === 'no_reading_events', JSON.stringify(none));
    ok('EPUB (sin telemetría de lectura) ⇒ mode_not_instrumented', ev(session('pdf', ladder(5)), { epub: true }).reasons[0] === 'mode_not_instrumented');
    ok('Accesible (a11y: sin progreso persistido ni declaración de fin) ⇒ mode_not_instrumented', ev(session('a11y', ladder(10))).reasons[0] === 'mode_not_instrumented');
    const otherMode = ev([...session('pdf', ladder(10), { start: T0 }), { eventId: 'x-last', event: 'reading_started', mode: 'immersive', userId: 'u-1', contentId: 'c-1', sessionId: 's-x', serverTs: T0 + 3_600_000 }]);
    ok('progreso solo en OTRO modo que el evaluado ⇒ insufficient_data (sin equivalencias entre modos)', otherMode.verdict === 'insufficient_data' && otherMode.reasons.includes('progress_in_other_mode_only'), JSON.stringify(otherMode));
    const noProg = ev([{ eventId: 'h1', event: 'session_heartbeat', mode: 'text', userId: 'u-1', contentId: 'c-1', sessionId: 's', serverTs: T0 }]);
    ok('sesión sin observaciones de progreso ⇒ no_progress_observations', noProg.reasons[0] === 'no_progress_observations');
    ok('events.db no disponible ⇒ events_unavailable', V.evaluateReadingCompletion({ claim: { userId: 'u-1', contentId: 'c-1', at: T0 }, progress: null, events: null }).reasons[0] === 'events_unavailable');
    const old = ev(session('pdf', ladder(10), { start: T0 - 120 * 86_400_000 }), { claim: { userId: 'u-1', contentId: 'c-1', at: T0, source: 'sync_100' } });
    ok('evidencia fuera de la ventana de retención (>90 días) no cuenta', old.reasons[0] === 'no_reading_events');
    const foreign = ev(session('pdf', ladder(10), { userId: 'u-otro' }));
    ok('eventos de OTRO usuario no cuentan', foreign.reasons[0] === 'no_reading_events');

    section('[5] el ritmo, la duración y el tiempo de pantalla no cuentan');
    const fast = ev(session('immersive', ladder(20), { stepMs: 1500 }));     // TTS rápido / avance automático: 30 s
    const slow = ev(session('immersive', ladder(20), { stepMs: 3 * 3_600_000 })); // muy lento
    ok('misma lectura en 30 s o en 60 h ⇒ mismo veredicto y mismos motivos', fast.verdict === 'plausible' && fast.verdict === slow.verdict && JSON.stringify(fast.reasons) === JSON.stringify(slow.reasons));
    ok('ningún motivo ni regla se basa en tiempo', !JSON.stringify([fast, slow]).match(/too_fast|too_slow|speed|minutes_required/) && !Object.keys(V.READING_RULES_V1).some((k) => /min(ute)?s?Active|speed|pace|duration/i.test(k)));
    const longIdle = ev(session('text', [0.1, 0.5, 1.0], { stepMs: 20 * 86_400_000 / 3 }));
    ok('pausas de días entre observaciones no penalizan', longIdle.verdict === 'plausible');

    section('[6] reintentos e idempotencia');
    const rows = session('pdf', ladder(8));
    const a = V.evaluateReadingCompletion({ claim: { userId: 'u-1', contentId: 'c-1', at: claimAt(rows), source: 'sync_100' }, progress: null, events: rows });
    const b = V.evaluateReadingCompletion({ claim: { userId: 'u-1', contentId: 'c-1', at: claimAt(rows), source: 'sync_100' }, progress: null, events: [...rows].reverse() });
    ok('misma evidencia (en cualquier orden) ⇒ mismo registro', JSON.stringify(a) === JSON.stringify(b));
    const c1 = { userId: 'u-1', contentId: 'c-1', at: claimAt(rows), source: 'sync_100' };
    const c2 = { ...c1, at: c1.at + 30_000, source: 'complete_endpoint' };
    ok('reintentos de la declaración en el mismo recorrido ⇒ misma observationKey', V.observationKey(c1, a) === V.observationKey(c2, V.evaluateReadingCompletion({ claim: c2, progress: null, events: rows })));
    const rr = [...rows, ...session('pdf', [0.01, 0.5, 1.0], { start: T0 + 86_400_000 })];
    const cR = { ...c1, at: claimAt(rr) };
    ok('una relectura posterior ⇒ observationKey distinta', V.observationKey(cR, V.evaluateReadingCompletion({ claim: cR, progress: null, events: rr })) !== V.observationKey(c1, a));
    ok('el registro trae versión de regla, motivos y referencias mínimas', a.ruleVersion === V.READING_RULE_VERSION && Array.isArray(a.reasons) && a.evidenceRefs.firstEventId && a.evidenceRefs.observations === 8);

    section('[7] fallos del validador: nunca lanza');
    const boom = () => { throw new Error('store caído'); };
    const f1 = V.observeReadingCompletion({ userId: 'u-1', contentId: 'c-1', at: T0, source: 'sync_100' }, { getEventsSince: boom, getProgressItem: boom });
    ok('lectores que lanzan ⇒ insufficient_data (events_unavailable + progress_unavailable)', f1.verdict === 'insufficient_data' && f1.reasons.includes('events_unavailable') && f1.reasons.includes('progress_unavailable'));
    const f2 = V.observeReadingCompletion({ userId: 'u-1', contentId: 'c-1', at: T0 }, { getEventsSince: () => [{ broken: true }, null, 7], getProgressItem: () => ({ canonicalProgress: 'raro' }) });
    ok('evidencia corrupta ⇒ insufficient_data sin excepción', f2.verdict === 'insufficient_data');
    ok('declaración inválida ⇒ invalid_claim', V.evaluateReadingCompletion({ claim: { userId: 'u-1' }, progress: null, events: [] }).reasons[0] === 'invalid_claim');
    ok('el registro devuelto no incluye el userId (minimización)', !('userId' in f1.claim));

    section('[8] stores reales (temporales) en solo lectura');
    const ES = await import('../../eventsService.js');
    const PS = await import('../../progressService.js');
    const evPath = process.env.EVENTS_SQLITE_PATH, prPath = process.env.PROGRESS_SQLITE_PATH;
    ok('events.db y progress.db apuntan a temporales (testMode)', /chp_test_stores_/.test(evPath) && /chp_test_stores_/.test(prPath));
    const now = Date.now();
    const real = session('pdf', ladder(6), { start: now - 3_600_000, contentId: 'c-real', userId: 'u-real' });
    for (const r of real) ES.insertEvent({ eventId: r.eventId, schemaVersion: 1, event: r.event, mode: r.mode, userId: r.userId, contentId: r.contentId,
        sessionId: r.sessionId, clientTs: r.serverTs, elapsedMs: 1000, progressFraction: r.progressFraction, payload: {} });
    PS.upsertProgress({ id: 'u-real__c-real', userId: 'u-real', contentId: 'c-real', isCompleted: true,
        canonicalProgress: { globalPercentage: 100, totalSentences: 6, lastInteractedMode: 'pdf' }, updatedAt: new Date().toISOString(), history: [] });
    const hash = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    ES.closeDb?.(); PS.closeDb?.();
    const before = [hash(evPath), hash(prPath)];
    const obs = V.observeReadingCompletion({ userId: 'u-real', contentId: 'c-real', at: now, source: 'sync_100' },
        { getEventsSince: ES.getEventsSince, getProgressItem: PS.getProgressItem });
    ok('con los lectores reales: veredicto plausible desde events.db + progress.db', obs.verdict === 'plausible' && obs.features.mode === 'pdf' && obs.evidenceRefs.observations === 6, JSON.stringify(obs));
    ES.closeDb?.(); PS.closeDb?.();
    ok('events.db y progress.db no cambiaron por la observación (solo lectura)', hash(evPath) === before[0] && hash(prPath) === before[1]);
    const prog = PS.getProgressItem('u-real', 'c-real');
    ok('la finalización canónica sigue intacta (isCompleted y 100 %)', prog.isCompleted === true && prog.canonicalProgress.globalPercentage === 100);

    section('[9] sin emisión, sin economía, sin ganchos');
    const src = fs.readFileSync(path.join(HERE, '..', 'readingValidator.mjs'), 'utf8');
    ok('el validador no importa el ledger ni la política de emisión', !/from '\.\/(ledger|policy|intake|reconcile|mookSource|db)\.mjs'/.test(src));
    ok('el validador no escribe nada (sin fs ni SQL de escritura)', !/node:fs|writeFile|INSERT|UPDATE|DELETE|upsert|insertEvent/.test(src));
    ok('el validador no toca regalías, Q/R/S ni econ_events', !/royalt|econ_|computeEconomic/.test(src));
    ok('nada del producto lo llama todavía (sin ganchos en /complete ni /sync)', !/readingValidator/.test(fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8')));
    ok('el registro no trae XP, PM, nivel ni logro', !/"(xp|pm|level|achievement)"/i.test(JSON.stringify([obs, a, pre])));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    const after = REAL.map((p) => fs.existsSync(p) && crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
    ok('gamification.db y royalties.db reales sin cambios', JSON.stringify(after) === JSON.stringify(realBefore));
}

console.log(`\nCHP-GAMIFICACION-G4-01 (validador de lectura) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
