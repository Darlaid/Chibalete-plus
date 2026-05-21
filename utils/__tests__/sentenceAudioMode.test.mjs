/**
 * sentenceAudioMode.test.mjs — Cobertura del contrato general de detección.
 *
 * Verifica los 5 modos: perSentence / perChunkWithAnchors / perChunkNoAnchors
 * / ttsDynamic / unknown — y los degraded reasons.
 *
 * Cómo correr:
 *   node utils/__tests__/sentenceAudioMode.test.mjs
 */

import { detectSentenceAudioMode, audioModeToLogPayload } from '../sentenceAudioMode.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, hint = '') {
    if (cond) { console.log('  ✓', label); pass++; }
    else      { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
}
function section(label) { console.log('\n' + label); }

// ────────────────────────────────────────────────────────────────────────────
section('[1] ttsDynamic — sin manifest, hay sentences');
{
    const meta = detectSentenceAudioMode({
        manifest: null,
        anchorsMap: {},
        sentenceToChunk: [],
        audioSentencesLen: 50,
        contentId: 'test-tts',
    });
    ok('mode === ttsDynamic',           meta.mode === 'ttsDynamic');
    ok('degradedReason === null',       meta.degradedReason === null);
    ok('strategy menciona /api/tts',    /\/api\/tts/.test(meta.strategy));
}

// ────────────────────────────────────────────────────────────────────────────
section('[2] perSentence — manifest con identity mapping');
{
    const meta = detectSentenceAudioMode({
        manifest: { '0': { file: 'a.mp3' }, '1': { file: 'b.mp3' } },
        anchorsMap: {},
        sentenceToChunk: [0, 1],
        audioSentencesLen: 2,
        contentId: 'test-perSentence',
    });
    ok('mode === perSentence',          meta.mode === 'perSentence');
    ok('degradedReason === null',       meta.degradedReason === null);
    ok('chunkSpread === null',          meta.diagnostics.chunkSpread === null);
}

// ────────────────────────────────────────────────────────────────────────────
section('[3] perSentence — manifest pero sentenceToChunk vacío');
{
    const meta = detectSentenceAudioMode({
        manifest: { '0': { file: 'a.mp3' } },
        anchorsMap: {},
        sentenceToChunk: [],
        audioSentencesLen: 1,
        contentId: 'test-empty-s2c',
    });
    ok('mode === perSentence',          meta.mode === 'perSentence');
    ok('sentenceToChunkIsIdentity true', meta.diagnostics.sentenceToChunkIsIdentity === true);
}

// ────────────────────────────────────────────────────────────────────────────
section('[4] perChunkNoAnchors — múltiples sentences/chunk, anchors vacíos');
{
    // 7 sentences mapeadas a 1 chunk (chunk 0 contiene sentences 0..6)
    const meta = detectSentenceAudioMode({
        manifest: { '0': { file: 'chunk0.mp3', sentences: ['s0','s1','s2','s3','s4','s5','s6'] } },
        anchorsMap: {},
        sentenceToChunk: [0, 0, 0, 0, 0, 0, 0],
        audioSentencesLen: 7,
        contentId: 'test-chunk-no-anchors',
    });
    ok('mode === perChunkNoAnchors',    meta.mode === 'perChunkNoAnchors');
    ok('degradedReason populated',      typeof meta.degradedReason === 'string' && meta.degradedReason.length > 0);
    ok('chunkSpread.max === 7',         meta.diagnostics.chunkSpread?.max === 7);
    ok('chunkSpread.distinctChunks 1',  meta.diagnostics.chunkSpread?.distinctChunks === 1);
}

// ────────────────────────────────────────────────────────────────────────────
section('[5] perChunkWithAnchors — múltiples sentences/chunk + anchors útiles');
{
    const meta = detectSentenceAudioMode({
        manifest: { '0': { file: 'chunk0.mp3' } },
        anchorsMap: { 0: [{ id: 'a-0-0', chunkIndex: 0, type: 'insight' }] },
        sentenceToChunk: [0, 0, 0, 0, 0],
        audioSentencesLen: 5,
        contentId: 'test-chunk-with-anchors',
    });
    ok('mode === perChunkWithAnchors',  meta.mode === 'perChunkWithAnchors');
    ok('degradedReason === null',       meta.degradedReason === null);
    ok('hasAnchorsMap === true',        meta.diagnostics.hasAnchorsMap === true);
}

// ────────────────────────────────────────────────────────────────────────────
section('[6] perChunkNoAnchors — anchors existen pero NO en chunk multifrase');
{
    // Chunk 0 multi-frase, anchors solo en chunk 1 (que es 1 frase) → no útiles.
    const meta = detectSentenceAudioMode({
        manifest: { '0': { file: 'c0.mp3' }, '1': { file: 'c1.mp3' } },
        anchorsMap: { 1: [{ id: 'a-1-0', chunkIndex: 1, type: 'insight' }] },
        sentenceToChunk: [0, 0, 0, 1],
        audioSentencesLen: 4,
        contentId: 'test-chunk-anchors-wrong-chunk',
    });
    ok('mode === perChunkNoAnchors',    meta.mode === 'perChunkNoAnchors');
    ok('hasAnchorsMap=true pero degradado',
        meta.diagnostics.hasAnchorsMap === true && meta.degradedReason !== null);
}

// ────────────────────────────────────────────────────────────────────────────
section('[7] unknown — sin manifest y sin sentences');
{
    const meta = detectSentenceAudioMode({
        manifest: null,
        anchorsMap: null,
        sentenceToChunk: null,
        audioSentencesLen: 0,
        contentId: 'test-empty',
    });
    ok('mode === unknown',              meta.mode === 'unknown');
    ok('degradedReason === no_manifest_and_no_sentences',
        meta.degradedReason === 'no_manifest_and_no_sentences');
}

// ────────────────────────────────────────────────────────────────────────────
section('[8] audioModeToLogPayload — shape estable');
{
    const meta = detectSentenceAudioMode({
        manifest: null, anchorsMap: {}, sentenceToChunk: [],
        audioSentencesLen: 10, contentId: 'test-payload',
    });
    const p = audioModeToLogPayload(meta);
    ok('payload.kind === PB_AUDIO_MODE_DETECTED', p.kind === 'PB_AUDIO_MODE_DETECTED');
    ok('payload tiene contentId, mode, strategy, diagnostics',
        ['contentId','mode','strategy','diagnostics','degradedReason','detectedAt']
            .every(k => k in p));
}

// ────────────────────────────────────────────────────────────────────────────
section('[9] perSentence — chunkSpread nulo cuando es identity');
{
    const meta = detectSentenceAudioMode({
        manifest: { '0': {}, '1': {}, '2': {} },
        anchorsMap: {},
        sentenceToChunk: [0, 1, 2],
        audioSentencesLen: 3,
        contentId: 'test-identity',
    });
    ok('chunkSpread === null en identity', meta.diagnostics.chunkSpread === null);
}

// ────────────────────────────────────────────────────────────────────────────
section('[10] manifest con _meta filtrado en conteo');
{
    const meta = detectSentenceAudioMode({
        manifest: { '_meta': { version: 2 }, '0': {}, '1': {} },
        anchorsMap: {},
        sentenceToChunk: [0, 1],
        audioSentencesLen: 2,
        contentId: 'test-meta',
    });
    ok('manifestEntries === 2 (excluye _meta)', meta.diagnostics.manifestEntries === 2);
    ok('mode === perSentence',                  meta.mode === 'perSentence');
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
