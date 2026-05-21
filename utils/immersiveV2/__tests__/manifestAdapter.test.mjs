/**
 * manifestAdapter.test.mjs — Sprint Inmersivo V2 / Fase M-3.1.
 *
 * Tests reales con fetchImpl stubbed. Cubren v1, v2, 404, JSON inválido,
 * shape inválido, abort durante fetch, abort durante json parsing.
 *
 * Cómo correr:
 *   node utils/immersiveV2/__tests__/manifestAdapter.test.mjs
 */

import { loadManifest, normalizeRaw } from '../manifestAdapter.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('manifestAdapter — Sprint M-3.1');

// ── Fakes ───────────────────────────────────────────────────────────────────

function fakeFetch({ status = 200, body, throwError, jsonThrow, holdMs }) {
    return async (url, init) => {
        if (throwError) throw throwError;
        if (holdMs) await new Promise(r => setTimeout(r, holdMs));
        if (init?.signal?.aborted) {
            const err = new Error('aborted'); err.name = 'AbortError'; throw err;
        }
        return {
            ok:     status >= 200 && status < 300,
            status,
            async json() {
                if (jsonThrow) throw jsonThrow;
                return body;
            },
        };
    };
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
section('[1] manifest v1 válido');
{
    const body = {
        '0000': { index: 0, file: 'audio/0000.mp3', text: 'Hola.' },
        '0001': { index: 1, file: 'audio/0001.mp3', text: 'Mundo.' },
    };
    const r = await loadManifest({ contentId: 'c1', fetchImpl: fakeFetch({ body }) });
    ok('ok=true',                         r.ok === true);
    ok('version=1',                       r.version === 1);
    ok('fileByKey 2 entradas',            Object.keys(r.fileByKey).length === 2);
    ok('fileByKey[0000]=audio/0000.mp3',  r.fileByKey['0000'] === 'audio/0000.mp3');
    ok('sentencesByKey ausente en v1',    r.sentencesByKey === undefined);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[2] manifest v2 válido');
{
    const body = {
        _meta: { version: 2, generatedAt: 'now' },
        '0000': { index: 0, file: 'a/0.mp3', sentences: ['Hola.', 'Mundo.'] },
        '0001': { index: 1, file: 'a/1.mp3', sentences: ['Adiós.'] },
    };
    const r = await loadManifest({ contentId: 'c1', fetchImpl: fakeFetch({ body }) });
    ok('ok=true',                                  r.ok === true);
    ok('version=2',                                r.version === 2);
    ok('fileByKey[0000]=a/0.mp3',                  r.fileByKey['0000'] === 'a/0.mp3');
    ok('sentencesByKey[0000].length=2',            r.sentencesByKey['0000'].length === 2);
    ok('sentencesByKey[0000][0]=Hola.',            r.sentencesByKey['0000'][0] === 'Hola.');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[3] 404 → fetch_failed con status');
{
    const r = await loadManifest({ contentId: 'c1', fetchImpl: fakeFetch({ status: 404 }) });
    ok('ok=false',                  r.ok === false);
    ok('reason=fetch_failed',       r.reason === 'fetch_failed');
    ok('meta.status=404',           r.meta?.status === 404);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[4] JSON inválido → invalid_json');
{
    const jsonThrow = new SyntaxError('Unexpected token < in JSON');
    const r = await loadManifest({ contentId: 'c1', fetchImpl: fakeFetch({ jsonThrow }) });
    ok('ok=false',                       r.ok === false);
    ok('reason=invalid_json',            r.reason === 'invalid_json');
    ok('meta.error tiene mensaje',       typeof r.meta?.error === 'string');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[5] body no-objeto → invalid_shape');
{
    const r1 = await loadManifest({ contentId: 'c1', fetchImpl: fakeFetch({ body: null }) });
    ok('null body → invalid_shape',           r1.ok === false && r1.reason === 'invalid_shape');
    const r2 = await loadManifest({ contentId: 'c1', fetchImpl: fakeFetch({ body: [] }) });
    ok('array body → invalid_shape',          r2.ok === false && r2.reason === 'invalid_shape');
    const r3 = await loadManifest({ contentId: 'c1', fetchImpl: fakeFetch({ body: 'string' }) });
    ok('string body → invalid_shape',         r3.ok === false && r3.reason === 'invalid_shape');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[6] body sin chunks (solo _meta) → invalid_shape no_chunks');
{
    const body = { _meta: { version: 2 } };
    const r = await loadManifest({ contentId: 'c1', fetchImpl: fakeFetch({ body }) });
    ok('ok=false',                          r.ok === false);
    ok('reason=invalid_shape',              r.reason === 'invalid_shape');
    ok('meta.reason=no_chunks',             r.meta?.reason === 'no_chunks');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[7] body con chunks pero sin file ni sentences → invalid_shape no_useful_data');
{
    const body = {
        '0000': { index: 0 },                 // sin file ni sentences
        '0001': { index: 1, file: 123 },      // file no string
    };
    const r = await loadManifest({ contentId: 'c1', fetchImpl: fakeFetch({ body }) });
    ok('ok=false',                          r.ok === false);
    ok('reason=invalid_shape',              r.reason === 'invalid_shape');
    ok('meta.reason=no_useful_data',        r.meta?.reason === 'no_useful_data');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[8] abort durante fetch (signal.aborted antes del call)');
{
    const ac = new AbortController();
    ac.abort();
    const r = await loadManifest({ contentId: 'c1', signal: ac.signal, fetchImpl: fakeFetch({}) });
    ok('ok=false',          r.ok === false);
    ok('reason=aborted',    r.reason === 'aborted');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[9] abort durante fetch (mid-flight)');
{
    const ac = new AbortController();
    const fetcher = fakeFetch({ holdMs: 50, body: { '0000': { file: 'x.mp3' } } });
    const p = loadManifest({ contentId: 'c1', signal: ac.signal, fetchImpl: fetcher });
    await sleep(5);
    ac.abort();
    const r = await p;
    ok('ok=false',          r.ok === false);
    ok('reason=aborted',    r.reason === 'aborted');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[10] fetch throws (network error) → fetch_failed');
{
    const fetcher = fakeFetch({ throwError: new TypeError('network down') });
    const r = await loadManifest({ contentId: 'c1', fetchImpl: fetcher });
    ok('ok=false',                  r.ok === false);
    ok('reason=fetch_failed',       r.reason === 'fetch_failed');
    ok('meta.error tiene mensaje',  typeof r.meta?.error === 'string');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[11] args inválidos');
{
    const r1 = await loadManifest({ fetchImpl: fakeFetch({}) });
    ok('sin contentId → invalid_args',          r1.ok === false && r1.reason === 'invalid_args');
    const r2 = await loadManifest({ contentId: '', fetchImpl: fakeFetch({}) });
    ok('contentId vacío → invalid_args',        r2.ok === false && r2.reason === 'invalid_args');
    const r3 = await loadManifest({ contentId: 123, fetchImpl: fakeFetch({}) });
    ok('contentId no string → invalid_args',    r3.ok === false && r3.reason === 'invalid_args');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[12] sin fetch global ni fetchImpl → no_fetch_impl');
{
    // Forzamos un environment sin fetch borrando temporalmente.
    const originalFetch = globalThis.fetch;
    delete globalThis.fetch;
    try {
        const r = await loadManifest({ contentId: 'c1' });
        ok('ok=false',              r.ok === false);
        ok('reason=no_fetch_impl',  r.reason === 'no_fetch_impl');
    } finally {
        if (originalFetch) globalThis.fetch = originalFetch;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
section('[13] normalizeRaw es exportada y pura');
{
    const raw = {
        _meta: { version: 2 },
        '0000': { file: 'a.mp3', sentences: ['x'] },
    };
    const r = normalizeRaw(raw);
    ok('ok=true',           r.ok === true);
    ok('version=2',         r.version === 2);
    // Llamarla dos veces con el mismo input devuelve el mismo shape.
    const r2 = normalizeRaw(raw);
    ok('determinista',      JSON.stringify(r) === JSON.stringify(r2));
}

// ─────────────────────────────────────────────────────────────────────────────
section('[14] _meta.version no-numeric → version=1 (fallback defensivo)');
{
    const body = {
        _meta: { version: 'x' },
        '0000': { file: 'a.mp3' },
    };
    const r = await loadManifest({ contentId: 'c1', fetchImpl: fakeFetch({ body }) });
    ok('version=1 (fallback)',     r.ok === true && r.version === 1);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[15] sentences vacías o no-string en chunk se filtran');
{
    const body = {
        _meta: { version: 2 },
        '0000': { file: 'a.mp3', sentences: ['ok', '', null, 42, 'tambien'] },
    };
    const r = await loadManifest({ contentId: 'c1', fetchImpl: fakeFetch({ body }) });
    ok('ok=true',                              r.ok === true);
    ok('sentences filtradas a 2 strings',      r.sentencesByKey['0000'].length === 2);
    ok('preserva ok',                          r.sentencesByKey['0000'][0] === 'ok');
    ok('preserva tambien',                     r.sentencesByKey['0000'][1] === 'tambien');
}

console.log(`\nmanifestAdapter — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
