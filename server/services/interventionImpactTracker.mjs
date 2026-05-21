/**
 * interventionImpactTracker.mjs — PASO 6 §14.
 *
 * Capa READER agregada (no compute pesado) que responde:
 *   - ¿qué intervenciones se aplicaron en un scope?
 *   - ¿a quiénes? con qué señales iniciales?
 *   - ¿qué pasó después? (outcome label + delta_metrics)
 *   - ¿qué mejoró? ¿qué no cambió? ¿qué empeoró?
 *   - ¿qué necesita seguimiento? (intervenciones SIN outcome aún)
 *
 * NUNCA throws. Devuelve estructuras vacías ante error.
 */
import { getOutcomesExtDb, getOutcomesStatements } from '../db/outcomesDbExt.mjs';
import { getPedagogyExtDb } from '../db/pedagogyDbExt.mjs';

function safe(fn, fallback) { try { return fn(); } catch { return fallback; } }

/**
 * Resumen agregado por scope (puede ser user, group, school, club…).
 * Para scope==='user' se devuelve historia completa de outcomes del lector.
 */
export function getImpactSummary(scope_type, scope_id, { limit = 100 } = {}) {
    return safe(() => {
        getOutcomesExtDb();
        const stmts = getOutcomesStatements();
        const rows = stmts.listOutcomesByScope.all(String(scope_type), String(scope_id), limit);
        const tally = { improved: 0, stable: 0, worsened: 0, mixed: 0, insufficient_data: 0 };
        for (const r of rows) tally[r.outcome_label] = (tally[r.outcome_label] || 0) + 1;
        return {
            scope: { type: scope_type, id: scope_id },
            total_outcomes: rows.length,
            distribution: tally,
            outcomes: rows.map(r => ({
                ...r,
                baseline_metrics: safe(() => JSON.parse(r.baseline_metrics_json), null),
                followup_metrics: safe(() => JSON.parse(r.followup_metrics_json), null),
                delta_metrics:    safe(() => JSON.parse(r.delta_metrics_json), null),
                notes:            safe(() => JSON.parse(r.notes_json), null),
            })),
        };
    }, { scope: { type: scope_type, id: scope_id }, total_outcomes: 0,
         distribution: {}, outcomes: [] });
}

/**
 * Distribución por intervention_type (cuántas mejoraron, etc.) — alimenta
 * panels institucionales.
 */
export function getImpactByInterventionType(interventionType) {
    return safe(() => {
        getOutcomesExtDb();
        const stmts = getOutcomesStatements();
        const dist = stmts.listOutcomesByType.all(interventionType);
        const total = dist.reduce((s, d) => s + d.n, 0);
        return {
            intervention_type: interventionType,
            total,
            distribution: Object.fromEntries(dist.map(d => [d.outcome_label, d.n])),
        };
    }, { intervention_type: interventionType, total: 0, distribution: {} });
}

/**
 * Lista de intervenciones con seguimiento pendiente: ya pasó la ventana de
 * follow-up pero todavía no hay outcome calculado, o explicit `outcome='pending'`.
 */
export function getFollowupQueue({ olderThanDays = 14, limit = 100 } = {}) {
    return safe(() => {
        getPedagogyExtDb();
        getOutcomesExtDb();
        const pedDb = getPedagogyExtDb();
        const outDb = getOutcomesExtDb();
        const cutoff = Date.now() - olderThanDays * 86_400_000;

        const overdue = pedDb.prepare(
            `SELECT * FROM pedagogical_interventions
             WHERE created_at <= ?
             ORDER BY created_at ASC LIMIT ?`
        ).all(cutoff, limit);

        const have = new Set(outDb.prepare(
            `SELECT intervention_id FROM intervention_outcomes`
        ).all().map(r => r.intervention_id));

        return overdue.filter(i => !have.has(i.intervention_id))
            .map(i => ({
                intervention_id: i.intervention_id,
                student_id: i.student_id,
                intervention_type: i.intervention_type,
                created_at: i.created_at,
                days_overdue: Math.floor((Date.now() - i.created_at) / 86_400_000),
                manual_outcome: i.outcome,
            }));
    }, []);
}

/**
 * Resumen para un user: historia de intervenciones + outcomes.
 */
export function getUserImpactHistory(userId) {
    return getImpactSummary('user', userId, { limit: 50 });
}
