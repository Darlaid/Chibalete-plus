/**
 * privacyScopeHttp.test.mjs — CHP V9 Bloque III · F5-DP. Privacidad administrativa y visibilidad institucional.
 *
 * server.js REAL, dos réplicas, sesiones reales (enforce); dos instituciones, tres cursos, dos clubes abiertos, dos
 * cuentas de administración, lectores de colegio (uno con una compra personal) y dos cuentas personales B2C: una
 * adulta y una de lector menor representado.
 *   [1] administración: operaciones que conserva            [5] clubes abiertos: descubribles sin participantes
 *   [2] administración y lectura personal B2C                [6] mediadores, C005 y A2: sin cambios
 *   [3] el titular conserva lo suyo                          [7] política de caché de la API
 *   [4] un lector no recibe nóminas de otras clases          [8] respuestas tardías y dos réplicas
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/privacyScopeHttp.test.mjs
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
    console.log('privacyScopeHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 1400)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_f5dp_'));
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
    acct('pb-1', 'Estudiante pb-1', ['lector'], { b2c: true }), acct('pb-2', 'Estudiante pb-2', ['lector'], { b2c: true }),
    // Lector MENOR representado (compra para un menor): usuario propio, sin correo, contacto del adulto.
    { ...acct('pm-1', 'Estudiante pm-1', ['lector'], { b2c: true }), email: '', loginId: 'lec-abcd-efgh-jkmn', nombre_usuario: 'lec-abcd-efgh-jkmn', representedBy: { email: 'adulta.contacto@fixture.invalid' } },
    ...READERS_A.map((id) => reader(id, A)), ...GB.map((id) => reader(id, B))]));
const grp = (id, name, org, school, mediatorIds, members) => ({ id, name, type: 'course', ...org, school, mediatorIds, memberIds: members, studentIds: members });
const GROUPS = [grp('g-a', 'Quinto A', A, 'Colegio Alfa', ['med-a'], GA), grp('g-a3', 'Club de lectura', A, 'Colegio Alfa', ['med-a'], GA3),
    grp('g-a2', 'Quinto B', A, 'Colegio Alfa', ['med-a2'], GA2), grp('g-b', 'Sexto', B, 'Colegio Beta', ['med-b'], GB),
    { ...grp('g-bclub', 'Club abierto Beta', B, 'Colegio Beta', ['med-b'], []), type: 'club', kind: 'open' }, { ...grp('g-aclub', 'Club abierto Alfa', A, 'Colegio Alfa', ['med-a2'], []), type: 'club', kind: 'open' }];
const RULES = [{ id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1'], collectionIds: [] }, { id: 'r-g-a3', scope: 'group', scopeId: 'g-a3', titleIds: ['c1'], collectionIds: [] },
    { id: 'r-g-a2', scope: 'group', scopeId: 'g-a2', titleIds: ['c2'], collectionIds: [] }, { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] },
    // Lectura PERSONAL: una compra de un lector del colegio (ra-4) y la del lector sin institución.
    { id: 'access-b2c-test-order-1', scope: 'user', scopeId: 'ra-4', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86_400_000, b2c: { orderId: 1, source: 'test', plan: 'digital', idempotencyKey: 'test:order:1', activationAt: Date.now() - 86_400_000, expiresAt: Date.now() + 300 * 86_400_000 } },
    { id: 'access-b2c-test-order-3', scope: 'user', scopeId: 'pm-1', titleIds: ['c3'], collectionIds: [], expiresAt: Date.now() + 300 * 86_400_000, b2c: { orderId: 3, source: 'test', plan: 'digital', idempotencyKey: 'test:order:3', activationAt: Date.now() - 86_400_000, expiresAt: Date.now() + 300 * 86_400_000 } },
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
    `/api/leo/mediator/student/${R}`, `/api/leo/mediator/student/${R}/content/${C}`, `/api/leo/activation/${R}`, `/api/leo/memory/${R}/${C}`,
    `/api/aula-viva/students/${R}/timeline`, `/api/aula-viva/students/${R}/feature-vector`, `/api/aula-viva/students/${R}/risk-history`, `/api/aula-viva/institutional/profile/${R}`];
const GRP = (G) => [`/api/groups/${G}/members`, `/api/groups/${G}/candidates`, `/api/groups/${G}/diagnosis`, `/api/groups/${G}/analytics-summary`, `/api/metrics/course/${G}`, `/api/reports/course/${G}`,
    `/api/interventions/course/${G}`, `/api/aula-viva/cohorts/group/${G}`, `/api/aula-viva/cohorts/group/${G}/rollups`];
const GLOBAL = ['/api/users', '/api/groups', '/api/metrics/schools', '/api/membership-governance/groups', '/api/schools', '/api/aula-viva/students-needing-attention', '/api/aula-viva/recommendations',
    '/api/aula-viva/operational/status', '/api/aula-viva/institutional/status', '/api/metrics/backbone', '/api/metrics/funnels', '/api/metrics/insights'];
const PERSONAL = ['pb-1', 'pb-2', 'pm-1'];
const ALL_READERS = [...READERS_A, ...GB, ...PERSONAL];
const SENT = { 'ra-1:c1': 31001, 'ra-4:c1': 31004, 'ra-4:c3': 42424, 'rx-1:c2': 33001, 'rb-1:cb': 35001, 'pb-1:c3': 47474, 'pm-1:c3': 48484 };
const scan = (text) => {
    const body = text.replace(/"scope_id":"[^"]*"/g, '');
    return { ids: ALL_READERS.filter((id) => body.includes(`"${id}"`) || body.includes(`Estudiante ${id}`) || body.includes(`${id}@fixture.invalid`)),
        sent: Object.entries(SENT).filter(([, v]) => new RegExp(`(?<![0-9.])${v}(?![0-9])`).test(body)).map(([k]) => k),
        personal: /"c3"|Lectura personal comprada/.test(body), contact: /adulta\.contacto@fixture\.invalid|lec-abcd-efgh-jkmn/.test(body) };
};
const raw = async (s, p, cookie) => { const r = await fetch(`${s.base}${p}`, { headers: cookie ? { cookie } : {} }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ } return { status: r.status, text, json, cc: r.headers.get('cache-control') || '' }; };
const probe = async (cookie, routes) => { const out = []; for (const p of routes) { const rs = [await raw(S1, p, cookie), await raw(S2, p, cookie)]; const sc = rs.map((r) => scan(r.text));
    out.push({ p, st: rs.map((r) => r.status), cc: rs.map((r) => r.cc), ids: [...new Set(sc.flatMap((x) => x.ids))], sent: [...new Set(sc.flatMap((x) => x.sent))], personal: sc.some((x) => x.personal), contact: sc.some((x) => x.contact) }); } return out; };
const brief = (rows) => JSON.stringify(rows.map((r) => `${r.st.join('/')} ${r.p} ids=${r.ids} sent=${r.sent}${r.personal ? ' PERSONAL' : ''}${r.contact ? ' CONTACTO' : ''}`));
const TABLA = {};

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'adm2', 'med-a', 'med-a2', 'med-b', 'ra-1', 'ra-2', 'ra-4', 'rc-1', 'rx-1', 'rb-1', 'pb-1', 'pb-2']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    {   // el lector menor entra con su usuario, no con un correo
        const r = await fetch(`${S1.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: S1.base }, body: JSON.stringify({ email: 'lec-abcd-efgh-jkmn', password: PW }) });
        const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/); C['pm-1'] = m ? `chp_session=${m[1]}` : null;
        ok('el lector menor (cuenta representada) inicia sesión con su usuario', r.status === 200 && !!C['pm-1']);
    }
    const Reg = await import('../privacy/a2Registry.mjs');
    const decide = (id, kind, status, capacity, ref = '') => Reg.appendDecisions([{ subjectId: id, kind, status, actDay: Reg.dayOf(Date.now()), version: kind === 'C005' ? '005@1.0' : '004@1.0', medium: 'paper', capacity, verification: 'verified', requestRef: `F5DP-SINT-${kind}-${status}-${id}${ref}` }]);
    const send = async (s, method, p, cookie, body) => parse(await fetch(`${s.base}${p}`, { method, headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body ?? {}) }));
    const pbody = (idx, pct) => ({ canonicalProgress: { sentenceIndex: idx, totalSentences: 99999, globalPercentage: pct, lastInteractedMode: 'text' }, updatedAt: iso(Date.now()),
        session: { sessionId: `s-${idx}`, startedAt: iso(Date.now() - 20 * MIN), durationSec: 600, mode: 'text' } });
    {
        const seeded = [];
        for (const [k, v] of Object.entries(SENT)) { const [u, c] = k.split(':'); const r = await post(S1, `/api/progress/${u}/${c}/sync`, C[u], pbody(v, 30)); seeded.push(`${k}=${r.status}`); }
        ok('lectura sintética registrada: del curso, de una compra personal de un lector de colegio, y de las dos cuentas personales (adulta y menor)', seeded.every((s) => s.endsWith('=200')), seeded.join(' '));
    }

    section('[1] administración: operaciones que conserva');
    {
        const adm = await probe(C['adm'], [...GLOBAL, ...GRP('g-a')]);
        const by = Object.fromEntries(adm.map((r) => [r.p, r]));
        ok('usuarios, grupos, nóminas, gobierno de membresías y métricas globales: 200', ['/api/users', '/api/groups', '/api/groups/g-a/members', '/api/membership-governance/groups', '/api/metrics/backbone', '/api/metrics/insights', '/api/metrics/schools'].every((p) => by[p].st.every((s) => s === 200)), brief(adm.filter((r) => !r.st.every((s) => s === 200))));
        ok('gestión de cuentas: la lista de usuarios incluye las cuentas personales (adulta y menor)', PERSONAL.every((id) => by['/api/users'].ids.includes(id)));
        const subs = await raw(S1, '/api/access/by-user/pb-1', C['adm']), subsM = await raw(S2, '/api/access/by-user/pm-1', C['adm']);
        ok('gestión de suscripciones: ve qué acceso comprado tiene una cuenta personal (la regla del pedido), sin lectura', subs.status === 200 && /access-b2c-test-order-2/.test(subs.text) && subsM.status === 200 && /access-b2c-test-order-3/.test(subsM.text) && scan(subs.text).sent.length === 0 && !/sentenceIndex|globalPercentage/.test(subs.text + subsM.text), subs.text.slice(0, 300));
        const mv = await post(S1, '/api/groups/g-a2/members/move', C['adm'], { fromGroupId: 'g-a', userIds: ['ra-6'] }), back = await post(S2, '/api/groups/g-a/members/move', C['adm'], { fromGroupId: 'g-a2', userIds: ['ra-6'] });
        const dis = await post(S1, '/api/users/pb-2/disable', C['adm'], {}), re = await post(S2, '/api/users/pb-2/reinvite', C['adm'], {});
        ok('operaciones institucionales y de cuenta: traslada un lector, desactiva y reinvita una cuenta personal', mv.status === 200 && back.status === 200 && dis.status === 200 && re.status === 200 && /token=/.test(re.json?.activationUrl || ''), [mv.status, back.status, dis.status, re.status].join(','));
        const inst = await probe(C['adm'], IND('ra-1', 'g-a', 'c1'));
        ok('seguimiento de un lector de COLEGIO (obra del curso): lo conserva', inst.find((r) => r.p === '/api/progress/user/ra-1').sent.includes('ra-1:c1') && inst.find((r) => r.p === '/api/students/ra-1/status').st.every((s) => s === 200));
    }

    section('[2] administración y lectura personal B2C');
    for (const [who, label] of [['pb-1', 'adulta'], ['pm-1', 'menor representado']]) {
        const key = `${who}:c3`;
        const rows = [...(await probe(C['adm'], IND(who, 'g-a', 'c3'))), ...(await probe(C['adm2'], IND(who, 'g-a', 'c3')))];
        ok(`cuenta personal ${label}: las 17 rutas de seguimiento individual, con las dos cuentas de administración y en las dos réplicas — ninguna entrega su lectura, sus obras, sus interacciones ni sus producciones`, rows.every((r) => r.sent.length === 0 && !r.personal && r.st.every((s) => [403, 404, 503].includes(s))), brief(rows.filter((r) => r.st.includes(200) || r.sent.length || r.personal)));
        ok(`…ni siquiera su nombre o su identificador en esas respuestas`, rows.every((r) => r.ids.length === 0 && !r.contact), brief(rows.filter((r) => r.ids.length || r.contact)));
        ok(`…y las de progreso responden con un motivo propio (personal_reading_withheld), no un error genérico`, (await raw(S1, `/api/progress/user/${who}`, C['adm'])).json?.error === 'personal_reading_withheld' && (await raw(S2, `/api/reading-progress/${who}/c3`, C['adm'])).json?.error === 'personal_reading_withheld');
        void key;
    }
    {
        const w = await post(S1, '/api/interventions', C['adm'], { studentId: 'pb-1', courseId: 'g-a', type: 'sesion_acompanada', note: 'x' });
        ok('tampoco puede registrar seguimiento sobre una cuenta personal', w.status === 403, `${w.status} ${w.text.slice(0, 120)}`);
        const mix = await probe(C['adm'], [...IND('ra-4', 'g-a', 'c3'), ...IND('ra-4', 'g-a', 'c1'), ...GRP('g-a')]);
        ok('lector de colegio con una compra personal: administración ve su lectura de la obra del curso', mix.find((r) => r.p === '/api/progress/user/ra-4').sent.includes('ra-4:c1') && mix.find((r) => r.p === '/api/reading-progress/ra-4').sent.includes('ra-4:c1'));
        ok('…y NUNCA la de la obra que compró por su cuenta: ni el registro, ni la obra, en ninguna ruta individual ni del curso', mix.every((r) => !r.sent.includes('ra-4:c3') && !r.personal), brief(mix.filter((r) => r.sent.includes('ra-4:c3') || r.personal)));
        ok('pedir esa obra por su nombre: 403 personal_reading_withheld', (await raw(S1, '/api/progress/item/ra-4/c3', C['adm'])).json?.error === 'personal_reading_withheld' && (await raw(S2, '/api/reading-progress/ra-4/c3', C['adm'])).status === 403);
        const global = await probe(C['adm'], GLOBAL);
        ok('la lectura personal no entra en ningún informe global ni institucional', global.every((r) => r.sent.length === 0 && !r.personal), brief(global.filter((r) => r.sent.length || r.personal)));
        const spoof = await parse(await fetch(`${S1.base}/api/progress/user/pb-1`, { headers: { 'x-user-id': 'adm', 'x-admin-secret': 'no-es-el-secreto' } }));
        ok('declararse administrador por cabecera tampoco sirve', [401, 403].includes(spoof.status) && scan(spoof.text).sent.length === 0, String(spoof.status));
        const med = [...(await probe(C['med-a'], IND('pb-1', 'g-a', 'c3'))), ...(await probe(C['med-a'], IND('pm-1', 'g-a', 'c3')))];
        ok('un mediador tampoco (ya era así)', med.every((r) => r.sent.length === 0 && r.ids.length === 0 && !r.st.includes(200)), brief(med.filter((r) => r.st.includes(200))));
        const logs = `${S1.out}\n${S2.out}`;
        ok('los registros del servidor no contienen la lectura consultada (ni centinelas ni posiciones de lectura)', !Object.values(SENT).some((v) => logs.includes(String(v))) && !/sentenceIndex|globalPercentage/.test(logs));
    }

    section('[3] el titular conserva lo suyo');
    {
        for (const who of ['pb-1', 'pm-1']) {
            const mine = await probe(C[who], [`/api/progress/user/${who}`, `/api/progress/item/${who}/c3`, `/api/reading-progress/${who}`, `/api/reading-progress/${who}/c3`, `/api/access/by-user/${who}`, `/api/students/${who}/export-submissions`, '/api/auth/me']);
            ok(`${who}: su progreso, su obra, su acceso y la exportación de sus producciones responden 200 con su lectura`, mine.every((r) => r.st.every((s) => s === 200)) && mine.slice(0, 4).every((r) => r.sent.includes(`${who}:c3`)), brief(mine));
        }
        const own = await probe(C['ra-4'], ['/api/progress/user/ra-4', '/api/reading-progress/ra-4']);
        ok('el lector de colegio ve toda su lectura: la del curso y la personal', own.every((r) => r.sent.includes('ra-4:c1') && r.sent.includes('ra-4:c3')));
        const cross = await probe(C['pb-1'], IND('pm-1', 'g-a', 'c3'));
        ok('una cuenta personal no ve la de otra', cross.every((r) => r.sent.length === 0 && !r.st.includes(200)), brief(cross.filter((r) => r.st.includes(200))));
    }

    section('[4] un lector no recibe nóminas de otras clases');
    const namesOf = (r) => (Array.isArray(r.json) ? r.json : []).map((u) => u.id).sort();
    {
        const u = [await raw(S1, '/api/users', C['ra-1']), await raw(S2, '/api/users', C['ra-1'])];
        ok('lector de Quinto A: recibe su cuenta, a sus compañeros de curso y a su mediadora — nadie más', u.every((r) => r.status === 200 && JSON.stringify(namesOf(r)) === JSON.stringify([...GA, 'med-a'].sort())), JSON.stringify(u.map(namesOf)));
        ok('…de los demás solo el perfil público (sin correo, estado ni último acceso); su propio registro, completo', u.every((r) => r.json.find((x) => x.id === 'ra-1')?.email === 'ra-1@fixture.invalid' && r.json.filter((x) => x.id !== 'ra-1').every((x) => !('email' in x) && !('accountStatus' in x) && !('lastLoginAt' in x))));
        ok('…ningún lector de Quinto B, del club de lectura, de la otra institución ni personal', u.every((r) => ![...GA2, ...GA3, ...GB, ...PERSONAL].some((id) => scan(r.text).ids.includes(id))), JSON.stringify(u.map((r) => scan(r.text).ids)));
        const g = [await raw(S1, '/api/groups', C['ra-1']), await raw(S2, '/api/groups', C['ra-1'])];
        const ids = (r) => (r.json || []).map((x) => x.id).sort();
        ok('grupos: el suyo completo y los clubes abiertos de SU institución; ni otros cursos ni nada de la otra institución', g.every((r) => r.status === 200 && JSON.stringify(ids(r)) === JSON.stringify(['g-a', 'g-aclub'])), JSON.stringify(g.map(ids)));
        ok('su grupo trae su nómina (información funcional)', g.every((r) => r.json.find((x) => x.id === 'g-a').memberIds.length === GA.length));
        const other = await probe(C['ra-1'], [...GRP('g-a2'), ...GRP('g-a3'), ...GRP('g-b'), ...IND('rx-1', 'g-a2', 'c2')]);
        ok('las rutas directas de otros cursos siguen negadas', other.every((r) => r.ids.length === 0 && r.sent.length === 0 && !r.st.includes(200)), brief(other.filter((r) => r.st.includes(200) || r.ids.length)));
        const ux = await raw(S1, '/api/users', C['rx-1']), ub = await raw(S2, '/api/users', C['rb-1']), up = await raw(S1, '/api/users', C['pb-1']), gp = await raw(S2, '/api/groups', C['pb-1']);
        ok('simétrico: Quinto B solo ve a Quinto B; la institución B solo a la suya; la cuenta personal, solo la suya y ningún grupo', JSON.stringify(namesOf(ux)) === JSON.stringify([...GA2, 'med-a2'].sort()) && namesOf(ub).every((id) => GB.includes(id) || id === 'med-b') && JSON.stringify(namesOf(up)) === '["pb-1"]' && Array.isArray(gp.json) && gp.json.length === 0, JSON.stringify([namesOf(ux), namesOf(ub), namesOf(up)]));
    }

    section('[5] clubes abiertos: descubribles sin exponer participantes');
    {
        const jx = await post(S1, '/api/groups/g-aclub/join', C['rx-1'], {});
        const before = await raw(S2, '/api/groups', C['ra-1']);
        const club = before.json.find((x) => x.id === 'g-aclub');
        ok('un lector de Quinto B se une al club abierto', jx.status === 200);
        ok('otro lector descubre el club: nombre, tipo, que es abierto y cuántos son — sin participantes', !!club && club.name === 'Club abierto Alfa' && club.type === 'club' && club.kind === 'open' && club.memberCount === 1 && club.memberIds.length === 0 && club.studentIds.length === 0 && club.membersWithheld === true && !before.text.includes('"rx-1"'), JSON.stringify(club));
        ok('…y antes de unirse no recibe el perfil de quien ya está dentro', !namesOf(await raw(S1, '/api/users', C['ra-1'])).includes('rx-1'));
        const far = await post(S1, '/api/groups/g-bclub/join', C['ra-1'], {});
        ok('no descubre ni puede unirse al club abierto de la otra institución', far.status === 403 && !before.json.some((x) => x.id === 'g-bclub'));
        const j1 = await post(S1, '/api/groups/g-aclub/join', C['ra-1'], {});
        const after = [await raw(S1, '/api/groups', C['ra-1']), await raw(S2, '/api/groups', C['ra-1'])], ua = [await raw(S1, '/api/users', C['ra-1']), await raw(S2, '/api/users', C['ra-1'])];
        ok('al unirse (acceso legítimo) recibe el club con sus participantes, en las dos réplicas', j1.status === 200 && after.every((r) => { const c = r.json.find((x) => x.id === 'g-aclub'); return c && c.memberIds.includes('rx-1') && c.memberIds.includes('ra-1') && c.membersWithheld === undefined; }));
        ok('…y el perfil público de quienes comparten el club con él, y de quien lo media (interacción entre lectores autorizados)', ua.every((r) => namesOf(r).includes('rx-1') && namesOf(r).includes('med-a2') && !namesOf(r).includes('rx-2') && !('email' in r.json.find((x) => x.id === 'rx-1'))), JSON.stringify(ua.map(namesOf)));
        const rm = await send(S1, 'DELETE', '/api/groups/g-aclub/members/ra-1', C['adm']);
        const gone = [await raw(S1, '/api/users', C['ra-1']), await raw(S2, '/api/users', C['ra-1']), await raw(S2, '/api/groups', C['ra-1'])];
        ok('al salir del club deja de recibirlos de inmediato, en las dos réplicas', rm.status === 200 && !namesOf(gone[0]).includes('rx-1') && !namesOf(gone[1]).includes('rx-1') && gone[2].json.find((x) => x.id === 'g-aclub').memberIds.length === 0, `${rm.status} ${JSON.stringify(namesOf(gone[0]))}`);
    }

    section('[6] mediadores, C005 y A2: sin cambios');
    {
        const u = await raw(S1, '/api/users', C['med-a']), g = await raw(S2, '/api/groups', C['med-a']);
        ok('la mediadora conserva la nómina de su institución (perfil público de los que no son suyos) y sus grupos completos', READERS_A.every((id) => namesOf(u).includes(id)) && u.json.find((x) => x.id === 'ra-1')?.email === 'ra-1@fixture.invalid' && !u.json.find((x) => x.id === 'rx-2')?.email && g.json.find((x) => x.id === 'g-a').memberIds.length === GA.length);
        ok('…y sigue sin recibir cuentas personales', !PERSONAL.some((id) => scan(u.text).ids.includes(id)));
        decide('ra-2', 'A2', 'revoked', 'legal_representative');
        const a2 = await probe(C['med-a'], IND('ra-2', 'g-a', 'c1'));
        ok('A2 revocada: el seguimiento individual de ese lector sigue retirado', a2.every((r) => r.sent.length === 0 && r.st.every((s) => [403, 404, 503].includes(s))), brief(a2.filter((r) => r.st.includes(200))));
        decide('med-a', 'C005', 'revoked', 'mediator');
        const c5 = await probe(C['med-a'], [...GLOBAL, ...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1')]);
        ok('C005 revocado: ninguna ruta entrega un lector', c5.every((r) => r.ids.length === 0 && r.sent.length === 0), brief(c5.filter((r) => r.ids.length || r.sent.length)));
        grantC005(['med-a']);
        ok('con el compromiso vigente de nuevo, vuelve', (await probe(C['med-a'], ['/api/groups/g-a/members']))[0].ids.includes('ra-1'));
        const xb = await probe(C['med-b'], [...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1')]);
        ok('aislamiento entre instituciones', xb.every((r) => r.ids.length === 0 && r.sent.length === 0 && !r.st.includes(200)));
    }

    section('[7] política de caché de la API');
    {
        const actors = { adm: [...GLOBAL, ...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1'), '/api/access/by-user/pb-1', '/api/users', '/api/auth/me'], 'med-a': [...GLOBAL, ...GRP('g-a'), ...IND('ra-1', 'g-a', 'c1'), '/api/auth/me'],
            'ra-1': ['/api/users', '/api/groups', '/api/progress/user/ra-1', '/api/reading-progress/ra-1', '/api/access/by-user/ra-1', '/api/auth/me', '/api/content/c1/access?userId=ra-1'], 'pb-1': ['/api/progress/user/pb-1', '/api/auth/me', '/api/access/by-user/pb-1', '/api/users'] };
        const rows = [];
        for (const [who, routes] of Object.entries(actors)) for (const r of await probe(C[who], routes)) rows.push({ who, ...r });
        const bad = rows.filter((r) => !r.cc.every((c) => /no-store/.test(c) && !/public|max-age=[1-9]/.test(c)));
        ok(`${rows.length} respuestas autenticadas (200, 403 y 404) de cuatro perfiles, en las dos réplicas: todas con «no-store»`, rows.length > 80 && bad.length === 0, JSON.stringify(bad.map((r) => [r.who, r.p, r.cc])));
        ok('incluidas las que antes salían sin política (nómina, tablero, progreso, seguimiento, lista de usuarios)', ['/api/groups/g-a/members', '/api/metrics/course/g-a', '/api/progress/user/ra-1', '/api/students/ra-1/status', '/api/users'].every((p) => rows.filter((r) => r.p === p && r.st.includes(200)).length > 0));
        const anon = await raw(S1, '/api/users', null), err = await raw(S2, '/api/no-existe', C['ra-1']);
        ok('también las negativas sin sesión y los 404', /no-store/.test(anon.cc) && /no-store/.test(err.cc), `${anon.status}:${anon.cc} ${err.status}:${err.cc}`);
        // La misma URL para dos personas: sin almacenamiento posible, cada una recibe lo suyo.
        const a = await raw(S1, '/api/users', C['ra-1']), b = await raw(S1, '/api/users', C['rx-1']), c = await raw(S1, '/api/auth/me', C['ra-1']), d = await raw(S1, '/api/auth/me', C['pb-1']);
        ok('la misma URL pedida por dos personas no puede reutilizarse entre ellas: cuerpos distintos y ambas no almacenables', a.text !== b.text && c.json.id === 'ra-1' && d.json.id === 'pb-1' && [a, b, c, d].every((r) => /private, no-store/.test(r.cc)));
        const health = await raw(S1, '/api/health', null);
        TABLA['/api/health'] = health.cc;
        const html = await fetch(`${S1.base}/uploads/no-existe.epub`); await html.text();
        ok('los recursos editoriales (/uploads) no reciben esta política: conservan la suya', !/private, no-store/.test(html.headers.get('cache-control') || ''), html.headers.get('cache-control') || '(sin cabecera)');
    }

    section('[8] respuestas tardías, concurrencia y dos réplicas');
    {
        const j = await post(S1, '/api/groups/g-aclub/join', C['ra-2'], {});
        const shots = []; let stop = false; const running = [];
        const fire = async (s, who, p) => { const t0 = Date.now(); const r = await raw(s, p, C[who]); shots.push({ who, p, t0, ids: scan(r.text).ids }); };
        const loop = (async () => { while (!stop) { for (const s of [S1, S2]) { running.push(fire(s, 'ra-2', '/api/users')); running.push(fire(s, 'ra-2', '/api/groups')); } await sleep(15); } })();
        await sleep(120);
        const rm = await send(S1, 'DELETE', '/api/groups/g-aclub/members/ra-2', C['adm']);
        const removedAt = Date.now();
        await sleep(350); stop = true; await loop; await Promise.all(running);
        const after = shots.filter((x) => x.t0 > removedAt), late = after.filter((x) => x.ids.includes('rx-1'));
        ok(`${shots.length} peticiones concurrentes de un lector alrededor de su salida de un club: las ${after.length} iniciadas después no traen a los participantes`, j.status === 200 && rm.status === 200 && after.length > 10 && late.length === 0, JSON.stringify(late.slice(0, 3)));
        const adminShots = []; stop = false; const run2 = [];
        const loop2 = (async () => { while (!stop) { for (const s of [S1, S2]) for (const p of ['/api/progress/user/pb-1', '/api/reading-progress/pm-1', '/api/progress/item/ra-4/c3']) run2.push((async () => { const r = await raw(s, p, C['adm']); adminShots.push({ p, st: r.status, sent: scan(r.text).sent }); })()); await sleep(15); } })();
        await sleep(300); stop = true; await loop2; await Promise.all(run2);
        ok(`${adminShots.length} consultas administrativas concurrentes a lectura personal en las dos réplicas: todas 403, ninguna con lectura`, adminShots.length > 30 && adminShots.every((x) => x.st === 403 && x.sent.length === 0), JSON.stringify(adminShots.filter((x) => x.st !== 403).slice(0, 3)));
    }
} catch (e) {
    console.error('  ✗ excepción', e?.stack || e); fail++;
} finally {
    for (const s of [S1, S2]) { try { s.child.kill('SIGTERM'); } catch { /* */ } }
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nTABLA ${JSON.stringify(TABLA)}`);
console.log(`\nprivacyScopeHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
