/**
 * immersiveTiming.js — Helpers puros de timing del Visor Inmersivo.
 *
 * Funciones pure, sin React, sin DOM, sin side effects. Importable desde:
 *   - hooks/useImmersivePlayback.ts (timing en runtime)
 *   - utils/__tests__/*.test.js     (verificación)
 *   - scripts/lint-immersive-guards.js (validación cross-cutting)
 *
 * Diseño: estos helpers materializan las INVARIANTES 7, 8 y 9 documentadas
 * en docs/immersive-mode-invariants.md. Cualquier cambio aquí debe ir
 * acompañado de cambios en los tests; los pre-build gates fallan si los
 * mínimos bajan de lo esperado.
 */

// ───────────────────────────────────────────────────────────────────────────
// CONSTANTES — pisos por wordCount, calibrados con feedback de usuario real
// (incidente content-1773089901847: frase de 4 palabras avanzaba en 182 ms).
// ───────────────────────────────────────────────────────────────────────────

export const MIN_MS_BY_WORDS = Object.freeze({
    ONE:        900,    // 1 palabra
    SHORT:     1400,    // 2-4 palabras
    MEDIUM:    2000,    // 5-8 palabras
    LONG_PER_WORD: 250, // ms por palabra adicional (>8 palabras)
});

/** Bonus por puntuación fuerte final / cierre de comillas/paréntesis */
export const STRONG_PUNCTUATION_BONUS_MS = 250;

/** Piso absoluto irreductible: ninguna frase visible avanza más rápido que esto. */
export const ABSOLUTE_FLOOR_MS = 450;

/** Threshold para considerar duración de audio "sospechosa" (cache corrupta). */
export const SUSPICIOUS_AUDIO_DURATION_S = 0.8;

/** Frases con menos palabras que esto no disparan invalidación de cache aunque
 *  la duración sea corta — pueden ser legítimamente cortas (ej. "Oh."). */
export const SUSPICIOUS_AUDIO_MIN_WORDS = 3;

// ───────────────────────────────────────────────────────────────────────────
// estimateMinSentenceMs — INVARIANTE 7
// ───────────────────────────────────────────────────────────────────────────

/**
 * Piso mínimo de duración VISUAL para una oración en el visor inmersivo.
 *
 * Reglas a 1x:
 *   - 1 palabra:        900 ms
 *   - 2 a 4 palabras:  1400 ms
 *   - 5 a 8 palabras:  2000 ms
 *   - >8 palabras:     max(2000, words * 250) ms
 *   - Puntuación fuerte final, cierre de paréntesis, comillas: +250 ms
 *
 * A velocidades > 1 el piso se escala inversamente, con un absoluto
 * irreductible de 450 ms (ABSOLUTE_FLOOR_MS).
 *
 * @param {string} sentence    Texto visible de la oración.
 * @param {number} [speed=1]   Multiplicador de velocidad (1.0, 1.25, 2.0…).
 * @returns {number}           Piso mínimo en ms.
 */
export function estimateMinSentenceMs(sentence, speed = 1) {
    const text = (sentence ?? '').trim();
    if (text.length === 0) return 600;
    const words = text.split(/\s+/).filter(Boolean).length;
    let base;
    if (words <= 1)      base = MIN_MS_BY_WORDS.ONE;
    else if (words <= 4) base = MIN_MS_BY_WORDS.SHORT;
    else if (words <= 8) base = MIN_MS_BY_WORDS.MEDIUM;
    else                 base = Math.max(MIN_MS_BY_WORDS.MEDIUM, words * MIN_MS_BY_WORDS.LONG_PER_WORD);
    // Strong punctuation / closing quote / paren at end → pausa extra para respiro
    if (/[).!?¿¡"”'']$/u.test(text)) base += STRONG_PUNCTUATION_BONUS_MS;
    const adjustedForSpeed = speed > 1 ? Math.round(base / speed) : base;
    return Math.max(ABSOLUTE_FLOOR_MS, adjustedForSpeed);
}

// ───────────────────────────────────────────────────────────────────────────
// normalizeSentenceForSpeech — INVARIANTE 8
// ───────────────────────────────────────────────────────────────────────────

/**
 * Normaliza una oración visible para enviarla a TTS, conservando el contenido
 * léxico significativo. NO usa stripping agresivo que pudiera reducir una
 * frase real a una palabra (ej: el incidente “” (Dinah era su gata).” →
 * "Dinah"). Sólo quita comillas curvas/rectas y paréntesis envolventes; las
 * palabras internas se preservan tal cual.
 *
 * Ejemplos:
 *   `" (Dinah era su gata).`   → `Dinah era su gata.`
 *   `"¡Querida Dinah!"`          → `¡Querida Dinah!`
 *   `"Abajo, abajo, abajo."`     → `Abajo, abajo, abajo.`
 *
 * @param {string} sentence
 * @returns {string}
 */
export function normalizeSentenceForSpeech(sentence) {
    let s = (sentence ?? '').trim();
    if (s.length === 0) return '';
    // Repetir hasta estabilizar (puede haber múltiples comillas/parens anidados)
    let prev = null;
    while (prev !== s) {
        prev = s;
        // Strip leading/trailing decorative chars (quotes, parens, dashes, spaces)
        s = s.replace(/^[\s"”“'‘’«»\(\[\{\-—–·•]+/u, '');
        s = s.replace(/[\s"”“'‘’«»\)\]\}\-—–·•]+$/u, (m) => {
            // Conservar puntuación fuerte si está pegada al final (ej. "gata).")
            const keep = m.match(/[.!?¿¡]/g);
            return keep ? keep.join('') : '';
        });
        s = s.trim();
    }
    return s;
}

// ───────────────────────────────────────────────────────────────────────────
// validateAudioDuration — INVARIANTE 9
// ───────────────────────────────────────────────────────────────────────────

/**
 * Valida si la duración del audio cacheado/cargado es coherente con el
 * texto de la oración. Detecta blobs cacheados defectuosos (incidente:
 * "Dinah era su gata" cacheado como 182 ms).
 *
 * @param {object} params
 * @param {string} params.displayText  Texto visible que el usuario lee.
 * @param {string} [params.spokenText] Texto efectivo enviado a TTS (opcional).
 * @param {number|null} params.duration Duración del audio en SEGUNDOS (audio.duration). null/NaN/Infinity → 'pending'.
 * @param {number|null} [params.blobSize] Tamaño en bytes del blob, si está disponible.
 * @param {boolean} [params.cached=false] Si el audio venía de cache cliente.
 * @param {number} [params.speed=1] Velocidad de playback.
 * @returns {{status: 'valid'|'suspicious'|'invalid'|'pending', reason: string, minExpectedMs: number, wordCount: number}}
 */
export function validateAudioDuration({
    displayText,
    spokenText,
    duration,
    blobSize,
    cached = false,
    speed = 1,
}) {
    const text = (spokenText ?? displayText ?? '').trim();
    const wordCount = text.split(/\s+/).filter(Boolean).length;
    const minExpectedMs = estimateMinSentenceMs(displayText ?? text, speed);

    // Pending: metadata aún no disponible
    if (duration === null || duration === undefined || !Number.isFinite(duration)) {
        return { status: 'pending', reason: 'duration_not_yet_available', minExpectedMs, wordCount };
    }

    if (duration <= 0) {
        return { status: 'invalid', reason: 'duration_zero_or_negative', minExpectedMs, wordCount };
    }

    // Invalid: frase de >=3 palabras con audio de <0.8s → cache corrupta sospechosa
    if (wordCount >= SUSPICIOUS_AUDIO_MIN_WORDS && duration < SUSPICIOUS_AUDIO_DURATION_S) {
        return {
            status: 'invalid',
            reason: `duration_${duration.toFixed(2)}s_too_short_for_${wordCount}_words`,
            minExpectedMs,
            wordCount,
        };
    }

    // Suspicious: audio dura menos del piso visual esperado en ms (ajustado por speed).
    // Esto permite que la lógica de cliente decida si esperar metadata o invalidar.
    const durationMs = duration * 1000;
    if (durationMs < minExpectedMs * 0.5 && wordCount >= 2) {
        return {
            status: 'suspicious',
            reason: `audio_${durationMs.toFixed(0)}ms_less_than_half_of_expected_${minExpectedMs}ms`,
            minExpectedMs,
            wordCount,
        };
    }

    // Blob suspiciously small (defensive — un MP3 normal está >2KB salvo silencios reales)
    if (blobSize !== undefined && blobSize !== null && blobSize > 0 && blobSize < 1024 && wordCount >= SUSPICIOUS_AUDIO_MIN_WORDS) {
        return {
            status: 'suspicious',
            reason: `blob_${blobSize}_bytes_too_small_for_${wordCount}_words`,
            minExpectedMs,
            wordCount,
        };
    }

    return { status: 'valid', reason: 'within_expected_bounds', minExpectedMs, wordCount };
}

// ───────────────────────────────────────────────────────────────────────────
// countWords — utilidad consistente para los demás helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * Cuenta palabras de una oración usando el mismo splitter que el resto del
 * sistema. Pure function, sin allocs adicionales.
 *
 * @param {string} sentence
 * @returns {number}
 */
export function countWords(sentence) {
    return (sentence ?? '').trim().split(/\s+/).filter(Boolean).length;
}
