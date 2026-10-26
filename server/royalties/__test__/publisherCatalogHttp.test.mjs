/**
 * publisherCatalogHttp.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-C (CATÁLOGOS-02).
 *
 * server.js REAL contra stores y royalties.db TEMPORALES, con editoriales
 * sintéticas (interna con dos sellos, externa, inactiva y una sin libros
 * visibles para el lector):
 *   [1] my-catalog: `catalog` igual que antes (mismo conjunto, mismas claves);
 *       `publishers` aditivo, solo { id, name }, solo activas con libros
 *       visibles para quien consulta (lector, mediador, administración)
 *   [2] sello: válido, ajeno, no-texto, vacío, edición parcial, reasignación
 *       incompatible (rechazada, sin borrar), sello retirado de la lista
 *   [3] identidad: ids únicos, historial solo de reasignaciones reales, sin
 *       efectos en progreso, eventos ni derechos; base real intacta
 *
 *   node server/royalties/__test__/publisherCatalogHttp.test.mjs
 */
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_royalties_f1c_'));
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

// Editoriales sintéticas en la base temporal (antes de arrancar el servidor).
process.env.ROYALTIES_DB = P.royalties;
const S = await import('../publishersStore.mjs');
const CH = 'pub-chibalete-editores';
S.updatePublisher(CH, { imprints: ['Chibalete Editores', 'Estado Sólido'] });
const EXT = S.createPublisher({ kind: 'editorial', legalName: 'Editorial Externa S.A.S. (FX)', tradeName: 'Externa FX', taxId: 'FX-900-1', contactEmail: 'contacto@externa.fx.test', contactPhone: '300', notes: 'nota interna', imprints: ['Ext Uno'] }).id;
const INA = S.createPublisher({ kind: 'editorial', legalName: 'Editorial Inactiva (FX)' }).id;
S.updatePublisher(INA, { status: 'inactive' });
const HID = S.createPublisher({ kind: 'editorial', legalName: 'Editorial Oculta (FX)' }).id;
S.closeRoyaltiesDb();

const item = (id, tipo, publisherId, extra = {}) => ({
    id, titulo: `T ${id}`, autor: 'Autora', tipo, editorial: 'Chibalete', etiquetas: ['x'], status: 'disponible',
    descripcion_corta: 'd', portada_url: '', ...(publisherId ? { publisherId } : {}), ...extra,
});
const SEED = [
    item('b-ch-1', 'libro', CH), item('b-ch-2', 'libro', CH), item('a-ch-1', 'libro_album', CH),
    item('b-ext-1', 'libro', EXT), item('b-ext-2', 'libro', EXT),
    item('b-ina-1', 'libro', INA), item('b-hid-1', 'libro', HID),
    item('b-restr', 'libro', CH), item('g-ch-1', 'guia', CH), item('v-ch-1', 'video', CH),
];
fs.writeFileSync(P.content, JSON.stringify(SEED, null, 2));
const LEC_IDS = ['b-ch-1', 'b-ch-2', 'a-ch-1', 'b-ext-1', 'b-ext-2', 'b-ina-1', 'g-ch-1', 'v-ch-1'];
const MED_IDS = ['b-ext-1', 'g-ch-1'];
// La guía es material pedagógico: un lector no la recibe aunque su regla la nombre
// (regla vigente desde CHP-ACCESS-PEDAGOGY-01D-B, ajena a F1-C).
const LEC_VISIBLE = LEC_IDS.filter((id) => id !== 'g-ch-1').sort();
fs.writeFileSync(P.access, JSON.stringify([
    { id: 'r-lec', scope: 'user', scopeId: 'LEC', titleIds: LEC_IDS, collectionIds: [], expiresAt: null },
    { id: 'r-med', scope: 'user', scopeId: 'MED', titleIds: MED_IDS, collectionIds: [], expiresAt: null },
    // Administración ve en my-catalog lo que su regla explícita nombra (sin bypass por rol, LIBRARY-VISIBILITY-01).
    { id: 'r-adm', scope: 'user', scopeId: 'ADM', titleIds: SEED.map((c) => c.id), collectionIds: [], expiresAt: null },
], null, 2));
for (const f of ['groups', 'schools']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');

const PORT = 6100 + (process.pid % 100);
const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT),
        CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: path.join(tmp, 'groups.json'), SCHOOLS_DB: path.join(tmp, 'schools.json'),
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, USER_AUDIT_DB: P.audit,
        ROYALTIES_DB: P.royalties, SESSION_AUTH_MODE: 'off', ACCESS_FALLBACK_MODE: 'restricted',
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
const all = () => JSON.parse(fs.readFileSync(P.content, 'utf8'));
const rec = (id) => all().find((c) => c.id === id);
const without = (o, k) => { const { [k]: _drop, ...rest } = o; return rest; };
const save = async (body) => { const r = await call('POST', '/api/content', 'ADM', body); await sleep(2100); return r; };
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
    econRows: countRows(path.join(P.data, 'events.db'), 'econ_events'),
    rights: countRows(P.royalties, 'rights_versions'),
});
const catalogOf = async (uid) => (await call('GET', '/api/content/my-catalog', uid)).body;
const ids = (body) => (body?.catalog || []).map((c) => c.id).sort();

try {
    let healthy = false;
    for (let i = 0; i < 150 && !healthy; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* arrancando */ }
        if (!healthy) await sleep(400);
    }
    if (!healthy) throw new Error(`nunca healthy\n${boot.slice(-2000)}`);
    const before = sideEffects();

    console.log('\n[1] my-catalog: catálogo intacto + publishers aditivo');
    const lec = await catalogOf('LEC');
    ok('lector: catalog = exactamente su regla (el conjunto no cambia)', JSON.stringify(ids(lec)) === JSON.stringify(LEC_VISIBLE), JSON.stringify(ids(lec)));
    ok('lector: filas con las 5 claves de siempre', lec.catalog.every((c) => JSON.stringify(Object.keys(c).sort()) === JSON.stringify(['collectionId', 'coverImage', 'id', 'title', 'type'])));
    ok('lector: success y catalog siguen ahí (contrato LU)', lec.success === true && Array.isArray(lec.catalog));
    ok('lector: publishers = Chibalete + Externa (ni inactiva ni sin libros visibles)',
        JSON.stringify(lec.publishers) === JSON.stringify([{ id: CH, name: 'Chibalete Editores' }, { id: EXT, name: 'Externa FX' }]), JSON.stringify(lec.publishers));
    ok('lector: solo id y name (sin NIT, contacto, notas, sellos ni estado)', lec.publishers.every((p) => JSON.stringify(Object.keys(p).sort()) === '["id","name"]'));
    ok('lector: ni el NIT ni el contacto aparecen en la respuesta', !/FX-900-1|contacto@externa|nota interna/.test(JSON.stringify(lec)));
    ok('lector: la obra restringida no aparece', !ids(lec).includes('b-restr'));
    ok('lector: el libro de la editorial inactiva sigue en catalog (el estado no decide acceso)', ids(lec).includes('b-ina-1'));
    const med = await catalogOf('MED');
    ok('mediador: catalog incluye su regla', MED_IDS.every((id) => ids(med).includes(id)));
    const medBookPubs = new Set(SEED.filter((c) => ids(med).includes(c.id) && ['libro', 'libro_album'].includes(c.tipo)).map((c) => c.publisherId));
    ok('mediador: publishers ⊆ editoriales activas de SUS libros visibles',
        med.publishers.every((p) => medBookPubs.has(p.id) && p.id !== INA) && med.publishers.some((p) => p.id === EXT), JSON.stringify(med.publishers));
    const adm = await catalogOf('ADM');
    ok('administración: Chibalete, Externa y la Oculta (que el lector no ve); nunca la inactiva',
        JSON.stringify(adm.publishers.map((p) => p.id).sort()) === JSON.stringify([CH, EXT, HID].sort()), JSON.stringify(adm.publishers));
    const medHasChBook = SEED.some((c) => ids(med).includes(c.id) && c.publisherId === CH && ['libro', 'libro_album'].includes(c.tipo));
    ok('una guía no basta para nombrar a su editorial (solo cuentan libros)', medHasChBook || !med.publishers.some((p) => p.id === CH), JSON.stringify(med.publishers));
    ok('sin sesión: 401 y sin datos', (await call('GET', '/api/content/my-catalog', null)).status === 401);

    console.log('\n[2] sello (imprint)');
    let r = await save({ ...rec('b-ch-1'), imprint: 'Estado Sólido' });
    ok('sello válido de la editorial → 200 y guardado', r.status === 200 && rec('b-ch-1').imprint === 'Estado Sólido', JSON.stringify(r.body));
    r = await save({ ...rec('b-ch-2'), imprint: 'Ext Uno' });
    ok('sello de OTRA editorial → 400 imprint_invalid, sin escritura', r.status === 400 && r.body?.code === 'imprint_invalid' && !('imprint' in rec('b-ch-2')));
    r = await save({ ...rec('b-ch-2'), imprint: 42 });
    ok('sello no-texto → 400 imprint_invalid', r.status === 400 && r.body?.code === 'imprint_invalid');
    r = await save({ ...rec('b-ch-2'), imprint: 'Sello Inventado' });
    ok('sello no registrado → 400', r.status === 400 && r.body?.code === 'imprint_invalid');
    r = await save({ ...without(rec('b-ch-1'), 'imprint'), titulo: 'Título editado' });
    ok('edición parcial sin imprint → conserva el sello', r.status === 200 && rec('b-ch-1').imprint === 'Estado Sólido' && rec('b-ch-1').titulo === 'Título editado');
    r = await save({ ...rec('b-ch-2'), imprint: '' });
    ok('imprint vacío en obra sin sello → 200, sigue sin sello', r.status === 200 && !('imprint' in rec('b-ch-2')));
    r = await save({ ...rec('b-ch-1'), publisherId: EXT, publisherReassignConfirmed: true });
    ok('reasignar con un sello que no es de la nueva editorial → 400, sin borrar ni reasignar',
        r.status === 400 && r.body?.code === 'imprint_invalid' && rec('b-ch-1').publisherId === CH && rec('b-ch-1').imprint === 'Estado Sólido', JSON.stringify(r.body));
    ok('…y sin fila de historial', countRows(P.royalties, 'content_publisher_history') === 0);
    r = await save({ ...rec('b-ch-1'), publisherId: EXT, publisherReassignConfirmed: true, imprint: 'Ext Uno' });
    ok('reasignar eligiendo un sello de la nueva editorial → 200', r.status === 200 && rec('b-ch-1').publisherId === EXT && rec('b-ch-1').imprint === 'Ext Uno', JSON.stringify(r.body));
    ok('…historial: exactamente una fila (la reasignación real)', countRows(P.royalties, 'content_publisher_history') === 1);
    r = await save({ ...rec('b-ch-1'), imprint: '' });
    ok('quitar el sello expresamente (\'\') → 200, sin sello', r.status === 200 && !('imprint' in rec('b-ch-1')));
    r = await save({ ...rec('a-ch-1'), imprint: 'Chibalete Editores' });
    ok('libro-álbum con sello válido → 200', r.status === 200 && rec('a-ch-1').imprint === 'Chibalete Editores');
    const pr = await call('PUT', `/api/admin/publishers/${CH}`, 'ADM', { imprints: ['Estado Sólido'] });
    ok('la editorial retira «Chibalete Editores» de su lista', pr.status === 200);
    r = await save({ ...rec('a-ch-1'), titulo: 'Álbum editado' });
    ok('editar otros metadatos de una obra con ese sello → 200 y lo conserva (no se borra en silencio)',
        r.status === 200 && rec('a-ch-1').imprint === 'Chibalete Editores' && rec('a-ch-1').titulo === 'Álbum editado', JSON.stringify(r.body));
    r = await save({ ...rec('b-ch-2'), imprint: 'Chibalete Editores' });
    ok('…pero asignarlo de nuevo a otra obra → 400', r.status === 400 && r.body?.code === 'imprint_invalid');
    r = await call('POST', '/api/content', 'LEC', { ...rec('b-ch-2'), imprint: 'Estado Sólido' });
    ok('lector no puede fijar sellos (401/403) y no cambia nada', [401, 403].includes(r.status) && !('imprint' in rec('b-ch-2')));

    console.log('\n[3] identidad y efectos');
    const list = all();
    ok('ids únicos: ninguna ficha duplicada', new Set(list.map((c) => c.id)).size === list.length && list.length === SEED.length);
    ok('progreso, eventos, econ_events, derechos y reglas de acceso sin cambios', JSON.stringify(sideEffects()) === JSON.stringify(before), JSON.stringify({ before, after: sideEffects() }));
    const lecAfter = await catalogOf('LEC');
    ok('my-catalog del lector: mismo conjunto tras editar sellos', JSON.stringify(ids(lecAfter)) === JSON.stringify(LEC_VISIBLE));
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

ok('la base real data-critical/royalties.db no se creó', fs.existsSync(REAL_DB) === realBefore);
console.log(`\npublisherCatalogHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
