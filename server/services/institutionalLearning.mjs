/**
 * institutionalLearning.mjs — PASO 6 §15.
 *
 * Produce aprendizajes PRUDENTES por scope a partir de intervention_outcomes:
 *
 *   "En cohortes de scope X, la intervención Y se asocia con outcome Z
 *    en N casos observados (confianza C, evidencia E)."
 *
 * NO afirma causalidad. NO predice individuos. NUNCA usa "causal" /
 * "garantizado" / "predice".
 *
 * Para cada (scope, intervention_type) cuenta distribución de
 * outcome_label y emite una `institutional_learnings` row si support_count
 * cumple THRESHOLD (default 5).
 *
 * También expone `getPriorityHints(rule_id)` para el motor de
 * recomendación (no modifica interventionEngine; el caller decide usar).
 *
 * GATING: AULA_VIVA_LEARNING_ENABLED=1 (default OFF).
 */
import { getOutcomesExtDb, getOutcomesStatements } from '../db/outcomesDbExt.mjs';
import { institutionalLearningsTotal } from '../observability/metrics.js';

export const ENABLED = () => process.env.AULA_VIVA_LEARNING_ENABLED === '1';
const MIN_SUPPORT = Number(process.env.AULA_VIVA_LEARNING_MIN_SUPPORT || 5);

const HUMAN_LABELS = {
    improved: 'mejora observada',
    stable:   'sin cambios observados',
    worsened: 'retroceso observado',
    mixed:    'cambios mixtos',
    insufficient_data: 'datos insuficientes',
};

function buildHint(scopeType, scopeId, interventionType, distribution, total) {
    // Determinar la categoría dominante (excluyendo insufficient_data).
    const candidates = ['improved', 'stable', 'worsened', 'mixed']
        .map(l => ({ l, n: distribution[l] || 0 }))
        .filter(x => x.n > 0);
    if (candidates.length === 0) {
        return `Para la intervención "${interventionType}" en este scope no hay observaciones evaluables aún.`;
    }
    candidates.sort((a, b) => b.n - a.n);
    const dom = candidates[0];
    const pct = total > 0 ? Math.round((dom.n / total) * 100) : 0;
    // Vocabulario observacional + prudente.
    return `En el scope ${scopeType}:${scopeId}, después de la intervención "${interventionType}" se observó ${HUMAN_LABELS[dom.l]} en ${dom.n} de ${total} casos (${pct}%). NO implica causalidad — refleja patrones observados.`;
}

function computeConfidence(total) {
    // Confianza basada en tamaño de muestra:
    // 5 casos → 0.4, 15 → 0.6, 40 → 0.8, 100+ → 0.9 (max)
    if (total < 5) return 0.2;
    if (total < 15) return 0.4;
    if (total < 40) return 0.6;
    if (total < 100) return 0.8;
    return 0.9;
}

// ── API ────────────────────────────────────────────────────────────────────

export function runOnce(opts = {}) {
    const t0 = Date.now();
    const log = opts.log || (() => {});
    const nowTs = opts.nowTs ?? Date.now();
    const result = { ok: false, processed: 0, upserted: 0, durationMs: 0 };
    if (!opts.forceRun && !ENABLED()) {
        return { ...result, ok: true, skipped: true, reason: 'disabled_default_off' };
    }
    try {
        getOutcomesExtDb();
        const stmts = getOutcomesStatements();
        const db = getOutcomesExtDb();

        // Las institutional learnings deben AGREGAR ACROSS usuarios — NO por
        // user individual (cada user tiene ≤1 outcome por intervención, jamás
        // alcanza MIN_SUPPORT). Estrategia PASO 6:
        //   1. Agregamos a nivel ('all', 'global', intervention_type) → siempre.
        //   2. Si hay cohort_memberships materializadas (PASO 6 cohortBuilder),
        //      agregamos por (cohort_type, scope_id, intervention_type)
        //      consultando los user_ids que pertenecen a esa cohort.
        // Esto produce learnings comparables ("en general", "en school X", etc.).
        const allOutcomes = db.prepare(
            `SELECT user_id, intervention_type, outcome_label
             FROM intervention_outcomes`
        ).all();

        const agg = new Map();
        const bump = (scopeType, scopeId, interventionType, label) => {
            const k = `${scopeType}|${scopeId}|${interventionType}`;
            if (!agg.has(k)) agg.set(k, { scope_type: scopeType, scope_id: scopeId,
                                          intervention_type: interventionType,
                                          distribution: {}, total: 0 });
            const e = agg.get(k);
            e.distribution[label] = (e.distribution[label] || 0) + 1;
            e.total += 1;
        };

        // 1) Agregado global.
        for (const o of allOutcomes) bump('all', 'global', o.intervention_type, o.outcome_label);

        // 2) Agregado por cohort (si hay cohort_memberships poblados).
        try {
            const cohortRows = db.prepare(
                `SELECT cd.cohort_type, cd.scope_id, cm.user_id
                 FROM cohort_definitions cd
                 JOIN cohort_memberships cm ON cm.cohort_id = cd.cohort_id
                 WHERE cd.active = 1
                   AND cd.cohort_type IN ('school','group','club')`
            ).all();
            // Index user → [{cohort_type, scope_id}]
            const userCohorts = new Map();
            for (const r of cohortRows) {
                if (!userCohorts.has(r.user_id)) userCohorts.set(r.user_id, []);
                userCohorts.get(r.user_id).push({ ct: r.cohort_type, sid: r.scope_id });
            }
            for (const o of allOutcomes) {
                const cs = userCohorts.get(o.user_id) || [];
                for (const { ct, sid } of cs) bump(ct, sid, o.intervention_type, o.outcome_label);
            }
        } catch { /* sin cohorts construidos → solo global */ }

        const rows = [];
        for (const e of agg.values()) {
            if (e.total < MIN_SUPPORT) continue;
            const evidence = {
                support_count: e.total,
                outcome_distribution: e.distribution,
                intervention_type: e.intervention_type,
                min_support_threshold: MIN_SUPPORT,
            };
            const hint = buildHint(e.scope_type, e.scope_id, e.intervention_type,
                                   e.distribution, e.total);
            rows.push({
                learning_id: `lrn_${e.scope_type}_${e.scope_id}_${e.intervention_type}_v1`,
                scope_type: e.scope_type,
                scope_id: e.scope_id,
                learning_type: 'observed_strategy_effect',
                evidence_json: JSON.stringify(evidence),
                confidence: computeConfidence(e.total),
                recommendation_hint: hint,
                version: 1,
                created_at: nowTs, updated_at: nowTs,
            });
            result.processed++;
        }

        const tx = getOutcomesExtDb().transaction(() => {
            for (const r of rows) {
                stmts.upsertLearning.run(r);
                result.upserted++;
                try { institutionalLearningsTotal.labels(r.learning_type).inc(); } catch {}
            }
        });
        tx();
        result.ok = true;
    } catch (e) {
        result.error = String(e?.message || e);
        log(`[institutionalLearning] error: ${result.error}`);
    }
    result.durationMs = Date.now() - t0;
    return result;
}

/**
 * Devuelve hints de prioridad para el motor de recomendación, basados en
 * outcomes históricos del intervention_type asociado al rule_id.
 *
 * NO ranking opaco — retorna objeto {multiplier, rationale, confidence}
 * que el caller (UI o engine futuro) puede mostrar al docente.
 *
 * Mapeo rule_id → recommendation_type basado en pedagogicalRules.js
 * (replicado aquí para evitar circular dep).
 */
const RULE_TO_TYPE = {
    abandono_alto: 'lectura_guiada',
    fatiga_lectora: 'modo_audio_con_pausas',
    invisibilidad_prolongada: 'restablecer_vinculo',
    alta_autonomia: 'exploracion_generos',
    diversidad_baja: 'sugerir_rotacion',
    deterioro_continuidad: 'mediacion_refuerzo',
    mejora_destacada: 'reconocer_progreso',
    habito_emergente: 'reforzar_habito',
};

export function getPriorityHints(ruleId) {
    try {
        const interventionType = RULE_TO_TYPE[ruleId];
        if (!interventionType) return { multiplier: 1.0, rationale: 'no_mapping', confidence: 0 };
        const db = getOutcomesExtDb();
        const dist = db.prepare(
            `SELECT outcome_label, COUNT(*) AS n FROM intervention_outcomes
             WHERE intervention_type = ?
             GROUP BY outcome_label`
        ).all(interventionType);
        if (!dist.length) return { multiplier: 1.0, rationale: 'no_history', confidence: 0 };

        const total = dist.reduce((s, r) => s + r.n, 0);
        const improved = dist.find(r => r.outcome_label === 'improved')?.n || 0;
        const worsened = dist.find(r => r.outcome_label === 'worsened')?.n || 0;
        // Multiplier honesto: ratio improved/total con clamp [0.5, 1.5].
        // No-history → 1.0 (neutral). History positiva → boost moderado.
        const improvedRatio = total ? improved / total : 0;
        const worsenedRatio = total ? worsened / total : 0;
        const multiplier = Math.max(0.5, Math.min(1.5, 1.0 + (improvedRatio - worsenedRatio)));
        return {
            multiplier: +multiplier.toFixed(3),
            rationale: `Histórico observado para "${interventionType}": ${improved}/${total} mejora, ${worsened}/${total} retroceso.`,
            confidence: computeConfidence(total),
            sample_size: total,
        };
    } catch {
        return { multiplier: 1.0, rationale: 'error', confidence: 0 };
    }
}

export function getStatus() {
    try {
        getOutcomesExtDb();
        const stmts = getOutcomesStatements();
        return {
            engine: 'aula_viva_institutional_learning_v1',
            enabled: ENABLED(),
            min_support: MIN_SUPPORT,
            learnings_active: stmts.countLearnings.get().n,
            ok: true,
        };
    } catch (e) { return { ok: false, engine: 'aula_viva_institutional_learning_v1', error: String(e?.message || e) }; }
}
