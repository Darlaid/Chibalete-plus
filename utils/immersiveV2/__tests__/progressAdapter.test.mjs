/**
 * progressAdapter.test.mjs — Sprint Inmersivo V2 / Fase M-3.1.
 *
 * Tests reales con dataService stubbed. Cubren restore con anchor, restore
 * con sentenceIndex+immersive, restore default, clamp, commit success,
 * commit failure, args inválidos.
 *
 * Cómo correr:
 *   node utils/immersiveV2/__tests__/progressAdapter.test.mjs
 */

import { restoreProgress, commitProgress } from '../progressAdapter.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('progressAdapter — Sprint M-3.1');

// ── Fakes ───────────────────────────────────────────────────────────────────

function makeDataService(overrides = {}) {
    return {
        getProgresoUsuarioLibro: overrides.getProgresoUsuarioLibro ?? (() => undefined),
        updateProgreso:          overrides.updateProgreso ?? (() => {}),
    };
}

// ════════════════════════════════════════════════════════════════════════════
// restoreProgress
// ════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
section('[R1] anchor sentence restore');
{
    const ds = makeDataService({
        getProgresoUsuarioLibro: () => ({
            canonicalProgress: {
                sentenceIndex: 5,
                anchor: { type: 'sentence', value: 7 },
                lastInteractedMode: 'text',
            },
        }),
    });
    const r = await restoreProgress({ userId: 'u1', contentId: 'c1', totalIndices: 100, dataService: ds });
    ok('startIndex=7 (anchor wins)',    r.startIndex === 7);
    ok('source=anchor',                 r.source === 'anchor');
    ok('clamped=false',                 r.clamped === false);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[R2] sentenceIndex restore con immersive');
{
    const ds = makeDataService({
        getProgresoUsuarioLibro: () => ({
            canonicalProgress: {
                sentenceIndex: 12,
                lastInteractedMode: 'immersive',
            },
        }),
    });
    const r = await restoreProgress({ userId: 'u1', contentId: 'c1', totalIndices: 50, dataService: ds });
    ok('startIndex=12',             r.startIndex === 12);
    ok('source=sentence_index',     r.source === 'sentence_index');
    ok('clamped=false',             r.clamped === false);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[R3] sentenceIndex pero modo NO immersive → default');
{
    const ds = makeDataService({
        getProgresoUsuarioLibro: () => ({
            canonicalProgress: {
                sentenceIndex: 12,
                lastInteractedMode: 'text',
            },
        }),
    });
    const r = await restoreProgress({ userId: 'u1', contentId: 'c1', totalIndices: 50, dataService: ds });
    ok('startIndex=0 (text mode descarta sentenceIndex)',  r.startIndex === 0);
    ok('source=default',                                    r.source === 'default');
    ok('clamped=false',                                     r.clamped === false);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[R4] sin progreso → default');
{
    const ds = makeDataService();
    const r = await restoreProgress({ userId: 'u1', contentId: 'c1', dataService: ds });
    ok('startIndex=0',          r.startIndex === 0);
    ok('source=default',        r.source === 'default');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[R5] dataService throws → default fail-soft');
{
    const ds = makeDataService({
        getProgresoUsuarioLibro: () => { throw new Error('cache miss'); },
    });
    const r = await restoreProgress({ userId: 'u1', contentId: 'c1', dataService: ds });
    ok('startIndex=0 (no propaga throw)',  r.startIndex === 0);
    ok('source=default',                    r.source === 'default');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[R6] clamp: anchor.value > totalIndices');
{
    const ds = makeDataService({
        getProgresoUsuarioLibro: () => ({
            canonicalProgress: { anchor: { type: 'sentence', value: 999 }, sentenceIndex: 0 },
        }),
    });
    const r = await restoreProgress({ userId: 'u1', contentId: 'c1', totalIndices: 10, dataService: ds });
    ok('startIndex=9 (clamp a total-1)',    r.startIndex === 9);
    ok('source=anchor',                     r.source === 'anchor');
    ok('clamped=true',                      r.clamped === true);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[R7] clamp: anchor.value < 0');
{
    const ds = makeDataService({
        getProgresoUsuarioLibro: () => ({
            canonicalProgress: { anchor: { type: 'sentence', value: -3 } },
        }),
    });
    const r = await restoreProgress({ userId: 'u1', contentId: 'c1', totalIndices: 10, dataService: ds });
    ok('startIndex=0 (clamp a 0)',  r.startIndex === 0);
    ok('clamped=true',              r.clamped === true);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[R8] sin totalIndices: NO clamp');
{
    const ds = makeDataService({
        getProgresoUsuarioLibro: () => ({
            canonicalProgress: { anchor: { type: 'sentence', value: 999 } },
        }),
    });
    const r = await restoreProgress({ userId: 'u1', contentId: 'c1', dataService: ds });
    ok('startIndex=999 (sin total no clampa)',  r.startIndex === 999);
    ok('clamped=false',                          r.clamped === false);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[R9] anchor de tipo no-sentence se ignora → cae a sentenceIndex');
{
    const ds = makeDataService({
        getProgresoUsuarioLibro: () => ({
            canonicalProgress: {
                anchor: { type: 'page', value: 5 },
                sentenceIndex: 8,
                lastInteractedMode: 'immersive',
            },
        }),
    });
    const r = await restoreProgress({ userId: 'u1', contentId: 'c1', dataService: ds });
    ok('startIndex=8 (sentenceIndex)',   r.startIndex === 8);
    ok('source=sentence_index',          r.source === 'sentence_index');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[R10] anchor.value no-finite → ignorado');
{
    const ds = makeDataService({
        getProgresoUsuarioLibro: () => ({
            canonicalProgress: {
                anchor: { type: 'sentence', value: NaN },
                sentenceIndex: 3,
                lastInteractedMode: 'immersive',
            },
        }),
    });
    const r = await restoreProgress({ userId: 'u1', contentId: 'c1', dataService: ds });
    ok('startIndex=3 (anchor NaN ignorado)',  r.startIndex === 3);
    ok('source=sentence_index',                r.source === 'sentence_index');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[R11] args inválidos → default fail-soft');
{
    const ds = makeDataService({
        getProgresoUsuarioLibro: () => ({ canonicalProgress: { anchor: { type: 'sentence', value: 5 } } }),
    });
    const r1 = await restoreProgress({ userId: '', contentId: 'c1', dataService: ds });
    ok('userId vacío → default',     r1.startIndex === 0 && r1.source === 'default');
    const r2 = await restoreProgress({ userId: 'u1', contentId: '', dataService: ds });
    ok('contentId vacío → default',  r2.startIndex === 0 && r2.source === 'default');
    const r3 = await restoreProgress({ userId: 'u1', contentId: 'c1' });
    ok('sin dataService → default',  r3.startIndex === 0 && r3.source === 'default');
}

// ════════════════════════════════════════════════════════════════════════════
// commitProgress
// ════════════════════════════════════════════════════════════════════════════

// ─────────────────────────────────────────────────────────────────────────────
section('[C1] commit success: traduce a updateProgreso');
{
    const calls = [];
    const ds = makeDataService({
        updateProgreso: (...args) => { calls.push(args); },
    });
    const r = await commitProgress({
        sessionId: 'sX', userId: 'u1', contentId: 'c1',
        index: 5, totalIndices: 20, dataService: ds,
    });
    ok('ok=true',                       r.ok === true);
    ok('updateProgreso llamado 1x',     calls.length === 1);
    const [uid, cid, page, total, canonicalIdx, mode, metricsPatch, anchor] = calls[0];
    ok('userId',                        uid === 'u1');
    ok('contentId',                     cid === 'c1');
    ok('page = index+1 (6)',            page === 6);
    ok('totalPages = totalIndices (20)', total === 20);
    ok('canonicalIndex = index (5)',    canonicalIdx === 5);
    ok('deviceMode=immersive',          mode === 'immersive');
    ok('metricsPatch undefined sin durationMs', metricsPatch === undefined);
    ok('anchor type=sentence value=5',
       anchor?.type === 'sentence' && anchor?.value === 5);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[C2] commit con sessionDurationMs → metricsPatch.elapsedMs');
{
    const calls = [];
    const ds = makeDataService({ updateProgreso: (...args) => { calls.push(args); } });
    await commitProgress({
        sessionId: 's', userId: 'u', contentId: 'c',
        index: 0, totalIndices: 10, sessionDurationMs: 12345, dataService: ds,
    });
    const metricsPatch = calls[0][6];
    ok('metricsPatch.elapsedMs=12345',  metricsPatch?.elapsedMs === 12345);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[C3] commit sin totalIndices → fallback total = index+1');
{
    const calls = [];
    const ds = makeDataService({ updateProgreso: (...args) => { calls.push(args); } });
    await commitProgress({
        userId: 'u', contentId: 'c', index: 7, dataService: ds,
    });
    const total = calls[0][3];
    ok('total = index+1 (8) cuando no hay totalIndices',  total === 8);
}

// ─────────────────────────────────────────────────────────────────────────────
section('[C4] commit failure: updateProgreso throws');
{
    const ds = makeDataService({
        updateProgreso: () => { throw new Error('disk full'); },
    });
    const r = await commitProgress({
        userId: 'u', contentId: 'c', index: 0, dataService: ds,
    });
    ok('ok=false',                        r.ok === false);
    ok('error.kind=commit_throw',         r.error?.kind === 'commit_throw');
    ok('error.meta.error tiene mensaje',  typeof r.error?.meta?.error === 'string');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[C5] commit invalid_args');
{
    const ds = makeDataService();
    const r1 = await commitProgress({ contentId: 'c', index: 0, dataService: ds });
    ok('sin userId → invalid_args',
       r1.ok === false && r1.error?.kind === 'invariant_violated');
    const r2 = await commitProgress({ userId: 'u', index: 0, dataService: ds });
    ok('sin contentId → invariant_violated',  r2.ok === false);
    const r3 = await commitProgress({ userId: 'u', contentId: 'c', index: -1, dataService: ds });
    ok('index negativo → invariant_violated', r3.ok === false);
    ok('error.meta.reason=invalid_index',     r3.error?.meta?.reason === 'invalid_index');
    const r4 = await commitProgress({ userId: 'u', contentId: 'c', index: 1.5, dataService: ds });
    ok('index no-entero → invariant_violated', r4.ok === false);
    const r5 = await commitProgress({ userId: 'u', contentId: 'c', index: 0 });
    ok('sin dataService → invariant_violated', r5.ok === false);
    ok('error.meta.reason=no_dataService',     r5.error?.meta?.reason === 'no_dataService');
}

// ─────────────────────────────────────────────────────────────────────────────
section('[C6] commit no propaga sessionId al backend (queda en error.meta)');
{
    const calls = [];
    const ds = makeDataService({
        updateProgreso: (...args) => { calls.push(args); throw new Error('boom'); },
    });
    const r = await commitProgress({
        sessionId: 'session-XYZ', userId: 'u', contentId: 'c', index: 0, dataService: ds,
    });
    // updateProgreso fue llamado pero NO recibió sessionId (no es parte de su firma).
    ok('updateProgreso fue llamado',          calls.length === 1);
    ok('sessionId NO está en args legacy',
       !calls[0].some(a => a === 'session-XYZ'));
    // En el error, sessionId sí está presente para audit upstream.
    ok('error.meta.sessionId=session-XYZ',    r.error?.meta?.sessionId === 'session-XYZ');
}

console.log(`\nprogressAdapter — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
