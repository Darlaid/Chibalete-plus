/**
 * uploadsAuthzStrict.test.mjs — CHP-CONTENT-PROTECTION-2026-01 CP-1.
 *
 * UPLOADS_AUTHZ_MODE=strict: cada asset editorial de /uploads exige acceso al
 * contenido dueño (decideContentAccess), tanto en el autorizador del edge
 * (GET /api/internal/uploads-authz) como en el `express.static` de Node.
 * Identidad = cookie de sesión real (SESSION_AUTH_MODE=enforce).
 * Las familias de rutas replican el inventario productivo de CP-1.
 * Además: el modo legacy (sin flag) conserva el contrato 01D-B.
 *
 * Arranca server.js REAL sobre stores temporales. Nunca toca data/ ni la red.
 *
 *   node server/__test__/uploadsAuthzStrict.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';

// La sesión firmada exige semántica POSIX (server/lib/secretFile.js es
// fail-closed sin getuid/O_NOFOLLOW): en Windows no hay cookie que probar.
// CI (ubuntu) lo ejecuta siempre; aquí se declara la omisión, nunca un verde.
if (typeof process.getuid !== 'function') {
    console.log('uploadsAuthzStrict — SKIP: requiere plataforma POSIX (sesión firmada). Ejecutar en Linux/CI.');
    process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_uploads_strict_'));
const up = path.join(tmp, 'uploads');
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const put = (rel, data = `bytes:${rel}`) => { const p = path.join(up, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };

// ── Ficheros (familias del inventario productivo) ──────────────────────────
const F = {
    txt: 'content-A/libro-1.txt', pdf: 'content-A/libro-1.pdf', mp3: 'content-A/narracion-1.mp3',
    mp4: 'content-A/video-1.mp4', album: 'content-A/pagina-1.jpg', ill: 'content-A/ilustracion-1.png',
    cover: 'content-A/tapa-1.jpg', epub: 'content-A/libro-1.epub', orphanInFolder: 'content-A/huerfano-1.png',
    canonBook: 'content-A/canonical/book.json', canonTxt: 'content-A/canonical/book.txt', canonMedia: 'content-A/canonical/media/abc123.png',
    ttsManifest: 'audio/content-A/manifest.json', ttsChunk: 'audio/content-A/chunk_0001.mp3', albumTts: 'audio/content-A/album/h1.mp3',
    bTxt: 'content-B/libro-b.txt', shared: 'content-A/compartido.pdf', sharedAlbum: 'content-B/pagina-compartida.png',
    rootMp3: 'a01__episodio-1787707837934-1.mp3', rootTxt: 'a01__episodio-1787707837934-2.txt',
    pedPdf: 'content-P/guia.pdf', pedCover: 'content-P/tapa.jpg', pedTts: 'audio/content-P/manifest.json',
    embTxt: 'content-E/nodo.txt', mixed: 'content-P/mixto.pdf',
    immersive: 'audio/immersive/0123456789ab.wav', deletedTts: 'audio/content-DELETED/chunk_0001.mp3',
    unknownFolder: 'content-GONE/x.txt', rootOrphan: 'huerfano-root.png',
    banner: 'banner-slide-1.png', apk: 'chibalete-lu-0.9.0.apk', expCover: 'experience-covers/exp-1.webp',
};
Object.values(F).forEach(rel => put(rel));
const U = (rel) => `/uploads/${rel}`;

const CONTENT = [
    { id: 'content-A', titulo: 'Libro A', tipo: 'libro', texto_plano_url: U(F.txt), url_recurso: U(F.pdf), portada_url: U(F.cover),
      ilustraciones_url: [U(F.ill)], epub_url: U(F.epub), canonicalBookUrl: U(F.canonBook),
      album_data: [{ id: 'p1', imageUrl: U(F.album), ambientAudioUrl: U(F.mp3) }], extra: { video: U(F.mp4) } },
    { id: 'content-A2', titulo: 'Libro A2 (comparte PDF)', tipo: 'libro', url_recurso: U(F.shared) },
    { id: 'content-A3', titulo: 'Libro A3 (comparte PDF)', tipo: 'libro', url_recurso: U(F.shared) },
    { id: 'content-B', titulo: 'Libro B', tipo: 'libro_album', texto_plano_url: U(F.bTxt), album_data: [{ imageUrl: U(F.sharedAlbum) }] },
    { id: 'content-B2', titulo: 'Álbum B2 (comparte página)', tipo: 'libro_album', album_data: [{ imageUrl: U(F.sharedAlbum) }] },
    { id: 'content-M', titulo: 'Podcast raíz', tipo: 'podcast', url_recurso: U(F.rootMp3), texto_plano_url: U(F.rootTxt) },
    { id: 'content-P', titulo: 'Guía', tipo: 'guia', url_recurso: U(F.pedPdf), portada_url: U(F.pedCover) },
    { id: 'content-P2', titulo: 'Guía con fichero mixto', tipo: 'guia', url_recurso: U(F.mixed) },
    { id: 'content-G', titulo: 'General con fichero mixto', tipo: 'libro', url_recurso: U(F.mixed) },
    { id: 'content-E', titulo: 'Nodo MOOK', tipo: 'articulo_pedagogico', standalone: false, texto_plano_url: U(F.embTxt) },
];

const PW = 'fixture-pass-cp1';
const hash = bcrypt.hashSync(PW, 4);
const USERS = ['ADM:administrador', 'MED:mediador', 'LA:lector', 'LB:lector', 'L0:lector', 'LE:lector'].map(s => {
    const [id, role] = s.split(':');
    return { id, email: `${id.toLowerCase()}@fx.test`, password: hash, roles: [role], accountStatus: 'active' };
});
const ACCESS = [
    { id: 'r-la', scope: 'user', scopeId: 'LA', titleIds: ['content-A', 'content-M'], collectionIds: [] },
    { id: 'r-lb', scope: 'user', scopeId: 'LB', titleIds: ['content-B', 'content-A3', 'content-G'], collectionIds: [] },
    { id: 'r-le', scope: 'user', scopeId: 'LE', titleIds: ['content-E'], collectionIds: [] },
];
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
fs.writeFileSync(path.join(dataDir, 'landing_banner.json'), JSON.stringify([{ id: 's1', imageUrl: U(F.banner), order: 1 }]));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'));
fs.chmodSync(P.key, 0o400);
const before = { content: fs.readFileSync(P.content), access: fs.readFileSync(P.access) };

function spawnApi(port, mode) {
    const env = {
        ...process.env, NODE_ENV: 'test', PORT: String(port),
        CHP_DATA_DIR: dataDir, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: up, ACCESS_FALLBACK_MODE: 'restricted',
        OFFLINE_ASSIGNMENT_DB_PATH: P.offline, USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
        IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DUAL_WRITE: '1', IDENTITY_READ: 'json',
        SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key, SESSION_AUTH_MODE: 'enforce',
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    };
    if (mode) env.UPLOADS_AUTHZ_MODE = mode; else delete env.UPLOADS_AUTHZ_MODE;
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
    if (r.status !== 200 || !m) {
        const diag = (api?._log() || '').split('\n').filter(l => /SESSION|signing|key/i.test(l)).slice(-8).join('\n');
        throw new Error(`login ${id} → ${r.status}\n${diag}`);
    }
    return `chp_session=${m[1]}`;
}
// Petición cruda (sin normalización de URL del cliente) para rutas hostiles.
function raw(base, rawPath, headers = {}) {
    const u = new URL(base);
    return new Promise((resolve, reject) => {
        const req = http.request({ host: u.hostname, port: u.port, method: 'GET', path: rawPath, headers }, (res) => {
            res.resume();
            res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
        });
        req.on('error', reject);
        req.end();
    });
}

const PORT = 6100 + (process.pid % 200);
const base = `http://127.0.0.1:${PORT}`, legacyBase = `http://127.0.0.1:${PORT + 1}`;
let api, legacy;
const C = {};

// Veredicto del edge (auth_request) y respuesta real de express.static.
const authz = (uri, who) => raw(base, '/api/internal/uploads-authz', { 'x-original-uri': uri, ...(who ? { cookie: C[who] } : {}) });
const stat = (uri, who, extra = {}) => raw(base, uri, { ...(who ? { cookie: C[who] } : {}), ...extra });

async function matrix(label, rel, { allowed, denied }) {
    const uri = U(rel);
    const a0 = await authz(uri, null);
    const s0 = await stat(uri, null);
    ok(`${label}: sin sesión → 401 (edge ${a0.status} · static ${s0.status})`, a0.status === 401 && s0.status === 401);
    const xu = await stat(uri, null, { 'x-user-id': allowed[0] });
    ok(`${label}: solo x-user-id → 401`, xu.status === 401, xu.status);
    for (const who of denied) {
        const a = await authz(uri, who), s = await stat(uri, who);
        ok(`${label}: ${who} sin derecho → 403 (edge ${a.status} · static ${s.status})`, a.status === 403 && s.status === 403);
    }
    for (const who of allowed) {
        const a = await authz(uri, who), s = await stat(uri, who);
        ok(`${label}: ${who} con derecho → edge 204 + X-CHP-Cache private, static 200 private no-store`,
            a.status === 204 && a.headers['x-chp-cache'] === 'private' && s.status === 200 && /private/.test(s.headers['cache-control'] || '') && /no-store/.test(s.headers['cache-control'] || ''),
            `${a.status} ${a.headers['x-chp-cache']} ${s.status} ${s.headers['cache-control']}`);
    }
}
async function isPublic(label, rel) {
    const a = await authz(U(rel), null), s = await stat(U(rel), null);
    ok(`${label}: público sin sesión (edge 204 sin X-CHP-Cache · static 200)`, a.status === 204 && !a.headers['x-chp-cache'] && s.status === 200, `${a.status} ${s.status}`);
}

try {
    api = spawnApi(PORT, 'strict');
    legacy = spawnApi(PORT + 1, null);
    await waitHealthy(base, api);
    await waitHealthy(legacyBase, legacy);
    ok('boot strict declara UPLOADS_AUTHZ_MODE=strict', /UPLOADS_AUTHZ_MODE=strict/.test(api._log()));
    ok('boot sin flag declara UPLOADS_AUTHZ_MODE=legacy', /UPLOADS_AUTHZ_MODE=legacy/.test(legacy._log()));
    for (const id of ['ADM', 'MED', 'LA', 'LB', 'L0', 'LE']) C[id] = await login(base, id);

    console.log('\n[A] PUBLIC_ASSET');
    await isPublic('portada', F.cover);
    await isPublic('portada de material pedagógico', F.pedCover);
    await isPublic('slide del banner (landing_banner.json)', F.banner);
    await isPublic('APK de LU en la raíz', F.apk);
    await isPublic('carátula de Experience', F.expCover);

    console.log('\n[B–J] CONTENT_ASSET: 401 / 403 / ALLOW');
    const A = { allowed: ['LA', 'ADM', 'MED'], denied: ['L0', 'LB'] };
    await matrix('B TXT', F.txt, A);
    await matrix('C PDF', F.pdf, A);
    await matrix('D audio', F.mp3, A);
    await matrix('E vídeo', F.mp4, A);
    await matrix('F imagen de álbum', F.album, A);
    await matrix('F ilustración interior', F.ill, A);
    await matrix('G manifest TTS', F.ttsManifest, A);
    await matrix('H chunk TTS', F.ttsChunk, A);
    await matrix('H audio TTS de álbum', F.albumTts, A);
    await matrix('I canonical/book.json', F.canonBook, A);
    await matrix('I canonical/book.txt (por convención)', F.canonTxt, A);
    await matrix('J canonical/media', F.canonMedia, A);

    console.log('\n[K] EPUB bajo /uploads → 403 siempre');
    for (const who of [null, 'LA', 'ADM']) {
        const a = await authz(U(F.epub), who), s = await stat(U(F.epub), who);
        ok(`.epub ${who ?? 'sin sesión'} → 403`, a.status === 403 && s.status === 403);
    }

    console.log('\n[L] PEDAGOGY — contrato de rol vigente');
    const pa0 = await authz(U(F.pedPdf), null);
    ok('pedagogía sin sesión → 401', pa0.status === 401);
    ok('pedagogía lector → 403', (await authz(U(F.pedPdf), 'LA')).status === 403);
    const pm = await authz(U(F.pedPdf), 'MED');
    ok('pedagogía mediador → 204 private', pm.status === 204 && pm.headers['x-chp-cache'] === 'private');
    ok('pedagogía admin → 204', (await authz(U(F.pedPdf), 'ADM')).status === 204);
    ok('TTS de pedagogía lector → 403', (await authz(U(F.pedTts), 'LA')).status === 403);
    ok('fichero pedagógico+general: lector con el general → 204', (await authz(U(F.mixed), 'LB')).status === 204);
    ok('fichero pedagógico+general: lector sin el general → 403', (await authz(U(F.mixed), 'LA')).status === 403);
    ok('fichero pedagógico+general: mediador → 204', (await authz(U(F.mixed), 'MED')).status === 204);
    await matrix('Experience embebida (decideContentAccess)', F.embTxt, { allowed: ['LE', 'ADM'], denied: ['L0', 'LA'] });

    console.log('\n[M] UNMAPPED → DENY (salvo administrador)');
    for (const [label, rel] of [['caché inmersiva global', F.immersive], ['TTS de contenido borrado', F.deletedTts], ['carpeta de contenido inexistente', F.unknownFolder], ['huérfano en la raíz', F.rootOrphan], ['huérfano en carpeta de contenido', F.orphanInFolder]]) {
        const n = await authz(U(rel), null), l = await authz(U(rel), 'LA'), s = await stat(U(rel), 'LA');
        ok(`${label}: sin sesión 403 · lector 403 · static 403`, n.status === 403 && l.status === 403 && s.status === 403, `${n.status} ${l.status} ${s.status}`);
    }
    const adm = await authz(U(F.rootOrphan), 'ADM');
    ok('no mapeado: administrador → 204 private (vista previa de subida)', adm.status === 204 && adm.headers['x-chp-cache'] === 'private');
    ok('no mapeado: mediador → 403', (await authz(U(F.rootOrphan), 'MED')).status === 403);

    console.log('\n[16] rutas reales: compartidas, raíz, carpeta ajena');
    await matrix('PDF compartido por A2/A3 (dueño A3)', F.shared, { allowed: ['LB'], denied: ['LA', 'L0'] });
    await matrix('página de álbum compartida B/B2 (dueño B)', F.sharedAlbum, { allowed: ['LB'], denied: ['LA', 'L0'] });
    await matrix('mp3 en la raíz de /uploads (era MOOK)', F.rootMp3, { allowed: ['LA'], denied: ['LB', 'L0'] });
    await matrix('txt en la raíz de /uploads', F.rootTxt, { allowed: ['LA'], denied: ['LB', 'L0'] });

    console.log('\n[22] seguridad de ruta');
    const t = async (label, uri, who, expected) => { const r = await authz(uri, who); ok(`${label} → ${expected}`, r.status === expected, r.status); };
    await t('traversal ../ hacia contenido ajeno', `/uploads/content-A/../content-B/${path.basename(F.bTxt)}`, 'LA', 404);
    await t('traversal codificado %2e%2e', `/uploads/content-A/%2e%2e/content-B/${path.basename(F.bTxt)}`, 'LA', 404);
    await t('doble codificación %252e%252e (no se decodifica dos veces)', `/uploads/content-A/%252e%252e/content-B/${path.basename(F.bTxt)}`, 'LA', 403);
    await t('backslash', '/uploads/content-A\\..\\content-B\\x.txt', 'LA', 404);
    await t('backslash codificado %5c', '/uploads/content-A%5c..%5ccontent-B%5cx.txt', 'LA', 404);
    await t('fuera de /uploads', '/data/users.json', 'ADM', 404);
    await t('query param no cambia el dueño', `${U(F.bTxt)}?contentId=content-A&owner=content-A`, 'LA', 403);
    await t('percent-encoding legítimo de ruta propia', U(F.txt).replace('.txt', '%2Etxt'), 'LA', 204);
    await t('dueño ajeno (LB pide asset de A)', U(F.txt), 'LB', 403);
    await t('TTS: segmento de contenido ajeno', U(F.ttsChunk), 'LB', 403);
    await t('canonical de otro contenido', U(F.canonMedia), 'LB', 403);
    const st = await raw(base, `/uploads/content-A/%2e%2e/content-B/${path.basename(F.bTxt)}`, { cookie: C.LA });
    ok('static: traversal codificado no entrega bytes', st.status !== 200, st.status);
    const so = await raw(base, `/uploads/content-B/${path.basename(F.bTxt)}?x=../content-A`, { cookie: C.LA });
    ok('static: query no altera la decisión (LA → B) → 403', so.status === 403, so.status);

    console.log('\n[7] identidad: logout invalida la cookie para nuevos bytes');
    const lc = await login(base, 'LA');
    ok('cookie nueva: TXT → 204', (await raw(base, '/api/internal/uploads-authz', { 'x-original-uri': U(F.txt), cookie: lc })).status === 204);
    const lo = await fetch(`${base}/api/auth/logout`, { method: 'POST', headers: { cookie: lc, 'sec-fetch-site': 'same-origin' } });
    ok('logout 200/204', lo.status === 200 || lo.status === 204, lo.status);
    ok('cookie revocada: TXT → 401', (await raw(base, '/api/internal/uploads-authz', { 'x-original-uri': U(F.txt), cookie: lc })).status === 401);

    console.log('\n[legacy] sin flag: contrato 01D-B intacto');
    const la = (uri, cookie) => raw(legacyBase, '/api/internal/uploads-authz', { 'x-original-uri': uri, ...(cookie ? { cookie } : {}) });
    ok('legacy: TXT general sin sesión → 204', (await la(U(F.txt))).status === 204);
    ok('legacy: no mapeado sin sesión → 204', (await la(U(F.immersive))).status === 204);
    ok('legacy: static TXT sin sesión → 200', (await raw(legacyBase, U(F.txt))).status === 200);
    ok('legacy: pedagogía sin sesión → 401', (await la(U(F.pedPdf))).status === 401);
    ok('legacy: .epub → 403', (await la(U(F.epub))).status === 403);

    // La auditoría TTS de arranque (checkMissingTTS) puede marcar `ttsStatus`
    // en registros con texto sin manifest: es ajena a la autorización. Todo lo
    // demás del catálogo y el store de acceso deben quedar byte a byte.
    const stripTts = (buf) => JSON.stringify(JSON.parse(buf).map(c => Object.fromEntries(Object.entries(c).filter(([k]) => !/^tts/i.test(k)))));
    ok('stores de contenido (salvo campos tts*) y acceso intactos',
        stripTts(fs.readFileSync(P.content)) === stripTts(before.content) && fs.readFileSync(P.access).equals(before.access));
} catch (e) {
    fail++;
    console.error('  ✗ excepción:', e.stack || e);
} finally {
    for (const c of [api, legacy]) { try { c?.kill(); } catch {} }
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log(`\n${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
