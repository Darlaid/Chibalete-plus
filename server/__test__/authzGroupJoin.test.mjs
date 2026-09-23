/**
 * authzGroupJoin.test.mjs — CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01, fase 2B.
 *
 * QUÉ FIJA ESTA SUITE
 * -------------------
 * `POST /api/groups/:id/join` («clubes externos») dejaba a cualquier sesión
 * unirse a cualquier club `open` conociendo su id, sin mirar el tenant. La
 * fase 2 ya acotó el listado; aquí se cierra la escritura:
 *
 *   - no-admin: solo grupos de SU organización (identidad del servidor);
 *   - grupo ajeno e id inexistente → el mismo 403 (sin oráculo de existencia);
 *   - un join denegado no escribe NADA (grupos ni usuarios);
 *   - elegibilidad (open / no open), idempotencia y administrador: sin cambios;
 *   - store canónico ilegible → 503.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ────────────────────────────────────────────────────────────────────────────
// FIXTURES — dos organizaciones. Ningún id real.
// ────────────────────────────────────────────────────────────────────────────
const ORG_A = 'org-alfa', ORG_B = 'org-beta';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_authz2b_'));
const P = {
    data: path.join(tmp, 'data'),
    users: path.join(tmp, 'users.json'),
    groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'),
    uploads: path.join(tmp, 'uploads'),
    bad: path.join(tmp, 'bad'),
};
for (const d of [P.data, P.uploads, P.bad]) fs.mkdirSync(d, { recursive: true });

const SCHOOLS = [
    { id: ORG_A, name: 'Colegio Alfa' },
    { id: ORG_B, name: 'Colegio Beta' },
];

const GROUPS = [
    { id: 'club-a-open', type: 'club', kind: 'open', organizationId: ORG_A, school: 'Colegio Alfa',
      mediatorIds: ['med-a'], memberIds: ['lec-a2'], studentIds: ['lec-a2'] },
    { id: 'club-b-open', type: 'club', kind: 'open', organizationId: ORG_B, school: 'Colegio Beta',
      mediatorIds: ['med-b'], memberIds: ['lec-b1'], studentIds: ['lec-b1'] },
    { id: 'club-a-closed', type: 'club', kind: 'school', organizationId: ORG_A, school: 'Colegio Alfa',
      mediatorIds: ['med-a'], memberIds: [], studentIds: [] },
    { id: 'course-a', type: 'course', organizationId: ORG_A, school: 'Colegio Alfa',
      mediatorIds: ['med-a'], memberIds: ['lec-a2'], studentIds: ['lec-a2'] },
];

const USERS = [
    { id: 'med-a',  roles: ['mediador'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', groupIds: ['club-a-open', 'club-a-closed', 'course-a'] },
    { id: 'med-b',  roles: ['mediador'], organizationId: ORG_B, colegio: 'Colegio Beta', accountStatus: 'active', groupIds: ['club-b-open'] },
    { id: 'lec-a1', roles: ['lector'],   organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', groupIds: [] },
    { id: 'lec-a2', roles: ['lector'],   organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', groupIds: ['club-a-open', 'course-a'] },
    { id: 'lec-b1', roles: ['lector'],   organizationId: ORG_B, colegio: 'Colegio Beta', accountStatus: 'active', groupIds: ['club-b-open'] },
    // Afirma por texto ser de Beta; su identidad es de Alfa.
    { id: 'lec-spoof', roles: ['lector'], organizationId: ORG_A, colegio: 'Colegio Beta', accountStatus: 'active', groupIds: [] },
    { id: 'lec-x',  roles: ['lector'],                                                  accountStatus: 'active', groupIds: [] },
    { id: 'adm',    roles: ['administrador'],                                           accountStatus: 'active', groupIds: [] },
];

const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));
write(P.users, USERS);
write(P.groups, GROUPS);
write(P.schools, SCHOOLS);
write(P.access, []);
write(P.content, [{ id: 'c-1', titulo: 'Uno', autor: 'A', tipo: 'libro', status: 'disponible' }]);

// Sandbox paralelo para J9: el store canónico de grupos es ilegible.
const BAD = { users: path.join(P.bad, 'users.json'), groups: path.join(P.bad, 'groups.json'), data: path.join(P.bad, 'data') };
fs.mkdirSync(BAD.data, { recursive: true });
write(BAD.users, USERS);
fs.writeFileSync(BAD.groups, '{ esto no es json');

// ────────────────────────────────────────────────────────────────────────────
// HARNESS — servidor real; TODAS las rutas de base al sandbox (lección fase 1).
// ────────────────────────────────────────────────────────────────────────────
function spawnApi(port, over = {}) {
    const data = over.data ?? P.data;
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env,
            NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: data,
            USERS_DB: over.users ?? P.users, GROUPS_DB: over.groups ?? P.groups, SCHOOLS_DB: P.schools,
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            USER_AUDIT_DB: path.join(data, 'user_audit.json'),
            PROGRESS_SQLITE_PATH: path.join(data, 'progress.db'),
            EVENTS_SQLITE_PATH: path.join(data, 'events.db'),
            ARCHIVE_SQLITE_PATH: path.join(data, 'events.archive.db'),
            INSIGHTS_SQLITE_PATH: path.join(data, 'insights.db'),
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(data, 'offline_assignments.db'),
            IDENTITY_DB: path.join(data, 'identity.db'),
            SESSIONS_DB: path.join(data, 'sessions.db'),
            LEO_EVIDENCE_DB: path.join(data, 'leo_evidence_db.json'),
            ACCESS_FALLBACK_MODE: 'restricted',
            SESSION_AUTH_MODE: 'off',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '',
        },
    });
    let bootLog = '';
    child.stdout.on('data', d => { bootLog += d; });
    child.stderr.on('data', d => { bootLog += d; });
    child._boot = () => bootLog;
    return child;
}

async function waitHealthy(base, child) {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child._boot().slice(-2000)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy\n${child._boot().slice(-2000)}`);
}

const PORT = 5240 + (process.pid % 80);
const BASE = `http://127.0.0.1:${PORT}`;
const PORT_BAD = PORT + 100;
let api, apiBad;

const JOIN = (userId, gid, { body = {}, qs = '', base = BASE } = {}) => fetch(`${base}/api/groups/${gid}/join${qs}`, {
    method: 'POST',
    headers: { 'x-user-id': userId, 'content-type': 'application/json' },
    body: JSON.stringify(body),
});
const json = async (r) => { try { return await r.json(); } catch { return null; } };
const snap = () => fs.readFileSync(P.groups, 'utf8') + '\u0000' + fs.readFileSync(P.users, 'utf8');
const readG = (id) => JSON.parse(fs.readFileSync(P.groups, 'utf8')).find(g => g.id === id);
const readU = (id) => JSON.parse(fs.readFileSync(P.users, 'utf8')).find(u => u.id === id);
const count = (arr, v) => (Array.isArray(arr) ? arr.filter(x => x === v).length : 0);

// ────────────────────────────────────────────────────────────────────────────
async function main() {
    api = spawnApi(PORT);
    await waitHealthy(BASE, api);

    section('[J2/J3/J10] CROSS-TENANT: 403 y cero escrituras');
    {
        const before = snap();
        const r = await JOIN('lec-a1', 'club-b-open');
        const b = await json(r);
        ok('J2 lec-a1 (A) → club abierto de B → 403', r.status === 403, String(r.status));
        ok('   …tipificado scope_access_denied', b?.error === 'scope_access_denied', JSON.stringify(b));
        ok('   …sin datos del grupo ajeno en el cuerpo',
            !JSON.stringify(b).includes('org-beta') && !JSON.stringify(b).includes('lec-b1'), JSON.stringify(b));
        const r3 = await JOIN('lec-b1', 'club-a-open');
        ok('J3 lec-b1 (B) → club abierto de A → 403', r3.status === 403, String(r3.status));
        const rm = await JOIN('med-a', 'club-b-open');
        ok('   mediador de A → club de B → 403', rm.status === 403, String(rm.status));
        ok('J10 grupos y usuarios byte-idénticos tras los tres intentos', snap() === before);
        ok('   club-b-open sigue sin lec-a1 en memberIds/studentIds',
            !readG('club-b-open').memberIds.includes('lec-a1') && !readG('club-b-open').studentIds.includes('lec-a1'));
        ok('   lec-a1.groupIds sigue vacío', readU('lec-a1').groupIds.length === 0);
    }

    section('[J4] CAMPOS DE TENANT FORJADOS no amplían el alcance');
    {
        const before = snap();
        const forged = { organizationId: ORG_B, school: 'Colegio Beta', colegio: 'Colegio Beta', groupId: 'club-b-open' };
        const r = await JOIN('lec-a1', 'club-b-open', { body: forged, qs: `?organizationId=${ORG_B}&school=Colegio%20Beta` });
        ok('lec-a1 con organizationId/school de B en body y query → 403', r.status === 403, String(r.status));
        const r2 = await JOIN('lec-b1', 'club-a-open', { body: { organizationId: ORG_A } });
        ok('lec-b1 con organizationId de A en body → 403', r2.status === 403, String(r2.status));
        const r3 = await JOIN('lec-spoof', 'club-b-open');
        ok('colegio de texto «Colegio Beta» con identidad de A → 403', r3.status === 403, String(r3.status));
        const r4 = await JOIN('lec-x', 'club-a-open');
        ok('lector sin organización → 403 (no hay tenant que coincida)', r4.status === 403, String(r4.status));
        ok('   stores byte-idénticos', snap() === before);
    }

    section('[J8] ID INEXISTENTE: misma respuesta que un grupo ajeno');
    {
        const before = snap();
        const a = await JOIN('lec-a1', 'club-b-open');
        const n = await JOIN('lec-a1', 'no-existe-jamas');
        const ta = JSON.stringify(await json(a)), tn = JSON.stringify(await json(n));
        ok('ajeno e inexistente → mismo status y mismo cuerpo', a.status === n.status && ta === tn, `${a.status} ${ta} | ${n.status} ${tn}`);
        ok('   stores byte-idénticos', snap() === before);
    }

    section('[J6/J7] ELEGIBILIDAD sin cambios dentro del propio tenant');
    {
        const before = snap();
        const c = await JOIN('lec-a1', 'club-a-closed');
        const cb = await json(c);
        ok('J6 club cerrado (kind≠open) de A → 403 histórico', c.status === 403 && cb?.error === 'Este grupo no admite uniones directas', `${c.status} ${JSON.stringify(cb)}`);
        const k = await JOIN('lec-a1', 'course-a');
        const kb = await json(k);
        ok('J7 curso (tipo no joinable) de A → 403 histórico', k.status === 403 && kb?.error === 'Este grupo no admite uniones directas', `${k.status} ${JSON.stringify(kb)}`);
        ok('   stores byte-idénticos', snap() === before);
    }

    section('[J1/J5] JOIN LEGÍTIMO en el propio tenant + idempotencia');
    {
        const r = await JOIN('lec-a1', 'club-a-open');
        const b = await json(r);
        ok('J1 lec-a1 → club abierto de A → 200', r.status === 200, `${r.status} ${JSON.stringify(b)}`);
        ok('   la respuesta es el grupo normalizado con lec-a1', b?.id === 'club-a-open' && b?.memberIds?.includes('lec-a1'));
        const g = readG('club-a-open'), u = readU('lec-a1');
        ok('   memberIds y studentIds contienen lec-a1 exactamente una vez',
            count(g.memberIds, 'lec-a1') === 1 && count(g.studentIds, 'lec-a1') === 1);
        ok('   user.groupIds contiene el club exactamente una vez', count(u.groupIds, 'club-a-open') === 1);
        ok('   el miembro previo (lec-a2) se conserva', g.memberIds.includes('lec-a2'));
        const after = snap();
        const r2 = await JOIN('lec-a1', 'club-a-open');
        const b2 = await json(r2);
        ok('J5 segundo join → 200 con el mismo grupo', r2.status === 200 && b2?.id === 'club-a-open');
        ok('   idempotente: stores byte-idénticos al primer join', snap() === after);
        const r3 = await JOIN('lec-a2', 'club-a-open');
        ok('   miembro preexistente → 200 sin escribir', r3.status === 200 && snap() === after);
    }

    section('[ADMIN] contrato previo intacto (acción sobre sí mismo)');
    {
        const n = await JOIN('adm', 'no-existe-jamas');
        ok('adm → id inexistente → 404 histórico', n.status === 404, String(n.status));
        const c = await JOIN('adm', 'course-a');
        ok('adm → grupo no joinable → 403 histórico', c.status === 403, String(c.status));
        const r = await JOIN('adm', 'club-b-open');
        ok('adm → club abierto de cualquier organización → 200 (sin cambios)', r.status === 200, String(r.status));
        ok('   se une a sí mismo, no a terceros', readG('club-b-open').memberIds.includes('adm') && readU('adm').groupIds.includes('club-b-open'));
    }

    section('[J9] STORE CANÓNICO ILEGIBLE → 503, sin escribir');
    {
        apiBad = spawnApi(PORT_BAD, { users: BAD.users, groups: BAD.groups, data: BAD.data });
        await waitHealthy(`http://127.0.0.1:${PORT_BAD}`, apiBad);
        const before = fs.readFileSync(BAD.groups, 'utf8') + fs.readFileSync(BAD.users, 'utf8');
        const r = await JOIN('lec-a1', 'club-a-open', { base: `http://127.0.0.1:${PORT_BAD}` });
        const b = await json(r);
        ok('grupos ilegibles → 503 identity_unavailable', r.status === 503 && b?.error === 'identity_unavailable', `${r.status} ${JSON.stringify(b)}`);
        ok('   nada escrito', fs.readFileSync(BAD.groups, 'utf8') + fs.readFileSync(BAD.users, 'utf8') === before);
        ok('   sin .tmp residual', !fs.existsSync(`${BAD.groups}.tmp`) && !fs.existsSync(`${BAD.users}.tmp`));
    }
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message, e.stack); fail++; })
    .finally(async () => {
        for (const c of [api, apiBad]) { try { c?.kill('SIGKILL'); } catch { /* ya muerto */ } }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows retiene a veces */ }
        console.log(`\nauthzGroupJoin: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    });
