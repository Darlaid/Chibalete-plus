/**
 * otelPropagation.test.mjs — CHP-SEC-JAEGER-EXC-01.
 *
 * Garantiza que el JaegerPropagator vulnerable (GHSA-45rx-2jwx-cxfr /
 * CVE-2026-59892) NO puede activarse: server/observability/otel.mjs fija un
 * textMapPropagator EXPLÍCITO (W3C TraceContext + W3C Baggage), por lo que el
 * NodeSDK ignora OTEL_PROPAGATORS. Ejecuta con OTEL_PROPAGATORS=jaeger para
 * probar el caso hostil. Sin collector/DSN/endpoints reales.
 *
 *   node server/__test__/otelPropagation.test.mjs
 */
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const P = (rel) => pathToFileURL(path.join(repoRoot, rel)).href;

// Caso hostil: se pide jaeger; el pin W3C debe ganar. Collector inexistente.
process.env.OTEL_ENABLED = '1';
process.env.OTEL_PROPAGATORS = 'jaeger';
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://127.0.0.1:4318';
process.env.OTEL_SAMPLE_RATIO = '0.05';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const api = await import(P('node_modules/@opentelemetry/api/build/src/index.js'));

// Arranca el preload real (fija propagador W3C global y el SDK).
await import(P('server/observability/otel.mjs'));
await new Promise(r => setTimeout(r, 500));

try {
    const fields = api.propagation.fields();

    console.log('\n[1] propagación W3C activa (entrada/salida)');
    ok('1a) fields incluye traceparent + tracestate', fields.includes('traceparent') && fields.includes('tracestate'));
    // Inyección de salida sobre un span activo sintético.
    const tracer = api.trace.getTracer('test');
    const span = tracer.startSpan('synthetic');
    const outCarrier = {};
    api.context.with(api.trace.setSpan(api.context.active(), span), () => {
        api.propagation.inject(api.context.active(), outCarrier);
    });
    span.end();
    ok('1b) inject emite traceparent (W3C salida)', typeof outCarrier.traceparent === 'string' && /^00-/.test(outCarrier.traceparent));
    ok('1c) inject NO emite uber-trace-id', !('uber-trace-id' in outCarrier) && !Object.keys(outCarrier).some(k => k.startsWith('uber')));
    // Extracción de entrada de un traceparent W3C válido.
    const inCtx = api.propagation.extract(api.context.active(), {
        traceparent: '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01',
    });
    const inSc = api.trace.getSpanContext(inCtx);
    ok('1d) extract de traceparent W3C crea contexto', !!inSc && inSc.traceId === '4bf92f3577b34da6a3ce929d0e0e4736');

    console.log('\n[2] baggage W3C');
    const bag = api.propagation.createBaggage
        ? api.propagation.createBaggage({ k: { value: 'v' } })
        : null;
    if (bag) {
        const bagCtx = api.propagation.setBaggage(api.context.active(), bag);
        const bagCarrier = {};
        api.propagation.inject(bagCtx, bagCarrier);
        ok('2a) baggage se propaga por header W3C `baggage`', bagCarrier.baggage === 'k=v');
        const rt = api.propagation.getBaggage(api.propagation.extract(api.context.active(), { baggage: 'a=b' }));
        ok('2b) baggage round-trip (extract)', !!rt && rt.getEntry('a')?.value === 'b');
    } else {
        ok('2a) baggage API presente', false, 'createBaggage ausente');
    }
    ok('2c) fields incluye baggage', fields.includes('baggage'));

    console.log('\n[3] OTEL_PROPAGATORS=jaeger NO altera el propagador');
    ok('3a) uber-trace-id NO es field activo', !fields.includes('uber-trace-id'));
    ok('3b) fields es exactamente W3C', JSON.stringify(fields.slice().sort()) === JSON.stringify(['baggage', 'traceparent', 'tracestate']));

    console.log('\n[4] header Jaeger benigno NO crea contexto');
    const jCtx = api.propagation.extract(api.context.active(), { 'uber-trace-id': 'abcd1234abcd1234:abcd1234:0:1' });
    ok('4a) uber-trace-id no produce spanContext', api.trace.getSpanContext(jCtx) === undefined);
    const juCtx = api.propagation.extract(api.context.active(), { 'uberctx-foo': 'bar' });
    ok('4b) uberctx-* no produce baggage', !api.propagation.getBaggage(juCtx) || !api.propagation.getBaggage(juCtx).getEntry('foo'));

    console.log('\n[5] Sentry posterior no activa Jaeger');
    const et = await import(P('server/observability/errorTracking.js'));
    // Init con DSN loopback (transport lazy; sin red síncrona) → probar que NO cambia el propagador.
    process.env.GLITCHTIP_DSN = 'http://public@127.0.0.1:9/1';
    // errorTracking lee DSN en import-time; re-init directo del SDK Sentry para el caso con DSN.
    let Sentry = null;
    try { Sentry = require('@sentry/node'); } catch { Sentry = null; }
    if (Sentry && Sentry.init) {
        Sentry.init({ dsn: process.env.GLITCHTIP_DSN, tracesSampleRate: 0, sendDefaultPii: false });
        const afterSentry = api.propagation.fields();
        ok('5a) tras Sentry.init, propagador sigue W3C (sin uber-trace-id)',
            !afterSentry.includes('uber-trace-id') && afterSentry.includes('traceparent'));
        await Sentry.close?.(500).catch(() => {});
    } else {
        ok('5a) Sentry SDK cargable', false, 'no se pudo importar @sentry/node');
    }
    ok('5b) errorTracking exporta initErrorTracking', typeof et.initErrorTracking === 'function');

    console.log('\n[7] baggage acotado (GHSA-8988): límites W3C en bytes UTF-8');
    {
        const getBag = (carrier) => api.propagation.getBaggage(api.propagation.extract(api.context.active(), carrier));
        const buildBaggage = (members) => members.map((v, i) => `k${i}=${v}`).join(',');
        const okBag = getBag({ baggage: 'a=1,b=2' });
        ok('7a) baggage válido se extrae', !!okBag && okBag.getEntry('a')?.value === '1' && okBag.getEntry('b')?.value === '2');
        let m0 = 'a'.repeat(4000), m1 = 'b'.repeat(4000);
        let base = buildBaggage([m0, m1]);
        let pad = 8192 - Buffer.byteLength(base + ',k2=', 'utf8');
        const at8192 = base + ',k2=' + 'c'.repeat(pad);
        ok('7b) baggage de exactamente 8192 bytes aceptado',
            Buffer.byteLength(at8192, 'utf8') === 8192 && !!getBag({ baggage: at8192 }) && getBag({ baggage: at8192 }).getEntry('k0')?.value === m0);
        const over = at8192 + 'x';
        ok('7c) baggage de 8193 bytes rechazado', Buffer.byteLength(over, 'utf8') === 8193 && getBag({ baggage: over }) === undefined);
        const many = Array.from({ length: 181 }, () => 'x').map((v, i) => `k${i}=${v}`).join(',');
        ok('7d) 181 miembros rechazado (>180)', many.split(',').length === 181 && getBag({ baggage: many }) === undefined);
        const bigMember = `k0=${'y'.repeat(4095)}`;
        ok('7e) miembro > 4096 bytes rechazado', Buffer.byteLength(bigMember, 'utf8') > 4096 && Buffer.byteLength(bigMember, 'utf8') < 8192 && getBag({ baggage: bigMember }) === undefined);
        const arrOk = getBag({ baggage: ['a=1', 'b=2'] });
        ok('7f) carrier string[] válido aceptado', !!arrOk && arrOk.getEntry('a')?.value === '1');
        const arrOver = getBag({ baggage: ['k0=' + 'a'.repeat(4093), 'k1=' + 'b'.repeat(4093)] });
        ok('7g) carrier string[] sobredimensionado rechazado', arrOver === undefined);
        const euro = '€'.repeat(1360);
        const multi = [euro, euro, euro].map((v, i) => `k${i}=${v}`).join(',');
        ok('7h) multibyte medido en bytes UTF-8 (rechazo por total)',
            multi.length < 8192 && Buffer.byteLength(multi, 'utf8') > 8192 && getBag({ baggage: multi }) === undefined);
        let threw = false;
        try { getBag({ baggage: 12345 }); getBag({ baggage: { x: 1 } }); } catch { threw = true; }
        ok('7i) forma inválida no lanza (contexto sin baggage)', !threw && getBag({ baggage: 12345 }) === undefined);
        ok('7j) fields() sigue incluyendo baggage', api.propagation.fields().includes('baggage'));
        ok('7k) baggage acotado operativo tras Sentry.init', !!getBag({ baggage: 'z=9' }) && getBag({ baggage: 'z=9' }).getEntry('z')?.value === '9');
    }

    console.log('\n[6] collector ausente no derriba + shutdown limpio');
    ok('6a) proceso vivo con collector inexistente', true);
    // El SDK de otel.mjs registró SIGTERM/SIGINT; forzamos un flush/shutdown limpio del provider global.
    const provider = api.trace.getTracerProvider();
    let shutdownOk = true;
    try { if (provider && typeof provider.shutdown === 'function') await provider.shutdown(); } catch { shutdownOk = false; }
    ok('6b) shutdown del provider sin excepción', shutdownOk);

    console.log(`\nRESULT: pass=${pass} fail=${fail}`);
    if (fail > 0) process.exitCode = 1;
    // Evita que los handlers SIGTERM/SIGINT de otel.mjs dejen el proceso colgado.
    setTimeout(() => process.exit(fail > 0 ? 1 : 0), 100);
} catch (e) {
    console.error('FATAL', e);
    process.exit(1);
}
