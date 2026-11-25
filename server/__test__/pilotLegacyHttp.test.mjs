/**
 * pilotLegacyHttp.test.mjs — CHP V9R-DEP1. Continuidad de los pilotos anteriores a V9 bajo la condición PILOT_LEGACY.
 *
 * Con server.js REAL, dos instituciones, cinco grupos y dos réplicas. Ninguna cuenta de piloto tiene A1, A2, A3, A5
 * ni C005 en el registro: no se anota ninguna autorización ficticia.
 *   [1] mediador de piloto: nómina, usuarios y resumen de SU curso del corte; nada de sus otros cursos ni de otros
 *   [2] seguimiento individual HISTÓRICO (progreso, estado, tablero, intervenciones): solo de los lectores con esa
 *       función en su pertenencia del corte
 *   [2b] funciones que no existían o no tenían datos antes de V9 (analítica derivada de Aula Viva, indicadores
 *       contextuales, Leo del mediador, XP): la condición de piloto NO las abre; con C005 + A2 siguen abiertas
 *   [3] barrido de rutas de consulta: ninguna entrega un lector ajeno al corte de ese mediador
 *   [4] lector de piloto: lee como antes; Leo se decide aparte (A3), y la condición de piloto no lo abre
 *   [5] cuentas y cursos nuevos: no heredan nada; la vía ordinaria (C005 + A2) no cambia
 *   [6] revocación de una pertenencia, negativa expresa de A2 y C005 revocado: rigen de inmediato en las dos réplicas
 *   [7] traslado de un lector y sustitución del mediador: la condición no viaja con ellos
 *   [8] cuenta desactivada: sin sesión
 *   [9] fin del régimen (sello revocado): vuelve a exigirse todo, sin reiniciar
 * POSIX-only (secretos de sesión): en win32 se OMITE (no cuenta como aprobada) y en CI una omisión es un fallo.
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/pilotLegacyHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { a2RegistryPath, grantA2, grantC005, grantOptional, pilotLine, sealPilot } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePorts } from './helpers/freePort.mjs';

if (process.platform === 'win32') {
    console.log('pilotLegacyHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 1600)), fail++);
const section = (t) => console.log(`\n${t}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_v9r_pilot_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), sessions: path.join(tmp, 'sessions.db'), key: path.join(tmp, 'session.key'),
    insights: path.join(tmp, 'insights.db'), events: path.join(tmp, 'events.db'), progress: path.join(tmp, 'progress.db'), evidence: path.join(tmp, 'leo_evidence.json') };
fs.mkdirSync(P.data, { recursive: true });
process.env.INSIGHTS_SQLITE_PATH = P.insights;
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, nombre, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: nombre, roles, accountStatus: 'active', ...extra });
const reader = (id, org) => acct(id, `Estudiante ${id}`, ['lector'], { ...org });
const mediator = (id, org) => acct(id, `Mediador ${id}`, ['mediador'], { mediatorKind: 'teacher', ...org });
// org-a · g-a  (piloto): med-a; ra-1…ra-5 con seguimiento, ra-6 solo nómina; ra-7 llegó DESPUÉS del corte.
//         g-new (curso posterior al corte): med-a; rn-1, rn-2.
//         g-a2 (mediador posterior al corte, sin C005): med-a2; rx-1, rx-2.
//         g-c  (vía ordinaria): med-c con C005; rc-1 con A2, rc-2 sin A2.
// org-b · g-b  (piloto): med-b; rb-1, rb-2 con seguimiento.
const GA_FOLLOW = ['ra-1', 'ra-2', 'ra-3', 'ra-4', 'ra-5'], GA_PILOT = [...GA_FOLLOW, 'ra-6'], GA = [...GA_PILOT, 'ra-7'];
const GNEW = ['rn-1', 'rn-2'], GA2 = ['rx-1', 'rx-2'], GC = ['rc-1', 'rc-2'], GB = ['rb-1', 'rb-2'];
fs.writeFileSync(P.users, JSON.stringify([acct('adm', 'Administración', ['administrador']),
    mediator('med-a', A), mediator('med-a2', A), mediator('med-c', A), mediator('med-sub', A), mediator('med-b', B),
    ...[...GA, ...GNEW, ...GA2, ...GC].map((id) => reader(id, A)), ...GB.map((id) => reader(id, B))]));
const grp = (id, name, org, school, mediatorIds, members) => ({ id, name, type: 'course', ...org, school, mediatorIds, memberIds: members, studentIds: members });
const GROUPS = [grp('g-a', 'Quinto A', A, 'Colegio Alfa', ['med-a'], GA), grp('g-new', 'Club nuevo', A, 'Colegio Alfa', ['med-a'], GNEW),
    grp('g-a2', 'Quinto B', A, 'Colegio Alfa', ['med-a2'], GA2), grp('g-c', 'Sexto A', A, 'Colegio Alfa', ['med-c'], GC), grp('g-b', 'Sexto', B, 'Colegio Beta', ['med-b'], GB)];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.access, JSON.stringify(GROUPS.map((g) => ({ id: `r-${g.id}`, scope: 'group', scopeId: g.id, titleIds: [g.organizationId === 'org-b' ? 'cb' : 'c1'], collectionIds: [] }))));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.content, JSON.stringify([['c1', 'Obra del colegio'], ['cb', 'Obra de la otra institución']].map(([id, titulo]) => ({ id, tipo: 'libro', titulo, etiquetas: [] }))));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), '[]');
fs.writeFileSync(path.join(P.data, 'interventions_db.json'), JSON.stringify({ interventions: [] }));
fs.writeFileSync(path.join(P.data, 'leo_interactions_db.json'), '[]');

// Registro: el piloto y su sello; la vía ordinaria solo para g-c. Nada más: ninguna autorización para cuentas de piloto.
const REG = a2RegistryPath();
grantC005(['med-c']);
grantA2(['rc-1']);
sealPilot([{ id: 'g-a', mediators: ['med-a'], readers: GA_PILOT, followup: GA_FOLLOW }, { id: 'g-b', mediators: ['med-b'], readers: GB }]);

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
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ready = async (s) => { let last = ''; for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch (e) { last = String(e?.cause?.code || e?.message || e); } await sleep(150); } throw new Error(`nunca healthy: ${last}`); };
const parse = async (r) => { const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ } return { status: r.status, json, text }; };
const get = async (s, p, cookie) => parse(await fetch(`${s.base}${p}`, { headers: cookie ? { cookie } : {} }));
const send = async (s, method, p, cookie, body) => parse(await fetch(`${s.base}${p}`, { method, headers: { cookie, 'Content-Type': 'application/json', Origin: s.base, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify(body ?? {}) }));
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: s.base }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};
const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
const both = async (p, cookie) => [await get(S1, p, cookie), await get(S2, p, cookie)];
const st = (rs) => rs.map((r) => `${r.status}:${r.text.slice(0, 300)}`).join(' | ');

// Lectores que una respuesta nombra: por id entre comillas, por nombre o por correo.
const readersIn = (text) => [...new Set([...text.matchAll(/"((?:ra|rn|rx|rc|rb)-\d+)"|Estudiante ((?:ra|rn|rx|rc|rb)-\d+)|((?:ra|rn|rx|rc|rb)-\d+)@fixture\.invalid/g)].map((m) => m[1] || m[2] || m[3]))].sort();
// Una negativa repite el id que el propio llamante puso en la URL (`scope_id`): eso no es un dato entregado.
const delivered = (r) => readersIn(r.status === 403 ? r.text.replace(/"scope_id":"[^"]*"/g, '') : r.text);
const namesIn = (r) => (Array.isArray(r.json) ? r.json : []).filter((u) => /^Estudiante /.test(u?.nombre_completo || '')).map((u) => u.id).sort();
const rosterOf = (r, g) => (Array.isArray(r.json) ? r.json : []).find((x) => x.id === g);
// Seguimiento que el mediador ya tenía antes de V9 (producción `secsess-642820d`).
const INDIVIDUAL = (R) => [`/api/students/${R}/status`, `/api/progress/user/${R}`, `/api/progress/item/${R}/c1`, `/api/reading-progress/${R}`, `/api/reading-progress/${R}/c1`, `/api/interventions/student/${R}`];
// Lo que V9 añade o recupera sobre un lector (en producción esos motores están apagados y sin filas), y lo que depende de Leo o de XP.
const NEW_INDIVIDUAL = (G, R) => [`/api/aula-viva/students/${R}/timeline`, `/api/aula-viva/students/${R}/feature-vector`, `/api/aula-viva/students/${R}/risk-history`,
    `/api/aula-viva/recommendations/scope/user/${R}`, `/api/aula-viva/institutional/profile/${R}`, `/api/aula-viva/institutional/outcomes/scope/user/${R}`,
    `/api/aula-viva/context/students/${R}/indicators`, `/api/leo/mediator/student/${R}`, `/api/leo/mediator/student/${R}/content/c1`, `/api/leo/activation/${R}`, `/api/groups/${G}/students/${R}/progress`];
const NEW_COLLECTIVE = ['/api/aula-viva/students-needing-attention', '/api/aula-viva/recommendations', '/api/aula-viva/institutional/outcomes/follow-up-queue', '/api/aula-viva/institutional/cohorts/definitions',
    '/api/aula-viva/cohorts/group/g-a', '/api/aula-viva/cohorts/group/g-a/rollups', '/api/aula-viva/recommendations/scope/group/g-a', '/api/aula-viva/institutional/outcomes/scope/group/g-a', '/api/aula-viva/institutional/learnings/scope/group/g-a'];
const SWEEP = (G, R) => ['/api/users', '/api/groups', `/api/groups/${G}/members`, `/api/groups/${G}/candidates`, `/api/groups/${G}/diagnosis`, `/api/groups/${G}/analytics-summary`,
    `/api/groups/${G}/students/${R}/progress`, `/api/students/${R}/export-submissions`, `/api/metrics/course/${G}`, `/api/reports/course/${G}`, '/api/metrics/schools', '/api/metrics/school/org-a',
    `/api/progress/item/${R}/c1`, `/api/reading-progress/${R}/c1`, `/api/interventions/course/${G}`, `/api/interventions/student/${R}`, `/api/leo/mediator/student/${R}`, `/api/leo/activation/${R}`,
    `/api/leo/memory/${R}/c1`, '/api/membership-governance/groups', '/api/experiences/review/queue', `/api/access/by-user/${R}`, '/api/aula-viva/students-needing-attention', '/api/aula-viva/recommendations',
    `/api/aula-viva/students/${R}/feature-vector`, `/api/aula-viva/students/${R}/risk-history`, `/api/aula-viva/cohorts/group/${G}`, `/api/aula-viva/cohorts/group/${G}/rollups`,
    `/api/aula-viva/recommendations/scope/group/${G}`, `/api/aula-viva/institutional/profile/${R}`, `/api/metrics/student/${R}`, '/api/aula-viva/institutional/outcomes/follow-up-queue', ...INDIVIDUAL(R)];
const sweep = async (cookie, routes) => { const out = []; for (const p of routes) for (const s of [S1, S2]) { const r = await get(s, p, cookie); out.push({ p, status: r.status, ids: delivered(r) }); } return out; };
const denied = (rs) => rs.every((r) => [403, 404].includes(r.status) && delivered(r).length === 0);
const open = (rs) => rs.every((r) => r.status === 200);

try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const id of ['adm', 'med-a', 'med-a2', 'med-c', 'med-sub', 'med-b', 'ra-1', 'ra-7', 'rc-1']) C[id] = await login(id.length % 2 ? S1 : S2, id);
    const Reg = await import('../privacy/a2Registry.mjs');
    const gateNow = () => Reg.decisionGate({ CHP_A2_REGISTRY: REG });

    section('[0] punto de partida: ninguna autorización ficticia');
    ok('las cuentas de piloto no tienen A1, A2, A3, A5 ni C005 en el registro', [...GA, ...GB].every((id) => ['A1', 'A2', 'A3', 'A5', 'P', 'T'].every((k) => gateNow().status(k, id) === 'pending'))
        && ['med-a', 'med-b'].every((id) => gateNow().status('C005', id) === 'pending'));

    section('[1] mediador de piloto: su curso del corte, y solo ese');
    {
        const g = await both('/api/groups', C['med-a']), u = await both('/api/users', C['med-a']), m = await both('/api/groups/g-a/members', C['med-a']);
        ok('grupos: la nómina de su curso del corte trae a los seis lectores del corte (no al que llegó después)', g.every((r) => r.status === 200 && (rosterOf(r, 'g-a')?.memberIds || []).slice().sort().join() === GA_PILOT.join()
            && rosterOf(r, 'g-a')?.rosterWithheld !== true && rosterOf(r, 'g-a')?.rosterPilotLegacy === true), st(g));
        ok('grupos: su curso posterior al corte sigue retenido y declarado', g.every((r) => rosterOf(r, 'g-new')?.memberIds?.length === 0 && rosterOf(r, 'g-new')?.rosterWithheld === true && rosterOf(r, 'g-new')?.mediatorIds?.includes('med-a')), st(g));
        ok('grupos: ningún otro curso trae nómina', g.every((r) => ['g-a2', 'g-c'].every((x) => !(rosterOf(r, x)?.memberIds?.length > 0))), st(g));
        ok('usuarios: los seis lectores del corte (con su correo) y ningún otro lector', u.every((r) => r.status === 200 && namesIn(r).join() === GA_PILOT.join() && r.json.find((x) => x.id === 'ra-1')?.email === 'ra-1@fixture.invalid'), st(u));
        ok('nómina del curso: 200 con exactamente los seis del corte', m.every((r) => r.status === 200 && delivered(r).join() === GA_PILOT.join()), st(m));
        for (const sub of ['candidates', 'diagnosis']) ok(`/groups/g-a/${sub}: sigue exigiendo C005 (403)`, denied(await both(`/api/groups/g-a/${sub}`, C['med-a'])));
        for (const x of ['g-new', 'g-a2', 'g-c', 'g-b']) ok(`nómina de ${x}: 403`, denied(await both(`/api/groups/${x}/members`, C['med-a'])));
        const s = await both('/api/groups/g-a/analytics-summary', C['med-a']);
        ok('resumen del curso: 200, con filas solo de lectores con seguimiento', s.every((r) => r.status === 200 && delivered(r).every((id) => GA_FOLLOW.includes(id)) && (r.json?.readers || []).every((x) => GA_FOLLOW.includes(x.userId))), st(s));
        ok('resumen del curso posterior al corte: 403', denied(await both('/api/groups/g-new/analytics-summary', C['med-a'])));
    }

    section('[2] seguimiento individual');
    {
        for (const p of INDIVIDUAL('ra-1')) { const r = await both(p, C['med-a']); ok(`${p}: no se niega (lector con seguimiento)`, r.every((x) => ![401, 403].includes(x.status) && x.status < 500), st(r)); }
        ok('estado y progreso del lector con seguimiento: 200', open(await both('/api/students/ra-1/status', C['med-a'])) && open(await both('/api/progress/user/ra-1', C['med-a'])));
        for (const [who, why] of [['ra-6', 'solo nómina'], ['ra-7', 'llegó después del corte'], ['rn-1', 'curso posterior al corte'], ['rx-1', 'otro curso'], ['rc-1', 'otro curso, con A2'], ['rb-1', 'otra institución']]) {
            const rs = []; for (const p of ['/status', ''].map((x) => (x ? `/api/students/${who}${x}` : `/api/progress/user/${who}`))) rs.push(...await both(p, C['med-a']));
            ok(`${who} (${why}): sin seguimiento individual`, denied(rs), st(rs));
        }
        ok('el mediador del otro piloto: los suyos sí, los de este no', open(await both('/api/students/rb-1/status', C['med-b'])) && denied(await both('/api/students/ra-1/status', C['med-b'])));
        const board = [...await both('/api/metrics/course/g-a', C['med-a']), ...await both('/api/reports/course/g-a', C['med-a'])];
        ok('tablero e informe del curso del corte: 200, y solo con lectores con seguimiento', board.every((r) => r.status === 200 && delivered(r).every((id) => GA_FOLLOW.includes(id))) && board.some((r) => delivered(r).includes('ra-1')), st(board));
        const iv = await send(S1, 'POST', '/api/interventions', C['med-a'], { studentId: 'ra-1', courseId: 'g-a', type: 'conversacion', note: 'seguimiento de lectura' });
        const ivNew = await send(S2, 'POST', '/api/interventions', C['med-a'], { studentId: 'ra-7', courseId: 'g-a', type: 'conversacion', note: 'seguimiento de lectura' });
        ok('intervención del tablero: sobre un lector con seguimiento no se niega; sobre el que llegó después del corte, 403', ![401, 403].includes(iv.status) && iv.status < 500 && ivNew.status === 403, st([iv, ivNew]));
    }

    section('[2b] funciones nuevas de V9, Leo del mediador y XP: la condición de piloto no las abre');
    {
        const rows = [];
        for (const p of NEW_INDIVIDUAL('g-a', 'ra-1')) for (const r of await both(p, C['med-a'])) rows.push({ p, r });
        const leaked = rows.filter(({ r }) => delivered(r).length > 0 || r.status === 200);
        ok(`${NEW_INDIVIDUAL('g-a', 'ra-1').length} rutas sobre un lector con seguimiento histórico: ninguna responde 200 ni lo nombra`, leaked.length === 0, JSON.stringify(leaked.map(({ p, r }) => `${p} ${r.status}`)));
        ok('…y ninguna falla con 5xx', rows.every(({ r }) => r.status < 500 || r.status === 503), JSON.stringify(rows.filter(({ r }) => r.status >= 500).map(({ p, r }) => `${p} ${r.status}`)));
        const coll = [];
        for (const p of NEW_COLLECTIVE) for (const r of await both(p, C['med-a'])) coll.push({ p, r });
        ok(`${NEW_COLLECTIVE.length} rutas de analítica derivada del curso o del mediador: ningún lector de piloto en la respuesta`, coll.every(({ r }) => delivered(r).length === 0 && (r.status < 500 || r.status === 503)),
            JSON.stringify(coll.filter(({ r }) => delivered(r).length > 0 || (r.status >= 500 && r.status !== 503)).map(({ p, r }) => `${p} ${r.status} ${delivered(r)}`)));
        // Control: con C005 del mediador y A2 del lector, las mismas funciones no se niegan (la vía ordinaria no cambia).
        const ctl = [];
        for (const p of NEW_INDIVIDUAL('g-c', 'rc-1').filter((x) => !/context\/students|\/students\/rc-1\/progress/.test(x))) for (const r of await both(p, C['med-c'])) ctl.push({ p, r });
        ok('control (C005 + A2): esas funciones no responden 403 a la vía ordinaria', ctl.every(({ r }) => r.status !== 403 && r.status !== 401 && (r.status < 500 || r.status === 503)), JSON.stringify(ctl.filter(({ r }) => [401, 403].includes(r.status) || (r.status >= 500 && r.status !== 503)).map(({ p, r }) => `${p} ${r.status}`)));
    }

    section('[3] barrido: nada de un lector ajeno al corte de ese mediador');
    {
        const rows = [...await sweep(C['med-a'], SWEEP('g-a', 'ra-1')), ...await sweep(C['med-a'], SWEEP('g-new', 'rn-1')), ...await sweep(C['med-a'], SWEEP('g-a', 'ra-7')), ...await sweep(C['med-a'], SWEEP('g-a2', 'rx-1')), ...await sweep(C['med-a'], SWEEP('g-b', 'rb-1'))];
        const leaks = rows.filter((x) => x.ids.some((id) => !GA_PILOT.includes(id)));
        ok(`${rows.length} respuestas en las dos réplicas: ningún lector fuera de los seis del corte`, leaks.length === 0, JSON.stringify(leaks.map((x) => `${x.p} ${x.status} ${x.ids}`)));
        ok('ningún 5xx inesperado', rows.every((x) => x.status < 500 || x.status === 503), JSON.stringify(rows.filter((x) => x.status >= 500).map((x) => `${x.p} ${x.status}`)));
        const solo6 = rows.filter((x) => x.ids.includes('ra-6') && !['/api/users', '/api/groups', '/api/groups/g-a/members'].includes(x.p));
        ok('el lector de solo nómina aparece únicamente en nóminas', solo6.length === 0, JSON.stringify(solo6.map((x) => `${x.p} ${x.status}`)));
        const derived = rows.filter((x) => /^\/api\/(aula-viva|leo)\//.test(x.p) && x.ids.length > 0);
        ok('ninguna ruta de Aula Viva ni de Leo entrega un lector por la condición de piloto', derived.length === 0, JSON.stringify(derived.map((x) => `${x.p} ${x.status} ${x.ids}`)));
    }

    section('[4] lector de piloto: lectura conservada; Leo se decide aparte');
    {
        const acc = await both('/api/content/c1/access?userId=ra-1', C['ra-1']);
        ok('acceso a la obra de su curso: permitido', acc.every((r) => r.status === 200 && r.json?.allowed === true), st(acc));
        const sync = await send(S1, 'POST', '/api/progress/ra-1/c1/sync', C['ra-1'], { canonicalProgress: { sentenceIndex: 3, totalSentences: 10, globalPercentage: 30, lastInteractedMode: 'text' }, updatedAt: new Date().toISOString() });
        ok('guarda su progreso de lectura', sync.status === 200, st([sync]));
        const mine = await both('/api/progress/user/ra-1', C['ra-1']);
        ok('consulta su propio progreso', open(mine), st(mine));
        const leo = [await send(S1, 'POST', '/api/leo/ask', C['ra-1'], { contentId: 'c1', question: '¿De qué trata?' }), await send(S2, 'POST', '/api/leo/chat', C['ra-1'], { contentId: 'c1', message: 'hola' })];
        ok('Leo: 403 A3_REQUIRED (la condición de piloto no abre el tratamiento con IA)', leo.every((r) => r.status === 403 && r.json?.code === 'A3_REQUIRED'), st(leo));
        grantOptional('A3', ['ra-1']);
        const leo2 = await send(S1, 'POST', '/api/leo/ask', C['ra-1'], { contentId: 'c1', question: '¿De qué trata?' });
        ok('con A3 verificada de ese lector, Leo deja de responder A3_REQUIRED (decisión propia, por lector)', !(leo2.status === 403 && leo2.json?.code === 'A3_REQUIRED'), st([leo2]));
        const leo3 = await send(S2, 'POST', '/api/leo/ask', C['ra-7'], { contentId: 'c1', question: '¿De qué trata?' });
        ok('…y solo para él: otro lector sigue en A3_REQUIRED', leo3.status === 403 && leo3.json?.code === 'A3_REQUIRED', st([leo3]));
    }

    section('[5] cuentas y cursos nuevos; vía ordinaria');
    {
        const g = await both('/api/groups', C['med-a2']), u = await both('/api/users', C['med-a2']);
        ok('mediador sin C005 y sin pertenencia del corte: todo retenido', g.every((r) => rosterOf(r, 'g-a2')?.rosterWithheld === true && rosterOf(r, 'g-a2')?.memberIds?.length === 0) && u.every((r) => namesIn(r).length === 0)
            && denied(await both('/api/groups/g-a2/members', C['med-a2'])) && denied(await both('/api/students/rx-1/status', C['med-a2'])), st(g));
        ok('el régimen está cerrado: no se puede añadir al lector nuevo ni al mediador nuevo', ['ra-7', 'med-a2'].every((id) => { try { Reg.appendDecisions([pilotLine({ groupId: id === 'ra-7' ? 'g-a' : 'g-a2', userId: id,
            capacity: id === 'ra-7' ? 'pilot_reader_followup' : 'pilot_mediator' })], { env: { CHP_A2_REGISTRY: REG } }); return false; } catch (e) { return e.code === 'PILOT_LEGACY_SEALED'; } }));
        const m = await both('/api/groups/g-c/members', C['med-c']);
        ok('vía ordinaria (C005 + A2): nómina completa, y seguimiento solo del lector con A2', m.every((r) => r.status === 200 && delivered(r).join() === GC.join()) && open(await both('/api/students/rc-1/status', C['med-c']))
            && denied(await both('/api/students/rc-2/status', C['med-c'])), st(m));
        for (const sub of ['candidates', 'diagnosis']) ok(`vía ordinaria: /groups/g-c/${sub} 200`, open(await both(`/api/groups/g-c/${sub}`, C['med-c'])));
        const adm = await both('/api/groups/g-a/members', C['adm']);
        ok('administración: nómina completa, sin cambios', adm.every((r) => r.status === 200 && delivered(r).join() === GA.join()), st(adm));
    }

    section('[6] revocaciones: rigen de inmediato en las dos réplicas');
    const pilotRevoke = (groupId, userId, capacity, ref) => Reg.appendDecisions([pilotLine({ groupId, userId, capacity, status: 'revoked', ref })], { env: { CHP_A2_REGISTRY: REG } });
    {
        pilotRevoke('g-a', 'ra-2', 'pilot_reader_followup', 'SOL-SINT-RA2');
        const m = await both('/api/groups/g-a/members', C['med-a']);
        ok('pertenencia revocada: el lector sale de la nómina de piloto y pierde el seguimiento', m.every((r) => !delivered(r).includes('ra-2') && delivered(r).includes('ra-1')) && denied(await both('/api/students/ra-2/status', C['med-a']))
            && open(await both('/api/students/ra-1/status', C['med-a'])), st(m));
        grantA2(['ra-3'], 'denied');
        ok('A2 = No de un lector de piloto: sin seguimiento individual; sigue en la nómina', denied(await both('/api/students/ra-3/status', C['med-a'])) && denied(await both('/api/progress/user/ra-3', C['med-a']))
            && (await both('/api/groups/g-a/members', C['med-a'])).every((r) => delivered(r).includes('ra-3')));
        grantC005(['med-b'], { status: 'revoked' });
        const gb = await both('/api/groups', C['med-b']);
        ok('C005 revocado de un mediador de piloto: sin nómina ni seguimiento', gb.every((r) => rosterOf(r, 'g-b')?.rosterWithheld === true && rosterOf(r, 'g-b')?.memberIds?.length === 0) && denied(await both('/api/groups/g-b/members', C['med-b']))
            && denied(await both('/api/students/rb-1/status', C['med-b'])) && (await both('/api/users', C['med-b'])).every((r) => namesIn(r).length === 0), st(gb));
    }

    section('[7] traslado y sustitución');
    {
        const mv = await send(S1, 'POST', '/api/groups/g-new/members/move', C['adm'], { fromGroupId: 'g-a', userIds: ['ra-4'] });
        ok('administración traslada a un lector de piloto al curso posterior al corte', mv.status === 200 && mv.json?.moved?.length === 1, st([mv]));
        const m = await both('/api/groups/g-a/members', C['med-a']), s = await both('/api/groups/g-a/analytics-summary', C['med-a']);
        ok('el trasladado sale de la nómina y del resumen del curso del corte', m.every((r) => r.status === 200 && !delivered(r).includes('ra-4')) && s.every((r) => r.status === 200 && !delivered(r).includes('ra-4')), st(m));
        ok('…y en su curso nuevo no hereda la condición: sin seguimiento, aunque lo medie la misma persona', denied(await both('/api/students/ra-4/status', C['med-a'])) && denied(await both('/api/groups/g-new/members', C['med-a'])));
        const put = await send(S2, 'PUT', '/api/groups/g-a', C['adm'], { mediatorIds: ['med-sub'] });
        ok('administración sustituye a la mediadora del curso del corte', put.status === 200, st([put]));
        ok('la mediadora sustituida pierde nómina y seguimiento de ese curso', denied(await both('/api/groups/g-a/members', C['med-a'])) && denied(await both('/api/students/ra-1/status', C['med-a']))
            && (await both('/api/users', C['med-a'])).every((r) => namesIn(r).length === 0));
        const sub = await both('/api/groups', C['med-sub']);
        ok('la sustituta (cuenta posterior al corte, sin C005) no hereda nada', sub.every((r) => rosterOf(r, 'g-a')?.rosterWithheld === true && rosterOf(r, 'g-a')?.memberIds?.length === 0) && denied(await both('/api/groups/g-a/members', C['med-sub']))
            && denied(await both('/api/students/ra-1/status', C['med-sub'])), st(sub));
        const back = await send(S1, 'PUT', '/api/groups/g-a', C['adm'], { mediatorIds: ['med-a'] });
        ok('repuesta en su curso, recupera lo del corte (la pertenencia vuelve a existir hoy)', back.status === 200 && open(await both('/api/students/ra-1/status', C['med-a']))
            && (await both('/api/groups/g-a/members', C['med-a'])).every((r) => r.status === 200 && delivered(r).includes('ra-1') && !delivered(r).includes('ra-4')));
    }

    section('[8] cuenta desactivada');
    {
        const medB = await login(S1, 'med-b');
        const off = await send(S1, 'POST', '/api/users/med-b/disable', C['adm'], {});
        ok('administración desactiva una cuenta de piloto', off.status === 200, st([off]));
        const after = [...await both('/api/groups', medB), ...await both('/api/groups/g-b/members', medB)];
        ok('su sesión deja de valer en las dos réplicas', after.every((r) => r.status === 401), st(after));
    }

    section('[9] fin del régimen');
    {
        ok('antes: la mediadora de piloto conserva su curso', open(await both('/api/groups/g-a/members', C['med-a'])));
        Reg.appendDecisions([pilotLine({ seal: true, status: 'revoked', ref: 'DIR-SINT-FIN' })], { env: { CHP_A2_REGISTRY: REG } });
        const g = await both('/api/groups', C['med-a']);
        ok('sello revocado: nómina retenida, sin seguimiento ni resumen, en las dos réplicas y sin reiniciar', g.every((r) => rosterOf(r, 'g-a')?.rosterWithheld === true && rosterOf(r, 'g-a')?.memberIds?.length === 0)
            && denied(await both('/api/groups/g-a/members', C['med-a'])) && denied(await both('/api/students/ra-1/status', C['med-a'])) && denied(await both('/api/groups/g-a/analytics-summary', C['med-a']))
            && (await both('/api/users', C['med-a'])).every((r) => namesIn(r).length === 0), st(g));
        ok('la vía ordinaria no depende del régimen', open(await both('/api/groups/g-c/members', C['med-c'])) && open(await both('/api/students/rc-1/status', C['med-c'])));
        ok('el lector sigue leyendo', (await both('/api/content/c1/access?userId=ra-1', C['ra-1'])).every((r) => r.status === 200 && r.json?.allowed === true));
    }
} catch (e) {
    fail++; console.error('  ✗ excepción', e?.stack || e, '\n', S1.out.slice(-1500));
} finally {
    for (const x of [S1, S2]) { try { x.child.kill('SIGKILL'); } catch { /* */ } }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\npilotLegacyHttp (V9R-DEP1) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
