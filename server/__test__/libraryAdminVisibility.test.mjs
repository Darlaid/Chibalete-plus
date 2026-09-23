/**
 * libraryAdminVisibility.test.mjs — CHP-V6-LIBRARY-VISIBILITY-01.
 *
 * QUÉ FIJA ESTA SUITE
 * -------------------
 * En producción la pestaña Libros del administrador estaba vacía porque
 * `/api/content/my-catalog` (su única autoridad desde 11B-1) devolvía 0: el
 * administrador no tiene grupo ni regla de acceso. La corrección es una regla
 * explícita `scope=user`, NO un bypass por rol. Esta suite fija:
 *
 *   B. administrador SIN regla → my-catalog = 0 (no reapareció el bypass);
 *   A. con regla scope=user → my-catalog = exactamente esos títulos;
 *   C. retirada la regla → vuelve a 0;
 *   D. my-catalog responde `Cache-Control: no-store`;
 *   y el lector no hereda nada de la regla del administrador.
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

const ORG_A = 'org-alfa';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_libvis_'));
const P = {
    data: path.join(tmp, 'data'),
    users: path.join(tmp, 'users.json'),
    groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'),
    uploads: path.join(tmp, 'uploads'),
};
fs.mkdirSync(P.data, { recursive: true });
fs.mkdirSync(P.uploads, { recursive: true });

const CONTENT = [
    { id: 'c-1', titulo: 'Uno', autor: 'A', tipo: 'libro', status: 'disponible' },
    { id: 'c-2', titulo: 'Dos', autor: 'B', tipo: 'libro_album', status: 'disponible' },
    { id: 'c-3', titulo: 'Tres', autor: 'C', tipo: 'libro', status: 'disponible' },
];
const USERS = [
    { id: 'adm',    roles: ['administrador'], accountStatus: 'active' },
    { id: 'lec-a1', roles: ['lector'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active' },
];
const GROUPS = [
    { id: 'g-a1', type: 'course', organizationId: ORG_A, school: 'Colegio Alfa',
      mediatorIds: [], memberIds: ['lec-a1'], studentIds: ['lec-a1'] },
];
const READER_RULE = { id: 'r-group-a1', scope: 'group', scopeId: 'g-a1', titleIds: ['c-1'], collectionIds: [], expiresAt: null };
const ADMIN_RULE  = { id: 'r-user-adm', scope: 'user', scopeId: 'adm', titleIds: ['c-1', 'c-2'], collectionIds: [], expiresAt: null };

const write = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, 2));
write(P.users, USERS);
write(P.groups, GROUPS);
write(P.schools, [{ id: ORG_A, name: 'Colegio Alfa' }]);
write(P.access, [READER_RULE]);
write(P.content, CONTENT);

function spawnApi(port) {
    const d = P.data;
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env,
            NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: d,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            USER_AUDIT_DB: path.join(d, 'user_audit.json'),
            PROGRESS_SQLITE_PATH: path.join(d, 'progress.db'),
            EVENTS_SQLITE_PATH: path.join(d, 'events.db'),
            ARCHIVE_SQLITE_PATH: path.join(d, 'events.archive.db'),
            INSIGHTS_SQLITE_PATH: path.join(d, 'insights.db'),
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(d, 'offline_assignments.db'),
            IDENTITY_DB: path.join(d, 'identity.db'),
            SESSIONS_DB: path.join(d, 'sessions.db'),
            LEO_EVIDENCE_DB: path.join(d, 'leo_evidence_db.json'),
            ACCESS_FALLBACK_MODE: 'restricted',
            SESSION_AUTH_MODE: 'off',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '',
        },
    });
    let bootLog = '';
    child.stdout.on('data', x => { bootLog += x; });
    child.stderr.on('data', x => { bootLog += x; });
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

const PORT = 5420 + (process.pid % 80);
const BASE = `http://127.0.0.1:${PORT}`;
let api;
const catalog = async (uid) => {
    const r = await fetch(`${BASE}/api/content/my-catalog`, { headers: { 'x-user-id': uid } });
    const b = await r.json().catch(() => null);
    return { status: r.status, ids: (b?.catalog || []).map(x => x.id).sort(), cc: r.headers.get('cache-control') };
};
// El access_db se cachea hasta 30 s (TTL por defecto de readJSON): se sondea
// hasta que el cambio se refleje, con un techo explícito.
async function until(uid, pred, maxMs = 45000) {
    const t0 = Date.now();
    let last;
    while (Date.now() - t0 < maxMs) {
        last = await catalog(uid);
        if (pred(last)) return { ...last, ms: Date.now() - t0 };
        await sleep(1000);
    }
    return { ...last, ms: Date.now() - t0, timeout: true };
}

async function main() {
    api = spawnApi(PORT);
    await waitHealthy(BASE, api);

    section('[B/D] administrador SIN regla: catálogo vacío, sin bypass por rol');
    const adm0 = await catalog('adm');
    ok('B · my-catalog del administrador → 200 con 0 títulos', adm0.status === 200 && adm0.ids.length === 0, JSON.stringify(adm0));
    ok('D · Cache-Control: no-store', adm0.cc === 'no-store', String(adm0.cc));
    const lec0 = await catalog('lec-a1');
    ok('   el lector ve su regla de grupo (c-1)', JSON.stringify(lec0.ids) === '["c-1"]', JSON.stringify(lec0.ids));
    ok('D · también no-store para el lector', lec0.cc === 'no-store', String(lec0.cc));

    section('[A] regla explícita scope=user → exactamente esos títulos');
    write(P.access, [READER_RULE, ADMIN_RULE]);
    const adm1 = await until('adm', c => c.ids.length > 0);
    ok('A · my-catalog del administrador = c-1, c-2', JSON.stringify(adm1.ids) === '["c-1","c-2"]', JSON.stringify(adm1));
    ok('   c-3 (no concedido) no aparece: no es el catálogo completo', !adm1.ids.includes('c-3'));
    const lec1 = await catalog('lec-a1');
    ok('   el lector NO hereda la regla del administrador', JSON.stringify(lec1.ids) === '["c-1"]', JSON.stringify(lec1.ids));

    section('[C] retirada la regla → vuelve a 0');
    write(P.access, [READER_RULE]);
    const adm2 = await until('adm', c => c.ids.length === 0);
    ok(`C · my-catalog del administrador vuelve a 0 (${adm2.ms} ms, cota: TTL de caché de 30 s)`,
        adm2.status === 200 && adm2.ids.length === 0 && !adm2.timeout, JSON.stringify(adm2));
    const lec2 = await catalog('lec-a1');
    ok('   el lector sigue igual', JSON.stringify(lec2.ids) === '["c-1"]', JSON.stringify(lec2.ids));

    section('[store] el fixture de usuarios y contenido no se tocó');
    ok('users byte-idéntico', fs.readFileSync(P.users, 'utf8') === JSON.stringify(USERS, null, 2));
    ok('content byte-idéntico', fs.readFileSync(P.content, 'utf8') === JSON.stringify(CONTENT, null, 2));
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message, e.stack); fail++; })
    .finally(async () => {
        try { api?.kill('SIGKILL'); } catch { /* ya muerto */ }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows retiene a veces */ }
        console.log(`\nlibraryAdminVisibility: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    });
