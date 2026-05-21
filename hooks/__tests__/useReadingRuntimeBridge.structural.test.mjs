/**
 * useReadingRuntimeBridge.structural.test.mjs — CRR Fase 2 / lock-in del hook.
 *
 * El hook es un wrapper React fino sobre readingRuntimeBridgeCore.mjs (los
 * tests reales están en utils/__tests__/readingRuntimeBridgeCore.test.mjs).
 * Este test bloquea regresiones estructurales:
 *
 *   - El hook DEBE delegar al core, NO duplicar lógica.
 *   - El hook NO debe importar el stack V1 (useImmersivePlayback, etc.).
 *   - El hook NO debe importar AudioRuntime directamente (audio = NULL del core).
 *   - El hook DEBE tener early-return cuando flag = v1.
 *
 *   node hooks/__tests__/useReadingRuntimeBridge.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hookPath = path.join(__dirname, '..', 'useReadingRuntimeBridge.ts');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}

const src = fs.readFileSync(hookPath, 'utf8');

console.log('useReadingRuntimeBridge — lock-in estructural');
ok('archivo existe',                                src.length > 0);
ok('delega al core (createBridgeSession)',          /createBridgeSession/.test(src));
ok('importa el core .mjs',                          /readingRuntimeBridgeCore\.mjs/.test(src));

console.log('\n[1] NO importa stack V1');
const forbidden = [
    'useImmersivePlayback',
    'immersivePlaybackMachine',
    'activeSentenceBuffer',
    'BlockEngine', 'RewardEngine', 'TranceEngine',
];
for (const tag of forbidden) {
    ok(`NO importa ${tag}`, !new RegExp(`['"\\W]${tag}['"\\W]`).test(src));
}

console.log('\n[2] NO importa AudioRuntime ni audio adapter directamente');
ok('NO importa engines/AudioRuntime',     !/from\s+['"][^'"]*engines\/AudioRuntime/.test(src));
ok('NO importa createBrowserAudioAdapter', !/createBrowserAudioAdapter/.test(src));
ok('NO importa createProductionRuntime',   !/createProductionRuntime/.test(src));

console.log('\n[3] resolver decision + early-return');
ok('llama resolveReadingRuntime',         /resolveReadingRuntime\(/.test(src));
ok('early-return cuando flag !== v2',     /decision\.runtime\s*!==\s*['"]v2['"]/.test(src));
ok('default OFF: caller_disabled o cohort_0', /caller_disabled|cohort_0/.test(src));

console.log('\n[4] cleanup en unmount');
ok('useEffect retorna función cleanup',   /return\s*\(\s*\)\s*=>\s*\{/.test(src));
ok('dispose es invocado en cleanup',      /\.dispose\(/.test(src));
ok('unsubscribe es invocado en cleanup',  /unsubscribe\(\)/.test(src));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
