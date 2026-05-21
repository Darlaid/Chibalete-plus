/**
 * syncStrategyExecutorSemantic.test.mjs — Phase 1.b.B Task 1.
 *
 * Tests SEMÁNTICOS (no estructurales): el executor opera explícitamente con
 * absoluteSentenceIndex + localIndexInChunk + chunkKey, y rechaza activaciones
 * fuera del rango spawn-aware con EXECUTOR_INVALID_ACTIVATION.
 *
 * Cómo correr:
 *   node utils/__tests__/syncStrategyExecutorSemantic.test.mjs
 */

import {
    executeSyncStrategy,
    buildHeuristicTimeline,
    buildFallbackTimeline,
} from '../syncStrategyExecutor.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, hint = '') {
    if (cond) { console.log('  ✓', label); pass++; }
    else      { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
}
function section(label) { console.log('\n' + label); }

function makeMockAudio({ duration = 30, currentTime = 0 } = {}) {
    const listeners = new Map();
    const audio = {
        currentTime, duration,
        addEventListener(event, cb) {
            const arr = listeners.get(event) || [];
            arr.push(cb);
            listeners.set(event, arr);
        },
        removeEventListener(event, cb) {
            const arr = listeners.get(event);
            if (!arr) return;
            const idx = arr.indexOf(cb);
            if (idx >= 0) arr.splice(idx, 1);
        },
        _emit(event) {
            const arr = listeners.get(event) || [];
            for (const cb of arr.slice()) cb();
        },
        _setTime(t) { this.currentTime = t; this._emit('timeupdate'); },
    };
    return audio;
}

// ────────────────────────────────────────────────────────────────────────────
section('[Sem-1] Timeline emite TimelineEntry con 3 campos canónicos');
{
    const sg = [
        { absoluteSentenceIndex: 10, localIndexInChunk: 0, weight: 50 },
        { absoluteSentenceIndex: 11, localIndexInChunk: 1, weight: 80 },
        { absoluteSentenceIndex: 12, localIndexInChunk: 2, weight: 60 },
    ];
    const tl = buildHeuristicTimeline(sg, 19000);
    ok('timeline len=3', tl.length === 3);
    ok('entry[0].absoluteSentenceIndex === 10', tl[0].absoluteSentenceIndex === 10);
    ok('entry[0].localIndexInChunk === 0',      tl[0].localIndexInChunk === 0);
    ok('entry[2].absoluteSentenceIndex === 12', tl[2].absoluteSentenceIndex === 12);
    ok('entry[2].localIndexInChunk === 2',      tl[2].localIndexInChunk === 2);
    ok('NO emite campo sentenceIdx (ambiguo)',
       tl.every(e => !Object.prototype.hasOwnProperty.call(e, 'sentenceIdx')));
}

// ────────────────────────────────────────────────────────────────────────────
section('[Sem-2] buildFallbackTimeline también emite 3 campos canónicos');
{
    const sg = [
        { absoluteSentenceIndex: 5,  localIndexInChunk: 0, weight: 100 },
        { absoluteSentenceIndex: 6,  localIndexInChunk: 1, weight: 200 },
    ];
    const tl = buildFallbackTimeline(sg, 1);
    ok('fallback emite absoluteSentenceIndex',
       tl[0].absoluteSentenceIndex === 5 && tl[1].absoluteSentenceIndex === 6);
    ok('fallback emite localIndexInChunk',
       tl[0].localIndexInChunk === 0 && tl[1].localIndexInChunk === 1);
    ok('fallback NO emite sentenceIdx',
       tl.every(e => !Object.prototype.hasOwnProperty.call(e, 'sentenceIdx')));
}

// ────────────────────────────────────────────────────────────────────────────
section('[Sem-3] Invariante DURO: spawnFromIndex=10 → activaciones < 10 son rechazadas');
{
    // Si alguien construyera mal el sentenceGroup con entries < spawnFromIndex,
    // tickActivate debe rechazarlas con EXECUTOR_INVALID_ACTIVATION.
    const audio = makeMockAudio({ duration: 30 });
    const activated = [];
    const logs = [];
    const sg = [
        // Entry "indebida": absoluteSentenceIndex=5 con spawnFromIndex=10.
        { absoluteSentenceIndex: 5,  localIndexInChunk: 0, weight: 50 },
        { absoluteSentenceIndex: 10, localIndexInChunk: 5, weight: 80 },
        { absoluteSentenceIndex: 11, localIndexInChunk: 6, weight: 60 },
    ];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup:   sg,
        sessionId:       'sem-3',
        spawnFromIndex:  10,
        chunkKey:        0,
        chunkStartIndex: 0,
        chunkEndIndex:   11,
        onSentenceActivate: (absIdx) => activated.push(absIdx),
        logger: (e, d) => logs.push({ e, d }),
    });
    ok('initial tick NO activa absoluteSentenceIndex=5',
       !activated.includes(5));
    // Avanzar el audio para que el timeline alcance abs=10 (proporcional al peso)
    audio._setTime(15);
    ok('al avanzar audio, SÍ activa absoluteSentenceIndex=10',
       activated.includes(10));
    ok('emite EXECUTOR_INVALID_ACTIVATION para abs=5',
       logs.some(l => l.e === 'EXECUTOR_INVALID_ACTIVATION' && l.d.attempted === 5));
    ok('reason del rejection es below_spawn',
       logs.some(l => l.e === 'EXECUTOR_INVALID_ACTIVATION' && l.d.reason === 'below_spawn'));
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[Sem-4] Invariante: absoluteSentenceIndex > chunkEndIndex también rechazado');
{
    const audio = makeMockAudio({ duration: 30 });
    const activated = [];
    const logs = [];
    const sg = [
        { absoluteSentenceIndex: 10, localIndexInChunk: 0, weight: 50 },
        // Entry indebida: 99 fuera del chunk [0..11].
        { absoluteSentenceIndex: 99, localIndexInChunk: 89, weight: 60 },
    ];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup:   sg,
        sessionId:       'sem-4',
        spawnFromIndex:  10,
        chunkKey:        0,
        chunkStartIndex: 0,
        chunkEndIndex:   11,
        onSentenceActivate: (absIdx) => activated.push(absIdx),
        logger: (e, d) => logs.push({ e, d }),
    });
    audio._setTime(30);  // forzar tickActivate completo
    ok('absIdx 99 NO se activa', !activated.includes(99));
    ok('emite EXECUTOR_INVALID_ACTIVATION reason=above_chunk_end',
       logs.some(l => l.e === 'EXECUTOR_INVALID_ACTIVATION' && l.d.reason === 'above_chunk_end'));
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[Sem-5] Log SYNC_SENTENCE_ACTIVATE incluye los 3 campos canónicos');
{
    const audio = makeMockAudio({ duration: 30 });
    const logs = [];
    const sg = [
        { absoluteSentenceIndex: 10, localIndexInChunk: 0, weight: 50 },
        { absoluteSentenceIndex: 11, localIndexInChunk: 1, weight: 50 },
    ];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup:   sg,
        sessionId:       'sem-5',
        spawnFromIndex:  10,
        chunkKey:        7,
        chunkStartIndex: 0,
        chunkEndIndex:   11,
        onSentenceActivate: () => {},
        logger: (e, d) => logs.push({ e, d }),
    });
    audio._setTime(20);
    const act = logs.find(l => l.e === 'SYNC_SENTENCE_ACTIVATE' && l.d.absoluteSentenceIndex === 11);
    ok('SYNC_SENTENCE_ACTIVATE para abs=11 emitido', !!act);
    ok('log incluye absoluteSentenceIndex',         act && act.d.absoluteSentenceIndex === 11);
    ok('log incluye localIndexInChunk',             act && act.d.localIndexInChunk === 1);
    ok('log incluye spawnFromIndex',                act && act.d.spawnFromIndex === 10);
    ok('log incluye chunkKey',                      act && act.d.chunkKey === 7);
    ok('log NO contiene campo sentenceIdx ambiguo',
       act && !Object.prototype.hasOwnProperty.call(act.d, 'sentenceIdx'));
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[Sem-6] Anchors con sentenceIdx legacy son RECHAZADOS por el nuevo contrato');
{
    const audio = makeMockAudio({ duration: 30 });
    const activated = [];
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, localIndexInChunk: 0, weight: 50 },
            { absoluteSentenceIndex: 1, localIndexInChunk: 1, weight: 50 },
        ],
        // Anchors con el formato LEGACY sentenceIdx — el executor los descarta
        // porque el contrato canónico es absoluteSentenceIndex.
        anchors: [
            { sentenceIdx: 0, startMs: 0 },
            { sentenceIdx: 1, startMs: 5000 },
        ],
        sessionId:       'sem-6',
        spawnFromIndex:  0,
        chunkKey:        0,
        chunkStartIndex: 0,
        chunkEndIndex:   1,
        onSentenceActivate: (absIdx) => activated.push(absIdx),
        logger: (e, d) => logs.push({ e, d }),
    });
    // Sin anchors válidos en formato canónico, el SYNC_STRATEGY_EMPTY_TIMELINE
    // debería dispararse (o no haber activaciones).
    audio._setTime(10);
    ok('NO se activa ningún índice con anchors legacy',
       activated.length === 0);
    ok('emite SYNC_STRATEGY_EMPTY_TIMELINE por no_valid_anchors',
       logs.some(l => l.e === 'SYNC_STRATEGY_EMPTY_TIMELINE'));
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[Sem-7] Anchors con absoluteSentenceIndex canónico funcionan');
{
    const audio = makeMockAudio({ duration: 30 });
    const activated = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 10, localIndexInChunk: 0, weight: 50 },
            { absoluteSentenceIndex: 11, localIndexInChunk: 1, weight: 50 },
        ],
        anchors: [
            { absoluteSentenceIndex: 10, localIndexInChunk: 0, startMs: 0 },
            { absoluteSentenceIndex: 11, localIndexInChunk: 1, startMs: 5000 },
        ],
        sessionId:       'sem-7',
        spawnFromIndex:  10,
        chunkKey:        0,
        chunkStartIndex: 0,
        chunkEndIndex:   11,
        onSentenceActivate: (absIdx) => activated.push(absIdx),
        logger: () => {},
    });
    ok('initial tick activa absoluteSentenceIndex=10',
       activated[0] === 10);
    audio._setTime(5);
    ok('tick @5s activa absoluteSentenceIndex=11',
       activated[1] === 11);
    handle.cancel();
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
