/**
 * authzSubjectScope.test.mjs — CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01, fase 1.
 *
 * QUÉ FIJA ESTA SUITE
 * -------------------
 * `requireAuth` y `requireAdminAccess` desvían TODO método GET a
 * `allowAuthenticatedGetOrReject`, que solo exige sesión activa: ni rol ni
 * tenant. En producción (2026-09-23) eso permitía que un mediador de un colegio
 * —y, por el mismo camino, un lector menor de edad— consultara indicando el id:
 *
 *   GET /api/access/by-user/<alumno ajeno>   → 200 con su entitlement completo
 *   GET /api/students/<alumno ajeno>/status  → 200 con su nombre y su mensaje
 *   GET /api/groups/<grupo ajeno>/members    → 200 con la nómina
 *   GET /api/groups/<grupo ajeno>/candidates → 200
 *   GET /api/groups/<grupo ajeno>/diagnosis  → 200
 *
 * Leo ya estaba acotado (CHP-LEO-MEDIATOR-CIS-SCOPE-01A) y devolvía 403. Estos
 * casos extienden ese MISMO patrón (CIS `evaluateScopeAccess`) a las cinco
 * rutas dirigidas, y fijan que no se pueda volver a abrir en silencio.
 *
 * FUERA DE ALCANCE (fase 2, deliberadamente NO se prueba aquí): los listados
 * `/api/users` y `/api/groups`, que se acotarán filtrando por tenant.
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
// FIXTURES — dos organizaciones completas. Ningún id real.
// ────────────────────────────────────────────────────────────────────────────
const ORG_A = 'org-alfa', ORG_B = 'org-beta';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_authz_'));
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

const SCHOOLS = [
    { id: ORG_A, name: 'Colegio Alfa' },
    { id: ORG_B, name: 'Colegio Beta' },
];

const GROUPS = [
    { id: 'g-a1', type: 'course', organizationId: ORG_A, school: 'Colegio Alfa',
      mediatorIds: ['med-a'], memberIds: ['lec-a1', 'lec-a2'], studentIds: ['lec-a1', 'lec-a2'] },
    { id: 'g-b1', type: 'course', organizationId: ORG_B, school: 'Colegio Beta',
      mediatorIds: ['med-b'], memberIds: ['lec-b1'], studentIds: ['lec-b1'] },
];

const USERS = [
    { id: 'med-a',  roles: ['mediador'],      organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher' },
    { id: 'med-b',  roles: ['mediador'],      organizationId: ORG_B, colegio: 'Colegio Beta', accountStatus: 'active', mediatorKind: 'teacher' },
    { id: 'lec-a1', roles: ['lector'],        organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active' },
    { id: 'lec-a2', roles: ['lector'],        organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active' },
    { id: 'lec-b1', roles: ['lector'],        organizationId: ORG_B, colegio: 'Colegio Beta', accountStatus: 'active' },
    { id: 'adm',    roles: ['administrador'],                        accountStatus: 'active' },
];

const CONTENT = [
    { id: 'c-1', titulo: 'Uno', autor: 'A', tipo: 'libro', status: 'disponible' },
    { id: 'c-2', titulo: 'Dos', autor: 'B', tipo: 'libro', status: 'disponible' },
];

const ACCESS = [
    { id: 'r-a1', scope: 'group', scopeId: 'g-a1', titleIds: ['c-1'], collectionIds: [] },
    { id: 'r-b1', scope: 'group', scopeId: 'g-b1', titleIds: ['c-2'], collectionIds: [] },
];

fs.writeFileSync(P.users, JSON.stringify(USERS, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS, null, 2));
fs.writeFileSync(P.schools, JSON.stringify(SCHOOLS, null, 2));
fs.writeFileSync(P.access, JSON.stringify(ACCESS, null, 2));
fs.writeFileSync(P.content, JSON.stringify(CONTENT, null, 2));

// ────────────────────────────────────────────────────────────────────────────
// HARNESS — servidor real sobre stores temporales (patrón libraryStore/RMW).
// ────────────────────────────────────────────────────────────────────────────
function spawnApi(port, extraEnv = {}) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env,
            NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: P.data,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
            // Todas las bases SQLite al sandbox. `/api/students/:id/status` y
            // `/diagnosis` leen progreso: sin esto el test abriría la
            // progress.db REAL y tocaría su sidecar -shm (lo detecta
            // verify-test-store-isolation).
            PROGRESS_SQLITE_PATH: path.join(P.data, 'progress.db'),
            EVENTS_SQLITE_PATH: path.join(P.data, 'events.db'),
            ARCHIVE_SQLITE_PATH: path.join(P.data, 'events.archive.db'),
            INSIGHTS_SQLITE_PATH: path.join(P.data, 'insights.db'),
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, 'offline_assignments.db'),
            IDENTITY_DB: path.join(P.data, 'identity.db'),
            SESSIONS_DB: path.join(P.data, 'sessions.db'),
            LEO_EVIDENCE_DB: path.join(P.data, 'leo_evidence_db.json'),
            ACCESS_FALLBACK_MODE: 'restricted',
            SESSION_AUTH_MODE: 'off',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '',
            ...extraEnv,
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

// 5040 lo ocupa en Windows el servicio Connected Devices Platform (escucha en
// 0.0.0.0): el hijo se enlazaba en `::` y las peticiones a 127.0.0.1 iban a ese
// servicio → fallo intermitente cuando pid % 80 === 60. Se salta ese puerto.
const PORT = ((p) => (p === 5040 ? 5041 : p))(4980 + (process.pid % 80));
const BASE = `http://127.0.0.1:${PORT}`;
let api;

const GET = (userId, url) => fetch(`${BASE}${url}`, { headers: { 'x-user-id': userId } });
const json = async (r) => { try { return await r.json(); } catch { return null; } };

const RUTAS_SUJETO = (uid) => [
    ['access',    `/api/access/by-user/${uid}`],
    ['status',    `/api/students/${uid}/status`],
];
const RUTAS_GRUPO = (gid) => [
    ['members',    `/api/groups/${gid}/members`],
    ['candidates', `/api/groups/${gid}/candidates`],
    ['diagnosis',  `/api/groups/${gid}/diagnosis`],
];

// ────────────────────────────────────────────────────────────────────────────
async function main() {
    api = spawnApi(PORT);
    await waitHealthy(BASE, api);

    // ── EL GATE CENTRAL ─────────────────────────────────────────────────────
    section('[1] CROSS-TENANT: un mediador NO alcanza a otra organización');
    {
        for (const [nombre, url] of RUTAS_SUJETO('lec-b1')) {
            const r = await GET('med-a', url);
            ok(`med-a → ${nombre} de un lector de org B → 403`, r.status === 403, String(r.status));
            const b = await json(r);
            ok(`   …con error tipificado, no un 404 ambiguo`, b?.error === 'scope_access_denied', JSON.stringify(b));
        }
        for (const [nombre, url] of RUTAS_GRUPO('g-b1')) {
            const r = await GET('med-a', url);
            ok(`med-a → ${nombre} del grupo de org B → 403`, r.status === 403, String(r.status));
        }
    }

    section('[2] NO SE ROMPE EL CASO LEGÍTIMO: el mediador sobre SU propio grupo');
    {
        for (const [nombre, url] of RUTAS_SUJETO('lec-a1')) {
            const r = await GET('med-a', url);
            ok(`med-a → ${nombre} de un miembro de SU grupo → 200`, r.status === 200, String(r.status));
        }
        for (const [nombre, url] of RUTAS_GRUPO('g-a1')) {
            const r = await GET('med-a', url);
            ok(`med-a → ${nombre} de SU grupo → 200`, r.status === 200, String(r.status));
        }
        const acc = await json(await GET('med-a', '/api/access/by-user/lec-a1'));
        ok('   …y el cuerpo sigue siendo el contrato de siempre',
            Array.isArray(acc?.titleIds) && acc.titleIds.includes('c-1'), JSON.stringify(acc));
    }

    section('[3] UN LECTOR NO ES UN MEDIADOR');
    {
        for (const [nombre, url] of RUTAS_SUJETO('lec-a2')) {
            const r = await GET('lec-a1', url);
            ok(`lec-a1 → ${nombre} de OTRO lector de su mismo colegio → 403`, r.status === 403, String(r.status));
        }
        for (const [nombre, url] of RUTAS_GRUPO('g-a1')) {
            const r = await GET('lec-a1', url);
            ok(`lec-a1 → ${nombre} de su propio grupo → 403 (no media nada)`, r.status === 403, String(r.status));
        }
    }

    section('[4] SELF: consultar lo propio nunca fue el problema');
    {
        for (const [nombre, url] of RUTAS_SUJETO('lec-a1')) {
            const r = await GET('lec-a1', url);
            ok(`lec-a1 → su propio ${nombre} → 200`, r.status === 200, String(r.status));
        }
    }

    section('[5] ADMINISTRADOR: el CIS le concede alcance');
    {
        for (const [nombre, url] of [...RUTAS_SUJETO('lec-b1'), ...RUTAS_GRUPO('g-b1')]) {
            const r = await GET('adm', url);
            ok(`adm → ${nombre} de org B → 200`, r.status === 200, String(r.status));
        }
    }

    section('[6] EL 403 NO FILTRA NADA del tenant ajeno');
    {
        const cuerpos = [];
        for (const [, url] of [...RUTAS_SUJETO('lec-b1'), ...RUTAS_GRUPO('g-b1')]) {
            cuerpos.push(JSON.stringify(await json(await GET('med-a', url))));
        }
        const todo = cuerpos.join('|');
        for (const fuga of ['Colegio Beta', 'org-beta', 'c-2', 'titleIds', 'members', 'nombre_completo']) {
            ok(`el cuerpo del 403 no contiene "${fuga}"`, !todo.includes(fuga), todo.slice(0, 200));
        }
        // El scope_id es lo que el propio llamante envió: devolverlo no revela nada.
        ok('el 403 eco del scope_id solicitado (no es fuga)', todo.includes('scope_access_denied'));
    }

    section('[7] SUJETO INEXISTENTE: se deniega por alcance ANTES de revelar existencia');
    {
        const r = await GET('med-a', '/api/access/by-user/no-existe-jamas');
        ok('un id inventado da 403, no 404 — no es un oráculo de existencia',
            r.status === 403, String(r.status));
        const g = await GET('med-a', '/api/groups/no-existe-jamas/members');
        ok('ídem para un grupo inventado', g.status === 403, String(g.status));
    }

    section('[8] LOS STORES NO SE TOCARON');
    {
        ok('users_db byte-idéntico al fixture',
            fs.readFileSync(P.users, 'utf8') === JSON.stringify(USERS, null, 2));
        ok('groups_db byte-idéntico al fixture',
            fs.readFileSync(P.groups, 'utf8') === JSON.stringify(GROUPS, null, 2));
        ok('access_db byte-idéntico al fixture',
            fs.readFileSync(P.access, 'utf8') === JSON.stringify(ACCESS, null, 2));
    }
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message, e.stack); fail++; })
    .finally(async () => {
        try { api?.kill('SIGKILL'); } catch { /* ya muerto */ }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows retiene a veces */ }
        console.log(`\nauthzSubjectScope: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    });
