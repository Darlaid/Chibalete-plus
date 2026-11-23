/**
 * institutionalAccessHttp.test.mjs — CHP V9 Bloque III · F5-D. Autorizaciones y asignaciones institucionales.
 *
 * server.js REAL, dos réplicas, sesiones reales (enforce); dos instituciones, tres cursos y dos clubes abiertos; mediadores,
 * suplente, lectores, un lector con compra personal, un lector personal sin institución y dos cuentas de administración.
 * Cada escenario barre las rutas de consulta en las DOS réplicas y busca en las respuestas el id, el nombre o el correo de
 * cada lector y un centinela único de su lectura.
 *   [1] cursos asignados con permisos vigentes        [7] lectores: otra institución y otros lectores
 *   [2] cursos no asignados y otra institución        [8] lectura personal y B2C fuera del ámbito institucional
 *   [3] A2 revocada                                   [9] administración
 *   [4] C005 revocado con la sesión abierta           [10] registro de decisiones indisponible
 *   [5] cambio de curso                               [11] respuestas tardías, cachés y concurrencia
 *   [6] sustitución y baja de mediadores              [12] lo demás sigue igual
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/institutionalAccessHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { a2RegistryPath, grantA2, grantC005 } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePorts } from './helpers/freePort.mjs';

if (process.platform === 'win32') {
    console.log('institutionalAccessHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 1400)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_f5d_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key'),
    insights: path.join(tmp, 'insights.db'), events: path.join(tmp, 'events.db'), progress: path.join(tmp, 'progress.db'), evidence: path.join(tmp, 'leo_evidence.json') };
fs.mkdirSync(P.data, { recursive: true });
process.env.INSIGHTS_SQLITE_PATH = P.insights;
process.env.AULA_VIVA_CONTEXT_LEDGER_ENABLED = '1';
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, nombre, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: nombre, roles, accountStatus: 'active', ...extra });
const reader = (id, org) => acct(id, `Estudiante ${id}`, ['lector'], { ...org });
// org-a: g-a y g-a3 (med-a), g-a2 (med-a2). org-b: g-b (med-b).
const GA = ['ra-1', 'ra-2', 'ra-3', 'ra-4', 'ra-5', 'ra-6'], GA3 = ['rc-1', 'rc-2'], GA2 = ['rx-1', 'rx-2'], GB = ['rb-1', 'rb-2', 'rb-3', 'rb-4', 'rb-5', 'rb-6'];
const READERS_A = [...GA, ...GA3, ...GA2];
fs.writeFileSync(P.users, JSON.stringify([acct('adm', 'Administración', ['administrador']),
    acct('med-a', 'Mediadora Alfa', ['mediador'], { mediatorKind: 'teacher', ...A }), acct('med-a2', 'Mediador Alfa Dos', ['mediador'], { mediatorKind: 'teacher', ...A }),
    acct('med-b', 'Mediadora Beta', ['mediador'], { mediatorKind: 'teacher', ...B }),
    acct('adm2', 'Administración Dos', ['administrador']), acct('med-a9', 'Mediadora Suplente', ['mediador'], { mediatorKind: 'teacher', ...A }),
    // Lector personal (compra B2C, sin institución).
    acct('pb-1', 'Estudiante pb-1', ['lector'], { b2c: true }),
    ...READERS_A.map((id) => reader(id, A)), ...GB.map((id) => reader(id, B))]));
const grp = (id, name, org, school, mediatorIds, members) => ({ id, name, type: 'course', ...org, school, mediatorIds, memberIds: members, studentIds: members });
const GROUPS = [grp('g-a', 'Quinto A', A, 'Colegio Alfa', ['med-a'], GA), grp('g-a3', 'Club de lectura', A, 'Colegio Alfa', ['med-a'], GA3),
    grp('g-a2', 'Quinto B', A, 'Colegio Alfa', ['med-a2'], GA2), grp('g-b', 'Sexto', B, 'Colegio Beta', ['med-b'], GB),
    { ...grp('g-bclub', 'Club abierto Beta', B, 'Colegio Beta', ['med-b'], []), type: 'club', kind: 'open' }, { ...grp('g-aclub', 'Club abierto Alfa', A, 'Colegio Alfa', ['med-a2'], []), type: 'club', kind: 'open' }];
const RULES = [{ id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1'], collectionIds: [] }, { id: 'r-g-a3', scope: 'group', scopeId: 'g-a3', titleIds: ['c1'], collectionIds: [] },
    { id: 'r-g-a2', scope: 'group', scopeId: 'g-a2', titleIds: ['c2'], collectionIds: [] }, { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    // Lectura PERSONAL: una compra de un lector del colegio (ra-4) y la del lector sin institución.
    { id: 'access-b2c-test-order-1', scope: 'user', scopeId: 'ra-4', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86_400_000, b2c: { orderId: 1, source: 'test', plan: 'digital', idempotencyKey: 'test:order:1', activationAt: Date.now() - 86_400_000, expiresAt: Date.now() + 300 * 86_400_000 } },
    { id: 'access-b2c-test-order-2', scope: 'user', scopeId: 'pb-1', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86_400_000, b2c: { orderId: 2, source: 'test', plan: 'digital', idempotencyKey: 'test:order:2', activationAt: Date.now() - 86_400_000, expiresAt: Date.now() + 300 * 86_400_000 } }];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.access, JSON.stringify(RULES));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra del curso'], ['c2', 'Obra del otro curso'], ['cb', 'Obra de la otra institución'], ['c3', 'Lectura personal comprada']].map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), '[]');
fs.writeFileSync(path.join(P.data, 'interventions_db.json'), JSON.stringify({ interventions: [] }));
// Memoria acumulada e interacciones de Leo (entradas del cálculo ADMINISTRATIVO del tablero).
const NOW = Date.now(), DAY = 86_400_000, MIN = 60_000, iso = (ms) => new Date(ms).toISOString();
fs.writeFileSync(path.join(P.data, 'leo_interactions_db.json'), JSON.stringify(GA.flatMap((u, i) => Array.from({ length: 3 + i }, (_, k) => ({ userId: u, contentId: 'c1', timestamp: NOW - (k + 1) * 3_600_000, type: 'chat' })))));

const REG = a2RegistryPath();
grantA2([...READERS_A, ...GB]);
grantC005(['med-a', 'med-a2', 'med-b', 'med-a9']);

const Ledger = await import('../aulaViva/contextLedger.mjs');
Ledger.observeContext(GROUPS.map((g) => ({ groupId: g.id, works: RULES.filter((r) => r.scopeId === g.id).flatMap((r) => r.titleIds), members: g.memberIds })), { nowTs: NOW - 100 * DAY });
Ledger.closeContextLedger();

const ports = await freePorts(2);
const ORIGINS = ports.map((p) => `http://127.0.0.1:${p}`).join(',');
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', ALLOWED_ORIGINS: ORIGINS,
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: P.progress, LEO_EVIDENCE_DB: P.evidence,
        EVENTS_SQLITE_PATH: P.events, INSIGHTS_SQLITE_PATH: P.insights, ARCHIVE_SQLITE_PATH: path.join(P.data, 'archive.db'),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        AULA_VIVA_CONTEXT_LEDGER_ENABLED: '1', AULA_VIVA_CONTEXT_OBSERVE_INTERVAL_MS: '3600000',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (s) => { let last = ''; for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch (e) { last = String(e?.cause?.code || e?.message || e); } await sleep(150); } throw new Error(`nunca healthy: ${last}`); };
const parse = async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ } return { status: r.status, json, text }; };
const get = async (s, p, cookie) => parse(await fetch(`${s.base}${p}`, { headers: cookie ? { cookie } : {} }));
const post = async (s, p, cookie, body) => parse(await fetch(`${s.base}${p}`, { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body) }));
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};
const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 260)}`).join(' | ');
const sql = (file, q, ...a) => { const db = new Database(file, { readonly: true, fileMustExist: true }); try { return db.prepare(q).all(...a); } finally { db.close(); } };

const IND = (R, G, C) => [`/api/groups/${G}/students/${R}/progress`, `/api/students/${R}/status`, `/api/students/${R}/export-submissions`, `/api/metrics/student/${R}`,
    `/api/progress/user/${R}`, `/api/progress/item/${R}/${C}`, `/api/reading-progress/${R}`, `/api/reading-progress/${R}/${C}`, `/api/interventions/student/${R}`,
    `/api/leo/mediator/student/${R}`, `/api/leo/mediator/student/${R}/content/${C}`, `/api/leo/activation/${R}`, `/api/leo/memory/${R}/${C}`, `/api/access/by-user/${R}`,
    `/api/aula-viva/students/${R}/timeline`, `/api/aula-viva/students/${R}/feature-vector`, `/api/aula-viva/students/${R}/risk-history`, `/api/aula-viva/institutional/profile/${R}`];
const GRP = (G) => [`/api/groups/${G}/members`, `/api/groups/${G}/candidates`, `/api/groups/${G}/diagnosis`, `/api/groups/${G}/analytics-summary`, `/api/metrics/course/${G}`, `/api/reports/course/${G}`,
    `/api/interventions/course/${G}`, `/api/interventions/effectiveness?courseId=${G}`, `/api/aula-viva/cohorts/group/${G}`, `/api/aula-viva/cohorts/group/${G}/rollups`,
    `/api/aula-viva/recommendations/scope/group/${G}`, `/api/aula-viva/institutional/outcomes/scope/group/${G}`, `/api/aula-viva/institutional/learnings/scope/group/${G}`];
const GLOBAL = ['/api/users', '/api/groups', '/api/metrics/schools', '/api/metrics/school/org-a', '/api/metrics/school/org-b', '/api/reports/school/org-a', '/api/membership-governance/groups',
    '/api/experiences/review/queue', '/api/schools', '/api/aula-viva/students-needing-attention', '/api/aula-viva/recommendations', '/api/aula-viva/operational/status',
    '/api/aula-viva/institutional/status', '/api/aula-viva/institutional/cohorts/definitions', '/api/aula-viva/institutional/outcomes/follow-up-queue',
    '/api/metrics/backbone', '/api/metrics/funnels', '/api/metrics/insights', '/api/metrics/insights/states', '/api/metrics/insights/notifications'];
// Rutas de NÓMINA: quién está en la institución o en el grupo (con C005 vigente). No son seguimiento individual.
const ROSTER = /^\/api\/(users|groups|groups\/[^/]+\/(members|candidates|diagnosis))$/;
const ALL_READERS = [...READERS_A, ...GB, 'pb-1'];
// Centinelas de lectura: `sentenceIndex` único por lector y obra. Si aparece en una respuesta, se entregó ese registro.
const SENT = { 'ra-1:c1': 31001, 'ra-2:c1': 31002, 'ra-3:c1': 31003, 'ra-4:c1': 31004, 'ra-4:c3': 42424, 'rx-1:c2': 33001, 'rb-1:cb': 35001, 'pb-1:c3': 47474, 'rc-1:c1': 36001 };
const NOTE = 'NOTA-DEL-CURSO-ANTERIOR-7731';
const scan = (text) => {
    const body = text.replace(/"scope_id":"[^"]*"/g, '');
    return { ids: ALL_READERS.filter((id) => body.includes(`"${id}"`) || body.includes(`Estudiante ${id}`) || body.includes(`${id}@fixture.invalid`)),
        sent: Object.entries(SENT).filter(([, v]) => new RegExp(`(?<![0-9.])${v}(?![0-9])`).test(body)).map(([k]) => k), note: body.includes(NOTE), personal: /"c3"|access-b2c-test-order|Lectura personal comprada/.test(body) };
};
const probe = async (cookie, routes) => { const out = []; for (const p of routes) { const rs = [await get(S1, p, cookie), await get(S2, p, cookie)]; const sc = rs.map((r) => scan(r.text));
    out.push({ p, st: rs.map((r) => r.status), ids: [...new Set(sc.flatMap((x) => x.ids))], sent: [...new Set(sc.flatMap((x) => x.sent))], note: sc.some((x) => x.note), personal: sc.some((x) => x.personal) }); } return out; };
const brief = (rows) => JSON.stringify(rows.map((r) => `${r.st.join('/')} ${r.p} ids=${r.ids} sent=${r.sent}${r.note ? ' NOTA' : ''}${r.personal ? ' PERSONAL' : ''}`));
/** Nada de `who`: ni su id, ni su nombre, ni su lectura. */
const about = (rows, who) => rows.filter((r) => r.ids.some((i) => who.includes(i)) || r.sent.some((k) => who.includes(k.split(':')[0])));
const no5xx = (rows) => rows.every((r) => r.st.every((s) => s < 500 || s === 503));
const TABLA = {};

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'adm2', 'med-a', 'med-a2', 'med-a9', 'med-b', 'ra-1', 'ra-2', 'ra-3', 'ra-4', 'ra-5', 'rc-1', 'rx-1', 'rb-1', 'pb-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    const Reg = await import('../privacy/a2Registry.mjs');
    const decide = (id, kind, status, capacity, ref = '') => Reg.appendDecisions([{ subjectId: id, kind, status, actDay: Reg.dayOf(Date.now()), version: kind === 'C005' ? '005@1.0' : '004@1.0', medium: 'paper', capacity, verification: 'verified', requestRef: `F5D-SINT-${kind}-${status}-${id}${ref}` }]);
    const send = async (s, method, p, cookie, body) => parse(await fetch(`${s.base}${p}`, { method, headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body ?? {}) }));
    const pbody = (idx, pct) => ({ canonicalProgress: { sentenceIndex: idx, totalSentences: 99999, globalPercentage: pct, lastInteractedMode: 'text' }, updatedAt: iso(Date.now()),
        session: { sessionId: `s-${idx}`, startedAt: iso(Date.now() - 20 * MIN), durationSec: 600, mode: 'text' } });
    {
        const seeded = [];
        for (const [k, v] of Object.entries(SENT)) { const [u, c] = k.split(':'); const r = await post(S1, `/api/progress/${u}/${c}/sync`, C[u], pbody(v, 30)); seeded.push(r.status); }
        ok('lectura sintética registrada por cada lector en sus obras (curso, otro curso, otra institución y lectura personal)', seeded.every((s) => s === 200), seeded.join(','));
        const iv = await post(S1, '/api/interventions', C['med-a'], { studentId: 'ra-3', courseId: 'g-a', type: 'sesion_acompanada', note: NOTE, contentId: 'c1' });
        ok('la mediadora del curso registra una nota de acompañamiento sobre un lector suyo', iv.status === 200 || iv.status === 201, `${iv.status} ${iv.text.slice(0, 200)}`);
    }

    section('[1] un mediador accede a sus cursos, con permisos vigentes');
    const own = await probe(C['med-a'], [...GLOBAL, ...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1'), ...IND('ra-3', 'g-a', 'c1')]);
    {
        const by = Object.fromEntries(own.map((r) => [r.p, r]));
        ok('su nómina, su tablero, su informe y el resumen del grupo traen a sus seis lectores', ['/api/groups/g-a/members', '/api/groups/g-a/analytics-summary', '/api/metrics/course/g-a', '/api/reports/course/g-a'].every((p) => by[p].st.every((s) => s === 200) && GA.every((id) => by[p].ids.includes(id))), brief(own.filter((r) => /g-a\/(members|analytics)|course\/g-a/.test(r.p))));
        ok('el seguimiento individual de un lector suyo responde, con su lectura de la obra del curso', ['/api/progress/user/ra-1', '/api/reading-progress/ra-1/c1', '/api/students/ra-1/status', '/api/leo/mediator/student/ra-1'].every((p) => by[p].st.every((s) => s === 200)) && by['/api/progress/user/ra-1'].sent.includes('ra-1:c1'));
        ok('ve la nota que ella misma registró', by['/api/interventions/student/ra-3'].note === true);
        ok('lo que es solo de administración no se le entrega (métricas por institución, gobierno de membresías, métricas globales)', ['/api/metrics/school/org-a', '/api/metrics/school/org-b', '/api/reports/school/org-a', '/api/membership-governance/groups', '/api/metrics/backbone', '/api/metrics/funnels', '/api/metrics/insights'].every((p) => by[p].st.every((s) => s === 403)));
        ok('ninguna respuesta trae a lectores de la otra institución ni al lector personal', about(own, [...GB, 'pb-1']).length === 0, brief(about(own, [...GB, 'pb-1'])));
        ok('de los lectores de su institución que NO son suyos solo recibe la nómina (perfil público, sin correo): nunca su lectura', own.filter((r) => !ROSTER.test(r.p) && r.ids.some((i) => [...GA2, ...GA3].includes(i) && !(r.p.includes('g-a3')))).length === 0 && !(await get(S1, '/api/users', C['med-a'])).text.includes('rx-1@fixture.invalid'));
        ok('sin errores 5xx', no5xx(own));
    }

    section('[2] cursos no asignados, otra institución y lector personal');
    {
        const foreign = await probe(C['med-a'], [...GRP('g-a2'), ...IND('rx-1', 'g-a2', 'c2'), ...GRP('g-b'), ...IND('rb-1', 'g-b', 'cb'), ...IND('pb-1', 'g-a', 'c3'), ...IND('rx-1', 'g-a', 'c1')]);
        ok(`${foreign.length} rutas sobre un curso de su institución que no media, sobre la otra institución y sobre un lector personal: ninguna entrega nada`, foreign.every((r) => r.ids.length === 0 && r.sent.length === 0 && !r.personal), brief(foreign.filter((r) => r.ids.length || r.sent.length || r.personal)));
        ok('…y ninguna responde con datos: 403, 404 o 503 (o una lista vacía)', foreign.every((r) => r.st.every((s) => [403, 404, 503].includes(s)) || (r.ids.length === 0 && r.sent.length === 0)), brief(foreign.filter((r) => r.st.includes(200))));
        const w = await post(S2, '/api/interventions', C['med-a'], { studentId: 'rx-1', courseId: 'g-a2', type: 'sesion_acompanada', note: 'x' });
        const w2 = await post(S1, '/api/interventions', C['med-a'], { studentId: 'rx-1', courseId: 'g-a', type: 'sesion_acompanada', note: 'x' });
        ok('tampoco puede ESCRIBIR sobre un lector que no es suyo (ni declarándolo en su propio curso)', w.status === 403 && w2.status === 403, `${w.status} ${w2.status}`);
        const other = await probe(C['med-b'], [...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1')]);
        ok('la mediadora de la otra institución: nada de esta', other.every((r) => r.ids.length === 0 && r.sent.length === 0 && !r.st.includes(200)), brief(other.filter((r) => r.ids.length || r.st.includes(200))));
    }

    section('[3] A2 revocada: se retira el seguimiento individual de ESE lector');
    {
        decide('ra-2', 'A2', 'revoked', 'legal_representative');
        const ind = await probe(C['med-a'], IND('ra-2', 'g-a', 'c1'));
        ok('sus 18 rutas individuales, en las dos réplicas y con la sesión abierta: ninguna entrega su lectura ni sus indicadores', ind.every((r) => r.sent.length === 0 && !r.note && (r.st.every((s) => [403, 404, 503].includes(s)) || r.p === '/api/access/by-user/ra-2')), brief(ind.filter((r) => r.st.includes(200))));
        const by = await get(S1, '/api/access/by-user/ra-2', C['med-a']);
        ok('lo único que conserva es qué obras tiene asignadas por el colegio (asignación, no seguimiento; sin compras personales)', by.status === 200 && !/access-b2c|"c3"|sentenceIndex|globalPercentage/.test(by.text), by.text.slice(0, 300));
        const grp = await probe(C['med-a'], GRP('g-a'));
        ok('el tablero, el informe y el resumen del grupo dejan de traer su fila (los demás siguen)', grp.filter((r) => !ROSTER.test(r.p)).every((r) => !r.ids.includes('ra-2') && !r.sent.includes('ra-2:c1')) && grp.find((r) => r.p === '/api/metrics/course/g-a').ids.includes('ra-1'), brief(grp.filter((r) => r.ids.includes('ra-2'))));
        ok('sigue en la nómina del curso (pertenecer al curso no depende de A2)', grp.find((r) => r.p === '/api/groups/g-a/members').ids.includes('ra-2'));
        const w = await post(S2, '/api/interventions', C['med-a'], { studentId: 'ra-2', courseId: 'g-a', type: 'sesion_acompanada', note: 'x' });
        ok('no puede registrar seguimiento nuevo sobre él', w.status === 403, String(w.status));
        const still = await probe(C['med-a'], IND('ra-1', 'g-a', 'c1'));
        ok('la revocación de un lector no afecta al seguimiento de otro', still.find((r) => r.p === '/api/progress/user/ra-1').sent.includes('ra-1:c1'));
        ok('el propio lector conserva su lectura', (await get(S2, '/api/progress/user/ra-2', C['ra-2'])).text.includes(String(SENT['ra-2:c1'])));
    }

    section('[4] C005 revocado con la sesión abierta y las cachés calientes');
    {
        const warm = await probe(C['med-a'], [...GLOBAL, ...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1')]);
        ok('antes: responde con sus lectores (cachés calientes en las dos réplicas)', warm.find((r) => r.p === '/api/groups/g-a/analytics-summary').ids.includes('ra-1'));
        decide('med-a', 'C005', 'revoked', 'mediator');
        const after = await probe(C['med-a'], [...GLOBAL, ...GRP('g-a'), ...GRP('g-a3'), ...IND('ra-1', 'g-a', 'c1'), ...IND('rc-1', 'g-a3', 'c1')]);
        ok(`inmediatamente después, ${after.length} rutas en las dos réplicas: ninguna trae un lector, su lectura ni una nota`, after.every((r) => r.ids.length === 0 && r.sent.length === 0 && !r.note), brief(after.filter((r) => r.ids.length || r.sent.length || r.note)));
        ok('la sesión sigue abierta (no es un cierre de cuenta) y no hay 5xx', (await get(S1, '/api/auth/me', C['med-a'])).status === 200 && no5xx(after));
        ok('tampoco escribe', (await post(S1, '/api/interventions', C['med-a'], { studentId: 'ra-1', courseId: 'g-a', type: 'sesion_acompanada', note: 'x' })).status !== 200);
        const other = await probe(C['med-a2'], GRP('g-a2'));
        ok('el otro mediador de la institución no cambia', other.find((r) => r.p === '/api/groups/g-a2/members').ids.includes('rx-1'));
        grantC005(['med-a']);
        const back = await probe(C['med-a'], ['/api/groups/g-a/members', '/api/progress/user/ra-1']);
        ok('con el compromiso vigente de nuevo, el acceso vuelve sin reiniciar', back.every((r) => r.st.every((s) => s === 200)) && back[1].sent.includes('ra-1:c1'));
    }

    section('[5] cambio de curso: el historial no se transfiere');
    {
        const warm = await probe(C['med-a'], GRP('g-a'));
        ok('antes del traslado: el lector está en el resumen del curso (caché caliente en las dos réplicas)', warm.find((r) => r.p === '/api/groups/g-a/analytics-summary').ids.includes('ra-3'));
        const mv = await post(S1, '/api/groups/g-a2/members/move', C['adm'], { fromGroupId: 'g-a', userIds: ['ra-3'] });
        ok('administración traslada al lector de Quinto A a Quinto B', mv.status === 200 && mv.json?.moved?.length === 1, mv.text.slice(0, 200));
        const old = await probe(C['med-a'], [...GRP('g-a'), ...IND('ra-3', 'g-a', 'c1'), ...IND('ra-3', 'g-a2', 'c1')]);
        const leaks = about(old, ['ra-3']).filter((r) => r.p !== '/api/groups/g-a/candidates');
        ok('la mediadora del curso ANTERIOR deja de verlo de inmediato en las dos réplicas: ni en el resumen conservado, ni en el tablero, ni en su seguimiento', leaks.length === 0, brief(leaks));
        ok('…sus rutas individuales: 403/404', old.filter((r) => /ra-3/.test(r.p)).every((r) => r.st.every((s) => [403, 404, 503].includes(s))), brief(old.filter((r) => /ra-3/.test(r.p) && r.st.includes(200))));
        ok('…solo le aparece como candidato de la institución (nómina, sin lectura)', old.find((r) => r.p === '/api/groups/g-a/candidates').ids.includes('ra-3'));
        ok('el resumen del curso anterior sigue sirviendo a los demás lectores', old.find((r) => r.p === '/api/groups/g-a/analytics-summary').ids.includes('ra-1') && old.find((r) => r.p === '/api/groups/g-a/analytics-summary').st.every((s) => s === 200));
        const neu = await probe(C['med-a2'], [...GRP('g-a2'), ...IND('ra-3', 'g-a2', 'c1'), ...IND('ra-3', 'g-a2', 'c2')]);
        ok('el mediador del curso NUEVO lo tiene en su nómina', neu.find((r) => r.p === '/api/groups/g-a2/members').ids.includes('ra-3'));
        ok('…pero no recibe su lectura de la obra del curso anterior, ni la nota de la mediadora anterior', neu.every((r) => !r.sent.includes('ra-3:c1') && !r.note), brief(neu.filter((r) => r.sent.length || r.note)));
        ok('…ni puede pedir esa obra por su nombre: no es de su curso', neu.filter((r) => /ra-3\/(content\/)?c1$|ra-3\/c1$/.test(r.p)).every((r) => r.st.every((s) => [403, 404].includes(s))), brief(neu.filter((r) => /c1$/.test(r.p))));
        const bodies = [];
        for (const p of ['/api/students/ra-3/status', '/api/aula-viva/students/ra-3/timeline', '/api/aula-viva/students/ra-3/feature-vector', '/api/aula-viva/institutional/profile/ra-3', '/api/leo/mediator/student/ra-3', '/api/reading-progress/ra-3']) bodies.push((await get(S2, p, C['med-a2'])).text);
        ok('…y lo que sí recibe de él no nombra la obra anterior', bodies.every((t) => !/"c1"|Obra del curso"/.test(t)), bodies.map((t) => t.slice(0, 160)).join(' || '));
        const xorg = await post(S1, '/api/groups/g-a/members/move', C['adm'], { fromGroupId: 'g-b', userIds: ['rb-2'] });
        const afterX = await probe(C['med-a'], [...IND('rb-2', 'g-a', 'cb'), '/api/groups/g-a/members']);
        TABLA['traslado entre instituciones (g-b→g-a)'] = `${xorg.status} ${JSON.stringify(xorg.json?.failed ?? xorg.json?.error ?? xorg.json?.moved ?? '').slice(0, 140)}`;
        ok('un traslado entre instituciones no se hace por esta vía; el lector de la otra institución sigue sin ser visible', !(xorg.status === 200 && (xorg.json?.moved || []).length > 0) && about(afterX, ['rb-2']).length === 0, TABLA['traslado entre instituciones (g-b→g-a)']);
    }

    section('[6] sustitución y baja de mediadores');
    {
        const warm = await probe(C['med-a'], GRP('g-a3'));
        ok('antes: la mediadora consulta su club', warm.find((r) => r.p === '/api/groups/g-a3/members').ids.includes('rc-1'));
        const put = await send(S1, 'PUT', '/api/groups/g-a3', C['adm'], { mediatorIds: ['med-a9'] });
        ok('administración la sustituye por la suplente', put.status === 200 && JSON.stringify(put.json?.mediatorIds) === '["med-a9"]', put.text.slice(0, 160));
        const gone = await probe(C['med-a'], [...GRP('g-a3'), ...IND('rc-1', 'g-a3', 'c1')]);
        ok('la mediadora sustituida pierde el club de inmediato en las dos réplicas, con la sesión abierta', gone.every((r) => r.ids.length === 0 && r.sent.length === 0 && r.st.every((s) => s !== 200)), brief(gone.filter((r) => r.st.includes(200) || r.ids.length)));
        ok('…y conserva el curso que sigue mediando', (await probe(C['med-a'], ['/api/groups/g-a/members']))[0].ids.includes('ra-1'));
        const sub = await probe(C['med-a9'], [...GRP('g-a3'), ...IND('rc-1', 'g-a3', 'c1')]);
        ok('la suplente (con C005 vigente) lo recibe: nómina y seguimiento de las obras del club', sub.find((r) => r.p === '/api/groups/g-a3/members').ids.includes('rc-1') && sub.find((r) => r.p === '/api/progress/user/rc-1').sent.includes('rc-1:c1'));
        ok('…y nada de los cursos que no media', about(await probe(C['med-a9'], [...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1')]), GA).length === 0);
        const dis = await post(S1, '/api/users/med-b/disable', C['adm'], {});
        const dead = await probe(C['med-b'], [...GRP('g-b'), ...IND('rb-1', 'g-b', 'cb'), '/api/users', '/api/groups', '/api/auth/me']);
        ok('baja de un mediador (cuenta desactivada): su sesión abierta deja de servir en las dos réplicas — todo 401/403', dis.status === 200 && dead.every((r) => r.st.every((s) => [401, 403].includes(s)) && r.ids.length === 0), brief(dead.filter((r) => !r.st.every((s) => [401, 403].includes(s)))));
        ok('…y no puede volver a entrar', (await fetch(`${S1.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: S1.base }, body: JSON.stringify({ email: 'med-b@fixture.invalid', password: PW }) })).status !== 200);
    }

    section('[7] lectores: ni otra institución, ni otros lectores');
    {
        const mine = await probe(C['ra-1'], [...GLOBAL, ...GRP('g-a'), ...IND('ra-5', 'g-a', 'c1'), ...IND('rb-1', 'g-b', 'cb'), ...GRP('g-b'), ...IND('pb-1', 'g-a', 'c3')]);
        ok('un lector no recibe la lectura, el seguimiento ni las notas de nadie más', mine.every((r) => r.sent.length === 0 && !r.note) && mine.filter((r) => !ROSTER.test(r.p)).every((r) => r.ids.filter((i) => i !== 'ra-1').length === 0), brief(mine.filter((r) => r.sent.length || (!ROSTER.test(r.p) && r.ids.some((i) => i !== 'ra-1')))));
        ok('…ni nada de la otra institución ni del lector personal, tampoco en las listas', about(mine, [...GB, 'pb-1']).length === 0, brief(about(mine, [...GB, 'pb-1'])));
        const acc = async (who, c, s = S1) => (await get(s, `/api/content/${c}/access?userId=${who}`, C[who])).json?.allowed === true;
        ok('un lector de la institución B no abre obras de A; uno de A no abre las de B', await acc('rb-1', 'cb') && !(await acc('rb-1', 'c1')) && !(await acc('rb-1', 'c2', S2)) && await acc('ra-1', 'c1') && !(await acc('ra-1', 'cb', S2)));
        ok('un lector de un curso no abre la obra de otro curso de su misma institución', !(await acc('ra-1', 'c2')) && !(await acc('rx-1', 'c1', S2)));
        const j1 = await post(S1, '/api/groups/g-bclub/join', C['ra-1'], {}), j2 = await post(S2, '/api/groups/g-b/join', C['ra-1'], {}), j3 = await post(S1, '/api/groups/g-a2/join', C['ra-1'], {});
        ok('no puede unirse a un club abierto de OTRA institución, ni a un curso por su cuenta', j1.status === 403 && j2.status === 403 && j3.status === 403 && !(await acc('ra-1', 'cb')) && !(await acc('ra-1', 'c2')), `${j1.status} ${j2.status} ${j3.status}`);
        const j4 = await post(S1, '/api/groups/g-aclub/join', C['ra-1'], {});
        ok('sí puede unirse a un club abierto de SU institución (y eso no le da nada de otros cursos)', j4.status === 200 && !(await acc('ra-1', 'c2')), String(j4.status));
        const personal = await probe(C['pb-1'], [...GLOBAL, ...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1')]);
        ok('el lector personal (compra B2C) no recibe nada institucional: ni nóminas, ni grupos, ni obras del colegio', about(personal, [...READERS_A, ...GB]).length === 0 && !(await acc('pb-1', 'c1')) && await acc('pb-1', 'c3'), brief(about(personal, [...READERS_A, ...GB])));
        const w = [await send(S1, 'PUT', '/api/groups/g-a', C['ra-1'], { mediatorIds: ['ra-1'] }), await post(S2, '/api/groups/g-a/members', C['ra-1'], { userIds: ['ra-1'] }), await post(S1, '/api/groups/g-a2/members/move', C['med-a'], { fromGroupId: 'g-a', userIds: ['ra-1'] }),
            await send(S2, 'PUT', '/api/groups/g-a', C['med-a'], { mediatorIds: ['med-a', 'med-a9'] }), await send(S1, 'DELETE', '/api/groups/g-a/members/ra-1', C['med-a'])];
        ok('ni un lector ni un mediador cambian asignaciones: las altas, bajas, traslados y designaciones son solo de administración', w.every((r) => [401, 403].includes(r.status)), w.map((r) => r.status).join(','));
    }

    section('[8] lectura personal y datos B2C fuera del ámbito institucional');
    {
        const med = await probe(C['med-a'], [...GLOBAL, ...GRP('g-a'), ...IND('ra-4', 'g-a', 'c1'), ...IND('ra-4', 'g-a', 'c3')]);
        ok('la mediadora ve de su lector la lectura de la obra del curso', med.find((r) => r.p === '/api/progress/user/ra-4').sent.includes('ra-4:c1'));
        ok('…y NUNCA su lectura personal: ni el registro, ni la obra, ni la compra, en ninguna de sus rutas', med.every((r) => !r.sent.includes('ra-4:c3') && !r.personal), brief(med.filter((r) => r.sent.includes('ra-4:c3') || r.personal)));
        ok('pedirla por su nombre: 403', med.filter((r) => /ra-4\/(content\/)?c3$|ra-4\/c3$/.test(r.p)).every((r) => r.st.every((s) => s === 403)));
        const sum0 = (await get(S1, '/api/metrics/course/g-a', C['med-a'])).json;
        const row0 = (sum0?.studentBreakdown || []).find((x) => x.userId === 'ra-4');
        const more = await post(S1, '/api/progress/ra-4/c3/sync', C['ra-4'], { ...pbody(42424, 80), session: { sessionId: 's-personal-2', startedAt: iso(Date.now() - 50 * MIN), durationSec: 2400, mode: 'text' } });
        const row1 = ((await get(S1, '/api/metrics/course/g-a', C['med-a'])).json?.studentBreakdown || []).find((x) => x.userId === 'ra-4');
        ok('40 minutos más de lectura personal no mueven las cifras del lector en el tablero del curso', more.status === 200 && !!row0 && !!row1 && row0.totalReadingTimeMs === row1.totalReadingTimeMs && row0.totalSessions === row1.totalSessions, JSON.stringify([row0?.totalReadingTimeMs, row1?.totalReadingTimeMs]));
        ok('el propio lector sí ve toda su lectura', (await get(S2, '/api/progress/user/ra-4', C['ra-4'])).text.includes('42424'));
    }

    section('[9] administración: facultades que conserva');
    {
        const adm = await probe(C['adm'], [...GLOBAL, ...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1')]);
        const by = Object.fromEntries(adm.map((r) => [r.p, r]));
        ok('operación: usuarios, grupos, nóminas, gobierno de membresías y métricas globales', ['/api/users', '/api/groups', '/api/groups/g-a/members', '/api/membership-governance/groups', '/api/metrics/backbone', '/api/metrics/insights'].every((p) => by[p].st.every((s) => s === 200)));
        ok('el tablero y el informe de un curso le llegan sin desglose por lector', by['/api/metrics/course/g-a'].ids.length === 0 && by['/api/reports/course/g-a'].ids.length === 0);
        TABLA['administración: rutas individuales que responden 200'] = adm.filter((r) => /ra-1/.test(r.p) && r.st.includes(200)).map((r) => r.p.replace('/api/', '')).join(' · ');
        const anon = await probe(null, ['/api/users', '/api/groups', '/api/groups/g-a/members', '/api/progress/user/ra-1', '/api/metrics/backbone', '/api/membership-governance/groups', '/api/students/ra-1/status']);
        ok('sin sesión no hay administración: 401/403 en todo, sin datos', anon.every((r) => r.st.every((s) => [401, 403].includes(s)) && r.ids.length === 0 && r.sent.length === 0), brief(anon));
        const spoof = await parse(await fetch(`${S1.base}/api/users`, { headers: { 'x-user-id': 'adm', 'x-admin-secret': 'no-es-el-secreto' } }));
        ok('declararse administrador por cabecera, sin sesión ni secreto válido, no sirve', [401, 403].includes(spoof.status) && scan(spoof.text).ids.length === 0, String(spoof.status));
        const dis = await post(S1, '/api/users/adm2/disable', C['adm'], {});
        const dead = await probe(C['adm2'], ['/api/users', '/api/groups/g-a/members', '/api/progress/user/ra-1', '/api/metrics/backbone']);
        ok('una cuenta de administración desactivada pierde todo, con la sesión abierta', dis.status === 200 && dead.every((r) => r.st.every((s) => [401, 403].includes(s)) && r.ids.length === 0), brief(dead));
        const self = await post(S2, '/api/users/adm/disable', C['adm'], {});
        ok('una administradora no puede desactivarse a sí misma por error', self.status === 409);
    }

    section('[10] registro de decisiones indisponible: no amplía permisos');
    {
        const good = fs.readFileSync(REG, 'utf8');
        fs.writeFileSync(REG, good + '{"esto":"no es una decisión"}\n');
        const m1 = await probe(C['med-a'], [...GLOBAL, ...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1'), ...IND('ra-2', 'g-a', 'c1')]);
        const m2 = await probe(C['med-a2'], [...GRP('g-a2'), ...IND('rx-1', 'g-a2', 'c2'), '/api/users', '/api/groups']);
        ok(`registro corrupto: ${m1.length + m2.length} rutas de dos mediadores, en las dos réplicas — ninguna entrega un lector, su lectura ni una nota`, [...m1, ...m2].every((r) => r.ids.length === 0 && r.sent.length === 0 && !r.note), brief([...m1, ...m2].filter((r) => r.ids.length || r.sent.length || r.note)));
        ok('…y el lector al que se le había revocado A2 no «vuelve» por el fallo', m1.filter((r) => /ra-2/.test(r.p)).every((r) => r.sent.length === 0 && r.ids.length === 0));
        ok('responden 403/503 o una lista sin lectores; ningún 500', no5xx([...m1, ...m2]) && m1.find((r) => r.p === '/api/groups/g-a/members').st.every((s) => [403, 503].includes(s)), brief(m1.filter((r) => r.st.some((s) => s >= 500 && s !== 503))));
        const w = await post(S1, '/api/interventions', C['med-a'], { studentId: 'ra-1', courseId: 'g-a', type: 'sesion_acompanada', note: 'x' });
        ok('tampoco se puede escribir seguimiento', [403, 503].includes(w.status), String(w.status));
        const acc = (await get(S1, '/api/content/c1/access?userId=ra-1', C['ra-1'])).json?.allowed === true;
        ok('los lectores del colegio siguen leyendo: el fallo no deja a la institución sin servicio', acc && (await get(S2, '/api/progress/user/ra-1', C['ra-1'])).status === 200);
        fs.writeFileSync(REG, good);
        const back = await probe(C['med-a'], ['/api/groups/g-a/members', '/api/progress/user/ra-1', ...IND('ra-2', 'g-a', 'c1').slice(4, 6)]);
        ok('reparado: vuelve lo vigente y lo revocado sigue revocado, sin reiniciar', back[0].ids.includes('ra-1') && back[1].sent.includes('ra-1:c1') && back.slice(2).every((r) => r.sent.length === 0 && r.st.every((s) => s !== 200)), brief(back));
    }

    section('[11] respuestas tardías, cachés y concurrencia');
    {
        const routes = ['/api/groups/g-a/members', '/api/groups/g-a/analytics-summary', '/api/metrics/course/g-a', '/api/progress/user/ra-5', '/api/reading-progress/ra-5/c1', '/api/students/ra-5/status', '/api/users', '/api/groups'];
        for (const p of routes) await probe(C['med-a'], [p]);                                   // cachés calientes
        const shots = [];
        const fire = async (s, p) => { const t0 = Date.now(); const r = await get(s, p, C['med-a']); shots.push({ p, t0, t1: Date.now(), st: r.status, ...scan(r.text) }); };
        const running = []; let stop = false;
        const loop = (async () => { while (!stop) { for (const p of routes) for (const s of [S1, S2]) running.push(fire(s, p)); await sleep(15); } })();
        await sleep(120);
        decide('med-a', 'C005', 'revoked', 'mediator', '-2');
        const revokedAt = Date.now();
        await sleep(400); stop = true; await loop; await Promise.all(running);
        const afterShots = shots.filter((x) => x.t0 > revokedAt);
        const late = afterShots.filter((x) => x.ids.length || x.sent.length);
        ok(`${shots.length} peticiones concurrentes en las dos réplicas alrededor de una revocación: las ${afterShots.length} iniciadas después no entregan ningún lector`, afterShots.length > 20 && late.length === 0, JSON.stringify(late.slice(0, 4)));
        const hdr = [];
        grantC005(['med-a']);
        for (const p of ['/api/groups/g-a/members', '/api/groups/g-a/analytics-summary', '/api/metrics/course/g-a', '/api/progress/user/ra-5', '/api/students/ra-5/status', '/api/users', '/api/groups', '/api/aula-viva/students/ra-5/timeline', '/api/leo/mediator/student/ra-5', '/api/interventions/student/ra-5']) {
            const r = await fetch(`${S1.base}${p}`, { headers: { cookie: C['med-a'] } }); await r.text();
            hdr.push([p, r.status, r.headers.get('cache-control') || '', r.headers.get('etag') ? 'etag' : '']);
        }
        TABLA['respuestas 200 sin Cache-Control (solo ETag; se revalidan)'] = hdr.filter(([, st, cc]) => st === 200 && !/no-store|private/.test(cc)).map(([p]) => p.replace('/api/', '')).join(' · ') || 'ninguna';
        ok('ninguna de esas respuestas declara una vigencia que permita reutilizarla sin preguntar al servidor (sin max-age ni public)', hdr.every(([, , cc]) => !/max-age=[1-9]|public|immutable/.test(cc)), JSON.stringify(hdr));
        ok('el resumen del grupo va además con no-store', /no-store/.test(hdr.find(([p]) => p.endsWith('analytics-summary'))[2]));
        // Una copia local solo puede reutilizarse tras revalidar con su ETag: después de una revocación, la revalidación
        // nunca responde «304 sin cambios» y el cuerpo nuevo ya no trae lectores.
        const cond = [];
        for (const [p] of hdr.filter((h) => h[3] === 'etag')) { const r0 = await fetch(`${S1.base}${p}`, { headers: { cookie: C['med-a'] } }); const tag = r0.headers.get('etag'); await r0.text();
            decide('med-a', 'C005', 'revoked', 'mediator', `-c-${cond.length}`);
            const r1 = await fetch(`${S2.base}${p}`, { headers: { cookie: C['med-a'], 'if-none-match': tag } }); const body = await r1.text(); const sc = scan(body);
            cond.push([p, r1.status, sc.ids.length + sc.sent.length]); grantC005(['med-a']); }
        ok(`revalidación condicional (If-None-Match) tras una revocación, ${cond.length} rutas: nunca «304 sin cambios» y nunca un lector`, cond.length >= 8 && cond.every(([, s, n]) => s !== 304 && n === 0), JSON.stringify(cond));
    }

    section('[12] lo demás sigue igual');
    {
        const fin = await probe(C['med-a'], [...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1')]);
        ok('la mediadora con todo vigente conserva su curso y su seguimiento', fin.find((r) => r.p === '/api/groups/g-a/members').ids.includes('ra-1') && fin.find((r) => r.p === '/api/progress/user/ra-1').sent.includes('ra-1:c1') && no5xx(fin));
        const leo = await get(S1, '/api/auth/me', C['ra-1']);
        ok('la sesión y la ficha del lector, sin cambios', leo.status === 200 && leo.json?.id === 'ra-1');
        const logs = `${S1.out}\n${S2.out}`;
        // Evidencia operativa: quién cambió qué asignación, y qué decisiones constan.
        const auditFile = path.join(tmp, 'user_audit.json');
        const audit = fs.existsSync(auditFile) ? JSON.parse(fs.readFileSync(auditFile, 'utf8')) : [];
        const entries = Array.isArray(audit) ? audit : (audit.entries || audit.logs || []);
        TABLA['auditoría: acciones registradas'] = [...new Set(entries.map((e) => e.action))].join(' · ');
        const moved = entries.find((e) => JSON.stringify(e).includes('ra-3') && JSON.stringify(e).includes('g-a2'));
        const mediators = entries.find((e) => JSON.stringify(e).includes('g-a3') && JSON.stringify(e).includes('med-a9'));
        const disabled = entries.filter((e) => e.action === 'disable_user').map((e) => e.targetUserId).sort();
        ok('el traslado, la sustitución de mediadores y las bajas quedan en la auditoría con quién los hizo', !!moved && moved.actor === 'adm' && !!mediators && mediators.actor === 'adm' && disabled.includes('med-b') && disabled.includes('adm2'), JSON.stringify([moved, mediators, disabled]).slice(0, 1100));
        const regText = fs.readFileSync(REG, 'utf8');
        const lines = regText.split('\n').filter(Boolean).map((l) => JSON.parse(l));
        ok('cada revocación consta en el registro de decisiones con su fecha, medio, calidad y referencia; sin identificadores en claro', lines.filter((l) => l.a === 'revoked' && ['A2', 'C005'].includes(l.k)).length >= 3 && lines.every((l) => l.r && l.e && l.w && l.q && l.m) && ![...ALL_READERS, 'med-a', 'med-b'].some((id) => regText.includes(`"${id}"`)));
        ok('los registros del servidor no contienen correos ni la contraseña de la prueba', !/@fixture\.invalid/.test(logs.replace(/\*\*\*@fixture\.invalid/g, '')) && !logs.includes(PW), (logs.match(/.{0,60}@fixture\.invalid.{0,20}/) || [''])[0]);
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    for (const s of [S1, S2]) { try { s.child.kill('SIGTERM'); } catch { /* */ } }
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nTABLA ${JSON.stringify(TABLA)}`);
console.log(`\ninstitutionalAccessHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
