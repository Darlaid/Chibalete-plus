/**
 * verify-test-store-isolation.mjs — CHP-ID-CANON-01B.
 *
 * Demuestra que la suite NO escribe en los stores reales del repositorio:
 *
 *   1. toma un snapshot (sha256 + mtime + tamaño) de data/, data-critical/ y
 *      public/uploads/;
 *   2. ejecuta las suites indicadas con el guard global precargado
 *      (`--import ./scripts/test-real-store-guard.mjs`), que además hace fallar
 *      cualquier escritura ANTES de tocar el disco;
 *   3. re-verifica el snapshot y falla si algo cambió.
 *
 *   node scripts/verify-test-store-isolation.mjs [script-npm ...]
 *
 * Sin argumentos usa las suites que tocan identidad/membresías/Aula Viva.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WATCHED = ['data', 'data-critical', 'public/uploads', 'uploads'];

const DEFAULT_SUITES = ['test:identity', 'test:memberships', 'test:analytics'];
const suites = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_SUITES;

function snapshot() {
    const out = new Map();
    const walk = (dir) => {
        let entries;
        try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
        for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) { walk(full); continue; }
            if (!e.isFile()) continue;
            let st, sha;
            try {
                st = fs.statSync(full);
                sha = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
            } catch { continue; }
            out.set(path.relative(REPO_ROOT, full).split(path.sep).join('/'),
                { sha, size: st.size, mtimeMs: st.mtimeMs });
        }
    };
    for (const w of WATCHED) walk(path.join(REPO_ROOT, w));
    return out;
}

function diff(before, after) {
    const changed = [], added = [], removed = [];
    for (const [p, a] of before) {
        const b = after.get(p);
        if (!b) { removed.push(p); continue; }
        if (b.sha !== a.sha)            changed.push(`${p} (contenido)`);
        else if (b.mtimeMs !== a.mtimeMs) changed.push(`${p} (mtime — reescrito con el mismo contenido)`);
    }
    for (const p of after.keys()) if (!before.has(p)) added.push(p);
    return { changed, added, removed };
}

const guardPath = './scripts/test-real-store-guard.mjs';
const before = snapshot();
console.log(`[isolation] snapshot inicial: ${before.size} archivos en ${WATCHED.join(', ')}`);

let failed = 0;
for (const suite of suites) {
    console.log(`\n[isolation] ejecutando: npm run ${suite}`);
    const prevOpts = process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : '';
    const r = spawnSync('npm', ['run', '--silent', suite], {
        cwd: REPO_ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        env: { ...process.env, NODE_OPTIONS: `${prevOpts}--import ${guardPath}` },
    });
    const combined = `${r.stdout || ''}${r.stderr || ''}`;
    if (combined.includes('REAL_STORE_WRITE_BLOCKED')) {
        console.error(`  ✗ ${suite} — el guard bloqueó una escritura sobre un store real`);
        const line = combined.split('\n').find(l => l.includes('REAL_STORE_GUARD'));
        if (line) console.error(`    ${line.trim()}`);
        failed++;
        continue;
    }
    if (r.status !== 0) {
        console.error(`  ✗ ${suite} — exit ${r.status}`);
        console.error(combined.split('\n').filter(l => /✗|Error|FAIL/.test(l)).slice(0, 8).join('\n'));
        failed++;
        continue;
    }
    console.log(`  ✓ ${suite}`);
}

const after = snapshot();
const { changed, added, removed } = diff(before, after);

console.log('\n[isolation] verificación de stores reales');
const report = (label, list) => {
    if (list.length === 0) { console.log(`  ✓ ${label}: 0`); return 0; }
    console.error(`  ✗ ${label}: ${list.length}`);
    for (const p of list.slice(0, 10)) console.error(`      ${p}`);
    return 1;
};
let dirty = 0;
dirty += report('archivos modificados', changed);
dirty += report('archivos creados', added);
dirty += report('archivos eliminados', removed);

if (failed || dirty) {
    console.error(`\nFAIL — suites fallidas: ${failed}; stores alterados: ${dirty ? 'sí' : 'no'}`);
    process.exit(1);
}
console.log(`\nPASS — ${suites.length} suites verdes y ${before.size} archivos de stores reales intactos`);
