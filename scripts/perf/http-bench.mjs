/**
 * http-bench.mjs — CHP-STATS-SHADOW-PERF-01D.
 *
 * Cliente HTTP de aceptación. Mide la **respuesta pública** desde fuera del
 * proceso servidor, que es el único punto de vista que puede demostrar que el
 * shadow no la retrasa.
 *
 * Principios de la medición:
 *   · warm-up, steady state y drenaje son fases SEPARADAS y nunca se mezclan;
 *   · el orden de rutas se baraja de forma **determinística** a partir de una
 *     semilla, y la misma semilla produce el mismo orden en legacy y en shadow;
 *   · se mide tiempo hasta el primer byte y hasta el body completo;
 *   · un fallo de transporte se cuenta, no se descarta en silencio.
 *
 * No imprime cabeceras, identificadores ni bodies: la evidencia sale con
 * etiquetas ROUTE_N y agregados.
 *
 * Uso:
 *   node http-bench.mjs --manifest m.json --mode steady --out r.json \
 *        --warmup 20 --measure 100 --seed 1234 --concurrency 1
 */
import http from 'node:http';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';
import { guardFromArgs, UnsafeTargetError } from './target-guard.mjs';

// ── argumentos ──────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (!a.startsWith('--')) continue;
        const key = a.slice(2);
        const next = argv[i + 1];
        if (next === undefined || next.startsWith('--')) { out[key] = true; }
        else { out[key] = next; i++; }
    }
    return out;
}
const args = parseArgs(process.argv);
const need = (k) => {
    if (args[k] === undefined) { console.error(`falta --${k}`); process.exit(2); }
    return args[k];
};

const manifest    = JSON.parse(fs.readFileSync(need('manifest'), 'utf8'));

// Destino por defecto LOCAL, y cualquier host externo exige confirmación
// explícita. Este script genera carga sostenida: apuntarlo por descuido a un
// entorno real sería una denegación de servicio.
manifest.host = manifest.host || '127.0.0.1';
manifest.port = manifest.port || 3000;
try {
    const { classification } = guardFromArgs(manifest.host, args);
    if (classification === 'remote') {
        console.error(`AVISO: destino remoto confirmado explícitamente (${manifest.host}).`);
    }
} catch (e) {
    if (e instanceof UnsafeTargetError) { console.error(`\n${e.message}\n`); process.exit(3); }
    throw e;
}
const MODE        = String(args.mode || 'steady');
const WARMUP      = Number(args.warmup ?? 20);
const MEASURE     = Number(args.measure ?? 100);
const SEED        = Number(args.seed ?? 1234);
const CONCURRENCY = Number(args.concurrency ?? 1);
const TIMEOUT_MS  = Number(args.timeoutMs ?? 30_000);
const LABEL       = String(args.label || 'run');
const CAPTURE_N   = Number(args.captureBodies ?? 0);

// ── PRNG determinístico (mulberry32) ────────────────────────────────────────
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Fisher-Yates con PRNG sembrado: mismo seed → misma permutación. */
function shuffle(items, rand) {
    const a = items.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(rand() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

// ── cliente ─────────────────────────────────────────────────────────────────
const agent = new http.Agent({ keepAlive: true, maxSockets: Math.max(1, CONCURRENCY), maxFreeSockets: Math.max(1, CONCURRENCY) });

/**
 * Una petición. Devuelve tiempos y estado; el body solo se conserva si se pide
 * expresamente (comparación de integridad de la Fase 15) y nunca se imprime.
 */
function request(route, { keepBody = false } = {}) {
    return new Promise((resolve) => {
        const startedAt = performance.now();
        let ttfb = null;
        const chunks = [];
        let bytes = 0;

        const req = http.request({
            host: manifest.host,
            port: manifest.port,
            path: route.path,
            method: route.method || 'GET',
            headers: route.headers || {},
            agent,
        }, (res) => {
            ttfb = performance.now() - startedAt;
            res.on('data', (c) => { bytes += c.length; if (keepBody) chunks.push(c); });
            res.on('end', () => {
                const total = performance.now() - startedAt;
                const body = keepBody ? Buffer.concat(chunks).toString('utf8') : null;
                resolve({
                    id: route.id, status: res.statusCode, ttfb, total, bytes,
                    error: null, aborted: !res.complete,
                    bodyHash: keepBody ? crypto.createHash('sha256').update(body).digest('hex') : null,
                    body: keepBody ? body : null,
                });
            });
        });

        req.setTimeout(TIMEOUT_MS, () => {
            req.destroy(new Error('TIMEOUT'));
        });
        req.on('error', (e) => {
            resolve({
                id: route.id, status: null, ttfb, total: performance.now() - startedAt,
                bytes, error: e.message === 'TIMEOUT' ? 'TIMEOUT' : (e.code || 'TRANSPORT_ERROR'),
                aborted: true, bodyHash: null, body: null,
            });
        });
        req.end();
    });
}

// ── estadística ─────────────────────────────────────────────────────────────
function percentile(sorted, p) {
    if (sorted.length === 0) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
    return Math.round(sorted[idx] * 100) / 100;
}

function summarize(samples) {
    const okSamples = samples.filter((s) => s.error === null);
    const totals = okSamples.map((s) => s.total).sort((a, b) => a - b);
    const ttfbs  = okSamples.map((s) => s.ttfb).filter((v) => v != null).sort((a, b) => a - b);
    const round = (v) => (v == null ? null : Math.round(v * 100) / 100);
    return {
        count: samples.length,
        ok: okSamples.length,
        errors: samples.length - okSamples.length,
        timeouts: samples.filter((s) => s.error === 'TIMEOUT').length,
        transportErrors: samples.filter((s) => s.error && s.error !== 'TIMEOUT').length,
        aborted: samples.filter((s) => s.aborted && s.error === null).length,
        statusCounts: samples.reduce((acc, s) => { const k = String(s.status ?? 'ERR'); acc[k] = (acc[k] || 0) + 1; return acc; }, {}),
        total: {
            p50: percentile(totals, 50), p90: percentile(totals, 90), p95: percentile(totals, 95),
            p99: percentile(totals, 99), max: round(totals[totals.length - 1]), min: round(totals[0]),
            mean: totals.length ? round(totals.reduce((a, b) => a + b, 0) / totals.length) : null,
        },
        ttfb: {
            p50: percentile(ttfbs, 50), p95: percentile(ttfbs, 95), p99: percentile(ttfbs, 99),
            max: round(ttfbs[ttfbs.length - 1]),
        },
    };
}

// ── modos ───────────────────────────────────────────────────────────────────

/**
 * Steady state: warm-up y medición separados, orden barajado de forma
 * determinística. Se recorre en oleadas donde cada oleada contiene una petición
 * por ruta, de modo que ninguna ruta monopoliza un tramo temporal del ensayo.
 */
async function runSteady() {
    const routes = manifest.routes;
    const rand = mulberry32(SEED);

    const doWave = async (waveIndex, keepBodyFor) => {
        const order = shuffle(routes, rand);
        const results = [];
        if (CONCURRENCY <= 1) {
            for (const r of order) {
                results.push(await request(r, { keepBody: keepBodyFor.has(`${r.id}:${waveIndex}`) }));
            }
        } else {
            for (let i = 0; i < order.length; i += CONCURRENCY) {
                const slice = order.slice(i, i + CONCURRENCY);
                results.push(...await Promise.all(slice.map((r) =>
                    request(r, { keepBody: keepBodyFor.has(`${r.id}:${waveIndex}`) }))));
            }
        }
        return results;
    };

    // Muestras de body a capturar: determinísticas (primeras N oleadas medidas).
    const keepBodyFor = new Set();
    for (let w = 0; w < CAPTURE_N; w++) for (const r of routes) keepBodyFor.add(`${r.id}:${w}`);

    const warmSamples = [];
    for (let w = 0; w < WARMUP; w++) warmSamples.push(...await doWave(w, new Set()));

    const startedAt = performance.now();
    const samples = [];
    for (let w = 0; w < MEASURE; w++) samples.push(...await doWave(w, keepBodyFor));
    const elapsedMs = performance.now() - startedAt;

    const byRoute = {};
    for (const r of manifest.routes) {
        byRoute[r.id] = summarize(samples.filter((s) => s.id === r.id));
    }

    const bodies = samples
        .filter((s) => s.body != null)
        .map((s) => ({ id: s.id, status: s.status, bodyHash: s.bodyHash, body: s.body }));

    // Muestras crudas por ruta. Permiten AGRUPAR varias repeticiones antes de
    // calcular el percentil: con rutas de alta varianza, un p95 sobre 300
    // muestras es mucho más estable que la mediana de tres p95 sobre 100.
    // Son números, sin identificadores.
    const raw = {};
    for (const r of routes) {
        raw[r.id] = samples.filter((s) => s.id === r.id && s.error === null)
            .map((s) => Math.round(s.total * 100) / 100);
    }

    return {
        label: LABEL, mode: 'steady', seed: SEED, concurrency: CONCURRENCY,
        warmupWaves: WARMUP, measuredWaves: MEASURE,
        routeCount: routes.length,
        requestsMeasured: samples.length,
        warmupRequests: warmSamples.length,
        elapsedMs: Math.round(elapsedMs),
        throughputRps: Math.round((samples.length / (elapsedMs / 1000)) * 100) / 100,
        byRoute,
        overall: summarize(samples),
        raw,
        bodies,
    };
}

/**
 * Contención posterior a la respuesta (Fase 8).
 *
 * Secuencia por iteración:
 *   1. REQUEST_A sobre una ruta muestreada; al terminar, el worker arranca.
 *   2. tras `delayMs`, llegan REQUEST_B y REQUEST_C mientras el worker calcula.
 *   3. tras el drenaje, una petición de control sobre la misma ruta.
 *
 * El umbral se aplica a B y C, no solo a A: es donde se manifiesta la
 * competencia de CPU aunque A ya haya respondido.
 */
async function runContention() {
    const trigger = manifest.routes.find((r) => r.id === (args.triggerRoute || manifest.contention?.trigger));
    const followers = (manifest.contention?.followers || []).map((id) => manifest.routes.find((r) => r.id === id)).filter(Boolean);
    if (!trigger || followers.length === 0) { console.error('manifiesto sin contention.trigger/followers'); process.exit(2); }

    const delays = (args.delays ? String(args.delays).split(',') : (manifest.contention?.delaysMs || [0, 10, 25, 50, 100, 200])).map(Number);
    const iterations = Number(args.iterations ?? 25);

    // Warm-up sin medir.
    for (let i = 0; i < 5; i++) { await request(trigger); for (const f of followers) await request(f); }

    const byDelay = {};
    for (const delayMs of delays) {
        const followerSamples = [];
        const triggerSamples = [];
        for (let i = 0; i < iterations; i++) {
            triggerSamples.push(await request(trigger));        // REQUEST_A
            if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
            for (const f of followers) followerSamples.push(await request(f));   // B, C
            // Espacio entre iteraciones para que la cola drene.
            await new Promise((r) => setTimeout(r, Number(args.settleMs ?? 1200)));
        }
        byDelay[String(delayMs)] = {
            trigger: summarize(triggerSamples),
            followers: followers.reduce((acc, f) => {
                acc[f.id] = summarize(followerSamples.filter((s) => s.id === f.id));
                return acc;
            }, {}),
        };
    }

    return { label: LABEL, mode: 'contention', seed: SEED, iterations, delays, byDelay };
}

/** Carga sostenida: para 5×/10× y para provocar cola llena / breaker. */
async function runSustained() {
    const routes = manifest.routes;
    const rand = mulberry32(SEED);
    const durationMs = Number(args.durationMs ?? 60_000);
    const conc = Math.max(1, CONCURRENCY);

    for (let w = 0; w < 3; w++) for (const r of shuffle(routes, rand)) await request(r);

    const samples = [];
    const startedAt = performance.now();
    const deadline = startedAt + durationMs;

    const worker = async () => {
        const localRand = mulberry32(SEED + 1);
        while (performance.now() < deadline) {
            const r = routes[Math.floor(localRand() * routes.length)];
            samples.push(await request(r));
        }
    };
    await Promise.all(Array.from({ length: conc }, worker));
    const elapsedMs = performance.now() - startedAt;

    const byRoute = {};
    for (const r of routes) byRoute[r.id] = summarize(samples.filter((s) => s.id === r.id));
    return {
        label: LABEL, mode: 'sustained', seed: SEED, concurrency: conc,
        durationMs: Math.round(elapsedMs), requestsMeasured: samples.length,
        throughputRps: Math.round((samples.length / (elapsedMs / 1000)) * 100) / 100,
        byRoute, overall: summarize(samples),
    };
}

// ── main ────────────────────────────────────────────────────────────────────
const run = MODE === 'contention' ? runContention : MODE === 'sustained' ? runSustained : runSteady;
const result = await run();
result.generatedAtWall = new Date().toISOString();
result.manifestName = manifest.name ?? null;

const out = args.out ? String(args.out) : null;
if (out) fs.writeFileSync(out, JSON.stringify(result, null, 2));

// A stdout va SIEMPRE la versión sin bodies: la evidencia legible no puede
// contener respuestas con identificadores.
const { bodies, ...printable } = result;
console.log(JSON.stringify(printable, null, 2));
agent.destroy();
