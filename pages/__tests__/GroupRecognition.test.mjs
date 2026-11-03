/**
 * GroupRecognition.test.mjs — CHP-GAMIFICACION-G4-UX-U4.
 *
 * Bloque «Reconocimiento en el grupo» de Aula Viva:
 *  [V] presentación pura (utils/groupRecognition.mjs)
 *  [R] render real (esbuild + react-dom/server): sin campo no hay bloque;
 *      suprimido, no disponible y conteos con texto; semántica y accesibilidad
 *  [S] estructura: integrado en Aula Viva, sin storage, sin nombres ni XP
 *
 *   node pages/__tests__/GroupRecognition.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { buildGroupRecognitionView } from '../../utils/groupRecognition.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const OK = { pedagogy: { pendingReview: 2 }, ledger: { status: 'ok', studentsWithRecognizedWork: 3 }, catalog: { eligibleWorks: 1 }, minGroupSize: 5 };
const SUP = { pedagogy: { pendingReview: 1 }, ledger: { status: 'suppressed', studentsWithRecognizedWork: null }, catalog: { eligibleWorks: 0 }, minGroupSize: 5 };
const ERR = { pedagogy: { pendingReview: 0 }, ledger: { status: 'unavailable', studentsWithRecognizedWork: null }, catalog: { eligibleWorks: null }, minGroupSize: 5 };

console.log('\n[V] presentación pura');
{
    ok('sin campo ⇒ null (gamificación o XP apagados)', buildGroupRecognitionView(undefined) === null && buildGroupRecognitionView(null) === null);
    const v = buildGroupRecognitionView(OK);
    ok('conteos con texto', v.pending.text === '2 entregas esperan tu revisión' && v.recognized.text === '3 estudiantes tienen al menos una obra reconocida'
        && v.eligible.text === '1 obra tiene experiencias que suman reconocimiento');
    const s = buildGroupRecognitionView(SUP);
    ok('suprimido: sin número y con explicación', s.recognized.value === null && /Datos insuficientes: se muestran con 5 estudiantes o más/.test(s.recognized.text));
    ok('0 obras elegibles: texto explícito, no promesa', s.eligible.value === 0 && /Aún no hay experiencias/.test(s.eligible.text));
    const e = buildGroupRecognitionView(ERR);
    ok('no disponible: nunca 0 inventado', e.recognized.value === null && e.eligible.value === null && /No pudimos cargar/.test(e.recognized.text));
    ok('un número inválido no se muestra', buildGroupRecognitionView({ ...OK, ledger: { status: 'ok', studentsWithRecognizedWork: -3 } }).recognized.value === null);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-grouprec-'));
const entry = path.join(tmp, 'entry.mjs');
const fwd = (p) => JSON.stringify(p.replace(/\\/g, '/'));
fs.writeFileSync(entry, `
export { GroupRecognitionBlock } from ${fwd(path.join(ROOT, 'components', 'aula-viva', 'GroupRecognitionBlock.tsx'))};
export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
`);
const bundle = path.join(tmp, 'bundle.mjs');
await esbuild.build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent',
    nodePaths: [path.join(ROOT, 'node_modules')], jsx: 'automatic', define: { 'import.meta.env': '{"DEV":false}' },
    banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" } });
const M = await import(pathToFileURL(bundle).href);
const render = (recognition, extra = {}) => M.renderToStaticMarkup(M.createElement(M.GroupRecognitionBlock,
    { state: { status: 'ready', summary: { groupId: 'g', readerCount: 7, ...(recognition ? { recognition } : {}) } }, ...extra }));
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

try {
    console.log('\n[R] render real');
    ok('sin campo `recognition`: no se pinta nada', render(undefined) === '');
    ok('cargando o error del resumen: nada', M.renderToStaticMarkup(M.createElement(M.GroupRecognitionBlock, { state: { status: 'loading' } })) === ''
        && M.renderToStaticMarkup(M.createElement(M.GroupRecognitionBlock, { state: { status: 'error' } })) === '');
    const h = render(OK, { onReview: () => {} });
    ok('sección con h2 enlazado y tres tarjetas h3', /<section aria-labelledby="av-reconocimiento"/.test(h) && /<h2 id="av-reconocimiento"/.test(h) && (h.match(/<h3 /g) ?? []).length === 3);
    ok('el texto completo acompaña al número (el número es decorativo)', text(h).includes('2 entregas esperan tu revisión') && /aria-hidden="true">2<\/p>/.test(h));
    ok('botón «Ir a Producciones» real (≥ 44 px, foco visible) solo si hay pendientes', /<button type="button"[^>]*min-h-\[44px\][^>]*focus-visible:ring-4[^>]*>\s*Ir a Producciones/.test(h)
        && !/Ir a Producciones/.test(render({ ...OK, pedagogy: { pendingReview: 0 } }, { onReview: () => {} })));
    ok('aviso explícito: sin XP, niveles ni datos individuales', text(h).includes('No se muestran XP, niveles ni datos de cada estudiante'));
    const s = render(SUP);
    ok('suprimido: «Datos insuficientes», sin número de reconocidos', text(s).includes('Datos insuficientes') && !/aria-hidden="true">\d+<\/p>\s*<p[^>]*>Datos/.test(s));
    ok('iconos decorativos ocultos', (h.match(/<span aria-hidden="true"/g) ?? []).length === 3);
    ok('sin rankings, rachas ni comparaciones', !/ranking|racha|mejor|peor|puesto|promedio de XP/i.test(text(h)));

    console.log('\n[S] estructura');
    const av = code(read('pages/AulaViva.tsx'));
    ok('Aula Viva lo monta bajo los KPIs con el mismo estado del resumen', /<GroupAnalyticsKpis state=\{groupAnalytics\} \/>\s*(?:\{\}\s*)?<GroupRecognitionBlock state=\{groupAnalytics\} onReview=\{\(\) => setActiveTab\('producciones'\)\} \/>/.test(av));
    const comp = code(read('components/aula-viva/GroupRecognitionBlock.tsx')), util = code(read('utils/groupRecognition.mjs'));
    ok('sin storage en el navegador', !/localStorage|sessionStorage|indexedDB|caches\./.test(comp + util));
    ok('no usa nombres ni datos por lector', !/readers|nombre|userId|\.xp\b|getXp/.test(comp + util));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nGroupRecognition (G4-UX-U4): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
