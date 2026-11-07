/**
 * xpPilotEmission.test.mjs — CHP-GAMIFICACION-G4-XP-EMISSION-01.
 *
 * El modelo aprobado (A7-A12-V3) sobre el escritor real, con bases temporales y
 * usuarios sintéticos. Desde V8-ACTIVATE-PREP-01 el arnés no cambia nada: [8]
 * prueba el código real en un proceso sin arnés.
 *  [1] configuración  [2] primera, segunda y tercera evidencia  [3] doble emisión
 *  [4] dos procesos  [5] reinicio y restauración  [6] derechos  [7] exclusión,
 *  PM y retroactividad  [8] código real sin arnés
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/xpPilotEmission.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/xpRecognitionHarness.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_pilot_'));
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
const R = await import('../recognition.mjs');
const E = await import('../erasure.mjs');
const S = await import('../subjects.mjs');

/** A7-A12-V3 §1. `approvalRef` sintético: el real lo emite Dirección. */
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [] } };
const rules = (extra = {}) => ({ schema: 1, facts: {}, recognition: PILOT, ...extra });

const SINCE = Date.now() - 60_000;
const WORDS = 'una dos tres cuatro cinco seis siete ocho';
const production = (id, resourceRef) => ({ id, type: 'PRODUCTION', title: id, resourceRef, config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } });
const reading = (id, resourceRef) => ({ id, type: 'READING', title: id, resourceRef });
const route = (doc, slug, work = 'obra-a') => {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [reading('r', work), production('p', work)] }] }, () => true);
    Store.publishVersion(doc, v.id);
    return { exp, v };
};
function deliver(doc, { exp, v }, userId = 'lector') {
    const { run } = Store.startRun(doc, { userId, experienceId: exp.id });
    Store.completeNode(doc, run.id, 'r');
    const { evidence } = Store.submitEvidence(doc, { runId: run.id, nodeId: 'p', userId, payload: { text: WORDS },
        workAccess: { workRef: Store.productionWorkRef(v, 'p').workRef, decision: 'allowed', via: 'SCOPE_TITLE', at: new Date().toISOString() } });
    Store.reviewEvidence(doc, evidence.id, { reviewerId: 'mediador', decision: 'aprobado' });
    return evidence;
}
let n = 0;
function fresh(ruleSet = rules()) {
    n += 1;
    const dir = path.join(tmp, `g${n}`);
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true }); fs.mkdirSync(path.join(dir, 'reg'));
    const reg = path.join(dir, 'reg', 'r.jsonl'); fs.writeFileSync(reg, '');
    const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: path.join(dir, 'db', 'gamification.db'), GAMIFICATION_EXCLUSION_REGISTRY: reg, GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString() };
    process.env.GAMIFICATION_DB = env.GAMIFICATION_DB;
    process.env.GAMIFICATION_EXCLUSION_REGISTRY = reg;
    D.closeGamificationDb({ resetBackoff: true });
    const db = D.getGamificationDb({ env });
    if (ruleSet) L.createRuleSet(db, { ruleVersion: 'gm-p-v1', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000, rules: ruleSet });
    return { db, env };
}
const everyone = () => ({ exists: true, active: true, synthetic: false });
const open = () => () => false;
const sweep = (db, doc, env, over = {}) => M.recognizeMookWorks(db, doc, { workRefOf: Store.productionWorkRef, readRights: open, resolveUser: everyone, sinceMs: SINCE, env, now: Date.now(), ...over });
const count = (db, t, where = '1=1') => db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${where}`).get().c;
const sumXp = (db) => db.prepare('SELECT COALESCE(SUM(xp),0) n FROM gm_xp_entries').get().n;
const noPm = (db) => count(db, 'gm_pm_movements') === 0 && count(db, 'gm_pm_balances') === 0 && count(db, 'gm_work_cycles', 'pm <> 0') === 0;
const cuadra = (db) => sumXp(db) === db.prepare('SELECT COALESCE(SUM(xp),0) n FROM gm_work_cycles').get().n;

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const realFiles = ['data/mook_db.json', 'data/content.json'].map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f));
const realBefore = realFiles.map(sha);
const realGam = fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db'));

try {
    section('[1] configuración aprobada');
    ok('supera la validación', R.validateApprovedRecognition(PILOT).ok);
    ok('un solo ciclo: sin factores de relectura', PILOT.reread.xpFactors.length === 0);
    {
        const { db } = fresh(null);
        L.createRuleSet(db, { ruleVersion: 'gm-ok', createdBy: 'migration', now: SINCE, rules: rules({ facts: { 'mook_experience/experience_completed': { xp: 0 } } }) });
        ok('una regla de ruta en cero se admite', count(db, 'gm_rule_sets') === 1);
        const conflict = (facts) => throwsCode(() => L.createRuleSet(db, { ruleVersion: 'gm-mal', createdBy: 'migration', now: SINCE, rules: rules({ facts }) }), 'RECOGNITION_RULE_CONFLICT');
        ok('rechazada: XP por ruta junto a recognition', conflict({ 'mook_experience/experience_completed': { xp: 5 } }));
        ok('sin recognition, las reglas previas no cambian', L.createRuleSet(db, { ruleVersion: 'gm-prev', createdBy: 'migration', now: SINCE, rules: { schema: 1, facts: { 'mook_experience/experience_completed': { xp: 5 } } } }).created);
    }

    section('[2] primera, segunda y tercera evidencia');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        const [a, b, c, d] = ['a', 'b', 'c', 'd'].map((s) => route(doc, s));
        const e1 = deliver(doc, a);
        ok('primera: 30 XP', sweep(db, doc, env).recognized === 1 && sumXp(db) === 30);
        ok('primera: lectura 10 y reflexión 20', count(db, 'gm_work_cycles', "act = 'reading' AND xp = 10") === 1 && count(db, 'gm_work_cycles', "act = 'reflection' AND xp = 20") === 1);
        deliver(doc, b);
        ok('segunda: 20 XP, total 50', sweep(db, doc, env).recognized === 1 && sumXp(db) === 50);
        ok('segunda: solo reflexión', count(db, 'gm_work_cycles', "act = 'reading'") === 1 && count(db, 'gm_work_cycles') === 3);
        const e3 = deliver(doc, c);
        const third = sweep(db, doc, env);
        ok('tercera: 0 XP, sin hecho ni acto', third.recognized === 0 && third.notRecorded.no_xp_to_emit === 1 && sumXp(db) === 50 && count(db, 'gm_source_facts') === 2 && count(db, 'gm_work_cycles') === 3, JSON.stringify(third));
        deliver(doc, d);
        const fourth = sweep(db, doc, env);
        ok('cuarta: igual, sin claves nuevas', fourth.notRecorded.no_xp_to_emit === 2 && count(db, 'gm_source_facts') === 2);
        const view = Store.myEvidenceView(doc, doc.runs.find((r) => r.id === e3.runId), 'lector')[0];
        ok('la tercera evidencia sigue disponible y aprobada', view.review.decision === 'aprobado' && view.currentText === WORDS);
        ok('también en la vista de revisión', Store.reviewDetailView(doc, e3.id).review.decision === 'aprobado');
        ok('y su decisión de acceso no cambia', e3.workAccess.decision === 'allowed');
        const other = route(doc, 'e', 'obra-b');
        deliver(doc, other);
        ok('otra obra vuelve a dar 30', sweep(db, doc, env).recognized === 1 && sumXp(db) === 80);
        const again = sweep(db, doc, env);
        ok('repetir el barrido no cambia nada', again.recognized === 0 && again.already === 3 && sumXp(db) === 80 && count(db, 'gm_source_facts') === 3, JSON.stringify(again));
        ok('el ledger cuadra, sin PM', noPm(db) && cuadra(db));
        ok('otro lector sobre la misma obra tiene su propio ciclo', (() => { const r = route(doc, 'f'); deliver(doc, r, 'otro'); sweep(db, doc, env); return sumXp(db) === 110; })());
        ok('primera evidencia intacta', e1.review.decision === 'aprobado');
    }

    section('[3] doble emisión: ruta, revisión, gancho y reconciliación');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        const a = route(doc, 'a');
        const ev = deliver(doc, a);
        ok('la ruta quedó completada', doc.runs[0].status === 'completed');
        const deps = { readMook: () => doc, readUsers: () => [{ id: 'lector' }, { id: 'mediador' }], isUserActive: () => true, isSyntheticUser: () => false, workRefOf: Store.productionWorkRef, readRights: open, env };
        D.closeGamificationDb({ resetBackoff: true });
        const r1 = M.runMookReconcileOnce(deps);
        const r2 = M.runMookReconcileOnce(deps);
        const db2 = D.getGamificationDb({ env });
        ok('barrido completo: una evidencia, 30 XP', r1.ok && r2.ok && sumXp(db2) === 30 && count(db2, 'gm_source_facts') === 1, JSON.stringify([r1, r2]));
        ok('completar la ruta no paga', count(db2, 'gm_source_facts', "source = 'mook_experience'") === 0);
        const done = await new Promise((resolve) => M.onMookEvidenceReviewed(ev, { resolveUser: everyone, env, recognition: { readMook: () => doc, workRefOf: Store.productionWorkRef, readRights: open, onDone: resolve } }));
        ok('el gancho sobre una evidencia ya registrada no emite', done.ok && done.result.already === 1 && sumXp(db2) === 30, JSON.stringify(done));
        ok('la API directa tampoco', L.recordWorkRecognition(db2, { evidenceId: ev.id, userId: 'lector', actorId: 'mediador', at: Date.parse(ev.review.reviewedAt), workRef: 'obra-a', decision: 'aprobado' }, { env }).inserted === false && sumXp(db2) === 30);
        ok('tres rutas sobre una obra respetan el techo', (() => { for (const s of ['b', 'c']) deliver(doc, route(doc, s)); sweep(db2, doc, env); return sumXp(db2) === 50; })());
        const fx = fresh(null);
        const conflict = throwsCode(() => L.createRuleSet(fx.db, { ruleVersion: 'gm-x', createdBy: 'migration', now: SINCE, rules: rules({ facts: { 'mook_review/evidence_reviewed': { xp: 5 } } }) }), 'XP_SOURCE_LOCKED');
        ok('una regla no puede pagar la revisión por la vía antigua (la rechaza la política)', conflict);
        ok('sin hechos residuales', count(fx.db, 'gm_rule_sets') === 0);
        I.closeIntake({ resetBackoff: true });
        D.closeGamificationDb({ resetBackoff: true });
    }

    section('[4] dos procesos');
    {
        const worker = path.join(HERE, 'recognitionWorker.mjs');
        const run = (env, file) => new Promise((resolve) => {
            const c = spawn(process.execPath, [worker, file], { env: { ...process.env, ...env, ROYALTIES_DB: ROY }, stdio: ['ignore', 'pipe', 'pipe'] });
            let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
            c.on('close', (code) => resolve({ code, out }));
        });
        for (let round = 0; round < 6; round++) {
            const { env } = fresh();
            const doc = Store.emptyMookStore();
            for (const s of ['a', 'b', 'c', 'd']) deliver(doc, route(doc, s));
            const file = path.join(tmp, `doc${round}.json`);
            fs.writeFileSync(file, JSON.stringify({ doc, since: SINCE }));
            D.closeGamificationDb({ resetBackoff: true });
            const rs = await Promise.all([run(env, file), run(env, file), run(env, file), run(env, file)]);
            const check = new Database(env.GAMIFICATION_DB);
            ok(`ronda ${round + 1}: cuatro procesos terminan`, rs.every((r) => r.code === 0), JSON.stringify(rs.map((r) => [r.code, r.out.slice(-160)])));
            ok(`ronda ${round + 1}: exactamente 50 XP en dos hechos`, check.prepare('SELECT SUM(xp) n FROM gm_xp_entries').get().n === 50 && check.prepare('SELECT COUNT(*) c FROM gm_source_facts').get().c === 2);
            ok(`ronda ${round + 1}: una lectura y dos reflexiones`, check.prepare("SELECT COUNT(*) c FROM gm_work_cycles WHERE act = 'reading'").get().c === 1 && check.prepare("SELECT COUNT(*) c FROM gm_work_cycles WHERE act = 'reflection'").get().c === 2);
            check.close();
        }
    }

    section('[5] reinicio y restauración');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        for (const s of ['a', 'b', 'c']) deliver(doc, route(doc, s));
        sweep(db, doc, env);
        D.closeGamificationDb({ resetBackoff: true });
        const db2 = D.getGamificationDb({ env });
        ok('tras reiniciar no repite', sweep(db2, doc, env).recognized === 0 && sumXp(db2) === 50);
        const backup = path.join(tmp, 'restore', 'gamification.db');
        fs.mkdirSync(path.dirname(backup));
        await db2.backup(backup);
        D.closeGamificationDb({ resetBackoff: true });
        const envR = { ...env, GAMIFICATION_DB: backup };
        process.env.GAMIFICATION_DB = backup;
        const rdb = D.getGamificationDb({ env: envR });
        const again = sweep(rdb, doc, envR);
        ok('restaurada: no repite y mantiene el techo', again.recognized === 0 && sumXp(rdb) === 50 && count(rdb, 'gm_source_facts') === 2, JSON.stringify(again));
        ok('restaurada: íntegra', rdb.pragma('integrity_check', { simple: true }) === 'ok' && noPm(rdb) && cuadra(rdb));
        D.closeGamificationDb({ resetBackoff: true });
    }

    section('[6] derechos');
    {
        Pub.getRoyaltiesDb();
        Pub.closeRoyaltiesDb();
        let version = 0;
        const setRight = (legalStatus) => { version += 1; const c = new Database(ROY); c.pragma('foreign_keys = OFF'); c.prepare(`INSERT INTO rights_versions VALUES (?, 'obra-a', ?, 'pub', 'acta', '2026-01-01', '2026-01-01', NULL, '2026-01-01T00:00:00.000Z', ?, 'active', 'liquidable', NULL, NULL, '[]', 1, 1, 1, 1, 1, 1, 1, NULL, 'test', '2026-01-01T00:00:00.000Z')`).run(`rv-${version}`, version, legalStatus); c.close(); };
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        deliver(doc, route(doc, 'a'));
        const real = { readRights: () => Rights.readWithdrawnWorks() };
        setRight('suspended');
        ok('suspendida: 0 XP, pendiente', sweep(db, doc, env, real).unattributed.work_withdrawn === 1 && sumXp(db) === 0 && count(db, 'gm_source_facts') === 0);
        setRight('active');
        ok('levantada: emite 30', sweep(db, doc, env, real).recognized === 1 && sumXp(db) === 30);
        setRight('revoked');
        deliver(doc, route(doc, 'b'));
        ok('revocada: la segunda queda pendiente', sweep(db, doc, env, real).unattributed.work_withdrawn === 2 && sumXp(db) === 30);
        ok('y no revierte lo emitido', count(db, 'gm_xp_entries') === 1);
        ok('derechos no disponibles: nada', sweep(db, doc, env, { readRights: () => { throw new Error('x'); } }).recognized === 0);
    }

    section('[7] exclusión, PM y retroactividad');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        deliver(doc, route(doc, 'a'));
        const onPm = { ...env };
        sweep(db, doc, onPm);
        ok('PM encendido: sigue sin PM', sumXp(db) === 30 && noPm(db));
        deliver(doc, route(doc, 'b'), 'excluido');
        E.excludeUser(db, { userId: 'excluido', env });
        const r = sweep(db, doc, env);
        ok('excluido: nada y sin sujeto', r.unattributed.subject_excluded === 1 && !S.findSubject(db, 'excluido') && sumXp(db) === 30);
        const late = fresh(null);
        L.createRuleSet(late.db, { ruleVersion: 'gm-fut', createdBy: 'migration', now: Date.now() + 60_000, effectiveFrom: Date.now() + 60_000, rules: rules() });
        const d2 = Store.emptyMookStore();
        const ev = deliver(d2, route(d2, 'a'));
        const old = L.recordWorkRecognition(late.db, { evidenceId: ev.id, userId: 'lector', actorId: 'mediador', at: Date.parse(ev.review.reviewedAt), workRef: 'obra-a', decision: 'aprobado' }, { env: late.env, now: Date.now() + 120_000 });
        ok('evidencia anterior a la regla: sin retroactividad ni fila', old.reason === 'predates_rules' && count(late.db, 'gm_source_facts') === 0);
        const off = fresh();
        const d3 = Store.emptyMookStore();
        deliver(d3, route(d3, 'a'));
        ok('flags OFF: nada', sweep(off.db, d3, { ...off.env, XP_EARNING_ENABLED: '' }).skipped === 'disabled' && count(off.db, 'gm_source_facts') === 0);
        D.closeGamificationDb({ resetBackoff: true });
    }

    section('[8] código real, sin arnés (V8-ACTIVATE-PREP-01)');
    {
        const { db, env } = fresh();
        D.closeGamificationDb({ resetBackoff: true });
        const runWorker = () => new Promise((resolve) => {
            const c = spawn(process.execPath, [path.join(HERE, 'lockedWriterWorker.mjs')], { env: { ...process.env, ...env, ROYALTIES_DB: ROY }, stdio: ['ignore', 'pipe', 'pipe'] });
            let o = ''; c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { o += d; });
            c.on('close', (code) => resolve({ code, o, res: JSON.parse(o.trim().split('\n').pop() || '{}') }));
        });
        const first = await runWorker();
        ok('sin arnés, con flags, clave, registro y regla aprobada: 30 XP', first.code === 0 && first.res.inserted === true && first.res.xp === 30, first.o.slice(-300));
        ok('un hecho, lectura y reflexión, una entrada de XP', first.res.facts === 1 && first.res.cycles === 2 && first.res.entries === 1, JSON.stringify(first.res));
        const second = await runWorker();
        ok('repetir en otro proceso: 0 adicional, sin filas nuevas', second.code === 0 && second.res.inserted === false && second.res.xp === 0 && second.res.facts === 1 && second.res.entries === 1, JSON.stringify(second.res));
        const db2 = D.getGamificationDb({ env });
        ok('sin PM', noPm(db2));
        const P = await import('../policy.mjs');
        ok('la vía genérica no puede pagar XP por revisión', throwsCode(() => P.validateRules({ schema: 1, facts: { 'mook_review/evidence_reviewed': { xp: 1 } } }, { featureAllowlist: L.FEATURE_ALLOWLIST }), 'XP_SOURCE_LOCKED'));
        ok('ni con reglas sin recognition', throwsCode(() => L.createRuleSet(db2, { ruleVersion: 'gm-facts', createdBy: 'migration', rules: { schema: 1, facts: { 'mook_review/evidence_reviewed': { xp: 50 } } } }), 'XP_SOURCE_LOCKED'));
        ok('ni con una regla ya guardada', P.decideEmission({ rules: { schema: 1, facts: { 'mook_review/evidence_reviewed': { xp: 50 } } }, source: 'mook_review', factType: 'evidence_reviewed', eligibility: 'eligible', features: {}, xpEnabled: true, pmEnabled: false, usage: { day: 0, week: 0, daySource: 0 } }).xp === 0);
        const rf = L.recordFact(db2, { source: 'mook_review', sourceEventId: 'ev-generico', factType: 'evidence_reviewed', userId: 'lector', actorId: 'mediador', occurredAt: Date.now(), eligibility: 'eligible' }, { env });
        ok('recordFact de una revisión: observado, sin fila ni clave ocupada', rf.decision === 'observed' && rf.persisted === false && count(db2, 'gm_source_facts') === 1);
        D.closeGamificationDb({ resetBackoff: true });
        const policy = fs.readFileSync(path.join(HERE, '..', 'policy.mjs'), 'utf8');
        ok('`mook_review`: fuera de XP_LOCKED_SOURCES, solo por reconocimiento y sin PM', !/XP_LOCKED_SOURCES = Object\.freeze\(\[[^\]]*'mook_review'/.test(policy) && /XP_RECOGNITION_ONLY_SOURCES = Object\.freeze\(\['mook_review'\]\)/.test(policy) && !/PM_LOCKED_SOURCES/.test(policy) && /RETIRED_PM_FACT_KEYS/.test(policy));
        const product = [];
        const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { if (e.name === '__test__' || e.name === 'node_modules') continue; const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (/\.(mjs|js)$/.test(e.name)) product.push(p); } };
        walk(path.join(REPO, 'server'));
        const src = product.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
        ok('ningún código lee el contrato ni el acta', !/APROBACION|A7-A12|aprobaciones\//.test(src));
        ok('producción no importa el arnés', !/xpRecognition(Harness|Hooks)/.test(src));
        ok('ningún código fija un approvalRef', !/approvalRef\s*:\s*['"]/.test(src));
    }

    section('[aislamiento]');
    ok('stores reales intactos', realFiles.map(sha).join() === realBefore.join());
    ok('sin gamification.db real', fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db')) === realGam);
} catch (e) {
    fail++;
    console.error('  ✗ excepción', e);
} finally {
    try { I.closeIntake({ resetBackoff: true }); D.closeGamificationDb({ resetBackoff: true }); Pub.closeRoyaltiesDb(); } catch { /* noop */ }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`\nxpPilotEmission: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
