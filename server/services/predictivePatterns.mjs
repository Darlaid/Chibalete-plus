/**
 * predictivePatterns.mjs — PASO 6 §16.
 *
 * Detector de SECUENCIAS observadas (no ML, no predicción individual).
 *
 * Lee `pedagogical_risk_history` cerrados (resolved_at NOT NULL O activos)
 * y agrupa: ¿qué secuencia de señales precedió a este riesgo? Si la misma
 * secuencia se ha observado ≥ MIN_SUPPORT veces → registra un
 * `predictive_risk_patterns` con `support_count` + confidence honesta.
 *
 * NO produce predicciones per-user. Solo registra agregados.
 *
 * Patrón canónico (PASO 6 §16):
 *   continuidad cae 2 semanas + sesiones < 3min + abandono temprano →
 *   riesgo de invisibilidad futura
 *
 * Implementación HOY:
 *   Para cada risk_type observado: cuenta cuántos users lo tuvieron,
 *   cuántos se recuperaron, distribución temporal. Esto ya es proto-
 *   pattern útil. Secuencias multi-señal complejas requieren snapshot_history
 *   acumulada (PASO 7).
 *
 * GATING: AULA_VIVA_PREDICTIVE_PATTERNS_ENABLED=1 (default OFF).
 */
import { getOutcomesExtDb, getOutcomesStatements } from '../db/outcomesDbExt.mjs';
import { getPedagogyExtDb } from '../db/pedagogyDbExt.mjs';
import { predictivePatternsTotal } from '../observability/metrics.js';

export const ENABLED = () => process.env.AULA_VIVA_PREDICTIVE_PATTERNS_ENABLED === '1';
const MIN_SUPPORT = Number(process.env.AULA_VIVA_PATTERN_MIN_SUPPORT || 5);
const PATTERN_VERSION = 1;

function confidenceFromSupport(n) {
    if (n < 5) return 0.2;
    if (n < 20) return 0.5;
    if (n < 50) return 0.7;
    return 0.85;
}

export function runOnce(opts = {}) {
    const t0 = Date.now();
    const log = opts.log || (() => {});
    const nowTs = opts.nowTs ?? Date.now();
    const result = { ok: false, processed: 0, patterns_upserted: 0, durationMs: 0 };
    if (!opts.forceRun && !ENABLED()) {
        return { ...result, ok: true, skipped: true, reason: 'disabled_default_off' };
    }
    try {
        getOutcomesExtDb();
        getPedagogyExtDb();
        const stmts = getOutcomesStatements();
        const pedDb = getPedagogyExtDb();

        // Agrupar risk_history por risk_type → support_count agregado.
        // (Versión inicial: 1 patrón por risk_type. PASO 7 puede agregar
        // secuencias multi-señal usando snapshot_history.)
        const groups = pedDb.prepare(
            `SELECT risk_type,
                    COUNT(*) AS total,
                    SUM(CASE WHEN resolved_at IS NULL THEN 1 ELSE 0 END) AS active,
                    SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END) AS resolved
             FROM pedagogical_risk_history GROUP BY risk_type`
        ).all();

        const rows = [];
        for (const g of groups) {
            if (g.total < MIN_SUPPORT) continue;
            const sequence = {
                rule_id: g.risk_type,
                trigger_signals: ['risk_history_detected'],
                window: 'period_28d',
            };
            rows.push({
                pattern_id:  `pat_${g.risk_type}_v${PATTERN_VERSION}`,
                pattern_key: `risk:${g.risk_type}`,
                signal_sequence_json: JSON.stringify(sequence),
                observed_outcome: g.risk_type,
                support_count: g.total,
                confidence: confidenceFromSupport(g.total),
                version: PATTERN_VERSION,
                created_at: nowTs, updated_at: nowTs,
            });
            result.processed++;
        }

        const tx = getOutcomesExtDb().transaction(() => {
            for (const r of rows) {
                stmts.upsertPattern.run(r);
                result.patterns_upserted++;
            }
        });
        tx();
        try { for (const _ of rows) predictivePatternsTotal.labels(`v${PATTERN_VERSION}`).inc(); } catch {}
        result.ok = true;
    } catch (e) {
        result.error = String(e?.message || e);
        log(`[predictivePatterns] error: ${result.error}`);
    }
    result.durationMs = Date.now() - t0;
    return result;
}

export function getStatus() {
    try {
        getOutcomesExtDb();
        const stmts = getOutcomesStatements();
        return {
            engine: 'aula_viva_predictive_patterns_v1',
            enabled: ENABLED(),
            min_support: MIN_SUPPORT,
            patterns_active: stmts.countPatterns.get().n,
            ok: true,
        };
    } catch (e) { return { ok: false, engine: 'aula_viva_predictive_patterns_v1', error: String(e?.message || e) }; }
}
