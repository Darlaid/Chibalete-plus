/**
 * progressAdapter.mjs — Sprint Inmersivo V2 / Fase M-3.1.
 *
 * Traduce entre el shape interno del runtime V2 (sessionId, contentId,
 * userId, index) y la API legacy de `dataService` (updateProgreso /
 * getProgresoUsuarioLibro), que persiste con el shape `canonicalProgress`
 * + `anchor`.
 *
 * Dos funciones públicas:
 *   - restoreProgress(args) → { startIndex, source, clamped }
 *   - commitProgress(args)  → Promise<{ ok, error? }>
 *
 * RESTORE: prioriza
 *   1. canonicalProgress.anchor.type === 'sentence' && Number.isFinite(value)
 *   2. canonicalProgress.lastInteractedMode === 'immersive'
 *      && Number.isFinite(sentenceIndex) && sentenceIndex > 0
 *   3. default → startIndex = 0, source = 'default'
 *
 * Clamp explícito: si `totalIndices` se conoce y > 0, el startIndex se
 * limita a [0, totalIndices-1]. Esto evita índices fuera de rango cuando
 * el contenido cambió de longitud entre sesiones.
 *
 * COMMIT: traduce a updateProgreso con anchor type='sentence', value=index.
 * Preserva semántica V1: page = index + 1, totalPages = totalIndices.
 *
 * NUNCA throw — todos los errores se devuelven en shape formal.
 */

/**
 * restoreProgress — síncrono (consulta cache local del dataService).
 */
export async function restoreProgress({ userId, contentId, totalIndices, dataService } = {}) {
    if (!isNonEmptyString(userId) || !isNonEmptyString(contentId)) {
        return defaultRestore();
    }
    if (!dataService || typeof dataService.getProgresoUsuarioLibro !== 'function') {
        return defaultRestore();
    }

    let prog;
    try {
        prog = dataService.getProgresoUsuarioLibro(userId, contentId);
    } catch {
        // Fail-soft: no hay manera de recuperar progreso → arrancar de 0.
        return defaultRestore();
    }

    const cp = prog?.canonicalProgress;
    if (!cp || typeof cp !== 'object') {
        return defaultRestore();
    }

    // 1) anchor sentence wins.
    if (cp.anchor && cp.anchor.type === 'sentence' && Number.isFinite(cp.anchor.value)) {
        return clamp({
            raw: Math.floor(cp.anchor.value),
            totalIndices,
            source: 'anchor',
        });
    }

    // 2) sentenceIndex SOLO si último modo era immersive (evita restaurar
    //    posiciones de PDF o texto plano que tienen otra granularidad).
    if (cp.lastInteractedMode === 'immersive'
        && Number.isFinite(cp.sentenceIndex)
        && cp.sentenceIndex > 0) {
        return clamp({
            raw: Math.floor(cp.sentenceIndex),
            totalIndices,
            source: 'sentence_index',
        });
    }

    return defaultRestore();
}

/**
 * commitProgress — best-effort. dataService.updateProgreso es síncrono
 * pero internamente puede agendar una sync remota; aquí nos quedamos con
 * el resultado síncrono para no acoplar al adapter al ciclo de red.
 */
export async function commitProgress({
    sessionId,        // capturado por contrato; útil para audit upstream
    userId,
    contentId,
    index,
    totalIndices,
    sessionDurationMs,
    dataService,
} = {}) {
    if (!isNonEmptyString(userId) || !isNonEmptyString(contentId)) {
        return invalidArgs('missing_ids');
    }
    if (!Number.isInteger(index) || index < 0) {
        return invalidArgs('invalid_index');
    }
    if (!dataService || typeof dataService.updateProgreso !== 'function') {
        return invalidArgs('no_dataService');
    }

    // V1 usa "page" = posición 1-based; totalPages = totalIndices o page si
    // total no se conoce. Mantenemos esa semántica para no romper el cálculo
    // de porcentaje en el backend.
    const total = (Number.isFinite(totalIndices) && totalIndices > 0)
        ? totalIndices
        : (index + 1);
    const page = index + 1;

    const metricsPatch = (Number.isFinite(sessionDurationMs) && sessionDurationMs > 0)
        ? { elapsedMs: sessionDurationMs }
        : undefined;

    try {
        // Firma de V1: (userId, contentId, page, totalPages, canonicalIndex,
        //               deviceMode, metricsPatch?, anchor?, viewportHint?)
        dataService.updateProgreso(
            userId,
            contentId,
            page,
            total,
            index,            // canonicalIndex
            'immersive',
            metricsPatch,
            { type: 'sentence', value: index },
            // viewportHint: no usado por V2 (immersive ya tiene unidad exacta).
        );
        return { ok: true };
    } catch (e) {
        return {
            ok: false,
            error: Object.freeze({
                kind: 'commit_throw',
                op: 'commitProgress',
                meta: { error: e?.message ?? String(e), sessionId },
            }),
        };
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function defaultRestore() {
    return Object.freeze({ startIndex: 0, source: 'default', clamped: false });
}

function clamp({ raw, totalIndices, source }) {
    if (raw < 0) {
        return Object.freeze({ startIndex: 0, source, clamped: true });
    }
    if (Number.isFinite(totalIndices) && totalIndices > 0) {
        if (raw >= totalIndices) {
            return Object.freeze({ startIndex: totalIndices - 1, source, clamped: true });
        }
    }
    return Object.freeze({ startIndex: raw, source, clamped: false });
}

function invalidArgs(reason) {
    return {
        ok: false,
        error: Object.freeze({
            kind: 'invariant_violated',
            op: 'commitProgress',
            meta: { reason },
        }),
    };
}

function isNonEmptyString(v) {
    return typeof v === 'string' && v.length > 0;
}
