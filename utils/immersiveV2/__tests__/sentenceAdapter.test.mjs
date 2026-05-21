/**
 * sentenceAdapter.test.mjs — Sprint Inmersivo V2 / Fase M-3.1.
 *
 * Tests reales con engineFactory stub. Cubren manifest v2, manifest v1,
 * texto solo, abort (pre + mid), vacío (no_sources), engine que throws,
 * engine ya ready al subscribe.
 *
 * Cómo correr:
 *   node utils/immersiveV2/__tests__/sentenceAdapter.test.mjs
 */

import { hydrateSentences } from '../sentenceAdapter.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('sentenceAdapter — Sprint M-3.1');

// ── Fakes ───────────────────────────────────────────────────────────────────

/**
 * Fake del StartupEngine que simula el ciclo idle → loading → ready.
 * Configurable: sentences, manifest, delayMs, throwOnStart, neverReady,
 * preReady (emite ready al subscribe sin esperar start).
 */
function makeFakeEngine(config = {}) {
    let state = {
        status:    config.preReady ? 'ready' : 'idle',
        sentences: config.preReady ? (config.sentences ?? []) : [],
        manifest:  config.preReady ? (config.manifest ?? null) : null,
    };
    const listeners = new Set();
    const engine = {
        start() {
            if (config.throwOnStart) throw config.throwOnStart;
            if (config.neverReady) return;
            const delay = Number.isFinite(config.delayMs) ? config.delayMs : 0;
            setTimeout(() => {
                state = {
                    status:    'ready',
                    sentences: config.sentences ?? [],
                    manifest:  config.manifest ?? null,
                };
                for (const l of listeners) l({ ...state });
            }, delay);
        },
        getState() { return { ...state }; },
        subscribe(l) {
            listeners.add(l);
            // Notar que NO llama immediato — el engine real (StartupEngine)
            // tampoco lo hace.
            return () => listeners.delete(l);
        },
    };
    return engine;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
section('[1] manifest v2 — engine emite sentences exitoso');
{
    const engineFactory = () => makeFakeEngine({
        sentences: ['Hola.', 'Mundo.', 'Adios.'],
        manifest:  { _meta: { version: 2 }, '0000': {} },
        delayMs:   5,
    });
    const r = await hydrateSentences({ contentId: 'c1', engineFactory });
    ok('ok=true',                       r.ok === true);
    ok('sentences.length=3',            r.sentences?.length === 3);
    ok('totalIndices=3',                r.totalIndices === 3);
    ok('sentences[0]=Hola.',            r.sentences[0] === 'Hola.');
    ok('rawManifest preservado',        r.rawManifest?._meta?.version === 2);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[2] manifest v1 — sin manifest pero con sentences');
{
    const engineFactory = () => makeFakeEngine({
        sentences: ['Solo texto.'],
        manifest:  null,
        delayMs:   5,
    });
    const r = await hydrateSentences({ contentId: 'c1', engineFactory });
    ok('ok=true',               r.ok === true);
    ok('sentences.length=1',    r.sentences?.length === 1);
    ok('rawManifest=null',      r.rawManifest === null);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[3] sentences vacías → no_sources');
{
    const engineFactory = () => makeFakeEngine({ sentences: [], delayMs: 5 });
    const r = await hydrateSentences({ contentId: 'c1', engineFactory });
    ok('ok=false',              r.ok === false);
    ok('reason=no_sources',     r.reason === 'no_sources');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[4] abort PRE-call (signal ya aborted)');
{
    const ac = new AbortController();
    ac.abort();
    const engineFactory = () => makeFakeEngine({ sentences: ['x'], delayMs: 50 });
    const r = await hydrateSentences({ contentId: 'c1', signal: ac.signal, engineFactory });
    ok('ok=false',          r.ok === false);
    ok('reason=aborted',    r.reason === 'aborted');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[5] abort MID-flight (durante loading)');
{
    const ac = new AbortController();
    const engineFactory = () => makeFakeEngine({ sentences: ['x'], delayMs: 50 });
    const p = hydrateSentences({ contentId: 'c1', signal: ac.signal, engineFactory });
    await sleep(5);
    ac.abort();
    const r = await p;
    ok('ok=false',          r.ok === false);
    ok('reason=aborted',    r.reason === 'aborted');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[6] engine.start() throws → start_failed');
{
    const engineFactory = () => makeFakeEngine({ throwOnStart: new Error('engine boom') });
    const r = await hydrateSentences({ contentId: 'c1', engineFactory });
    ok('ok=false',                          r.ok === false);
    ok('reason=start_failed',               r.reason === 'start_failed');
    ok('meta.reason=engine_start_throw',    r.meta?.reason === 'engine_start_throw');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[7] engineFactory throws → start_failed');
{
    const engineFactory = () => { throw new Error('factory boom'); };
    const r = await hydrateSentences({ contentId: 'c1', engineFactory });
    ok('ok=false',                          r.ok === false);
    ok('reason=start_failed',               r.reason === 'start_failed');
    ok('meta.reason=engineFactory_throw',   r.meta?.reason === 'engineFactory_throw');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[8] engine inválido (sin start/subscribe) → start_failed');
{
    const engineFactory = () => ({});
    const r = await hydrateSentences({ contentId: 'c1', engineFactory });
    ok('ok=false',                              r.ok === false);
    ok('meta.reason=invalid_engine_contract',   r.meta?.reason === 'invalid_engine_contract');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[9] engine PRE-ready al subscribe (forzamos rama defensiva)');
{
    const engineFactory = () => makeFakeEngine({
        preReady: true,
        sentences: ['Pre-ready.'],
        manifest: null,
    });
    const r = await hydrateSentences({ contentId: 'c1', engineFactory });
    ok('ok=true',           r.ok === true);
    ok('sentences=1',       r.sentences?.length === 1);
    ok('sentence text',     r.sentences[0] === 'Pre-ready.');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[10] sentences con elementos no-string se filtran');
{
    const engineFactory = () => makeFakeEngine({
        sentences: ['ok', null, 42, undefined, 'tambien'],
        delayMs:   5,
    });
    const r = await hydrateSentences({ contentId: 'c1', engineFactory });
    ok('ok=true',                       r.ok === true);
    ok('sentences filtradas a 2',       r.sentences?.length === 2);
    ok('sentences[0]=ok',               r.sentences[0] === 'ok');
    ok('sentences[1]=tambien',          r.sentences[1] === 'tambien');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[11] args inválidos');
{
    const r1 = await hydrateSentences({});
    ok('sin args → invalid_args',                     r1.ok === false && r1.reason === 'invalid_args');
    const r2 = await hydrateSentences({ contentId: '' });
    ok('contentId vacío → invalid_args',              r2.ok === false && r2.reason === 'invalid_args');
    const r3 = await hydrateSentences({ contentId: 'c1' });
    ok('sin engineFactory → invalid_args',            r3.ok === false && r3.reason === 'invalid_args');
    ok('meta.reason=missing_engineFactory',           r3.meta?.reason === 'missing_engineFactory');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[12] adapter NO retiene engine post-resolve (unsubscribe)');
{
    let unsubCalls = 0;
    const engineFactory = () => {
        const eng = makeFakeEngine({ sentences: ['x'], delayMs: 5 });
        const origSubscribe = eng.subscribe;
        eng.subscribe = (l) => {
            const unsub = origSubscribe(l);
            return () => { unsubCalls++; unsub(); };
        };
        return eng;
    };
    await hydrateSentences({ contentId: 'c1', engineFactory });
    ok('unsubscribe llamado tras resolve', unsubCalls === 1);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[13] M-4 fix — timeoutMs evita hang indefinido');
{
    // Engine que NUNCA llega a ready (neverReady=true). Sin timeoutMs,
    // hydrateSentences quedaría colgado para siempre. Con timeoutMs, settle
    // con hydration_timeout.
    const engineFactory = () => makeFakeEngine({ neverReady: true });
    const t0 = Date.now();
    const r = await hydrateSentences({
        contentId: 'cHang', engineFactory, timeoutMs: 30,
    });
    const elapsed = Date.now() - t0;
    ok('ok=false',                          r.ok === false);
    ok('reason=hydration_timeout',          r.reason === 'hydration_timeout');
    ok('meta.timeoutMs=30',                 r.meta?.timeoutMs === 30);
    ok('meta.contentId=cHang',              r.meta?.contentId === 'cHang');
    ok('elapsed >= 30 && < 200',            elapsed >= 30 && elapsed < 200);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[14] M-4 fix — timeoutMs NO se dispara si engine resuelve antes');
{
    const engineFactory = () => makeFakeEngine({ sentences: ['fast'], delayMs: 5 });
    const r = await hydrateSentences({
        contentId: 'cFast', engineFactory, timeoutMs: 200,
    });
    ok('ok=true (engine resolvió antes del timeout)',  r.ok === true);
    ok('sentences correctos',                            r.sentences[0] === 'fast');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[15] M-4 fix — timeoutMs sin pasarlo NO timeoutea (back-compat)');
{
    // Sin timeoutMs, comportamiento M-3.1 original: si engine resuelve en
    // tiempo razonable, OK. Si nunca resuelve, sería hang (no probamos esto
    // para no colgar la suite). Aquí solo verificamos back-compat con engine
    // que sí resuelve.
    const engineFactory = () => makeFakeEngine({ sentences: ['x'], delayMs: 5 });
    const r = await hydrateSentences({ contentId: 'c', engineFactory });
    ok('back-compat: ok=true sin timeoutMs',  r.ok === true);
}

console.log(`\nsentenceAdapter — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
