/**
 * exportSubmissionsHttp.test.mjs — CHP-TECH-STABILITY-01.
 *
 * `server.js` real por HTTP, con stores temporales y usuarios sintéticos, sobre
 * las dos exportaciones ZIP que pasaron a `ZipArchive` con Archiver 8:
 *   GET /api/tasks/:taskId/export-submissions
 *   GET /api/students/:studentId/export-submissions
 * Cada ZIP se valida con un lector independiente (zipfile de Python).
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
const USERS = [
    { id: 'u-admin', email: 'a@t.test', nombre_completo: 'Admin Sintética', roles: ['administrador'], accountStatus: 'active', password: 'x' },
    { id: 'u-med', email: 'm@t.test', nombre_completo: 'Mediadora Sintética', roles: ['mediador'], mediatorKind: 'teacher', accountStatus: 'active', password: 'x' },
    { id: 'u-ana', email: 'ana@t.test', nombre_completo: 'Ána Pérez', roles: ['lector'], accountStatus: 'active', password: 'x' },
    { id: 'u-beto', email: 'beto@t.test', nombre_completo: 'Beto Núñez', roles: ['lector'], accountStatus: 'active', password: 'x' },
    { id: 'u-out', email: 'out@t.test', nombre_completo: 'Lector Ajeno', roles: ['lector'], accountStatus: 'active', password: 'x' },
    { id: 'u-off', email: 'off@t.test', nombre_completo: 'Cuenta Inactiva', roles: ['lector'], accountStatus: 'disabled', password: 'x' },
];
const sub = (o) => ({ id: `s-${o.studentId}-${o.taskId}`, status: 'submitted', submittedAt: '2026-10-20T15:00:00.000Z', wordCount: 3, responseText: 'texto de la entrega', ...o });
const SUBS = [
    sub({ taskId: 't-1', taskTitle: 'Reseña: «Cien años»/final', studentId: 'u-beto', responseText: 'Respuesta de Beto, ñandú' }),
    sub({ taskId: 't-1', taskTitle: 'Reseña: «Cien años»/final', studentId: 'u-ana', responseText: 'Respuesta de Ána' }),
    sub({ taskId: 't-1', taskTitle: 'Reseña: «Cien años»/final', studentId: 'u-out', status: 'draft' }),
    sub({ taskId: 't-1', taskTitle: 'Reseña: «Cien años»/final', studentId: 'u-historico' }),
    sub({ taskId: 't-2', taskTitle: '../../evil', studentId: 'u-ana', submittedAt: '2026-10-01T15:00:00.000Z' }),
    sub({ taskId: 't-3', taskTitle: 'Segunda', studentId: 'u-ana', submittedAt: '2026-10-10T15:00:00.000Z' }),
];
fs.writeFileSync(path.join(tmp, 'users.json'), JSON.stringify(USERS));
fs.writeFileSync(path.join(data, 'submissions_db.json'), JSON.stringify(SUBS));

let port, BASE, child;
let logs = '';
async function boot() {
    port = await freePort();
    BASE = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: data, USERS_DB: path.join(tmp, 'users.json'), UPLOADS_ROOT: path.join(tmp, 'uploads') } });
    child.stdout.on('data', (d) => { logs += d; });
    child.stderr.on('data', (d) => { logs += d; });
    for (let i = 0; ; i++) {
        try { if ((await fetch(`${BASE}/api/health`)).ok) return; } catch { /* arrancando */ }
        if (i > 240 || child.exitCode !== null) throw new Error(`no arrancó:\n${logs.slice(-1500)}`);
        await sleep(250);
    }
}
const halt = async () => { child.kill(); await new Promise((r) => child.on('close', r)); };

const get = async (url, user) => {
    const r = await fetch(`${BASE}${url}`, { headers: user ? { 'x-user-id': user } : {} });
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
const TODAY = new Date().toISOString().slice(0, 10);
const safeName = (n) => !n.startsWith('/') && !n.split('/').includes('..') && !n.includes('\\');

try {
    await boot();

    for (const [name, url] of [['tarea', '/api/tasks/t-1/export-submissions'], ['estudiante', '/api/students/u-ana/export-submissions']]) {
        section(`[autenticación] ${name}`);
        ok('sin identidad ⇒ 401', (await get(url)).status === 401);
        ok('usuario inexistente ⇒ 403', (await get(url, 'nadie')).status === 403);
        ok('cuenta inactiva ⇒ 403', (await get(url, 'u-off')).status === 403);
        ok('administrador ⇒ 200', (await get(url, 'u-admin')).status === 200);
    }

    // Deuda conocida, anterior a Archiver 8: las rutas no comprueban a quién pertenece
    // lo exportado. Esto NO da el comportamiento por correcto: solo lo hace visible.
    section('[autorización] DEUDA: sin control de alcance');
    const obs = {};
    for (const [k, url, u] of [['tarea por lector ajeno', '/api/tasks/t-1/export-submissions', 'u-out'], ['estudiante por lector ajeno', '/api/students/u-ana/export-submissions', 'u-out'],
        ['estudiante por sí mismo', '/api/students/u-ana/export-submissions', 'u-ana'], ['tarea por mediador sin grupo', '/api/tasks/t-1/export-submissions', 'u-med']]) obs[k] = (await get(url, u)).status;
    console.log('  DEUDA observada', JSON.stringify(obs));

    section('[tarea] respuesta y contenido');
    const t = await get('/api/tasks/t-1/export-submissions', 'u-admin');
    ok('Content-Type application/zip', t.headers.get('content-type') === 'application/zip');
    const label = 'Tarea_Reseña_Cien_añosfinal';
    ok('nombre de descarga saneado y con fecha', t.headers.get('content-disposition') === `attachment; filename="${label}_${TODAY}.zip"`, t.headers.get('content-disposition'));
    const z = readZip(t.body);
    ok('integridad', z.bad === null);
    const names = Object.keys(z.files);
    ok('estructura exacta', JSON.stringify(names.slice().sort()) === JSON.stringify([`${label}/resumen.csv`,
        `${label}/Ána_Pérez_u-ana/metadatos.json`, `${label}/Ána_Pérez_u-ana/respuesta.txt`, `${label}/Beto_Núñez_u-beto/metadatos.json`, `${label}/Beto_Núñez_u-beto/respuesta.txt`,
        `${label}/Estudiante_u-historico_u-historico/metadatos.json`, `${label}/Estudiante_u-historico_u-historico/respuesta.txt`].sort()), names.join(' | '));
    ok('ningún nombre escapa de la carpeta', names.every(safeName));
    ok('un borrador no se exporta', !names.some((n) => n.includes('u-out')));
    const csv = z.files[`${label}/resumen.csv`].split('\r\n');
    ok('CSV: cabecera exacta', csv[0] === 'studentId,studentName,email,submittedAt,wordCount');
    ok('CSV: orden alfabético en español', csv[1].startsWith('u-ana,Ána Pérez') && csv[2].startsWith('u-beto,Beto Núñez'), csv.join(' | '));
    ok('UTF-8 intacto en respuesta', z.files[`${label}/Beto_Núñez_u-beto/respuesta.txt`].includes('Respuesta de Beto, ñandú'));
    const m = JSON.parse(z.files[`${label}/Ána_Pérez_u-ana/metadatos.json`]);
    ok('metadatos exactos', m.studentId === 'u-ana' && m.taskId === 't-1' && m.studentName === 'Ána Pérez' && m.wordCount === 3);

    section('[tarea] sin entregas');
    const e = await get('/api/tasks/t-vacia/export-submissions', 'u-admin');
    const ez = readZip(e.body);
    ok('ZIP válido con aviso', e.status === 200 && JSON.stringify(Object.keys(ez.files)) === JSON.stringify(['Tarea_t-vacia/sin_entregas.txt']), Object.keys(ez.files).join());
    ok('el aviso nombra la tarea', ez.files['Tarea_t-vacia/sin_entregas.txt'].includes('t-vacia'));

    section('[estudiante] respuesta y contenido');
    const s = await get('/api/students/u-ana/export-submissions', 'u-admin');
    ok('nombre de descarga', s.headers.get('content-disposition') === `attachment; filename="Ána_Pérez_${TODAY}.zip"`, s.headers.get('content-disposition'));
    const sz = readZip(s.body);
    const snames = Object.keys(sz.files);
    ok('integridad', sz.bad === null);
    ok('tres tareas + resumen', snames.length === 7, snames.join(' | '));
    ok('ningún nombre escapa, ni con título ../../evil', snames.every(safeName), snames.join(' | '));
    ok('carpetas por tarea', snames.includes('Ána_Pérez/evil_t-2/respuesta.txt') && snames.includes('Ána_Pérez/Segunda_t-3/metadatos.json'), snames.join(' | '));
    const scsv = sz.files['Ána_Pérez/resumen.csv'].split('\r\n').slice(1).join('\n');
    ok('orden cronológico ascendente', scsv.indexOf('t-2') < scsv.indexOf('t-3') && scsv.indexOf('t-3') < scsv.indexOf('t-1'), scsv);

    section('[estudiante] sin entregas e inexistente');
    const se = await get('/api/students/u-med/export-submissions', 'u-admin');
    ok('sin entregas: aviso', Object.keys(readZip(se.body).files).join() === 'Mediadora_Sintética/sin_entregas.txt');
    const sx = await get('/api/students/u-fantasma/export-submissions', 'u-admin');
    ok('inexistente: ZIP con aviso, sin error', sx.status === 200 && Object.keys(readZip(sx.body).files).join() === 'Estudiante_u-fantasma/sin_entregas.txt');

    section('[errores]');
    const ctrl = new AbortController();
    const aborted = await fetch(`${BASE}/api/tasks/t-1/export-submissions`, { headers: { 'x-user-id': 'u-admin' }, signal: ctrl.signal }).then(() => { ctrl.abort(); return true; }).catch(() => true);
    ok('descarga abortada: el servidor sigue sano', aborted && (await fetch(`${BASE}/api/health`)).ok);
    await halt();
    // Lectura en frío: con el servidor en marcha, la caché de readJSON no vería el archivo roto.
    fs.writeFileSync(path.join(data, 'submissions_db.json'), '{ no es json');
    await boot();
    const bad = await get('/api/tasks/t-1/export-submissions', 'u-admin');
    const badZip = readZip(bad.body);
    // Contrato heredado: un store ilegible se presenta como «sin entregas», con copia `.corrupt` y log ERROR.
    ok('store ilegible: 200 con aviso de sin entregas, sin caída', bad.status === 200 && Object.keys(badZip.files).join() === 'Tarea_t-1/sin_entregas.txt' && (await fetch(`${BASE}/api/health`)).ok, Object.keys(badZip.files).join());
    ok('el error queda registrado y el archivo roto se conserva', /Error reading/.test(logs) && fs.readdirSync(data).some((f) => f.startsWith('submissions_db.json.corrupt.')));
    ok('sin registrar errores de Archiver', !/Archiver error/.test(logs));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    if (child && child.exitCode === null) await halt();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows puede retener un handle un instante */ }
}

console.log(`\nCHP-TECH-STABILITY-01 (exportaciones ZIP) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
