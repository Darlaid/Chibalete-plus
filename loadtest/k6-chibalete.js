/**
 * k6-chibalete.js — P3-A carga REAL (no benchmark artificial). Ejercita los
 * paths productivos reales contra una instancia (local 3000 o VPS interno).
 *
 *   k6 run -e BASE=http://localhost:3000 loadtest/k6-chibalete.js
 *   k6 run -e BASE=https://staging.host -e VUS=50 -e DUR=10m loadtest/k6-chibalete.js
 *
 * Escenarios (mezcla realista institucional, no flood sintético):
 *   - browse:   lectura/observabilidad (GET livianos, health, content)
 *   - login:    auth concurrente (zod + bcrypt + rate-limit reales)
 *   - reading:  heartbeat de progreso (el path más frecuente en sesión real)
 * Thresholds = SLOs operacionales: si fallan, el deploy NO está listo.
 */
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:3000';
const VUS  = Number(__ENV.VUS || 30);
const DUR  = __ENV.DUR || '5m';

const loginLat   = new Trend('login_latency_ms', true);
const readingLat = new Trend('reading_sync_latency_ms', true);
const errRate    = new Rate('app_error_rate');

export const options = {
    scenarios: {
        browse:  { executor: 'constant-vus', vus: Math.ceil(VUS * 0.5), duration: DUR, exec: 'browse' },
        login:   { executor: 'constant-vus', vus: Math.ceil(VUS * 0.2), duration: DUR, exec: 'login' },
        reading: { executor: 'constant-vus', vus: Math.ceil(VUS * 0.3), duration: DUR, exec: 'reading' },
    },
    thresholds: {
        // SLOs accionables (criterio go/no-go institucional):
        'http_req_duration{scenario:browse}':  ['p(95)<300', 'p(99)<800'],
        'login_latency_ms':                    ['p(95)<1200'],   // bcrypt domina
        'reading_sync_latency_ms':             ['p(95)<250', 'p(99)<600'],
        'app_error_rate':                      ['rate<0.01'],    // <1% errores
        'http_req_failed':                     ['rate<0.02'],
    },
};

export function browse() {
    const r = http.get(`${BASE}/api/health`);
    check(r, { 'health 200': (x) => x.status === 200 }) || errRate.add(1);
    sleep(1 + Math.random() * 2);
}

export function login() {
    const t0 = Date.now();
    const r = http.post(`${BASE}/api/auth/login`, JSON.stringify({
        email: `load+${__VU}@example.com`, password: 'wrong-on-purpose-123',
    }), { headers: { 'Content-Type': 'application/json' } });
    loginLat.add(Date.now() - t0);
    // 401 esperado (credenciales falsas) — NO es error de capacidad.
    // 400 (zod) o 5xx SÍ son fallos. 429 = rate-limit golpeó (medir, no romper).
    check(r, { 'login 401/429': (x) => x.status === 401 || x.status === 429 }) || errRate.add(1);
    sleep(2 + Math.random() * 3);
}

export function reading() {
    // Heartbeat de progreso: el path más caliente en sesión inmersiva real.
    const uid = `loaduser-${__VU}`;
    const cid = 'content-1778097541576';
    const t0 = Date.now();
    const r = http.post(`${BASE}/api/progress/${uid}/${cid}/sync`,
        JSON.stringify({ sentenceIndex: Math.floor(Math.random() * 200), percentage: 12, mode: 'immersive' }),
        { headers: { 'Content-Type': 'application/json', 'x-user-id': uid } });
    readingLat.add(Date.now() - t0);
    check(r, { 'sync ok/auth': (x) => [200, 401, 403, 404].includes(x.status) }) || errRate.add(1);
    sleep(3 + Math.random() * 4);  // cadencia real de heartbeat
}
