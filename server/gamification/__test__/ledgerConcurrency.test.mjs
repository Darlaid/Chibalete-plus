/**
 * ledgerConcurrency.test.mjs — CHP-GAMIFICACION-G3-01.
 *
 * Dos (y cuatro) PROCESOS sobre la misma gamification.db temporal, como api_1
 * y api_2 sobre el bind mount:
 *  [1] arranque simultáneo sobre una base inexistente: la migración se aplica
 *      una sola vez y nadie falla;
 *  [2] escrituras concurrentes: 100 hechos compartidos + 100 propios por
 *      réplica + ajustes; sin hechos duplicados, sin movimientos perdidos y
 *      snapshot = Σ ledger.
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/ledgerConcurrency.test.mjs
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
const WORKER = path.join(HERE, 'concurrencyWorker.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_conc_'));

function runReplicas(dbPath, roles) {
    const barrier = path.join(tmp, `go-${roles.join('-')}`);
    const env = { ...process.env, GAMIFICATION_ENABLED: '1', GAMIFICATION_DB: dbPath };
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

try {
    section('[1] arranque simultáneo (4 procesos) sobre una base inexistente');
    const MIG_DB = path.join(tmp, 'mig', 'gamification.db');
    const mig = await runReplicas(MIG_DB, ['migrate-a', 'migrate-b', 'migrate-c', 'migrate-d']);
    ok('los 4 procesos terminan sin error', mig.every((r) => r.code === 0 && r.errors.length === 0), JSON.stringify(mig));
    ok('todos ven exactamente 1 migración aplicada', mig.every((r) => r.migrations === 1), JSON.stringify(mig.map((r) => r.migrations)));

    section('[2] dos réplicas escribiendo a la vez');
    const DB = path.join(tmp, 'w', 'gamification.db');
    process.env.GAMIFICATION_ENABLED = '1';
    process.env.GAMIFICATION_DB = DB;
    const D = await import('../db.mjs');
    const L = await import('../ledger.mjs');
    const db0 = D.getGamificationDb();
    L.createRuleSet(db0, { ruleVersion: 'gm-conc-v1', rules: { pm: { mook_review: 7 } }, createdBy: 'migration' });
    D.closeGamificationDb();

    const [a, b] = await runReplicas(DB, ['api1', 'api2']);
    ok('ambas réplicas terminan sin error', a.code === 0 && b.code === 0 && a.errors.length === 0 && b.errors.length === 0, JSON.stringify([a.errors, b.errors]));
    ok('hechos insertados entre ambas = 300 (100 compartidos + 2×100 propios)', a.inserted + b.inserted === 300, `${a.inserted}+${b.inserted}`);
    ok('cada hecho compartido se insertó una sola vez (el resto, reintentos)', a.replayed + b.replayed === 100, `${a.replayed}+${b.replayed}`);

    const db = D.getGamificationDb();
    const n = (sql) => db.prepare(sql).get().n;
    ok('300 hechos en la base, ninguno duplicado', n('SELECT COUNT(*) n FROM gm_source_facts') === 300
        && n('SELECT COUNT(*) n FROM (SELECT source, source_event_id, fact_type FROM gm_source_facts GROUP BY 1,2,3 HAVING COUNT(*) > 1)') === 0);
    ok('300 movimientos earn y 300 asientos XP (uno por hecho, ninguno perdido)', n("SELECT COUNT(*) n FROM gm_pm_movements WHERE kind='earn'") === 300 && n('SELECT COUNT(*) n FROM gm_xp_entries') === 300);
    ok('ajustes en la base = ajustes reportados por las réplicas', n("SELECT COUNT(*) n FROM gm_pm_movements WHERE kind='adjustment'") === a.adjustments + b.adjustments, `${a.adjustments}+${b.adjustments}`);
    const v = L.verifyLedger(db);
    ok('snapshot = Σ ledger tras la carrera', v.ok, JSON.stringify(v.divergences).slice(0, 300));
    const sum = n('SELECT COALESCE(SUM(amount),0) n FROM gm_pm_movements');
    const snap = n('SELECT COALESCE(SUM(available),0) n FROM gm_pm_balances');
    ok(`Σ saldos (${snap}) = Σ movimientos (${sum}) = 300×7 − 3×ajustes`, snap === sum && sum === 300 * 7 - 3 * (a.adjustments + b.adjustments));
    ok('ningún saldo negativo (los ajustes no pueden dejarlo así)', n('SELECT COUNT(*) n FROM gm_pm_balances WHERE available < 0') === 0);
    ok('seq estrictamente creciente sin huecos de movimientos', n('SELECT COUNT(*) n FROM gm_pm_movements') === n('SELECT MAX(seq) - MIN(seq) + 1 n FROM gm_pm_movements'));
    D.closeGamificationDb();
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    ok('la base real data-critical/gamification.db no se creó ni cambió de estado', fs.existsSync(REAL_DB) === realBefore);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nCHP-GAMIFICACION-G3-01 (concurrencia) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
