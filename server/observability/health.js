/**
 * health.js — P2-E readiness multi-capa. SEPARADO de /api/health (liveness,
 * intacto: nginx/docker dependen de su contrato 200 <5ms sin I/O).
 *
 * /api/health/ready hace checks profundos pero BARATOS y CACHEADOS ~5s (no
 * locks, no escrituras). `degraded` ≠ `down`: readiness informa, NUNCA tumba
 * la liveness ni el container. Robusto: cualquier check que falle → ese check
 * 'error', el resto sigue. ESM-safe (dynamic import perezoso, no require()).
 */
import fs from 'node:fs';
import { flags } from '../lib/flags.js';

let _cache = { at: 0, payload: null };
const TTL_MS = 5000;
let _identityMod = null; // import perezoso cacheado (solo si P1 activo)

async function safe(fn) {
    try { return await fn(); } catch (e) { return { ok: false, error: String(e?.message || e) }; }
}

async function checkIdentitySqlite() {
    if (!flags.identitySqliteEnabled()) return { ok: true, state: 'disabled' };
    if (!_identityMod) _identityMod = await import('../db/identityDb.js');
    const db = _identityMod.getIdentityDb();
    const jm = db.pragma('journal_mode', { simple: true });
    const ic = db.pragma('integrity_check', { simple: true });
    const migs = db.prepare(`SELECT COUNT(*) c FROM _migrations`).get().c;
    const audit = db.prepare(`SELECT ok FROM shadow_audit ORDER BY id DESC LIMIT 3`).all();
    const consistency = audit.length === 0 ? 'no_data'
        : (audit.every(a => a.ok === 1) ? 'ok' : 'mismatch');
    return { ok: jm === 'wal' && ic === 'ok', wal: jm, integrity: ic,
             migrations: migs, shadow_consistency: consistency };
}

export async function buildReadiness() {
    const now = Date.now();
    if (_cache.payload && now - _cache.at < TTL_MS) return _cache.payload;

    const checks = {};
    checks.process = await safe(async () => {
        const m = process.memoryUsage();
        return { ok: true, uptime_s: Math.floor(process.uptime()),
                 rss_mb: +(m.rss / 1048576).toFixed(1),
                 heap_used_mb: +(m.heapUsed / 1048576).toFixed(1) };
    });
    checks.disk = await safe(async () => {
        const s = fs.statfsSync('./data-critical');
        const freeMb = (s.bavail * s.bsize) / 1048576;
        return { ok: freeMb > 200, free_mb: Math.floor(freeMb), threshold_mb: 200 };
    });
    checks.identity_sqlite = await safe(checkIdentitySqlite);
    checks.flags = await safe(async () => ({
        ok: true,
        identity_dual_write: flags.identityDualWrite(),
        identity_read: flags.identityReadSource(),
        immersive_v2_killswitch: flags.immersiveV2Killswitch(),
        immersive_v2_cohort_pct: flags.immersiveV2CohortPct(),
        otel: process.env.OTEL_ENABLED === '1',
        metrics: process.env.METRICS_ENABLED === '1',
        error_tracking: !!(process.env.SENTRY_DSN || process.env.GLITCHTIP_DSN),
    }));

    const allOk = Object.values(checks).every(c => c && c.ok !== false);
    const payload = {
        status: allOk ? 'ready' : 'degraded',
        instance: process.env.HOSTNAME || 'local',
        timestamp: new Date().toISOString(),
        checks,
    };
    _cache = { at: now, payload };
    return payload;
}

export async function readinessHandler(_req, res) {
    try {
        const p = await buildReadiness();
        // 200 ready / 503 degraded — informativo. NO es liveness: el
        // orquestador sigue usando /api/health para matar/reiniciar.
        res.status(p.status === 'ready' ? 200 : 503).json(p);
    } catch (e) {
        res.status(503).json({ status: 'degraded', error: String(e?.message || e) });
    }
}
