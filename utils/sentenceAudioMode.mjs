/**
 * sentenceAudioMode.mjs — Contrato general de sincronización del lector.
 *
 * El lector inmersivo soporta múltiples modelos de audio. Este módulo define
 * el contrato explícito que el runtime usa para decidir CÓMO avanzar visualmente
 * dado un audio. Sin esto, el lector hace asunciones silenciosas (1 audio = 1
 * frase) que rompen contenidos donde varias frases comparten un solo chunk.
 *
 * NO optimiza para un libro específico. Define la pregunta general:
 *   "¿qué relación tiene este audio con las frases visibles?"
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * MODOS
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   perSentence            1 audio file = 1 frase visible.
 *                          Avance: audio.onEnded → siguiente frase.
 *                          Detección: sentenceToChunk vacío O cada
 *                          sentenceToChunk[i] === i.
 *
 *   perChunkWithAnchors    1 audio file cubre N frases, hay anchors.json
 *                          con timestamps por frase dentro del chunk.
 *                          Avance: schedule visual al timestamp de cada
 *                          anchor durante audio.timeUpdate / setTimeout.
 *                          Detección: múltiples sentenceIndex → mismo
 *                          chunkKey, anchorsRef tiene entradas para esos
 *                          chunkKey con sentenceTimestamps.
 *
 *   perChunkNoAnchors      1 audio file cubre N frases, NO hay anchors.
 *                          Avance: estrategia decidida por el runtime
 *                          (timed proportional o tratar chunk como unidad).
 *                          Detección: múltiples sentenceIndex → mismo
 *                          chunkKey, sin anchors útiles.
 *                          ⚠ MODO DEGRADADO — debe loguearse explícitamente
 *                          como diagnóstico, no como bug silencioso.
 *
 *   ttsDynamic             No hay manifest. Audio se genera por frase via
 *                          /api/tts on-demand.
 *                          Avance: audio.onEnded → siguiente frase.
 *                          Detección: manifest null/empty + audioSentences
 *                          poblado.
 *
 *   unknown                No se pudo determinar — ni manifest ni sentences.
 *                          El runtime degrada a perSentence + emite warning.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * USO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *   import { detectSentenceAudioMode } from '../utils/sentenceAudioMode.mjs';
 *
 *   const meta = detectSentenceAudioMode({
 *     manifest:        manifestRef.current,
 *     anchorsMap:      anchorsMapRef.current,  // chunkIdx → ContextualAnchor[]
 *     sentenceToChunk: sentenceToChunkRef.current,
 *     audioSentencesLen: audioSentencesRef.current.length,
 *     contentId:       content.id,
 *   });
 *
 *   immersiveLog('CONTENT_LOADED', {
 *     kind: 'PB_AUDIO_MODE_DETECTED',
 *     contentId, mode: meta.mode, diagnostics: meta.diagnostics,
 *   });
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * @typedef {'perSentence'|'perChunkWithAnchors'|'perChunkNoAnchors'|'ttsDynamic'|'unknown'} SentenceAudioMode
 *
 * @typedef {object} AudioModeDiagnostics
 * @property {boolean} hasManifest
 * @property {number}  manifestEntries          Cantidad de chunks en el manifest.
 * @property {boolean} hasAnchorsMap            Si anchorsMap tiene al menos una entrada.
 * @property {number}  anchorsMapEntries        Cantidad de chunks con anchors.
 * @property {number}  audioSentencesLen
 * @property {number}  sentenceToChunkLen
 * @property {boolean} sentenceToChunkIsIdentity  True si cada sentenceToChunk[i]===i.
 * @property {{ min: number, max: number, avg: number, distinctChunks: number }|null} chunkSpread
 *           Estadísticas de cuántas frases por chunk (null si perSentence).
 *
 * @typedef {object} AudioModeMeta
 * @property {SentenceAudioMode} mode
 * @property {string} contentId
 * @property {number} detectedAt
 * @property {AudioModeDiagnostics} diagnostics
 * @property {string} strategy                    Texto explicando la estrategia.
 * @property {string|null} degradedReason         Por qué el modo es degradado (perChunkNoAnchors / unknown).
 */

/**
 * Detecta el modo de audio del contenido. PURO — no muta refs, no emite logs.
 * El caller decide qué hacer con el resultado (loguear, switchear estrategia).
 *
 * @param {object} args
 * @param {Record<string, any>|null|undefined} args.manifest  manifestRef.current
 * @param {Record<number, any[]>|null|undefined} args.anchorsMap  parseAnchors output
 * @param {number[]|null|undefined} args.sentenceToChunk
 * @param {number} args.audioSentencesLen
 * @param {string} args.contentId
 * @returns {AudioModeMeta}
 */
export function detectSentenceAudioMode({
    manifest,
    anchorsMap,
    sentenceToChunk,
    audioSentencesLen,
    contentId,
}) {
    const now = (typeof Date !== 'undefined' && typeof Date.now === 'function')
        ? Date.now()
        : 0;

    // Normalizar inputs.
    const manifestKeys = manifest && typeof manifest === 'object'
        ? Object.keys(manifest).filter(k => k !== '_meta')
        : [];
    const hasManifest        = manifestKeys.length > 0;
    const manifestEntries    = manifestKeys.length;

    const anchorChunkKeys    = anchorsMap && typeof anchorsMap === 'object'
        ? Object.keys(anchorsMap)
        : [];
    const hasAnchorsMap      = anchorChunkKeys.length > 0;
    const anchorsMapEntries  = anchorChunkKeys.length;

    const s2c = Array.isArray(sentenceToChunk) ? sentenceToChunk : [];
    const sentenceToChunkLen = s2c.length;
    const sentenceToChunkIsIdentity = s2c.length === 0
        || s2c.every((chunkKey, idx) => chunkKey === idx);

    // Calcular chunk spread (cuántas frases por chunk).
    /** @type {{min:number,max:number,avg:number,distinctChunks:number}|null} */
    let chunkSpread = null;
    if (s2c.length > 0 && !sentenceToChunkIsIdentity) {
        /** @type {Map<number, number>} */
        const chunkSentenceCounts = new Map();
        for (const chunkKey of s2c) {
            chunkSentenceCounts.set(chunkKey, (chunkSentenceCounts.get(chunkKey) ?? 0) + 1);
        }
        const counts = Array.from(chunkSentenceCounts.values());
        chunkSpread = {
            min:            Math.min(...counts),
            max:            Math.max(...counts),
            avg:            counts.reduce((a, b) => a + b, 0) / counts.length,
            distinctChunks: chunkSentenceCounts.size,
        };
    }

    /** @type {AudioModeDiagnostics} */
    const diagnostics = {
        hasManifest,
        manifestEntries,
        hasAnchorsMap,
        anchorsMapEntries,
        audioSentencesLen,
        sentenceToChunkLen,
        sentenceToChunkIsIdentity,
        chunkSpread,
    };

    // ── DECISIÓN ──────────────────────────────────────────────────────────

    // Caso 1: sin manifest, hay sentences → ttsDynamic.
    if (!hasManifest) {
        if (audioSentencesLen > 0) {
            return {
                mode: 'ttsDynamic',
                contentId,
                detectedAt: now,
                diagnostics,
                strategy: 'TTS por frase via /api/tts. Avance: audio.onEnded → siguiente índice.',
                degradedReason: null,
            };
        }
        return {
            mode: 'unknown',
            contentId,
            detectedAt: now,
            diagnostics,
            strategy: 'Fallback perSentence. Comportamiento no garantizado.',
            degradedReason: 'no_manifest_and_no_sentences',
        };
    }

    // Caso 2: manifest con identity mapping (1 chunk = 1 frase).
    if (sentenceToChunkIsIdentity) {
        return {
            mode: 'perSentence',
            contentId,
            detectedAt: now,
            diagnostics,
            strategy: '1 audio file por frase. Avance: audio.onEnded → siguiente índice.',
            degradedReason: null,
        };
    }

    // Caso 3: chunks con múltiples frases — ¿hay anchors?
    // Anchors útiles requieren al menos un anchor en al menos un chunk
    // donde sentenceToChunk indique más de 1 frase por ese chunk.
    const hasUsefulAnchors = hasAnchorsMap && (() => {
        if (!chunkSpread || chunkSpread.max <= 1) return false;
        // Requerimos que al menos un chunk multifrase tenga anchors.
        for (const [chunkKeyStr, anchors] of Object.entries(anchorsMap)) {
            if (!Array.isArray(anchors) || anchors.length === 0) continue;
            const chunkKey = parseInt(chunkKeyStr, 10);
            if (Number.isNaN(chunkKey)) continue;
            const sentencesInChunk = s2c.filter(k => k === chunkKey).length;
            if (sentencesInChunk > 1) return true;
        }
        return false;
    })();

    if (hasUsefulAnchors) {
        return {
            mode: 'perChunkWithAnchors',
            contentId,
            detectedAt: now,
            diagnostics,
            strategy: 'Audio chunk + anchors. Avance: schedule visual a timestamps de anchors durante playback.',
            degradedReason: null,
        };
    }

    // perChunkNoAnchors — modo degradado, debe loguearse.
    return {
        mode: 'perChunkNoAnchors',
        contentId,
        detectedAt: now,
        diagnostics,
        strategy: 'Audio chunk sin anchors. El lector NO sabe cuándo avanzar visualmente dentro del chunk. Necesita estrategia explícita (timed proportional o chunk-as-unit).',
        degradedReason: 'multiple_sentences_per_chunk_without_anchor_timestamps',
    };
}

/**
 * Helper para uso en logs estructurados. Devuelve un payload plano listo para
 * inyectar en immersiveLog / pbLog.
 *
 * @param {AudioModeMeta} meta
 * @returns {object}
 */
export function audioModeToLogPayload(meta) {
    return {
        kind:            'PB_AUDIO_MODE_DETECTED',
        contentId:       meta.contentId,
        mode:            meta.mode,
        strategy:        meta.strategy,
        degradedReason:  meta.degradedReason,
        diagnostics:     meta.diagnostics,
        detectedAt:      meta.detectedAt,
    };
}
