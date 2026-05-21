/**
 * eventRegistry.js — Aula Viva PASO 1: memoria pedagógica canónica.
 *
 * Registry ÚNICO de eventos pedagógicos. UN solo lugar define qué eventos
 * existen, qué versión, qué payload zod, qué peso pedagógico, qué hint de
 * materialización, qué privacy level y qué clase de retención.
 *
 * Decisiones (anti-overengineering):
 *   - Sin CQRS dogmático/Kafka/PG. Cada entrada = { category, version,
 *     schema (zod), meta { pedagogical_weight, materialization_hint,
 *     privacy_level, retention_class }, deprecated?, migrate? }.
 *   - NUNCA lanza: validateEvent() → { ok, ... } (caller decide política).
 *   - Recovery-first: el shadow recordCanonicalEvent inserta inválidos con
 *     marker (no se pierde memoria pedagógica).
 *   - `.strip()` en todos los schemas → anti param-pollution.
 *
 * privacy_level     : 'public' | 'institutional' | 'pedagogical' | 'sensitive'
 * retention_class   : 'hot_90d' | 'warm_1y' | 'cold_archive' | 'transient_30d'
 * materialization_hint: 'snapshot_user' | 'snapshot_group' | 'snapshot_school'
 *                       | 'counter_runtime' | 'log_only'
 * pedagogical_weight: 0 (operacional) | 1 (técnico) | 2 (pedagógico bajo)
 *                       | 3 (pedagógico clave)
 */
import { z } from 'zod';

const READING_MODE = z.enum(['immersive', 'guided', 'pdf', 'album', 'accessible', 'audio']);
const RUNTIME      = z.enum(['v1', 'v2']);
const SCOPE_LEVEL  = z.enum(['user', 'group', 'school', 'org']);
const ROLE         = z.enum(['student', 'teacher']);
const SEVERITY     = z.enum(['info', 'warn', 'critical']);
const ts           = z.union([z.number().int().nonnegative(), z.string().min(10).max(40)]);

// ── REGISTRY: declaración compacta (schemas zod) ────────────────────────────
const SCHEMAS = {
    // READING (8)
    reading_started:           z.object({ contentId: z.string().min(1), mode: READING_MODE, sessionId: z.string().min(1), startedAt: ts }).strip(),
    reading_progress:          z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), sentenceIndex: z.number().int().nonnegative().optional(), percentage: z.number().min(0).max(100).optional(), elapsedMs: z.number().int().nonnegative().optional() }).strip(),
    reading_completed:         z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), totalTimeMs: z.number().int().nonnegative().optional() }).strip(),
    reading_paused:            z.object({ contentId: z.string().min(1), sessionId: z.string().min(1) }).strip(),
    reading_resumed:           z.object({ contentId: z.string().min(1), sessionId: z.string().min(1) }).strip(),
    reading_abandoned:         z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), reason: z.string().max(60).optional() }).strip(),
    reading_reopened:          z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), gapMs: z.number().int().nonnegative().optional() }).strip(),
    reading_repeated_segment:  z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), fromSentence: z.number().int().nonnegative(), toSentence: z.number().int().nonnegative() }).strip(),

    // SESSION (5)
    session_started:           z.object({ sessionId: z.string().min(1), source: z.string().max(30), startedAt: ts }).strip(),
    session_heartbeat:         z.object({ sessionId: z.string().min(1), elapsedMs: z.number().int().nonnegative() }).strip(),
    session_ended:             z.object({ sessionId: z.string().min(1), totalMs: z.number().int().nonnegative(), reason: z.string().max(40).optional() }).strip(),
    session_timeout:           z.object({ sessionId: z.string().min(1), inactiveMs: z.number().int().nonnegative() }).strip(),
    session_recovered:         z.object({ sessionId: z.string().min(1), gapMs: z.number().int().nonnegative() }).strip(),

    // IMMERSIVE (6)
    immersive_started:             z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), runtime: RUNTIME, audioMode: z.string().max(40).optional() }).strip(),
    immersive_sentence_committed:  z.object({ sessionId: z.string().min(1), runtime: RUNTIME, sentenceIndex: z.number().int().nonnegative() }).strip(),
    immersive_sync_drift_detected: z.object({ sessionId: z.string().min(1), runtime: RUNTIME, deltaMs: z.number().int() }).strip(),
    immersive_sync_recovered:      z.object({ sessionId: z.string().min(1), runtime: RUNTIME, kind: z.enum(['hold_release','drift_resync','autoplay_recovery','other']) }).strip(),
    immersive_visibility_stall:    z.object({ sessionId: z.string().min(1), runtime: RUNTIME, stallMs: z.number().int().nonnegative() }).strip(),
    immersive_runtime_error:       z.object({ sessionId: z.string().min(1), runtime: RUNTIME, code: z.string().max(60), message: z.string().max(200).optional() }).strip(),

    // AUDIO (6)
    audio_started:           z.object({ sessionId: z.string().min(1), runtime: RUNTIME }).strip(),
    audio_paused:            z.object({ sessionId: z.string().min(1), runtime: RUNTIME }).strip(),
    audio_resumed:           z.object({ sessionId: z.string().min(1), runtime: RUNTIME }).strip(),
    audio_autoplay_blocked:  z.object({ sessionId: z.string().min(1), runtime: RUNTIME, via: z.string().max(40).optional() }).strip(),
    audio_desync_detected:   z.object({ sessionId: z.string().min(1), runtime: RUNTIME, deltaMs: z.number().int() }).strip(),
    audio_recovered:         z.object({ sessionId: z.string().min(1), runtime: RUNTIME, kind: z.string().max(40) }).strip(),

    // ACCESSIBILITY (7)
    accessibility_mode_enabled:  z.object({ feature: z.string().max(60) }).strip(),
    accessibility_mode_disabled: z.object({ feature: z.string().max(60) }).strip(),
    tts_started:                 z.object({ contentId: z.string().min(1).optional(), voice: z.string().max(60).optional() }).strip(),
    tts_interrupted:             z.object({ reason: z.string().max(60).optional() }).strip(),
    tts_completed:               z.object({ contentId: z.string().min(1).optional(), durationMs: z.number().int().nonnegative().optional() }).strip(),
    font_adjusted:               z.object({ from: z.string().max(20), to: z.string().max(20) }).strip(),
    contrast_adjusted:           z.object({ from: z.string().max(20), to: z.string().max(20) }).strip(),

    // PDF (4)
    pdf_opened:        z.object({ contentId: z.string().min(1), sessionId: z.string().min(1) }).strip(),
    pdf_page_changed:  z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), page: z.number().int().nonnegative() }).strip(),
    pdf_zoom_changed:  z.object({ sessionId: z.string().min(1), zoom: z.number().positive() }).strip(),
    pdf_completed:     z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), pages: z.number().int().nonnegative().optional() }).strip(),

    // GUIDED (3)
    guided_step_started:   z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), stepId: z.string().max(60) }).strip(),
    guided_step_completed: z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), stepId: z.string().max(60), elapsedMs: z.number().int().nonnegative().optional() }).strip(),
    guided_prompt_opened:  z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), promptId: z.string().max(60) }).strip(),

    // ALBUM (4)
    album_opened:          z.object({ contentId: z.string().min(1), sessionId: z.string().min(1) }).strip(),
    album_page_changed:    z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), page: z.number().int().nonnegative() }).strip(),
    album_audio_started:   z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), regionId: z.string().max(60).optional() }).strip(),
    album_interaction:     z.object({ contentId: z.string().min(1), sessionId: z.string().min(1), kind: z.string().max(40) }).strip(),

    // AULA VIVA (6)
    teacher_viewed_dashboard:        z.object({ at: ts, scopeLevel: SCOPE_LEVEL.optional(), scopeId: z.string().max(80).optional() }).strip(),
    teacher_viewed_group:            z.object({ groupId: z.string().min(1), at: ts }).strip(),
    teacher_viewed_student:          z.object({ groupId: z.string().min(1), studentId: z.string().min(1), at: ts }).strip(),
    teacher_detected_risk:           z.object({ scopeLevel: SCOPE_LEVEL, scopeId: z.string().min(1), kind: z.string().max(60), severity: SEVERITY }).strip(),
    teacher_created_intervention:    z.object({ scopeLevel: SCOPE_LEVEL, scopeId: z.string().min(1), kind: z.string().max(60), note: z.string().max(500).optional() }).strip(),
    teacher_reviewed_recommendation: z.object({ recommendationId: z.string().min(1), accepted: z.boolean() }).strip(),
    mediator_reviewed_cohort:        z.object({ scopeLevel: SCOPE_LEVEL, scopeId: z.string().min(1), cohortKey: z.string().max(80).optional() }).strip(),
    intervention_detected:           z.object({ scopeLevel: SCOPE_LEVEL, scopeId: z.string().min(1), kind: z.string().max(60), severity: SEVERITY }).strip(),

    // INSTITUTIONAL (10)
    institution_created:        z.object({ schoolId: z.string().min(1), name: z.string().max(120) }).strip(),
    group_created:              z.object({ groupId: z.string().min(1), name: z.string().max(120), kind: z.enum(['course','club']).optional() }).strip(),
    group_updated:              z.object({ groupId: z.string().min(1), fields: z.array(z.string().max(40)).max(20) }).strip(),
    membership_added:           z.object({ groupId: z.string().min(1), userId: z.string().min(1), role: ROLE }).strip(),
    membership_removed:         z.object({ groupId: z.string().min(1), userId: z.string().min(1), role: ROLE }).strip(),
    membership_moved:           z.object({ fromGroupId: z.string().min(1), toGroupId: z.string().min(1), userIds: z.array(z.string().min(1)).max(500) }).strip(),
    bulk_assignment:            z.object({ groupId: z.string().min(1), added: z.number().int().nonnegative(), removed: z.number().int().nonnegative() }).strip(),
    bulk_membership_imported:   z.object({ scopeLevel: SCOPE_LEVEL, scopeId: z.string().min(1), imported: z.number().int().nonnegative(), failed: z.number().int().nonnegative().optional() }).strip(),
    access_granted:             z.object({ scopeLevel: SCOPE_LEVEL, scopeId: z.string().min(1), kind: z.string().max(40), expiresAt: ts.optional() }).strip(),
    access_revoked:             z.object({ scopeLevel: SCOPE_LEVEL, scopeId: z.string().min(1), kind: z.string().max(40) }).strip(),
    scope_violation_detected:   z.object({ scopeLevel: SCOPE_LEVEL, scopeId: z.string().min(1), actor: z.string().max(80).optional(), path: z.string().max(120).optional() }).strip(),

    // LEO (6)
    leo_interaction_started:    z.object({ sessionId: z.string().min(1), kind: z.string().max(40) }).strip(),
    leo_interaction_completed:  z.object({ sessionId: z.string().min(1), kind: z.string().max(40), durationMs: z.number().int().nonnegative().optional() }).strip(),
    leo_memory_updated:         z.object({ userId: z.string().min(1), keys: z.array(z.string().max(40)).max(50) }).strip(),
    leo_profile_updated:        z.object({ userId: z.string().min(1), fields: z.array(z.string().max(40)).max(50) }).strip(),
    leo_evidence_recorded:      z.object({ userId: z.string().min(1), kind: z.string().max(40), sourceEvent: z.string().max(60).optional(), pedagogicalObjective: z.string().max(40).optional() }).strip(),
    leo_recommendation_generated: z.object({ userId: z.string().min(1), recommendationId: z.string().min(1), kind: z.string().max(40) }).strip(),

    // SYSTEM (6)
    deploy_started:             z.object({ release: z.string().max(60).optional(), commit: z.string().max(40).optional() }).strip(),
    deploy_completed:           z.object({ release: z.string().max(60).optional(), durationMs: z.number().int().nonnegative().optional() }).strip(),
    migration_applied:          z.object({ name: z.string().max(60), durationMs: z.number().int().nonnegative().optional() }).strip(),
    archive_started:            z.object({ cutoffTs: ts, candidate: z.number().int().nonnegative().optional() }).strip(),
    archive_completed:          z.object({ archived: z.number().int().nonnegative(), cutoffTs: ts, durationMs: z.number().int().nonnegative().optional() }).strip(),
    shadow_divergence_detected: z.object({ domain: z.string().max(40), legacy: z.number().int().nonnegative(), canon: z.number().int().nonnegative(), missing: z.number().int().nonnegative() }).strip(),
};

// ── CATEGORY map ───────────────────────────────────────────────────────────
const CATEGORY = {
    // reading
    reading_started:'reading', reading_progress:'reading', reading_completed:'reading',
    reading_paused:'reading', reading_resumed:'reading', reading_abandoned:'reading',
    reading_reopened:'reading', reading_repeated_segment:'reading',
    // session
    session_started:'session', session_heartbeat:'session', session_ended:'session',
    session_timeout:'session', session_recovered:'session',
    // immersive
    immersive_started:'immersive', immersive_sentence_committed:'immersive',
    immersive_sync_drift_detected:'immersive', immersive_sync_recovered:'immersive',
    immersive_visibility_stall:'immersive', immersive_runtime_error:'immersive',
    // audio
    audio_started:'audio', audio_paused:'audio', audio_resumed:'audio',
    audio_autoplay_blocked:'audio', audio_desync_detected:'audio', audio_recovered:'audio',
    // accessibility
    accessibility_mode_enabled:'accessibility', accessibility_mode_disabled:'accessibility',
    tts_started:'accessibility', tts_interrupted:'accessibility', tts_completed:'accessibility',
    font_adjusted:'accessibility', contrast_adjusted:'accessibility',
    // pdf
    pdf_opened:'pdf', pdf_page_changed:'pdf', pdf_zoom_changed:'pdf', pdf_completed:'pdf',
    // guided
    guided_step_started:'guided', guided_step_completed:'guided', guided_prompt_opened:'guided',
    // album
    album_opened:'album', album_page_changed:'album', album_audio_started:'album', album_interaction:'album',
    // aula_viva
    teacher_viewed_dashboard:'aula_viva', teacher_viewed_group:'aula_viva',
    teacher_viewed_student:'aula_viva', teacher_detected_risk:'aula_viva',
    teacher_created_intervention:'aula_viva', teacher_reviewed_recommendation:'aula_viva',
    mediator_reviewed_cohort:'aula_viva', intervention_detected:'aula_viva',
    // institutional
    institution_created:'institutional', group_created:'institutional', group_updated:'institutional',
    membership_added:'institutional', membership_removed:'institutional', membership_moved:'institutional',
    bulk_assignment:'institutional', bulk_membership_imported:'institutional',
    access_granted:'institutional', access_revoked:'institutional',
    scope_violation_detected:'institutional',
    // leo
    leo_interaction_started:'leo', leo_interaction_completed:'leo',
    leo_memory_updated:'leo', leo_profile_updated:'leo',
    leo_evidence_recorded:'leo', leo_recommendation_generated:'leo',
    // system
    deploy_started:'system', deploy_completed:'system', migration_applied:'system',
    archive_started:'system', archive_completed:'system', shadow_divergence_detected:'system',
};

// ── META map (defaults por categoría; overrides puntuales abajo) ────────────
const CATEGORY_DEFAULTS = {
    reading:       { pedagogical_weight: 3, materialization_hint: 'snapshot_user',  privacy_level: 'pedagogical',   retention_class: 'warm_1y' },
    session:       { pedagogical_weight: 2, materialization_hint: 'snapshot_user',  privacy_level: 'pedagogical',   retention_class: 'warm_1y' },
    immersive:     { pedagogical_weight: 1, materialization_hint: 'counter_runtime',privacy_level: 'institutional', retention_class: 'hot_90d' },
    audio:         { pedagogical_weight: 1, materialization_hint: 'counter_runtime',privacy_level: 'institutional', retention_class: 'hot_90d' },
    accessibility: { pedagogical_weight: 2, materialization_hint: 'snapshot_user',  privacy_level: 'sensitive',     retention_class: 'warm_1y' },
    pdf:           { pedagogical_weight: 2, materialization_hint: 'snapshot_user',  privacy_level: 'pedagogical',   retention_class: 'warm_1y' },
    guided:        { pedagogical_weight: 3, materialization_hint: 'snapshot_user',  privacy_level: 'pedagogical',   retention_class: 'warm_1y' },
    album:         { pedagogical_weight: 2, materialization_hint: 'snapshot_user',  privacy_level: 'pedagogical',   retention_class: 'warm_1y' },
    aula_viva:     { pedagogical_weight: 2, materialization_hint: 'snapshot_group', privacy_level: 'institutional', retention_class: 'warm_1y' },
    institutional: { pedagogical_weight: 1, materialization_hint: 'snapshot_school',privacy_level: 'institutional', retention_class: 'warm_1y' },
    leo:           { pedagogical_weight: 3, materialization_hint: 'snapshot_user',  privacy_level: 'sensitive',     retention_class: 'warm_1y' },
    system:        { pedagogical_weight: 0, materialization_hint: 'log_only',       privacy_level: 'public',        retention_class: 'hot_90d' },
};
const META_OVERRIDE = {
    reading_completed:           { pedagogical_weight: 3, retention_class: 'cold_archive' },
    reading_abandoned:           { pedagogical_weight: 3 },
    session_heartbeat:           { pedagogical_weight: 0, retention_class: 'transient_30d' },
    immersive_visibility_stall:  { pedagogical_weight: 0 },
    immersive_runtime_error:     { pedagogical_weight: 0 },
    audio_autoplay_blocked:      { pedagogical_weight: 0 },
    scope_violation_detected:    { pedagogical_weight: 0, privacy_level: 'institutional' },
    teacher_created_intervention:{ pedagogical_weight: 3, retention_class: 'cold_archive' },
    leo_evidence_recorded:       { pedagogical_weight: 3, retention_class: 'cold_archive' },
    leo_recommendation_generated:{ pedagogical_weight: 3, retention_class: 'warm_1y' },
};

const REGISTRY = Object.freeze(
    Object.fromEntries(Object.keys(SCHEMAS).map(name => {
        const category = CATEGORY[name];
        if (!category) throw new Error(`eventRegistry: missing category for ${name}`);
        const base = CATEGORY_DEFAULTS[category];
        const meta = Object.freeze({ ...base, ...(META_OVERRIDE[name] || {}) });
        return [name, Object.freeze({
            category, version: 1, schema: SCHEMAS[name], meta, deprecated: false,
        })];
    }))
);

export const EVENT_NAMES      = Object.freeze(Object.keys(REGISTRY));
export const EVENT_CATEGORIES = Object.freeze([
    'reading','session','immersive','audio','accessibility','pdf','guided','album',
    'aula_viva','institutional','leo','system',
]);
export const REGISTRY_VERSION = 2;   // bump al cambiar shapes

/**
 * @returns {{ ok:true, category:string, version:number, payload:any, migrated:boolean, meta:object }
 *          | { ok:false, code:'unknown_event'|'deprecated'|'invalid_payload'|'unsupported_version',
 *              issues?:Array<{path:string,message:string}> }}
 */
export function validateEvent(eventName, payload, incomingVersion) {
    const def = REGISTRY[eventName];
    if (!def) return { ok: false, code: 'unknown_event' };

    let v = Number.isFinite(incomingVersion) ? incomingVersion : def.version;
    let body = payload ?? {};
    let migrated = false;
    if (v !== def.version) {
        if (typeof def.migrate !== 'function') return { ok: false, code: 'unsupported_version' };
        try { body = def.migrate(body, v); v = def.version; migrated = true; }
        catch { return { ok: false, code: 'unsupported_version' }; }
    }
    const parsed = def.schema.safeParse(body);
    if (!parsed.success) {
        return { ok: false, code: 'invalid_payload',
            issues: parsed.error.issues.slice(0, 10)
                .map(i => ({ path: i.path.join('.') || '(root)', message: i.message })) };
    }
    return { ok: true, category: def.category, version: def.version,
             payload: parsed.data, migrated, meta: def.meta };
}

export function describeEvent(eventName) {
    const d = REGISTRY[eventName];
    return d ? { eventName, category: d.category, version: d.version,
                 deprecated: d.deprecated, meta: d.meta } : null;
}

export function listRegistry() { return EVENT_NAMES.map(n => describeEvent(n)); }
export function getMeta(eventName) { return REGISTRY[eventName]?.meta ?? null; }
