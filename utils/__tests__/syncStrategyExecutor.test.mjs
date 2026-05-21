/**
 * syncStrategyExecutor.test.mjs — cobertura M-5.3.4 Phase 2 execution layer.
 *
 * Verifica los 5 modos (perSentence/perChunkWithAnchors/perChunkNoAnchors/
 * ttsDynamic/unknown) + ownership + cancellation + cleanup determinístico
 * + heuristic timeline + edge cases (duration NaN/Infinity, anchors malformed,
 * sentence_group vacío) + soak básico.
 *
 * Cómo correr:
 *   node utils/__tests__/syncStrategyExecutor.test.mjs
 */

import {
    executeSyncStrategy,
    buildHeuristicTimeline,
} from '../syncStrategyExecutor.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, hint = '') {
    if (cond) { console.log('  ✓', label); pass++; }
    else      { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
}
function section(label) { console.log('\n' + label); }

// ────────────────────────────────────────────────────────────────────────────
// Mock HTMLAudioElement — Node-friendly
// ────────────────────────────────────────────────────────────────────────────
function makeMockAudio({ duration = NaN, currentTime = 0 } = {}) {
    const listeners = new Map();
    const audio = {
        currentTime,
        duration,
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
        // Test-only helpers
        _emit(event) {
            const arr = listeners.get(event) || [];
            for (const cb of arr.slice()) cb();
        },
        _setTime(t) {
            this.currentTime = t;
            this._emit('timeupdate');
        },
        _setDuration(d) {
            this.duration = d;
            this._emit('loadedmetadata');
        },
        _listenerCount(event) {
            return (listeners.get(event) || []).length;
        },
        _allListenerCount() {
            let total = 0;
            for (const arr of listeners.values()) total += arr.length;
            return total;
        },
    };
    return audio;
}

function silentLogger() { /* no-op for tests where we don't need logs */ }

// ────────────────────────────────────────────────────────────────────────────
section('[1] perSentence — NO-OP, isAlive=true, no listeners attached');
{
    const audio = makeMockAudio();
    const activated = [];
    const handle = executeSyncStrategy({
        mode: 'perSentence',
        audioElement: audio,
        sentenceGroup: [{ absoluteSentenceIndex: 0, weight: 50 }],
        sessionId: 'test-1',
        onSentenceActivate: (i) => activated.push(i),
        logger: silentLogger,
    });
    ok('handle.mode === perSentence',           handle.mode === 'perSentence');
    ok('handle.sessionId === test-1',           handle.sessionId === 'test-1');
    ok('handle.isAlive() === true',             handle.isAlive() === true);
    ok('NO listeners attached (noop)',          audio._allListenerCount() === 0);
    handle.cancel();
    ok('cancel: isAlive=false',                 handle.isAlive() === false);
    ok('cancel idempotente',                    (() => { handle.cancel(); return handle.isAlive() === false; })());
    ok('NO activations',                        activated.length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[2] ttsDynamic — mismo path no-op');
{
    const audio = makeMockAudio();
    const handle = executeSyncStrategy({
        mode: 'ttsDynamic',
        audioElement: audio,
        sentenceGroup: [{ absoluteSentenceIndex: 0, weight: 50 }],
        sessionId: 'test-2',
        onSentenceActivate: () => {},
        logger: silentLogger,
    });
    ok('mode === ttsDynamic',                   handle.mode === 'ttsDynamic');
    ok('isAlive=true sin listeners',            handle.isAlive() === true && audio._allListenerCount() === 0);
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[3] unknown — fallback no-op + log');
{
    const audio = makeMockAudio();
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'unknown',
        audioElement: audio,
        sentenceGroup: [],
        sessionId: 'test-3',
        onSentenceActivate: () => {},
        logger: (e, d) => logs.push({ e, d }),
    });
    ok('isAlive=true noop',                     handle.isAlive() === true);
    ok('emite SYNC_STRATEGY_EXEC_START',        logs.some(l => l.e === 'SYNC_STRATEGY_EXEC_START'));
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[4] perChunkWithAnchors — activa frases en orden vía timeupdate');
{
    const audio = makeMockAudio({ duration: 30 });
    const activated = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 50 },
            { absoluteSentenceIndex: 1, weight: 80 },
            { absoluteSentenceIndex: 2, weight: 60 },
        ],
        anchors: [
            { absoluteSentenceIndex: 0, startMs: 0 },
            { absoluteSentenceIndex: 1, startMs: 5000 },
            { absoluteSentenceIndex: 2, startMs: 12000 },
        ],
        sessionId: 'test-4',
        onSentenceActivate: (i) => activated.push(i),
        logger: silentLogger,
    });
    ok('listener timeupdate registrado',        audio._listenerCount('timeupdate') === 1);
    ok('listener ended registrado',             audio._listenerCount('ended') === 1);
    ok('initial tick activa idx=0',             activated.length === 1 && activated[0] === 0);
    audio._setTime(5);
    ok('tick @ 5s activa idx=1',                activated.length === 2 && activated[1] === 1);
    audio._setTime(8); // entre 5 y 12 → no activa nada nuevo
    ok('tick @ 8s no activa nada nuevo',        activated.length === 2);
    audio._setTime(12);
    ok('tick @ 12s activa idx=2',               activated.length === 3 && activated[2] === 2);
    audio._setTime(15);
    ok('tick @ 15s no re-activa',               activated.length === 3);
    handle.cancel();
    ok('cancel limpia listeners',               audio._allListenerCount() === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[5] perChunkWithAnchors — anchors faltantes parciales toleradas');
{
    const audio = makeMockAudio({ duration: 30 });
    const activated = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 50 },
            { absoluteSentenceIndex: 1, weight: 80 },
            { absoluteSentenceIndex: 2, weight: 60 },
        ],
        anchors: [
            { absoluteSentenceIndex: 0, startMs: 0 },
            // sin anchor para 1
            { absoluteSentenceIndex: 2, startMs: 10000 },
            { absoluteSentenceIndex: 'invalid', startMs: 5000 },   // descartado
            { absoluteSentenceIndex: 99, startMs: NaN },           // descartado
        ],
        sessionId: 'test-5',
        onSentenceActivate: (i) => activated.push(i),
        logger: silentLogger,
    });
    ok('initial tick activa idx=0',             activated.includes(0));
    audio._setTime(5);
    ok('idx=1 NO se activa por estar sin anchor', !activated.includes(1));
    audio._setTime(10);
    ok('idx=2 sí se activa con anchor 10s',     activated.includes(2));
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[6] perChunkWithAnchors — sin anchors → SYNC_STRATEGY_FALLBACK');
{
    const audio = makeMockAudio({ duration: 30 });
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [{ absoluteSentenceIndex: 0, weight: 50 }],
        anchors: [],
        sessionId: 'test-6',
        onSentenceActivate: () => {},
        logger: (e, d) => logs.push({ e, d }),
    });
    ok('emite SYNC_STRATEGY_FALLBACK',          logs.some(l => l.e === 'SYNC_STRATEGY_FALLBACK'));
    ok('handle cancelado tras fallback',        handle.isAlive() === false);
    ok('no listeners atacheados',               audio._allListenerCount() === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[7] perChunkNoAnchors — heurística con duration disponible');
{
    const audio = makeMockAudio({ duration: 21 }); // 21s = 21000ms
    const activated = [];
    const logs = [];
    // 3 frases, weights 50/30/20 (total 100), distribución proporcional sobre 21s:
    //  idx 0: 0    -> 0%
    //  idx 1: 10500 (50% de 21000)
    //  idx 2: 16800 (80% de 21000)
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 50 },
            { absoluteSentenceIndex: 1, weight: 30 },
            { absoluteSentenceIndex: 2, weight: 20 },
        ],
        sessionId: 'test-7',
        onSentenceActivate: (i) => activated.push(i),
        logger: (e, d) => logs.push({ e, d }),
    });
    ok('emite CHUNK_NO_ANCHORS_HEURISTIC',      logs.some(l => l.e === 'CHUNK_NO_ANCHORS_HEURISTIC'));
    ok('emite HEURISTIC_TIMELINE_BUILT',        logs.some(l => l.e === 'HEURISTIC_TIMELINE_BUILT'));
    ok('initial tick activa idx=0',             activated[0] === 0);
    audio._setTime(11); // > 10500ms
    ok('tick @ 11s activa idx=1',               activated.includes(1));
    audio._setTime(17);
    ok('tick @ 17s activa idx=2',               activated.includes(2));
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[8] perChunkNoAnchors — duration NaN → espera loadedmetadata');
{
    const audio = makeMockAudio({ duration: NaN });
    const activated = [];
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 50 },
            { absoluteSentenceIndex: 1, weight: 50 },
        ],
        sessionId: 'test-8',
        onSentenceActivate: (i) => activated.push(i),
        logger: (e, d) => logs.push({ e, d }),
        metadataTimeoutMs: 100,
    });
    ok('NO activación previa metadata',         activated.length === 0);
    ok('listener loadedmetadata registrado',    audio._listenerCount('loadedmetadata') === 1);
    ok('emite HEURISTIC_DURATION_UNAVAILABLE waiting',
        logs.some(l => l.e === 'HEURISTIC_DURATION_UNAVAILABLE' && l.d.waitingMsMax === 100));
    audio._setDuration(10);
    ok('tras loadedmetadata: timeline construida + activa idx=0',
        activated.includes(0));
    ok('listener loadedmetadata removido',      audio._listenerCount('loadedmetadata') === 0);
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[9] perChunkNoAnchors — duration nunca llega → fallback word-count (BLOCKER M-5.4.3)');
{
    const audio = makeMockAudio({ duration: NaN });
    const activated = [];
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 50 },
            { absoluteSentenceIndex: 1, weight: 80 },
            { absoluteSentenceIndex: 2, weight: 40 },
        ],
        sessionId: 'test-9',
        onSentenceActivate: (i) => activated.push(i),
        logger: (e, d) => logs.push({ e, d }),
        metadataTimeoutMs: 30,
    });
    // Esperar el timeout — debe ENGANCHAR el fallback en vez de degradar
    await new Promise(r => setTimeout(r, 60));
    ok('emite HEURISTIC_WAIT_METADATA',          logs.some(l => l.e === 'HEURISTIC_WAIT_METADATA'));
    ok('emite HEURISTIC_DURATION_UNAVAILABLE via timeout con decision engage_fallback',
        logs.some(l => l.e === 'HEURISTIC_DURATION_UNAVAILABLE' && l.d.via === 'timeout' && l.d.decision === 'engage_fallback_word_count'));
    ok('emite HEURISTIC_DURATION_FALLBACK_USED', logs.some(l => l.e === 'HEURISTIC_DURATION_FALLBACK_USED'));
    ok('isAlive=true tras fallback',             handle.isAlive() === true);
    ok('timeline tiene 3 entries',               handle.getTimeline().length === 3);
    ok('SYNC_STRATEGY_EXEC_START en fallback',   logs.some(l => l.e === 'SYNC_STRATEGY_EXEC_START' && l.d.via === 'fallback_word_count'));
    ok('activated incluye sentence 0 (initial tick)', activated.includes(0));
    ok('listener loadedmetadata limpio post-fallback', audio._listenerCount('loadedmetadata') === 0);
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[10] perChunkNoAnchors — duration Infinity → fallback word-count (BLOCKER M-5.4.3)');
{
    const audio = makeMockAudio({ duration: Infinity });
    const logs = [];
    const activated = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 50 },
            { absoluteSentenceIndex: 1, weight: 80 },
        ],
        sessionId: 'test-10',
        onSentenceActivate: (i) => activated.push(i),
        logger: (e, d) => logs.push({ e, d }),
        metadataTimeoutMs: 30,
    });
    await new Promise(r => setTimeout(r, 60));
    ok('emite HEURISTIC_DURATION_UNAVAILABLE',         logs.some(l => l.e === 'HEURISTIC_DURATION_UNAVAILABLE'));
    ok('emite HEURISTIC_DURATION_FALLBACK_USED',       logs.some(l => l.e === 'HEURISTIC_DURATION_FALLBACK_USED'));
    ok('timeline tiene 2 entries tras fallback',       handle.getTimeline().length === 2);
    ok('isAlive=true (no canceló)',                    handle.isAlive() === true);
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[10b] perChunkNoAnchors — fallback respeta piso 1200ms para frases cortas');
{
    const audio = makeMockAudio({ duration: NaN });
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 5 },   // 5 chars — debería caer al piso
            { absoluteSentenceIndex: 1, weight: 5 },
            { absoluteSentenceIndex: 2, weight: 5 },
        ],
        sessionId: 'test-10b',
        onSentenceActivate: () => {},
        logger: (e, d) => logs.push({ e, d }),
        metadataTimeoutMs: 30,
    });
    await new Promise(r => setTimeout(r, 60));
    const tl = handle.getTimeline();
    ok('timeline construida',                          tl.length === 3);
    ok('startMs[1] >= 1200 (piso por frase)',          tl[1].startMs >= 1200);
    ok('startMs[2] >= 2400 (piso acumulado)',          tl[2].startMs >= 2400);
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[10c] perChunkNoAnchors — fallback escala con playbackSpeed=2x');
{
    const audio = makeMockAudio({ duration: NaN });
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        playbackSpeed: 2,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 100 },
            { absoluteSentenceIndex: 1, weight: 100 },
        ],
        sessionId: 'test-10c',
        onSentenceActivate: () => {},
        logger: (e, d) => logs.push({ e, d }),
        metadataTimeoutMs: 30,
    });
    await new Promise(r => setTimeout(r, 60));
    const tl = handle.getTimeline();
    ok('timeline construida con speed 2x',             tl.length === 2);
    // A 1x con weight=100 y 13.5 chars/sec → ~7400ms. A 2x → ~3700ms.
    // Floor a 2x = 600ms. Esperamos algo entre 3000 y 4500 (sin floor activado).
    ok('startMs[1] aproximado para 2x (>3000 <5000)',  tl[1].startMs > 3000 && tl[1].startMs < 5000);
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[10d] perChunkNoAnchors — loadedmetadata trae duration finita → NO fallback');
{
    const audio = makeMockAudio({ duration: NaN });
    const logs = [];
    const activated = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 50 },
            { absoluteSentenceIndex: 1, weight: 50 },
        ],
        sessionId: 'test-10d',
        onSentenceActivate: (i) => activated.push(i),
        logger: (e, d) => logs.push({ e, d }),
        metadataTimeoutMs: 100,
    });
    // Antes del timeout, llega loadedmetadata con duration finita
    audio.duration = 30;
    audio._emit('loadedmetadata');
    ok('emite HEURISTIC_METADATA_READY',               logs.some(l => l.e === 'HEURISTIC_METADATA_READY'));
    ok('emite HEURISTIC_TIMELINE_BUILT via metadata_event',
        logs.some(l => l.e === 'HEURISTIC_TIMELINE_BUILT' && l.d.via === 'metadata_event'));
    ok('NO emite HEURISTIC_DURATION_FALLBACK_USED',    !logs.some(l => l.e === 'HEURISTIC_DURATION_FALLBACK_USED'));
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
section('[10e] BLOCKER M-5.4.3 — real_manifest_v2_advances_visual');
// Reproduce el caso de Guerra de los Mundos: sentenceToChunk=[0..6]=0,
// mode=perChunkNoAnchors, anchors=[], audio.duration=30, currentTime avanza.
// Debe activar sentences 1, 2, 3... sin reload del audio, sin hardResync.
{
    const audio = makeMockAudio({ duration: 30 });
    const activated = [];
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 60 },
            { absoluteSentenceIndex: 1, weight: 80 },
            { absoluteSentenceIndex: 2, weight: 50 },
            { absoluteSentenceIndex: 3, weight: 70 },
            { absoluteSentenceIndex: 4, weight: 60 },
            { absoluteSentenceIndex: 5, weight: 90 },
            { absoluteSentenceIndex: 6, weight: 55 },
        ],
        anchors: [],
        sessionId: 'guerra-test',
        onSentenceActivate: (i) => activated.push(i),
        logger: (e, d) => logs.push({ e, d }),
    });
    // Initial tick debe activar sentence 0 con startMs=0
    ok('initial_tick activa sentence 0',               activated.includes(0));
    ok('HEURISTIC_EXEC_ENTER emitido',                 logs.some(l => l.e === 'HEURISTIC_EXEC_ENTER'));
    ok('HEURISTIC_TIMELINE_BUILT emitido',             logs.some(l => l.e === 'HEURISTIC_TIMELINE_BUILT' && l.d.via === 'duration_ready_at_spawn'));
    // Avanzar audio: a 5s deberíamos haber activado al menos sentence 1
    audio.currentTime = 5;
    audio._emit('timeupdate');
    ok('a t=5s, sentence 1 activada',                  activated.includes(1));
    audio.currentTime = 12;
    audio._emit('timeupdate');
    ok('a t=12s, sentence 2 o 3 activada',             activated.includes(2) || activated.includes(3));
    audio.currentTime = 30;
    audio._emit('ended');
    // Tras ended, catchup activa todas las remanentes
    ok('tras ended, sentences 4,5,6 activadas',        activated.includes(4) && activated.includes(5) && activated.includes(6));
    ok('NO doble activación',                          new Set(activated).size === activated.length);
    ok('isAlive=false tras ended',                     handle.isAlive() === false);
}

// ────────────────────────────────────────────────────────────────────────────
section('[10f] BLOCKER M-5.4.3 — sentenceGroup vacío en fallback → emite EMPTY_TIMELINE');
{
    const audio = makeMockAudio({ duration: NaN });
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup: [],
        sessionId: 'test-10f',
        onSentenceActivate: () => {},
        logger: (e, d) => logs.push({ e, d }),
        metadataTimeoutMs: 30,
    });
    await new Promise(r => setTimeout(r, 60));
    ok('emite HEURISTIC_DURATION_FALLBACK_USED',       logs.some(l => l.e === 'HEURISTIC_DURATION_FALLBACK_USED'));
    ok('emite SYNC_STRATEGY_EMPTY_TIMELINE en fallback',
        logs.some(l => l.e === 'SYNC_STRATEGY_EMPTY_TIMELINE' && l.d.reason === 'empty_sentence_group_in_fallback'));
    ok('isAlive=false tras empty fallback',            handle.isAlive() === false);
}

// ────────────────────────────────────────────────────────────────────────────
section('[11] OWNERSHIP — callbacks NO disparan tras cancel()');
{
    const audio = makeMockAudio({ duration: 30 });
    const activated = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [{ absoluteSentenceIndex: 0, weight: 50 }, { absoluteSentenceIndex: 1, weight: 50 }],
        anchors: [{ absoluteSentenceIndex: 0, startMs: 0 }, { absoluteSentenceIndex: 1, startMs: 5000 }],
        sessionId: 'test-11',
        onSentenceActivate: (i) => activated.push(i),
        logger: silentLogger,
    });
    ok('initial tick activa idx=0',             activated.includes(0));
    handle.cancel();
    audio._setTime(6);
    ok('tras cancel: setTime no activa',        !activated.includes(1));
    audio._emit('ended');
    ok('tras cancel: ended no dispara onChunkComplete',
        !activated.includes(1));
}

// ────────────────────────────────────────────────────────────────────────────
section('[12] CHUNK_COMPLETE — onChunkComplete fires on audio.ended');
{
    const audio = makeMockAudio({ duration: 30 });
    const activated = [];
    let chunkCompleteCalls = 0;
    executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [{ absoluteSentenceIndex: 0, weight: 50 }, { absoluteSentenceIndex: 1, weight: 50 }],
        anchors: [{ absoluteSentenceIndex: 0, startMs: 0 }, { absoluteSentenceIndex: 1, startMs: 5000 }],
        sessionId: 'test-12',
        onSentenceActivate: (i) => activated.push(i),
        onChunkComplete:    () => { chunkCompleteCalls++; },
        logger: silentLogger,
    });
    audio._emit('ended');
    ok('onChunkComplete invocado 1 vez',        chunkCompleteCalls === 1);
    ok('catchup activa idx=1 al ended',         activated.includes(1));
}

// ────────────────────────────────────────────────────────────────────────────
section('[13] No double activation con ticks rápidos');
{
    const audio = makeMockAudio({ duration: 10 });
    const activated = [];
    executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [{ absoluteSentenceIndex: 0, weight: 50 }],
        anchors: [{ absoluteSentenceIndex: 0, startMs: 0 }],
        sessionId: 'test-13',
        onSentenceActivate: (i) => activated.push(i),
        logger: silentLogger,
    });
    // Spam de ticks
    for (let i = 0; i < 100; i++) audio._setTime(i * 0.01);
    ok('idx=0 activado exactamente 1 vez',      activated.filter(i => i === 0).length === 1);
}

// ────────────────────────────────────────────────────────────────────────────
section('[14] buildHeuristicTimeline — pesos válidos');
{
    const t = buildHeuristicTimeline(
        [{ absoluteSentenceIndex: 0, weight: 50 }, { absoluteSentenceIndex: 1, weight: 30 }, { absoluteSentenceIndex: 2, weight: 20 }],
        10000,
    );
    ok('3 entries',                             t.length === 3);
    ok('idx 0 startMs === 0',                   t[0].startMs === 0);
    ok('idx 1 startMs === 5000',                t[1].startMs === 5000);
    ok('idx 2 startMs === 8000',                t[2].startMs === 8000);
}

// ────────────────────────────────────────────────────────────────────────────
section('[15] buildHeuristicTimeline — peso inválido cae a 1');
{
    const t = buildHeuristicTimeline(
        [{ absoluteSentenceIndex: 0, weight: NaN }, { absoluteSentenceIndex: 1, weight: -5 }, { absoluteSentenceIndex: 2, weight: 1 }],
        3000,
    );
    ok('3 entries con weight default 1',        t.length === 3);
    ok('cada uno toma 1/3',                     Math.round(t[1].startMs) === 1000 && Math.round(t[2].startMs) === 2000);
}

// ────────────────────────────────────────────────────────────────────────────
section('[16] buildHeuristicTimeline — duration 0/NaN → vacío');
{
    ok('duration 0 → []',                       buildHeuristicTimeline([{absoluteSentenceIndex:0,weight:1}], 0).length === 0);
    ok('duration NaN → []',                     buildHeuristicTimeline([{absoluteSentenceIndex:0,weight:1}], NaN).length === 0);
    ok('group vacío → []',                      buildHeuristicTimeline([], 10000).length === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[17] cancel idempotente + logger no llamado tras cancel');
{
    const audio = makeMockAudio({ duration: 10 });
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [{absoluteSentenceIndex:0,weight:1}],
        anchors: [{absoluteSentenceIndex:0,startMs:0}],
        sessionId: 'test-17',
        onSentenceActivate: () => {},
        logger: (e, d) => logs.push({ e, d }),
    });
    const before = logs.length;
    handle.cancel();
    handle.cancel();
    handle.cancel();
    const cancelLogs = logs.slice(before).filter(l => l.e === 'SYNC_STRATEGY_CANCEL');
    ok('un solo SYNC_STRATEGY_CANCEL pese a múltiples cancel()', cancelLogs.length === 1);
}

// ────────────────────────────────────────────────────────────────────────────
section('[18] onSentenceActivate inválido → cancel + log');
{
    const audio = makeMockAudio({ duration: 10 });
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [{absoluteSentenceIndex:0,weight:1}],
        anchors: [{absoluteSentenceIndex:0,startMs:0}],
        sessionId: 'test-18',
        onSentenceActivate: 'not-a-function',
        logger: (e, d) => logs.push({ e, d }),
    });
    ok('isAlive=false',                         handle.isAlive() === false);
    ok('emite SYNC_STRATEGY_INVALID_OPTS',      logs.some(l => l.e === 'SYNC_STRATEGY_INVALID_OPTS'));
    ok('NO listeners attached',                 audio._allListenerCount() === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[19] onSentenceActivate throws → onError invocado, sigue corriendo');
{
    const audio = makeMockAudio({ duration: 30 });
    const errors = [];
    const activated = [];
    executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [{absoluteSentenceIndex:0,weight:1},{absoluteSentenceIndex:1,weight:1}],
        anchors: [{absoluteSentenceIndex:0,startMs:0},{absoluteSentenceIndex:1,startMs:5000}],
        sessionId: 'test-19',
        onSentenceActivate: (i) => {
            if (i === 0) throw new Error('boom');
            activated.push(i);
        },
        onError: (e) => errors.push(e),
        logger: silentLogger,
    });
    ok('onError llamado para idx=0',            errors.length >= 1 && errors[0].message === 'boom');
    audio._setTime(5);
    ok('idx=1 sigue activándose',               activated.includes(1));
}

// ────────────────────────────────────────────────────────────────────────────
section('[20] SOAK — 30 frases, 1000 ticks, sin doble activación + cleanup limpio');
{
    const audio = makeMockAudio({ duration: 300 });
    const activated = [];
    const sentenceGroup = Array.from({ length: 30 }, (_, i) => ({ absoluteSentenceIndex: i, weight: 1 }));
    const anchors = sentenceGroup.map((s, i) => ({ absoluteSentenceIndex: i, startMs: i * 10000 }));
    const handle = executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup,
        anchors,
        sessionId: 'test-soak',
        onSentenceActivate: (i) => activated.push(i),
        logger: silentLogger,
    });
    // 1000 ticks recorriendo 0 → 300s
    for (let i = 0; i <= 1000; i++) {
        audio._setTime(i * 0.3);
    }
    ok('30 activaciones exactas (sin dobles)',  activated.length === 30);
    ok('orden monótono creciente',              activated.every((v, i) => v === i));
    handle.cancel();
    ok('cleanup completo: 0 listeners',         audio._allListenerCount() === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[BLOCKER-V2 / TASK 3] chunk_executor_complete_emits_once');
{
    // Repro del log del smoke S-2: "muchos SYNC_STRATEGY_COMPLETE repetidos".
    // Antes, cada timeupdate posterior a agotar la timeline re-logueaba
    // SYNC_STRATEGY_COMPLETE; y el ended emitía OTRO más. Ahora: ≤1 por executor.
    const audio = makeMockAudio({ duration: 10 });
    const logs = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 10 },
            { absoluteSentenceIndex: 1, weight: 10 },
        ],
        sessionId: 'test-complete-once',
        onSentenceActivate: () => {},
        logger: (e, d) => logs.push({ e, d }),
    });
    // Llevar el audio más allá del final → ambas frases activadas → complete.
    audio._setTime(6);
    audio._setTime(9);
    audio._setTime(9.5);   // timeupdates EXTRA tras completar
    audio._setTime(9.9);
    audio._setTime(9.99);
    const completesAfterTimeupdates =
        logs.filter(l => l.e === 'SYNC_STRATEGY_COMPLETE').length;
    ok('SYNC_STRATEGY_COMPLETE exactamente 1 tras múltiples timeupdates',
       completesAfterTimeupdates === 1, `got ${completesAfterTimeupdates}`);
    // Tras complete, el executor dejó de escuchar timeupdate.
    ok('0 listeners timeupdate tras complete',
       audio._listenerCount('timeupdate') === 0);
    ok('sigue vivo para ended (onChunkComplete)', handle.isAlive() === true);
    // Ahora el ended NO debe agregar un segundo SYNC_STRATEGY_COMPLETE.
    audio._emit('ended');
    const completesTotal =
        logs.filter(l => l.e === 'SYNC_STRATEGY_COMPLETE').length;
    ok('SYNC_STRATEGY_COMPLETE sigue siendo 1 tras ended (≤1 por executor)',
       completesTotal === 1, `got ${completesTotal}`);
    ok('tras ended: executor cancelado',           handle.isAlive() === false);
    ok('cleanup completo: 0 listeners',            audio._allListenerCount() === 0);
}

// ────────────────────────────────────────────────────────────────────────────
section('[BLOCKER-V2 / TASK 3] complete_via_ended_when_timeline_not_exhausted');
{
    // Si el audio termina ANTES de agotar la timeline (audio más corto que lo
    // estimado), el catchup del ended activa el remanente y emite UN solo
    // SYNC_STRATEGY_COMPLETE (vía ended_catchup o audio_ended), nunca dos.
    const audio = makeMockAudio({ duration: 100 });
    const logs = [];
    let chunkCompleteCalls = 0;
    const handle = executeSyncStrategy({
        mode: 'perChunkWithAnchors',
        audioElement: audio,
        sentenceGroup: [
            { absoluteSentenceIndex: 0, weight: 1 },
            { absoluteSentenceIndex: 1, weight: 1 },
            { absoluteSentenceIndex: 2, weight: 1 },
        ],
        anchors: [
            { absoluteSentenceIndex: 0, startMs: 0 },
            { absoluteSentenceIndex: 1, startMs: 40000 },
            { absoluteSentenceIndex: 2, startMs: 90000 },
        ],
        sessionId: 'test-complete-ended',
        onSentenceActivate: () => {},
        onChunkComplete:    () => { chunkCompleteCalls++; },
        logger: (e, d) => logs.push({ e, d }),
    });
    audio._setTime(1);            // solo activa idx 0
    audio._emit('ended');         // ended con timeline NO agotada → catchup
    const completes = logs.filter(l => l.e === 'SYNC_STRATEGY_COMPLETE').length;
    ok('SYNC_STRATEGY_COMPLETE exactamente 1 (catchup + ended)',
       completes === 1, `got ${completes}`);
    ok('onChunkComplete invocado 1 vez', chunkCompleteCalls === 1);
    ok('cleanup completo: 0 listeners',  audio._allListenerCount() === 0);
    void handle;
}

// ────────────────────────────────────────────────────────────────────────────
section('[BLOCKER-V2 / TASK 3] active_executor_stops_reacting_after_complete');
{
    // Garantiza que un executor "completado" ya no reacciona a timeupdate:
    // base para "activeExecutor nunca supera 1" — el executor del chunk
    // anterior no sigue activando frases mientras el nuevo ya corre.
    const audio = makeMockAudio({ duration: 5 });
    const activated = [];
    const handle = executeSyncStrategy({
        mode: 'perChunkNoAnchors',
        audioElement: audio,
        sentenceGroup: [{ absoluteSentenceIndex: 0, weight: 1 }],
        sessionId: 'test-after-complete',
        onSentenceActivate: (i) => activated.push(i),
        logger: silentLogger,
    });
    audio._setTime(3);    // activa idx 0 → timeline agotada → complete
    const countAfterComplete = activated.length;
    audio._setTime(4);    // timeupdate posterior: NO debe re-activar nada
    audio._setTime(4.9);
    ok('no hay activaciones tras complete',
       activated.length === countAfterComplete);
    ok('timeupdate desenganchado (0 listeners)',
       audio._listenerCount('timeupdate') === 0);
    handle.cancel();
}

// ────────────────────────────────────────────────────────────────────────────
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
