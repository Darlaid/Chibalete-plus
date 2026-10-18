/**
 * catalogAccessLogNoise.test.mjs — CHP-CONTENT-PROTECTION-2026-01 CP-3A.
 *
 * GET /api/content evalúa decideContentAccess por cada título (CP-3 R2). Con
 * logging por decisión eso eran ~4 líneas por título y request. CP-3A añade la
 * opción `logDecision` (default true) y el catálogo la usa en false: cero
 * líneas por título y, como máximo, una línea resumen [CATALOG_ACCESS_FILTER].
 * Ninguna decisión cambia.
 *
 * [U] unidad (cualquier plataforma): createAccessService con log capturado.
 * [I] integración: server.js REAL, 109 títulos, sesión enforce, restricted.
 * Nunca toca data/ ni la red.
 *
 *   node server/__test__/catalogAccessLogNoise.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { fileURLToPath } from 'node:url';
import { createAccessService } from '../accessService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const U = (rel) => `/uploads/${rel}`;

// ── [U] unidad ──────────────────────────────────────────────────────────────
console.log('\n[U] canUserAccessContent / resolveUserContentAccess — logDecision');
{
    const lines = [];
    const stores = {
        users: [{ id: 'R', roles: ['lector'] }, { id: 'N', roles: ['lector'] }, { id: 'X', roles: ['lector'] }],
        groups: [],
        access: [
            { id: 'r1', scope: 'user', scopeId: 'R', titleIds: ['t1'], collectionIds: ['col'] },
            { id: 'rx', scope: 'user', scopeId: 'X', titleIds: ['t1'], expiresAt: 1 },
        ],
    };
    const mk = (fallbackMode) => createAccessService({
        readJSON: (p) => stores[p], log: (m) => lines.push(m),
        normalizeUser: (u) => u, normalizeGroup: (g) => g,
        USERS_DB: 'users', GROUPS_DB: 'groups', ACCESS_DB: 'access', fallbackMode,
    });
    const cases = [
        ['R', 't1', { id: 't1' }], ['R', 't2', { id: 't2', parentId: 'col' }], ['R', 't3', { id: 't3' }],
        ['N', 't1', { id: 't1' }], ['X', 't1', { id: 't1' }], ['nadie', 't1', { id: 't1' }],
    ];
    for (const mode of ['restricted', 'open']) {
        const svc = mk(mode);
        for (const [u, c, content] of cases) {
            lines.length = 0;
            const on = svc.canUserAccessContent(u, c, content);
            const onLines = lines.length;
            lines.length = 0;
            const off = svc.canUserAccessContent(u, c, content, { logDecision: false });
            const offLines = lines.length;
            ok(`${mode} ${u}→${c}: misma decisión on/off (${on.reason})`, same(on, off), JSON.stringify([on, off]));
            ok(`${mode} ${u}→${c}: default registra (${onLines}), logDecision=false → 0`, (u === 'nadie' || onLines > 0) && offLines === 0, `${onLines}/${offLines}`);
        }
        lines.length = 0;
        const r1 = svc.resolveUserContentAccess('R');
        const n1 = lines.length;
        lines.length = 0;
        const r2 = svc.resolveUserContentAccess('R', { logDecision: false });
        ok(`${mode} resolveUserContentAccess: mismo resultado, default ${n1} líneas, off 0`, same(r1, r2) && n1 > 0 && lines.length === 0);
        lines.length = 0;
        ok(`${mode} getAccessibleContentIds sigue registrando (sin cambio)`, !!svc.getAccessibleContentIds('R') && lines.length > 0);
    }
}

// ── Integración ─────────────────────────────────────────────────────────────
// La sesión firmada exige semántica POSIX (server/lib/secretFile.js): en
// Windows se declara la omisión, nunca un verde.
if (typeof process.getuid !== 'function') {
    console.log('\ncatalogAccessLogNoise [I] — SKIP: requiere plataforma POSIX (sesión firmada). Ejecutar en Linux/CI.');
    console.log(`\n${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_catalog_lognoise_'));
const up = path.join(tmp, 'uploads');
const dataDir = path.join(tmp, 'data');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(up, { recursive: true });

// 109 títulos: 100 generales (g090–g099 en colección col-1), 5 guías
// pedagógicas, 2 nodos de Experience, 2 vídeos externos.
const pad = (n) => String(n).padStart(3, '0');
const CONTENT = [];
for (let i = 0; i < 100; i++) {
    const id = `content-g${pad(i)}`;
    CONTENT.push({ id, titulo: `Libro ${i}`, autor: `Autor ${i}`, tipo: 'libro', etiquetas: ['x'],
        portada_url: U(`${id}/tapa.jpg`), texto_plano_url: U(`${id}/libro.txt`), url_recurso: U(`${id}/libro.pdf`),
        ...(i >= 90 ? { parentId: 'col-1' } : {}) });
}
for (let i = 0; i < 5; i++) CONTENT.push({ id: `content-p${i}`, titulo: `Guía ${i}`, tipo: 'guia', url_recurso: U(`content-p${i}/guia.pdf`) });
for (let i = 0; i < 2; i++) CONTENT.push({ id: `content-e${i}`, titulo: `Nodo ${i}`, tipo: 'articulo_pedagogico', standalone: false, texto_plano_url: U(`content-e${i}/n.txt`) });
for (let i = 0; i < 2; i++) CONTENT.push({ id: `content-v${i}`, titulo: `Vídeo ${i}`, tipo: 'video', url_recurso: `https://www.youtube.com/watch?v=${i}` });

const LA_TITLES = [...Array(40).keys()].map(i => `content-g${pad(i)}`).concat(['content-e0']);
const LA_ALLOWED = new Set([...LA_TITLES, ...[...Array(10).keys()].map(i => `content-g${pad(90 + i)}`)]);
const PW = 'fixture-pass-cp3a';
const hash = bcrypt.hashSync(PW, 4);
const USERS = ['ADM:administrador', 'MED:mediador', 'LA:lector', 'L0:lector'].map(s => {
    const [id, role] = s.split(':');
    return { id, email: `${id.toLowerCase()}@fx.test`, password: hash, roles: [role], accountStatus: 'active', nombre_completo: id };
});
const ACCESS = [{ id: 'r-la', scope: 'user', scopeId: 'LA', titleIds: LA_TITLES, collectionIds: ['col-1'] }];
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

const PORT = 6600 + (process.pid % 200);
const base = `http://127.0.0.1:${PORT}`;
let api;
const C = {};
const stored = (id) => CONTENT.find(c => c.id === id);
const stripTts = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => !/^tts/i.test(k)));
const hasUploads = (v) => JSON.stringify(v).includes('/uploads/');
const PER_TITLE = /\[ACCESS\] user |\[ACCESS_DECISION\]|\[ACCESS\] Rule |\[ACCESS\] Scope resolved/;

// Ejecuta fn y devuelve las líneas de log que produjo el servidor.
async function logged(fn) {
    const from = api._log().length;
    const result = await fn();
    await sleep(150);
    const lines = api._log().slice(from).split('\n').filter(Boolean);
    return { result, lines };
}
const catalog = async (who) => {
    const r = await fetch(`${base}/api/content`, { headers: { cookie: C[who] } });
    const text = await r.text();
    const body = JSON.parse(text);
    return { status: r.status, text, body, byId: Object.fromEntries(body.map(c => [c.id, c])) };
};

try {
    api = spawnApi(PORT);
    await waitHealthy(base, api);
    for (const id of ['ADM', 'MED', 'LA', 'L0']) C[id] = await login(base, id);

    console.log('\n[C] GET /api/content — volumen de log (109 títulos)');
    const snap = {};
    for (const who of ['LA', 'L0', 'MED', 'ADM']) {
        const { result, lines } = await logged(() => catalog(who));
        snap[who] = result;
        const perTitle = lines.filter(l => PER_TITLE.test(l)).length;
        const summary = lines.filter(l => l.includes('[CATALOG_ACCESS_FILTER]'));
        console.log(`  · ${who}: ${result.body.length} títulos · líneas totales=${lines.length} · por título=${perTitle} · resumen=${summary.length}`
            + ` · sha256=${crypto.createHash('sha256').update(JSON.stringify(result.body.map(stripTts))).digest('hex').slice(0, 16)}`);
        ok(`${who}: 0 líneas por título`, perTitle === 0, `${perTitle}`);
        ok(`${who}: como máximo 1 línea resumen, sin ids de contenido ni rutas`, summary.length <= 1
            && summary.every(l => !/content-|\/uploads|https?:/.test(l)), summary.join(' | '));
    }
    const sumLA = (await logged(() => catalog('LA'))).lines.find(l => l.includes('[CATALOG_ACCESS_FILTER]')) || '';
    ok('resumen LA = total 104 / allowed 51 / filtered 53', /user=LA total=104 allowed=51 filtered=53/.test(sumLA), sumLA);

    console.log('\n[D/E] lector: autorizado con recursos, no autorizado sin ellos');
    const la = snap.LA;
    ok('200 y 104 títulos (109 − 5 guías pedagógicas)', la.status === 200 && la.body.length === CONTENT.length - 5, `${la.body.length}`);
    ok('autorizados (título + colección + nodo): registro íntegro', [...LA_ALLOWED].every(id => same(stripTts(la.byId[id]), stored(id))));
    const denied = la.body.filter(c => !LA_ALLOWED.has(c.id));
    ok('no autorizados: sin localizadores /uploads salvo portada', denied.length === 53
        && denied.every(c => !hasUploads({ ...c, portada_url: null }) && c.portada_url === stored(c.id).portada_url));
    ok('URL externa conservada', la.byId['content-v0'].url_recurso === stored('content-v0').url_recurso);
    ok('L0 (sin reglas): ningún localizador editorial', snap.L0.body.every(c => !hasUploads({ ...c, portada_url: null })));

    console.log('\n[F] admin');
    ok('admin: catálogo completo e íntegro', snap.ADM.body.length === CONTENT.length && CONTENT.every(c => same(stripTts(snap.ADM.byId[c.id]), c)));

    console.log('\n[G] pedagogía');
    ok('mediador: ve las guías con su recurso', [0, 1, 2, 3, 4].every(i => snap.MED.byId[`content-p${i}`]?.url_recurso === stored(`content-p${i}`).url_recurso));
    ok('lector: guías fuera del listado', [0, 1, 2, 3, 4].every(i => !la.byId[`content-p${i}`]));

    console.log('\n[A/H] /api/content/:id/access (logging por defecto) ≡ veredicto del catálogo');
    let agree = 0, accessLogged = 0;
    for (const c of la.body) {
        const { result, lines } = await logged(async () => {
            const r = await fetch(`${base}/api/content/${c.id}/access?userId=LA`, { headers: { cookie: C.LA } });
            return { status: r.status, body: await r.json() };
        });
        // Sin /uploads (vídeo externo) el catálogo no expresa veredicto: solo cuenta el preflight.
        const catalogAllowed = hasUploads({ ...stored(c.id), portada_url: null }) ? same(stripTts(c), stored(c.id)) : LA_ALLOWED.has(c.id);
        const accessAllowed = result.status === 200 && result.body.allowed === true;
        if (catalogAllowed === accessAllowed && accessAllowed === LA_ALLOWED.has(c.id)) agree++;
        if (lines.some(l => l.includes(`content ${c.id} →`) || l.includes(`Content: ${c.id} `))) accessLogged++;
    }
    ok(`veredicto idéntico en los ${la.body.length} títulos`, agree === la.body.length, `${agree}`);
    ok('preflight conserva su línea de decisión por título (default)', accessLogged === la.body.length, `${accessLogged}`);

    console.log('\n[perf] GET /api/content (lector, 104 títulos, 30 req)');
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
