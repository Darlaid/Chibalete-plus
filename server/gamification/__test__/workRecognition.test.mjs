/**
 * workRecognition.test.mjs — CHP-GAMIFICACION-G4-05A-3.
 *
 * Registro por obra y ciclo, con store MOOK real, derechos reales de solo lectura
 * y bases temporales:
 *  [1] fuente de derechos  [2] estados legales  [3] evidencia y corte
 *  [4] actos, ciclo e idempotencia  [5] dos procesos  [6] reinicio y restauración
 *  [7] sujetos  [8] flags, intake y bloqueos  [9] server.js real
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/workRecognition.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { freePort } from '../../__test__/helpers/freePort.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_recog_'));
const ROY = path.join(tmp, 'roy', 'royalties.db');
fs.mkdirSync(path.dirname(ROY));
process.env.ROYALTIES_DB = ROY;

const Store = await import('../../lib/experienceStore.js');
const Rights = await import('../../royalties/rightsStore.mjs');
const Pub = await import('../../royalties/publishersStore.mjs');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const I = await import('../intake.mjs');
const E = await import('../erasure.mjs');
const S = await import('../subjects.mjs');

const SINCE = Date.now() - 60_000;
const WORDS = 'una dos tres cuatro cinco seis siete ocho';
const NOW = Date.now();
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const bookExists = () => true;
const production = (id, resourceRef) => ({ id, type: 'PRODUCTION', title: id, ...(resourceRef ? { resourceRef } : {}), config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } });
const reading = (id, resourceRef) => ({ id, type: 'READING', title: id, resourceRef });

function publish(doc, slug, nodes) {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes }] }, bookExists);
    Store.publishVersion(doc, v.id);
    return { exp, v };
}
const snap = (workRef, over = {}) => ({ workRef, decision: 'allowed', via: 'SCOPE_TITLE', at: new Date().toISOString(), ...over });
function deliver(doc, exp, v, { userId = 'lector', reviewerId = 'mediador', decision = 'aprobado', access = true } = {}) {
    const { run } = Store.startRun(doc, { userId, experienceId: exp.id });
    const evs = [];
    for (const n of Store.versionNodes(v)) {
        if (n.type !== 'PRODUCTION') { Store.completeNode(doc, run.id, n.id); continue; }
        const { evidence } = Store.submitEvidence(doc, { runId: run.id, nodeId: n.id, userId, payload: { text: WORDS }, workAccess: n.resourceRef && access ? snap(n.resourceRef) : null });
        if (decision) Store.reviewEvidence(doc, evidence.id, { reviewerId, decision });
        evs.push(evidence);
    }
    return evs;
}

let version = 0;
function setRight(contentId, legalStatus) {
    version += 1;
    const db = new Database(ROY);
    db.pragma('foreign_keys = OFF');
    db.prepare(`INSERT INTO rights_versions VALUES (?, ?, ?, 'pub', 'acta', '2026-01-01', '2026-01-01', NULL, '2026-01-01T00:00:00.000Z', ?, 'active', 'liquidable',
        NULL, NULL, '[]', 1, 1, 1, 1, 1, 1, 1, NULL, 'test', '2026-01-01T00:00:00.000Z')`).run(`rv-${version}`, contentId, version, legalStatus);
    db.close();
}

const dirs = { n: 0 };
function fresh() {
    dirs.n += 1;
    const dir = path.join(tmp, `g${dirs.n}`);
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true }); fs.mkdirSync(path.join(dir, 'reg'));
    const reg = path.join(dir, 'reg', 'r.jsonl'); fs.writeFileSync(reg, '');
    const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '', GAMIFICATION_DB: path.join(dir, 'db', 'gamification.db'), GAMIFICATION_EXCLUSION_REGISTRY: reg, GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString() };
    process.env.GAMIFICATION_DB = env.GAMIFICATION_DB;
    process.env.GAMIFICATION_EXCLUSION_REGISTRY = reg;
    D.closeGamificationDb({ resetBackoff: true });
    const db = D.getGamificationDb({ env });
    L.createRuleSet(db, { ruleVersion: 'gm-r-v1', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000, rules: { schema: 1, caps: { pmPerDay: 0, pmPerWeek: 0 }, facts: {} } });
    return { db, env };
}
const everyone = () => ({ exists: true, active: true, synthetic: false });
const sweep = (db, doc, env, over = {}) => M.recognizeMookWorks(db, doc, { workRefOf: Store.productionWorkRef, readRights: () => Rights.readWithdrawnWorks(), resolveUser: everyone, sinceMs: SINCE, env, now: Date.now(), ...over });
const count = (db, t, where = '1=1', ...a) => db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${where}`).get(...a).c;
const noMoney = (db) => count(db, 'gm_xp_entries') === 0 && count(db, 'gm_pm_movements') === 0 && count(db, 'gm_pm_balances') === 0 && count(db, 'gm_work_cycles', 'xp <> 0 OR pm <> 0') === 0;

const realFiles = ['data/mook_db.json', 'data/content.json', 'data/access_db.json'].map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f));
const realBefore = realFiles.map(sha);
const realGam = fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db'));
const realRoy = path.join(REPO, 'data-critical', 'royalties.db');
const realRoyBefore = fs.existsSync(realRoy) ? sha(realRoy) : null;

const children = [];
try {
    section('[1] fuente de derechos');
    ok('sin archivo de derechos: no verificable', (() => { try { Rights.readWithdrawnWorks(); return false; } catch { return true; } })());
    ok('consultar no crea el archivo', !fs.existsSync(ROY));
    Pub.getRoyaltiesDb();
    Pub.closeRoyaltiesDb();
    setRight('obra-a', 'active');
    const rightsHash = sha(ROY);
    const free = Rights.readWithdrawnWorks();
    ok('activa: no retirada', free('obra-a') === false);
    ok('sin régimen: no retirada', free('otra') === false);
    ok('la lectura no cambia el archivo', sha(ROY) === rightsHash);
    const ro = new Database(ROY, { readonly: true });
    ok('el índice se puede leer con conexión de solo lectura', Rights.rightsIndex(ro).get('obra-a')?.[0]?.legalStatus === 'active');
    ro.close();
    ok('vencida no es retirada', Rights.isWorkWithdrawn([{ versionNo: 1, effectiveAt: '2020-01-01', legalStatus: 'active', validUntil: '2020-02-01' }]) === false);
    ok('versión futura todavía no rige', Rights.isWorkWithdrawn([{ versionNo: 1, effectiveAt: '2999-01-01', legalStatus: 'revoked' }]) === false);

    section('[2] estados legales');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        for (const s of ['suspended', 'revoked', 'disputed']) {
            setRight('obra-s', s);
            const d = Store.emptyMookStore();
            const p = publish(d, 'x', [reading('r', 'obra-s'), production('p', 'obra-s')]);
            deliver(d, p.exp, p.v);
            const r = sweep(db, d, env);
            ok(`${s}: nada se registra`, r.recognized === 0 && r.unattributed.work_withdrawn === 1 && count(db, 'gm_work_cycles') === 0, JSON.stringify(r));
        }
        const p = publish(doc, 'a', [reading('r', 'obra-l'), production('p', 'obra-l')]);
        deliver(doc, p.exp, p.v);
        setRight('obra-l', 'suspended');
        ok('suspendida: pendiente', sweep(db, doc, env).unattributed.work_withdrawn === 1);
        const hash = sha(ROY);
        fs.renameSync(ROY, `${ROY}.aparte`);
        const down = sweep(db, doc, env);
        ok('índice no disponible: bloquea', down.recognized === 0 && down.unattributed.work_withdrawn === 1, JSON.stringify(down));
        const broken = sweep(db, doc, env, { readRights: () => { throw new Error('x'); } });
        ok('consulta que falla: bloquea', broken.recognized === 0 && broken.unattributed.work_withdrawn === 1);
        fs.renameSync(`${ROY}.aparte`, ROY);
        ok('regalías intactas', sha(ROY) === hash);
        setRight('obra-l', 'active');
        const lifted = sweep(db, doc, env);
        ok('suspensión levantada: la evidencia pendiente se registra', lifted.recognized === 1, JSON.stringify(lifted));
        setRight('obra-l', 'revoked');
        const later = sweep(db, doc, env);
        ok('retirada posterior: no revierte lo ya registrado', count(db, 'gm_work_cycles') === 2 && later.recognized === 0);
        const expired = Store.emptyMookStore();
        const px = publish(expired, 'e', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        deliver(expired, px.exp, px.v);
        ok('la decisión de acceso no se recalcula: no hay consulta de acceso', sweep(db, expired, env).recognized === 1);
        ok('sin XP ni PM', noMoney(db));
    }

    section('[3] evidencia y corte');
    {
        const { db, env } = fresh();
        const base = () => { const d = Store.emptyMookStore(); return { d, ...publish(d, 'c', [reading('r', 'obra-a'), production('p', 'obra-a')]) }; };
        const pending = base(); deliver(pending.d, pending.exp, pending.v, { decision: null });
        ok('pendiente: nada', sweep(db, pending.d, env).recognized === 0);
        const comments = base(); deliver(comments.d, comments.exp, comments.v, { decision: 'con_comentarios' });
        ok('con comentarios: nada', sweep(db, comments.d, env).recognized === 0);
        const noSnap = base(); deliver(noSnap.d, noSnap.exp, noSnap.v, { access: false });
        ok('sin snapshot: nada', sweep(db, noSnap.d, env).unattributed.no_access_snapshot === 1);
        const general = Store.emptyMookStore(); const g = publish(general, 'g', [reading('r', 'obra-a'), production('p')]); deliver(general, g.exp, g.v);
        ok('experiencia general: nada', sweep(db, general, env).unattributed.no_work_declared === 1);
        const old = base(); deliver(old.d, old.exp, old.v);
        ok('versión anterior al corte: nada', sweep(db, old.d, env, { sinceMs: Date.now() + 60_000 }).recognized === 0);
        old.d.evidence[0].review.reviewedAt = new Date(SINCE - 1000).toISOString();
        ok('evidencia anterior al corte: nada', sweep(db, old.d, env).recognized === 0);
        const preRules = L.recordWorkRecognition(db, { evidenceId: 'ev-pre', userId: 'lector', actorId: 'mediador', at: SINCE - 60_000, workRef: 'obra-a', decision: 'aprobado' }, { env });
        ok('anterior a las reglas: nada', preRules.reason === 'predates_rules' && !preRules.inserted);
        ok('ninguna fila', count(db, 'gm_work_cycles') === 0 && count(db, 'gm_source_facts') === 0 && count(db, 'gm_subjects') === 0);
    }

    section('[4] actos, ciclo e idempotencia');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        const a = publish(doc, 'a', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        const b = publish(doc, 'b', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        const m = publish(doc, 'm', [reading('ra', 'obra-b'), reading('rc', 'obra-c'), production('pb', 'obra-b'), production('pc', 'obra-c')]);
        const [ev] = deliver(doc, a.exp, a.v);
        const first = sweep(db, doc, env);
        ok('una evidencia: dos actos', first.recognized === 1 && count(db, 'gm_work_cycles') === 2 && count(db, 'gm_work_cycles', "act = 'reading'") === 1 && count(db, 'gm_work_cycles', "act = 'reflection'") === 1, JSON.stringify(first));
        ok('ciclo 1', count(db, 'gm_work_cycles', 'cycle = 1') === 2);
        ok('reintento: no duplica', sweep(db, doc, env).already === 1 && count(db, 'gm_work_cycles') === 2 && count(db, 'gm_source_facts') === 1);
        deliver(doc, b.exp, b.v);
        const second = sweep(db, doc, env);
        ok('otra evidencia, misma obra: solo reflexión', second.recognized === 1 && count(db, 'gm_work_cycles') === 3 && count(db, 'gm_work_cycles', "act = 'reading'") === 1, JSON.stringify(second));
        deliver(doc, m.exp, m.v);
        sweep(db, doc, env);
        ok('multiobra: cada evidencia en su obra', count(db, 'gm_source_facts') === 4 && count(db, 'gm_work_cycles') === 7 && db.prepare('SELECT COUNT(DISTINCT work_key) c FROM gm_work_cycles').get().c === 3);
        const dump = JSON.stringify(db.prepare('SELECT * FROM gm_work_cycles').all()) + JSON.stringify(db.prepare('SELECT * FROM gm_source_facts').all());
        ok('sin contentId, evidenceId ni usuario en claro', !/obra-|lector|mediador/.test(dump) && !dump.includes(ev.id));
        ok('hecho sin emisión ni rasgos', count(db, 'gm_source_facts', "decision = 'observed' AND features_json = '{}' AND grade = 'A'") === 4);
        ok('sujeto y revisor seudónimos', count(db, 'gm_subjects') === 2);
        ok('el ledger cuadra y no hay dinero', L.verifyLedger(db).ok && noMoney(db));
        ok('SQL: mismo acto rechazado', throwsCode(() => db.prepare("INSERT INTO gm_work_cycles SELECT fact_id, subject_ref, work_key, cycle, act, xp, pm FROM gm_work_cycles WHERE act = 'reflection' LIMIT 1").run(), 'SQLITE_CONSTRAINT_PRIMARYKEY'));
        ok('el llamador no fija montos, ciclo ni acto', (() => { const r = L.recordWorkRecognition(db, { evidenceId: 'ev-x', userId: 'lector', actorId: 'mediador', at: Date.now(), workRef: 'obra-z', decision: 'aprobado', xp: 99, pm: 99, cycle: 7, act: 'route' }, { env }); return r.inserted && r.acts.join() === 'reading,reflection' && noMoney(db); })());
        ok('decisión distinta de aprobado: no', L.recordWorkRecognition(db, { evidenceId: 'ev-y', userId: 'lector', actorId: 'mediador', at: Date.now(), workRef: 'obra-z', decision: 'con_comentarios' }, { env }).inserted === false);
    }

    section('[5] dos procesos sobre el mismo hecho y ciclo');
    {
        const worker = path.join(HERE, 'recognitionWorker.mjs');
        const run = (env, file) => new Promise((resolve) => {
            const c = spawn(process.execPath, [worker, file], { env: { ...process.env, ...env, ROYALTIES_DB: ROY }, stdio: ['ignore', 'pipe', 'pipe'] });
            let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
            c.on('close', (code) => resolve({ code, out }));
        });
        for (let round = 0; round < 6; round++) {
            const { db, env } = fresh();
            const doc = Store.emptyMookStore();
            const a = publish(doc, 'a', [reading('r', 'obra-a'), production('p', 'obra-a')]);
            const b = publish(doc, 'b', [reading('r', 'obra-a'), production('p', 'obra-a')]);
            deliver(doc, a.exp, a.v); deliver(doc, b.exp, b.v);
            const file = path.join(tmp, `doc${round}.json`);
            fs.writeFileSync(file, JSON.stringify({ doc, since: SINCE }));
            D.closeGamificationDb({ resetBackoff: true });
            const rs = await Promise.all([run(env, file), run(env, file), run(env, file), run(env, file)]);
            const parsed = rs.map((r) => { try { return JSON.parse(r.out.trim().split('\n').pop()); } catch { return null; } });
            const check = new Database(env.GAMIFICATION_DB);
            ok(`ronda ${round + 1}: cuatro procesos terminan`, rs.every((r) => r.code === 0) && parsed.every(Boolean), JSON.stringify(rs.map((r) => [r.code, r.out.slice(-200)])));
            ok(`ronda ${round + 1}: cada hecho una vez`, parsed.reduce((s, p) => s + (p?.recognized ?? 0), 0) === 2 && check.prepare('SELECT COUNT(*) c FROM gm_source_facts').get().c === 2, JSON.stringify(parsed));
            ok(`ronda ${round + 1}: una lectura y dos reflexiones en el ciclo`, check.prepare("SELECT COUNT(*) c FROM gm_work_cycles WHERE act = 'reading'").get().c === 1 && check.prepare("SELECT COUNT(*) c FROM gm_work_cycles WHERE act = 'reflection'").get().c === 2);
            ok(`ronda ${round + 1}: integridad`, check.pragma('integrity_check', { simple: true }) === 'ok');
            check.close();
        }
    }

    section('[6] reinicio y restauración');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        const a = publish(doc, 'a', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        const [ev] = deliver(doc, a.exp, a.v);
        const deps = { readMook: () => doc, readUsers: () => [{ id: 'lector' }, { id: 'mediador' }], isUserActive: () => true, isSyntheticUser: () => false, workRefOf: Store.productionWorkRef, readRights: () => Rights.readWithdrawnWorks(), env };
        D.closeGamificationDb({ resetBackoff: true });
        const r1 = M.runMookReconcileOnce(deps);
        ok('barrido real: recupera el hecho perdido', r1.ok && r1.recognition.recognized === 1, JSON.stringify(r1));
        const r2 = M.runMookReconcileOnce(deps);
        ok('tras reiniciar no repite', r2.ok && r2.recognition.already === 1, JSON.stringify(r2));
        const db2 = D.getGamificationDb({ env });
        const backup = path.join(tmp, 'restore', 'gamification.db');
        fs.mkdirSync(path.dirname(backup));
        await db2.backup(backup);
        const rows = JSON.stringify(db2.prepare('SELECT * FROM gm_work_cycles ORDER BY rowid').all());
        const envR = { ...env, GAMIFICATION_DB: backup };
        D.closeGamificationDb({ resetBackoff: true });
        process.env.GAMIFICATION_DB = backup;
        const rdb = D.getGamificationDb({ env: envR });
        ok('restaurada: filas idénticas y ledger íntegro', JSON.stringify(rdb.prepare('SELECT * FROM gm_work_cycles ORDER BY rowid').all()) === rows && L.verifyLedger(rdb).ok && rdb.pragma('integrity_check', { simple: true }) === 'ok');
        ok('restaurada: un barrido no duplica', sweep(rdb, doc, envR).already === 1 && count(rdb, 'gm_source_facts') === 1 && count(rdb, 'gm_work_cycles') === 2);
        ok('restaurada: sigue idempotente por evidencia', L.recordWorkRecognition(rdb, { evidenceId: ev.id, userId: 'lector', actorId: 'mediador', at: Date.parse(ev.review.reviewedAt), workRef: 'obra-a', decision: 'aprobado' }, { env: envR }).inserted === false);
        D.closeGamificationDb({ resetBackoff: true });
    }

    section('[7] sujetos');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        const p = publish(doc, 's', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        deliver(doc, p.exp, p.v, { userId: 'excluido' });
        E.excludeUser(db, { userId: 'excluido', env, now: NOW });
        const r = sweep(db, doc, env);
        ok('excluido: nada y sin sujeto', r.recognized === 0 && r.unattributed.subject_excluded === 1 && !S.findSubject(db, 'excluido'), JSON.stringify(r));
        const p2 = publish(doc, 's2', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        deliver(doc, p2.exp, p2.v, { userId: 'sintetico' });
        const r2 = sweep(db, doc, env, { resolveUser: (id) => (id === 'sintetico' ? { exists: true, active: true, synthetic: true } : everyone()), onlyEvidenceId: doc.evidence.at(-1).id });
        ok('sintético: nada', r2.recognized === 0 && r2.unattributed.subject_not_eligible === 1);
        const r3 = sweep(db, doc, env, { resolveUser: (id) => (id === 'sintetico' ? { exists: true, active: false, synthetic: false } : everyone()), onlyEvidenceId: doc.evidence.at(-1).id });
        ok('inactivo: nada', r3.recognized === 0 && r3.unattributed.subject_not_eligible === 1);
        const direct = (over, opts = {}) => L.recordWorkRecognition(db, { evidenceId: 'ev-d', userId: 'vigente', actorId: 'revisor', at: Date.now(), workRef: 'obra-a', decision: 'aprobado', ...over }, { env, ...opts });
        ok('directo, lector excluido: nada', direct({ userId: 'excluido' }).reason === 'subject_excluded');
        E.excludeUser(db, { userId: 'revisor-excluido', env, now: NOW });
        ok('directo, revisor excluido: nada', direct({ actorId: 'revisor-excluido' }).reason === 'subject_excluded');
        const stale = { excludes: () => false }; // exclusión de otra réplica tras leer la puerta
        ok('puerta obsoleta: la transacción lo detecta', direct({ userId: 'excluido' }, { gate: stale }).reason === 'subject_excluded');
        ok('puerta obsoleta, revisor: la transacción lo detecta', direct({ actorId: 'revisor-excluido' }, { gate: stale }).reason === 'subject_excluded');
        ok('sin recrear sujetos', !S.findSubject(db, 'excluido') && !S.findSubject(db, 'revisor-excluido') && !S.findSubject(db, 'vigente'));
        const self = L.recordWorkRecognition(db, { evidenceId: 'ev-self', userId: 'yo', actorId: 'yo', at: Date.now(), workRef: 'obra-a', decision: 'aprobado' }, { env });
        ok('autorrevisión: nada', !self.inserted && self.reason === 'self_review' && !S.findSubject(db, 'yo'), JSON.stringify(self));
        ok('sin filas', count(db, 'gm_work_cycles') === 0);
        const reg = env.GAMIFICATION_EXCLUSION_REGISTRY;
        fs.appendFileSync(reg, 'alterado\n');
        ok('registro alterado: el barrido no avanza', throwsCode(() => sweep(db, doc, env), 'EXCLUSION_REGISTRY_UNAVAILABLE'));
    }

    section('[8] flags, intake y bloqueos');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        const p = publish(doc, 'f', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        const [ev] = deliver(doc, p.exp, p.v);
        const off = { ...env, XP_EARNING_ENABLED: '' };
        ok('XP OFF: no se registra', sweep(db, doc, off).skipped === 'disabled' && count(db, 'gm_source_facts') === 0);
        ok('directo con XP OFF: nada', L.recordWorkRecognition(db, { evidenceId: 'e', userId: 'u', actorId: 'm', at: Date.now(), workRef: 'w', decision: 'aprobado' }, { env: off }).reason === 'disabled');
        ok('sin fuentes conectadas: no se registra', sweep(db, doc, env, { workRefOf: null }).skipped === 'not_wired');
        const parentOff = { GAMIFICATION_DB: env.GAMIFICATION_DB, XP_EARNING_ENABLED: '1' };
        ok('padre OFF: nada', sweep(db, doc, parentOff).skipped === 'disabled');
        const onPm = { ...env, PM_EARNING_ENABLED: '1' };
        sweep(db, doc, onPm);
        ok('PM ON: sigue sin PM', count(db, 'gm_work_cycles') === 2 && count(db, 'gm_work_cycles', 'pm > 0') === 0 && noMoney(db));
        const P = await import('../policy.mjs');
        ok('los bloqueos de emisión siguen', P.PM_LOCKED_SOURCES.includes('mook_review') && P.XP_LOCKED_SOURCES.includes('mook_review'));
        ok('ninguna regla puede pagar por revisión', throwsCode(() => P.validateRules({ schema: 1, caps: { pmPerDay: 1, pmPerWeek: 1 }, facts: { 'mook_review/evidence_reviewed': { xp: 1 } } }, { featureAllowlist: L.FEATURE_ALLOWLIST }), 'XP_SOURCE_LOCKED'));
        const src = fs.readFileSync(path.join(HERE, '..', 'ledger.mjs'), 'utf8').split('export function recordWorkRecognition')[1].split('/** ¿Ya existe este hecho?')[0];
        ok('el registro no escribe XP ni PM', !/gm_xp_entries|gm_pm_movements|insertMovement/.test(src));
        ok('solo reconoce fuentes del servidor: sin clics, tiempo ni Leo', !/mook_reading_node|leo|activeMinutes/i.test(src));

        const dir = path.join(tmp, 'v2', 'db'); fs.mkdirSync(dir, { recursive: true });
        const v2 = path.join(dir, 'gamification.db');
        const { runMigrations } = await import('../../db/migrate.js');
        const old = new Database(v2); old.pragma('journal_mode = WAL');
        runMigrations(old, () => {}, { dir: path.join(HERE, '..', 'migrations'), tag: 't', until: '0002_subject_model' });
        old.close();
        I.closeIntake({ resetBackoff: true });
        const done = await new Promise((resolve) => I.scheduleOnHookDb(() => 'corrió', { env: { ...env, GAMIFICATION_DB: v2 }, onDone: resolve }));
        ok('intake exige 0003: en 0002 desiste', !done.ok && done.code === 'GAMIFICATION_DB_UNAVAILABLE', JSON.stringify(done));
        I.closeIntake({ resetBackoff: true });
        const fine = await new Promise((resolve) => I.scheduleOnHookDb(() => 'corrió', { env, onDone: resolve }));
        ok('en 0003 corre', fine.ok && fine.result === 'corrió', JSON.stringify(fine));
        I.closeIntake({ resetBackoff: true });
        const off2 = await new Promise((resolve) => I.scheduleOnHookDb(() => 'x', { env: {}, onDone: resolve }));
        ok('gamificación OFF: no corre', off2.code === 'GAMIFICATION_DISABLED');
        const d2 = Store.emptyMookStore();
        const pe = publish(d2, 'h', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        const [h] = deliver(d2, pe.exp, pe.v);
        const pf = publish(d2, 'h2', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        deliver(d2, pf.exp, pf.v, { userId: 'otro-lector' });
        const viaHook = await new Promise((resolve) => M.onMookEvidenceReviewed(h, { resolveUser: everyone, env,
            recognition: { readMook: () => d2, workRefOf: Store.productionWorkRef, readRights: () => Rights.readWithdrawnWorks(), onDone: resolve } }));
        ok('gancho: registra por la conexión de intake', viaHook.ok && viaHook.result.recognized === 1, JSON.stringify(viaHook));
        ok('y solo esa evidencia', count(D.getGamificationDb({ env }), 'gm_source_facts') === 2);
        I.closeIntake({ resetBackoff: true });
        ok('ev previa intacta', ev.review.decision === 'aprobado');
        D.closeGamificationDb({ resetBackoff: true });
    }

    section('[9] server.js real');
    {
        const dir = path.join(tmp, 'http'); const data = path.join(dir, 'data'); const sqlite = path.join(dir, 'sqlite');
        fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(path.join(dir, 'uploads')); fs.mkdirSync(sqlite); fs.mkdirSync(path.join(dir, 'reg')); fs.mkdirSync(path.join(dir, 'gam'));
        const reg = path.join(dir, 'reg', 'r.jsonl'); fs.writeFileSync(reg, '');
        const gamDb = path.join(dir, 'gam', 'gamification.db');
        const cutoff = new Date(Date.now() - 3_600_000).toISOString();
        const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: gamDb, GAMIFICATION_EXCLUSION_REGISTRY: reg };
        process.env.GAMIFICATION_DB = gamDb; process.env.GAMIFICATION_EXCLUSION_REGISTRY = reg;
        const db = D.getGamificationDb({ env });
        L.createRuleSet(db, { ruleVersion: 'gm-h-v1', createdBy: 'migration', now: Date.now() - 5000, effectiveFrom: Date.now() - 5000, rules: { schema: 1, caps: { pmPerDay: 0, pmPerWeek: 0 }, facts: {} } });
        D.closeGamificationDb({ resetBackoff: true });
        const fixture = Store.emptyMookStore();
        const { exp } = publish(fixture, 'http', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        fs.writeFileSync(path.join(data, 'mook_db.json'), JSON.stringify(fixture));
        fs.writeFileSync(path.join(data, 'content.json'), JSON.stringify([{ id: 'obra-a', titulo: 'A', tipo: 'libro', status: 'disponible' }]));
        fs.writeFileSync(path.join(data, 'access_db.json'), JSON.stringify([{ id: 'r1', scope: 'user', scopeId: 'u-lector', titleIds: ['obra-a'], collectionIds: [], expiresAt: null }]));
        for (const f of ['progress_db.json', 'groups_db.json', 'schools_db.json', 'school_configs.json', 'leo_evidence_db.json']) fs.writeFileSync(path.join(data, f), '[]');
        const user = (id, roles) => ({ id, email: `${id}@t.test`, nombre_completo: id, roles, accountStatus: 'active', password: 'x' });
        fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([user('u-admin', ['administrador']), user('u-lector', ['lector'])]));
        const roy = path.join(dir, 'sqlite', 'royalties.db');
        fs.copyFileSync(ROY, roy);
        const db_ = (n) => path.join(sqlite, n);
        const port = await freePort();
        const child = spawn(process.execPath, [path.join(REPO, 'server', 'server.js')], {
            env: { ...process.env, NODE_ENV: 'test', SESSION_AUTH_MODE: 'off', ACCESS_FALLBACK_MODE: 'restricted', PORT: String(port), USERS_DB: path.join(dir, 'users.json'), CHP_DATA_DIR: data, UPLOADS_ROOT: path.join(dir, 'uploads'),
                ACCESS_DB: path.join(data, 'access_db.json'), ...env, PM_EARNING_ENABLED: '', GAMIFICATION_MOOK_SINCE: cutoff, GAMIFICATION_RECONCILE_INITIAL_DELAY_MS: '600000', EXPERIENCE_EVENTS_BACKBONE_ENABLED: '',
                EVENTS_SQLITE_PATH: db_('events.db'), ARCHIVE_SQLITE_PATH: db_('events.archive.db'), INSIGHTS_SQLITE_PATH: db_('insights.db'), PROGRESS_SQLITE_PATH: db_('progress.db'), OFFLINE_ASSIGNMENT_DB_PATH: db_('offline.db'),
                ROYALTIES_DB: roy, IDENTITY_DB: db_('identity.db'), SESSIONS_DB: db_('sessions.db'), GROUPS_DB: path.join(data, 'groups_db.json'), SCHOOLS_DB: path.join(data, 'schools_db.json'), LEO_EVIDENCE_DB: path.join(data, 'leo_evidence_db.json') },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        children.push(child);
        let logs = ''; child.stdout.on('data', (d) => { logs += d; }); child.stderr.on('data', (d) => { logs += d; });
        const BASE = `http://127.0.0.1:${port}`;
        for (let i = 0; ; i++) {
            try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* arrancando */ }
            if (i > 120) throw new Error(`no arrancó:\n${logs.slice(-1500)}`);
            await sleep(500);
        }
        const call = async (method, url, u, body) => { const r = await fetch(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', 'x-user-id': u }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
        const stored = () => JSON.parse(fs.readFileSync(path.join(data, 'mook_db.json'), 'utf8'));
        await call('POST', `/api/experiences/${exp.id}/run`, 'u-lector');
        const runId = stored().runs[0].id;
        await call('POST', `/api/experiences/runs/${runId}/nodes/r/complete`, 'u-lector');
        const sub = await call('POST', `/api/experiences/runs/${runId}/nodes/p/evidence`, 'u-lector', { text: WORDS });
        ok('entrega congelada', stored().evidence[0]?.workAccess?.via === 'SCOPE_TITLE', JSON.stringify(sub));
        const rev = await call('POST', `/api/experiences/review/${sub.body?.evidenceId}`, 'u-admin', { decision: 'aprobado', feedback: 'bien' });
        ok('la respuesta de revisión no cambia', rev.status === 200 && JSON.stringify(Object.keys(rev.body)) === '["id","review"]');
        const look = () => { const c = new Database(gamDb, { readonly: true }); const r = { cycles: c.prepare('SELECT COUNT(*) n FROM gm_work_cycles').get().n, xp: c.prepare('SELECT COUNT(*) n FROM gm_xp_entries').get().n, pm: c.prepare('SELECT COUNT(*) n FROM gm_pm_movements').get().n }; c.close(); return r; };
        let seen = look();
        for (let i = 0; i < 40 && seen.cycles === 0; i++) { await sleep(150); seen = look(); }
        ok('servidor real: dos actos sin XP ni PM', seen.cycles === 2 && seen.xp === 0 && seen.pm === 0, `${JSON.stringify(seen)} ${logs.slice(-400)}`);
    }

    section('[aislamiento]');
    ok('stores reales intactos', realFiles.map(sha).join() === realBefore.join());
    ok('sin gamification.db real', fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db')) === realGam);
    ok('regalías reales intactas', (fs.existsSync(realRoy) ? sha(realRoy) : null) === realRoyBefore);
} catch (e) {
    fail++;
    console.error('  ✗ excepción', e);
} finally {
    for (const c of children) c.kill();
    await Promise.all(children.map((c) => (c.exitCode === null && c.signalCode === null ? new Promise((r) => c.on('close', r)) : null)));
    try { I.closeIntake({ resetBackoff: true }); D.closeGamificationDb({ resetBackoff: true }); Pub.closeRoyaltiesDb(); } catch { /* noop */ }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`\nworkRecognition: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
