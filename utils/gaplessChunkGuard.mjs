/**
 * gaplessChunkGuard.mjs — BLOCKER FINAL V2 / TASK 2.
 *
 * Decisión PURA del invariante de transición de chunk en el path gapless.
 *
 * Extraída del hook (useImmersivePlayback) para ser unit-testeable: el hook
 * IMPORTA y USA esta misma función, por lo que los tests ejercen el código
 * real de decisión, NO una simulación.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROBLEMA QUE RESUELVE
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * El modelo de buffers A/B asume "1 audio = 1 frase": el player en standby se
 * precarga con getAudioUrl(idx+1). En contenido CHUNKED (perChunkNoAnchors /
 * perChunkWithAnchors) varias frases comparten UN audio de chunk, por lo que
 * idx+1 cae DENTRO del mismo chunk y el standby queda con el audio del chunk
 * que ACABA de terminar. Resultado del bug (smoke S-2):
 *   - handleEnded cruza a chunk N+1,
 *   - reproduce el audio STALE del chunk N (currentTime=0 → reinicio audible),
 *   - spawnea el executor de chunk N+1 contra ese audio equivocado,
 *   - el texto avanza con la timeline de N+1 mientras el audio repite N.
 *
 * El guard obliga, ANTES de play() y ANTES de spawn, a confirmar que el audio
 * activo corresponde al chunk esperado del target. Si no, recarga el audio
 * correcto antes de continuar.
 *
 * Para perSentence el standby YA trae el audio correcto (idx+1 == frase
 * siguiente) → la decisión es 'reuse' → cero cambio de comportamiento.
 */

/**
 * @typedef {object} ChunkTransitionInput
 * @property {number|string}  expectedChunkKey  toChunkKey(targetIndex)
 * @property {string|null}    expectedAudioSrc  getAudioUrl(targetIndex) resuelto (blob URL o null)
 * @property {string|null}    actualAudioSrc    audioEl.src actual del player que se va a reproducir
 *
 * @typedef {object} ChunkTransitionDecision
 * @property {'reuse'|'reload'|'fail'} action
 *   - 'reuse'  : el audio activo YA es el del chunk esperado → play directo OK.
 *   - 'reload' : MISMATCH → NO reproducir el audio stale; cargar el correcto,
 *                esperar readiness, currentTime=0, y recién entonces play+spawn.
 *   - 'fail'   : no se pudo resolver el audio esperado → caller hace fallback
 *                determinista (load limpio). NUNCA play sobre audio stale.
 * @property {string} reason
 */

/**
 * Decisión pura — sin I/O, sin side effects, sin acceso al DOM.
 *
 * @param {ChunkTransitionInput} p
 * @returns {ChunkTransitionDecision}
 */
export function decideChunkTransition(p) {
    const expectedAudioSrc = p ? p.expectedAudioSrc : null;
    const actualAudioSrc   = p ? p.actualAudioSrc   : null;

    if (expectedAudioSrc == null || expectedAudioSrc === '') {
        return { action: 'fail', reason: 'no_expected_src_resolved' };
    }
    const actual = actualAudioSrc || '';
    // audioEl.src devuelve la URL absoluta resuelta; los blob URLs cacheados
    // por chunkKey son estables y comparables exactamente como string.
    if (actual === expectedAudioSrc) {
        return { action: 'reuse', reason: 'already_correct_src' };
    }
    return { action: 'reload', reason: 'stale_audio_src_for_target_chunk' };
}

/**
 * Helper de aserción para tests/operación: dado un escenario de transición
 * chunk0 → chunk1 con el audio activo aún en chunk0, confirma que la decisión
 * NUNCA es reproducir el audio stale (es decir, jamás 'reuse').
 *
 * @param {ChunkTransitionInput} p
 * @returns {boolean} true si el guard PREVIENE el reinicio de audio.
 */
export function preventsStaleAudioRestart(p) {
    const d = decideChunkTransition(p);
    return d.action !== 'reuse';
}
