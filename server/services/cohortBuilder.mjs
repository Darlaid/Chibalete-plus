/**
 * cohortBuilder.mjs — PASO 6 §11-12.
 *
 * Construye `cohort_definitions` + `cohort_memberships` reales (no solo
 * global). Cohort types soportados HOY:
 *
 *   group:<groupId>          → groups_db.json memberIds[]
 *   school:<schoolId>        → grupos schoolId === X → ∪ memberIds[]
 *   club:<groupId>           → groups con type='club'
 *   intervention:<type>      → distinct student_ids con esa intervention_type
 *   risk:<rule_id>           → users con risk activo de ese tipo
 *   habit:high_continuity    → users con continuidad_semanal ≥ 0.7 actual
 *   trajectory:recovered_after_risk → users con riesgo resolved_at NOT NULL
 *   modality:audio_plus_immersive   → users con eventos en ambos modos
 *
 * Cada cohort_id es estable por `cohort_key` (UNIQUE). Re-build sobre la
 * misma cohort_key → REPLACE memberships (clearCohortMemberships + insert).
 *
 * Recovery-first; scope isolation validado por cohort_type filter.
 * GATING: AULA_VIVA_COHORT_BUILDER_ENABLED=1 (default OFF).
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { getOutcomesExtDb, getOutcomesStatements } from '../db/outcomesDbExt.mjs';
import { getInsightsExtDb } from '../db/insightsDbExt.mjs';
import { getPedagogyExtDb } from '../db/pedagogyDbExt.mjs';
import { cohortsBuilt } from '../observability/metrics.js';

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const GROUPS_DB_PATH = path.resolve(__dirname, '..', '..', 'data', 'groups_db.json');
const EVENTS_PATH = process.env.EVENTS_SQLITE_PATH
    || path.resolve(__dirname, '..', '..', 'data-critical', 'events.db');

export const ENABLED = () => process.env.AULA_VIVA_COHORT_BUILDER_ENABLED === '1';

let _eventsRaw = null;
function getEventsRaw() {
    if (_eventsRaw) return _eventsRaw;
    _eventsRaw = new Database(EVENTS_PATH, { readonly: true, fileMustExist: false });
    _eventsRaw.pragma('busy_timeout = 5000');
    return _eventsRaw;
}
export function closeCohortEventsRaw() {
    if (_eventsRaw) { try { _eventsRaw.close(); } catch {} _eventsRaw = null; }
}

function readGroupsDb() {
    try {
        if (!fs.existsSync(GROUPS_DB_PATH)) return [];
        const raw = fs.readFileSync(GROUPS_DB_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

// ── Resolvers (cohort_type → user_ids[]) ───────────────────────────────────

function resolveGroup(scopeId) {
    const groups = readGroupsDb();
    const g = groups.find(x => x.id === scopeId);
    if (!g) return { users: [], note: 'group_not_found' };
    return { users: Array.isArray(g.memberIds) ? g.memberIds : [],
             note: `group ${g.name || g.id} type=${g.type}` };
}
function resolveSchool(scopeId) {
    const groups = readGroupsDb();
    const set = new Set();
    for (const g of groups) {
        if (g.schoolId === scopeId && Array.isArray(g.memberIds)) {
            for (const u of g.memberIds) set.add(u);
        }
    }
    return { users: [...set], note: `school ${scopeId}` };
}
function resolveClub(scopeId) {
    const groups = readGroupsDb();
    const g = groups.find(x => x.id === scopeId && x.type === 'club');
    if (!g) return { users: [], note: 'club_not_found' };
    return { users: Array.isArray(g.memberIds) ? g.memberIds : [],
             note: `club ${g.name || g.id}` };
}
function resolveIntervention(interventionType) {
    try {
        const pedDb = getPedagogyExtDb();
        const rows = pedDb.prepare(
            `SELECT DISTINCT student_id FROM pedagogical_interventions
             WHERE intervention_type = ?`
        ).all(interventionType);
        return { users: rows.map(r => r.student_id),
                 note: `intervention_type=${interventionType}` };
    } catch { return { users: [], note: 'intervention_query_failed' }; }
}
function resolveRisk(ruleId) {
    try {
        const pedDb = getPedagogyExtDb();
        const rows = pedDb.prepare(
            `SELECT DISTINCT user_id FROM pedagogical_risk_history
             WHERE risk_type = ? AND resolved_at IS NULL`
        ).all(ruleId);
        return { users: rows.map(r => r.user_id),
                 note: `active risk ${ruleId}` };
    } catch { return { users: [], note: 'risk_query_failed' }; }
}
function resolveHabitHighContinuity(threshold = 0.7) {
    try {
        const insDb = getInsightsExtDb();
        const rows = insDb.prepare(
            `SELECT DISTINCT scope_id AS user_id FROM signal_snapshots
             WHERE scope_type='user' AND signal_id='continuidad_semanal'
               AND metric_value >= ?`
        ).all(threshold);
        return { users: rows.map(r => r.user_id),
                 note: `continuidad_semanal >= ${threshold}` };
    } catch { return { users: [], note: 'habit_query_failed' }; }
}
function resolveTrajectoryRecovered() {
    try {
        const pedDb = getPedagogyExtDb();
        const rows = pedDb.prepare(
            `SELECT DISTINCT user_id FROM pedagogical_risk_history
             WHERE resolved_at IS NOT NULL`
        ).all();
        return { users: rows.map(r => r.user_id),
                 note: 'recovered after risk' };
    } catch { return { users: [], note: 'traj_query_failed' }; }
}
function resolveModalityAudioImmersive() {
    try {
        const db = getEventsRaw();
        const rows = db.prepare(
            `SELECT DISTINCT user_id FROM events
             WHERE user_id IN (
               SELECT DISTINCT user_id FROM events WHERE mode='immersive')
               AND user_id IN (
                 SELECT DISTINCT user_id FROM events
                 WHERE event='audio_started' OR event='tts_started' OR mode='audio')`
        ).all();
        return { users: rows.map(r => r.user_id), note: 'audio + immersive' };
    } catch { return { users: [], note: 'modality_query_failed' }; }
}

const RESOLVERS = {
    group:        (id, _crit) => resolveGroup(id),
    school:       (id, _crit) => resolveSchool(id),
    club:         (id, _crit) => resolveClub(id),
    intervention: (id, _crit) => resolveIntervention(id),
    risk:         (id, _crit) => resolveRisk(id),
    habit:        (_id, crit) => resolveHabitHighContinuity(crit?.threshold ?? 0.7),
    trajectory:   (_id, _crit) => resolveTrajectoryRecovered(),
    modality:     (_id, _crit) => resolveModalityAudioImmersive(),
    library:      (id, _crit) => ({ users: [], note: `library scope ${id} no implementado en PASO 6` }),
};

// ── API ────────────────────────────────────────────────────────────────────

/**
 * Construye (o re-construye) UNA cohorte.
 * @param {{cohort_type, scope_id, criteria?, nowTs?}} args
 */
export function buildCohort({ cohort_type, scope_id, criteria = null, nowTs = Date.now() }) {
    if (!RESOLVERS[cohort_type]) {
        return { ok: false, error: `unknown_cohort_type:${cohort_type}` };
    }
    try {
        const cohort_key = `${cohort_type}:${scope_id}`;
        const cohort_id  = `coh_${cohort_key}_v1`;
        const { users, note } = RESOLVERS[cohort_type](scope_id, criteria);
        const distinct = [...new Set((users || []).filter(Boolean).map(String))];

        getOutcomesExtDb();
        const stmts = getOutcomesStatements();
        const tx = getOutcomesExtDb().transaction(() => {
            stmts.upsertCohortDef.run({
                cohort_id, cohort_key, cohort_type,
                scope_type: cohort_type, scope_id: String(scope_id),
                criteria_json: JSON.stringify(criteria ?? {}),
                version: 1,
                created_at: nowTs, updated_at: nowTs,
            });
            // Re-build idempotente: limpia y vuelve a insertar.
            stmts.clearCohortMemberships.run(cohort_id);
            for (const userId of distinct) {
                stmts.insertCohortMembership.run({
                    cohort_id, user_id: String(userId), joined_at: nowTs,
                    membership_reason_json: JSON.stringify({ resolver_note: note }),
                });
            }
        });
        tx();
        try { cohortsBuilt.labels(cohort_type).inc(); } catch {}
        return { ok: true, cohort_id, cohort_key, cohort_type, members: distinct.length, note };
    } catch (e) {
        return { ok: false, error: String(e?.message || e) };
    }
}

/**
 * Construye cohortes "estándar" (todas las que el sistema sabe inferir).
 * Útil para el scheduler loop.
 */
export function runOnce(opts = {}) {
    const t0 = Date.now();
    const log = opts.log || (() => {});
    const nowTs = opts.nowTs ?? Date.now();
    const result = { ok: false, built: 0, by_type: {}, durationMs: 0 };
    if (!opts.forceRun && !ENABLED()) {
        return { ...result, ok: true, skipped: true, reason: 'disabled_default_off' };
    }
    try {
        getOutcomesExtDb();
        const targets = [];

        // 1. Todos los groups (incluye type='club')
        for (const g of readGroupsDb()) {
            if (!g?.id) continue;
            targets.push({ cohort_type: g.type === 'club' ? 'club' : 'group',
                           scope_id: g.id });
            if (g.schoolId) targets.push({ cohort_type: 'school', scope_id: g.schoolId });
        }
        // 2. Cohortes derivadas globales
        targets.push({ cohort_type: 'habit', scope_id: 'high_continuity' });
        targets.push({ cohort_type: 'trajectory', scope_id: 'recovered_after_risk' });
        targets.push({ cohort_type: 'modality', scope_id: 'audio_plus_immersive' });

        // 3. Cohortes por intervention_type observados
        try {
            const pedDb = getPedagogyExtDb();
            const types = pedDb.prepare(
                `SELECT DISTINCT intervention_type FROM pedagogical_interventions`
            ).all();
            for (const t of types) {
                targets.push({ cohort_type: 'intervention', scope_id: t.intervention_type });
            }
            const risks = pedDb.prepare(
                `SELECT DISTINCT risk_type FROM pedagogical_risk_history WHERE resolved_at IS NULL`
            ).all();
            for (const r of risks) {
                targets.push({ cohort_type: 'risk', scope_id: r.risk_type });
            }
        } catch { /* sin pedagogy, skip */ }

        // Dedupe (mismo scope/type sólo una vez por corrida)
        const seen = new Set();
        for (const t of targets) {
            const k = `${t.cohort_type}:${t.scope_id}`;
            if (seen.has(k)) continue;
            seen.add(k);
            const r = buildCohort({ ...t, nowTs });
            if (r.ok) {
                result.built++;
                result.by_type[t.cohort_type] = (result.by_type[t.cohort_type] || 0) + 1;
            } else {
                log(`[cohortBuilder] ${k}: ${r.error}`);
            }
        }
        result.ok = true;
    } catch (e) {
        result.error = String(e?.message || e);
    }
    result.durationMs = Date.now() - t0;
    return result;
}

export function getStatus() {
    try {
        getOutcomesExtDb();
        const stmts = getOutcomesStatements();
        return {
            engine: 'aula_viva_cohort_builder_v1',
            enabled: ENABLED(),
            cohorts_active: stmts.countCohorts.get().n,
            memberships_total: stmts.countCohortMemberships.get().n,
            ok: true,
        };
    } catch (e) { return { ok: false, engine: 'aula_viva_cohort_builder_v1', error: String(e?.message || e) }; }
}
