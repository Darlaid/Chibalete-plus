/**
 * ledgerBackupRestore.test.mjs — CHP-GAMIFICACION-G3-01.
 *
 * Respaldo y restauración AISLADOS de una gamification.db de prueba con la
 * función REAL del runner de backups (`capture_sqlite`, Online Backup API +
 * integrity_check, ops/backup/CHP-BACKUP-01B). Comprueba que la copia:
 *  - se toma con la base abierta en WAL y una escritura sin checkpoint;
 *  - conserva el historial completo (hash de cada tabla) y el snapshot;
 *  - restaurada, sigue rechazando UPDATE/DELETE (los triggers viajan) y
 *    mantiene la idempotencia (re-procesar los mismos hechos no duplica).
 * No modifica stores.py: la incorporación real al runner es su propia unidad.
 * Sin Python disponible ⇒ SKIP explícito (el runner es Python).
 *
 *   node server/gamification/__test__/ledgerBackupRestore.test.mjs
 */
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
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
const RUNNERS = path.join(REPO, 'ops', 'backup', 'CHP-BACKUP-01B', 'runners');

const python = ['python3', 'python'].find((bin) => spawnSync(bin, ['-c', 'import sqlite3'], { stdio: 'ignore' }).status === 0);
if (!python) {
    console.log('ledgerBackupRestore — SKIP (sin Python: el runner de backups es Python)');
    process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_backup_'));
const SRC = path.join(tmp, 'live', 'gamification.db');
const COPY = path.join(tmp, 'backup', 'gamification.db');
const RESTORED = path.join(tmp, 'restored', 'gamification.db');
fs.mkdirSync(path.dirname(COPY), { recursive: true });

process.env.GAMIFICATION_ENABLED = '1';
process.env.GAMIFICATION_DB = SRC;
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const RV = 'gm-bk-v1';
const TABLES = ['gm_rule_sets', 'gm_source_facts', 'gm_xp_entries', 'gm_achievements', 'gm_pm_movements', 'gm_pm_balances',
    'gm_redemptions', 'gm_redemption_transitions', 'gm_reward_grants', 'gm_admin_audit', '_migrations'];
const tableHash = (db, t) => crypto.createHash('sha256').update(JSON.stringify(db.prepare(`SELECT * FROM ${t} ORDER BY rowid`).all())).digest('hex');
const fact = (i, user) => ({ source: 'mook_review', sourceEventId: `bk-${i}`, factType: 'evidence_reviewed', userId: user,
    actorId: 'u-med', occurredAt: Date.now(), eligibility: 'eligible', features: { decision: 'aprobado' } });
const EARN = { GAMIFICATION_ENABLED: '1', PM_EARNING_ENABLED: '1' };
const RULES = { schema: 1, caps: { pmPerDay: 10000, pmPerWeek: 10000 }, facts: { 'mook_review/evidence_reviewed': { xp: 5, pm: 11 } } };

try {
    section('[1] base viva con historial, en WAL y sin checkpoint');
    const db = D.getGamificationDb();
    L.createRuleSet(db, { ruleVersion: RV, rules: RULES, createdBy: 'migration' });
    for (let i = 0; i < 40; i++) L.recordFact(db, fact(i, `u-${i % 4}`), { env: EARN });
    const mv = db.prepare('SELECT movement_id, user_id FROM gm_pm_movements ORDER BY seq LIMIT 1').get();
    L.appendAdjustment(db, { userId: 'u-1', amount: 4, reasonCode: 'support', actorId: 'admin-1', idempotencyKey: 'a1', ruleVersion: RV });
    L.appendCompensation(db, { userId: mv.user_id, amount: -11, reasonCode: 'correction', actorId: 'admin-1', relatedMovementId: mv.movement_id, idempotencyKey: 'c1', ruleVersion: RV });
    ok('el WAL tiene páginas sin volcar al archivo principal', fs.existsSync(`${SRC}-wal`) && fs.statSync(`${SRC}-wal`).size > 0);
    const hashesBefore = Object.fromEntries(TABLES.map((t) => [t, tableHash(db, t)]));
    const balancesBefore = JSON.stringify(db.prepare('SELECT * FROM gm_pm_balances ORDER BY user_id').all());

    section('[2] captura con la función real del runner (con la base abierta)');
    const py = [
        'import json, sys',
        `sys.path.insert(0, ${JSON.stringify(RUNNERS)})`,
        'from chibalete_backup.sqlite_capture import capture_sqlite',
        'class Log:',
        '    def info(self, *a, **k): pass',
        `print(json.dumps(capture_sqlite(${JSON.stringify(SRC)}, ${JSON.stringify(COPY)}, Log())))`,
    ].join('\n');
    const r = spawnSync(python, ['-I', '-B', '-c', py], { encoding: 'utf8' }); // -B: sin __pycache__ en el repo
    ok('capture_sqlite termina sin error', r.status === 0, r.stderr);
    const meta = JSON.parse(r.stdout || '{}');
    ok('método = sqlite_online_backup_api e integrity_check = ok', meta.capture_method === 'sqlite_online_backup_api' && meta.integrity_result === 'ok', JSON.stringify(meta));
    ok('sha256 informado coincide con el archivo copiado', meta.sha256 === crypto.createHash('sha256').update(fs.readFileSync(COPY)).digest('hex'));
    ok('la base viva sigue en WAL y operativa tras la captura', String(db.pragma('journal_mode', { simple: true })).toLowerCase() === 'wal'
        && L.recordFact(db, fact(999, 'u-live'), { env: EARN }).inserted);
    D.closeGamificationDb();

    section('[3] restauración y verificación');
    fs.mkdirSync(path.dirname(RESTORED), { recursive: true });
    fs.copyFileSync(COPY, RESTORED);
    process.env.GAMIFICATION_DB = RESTORED;
    const rdb = D.getGamificationDb();
    ok('integrity_check de la base restaurada = ok', rdb.pragma('integrity_check', { simple: true }) === 'ok');
    ok('la base restaurada no reaplica migraciones', rdb.prepare('SELECT COUNT(*) n FROM _migrations').get().n === 1);
    const diff = TABLES.filter((t) => tableHash(rdb, t) !== hashesBefore[t]);
    ok('historial idéntico en las 11 tablas (hash por tabla)', diff.length === 0, diff.join(','));
    ok('el hecho escrito DESPUÉS de la captura no está (punto de restauración exacto)', !rdb.prepare("SELECT 1 FROM gm_source_facts WHERE source_event_id='bk-999'").get());
    ok('snapshot idéntico y = Σ ledger', JSON.stringify(rdb.prepare('SELECT * FROM gm_pm_balances ORDER BY user_id').all()) === balancesBefore && L.verifyLedger(rdb).ok);
    ok('los triggers append-only viajan con la copia', (() => { try { rdb.prepare('DELETE FROM gm_pm_movements').run(); return false; } catch (e) { return /append-only/.test(e.message); } })());
    const replays = Array.from({ length: 40 }, (_, i) => L.recordFact(rdb, fact(i, `u-${i % 4}`), { env: EARN }));
    ok('re-procesar los 40 hechos tras restaurar no duplica (idempotencia I1)', replays.every((x) => !x.inserted) && rdb.prepare('SELECT COUNT(*) n FROM gm_source_facts').get().n === 40);
    ok('los hechos perdidos tras el punto de restauración se recuperan al re-procesarlos', L.recordFact(rdb, fact(999, 'u-live'), { env: EARN }).inserted && L.verifyLedger(rdb).ok);
    D.closeGamificationDb();
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    D.closeGamificationDb({ resetBackoff: true });
    ok('la base real data-critical/gamification.db no se creó ni cambió de estado', fs.existsSync(REAL_DB) === realBefore);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nCHP-GAMIFICACION-G3-01 (backup/restore) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
