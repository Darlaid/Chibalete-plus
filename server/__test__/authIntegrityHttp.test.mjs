/**
 * authIntegrityHttp.test.mjs — CHP V9 65E-A (Bloque I). Autorización de nóminas e integridad de constancias.
 *
 * Contrato de Dirección: un mediador sin C005 vigente no sigue consultando información identificable de la nómina ni
 * información institucional restringida. Con server.js REAL, dos instituciones, tres cursos y dos réplicas:
 *   [1] con C005 vigente: las operaciones legítimas del mediador responden y traen su nómina
 *   [2] aislamiento entre instituciones y entre cursos (con C005 vigente)
 *   [3] C005 revocado: barrido de TODAS las rutas de consulta — ninguna entrega un lector (id, nombre o correo)
 *   [4] …pero la administración, los demás mediadores y los lectores conservan lo suyo
 *   [5] el compromiso vuelve a estar vigente: el acceso se recupera sin reiniciar nada
 *   [6] constancias: un reintento idéntico por la otra réplica no mueve la fecha de recepción ni duplica la sesión
 *   [7] un reintento tras la caducidad no recrea la constancia; la lectura queda «no atribuible»
 *   [8] métricas administrativas calculadas a la vez que el ICDLI contextual: mismas cifras que en solitario
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/authIntegrityHttp.test.mjs
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
    console.log('authIntegrityHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 1400)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9_65ea_'));
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
const GA = ['ra-1', 'ra-2', 'ra-3', 'ra-4', 'ra-5', 'ra-6'], GA3 = ['rc-1', 'rc-2'], GA2 = ['rx-1', 'rx-2'], GB = ['rb-1', 'rb-2'];
const READERS_A = [...GA, ...GA3, ...GA2];
fs.writeFileSync(P.users, JSON.stringify([acct('adm', 'Administración', ['administrador']),
    acct('med-a', 'Mediadora Alfa', ['mediador'], { mediatorKind: 'teacher', ...A }), acct('med-a2', 'Mediador Alfa Dos', ['mediador'], { mediatorKind: 'teacher', ...A }),
    acct('med-b', 'Mediadora Beta', ['mediador'], { mediatorKind: 'teacher', ...B }),
    ...READERS_A.map((id) => reader(id, A)), ...GB.map((id) => reader(id, B))]));
const grp = (id, name, org, school, mediatorIds, members) => ({ id, name, type: 'course', ...org, school, mediatorIds, memberIds: members, studentIds: members });
const GROUPS = [grp('g-a', 'Quinto A', A, 'Colegio Alfa', ['med-a'], GA), grp('g-a3', 'Club de lectura', A, 'Colegio Alfa', ['med-a'], GA3),
    grp('g-a2', 'Quinto B', A, 'Colegio Alfa', ['med-a2'], GA2), grp('g-b', 'Sexto', B, 'Colegio Beta', ['med-b'], GB)];
const RULES = [{ id: 'r-g-a', scope: 'group', scopeId: 'g-a', titleIds: ['c1'], collectionIds: [] }, { id: 'r-g-a3', scope: 'group', scopeId: 'g-a3', titleIds: ['c1'], collectionIds: [] },
    { id: 'r-g-a2', scope: 'group', scopeId: 'g-a2', titleIds: ['c2'], collectionIds: [] }, { id: 'r-g-b', scope: 'group', scopeId: 'g-b', titleIds: ['cb'], collectionIds: [] }];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.access, JSON.stringify(RULES));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra del curso'], ['c2', 'Obra del otro curso'], ['cb', 'Obra de la otra institución']].map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), '[]');
fs.writeFileSync(path.join(P.data, 'interventions_db.json'), JSON.stringify({ interventions: [] }));
// Memoria acumulada e interacciones de Leo (entradas del cálculo ADMINISTRATIVO del tablero).
const NOW = Date.now(), DAY = 86_400_000, MIN = 60_000, iso = (ms) => new Date(ms).toISOString();
fs.writeFileSync(path.join(P.data, 'leo_interactions_db.json'), JSON.stringify(GA.flatMap((u, i) => Array.from({ length: 3 + i }, (_, k) => ({ userId: u, contentId: 'c1', timestamp: NOW - (k + 1) * 3_600_000, type: 'chat' })))));

const REG = a2RegistryPath();
grantA2([...READERS_A, ...GB]);
grantC005(['med-a', 'med-a2', 'med-b']);

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

// Un lector de cualquier nómina: su id entre comillas, su nombre o su correo.
const READER_MARK = /"(ra|rc|rx|rb)-\d+"|Estudiante (ra|rc|rx|rb)-\d|(ra|rc|rx|rb)-\d+@fixture\.invalid/;
// Todas las rutas de consulta que puede tocar quien media g-a (propias, de otro curso y de la otra institución).
const SWEEP = ['/api/users', '/api/groups',
    '/api/groups/g-a/members', '/api/groups/g-a/candidates', '/api/groups/g-a/diagnosis', '/api/groups/g-a/analytics-summary',
    '/api/groups/g-a3/members', '/api/groups/g-a3/diagnosis', '/api/groups/g-a2/members', '/api/groups/g-b/members',
    '/api/groups/g-a/students/ra-1/progress', '/api/students/ra-1/status', '/api/students/ra-1/export-submissions',
    '/api/metrics/course/g-a', '/api/reports/course/g-a', '/api/metrics/student/ra-1', '/api/metrics/schools', '/api/metrics/school/org-a',
    '/api/progress/user/ra-1', '/api/progress/item/ra-1/c1', '/api/reading-progress/ra-1', '/api/reading-progress/ra-1/c1',
    '/api/interventions/course/g-a', '/api/interventions/student/ra-1', '/api/interventions/effectiveness?courseId=g-a',
    '/api/leo/mediator/student/ra-1', '/api/leo/mediator/student/ra-1/content/c1', '/api/leo/activation/ra-1', '/api/leo/memory/ra-1/c1',
    '/api/membership-governance/groups', '/api/experiences/review/queue', '/api/access/by-user/ra-1', '/api/schools', '/api/sections',
    '/api/aula-viva/students-needing-attention', '/api/aula-viva/recommendations', '/api/aula-viva/operational/status', '/api/aula-viva/institutional/status',
    '/api/aula-viva/students/ra-1/timeline', '/api/aula-viva/students/ra-1/feature-vector', '/api/aula-viva/students/ra-1/risk-history',
    '/api/aula-viva/cohorts/group/g-a', '/api/aula-viva/cohorts/group/g-a/rollups', '/api/aula-viva/recommendations/scope/group/g-a',
    '/api/aula-viva/institutional/profile/ra-1', '/api/aula-viva/institutional/outcomes/scope/group/g-a', '/api/aula-viva/institutional/learnings/scope/group/g-a',
    '/api/aula-viva/institutional/cohorts/definitions', '/api/aula-viva/institutional/outcomes/follow-up-queue'];
const sweep = async (cookie) => { const out = []; for (const p of SWEEP) for (const s of [S1, S2]) { const r = await get(s, p, cookie);
    // Una negativa repite el id que el propio llamante puso en la URL (`scope_id`): eso no es un dato entregado.
    const body = r.status === 403 ? r.text.replace(/"scope_id":"[^"]*"/g, '') : r.text;
    out.push({ p, status: r.status, leak: READER_MARK.test(body), sample: (body.match(READER_MARK) || [''])[0] }); } return out; };

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-a2', 'med-b', 'ra-1', 'ra-2', 'ra-6', 'rx-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    const Reg = await import('../privacy/a2Registry.mjs');
    const revokeC005 = (id, ref) => Reg.appendDecisions([{ subjectId: id, kind: 'C005', status: 'revoked', actDay: Reg.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: ref }]);
    const names = (r) => (Array.isArray(r.json) ? r.json : []).filter((u) => /^Estudiante /.test(u?.nombre_completo || '')).map((u) => u.id).sort();
    const rosterOf = (r, g) => (Array.isArray(r.json) ? r.json : []).find((x) => x.id === g);

    section('[1] con C005 vigente: operaciones legítimas del mediador');
    let before;
    {
        const u = await both('/api/users', C['med-a']), g = await both('/api/groups', C['med-a']);
        ok('la lista de usuarios trae a los lectores de su institución, y de los suyos también el correo', u.every((r) => r.status === 200 && names(r).length === READERS_A.length && r.json.find((x) => x.id === 'ra-1')?.email === 'ra-1@fixture.invalid' && !r.json.find((x) => x.id === 'rx-1')?.email), st(u));
        ok('los grupos traen su nómina', g.every((r) => r.status === 200 && rosterOf(r, 'g-a')?.memberIds?.length === GA.length && rosterOf(r, 'g-a3')?.memberIds?.length === GA3.length && rosterOf(r, 'g-a')?.rosterWithheld !== true), st(g));
        for (const sub of ['members', 'candidates', 'diagnosis']) { const r = await both(`/api/groups/g-a/${sub}`, C['med-a']); ok(`/groups/g-a/${sub}: 200`, r.every((x) => x.status === 200), st(r)); }
        const m = await both('/api/groups/g-a/members', C['med-a']);
        ok('la nómina identifica a los seis lectores', m.every((x) => GA.every((id) => x.text.includes(`"${id}"`))), st(m));
        before = await sweep(C['med-a']);
        ok('el barrido de rutas responde (ningún 5xx inesperado)', before.every((x) => x.status < 500 || x.status === 503), JSON.stringify(before.filter((x) => x.status >= 500)));
    }

    section('[2] aislamiento entre instituciones y entre cursos (C005 vigente)');
    {
        ok('la otra institución: ni su nómina ni sus lectores', (await both('/api/groups/g-b/members', C['med-a'])).every((x) => x.status === 403) && before.every((x) => !/rb-/.test(x.sample)), JSON.stringify(before.filter((x) => /rb-/.test(x.sample))));
        ok('un curso de su institución que no media: sin nómina detallada ni diagnóstico', (await both('/api/groups/g-a2/members', C['med-a'])).every((x) => x.status === 403) && (await both('/api/groups/g-a2/diagnosis', C['med-a'])).every((x) => x.status === 403));
        ok('el seguimiento de un lector de otro curso: 403', (await both('/api/students/rx-1/status', C['med-a'])).every((x) => x.status === 403));
    }

    section('[3] C005 revocado: ninguna ruta de consulta entrega un lector');
    revokeC005('med-a', 'C2-SINT-65EA-REV');
    {
        const after = await sweep(C['med-a']);
        const leaks = after.filter((x) => x.leak);
        ok(`barrido de ${SWEEP.length} rutas en las dos réplicas: ninguna respuesta contiene el id, el nombre o el correo de un lector`, leaks.length === 0, JSON.stringify(leaks.map((x) => `${x.p} ${x.status} ${x.sample}`)));
        for (const sub of ['members', 'candidates', 'diagnosis']) for (const g of ['g-a', 'g-a3']) { const r = await both(`/api/groups/${g}/${sub}`, C['med-a']); ok(`/groups/${g}/${sub}: 403 scope_access_denied en las dos réplicas`, r.every((x) => x.status === 403 && x.json?.error === 'scope_access_denied'), st(r)); }
        const u = await both('/api/users', C['med-a']), g = await both('/api/groups', C['med-a']);
        ok('la lista de usuarios responde 200 con su propia cuenta y sin ningún lector', u.every((r) => r.status === 200 && names(r).length === 0 && r.json.some((x) => x.id === 'med-a')), st(u));
        ok('los grupos responden 200, siguen diciéndole cuáles media, y la nómina va retenida y declarada', g.every((r) => r.status === 200 && rosterOf(r, 'g-a')?.mediatorIds?.includes('med-a') && rosterOf(r, 'g-a')?.memberIds?.length === 0
            && rosterOf(r, 'g-a')?.studentIds?.length === 0 && rosterOf(r, 'g-a')?.rosterWithheld === true && rosterOf(r, 'g-a2')?.memberIds?.length === 0), st(g));
        ok('ninguna de esas rutas falla con 5xx por la retención', after.every((x) => x.status < 500 || x.status === 503), JSON.stringify(after.filter((x) => x.status >= 500)));
    }

    section('[4] los demás conservan lo suyo');
    {
        const adm = await both('/api/groups/g-a/members', C['adm']), admU = await both('/api/users', C['adm']), admG = await both('/api/groups', C['adm']);
        ok('administración: nómina, usuarios y grupos completos', adm.every((x) => x.status === 200 && GA.every((id) => x.text.includes(`"${id}"`))) && admU.every((r) => names(r).length === READERS_A.length + GB.length)
            && admG.every((r) => rosterOf(r, 'g-a')?.memberIds?.length === GA.length && rosterOf(r, 'g-a')?.rosterWithheld !== true), st([...adm, ...admG]));
        for (const sub of ['candidates', 'diagnosis']) ok(`administración: /groups/g-a/${sub} 200`, (await both(`/api/groups/g-a/${sub}`, C['adm'])).every((x) => x.status === 200));
        const m2 = await both('/api/groups/g-a2/members', C['med-a2']), g2 = await both('/api/groups', C['med-a2']), u2 = await both('/api/users', C['med-a2']);
        ok('el otro mediador de la institución (C005 vigente): su nómina, sus grupos y sus lectores, sin cambios', m2.every((x) => x.status === 200 && x.text.includes('"rx-1"')) && g2.every((r) => rosterOf(r, 'g-a2')?.memberIds?.length === GA2.length && rosterOf(r, 'g-a')?.memberIds?.length === GA.length)
            && u2.every((r) => names(r).length === READERS_A.length && r.json.find((x) => x.id === 'rx-1')?.email === 'rx-1@fixture.invalid'), st([...m2, ...g2]));
        const mb = await both('/api/groups/g-b/members', C['med-b']);
        ok('el mediador de la otra institución: sin cambios', mb.every((x) => x.status === 200 && x.text.includes('"rb-1"') && !/"ra-/.test(x.text)), st(mb));
        const ru = await both('/api/users', C['ra-1']), rg = await both('/api/groups', C['ra-1']);
        // V9 BIII F5-DP: un lector recibe a sus compañeros de grupo, no a toda la institución.
        ok('un lector: su perfil completo y el perfil público de sus compañeros de curso', ru.every((r) => r.status === 200 && r.json.find((x) => x.id === 'ra-1')?.email === 'ra-1@fixture.invalid' && names(r).length === GA.length && !r.json.find((x) => x.id === 'ra-2')?.email && !r.json.some((x) => x.id === 'rx-1')) && rg.every((r) => r.status === 200), st(ru));
    }

    section('[5] el compromiso vuelve a estar vigente');
    {
        grantC005(['med-a']);
        const m = await both('/api/groups/g-a/members', C['med-a']), g = await both('/api/groups', C['med-a']), u = await both('/api/users', C['med-a']);
        ok('nómina, grupos y lectores vuelven, en las dos réplicas y sin reiniciar', m.every((x) => x.status === 200) && g.every((r) => rosterOf(r, 'g-a')?.memberIds?.length === GA.length && rosterOf(r, 'g-a')?.rosterWithheld !== true) && u.every((r) => names(r).length === READERS_A.length), st([...m, ...g]));
    }

    section('[6] constancias: reintento idéntico por la otra réplica');
    const progressBody = (sid, startedMs, minutes) => ({ canonicalProgress: { sentenceIndex: 0, totalSentences: 0, globalPercentage: 30, lastInteractedMode: 'text' }, updatedAt: iso(startedMs + minutes * MIN),
        session: { sessionId: sid, startedAt: iso(startedMs), durationSec: minutes * 60, mode: 'text' } });
    const rec = (u, sid) => sql(P.insights, `SELECT first_received_ts f, last_received_ts l, duration_sec d, conflict c FROM reading_session_receipts WHERE user_id = ? AND session_id = ?`, u, sid);
    const tablero = async (u) => (await both('/api/metrics/course/g-a', C['med-a'])).map((x) => { const q = (x.json?.studentBreakdown || []).find((s) => s.userId === u); return q && [q.totalSessions, Math.round(q.totalReadingTimeMs / MIN), q.dataState]; });
    {
        const started = NOW - 40 * MIN, body = progressBody('rt-1', started, 12);
        const w1 = await post(S1, '/api/progress/ra-1/c1/sync', C['ra-1'], body);
        const r1 = rec('ra-1', 'rt-1');
        await sleep(1200);
        const w2 = await post(S2, '/api/progress/ra-1/c1/sync', C['ra-1'], body);                       // el MISMO cuerpo, por la otra réplica
        const w3 = await post(S1, '/api/progress/ra-1/c1/sync', C['ra-1'], progressBody('rt-1', started, 5));   // un envío atrasado, con menos duración
        const r2 = rec('ra-1', 'rt-1');
        ok('el guardado y sus reintentos se aceptan', [w1, w2, w3].every((w) => w.status === 200), st([w1, w2, w3]));
        ok('una sola constancia; ni la primera ni la última recepción cambian con los reintentos; la duración no se reduce', r1.length === 1 && r2.length === 1 && r2[0].f === r1[0].f && r2[0].l === r1[0].l && r2[0].d === 720 && r2[0].c === 0, JSON.stringify([r1, r2]));
        ok('el tablero cuenta una sola sesión de 12 minutos en las dos réplicas', (await tablero('ra-1')).every((q) => q && q[0] === 1 && q[1] === 12 && q[2] === 'verified_context'), JSON.stringify(await tablero('ra-1')));
        await sleep(1200);
        const w4 = await post(S2, '/api/progress/ra-1/c1/sync', C['ra-1'], progressBody('rt-1', started, 20));  // la sesión CONTINÚA: evidencia nueva
        const r3 = rec('ra-1', 'rt-1');
        ok('si la sesión continúa (más duración), eso sí es una recepción nueva: la última recepción avanza y la primera no', w4.status === 200 && r3[0].f === r1[0].f && r3[0].l > r1[0].l && r3[0].d === 1200, JSON.stringify(r3));
    }

    section('[7] reintento después de la caducidad');
    {
        // ra-2 leyó hace catorce meses (sesión fechada por el dispositivo); su constancia se sembró entonces y ya caducó.
        const old = NOW - 425 * DAY, body = progressBody('old-1', old, 15);
        const L = await import('../aulaViva/contextLedger.mjs');
        L.recordSessionReceipt({ userId: 'ra-2', workId: 'c1', sessionId: 'old-1', declaredStartTs: old, durationSec: 900, mode: 'text', fromOrigin: true, nowTs: old + 15 * MIN });
        // Antes de la poda: el reintento idéntico no la renueva (sigue fechada hace catorce meses ⇒ sigue vencida).
        const pre = await post(S1, '/api/progress/ra-2/c1/sync', C['ra-2'], body);
        const kept = rec('ra-2', 'old-1');
        ok('reintento idéntico de una constancia ya vencida pero aún no podada: su última recepción no se mueve', pre.status === 200 && kept.length === 1 && kept[0].l === old + 15 * MIN, JSON.stringify(kept));
        process.env.AULA_VIVA_CONTEXT_LEDGER_RETENTION_ENABLED = '1';
        const pruned = L.pruneContextLedger({ nowTs: Date.now() });
        ok('la poda la retira (y no toca la constancia reciente del otro lector)', pruned.ok && pruned.receipts_removed === 1 && rec('ra-2', 'old-1').length === 0 && rec('ra-1', 'rt-1').length === 1, JSON.stringify(pruned));
        const again = [await post(S1, '/api/progress/ra-2/c1/sync', C['ra-2'], body), await post(S2, '/api/progress/ra-2/c1/sync', C['ra-2'], body)];
        ok('el reintento posterior a la poda se acepta como guardado (el progreso del lector no se rechaza)…', again.every((w) => w.status === 200), st(again));
        ok('…pero NO recrea la constancia en ninguna réplica', rec('ra-2', 'old-1').length === 0, JSON.stringify(rec('ra-2', 'old-1')));
        ok('…y esa lectura queda como «no atribuible» para el mediador, nunca acreditada ni «sin actividad»', (await tablero('ra-2')).every((q) => q && q[0] === 0 && q[2] === 'unverifiable_history'), JSON.stringify(await tablero('ra-2')));
        // Una sesión NUEVA del mismo lector sí deja constancia y se acredita.
        const fresh = await post(S2, '/api/progress/ra-2/c1/sync', C['ra-2'], progressBody('new-1', Date.now() - 8 * MIN, 8));
        ok('una sesión nueva del mismo lector sí deja constancia y cuenta (1 sesión, 8 min)', fresh.status === 200 && rec('ra-2', 'new-1').length === 1 && (await tablero('ra-2')).every((q) => q && q[0] === 1 && q[1] === 8), JSON.stringify(await tablero('ra-2')));
        // Supresión del titular: sin regresión, lo ajeno intacto.
        const SUP = await import('../privacy/suppression.mjs');
        const paths = SUP.residualPaths({ CHP_DATA_DIR: P.data, EVENTS_SQLITE_PATH: P.events, ARCHIVE_SQLITE_PATH: path.join(P.data, 'archive.db'), PROGRESS_SQLITE_PATH: P.progress,
            LEO_EVIDENCE_DB: P.evidence, USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), ACCESS_DB: P.access, INSIGHTS_SQLITE_PATH: P.insights }, tmp);
        await SUP.suppressResidualSources(paths, 'ra-2');
        ok('supresión del titular: ninguna constancia suya; la del otro lector sigue', sql(P.insights, `SELECT COUNT(*) n FROM reading_session_receipts WHERE user_id = 'ra-2'`)[0].n === 0 && rec('ra-1', 'rt-1').length === 1);
        L.closeContextLedger();
    }

    section('[8] métricas administrativas mientras se calcula el ICDLI contextual');
    {
        // Referencia: el tablero administrativo en solitario (cuenta las interacciones de Leo de toda la nómina).
        const solo = await get(S1, '/api/metrics/course/g-a', C['adm']);
        const expected = solo.json?.summary?.totalLeoInteractions;
        // V9 65E-B: ra-2 se suprimió en [7] (sus 4 interacciones ya no existen en el almacén). Antes esta referencia daba 33
        // porque la réplica seguía sirviendo hasta 30 s su copia anterior del registro de Leo; ahora la copia se valida
        // contra el archivo y la supresión rige en el cálculo siguiente: 33 − 4 = 29.
        ok('referencia en solitario: el agregado administrativo cuenta las interacciones de Leo de la nómina, sin las del titular suprimido (29)', solo.status === 200 && expected === GA.reduce((n, u, i) => n + (u === 'ra-2' ? 0 : 3 + i), 0) && expected === 29, JSON.stringify(solo.json?.summary));
        // Ráfagas simultáneas en la MISMA réplica: tablero administrativo e ICDLI contextual del mediador.
        const wrong = [];
        let icdliOk = 0;
        for (let round = 0; round < 12; round++) {
            const reqs = [];
            for (let k = 0; k < 6; k++) {
                reqs.push(get(S1, '/api/leo/mediator/student/ra-1', C['med-a']).then((r) => { if (r.status === 200) icdliOk++; return null; }));
                reqs.push(get(S1, '/api/metrics/course/g-a', C['adm']).then((r) => r));
                reqs.push(get(S1, '/api/reports/course/g-a', C['adm']).then((r) => r));
            }
            for (const r of (await Promise.all(reqs)).filter(Boolean)) if (r.status !== 200 || r.json?.summary?.totalLeoInteractions !== expected) wrong.push(`${r.status}:${r.json?.summary?.totalLeoInteractions}`);
        }
        ok('el ICDLI contextual del mediador respondió durante la prueba', icdliOk > 0, String(icdliOk));
        ok('144 cálculos administrativos concurrentes: todos con las mismas cifras que en solitario', wrong.length === 0, `${wrong.length} distintos: ${[...new Set(wrong)].join(',')}`);
    }
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1500));
} finally {
    for (const x of [S1, S2]) { try { x.child.kill('SIGKILL'); } catch { /* */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nauthIntegrityHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
