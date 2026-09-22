/**
 * libraryStoreConcurrency.test.mjs
 * CHP-V6-LIBRARY-INSTITUTIONAL-01 / Etapa 11B-2 §19, §20.
 *
 * `library_db.json` es un store GLOBAL y compartido: un único fichero para las
 * tres capas y para todos los usuarios. Abrir la capa PERSONAL a los lectores
 * significa que dos réplicas de la API pueden hacer read-modify-write sobre él
 * al mismo tiempo. Antes de abrirla hay que demostrar que el lock es
 * CROSS-PROCESS y que no hay lost updates — el mismo defecto que sufrió
 * `content.json` (CHP-CONTENT-STORE-RMW-01), donde el lock era correcto pero la
 * relectura dentro del lock servía la caché en proceso.
 *
 * Método: DOS procesos `server/server.js` reales contra el MISMO
 * `CHP_DATA_DIR` temporal, escribiendo en paralelo:
 *   A  → referencias PERSONAL de lec-a   (réplica 1)
 *   B  → referencias PERSONAL de lec-b   (réplica 2)
 *   C  → referencias INSTITUTIONAL de A  (alternando réplica)
 *
 * Aislamiento (§20): `fs.mkdtemp`. Stores reales — 0 lecturas, 0 escrituras.
 *
 *   node server/__test__/libraryStoreConcurrency.test.mjs
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

const ORG_A = 'org-alfa';
const N = 30;
const BOOKS = Array.from({ length: N }, (_, i) => `c-${String(i).padStart(2, '0')}`);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_libconc_'));
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

fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG_A, name: 'Colegio Alfa' }], null, 2));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'g-a1', type: 'course', organizationId: ORG_A, mediatorIds: ['med-a'], memberIds: ['lec-a', 'lec-b'] },
], null, 2));
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'lec-a', roles: ['lector'],   organizationId: ORG_A, accountStatus: 'active' },
    { id: 'lec-b', roles: ['lector'],   organizationId: ORG_A, accountStatus: 'active' },
    { id: 'med-a', roles: ['mediador'], organizationId: ORG_A, accountStatus: 'active', mediatorKind: 'teacher' },
], null, 2));
fs.writeFileSync(P.access, JSON.stringify([
    { id: 'r-g-a1', scope: 'group', scopeId: 'g-a1', titleIds: BOOKS, collectionIds: [] },
], null, 2));
fs.writeFileSync(P.content, JSON.stringify(
    BOOKS.map((id, i) => ({ id, titulo: `Libro ${i}`, autor: 'X', tipo: 'libro', status: 'disponible' })), null, 2));
fs.writeFileSync(LIBRARY, JSON.stringify({ collections: [], references: [] }, null, 2));

function spawnApi(port) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env,
            NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: P.data,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
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

const PORT1 = 4830 + (process.pid % 60), PORT2 = PORT1 + 1;
const b1 = `http://127.0.0.1:${PORT1}`, b2 = `http://127.0.0.1:${PORT2}`;
let api1, api2;

const post = (base, userId, url, body) => fetch(`${base}${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-user-id': userId },
    body: JSON.stringify(body),
});
const addPersonal = (base, userId, bookId) =>
    post(base, userId, '/api/library/personal/references', { bookId });
const addInstitutional = (base, bookId) =>
    post(base, 'med-a', '/api/library/institutional/references', { bookId });
const getView = (base, userId, url) =>
    fetch(`${base}${url}`, { headers: { 'x-user-id': userId } }).then(r => r.json());

const disk = () => JSON.parse(fs.readFileSync(LIBRARY, 'utf8'));
const refsOf = (layer, contextId) =>
    disk().references.filter(r => r.layer === layer && (r.contextId ?? null) === contextId);
const logicalKey = (r) => `${r.layer}|${r.contextId ?? ''}|${r.collectionId ?? ''}|${r.bookId}`;

/** [0] Ratchet estructural: el RMW de library_db debe seguir siendo correcto. */
function ratchet() {
    section('[0] ratchet estructural del RMW de library_db');
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');

    const i = src.indexOf('async function mutateLibrary(');
    const block = src.slice(i, i + 500);
    ok('mutateLibrary existe', i !== -1);
    ok('toma el lock CROSS-PROCESS de fichero', block.includes('withFileLock(LIBRARY_DB'));
    const inval = block.indexOf('_jsonCache.delete(LIBRARY_DB)');
    const read = block.indexOf('readJSON(LIBRARY_DB)');
    ok('invalida la caché ANTES de releer dentro del lock',
        inval !== -1 && read !== -1 && inval < read);
    ok('escribe dentro del lock', block.includes('writeJSON(LIBRARY_DB, doc)'));

    const writes = (src.match(/writeJSON\(LIBRARY_DB/g) || []).length;
    ok('toda escritura de library_db vive en mutateLibrary', writes === 1, `${writes} escrituras`);

    // Ninguna ruta nueva puede escribir el store fuera del helper con lock.
    const outside = src.split('\n').filter(l => l.includes('writeJSON(LIBRARY_DB') && !l.includes('doc)'));
    ok('ninguna escritura suelta de library_db', outside.length === 0);

    // El lock es de fichero (O_EXCL), no un mutex en memoria.
    const lockSrc = fs.readFileSync(path.join(REPO, 'server', 'usersLock.js'), 'utf8');
    ok('el lock usa O_EXCL sobre el filesystem (cross-process)',
        lockSrc.includes('O_EXCL') && lockSrc.includes('O_CREAT'));
    ok('…con recuperación de locks obsoletos', lockSrc.includes('LOCK_STALE_MS'));
}

async function main() {
    ratchet();

    api1 = spawnApi(PORT1);
    api2 = spawnApi(PORT2);
    await waitHealthy(b1, api1);
    await waitHealthy(b2, api2);

    // Ambas réplicas calientan su caché en proceso del store: es la condición
    // exacta que producía lost updates en content.json.
    await getView(b1, 'lec-a', '/api/library/personal');
    await getView(b2, 'lec-b', '/api/library/personal');

    // ── [1] 90 escrituras concurrentes desde dos procesos ───────────────────
    section('[1] 90 escrituras concurrentes: A y B personales + C institucional');
    {
        const statuses = [];
        for (let i = 0; i < N; i += 5) {
            const batch = [];
            for (let k = i; k < Math.min(i + 5, N); k++) {
                batch.push(addPersonal(b1, 'lec-a', BOOKS[k]));
                batch.push(addPersonal(b2, 'lec-b', BOOKS[k]));
                batch.push(addInstitutional(k % 2 === 0 ? b1 : b2, BOOKS[k]));
            }
            const rs = await Promise.all(batch);
            statuses.push(...rs.map(r => r.status));
        }
        ok('las 90 escrituras respondieron 2xx',
            statuses.every(s => s === 200 || s === 201),
            `códigos distintos: ${[...new Set(statuses.filter(s => s > 299))].join(',')}`);

        const pa = refsOf('PERSONAL', 'lec-a');
        const pb = refsOf('PERSONAL', 'lec-b');
        const inst = refsOf('INSTITUTIONAL', ORG_A);
        ok(`§19 · 0 lost updates en PERSONAL de A (${pa.length}/${N})`, pa.length === N);
        ok(`§19 · 0 lost updates en PERSONAL de B (${pb.length}/${N})`, pb.length === N);
        ok(`§19 · 0 lost updates en INSTITUTIONAL (${inst.length}/${N})`, inst.length === N);
        ok('§19 · ninguna escritura de A pisó a B ni al revés',
            new Set(pa.map(r => r.bookId)).size === N && new Set(pb.map(r => r.bookId)).size === N);
    }

    // ── [2] Integridad del store ────────────────────────────────────────────
    section('[2] integridad del documento compartido');
    {
        let doc = null, parsed = true;
        try { doc = disk(); } catch { parsed = false; }
        ok('§19 · library_db.json sigue siendo JSON válido', parsed && !!doc);
        ok('§19 · conserva su forma contractual',
            Array.isArray(doc.references) && Array.isArray(doc.collections));
        const keys = doc.references.map(logicalKey);
        ok('§19 · 0 referencias lógicas duplicadas (layer, contextId, collectionId, bookId)',
            new Set(keys).size === keys.length,
            `${keys.length - new Set(keys).size} duplicadas`);
        ok('§19 · 0 ids de referencia duplicados',
            new Set(doc.references.map(r => r.id)).size === doc.references.length);
        ok('§19 · toda referencia declara capa y contexto coherentes',
            doc.references.every(r => ['EDITORIAL', 'INSTITUTIONAL', 'PERSONAL'].includes(r.layer))
            && doc.references.every(r => r.layer !== 'PERSONAL' || typeof r.contextId === 'string')
            && doc.references.every(r => r.layer !== 'INSTITUTIONAL' || r.contextId === ORG_A));
        ok('§19 · ninguna referencia personal quedó atribuida a otro sujeto',
            doc.references.filter(r => r.layer === 'PERSONAL')
                .every(r => r.contextId === 'lec-a' || r.contextId === 'lec-b'));
        ok('§19 · el total es exactamente lo escrito', doc.references.length === N * 3);
    }

    // ── [3] Ownership visto por las dos réplicas ────────────────────────────
    section('[3] ownership consistente en ambas réplicas');
    {
        const ids = (v) => [...(v.unassigned ?? []).map(r => r.bookId)].sort();
        const a1 = ids(await getView(b1, 'lec-a', '/api/library/personal'));
        const a2 = ids(await getView(b2, 'lec-a', '/api/library/personal'));
        const bb1 = ids(await getView(b1, 'lec-b', '/api/library/personal'));
        ok('A ve sus 30 libros desde la réplica 1', a1.length === N, String(a1.length));
        ok('A ve EXACTAMENTE lo mismo desde la réplica 2', JSON.stringify(a1) === JSON.stringify(a2));
        ok('B ve los suyos, no los de A', bb1.length === N && JSON.stringify(bb1) === JSON.stringify(a1.slice().sort()));
        const va = await getView(b1, 'lec-a', '/api/library/personal');
        ok('la vista personal de A no contiene referencias de B',
            !JSON.stringify(va).includes('lec-b'));
    }

    // ── [4] Idempotencia bajo concurrencia ──────────────────────────────────
    section('[4] idempotencia contractual bajo contención');
    {
        const before = disk().references.length;
        const batch = [];
        for (const bk of BOOKS) {
            batch.push(addPersonal(b1, 'lec-a', bk));
            batch.push(addPersonal(b2, 'lec-a', bk));   // mismo sujeto, dos réplicas
            batch.push(addInstitutional(b1, bk));
            batch.push(addInstitutional(b2, bk));
        }
        const rs = await Promise.all(batch);
        ok('re-añadir en paralelo responde 200 (no-op)', rs.every(r => r.status === 200),
            `códigos: ${[...new Set(rs.map(r => r.status))].join(',')}`);
        ok('§19 · el conteo NO cambió: operaciones idempotentes',
            disk().references.length === before, `${before} → ${disk().references.length}`);
        const keys = disk().references.map(logicalKey);
        ok('§19 · sigue sin duplicados lógicos', new Set(keys).size === keys.length);
    }

    // ── [5] Borrados concurrentes ───────────────────────────────────────────
    section('[5] borrados concurrentes desde dos réplicas');
    {
        const mine = refsOf('PERSONAL', 'lec-a').slice(0, 10).map(r => r.id);
        const del = (base, id) => fetch(`${base}/api/library/personal/references/${id}`, {
            method: 'DELETE', headers: { 'x-user-id': 'lec-a' },
        });
        const rs = await Promise.all(mine.flatMap(id => [del(b1, id), del(b2, id)]));
        const okCount = rs.filter(r => r.status === 200).length;
        ok('cada referencia se borró una vez (el segundo intento es 404)',
            okCount === 10 && rs.filter(r => r.status === 404).length === 10,
            `200:${okCount} 404:${rs.filter(r => r.status === 404).length}`);
        ok('§19 · el borrado no arrastró referencias ajenas',
            refsOf('PERSONAL', 'lec-b').length === N && refsOf('INSTITUTIONAL', ORG_A).length === N);
        ok('§19 · quedan exactamente 20 referencias de A', refsOf('PERSONAL', 'lec-a').length === 20);
        ok('§19 · el documento sigue siendo JSON válido', Array.isArray(disk().references));
    }

    // ── [6] Sin residuos ────────────────────────────────────────────────────
    section('[6] sin residuos de lock ni de escritura');
    {
        ok('no queda lock huérfano', !fs.existsSync(`${LIBRARY}.lock`));
        ok('no queda temporal de escritura', !fs.existsSync(`${LIBRARY}.tmp`));
        ok('content.json no fue tocado',
            JSON.parse(fs.readFileSync(P.content, 'utf8')).length === N);
        ok('access_db no fue tocado',
            JSON.parse(fs.readFileSync(P.access, 'utf8')).length === 1);
        ok('el padrón de usuarios no fue tocado',
            JSON.parse(fs.readFileSync(P.users, 'utf8')).length === 3);
    }
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message, e.stack); fail++; })
    .finally(async () => {
        for (const c of [api1, api2]) { try { c?.kill('SIGKILL'); } catch { /* ya muerto */ } }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows retiene a veces */ }
        console.log(`\nlibraryStoreConcurrency: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    });
