#!/usr/bin/env node
/**
 * loadtest/aula-viva-scenario.mjs — PASO 4 §16.
 *
 * Harness de carga REAL para Aula Viva sobre autocannon. Mide:
 *   - latencia p50/p95/p99 de endpoints clave
 *   - throughput requests/s
 *   - errores (status >= 500)
 *
 * NO inventa números. El operador corre esto contra staging/producción con
 * un objetivo concreto (concurrencia, duración) y reporta el output crudo.
 *
 * Uso:
 *   node loadtest/aula-viva-scenario.mjs \
 *     --target=http://localhost:3000 --connections=50 --duration=30
 *
 *   --connections    nº conexiones concurrentes (default 50)
 *   --duration       segundos (default 30)
 *   --pipelining     requests por conexión (default 1)
 *   --target         base URL
 *
 * Endpoints simulados (todos GET, no escriben):
 *   /api/health
 *   /api/health/analytics
 *   /api/health/ready
 *   /metrics                       (si METRICS_ENABLED=1)
 *
 * Para escenarios con escrituras (events/aula-viva CRUD) ver
 * loadtest/k6-chibalete.js (existente).
 */
import autocannon from 'autocannon';

function arg(key, fallback) {
    const f = process.argv.find(a => a.startsWith(`--${key}=`));
    return f ? f.split('=')[1] : fallback;
}

const target = arg('target', 'http://localhost:3000');
const connections = Number(arg('connections', '50'));
const duration = Number(arg('duration', '30'));
const pipelining = Number(arg('pipelining', '1'));

const requests = [
    { method: 'GET', path: '/api/health',           weight: 5 },
    { method: 'GET', path: '/api/health/analytics', weight: 2 },
    { method: 'GET', path: '/api/health/ready',     weight: 1 },
    { method: 'GET', path: '/metrics',              weight: 1 },
];

console.log(`[aula-viva-scenario] target=${target} c=${connections} d=${duration}s`);
console.log('[aula-viva-scenario] mix:', requests.map(r => `${r.path} (w=${r.weight})`).join(', '));

const instance = autocannon({
    url: target,
    connections,
    pipelining,
    duration,
    requests,
}, (err, result) => {
    if (err) { console.error('autocannon error:', err.message); process.exit(2); }
    // Imprime resumen estructurado para parsing.
    console.log('\n===== SUMMARY =====');
    console.log(JSON.stringify({
        url: target,
        connections, duration_s: duration, pipelining,
        latency: {
            p50: result.latency.p50, p90: result.latency.p90,
            p95: result.latency.p95, p99: result.latency.p99,
            max: result.latency.max, mean: result.latency.mean,
        },
        throughput: {
            requests_per_second: result.requests.average,
            total: result.requests.total,
            errors: result.errors,
            non2xx: result.non2xx,
            timeouts: result.timeouts,
        },
        bytes: {
            avg_per_sec: result.throughput.average,
            total: result.throughput.total,
        },
        finished_at: new Date().toISOString(),
    }, null, 2));
});

autocannon.track(instance, { renderProgressBar: true });
