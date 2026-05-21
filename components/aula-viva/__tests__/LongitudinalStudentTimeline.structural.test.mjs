/**
 * LongitudinalStudentTimeline.structural.test.mjs — Fase 3A lock-in.
 *
 * El componente es un wrapper React fino sobre el payload del endpoint
 * /students/:userId/timeline (más summaries del engine determinístico).
 * Su lógica real es trivial (presentación). Este test bloquea regresiones
 * estructurales:
 *
 *   1. NO hace fetch interno (recibe data via prop).
 *   2. NO usa canvas, D3, three.js, ni librerías de visualización pesadas.
 *   3. NO referencia `dangerouslySetInnerHTML`, `eval`, ni innerHTML directo.
 *   4. Reusa `RiskBadge` y `EmptyState` (no reimplementa).
 *   5. Cada summary card incluye caveat visible (template literal o variable
 *      `summary.caveat`).
 *   6. Sin vocabulario prohibido en string literals (no "comprende",
 *      "fracasa", "tiene problemas de").
 *   7. Estructura semántica: <article>, <section>, <h3>, role="status".
 *   8. Aria labels presentes en todas las secciones principales.
 *
 *   node components/aula-viva/__tests__/LongitudinalStudentTimeline.structural.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tsxPath = path.join(__dirname, '..', 'LongitudinalStudentTimeline.tsx');

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

console.log('LongitudinalStudentTimeline — lock-in estructural');
ok('archivo existe', fs.existsSync(tsxPath));
const src = fs.readFileSync(tsxPath, 'utf8');

section('[1] NO hace fetch interno (data via prop)');
ok('NO contiene fetch(',                      !/\bfetch\s*\(/.test(src));
ok('NO contiene axios',                       !/\baxios\b/.test(src));
ok('recibe data como prop',                   /data:\s*LongitudinalTimelinePayload/.test(src));

section('[2] NO usa libs de visualización pesadas');
const heavyLibs = ['d3-', 'd3.', 'three', 'chart.js', 'canvas', 'plotly', 'echarts'];
for (const lib of heavyLibs) {
    ok(`NO importa ${lib}`,                   !new RegExp(`from\\s+['"][^'"]*${lib.replace('.', '\\.')}`).test(src));
}

section('[3] NO referencias inseguras');
ok('NO usa dangerouslySetInnerHTML',          !/dangerouslySetInnerHTML/.test(src));
ok('NO usa eval(',                            !/\beval\s*\(/.test(src));
ok('NO asigna innerHTML directo',             !/\.innerHTML\s*=/.test(src));

section('[4] reusa componentes existentes');
ok('importa RiskBadge',                       /from\s+['"]\.\/RiskBadge['"]/.test(src));
ok('importa EmptyState',                      /from\s+['"]\.\/EmptyState['"]/.test(src));
ok('usa <RiskBadge ',                         /<RiskBadge\s/.test(src));
ok('usa <EmptyState ',                        /<EmptyState\s/.test(src));

section('[5] summary card incluye caveat');
ok('renderiza summary.caveat',                /summary\.caveat/.test(src));
ok('summary.evidence visible',                /summary\.evidence/.test(src));
ok('summary.headline visible',                /summary\.headline/.test(src));
ok('summary.confidence visible',              /summary\.confidence/.test(src));

section('[6] vocabulario observacional — sin afirmaciones excesivas');
const forbiddenPhrases = [
    'comprende perfectamente',
    'fracasa',
    'tiene problemas',
    'es un mal lector',
    'no sabe leer',
    'rankings',
    'ranking de estudiantes',
];
for (const phrase of forbiddenPhrases) {
    ok(`NO contiene literal "${phrase}"`, !src.toLowerCase().includes(phrase.toLowerCase()));
}
// El footer debe contener el caveat global pedagógico
ok('footer menciona "Ninguna afirma comprensión"',
   /Ninguna afirma comprensión/.test(src));
ok('footer menciona "mediador"',
   /mediador/.test(src));

section('[7] estructura semántica');
ok('usa <article ',                           /<article\b/.test(src));
ok('usa <section ',                           /<section\b/.test(src));
ok('usa <h3 ',                                /<h3\b/.test(src));
ok('usa <header ',                            /<header\b/.test(src));
ok('usa <footer ',                            /<footer\b/.test(src));
ok('usa role="status" en loading',            /role=['"]status['"]/.test(src));

section('[8] aria-labels en secciones principales');
ok('aria-label en componente raíz',           /aria-label=['"][^'"]*[Tt]imeline[^'"]*['"]/.test(src));
ok('aria-label en sección observaciones',     /aria-label=['"][^'"]*observacionales/.test(src));
ok('aria-label en sección riesgos',           /aria-label=['"][^'"]*[Rr]iesgos/.test(src));
ok('aria-label en sección recomendaciones',   /aria-label=['"][^'"]*[Rr]ecomendaciones/.test(src));
ok('aria-hidden en iconos decorativos',       /aria-hidden/.test(src));

section('[9] mobile-friendly (Tailwind sm: prefixes)');
ok('usa breakpoints sm:',                     /\bsm:/.test(src));
ok('text scales (text-xs sm:text-sm o similar)', /text-(xs|sm).*sm:text-(sm|base)/.test(src));

section('[10] defensa contra data null/undefined');
ok('chequea data === null',                   /if\s*\(\s*!data\s*\)/.test(src));
ok('chequea loading',                         /loading\s*\?/.test(src) || /if\s*\(\s*loading\s*\)/.test(src));
ok('chequea Array.isArray para arrays',       /Array\.isArray\(/.test(src));
ok('chequea profile_current === null',        /profile_current\s*===\s*null/.test(src));

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
