/**
 * ActivarCuentaA5.test.mjs — CHP-V8.1-PROD-03D (DIR-V81-09).
 *
 * La explicación de A5 en la activación cubre exactamente las tres actividades de voz
 * del 004 (ficha 6.3), sin cambiar cómo se registra la decisión:
 *  [R] render real de ActivarCuenta (esbuild + react-dom/server): texto visible, antes de
 *      elegir, asociado al grupo (aria-labelledby/-describedby), sin casillas nuevas
 *  [P] registro: A5 Sí / No / pendiente produce exactamente lo mismo que antes; una
 *      negativa no bloquea la activación ni A3
 *  [S] estructura: A3 y A5 sin premarcar, A5 solo se envía si se decide, enlace al 004
 *
 *   node pages/__tests__/ActivarCuentaA5.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import { planActivationDecisions } from '../../server/privacy/acceptance.mjs';
import { ACCEPTANCE_DOCUMENTS as DOCS } from '../../utils/acceptanceDocuments.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => (c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++));
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ');
const count = (s, re) => (s.match(re) ?? []).length;

// ── [R] render real ──────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-activar-a5-'));
const fwd = (p) => JSON.stringify(p.replace(/\\/g, '/'));
const entry = path.join(tmp, 'entry.jsx');
fs.writeFileSync(entry, `
export { default as ActivarCuenta } from ${fwd(path.join(ROOT, 'pages', 'ActivarCuenta.tsx'))};
export { renderToStaticMarkup } from 'react-dom/server';
export { createElement } from 'react';
export { MemoryRouter } from 'react-router-dom';
`);
const bundle = path.join(tmp, 'bundle.mjs');
let M = null;
// Referencia de la versión anterior (7402072), calculada al preparar esta unidad con el mismo render.
// Fija en la prueba: la CI hace checkout superficial y no tiene ese commit.
//  - controles del formulario (tipo:nombre:valor), ordenados;
//  - SHA-256 del texto visible sin el bloque A5 (de «A5 ·» a «Si no respondes, queda pendiente.»).
const BASE_CONTROLS = 'checkbox::|checkbox::|password::|password::|radio:A1:no|radio:A1:yes|radio:A2:no|radio:A2:not_applicable|radio:A2:yes|radio:A3:no|radio:A3:yes|radio:A5:no|radio:A5:yes|radio:actingAs:legal_representative|radio:actingAs:titular';
const BASE_REST_SHA = '3a3c208a4613ad575f467381883c06ac2c146f2b39f2a7a36a84c4f2a1415b0d';
try {
    await esbuild.build({
        entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: bundle, logLevel: 'silent',
        nodePaths: [path.join(ROOT, 'node_modules')], jsx: 'automatic', define: { 'import.meta.env': '{"DEV":false}' },
        banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
    });
    M = await import(pathToFileURL(bundle).href);
} catch (e) {
    ok('ActivarCuenta se compila para el render', false, e?.message);
}

console.log('\n[R] render real de ActivarCuenta');
if (M) {
    const html = M.renderToStaticMarkup(M.createElement(M.MemoryRouter, { initialEntries: ['/activar-cuenta?token=t-prueba'] }, M.createElement(M.ActivarCuenta)));
    const t = text(html);
    const groupAt = html.indexOf('aria-labelledby="a5-titulo"');
    const g = groupAt >= 0 ? html.slice(groupAt, html.indexOf('</div>', html.indexOf('name="A5"', groupAt))) : '';
    const tg = text(g);
    ok('A5 se presenta como una decisión de voz para tres actividades', t.includes('A5 · Voz: lectura en voz alta, dictado a Leo y respuestas orales (opcional).'));
    ok('ya no se presenta como solo «transcripción de la lectura en voz alta»', !t.includes('Transcripción automática de la lectura en voz alta') && !t.includes('en esa actividad'));
    ok('(1) y (2): lectura en voz alta y dictado a Leo, con el reconocimiento del navegador', tg.includes('Lectura en voz alta y dictado de preguntas a Leo: el servicio de reconocimiento de voz de tu navegador transcribe la voz'));
    ok('Chibalete no recibe la voz; del dictado solo el texto, que requiere A3', tg.includes('Chibalete no recibe la voz; del dictado solo recibe el texto de la pregunta, que además requiere A3'));
    ok('(3): las respuestas orales son locales y temporales, sin envío', tg.includes('Respuestas orales a tareas: la grabación se queda en este dispositivo solo mientras la usas y no se envía a nadie, tampoco a Chibalete'));
    ok('una sola decisión, opcional e independiente de A3; efecto de no autorizar', tg.includes('Es una sola decisión para las tres actividades e independiente de A3')
        && tg.includes('Sin A5 no se abre el micrófono') && tg.includes('escribir a Leo si autorizas A3') && tg.includes('Si no respondes, queda pendiente'));
    ok('la explicación está antes de las opciones Sí/No', g.indexOf('id="a5-ayuda"') > 0 && g.indexOf('id="a5-ayuda"') < g.indexOf('name="A5"'));
    ok('grupo accesible: role=group con nombre (a5-titulo) y descripción (a5-ayuda) existentes', /role="group" aria-labelledby="a5-titulo" aria-describedby="a5-ayuda"/.test(html)
        && /<span id="a5-titulo"/.test(html) && /<ul id="a5-ayuda"/.test(html));
    ok('A5 sigue siendo Sí / No, sin premarcar', count(html, /name="A5"/g) === 2 && /value="yes"[^>]*\/?>Sí, autorizo/.test(g) && /value="no"[^>]*\/?>No autorizo/.test(g) && !/name="A5"[^>]*checked/.test(html));
    // Misma lista de controles que la versión base (7402072): sin casillas ni decisiones nuevas.
    const controls = (h) => (h.match(/<input [^>]*>/g) ?? []).map((i) => `${(i.match(/type="([^"]+)"/) ?? [])[1]}:${(i.match(/name="([^"]+)"/) ?? [])[1] ?? ''}:${(i.match(/value="([^"]+)"/) ?? [])[1] ?? ''}`).sort().join('|');
    ok('no aparecen casillas ni decisiones nuevas (mismos controles que en 7402072)', controls(html) === BASE_CONTROLS, controls(html));
    ok('solo cambia el bloque A5 (el resto del texto visible es idéntico a 7402072)', (() => {
        // Se quita el bloque A5 completo: ahora la explicación va antes de Sí/No y el bloque termina en «No autorizo».
        const x = text(html); const a = x.indexOf('A5 ·'); const end = 'Sí, autorizo No autorizo'; const e = x.indexOf(end, a);
        return a >= 0 && e >= 0 && createHash('sha256').update(x.slice(0, a) + x.slice(e + end.length)).digest('hex') === BASE_REST_SHA;
    })());
    ok('el enlace al 004 sigue en la lista de documentos', t.includes(DOCS.dataNotice.title));
}

// ── [P] registro de la decisión ──────────────────────────────────────────────
console.log('\n[P] registro de A5 (sin cambios)');
{
    const reader = { id: 'u-lector', roles: ['lector'] };
    const base = { terms: true, termsVersion: DOCS.terms.version, dataNoticeVersion: DOCS.dataNotice.version, actingAs: 'titular', adultDeclared: true, A1: 'yes' };
    const ctx = { today: '2026-11-11', ref: 'ACT-prueba' };
    const kinds = (p) => p.decisions.filter((d) => d.kind === 'A5' || d.kind === 'A3').map((d) => `${d.kind}:${d.status}:${d.version}`).sort().join(',');
    const yes = planActivationDecisions(reader, { ...base, A5: 'yes' }, ctx);
    const no = planActivationDecisions(reader, { ...base, A5: 'no' }, ctx);
    const pend = planActivationDecisions(reader, { ...base }, ctx);
    ok('A5 Sí ⇒ una decisión A5 concedida con 004@1.0', yes.ok && kinds(yes) === `A5:granted:${DOCS.dataNotice.version}`);
    ok('A5 No ⇒ una decisión A5 denegada, y la activación sigue', no.ok && kinds(no) === `A5:denied:${DOCS.dataNotice.version}` && no.decisions.some((d) => d.kind === 'A1' && d.status === 'granted'));
    ok('sin respuesta ⇒ A5 no se registra (pendiente), y la activación sigue', pend.ok && !pend.decisions.some((d) => d.kind === 'A5'));
    const a3yesA5no = planActivationDecisions(reader, { ...base, A3: 'yes', A5: 'no' }, ctx);
    ok('A5 No no afecta A3 Sí (Leo escrito sigue disponible)', a3yesA5no.ok && kinds(a3yesA5no) === `A3:granted:${DOCS.dataNotice.version},A5:denied:${DOCS.dataNotice.version}`);
    const bad = planActivationDecisions(reader, { ...base, A5: 'si' }, ctx);
    ok('un valor distinto de yes/no sigue rechazándose', !bad.ok && bad.code === 'DECISIONS_REQUIRED' && bad.required?.includes('A5'));
}

// ── [S] estructura ──────────────────────────────────────────────────────────
console.log('\n[S] estructura');
{
    const src = read('pages/ActivarCuenta.tsx');
    ok('A3 y A5 empiezan sin decidir', /\[a3, setA3\]\s*=\s*useState<'' \| 'yes' \| 'no'>\(''\)/.test(src) && /\[a5, setA5\]\s*=\s*useState<'' \| 'yes' \| 'no'>\(''\)/.test(src));
    ok('A5 solo se envía si se decidió (igual que antes)', /\.\.\.\(a5 \? \{ A5: a5 \} : \{\}\)/.test(src));
    ok('una sola pregunta A5', count(src, /<Choice name="A5"/g) === 1);
    ok('sin texto antiguo limitado a la lectura en voz alta', !/Transcripción automática de la lectura en voz alta/.test(src));
    ok('opciones de decisión sin cambios', read('utils/acceptanceDocuments.mjs').includes("A5: Object.freeze(['yes', 'no'])"));
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\nActivarCuenta A5 (V8.1-PROD-03D): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
