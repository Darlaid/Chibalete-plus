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
    COMPARABLE_KEYS, REASON, SEVERITY, COMPARISON_STATUS, matrixEntry,
    periodsAreComparable, severityFor, ROUTE_CONTRACTS,
} from './comparability.mjs';

/** Estados internos del motor (readiness). No se exponen públicamente. */
export const ENGINE_STATE = Object.freeze({
    LEGACY_READY:          'LEGACY_READY',
    SHADOW_NOT_CONFIGURED: 'SHADOW_NOT_CONFIGURED',
    SHADOW_READY:          'SHADOW_READY',
    SHADOW_DEGRADED:       'SHADOW_DEGRADED',
    CANONICAL_BLOCKED:     'CANONICAL_BLOCKED',
    CANONICAL_READY:       'CANONICAL_READY',
});

/**
 * Readiness del motor. Falla CERRADA: con `shadow` y sin ejecutor canónico
 * devuelve SHADOW_NOT_CONFIGURED y `ready:false`, en vez de pasar por
 * "shadow activo" silenciosamente.
 */
export function engineReadiness({ mode, hasCanonicalExecutor, routeKind = null, executorStats = null }) {
    if (mode === 'legacy') {
        return { state: ENGINE_STATE.LEGACY_READY, ready: true, shadowReady: false };
    }
    if (mode === 'shadow') {
        if (!hasCanonicalExecutor) {
            return {
                state: ENGINE_STATE.SHADOW_NOT_CONFIGURED, ready: true, shadowReady: false,
                error: 'ENGINE_CONFIGURATION_ERROR',
            };
        }
        if (executorStats?.breakerOpen) {
            return { state: ENGINE_STATE.SHADOW_DEGRADED, ready: true, shadowReady: false };
        }
        return { state: ENGINE_STATE.SHADOW_READY, ready: true, shadowReady: true };
    }
    if (mode === 'canonical') {
        const compat = routeKind ? CANONICAL_COMPATIBILITY[routeKind] : null;
        if (compat !== 'CANONICAL_COMPATIBLE' || !hasCanonicalExecutor) {
            return { state: ENGINE_STATE.CANONICAL_BLOCKED, ready: false, shadowReady: false };
        }
        return { state: ENGINE_STATE.CANONICAL_READY, ready: true, shadowReady: false };
    }
    return { state: ENGINE_STATE.LEGACY_READY, ready: true, shadowReady: false };
}

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

/**
 * Envuelve `res.json`/`res.send` para capturar **una sola vez** el body que el
 * handler legacy ya está enviando, sin alterar la respuesta pública ni volver a
 * ejecutarlo.
 *
 * Antes se reejecutaba el handler completo contra un `res` falso: eso duplicaba
 * el coste legacy en el hilo principal (~270 ms en `school/villas`) y ejecutaba
 * la autorización dos veces.
 *
 * De la captura solo se conserva una **proyección mínima**: nunca la petición,
 * ni cabeceras de autenticación, ni tokens, ni el body completo hacia el worker.
 */
export function attachLegacyCapture(res) {
    const captured = { status: 200, body: null, captured: false };
    if (!res || typeof res.json !== 'function') return captured;

    const origJson = res.json.bind(res);
    const origSend = typeof res.send === 'function' ? res.send.bind(res) : null;

    res.json = (body) => {
        if (!captured.captured) {
            captured.captured = true;
            captured.status = res.statusCode ?? 200;
            captured.body = body;            // referencia, no copia: no se serializa dos veces
        }
        return origJson(body);
    };
    if (origSend) {
        res.send = (body) => {
            if (!captured.captured && body && typeof body === 'object') {
                captured.captured = true;
                captured.status = res.statusCode ?? 200;
                captured.body = body;
            }
            return origSend(body);
        };
    }
    return captured;
}

/**
 * Proyección mínima del body legacy para comparar. Solo las métricas
 * declaradas comparables; cero PII, cero campos innecesarios.
 */
export function projectLegacy({ routeKind, body }) {
    const contract = ROUTE_CONTRACTS[routeKind];
    if (!body || typeof body !== 'object') {
        return { routeKind, usable: false, reason: REASON.LEGACY_SHAPE_INVALID, metrics: {} };
    }
    if (!contract?.backboneAugment) {
        // La ruta no expone la ventana comparable: se registra la razón y no se
        // conserva nada más.
        return { routeKind, usable: false, reason: REASON.METRIC_NOT_COMPARABLE, metrics: {} };
    }
    const bb = body.backboneMetrics ?? {};
    const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    return {
        routeKind,
        usable: true,
        windowDays: contract.backboneAugment.windowDays,
        metrics: {
            sessions:         num(bb.sessions),
            distinctContents: num(bb.distinctContents),
        },
    };
}

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
export function compareMetrics({ routeKind, organizationId = null, legacy, canonical,
                                 canonicalPeriod, legacyPeriod = null }) {
    const differences = [];
    const skipped = [];
    const contract = ROUTE_CONTRACTS[routeKind];
    // Periodo legacy DECLARADO por el contrato de la ruta, no inferido.
    const declaredLegacyPeriod = legacyPeriod ?? (contract?.backboneAugment
        ? { kind: contract.backboneAugment.periodKind, days: contract.backboneAugment.windowDays }
        : { kind: contract?.legacyCore?.periodKind ?? 'UNDETERMINED', days: null });

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
            skipped.push({
                metricKey: key,
                reasonCode: period.reason ?? REASON.METRIC_NOT_COMPARABLE,
                comparisonStatus: period.reason === REASON.PERIOD_DIFFERENCE
                    ? COMPARISON_STATUS.PERIOD_NOT_COMPARABLE
                    : COMPARISON_STATUS.PERIOD_UNKNOWN,
                legacyPeriod: declaredLegacyPeriod,
                canonicalPeriod: sanitizePeriod(canonicalPeriod),
            });
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
            legacyPeriod: declaredLegacyPeriod,
            canonicalPeriod: sanitizePeriod(canonicalPeriod),
            comparisonStatus: COMPARISON_STATUS.COMPARABLE,
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

    // ── shadow: responde legacy YA; el canónico va al pool ─────────────────
    const started = now();

    // Sin ejecutor canónico el shadow NO puede compararse. Se contabiliza de
    // forma explícita para que readiness lo detecte, en vez de aparentar que
    // "shadow está activo".
    if (shadowExecutor && !canonicalExecutor) {
        shadowExecutor.countCanonicalExecutorMissing();
        log({ evt: 'shadow_config_error', routeKind, error: 'ENGINE_CONFIGURATION_ERROR',
              severity: SEVERITY.ENGINE_ERROR }, 'WARN');
    }

    // La captura se engancha ANTES de ejecutar el handler: se obtiene el body
    // que el propio handler envía, sin reejecutarlo.
    const capture = (shadowExecutor && canonicalExecutor) ? attachLegacyCapture(res) : null;

    if (capture) {
        const queueCanonical = () => {
            // Una petición no autorizada (o errónea) no genera trabajo shadow.
            const status = capture.status ?? res?.statusCode ?? 200;
            if (status >= 400) {
                log({ evt: 'shadow_skipped_unauthorized', routeKind, status }, 'INFO');
                return;
            }
            const legacyProjection = projectLegacy({ routeKind, body: capture.body });
            const responseFinishedAt = now();

            shadowExecutor.submit({
                routeKind,
                canonicalQueuedAt: now(),
                responseFinishedAt,
                task: async () => {
                    let out = null, canonicalError = null;
                    try {
                        out = await canonicalExecutor({ req });
                    } catch (e) {
                        canonicalError = e?.code ?? 'CANONICAL_SOURCE_ERROR';
                    }
                    if (canonicalError || !out?.ok) {
                        const code = canonicalError ?? out?.error ?? 'CANONICAL_SOURCE_ERROR';
                        log({ evt: 'shadow_canonical_error', routeKind, reasonCode: REASON.CANONICAL_SOURCE_ERROR,
                              code, severity: SEVERITY.ENGINE_ERROR }, 'WARN');
                        return { canonicalError: true, differences: [] };
                    }
                    const cmp = compareProjections({
                        routeKind,
                        organizationId: out.projection?.organizationId ?? null,
                        legacyProjection,
                        canonicalProjection: out.projection,
                        canonicalPeriod: out.period ?? out.projection?.period ?? null,
                    });
                    for (const d of cmp.differences) log({ evt: 'shadow_difference', ...d }, 'INFO');
                    if (cmp.differences.length === 0) {
                        log({ evt: 'shadow_no_difference', routeKind,
                              organizationId: out.projection?.organizationId ?? null,
                              skipped: cmp.skipped.length }, 'INFO');
                    }
                    return cmp;
                },
            });
        };

        // Ciclo real de Express. `once` + guard evita doble encolado si llegan
        // `finish` y `close`.
        if (typeof res?.once === 'function') {
            let queued = false;
            const oncePerResponse = () => { if (!queued) { queued = true; queueCanonical(); } };
            res.once('finish', oncePerResponse);
            res.once('close', oncePerResponse);
        } else {
            setImmediate(queueCanonical);
        }
    }

    const out = await legacyHandler(req, res);
    if (shadowExecutor) {
        shadowExecutor.observeLegacyDuration(now() - started);
        shadowExecutor.markLegacyCompleted(now());
    }
    return out;
}

/**
 * Compara PROYECCIONES pequeñas y agregadas. Nunca recibe bodies completos ni
 * eventos: solo los valores declarados comparables.
 */
export function compareProjections({ routeKind, organizationId = null,
                                     legacyProjection, canonicalProjection, canonicalPeriod }) {
    const differences = [];
    const skipped = [];
    const contract = ROUTE_CONTRACTS[routeKind];
    const declaredLegacyPeriod = contract?.backboneAugment
        ? { kind: contract.backboneAugment.periodKind, days: contract.backboneAugment.windowDays }
        : { kind: contract?.legacyCore?.periodKind ?? 'UNDETERMINED', days: null };

    if (!legacyProjection?.usable) {
        skipped.push({ reasonCode: legacyProjection?.reason ?? REASON.LEGACY_SHAPE_INVALID,
                       comparisonStatus: COMPARISON_STATUS.PERIOD_UNKNOWN });
        return { differences, skipped, shapeError: legacyProjection?.reason === REASON.LEGACY_SHAPE_INVALID };
    }
    if (!canonicalProjection || canonicalProjection.contractVersion !== 2) {
        return { differences: [{ routeKind, organizationId, metricKey: null,
            reasonCode: REASON.CANONICAL_SHAPE_INVALID, severity: SEVERITY.ENGINE_ERROR,
            comparisonStatus: COMPARISON_STATUS.PERIOD_UNKNOWN }], skipped, shapeError: true };
    }

    for (const key of COMPARABLE_KEYS) {
        const entry = matrixEntry(key);
        const period = periodsAreComparable({ routeKind, metricKey: key, canonicalPeriod });
        if (!period.comparable) {
            skipped.push({ metricKey: key, reasonCode: period.reason ?? REASON.METRIC_NOT_COMPARABLE,
                comparisonStatus: period.reason === REASON.PERIOD_DIFFERENCE
                    ? COMPARISON_STATUS.PERIOD_NOT_COMPARABLE : COMPARISON_STATUS.PERIOD_UNKNOWN,
                legacyPeriod: declaredLegacyPeriod, canonicalPeriod: sanitizePeriod(canonicalPeriod) });
            continue;
        }
        const legacyValue = legacyProjection.metrics?.[key];
        const canonicalValue = canonicalProjection.metrics?.[key]?.value;
        if (!isNum(legacyValue) || !isNum(canonicalValue)) {
            skipped.push({ metricKey: key, reasonCode: REASON.METRIC_NOT_COMPARABLE,
                comparisonStatus: COMPARISON_STATUS.PERIOD_UNKNOWN });
            continue;
        }
        if (legacyValue === canonicalValue) continue;

        const absoluteDelta = Math.abs(canonicalValue - legacyValue);
        const relativeDelta = legacyValue !== 0 ? absoluteDelta / Math.abs(legacyValue) : null;
        const reasonCode = entry.reason ?? REASON.UNKNOWN_DIFFERENCE;
        differences.push({
            routeKind, organizationId,
            legacyPeriod: declaredLegacyPeriod,
            canonicalPeriod: sanitizePeriod(canonicalPeriod),
            comparisonStatus: COMPARISON_STATUS.COMPARABLE,
            metricKey: key, legacyValue, canonicalValue, absoluteDelta,
            relativeDelta: relativeDelta == null ? null : Math.round(relativeDelta * 1000) / 1000,
            reasonCode,
            severity: severityFor({ reason: reasonCode, relativeDelta }),
            contractVersion: 2,
        });
    }
    return { differences, skipped, shapeError: false };
}
