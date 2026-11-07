/**
 * myProgress.test.mjs — CHP-GAMIFICACION-G4-UX-U2.
 *
 * `readMyProgress` (mookSource) y `readWorkProgress` (progress) con el store MOOK
 * real, el escritor real (`recognizeMookWorks`) y la regla del piloto 10/20/50,
 * sobre bases temporales y usuarios sintéticos:
 *  [1] flags: sin gamificación ⇒ 404; sin XP ⇒ { enabled: false }
 *  [2] sin actividad: Semilla, 0 XP, disponibilidad desde el catálogo propio
 *  [3] estados de obra: empezada, en revisión, con ajustes, aprobada pendiente,
 *      reconocida (30), completa (50), aprobada sin XP (tercera, anterior al
 *      corte), cerrada con comentarios
 *  [4] logros y nivel: Brote con 30, «Mirada profunda» con 50
 *  [5] catálogo sin actividades elegibles (sin acceso / sin regla de reconocimiento)
 *  [6] exclusión: idéntica a cero actividad; registro incompleto ⇒ error
 *  [7] aislamiento entre lectores e instituciones
 *  [8] lecturas repetidas sin escrituras (base, WAL, MOOK)
 *  [9] privacidad del JSON y errores sin filtración
 * Libera `mook_review` solo en este proceso. Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/myProgress.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/xpRecognitionHarness.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const rejectsCode = async (p, code) => { try { await p; return false; } catch (e) { return e.code === code; } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_myprogress_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');

const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const E = await import('../erasure.mjs');
const P = await import('../progress.mjs');

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const realFiles = ['data/mook_db.json', 'data/content.json'].map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f));
const realBefore = realFiles.map(sha);
const realGam = fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db'));

/** A7-A12-V3 §1 (sintético): lectura 10, reflexión 20, techo 50 por obra y ciclo. */
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [] } };
const SINCE = Date.now() - 60_000;
const WORDS = 'una dos tres cuatro cinco seis';
const prodCfg = { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 };

// ── Catálogo sintético ───────────────────────────────────────────────────────
// E1: obra-a con dos producciones · E2: obra-b · E3: obra-c (sin acceso para nadie)
// E4: obra-a otra vez (tercera producción de la misma obra) · E5: obra-d, versión anterior al corte
function buildCatalog() {
    const doc = Store.emptyMookStore();
    const mk = (slug, work, prods) => {
        const exp = Store.createExperience(doc, { slug, title: slug });
        const nodes = [{ id: 'r', type: 'READING', title: 'r', resourceRef: work },
            ...prods.map((id) => ({ id, type: 'PRODUCTION', title: id, resourceRef: work, config: prodCfg }))];
        const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes }] }, () => true);
        Store.publishVersion(doc, v.id);
        return { id: exp.id, versionId: v.id, work };
    };
    const ex = { E1: mk('e1', 'obra-a', ['p1', 'p2']), E2: mk('e2', 'obra-b', ['p']), E3: mk('e3', 'obra-c', ['p']),
        E4: mk('e4', 'obra-a', ['p']), E5: mk('e5', 'obra-d', ['p']) };
    doc.versions.find((v) => v.id === ex.E5.versionId).publishedAt = new Date(SINCE - 86_400_000).toISOString();
    return { doc, ex };
}
const access = (work) => ({ workRef: work, decision: 'allowed', via: 'SCOPE_TITLE', at: new Date().toISOString() });
const begin = (doc, userId, e) => { const { run } = Store.startRun(doc, { userId, experienceId: e.id }); Store.completeNode(doc, run.id, 'r'); return run; };
const deliver = (doc, userId, run, nodeId, work) =>
    Store.submitEvidence(doc, { runId: run.id, nodeId, userId, payload: { text: WORDS }, workAccess: access(work) }).evidence;
const approve = (doc, ev, decision = 'aprobado') => Store.reviewEvidence(doc, ev.id, { reviewerId: 'u-med', decision });

const USERS = ['u-new', 'u-started', 'u-review', 'u-adjust', 'u-pending', 'u-30', 'u-50', 'u-old', 'u-comments', 'u-excl', 'u-other-inst', 'u-med']
    .map((id) => ({ id, accountStatus: 'active' }));
const isUserActive = (u) => !u.accountStatus || u.accountStatus === 'active';
const isSyntheticUser = () => false;

let n = 0;
function freshDb({ recognition = PILOT } = {}) {
    n += 1;
    const dir = path.join(tmp, `g${n}`);
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true }); fs.mkdirSync(path.join(dir, 'reg'));
    const reg = path.join(dir, 'reg', 'r.jsonl'); fs.writeFileSync(reg, '');
    const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: path.join(dir, 'db', 'gamification.db'),
        GAMIFICATION_EXCLUSION_REGISTRY: reg, GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString() };
    process.env.GAMIFICATION_DB = env.GAMIFICATION_DB; process.env.GAMIFICATION_EXCLUSION_REGISTRY = reg;
    D.closeGamificationDb({ resetBackoff: true });
    const db = D.getGamificationDb({ env });
    L.createRuleSet(db, { ruleVersion: 'gm-u2-v1', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000,
        rules: { schema: 1, facts: {}, ...(recognition ? { recognition } : {}) } });
    return { db, env, dir, reg };
}

/** Dependencias como las inyecta server.js; `denied` = obras sin acceso para esa persona. */
const depsFor = (doc, env, { denied = ['obra-c'] } = {}) => ({
    env, readMook: () => doc, workRefOf: Store.productionWorkRef, readRights: () => () => false,
    readUsers: () => USERS, isUserActive, isSyntheticUser,
    titleOf: (id) => `Título ${id}`,
    workAccessOf: async (w) => (denied.includes(w) ? { workRef: w, decision: 'denied', via: 'NO_RULE' } : access(w)),
});
const sweep = (db, doc, env) => M.recognizeMookWorks(db, doc, { workRefOf: Store.productionWorkRef, readRights: () => () => false,
    resolveUser: M.makeResolveUser(USERS, isUserActive, isSyntheticUser), sinceMs: SINCE, env });
const workOf = (out, id) => out.works.find((w) => w.contentId === id);

try {
    const { doc, ex } = buildCatalog();
    const { env, dir, reg } = freshDb();
    let db = D.getGamificationDb({ env });
    const reopen = () => { D.closeGamificationDb({ resetBackoff: true }); process.env.GAMIFICATION_DB = env.GAMIFICATION_DB; process.env.GAMIFICATION_EXCLUSION_REGISTRY = reg; db = D.getGamificationDb({ env }); };

    section('[1] flags');
    {
        const off = await M.readMyProgress('u-new', depsFor(doc, { ...env, GAMIFICATION_ENABLED: '' }));
        ok('sin GAMIFICATION_ENABLED ⇒ { status: 404 } y nada más', JSON.stringify(off) === '{"status":404}');
        const xpOff = await M.readMyProgress('u-new', depsFor(doc, { ...env, XP_EARNING_ENABLED: '' }));
        ok('sin XP_EARNING_ENABLED ⇒ { enabled: false } y nada más', JSON.stringify(xpOff) === '{"enabled":false}');
        const pmOnly = await M.readMyProgress('u-new', depsFor(doc, { ...env, XP_EARNING_ENABLED: '' }));
        ok('PM encendido no habilita el progreso', JSON.stringify(pmOnly) === '{"enabled":false}');
    }

    section('[2] sin actividad');
    const fresh = await M.readMyProgress('u-new', depsFor(doc, env));
    ok('enabled, 0 XP, Semilla', fresh.enabled === true && fresh.xp === 0 && fresh.level.id === 'semilla' && fresh.level.index === 0);
    ok('siguiente nivel Brote (30 XP, 1 obra)', fresh.level.next?.id === 'brote' && fresh.level.next.xpTarget === 30);
    ok('sin obras listadas', Array.isArray(fresh.works) && fresh.works.length === 0);
    ok('disponibilidad: obra-a y obra-b (obra-c sin acceso, obra-d anterior al corte)', fresh.availability.works === 2, JSON.stringify(fresh.availability));
    ok('actividades disponibles: E1×2 + E2 + E4 = 4', fresh.availability.activities === 4);
    ok('ningún logro obtenido; siguiente alcanzable = primera-obra', fresh.achievements.earned.length === 0 && fresh.achievements.next?.id === 'primera-obra');
    ok('los tramos superiores no se activan', !JSON.stringify(fresh).includes('raiz') && !JSON.stringify(fresh).includes('arbol'));

    section('[3] estados de obra');
    // empezada
    begin(doc, 'u-started', ex.E2);
    // en revisión
    const evReview = deliver(doc, 'u-review', begin(doc, 'u-review', ex.E2), 'p', 'obra-b');
    // con ajustes
    const evAdjust = deliver(doc, 'u-adjust', begin(doc, 'u-adjust', ex.E2), 'p', 'obra-b');
    Store.requestChanges(doc, evAdjust.id, { reviewerId: 'u-med', comment: 'amplía' });
    // aprobada pendiente de reconocimiento (sin barrido)
    approve(doc, deliver(doc, 'u-pending', begin(doc, 'u-pending', ex.E2), 'p', 'obra-b'));
    // reconocida 30
    const run30 = begin(doc, 'u-30', ex.E1);
    approve(doc, deliver(doc, 'u-30', run30, 'p1', 'obra-a'));
    // completa 50 + tercera producción de la misma obra (aprobada sin XP)
    const run50 = begin(doc, 'u-50', ex.E1);
    approve(doc, deliver(doc, 'u-50', run50, 'p1', 'obra-a'));
    approve(doc, deliver(doc, 'u-50', run50, 'p2', 'obra-a'));
    const third = deliver(doc, 'u-50', begin(doc, 'u-50', ex.E4), 'p', 'obra-a');
    approve(doc, third);
    // versión anterior al corte
    approve(doc, deliver(doc, 'u-old', begin(doc, 'u-old', ex.E5), 'p', 'obra-d'));
    // cerrada «con comentarios»
    approve(doc, deliver(doc, 'u-comments', begin(doc, 'u-comments', ex.E2), 'p', 'obra-b'), 'con_comentarios');
    // barrido real, sin u-pending (su evidencia aún no se ha barrido)
    const pendingEv = doc.evidence.find((e) => e.userId === 'u-pending');
    const swept = sweep(db, { ...doc, evidence: doc.evidence.filter((e) => e !== pendingEv) }, env);
    ok('el barrido real reconoce u-30 (1) y u-50 (2)', swept.recognized === 3, JSON.stringify(swept));
    ok('la tercera evidencia de u-50 no deja hecho', db.prepare('SELECT COUNT(*) c FROM gm_source_facts').get().c === 3);

    const R = {};
    for (const u of ['u-started', 'u-review', 'u-adjust', 'u-pending', 'u-30', 'u-50', 'u-old', 'u-comments']) R[u] = await M.readMyProgress(u, depsFor(doc, env));
    ok('empezada: run sin entrega', workOf(R['u-started'], 'obra-b')?.state === 'started' && R['u-started'].xp === 0);
    ok('en revisión: SUBMITTED', workOf(R['u-review'], 'obra-b')?.state === 'in_review' && evReview.review.status === 'SUBMITTED');
    ok('con ajustes: REVISION_REQUESTED', workOf(R['u-adjust'], 'obra-b')?.state === 'revision_requested');
    Store.resubmitEvidence(doc, evAdjust.id, { userId: 'u-adjust', text: WORDS });
    ok('reenviada: vuelve a en revisión', workOf(await M.readMyProgress('u-adjust', depsFor(doc, env)), 'obra-b')?.state === 'in_review');
    ok('aprobada pendiente: estado pending_recognition y 0 XP (aprobación ≠ XP)', workOf(R['u-pending'], 'obra-b')?.state === 'pending_recognition'
        && R['u-pending'].xp === 0 && workOf(R['u-pending'], 'obra-b').xp === 0 && R['u-pending'].level.id === 'semilla');
    const w30 = workOf(R['u-30'], 'obra-a');
    ok('reconocida: 30 de 50, 1 reflexión', w30?.state === 'recognized' && w30.xp === 30 && w30.ceiling === 50 && w30.reflections === 1, JSON.stringify(w30));
    const w50 = workOf(R['u-50'], 'obra-a');
    ok('completa: 50 de 50, 2 reflexiones (la tercera no la reabre)', w50?.state === 'complete' && w50.xp === 50 && w50.reflections === 2, JSON.stringify(w50));
    ok('aprobada sin XP: versión anterior al corte', workOf(R['u-old'], 'obra-d')?.state === 'approved_no_xp' && R['u-old'].xp === 0);
    ok('cerrada con comentarios: reviewed, nunca approved', workOf(R['u-comments'], 'obra-b')?.state === 'reviewed');
    ok('título y experiencia de la obra propia', w30.title === 'Título obra-a' && w30.experienceId === ex.E1.id);
    // tercera evidencia aislada: sin el resto, la obra ya completa la deja sin XP
    {
        const onlyThird = { ...doc, evidence: doc.evidence.filter((e) => e.userId !== 'u-50' || e.id === third.id) };
        const r = await M.readMyProgress('u-50', depsFor(onlyThird, env));
        ok('tercera evidencia sobre obra completa: approved_no_xp, no pending', workOf(r, 'obra-a')?.state === 'approved_no_xp'
            && !JSON.stringify(r).includes('pending_recognition'));
    }
    {
        // Pendiente que el barrido no registraría: aprobada sin regla de reconocimiento.
        const g = freshDb({ recognition: null });
        const r = await M.readMyProgress('u-pending', depsFor(doc, g.env));
        ok('sin regla de reconocimiento: aprobada ⇒ approved_no_xp (nunca «en camino»)', workOf(r, 'obra-b')?.state === 'approved_no_xp');
        ok('sin regla: catálogo sin actividades elegibles', r.availability.works === 0 && r.availability.activities === 0 && r.achievements.next === null);
        reopen();
    }

    section('[4] nivel y logros');
    ok('XP 30 ⇒ Brote, «primera-obra»', R['u-30'].xp === 30 && R['u-30'].level.id === 'brote' && R['u-30'].achievements.earned.join() === 'primera-obra');
    ok('XP 50 ⇒ Brote, deepWorks 1, «primera-obra» + «mirada-profunda»', R['u-50'].xp === 50 && R['u-50'].stats.deepWorks === 1
        && R['u-50'].achievements.earned.join() === 'primera-obra,mirada-profunda', JSON.stringify(R['u-50'].achievements));
    ok('Brote es el último tramo activo: sin siguiente nivel', R['u-50'].level.next === null);
    ok('con 30 XP el siguiente logro alcanzable sale del catálogo (mirada-profunda: falta 1)', R['u-30'].achievements.next?.id === 'mirada-profunda'
        && R['u-30'].achievements.next.missing === 1, JSON.stringify(R['u-30'].achievements));
    ok('disponibilidad descuenta lo entregado: u-50 tiene E2 libre', R['u-50'].availability.activities === 1 && R['u-50'].availability.works === 2);

    section('[4b] historial de reconocimiento (V8-INTEGRATION-01)');
    {
        const today = new Date().toISOString().slice(0, 10);
        const h30 = R['u-30'].history, h50 = R['u-50'].history;
        ok('30 XP ⇒ lectura 10 y reflexión 20, en ese orden', h30.length === 2 && h30[0].act === 'reading' && h30[0].xp === 10
            && h30[1].act === 'reflection' && h30[1].xp === 20, JSON.stringify(h30));
        ok('50 XP ⇒ tres entradas que suman el XP total', h50.length === 3 && h50.reduce((s, e) => s + e.xp, 0) === R['u-50'].xp, JSON.stringify(h50));
        ok('cada entrada: día del hecho, obra y título conocidos', h50.every((e) => e.day === today && e.contentId === 'obra-a' && e.title === 'Título obra-a'));
        ok('la tercera evidencia (sin XP) no aparece', h50.filter((e) => e.act === 'reflection').length === 2);
        ok('sin reconocimiento: historial vacío', ['u-started', 'u-review', 'u-adjust', 'u-pending', 'u-old', 'u-comments'].every((u) => R[u].history.length === 0));
        ok('solo claves visibles', [...h30, ...h50].every((e) => Object.keys(e).sort().join() === 'act,contentId,day,title,xp'));
        ok('límite del historial', P.HISTORY_LIMIT === 50);
    }

    section('[4c] instantánea única: un reconocimiento a mitad de la lectura (V8-INTEGRATION-02A)');
    {
        // Intercalación determinista: la primera consulta de retirada DENTRO de la
        // lectura ejecuta el barrido real con la conexión escritora (otra réplica).
        const g = freshDb();
        const coherent = (r) => r.xp === r.history.reduce((s, e) => s + e.xp, 0) && r.xp === r.works.reduce((s, w) => s + w.xp, 0);
        let fired = false, during = null;
        // `isWithdrawn` (lo devuelve readRights) se consulta dentro de readWorkProgress,
        // entre la búsqueda del sujeto y el total de XP: ahí se confirma el reconocimiento.
        const racing = () => () => {
            if (!fired) {
                fired = true;
                during = sweep(g.db, doc, g.env);
            }
            return false;
        };
        const r = await M.readMyProgress('u-pending', { ...depsFor(doc, g.env), readRights: racing });
        ok('el barrido se ejecutó a mitad de la lectura', fired && during?.recognized >= 1, JSON.stringify(during));
        ok('la respuesta es coherente (XP = historial = obras)', coherent(r), JSON.stringify({ xp: r.xp, works: r.works, history: r.history }));
        ok('y refleja el estado previo: 0 XP y pendiente', r.xp === 0 && workOf(r, 'obra-b')?.state === 'pending_recognition');
        const after = await M.readMyProgress('u-pending', depsFor(doc, g.env));
        ok('la lectura siguiente ve el reconocimiento completo', after.xp === 30 && workOf(after, 'obra-b')?.state === 'recognized' && after.history.length === 2 && coherent(after));
        reopen();
    }

    section('[5] catálogo sin actividades elegibles');
    {
        const r = await M.readMyProgress('u-new', depsFor(doc, env, { denied: ['obra-a', 'obra-b', 'obra-c', 'obra-d'] }));
        ok('sin acceso a ninguna obra: 0 obras y 0 actividades', r.availability.works === 0 && r.availability.activities === 0);
        ok('sin capacidad no hay logro alcanzable', r.achievements.next === null && r.achievements.earned.length === 0);
        const failing = await M.readMyProgress('u-new', { ...depsFor(doc, env), workAccessOf: async () => { throw new Error('acceso caído'); } });
        ok('acceso que falla = no elegible (fallo cerrado)', failing.availability.works === 0);
        const withdrawn = await M.readMyProgress('u-new', { ...depsFor(doc, env), readRights: () => (w) => w === 'obra-a' });
        ok('retirada legal: la obra deja de contar', withdrawn.availability.works === 1 && withdrawn.availability.activities === 1);
    }

    section('[6] exclusión');
    {
        const runX = begin(doc, 'u-excl', ex.E1);
        approve(doc, deliver(doc, 'u-excl', runX, 'p1', 'obra-a'));
        sweep(db, doc, env);
        const before = await M.readMyProgress('u-excl', depsFor(doc, env));
        ok('antes de excluir: 30 XP y su obra', before.xp === 30 && before.works.length === 1);
        E.excludeUser(db, { userId: 'u-excl', env });
        const after = await M.readMyProgress('u-excl', depsFor(doc, env));
        const zero = await M.readMyProgress('u-new', depsFor(doc, env));
        ok('excluida: respuesta idéntica a la de alguien sin actividad', JSON.stringify(after) === JSON.stringify(zero), JSON.stringify(after));
        // exclusión incompleta: registro con una línea a medias
        const raw = fs.readFileSync(reg, 'utf8');
        fs.writeFileSync(reg, raw + '{"id":"x","t":"abc"');
        ok('registro incompleto ⇒ error, nunca 0 XP', await rejectsCode(M.readMyProgress('u-30', depsFor(doc, env)), 'EXCLUSION_REGISTRY_UNAVAILABLE'));
        fs.writeFileSync(reg, raw);
        // exclusión en el registro sin aplicar en la base (restauración a medias)
        const g = freshDb();
        fs.writeFileSync(g.reg, raw);
        ok('registro con exclusión no aplicada ⇒ error', await rejectsCode(M.readMyProgress('u-30', depsFor(doc, g.env)), 'EXCLUSION_REPLAY_REQUIRED'));
        reopen();
    }

    section('[7] aislamiento');
    {
        ok('dos lectores con la misma obra: cada uno su XP', R['u-30'].xp === 30 && R['u-50'].xp === 50 && workOf(R['u-30'], 'obra-a').xp === 30);
        ok('u-30 no ve las entregas de u-50 (E4 no aparece como suya)', R['u-30'].works.length === 1 && R['u-30'].works[0].experienceId === ex.E1.id);
        const inst = await M.readMyProgress('u-other-inst', depsFor(doc, env, { denied: ['obra-a', 'obra-b', 'obra-c'] }));
        ok('otra institución sin acceso: nada propio y nada ajeno', inst.xp === 0 && inst.works.length === 0 && inst.availability.works === 0);
        ok('un id inexistente no hereda datos de nadie', (await M.readMyProgress('u-nadie', depsFor(doc, env))).xp === 0);
    }

    section('[8] lecturas repetidas sin escrituras');
    {
        // Con escritor vivo (como una réplica en producción): `-wal`/`-shm` ya existen.
        // `-shm` es el índice en memoria compartida de SQLite (marcas de lectura): no se compara.
        reopen();
        db.pragma('wal_checkpoint(TRUNCATE)');
        const dbDir = path.join(dir, 'db');
        const dbFile = path.join(dbDir, 'gamification.db');
        const names0 = fs.readdirSync(dbDir).sort().join();
        const state = () => [dbFile, `${dbFile}-wal`].map((f) => `${path.basename(f)}:${sha(f)}`).join();
        const h0 = state();
        const docBefore = JSON.stringify(doc);
        const outs = [];
        for (let i = 0; i < 5; i++) outs.push(JSON.stringify(await M.readMyProgress('u-50', depsFor(doc, env))));
        ok('cinco lecturas idénticas', new Set(outs).size === 1);
        ok('base y WAL sin cambios', state() === h0, `${h0} → ${state()}`);
        ok('documento MOOK sin cambios', JSON.stringify(doc) === docBefore);
        ok('ningún archivo nuevo junto a la base (ni lock de barrido)', fs.readdirSync(dbDir).sort().join() === names0, fs.readdirSync(dbDir).join());
        // Sin escritor vivo: no se abre la base; nada se crea junto al store.
        D.closeGamificationDb({ resetBackoff: true });
        const cold = fs.readdirSync(dbDir).sort().join();
        ok('sin escritor vivo, solo queda la base (SQLite borró -wal/-shm al cerrar)', cold === 'gamification.db', cold);
        const coldHash = sha(dbFile);
        ok('sin escritor vivo ⇒ GAMIFICATION_DB_NOT_LIVE (el servidor responde 503)',
            await rejectsCode(M.readMyProgress('u-50', depsFor(doc, env)), 'GAMIFICATION_DB_NOT_LIVE'));
        ok('sin escritor vivo: no se crean -wal/-shm ni cambia la base', fs.readdirSync(dbDir).sort().join() === cold && sha(dbFile) === coldHash, fs.readdirSync(dbDir).join());
        reopen();
        const src = fs.readFileSync(path.join(HERE, '..', 'mookSource.mjs'), 'utf8').replace(/\r\n/g, '\n');
        const fn = src.match(/export async function readMyProgress[\s\S]*?\n}\n/)?.[0] ?? '';
        ok('readMyProgress abre readonly + query_only y no migra', /readonly: true, fileMustExist: true/.test(fn) && /query_only = ON/.test(fn)
            && !/getGamificationDb|recordWorkRecognition|recordFact|scheduleFact|ensureSubject|\.immediate\(|\.exclusive\(/.test(fn)
            // V8-INTEGRATION-02A: la única transacción es la de lectura (instantánea WAL) alrededor de readWorkProgress.
            && (fn.match(/transaction/g) ?? []).length === 1 && /db\.transaction\(\(\) => readWorkProgress\(/.test(fn));
        const core = fs.readFileSync(path.join(HERE, '..', 'progress.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        ok('progress.mjs sin escrituras SQL', !/\b(INSERT|UPDATE|DELETE|REPLACE)\b\s|\.transaction\(|ensureSubject|recordWorkRecognition|recordFact/.test(core));
    }

    section('[9] privacidad y errores');
    {
        const all = JSON.stringify(Object.values(R));
        ok('sin subject_ref, work_key, fact_id ni source_event_id', !/subject|work_key|workKey|fact|source_event|tombstone/i.test(all));
        ok('sin claves hex de 64', !/[0-9a-f]{64}/.test(all));
        ok('sin ids de evidencias, runs ni revisores', !/evid-|run-|u-med|reviewer/.test(all));
        ok('sin motivos ni decisiones internas', !/reason|rejected|excluded|withdrawn|predates|locked|disabled|PM|pm"/i.test(all));
        const keys = new Set();
        const walk = (o) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { keys.add(k); walk(v); } };
        Object.values(R).forEach(walk);
        ok('solo claves del contrato', [...keys].every((k) => /^\d+$/.test(k) || ['enabled', 'xp', 'level', 'id', 'index', 'next', 'xpTarget', 'missing', 'works', 'reflections',
            'stats', 'deepWorks', 'achievements', 'earned', 'metric', 'availability', 'activities', 'contentId', 'title', 'experienceId', 'state', 'ceiling',
            'history', 'day', 'act'].includes(k)),
            [...keys].join());
        ok('estados dentro del contrato', Object.values(R).every((r) => r.works.every((w) => P.WORK_STATES.includes(w.state))));
        const g = { ...env, GAMIFICATION_DB: path.join(tmp, 'no-existe', 'gamification.db') };
        let err = null;
        try { await M.readMyProgress('u-30', depsFor(doc, g)); } catch (e) { err = e; }
        ok('base ausente ⇒ lanza (el servidor responde 503), nunca crea la base', !!err && !fs.existsSync(g.GAMIFICATION_DB));
    }
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    D.closeGamificationDb({ resetBackoff: true });
    ok('data/ intacto', realFiles.map(sha).join() === realBefore.join());
    ok('sin gamification.db real', fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db')) === realGam);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nmy progress (G4-UX-U2): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
