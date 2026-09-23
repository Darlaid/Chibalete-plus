/**
 * authzListingScope.test.mjs — CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01, fase 2.
 *
 * QUÉ FIJA ESTA SUITE
 * -------------------
 * La fase 1 acotó los GET dirigidos a un sujeto o grupo. Quedaban los LISTADOS y
 * las superficies administrativas, que cualquier sesión —incluido un lector
 * menor— leía completos porque `requireAuth`/`requireAdminAccess` desvían todo
 * GET a "basta con tener sesión":
 *
 *   GET /api/users                       → padrón de TODAS las organizaciones
 *   GET /api/groups                      → grupos de todas las organizaciones
 *   GET /api/schools                     → catálogo completo de instituciones
 *   GET /api/schools/:name/config        → config de cualquier colegio por nombre
 *   GET /api/membership-governance/groups, /api/admin/membership/validate,
 *       /api/system/metrics, /api/admin/tts/stats → datos administrativos
 *
 * Contrato: administrador global; el resto, acotado al tenant que el servidor
 * deriva de la identidad; nada del cliente amplía ese tenant; identidad
 * indisponible → 503. `leo/activation/:userId` ya estaba acotado (CIS) y aquí
 * se re-verifica con el mismo fixture de dos organizaciones.
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
// FIXTURES — dos organizaciones completas + administrador. Ningún id real.
// ────────────────────────────────────────────────────────────────────────────
const ORG_A = 'org-alfa', ORG_B = 'org-beta';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_authz2_'));
const P = {
    data: path.join(tmp, 'data'),
    users: path.join(tmp, 'users.json'),
    groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'),
    schoolsCorrupt: path.join(tmp, 'schools_corrupt.json'),
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
    // Club abierto de B: decisión de producto 2026-09-23 — también se acota.
    { id: 'club-b-open', type: 'club', kind: 'open', organizationId: ORG_B, school: 'Colegio Beta',
      mediatorIds: ['med-b'], memberIds: ['lec-b1'], studentIds: [] },
    // Grupo legacy sin organizationId donde lec-a1 es miembro explícito: lo ve
    // por membresía (su propio alcance), no por tenant.
    { id: 'g-legacy', type: 'club', school: 'Colegio Alfa',
      mediatorIds: [], memberIds: ['lec-a1'], studentIds: [] },
];

const USERS = [
    { id: 'med-a',  roles: ['mediador'],      organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher', email: 'med-a@alfa.test' },
    { id: 'med-b',  roles: ['mediador'],      organizationId: ORG_B, colegio: 'Colegio Beta', accountStatus: 'active', mediatorKind: 'teacher', email: 'med-b@beta.test' },
    { id: 'lec-a1', roles: ['lector'],        organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', email: 'lec-a1@alfa.test' },
    { id: 'lec-a2', roles: ['lector'],        organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', email: 'lec-a2@alfa.test' },
    { id: 'lec-b1', roles: ['lector'],        organizationId: ORG_B, colegio: 'Colegio Beta', accountStatus: 'active', email: 'lec-b1@beta.test' },
    { id: 'lec-x',  roles: ['lector'],                                                        accountStatus: 'active', email: 'lec-x@none.test' },
    // Afirma por texto pertenecer a Beta, pero su identidad es de Alfa.
    { id: 'lec-spoof', roles: ['lector'],     organizationId: ORG_A, colegio: 'Colegio Beta', accountStatus: 'active', email: 'spoof@alfa.test' },
    { id: 'adm',    roles: ['administrador'],                                                 accountStatus: 'active', email: 'adm@plataforma.test' },
];
const B_IDS = ['med-b', 'lec-b1'];
const B_GROUPS = ['g-b1', 'club-b-open'];

const SCHOOL_CONFIGS = [
    { schoolName: 'Colegio Alfa', hiddenContentIds: ['c-alfa-oculto'] },
    { schoolName: 'Colegio Beta', hiddenContentIds: ['c-beta-oculto'] },
];

const CONTENT = [
    { id: 'c-1', titulo: 'Uno', autor: 'A', tipo: 'libro', status: 'disponible' },
];

fs.writeFileSync(P.users, JSON.stringify(USERS, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS, null, 2));
fs.writeFileSync(P.schools, JSON.stringify(SCHOOLS, null, 2));
fs.writeFileSync(P.schoolsCorrupt, '{ esto no es json');
fs.writeFileSync(P.access, '[]');
fs.writeFileSync(P.content, JSON.stringify(CONTENT, null, 2));
fs.writeFileSync(path.join(P.data, 'school_configs.json'), JSON.stringify(SCHOOL_CONFIGS, null, 2));

// ────────────────────────────────────────────────────────────────────────────
// HARNESS — servidor real sobre stores temporales. TODAS las rutas de base al
// sandbox (fase 1: sin esto se toca la progress.db real y su -shm).
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

const PORT = 5060 + (process.pid % 80);
const BASE = `http://127.0.0.1:${PORT}`;
const PORT_BAD = PORT + 100;
const BASE_BAD = `http://127.0.0.1:${PORT_BAD}`;
let api, apiBad;

const GET = (userId, url, base = BASE, extra = {}) =>
    fetch(`${base}${url}`, { headers: userId ? { 'x-user-id': userId, ...extra } : { ...extra } });
const json = async (r) => { try { return await r.json(); } catch { return null; } };
const ids = (arr) => (Array.isArray(arr) ? arr.map(x => x?.id) : []);

// Intentos de ampliar el alcance desde el cliente: ninguno debe tener efecto.
const FORGED_QS = `?organizationId=${ORG_B}&school=Colegio%20Beta&colegio=Colegio%20Beta&groupId=g-b1`;
const FORGED_HEADERS = { 'x-organization-id': ORG_B, 'x-school': 'Colegio Beta', 'x-colegio': 'Colegio Beta' };

const ADMIN_ONLY = [
    '/api/membership-governance/groups',
    '/api/admin/membership/validate',
    '/api/system/metrics',
    '/api/admin/tts/stats',
];

// ────────────────────────────────────────────────────────────────────────────
async function main() {
    api = spawnApi(PORT);
    await waitHealthy(BASE, api);

    section('[1] /api/users — el padrón se acota al tenant en el servidor');
    for (const who of ['lec-a1', 'med-a']) {
        const r = await GET(who, '/api/users');
        const got = ids(await json(r));
        ok(`${who} → 200`, r.status === 200, String(r.status));
        ok(`${who} no recibe a nadie de org B`, !got.some(id => B_IDS.includes(id)), got.join(','));
        ok(`${who} recibe su propio tenant (med-a, lec-a1, lec-a2)`,
            ['med-a', 'lec-a1', 'lec-a2'].every(id => got.includes(id)), got.join(','));
        ok(`${who} no recibe al administrador ni a cuentas sin organización`,
            !got.includes('adm') && !got.includes('lec-x'), got.join(','));
        const f = ids(await json(await GET(who, `/api/users${FORGED_QS}`, BASE, FORGED_HEADERS)));
        ok(`${who} con organizationId/school/colegio/groupId de B forjados → sigue sin B`,
            !f.some(id => B_IDS.includes(id)) && f.length === got.length, f.join(','));
    }
    {
        const got = ids(await json(await GET('lec-x', '/api/users')));
        ok('lector sin organización → solo él mismo', got.length === 1 && got[0] === 'lec-x', got.join(','));
        const spoof = ids(await json(await GET('lec-spoof', '/api/users')));
        ok('colegio de texto «Colegio Beta» no da acceso a B (manda organizationId)',
            !spoof.some(id => B_IDS.includes(id)), spoof.join(','));
        const adm = ids(await json(await GET('adm', '/api/users')));
        ok('administrador → padrón global', USERS.every(u => adm.includes(u.id)), adm.join(','));
        const anon = await GET(null, '/api/users');
        ok('sin sesión → 401 (contrato de auth intacto)', anon.status === 401, String(anon.status));
        const sinPwd = JSON.stringify(await json(await GET('adm', '/api/users')));
        ok('la sanitización previa se conserva (sin password)', !sinPwd.includes('"password"'));
    }

    section('[2] /api/groups — solo grupos de la organización o de membresía propia');
    for (const who of ['lec-a1', 'med-a']) {
        const r = await GET(who, '/api/groups');
        const got = ids(await json(r));
        ok(`${who} → 200`, r.status === 200, String(r.status));
        ok(`${who} no recibe grupos de org B (tampoco el club abierto)`,
            !got.some(id => B_GROUPS.includes(id)), got.join(','));
        ok(`${who} recibe g-a1`, got.includes('g-a1'), got.join(','));
        const f = ids(await json(await GET(who, `/api/groups${FORGED_QS}`, BASE, FORGED_HEADERS)));
        ok(`${who} con parámetros de B forjados → sigue sin B`, !f.some(id => B_GROUPS.includes(id)), f.join(','));
    }
    {
        const a1 = ids(await json(await GET('lec-a1', '/api/groups')));
        ok('lec-a1 ve el grupo legacy sin organizationId donde es miembro explícito', a1.includes('g-legacy'), a1.join(','));
        const ma = ids(await json(await GET('med-a', '/api/groups')));
        ok('…y med-a no lo ve (ni tenant ni membresía)', !ma.includes('g-legacy'), ma.join(','));
        const x = ids(await json(await GET('lec-x', '/api/groups')));
        ok('lector sin organización ni membresías → []', x.length === 0, x.join(','));
        const adm = ids(await json(await GET('adm', '/api/groups')));
        ok('administrador → todos los grupos', GROUPS.every(g => adm.includes(g.id)), adm.join(','));
        const g = await json(await GET('lec-a1', '/api/groups'));
        const ga1 = Array.isArray(g) ? g.find(x => x.id === 'g-a1') : null;
        ok('la forma normalizada del grupo no cambia', Array.isArray(ga1?.mediatorIds) && ga1?.type === 'course');
    }

    section('[3] /api/schools — cada sesión conoce solo su institución');
    {
        const a = await json(await GET('lec-a1', '/api/schools'));
        ok('lec-a1 → solo Colegio Alfa', ids(a).join(',') === ORG_A, JSON.stringify(a));
        const m = await json(await GET('med-a', `/api/schools${FORGED_QS}`, BASE, FORGED_HEADERS));
        ok('med-a (con parámetros forjados) → solo Colegio Alfa', ids(m).join(',') === ORG_A, JSON.stringify(m));
        const x = await json(await GET('lec-x', '/api/schools'));
        ok('lector sin organización → []', Array.isArray(x) && x.length === 0, JSON.stringify(x));
        const adm = ids(await json(await GET('adm', '/api/schools')));
        ok('administrador → catálogo completo', adm.includes(ORG_A) && adm.includes(ORG_B), adm.join(','));
    }

    section('[4] Superficies administrativas: lector y mediador NO entran');
    for (const url of ADMIN_ONLY) {
        for (const who of ['lec-a1', 'med-a']) {
            const r = await GET(who, url);
            ok(`${who} → ${url} → 403`, r.status === 403, String(r.status));
        }
        const adm = await GET('adm', url);
        ok(`adm → ${url} → 200`, adm.status === 200, String(adm.status));
        const anon = await GET(null, url);
        ok(`sin sesión → ${url} → 401`, anon.status === 401, String(anon.status));
    }
    {
        const body = JSON.stringify(await json(await GET('med-a', '/api/membership-governance/groups')));
        ok('el 403 administrativo no contiene datos', !body.includes('g-b1') && !body.includes('counts'), body);
    }

    section('[5] /api/schools/:name/config — el nombre de la URL no es autoridad');
    {
        const enc = encodeURIComponent;
        for (const who of ['lec-a1', 'med-a']) {
            const own = await GET(who, `/api/schools/${enc('Colegio Alfa')}/config`);
            const ob = await json(own);
            ok(`${who} → config de su colegio → 200 con su contenido`,
                own.status === 200 && ob?.hiddenContentIds?.includes('c-alfa-oculto'), JSON.stringify(ob));
            const ajena = await GET(who, `/api/schools/${enc('Colegio Beta')}/config`);
            ok(`${who} → config de Colegio Beta → 403`, ajena.status === 403, String(ajena.status));
        }
        const spoof = await GET('lec-spoof', `/api/schools/${enc('Colegio Beta')}/config`);
        ok('colegio de texto de B con identidad de A → 403', spoof.status === 403, String(spoof.status));
        const spoofOwn = await GET('lec-spoof', `/api/schools/${enc('Colegio Alfa')}/config`);
        ok('…y sí lee la de su organización real', spoofOwn.status === 200, String(spoofOwn.status));
        const adm = await json(await GET('adm', `/api/schools/${enc('Colegio Beta')}/config`));
        ok('administrador → config de cualquier colegio', adm?.hiddenContentIds?.includes('c-beta-oculto'), JSON.stringify(adm));

        const b1 = await GET('med-a', `/api/schools/${enc('Colegio Beta')}/config`);
        const b2 = await GET('med-a', `/api/schools/${enc('Colegio Que No Existe')}/config`);
        const t1 = JSON.stringify(await json(b1)), t2 = JSON.stringify(await json(b2));
        ok('colegio ajeno y colegio inexistente dan la MISMA respuesta (sin oráculo)',
            b1.status === b2.status && t1 === t2, `${b1.status} ${t1} | ${b2.status} ${t2}`);
        ok('el 403 no filtra la config ajena', !t1.includes('c-beta-oculto') && !t1.includes('Colegio Beta'), t1);
    }

    section('[6] /api/leo/activation/:userId — sigue acotado por CIS');
    {
        const self = await GET('lec-a1', '/api/leo/activation/lec-a1');
        ok('lec-a1 → su propia activación → 200', self.status === 200, String(self.status));
        const ajeno = await GET('lec-a1', '/api/leo/activation/lec-b1');
        ok('lec-a1 → activación de un lector de B → 403', ajeno.status === 403, String(ajeno.status));
        const mAlumno = await GET('med-a', '/api/leo/activation/lec-a1');
        ok('med-a → alumno de su grupo → 200', mAlumno.status === 200, String(mAlumno.status));
        const mAjeno = await GET('med-a', '/api/leo/activation/lec-b1');
        ok('med-a → alumno de org B → 403', mAjeno.status === 403, String(mAjeno.status));
        const mNadie = await GET('med-a', '/api/leo/activation/no-existe-jamas');
        ok('med-a → id inexistente → 403 (mismo que ajeno)', mNadie.status === 403, String(mNadie.status));
        const adm = await GET('adm', '/api/leo/activation/lec-b1');
        ok('adm → cualquiera → 200', adm.status === 200, String(adm.status));
    }

    section('[7] IDENTIDAD INDISPONIBLE → 503, nunca listado vacío silencioso');
    {
        apiBad = spawnApi(PORT_BAD, { SCHOOLS_DB: P.schoolsCorrupt });
        await waitHealthy(BASE_BAD, apiBad);
        const g = await GET('lec-a1', '/api/groups', BASE_BAD);
        const gb = await json(g);
        ok('registro de organizaciones corrupto → /api/groups 503', g.status === 503, `${g.status} ${JSON.stringify(gb)}`);
        ok('…tipificado identity_unavailable', gb?.error === 'identity_unavailable', JSON.stringify(gb));
        const adm = await GET('adm', '/api/groups', BASE_BAD);
        ok('el administrador no depende del registro → 200', adm.status === 200, String(adm.status));
    }

    section('[8] LOS STORES NO SE TOCARON');
    {
        ok('users byte-idéntico', fs.readFileSync(P.users, 'utf8') === JSON.stringify(USERS, null, 2));
        ok('groups byte-idéntico', fs.readFileSync(P.groups, 'utf8') === JSON.stringify(GROUPS, null, 2));
        ok('schools byte-idéntico', fs.readFileSync(P.schools, 'utf8') === JSON.stringify(SCHOOLS, null, 2));
        ok('school_configs byte-idéntico',
            fs.readFileSync(path.join(P.data, 'school_configs.json'), 'utf8') === JSON.stringify(SCHOOL_CONFIGS, null, 2));
    }
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message, e.stack); fail++; })
    .finally(async () => {
        for (const c of [api, apiBad]) { try { c?.kill('SIGKILL'); } catch { /* ya muerto */ } }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows retiene a veces */ }
        console.log(`\nauthzListingScope: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    });
