/**
 * metricsRouteBoundary.mjs — CHP-STATS-SHADOW-01A.
 *
 * FRONTERA ÚNICA de las cuatro rutas legacy de métricas:
 *
 *   GET /api/metrics/schools
 *   GET /api/metrics/school/:schoolId
 *   GET /api/metrics/course/:courseId
 *   GET /api/metrics/student/:userId
 *
 * Reemplaza a `wrapLegacyMetrics`, cuyo modo shadow **await-eaba** el cálculo
 * canónico antes de responder: eso bloqueaba la respuesta pública. Aquí el
 * trabajo canónico se ENTREGA a un ejecutor acotado y la respuesta legacy sale
 * sin esperarlo.
 *
 * Invariantes:
 *   · la autorización ocurre ANTES de esta frontera, en el handler legacy;
 *     este módulo no decide accesos y no los duplica;
 *   · en `legacy` no se ejecuta absolutamente nada canónico;
 *   · en `shadow` el body, status y headers públicos son los de legacy, byte
 *     a byte, y ningún fallo canónico los altera;
 *   · en `canonical` se proyecta el motor nuevo al shape legacy mediante un
 *     adaptador explícito, y si el shape no puede representar NO_DATA sin
 *     engañar, la ruta queda BLOCKED en vez de inventar un cero.
 */
import {
    COMPARABLE_KEYS, REASON, SEVERITY, matrixEntry,
    periodsAreComparable, severityFor, ROUTE_CONTRACTS,
} from './comparability.mjs';

/** Rutas cuyo shape legacy NO puede representar los estados canónicos. */
export const CANONICAL_COMPATIBILITY = Object.freeze({
    'metrics.schools': 'CANONICAL_COMPATIBLE',
    // `summary.engagementRate` colapsa "sin población" y "cero actividad" en 0.
    'metrics.school':  'CANONICAL_BLOCKED',
    'metrics.course':  'CANONICAL_BLOCKED',
    'metrics.student': 'CANONICAL_BLOCKED',
});

export class CanonicalBlocked extends Error {
    constructor(routeKind) {
        super(`CANONICAL_COMPATIBILITY_BLOCKED: ${routeKind}`);
        this.name = 'CanonicalBlocked';
        this.code = 'CANONICAL_COMPATIBILITY_BLOCKED';
        this.routeKind = routeKind;
    }
}

// ── utilidades puras ────────────────────────────────────────────────────────

/** Lee `a.b.c` sin lanzar. */
export function pick(obj, path) {
    if (!path) return undefined;
    return path.split('.').reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** Periodo sanitizado: solo días y límites, jamás identificadores. */
const sanitizePeriod = (p) => (p ? { fromTs: p.fromTs ?? null, toTs: p.toTs ?? null, days: p.days ?? null } : null);

/**
 * Compara SOLO las métricas declaradas comparables y con periodos equivalentes.
 * Devuelve diferencias agregadas y sanitizadas: sin userId, email, nombre,
 * token, payload, cabeceras ni path con identificadores.
 */
export function compareMetrics({ routeKind, organizationId = null, legacy, canonical, canonicalPeriod }) {
    const differences = [];
    const skipped = [];

    if (!legacy || typeof legacy !== 'object') {
        return { differences: [{ routeKind, organizationId, metricKey: null,
            reasonCode: REASON.LEGACY_SHAPE_INVALID, severity: SEVERITY.ENGINE_ERROR }], skipped, shapeError: true };
    }
    if (!canonical || typeof canonical !== 'object' || canonical.contractVersion !== 2) {
        return { differences: [{ routeKind, organizationId, metricKey: null,
            reasonCode: REASON.CANONICAL_SHAPE_INVALID, severity: SEVERITY.ENGINE_ERROR }], skipped, shapeError: true };
    }

    for (const key of COMPARABLE_KEYS) {
        const entry = matrixEntry(key);
        const period = periodsAreComparable({ routeKind, metricKey: key, canonicalPeriod });
        if (!period.comparable) {
            skipped.push({ metricKey: key, reasonCode: period.reason ?? REASON.METRIC_NOT_COMPARABLE });
            continue;
        }

        const legacyValue = pick(legacy, entry.legacyPath);
        const canonicalValue = pick(canonical, `metrics.${key}.value`);

        if (!isNum(legacyValue) || !isNum(canonicalValue)) {
            skipped.push({ metricKey: key, reasonCode: REASON.METRIC_NOT_COMPARABLE });
            continue;
        }
        if (legacyValue === canonicalValue) continue;

        const absoluteDelta = Math.abs(canonicalValue - legacyValue);
        const relativeDelta = legacyValue !== 0 ? absoluteDelta / Math.abs(legacyValue) : null;
        const reasonCode = entry.reason ?? REASON.UNKNOWN_DIFFERENCE;

        differences.push({
            routeKind,
            organizationId,
            period: sanitizePeriod(canonicalPeriod),
            metricKey: key,
            legacyValue,
            canonicalValue,
            absoluteDelta,
            relativeDelta: relativeDelta == null ? null : Math.round(relativeDelta * 1000) / 1000,
            reasonCode,
            severity: severityFor({ reason: reasonCode, relativeDelta }),
            contractVersion: 2,
        });
    }
    return { differences, skipped, shapeError: false };
}

/**
 * Frontera de ejecución.
 *
 * @param {object} p
 * @param {'legacy'|'shadow'|'canonical'} p.mode
 * @param {string}   p.routeKind
 * @param {function} p.legacyHandler       (req,res) => Promise|void   — responde
 * @param {function} [p.canonicalExecutor] ({req}) => Promise<{envelope, period, organizationId}>
 * @param {function} [p.captureLegacy]     ({req}) => Promise<object>  — solo para comparar
 * @param {object}   [p.shadowExecutor]
 * @param {function} [p.log]
 * @param {function} [p.now]
 * @param {function} [p.projectToLegacyShape] (envelope) => object
 */
export async function executeMetricsRoute({
    mode, routeKind, req, res,
    legacyHandler, canonicalExecutor = null, captureLegacy = null,
    shadowExecutor = null, projectToLegacyShape = null,
    log = () => {}, now = () => Date.now(),
}) {
    if (!ROUTE_CONTRACTS[routeKind]) throw new Error(`routeKind desconocido: ${routeKind}`);

    // ── legacy: cero trabajo canónico, cero logs shadow ────────────────────
    if (mode === 'legacy') return legacyHandler(req, res);

    // ── canonical: proyección explícita, nunca analytics_db.json ───────────
    if (mode === 'canonical') {
        if (CANONICAL_COMPATIBILITY[routeKind] !== 'CANONICAL_COMPATIBLE') {
            throw new CanonicalBlocked(routeKind);
        }
        if (!canonicalExecutor || !projectToLegacyShape) throw new CanonicalBlocked(routeKind);
        const { envelope } = await canonicalExecutor({ req });
        return res.json(projectToLegacyShape(envelope));
    }

    // ── shadow: responde legacy YA; el canónico va aparte ──────────────────
    const started = now();

    if (shadowExecutor && canonicalExecutor && captureLegacy) {
        // submit() es síncrono: encola y vuelve. La respuesta no lo espera.
        shadowExecutor.submit({
            routeKind,
            task: async () => {
                let canonical = null, canonicalError = null, period = null, organizationId = null;
                try {
                    const out = await canonicalExecutor({ req });
                    canonical = out?.envelope ?? null;
                    period = out?.period ?? null;
                    organizationId = out?.organizationId ?? null;
                } catch (e) {
                    canonicalError = e?.code ?? 'CANONICAL_SOURCE_ERROR';
                }
                if (canonicalError) {
                    log({ evt: 'shadow_canonical_error', routeKind, reasonCode: REASON.CANONICAL_SOURCE_ERROR,
                          severity: SEVERITY.ENGINE_ERROR }, 'WARN');
                    return { canonicalError: true, differences: [] };
                }
                const legacySnapshot = await captureLegacy({ req });
                const cmp = compareMetrics({ routeKind, organizationId, legacy: legacySnapshot,
                                             canonical, canonicalPeriod: period });
                for (const d of cmp.differences) log({ evt: 'shadow_difference', ...d }, 'INFO');
                if (cmp.differences.length === 0) {
                    log({ evt: 'shadow_no_difference', routeKind, organizationId,
                          skipped: cmp.skipped.length }, 'INFO');
                }
                return cmp;
            },
        });
    }

    const out = await legacyHandler(req, res);
    if (shadowExecutor) shadowExecutor.observeLegacyDuration(now() - started);
    return out;
}
