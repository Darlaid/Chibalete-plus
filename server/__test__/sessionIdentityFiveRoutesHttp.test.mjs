/**
 * sessionIdentityFiveRoutesHttp.test.mjs — CHP V9 F5-E1.
 *
 * Identidad por SESIÓN en cinco lecturas que la tomaban de la cabecera `x-user-id` (`resolveRequester`), también con la
 * sesión obligatoria. Efecto doble: (1) sin cookie, la cabecera con el id de una cuenta bastaba para recibir datos;
 * (2) con cookie y sin cabecera —lo que envía el navegador— el mediador y el lector legítimos recibían 403.
 * Ahora las cinco resuelven al solicitante con `sessionRequesterOf` (la identidad autenticada canónica).
 *
 *   GET /api/metrics/course/:g      GET /api/metrics/student/:u      GET /api/reading-progress/:u
 *   GET /api/reports/course/:g                                       GET /api/reading-progress/:u/:c
 *
 * Dos réplicas de server.js REAL con SESSION_AUTH_MODE=enforce (sesión obligatoria), sesiones, registro de decisiones
 * y almacenes sintéticos COMPARTIDOS; cookies reales emitidas por /api/auth/login. Dos instituciones y un lector B2C.
 *   [1] cabecera sin cookie          [4] lector: lo propio y lo ajeno        [7] administración: sin ampliación
 *   [2] cookie sin cabecera          [5] mediador: curso propio y ajeno      [8] cookie vencida o revocada
 *   [3] cookie + cabecera de otro    [6] cuenta B2C                          [9] registro de decisiones indisponible
 * Los secretos de sesión exigen permisos POSIX: en win32 la suite se OMITE (no cuenta como aprobada) y en CI una
 * omisión es un fallo. Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/sessionIdentityFiveRoutesHttp.test.mjs
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
    console.log('sessionIdentityFiveRoutesHttp: SKIP (POSIX-only: secretos de sesión). No cuenta como aprobada.');
    process.exit(process.env.CI ? 1 : 0);
}

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(path.join(REPO, 'package.json'));
const bcrypt = require('bcryptjs');
const Database = require('better-sqlite3');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_f5e1_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), key: path.join(tmp, 'session.key'), sessions: path.join(tmp, 'sessions.db') };
fs.mkdirSync(P.data, { recursive: true });
const PW = crypto.randomBytes(9).toString('base64url'), HASH = bcrypt.hashSync(PW, 4);
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const acct = (id, roles, extra = {}) => ({ id, email: `${id}@fixture.invalid`, password: HASH, nombre_completo: `Cuenta ${id}`, roles, accountStatus: 'active', ...extra });
const med = (id, org) => acct(id, ['mediador'], { mediatorKind: 'teacher', ...org });
const reader = (id, org = {}, extra = {}) => acct(id, ['lector'], { ...org, ...extra });
fs.writeFileSync(P.users, JSON.stringify([
    acct('adm', ['administrador']),
    med('med-a', A), med('med-b', B),
    reader('ra-yes', A), reader('ra-yes2', A), reader('ra-no', A), reader('ra-venc', A), reader('rb-yes', B),
    reader('b2c', {}, { b2c: true, createdVia: 'b2c-provision' }),
]));
const G_A = ['ra-yes', 'ra-yes2', 'ra-no', 'ra-venc'];
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: G_A, studentIds: G_A },
    { id: 'g-b', name: 'Sexto', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: ['rb-yes'], studentIds: ['rb-yes'] },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.access, '[]'); fs.writeFileSync(P.content, '[]');
// Una sesión de lectura por lector; la del lector sin A2 es enorme a propósito (si entrara en un promedio, se notaría).
const T0 = Date.now() - 3 * 86400000;
const DUR = { 'ra-yes': 60000, 'ra-yes2': 120000, 'ra-no': 9000000, 'rb-yes': 45000, b2c: 7000000 };
const events = [];
for (const [userId, d] of Object.entries(DUR)) {
    events.push({ event: 'session_start', userId, contentId: 'c1', timestamp: T0, streak: 0 });
    events.push({ event: 'block_complete', userId, contentId: 'c1', timestamp: T0 + 1000, streak: 1 });
    events.push({ event: 'session_end', userId, contentId: 'c1', timestamp: T0 + d, sessionDuration: d, progressPercentage: 50 });
}
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), JSON.stringify(events));
fs.writeFileSync(P.key, crypto.randomBytes(48).toString('hex')); fs.chmodSync(P.key, 0o400);

const REG = a2RegistryPath();
grantA2(['ra-yes', 'ra-yes2', 'ra-venc', 'rb-yes']); grantA2(['ra-no'], 'denied');
grantC005(['med-a', 'med-b']);

const ports = await freePorts(2);
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted',
        SESSION_AUTH_MODE: 'enforce', SESSION_LEGACY_ALLOW: '', SESSIONS_DB: P.sessions, SESSION_KEY_CURRENT_PATH: P.key,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), LEO_EVIDENCE_DB: path.join(tmp, 'leo_evidence.json'),
        EVENTS_SQLITE_PATH: path.join(P.data, `events-${i}.db`), INSIGHTS_SQLITE_PATH: path.join(P.data, `insights-${i}.db`), ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const ready = async (s) => { for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch { /* arrancando */ } await sleep(200); } throw new Error(`server no arrancó\n${s.out.slice(-1500)}`); };
// Como el navegador: la cookie y nada más. `headers` solo para declarar a propósito una identidad en la cabecera.
const get = async (s, p, { cookie, headers = {} } = {}) => {
    const r = await fetch(`${s.base}${p}`, { headers: { ...(cookie ? { cookie } : {}), ...headers } });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
};
const login = async (s, id) => {
    const r = await fetch(`${s.base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: `${id}@fixture.invalid`, password: PW }) });
    const m = (r.headers.get('set-cookie') || '').match(/chp_session=([^;]+)/);
    if (r.status !== 200 || !m) throw new Error(`login ${id}: ${r.status}`);
    return `chp_session=${m[1]}`;
};

const MC = '/api/metrics/course/g-a', RC = '/api/reports/course/g-a';
const MS = '/api/metrics/student/ra-yes', RP = '/api/reading-progress/ra-yes', RPC = '/api/reading-progress/ra-yes/c1';
// Las cinco rutas, cada una con la cuenta a la que legítimamente pertenece el dato.
const FIVE = [[MC, 'med-a'], [RC, 'med-a'], [MS, 'ra-yes'], [RP, 'ra-yes'], [RPC, 'ra-yes']];
const PRIVATE = /studentBreakdown|productMetrics|readingProgress|backboneMetrics|summary|Cuenta |fixture\.invalid/;
const denied = (r) => [401, 403].includes(r.status) && !PRIVATE.test(r.text);
const ids = (r) => (r.json?.studentBreakdown ?? []).map((x) => x.userId).sort().join(',');
// Las dos réplicas, siempre: `both(fn)` devuelve las dos respuestas.
const both = async (p, opts) => [await get(S1, p, opts), await get(S2, p, opts)];
const all = async (list, opts) => { const out = []; for (const p of list) out.push(...await both(p, typeof opts === 'function' ? opts(p) : opts)); return out; };
const st = (rs) => rs.map((r) => r.status).join(' ');

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
try {
    await ready(S1); await ready(S2);
    const C = {};
    for (const [i, id] of ['adm', 'med-a', 'med-b', 'ra-yes', 'ra-yes2', 'ra-no', 'rb-yes', 'b2c'].entries()) C[id] = await login(i % 2 ? S2 : S1, id);

    console.log('[1] la cabecera `x-user-id` sin cookie no es una identidad');
    for (const [p, owner] of FIVE) {
        const legit = await both(p, { headers: { 'x-user-id': owner } });
        ok(`${p} · sin cookie + x-user-id de la cuenta legítima (${owner}) → rechazado en las dos réplicas, sin datos`, legit.every(denied), st(legit));
        const admin = await both(p, { headers: { 'x-user-id': 'adm', 'x-role': 'administrador' } });
        ok(`${p} · sin cookie + x-user-id del administrador → rechazado, sin datos`, admin.every(denied), st(admin));
    }
    const none = await all(FIVE.map(([p]) => p));
    ok('sin cookie ni cabecera → rechazado en las cinco rutas', none.every(denied), st(none));
    const junk = await all(FIVE.map(([p]) => p), { cookie: 'chp_session=no-es-un-token', headers: { 'x-user-id': 'adm' } });
    ok('cookie inventada + x-user-id del administrador → rechazado en las cinco rutas', junk.every(denied), st(junk));

    console.log('[2] la cookie de sesión, sin cabecera alguna (el navegador), da el acceso legítimo');
    for (const [p, owner] of FIVE) {
        const r = await both(p, { cookie: C[owner] });
        ok(`${p} · cookie de ${owner}, sin cabecera → 200 en las dos réplicas`, r.every((x) => x.status === 200), st(r));
    }
    const same = await all(FIVE.map(([p]) => p), (p) => { const o = FIVE.find(([q]) => q === p)[1]; return { cookie: C[o], headers: { 'x-user-id': o } }; });
    ok('…y una cabecera que repite la identidad de la sesión no estorba (clientes anteriores)', same.every((x) => x.status === 200), st(same));

    console.log('[3] cookie de una cuenta + cabecera de otra: ni suplantación ni escalamiento');
    for (const [p, owner] of FIVE) {
        const other = owner === 'med-a' ? 'med-b' : 'ra-yes2';
        const spoof = await both(p, { cookie: C[other], headers: { 'x-user-id': owner } });
        ok(`${p} · cookie de ${other} + x-user-id: ${owner} → rechazado, sin datos`, spoof.every(denied), st(spoof));
        const esc = await both(p, { cookie: C['med-b'], headers: { 'x-user-id': 'adm', 'x-role': 'administrador' } });
        ok(`${p} · cookie de un mediador ajeno + x-user-id del administrador → sin escalamiento`, esc.every(denied), st(esc));
        const contra = await both(p, { cookie: C[owner], headers: { 'x-user-id': other } });
        ok(`${p} · cookie legítima + cabecera contradictoria → la petición se rechaza (contrato de sesión: subject_mismatch)`, contra.every(denied), st(contra));
    }

    console.log('[4] lector: lo propio sí, lo ajeno no');
    const own = await all([MS, RP, RPC], { cookie: C['ra-yes'] });
    ok('lector → sus métricas y su progreso → 200', own.every((x) => x.status === 200), st(own));
    const ownMs = await get(S1, MS, { cookie: C['ra-yes'] }), ownRp = await get(S2, RP, { cookie: C['ra-yes'] }), ownRpc = await get(S1, RPC, { cookie: C['ra-yes'] });
    ok('…con el contrato de siempre (métricas con backbone; progreso con resumen; título con su estado)', 'backboneMetrics' in (ownMs.json ?? {}) && ownRp.json?.success === true && ownRp.json.userId === 'ra-yes' && 'summary' in ownRp.json && ownRpc.json?.success === true && 'readingProgress' in ownRpc.json, `${ownMs.text.slice(0, 80)} ${ownRp.text.slice(0, 80)}`);
    const noA2 = await all(['/api/metrics/student/ra-no', '/api/reading-progress/ra-no', '/api/reading-progress/ra-no/c1'], { cookie: C['ra-no'] });
    ok('lector sin A2 → lo propio sigue siendo suyo (A2 no condiciona el progreso propio)', noA2.every((x) => x.status === 200), st(noA2));
    const foreign = await all([MS, RP, RPC], { cookie: C['ra-yes2'] });
    ok('lector del mismo curso → métricas y progreso de OTRO lector → 403, sin datos', foreign.every((x) => x.status === 403 && denied(x)), st(foreign));
    const course = await all([MC, RC], { cookie: C['ra-yes'] });
    ok('lector → métricas e informe de su curso → 403', course.every((x) => x.status === 403 && denied(x)), st(course));
    const cross = await all([MS, RP, RPC, MC, RC], { cookie: C['rb-yes'] });
    ok('lector de otra institución → las cinco → 403', cross.every((x) => x.status === 403 && denied(x)), st(cross));

    console.log('[5] mediador: curso propio con A2 y C005; curso ajeno no');
    for (const p of [MC, RC]) {
        const r = await both(p, { cookie: C['med-a'] });
        ok(`${p} · mediador del curso → 200 con SOLO los lectores con A2 (dos réplicas)`, r.every((x) => x.status === 200 && ids(x) === 'ra-venc,ra-yes,ra-yes2'), `${st(r)} ${ids(r[0])}`);
        ok('…sin el lector que no autorizó: ni id ni nombre, y los promedios sin su sesión', r.every((x) => !x.text.includes('"ra-no"') && !x.text.includes('Cuenta ra-no"') && x.json?.productMetrics?.totalReadingTimeMs < 9000000 / 4), String(r[0].json?.productMetrics?.totalReadingTimeMs));
    }
    const mRead = await all([RP, RPC], { cookie: C['med-a'] });
    ok('mediador → progreso de un lector de su grupo con A2 → 200', mRead.every((x) => x.status === 200), st(mRead));
    const mNo = await all(['/api/reading-progress/ra-no', '/api/reading-progress/ra-no/c1'], { cookie: C['med-a'] });
    ok('mediador → progreso de un lector de su grupo SIN A2 → 403', mNo.every((x) => x.status === 403 && denied(x)), st(mNo));
    const mMs = await both(MS, { cookie: C['med-a'] });
    ok('mediador → métricas individuales de un lector → 403 (ruta solo del propio lector; sin cambio)', mMs.every((x) => x.status === 403 && denied(x)), st(mMs));
    const mOther = await all(['/api/metrics/course/g-b', '/api/reports/course/g-b', '/api/reading-progress/rb-yes', '/api/reading-progress/rb-yes/c1', '/api/metrics/student/rb-yes'], { cookie: C['med-a'] });
    ok('mediador → curso y lectores de OTRA institución → 403', mOther.every((x) => x.status === 403 && denied(x)), st(mOther));
    const bOnA = await all([MC, RC, MS, RP, RPC], { cookie: C['med-b'] });
    ok('mediador de otra institución → curso y lector de A → 403', bOnA.every((x) => x.status === 403 && denied(x)), st(bOnA));
    const ghost = await all(['/api/metrics/course/g-inexistente', '/api/reports/course/g-inexistente'], { cookie: C['med-a'] });
    ok('curso inexistente → 403 (no revela existencia)', ghost.every((x) => x.status === 403), st(ghost));

    console.log('[6] cuenta B2C');
    const b2cInst = await all([MC, RC, MS, RP, RPC, '/api/metrics/course/g-b', '/api/reading-progress/rb-yes'], { cookie: C.b2c });
    ok('cuenta B2C → métricas, informe y progreso institucionales ajenos → 403, sin datos', b2cInst.every((x) => x.status === 403 && denied(x)), st(b2cInst));
    const b2cOwn = await all(['/api/metrics/student/b2c', '/api/reading-progress/b2c', '/api/reading-progress/b2c/c1'], { cookie: C.b2c });
    ok('cuenta B2C → lo propio → 200', b2cOwn.every((x) => x.status === 200), st(b2cOwn));
    const medOnB2c = await all(['/api/reading-progress/b2c', '/api/reading-progress/b2c/c1', '/api/metrics/student/b2c'], { cookie: C['med-a'] });
    ok('mediador → cuenta B2C → 403', medOnB2c.every((x) => x.status === 403 && denied(x)), st(medOnB2c));

    console.log('[7] administración: los mismos permisos que antes, ahora por sesión');
    const admRp = await all([RP, RPC], { cookie: C.adm });
    ok('administrador con su sesión → progreso de un lector → 200 (ya lo permitía la ruta)', admRp.every((x) => x.status === 200), st(admRp));
    const admMachine = await all([MC, RC, MS], { cookie: C.adm });
    ok('administrador con su sesión → métricas/informe de curso y métricas individuales → 403 (solo autoridad de máquina; no se amplía)', admMachine.every((x) => x.status === 403 && denied(x)), st(admMachine));

    console.log('[8] cookie vencida o revocada');
    const venc = await login(S1, 'ra-venc');
    const vPaths = ['/api/metrics/student/ra-venc', '/api/reading-progress/ra-venc', '/api/reading-progress/ra-venc/c1'];
    const vBefore = await all(vPaths, { cookie: venc });
    ok('sesión vigente → 200 (control)', vBefore.every((x) => x.status === 200), st(vBefore));
    { const db = new Database(P.sessions); try { db.prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE user_id = ?").run('ra-venc'); } finally { db.close(); } }
    const vAfter = await all(vPaths, { cookie: venc });
    ok('la misma cookie con la sesión vencida → rechazada en las dos réplicas', vAfter.every(denied), st(vAfter));
    const vHdr = await all(vPaths, { cookie: venc, headers: { 'x-user-id': 'ra-venc' } });
    ok('…y la cabecera no la rescata', vHdr.every(denied), st(vHdr));
    const tmpMed = await login(S1, 'med-a');
    ok('segunda sesión del mediador → 200 (control)', (await get(S2, MC, { cookie: tmpMed })).status === 200);
    const out = await fetch(`${S1.base}/api/auth/logout`, { method: 'POST', headers: { cookie: tmpMed, 'sec-fetch-site': 'same-origin' } });
    const revoked = await all([MC, RC, RP, RPC], { cookie: tmpMed });
    ok('tras cerrar esa sesión, su cookie queda revocada → rechazada en las dos réplicas', out.status < 400 && revoked.every(denied), `${out.status} ${st(revoked)}`);
    ok('…sin afectar a la otra sesión del mismo mediador', (await get(S2, MC, { cookie: C['med-a'] })).status === 200);

    console.log('[9] registro de decisiones indisponible: fallo cerrado');
    const good = fs.readFileSync(REG);
    fs.appendFileSync(REG, '{"linea":"alterada"}\n');
    try {
        const u = await all([MC, RC, RP, RPC], { cookie: C['med-a'] });
        ok('mediador → curso y progreso individual → 503, sin datos (dos réplicas)', u.every((x) => x.status === 503 && !PRIVATE.test(x.text)), `${st(u)} ${u[0].text.slice(0, 80)}`);
        const uh = await all([MC, RC, RP, RPC], { headers: { 'x-user-id': 'med-a' } });
        ok('…y la cabecera sola sigue rechazada (no 200)', uh.every((x) => x.status !== 200 && !PRIVATE.test(x.text)), st(uh));
        const uo = await all([MS, RP, RPC], { cookie: C['ra-yes'] });
        ok('el lector conserva lo propio (no depende del registro)', uo.every((x) => x.status === 200), st(uo));
    } finally { fs.writeFileSync(REG, good); }
    const back = await both(MC, { cookie: C['med-a'] });
    ok('registro restaurado → el mediador recupera su curso', back.every((x) => x.status === 200 && ids(x) === 'ra-venc,ra-yes,ra-yes2'), st(back));

    ok('ningún registro del servidor contiene cookies ni contraseñas', ![S1.out, S2.out].some((o) => o.includes(PW) || Object.values(C).some((c) => o.includes(c.split('=')[1]))));
} catch (e) { ok('arnés', false, e.stack || e.message); }
finally { S1.child.kill(); S2.child.kill(); await sleep(300); fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\nsessionIdentityFiveRoutesHttp — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
