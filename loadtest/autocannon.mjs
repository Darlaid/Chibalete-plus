/**
 * autocannon.mjs — P3-A smoke de carga rápido (latencia/throughput) sobre el
 * path liviano más caliente. Complementa k6 (k6 = escenarios realistas;
 * autocannon = micro-benchmark de un endpoint con gate p99).
 *
 *   node loadtest/autocannon.mjs                    # local :3000 /api/health
 *   BASE=http://localhost:3000 CONN=50 DUR=30 node loadtest/autocannon.mjs
 *
 * NO es benchmark artificial: /api/health es exactamente lo que el edge y
 * los monitores externos golpean en producción cada pocos segundos.
 */
import autocannon from 'autocannon';

const BASE = process.env.BASE || 'http://localhost:3000';
const url  = `${BASE}/api/health`;
const opts = {
    url,
    connections: Number(process.env.CONN || 50),
    duration: Number(process.env.DUR || 20),
    headers: { 'content-type': 'application/json' },
};

console.log(`[autocannon] ${url} conn=${opts.connections} dur=${opts.duration}s`);
const r = await autocannon(opts);
const p99 = r.latency.p99, p95 = r.latency.p95, rps = r.requests.average, non2xx = r.non2xx;
console.log(JSON.stringify({
    rps: Math.round(rps), p95_ms: p95, p99_ms: p99, errors: r.errors, non2xx,
    timeouts: r.timeouts,
}, null, 2));

// Gate operacional: health debe ser barato y estable bajo carga.
const ok = p99 <= 50 && non2xx === 0 && r.timeouts === 0;
console.log(ok ? '[autocannon] PASS (p99<=50ms, 0 non2xx)' : '[autocannon] FAIL — investigar saturación');
process.exit(ok ? 0 : 1);
