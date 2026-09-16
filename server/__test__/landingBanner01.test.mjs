/**
 * landingBanner01.test.mjs — CHP-LANDING-BANNER-02.
 *
 * Banner administrable de /bienvenida: GET público, GET/PUT administrativos y
 * data/landing_banner.json. Servidor REAL hermético (stores, SQLite y uploads
 * en un temporal; SESSION_AUTH_MODE=off → identidad por x-user-id).
 *
 *   node server/__test__/landingBanner01.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const REPO_BANNER = path.join(REPO, 'data', 'landing_banner.json');
const repoBannerExisted = fs.existsSync(REPO_BANNER);
// Huella de los stores reales del repositorio: la suite no debe tocarlos.
const repoStoresPrint = () => ['data', 'data-critical'].flatMap(d => {
    const dir = path.join(REPO, d);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir).sort().map(f => {
        const st = fs.statSync(path.join(dir, f));
        return `${d}/${f}:${st.size}:${st.mtimeMs}`;
    });
}).join('|');
const repoStoresBefore = repoStoresPrint();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_banner_'));
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'),
    uploads: path.join(tmp, 'uploads'),
};
const BANNER = path.join(P.data, 'landing_banner.json');
fs.mkdirSync(P.data, { recursive: true }); fs.mkdirSync(P.uploads, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'u-admin', email: 'admin@fixture.invalid', nombre_completo: 'Admin', roles: ['administrador'], accountStatus: 'active' },
    { id: 'u-lector', email: 'lector@fixture.invalid', nombre_completo: 'Lector', roles: ['lector'], accountStatus: 'active' },
]));
for (const f of [P.groups, P.schools, P.access]) fs.writeFileSync(f, '[]');
// Material pedagógico independiente: su PDF es PEDAGOGY_RESTRICTED para el edge.
const PROTECTED_URL = '/uploads/c-guia/guia-protegida.pdf';
fs.writeFileSync(P.content, JSON.stringify([
    { id: 'c-guia', titulo: 'Guía', tipo: 'guia', archivoUrl: PROTECTED_URL },
]));
fs.writeFileSync(path.join(P.data, 'progress_db.json'), JSON.stringify({ progressMap: {} }));

// PNG 1×1 real: pasa la validación binaria de /api/upload.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

const port = 3500 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${port}`;
const api = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data,
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content,
        UPLOADS_ROOT: P.uploads, USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
        EVENTS_SQLITE_PATH: path.join(tmp, 'events.db'), INSIGHTS_SQLITE_PATH: path.join(tmp, 'insights.db'),
        ARCHIVE_SQLITE_PATH: path.join(tmp, 'events.archive.db'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'offline_assignments.db'), SESSIONS_DB: path.join(tmp, 'sessions.db'),
        SESSION_AUTH_MODE: 'off', ADMIN_SECRET: '', OPENAI_API_KEY: '', GEMINI_API_KEY: '' },
});
api._log = '';
api.stdout.on('data', d => { api._log += d; });
api.stderr.on('data', d => { api._log += d; });

const req = async (method, route, { uid, body } = {}) => {
    const headers = {};
    if (uid) headers['x-user-id'] = uid;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const r = await fetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { json = null; }
    return { status: r.status, body: json };
};
const readBanner = () => JSON.parse(fs.readFileSync(BANNER, 'utf8'));

try {
    for (let i = 0; ; i++) {
        if (api.exitCode !== null) throw new Error(`server rc=${api.exitCode}\n${api._log.slice(-1500)}`);
        try { if ((await fetch(`${base}/api/health`)).ok) break; } catch { /* arrancando */ }
        if (i > 300) throw new Error(`el servidor nunca quedó healthy\n${api._log.slice(-1500)}`);
        await sleep(400);
    }

    console.log('\n[1] archivo ausente');
    ok('el arranque NO crea landing_banner.json', !fs.existsSync(BANNER));
    const empty = await req('GET', '/api/landing-banner');
    ok('GET público sin archivo → 200 []', empty.status === 200 && Array.isArray(empty.body) && empty.body.length === 0, JSON.stringify(empty));
    ok('la lectura tampoco crea el archivo', !fs.existsSync(BANNER));

    console.log('\n[2] GET público: solo activos, ordenados y proyectados');
    fs.writeFileSync(BANNER, JSON.stringify([
        { id: 'c', imageUrl: '/uploads/c.png', order: 2, active: true },
        { id: 'x', imageUrl: '/uploads/x.png', order: 0, active: false },
        { id: 'a', imageUrl: '/uploads/a.png', order: 1, active: true, title: 'A', secreto: 'no-publico' },
    ]));
    const pub = await req('GET', '/api/landing-banner');
    ok('devuelve solo los activos en orden', pub.status === 200 && JSON.stringify(pub.body.map(s => s.id)) === '["a","c"]', JSON.stringify(pub.body));
    ok('slide inactivo ausente del GET público', !pub.body.some(s => s.id === 'x'));
    ok('campos desconocidos no se publican', pub.body.every(s => !('secreto' in s)));

    console.log('\n[3] GET administrativo');
    ok('anónimo → 401', (await req('GET', '/api/admin/landing-banner')).status === 401);
    ok('lector → 403', (await req('GET', '/api/admin/landing-banner', { uid: 'u-lector' })).status === 403);
    const adm = await req('GET', '/api/admin/landing-banner', { uid: 'u-admin' });
    ok('administrador → 200 con inactivos incluidos', adm.status === 200 && adm.body.length === 3 && adm.body.some(s => s.id === 'x' && s.active === false), JSON.stringify(adm.body));

    console.log('\n[4] PUT administrativo: autorización');
    const before = fs.readFileSync(BANNER, 'utf8');
    ok('anónimo → 401', (await req('PUT', '/api/admin/landing-banner', { body: [] })).status === 401);
    ok('lector → 403', (await req('PUT', '/api/admin/landing-banner', { uid: 'u-lector', body: [] })).status === 403);
    ok('un rechazo no toca el archivo', fs.readFileSync(BANNER, 'utf8') === before);

    console.log('\n[5] PUT normaliza, reutilizando /api/upload');
    const fd = new FormData();
    fd.append('file', new Blob([PNG], { type: 'image/png' }), 'banner.png');
    const up = await fetch(`${base}/api/upload`, { method: 'POST', headers: { 'x-user-id': 'u-admin' }, body: fd });
    const upBody = await up.json();
    ok('uploadFile sin parentId → /uploads/<archivo> en la raíz', up.status === 200 && /^\/uploads\/[^/]+\.png$/.test(upBody.url), JSON.stringify(upBody));
    const authz = await fetch(`${base}/api/internal/uploads-authz`, { headers: { 'x-original-uri': upBody.url } });
    ok('esa imagen es servible sin sesión (autorizador del edge → 204)', authz.status === 204, String(authz.status));

    const put = await req('PUT', '/api/admin/landing-banner', { uid: 'u-admin', body: [
        { id: '  s-dos ', imageUrl: ` ${upBody.url} `, title: '  Hola  ', text: '', linkUrl: ' https://chibaleteeditores.com/ ', linkLabel: ' Ver ', order: 99, active: true, extra: 'fuera' },
        { imageUrl: upBody.url, order: -5, active: 'si' },
    ] });
    const saved = put.body;
    ok('PUT admin → 200', put.status === 200, JSON.stringify(put));
    ok('recorta strings y conserva el id existente', saved?.[0]?.id === 's-dos' && saved[0].title === 'Hola' && saved[0].linkLabel === 'Ver' && saved[0].linkUrl === 'https://chibaleteeditores.com/' && saved[0].imageUrl === upBody.url, JSON.stringify(saved));
    ok('omite opcionales vacíos y descarta campos desconocidos', !('text' in saved[0]) && !('extra' in saved[0]));
    ok('genera id solo cuando falta', typeof saved?.[1]?.id === 'string' && saved[1].id.length > 0);
    ok('order = posición en el array recibido', saved[0].order === 0 && saved[1].order === 1);
    ok('active es booleano estricto', saved[0].active === true && saved[1].active === false);
    ok('lo persistido es exactamente lo devuelto', JSON.stringify(readBanner()) === JSON.stringify(saved));
    const pubAfter = await req('GET', '/api/landing-banner');
    ok('GET público refleja el guardado (solo el activo)', pubAfter.body.length === 1 && pubAfter.body[0].id === 's-dos', JSON.stringify(pubAfter.body));

    console.log('\n[6-8] PUT rechaza imágenes y enlaces inválidos');
    const persisted = fs.readFileSync(BANNER, 'utf8');
    for (const [label, slide] of [
        ['imageUrl externa', { imageUrl: 'https://evil.example/x.png', active: true }],
        ['imageUrl relativa sin /uploads/', { imageUrl: '/assets/x.png', active: true }],
        ['imageUrl con traversal', { imageUrl: '/uploads/../data/users.json', active: true }],
        ['linkUrl http://', { imageUrl: upBody.url, linkUrl: 'http://chibaleteeditores.com/', active: true }],
        ['linkUrl javascript:', { imageUrl: upBody.url, linkUrl: 'javascript:alert(1)', active: true }],
    ]) {
        const r = await req('PUT', '/api/admin/landing-banner', { uid: 'u-admin', body: [slide] });
        ok(`${label} → 400`, r.status === 400 && typeof r.body?.error === 'string', JSON.stringify(r));
    }
    const prot = await req('PUT', '/api/admin/landing-banner', { uid: 'u-admin', body: [{ imageUrl: PROTECTED_URL, active: true }] });
    ok('asset de pedagogía protegida → 400 con error claro', prot.status === 400 && /protegido/.test(prot.body?.error || ''), JSON.stringify(prot));
    const protAuthz = await fetch(`${base}/api/internal/uploads-authz`, { headers: { 'x-original-uri': PROTECTED_URL } });
    ok('coherente con el autorizador del edge (anónimo → 401)', protAuthz.status === 401, String(protAuthz.status));
    ok('body que no es array → 400', (await req('PUT', '/api/admin/landing-banner', { uid: 'u-admin', body: { imageUrl: upBody.url } })).status === 400);
    ok('ningún rechazo modificó el archivo', fs.readFileSync(BANNER, 'utf8') === persisted);
    ok('ningún rechazo borró la imagen subida (cero purgas)', fs.existsSync(path.join(P.uploads, path.basename(upBody.url))));

    console.log('\n[9] desactivar retira del GET público');
    const off = await req('PUT', '/api/admin/landing-banner', { uid: 'u-admin', body: readBanner().map(s => ({ ...s, active: false })) });
    ok('PUT con todo inactivo → 200', off.status === 200);
    ok('GET público → []', (await req('GET', '/api/landing-banner')).body.length === 0);

    console.log('\n[10] actualización completa bajo lock');
    const payloads = Array.from({ length: 8 }, (_, k) =>
        Array.from({ length: k + 1 }, (_, j) => ({ id: `p${k}-${j}`, imageUrl: upBody.url, title: `T${k}`, active: true })));
    const results = await Promise.all(payloads.map(body => req('PUT', '/api/admin/landing-banner', { uid: 'u-admin', body })));
    ok('8 PUT concurrentes → 200', results.every(r => r.status === 200), results.map(r => r.status).join(','));
    const final = readBanner();
    const k = final.length - 1;
    ok('el archivo final es UNO de los arrays completos, sin mezclas', final.length >= 1 && final.every((s, j) => s.id === `p${k}-${j}` && s.title === `T${k}`), JSON.stringify(final));
    ok('sin residuo .tmp', !fs.existsSync(`${BANNER}.tmp`));
    const retire = await req('PUT', '/api/admin/landing-banner', { uid: 'u-admin', body: [] });
    ok('retirar todos los slides → 200 [] y la imagen sigue en disco', retire.status === 200 && readBanner().length === 0 && fs.existsSync(path.join(P.uploads, path.basename(upBody.url))));
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
    const block = src.slice(src.indexOf("app.put('/api/admin/landing-banner'"), src.indexOf('// --- SCHOOL CONFIG ROUTES'));
    ok('la escritura va dentro de withFileLock sobre LANDING_BANNER_DB', /withFileLock\(LANDING_BANNER_DB,[\s\S]*writeJSON\(LANDING_BANNER_DB/.test(block));
    ok('la ruta no llama a purga alguna', !/purge|unlink|rmSync/i.test(block));

    console.log('\n[H] hermeticidad');
    ok('data/landing_banner.json del repositorio no fue creado', fs.existsSync(REPO_BANNER) === repoBannerExisted);
    ok('data/ y data-critical/ del repositorio intactos (tamaño y mtime)', repoStoresPrint() === repoStoresBefore);
} finally {
    try { api.kill(); } catch { /* noop */ }
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* noop */ }
}
console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
