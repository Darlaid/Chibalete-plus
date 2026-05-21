/**
 * outcomeEngine.mjs — PASO 6 §7.
 *
 * Para cada intervención que ya tenga `now > created_at + OUTCOME_FOLLOWUP_DAYS`,
 * computa el outcome automáticamente:
 *   - lee baseline metrics (ventana N días ANTES de created_at)
 *   - lee followup metrics (ventana N días DESPUÉS de created_at)
 *   - clasifica con outcomeClassifier
 *   - persiste en intervention_outcomes (UPSERT por intervention_id)
 *
 * GATING: `AULA_VIVA_OUTCOME_ENGINE_ENABLED=1` (default OFF).
 *
 * Patrón 4-fase respetado (PASO 3 §8b): compute puro → tx outcomes →
 * (sin POST-COMMIT cross-handle porque outcomes vive en su propio handle).
 *
 * Recovery-first: nunca lanza al caller. Errores → métrica + last_error.
 */
import { getOutcomesExtDb, getOutcomesStatements } from '../db/outcomesDbExt.mjs';
import { getPedagogyExtDb } from '../db/pedagogyDbExt.mjs';
import { getInsightsExtDb } from '../db/insightsDbExt.mjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
    classifyOutcome, OUTCOME_LABELS, EVIDENCE_LEVELS,
    containsForbiddenVocab,
} from '../pedagogy/outcomeClassifier.js';
import {
    outcomesComputed, outcomeConfidenceAvg, outcomeInsufficientData,
    interventionFollowupDue,
} from '../observability/metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EVENTS_PATH = process.env.EVENTS_SQLITE_PATH
    || path.resolve(__dirname, '..', '..', 'data-critical', 'events.db');

const DAY_MS = 86_400_000;
const BASELINE_DAYS = Number(process.env.OUTCOME_BASELINE_DAYS || 14);
const FOLLOWUP_DAYS = Number(process.env.OUTCOME_FOLLOWUP_DAYS || 14);

let _eventsRaw = null;
function getEventsRaw() {
    if (_eventsRaw) return _eventsRaw;
    _eventsRaw = new Database(EVENTS_PATH, { readonly: true, fileMustExist: false });
    _eventsRaw.pragma('busy_timeout = 5000');
    return _eventsRaw;
}
export function closeOutcomesEventsRaw() {
    if (_eventsRaw) { try { _eventsRaw.close(); } catch {} _eventsRaw = null; }
}

export const ENABLED = () => process.env.AULA_VIVA_OUTCOME_ENGINE_ENABLED === '1';

// ── Cómputo de métricas por ventana ─────────────────────────────────────────
/**
 * Computa métricas del lector en una ventana [from, to] usando events
 * directamente (recovery sin snapshot_history; si snapshot_history existe
 * y la ventana está cubierta, podríamos enriquecer — futuro).
 */
function computeWindowMetrics(userId, from, to) {
    const db = getEventsRaw();
    const events = db.prepare(
        `SELECT event, server_ts, elapsed_ms, content_id, payload_json
         FROM events
         WHERE user_id = ? AND server_ts >= ? AND server_ts < ?
         ORDER BY server_ts ASC`
    ).all(String(userId), from, to);

    const days = new Set();
    let elapsedMs = 0, started = 0, completed = 0, abandoned = 0, earlyAbandons = 0;
    const contents = new Set();
    for (const e of events) {
        const day = new Date(e.server_ts).toISOString().slice(0, 10);
        days.add(day);
        if (e.event === 'reading_started' || e.event === 'session_started') started++;
        if (e.event === 'reading_completed') completed++;
        if (e.event === 'reading_abandoned') {
            abandoned++;
            try {
                const p = JSON.parse(e.payload_json || '{}');
                if (typeof p.percentage === 'number' ? p.percentage < 10 : true) earlyAbandons++;
            } catch { earlyAbandons++; }
        }
        if (e.content_id) contents.add(e.content_id);
        if (typeof e.elapsed_ms === 'number' && e.elapsed_ms > 0) elapsedMs += e.elapsed_ms;
        else if (e.payload_json) {
            try { const p = JSON.parse(e.payload_json);
                if (typeof p.elapsedMs === 'number' && p.elapsedMs > 0) elapsedMs += p.elapsedMs;
            } catch {}
        }
    }
    const total = started || 1;
    const den = started + abandoned;
    return {
        eventsCount: events.length,
        continuidad:     Math.min(1, days.size / 7),            // sobre 1 semana
        persistencia:    started > 0 ? completed / total : null,
        diversidad:      contents.size,
        engagement:      started > 0 ? Math.min(1, days.size / 7) * 0.6 + Math.min(1, elapsedMs / (60 * 60_000)) * 0.4 : null,
        abandono:        den > 0 ? earlyAbandons / den : null,
        autonomia:       null,        // requiere uso accessibility/tts; queda null por ahora
        concentracion:   null,
        recuperacion:    null,
        tiempo_efectivo: Math.round(elapsedMs / 60_000),
        completitud:     started > 0 ? completed / total : null,
    };
}

// ── Helper: due interventions (PASO 5 + 6) ──────────────────────────────────
/**
 * Devuelve intervenciones cuya ventana de follow-up YA SE CERRÓ y todavía
 * no tienen outcome computado (o lo tienen pero la cierra una rebuild).
 */
function listDueInterventions(nowTs, opts = {}) {
    const pedDb = getPedagogyExtDb();
    const outDb = getOutcomesExtDb();
    const cutoff = nowTs - FOLLOWUP_DAYS * DAY_MS;
    // Todas las intervenciones cuyo created_at + FOLLOWUP_DAYS ya pasó.
    const all = pedDb.prepare(
        `SELECT * FROM pedagogical_interventions WHERE created_at <= ? ORDER BY created_at ASC`
    ).all(cutoff);
    if (opts.includeAll) return all;
    // Filtrar las que ya tienen outcome (a menos que opts.force).
    if (opts.force) return all;
    const existing = new Set(
        outDb.prepare(`SELECT intervention_id FROM intervention_outcomes`).all()
            .map(r => r.intervention_id)
    );
    return all.filter(i => !existing.has(i.intervention_id));
}

// ── runOnce ────────────────────────────────────────────────────────────────
/**
 * Calcula outcomes para todas las intervenciones evaluables.
 * @param {{nowTs?:number, log?:(m:string)=>void, force?:boolean, forceRun?:boolean,
 *          scopes?:{interventionIds?:string[]}}} [opts]
 */
export function runOnce(opts = {}) {
    const t0 = Date.now();
    const log = opts.log || (() => {});
    const nowTs = opts.nowTs ?? Date.now();
    const result = {
        ok: false, processed: 0,
        upserted: 0, by_label: { improved: 0, stable: 0, worsened: 0,
                                  mixed: 0, insufficient_data: 0 },
        avg_confidence: null, durationMs: 0,
    };
    if (!opts.forceRun && !ENABLED()) {
        return { ...result, ok: true, skipped: true, reason: 'disabled_default_off' };
    }
    try {
        getOutcomesExtDb();
        getPedagogyExtDb();
        getInsightsExtDb();
        const stmts = getOutcomesStatements();
        const due = opts.scopes?.interventionIds
            ? listDueInterventions(nowTs, { includeAll: true })
                .filter(i => opts.scopes.interventionIds.includes(i.intervention_id))
            : listDueInterventions(nowTs, { force: !!opts.force });
        try { interventionFollowupDue.set(due.length); } catch {}

        const rows = [];
        let confSum = 0, confN = 0;

        // FASE 1: compute puro (sin tx) — lee events.db (raw read-only).
        for (const intv of due) {
            const interventionTs = intv.created_at;
            const baselineFrom = interventionTs - BASELINE_DAYS * DAY_MS;
            const baselineTo   = interventionTs;
            const followupFrom = interventionTs;
            const followupTo   = Math.min(nowTs, interventionTs + FOLLOWUP_DAYS * DAY_MS);

            const baseline  = computeWindowMetrics(intv.student_id, baselineFrom, baselineTo);
            const followup  = computeWindowMetrics(intv.student_id, followupFrom, followupTo);

            const clas = classifyOutcome({
                baselineMetrics: baseline,
                followupMetrics: followup,
                baselineEvents: baseline.eventsCount,
                followupEvents: followup.eventsCount,
                interventionType: intv.intervention_type,
            });

            // SAFETY: validar que el explanation NO contiene vocab prohibido.
            // Si lo contuviera (bug del classifier futuro), reemplazamos por
            // un texto safe y log WARN.
            let safeExplanation = clas.explanation;
            if (containsForbiddenVocab(safeExplanation)) {
                log(`[outcomeEngine] FORBIDDEN vocab in explanation (intv=${intv.intervention_id}) — replaced`);
                safeExplanation = 'Outcome observado; ver delta_metrics_json para detalles cuantitativos.';
            }

            rows.push({
                outcome_id: `out_${intv.intervention_id}`,
                intervention_id: intv.intervention_id,
                recommendation_id: intv.recommendation_origin ?? null,
                user_id: intv.student_id,
                scope_type: 'user',
                scope_id:   intv.student_id,
                intervention_type: intv.intervention_type,
                baseline_window_start: baselineFrom,
                baseline_window_end:   baselineTo,
                followup_window_start: followupFrom,
                followup_window_end:   followupTo,
                baseline_metrics_json: JSON.stringify(baseline),
                followup_metrics_json: JSON.stringify(followup),
                delta_metrics_json:    JSON.stringify(clas.delta),
                outcome_label: clas.label,
                confidence:    clas.confidence,
                evidence_level: clas.evidence_level,
                explanation:    safeExplanation,
                notes_json: JSON.stringify({
                    improvements_keys: clas.improvements.map(x => x.key),
                    worsenings_keys:   clas.worsenings.map(x => x.key),
                    stable_keys:       clas.stable.map(x => x.key),
                    skipped_keys:      clas.skipped,
                }),
                created_at: nowTs, updated_at: nowTs,
            });
            result.by_label[clas.label] = (result.by_label[clas.label] || 0) + 1;
            if (typeof clas.confidence === 'number') { confSum += clas.confidence; confN++; }
            try { outcomesComputed.labels(clas.label).inc(); } catch {}
            if (clas.label === OUTCOME_LABELS.insufficient_data) {
                try { outcomeInsufficientData.inc(); } catch {}
            }
            result.processed++;
        }

        // FASE 2: tx outcomes UPSERT.
        const tx = getOutcomesExtDb().transaction(() => {
            for (const r of rows) {
                stmts.upsertOutcome.run(r);
                result.upserted++;
            }
        });
        tx();

        if (confN > 0) {
            result.avg_confidence = +(confSum / confN).toFixed(3);
            try { outcomeConfidenceAvg.set(result.avg_confidence); } catch {}
        }
        result.ok = true;
    } catch (e) {
        result.error = String(e?.message || e);
        log(`[outcomeEngine] error: ${result.error}`);
    }
    result.durationMs = Date.now() - t0;
    return result;
}

/**
 * Rebuild parcial (replay): re-evalúa outcomes para intervenciones en un rango.
 * `force=true` re-procesa intervenciones que ya tienen outcome (UPSERT).
 */
export function rebuildOutcomes(opts = {}) {
    const fromTs = opts.fromTs ?? 0;
    const toTs   = opts.toTs   ?? Date.now();
    const dryRun = !!opts.dryRun;
    const r = { ok: false, scanned: 0, would_upsert: 0, upserted: 0, durationMs: 0 };
    const t0 = Date.now();
    try {
        getOutcomesExtDb();
        getPedagogyExtDb();
        const pedDb = getPedagogyExtDb();
        const targets = pedDb.prepare(
            `SELECT * FROM pedagogical_interventions
             WHERE created_at >= ? AND created_at <= ?
             ORDER BY created_at ASC`
        ).all(fromTs, toTs);
        r.scanned = targets.length;
        if (dryRun) {
            r.would_upsert = targets.length;
            r.ok = true; r.durationMs = Date.now() - t0;
            return r;
        }
        // Reuse runOnce con scopes specific.
        const inner = runOnce({
            nowTs: toTs, force: true, forceRun: true,
            scopes: { interventionIds: targets.map(t => t.intervention_id) },
        });
        r.upserted = inner.upserted;
        r.ok = inner.ok;
        if (inner.error) r.error = inner.error;
    } catch (e) {
        r.error = String(e?.message || e);
    }
    r.durationMs = Date.now() - t0;
    return r;
}

export function getStatus() {
    try {
        getOutcomesExtDb();
        getPedagogyExtDb();
        const stmts = getOutcomesStatements();
        const total = stmts.countOutcomes.get().n;
        const byLabel = Object.fromEntries(stmts.countOutcomesByLabel.all().map(r => [r.outcome_label, r.n]));
        const due = (() => {
            try { return listDueInterventions(Date.now()).length; } catch { return null; }
        })();
        return {
            engine: 'aula_viva_outcome_v1',
            enabled: ENABLED(),
            baseline_days: BASELINE_DAYS, followup_days: FOLLOWUP_DAYS,
            outcomes_total: total,
            outcomes_by_label: byLabel,
            interventions_followup_due: due,
            ok: true,
        };
    } catch (e) {
        return { ok: false, engine: 'aula_viva_outcome_v1', error: String(e?.message || e) };
    }
}
