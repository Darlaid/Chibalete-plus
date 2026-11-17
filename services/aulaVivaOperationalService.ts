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

// V9 F5-E2 — la copia local es de QUIEN la guardó. Antes no llevaba dueño ni se borraba al cerrar
// sesión: en un equipo compartido, la siguiente persona (de otro grupo o institución) podía ver las
// cifras de la anterior cuando una consulta fallaba. Una copia sin dueño, o de otra cuenta, no se usa.
function readCache<T>(path: string): { value: T; stale: boolean; age_ms: number } | null {
    if (!isBrowser) return null;
    try {
        const raw = localStorage.getItem(cacheKey(path));
        if (!raw) return null;
        const { value, at, owner } = JSON.parse(raw);
        const me = getUserId();
        if (!me || owner !== me) { localStorage.removeItem(cacheKey(path)); return null; }
        const age = Date.now() - at;
        return { value, stale: age > CACHE_TTL_MS, age_ms: age };
    } catch { return null; }
}
function writeCache<T>(path: string, value: T): void {
    if (!isBrowser) return;
    const owner = getUserId();
    if (!owner) return;
    try { localStorage.setItem(cacheKey(path), JSON.stringify({ value, at: Date.now(), owner })); }
    catch { /* localStorage full / blocked → ignore */ }
}
function dropCache(path: string): void {
    if (!isBrowser) return;
    try { localStorage.removeItem(cacheKey(path)); } catch { /* ignore */ }
}

function getUserId(): string | null {
    if (!isBrowser) return null;
    try {
        // La sesión es la cookie; este id local (AuthContext lo guarda en sessionStorage o, con
        // «Recordarme», en localStorage) solo etiqueta de quién es la copia guardada.
        const id = sessionStorage.getItem('chibalete_user_id') || localStorage.getItem('chibalete_user_id');
        return id && id.trim() ? id : null;
    } catch { return null; }
}

/**
 * V9 F5-E2 — cómo llegó un resultado. `failed`: la consulta no respondió y lo devuelto es la forma
 * vacía de relleno (NO «no hay nada»). `cached`: copia guardada por esta misma cuenta, usada solo
 * cuando no hubo respuesta del servidor (sin conexión).
 */
export interface FetchMeta { cached?: boolean; stale?: boolean; age_ms?: number; failed?: boolean; status?: number }
export function fetchMetaOf(value: unknown): FetchMeta {
    return (value && typeof value === 'object' && (value as { _meta?: FetchMeta })._meta) || {};
}
/** Adjunta `_meta` conservando la forma: una lista sigue siendo una lista. */
export function withMeta<T>(value: T, meta: FetchMeta): T & { _meta: FetchMeta } {
    const out = Array.isArray(value) ? [...value] : { ...(value as object) };
    Object.defineProperty(out, '_meta', { value: meta, enumerable: false });
    return out as T & { _meta: FetchMeta };
}
/**
 * Frase para una consulta que no respondió. Distingue lo que el servidor negó (403) de lo que no
 * pudo atender ahora (503/5xx) y de la falta de respuesta (sin conexión).
 */
export function describeFetchFailure(m: FetchMeta, retryLabel = 'Actualizar'): string {
    return m.status === 403 ? 'Esta consulta no está habilitada para tu cuenta.'
        : m.status === 401 ? 'Tu sesión terminó. Vuelve a iniciar sesión.'
        : m.status && m.status >= 500 ? `El servicio no está disponible en este momento (interrupción temporal). Inténtalo de nuevo con «${retryLabel}».`
        : `No hubo respuesta del servidor. Revisa la conexión e inténtalo de nuevo con «${retryLabel}».`;
}

async function get<T>(path: string, fallback: T): Promise<T & { _meta?: FetchMeta }> {
    const url = BASE + path;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let httpStatus = 0;
    try {
        const res = await fetch(url, {
            method: 'GET',
            headers:{},
            signal: ctrl.signal,
        });
        if (!res.ok) { httpStatus = res.status; throw new Error(`HTTP ${res.status}`); }
        const body = await res.json();
        writeCache(path, body);
        return body as T;
    } catch (e) {
        // V9 F5-E2 — el servidor RESPONDIÓ que no (403) o que ahora no puede (503, 5xx): una copia
        // anterior no lo desmiente y no se muestra. Con 401/403 además se descarta.
        if (httpStatus) {
            if (httpStatus === 401 || httpStatus === 403) dropCache(path);
            return withMeta(fallback, { failed: true, status: httpStatus });
        }
        // Sin respuesta (sin conexión, tiempo agotado): la copia de ESTA cuenta, marcada como tal.
        const cached = readCache<T>(path);
        if (cached) return withMeta(cached.value, { cached: true, stale: cached.stale, age_ms: cached.age_ms });
        return withMeta(fallback, { failed: true, status: 0 });
    } finally { clearTimeout(timer); }
}

async function post<T>(path: string, body: unknown): Promise<T | { ok: false; error: string }> {
    const url = BASE + path;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
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
    try {
        const res = await fetch(url, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
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
    // V9 F7-C2R-U2 — solo para quien media: cuántos de sus lectores están en cada situación (recuentos, sin nombres).
    // `in_attention` = con un riesgo calculable (los que entran en la cola).
    context_overview?: { readers: number; ok: number; no_activity: number; insufficient: number; no_course_works: number; in_attention: number };
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

// CHP-AULA-VIVA-MOOK-INTEGRATION-01A — proyección canónica de Experiencias
// (server-side, desde signal_snapshots). null = sin fila ("Sin datos").
export interface ExperienceInsight {
    total: number | null;
    by_version: Record<string, number> | null;
    updated_at?: number | null;
}

export interface ProfileTimeline {
    user_id: string;
    profile_current: any | null;
    signals_current: Array<any>;
    risks: Array<any>;
    recommendations: Array<Recommendation>;
    experience_insights?: Record<string, ExperienceInsight | null>;
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
    reason?: string | null;
    // V9 F7-C2R-U2 — por mediación: estado del cálculo en el contexto del curso.
    data_state?: 'ok' | 'no_activity' | 'insufficient' | 'no_course_works';
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
