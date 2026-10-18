/**
 * catalogAccessPerformance.test.mjs — CHP-CONTENT-PROTECTION-2026-01 CP-3D.
 *
 * GET /api/content evalúa decideContentAccess por cada título (CP-3 R2). En
 * producción eso releía y parseaba users_db (sin caché por diseño) dos veces
 * por título: p50 94 → 522 ms. Los fixtures pequeños de CP-3 no lo detectaron,
 * así que esta prueba usa stores de tamaño productivo (109 títulos, users
 * ~335 KB, content ~450 KB, groups/access comparables; sin texto editorial).
 *
 * [U] unidad (cualquier plataforma): readStore en canUserAccessContent.
 * [I] integración: server.js REAL, sesión enforce, restricted, strict.
 *   - lecturas físicas de stores por GET /api/content: O(1), no O(títulos);
 *   - veredicto del catálogo ≡ /access (logging y lectura por defecto) para
 *     9 actores × todos sus títulos;
 *   - el snapshot no sobrevive a la request (un cambio en users_db entre dos
 *     requests se refleja en la segunda);
 *   - latencia informativa (p50/p95).
 * Nunca toca data/ ni la red.
 *
 *   node server/__test__/catalogAccessPerformance.test.mjs
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

// ── [U] unidad ──────────────────────────────────────────────────────────────
console.log('\n[U] canUserAccessContent — readStore');
{
    const stores = {
        users: [{ id: 'R', roles: ['lector'] }, { id: 'N', roles: ['lector'] }],
        groups: [],
        access: [{ id: 'r1', scope: 'user', scopeId: 'R', titleIds: ['t1'], collectionIds: ['col'] }],
    };
    const defaultReads = [];
    const svc = createAccessService({
        readJSON: (p) => { defaultReads.push(p); return stores[p]; }, log: () => {},
        normalizeUser: (u) => u, normalizeGroup: (g) => g,
        USERS_DB: 'users', GROUPS_DB: 'groups', ACCESS_DB: 'access', fallbackMode: 'restricted',
    });
    const snapshotReads = [];
    const snapshot = new Map();
    const readStore = (p) => { if (!snapshot.has(p)) { snapshotReads.push(p); snapshot.set(p, stores[p]); } return snapshot.get(p); };
    const cases = [['R', 't1', { id: 't1' }], ['R', 't2', { id: 't2', parentId: 'col' }], ['R', 't3', { id: 't3' }], ['N', 't1', { id: 't1' }], ['X', 't1', { id: 't1' }]];
    let equal = true;
    for (const [u, c, content] of cases) {
        const a = svc.canUserAccessContent(u, c, content);
        const b = svc.canUserAccessContent(u, c, content, { readStore });
        if (!same(a, b)) equal = false;
    }
    ok('A. misma decisión con y sin readStore (5 casos)', equal);
    ok('B. con readStore cada store se lee una vez para todos los casos', same(snapshotReads.sort(), ['access', 'groups', 'users']), snapshotReads.join(','));
    ok('C. sin readStore se usa el readJSON del servicio en cada llamada (sin cambios)', defaultReads.filter(p => p === 'users').length === cases.length, String(defaultReads.length));
}

// ── Integración ─────────────────────────────────────────────────────────────
if (typeof process.getuid !== 'function') {
    console.log('\ncatalogAccessPerformance [I] — SKIP: requiere plataforma POSIX (sesión firmada). Ejecutar en Linux/CI.');
    console.log(`\n${pass} pass · ${fail} fail`);
    process.exit(fail ? 1 : 0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_catalog_perf_'));
const up = path.join(tmp, 'uploads'), dataDir = path.join(tmp, 'data');
fs.mkdirSync(dataDir, { recursive: true }); fs.mkdirSync(up, { recursive: true });
const U = (rel) => `/uploads/${rel}`;
const pad = (n) => String(n).padStart(3, '0');
const range = (a, b) => [...Array(b - a).keys()].map(i => `content-g${pad(a + i)}`);
const filler = (seed, n) => crypto.createHash('sha256').update(String(seed)).digest('hex').repeat(Math.ceil(n / 64)).slice(0, n);

// content ~450 KB: 100 generales (g090–g099 en col-1), 5 guías, 2 nodos, 2 vídeos.
const CONTENT = [];
for (let i = 0; i < 100; i++) {
    const id = `content-g${pad(i)}`;
    CONTENT.push({ id, titulo: `Libro ${i}`, autor: `Autor ${i}`, tipo: 'libro', etiquetas: ['x'], descripcion: filler(id, 3900),
        portada_url: U(`${id}/tapa.jpg`), texto_plano_url: U(`${id}/libro.txt`), url_recurso: U(`${id}/libro.pdf`),
        ...(i >= 90 ? { parentId: 'col-1' } : {}) });
}
for (let i = 0; i < 5; i++) CONTENT.push({ id: `content-p${i}`, titulo: `Guía ${i}`, tipo: 'guia', descripcion: filler(`p${i}`, 3000), url_recurso: U(`content-p${i}/guia.pdf`), portada_url: U(`content-p${i}/tapa.jpg`) });
for (let i = 0; i < 2; i++) CONTENT.push({ id: `content-e${i}`, titulo: `Nodo ${i}`, tipo: 'articulo_pedagogico', standalone: false, texto_plano_url: U(`content-e${i}/n.txt`) });
for (let i = 0; i < 2; i++) CONTENT.push({ id: `content-v${i}`, titulo: `Vídeo ${i}`, tipo: 'video', url_recurso: `https://www.youtube.com/watch?v=${i}` });

const PW = 'fixture-pass-cp3d';
const hash = bcrypt.hashSync(PW, 4);
const ACTORS = {
    ADM: { roles: ['administrador'] }, MED: { roles: ['mediador'] }, MEDR: { roles: ['mediador'], colegio: 'Escuela R' },
    LA: { roles: ['lector'] }, L0: { roles: ['lector'] }, LG: { roles: ['lector'] },
    LO: { roles: ['lector'], organizationId: 'org-1' }, LB: { roles: ['lector'] }, LX: { roles: ['lector'] },
};
// users ~335 KB: los 9 actores + relleno sintético (sin datos reales).
const USERS = Object.entries(ACTORS).map(([id, a]) => ({ id, email: `${id.toLowerCase()}@fx.test`, password: hash,
    accountStatus: 'active', nombre_completo: id, ...a }));
for (let i = 0; USERS.length < 1100; i++) {
    USERS.push({ id: `user-fx-${i}`, email: `fx${i}@fx.test`, password: hash, roles: ['lector'], accountStatus: 'active',
        nombre_completo: `Lector ${i}`, colegio: `Colegio ${i % 7}`, groupIds: [`G${i % 40}`], notas: filler(`u${i}`, 120) });
}
const FUT = Date.now() + 365 * 864e5, PAST = Date.now() - 864e5;
const ACCESS = [
    { id: 'r-la', scope: 'user', scopeId: 'LA', titleIds: [...range(0, 40), 'content-e0'], collectionIds: ['col-1'] },
    { id: 'r-g1', scope: 'group', scopeId: 'G1', titleIds: range(40, 60), collectionIds: [] },
    { id: 'r-org', scope: 'organization', scopeId: 'org-1', titleIds: range(60, 70), collectionIds: [] },
    { id: 'r-lb', scope: 'user', scopeId: 'LB', titleIds: range(70, 80), collectionIds: [], expiresAt: FUT, b2c: { orderId: 'o1' } },
    { id: 'r-lx', scope: 'user', scopeId: 'LX', titleIds: range(80, 90), collectionIds: [], expiresAt: PAST, b2c: { orderId: 'o2' } },
];
// access ~70 KB: reglas de relleno para usuarios sintéticos.
for (let i = 0; JSON.stringify(ACCESS).length < 70_000; i++) {
    ACCESS.push({ id: `r-fx-${i}`, scope: 'user', scopeId: `user-fx-${i}`, titleIds: range(0, 60), collectionIds: [] });
}
// groups ~80 KB.
const GROUPS = [{ id: 'G1', nombre: 'Primero A', type: 'course', memberIds: ['LG'], mediatorIds: [] }];
for (let i = 2; JSON.stringify(GROUPS).length < 80_000; i++) {
    GROUPS.push({ id: `G${i}`, nombre: `Grupo ${i}`, type: 'course', memberIds: USERS.slice(9 + i * 20, 29 + i * 20).map(u => u.id), mediatorIds: [] });
}
const P = {
    users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), progress: path.join(tmp, 'progress_db.json'),
    identity: path.join(tmp, 'identity.db'), offline: path.join(tmp, 'offline.db'), sessions: path.join(tmp, 'sessions.db'),
    key: path.join(tmp, 'session_signing_key'), counts: path.join(tmp, 'store_reads.counts'),
};
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.schools, '[]');
fs.writeFileSync(path.join(dataDir, 'school_configs.json'), JSON.stringify([{ schoolName: 'Escuela R', availableContentIds: range(0, 10) }]));
fs.writeFileSync(P.access, JSON.stringify(ACCESS));
fs.writeFileSync(P.content, JSON.stringify(CONTENT));
fs.writeFileSync(P.progress, JSON.stringify({ progressMap: {} }));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex'));
fs.chmodSync(P.key, 0o400);
const sizes = Object.fromEntries(['users', 'content', 'groups', 'access'].map(k => [k, fs.statSync(P[k]).size]));

const PORT = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${PORT}`;
const api = spawn(process.execPath, ['--import', './server/__test__/helpers/countStoreReads.mjs', 'server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT), CHP_STORE_READ_COUNT_FILE: P.counts,
        CHP_DATA_DIR: dataDir, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: up, ACCESS_FALLBACK_MODE: 'restricted',
        OFFLINE_ASSIGNMENT_DB_PATH: P.offline, USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
        IDENTITY_DB: P.identity, IDENTITY_SQLITE_ENABLED: '1', IDENTITY_DUAL_WRITE: '1', IDENTITY_READ: 'json',
        SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key, SESSION_AUTH_MODE: 'enforce',
        UPLOADS_AUTHZ_MODE: 'strict', OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    },
});
let LOG = '';
api.stdout.on('data', d => { LOG += d; }); api.stderr.on('data', d => { LOG += d; });
const counts = () => { try { return JSON.parse(fs.readFileSync(P.counts, 'utf8')); } catch { return {}; } };
const diff = (a, b) => Object.fromEntries(Object.keys(b).map(k => [k, b[k] - (a[k] || 0)]).filter(([, v]) => v));
const pct = (arr, p) => { const s = [...arr].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p / 100 * s.length) - 1)]; };
const stripTts = (c) => Object.fromEntries(Object.entries(c).filter(([k]) => !/^tts/i.test(k)));
const hasUploads = (v) => JSON.stringify(v).includes('/uploads/');
const C = {};
const catalog = async (who) => {
    const r = await fetch(`${base}/api/content`, { headers: { cookie: C[who] } });
    return { status: r.status, body: await r.json() };
};

try {
    for (let i = 0; i < 400; i++) {
        if (api.exitCode !== null) throw new Error(`server rc=${api.exitCode}\n${LOG.slice(-2000)}`);
        try { if ((await fetch(`${base}/api/health`)).ok) break; } catch {}
        await sleep(300);
    }
    for (const id of Object.keys(ACTORS)) {
        const r = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${id.toLowerCase()}@fx.test`, password: PW }) });
        const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
        if (r.status !== 200 || !m) throw new Error(`login ${id} → ${r.status}`);
        C[id] = `chp_session=${m[1]}`;
    }
    console.log(`\n  · stores: users ${sizes.users} B · content ${sizes.content} B · groups ${sizes.groups} B · access ${sizes.access} B · ${CONTENT.length} títulos`);

    console.log('\n[R] lecturas físicas de stores por GET /api/content');
    await catalog('LA'); await sleep(80);
    for (const who of ['LA', 'MEDR', 'ADM']) {
        // Coste base de cualquier request autenticada (sesión + middlewares).
        let before = counts();
        await fetch(`${base}/api/auth/me`, { headers: { cookie: C[who] } });
        await sleep(80);
        const auth = diff(before, counts());
        before = counts();
        const r = await catalog(who);
        await sleep(80);
        const d = diff(before, counts());
        const extra = Object.fromEntries(Object.entries(d).map(([k, v]) => [k, v - (auth[k] || 0)]));
        console.log(`  · ${who}: ${r.body.length} títulos · lecturas ${JSON.stringify(d)} · /api/auth/me ${JSON.stringify(auth)}`);
        // Sobre /api/auth/me, el handler del catálogo ya lee users_db 2 veces antes
        // de CP-3 (sesión del viewer + viewer). El snapshot añade 1. Nunca O(títulos).
        ok(`${who}: el catálogo añade como máximo 3 lecturas por store sobre una request autenticada (2 del handler + 1 snapshot), no una por título`,
            Object.values(extra).every(v => v <= 3), JSON.stringify(extra));
    }

    console.log('\n[G/H] veredicto del catálogo ≡ /access (lectura y logging por defecto), 9 actores');
    const summary = {};
    for (const who of Object.keys(ACTORS)) {
        const cat = await catalog(who);
        let agree = 0, observable = 0;
        for (const c of cat.body) {
            const stored = CONTENT.find(x => x.id === c.id);
            const pedagogy = stored.tipo === 'guia';
            const r = await fetch(`${base}/api/content/${c.id}/access?userId=${who}`, { headers: { cookie: C[who] } });
            const allowed = r.status === 200 && (await r.json()).allowed === true;
            if (!hasUploads({ ...stored, portada_url: null })) { agree++; continue; }   // sin /uploads: el catálogo no expresa veredicto
            observable++;
            const full = same(stripTts(c), stored);
            const stripped = !hasUploads({ ...c, portada_url: null }) && c.portada_url === stored.portada_url && c.titulo === stored.titulo;
            // Pedagogía independiente: en el catálogo (como en /uploads) se decide por
            // rol; /access además aplica la restricción institucional del mediador.
            const expected = pedagogy ? ['ADM', 'MED', 'MEDR'].includes(who) : allowed;
            if ((expected && full) || (!expected && stripped)) agree++;
        }
        summary[who] = { titles: cat.body.length, sha: crypto.createHash('sha256').update(JSON.stringify(cat.body.map(stripTts))).digest('hex').slice(0, 12) };
        ok(`${who}: ${agree}/${cat.body.length} títulos con el mismo veredicto (${observable} observables)`, agree === cat.body.length);
    }
    console.log('  · ' + JSON.stringify(summary));
    ok('admin: catálogo completo e íntegro', summary.ADM.titles === CONTENT.length);
    ok('lector: pedagogía independiente fuera del listado', summary.LA.titles === CONTENT.length - 5);

    console.log('\n[D/E] el snapshot no sobrevive a la request');
    const l0a = await catalog('L0');
    const l0Allowed = (body) => body.filter(c => hasUploads({ ...c, portada_url: null })).length;
    const users2 = JSON.parse(fs.readFileSync(P.users, 'utf8'));
    users2.find(u => u.id === 'L0').organizationId = 'org-1';            // users_db no tiene caché en proceso
    fs.writeFileSync(P.users, JSON.stringify(users2));
    const l0b = await catalog('L0');
    ok('L0 sin reglas: 0 títulos con localizadores', l0Allowed(l0a.body) === 0, String(l0Allowed(l0a.body)));
    ok('tras asignarle org-1 entre requests: la siguiente request ve sus 10 títulos', l0Allowed(l0b.body) === 10, String(l0Allowed(l0b.body)));

    console.log('\n[L] logging CP-3A');
    const from = LOG.length;
    await catalog('LA'); await sleep(80);
    const lines = LOG.slice(from).split('\n');
    ok('0 líneas de decisión por título y 1 línea resumen', lines.filter(l => /\[ACCESS\] user |\[ACCESS_DECISION\]/.test(l)).length === 0
        && lines.filter(l => l.includes('[CATALOG_ACCESS_FILTER]')).length === 1);

    console.log('\n[perf] GET /api/content (LA, 30 req, informativo)');
    const ms = [];
    for (let i = 0; i < 32; i++) { const t0 = performance.now(); await catalog('LA'); ms.push(performance.now() - t0); }
    const m = ms.slice(2);
    console.log(`  · p50 ${pct(m, 50).toFixed(1)} ms · p95 ${pct(m, 95).toFixed(1)} ms · max ${Math.max(...m).toFixed(1)} ms`);
} catch (e) {
    fail++;
    console.error('  ✗ excepción:', e.stack || e);
} finally {
    try { api.kill(); } catch {}
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
console.log(`\n${pass} pass · ${fail} fail`);
process.exit(fail ? 1 : 0);
