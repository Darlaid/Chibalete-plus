/**
 * Resolve the classic immersive reader start index from saved progress.
 *
 * Priority mirrors the production reader:
 * 1. sentence anchor
 * 2. sentenceIndex when the last interacted mode was immersive
 * 3. global percentage fallback
 * 4. explicit fallback to 0
 */
export function resolveImmersiveResumePosition({ progress, totalSentences } = {}) {
    const total = Number.isFinite(totalSentences) ? Math.max(0, Math.floor(totalSentences)) : 0;
    const maxIndex = total > 0 ? total - 1 : 0;
    const cp = progress?.canonicalProgress;
    let sawInvalid = false;

    const fallback = (invalid = false) => Object.freeze({
        startIndex: 0,
        source: invalid ? 'fallback_invalid' : 'none',
        clamped: false,
    });

    const clamp = (raw, source) => {
        if (!Number.isFinite(raw)) return fallback(true);
        const floored = Math.floor(raw);
        if (floored < 0) {
            return Object.freeze({ startIndex: 0, source: 'fallback_invalid', clamped: true });
        }
        if (floored > maxIndex) {
            return Object.freeze({ startIndex: maxIndex, source, clamped: true });
        }
        return Object.freeze({ startIndex: floored, source, clamped: false });
    };

    if (!progress || typeof progress !== 'object') {
        return fallback(false);
    }

    const anchor = cp?.anchor;
    if (anchor?.type === 'sentence') {
        if (Number.isFinite(anchor.value) && anchor.value > 0) {
            return clamp(anchor.value, 'anchor');
        }
        sawInvalid = anchor.value !== 0;
    }

    const exactSentence = cp?.sentenceIndex;
    const lastMode = cp?.lastInteractedMode ?? progress.last_device_mode;
    if (lastMode === 'immersive') {
        if (Number.isFinite(exactSentence) && exactSentence > 0) {
            return clamp(exactSentence, 'sentence');
        }
        sawInvalid = sawInvalid || (exactSentence !== undefined && exactSentence !== 0);
    }

    const pct = progress.porcentaje ?? cp?.globalPercentage;
    if (pct !== undefined && pct !== null) {
        if (Number.isFinite(pct) && pct > 0 && total > 0) {
            return clamp((pct / 100) * total, 'percentage');
        }
        sawInvalid = sawInvalid || (!Number.isFinite(pct) || pct < 0);
    }

    return fallback(sawInvalid);
}
