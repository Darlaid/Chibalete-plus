/**
 * subjectReconcile.test.mjs — CHP-GAMIFICACION-PRIV-01C.
 *
 * Fuentes MOOK y reconciliación sobre el modelo de sujeto, con bases temporales
 * y usuarios sintéticos:
 *  [1] identificadores de fuente sin identidad canónica
 *  [2] cuentas no elegibles: ni filas ni sujetos, por todos los caminos
 *  [3] idempotencia antes y después de reinicios
 *  [4] recuperación de hechos perdidos sin duplicar
 *  [5] minimización: features y logs
 *  [6] lo que no puede emitir no toma el lock de escritura
 *  [7] bloqueos G4 intactos
 *
 * Dos réplicas reconciliando: mookSource.test.mjs [5] y ledgerConcurrency.test.mjs [4].
 *
 *   node server/gamification/__test__/subjectReconcile.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_recon_'));
const DB = path.join(tmp, 'gam', 'gamification.db');
process.env.GAMIFICATION_DB = DB;
const ENV = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '1', GAMIFICATION_DB: DB, GAMIFICATION_MOOK_SINCE: '2026-11-01T00:00:00.000Z' };

const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const R = await import('../reconcile.mjs');
const M = await import('../mookSource.mjs');
const I = await import('../intake.mjs');

const LECTOR = 'lector-sintetico-marcador';
const OTRO = 'otro-lector-sintetico-marcador';
const SYN = 'sintetico-marcador';
const INA = 'inactivo-marcador';
const GONE = 'borrado-marcador';
const MED = 'mediador-sintetico-marcador';
const MED_INA = 'mediador-inactivo-marcador';
const T = Date.UTC(2026, 10, 3, 17, 42, 13, 271);
const iso = (i) => new Date(T + i * 60_000).toISOString();
const USERS = { [LECTOR]: 'ok', [OTRO]: 'ok', [MED]: 'ok', [SYN]: 'syn', [INA]: 'ina', [MED_INA]: 'ina' };
const resolveUser = (id) => (USERS[id] ? { exists: true, active: USERS[id] !== 'ina', synthetic: USERS[id] === 'syn' } : null);
const run = (id, userId, version, at = iso(0)) => ({ id, userId, experienceVersionId: version, status: 'completed', completedAt: at });
const ev = (id, userId, reviewerId, decision = 'aprobado') => ({ id, userId, experienceVersionId: 'xv-1', review: { status: 'REVIEWED', reviewerId, decision, reviewedAt: iso(1) } });
const sweep = (doc) => R.reconcile(D.getGamificationDb({ env: ENV }), [...R.mookReviewCandidates(doc), ...R.mookExperienceCandidates(doc)], { resolveUser, env: ENV });
const count = (t) => D.getGamificationDb({ env: ENV }).prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
const hook = (fn, arg) => new Promise((resolve) => { let done = false; fn(arg, { resolveUser, env: ENV, onDone: (o) => { done = true; resolve(o); } }); setTimeout(() => { if (!done) resolve(null); }, 300); });

try {
    const db0 = D.getGamificationDb({ env: ENV });
    L.createRuleSet(db0, { ruleVersion: 'gm-r-v1', createdBy: 'migration', now: Date.UTC(2026, 0, 1), rules: { schema: 1, caps: { pmPerDay: 100, pmPerWeek: 300 },
        facts: { 'mook_review/evidence_reviewed': {}, 'mook_experience/experience_completed': { xp: 5 } } } });

    section('[1] identificadores de fuente');
    const doc = { evidence: [ev('evid-1', LECTOR, MED), ev('evid-cc', LECTOR, MED, 'con_comentarios')], runs: [run('r1', LECTOR, 'xv-1'), run('r2', OTRO, 'xv-1')] };
    const rev = R.mookReviewCandidates(doc);
    const exp = R.mookExperienceCandidates(doc);
    ok('solo la evidencia aprobada es candidata', rev.length === 1 && rev[0].sourceEventId === 'evid-1');
    ok('el id lógico de ruta no contiene al usuario', exp.every((c) => c.sourceEventId === 'xv-1'));
    ok('los candidatos no llevan features', [...rev, ...exp].every((c) => c.features === undefined));
    ok('una ruta sigue contando por usuario y versión', exp.length === 2);
    ok('la misma ruta repetida: un candidato, el más antiguo', (() => {
        const c = R.mookExperienceCandidates({ runs: [run('a', LECTOR, 'xv-2', iso(9)), run('b', LECTOR, 'xv-2', iso(3))] });
        return c.length === 1 && c[0].occurredAt === Date.parse(iso(3));
    })());

    section('[2] cuentas no elegibles');
    const bad = { evidence: [], runs: [run('r3', SYN, 'xv-9'), run('r4', INA, 'xv-9'), run('r5', GONE, 'xv-9')] };
    const sBad = sweep(bad);
    ok('el barrido las clasifica y no registra nada', sBad.recorded === 0 && sBad.byDecision.rejected_excluded_user === 1 && sBad.byDecision.rejected_inactive_account === 1 && sBad.byDecision.rejected_not_eligible === 1, JSON.stringify(sBad));
    ok('ni filas ni sujetos', count('gm_source_facts') === 0 && count('gm_subjects') === 0 && count('gm_xp_entries') === 0);
    for (const r of bad.runs) {
        const o = await hook(M.onMookRunUpdated, r);
        ok(`gancho ${r.userId}: sin persistir`, o?.ok && !o.result.persisted);
    }
    ok('los ganchos tampoco crean filas ni sujetos', count('gm_source_facts') === 0 && count('gm_subjects') === 0);
    ok('un revisor inactivo o inexistente no crea sujeto', R.candidateEligibility(resolveUser, { userId: LECTOR, actorId: MED_INA }) === 'rejected_not_eligible'
        && R.candidateEligibility(resolveUser, { userId: LECTOR, actorId: 'nadie' }) === 'rejected_not_eligible');
    ok('un revisor sintético tampoco', R.candidateEligibility(resolveUser, { userId: LECTOR, actorId: SYN }) === 'rejected_not_eligible');
    ok('revisor activo: elegible', R.candidateEligibility(resolveUser, { userId: LECTOR, actorId: MED }) === 'eligible');
    const self = await hook(M.onMookEvidenceReviewed, ev('evid-self', LECTOR, LECTOR));
    ok('autorrevisión: sin fila', self?.ok && self.result.decision === 'rejected_self_review' && !self.result.persisted);

    section('[3] idempotencia y reinicios');
    const s1 = sweep(doc);
    ok('primer barrido: las 2 rutas; la revisión no deja fila', s1.recorded === 2 && s1.byDecision.observed === 1, JSON.stringify(s1));
    ok('segundo barrido: nada nuevo', sweep(doc).recorded === 0);
    D.closeGamificationDb({ resetBackoff: true }); I.closeIntake({ resetBackoff: true });
    const s3 = sweep(doc);
    ok('tras reiniciar: nada nuevo, 2 ya registrados', s3.recorded === 0 && s3.alreadyRecorded === 2, JSON.stringify(s3));
    ok('un sujeto por usuario', count('gm_subjects') === 2);
    ok('el gancho repetido tras reiniciar no duplica', (await hook(M.onMookRunUpdated, run('r1', LECTOR, 'xv-1')))?.result?.inserted === false);

    section('[4] recuperación');
    const lost = { evidence: [], runs: [run('r6', LECTOR, 'xv-lost'), run('r7', OTRO, 'xv-lost')] };
    const x0 = L.getXp(D.getGamificationDb({ env: ENV }), LECTOR);
    ok('el barrido recupera los hechos perdidos', sweep(lost).recorded === 2);
    ok('una recompensa por hecho', L.getXp(D.getGamificationDb({ env: ENV }), LECTOR) === x0 + 5);
    ok('repetir no duplica la recompensa', sweep(lost).recorded === 0 && L.getXp(D.getGamificationDb({ env: ENV }), LECTOR) === x0 + 5);
    ok('el ledger cuadra', L.verifyLedger(D.getGamificationDb({ env: ENV })).ok);

    section('[5] minimización');
    const db = D.getGamificationDb({ env: ENV });
    const ids = [LECTOR, OTRO, SYN, INA, GONE, MED, MED_INA, 'xv-1', 'xv-lost', 'evid-1'];
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'gm_%' AND name <> 'gm_subjects'").all().map((r) => r.name);
    const rows = (t) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all());
    for (const t of tables) ok(`${t}: sin identidades ni ids de fuente en claro`, !ids.some((i) => rows(t).includes(i)));
    ok('los hechos no guardan features', db.prepare("SELECT COUNT(*) n FROM gm_source_facts WHERE features_json <> '{}'").get().n === 0);
    ok('MOOK no admite features', L.FEATURE_ALLOWLIST.mook_review.length === 0 && L.FEATURE_ALLOWLIST.mook_experience.length === 0);
    ok('ninguna lista admite modalidad, tiempo ni métricas', !Object.values(L.FEATURE_ALLOWLIST).flat().some((k) => /mode|Minutes|sessions|Days|Pct|monotonic|lengthUnits|reasons|decision/i.test(k)));
    const logs = [];
    const log = (m) => logs.push(String(m));
    const boom = () => { throw Object.assign(new Error(`fallo con ${LECTOR} y ${MED}`), { code: 'BOOM' }); };
    M.onMookEvidenceReviewed(ev('evid-log', LECTOR, MED), { resolveUser: boom, env: ENV, log });
    M.onMookRunUpdated(run('r8', LECTOR, 'xv-log'), { resolveUser: boom, env: ENV, log });
    await new Promise((resolve) => I.scheduleFact({ source: 'mook_experience', sourceEventId: 'xv-x', factType: 'experience_completed', userId: LECTOR, occurredAt: T, eligibility: 'bad' },
        { env: ENV, log, onDone: resolve }));
    ok('hay diagnóstico', logs.length === 3, logs.join(' | '));
    ok('los logs solo llevan códigos', logs.every((m) => !ids.some((i) => m.includes(i))), logs.join(' | '));
    const sources = ['reconcile.mjs', 'mookSource.mjs', 'intake.mjs', 'ledger.mjs', 'subjects.mjs', 'db.mjs'].map((f) => fs.readFileSync(path.join(HERE, '..', f), 'utf8'));
    ok('ningún log interpola identidad', sources.every((s) => ![...s.matchAll(/log\(`([^`]*)`/g)].some((m) => /userId|actorId|user_id|\.id\b|e\?\.message\}/.test(m[1]) && !/retry after|gamification-migrate/.test(m[1]))));

    section('[6] sin lock de escritura para lo que no puede emitir');
    const lockDb = D.getGamificationDb({ env: ENV });
    const noTx = (f) => { const t0 = lockDb.transaction; let used = false; lockDb.transaction = (...a) => { used = true; return t0.apply(lockDb, a); }; const r = L.recordFact(lockDb, f, { env: ENV }); lockDb.transaction = t0; return { used, r }; };
    const base = { sourceEventId: 'x', userId: LECTOR, occurredAt: T, now: T };
    ok('fuente bloqueada: sin transacción', noTx({ ...base, source: 'mook_review', factType: 'evidence_reviewed', eligibility: 'eligible' }).used === false);
    ok('no elegible: sin transacción', noTx({ ...base, source: 'mook_experience', factType: 'experience_completed', eligibility: 'rejected_inactive_account' }).used === false);
    ok('flags OFF: sin transacción', (() => { const t0 = lockDb.transaction; let used = false; lockDb.transaction = (...a) => { used = true; return t0.apply(lockDb, a); };
        L.recordFact(lockDb, { ...base, source: 'mook_experience', factType: 'experience_completed', eligibility: 'eligible' }, { env: { GAMIFICATION_ENABLED: '1' } }); lockDb.transaction = t0; return !used; })());
    ok('hecho emisible: con transacción', noTx({ ...base, sourceEventId: 'xv-tx', source: 'mook_experience', factType: 'experience_completed', eligibility: 'eligible' }).used === true);

    section('[7] bloqueos G4');
    const P = await import('../policy.mjs');
    ok('toda fuente sigue sin PM', Object.keys(P.SOURCE_GRADE).every((s) => P.PM_LOCKED_SOURCES.includes(s)));
    ok('solo ruta y misión admiten XP', Object.keys(P.SOURCE_GRADE).filter((s) => !P.XP_LOCKED_SOURCES.includes(s)).sort().join() === 'mission,mook_experience');
    ok('ningún PM emitido en toda la suite', count('gm_pm_movements') === 0);
    D.closeGamificationDb({ resetBackoff: true });
    ok('reconciliar sin clave de sujeto falla cerrado', await (async () => {
        const K = await import('../subjectKey.mjs');
        const keep = K.getSubjectKey();
        K.clearSubjectKey();
        const r = M.runMookReconcileOnce({ readMook: () => ({ evidence: [], runs: [run('r9', LECTOR, 'xv-nokey')] }), readUsers: () => [{ id: LECTOR }], isUserActive: () => true, isSyntheticUser: () => false, env: ENV });
        K.installSubjectKey(keep);
        return r.ok === false && r.code === 'SUBJECT_KEY_UNAVAILABLE';
    })());
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    try { D.closeGamificationDb({ resetBackoff: true }); I.closeIntake({ resetBackoff: true }); } catch { /* noop */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows puede retener un handle un instante */ }
}

console.log(`\nCHP-GAMIFICACION-PRIV-01C (fuentes y reconciliación) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
