/**
 * workCyclesMigration.test.mjs — CHP-GAMIFICACION-G4-05A-2.
 *
 * Migración 0003 de `gm_work_cycles`, sobre bases temporales:
 *  [1] base vacía  [2] repetida  [3] concurrente entre procesos
 *  [4] datos incompatibles  [5] actos de una evidencia y unicidad
 *  [6] respaldo y restauración  [7] reversión  [8] sin XP, PM ni flags
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/workCyclesMigration.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import { spawn } from 'node:child_process';
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
const DIR = path.join(HERE, '..', 'migrations');
const V3 = '0003_work_cycle_acts';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_0003_'));

const { runMigrations } = await import('../../db/migrate.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const Rec = await import('../recognition.mjs');

const migrate = (db, until) => runMigrations(db, () => {}, { dir: DIR, tag: 't', ...(until ? { until } : {}) });
const opened = [];
const open = (name) => {
    const f = path.join(tmp, name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    const db = new Database(f);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    opened.push(db);
    return { db, f };
};
const at0002 = (name) => { const o = open(name); migrate(o.db, '0002_subject_model'); return o; };
const versions = (db) => db.prepare('SELECT version FROM _migrations ORDER BY version').all().map((r) => r.version);
const pk = (db) => db.prepare("SELECT name FROM pragma_table_info('gm_work_cycles') WHERE pk > 0 ORDER BY pk").all().map((r) => r.name).join();
const objects = (db, type) => db.prepare("SELECT name FROM sqlite_master WHERE type = ? AND tbl_name = 'gm_work_cycles' AND name NOT LIKE 'sqlite_%' ORDER BY name").all(type).map((r) => r.name).join();
const fact = (db, id, subject = 's1') => {
    if (!db.prepare('SELECT 1 FROM gm_rule_sets').get()) db.prepare("INSERT INTO gm_rule_sets VALUES ('r1', 1, 'migration', '{}', ?, 1)").run('a'.repeat(64));
    db.prepare("INSERT INTO gm_source_facts VALUES (?, 'mook_review', ?, 'evidence_reviewed', ?, NULL, 1, 1, 'A', 'observed', 'r1', '{}')").run(id, `k-${id}`, subject);
};
const row = (db, f, work, cycle, act, xp = 0, pm = 0, subject = 's1') => db.prepare('INSERT INTO gm_work_cycles VALUES (?, ?, ?, ?, ?, ?, ?)').run(f, subject, work, cycle, act, xp, pm);
const worker = path.join(HERE, 'migrationWorker.mjs');
const runWorker = (file) => new Promise((resolve) => {
    const c = spawn(process.execPath, [worker, file], { env: { ...process.env, GAMIFICATION_ENABLED: '1', GAMIFICATION_DB: file }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { out += d; });
    c.on('close', (code) => resolve({ code, out }));
});

const realGam = fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db'));

try {
    section('[1] base vacía');
    const a = at0002('a/g.db');
    ok('en 0002 la clave es (fact_id, work_key)', pk(a.db) === 'fact_id,work_key');
    const applied = migrate(a.db);
    ok('0003 se aplica', applied.applied.join() === V3);
    ok('clave (fact_id, work_key, act)', pk(a.db) === 'fact_id,work_key,act', pk(a.db));
    ok('conserva las dos unicidades', objects(a.db, 'index') === 'ux_gm_cycle_pm,ux_gm_cycle_reading', objects(a.db, 'index'));
    ok('conserva los triggers append-only', objects(a.db, 'trigger') === 'gm_work_cycles_no_delete,gm_work_cycles_no_update');
    ok('la clave foránea sigue', a.db.prepare("SELECT \"table\" t FROM pragma_foreign_key_list('gm_work_cycles')").get()?.t === 'gm_source_facts');
    ok('no quedan tablas temporales', !a.db.prepare("SELECT 1 FROM sqlite_temp_master WHERE name LIKE '_gm_0003%'").get());
    const v2 = fs.readFileSync(path.join(DIR, '0002_subject_model.sql'), 'utf8');
    ok('0002 sigue declarando su clave original', /PRIMARY KEY \(fact_id, work_key\)/.test(v2));

    section('[2] repetida');
    const again = migrate(a.db);
    ok('reaplicar no hace nada', again.applied.length === 0 && again.already.includes(V3) && versions(a.db).length === 3);
    const fresh = open('fresh/g.db');
    ok('base nueva: las tres en orden', migrate(fresh.db).applied.join() === `0001_ledger,0002_subject_model,${V3}`);
    fresh.db.close();

    section('[3] concurrente entre procesos');
    for (let round = 0; round < 10; round++) {
        const c = at0002(`c${round}/g.db`);
        c.db.close();
        const rs = await Promise.all([1, 2, 3, 4].map(() => runWorker(c.f)));
        const check = new Database(c.f);
        ok(`ronda ${round + 1}: cuatro procesos terminan bien`, rs.every((r) => r.code === 0 && r.out.includes(V3)), JSON.stringify(rs.map((r) => [r.code, r.out.slice(-400)])));
        ok(`ronda ${round + 1}: una sola aplicación`, check.prepare('SELECT COUNT(*) n FROM _migrations WHERE version = ?').get(V3).n === 1 && pk(check) === 'fact_id,work_key,act');
        ok(`ronda ${round + 1}: integridad`, check.pragma('integrity_check', { simple: true }) === 'ok');
        check.close();
    }

    section('[4] datos incompatibles');
    const b = at0002('b/g.db');
    fact(b.db, 'f1');
    row(b.db, 'f1', 'w1', 1, 'reading', 0, 0);
    let code = '';
    try { migrate(b.db); } catch (e) { code = e.message; }
    ok('con filas aborta con su motivo', code.includes('0003_REQUIRES_EMPTY_WORK_CYCLES'), code);
    ok('sin registrarse', !versions(b.db).includes(V3));
    ok('la tabla no cambió', pk(b.db) === 'fact_id,work_key' && b.db.prepare('SELECT COUNT(*) n FROM gm_work_cycles').get().n === 1);
    ok('los triggers siguen', objects(b.db, 'trigger') === 'gm_work_cycles_no_delete,gm_work_cycles_no_update');
    let again2 = '';
    try { migrate(b.db); } catch (e) { again2 = e.message; }
    ok('reintentar vuelve a abortar', again2.includes('0003_REQUIRES_EMPTY_WORK_CYCLES'));
    const f4 = b.f;
    b.db.close();
    D.closeGamificationDb({ resetBackoff: true });
    ok('abrir por el camino normal: no disponible', throwsCode(() => D.getGamificationDb({ env: { GAMIFICATION_ENABLED: '1', GAMIFICATION_DB: f4 } }), 'GAMIFICATION_DB_UNAVAILABLE'));
    D.closeGamificationDb({ resetBackoff: true });
    const other = at0002('o/g.db');
    fact(other.db, 'f1');
    ok('hechos sin ciclos no la impiden', migrate(other.db).applied.join() === V3 && other.db.prepare('SELECT COUNT(*) n FROM gm_source_facts').get().n === 1);
    other.db.close();

    section('[5] actos de una evidencia y unicidad');
    const c = a.db;
    fact(c, 'e1');
    fact(c, 'e2');
    ok('el conjunto de actos es cerrado y coincide con el esquema', JSON.stringify(Rec.WORK_CYCLE_ACTS) === '["reading","reflection"]');
    const insert = c.transaction(() => { row(c, 'e1', 'w1', 1, 'reading', 10, 0); row(c, 'e1', 'w1', 1, 'reflection', 20, 7); });
    insert();
    ok('dos actos de una evidencia sobre la misma obra', c.prepare("SELECT COUNT(*) n FROM gm_work_cycles WHERE fact_id = 'e1'").get().n === 2);
    ok('mismo acto repetido: rechazado', throwsCode(() => row(c, 'e1', 'w1', 1, 'reflection'), 'SQLITE_CONSTRAINT_PRIMARYKEY'));
    for (const act of ['route', 'READING', '', 'pm']) ok(`acto fuera del conjunto (${act || 'vacío'}): rechazado`, throwsCode(() => row(c, 'e2', 'w9', 1, act), 'SQLITE_CONSTRAINT_CHECK'));
    ok('segunda lectura por sujeto, obra y ciclo: rechazada', throwsCode(() => row(c, 'e2', 'w1', 1, 'reading'), 'SQLITE_CONSTRAINT_UNIQUE'));
    ok('segundo PM por sujeto, obra y ciclo: rechazado', throwsCode(() => row(c, 'e2', 'w1', 1, 'reflection', 0, 7), 'SQLITE_CONSTRAINT_UNIQUE'));
    row(c, 'e2', 'w1', 1, 'reflection', 20, 0);
    ok('otra reflexión sin PM en el ciclo: admitida', c.prepare("SELECT COUNT(*) n FROM gm_work_cycles WHERE work_key = 'w1'").get().n === 3);
    row(c, 'e2', 'w1', 2, 'reading', 5, 0);
    ok('otro ciclo y otra obra: admitidos', row(c, 'e2', 'w2', 1, 'reading').changes === 1);
    fact(c, 'e4', 's2');
    row(c, 'e4', 'w1', 1, 'reading', 0, 0, 's2');
    ok('otro sujeto no choca', c.prepare("SELECT COUNT(*) n FROM gm_work_cycles WHERE subject_ref = 's2'").get().n === 1);
    ok('hecho inexistente: rechazado', throwsCode(() => row(c, 'nada', 'w3', 1, 'reading'), 'SQLITE_CONSTRAINT_FOREIGNKEY'));
    ok('append-only: sin UPDATE', (() => { try { c.prepare("UPDATE gm_work_cycles SET xp = 1").run(); return false; } catch (e) { return e.message.includes('append-only'); } })());
    ok('append-only: sin DELETE', (() => { try { c.prepare('DELETE FROM gm_work_cycles').run(); return false; } catch (e) { return e.message.includes('append-only'); } })());
    const decision = Rec.decideRecognition({ evidence: { source: 'mook_review', userId: 'u', actorId: 'm', evidenceId: 'e3', at: 1, workRef: 'w7', decision: 'aprobado' },
        subject: { exists: true, active: true, synthetic: false }, history: [], flags: { xpEarning: true, pmEarning: true },
        config: { amounts: { xp: { reading: 1, reflection: 1, validated: 1, route: 1 }, pm: { reviewed: 1, validated: 1 } }, xpCeilingPerWorkCycle: 9, reread: { windowDays: 1, xpFactors: [], pmFactors: [] } } });
    fact(c, 'e3');
    const fit = c.transaction(() => decision.entries.forEach((en) => row(c, 'e3', en.workRef, en.cycle, en.act, en.xp, en.pm)));
    fit();
    ok('las entradas reales de decideRecognition caben', decision.entries.map((x) => x.act).join() === 'reading,reflection' && c.prepare("SELECT COUNT(*) n FROM gm_work_cycles WHERE fact_id = 'e3'").get().n === 2);
    ok('solo actos del conjunto cerrado', decision.entries.every((x) => Rec.WORK_CYCLE_ACTS.includes(x.act)));

    section('[6] respaldo y restauración');
    const backupFile = path.join(tmp, 'backup', 'g.db');
    fs.mkdirSync(path.dirname(backupFile), { recursive: true });
    await c.backup(backupFile);
    const before = JSON.stringify(c.prepare('SELECT * FROM gm_work_cycles ORDER BY rowid').all());
    const restored = path.join(tmp, 'restored', 'gamification.db');
    fs.mkdirSync(path.dirname(restored), { recursive: true });
    fs.copyFileSync(backupFile, restored);
    D.closeGamificationDb({ resetBackoff: true });
    const reg = path.join(tmp, 'reg', 'r.jsonl'); fs.mkdirSync(path.dirname(reg)); fs.writeFileSync(reg, '');
    const rdb = D.getGamificationDb({ env: { GAMIFICATION_ENABLED: '1', GAMIFICATION_DB: restored, GAMIFICATION_EXCLUSION_REGISTRY: reg } });
    ok('restaurada: no reaplica nada', versions(rdb).length === 3 && versions(rdb).includes(V3));
    ok('filas idénticas', JSON.stringify(rdb.prepare('SELECT * FROM gm_work_cycles ORDER BY rowid').all()) === before);
    ok('esquema idéntico', pk(rdb) === 'fact_id,work_key,act' && objects(rdb, 'index') === 'ux_gm_cycle_pm,ux_gm_cycle_reading');
    ok('integridad y ledger', rdb.pragma('integrity_check', { simple: true }) === 'ok' && L.verifyLedger(rdb).ok);
    ok('las unicidades siguen activas tras restaurar', throwsCode(() => row(rdb, 'e1', 'w1', 1, 'reflection'), 'SQLITE_CONSTRAINT_PRIMARYKEY')
        && throwsCode(() => row(rdb, 'e2', 'w1', 1, 'reflection', 0, 1), 'SQLITE_CONSTRAINT_UNIQUE'));
    D.closeGamificationDb({ resetBackoff: true });
    const stores = fs.readFileSync(path.join(REPO, 'ops', 'backup', 'CHP-BACKUP-01B', 'runners', 'chibalete_backup', 'stores.py'), 'utf8');
    ok('sigue en el inventario de respaldos', stores.includes('gamification.db'));

    section('[7] reversión');
    const dn = open('down/g.db');
    migrate(dn.db);
    const down = fs.readFileSync(path.join(DIR, `${V3}.sql`), 'utf8').split('-- DOWN')[1];
    dn.db.exec(down);
    ok('DOWN restaura la clave de 0002', pk(dn.db) === 'fact_id,work_key' && objects(dn.db, 'index') === 'ux_gm_cycle_pm,ux_gm_cycle_reading');
    dn.db.close();

    section('[8] sin XP, PM ni flags');
    const z = at0002('z/g.db');
    migrate(z.db);
    const n = (t) => z.db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
    ok('la migración no crea XP, PM ni reglas', ['gm_xp_entries', 'gm_pm_movements', 'gm_pm_balances', 'gm_rule_sets', 'gm_work_cycles'].every((t) => n(t) === 0));
    z.db.close();
    const off = path.join(tmp, 'off', 'gamification.db');
    ok('flag OFF: no se abre ni se crea', throwsCode(() => D.getGamificationDb({ env: { GAMIFICATION_DB: off } }), 'GAMIFICATION_DISABLED') && !fs.existsSync(off));
    const ledgerSrc = fs.readFileSync(path.join(HERE, '..', 'ledger.mjs'), 'utf8');
    const others = fs.readdirSync(path.join(HERE, '..')).filter((f) => f.endsWith('.mjs') && f !== 'ledger.mjs').map((f) => fs.readFileSync(path.join(HERE, '..', f), 'utf8')).join('\n');
    ok('solo recordWorkRecognition escribe en gm_work_cycles', ledgerSrc.match(/INSERT INTO gm_work_cycles/g)?.length === 1
        && ledgerSrc.split('export function recordWorkRecognition')[1].split('export function hasFact')[0].includes('INSERT INTO gm_work_cycles') && !/INSERT INTO gm_work_cycles/.test(others));
    ok('sin gamification.db real', fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db')) === realGam);
    a.db.close();
} catch (e) {
    fail++;
    console.error('  ✗ excepción', e);
} finally {
    try { D.closeGamificationDb({ resetBackoff: true }); } catch { /* noop */ }
    for (const db of opened) { try { db.close(); } catch { /* ya cerrada */ } }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`\nworkCyclesMigration: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
