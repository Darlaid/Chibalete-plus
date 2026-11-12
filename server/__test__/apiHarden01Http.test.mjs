/**
 * apiHarden01Http.test.mjs — CHP-V8.1 API-HARDEN-01.
 *
 * Coherencia entre réplicas de las decisiones que dependen de `access_db.json` y `groups_db.json`
 * (reproducido en G4-E2E-01: una revocación atendida por una réplica tardaba hasta 30 s en la otra).
 * server.js REAL, DOS réplicas sobre el mismo almacén, datos sintéticos. Cada cambio se escribe por
 * UNA réplica (o por un operador externo) y se comprueba en la PETICIÓN SIGUIENTE de ambas, después
 * de haber calentado sus cachés.
 *  [1] estado inicial (calienta ambas réplicas)
 *  [2] revocación de acceso: regla vencida por otro escritor (reembolso/operador)
 *  [3] concesión de acceso por otro escritor
 *  [4] retirada del mediador del grupo por la API de una réplica
 *  [5] retirada de un lector del grupo por la API de la otra réplica
 *  [6] lo que NO cambia: el catálogo conserva su caché; consultas individuales (CIS + A2/C005)
 *  [7] día del acto de la aceptación del checkout con tolerancia de reloj (registro real)
 *  [8] caché validada por huella: escrituras rápidas, mismo tamaño, edición en el sitio, mtime restaurado
 * La revocación B2C firmada entre réplicas se prueba en b2cProvisioning.integration (contenedor).
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/apiHarden01Http.test.mjs
 */
import './helpers/testMode.mjs';
import { freePort } from './helpers/freePort.mjs';
import { a2RegistryPath, grantA2, grantC005 } from './helpers/testA2.mjs';
import { appendDecisions, dayOf, decisionGate } from '../privacy/a2Registry.mjs';
import { termsActDayMs } from '../b2c/b2cProvisioning.mjs';
import { ACCEPTANCE_DOCUMENTS } from '../../utils/acceptanceDocuments.mjs';
import { spawn, execFileSync } from 'node:child_process';
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_harden01_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), uploads: path.join(tmp, 'uploads') };
fs.mkdirSync(P.data, { recursive: true }); fs.mkdirSync(P.uploads, { recursive: true });
const REG = a2RegistryPath();
const lector = (id, groupIds = []) => ({ id, nombre_completo: `Sint ${id}`, roles: ['lector'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active', groupIds });
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'adm', roles: ['administrador'], accountStatus: 'active' },
    { id: 'med-a', roles: ['mediador'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher' },
    lector('r1', ['g-a1']), lector('r2', ['g-a1']), lector('r3'),
], null, 2));
const GROUP = { id: 'g-a1', name: 'Primero A', type: 'course', organizationId: ORG, school: 'Colegio Alfa', mediatorIds: ['med-a'], memberIds: ['r1', 'r2'], studentIds: ['r1', 'r2'] };
fs.writeFileSync(P.groups, JSON.stringify([GROUP], null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG, name: 'Colegio Alfa' }]));
const RULE_G = { id: 'rule-g', scope: 'group', scopeId: 'g-a1', titleIds: ['obra-g'], collectionIds: [], expiresAt: null };
const RULE_U = { id: 'rule-u3', scope: 'user', scopeId: 'r3', titleIds: ['obra-u'], collectionIds: [], expiresAt: Date.now() + 365 * 86400000 };
fs.writeFileSync(P.access, JSON.stringify([RULE_G, RULE_U], null, 2));
const CONTENT = ['obra-g', 'obra-u', 'obra-x'].map((id) => ({ id, titulo: id, tipo: 'libro' }));
fs.writeFileSync(P.content, JSON.stringify(CONTENT, null, 2));
grantA2(['r1', 'r2']); grantC005(['med-a']);

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
    for (let i = 0; i < 300; i++) {
        if (c.exitCode !== null) throw new Error(`server rc=${c.exitCode}\n${c.logs().slice(-1500)}`);
        try { if ((await fetch(`${c.base}/api/health`)).ok) return; } catch { /* arrancando */ }
        await sleep(300);
    }
    throw new Error('nunca healthy');
}
/** Decisión de acceso del servidor (autoridad): true / false, o `HTTP<n>` si la respuesta no es una decisión. */
const allowed = async (c, user, obra) => {
    const r = await fetch(`${c.base}/api/content/${obra}/access?userId=${user}`, { headers: { 'x-user-id': user } });
    const b = await r.json().catch(() => null);
    return typeof b?.allowed === 'boolean' ? b.allowed : `HTTP${r.status}`;
};
const admin = (c, method, ruta, body) => fetch(`${c.base}${ruta}`, { method, headers: { 'x-user-id': 'adm', 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
const groupSeen = async (c) => { const r = await admin(c, 'GET', '/api/groups'); const g = (await r.json().catch(() => [])).find?.((x) => x.id === 'g-a1'); return g ? { mediators: g.mediatorIds.join(), members: g.memberIds.slice().sort().join() } : null; };
const status = async (c, subject, as) => (await fetch(`${c.base}/api/students/${subject}/status`, { headers: { 'x-user-id': as } })).status;
const both = async (fn) => [await fn(api1), await fn(api2)];
const J = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
/** Otro escritor (réplica distinta u operador): escritura atómica por rename, como `writeJSON`. */
const writeExternal = (file, data) => { const t = `${file}.ext-${process.pid}`; fs.writeFileSync(t, JSON.stringify(data, null, 2)); fs.renameSync(t, file); };

let api1, api2;
const servers = [];
try {
    const [p1, p2] = [await freePort(), await freePort()];
    api1 = spawnApi(p1, 1); api2 = spawnApi(p2, 2);
    servers.push(api1, api2);
    await healthy(api1); await healthy(api2);

    section('[1] estado inicial (ambas réplicas leen y cachean lo cacheable)');
    ok('lector del grupo abre la obra del grupo', (await both((c) => allowed(c, 'r1', 'obra-g'))).every((a) => a === true));
    ok('ambas réplicas sirven el grupo con su mediador', (await both(groupSeen)).every((g) => g && g.mediators === 'med-a' && g.members === 'r1,r2'));
    ok('el mediador consulta a sus lectores (CIS + A2 + C005)', (await both((c) => status(c, 'r1', 'med-a'))).every((s) => s === 200));
    ok('lector con regla personal abre su obra', (await both((c) => allowed(c, 'r3', 'obra-u'))).every((a) => a === true));
    ok('nadie abre lo que no le corresponde', (await both((c) => allowed(c, 'r3', 'obra-g'))).every((a) => a === false) && (await both((c) => allowed(c, 'r1', 'obra-x'))).every((a) => a === false));

    section('[2] revocación de acceso (regla vencida por otro escritor)');
    writeExternal(P.access, J(P.access).map((r) => (r.id === 'rule-u3' ? { ...r, expiresAt: Date.now() - 60000 } : r)));
    const rev = await both((c) => allowed(c, 'r3', 'obra-u'));
    ok('petición siguiente: denegado en AMBAS réplicas', rev.every((a) => a === false), rev.join());
    ok('las demás reglas no cambian', (await both((c) => allowed(c, 'r1', 'obra-g'))).every((a) => a === true));

    section('[3] concesión de acceso (regla nueva escrita por otro escritor)');
    writeExternal(P.access, [...J(P.access), { id: 'rule-x', scope: 'user', scopeId: 'r3', titleIds: ['obra-x'], collectionIds: [], expiresAt: null }]);
    const gr = await both((c) => allowed(c, 'r3', 'obra-x'));
    ok('petición siguiente: permitido en AMBAS réplicas', gr.every((a) => a === true), gr.join());

    section('[4] retirada del mediador del grupo por la API de la réplica 1');
    const put = await admin(api1, 'PUT', '/api/groups/g-a1', { mediatorIds: [] });
    ok('grupo actualizado', put.status === 200, String(put.status));
    const seen = await both(groupSeen);
    ok('petición siguiente: AMBAS réplicas sirven el grupo sin ese mediador', seen.every((g) => g && g.mediators === ''), JSON.stringify(seen));
    const st = await both((c) => status(c, 'r1', 'med-a'));
    ok('…y el mediador retirado pierde la consulta individual de sus lectores, en AMBAS réplicas', st.every((s) => s === 403), st.join());
    ok('los lectores del grupo conservan su acceso', (await both((c) => allowed(c, 'r1', 'obra-g'))).every((a) => a === true));

    section('[5] retirada de un lector del grupo por la API de la réplica 2');
    const del = await admin(api2, 'DELETE', '/api/groups/g-a1/members/r1');
    ok('lector retirado', del.status === 200, String(del.status));
    const out = await both((c) => allowed(c, 'r1', 'obra-g'));
    ok('petición siguiente: el lector retirado ya no abre la obra del grupo, en AMBAS réplicas', out.every((a) => a === false), out.join());
    ok('el otro lector del grupo sigue abriéndola (sin revocar de más)', (await both((c) => allowed(c, 'r2', 'obra-g'))).every((a) => a === true));
    const seen2 = await both(groupSeen);
    ok('ambas réplicas sirven la misma pertenencia', seen2.every((g) => g && g.members === 'r2'), JSON.stringify(seen2));

    section('[6] lo que no cambia');
    const src = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
    ok('sin caché: solo usuarios; validados por huella: exactamente grupos y reglas de acceso', /const UNCACHED_JSON_FILES = new Set\(\[USERS_DB\]\);/.test(src) && /const STAT_VALIDATED_JSON_FILES = new Set\(\[GROUPS_DB, ACCESS_DB\]\);/.test(src));
    ok('la huella incluye dispositivo, inodo, tamaño, mtime y ctime en nanosegundos', src.includes('`${st.dev}:${st.ino}:${st.size}:${st.mtimeNs}:${st.ctimeNs}`'));
    ok('el catálogo y el resto de archivos conservan su TTL de 30 s', /const _JSON_TTL_DEFAULT = 30_000;/.test(src));
    // El catálogo ya cacheado no se relee en cada petición: una obra retirada por otro escritor sigue resolviéndose igual.
    writeExternal(P.content, CONTENT.filter((c) => c.id !== 'obra-x'));
    ok('catálogo: sigue servido desde la caché de cada réplica (comportamiento previo intacto)', (await both((c) => allowed(c, 'r3', 'obra-x'))).every((a) => a === true));
    ok('autorizaciones: A2 del lector y C005 del mediador siguen efectivas en el registro', (() => { const g = decisionGate(); return g.effective('A2', 'r2') && g.effective('C005', 'med-a'); })());
    ok('el propio lector y la administración conservan la consulta individual', (await status(api1, 'r2', 'r2')) === 200 && (await status(api2, 'r2', 'adm')) === 200);

    section('[7] día del acto de la aceptación del checkout (tolerancia de reloj, registro real)');
    // La app está a las 23:59:30 de Bogotá y la tienda va 60 s adelantada: la aceptación «cae» en el día siguiente.
    const appNow = Date.UTC(2026, 10, 13, 5, 0, 0) - 30000, storeAt = appNow + 60000;
    const T = (subjectId, actDay) => ({ subjectId, kind: 'T', status: 'granted', actDay, version: ACCEPTANCE_DOCUMENTS.terms.version, medium: 'checkout', capacity: 'titular', verification: 'verified', requestRef: `WOO:test:order:${subjectId}` });
    const regBefore = fs.readFileSync(REG, 'utf8');
    let code = 'ok'; try { appendDecisions([T('h-1', dayOf(storeAt))], { now: appNow }); } catch (e) { code = e.code; }
    ok('sin acotar: el registro rechaza el día futuro (el fallo que llegaba tras crear la cuenta)', code === 'INVALID_ACT_DATE' && fs.readFileSync(REG, 'utf8') === regBefore, code);
    code = 'ok'; try { appendDecisions([T('h-1', dayOf(termsActDayMs(storeAt, appNow)))], { now: appNow }); } catch (e) { code = e.code; }
    ok('acotado al reloj de la app: el registro la admite', code === 'ok', code);
    ok('…con el día de la app, y la T queda efectiva', decisionGate().state('T', 'h-1')?.actDay === '2026-11-12' && decisionGate().effective('T', 'h-1'));

    section('[8] caché validada por huella: ninguna ventana de acceso obsoleto');
    // Regla personal de r3 sobre una obra u otra: 'obra-u' y 'obra-x' miden lo mismo ⇒ el archivo NO cambia de tamaño.
    const flip = (title) => J(P.access).map((r) => (r.id === 'rule-x' ? { ...r, titleIds: [title] } : r));
    const sees = async (title) => (await both((c) => allowed(c, 'r3', title))).join();
    const inPlace = (data) => fs.writeFileSync(P.access, JSON.stringify(data, null, 2)); // edición en el sitio: mismo inodo
    const QUIET = 2300; // por encima de la ventana «racy» (2 s): a partir de aquí las réplicas sí sirven desde caché

    writeExternal(P.access, flip('obra-x'));
    await sleep(QUIET);
    ok('archivo en reposo: ambas réplicas lo tienen en caché y deciden bien', (await sees('obra-x')) === 'true,true' && (await sees('obra-u')) === 'false,false' && (await sees('obra-x')) === 'true,true');
    const size0 = fs.statSync(P.access).size;

    // (a) cambio del MISMO tamaño por rename, leído de inmediato.
    writeExternal(P.access, flip('obra-u'));
    const a1 = [await sees('obra-u'), await sees('obra-x')];
    ok('mismo tamaño, reemplazo atómico ⇒ visto en la petición siguiente por ambas', fs.statSync(P.access).size === size0 && a1.join('|') === 'true,true|false,false', a1.join('|'));

    // (b) ráfaga de escrituras rápidas, alternando, con lectura de ambas réplicas tras cada una.
    let burst = 0; const wrong = [];
    for (let i = 0; i < 40; i++) {
        const t = i % 2 ? 'obra-u' : 'obra-x', other = i % 2 ? 'obra-x' : 'obra-u';
        if (i % 4 < 2) writeExternal(P.access, flip(t)); else inPlace(flip(t));
        const got = `${await sees(t)}|${await sees(other)}`;
        if (got === 'true,true|false,false') burst++; else wrong.push(`${i}:${got}`);
    }
    ok('40 escrituras seguidas (rename y en el sitio, mismo tamaño): cada una vista de inmediato por ambas réplicas', burst === 40, wrong.join(' '));

    // (c) en reposo (caché activa) y después UNA edición en el sitio del mismo tamaño: mismo inodo, mismo tamaño.
    await sleep(QUIET);
    await sees('obra-u'); await sees('obra-u'); // ambas réplicas con la entrada en caché
    const ino0 = fs.statSync(P.access).ino;
    inPlace(flip('obra-x'));
    const c1 = [await sees('obra-x'), await sees('obra-u')];
    ok('edición en el sitio (mismo inodo y tamaño) tras estar en caché ⇒ vista de inmediato', fs.statSync(P.access).ino === ino0 && fs.statSync(P.access).size === size0 && c1.join('|') === 'true,true|false,false', c1.join('|'));

    // (d) en reposo y después edición del mismo tamaño RESTAURANDO el mtime anterior (cp -p / rsync -t / utimes).
    await sleep(QUIET);
    await sees('obra-x'); await sees('obra-x');
    const before = fs.statSync(P.access, { bigint: true });
    if (process.platform !== 'win32') execFileSync('cp', ['-p', P.access, `${P.access}.ref`]); // referencia con el mtime exacto (ns)
    inPlace(flip('obra-u'));
    // POSIX: `touch -r` repone el mtime con precisión de nanosegundos; el ctime lo fija el núcleo y no se puede imponer.
    if (process.platform !== 'win32') execFileSync('touch', ['-r', `${P.access}.ref`, P.access]); else fs.utimesSync(P.access, new Date(Number(before.atimeMs)), new Date(Number(before.mtimeMs)));
    const after = fs.statSync(P.access, { bigint: true });
    const d1 = [await sees('obra-u'), await sees('obra-x')];
    ok('edición del mismo tamaño con el mtime anterior repuesto ⇒ vista de inmediato', after.ino === before.ino && after.size === before.size && d1.join('|') === 'true,true|false,false', d1.join('|'));
    if (process.platform !== 'win32') ok('…y lo delata el ctime, que el núcleo fija en cada cambio (el mtime sí quedó repuesto, al segundo)', after.ctimeNs !== before.ctimeNs && after.mtimeNs / 1000000000n === before.mtimeNs / 1000000000n, `${after.mtimeNs} ${before.mtimeNs}`);

    // (e) lo mismo para grupos: pertenencia cambiada en el sitio, mismo tamaño ('r1' ↔ 'r3'), tras estar en caché.
    await sleep(QUIET);
    const member = async (u) => (await both((c) => allowed(c, u, 'obra-g'))).join();
    ok('grupos en reposo: r2 abre la obra del grupo, r1 no', (await member('r2')) === 'true,true' && (await member('r1')) === 'false,false');
    const gsize = fs.statSync(P.groups).size;
    fs.writeFileSync(P.groups, JSON.stringify(J(P.groups).map((g) => ({ ...g, memberIds: ['r1'], studentIds: ['r1'] })), null, 2));
    const e1 = await member('r1');
    ok('grupo editado en el sitio con el mismo tamaño ⇒ pertenencia nueva en la petición siguiente', fs.statSync(P.groups).size === gsize && e1 === 'true,true', e1);
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    for (const s of servers) { try { s.kill('SIGKILL'); } catch { /* noop */ } }
    await sleep(400);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(`\nAPI-HARDEN-01 multirréplica HTTP: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
