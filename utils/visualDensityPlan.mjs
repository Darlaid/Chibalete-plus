/**
 * visualDensityPlan.mjs — M-5.4.10 / TASK 1 + TASK 4.
 *
 * Decisión PURA de estabilización perceptual del lector. El visor IMPORTA y
 * USA estas funciones (los tests ejercen el código real, no una simulación).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * INVARIANTE DURO (NO negociable)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Estas funciones son VISUAL-ONLY y PURAS:
 *   - NO mutan currentSentence / playback index.
 *   - NO tocan audio ownership ni el sync executor.
 *   - NO disparan hard_resync / recovery / reconciliadores.
 *   - NO hacen I/O ni acceden al DOM.
 *
 * Solo deciden CÓMO se ve el texto (cuánto contexto mostrar, qué tan
 * compacto, cuánto dura la transición de scroll).
 */

// ── Ventanas de densidad (caracteres "perceptuales" en pantalla) ────────────
// Calibrado para lectura infantil: una frase de ~40-90 chars es la "unidad"
// cómoda. <28 se siente vacío; >220 se siente abrumador / arriesga overflow.
export const DENSITY_DEFAULTS = Object.freeze({
    targetCharsWindow:   90,    // objetivo perceptual por pantalla
    minCharsPerScreen:   28,    // debajo de esto → expandir con contexto
    maxCharsPerScreen:   220,   // arriba de esto → compactar
    maxContextLookahead: 2,     // máximo de frases-contexto que se muestran
});

/**
 * @typedef {object} DensityPlan
 * @property {'normal'|'expanded'|'compacted'} mode
 * @property {number} contextLookahead   Frases siguientes a mostrar como
 *                                       contexto legible (0 = solo activa).
 * @property {number} activeChars        Longitud de la frase activa.
 * @property {number} windowChars        Caracteres totales del bloque visual.
 * @property {string} reason
 */

/**
 * Calcula el plan de densidad VISUAL para la frase activa.
 *
 * - Si la activa es muy corta (< minCharsPerScreen) → 'expanded': se muestran
 *   hasta `maxContextLookahead` frases SIGUIENTES como contexto legible
 *   (atenuado, NO destacado) hasta acercarse a `targetCharsWindow`. El
 *   playback NO se adelanta — la frase activa sigue siendo `currentIndex`.
 * - Si la activa es muy larga (> maxCharsPerScreen) → 'compacted': señal para
 *   que el pipeline de fit aplique compact/scroll-safe (nunca overlap).
 * - Resto → 'normal'.
 *
 * @param {object} p
 * @param {string[]} p.sentences
 * @param {number}   p.currentIndex
 * @param {object}   [p.thresholds]
 * @returns {DensityPlan}
 */
export function computeVisualDensityPlan(p) {
    const sentences = (p && Array.isArray(p.sentences)) ? p.sentences : [];
    const idx = (p && Number.isInteger(p.currentIndex)) ? p.currentIndex : 0;
    const T = { ...DENSITY_DEFAULTS, ...(p && p.thresholds) };

    const active = sentences[idx] ?? '';
    const activeChars = active.length;

    if (sentences.length === 0 || idx < 0 || idx >= sentences.length) {
        return {
            mode: 'normal', contextLookahead: 0,
            activeChars, windowChars: activeChars,
            reason: 'no_sentences_or_oob',
        };
    }

    // ── Muy larga → compactar (el fit pipeline garantiza no-overlap) ────────
    if (activeChars > T.maxCharsPerScreen) {
        return {
            mode: 'compacted', contextLookahead: 0,
            activeChars, windowChars: activeChars,
            reason: 'active_exceeds_max',
        };
    }

    // ── Muy corta → expandir con contexto VISUAL (no adelanta playback) ─────
    if (activeChars < T.minCharsPerScreen) {
        let look = 0;
        let windowChars = activeChars;
        while (
            look < T.maxContextLookahead &&
            (idx + look + 1) < sentences.length &&
            windowChars < T.targetCharsWindow
        ) {
            const nextLen = (sentences[idx + look + 1] ?? '').length;
            // No agregar una frase-contexto que ella sola ya desborde.
            if (windowChars + nextLen > T.maxCharsPerScreen) break;
            windowChars += nextLen;
            look += 1;
        }
        return {
            mode: look > 0 ? 'expanded' : 'normal',
            contextLookahead: look,
            activeChars, windowChars,
            reason: look > 0 ? 'active_below_min_expanded' : 'active_below_min_no_context_available',
        };
    }

    return {
        mode: 'normal', contextLookahead: 0,
        activeChars, windowChars: activeChars,
        reason: 'within_target_window',
    };
}

// ── TASK 4 — INTRA_CHUNK_VISUAL_PACING ──────────────────────────────────────
// Suaviza el timing del reveal (la animación translateY del teleprompter).
// Saltos grandes (frase gigante, salto de índice) NO deben ser instantáneos
// ni violentos; pasos pequeños no deben sentirse nerviosos. Pura: devuelve
// una duración (ms) acotada — el visor la aplica como transitionDuration CSS.

export const PACING_DEFAULTS = Object.freeze({
    baseMs:        500,   // duración base del scroll (igual al actual)
    minMs:         220,   // piso perceptual (no más rápido que esto)
    maxMs:         900,   // techo (no más lento que esto)
    perIndexDelta:  60,   // ms extra por cada índice saltado (>1)
    extremeChars:  220,   // frase "extrema" → segmentación visual marcada
    // M-5.4.14 / TASK 5 — homogeneización perceptual del ritmo. Frases con
    // más líneas / mayor complejidad necesitan un poco más de tiempo para que
    // el ojo se asiente (no "aparecen demasiado rápido"). NUNCA afecta el
    // timing de audio: solo la duración de la transición visual.
    perLineMs:      35,   // ms extra por línea visual adicional (>1)
    complexityMs:   90,   // ms extra máx por complejidad (0..1)
    maxNudgeMs:    220,   // techo del ajuste perceptual (acotado)
});

/**
 * @param {object} p
 * @param {number} p.fromIndex
 * @param {number} p.toIndex
 * @param {number} p.activeChars      longitud de la frase destino
 * @param {number} [p.lineCount]      líneas visuales de la frase (>=1)
 * @param {number} [p.complexity]     0..1 (densidad de puntuación/cláusulas)
 * @param {number} [p.playbackSpeed]
 * @param {object} [p.thresholds]
 * @returns {{ durationMs:number, indexDelta:number, segmented:boolean,
 *            lineCount:number, complexity:number, perceptualNudgeMs:number,
 *            reason:string }}
 */
export function computeVisualPacing(p) {
    const T = { ...PACING_DEFAULTS, ...(p && p.thresholds) };
    const from  = Number.isFinite(p && p.fromIndex) ? p.fromIndex : 0;
    const to    = Number.isFinite(p && p.toIndex)   ? p.toIndex   : 0;
    const chars = Number.isFinite(p && p.activeChars) ? p.activeChars : 0;
    const speed = (p && Number.isFinite(p.playbackSpeed) && p.playbackSpeed > 0)
        ? p.playbackSpeed : 1;

    const lineCount  = (p && Number.isFinite(p.lineCount) && p.lineCount > 0)
        ? Math.floor(p.lineCount) : 1;
    const complexity = (p && Number.isFinite(p.complexity))
        ? Math.max(0, Math.min(1, p.complexity)) : 0;

    const indexDelta = Math.abs(to - from);
    // Saltos de más de 1 índice (skip) → un poco más de duración para que el
    // movimiento no sea un latigazo. Paso normal (delta 1) = base.
    let ms = T.baseMs + Math.max(0, indexDelta - 1) * T.perIndexDelta;
    // M-5.4.14 / TASK 5 — homogeneización: frases con más líneas / más
    // complejas reciben un nudge perceptual acotado (no "aparecen demasiado
    // rápido"). lineCount=1 & complexity=0 → nudge=0 → comportamiento previo
    // EXACTO (back-compat: tests existentes intactos).
    const perceptualNudgeMs = Math.min(
        T.maxNudgeMs,
        Math.max(0, (lineCount - 1) * T.perLineMs) + complexity * T.complexityMs,
    );
    ms += perceptualNudgeMs;
    // A mayor velocidad de audio, scroll proporcionalmente más corto (sin
    // bajar del piso) para no quedar rezagado respecto al audio.
    if (speed > 1) ms = Math.max(T.minMs, Math.round(ms / speed));
    ms = Math.min(T.maxMs, Math.max(T.minMs, Math.round(ms)));

    const segmented = chars > T.extremeChars;
    return {
        durationMs: ms,
        indexDelta,
        segmented,
        lineCount,
        complexity,
        perceptualNudgeMs: Math.round(perceptualNudgeMs * 100) / 100,
        reason: segmented ? 'extreme_sentence_visually_contained'
              : (lineCount > 1 || complexity > 0) ? 'perceptual_homogenized'
              : indexDelta > 1 ? 'multi_index_smoothed'
              : 'normal_step',
    };
}
