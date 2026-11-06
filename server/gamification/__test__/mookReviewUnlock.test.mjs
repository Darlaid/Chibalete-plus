/**
 * mookReviewUnlock.test.mjs — V8-ACTIVATE-PREP-01.
 *
 * `mook_review` sale de `XP_LOCKED_SOURCES`: este test usa el código REAL, sin
 * arnés, y demuestra que la revisión MOOK solo da XP cuando se cumplen a la vez
 * todos los requisitos de activación (flags, clave, registro, regla aprobada con
 * `approvalRef`, corte, acceso explícito, revisión ajena aprobada) y que la vía
 * genérica de `facts` sigue sin poder pagarla.
 *  [1] flags apagadas  [2] G4 sin XP  [3] fallo cerrado  [4] corte
 *  [5] 30 / +20 / techo  [6] idempotencia  [7] acceso y derechos  [8] autorrevisión
 *  [9] PM  [10] vía genérica
 * Usuarios sintéticos y bases temporales. Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/mookReviewUnlock.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code ?? 'ERROR'; } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_unlock_'));

const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const P = await import('../policy.mjs');
const K = await import('../subjectKey.mjs');
const E = await import('../erasure.mjs');
const I = await import('../intake.mjs');

/** A7-A12-V3 §1 con un `approvalRef` sintético: el real lo emite Dirección. */
const APPROVED = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 }, pm: { reviewed: 0, validated: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [], pmFactors: [] } };
const RULES = { schema: 1, caps: { pmPerDay: 0, pmPerWeek: 0 }, facts: {}, recognition: APPROVED };

const SINCE = Date.now() - 60_000;
const WORDS = 'una dos tres cuatro cinco seis siete ocho';
const production = (id, ref) => ({ id, type: 'PRODUCTION', title: id, resourceRef: ref, config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } });
const reading = (id, ref) => ({ id, type: 'READING', title: id, resourceRef: ref });
const route = (doc, slug, work = 'obra-a') => {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [reading('r', work), production('p', work)] }] }, () => true);
    Store.publishVersion(doc, v.id);
    return { exp, v };
};
/** Entrega aprobada. `access` es el snapshot congelado en la entrega; `reviewer`, quien revisa. */
function deliver(doc, { exp, v }, { userId = 'lector', reviewer = 'mediador', access = { decision: 'allowed', via: 'SCOPE_TITLE' } } = {}) {
    const { run } = Store.startRun(doc, { userId, experienceId: exp.id });
    Store.completeNode(doc, run.id, 'r');
    const { evidence } = Store.submitEvidence(doc, { runId: run.id, nodeId: 'p', userId, payload: { text: WORDS },
        workAccess: { workRef: Store.productionWorkRef(v, 'p').workRef, ...access, at: new Date().toISOString() } });
    Store.reviewEvidence(doc, evidence.id, { reviewerId: reviewer, decision: 'aprobado' });
    return evidence;
}

let n = 0;
/** Base temporal con todos los requisitos; `over` quita o cambia alguno. */
function fresh({ rules = RULES, registry = true, envOver = {} } = {}) {
    n += 1;
    const dir = path.join(tmp, `g${n}`);
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true }); fs.mkdirSync(path.join(dir, 'reg'));
    const reg = path.join(dir, 'reg', 'r.jsonl');
    if (registry) fs.writeFileSync(reg, '');
    const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '', GAMIFICATION_DB: path.join(dir, 'db', 'gamification.db'),
        GAMIFICATION_EXCLUSION_REGISTRY: reg, GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString(), ...envOver };
    process.env.GAMIFICATION_DB = env.GAMIFICATION_DB;
    process.env.GAMIFICATION_EXCLUSION_REGISTRY = reg;
    D.closeGamificationDb({ resetBackoff: true });
    const db = D.getGamificationDb({ env: { ...env, GAMIFICATION_ENABLED: '1' } });
    if (rules) L.createRuleSet(db, { ruleVersion: 'gm-unlock-v1', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000, rules });
    return { db, env, dir };
}
const everyone = () => ({ exists: true, active: true, synthetic: false });
const open = () => () => false;
const sweep = (db, doc, env, over = {}) => M.recognizeMookWorks(db, doc, { workRefOf: Store.productionWorkRef, readRights: open, resolveUser: everyone, sinceMs: SINCE, env, now: Date.now(), ...over });
const count = (db, t, where = '1=1') => db.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ${where}`).get().c;
const sumXp = (db) => db.prepare('SELECT COALESCE(SUM(xp),0) n FROM gm_xp_entries').get().n;
const noPm = (db) => count(db, 'gm_pm_movements') === 0 && count(db, 'gm_pm_balances') === 0 && count(db, 'gm_work_cycles', 'pm <> 0') === 0;
const progressDeps = (doc) => ({ readMook: () => doc, workRefOf: Store.productionWorkRef, readRights: open, readUsers: () => [{ id: 'lector' }],
    isUserActive: () => true, isSyntheticUser: () => false, workAccessOf: async () => ({ decision: 'allowed', via: 'SCOPE_TITLE' }), titleOf: () => 'Obra A' });

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const realFiles = ['data/mook_db.json', 'data/content.json'].map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f));
const realBefore = realFiles.map(sha);
const realGam = fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db'));

try {
    section('[0] política real, sin arnés');
    ok('`mook_review` fuera de XP_LOCKED_SOURCES', !P.XP_LOCKED_SOURCES.includes('mook_review'));
    ok('pero solo por reconocimiento y nunca con PM', P.XP_RECOGNITION_ONLY_SOURCES.includes('mook_review') && P.PM_LOCKED_SOURCES.includes('mook_review') && P.isXpLockedForFacts('mook_review'));
    ok('lectura libre y validación presencial siguen bloqueadas', P.XP_LOCKED_SOURCES.includes('reading_completion') && P.XP_LOCKED_SOURCES.includes('offline_validation'));
    ok('ninguna fuente nueva', Object.keys(P.SOURCE_GRADE).sort().join() === 'mission,mook_experience,mook_review,offline_validation,reading_completion');

    section('[1] flags apagadas: ningún XP y ningún ledger');
    {
        const dir = path.join(tmp, 'off'); fs.mkdirSync(dir);
        const env = { GAMIFICATION_DB: path.join(dir, 'gamification.db'), GAMIFICATION_EXCLUSION_REGISTRY: path.join(dir, 'reg', 'r.jsonl'), GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString() };
        const doc = Store.emptyMookStore(); const ev = deliver(doc, route(doc, 'off'));
        let scheduled = false;
        M.onMookEvidenceReviewed(ev, { resolveUser: everyone, recognition: { readMook: () => doc, workRefOf: Store.productionWorkRef, readRights: open, onDone: () => { scheduled = true; } }, env, onDone: () => { scheduled = true; } });
        ok('el gancho no programa nada', scheduled === false);
        ok('no existe gamification.db', !fs.existsSync(env.GAMIFICATION_DB));
        ok('`Mi progreso` → 404', (await M.readMyProgress('lector', { ...progressDeps(doc), env })).status === 404);
        ok('reconciliador: no arranca', M.startMookReconciler({}, { env }) === null);
        ok('agregado de grupo: null', (await M.readGroupRecognition(['lector'], { env })) === null);
        ok('sin crear la base después', !fs.existsSync(env.GAMIFICATION_DB));
    }

    section('[2] GAMIFICATION_ENABLED con XP apagado: ningún reconocimiento');
    {
        const { db, env } = fresh();
        const off = { ...env, XP_EARNING_ENABLED: '' };
        const doc = Store.emptyMookStore(); deliver(doc, route(doc, 'g4'));
        ok('barrido: desactivado', sweep(db, doc, off).skipped === 'disabled');
        ok('sin hechos ni XP', count(db, 'gm_source_facts') === 0 && sumXp(db) === 0);
        const ev = doc.evidence[0];
        ok('API directa: disabled', L.recordWorkRecognition(db, { evidenceId: ev.id, userId: 'lector', actorId: 'mediador', at: Date.now(), workRef: 'obra-a', decision: 'aprobado' }, { env: off }).reason === 'disabled');
        ok('`Mi progreso` → enabled:false', (await M.readMyProgress('lector', { ...progressDeps(doc), env: off })).enabled === false);
    }

    section('[3] fallo cerrado: clave, registro y reglas');
    {
        const doc = Store.emptyMookStore(); deliver(doc, route(doc, 'fc'));
        {
            const { db, env } = fresh();
            const key = K.getSubjectKey();
            K.clearSubjectKey();
            ok('sin clave: el barrido no avanza (SUBJECT_KEY_UNAVAILABLE)', codeOf(() => sweep(db, doc, env)) === 'SUBJECT_KEY_UNAVAILABLE');
            ok('sin clave: sin filas', count(db, 'gm_source_facts') === 0 && sumXp(db) === 0);
            K.installSubjectKey(key);
        }
        {
            const { db, env } = fresh({ registry: false });
            ok('sin registro: el barrido no avanza (EXCLUSION_REGISTRY_UNAVAILABLE)', codeOf(() => sweep(db, doc, env)) === 'EXCLUSION_REGISTRY_UNAVAILABLE');
            ok('sin registro: sin filas', count(db, 'gm_source_facts') === 0);
        }
        {
            const { db, env, dir } = fresh();
            fs.writeFileSync(path.join(dir, 'reg', 'r.jsonl'), '{"id":"x","t":"y","d":"z","m":"00"}\n');
            ok('registro alterado: no avanza', codeOf(() => sweep(db, doc, env)) === 'EXCLUSION_REGISTRY_UNAVAILABLE' && count(db, 'gm_source_facts') === 0);
        }
        {
            const { db, env } = fresh({ rules: null });
            const r = sweep(db, doc, env);
            ok('sin reglas: no_active_rules, sin filas', r.notRecorded.no_active_rules === 1 && count(db, 'gm_source_facts') === 0, JSON.stringify(r));
        }
        {
            const { db, env } = fresh({ rules: { schema: 1, caps: { pmPerDay: 0, pmPerWeek: 0 }, facts: {} } });
            const r = sweep(db, doc, env);
            ok('reglas sin recognition: recognition_not_configured', r.notRecorded.recognition_not_configured === 1 && count(db, 'gm_source_facts') === 0, JSON.stringify(r));
        }
        {
            const { db } = fresh({ rules: null });
            const noRef = { ...APPROVED }; delete noRef.approvalRef;
            ok('recognition sin approvalRef: rechazada al crear', codeOf(() => L.createRuleSet(db, { ruleVersion: 'gm-sin-ref', createdBy: 'migration', rules: { ...RULES, recognition: noRef } })) === 'INVALID_RULES');
            ok('recognition con PM: rechazada', codeOf(() => L.createRuleSet(db, { ruleVersion: 'gm-pm', createdBy: 'migration', rules: { ...RULES, recognition: { ...APPROVED, amounts: { ...APPROVED.amounts, pm: { reviewed: 1, validated: 0 } } } } })) === 'INVALID_RULES');
            ok('reglas retroactivas: rechazadas', codeOf(() => L.createRuleSet(db, { ruleVersion: 'gm-retro', createdBy: 'migration', effectiveFrom: Date.now() - 86_400_000, rules: RULES })) === 'RETROACTIVE_RULES');
            ok('ninguna regla quedó guardada', count(db, 'gm_rule_sets') === 0);
        }
        {
            const { db, env } = fresh({ envOver: { GAMIFICATION_MOOK_SINCE: '' } });
            ok('sin corte: el reconciliador no arranca', M.startMookReconciler({}, { env }) === null);
            ok('sin corte: ningún candidato', M.mookApprovedReviewCandidates(doc, M.mookActivationSince(env)).length === 0 && count(db, 'gm_source_facts') === 0);
        }
    }

    section('[4] corte: sin retroactividad');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        const ev = deliver(doc, route(doc, 'antes'));
        ev.review.reviewedAt = new Date(SINCE - 3_600_000).toISOString();
        const r = sweep(db, doc, env);
        ok('aprobada antes del corte: 0 XP', r.recognized === 0 && sumXp(db) === 0 && count(db, 'gm_source_facts') === 0, JSON.stringify(r));
        ok('API directa: anterior a la regla', L.recordWorkRecognition(db, { evidenceId: ev.id, userId: 'lector', actorId: 'mediador', at: SINCE - 3_600_000, workRef: 'obra-a', decision: 'aprobado' }, { env }).reason === 'predates_rules');
    }

    section('[5] posterior al corte, autorizada y aprobada: 30, +20 y techo');
    let shared;
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        deliver(doc, route(doc, 'a'));
        const r1 = sweep(db, doc, env);
        ok('primera aprobación: 30 XP', r1.recognized === 1 && sumXp(db) === 30, JSON.stringify(r1));
        ok('lectura 10 + reflexión 20', count(db, 'gm_work_cycles', "act = 'reading' AND xp = 10") === 1 && count(db, 'gm_work_cycles', "act = 'reflection' AND xp = 20") === 1);
        deliver(doc, route(doc, 'b'));
        ok('segunda aprobación: +20 (50)', sweep(db, doc, env).recognized === 1 && sumXp(db) === 50);
        deliver(doc, route(doc, 'c'));
        const r3 = sweep(db, doc, env);
        ok('tercera: 0 por el techo, sin fila', r3.recognized === 0 && r3.notRecorded.no_xp_to_emit === 1 && sumXp(db) === 50 && count(db, 'gm_source_facts') === 2);
        const mp = await M.readMyProgress('lector', { ...progressDeps(doc), env });
        ok('`Mi progreso`: 50 XP y dos entradas por evidencia en el historial', mp.enabled === true && mp.xp === 50 && mp.history.length === 3, JSON.stringify({ xp: mp.xp, h: mp.history?.length }));
        ok('el historial suma lo mismo que el total', mp.history.reduce((s, h) => s + h.xp, 0) === mp.xp);
        shared = { db, env, doc };
    }

    section('[6] idempotencia: barrido, gancho y API');
    {
        const { db, env, doc } = shared;
        const again = sweep(db, doc, env);
        ok('reconciliación repetida: 0 adicional', again.recognized === 0 && again.already === 2 && sumXp(db) === 50, JSON.stringify(again));
        const ev = doc.evidence[0];
        const direct = L.recordWorkRecognition(db, { evidenceId: ev.id, userId: 'lector', actorId: 'mediador', at: Date.parse(ev.review.reviewedAt), workRef: 'obra-a', decision: 'aprobado' }, { env });
        ok('API directa sobre lo ya reconocido: 0', direct.inserted === false && direct.xp === 0 && !!direct.factId);
        const res = await new Promise((resolve) => M.onMookEvidenceReviewed(ev, { resolveUser: everyone, env,
            recognition: { readMook: () => doc, workRefOf: Store.productionWorkRef, readRights: open, onDone: resolve } }));
        ok('gancho sobre lo ya reconocido: 0', res.ok && res.result.already === 1 && sumXp(db) === 50, JSON.stringify(res));
        ok('el ledger cuadra, sin PM', L.verifyLedger(db).ok && count(db, 'gm_source_facts') === 2 && noPm(db));
    }

    section('[7] obra sin acceso o retirada: 0 XP');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        deliver(doc, route(doc, 'den'), { access: { decision: 'denied', via: 'SCOPE_NO_RULES' } });
        deliver(doc, route(doc, 'org'), { userId: 'otro', access: { decision: 'allowed', via: 'ORG_ALL' } });
        const r = sweep(db, doc, env);
        ok('acceso denegado o no explícito: 0 XP, sin filas', r.recognized === 0 && sumXp(db) === 0 && count(db, 'gm_source_facts') === 0, JSON.stringify(r));
        const doc2 = Store.emptyMookStore(); deliver(doc2, route(doc2, 'ret'));
        const w = sweep(db, doc2, env, { readRights: () => () => true });
        ok('obra retirada: 0 XP, pendiente', w.recognized === 0 && w.unattributed.work_withdrawn === 1 && sumXp(db) === 0, JSON.stringify(w));
        const u = sweep(db, doc2, env, { readRights: () => { throw new Error('sin derechos'); } });
        ok('derechos ilegibles: 0 XP', u.recognized === 0 && sumXp(db) === 0);
        ok('levantada la retirada: emite 30', sweep(db, doc2, env).recognized === 1 && sumXp(db) === 30);
    }

    section('[8] revisión: solo aprobación ajena');
    {
        const { db, env } = fresh();
        const doc = Store.emptyMookStore();
        deliver(doc, route(doc, 'self'), { reviewer: 'lector' });
        const r = sweep(db, doc, env);
        ok('autorrevisión: 0 XP', r.recognized === 0 && sumXp(db) === 0, JSON.stringify(r));
        const doc2 = Store.emptyMookStore();
        const { exp, v } = route(doc2, 'coment');
        const { run } = Store.startRun(doc2, { userId: 'lector', experienceId: exp.id });
        Store.completeNode(doc2, run.id, 'r');
        const { evidence } = Store.submitEvidence(doc2, { runId: run.id, nodeId: 'p', userId: 'lector', payload: { text: WORDS },
            workAccess: { workRef: Store.productionWorkRef(v, 'p').workRef, decision: 'allowed', via: 'SCOPE_TITLE', at: new Date().toISOString() } });
        Store.reviewEvidence(doc2, evidence.id, { reviewerId: 'mediador', decision: 'con_comentarios' });
        ok('revisada sin aprobar: 0 XP', sweep(db, doc2, env).recognized === 0 && sumXp(db) === 0);
        ok('excluido: 0 XP y sin sujeto', (() => { E.excludeUser(db, { userId: 'lector', env }); const doc3 = Store.emptyMookStore(); deliver(doc3, route(doc3, 'exc')); const x = sweep(db, doc3, env); return x.recognized === 0 && sumXp(db) === 0; })());
    }

    section('[9] PM: 0 en todas las situaciones');
    {
        const { db, env } = fresh({ envOver: { PM_EARNING_ENABLED: '1' } });
        const doc = Store.emptyMookStore(); deliver(doc, route(doc, 'pm')); deliver(doc, route(doc, 'pm2'));
        sweep(db, doc, env);
        ok('con PM_EARNING_ENABLED: XP sí, PM no', sumXp(db) === 50 && noPm(db));
    }

    section('[10] la vía genérica no paga la revisión');
    {
        const { db, env } = fresh();
        ok('validateRules: XP por facts → XP_SOURCE_LOCKED', codeOf(() => P.validateRules({ schema: 1, caps: { pmPerDay: 0, pmPerWeek: 0 }, facts: { 'mook_review/evidence_reviewed': { xp: 1 } } }, { featureAllowlist: L.FEATURE_ALLOWLIST })) === 'XP_SOURCE_LOCKED');
        ok('createRuleSet sin recognition: rechazada', codeOf(() => L.createRuleSet(db, { ruleVersion: 'gm-facts', createdBy: 'migration', rules: { schema: 1, caps: { pmPerDay: 0, pmPerWeek: 0 }, facts: { 'mook_review/evidence_reviewed': { xp: 50 } } } })) === 'XP_SOURCE_LOCKED');
        const rf = L.recordFact(db, { source: 'mook_review', sourceEventId: 'ev-gen', factType: 'evidence_reviewed', userId: 'lector', actorId: 'mediador', occurredAt: Date.now(), eligibility: 'eligible' }, { env });
        ok('recordFact: observado, sin fila', rf.decision === 'observed' && rf.persisted === false && count(db, 'gm_source_facts') === 0);
        ok('PM por facts sigue prohibido', codeOf(() => P.validateRules({ schema: 1, caps: { pmPerDay: 1, pmPerWeek: 1 }, facts: { 'mook_review/evidence_reviewed': { pm: 1 } } }, { featureAllowlist: L.FEATURE_ALLOWLIST })) === 'PM_SOURCE_LOCKED');
    }

    section('[aislamiento]');
    ok('stores reales intactos', realFiles.map(sha).join() === realBefore.join());
    ok('sin gamification.db real', fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db')) === realGam);
} catch (e) {
    fail++;
    console.error('  ✗ excepción', e);
} finally {
    try { I.closeIntake({ resetBackoff: true }); D.closeGamificationDb({ resetBackoff: true }); } catch { /* noop */ }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`\nmookReviewUnlock (V8-ACTIVATE-PREP-01): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
