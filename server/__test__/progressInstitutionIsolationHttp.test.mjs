/**
 * progressInstitutionIsolationHttp.test.mjs — CHP V9 F5-A.
 *
 * Aislamiento del progreso individual entre instituciones. Antes, en las rutas de lectura de progreso
 * bastaba el ROL de mediador: cualquier mediador leía el progreso de lectores de otra institución.
 * Ahora rige el mismo criterio que el resto de la mediación (`individualAccess`): el lector debe ser
 * miembro de un grupo que ese mediador media, con A2 vigente del lector y C005 vigente del mediador.
 *
 * Dos réplicas de server.js REAL sobre los MISMOS almacenes sintéticos (como api_1/api_2), SESSION_AUTH_MODE=off.
 *   [1] matriz de acceso en las cuatro rutas     [4] administración y falta de identidad
 *   [2] C005 del mediador y A2 del lector        [5] dos réplicas: revocaciones y bajas de grupo
 *   [3] lector B2C y progreso propio             [6] respuestas de rechazo sin datos; registro no verificable
 * Rutas: GET /api/progress/user/:u · /api/progress/item/:u/:c · /api/reading-progress/:u · /api/reading-progress/:u/:c
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/progressInstitutionIsolationHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { a2RegistryPath, grantA2, grantC005 } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePorts } from './helpers/freePort.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const C1 = 'obra-1';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_iso_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json') };
fs.mkdirSync(P.data, { recursive: true });
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const med = (id, org) => ({ id, email: `${id}@fixture.invalid`, nombre_completo: `Mediador ${id}`, roles: ['mediador'], mediatorKind: 'teacher', accountStatus: 'active', ...org });
const reader = (id, org = {}, extra = {}) => ({ id, email: `${id}@fixture.invalid`, nombre_completo: `Lector ${id}`, roles: ['lector'], accountStatus: 'active', ...org, ...extra });
const READERS = ['ra-yes', 'ra-no', 'ra-pend', 'ra-otro', 'rb-yes', 'b2c'];
const USERS = [
    { id: 'adm', email: 'adm@fixture.invalid', roles: ['administrador'], accountStatus: 'active' },
    med('med-a', A), med('med-a2', A), med('med-noc', A), med('med-b', B),
    reader('ra-yes', A), reader('ra-no', A), reader('ra-pend', A), reader('ra-otro', A),   // institución A
    reader('rb-yes', B),                                                                    // institución B
    reader('b2c', {}, { b2c: true, createdVia: 'b2c-provision' }),                          // comprado en la tienda, sin institución
];
const GROUPS = [
    { id: 'g-a', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a', 'med-noc'], memberIds: ['ra-yes', 'ra-no', 'ra-pend'], studentIds: ['ra-yes', 'ra-no', 'ra-pend'] },
    { id: 'g-a2', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a2'], memberIds: ['ra-otro'], studentIds: ['ra-otro'] },
    { id: 'g-b', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: ['rb-yes'], studentIds: ['rb-yes'] },
];
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.access, JSON.stringify(READERS.map((u) => ({ id: `r-${u}`, scope: 'user', scopeId: u, titleIds: [C1], collectionIds: [], expiresAt: Date.now() + 86400000 }))));
fs.writeFileSync(P.content, JSON.stringify([{ id: C1, titulo: 'Obra 1', tipo: 'libro' }]));

// Registro de decisiones sintético: A2 de los lectores y C005 de los mediadores.
const REG = a2RegistryPath();
const R = await import('../privacy/a2Registry.mjs');
grantA2(['ra-yes', 'ra-otro', 'rb-yes']);
grantA2(['ra-no'], 'denied');                       // ra-pend: sin decisión
grantC005(['med-a', 'med-a2', 'med-b']);            // med-noc: sin compromiso 005

const ports = await freePorts(2);
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off',
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'),
        EVENTS_SQLITE_PATH: path.join(P.data, `events-${i}.db`), INSIGHTS_SQLITE_PATH: path.join(P.data, `insights-${i}.db`), ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`), SESSIONS_DB: path.join(P.data, `sessions-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const ready = async (s) => { for (let i = 0; i < 200; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch { /* arrancando */ } await sleep(200); } throw new Error('server no arrancó'); };
const req = async (s, p, who, { method = 'GET', body } = {}) => {
    const r = await fetch(`${s.base}${p}`, { method, headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(who ? { 'x-user-id': who } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
};
const ROUTES = (u) => [`/api/progress/user/${u}`, `/api/progress/item/${u}/${C1}`, `/api/reading-progress/${u}`, `/api/reading-progress/${u}/${C1}`];
/** Estados de las cuatro rutas para (quién → lector), p. ej. «200 200 200 200». */
const four = async (s, who, u) => (await Promise.all(ROUTES(u).map((p) => req(s, p, who)))).map((r) => r.status).join(' ');
const ALLOW = '200 200 200 200', DENY = '403 403 403 403';
const DENIED_BODY = '{"error":"Acceso denegado"}';

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
try {
    await ready(S1); await ready(S2);
    // Cada lector guarda su propio progreso (lo que después se intenta leer).
    for (const u of READERS) await req(S1, `/api/progress/${u}/${C1}/sync`, u, { method: 'POST', body: { canonicalProgress: { globalPercentage: 37, percentage: 37, readerMode: 'text' }, updatedAt: new Date().toISOString() } });
    const own = await req(S1, '/api/progress/user/ra-yes', 'ra-yes');
    ok('siembra: cada lector tiene progreso propio guardado', own.status === 200 && own.json?.progressList?.length === 1);

    console.log('[1] matriz de acceso (cuatro rutas, las dos réplicas)');
    ok('mediador A → lector de su grupo en la institución A, con A2 y C005 → permitido', (await four(S1, 'med-a', 'ra-yes')) === ALLOW && (await four(S2, 'med-a', 'ra-yes')) === ALLOW, await four(S1, 'med-a', 'ra-yes'));
    ok('…y recibe el progreso de ESE lector', (await req(S1, '/api/progress/user/ra-yes', 'med-a')).json?.progressList?.[0]?.userId === 'ra-yes' && (await req(S1, `/api/reading-progress/ra-yes/${C1}`, 'med-a')).json?.success === true);
    ok('mediador A → lector de la institución B → rechazado', (await four(S1, 'med-a', 'rb-yes')) === DENY && (await four(S2, 'med-a', 'rb-yes')) === DENY, await four(S1, 'med-a', 'rb-yes'));
    ok('mediador B → lector de la institución A → rechazado', (await four(S1, 'med-b', 'ra-yes')) === DENY && (await four(S2, 'med-b', 'ra-yes')) === DENY, await four(S1, 'med-b', 'ra-yes'));
    ok('mediador B → lector de su grupo en la institución B → permitido', (await four(S1, 'med-b', 'rb-yes')) === ALLOW);
    ok('misma institución, pero un grupo que NO media → rechazado en ambos sentidos', (await four(S1, 'med-a', 'ra-otro')) === DENY && (await four(S1, 'med-a2', 'ra-yes')) === DENY && (await four(S1, 'med-a2', 'ra-otro')) === ALLOW, `${await four(S1, 'med-a', 'ra-otro')} / ${await four(S1, 'med-a2', 'ra-yes')}`);

    console.log('[2] C005 del mediador y A2 del lector');
    ok('mediador del grupo SIN compromiso 005 → rechazado', (await four(S1, 'med-noc', 'ra-yes')) === DENY, await four(S1, 'med-noc', 'ra-yes'));
    ok('lector con A2 denegada → seguimiento individual rechazado', (await four(S1, 'med-a', 'ra-no')) === DENY, await four(S1, 'med-a', 'ra-no'));
    ok('lector sin decisión A2 → seguimiento individual rechazado', (await four(S1, 'med-a', 'ra-pend')) === DENY, await four(S1, 'med-a', 'ra-pend'));

    console.log('[3] lector B2C y progreso propio');
    ok('lector B2C → inaccesible para mediadores de cualquier institución', (await four(S1, 'med-a', 'b2c')) === DENY && (await four(S1, 'med-b', 'b2c')) === DENY);
    ok('cada lector sigue leyendo SU progreso por las cuatro rutas', (await four(S1, 'ra-yes', 'ra-yes')) === ALLOW && (await four(S1, 'rb-yes', 'rb-yes')) === ALLOW && (await four(S1, 'b2c', 'b2c')) === ALLOW && (await four(S1, 'ra-no', 'ra-no')) === ALLOW);
    ok('un lector no lee el de otro (misma institución, otra institución, B2C)', (await four(S1, 'ra-no', 'ra-yes')) === DENY && (await four(S1, 'rb-yes', 'ra-yes')) === DENY && (await four(S1, 'ra-yes', 'b2c')) === DENY);
    ok('un mediador sigue leyendo su propio progreso (vacío) sin relación con nadie', (await req(S1, '/api/progress/user/med-b', 'med-b')).status === 200 && (await req(S1, '/api/reading-progress/med-b', 'med-b')).status === 200);

    console.log('[4] administración y falta de identidad');
    ok('administración de plataforma: lee a lectores de A, de B y B2C', (await four(S1, 'adm', 'ra-yes')) === ALLOW && (await four(S1, 'adm', 'rb-yes')) === ALLOW && (await four(S1, 'adm', 'b2c')) === ALLOW && (await four(S1, 'adm', 'ra-no')) === ALLOW);
    ok('sin identidad → rechazado', (await four(S1, null, 'ra-yes')) === DENY);

    console.log('[5] dos réplicas: revocaciones y bajas');
    R.appendDecisions([{ subjectId: 'ra-yes', kind: 'A2', status: 'revoked', actDay: R.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-F5A-REV' }]);
    ok('se revoca la A2 del lector → las DOS réplicas rechazan en la petición siguiente', (await four(S1, 'med-a', 'ra-yes')) === DENY && (await four(S2, 'med-a', 'ra-yes')) === DENY, `${await four(S1, 'med-a', 'ra-yes')} / ${await four(S2, 'med-a', 'ra-yes')}`);
    ok('…el lector sigue leyendo lo suyo y la administración también', (await four(S2, 'ra-yes', 'ra-yes')) === ALLOW && (await four(S2, 'adm', 'ra-yes')) === ALLOW);
    R.appendDecisions([{ subjectId: 'med-b', kind: 'C005', status: 'revoked', actDay: R.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-F5A-REV' }]);
    ok('se revoca el C005 del mediador B → las DOS réplicas le rechazan incluso a su propio lector', (await four(S1, 'med-b', 'rb-yes')) === DENY && (await four(S2, 'med-b', 'rb-yes')) === DENY);
    ok('antes de la baja: mediador A2 lee a su lector en las dos réplicas', (await four(S1, 'med-a2', 'ra-otro')) === ALLOW && (await four(S2, 'med-a2', 'ra-otro')) === ALLOW);
    const g = JSON.parse(fs.readFileSync(P.groups, 'utf8')); const ga2 = g.find((x) => x.id === 'g-a2'); ga2.memberIds = []; ga2.studentIds = [];
    fs.writeFileSync(P.groups, JSON.stringify(g));
    let s1 = '', s2 = '';
    for (let i = 0; i < 25; i++) { s1 = await four(S1, 'med-a2', 'ra-otro'); s2 = await four(S2, 'med-a2', 'ra-otro'); if (s1 === DENY && s2 === DENY) break; await sleep(200); }
    ok('el lector sale del grupo → las DOS réplicas dejan de conceder ese acceso', s1 === DENY && s2 === DENY, `${s1} / ${s2}`);

    console.log('[6] respuestas de rechazo y registro no verificable');
    const denied = [];
    for (const [who, u] of [['med-a', 'rb-yes'], ['med-b', 'ra-yes'], ['med-noc', 'ra-yes'], ['med-a', 'ra-no'], ['med-a', 'b2c'], ['med-a', 'no-existe'], ['ra-no', 'ra-yes']]) for (const p of ROUTES(u)) denied.push(await req(S1, p, who));
    ok('todo rechazo es el mismo 403 con el mismo cuerpo: fuera de ámbito, sin C005, sin A2, B2C o lector inexistente', denied.every((r) => r.status === 403 && r.text === DENIED_BODY), [...new Set(denied.map((r) => `${r.status}:${r.text}`))].join(' '));
    ok('…sin progreso, nombres, correos ni identificadores del lector', denied.every((r) => !/progress|globalPercentage|nombre|fixture\.invalid|Lector|rb-yes|ra-yes|b2c/.test(r.text)));
    ok('los registros del servidor no contienen el progreso denegado', !/globalPercentage/.test(S1.out + S2.out));
    fs.renameSync(REG, `${REG}.off`);
    const blind = await four(S1, 'med-a', 'ra-pend'), blindOk = await four(S2, 'med-a2', 'ra-otro');
    const selfBlind = await four(S1, 'rb-yes', 'rb-yes'), admBlind = await four(S2, 'adm', 'rb-yes');
    fs.renameSync(`${REG}.off`, REG);
    ok('registro de decisiones no verificable → ningún mediador obtiene progreso (fallo cerrado, nunca 200)', !blind.includes('200') && !blindOk.includes('200'), `${blind} / ${blindOk}`);
    ok('…y no afecta al progreso propio ni a la administración', selfBlind === ALLOW && admBlind === ALLOW, `${selfBlind} / ${admBlind}`);
} catch (e) {
    fail++; console.error('ERROR', e?.message || e);
} finally {
    S1.child.kill('SIGKILL'); S2.child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
