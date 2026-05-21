/**
 * adapters.test.mjs — CRR Fase 1 / smoke de los 4 adapters de modo.
 *
 * Foco: cada factory devuelve un stack válido con la API esperada y
 * `dispose()` idempotente. La lógica interna del runtime ya está cubierta
 * por engines/__tests__/immersiveRuntimeV2.test.mjs + .integration.test.mjs;
 * acá solo verificamos que los adapters MONTAN el runtime correctamente y
 * que el modo se preserva.
 *
 *   node engines/readingAdapters/__tests__/adapters.test.mjs
 */

import { createAccessibleAdapter } from '../accessibleAdapter.mjs';
import { createGuidedAdapter }     from '../guidedAdapter.mjs';
import { createPdfAdapter }        from '../pdfAdapter.mjs';
import { createAlbumAdapter }      from '../albumAdapter.mjs';

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('engines/readingAdapters — Fase 1 smoke');

// ── Polyfills mínimos para accessible/guided (que sí pasan por production stack) ──
globalThis.URL = globalThis.URL || {};
globalThis.URL.createObjectURL = globalThis.URL.createObjectURL || (() => 'blob:test/1');
globalThis.URL.revokeObjectURL = globalThis.URL.revokeObjectURL || (() => {});

class AudioMock {
    constructor() { this._src = ''; this._listeners = new Map(); this.error = null; }
    get src() { return this._src; } set src(v) { this._src = v; }
    get currentTime() { return 0; } set currentTime(_v) {}
    get preload() { return ''; }    set preload(_v) {}
    addEventListener(ev, h) { if (!this._listeners.has(ev)) this._listeners.set(ev, new Set()); this._listeners.get(ev).add(h); }
    removeEventListener(ev, h) { this._listeners.get(ev)?.delete(h); }
    async play() {}
    pause() {}
}

const fakeFetch = async () => ({
    ok: true, status: 200,
    headers: { get: () => 'audio/mpeg' },
    async blob() { return { size: 1, type: 'audio/mpeg' }; },
});

const baseAudioDeps = {
    hydrateContent: async () => ({ totalIndices: 3 }),
    getTextForIndex: (i) => `frase ${i}`,
    getUserId:       () => 'user-test',
    fetchImpl:       fakeFetch,
    audioCtor:       AudioMock,
};

const baseNoAudioDeps = {
    hydrateContent: async () => ({ totalIndices: 3 }),
};

const expectRuntimeApi = (label, runtime) => {
    ok(`${label}: runtime.openSession es función`,  typeof runtime.openSession === 'function');
    ok(`${label}: runtime.closeSession es función`, typeof runtime.closeSession === 'function');
    ok(`${label}: runtime.dispatch es función`,     typeof runtime.dispatch === 'function');
    ok(`${label}: runtime.getSnapshot es función`,  typeof runtime.getSnapshot === 'function');
    ok(`${label}: runtime.subscribe es función`,    typeof runtime.subscribe === 'function');
    ok(`${label}: runtime.destroy es función`,      typeof runtime.destroy === 'function');
};

const expectInitialSnapshot = (label, runtime) => {
    const snap = runtime.getSnapshot();
    ok(`${label}: snapshot inicial sessionId=null`,  snap.sessionId === null);
    ok(`${label}: snapshot inicial status='idle'`,   snap.status === 'idle');
    ok(`${label}: snapshot inicial isPlaying=false`, snap.isPlaying === false);
};

const expectDisposeIdempotent = async (label, dispose) => {
    const r1 = await dispose();
    ok(`${label}: dispose() devuelve ok=true`,             r1?.ok === true);
    const r2 = await dispose();
    ok(`${label}: dispose() segunda vez = already_disposed`,
       r2?.ok === true && r2?.reason === 'already_disposed');
};

// ─────────────────────────────────────────────────────────────────────────────
section('[1] accessibleAdapter (audio NULL — fix Fase 2)');
{
    // accessibleAdapter no requiere polyfills de audio (VisorAccesible no tiene TTS).
    const a = createAccessibleAdapter(baseNoAudioDeps);
    ok('mode === accessible',  a.mode === 'accessible');
    ok('Object.isFrozen',      Object.isFrozen(a));
    expectRuntimeApi('accessible', a.runtime);
    expectInitialSnapshot('accessible', a.runtime);

    // openSession completa sin tocar audio.
    const result = await a.runtime.openSession({
        contentId: 'acc-test', userId: 'u-acc', startIndex: 0,
    });
    ok('accessible: openSession ok=true',
       result?.ok === true,
       result?.ok ? '' : JSON.stringify(result?.error ?? {}));

    await expectDisposeIdempotent('accessible', a.dispose);
}

section('[2] guidedAdapter (TTS-only)');
{
    // guidedAdapter wrappea createProductionRuntime (TTS habilitado) para VisorTexto.
    const a = createGuidedAdapter(baseAudioDeps);
    ok('mode === guided',      a.mode === 'guided');
    ok('Object.isFrozen',      Object.isFrozen(a));
    expectRuntimeApi('guided', a.runtime);
    expectInitialSnapshot('guided', a.runtime);
    await expectDisposeIdempotent('guided', a.dispose);
}

section('[3] pdfAdapter (audio NULL)');
{
    const a = createPdfAdapter(baseNoAudioDeps);
    ok('mode === pdf',         a.mode === 'pdf');
    ok('Object.isFrozen',      Object.isFrozen(a));
    expectRuntimeApi('pdf', a.runtime);
    expectInitialSnapshot('pdf', a.runtime);

    // openSession debería completar sin necesidad de audio ni de polyfills.
    const result = await a.runtime.openSession({
        contentId: 'pdf-test', userId: 'u-pdf', startIndex: 0,
    });
    ok('pdf: openSession ok=true',
       result?.ok === true,
       result?.ok ? '' : JSON.stringify(result?.error ?? {}));
    const snap = a.runtime.getSnapshot();
    ok('pdf: tras openSession status ∈ {ready,playing,paused,error}',
       ['ready', 'playing', 'paused', 'error'].includes(snap.status),
       `status=${snap.status}`);
    ok('pdf: tras openSession totalIndices === 3', snap.totalIndices === 3);

    await expectDisposeIdempotent('pdf', a.dispose);
}

section('[4] albumAdapter (audio NULL)');
{
    const a = createAlbumAdapter(baseNoAudioDeps);
    ok('mode === album',       a.mode === 'album');
    ok('Object.isFrozen',      Object.isFrozen(a));
    expectRuntimeApi('album', a.runtime);
    expectInitialSnapshot('album', a.runtime);

    const result = await a.runtime.openSession({
        contentId: 'album-test', userId: 'u-album', startIndex: 0,
    });
    ok('album: openSession ok=true',
       result?.ok === true,
       result?.ok ? '' : JSON.stringify(result?.error ?? {}));

    await expectDisposeIdempotent('album', a.dispose);
}

section('[5] idPrefix por modo (anti-colisión cross-adapter)');
{
    const acc = createAccessibleAdapter(baseNoAudioDeps);
    const gui = createGuidedAdapter(baseAudioDeps);
    const pdf = createPdfAdapter(baseNoAudioDeps);
    const alb = createAlbumAdapter(baseNoAudioDeps);

    // No exponemos el prefix directamente, pero podemos verificar que los
    // sessionIds que se generan en cada uno son distintos cuando abrimos
    // sessiones concurrentes. Como apertura es async, lo hacemos serialmente.
    const r1 = await acc.runtime.openSession({ contentId: 'c', userId: 'u', startIndex: 0 });
    const id1 = acc.runtime.getSnapshot().sessionId;
    await acc.dispose();
    const r2 = await gui.runtime.openSession({ contentId: 'c', userId: 'u', startIndex: 0 });
    const id2 = gui.runtime.getSnapshot().sessionId;
    await gui.dispose();
    const r3 = await pdf.runtime.openSession({ contentId: 'c', userId: 'u', startIndex: 0 });
    const id3 = pdf.runtime.getSnapshot().sessionId;
    await pdf.dispose();
    const r4 = await alb.runtime.openSession({ contentId: 'c', userId: 'u', startIndex: 0 });
    const id4 = alb.runtime.getSnapshot().sessionId;
    await alb.dispose();

    ok('los 4 abrieron sesión', r1.ok && r2.ok && r3.ok && r4.ok);
    ok('sessionId accessible empieza con acc_', typeof id1 === 'string' && id1.startsWith('acc_'));
    ok('sessionId guided empieza con gui_',     typeof id2 === 'string' && id2.startsWith('gui_'));
    ok('sessionId pdf empieza con pdf_',        typeof id3 === 'string' && id3.startsWith('pdf_'));
    ok('sessionId album empieza con alb_',      typeof id4 === 'string' && id4.startsWith('alb_'));
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
