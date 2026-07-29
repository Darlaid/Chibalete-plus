/**
 * shadowWorker.mjs — CHP-STATS-SHADOW-PERF-01B.
 *
 * Entrada del worker persistente del shadow. Carga módulos y crea el provider
 * **una sola vez**; después atiende un job cada vez.
 *
 * Ejecuta el MISMO `computeCanonicalMetrics` que sirven las rutas v2: no hay una
 * segunda implementación del motor, así que la exactitud se preserva por
 * construcción.
 *
 * Sale del worker **solo una proyección agregada**: métricas comparables,
 * estados y quality. Nunca eventos crudos, padrón, bodies HTTP ni PII.
 */
import { parentPort, workerData } from 'node:worker_threads';

const PROTOCOL_VERSION = 2;

/**
 * Handshake sanitizado: permite comprobar que hilo principal y worker ejecutan
 * el mismo protocolo y el mismo contrato ANTES de aceptar resultados. No expone
 * rutas locales ni identificadores personales.
 */
export function buildHandshake(contractVersion) {
    return {
        protocolVersion: PROTOCOL_VERSION,
        contractVersion: contractVersion ?? null,
        engineModule: 'canonicalMetricsService.computeCanonicalMetrics',
        nodeMajor: Number(process.versions.node.split('.')[0]),
    };
}

let computeCanonicalMetrics = null;
let provider = null;
let initError = null;

try {
    const svc = await import('./canonicalMetricsService.mjs');
    const prov = await import('./metricsProvider.mjs');
    computeCanonicalMetrics = svc.computeCanonicalMetrics;
    // El provider abre SQLite en modo read-only y no crea schema.
    provider = prov.createMetricsProvider(workerData?.providerDeps ?? {});
} catch (e) {
    initError = e?.code ?? 'WORKER_INIT_FAILED';
}

/**
 * Proyección mínima que cruza el límite del worker. Solo lo que el comparador
 * necesita; nada más sale del hilo.
 */
function projectCanonical(body) {
    const m = body?.metrics ?? {};
    const val = (k) => (m[k] && typeof m[k].value === 'number' ? m[k].value : null);
    const st = (k) => (m[k] ? m[k].status ?? null : null);
    const pop = m.registeredUsers?.population ?? body?.population ?? null;
    return {
        contractVersion: body?.contractVersion ?? null,
        organizationId: body?.organizationId ?? null,
        period: body?.period ?? null,
        // comparables declaradas
        metrics: {
            sessions:         { value: val('sessions'),         status: st('sessions') },
            distinctContents: { value: val('distinctContents'), status: st('distinctContents') },
        },
        // estados canónicos: deben preservarse sin colapsar a cero
        statuses: {
            registeredUsers:   st('registeredUsers'),
            usersWithActivity: st('usersWithActivity'),
            activeReaders:     st('activeReaders'),
            readingTimeMs:     st('readingTimeMs'),
            platformTimeMs:    st('platformTimeMs'),
        },
        // agregados poblacionales: números, sin identidades
        population: pop ? {
            registeredUsers:     pop.registeredUsers ?? null,
            registeredReaders:   pop.registeredReaders ?? null,
            eligibleReaders:     pop.eligibleReaders ?? null,
            readersWithoutGroup: pop.readersWithoutGroup ?? null,
        } : null,
        quality: m.registeredUsers?.quality ?? body?.quality ?? null,
    };
}

parentPort?.on('message', async (msg) => {
    const jobId = msg?.jobId ?? null;
    const startedAt = Date.now();

    if (initError) {
        parentPort.postMessage({ jobId, protocolVersion: PROTOCOL_VERSION, ok: false,
            error: initError, durationMs: 0 });
        return;
    }
    if (msg?.protocolVersion !== PROTOCOL_VERSION) {
        parentPort.postMessage({ jobId, protocolVersion: PROTOCOL_VERSION, ok: false,
            error: 'PROTOCOL_VERSION_MISMATCH', durationMs: 0 });
        return;
    }

    if (msg.scopeKind === '__handshake__') {
        parentPort.postMessage({ jobId, protocolVersion: PROTOCOL_VERSION, ok: true,
            handshake: buildHandshake(null), durationMs: 0 });
        return;
    }

    try {
        const r = await computeCanonicalMetrics({
            scopeKind: msg.scopeKind,
            organizationId: msg.organizationId ?? null,
            groupId: msg.groupId ?? null,
            userId: msg.userId ?? null,
            period: msg.period ?? null,
            idleMs: msg.idleMs,
            includeQuality: msg.includeQuality !== false,
            provider,
            clock: () => msg.nowTs,
        });
        parentPort.postMessage({
            jobId, protocolVersion: PROTOCOL_VERSION, ok: true,
            status: r.status,
            // Sobre contractual completo. Contiene SOLO agregados
            // (contractVersion, period, metrics, population como conteos,
            // coverage, quality): ningún identificador ni PII. Devolverlo hace
            // la equivalencia verificable y deja la proyección a la frontera.
            body: r.body,
            projection: r.status === 200 ? projectCanonical(r.body) : null,
            handshake: buildHandshake(r.body?.contractVersion),
            durationMs: Date.now() - startedAt,
        });
    } catch (e) {
        // Error SANITIZADO: solo el código, nunca el mensaje del motor ni datos.
        parentPort.postMessage({
            jobId, protocolVersion: PROTOCOL_VERSION, ok: false,
            error: e?.code ?? 'CANONICAL_SOURCE_ERROR',
            durationMs: Date.now() - startedAt,
        });
    }
});

export { PROTOCOL_VERSION, projectCanonical };
