/**
 * aulaVivaOperationalService.ts — PASO 5.
 *
 * Cliente HTTP para los endpoints /api/aula-viva/* expuestos por
 * server/aulaViva/operationalRouter.mjs.
 *
 * Recovery-first end-to-end:
 *   - timeout 5s por request → AbortController
 *   - cache localStorage por endpoint TTL 5min → soporta offline parcial
 *   - retorna SIEMPRE shape esperado (nunca null sin contexto)
 *   - reporta empty-state / degraded-mode al backend para métricas
 *
 * Auth: header `x-user-id` ya manejado por la capa global (dataService).
 */

const BASE = '/api/aula-viva';
const TIMEOUT_MS = 5_000;
const CACHE_TTL_MS = 5 * 60_000;

const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

function cacheKey(path: string): string { return `chibalete:aulaviva:${path}`; }

function readCache<T>(path: string): { value: T; stale: boolean; age_ms: number } | null {
    if (!isBrowser) return null;
    try {
        const raw = localStorage.getItem(cacheKey(path));
        if (!raw) return null;
        const { value, at } = JSON.parse(raw);
        const age = Date.now() - at;
        return { value, stale: age > CACHE_TTL_MS, age_ms: age };
    } catch { return null; }
}
function writeCache<T>(path: string, value: T): void {
    if (!isBrowser) return;
    try { localStorage.setItem(cacheKey(path), JSON.stringify({ value, at: Date.now() })); }
    catch { /* localStorage full / blocked → ignore */ }
}

function getUserId(): string | null {
    if (!isBrowser) return null;
    try {
        const u = localStorage.getItem('chibalete:auth:user');
        if (!u) return null;
        const parsed = JSON.parse(u);
        return parsed.id || parsed.userId || null;
    } catch { return null; }
}

async function get<T>(path: string, fallback: T): Promise<T & { _meta?: { cached?: boolean; age_ms?: number; stale?: boolean } }> {
    const url = BASE + path;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const userId = getUserId();
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers: userId ? { 'x-user-id': userId } : {},
            signal: ctrl.signal,
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        writeCache(path, body);
        return body as T;
    } catch (e) {
        const cached = readCache<T>(path);
        if (cached) {
            return { ...(cached.value as object),
                     _meta: { cached: true, stale: cached.stale, age_ms: cached.age_ms } } as T & {_meta: object};
        }
        return fallback;
    } finally { clearTimeout(timer); }
}

async function post<T>(path: string, body: unknown): Promise<T | { ok: false; error: string }> {
    const url = BASE + path;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const userId = getUserId();
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json',
                       ...(userId ? { 'x-user-id': userId } : {}) },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        if (!res.ok) {
            const txt = await res.text();
            return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
        }
        return await res.json();
    } catch (e: any) {
        return { ok: false, error: e?.message || 'network_error' };
    } finally { clearTimeout(timer); }
}

async function patch<T>(path: string, body: unknown): Promise<T | { ok: false; error: string }> {
    const url = BASE + path;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    const userId = getUserId();
    try {
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json',
                       ...(userId ? { 'x-user-id': userId } : {}) },
            body: JSON.stringify(body),
            signal: ctrl.signal,
        });
        if (!res.ok) {
            const txt = await res.text();
            return { ok: false, error: `HTTP ${res.status}: ${txt.slice(0, 200)}` };
        }
        return await res.json();
    } catch (e: any) {
        return { ok: false, error: e?.message || 'network_error' };
    } finally { clearTimeout(timer); }
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface AttentionItem {
    user_id: string;
    abandono_risk: number;
    last_active_at: number | null;
    engagement_score: number | null;
    top_severity: 'critical' | 'high' | 'moderate' | 'info' | null;
    recommendations_count: number;
    days_since_active: number | null;
}

export interface RecommendationSummary {
    critical: number; high: number; moderate: number; info: number;
}

export interface Recommendation {
    recommendation_id: string;
    scope_type: string; scope_id: string;
    rule_id: string;
    recommendation_type: string;
    severity: 'critical' | 'high' | 'moderate' | 'info';
    confidence: number;
    created_at: number; expires_at: number;
    acknowledged: number;  // 0/1 from SQLite
    applied: number;
    explanation: {
        rule_id: string;
        rule_version: number;
        signals_used: Array<{ id: string; value: number | null; confidence: string }>;
        reasons: string[];
        explanation: string;
        recommended_action: string;
        vocabulary_class: 'observational';
        deltas?: Record<string, number> | null;
        computed_at: number;
    } | null;
    rule_ids: string[];
}

export interface OperationalStatus {
    ts: number;
    recommendations_summary: RecommendationSummary;
    materializer_ready: { ready: boolean; reason?: string; last_run_age_ms?: number };
    recent_jobs: Array<{ run_id: string; run_type: string; status: string;
                          started_at: number; completed_at?: number;
                          progress_n?: number; progress_total?: number }>;
    degraded: boolean;
}

export interface CohortComparison {
    scope: { type: string; id: string };
    period: string;
    metrics: Array<{
        metric_key: string;
        metric_value: number | null;
        trend: string | null;
        global_value: number | null;
        delta_vs_global: number | null;
    }>;
    global_baseline: Array<{ metric_key: string; metric_value: number | null }>;
}

export interface ProfileTimeline {
    user_id: string;
    profile_current: any | null;
    signals_current: Array<any>;
    risks: Array<any>;
    recommendations: Array<Recommendation>;
    // Fase 3A — summaries determinísticos del backend (vacío si flag OFF).
    summaries?: Array<{
        id: string;
        kind: 'insufficient_data' | 'attention' | 'positive' | 'observation' | 'neutral';
        headline: string;
        evidence: string;
        confidence: 'low' | 'medium' | 'high';
        caveat: string;
        sources: string[];
    }>;
    stale?: boolean;
    reason?: string;
}

// ── API ───────────────────────────────────────────────────────────────────

export const aulaVivaOperationalService = {
    getOperationalStatus: () =>
        get<OperationalStatus>('/operational/status', {
            ts: Date.now(),
            recommendations_summary: { critical: 0, high: 0, moderate: 0, info: 0 },
            materializer_ready: { ready: false, reason: 'unavailable' },
            recent_jobs: [], degraded: true,
        }),

    getAttentionQueue: () =>
        get<AttentionItem[]>('/students-needing-attention', []),

    getStudentTimeline: (userId: string) =>
        get<ProfileTimeline>(`/students/${encodeURIComponent(userId)}/timeline`, {
            user_id: userId, profile_current: null, signals_current: [],
            risks: [], recommendations: [],
        }),

    getRecommendations: (scopeType: string, scopeId: string) =>
        get<Recommendation[]>(`/recommendations/scope/${scopeType}/${encodeURIComponent(scopeId)}`, []),

    getCohortComparison: (scopeType: string, scopeId: string) =>
        get<CohortComparison>(`/cohorts/${scopeType}/${encodeURIComponent(scopeId)}`, {
            scope: { type: scopeType, id: scopeId }, period: '28d',
            metrics: [], global_baseline: [],
        }),

    getCohortRollups: (scopeType: string, scopeId: string) =>
        get<{ daily: any[]; weekly: any[]; monthly: any[] }>(
            `/cohorts/${scopeType}/${encodeURIComponent(scopeId)}/rollups`,
            { daily: [], weekly: [], monthly: [] }
        ),

    acknowledgeRecommendation: (recId: string, applied = false) =>
        post<{ ok: true; acknowledged: boolean; applied: boolean }>(
            `/recommendations/${encodeURIComponent(recId)}/ack`, { applied }
        ),

    dismissRecommendation: (recId: string) =>
        post<{ ok: true; acknowledged: boolean }>(
            `/recommendations/${encodeURIComponent(recId)}/dismiss`, {}
        ),

    recordIntervention: (studentId: string, interventionType: string,
                         notes?: string, recommendationOrigin?: string) =>
        post<{ ok: true; intervention_id: string }>('/interventions', {
            studentId, interventionType, notes, recommendationOrigin,
        }),

    closeIntervention: (id: string, outcome: 'improved' | 'no_change' | 'worsened') =>
        patch<{ ok: true; updated: number }>(
            `/interventions/${encodeURIComponent(id)}/outcome`, { outcome }
        ),

    trackEmptyState: (where: string) =>
        post('/_track/empty-state', { where }).catch(() => {}),

    trackDegradedMode: (reason: string) =>
        post('/_track/degraded-mode', { reason }).catch(() => {}),
};
