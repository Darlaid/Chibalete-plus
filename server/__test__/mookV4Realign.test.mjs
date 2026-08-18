/**
 * mookV4Realign.test.mjs — CHP-MOOK-V4-REALIGN-01. Casos A–J de la unidad.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    emptyMookStore, normalizeMookStore, createExperience, createDraftVersion,
    updateDraftVersion, publishVersion, startRun, completeNode, submitEvidence,
    computeRouteView, runProgress, moduleState, versionNodes, moduleOfNode, listPublished,
} from '../lib/experienceStore.js';
import { computeEditorialView, addReference, emptyLibrary, addCollection, updateCollection } from '../lib/libraryStore.js';
import { validateEvent } from '../analytics/eventRegistry.js';

const CATALOG = [
    { id: 'content-libro-x', titulo: 'Libro X', autor: 'A', tipo: 'libro', status: 'disponible', portada_url: '/u/x.jpg' },
    { id: 'content-clip-y', titulo: 'Clip Y', autor: 'B', tipo: 'video', status: 'disponible', portada_url: '/u/y.jpg', standalone: false },
];
const bookExists = (id) => CATALOG.some(c => c.id === id);
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

// Fixture sintética 2 (≠ piloto): otra experiencia, otros módulos, otros tipos.
const SYNTH = {
    slug: 'ruta-sintetica',
    title: 'Ruta sintética',
    modules: [
        {
            id: 'mA', title: 'Mirar', nodes: [
                { id: 's1', type: 'VIDEO', title: 'Ver el clip', resourceRef: 'content-clip-y' },
                { id: 's2', type: 'ACTIVITY', title: 'Una pregunta', config: { instruccion: 'di algo', preguntas: [{ texto: 'q1' }] } },
            ],
        },
        {
            id: 'mB', title: 'Crear', nodes: [
                { id: 's3', type: 'PRODUCTION', title: 'Produce', config: { consigna: 'escribe', minPalabras: 10, maxPalabras: 50 } },
                { id: 's4', type: 'ACTIVITY', title: 'Cierre', required: false, config: { instruccion: 'opcional', preguntas: [{ texto: 'q2' }] } },
            ],
        },
    ],
};

function synthDoc() {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: SYNTH.slug, title: SYNTH.title });
    const v = createDraftVersion(doc, exp.id, { objectives: ['obj'], modules: SYNTH.modules }, bookExists);
    publishVersion(doc, v.id);
    return { doc, exp, v };
}

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`); };

// A — runtime no depende del piloto
t('A: el runtime opera una fixture sintética distinta al piloto (cero dependencia estructural)', () => {
    const { doc, exp } = synthDoc();
    const { run } = startRun(doc, { userId: 'u1', experienceId: exp.id });
    completeNode(doc, run.id, 's1');
    submitEvidence(doc, { runId: run.id, nodeId: 's2', userId: 'u1', payload: { answers: ['a'] } });
    const { progress } = submitEvidence(doc, { runId: run.id, nodeId: 's3', userId: 'u1', payload: { text: words(20) } });
    assert.equal(progress.completed, true, 'la ruta sintética completa sin código específico del piloto');
    // Estructural: dominio y rutas sin literales del piloto.
    for (const f of ['lib/experienceStore.js']) {
        const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', f), 'utf8');
        assert.ok(!src.includes('content-1765751139919') && !src.toLowerCase().includes('me desconecto'), `${f} sin hardcodes del piloto`);
    }
    const serverSrc = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js'), 'utf8');
    const block = serverSrc.split('CHP-MOOK-01: EXPERIENCIAS')[1]?.split('END CHP-MOOK-01')[0] ?? '';
    assert.ok(!block.includes('content-1765751139919') && !block.toLowerCase().includes('me desconecto'), 'rutas sin hardcodes del piloto');
});

// B — módulos embebidos
t('B: ExperienceVersion contiene modules[] embebidos con nodes[] ordenados', () => {
    const { v } = synthDoc();
    assert.equal(v.modules.length, 2);
    assert.deepEqual(versionNodes(v).map(n => n.id), ['s1', 's2', 's3', 's4'], 'secuencia global = módulos en orden');
    assert.equal(moduleOfNode(v, 's3').id, 'mB');
    assert.equal(listPublished({ experiences: [], versions: [], runs: [], evidence: [] }).length, 0);
});

// C — inmutabilidad con módulos
t('C: la versión publicada con módulos sigue inmutable; V2 no muta V1 ni mueve runs', () => {
    const { doc, exp, v } = synthDoc();
    const { run } = startRun(doc, { userId: 'u1', experienceId: exp.id });
    const frozen = JSON.stringify(v.modules);
    assert.throws(() => updateDraftVersion(doc, v.id, { modules: SYNTH.modules }, bookExists), (e) => e.code === 'VERSION_IMMUTABLE');
    const v2 = createDraftVersion(doc, exp.id, { modules: SYNTH.modules }, bookExists);
    publishVersion(doc, v2.id);
    assert.equal(run.experienceVersionId, v.id);
    assert.equal(JSON.stringify(v.modules), frozen, 'V1 byte-idéntica');
});

// D — estado de módulo derivado
t('D: moduleState se DERIVA (NOT_STARTED → IN_PROGRESS → COMPLETED) y no se persiste', () => {
    const { doc, exp, v } = synthDoc();
    const { run } = startRun(doc, { userId: 'u1', experienceId: exp.id });
    assert.equal(moduleState(v.modules[0], run), 'NOT_STARTED');
    completeNode(doc, run.id, 's1');
    assert.equal(moduleState(v.modules[0], run), 'IN_PROGRESS');
    submitEvidence(doc, { runId: run.id, nodeId: 's2', userId: 'u1', payload: { answers: ['a'] } });
    assert.equal(moduleState(v.modules[0], run), 'COMPLETED');
    assert.equal(moduleState(v.modules[1], run), 'NOT_STARTED');
    const view = computeRouteView(doc, run, CATALOG);
    assert.deepEqual(view.modules.map(m => m.state), ['COMPLETED', 'NOT_STARTED']);
    assert.ok(!JSON.stringify(doc.runs).includes('IN_PROGRESS'), 'el estado de módulo no se persiste en el run');
});

// E — contenido no-standalone sigue canónico
t('E: standalone:false es una dimensión separada — el contenido sigue canónico y disponible', () => {
    const clip = CATALOG.find(c => c.id === 'content-clip-y');
    assert.equal(clip.status, 'disponible', 'publication state intacto');
    assert.equal(clip.standalone, false);
    const libro = CATALOG.find(c => c.id === 'content-libro-x');
    assert.notEqual(libro.standalone, false, 'ausente ⇒ standalone (default true, cero migración)');
});

// F — no-standalone invisible como obra independiente en Biblioteca
t('F: la vista editorial de Biblioteca oculta standalone:false aunque esté referenciado', () => {
    const lib = emptyLibrary();
    const col = addCollection(lib, { name: 'Sel' });
    updateCollection(lib, col.id, { published: true });
    addReference(lib, { bookId: 'content-libro-x', collectionId: col.id }, (id) => CATALOG.some(c => c.id === id));
    addReference(lib, { bookId: 'content-clip-y', collectionId: col.id }, (id) => CATALOG.some(c => c.id === id));
    const view = computeEditorialView(lib, CATALOG);
    const shown = view.collections[0].references.map(r => r.bookId);
    assert.deepEqual(shown, ['content-libro-x'], 'el clip no-standalone no aparece como obra independiente');
});

// G — pero SÍ puede referenciarse desde una Experience
t('G: una Experience referencia contenido no-standalone y el runtime lo proyecta', () => {
    const { doc, exp } = synthDoc();
    const { run } = startRun(doc, { userId: 'u1', experienceId: exp.id });
    const view = computeRouteView(doc, run, CATALOG);
    const videoNode = view.nodes.find(n => n.id === 's1');
    assert.equal(videoNode.resource.titulo, 'Clip Y', 'el nodo VIDEO proyecta el recurso no-standalone');
});

// H — no duplicación se mantiene
t('H: MOOK no duplica contenido (store sin metadata canónica; catálogo intacto)', () => {
    const frozen = JSON.stringify(CATALOG);
    const { doc } = synthDoc();
    assert.ok(!JSON.stringify(doc).includes('Clip Y'), 'ni un título en el store MOOK');
    assert.equal(JSON.stringify(CATALOG), frozen);
});

// I — descubrimiento desde Biblioteca
t('I: Biblioteca es la entrada a Experiencias (estructural: pestaña en Biblioteca.tsx, sin entrada propia en navbar de usuario)', () => {
    const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
    const biblioteca = fs.readFileSync(path.join(root, 'pages', 'Biblioteca.tsx'), 'utf8');
    assert.ok(biblioteca.includes("'experiencias'") || biblioteca.includes('"experiencias"'), 'Biblioteca tiene la pestaña Experiencias');
    assert.ok(biblioteca.includes('/experiencias/'), 'las cards navegan a la ruta técnica de la Experience');
    const navbar = fs.readFileSync(path.join(root, 'components', 'Navbar.tsx'), 'utf8');
    const userNav = navbar.split('navItemsDesktop')[1]?.split('];')[0] ?? '';
    assert.ok(!userNav.includes("to: '/experiencias'"), 'sin nueva isla en el nav principal (V4)');
});

// J — actor/autorización fuera de MOOK (sin cambios V4)
t('J: telemetría con moduleId opcional valida; autorización sigue fuera de MOOK', () => {
    const ok = validateEvent('node_completed', { experienceId: 'e', experienceVersionId: 'v', runId: 'r', nodeId: 's1', nodeType: 'VIDEO', moduleId: 'mA' });
    assert.ok(ok.ok, 'moduleId opcional aceptado');
    const legacyOk = validateEvent('node_completed', { experienceId: 'e', experienceVersionId: 'v', runId: 'r', nodeId: 's1', nodeType: 'VIDEO' });
    assert.ok(legacyOk.ok, 'sin moduleId sigue validando (compatible)');
    const json = JSON.stringify(computeRouteView(...(() => { const { doc, exp } = synthDoc(); const { run } = startRun(doc, { userId: 'u1', experienceId: exp.id }); return [doc, run, CATALOG]; })()));
    for (const f of ['"allowed"', '"entitled"']) assert.ok(!json.includes(f), `vista sin ${f}`);
});

// compat: store legacy con version.nodes plano se normaliza a un módulo
t('compat: normalizeMookStore envuelve versiones pre-módulos en un módulo único', () => {
    const legacy = { experiences: [], versions: [{ id: 'v1', experienceId: 'e', version: 1, status: 'published', objectives: [], nodes: [{ id: 'n1', type: 'ACTIVITY', title: 'x', required: true, config: { preguntas: [{ texto: 'q' }] } }] }], runs: [], evidence: [] };
    const doc = normalizeMookStore(legacy);
    assert.equal(doc.versions[0].modules.length, 1);
    assert.equal(versionNodes(doc.versions[0])[0].id, 'n1');
});

console.log(`mookV4Realign.test.mjs OK — ${passed} escenarios`);
