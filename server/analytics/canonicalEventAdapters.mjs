/**
 * canonicalEventAdapters.mjs — CHP-STATS-EVENT-CONTRACT-01 (DORMANT).
 *
 * Adaptadores puros de los vocabularios existentes hacia el sobre canónico +
 * clasificación de compatibilidad de migración. NUNCA fabrican eventId/actor/
 * tiempo/contenido ausentes: si faltan, devuelven INSUFFICIENT_PROVENANCE /
 * INVALID_FOR_CANONICAL_REPLAY. Preservan el significado factual original.
 */
import { isValidUlid } from '../ulid.js';
import { EVENT_NAMES } from './eventRegistry.js';

// ── Aliases DELIBERADOS legacy/backbone-v1 → canónico ───────────────────────
// Sólo mapeos 1:1 inequívocos. Donde no hay equivalente canónico, se devuelve
// null (→ gap de instrumentación, NUNCA se inventa un tipo).
export const CANONICAL_ALIASES = Object.freeze({
    // sesión (sufijo, cualquier modo)
    'session_start':      'session_started',
    'session_end':        'session_ended',
    'session_heartbeat':  'session_heartbeat',
    'session_completed':  'reading_completed',
    // lectura / progreso
    'progress':           'reading_progress',
    'page_change':        'pdf_page_changed',
    'page_view':          null,                 // telemetría de producto (LU), no hecho pedagógico
    // media
    'audio_play':         'audio_started',
    'audio_pause':        'audio_paused',
    // álbum
    'album_page_changed': 'album_page_changed',
    // sin equivalente canónico deliberado (gap de instrumentación):
    'block_complete':     null,
    'streak_break':       null,
    'level_up':           null,
    'transition_to_next_content': null,
});

/** Resultado de clasificación de migración (§AM de -00). */
export const MIGRATION_CLASS = Object.freeze({
    DIRECTLY_COMPATIBLE:          'DIRECTLY_COMPATIBLE',
    NORMALIZABLE:                 'NORMALIZABLE',
    INSUFFICIENT_PROVENANCE:      'INSUFFICIENT_PROVENANCE',
    INVALID_FOR_CANONICAL_REPLAY: 'INVALID_FOR_CANONICAL_REPLAY',
});

export const ADAPT_ERROR = Object.freeze({
    NO_CANONICAL_MAPPING:    'NO_CANONICAL_MAPPING',
    INSUFFICIENT_PROVENANCE: 'INSUFFICIENT_PROVENANCE',
    INVALID_SHAPE:           'INVALID_SHAPE',
});

/**
 * Resuelve el nombre canónico a partir de un nombre crudo `<mode>.<suffix>` o
 * legacy plano. Devuelve el canónico o null (sin equivalente → gap).
 */
export function legacyNameToCanonical(rawName) {
    if (typeof rawName !== 'string' || !rawName) return null;
    const dot = rawName.indexOf('.');
    const suffix = dot > 0 ? rawName.slice(dot + 1) : rawName;
    // nombre ya canónico
    if (EVENT_NAMES.includes(rawName)) return rawName;
    if (Object.prototype.hasOwnProperty.call(CANONICAL_ALIASES, suffix)) {
        return CANONICAL_ALIASES[suffix];   // puede ser null (gap deliberado)
    }
    return null;
}

/**
 * Adapta un evento Backbone v1 (shape del hook) a la forma de SOBRE CRUDO lista
 * para `normalizeCanonicalEvent`. NO aplica verifiedContext (eso es de ingestión).
 * NO fabrica campos ausentes.
 *
 * @returns {{ok:true, raw}|{ok:false, code}}
 */
export function adaptBackboneV1ToRaw(v1) {
    if (!v1 || typeof v1 !== 'object') return { ok: false, code: ADAPT_ERROR.INVALID_SHAPE };
    if (!isValidUlid(v1.eventId)) return { ok: false, code: ADAPT_ERROR.INSUFFICIENT_PROVENANCE };
    const eventType = legacyNameToCanonical(v1.event);
    if (!eventType) return { ok: false, code: ADAPT_ERROR.NO_CANONICAL_MAPPING };
    if (!Number.isFinite(v1.clientTs)) return { ok: false, code: ADAPT_ERROR.INSUFFICIENT_PROVENANCE };
    if (typeof v1.mode !== 'string') return { ok: false, code: ADAPT_ERROR.INVALID_SHAPE };

    // Mapea SÓLO campos factuales. actorId crudo (v1.userId) se pasa como CLAIMED:
    // el normalizer lo confrontará con verifiedContext (no es autoridad aquí).
    const raw = {
        eventId:              v1.eventId,
        schemaVersion:        1,
        eventType,
        mode:                 v1.mode,
        actorId:              v1.userId != null ? String(v1.userId) : undefined, // claimed
        occurredAt:           v1.clientTs,
        contentId:            v1.contentId ?? undefined,
        interactionSessionId: v1.sessionId ?? undefined,
    };
    // progressFraction/elapsedMs son señales factuales → al payload gobernado por tipo.
    const payload = {};
    if (v1.payload && typeof v1.payload === 'object') Object.assign(payload, v1.payload);
    if (v1.elapsedMs != null) payload.elapsedMs = v1.elapsedMs;
    // NO se copian derivados de estado como autoridad (progressPercentage/streak/level);
    // si vienen en payload, el registry `.strip()`/strict del canónico los rechaza.
    if (Object.keys(payload).length > 0) raw.payload = payload;
    return { ok: true, raw };
}

/**
 * Clasifica un registro histórico (fila events.db, evento legacy analytics_db,
 * línea playback_events.log) para replay canónico. NO backfillea, NO fabrica ids.
 *
 * @param {object} row  con al menos { source, eventId?, event?, userId?, clientTs?, serverTs?, provenanceVerified? }
 */
export function classifyMigration(row) {
    if (!row || typeof row !== 'object') return MIGRATION_CLASS.INVALID_FOR_CANONICAL_REPLAY;

    // Sin eventId estable → no hay identidad de idempotencia → inválido para replay.
    if (!isValidUlid(row.eventId)) return MIGRATION_CLASS.INVALID_FOR_CANONICAL_REPLAY;

    const canonical = legacyNameToCanonical(row.event);
    if (!canonical) return MIGRATION_CLASS.INVALID_FOR_CANONICAL_REPLAY; // sin tipo canónico

    const hasActor = typeof row.userId === 'string' && row.userId.length > 0;
    const hasTime  = Number.isFinite(row.clientTs) || Number.isFinite(row.serverTs);
    if (!hasActor || !hasTime) return MIGRATION_CLASS.INSUFFICIENT_PROVENANCE;

    // Nativo v1 con provenance verificable (server_ts + schema) → directo.
    if (row.source === 'events.db.native' && row.provenanceVerified === true) {
        return MIGRATION_CLASS.DIRECTLY_COMPATIBLE;
    }
    // Legacy con actor/tiempo suficientes pero provenance no sellada → normalizable
    // (provenance='legacy'/'migration', NUNCA re-atribuido a M1-A retroactivamente).
    return MIGRATION_CLASS.NORMALIZABLE;
}
