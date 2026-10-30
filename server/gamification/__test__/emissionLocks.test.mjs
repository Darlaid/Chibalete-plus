/**
 * emissionLocks.test.mjs — CHP-GAMIFICACION-G4-04.
 *
 * Alineación reducida de G3 con G4, sobre bases temporales y usuarios sintéticos:
 *  [1] flags de XP y PM independientes y apagados por defecto
 *  [2] flags OFF: sin base y sin emisión
 *  [3] reglas que intentan emitir desde una fuente bloqueada
 *  [4] emisiones prohibidas a través de recordFact
 *  [5] un conjunto de reglas ya guardado no salta el bloqueo
 *  [6] el llamador no puede declarar cobertura, comprensión ni montos
 *  [7] features persistibles sin tiempo ni modalidad
 *  [8] coherencia con el núcleo de reconocimiento
 *  [9] aislamiento económico
 *
 *   node server/gamification/__test__/emissionLocks.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const REAL = ['data-critical/gamification.db', 'data-critical/royalties.db'].map((p) => path.join(REPO, p));
const fingerprint = () => REAL.map((p) => fs.existsSync(p) && crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
const realBefore = fingerprint();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_locks_'));
const DB_PATH = path.join(tmp, 'gam', 'gamification.db');
process.env.GAMIFICATION_DB = DB_PATH;
delete process.env.GAMIFICATION_ENABLED;
delete process.env.PM_EARNING_ENABLED;
delete process.env.XP_EARNING_ENABLED;

const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const P = await import('../policy.mjs');
const R = await import('../recognition.mjs');

const BASE = { GAMIFICATION_ENABLED: '1', GAMIFICATION_DB: DB_PATH };
const XP = { ...BASE, XP_EARNING_ENABLED: '1' };
const PM = { ...BASE, PM_EARNING_ENABLED: '1' };
const BOTH = { ...BASE, XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '1' };
const CAPS = { pmPerDay: 100, pmPerWeek: 300 };
const RULES = { schema: 1, caps: CAPS, facts: {
    'mook_experience/experience_completed': { xp: 20 },
    'mook_review/evidence_reviewed': {},
    'offline_validation/offline_activity_validated': {},
    'mission/mission_completed': { xp: 3 },
} };
const T0 = Date.UTC(2026, 10, 3, 15);
let n = 0;
const nextId = () => `id-${++n}`;
const FACTS = {
    reading_completion: { factType: 'reading_completed', actorId: null, features: { verdict: 'plausible' } },
    mook_experience: { factType: 'experience_completed', actorId: null },
    mook_review: { factType: 'evidence_reviewed', actorId: 'u-med', features: { decision: 'aprobado' } },
    offline_validation: { factType: 'offline_activity_validated', actorId: 'u-med' },
};
const fact = (source, over = {}) => ({ source, sourceEventId: nextId(), userId: 'u-1', occurredAt: T0, eligibility: 'eligible', now: T0 + ++n, ...FACTS[source], ...over });
const movements = (db) => db.prepare('SELECT COUNT(*) c FROM gm_pm_movements').get().c;

try {
    section('[1] flags independientes');
    ok('XP apagado por defecto', D.isXpEarningEnabled({ GAMIFICATION_ENABLED: '1' }) === false);
    ok('PM apagado por defecto', D.isEarningEnabled({ GAMIFICATION_ENABLED: '1' }) === false);
    ok('XP sin el padre ⇒ OFF', D.isXpEarningEnabled({ XP_EARNING_ENABLED: '1' }) === false);
    ok('PM sin el padre ⇒ OFF', D.isEarningEnabled({ PM_EARNING_ENABLED: '1' }) === false);
    ok('encender XP no enciende PM', D.isXpEarningEnabled(XP) === true && D.isEarningEnabled(XP) === false);
    ok('encender PM no enciende XP', D.isEarningEnabled(PM) === true && D.isXpEarningEnabled(PM) === false);
    ok('un valor desconocido no enciende', D.isXpEarningEnabled({ ...BASE, XP_EARNING_ENABLED: 'yes' }) === false);

    section('[2] flags OFF');
    ok('sin GAMIFICATION_ENABLED no hay base', throwsCode(() => D.getGamificationDb({ env: {} }), 'GAMIFICATION_DISABLED') && !fs.existsSync(DB_PATH));
    const db = D.getGamificationDb({ env: BASE });
    L.createRuleSet(db, { ruleVersion: 'gm-locks-v1', rules: RULES, createdBy: 'migration', now: T0 - 1000 });
    const offR = L.recordFact(db, fact('mook_experience'), { env: BASE });
    const offM = L.recordFact(db, fact('mook_experience', { source: 'mission', factType: 'mission_completed' }), { env: BASE });
    ok('ambos flags OFF: disabled_source y nada emitido', offR.decision === 'disabled_source' && offM.decision === 'disabled_source' && offR.xp + offR.pm + offM.xp + offM.pm === 0);
    ok('ninguna fila de XP ni movimiento', db.prepare('SELECT COUNT(*) c FROM gm_xp_entries').get().c === 0 && movements(db) === 0);

    section('[3] reglas rechazadas');
    const rule = (key, r) => () => L.createRuleSet(db, { ruleVersion: 'gm-bad', rules: { schema: 1, caps: CAPS, facts: { [key]: r } }, createdBy: 'migration', now: T0 });
    ok('lectura con PM ⇒ READING_EMISSION_LOCKED', throwsCode(rule('reading_completion/reading_completed', { pm: 1 }), 'READING_EMISSION_LOCKED'));
    ok('lectura con XP ⇒ READING_EMISSION_LOCKED', throwsCode(rule('reading_completion/reading_completed', { xp: 1 }), 'READING_EMISSION_LOCKED'));
    ok('ruta MOOK con PM ⇒ PM_SOURCE_LOCKED', throwsCode(rule('mook_experience/experience_completed', { pm: 1 }), 'PM_SOURCE_LOCKED'));
    ok('revisión con PM ⇒ PM_SOURCE_LOCKED', throwsCode(rule('mook_review/evidence_reviewed', { pm: 1 }), 'PM_SOURCE_LOCKED'));
    ok('validación con PM ⇒ PM_SOURCE_LOCKED', throwsCode(rule('offline_validation/offline_activity_validated', { pm: 1 }), 'PM_SOURCE_LOCKED'));
    ok('revisión con XP ⇒ XP_SOURCE_LOCKED', throwsCode(rule('mook_review/evidence_reviewed', { xp: 1 }), 'XP_SOURCE_LOCKED'));
    ok('misión con PM ⇒ PM_SOURCE_LOCKED', throwsCode(rule('mission/mission_completed', { pm: 1 }), 'PM_SOURCE_LOCKED'));
    ok('validación con XP ⇒ XP_SOURCE_LOCKED', throwsCode(rule('offline_validation/offline_activity_validated', { xp: 1 }), 'XP_SOURCE_LOCKED'));
    ok('ninguna regla inválida quedó guardada', db.prepare("SELECT COUNT(*) c FROM gm_rule_sets WHERE rule_version='gm-bad'").get().c === 0);

    section('[4] emisiones prohibidas');
    const before = movements(db);
    for (const s of ['reading_completion', 'mook_review', 'offline_validation']) {
        const r = L.recordFact(db, fact(s), { env: BOTH });
        ok(`${s} con ambos flags: observed, 0 XP, 0 PM`, r.decision === 'observed', r.decision);
        ok(`${s}: nada emitido`, r.xp === 0 && r.pm === 0 && r.movementId === null);
    }
    const rt = L.recordFact(db, fact('mook_experience'), { env: BOTH });
    ok('ruta MOOK con ambos flags: XP sí, PM no', rt.decision === 'awarded' && rt.xp === 20 && rt.pm === 0 && rt.movementId === null);
    ok('sin movimientos de PM por ninguna de esas fuentes', movements(db) === before);

    section('[4b] XP sin PM y PM sin XP');
    const x = L.recordFact(db, fact('mook_experience', { userId: 'u-xp' }), { env: XP });
    ok('XP sin habilitar PM', x.xp === 20 && x.pm === 0 && L.getXp(db, 'u-xp') === 20 && L.getBalance(db, 'u-xp').available === 0);
    const px = L.recordFact(db, fact('mook_experience', { userId: 'u-px' }), { env: PM });
    ok('ruta con solo PM: disabled_source, nada', px.decision === 'disabled_source' && px.xp === 0 && px.pm === 0);
    const mx = L.recordFact(db, fact('mook_experience', { userId: 'u-mx', source: 'mission', factType: 'mission_completed' }), { env: XP });
    ok('misión con solo XP: XP sin movimiento', mx.xp === 3 && mx.pm === 0 && mx.movementId === null);
    const mp = L.recordFact(db, fact('mook_experience', { userId: 'u-mp', source: 'mission', factType: 'mission_completed' }), { env: BOTH });
    ok('misión con ambos flags: PM imposible', mp.pm === 0 && mp.movementId === null && L.getBalance(db, 'u-mp').available === 0 && L.verifyLedger(db).ok);

    section('[5] regla guardada antes del bloqueo');
    // Un conjunto ya persistido no pasa por validateRules: se simula escribiéndolo directo.
    const stale = JSON.stringify({ schema: 1, caps: CAPS, facts: {
        'reading_completion/reading_completed': { xp: 50, pm: 50 },
        'mook_experience/experience_completed': { xp: 20, pm: 50 },
        'mook_review/evidence_reviewed': { xp: 50, pm: 50 },
        'offline_validation/offline_activity_validated': { xp: 50, pm: 50 },
        'mission/mission_completed': { xp: 3, pm: 50 },
    } });
    db.prepare('INSERT INTO gm_rule_sets VALUES (?, ?, ?, ?, ?, ?)').run('gm-stale', T0, 'migration', stale, crypto.createHash('sha256').update(stale).digest('hex'), T0);
    const stNow = T0 + 10_000_000;
    const st = (s) => L.recordFact(db, fact(s, { userId: 'u-stale', now: stNow + ++n }), { env: BOTH });
    const results = ['reading_completion', 'mook_review', 'offline_validation'].map(st);
    const results2 = st('mook_experience');
    ok('la versión guardada es la vigente', L.getActiveRuleSet(db, stNow).ruleVersion === 'gm-stale');
    ok('lectura, revisión y validación: observed y nada', results.every((r) => r.decision === 'observed' && r.xp === 0 && r.pm === 0), JSON.stringify(results));
    ok('ruta: el XP de la regla, PM forzado a 0', results2.xp === 20 && results2.pm === 0);
    const stMission = L.recordFact(db, fact('mook_experience', { userId: 'u-stale', source: 'mission', factType: 'mission_completed', now: stNow + ++n }), { env: BOTH });
    ok('misión con regla antigua: PM forzado a 0', stMission.pm === 0 && stMission.movementId === null);
    ok('0 PM para ese usuario', L.getBalance(db, 'u-stale').available === 0 && L.verifyLedger(db).ok);

    section('[6] el llamador no decide');
    for (const k of ['workRef', 'cycle', 'demonstratesComprehension', 'coverageVerified', 'pm', 'xp', 'grade', 'decision']) {
        ok(`campo «${k}» ⇒ CALLER_FIELD_NOT_ALLOWED`, throwsCode(() => L.recordFact(db, { ...fact('mook_review'), [k]: true }, { env: BOTH }), 'CALLER_FIELD_NOT_ALLOWED'));
    }
    for (const k of ['workRef', 'cycle', 'demonstratesComprehension', 'pm']) {
        ok(`feature «${k}» ⇒ INVALID_FEATURES`, throwsCode(() => L.recordFact(db, fact('mook_review', { features: { [k]: 1 } }), { env: BOTH }), 'INVALID_FEATURES'));
    }

    section('[7] features persistibles');
    ok('activeMinutes ya no se admite', !L.FEATURE_ALLOWLIST.reading_completion.includes('activeMinutes'));
    ok('mode ya no se admite', !L.FEATURE_ALLOWLIST.reading_completion.includes('mode'));
    for (const features of [{ activeMinutes: 5 }, { mode: 'a11y' }]) {
        ok(`rechazada: ${Object.keys(features)[0]}`, throwsCode(() => L.recordFact(db, fact('reading_completion', { features }), { env: BOTH }), 'INVALID_FEATURES'));
    }
    ok('ninguna fila guarda modo ni tiempo', db.prepare("SELECT COUNT(*) c FROM gm_source_facts WHERE features_json LIKE '%a11y%' OR features_json LIKE '%mode%' OR features_json LIKE '%activeMinutes%'").get().c === 0);

    section('[8] coherencia con el núcleo');
    const elig = (e) => R.assessEligibility(e, { exists: true, active: true, synthetic: false });
    const common = { userId: 'u', evidenceId: 'e', at: T0, workRef: 'w', actorId: 'm' };
    ok('lo que el núcleo excluye de PM también lo bloquea G3', !elig({ ...common, source: 'reading_completion', verdict: 'plausible', modality: 'text' }).pm.eligible && P.PM_LOCKED_SOURCES.includes('reading_completion')
        && !elig({ ...common, source: 'mook_experience' }).pm.eligible && P.PM_LOCKED_SOURCES.includes('mook_experience'));
    ok('revisión y validación: elegibles en el núcleo, bloqueadas en G3 hasta tener cobertura', elig({ ...common, source: 'mook_review', decision: 'aprobado' }).pm.eligible && P.PM_LOCKED_SOURCES.includes('mook_review')
        && elig({ ...common, source: 'offline_validation', demonstratesComprehension: true }).pm.eligible && P.PM_LOCKED_SOURCES.includes('offline_validation'));
    ok('ninguna fuente puede emitir PM hoy', Object.keys(P.SOURCE_GRADE).every((s) => P.PM_LOCKED_SOURCES.includes(s)));
    const prod = fs.readdirSync(path.join(HERE, '..')).filter((f) => f.endsWith('.mjs')).map((f) => fs.readFileSync(path.join(HERE, '..', f), 'utf8'));
    ok('el arnés de pruebas no se importa desde producción', prod.every((s) => !/pmMechanics/.test(s)));

    section('[9] aislamiento económico');
    const mods = fs.readdirSync(path.join(HERE, '..')).filter((f) => f.endsWith('.mjs'));
    const imports = mods.flatMap((f) => [...fs.readFileSync(path.join(HERE, '..', f), 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]));
    ok('sin imports de regalías, derechos ni acceso', !imports.some((i) => /royalt|rights|access|woo/i.test(i)), imports.join());
    ok('solo las migraciones 0001 y 0002', fs.readdirSync(path.join(HERE, '..', 'migrations')).length === 2);
    ok('ledger íntegro al final', L.verifyLedger(db).ok);
    D.closeGamificationDb({ resetBackoff: true });
    ok('stores reales de gamificación y regalías sin cambios', JSON.stringify(fingerprint()) === JSON.stringify(realBefore));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    try { D.closeGamificationDb({ resetBackoff: true }); } catch { /* noop */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows puede retener un handle un instante */ }
}

console.log(`\nCHP-GAMIFICACION-G4-04 (bloqueos de emisión) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
