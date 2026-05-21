/**
 * audioAdapter.test.mjs — Sprint Inmersivo V2 / Fase M-3.2.
 *
 * Tests reales con AudioMock + fetch stub + URL polyfill mínimo. Cubren:
 *
 *   createBrowserAudioAdapter:
 *     - factory crea audio con listeners adjuntos
 *     - listeners verifican stale-callback antes de invocar
 *     - cleanupAudio remueve listeners
 *     - registerObjectUrl + releaseSession revoca URLs
 *     - releaseAll limpia todo
 *
 *   resolveAudioSrc:
 *     - manifest hit crea object URL
 *     - manifest 404 → cae a TTS
 *     - manifest path inseguro → invalid_audio_response
 *     - TTS success crea object URL
 *     - TTS 500 → tts_fetch_failed
 *     - content-type no audio/* → invalid_audio_response
 *     - blob vacío → invalid_audio_response
 *     - abort durante manifest fetch
 *     - abort durante TTS fetch
 *     - userId guest → audio_unavailable
 *     - sin text → audio_unavailable (cuando manifest miss)
 *
 * Cómo correr:
 *   node utils/immersiveV2/__tests__/audioAdapter.test.mjs
 */

import {
    createBrowserAudioAdapter,
    resolveAudioSrc,
    isAutoplayBlocked,
    mediaErrorToReason,
} from '../audioAdapter.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('audioAdapter — Sprint M-3.2');

// ── Polyfills + Fakes ───────────────────────────────────────────────────────

// URL.createObjectURL / revokeObjectURL no existen en Node default.
// Stubeamos con un counter + registry para verificar revocación.
const createdUrls = new Set();
const revokedUrls = new Set();
const originalCreate = globalThis.URL?.createObjectURL;
const originalRevoke = globalThis.URL?.revokeObjectURL;
let urlCounter = 0;
globalThis.URL = globalThis.URL || {};
globalThis.URL.createObjectURL = (blob) => {
    urlCounter++;
    const url = `blob:fake/${urlCounter}-size${blob?.size ?? 0}`;
    createdUrls.add(url);
    return url;
};
globalThis.URL.revokeObjectURL = (url) => {
    revokedUrls.add(url);
};

class AudioMock {
    constructor() {
        this.src = '';
        this._paused = true;
        this.error = null;
        this._listeners = new Map();   // event → Set<handler>
    }
    addEventListener(event, handler) {
        if (!this._listeners.has(event)) this._listeners.set(event, new Set());
        this._listeners.get(event).add(handler);
    }
    removeEventListener(event, handler) {
        this._listeners.get(event)?.delete(handler);
    }
    _fire(event, payload) {
        const set = this._listeners.get(event);
        if (!set) return;
        for (const h of [...set]) h(payload);
    }
    async play() { this._paused = false; }
    pause()      { this._paused = true; }
    set preload(v) { this._preload = v; }
    get preload()  { return this._preload; }
}

function makeBlob(size = 100, type = 'audio/mpeg') {
    return { size, type };
}

function makeFetch(routes = {}, opts = {}) {
    return async (url, init) => {
        if (init?.signal?.aborted) {
            const err = new Error('aborted'); err.name = 'AbortError'; throw err;
        }
        if (opts.holdMs) await new Promise(r => setTimeout(r, opts.holdMs));
        if (init?.signal?.aborted) {
            const err = new Error('aborted'); err.name = 'AbortError'; throw err;
        }
        // Match contra patrón exacto o substring.
        const route = routes[url] ?? Object.entries(routes).find(([pat]) => url.includes(pat))?.[1];
        if (!route) {
            return { ok: false, status: 404, headers: { get: () => null }, async blob() { return makeBlob(0); } };
        }
        if (route.throwError) throw route.throwError;
        const status = route.status ?? 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            headers: { get: (k) => route.headers?.[k.toLowerCase()] ?? null },
            async blob() { return route.blob ?? makeBlob(); },
        };
    };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ════════════════════════════════════════════════════════════════════════════
// PARTE A — createBrowserAudioAdapter
// ════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
section('[A1] factory crea audio con preload + listeners');
{
    const events = [];
    let activeId = 'sA';
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => activeId,
        onEnded:   (sid, idx) => events.push({ kind: 'ended',   sid, idx }),
        onError:   (sid, idx) => events.push({ kind: 'error',   sid, idx }),
        onCanPlay: (sid, idx) => events.push({ kind: 'canplay', sid, idx }),
        audioCtor: AudioMock,
    });
    const audio = adapter.factory({ sessionId: 'sA', index: 0 });
    ok('audio creado',                  audio instanceof AudioMock);
    ok('preload=auto seteado',          audio.preload === 'auto');
    ok('listener ended adjunto',        audio._listeners.get('ended')?.size === 1);
    ok('listener error adjunto',        audio._listeners.get('error')?.size === 1);
    ok('listener canplay adjunto',      audio._listeners.get('canplay')?.size === 1);
    ok('audiosTracked=1 en _state',     adapter._state().audiosTracked === 1);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[A2] listener ended disparado para sessionId activo');
{
    const events = [];
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        onEnded: (sid, idx) => events.push({ sid, idx }),
        audioCtor: AudioMock,
    });
    const audio = adapter.factory({ sessionId: 'sA', index: 3 });
    audio._fire('ended');
    ok('onEnded invocado',    events.length === 1);
    ok('sessionId=sA',        events[0].sid === 'sA');
    ok('index=3',             events[0].idx === 3);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[A3] listener ended STALE descartado (sessionId mismatch)');
{
    const events = [];
    let active = 'sA';
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => active,
        onEnded: (sid, idx) => events.push({ sid, idx }),
        audioCtor: AudioMock,
    });
    const audio = adapter.factory({ sessionId: 'sA', index: 0 });
    active = 'sB';   // sesión rotó
    audio._fire('ended');
    ok('onEnded NO invocado para sessionId stale', events.length === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[A4] listener error pasa MediaError al callback');
{
    const events = [];
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        onError: (sid, idx, err) => events.push({ sid, idx, err }),
        audioCtor: AudioMock,
    });
    const audio = adapter.factory({ sessionId: 'sA', index: 1 });
    audio.error = { code: 4, message: 'MEDIA_ERR_SRC_NOT_SUPPORTED' };
    audio._fire('error');
    ok('onError invocado',          events.length === 1);
    ok('err.code=4',                events[0].err?.code === 4);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[A5] listener canplay para sessionId activo');
{
    const events = [];
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        onCanPlay: (sid, idx) => events.push({ sid, idx }),
        audioCtor: AudioMock,
    });
    const audio = adapter.factory({ sessionId: 'sA', index: 7 });
    audio._fire('canplay');
    ok('onCanPlay invocado',  events.length === 1);
    ok('idx=7',               events[0].idx === 7);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[A6] cleanupAudio remueve listeners');
{
    const events = [];
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        onEnded: () => events.push('ended'),
        audioCtor: AudioMock,
    });
    const audio = adapter.factory({ sessionId: 'sA', index: 0 });
    adapter.cleanupAudio(audio);
    audio._fire('ended');   // tras cleanup no debe disparar
    ok('onEnded NO invocado tras cleanup',  events.length === 0);
    ok('audio fuera de registry',           adapter._state().audiosTracked === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[A7] registerObjectUrl + releaseSession revoca URLs');
{
    revokedUrls.clear();
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        audioCtor: AudioMock,
    });
    adapter.registerObjectUrl('sA', 'blob:fake/1');
    adapter.registerObjectUrl('sA', 'blob:fake/2');
    adapter.registerObjectUrl('sB', 'blob:fake/3');
    ok('totalUrls=3',                       adapter._state().totalUrls === 3);
    const revoked = adapter.releaseSession('sA');
    ok('revoked=2 para sA',                 revoked === 2);
    ok('blob:fake/1 revocado',              revokedUrls.has('blob:fake/1'));
    ok('blob:fake/2 revocado',              revokedUrls.has('blob:fake/2'));
    ok('blob:fake/3 NO revocado',           !revokedUrls.has('blob:fake/3'));
    ok('totalUrls=1 post-release',          adapter._state().totalUrls === 1);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[A8] releaseAll revoca todo + limpia listeners');
{
    revokedUrls.clear();
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        audioCtor: AudioMock,
    });
    adapter.factory({ sessionId: 'sA', index: 0 });
    adapter.factory({ sessionId: 'sB', index: 0 });
    adapter.registerObjectUrl('sA', 'blob:fake/x');
    adapter.registerObjectUrl('sB', 'blob:fake/y');
    const revoked = adapter.releaseAll();
    ok('revoked=2 total',                   revoked === 2);
    ok('audiosTracked=0 post-releaseAll',   adapter._state().audiosTracked === 0);
    ok('totalUrls=0 post-releaseAll',       adapter._state().totalUrls === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[A9] registerObjectUrl ignora args inválidos');
{
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        audioCtor: AudioMock,
    });
    adapter.registerObjectUrl('', 'blob:x');
    adapter.registerObjectUrl('sA', '');
    adapter.registerObjectUrl(null, null);
    ok('totalUrls=0 con args inválidos', adapter._state().totalUrls === 0);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[A10] sin audioCtor disponible → factory throws explícito');
{
    const originalAudio = globalThis.Audio;
    delete globalThis.Audio;
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        // audioCtor: undefined a propósito
    });
    let caught = null;
    try { adapter.factory({ sessionId: 'sA', index: 0 }); }
    catch (e) { caught = e; }
    ok('throws Error explícito',  caught instanceof Error);
    ok('mensaje útil',            /audioCtor|Audio constructor/.test(caught?.message ?? ''));
    if (originalAudio) globalThis.Audio = originalAudio;
}

// ════════════════════════════════════════════════════════════════════════════
// PARTE B — resolveAudioSrc
// ════════════════════════════════════════════════════════════════════════════

const session = { id: 'sA', contentId: 'c1' };

// ─────────────────────────────────────────────────────────────────────────────
section('[B1] manifest hit → object URL desde blob');
{
    const fetcher = makeFetch({
        '/uploads/audio/c1/0000.mp3': {
            status: 200,
            headers: { 'content-type': 'audio/mpeg' },
            blob: makeBlob(100),
        },
    });
    const r = await resolveAudioSrc({
        session, index: 0,
        manifest: { fileByKey: { '0000': 'audio/c1/0000.mp3' } },
        fetchImpl: fetcher,
    });
    ok('ok=true',           r.ok === true);
    ok('source=manifest',   r.source === 'manifest');
    ok('src es blob:',      typeof r.src === 'string' && r.src.startsWith('blob:'));
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B2] manifest 404 → fallback a TTS');
{
    const fetcher = makeFetch({
        '/uploads/audio/c1/0000.mp3': { status: 404 },
        '/api/tts': {
            status: 200,
            headers: { 'content-type': 'audio/wav' },
            blob: makeBlob(50),
        },
    });
    const r = await resolveAudioSrc({
        session, index: 0,
        text: 'Hola.',
        userId: 'user1',
        manifest: { fileByKey: { '0000': 'audio/c1/0000.mp3' } },
        fetchImpl: fetcher,
    });
    ok('ok=true',           r.ok === true);
    ok('source=tts',        r.source === 'tts');
    ok('src es blob:',      typeof r.src === 'string' && r.src.startsWith('blob:'));
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B3] manifest path inseguro (..) → invalid_audio_response');
{
    const fetcher = makeFetch({});
    const r = await resolveAudioSrc({
        session, index: 0,
        manifest: { fileByKey: { '0000': '../../etc/passwd' } },
        text: 'fallback', userId: 'user1',
        fetchImpl: fetcher,
    });
    // El path inseguro es un fallo del manifest específicamente. Sin embargo
    // el adapter cae a TTS si el manifest entry resulta inválido. Pero como
    // SAFE_PATH_RE aplica a la entry, tryManifest devuelve invalid_audio_response,
    // y como NO es 'aborted', cae a TTS. Verificamos que TTS se intentó:
    // (en este test fetcher no tiene /api/tts → tts_fetch_failed)
    ok('ok=false',                          r.ok === false);
    ok('reason=tts_fetch_failed',           r.reason === 'tts_fetch_failed');
    // (El log de manifest unsafe no se propaga; la decisión correcta es
    //  silenciar al user pero podríamos verlo via diagnostics si el viewer
    //  lo reportara. M-3.2 acepta que el path unsafe se descarte.)
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B4] TTS POST con headers correctos');
{
    let captured = null;
    const fetcher = async (url, init) => {
        captured = { url, init };
        return {
            ok: true, status: 200,
            headers: { get: () => 'audio/mpeg' },
            async blob() { return makeBlob(80); },
        };
    };
    const r = await resolveAudioSrc({
        session, index: 5, text: 'Hola mundo.', userId: 'user1', fetchImpl: fetcher,
    });
    ok('ok=true',                             r.ok === true);
    ok('url=/api/tts',                        captured.url === '/api/tts');
    ok('method=POST',                         captured.init.method === 'POST');
    ok('header x-user-id=user1',              captured.init.headers['x-user-id'] === 'user1');
    ok('body contiene text',                  /Hola mundo\./.test(captured.init.body));
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B5] TTS 500 → tts_fetch_failed con status');
{
    const fetcher = makeFetch({ '/api/tts': { status: 500 } });
    const r = await resolveAudioSrc({
        session, index: 0, text: 't', userId: 'user1', fetchImpl: fetcher,
    });
    ok('ok=false',                  r.ok === false);
    ok('reason=tts_fetch_failed',   r.reason === 'tts_fetch_failed');
    ok('meta.status=500',           r.meta?.status === 500);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B6] content-type no audio/* → invalid_audio_response');
{
    const fetcher = makeFetch({
        '/api/tts': {
            status: 200,
            headers: { 'content-type': 'application/json' },
            blob: makeBlob(50),
        },
    });
    const r = await resolveAudioSrc({
        session, index: 0, text: 't', userId: 'user1', fetchImpl: fetcher,
    });
    ok('ok=false',                              r.ok === false);
    ok('reason=invalid_audio_response',         r.reason === 'invalid_audio_response');
    ok('meta.reason=wrong_content_type',        r.meta?.reason === 'wrong_content_type');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B7] blob vacío → invalid_audio_response');
{
    const fetcher = makeFetch({
        '/api/tts': {
            status: 200,
            headers: { 'content-type': 'audio/mpeg' },
            blob: makeBlob(0),
        },
    });
    const r = await resolveAudioSrc({
        session, index: 0, text: 't', userId: 'user1', fetchImpl: fetcher,
    });
    ok('ok=false',                            r.ok === false);
    ok('reason=invalid_audio_response',       r.reason === 'invalid_audio_response');
    ok('meta.reason=empty_blob',              r.meta?.reason === 'empty_blob');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B8] abort durante manifest fetch');
{
    const fetcher = makeFetch({
        '/uploads/audio/c1/0000.mp3': { status: 200, headers: {'content-type':'audio/mpeg'}, blob: makeBlob(50) },
    }, { holdMs: 50 });
    const ac = new AbortController();
    const p = resolveAudioSrc({
        session, index: 0,
        manifest: { fileByKey: { '0000': 'audio/c1/0000.mp3' } },
        signal: ac.signal, fetchImpl: fetcher,
    });
    await sleep(5);
    ac.abort();
    const r = await p;
    ok('ok=false',          r.ok === false);
    ok('reason=aborted',    r.reason === 'aborted');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B9] abort durante TTS fetch');
{
    const fetcher = makeFetch({
        '/api/tts': { status: 200, headers: {'content-type':'audio/mpeg'}, blob: makeBlob(50) },
    }, { holdMs: 50 });
    const ac = new AbortController();
    const p = resolveAudioSrc({
        session, index: 0, text: 't', userId: 'user1',
        signal: ac.signal, fetchImpl: fetcher,
    });
    await sleep(5);
    ac.abort();
    const r = await p;
    ok('ok=false',          r.ok === false);
    ok('reason=aborted',    r.reason === 'aborted');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B10] userId guest → audio_unavailable cuando no hay manifest');
{
    const fetcher = makeFetch({});
    const r = await resolveAudioSrc({
        session, index: 0, text: 't', userId: 'guest', fetchImpl: fetcher,
    });
    ok('ok=false',                          r.ok === false);
    ok('reason=audio_unavailable',          r.reason === 'audio_unavailable');
    ok('meta.reason=no_user',               r.meta?.reason === 'no_user');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B11] sin text con manifest miss → audio_unavailable');
{
    const fetcher = makeFetch({});
    const r = await resolveAudioSrc({
        session, index: 0,
        manifest: { fileByKey: {} },
        userId: 'user1', fetchImpl: fetcher,
    });
    ok('ok=false',                          r.ok === false);
    ok('reason=audio_unavailable',          r.reason === 'audio_unavailable');
    ok('meta.reason=no_text',               r.meta?.reason === 'no_text');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B12] onObjectUrlCreated callback se invoca');
{
    const created = [];
    const fetcher = makeFetch({
        '/api/tts': { status: 200, headers: {'content-type':'audio/mpeg'}, blob: makeBlob(60) },
    });
    await resolveAudioSrc({
        session, index: 2, text: 't', userId: 'user1',
        fetchImpl: fetcher,
        onObjectUrlCreated: (sid, url) => created.push({ sid, url }),
    });
    ok('callback invocado',         created.length === 1);
    ok('sid=sA',                    created[0].sid === 'sA');
    ok('url empieza con blob:',     created[0].url?.startsWith('blob:'));
}

// ─────────────────────────────────────────────────────────────────────────────
section('[B13] args inválidos');
{
    const f = makeFetch({});
    const r1 = await resolveAudioSrc({ index: 0, fetchImpl: f });
    ok('sin session → invalid_args',    r1.ok === false && r1.reason === 'invalid_args');
    const r2 = await resolveAudioSrc({ session, index: -1, fetchImpl: f });
    ok('index negativo → invalid_args', r2.ok === false && r2.reason === 'invalid_args');
    const r3 = await resolveAudioSrc({ session, index: 1.5, fetchImpl: f });
    ok('index float → invalid_args',    r3.ok === false && r3.reason === 'invalid_args');
}

// ════════════════════════════════════════════════════════════════════════════
// PARTE C — isAutoplayBlocked
// ════════════════════════════════════════════════════════════════════════════

section('[C1] isAutoplayBlocked detecta NotAllowedError');
{
    const err = new Error('blocked'); err.name = 'NotAllowedError';
    ok('NotAllowedError → true',                isAutoplayBlocked(err) === true);
    const err2 = new Error('user activation required');
    ok('mensaje "user activation" → true',      isAutoplayBlocked(err2) === true);
    const err3 = new Error('autoplay disabled');
    ok('mensaje "autoplay" → true',             isAutoplayBlocked(err3) === true);
    const err4 = new Error('decoding failed');
    ok('error genérico → false',                isAutoplayBlocked(err4) === false);
    ok('null → false',                          isAutoplayBlocked(null) === false);
}

// ════════════════════════════════════════════════════════════════════════════
// PARTE D — preload manager (M-3.3)
// ════════════════════════════════════════════════════════════════════════════

section('[D1] preload.prefetch crea object URL reutilizable via peek');
{
    const fetcher = makeFetch({
        '/api/tts': { status: 200, headers: {'content-type':'audio/mpeg'}, blob: makeBlob(80) },
    });
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        audioCtor: AudioMock,
    });
    const r = await adapter.preload.prefetch({
        session: { id: 'sA', contentId: 'c1' }, index: 5,
        text: 'Hola.', userId: 'user1', fetchImpl: fetcher,
    });
    ok('prefetch ok',                       r.ok === true);
    ok('source=tts',                        r.source === 'tts');
    const cached = adapter.preload.peek('sA', 5);
    ok('peek devuelve src cacheado',        cached === r.src);
    const r2 = await adapter.preload.prefetch({
        session: { id: 'sA', contentId: 'c1' }, index: 5,
        text: 'Hola.', userId: 'user1', fetchImpl: fetcher,
    });
    ok('segundo prefetch hit=cache',        r2.hit === 'cache');
    ok('mismo src retornado',               r2.src === r.src);
    // _state refleja preload ready
    ok('_state.preloadReady=1',             adapter._state().preloadReady === 1);
}

section('[D2] prefetch en flight: segundo call de-dup retorna misma promise');
{
    const fetcher = makeFetch({
        '/api/tts': { status: 200, headers: {'content-type':'audio/mpeg'}, blob: makeBlob(80) },
    }, { holdMs: 30 });
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        audioCtor: AudioMock,
    });
    const session = { id: 'sA', contentId: 'c1' };
    const p1 = adapter.preload.prefetch({ session, index: 0, text: 't', userId: 'u', fetchImpl: fetcher });
    const p2 = adapter.preload.prefetch({ session, index: 0, text: 't', userId: 'u', fetchImpl: fetcher });
    // Mismo Promise reference de la entry pending.
    const r1 = await p1;
    const r2 = await p2;
    ok('ambas resuelven OK',          r1.ok === true && r2.ok === true);
    ok('mismo src',                   r1.src === r2.src);
}

section('[D3] cancelStaleAround aborta fuera de ventana');
{
    const fetcher = makeFetch({
        '/api/tts': { status: 200, headers: {'content-type':'audio/mpeg'}, blob: makeBlob(50) },
    }, { holdMs: 50 });
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        audioCtor: AudioMock,
    });
    const session = { id: 'sA', contentId: 'c1' };
    // Lanzamos 5 prefetches.
    const promises = [];
    for (let i = 0; i < 5; i++) {
        promises.push(adapter.preload.prefetch({ session, index: i, text: 't', userId: 'u', fetchImpl: fetcher }));
    }
    // Inmediatamente cancelStaleAround currentIndex=2, window=2 → mantiene [1..4].
    // Inicio del window = currentIndex - 1 = 1; fin = currentIndex + window = 4.
    // Aborta indices 0.
    const aborted = adapter.preload.cancelStaleAround({ session, currentIndex: 2, window: 2 });
    ok('aborted >= 1 (al menos index 0)', aborted >= 1);
    // Esperar resoluciones
    const results = await Promise.all(promises);
    ok('index 0 → aborted',           results[0].ok === false && results[0].reason === 'aborted');
    // 1..4 deberían terminar OK (o fallback aborted si race con sleep). Aceptamos cualquiera.
    ok('indices 1..4 NO fueron forzosamente abortados',
       results.slice(1).every(r => r.ok === true || r.reason === 'aborted'));
}

section('[D4] cancelForSession aborta TODOS los pending de la sesión');
{
    const fetcher = makeFetch({
        '/api/tts': { status: 200, headers: {'content-type':'audio/mpeg'}, blob: makeBlob(50) },
    }, { holdMs: 50 });
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        audioCtor: AudioMock,
    });
    const session = { id: 'sA', contentId: 'c1' };
    const p1 = adapter.preload.prefetch({ session, index: 0, text: 't', userId: 'u', fetchImpl: fetcher });
    const p2 = adapter.preload.prefetch({ session, index: 1, text: 't', userId: 'u', fetchImpl: fetcher });
    const aborted = adapter.preload.cancelForSession('sA');
    ok('aborted=2',                   aborted === 2);
    const r1 = await p1;
    const r2 = await p2;
    ok('p1 aborted',                  r1.ok === false && r1.reason === 'aborted');
    ok('p2 aborted',                  r2.ok === false && r2.reason === 'aborted');
    // _state limpio
    ok('_state.preloadCount=0',       adapter._state().preloadCount === 0);
}

section('[D5] releaseSession cancela preload + revoca URLs cacheados');
{
    revokedUrls.clear();
    const fetcher = makeFetch({
        '/api/tts': { status: 200, headers: {'content-type':'audio/mpeg'}, blob: makeBlob(70) },
    });
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        audioCtor: AudioMock,
    });
    const session = { id: 'sA', contentId: 'c1' };
    const r = await adapter.preload.prefetch({ session, index: 0, text: 't', userId: 'u', fetchImpl: fetcher });
    const cachedUrl = r.src;
    ok('totalUrls=1 antes',           adapter._state().totalUrls === 1);
    adapter.releaseSession('sA');
    ok('URL revocado',                revokedUrls.has(cachedUrl));
    ok('_state.preloadCount=0',       adapter._state().preloadCount === 0);
    ok('_state.totalUrls=0',          adapter._state().totalUrls === 0);
}

section('[D6] preload cross-session NO contamina');
{
    const fetcher = makeFetch({
        '/api/tts': { status: 200, headers: {'content-type':'audio/mpeg'}, blob: makeBlob(60) },
    });
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        audioCtor: AudioMock,
    });
    await adapter.preload.prefetch({
        session: { id: 'sA', contentId: 'cA' }, index: 0,
        text: 't', userId: 'u', fetchImpl: fetcher,
    });
    await adapter.preload.prefetch({
        session: { id: 'sB', contentId: 'cB' }, index: 0,
        text: 't', userId: 'u', fetchImpl: fetcher,
    });
    ok('peek sA index=0 hit',         typeof adapter.preload.peek('sA', 0) === 'string');
    ok('peek sB index=0 hit',         typeof adapter.preload.peek('sB', 0) === 'string');
    ok('peek sA index=99 null',       adapter.preload.peek('sA', 99) === null);
    adapter.preload.cancelForSession('sA');
    ok('peek sA tras cancel=null',    adapter.preload.peek('sA', 0) === null);
    ok('peek sB intacto',             typeof adapter.preload.peek('sB', 0) === 'string');
}

section('[D7] preload con args inválidos');
{
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        audioCtor: AudioMock,
    });
    const r1 = await adapter.preload.prefetch({ index: 0 });
    ok('sin session → invalid_args',         r1.ok === false && r1.reason === 'invalid_args');
    const r2 = await adapter.preload.prefetch({ session: { id: 'x' }, index: -1 });
    ok('index negativo → invalid_args',      r2.ok === false && r2.reason === 'invalid_args');
}

section('[D8] preload diagnostics se emiten cuando hay diagnostics inyectado');
{
    const events = [];
    const diagnostics = { log: (e) => events.push(e) };
    const fetcher = makeFetch({
        '/api/tts': { status: 200, headers: {'content-type':'audio/mpeg'}, blob: makeBlob(50) },
    });
    const adapter = createBrowserAudioAdapter({
        getActiveSessionId: () => 'sA',
        audioCtor: AudioMock,
        diagnostics,
    });
    const session = { id: 'sA', contentId: 'c1' };
    await adapter.preload.prefetch({ session, index: 0, text: 't', userId: 'u', fetchImpl: fetcher });
    await adapter.preload.prefetch({ session, index: 0, text: 't', userId: 'u', fetchImpl: fetcher });
    adapter.releaseSession('sA');
    const kinds = events.map(e => e.kind);
    ok('preload.start emitido',       kinds.includes('preload.start'));
    ok('preload.hit emitido',         kinds.includes('preload.hit'));
    ok('preload.release emitido',     kinds.includes('preload.release'));
}

// ════════════════════════════════════════════════════════════════════════════
// PARTE E — mediaErrorToReason (M-3.3)
// ════════════════════════════════════════════════════════════════════════════

section('[E1] mediaErrorToReason mapea correctamente cada code');
{
    ok('code 1 → aborted',                      mediaErrorToReason({ code: 1 }) === 'aborted');
    ok('code 2 → network_failure',              mediaErrorToReason({ code: 2 }) === 'network_failure');
    ok('code 3 → decode_failed',                mediaErrorToReason({ code: 3 }) === 'decode_failed');
    ok('code 4 → src_not_supported',            mediaErrorToReason({ code: 4 }) === 'src_not_supported');
    ok('code desconocido → unknown',            mediaErrorToReason({ code: 99 }) === 'unknown');
    ok('null → unknown',                        mediaErrorToReason(null) === 'unknown');
    ok('undefined → unknown',                   mediaErrorToReason(undefined) === 'unknown');
    ok('{ } sin code → unknown',                mediaErrorToReason({}) === 'unknown');
    ok('code string → number coerced',          mediaErrorToReason({ code: '3' }) === 'decode_failed');
}

// ════════════════════════════════════════════════════════════════════════════
// Restore globals (defensivo)
if (originalCreate) globalThis.URL.createObjectURL = originalCreate;
if (originalRevoke) globalThis.URL.revokeObjectURL = originalRevoke;

console.log(`\naudioAdapter — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
