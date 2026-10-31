/**
 * exportSubmissionsHttp.test.mjs — CHP-TECH-STABILITY-01 y SEC-EXPORT-AUTHZ-01.
 *
 * `server.js` real por HTTP, con stores temporales y usuarios sintéticos, sobre
 * las dos exportaciones ZIP:
 *   GET /api/tasks/:taskId/export-submissions
 *   GET /api/students/:studentId/export-submissions
 * Fija el contrato de autorización y el formato heredado de Archiver 8. Cada ZIP
 * se valida con un lector independiente (zipfile de Python).
 *
 *   node server/__test__/exportSubmissionsHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { freePort } from './helpers/freePort.mjs';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
// Primero `python`: en Windows `python3` es un alias de la tienda que rompe el siguiente spawn de libuv.
const python = ['python', 'python3'].find((bin) => spawnSync(bin, ['-c', 'import zipfile'], { stdio: 'ignore' }).status === 0);
if (!python) {
    console.error('exportSubmissionsHttp: requiere Python como lector ZIP independiente');
    process.exit(1);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_export_zip_'));
const data = path.join(tmp, 'data');
fs.mkdirSync(data);
fs.mkdirSync(path.join(tmp, 'uploads'));
const P = { users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'), subs: path.join(data, 'submissions_db.json') };
const ORG = 'org-sintetica';
const lector = (id, nombre, extra = {}) => ({ id, email: `${id}@t.test`, nombre_completo: nombre, roles: ['lector'], organizationId: ORG, accountStatus: 'active', password: 'x', ...extra });
const mediador = (id, nombre) => ({ id, email: `${id}@t.test`, nombre_completo: nombre, roles: ['mediador'], mediatorKind: 'teacher', organizationId: ORG, accountStatus: 'active', password: 'x' });
const USERS = [
    { id: 'u-admin', email: 'a@t.test', nombre_completo: 'Admin Sintética', roles: ['administrador'], accountStatus: 'active', password: 'x' },
    mediador('u-med', 'Mediadora Uno'), mediador('u-med2', 'Mediadora Dos'), mediador('u-med3', 'Mediadora Sin Grupo'),
    lector('u-ana', 'Ána Pérez'), lector('u-beto', 'Beto Núñez'), lector('u-carla', 'Carla Ajena'), lector('u-out', 'Lector Sin Grupo'),
    lector('u-falso', 'Lector Mediador Falso'),
    lector('u-off', 'Cuenta Inactiva', { accountStatus: 'disabled' }),
    lector('u-syn', 'Cuenta Sintética', { _loadtest_marker: 'x' }),
    { id: 'u-syn-admin', email: 'sa@t.test', nombre_completo: 'Admin Sintético', roles: ['administrador'], _loadtest_marker: 'x', accountStatus: 'active', password: 'x' },
];
const GROUPS = [
    { id: 'g-1', type: 'course', organizationId: ORG, mediatorIds: ['u-med', 'u-falso'], memberIds: ['u-ana', 'u-beto'], studentIds: ['u-ana', 'u-beto'] },
    { id: 'g-2', type: 'club', organizationId: ORG, mediatorIds: ['u-med2'], memberIds: ['u-ana', 'u-carla'], studentIds: ['u-ana', 'u-carla'] },
    { id: 'g-hist', type: 'course', organizationId: 'org-no-registrada', mediatorIds: ['u-med3'], memberIds: ['u-beto'], studentIds: ['u-beto'] },
];
const sub = (o) => ({ id: `s-${o.studentId}-${o.taskId}`, status: 'submitted', submittedAt: '2026-10-20T15:00:00.000Z', wordCount: 3, responseText: 'texto de la entrega', groupId: 'g-1', ...o });
const TITLE = 'Reseña: «Cien años»/final';
const SUBS = [
    sub({ taskId: 't-1', taskTitle: TITLE, studentId: 'u-beto', responseText: 'SECRETO-BETO, ñandú' }),
    sub({ taskId: 't-1', taskTitle: TITLE, studentId: 'u-ana', responseText: 'SECRETO-ANA-G1' }),
    sub({ taskId: 't-1', taskTitle: TITLE, studentId: 'u-out', status: 'draft', responseText: 'SECRETO-BORRADOR' }),
    sub({ taskId: 't-1', taskTitle: TITLE, studentId: 'u-carla', responseText: 'SECRETO-CARLA-FALSO' }), // declara g-1 sin pertenecer
    sub({ taskId: 't-6', taskTitle: 'Del club', studentId: 'u-ana', groupId: 'g-2', responseText: 'SECRETO-ANA-G2' }),
    sub({ taskId: 't-2', taskTitle: '../../evil', studentId: 'u-ana', submittedAt: '2026-10-01T15:00:00.000Z' }),
    sub({ taskId: 't-3', taskTitle: 'Segunda', studentId: 'u-ana', submittedAt: '2026-10-10T15:00:00.000Z' }),
    sub({ taskId: 't-4', taskTitle: 'Del club', studentId: 'u-carla', groupId: 'g-2', responseText: 'SECRETO-CARLA-G2' }),
    sub({ taskId: 't-5', taskTitle: 'Antigua', studentId: 'u-historico' }),
];
const writeStores = () => {
    fs.writeFileSync(P.users, JSON.stringify(USERS));
    fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
    fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG, name: 'Colegio Sintético' }]));
    fs.writeFileSync(P.subs, JSON.stringify(SUBS));
};
writeStores();

let port, BASE, child;
let logs = '';
async function boot(extra = {}) {
    port = await freePort();
    BASE = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, UPLOADS_ROOT: path.join(tmp, 'uploads'), ...extra } });
    child.stdout.on('data', (d) => { logs += d; });
    child.stderr.on('data', (d) => { logs += d; });
    for (let i = 0; ; i++) {
        try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* arrancando */ }
        if (i > 240 || child.exitCode !== null) throw new Error(`no arrancó:\n${logs.slice(-1500)}`);
        await sleep(250);
    }
}
const halt = async () => { child.kill(); await new Promise((r) => child.on('close', r)); };

const get = async (url, user, headers = {}) => {
    const r = await fetch(`${BASE}${url}`, { headers: { ...(user ? { 'x-user-id': user } : {}), ...headers } });
    return { status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) };
};
/** Lee el ZIP con zipfile: nombres, integridad y contenido. */
function readZip(buf) {
    const p = path.join(tmp, `z-${Math.random().toString(36).slice(2)}.zip`);
    fs.writeFileSync(p, buf);
    const py = 'import json,sys,zipfile\nz=zipfile.ZipFile(sys.argv[1])\nprint(json.dumps({"bad":z.testzip(),"files":{i.filename:z.read(i).decode("utf-8") for i in z.infolist()}}))';
    const r = spawnSync(python, ['-I', '-B', '-c', py, p], { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf8' } });
    if (r.status !== 0) throw new Error(`ZIP ilegible: ${r.stderr}`);
    return JSON.parse(r.stdout);
}
const all = (z) => JSON.stringify(z.files);
const TODAY = new Date().toISOString().slice(0, 10);
const safeName = (n) => !n.startsWith('/') && !n.split('/').includes('..') && !n.includes('\\');
const TASK = '/api/tasks/t-1/export-submissions';
const STUDENT = '/api/students/u-ana/export-submissions';
const DENIED = '{"error":"scope_access_denied"}';
const isDenied = (r) => r.status === 403 && r.body.toString() === DENIED;

try {
    await boot();

    for (const [name, url] of [['tarea', TASK], ['estudiante', STUDENT]]) {
        section(`[autenticación] ${name}`);
        ok('sin identidad ⇒ 401', (await get(url)).status === 401);
        ok('usuario inexistente ⇒ 403', (await get(url, 'nadie')).status === 403);
        ok('cuenta inactiva ⇒ 403', (await get(url, 'u-off')).status === 403);
        ok('cuenta sintética ⇒ 403', isDenied(await get(url, 'u-syn')));
        ok('administrador sintético ⇒ 403', isDenied(await get(url, 'u-syn-admin')));
        ok('administrador ⇒ 200', (await get(url, 'u-admin')).status === 200);
    }

    section('[matriz] ZIP colectivo por tarea');
    ok('lector ajeno ⇒ 403', isDenied(await get(TASK, 'u-out')));
    ok('lector con entrega en la tarea ⇒ 403: nunca un ZIP colectivo', isDenied(await get(TASK, 'u-ana')));
    ok('mediador sin grupos activos ⇒ 403', isDenied(await get(TASK, 'u-med3')));
    ok('grupo que lo lista como mediador, pero sin el rol ⇒ 403', isDenied(await get(TASK, 'u-falso')));
    const m1 = await get(TASK, 'u-med');
    ok('mediador del grupo ⇒ 200', m1.status === 200 && m1.headers.get('content-type') === 'application/zip');
    const mz = readZip(m1.body);
    ok('mediador: las entregas de su grupo', all(mz).includes('SECRETO-BETO') && all(mz).includes('SECRETO-ANA-G1'), Object.keys(mz.files).join(' | '));
    ok('mediador: un groupId falso no expone la entrega', !all(mz).includes('SECRETO-CARLA') && !all(mz).includes('u-carla'));
    ok('sin borradores', !all(mz).includes('SECRETO-BORRADOR'));
    ok('tarea de otro grupo ⇒ 403', isDenied(await get('/api/tasks/t-4/export-submissions', 'u-med')));
    ok('tarea inexistente ⇒ misma respuesta que ajena', isDenied(await get('/api/tasks/no-existe/export-submissions', 'u-med')));
    ok('tarea del otro mediador: la ve él', all(readZip((await get('/api/tasks/t-4/export-submissions', 'u-med2')).body)).includes('SECRETO-CARLA-G2'));

    section('[matriz] entregas por estudiante');
    const own = await get(STUDENT, 'u-ana');
    const oz = readZip(own.body);
    ok('estudiante propietario ⇒ 200', own.status === 200);
    ok('propietario: sus cuatro entregas, de todos sus grupos', all(oz).includes('SECRETO-ANA-G1') && all(oz).includes('SECRETO-ANA-G2') && Object.keys(oz.files).length === 9, Object.keys(oz.files).join(' | '));
    ok('propietario: nada de compañeros', !/SECRETO-(BETO|CARLA)|u-beto|Beto|u-carla|Carla/.test(all(oz)));
    ok('estudiante ajeno ⇒ 403', isDenied(await get(STUDENT, 'u-out')));
    ok('compañero de grupo ⇒ 403', isDenied(await get(STUDENT, 'u-beto')));
    ok('mediador sin relación ⇒ 403', isDenied(await get(STUDENT, 'u-med3')));
    ok('mediador de otro grupo ⇒ 403', isDenied(await get('/api/students/u-beto/export-submissions', 'u-med2')));
    const ms = await get(STUDENT, 'u-med');
    const msz = readZip(ms.body);
    ok('mediador del alumno ⇒ 200, solo lo de su grupo', ms.status === 200 && all(msz).includes('SECRETO-ANA-G1') && !all(msz).includes('SECRETO-ANA-G2'));
    const ms2 = readZip((await get(STUDENT, 'u-med2')).body);
    ok('alumno en dos grupos: cada mediador ve lo suyo', all(ms2).includes('SECRETO-ANA-G2') && !all(ms2).includes('SECRETO-ANA-G1'));
    ok('estudiante inexistente ⇒ misma respuesta que ajeno', isDenied(await get('/api/students/u-fantasma/export-submissions', 'u-med')) && isDenied(await get('/api/students/u-fantasma/export-submissions', 'u-out')));

    section('[filtración] las denegaciones no revelan nada');
    for (const [u, url] of [['u-out', TASK], ['u-out', STUDENT], ['u-med3', TASK], ['u-med3', STUDENT]]) {
        const r = await get(url, u);
        ok(`${u} sin datos en la respuesta`, !/SECRETO|Ána|Pérez|@t\.test|Reseña|t-1|u-ana/.test(`${r.body}${r.headers.get('content-disposition')}`));
    }
    ok('la cabecera no filtra el nombre del alumno', (await get(STUDENT, 'u-out')).headers.get('content-disposition') === null);
    ok('cabeceras del cliente no amplían el alcance', isDenied(await get(STUDENT, 'u-out', { 'x-student-id': 'u-ana', 'x-group-id': 'g-1' })));
    ok('la consulta no amplía el alcance', isDenied(await get(`${TASK}?groupId=g-1&studentId=u-ana`, 'u-out')) && isDenied(await get(`${STUDENT}?admin=1`, 'u-out')));

    section('[pertenencia cambiante]');
    const edit = (fn) => { const g = JSON.parse(fs.readFileSync(P.groups, 'utf8')); fn(g); fs.writeFileSync(P.groups, JSON.stringify(g)); };
    edit((g) => { g[0].memberIds = ['u-ana']; g[0].studentIds = ['u-ana']; });
    const after = readZip((await get(TASK, 'u-med')).body);
    ok('alumno retirado del grupo: deja de exportarse', !all(after).includes('SECRETO-BETO') && all(after).includes('SECRETO-ANA-G1'));
    ok('…y su exportación individual se deniega', isDenied(await get('/api/students/u-beto/export-submissions', 'u-med')));
    ok('…pero conserva la suya', (await get('/api/students/u-beto/export-submissions', 'u-beto')).status === 200);
    edit((g) => { g[0].mediatorIds = []; });
    ok('mediador retirado: pierde el acceso', isDenied(await get(TASK, 'u-med')));
    edit((g) => { g[1].organizationId = 'org-no-registrada'; });
    ok('grupo que deja de estar activo: sin acceso', isDenied(await get('/api/tasks/t-4/export-submissions', 'u-med2')));
    edit((g) => { g.length = 0; GROUPS.forEach((x) => g.push(x)); });
    ok('restaurado: vuelve el acceso', (await get(TASK, 'u-med')).status === 200);

    section('[identidad no disponible] sin colapsar a una decisión');
    fs.writeFileSync(P.groups, '{ roto');
    const un = await get(TASK, 'u-med');
    ok('grupos ilegibles ⇒ 503, sin datos', un.status === 503 && !/SECRETO/.test(un.body.toString()), un.status);
    ok('mediador por estudiante ⇒ 503', (await get(STUDENT, 'u-med')).status === 503);
    ok('lo propio no depende de los grupos', (await get(STUDENT, 'u-ana')).status === 200);
    writeStores();

    section('[tarea] formato heredado');
    const t = await get(TASK, 'u-admin');
    ok('Content-Type application/zip', t.headers.get('content-type') === 'application/zip');
    const label = 'Tarea_Reseña_Cien_añosfinal';
    ok('nombre de descarga saneado y con fecha', t.headers.get('content-disposition') === `attachment; filename="${label}_${TODAY}.zip"`, t.headers.get('content-disposition'));
    const z = readZip(t.body);
    ok('integridad', z.bad === null);
    const names = Object.keys(z.files);
    ok('administrador: todos, con carpetas por alumno', names.includes(`${label}/resumen.csv`) && names.includes(`${label}/Ána_Pérez_u-ana/respuesta.txt`) && names.includes(`${label}/Ána_Pérez_u-ana/metadatos.json`) && names.includes(`${label}/Beto_Núñez_u-beto/respuesta.txt`), names.join(' | '));
    ok('ningún nombre escapa de la carpeta', names.every(safeName));
    const csv = z.files[`${label}/resumen.csv`].split('\r\n');
    ok('CSV: cabecera exacta', csv[0] === 'studentId,studentName,email,submittedAt,wordCount');
    ok('CSV: orden alfabético en español', csv[1].startsWith('u-ana,Ána Pérez') && csv.findIndex((l) => l.startsWith('u-beto')) > 1, csv.join(' | '));
    ok('UTF-8 intacto en respuesta', z.files[`${label}/Beto_Núñez_u-beto/respuesta.txt`].includes('SECRETO-BETO, ñandú'));
    const m = JSON.parse(z.files[`${label}/Beto_Núñez_u-beto/metadatos.json`]);
    ok('metadatos exactos', m.studentId === 'u-beto' && m.taskId === 't-1' && m.studentName === 'Beto Núñez' && m.wordCount === 3);
    const e = await get('/api/tasks/t-vacia/export-submissions', 'u-admin');
    const ez = readZip(e.body);
    ok('administrador sin entregas: ZIP con aviso', e.status === 200 && Object.keys(ez.files).join() === 'Tarea_t-vacia/sin_entregas.txt' && ez.files['Tarea_t-vacia/sin_entregas.txt'].includes('t-vacia'));

    section('[estudiante] formato heredado');
    const s = await get(STUDENT, 'u-admin');
    ok('nombre de descarga', s.headers.get('content-disposition') === `attachment; filename="Ána_Pérez_${TODAY}.zip"`, s.headers.get('content-disposition'));
    const sz = readZip(s.body);
    const snames = Object.keys(sz.files);
    ok('integridad', sz.bad === null);
    ok('ningún nombre escapa, ni con título ../../evil', snames.every(safeName), snames.join(' | '));
    ok('carpetas por tarea', snames.includes('Ána_Pérez/evil_t-2/respuesta.txt') && snames.includes('Ána_Pérez/Segunda_t-3/metadatos.json'), snames.join(' | '));
    const scsv = sz.files['Ána_Pérez/resumen.csv'].split('\r\n').slice(1).join('\n');
    ok('orden cronológico ascendente', scsv.indexOf('t-2') < scsv.indexOf('t-3') && scsv.indexOf('t-3') < scsv.indexOf('t-1'), scsv);
    ok('administrador: alumno sin entregas', Object.keys(readZip((await get('/api/students/u-med/export-submissions', 'u-admin')).body).files).join() === 'Mediadora_Uno/sin_entregas.txt');
    ok('propietario sin entregas: aviso propio', Object.keys(readZip((await get('/api/students/u-falso/export-submissions', 'u-falso')).body).files).join() === 'Lector_Mediador_Falso/sin_entregas.txt');
    const sx = await get('/api/students/u-fantasma/export-submissions', 'u-admin');
    ok('administrador: inexistente, ZIP con aviso', sx.status === 200 && Object.keys(readZip(sx.body).files).join() === 'Estudiante_u-fantasma/sin_entregas.txt');

    section('[errores]');
    const ctrl = new AbortController();
    const aborted = await fetch(`${BASE}${TASK}`, { headers: { 'x-user-id': 'u-admin' }, signal: ctrl.signal }).then(() => { ctrl.abort(); return true; }).catch(() => true);
    ok('descarga abortada: el servidor sigue sano', aborted && (await fetch(`${BASE}/api/health`)).ok);
    await halt();
    // Lectura en frío: con el servidor en marcha, la caché de readJSON no vería el archivo roto.
    fs.writeFileSync(P.subs, '{ no es json');
    await boot();
    const bad = await get(TASK, 'u-admin');
    const badZip = readZip(bad.body);
    // Contrato heredado: un store ilegible se presenta como «sin entregas», con copia `.corrupt` y log ERROR.
    ok('store ilegible: 200 con aviso de sin entregas, sin caída', bad.status === 200 && Object.keys(badZip.files).join() === 'Tarea_t-1/sin_entregas.txt' && (await fetch(`${BASE}/api/health`)).ok, Object.keys(badZip.files).join());
    ok('el error queda registrado y el archivo roto se conserva', /Error reading/.test(logs) && fs.readdirSync(data).some((f) => f.startsWith('submissions_db.json.corrupt.')));
    ok('sin errores de Archiver', !/Archiver error/.test(logs));
    await halt();

    section('[sesión] modo enforce');
    writeStores();
    const key = path.join(tmp, 'session_key');
    fs.writeFileSync(key, 'k'.repeat(64));
    fs.chmodSync(key, 0o400);
    await boot({ SESSION_KEY_CURRENT_PATH: key, SESSION_KEY_PREVIOUS_PATH: `${key}.prev`, SESSION_AUTH_MODE: 'enforce', SESSIONS_DB: path.join(tmp, 'sessions.db'), IDENTITY_DB: path.join(tmp, 'identity.db'), ALLOWED_ORIGINS: 'http://fx.test' });
    ok('x-user-id sin sesión ⇒ rechazado', [401, 403].includes((await get(TASK, 'u-admin')).status) && [401, 403].includes((await get(STUDENT, 'u-ana')).status));
    const ck = await get(TASK, null, { cookie: 'chp_session=no-valida' });
    // Sin lector POSIX de secretos (Windows) no se puede verificar la firma: 503, igualmente sin datos.
    ok('cookie de sesión inválida ⇒ rechazada sin datos', ck.status === (process.platform === 'win32' ? 503 : 401) && !/SECRETO/.test(ck.body.toString()), ck.status);
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    if (child && child.exitCode === null) await halt();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows puede retener un handle un instante */ }
}

console.log(`\nSEC-EXPORT-AUTHZ-01 (exportaciones ZIP) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
