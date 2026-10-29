/**
 * mookSource.test.mjs — CHP-GAMIFICACION-G3-03.
 *
 * MOOK como fuente de hechos, sobre gamification.db TEMPORAL y datos
 * sintéticos con la forma real de experienceStore:
 *  [1] evidencia aprobada ⇒ un solo hecho (gancho repetido + reconciliación)
 *  [2] autorrevisión ⇒ sin recompensa
 *  [3] con_comentarios ⇒ ni hecho, ni XP, ni PM
 *  [4] experiencia completada ⇒ idempotente (también si repite la ruta)
 *  [5] dos réplicas reconciliando a la vez ⇒ sin duplicados, una por barrido
 *  [6] evento perdido (caída entre la escritura MOOK y el gancho) ⇒ se recupera
 *  [7] eventos anteriores al corte ⇒ sin puntos retroactivos
 *  [8] flag OFF / sin corte ⇒ ni archivos ni hechos ni temporizadores
 *  [+] cuentas inactivas, sintéticas o inexistentes; lock huérfano
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/mookSource.test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const REAL_DB = path.join(REPO, 'data-critical', 'gamification.db');
const realBefore = fs.existsSync(REAL_DB);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_mook_'));

const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const I = await import('../intake.mjs');

const SINCE_ISO = '2026-11-01T00:00:00.000Z';
const SINCE = Date.parse(SINCE_ISO);
const iso = (minutesAfterSince) => new Date(SINCE + minutesAfterSince * 60_000).toISOString();
const RULES = { schema: 1, caps: { pmPerDay: 1000, pmPerWeek: 5000 }, facts: {
    'mook_review/evidence_reviewed': { xp: 30, pm: 20, emitWhen: { decision: ['aprobado'] } },
    'mook_experience/experience_completed': { xp: 20, pm: 10 },
} };
const USERS = [
    { id: 'u-lector', accountStatus: 'active' },
    { id: 'u-lector2' },
    { id: 'u-mediador', accountStatus: 'active' },
    { id: 'u-inactivo', accountStatus: 'disabled' },
    { id: 'u-sintetico', accountStatus: 'active', _loadtest_marker: 'lt-1' },
];
const isUserActive = (u) => !u.accountStatus || u.accountStatus === 'active';
const isSyntheticUser = (u) => !!u._loadtest_marker;
const resolveUser = M.makeResolveUser(USERS, isUserActive, isSyntheticUser);

const ev = (id, userId, reviewerId, decision, at) => ({ id, userId, experienceVersionId: 'xv-1', nodeId: 'n2', nodeType: 'PRODUCTION',
    review: { status: 'REVIEWED', reviewerId, decision, reviewedAt: at } });
const run = (id, userId, at, status = 'completed') => ({ id, userId, experienceId: 'exp-1', experienceVersionId: 'xv-1', status, completedAt: at });

let dbN = 0;
function freshEnv() {
    D.closeGamificationDb({ resetBackoff: true });
    I.closeIntake({ resetBackoff: true });
    const p = path.join(tmp, `db${++dbN}`, 'gamification.db');
    const env = { GAMIFICATION_ENABLED: '1', PM_EARNING_ENABLED: '1', GAMIFICATION_DB: p, GAMIFICATION_MOOK_SINCE: SINCE_ISO };
    const db = D.getGamificationDb({ env });
    // Vigentes desde el reloj real: los hechos se registran con Date.now() (D48 prospectivo).
    L.createRuleSet(db, { ruleVersion: 'gm-mook-v1', rules: RULES, createdBy: 'migration', now: Date.now() - 1000 });
    return { env, db, p };
}
const hook = (fn, arg, env) => new Promise((resolve) => {
    let called = false;
    fn(arg, { resolveUser, env, onDone: (o) => { called = true; resolve(o); } });
    setTimeout(() => { if (!called) resolve(null); }, 300); // el gancho no programó nada
});
const facts = (db) => db.prepare('SELECT source, source_event_id, decision, user_id FROM gm_source_facts ORDER BY source, source_event_id').all();
const reconcileDoc = (env, doc) => M.runMookReconcileOnce({ readMook: () => doc, readUsers: () => USERS, isUserActive, isSyntheticUser, env });

try {
    section('[1] evidencia aprobada ⇒ un solo hecho elegible');
    let { env, db } = freshEnv();
    const e1 = ev('evid-1', 'u-lector', 'u-mediador', 'aprobado', iso(10));
    const o1 = await hook(M.onMookEvidenceReviewed, e1, env);
    ok('el gancho registra el hecho con la regla vigente (awarded, 30 XP, 20 PM)', o1?.ok && o1.result.inserted && o1.result.decision === 'awarded' && o1.result.xp === 30 && o1.result.pm === 20, JSON.stringify(o1));
    ok('el sourceEventId es el id de la evidencia (determinista)', facts(db)[0]?.source_event_id === 'evid-1');
    await hook(M.onMookEvidenceReviewed, e1, env);
    await hook(M.onMookEvidenceReviewed, e1, env);
    const r1 = reconcileDoc(env, { evidence: [e1], runs: [] });
    ok('gancho ×3 + reconciliación ⇒ 1 hecho y 1 movimiento', facts(db).length === 1 && db.prepare('SELECT COUNT(*) n FROM gm_pm_movements').get().n === 1 && r1.alreadyRecorded === 1, JSON.stringify(r1));

    section('[2] autorrevisión ⇒ sin recompensa');
    const e2 = ev('evid-2', 'u-mediador', 'u-mediador', 'aprobado', iso(11));
    const o2 = await hook(M.onMookEvidenceReviewed, e2, env);
    ok('revisor = autor ⇒ rejected_self_review, 0 XP, 0 PM', o2?.ok && o2.result.decision === 'rejected_self_review' && o2.result.xp === 0 && o2.result.pm === 0);
    ok('queda trazado sin movimiento', db.prepare("SELECT COUNT(*) n FROM gm_pm_movements WHERE user_id='u-mediador'").get().n === 0);

    section('[3] con_comentarios (y cualquier decisión no aprobada) ⇒ nada');
    for (const d of ['con_comentarios', 'rechazado', undefined]) {
        const o = await hook(M.onMookEvidenceReviewed, ev(`evid-3-${d}`, 'u-lector', 'u-mediador', d, iso(12)), env);
        ok(`decisión «${d}»: el gancho no programa ningún hecho`, o === null);
    }
    const pending = { id: 'evid-3-pend', userId: 'u-lector', review: { status: 'SUBMITTED' } };
    ok('evidencia sin revisar: tampoco', (await hook(M.onMookEvidenceReviewed, pending, env)) === null);
    const r3 = reconcileDoc(env, { evidence: [ev('evid-3-cc', 'u-lector', 'u-mediador', 'con_comentarios', iso(12)), pending], runs: [] });
    ok('la reconciliación tampoco los ve (0 candidatos)', r3.ok && r3.scanned === 0);
    ok('ningún hecho, XP ni PM por con_comentarios', !facts(db).some((f) => f.source_event_id.startsWith('evid-3')));

    section('[4] experiencia completada ⇒ idempotente');
    const ru = run('run-1', 'u-lector', iso(20));
    const o4 = await hook(M.onMookRunUpdated, ru, env);
    ok('el gancho registra experience_completed (20 XP, 10 PM)', o4?.ok && o4.result.decision === 'awarded' && o4.result.xp === 20 && o4.result.pm === 10);
    ok('sourceEventId determinista = usuario:versión', facts(db).some((f) => f.source === 'mook_experience' && f.source_event_id === 'u-lector:xv-1'));
    await hook(M.onMookRunUpdated, ru, env);
    const rerun = run('run-2', 'u-lector', iso(90)); // abandonó y repitió la ruta de la misma versión
    await hook(M.onMookRunUpdated, rerun, env);
    reconcileDoc(env, { evidence: [], runs: [ru, rerun] });
    ok('gancho ×2 + repetir la ruta + reconciliación ⇒ 1 hecho de experiencia', facts(db).filter((f) => f.source === 'mook_experience').length === 1);
    ok('un run activo no produce nada', (await hook(M.onMookRunUpdated, run('run-3', 'u-lector2', null, 'active'), env)) === null);
    ok('snapshot = Σ ledger', L.verifyLedger(db).ok);

    section('[5] dos réplicas reconciliando a la vez');
    ({ env, db } = freshEnv());
    D.closeGamificationDb();
    const doc5 = { evidence: Array.from({ length: 40 }, (_, i) => ev(`evid-r-${i}`, i % 2 ? 'u-lector' : 'u-lector2', 'u-mediador', 'aprobado', iso(30 + i))),
        runs: Array.from({ length: 10 }, (_, i) => ({ ...run(`run-r-${i}`, `u-lector`, iso(30 + i)), experienceVersionId: `xv-${i}` })) };
    const FIX = path.join(tmp, 'doc5.json'); fs.writeFileSync(FIX, JSON.stringify(doc5));
    const UF = path.join(tmp, 'users.json'); fs.writeFileSync(UF, JSON.stringify(USERS));
    const barrier = path.join(tmp, 'go5');
    const spawnW = (role) => new Promise((resolve) => {
        const p = spawn(process.execPath, [path.join(HERE, 'mookWorker.mjs'), role, barrier], { env: { ...process.env, ...env, CHP_FIXTURE: FIX, CHP_USERS: UF }, stdio: ['ignore', 'pipe', 'pipe'] });
        let so = '', se = ''; p.stdout.on('data', (d) => { so += d; }); p.stderr.on('data', (d) => { se += d; });
        p.on('close', (code) => { try { resolve({ code, ...JSON.parse(so) }); } catch { resolve({ code, err: so + se }); } });
    });
    const ws = [spawnW('api1'), spawnW('api2')];
    setTimeout(() => fs.writeFileSync(barrier, 'go'), 400);
    const [w1, w2] = await Promise.all(ws);
    const allRuns = [...(w1.runs || []), ...(w2.runs || [])];
    ok('ambas réplicas terminan sin error', w1.code === 0 && w2.code === 0 && allRuns.every((r) => r.ok || r.skipped === 'locked'), JSON.stringify([w1, w2]).slice(0, 400));
    ok('barridos efectivos suman exactamente 50 hechos registrados', allRuns.filter((r) => r.ok).reduce((s, r) => s + r.recorded, 0) === 50);
    db = D.getGamificationDb({ env });
    ok('50 hechos en la base, ninguno duplicado', facts(db).length === 50 && new Set(facts(db).map((f) => `${f.source}:${f.source_event_id}`)).size === 50);
    ok('el lock del reconciliador no quedó huérfano', !fs.existsSync(`${env.GAMIFICATION_DB}.reconcile.lock`));
    ok('snapshot = Σ ledger', L.verifyLedger(db).ok);

    section('[6] evento perdido entre la escritura MOOK y el gancho ⇒ se recupera');
    ({ env, db } = freshEnv());
    const lost = ev('evid-lost', 'u-lector', 'u-mediador', 'aprobado', iso(40)); // MOOK lo escribió; el proceso cayó antes del gancho
    const lostRun = run('run-lost', 'u-lector2', iso(41));
    D.closeGamificationDb(); I.closeIntake({ resetBackoff: true }); // «reinicio»
    const r6 = reconcileDoc(env, { evidence: [lost], runs: [lostRun] });
    db = D.getGamificationDb({ env });
    ok('el barrido tras el reinicio recupera la evidencia y la experiencia', r6.ok && r6.recorded === 2 && facts(db).length === 2, JSON.stringify(r6));
    ok('un segundo barrido no duplica', reconcileDoc(env, { evidence: [lost], runs: [lostRun] }).recorded === 0 && facts(db).length === 2);

    section('[7] eventos anteriores al corte ⇒ sin puntos retroactivos');
    const old = ev('evid-old', 'u-lector', 'u-mediador', 'aprobado', iso(-1));
    const oldRun = run('run-old', 'u-lector', iso(-60 * 24));
    ok('el gancho no programa la evidencia previa al corte', (await hook(M.onMookEvidenceReviewed, old, env)) === null);
    ok('ni la experiencia previa al corte', (await hook(M.onMookRunUpdated, oldRun, env)) === null);
    const r7 = reconcileDoc(env, { evidence: [old, lost], runs: [oldRun, lostRun] });
    ok('la reconciliación los excluye: solo ve los 2 posteriores (ya registrados)', r7.scanned === 2 && r7.recorded === 0);
    ok('ningún hecho previo al corte en la base', !facts(db).some((f) => ['evid-old', 'u-lector:xv-1'].includes(f.source_event_id) && f.source_event_id !== 'u-lector2:xv-1'));
    ok('justo en el corte sí cuenta (>=)', M.mookApprovedReviewCandidates({ evidence: [ev('evid-edge', 'u-lector', 'u-mediador', 'aprobado', SINCE_ISO)] }, SINCE).length === 1);

    section('[+] sujetos no elegibles y lock huérfano');
    const oi = await hook(M.onMookEvidenceReviewed, ev('evid-ina', 'u-inactivo', 'u-mediador', 'aprobado', iso(50)), env);
    const os_ = await hook(M.onMookEvidenceReviewed, ev('evid-syn', 'u-sintetico', 'u-mediador', 'aprobado', iso(50)), env);
    const og = await hook(M.onMookEvidenceReviewed, ev('evid-ghost', 'u-fantasma', 'u-mediador', 'aprobado', iso(50)), env);
    ok('inactivo ⇒ rejected_inactive_account, sin emisión', oi?.result?.decision === 'rejected_inactive_account' && oi.result.pm === 0);
    ok('sintético ⇒ rejected_excluded_user, sin emisión', os_?.result?.decision === 'rejected_excluded_user' && os_.result.pm === 0);
    ok('inexistente ⇒ rejected_not_eligible, sin emisión', og?.result?.decision === 'rejected_not_eligible' && og.result.pm === 0);
    const lockFile = `${env.GAMIFICATION_DB}.reconcile.lock`;
    fs.writeFileSync(lockFile, '999999');
    ok('lock vigente de otra réplica ⇒ este barrido se salta', reconcileDoc(env, { evidence: [], runs: [] }).skipped === 'locked');
    const past = new Date(Date.now() - M.LOCK_STALE_MS - 60_000);
    fs.utimesSync(lockFile, past, past);
    const rs = reconcileDoc(env, { evidence: [], runs: [] });
    ok('lock huérfano (> 10 min) ⇒ se libera y el barrido corre', rs.ok === true && !fs.existsSync(lockFile), JSON.stringify(rs));

    section('[8] flag OFF / sin corte: nada');
    D.closeGamificationDb({ resetBackoff: true }); I.closeIntake({ resetBackoff: true });
    const OFFP = path.join(tmp, 'off', 'gamification.db');
    const OFF = { GAMIFICATION_DB: OFFP, GAMIFICATION_MOOK_SINCE: SINCE_ISO };
    ok('gancho de revisión con flag OFF: no programa nada', (await hook(M.onMookEvidenceReviewed, e1, OFF)) === null);
    ok('gancho de run con flag OFF: no programa nada', (await hook(M.onMookRunUpdated, ru, OFF)) === null);
    ok('reconciliación con flag OFF ⇒ skipped: disabled', reconcileDoc(OFF, { evidence: [e1], runs: [] }).skipped === 'disabled');
    const logs = [];
    ok('startMookReconciler con flag OFF ⇒ null (sin temporizadores)', M.startMookReconciler({}, { env: OFF, log: (m) => logs.push(m) }) === null);
    ok('ningún archivo ni directorio creado con flag OFF', !fs.existsSync(OFFP) && !fs.existsSync(path.dirname(OFFP)));
    const NOCUT = { GAMIFICATION_ENABLED: '1', PM_EARNING_ENABLED: '1', GAMIFICATION_DB: OFFP };
    ok('flag ON sin GAMIFICATION_MOOK_SINCE: el gancho no programa nada', (await hook(M.onMookEvidenceReviewed, e1, NOCUT)) === null);
    ok('…la reconciliación se salta (no_activation_cutoff)', reconcileDoc(NOCUT, { evidence: [e1], runs: [] }).skipped === 'no_activation_cutoff');
    ok('…y no se programa ningún temporizador, con aviso explícito', M.startMookReconciler({}, { env: NOCUT, log: (m) => logs.push(m) }) === null && logs.some((l) => /GAMIFICATION_MOOK_SINCE/.test(l)));
    ok('corte inválido equivale a ausente', M.mookActivationSince({ GAMIFICATION_MOOK_SINCE: 'ayer' }) === null);
    ok('…y tampoco se creó la base', !fs.existsSync(OFFP));
    const sched = M.startMookReconciler({}, { env: { ...NOCUT, GAMIFICATION_MOOK_SINCE: SINCE_ISO, GAMIFICATION_RECONCILE_INTERVAL_MS: '5' } });
    ok('intervalo configurable con mínimo conservador (1 min) y valor por defecto de 15 min', sched.intervalMs === M.MIN_INTERVAL_MS
        && M.startMookReconciler({}, { env: { ...NOCUT, GAMIFICATION_MOOK_SINCE: SINCE_ISO } }).intervalMs === 15 * 60_000);
    sched.stop();
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    I.closeIntake({ resetBackoff: true });
    D.closeGamificationDb({ resetBackoff: true });
    ok('la base real data-critical/gamification.db no se creó ni cambió de estado', fs.existsSync(REAL_DB) === realBefore);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nCHP-GAMIFICACION-G3-03 (MOOK) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
