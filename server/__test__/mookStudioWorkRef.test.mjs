/**
 * mookStudioWorkRef.test.mjs — CHP-MOOK-STUDIO-WORKREF-01.
 *
 * Vínculo entre PRODUCTION y obra canónica, con contenido sintético:
 *  [1] regla compartida  [2] store  [3] correspondencia con resolveEvidenceWork
 *  [4] server.js real por HTTP  [5] Studio (estructural)  [6] sin emisión
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/mookStudioWorkRef.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from './helpers/freePort.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_studio_work_'));

const Store = await import('../lib/experienceStore.js');
const U = await import('../../utils/workEligibility.mjs');
const W = await import('../gamification/mookWorks.mjs');

const CATALOG = [
    { id: 'obra-a', titulo: 'Obra A', autor: 'x', tipo: 'libro', status: 'disponible' },
    { id: 'obra-b', titulo: 'Obra B', autor: 'x', tipo: 'libro_album', status: 'disponible' },
    { id: 'obra-v', titulo: 'Obra V', autor: 'x', tipo: 'video', status: 'disponible' },
    { id: 'coleccion', titulo: 'C', tipo: 'libro', status: 'disponible', isCollection: true },
    { id: 'capitulo', titulo: 'Cap', tipo: 'libro', status: 'disponible', parentId: 'coleccion' },
    { id: 'guia', titulo: 'G', tipo: 'guia', status: 'disponible', parentId: 'obra-a' },
    { id: 'podcast', titulo: 'P', tipo: 'podcast', status: 'disponible' },
    { id: 'articulo', titulo: 'Art', tipo: 'articulo_pedagogico', status: 'disponible' },
    { id: 'pieza', titulo: 'Pz', tipo: 'libro', status: 'disponible', standalone: false },
    { id: 'procesando', titulo: 'R', tipo: 'libro', status: 'procesando' },
    { id: 'con-error', titulo: 'E', tipo: 'libro', status: 'error' },
];
const byId = (id) => CATALOG.find((c) => c.id === id);
const bookExists = (id) => !!byId(id);
const blockOf = (id) => U.workBlock(byId(id));
const WORDS = 'una dos tres cuatro cinco seis siete ocho';
const production = (id, resourceRef) => ({ id, type: 'PRODUCTION', title: id, ...(resourceRef !== undefined ? { resourceRef } : {}), config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } });
const reading = (id, resourceRef) => ({ id, type: 'READING', title: id, resourceRef });
const modules = (...nodes) => [{ id: 'm', title: 'M', nodes }];
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const realFiles = ['data/mook_db.json', 'data/content.json'].map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f));
const realBefore = realFiles.map(sha);

let child = null;
try {
    section('[1] regla compartida');
    ok('el motor usa la misma función que Studio', W.workBlock === U.workBlock && W.WORK_TIPOS === U.WORK_TIPOS);
    ok('elegibles: exactamente las obras', CATALOG.filter((c) => U.workBlock(c) === null).map((c) => c.id).join() === 'obra-a,obra-b,obra-v');
    ok('cada motivo tiene su texto', ['work_not_found', 'work_unavailable', 'work_is_collection', 'work_is_part', 'work_not_standalone', 'work_not_classified'].every((k) => typeof U.WORK_BLOCK_LABELS[k] === 'string'));
    ok('el módulo es puro: sin imports', !/^\s*import\s/m.test(fs.readFileSync(path.join(REPO, 'utils', 'workEligibility.mjs'), 'utf8')));

    section('[2] store');
    {
        const doc = Store.emptyMookStore();
        const exp = Store.createExperience(doc, { slug: 's', title: 's' });
        const draft = (...nodes) => Store.createDraftVersion(doc, exp.id, { modules: modules(...nodes) }, bookExists, blockOf);
        const v = draft(reading('r', 'obra-a'), production('p', 'obra-a'));
        ok('selección válida: guarda el contentId', Store.versionNodes(v)[1].resourceRef === 'obra-a');
        for (const [id] of [['coleccion'], ['capitulo'], ['guia'], ['podcast'], ['articulo'], ['pieza'], ['procesando'], ['con-error']]) {
            ok(`no elegible al guardar: ${id}`, throwsCode(() => draft(reading('r', id), production('p', id)), 'WORK_NOT_ELIGIBLE'));
        }
        ok('inexistente: rechazada', throwsCode(() => draft(production('p', 'fantasma')), 'RESOURCE_NOT_FOUND'));
        ok('lectura no elegible sigue admitida: solo se limita la producción', Store.versionNodes(draft(reading('r', 'podcast'), production('p'))).length === 2);
        const compat = Store.createDraftVersion(doc, exp.id, { modules: modules(reading('r', 'podcast'), production('p', 'podcast')) }, bookExists);
        ok('sin regla inyectada el contrato anterior no cambia', Store.versionNodes(compat)[1].resourceRef === 'podcast');
        ok('al publicar se vuelve a comprobar', throwsCode(() => Store.publishVersion(doc, compat.id, { workBlockOf: blockOf }), 'WORK_NOT_ELIGIBLE') && compat.status === 'draft');
        const before = JSON.stringify(doc);
        ok('el rechazo al publicar no cambia nada', throwsCode(() => Store.publishVersion(doc, compat.id, { workBlockOf: blockOf }), 'WORK_NOT_ELIGIBLE') && JSON.stringify(doc) === before);
        ok('con vínculo válido publica', Store.publishVersion(doc, v.id, { workBlockOf: blockOf }).status === 'published');
        ok('una publicada no se edita', throwsCode(() => Store.updateDraftVersion(doc, v.id, { modules: modules(production('p', 'obra-b')) }, bookExists, blockOf), 'VERSION_IMMUTABLE'));
        const next = Store.createDraftVersion(doc, exp.id, { modules: modules(reading('r', 'obra-b'), production('p', 'obra-b')) }, bookExists, blockOf);
        ok('el cambio va a una versión nueva', next.status === 'draft' && next.version > v.version && Store.versionNodes(v)[1].resourceRef === 'obra-a');
        ok('general: publica sin obra', Store.publishVersion(doc, draft(reading('r', 'obra-a'), production('p')).id, { workBlockOf: blockOf }).status === 'published');
    }

    section('[3] correspondencia entre selector y resolveEvidenceWork');
    {
        const selectable = new Set(CATALOG.filter((c) => U.workBlock(c) === null).map((c) => c.id));
        for (const c of CATALOG) {
            const doc = Store.emptyMookStore();
            const exp = Store.createExperience(doc, { slug: 'k', title: 'k' });
            const v = Store.createDraftVersion(doc, exp.id, { modules: modules(reading('r', c.id), production('p', c.id)) }, bookExists);
            Store.publishVersion(doc, v.id);
            const { run } = Store.startRun(doc, { userId: 'u', experienceId: exp.id });
            Store.completeNode(doc, run.id, 'r');
            const block = U.workBlock(c);
            const workAccess = { workRef: c.id, decision: block ? 'denied' : 'allowed', via: block ? block.toUpperCase() : 'SCOPE_TITLE', at: new Date().toISOString() };
            const { evidence } = Store.submitEvidence(doc, { runId: run.id, nodeId: 'p', userId: 'u', payload: { text: WORDS }, workAccess });
            Store.reviewEvidence(doc, evidence.id, { reviewerId: 'm', decision: 'aprobado' });
            const r = W.resolveEvidenceWork(doc, evidence, { workRefOf: Store.productionWorkRef, isWithdrawn: () => false, sinceMs: Date.now() - 60_000 });
            ok(`${c.id}: selector y atribución coinciden`, (r.workRef === c.id) === selectable.has(c.id), JSON.stringify(r));
        }
    }

    section('[4] server.js real');
    {
        const dir = path.join(tmp, 'http'); const data = path.join(dir, 'data'); const sqlite = path.join(dir, 'sqlite');
        fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(path.join(dir, 'uploads')); fs.mkdirSync(sqlite);
        fs.writeFileSync(path.join(data, 'mook_db.json'), JSON.stringify(Store.emptyMookStore()));
        const contentFile = path.join(data, 'content.json');
        fs.writeFileSync(contentFile, JSON.stringify(CATALOG));
        fs.writeFileSync(path.join(data, 'access_db.json'), '[]');
        for (const f of ['progress_db.json', 'groups_db.json', 'schools_db.json', 'school_configs.json', 'leo_evidence_db.json']) fs.writeFileSync(path.join(data, f), '[]');
        const user = (id, roles) => ({ id, email: `${id}@t.test`, nombre_completo: id, roles, accountStatus: 'active', password: 'x' });
        fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([user('u-admin', ['administrador']), user('u-lector', ['lector'])]));
        const db = (n) => path.join(sqlite, n);
        const gam = path.join(dir, 'gam', 'gamification.db');
        const port = await freePort();
        child = spawn(process.execPath, [path.join(REPO, 'server', 'server.js')], {
            env: { ...process.env, NODE_ENV: 'test', SESSION_AUTH_MODE: 'off', ACCESS_FALLBACK_MODE: 'restricted', PORT: String(port), USERS_DB: path.join(dir, 'users.json'), CHP_DATA_DIR: data, UPLOADS_ROOT: path.join(dir, 'uploads'),
                ACCESS_DB: path.join(data, 'access_db.json'), GAMIFICATION_ENABLED: '', XP_EARNING_ENABLED: '', PM_EARNING_ENABLED: '', GAMIFICATION_DB: gam, GAMIFICATION_MOOK_SINCE: '', EXPERIENCE_EVENTS_BACKBONE_ENABLED: '',
                EVENTS_SQLITE_PATH: db('events.db'), ARCHIVE_SQLITE_PATH: db('events.archive.db'), INSIGHTS_SQLITE_PATH: db('insights.db'), PROGRESS_SQLITE_PATH: db('progress.db'), OFFLINE_ASSIGNMENT_DB_PATH: db('offline.db'),
                ROYALTIES_DB: db('royalties.db'), IDENTITY_DB: db('identity.db'), SESSIONS_DB: db('sessions.db'), GROUPS_DB: path.join(data, 'groups_db.json'), SCHOOLS_DB: path.join(data, 'schools_db.json'), LEO_EVIDENCE_DB: path.join(data, 'leo_evidence_db.json') },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let logs = ''; child.stdout.on('data', (d) => { logs += d; }); child.stderr.on('data', (d) => { logs += d; });
        const BASE = `http://127.0.0.1:${port}`;
        for (let i = 0; ; i++) {
            try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* arrancando */ }
            if (i > 120) throw new Error(`no arrancó:\n${logs.slice(-1500)}`);
            await sleep(500);
        }
        const royaltiesAtBoot = fs.existsSync(db('royalties.db')) ? sha(db('royalties.db')) : null;
        const call = async (method, url, u, body) => { const r = await fetch(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', 'x-user-id': u }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
        const stored = () => JSON.parse(fs.readFileSync(path.join(data, 'mook_db.json'), 'utf8'));
        const exp = (await call('POST', '/api/experiences', 'u-admin', { slug: 'studio-obra', title: 'Studio obra' })).body;
        ok('experiencia creada', !!exp?.id, JSON.stringify(exp));
        const draft = await call('POST', `/api/experiences/${exp.id}/versions`, 'u-admin', { modules: modules(reading('r', 'obra-a'), production('p', 'obra-a')) });
        ok('selección válida: 201 y persiste', draft.status === 201 && stored().versions[0].modules[0].nodes[1].resourceRef === 'obra-a', JSON.stringify(draft.body)?.slice(0, 200));
        const createBad = await call('POST', `/api/experiences/${exp.id}/versions`, 'u-admin', { modules: modules(reading('r', 'podcast'), production('p', 'podcast')) });
        ok('crear versión con obra no elegible: 400', createBad.status === 400 && createBad.body?.code === 'WORK_NOT_ELIGIBLE', JSON.stringify(createBad.body)?.slice(0, 160));
        const put = (body, u = 'u-admin') => call('PUT', `/api/experiences/versions/${draft.body.id}`, u, body);
        const missing = await put({ modules: modules(production('p', 'fantasma')) });
        ok('inexistente: 404', missing.status === 404 && missing.body?.code === 'RESOURCE_NOT_FOUND');
        for (const id of ['podcast', 'capitulo', 'coleccion', 'procesando']) {
            const r = await put({ modules: modules(reading('r', id), production('p', id)) });
            ok(`no elegible: 400 (${id})`, r.status === 400 && r.body?.code === 'WORK_NOT_ELIGIBLE', JSON.stringify(r.body));
        }
        const list = await put({ modules: modules(reading('r', 'obra-a'), production('p', ['obra-a', 'obra-b'])) });
        ok('lista de obras: 400', list.status === 400 && list.body?.code === 'INVALID_NODE');
        const object = await put({ modules: modules(reading('r', 'obra-a'), production('p', { id: 'obra-a' })) });
        ok('referencia falsificada como objeto: 400', object.status === 400 && object.body?.code === 'INVALID_NODE');
        const hacked = await put({ modules: modules(reading('r', 'obra-a'), production('p', 'obra-b')) }, 'u-lector');
        ok('un lector no puede editar', hacked.status === 401 || hacked.status === 403, String(hacked.status));
        ok('el borrador no cambió', stored().versions[0].modules[0].nodes[1].resourceRef === 'obra-a');
        const notOffered = await put({ modules: modules(reading('r', 'obra-a'), production('p', 'obra-b')) });
        ok('guardar borrador con obra no ofrecida se admite', notOffered.status === 200);
        const pub1 = await call('POST', `/api/experiences/versions/${draft.body.id}/publish`, 'u-admin');
        ok('pero no publica', pub1.status === 400 && pub1.body?.code === 'WORK_NOT_IN_VERSION', JSON.stringify(pub1.body));
        await put({ modules: modules(production('p', 'obra-a'), reading('r', 'obra-a')) });
        const late = await call('POST', `/api/experiences/versions/${draft.body.id}/publish`, 'u-admin');
        ok('obra ofrecida después de la producción: no publica', late.status === 400 && late.body?.code === 'WORK_NOT_IN_VERSION', JSON.stringify(late.body));
        await put({ modules: modules(reading('r', 'obra-b'), production('p', 'obra-b')) });
        fs.writeFileSync(contentFile, JSON.stringify(CATALOG.map((c) => (c.id === 'obra-b' ? { ...c, status: 'error' } : c))));
        const retired = await call('POST', `/api/experiences/versions/${draft.body.id}/publish`, 'u-admin');
        ok('obra retirada tras guardar: no publica, sin esperar la caché', retired.status === 400 && retired.body?.code === 'WORK_NOT_ELIGIBLE', JSON.stringify(retired.body));
        ok('sigue en borrador', stored().versions[0].status === 'draft');
        fs.writeFileSync(contentFile, JSON.stringify(CATALOG));
        const published = await call('POST', `/api/experiences/versions/${draft.body.id}/publish`, 'u-admin');
        ok('con vínculo válido publica', published.status === 200 && stored().versions[0].status === 'published', JSON.stringify(published.body)?.slice(0, 200));
        const frozen = await put({ modules: modules(reading('r', 'obra-a'), production('p', 'obra-a')) });
        ok('publicada: inmutable', frozen.status === 409 && stored().versions[0].modules[0].nodes[1].resourceRef === 'obra-b');
        const v2 = await call('POST', `/api/experiences/${exp.id}/versions`, 'u-admin', { modules: modules(reading('r', 'obra-a'), production('p')) });
        ok('general: nueva versión sin obra', v2.status === 201 && stored().versions[1].modules[0].nodes[1].resourceRef === null);
        ok('general: publica', (await call('POST', `/api/experiences/versions/${v2.body.id}/publish`, 'u-admin')).status === 200);
        ok('la versión anterior no cambió', stored().versions[0].modules[0].nodes[1].resourceRef === 'obra-b');

        section('[6] sin emisión');
        ok('flags OFF: sin gamification.db', !fs.existsSync(gam));
        ok('regalías sin cambios', (fs.existsSync(db('royalties.db')) ? sha(db('royalties.db')) : null) === royaltiesAtBoot);
        const policy = fs.readFileSync(path.join(REPO, 'server', 'gamification', 'policy.mjs'), 'utf8');
        ok('`mook_review` sin XP por facts: solo por reconocimiento aprobado', /XP_RECOGNITION_ONLY_SOURCES = Object\.freeze\(\['mook_review'\]\)/.test(policy) && /PM_LOCKED_SOURCES = Object\.freeze\(\[[^\]]*'mook_review'/.test(policy));
    }

    section('[5] Studio (estructural)');
    {
        const src = fs.readFileSync(path.join(REPO, 'components', 'studio', 'ExperienceStudio.tsx'), 'utf8');
        ok('usa la regla compartida', /from '\.\.\/\.\.\/utils\/workEligibility\.mjs'/.test(src));
        ok('no duplica la lista de tipos', !/libro_album/.test(src));
        ok('el selector filtra por elegibilidad', /eligibleOnly \? all\.filter\(c => workBlock\(c\) === null\) : all/.test(src));
        ok('solo PRODUCTION usa el filtro', /eligibleOnly=\{modules\[picker\.mi\]\?\.nodes\[picker\.ni\]\?\.type === 'PRODUCTION'\}/.test(src));
        ok('sin lecturas nuevas del catálogo y un solo selector', (src.match(/getContenidos\(/g) ?? []).length === 2 && (src.match(/<ContentPicker/g) ?? []).length === 1);
        ok('se puede quitar: producción sin obra', /node\.resourceRef && !needsResource/.test(src) && /Sin obra: experiencia general/.test(src));
        ok('muestra elegibilidad', /Obra elegible, ofrecida antes en la ruta/.test(src));
        ok('valida antes de guardar', /e\[`\$\{k\}\.resourceRef`\] = issue/.test(src));
        ok('guarda por el contrato existente', /\.\.\.\(n\.resourceRef \? \{ resourceRef: n\.resourceRef \} : \{\}\)/.test(src));
        ok('el error de obra se calcula con la obra actual', /isProduction && workIssue && \(/.test(src) && /\{!isProduction && <ErrMsg k="resourceRef" \/>\}/.test(src));
        ok('Tab no sale del selector', /onKeyDown=\{trapTab\}/.test(src));
        ok('Quitar conserva el foco', /pickerButton\.current\?\.focus\(\)/.test(src));
        ok('un error de paso abre su editor', /setEditingNode\(\{ mi: Number\(firstNode\[1\]\)/.test(src));
        ok('el editor no se abre en una versión publicada', /editingNode\?\.mi === mi && editingNode\?\.ni === ni && !readOnlyRoute/.test(src));
    }

    section('[aislamiento]');
    ok('stores reales intactos', realFiles.map(sha).join() === realBefore.join());
} catch (e) {
    fail++;
    console.error('  ✗ excepción', e);
} finally {
    if (child) { child.kill(); await new Promise((r) => child.on('close', r)); }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`\nmookStudioWorkRef: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
