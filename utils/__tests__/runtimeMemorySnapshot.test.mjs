/**
 * runtimeMemorySnapshot.test.mjs — Cobertura básica del helper M-5.4.1.
 *
 * Cómo correr:
 *   node utils/__tests__/runtimeMemorySnapshot.test.mjs
 */

import { getRuntimeMemorySnapshot, classifyMemorySnapshot } from '../runtimeMemorySnapshot.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, hint = '') {
    if (cond) { console.log('  ✓', label); pass++; }
    else      { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
}
function section(label) { console.log('\n' + label); }

function makeDiag(over = {}) {
    return {
        cacheEntries: { audioCache: 10, inFlight: 1, abortCtrls: 2, audioFailedKeys: 0, audioRetriedKeys: 0, cacheInvalidatedKeys: 0 },
        syncStrategy: { active: true, sessionId: 1, mode: 'perChunkNoAnchors' },
        activeTimers: { pendingAdvance: true, pendingFallback: false, pendingCanplaythrough: true },
        activeAudioSrc:  'blob:active',
        standbyAudioSrc: 'blob:standby',
        ...over,
    };
}

section('[1] snapshot lee fields de diag sin throw');
{
    const s = getRuntimeMemorySnapshot(makeDiag());
    ok('audioCacheEntries === 10', s.audioCacheEntries === 10);
    ok('inFlight === 1',            s.inFlight === 1);
    ok('abortCtrls === 2',          s.abortCtrls === 2);
    ok('executorCount === 1',       s.executorCount === 1);
    ok('pendingTimers === 2',       s.pendingTimers === 2);
    ok('listenerEstimate >= 3',     s.listenerEstimate >= 3);
    ok('now es número',             typeof s.now === 'number');
}

section('[2] sin performance.memory → heap fields null');
{
    // En node por default no hay performance.memory.
    const s = getRuntimeMemorySnapshot(makeDiag());
    // En algunos node con flag --expose-gc tampoco. Asumimos null.
    ok('heapUsed null o number',   s.heapUsed  == null || typeof s.heapUsed  === 'number');
    ok('heapLimit null o number',  s.heapLimit == null || typeof s.heapLimit === 'number');
    ok('heapRatio null o number',  s.heapRatio == null || typeof s.heapRatio === 'number');
}

section('[3] watchdogActive aumenta listenerEstimate');
{
    const s1 = getRuntimeMemorySnapshot(makeDiag(), { watchdogActive: false });
    const s2 = getRuntimeMemorySnapshot(makeDiag(), { watchdogActive: true });
    ok('s2.listenerEstimate > s1.listenerEstimate', s2.listenerEstimate > s1.listenerEstimate);
}

section('[4] diag minimal sin campos opcionales no rompe');
{
    const s = getRuntimeMemorySnapshot({});
    ok('audioCacheEntries === 0',  s.audioCacheEntries === 0);
    ok('executorCount === 0',      s.executorCount === 0);
    ok('pendingTimers === 0',      s.pendingTimers === 0);
}

section('[5] classifyMemorySnapshot: pressure por ratio alto');
{
    const cur = { heapUsed: 900, heapLimit: 1000, heapRatio: 0.9, now: 1000, heapTotal: null, audioCacheEntries: 0, inFlight: 0, abortCtrls: 0, blobUrlCount: 0, executorCount: 0, pendingTimers: 0, listenerEstimate: 2, memoryAPI: 'performance.memory' };
    const warnings = classifyMemorySnapshot(cur, null);
    ok('emite MEMORY_PRESSURE_WARNING', warnings.some(w => w.event === 'MEMORY_PRESSURE_WARNING'));
}

section('[6] classifyMemorySnapshot: growth window');
{
    const prev = { heapUsed: 100 * 1024 * 1024, heapLimit: 1000 * 1024 * 1024, heapRatio: 0.1, now: 0,    heapTotal: null, audioCacheEntries: 0, inFlight: 0, abortCtrls: 0, blobUrlCount: 0, executorCount: 0, pendingTimers: 0, listenerEstimate: 2, memoryAPI: 'performance.memory' };
    const cur  = { heapUsed: 200 * 1024 * 1024, heapLimit: 1000 * 1024 * 1024, heapRatio: 0.2, now: 30_000, heapTotal: null, audioCacheEntries: 0, inFlight: 0, abortCtrls: 0, blobUrlCount: 0, executorCount: 0, pendingTimers: 0, listenerEstimate: 2, memoryAPI: 'performance.memory' };
    const warnings = classifyMemorySnapshot(cur, prev);
    ok('emite MEMORY_GROWTH_WARNING en 30s con +100MB', warnings.some(w => w.event === 'MEMORY_GROWTH_WARNING'));
}

section('[7] classifyMemorySnapshot: growth fuera de window NO emite');
{
    const prev = { heapUsed: 100, heapLimit: 1000, heapRatio: 0.1, now: 0,       heapTotal: null, audioCacheEntries: 0, inFlight: 0, abortCtrls: 0, blobUrlCount: 0, executorCount: 0, pendingTimers: 0, listenerEstimate: 2, memoryAPI: 'performance.memory' };
    const cur  = { heapUsed: 200, heapLimit: 1000, heapRatio: 0.2, now: 999_999, heapTotal: null, audioCacheEntries: 0, inFlight: 0, abortCtrls: 0, blobUrlCount: 0, executorCount: 0, pendingTimers: 0, listenerEstimate: 2, memoryAPI: 'performance.memory' };
    const warnings = classifyMemorySnapshot(cur, prev);
    ok('NO emite growth fuera de window', !warnings.some(w => w.event === 'MEMORY_GROWTH_WARNING'));
}

section('[8] classifyMemorySnapshot: sin previous → solo pressure aplicable');
{
    const cur = { heapUsed: 100, heapLimit: 1000, heapRatio: 0.1, now: 0, heapTotal: null, audioCacheEntries: 0, inFlight: 0, abortCtrls: 0, blobUrlCount: 0, executorCount: 0, pendingTimers: 0, listenerEstimate: 2, memoryAPI: 'performance.memory' };
    const warnings = classifyMemorySnapshot(cur, null);
    ok('sin previous + ratio bajo → 0 warnings', warnings.length === 0);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
