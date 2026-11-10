/**
 * mediatorValidityHttp.test.mjs — CHP-V8.1-CLOSE-07B (G-07).
 *
 * Vigencia y retiro efectivo de los permisos de un mediador con los mecanismos
 * existentes: su compromiso 005 (C005, con vigencia) en el registro de decisiones y
 * su asignación en `group.mediatorIds`. server.js REAL, dos réplicas, datos sintéticos.
 *  [1] sin C005 ⇒ sin consulta individual; con C005 ⇒ sí (status y Aula Viva)
 *  [2] C005 vencido ⇒ cerrado sin reiniciar; renovado ⇒ abierto
 *  [3] C005 revocado ⇒ cerrado en la petición siguiente, en ambas réplicas
 *  [4] retirado del grupo ⇒ cerrado en la petición siguiente, sin reiniciar (H.1-04)
 *  [5] administración y el propio lector no dependen del C005
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/mediatorValidityHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { freePort } from './helpers/freePort.mjs';
import { a2RegistryPath, grantA2, grantC005 } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ORG = 'org-alfa';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_medvalid_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), uploads: path.join(tmp, 'uploads') };
fs.mkdirSync(P.data, { recursive: true }); fs.mkdirSync(P.uploads, { recursive: true });
const REG = a2RegistryPath();
const READERS = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'med-a', roles: ['mediador'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher' },
    { id: 'adm', roles: ['administrador'], accountStatus: 'active' },
    ...READERS.map((id) => ({ id, nombre_completo: `Sint ${id}`, roles: ['lector'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active' })),
], null, 2));
const GROUP = { id: 'g-a1', type: 'course', organizationId: ORG, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: READERS, studentIds: READERS };
fs.writeFileSync(P.groups, JSON.stringify([GROUP], null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG, name: 'Colegio Alfa' }]));
fs.writeFileSync(P.access, '[]'); fs.writeFileSync(P.content, '[]');
grantA2(READERS); // todos los lectores con A2 = Sí: lo que se prueba es el lado del mediador

function spawnApi(port, i) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), CHP_A2_REGISTRY: REG,
            PROGRESS_SQLITE_PATH: path.join(P.data, `progress-${i}.db`), EVENTS_SQLITE_PATH: path.join(P.data, `events-${i}.db`),
            ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`), INSIGHTS_SQLITE_PATH: path.join(P.data, `insights-${i}.db`),
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
            SESSIONS_DB: path.join(P.data, `sessions-${i}.db`), LEO_EVIDENCE_DB: path.join(P.data, 'leo_evidence_db.json'),
            ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off', OPENAI_API_KEY: '', GEMINI_API_KEY: '',
        },
    });
    let logs = '';
    child.stdout.on('data', (d) => { logs += d; });
    child.stderr.on('data', (d) => { logs += d; });
    child.logs = () => logs;
    child.base = `http://127.0.0.1:${port}`;
    return child;
}
async function healthy(c) {
    for (let i = 0; i < 200; i++) {
        if (c.exitCode !== null) throw new Error(`server rc=${c.exitCode}\n${c.logs().slice(-1500)}`);
        try { if ((await fetch(`${c.base}/api/health`)).ok) return; } catch { /* arrancando */ }
        await sleep(300);
    }
    throw new Error('nunca healthy');
}
const status = async (c, subject, as) => (await fetch(`${c.base}/api/students/${subject}/status`, { headers: { 'x-user-id': as } })).status;
const readers = async (c, as) => {
    const r = await fetch(`${c.base}/api/groups/g-a1/analytics-summary`, { headers: { 'x-user-id': as } });
    const b = await r.json().catch(() => null);
    return r.status === 200 ? (b?.readers ?? []).map((x) => x.userId).sort().join() : `HTTP${r.status}`;
};
const both = async (fn) => [await fn(api1), await fn(api2)];
let api1, api2;
const servers = [];
try {
    const [p1, p2] = [await freePort(), await freePort()];
    api1 = spawnApi(p1, 1); api2 = spawnApi(p2, 2);
    servers.push(api1, api2);
    await healthy(api1); await healthy(api2);
    const ALL = READERS.slice().sort().join();

    section('[1] compromiso 005');
    ok('sin C005: status individual 403 en ambas réplicas', (await both((c) => status(c, 'r1', 'med-a'))).every((s) => s === 403));
    ok('sin C005: Aula Viva sin detalle por lector', (await both((c) => readers(c, 'med-a'))).every((r) => r === ''));
    grantC005(['med-a']);
    ok('con C005 verificado: status 200 en ambas réplicas, sin reiniciar', (await both((c) => status(c, 'r1', 'med-a'))).every((s) => s === 200));
    ok('con C005: Aula Viva con el detalle de su grupo', (await both((c) => readers(c, 'med-a'))).every((r) => r === ALL));

    section('[2] vigencia del 005');
    grantC005(['med-a'], { validUntil: '2000-12-31' });
    ok('005 vencido ⇒ 403 y sin detalle, sin reiniciar', (await status(api1, 'r1', 'med-a')) === 403 && (await readers(api2, 'med-a')) === '');
    grantC005(['med-a'], { validUntil: '2999-12-31' });
    ok('005 renovado con vigencia futura ⇒ 200', (await status(api2, 'r1', 'med-a')) === 200);

    section('[3] retiro del 005');
    grantC005(['med-a'], { status: 'revoked' });
    ok('005 revocado ⇒ 403 en la petición siguiente, en ambas réplicas', (await both((c) => status(c, 'r2', 'med-a'))).every((s) => s === 403));
    grantC005(['med-a']);
    ok('nuevo 005 verificado ⇒ vuelve a 200', (await status(api1, 'r2', 'med-a')) === 200);

    section('[4] retiro de la asignación (H.1-04)');
    ok('asignado: 200', (await status(api2, 'r3', 'med-a')) === 200);
    fs.writeFileSync(P.groups, JSON.stringify([{ ...GROUP, mediatorIds: [] }], null, 2));
    await sleep(50);
    const after = await both((c) => status(c, 'r3', 'med-a'));
    ok('retirado del grupo ⇒ 403 en la petición siguiente, sin reiniciar', after.every((s) => s === 403), after.join());
    ok('…y sin detalle en Aula Viva', (await both((c) => readers(c, 'med-a'))).every((r) => r === 'HTTP403' || r === ''));
    fs.writeFileSync(P.groups, JSON.stringify([GROUP], null, 2));
    await sleep(50);
    ok('reasignado ⇒ 200 otra vez', (await status(api1, 'r3', 'med-a')) === 200);

    section('[5] lo que no cambia');
    grantC005(['med-a'], { status: 'revoked' });
    ok('administración de plataforma: status 200 sin C005', (await status(api1, 'r1', 'adm')) === 200);
    ok('el propio lector: status 200', (await status(api2, 'r1', 'r1')) === 200);
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    for (const s of servers) { try { s.kill('SIGKILL'); } catch { /* noop */ } }
    await sleep(400);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(`\nmediator validity HTTP (V8.1-CLOSE-07B G-07): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
