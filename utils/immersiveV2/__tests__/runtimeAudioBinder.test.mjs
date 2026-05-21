/**
 * runtimeAudioBinder.test.mjs — Sprint Inmersivo V2 / Fase M-3.4.
 *
 * Tests reales del helper oficial. Stubeamos runtime con un store mock que
 * expone subscribe/getSnapshot, y stubeamos audioAdapter con un fake que
 * captura llamadas a preload.* y releaseSession.
 *
 * Cubre:
 *   - attach se subscribe e inicia con snapshot actual sin disparar release
 *   - playing → dispara preload(curr+1, curr+2)
 *   - paused → NO dispara preload
 *   - cambio de sessionId → libera URLs anterior
 *   - status='closed' (mismo sessionId) → libera URLs
 *   - cambio de currentIndex → cancelStaleAround + nuevo preload
 *   - snapshot repetido → no duplica preloads
 *   - peek hit → skip silencioso
 *   - sin getTextForIndex → skip
 *   - sin text para index → skip
 *   - dispose unsubscribe (no más eventos procesados)
 *
 * Cómo correr:
 *   node utils/immersiveV2/__tests__/runtimeAudioBinder.test.mjs
 */

import { bindRuntimeAudio } from '../runtimeAudioBinder.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('runtimeAudioBinder — Sprint M-3.4');

// ── Fakes ───────────────────────────────────────────────────────────────────

function makeFakeRuntime(initial = {}) {
    let snap = Object.freeze({
        sessionId:      null,
        contentId:      null,
        userId:         null,
        status:         'idle',
        currentIndex:   0,
        totalIndices:   0,
        lifecycleToken: null,
        lastError:      null,
        visualReady:    false,
        ...initial,
    });
    const listeners = new Set();
    return {
        getSnapshot: () => snap,
        subscribe(l) {
            listeners.add(l);
            return () => listeners.delete(l);
        },
        // Solo para tests — emite un nuevo snapshot.
        emit(patch) {
            snap = Object.freeze({ ...snap, ...patch });
            for (const l of [...listeners]) l(snap);
        },
        _listenersSize: () => listeners.size,
    };
}

function makeFakeAdapter() {
    const calls = {
        prefetch: [],
        peek:     [],
        cancelStaleAround: [],
        cancelForSession:  [],
        releaseSession:    [],
    };
    const cache = new Map();   // key sessionId:index → src
    return {
        calls,
        preload: {
            prefetch(args) {
                calls.prefetch.push(args);
                const key = `${args.session.id}:${args.index}`;
                const src = `blob:fake/${key}`;
                cache.set(key, src);
                return Promise.resolve({ ok: true, src, source: 'tts' });
            },
            peek(sessionId, index) {
                calls.peek.push({ sessionId, index });
                return cache.get(`${sessionId}:${index}`) ?? null;
            },
            cancelStaleAround(args) {
                calls.cancelStaleAround.push(args);
                return 0;
            },
            cancelForSession(sessionId) {
                calls.cancelForSession.push(sessionId);
                return 0;
            },
        },
        releaseSession(sessionId) {
            calls.releaseSession.push(sessionId);
            // Limpiamos cache para ese sessionId.
            for (const k of [...cache.keys()]) {
                if (k.startsWith(`${sessionId}:`)) cache.delete(k);
            }
            return 0;
        },
        _cacheSize: () => cache.size,
    };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
section('[1] attach inicial NO dispara release ni preload (snapshot idle)');
{
    const runtime = makeFakeRuntime();
    const adapter = makeFakeAdapter();
    const binder = bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
    });
    ok('subscribe se registró', runtime._listenersSize() === 1);
    ok('NO release (no había prevSession)', adapter.calls.releaseSession.length === 0);
    ok('NO preload (status idle)', adapter.calls.prefetch.length === 0);
    binder.dispose();
}

// ─────────────────────────────────────────────────────────────────────────────
section('[2] playing dispara preload(curr+1, curr+2) con preloadWindow=2');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'ready',
        currentIndex: 0, totalIndices: 10,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
        preloadWindow: 2,
    });
    runtime.emit({ status: 'playing' });
    ok('2 prefetches disparados',          adapter.calls.prefetch.length === 2);
    ok('prefetch[0].index=1',              adapter.calls.prefetch[0].index === 1);
    ok('prefetch[1].index=2',              adapter.calls.prefetch[1].index === 2);
    ok('prefetch.text correcto',           adapter.calls.prefetch[0].text === 'text 1');
    ok('prefetch.session.id=sA',           adapter.calls.prefetch[0].session.id === 'sA');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[3] paused NO dispara preload');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'playing',
        currentIndex: 0, totalIndices: 10,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
    });
    // Reset call counter (los pre-existentes).
    adapter.calls.prefetch.length = 0;
    runtime.emit({ status: 'paused' });
    ok('paused → 0 prefetches',          adapter.calls.prefetch.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[4] error/closed/closing NO disparan preload');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'idle',
        currentIndex: 0, totalIndices: 10,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
    });
    runtime.emit({ status: 'error' });
    ok('error → 0 prefetches',           adapter.calls.prefetch.length === 0);
    runtime.emit({ status: 'closing' });
    ok('closing → 0 prefetches',         adapter.calls.prefetch.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[5] cambio de sessionId libera URLs anteriores');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'ready',
        currentIndex: 0, totalIndices: 10,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
    });
    runtime.emit({ sessionId: 'sB', contentId: 'cB' });
    ok('releaseSession(sA) llamado',         adapter.calls.releaseSession.includes('sA'));
}

// ─────────────────────────────────────────────────────────────────────────────
section('[6] status closed (mismo sessionId) libera URLs');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'playing',
        currentIndex: 0, totalIndices: 10,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
    });
    adapter.calls.releaseSession.length = 0;
    runtime.emit({ status: 'closed' });
    ok('releaseSession(sA) llamado tras close', adapter.calls.releaseSession.includes('sA'));
}

// ─────────────────────────────────────────────────────────────────────────────
section('[7] cambio de currentIndex cancela stale + dispara nuevo preload');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'playing',
        currentIndex: 0, totalIndices: 100,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
        preloadWindow: 2,
    });
    // Reset call counters después del attach inicial.
    adapter.calls.cancelStaleAround.length = 0;
    adapter.calls.prefetch.length = 0;
    runtime.emit({ currentIndex: 50 });
    ok('cancelStaleAround llamado',              adapter.calls.cancelStaleAround.length >= 1);
    ok('cancelStaleAround.currentIndex=50',
       adapter.calls.cancelStaleAround[0].currentIndex === 50);
    ok('nuevo preload disparado para 51, 52',   adapter.calls.prefetch.length === 2);
    ok('prefetch[0].index=51',                   adapter.calls.prefetch[0].index === 51);
    ok('prefetch[1].index=52',                   adapter.calls.prefetch[1].index === 52);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[8] preload satura cerca del fin (no pasa de totalIndices-1)');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'playing',
        currentIndex: 8, totalIndices: 10,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
        preloadWindow: 2,
    });
    runtime.emit({ currentIndex: 9 });
    // Ya en 9 con total=10 → no hay siguientes válidos.
    const requestsForLastIndex = adapter.calls.prefetch
        .filter(p => p.index >= 10);
    ok('NO prefetch para index >= total',  requestsForLastIndex.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[9] snapshot repetido NO duplica preloads (cache hit en peek)');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'ready',
        currentIndex: 0, totalIndices: 10,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
        preloadWindow: 2,
    });
    runtime.emit({ status: 'playing' });
    ok('1ra vez: 2 prefetches',         adapter.calls.prefetch.length === 2);
    // Re-emit mismo status (snapshot semánticamente igual).
    runtime.emit({ status: 'playing' });
    ok('2da vez: aún 2 (cache hit)',     adapter.calls.prefetch.length === 2);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[10] sin getTextForIndex → skip preloads');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'ready',
        currentIndex: 0, totalIndices: 10,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        // getTextForIndex omitido
    });
    runtime.emit({ status: 'playing' });
    ok('0 prefetches sin getter',  adapter.calls.prefetch.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[11] getTextForIndex retorna null para index → skip ese, sigue otros');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'ready',
        currentIndex: 0, totalIndices: 10,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => i === 1 ? null : `text ${i}`,
        preloadWindow: 2,
    });
    runtime.emit({ status: 'playing' });
    // index 1 → null → skip. index 2 → text → prefetch.
    ok('1 prefetch (solo index=2)',  adapter.calls.prefetch.length === 1);
    ok('prefetch.index=2',           adapter.calls.prefetch[0].index === 2);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[12] dispose() unsubscribe; no más eventos procesados');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'ready',
        currentIndex: 0, totalIndices: 10,
    });
    const adapter = makeFakeAdapter();
    const binder = bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
    });
    binder.dispose();
    ok('subscribe removido (listenersSize=0)',  runtime._listenersSize() === 0);
    runtime.emit({ status: 'playing' });
    ok('post-dispose: 0 prefetches',            adapter.calls.prefetch.length === 0);
    // Idempotencia.
    binder.dispose();
    ok('dispose 2x no rompe',                   true);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[13] preloadWindow=1 dispara solo el siguiente clip');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'ready',
        currentIndex: 5, totalIndices: 100,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
        preloadWindow: 1,
    });
    runtime.emit({ status: 'playing' });
    ok('1 prefetch',         adapter.calls.prefetch.length === 1);
    ok('prefetch.index=6',   adapter.calls.prefetch[0].index === 6);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[14] diagnostics emite eventos clave');
{
    const events = [];
    const runtime = makeFakeRuntime({
        sessionId: null, status: 'idle', currentIndex: 0, totalIndices: 0,
    });
    const adapter = makeFakeAdapter();
    const binder = bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
        diagnostics: { log: (e) => events.push(e) },
    });
    runtime.emit({ sessionId: 'sA', contentId: 'cA', status: 'playing', currentIndex: 0, totalIndices: 5 });
    binder.dispose();
    const kinds = events.map(e => e.kind);
    ok('binder.attach emitido',           kinds.includes('binder.attach'));
    ok('binder.preload.request emitido',  kinds.includes('binder.preload.request'));
    ok('binder.dispose emitido',          kinds.includes('binder.dispose'));
}

// ─────────────────────────────────────────────────────────────────────────────
section('[15] args inválidos lanzan error explícito');
{
    let caught = null;
    try { bindRuntimeAudio({}); } catch (e) { caught = e; }
    ok('sin args throws',                  !!caught);
    ok('error.kind=invariant_violated',    caught?.kind === 'invariant_violated');
    ok('error.reason=invalid_runtime',     caught?.reason === 'invalid_runtime');

    let caught2 = null;
    const runtime = makeFakeRuntime();
    try { bindRuntimeAudio({ runtime }); } catch (e) { caught2 = e; }
    ok('sin audioAdapter throws',           !!caught2);
    ok('reason=invalid_audioAdapter',       caught2?.reason === 'invalid_audioAdapter');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[16] sin manifest/userId → prefetch igual se dispara (TTS sin manifest)');
{
    const runtime = makeFakeRuntime({
        sessionId: 'sA', contentId: 'cA', status: 'ready',
        currentIndex: 0, totalIndices: 10,
    });
    const adapter = makeFakeAdapter();
    bindRuntimeAudio({
        runtime, audioAdapter: adapter,
        getTextForIndex: (i) => `text ${i}`,
        // sin getManifest, sin getUserId, sin getFetchImpl
    });
    runtime.emit({ status: 'playing' });
    ok('prefetches disparados',    adapter.calls.prefetch.length === 2);
    ok('manifest=null en prefetch', adapter.calls.prefetch[0].manifest === null);
    ok('userId=null en prefetch',   adapter.calls.prefetch[0].userId === null);
}

console.log(`\nruntimeAudioBinder — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
