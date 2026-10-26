/**
 * publisherMandatoryHttp.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-B.
 *
 * server.js REAL contra stores, uploads y royalties.db TEMPORALES, con un
 * catálogo que reproduce el censo de producción (109 fichas con
 * pub-chibalete-editores) más dos libros históricos sin editorial:
 *   [1] permisos de las rutas administrativas nuevas y conteos por editorial
 *   [2] censo de cumplimiento (excepciones identificadas, no modificadas)
 *   [3] alta: libro con editorial válida; rechazo sin editorial, null, '',
 *       inexistente o inactiva; recursos no bibliográficos sin cambios
 *   [4] edición parcial conserva la editorial; quitarla se rechaza
 *   [5] reasignación solo con confirmación expresa; historial y auditoría
 *   [6] regularización de un libro histórico; epub-edition exige editorial
 *   [7] derechos: versiones intactas; reasignar ⇒ PUBLISHER_MISMATCH
 *   [8] el historial protege el borrado de titulares
 *   [9] integridad de las 109 asociaciones y efectos laterales nulos
 *
 *   node server/royalties/__test__/publisherMandatoryHttp.test.mjs
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_royalties_f1b_'));
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

const CH = 'pub-chibalete-editores';
// Censo de producción (F1A_PROD_EVIDENCE §4): 43 libro (10 capítulos hijos),
// 9 libro_album, 23 articulo_pedagogico, 17 podcast, 10 guia, 5 video, 2 contexto_pedagogico.
const CENSUS = [['libro', 33], ['libro-cap', 10], ['libro_album', 9], ['articulo_pedagogico', 23], ['podcast', 17], ['guia', 10], ['video', 5], ['contexto_pedagogico', 2]];
const SEED = [];
for (const [t, n] of CENSUS) {
    for (let i = 0; i < n; i++) {
        const tipo = t === 'libro-cap' ? 'libro' : t;
        SEED.push({
            id: `prod-${t}-${i}`, titulo: `${t} ${i}`, autor: 'Autora', tipo, editorial: 'Chibalete', etiquetas: ['x'],
            status: 'disponible', descripcion_corta: 'd', portada_url: '', publisherId: CH,
            ...(t === 'libro-cap' ? { parentId: 'prod-libro-0', standalone: false } : {}),
        });
    }
}
const LEGACY = { id: 'legacy-sin', titulo: 'Libro histórico sin editorial', autor: 'A', tipo: 'libro', editorial: 'Chibalete', etiquetas: ['x'], status: 'disponible', descripcion_corta: 'd', portada_url: '' };
const LEGACY_EPUB = { ...LEGACY, id: 'legacy-epub', titulo: 'Otro libro histórico' };
fs.writeFileSync(P.content, JSON.stringify([...SEED, LEGACY, LEGACY_EPUB], null, 2));
fs.writeFileSync(P.access, JSON.stringify([{ id: 'r-lec', scope: 'user', scopeId: 'LEC', titleIds: SEED.map((c) => c.id), collectionIds: [], expiresAt: null }], null, 2));
for (const f of ['groups', 'schools']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');

const PORT = 5900 + (process.pid % 100);
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
const all = () => JSON.parse(fs.readFileSync(P.content, 'utf8'));
const rec = (id) => all().find((c) => c.id === id);
const without = (o, k) => { const { [k]: _drop, ...rest } = o; return rest; };
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
const history = (id) => call('GET', `/api/admin/publisher-audit/${id}/history`, 'ADM');

try {
    let healthy = false;
    for (let i = 0; i < 150 && !healthy; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* arrancando */ }
        if (!healthy) await sleep(400);
    }
    if (!healthy) throw new Error(`nunca healthy\n${boot.slice(-2000)}`);
    const before = sideEffects();
    ok('censo sembrado: 109 fichas con Chibalete Editores', all().filter((c) => c.publisherId === CH).length === 109);

    console.log('\n[1] permisos y conteos');
    for (const url of ['/api/admin/publisher-audit', '/api/admin/publisher-audit/prod-libro-0/history', '/api/admin/publishers?withCounts=1']) {
        ok(`sin sesión ${url} → 401`, (await call('GET', url)).status === 401);
        ok(`lector ${url} → 403`, (await call('GET', url, 'LEC')).status === 403);
        ok(`mediador ${url} → 403`, (await call('GET', url, 'MED')).status === 403);
    }
    let r = await call('GET', '/api/admin/publishers?withCounts=1', 'ADM');
    const chRow = r.body.find((p) => p.id === CH);
    ok('withCounts: 52 libros y 109 contenidos de Chibalete Editores', r.status === 200 && chRow.bookCount === 52 && chRow.contentCount === 109, JSON.stringify(chRow));
    r = await call('GET', '/api/admin/publishers', 'ADM');
    ok('sin withCounts la respuesta es la de F1-A', r.status === 200 && !('bookCount' in r.body[0]) && !('contentCount' in r.body[0]));
    ok('respuestas administrativas no-store', (await fetch(`${base}/api/admin/publisher-audit`, { headers: as('ADM') })).headers.get('cache-control') === 'no-store');

    console.log('\n[2] censo de cumplimiento');
    r = await call('GET', '/api/admin/publisher-audit', 'ADM');
    ok('54 libros, 52 con editorial válida, 57 recursos', r.status === 200 && r.body.books === 54 && r.body.booksWithPublisher === 52 && r.body.nonBooks === 57, JSON.stringify({ ...r.body, missing: r.body.missing.length }));
    ok('excepciones históricas identificadas', r.body.missing.map((m) => m.id).sort().join() === 'legacy-epub,legacy-sin' && r.body.unknown.length === 0);
    ok('el censo no modifica las excepciones', JSON.stringify(rec('legacy-sin')) === JSON.stringify(LEGACY));
    ok('el administrador sigue consultando el libro histórico', (await call('GET', '/api/content', 'ADM')).body.some((c) => c.id === 'legacy-sin'));

    console.log('\n[3] alta');
    const ext = (await call('POST', '/api/admin/publishers', 'ADM', { kind: 'editorial', legalName: 'Editorial Externa S.A.S.', tradeName: 'Externa', imprints: ['Sello Norte'] })).body;
    const off = (await call('POST', '/api/admin/publishers', 'ADM', { kind: 'editorial', legalName: 'Editorial Retirada' })).body;
    await call('PUT', `/api/admin/publishers/${off.id}`, 'ADM', { status: 'inactive' });
    const nuevo = (id, extra = {}) => ({ id, titulo: `Nuevo ${id}`, autor: 'A', tipo: 'libro', editorial: 'Chibalete', etiquetas: ['n'], descripcion_corta: 'd', portada_url: '', ...extra });
    r = await saveContent(nuevo('n-ok', { publisherId: ext.id }));
    ok('libro nuevo con editorial válida → 200', r.status === 200 && rec('n-ok').publisherId === ext.id);
    r = await saveContent(nuevo('n-sin'));
    ok('libro nuevo sin editorial → 400 publisher_required y no se guarda', r.status === 400 && r.body.code === 'publisher_required' && !rec('n-sin'));
    r = await saveContent(nuevo('n-null', { publisherId: null }));
    ok('libro nuevo con publisherId=null → 400', r.status === 400 && r.body.code === 'publisher_required' && !rec('n-null'));
    r = await saveContent(nuevo('n-vacio', { publisherId: '' }));
    ok('libro nuevo con publisherId="" → 400', r.status === 400 && r.body.code === 'publisher_required' && !rec('n-vacio'));
    r = await saveContent(nuevo('n-album', { tipo: 'libro_album' }));
    ok('libro-álbum nuevo sin editorial → 400', r.status === 400 && r.body.code === 'publisher_required' && !rec('n-album'));
    r = await saveContent(nuevo('n-fantasma', { publisherId: 'pub-no-existe' }));
    ok('editorial inexistente → 400 unknown_publisher', r.status === 400 && r.body.code === 'unknown_publisher' && !rec('n-fantasma'));
    r = await saveContent(nuevo('n-inactiva', { publisherId: off.id }));
    ok('editorial inactiva → 400 inactive_publisher', r.status === 400 && r.body.code === 'inactive_publisher' && !rec('n-inactiva'));
    r = await saveContent(nuevo('n-guia', { tipo: 'guia' }));
    ok('guía nueva sin editorial → 200 (recursos sin cambios)', r.status === 200 && rec('n-guia') && !('publisherId' in rec('n-guia')));
    r = await saveContent(nuevo('n-video', { tipo: 'video', publisherId: CH }));
    ok('vídeo nuevo con editorial → 200', r.status === 200 && rec('n-video').publisherId === CH);
    r = await history('n-ok');
    ok('el alta queda en el historial (sin editorial → nueva)', r.status === 200 && r.body.history.length === 1 && r.body.history[0].from === null && r.body.history[0].to === ext.id && r.body.history[0].actor === 'ADM');

    console.log('\n[4] edición parcial');
    const p0 = rec('prod-libro-1');
    r = await saveContent({ ...without(p0, 'publisherId'), titulo: 'Título corregido' });
    ok('editar sin reenviar publisherId conserva la editorial', r.status === 200 && rec('prod-libro-1').publisherId === CH && rec('prod-libro-1').titulo === 'Título corregido');
    ok('conservar no genera historial', (await history('prod-libro-1')).body.history.length === 0);
    r = await saveContent({ ...rec('prod-libro-1'), publisherId: null });
    ok('quitar (null) → 400 publisher_removal_forbidden', r.status === 400 && r.body.code === 'publisher_removal_forbidden' && rec('prod-libro-1').publisherId === CH);
    r = await saveContent({ ...rec('prod-libro-1'), publisherId: '' });
    ok('quitar ("") → 400 publisher_removal_forbidden', r.status === 400 && r.body.code === 'publisher_removal_forbidden' && rec('prod-libro-1').publisherId === CH);
    r = await saveContent({ ...rec('prod-libro_album-0'), tipo: 'guia', publisherId: null });
    ok('cambiar a guía para quitarla → 400', r.status === 400 && rec('prod-libro_album-0').publisherId === CH && rec('prod-libro_album-0').tipo === 'libro_album');
    r = await saveContent({ ...rec('prod-guia-0'), titulo: 'Guía editada' });
    ok('recurso editado conserva su editorial', r.status === 200 && rec('prod-guia-0').publisherId === CH);

    console.log('\n[5] reasignación');
    r = await saveContent({ ...rec('prod-libro-2'), publisherId: ext.id });
    ok('sin confirmación → 409 y sin cambios', r.status === 409 && r.body.code === 'publisher_reassign_unconfirmed' && rec('prod-libro-2').publisherId === CH);
    r = await saveContent({ ...rec('prod-libro-2'), publisherId: ext.id, publisherReassignConfirmed: 'true' });
    ok('confirmación no booleana → 409', r.status === 409 && rec('prod-libro-2').publisherId === CH);
    // (la versión de derechos se registra en [7] antes de reasignar prod-libro-3)
    r = await saveContent({ ...rec('prod-libro-2'), publisherId: ext.id, publisherReassignConfirmed: true });
    ok('con confirmación → 200', r.status === 200 && rec('prod-libro-2').publisherId === ext.id);
    ok('la confirmación no se persiste', !('publisherReassignConfirmed' in rec('prod-libro-2')));
    r = await history('prod-libro-2');
    const h = r.body.history;
    ok('historial: obra, actor, anterior, nueva y fecha', h.length === 1 && h[0].contentId === 'prod-libro-2' && h[0].actor === 'ADM' && h[0].from === CH && h[0].to === ext.id && !Number.isNaN(Date.parse(h[0].changedAt)));
    await sleep(500);
    const audit = fs.existsSync(P.audit) ? JSON.parse(fs.readFileSync(P.audit, 'utf8')) : [];
    const a = audit.find((e) => e.action === 'content_publisher_change' && e.details?.contentId === 'prod-libro-2');
    ok('auditoría content_publisher_change con anterior, nueva, actor y fecha', !!a && a.actor === 'ADM' && a.details.from === CH && a.details.to === ext.id && a.details.changedAt && a.details.historyId === h[0].id && a.timestamp);
    ok('los rechazos no dejan historial', (await history('n-sin')).status === 404 && (await history('n-fantasma')).status === 404);

    console.log('\n[6] excepciones históricas');
    r = await saveContent({ ...LEGACY, titulo: 'Editado sin asignar' });
    ok('editar un libro histórico sin asignar editorial → 400 y se conserva intacto', r.status === 400 && r.body.code === 'publisher_required' && JSON.stringify(rec('legacy-sin')) === JSON.stringify(LEGACY));
    r = await call('POST', '/api/content/legacy-epub/epub-edition', 'ADM', { epub_url: '/uploads/legacy-epub/a.epub' });
    ok('añadir EPUB a un libro sin editorial → 400 publisher_required', r.status === 400 && r.body.code === 'publisher_required' && JSON.stringify(rec('legacy-epub')) === JSON.stringify(LEGACY_EPUB));
    r = await saveContent({ ...LEGACY, publisherId: CH });
    ok('regularizar (asignar) no exige confirmación', r.status === 200 && rec('legacy-sin').publisherId === CH);
    ok('la regularización queda en el historial', (await history('legacy-sin')).body.history[0]?.from === null);
    r = await call('GET', '/api/admin/publisher-audit', 'ADM');
    ok('el censo refleja la regularización', r.body.missing.map((m) => m.id).join() === 'legacy-epub');

    console.log('\n[7] derechos y elegibilidad');
    const shares = (pid) => [{ publisherId: pid, shareBp: 10000 }];
    const ALL = Object.fromEntries(['subscription_reading', 'tts', 'ai_leo', 'offline', 'indexing', 'promo_fragments', 'cover_metadata'].map((c) => [c, true]));
    r = await call('POST', '/api/admin/rights/prod-libro-3/versions', 'ADM', {
        publisherId: CH, actRef: 'ACTA-F1B-01', actSignedOn: '2026-01-01', validFrom: '2026-01-01', validUntil: null,
        effectiveAt: '2026-01-01T05:00:00.000Z', legalStatus: 'active', economicStatus: 'active', settlementClass: 'liquidable',
        alpha: 0.5, expectedMinutes: 90, shares: shares(CH), permissions: ALL,
    });
    ok('versión de derechos registrada', r.status === 201, JSON.stringify(r.body));
    const rightsBefore = JSON.stringify((await call('GET', '/api/admin/rights/prod-libro-3', 'ADM')).body.versions);
    r = await call('GET', '/api/admin/rights/prod-libro-3/eligibility', 'ADM');
    ok('elegible con la editorial de la versión', r.body.eligible === true, JSON.stringify(r.body.reasons));
    r = await saveContent({ ...rec('prod-libro-3'), publisherId: ext.id, publisherReassignConfirmed: true });
    ok('reasignar la obra', r.status === 200 && rec('prod-libro-3').publisherId === ext.id);
    r = await call('GET', '/api/admin/rights/prod-libro-3/eligibility', 'ADM');
    ok('reasignación ≠ versión vigente ⇒ PUBLISHER_MISMATCH y no elegible', r.body.eligible === false && r.body.reasons.includes('PUBLISHER_MISMATCH'), JSON.stringify(r.body.reasons));
    const rightsAfter = (await call('GET', '/api/admin/rights/prod-libro-3', 'ADM')).body;
    ok('versiones de derechos inmutables (idénticas tras la reasignación)', JSON.stringify(rightsAfter.versions) === rightsBefore);
    ok('la versión sigue a nombre de la editorial original (sin traslado retroactivo)', rightsAfter.versions.every((v) => v.publisherId === CH && v.shares.every((s) => s.publisherId === CH)));
    ok('ninguna versión nueva por reasignar', countRows(P.royalties, 'rights_versions') === 1);

    console.log('\n[8] borrado de titulares');
    const tmpPub = (await call('POST', '/api/admin/publishers', 'ADM', { kind: 'tercero', legalName: 'Titular de paso' })).body;
    r = await saveContent({ ...rec('n-guia'), publisherId: tmpPub.id });
    r = await saveContent({ ...rec('n-guia'), publisherId: '' });
    ok('recurso: asignar y retirar editorial sigue permitido', r.status === 200 && !('publisherId' in rec('n-guia')));
    r = await call('DELETE', `/api/admin/publishers/${tmpPub.id}`, 'ADM');
    ok('un titular con historial no se borra (409)', r.status === 409 && r.body.code === 'publisher_referenced');
    ok('el titular sigue registrado', (await call('GET', `/api/admin/publishers/${tmpPub.id}`, 'ADM')).status === 200);

    console.log('\n[9] integridad del catálogo existente');
    const touched = new Set(['prod-libro-1', 'prod-libro-2', 'prod-libro-3', 'prod-guia-0']);
    const now = all();
    const untouched = SEED.filter((c) => !touched.has(c.id));
    ok('las 105 fichas no editadas son idénticas byte a byte al censo', untouched.every((c) => JSON.stringify(now.find((x) => x.id === c.id)) === JSON.stringify(c)));
    ok('las fichas editadas sin reasignar conservan Chibalete Editores', ['prod-libro-1', 'prod-guia-0'].every((id) => rec(id).publisherId === CH));
    ok('solo las reasignaciones confirmadas cambiaron de editorial', SEED.filter((c) => rec(c.id).publisherId !== CH).map((c) => c.id).sort().join() === 'prod-libro-2,prod-libro-3');
    ok('ninguna ficha del censo desapareció', SEED.every((c) => !!rec(c.id)));
    const after = sideEffects();
    ok('accesos, progreso y eventos intactos', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    const lecCat = JSON.stringify((await call('GET', '/api/content', 'LEC')).body);
    ok('el lector no recibe datos del titular', !lecCat.includes('Editorial Externa S.A.S.') && !lecCat.includes('legalName') && !lecCat.includes('Sello Norte'));
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

ok('la base real data-critical/royalties.db no se creó', fs.existsSync(REAL_DB) === realBefore);
console.log(`\npublisherMandatoryHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
