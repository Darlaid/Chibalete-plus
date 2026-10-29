/**
 * readingValidator.mjs — CHP-GAMIFICACION-G4-01.
 *
 * Validador de finalización de lectura en MODO OBSERVACIÓN. Emite un veredicto
 * interno (`plausible` | `implausible` | `insufficient_data`) con motivos
 * estructurados, versión de regla y referencias mínimas de evidencia.
 *
 * NO concede nada y NO persiste nada: devuelve el registro al llamador. No
 * importa el ledger, no escribe ningún store, no está enganchado a ninguna
 * ruta. Persistir las observaciones conservaría datos personales nuevos y
 * requiere autorización separada (GAMIFICACION_G4_01_VALIDADOR.md §6).
 *
 * Principios (doctrina P4, D08, D40 y el encargo G4-01):
 *  - una declaración de finalización del cliente NO es evidencia verificada;
 *    es la HIPÓTESIS que se contrasta con la telemetría canónica;
 *  - el veredicto NUNCA depende de duración, tiempo de pantalla ni velocidad:
 *    la misma lectura comprimida en 30 s o repartida en 3 días da el mismo
 *    veredicto (no penaliza ritmo, discapacidad ni herramientas como TTS o
 *    avance automático);
 *  - no se inventan equivalencias entre modalidades: solo cuentan las
 *    observaciones del MISMO modo de visor que la lectura evaluada;
 *  - ante la duda, `insufficient_data`, nunca `implausible`.
 */
import crypto from 'node:crypto';

export const READING_RULE_VERSION = 'rv-reading-observe-v1';

/** Parámetros CONFIGURABLES (versionados). Ninguno es un umbral de tiempo. */
export const READING_RULES_V1 = Object.freeze({
    ruleVersion: READING_RULE_VERSION,
    endFraction: 0.95,          // «final observado»: progreso canónico ≥ 95 %
    farFromEndFraction: 0.5,    // declarar fin con lo observado < 50 % es una contradicción
    startFraction: 0.1,         // una relectura empieza al volver por debajo del 10 %
    minUnitsForJumpCheck: 6,    // obras muy cortas (≤ 5 unidades) no pueden «saltar al final»
    lookbackDays: 90,           // = retención de events.db: más atrás no hay evidencia
    graceAfterClaimMs: 10 * 60_000, // el hook vacía su buffer cada 5 s; margen generoso
});

/**
 * Modos del visor (columna `mode` de events.db) y si emiten observaciones de
 * progreso canónico. Inventario verificado en G4-01; ver el informe.
 */
export const MODE_INSTRUMENTATION = Object.freeze({
    immersive: true,   // heartbeat con progressFraction = oración actual / total
    text: true,        // heartbeat con fracción de scroll + block_complete 25/50/75/100
    pdf: true,         // heartbeat + pdf.progress por página
    album: true,       // heartbeat + album.progress por página
    a11y: false,       // emite progreso por párrafo, pero NO persiste progreso ni declara fin
    epub: false,       // el lector EPUB no emite eventos de lectura
    audio: false,      // sin telemetría ni progreso
    video: false,
});

const READING_EVENTS = new Set(['reading_started', 'session_heartbeat', 'session_ended', 'reading_progress', 'reading_completed']);
const BOGOTA_OFFSET_MS = 5 * 3_600_000;
const dayOf = (ms) => new Date(ms - BOGOTA_OFFSET_MS).toISOString().slice(0, 10);

function result(verdict, reasons, features, refs, rules) {
    return { verdict, reasons, ruleVersion: rules.ruleVersion, features, evidenceRefs: refs };
}

/**
 * Último recorrido de la obra en el modo evaluado: las observaciones posteriores
 * al último reinicio (bajar del inicio después de haber llegado al final).
 * Así una relectura se evalúa por sí misma, sin heredar la lectura anterior.
 */
export function latestTraversal(observations, rules = READING_RULES_V1) {
    let start = 0;
    let reachedEnd = false;
    for (let i = 0; i < observations.length; i++) {
        const f = observations[i].fraction;
        if (reachedEnd && f < rules.startFraction) { start = i; reachedEnd = false; }
        if (f >= rules.endFraction) reachedEnd = true;
    }
    return { segment: observations.slice(start), rereads: observations.slice(0, start).length > 0 };
}

/**
 * Veredicto PURO. Determinista: las mismas entradas dan el mismo registro.
 *
 * @param {object} input
 * @param {{ userId: string, contentId: string, at: number, source: string }} input.claim
 *        la declaración a contrastar (`at` = hora del servidor al observarla)
 * @param {object|null} input.progress  registro de progress.db (o null)
 * @param {object[]|null} input.events  filas de events.db del usuario y la obra (o null si no disponible)
 * @param {object} [rules]
 */
export function evaluateReadingCompletion({ claim, progress, events }, rules = READING_RULES_V1) {
    const baseFeatures = { mode: null, sessions: 0, distinctDays: 0, maxProgressPct: 0, monotonic: null, lengthUnits: null };
    if (!claim || !claim.userId || !claim.contentId || !Number.isFinite(claim.at)) {
        return result('insufficient_data', ['invalid_claim'], baseFeatures, {}, rules);
    }
    const units = Number(progress?.canonicalProgress?.totalSentences) > 0 ? Number(progress.canonicalProgress.totalSentences) : null;
    baseFeatures.lengthUnits = units;
    if (progress?.canonicalProgress?.epub) {
        return result('insufficient_data', ['mode_not_instrumented'], { ...baseFeatures, mode: 'epub' }, {}, rules);
    }
    if (!Array.isArray(events)) return result('insufficient_data', ['events_unavailable'], baseFeatures, {}, rules);

    const until = claim.at + rules.graceAfterClaimMs;
    const since = claim.at - rules.lookbackDays * 86_400_000;
    const rows = events
        .filter((e) => e && e.userId === claim.userId && e.contentId === claim.contentId && READING_EVENTS.has(e.event)
            && Number.isFinite(e.serverTs) && e.serverTs >= since && e.serverTs <= until)
        .sort((a, b) => a.serverTs - b.serverTs || String(a.eventId).localeCompare(String(b.eventId)));
    if (rows.length === 0) return result('insufficient_data', ['no_reading_events'], baseFeatures, {}, rules);

    // Modo evaluado: el de la sesión de lectura más reciente OBSERVADA (no se infiere del cliente).
    const mode = rows[rows.length - 1].mode;
    const features = { ...baseFeatures, mode };
    if (!MODE_INSTRUMENTATION[mode]) return result('insufficient_data', ['mode_not_instrumented'], features, {}, rules);

    const sameMode = rows.filter((e) => e.mode === mode);
    const otherModes = [...new Set(rows.filter((e) => e.mode !== mode).map((e) => e.mode))].sort();
    features.sessions = new Set(sameMode.map((e) => e.sessionId).filter(Boolean)).size;
    features.distinctDays = new Set(sameMode.map((e) => dayOf(e.serverTs))).size;

    const observations = sameMode
        .filter((e) => typeof e.progressFraction === 'number' && Number.isFinite(e.progressFraction))
        .map((e) => ({ fraction: Math.max(0, Math.min(1, e.progressFraction)), eventId: e.eventId, serverTs: e.serverTs }));
    if (observations.length === 0) {
        return result('insufficient_data', [otherModes.length ? 'progress_in_other_mode_only' : 'no_progress_observations'], features, {}, rules);
    }

    const { segment, rereads } = latestTraversal(observations, rules);
    const fr = segment.map((o) => o.fraction);
    const max = Math.max(...fr);
    features.maxProgressPct = Math.round(max * 1000) / 10;
    features.monotonic = fr.every((f, i) => i === 0 || f >= fr[i - 1]);
    const refs = { firstEventId: segment[0].eventId ?? null, lastEventId: segment[segment.length - 1].eventId ?? null,
        observations: segment.length, rereadSegments: rereads ? 1 : 0, otherModes };
    const reasons = rereads ? ['reread_segment'] : [];

    if (max < rules.farFromEndFraction) {
        return result('implausible', [...reasons, 'completion_far_beyond_observed_progress'], features, refs, rules);
    }
    if (max < rules.endFraction) {
        return result('insufficient_data', [...reasons, 'end_not_observed'], features, refs, rules);
    }
    const intermediate = fr.some((f) => f > rules.startFraction && f < rules.endFraction);
    if (!intermediate) {
        if (units !== null && units >= rules.minUnitsForJumpCheck) {
            return result('implausible', [...reasons, 'jump_to_end'], features, refs, rules);
        }
        return result('insufficient_data', [...reasons, 'no_intermediate_progress'], features, refs, rules);
    }
    return result('plausible', [...reasons, 'end_observed', 'intermediate_progress_observed'], features, refs, rules);
}

/** Identificador determinista de una observación: misma lectura ⇒ mismo id, aunque se reintente. */
export function observationKey(claim, record) {
    const anchor = record.evidenceRefs?.firstEventId ?? 'no-evidence';
    return crypto.createHash('sha256').update(`${claim.userId}\u0000${claim.contentId}\u0000${anchor}\u0000${record.ruleVersion}`).digest('hex').slice(0, 32);
}

/**
 * Recolecta la evidencia en SOLO LECTURA con lectores inyectados
 * (p. ej. `eventsService.getEventsSince` y `progressService.getProgressItem`)
 * y devuelve el registro de observación. Nunca lanza: un fallo es
 * `insufficient_data` con su motivo. No escribe nada.
 */
export function observeReadingCompletion(claim, { getEventsSince, getProgressItem }, rules = READING_RULES_V1) {
    let progress = null;
    let events = null;
    const reasonsExtra = [];
    try { progress = getProgressItem(claim.userId, claim.contentId) ?? null; } catch { reasonsExtra.push('progress_unavailable'); }
    try {
        events = getEventsSince({ sinceTs: claim.at - rules.lookbackDays * 86_400_000, untilTs: claim.at + rules.graceAfterClaimMs,
            userIds: [claim.userId], contentIds: [claim.contentId] });
    } catch { events = null; }
    let record;
    try {
        record = evaluateReadingCompletion({ claim, progress, events }, rules);
    } catch {
        record = result('insufficient_data', ['validator_error'], {}, {}, rules);
    }
    if (reasonsExtra.length) record = { ...record, reasons: [...record.reasons, ...reasonsExtra] };
    return { observationKey: observationKey(claim, record), claim: { contentId: claim.contentId, at: claim.at, source: claim.source }, ...record };
}
