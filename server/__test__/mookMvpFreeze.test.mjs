/**
 * mookMvpFreeze.test.mjs — CHP-MOOK-MVP-SCOPE-FREEZE-01 (ADR §18).
 * Cubre SOLO lo congelado en esta unidad: el gate técnico de transcripción en
 * publish (draft sigue guardando incompleto), los dos avisos de interfaz (F1
 * en Studio, M4 en Runtime) y el comportamiento M4 de ACTIVITY (evidencia
 * técnica requiresReview:false, fuera de Producciones). El resto del dominio
 * ya está cubierto por las suites previas de test:mook.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    emptyMookStore, createExperience, createDraftVersion, updateDraftVersion,
    publishVersion, startRun, submitEvidence, reviewListView,
} from '../lib/experienceStore.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG = [
    { id: 'content-a', titulo: 'Libro A', autor: 'x', tipo: 'libro', status: 'disponible' },
    { id: 'content-v', titulo: 'Clip V', autor: 'y', tipo: 'video', status: 'disponible', standalone: false },
];
const bookExists = (id) => CATALOG.some(c => c.id === id);

const mediaDraft = (doc, exp, type, config) => createDraftVersion(doc, exp.id, {
    modules: [{
        id: 'm1', title: 'Módulo medios', nodes: [
            { id: 'n1', type, title: `Nodo ${type}`, resourceRef: 'content-v', ...(config !== undefined ? { config } : {}) },
        ],
    }],
}, bookExists);

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`); };

// 1 — publish AUDIO sin transcripción → rechazo estable, store intacto
t('publicar AUDIO sin transcripción: TRANSCRIPTION_REQUIRED identifica módulo y nodo; nada muta', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'g-audio', title: 'Gate audio' });
    const v = mediaDraft(doc, exp, 'AUDIO');
    const before = JSON.stringify(doc);
    assert.throws(() => publishVersion(doc, v.id), (e) =>
        e.code === 'TRANSCRIPTION_REQUIRED' && e.message.includes('m1') && e.message.includes('n1') && e.message.includes('AUDIO'));
    assert.equal(doc.versions[0].status, 'draft', 'la versión sigue en borrador');
    assert.equal(JSON.stringify(doc), before, 'el store queda byte-idéntico tras el rechazo');
});

// 2 — publish VIDEO sin transcripción → mismo gate
t('publicar VIDEO sin transcripción (incluida cadena vacía): TRANSCRIPTION_REQUIRED', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'g-video', title: 'Gate video' });
    const v = mediaDraft(doc, exp, 'VIDEO', { transcripcion: '   ' });
    assert.throws(() => publishVersion(doc, v.id), (e) => e.code === 'TRANSCRIPTION_REQUIRED');
});

// 3 — con transcripción, ambos publican
t('AUDIO y VIDEO con transcripción no vacía publican normalmente', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'g-ok', title: 'Gate ok' });
    const v = createDraftVersion(doc, exp.id, {
        modules: [{
            id: 'm1', title: 'M', nodes: [
                { id: 'a1', type: 'AUDIO', title: 'Oír', resourceRef: 'content-v', config: { transcripcion: 'texto alternativo del audio' } },
                { id: 'v1', type: 'VIDEO', title: 'Ver', resourceRef: 'content-v', config: { transcripcion: 'texto alternativo del video' } },
            ],
        }],
    }, bookExists);
    assert.equal(publishVersion(doc, v.id).status, 'published');
});

// 4 — el borrador SÍ puede guardarse incompleto (el gate vive solo en publish)
t('draft sin transcripción se crea y se re-guarda; los otros 4 tipos publican sin transcripción', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'g-draft', title: 'Gate draft' });
    const v = mediaDraft(doc, exp, 'AUDIO');
    assert.equal(v.status, 'draft');
    const v2 = updateDraftVersion(doc, v.id, {
        modules: [{ id: 'm1', title: 'Módulo medios', nodes: [{ id: 'n1', type: 'AUDIO', title: 'Aún sin transcripción', resourceRef: 'content-v' }] }],
    }, bookExists);
    assert.equal(v2.status, 'draft', 'guardado incompleto permitido');
    // READING/LEO/ACTIVITY/PRODUCTION no se ven afectados por el gate
    const exp2 = createExperience(doc, { slug: 'g-otros', title: 'Otros tipos' });
    const v3 = createDraftVersion(doc, exp2.id, {
        modules: [{
            id: 'm1', title: 'M', nodes: [
                { id: 'r1', type: 'READING', title: 'Leer', resourceRef: 'content-a' },
                { id: 'l1', type: 'LEO', title: 'Conversar', config: { objetivo: 'o' } },
                { id: 'q1', type: 'ACTIVITY', title: 'Preguntar', config: { preguntas: [{ texto: 'p' }] } },
                { id: 'p1', type: 'PRODUCTION', title: 'Producir', config: { consigna: 'c' } },
            ],
        }],
    }, bookExists);
    assert.equal(publishVersion(doc, v3.id).status, 'published');
});

// 5/6 — avisos de interfaz F1 y M4 presentes y accesibles
t('aviso F1 (Información general no versionada) presente en el Studio, ligado por aria-describedby', () => {
    const src = readFileSync(join(ROOT, 'components', 'studio', 'ExperienceStudio.tsx'), 'utf8');
    assert.ok(src.includes('Los cambios de esta sección se aplican inmediatamente a la experiencia, incluida la versión publicada.'), 'texto del aviso');
    assert.ok(src.includes('La ruta, los módulos y los nodos sí pertenecen al borrador de versión.'), 'texto del aviso (2a frase)');
    assert.ok(src.includes('id="st-info-scope-note"') && src.includes('aria-describedby="st-info-scope-note"'), 'relación semántica con la sección');
});

t('nota M4 (la reflexión se guarda, no va a revisión) presente junto al envío de ACTIVITY', () => {
    const src = readFileSync(join(ROOT, 'pages', 'Experiencias.tsx'), 'utf8');
    assert.ok(src.includes('Si respondes, tu reflexión se guardará como parte de tu recorrido. No se enviará a revisión.'), 'texto de la nota');
    assert.ok(src.includes('act-${node.id}-note'), 'nota ligada al botón por aria-describedby');
});

// 7 — M4: la actividad respondida es registro técnico, jamás entra a Producciones
t('ACTIVITY respondida: evidencia requiresReview:false y ausente de reviewListView', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'g-act', title: 'Actividad M4' });
    const v = createDraftVersion(doc, exp.id, {
        modules: [{ id: 'm1', title: 'M', nodes: [{ id: 'q1', type: 'ACTIVITY', title: 'Reflexión', config: { preguntas: [{ texto: 'p' }] } }] }],
    }, bookExists);
    publishVersion(doc, v.id);
    const { run } = startRun(doc, { userId: 'u1', experienceId: exp.id });
    const { evidence, run: after } = submitEvidence(doc, { runId: run.id, nodeId: 'q1', userId: 'u1', payload: { answers: ['mi reflexión'] } });
    assert.equal(evidence.requiresReview, false);
    assert.equal(after.status, 'completed', 'el run completa sin PRODUCTION');
    assert.equal(reviewListView(doc).length, 0, 'Producciones vacía: la actividad no crea circuito de revisión');
});

console.log(`\nmookMvpFreeze: ${passed} tests OK`);
