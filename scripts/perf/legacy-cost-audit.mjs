/**
 * legacy-cost-audit.mjs — CHP-STATS-LEGACY-PERF-01A, Fases 1-6.
 *
 * Audita el coste real de las rutas legacy de métricas: qué se lee, cuántas
 * veces se parsea, cuántas veces se reconstruye lo mismo y dónde se va el
 * tiempo. **No modifica nada**: importa los módulos productivos y los ejecuta
 * sobre una COPIA de trabajo de las fixtures.
 *
 * Lo que esta auditoría busca demostrar o refutar: la hipótesis de partida era
 * que el coste dominante es el reparseo del padrón (~333 KB, no cacheado) y el
 * reescaneo del progreso (~2,9 MB). Hay que medirlo antes de diseñar la caché,
 * porque si el coste dominante fuese otro, una caché read-through de ficheros
 * no movería la aguja.
 *
 * Cero PII en la salida: solo conteos, bytes y milisegundos. Las instituciones
 * se etiquetan ANCHOR_1..N y las rutas ROUTE_1..N.
 *
 * Uso:
 *   PROGRESS_SQLITE_PATH=<copia>/progress.db \
 *   node legacy-cost-audit.mjs --fixture <dir> --out informe.json
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
const ITER = Number(args.iterations ?? 5);
const WARMUP = Number(args.warmup ?? 2);

const DATA = path.join(FIXTURE, 'data');
const CRIT = path.join(FIXTURE, 'data-critical');

// ── medición ────────────────────────────────────────────────────────────────
const ms = () => performance.now();
function timed(fn) { const t0 = ms(); const v = fn(); return { v, ms: ms() - t0 }; }
function stats(xs) {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const p = (q) => Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))] * 1000) / 1000;
    return { p50: p(0.5), p95: p(0.95), p99: p(0.99), min: p(0), max: p(1),
             mean: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 1000) / 1000, n: s.length };
}

// ── Fase 2/3: inventario y coste de cada store ──────────────────────────────
const STORES = [
    { key: 'padron_canonico',  file: path.join(CRIT, 'usuarios_colegios_oro.json'), authority: 'CANONICO' },
    { key: 'users_db_legacy',  file: path.join(DATA, 'users_db.json'),              authority: 'LEGACY_POR_EMAIL' },
    { key: 'groups',           file: path.join(DATA, 'groups_db.json'),             authority: 'CANONICO' },
    { key: 'schools',          file: path.join(DATA, 'schools_db.json'),            authority: 'CANONICO' },
    { key: 'analytics_events', file: path.join(DATA, 'analytics_db.json'),          authority: 'LEGACY' },
    { key: 'leo_memory',       file: path.join(DATA, 'leo_memory_db.json'),         authority: 'LEGACY' },
    { key: 'leo_interactions', file: path.join(DATA, 'leo_interactions_db.json'),   authority: 'LEGACY' },
];

function countRecords(parsed) {
    if (Array.isArray(parsed)) return parsed.length;
    if (parsed && typeof parsed === 'object') {
        if (parsed.memoryMap && typeof parsed.memoryMap === 'object') return Object.keys(parsed.memoryMap).length;
        if (parsed.progressMap && typeof parsed.progressMap === 'object') return Object.keys(parsed.progressMap).length;
        return Object.keys(parsed).length;
    }
    return 0;
}

const storeReport = [];
for (const s of STORES) {
    if (!fs.existsSync(s.file)) { storeReport.push({ ...s, file: undefined, present: false }); continue; }
    const bytes = fs.statSync(s.file).size;
    const statMs = [], readMs = [], parseMs = [];
    let records = 0;
    for (let i = 0; i < ITER + WARMUP; i++) {
        const t1 = timed(() => fs.statSync(s.file));
        const t2 = timed(() => fs.readFileSync(s.file, 'utf8'));
        const t3 = timed(() => JSON.parse(t2.v));
        if (i >= WARMUP) { statMs.push(t1.ms); readMs.push(t2.ms); parseMs.push(t3.ms); }
        records = countRecords(t3.v);
    }
    storeReport.push({
        key: s.key, authority: s.authority, present: true, bytes, records,
        stat_ms: stats(statMs), read_ms: stats(readMs), parse_ms: stats(parseMs),
        read_plus_parse_p50: Math.round((stats(readMs).p50 + stats(parseMs).p50) * 1000) / 1000,
    });
}

// ── Fase 4: progreso ────────────────────────────────────────────────────────
const { getAllProgressAsMap } = await import('../../server/progressService.js');
const progressMs = [];
let progressRecords = 0, progressBytes = null;
{
    const dbFile = process.env.PROGRESS_SQLITE_PATH;
    if (dbFile && fs.existsSync(dbFile)) progressBytes = fs.statSync(dbFile).size;
    for (let i = 0; i < ITER + WARMUP; i++) {
        const t = timed(() => getAllProgressAsMap());
        if (i >= WARMUP) progressMs.push(t.ms);
        progressRecords = Object.keys(t.v.progressMap || {}).length;
    }
}

// ── carga completa, tal como la hace loadAndInitMetrics() ───────────────────
const readJSON = (f, dflt) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return dflt; } };
const load = () => ({
    events:          readJSON(path.join(DATA, 'analytics_db.json'), []),
    leoMemory:       readJSON(path.join(DATA, 'leo_memory_db.json'), { memoryMap: {} }),
    leoInteractions: readJSON(path.join(DATA, 'leo_interactions_db.json'), []),
    progress:        getAllProgressAsMap(),
    groups:          readJSON(path.join(DATA, 'groups_db.json'), []),
    users:           readJSON(path.join(CRIT, 'usuarios_colegios_oro.json'), []),
});

const loadFullMs = [];
for (let i = 0; i < ITER + WARMUP; i++) { const t = timed(load); if (i >= WARMUP) loadFullMs.push(t.ms); }

const raw = load();
const metrics = await import('../../server/metricsService.js');
const { getGroupMembers } = await import('../../server/groupMembershipService.js');
metrics.init(raw);

// ── Fase 6: conteo EXACTO de recomputaciones por ruta ───────────────────────
// No hace falta instrumentar: `computeSchoolMetrics` llama a
// `computeStudentMetrics` una vez por alumno del colegio y OTRA vez por alumno
// dentro de `courseBreakdown`. El conteo se deriva de los datos.
const resolveMembers = (g) => getGroupMembers(g, raw.users, { allGroups: raw.groups });

function schoolCallCounts(schoolName) {
    const gs = raw.groups.filter(g => g.school?.toLowerCase() === schoolName.toLowerCase());
    const union = new Set();
    let breakdown = 0;
    for (const g of gs) {
        const m = resolveMembers(g);
        m.forEach(id => union.add(id));
        if (m.length > 0) breakdown += m.length;
    }
    return { groups: gs.length, uniqueStudents: union.size, breakdownCalls: breakdown,
             totalStudentComputations: union.size + breakdown };
}

// ── coste de una sola computeStudentMetrics ─────────────────────────────────
const anchorNames = [...new Set(raw.groups.map(g => g.school).filter(Boolean))];
const sampleGroup = raw.groups.find(g => resolveMembers(g).length > 0);
const sampleUser = sampleGroup ? resolveMembers(sampleGroup)[0] : null;

const studentMs = [];
if (sampleUser) {
    for (let i = 0; i < ITER + WARMUP; i++) {
        const t = timed(() => metrics.computeStudentMetrics(sampleUser));
        if (i >= WARMUP) studentMs.push(t.ms);
    }
}

// ── coste por ancla institucional ───────────────────────────────────────────
const ANCHORS = ['Villas de Aranjuez', 'Nuevo Bosque', 'Chibalete Club FilBo 2026'];
const anchorReport = [];
for (const [i, name] of ANCHORS.entries()) {
    if (!anchorNames.some(n => n.toLowerCase() === name.toLowerCase())) {
        anchorReport.push({ anchor: `ANCHOR_${i + 1}`, present: false });
        continue;
    }
    const counts = schoolCallCounts(name);
    const durations = [];
    for (let k = 0; k < ITER + WARMUP; k++) {
        const t = timed(() => { try { return metrics.computeSchoolMetrics(name); } catch { return null; } });
        if (k >= WARMUP) durations.push(t.ms);
    }
    const single = stats(studentMs)?.p50 ?? null;
    anchorReport.push({
        anchor: `ANCHOR_${i + 1}`, present: true, ...counts,
        compute_ms: stats(durations),
        implied_student_cost_ms: single,
        predicted_ms_if_linear: single != null
            ? Math.round(single * counts.totalStudentComputations * 100) / 100 : null,
    });
}

// ── grupo y usuario ─────────────────────────────────────────────────────────
const groupMs = [];
if (sampleGroup) {
    for (let i = 0; i < ITER + WARMUP; i++) {
        const t = timed(() => { try { return metrics.computeCourseMetrics(sampleGroup.id); } catch { return null; } });
        if (i >= WARMUP) groupMs.push(t.ms);
    }
}

// ── informe ─────────────────────────────────────────────────────────────────
const report = {
    unit: 'CHP-STATS-LEGACY-PERF-01A',
    iterations: ITER, warmup: WARMUP,
    node: process.version,
    stores: storeReport,
    progress: {
        source: 'sqlite (progressService.getAllProgressAsMap)',
        bytes: progressBytes, records: progressRecords, ms: stats(progressMs),
    },
    load_full_ms: stats(loadFullMs),
    single_student_ms: stats(studentMs),
    group: sampleGroup ? { members: resolveMembers(sampleGroup).length, compute_ms: stats(groupMs) } : null,
    anchors: anchorReport,
};

if (args.out) fs.writeFileSync(String(args.out), JSON.stringify(report, null, 2));

// ── salida legible ──────────────────────────────────────────────────────────
const pad = (s, n) => String(s).padEnd(n);
const num = (v, n = 9) => String(v ?? '-').padStart(n);

console.log('\n=== STORES: coste de lectura y parseo (por petición, sin caché) ===');
console.log(pad('store', 20), pad('autoridad', 18), num('bytes'), num('registros'), num('read p50'), num('parse p50'), num('r+p p50'));
for (const s of storeReport) {
    if (!s.present) { console.log(pad(s.key, 20), '(ausente)'); continue; }
    console.log(pad(s.key, 20), pad(s.authority, 18), num(s.bytes), num(s.records),
        num(s.read_ms.p50), num(s.parse_ms.p50), num(s.read_plus_parse_p50));
}
console.log(pad('progress (sqlite)', 20), pad('CANONICO', 18), num(progressBytes), num(progressRecords),
    num('-'), num('-'), num(stats(progressMs)?.p50));

const ioTotal = storeReport.filter(s => s.present).reduce((a, s) => a + s.read_plus_parse_p50, 0)
              + (stats(progressMs)?.p50 ?? 0);
console.log(`\n  carga completa medida (load_full) p50 = ${stats(loadFullMs)?.p50} ms`);
console.log(`  suma de componentes de E/S             = ${Math.round(ioTotal * 1000) / 1000} ms`);

console.log('\n=== COSTE DE CÓMPUTO ===');
console.log(`  computeStudentMetrics (1 alumno) p50 = ${stats(studentMs)?.p50} ms  p95 = ${stats(studentMs)?.p95} ms`);
if (report.group) console.log(`  computeCourseMetrics (${report.group.members} miembros) p50 = ${report.group.compute_ms.p50} ms`);

console.log('\n=== RECOMPUTACIÓN POR INSTITUCIÓN ===');
console.log(pad('ancla', 10), num('grupos', 8), num('alumnos', 9), num('llamadas', 9), num('medido p50', 12), num('lineal', 10), num('E/S %', 8));
for (const a of anchorReport) {
    if (!a.present) { console.log(pad(a.anchor, 10), '(ausente)'); continue; }
    const share = a.compute_ms ? Math.round((ioTotal / (ioTotal + a.compute_ms.p50)) * 1000) / 10 : null;
    console.log(pad(a.anchor, 10), num(a.groups, 8), num(a.uniqueStudents, 9),
        num(a.totalStudentComputations, 9), num(a.compute_ms?.p50, 12),
        num(a.predicted_ms_if_linear, 10), num(share + '%', 8));
}
console.log('\n  "llamadas" = computeStudentMetrics ejecutadas por petición.');
console.log('  "lineal"   = coste de 1 alumno x llamadas. Si se aproxima al medido,');
console.log('               el coste es recomputación repetida, no E/S.');
console.log('  "E/S %"    = proporción del total de la petición que es lectura+parseo.');
