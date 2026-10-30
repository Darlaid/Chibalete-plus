/**
 * subjectModel.test.mjs — CHP-GAMIFICACION-PRIV-01B.
 *
 * Modelo de sujeto sobre bases temporales y usuarios sintéticos:
 *  [1] ninguna tabla transaccional guarda identidad canónica
 *  [2] claves e ids sin identidad ni tiempo de precisión innecesaria
 *  [3] claves deterministas por sujeto y distintas entre sujetos
 *  [4] sin clave de servidor no hay operaciones sensibles
 *  [5] hechos sin emisión: sin fila ni sujeto
 *  [6] migración 0002: rechaza datos previos sin modificarlos
 *  [7] flags OFF: sin base ni escritura
 *  [8] aislamiento: sin regalías ni progreso canónico
 *
 *   node server/gamification/__test__/subjectModel.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/pmMechanicsHarness.mjs';
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_subject_'));
const DB = path.join(tmp, 'a', 'gamification.db');
process.env.GAMIFICATION_DB = DB;

const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const S = await import('../subjects.mjs');
const K = await import('../subjectKey.mjs');
const { runMigrations } = await import('../../db/migrate.js');

const ON = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '1', GAMIFICATION_DB: DB };
const USER = 'usuario-sintetico-marcador-1';
const USER2 = 'usuario-sintetico-marcador-2';
const ACTOR = 'mediador-sintetico-marcador';
const T0 = Date.UTC(2026, 10, 3, 17, 42, 13, 271);
const BOGOTA_DAY = (ms) => (ms - 5 * 3_600_000) % 86_400_000 === 0;
const fact = (over = {}) => ({ source: 'mission', sourceEventId: 'mision-1', factType: 'mission_completed', userId: USER, actorId: ACTOR,
    occurredAt: T0, eligibility: 'eligible', now: T0, ...over });
const dump = (db, t) => JSON.stringify(db.prepare(`SELECT * FROM ${t}`).all().map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Buffer.isBuffer(v) ? '' : v]))));

try {
    const db = D.getGamificationDb({ env: ON });
    L.createRuleSet(db, { ruleVersion: 'gm-s-v1', createdBy: 'migration', now: T0 - 1000, rules: { schema: 1, caps: { pmPerDay: 500, pmPerWeek: 1000 },
        facts: { 'mission/mission_completed': { xp: 3, pm: 7 }, 'mook_experience/experience_completed': { xp: 2 } } } });
    const f1 = L.recordFact(db, fact(), { env: ON });
    const f2 = L.recordFact(db, fact({ userId: USER2 }), { env: ON });
    L.recordFact(db, { source: 'mook_experience', sourceEventId: `${USER}:xv-1`, factType: 'experience_completed', userId: USER, occurredAt: T0, eligibility: 'eligible', now: T0 }, { env: ON });
    const ad = L.appendAdjustment(db, { userId: USER, amount: 4, reasonCode: 'support', actorId: ACTOR, idempotencyKey: 'a1', ruleVersion: 'gm-s-v1', now: T0 });
    L.appendCompensation(db, { userId: USER, amount: -1, reasonCode: 'correction', actorId: ACTOR, relatedMovementId: f1.movementId, idempotencyKey: 'c1', ruleVersion: 'gm-s-v1', now: T0 });

    section('[1] sin identidad canónica fuera de gm_subjects');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'gm_%'").all().map((r) => r.name);
    const columns = (t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    ok('solo gm_subjects tiene columna user_id', tables.filter((t) => columns(t).includes('user_id')).join() === 'gm_subjects');
    ok('ninguna tabla conserva actor_id ni target_user', !tables.some((t) => columns(t).some((c) => ['actor_id', 'target_user'].includes(c))));
    for (const t of tables.filter((x) => x !== 'gm_subjects')) {
        ok(`${t} no contiene identidades`, ![USER, USER2, ACTOR].some((u) => dump(db, t).includes(u)));
    }
    ok('dos lectores y un actor: tres sujetos', db.prepare('SELECT COUNT(*) n FROM gm_subjects').get().n === 3);
    ok('el actor queda con su clase', db.prepare('SELECT role_class r FROM gm_subjects WHERE user_id = ?').get(ACTOR).r === 'actor');
    ok('la referencia es aleatoria: no es un hash de la identidad', (() => {
        const ref = S.findSubject(db, USER).subject_ref;
        return /^[0-9a-f]{32}$/.test(ref) && !['sha256', 'sha1', 'md5'].some((a) => crypto.createHash(a).update(USER).digest('hex').startsWith(ref));
    })());

    section('[2] claves e ids sin identidad ni tiempo');
    const facts = db.prepare('SELECT * FROM gm_source_facts').all();
    ok('source_event_id son HMAC', facts.every((f) => /^[0-9a-f]{64}$/.test(f.source_event_id)));
    ok('el id de ruta `usuario:versión` no queda en claro', !dump(db, 'gm_source_facts').includes('xv-1'));
    ok('las claves de ajuste no contienen la identidad', db.prepare("SELECT idempotency_key k FROM gm_pm_movements WHERE kind='adjustment'").all().every((r) => !r.k.includes(ACTOR)));
    ok('ids aleatorios: fact_id no es un ULID', facts.every((f) => /^[0-9a-f-]{36}$/.test(f.fact_id)));
    ok('fechas de hechos: solo día de Bogotá', facts.every((f) => BOGOTA_DAY(f.occurred_at) && BOGOTA_DAY(f.recorded_at)));
    ok('fechas de movimientos: solo día', db.prepare('SELECT created_at c FROM gm_pm_movements').all().every((r) => BOGOTA_DAY(r.c)));
    ok('fechas de XP y auditoría: solo día', db.prepare('SELECT created_at c FROM gm_xp_entries UNION ALL SELECT created_at FROM gm_admin_audit').all().every((r) => BOGOTA_DAY(r.c)));
    ok('fecha del sujeto: YYYY-MM-DD', db.prepare('SELECT created_on d FROM gm_subjects').all().every((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.d)));
    ok('sin features en hechos de misión y ruta', facts.every((f) => f.features_json === '{}'));

    section('[3] claves deterministas por sujeto');
    const a = S.findSubject(db, USER), b = S.findSubject(db, USER2);
    ok('dos usuarios con el mismo hecho: claves distintas', S.deriveSourceKey(a, 'mission', 't', 'x') !== S.deriveSourceKey(b, 'mission', 't', 'x'));
    ok('misma fuente y sujeto: misma clave', S.deriveSourceKey(a, 'mission', 't', 'x') === S.deriveSourceKey(a, 'mission', 't', 'x'));
    ok('otra fuente o tipo: otra clave', S.deriveSourceKey(a, 'mission', 't', 'x') !== S.deriveSourceKey(a, 'mook_review', 't', 'x') && S.deriveSourceKey(a, 'mission', 't', 'x') !== S.deriveSourceKey(a, 'mission', 'u', 'x'));
    ok('los separadores no se confunden', S.deriveSourceKey(a, 'mission', 'ab', 'c') !== S.deriveSourceKey(a, 'mission', 'a', 'bc'));
    ok('obra: distinta entre sujetos y determinista', S.deriveWorkKey(a, 'c-1') !== S.deriveWorkKey(b, 'c-1') && S.deriveWorkKey(a, 'c-1') === S.deriveWorkKey(a, 'c-1'));
    ok('obra y fuente no comparten espacio', S.deriveWorkKey(a, 'c-1') !== S.deriveSourceKey(a, 'c-1', '', ''));
    const replay = L.recordFact(db, fact(), { env: ON });
    ok('reintento: mismo hecho, sin emitir', !replay.inserted && replay.factId === f1.factId && replay.pm === f1.pm);
    ok('los dos usuarios tienen hechos propios', f1.factId !== f2.factId && L.getXp(db, USER2) === 3);
    ok('la reconciliación localiza el hecho', L.hasFact(db, fact()) && !L.hasFact(db, fact({ sourceEventId: 'otra' })) && !L.hasFact(db, fact({ userId: 'nadie' })));

    section('[4] sin clave de servidor');
    const keep = K.getSubjectKey();
    const before = dump(db, 'gm_source_facts') + dump(db, 'gm_pm_movements') + dump(db, 'gm_subjects');
    K.clearSubjectKey();
    ok('recordFact falla', throwsCode(() => L.recordFact(db, fact({ sourceEventId: 'sin-clave', userId: 'nuevo' }), { env: ON }), 'SUBJECT_KEY_UNAVAILABLE'));
    ok('appendAdjustment falla', throwsCode(() => L.appendAdjustment(db, { userId: USER, amount: 1, reasonCode: 'x', actorId: ACTOR, idempotencyKey: 'z', ruleVersion: 'gm-s-v1' }), 'SUBJECT_KEY_UNAVAILABLE'));
    ok('appendCompensation falla', throwsCode(() => L.appendCompensation(db, { userId: USER, amount: -1, reasonCode: 'x', actorId: ACTOR, relatedMovementId: f1.movementId, idempotencyKey: 'z', ruleVersion: 'gm-s-v1' }), 'SUBJECT_KEY_UNAVAILABLE'));
    ok('derivar una clave falla', throwsCode(() => S.deriveSourceKey(a, 'mission', 't', 'x'), 'SUBJECT_KEY_UNAVAILABLE'));
    ok('crear un sujeto falla', throwsCode(() => S.ensureSubject(db, 'nuevo', { roleClass: 'reader', day: '2026-11-03' }), 'SUBJECT_KEY_UNAVAILABLE'));
    ok('ninguna escritura', dump(db, 'gm_source_facts') + dump(db, 'gm_pm_movements') + dump(db, 'gm_subjects') === before);
    let loadCode = null;
    await K.loadSubjectKey({ read: async () => { throw Object.assign(new Error('x'), { code: 'FILE_MISSING' }); } }).catch((e) => { loadCode = e.code; });
    ok('si el archivo falla, la clave sigue ausente', loadCode === 'FILE_MISSING' && !K.hasSubjectKey());
    ok('una clave corta se rechaza', throwsCode(() => K.installSubjectKey('corta'), 'SUBJECT_KEY_UNAVAILABLE') && !K.hasSubjectKey());
    ok('una clave ausente se rechaza', throwsCode(() => K.installSubjectKey(undefined), 'SUBJECT_KEY_UNAVAILABLE'));
    if (process.platform !== 'win32') {
        const keyFile = path.join(tmp, 'gamification_subject_key');
        fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o400 });
        await K.loadSubjectKey({ path: keyFile });
        ok('el lector estricto carga un archivo 0400', K.hasSubjectKey());
        K.clearSubjectKey();
        fs.chmodSync(keyFile, 0o644);
        ok('el lector estricto rechaza permisos abiertos', await K.loadSubjectKey({ path: keyFile }).then(() => false, (e) => e.code === 'INVALID_MODE'));
    } else console.log('  - lector real de secretos: requiere POSIX, se ejecuta en CI');
    const src = fs.readFileSync(path.join(HERE, '..', 'subjectKey.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    ok('sin entorno ni valor constante', !/process\.env/.test(src) && !/_key = ['"`]/.test(src));
    const other = crypto.randomBytes(32).toString('hex');
    K.installSubjectKey(other);
    const withOther = S.deriveSourceKey(a, 'mission', 't', 'x');
    K.installSubjectKey(keep);
    ok('la clave de servidor interviene en la derivación', withOther !== S.deriveSourceKey(a, 'mission', 't', 'x'));

    section('[5] hechos sin emisión');
    const n0 = db.prepare('SELECT COUNT(*) n FROM gm_subjects').get().n;
    const fN = db.prepare('SELECT COUNT(*) n FROM gm_source_facts').get().n;
    const cases = { observed: fact({ eligibility: 'observe', userId: 'u-obs', sourceEventId: 'e1' }), rejected_excluded_user: fact({ eligibility: 'rejected_excluded_user', userId: 'u-syn', sourceEventId: 'e2' }),
        rejected_inactive_account: fact({ eligibility: 'rejected_inactive_account', userId: 'u-ina', sourceEventId: 'e3' }), rejected_not_eligible: fact({ eligibility: 'rejected_not_eligible', userId: 'u-gone', sourceEventId: 'e4' }),
        rejected_self_review: fact({ actorId: 'u-self', userId: 'u-self', sourceEventId: 'e5' }) };
    for (const [d, c] of Object.entries(cases)) {
        const r = L.recordFact(db, c, { env: ON });
        ok(`${d}: sin fila`, r.decision === d && !r.persisted && !r.inserted && r.factId === null);
    }
    const dis = L.recordFact(db, fact({ userId: 'u-dis', sourceEventId: 'e6' }), { env: { GAMIFICATION_ENABLED: '1' } });
    ok('disabled_source: sin fila', dis.decision === 'disabled_source' && !dis.persisted);
    ok('ningún sujeto ni hecho nuevo', db.prepare('SELECT COUNT(*) n FROM gm_subjects').get().n === n0 && db.prepare('SELECT COUNT(*) n FROM gm_source_facts').get().n === fN);
    const old = L.recordFact(db, fact({ userId: 'u-old', sourceEventId: 'e7', occurredAt: T0 - 86_400_000 }), { env: ON });
    ok('D48: un hecho anterior a la regla vigente no emite al reevaluarse', old.xp === 0 && old.pm === 0 && !old.persisted);

    section('[6] migración 0002');
    ok('secure_delete activo', db.pragma('secure_delete', { simple: true }) === 1);
    ok('triggers append-only tras el renombrado', (() => { try { db.prepare('DELETE FROM gm_source_facts').run(); return false; } catch (e) { return /append-only/.test(e.message); } })());
    ok('gm_subjects sí admite borrado', (() => { const t = db.transaction(() => { db.prepare('DELETE FROM gm_subjects WHERE user_id = ?').run(USER2); throw new Error('rollback'); }); try { t(); } catch (e) { return e.message === 'rollback'; } return false; })());
    ok('gm_work_cycles: un PM por obra y ciclo', (() => {
        const ins = db.prepare('INSERT INTO gm_work_cycles VALUES (?,?,?,?,?,?,?)');
        const t = db.transaction(() => { ins.run(f1.factId, 's', 'w', 1, 'reflection', 1, 5); ins.run(f2.factId, 's', 'w', 1, 'reflection', 1, 5); });
        try { t(); return false; } catch (e) { return /UNIQUE/.test(e.message); }
    })());
    const DIR = path.join(HERE, '..', 'migrations');
    const seed = {
        gm_rule_sets: "INSERT INTO gm_rule_sets VALUES ('r',1,'m','{}','x',1)",
        gm_admin_audit: "INSERT INTO gm_admin_audit VALUES ('a','act','x',NULL,NULL,1)",
        gm_pm_balances: "INSERT INTO gm_pm_balances VALUES ('u-real',1,0,1,1,1)",
    };
    for (const [table, sql] of Object.entries(seed)) {
        const p = path.join(tmp, `old-${table}.db`);
        const old1 = new Database(p);
        runMigrations(old1, () => {}, { dir: DIR, until: '0001_ledger', tag: 't' });
        old1.exec(sql);
        const snapshot = JSON.stringify(old1.prepare(`SELECT * FROM ${table}`).all());
        const threw = (() => { try { runMigrations(old1, () => {}, { dir: DIR, tag: 't' }); return null; } catch (e) { return e.message; } })();
        ok(`con filas en ${table}: aborta`, /0002_REQUIRES_EMPTY_LEDGER/.test(threw ?? ''), threw);
        ok(`${table}: sin cambios ni versión registrada`, JSON.stringify(old1.prepare(`SELECT * FROM ${table}`).all()) === snapshot
            && !old1.prepare("SELECT 1 FROM _migrations WHERE version='0002_subject_model'").get()
            && old1.prepare("SELECT COUNT(*) n FROM pragma_table_info('gm_pm_movements') WHERE name='user_id'").get().n === 1
            && !old1.prepare("SELECT 1 FROM sqlite_master WHERE name='gm_subjects'").get());
        old1.close();
    }
    const OLD_DB = path.join(tmp, 'old', 'gamification.db');
    fs.mkdirSync(path.dirname(OLD_DB));
    const old2 = new Database(OLD_DB);
    runMigrations(old2, () => {}, { dir: DIR, until: '0001_ledger', tag: 't' });
    old2.exec(seed.gm_rule_sets);
    old2.close();
    D.closeGamificationDb({ resetBackoff: true });
    ok('abrir una base con datos: no disponible', throwsCode(() => D.getGamificationDb({ env: { ...ON, GAMIFICATION_DB: OLD_DB } }), 'GAMIFICATION_DB_UNAVAILABLE'));
    D.closeGamificationDb({ resetBackoff: true });
    const empty = new Database(path.join(tmp, 'empty.db'));
    const ap = runMigrations(empty, () => {}, { dir: DIR, tag: 't' });
    ok('sobre una base vacía se aplica', ap.applied.join() === '0001_ledger,0002_subject_model');
    empty.close();

    section('[7] flags OFF');
    const OFF_DB = path.join(tmp, 'off', 'gamification.db');
    ok('sin flag no se abre', throwsCode(() => D.getGamificationDb({ env: { GAMIFICATION_DB: OFF_DB } }), 'GAMIFICATION_DISABLED'));
    const I = await import('../intake.mjs');
    const offOut = await new Promise((resolve) => I.scheduleFact(fact(), { env: { GAMIFICATION_DB: OFF_DB }, onDone: resolve }));
    ok('el gancho desiste', offOut.code === 'GAMIFICATION_DISABLED');
    ok('ni archivo ni directorio', !fs.existsSync(path.dirname(OFF_DB)));

    section('[8] aislamiento');
    const mods = fs.readdirSync(path.join(HERE, '..')).filter((f) => f.endsWith('.mjs'));
    const imports = mods.flatMap((f) => [...fs.readFileSync(path.join(HERE, '..', f), 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]));
    ok('sin regalías, derechos, acceso ni progreso', !imports.some((i) => /royalt|rights|access|woo|progressService/i.test(i)), imports.join());
    ok('solo subjects.mjs consulta la tabla de identidad', mods.filter((f) => /FROM gm_subjects|INTO gm_subjects/.test(fs.readFileSync(path.join(HERE, '..', f), 'utf8'))).join() === 'subjects.mjs');
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    try { D.closeGamificationDb({ resetBackoff: true }); } catch { /* noop */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows puede retener un handle un instante */ }
}

console.log(`\nCHP-GAMIFICACION-PRIV-01B (modelo de sujeto) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
