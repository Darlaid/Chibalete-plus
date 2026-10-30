/**
 * ledgerConcurrency.test.mjs — CHP-GAMIFICACION-G3-01 / G3-02.
 *
 * Varios PROCESOS sobre la misma gamification.db temporal, como api_1 y api_2
 * sobre el bind mount:
 *  [1] arranque simultáneo (4) sobre una base inexistente: 1 migración;
 *  [2] escrituras concurrentes: sin duplicados ni movimientos perdidos;
 *  [3] topes bajo concurrencia: dos réplicas no exceden el tope diario;
 *  [4] reconciliación simultánea desde la misma fuente: sin duplicados;
 *  [5] interrupción abrupta a mitad de la reconciliación: el siguiente
 *      barrido recupera lo que faltaba, sin duplicar;
 *  [6] por qué no hay marca de agua: un hecho ANTERIOR perdido se recupera
 *      aunque otros posteriores ya estuvieran registrados.
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/ledgerConcurrency.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/pmMechanicsHarness.mjs';
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
const WORKER = path.join(HERE, 'concurrencyWorker.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_conc_'));
const EARN = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '1' };

let barrierN = 0;
function runReplicas(dbPath, roles, extraEnv = {}) {
    const barrier = path.join(tmp, `go-${++barrierN}`);
    const env = { ...process.env, GAMIFICATION_ENABLED: '1', GAMIFICATION_DB: dbPath, ...extraEnv };
    const procs = roles.map((role) => new Promise((resolve) => {
        const p = spawn(process.execPath, [WORKER, role, barrier], { env, stdio: ['ignore', 'pipe', 'pipe'] });
        let so = '', se = '';
        p.stdout.on('data', (d) => { so += d; });
        p.stderr.on('data', (d) => { se += d; });
        p.on('close', (code) => { try { resolve({ code, ...JSON.parse(so) }); } catch { resolve({ code, errors: [so, se] }); } });
    }));
    setTimeout(() => fs.writeFileSync(barrier, 'go'), 400); // todos cargados antes de soltar la barrera
    return Promise.all(procs);
}

process.env.GAMIFICATION_ENABLED = '1';
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const R = await import('../reconcile.mjs');
const openFresh = (dbPath, rules) => {
    D.closeGamificationDb({ resetBackoff: true });
    process.env.GAMIFICATION_DB = dbPath;
    const db = D.getGamificationDb();
    L.createRuleSet(db, { ruleVersion: 'gm-conc-v1', rules, createdBy: 'migration', now: Date.UTC(2026, 0, 1) });
    D.closeGamificationDb();
};
const BIG = { schema: 1, caps: { pmPerDay: 10000, pmPerWeek: 10000 }, facts: {
    'mission/mission_completed': { xp: 3, pm: 7 },
    'mook_review/evidence_reviewed': {},
    'mook_experience/experience_completed': { xp: 2 },
} };

// Documento MOOK sintético (forma real de experienceStore): 60 evidencias revisadas
// (10 con_comentarios, 5 autorrevisiones, 5 de usuario sintético) + 20 runs completados.
function mookFixture() {
    const iso = (i) => new Date(Date.UTC(2026, 9, 20, 12) + i * 60_000).toISOString();
    const evidence = Array.from({ length: 60 }, (_, i) => {
        const userId = i >= 55 ? `synthetic-${i}` : `u-${i % 6}`;
        const reviewerId = i >= 50 && i < 55 ? userId : 'u-mediador';
        return { id: `evid-${String(i).padStart(3, '0')}`, userId, experienceVersionId: 'xv-1', nodeId: `n${i}`,
            review: { status: 'REVIEWED', reviewerId, decision: i < 10 ? 'con_comentarios' : 'aprobado', reviewedAt: iso(i) } };
    });
    evidence.push({ id: 'evid-pending', userId: 'u-1', review: { status: 'SUBMITTED' } }); // no cuenta
    const runs = Array.from({ length: 20 }, (_, i) => ({ id: `run-${i}`, userId: `u-${i}`, experienceVersionId: 'xv-1', status: 'completed', completedAt: iso(i) }));
    runs.push({ id: 'run-active', userId: 'u-1', experienceVersionId: 'xv-1', status: 'active', completedAt: null });
    return { experiences: [], versions: [], runs, evidence };
}
const FIXTURE = path.join(tmp, 'mook_fixture.json');
fs.writeFileSync(FIXTURE, JSON.stringify(mookFixture()));
const EXPECTED_CANDIDATES = 50 + 20; // 10 con_comentarios no son candidatos
const EXPECTED_ROUTES = 20; // solo las rutas emiten: revisiones y rechazos no dejan fila

try {
    section('[1] arranque simultáneo (4 procesos) sobre una base inexistente');
    const mig = await runReplicas(path.join(tmp, 'mig', 'gamification.db'), ['migrate-a', 'migrate-b', 'migrate-c', 'migrate-d']);
    ok('los 4 procesos terminan sin error', mig.every((r) => r.code === 0 && r.errors.length === 0), JSON.stringify(mig));
    ok('todos ven exactamente 2 migraciones aplicadas', mig.every((r) => r.migrations === 2), JSON.stringify(mig.map((r) => r.migrations)));

    section('[2] dos réplicas escribiendo a la vez');
    const DB2 = path.join(tmp, 'w', 'gamification.db');
    openFresh(DB2, BIG);
    const [a, b] = await runReplicas(DB2, ['api1', 'api2']);
    ok('ambas réplicas terminan sin error', a.code === 0 && b.code === 0 && a.errors.length === 0 && b.errors.length === 0, JSON.stringify([a.errors, b.errors]));
    ok('hechos insertados entre ambas = 300 (100 compartidos + 2×100 propios)', a.inserted + b.inserted === 300, `${a.inserted}+${b.inserted}`);
    ok('cada hecho compartido se insertó una sola vez (el resto, reintentos)', a.replayed + b.replayed === 100, `${a.replayed}+${b.replayed}`);
    process.env.GAMIFICATION_DB = DB2;
    let db = D.getGamificationDb();
    let n = (sql) => db.prepare(sql).get().n;
    ok('300 hechos en la base, ninguno duplicado', n('SELECT COUNT(*) n FROM gm_source_facts') === 300
        && n('SELECT COUNT(*) n FROM (SELECT source, source_event_id, fact_type FROM gm_source_facts GROUP BY 1,2,3 HAVING COUNT(*) > 1)') === 0);
    ok('300 movimientos earn y 300 asientos XP (uno por hecho, ninguno perdido)', n("SELECT COUNT(*) n FROM gm_pm_movements WHERE kind='earn'") === 300 && n('SELECT COUNT(*) n FROM gm_xp_entries') === 300);
    ok('ajustes en la base = ajustes reportados por las réplicas', n("SELECT COUNT(*) n FROM gm_pm_movements WHERE kind='adjustment'") === a.adjustments + b.adjustments, `${a.adjustments}+${b.adjustments}`);
    ok('snapshot = Σ ledger tras la carrera', L.verifyLedger(db).ok);
    const sum = n('SELECT COALESCE(SUM(amount),0) n FROM gm_pm_movements');
    ok(`Σ saldos = Σ movimientos = 300×7 − 3×ajustes (${sum})`, n('SELECT COALESCE(SUM(available),0) n FROM gm_pm_balances') === sum && sum === 300 * 7 - 3 * (a.adjustments + b.adjustments));
    ok('ningún saldo negativo (los ajustes no pueden dejarlo así)', n('SELECT COUNT(*) n FROM gm_pm_balances WHERE available < 0') === 0);
    ok('seq estrictamente creciente sin huecos de movimientos', n('SELECT COUNT(*) n FROM gm_pm_movements') === n('SELECT MAX(seq) - MIN(seq) + 1 n FROM gm_pm_movements'));

    section('[3] topes bajo concurrencia: 2 réplicas × 50 hechos del mismo usuario');
    const DB3 = path.join(tmp, 'caps', 'gamification.db');
    openFresh(DB3, { schema: 1, caps: { pmPerDay: 100, pmPerWeek: 300 }, facts: { 'mission/mission_completed': { xp: 1, pm: 10 } } });
    const [c1, c2] = await runReplicas(DB3, ['caps-1', 'caps-2']);
    ok('ambas terminan sin error', c1.errors.length === 0 && c2.errors.length === 0, JSON.stringify([c1.errors, c2.errors]));
    process.env.GAMIFICATION_DB = DB3;
    db = D.getGamificationDb();
    n = (sql) => db.prepare(sql).get().n;
    const earned = n("SELECT COALESCE(SUM(amount),0) n FROM gm_pm_movements WHERE subject_ref=(SELECT subject_ref FROM gm_subjects WHERE user_id='u-hot') AND kind='earn'");
    ok(`PM emitidos al usuario = tope diario exacto (${earned} = 100), no más`, earned === 100 && c1.pm + c2.pm === 100, `${c1.pm}+${c2.pm}`);
    ok('100 hechos registrados: 10 awarded y 90 capped entre ambas', n("SELECT COUNT(*) n FROM gm_source_facts WHERE decision='awarded'") === 10 && n("SELECT COUNT(*) n FROM gm_source_facts WHERE decision='capped'") === 90);
    ok('el XP sí se emitió para los 100 (los topes son de PM)', n('SELECT COUNT(*) n FROM gm_xp_entries') === 100);
    ok('un solo sujeto por usuario entre las dos réplicas', n('SELECT COUNT(*) n FROM gm_subjects') === n('SELECT COUNT(DISTINCT user_id) n FROM gm_subjects') && n("SELECT COUNT(*) n FROM gm_subjects WHERE user_id='u-hot'") === 1);
    ok('snapshot = Σ ledger', L.verifyLedger(db).ok);

    section('[4] reconciliación simultánea de la misma fuente (2 procesos)');
    const DB4 = path.join(tmp, 'recon', 'gamification.db');
    openFresh(DB4, BIG);
    const [r1, r2] = await runReplicas(DB4, ['recon-1', 'recon-2'], { CHP_FIXTURE: FIXTURE });
    ok('ambas terminan sin error', r1.errors.length === 0 && r2.errors.length === 0, JSON.stringify([r1.errors, r2.errors]));
    ok(`cada una vio los ${EXPECTED_CANDIDATES} candidatos (evidencia SUBMITTED y runs activos fuera)`, r1.recon.scanned === EXPECTED_CANDIDATES && r2.recon.scanned === EXPECTED_CANDIDATES);
    ok('registrados entre ambas = las rutas que emiten (el resto no deja fila)', r1.recon.recorded + r2.recon.recorded === EXPECTED_ROUTES, JSON.stringify([r1.recon, r2.recon]));
    process.env.GAMIFICATION_DB = DB4;
    db = D.getGamificationDb();
    n = (sql) => db.prepare(sql).get().n;
    ok('20 hechos, ninguno duplicado', n('SELECT COUNT(*) n FROM gm_source_facts') === EXPECTED_ROUTES);
    const dec = Object.fromEntries(db.prepare('SELECT decision, COUNT(*) n FROM gm_source_facts GROUP BY decision').all().map((r) => [r.decision, r.n]));
    ok('solo persisten las 20 rutas awarded: ni observadas ni rechazos', Object.keys(dec).join() === 'awarded' && dec.awarded === 20, JSON.stringify(dec));
    ok('snapshot = Σ ledger', L.verifyLedger(db).ok);

    section('[5] interrupción abrupta a mitad de la reconciliación');
    const DB5 = path.join(tmp, 'crash', 'gamification.db');
    openFresh(DB5, BIG);
    const [cr] = await runReplicas(DB5, ['crash'], { CHP_FIXTURE: FIXTURE, CHP_CRASH_AFTER: '60' });
    ok('el proceso murió abruptamente (código 137, sin informe)', cr.code === 137, JSON.stringify(cr));
    process.env.GAMIFICATION_DB = DB5;
    db = D.getGamificationDb();
    n = (sql) => db.prepare(sql).get().n;
    ok('quedaron registradas exactamente las 10 rutas previas a la caída (tras 50 revisiones sin fila)', n('SELECT COUNT(*) n FROM gm_source_facts') === 10);
    ok('la base sigue íntegra y consistente tras la caída', db.pragma('integrity_check', { simple: true }) === 'ok' && L.verifyLedger(db).ok);
    const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    const cands = [...R.mookReviewCandidates(doc), ...R.mookExperienceCandidates(doc)];
    const resolveUser = (id) => ({ exists: true, active: true, synthetic: id.startsWith('synthetic-') });
    const rec = R.reconcile(db, cands, { resolveUser, env: EARN });
    ok('el siguiente barrido recupera las 10 restantes y salta las 10 ya registradas', rec.recorded === 10 && rec.alreadyRecorded === 10);
    ok('resultado final idéntico al de una reconciliación sin caída', n('SELECT COUNT(*) n FROM gm_source_facts') === EXPECTED_ROUTES && L.verifyLedger(db).ok
        && n("SELECT COUNT(*) n FROM gm_source_facts WHERE decision='awarded'") === 20);
    const again = R.reconcile(db, cands, { resolveUser, env: EARN });
    ok('un tercer barrido no registra nada (idempotente)', again.recorded === 0 && again.alreadyRecorded === EXPECTED_ROUTES);

    section('[6] sin marca de agua: un hecho ANTERIOR perdido se recupera');
    const DB6 = path.join(tmp, 'wm', 'gamification.db');
    openFresh(DB6, BIG);
    process.env.GAMIFICATION_DB = DB6;
    db = D.getGamificationDb();
    const reviews = R.mookExperienceCandidates(doc).sort((x, y) => x.occurredAt - y.occurredAt);
    const lost = reviews[12];
    for (const c of reviews) if (c !== lost) L.recordFact(db, { ...c, eligibility: 'eligible' }, { env: EARN }); // la entrada en línea perdió uno
    ok('el hecho perdido no está y sus posteriores sí', !L.hasFact(db, lost) && L.hasFact(db, reviews[13]));
    const wm = R.reconcile(db, reviews, { resolveUser, env: EARN });
    ok('el barrido completo lo encuentra y registra (una marca de agua lo habría perdido)', wm.recorded === 1 && L.hasFact(db, lost));

    section('[7] fuentes no recuperables quedan fuera de la reconciliación');
    const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };
    ok('reading_completion ⇒ SOURCE_NOT_RECOVERABLE', throwsCode(() => R.reconcile(db, [{ source: 'reading_completion', sourceEventId: 'u:c:w', factType: 'reading_completed', userId: 'u', occurredAt: 1 }], { resolveUser }), 'SOURCE_NOT_RECOVERABLE'));
    ok('offline_validation y mission ⇒ SOURCE_NOT_RECOVERABLE', ['offline_validation', 'mission'].every((s) => throwsCode(() => R.reconcile(db, [{ source: s, sourceEventId: 'x', factType: 't', userId: 'u', occurredAt: 1 }], { resolveUser }), 'SOURCE_NOT_RECOVERABLE')));
    ok('sin padrón (resolveUser) no se reconcilia ⇒ RESOLVE_USER_REQUIRED', throwsCode(() => R.reconcile(db, reviews, {}), 'RESOLVE_USER_REQUIRED'));
    ok('usuario inexistente o inactivo ⇒ rechazo sin fila ni sujeto', (() => {
        const r = R.reconcile(db, [{ ...reviews[0], sourceEventId: 'ghost-1', userId: 'u-ghost' }, { ...reviews[0], sourceEventId: 'ina-1', userId: 'u-ina' }],
            { resolveUser: (id) => (id === 'u-ghost' ? null : { exists: true, active: false, synthetic: false }), env: EARN });
        return r.byDecision.rejected_not_eligible === 1 && r.byDecision.rejected_inactive_account === 1 && r.recorded === 0
            && !db.prepare("SELECT 1 FROM gm_subjects WHERE user_id IN ('u-ghost','u-ina')").get();
    })());
    D.closeGamificationDb();
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    D.closeGamificationDb({ resetBackoff: true });
    ok('la base real data-critical/gamification.db no se creó ni cambió de estado', fs.existsSync(REAL_DB) === realBefore);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nCHP-GAMIFICACION-G3 (concurrencia y recuperación) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
