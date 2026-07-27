#!/usr/bin/env node
/**
 * typecheck-baseline.mjs — Sprint 022 Fase 2B.3
 *
 * Detector de regresiones TypeScript contra un snapshot reproducible.
 *
 * El repo arrastra 25 errores TS pre-existentes desde sprints UX-4/UX-5
 * (referencias a tipos no resueltos en services/dataService.ts, namespace
 * React no encontrado en hooks legacy, etc.). Corregirlos requeriría un
 * sub-sprint dedicado y NO es scope de Sprint 022.
 *
 * Este script NO exige TypeScript perfecto. Solo previene REGRESIONES:
 *   - Si aparece un error nuevo (archivo + código TS) que no está en el
 *     baseline → exit 1.
 *   - Si todos los errores actuales están en el baseline → exit 0,
 *     "✅ Sin regresiones TS".
 *   - Si se RESOLVIÓ algún error del baseline → exit 0 con mensaje
 *     sugiriendo regenerar el snapshot.
 *
 * Uso:
 *   node scripts/typecheck-baseline.mjs              # comparar
 *   node scripts/typecheck-baseline.mjs --regenerate # actualizar snapshot
 *
 * Snapshot:
 *   scripts/typecheck-baseline.txt
 *
 * Formato del snapshot (estable ante cambios cosméticos):
 *   <archivo>: <error TS####>: <mensaje>
 *
 * NO incluye line:column (cualquier refactor cosmético rompería el match).
 * SÍ incluye el archivo, código de error y mensaje (signal estable de
 * "qué error es éste").
 *
 * Excluye `_prod_snapshot_/` (artefacto de pre-deploy snapshot, no producción).
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');
const BASELINE   = path.join(__dirname, 'typecheck-baseline.txt');

const args = process.argv.slice(2);
const REGENERATE = args.includes('--regenerate');

// ── Captura de errores actuales ─────────────────────────────────────────────

console.log('Running tsc --noEmit (esto puede tardar 5-15s)...');
const tsc = spawnSync('npx', ['tsc', '--noEmit'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: true,
});

// tsc devuelve exit code != 0 cuando hay errores — eso es lo esperado.
// Capturamos stderr+stdout porque tsc escribe errores en stdout, no stderr.
const rawOutput = (tsc.stdout || '') + (tsc.stderr || '');

// Filtrar líneas de error TS, excluyendo _prod_snapshot_.
const errorLines = rawOutput
    .split(/\r?\n/)
    .filter(line => /error TS\d+:/.test(line))
    .filter(line => !line.includes('_prod_snapshot_'));

// Normalizar: quitar (line,col) para resistir cambios cosméticos.
// Formato entrada:  hooks/useImmersivePlayback.ts(73,24): error TS2503: Cannot find namespace 'React'.
// Formato salida:   hooks/useImmersivePlayback.ts: error TS2503: Cannot find namespace 'React'.
const normalized = errorLines
    .map(line => line.replace(/^([^(]+)\(\d+,\d+\):\s*/, '$1: '))
    .map(line => line.trim())
    .sort();

// ── Modo --regenerate ───────────────────────────────────────────────────────

if (REGENERATE) {
    writeFileSync(BASELINE, normalized.join('\n') + '\n', 'utf8');
    console.log(`✅ Baseline regenerado: ${BASELINE}`);
    console.log(`   ${normalized.length} errores TS capturados`);
    process.exit(0);
}

// ── Modo comparación ────────────────────────────────────────────────────────

if (!existsSync(BASELINE)) {
    console.error(`❌ Baseline no encontrado: ${BASELINE}`);
    console.error('   Ejecuta primero: node scripts/typecheck-baseline.mjs --regenerate');
    process.exit(1);
}

const baselineContent = readFileSync(BASELINE, 'utf8')
    .split(/\r?\n/)
    .map(l => l.trim())
    .filter(Boolean)
    .sort();

// Multiset diff: respetamos cardinalidad (si hay 13 errores idénticos en
// useImmersivePlayback.ts, baseline también debe tener 13 — no 1).
function countMap(lines) {
    const m = new Map();
    for (const l of lines) m.set(l, (m.get(l) || 0) + 1);
    return m;
}

const currentCounts  = countMap(normalized);
const baselineCounts = countMap(baselineContent);

const allKeys = new Set([...currentCounts.keys(), ...baselineCounts.keys()]);

const newErrors    = []; // en current pero no en baseline (o con conteo mayor)
const fixedErrors  = []; // en baseline pero no en current (o con conteo menor)

for (const key of allKeys) {
    const cur  = currentCounts.get(key)  || 0;
    const base = baselineCounts.get(key) || 0;
    if (cur > base) {
        for (let i = 0; i < cur - base; i++) newErrors.push(key);
    } else if (cur < base) {
        for (let i = 0; i < base - cur; i++) fixedErrors.push(key);
    }
}

// ── Reporte ─────────────────────────────────────────────────────────────────

console.log('');
console.log(`Errores actuales: ${normalized.length}`);
console.log(`Errores baseline: ${baselineContent.length}`);
console.log(`Diferencia nueva: ${newErrors.length}`);
console.log(`Diferencia resuelta: ${fixedErrors.length}`);
console.log('');

if (newErrors.length > 0) {
    console.error('❌ REGRESIÓN TS DETECTADA — errores nuevos:');
    for (const e of newErrors) console.error(`   + ${e}`);
    console.error('');
    console.error('Acciones posibles:');
    console.error('  1. Resolver los errores nuevos antes de hacer deploy.');
    console.error('  2. Si son intencionales (ej. nueva lib sin types):');
    console.error('     node scripts/typecheck-baseline.mjs --regenerate');
    console.error('     y commit del nuevo baseline.');
    process.exit(1);
}

if (fixedErrors.length > 0) {
    console.log('✨ Errores TS resueltos vs baseline:');
    for (const e of fixedErrors) console.log(`   − ${e}`);
    console.log('');
    console.log('Considera bajar el baseline:');
    console.log('  node scripts/typecheck-baseline.mjs --regenerate');
    console.log('  git add scripts/typecheck-baseline.txt && git commit');
    console.log('');
}

console.log('✅ Sin regresiones TS (current == baseline)');
process.exit(0);
