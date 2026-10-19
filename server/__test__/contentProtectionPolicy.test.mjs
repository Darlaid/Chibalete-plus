/**
 * contentProtectionPolicy.test.mjs
 * CHP-CONTENT-PROTECTION-2026-01 CP-4A2 — política de originales por título.
 *
 *   contentProtectionPolicy?: "standard" | "licensed_strict"   (ausente = standard)
 *
 * Derecho a leer ≠ derecho a recibir el original. Con licensed_strict el
 * lector autorizado lee por texto canónico / Álbum / audio / vídeo, pero el
 * PDF original (`url_recurso` .pdf del propio registro) y el EPUB original
 * (`epub_url`, solo por GET /api/content/:id/epub) se deniegan en el
 * SERVIDOR. Standard: contrato intacto.
 *
 *   [0] funciones puras (accessService)
 *   [1] escritura administrativa: contrato del campo, RMW y gate de publicación
 *   [2] catálogo (GET /api/content)
 *   [3] /uploads en modo estricto: Node (express.static) y autorizador del edge
 *   [4] GET /api/content/:id/epub
 *   [5] /uploads en modo legacy
 *   [6] rendimiento: el catálogo no añade lecturas de stores
 *
 * SESSION_AUTH_MODE=off (x-user-id): corre también en Windows. Stores en un
 * directorio temporal; 0 lecturas/escrituras de stores reales.
 *
 *   node server/__test__/contentProtectionPolicy.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    parseContentProtectionPolicy, isLicensedStrict, isOriginalPdfOf, withoutOriginalLocators,
    nonOriginalReadingRepresentations, isLicensedStrictOriginalPath, decideUploadAssetAccess, UPLOAD_ASSET_DECISION,
} from '../accessService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── [0] funciones puras ─────────────────────────────────────────────────────
console.log('[0] funciones puras');
const P_ = parseContentProtectionPolicy;
ok('A. ausente (undefined) → sin valor (el llamador conserva el guardado)', P_(undefined).ok && P_(undefined).value === undefined);
ok('A. null / "" → standard', P_(null).value === 'standard' && P_('').value === 'standard');
ok('B. standard → standard', P_('standard').value === 'standard');
ok('C. licensed_strict → licensed_strict', P_('licensed_strict').value === 'licensed_strict');
ok('D. valores desconocidos → rechazo (no se reinterpretan)', ['strict', 'LICENSED_STRICT', 'true', 1, true, {}].every(v => !P_(v).ok));
ok('lectura: ausente / standard → no estricto', !isLicensedStrict({}) && !isLicensedStrict({ contentProtectionPolicy: 'standard' }) && !isLicensedStrict(null));
ok('lectura: licensed_strict → estricto', isLicensedStrict({ contentProtectionPolicy: 'licensed_strict' }));
ok('lectura: valor corrupto guardado → estricto (fail-closed)', isLicensedStrict({ contentProtectionPolicy: 'xx' }));
const strictItem = { id: 'x', contentProtectionPolicy: 'licensed_strict', url_recurso: '/uploads/x/libro.pdf', epub_url: '/uploads/x/libro.epub', texto_plano_url: '/uploads/x/canonical/book.txt', ilustraciones_url: ['/uploads/x/i.png'] };
ok('PDF original = url_recurso .pdf del registro', isOriginalPdfOf(strictItem, '/uploads/x/libro.pdf'));
ok('otro PDF del mismo título no es el original', !isOriginalPdfOf(strictItem, '/uploads/x/anexo.pdf'));
ok('url_recurso no-PDF (audio) nunca es PDF original', !isOriginalPdfOf({ url_recurso: '/uploads/p/a.mp3' }, '/uploads/p/a.mp3'));
ok('url_recurso escapado se compara decodificado', isOriginalPdfOf({ url_recurso: '/uploads/x/mi%20libro.pdf' }, '/uploads/x/mi libro.pdf'));
const stripped = withoutOriginalLocators(strictItem);
ok('withoutOriginalLocators: quita url_recurso PDF y epub_url', !('url_recurso' in stripped) && !('epub_url' in stripped));
ok('… conserva texto e ilustraciones; no muta el original', stripped.texto_plano_url === strictItem.texto_plano_url && stripped.ilustraciones_url && strictItem.url_recurso && strictItem.epub_url);
ok('… standard: mismo objeto', withoutOriginalLocators({ ...strictItem, contentProtectionPolicy: 'standard' }).url_recurso === strictItem.url_recurso);
ok('… estricto con url_recurso de vídeo externo: se conserva', withoutOriginalLocators({ contentProtectionPolicy: 'licensed_strict', url_recurso: 'https://youtu.be/x' }).url_recurso === 'https://youtu.be/x');
const R = nonOriginalReadingRepresentations;
ok('gate: TXT/canónico cuenta', R({ texto_plano_url: '/uploads/a/b.txt' }).includes('texto_plano_url'));
ok('gate: álbum con imágenes cuenta', R({ album_data: [{ imageUrl: '/uploads/a/p1.png' }] }).includes('album_data'));
ok('gate: álbum sin imágenes no cuenta', R({ album_data: [{ text: 'x' }] }).length === 0);
ok('gate: audio/vídeo cuenta', R({ url_recurso: '/uploads/a/e.mp3' }).includes('url_recurso'));
ok('gate: solo PDF → nada', R({ url_recurso: '/uploads/a/b.pdf' }).length === 0);
ok('gate: solo EPUB → nada', R({ epub_url: '/uploads/a/b.epub' }).length === 0);
ok('gate: PDF + EPUB → nada', R({ url_recurso: '/uploads/a/b.pdf', epub_url: '/uploads/a/b.epub' }).length === 0);
ok('legacy: ruta = PDF original estricto', isLicensedStrictOriginalPath('/uploads/x/libro.pdf', [strictItem]) && !isLicensedStrictOriginalPath('/uploads/x/canonical/book.txt', [strictItem]));
{
    const D = UPLOAD_ASSET_DECISION;
    const list = [strictItem, { id: 'y', url_recurso: '/uploads/x/libro.pdf' }];
    const ctx = (viewer, grant) => ({ contentList: list, viewer, seesPedagogy: () => false, canAccessContent: async (_u, id) => grant.includes(id) });
    const reader = { machine: false, user: { id: 'u' }, roles: ['lector'] };
    const v1 = await decideUploadAssetAccess('/uploads/x/libro.pdf', ctx(reader, ['x']));
    ok('decide: estricto + acceso → FORBIDDEN LICENSED_STRICT_ORIGINAL', v1.decision === D.FORBIDDEN && v1.reason === 'LICENSED_STRICT_ORIGINAL', JSON.stringify(v1));
    const v2 = await decideUploadAssetAccess('/uploads/x/libro.pdf', ctx(reader, ['x', 'y']));
    ok('decide: el mismo PDF también es original de un título standard con acceso → AUTHORIZED', v2.decision === D.AUTHORIZED && v2.contentId === 'y');
    const v3 = await decideUploadAssetAccess('/uploads/x/libro.pdf', ctx({ machine: false, user: { id: 'a' }, roles: ['administrador'] }, ['x']));
    ok('decide: administración (gestión) → AUTHORIZED', v3.decision === D.AUTHORIZED);
    const v4 = await decideUploadAssetAccess('/uploads/x/canonical/book.txt', ctx(reader, ['x']));
    ok('decide: texto canónico del estricto → AUTHORIZED', v4.decision === D.AUTHORIZED);
}

// ── Fixture de integración ──────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_cp4a2_'));
const up = path.join(tmp, 'uploads');
const put = (rel, data = `bytes:${rel}`) => { const p = path.join(up, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const EPUB = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(1024, 7)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4096, 1)]);
const U = (rel) => `/uploads/${rel}`;
for (const id of ['c-std', 'c-strict']) {
    put(`${id}/libro.pdf`, PDF); put(`${id}/libro.epub`, EPUB); put(`${id}/canonical/book.txt`, `texto ${id}`);
    put(`${id}/tapa.png`); put(`${id}/ilus.png`); put(`audio/${id}/manifest.json`, '{}');
}
put('c-strict/anexo.pdf', PDF);
put('c-album/p1.png'); put('c-epubonly/libro.epub', EPUB);
put('shared/compartido.pdf', PDF);
put('c-pod/ep.mp3'); put('c-only-pdf/x.pdf', PDF); put('c-corrupt/x.pdf', PDF);

const base = (id, extra) => ({ id, titulo: id, tipo: 'libro', autor: 'A', etiquetas: [], metricas: { veces_leido: 0, calificacion_promedio: 0 }, publico_objetivo: 'todos', status: 'disponible', ...extra });
const full = (id) => ({ url_recurso: U(`${id}/libro.pdf`), epub_url: U(`${id}/libro.epub`), texto_plano_url: U(`${id}/canonical/book.txt`), portada_url: U(`${id}/tapa.png`), ilustraciones_url: [U(`${id}/ilus.png`)] });
const CONTENT = [
    base('c-std', full('c-std')),
    base('c-strict', { ...full('c-strict'), contentProtectionPolicy: 'licensed_strict', mediaAssets: [{ id: 'm1', url: U('c-strict/anexo.pdf') }] }),
    base('c-album', { tipo: 'libro_album', contentProtectionPolicy: 'licensed_strict', album_data: [{ id: 'p1', imageUrl: U('c-album/p1.png') }] }),
    base('c-epubonly', { epub_url: U('c-epubonly/libro.epub') }),
    base('c-sh-strict', { contentProtectionPolicy: 'licensed_strict', url_recurso: U('shared/compartido.pdf'), texto_plano_url: U('c-std/canonical/book.txt') }),
    base('c-sh-std', { url_recurso: U('shared/compartido.pdf') }),
    base('c-corrupt', { contentProtectionPolicy: 'weird', url_recurso: U('c-corrupt/x.pdf'), texto_plano_url: U('c-std/canonical/book.txt') }),
];
const ALL = CONTENT.map(c => c.id);
const USERS = ['ADM:administrador', 'LA:lector', 'L0:lector', 'LS:lector', 'LB:lector'].map(s => {
    const [id, role] = s.split(':');
    return { id, email: `${id.toLowerCase()}@fx.test`, roles: [role], accountStatus: 'active', nombre_completo: id };
});
const ACCESS = [
    { id: 'r-la', scope: 'user', scopeId: 'LA', titleIds: ALL, collectionIds: [] },
    { id: 'r-ls', scope: 'user', scopeId: 'LS', titleIds: ['c-sh-strict'], collectionIds: [] },
    { id: 'r-lb', scope: 'user', scopeId: 'LB', titleIds: ['c-sh-std'], collectionIds: [] },
];
const Pth = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'), access: path.join(tmp, 'access.json'), groups: path.join(tmp, 'groups.json') };
fs.mkdirSync(Pth.data, { recursive: true });
fs.writeFileSync(Pth.users, JSON.stringify(USERS));
fs.writeFileSync(Pth.content, JSON.stringify(CONTENT));
fs.writeFileSync(Pth.access, JSON.stringify(ACCESS));
fs.writeFileSync(Pth.groups, '[]');
fs.writeFileSync(path.join(tmp, 'schools.json'), '[]');
const readContent = () => JSON.parse(fs.readFileSync(Pth.content, 'utf8'));
const listUploads = () => {
    const out = [];
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); e.isDirectory() ? walk(p) : out.push(path.relative(up, p)); } };
    walk(up); return out.filter(f => !f.startsWith(`audio${path.sep}`)).sort().join('|');
};

function spawnApi(port, mode) {
    const env = {
        ...process.env, NODE_ENV: 'test', PORT: String(port),
        CHP_DATA_DIR: Pth.data, USERS_DB: Pth.users, GROUPS_DB: Pth.groups, SCHOOLS_DB: path.join(tmp, 'schools.json'),
        ACCESS_DB: Pth.access, CONTENT_DB: Pth.content, UPLOADS_ROOT: up, ACCESS_FALLBACK_MODE: 'restricted',
        PROGRESS_SQLITE_PATH: path.join(tmp, `progress-${port}.db`),
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), SESSION_AUTH_MODE: 'off',
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    };
    if (mode) env.UPLOADS_AUTHZ_MODE = mode; else delete env.UPLOADS_AUTHZ_MODE;
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child._out = () => out;
    return child;
}
async function waitUp(child) {
    for (let i = 0; i < 300; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child._out().slice(-2000)}`);
        if (/Server running on port/.test(child._out())) return;
        await sleep(200);
    }
    throw new Error(`server no arrancó\n${child._out().slice(-2000)}`);
}
const mk = (port) => {
    const b = `http://127.0.0.1:${port}`;
    const get = async (p, user, headers = {}) => {
        const r = await fetch(`${b}${p}`, { headers: { ...(user ? { 'x-user-id': user } : {}), ...headers } });
        const buf = Buffer.from(await r.arrayBuffer());
        return { status: r.status, headers: r.headers, buf, json: () => JSON.parse(buf.toString() || 'null') };
    };
    const post = async (p, body, user) => {
        const r = await fetch(`${b}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { 'x-user-id': user } : {}) }, body: JSON.stringify(body) });
        let json = null; try { json = await r.json(); } catch { /* sin cuerpo */ }
        return { status: r.status, json };
    };
    const authz = async (uri, user) => (await get('/api/internal/uploads-authz', user, { 'x-original-uri': uri })).status;
    return { get, post, authz };
};

const PORT = 6500 + (process.pid % 80);
const strictApi = spawnApi(PORT, 'strict');
const legacyApi = spawnApi(PORT + 100, null);
const S = mk(PORT), L = mk(PORT + 100);
const byId = (list, id) => list.find(c => c.id === id);

try {
    await waitUp(strictApi);
    await waitUp(legacyApi);

    // ── [1] escritura administrativa ────────────────────────────────────────
    console.log('\n[1] escritura administrativa (POST /api/content)');
    const save = (body, user = 'ADM') => S.post('/api/content', body, user);
    const n1 = await save(base('n-plain', { texto_plano_url: U('c-std/canonical/book.txt') }));
    ok('A. sin campo → 200 y se guarda sin campo (standard por default)', n1.status === 200 && !('contentProtectionPolicy' in byId(readContent(), 'n-plain')), n1.status);
    const n2 = await save(base('n-std', { contentProtectionPolicy: 'standard', url_recurso: U('c-only-pdf/x.pdf') }));
    ok('B. standard explícito → 200 (sin restricción nueva: solo PDF permitido)', n2.status === 200 && byId(readContent(), 'n-std').contentProtectionPolicy === 'standard', n2.status);
    const n3 = await save(base('n-strict', { contentProtectionPolicy: 'licensed_strict', url_recurso: U('c-only-pdf/x.pdf'), texto_plano_url: U('c-std/canonical/book.txt') }));
    ok('C. licensed_strict + TXT → 200 y persistido', n3.status === 200 && byId(readContent(), 'n-strict').contentProtectionPolicy === 'licensed_strict', n3.status);
    const n4 = await save(base('n-bad', { contentProtectionPolicy: 'strict', texto_plano_url: U('c-std/canonical/book.txt') }));
    ok('D. valor inválido → 400 invalid_content_protection_policy', n4.status === 400 && n4.json?.code === 'invalid_content_protection_policy', `${n4.status} ${JSON.stringify(n4.json)}`);
    ok('D. … no se persiste nada', !byId(readContent(), 'n-bad'));
    await sleep(2100); // lock de idempotencia de POST /api/content (2 s por actor+id)
    const upd = { ...byId(readContent(), 'n-strict'), titulo: 'n-strict editado' };
    delete upd.contentProtectionPolicy;
    const n5 = await save(upd);
    ok('F. RMW: update sin el campo conserva licensed_strict', n5.status === 200 && byId(readContent(), 'n-strict').contentProtectionPolicy === 'licensed_strict' && byId(readContent(), 'n-strict').titulo === 'n-strict editado');
    await sleep(2100);
    const n6 = await save({ ...byId(readContent(), 'n-strict'), contentProtectionPolicy: null });
    ok('null en escritura → standard (cambio explícito del administrador)', n6.status === 200 && byId(readContent(), 'n-strict').contentProtectionPolicy === 'standard');
    ok('no administrador → 403 (contrato administrativo existente)', (await save(base('n-la', { contentProtectionPolicy: 'licensed_strict', texto_plano_url: U('c-std/canonical/book.txt') }), 'LA')).status === 403);
    ok('E. históricos sin campo intactos (c-std, c-epubonly)', !('contentProtectionPolicy' in byId(readContent(), 'c-std')) && !('contentProtectionPolicy' in byId(readContent(), 'c-epubonly')));

    console.log('\n[1b] gate de publicación licensed_strict');
    const filesBefore = listUploads();
    const g1 = await save(base('g-pdf', { contentProtectionPolicy: 'licensed_strict', url_recurso: U('c-only-pdf/x.pdf') }));
    ok('B. strict + solo PDF → 422 licensed_strict_requires_reading', g1.status === 422 && g1.json?.code === 'licensed_strict_requires_reading', `${g1.status} ${JSON.stringify(g1.json)}`);
    ok('… mensaje claro para administración', /lectura/.test(g1.json?.error || ''));
    const g2 = await save({ ...byId(readContent(), 'c-epubonly'), contentProtectionPolicy: 'licensed_strict' });
    ok('C. strict + solo EPUB (edición adjunta, sin texto) → 422', g2.status === 422, `${g2.status} ${JSON.stringify(g2.json)}`);
    ok('… c-epubonly sigue standard', !('contentProtectionPolicy' in byId(readContent(), 'c-epubonly')));
    ok('los rechazos del gate no tocan ficheros', listUploads() === filesBefore);
    const g3 = await save(base('g-album', { tipo: 'libro_album', contentProtectionPolicy: 'licensed_strict', album_data: [{ id: 'p1', imageUrl: U('c-album/p1.png'), regions: [] }] }));
    ok('D. strict + Álbum con imágenes → 200', g3.status === 200, `${g3.status} ${JSON.stringify(g3.json)}`);
    const g4 = await save(base('g-pod', { tipo: 'podcast', contentProtectionPolicy: 'licensed_strict', url_recurso: U('c-pod/ep.mp3') }));
    ok('strict + audio → 200 (audio no es original PDF/EPUB)', g4.status === 200);
    const g5 = await save(base('g-canon', { contentProtectionPolicy: 'licensed_strict', url_recurso: U('c-only-pdf/x.pdf'), texto_plano_url: U('c-strict/canonical/book.txt') }));
    ok('A. strict + canónico + PDF → 200', g5.status === 200);
    ok('E. standard + solo PDF → 200 (B arriba) — sin restricción nueva', n2.status === 200);

    // ── [2] catálogo ────────────────────────────────────────────────────────
    console.log('\n[2] catálogo (GET /api/content)');
    const cat = async (u) => (await S.get('/api/content', u)).json();
    const la = await cat('LA');
    const laStd = byId(la, 'c-std'), laStrict = byId(la, 'c-strict');
    ok('STANDARD autorizado: url_recurso y epub_url presentes', laStd.url_recurso === U('c-std/libro.pdf') && laStd.epub_url === U('c-std/libro.epub'));
    ok('STRICT autorizado: sin url_recurso PDF ni epub_url', !('url_recurso' in laStrict) && !('epub_url' in laStrict));
    ok('STRICT autorizado: texto canónico, ilustraciones, mediaAssets y portada presentes', laStrict.texto_plano_url === U('c-strict/canonical/book.txt') && laStrict.ilustraciones_url?.length === 1 && laStrict.mediaAssets?.length === 1 && laStrict.portada_url);
    ok('STRICT autorizado: el campo de política viaja (metadata)', laStrict.contentProtectionPolicy === 'licensed_strict');
    ok('Álbum strict autorizado: album_data intacto', byId(la, 'c-album').album_data?.length === 1);
    ok('valor corrupto → tratado como estricto (sin url_recurso)', !('url_recurso' in byId(la, 'c-corrupt')));
    const l0 = await cat('L0');
    ok('sin acceso: contrato R2 intacto (sin localizadores, standard y strict)', ['c-std', 'c-strict'].every(id => { const c = byId(l0, id); return !('url_recurso' in c) && !('epub_url' in c) && !('texto_plano_url' in c) && c.portada_url; }));
    const adm = await cat('ADM');
    ok('administración: registro íntegro (gestión)', byId(adm, 'c-strict').url_recurso === U('c-strict/libro.pdf') && byId(adm, 'c-strict').epub_url === U('c-strict/libro.epub'));

    // ── [3] /uploads estricto ───────────────────────────────────────────────
    console.log('\n[3] /uploads en modo estricto (Node + edge)');
    const st = async (rel, u, h) => (await S.get(U(rel), u, h)).status;
    ok('STANDARD + acceso: PDF original 200', await st('c-std/libro.pdf', 'LA') === 200);
    ok('STANDARD + acceso: Range → 206', await st('c-std/libro.pdf', 'LA', { range: 'bytes=0-99' }) === 206);
    ok('STANDARD sin acceso: 403', await st('c-std/libro.pdf', 'L0') === 403);
    ok('sin sesión: 401', await st('c-std/libro.pdf', null) === 401);
    ok('STRICT + acceso: PDF original 403', await st('c-strict/libro.pdf', 'LA') === 403);
    ok('STRICT + acceso: PDF original con Range → 403', await st('c-strict/libro.pdf', 'LA', { range: 'bytes=0-99' }) === 403);
    ok('STRICT + acceso: ruta escapada / mayúsculas no esquivan (403/404, nunca 200)', ![await st('c-strict/libro%2Epdf', 'LA'), await st('c-strict//libro.pdf', 'LA')].includes(200));
    ok('STRICT sin acceso: 403', await st('c-strict/libro.pdf', 'L0') === 403);
    ok('STRICT + acceso: texto canónico 200', await st('c-strict/canonical/book.txt', 'LA') === 200);
    ok('STRICT + acceso: TTS manifest 200', await st('audio/c-strict/manifest.json', 'LA') === 200);
    ok('STRICT + acceso: ilustración 200', await st('c-strict/ilus.png', 'LA') === 200);
    ok('STRICT + acceso: otro PDF del título (no original) 200 — sin bloqueo por patrón', await st('c-strict/anexo.pdf', 'LA') === 200);
    ok('STRICT Álbum + acceso: página 200', await st('c-album/p1.png', 'LA') === 200);
    ok('STRICT: administración 200 (gestión)', await st('c-strict/libro.pdf', 'ADM') === 200);
    ok('PDF compartido: solo derecho al título strict → 403', await st('shared/compartido.pdf', 'LS') === 403);
    ok('PDF compartido: derecho al título standard → 200', await st('shared/compartido.pdf', 'LB') === 200);
    ok('raw .epub sigue 403 (standard y strict, también admin)', await st('c-std/libro.epub', 'LA') === 403 && await st('c-strict/libro.epub', 'ADM') === 403);
    ok('edge: STRICT PDF original + acceso → 403', await S.authz(U('c-strict/libro.pdf'), 'LA') === 403);
    ok('edge: STANDARD PDF + acceso → 204', await S.authz(U('c-std/libro.pdf'), 'LA') === 204);
    ok('edge: STRICT texto canónico + acceso → 204', await S.authz(U('c-strict/canonical/book.txt'), 'LA') === 204);
    ok('edge: STRICT sin sesión → 401', await S.authz(U('c-strict/libro.pdf'), null) === 401);
    ok('log del veredicto estricto', /LICENSED_STRICT_ORIGINAL contentId=c-strict user=LA/.test(strictApi._out()));

    // ── [4] EPUB ────────────────────────────────────────────────────────────
    console.log('\n[4] GET /api/content/:id/epub');
    const ep = (id, u) => S.get(`/api/content/${id}/epub`, u);
    const e1 = await ep('c-std', 'LA');
    ok('STANDARD + acceso → 200 con los bytes', e1.status === 200 && e1.buf.equals(EPUB));
    ok('STANDARD sin acceso → 403', (await ep('c-std', 'L0')).status === 403);
    const e3 = await ep('c-strict', 'LA');
    ok('STRICT + acceso → 403 original_not_licensed', e3.status === 403 && e3.json()?.code === 'original_not_licensed', `${e3.status} ${e3.buf}`);
    ok('… sin bytes del EPUB en la respuesta', !e3.buf.includes(Buffer.from('PK\x03\x04')));
    const e4 = await ep('c-strict', 'L0');
    ok('STRICT sin acceso → 403 (misma respuesta de acceso de siempre, no revela la política)', e4.status === 403 && !e4.json()?.code);
    ok('STRICT: administración → 200 (gestión)', (await ep('c-strict', 'ADM')).status === 200);
    ok('sin sesión → 401', (await ep('c-strict', null)).status === 401);

    // ── [5] legacy ──────────────────────────────────────────────────────────
    console.log('\n[5] /uploads en modo legacy');
    ok('legacy: STRICT PDF original → 403 (Node)', (await L.get(U('c-strict/libro.pdf'), null)).status === 403);
    ok('legacy: STRICT PDF original → 403 (edge)', await L.authz(U('c-strict/libro.pdf'), null) === 403);
    ok('legacy: STANDARD PDF → 200 / 204 como antes', (await L.get(U('c-std/libro.pdf'), null)).status === 200 && await L.authz(U('c-std/libro.pdf'), null) === 204);
    ok('legacy: STRICT texto canónico → 200 / 204', (await L.get(U('c-strict/canonical/book.txt'), null)).status === 200 && await L.authz(U('c-strict/canonical/book.txt'), null) === 204);
    ok('legacy: PDF compartido con un título strict → 403 (fail-closed: legacy no resuelve derechos)', (await L.get(U('shared/compartido.pdf'), null)).status === 403);

    // ── [6] rendimiento ─────────────────────────────────────────────────────
    console.log('\n[6] rendimiento del catálogo');
    const src = fs.readFileSync(path.join(REPO, 'server/server.js'), 'utf8');
    const fn = src.slice(src.indexOf('async function catalogForViewer'), src.indexOf("app.get('/api/content', libraryViewNoStore"));
    ok('catalogForViewer: una sola fuente de stores (snapshot por request), sin readJSON directo', (fn.match(/createRequestStoreReader\(\)/g) || []).length === 1 && !/readJSON\(/.test(fn));
    const acc = fs.readFileSync(path.join(REPO, 'server/accessService.js'), 'utf8');
    const pol = acc.slice(acc.indexOf('CP-4A2 — POLÍTICA DE ORIGINALES'), acc.indexOf('LICENSED_STRICT_NO_READING_MESSAGE ='));
    ok('helpers de política puros (sin stores ni E/S)', pol.length > 0 && !/readJSON|readStore|fs\.|fetch\(/.test(pol));
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) await S.get('/api/content', 'LA');
    const ms = (performance.now() - t0) / 20;
    ok(`catálogo de lector: ${ms.toFixed(1)} ms/req (fixture pequeño; la regresión de stores la cubre catalogAccessPerformance)`, ms < 500);

    // ── [7] front ───────────────────────────────────────────────────────────
    console.log('\n[7] front (estructural)');
    if (!fs.existsSync(path.join(REPO, 'pages'))) throw Object.assign(new Error('sin front'), { skipFront: true });
    const rd = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');
    const sc = rd('pages/SubirContenido.tsx');
    ok('admin: control «Protección del contenido» con Estándar / Licencia estricta',
        sc.includes('Protección del contenido') && sc.includes('<option value="standard">Estándar</option>') && sc.includes('<option value="licensed_strict">Licencia estricta</option>'));
    ok('admin: textos sin lenguaje técnico',
        sc.includes('Estándar: permite las representaciones originales disponibles.')
        && sc.includes('Licencia estricta: permite la lectura en Chibalete+, pero bloquea la entrega de PDF y EPUB originales.')
        && !/DRM|licensed_strict<\/|403/.test(sc.slice(sc.indexOf('sc-proteccion'), sc.indexOf('sc-proteccion-help') + 400)));
    ok('admin: carga el valor guardado y lo envía en el payload',
        sc.includes("contentProtectionPolicy: content.contentProtectionPolicy === 'licensed_strict' ? 'licensed_strict' : 'standard'")
        && sc.includes('contentProtectionPolicy: mainContent.contentProtectionPolicy,'));
    const det = rd('pages/PaginaDetalleLibro.tsx');
    ok('Detalle: modo PDF depende de url_recurso (ausente en strict → sin botón)', /content\.tipo !== 'libro_album' && content\.url_recurso && \(/.test(det));
    ok('Detalle: EPUB original depende de epub_url (hasEpubOriginal)', det.includes('{hasEpubOriginal(content) && ('));
    ok('Detalle: modos derivados siguen dependiendo de texto_plano_url', (det.match(/texto_plano_url/g) || []).length >= 2);
    ok('ReaderModeSelector: PDF por presencia de url_recurso', rd('components/ReaderModeSelector.tsx').includes('{content.url_recurso && ('));
    ok('sin marca de agua ni banners nuevos', !/watermark|licensed_strict/i.test(det) && !/licensed_strict/.test(rd('pages/VisorTexto.tsx') + rd('pages/VisorAccesible.tsx') + rd('pages/VisorInmersivo.tsx')));
} catch (e) {
    // Imagen API (sin pages/): la sección [7] se declara omitida, nunca verde.
    if (e.skipFront) console.log('  SKIP [7]: árbol sin front (imagen API). Corre en CI con el repo completo.');
    else ok('arnés de servidores', false, e.stack || e.message);
} finally {
    strictApi.kill();
    legacyApi.kill();
    await sleep(400);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\ncontentProtectionPolicy — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
