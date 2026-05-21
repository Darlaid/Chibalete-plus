/**
 * gaplessChunkGuard.test.mjs — BLOCKER FINAL V2 / TASK 2 + TASK 4.
 *
 * Verifica la decisión PURA del invariante de transición de chunk. El hook
 * (useImmersivePlayback) importa y usa decideChunkTransition: estos tests
 * ejercen el código REAL de decisión, no una simulación.
 *
 * Tests nombrados (TASK 4):
 *   - gapless_chunk_transition_loads_expected_audio_before_play
 *   - chunk_audio_source_mismatch_blocks_spawn
 *   - perChunkNoAnchors_chunk0_to_chunk1_no_audio_restart
 *
 * Cómo correr:
 *   node utils/__tests__/gaplessChunkGuard.test.mjs
 */

import {
    decideChunkTransition,
    preventsStaleAudioRestart,
} from '../gaplessChunkGuard.mjs';

let pass = 0;
let fail = 0;
function ok(label, cond, hint = '') {
    if (cond) { console.log('  ✓', label); pass++; }
    else      { console.error('  ✗', label, hint ? `— ${hint}` : ''); fail++; }
}
function section(label) { console.log('\n' + label); }

// Modelo del cache de audio por chunkKey (idéntico al del hook: getAudioUrl
// resuelve un blob URL estable por chunkKey).
const CHUNK_SRC = {
    0: 'blob:http://localhost/chunk-0',
    1: 'blob:http://localhost/chunk-1',
    2: 'blob:http://localhost/chunk-2',
};

// ────────────────────────────────────────────────────────────────────────────
section('[1] reuse — audio activo YA es el del chunk esperado (perSentence/igual)');
{
    const d = decideChunkTransition({
        expectedChunkKey: 5,
        expectedAudioSrc: 'blob:s5',
        actualAudioSrc:   'blob:s5',
    });
    ok('action === reuse', d.action === 'reuse', JSON.stringify(d));
    ok('reason === already_correct_src', d.reason === 'already_correct_src');
    ok('preventsStaleAudioRestart === false (reuse legítimo)',
       preventsStaleAudioRestart({
           expectedChunkKey: 5, expectedAudioSrc: 'blob:s5', actualAudioSrc: 'blob:s5',
       }) === false);
}

// ────────────────────────────────────────────────────────────────────────────
section('[2] gapless_chunk_transition_loads_expected_audio_before_play');
{
    // El standby quedó con el audio del chunk 0 (modelo A/B asume 1 audio = 1
    // frase). Target es la primera frase del chunk 1. La decisión DEBE ser
    // 'reload' → el caller carga el audio correcto ANTES de play().
    const d = decideChunkTransition({
        expectedChunkKey: 1,
        expectedAudioSrc: CHUNK_SRC[1],
        actualAudioSrc:   CHUNK_SRC[0],   // STALE
    });
    ok('action === reload', d.action === 'reload', JSON.stringify(d));
    ok('reason === stale_audio_src_for_target_chunk',
       d.reason === 'stale_audio_src_for_target_chunk');
    ok('NUNCA reuse (no se reproduce el audio stale)', d.action !== 'reuse');
    ok('preventsStaleAudioRestart === true', preventsStaleAudioRestart({
        expectedChunkKey: 1, expectedAudioSrc: CHUNK_SRC[1], actualAudioSrc: CHUNK_SRC[0],
    }) === true);
}

// ────────────────────────────────────────────────────────────────────────────
section('[3] chunk_audio_source_mismatch_blocks_spawn');
{
    // Si no se resuelve el src esperado (getAudioUrl → null), la decisión es
    // 'fail' → el caller hace fallback determinista (load limpio), NUNCA play
    // ni spawn sobre audio equivocado.
    const dNull = decideChunkTransition({
        expectedChunkKey: 1, expectedAudioSrc: null, actualAudioSrc: CHUNK_SRC[0],
    });
    ok('expectedSrc null → action === fail', dNull.action === 'fail', JSON.stringify(dNull));
    ok('reason === no_expected_src_resolved',
       dNull.reason === 'no_expected_src_resolved');

    const dEmpty = decideChunkTransition({
        expectedChunkKey: 1, expectedAudioSrc: '', actualAudioSrc: CHUNK_SRC[0],
    });
    ok('expectedSrc "" → action === fail', dEmpty.action === 'fail');

    // En ambos casos, 'fail' y 'reload' bloquean el spawn-sobre-stale; solo
    // 'reuse' permite play directo. Verificamos que mismatch jamás es reuse.
    ok('mismatch (fail) no es reuse → spawn bloqueado', dNull.action !== 'reuse');
    ok('mismatch (reload) no es reuse → spawn bloqueado',
       decideChunkTransition({
           expectedChunkKey: 1, expectedAudioSrc: CHUNK_SRC[1], actualAudioSrc: CHUNK_SRC[0],
       }).action !== 'reuse');
}

// ────────────────────────────────────────────────────────────────────────────
section('[4] perChunkNoAnchors_chunk0_to_chunk1_no_audio_restart');
{
    // Reproducción exacta del smoke S-2 (Guerra/perChunkNoAnchors):
    //   - chunk 0 tiene frases 0..11, chunk 1 tiene frases 12..25.
    //   - el modelo A/B precargó el standby con getAudioUrl(idx+1) que, dentro
    //     del chunk 0, resuelve al MISMO blob del chunk 0 (stale).
    //   - al cruzar a la frase 12 (chunk 1), si se reprodujera ese audio
    //     stale → "el audio se reinicia mientras el texto sigue avanzando".
    //
    // El guard DEBE decidir 'reload' (no 'reuse') en TODA la transición de
    // borde de chunk → jamás hay reinicio del audio del chunk 0.
    const sentenceToChunk = [];
    for (let i = 0; i < 12; i++) sentenceToChunk[i] = 0;   // frases 0..11 → chunk 0
    for (let i = 12; i < 26; i++) sentenceToChunk[i] = 1;  // frases 12..25 → chunk 1
    const toChunkKey = (i) => sentenceToChunk[i];
    const getAudioUrlFor = (i) => CHUNK_SRC[toChunkKey(i)];

    // Estado del player standby tras el último ciclo gapless dentro del chunk
    // 0: su src quedó en el blob del chunk 0 (bug original).
    const standbyStaleSrc = CHUNK_SRC[0];

    // Transición a la primera frase del chunk 1 (idx 12):
    const targetIndex = 12;
    const d = decideChunkTransition({
        expectedChunkKey: toChunkKey(targetIndex),     // 1
        expectedAudioSrc: getAudioUrlFor(targetIndex), // chunk-1 blob
        actualAudioSrc:   standbyStaleSrc,             // chunk-0 blob (STALE)
    });
    ok('decisión = reload (no se reproduce el audio del chunk 0)',
       d.action === 'reload', JSON.stringify(d));
    ok('NO action reuse → NO audio restart', d.action !== 'reuse');
    ok('preventsStaleAudioRestart === true en chunk0→chunk1',
       preventsStaleAudioRestart({
           expectedChunkKey: toChunkKey(targetIndex),
           expectedAudioSrc: getAudioUrlFor(targetIndex),
           actualAudioSrc:   standbyStaleSrc,
       }) === true);

    // Tras el reload correcto, el src del player pasa a ser el del chunk 1.
    // Una segunda evaluación (defensa idempotente) debe dar 'reuse' SIN
    // recargar de nuevo (no bucle de recargas).
    const dAfter = decideChunkTransition({
        expectedChunkKey: toChunkKey(targetIndex),
        expectedAudioSrc: getAudioUrlFor(targetIndex),
        actualAudioSrc:   CHUNK_SRC[1],   // ya corregido
    });
    ok('post-reload: reuse (sin recarga en bucle)', dAfter.action === 'reuse');

    // Avance intra-chunk 1 (idx 12 → 13): mismo chunk, mismo src → reuse
    // (NO hay transición de audio dentro del chunk: cero reinicios).
    const dIntra = decideChunkTransition({
        expectedChunkKey: toChunkKey(13),
        expectedAudioSrc: getAudioUrlFor(13),   // sigue chunk-1 blob
        actualAudioSrc:   CHUNK_SRC[1],
    });
    ok('avance intra-chunk = reuse (sin reinicio de audio)',
       dIntra.action === 'reuse');
}

// ────────────────────────────────────────────────────────────────────────────
section('[5] perSentence — el standby siempre trae el audio correcto (no-op)');
{
    // perSentence: getAudioUrl(idx+1) == frase siguiente. El standby YA tiene
    // el src correcto → siempre reuse → cero cambio de comportamiento.
    for (let idx = 0; idx < 5; idx++) {
        const expected = `blob:sentence-${idx}`;
        const d = decideChunkTransition({
            expectedChunkKey: idx,
            expectedAudioSrc: expected,
            actualAudioSrc:   expected,
        });
        ok(`idx ${idx}: reuse (perSentence sin reload)`, d.action === 'reuse');
    }
}

// ────────────────────────────────────────────────────────────────────────────
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
