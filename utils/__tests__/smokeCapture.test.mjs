/**
 * smokeCapture.test.mjs — Cobertura del runner operacional M-5.4.2.
 *
 * Cómo correr:
 *   node utils/__tests__/smokeCapture.test.mjs
 */

import { createSmokeCapture } from '../smokeCapture.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, hint = '') {
    if (cond) { console.log('  ✓', label); pass++; }
    else      { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
}
function section(label) { console.log('\n' + label); }

function makeMockConsole() {
    const calls = { warn: [], error: [], log: [] };
    return {
        warn:  (...a) => calls.warn.push(a),
        error: (...a) => calls.error.push(a),
        log:   (...a) => calls.log.push(a),
        _calls: calls,
    };
}

function makeMockDiag(over = {}) {
    return () => ({
        sessionId: 1,
        contentId: 'test-content',
        currentSentence: 0,
        cacheMetrics: { created: 0, reused: 0, evicted: 0, revoked: 0 },
        cacheEntries: { audioCache: 0, inFlight: 0, abortCtrls: 0, audioFailedKeys: 0, audioRetriedKeys: 0, cacheInvalidatedKeys: 0 },
        ownershipTokens: { contentSession: 1, loadToken: 1, standbyGen: 1, executorSpawnCount: 1, ownershipViolationCount: 0 },
        hardResyncCount: 0,
        ...over,
    });
}

function makeMockMem(over = {}) {
    return () => ({
        heapUsed: 100 * 1024 * 1024,
        heapLimit: 1000 * 1024 * 1024,
        heapRatio: 0.1,
        audioCacheEntries: 0,
        ...over,
    });
}

section('[1] start() inicializa run + intercepta console');
{
    const cons = makeMockConsole();
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    const header = cap.start({ smoke: 'A', operator: 'test', notes: 'unit', snapshotIntervalMs: 60000 });
    ok('header.smoke === A',           header.smoke === 'A');
    ok('header.operator === test',     header.operator === 'test');
    ok('header.startTime existe',      typeof header.startTime === 'string');
    ok('warn original interceptado',   cons.warn !== cons._calls.warn);
    cap.stop({ silent: true });
}

section('[2] stop() restaura console.warn / error / log');
{
    const cons = makeMockConsole();
    const origWarn  = cons.warn;
    const origError = cons.error;
    const origLog   = cons.log;
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    cap.start({ smoke: 'A' });
    ok('warn fue reemplazado durante run',  cons.warn !== origWarn);
    cap.stop({ silent: true });
    ok('warn restaurado tras stop',         cons.warn === origWarn);
    ok('error restaurado tras stop',        cons.error === origError);
    ok('log restaurado tras stop',          cons.log === origLog);
}

section('[3] cuenta eventos por tag');
{
    const cons = makeMockConsole();
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    cap.start({ smoke: 'A' });
    cons.warn('[WATCHDOG_HEARTBEAT]', { x: 1 });
    cons.warn('[WATCHDOG_HEARTBEAT]', { x: 2 });
    cons.warn('[CACHE_ENTRY_CREATED]', { key: 0 });
    cons.error('[WATCHDOG_DESYNC_WARNING]', { reason: 'test' });
    const result = cap.stop({ silent: true });
    ok('cuenta HEARTBEAT === 2',         result.eventCounts['WATCHDOG_HEARTBEAT'] === 2);
    ok('cuenta CACHE_ENTRY_CREATED === 1', result.eventCounts['CACHE_ENTRY_CREATED'] === 1);
    ok('cuenta DESYNC_WARNING === 1',    result.eventCounts['WATCHDOG_DESYNC_WARNING'] === 1);
    ok('warningCounts.critical === 1',    result.warningCounts.critical === 1);
    ok('warningCounts.recoverable === 0', result.warningCounts.recoverable === 0);
}

section('[4] warningTimeline registra critical y recoverable, no info');
{
    const cons = makeMockConsole();
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    cap.start({ smoke: 'A' });
    cons.warn('[WATCHDOG_HEARTBEAT]', { x: 1 });           // info → NO timeline
    cons.warn('[WATCHDOG_STALLED_AUDIO]', { stalledForMs: 5000 }); // recoverable
    cons.error('[WATCHDOG_DESYNC_WARNING]', { reason: 't' });      // critical
    const result = cap.stop({ silent: true });
    ok('timeline tiene 2 entries',           result.warningTimeline.length === 2);
    const tags = result.warningTimeline.map(e => e.tag);
    ok('timeline incluye STALLED_AUDIO',     tags.includes('WATCHDOG_STALLED_AUDIO'));
    ok('timeline incluye DESYNC_WARNING',    tags.includes('WATCHDOG_DESYNC_WARNING'));
    ok('timeline NO incluye HEARTBEAT',      !tags.includes('WATCHDOG_HEARTBEAT'));
    const desync = result.warningTimeline.find(e => e.tag === 'WATCHDOG_DESYNC_WARNING');
    ok('severity de DESYNC === critical',    desync.severity === 'critical');
    const stall = result.warningTimeline.find(e => e.tag === 'WATCHDOG_STALLED_AUDIO');
    ok('severity de STALL === recoverable',  stall.severity === 'recoverable');
    ok('data del warning preservada',        stall.data && stall.data.stalledForMs === 5000);
}

section('[5] note() agrega entry al journal');
{
    const cons = makeMockConsole();
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    cap.start({ smoke: 'A' });
    cap.note('vi un hiccup al minuto 7');
    cap.note('cambio de chunk OK');
    const result = cap.stop({ silent: true });
    ok('result.notes.length === 2',       result.notes.length === 2);
    ok('first note text correcto',         result.notes[0].text === 'vi un hiccup al minuto 7');
}

section('[6] snapshot() manual agrega marker');
{
    const cons = makeMockConsole();
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    cap.start({ smoke: 'A' });
    cap.snapshot('post_first_chunk');
    const result = cap.stop({ silent: true });
    const markers = result.snapshots.map(s => s.marker).filter(Boolean);
    ok('start marker presente',           markers.includes('start'));
    ok('manual marker presente',          markers.includes('post_first_chunk'));
    ok('stop marker presente',            markers.includes('stop'));
}

section('[7] deltas: cacheCreatedDelta y heap growth');
{
    const cons = makeMockConsole();
    let createdCount = 0;
    let heap = 100 * 1024 * 1024;
    const diagFn = () => ({
        sessionId: 1, contentId: 'c', currentSentence: 0,
        cacheMetrics:   { created: createdCount, reused: 0, evicted: 0, revoked: 0 },
        cacheEntries:   { audioCache: createdCount, inFlight: 0, abortCtrls: 0, audioFailedKeys: 0, audioRetriedKeys: 0, cacheInvalidatedKeys: 0 },
        ownershipTokens:{ contentSession: 1, loadToken: 1, standbyGen: 1, executorSpawnCount: 1, ownershipViolationCount: 0 },
        hardResyncCount: 0,
    });
    const memFn = () => ({ heapUsed: heap, heapLimit: 1000 * 1024 * 1024, heapRatio: heap / (1000 * 1024 * 1024) });
    const cap = createSmokeCapture({ consoleRef: cons, diagFn, memFn });
    cap.start({ smoke: 'A' });
    createdCount = 50;
    heap = 150 * 1024 * 1024;
    const result = cap.stop({ silent: true });
    ok('cacheCreatedDelta === 50',  result.deltas.cacheCreatedDelta === 50);
    ok('cacheFinalSize === 50',     result.deltas.cacheFinalSize === 50);
    ok('heapGrowthMB === 50',       result.deltas.heapGrowthMB === 50);
}

section('[8] verdictHints: passes=true en sesión limpia');
{
    const cons = makeMockConsole();
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    cap.start({ smoke: 'A' });
    cons.warn('[WATCHDOG_HEARTBEAT]', { x: 1 });
    const result = cap.stop({ silent: true });
    ok('verdictHints.isOwnershipClean=true', result.verdictHints.isOwnershipClean === true);
    ok('verdictHints.hasCriticalEvents=false', result.verdictHints.hasCriticalEvents === false);
    ok('verdictHints.passes=true',           result.verdictHints.passes === true);
}

section('[9] verdictHints: passes=false con critical event');
{
    const cons = makeMockConsole();
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    cap.start({ smoke: 'A' });
    cons.error('[WATCHDOG_DESYNC_WARNING]', { reason: 't' });
    const result = cap.stop({ silent: true });
    ok('verdictHints.hasCriticalEvents=true', result.verdictHints.hasCriticalEvents === true);
    ok('verdictHints.passes=false',           result.verdictHints.passes === false);
}

section('[10] start() durante corrida activa cancela la anterior');
{
    const cons = makeMockConsole();
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    cap.start({ smoke: 'A' });
    cap.start({ smoke: 'B' });   // debería cancelar A primero
    const st = cap.status();
    ok('status.smoke === B (la anterior fue cancelada)', st.smoke === 'B');
    cap.stop({ silent: true });
}

section('[11] note() y snapshot() sin run activo → no-op');
{
    const cons = makeMockConsole();
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    const n1 = cap.note('no debería registrarse');
    const s1 = cap.snapshot();
    ok('note sin run → null',     n1 === null);
    ok('snapshot sin run → null', s1 === null);
}

section('[12] status() reporta estado correcto');
{
    const cons = makeMockConsole();
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    cap.start({ smoke: 'A' });
    cons.warn('[WATCHDOG_HEARTBEAT]', {});
    cons.error('[WATCHDOG_DESYNC_WARNING]', { reason: 't' });
    cap.note('algo');
    const st = cap.status();
    ok('status.active=true',         st.active === true);
    ok('status.criticalCount === 1', st.criticalCount === 1);
    ok('status.notes === 1',         st.notes === 1);
    ok('status.distinctEvents === 2', st.distinctEvents === 2);
    cap.stop({ silent: true });
}

section('[13] diag throw NO crashea — incrementa snapshotErrors');
{
    const cons = makeMockConsole();
    let calls = 0;
    const diagFn = () => {
        calls++;
        if (calls > 1) throw new Error('diag broken');
        return { cacheMetrics: { created: 0 }, cacheEntries: { audioCache: 0 }, ownershipTokens: {}, hardResyncCount: 0 };
    };
    const cap = createSmokeCapture({ consoleRef: cons, diagFn, memFn: null });
    cap.start({ smoke: 'A' });
    cap.snapshot('manual_after_break');
    const result = cap.stop({ silent: true });
    ok('snapshotErrors >= 1', result.snapshotErrors >= 1);
}

section('[14] datos no serializables se aíslan sin romper');
{
    const cons = makeMockConsole();
    const cap = createSmokeCapture({ consoleRef: cons, diagFn: makeMockDiag(), memFn: makeMockMem() });
    cap.start({ smoke: 'A' });
    const circular = /** @type {any} */ ({});
    circular.self = circular;
    cons.error('[WATCHDOG_DESYNC_WARNING]', circular);
    const result = cap.stop({ silent: true });
    const entry = result.warningTimeline.find(e => e.tag === 'WATCHDOG_DESYNC_WARNING');
    ok('entry presente',                          !!entry);
    ok('data marcada como no serializable',       entry.data && entry.data._unserializable === true);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
