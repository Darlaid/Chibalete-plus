/**
 * mookContextualReturn01.test.mjs — CHP-MOOK-CONTEXTUAL-READING-RETURN-01.
 *
 * Retorno exacto al MOOK desde una lectura.
 *
 *   A. Contrato de navegación — helpers puros de `utils/mookReturn.mjs`.
 *   B. Resolución contra rutas REALES de `computeRouteView`: qué nodo puede
 *      abrirse al volver y cuál no.
 *   C. Cableado — que las tres superficies (Runtime, ficha y los cinco lectores)
 *      lleven y respeten el origen.
 *
 * Lo que NO se simula: el desbloqueo. La autoridad sigue siendo el backend; el
 * `nodeId` de la URL es una pista, no una credencial.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    emptyMookStore, createExperience, createDraftVersion, publishVersion,
    startRun, completeNode, computeRouteView,
} from '../lib/experienceStore.js';
import {
    readMookContext, withMookContext, mookReturnPath, resolveReturnNode,
} from '../../utils/mookReturn.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok — ${name}`); };

// ──────────────────────── A. CONTRATO DE NAVEGACIÓN ──────────────────────────

console.log('\nA. Contrato de navegación');

{
    assert.deepStrictEqual(readMookContext('?exp=exp-1&node=n-a01'), { experienceId: 'exp-1', nodeId: 'n-a01' });
    assert.deepStrictEqual(readMookContext('exp=exp-1&node=n-a01'), { experienceId: 'exp-1', nodeId: 'n-a01' });
    ok('el origen se lee de la query, con o sin «?»');
}

{
    for (const s of ['', '?', '?exp=exp-1', '?node=n-a01', '?foo=bar']) {
        assert.strictEqual(readMookContext(s), null, `no debe inventar contexto: ${s}`);
    }
    ok('sin los DOS identificadores no hay origen: nunca se inventa');
}

{
    // Los ids se acotan en forma. Una URL de retorno arbitraria no es aceptable
    // ni siquiera colada dentro de un parámetro.
    assert.strictEqual(readMookContext('?exp=https://malo.example/x&node=n-1'), null);
    assert.strictEqual(readMookContext('?exp=exp-1&node=../../etc/passwd'), null);
    assert.strictEqual(readMookContext(`?exp=exp-1&node=${'x'.repeat(200)}`), null);
    ok('no se acepta una URL de retorno arbitraria ni un id con forma extraña');
}

{
    assert.strictEqual(withMookContext('/contenido/c-1', null), '/contenido/c-1');
    assert.strictEqual(withMookContext('/contenido/c-1', { experienceId: '', nodeId: 'n-1' }), '/contenido/c-1');
    ok('sin origen la ruta no se toca: desde Biblioteca no aparecen parámetros inventados');
}

{
    const ctx = { experienceId: 'exp-1', nodeId: 'n-a01' };
    const url = withMookContext('/leer/texto/c-1', ctx);
    assert.deepStrictEqual(readMookContext(url.slice(url.indexOf('?'))), ctx, 'ida y vuelta exacta');
    // Y conserva lo que la ruta ya traía.
    const conserva = withMookContext('/leer/texto/c-1?modo=x', ctx);
    assert.ok(conserva.includes('modo=x'));
    assert.deepStrictEqual(readMookContext(conserva.slice(conserva.indexOf('?'))), ctx);
    ok('el origen viaja en la URL, sobrevive al viaje y no pisa otros parámetros');
}

{
    assert.strictEqual(mookReturnPath({ experienceId: 'exp-1', nodeId: 'n-a01' }), '/experiencias/exp-1?node=n-a01');
    assert.strictEqual(mookReturnPath(null), null);
    // El destino lo CONSTRUYE el helper a partir de dos ids: no puede ser abierto.
    const p = mookReturnPath({ experienceId: 'exp-1', nodeId: 'n-a01' });
    assert.ok(p.startsWith('/experiencias/'), 'siempre interno');
    ok('el destino del retorno se construye, no se acepta: nunca un redirect abierto');
}

// ─────────────── B. RESOLUCIÓN CONTRA RUTAS REALES DEL SERVIDOR ──────────────

console.log('\nB. Qué nodo puede abrirse al volver');

const CATALOG = [
    { id: 'content-a01', titulo: 'A01', autor: 'x', tipo: 'podcast', status: 'disponible' },
    { id: 'content-carta', titulo: 'Carta', autor: 'x', tipo: 'libro', status: 'disponible' },
];
const bookExists = (id) => CATALOG.some(c => c.id === id);

function fixture() {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'ret', title: 'Retorno', description: 'd' });
    const v = createDraftVersion(doc, exp.id, {
        objectives: ['o'],
        modules: [{
            id: 'm0', title: 'M0', nodes: [
                { id: 'n-a01', type: 'AUDIO', title: 'A01', required: true, resourceRef: 'content-a01', config: { transcripcion: 't' } },
                { id: 'n-carta', type: 'READING', title: 'Carta de entrada', required: true, resourceRef: 'content-carta' },
                { id: 'n-b00', type: 'ACTIVITY', title: 'B00', required: true, config: { privado: true, preguntas: [{ texto: 'p', tipo: 'text_short' }] } },
            ],
        }],
    }, bookExists);
    publishVersion(doc, v.id);
    const { run } = startRun(doc, { userId: 'u-1', experienceId: exp.id });
    return { doc, exp, run };
}

{
    const { doc, run } = fixture();
    completeNode(doc, run.id, 'n-a01');
    const nodes = computeRouteView(doc, doc.runs[0], CATALOG).nodes;
    assert.deepStrictEqual(nodes.map(n => n.state), ['completed', 'current', 'locked']);

    assert.strictEqual(resolveReturnNode(nodes, 'n-a01'), 'n-a01', 'un completado sí se abre');
    assert.strictEqual(resolveReturnNode(nodes, 'n-carta'), 'n-carta', 'la frontera sí se abre');
    ok('vuelve a un nodo completado y a la frontera');
}

{
    const { doc, run } = fixture();
    completeNode(doc, run.id, 'n-a01');
    const nodes = computeRouteView(doc, doc.runs[0], CATALOG).nodes;

    assert.strictEqual(resolveReturnNode(nodes, 'n-b00'), null, 'un bloqueado JAMÁS se abre');
    assert.strictEqual(resolveReturnNode(nodes, 'n-inexistente'), null, 'un nodo que no existe tampoco');
    assert.strictEqual(resolveReturnNode(nodes, ''), null);
    assert.strictEqual(resolveReturnNode(null, 'n-a01'), null);
    ok('un nodo bloqueado, ajeno o inexistente no se abre ni se desbloquea');
}

{
    // La resolución es una LECTURA: no toca el run ni los estados.
    const { doc, run } = fixture();
    completeNode(doc, run.id, 'n-a01');
    const antes = JSON.stringify(doc.runs[0]);
    const nodes = computeRouteView(doc, doc.runs[0], CATALOG).nodes;
    for (const id of ['n-a01', 'n-carta', 'n-b00', 'n-x']) resolveReturnNode(nodes, id);
    assert.strictEqual(JSON.stringify(doc.runs[0]), antes, 'el run no puede haberse tocado');
    ok('resolver el retorno no completa, no descompleta y no mueve la frontera');
}

// ──────────────────────────── C. CABLEADO REAL ───────────────────────────────

console.log('\nC. Cableado de las tres superficies');

const runtime = fs.readFileSync(path.join(REPO, 'pages', 'Experiencias.tsx'), 'utf8');
const ficha = fs.readFileSync(path.join(REPO, 'pages', 'PaginaDetalleLibro.tsx'), 'utf8');

{
    assert.match(runtime, /withMookContext\(`\/contenido\/\$\{node\.resource\.id\}`, \{ experienceId: route\?\.experienceId, nodeId: node\.id \}\)/,
        'el enlace «Abrir …» transporta experienceId + nodeId');
    assert.match(runtime, /preview \? `\/contenido\/\$\{node\.resource\.id\}`/,
        'en preview no se inventa recorrido');
    ok('el Runtime transporta el origen al abrir una lectura');
}

{
    assert.match(runtime, /resolveReturnNode\(route\.nodes \?\? \[\], asked\)/, 'el retorno se valida contra route.nodes');
    assert.match(runtime, /navigate\(`\/experiencias\/\$\{route\.experienceId\}`, \{ replace: true \}\)/,
        'el parámetro se consume con replace: sin ciclo en el botón Atrás');
    assert.match(runtime, /returnHandled/, 'el retorno se atiende una sola vez');
    ok('el Runtime valida el nodo, lo abre y limpia el parámetro con replace');
}

{
    assert.match(runtime, /querySelector\('h4'\)\?\.focus\?\.\(\)/, 'el foco acompaña al scroll');
    assert.match(runtime, /<h4 tabIndex=\{-1\}/, 'el encabezado puede recibir foco');
    ok('al volver, la tarjeta se enfoca además de desplazarse');
}

{
    assert.match(ficha, /mookCtx \? 'Volver al MOOK' : 'Volver'/, 'la etiqueta depende del origen');
    assert.match(ficha, /to=\{mookCtx \? \(mookReturnPath\(mookCtx\) \?\? '\/biblioteca'\) : '\/biblioteca'\}/,
        'sin origen, Biblioteca como siempre');
    assert.match(ficha, /const mookCtx = readMookContext\(location\.search\)/, 'el origen se lee de la URL, no de location.state');
    assert.ok(!/document\.referrer/.test(ficha), 'nunca se usa el referrer');
    ok('la ficha muestra «Volver al MOOK» solo con origen, y Biblioteca sin él');
}

{
    // Los ocho accesos a modos de lectura propagan el origen.
    const modos = (ficha.match(/goRead\(`\/(leer|ver|galeria)/g) ?? []).length;
    assert.ok(modos >= 7, `todos los modos deben propagar el origen (encontrados ${modos})`);
    assert.ok(!/navigate\(`\/leer\//.test(ficha), 'ningún modo puede navegar perdiendo el origen');
    ok(`los ${modos} accesos a modos de lectura propagan el origen`);
}

{
    const lectores = ['VisorPDF', 'VisorTexto', 'VisorInmersivo', 'VisorAlbum', 'VisorAccesible'];
    for (const l of lectores) {
        const src = fs.readFileSync(path.join(REPO, 'pages', `${l}.tsx`), 'utf8');
        assert.match(src, /useFichaPath\(/, `${l}: el regreso debe conservar el origen`);
        assert.match(src, /(navigate|useNavigateTo)\(fichaPath\)/, `${l}: el control de regreso usa la ruta con origen`);
    }
    ok('los cinco lectores vuelven a la ficha conservando el origen');
}

{
    // El control de regreso de la CABECERA ya no depende de la historia del
    // navegador —esa no sabe de dónde vino la lectura—. Los `navigate(-1)` que
    // quedan en VisorInmersivo son otra cosa y quedan FUERA de esta unidad: el
    // overlay de acceso denegado y la salida del bloqueo de reproducción. Se
    // fija su número para que nadie los reintroduzca en la cabecera sin verlo.
    const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const restantes = {};
    for (const l of ['VisorPDF', 'VisorTexto', 'VisorInmersivo', 'VisorAlbum', 'VisorAccesible']) {
        const src = codeOnly(fs.readFileSync(path.join(REPO, 'pages', `${l}.tsx`), 'utf8'));
        restantes[l] = (src.match(/navigate\(-1\)/g) ?? []).length;
    }
    assert.deepStrictEqual(restantes, {
        VisorPDF: 0, VisorTexto: 0, VisorInmersivo: 2, VisorAlbum: 0, VisorAccesible: 0,
    }, 'solo quedan los dos navigate(-1) ajenos a la cabecera, en VisorInmersivo');
    ok('ningún control de regreso de cabecera usa la historia del navegador');
}

{
    // El salto directo existe donde el usuario lo necesita, y NUNCA sin origen.
    const conBoton = ['VisorPDF', 'VisorTexto', 'VisorInmersivo']
        .filter(l => /MookReturnButton/.test(fs.readFileSync(path.join(REPO, 'pages', `${l}.tsx`), 'utf8')));
    assert.deepStrictEqual(conBoton.sort(), ['VisorInmersivo', 'VisorPDF', 'VisorTexto']);
    const comp = fs.readFileSync(path.join(REPO, 'components', 'MookReturn.tsx'), 'utf8');
    assert.match(comp, /if \(!to\) return null;/, 'sin origen el botón no se renderiza');
    assert.match(comp, /aria-label="Volver al MOOK, al paso de origen"/, 'nombre accesible');
    assert.ok(!/localStorage|sessionStorage|document\.referrer/.test(comp), 'sin almacenamiento ni referrer');
    ok('«Volver al MOOK» aparece solo con origen válido y es accesible');
}

console.log(`\nCHP-MOOK-CONTEXTUAL-READING-RETURN-01 — ${passed} aserciones OK\n`);
