/**
 * groupRecognitionHttp.test.mjs — CHP-GAMIFICACION-G4-UX-U4.
 *
 * `recognition` en GET /api/groups/:id/analytics-summary sobre server.js REAL,
 * con stores temporales y usuarios sintéticos. El ledger se siembra en ESTE
 * proceso con el escritor real, que queda abierto (réplica viva); los
 * servidores solo leen.
 *   [1] flags: sin gamificación o sin XP no hay campo `recognition` y el resto
 *       del resumen no cambia
 *   [2] tamaños 0, 1, 4 ⇒ ledger suprimido; 5 y 7 ⇒ conteo
 *   [3] conteos: reconocidos, pendientes de reconocimiento (no cuentan),
 *       entregas por revisar (SUBMITTED/RESUBMITTED), obras elegibles
 *   [4] exclusión: la persona excluida no cuenta y nada lo delata
 *   [5] permisos: mediador propio 200; mediador ajeno, otra institución,
 *       lector y sin sesión ⇒ sin datos
 *   [6] código real sin arnés (V8-ACTIVATE-PREP-01): igual que con el arnés
 *   [7] errores de lectura ⇒ ledger `unavailable`, nunca 0; sin escrituras
 *   [8] privacidad: solo conteos (sin ids, nombres, XP ni niveles)
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/groupRecognitionHttp.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/xpRecognitionHarness.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const HARNESS = pathToFileURL(path.join(HERE, 'helpers', 'xpRecognitionHarness.mjs')).href;

function realFingerprint() {
    const out = {};
    const walk = (d) => {
        let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of es) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.isFile()) out[path.relative(REPO, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        }
    };
    walk(path.join(REPO, 'data')); walk(path.join(REPO, 'data-critical'));
    return out;
}
const realBefore = realFingerprint();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_group_http_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');
const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const E = await import('../erasure.mjs');
(await import('../../royalties/publishersStore.mjs')).getRoyaltiesDb();

const SINCE = Date.now() - 60_000;
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 }, pm: { reviewed: 0, validated: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [], pmFactors: [] } };

// ── Usuarios, grupos y dos instituciones ─────────────────────────────────────
const ORG_A = 'org-a', ORG_B = 'org-b';
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'data', 'groups.json'),
    schools: path.join(tmp, 'data', 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'data', 'content.json'),
    mook: path.join(tmp, 'data', 'mook_db.json'), gamDir: path.join(tmp, 'gam'), reg: path.join(tmp, 'reg', 'exclusions.jsonl') };
P.gamDb = path.join(P.gamDir, 'gamification.db');
for (const d of [P.data, P.gamDir, path.dirname(P.reg), path.join(tmp, 'uploads'), path.join(tmp, 'sqlite')]) fs.mkdirSync(d, { recursive: true });
const lec = (id, org, g) => ({ id, nombre_completo: `Nombre ${id}`, roles: ['lector'], organizationId: org, colegio: org === ORG_A ? 'Colegio Alfa' : 'Colegio Beta', accountStatus: 'active', groupIds: [g] });
const ids = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
const SIZES = { 'g-0': 0, 'g-1': 1, 'g-4': 4, 'g-5': 5, 'g-7': 7 };
const GROUP_STUDENTS = Object.fromEntries(Object.entries(SIZES).map(([g, n]) => [g, ids(`${g.slice(2)}s`, n)]));
GROUP_STUDENTS['g-b'] = ids('bs', 6);
const USERS = [
    ...Object.entries(GROUP_STUDENTS).flatMap(([g, list]) => list.map((id) => lec(id, g === 'g-b' ? ORG_B : ORG_A, g))),
    { id: 'med-a', nombre_completo: 'Mediadora A', roles: ['mediador'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher', groupIds: Object.keys(SIZES) },
    { id: 'med-a2', nombre_completo: 'Mediador sin grupo', roles: ['mediador'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher', groupIds: [] },
    { id: 'med-b', nombre_completo: 'Mediador B', roles: ['mediador'], organizationId: ORG_B, colegio: 'Colegio Beta', accountStatus: 'active', mediatorKind: 'teacher', groupIds: ['g-b'] },
    { id: 'adm', roles: ['administrador'], accountStatus: 'active' },
];
const GROUPS = [
    ...Object.keys(SIZES).map((g) => ({ id: g, type: 'course', organizationId: ORG_A, school: 'Colegio Alfa', mediatorIds: ['med-a'], studentIds: GROUP_STUDENTS[g], memberIds: GROUP_STUDENTS[g] })),
    { id: 'g-b', type: 'course', organizationId: ORG_B, school: 'Colegio Beta', mediatorIds: ['med-b'], studentIds: GROUP_STUDENTS['g-b'], memberIds: GROUP_STUDENTS['g-b'] },
];
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG_A, name: 'Colegio Alfa' }, { id: ORG_B, name: 'Colegio Beta' }]));
const work = (id) => ({ id, titulo: `Título ${id}`, autor: 'A', tipo: 'libro', status: 'disponible', editorial: 'Chibalete', etiquetas: ['x'], descripcion_corta: 'd' });
fs.writeFileSync(P.content, JSON.stringify([work('obra-a'), work('obra-b')]));
// Acceso explícito a obra-a para la institución A; obra-b sin reglas (no elegible); org B sin reglas.
const orgA = USERS.filter((u) => u.organizationId === ORG_A && u.roles.includes('lector')).map((u) => u.id);
fs.writeFileSync(P.access, JSON.stringify(orgA.map((u) => ({ id: `r-${u}`, scope: 'user', scopeId: u, titleIds: ['obra-a'], collectionIds: [], expiresAt: null }))));
for (const f of ['progress_db.json', 'leo_evidence_db.json']) fs.writeFileSync(path.join(P.data, f), f === 'progress_db.json' ? '{"progressMap":{}}' : '[]');
fs.writeFileSync(P.reg, '');

// ── MOOK: E1 obra-a (1 producción), E2 obra-b ────────────────────────────────
const doc = Store.emptyMookStore();
const mkExp = (slug, w) => {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [{ id: 'r', type: 'READING', title: 'r', resourceRef: w },
        { id: 'p', type: 'PRODUCTION', title: 'p', resourceRef: w, config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } }] }] }, () => true);
    Store.publishVersion(doc, v.id);
    return exp;
};
const E1 = mkExp('e1', 'obra-a');
mkExp('e2', 'obra-b');
const grant = { workRef: 'obra-a', decision: 'allowed', via: 'SCOPE_TITLE', at: new Date().toISOString() };
const deliver = (u) => {
    const run = Store.startRun(doc, { userId: u, experienceId: E1.id }).run;
    Store.completeNode(doc, run.id, 'r');
    return Store.submitEvidence(doc, { runId: run.id, nodeId: 'p', userId: u, payload: { text: 'una dos tres cuatro' }, workAccess: grant }).evidence;
};
const approve = (ev) => Store.reviewEvidence(doc, ev.id, { reviewerId: 'med-a', decision: 'aprobado' });
// g-7: 3 reconocidos (7s1..7s3), 1 aprobado sin barrido (7s4), 1 SUBMITTED (7s5), 1 RESUBMITTED (7s6), 1 sin actividad (7s7)
['7s1', '7s2', '7s3'].forEach((u) => approve(deliver(u)));
const pendingEv = deliver('7s4'); approve(pendingEv);
deliver('7s5');
const re = deliver('7s6');
Store.requestChanges(doc, re.id, { reviewerId: 'med-a', comment: 'ajusta' });
Store.resubmitEvidence(doc, re.id, { userId: '7s6', text: 'una dos tres cuatro cinco' });
// g-5: 1 reconocido y 1 con ajustes pedidos (no es «por revisar»); g-4: 2 reconocidos (suprimido)
approve(deliver('5s1'));
Store.requestChanges(doc, deliver('5s2').id, { reviewerId: 'med-a', comment: 'ajusta' });
['4s1', '4s2'].forEach((u) => approve(deliver(u)));
fs.writeFileSync(P.mook, JSON.stringify(doc, null, 2));

const ENV = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '', GAMIFICATION_DB: P.gamDb,
    GAMIFICATION_EXCLUSION_REGISTRY: P.reg, GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString() };
Object.assign(process.env, { GAMIFICATION_DB: P.gamDb, GAMIFICATION_EXCLUSION_REGISTRY: P.reg });
let writer = D.getGamificationDb({ env: ENV }); // réplica escritora viva durante toda la prueba
L.createRuleSet(writer, { ruleVersion: 'gm-u4-http', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000,
    rules: { schema: 1, caps: { pmPerDay: 0, pmPerWeek: 0 }, facts: {}, recognition: PILOT } });
const seeded = M.recognizeMookWorks(writer, { ...doc, evidence: doc.evidence.filter((e) => e.id !== pendingEv.id) }, {
    workRefOf: Store.productionWorkRef, readRights: () => () => false, sinceMs: SINCE, env: ENV,
    resolveUser: M.makeResolveUser(USERS, () => true, () => false) });
if (seeded.recognized !== 6) throw new Error(`siembra inesperada: ${JSON.stringify(seeded)}`);
writer.pragma('wal_checkpoint(TRUNCATE)');
const hashDir = (d) => fs.readdirSync(d).sort().map((f) => (f.endsWith('-shm') ? f
    : `${f}:${crypto.createHash('sha256').update(fs.readFileSync(path.join(d, f))).digest('hex')}`)).join();

function spawnApi(port, { flags = ENV, harness = true } = {}) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port),
            NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''}${harness ? ` --import ${HARNESS}` : ''}`,
            CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content,
            LEO_EVIDENCE_DB: path.join(P.data, 'leo_evidence_db.json'), UPLOADS_ROOT: path.join(tmp, 'uploads'),
            USER_AUDIT_DB: path.join(tmp, 'audit.json'), ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off',
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'sqlite', `offline-${port}.db`), IDENTITY_DB: path.join(tmp, 'sqlite', `identity-${port}.db`),
            SESSIONS_DB: path.join(tmp, 'sqlite', `sessions-${port}.db`),
            EVENTS_SQLITE_PATH: path.join(tmp, 'sqlite', `events-${port}.db`), ARCHIVE_SQLITE_PATH: path.join(tmp, 'sqlite', `archive-${port}.db`),
            INSIGHTS_SQLITE_PATH: path.join(tmp, 'sqlite', `insights-${port}.db`), PROGRESS_SQLITE_PATH: path.join(tmp, 'sqlite', `progress-${port}.db`),
            ROYALTIES_DB: process.env.ROYALTIES_DB,
            GAMIFICATION_ENABLED: '', XP_EARNING_ENABLED: '', PM_EARNING_ENABLED: '', GAMIFICATION_MOOK_SINCE: '',
            ...flags, GAMIFICATION_RECONCILE_INITIAL_DELAY_MS: '3600000', EXPERIENCE_EVENTS_BACKBONE_ENABLED: '',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout.on('data', (d) => { logs += d; });
    child.stderr.on('data', (d) => { logs += d; });
    child.logs = () => logs;
    child.base = `http://127.0.0.1:${port}`;
    return child;
}
async function healthy(child) {
    for (let i = 0; i < 400; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child.logs().slice(-1500)}`);
        try { if ((await fetch(`${child.base}/api/health`)).ok) return; } catch { /* arrancando */ }
        await sleep(300);
    }
    throw new Error(`nunca healthy\n${child.logs().slice(-1500)}`);
}
const get = async (child, gid, uid) => {
    const r = await fetch(`${child.base}/api/groups/${gid}/analytics-summary`, uid ? { headers: { 'x-user-id': uid } } : {});
    const text = await r.text();
    let body = null; try { body = JSON.parse(text); } catch { /* no JSON */ }
    return { status: r.status, body, text };
};

const PORT = 5880 + (process.pid % 100) * 4;
const servers = [];
try {
    const on = spawnApi(PORT);
    const locked = spawnApi(PORT + 1, { harness: false });
    const off = spawnApi(PORT + 2, { flags: { GAMIFICATION_ENABLED: '' } });
    const xpOff = spawnApi(PORT + 3, { flags: { ...ENV, XP_EARNING_ENABLED: '' } });
    servers.push(on, locked, off, xpOff);
    for (const s of servers) await healthy(s); // en serie: runners de CI lentos
    const gamBefore = hashDir(P.gamDir);
    const mookBefore = fs.readFileSync(P.mook, 'utf8');

    section('[1] flags');
    {
        const a = await get(off, 'g-7', 'med-a');
        const b = await get(xpOff, 'g-7', 'med-a');
        const c = await get(on, 'g-7', 'med-a');
        ok('sin GAMIFICATION_ENABLED: 200 sin campo `recognition`', a.status === 200 && a.body && !('recognition' in a.body));
        ok('sin XP_EARNING_ENABLED: 200 sin campo `recognition`', b.status === 200 && b.body && !('recognition' in b.body));
        const strip = ({ recognition, ...rest }) => JSON.stringify(rest);
        ok('con todo encendido el resto del resumen es idéntico (campo solo aditivo)', c.status === 200 && 'recognition' in c.body && strip(c.body) === strip(a.body));
    }

    section('[2] tamaños de grupo');
    {
        for (const g of ['g-0', 'g-1', 'g-4']) {
            const r = (await get(on, g, 'med-a')).body?.recognition;
            ok(`${g} (${SIZES[g]} estudiantes): ledger suprimido, sin número`, r?.ledger?.status === 'suppressed' && r.ledger.studentsWithRecognizedWork === null && r.minGroupSize === 5, JSON.stringify(r));
        }
        const r4 = (await get(on, 'g-4', 'med-a')).body.recognition;
        ok('g-4 con 2 reconocidos sigue suprimido (no se infiere)', !JSON.stringify(r4).includes('"studentsWithRecognizedWork":2'));
        const r5 = (await get(on, 'g-5', 'med-a')).body.recognition;
        ok('g-5 (5): 1 estudiante con obra reconocida', r5.ledger.status === 'ok' && r5.ledger.studentsWithRecognizedWork === 1, JSON.stringify(r5));
        ok('g-5: «ajustes pedidos» no cuenta como por revisar', r5.pedagogy.pendingReview === 0);
    }

    section('[3] conteos');
    const r7 = (await get(on, 'g-7', 'med-a')).body.recognition;
    ok('g-7: 3 reconocidos (el aprobado sin barrido no cuenta)', r7.ledger.studentsWithRecognizedWork === 3, JSON.stringify(r7));
    ok('g-7: 2 por revisar (SUBMITTED + RESUBMITTED)', r7.pedagogy.pendingReview === 2);
    ok('g-7: 1 obra elegible (obra-a con acceso explícito; obra-b sin reglas)', r7.catalog.eligibleWorks === 1);
    ok('indicador pedagógico, ledger y catálogo separados', Object.keys(r7).sort().join() === 'catalog,ledger,minGroupSize,pedagogy'
        && Object.keys(r7.pedagogy).join() === 'pendingReview' && Object.keys(r7.ledger).sort().join() === 'status,studentsWithRecognizedWork');
    const rb = (await get(on, 'g-b', 'med-b')).body.recognition;
    ok('institución B (6, sin reglas de acceso): 0 reconocidos, 0 obras elegibles', rb.ledger.studentsWithRecognizedWork === 0 && rb.catalog.eligibleWorks === 0, JSON.stringify(rb));

    section('[4] exclusión');
    {
        E.excludeUser(writer, { userId: '7s1', env: ENV });
        const r = (await get(on, 'g-7', 'med-a')).body.recognition;
        ok('la persona excluida deja de contar: 2', r.ledger.studentsWithRecognizedWork === 2 && r.ledger.status === 'ok', JSON.stringify(r));
        ok('nada en la respuesta delata la exclusión', !/exclu|tombstone|erasure|7s1/i.test(JSON.stringify(r)));
    }

    section('[5] permisos e IDOR');
    {
        const adm = await get(on, 'g-7', 'adm');
        ok('administrador: 200 con bloque', adm.status === 200 && !!adm.body.recognition);
        const other = await get(on, 'g-7', 'med-a2');
        ok('mediador sin el grupo ⇒ 403 sin datos', other.status === 403 && !/recognition|pendingReview/.test(other.text), `${other.status}`);
        const cross = await get(on, 'g-b', 'med-a');
        ok('mediador de la institución A sobre grupo de B ⇒ 403', cross.status === 403 && !/recognition/.test(cross.text));
        const crossB = await get(on, 'g-7', 'med-b');
        ok('mediador de B sobre grupo de A ⇒ 403', crossB.status === 403 && !/recognition/.test(crossB.text));
        const student = await get(on, 'g-7', '7s2');
        ok('lector del grupo ⇒ 403 sin datos', student.status === 403 && !/recognition/.test(student.text));
        const anon = await get(on, 'g-7');
        ok('sin sesión ⇒ 401', anon.status === 401 && !/recognition/.test(anon.text));
        const ghost = await get(on, 'g-nope', 'med-a');
        ok('grupo inexistente ⇒ sin datos', ghost.status >= 400 && !/recognition/.test(ghost.text));
    }

    section('[6] código real sin arnés (V8-ACTIVATE-PREP-01)');
    {
        const r = (await get(locked, 'g-7', 'med-a')).body.recognition;
        ok('sin arnés: 1 obra elegible y los mismos 2 reconocidos', r.catalog.eligibleWorks === 1 && r.ledger.studentsWithRecognizedWork === 2, JSON.stringify(r));
    }

    section('[7] errores y solo lectura');
    {
        const outs = [];
        for (let i = 0; i < 4; i++) outs.push(JSON.stringify((await get(on, 'g-7', 'med-a')).body.recognition));
        ok('lecturas repetidas estables', new Set(outs).size === 1);
        writer.pragma('wal_checkpoint(TRUNCATE)');
        const gam0 = hashDir(P.gamDir);
        for (let i = 0; i < 3; i++) await get(on, 'g-7', 'med-a');
        ok('gamification.db y -wal sin cambios byte a byte', hashDir(P.gamDir) === gam0);
        ok('mook_db.json sin cambios', fs.readFileSync(P.mook, 'utf8') === mookBefore);
        const regRaw = fs.readFileSync(P.reg, 'utf8');
        fs.writeFileSync(P.reg, `${regRaw}{"id":"x"`);
        const broken = (await get(on, 'g-7', 'med-a')).body.recognition;
        fs.writeFileSync(P.reg, regRaw);
        ok('registro dañado ⇒ ledger y catálogo `unavailable`/null, nunca 0', broken.ledger.status === 'unavailable' && broken.ledger.studentsWithRecognizedWork === null && broken.catalog.eligibleWorks === null, JSON.stringify(broken));
        ok('el indicador pedagógico sigue disponible', broken.pedagogy.pendingReview === 2);
        D.closeGamificationDb({ resetBackoff: true });
        const cold = fs.readdirSync(P.gamDir).sort().join();
        const noWriter = (await get(on, 'g-7', 'med-a')).body.recognition;
        ok('sin escritor vivo ⇒ `unavailable`, sin crear -wal/-shm', noWriter.ledger.status === 'unavailable' && fs.readdirSync(P.gamDir).sort().join() === cold, cold);
        writer = D.getGamificationDb({ env: ENV });
        ok('log del servidor solo con el código', /reconocimiento de grupo no disponible: (EXCLUSION_REGISTRY_UNAVAILABLE|GAMIFICATION_DB_NOT_LIVE)/.test(on.logs())
            && !/reconocimiento de grupo no disponible[^\n]*(7s|med-)/.test(on.logs()));
    }

    section('[8] privacidad');
    {
        const all = JSON.stringify([r7, rb, (await get(on, 'g-5', 'med-a')).body.recognition]);
        ok('solo conteos: sin ids, nombres, XP, niveles ni hex', !/[0-9]s\d|Nombre|"xp"|level|semilla|brote|[0-9a-f]{32}/i.test(all), all);
        const ledgerSteps = fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8');
        const fn = ledgerSteps.match(/async function groupRecognitionBlock[\s\S]*?\n}\n/)?.[0] ?? '';
        ok('el bloque no lee nombres ni XP individuales', fn.length > 0 && !/nombre|resolveParticipantName|getXp|readMyProgress/.test(fn));
    }
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    for (const s of servers) { try { s.kill('SIGKILL'); } catch { /* noop */ } }
    await sleep(500);
    D.closeGamificationDb({ resetBackoff: true });
    const diff = Object.entries(realFingerprint()).filter(([k, v]) => realBefore[k] !== v).map(([k]) => k);
    ok('stores reales intactos (data/, data-critical/)', diff.length === 0 && Object.keys(realBefore).every((k) => fs.existsSync(path.join(REPO, k))), diff.join());
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows: archivos aún abiertos */ }
}

console.log(`\ngroup recognition HTTP (G4-UX-U4): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
