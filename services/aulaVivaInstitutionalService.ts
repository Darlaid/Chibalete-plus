/**
 * aulaVivaInstitutionalService.ts — PASO 7 cliente HTTP.
 *
 * Mismo patrón que aulaVivaOperationalService.ts (PASO 5):
 *   - timeout 5s + AbortController
 *   - cache localStorage TTL 5min
 *   - recovery-first: nunca lanza; siempre retorna shape esperado
 *
 * Cubre los 13 endpoints /api/aula-viva/institutional/* PASO 7.
 */

const BASE = '/api/aula-viva/institutional';
const TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60_000;

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

function cacheKey(path: string): string { return `chibalete:aulaviva7:${path}`; }
function readCache<T>(path: string): { value: T; stale: boolean; age_ms: number } | null {
    if (!isBrowser) return null;
    try {
        const raw = localStorage.getItem(cacheKey(path));
        if (!raw) return null;
        const { value, at } = JSON.parse(raw);
        return { value, stale: Date.now() - at > CACHE_TTL_MS, age_ms: Date.now() - at };
    } catch { return null; }
}
function writeCache<T>(path: string, value: T): void {
    if (!isBrowser) return;
    try { localStorage.setItem(cacheKey(path), JSON.stringify({ value, at: Date.now() })); }
    catch { /* lleno → ignore */ }
}
function getUserId(): string | null {
    if (!isBrowser) return null;
    try {
        const u = localStorage.getItem('chibalete:auth:user');
        if (!u) return null;
        const p = JSON.parse(u);
        return p.id || p.userId || null;
    } catch { return null; }
}

async function get<T>(path: string, fallback: T): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const userId = getUserId();
    try {
        const res = await fetch(BASE + path, {
            method: 'GET',
            headers:{},
            signal: ctrl.signal,
        });
        if (!res.ok) {
            // 403 (scope_access_denied) lo dejamos pasar como fallback — la UI
            // muestra empty state "sin permisos" sin romper la pantalla.
            if (res.status === 403) return fallback;
            throw new Error(`HTTP ${res.status}`);
        }
        const body = await res.json();
        writeCache(path, body);
        return body as T;
    } catch (e) {
        const cached = readCache<T>(path);
        if (cached) return cached.value;
        return fallback;
    } finally { clearTimeout(timer); }
}

async function post<T>(path: string, body: unknown): Promise<T | { ok: false; error: string }> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const userId = getUserId();
    try {
        const res = await fetch(BASE + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body), signal: ctrl.signal,
        });
        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
        return await res.json();
    } catch (e: any) {
        return { ok: false, error: e?.message || 'network_error' };
    } finally { clearTimeout(timer); }
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface InstitutionalStatus {
    ts: number;
    outcomes: { total: number; by_label: Record<string, number> };
    cohorts: { total_active: number; total_memberships: number };
    trajectories: { total: number };
    learnings: { total_active: number };
    patterns: { total_active: number };
}

export interface OutcomeByType {
    intervention_type: string;
    total: number;
    distribution: Record<string, number>;
}

export interface CohortDefinition {
    cohort_id: string; cohort_key: string; cohort_type: string;
    scope_type: string; scope_id: string; criteria_json: string;
    version: number; active: number;
    created_at: number; updated_at: number;
}

export interface CohortTrajectoryPoint {
    period_start: number; period_end: number;
    metrics: Record<string, number | null>;
    trend: Record<string, 'up' | 'down' | 'flat' | null>;
    confidence: number | null;
    sample_size: number;
    created_at: number;
}

export interface InstitutionalLearning {
    learning_id: string;
    scope_type: string; scope_id: string;
    learning_type: string;
    recommendation_hint: string;
    confidence: number;
    evidence: {
        support_count: number;
        outcome_distribution: Record<string, number>;
        intervention_type?: string;
        min_support_threshold?: number;
    };
    version: number; active: number;
    created_at: number; updated_at: number;
}

export interface ComparativeStrategies {
    strategies: Array<{
        intervention_type: string;
        improved: number; stable: number; worsened: number;
        mixed: number; insufficient_data: number;
        total: number;
        improved_ratio: number | null;
        note: string;
    }>;
    vocabulary_class: 'observational';
    caveat: string;
}

// ── API ───────────────────────────────────────────────────────────────────

export const aulaVivaInstitutionalService = {
    getStatus: () => get<InstitutionalStatus>('/status', {
        ts: Date.now(),
        outcomes: { total: 0, by_label: {} },
        cohorts: { total_active: 0, total_memberships: 0 },
        trajectories: { total: 0 },
        learnings: { total_active: 0 },
        patterns: { total_active: 0 },
    }),

    getOutcomesByType: (type: string) =>
        get<OutcomeByType>(`/outcomes/by-type/${encodeURIComponent(type)}`,
            { intervention_type: type, total: 0, distribution: {} }),

    getOutcomesScope: (scope_type: string, scope_id: string) =>
        get<{ scope: any; total_outcomes: number; distribution: Record<string, number>;
              outcomes: Array<any> }>(
            `/outcomes/scope/${scope_type}/${encodeURIComponent(scope_id)}`,
            { scope: { type: scope_type, id: scope_id }, total_outcomes: 0,
              distribution: {}, outcomes: [] }),

    getFollowupQueue: () =>
        get<Array<any>>('/outcomes/follow-up-queue', []),

    getCohortDefinitions: () => get<CohortDefinition[]>('/cohorts/definitions', []),

    getCohortsByType: (type: string) =>
        get<CohortDefinition[]>(`/cohorts/by-type/${encodeURIComponent(type)}`, []),

    getCohortMembers: (cohortId: string) =>
        get<{ cohort_id: string; cohort_key: string; cohort_type: string;
              members_count: number; members: Array<any> }>(
            `/cohorts/${encodeURIComponent(cohortId)}/members`,
            { cohort_id: cohortId, cohort_key: '', cohort_type: '',
              members_count: 0, members: [] }),

    getCohortTrajectory: (cohortId: string, period = '28d') =>
        get<{ cohort_id: string; period: string; series: CohortTrajectoryPoint[] }>(
            `/cohorts/${encodeURIComponent(cohortId)}/trajectory?period=${encodeURIComponent(period)}`,
            { cohort_id: cohortId, period, series: [] }),

    getLearningsGlobal: () => get<InstitutionalLearning[]>('/learnings/global', []),

    getLearningsScope: (scope_type: string, scope_id: string) =>
        get<InstitutionalLearning[]>(
            `/learnings/scope/${scope_type}/${encodeURIComponent(scope_id)}`, []),

    getPatternsRecent: () => get<Array<any>>('/patterns/recent', []),

    getComparativeStrategies: () => get<ComparativeStrategies>('/comparative/strategies', {
        strategies: [], vocabulary_class: 'observational', caveat: 'no_data_yet',
    }),

    getProfile: (userId: string) =>
        get<{ user_id: string; timeline: any; feature_vector: any; impact_history: any }>(
            `/profile/${encodeURIComponent(userId)}`,
            { user_id: userId, timeline: null, feature_vector: null, impact_history: null }),

    trackScopeSwitch: (to: string) =>
        post('/_track/scope-switch', { to }).catch(() => {}),

    trackUiLatency: (where: string, ms: number) =>
        post('/_track/ui-latency', { where, ms }).catch(() => {}),
};
