/**
 * bench-probe.mjs — CHP-STATS-SHADOW-PERF-01D.
 *
 * Sonda de observación **exclusiva del banco de pruebas**. Se activa con
 *
 *     NODE_OPTIONS="--import ./scripts/perf/bench-probe.mjs"
 *
 * y nunca forma parte del arranque productivo. Expone, en un puerto de la red
 * interna del banco (jamás publicado al host), lo que la Fase 7 y la Fase 9
 * exigen medir del lado del servidor:
 *
 *   · contadores del ejecutor shadow y del pool de workers;
 *   · profundidad de cola, jobs iniciados/completados/descartados, crashes;
 *   · retraso del event loop (histograma de alta resolución, reseteable);
 *   · CPU por hilo del sistema operativo, leída de `/proc/self/task`;
 *   · RSS, heap y memoria externa; descriptores y handles activos.
 *
 * Cero PII: solo números y nombres de hilo. Nunca lee bodies, identificadores
 * ni eventos.
 */
import { register } from 'node:module';
import { isMainThread, threadId } from 'node:worker_threads';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import v8 from 'node:v8';

// Defaults SEGUROS: escritura relativa al cwd y escucha solo en loopback. El
// entorno aislado de benchmark sobreescribe ambos (`BENCH_RESULTS_DIR=/results`,
// `BENCH_PROBE_HOST=0.0.0.0`) porque allí la sonda se consulta desde otro
// contenedor de una red interna sin puertos publicados. Fuera de ese entorno la
// sonda no debe quedar expuesta a la red por omisión.
const RESULTS_DIR = process.env.BENCH_RESULTS_DIR || './bench-results';
const PROBE_PORT  = Number(process.env.BENCH_PROBE_PORT || 9110);
const PROBE_HOST  = process.env.BENCH_PROBE_HOST || '127.0.0.1';
const INSTANCE    = process.env.BENCH_INSTANCE || 'api';

// ── retraso del event loop ──────────────────────────────────────────────────
// `resolution: 5` da grano fino sin coste apreciable; el histograma se resetea
// entre fases para que el warm-up no contamine el steady state.
const lag = monitorEventLoopDelay({ resolution: 5 });
lag.enable();

let cpuBaseline = process.cpuUsage();
let cpuBaselineAt = performance.now();

const NS_TO_MS = (ns) => Math.round((ns / 1e6) * 1000) / 1000;

function lagSnapshot() {
    return {
        min:  NS_TO_MS(lag.min === Number.MAX_SAFE_INTEGER ? 0 : lag.min),
        mean: NS_TO_MS(Number.isFinite(lag.mean) ? lag.mean : 0),
        p50:  NS_TO_MS(lag.percentile(50)),
        p90:  NS_TO_MS(lag.percentile(90)),
        p95:  NS_TO_MS(lag.percentile(95)),
        p99:  NS_TO_MS(lag.percentile(99)),
        max:  NS_TO_MS(lag.max),
        samples: lag.count,
    };
}

/**
 * CPU por hilo del SO. Un worker thread de Node es un hilo del proceso, así que
 * `process.cpuUsage()` los suma: para separar hilo principal de worker hay que
 * bajar a `/proc/self/task`. `utime`/`stime` vienen en ticks (campos 14 y 15 de
 * `stat`); `comm` (campo 2) puede contener espacios, por eso se corta por el
 * último ')'.
 */
function threadCpu() {
    const out = [];
    let ticksPerSec = 100;                       // USER_HZ en Linux x86_64
    try {
        for (const tid of fs.readdirSync('/proc/self/task')) {
            const raw = fs.readFileSync(`/proc/self/task/${tid}/stat`, 'utf8');
            const close = raw.lastIndexOf(')');
            const comm = raw.slice(raw.indexOf('(') + 1, close);
            const rest = raw.slice(close + 2).split(' ');
            // rest[0] es el campo 3 (state); utime = campo 14 → rest[11].
            out.push({
                tid: Number(tid),
                comm,
                utimeMs: (Number(rest[11]) / ticksPerSec) * 1000,
                stimeMs: (Number(rest[12]) / ticksPerSec) * 1000,
            });
        }
    } catch { /* no-Linux o /proc no montado: se devuelve lo que haya */ }
    return out;
}

function fdCount() {
    try { return fs.readdirSync('/proc/self/fd').length; } catch { return null; }
}

/** Contadores del shadow, leídos de las instancias que registró el loader. */
function shadowSnapshot() {
    const reg = globalThis.__CHP_BENCH__ ?? { executors: [], pools: [] };
    const executors = reg.executors.map((e) => {
        let stats = null;
        try { stats = e.stats(); } catch { /* noop */ }
        return { counters: e.counters, stats };
    });
    const pools = reg.pools.map((p) => {
        let stats = null;
        try { stats = p.stats(); } catch { /* noop */ }
        return { counters: p.counters, stats };
    });
    return { executors, pools, executorCount: executors.length, poolCount: pools.length };
}

function fullSnapshot() {
    const mem = process.memoryUsage();
    const cpu = process.cpuUsage(cpuBaseline);
    const wallMs = performance.now() - cpuBaselineAt;
    return {
        instance: INSTANCE,
        threadId,
        wallMs: Math.round(wallMs),
        lag: lagSnapshot(),
        cpu: {
            userMs: Math.round(cpu.user / 1000),
            systemMs: Math.round(cpu.system / 1000),
            // Fracción de UN núcleo consumida por el proceso completo.
            coresUsed: wallMs > 0 ? Math.round(((cpu.user + cpu.system) / 1000 / wallMs) * 1000) / 1000 : 0,
        },
        threads: threadCpu(),
        memory: {
            rss: mem.rss,
            heapTotal: mem.heapTotal,
            heapUsed: mem.heapUsed,
            external: mem.external,
            arrayBuffers: mem.arrayBuffers,
        },
        heapStats: v8.getHeapStatistics(),
        handles: typeof process._getActiveHandles === 'function' ? process._getActiveHandles().length : null,
        requests: typeof process._getActiveRequests === 'function' ? process._getActiveRequests().length : null,
        fds: fdCount(),
        shadow: shadowSnapshot(),
    };
}

/** ¿Queda trabajo shadow pendiente? Base del endpoint `/drain`. */
function pendingWork() {
    const { executors, pools } = shadowSnapshot();
    let pending = 0;
    for (const e of executors) pending += (e.stats?.queueDepth ?? 0) + (e.stats?.active ?? 0);
    for (const p of pools) pending += (p.stats?.queueDepth ?? 0) + (p.stats?.inFlight ?? 0);
    return pending;
}

if (isMainThread) {
    // El hook debe registrarse ANTES de que `server.js` importe los módulos de
    // métricas. `--import` garantiza que esta sonda se evalúa primero.
    register('./bench-loader.mjs', import.meta.url);

    const send = (res, code, payload) => {
        const body = JSON.stringify(payload);
        res.writeHead(code, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
        res.end(body);
    };

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://probe');
        if (url.pathname === '/probe')  return send(res, 200, fullSnapshot());
        if (url.pathname === '/reset') {
            lag.reset();
            cpuBaseline = process.cpuUsage();
            cpuBaselineAt = performance.now();
            return send(res, 200, { reset: true });
        }
        if (url.pathname === '/drain') {
            // Espera activa acotada: nunca bloquea el banco indefinidamente.
            const deadline = Date.now() + Number(url.searchParams.get('timeoutMs') || 30_000);
            while (pendingWork() > 0 && Date.now() < deadline) {
                await new Promise((r) => setTimeout(r, 25));
            }
            return send(res, 200, { drained: pendingWork() === 0, pending: pendingWork() });
        }
        if (url.pathname === '/gc') {
            if (typeof global.gc === 'function') { global.gc(); return send(res, 200, { gc: true }); }
            return send(res, 200, { gc: false, reason: 'expose-gc no activo' });
        }
        return send(res, 404, { error: 'unknown probe route' });
    });

    // Un choque de puerto NO puede tumbar el proceso: cualquier `node` lanzado
    // dentro del contenedor hereda `NODE_OPTIONS` y volvería a cargar la sonda.
    // En ese caso la sonda queda muda y el proceso sigue su curso.
    server.on('error', () => { /* sonda inerte en este proceso */ });
    server.unref();                              // la sonda no mantiene vivo al proceso
    server.listen(PROBE_PORT, PROBE_HOST);
} else {
    // Hilo worker: no puede abrir el mismo puerto ni escribir en el canal de
    // mensajes del pool (rompería el protocolo). Vuelca muestras a fichero.
    const file = path.join(RESULTS_DIR, `worker-${INSTANCE}-${threadId}.ndjson`);
    const timer = setInterval(() => {
        const mem = process.memoryUsage();
        const line = JSON.stringify({
            ts: Date.now(), threadId,
            // `rss` es del proceso; `heapUsed`/`heapTotal` sí son de este isolate.
            heapUsed: mem.heapUsed, heapTotal: mem.heapTotal, external: mem.external, rss: mem.rss,
            lag: lagSnapshot(),
        });
        try { fs.appendFileSync(file, line + '\n'); } catch { /* results no montado */ }
    }, 500);
    timer.unref();
}
