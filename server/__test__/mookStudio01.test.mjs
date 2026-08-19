/**
 * mookStudio01.test.mjs — CHP-MOOK-STUDIO-01.
 * Cubre SOLO el comportamiento nuevo de autoría (updateExperience, archive,
 * vistas admin) + los invariantes que el Studio ejerce sobre el dominio
 * existente (inmutabilidad, nueva versión, pin de runs, referencias canónicas,
 * reordenamiento persistido). Runtime y evidencia ya están cubiertos por
 * experienceStore/mookV4Realign/mookRuntime01.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    emptyMookStore, createExperience, updateExperience, archiveExperience,
    createDraftVersion, updateDraftVersion, publishVersion,
    adminListExperiences, adminExperienceDetail,
    startRun, completeNode, listPublished, computeRouteView, versionNodes,
} from '../lib/experienceStore.js';

const CATALOG = [
    { id: 'content-a', titulo: 'Libro A', autor: 'x', tipo: 'libro', status: 'disponible', portada_url: '/a.jpg' },
    { id: 'content-v', titulo: 'Clip V', autor: 'y', tipo: 'video', status: 'disponible', standalone: false },
];
const bookExists = (id) => CATALOG.some(c => c.id === id);

const SIX_NODES = [
    { id: 'n1', type: 'READING', title: 'Leer', resourceRef: 'content-a' },
    { id: 'n2', type: 'VIDEO', title: 'Ver', resourceRef: 'content-v', config: { transcripcion: 'alt' } },
    { id: 'n3', type: 'AUDIO', title: 'Escuchar', resourceRef: 'content-v' },
    { id: 'n4', type: 'LEO', title: 'Conversar', config: { objetivo: 'o', semilla: 's', minIntercambios: 2 } },
    { id: 'n5', type: 'ACTIVITY', title: 'Actividad', config: { preguntas: [{ texto: 'p1', tipo: 'text_short' }] } },
    { id: 'n6', type: 'PRODUCTION', title: 'Producir', config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 5, maxPalabras: 50 } },
];

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`); };

// 1/2 — creación de borrador + edición de información general
t('crea Experiencia y edita información general (título/desc/imagen/duración/audiencia)', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'st', title: 'Original', description: 'd' });
    assert.equal(exp.status, 'draft');
    const upd = updateExperience(doc, exp.id, { title: 'Editada', imageUrl: '/i.jpg', durationLabel: '2 sesiones', audience: 'Docentes' });
    assert.equal(upd.title, 'Editada');
    assert.equal(upd.imageUrl, '/i.jpg');
    assert.equal(upd.audience, 'Docentes');
    // limpiar un campo opcional lo elimina (ausente, no cadena vacía)
    updateExperience(doc, exp.id, { imageUrl: '' });
    assert.ok(!('imageUrl' in doc.experiences[0]));
    // validación: título vacío rechazado
    assert.throws(() => updateExperience(doc, exp.id, { title: '  ' }), (e) => e.code === 'INVALID_TITLE');
});

// 3/4 — módulos + los seis tipos en una versión borrador
t('borrador con módulos y los SEIS tipos de nodo válidos', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'six', title: 'Seis' });
    const v = createDraftVersion(doc, exp.id, {
        objectives: ['obj'],
        modules: [
            { id: 'm1', title: 'Uno', nodes: SIX_NODES.slice(0, 3) },
            { id: 'm2', title: 'Dos', nodes: SIX_NODES.slice(3) },
        ],
    }, bookExists);
    assert.equal(versionNodes(v).length, 6);
    assert.deepEqual(versionNodes(v).map(n => n.type), ['READING', 'VIDEO', 'AUDIO', 'LEO', 'ACTIVITY', 'PRODUCTION']);
    // el default de LEO/PRODUCTION se normaliza en el dominio
    assert.equal(versionNodes(v)[3].config.minIntercambios, 2);
    assert.equal(versionNodes(v)[5].config.minPalabras, 5);
});

// 5 — referencia canónica sin duplicación
t('el nodo guarda SOLO resourceRef — sin copiar metadata canónica', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'ref', title: 'Ref' });
    const v = createDraftVersion(doc, exp.id, { modules: [{ id: 'm1', title: 'M', nodes: [SIX_NODES[0]] }] }, bookExists);
    const n = versionNodes(v)[0];
    assert.equal(n.resourceRef, 'content-a');
    assert.ok(!('titulo' in n) && !('portada_url' in n) && !('autor' in n), 'cero metadata copiada');
    // referencia inexistente rechazada
    assert.throws(() => createDraftVersion(doc, exp.id, { modules: [{ id: 'mx', title: 'X', nodes: [{ id: 'nx', type: 'READING', title: 'x', resourceRef: 'content-nope' }] }] }, bookExists),
        (e) => e.code === 'RESOURCE_NOT_FOUND');
});

// 6 — reordenamiento (↑/↓ del Studio) se persiste como orden de la versión
t('reordenar módulos/nodos persiste el nuevo orden en el borrador', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'ord', title: 'Orden' });
    const v = createDraftVersion(doc, exp.id, {
        modules: [
            { id: 'm1', title: 'A', nodes: [SIX_NODES[0], { ...SIX_NODES[4], id: 'n5b' }] },
            { id: 'm2', title: 'B', nodes: [SIX_NODES[3]] },
        ],
    }, bookExists);
    // swap módulos + swap nodos del primero (lo que hacen los botones ↑/↓)
    const reordered = [
        { id: 'm2', title: 'B', nodes: [SIX_NODES[3]] },
        { id: 'm1', title: 'A', nodes: [{ ...SIX_NODES[4], id: 'n5b' }, SIX_NODES[0]] },
    ];
    const v2 = updateDraftVersion(doc, v.id, { modules: reordered }, bookExists);
    assert.deepEqual(v2.modules.map(m => m.id), ['m2', 'm1']);
    assert.deepEqual(versionNodes(v2).map(n => n.id), ['n4', 'n5b', 'n1']);
});

// 7 — validaciones del dominio por tipo
t('validaciones: LEO sin objetivo, ACTIVITY sin preguntas, PRODUCTION sin consigna, media sin ref', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'val', title: 'Val' });
    const mk = (node) => () => createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [node] }] }, bookExists);
    assert.throws(mk({ id: 'a', type: 'LEO', title: 'l', config: {} }), (e) => e.code === 'INVALID_NODE');
    assert.throws(mk({ id: 'b', type: 'ACTIVITY', title: 'a', config: { preguntas: [] } }), (e) => e.code === 'INVALID_NODE');
    assert.throws(mk({ id: 'c', type: 'PRODUCTION', title: 'p', config: {} }), (e) => e.code === 'INVALID_NODE');
    assert.throws(mk({ id: 'd', type: 'READING', title: 'r' }), (e) => e.code === 'INVALID_NODE');
    assert.throws(mk({ id: 'e', type: 'XXX', title: 'x' }), (e) => e.code === 'INVALID_NODE_TYPE');
});

// 8 — publicada inmutable
t('una versión publicada es INMUTABLE (editarla exige versión nueva)', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'imm', title: 'Inmutable' });
    const v = createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [SIX_NODES[0]] }] }, bookExists);
    publishVersion(doc, v.id);
    assert.throws(() => updateDraftVersion(doc, v.id, { modules: [] }, bookExists), (e) => e.code === 'VERSION_IMMUTABLE');
    assert.throws(() => publishVersion(doc, v.id), (e) => e.code === 'VERSION_IMMUTABLE');
    // la información general de la Experiencia sí es editable (decisión §17 documentada)
    updateExperience(doc, exp.id, { description: 'nueva desc' });
    assert.equal(doc.experiences[0].description, 'nueva desc');
});

// 9 — nueva versión desde publicada + pin de runs
t('nueva versión desde publicada: v2 draft copiada; el run existente conserva v1', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'pin', title: 'Pin' });
    const v1 = createDraftVersion(doc, exp.id, { objectives: ['o1'], modules: [{ id: 'm', title: 'M', nodes: [SIX_NODES[0]] }] }, bookExists);
    publishVersion(doc, v1.id);
    const { run } = startRun(doc, { userId: 'u1', experienceId: exp.id });
    // lo que hace el Studio: copia profunda de la publicada → nueva draft
    const copy = JSON.parse(JSON.stringify({ objectives: v1.objectives, modules: v1.modules }));
    copy.modules[0].nodes.push({ ...SIX_NODES[4], id: 'n-extra' });
    const v2 = createDraftVersion(doc, exp.id, copy, bookExists);
    assert.equal(v2.version, 2);
    assert.equal(v2.status, 'draft');
    publishVersion(doc, v2.id);
    assert.equal(doc.experiences[0].currentVersionId, v2.id, 'los nuevos entran a v2');
    assert.equal(run.experienceVersionId, v1.id, 'el run en curso conserva su versión fijada');
    const view = computeRouteView(doc, run, CATALOG);
    assert.equal(view.nodes.length, 1, 'la ruta del run sigue siendo la v1 (1 nodo)');
});

// 10 — archivo NO destructivo
t('archivar: no descubrible ni iniciable; runs/versiones/evidencia INTACTOS y el run activo termina', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'arch', title: 'Archivable' });
    const v = createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [SIX_NODES[0]] }] }, bookExists);
    publishVersion(doc, v.id);
    const { run } = startRun(doc, { userId: 'u1', experienceId: exp.id });
    const versionsBefore = doc.versions.length;
    archiveExperience(doc, exp.id);
    assert.equal(doc.experiences[0].status, 'archived');
    assert.equal(doc.versions.length, versionsBefore, 'ninguna versión borrada');
    assert.equal(listPublished(doc).length, 0, 'ya no se descubre');
    assert.throws(() => startRun(doc, { userId: 'u2', experienceId: exp.id }), (e) => e.code === 'NOT_PUBLISHED');
    // el participante en curso termina su recorrido
    const out = completeNode(doc, run.id, 'n1');
    assert.equal(out.run.status, 'completed');
    // y la archivada no se edita ni re-publica
    assert.throws(() => updateExperience(doc, exp.id, { title: 'x' }), (e) => e.code === 'EXPERIENCE_ARCHIVED');
    assert.throws(() => createDraftVersion(doc, exp.id, { modules: [{ id: 'm2', title: 'M2', nodes: [SIX_NODES[0]] }] }, bookExists), (e) => e.code === 'EXPERIENCE_ARCHIVED');
    assert.throws(() => archiveExperience(doc, exp.id), (e) => e.code === 'ALREADY_ARCHIVED');
});

// vistas de autoría
t('adminList/adminDetail: estados, versiones y draft actual — sin crear runs ni mutar nada', () => {
    const doc = emptyMookStore();
    const e1 = createExperience(doc, { slug: 'l1', title: 'Solo borrador' });
    createDraftVersion(doc, e1.id, { modules: [{ id: 'm', title: 'M', nodes: [SIX_NODES[0]] }] }, bookExists);
    const e2 = createExperience(doc, { slug: 'l2', title: 'Publicada' });
    const v2 = createDraftVersion(doc, e2.id, { modules: [{ id: 'm', title: 'M', nodes: [SIX_NODES[0]] }] }, bookExists);
    publishVersion(doc, v2.id);
    const list = adminListExperiences(doc);
    assert.equal(list.length, 2);
    const l1 = list.find(x => x.id === e1.id);
    const l2 = list.find(x => x.id === e2.id);
    assert.equal(l1.status, 'draft');
    assert.ok(l1.draftVersionId);
    assert.equal(l1.publishedVersion, null);
    assert.equal(l2.status, 'published');
    assert.equal(l2.publishedVersion, 1);
    assert.equal(l2.draftVersionId, null);
    const det = adminExperienceDetail(doc, e2.id);
    assert.equal(det.versions.length, 1);
    assert.equal(det.versions[0].status, 'published');
    assert.ok(Array.isArray(det.versions[0].modules[0].nodes));
    assert.equal(doc.runs.length, 0, 'las lecturas de autoría no crean runs (preview sin inscripción productiva)');
    assert.throws(() => adminExperienceDetail(doc, 'nope'), (e) => e.code === 'EXPERIENCE_NOT_FOUND');
});

// 12/13 — estructural: bundles legacy intactos + guards de aislamiento en las rutas
const serverSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'server.js'), 'utf8');

t('estructural: bundles legacy intactos (rutas /api/bundles presentes, sin tocar)', () => {
    assert.ok(serverSrc.includes(`'/api/bundles'`), 'las rutas legacy de bundles siguen registradas');
});

t('estructural: lecturas de autoría exigen rol administrador y las mutaciones el mecanismo admin canónico', () => {
    assert.ok(serverSrc.includes(`app.get('/api/experiences/admin/list', requireUserAuth`), 'listado de autoría por sesión');
    assert.ok(serverSrc.includes('function isAdminSession'), 'guard de rol explícito');
    assert.ok(serverSrc.includes(`app.put('/api/experiences/:id', requireAdminAccess`), 'edición de info por admin canónico');
    assert.ok(serverSrc.includes(`app.post('/api/experiences/:id/archive', requireAdminAccess`), 'archivo por admin canónico');
    const adminListPos = serverSrc.indexOf(`app.get('/api/experiences/admin/list'`);
    const userDetailPos = serverSrc.indexOf(`app.get('/api/experiences/:id'`);
    assert.ok(adminListPos !== -1 && userDetailPos !== -1 && adminListPos < userDetailPos,
        'las rutas admin se registran ANTES de /:id (Express no debe capturar admin como experienceId)');
});

t('estructural: C13 — el DELETE de contenido bloquea referencias de Experiencias publicadas', () => {
    assert.ok(serverSrc.includes('siendo utilizado en una Experiencia publicada'), 'guard C13 presente en el DELETE');
});

console.log(`\nmookStudio01: ${passed} tests OK`);
