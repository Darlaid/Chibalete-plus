/**
 * epubOriginalEndpoint.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3E.3.
 *
 * GET /api/content/:id/epub (EPUB original autorizado) + bloqueo del .epub
 * público en /uploads (autorizador del edge y express.static) + regresión de
 * GET /api/content/:id/access tras extraer decideContentAccess.
 * Arranca server.js REAL sobre stores temporales. NUNCA toca data/,
 * access_db productivo, uploads productivos ni la red.
 *
 *   node server/__test__/epubOriginalEndpoint.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_epub_orig_'));
const up = path.join(tmp, 'uploads');
const put = (rel, data) => { const p = path.join(up, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const EPUB = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(2048, 7)]);   // bytes opacos: el endpoint no parsea
put('content-epub1/book.epub', EPUB);
put('content-epub1/cover.png', Buffer.from([0x89, 0x50, 0x4e, 0x47]));
put('content-epub1/canonical/book.txt', 'Texto canónico');
put('content-other/x.epub', EPUB);
put('content-notepub/a.txt', 'no soy epub');
put('secret.epub', EPUB);

const now = Date.now();
const CONTENT = [
    { id: 'content-epub1', titulo: 'Alicia EPUB', tipo: 'libro', epub_url: '/uploads/content-epub1/book.epub', portada_url: '/uploads/content-epub1/cover.png', texto_plano_url: '/uploads/content-epub1/canonical/book.txt' },
    { id: 'content-txt', titulo: 'Alicia TXT', tipo: 'libro', texto_plano_url: '/uploads/content-txt/a.txt' },
    { id: 'content-foreign', titulo: 'Foráneo', tipo: 'libro', epub_url: '/uploads/content-other/x.epub' },
    { id: 'content-trav', titulo: 'Traversal', tipo: 'libro', epub_url: '/uploads/content-trav/../secret.epub' },
    { id: 'content-missing', titulo: 'Ausente', tipo: 'libro', epub_url: '/uploads/content-missing/nope.epub' },
    { id: 'content-notepub', titulo: 'No EPUB', tipo: 'libro', epub_url: '/uploads/content-notepub/a.txt' },
];
const USERS = [
    { id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active' },
    { id: 'MED', email: 'med@fx.test', roles: ['mediador'], accountStatus: 'active' },
    { id: 'LEC', email: 'lec@fx.test', roles: ['lector'], accountStatus: 'active' },
    { id: 'GRANT', email: 'grant@fx.test', roles: ['lector'], accountStatus: 'active' },
    { id: 'MEM', email: 'mem@fx.test', roles: ['lector'], accountStatus: 'active' },
    { id: 'EXP', email: 'exp@fx.test', roles: ['lector'], accountStatus: 'active' },
];
const GROUPS = [{ id: 'G-club', name: 'Club Alicia', type: 'club', memberIds: ['MEM'], mediatorIds: [] }];
const ALL_IDS = CONTENT.map(c => c.id);
const ACCESS = [
    { id: 'r-grant', scope: 'user', scopeId: 'GRANT', titleIds: ALL_IDS, collectionIds: [], expiresAt: now + 86400000 },
    { id: 'r-group', scope: 'group', scopeId: 'G-club', titleIds: ['content-epub1'], collectionIds: [] },
    { id: 'r-expired', scope: 'user', scopeId: 'EXP', titleIds: ['content-epub1'], collectionIds: [], expiresAt: now - 1000 },
];
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'), access: path.join(tmp, 'access.json'), groups: path.join(tmp, 'groups.json') };
fs.mkdirSync(P.data, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.content, JSON.stringify(CONTENT));
fs.writeFileSync(P.access, JSON.stringify(ACCESS));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(path.join(tmp, 'schools.json'), '[]');
const accessBefore = fs.readFileSync(P.access);

const PORT = 5800 + (process.pid % 100);
const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT),
        CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: path.join(tmp, 'schools.json'),
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: up, ACCESS_FALLBACK_MODE: 'restricted',
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), SESSION_AUTH_MODE: 'off',
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    },
});
let out = '';
child.stdout.on('data', d => { out += d; });
child.stderr.on('data', d => { out += d; });

const get = async (p, user, headers = {}) => {
    const r = await fetch(`${base}${p}`, { headers: { ...(user ? { 'x-user-id': user } : {}), ...headers } });
    const buf = Buffer.from(await r.arrayBuffer());
    return { status: r.status, headers: r.headers, buf };
};
const epub = (id, user) => get(`/api/content/${id}/epub`, user);

try {
    for (let i = 0; i < 200; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${out.slice(-2000)}`);
        if (/Server running on port/.test(out)) break;
        await sleep(200);
    }

    console.log('[1] autorización (decideContentAccess)');
    ok('A. sin autenticación → 401', (await epub('content-epub1', null)).status === 401);
    ok('B. autenticado sin acceso (lector sin reglas, modo restringido) → 403', (await epub('content-epub1', 'LEC')).status === 403);
    const c = await epub('content-epub1', 'GRANT');
    ok('C. grant válido → 200', c.status === 200, c.status);
    ok('C. … application/epub+zip, Content-Length exacto, bytes idénticos, private', c.headers.get('content-type') === 'application/epub+zip' && Number(c.headers.get('content-length')) === EPUB.length && c.buf.equals(EPUB) && /private/.test(c.headers.get('cache-control') || ''));
    ok('C. … sin Range en v1', !/bytes/.test(c.headers.get('accept-ranges') || ''));
    ok('D. admin → 200', (await epub('content-epub1', 'ADM')).status === 200);
    ok('D. mediador → 200 (catálogo de mediador)', (await epub('content-epub1', 'MED')).status === 200);
    ok('E. membresía de grupo con regla vigente → 200', (await epub('content-epub1', 'MEM')).status === 200);
    ok('E. regla vencida (entitlement expirado) → 403', (await epub('content-epub1', 'EXP')).status === 403);
    const nope = (await epub('content-epub1', 'NOPE')).status;
    ok('usuario inexistente → 401/403 (nunca 200)', nope === 401 || nope === 403, nope);

    console.log('\n[2] archivo y ruta (solo desde el registro)');
    ok('F. título sin EPUB → 404', (await epub('content-txt', 'ADM')).status === 404);
    ok('F. contenido inexistente → 404', (await epub('content-zzz', 'ADM')).status === 404);
    ok('G. epub_url con traversal → 404 (no sirve /uploads/secret.epub)', (await epub('content-trav', 'ADM')).status === 404);
    ok('G. id con traversal en la URL → no 200', (await get('/api/content/..%2F..%2Fsecret/epub', 'ADM')).status !== 200);
    ok('H. epub_url bajo OTRO owner → 404', (await epub('content-foreign', 'ADM')).status === 404);
    ok('H. epub_url que no es .epub → 404', (await epub('content-notepub', 'ADM')).status === 404);
    ok('I. archivo ausente → 404 controlado', (await epub('content-missing', 'ADM')).status === 404 && /EPUB_ORIGINAL\] contentId=content-missing epub_url no servible/.test(out));
    ok('el orden protege: lector sin acceso no averigua problemas del archivo (403 antes del fs)', (await epub('content-missing', 'LEC')).status === 403);

    console.log('\n[3] .epub ya no es recurso público');
    ok('GET /uploads/<id>/book.epub → 403', (await get('/uploads/content-epub1/book.epub', null)).status === 403);
    ok('… también autenticado como admin (solo vía endpoint)', (await get('/uploads/content-epub1/book.epub', 'ADM')).status === 403);
    ok('… mayúsculas (.EPUB) también', (await get('/uploads/content-epub1/book.EPUB', null)).status === 403);
    ok('portada sigue pública (200)', (await get('/uploads/content-epub1/cover.png', null)).status === 200);
    ok('canonical/book.txt sigue igual (200)', (await get('/uploads/content-epub1/canonical/book.txt', null)).status === 200);
    const authz = (uri) => get('/api/internal/uploads-authz', null, { 'x-original-uri': uri });
    ok('autorizador del edge: .epub → 403 (auth_request solo propaga 401/403)', (await authz('/uploads/content-epub1/book.epub')).status === 403);
    ok('autorizador del edge: portada y book.txt → 204 como antes', (await authz('/uploads/content-epub1/cover.png')).status === 204 && (await authz('/uploads/content-epub1/canonical/book.txt')).status === 204);

    console.log('\n[4] regresión de GET /api/content/:id/access (misma autoridad)');
    const acc = async (u, id = 'content-epub1') => { const r = await get(`/api/content/${id}/access?userId=${u}`, u); return [r.status, JSON.parse(r.buf.toString()).allowed]; };
    ok('admin → 200 allowed', JSON.stringify(await acc('ADM')) === '[200,true]');
    ok('grant → 200 allowed', JSON.stringify(await acc('GRANT')) === '[200,true]');
    ok('membresía → 200 allowed', JSON.stringify(await acc('MEM')) === '[200,true]');
    ok('lector sin reglas → 403', JSON.stringify(await acc('LEC')) === '[403,false]');
    ok('userId distinto de la sesión → 401', (await get('/api/content/content-epub1/access?userId=ADM', 'LEC')).status === 401);
    ok('contenido inexistente (no admin) → 404', JSON.stringify(await acc('GRANT', 'content-zzz')) === '[404,false]');

    ok('access_db de prueba intacto', fs.readFileSync(P.access).equals(accessBefore));
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nepubOriginalEndpoint — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
