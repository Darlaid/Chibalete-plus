/**
 * metricsRouterV2.mjs — CHP-API-METRICS-01A.
 *
 * API v2 de métricas: expone el motor canónico aprobado (contrato v2, D1–D10)
 * detrás de rutas versionadas nuevas. **No toca las rutas legacy.**
 *
 *   GET /api/v2/metrics/organizations
 *   GET /api/v2/metrics/organizations/:organizationId
 *   GET /api/v2/metrics/groups/:groupId
 *   GET /api/v2/metrics/users/:userId
 *
 * Autorización: exclusivamente vía CIS por `organizationId`. Ningún slug,
 * nombre de colegio ni texto libre autoriza nada.
 *
 * Estados: un error JAMÁS se convierte en ceros. Cada métrica viaja en su sobre
 * `{value, measured, status, ...}` y los fallos responden con código explícito.
 */
import {
    summarize, computeOrganization, buildIndex, organizationPopulation,
    unattributedReport, metricEnvelope, defaultPeriod,
    MEASUREMENT_STATUS, CONTRACT_VERSION,
} from '../../engines/metrics/referenceEngine.mjs';
import { IDLE_MS, SESSION_CAP_MS, classifyEvent, EVENT_CLASS } from '../../engines/metrics/eventContract.mjs';
import { classifyGroup } from '../identity/organizationScope.mjs';
import { evaluateScopeAccess } from '../aulaViva/scopeAccess.mjs';
// CHP-STATS-SHADOW-01A-R1 — el cómputo vive en el servicio, no en el router.
import { computeCanonicalMetrics, envelope, publishMetrics, PUBLISHED_METRICS }
    from './canonicalMetricsService.mjs';

/** Modo del motor. Producción arranca en `legacy`: el motor nuevo no responde. */
export const METRICS_ENGINE_MODES = Object.freeze(['legacy', 'canonical', 'shadow']);
export function metricsEngineMode(env = process.env) {
    const m = String(env.METRICS_ENGINE ?? 'legacy').trim().toLowerCase();
    return METRICS_ENGINE_MODES.includes(m) ? m : 'legacy';
}

const MAX_IDLE_MINUTES = 240;

// ── Parámetros ──────────────────────────────────────────────────────────────

export class BadRequest extends Error {
    constructor(reason, detail) {
        super(reason);
        this.name = 'BadRequest';
        this.code = reason;
        this.detail = detail ?? null;
    }
}

/**
 * Resuelve `from`/`to`/`period` a un periodo explícito. `nowTs` se inyecta:
 * ninguna capa de métricas usa reloj implícito.
 */
export function resolvePeriod(query = {}, nowTs) {
    if (!Number.isFinite(nowTs)) throw new BadRequest('NOW_TS_REQUIRED');
    const { from, to, period } = query;

    if (from != null || to != null) {
        const fromTs = Number(from), toTs = Number(to);
        if (!Number.isFinite(fromTs) || !Number.isFinite(toTs)) throw new BadRequest('INVALID_PERIOD_BOUNDS');
        if (fromTs > toTs) throw new BadRequest('PERIOD_INVERTED');
        return { fromTs, toTs, days: Math.round((toTs - fromTs) / 86_400_000) };
    }
    if (period === 'all') return null;                       // histórico completo, explícito
    const spec = String(period ?? '30d').trim().toLowerCase();
    const m = /^(\d{1,4})d$/.exec(spec);
    if (!m) throw new BadRequest('INVALID_PERIOD');
    return defaultPeriod(nowTs, Number(m[1]));
}

/** `sessionIdleMinutes` es un override ADMINISTRATIVO; el default aprobado es 15. */
export function resolveIdleMs(query = {}, { isAdmin }) {
    const raw = query.sessionIdleMinutes;
    if (raw == null || raw === '') return IDLE_MS;
    if (!isAdmin) throw new BadRequest('IDLE_OVERRIDE_FORBIDDEN');
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > MAX_IDLE_MINUTES) throw new BadRequest('INVALID_IDLE');
    return Math.round(n) * 60_000;
}

const wantsQuality = (query = {}) => String(query.includeQuality ?? 'true').toLowerCase() !== 'false';

// ── Autorización (CIS) ──────────────────────────────────────────────────────

/**
 * Decide sobre un scope y traduce a HTTP. Distingue explícitamente
 * «no existe» (404) de «no autorizado» (403).
 */
export function authorize({ callerId, scopeType, scopeId }) {
    const d = evaluateScopeAccess(callerId, scopeType, scopeId);
    if (d.decision === 'allow') return { ok: true, via: d.via };
    if (d.decision === 'unauthenticated') return { ok: false, httpStatus: 401, error: 'identity_not_established' };
    if (d.decision === 'unavailable')     return { ok: false, httpStatus: 503, error: 'identity_unavailable', cause: d.cause };
    // Una organización que no está registrada no existe para esta API.
    if (d.cause === 'ORGANIZATION_NOT_REGISTERED') {
        return { ok: false, httpStatus: 404, error: 'organization_not_found' };
    }
    return { ok: false, httpStatus: 403, error: 'scope_access_denied', cause: d.cause };
}

// ── Sobre de respuesta ──────────────────────────────────────────────────────

/**
 * `contentsOpened` es el nombre del motor; la API lo publica como
 * `distinctContents`. Es un alias de presentación, no un cambio de contrato.
 */
// PUBLISHED_METRICS, publishMetrics y envelope viven ahora en
// canonicalMetricsService.mjs. Se reexportan al final para no romper imports.

// ── Router ──────────────────────────────────────────────────────────────────

/**
 * @param {object} deps
 * @param {function} deps.requireUserAuth  middleware existente del server
 * @param {object}   deps.provider         createMetricsProvider(...)
 * @param {function} deps.now              () => epoch ms (inyectable)
 * @param {function} [deps.log]
 * @param {object}   [deps.express]        para inyectar Router en tests
 */
export function createMetricsRouterV2({ requireUserAuth, provider, now, log = () => {}, express }) {
    if (!provider) throw new TypeError('createMetricsRouterV2: provider obligatorio');
    if (typeof now !== 'function') throw new TypeError('createMetricsRouterV2: now obligatorio (sin reloj implícito)');
    const router = express.Router();

    const fail = (res, httpStatus, error, extra = {}) =>
        res.status(httpStatus).json({ ok: false, error, ...extra });

    /** Carga padrones + eventos del periodo y arma el índice. */
    async function loadContext(period) {
        const { users, groups, schools } = provider.loadDirectory();
        const events = await provider.loadEvents(period);
        const index = buildIndex({ users, groups, schools, classifyGroup });
        return { users, groups, schools, events, index };
    }

    const isAdminCaller = (callerId) =>
        evaluateScopeAccess(callerId, 'all', 'all').via === 'policy:platform_admin_full_institutional_read';

    // ── Lista de organizaciones ─────────────────────────────────────────────
    router.get('/v2/metrics/organizations', requireUserAuth, async (req, res) => {
        const callerId = req.headers['x-user-id'];
        try {
            const period = resolvePeriod(req.query, now());
            const r = await computeCanonicalMetrics({
                scopeKind: 'organizations', period,
                idleMs: resolveIdleMs(req.query, { isAdmin: isAdminCaller(callerId) }),
                includeQuality: wantsQuality(req.query),
                provider, clock: now,
                isOrgVisible: (orgId) => authorize({ callerId, scopeType: 'organization', scopeId: orgId }).ok,
            });
            return res.status(r.status).json(r.body);
        } catch (e) {
            return handleError(res, e, log);
        }
    });

    // ── Una organización ────────────────────────────────────────────────────
    router.get('/v2/metrics/organizations/:organizationId', requireUserAuth, async (req, res) => {
        const callerId = req.headers['x-user-id'];
        const { organizationId } = req.params;
        try {
            const auth = authorize({ callerId, scopeType: 'organization', scopeId: organizationId });
            if (!auth.ok) return fail(res, auth.httpStatus, auth.error, auth.cause ? { cause: auth.cause } : {});
            const period = resolvePeriod(req.query, now());
            const r = await computeCanonicalMetrics({
                scopeKind: 'organization', organizationId, period,
                idleMs: resolveIdleMs(req.query, { isAdmin: isAdminCaller(callerId) }),
                includeQuality: wantsQuality(req.query), provider, clock: now,
            });
            return res.status(r.status).json(r.body);
        } catch (e) {
            return handleError(res, e, log);
        }
    });

    // ── Un grupo ────────────────────────────────────────────────────────────
    router.get('/v2/metrics/groups/:groupId', requireUserAuth, async (req, res) => {
        const callerId = req.headers['x-user-id'];
        const { groupId } = req.params;
        try {
            const auth = authorize({ callerId, scopeType: 'group', scopeId: groupId });
            if (!auth.ok) return fail(res, auth.httpStatus, auth.error, auth.cause ? { cause: auth.cause } : {});
            const period = resolvePeriod(req.query, now());
            const r = await computeCanonicalMetrics({
                scopeKind: 'group', groupId, period,
                idleMs: resolveIdleMs(req.query, { isAdmin: isAdminCaller(callerId) }),
                includeQuality: wantsQuality(req.query), provider, clock: now,
            });
            return res.status(r.status).json(r.body);
        } catch (e) {
            return handleError(res, e, log);
        }
    });

    // ── Un usuario ──────────────────────────────────────────────────────────
    router.get('/v2/metrics/users/:userId', requireUserAuth, async (req, res) => {
        const callerId = req.headers['x-user-id'];
        const { userId } = req.params;
        try {
            const auth = authorize({ callerId, scopeType: 'user', scopeId: userId });
            if (!auth.ok) return fail(res, auth.httpStatus, auth.error, auth.cause ? { cause: auth.cause } : {});
            const period = resolvePeriod(req.query, now());
            const r = await computeCanonicalMetrics({
                scopeKind: 'user', userId, period,
                idleMs: resolveIdleMs(req.query, { isAdmin: isAdminCaller(callerId) }),
                includeQuality: wantsQuality(req.query), provider, clock: now,
            });
            return res.status(r.status).json(r.body);
        } catch (e) {
            return handleError(res, e, log);
        }
    });

    return router;
}

/** Un error jamás se degrada a ceros: se responde con código explícito. */
export function handleError(res, e, log = () => {}) {
    if (e instanceof BadRequest) return res.status(400).json({ ok: false, error: e.code, detail: e.detail });
    if (e?.code === 'METRICS_SOURCE_UNAVAILABLE') {
        log(`[metrics-v2] fuente no disponible: ${e.source}`, 'ERROR');
        return res.status(503).json({ ok: false, error: 'metrics_source_unavailable', source: e.source });
    }
    if (e?.code === 'IDENTITY_UNAVAILABLE') {
        return res.status(503).json({ ok: false, error: 'identity_unavailable' });
    }
    log(`[metrics-v2] error inesperado: ${e?.message}`, 'ERROR');
    return res.status(500).json({ ok: false, error: 'metrics_internal_error' });
}

// ── Shadow comparison (Fase 9) ──────────────────────────────────────────────

export const SHADOW_ALERT = Object.freeze({
    ENGINE_ERROR:            'ENGINE_ERROR',
    USER_OUT_OF_SCOPE:       'USER_OUT_OF_SCOPE',
    MISSING_METRIC:          'MISSING_METRIC',
    NON_DETERMINISTIC:       'NON_DETERMINISTIC',
    INVALID_CANONICAL_SHAPE: 'INVALID_CANONICAL_SHAPE',
});

/**
 * Compara legacy vs canónico y devuelve SOLO diferencias agregadas sanitizadas.
 * Nunca registra payloads ni identidades. Las diferencias no son fallos por sí
 * mismas — los contratos son distintos a propósito; lo que sí alerta son los
 * síntomas de la lista `SHADOW_ALERT`.
 *
 * @param {object} p
 * @param {object} p.legacy     respuesta legacy (shape libre)
 * @param {object} p.canonical  sobre canónico
 * @param {object} [p.thresholds] {ratioDelta} umbral relativo para señalar
 */
export function compareShadow({ endpoint, legacy, canonical, thresholds = {} }) {
    const alerts = [];
    const ratioDelta = thresholds.ratioDelta ?? 0.25;

    if (!canonical || typeof canonical !== 'object' || canonical.contractVersion !== CONTRACT_VERSION) {
        alerts.push(SHADOW_ALERT.INVALID_CANONICAL_SHAPE);
        return { endpoint, comparable: false, alerts, differences: [] };
    }

    const legacyPop = {
        students: Number(legacy?.summary?.studentCount ?? legacy?.studentCount ?? NaN),
        active:   Number(legacy?.summary?.activeStudentCount ?? legacy?.activeStudentCount ?? NaN),
    };
    const canonPop = {
        students: canonical.population?.registeredUsers ?? null,
        active:   canonical.population?.activeReaders ?? null,
    };

    const differences = [];
    for (const key of ['students', 'active']) {
        const l = legacyPop[key], c = canonPop[key];
        if (!Number.isFinite(l) || !Number.isFinite(c)) {
            differences.push({ field: key, legacy: Number.isFinite(l) ? l : null,
                               canonical: Number.isFinite(c) ? c : null, reason: 'NOT_COMPARABLE' });
            continue;
        }
        const delta = c - l;
        const rel = l === 0 ? (c === 0 ? 0 : 1) : Math.abs(delta) / l;
        differences.push({
            field: key, legacy: l, canonical: c, delta,
            relative: Math.round(rel * 1000) / 1000,
            exceedsThreshold: rel > ratioDelta,
            reason: key === 'active' ? 'CONTRACT_DIFFERS_READING_VS_PRESENCE' : 'CONTRACT_DIFFERS_POPULATION_SCOPE',
        });
    }

    for (const m of ['registeredUsers', 'activeReaders', 'sessions', 'platformTimeMs']) {
        if (!canonical.metrics?.[m]) alerts.push(SHADOW_ALERT.MISSING_METRIC);
    }
    if (canonical.metrics?.activeReaders?.status === MEASUREMENT_STATUS.ERROR) alerts.push(SHADOW_ALERT.ENGINE_ERROR);

    return {
        endpoint,
        comparable: true,
        contractVersion: CONTRACT_VERSION,
        coverage: canonical.coverage ?? null,
        differences,
        alerts: [...new Set(alerts)],
    };
}

/** Clasificación de un tipo de evento; se reexporta para el adaptador legacy. */
export const eventClassOf = (name) => classifyEvent(name).class;
export { EVENT_CLASS };

// Reexportados desde el servicio: los tests y otros módulos los importaban de aquí.
export { envelope, publishMetrics, PUBLISHED_METRICS };
