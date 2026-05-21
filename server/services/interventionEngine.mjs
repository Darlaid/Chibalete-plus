/**
 * interventionEngine.mjs — Aula Viva PASO 3.
 *
 * Orquesta el motor de intervención pedagógica:
 *   1. lee user_reading_profiles + signal_snapshots (read model PASO 2)
 *   2. (opcional) carga snapshot previo para reglas longitudinales
 *   3. evalúa pedagogicalRules.evaluateAllRules
 *   4. persiste/actualiza pedagogical_recommendations
 *   5. registra riesgos en pedagogical_risk_history (append-only longitudinal)
 *   6. agrega cohort 'at_risk_users' y 'avg_continuidad' a cohort_rollups
 *
 * GATING (default-OFF):
 *   INTERVENTION_ENGINE_ENABLED=1  → runOnce activo
 *
 * Recovery-first: nunca lanza al caller. Cualquier fallo se refleja en
 * `result.error` + métrica `recommendations_generated{result:'error'}`.
 * Las inserciones de risk_history van fuera de la tx (cross-handle).
 */
import { getInsightsExtDb, getStatements as getInsightsStmts } from '../db/insightsDbExt.mjs';
import { getPedagogyExtDb, getPedagogyStatements } from '../db/pedagogyDbExt.mjs';
import {
    evaluateAllRules, isValidRuleResult, RULES_ENGINE_VERSION,
    RECOMMENDATION_TTL_MS, RULE_IDS,
} from '../pedagogy/pedagogicalRules.js';
import {
    recommendationsGenerated, interventionsCreated, riskFlagsActive,
    rulesTriggered, recommendationConfidenceAvg, teacherAcknowledged,
} from '../observability/metrics.js';

const ENGINE_NAME = 'aula_viva_intervention_v1';

export const ENABLED = () => process.env.INTERVENTION_ENGINE_ENABLED === '1';

// ── helpers ─────────────────────────────────────────────────────────────────

function now() { return Date.now(); }

/**
 * Lee perfiles candidatos. Si `scopes.userIds` está presente, sólo esos.
 * Caso global: todos los profiles materializados.
 */
function readCandidateProfiles(scopes) {
    const db = getInsightsExtDb();
    if (scopes?.userIds && Array.isArray(scopes.userIds) && scopes.userIds.length) {
        const placeholders = scopes.userIds.map(() => '?').join(',');
        return db.prepare(
            `SELECT * FROM user_reading_profiles WHERE user_id IN (${placeholders})`
        ).all(...scopes.userIds.map(String));
    }
    return db.prepare(`SELECT * FROM user_reading_profiles ORDER BY updated_at DESC LIMIT 10000`).all();
}

/**
 * Snapshots actuales (period='28d') para un user.
 */
function readUserSnapshots(userId, period = '28d') {
    const db = getInsightsExtDb();
    return db.prepare(
        `SELECT * FROM signal_snapshots WHERE scope_type='user' AND scope_id = ? AND period = ?`
    ).all(String(userId), period);
}

/**
 * Snapshot previo: mismo user, mismas señales, snapshot anterior a `updated_at - 7d`
 * — usamos el snapshot más reciente cuyo `updated_at < (snapActualMinUpdated - 7d)`.
 * En PASO 3 NO mantenemos historia de snapshots (los upserts machacan), entonces
 * comparamos vs el `updated_at` del profile previo. Si futuro PASO 4 introduce
 * snapshot history, este helper cambia su query sin tocar pedagogicalRules.
 *
 * En esta implementación inicial: si `previousProfileUpdatedAt` < now - 7d
 * (es decir, hay datos antiguos en el row del profile), reconstruimos un
 * "previousSnapshots" mínimo desde el propio profile row.
 *
 * Devuelve null si no hay historia útil.
 */
function buildPreviousContext(profile, nowTs) {
    if (!profile || !profile.updated_at) return { previousProfile: null, previousSnapshots: null };
    const ageMs = nowTs - profile.updated_at;
    // Si el profile actual fue creado hace <1h y NO hay historia previa real,
    // no podemos comparar — `deterioro_continuidad` no se activará.
    if (ageMs < 3600_000) return { previousProfile: null, previousSnapshots: null };
    // El profile actual TIENE valores; pero por diseño machacante, NO tenemos
    // snapshots de hace 7d. Devolvemos previousProfile = una copia "estable"
    // del profile *almacenado* (que precede al runOnce en curso). En tests se
    // inyecta previousProfile explícitamente vía evaluateAllRules.
    return { previousProfile: { ...profile }, previousSnapshots: null };
}

/**
 * Persiste una recomendación (idempotente por scope+rule activo).
 * Si ya existe una activa para (scope, rule_id), refresca confidence/severity/expires.
 * Si no existe, inserta.
 * Retorna 'inserted' | 'refreshed' | 'noop'.
 */
function persistRecommendation({ result, profile, nowTs, sourceWatermark }) {
    const stmts = getPedagogyStatements();
    const recommendationId = `rec_${result.rule_id}_user_${profile.user_id}_${nowTs}`;
    const explanation = {
        rule_id: result.rule_id,
        rule_version: result.rule_version ?? RULES_ENGINE_VERSION,
        signals_used: result.signals_used,
        reasons: result.reasons,
        explanation: result.explanation,
        recommended_action: result.recommendation_type,
        vocabulary_class: result.vocabulary_class,
        deltas: result.deltas ?? null,
        computed_at: nowTs,
    };
    const row = {
        recommendation_id: recommendationId,
        scope_type: 'user',
        scope_id: String(profile.user_id),
        rule_id: result.rule_id,
        recommendation_type: result.recommendation_type,
        severity: result.severity,
        confidence: result.confidence,
        created_at: nowTs,
        expires_at: nowTs + RECOMMENDATION_TTL_MS,
        explanation_json: JSON.stringify(explanation),
        rule_ids_json: JSON.stringify([result.rule_id]),
        source_watermark: sourceWatermark ?? 0,
    };
    // INSERT (no-op si ya hay una activa por unique index parcial).
    const ins = stmts.insertIfNoActive.run(row);
    if (ins.changes > 0) return 'inserted';
    // Existe una activa — refrescar (severity puede haber cambiado, expires_at se renueva).
    const upd = stmts.updateActiveRecommendation.run(row);
    return upd.changes > 0 ? 'refreshed' : 'noop';
}

/**
 * Registra riesgo en historial (append-only) — si ya hay riesgo activo del
 * mismo tipo para el mismo user, no duplica (INSERT OR IGNORE por risk_id).
 * Severidades 'high' y 'critical' generan entry; 'moderate' opcional.
 */
function persistRiskIfNew({ profile, result, nowTs }) {
    if (result.severity !== 'high' && result.severity !== 'critical') return 'skipped';
    const stmts = getPedagogyStatements();
    const has = stmts.hasActiveRisk.get(String(profile.user_id), result.rule_id);
    if (has) return 'already_active';
    const riskId = `risk_${result.rule_id}_user_${profile.user_id}_${nowTs}`;
    const sourceSignals = {};
    for (const s of (result.signals_used || [])) {
        if (s && s.id) sourceSignals[s.id] = s.value ?? null;
    }
    stmts.insertRisk.run({
        risk_id: riskId,
        user_id: String(profile.user_id),
        risk_type: result.rule_id,
        severity: result.severity,
        detected_at: nowTs,
        source_signals_json: JSON.stringify(sourceSignals),
    });
    return 'inserted';
}

/**
 * Resuelve automáticamente riesgos cuyo perfil ya NO los cumple (ej:
 * abandono_alto desactivado porque continuidad subió). Esto cierra el ciclo
 * longitudinal: el motor mismo detecta recuperación.
 */
function autoResolveRisks({ profile, triggeredRuleIds, nowTs }) {
    const stmts = getPedagogyStatements();
    const active = getPedagogyExtDb().prepare(
        `SELECT risk_type FROM pedagogical_risk_history WHERE user_id = ? AND resolved_at IS NULL`
    ).all(String(profile.user_id));
    let resolved = 0;
    for (const r of active) {
        // Si la regla NO se disparó en este run pero el riesgo seguía activo → resolved.
        if (!triggeredRuleIds.has(r.risk_type)) {
            const res = stmts.resolveRisk.run({
                user_id: String(profile.user_id),
                risk_type: r.risk_type,
                ts: nowTs,
            });
            if (res.changes > 0) resolved++;
        }
    }
    return resolved;
}

// ── API pública ────────────────────────────────────────────────────────────

/**
 * Ejecuta una pasada del motor.
 * @param {{nowTs?:number, scopes?:{userIds?:string[]}, log?:(m:string)=>void,
 *          forceRun?:boolean}} [opts]
 * @returns {{ok:boolean, skipped?:boolean, reason?:string,
 *           profilesProcessed:number, recommendations:{inserted:number, refreshed:number, noop:number},
 *           risks:{inserted:number, already_active:number, resolved:number, skipped:number},
 *           rulesTriggered:Object<string,number>, atRiskUsers:number,
 *           avgContinuidad:number|null, durationMs:number, error?:string}}
 */
export function runOnce(opts = {}) {
    const t0 = Date.now();
    const nowTs = opts.nowTs ?? now();
    const log = opts.log || (() => {});
    const result = {
        ok: false, profilesProcessed: 0,
        recommendations: { inserted: 0, refreshed: 0, noop: 0 },
        risks: { inserted: 0, already_active: 0, resolved: 0, skipped: 0 },
        rulesTriggered: Object.fromEntries(RULE_IDS.map(id => [id, 0])),
        atRiskUsers: 0, avgContinuidad: null, durationMs: 0,
    };
    if (!opts.forceRun && !ENABLED()) {
        return { ...result, ok: true, skipped: true, reason: 'disabled_default_off' };
    }
    try {
        getInsightsExtDb();
        getPedagogyExtDb();
        const profiles = readCandidateProfiles(opts.scopes);
        // Acumular fuera de la tx: las inserciones risk_history van post-commit
        // (cross-handle safe) y las cohort updates son no-críticas.
        const pendingRisks = [];
        let continuidadSum = 0, continuidadN = 0, atRisk = 0;
        let confSum = 0, confN = 0;

        // ── FASE 1 (compute puro, sin writes) ──────────────────────────────
        // Pre-leemos snapshots + evaluamos reglas SIN abrir tx. Esto evita
        // mezclar reads (insights handle) con writes (pedagogy handle) bajo
        // un mismo write-lock — la lección PASO 2 §8b: 1 writer concurrente
        // por archivo en SQLite WAL.
        const work = [];
        for (const profile of profiles) {
            if (!profile || !profile.user_id) continue;
            const snapshots = readUserSnapshots(profile.user_id);
            const { previousProfile, previousSnapshots } = buildPreviousContext(profile, nowTs);
            const triggered = evaluateAllRules({
                profile, snapshots, previousProfile, previousSnapshots, nowTs,
            });
            work.push({ profile, snapshots, triggered });

            // Métricas operacionales para cohort (ya disponible sin tx).
            if (typeof profile.abandono_risk === 'number' && profile.abandono_risk >= 0.7) atRisk++;
            const cs = snapshots.find(s => s.signal_id === 'continuidad_semanal');
            if (cs && typeof cs.metric_value === 'number') {
                continuidadSum += cs.metric_value; continuidadN++;
            }
            result.profilesProcessed++;
        }

        // ── FASE 2 (pedagogy tx: recommendations + auto-resolve risks) ─────
        // Todos los writes sobre pedagogical_* van por el handle pedagogyDb.
        const pedTx = getPedagogyExtDb().transaction(() => {
            for (const { profile, triggered } of work) {
                const triggeredIds = new Set(triggered.map(t => t.rule_id));
                for (const t of triggered) {
                    if (!isValidRuleResult(t)) continue;
                    const action = persistRecommendation({
                        result: t, profile, nowTs, sourceWatermark: profile.source_watermark ?? 0,
                    });
                    result.recommendations[action]++;
                    result.rulesTriggered[t.rule_id] = (result.rulesTriggered[t.rule_id] || 0) + 1;
                    if (t.severity === 'high' || t.severity === 'critical') {
                        pendingRisks.push({ profile, result: t });
                    }
                    confSum += t.confidence; confN++;
                    try { rulesTriggered.labels(t.rule_id, t.severity).inc(); } catch {}
                }
                result.risks.resolved += autoResolveRisks({
                    profile, triggeredRuleIds: triggeredIds, nowTs,
                });
            }
        });
        pedTx();

        // ── FASE 3 (pedagogy POST-COMMIT: risk_history inserts) ────────────
        // pendingRisks usa el MISMO handle pedagogyDb (no cross-handle), pero
        // intencionalmente fuera de la tx para que un error en un insert no
        // tumbe el lote de recomendaciones ya commiteado.
        for (const { profile, result: t } of pendingRisks) {
            try {
                const action = persistRiskIfNew({ profile, result: t, nowTs });
                if (action === 'inserted') result.risks.inserted++;
                else if (action === 'already_active') result.risks.already_active++;
                else if (action === 'skipped') result.risks.skipped++;
            } catch (e) {
                log(`[interventionEngine] risk persist failed user=${profile.user_id} type=${t.rule_id}: ${e.message}`);
            }
        }

        // ── FASE 4 (insights tx: cohort_rollups — handle diferente al de pedagogy) ─
        // Ahora la tx pedagogyDb está cerrada → el lock del archivo está libre
        // para que insightsDbExt abra su propia tx sin SQLITE_BUSY.
        const insTx = getInsightsExtDb().transaction(() => {
            const insightsStmts = getInsightsStmts();
            insightsStmts.upsertCohort.run({
                scope_type: 'all', scope_id: 'global', period: '28d',
                metric_key: 'at_risk_users', metric_value: atRisk,
                trend: null, updated_at: nowTs, source_watermark: 0,
            });
            if (continuidadN > 0) {
                insightsStmts.upsertCohort.run({
                    scope_type: 'all', scope_id: 'global', period: '28d',
                    metric_key: 'avg_continuidad', metric_value: continuidadSum / continuidadN,
                    trend: null, updated_at: nowTs, source_watermark: 0,
                });
            }
            insightsStmts.upsertCohort.run({
                scope_type: 'all', scope_id: 'global', period: '28d',
                metric_key: 'profiles_evaluated', metric_value: result.profilesProcessed,
                trend: null, updated_at: nowTs, source_watermark: 0,
            });
        });
        insTx();

        result.atRiskUsers   = atRisk;
        result.avgContinuidad = continuidadN > 0 ? +(continuidadSum / continuidadN).toFixed(3) : null;
        result.ok = true;

        // Métricas finales
        try {
            recommendationsGenerated.labels('ok').inc(
                result.recommendations.inserted + result.recommendations.refreshed
            );
            if (confN > 0) recommendationConfidenceAvg.set(confSum / confN);
            riskFlagsActive.set(getPedagogyStatements().countActiveRisks.get().n);
        } catch {}
    } catch (e) {
        result.error = String(e?.message || e);
        log(`[interventionEngine] runOnce error: ${result.error}`);
        try { recommendationsGenerated.labels('error').inc(); } catch {}
    }
    result.durationMs = Date.now() - t0;
    return result;
}

/**
 * Registra una intervención del docente (CRUD futuro en PASO 4; hoy expuesto
 * para tests y uso programático). Persistencia simple en pedagogical_interventions.
 */
export function recordIntervention({ teacherId, studentId, interventionType,
                                     notes = null, recommendationOrigin = null,
                                     outcome = 'pending', nowTs = now() }) {
    if (!studentId || !interventionType) {
        return { ok: false, error: 'studentId+interventionType required' };
    }
    try {
        getPedagogyExtDb();
        const id = `intvn_${interventionType}_${studentId}_${nowTs}`;
        getPedagogyStatements().insertIntervention.run({
            intervention_id: id,
            teacher_id: teacherId ?? null,
            student_id: String(studentId),
            intervention_type: String(interventionType),
            created_at: nowTs,
            notes,
            recommendation_origin: recommendationOrigin,
            outcome,
            outcome_at: outcome !== 'pending' ? nowTs : null,
        });
        try { interventionsCreated.labels(interventionType).inc(); } catch {}
        return { ok: true, intervention_id: id };
    } catch (e) {
        return { ok: false, error: String(e?.message || e) };
    }
}

/** Marca una recomendación como vista/aplicada por el docente. */
export function acknowledgeRecommendation({ recommendationId, by = null, applied = false, nowTs = now() }) {
    try {
        getPedagogyExtDb();
        const stmts = getPedagogyStatements();
        const ack = stmts.ackRecommendation.run({ recommendation_id: recommendationId, ts: nowTs, by });
        if (applied) stmts.applyRecommendation.run({ recommendation_id: recommendationId, ts: nowTs });
        if (ack.changes > 0) { try { teacherAcknowledged.inc(); } catch {} }
        return { ok: true, acknowledged: ack.changes > 0, applied };
    } catch (e) {
        return { ok: false, error: String(e?.message || e) };
    }
}

/** Status para /api/health/analytics. */
export function getStatus() {
    try {
        getPedagogyExtDb();
        const stmts = getPedagogyStatements();
        const totalRecs = stmts.countAll.get().n;
        const activeRecs = stmts.countActive.get().n;
        const activeRisks = stmts.countActiveRisks.get().n;
        const interventions = stmts.countInterventions.get().n;
        const bySev = stmts.countActiveBySeverity.all();
        const stale = countStaleProfiles();
        return {
            engine: ENGINE_NAME,
            enabled: ENABLED(),
            recommendations_total: totalRecs,
            recommendations_active: activeRecs,
            recommendations_active_by_severity: Object.fromEntries(bySev.map(r => [r.severity, r.n])),
            recommendation_backlog: activeRecs,
            risk_flags_active: activeRisks,
            interventions_recorded: interventions,
            rules_engine_version: RULES_ENGINE_VERSION,
            rules_engine_status: 'ok',
            stale_profiles: stale,
            degraded_reason: null,
            ok: true,
        };
    } catch (e) {
        return { ok: false, engine: ENGINE_NAME, error: String(e?.message || e) };
    }
}

/** Cuenta perfiles con updated_at más viejo que 7d — útil para healthcheck. */
function countStaleProfiles() {
    try {
        const cutoff = Date.now() - 7 * 86_400_000;
        return getInsightsExtDb().prepare(
            `SELECT COUNT(*) AS n FROM user_reading_profiles WHERE updated_at < ?`
        ).get(cutoff).n;
    } catch { return null; }
}
