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
        const { Resource } = await import('@opentelemetry/resources');
        const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import('@opentelemetry/semantic-conventions');
        const { ParentBasedSampler, TraceIdRatioBasedSampler } = await import('@opentelemetry/sdk-trace-base');
        // Propagación FIJADA a W3C (core 1.x). Ver bloque textMapPropagator.
        const { CompositePropagator, W3CTraceContextPropagator, W3CBaggagePropagator } =
            await import('@opentelemetry/core');

        // ── Mitigación GHSA-8988-4f7v-96qf (@opentelemetry/core 1.x, MODERATE) ──
        // El W3CBaggagePropagator 1.30.1 hace split del header `baggage` completo
        // SIN acotar longitud total, número de miembros ni tamaño por miembro
        // (las constantes W3C existen pero solo se usan al inyectar) → parsing no
        // acotado. El fix oficial está en OTel 2.8+, inalcanzable mientras
        // @sentry/node v8 fija OTel 1.x. Aquí envolvemos la EXTRACCIÓN con los
        // mismos límites del spec W3C, medidos en bytes UTF-8, ANTES de split/join.
        // Header sobredimensionado o malformado → contexto SIN baggage, sin lanzar
        // ni registrar el contenido. La inyección y fields() se delegan intactos.
        const BAGGAGE_HEADER = 'baggage';
        const BAGGAGE_MAX_TOTAL_BYTES = 8192;   // BAGGAGE_MAX_TOTAL_LENGTH
        const BAGGAGE_MAX_MEMBERS = 180;        // BAGGAGE_MAX_NAME_VALUE_PAIRS
        const BAGGAGE_MAX_PER_MEMBER_BYTES = 4096; // BAGGAGE_MAX_PER_NAME_VALUE_PAIRS
        const utf8 = (s) => Buffer.byteLength(s, 'utf8');
        const boundedBaggagePropagator = (inner) => ({
            fields: () => inner.fields(),
            inject: (ctx, carrier, setter) => inner.inject(ctx, carrier, setter),
            extract: (ctx, carrier, getter) => {
                try {
                    const raw = getter.get(carrier, BAGGAGE_HEADER);
                    if (raw == null) return ctx;
                    // 1) Tamaño total en bytes UTF-8 ANTES de join/split.
                    let joined;
                    if (Array.isArray(raw)) {
                        let total = 0;
                        for (const el of raw) {
                            if (typeof el !== 'string') return ctx;
                            total += utf8(el);
                            if (total > BAGGAGE_MAX_TOTAL_BYTES) return ctx;
                        }
                        total += Math.max(0, raw.length - 1); // separadores ','
                        if (total > BAGGAGE_MAX_TOTAL_BYTES) return ctx;
                        joined = raw.join(',');
                    } else if (typeof raw === 'string') {
                        if (utf8(raw) > BAGGAGE_MAX_TOTAL_BYTES) return ctx;
                        joined = raw;
                    } else {
                        return ctx;
                    }
                    if (joined.length === 0) return ctx;
                    // 2) Nº de miembros y tamaño por miembro (ya acotado ≤8192 bytes).
                    const members = joined.split(',');
                    if (members.length > BAGGAGE_MAX_MEMBERS) return ctx;
                    for (const m of members) {
                        if (utf8(m) > BAGGAGE_MAX_PER_MEMBER_BYTES) return ctx;
                    }
                    // 3) Dentro de límites → delegar en el propagador W3C real.
                    return inner.extract(ctx, carrier, getter);
                } catch {
                    return ctx; // nunca lanza; no registra el contenido del header
                }
            },
        });

        const ratio = Number.parseFloat(process.env.OTEL_SAMPLE_RATIO ?? '0.05');
        const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://jaeger:4318';

        const sdk = new NodeSDK({
            resource: new Resource({
                [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'chibalete-api',
                [ATTR_SERVICE_VERSION]: process.env.CHIBALETE_RELEASE || 'unknown',
                'service.instance.id': process.env.HOSTNAME || 'local',
            }),
            traceExporter: new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
            sampler: new ParentBasedSampler({
                root: new TraceIdRatioBasedSampler(Number.isFinite(ratio) ? ratio : 0.05),
            }),
            // ── Propagación fijada a W3C Trace Context + Baggage ──────────────
            // Se pasa `textMapPropagator` EXPLÍCITO al SDK: cuando está definido,
            // NodeSDK lo usa y NO consulta la env `OTEL_PROPAGATORS`. Esto neutraliza
            // GHSA-45rx-2jwx-cxfr / CVE-2026-59892 (DoS en JaegerPropagator vía
            // `uber-trace-id`/`uberctx-*` malformado): aunque OTEL_PROPAGATORS=jaeger,
            // el JaegerPropagator jamás se instancia ni queda activo. `uber-trace-id`
            // no es un field propagado; un header Jaeger no crea contexto.
            textMapPropagator: new CompositePropagator({
                propagators: [
                    new W3CTraceContextPropagator(),
                    boundedBaggagePropagator(new W3CBaggagePropagator()), // GHSA-8988 acotado
                ],
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
