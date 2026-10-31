/**
 * contentGlobalReadOnlyPolicy.test.mjs
 * CHP-CONTENT-PROTECTION-2026-01 CP-4D — política global de solo lectura.
 *
 * Decisión editorial: TODOS los contenidos reciben la MISMA protección,
 * sin importar editorial, autor, licencia o procedencia. El servidor decide
 * solo «¿puede este usuario leer este título?»: si sí, entrega los recursos
 * que necesitan los modos de lectura (PDF.js, Foliate, texto, álbum,
 * audio…); si no, deniega. No hay clasificación por título
 * (`contentProtectionPolicy` quedó DEPRECATED: un valor histórico no cambia
 * nada) y no hay descarga como función de producto.
 *
 *   [0] sin política por título en el código
 *   [1] catálogo
 *   [2] /uploads (modo estricto: Node + autorizador del edge)
 *   [3] GET /api/content/:id/epub (lector autorizado)
 *   [4] modo legacy: sin diferencias por título
 *   [5] escritura administrativa: el campo histórico es inerte
 *   [6] front: sin selector, sin descargas, modos de lectura con nombre de lectura
 *
 * SESSION_AUTH_MODE=off (x-user-id): corre también en Windows. Stores en un
 * directorio temporal; 0 lecturas/escrituras de stores reales.
 *
 *   node server/__test__/contentGlobalReadOnlyPolicy.test.mjs
 */
import './helpers/testMode.mjs';
import { freePorts } from './helpers/freePort.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as accessService from '../accessService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const strip = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

// ── [0] sin política por título ─────────────────────────────────────────────
console.log('[0] sin política por título en el código');
const exported = Object.keys(accessService);
ok('accessService no exporta helpers de licensed_strict',
    !exported.some(k => /licensed|strict.*original|ProtectionPolic|withoutOriginal|nonOriginal|isOriginalPdf/i.test(k)), exported.join(','));
const serverSrc = strip(read('server/server.js'));
ok('server.js no lee contentProtectionPolicy ni licensed_strict', !/contentProtectionPolicy|licensed_strict|original_not_licensed/.test(serverSrc));
ok('accessService.js no lee contentProtectionPolicy ni licensed_strict', !/contentProtectionPolicy|licensed_strict|LICENSED_STRICT/.test(strip(read('server/accessService.js'))));
const cat = serverSrc.slice(serverSrc.indexOf('async function catalogForViewer'), serverSrc.indexOf("app.get('/api/content', libraryViewNoStore"));
ok('catálogo: con acceso → registro íntegro; sin acceso → sin localizadores (R2)', cat.includes('out.push(allowed ? item : withoutEditorialLocators(item));'));
ok('catálogo: un solo snapshot de stores por request, sin readJSON por título',
    (cat.match(/createRequestStoreReader\(\)/g) || []).length === 1 && !/readJSON\(/.test(cat));

// ── Fixture ─────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_cp4d_'));
const up = path.join(tmp, 'uploads');
const put = (rel, data = `bytes:${rel}`) => { const p = path.join(up, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const EPUB = Buffer.concat([Buffer.from('PK\x03\x04'), Buffer.alloc(1024, 7)]);
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(4096, 1)]);
const U = (rel) => `/uploads/${rel}`;
for (const id of ['c-own', 'c-legacy']) {
    put(`${id}/libro.pdf`, PDF); put(`${id}/libro.epub`, EPUB); put(`${id}/canonical/book.txt`, `texto ${id}`);
    put(`${id}/tapa.png`); put(`${id}/ilus.png`); put(`audio/${id}/manifest.json`, '{}');
}
put('c-album/p1.png'); put('c-pod/ep.mp3');
const base = (id, extra) => ({ id, titulo: id, tipo: 'libro', autor: 'A', etiquetas: [], metricas: { veces_leido: 0, calificacion_promedio: 0 }, publico_objetivo: 'todos', status: 'disponible', ...extra });
const full = (id) => ({ url_recurso: U(`${id}/libro.pdf`), epub_url: U(`${id}/libro.epub`), texto_plano_url: U(`${id}/canonical/book.txt`), portada_url: U(`${id}/tapa.png`), ilustraciones_url: [U(`${id}/ilus.png`)] });
const CONTENT = [
    base('c-own', full('c-own')),
    // Registro histórico con el campo deprecado: NO cambia su protección.
    base('c-legacy', { ...full('c-legacy'), contentProtectionPolicy: 'licensed_strict' }),
    base('c-album', { tipo: 'libro_album', album_data: [{ id: 'p1', imageUrl: U('c-album/p1.png'), regions: [] }] }),
    base('c-pod', { tipo: 'podcast', url_recurso: U('c-pod/ep.mp3') }),
];
const USERS = ['ADM:administrador', 'LA:lector', 'L0:lector'].map(s => {
    const [id, role] = s.split(':');
    return { id, email: `${id.toLowerCase()}@fx.test`, roles: [role], accountStatus: 'active', nombre_completo: id };
});
const ACCESS = [{ id: 'r-la', scope: 'user', scopeId: 'LA', titleIds: CONTENT.map(c => c.id), collectionIds: [] }];
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'), access: path.join(tmp, 'access.json'), groups: path.join(tmp, 'groups.json') };
fs.mkdirSync(P.data, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.content, JSON.stringify(CONTENT));
fs.writeFileSync(P.access, JSON.stringify(ACCESS));
fs.writeFileSync(P.groups, '[]');
fs.writeFileSync(path.join(tmp, 'schools.json'), '[]');
const readContent = () => JSON.parse(fs.readFileSync(P.content, 'utf8'));

function spawnApi(port, mode) {
    const env = {
        ...process.env, NODE_ENV: 'test', PORT: String(port),
        CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: path.join(tmp, 'schools.json'),
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: up, ACCESS_FALLBACK_MODE: 'restricted',
        PROGRESS_SQLITE_PATH: path.join(tmp, `progress-${port}.db`),
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), ROYALTIES_DB: path.join(tmp, 'royalties.db'), SESSION_AUTH_MODE: 'off',
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
        return { status: r.status, buf, json: () => JSON.parse(buf.toString() || 'null') };
    };
    const post = async (p, body, user) => {
        const r = await fetch(`${b}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...(user ? { 'x-user-id': user } : {}) }, body: JSON.stringify(body) });
        let json = null; try { json = await r.json(); } catch { /* sin cuerpo */ }
        return { status: r.status, json };
    };
    const authz = async (uri, user) => (await get('/api/internal/uploads-authz', user, { 'x-original-uri': uri })).status;
    return { get, post, authz };
};

const [PORT, PORT_LEGACY] = await freePorts(2);
const strictApi = spawnApi(PORT, 'strict');
const legacyApi = spawnApi(PORT_LEGACY, null);
const S = mk(PORT), L = mk(PORT_LEGACY);
const byId = (list, id) => list.find(c => c.id === id);

try {
    await waitUp(strictApi);
    await waitUp(legacyApi);

    // ── [1] catálogo ────────────────────────────────────────────────────────
    console.log('\n[1] catálogo');
    const la = (await S.get('/api/content', 'LA')).json();
    for (const id of ['c-own', 'c-legacy']) {
        const c = byId(la, id);
        ok(`${id}: lector autorizado recibe los recursos de todos los modos (PDF, EPUB, texto, ilustraciones)`,
            c.url_recurso === U(`${id}/libro.pdf`) && c.epub_url === U(`${id}/libro.epub`) && c.texto_plano_url && c.ilustraciones_url?.length === 1);
    }
    ok('álbum y podcast autorizados: recursos presentes', byId(la, 'c-album').album_data?.length === 1 && byId(la, 'c-pod').url_recurso === U('c-pod/ep.mp3'));
    const l0 = (await S.get('/api/content', 'L0')).json();
    ok('sin acceso: R2 intacto (sin localizadores, solo metadata + portada)', ['c-own', 'c-legacy'].every(id => {
        const c = byId(l0, id); return !('url_recurso' in c) && !('epub_url' in c) && !('texto_plano_url' in c) && !('ilustraciones_url' in c) && c.portada_url;
    }));
    ok('administración: registros íntegros', byId((await S.get('/api/content', 'ADM')).json(), 'c-legacy').url_recurso === U('c-legacy/libro.pdf'));

    // ── [2] /uploads estricto ───────────────────────────────────────────────
    console.log('\n[2] /uploads (estricto)');
    const st = async (rel, u, h) => (await S.get(U(rel), u, h)).status;
    for (const id of ['c-own', 'c-legacy']) {
        ok(`${id}: PDF autorizado 200 y Range 206 (visor PDF.js)`, await st(`${id}/libro.pdf`, 'LA') === 200 && await st(`${id}/libro.pdf`, 'LA', { range: 'bytes=0-99' }) === 206);
        ok(`${id}: texto, TTS e ilustración autorizados 200`, await st(`${id}/canonical/book.txt`, 'LA') === 200 && await st(`audio/${id}/manifest.json`, 'LA') === 200 && await st(`${id}/ilus.png`, 'LA') === 200);
        ok(`${id}: sin acceso 403 · sin sesión 401`, await st(`${id}/libro.pdf`, 'L0') === 403 && await st(`${id}/libro.pdf`, null) === 401);
        ok(`${id}: EPUB crudo 403 para todos (también administración)`, await st(`${id}/libro.epub`, 'LA') === 403 && await st(`${id}/libro.epub`, 'ADM') === 403 && await st(`${id}/libro.epub`, null) === 403);
        ok(`${id}: edge — PDF autorizado 204, sin acceso 403, sin sesión 401`,
            await S.authz(U(`${id}/libro.pdf`), 'LA') === 204 && await S.authz(U(`${id}/libro.pdf`), 'L0') === 403 && await S.authz(U(`${id}/libro.pdf`), null) === 401);
    }
    ok('álbum y podcast autorizados 200; sin acceso 403', await st('c-album/p1.png', 'LA') === 200 && await st('c-pod/ep.mp3', 'LA') === 200 && await st('c-album/p1.png', 'L0') === 403);
    ok('ningún veredicto por política de título en el log', !/LICENSED_STRICT/.test(strictApi._out()));

    // ── [3] EPUB ────────────────────────────────────────────────────────────
    console.log('\n[3] GET /api/content/:id/epub');
    for (const id of ['c-own', 'c-legacy']) {
        const e = await S.get(`/api/content/${id}/epub`, 'LA');
        ok(`${id}: lector autorizado 200 (Foliate)`, e.status === 200 && e.buf.equals(EPUB), e.status);
        ok(`${id}: sin acceso 403 · sin sesión 401`, (await S.get(`/api/content/${id}/epub`, 'L0')).status === 403 && (await S.get(`/api/content/${id}/epub`, null)).status === 401);
    }

    // ── [4] legacy ──────────────────────────────────────────────────────────
    console.log('\n[4] modo legacy: misma respuesta para todos los títulos');
    const lg = async (rel) => [(await L.get(U(rel), null)).status, await L.authz(U(rel), null)].join('/');
    ok('c-own y c-legacy: PDF con la misma respuesta', await lg('c-own/libro.pdf') === await lg('c-legacy/libro.pdf'), `${await lg('c-own/libro.pdf')} vs ${await lg('c-legacy/libro.pdf')}`);
    ok('EPUB crudo 403 en legacy', (await L.get(U('c-legacy/libro.epub'), null)).status === 403);

    // ── [5] escritura administrativa ────────────────────────────────────────
    console.log('\n[5] escritura administrativa: el campo histórico es inerte');
    const w1 = await S.post('/api/content', base('n-any', { contentProtectionPolicy: 'cualquier-cosa', url_recurso: U('c-own/libro.pdf'), publisherId: 'pub-chibalete-editores' /* F1-B */ }), 'ADM');
    ok('sin validación ni gate por política (200; no 400/422)', w1.status === 200, `${w1.status} ${JSON.stringify(w1.json)}`);
    ok('no administrador sigue 403', (await S.post('/api/content', base('n-la', {}), 'LA')).status === 403);
    ok('los registros existentes no se migran', byId(readContent(), 'c-legacy').contentProtectionPolicy === 'licensed_strict' && !('contentProtectionPolicy' in byId(readContent(), 'c-own')));

    // ── [6] front ───────────────────────────────────────────────────────────
    console.log('\n[6] front (estructural)');
    if (!fs.existsSync(path.join(REPO, 'pages'))) throw Object.assign(new Error('sin front'), { skipFront: true });
    const sc = read('pages/SubirContenido.tsx');
    ok('admin: sin selector «Protección del contenido» ni campo por título', !/Protección del contenido|sc-proteccion|contentProtectionPolicy|Licencia estricta/.test(sc));
    ok('tipos: Content sin contentProtectionPolicy', !/contentProtectionPolicy/.test(read('types/index.ts')));
    const det = read('pages/PaginaDetalleLibro.tsx');
    ok('Detalle: «Leer en PDF» y «Leer EPUB» (modos de lectura)', det.includes('<Book size={16}/> Leer en PDF') && det.includes('<BookOpen size={16}/> Leer EPUB'));
    ok('Detalle: sin «Ver … original»', !/Ver (PDF|EPUB) [Oo]riginal/.test(det));
    ok('ayuda admin EPUB ilustrado: nombra «Leer EPUB», no «Ver EPUB original»', read('utils/epubAdmin.mjs').includes('«Leer EPUB»') && !/Ver (PDF|EPUB) [Oo]riginal/.test(read('utils/epubAdmin.mjs')));
    const READER = ['pages/PaginaDetalleLibro.tsx', 'pages/VisorTexto.tsx', 'pages/VisorAccesible.tsx', 'pages/VisorInmersivo.tsx', 'pages/VisorPDF.tsx',
        'pages/VisorAlbum.tsx', 'pages/VisorAudio.tsx', 'pages/VisorVideo.tsx', 'components/GaleriaIlustraciones.tsx', 'pages/Experiencias.tsx',
        'components/ContentRouter.tsx', 'components/ReaderModeSelector.tsx', 'components/ImmersiveShell.tsx',
        'components/epub-reader/EpubReaderApp.tsx', 'components/epub-reader/ChibaleteEpubReader.tsx', 'components/epub-reader/EpubReaderToolbar.tsx'];
    const AFFORDANCE = /\bdownload=|\.download\s*=|setAttribute\(\s*['"]download|Descargar|Descarga |Guardar archivo|Exportar|>\s*Download\s*</;
    const offenders = READER.filter(f => AFFORDANCE.test(strip(read(f))));
    ok('superficies de lectura: 0 controles o enlaces de descarga', offenders.length === 0, offenders.join(', '));
    ok('MOOK: transcripción en la página, sin descarga', read('pages/Experiencias.tsx').includes('Ver transcripción') && !read('pages/Experiencias.tsx').includes('Descargar transcripción'));
    ok('ningún href del front apunta a /uploads/*.pdf|.epub', !READER.some(f => /href=\{?[`'"][^`'"]*\/uploads\/[^`'"]*\.(pdf|epub)/i.test(read(f))));
} catch (e) {
    if (e.skipFront) console.log('  SKIP [6]: árbol sin front (imagen API). Corre en CI con el repo completo.');
    else ok('arnés de servidores', false, e.stack || e.message);
} finally {
    strictApi.kill();
    legacyApi.kill();
    await sleep(400);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\ncontentGlobalReadOnlyPolicy — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
