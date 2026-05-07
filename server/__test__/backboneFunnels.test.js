/**
 * backboneFunnels.test.js — Sprint Data Backbone Fase 6A
 *
 * Cubre el agregador puro: fixtures en memoria, sin DB.
 * Ejecutar:
 *   node server/__test__/backboneFunnels.test.js
 */

import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const { computeBackboneFunnels, emptyBackboneFunnels } =
    await import('../backboneFunnels.js');
const { ulid } = await import('../ulid.js');

let pass = 0;
let fail = 0;
function assert(cond, label, detail = '') {
    if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
    else      { fail += 1; console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

const baseEvent = (overrides = {}) => ({
    eventId:       ulid(),
    schemaVersion: 1,
    event:         'lu.page_view',
    mode:          'lu',
    userId:        'u-1',
    contentId:     null,
    sessionId:     'sess-1',
    clientTs:      Date.now(),
    payload:       { _source: 'native' },
    ...overrides,
});

// Helper que copia overrides preservando payload._source si no se sobrescribe.
const evtNative = (overrides = {}) => baseEvent({
    ...overrides,
    payload: { _source: 'native', ...(overrides.payload ?? {}) },
});

const evtLegacy = (overrides = {}) => baseEvent({
    ...overrides,
    payload: { _source: 'legacy', ...(overrides.payload ?? {}) },
});

// ──────────────────────────────────────────────────────────────────────────
// TEST 1 — events.db vacío → shape válido sin error
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 1] computeBackboneFunnels([]) shape vacío válido');
{
    const f = computeBackboneFunnels([], { windowDays: 30 });
    assert(f.sourceFilter === 'native',                        'sourceFilter = native');
    assert(f.nativeEventCount === 0,                           'nativeEventCount = 0');
    assert(typeof f.funnels === 'object' && f.funnels !== null,'funnels es objeto');
    assert(f.funnels.lu.summary.starts === 0,                  'lu starts = 0');
    assert(f.funnels.reading.summary.completions === 0,        'reading completions = 0');
    assert(typeof f.funnels.reading.byMode === 'object',       'reading.byMode existe');
    assert(f.funnels.lu.errors.total === 0,                    'lu errors.total = 0');
    assert(f.funnels.immersive.audio.playSessions === 0,       'immersive audio shape');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 2 — Funnel LU completo (cada paso convierte 100%)
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 2] Funnel LU 100% (1 sesión completa todos los pasos)');
{
    const sid = 'lu-complete';
    const events = [
        evtNative({ event: 'lu.page_view',        mode: 'lu', sessionId: sid }),
        evtNative({ event: 'lu.version_check',    mode: 'lu', sessionId: sid }),
        evtNative({ event: 'lu.download_start',   mode: 'lu', sessionId: sid }),
        evtNative({ event: 'lu.download_success', mode: 'lu', sessionId: sid }),
    ];
    const f = computeBackboneFunnels(events, { windowDays: 30 });
    const lu = f.funnels.lu;
    assert(lu.summary.starts === 1,           'starts = 1');
    assert(lu.summary.completions === 1,      'completions = 1');
    assert(lu.summary.completionRate === 1,   'completionRate = 1');
    assert(lu.summary.biggestDropoff === null,'sin biggestDropoff');
    assert(lu.steps.every(s => s.count === 1), 'todos los steps cuentan 1');
    assert(lu.steps[0].conversionFromPrevious === null, 'step 0: convFromPrev null');
    assert(lu.steps[1].conversionFromPrevious === 1,    'step 1: convFromPrev 1');
    assert(lu.steps[3].conversionFromStart === 1,       'step 3: convFromStart 1');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 3 — Funnel LU con dropoff (10/8/3/1)
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 3] Funnel LU dropoff: 10 page_view → 8 version → 3 start → 1 success');
{
    const events = [];
    // 10 sesiones llegan a page_view, 8 siguen a version_check, 3 a download_start, 1 a success.
    const reach = (sid, idx, lastStep) => {
        const userId = `u-${idx}`;
        const steps  = ['lu.page_view', 'lu.version_check', 'lu.download_start', 'lu.download_success'];
        for (let k = 0; k <= lastStep; k++) {
            events.push(evtNative({ event: steps[k], mode: 'lu', sessionId: sid, userId }));
        }
    };
    for (let i = 0; i < 7; i++) reach(`s-only-pv-${i}`,  i,        0); // 7 → page_view
    for (let i = 0; i < 5; i++) reach(`s-pv-vc-${i}`,    7 + i,    1); // 5 → +version
    for (let i = 0; i < 2; i++) reach(`s-pv-vc-ds-${i}`, 12 + i,   2); // 2 → +download_start
    for (let i = 0; i < 1; i++) reach(`s-full-${i}`,     14 + i,   3); // 1 → completo
    // total: 7 stop@1 + 5 stop@2 + 2 stop@3 + 1 stop@4
    // step 0 count = 7+5+2+1 = 15
    // step 1 count = 5+2+1   = 8
    // step 2 count = 2+1     = 3
    // step 3 count = 1
    const f = computeBackboneFunnels(events, { windowDays: 30 });
    const lu = f.funnels.lu;
    assert(lu.steps[0].count === 15, `step page_view = 15 (got ${lu.steps[0].count})`);
    assert(lu.steps[1].count === 8,  `step version_check = 8 (got ${lu.steps[1].count})`);
    assert(lu.steps[2].count === 3,  `step download_start = 3 (got ${lu.steps[2].count})`);
    assert(lu.steps[3].count === 1,  `step download_success = 1 (got ${lu.steps[3].count})`);

    // dropoffs: 15→8 (lost 7), 8→3 (lost 5), 3→1 (lost 2)
    assert(lu.dropoffs[0].lost === 7, 'dropoff page_view→version_check = 7');
    assert(lu.dropoffs[1].lost === 5, 'dropoff version_check→download_start = 5');
    assert(lu.dropoffs[2].lost === 2, 'dropoff download_start→success = 2');

    // biggestDropoff = el primer paso (lost=7)
    assert(lu.summary.biggestDropoff?.from === 'page_view', 'biggestDropoff desde page_view');
    assert(lu.summary.biggestDropoff?.lost === 7,           'biggestDropoff lost = 7');

    // completionRate = 1/15
    assert(Math.abs(lu.summary.completionRate - 1/15) < 1e-9, 'completionRate = 1/15');
    assert(lu.steps[3].uniqueUsers === 1,                   'uniqueUsers en success = 1');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 4 — Funnel reading general 5/4/3/2
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 4] Funnel reading 5 start / 4 hb / 3 progress / 2 end (text)');
{
    const events = [];
    const mk = (sid, lastStep, idx) => {
        const steps = ['text.session_start', 'text.session_heartbeat', 'text.progress', 'text.session_end'];
        for (let k = 0; k <= lastStep; k++) {
            events.push(evtNative({ event: steps[k], mode: 'text', sessionId: sid, userId: `u-${idx}` }));
        }
    };
    for (let i = 0; i < 1; i++) mk(`r-only-start-${i}`, 0, i);     // 1 → solo start
    for (let i = 0; i < 1; i++) mk(`r-pl-hb-${i}`,      1, 10 + i); // 1 → +heartbeat
    for (let i = 0; i < 1; i++) mk(`r-pl-prog-${i}`,    2, 20 + i); // 1 → +progress
    for (let i = 0; i < 2; i++) mk(`r-full-${i}`,       3, 30 + i); // 2 → completo
    // step 0: 1+1+1+2 = 5
    // step 1: 1+1+2 = 4
    // step 2: 1+2 = 3
    // step 3: 2
    const f = computeBackboneFunnels(events, { windowDays: 30 });
    const r = f.funnels.reading;
    assert(r.steps[0].count === 5, `start = 5 (got ${r.steps[0].count})`);
    assert(r.steps[1].count === 4, 'heartbeat = 4');
    assert(r.steps[2].count === 3, 'progress = 3');
    assert(r.steps[3].count === 2, 'end = 2');

    // byMode.text equivalente
    assert(r.byMode.text.steps[0].count === 5, 'byMode.text starts = 5');
    assert(r.byMode.text.steps[3].count === 2, 'byMode.text ends = 2');

    // Modos no incluidos quedan en 0
    assert(r.byMode.immersive.summary.starts === 0, 'byMode.immersive vacío');
    assert(r.byMode.album.summary.starts === 0,     'byMode.album vacío');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 5 — Native only: legacy se ignora
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 5] Native only — eventos legacy y sin _source no contaminan');
{
    const events = [
        // 1 sesión nativa completa LU
        evtNative({ event: 'lu.page_view',        sessionId: 'lu-n', mode: 'lu' }),
        evtNative({ event: 'lu.version_check',    sessionId: 'lu-n', mode: 'lu' }),
        evtNative({ event: 'lu.download_start',   sessionId: 'lu-n', mode: 'lu' }),
        evtNative({ event: 'lu.download_success', sessionId: 'lu-n', mode: 'lu' }),
        // 99 eventos legacy del mismo flujo (no deben contar)
        evtLegacy({ event: 'lu.page_view',        sessionId: 'lu-leg', mode: 'lu' }),
        evtLegacy({ event: 'lu.version_check',    sessionId: 'lu-leg', mode: 'lu' }),
        evtLegacy({ event: 'lu.download_start',   sessionId: 'lu-leg', mode: 'lu' }),
        evtLegacy({ event: 'lu.download_success', sessionId: 'lu-leg', mode: 'lu' }),
        // 1 evento sin _source (unknown) — también ignorado
        baseEvent({ event: 'lu.page_view', sessionId: 'lu-unk', mode: 'lu', payload: undefined }),
    ];
    const f = computeBackboneFunnels(events, { windowDays: 30 });
    assert(f.funnels.lu.summary.starts === 1,      'solo la sesión native cuenta');
    assert(f.funnels.lu.summary.completions === 1, 'solo la sesión native completa');
    assert(f.nativeEventCount === 4,               'nativeEventCount = 4');
    assert(f.ignoredNonNativeEvents === 5,         'ignoredNonNativeEvents = 5');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 6 — Eventos duplicados en la misma sesión no inflan steps
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 6] Dedup por sessionId — múltiples emisiones del mismo step cuentan 1');
{
    const sid = 'sess-dup';
    const events = [
        evtNative({ event: 'lu.page_view',     mode: 'lu', sessionId: sid }),
        evtNative({ event: 'lu.page_view',     mode: 'lu', sessionId: sid }), // duplicate
        evtNative({ event: 'lu.page_view',     mode: 'lu', sessionId: sid }), // duplicate
        evtNative({ event: 'lu.version_check', mode: 'lu', sessionId: sid }),
        evtNative({ event: 'lu.version_check', mode: 'lu', sessionId: sid }), // duplicate
    ];
    const f = computeBackboneFunnels(events, { windowDays: 30 });
    assert(f.funnels.lu.steps[0].count === 1, 'page_view dedup = 1');
    assert(f.funnels.lu.steps[1].count === 1, 'version_check dedup = 1');
    assert(f.funnels.lu.steps[2].count === 0, 'download_start = 0');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 7 — a11y.error sin session_start cuenta en errores, no en steps
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 7] a11y.error sin session_start no contamina funnel');
{
    const events = [
        // 1 sesión a11y completa
        evtNative({ event: 'a11y.session_start', mode: 'a11y', sessionId: 'a-good', userId: 'u-A' }),
        evtNative({ event: 'a11y.progress',      mode: 'a11y', sessionId: 'a-good', userId: 'u-A' }),
        evtNative({ event: 'a11y.session_end',   mode: 'a11y', sessionId: 'a-good', userId: 'u-A' }),
        // 2 sesiones a11y solo con error (sin start)
        evtNative({ event: 'a11y.error', mode: 'a11y', sessionId: 'a-err-1', userId: 'u-B', payload: { _source: 'native', errorType: 'doc_empty' } }),
        evtNative({ event: 'a11y.error', mode: 'a11y', sessionId: 'a-err-2', userId: 'u-C', payload: { _source: 'native', errorType: 'parse_failed' } }),
        evtNative({ event: 'a11y.error', mode: 'a11y', sessionId: 'a-err-2', userId: 'u-C', payload: { _source: 'native', errorType: 'parse_failed' } }),
    ];
    const f = computeBackboneFunnels(events, { windowDays: 30 });
    const a = f.funnels.a11y;
    assert(a.steps[0].count === 1,      'session_start solo cuenta la sesión válida');
    assert(a.steps[2].count === 1,      'session_end = 1');
    assert(a.errors.total === 3,        'errors.total = 3 (1 + 2)');
    assert(a.errors.byType.doc_empty === 1,    'doc_empty = 1');
    assert(a.errors.byType.parse_failed === 2, 'parse_failed = 2');
    assert(a.summary.completionRate === 1,'completionRate 1 (solo 1 inicia, 1 termina)');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 8 — Funnel inmersivo + auxiliar audio
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 8] Funnel immersive + audio play/pause aux');
{
    const events = [
        // Sesión 1: start → audio_play → heartbeat → end
        evtNative({ event: 'immersive.session_start',     mode: 'immersive', sessionId: 'i1', userId: 'u-A' }),
        evtNative({ event: 'immersive.audio_play',        mode: 'immersive', sessionId: 'i1', userId: 'u-A' }),
        evtNative({ event: 'immersive.session_heartbeat', mode: 'immersive', sessionId: 'i1', userId: 'u-A' }),
        evtNative({ event: 'immersive.audio_pause',       mode: 'immersive', sessionId: 'i1', userId: 'u-A' }),
        evtNative({ event: 'immersive.session_end',       mode: 'immersive', sessionId: 'i1', userId: 'u-A' }),
        // Sesión 2: start → audio_play (sin heartbeat ni end)
        evtNative({ event: 'immersive.session_start', mode: 'immersive', sessionId: 'i2', userId: 'u-B' }),
        evtNative({ event: 'immersive.audio_play',    mode: 'immersive', sessionId: 'i2', userId: 'u-B' }),
        // Sesión 3: solo start (no audio)
        evtNative({ event: 'immersive.session_start', mode: 'immersive', sessionId: 'i3', userId: 'u-C' }),
    ];
    const f = computeBackboneFunnels(events, { windowDays: 30 });
    const im = f.funnels.immersive;
    assert(im.steps[0].count === 3, 'start = 3');
    assert(im.steps[1].count === 2, 'audio_play = 2');
    assert(im.steps[2].count === 1, 'heartbeat = 1');
    assert(im.steps[3].count === 1, 'end = 1');
    assert(im.audio.playSessions === 2,  'audio.playSessions = 2');
    assert(im.audio.pauseSessions === 1, 'audio.pauseSessions = 1');
    assert(Math.abs(im.audio.playPauseRatio - 2/3) < 1e-9, 'playPauseRatio = 2/3');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 9 — PDF + Álbum funnels independientes
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 9] Funnels PDF y Álbum');
{
    const events = [
        evtNative({ event: 'pdf.session_start', mode: 'pdf', sessionId: 'p1', userId: 'u-A' }),
        evtNative({ event: 'pdf.progress',      mode: 'pdf', sessionId: 'p1', userId: 'u-A' }),
        evtNative({ event: 'pdf.session_end',   mode: 'pdf', sessionId: 'p1', userId: 'u-A' }),
        // Album: 2 sesiones, una solo start
        evtNative({ event: 'album.session_start', mode: 'album', sessionId: 'al-1', userId: 'u-A' }),
        evtNative({ event: 'album.progress',      mode: 'album', sessionId: 'al-1', userId: 'u-A' }),
        evtNative({ event: 'album.session_end',   mode: 'album', sessionId: 'al-1', userId: 'u-A' }),
        evtNative({ event: 'album.session_start', mode: 'album', sessionId: 'al-2', userId: 'u-B' }),
    ];
    const f = computeBackboneFunnels(events, { windowDays: 30 });
    assert(f.funnels.pdf.summary.starts === 1,      'pdf starts = 1');
    assert(f.funnels.pdf.summary.completionRate === 1, 'pdf complete = 100%');
    assert(f.funnels.album.summary.starts === 2,    'album starts = 2');
    assert(f.funnels.album.summary.completions === 1,'album completions = 1');
    assert(Math.abs(f.funnels.album.summary.completionRate - 0.5) < 1e-9, 'album rate = 0.5');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 10 — emptyBackboneFunnels shape válido
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 10] emptyBackboneFunnels shape');
{
    const f = emptyBackboneFunnels({ windowDays: 30 });
    assert(f.sourceFilter === 'native',                 'sourceFilter = native');
    assert(f.funnels.lu.steps.length === 4,             'lu tiene 4 steps');
    assert(f.funnels.reading.steps.length === 4,        'reading tiene 4 steps');
    assert(f.funnels.a11y.steps.length === 3,           'a11y tiene 3 steps');
    assert(f.funnels.immersive.steps.length === 4,      'immersive tiene 4 steps');
    assert(f.funnels.lu.errors.total === 0,             'lu.errors.total = 0');
    assert(f.funnels.reading.byMode.text.steps.length === 4, 'reading.byMode.text shape ok');
    assert(f.funnels.immersive.audio.playSessions === 0,'immersive.audio shape ok');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 11 — Sesión que se salta un paso intermedio NO completa el funnel
//           (verifica monotonía)
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 11] Monotonía: sesión que se salta version_check no llega a download_success');
{
    const sid = 'lu-skip';
    const events = [
        evtNative({ event: 'lu.page_view',        mode: 'lu', sessionId: sid }),
        // skipped: lu.version_check
        evtNative({ event: 'lu.download_start',   mode: 'lu', sessionId: sid }),
        evtNative({ event: 'lu.download_success', mode: 'lu', sessionId: sid }),
    ];
    const f = computeBackboneFunnels(events, { windowDays: 30 });
    assert(f.funnels.lu.steps[0].count === 1, 'page_view = 1');
    assert(f.funnels.lu.steps[1].count === 0, 'version_check = 0 (no emitido)');
    assert(f.funnels.lu.steps[2].count === 0, 'download_start = 0 (monotonía)');
    assert(f.funnels.lu.steps[3].count === 0, 'download_success = 0 (monotonía)');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 12 — lu.download_error y lu.version_error cuentan en errores
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 12] LU errors: download_error / version_error cuentan en errors.byType');
{
    const events = [
        evtNative({ event: 'lu.page_view',       mode: 'lu', sessionId: 'lu-e1', userId: 'u-A' }),
        evtNative({ event: 'lu.download_error',  mode: 'lu', sessionId: 'lu-e1', userId: 'u-A',
                    payload: { _source: 'native', errorType: 'apk_url_missing' } }),
        evtNative({ event: 'lu.page_view',       mode: 'lu', sessionId: 'lu-e2', userId: 'u-B' }),
        evtNative({ event: 'lu.download_error',  mode: 'lu', sessionId: 'lu-e2', userId: 'u-B',
                    payload: { _source: 'native', errorType: 'version_fetch_failed' } }),
        evtNative({ event: 'lu.download_error',  mode: 'lu', sessionId: 'lu-e2', userId: 'u-B',
                    payload: { _source: 'native', errorType: 'apk_url_missing' } }),
    ];
    const f = computeBackboneFunnels(events, { windowDays: 30 });
    assert(f.funnels.lu.errors.total === 3,                           'errors.total = 3');
    assert(f.funnels.lu.errors.byType.apk_url_missing === 2,          'apk_url_missing = 2');
    assert(f.funnels.lu.errors.byType.version_fetch_failed === 1,     'version_fetch_failed = 1');
    // download_error NO infla los steps (no es 'download_start' ni 'download_success')
    assert(f.funnels.lu.steps[2].count === 0, 'download_start sigue en 0');
    assert(f.funnels.lu.steps[3].count === 0, 'download_success sigue en 0');
}

// ──────────────────────────────────────────────────────────────────────────
console.log(`\n──────────────────────────────────────────────`);
console.log(`Resultado: ${pass} pass / ${fail} fail`);
console.log(`──────────────────────────────────────────────`);
process.exit(fail === 0 ? 0 : 1);
