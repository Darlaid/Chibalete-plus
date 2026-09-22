/**
 * libraryInstitutionalPersonal.test.mjs
 * CHP-V6-LIBRARY-INSTITUTIONAL-01 / Etapa 11B-2 §§5-16, 20-26.
 *
 * Matrices I1–I12 y P1–P12 contra el SERVIDOR REAL. No hay réplicas del
 * handler ni mocks del motor de acceso: se arranca `server/server.js` con
 * `CHP_DATA_DIR` en un directorio temporal y se habla HTTP con él, de modo que
 * el entitlement lo decide el accessService real, la autorización institucional
 * el CIS real y el store el `withFileLock` real.
 *
 * Aislamiento (§20): todo vive en `fs.mkdtemp`. Stores reales (`data/`,
 * `data-critical/`, `public/uploads/`) — 0 lecturas, 0 escrituras.
 *
 * El gate central es §24: una referencia a contenido DENEGADO no lo vuelve
 * visible ni abrible por ninguna vía.
 *
 *   node server/__test__/libraryInstitutionalPersonal.test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ────────────────────────────────────────────────────────────────────────────
// FIXTURES — 2 organizaciones, identidades de todos los casos. Ningún id real.
// ────────────────────────────────────────────────────────────────────────────
const ORG_A = 'org-alfa', ORG_B = 'org-beta';
const EXPIRES_IN_MS = 4000;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_lib_'));
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
const LIBRARY = path.join(P.data, 'library_db.json');

const SCHOOLS = [
    { id: ORG_A, name: 'Colegio Alfa' },
    { id: ORG_B, name: 'Colegio Beta' },
];

const GROUPS = [
    { id: 'g-a1',   type: 'course', organizationId: ORG_A, mediatorIds: ['med-a'], memberIds: ['lec-a', 'off-a', 'lec-exp'] },
    { id: 'g-b1',   type: 'course', organizationId: ORG_B, mediatorIds: ['med-b'], memberIds: ['lec-b'] },
    // §16 — cohorte de carga. Existe, y no debe producir ninguna referencia.
    { id: 'g-load', type: 'course', organizationId: ORG_A, mediatorIds: [], memberIds: ['synth-1'] },
];

const USERS = [
    { id: 'lec-a',      roles: ['lector'],        organizationId: ORG_A, accountStatus: 'active' },
    { id: 'lec-user',   roles: ['lector'],        organizationId: ORG_A, accountStatus: 'active' }, // P10: sin grupo
    { id: 'lec-exp',    roles: ['lector'],        organizationId: ORG_A, accountStatus: 'active' }, // §13
    { id: 'med-a',      roles: ['mediador'],      organizationId: ORG_A, accountStatus: 'active', mediatorKind: 'teacher' },
    { id: 'adm-a',      roles: ['administrador'], organizationId: ORG_A, accountStatus: 'active' },
    { id: 'adm-noorg',  roles: ['administrador'],                        accountStatus: 'active' }, // §7/I10
    { id: 'lec-noorg',  roles: ['lector'],                               accountStatus: 'active' }, // I10
    { id: 'lec-b',      roles: ['lector'],        organizationId: ORG_B, accountStatus: 'active' },
    { id: 'med-b',      roles: ['mediador'],      organizationId: ORG_B, accountStatus: 'active', mediatorKind: 'teacher' },
    { id: 'off-a',      roles: ['lector'],        organizationId: ORG_A, accountStatus: 'disabled' }, // I12/P12
    { id: 'synth-1',    roles: ['lector'],        organizationId: ORG_A, accountStatus: 'active', _loadtest_marker: true },
];

const CONTENT = [
    { id: 'c-1',     titulo: 'Uno',   autor: 'A', tipo: 'libro', status: 'disponible' },
    { id: 'c-2',     titulo: 'Dos',   autor: 'B', tipo: 'libro', status: 'disponible' },
    { id: 'c-3',     titulo: 'Tres',  autor: 'C', tipo: 'libro', status: 'disponible' }, // solo org B
    { id: 'c-4',     titulo: 'Cuatro', autor: 'D', tipo: 'libro', status: 'disponible' }, // entitlement temporal
    { id: 'c-nadie', titulo: 'Nadie', autor: 'E', tipo: 'libro', status: 'disponible' }, // §24: de nadie
    { id: 'c-ped',   titulo: 'Guía',  autor: 'F', tipo: 'guia',  status: 'disponible' }, // pedagógico
];

const ACCESS = [
    { id: 'r-g-a1',    scope: 'group', scopeId: 'g-a1',      titleIds: ['c-1', 'c-2', 'c-ped'], collectionIds: [] },
    { id: 'r-g-b1',    scope: 'group', scopeId: 'g-b1',      titleIds: ['c-3'],                 collectionIds: [] },
    { id: 'r-u-user',  scope: 'user',  scopeId: 'lec-user',  titleIds: ['c-1'],                 collectionIds: [] },
    { id: 'r-u-adm',   scope: 'user',  scopeId: 'adm-a',     titleIds: ['c-1'],                 collectionIds: [] },
    { id: 'r-u-off',   scope: 'user',  scopeId: 'off-a',     titleIds: ['c-1'],                 collectionIds: [] },
    { id: 'r-u-synth', scope: 'user',  scopeId: 'synth-1',   titleIds: ['c-1'],                 collectionIds: [] },
    // §13 — entitlement con ventana temporal. El reloj del SERVIDOR lo cierra.
    { id: 'r-exp',     scope: 'user',  scopeId: 'lec-exp',   titleIds: ['c-4'],                 collectionIds: [], expiresAt: Date.now() + EXPIRES_IN_MS },
];

/**
 * §24 — el fixture de library_db se siembra A MANO con referencias a `c-nadie`,
 * contenido sobre el que NADIE tiene entitlement. Si una referencia bastara
 * para leer, aparecerían.
 */
const SEEDED_LIBRARY = {
    collections: [
        { id: 'col-ed-1', layer: 'EDITORIAL', contextId: null, name: 'Editorial', description: '', published: true, position: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'col-ia-1', layer: 'INSTITUTIONAL', contextId: ORG_A, name: 'Plan lector Alfa', description: '', published: true, position: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'col-ib-1', layer: 'INSTITUTIONAL', contextId: ORG_B, name: 'Plan lector Beta', description: '', published: true, position: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
    references: [
        { id: 'ref-ed-1',    bookId: 'c-1',     layer: 'EDITORIAL',    contextId: null,  collectionId: 'col-ed-1', position: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'ref-ia-1',    bookId: 'c-1',     layer: 'INSTITUTIONAL', contextId: ORG_A, collectionId: 'col-ia-1', position: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'ref-ia-2',    bookId: 'c-2',     layer: 'INSTITUTIONAL', contextId: ORG_A, collectionId: null,       position: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        // §24 — referencia institucional a contenido DENEGADO para todos.
        { id: 'ref-ia-nad',  bookId: 'c-nadie', layer: 'INSTITUTIONAL', contextId: ORG_A, collectionId: 'col-ia-1', position: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        // I3 — referencia de la OTRA organización.
        { id: 'ref-ib-1',    bookId: 'c-3',     layer: 'INSTITUTIONAL', contextId: ORG_B, collectionId: 'col-ib-1', position: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        // P1/P2 — personales de dos usuarios distintos.
        { id: 'ref-pa-1',    bookId: 'c-1',     layer: 'PERSONAL', contextId: 'lec-a',    collectionId: null, position: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        // §24 — referencia PERSONAL a contenido denegado.
        { id: 'ref-pa-nad',  bookId: 'c-nadie', layer: 'PERSONAL', contextId: 'lec-a',    collectionId: null, position: 1, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'ref-pu-1',    bookId: 'c-1',     layer: 'PERSONAL', contextId: 'lec-user', collectionId: null, position: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
    ],
};

fs.writeFileSync(P.users, JSON.stringify(USERS, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS, null, 2));
fs.writeFileSync(P.schools, JSON.stringify(SCHOOLS, null, 2));
fs.writeFileSync(P.access, JSON.stringify(ACCESS, null, 2));
fs.writeFileSync(P.content, JSON.stringify(CONTENT, null, 2));
fs.writeFileSync(LIBRARY, JSON.stringify(SEEDED_LIBRARY, null, 2));

// ────────────────────────────────────────────────────────────────────────────
// HARNESS — servidor real sobre stores temporales (patrón contentStoreRmw).
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
            // Producción corre 'restricted' por override; el test lo fija explícito.
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

const PORT = 4750 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const PORT_COMPAT = PORT + 1;
const BASE_COMPAT = `http://127.0.0.1:${PORT_COMPAT}`;
let api, apiCompat;

const as = (userId) => ({ 'content-type': 'application/json', 'x-user-id': userId });
const GET = (userId, url, base = BASE) => fetch(`${base}${url}`, { headers: as(userId) });
const SEND = (method) => (userId, url, body, base = BASE) =>
    fetch(`${base}${url}`, { method, headers: as(userId), body: JSON.stringify(body ?? {}) });
const POST = SEND('POST'), PUT = SEND('PUT'), DEL = SEND('DELETE');

const json = async (r) => { try { return await r.json(); } catch { return null; } };
const bookIds = (view) => [
    ...(view?.unassigned ?? []).map(r => r.bookId),
    ...(view?.collections ?? []).flatMap(c => (c.references ?? []).map(r => r.bookId)),
].sort();
const disk = () => JSON.parse(fs.readFileSync(LIBRARY, 'utf8'));

async function accessAllows(userId, contentId) {
    const r = await GET(userId, `/api/content/${contentId}/access?userId=${userId}`);
    const b = await json(r);
    return r.status === 200 && b?.allowed === true;
}

// ────────────────────────────────────────────────────────────────────────────
async function main() {
    api = spawnApi(PORT);
    await waitHealthy(BASE, api);

    // ── §24 GATE CENTRAL ────────────────────────────────────────────────────
    section('[24] REFERENCE_TO_DENIED_CONTENT — el gate central');
    {
        ok('c-nadie existe en el catálogo canónico', CONTENT.some(c => c.id === 'c-nadie'));
        ok('…y está referenciado a mano en INSTITUTIONAL y PERSONAL',
            SEEDED_LIBRARY.references.filter(r => r.bookId === 'c-nadie').length === 2);

        const inst = await json(await GET('lec-a', '/api/library/institutional'));
        const pers = await json(await GET('lec-a', '/api/library/personal'));
        ok('GET institutional NO devuelve c-nadie', !bookIds(inst).includes('c-nadie'), JSON.stringify(bookIds(inst)));
        ok('GET personal NO devuelve c-nadie', !bookIds(pers).includes('c-nadie'), JSON.stringify(bookIds(pers)));

        const pre = await GET('lec-a', '/api/content/c-nadie/access?userId=lec-a');
        ok('el preflight canónico DENIEGA c-nadie', pre.status === 403, String(pre.status));

        const cat = await json(await GET('lec-a', '/api/content/my-catalog'));
        ok('my-catalog tampoco lo incluye', !(cat?.catalog ?? []).some(c => c.id === 'c-nadie'));

        ok('la referencia denegada SIGUE persistida (no se borra, queda inerte)',
            disk().references.some(r => r.id === 'ref-pa-nad'));
    }

    // ── INSTITUTIONAL: LECTURA ──────────────────────────────────────────────
    section('[I1–I4] INSTITUTIONAL — lectura = curaduría ∩ entitlement');
    {
        const a = await json(await GET('lec-a', '/api/library/institutional'));
        ok('I1 · lector de A recibe solo referencias de A con entitlement',
            bookIds(a).join(',') === 'c-1,c-2', JSON.stringify(bookIds(a)));
        ok('I2 · una referencia de A SIN entitlement no aparece', !bookIds(a).includes('c-nadie'));
        ok('I3 · el lector de A nunca ve nada de B',
            !bookIds(a).includes('c-3') && !JSON.stringify(a).includes(ORG_B) && !JSON.stringify(a).includes('Beta'));

        const b = await json(await GET('lec-b', '/api/library/institutional'));
        ok('I3 · el lector de B ve lo suyo y nada de A',
            bookIds(b).join(',') === 'c-3' && !JSON.stringify(b).includes('Alfa'), JSON.stringify(bookIds(b)));

        const m = await json(await GET('med-a', '/api/library/institutional'));
        ok('I4 · el mediador aplica la MISMA regla de entitlement (sin bypass de lectura)',
            !bookIds(m).includes('c-nadie'), JSON.stringify(bookIds(m)));
        ok('I4 · el mediador no recibe el catálogo completo',
            bookIds(m).length < CONTENT.length);

        const adm = await json(await GET('adm-a', '/api/library/institutional'));
        ok('§14 · el administrador tampoco obtiene lectura automática',
            bookIds(adm).join(',') === 'c-1', JSON.stringify(bookIds(adm)));
    }

    // ── INSTITUTIONAL: ESCRITURA ────────────────────────────────────────────
    section('[I5–I9] INSTITUTIONAL — escritura con autorización de servidor');
    let colA = null, refA = null;
    {
        const r5 = await POST('med-a', '/api/library/institutional/collections', { name: 'Club de lectura' });
        colA = await json(r5);
        ok('I5 · mediador de A crea una colección de A', r5.status === 201 && !!colA?.id, String(r5.status));
        ok('I5 · la colección nace en el contexto del servidor',
            disk().collections.find(c => c.id === colA.id)?.contextId === ORG_A);
        ok('I5 · …y en la capa INSTITUTIONAL',
            disk().collections.find(c => c.id === colA.id)?.layer === 'INSTITUTIONAL');

        const r6 = await POST('med-a', '/api/library/institutional/references', { bookId: 'c-4', collectionId: colA.id });
        const body6 = await json(r6);
        refA = body6?.reference ?? null;
        ok('I6 · mediador de A añade una referencia de A', r6.status === 201 && !!refA?.id, String(r6.status));
        ok('I6 · la referencia nace en el contexto del servidor', refA?.contextId === ORG_A);

        // I7 — crear la referencia NO cambia el resultado del access engine.
        // La prueba es de INVARIANZA: se fotografía la decisión del preflight
        // para varias identidades ANTES de curar y se exige la misma después.
        const probes = [['lec-a', 'c-4'], ['lec-a', 'c-nadie'], ['med-a', 'c-nadie'], ['lec-b', 'c-nadie'], ['lec-user', 'c-nadie']];
        const before = [];
        for (const [u, c] of probes) before.push(await accessAllows(u, c));

        const r7 = await POST('med-a', '/api/library/institutional/references', { bookId: 'c-nadie' });
        ok('I7 · se puede curar un contenido sin exigir entitlement universal (§9)', r7.status === 201 || r7.status === 200, String(r7.status));

        const after = [];
        for (const [u, c] of probes) after.push(await accessAllows(u, c));
        ok('I7 · el access engine responde EXACTAMENTE igual antes y después de curar',
            JSON.stringify(before) === JSON.stringify(after),
            `${JSON.stringify(before)} vs ${JSON.stringify(after)}`);
        ok('I7 · c-nadie sigue denegado para el lector tras curarlo',
            !(await accessAllows('lec-a', 'c-nadie')));
        ok('I7 · …y para un lector de la otra organización', !(await accessAllows('lec-b', 'c-nadie')));

        // DEUDA PREEXISTENTE, NO introducida ni modificada por 11B-2: el
        // preflight concede MEDIATOR_ROLE total cuando la organización del
        // mediador no declara restricción en school_configs (server.js, paso 6
        // de la jerarquía). Biblioteca NO replica ese canal: su intersección usa
        // getAccessibleContentIds, así que la vista institucional del mediador
        // sigue SIN mostrar c-nadie (verificado en I4). Se deja registrado aquí
        // para que un cambio futuro del preflight no pase inadvertido.
        ok('deuda registrada · el preflight legacy sí concede MEDIATOR_ROLE sin restricción institucional',
            await accessAllows('med-a', 'c-nadie'));
        const medView = await json(await GET('med-a', '/api/library/institutional'));
        ok('…y aun así Biblioteca NO lo muestra (no replica ese canal)',
            !bookIds(medView).includes('c-nadie'), JSON.stringify(bookIds(medView)));

        ok('I7 · access_db NO fue tocado por la curaduría',
            JSON.stringify(JSON.parse(fs.readFileSync(P.access, 'utf8'))) === JSON.stringify(ACCESS));
        ok('I7 · content.json NO fue tocado por la curaduría',
            JSON.stringify(JSON.parse(fs.readFileSync(P.content, 'utf8'))) === JSON.stringify(CONTENT));

        const r9 = await POST('lec-a', '/api/library/institutional/references', { bookId: 'c-1' });
        ok('I9 · un lector NO puede escribir la biblioteca institucional', r9.status === 403, String(r9.status));
        const r9b = await POST('lec-a', '/api/library/institutional/collections', { name: 'Intruso' });
        ok('I9 · …ni crear colecciones', r9b.status === 403, String(r9b.status));
        ok('I9 · nada del lector llegó al store',
            !disk().collections.some(c => c.name === 'Intruso'));

        const r11 = await POST('med-a', '/api/library/institutional/references', { bookId: 'c-inexistente' });
        ok('I11 · referencia a contenido inexistente rechazada', r11.status === 404, String(r11.status));

        const r12 = await GET('off-a', '/api/library/institutional');
        ok('I12 · cuenta deshabilitada no lee institutional', r12.status === 401 || r12.status === 403, String(r12.status));
        const r12b = await POST('off-a', '/api/library/institutional/references', { bookId: 'c-1' });
        ok('I12 · …ni escribe', r12b.status === 401 || r12b.status === 403, String(r12b.status));
    }

    // ── §8 CROSS-TENANT ─────────────────────────────────────────────────────
    section('[I8/§8] INSTITUTIONAL_WRITE_CROSS_TENANT: ZERO');
    {
        const snapshot = JSON.stringify(disk());

        const e1 = await PUT('med-a', '/api/library/institutional/collections/col-ib-1', { name: 'Secuestrada' });
        ok('I8 · mediador de A no edita una colección de B', e1.status === 404, String(e1.status));
        const e2 = await PUT('med-a', '/api/library/institutional/references/ref-ib-1', { position: 99 });
        ok('I8 · …ni reordena una referencia de B', e2.status === 404, String(e2.status));
        const e3 = await DEL('med-a', '/api/library/institutional/references/ref-ib-1');
        ok('I8 · …ni la borra', e3.status === 404, String(e3.status));

        const e4 = await PUT('med-b', '/api/library/institutional/collections/col-ia-1', { name: 'Secuestrada' });
        ok('I8 · y el mediador de B tampoco toca A', e4.status === 404, String(e4.status));
        const e5 = await DEL('med-b', `/api/library/institutional/references/${refA.id}`);
        ok('I8 · …ni borra lo que A acaba de crear', e5.status === 404, String(e5.status));

        // Ningún contextId del cliente cambia el tenant.
        const e6 = await POST('med-b', '/api/library/institutional/collections',
            { name: 'Inyectada', contextId: ORG_A, organizationId: ORG_A, layer: 'EDITORIAL' });
        ok('§7 · un contextId/layer en el cuerpo se ignora', e6.status === 201);
        const injected = (await json(e6));
        ok('§7 · la colección de B nace en B pese al cuerpo',
            injected?.contextId === ORG_B && injected?.layer === 'INSTITUTIONAL',
            JSON.stringify({ c: injected?.contextId, l: injected?.layer }));

        const afterA = await json(await GET('med-a', '/api/library/institutional'));
        ok('§7 · la inyección no aparece en la biblioteca de A',
            !JSON.stringify(afterA).includes('Inyectada'));

        ok('I8 · el store de B quedó intacto salvo lo que B creó',
            disk().references.find(r => r.id === 'ref-ib-1')?.position === 0
            && disk().collections.find(c => c.id === 'col-ib-1')?.name === 'Plan lector Beta');
        ok('I8 · los intentos fallidos no dejaron rastro',
            !snapshot.includes('Secuestrada') && !JSON.stringify(disk()).includes('Secuestrada'));
    }

    // ── §5/§15 CONTEXTO INSTITUCIONAL ───────────────────────────────────────
    section('[I10/§5/§15] INSTITUTIONAL_CONTEXT: SESSION_ORGANIZATION_ONLY');
    {
        for (const who of ['lec-noorg', 'adm-noorg']) {
            const v = await json(await GET(who, '/api/library/institutional'));
            ok(`I10 · ${who} recibe biblioteca institucional VACÍA`,
                v?.layer === 'INSTITUTIONAL' && bookIds(v).length === 0 && (v.collections ?? []).length === 0,
                JSON.stringify(v));
            ok(`I10 · …sin revelar que existan otras organizaciones`,
                !JSON.stringify(v).includes(ORG_A) && !JSON.stringify(v).includes(ORG_B));
            const w = await POST(who, '/api/library/institutional/references', { bookId: 'c-1' });
            const wb = await json(w);
            ok(`I10 · ${who} NO puede mutar institutional`, w.status === 403, String(w.status));
            ok(`§7 · el motivo es la ausencia de organización`, wb?.error === 'organization_required', JSON.stringify(wb));
        }

        // §14: el administrador CON organización opera sobre la suya, nunca global.
        const r = await POST('adm-a', '/api/library/institutional/collections', { name: 'Admin de Alfa' });
        const created = await json(r);
        ok('§7 · el administrador de A sí administra A', r.status === 201 && created?.contextId === ORG_A);
        const bView = await json(await GET('med-b', '/api/library/institutional'));
        ok('§14 · lo del administrador de A no aparece en B', !JSON.stringify(bView).includes('Admin de Alfa'));

        // Un organizationId ajeno por query/header no cambia nada.
        const forged = await json(await GET('lec-a', `/api/library/institutional?organizationId=${ORG_B}&contextId=${ORG_B}`));
        ok('§5 · organizationId por query se ignora',
            bookIds(forged).join(',') === 'c-1,c-2' && !JSON.stringify(forged).includes('Beta'),
            JSON.stringify(bookIds(forged)));
        const forgedH = await fetch(`${BASE}/api/library/institutional`, {
            headers: { 'x-user-id': 'lec-a', 'x-organization-id': ORG_B },
        });
        ok('§5 · organizationId por header se ignora',
            bookIds(await json(forgedH)).join(',') === 'c-1,c-2');
    }

    // ── PERSONAL ────────────────────────────────────────────────────────────
    section('[P1–P8/P10–P12] PERSONAL — contexto = sujeto de la sesión');
    let ownRef = null;
    {
        const a = await json(await GET('lec-a', '/api/library/personal'));
        ok('P1 · el usuario ve solo sus referencias visibles',
            bookIds(a).join(',') === 'c-1', JSON.stringify(bookIds(a)));
        ok('P1 · PERSONAL no tiene colecciones', (a.collections ?? []).length === 0);
        ok('P2 · nunca ve las referencias personales de otro',
            !JSON.stringify(a).includes('ref-pu-1') && !JSON.stringify(a).includes('lec-user'));

        // P3 — userId falsificado en query/body no cambia el contexto.
        const forgedQ = await json(await GET('lec-a', '/api/library/personal?userId=lec-user&contextId=lec-user'));
        ok('P3 · userId por query no cambia el contexto',
            JSON.stringify(forgedQ) === JSON.stringify(a));

        const p4 = await POST('lec-a', '/api/library/personal/references', { bookId: 'c-2' });
        const p4b = await json(p4);
        ownRef = p4b?.reference ?? null;
        ok('P4 · añadir contenido autorizado funciona', p4.status === 201 && !!ownRef?.id, String(p4.status));
        ok('P4 · la referencia nace con contextId = sujeto de la sesión', ownRef?.contextId === 'lec-a');
        ok('P4 · …y sin colección (PERSONAL es plano en el MVP)', ownRef?.collectionId === null);

        const p3b = await POST('lec-a', '/api/library/personal/references', { bookId: 'c-2', userId: 'lec-user', contextId: 'lec-user', layer: 'INSTITUTIONAL' });
        ok('P3 · userId/contextId/layer en el cuerpo se ignoran', p3b.status === 200, String(p3b.status));
        ok('P3 · el cuerpo no creó nada en la cuenta ajena',
            disk().references.filter(r => r.layer === 'PERSONAL' && r.contextId === 'lec-user').length === 1);

        const p5 = await POST('lec-a', '/api/library/personal/references', { bookId: 'c-nadie' });
        const p5b = await json(p5);
        ok('P5 · añadir contenido NO autorizado se rechaza', p5.status === 403, String(p5.status));
        ok('P5 · con motivo explícito y sin filtrar reglas', p5b?.error === 'content_not_available', JSON.stringify(p5b));
        ok('P5 · …y nada se escribió',
            !disk().references.some(r => r.layer === 'PERSONAL' && r.contextId === 'lec-a' && r.bookId === 'c-nadie' && r.id !== 'ref-pa-nad'));

        const p6 = await POST('lec-a', '/api/library/personal/references', { bookId: 'c-2' });
        const p6b = await json(p6);
        ok('P6 · re-añadir es idempotente (200, created:false)',
            p6.status === 200 && p6b?.created === false && p6b?.reference?.id === ownRef.id, String(p6.status));
        ok('P6 · una sola referencia en el store',
            disk().references.filter(r => r.layer === 'PERSONAL' && r.contextId === 'lec-a' && r.bookId === 'c-2').length === 1);

        const p7 = await PUT('lec-a', `/api/library/personal/references/${ownRef.id}`, { position: 7 });
        ok('P7 · reordenar la referencia propia funciona', p7.status === 200, String(p7.status));

        const p8 = await PUT('lec-a', '/api/library/personal/references/ref-pu-1', { position: 99 });
        ok('P8 · no se puede reordenar la referencia de otra cuenta', p8.status === 404, String(p8.status));
        const p8b = await DEL('lec-a', '/api/library/personal/references/ref-pu-1');
        ok('P8 · …ni borrarla', p8b.status === 404, String(p8b.status));
        ok('P8 · la referencia ajena sigue intacta',
            disk().references.find(r => r.id === 'ref-pu-1')?.position === 0);
        const p8c = await DEL('lec-a', '/api/library/personal/references/ref-ia-1');
        ok('P8 · tampoco alcanza una referencia de otra CAPA', p8c.status === 404, String(p8c.status));
        ok('P8 · la referencia institucional sigue intacta',
            disk().references.some(r => r.id === 'ref-ia-1'));

        const p10 = await json(await GET('lec-user', '/api/library/personal'));
        ok('P10 · entitlement scope=user funciona sin grupo',
            bookIds(p10).join(',') === 'c-1', JSON.stringify(bookIds(p10)));

        const p11 = await POST('adm-a', '/api/library/personal/references', { bookId: 'c-nadie' });
        ok('P11 · el administrador NO puede añadir contenido sin entitlement', p11.status === 403, String(p11.status));
        const p11b = await POST('med-a', '/api/library/personal/references', { bookId: 'c-nadie' });
        ok('P11 · el mediador tampoco', p11b.status === 403, String(p11b.status));
        const p11c = await POST('adm-a', '/api/library/personal/references', { bookId: 'c-1' });
        ok('P11 · …y sí puede añadir lo que sí tiene', p11c.status === 201, String(p11c.status));

        const p12 = await GET('off-a', '/api/library/personal');
        ok('P12 · cuenta deshabilitada no lee su biblioteca personal',
            p12.status === 401 || p12.status === 403, String(p12.status));
        const p12b = await POST('off-a', '/api/library/personal/references', { bookId: 'c-1' });
        ok('P12 · …ni escribe', p12b.status === 401 || p12b.status === 403, String(p12b.status));

        const p7b = await DEL('lec-a', `/api/library/personal/references/${ownRef.id}`);
        ok('P7 · borrar la referencia propia funciona', p7b.status === 200, String(p7b.status));
        ok('P7 · borrar la referencia NO borra el contenido canónico',
            JSON.parse(fs.readFileSync(P.content, 'utf8')).some(c => c.id === 'c-2'));
    }

    // ── §13/P9 ENTITLEMENT EXPIRADO ─────────────────────────────────────────
    section('[P9/§13] EXPIRED_ACCESS: NOT_RESURRECTED');
    {
        const add = await POST('lec-exp', '/api/library/personal/references', { bookId: 'c-4' });
        ok('§13 · con entitlement vigente el usuario añade el libro', add.status === 201, String(add.status));
        const before = await json(await GET('lec-exp', '/api/library/personal'));
        ok('§13 · y lo ve en su biblioteca', bookIds(before).includes('c-4'), JSON.stringify(bookIds(before)));
        ok('§13 · el preflight lo permite', await accessAllows('lec-exp', 'c-4'));

        // El reloj del SERVIDOR cierra la ventana (expiresAt de la regla).
        const remaining = Math.max(0, (ACCESS.find(r => r.id === 'r-exp').expiresAt - Date.now())) + 900;
        await sleep(remaining);

        const after = await json(await GET('lec-exp', '/api/library/personal'));
        ok('§13 · tras expirar, el libro sale de la vista personal',
            !bookIds(after).includes('c-4'), JSON.stringify(bookIds(after)));
        ok('§13 · el preflight lo DENIEGA', !(await accessAllows('lec-exp', 'c-4')));
        ok('§13 · pero la referencia sigue persistida (inerte, no borrada)',
            disk().references.some(r => r.layer === 'PERSONAL' && r.contextId === 'lec-exp' && r.bookId === 'c-4'));
        const readd = await POST('lec-exp', '/api/library/personal/references', { bookId: 'c-4' });
        ok('§13 · re-añadirlo ya no se permite', readd.status === 403, String(readd.status));
        const instExp = await json(await GET('lec-exp', '/api/library/institutional'));
        ok('§13 · la curaduría institucional tampoco lo revive',
            !bookIds(instExp).includes('c-4'), JSON.stringify(bookIds(instExp)));
    }

    // ── §16 COHORTE DE CARGA ────────────────────────────────────────────────
    section('[16] LOADTEST_LIBRARY_REFERENCES: ZERO');
    {
        const s1 = await json(await GET('synth-1', '/api/library/personal'));
        ok('§16 · el usuario sintético no tiene biblioteca personal', bookIds(s1).length === 0);
        const s2 = await json(await GET('synth-1', '/api/library/institutional'));
        ok('§16 · …y su vista institucional es la de su organización, sin siembra',
            !JSON.stringify(s2).includes('synth-1'));
        const marked = new Set(USERS.filter(u => u._loadtest_marker).map(u => u.id));
        ok('§16 · 0 referencias en el store para cuentas de carga',
            disk().references.filter(r => r.layer === 'PERSONAL' && marked.has(r.contextId)).length === 0);
        ok('§16 · ninguna ruta sembró referencias automáticamente',
            disk().references.every(r => r.layer !== 'PERSONAL' || !marked.has(r.contextId)));
    }

    // ── §21 PRIVACIDAD DE LA API ────────────────────────────────────────────
    section('[21] LIBRARY_API_PRIVACY: MINIMAL');
    {
        for (const [name, url] of [['institutional', '/api/library/institutional'], ['personal', '/api/library/personal']]) {
            const body = await (await GET('med-a', url)).text();
            for (const forbidden of ['appliedRules', 'titleIds', 'collectionIds', 'organizationId', 'contextId',
                'memberIds', 'mediatorIds', 'accountStatus', 'password', 'expiresAt', 'scopeId', 'allowed']) {
                ok(`§21 · ${name} no emite "${forbidden}"`, !body.includes(`"${forbidden}"`));
            }
            ok(`§21 · ${name} no nombra la organización ajena`, !body.includes(ORG_B));
        }
    }

    // ── §25 REGRESIÓN EDITORIAL ─────────────────────────────────────────────
    section('[25] EDITORIAL_LIBRARY: UNCHANGED');
    {
        const r = await fetch(`${BASE}/api/library/editorial`);
        const v = await json(r);
        ok('§25 · GET editorial sigue siendo público y responde 200', r.status === 200);
        ok('§25 · declara layer EDITORIAL', v?.layer === 'EDITORIAL');
        ok('§25 · devuelve su colección editorial', (v.collections ?? []).some(c => c.name === 'Editorial'));
        ok('§25 · NO filtra ninguna colección institucional',
            !JSON.stringify(v).includes('Plan lector') && !JSON.stringify(v).includes('Club de lectura'));
        ok('§25 · NO filtra referencias personales', !JSON.stringify(v).includes('ref-pa-1'));
        ok('§25 · su contenido es el editorial sembrado', bookIds(v).join(',') === 'c-1', JSON.stringify(bookIds(v)));
    }

    // ── §27 ACCESS ENGINE INTACTO ───────────────────────────────────────────
    section('[17/27] autoridades separadas: access_db intacto');
    {
        ok('access_db es byte-idéntico al fixture tras toda la sesión',
            fs.readFileSync(P.access, 'utf8') === JSON.stringify(ACCESS, null, 2));
        ok('content.json es byte-idéntico al fixture',
            fs.readFileSync(P.content, 'utf8') === JSON.stringify(CONTENT, null, 2));
        ok('groups_db es byte-idéntico al fixture',
            fs.readFileSync(P.groups, 'utf8') === JSON.stringify(GROUPS, null, 2));
        ok('el padrón de usuarios es byte-idéntico al fixture',
            fs.readFileSync(P.users, 'utf8') === JSON.stringify(USERS, null, 2));
        ok('library_db sigue siendo JSON válido con las dos colecciones raíz',
            Array.isArray(disk().references) && Array.isArray(disk().collections));
        ok('no queda lock huérfano', !fs.existsSync(`${LIBRARY}.lock`));
        ok('no queda temporal de escritura', !fs.existsSync(`${LIBRARY}.tmp`));
    }

    // ── M1-A: la identidad por header no basta en compat ────────────────────
    section('[M1-A] las superficies INSTITUTIONAL/PERSONAL exigen sesión firmada');
    {
        apiCompat = spawnApi(PORT_COMPAT, { SESSION_AUTH_MODE: 'compat' });
        await waitHealthy(BASE_COMPAT, apiCompat);

        const g1 = await GET('lec-a', '/api/library/personal', BASE_COMPAT);
        ok('compat · GET personal con x-user-id (sin cookie) → 401', g1.status === 401, String(g1.status));
        const g2 = await GET('lec-a', '/api/library/institutional', BASE_COMPAT);
        ok('compat · GET institutional con x-user-id → 401', g2.status === 401, String(g2.status));
        const w1 = await POST('lec-a', '/api/library/personal/references', { bookId: 'c-1' }, BASE_COMPAT);
        ok('compat · POST personal con x-user-id → 401', w1.status === 401, String(w1.status));
        const w2 = await POST('med-a', '/api/library/institutional/references', { bookId: 'c-1' }, BASE_COMPAT);
        ok('compat · POST institutional con x-user-id → 401', w2.status === 401, String(w2.status));

        // El guard es ADITIVO: no cambia el contrato compat de otras rutas.
        const other = await GET('lec-a', '/api/content/my-catalog', BASE_COMPAT);
        ok('compat · my-catalog conserva su contrato (x-user-id sigue valiendo)', other.status === 200, String(other.status));
        const ed = await fetch(`${BASE_COMPAT}/api/library/editorial`);
        ok('compat · la capa editorial conserva su contrato público', ed.status === 200, String(ed.status));

        ok('compat · ningún 401 escribió en el store',
            !JSON.stringify(disk()).includes('"compat"'));
    }
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message, e.stack); fail++; })
    .finally(async () => {
        for (const c of [api, apiCompat]) { try { c?.kill('SIGKILL'); } catch { /* ya muerto */ } }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows retiene a veces */ }
        console.log(`\nlibraryInstitutionalPersonal: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    });
