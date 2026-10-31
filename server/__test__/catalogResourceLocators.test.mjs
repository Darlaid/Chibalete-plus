/**
 * catalogResourceLocators.test.mjs — CHP-CONTENT-PROTECTION-2026-01 CP-3 (R2/R7).
 *
 * GET /api/content conserva la metadata pública de todo el catálogo visible,
 * pero los localizadores editoriales (/uploads, salvo portada) de un título
 * solo viajan a quien tiene acceso a ese título (decideContentAccess; pedagogía
 * por rol, igual que el autorizador estricto de /uploads). Además: la
 * respuesta es no-store y el logout devuelve Clear-Site-Data "cache".
 *
 * [U] unidad (cualquier plataforma): withoutEditorialLocators.
 * [A–H] integración: server.js REAL sobre stores temporales, sesión enforce.
 * Nunca toca data/ ni la red.
 *
 *   node server/__test__/catalogResourceLocators.test.mjs
 */
import './helpers/testMode.mjs';
import { freePort } from './helpers/freePort.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { withoutEditorialLocators } from '../accessService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const U = (rel) => `/uploads/${rel}`;
const hasUploads = (v) => JSON.stringify(v).includes('/uploads/');

const B = {
    id: 'content-B', titulo: 'Libro B', autor: 'Autora B', tipo: 'libro', descripcion: 'Promo B',
    etiquetas: ['aventura'], portada_url: U('content-B/tapa.jpg'),
    texto_plano_url: U('content-B/libro.txt'), texto_ingles_url: U('content-B/libro-en.txt'),
    texto_portugues_url: U('content-B/libro-pt.txt'), url_recurso: U('content-B/libro.pdf'),
    epub_url: U('content-B/libro.epub'), canonicalBookUrl: U('content-B/canonical/book.json'),
    ilustraciones_url: [U('content-B/ilu-1.png')],
    album_data: [{ id: 'p1', imageUrl: U('content-B/pagina-1.jpg'), ambientAudioUrl: U('content-B/amb.mp3'),
                   regions: [{ action: { type: 'audio', audioUrl: U('content-B/region.mp3') } }] }],
    mediaAssets: [{ id: 'm1', type: 'audio', url: U('content-B/asset.mp3') }],
    metricas: { lecturas: 3 }, standalone: true,
};

// ── [U] unidad ──────────────────────────────────────────────────────────────
console.log('\n[U] withoutEditorialLocators');
{
    const out = withoutEditorialLocators(B);
    ok('conserva metadata pública', ['id', 'titulo', 'autor', 'tipo', 'descripcion', 'etiquetas', 'metricas', 'standalone']
        .every(k => JSON.stringify(out[k]) === JSON.stringify(B[k])));
    ok('conserva la portada', out.portada_url === B.portada_url);
    ok('omite todos los localizadores editoriales', ['texto_plano_url', 'texto_ingles_url', 'texto_portugues_url', 'url_recurso',
        'epub_url', 'canonicalBookUrl', 'ilustraciones_url', 'album_data', 'mediaAssets'].every(k => !(k in out)));
    ok('ninguna ruta /uploads salvo la portada', !hasUploads({ ...out, portada_url: null }));
    ok('no muta el original', B.texto_plano_url === U('content-B/libro.txt') && Array.isArray(B.album_data));
    const ext = withoutEditorialLocators({ id: 'v', url_recurso: 'https://www.youtube.com/watch?v=x', portada_url: 'https://cdn.x/c.jpg' });
    ok('URLs externas (no son bytes de Chibalete+) se conservan', ext.url_recurso === 'https://www.youtube.com/watch?v=x' && ext.portada_url === 'https://cdn.x/c.jpg');
    const abs = withoutEditorialLocators({ id: 'a', texto_plano_url: 'https://chibaleteplus.example/uploads/a/x.txt?v=2' });
    ok('URL absoluta a /uploads también se omite', !('texto_plano_url' in abs));
}

// ── Integración ─────────────────────────────────────────────────────────────
// La sesión firmada exige semántica POSIX (server/lib/secretFile.js): en
// Windows se declara la omisión, nunca un verde.
if (typeof process.getuid !== 'function') {
    console.log('\ncatalogResourceLocators [A–H] — SKIP: requiere plataforma POSIX (sesión firmada). Ejecutar en Linux/CI.');
    console.log(`\n${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_catalog_locators_'));
const up = path.join(tmp, 'uploads');
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(up, { recursive: true });

const CONTENT = [
    { id: 'content-A', titulo: 'Libro A', autor: 'Autor A', tipo: 'libro', portada_url: U('content-A/tapa.jpg'),
      texto_plano_url: U('content-A/libro.txt'), url_recurso: U('content-A/libro.pdf'), epub_url: U('content-A/libro.epub'),
      ilustraciones_url: [U('content-A/ilu.png')], album_data: [{ imageUrl: U('content-A/p1.jpg') }] },
    B,
    { id: 'content-S1', titulo: 'Comparte 1', autor: 'S1', tipo: 'libro', url_recurso: U('content-S1/compartido.pdf') },
    { id: 'content-S2', titulo: 'Comparte 2', autor: 'S2', tipo: 'libro', url_recurso: U('content-S1/compartido.pdf'),
      portada_url: U('content-S2/tapa.jpg') },
    { id: 'content-V', titulo: 'Video externo', tipo: 'video', url_recurso: 'https://www.youtube.com/watch?v=abc' },
    { id: 'content-AL', titulo: 'Álbum', tipo: 'libro_album', portada_url: U('content-AL/p1.jpg'),
      album_data: [{ imageUrl: U('content-AL/p1.jpg') }, { imageUrl: U('content-AL/p2.jpg') }] },
    { id: 'content-P', titulo: 'Guía', tipo: 'guia', url_recurso: U('content-P/guia.pdf'), portada_url: U('content-P/tapa.jpg') },
    { id: 'content-E', titulo: 'Nodo MOOK', tipo: 'articulo_pedagogico', standalone: false, texto_plano_url: U('content-E/nodo.txt') },
];
const PW = 'fixture-pass-cp3';
const hash = bcrypt.hashSync(PW, 4);
const USERS = ['ADM:administrador', 'MED:mediador', 'LA:lector', 'L0:lector'].map(s => {
    const [id, role] = s.split(':');
    return { id, email: `${id.toLowerCase()}@fx.test`, password: hash, roles: [role], accountStatus: 'active', nombre_completo: id };
});
const ACCESS = [{ id: 'r-la', scope: 'user', scopeId: 'LA', titleIds: ['content-A', 'content-S1', 'content-E'], collectionIds: [] }];
const P = {
    users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), progress: path.join(tmp, 'progress_db.json'),
    identity: path.join(tmp, 'identity.db'), offline: path.join(tmp, 'offline.db'), sessions: path.join(tmp, 'sessions.db'),
    key: path.join(tmp, 'session_signing_key'),
};
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.groups, '[]');
fs.writeFileSync(P.schools, '[]');
fs.writeFileSync(P.access, JSON.stringify(ACCESS));
fs.writeFileSync(P.content, JSON.stringify(CONTENT));
fs.writeFileSync(P.progress, JSON.stringify({ progressMap: {} }));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'));
fs.chmodSync(P.key, 0o400);

function spawnApi(port) {
    const env = {
        ...process.env, NODE_ENV: 'test', PORT: String(port),
        CHP_DATA_DIR: dataDir, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: up, ACCESS_FALLBACK_MODE: 'restricted',
        OFFLINE_ASSIGNMENT_DB_PATH: P.offline, USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
        IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DUAL_WRITE: '1', IDENTITY_READ: 'json',
        SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key, SESSION_AUTH_MODE: 'enforce',
        UPLOADS_AUTHZ_MODE: 'strict',
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    };
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env });
    let log = '';
    child.stdout.on('data', d => { log += d; });
    child.stderr.on('data', d => { log += d; });
    child._log = () => log;
    return child;
}
async function waitHealthy(base, child) {
    for (let i = 0; i < 400; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child._log().slice(-2000)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
        await sleep(300);
    }
    throw new Error(`never healthy\n${child._log().slice(-2000)}`);
}
async function login(base, id) {
    const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${id.toLowerCase()}@fx.test`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id} → ${r.status}`);
    return `chp_session=${m[1]}`;
}

const PORT = await freePort();
const base = `http://127.0.0.1:${PORT}`;
let api;
const C = {};
const catalog = async (who) => {
    const r = await fetch(`${base}/api/content`, { headers: who ? { cookie: C[who] } : {} });
    const body = await r.json().catch(() => null);
    return { status: r.status, headers: r.headers, body, byId: Array.isArray(body) ? Object.fromEntries(body.map(c => [c.id, c])) : {} };
};
const stored = (id) => CONTENT.find(c => c.id === id);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const stripTts = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => !/^tts/i.test(k)));

try {
    api = spawnApi(PORT);
    await waitHealthy(base, api);
    for (const id of ['ADM', 'MED', 'LA', 'L0']) C[id] = await login(base, id);

    console.log('\n[A] sin sesión');
    ok('GET /api/content sin cookie → 401', (await catalog(null)).status === 401);

    const la = await catalog('LA');
    console.log('\n[B] lector con título permitido');
    ok('200 y no-store', la.status === 200 && /no-store/.test(la.headers.get('cache-control') || ''), la.headers.get('cache-control'));
    ok('título permitido: registro íntegro', same(stripTts(la.byId['content-A']), stored('content-A')));
    ok('nodo de Experience permitido: íntegro', same(stripTts(la.byId['content-E']), stored('content-E')));

    console.log('\n[C] lector sin el título');
    const b = la.byId['content-B'];
    ok('el título sigue listado con su metadata pública', !!b && ['titulo', 'autor', 'tipo', 'descripcion', 'etiquetas', 'metricas']
        .every(k => same(b[k], B[k])));
    ok('sin texto_plano_url / en / pt', !('texto_plano_url' in b) && !('texto_ingles_url' in b) && !('texto_portugues_url' in b));
    ok('sin url_recurso, canonicalBookUrl, ilustraciones_url, mediaAssets', ['url_recurso', 'canonicalBookUrl', 'ilustraciones_url', 'mediaAssets'].every(k => !(k in b)));
    ok('ninguna ruta /uploads salvo la portada', !hasUploads({ ...b, portada_url: null }));
    ok('lector sin ninguna regla (L0): ningún localizador editorial en todo el catálogo',
        (await catalog('L0')).body.every(c => !hasUploads({ ...c, portada_url: null })));

    console.log('\n[D] administrador');
    const adm = await catalog('ADM');
    ok('admin: catálogo completo e íntegro', adm.body.length === CONTENT.length && CONTENT.every(c => same(stripTts(adm.byId[c.id]), c)));
    const med = await catalog('MED');
    ok('mediador: ve la pedagogía con su recurso (rol)', med.byId['content-P']?.url_recurso === stored('content-P').url_recurso);
    ok('lector: la pedagogía independiente sigue fuera del listado', !la.byId['content-P']);
    ok('lector: mismo número de títulos que antes de CP-3 (solo se resta pedagogía)', la.body.length === CONTENT.length - 1);

    console.log('\n[E] portada pública');
    ok('portada presente en el título sin acceso', b.portada_url === B.portada_url);
    ok('portada presente en el álbum sin acceso', la.byId['content-AL']?.portada_url === stored('content-AL').portada_url);

    console.log('\n[F] recurso compartido');
    ok('S1 (permitido) conserva el PDF compartido', la.byId['content-S1']?.url_recurso === stored('content-S1').url_recurso);
    ok('S2 (sin acceso) no lo recibe', !('url_recurso' in la.byId['content-S2']));
    ok('S2 conserva SU metadata (no la de S1)', la.byId['content-S2'].titulo === 'Comparte 2' && la.byId['content-S2'].autor === 'S2'
        && la.byId['content-S2'].portada_url === stored('content-S2').portada_url);
    ok('URL externa (YouTube) conservada aunque no haya acceso', la.byId['content-V']?.url_recurso === stored('content-V').url_recurso);

    console.log('\n[G] epub_url');
    ok('sin acceso: no revela epub_url', !('epub_url' in b));
    ok('con acceso: epub_url presente', la.byId['content-A'].epub_url === stored('content-A').epub_url);

    console.log('\n[H] album_data');
    ok('sin acceso: sin album_data', !('album_data' in b) && !('album_data' in la.byId['content-AL']));
    ok('sin acceso: ninguna página interior en la respuesta', !JSON.stringify(la.byId['content-AL']).includes('p2.jpg')
        && !JSON.stringify(b).includes('pagina-1.jpg') && !JSON.stringify(b).includes('region.mp3'));

    console.log('\n[R7] logout');
    const lc = await login(base, 'LA');
    const lo = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: lc, 'sec-fetch-site': 'same-origin' } });
    ok('logout 200 + Clear-Site-Data "cache" (sin storage ni cookies)', lo.status === 200 && lo.headers.get('clear-site-data') === '"cache"',
        `${lo.status} ${lo.headers.get('clear-site-data')}`);
    ok('cookie revocada: GET /api/content → 401', (await fetch(`${base}/api/content`, { headers: { cookie: lc } })).status === 401);

    console.log('\n[perf] GET /api/content (lector, 8 títulos, 30 req)');
    const t0 = performance.now();
    for (let i = 0; i < 30; i++) await catalog('LA');
    console.log(`  · media ${((performance.now() - t0) / 30).toFixed(1)} ms/req`);

    ok('stores de contenido (salvo tts*) y acceso intactos',
        same(JSON.parse(fs.readFileSync(P.content, 'utf8')).map(stripTts), CONTENT) && same(JSON.parse(fs.readFileSync(P.access, 'utf8')), ACCESS));
} catch (e) {
    fail++;
    console.error('  ✗ excepción:', e.stack || e);
} finally {
    try { api?.kill(); } catch {}
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log(`\n${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
