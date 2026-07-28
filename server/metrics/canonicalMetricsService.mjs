/**
 * canonicalMetricsService.mjs — CHP-STATS-SHADOW-01A-R1.
 *
 * Cómputo canónico de métricas, extraído de `metricsRouterV2` para que HTTP y
 * shadow compartan EXACTAMENTE el mismo motor. Antes esta lógica vivía dentro
 * de los handlers de Express, así que el shadow no podía reutilizarla sin
 * duplicar el motor —que es justo lo que el contrato prohíbe.
 *
 * Este servicio:
 *   · no recibe `req` ni `res`;
 *   · no autentica ni autoriza (la autorización queda en el router / call site);
 *   · no escribe respuestas HTTP ni lee cabeceras;
 *   · no registra PII;
 *   · no modifica stores;
 *   · recibe `provider` y `clock` inyectables;
 *   · devuelve `{ status, body }`, donde `body` es el contrato canónico
 *     completo (contractVersion, period, metrics, population, coverage,
 *     quality) conservando NO_DATA / NO_ACTIVITY / NOT_DEFINED.
 *
 * El router queda como capa fina:
 *   HTTP → validación de parámetros → autorización CIS → este servicio →
 *   serialización.
 */
import {
    summarize, computeOrganization, buildIndex, organizationPopulation,
    metricEnvelope, MEASUREMENT_STATUS, CONTRACT_VERSION,
} from '../../engines/metrics/referenceEngine.mjs';
import { SESSION_CAP_MS } from '../../engines/metrics/eventContract.mjs';
import { classifyGroup } from '../identity/organizationScope.mjs';

/** Nombres del motor → nombres publicados por el contrato. */
export const PUBLISHED_METRICS = Object.freeze({
    registeredUsers:     'registeredUsers',
    registeredReaders:   'registeredReaders',
    eligibleReaders:     'eligibleReaders',
    readersWithoutGroup: 'readersWithoutGroup',
    usersWithActivity:   'usersWithActivity',
    activeReaders:       'activeReaders',
    entries:             'entries',
    sessions:            'sessions',
    platformTimeMs:      'platformTimeMs',
    contentsOpened:      'distinctContents',
    readingTimeMs:       'readingTimeMs',
});

export function publishMetrics(engineMetrics) {
    const out = {};
    for (const [engineName, publishedName] of Object.entries(PUBLISHED_METRICS)) {
        const m = engineMetrics[engineName];
        if (!m) continue;
        out[publishedName] = { ...m, metric: publishedName };
    }
    return out;
}

export function envelope({ organizationId = null, generatedAt, period, idleMs, org, includeQuality }) {
    const metrics = publishMetrics(org.metrics);
    const anyMetric = metrics.activeReaders ?? Object.values(metrics)[0] ?? null;
    return {
        contractVersion: CONTRACT_VERSION,
        generatedAt,
        period,
        sessionStrategy: `INACTIVITY_WINDOW_${Math.round(idleMs / 60000)}MIN`,
        sessionCapMs: SESSION_CAP_MS,
        organizationId,
        metrics,
        population: org.population,
        coverage: anyMetric?.coverage ?? null,
        quality: includeQuality ? (anyMetric?.quality ?? null) : null,
    };
}

/** Carga padrones + eventos del periodo y arma el índice. Sin caché ni escritura. */
export async function loadCanonicalContext({ provider, period }) {
    const { users, groups, schools } = provider.loadDirectory();
    const events = await provider.loadEvents(period);
    const index = buildIndex({ users, groups, schools, classifyGroup });
    return { users, groups, schools, events, index };
}

/**
 * Cómputo canónico para un scope ya autorizado.
 *
 * @param {object} p
 * @param {'organizations'|'organization'|'group'|'user'} p.scopeKind
 * @param {string}  [p.organizationId]
 * @param {string}  [p.groupId]
 * @param {string}  [p.userId]
 * @param {object|null} p.period     periodo YA resuelto (null = histórico completo)
 * @param {number}  p.idleMs
 * @param {boolean} [p.includeQuality]
 * @param {object}  p.provider
 * @param {function} p.clock         () => epoch ms. Sin reloj implícito.
 * @param {function} [p.isOrgVisible] (organizationId) => boolean — lo inyecta el
 *        call site tras autorizar. El servicio NO decide accesos.
 * @returns {Promise<{status: number, body: object}>}
 */
export async function computeCanonicalMetrics({
    scopeKind, organizationId = null, groupId = null, userId = null,
    period, idleMs, includeQuality = true,
    provider, clock, isOrgVisible = () => true,
}) {
    if (typeof clock !== 'function') throw new TypeError('computeCanonicalMetrics: clock obligatorio');
    if (!provider) throw new TypeError('computeCanonicalMetrics: provider obligatorio');

    const generatedAt = clock();
    const ctx = await loadCanonicalContext({ provider, period });
    const { users, groups, schools, events, index } = ctx;

    if (scopeKind === 'organizations') {
        const visible = [...index.registeredOrgIds].sort().filter(isOrgVisible);
        const organizations = visible.map((orgId) => {
            const org = computeOrganization({ organizationId: orgId, events, index, users, period, idleMs });
            return envelope({ organizationId: orgId, generatedAt, period, idleMs, org, includeQuality });
        });
        const full = summarize({ users, groups, schools, events, classifyGroup, period, idleMs });
        return {
            status: 200,
            body: {
                contractVersion: CONTRACT_VERSION,
                generatedAt,
                period,
                sessionStrategy: full.sessionStrategy,
                populations: full.populations,
                organizations,
                unattributed: includeQuality ? full.unattributed : null,
            },
        };
    }

    if (scopeKind === 'organization') {
        // La EXISTENCIA se comprueba aquí, no en la autorización: un admin de
        // plataforma pasa el gate del CIS para cualquier scope, así que sin esta
        // comprobación un id inventado devolvería 200/NO_DATA.
        if (!index.registeredOrgIds.has(organizationId)) {
            return { status: 404, body: { ok: false, error: 'organization_not_found' } };
        }
        const org = computeOrganization({ organizationId, events, index, users, period, idleMs });
        return { status: 200, body: envelope({ organizationId, generatedAt, period, idleMs, org, includeQuality }) };
    }

    if (scopeKind === 'group') {
        const orgId = index.orgOfGroup.get(groupId) ?? null;
        if (!orgId) {
            // El grupo existe y el caller lo media, pero está fuera del scope
            // activo (histórico o sintético): no hay métrica institucional.
            return {
                status: 200,
                body: {
                    contractVersion: CONTRACT_VERSION, generatedAt, period, groupId,
                    organizationId: null,
                    metrics: { activeReaders: metricEnvelope({
                        metric: 'activeReaders', status: MEASUREMENT_STATUS.NO_DATA,
                        reason: 'GROUP_NOT_IN_ACTIVE_SCOPE', period }) },
                    population: null, coverage: null, quality: null,
                },
            };
        }
        const members = new Set();
        const pop = organizationPopulation({ organizationId: orgId, users, index });
        for (const u of pop.registeredUsers) {
            if (index.groupsOfUser.get(u.id)?.has(groupId)) members.add(u.id);
        }
        const groupUsers = users.filter(u => members.has(u.id));
        const org = computeOrganization({ organizationId: orgId, events, index, users: groupUsers, period, idleMs });
        const out = envelope({ organizationId: orgId, generatedAt, period, idleMs, org, includeQuality });
        return { status: 200, body: { ...out, groupId } };
    }

    if (scopeKind === 'user') {
        if (!index.usersById.has(userId)) return { status: 404, body: { ok: false, error: 'user_not_found' } };
        const orgId = index.orgDeclared.get(userId)
            ?? [...(index.orgsViaGroups.get(userId) ?? [])].sort()[0] ?? null;
        if (!orgId) {
            return {
                status: 200,
                body: {
                    contractVersion: CONTRACT_VERSION, generatedAt, period, userId, organizationId: null,
                    metrics: { activeReaders: metricEnvelope({
                        metric: 'activeReaders', status: MEASUREMENT_STATUS.NO_DATA,
                        reason: 'USER_NOT_IN_ACTIVE_ORGANIZATION', period }) },
                    population: null, coverage: null, quality: null,
                },
            };
        }
        const org = computeOrganization({ organizationId: orgId, events, index,
                                          users: users.filter(u => u.id === userId), period, idleMs });
        const out = envelope({ organizationId: orgId, generatedAt, period, idleMs, org, includeQuality });
        return { status: 200, body: { ...out, userId } };
    }

    throw new TypeError(`computeCanonicalMetrics: scopeKind desconocido "${scopeKind}"`);
}
