/**
 * commercialClassHttp.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F2-B.
 *
 * server.js REAL contra stores TEMPORALES:
 *   [1] línea base: accesos, catálogo y entitlement por actor
 *   [2] solo administración ve y cambia clases; validación estricta
 *   [3] clasificaciones concurrentes sobre reglas distintas persisten las dos
 *   [4] accesos y catálogo idénticos tras clasificar; reglas idénticas salvo
 *       los campos comerciales
 *   [5] atribución: sin clasificar / piloto / pagada / sintética / admin;
 *       reglas simultáneas deterministas
 *   [6] POST /api/access: rechaza campos comerciales y arrastra la clase
 *       (requiere /app/secrets escribible: Linux/contenedor; si no, SKIP)
 *   [7] auditoría; catálogo, publisherId, progreso y eventos intactos
 *
 *   node server/royalties/__test__/commercialClassHttp.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import { freePort } from '../../__test__/helpers/freePort.mjs';
import Database from 'better-sqlite3';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
let pass = 0, fail = 0, skip = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (p) => (fs.existsSync(p) ? crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex') : 'absent');
const hash = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);

// Secreto de administración solo donde existe la ruta canónica escribible.
const SECRET_DIR = '/app/secrets';
let ADMIN_SECRET = null;
if (process.platform !== 'win32') {
    try {
        fs.mkdirSync(SECRET_DIR, { recursive: true });
        const p = path.join(SECRET_DIR, 'admin_secret');
        if (!fs.existsSync(p)) {
            const s = crypto.randomBytes(32).toString('hex');
            fs.writeFileSync(p, s, { mode: 0o400 });
            ADMIN_SECRET = s;
        }
    } catch { ADMIN_SECRET = null; }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_commercial_http_'));
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'),
    access: path.join(tmp, 'access.json'), groups: path.join(tmp, 'groups.json'), audit: path.join(tmp, 'user_audit.json'),
    uploads: path.join(tmp, 'uploads'), royalties: path.join(tmp, 'rdb', 'royalties.db'), offline: path.join(tmp, 'offline.db'),
};
fs.mkdirSync(P.data, { recursive: true });
fs.mkdirSync(P.uploads, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active', nombre_completo: 'Adm' },
    { id: 'MED', email: 'med@fx.test', roles: ['mediador'], accountStatus: 'active', nombre_completo: 'Med' },
    { id: 'LEC', email: 'lec@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'Lec', groupIds: ['g1'] },
    { id: 'LEC2', email: 'lec2@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'Lec2' },
    { id: 'SYN', email: 'syn@fx.test', roles: ['lector'], accountStatus: 'active', nombre_completo: 'Syn', groupIds: ['g1'], _loadtest_marker: 'lt' },
]));
fs.writeFileSync(P.groups, JSON.stringify([{ id: 'g1', name: 'Grupo 1', type: 'course', memberIds: ['LEC', 'SYN'], studentIds: ['LEC', 'SYN'], mediatorIds: ['MED'] }]));
fs.writeFileSync(path.join(tmp, 'schools.json'), '[]');
const PUB = 'pub-chibalete-editores';
const mk = (n) => ({ id: `content-c${n}`, titulo: `Obra ${n}`, autor: 'A', tipo: 'libro', editorial: 'Chibalete', etiquetas: ['x'], status: 'disponible', descripcion_corta: 'd', publisherId: PUB });
fs.writeFileSync(P.content, JSON.stringify([mk(1), mk(2), mk(3)], null, 2));
const RULES = [
    { id: 'r-g1', scope: 'group', scopeId: 'g1', titleIds: ['content-c1', 'content-c2'], collectionIds: [], expiresAt: null },
    { id: 'r-lec-pilot', scope: 'user', scopeId: 'LEC', titleIds: ['content-c1'], collectionIds: [], expiresAt: null },
    { id: 'r-lec2', scope: 'user', scopeId: 'LEC2', titleIds: ['content-c3'], collectionIds: [], expiresAt: null },
    { id: 'r-exp', scope: 'user', scopeId: 'LEC', titleIds: ['content-c3'], collectionIds: [], expiresAt: 1 },
];
fs.writeFileSync(P.access, JSON.stringify(RULES, null, 2));
const IDS = ['content-c1', 'content-c2', 'content-c3'];

const PORT = await freePort();
const base = `http://127.0.0.1:${PORT}`;
let child = null, boot = '';
async function start() {
    child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(PORT),
            CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: path.join(tmp, 'schools.json'),
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads, USER_AUDIT_DB: P.audit,
            ROYALTIES_DB: P.royalties, OFFLINE_ASSIGNMENT_DB_PATH: P.offline, SESSION_AUTH_MODE: 'off', ACCESS_FALLBACK_MODE: 'restricted',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        },
    });
    child.stdout.on('data', (d) => { boot += d; });
    child.stderr.on('data', (d) => { boot += d; });
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy\n${boot.slice(-2000)}`);
}
const call = async (method, url, uid, body, headers = {}) => {
    const r = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...(uid ? { 'x-user-id': uid } : {}), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    let j = null; try { j = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, body: j };
};
async function observe() {
    const out = {};
    for (const uid of ['LEC', 'LEC2', 'SYN', 'MED', 'ADM']) {
        const acc = {};
        for (const id of IDS) { const r = await call('GET', `/api/content/${id}/access?userId=${uid}`, uid); acc[id] = `${r.status}:${r.body?.allowed}`; }
        const cat = await call('GET', '/api/content', uid);
        const ent = await call('GET', `/api/access/by-user/${uid}`, uid);
        out[uid] = { acc, catalog: `${cat.status}:${hash(cat.body)}`, entitlement: `${ent.status}:${hash(ent.body)}` };
    }
    return out;
}
const stripCommercial = (rules) => rules.map(({ commercialClass, commercialClassSince, commercialClassHistory, ...rest }) => rest);
const countRows = (file, table) => {
    if (!fs.existsSync(file)) return 'absent';
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { return db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n; } catch { return 'no-table'; } finally { db.close(); }
};
const sideEffects = () => ({
    content: sha(P.content), users: sha(P.users), groups: sha(P.groups),
    progressRows: countRows(path.join(P.data, 'progress.db'), 'progress'), eventRows: countRows(path.join(P.data, 'events.db'), 'events'),
});

try {
    await start();
    console.log('\n[1] línea base');
    const baseline = await observe();
    ok('lector LEC lee c1 y c2 (regla de grupo y de usuario), no c3 (caducada)', baseline.LEC.acc['content-c1'] === '200:true' && baseline.LEC.acc['content-c2'] === '200:true' && baseline.LEC.acc['content-c3'] === '403:false');
    ok('LEC2 lee solo c3', baseline.LEC2.acc['content-c3'] === '200:true' && baseline.LEC2.acc['content-c1'] === '403:false');
    const before = sideEffects();

    console.log('\n[2] autorización y validación');
    let r = await call('GET', '/api/admin/access/commercial-classes', 'ADM');
    ok('admin: matriz con 4 reglas, todas unclassified y no elegibles', r.status === 200 && r.body.length === 4 && r.body.every((x) => x.commercialClass === 'unclassified' && !x.economicallyEligible));
    ok('admin: r-exp figura inactiva', r.body.find((x) => x.id === 'r-exp').active === false);
    for (const uid of ['LEC', 'MED']) {
        ok(`${uid}: no ve la matriz`, [401, 403].includes((await call('GET', '/api/admin/access/commercial-classes', uid)).status));
        ok(`${uid}: no clasifica`, [401, 403].includes((await call('PUT', '/api/admin/access/r-g1/commercial-class', uid, { commercialClass: 'paid_b2c', evidenceRef: 'x' })).status));
        ok(`${uid}: no consulta atribución`, [401, 403].includes((await call('GET', '/api/admin/access/attribution?userId=LEC&contentId=content-c1', uid)).status));
    }
    ok('sin sesión: no clasifica', (await call('PUT', '/api/admin/access/r-g1/commercial-class', null, { commercialClass: 'pilot', evidenceRef: 'x' })).status === 401);
    r = await call('PUT', '/api/admin/access/r-g1/commercial-class', 'ADM', { commercialClass: 'pagado', evidenceRef: 'x' });
    ok('clase inválida → 400', r.status === 400 && r.body.code === 'invalid_commercial_class');
    r = await call('PUT', '/api/admin/access/r-g1/commercial-class', 'ADM', { commercialClass: 'pilot' });
    ok('sin soporte → 400', r.status === 400 && r.body.code === 'evidence_required');
    r = await call('PUT', '/api/admin/access/r-g1/commercial-class', 'ADM', { commercialClass: 'pilot', evidenceRef: 'x', since: 1 });
    ok('fecha retroactiva → 400', r.status === 400 && r.body.code === 'unknown_field');
    r = await call('PUT', '/api/admin/access/r-nada/commercial-class', 'ADM', { commercialClass: 'pilot', evidenceRef: 'x' });
    ok('regla inexistente → 404', r.status === 404);
    ok('los rechazos no escribieron', JSON.stringify(JSON.parse(fs.readFileSync(P.access, 'utf8'))) === JSON.stringify(RULES));

    console.log('\n[3] clasificaciones concurrentes');
    const t0 = Date.now();
    const [a1, a2] = await Promise.all([
        call('PUT', '/api/admin/access/r-g1/commercial-class', 'ADM', { commercialClass: 'paid_institutional', evidenceRef: 'CONTRATO-FX-1' }),
        call('PUT', '/api/admin/access/r-lec-pilot/commercial-class', 'ADM', { commercialClass: 'pilot', evidenceRef: 'PILOTO-FX-1' }),
    ]);
    ok('ambas 200 con cambio', a1.status === 200 && a2.status === 200 && a1.body.changed && a2.body.changed);
    const stored = JSON.parse(fs.readFileSync(P.access, 'utf8'));
    const g1 = stored.find((x) => x.id === 'r-g1');
    const pl = stored.find((x) => x.id === 'r-lec-pilot');
    ok('las dos persistieron (lock compartido)', g1.commercialClass === 'paid_institutional' && pl.commercialClass === 'pilot');
    ok('hora del servidor, no del cliente', g1.commercialClassHistory[0].since >= t0 && g1.commercialClassHistory[0].by === 'ADM');
    r = await call('PUT', '/api/admin/access/r-g1/commercial-class', 'ADM', { commercialClass: 'paid_institutional', evidenceRef: 'CONTRATO-FX-1' });
    ok('repetir la misma clase → sin cambio', r.status === 200 && r.body.changed === false && JSON.parse(fs.readFileSync(P.access, 'utf8')).find((x) => x.id === 'r-g1').commercialClassHistory.length === 1);

    console.log('\n[4] el acceso no cambia');
    ok('accesos, catálogo y entitlement idénticos a la línea base', JSON.stringify(await observe()) === JSON.stringify(baseline));
    ok('reglas idénticas salvo campos comerciales', JSON.stringify(stripCommercial(JSON.parse(fs.readFileSync(P.access, 'utf8')))) === JSON.stringify(RULES));
    const ent = (await call('GET', '/api/access/by-user/LEC', 'LEC')).body;
    ok('el entitlement del lector no expone la clase', !/commercialClass|paid_|CONTRATO-FX/.test(JSON.stringify(ent)));
    const cat = (await call('GET', '/api/content', 'LEC')).body;
    ok('el catálogo no expone la clase', !/commercialClass|paid_institutional|CONTRATO-FX/.test(JSON.stringify(cat)));

    console.log('\n[5] atribución');
    const att = async (u, c) => (await call('GET', `/api/admin/access/attribution?userId=${u}&contentId=${c}`, 'ADM')).body;
    let x = await att('LEC', 'content-c1');
    ok('LEC/c1: pagada (grupo) gana a piloto (usuario) → elegible', x.ruleId === 'r-g1' && x.eligible === true && x.candidateRuleIds.length === 2, JSON.stringify(x));
    const repeat = new Set(await Promise.all([1, 2, 3].map(async () => (await att('LEC', 'content-c1')).ruleId)));
    ok('resolución determinista en llamadas repetidas', repeat.size === 1);
    x = await att('LEC', 'content-c2');
    ok('LEC/c2: solo la regla de grupo → elegible', x.ruleId === 'r-g1' && x.eligible);
    x = await att('LEC2', 'content-c3');
    ok('LEC2/c3: regla sin clasificar → acceso sí, elegibilidad no', x.ruleId === 'r-lec2' && x.eligible === false && x.reason === 'CLASS_UNCLASSIFIED');
    x = await att('SYN', 'content-c1');
    ok('cuenta sintética con regla pagada → excluida', x.ruleId === 'r-g1' && x.eligible === false && x.reason === 'USER_EXCLUDED');
    x = await att('LEC', 'content-c3');
    ok('regla caducada no se atribuye', x.ruleId === null && x.reason === 'NO_COVERING_RULE');
    x = await att('ADM', 'content-c1');
    ok('administrador sin regla → sin atribución', x.ruleId === null && x.eligible === false);
    await call('PUT', '/api/admin/access/r-g1/commercial-class', 'ADM', { commercialClass: 'courtesy', evidenceRef: 'RECLASIFICADO-FX' });
    x = await att('LEC', 'content-c1');
    ok('reclasificada como cortesía → ya no elegible; gana el piloto por ámbito', x.eligible === false && x.ruleId === 'r-lec-pilot' && x.reason === 'CLASS_PILOT', JSON.stringify(x));
    const hist = JSON.parse(fs.readFileSync(P.access, 'utf8')).find((y) => y.id === 'r-g1').commercialClassHistory;
    ok('el historial conserva la etapa pagada', hist.length === 2 && hist[0].commercialClass === 'paid_institutional' && hist[1].commercialClass === 'courtesy');

    console.log('\n[6] POST /api/access');
    if (!ADMIN_SECRET) {
        console.log('  [SKIP] sin /app/secrets escribible (Linux/contenedor): arrastre y rechazo cubiertos por commercialClass.test.mjs [5]');
        skip++;
    } else {
        const H = { 'x-admin-secret': ADMIN_SECRET };
        r = await call('POST', '/api/access', null, { id: 'r-g1', scope: 'group', scopeId: 'g1', titleIds: ['content-c1'], commercialClass: 'paid_b2c' }, H);
        ok('cuerpo con commercialClass → 400', r.status === 400 && r.body.code === 'commercial_class_readonly');
        r = await call('POST', '/api/access', null, { id: 'r-g1', scope: 'group', scopeId: 'g1', titleIds: ['content-c1', 'content-c2'], collectionIds: [] }, H);
        const after = JSON.parse(fs.readFileSync(P.access, 'utf8')).find((y) => y.id === 'r-g1');
        ok('actualizar la regla conserva clase e historial', r.status === 200 && after.commercialClass === 'courtesy' && after.commercialClassHistory.length === 2);
        r = await call('POST', '/api/access', null, { id: 'r-nueva', scope: 'user', scopeId: 'LEC2', titleIds: ['content-c1'] }, H);
        const nueva = JSON.parse(fs.readFileSync(P.access, 'utf8')).find((y) => y.id === 'r-nueva');
        ok('regla nueva nace sin clase', r.status === 200 && nueva && !('commercialClass' in nueva));
    }

    console.log('\n[7] auditoría y efectos laterales');
    await sleep(500);
    const audit = fs.existsSync(P.audit) ? JSON.parse(fs.readFileSync(P.audit, 'utf8')) : [];
    const sets = audit.filter((e) => e.action === 'access_commercial_class_set');
    ok('3 cambios auditados con origen, destino y soporte', sets.length === 3 && sets.every((e) => e.details?.evidenceRef && e.details?.from && e.details?.to));
    ok('catálogo, usuarios, grupos, progreso y eventos intactos', JSON.stringify(sideEffects()) === JSON.stringify(before), `${JSON.stringify(before)} → ${JSON.stringify(sideEffects())}`);
    ok('los publisherId del catálogo no cambian', JSON.parse(fs.readFileSync(P.content, 'utf8')).every((c) => c.publisherId === PUB));
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    if (child) { child.kill(); for (let i = 0; i < 50 && child.exitCode === null; i++) await sleep(100); }
    fs.rmSync(tmp, { recursive: true, force: true });
    if (ADMIN_SECRET) { try { fs.chmodSync(path.join(SECRET_DIR, 'admin_secret'), 0o600); fs.rmSync(path.join(SECRET_DIR, 'admin_secret')); } catch { /* noop */ } }
}

console.log(`\ncommercialClassHttp — ${pass} ✓, ${fail} ✗${skip ? `, ${skip} SKIP` : ''}`);
process.exit(fail === 0 ? 0 : 1);
