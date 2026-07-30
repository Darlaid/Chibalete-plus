/**
 * legacy-bench-probe.mjs — CHP-STATS-LEGACY-PERF-01E.
 *
 * Sonda de observación del lado servidor, **exclusiva del banco de pruebas**.
 * Se activa con
 *
 *     NODE_OPTIONS="--import ./scripts/perf/legacy-bench-probe.mjs"
 *
 * y nunca forma parte del arranque productivo.
 *
 * A diferencia del caso del shadow, aquí no hace falta ningún hook de carga:
 * `metricsContextCounters` es un objeto exportado a nivel de módulo, así que la
 * sonda simplemente importa `metricsService` y lo lee. Menos maquinaria, menos
 * que pueda romperse.
 *
 * Expone contadores del contexto, retraso del event loop, CPU y memoria. Cero
 * PII: solo números.
 */
import { isMainThread } from 'node:worker_threads';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import http from 'node:http';
import fs from 'node:fs';
import v8 from 'node:v8';

const PROBE_PORT = Number(process.env.BENCH_PROBE_PORT || 9120);
const PROBE_HOST = process.env.BENCH_PROBE_HOST || '127.0.0.1';
const INSTANCE   = process.env.BENCH_INSTANCE || 'api';

const lag = monitorEventLoopDelay({ resolution: 5 });
lag.enable();
let cpuBaseline = process.cpuUsage();
let cpuBaselineAt = performance.now();

const NS_MS = (ns) => Math.round((ns / 1e6) * 1000) / 1000;
const lagSnapshot = () => ({
    p50: NS_MS(lag.percentile(50)), p90: NS_MS(lag.percentile(90)),
    p95: NS_MS(lag.percentile(95)), p99: NS_MS(lag.percentile(99)),
    max: NS_MS(lag.max), mean: NS_MS(Number.isFinite(lag.mean) ? lag.mean : 0),
    samples: lag.count,
});

/** Se importa perezosamente: si el servidor aún no lo cargó, se reintenta. */
let counters = null;
async function loadCounters() {
    if (counters) return counters;
    try {
        const m = await import('../../server/metricsService.js');
        counters = m.metricsContextCounters ?? null;
    } catch { counters = null; }
    return counters;
}

function fdCount() { try { return fs.readdirSync('/proc/self/fd').length; } catch { return null; } }

async function snapshot() {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage(cpuBaseline);
    const wallMs = performance.now() - cpuBaselineAt;
    const c = await loadCounters();
    return {
        instance: INSTANCE,
        wallMs: Math.round(wallMs),
        lag: lagSnapshot(),
        cpu: {
            userMs: Math.round(cpu.user / 1000),
            systemMs: Math.round(cpu.system / 1000),
            coresUsed: wallMs > 0 ? Math.round(((cpu.user + cpu.system) / 1000 / wallMs) * 1000) / 1000 : 0,
        },
        memory: { rss: mem.rss, heapTotal: mem.heapTotal, heapUsed: mem.heapUsed, external: mem.external },
        heapStats: v8.getHeapStatistics(),
        handles: typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : null,
        fds: fdCount(),
        // Copia, no referencia: el consumidor no puede alterar los contadores.
        context: c ? { ...c } : null,
    };
}

if (isMainThread) {
    const send = (res, code, payload) => {
        const body = JSON.stringify(payload);
        res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
        res.end(body);
    };
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://probe');
        if (url.pathname === '/probe') return send(res, 200, await snapshot());
        if (url.pathname === '/reset') {
            lag.reset(); cpuBaseline = process.cpuUsage(); cpuBaselineAt = performance.now();
            return send(res, 200, { reset: true });
        }
        if (url.pathname === '/gc') {
            if (typeof global.gc === 'function') { global.gc(); return send(res, 200, { gc: true }); }
            return send(res, 200, { gc: false, reason: 'expose-gc no activo' });
        }
        return send(res, 404, { error: 'unknown probe route' });
    });
    // Un choque de puerto no puede tumbar el proceso: cualquier `node` lanzado
    // dentro del contenedor hereda NODE_OPTIONS y recargaría esta sonda.
    server.on('error', () => {});
    server.unref();
    server.listen(PROBE_PORT, PROBE_HOST);
}
