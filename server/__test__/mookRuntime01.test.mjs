/**
 * mookRuntime01.test.mjs — CHP-MOOK-RUNTIME-01. Solo comportamiento nuevo
 * (los casos F–O del gate ya están cubiertos por experienceStore/mookV4Realign).
 */
import assert from 'node:assert';
import {
    emptyMookStore, createExperience, createDraftVersion, publishVersion,
    startRun, completeNode, submitEvidence, listPublishedFor, experienceDetail,
    computeRouteView,
} from '../lib/experienceStore.js';

const CATALOG = [{ id: 'content-a', titulo: 'A', autor: 'x', tipo: 'libro', status: 'disponible' }];
const bookExists = (id) => CATALOG.some(c => c.id === id);
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

function fixture() {
    const doc = emptyMookStore();
    const exp = createExperience(doc, {
        slug: 'rt', title: 'Runtime Test', description: 'd',
        imageUrl: '/img/x.jpg', durationLabel: '2 sesiones', audience: 'Secundaria',
    });
    const v = createDraftVersion(doc, exp.id, {
        objectives: ['objetivo demo'],
        modules: [
            { id: 'mA', title: 'Uno', nodes: [{ id: 'n1', type: 'READING', title: 'Leer', resourceRef: 'content-a' }] },
            { id: 'mB', title: 'Dos', nodes: [{ id: 'n2', type: 'PRODUCTION', title: 'Producir', config: { consigna: 'c', minPalabras: 5, maxPalabras: 40 } }] },
        ],
    }, bookExists);
    publishVersion(doc, v.id);
    return { doc, exp, v };
}

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`); };

t('A/B: listado publicado incluye campos V4 (imageUrl/duración/audiencia/nodeTypes/hasProduction) y myRun=null sin run', () => {
    const { doc } = fixture();
    const [e] = listPublishedFor(doc, 'user-1');
    assert.equal(e.imageUrl, '/img/x.jpg');
    assert.equal(e.durationLabel, '2 sesiones');
    assert.equal(e.audience, 'Secundaria');
    assert.deepEqual(e.nodeTypes, ['READING', 'PRODUCTION']);
    assert.equal(e.hasProduction, true);
    assert.equal(e.myRun, null);
});

t('C: con run activo, myRun trae status/progress/moduleStates (CTA Continuar ruta)', () => {
    const { doc, exp } = fixture();
    const { run } = startRun(doc, { userId: 'user-1', experienceId: exp.id });
    completeNode(doc, run.id, 'n1');
    const [e] = listPublishedFor(doc, 'user-1');
    assert.equal(e.myRun.status, 'active');
    assert.deepEqual(e.myRun.progress, { completedRequired: 1, totalRequired: 2, completed: false });
    assert.deepEqual(e.myRun.moduleStates.map(m => m.state), ['COMPLETED', 'NOT_STARTED']);
    // otro usuario no ve el run ajeno
    assert.equal(listPublishedFor(doc, 'user-2')[0].myRun, null);
});

t('landing: experienceDetail comunica todo SIN crear run (0 runs tras leerla)', () => {
    const { doc, exp } = fixture();
    const d = experienceDetail(doc, exp.id, 'user-1');
    assert.equal(d.title, 'Runtime Test');
    assert.deepEqual(d.objectives, ['objetivo demo']);
    assert.equal(d.modules.length, 2);
    assert.equal(d.hasProduction, true);
    assert.equal(d.myRun, null);
    assert.equal(doc.runs.length, 0, 'la landing no inicia nada');
    assert.throws(() => experienceDetail(doc, 'exp-nope', 'user-1'), (e) => e.code === 'NOT_PUBLISHED');
});

t('D: reanudación — el nodo current de la vista es el primer requerido incompleto (derivado)', () => {
    const { doc, exp } = fixture();
    const { run } = startRun(doc, { userId: 'user-1', experienceId: exp.id });
    let view = computeRouteView(doc, run, CATALOG);
    assert.equal(view.nodes.find(n => n.state === 'current').id, 'n1');
    completeNode(doc, run.id, 'n1');
    view = computeRouteView(doc, run, CATALOG);
    assert.equal(view.nodes.find(n => n.state === 'current').id, 'n2', 'tras volver otro día, el punto correcto se deriva sin persistencia extra');
});

t('M: al completar todo, el listado refleja completed y el detalle conserva myRun', () => {
    const { doc, exp } = fixture();
    const { run } = startRun(doc, { userId: 'user-1', experienceId: exp.id });
    completeNode(doc, run.id, 'n1');
    submitEvidence(doc, { runId: run.id, nodeId: 'n2', userId: 'user-1', payload: { text: words(10) } });
    assert.equal(listPublishedFor(doc, 'user-1')[0].myRun.status, 'completed');
    assert.equal(experienceDetail(doc, exp.id, 'user-1').myRun.progress.completed, true);
});

console.log(`mookRuntime01.test.mjs OK — ${passed} escenarios`);
