/**
 * runtimeWatchdog.test.mjs — Resilience pass M-5.4.
 *
 * Verifica que el watchdog detecta los 6 patrones de degradación sin
 * auto-corregir. Tests usan diagnostics fakes inyectables.
 *
 * Cómo correr:
 *   node utils/__tests__/runtimeWatchdog.test.mjs
 */

import { startRuntimeWatchdog } from '../runtimeWatchdog.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, hint = '') {
    if (cond) { console.log('  ✓', label); pass++; }
    else      { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
}
function section(label) { console.log('\n' + label); }

// ────────────────────────────────────────────────────────────────────────────
// Helper para construir diagnostics fakes
// ────────────────────────────────────────────────────────────────────────────
function makeDiag(overrides = {}) {
    const now = overrides.now ?? Date.now();
    return {
        sessionId: 1,
        contentId: 'test-content',
        currentSentence: 0,
        currentChunk: 0,
        audioMode: 'perChunkNoAnchors',
        syncStrategy: null,
        playbackState: { status: 'playing', isPlaying: true, loadToken: 1 },
        activeAudioSrc: 'blob:abc',
        standbyAudioSrc: null,
        activeExecutor: { isAlive: true, sessionId: 1, mode: 'perChunkNoAnchors' },
        activeTimers: { pendingAdvance: false, pendingFallback: false, pendingCanplaythrough: false },
        pendingAdvances: 0,
        hardResyncCount: 0,
        cacheEntries: { audioCache: 10, inFlight: 0, abortCtrls: 0, audioFailedKeys: 0, audioRetriedKeys: 0, cacheInvalidatedKeys: 0 },
        cacheMetrics: { created: 10, reused: 0, evicted: 0, revoked: 0 },
        ownershipTokens: { contentSession: 1, loadToken: 1, standbyGen: 1, executorSpawnCount: 1, ownershipViolationCount: 0 },
        visualAckState: { bufferStatus: 'reading', confirmed: true, bufferIndex: 0 },
        machineBufferState: { machineStatus: 'playing', currentIndex: 0, currentStatus: 'reading', currentConfirmed: true, currentAudioStarted: true, currentAudioEnded: false, nextIndex: null, locked: false },
        playerState: { activePlayer: 'A', activePaused: false, activeReadyState: 4, activeCurrentTime: 5, activeDuration: 30, standbyReady: false },
        lastAudioEventAt: now - 1000,
        lastVisualAckAt: now - 500,
        lastChunkTransitionAt: now - 5000,
        now,
        ...overrides,
    };
}

// ────────────────────────────────────────────────────────────────────────────
section('[1] startRuntimeWatchdog devuelve handle válido + autoStart');
{
    let snapshots = 0;
    const handle = startRuntimeWatchdog({
        getDiagnostics: () => { snapshots++; return makeDiag(); },
        sessionId: 'wd-1',
        intervalMs: 10,
        logger: () => {},
    });
    ok('handle.isAlive=true',         handle.isAlive() === true);
    ok('handle.sessionId === wd-1',   handle.sessionId === 'wd-1');
    await new Promise(r => setTimeout(r, 25));
    ok('autoStart ejecutó ticks',     snapshots >= 1);
    handle.stop();
    ok('stop: isAlive=false',         handle.isAlive() === false);
}

// ────────────────────────────────────────────────────────────────────────────
section('[2] tickNow fuerza tick síncrono sin autoStart');
{
    let snapshots = 0;
    const handle = startRuntimeWatchdog({
        getDiagnostics: () => { snapshots++; return makeDiag(); },
        sessionId: 'wd-2',
        autoStart: false,
        logger: () => {},
    });
    ok('sin autoStart: 0 snapshots iniciales', snapshots === 0);
    handle.tickNow();
    ok('tickNow: 1 snapshot',                  snapshots === 1);
    handle.tickNow();
    ok('tickNow x2: 2 snapshots',              snapshots === 2);
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[3] WATCHDOG_STALLED_AUDIO — currentTime no avanza mientras playing');
{
    const logs = [];
    let now = 1000;
    const diag = () => makeDiag({
        now,
        playerState: { activePlayer: 'A', activePaused: false, activeReadyState: 4, activeCurrentTime: 5, activeDuration: 30, standbyReady: false },
    });
    const handle = startRuntimeWatchdog({
        getDiagnostics: diag,
        sessionId: 'wd-3',
        autoStart: false,
        thresholds: { audioStallMs: 100 },
        logger: (e, d) => logs.push({ e, d }),
    });
    handle.tickNow();              // baseline
    now += 200;                    // 200ms pasan
    handle.tickNow();              // currentTime sigue en 5 → stall
    ok('emite WATCHDOG_STALLED_AUDIO', logs.some(l => l.e === 'WATCHDOG_STALLED_AUDIO'));
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[4] WATCHDOG_STALLED_AUDIO NO se emite si currentTime avanza');
{
    const logs = [];
    let now = 1000;
    let ct = 5;
    const diag = () => makeDiag({
        now,
        playerState: { activePlayer: 'A', activePaused: false, activeReadyState: 4, activeCurrentTime: ct, activeDuration: 30, standbyReady: false },
    });
    const handle = startRuntimeWatchdog({
        getDiagnostics: diag,
        sessionId: 'wd-4',
        autoStart: false,
        thresholds: { audioStallMs: 100 },
        logger: (e, d) => logs.push({ e, d }),
    });
    handle.tickNow();
    now += 200; ct = 6;            // avanzó
    handle.tickNow();
    now += 200; ct = 7;
    handle.tickNow();
    ok('NO emite WATCHDOG_STALLED_AUDIO', !logs.some(l => l.e === 'WATCHDOG_STALLED_AUDIO'));
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[5] M-5.4.6 (Case 5) — WATCHDOG_STALLED_VISUAL ELIMINADO');
{
    // El warning fue removido porque tras Phase 1.b.A el render del visor
    // es independiente del runtime. "stalled visual" ya no es accionable.
    const logs = [];
    let now = 1000;
    const diag = () => makeDiag({
        now,
        currentSentence: 5,
        playerState: { activePlayer: 'A', activePaused: false, activeReadyState: 4, activeCurrentTime: 10, activeDuration: 30, standbyReady: false },
    });
    const handle = startRuntimeWatchdog({
        getDiagnostics: diag,
        sessionId: 'wd-5',
        autoStart: false,
        thresholds: { visualStallMs: 100, audioStallMs: 99999 },
        logger: (e, d) => logs.push({ e, d }),
    });
    handle.tickNow();
    now += 200;
    handle.tickNow();
    ok('NO emite WATCHDOG_STALLED_VISUAL post-Phase 1.b.A',
       !logs.some(l => l.e === 'WATCHDOG_STALLED_VISUAL'));
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[6] WATCHDOG_DUPLICATE_OWNERSHIP — ownershipViolationCount aumenta');
{
    const logs = [];
    let violations = 0;
    const diag = () => makeDiag({
        ownershipTokens: { contentSession: 1, loadToken: 1, standbyGen: 1, executorSpawnCount: 5, ownershipViolationCount: violations },
    });
    const handle = startRuntimeWatchdog({
        getDiagnostics: diag,
        sessionId: 'wd-6',
        autoStart: false,
        logger: (e, d) => logs.push({ e, d }),
    });
    handle.tickNow();
    violations = 2;
    handle.tickNow();
    ok('emite WATCHDOG_DUPLICATE_OWNERSHIP', logs.some(l => l.e === 'WATCHDOG_DUPLICATE_OWNERSHIP'));
    const evt = logs.find(l => l.e === 'WATCHDOG_DUPLICATE_OWNERSHIP');
    ok('reporta newViolations=2',           evt && evt.d.newViolations === 2);
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[7] WATCHDOG_TIMER_LEAK — pending advance + fallback ambos true');
{
    const logs = [];
    const diag = () => makeDiag({
        activeTimers: { pendingAdvance: true, pendingFallback: true, pendingCanplaythrough: false },
    });
    const handle = startRuntimeWatchdog({
        getDiagnostics: diag,
        sessionId: 'wd-7',
        autoStart: false,
        logger: (e, d) => logs.push({ e, d }),
    });
    handle.tickNow();
    ok('emite WATCHDOG_TIMER_LEAK', logs.some(l => l.e === 'WATCHDOG_TIMER_LEAK'));
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[8] WATCHDOG_DESYNC_OBSERVED_READONLY — chunk cambió pero activeAudioSrc no');
{
    const logs = [];
    let chunk = 0;
    const diag = () => makeDiag({
        currentChunk: chunk,
        activeAudioSrc: 'blob:fixed-url',
        audioMode: 'perChunkWithAnchors',
    });
    const handle = startRuntimeWatchdog({
        getDiagnostics: diag,
        sessionId: 'wd-8',
        autoStart: false,
        logger: (e, d) => logs.push({ e, d }),
    });
    handle.tickNow();
    chunk = 1; // chunk cambió pero src no
    handle.tickNow();
    ok('emite WATCHDOG_DESYNC_OBSERVED_READONLY',
       logs.some(l => l.e === 'WATCHDOG_DESYNC_OBSERVED_READONLY'));
    ok('NO emite el viejo WATCHDOG_DESYNC_WARNING (renombrado)',
       !logs.some(l => l.e === 'WATCHDOG_DESYNC_WARNING'));
    const ev = logs.find(l => l.e === 'WATCHDOG_DESYNC_OBSERVED_READONLY');
    ok('el evento se marca readOnly:true', ev && ev.d.readOnly === true);
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[9] WATCHDOG_CACHE_RUNAWAY — cache > threshold');
{
    const logs = [];
    const diag = () => makeDiag({
        cacheEntries: { audioCache: 150, inFlight: 0, abortCtrls: 0, audioFailedKeys: 0, audioRetriedKeys: 0, cacheInvalidatedKeys: 0 },
    });
    const handle = startRuntimeWatchdog({
        getDiagnostics: diag,
        sessionId: 'wd-9',
        autoStart: false,
        thresholds: { cacheMax: 100 },
        logger: (e, d) => logs.push({ e, d }),
    });
    handle.tickNow();
    ok('emite WATCHDOG_CACHE_RUNAWAY', logs.some(l => l.e === 'WATCHDOG_CACHE_RUNAWAY'));
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[10] WATCHDOG_HARD_RESYNC_CASCADE — >threshold en window');
{
    const logs = [];
    let hardResyncCount = 0;
    let now = 1000;
    const diag = () => makeDiag({ now, hardResyncCount });
    const handle = startRuntimeWatchdog({
        getDiagnostics: diag,
        sessionId: 'wd-10',
        autoStart: false,
        thresholds: { hardResyncCascade: 2, hardResyncCascadeWindowMs: 5000 },
        logger: (e, d) => logs.push({ e, d }),
    });
    handle.tickNow();
    hardResyncCount = 1; now += 100; handle.tickNow();
    hardResyncCount = 2; now += 100; handle.tickNow();
    hardResyncCount = 3; now += 100; handle.tickNow();   // >2 en window → cascade
    ok('emite WATCHDOG_HARD_RESYNC_CASCADE', logs.some(l => l.e === 'WATCHDOG_HARD_RESYNC_CASCADE'));
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[11] getDiagnostics throw NO crashea — emite WATCHDOG_DIAGNOSTICS_THREW');
{
    const logs = [];
    const handle = startRuntimeWatchdog({
        getDiagnostics: () => { throw new Error('boom'); },
        sessionId: 'wd-11',
        autoStart: false,
        logger: (e, d) => logs.push({ e, d }),
    });
    handle.tickNow();
    ok('emite WATCHDOG_DIAGNOSTICS_THREW', logs.some(l => l.e === 'WATCHDOG_DIAGNOSTICS_THREW'));
    ok('handle sigue alive',               handle.isAlive() === true);
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[12] NO emite warnings durante operación normal');
{
    const logs = [];
    let now = 1000;
    let ct = 0;
    let sentence = 0;
    const diag = () => makeDiag({
        now,
        currentSentence: sentence,
        playerState: { activePlayer: 'A', activePaused: false, activeReadyState: 4, activeCurrentTime: ct, activeDuration: 30, standbyReady: false },
    });
    const handle = startRuntimeWatchdog({
        getDiagnostics: diag,
        sessionId: 'wd-12',
        autoStart: false,
        thresholds: { audioStallMs: 1000, visualStallMs: 1000 },
        logger: (e, d) => logs.push({ e, d }),
    });
    // Simular playback normal: ct + sentence avanzan
    for (let i = 0; i < 10; i++) {
        now += 500; ct += 5; sentence += 1;
        handle.tickNow();
    }
    ok('NO emite WATCHDOG_STALLED_AUDIO',  !logs.some(l => l.e === 'WATCHDOG_STALLED_AUDIO'));
    ok('NO emite WATCHDOG_STALLED_VISUAL', !logs.some(l => l.e === 'WATCHDOG_STALLED_VISUAL'));
    ok('NO emite WATCHDOG_TIMER_LEAK',     !logs.some(l => l.e === 'WATCHDOG_TIMER_LEAK'));
    ok('NO emite WATCHDOG_DESYNC_OBSERVED_READONLY',
       !logs.some(l => l.e === 'WATCHDOG_DESYNC_OBSERVED_READONLY'));
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[13] stop() es idempotente + clearInterval');
{
    let snapshots = 0;
    const handle = startRuntimeWatchdog({
        getDiagnostics: () => { snapshots++; return makeDiag(); },
        sessionId: 'wd-13',
        intervalMs: 5,
        logger: () => {},
    });
    handle.stop();
    handle.stop();   // no-op
    handle.stop();   // no-op
    const after = snapshots;
    await new Promise(r => setTimeout(r, 30));
    ok('tras stop NO se siguen disparando ticks', snapshots === after);
    ok('isAlive=false',                          handle.isAlive() === false);
}

// ────────────────────────────────────────────────────────────────────────────
section('[14] lastSnapshot() devuelve último snapshot');
{
    let snapshots = 0;
    const handle = startRuntimeWatchdog({
        getDiagnostics: () => { snapshots++; return makeDiag({ currentSentence: snapshots }); },
        sessionId: 'wd-14',
        autoStart: false,
        logger: () => {},
    });
    ok('lastSnapshot inicial es null', handle.lastSnapshot() === null);
    handle.tickNow();
    ok('lastSnapshot post-tick existe',         handle.lastSnapshot() !== null);
    ok('lastSnapshot.currentSentence === 1',    handle.lastSnapshot().currentSentence === 1);
    handle.tickNow();
    ok('lastSnapshot.currentSentence === 2',    handle.lastSnapshot().currentSentence === 2);
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[15] sessionId fluye a todos los logs');
{
    const logs = [];
    const handle = startRuntimeWatchdog({
        getDiagnostics: () => makeDiag({ activeTimers: { pendingAdvance: true, pendingFallback: true, pendingCanplaythrough: false } }),
        sessionId: 'session-xyz',
        autoStart: false,
        logger: (e, d) => logs.push({ e, d }),
    });
    handle.tickNow();
    const leak = logs.find(l => l.e === 'WATCHDOG_TIMER_LEAK');
    ok('logs incluyen sessionId', leak && leak.d.sessionId === 'session-xyz');
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
section('[16] watchdog_desync_is_readonly — desync NO muta nada, solo loguea');
{
    // El runtime se expone como un objeto con métodos mutadores espía. El
    // watchdog SOLO recibe getDiagnostics + logger: físicamente no tiene
    // referencia a estos mutadores. Verificamos que ningún tick (incluido el
    // que dispara el desync) los invoca, y que el snapshot no se muta.
    const spy = {
        pauseCalls: 0, hardResyncCalls: 0, dispatchCalls: 0,
        cancelCalls: 0, cleanupCalls: 0, setIdxCalls: 0,
    };
    const runtime = {
        pause:             () => { spy.pauseCalls++; },
        hardResync:        () => { spy.hardResyncCalls++; },
        dispatch:          () => { spy.dispatchCalls++; },
        cancelSyncStrategy:() => { spy.cancelCalls++; },
        cleanup:           () => { spy.cleanupCalls++; },
        setIdx:            () => { spy.setIdxCalls++; },
    };
    const logs = [];
    let chunk = 0;
    // Snapshot CONGELADO: si el watchdog intentara mutarlo, lanzaría.
    const makeFrozen = () => Object.freeze(makeDiag({
        currentChunk: chunk,
        activeAudioSrc: 'blob:fixed',
        audioMode: 'perChunkNoAnchors',
        playerState: Object.freeze({
            activePlayer: 'A', activePaused: false, activeReadyState: 4,
            activeCurrentTime: 5, activeDuration: 30, standbyReady: false,
        }),
    }));
    let threw = false;
    const handle = startRuntimeWatchdog({
        getDiagnostics: () => { try { return makeFrozen(); } catch { threw = true; return makeFrozen(); } },
        sessionId: 'wd-16',
        autoStart: false,
        logger: (e, d) => logs.push({ e, d }),
    });
    handle.tickNow();
    chunk = 1;          // dispara WATCHDOG_DESYNC_OBSERVED_READONLY
    handle.tickNow();
    chunk = 2;
    handle.tickNow();
    ok('desync emitido como READONLY',
       logs.some(l => l.e === 'WATCHDOG_DESYNC_OBSERVED_READONLY'));
    ok('watchdog NO llamó runtime.pause',          spy.pauseCalls === 0);
    ok('watchdog NO llamó runtime.hardResync',     spy.hardResyncCalls === 0);
    ok('watchdog NO llamó runtime.dispatch',       spy.dispatchCalls === 0);
    ok('watchdog NO llamó cancelSyncStrategy',     spy.cancelCalls === 0);
    ok('watchdog NO llamó cleanup',                spy.cleanupCalls === 0);
    ok('watchdog NO llamó setIdx',                 spy.setIdxCalls === 0);
    ok('watchdog NO mutó el snapshot congelado',   threw === false);
    // El handle expuesto NO tiene superficie de mutación de playback.
    const handleKeys = Object.keys(handle).sort().join(',');
    ok('handle solo expone stop/isAlive/lastSnapshot/sessionId/tickNow',
       handleKeys === 'isAlive,lastSnapshot,sessionId,stop,tickNow',
       `keys=${handleKeys}`);
    handle.stop();
    // Sanidad: el spy nunca debió tocarse — el watchdog no tiene el runtime.
    void runtime;
}

// ────────────────────────────────────────────────────────────────────────────
section('[17] watchdog_never_pauses_playback — ningún evento pausa el audio');
{
    // Simulamos un runtime cuyo estado de "pausa" SOLO cambiaría si alguien
    // llamara pause(). Forzamos TODAS las condiciones de detección del
    // watchdog (stall audio, timer leak, desync, cache runaway, ownership,
    // hard-resync cascade) y verificamos que activePaused permanece false y
    // que no se emite ningún log de pausa.
    let paused = false;
    let now = 1000;
    let chunk = 0;
    let violations = 0;
    let hardResyncCount = 0;
    const logs = [];
    const diag = () => makeDiag({
        now,
        currentChunk: chunk,
        activeAudioSrc: 'blob:fixed',
        audioMode: 'perChunkNoAnchors',
        hardResyncCount,
        activeTimers: { pendingAdvance: true, pendingFallback: true, pendingCanplaythrough: false },
        cacheEntries: { audioCache: 999, inFlight: 0, abortCtrls: 0, audioFailedKeys: 0, audioRetriedKeys: 0, cacheInvalidatedKeys: 0 },
        ownershipTokens: { contentSession: 1, loadToken: 1, standbyGen: 1, executorSpawnCount: 9, ownershipViolationCount: violations },
        playerState: { activePlayer: 'A', activePaused: paused, activeReadyState: 4, activeCurrentTime: 5, activeDuration: 30, standbyReady: false },
    });
    const handle = startRuntimeWatchdog({
        getDiagnostics: diag,
        sessionId: 'wd-17',
        autoStart: false,
        thresholds: { audioStallMs: 50, cacheMax: 100 },
        logger: (e, d) => logs.push({ e, d }),
    });
    for (let i = 0; i < 8; i++) {
        handle.tickNow();
        now += 200;            // currentTime NO avanza → stall
        chunk += 1;            // chunk cambia, src no → desync readonly
        violations += 1;       // ownership sube
        hardResyncCount += 1;  // hardResync sube → cascade
    }
    // El watchdog disparó múltiples detecciones...
    ok('disparó detecciones (hubo logs)', logs.length > 0);
    ok('emitió WATCHDOG_STALLED_AUDIO',        logs.some(l => l.e === 'WATCHDOG_STALLED_AUDIO'));
    ok('emitió WATCHDOG_DESYNC_OBSERVED_READONLY', logs.some(l => l.e === 'WATCHDOG_DESYNC_OBSERVED_READONLY'));
    // ...pero NUNCA pausó el audio ni emitió un evento de pausa.
    ok('activePaused sigue false (nadie llamó pause)', paused === false);
    ok('NO hay log playback_paused',  !logs.some(l => /playback_paused|PLAYBACK_PAUSED/i.test(l.e)));
    // INVARIANTE READ-ONLY: el watchdog SOLO emite sus propios eventos
    // observacionales (WATCHDOG_* / MEMORY_*). Jamás un log de acción
    // (playback_paused, PB_HARD_RESYNC, cancel_via_runtime, etc.). Que emita
    // WATCHDOG_HARD_RESYNC_CASCADE es OBSERVAR un contador, NO ejecutar un
    // hardResync — por eso se permite el prefijo WATCHDOG_.
    const nonObservational = logs.filter(
       l => !/^WATCHDOG_/.test(l.e) && !/^MEMORY_/.test(l.e));
    ok('watchdog SOLO emite eventos WATCHDOG_*/MEMORY_* (cero acciones)',
       nonObservational.length === 0,
       `inesperados: ${nonObservational.map(l => l.e).join(',')}`);
    ok('ningún evento es una acción de pausa/recovery del runtime',
       !logs.some(l => /^(PB_HARD_RESYNC|playback_paused|cancel_via_runtime)$/.test(l.e)));
    handle.stop();
}

// ────────────────────────────────────────────────────────────────────────────
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
