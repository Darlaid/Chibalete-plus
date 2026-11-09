/**
 * studentProgressHttp.test.mjs — CHP-V8-UNIFIED-XP-01.
 *
 * GET /api/groups/:groupId/students/:studentId/progress sobre server.js REAL, con
 * stores temporales y usuarios sintéticos. El ledger se siembra en ESTE proceso con
 * el escritor real, que queda abierto (réplica viva); los servidores solo leen.
 *   [1] XP acumulativo 30/20/50 visto por el mediador: 30 + 20 y techo 50
 *   [2] persona sin actividad y persona excluida: idénticas (cero, Semilla)
 *   [3] fuera de la cohorte del grupo ⇒ 404 idéntico (no divulgación, sin enumeración)
 *   [4] permisos: mediador ajeno, otra institución, lector, administrador, sin sesión
 *   [5] XP apagado (o gamificación apagada) ⇒ 404 antes de autorizar, sin tocar la base
 *   [6] solo lectura, sin escritor vivo ⇒ 503 sin crear archivos
 *   [7] privacidad: solo xp, nivel, obras reconocidas y logros
 *   [8] los agregados del grupo siguen igual
 *   [9] V8.1-CLOSE-01 (G-02): A2 Sí / No / pendiente / vencida / revocada, registro
 *       dañado o ausente, restauración de la base, y el lector sigue con su XP
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/studentProgressHttp.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_student_http_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');
const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const E = await import('../erasure.mjs');
const A2 = await import('../../privacy/a2Registry.mjs');
(await import('../../royalties/publishersStore.mjs')).getRoyaltiesDb();

const SINCE = Date.now() - 60_000;
// Parámetros aprobados (A7-A12-V3): lectura 10 + reflexión 20 = 30 por obra; techo 50. Sin PM.
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [] } };

// ── Usuarios, grupos y dos instituciones ─────────────────────────────────────
const ORG_A = 'org-a', ORG_B = 'org-b';
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'data', 'groups.json'),
    schools: path.join(tmp, 'data', 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'data', 'content.json'),
    mook: path.join(tmp, 'data', 'mook_db.json'), gamDir: path.join(tmp, 'gam'), reg: path.join(tmp, 'reg', 'exclusions.jsonl'),
    a2: path.join(tmp, 'a2', 'a2.jsonl') };
P.gamDb = path.join(P.gamDir, 'gamification.db');
for (const d of [P.data, P.gamDir, path.dirname(P.reg), path.dirname(P.a2), path.join(tmp, 'uploads'), path.join(tmp, 'sqlite')]) fs.mkdirSync(d, { recursive: true });
const lec = (id, org, g) => ({ id, nombre_completo: `Nombre ${id}`, roles: ['lector'], organizationId: org, colegio: org === ORG_A ? 'Colegio Alfa' : 'Colegio Beta', accountStatus: 'active', groupIds: [g] });
const MEMBERS = { 'g-a': ['a1', 'a2', 'a3'], 'g-a2': ['x1'], 'g-b': ['b1'] };
const USERS = [
    ...Object.entries(MEMBERS).flatMap(([g, list]) => list.map((id) => lec(id, g === 'g-b' ? ORG_B : ORG_A, g))),
    { id: 'med-a', nombre_completo: 'Mediadora A', roles: ['mediador'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher', groupIds: ['g-a'] },
    { id: 'med-a2', nombre_completo: 'Mediador A2', roles: ['mediador'], organizationId: ORG_A, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher', groupIds: ['g-a2'] },
    { id: 'med-b', nombre_completo: 'Mediador B', roles: ['mediador'], organizationId: ORG_B, colegio: 'Colegio Beta', accountStatus: 'active', mediatorKind: 'teacher', groupIds: ['g-b'] },
    { id: 'adm', roles: ['administrador'], accountStatus: 'active' },
];
const GROUPS = [
    { id: 'g-a', type: 'course', organizationId: ORG_A, school: 'Colegio Alfa', mediatorIds: ['med-a'], studentIds: MEMBERS['g-a'], memberIds: MEMBERS['g-a'] },
    { id: 'g-a2', type: 'club', organizationId: ORG_A, school: 'Colegio Alfa', mediatorIds: ['med-a2'], studentIds: MEMBERS['g-a2'], memberIds: MEMBERS['g-a2'] },
    { id: 'g-b', type: 'course', organizationId: ORG_B, school: 'Colegio Beta', mediatorIds: ['med-b'], studentIds: MEMBERS['g-b'], memberIds: MEMBERS['g-b'] },
];
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG_A, name: 'Colegio Alfa' }, { id: ORG_B, name: 'Colegio Beta' }]));
const work = (id) => ({ id, titulo: `Título ${id}`, autor: 'A', tipo: 'libro', status: 'disponible', editorial: 'Chibalete', etiquetas: ['x'], descripcion_corta: 'd' });
fs.writeFileSync(P.content, JSON.stringify([work('obra-a')]));
const lectors = USERS.filter((u) => u.roles.includes('lector')).map((u) => u.id);
fs.writeFileSync(P.access, JSON.stringify(lectors.map((u) => ({ id: `r-${u}`, scope: 'user', scopeId: u, titleIds: ['obra-a'], collectionIds: [], expiresAt: null }))));
for (const f of ['progress_db.json', 'leo_evidence_db.json']) fs.writeFileSync(path.join(P.data, f), f === 'progress_db.json' ? '{"progressMap":{}}' : '[]');
fs.writeFileSync(P.reg, '');
// G-02: A2 verificada para todos los lectores sintéticos (cada prueba la cambia en [9]).
fs.writeFileSync(P.a2, '');
const A2ENV = { CHP_A2_REGISTRY: P.a2, GAMIFICATION_EXCLUSION_REGISTRY: P.reg };
for (const u of ['a1', 'a2', 'a3', 'x1', 'b1']) A2.appendA2Decision({ userId: u, status: 'granted', requestRef: `A2-SINT-${u}` }, { env: A2ENV });

// ── MOOK: tres experiencias sobre la MISMA obra (obra-a) ─────────────────────
const doc = Store.emptyMookStore();
const mkExp = (slug) => {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [{ id: 'r', type: 'READING', title: 'r', resourceRef: 'obra-a' },
        { id: 'p', type: 'PRODUCTION', title: 'p', resourceRef: 'obra-a', config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } }] }] }, () => true);
    Store.publishVersion(doc, v.id);
    return exp;
};
const EXPS = [mkExp('e1'), mkExp('e2'), mkExp('e3')];
const grant = { workRef: 'obra-a', decision: 'allowed', via: 'SCOPE_TITLE', at: new Date().toISOString() };
const deliver = (u, exp) => {
    const run = Store.startRun(doc, { userId: u, experienceId: exp.id }).run;
    Store.completeNode(doc, run.id, 'r');
    return Store.submitEvidence(doc, { runId: run.id, nodeId: 'p', userId: u, payload: { text: 'una dos tres cuatro' }, workAccess: grant }).evidence;
};
const approve = (ev, reviewer) => Store.reviewEvidence(doc, ev.id, { reviewerId: reviewer, decision: 'aprobado' });

const ENV = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: P.gamDb,
    GAMIFICATION_EXCLUSION_REGISTRY: P.reg, GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString(), CHP_A2_REGISTRY: P.a2 };
Object.assign(process.env, { GAMIFICATION_DB: P.gamDb, GAMIFICATION_EXCLUSION_REGISTRY: P.reg });
let writer = D.getGamificationDb({ env: ENV }); // réplica escritora viva durante toda la prueba
// Regla válida SIN campos de PM.
L.createRuleSet(writer, { ruleVersion: 'gm-unified-http', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000,
    rules: { schema: 1, facts: {}, recognition: PILOT } });
const sweep = () => M.recognizeMookWorks(writer, doc, { workRefOf: Store.productionWorkRef, readRights: () => () => false, sinceMs: SINCE, env: ENV,
    resolveUser: M.makeResolveUser(USERS, () => true, () => false) });
const xpOf = (u) => L.getXp(writer, u);
const xpSteps = [];
// a1: tres entregas aprobadas sobre la misma obra ⇒ 30, 50, 50 (techo).
for (const exp of EXPS) { approve(deliver('a1', exp), 'med-a'); sweep(); sweep(); xpSteps.push(xpOf('a1')); }
// a2: una entrega aprobada (30); después se excluye. a3: sin actividad. x1 y b1: 30 cada una.
approve(deliver('a2', EXPS[0]), 'med-a');
approve(deliver('x1', EXPS[0]), 'med-a2');
approve(deliver('b1', EXPS[0]), 'med-b');
sweep(); sweep();
fs.writeFileSync(P.mook, JSON.stringify(doc, null, 2));
const seededXp = { a2: xpOf('a2'), x1: xpOf('x1'), b1: xpOf('b1') };
writer.pragma('wal_checkpoint(TRUNCATE)');
const hashDir = (d) => fs.readdirSync(d).sort().map((f) => (f.endsWith('-shm') ? f
    : `${f}:${crypto.createHash('sha256').update(fs.readFileSync(path.join(d, f))).digest('hex')}`)).join();

function spawnApi(port, { flags = ENV } = {}) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content,
            LEO_EVIDENCE_DB: path.join(P.data, 'leo_evidence_db.json'), UPLOADS_ROOT: path.join(tmp, 'uploads'),
            USER_AUDIT_DB: path.join(tmp, 'audit.json'), ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off',
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'sqlite', `offline-${port}.db`), IDENTITY_DB: path.join(tmp, 'sqlite', `identity-${port}.db`),
            SESSIONS_DB: path.join(tmp, 'sqlite', `sessions-${port}.db`),
            EVENTS_SQLITE_PATH: path.join(tmp, 'sqlite', `events-${port}.db`), ARCHIVE_SQLITE_PATH: path.join(tmp, 'sqlite', `archive-${port}.db`),
            INSIGHTS_SQLITE_PATH: path.join(tmp, 'sqlite', `insights-${port}.db`), PROGRESS_SQLITE_PATH: path.join(tmp, 'sqlite', `progress-${port}.db`),
            ROYALTIES_DB: process.env.ROYALTIES_DB,
            GAMIFICATION_ENABLED: '', XP_EARNING_ENABLED: '', GAMIFICATION_MOOK_SINCE: '',
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
const get = async (child, gid, sid, uid) => {
    const r = await fetch(`${child.base}/api/groups/${encodeURIComponent(gid)}/students/${encodeURIComponent(sid)}/progress`, uid ? { headers: { 'x-user-id': uid } } : {});
    const text = await r.text();
    let body = null; try { body = JSON.parse(text); } catch { /* no JSON */ }
    return { status: r.status, body, text, cache: r.headers.get('cache-control') };
};
const summary = async (child, gid, uid) => {
    const r = await fetch(`${child.base}/api/groups/${gid}/analytics-summary`, { headers: { 'x-user-id': uid } });
    return { status: r.status, body: await r.json().catch(() => null) };
};

const PORT = 6400 + (process.pid % 100) * 3;
const servers = [];
try {
    section('[0] siembra (escritor real, réplica viva)');
    ok('XP acumulativo 30/20/50: 30 → 50 → 50 (techo por obra)', xpSteps.join() === '30,50,50', xpSteps.join());
    ok('otras personas con una obra reconocida: 30 XP', seededXp.a2 === 30 && seededXp.x1 === 30 && seededXp.b1 === 30, JSON.stringify(seededXp));
    ok('el escritor no escribió PM', ['gm_pm_movements', 'gm_pm_balances', 'gm_redemptions'].every((t) => writer.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n === 0));

    const on = spawnApi(PORT);
    const off = spawnApi(PORT + 1, { flags: { GAMIFICATION_ENABLED: '' } });
    const xpOff = spawnApi(PORT + 2, { flags: { ...ENV, XP_EARNING_ENABLED: '' } });
    servers.push(on, off, xpOff);
    for (const s of servers) await healthy(s); // en serie: runners de CI lentos
    const mookBefore = fs.readFileSync(P.mook, 'utf8');

    section('[1] mediador de su grupo: XP, nivel y reconocimientos');
    const a1 = await get(on, 'g-a', 'a1', 'med-a');
    ok('200 con no-store', a1.status === 200 && /no-store/.test(a1.cache ?? ''), `${a1.status} ${a1.text}`);
    ok('a1: 50 XP, Brote, 1 obra reconocida', a1.body?.xp === 50 && a1.body.level?.id === 'brote' && a1.body.recognizedWorks === 1, a1.text);
    ok('a1: logros «primera-obra» y «mirada-profunda» (dos reflexiones en la misma obra)', JSON.stringify(a1.body?.achievements) === '["primera-obra","mirada-profunda"]', a1.text);

    section('[2] sin actividad y excluida: indistinguibles');
    const a3 = await get(on, 'g-a', 'a3', 'med-a');
    ok('a3 sin actividad: 0 XP, Semilla, sin logros', a3.status === 200 && a3.body.xp === 0 && a3.body.level.id === 'semilla' && a3.body.recognizedWorks === 0 && a3.body.achievements.length === 0, a3.text);
    const a2Before = await get(on, 'g-a', 'a2', 'med-a');
    ok('a2 antes de excluir: 30 XP, Brote', a2Before.body?.xp === 30 && a2Before.body.level.id === 'brote', a2Before.text);
    E.excludeUser(writer, { userId: 'a2', env: ENV });
    const a2 = await get(on, 'g-a', 'a2', 'med-a');
    ok('a2 excluida ⇒ respuesta idéntica a la de alguien sin actividad', a2.status === 200 && a2.text === a3.text, `${a2.text} vs ${a3.text}`);
    ok('nada delata la exclusión', !/exclu|tombstone|erasure|withdrawn/i.test(a2.text));

    section('[3] fuera del grupo ⇒ 404 idéntico (sin enumeración)');
    const nf = [await get(on, 'g-a', 'x1', 'med-a'), await get(on, 'g-a', 'b1', 'med-a'), await get(on, 'g-a', 'no-existe', 'med-a'),
        await get(on, 'g-a', 'med-a', 'med-a'), await get(on, 'g-a', '../a1', 'med-a'), await get(on, 'g-a', 'A1', 'med-a')];
    ok('otro grupo, otra institución, inexistente, el propio mediador, rutas y mayúsculas manipuladas ⇒ 404', nf.every((r) => r.status === 404), nf.map((r) => r.status).join());
    ok('los seis 404 son byte a byte iguales y sin datos', new Set(nf.map((r) => r.text)).size === 1 && !/xp|level|brote|semilla/i.test(nf[0].text), nf[0].text);
    const ghostGroup = await get(on, 'g-nope', 'a1', 'med-a');
    ok('grupo inexistente ⇒ sin datos (403 del alcance)', ghostGroup.status === 403 && !/xp/i.test(ghostGroup.text), `${ghostGroup.status}`);

    section('[4] permisos');
    const cases = [
        ['mediador de otro grupo de la misma institución', await get(on, 'g-a', 'a1', 'med-a2'), 403],
        ['mediador de otra institución', await get(on, 'g-a', 'a1', 'med-b'), 403],
        ['mediador sobre un grupo de otra institución', await get(on, 'g-b', 'b1', 'med-a'), 403],
        ['el propio lector', await get(on, 'g-a', 'a1', 'a1'), 403],
        ['otro lector del grupo', await get(on, 'g-a', 'a1', 'a3'), 403],
        ['administrador de plataforma (no es «mis grupos»)', await get(on, 'g-a', 'a1', 'adm'), 403],
        ['sin sesión', await get(on, 'g-a', 'a1'), 401],
        ['identidad inexistente', await get(on, 'g-a', 'a1', 'nadie'), 401],
    ];
    for (const [l, r, want] of cases) ok(`${l} ⇒ ${want}, sin datos`, r.status === want && !/"xp"|brote|semilla/i.test(r.text), `${r.status} ${r.text}`);
    const own = [await get(on, 'g-a2', 'x1', 'med-a2'), await get(on, 'g-b', 'b1', 'med-b')];
    ok('cada mediador sí ve a SU estudiante (30 XP)', own.every((r) => r.status === 200 && r.body.xp === 30), own.map((r) => r.text).join(' | '));

    section('[5] XP apagado ⇒ la consulta no existe');
    writer.pragma('wal_checkpoint(TRUNCATE)');
    const gam0 = hashDir(P.gamDir);
    for (const [l, s] of [['sin GAMIFICATION_ENABLED', off], ['sin XP_EARNING_ENABLED', xpOff]]) {
        const rs = [await get(s, 'g-a', 'a1', 'med-a'), await get(s, 'g-a', 'a1', 'med-b'), await get(s, 'g-a', 'zz', 'med-a')];
        ok(`${l}: 404 igual para el mediador propio, el ajeno y un id inventado`, rs.every((r) => r.status === 404) && new Set(rs.map((r) => r.text)).size === 1, rs.map((r) => `${r.status}`).join());
    }
    ok('con XP apagado no se abrió ni escribió la base', hashDir(P.gamDir) === gam0);

    section('[6] solo lectura y fallo seguro');
    for (let i = 0; i < 3; i++) await get(on, 'g-a', 'a1', 'med-a');
    ok('gamification.db y -wal sin cambios byte a byte tras lecturas', hashDir(P.gamDir) === gam0);
    ok('mook_db.json sin cambios', fs.readFileSync(P.mook, 'utf8') === mookBefore);
    const regRaw = fs.readFileSync(P.reg, 'utf8');
    fs.writeFileSync(P.reg, `${regRaw}{"id":"x"`);
    const broken = await get(on, 'g-a', 'a1', 'med-a');
    fs.writeFileSync(P.reg, regRaw);
    ok('registro de exclusiones dañado ⇒ 503 genérico, nunca 0 XP', broken.status === 503 && !/"xp"/.test(broken.text), `${broken.status} ${broken.text}`);
    D.closeGamificationDb({ resetBackoff: true });
    const cold = fs.readdirSync(P.gamDir).sort().join();
    const noWriter = await get(on, 'g-a', 'a1', 'med-a');
    ok('sin escritor vivo ⇒ 503 sin crear -wal/-shm', noWriter.status === 503 && fs.readdirSync(P.gamDir).sort().join() === cold, `${noWriter.status} ${cold}`);
    writer = D.getGamificationDb({ env: ENV });
    ok('log del servidor solo con el código (sin ids)', /progreso individual no disponible: (EXCLUSION_REGISTRY_UNAVAILABLE|GAMIFICATION_DB_NOT_LIVE)/.test(on.logs())
        && !/progreso individual no disponible[^\n]*(a1|med-)/.test(on.logs()));

    section('[7] privacidad');
    const again = await get(on, 'g-a', 'a1', 'med-a');
    ok('solo las claves xp, level, recognizedWorks y achievements', again.body && Object.keys(again.body).sort().join() === 'achievements,level,recognizedWorks,xp'
        && Object.keys(again.body.level).join() === 'id', again.text);
    ok('sin nombres, ids, claves HMAC, historial, obras ni comparaciones', !/Nombre|a1|med-|subject|work_key|[0-9a-f]{32}|history|"works"|title|rank|percentil|promedio/i.test(again.text), again.text);

    section('[9] G-02: A2 del lector (criterio único)');
    const a2Raw = fs.readFileSync(P.a2, 'utf8');
    const nfText = nf[0].text;
    const setA2 = (u, status, extra = {}) => A2.appendA2Decision({ userId: u, status, requestRef: `A2-SINT-${u}-${status}`, ...extra }, { env: A2ENV });
    const yes = await get(on, 'g-a', 'a1', 'med-a');
    ok('A2 = Sí y vigente ⇒ 200 con su XP', yes.status === 200 && yes.body?.xp === 50, yes.text);
    setA2('a3', 'denied');
    const no = await get(on, 'g-a', 'a3', 'med-a');
    ok('A2 = No ⇒ 404 byte a byte igual al de una persona ajena', no.status === 404 && no.text === nfText, `${no.status} ${no.text}`);
    const stillYes = await get(on, 'g-a', 'a1', 'med-a');
    ok('la negativa de otro lector no cierra a quien sí tiene A2', stillYes.status === 200 && stillYes.body?.xp === 50, stillYes.text);
    const afterDeny = fs.readFileSync(P.a2, 'utf8');
    const pend = await get(on, 'g-a2', 'x1', 'med-a2');
    ok('x1 con A2 = Sí ⇒ 200', pend.status === 200, pend.text);
    fs.writeFileSync(P.a2, afterDeny.split(/\n/).filter((l) => l && !l.includes('A2-SINT-x1')).map((l) => `${l}${String.fromCharCode(10)}`).join(''));
    const pending = await get(on, 'g-a2', 'x1', 'med-a2');
    ok('A2 pendiente (sin decisión registrada) ⇒ el mismo 404', pending.status === 404 && pending.text === nfText, `${pending.status} ${pending.text}`);
    fs.writeFileSync(P.a2, afterDeny);
    setA2('x1', 'granted', { validUntil: '2000-01-01' });
    const expired = await get(on, 'g-a2', 'x1', 'med-a2');
    ok('A2 vencida ⇒ el mismo 404', expired.status === 404 && expired.text === nfText, `${expired.status}`);
    setA2('x1', 'granted', { validUntil: '2999-12-31' });
    ok('A2 renovada con vigencia futura ⇒ 200', (await get(on, 'g-a2', 'x1', 'med-a2')).status === 200);
    setA2('x1', 'revoked');
    const revoked = await get(on, 'g-a2', 'x1', 'med-a2');
    ok('A2 revocada ⇒ el mismo 404, de inmediato (sin caché)', revoked.status === 404 && revoked.text === nfText, `${revoked.status}`);
    const xpKept = L.getXp(writer, 'x1');
    ok('el lector conserva su XP: A2 no toca el ledger (006 §3.5)', xpKept === 30, String(xpKept));
    const permsStill = [await get(on, 'g-a', 'a1', 'adm'), await get(on, 'g-a', 'a1', 'med-b'), await get(on, 'g-a', 'a1')];
    ok('A2 no amplía nada: administrador 403, mediador ajeno 403, sin sesión 401', permsStill.map((r) => r.status).join() === '403,403,401', permsStill.map((r) => r.status).join());
    const goodRaw = fs.readFileSync(P.a2, 'utf8');
    const forged = goodRaw.replace(/"a":"revoked"/, '"a":"granted"');
    fs.writeFileSync(P.a2, forged);
    const tampered = [await get(on, 'g-a', 'a1', 'med-a'), await get(on, 'g-a2', 'x1', 'med-a2')];
    ok('registro A2 alterado ⇒ 503 para todos, nunca 200', tampered.every((r) => r.status === 503 && !/"xp"/.test(r.text)), tampered.map((r) => r.status).join());
    fs.rmSync(P.a2);
    const missing = await get(on, 'g-a', 'a1', 'med-a');
    ok('registro A2 ausente ⇒ 503, nunca 200', missing.status === 503 && !/"xp"/.test(missing.text), `${missing.status}`);
    fs.writeFileSync(P.a2, goodRaw);
    // Restaurar la base de gamificación no reabre una A2 retirada: el registro no es parte de ella.
    writer.pragma('wal_checkpoint(TRUNCATE)');
    ok('A2 vive fuera de la base: la revocación sigue tras volver a abrir la base', (await get(on, 'g-a2', 'x1', 'med-a2')).status === 404);
    const sumA2 = await summary(on, 'g-a', 'med-a');
    ok('analytics-summary: a3 (A2 = No) fuera de readers[], a1 dentro', sumA2.status === 200 && !sumA2.body.readers.some((r) => r.userId === 'a3')
        && sumA2.body.readers.some((r) => r.userId === 'a1'), JSON.stringify(sumA2.body?.readers?.map((r) => r.userId)));
    ok('analytics-summary: con 1 retenido los agregados se limitan a los visibles', sumA2.body.individualAccess?.aggregateOver === 'allowed'
        && sumA2.body.readerCount === sumA2.body.readers.length, JSON.stringify(sumA2.body.individualAccess));
    fs.writeFileSync(P.a2, a2Raw);

    section('[8] agregados del grupo intactos');
    const sum = await summary(on, 'g-a', 'med-a');
    ok('analytics-summary sigue con su bloque de reconocimiento (suprimido: grupo < 5)', sum.status === 200 && sum.body?.recognition?.ledger?.status === 'suppressed', JSON.stringify(sum.body?.recognition));
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

console.log(`\nstudent progress HTTP (V8-UNIFIED-XP-01): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
