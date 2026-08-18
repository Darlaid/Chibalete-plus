/**
 * experienceStore.test.mjs — CHP-MOOK-01. Casos obligatorios A–M de la unidad.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    NODE_TYPES, emptyMookStore, normalizeMookStore,
    createExperience, createDraftVersion, updateDraftVersion, publishVersion,
    startRun, completeNode, submitEvidence, reviewEvidence, runProgress,
    listPublished, computeRouteView, attachLeoEvidenceRefs,
} from '../lib/experienceStore.js';
import { validateEvent, getMeta } from '../analytics/eventRegistry.js';

const CATALOG = [
    { id: 'content-1765751139919', titulo: 'Me desconecto, luego existo', autor: 'Latitud Cero', tipo: 'libro', status: 'disponible', portada_url: '/uploads/x.jpg' },
];
const bookExists = (id) => CATALOG.some(c => c.id === id);
const frozenCatalog = JSON.stringify(CATALOG);

const PILOT_NODES = [
    { id: 'n1-leer', type: 'READING', title: 'Leer: existencia vs. aparición', resourceRef: 'content-1765751139919' },
    { id: 'n2-leo', type: 'LEO', title: 'Conversar con Leo', resourceRef: 'content-1765751139919', config: { objetivo: 'comprensión + conexión personal', semilla: '¿Qué significa desconectarse para existir?', minIntercambios: 3 } },
    { id: 'n3-actividad', type: 'ACTIVITY', title: 'Las tres tensiones', config: { instruccion: 'Responde con tus palabras', preguntas: [{ texto: 'p1' }, { texto: 'p2' }, { texto: 'p3' }] } },
    { id: 'n4-produccion', type: 'PRODUCTION', title: 'Tu posición', config: { consigna: '¿Somos lo que mostramos?', criterioRevision: 'posición + 2 razones + 1 referencia', minPalabras: 150, maxPalabras: 300 } },
    { id: 'n5-cierre', type: 'ACTIVITY', title: 'Cierre', required: false, config: { instruccion: 'Reflexiona', preguntas: [{ texto: '¿Qué cambió?' }] } },
];

function pilotDoc() {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'me-desconecto', title: 'Me desconecto, luego existo', description: 'Ruta piloto' });
    const v1 = createDraftVersion(doc, exp.id, { objectives: ['posición argumentada sobre la hiperconexión'], nodes: PILOT_NODES }, bookExists);
    publishVersion(doc, v1.id);
    return { doc, exp, v1 };
}

const words = (n) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ');
let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`); };

// A — versión fija: run iniciado en V1 permanece V1 tras publicar V2
t('A: run fijado a V1 sobrevive a la publicación de V2 y V1 no se muta', () => {
    const { doc, exp, v1 } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    const v1NodesFrozen = JSON.stringify(v1.nodes);
    const v2 = createDraftVersion(doc, exp.id, { objectives: ['otro'], nodes: PILOT_NODES }, bookExists);
    publishVersion(doc, v2.id);
    assert.equal(run.experienceVersionId, v1.id, 'el run sigue en V1');
    assert.equal(exp.currentVersionId, v2.id, 'la Experiencia apunta a V2 para runs nuevos');
    assert.equal(JSON.stringify(v1.nodes), v1NodesFrozen, 'V1 publicada no se mutó');
    assert.throws(() => updateDraftVersion(doc, v1.id, { objectives: [] }), (e) => e.code === 'VERSION_IMMUTABLE');
});

// B — contenido canónico: referencia sin duplicación
t('B: READING referencia el libro canónico sin duplicarlo (catálogo intacto, nodo solo guarda el id)', () => {
    const { doc, exp } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    const view = computeRouteView(doc, run, CATALOG);
    assert.equal(view.nodes[0].resource.titulo, 'Me desconecto, luego existo', 'metadata proyectada en el join');
    const stored = JSON.stringify(doc);
    assert.ok(!stored.includes('"titulo"'), 'el store MOOK no persiste metadata canónica');
    assert.equal(JSON.stringify(CATALOG), frozenCatalog, 'catálogo byte-idéntico');
    assert.throws(() => createDraftVersion(doc, exp.id, { nodes: [{ type: 'READING', title: 'x', resourceRef: 'content-NOPE' }] }, bookExists), (e) => e.code === 'RESOURCE_NOT_FOUND');
});

// C — entitlement: el dominio MOOK no conoce el access engine
t('C: el dominio no emite campos de autorización ni toca access engine (estructural)', () => {
    const { doc, exp } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    const json = JSON.stringify(computeRouteView(doc, run, CATALOG));
    for (const f of ['"allowed"', '"entitled"', '"entitlement"']) assert.ok(!json.includes(f), `sin ${f}`);
    const raw = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'experienceStore.js'), 'utf8');
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const f of ['access_db', 'ACCESS_DB', 'readJSON', 'writeJSON', 'fs.', 'x-user-id']) {
        assert.ok(!code.includes(f), `dominio puro sin ${f}`);
    }
});

// D — progreso derivado de requeridos
t('D: progreso = requeridos completados / requeridos (el opcional no cuenta)', () => {
    const { doc, exp } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    assert.deepEqual(runProgress(doc, run), { completedRequired: 0, totalRequired: 4, completed: false });
    completeNode(doc, run.id, 'n1-leer');
    assert.equal(runProgress(doc, run).completedRequired, 1);
});

// E — progreso del libro ≠ completitud del nodo READING
t('E: completar el nodo READING es marca explícita, independiente del progreso del libro', () => {
    const { doc, exp } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    // No existe en el dominio ningún acoplamiento al progress engine: completar es explícito.
    const { progress } = completeNode(doc, run.id, 'n1-leer');
    assert.equal(progress.completedRequired, 1);
    const raw = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'experienceStore.js'), 'utf8');
    assert.ok(!raw.includes('progress_db') && !raw.includes('canonicalProgress'), 'sin sincronización con el progreso de lectura');
});

// F — Leo: ≥3 intercambios; evidencia Leo referenciada, no copiada
t('F: nodo LEO exige ≥3 intercambios (server-contados) y referencia leo_evidence por id', () => {
    const { doc, exp } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    completeNode(doc, run.id, 'n1-leer');
    assert.throws(() => completeNode(doc, run.id, 'n2-leo', { leoInterchanges: 2 }), (e) => e.code === 'LEO_MIN_INTERCHANGES');
    attachLeoEvidenceRefs(doc, run.id, 'n2-leo', ['ev_leo_123']);
    completeNode(doc, run.id, 'n2-leo', { leoInterchanges: 3 });
    assert.deepEqual(run.nodeStates['n2-leo'].evidenceIds, ['ev_leo_123'], 'referencia por id');
    assert.equal(doc.evidence.length, 0, 'la conversación NO se copia a ExperienceEvidence');
});

// G — Activity: tres respuestas conservadas
t('G: ACTIVITY exige las 3 respuestas y las conserva', () => {
    const { doc, exp } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    completeNode(doc, run.id, 'n1-leer');
    completeNode(doc, run.id, 'n2-leo', { leoInterchanges: 3 });
    assert.throws(() => submitEvidence(doc, { runId: run.id, nodeId: 'n3-actividad', userId: 'user-a', payload: { answers: ['a', ''] } }), (e) => e.code === 'ACTIVITY_INCOMPLETE');
    const { evidence } = submitEvidence(doc, { runId: run.id, nodeId: 'n3-actividad', userId: 'user-a', payload: { answers: ['r1', 'r2', 'r3'] } });
    assert.deepEqual(evidence.payload.answers, ['r1', 'r2', 'r3']);
    assert.equal(evidence.requiresReview, false, 'actividad sin revisión obligatoria');
});

// H — Production: 150–300 palabras → SUBMITTED
t('H: PRODUCTION valida 150–300 palabras y queda SUBMITTED vinculada a usuario+versión+nodo', () => {
    const { doc, exp, v1 } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    completeNode(doc, run.id, 'n1-leer');
    completeNode(doc, run.id, 'n2-leo', { leoInterchanges: 3 });
    submitEvidence(doc, { runId: run.id, nodeId: 'n3-actividad', userId: 'user-a', payload: { answers: ['r1', 'r2', 'r3'] } });
    assert.throws(() => submitEvidence(doc, { runId: run.id, nodeId: 'n4-produccion', userId: 'user-a', payload: { text: words(80) } }), (e) => e.code === 'PRODUCTION_LENGTH');
    const { evidence } = submitEvidence(doc, { runId: run.id, nodeId: 'n4-produccion', userId: 'user-a', payload: { text: words(200) } });
    assert.equal(evidence.review.status, 'SUBMITTED');
    assert.equal(evidence.requiresReview, true);
    assert.equal(evidence.userId, 'user-a');
    assert.equal(evidence.experienceVersionId, v1.id);
    assert.equal(evidence.nodeId, 'n4-produccion');
});

// I — revisión: SUBMITTED → REVIEWED + feedback
t('I: revisión humana SUBMITTED→REVIEWED con decision+feedback trazables; no re-revisable', () => {
    const { doc, exp } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    completeNode(doc, run.id, 'n1-leer');
    completeNode(doc, run.id, 'n2-leo', { leoInterchanges: 3 });
    submitEvidence(doc, { runId: run.id, nodeId: 'n3-actividad', userId: 'user-a', payload: { answers: ['r1', 'r2', 'r3'] } });
    const { evidence } = submitEvidence(doc, { runId: run.id, nodeId: 'n4-produccion', userId: 'user-a', payload: { text: words(160) } });
    const rev = reviewEvidence(doc, evidence.id, { reviewerId: 'user-mediador', decision: 'con_comentarios', feedback: 'Buena posición; falta la referencia al libro.' });
    assert.equal(rev.review.status, 'REVIEWED');
    assert.equal(rev.review.reviewerId, 'user-mediador');
    assert.ok(rev.review.feedback.length > 0);
    assert.throws(() => reviewEvidence(doc, evidence.id, { reviewerId: 'x', decision: 'aprobado' }), (e) => e.code === 'ALREADY_REVIEWED');
});

// J — eventos por el registry/canal canónico
t('J: los 6 eventos MOOK validan contra el eventRegistry canónico (categoría experience)', () => {
    const base = { experienceId: 'e1', experienceVersionId: 'v1', runId: 'r1' };
    const cases = [
        ['experience_started', base],
        ['node_started', { ...base, nodeId: 'n1', nodeType: 'READING' }],
        ['node_completed', { ...base, nodeId: 'n1', nodeType: 'READING' }],
        ['evidence_submitted', { ...base, nodeId: 'n4', nodeType: 'PRODUCTION', evidenceId: 'evid-1', requiresReview: true }],
        ['evidence_reviewed', { experienceId: 'e1', experienceVersionId: 'v1', evidenceId: 'evid-1', decision: 'aprobado' }],
        ['experience_completed', { ...base, requiredNodes: 4 }],
    ];
    for (const [name, payload] of cases) {
        const r = validateEvent(name, payload);
        assert.ok(r.ok, `${name} debe validar: ${JSON.stringify(r)}`);
        assert.equal(r.category, 'experience');
        assert.ok(getMeta(name).pedagogical_weight >= 2, `${name} con peso pedagógico`);
    }
    assert.equal(validateEvent('evidence_submitted', { experienceId: 'e1' }).ok, false, 'payload incompleto rechazado');
});

// K — identidad: actor no fabricable desde cliente
t('K: el actor viene del caller de confianza; evidencia de otro usuario rechazada; rutas usan sesión (estructural)', () => {
    const { doc, exp } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    completeNode(doc, run.id, 'n1-leer');
    completeNode(doc, run.id, 'n2-leo', { leoInterchanges: 3 });
    assert.throws(() => submitEvidence(doc, { runId: run.id, nodeId: 'n3-actividad', userId: 'user-IMPOSTOR', payload: { answers: ['a', 'b', 'c'] } }), (e) => e.code === 'NOT_RUN_OWNER');
    // Estructural: el bloque de rutas MOOK deriva actor de req.user y jamás de body/query.
    const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'server.js'), 'utf8');
    const block = src.split('CHP-MOOK-01: EXPERIENCIAS')[1]?.split('END CHP-MOOK-01')[0] ?? '';
    assert.ok(block.length > 100, 'bloque MOOK presente');
    assert.ok(!/req\.(body|query|params)\??\.\s*(userId|reviewerId|organizationId|role)/.test(block), 'identidad jamás del body/query/params');
    assert.ok((block.match(/userId:\s*req\.user\.id|reviewerId:\s*req\.user\.id/g) || []).length >= 3, 'actor derivado de req.user (sesión canónica)');
    assert.ok(!block.includes('x-user-id'), 'sin x-user-id');
    assert.ok((block.match(/requireUserAuth/g) || []).length >= 6, 'rutas de usuario con requireUserAuth (sesión canónica)');
    assert.ok((block.match(/requireAdminAccess/g) || []).length >= 4, 'rutas editoriales con admin canónico');
});

// L — publicación: draft no expuesto
t('L: un draft no aparece publicado ni permite runs', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'draft-exp', title: 'Draft' });
    createDraftVersion(doc, exp.id, { nodes: PILOT_NODES }, bookExists);
    assert.equal(listPublished(doc).length, 0);
    assert.throws(() => startRun(doc, { userId: 'user-a', experienceId: exp.id }), (e) => e.code === 'NOT_PUBLISHED');
});

// M — cierre: completed derivado
t('M: completar los 4 requeridos ⇒ Experience completed (el cierre opcional no bloquea)', () => {
    const { doc, exp } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    completeNode(doc, run.id, 'n1-leer');
    completeNode(doc, run.id, 'n2-leo', { leoInterchanges: 5 });
    submitEvidence(doc, { runId: run.id, nodeId: 'n3-actividad', userId: 'user-a', payload: { answers: ['r1', 'r2', 'r3'] } });
    const { run: r2, progress } = submitEvidence(doc, { runId: run.id, nodeId: 'n4-produccion', userId: 'user-a', payload: { text: words(180) } });
    assert.equal(progress.completed, true);
    assert.equal(r2.status, 'completed');
    assert.ok(r2.completedAt, 'timestamp de cierre');
});

// extras de contrato
t('nodos bloqueados hasta completar requeridos anteriores; run idempotente por usuario', () => {
    const { doc, exp } = pilotDoc();
    const { run } = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    assert.throws(() => completeNode(doc, run.id, 'n2-leo', { leoInterchanges: 9 }), (e) => e.code === 'NODE_LOCKED');
    const again = startRun(doc, { userId: 'user-a', experienceId: exp.id });
    assert.equal(again.created, false);
    assert.equal(again.run.id, run.id);
});

t('tipos de nodo congelados; normalize tolera basura', () => {
    assert.deepEqual([...NODE_TYPES], ['READING', 'VIDEO', 'AUDIO', 'LEO', 'ACTIVITY', 'PRODUCTION']);
    assert.deepEqual(normalizeMookStore(null), emptyMookStore());
});

console.log(`experienceStore.test.mjs OK — ${passed} escenarios`);
