/**
 * immersiveRuntimeFlag.test.mjs — P1-B canary resolver.
 *
 * Ejercita el resolver REAL del backend (server/lib/flags.js, ESM Node) +
 * verifica estructuralmente que el resolver frontend (utils/
 * immersiveRuntimeFlag.ts) usa el MISMO FNV-1a y la misma precedencia
 * (kill-switch > override > cohorte > default V1) → cohortes coherentes
 * front↔back. NO arranca V2 en prod (default V1, killswitch gana).
 *
 *   node utils/__tests__/immersiveRuntimeFlag.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveImmersiveRuntime, flags } from '../../server/lib/flags.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (l,c,h='') => c ? (console.log('  ✓',l),pass++) : (console.error('  ✗',l,h),fail++);

console.log('\n[1] defaults seguros (prod = V1)');
delete process.env.IMMERSIVE_V2_KILLSWITCH; delete process.env.IMMERSIVE_V2_COHORT_PCT;
ok('default cohorte 0 → v1', resolveImmersiveRuntime('user-1').runtime === 'v1');
ok('flags.cohortPct default 0', flags.immersiveV2CohortPct() === 0);

console.log('\n[2] kill-switch gana sobre todo');
process.env.IMMERSIVE_V2_COHORT_PCT = '100';
process.env.IMMERSIVE_V2_KILLSWITCH = '1';
ok('killswitch fuerza v1 aún con cohorte 100', resolveImmersiveRuntime('x').runtime === 'v1');
ok('reason killswitch', resolveImmersiveRuntime('x').reason === 'killswitch');

console.log('\n[3] cohorte determinista + estable');
delete process.env.IMMERSIVE_V2_KILLSWITCH;
process.env.IMMERSIVE_V2_COHORT_PCT = '100';
ok('cohorte 100 → v2', resolveImmersiveRuntime('u').runtime === 'v2');
process.env.IMMERSIVE_V2_COHORT_PCT = '50';
const a = resolveImmersiveRuntime('user-determinista');
const b = resolveImmersiveRuntime('user-determinista');
ok('mismo userId → misma asignación (estable)', a.runtime === b.runtime && a.bucket === b.bucket);
let v2 = 0; for (let i = 0; i < 1000; i++) if (resolveImmersiveRuntime('id-'+i).runtime === 'v2') v2++;
ok('cohorte 50% reparte ~50% (400..600 de 1000)', v2 > 350 && v2 < 650, `v2=${v2}`);

console.log('\n[4] front (.ts) coherente con back (mismo FNV-1a + precedencia)');
const ts = fs.readFileSync(path.join(ROOT, 'utils', 'immersiveRuntimeFlag.ts'), 'utf8');
ok('front usa FNV-1a offset 0x811c9dc5', /0x811c9dc5/.test(ts));
ok('front usa FNV-1a prime 0x01000193', /0x01000193/.test(ts));
ok('front: killswitch precede a todo', /cfg\.killSwitch[\s\S]{0,160}?runtime:\s*'v1'/.test(ts));
ok('front: default seguro v1 (cohort 0)', /pct\s*<=\s*0[\s\S]{0,80}?runtime:\s*'v1'/.test(ts));
ok('front: NO se importa desde la ruta productiva (App.tsx no lo usa aún)',
   !/immersiveRuntimeFlag/.test(fs.readFileSync(path.join(ROOT,'App.tsx'),'utf8')));

delete process.env.IMMERSIVE_V2_COHORT_PCT;
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
