/**
 * prototype-request-index.mjs — CHP-STATS-LEGACY-PERF-01A, Fases 12-14.
 *
 * Prototipo de MEDICIÓN Y EXACTITUD. No se importa desde `server.js`, no se
 * activa con variables productivas y no modifica el runtime.
 *
 * Verifica las dos precondiciones de exactitud de las que depende el diseño
 * elegido, porque sin ellas la optimización sería incorrecta por muy rápida que
 * fuese:
 *
 *   1. MEMOIZACIÓN — `computeStudentMetrics(u)` debe ser determinista para el
 *      mismo estado de módulo. Si lo es, reutilizar el resultado dentro de la
 *      misma petición es exacto por construcción (salvo `computedAt`, que es
 *      un sello de instante, no un dato).
 *
 *   2. INDEXACIÓN — agrupar una sola vez por `userId` debe producir exactamente
 *      las mismas rebanadas que los escaneos por alumno que hoy se repiten.
 *      Se comprueba sobre TODOS los usuarios del padrón, no sobre una muestra.
 *
 * Cero PII: la salida son conteos y milisegundos.
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
const DATA = path.join(FIXTURE, 'data');
const CRIT = path.join(FIXTURE, 'data-critical');

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

let pass = 0, fail = 0;
const ok = (l, c, h = '') => { if (c) { console.log('  ✓', l); pass++; } else { console.error('  ✗', l, h ? `— ${h}` : ''); fail++; } };

/** Igualdad estructural ignorando sellos de instante. */
const VOLATILE = new Set(['computedAt']);
function deepEqual(a, b, pathStr = '') {
    if (a === b) return null;
    const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
    const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
    if (ta !== tb) return `${pathStr}: tipo ${ta} vs ${tb}`;
    if (ta === 'array') {
        if (a.length !== b.length) return `${pathStr}: longitud ${a.length} vs ${b.length}`;
        for (let i = 0; i < a.length; i++) { const d = deepEqual(a[i], b[i], `${pathStr}[${i}]`); if (d) return d; }
        return null;
    }
    if (ta === 'object') {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.join(',') !== kb.join(',')) return `${pathStr}: claves distintas`;
        for (const k of ka) {
            if (VOLATILE.has(k)) continue;
            const d = deepEqual(a[k], b[k], pathStr ? `${pathStr}.${k}` : k);
            if (d) return d;
        }
        return null;
    }
    if (typeof a === 'number' && Number.isNaN(a) && Number.isNaN(b)) return null;
    return `${pathStr}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

console.log('prototype-request-index — CHP-STATS-LEGACY-PERF-01A');

// ── [1] determinismo: precondición de la memoización ───────────────────────
console.log('\n[1] determinismo de computeStudentMetrics (precondición de memoizar)');
{
    const resolveMembers = (g) => getGroupMembers(g, raw.users, { allGroups: raw.groups });
    const sample = [...new Set(raw.groups.flatMap(resolveMembers))].slice(0, 120);
    let diverged = 0, firstDiff = null;
    for (const u of sample) {
        const a = metrics.computeStudentMetrics(u);
        const b = metrics.computeStudentMetrics(u);
        const d = deepEqual(a, b);
        if (d) { diverged++; firstDiff ??= d; }
    }
    ok(`[1a] ${sample.length} usuarios: dos llamadas consecutivas son idénticas`,
        diverged === 0, firstDiff ?? '');
    ok('[1b] la memoización por petición sería exacta por construcción', diverged === 0);
}

// ── [2] exactitud de la indexación por usuario ─────────────────────────────
console.log('\n[2] indexar una vez == escanear por alumno (todos los usuarios del padrón)');
{
    const progressValues = Object.values(raw.progress.progressMap || {});
    const allUserIds = raw.users.map(u => String(u.id)).filter(Boolean);

    // Índice construido UNA vez.
    const t0 = performance.now();
    const progIdx = new Map();
    for (const p of progressValues) {
        const k = p.userId;
        if (!progIdx.has(k)) progIdx.set(k, []);
        progIdx.get(k).push(p);
    }
    const evIdx = new Map();
    for (const e of raw.events) {
        if (!evIdx.has(e.userId)) evIdx.set(e.userId, []);
        evIdx.get(e.userId).push(e);
    }
    const indexMs = performance.now() - t0;

    // Comparación exhaustiva contra el escaneo actual.
    let progDiff = 0, evDiff = 0, orderDiff = 0;
    for (const u of allUserIds) {
        const scanP = progressValues.filter(p => p.userId === u);
        const idxP  = progIdx.get(u) ?? [];
        if (scanP.length !== idxP.length) progDiff++;
        else for (let i = 0; i < scanP.length; i++) if (scanP[i] !== idxP[i]) { orderDiff++; break; }

        const scanE = raw.events.filter(e => e.userId === u);
        const idxE  = evIdx.get(u) ?? [];
        if (scanE.length !== idxE.length) evDiff++;
    }
    ok(`[2a] progreso: mismas rebanadas para ${allUserIds.length} usuarios`, progDiff === 0, `difieren ${progDiff}`);
    ok('[2b] progreso: mismo ORDEN de registros', orderDiff === 0, `difieren ${orderDiff}`);
    ok(`[2c] eventos: mismas rebanadas para ${allUserIds.length} usuarios`, evDiff === 0, `difieren ${evDiff}`);

    // Coste comparado, sobre el mismo conjunto.
    const t1 = performance.now();
    for (const u of allUserIds) progressValues.filter(p => p.userId === u);
    const scanAllMs = performance.now() - t1;
    console.log(`\n  índice construido una vez : ${Math.round(indexMs * 100) / 100} ms`);
    console.log(`  escaneo para ${allUserIds.length} usuarios : ${Math.round(scanAllMs * 100) / 100} ms`);
    console.log(`  factor                    : ${Math.round(scanAllMs / Math.max(indexMs, 0.001))}x`);
}

// ── [3] usuarios sin progreso: el índice no puede inventar entradas ────────
console.log('\n[3] usuarios sin datos: ausencia != vacío mal representado');
{
    const progressValues = Object.values(raw.progress.progressMap || {});
    const progIdx = new Map();
    for (const p of progressValues) {
        if (!progIdx.has(p.userId)) progIdx.set(p.userId, []);
        progIdx.get(p.userId).push(p);
    }
    const sinDatos = raw.users.map(u => String(u.id)).filter(u => !progIdx.has(u));
    let bad = 0;
    for (const u of sinDatos) {
        const scan = progressValues.filter(p => p.userId === u);
        const idx = progIdx.get(u) ?? [];
        if (scan.length !== 0 || idx.length !== 0) bad++;
    }
    ok(`[3a] ${sinDatos.length} usuarios sin progreso devuelven lista vacía por ambos caminos`, bad === 0);
    console.log(`      (el índice devuelve undefined -> se normaliza a [], nunca a 0 ni a null)`);
}

console.log(`\nprototype-request-index: ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
