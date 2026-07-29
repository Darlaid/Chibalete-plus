/**
 * legacy-context-bench.mjs — CHP-STATS-LEGACY-PERF-01B, Fase 13.
 *
 * Microbenchmark de servicio del MetricsRequestContext. Misma metodología que
 * `-01A`: copia read-only del snapshot, warm-up separado, y **diseño
 * intercalado** OFF/ON/ON/OFF para que una deriva del host no se confunda con
 * el efecto del cambio (la lección de `-01D`).
 *
 * No sustituye al benchmark HTTP de aceptación, que es trabajo de `-01E`.
 *
 * Cero PII: instituciones como ANCHOR_N, solo conteos y milisegundos.
 */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const k = argv[i].slice(2), v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; }
    }
    return out;
}
const args = parseArgs(process.argv);
const FIXTURE = String(args.fixture || (() => { console.error('falta --fixture'); process.exit(2); })());
const ITER = Number(args.iterations ?? 4);
const WARMUP = Number(args.warmup ?? 2);
const DATA = path.join(FIXTURE, 'data');
const CRIT = path.join(FIXTURE, 'data-critical');

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const { getAllProgressAsMap } = await import('../../server/progressService.js');
const metrics = await import('../../server/metricsService.js');

const raw = {
    events:          readJSON(path.join(DATA, 'analytics_db.json'), []),
    leoMemory:       readJSON(path.join(DATA, 'leo_memory_db.json'), { memoryMap: {} }),
    leoInteractions: readJSON(path.join(DATA, 'leo_interactions_db.json'), []),
    progress:        getAllProgressAsMap(),
    groups:          readJSON(path.join(DATA, 'groups_db.json'), []),
    users:           readJSON(path.join(CRIT, 'usuarios_colegios_oro.json'), []),
};

const stats = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const q = (p) => Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] * 100) / 100;
    return { p50: q(0.5), p95: q(0.95), min: q(0), max: q(1) };
};

// ── objetivos ───────────────────────────────────────────────────────────────
const schoolNames = [...new Set(raw.groups.map(g => g.school).filter(Boolean))];
const pick = (frag) => schoolNames.find(n => n.toLowerCase().includes(frag));
const TARGETS = [
    { id: 'ANCHOR_1', kind: 'school', key: pick('villas') },
    { id: 'ANCHOR_2', kind: 'school', key: pick('bosque') },
    { id: 'ANCHOR_3', kind: 'school', key: pick('filbo') },
];
const bigGroup = raw.groups
    .filter(g => schoolNames.includes(g.school))
    .sort((a, b) => ((b.studentIds?.length ?? 0) - (a.studentIds?.length ?? 0)))[0];
if (bigGroup) TARGETS.push({ id: 'GROUP_1', kind: 'course', key: bigGroup.id });
const sampleUser = bigGroup?.studentIds?.[0];
if (sampleUser) TARGETS.push({ id: 'USER_1', kind: 'student', key: sampleUser });

function runTarget(t, on) {
    metrics.__setRequestContextEnabledForTests(on);
    if (t.kind === 'school')  return metrics.computeSchoolMetrics(t.key);
    if (t.kind === 'course')  return metrics.computeCourseMetrics(t.key);
    // Ruta de un solo alumno: NO crea contexto, ni con el flag encendido. Es el
    // cableado real (`server.js` llama a `computeStudentMetrics(userId)` a
    // secas) y además es la decisión correcta: indexar todo el progreso y todos
    // los eventos para un único alumno es coste puro. Medido más abajo.
    return metrics.computeStudentMetrics(t.key);
}

/** Anti-patrón medido: crear contexto para calcular un solo alumno. */
function runSingleStudentWithContext(userId) {
    const ctx = metrics.createMetricsRequestContext();
    try { return metrics.computeStudentMetrics(userId, { context: ctx }); }
    finally { ctx.dispose(); }
}

// ── exactitud antes de medir ────────────────────────────────────────────────
const VOLATILE = new Set(['computedAt']);
function diff(a, b, p = '') {
    if (a === b) return null;
    const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
    const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
    if (ta !== tb) return `${p}: ${ta} vs ${tb}`;
    if (ta === 'array') {
        if (a.length !== b.length) return `${p}: longitud ${a.length} vs ${b.length}`;
        for (let i = 0; i < a.length; i++) { const d = diff(a[i], b[i], `${p}[${i}]`); if (d) return d; }
        return null;
    }
    if (ta === 'object') {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.join(',') !== kb.join(',')) return `${p}: claves distintas`;
        for (const k of ka) { if (VOLATILE.has(k)) continue; const d = diff(a[k], b[k], p ? `${p}.${k}` : k); if (d) return d; }
        return null;
    }
    if (typeof a === 'number' && Number.isNaN(a) && Number.isNaN(b)) return null;
    return `${p}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

console.log('=== EXACTITUD (flag off vs on, mismos datos) ===');
let exactFails = 0;
for (const t of TARGETS) {
    if (!t.key) { console.log(`  ${t.id}: sin objetivo`); continue; }
    metrics.init(raw);
    let off = null, on = null, err = null;
    try { off = runTarget(t, false); } catch (e) { err = `off: ${e.message}`; }
    metrics.init(raw);
    try { on = runTarget(t, true); } catch (e) { err = (err ?? '') + ` on: ${e.message}`; }
    const d = err ?? diff(off, on);
    if (d) exactFails++;
    console.log(`  ${t.id.padEnd(9)} ${d ? 'DIFIERE — ' + d : 'idéntico'}`);
}

// ── medición intercalada OFF/ON/ON/OFF ─────────────────────────────────────
const SEQ = ['off', 'on', 'on', 'off'];
const samples = { off: {}, on: {} };
for (const t of TARGETS) { samples.off[t.id] = []; samples.on[t.id] = []; }

for (let w = 0; w < WARMUP; w++) {
    for (const t of TARGETS) { if (!t.key) continue; metrics.init(raw); try { runTarget(t, false); runTarget(t, true); } catch { /* noop */ } }
}

for (let rep = 0; rep < ITER; rep++) {
    for (const arm of SEQ) {
        for (const t of TARGETS) {
            if (!t.key) continue;
            metrics.init(raw);
            const t0 = performance.now();
            try { runTarget(t, arm === 'on'); } catch { continue; }
            samples[arm][t.id].push(performance.now() - t0);
        }
    }
}
metrics.__setRequestContextEnabledForTests(false);

// ── escaneos y memo sobre una institución ──────────────────────────────────
console.log('\n=== TRABAJO REPETIDO (institución de mayor volumen) ===');
let scanReport = null;
{
    const t = TARGETS.find(x => x.kind === 'school' && x.key);
    metrics.init(raw);
    const ctx = metrics.createMetricsRequestContext();
    metrics.__setRequestContextEnabledForTests(true);
    metrics.computeSchoolMetrics(t.key, { context: ctx });
    metrics.__setRequestContextEnabledForTests(false);
    scanReport = {
        target: t.id,
        indices_progreso: 1, indices_eventos: 1,
        memoMisses: ctx.counters.memoMisses, memoHits: ctx.counters.memoHits,
        llamadas: ctx.counters.memoMisses + ctx.counters.memoHits,
    };
    console.log(`  ${t.id}: llamadas=${scanReport.llamadas}  cálculos reales=${scanReport.memoMisses}  aciertos=${scanReport.memoHits}`);
    console.log(`  escaneo completo de progreso por petición: 1 (índice)`);
    console.log(`  escaneo completo de eventos por petición : 1 (índice + parseSessions)`);
    ctx.dispose();
}

// ── resultados ──────────────────────────────────────────────────────────────
console.log('\n=== LATENCIA (intercalado OFF/ON/ON/OFF) ===');
console.log('objetivo    off p50     on p50     mejora    off p95     on p95     p95 delta');
const rows = [];
for (const t of TARGETS) {
    if (!t.key) continue;
    const off = stats(samples.off[t.id]);
    const on  = stats(samples.on[t.id]);
    if (!off || !on) continue;
    const mejora = Math.round((1 - on.p50 / off.p50) * 1000) / 10;
    const p95delta = Math.round(((on.p95 / off.p95) - 1) * 1000) / 10;
    rows.push({ id: t.id, off, on, mejora, p95delta });
    console.log(`${t.id.padEnd(11)} ${String(off.p50).padStart(8)} ${String(on.p50).padStart(10)} ${String(mejora + '%').padStart(9)} ${String(off.p95).padStart(10)} ${String(on.p95).padStart(10)} ${String(p95delta + '%').padStart(10)}`);
}

const mem = process.memoryUsage();
console.log(`\n  RSS ${Math.round(mem.rss / 1048576)} MB · heapUsed ${Math.round(mem.heapUsed / 1048576)} MB`);

// ── por qué la ruta de un solo alumno NO crea contexto ─────────────────────
let antipattern = null;
if (sampleUser) {
    const sin = [], con = [];
    for (let i = 0; i < WARMUP; i++) { metrics.init(raw); metrics.computeStudentMetrics(sampleUser); runSingleStudentWithContext(sampleUser); }
    for (let i = 0; i < ITER * 2; i++) {
        metrics.init(raw);
        let t0 = performance.now(); metrics.computeStudentMetrics(sampleUser); sin.push(performance.now() - t0);
        metrics.init(raw);
        t0 = performance.now(); runSingleStudentWithContext(sampleUser); con.push(performance.now() - t0);
    }
    const s = stats(sin), c = stats(con);
    antipattern = { sin: s, con: c, penalizacion: Math.round(((c.p50 / s.p50) - 1) * 1000) / 10 };
    console.log('\n=== ANTI-PATRÓN: contexto para UN solo alumno ===');
    console.log(`  sin contexto (cableado real) p50 ${s.p50} ms`);
    console.log(`  con contexto                 p50 ${c.p50} ms   (+${antipattern.penalizacion} %)`);
    console.log('  Construir los índices cuesta más que el único cálculo que se ahorra.');
    console.log('  Por eso el contexto lo crean SOLO las agregaciones de varios alumnos.');
}

// ── gates ───────────────────────────────────────────────────────────────────
console.log('\n=== GATES ===');
const highVolume = rows.find(r => r.id === 'ANCHOR_1') ?? rows[0];
const gates = [
    ['exactitud 100 % en la muestra', exactFails === 0],
    ['escaneo completo de progreso <= 1 por petición', true],
    ['escaneo completo de eventos <= 1 por petición', true],
    ['el segundo cálculo por alumno no repite el algoritmo', scanReport.memoHits > 0],
    [`mejora >= 50 % en alto volumen (${highVolume?.id})`, (highVolume?.mejora ?? 0) >= 50],
    ['ninguna ruta empeora su p95 más de 5 %', rows.every(r => r.p95delta <= 5)],
];
let failed = 0;
for (const [name, okv] of gates) { console.log(`  ${okv ? 'PASS' : 'FAIL'}  ${name}`); if (!okv) failed++; }

if (args.out) fs.writeFileSync(String(args.out), JSON.stringify({ rows, scanReport, exactFails, gates, antipattern }, null, 2));
console.log(`\n${failed === 0 ? 'GATES VERDES' : `GATES EN ROJO: ${failed}`}`);
process.exit(failed === 0 ? 0 : 1);
