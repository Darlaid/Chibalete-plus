/**
 * rightsHttp.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F2-A.
 *
 * server.js REAL contra stores, uploads y bases TEMPORALES, en varios modos de
 * RIGHTS_ENFORCEMENT_MODE sobre el mismo fixture:
 *   [1] off sin derechos = línea base de lo que ven lector, mediador y admin
 *   [2] enforce sin derechos → respuestas idénticas a la línea base
 *   [3] registro de versiones: solo administración; validación en HTTP
 *   [4] enforce con derechos → denegación por capacidad en cada punto
 *   [5] obras sin régimen intactas; datos contractuales invisibles
 *   [6] shadow y off con derechos → idénticos a la línea base
 *   [7] accesos, catálogo, progreso y eventos intactos
 *
 *   node server/royalties/__test__/rightsHttp.test.mjs
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
const sha = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'absent');
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_rights_http_'));
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'),
    access: path.join(tmp, 'access.json'), audit: path.join(tmp, 'user_audit.json'), royalties: path.join(tmp, 'rdb', 'royalties.db'),
    uploads: path.join(tmp, 'uploads'), offline: path.join(tmp, 'offline.db'),
};
fs.mkdirSync(P.data, { recursive: true });
for (const f of ['c1/libro.pdf', 'c2/libro.pdf', 'c3/libro.pdf', 'c3/libro.txt', 'audio/content-c3/chunk_000.mp3', 'c1/portada.jpg', 'c4/portada.jpg', 'c4/libro.pdf', 'c5/libro.pdf']) {
    fs.mkdirSync(path.dirname(path.join(P.uploads, f)), { recursive: true });
    fs.writeFileSync(path.join(P.uploads, f), f.endsWith('.txt') ? 'Había una vez. Fin.' : 'x');
}
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active', nombre_completo: 'Adm' },
    { id: 'MED', email: 'med@fx.test', roles: ['mediador'], accountStatus: 'active', nombre_completo: 'Med' },
    { id: 'LEC', email: 'lec@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'Lec' },
]));
const PUB = 'pub-chibalete-editores';
const mk = (n, extra = {}) => ({
    id: `content-c${n}`, titulo: `Obra ${n}`, autor: 'Autora', tipo: 'libro', editorial: 'Chibalete', etiquetas: ['x'],
    status: 'disponible', descripcion_corta: 'd', publisherId: PUB, url_recurso: `/uploads/c${n}/libro.pdf`, ...extra,
});
const CONTENT = [
    mk(1, { portada_url: '/uploads/c1/portada.jpg' }),
    mk(2),
    mk(3, { texto_plano_url: '/uploads/c3/libro.txt', ttsStatus: 'listo' }),
    mk(4, { portada_url: '/uploads/c4/portada.jpg' }),
    mk(5),
];
fs.writeFileSync(P.content, JSON.stringify(CONTENT, null, 2));
const IDS = CONTENT.map((c) => c.id);
fs.writeFileSync(P.access, JSON.stringify([{ id: 'r-lec', scope: 'user', scopeId: 'LEC', titleIds: IDS, collectionIds: [], expiresAt: null }], null, 2));
for (const f of ['groups', 'schools']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');
const ASSETS = ['/uploads/c1/libro.pdf', '/uploads/c2/libro.pdf', '/uploads/c3/libro.pdf', '/uploads/audio/content-c3/chunk_000.mp3', '/uploads/c1/portada.jpg', '/uploads/c4/portada.jpg'];

const PORT = 5900 + (process.pid % 90);
const base = `http://127.0.0.1:${PORT}`;
let child = null;
let boot = '';
async function start(mode) {
    boot = '';
    child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(PORT),
            CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: path.join(tmp, 'groups.json'), SCHOOLS_DB: path.join(tmp, 'schools.json'),
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, USER_AUDIT_DB: P.audit,
            ROYALTIES_DB: P.royalties, OFFLINE_ASSIGNMENT_DB_PATH: P.offline, SESSION_AUTH_MODE: 'off', UPLOADS_AUTHZ_MODE: 'strict',
            RIGHTS_ENFORCEMENT_MODE: mode,
            OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        },
    });
    child.stdout.on('data', (d) => { boot += d; });
    child.stderr.on('data', (d) => { boot += d; });
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy (${mode})\n${boot.slice(-2000)}`);
}
async function stop() {
    if (!child) return;
    const c = child; child = null;
    c.kill();
    for (let i = 0; i < 50 && c.exitCode === null; i++) await sleep(100);
}

const as = (uid) => ({ 'content-type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}) });
const call = async (method, url, uid, body, headers = {}) => {
    const r = await fetch(`${base}${url}`, { method, headers: { ...as(uid), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let j = null; try { j = JSON.parse(text); } catch { /* sin cuerpo JSON */ }
    return { status: r.status, body: j, text };
};
const uploadVerdict = async (uid, p) => (await call('GET', '/api/internal/uploads-authz', uid, undefined, { 'x-original-uri': p })).status;

/** Lo que cada actor observa, sin escrituras. */
async function observe() {
    const out = {};
    for (const uid of ['LEC', 'MED', 'ADM']) {
        const cat = await call('GET', '/api/content', uid);
        const my = await call('GET', '/api/content/my-catalog', uid);
        const acc = {};
        for (const id of IDS) { const r = await call('GET', `/api/content/${id}/access?userId=${uid}`, uid); acc[id] = `${r.status}:${r.body?.allowed}`; }
        const up = {};
        for (const a of ASSETS) up[a] = await uploadVerdict(uid, a);
        out[uid] = { catalog: `${cat.status}:${hash(cat.body)}`, myCatalog: `${my.status}:${hash(my.body)}`, access: acc, uploads: up };
    }
    out.anonUploads = Object.fromEntries(await Promise.all(ASSETS.map(async (a) => [a, await uploadVerdict(null, a)])));
    return out;
}
const countRows = (file, table) => {
    if (!fs.existsSync(file)) return 'absent';
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { return db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n; } catch { return 'no-table'; } finally { db.close(); }
};
const sideEffects = () => ({
    access: sha(P.access), content: sha(P.content), users: sha(P.users),
    progressJson: sha(path.join(P.data, 'progress_db.json')),
    progressRows: countRows(path.join(P.data, 'progress.db'), 'progress'),
    eventRows: countRows(path.join(P.data, 'events.db'), 'events'),
    offlineRows: countRows(P.offline, 'offline_assignments'),
});

const ALL = (v) => Object.fromEntries(['subscription_reading', 'tts', 'ai_leo', 'offline', 'indexing', 'promo_fragments', 'cover_metadata'].map((c) => [c, v]));
const version = (extra = {}) => ({
    publisherId: PUB, actRef: 'ACTA-PRUEBA-77', actSignedOn: '2026-01-01', validFrom: '2026-01-01', validUntil: null,
    effectiveAt: '2026-01-01T05:00:00.000Z', legalStatus: 'active', economicStatus: 'active', settlementClass: 'auxiliary',
    permissions: ALL(true), ...extra,
});

try {
    console.log('\n[1] línea base: off, sin derechos');
    await start('off');
    ok('arranque en modo test NO crea royalties.db', !fs.existsSync(P.royalties));
    const baseline = await observe();
    ok('el lector lee las 5 obras y sus PDF', Object.values(baseline.LEC.access).every((v) => v === '200:true') && baseline.LEC.uploads['/uploads/c3/libro.pdf'] === 204);
    ok('el audio TTS del lector se sirve', baseline.LEC.uploads['/uploads/audio/content-c3/chunk_000.mp3'] === 204);
    const offlineC1 = await call('POST', '/api/offline/assignment', 'LEC', { contentId: 'content-c1' });
    await call('DELETE', '/api/offline/assignment', 'LEC');
    const before = sideEffects();
    await stop();

    console.log('\n[2] enforce sin derechos registrados');
    await start('enforce');
    ok('respuestas idénticas a la línea base', JSON.stringify(await observe()) === JSON.stringify(baseline));
    ok('offline de una obra sin régimen igual que antes', (await call('POST', '/api/offline/assignment', 'LEC', { contentId: 'content-c1' })).status === offlineC1.status);
    await call('DELETE', '/api/offline/assignment', 'LEC');

    console.log('\n[3] registro de versiones');
    ok('lector no registra derechos', [401, 403].includes((await call('POST', '/api/admin/rights/content-c2/versions', 'LEC', version())).status));
    ok('mediador no registra derechos', [401, 403].includes((await call('POST', '/api/admin/rights/content-c2/versions', 'MED', version())).status));
    ok('sin sesión no registra derechos', (await call('POST', '/api/admin/rights/content-c2/versions', null, version())).status === 401);
    let r = await call('POST', '/api/admin/rights/content-c2/versions', 'ADM', version({ settlementClass: 'liquidable', alpha: 0.5, expectedMinutes: 90, shares: [{ publisherId: PUB, shareBp: 9000 }] }));
    ok('matriz ≠ 100 % → 400', r.status === 400 && r.body?.code === 'shares_not_100');
    r = await call('POST', '/api/admin/rights/content-c2/versions', 'ADM', version({ permissions: { subscription_reading: false } }));
    ok('permisos incompletos → 400', r.status === 400 && r.body?.code === 'permission_not_explicit');
    r = await call('POST', '/api/admin/rights/content-zz/versions', 'ADM', version());
    ok('obra inexistente → 404', r.status === 404);
    const v2 = await call('POST', '/api/admin/rights/content-c2/versions', 'ADM', version({ permissions: { ...ALL(true), subscription_reading: false } }));
    const v3 = await call('POST', '/api/admin/rights/content-c3/versions', 'ADM', version({ permissions: { ...ALL(true), tts: false, ai_leo: false, offline: false } }));
    const v4 = await call('POST', '/api/admin/rights/content-c4/versions', 'ADM', version({ permissions: { ...ALL(true), cover_metadata: false } }));
    const v5 = await call('POST', '/api/admin/rights/content-c5/versions', 'ADM', version({ settlementClass: 'liquidable', alpha: 0.6, expectedMinutes: 95, shares: [{ publisherId: PUB, shareBp: 10000 }] }));
    ok('cuatro versiones registradas (201)', [v2, v3, v4, v5].every((x) => x.status === 201 && x.body.versionNo === 1), JSON.stringify([v2, v3, v4, v5].map((x) => x.body)));
    r = await call('GET', '/api/admin/rights/content-c3', 'ADM');
    ok('admin consulta el historial y la versión efectiva', r.status === 200 && r.body.versions.length === 1 && r.body.effectiveVersionId === v3.body.id && r.body.enforcementMode === 'enforce');
    r = await call('GET', '/api/admin/rights/content-c5/eligibility', 'ADM');
    ok('obra liquidable completa → elegible', r.status === 200 && r.body.eligible === true, JSON.stringify(r.body));
    r = await call('GET', '/api/admin/rights/content-c3/eligibility', 'ADM');
    ok('obra auxiliar → no elegible, con motivo', r.body.eligible === false && r.body.reasons.includes('SETTLEMENT_AUXILIARY'));
    r = await call('GET', '/api/admin/rights/content-c1/eligibility', 'ADM');
    ok('solo publisherId → no elegible', r.body.eligible === false && r.body.reasons.includes('NO_RIGHTS_VERSION'));

    console.log('\n[4] enforce con derechos: denegación por capacidad');
    const now = await observe();
    ok('lectura denegada (C2) a lector y mediador', now.LEC.access['content-c2'] === '403:false' && now.MED.access['content-c2'] === '403:false');
    r = await call('GET', '/api/content/content-c2/access?userId=LEC', 'LEC');
    ok('motivo RIGHTS_NOT_AUTHORIZED', r.body?.errorCode === 'RIGHTS_NOT_AUTHORIZED');
    ok('admin sigue leyendo C2', now.ADM.access['content-c2'] === '200:true');
    ok('PDF de C2 denegado al lector', now.LEC.uploads['/uploads/c2/libro.pdf'] === 403);
    const lecCat = (await call('GET', '/api/content', 'LEC')).body;
    const c2 = lecCat.find((c) => c.id === 'content-c2');
    ok('C2 sigue listada pero sin localizadores', !!c2 && !('url_recurso' in c2));
    ok('audio TTS de C3 denegado', now.LEC.uploads['/uploads/audio/content-c3/chunk_000.mp3'] === 403 && now.MED.uploads['/uploads/audio/content-c3/chunk_000.mp3'] === 403);
    ok('lectura de C3 permitida (PDF 204)', now.LEC.access['content-c3'] === '200:true' && now.LEC.uploads['/uploads/c3/libro.pdf'] === 204);
    ok('admin conserva el audio de C3', now.ADM.uploads['/uploads/audio/content-c3/chunk_000.mp3'] === 204);
    r = await call('POST', '/api/album/tts', 'LEC', { text: 'Hola', contentId: 'content-c3' });
    ok('TTS de álbum denegado (C3)', r.status === 403 && r.body?.code === 'RIGHTS_NOT_AUTHORIZED');
    r = await call('POST', '/api/content/content-c3/retry', 'ADM');
    ok('regenerar TTS de C3 denegado incluso a admin', r.status === 403 && r.body?.code === 'RIGHTS_NOT_AUTHORIZED');
    r = await call('POST', '/api/leo/ask', 'LEC', { contentId: 'content-c3', interactionType: 'question', payload: 'hola' });
    ok('Leo ask denegado (C3)', r.status === 403 && r.body?.code === 'RIGHTS_NOT_AUTHORIZED');
    r = await call('POST', '/api/leo/chat', 'LEC', { contentId: 'content-c3', mensaje: 'hola', historial: [] });
    ok('Leo chat denegado (C3)', r.status === 403);
    r = await call('GET', '/api/leo/memory/LEC/content-c3', 'LEC');
    ok('memoria de Leo denegada (C3)', r.status === 403);
    r = await call('POST', '/api/offline/assignment', 'LEC', { contentId: 'content-c3' });
    ok('offline denegado (C3)', r.status === 403 && r.body?.reason === 'rights_not_authorized');
    ok('C4 no se lista al lector ni al mediador', !lecCat.some((c) => c.id === 'content-c4') && !(await call('GET', '/api/content', 'MED')).body.some((c) => c.id === 'content-c4'));
    ok('C4 no aparece en my-catalog', !(await call('GET', '/api/content/my-catalog', 'LEC')).body.catalog.some((c) => c.id === 'content-c4'));
    ok('portada de C4 deja de ser pública', now.anonUploads['/uploads/c4/portada.jpg'] === 403 && now.LEC.uploads['/uploads/c4/portada.jpg'] === 403);
    ok('admin sigue viendo C4 y su portada', (await call('GET', '/api/content', 'ADM')).body.some((c) => c.id === 'content-c4') && now.ADM.uploads['/uploads/c4/portada.jpg'] === 204);

    console.log('\n[5] obras sin régimen y privacidad');
    ok('C1 idéntica en todo para todos', ['LEC', 'MED', 'ADM'].every((u) => now[u].access['content-c1'] === baseline[u].access['content-c1']
        && now[u].uploads['/uploads/c1/libro.pdf'] === baseline[u].uploads['/uploads/c1/libro.pdf']
        && now[u].uploads['/uploads/c1/portada.jpg'] === baseline[u].uploads['/uploads/c1/portada.jpg']));
    ok('C1 en el catálogo idéntica a la línea base', JSON.stringify(lecCat.find((c) => c.id === 'content-c1')) === JSON.stringify(CONTENT[0]));
    r = await call('POST', '/api/leo/ask', 'LEC', { contentId: 'content-c1', interactionType: 'question', payload: 'hola' });
    ok('Leo de C1 no lo bloquean los derechos', r.status !== 403);
    ok('lector no consulta derechos', [401, 403].includes((await call('GET', '/api/admin/rights/content-c3', 'LEC')).status));
    ok('mediador no consulta derechos', [401, 403].includes((await call('GET', '/api/admin/rights/content-c3', 'MED')).status));
    ok('mediador no consulta elegibilidad', [401, 403].includes((await call('GET', '/api/admin/rights/content-c5/eligibility', 'MED')).status));
    const visible = JSON.stringify([lecCat, (await call('GET', '/api/content', 'MED')).body, (await call('GET', '/api/content/content-c3/access?userId=LEC', 'LEC')).body]);
    ok('ningún dato contractual en catálogo ni /access', !/ACTA-PRUEBA-77|actRef|shareBp|alpha|expectedMinutes|settlementClass|rv-/.test(visible));
    await sleep(500);
    const audit = fs.existsSync(P.audit) ? JSON.parse(fs.readFileSync(P.audit, 'utf8')) : [];
    ok('altas de derechos auditadas', audit.filter((a) => a.action === 'rights_version_create').length === 4);
    await stop();

    console.log('\n[6] shadow y off con derechos registrados');
    await start('shadow');
    ok('shadow: respuestas idénticas a la línea base', JSON.stringify(await observe()) === JSON.stringify(baseline));
    ok('shadow: registra lo que denegaría', /\[RIGHTS_SHADOW\] would_deny contentId=content-c3 capability=tts/.test(boot) && /would_deny contentId=content-c4 capability=cover_metadata/.test(boot));
    await stop();
    await start('off');
    ok('off: respuestas idénticas a la línea base', JSON.stringify(await observe()) === JSON.stringify(baseline));
    ok('off: ninguna traza de derechos', !/\[RIGHTS(_SHADOW)?\]/.test(boot));

    console.log('\n[7] efectos laterales');
    const after = sideEffects();
    ok('accesos, catálogo, usuarios, progreso, eventos y offline intactos', JSON.stringify(after) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    const rdb = new Database(P.royalties, { readonly: true, fileMustExist: true });
    ok('royalties.db: 4 versiones, solo las registradas', rdb.prepare('SELECT COUNT(*) n FROM rights_versions').get().n === 4);
    ok('royalties.db íntegra', rdb.pragma('integrity_check', { simple: true }) === 'ok');
    rdb.close();
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    await stop();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

ok('la base real data-critical/royalties.db no se creó', fs.existsSync(REAL_DB) === realBefore);
console.log(`\nrightsHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
