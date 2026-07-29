/**
 * equivalence-harness.mjs — CHP-STATS-LEGACY-PERF-01D.
 *
 * Padre de la comparación. Construye el manifiesto de casos desde la fixture,
 * lanza los dos brazos en procesos aislados (`off` y `on`) y compara caso por
 * caso.
 *
 * Regla de comparación: **byte a byte**, sin normalizar ningún campo funcional.
 * Con el reloj fijado, `computedAt` debe coincidir; si hiciera falta excluirlo,
 * sería señal de que algo no es determinista y habría que pararse, no maquillar
 * el resultado.
 *
 * Cero PII: los casos viajan con identificador ordinal (`USER_0001`,
 * `GROUP_07`, `SCHOOL_2`) y la evidencia no contiene claves reales.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUNNER = path.join(HERE, 'equivalence-runner.mjs');

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
const FIXED_NOW = Number(args.now ?? 1800000000000);
const DATA = path.join(FIXTURE, 'data');
const CRIT = path.join(FIXTURE, 'data-critical');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

// ── manifiesto (root-only: contiene claves reales) ─────────────────────────
const users  = readJSON(path.join(CRIT, 'usuarios_colegios_oro.json'), []);
const groups = readJSON(path.join(DATA, 'groups_db.json'), []);
const schoolNames = [...new Set(groups.map(g => g.school).filter(s => typeof s === 'string' && s.trim()))];

const cases = [];
users.forEach((u, i) => cases.push({ id: `USER_${String(i + 1).padStart(4, '0')}`, kind: 'student', key: String(u.id) }));
groups.forEach((g, i) => cases.push({ id: `GROUP_${String(i + 1).padStart(2, '0')}`, kind: 'course', key: g.id }));
schoolNames.forEach((s, i) => cases.push({ id: `SCHOOL_${i + 1}`, kind: 'school', key: s }));
cases.push({ id: 'LISTING', kind: 'schoolsList', key: null });
// Casos inexistentes con claves sintéticas que no colisionan con producción.
cases.push({ id: 'MISSING_USER',   kind: 'student', key: 'synthetic-user-does-not-exist' });
cases.push({ id: 'MISSING_GROUP',  kind: 'course',  key: 'synthetic-group-does-not-exist' });
cases.push({ id: 'MISSING_SCHOOL', kind: 'school',  key: 'Synthetic School Does Not Exist' });
cases.push({ id: 'MALFORMED_USER', kind: 'student', key: '' });

const manifestPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'equiv_')), 'manifest.json');

function writeManifest(order) {
    fs.writeFileSync(manifestPath, JSON.stringify({ cases, order }), { mode: 0o600 });
}

let armSeq = 0;
function runArm(arm, flagValue, order, full = []) {
    writeManifest(order);
    const resultPath = path.join(path.dirname(manifestPath), `result-${arm}-${++armSeq}.json`);
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
            RUNNER, '--fixture', FIXTURE, '--manifest', manifestPath,
            '--now', String(FIXED_NOW), '--arm', arm, '--result', resultPath,
            ...(full.length ? ['--full', full.join(',')] : []),
        ], {
            env: { ...process.env, LEGACY_METRICS_REQUEST_CONTEXT: flagValue, TZ: 'UTC' },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let err = '';
        child.stdout.on('data', () => { /* el hijo puede hablar por stdout: se ignora */ });
        child.stderr.on('data', (d) => { err += d; });
        child.on('close', (code) => {
            if (code !== 0) return reject(new Error(`brazo ${arm} salió con ${code}: ${err.slice(-800)}`));
            try {
                resolve(JSON.parse(fs.readFileSync(resultPath, 'utf8')));
            } catch (e) {
                reject(new Error(`brazo ${arm}: resultado ilegible — ${e.message} · stderr: ${err.slice(-400)}`));
            }
        });
    });
}

// ── clasificación de divergencias ──────────────────────────────────────────
function classify(a, b) {
    if (!a || !b) return 'UNKNOWN_MISMATCH';
    if (a.errored !== b.errored) return 'ERROR_MISMATCH';
    if (a.errored && b.errored) {
        if (a.errorName !== b.errorName || a.errorCode !== b.errorCode) return 'ERROR_MISMATCH';
        return 'ERROR_MISMATCH';
    }
    return 'UNKNOWN_MISMATCH';
}

/** Diferencia estructural con ruta, sin volcar valores largos. */
function deepDiff(a, b, p = '', acc = []) {
    if (acc.length >= 20) return acc;
    const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
    const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
    if (ta !== tb) { acc.push({ path: p, kind: 'TYPE_MISMATCH', off: ta, on: tb }); return acc; }
    if (ta === 'array') {
        if (a.length !== b.length) acc.push({ path: p, kind: 'ORDER_MISMATCH', off: a.length, on: b.length });
        for (let i = 0; i < Math.min(a.length, b.length); i++) deepDiff(a[i], b[i], `${p}[${i}]`, acc);
        return acc;
    }
    if (ta === 'object') {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.join(',') !== kb.join(',')) acc.push({ path: p, kind: 'ORDER_MISMATCH', off: ka.length, on: kb.length });
        for (const k of new Set([...ka, ...kb])) deepDiff(a[k], b[k], p ? `${p}.${k}` : k, acc);
        return acc;
    }
    if (a !== b) {
        let kind = 'UNKNOWN_MISMATCH';
        if ((a === null) !== (b === null) || a === 0 || b === 0) kind = 'NULL_ZERO_MISMATCH';
        else if (typeof a === 'number') kind = 'AGGREGATE_MISMATCH';
        else if (typeof a === 'string') kind = 'STATUS_MISMATCH';
        const short = (v) => (typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v);
        acc.push({ path: p, kind, off: short(a), on: short(b) });
    }
    return acc;
}

// ── ejecución ──────────────────────────────────────────────────────────────
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const orderStable = cases.map((_, i) => i);
const orderShuffled = (() => {
    const a = orderStable.slice();
    const rnd = mulberry32(20260729);
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
})();

async function compareRun(label, order) {
    const off = await runArm('off', 'off', order);
    const on  = await runArm('on',  'on',  order);

    const byIdOff = new Map(off.results.map(r => [r.id, r]));
    const byIdOn  = new Map(on.results.map(r => [r.id, r]));

    const buckets = {};
    const mismatched = [];
    let exact = 0;
    for (const c of cases) {
        const a = byIdOff.get(c.id), b = byIdOn.get(c.id);
        if (a && b && a.hash === b.hash && a.errored === b.errored) { exact++; continue; }
        const kind = classify(a, b);
        buckets[kind] = (buckets[kind] ?? 0) + 1;
        mismatched.push({ id: c.id, kind: c.kind, cls: kind });
    }
    return { label, off, on, exact, buckets, mismatched, total: cases.length };
}

console.log('=== EQUIVALENCIA LEGACY off vs on — CHP-STATS-LEGACY-PERF-01D ===');
console.log(`casos: ${cases.length}  (usuarios ${users.length} · grupos ${groups.length} · instituciones ${schoolNames.length} · listado 1 · límite 4)`);
console.log(`reloj fijo: ${FIXED_NOW}  ·  TZ=UTC\n`);

const run1 = await compareRun('RUN_1 (orden estable)', orderStable);
const run2 = await compareRun('RUN_2 (orden barajado, semilla fija)', orderShuffled);

let failures = 0;
for (const r of [run1, run2]) {
    console.log(`--- ${r.label} ---`);
    console.log(`  EXACT_MATCH: ${r.exact} / ${r.total}`);
    if (r.mismatched.length) {
        failures += r.mismatched.length;
        for (const [k, v] of Object.entries(r.buckets)) console.log(`  ${k}: ${v}`);
        console.log('  casos divergentes (por ordinal):', r.mismatched.slice(0, 15).map(m => m.id).join(', '));
    }
    console.log(`  contadores off: ${JSON.stringify(r.off.counters)}`);
    console.log(`  contadores on : ${JSON.stringify(r.on.counters)}`);
    console.log(`  fuentes: ${JSON.stringify(r.off.sources)}`);
    console.log(`  flag off arm=${r.off.flag} enabled=${r.off.contextEnabled} · on arm=${r.on.flag} enabled=${r.on.contextEnabled}`);
}

// ── determinismo entre corridas ────────────────────────────────────────────
const hashOf = (run, arm) => crypto.createHash('sha256')
    .update(run[arm].results.slice().sort((a, b) => a.id.localeCompare(b.id)).map(r => `${r.id}:${r.hash}`).join('|'))
    .digest('hex');
const detOff = hashOf(run1, 'off') === hashOf(run2, 'off');
const detOn  = hashOf(run1, 'on')  === hashOf(run2, 'on');
console.log('\n--- DETERMINISMO ---');
console.log(`  brazo off, RUN_1 vs RUN_2: ${detOff ? 'idéntico' : 'DIFIERE'}`);
console.log(`  brazo on,  RUN_1 vs RUN_2: ${detOn  ? 'idéntico' : 'DIFIERE'}`);
if (!detOff || !detOn) failures++;

// ── divergencias: recuperar detalle sanitizado ─────────────────────────────
if (run1.mismatched.length) {
    console.log('\n--- DETALLE DE LA PRIMERA DIVERGENCIA ---');
    const ids = run1.mismatched.slice(0, 3).map(m => m.id);
    const offFull = await runArm('off', 'off', orderStable, ids);
    const onFull  = await runArm('on',  'on',  orderStable, ids);
    for (const id of ids) {
        const a = offFull.results.find(r => r.id === id)?.full;
        const b = onFull.results.find(r => r.id === id)?.full;
        console.log(`  ${id}:`);
        for (const d of deepDiff(a, b).slice(0, 8)) {
            console.log(`    ${d.kind} @ ${d.path}: off=${JSON.stringify(d.off)} on=${JSON.stringify(d.on)}`);
        }
    }
}

fs.rmSync(path.dirname(manifestPath), { recursive: true, force: true });

const summary = {
    total: cases.length,
    users: users.length, groups: groups.length, schools: schoolNames.length,
    run1: { exact: run1.exact, buckets: run1.buckets },
    run2: { exact: run2.exact, buckets: run2.buckets },
    deterministic: { off: detOff, on: detOn },
    counters: { off: run1.off.counters, on: run1.on.counters },
    sources: run1.off.sources,
};
if (args.out) fs.writeFileSync(String(args.out), JSON.stringify(summary, null, 2));

console.log(`\n${failures === 0 ? 'GREEN — 100 % EXACT_MATCH en ambas corridas' : `ROJO — ${failures} divergencias`}`);
process.exit(failures === 0 ? 0 : 1);
