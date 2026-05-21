/**
 * flags.js — P1 feature flags (env-driven, DEFAULT SEGURO = comportamiento
 * actual de producción). Cero dependencia. Reversible: cambiar env → restart.
 *
 * P1-A persistencia (cutover gradual, JSON sigue siendo source-of-truth hasta
 *   fase 3):
 *   IDENTITY_SQLITE_ENABLED  '1' → migra/bootstrapea identity.db al arranque.
 *                                  OFF por defecto (no crea ni toca SQLite).
 *   IDENTITY_DUAL_WRITE      '1' → tras cada write JSON de users/groups/access
 *                                  espeja a SQLite (shadow). NUNCA bloquea ni
 *                                  rompe el write JSON. OFF por defecto.
 *   IDENTITY_READ            'json' (default) | 'sqlite'  ← cutover de lectura.
 *                                  Solo se respeta si SQLITE_ENABLED+DUAL_WRITE
 *                                  estuvieron ON y la verificación de
 *                                  consistencia pasó. NO usar en fase 1.
 *
 * P1-B runtime V2 (canary, V1 sigue canónico):
 *   IMMERSIVE_V2_KILLSWITCH  '1' → fuerza V1 para TODOS, ignora cohortes
 *                                  (rollback global instantáneo). Gana sobre
 *                                  todo lo demás.
 *   IMMERSIVE_V2_COHORT_PCT  '0'..'100' (default '0') → % de usuarios en V2.
 *                                  Asignación estable por hash(userId).
 *
 * FASE 2A LEC (Leo Longitudinal Events):
 *   LEO_EVENTS_BACKBONE_ENABLED '1' → Leo emite los 6 events leo_*
 *                                  (interaction_started/completed,
 *                                  evidence_recorded, memory_updated,
 *                                  profile_updated, recommendation_generated)
 *                                  al events.db canónico via
 *                                  recordCanonicalEvent. Default OFF — sin
 *                                  efecto sobre el flujo Leo actual.
 *                                  Rollback: env var a OFF + restart (la
 *                                  flag se lee per-call, restart no es
 *                                  estrictamente necesario pero recomendado
 *                                  para asegurar estado limpio).
 *
 * FASE 3A AULA VIVA OPERACIONAL:
 *   AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED '1' → el endpoint
 *                                  /api/aula-viva/students/:userId/timeline
 *                                  agrega un array `summaries[]` con frases
 *                                  determinísticas (NO LLM) sobre el estado
 *                                  longitudinal del lector. Cada summary
 *                                  incluye confidence + caveat explícito y
 *                                  honra "no afirmar comprensión". Default
 *                                  OFF — sin él, summaries=[] y el resto del
 *                                  payload queda intacto.
 *
 * FASE 3B AULA VIVA INSTITUCIONAL:
 *   AULA_VIVA_AUDIT_EVENTS_ENABLED '1' → operationalRouter emite eventos
 *                                  canónicos teacher_/mediator_ a events.db
 *                                  cuando un mediador ve un estudiante, revisa
 *                                  una recomendación, registra una intervención
 *                                  o consulta cohorts. Default OFF — sin él,
 *                                  cero impacto en latencia/escritura.
 *                                  Payloads sin PII (solo IDs + at + scope).
 *                                  Trazabilidad institucional, NO vigilancia
 *                                  de mediadores.
 *
 *   AULA_VIVA_COHORT_SUMMARIES_ENABLED '1' → habilita los templates
 *                                  cohort-scope en longitudinalSummary.mjs
 *                                  (recovery_collective, help_seeking_concentrated,
 *                                  persistence_growing_cohort, insufficient_cohort_data).
 *                                  Para uso desde generateCohortSummaries().
 *                                  Default OFF.
 *
 * FASE 2B LEC (signal extraction):
 *   LEO_SIGNAL_EXTRACTION_ENABLED '1' → signalCompute deriva 4 señales
 *                                  pedagógicas (mediacion_leo,
 *                                  inferencia_observada,
 *                                  metacognicion_observada,
 *                                  emocion_observada) desde los eventos
 *                                  leo_* en events.db. Default OFF: las 4
 *                                  signals quedan en confidence='pending'
 *                                  igual que cualquier signal deferida.
 *                                  Requiere LEO_EVENTS_BACKBONE_ENABLED=1
 *                                  para tener data; sin él no hay eventos
 *                                  Leo en events.db y las signals devuelven
 *                                  null/pending igual.
 */

function envFlag(name, def = false) {
    const v = process.env[name];
    if (v === undefined || v === null || v === '') return def;
    return v === '1' || v.toLowerCase() === 'true';
}

function envEnum(name, allowed, def) {
    const v = (process.env[name] || '').toLowerCase().trim();
    return allowed.includes(v) ? v : def;
}

function envPct(name, def = 0) {
    const n = Number.parseInt(process.env[name] ?? '', 10);
    if (!Number.isFinite(n)) return def;
    return Math.min(100, Math.max(0, n));
}

export const flags = {
    // P1-A
    identitySqliteEnabled: () => envFlag('IDENTITY_SQLITE_ENABLED', false),
    identityDualWrite:     () => envFlag('IDENTITY_DUAL_WRITE', false),
    identityReadSource:    () => envEnum('IDENTITY_READ', ['json', 'sqlite'], 'json'),
    // P1-B
    immersiveV2Killswitch: () => envFlag('IMMERSIVE_V2_KILLSWITCH', false),
    immersiveV2CohortPct:  () => envPct('IMMERSIVE_V2_COHORT_PCT', 0),
    // Fase 2A LEC
    leoEventsBackboneEnabled: () => envFlag('LEO_EVENTS_BACKBONE_ENABLED', false),
    // Fase 2B LEC
    leoSignalExtractionEnabled: () => envFlag('LEO_SIGNAL_EXTRACTION_ENABLED', false),
    // Fase 3A AULA VIVA OPERACIONAL — longitudinal summary engine
    aulaVivaLongitudinalSummaryEnabled: () => envFlag('AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED', false),
    // Fase 3B AULA VIVA INSTITUCIONAL — audit emitter + cohort summaries
    aulaVivaAuditEventsEnabled:    () => envFlag('AULA_VIVA_AUDIT_EVENTS_ENABLED', false),
    aulaVivaCohortSummariesEnabled: () => envFlag('AULA_VIVA_COHORT_SUMMARIES_ENABLED', false),
};

/**
 * Asignación de cohorte V2 estable y determinista por userId (sin estado,
 * sin RNG → mismo usuario siempre cae igual). Kill-switch gana siempre.
 * @param {string|null|undefined} userId
 * @returns {{ runtime: 'v1'|'v2', reason: string, bucket: number }}
 */
export function resolveImmersiveRuntime(userId) {
    if (flags.immersiveV2Killswitch()) {
        return { runtime: 'v1', reason: 'killswitch', bucket: -1 };
    }
    const pct = flags.immersiveV2CohortPct();
    if (pct <= 0) return { runtime: 'v1', reason: 'cohort_0', bucket: -1 };
    if (pct >= 100) return { runtime: 'v2', reason: 'cohort_100', bucket: 0 };
    const key = String(userId ?? 'anon');
    // FNV-1a 32-bit → bucket 0..99 estable.
    let h = 0x811c9dc5;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = (h * 0x01000193) >>> 0;
    }
    const bucket = h % 100;
    return bucket < pct
        ? { runtime: 'v2', reason: `cohort_${pct}`, bucket }
        : { runtime: 'v1', reason: `cohort_${pct}`, bucket };
}
