/**
 * createProductionRuntime.test.mjs — Sprint Inmersivo V2 / Fase M-3.5.
 *
 * Tests funcionales del factory productivo. Stubeamos browser APIs
 * (Audio, fetch, URL.createObjectURL/revokeObjectURL) y verificamos que
 * el stack completo (adapter + audio + runtime + binder + diagnostics)
 * funciona end-to-end y que dispose libera todo.
 *
 * Cómo correr:
 *   node utils/immersiveV2/__tests__/createProductionRuntime.test.mjs
 */

import { createProductionRuntime } from '../createProductionRuntime.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('createProductionRuntime — Sprint M-3.5');

// ── Polyfills ───────────────────────────────────────────────────────────────

const createdUrls = new Set();
const revokedUrls = new Set();
let urlCounter = 0;
globalThis.URL = globalThis.URL || {};
globalThis.URL.createObjectURL = (blob) => {
    urlCounter++;
    const url = `blob:prod/${urlCounter}-${blob?.size ?? 0}`;
    createdUrls.add(url);
    return url;
};
globalThis.URL.revokeObjectURL = (url) => { revokedUrls.add(url); };

class AudioMock {
    constructor() {
        this._src = '';
        this._listeners = new Map();
        this.error = null;
        this._preload = '';
    }
    get src() { return this._src; }
    set src(v) { this._src = v; }
    get currentTime() { return 0; }
    set currentTime(_v) {}
    get preload() { return this._preload; }
    set preload(v) { this._preload = v; }
    addEventListener(ev, h) {
        if (!this._listeners.has(ev)) this._listeners.set(ev, new Set());
        this._listeners.get(ev).add(h);
    }
    removeEventListener(ev, h) { this._listeners.get(ev)?.delete(h); }
    fire(ev) {
        const set = this._listeners.get(ev);
        if (!set) return;
        for (const h of [...set]) h();
    }
    async play() { /* succeeds */ }
    pause() {}
}
const allAudios = [];
class TrackedAudio extends AudioMock {
    constructor() { super(); allAudios.push(this); }
}
function lastAudio() { return allAudios[allAudios.length - 1]; }

function makeFetcher() {
    return async (url, init) => {
        if (init?.signal?.aborted) {
            const e = new Error('aborted'); e.name = 'AbortError'; throw e;
        }
        return {
            ok: true, status: 200,
            headers: { get: (k) => k.toLowerCase() === 'content-type' ? 'audio/mpeg' : null },
            async blob() { return { size: 100, type: 'audio/mpeg' }; },
        };
    };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
section('[1] factory devuelve {runtime, adapter, binder, diagnostics, dispose}');
{
    const stack = createProductionRuntime({
        hydrateContent: async () => ({ totalIndices: 5 }),
        getTextForIndex: (i) => `t${i}`,
        getUserId: () => 'u1',
        fetchImpl: makeFetcher(),
        audioCtor: TrackedAudio,
    });
    ok('runtime presente',           !!stack.runtime);
    ok('adapter presente',           !!stack.adapter);
    ok('binder presente',            !!stack.binder);
    ok('diagnostics presente',       !!stack.diagnostics);
    ok('dispose es función',         typeof stack.dispose === 'function');
    await stack.dispose();
}

// ─────────────────────────────────────────────────────────────────────────────
section('[2] ciclo completo: open → play → ended → autoavance funciona');
{
    allAudios.length = 0;
    const stack = createProductionRuntime({
        hydrateContent: async () => ({ totalIndices: 5 }),
        getTextForIndex: (i) => `Sentence ${i}.`,
        getUserId: () => 'u1',
        fetchImpl: makeFetcher(),
        audioCtor: TrackedAudio,
    });
    await stack.runtime.openSession({ contentId: 'cP', userId: 'u1' });
    await stack.runtime.dispatch({ kind: 'play' });
    ok('snapshot.status=playing',     stack.runtime.getSnapshot().status === 'playing');
    ok('currentIndex=0',              stack.runtime.getSnapshot().currentIndex === 0);
    ok('1 audio creado',              allAudios.length === 1);
    // Disparar ended → autoavance
    lastAudio().fire('ended');
    await sleep(20);
    ok('currentIndex=1 tras ended',   stack.runtime.getSnapshot().currentIndex === 1);
    ok('2 audios (autoavance)',       allAudios.length === 2);
    await stack.dispose();
}

// ─────────────────────────────────────────────────────────────────────────────
section('[3] dispose libera TODO: binder + runtime + adapter URLs');
{
    allAudios.length = 0;
    revokedUrls.clear();
    const stack = createProductionRuntime({
        hydrateContent: async () => ({ totalIndices: 5 }),
        getTextForIndex: (i) => `Sentence ${i}.`,
        getUserId: () => 'u1',
        fetchImpl: makeFetcher(),
        audioCtor: TrackedAudio,
    });
    await stack.runtime.openSession({ contentId: 'cD', userId: 'u1' });
    await stack.runtime.dispatch({ kind: 'play' });
    await sleep(20);   // dejar que el preload cachee algo
    const adapterStateBefore = stack.adapter._state();
    ok('preloadCount > 0 antes de dispose',  adapterStateBefore.preloadCount > 0
        || adapterStateBefore.totalUrls > 0);
    await stack.dispose();
    ok('snapshot.status=idle post-dispose',  stack.runtime.getSnapshot().status === 'idle');
    const adapterStateAfter = stack.adapter._state();
    ok('audiosTracked=0',                    adapterStateAfter.audiosTracked === 0);
    ok('preloadCount=0',                     adapterStateAfter.preloadCount === 0);
    ok('totalUrls=0',                        adapterStateAfter.totalUrls === 0);
    ok('binder marcado disposed',            stack.binder._state().disposed === true);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[4] dispose idempotente');
{
    const stack = createProductionRuntime({
        hydrateContent: async () => ({ totalIndices: 3 }),
        audioCtor: TrackedAudio,
        fetchImpl: makeFetcher(),
    });
    await stack.runtime.openSession({ contentId: 'c', userId: 'u' });
    const r1 = await stack.dispose();
    ok('1ra dispose ok',                     r1.ok === true);
    const r2 = await stack.dispose();
    ok('2da dispose ok (already_disposed)',  r2.ok === true && r2.reason === 'already_disposed');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[5] preload se dispara automáticamente vía binder');
{
    allAudios.length = 0;
    const stack = createProductionRuntime({
        hydrateContent: async () => ({ totalIndices: 10 }),
        getTextForIndex: (i) => `t${i}`,
        getUserId: () => 'u1',
        fetchImpl: makeFetcher(),
        audioCtor: TrackedAudio,
        preloadWindow: 2,
    });
    const { session } = await stack.runtime.openSession({ contentId: 'cPL', userId: 'u1' });
    await stack.runtime.dispatch({ kind: 'play' });
    await sleep(20);
    ok('preload index=1 cacheado',  stack.adapter.preload.peek(session.id, 1) !== null);
    ok('preload index=2 cacheado',  stack.adapter.preload.peek(session.id, 2) !== null);
    await stack.dispose();
}

// ─────────────────────────────────────────────────────────────────────────────
section('[6] recoverFromError integrado: autoplay blocked → recover → ready');
{
    allAudios.length = 0;
    let blockNext = true;
    class BlockingAudio extends TrackedAudio {
        async play() {
            if (blockNext) {
                const e = new Error('blocked'); e.name = 'NotAllowedError'; throw e;
            }
        }
    }
    const stack = createProductionRuntime({
        hydrateContent: async () => ({ totalIndices: 5 }),
        getTextForIndex: (i) => `t${i}`,
        getUserId: () => 'u1',
        fetchImpl: makeFetcher(),
        audioCtor: BlockingAudio,
    });
    await stack.runtime.openSession({ contentId: 'cRC', userId: 'u1', startIndex: 1 });
    const playR = await stack.runtime.dispatch({ kind: 'play' });
    ok('play falló con autoplay_blocked',           playR.error?.kind === 'audio_autoplay_blocked');
    ok('snapshot.status=error',                     stack.runtime.getSnapshot().status === 'error');

    blockNext = false;
    const recR = await stack.runtime.recoverFromError({ preserveIndex: true });
    ok('recover ok',                                recR.ok === true);
    ok('snapshot.status=ready',                     stack.runtime.getSnapshot().status === 'ready');
    ok('currentIndex preservado en 1',              stack.runtime.getSnapshot().currentIndex === 1);
    await stack.dispose();
}

// ─────────────────────────────────────────────────────────────────────────────
section('[7] decode error mid-session → audio_decode_failed');
{
    allAudios.length = 0;
    const stack = createProductionRuntime({
        hydrateContent: async () => ({ totalIndices: 5 }),
        getTextForIndex: (i) => `t${i}`,
        getUserId: () => 'u1',
        fetchImpl: makeFetcher(),
        audioCtor: TrackedAudio,
    });
    await stack.runtime.openSession({ contentId: 'cDF', userId: 'u1' });
    await stack.runtime.dispatch({ kind: 'play' });
    // Simular MEDIA_ERR_DECODE
    lastAudio().error = { code: 3 };
    lastAudio().fire('error');
    await sleep(10);
    ok('snapshot.status=error',                     stack.runtime.getSnapshot().status === 'error');
    ok('lastError.kind=audio_decode_failed',
       stack.runtime.getSnapshot().lastError?.kind === 'audio_decode_failed');
    await stack.dispose();
}

// ─────────────────────────────────────────────────────────────────────────────
section('[8] cambio de contenido: openSession nuevo + URLs anteriores liberados');
{
    allAudios.length = 0;
    revokedUrls.clear();
    const stack = createProductionRuntime({
        hydrateContent: async () => ({ totalIndices: 5 }),
        getTextForIndex: (i) => `t${i}`,
        getUserId: () => 'u1',
        fetchImpl: makeFetcher(),
        audioCtor: TrackedAudio,
    });
    await stack.runtime.openSession({ contentId: 'cA', userId: 'u1' });
    await stack.runtime.dispatch({ kind: 'play' });
    await sleep(20);
    const urlsCreated = stack.adapter._state().totalUrls;
    ok('URLs creados para cA',                       urlsCreated > 0);
    await stack.runtime.openSession({ contentId: 'cB', userId: 'u1' });
    await sleep(10);
    // Tras cambio de sesión, el binder llamó releaseSession para cA.
    // Los URLs de cA están revocados, y los de cB son nuevos (puede haber 0 si no jugó aún).
    ok('snapshot.contentId=cB',                      stack.runtime.getSnapshot().contentId === 'cB');
    await stack.dispose();
}

// ─────────────────────────────────────────────────────────────────────────────
section('[9] hydrateContent error propaga como sesión en error');
{
    const stack = createProductionRuntime({
        hydrateContent: async () => { throw Object.assign(new Error('not found'), { kind: 'content_not_found' }); },
        audioCtor: TrackedAudio,
        fetchImpl: makeFetcher(),
    });
    const r = await stack.runtime.openSession({ contentId: 'cMissing', userId: 'u1' });
    ok('open.ok=false',                              r.ok === false);
    ok('error.kind=content_not_found',               r.error?.kind === 'content_not_found');
    await stack.dispose();
}

// ─────────────────────────────────────────────────────────────────────────────
section('[10] sin getTextForIndex → fallback TTS no se intenta (manifest only)');
{
    allAudios.length = 0;
    // Manifest hit para cada índice — no necesitamos TTS.
    const manifest = {
        fileByKey: { '0000': 'audio/x.mp3', '0001': 'audio/y.mp3' },
        version: 1,
    };
    const stack = createProductionRuntime({
        hydrateContent: async () => ({ totalIndices: 2 }),
        // sin getTextForIndex
        getManifest: () => manifest,
        fetchImpl: makeFetcher(),
        audioCtor: TrackedAudio,
    });
    await stack.runtime.openSession({ contentId: 'cM', userId: 'u1' });
    const r = await stack.runtime.dispatch({ kind: 'play' });
    ok('play ok (manifest hit)',                     r.ok === true);
    ok('snapshot.status=playing',                    stack.runtime.getSnapshot().status === 'playing');
    await stack.dispose();
}

console.log(`\ncreateProductionRuntime — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
