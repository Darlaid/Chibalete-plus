/**
 * Harness de equivalencia REFERENCE (hilo principal) vs WORKER.
 * TZ=UTC y nowTs fijo para toda la batería. Salida sin PII: solo ordinales,
 * conteos y categorías.
 */
import fs from 'node:fs';
const { computeCanonicalMetrics } = await import('/app/server/metrics/canonicalMetricsService.mjs');
const { createMetricsProvider } = await import('/app/server/metrics/metricsProvider.mjs');
const { createShadowWorkerPool, PROTOCOL_VERSION } = await import('/app/server/metrics/shadowWorkerPool.mjs');

const NOW = 1800000000000;                       // reloj fijo, versionado
const P30 = { fromTs: NOW - 30*86400000, toTs: NOW, days: 30 };
const PALL = null;
const IDLE = 900000;
const U = JSON.parse(fs.readFileSync('/app/data-critical/usuarios_colegios_oro.json','utf8'));
const G = JSON.parse(fs.readFileSync('/app/data/groups_db.json','utf8'));
const S = JSON.parse(fs.readFileSync('/app/data/schools_db.json','utf8'));
const provider = createMetricsProvider();
const pool = createShadowWorkerPool({ workers: 1, timeoutMs: 60000, queueLimit: 4096 });
await new Promise(r => setTimeout(r, 800));

// ── FASE 5: handshake ──────────────────────────────────────────────────────
const hs = await pool.submit({ scopeKind: '__handshake__', nowTs: NOW });
console.log('HANDSHAKE ok=' + hs.ok + ' protocolo_main=' + PROTOCOL_VERSION +
            ' protocolo_worker=' + hs.handshake?.protocolVersion +
            ' engine=' + hs.handshake?.engineModule + ' node=' + hs.handshake?.nodeMajor);
if (!hs.ok || hs.handshake?.protocolVersion !== PROTOCOL_VERSION) {
  console.log('STOP — PROTOCOL VERSION MISMATCH'); process.exit(1);
}

// ── FASE 4: normalización SOLO de metadata del worker ──────────────────────
const stable = (v) => JSON.stringify(v, (k, val) => {
  if (k === 'durationMs' || k === 'jobId' || k === 'handshake') return undefined;  // metadata del worker
  return val;
});

const CAT = {};
const bump = (c) => { CAT[c] = (CAT[c] ?? 0) + 1; };
let cases = 0, exact = 0;
const divergences = [];

async function compare(label, args) {
  cases += 1;
  const ref = await computeCanonicalMetrics({ ...args, provider, clock: () => NOW });
  const wk  = await pool.submit({ ...args, nowTs: NOW });
  if (!wk.ok) { bump('ERROR_MISMATCH'); divergences.push({ label, kind: 'worker_error', error: wk.error }); return; }
  if (ref.status !== wk.status) { bump('STATUS_MISMATCH'); divergences.push({ label, kind: 'status', ref: ref.status, wk: wk.status }); return; }
  const a = stable(ref.body), b = stable(wk.body);
  if (a === b) { exact += 1; bump('EXACT_MATCH'); return; }
  // clasificar el primer campo divergente sin volcar contenido
  const ja = JSON.parse(a) ?? {}, jb = JSON.parse(b) ?? {};
  const fields = [...new Set([...Object.keys(ja||{}), ...Object.keys(jb||{})])];
  const bad = fields.filter(f => JSON.stringify(ja[f]) !== JSON.stringify(jb[f]));
  const cat = bad.includes('population') ? 'POPULATION_MISMATCH'
            : bad.includes('metrics') ? 'METRIC_MISMATCH'
            : bad.includes('coverage') ? 'COVERAGE_MISMATCH'
            : bad.includes('quality') ? 'QUALITY_MISMATCH'
            : 'UNKNOWN_MISMATCH';
  bump(cat); divergences.push({ label, kind: cat, fields: bad });
}

const t0 = Date.now();
// A. listado
await compare('list30-q', { scopeKind:'organizations', period:P30, idleMs:IDLE, includeQuality:true });
await compare('listAll-q', { scopeKind:'organizations', period:PALL, idleMs:IDLE, includeQuality:true });
await compare('list30-noq',{ scopeKind:'organizations', period:P30, idleMs:IDLE, includeQuality:false });
// B. organizaciones
for (const s of S) {
  await compare('org30', { scopeKind:'organization', organizationId:s.id, period:P30, idleMs:IDLE, includeQuality:true });
  await compare('orgAll',{ scopeKind:'organization', organizationId:s.id, period:PALL, idleMs:IDLE, includeQuality:true });
}
// C. grupos (los 20)
for (const g of G) {
  await compare('grp30', { scopeKind:'group', groupId:g.id, period:P30, idleMs:IDLE, includeQuality:true });
  await compare('grpAll',{ scopeKind:'group', groupId:g.id, period:PALL, idleMs:IDLE, includeQuality:true });
}
// D. usuarios (los 647)
for (const u of U) {
  await compare('usr30', { scopeKind:'user', userId:u.id, period:P30, idleMs:IDLE, includeQuality:true });
}
for (const u of U.slice(0, 120)) {   // muestra amplia con period=all
  await compare('usrAll',{ scopeKind:'user', userId:u.id, period:PALL, idleMs:IDLE, includeQuality:true });
}
// E. inexistentes
await compare('orgX', { scopeKind:'organization', organizationId:'org-sintetica-inexistente', period:P30, idleMs:IDLE, includeQuality:true });
await compare('grpX', { scopeKind:'group', groupId:'grp-sintetico-inexistente', period:P30, idleMs:IDLE, includeQuality:true });
await compare('usrX', { scopeKind:'user', userId:'usr-sintetico-inexistente', period:P30, idleMs:IDLE, includeQuality:true });
// F. periodo personalizado (con actividad, sin actividad, cruzando limite UTC)
const D = 86400000;
for (const [lbl, p] of [
  ['custom-act',   { fromTs: NOW-7*D, toTs: NOW, days: 7 }],
  ['custom-noact', { fromTs: NOW-3650*D, toTs: NOW-3600*D, days: 50 }],
  ['custom-utc',   { fromTs: Date.UTC(2026,6,20,0,0,0), toTs: Date.UTC(2026,6,21,0,0,0), days: 1 }],
]) await compare(lbl, { scopeKind:'organization', organizationId:S[0].id, period:p, idleMs:IDLE, includeQuality:true });

console.log(`\nCASOS=${cases} EXACT=${exact} duracion_ms=${Date.now()-t0}`);
console.log('CATEGORIAS=' + JSON.stringify(CAT));
console.log('DIVERGENCIAS=' + divergences.length);
for (const d of divergences.slice(0,8)) console.log('   ' + JSON.stringify(d));
console.log('POOL=' + JSON.stringify({ ...pool.stats(), completed: pool.counters.pool_jobs_completed,
  failed: pool.counters.pool_jobs_failed, timeouts: pool.counters.pool_jobs_timeout,
  crashes: pool.counters.pool_worker_crashes, late: pool.counters.pool_late_responses_discarded }));
await pool.shutdown({ drainMs: 1000 });
console.log('POOL_FINAL=' + pool.state);
process.exit(divergences.length === 0 ? 0 : 1);
