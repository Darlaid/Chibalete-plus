/**
 * mookWorkAccess.test.mjs — CHP-GAMIFICACION-G4-05A-1.
 *
 * Decisión de acceso congelada en la primera entrega, con server.js real por
 * HTTP, usuarios y stores sintéticos:
 *  [1] explícito, denegado, revocado  [2] expiración y revisión tardía
 *  [3] reintentos, ajustes y revisión  [4] dos réplicas concurrentes
 *  [5] falsificación  [6] general, multiobra e histórica  [7] sujetos
 *  [8] fallback abierto e indeterminado  [9] proyecciones y no concesión
 *  [10] sin emisión ni regalías
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/mookWorkAccess.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePorts } from '../../__test__/helpers/freePort.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_access_'));

const Store = await import('../../lib/experienceStore.js');
const W = await import('../mookWorks.mjs');

const SINCE = Date.now() - 3_600_000;
const WORDS = 'una dos tres cuatro cinco seis siete ocho';
const CATALOG = [
    { id: 'obra-a', titulo: 'Obra A', tipo: 'libro', status: 'disponible' },
    { id: 'obra-b', titulo: 'Obra B', tipo: 'libro', status: 'disponible' },
    { id: 'podcast', titulo: 'P', tipo: 'podcast', status: 'disponible' },
    { id: 'procesando', titulo: 'R', tipo: 'libro', status: 'procesando' },
];
const bookExists = (id) => CATALOG.some((c) => c.id === id);
const production = (id, resourceRef) => ({ id, type: 'PRODUCTION', title: id, ...(resourceRef ? { resourceRef } : {}),
    config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } });
const reading = (id, resourceRef) => ({ id, type: 'READING', title: id, resourceRef });

const fixture = Store.emptyMookStore();
function publish(slug, nodes) {
    const exp = Store.createExperience(fixture, { slug, title: slug });
    const v = Store.createDraftVersion(fixture, exp.id, { modules: [{ id: 'm', title: 'M', nodes }] }, bookExists);
    Store.publishVersion(fixture, v.id);
    return exp.id;
}
const ONE = publish('una', [reading('r', 'obra-a'), production('p', 'obra-a')]);
const GENERAL = publish('general', [reading('r', 'obra-a'), production('p')]);
const MULTI = publish('multi', [reading('ra', 'obra-a'), reading('rb', 'obra-b'), production('pa', 'obra-a'), production('pb', 'obra-b')]);
const PODCAST = publish('podcast', [reading('r', 'podcast'), production('p', 'podcast')]);
const PROCESSING = publish('procesando', [reading('r', 'procesando'), production('p', 'procesando')]);
const HISTORIC = publish('historica', [reading('r', 'obra-a'), production('p', 'obra-a')]);
{ // Evidencia anterior a esta unidad: aprobada y sin snapshot.
    const { run } = Store.startRun(fixture, { userId: 'u-hist', experienceId: HISTORIC });
    Store.completeNode(fixture, run.id, 'r');
    const { evidence } = Store.submitEvidence(fixture, { runId: run.id, nodeId: 'p', userId: 'u-hist', payload: { text: WORDS } });
    Store.reviewEvidence(fixture, evidence.id, { reviewerId: 'u-admin', decision: 'aprobado' });
}

const lector = (id, extra = {}) => ({ id, email: `${id}@t.test`, nombre_completo: id, roles: ['lector'], accountStatus: 'active', password: 'x', ...extra });
const USERS = [{ ...lector('u-admin'), roles: ['administrador'] },
    ...['u-ok', 'u-exp', 'u-none', 'u-rev', 'u-late', 'u-forge', 'u-race', 'u-multi', 'u-gen', 'u-hist', 'u-ex', 'u-open', 'u-group', 'u-fail', 'u-otro', 'u-cache', 'u-gain', 'u-pod', 'u-proc', 'u-work', 'u-all', 'u-gr-off'].map((u) => lector(u)),
    lector('u-orgall', { colegio: 'Colegio Todo' }), lector('u-orglist', { colegio: 'Colegio Lista' }),
    lector('u-inactivo', { accountStatus: 'disabled' }), lector('u-sint', { _loadtest_marker: 'lt-1' })];
const rule = (id, scopeId, titleIds, expiresAt = null) => ({ id, scope: 'user', scopeId, titleIds, collectionIds: [], expiresAt });
const RULES = [rule('r-ok', 'u-ok', ['obra-a']), rule('r-none', 'u-none', ['obra-b']), rule('r-rev', 'u-rev', ['obra-a'], Date.now() - 1000),
    rule('r-late', 'u-late', ['obra-a']), rule('r-forge', 'u-forge', ['obra-b']), rule('r-race', 'u-race', ['obra-a']), rule('r-multi', 'u-multi', ['obra-a']),
    rule('r-gen', 'u-gen', ['obra-a']), rule('r-ex', 'u-ex', ['obra-a']), rule('r-sint', 'u-sint', ['obra-a']), rule('r-cache', 'u-cache', ['obra-a']), rule('r-gain', 'u-gain', ['obra-b']),
    rule('r-pod', 'u-pod', ['podcast']), rule('r-proc', 'u-proc', ['procesando']), rule('r-work', 'u-work', ['obra-a'])];

function makeEnv(name, { rules = RULES, groups = [], schools = [] } = {}) {
    const dir = path.join(tmp, name); const data = path.join(dir, 'data'); const sqlite = path.join(dir, 'sqlite');
    fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(path.join(dir, 'uploads')); fs.mkdirSync(sqlite);
    fs.writeFileSync(path.join(data, 'mook_db.json'), JSON.stringify(fixture));
    fs.writeFileSync(path.join(data, 'content.json'), JSON.stringify(CATALOG));
    fs.writeFileSync(path.join(data, 'access_db.json'), JSON.stringify(rules));
    fs.writeFileSync(path.join(data, 'groups_db.json'), JSON.stringify(groups));
    fs.writeFileSync(path.join(data, 'school_configs.json'), JSON.stringify(schools));
    for (const f of ['progress_db.json', 'schools_db.json', 'leo_evidence_db.json']) fs.writeFileSync(path.join(data, f), '[]');
    fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify(USERS));
    return { dir, data, sqlite };
}
const children = [];
async function boot(e, port, mode = 'restricted') {
    const { dir, data, sqlite } = e;
    const db = (n) => path.join(sqlite, n);
    const child = spawn(process.execPath, [path.join(REPO, 'server', 'server.js')], {
        env: { ...process.env, NODE_ENV: 'test', SESSION_AUTH_MODE: 'off', ACCESS_FALLBACK_MODE: mode, PORT: String(port), USERS_DB: path.join(dir, 'users.json'), CHP_DATA_DIR: data,
            UPLOADS_ROOT: path.join(dir, 'uploads'), ACCESS_DB: path.join(data, 'access_db.json'), GAMIFICATION_ENABLED: '', XP_EARNING_ENABLED: '',
            GAMIFICATION_DB: path.join(dir, 'gam', 'gamification.db'), GAMIFICATION_MOOK_SINCE: '', EXPERIENCE_EVENTS_BACKBONE_ENABLED: '',
            EVENTS_SQLITE_PATH: db('events.db'), ARCHIVE_SQLITE_PATH: db('events.archive.db'), INSIGHTS_SQLITE_PATH: db('insights.db'), PROGRESS_SQLITE_PATH: db('progress.db'),
            OFFLINE_ASSIGNMENT_DB_PATH: db('offline.db'), ROYALTIES_DB: db('royalties.db'), IDENTITY_DB: db('identity.db'), SESSIONS_DB: db('sessions.db'),
            GROUPS_DB: path.join(data, 'groups_db.json'), SCHOOLS_DB: path.join(data, 'schools_db.json'), LEO_EVIDENCE_DB: path.join(data, 'leo_evidence_db.json') },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let logs = '';
    child.stdout.on('data', (d) => { logs += d; });
    child.stderr.on('data', (d) => { logs += d; });
    children.push(child);
    const BASE = `http://127.0.0.1:${port}`;
    for (let i = 0; ; i++) {
        try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* arrancando */ }
        if (i > 120) throw new Error(`no arrancó:\n${logs.slice(-1500)}`);
        await sleep(500);
    }
    const call = async (method, url, user, body) => {
        const r = await fetch(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', 'x-user-id': user }, body: body ? JSON.stringify(body) : undefined });
        const text = await r.text();
        let json = null; try { json = JSON.parse(text); } catch { /* no json */ }
        return { status: r.status, body: json, text };
    };
    return { call, logs: () => logs };
}
const store = (e) => JSON.parse(fs.readFileSync(path.join(e.data, 'mook_db.json'), 'utf8'));
const evidenceOf = (e, userId, nodeId = 'p') => store(e).evidence.filter((x) => x.userId === userId && x.nodeId === nodeId);
async function begin(s, e, user, exp, reads = ['r']) {
    await s.call('POST', `/api/experiences/${exp}/run`, user);
    const run = store(e).runs.find((r) => r.userId === user && r.experienceId === exp);
    for (const n of reads) await s.call('POST', `/api/experiences/runs/${run.id}/nodes/${n}/complete`, user);
    return run.id;
}
const deliver = (s, user, runId, node = 'p', extra = {}) => s.call('POST', `/api/experiences/runs/${runId}/nodes/${node}/evidence`, user, { text: WORDS, ...extra });
const approve = (s, id) => s.call('POST', `/api/experiences/review/${id}`, 'u-admin', { decision: 'aprobado', feedback: 'bien' });
const resolve = (doc, ev, isWithdrawn = () => false) => W.resolveEvidenceWork(doc, ev, { isWithdrawn, workRefOf: Store.productionWorkRef, sinceMs: SINCE });
const access = (s, user, id = 'obra-a') => s.call('GET', `/api/content/${id}/access?userId=${user}`, user);

/**
 * Cambia reglas en el access_db temporal. Cada réplica las guarda 30 s en caché,
 * así que los cambios se leen desde una réplica recién arrancada.
 */
function writeRules(e, rules) {
    const f = path.join(e.data, 'access_db.json');
    const ids = new Set(rules.map((r) => r.id));
    fs.writeFileSync(f, JSON.stringify([...JSON.parse(fs.readFileSync(f, 'utf8')).filter((x) => !ids.has(x.id)), ...rules]));
}

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const realFiles = ['data/mook_db.json', 'data/content.json', 'data/access_db.json'].map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f));
const realBefore = realFiles.map(sha);
const realGam = fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db'));

try {
    const [p1, p2, p3, p4, p5] = await freePorts(5);
    const e = makeEnv('main');
    const a = await boot(e, p1);
    const b = await boot(e, p2); // segunda réplica sobre los mismos stores
    let c = null; // réplica posterior a los cambios de reglas
    let expiry = null;
    const royalties = path.join(e.sqlite, 'royalties.db');
    const royaltiesBefore = fs.existsSync(royalties) ? sha(royalties) : null;

    section('[1] explícito, denegado y revocado');
    {
        const run = await begin(a, e, 'u-ok', ONE);
        const r = await deliver(a, 'u-ok', run);
        const [ev] = evidenceOf(e, 'u-ok');
        const w = ev?.workAccess;
        ok('la entrega responde como siempre', r.status === 201 && !r.text.includes('workAccess'), r.text.slice(0, 200));
        ok('explícito: permitido por regla de título', w?.workRef === 'obra-a' && w.decision === 'allowed' && w.via === 'SCOPE_TITLE', JSON.stringify(w));
        ok('solo los cuatro campos', JSON.stringify(Object.keys(w ?? {})) === '["workRef","decision","via","at"]');
        ok('sin identidad en el snapshot', !JSON.stringify(w).includes('u-ok'));
        ok('instante de comprobación anterior a la entrega', Date.parse(w.at) <= Date.parse(ev.submittedAt) + 5);
        await approve(a, ev.id);
        const res = resolve(store(e), evidenceOf(e, 'u-ok')[0]);
        ok('aprobada: se atribuye sin consultar el acceso', res.workRef === 'obra-a', JSON.stringify(res));

        const runN = await begin(a, e, 'u-none', ONE);
        await deliver(a, 'u-none', runN);
        const [en] = evidenceOf(e, 'u-none');
        ok('denegado: la entrega sigue y queda denegada', en?.workAccess.decision === 'denied' && en.workAccess.via === 'SCOPE_ENGINE', JSON.stringify(en?.workAccess));

        const runR = await begin(a, e, 'u-rev', ONE);
        await deliver(a, 'u-rev', runR);
        const [er] = evidenceOf(e, 'u-rev');
        ok('sin regla vigente: denegado', er?.workAccess.decision === 'denied' && er.workAccess.via === 'SCOPE_NO_RULES', JSON.stringify(er?.workAccess));
        const runL = await begin(a, e, 'u-late', ONE);
        await deliver(a, 'u-late', runL);
        const runE = await begin(a, e, 'u-exp', ONE);
        ok('sin regla todavía: denegado hoy', (await access(a, 'u-exp')).status === 403);
        const expiresAt = Date.now() + 20_000;
        writeRules(e, [rule('r-rev', 'u-rev', ['obra-a']), rule('r-late', 'u-late', []), rule('r-none', 'u-none', ['obra-a']), rule('r-exp', 'u-exp', ['obra-a'], expiresAt)]);
        c = await boot(e, p5);
        ok('una réplica nueva ve las reglas cambiadas', (await access(c, 'u-rev')).status === 200 && (await access(c, 'u-late')).status === 403 && (await access(c, 'u-none')).status === 200 && (await access(c, 'u-exp')).status === 200);
        await approve(c, er.id);
        const [er2] = evidenceOf(e, 'u-rev');
        ok('renovar el acceso no recalcula la denegación', er2.workAccess.decision === 'denied' && resolve(store(e), er2).reasons[0] === 'work_not_accessible');
        expiry = { runE, expiresAt };
    }

    section('[2] expiración y revocación posteriores, revisión tardía');
    {
        await deliver(c, 'u-exp', expiry.runE);
        const before = JSON.stringify(evidenceOf(e, 'u-exp')[0].workAccess);
        ok('entregó con el acceso vigente', Date.now() < expiry.expiresAt);
        await sleep(Math.max(0, expiry.expiresAt - Date.now()) + 300);
        const denied = await access(c, 'u-exp');
        ok('el acceso vence: hoy está denegado', denied.status === 403, String(denied.status));
        await approve(c, evidenceOf(e, 'u-exp')[0].id);
        const [ev] = evidenceOf(e, 'u-exp');
        ok('la revisión tardía no cambia la decisión', JSON.stringify(ev.workAccess) === before && ev.workAccess.decision === 'allowed');
        ok('se atribuye por el acceso que tenía al entregar', resolve(store(e), ev).workRef === 'obra-a');

        const snap = JSON.stringify(evidenceOf(e, 'u-late')[0].workAccess);
        ok('la decisión era permitida', evidenceOf(e, 'u-late')[0].workAccess.decision === 'allowed');
        await approve(c, evidenceOf(e, 'u-late')[0].id);
        ok('revocar después tampoco la cambia', JSON.stringify(evidenceOf(e, 'u-late')[0].workAccess) === snap);

        section('[9] proyecciones y no concesión');
        const today = await access(c, 'u-exp');
        ok('el snapshot no concede acceso: /access sigue en 403', today.status === 403 && today.body?.allowed === false);
        ok('la respuesta de /access no expone la procedencia', !('via' in (today.body ?? {})) && !('via' in ((await access(a, 'u-ok')).body ?? {})));
        const route = await c.call('GET', `/api/experiences/${ONE}/route`, 'u-ok');
        const detail = await c.call('GET', `/api/experiences/review/${ev.id}/detail`, 'u-admin');
        const queue = await c.call('GET', '/api/experiences/review/queue', 'u-admin');
        const list = await c.call('GET', '/api/experiences/admin/list', 'u-admin');
        ok('ruta, detalle, cola y autoría no exponen `workAccess`', route.status === 200 && detail.status === 200 && queue.status === 200 && list.status === 200
            && ![route, detail, queue, list].some((x) => x.text.includes('workAccess')));
        const src = fs.readFileSync(path.join(REPO, 'server', 'accessService.js'), 'utf8') + fs.readFileSync(path.join(REPO, 'server', 'server.js'), 'utf8').split('async function decideContentAccess')[1].split('async function checkWorkAccess')[0];
        ok('el motor de acceso no lee `workAccess`', !src.includes('workAccess'));
    }

    section('[3] reintentos, ajustes y revisión');
    {
        const [ev] = evidenceOf(e, 'u-none');
        const before = JSON.stringify(ev.workAccess);
        const run = store(e).runs.find((r) => r.userId === 'u-none');
        const retry = await deliver(c, 'u-none', run.id);
        ok('reintento: misma evidencia, 200', retry.status === 200 && retry.body?.evidenceId === ev.id && evidenceOf(e, 'u-none').length === 1, retry.text.slice(0, 200));
        ok('el reintento con acceso ya concedido no recalcula', JSON.stringify(evidenceOf(e, 'u-none')[0].workAccess) === before);
        const asked = await a.call('POST', `/api/experiences/review/${ev.id}/request-changes`, 'u-admin', { comment: 'ajusta' });
        const again = await a.call('POST', `/api/experiences/evidence/${ev.id}/resubmit`, 'u-none', { text: `${WORDS} nueve` });
        ok('el reenvío tras ajustes funciona', asked.status === 200 && again.status === 200, again.text.slice(0, 200));
        ok('y conserva la decisión de la primera entrega', JSON.stringify(evidenceOf(e, 'u-none')[0].workAccess) === before);
        await approve(a, ev.id);
        const [after] = evidenceOf(e, 'u-none');
        ok('la aprobación tampoco la cambia', JSON.stringify(after.workAccess) === before && resolve(store(e), after).reasons[0] === 'work_not_accessible');
        const first = await a.call('POST', `/api/experiences/runs/${store(e).runs.find((r) => r.userId === 'u-ok').id}/nodes/p/evidence`, 'u-ok', { text: 'corta' });
        ok('entrega repetida tras cerrar: sin cambios', first.status === 200 && evidenceOf(e, 'u-ok').length === 1);
    }

    section('[4] entregas concurrentes en dos réplicas');
    {
        const run = await begin(a, e, 'u-race', ONE);
        const rs = await Promise.all([a, b, a, b, a, b].map((s) => deliver(s, 'u-race', run)));
        const evs = evidenceOf(e, 'u-race');
        ok('una sola evidencia', evs.length === 1, JSON.stringify(rs.map((r) => r.status)));
        ok('una creación y el resto reintentos', rs.filter((r) => r.status === 201).length === 1 && rs.filter((r) => r.status === 200).length === 5, JSON.stringify(rs.map((r) => r.status)));
        ok('todas devuelven la misma evidencia', new Set(rs.map((r) => r.body?.evidenceId)).size === 1);
        ok('el run registra una evidencia', store(e).runs.find((r) => r.id === run).nodeStates.p.evidenceIds.length === 1);
        ok('con su decisión', evs[0]?.workAccess?.decision === 'allowed');

        const doc = Store.emptyMookStore();
        const exp = Store.createExperience(doc, { slug: 's', title: 's' });
        const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [reading('r', 'obra-a'), production('p', 'obra-a')] }] }, bookExists);
        Store.publishVersion(doc, v.id);
        const { run: rr } = Store.startRun(doc, { userId: 'u', experienceId: exp.id });
        Store.completeNode(doc, rr.id, 'r');
        const take = (decision) => Store.submitEvidence(doc, { runId: rr.id, nodeId: 'p', userId: 'u', payload: { text: WORDS }, workAccess: { workRef: 'obra-a', decision, via: 'SCOPE_TITLE', at: 'x' } });
        const won = take('allowed');
        const lost = take('denied');
        ok('decisiones distintas en carrera: la primera escritura gana y la segunda no sobrescribe', won.created && !lost.created && lost.evidence.workAccess.decision === 'allowed');
    }

    section('[4c] caché obsoleta de la réplica');
    {
        const runC = await begin(b, e, 'u-cache', ONE);
        const runG = await begin(b, e, 'u-gain', ONE);
        ok('b tiene las reglas en caché', (await access(b, 'u-cache')).status === 200 && (await access(b, 'u-gain')).status === 403);
        writeRules(e, [rule('r-cache', 'u-cache', []), rule('r-gain', 'u-gain', ['obra-a'])]);
        // API-HARDEN-01: las reglas de acceso se validan contra la huella del archivo; b ya no sirve la regla retirada.
        ok('b aplica el cambio de reglas en la petición siguiente', (await access(b, 'u-cache')).status === 403 && (await access(b, 'u-gain')).status === 200);
        await deliver(b, 'u-cache', runC);
        await deliver(b, 'u-gain', runG);
        ok('revocada: no registra la autorización obsoleta', evidenceOf(e, 'u-cache')[0]?.workAccess.decision === 'denied', JSON.stringify(evidenceOf(e, 'u-cache')[0]?.workAccess));
        ok('concedida: registra la decisión actual', evidenceOf(e, 'u-gain')[0]?.workAccess.decision === 'allowed', JSON.stringify(evidenceOf(e, 'u-gain')[0]?.workAccess));
    }

    section('[4d] obra elegible en la entrega y cambios posteriores');
    {
        const runW = await begin(b, e, 'u-work', ONE);
        await deliver(b, 'u-work', runW);
        await approve(b, evidenceOf(e, 'u-work')[0].id);
        const content = path.join(e.data, 'content.json');
        const original = fs.readFileSync(content);
        fs.writeFileSync(content, JSON.stringify(CATALOG.map((x) => (x.id === 'obra-a' ? { ...x, status: 'procesando', tipo: 'podcast' } : x))));
        const later = await (await boot(e, await (await import('../../__test__/helpers/freePort.mjs')).freePort())).call('GET', '/api/health', 'u-work');
        ok('el catálogo cambió después', later.status === 200);
        const [ev] = evidenceOf(e, 'u-work');
        ok('la decisión de la entrega no cambia', ev.workAccess.decision === 'allowed' && resolve(store(e), ev).workRef === 'obra-a');
        ok('una retirada legal explícita bloquea lo pendiente', resolve(store(e), ev, () => true).reasons[0] === 'work_withdrawn');
        fs.writeFileSync(content, original);
        const runP = await begin(b, e, 'u-pod', PODCAST);
        await deliver(b, 'u-pod', runP);
        const runR = await begin(b, e, 'u-proc', PROCESSING);
        await deliver(b, 'u-proc', runR);
        ok('tipo no clasificado al entregar: queda fijado', evidenceOf(e, 'u-pod')[0]?.workAccess.decision === 'denied' && evidenceOf(e, 'u-pod')[0].workAccess.via === 'WORK_NOT_CLASSIFIED', JSON.stringify(evidenceOf(e, 'u-pod')[0]?.workAccess));
        ok('no disponible al entregar: queda fijado', evidenceOf(e, 'u-proc')[0]?.workAccess.via === 'WORK_UNAVAILABLE', JSON.stringify(evidenceOf(e, 'u-proc')[0]?.workAccess));
    }

    section('[4b] run creado en otra réplica');
    {
        await b.call('GET', `/api/experiences/${ONE}`, 'u-multi'); // b deja MOOK en su caché de 30 s
        const run = await begin(a, e, 'u-multi', ONE);
        const r = await deliver(b, 'u-multi', run);
        ok('la entrega en la otra réplica congela la decisión', r.status === 201 && evidenceOf(e, 'u-multi')[0]?.workAccess?.decision === 'allowed', JSON.stringify(evidenceOf(e, 'u-multi')[0]?.workAccess));
    }

    section('[5] falsificación');
    {
        const run = await begin(a, e, 'u-forge', ONE);
        const forged = { workRef: 'obra-a', decision: 'allowed', via: 'SCOPE_TITLE', at: new Date().toISOString() };
        const other = await deliver(a, 'u-otro', run);
        ok('otro usuario no entrega en un run ajeno', other.status === 403 && evidenceOf(e, 'u-otro').length === 0, String(other.status));
        const r = await deliver(a, 'u-forge', run, 'p', { workAccess: forged, resourceRef: 'obra-b', workRef: 'obra-b', decision: 'allowed', nodeId: 'otro', userId: 'u-ok' });
        const [ev] = evidenceOf(e, 'u-forge');
        ok('`workAccess` del cliente se ignora: decide el servidor', r.status === 201 && ev.workAccess.decision === 'denied' && ev.workAccess.via === 'SCOPE_ENGINE', JSON.stringify(ev?.workAccess));
        ok('el payload solo guarda el texto', JSON.stringify(Object.keys(ev.payload)) === '["text"]' && ev.userId === 'u-forge');
        await approve(a, ev.id);
        ok('sigue sin atribuirse', resolve(store(e), evidenceOf(e, 'u-forge')[0]).reasons[0] === 'work_not_accessible');
        const doc = store(e);
        const realEv = doc.evidence.find((x) => x.userId === 'u-ok');
        ok('snapshot de otra obra en el documento: nada', resolve(doc, { ...realEv, workAccess: { ...realEv.workAccess, workRef: 'obra-b' } }).reasons[0] === 'access_snapshot_mismatch');
        const v = Store.emptyMookStore();
        const x = Store.createExperience(v, { slug: 's', title: 's' });
        const dv = Store.createDraftVersion(v, x.id, { modules: [{ id: 'm', title: 'M', nodes: [reading('r', 'obra-a'), production('p', 'obra-a')] }] }, bookExists);
        Store.publishVersion(v, dv.id);
        const { run: vr } = Store.startRun(v, { userId: 'u', experienceId: x.id });
        Store.completeNode(v, vr.id, 'r');
        const wrong = Store.submitEvidence(v, { runId: vr.id, nodeId: 'p', userId: 'u', payload: { text: WORDS }, workAccess: { ...forged, workRef: 'obra-b', extra: 'x' } });
        ok('el store no sella un snapshot de otra obra', wrong.evidence.workAccess === undefined);
    }

    section('[6] general, multiobra e histórica');
    {
        const run = await begin(a, e, 'u-gen', GENERAL);
        await deliver(a, 'u-gen', run, 'p', { workAccess: { workRef: 'obra-a', decision: 'allowed', via: 'SCOPE_TITLE', at: 'x' } });
        ok('general: sin snapshot, aunque el cliente lo envíe', evidenceOf(e, 'u-gen')[0]?.workAccess === undefined);
        const runM = await begin(a, e, 'u-multi', MULTI, ['ra', 'rb']);
        await deliver(a, 'u-multi', runM, 'pa');
        await deliver(a, 'u-multi', runM, 'pb');
        const [pa] = evidenceOf(e, 'u-multi', 'pa');
        const [pb] = evidenceOf(e, 'u-multi', 'pb');
        ok('multiobra: cada nodo congela su obra', pa?.workAccess.workRef === 'obra-a' && pa.workAccess.decision === 'allowed' && pb?.workAccess.workRef === 'obra-b' && pb.workAccess.decision === 'denied', JSON.stringify([pa?.workAccess, pb?.workAccess]));
        const hist = store(e).evidence.find((x) => x.userId === 'u-hist');
        ok('histórica sin snapshot: sin reconocimiento y sin rellenar', hist.workAccess === undefined && resolve(store(e), hist).reasons[0] === 'no_access_snapshot');
    }

    section('[7] sujetos');
    {
        const run = await a.call('POST', `/api/experiences/${ONE}/run`, 'u-inactivo');
        ok('cuenta inactiva: no llega a entregar', run.status === 401 || run.status === 403, String(run.status));
        const rs = await begin(a, e, 'u-sint', ONE);
        await deliver(a, 'u-sint', rs);
        const rx = await begin(a, e, 'u-ex', ONE);
        await deliver(a, 'u-ex', rx);
        await approve(a, evidenceOf(e, 'u-sint')[0].id);
        await approve(a, evidenceOf(e, 'u-ex')[0].id);
        const byId = new Map(USERS.map((u) => [u.id, { exists: true, active: u.accountStatus === 'active', synthetic: !!u._loadtest_marker }]));
        const r = W.mookRecognitionEvidence(store(e), { isWithdrawn: () => false, workRefOf: Store.productionWorkRef, resolveUser: (id) => byId.get(id) ?? null, gate: { excludes: (id) => id === 'u-ex' }, sinceMs: SINCE });
        ok('sintético y excluido no pasan aunque el snapshot permita', !r.evidence.some((x) => ['u-sint', 'u-ex'].includes(x.userId)) && r.unattributed.subject_not_eligible >= 1 && r.unattributed.subject_excluded === 1, JSON.stringify(r.unattributed));
        ok('sin identidad en los recuentos', !JSON.stringify(r.unattributed).includes('u-'));
    }

    section('[10] sin emisión ni regalías');
    ok('sin gamification.db', !fs.existsSync(path.join(e.dir, 'gam', 'gamification.db')));
    ok('regalías sin cambios', fs.existsSync(royalties) ? royaltiesBefore === sha(royalties) : royaltiesBefore === null);

    section('[8] fallback abierto e indeterminado');
    {
        const GROUPS = [{ id: 'g1', nombre: 'G', type: 'course', studentIds: ['u-group'], memberIds: ['u-group'], mediatorIds: [], availableContentIds: ['obra-a'] },
            { id: 'g2', nombre: 'T', type: 'course', studentIds: ['u-all'], memberIds: ['u-all'], mediatorIds: [], availableContentIds: 'all' },
            { id: 'g3', nombre: 'V', type: 'course', studentIds: ['u-gr-off'], memberIds: ['u-gr-off'], mediatorIds: [], availableContentIds: 'all', accessEndsAt: '2020-01-01T00:00:00.000Z' }];
        const SCHOOLS = [{ schoolName: 'Colegio Todo', availableContentIds: 'all' }, { schoolName: 'Colegio Lista', availableContentIds: ['obra-a'] }];
        const oe = makeEnv('open', { rules: [], groups: GROUPS, schools: SCHOOLS });
        const open = await boot(oe, p3, 'open');
        const run = await begin(open, oe, 'u-open', ONE);
        await deliver(open, 'u-open', run);
        const [ev] = evidenceOf(oe, 'u-open');
        ok('fallback abierto: permitido, procedencia legacy', ev?.workAccess.decision === 'allowed' && ev.workAccess.via === 'LEGACY_OPEN', JSON.stringify(ev?.workAccess));
        await approve(open, ev.id);
        ok('no es elegible', resolve(store(oe), evidenceOf(oe, 'u-open')[0]).reasons[0] === 'access_not_explicit');
        const runG = await begin(open, oe, 'u-group', ONE);
        await deliver(open, 'u-group', runG);
        const [eg] = evidenceOf(oe, 'u-group');
        ok('catálogo explícito de grupo: elegible', eg?.workAccess.via === 'GROUP_CATALOG' && W.EXPLICIT_ACCESS_VIAS.includes('GROUP_CATALOG'), JSON.stringify(eg?.workAccess));
        const viaOf = async (user) => { const r = await begin(open, oe, user, ONE); await deliver(open, user, r); return evidenceOf(oe, user)[0]?.workAccess; };
        const all = await viaOf('u-all');
        ok('GROUP_ALL: concesión explícita vigente, elegible', all?.decision === 'allowed' && all.via === 'GROUP_ALL' && W.EXPLICIT_ACCESS_VIAS.includes('GROUP_ALL'), JSON.stringify(all));
        const off = await viaOf('u-gr-off');
        ok('GROUP_ALL vencido: cae al fallback y no es elegible', off?.via === 'LEGACY_OPEN' && !W.EXPLICIT_ACCESS_VIAS.includes(off.via), JSON.stringify(off));
        const orgAll = await viaOf('u-orgall');
        const orgList = await viaOf('u-orglist');
        ok('ORG_ALL: por texto del colegio, no elegible', orgAll?.via === 'ORG_ALL' && !W.EXPLICIT_ACCESS_VIAS.includes('ORG_ALL'), JSON.stringify(orgAll));
        ok('catálogo de organización: no se confunde con grupo', orgList?.via === 'ORG_CATALOG' && !W.EXPLICIT_ACCESS_VIAS.includes('ORG_CATALOG'), JSON.stringify(orgList));
        const re = makeEnv('restr', { rules: [], groups: GROUPS, schools: SCHOOLS });
        const restr = await boot(re, await (await import('../../__test__/helpers/freePort.mjs')).freePort());
        const rg = await begin(restr, re, 'u-all', ONE);
        await deliver(restr, 'u-all', rg);
        ok('en restricted, GROUP_ALL no se alcanza: denegado', evidenceOf(re, 'u-all')[0]?.workAccess.via === 'SCOPE_NO_RULES', JSON.stringify(evidenceOf(re, 'u-all')[0]?.workAccess));

        const be = makeEnv('broken', { rules: {} }); // access_db ilegible para el motor
        const broken = await boot(be, p4);
        const runF = await begin(broken, be, 'u-fail', ONE);
        const r = await deliver(broken, 'u-fail', runF);
        const [ef] = evidenceOf(be, 'u-fail');
        ok('un fallo de acceso no impide entregar', r.status === 201, r.text.slice(0, 200));
        ok('indeterminado', ef?.workAccess.decision === 'indeterminate' && ef.workAccess.via === 'INDETERMINATE', JSON.stringify(ef?.workAccess));
        await approve(broken, ef.id);
        ok('sigue indeterminado tras revisar y sin atribuirse', evidenceOf(be, 'u-fail')[0].workAccess.decision === 'indeterminate' && resolve(store(be), evidenceOf(be, 'u-fail')[0]).reasons[0] === 'access_indeterminate');
        ok('mapeo: decisión ilegible o sin procedencia es indeterminada', Store.buildWorkAccess('x', null).decision === 'indeterminate' && Store.buildWorkAccess('x', { status: 200, body: { allowed: true } }).decision === 'indeterminate'
            && Store.buildWorkAccess('x', { status: 500, via: 'ACCESS_CHECK_FAILED', body: { allowed: false } }).decision === 'indeterminate');
    }

    section('[aislamiento]');
    ok('stores reales intactos', realFiles.map(sha).join() === realBefore.join());
    ok('sin gamification.db real', fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db')) === realGam);
} catch (e) {
    fail++;
    console.error('  ✗ excepción', e);
} finally {
    for (const c of children) { c.kill(); }
    await Promise.all(children.map((c) => (c.exitCode === null && c.signalCode === null ? new Promise((r) => c.on('close', r)) : null)));
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`\nmookWorkAccess: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
