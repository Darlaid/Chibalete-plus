/**
 * readingRuntimeFlag.test.mjs — CRR Fase 1 / resolver multi-modo.
 *
 * Sigue exactamente el patrón de `immersiveRuntimeFlag.test.mjs`:
 *  1. Validación estructural del .ts (FNV-1a, precedencia, mode-key).
 *  2. Port inline del resolver para tests de comportamiento (determinismo,
 *     reparto, killswitch).
 *  3. Confirmación de no-import desde el routing productivo (App.tsx).
 *
 *  node utils/__tests__/readingRuntimeFlag.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// Importar el resolver REAL desde el .mjs — Fase 2 lo separó del .ts para
// permitir tests node-only. Si esta importación falla, hay drift entre el
// runtime y los tests (la validación estructural de §1 falla primero).
import { resolveReadingRuntime as resolveReadingRuntimePort } from '../readingRuntimeFlag.mjs';

console.log('\n[1] estructura del .mjs (espeja immersiveRuntimeFlag + extiende a modos)');
const mjsPath = path.join(ROOT, 'utils', 'readingRuntimeFlag.mjs');
const mjs = fs.readFileSync(mjsPath, 'utf8');
ok('archivo existe',                        mjs.length > 0);
ok('FNV-1a offset 0x811c9dc5',              /0x811c9dc5/.test(mjs));
ok('FNV-1a prime 0x01000193',               /0x01000193/.test(mjs));
ok('killswitch precede a todo',             /cfg\.killSwitch[\s\S]{0,200}?runtime:\s*'v1'[\s\S]{0,80}?'killswitch'/.test(mjs));
ok('default seguro v1 (cohort 0)',          /pct\s*<=\s*0[\s\S]{0,160}?runtime:\s*'v1'/.test(mjs));
ok('cohorte 100 → v2',                      /pct\s*>=\s*100[\s\S]{0,160}?runtime:\s*'v2'/.test(mjs));
ok('hash suffix por modo (anti-correlación)', /\$\{userId\s*\?\?\s*'anon'\}__\$\{mode\}/.test(mjs));
ok('localStorage key por modo',             /READING_RUNTIME__\$\{mode\}/.test(mjs));
ok('default cohortPct vacío = todo OFF',    /cohortPct:\s*\{\s*\}/.test(mjs) || /cohortPct:\s*\{\s*}/.test(mjs));

// .d.ts paired con .mjs — declara los 5 modos
const dtsPath = path.join(ROOT, 'utils', 'readingRuntimeFlag.d.ts');
const dts = fs.readFileSync(dtsPath, 'utf8');
ok('.d.ts declara 5 modos canónicos',
   /'immersive'\s*\|\s*'accessible'\s*\|\s*'guided'\s*\|\s*'pdf'\s*\|\s*'album'/.test(dts));

console.log('\n[2] No se importa desde rutas productivas');
const appTsx = fs.readFileSync(path.join(ROOT, 'App.tsx'), 'utf8');
ok('App.tsx NO importa readingRuntimeFlag', !/readingRuntimeFlag/.test(appTsx));

console.log('\n[3] Comportamiento — default seguro');
const modes = ['immersive', 'accessible', 'guided', 'pdf', 'album'];
for (const m of modes) {
    const d = resolveReadingRuntimePort('u-1', m);
    ok(`${m}: default → v1`,                d.runtime === 'v1');
    ok(`${m}: default reason cohort_0_${m}`, d.reason === `cohort_0_${m}`);
}

console.log('\n[4] Killswitch gana sobre cohorte 100% en TODOS los modos');
for (const m of modes) {
    const d = resolveReadingRuntimePort('u-x', m, {
        killSwitch: true,
        cohortPct: { [m]: 100 },
    });
    ok(`${m}: killswitch fuerza v1 con cohorte 100`, d.runtime === 'v1' && d.reason === 'killswitch');
}

console.log('\n[5] Cohorte 100% → v2 SOLO en el modo activado');
const cfg100Acc = { killSwitch: false, cohortPct: { accessible: 100 } };
ok('accessible 100% → v2',  resolveReadingRuntimePort('u', 'accessible', cfg100Acc).runtime === 'v2');
ok('immersive 0% → v1',     resolveReadingRuntimePort('u', 'immersive',  cfg100Acc).runtime === 'v1');
ok('guided 0% → v1',        resolveReadingRuntimePort('u', 'guided',     cfg100Acc).runtime === 'v1');
ok('pdf 0% → v1',           resolveReadingRuntimePort('u', 'pdf',        cfg100Acc).runtime === 'v1');
ok('album 0% → v1',         resolveReadingRuntimePort('u', 'album',      cfg100Acc).runtime === 'v1');

console.log('\n[6] Determinismo + estabilidad por userId');
const cfg50 = { killSwitch: false, cohortPct: { immersive: 50, accessible: 50 } };
const a1 = resolveReadingRuntimePort('user-det-001', 'immersive', cfg50);
const a2 = resolveReadingRuntimePort('user-det-001', 'immersive', cfg50);
ok('mismo (userId, mode) → mismo bucket', a1.runtime === a2.runtime && a1.bucket === a2.bucket);

console.log('\n[7] Anti-correlación cross-mode con mismo userId');
// El sufijo __${mode} asegura buckets distintos para el mismo usuario en
// modos distintos. Sobre 200 usuarios al 50%, la coincidencia ideal sería
// ~50%; aceptamos un rango razonable para evitar tests flaky.
let sameBucketCount = 0;
for (let i = 0; i < 200; i++) {
    const uid = `corr-${i}`;
    const im = resolveReadingRuntimePort(uid, 'immersive',  cfg50);
    const ac = resolveReadingRuntimePort(uid, 'accessible', cfg50);
    if (im.runtime === ac.runtime) sameBucketCount++;
}
ok('cross-mode independent (40..160 coincidencias sobre 200)',
   sameBucketCount >= 40 && sameBucketCount <= 160,
   `coincidencias=${sameBucketCount}`);

console.log('\n[8] Reparto ~50% en cohorte 50%');
let v2Count = 0;
for (let i = 0; i < 1000; i++) {
    if (resolveReadingRuntimePort('user-' + i, 'accessible', cfg50).runtime === 'v2') v2Count++;
}
ok('cohorte 50% reparte ~50% (350..650 de 1000)',
   v2Count > 350 && v2Count < 650,
   `v2=${v2Count}`);

console.log('\n[9] Clamping defensivo de cohortPct');
ok('negative → v1 (clamp a 0)', resolveReadingRuntimePort('u', 'immersive', { cohortPct: { immersive: -50 } }).runtime === 'v1');
ok('>100 → v2 (clamp a 100)',   resolveReadingRuntimePort('u', 'immersive', { cohortPct: { immersive: 999 } }).runtime === 'v2');
ok('NaN tratado como 0',        resolveReadingRuntimePort('u', 'immersive', { cohortPct: { immersive: NaN } }).runtime === 'v1');

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
