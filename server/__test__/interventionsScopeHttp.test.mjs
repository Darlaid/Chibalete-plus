/**
 * interventionsScopeHttp.test.mjs — CHP V9 F5-C1.
 *
 * Intervenciones pedagógicas dentro del ámbito del mediador. Antes bastaba el ROL: cualquier mediador leía el
 * historial y las notas de cualquier lector o curso, recibía el agregado global y podía registrar intervenciones
 * sobre lectores ajenos o B2C. Ahora rigen los controles del resto de la mediación: grupos que realmente media
 * (CIS) y, para todo tratamiento individual, A2 del lector y C005 del mediador.
 *
 *   GET  /api/interventions/student/:id      GET /api/interventions/effectiveness
 *   GET  /api/interventions/course/:g        POST /api/interventions
 *
 * Dos réplicas de server.js REAL sobre los MISMOS almacenes sintéticos, dos instituciones, SESSION_AUTH_MODE=off.
 *   [1] historial por lector        [4] escritura              [7] administración y usos legítimos
 *   [2] intervenciones por curso    [5] dos réplicas: revocaciones
 *   [3] efectividad                 [6] rechazos sin datos; registro no verificable
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/interventionsScopeHttp.test.mjs
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_iv_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json') };
fs.mkdirSync(P.data, { recursive: true });
const IV = path.join(P.data, 'interventions_db.json');
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const med = (id, org) => ({ id, email: `${id}@fixture.invalid`, nombre_completo: `Mediador ${id}`, roles: ['mediador'], mediatorKind: 'teacher', accountStatus: 'active', ...org });
const reader = (id, org = {}, extra = {}) => ({ id, email: `${id}@fixture.invalid`, nombre_completo: `Lector ${id}`, roles: ['lector'], accountStatus: 'active', ...org, ...extra });
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'adm', email: 'adm@fixture.invalid', roles: ['administrador'], accountStatus: 'active' },
    med('med-a', A), med('med-a2', A), med('med-noc', A), med('med-b', B),
    reader('ra-yes', A), reader('ra-yes2', A), reader('ra-no', A), reader('ra-otro', A), reader('rb-yes', B),
    reader('b2c', {}, { b2c: true, createdVia: 'b2c-provision' }),
]));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a', 'med-noc'], memberIds: ['ra-yes', 'ra-yes2', 'ra-no'], studentIds: ['ra-yes', 'ra-yes2', 'ra-no'] },
    { id: 'g-a2', name: 'Quinto B', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a2'], memberIds: ['ra-otro'], studentIds: ['ra-otro'] },
    { id: 'g-b', name: 'Sexto', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: ['rb-yes'], studentIds: ['rb-yes'] },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.access, '[]'); fs.writeFileSync(P.content, '[]');
// Intervenciones ya existentes (históricas), con una nota reconocible por lector. Dos por lector de g-a con A2.
const old = new Date(Date.now() - 10 * 86400000).toISOString();
const iv = (id, mediatorId, studentId, courseId, type = 'lectura_guiada') => ({ id, mediatorId, studentId, courseId, type, note: `nota-privada-${studentId}`, contentId: null, patternsAtIntervention: [], readingTimeMsAtIntervention: 0, createdAt: old });
const SEED = [
    iv('iv-1', 'med-a', 'ra-yes', 'g-a'), iv('iv-2', 'med-a', 'ra-yes', 'g-a', 'recomendacion'), iv('iv-3', 'med-a', 'ra-yes2', 'g-a'),
    iv('iv-4', 'med-a', 'ra-no', 'g-a'),                       // lector que después negó la A2
    iv('iv-5', 'med-a2', 'ra-otro', 'g-a2'), iv('iv-6', 'med-b', 'rb-yes', 'g-b'), iv('iv-7', 'med-b', 'rb-yes', 'g-b', 'recomendacion'),
    iv('iv-8', 'med-b', 'b2c', 'g-b'),                         // escrita sobre un lector B2C cuando bastaba el rol
];
fs.writeFileSync(IV, JSON.stringify({ interventions: SEED }));

const REG = a2RegistryPath();
const R = await import('../privacy/a2Registry.mjs');
grantA2(['ra-yes', 'ra-yes2', 'ra-otro', 'rb-yes']); grantA2(['ra-no'], 'denied');
grantC005(['med-a', 'med-a2', 'med-b']);            // med-noc media g-a pero no tiene compromiso 005

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
const stored = () => JSON.parse(fs.readFileSync(IV, 'utf8')).interventions;
const DENIED = '{"error":"Acceso denegado"}';
const students = (r) => [...new Set((r.json?.interventions ?? []).map((x) => x.studentId))].sort().join(',');
const notes = (r, u) => r.text.includes(`nota-privada-${u}"`); // con la comilla de cierre: «ra-yes» no debe coincidir con «ra-yes2»
const post = (s, who, studentId, courseId, note = 'nota-nueva') => req(s, '/api/interventions', who, { method: 'POST', body: { studentId, courseId, type: 'lectura_guiada', note } });

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
try {
    await ready(S1); await ready(S2);

    console.log('[1] historial por lector');
    const h = await req(S1, '/api/interventions/student/ra-yes', 'med-a');
    ok('mediador → lector de su grupo con A2 y C005 → permitido, con sus intervenciones y notas', h.status === 200 && h.json?.history && notes(h, 'ra-yes') && (await req(S2, '/api/interventions/student/ra-yes', 'med-a')).status === 200, `${h.status} ${h.text.slice(0, 120)}`);
    const cases1 = [['med-b', 'ra-yes', 'otra institución'], ['med-a2', 'ra-yes', 'grupo que no media'], ['med-a', 'b2c', 'lector B2C'], ['med-b', 'b2c', 'lector B2C con una intervención suya anterior'], ['med-noc', 'ra-yes', 'mediador sin C005'], ['med-a', 'ra-no', 'lector sin A2'], ['med-a', 'no-existe', 'lector inexistente'], ['ra-yes2', 'ra-yes', 'otro lector']];
    for (const [who, u, label] of cases1) { const r1 = await req(S1, `/api/interventions/student/${u}`, who), r2 = await req(S2, `/api/interventions/student/${u}`, who); ok(`${label} → rechazado en las dos réplicas, sin datos`, r1.status === 403 && r2.status === 403 && r1.text === DENIED && r2.text === DENIED, `${r1.status} ${r1.text.slice(0, 90)}`); }

    console.log('[2] intervenciones por curso');
    const c = await req(S1, '/api/interventions/course/g-a', 'med-a');
    ok('mediador del grupo → solo las intervenciones de lectores con A2', c.status === 200 && students(c) === 'ra-yes,ra-yes2' && c.json.interventions.length === 3, `${c.status} ${students(c)}`);
    ok('…sin la nota ni el identificador del lector que no autorizó (A2 negada)', !notes(c, 'ra-no') && !c.text.includes('"ra-no"'));
    const cn = await req(S1, '/api/interventions/course/g-a', 'med-noc');
    ok('mediador del grupo SIN C005 → ningún detalle individual', cn.status === 200 && cn.json?.interventions?.length === 0 && !/nota-privada|ra-yes|ra-no/.test(cn.text), `${cn.status} ${cn.text.slice(0, 120)}`);
    for (const [who, g, label] of [['med-b', 'g-a', 'grupo de otra institución'], ['med-a2', 'g-a', 'grupo de su institución que no media'], ['med-a', 'g-b', 'grupo de la institución B'], ['med-a', 'g-inexistente', 'grupo inexistente'], ['ra-yes', 'g-a', 'un lector']]) { const r = await req(S1, `/api/interventions/course/${g}`, who); ok(`${label} → rechazado, sin datos`, r.status === 403 && r.text === DENIED, `${r.status} ${r.text.slice(0, 90)}`); }

    console.log('[3] efectividad');
    const e = await req(S1, '/api/interventions/effectiveness?courseId=g-a', 'med-a');
    ok('de su grupo → agregado que cuenta SOLO a los lectores con A2 (3 de 4 intervenciones)', e.status === 200 && e.json?.totalInterventions === 3, `${e.status} ${e.json?.totalInterventions}`);
    const eg = await req(S1, '/api/interventions/effectiveness', 'med-a');
    ok('sin courseId → el agregado de SUS grupos, no el global (3, no 8)', eg.status === 200 && eg.json?.totalInterventions === 3, String(eg.json?.totalInterventions));
    ok('…y para el mediador B, solo lo suyo (2: su lector; la intervención sobre el B2C no cuenta)', (await req(S1, '/api/interventions/effectiveness', 'med-b')).json?.totalInterventions === 2);
    ok('mediador sin C005 → agregado vacío (ningún lector individual entra en la cuenta)', (await req(S1, '/api/interventions/effectiveness?courseId=g-a', 'med-noc')).json?.totalInterventions === 0);
    for (const [who, g, label] of [['med-b', 'g-a', 'curso de otra institución'], ['med-a2', 'g-a', 'curso que no media']]) { const r = await req(S1, `/api/interventions/effectiveness?courseId=${g}`, who); ok(`efectividad de un ${label} → rechazado`, r.status === 403 && r.text === DENIED, `${r.status}`); }
    ok('la efectividad no trae identificadores, nombres ni notas de lectores', !/ra-yes|ra-no|rb-yes|b2c|nota-privada|Lector /.test(e.text + eg.text));

    console.log('[4] escritura');
    const before = JSON.stringify(stored());
    const bad = [['med-b', 'ra-yes', 'g-a', 'lector de otra institución'], ['med-b', 'ra-yes', 'g-b', 'lector ajeno declarado en un grupo propio'], ['med-a2', 'ra-yes', 'g-a', 'lector de un grupo que no media'],
        ['med-a', 'b2c', 'g-a', 'lector B2C'], ['med-b', 'b2c', 'g-b', 'lector B2C declarado en un grupo propio'], ['med-noc', 'ra-yes', 'g-a', 'mediador sin C005'], ['med-a', 'ra-no', 'g-a', 'lector sin A2'], ['med-a', 'no-existe', 'g-a', 'lector inexistente'], ['ra-yes', 'ra-yes2', 'g-a', 'un lector']];
    const badRes = []; for (const [who, u, g] of bad) badRes.push(await post(S1, who, u, g));
    ok('nueve intentos fuera de ámbito → todos rechazados (403)', badRes.every((r) => r.status === 403), badRes.map((r) => r.status).join(' '));
    ok('…y NADA se escribió: el almacén de intervenciones es idéntico', JSON.stringify(stored()) === before);
    ok('…con el mismo rechazo sin datos para los mediadores', badRes.slice(0, 8).every((r) => r.text === DENIED), [...new Set(badRes.slice(0, 8).map((r) => r.text))].join(' '));
    const good = await post(S2, 'med-a', 'ra-yes', 'g-a', 'nota-legitima');
    ok('mediador → lector de su grupo con A2 y C005 → registrada (201) a su nombre', good.status === 201 && good.json?.intervention?.mediatorId === 'med-a' && stored().length === SEED.length + 1 && stored().some((x) => x.note === 'nota-legitima'));
    ok('campos obligatorios ausentes → 400, como antes', (await req(S1, '/api/interventions', 'med-a', { method: 'POST', body: { studentId: 'ra-yes' } })).status === 400);

    console.log('[5] dos réplicas: revocaciones');
    R.appendDecisions([{ subjectId: 'ra-yes', kind: 'A2', status: 'revoked', actDay: R.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-F5C1-REV' }]);
    const rv = [await req(S1, '/api/interventions/student/ra-yes', 'med-a'), await req(S2, '/api/interventions/student/ra-yes', 'med-a')];
    ok('se revoca la A2 del lector → las DOS réplicas dejan de mostrar su historial', rv.every((r) => r.status === 403 && r.text === DENIED));
    const cr = [await req(S1, '/api/interventions/course/g-a', 'med-a'), await req(S2, '/api/interventions/course/g-a', 'med-a')];
    ok('…su curso ya no lo incluye, en las dos', cr.every((r) => r.status === 200 && students(r) === 'ra-yes2' && !notes(r, 'ra-yes')), cr.map(students).join(' / '));
    ok('…ni la efectividad lo suma, en las dos', (await req(S1, '/api/interventions/effectiveness?courseId=g-a', 'med-a')).json?.totalInterventions === 1 && (await req(S2, '/api/interventions/effectiveness?courseId=g-a', 'med-a')).json?.totalInterventions === 1);
    ok('…ni se puede registrar otra sobre él, en las dos', (await post(S1, 'med-a', 'ra-yes', 'g-a')).status === 403 && (await post(S2, 'med-a', 'ra-yes', 'g-a')).status === 403);
    R.appendDecisions([{ subjectId: 'med-b', kind: 'C005', status: 'revoked', actDay: R.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-F5C1-REV' }]);
    ok('se revoca el C005 del mediador B → las DOS réplicas le niegan el historial y la escritura sobre su propio lector', (await req(S1, '/api/interventions/student/rb-yes', 'med-b')).status === 403 && (await req(S2, '/api/interventions/student/rb-yes', 'med-b')).status === 403 && (await post(S1, 'med-b', 'rb-yes', 'g-b')).status === 403 && (await post(S2, 'med-b', 'rb-yes', 'g-b')).status === 403);
    ok('…y su curso y su efectividad quedan sin detalle individual', (await req(S2, '/api/interventions/course/g-b', 'med-b')).json?.interventions?.length === 0 && (await req(S1, '/api/interventions/effectiveness', 'med-b')).json?.totalInterventions === 0);

    console.log('[6] rechazos y registro no verificable');
    const all = [...badRes.slice(0, 8), ...rv];
    for (const [who, p] of [['med-b', '/api/interventions/student/ra-yes2'], ['med-a', '/api/interventions/student/b2c'], ['med-a', '/api/interventions/student/no-existe'], ['med-b', '/api/interventions/course/g-a'], ['med-b', '/api/interventions/effectiveness?courseId=g-a']]) all.push(await req(S1, p, who));
    ok('todo rechazo es el mismo 403 con el mismo cuerpo: ajeno, B2C, sin A2, sin C005 o inexistente', all.every((r) => r.status === 403 && r.text === DENIED), [...new Set(all.map((r) => `${r.status}:${r.text}`))].join(' '));
    ok('…sin nombres, notas, correos ni identificadores', all.every((r) => !/nota-|Lector|Mediador|fixture\.invalid|ra-|rb-|b2c|g-a|g-b/.test(r.text)));
    fs.renameSync(REG, `${REG}.off`);
    const blind = [await req(S1, '/api/interventions/student/ra-yes2', 'med-a'), await req(S2, '/api/interventions/course/g-a', 'med-a'), await req(S1, '/api/interventions/effectiveness?courseId=g-a', 'med-a'), await post(S2, 'med-a', 'ra-yes2', 'g-a', 'a-ciegas')];
    const admBlind = await req(S1, '/api/interventions/course/g-a', 'adm');
    fs.renameSync(`${REG}.off`, REG);
    ok('registro de decisiones no verificable → ningún mediador obtiene ni escribe nada (fallo cerrado)', blind.every((r) => r.status !== 200 && r.status !== 201 && !/nota-privada/.test(r.text)) && !stored().some((x) => x.note === 'a-ciegas'), blind.map((r) => r.status).join(' '));
    ok('…y la administración no se ve afectada', admBlind.status === 200);

    console.log('[7] administración y usos legítimos');
    const ac = await req(S1, '/api/interventions/course/g-a', 'adm');
    ok('administración: curso completo, también el lector sin A2', ac.status === 200 && students(ac) === 'ra-no,ra-yes,ra-yes2', students(ac));
    // La otra réplica puede servir el almacén de intervenciones desde su caché de lectura unos segundos: se espera a que lo vea.
    let admTotal = -1; for (let i = 0; i < 180 && admTotal !== stored().length; i++) { admTotal = (await req(S1, '/api/interventions/effectiveness', 'adm')).json?.totalInterventions; if (admTotal !== stored().length) await sleep(250); }
    ok('administración: historial de cualquier lector y agregado global', (await req(S2, '/api/interventions/student/rb-yes', 'adm')).status === 200 && (await req(S2, '/api/interventions/student/b2c', 'adm')).status === 200 && admTotal === stored().length, `${admTotal}/${stored().length}`);
    ok('administración: puede registrar una intervención', (await post(S1, 'adm', 'rb-yes', 'g-b', 'nota-adm')).status === 201);
    const legit = await req(S2, '/api/interventions/student/ra-yes2', 'med-a');
    ok('mediador con todo en regla: sigue viendo el historial de su lector y registrando', legit.status === 200 && notes(legit, 'ra-yes2') && (await post(S1, 'med-a', 'ra-yes2', 'g-a', 'nota-2')).status === 201);
    ok('…y la forma de las respuestas no cambió', Object.keys((await req(S1, '/api/interventions/effectiveness?courseId=g-a', 'med-a')).json).sort().join() === 'computedAt,courseId,coursePedagogicalProfile,effectivenessByType,overallImmediateRate,overallImprovementRate,overallSustainedRate,success,successPatterns,topTypes,totalAssessed,totalImproved,totalInterventions' && Object.keys(legit.json).sort().join() === 'history,studentId,success', `${Object.keys((await req(S1, '/api/interventions/effectiveness?courseId=g-a', 'med-a')).json).sort().join()} | ${Object.keys(legit.json).sort().join()}`);
    ok('sin identidad → rechazado', (await req(S1, '/api/interventions/course/g-a', null)).status !== 200 && (await post(S1, null, 'ra-yes2', 'g-a')).status !== 201);
    ok('los registros del servidor no contienen notas de intervenciones', !/nota-privada|nota-legitima/.test(S1.out + S2.out));
} catch (e) {
    fail++; console.error('ERROR', e?.message || e);
} finally {
    S1.child.kill('SIGKILL'); S2.child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
