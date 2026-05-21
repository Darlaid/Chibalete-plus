/**
 * otel.mjs — P2-A OpenTelemetry preload (tracing distribuido).
 *
 * Se carga ANTES del server vía `node --import ./server/observability/otel.mjs
 * server/server.js` (script npm `start:otel`). NO se importa desde server.js
 * → cero edición del hot-path; rollback = volver al `npm run server` normal.
 *
 * INERTE por defecto: si OTEL_ENABLED!=1 NO inicializa NADA (cero overhead,
 * cero spans). Perf-aware: sampler parent-based + ratio bajo (5% default),
 * solo http+express instrumentados (fs/dns/net ruidosos desactivados).
 *
 * Env:
 *   OTEL_ENABLED=1
 *   OTEL_EXPORTER_OTLP_ENDPOINT  (default http://jaeger:4318)  ← contenedor jaeger
 *   OTEL_SAMPLE_RATIO            (default 0.05)
 *   OTEL_SERVICE_NAME            (default chibalete-api)
 */
const ENABLED = process.env.OTEL_ENABLED === '1';

if (ENABLED) {
    try {
        const { NodeSDK } = await import('@opentelemetry/sdk-node');
        const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
        const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
        const { resourceFromAttributes } = await import('@opentelemetry/resources');
        const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import('@opentelemetry/semantic-conventions');
        const { ParentBasedSampler, TraceIdRatioBasedSampler } = await import('@opentelemetry/sdk-trace-base');

        const ratio = Number.parseFloat(process.env.OTEL_SAMPLE_RATIO ?? '0.05');
        const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://jaeger:4318';

        const sdk = new NodeSDK({
            resource: resourceFromAttributes({
                [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'chibalete-api',
                [ATTR_SERVICE_VERSION]: process.env.CHIBALETE_RELEASE || 'unknown',
                'service.instance.id': process.env.HOSTNAME || 'local',
            }),
            traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
            sampler: new ParentBasedSampler({
                root: new TraceIdRatioBasedSampler(Number.isFinite(ratio) ? ratio : 0.05),
            }),
            instrumentations: [getNodeAutoInstrumentations({
                // Señal alta, ruido bajo: solo borde HTTP + framework.
                '@opentelemetry/instrumentation-http': { enabled: true },
                '@opentelemetry/instrumentation-express': { enabled: true },
                '@opentelemetry/instrumentation-fs': { enabled: false },
                '@opentelemetry/instrumentation-dns': { enabled: false },
                '@opentelemetry/instrumentation-net': { enabled: false },
            })],
        });
        sdk.start();
        // eslint-disable-next-line no-console
        console.log(`[otel] tracing ON ratio=${ratio} endpoint=${endpoint}`);
        const shutdown = () => sdk.shutdown().finally(() => process.exit(0));
        process.once('SIGTERM', shutdown);
        process.once('SIGINT', shutdown);
    } catch (e) {
        // OTel JAMÁS debe impedir el arranque del API. Degradar a sin-tracing.
        // eslint-disable-next-line no-console
        console.error(`[otel] init failed, continuing WITHOUT tracing: ${e.message}`);
    }
} else {
    // eslint-disable-next-line no-console
    console.log('[otel] disabled (OTEL_ENABLED!=1) — inerte');
}
