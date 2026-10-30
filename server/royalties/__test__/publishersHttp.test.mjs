/**
 * publishersHttp.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-A.
 *
 * server.js REAL contra stores, uploads y royalties.db TEMPORALES:
 *   [1] CRUD administrativo de titulares y rechazo de no autorizados
 *   [2] publisherId en POST /api/content: persiste, se conserva al editar sin
 *       reenviarlo, se valida; F1-B: un libro no se queda sin editorial y el
 *       cambio exige confirmación (detalle en publisherMandatoryHttp.test.mjs)
 *   [3] el lector no recibe datos administrativos del titular
 *   [4] borrado protegido por referencias
 *   [5] accesos, progreso y eventos intactos; auditoría registrada
 *
 *   node server/royalties/__test__/publishersHttp.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REAL_DB = path.join(REPO, 'data-critical', 'royalties.db');
const realBefore = fs.existsSync(REAL_DB);

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_royalties_http_'));
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'),
    access: path.join(tmp, 'access.json'), audit: path.join(tmp, 'user_audit.json'), royalties: path.join(tmp, 'rdb', 'royalties.db'),
    uploads: path.join(tmp, 'uploads'),
};
fs.mkdirSync(P.data, { recursive: true });
fs.mkdirSync(P.uploads, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active' },
    { id: 'MED', email: 'med@fx.test', roles: ['mediador'], accountStatus: 'active' },
    { id: 'LEC', email: 'lec@fx.test', roles: ['lector'], accountStatus: 'active' },
]));
const C1 = { id: 'content-c1', titulo: 'Obra uno', autor: 'Autora', tipo: 'libro', editorial: 'Chibalete', etiquetas: ['x'], status: 'disponible', descripcion_corta: 'd', portada_url: '' };
const C2 = { id: 'content-c2', titulo: 'Obra dos', autor: 'Autor', tipo: 'libro', editorial: 'Chibalete', etiquetas: ['y'], status: 'disponible', descripcion_corta: 'd', portada_url: '' };
fs.writeFileSync(P.content, JSON.stringify([C1, C2], null, 2));
fs.writeFileSync(P.access, JSON.stringify([{ id: 'r-lec', scope: 'user', scopeId: 'LEC', titleIds: ['content-c1', 'content-c2'], collectionIds: [], expiresAt: null }], null, 2));
for (const f of ['groups', 'schools']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');

const PORT = 5800 + (process.pid % 100);
const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT),
        CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: path.join(tmp, 'groups.json'), SCHOOLS_DB: path.join(tmp, 'schools.json'),
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, USER_AUDIT_DB: P.audit,
        ROYALTIES_DB: P.royalties, SESSION_AUTH_MODE: 'off',
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    },
});
let boot = '';
child.stdout.on('data', (d) => { boot += d; });
child.stderr.on('data', (d) => { boot += d; });

const as = (uid) => ({ 'content-type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) });
const call = async (method, url, uid, body) => {
    const r = await fetch(`${base}${url}`, { method, headers: as(uid), body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, body: j };
};
const rec = (id) => JSON.parse(fs.readFileSync(P.content, 'utf8')).find((c) => c.id === id);
const saveContent = async (body) => { const r = await call('POST', '/api/content', 'ADM', body); await sleep(2100); return r; };
const sha = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'absent');
const countRows = (file, table) => {
    if (!fs.existsSync(file)) return 'absent';
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { return db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n; } catch { return 'no-table'; } finally { db.close(); }
};
const sideEffects = () => ({
    access: sha(P.access),
    progressJson: sha(path.join(P.data, 'progress_db.json')),
    progressRows: countRows(path.join(P.data, 'progress.db'), 'progress'),
    eventRows: countRows(path.join(P.data, 'events.db'), 'events'),
});

try {
    let healthy = false;
    for (let i = 0; i < 150 && !healthy; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* arrancando */ }
        if (!healthy) await sleep(400);
    }
    if (!healthy) throw new Error(`nunca healthy\n${boot.slice(-2000)}`);
    ok('arranque en modo test NO crea royalties.db (apertura perezosa)', !fs.existsSync(P.royalties));
    const before = sideEffects();

    console.log('\n[1] CRUD administrativo y autorización');
    ok('sin sesión: GET → 401', (await call('GET', '/api/admin/publishers')).status === 401);
    ok('lector: GET → 403', (await call('GET', '/api/admin/publishers', 'LEC')).status === 403);
    ok('mediador: GET → 403', (await call('GET', '/api/admin/publishers', 'MED')).status === 403);
    ok('lector: POST → rechazado', [401, 403].includes((await call('POST', '/api/admin/publishers', 'LEC', { kind: 'editorial', legalName: 'X' })).status));
    ok('mediador: PUT → rechazado', [401, 403].includes((await call('PUT', '/api/admin/publishers/pub-chibalete-editores', 'MED', { status: 'inactive' })).status));
    ok('lector: DELETE → rechazado', [401, 403].includes((await call('DELETE', '/api/admin/publishers/pub-chibalete-editores', 'LEC')).status));
    let r = await call('GET', '/api/admin/publishers', 'ADM');
    ok('admin: GET lista con Chibalete Editores', r.status === 200 && r.body.some((p) => p.id === 'pub-chibalete-editores'));
    ok('la base se creó en la ruta temporal al primer uso', fs.existsSync(P.royalties));
    r = await call('POST', '/api/admin/publishers', 'ADM', { kind: 'editorial', legalName: 'Editorial Externa S.A.S.', tradeName: 'Externa', taxId: 'NIT-MARKER-900', contactEmail: 'secreto@externa.test', imprints: ['Sello Norte'] });
    const ext = r.body;
    ok('admin: POST → 201 con id del servidor', r.status === 201 && /^pub-/.test(ext.id));
    r = await call('POST', '/api/admin/publishers', 'ADM', { kind: 'editorial', legalName: 'Con banco', bankAccount: '000' });
    ok('admin: campo no admitido → 400', r.status === 400 && r.body.code === 'unknown_field');
    r = await call('PUT', `/api/admin/publishers/${ext.id}`, 'ADM', { tradeName: 'Externa Ediciones', id: 'pub-otro' });
    ok('admin: PUT edita y conserva la identidad', r.status === 200 && r.body.tradeName === 'Externa Ediciones' && r.body.id === ext.id);
    r = await call('GET', `/api/admin/publishers/${ext.id}`, 'ADM');
    ok('admin: GET uno', r.status === 200 && r.body.id === ext.id);
    ok('admin: GET inexistente → 404', (await call('GET', '/api/admin/publishers/pub-nada', 'ADM')).status === 404);
    const ina = (await call('POST', '/api/admin/publishers', 'ADM', { kind: 'tercero', legalName: 'Titular Inactivo' })).body;
    r = await call('PUT', `/api/admin/publishers/${ina.id}`, 'ADM', { status: 'inactive' });
    ok('admin: desactivación', r.status === 200 && r.body.status === 'inactive');

    console.log('\n[2] publisherId en el catálogo');
    r = await saveContent({ ...C1, publisherId: 'pub-chibalete-editores' });
    ok('asignar editorial → persiste', r.status === 200 && rec('content-c1').publisherId === 'pub-chibalete-editores');
    const c1Before = rec('content-c1');
    r = await saveContent({ ...C1, titulo: 'Obra uno (editada)' });
    ok('editar SIN reenviar publisherId → se conserva', r.status === 200 && rec('content-c1').publisherId === 'pub-chibalete-editores' && rec('content-c1').titulo === 'Obra uno (editada)');
    const c1After = rec('content-c1');
    const changed = [...new Set([...Object.keys(c1Before), ...Object.keys(c1After)])]
        .filter((k) => k !== 'titulo' && JSON.stringify(c1Before[k]) !== JSON.stringify(c1After[k]));
    ok('el resto del registro no cambia por la asociación', changed.length === 0, `cambiaron: ${changed.join(',')}`);
    r = await saveContent({ ...C1, publisherId: 'pub-no-existe' });
    ok('editorial inexistente → 400 y sin cambios', r.status === 400 && r.body.code === 'unknown_publisher' && rec('content-c1').publisherId === 'pub-chibalete-editores');
    r = await saveContent({ ...C2, publisherId: ina.id });
    ok('asignar editorial inactiva → 400', r.status === 400 && r.body.code === 'inactive_publisher' && !('publisherId' in rec('content-c2')));
    r = await saveContent({ ...C2 });
    ok('F1-B: libro sin publisherId → 400 publisher_required', r.status === 400 && r.body.code === 'publisher_required' && !('publisherId' in rec('content-c2')));
    r = await saveContent({ ...C2, publisherId: ext.id });
    ok('asignar editorial externa', r.status === 200 && rec('content-c2').publisherId === ext.id);
    r = await call('PUT', `/api/admin/publishers/${ext.id}`, 'ADM', { status: 'inactive' });
    r = await saveContent({ ...rec('content-c2'), titulo: 'Obra dos (editada)' });
    ok('editorial desactivada después: la asociación existente se conserva al editar', r.status === 200 && rec('content-c2').publisherId === ext.id);
    r = await saveContent({ ...rec('content-c1'), publisherId: '' });
    ok('F1-B: quitar ("") a un libro → 400 publisher_removal_forbidden', r.status === 400 && r.body.code === 'publisher_removal_forbidden' && rec('content-c1').publisherId === 'pub-chibalete-editores');
    const alt = (await call('POST', '/api/admin/publishers', 'ADM', { kind: 'editorial', legalName: 'Editorial Alterna' })).body;
    r = await saveContent({ ...rec('content-c1'), publisherId: alt.id });
    ok('F1-B: reasignar sin confirmación → 409', r.status === 409 && r.body.code === 'publisher_reassign_unconfirmed' && rec('content-c1').publisherId === 'pub-chibalete-editores');
    ok('contentId intactos', JSON.parse(fs.readFileSync(P.content, 'utf8')).map((c) => c.id).join(',') === 'content-c1,content-c2');

    console.log('\n[3] el lector no recibe datos administrativos');
    r = await call('GET', '/api/content', 'LEC');
    const txt = JSON.stringify(r.body);
    ok('el lector ve su catálogo', r.status === 200 && txt.includes('content-c1'));
    ok('sin razón social, NIT ni contacto del titular', !txt.includes('Editorial Externa S.A.S.') && !txt.includes('NIT-MARKER-900') && !txt.includes('secreto@externa.test') && !txt.includes('legalName'));

    console.log('\n[4] borrado protegido');
    r = await call('DELETE', `/api/admin/publishers/${ext.id}`, 'ADM');
    ok('referenciado → 409 publisher_referenced', r.status === 409 && r.body.code === 'publisher_referenced');
    r = await call('DELETE', '/api/admin/publishers/pub-chibalete-editores', 'ADM');
    ok('Chibalete Editores → 409 protected_publisher', r.status === 409 && r.body.code === 'protected_publisher');
    r = await call('DELETE', `/api/admin/publishers/${ina.id}`, 'ADM');
    ok('sin referencias → 200', r.status === 200 && (await call('GET', `/api/admin/publishers/${ina.id}`, 'ADM')).status === 404);
    ok('la asociación de C2 sigue intacta', rec('content-c2').publisherId === ext.id);

    console.log('\n[5] efectos laterales');
    const after = sideEffects();
    ok('accesos, progreso y eventos intactos', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    await sleep(500);
    const audit = fs.existsSync(P.audit) ? JSON.parse(fs.readFileSync(P.audit, 'utf8')) : [];
    const actions = audit.map((a) => a.action);
    ok('auditoría de alta, edición y borrado', ['publisher_create', 'publisher_update', 'publisher_delete'].every((a) => actions.includes(a)), actions.join(','));
    ok('la auditoría no copia datos de contacto', !JSON.stringify(audit).includes('secreto@externa.test'));
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

ok('la base real data-critical/royalties.db no se creó', fs.existsSync(REAL_DB) === realBefore);
console.log(`\npublishersHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
