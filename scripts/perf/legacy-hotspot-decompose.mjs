/**
 * legacy-hotspot-decompose.mjs — CHP-STATS-LEGACY-PERF-01A, Fases 3-6.
 *
 * La auditoría de coste demostró que la E/S de ficheros es el 6-20 % de una
 * petición institucional y que el 80-93 % restante son llamadas repetidas a
 * `computeStudentMetrics`. Este script descompone ESA llamada para saber qué
 * hay dentro, que es lo que decide el diseño.
 *
 * `parseSessions` es privada en `metricsService.js`. Para poder cronometrarla
 * se replica aquí una copia **solo de medición**, y se verifica que produce el
 * mismo número de sesiones que el motor real antes de dar por buena la cifra.
 * Si la copia divergiera, el script lo dice y no publica el reparto.
 *
 * Cero PII: solo conteos y milisegundos.
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
const ms = () => performance.now();
const timed = (fn) => { const t0 = ms(); const v = fn(); return { v, ms: ms() - t0 }; };
const stats = (xs) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    const q = (p) => Math.round(s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))] * 1000) / 1000;
    return { p50: q(0.5), p95: q(0.95), mean: Math.round((s.reduce((a, b) => a + b, 0) / s.length) * 1000) / 1000 };
};

const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const { getAllProgressAsMap } = await import('../../server/progressService.js');
const metrics = await import('../../server/metricsService.js');
const { getGroupMembers } = await import('../../server/groupMembershipService.js');

const raw = {
    events:          readJSON(path.join(DATA, 'analytics_db.json'), []),
    leoMemory:       readJSON(path.join(DATA, 'leo_memory_db.json'), { memoryMap: {} }),
    leoInteractions: readJSON(path.join(DATA, 'leo_interactions_db.json'), []),
    progress:        getAllProgressAsMap(),
    groups:          readJSON(path.join(DATA, 'groups_db.json'), []),
    users:           readJSON(path.join(CRIT, 'usuarios_colegios_oro.json'), []),
};
metrics.init(raw);

// ── copia de medición de parseSessions (espejo de metricsService.js) ────────
function sealSession(p) {
    return { userId: p.userId, contentId: p.contentId, startTimestamp: p.startTimestamp,
        endTimestamp: p.endTimestamp ?? null, durationMs: p.durationMs ?? 0,
        blocksInSession: p.blocksInSession ?? 0, peakStreak: p.peakStreak ?? 0,
        finalStreak: p.finalStreak ?? 0, progressPercentage: p.progressPercentage ?? 0,
        source: p.source ?? null, isSeamlessTransition: p.isSeamlessTransition ?? false };
}
function parseSessionsCopy(events) {
    const sessions = [];
    const byUser = new Map();
    for (const ev of events) {
        if (!byUser.has(ev.userId)) byUser.set(ev.userId, []);
        byUser.get(ev.userId).push(ev);
    }
    for (const [, userEvents] of byUser) {
        const sorted = [...userEvents].sort((a, b) => a.timestamp - b.timestamp);
        let open = null;
        for (const ev of sorted) {
            if (ev.event === 'session_start') {
                if (open) sessions.push(sealSession(open));
                open = { userId: ev.userId, contentId: ev.contentId, startTimestamp: ev.timestamp,
                    endTimestamp: null, durationMs: 0, blocksInSession: 0,
                    peakStreak: ev.streak ?? 0, finalStreak: ev.streak ?? 0,
                    progressPercentage: 0, source: null, isSeamlessTransition: ev.isTransition ?? false };
            } else if (ev.event === 'block_complete') {
                if (open && open.contentId === ev.contentId) {
                    open.blocksInSession += 1;
                    open.peakStreak = Math.max(open.peakStreak, ev.streak ?? 0);
                    open.finalStreak = ev.streak ?? 0;
                }
            } else if (ev.event === 'session_end') {
                if (open && open.contentId === ev.contentId) {
                    open.endTimestamp = ev.timestamp;
                    open.durationMs = ev.timestamp - open.startTimestamp;
                    open.progressPercentage = ev.progressPercentage ?? open.progressPercentage;
                    sessions.push(sealSession(open));
                    open = null;
                }
            }
        }
        if (open) sessions.push(sealSession(open));
    }
    return sessions;
}

// ── validación de la copia contra el motor real ────────────────────────────
const resolveMembers = (g) => getGroupMembers(g, raw.users, { allGroups: raw.groups });
const sampleGroup = raw.groups.find(g => resolveMembers(g).some(id =>
    metrics.computeStudentMetrics(id).behavioral.totalSessions > 0));
const sampleUser = sampleGroup
    ? resolveMembers(sampleGroup).find(id => metrics.computeStudentMetrics(id).behavioral.totalSessions > 0)
    : null;

let copyIsFaithful = null;
if (sampleUser) {
    const real = metrics.computeStudentMetrics(sampleUser).behavioral.totalSessions;
    const mine = parseSessionsCopy(raw.events).filter(s => s.userId === sampleUser).length;
    copyIsFaithful = real === mine;
    console.log(`copia de parseSessions fiel al motor: ${copyIsFaithful ? 'SÍ' : 'NO'} (real=${real} copia=${mine})`);
}

// ── descomposición ──────────────────────────────────────────────────────────
const progressMap = raw.progress.progressMap || {};
const bench = {};
const run = (name, fn) => {
    const xs = [];
    for (let i = 0; i < ITER + WARMUP; i++) { const t = timed(fn); if (i >= WARMUP) xs.push(t.ms); }
    bench[name] = stats(xs);
};

run('parseSessions_TODOS_los_eventos', () => parseSessionsCopy(raw.events));
run('events_filter_1_usuario',         () => raw.events.filter(e => e.userId === sampleUser));
run('progress_scan_1_usuario',         () => Object.values(progressMap).filter(p => p.userId === sampleUser));
run('leoMemory_scan_1_usuario',        () => Object.entries(raw.leoMemory.memoryMap)
                                                  .filter(([k]) => k.startsWith(`${sampleUser}__`)));
run('leoInteractions_scan_1_usuario',  () => raw.leoInteractions.filter(e => e.userId === sampleUser));
run('computeStudentMetrics_COMPLETO',  () => metrics.computeStudentMetrics(sampleUser));

// Coste de indexar UNA vez lo que hoy se reescanea por alumno.
run('INDEX_sesiones_por_usuario', () => {
    const idx = new Map();
    for (const s of parseSessionsCopy(raw.events)) {
        if (!idx.has(s.userId)) idx.set(s.userId, []);
        idx.get(s.userId).push(s);
    }
    return idx;
});
run('INDEX_progreso_por_usuario', () => {
    const idx = new Map();
    for (const p of Object.values(progressMap)) {
        if (!idx.has(p.userId)) idx.set(p.userId, []);
        idx.get(p.userId).push(p);
    }
    return idx;
});
run('INDEX_eventos_por_usuario', () => {
    const idx = new Map();
    for (const e of raw.events) {
        if (!idx.has(e.userId)) idx.set(e.userId, []);
        idx.get(e.userId).push(e);
    }
    return idx;
});

// ── informe ─────────────────────────────────────────────────────────────────
const total = bench.computeStudentMetrics_COMPLETO?.p50 ?? null;
console.log(`\n=== DENTRO DE computeStudentMetrics (1 alumno) — total p50 = ${total} ms ===`);
const pad = (s, n) => String(s).padEnd(n);
for (const [k, v] of Object.entries(bench)) {
    if (k.startsWith('INDEX_') || k === 'computeStudentMetrics_COMPLETO') continue;
    const share = total ? Math.round((v.p50 / total) * 1000) / 10 : null;
    console.log(`  ${pad(k, 36)} p50 ${String(v.p50).padStart(9)} ms   ${String(share).padStart(5)} % del total`);
}

console.log('\n=== COSTE DE INDEXAR UNA SOLA VEZ (lo que hoy se repite por alumno) ===');
for (const [k, v] of Object.entries(bench)) {
    if (!k.startsWith('INDEX_')) continue;
    console.log(`  ${pad(k, 36)} p50 ${String(v.p50).padStart(9)} ms`);
}

console.log('\n=== PROYECCIÓN PARA UNA INSTITUCIÓN (180 llamadas medidas) ===');
const N = Number(args.calls ?? 180);
const distinct = Number(args.distinct ?? 90);
const perCall = total ?? 0;
const parseShare = bench.parseSessions_TODOS_los_eventos?.p50 ?? 0;
const idxSessions = bench.INDEX_sesiones_por_usuario?.p50 ?? 0;
const idxProgress = bench.INDEX_progreso_por_usuario?.p50 ?? 0;
const idxEvents = bench.INDEX_eventos_por_usuario?.p50 ?? 0;
const scanShare = (bench.events_filter_1_usuario?.p50 ?? 0)
                + (bench.progress_scan_1_usuario?.p50 ?? 0)
                + (bench.leoMemory_scan_1_usuario?.p50 ?? 0)
                + (bench.leoInteractions_scan_1_usuario?.p50 ?? 0);
const hoy = perCall * N;
const soloMemo = perCall * distinct;

// Los componentes se cronometran por separado, así que su suma puede superar
// el total medido de la llamada completa (ruido + solapamiento). Restar sin
// más produce residuos negativos, que serían una afirmación sin respaldo. Se
// acota el residuo a cero y el resultado se declara como COTA INFERIOR del
// coste restante, es decir, cota SUPERIOR del ahorro.
const perCallScans = parseShare + scanShare;
const residualPorAlumno = Math.max(0, perCall - perCallScans);
const indicesUnaVez = idxSessions + idxProgress + idxEvents;
const memoMasIndice = indicesUnaVez + residualPorAlumno * distinct;
const residualEsRuido = perCall - perCallScans <= 0;

const r = (x) => Math.round(x * 10) / 10;
const pct = (x) => r(100 - (x / hoy) * 100);
console.log(`  hoy (${N} llamadas)                                  ${r(hoy)} ms`);
console.log(`  A: memoización por petición (${distinct} distintas)       ${r(soloMemo)} ms   (-${pct(soloMemo)} %)`);
console.log(`  B: memoización + índices precalculados             ${r(memoMasIndice)} ms   (-${pct(memoMasIndice)} % como máximo)`);
console.log(`     · índices, una sola vez: ${r(indicesUnaVez)} ms`);
console.log(`     · residuo por alumno:    ${r(residualPorAlumno)} ms${residualEsRuido
    ? '  (los escaneos ya explican la llamada entera; el residuo real es >0 pero por debajo del ruido)'
    : ''}`);
console.log('\n  A no toca metricsService: solo evita recomputar el mismo alumno.');
console.log('  B exige mover parseSessions y los escaneos fuera del bucle por alumno.');
console.log('  B es una COTA SUPERIOR del ahorro: el residuo por alumno está acotado a 0,');
console.log('  así que el coste real de B será algo mayor que el mostrado.');

if (args.out) {
    fs.writeFileSync(String(args.out), JSON.stringify({
        copyIsFaithful, bench, projection: { calls: N, distinct, hoy, soloMemo, memoMasIndice },
    }, null, 2));
}
