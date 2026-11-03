/**
 * progress.test.mjs — CHP-GAMIFICACION-G4-UX-U1.
 *
 * Núcleo de progreso visible (`progress.mjs`) sobre el escritor real y la regla
 * aprobada del piloto (A7-A12-V3: 30/20/50), con bases temporales y usuarios
 * sintéticos:
 *  [1] sin actividad: Semilla, 0 XP, logros alcanzables según capacidad
 *  [2] XP 30: primera evidencia → Brote y «Primera obra»
 *  [3] XP 50: segunda reflexión de la misma obra → `deepWorks` y «Mirada profunda»
 *  [4] aprobadas sin XP: tercera evidencia, anterior a las reglas, retirada legal
 *  [5] varias obras y reflexiones; tramos provisionales solo si se pasan
 *  [6] idempotencia: reintentos del escritor no cambian el progreso
 *  [7] lecturas repetidas sin escrituras (conexión de solo lectura)
 *  [8] exclusión: salida idéntica a la de alguien sin actividad; registro a medias = error
 *  [9] privacidad: sin claves HMAC, sujetos ni ids; una persona no ve a otra
 *  [10] umbrales y catálogo: validación, alcanzables e inalcanzables
 *  [10b] un asiento de XP anulado no cuenta (solo reconocimientos válidos)
 *  [11] aislamiento
 * Libera `mook_review` solo en este proceso. Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/progress.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/xpRecognitionHarness.mjs';
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_progress_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');

const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const E = await import('../erasure.mjs');
const X = await import('../exclusions.mjs');
const P = await import('../progress.mjs');
const R = await import('../recognition.mjs');

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const realFiles = ['data/mook_db.json', 'data/content.json'].map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f));
const realBefore = realFiles.map(sha);
const realGam = fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db'));

/** A7-A12-V3 §1. `approvalRef` sintético: el real lo emite Dirección. */
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 }, pm: { reviewed: 0, validated: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [], pmFactors: [] } };
const SINCE = Date.now() - 60_000;
let n = 0;
function fresh() {
    n += 1;
    const dir = path.join(tmp, `g${n}`);
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true }); fs.mkdirSync(path.join(dir, 'reg'));
    const reg = path.join(dir, 'reg', 'r.jsonl'); fs.writeFileSync(reg, '');
    const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '', GAMIFICATION_DB: path.join(dir, 'db', 'gamification.db'),
        GAMIFICATION_EXCLUSION_REGISTRY: reg, GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString() };
    process.env.GAMIFICATION_DB = env.GAMIFICATION_DB; process.env.GAMIFICATION_EXCLUSION_REGISTRY = reg;
    D.closeGamificationDb({ resetBackoff: true });
    const db = D.getGamificationDb({ env });
    L.createRuleSet(db, { ruleVersion: 'gm-u1-v1', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000,
        rules: { schema: 1, caps: { pmPerDay: 0, pmPerWeek: 0 }, facts: {}, recognition: PILOT } });
    return { db, env };
}
let ev = 0;
const approve = (db, env, userId, workRef, { at = Date.now(), evidenceId = `evid-${++ev}` } = {}) =>
    ({ evidenceId, ...L.recordWorkRecognition(db, { evidenceId, userId, actorId: 'mediador', at, workRef, decision: 'aprobado' }, { env }) });
const count = (db, t) => db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
const read = (db, env, userId, opts = {}) => P.readProgress(db, userId, { env, ...opts });
const CAP_ONE = { works: 1, reflections: 2, deepWorks: 1 };     // una obra con dos producciones
const CAP_WIDE = { works: 6, reflections: 12, deepWorks: 6 };

try {
    section('[1] sin actividad');
    {
        const { db, env } = fresh();
        const p = read(db, env, 'lector-nuevo', { capacity: CAP_ONE });
        ok('0 XP, 0 obras, 0 reflexiones, 0 deepWorks', p.xp === 0 && p.works === 0 && p.reflections === 0 && p.deepWorks === 0, JSON.stringify(p));
        ok('nivel Semilla; falta 30 XP y 1 obra para Brote', p.level.id === 'semilla' && p.level.index === 0 && p.level.next?.id === 'brote'
            && p.level.next.xpTarget === 30 && p.level.next.missing.xp === 30 && p.level.next.missing.works === 1 && p.level.next.missing.reflections === 0, JSON.stringify(p.level));
        ok('sin logros obtenidos', p.achievements.earned.length === 0);
        ok('con una obra disponible: alcanzables solo «Primera obra» y «Mirada profunda»',
            JSON.stringify(p.achievements.reachable) === JSON.stringify(['primera-obra', 'mirada-profunda']), JSON.stringify(p.achievements));
        ok('siguiente logro: «Primera obra» (empate, orden del catálogo)', p.achievements.next?.id === 'primera-obra' && p.achievements.next.missing === 1);
        const blind = read(db, env, 'lector-nuevo');
        ok('sin capacidad conocida: ningún pendiente se ofrece (fallo cerrado)', blind.achievements.reachable.length === 0 && blind.achievements.next === null);
        ok('leer no crea sujeto ni escribe', count(db, 'gm_subjects') === 0 && count(db, 'gm_xp_entries') === 0);
    }

    section('[2] XP 30: primera evidencia');
    let { db, env } = fresh();
    {
        const r = approve(db, env, 'lectora', 'obra-a');
        const p = read(db, env, 'lectora', { capacity: CAP_ONE });
        ok('el escritor emite 30 (lectura 10 + reflexión 20)', r.inserted && r.xp === 30, JSON.stringify(r));
        ok('XP 30 = getXp del ledger', p.xp === 30 && p.xp === L.getXp(db, 'lectora'));
        ok('1 obra, 1 reflexión, 0 deepWorks', p.works === 1 && p.reflections === 1 && p.deepWorks === 0, JSON.stringify(p));
        ok('nivel Brote; no hay siguiente activo en el piloto', p.level.id === 'brote' && p.level.index === 1 && p.level.next === null);
        ok('logro «Primera obra»', JSON.stringify(p.achievements.earned) === '["primera-obra"]');
        ok('siguiente: «Mirada profunda», falta 1', p.achievements.next?.id === 'mirada-profunda' && p.achievements.next.missing === 1);
    }

    section('[3] XP 50: segunda reflexión de la misma obra');
    {
        const r = approve(db, env, 'lectora', 'obra-a');
        const p = read(db, env, 'lectora', { capacity: CAP_ONE });
        ok('el escritor emite 20 (solo reflexión)', r.inserted && r.xp === 20, JSON.stringify(r));
        ok('XP 50, 1 obra, 2 reflexiones, 1 deepWorks', p.xp === 50 && p.works === 1 && p.reflections === 2 && p.deepWorks === 1, JSON.stringify(p));
        ok('logros «Primera obra» y «Mirada profunda»', JSON.stringify(p.achievements.earned) === '["primera-obra","mirada-profunda"]');
        ok('con esa sola obra no queda ningún logro alcanzable', p.achievements.reachable.length === 0 && p.achievements.next === null);
    }

    section('[4] evidencias aprobadas sin XP');
    {
        const before = read(db, env, 'lectora', { capacity: CAP_ONE });
        const third = approve(db, env, 'lectora', 'obra-a');
        ok('tercera evidencia de la obra: sin XP ni fila', !third.inserted && third.xp === 0, JSON.stringify(third));
        const old = approve(db, env, 'lectora', 'obra-vieja', { at: SINCE - 60_000 });
        ok('evidencia anterior a las reglas: sin XP', !old.inserted && old.reason === 'predates_rules', JSON.stringify(old));
        ok('el progreso no cambia', JSON.stringify(read(db, env, 'lectora', { capacity: CAP_ONE })) === JSON.stringify(before));

        // Retirada legal: la entrega aprobada de una obra retirada no se reconoce.
        const doc = Store.emptyMookStore();
        const exp = Store.createExperience(doc, { slug: 'retirada', title: 'retirada' });
        const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [
            { id: 'r', type: 'READING', title: 'r', resourceRef: 'obra-retirada' },
            { id: 'p', type: 'PRODUCTION', title: 'p', resourceRef: 'obra-retirada', config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } },
        ] }] }, () => true);
        Store.publishVersion(doc, v.id);
        const { run } = Store.startRun(doc, { userId: 'lectora', experienceId: exp.id });
        Store.completeNode(doc, run.id, 'r');
        const { evidence } = Store.submitEvidence(doc, { runId: run.id, nodeId: 'p', userId: 'lectora', payload: { text: 'una dos tres cuatro cinco' },
            workAccess: { workRef: 'obra-retirada', decision: 'allowed', via: 'SCOPE_TITLE', at: new Date().toISOString() } });
        Store.reviewEvidence(doc, evidence.id, { reviewerId: 'mediador', decision: 'aprobado' });
        const everyone = () => ({ exists: true, active: true, synthetic: false });
        M.recognizeMookWorks(db, doc, { workRefOf: Store.productionWorkRef, readRights: () => (w) => w === 'obra-retirada', resolveUser: everyone, sinceMs: SINCE, env, now: Date.now() });
        ok('obra con retirada legal: aprobada sin XP, el progreso no cambia', JSON.stringify(read(db, env, 'lectora', { capacity: CAP_ONE })) === JSON.stringify(before));
    }

    section('[5] varias obras y reflexiones');
    {
        approve(db, env, 'lectora', 'obra-b');
        approve(db, env, 'lectora', 'obra-c');
        let p = read(db, env, 'lectora', { capacity: CAP_WIDE });
        ok('3 obras, 4 reflexiones, 1 deepWorks, 110 XP', p.works === 3 && p.reflections === 4 && p.deepWorks === 1 && p.xp === 110, JSON.stringify(p));
        ok('«Tres mundos» obtenido; siguiente «Lector reflexivo», falta 1',
            p.achievements.earned.includes('tres-obras') && p.achievements.next?.id === 'lector-reflexivo' && p.achievements.next.missing === 1, JSON.stringify(p.achievements));
        approve(db, env, 'lectora', 'obra-b');
        p = read(db, env, 'lectora', { capacity: CAP_WIDE });
        ok('5 reflexiones, 2 deepWorks, 130 XP: los cuatro logros', p.reflections === 5 && p.deepWorks === 2 && p.xp === 130
            && JSON.stringify(p.achievements.earned) === '["primera-obra","lector-reflexivo","tres-obras","mirada-profunda"]', JSON.stringify(p));
        ok('con los tramos del piloto sigue en Brote', p.level.id === 'brote' && p.level.next === null);
        const prov = read(db, env, 'lectora', { levels: P.PROPOSED_LEVELS });
        ok('los tramos provisionales solo cuentan si se pasan: Raíz (130 XP, 3 obras, 5 reflexiones)', prov.level.id === 'raiz'
            && prov.level.next?.id === 'tallo' && prov.level.next.missing.xp === 120 && prov.level.next.missing.works === 3 && prov.level.next.missing.reflections === 3, JSON.stringify(prov.level));
        ok('XP = Σ actos del ledger', p.xp === db.prepare('SELECT COALESCE(SUM(xp),0) n FROM gm_work_cycles').get().n);
    }

    section('[6] idempotencia');
    {
        const before = JSON.stringify(read(db, env, 'lectora', { capacity: CAP_WIDE }));
        const ids = db.prepare('SELECT COUNT(*) c FROM gm_source_facts').get().c;
        const again = approve(db, env, 'lectora', 'obra-a', { evidenceId: 'evid-1' });
        ok('reintentar una evidencia ya reconocida: nada nuevo', !again.inserted && again.xp === 0 && count(db, 'gm_source_facts') === ids, JSON.stringify(again));
        ok('el progreso no cambia', JSON.stringify(read(db, env, 'lectora', { capacity: CAP_WIDE })) === before);
    }

    section('[7] lecturas repetidas sin escrituras');
    {
        const counts = () => ['gm_source_facts', 'gm_xp_entries', 'gm_work_cycles', 'gm_subjects', 'gm_achievements', 'gm_pm_movements'].map((t) => count(db, t)).join();
        const before = counts();
        D.closeGamificationDb({ resetBackoff: true });
        const fileBefore = sha(env.GAMIFICATION_DB);
        const ro = new Database(env.GAMIFICATION_DB, { readonly: true, fileMustExist: true });
        let first = null, same = true, threw = null;
        try {
            for (let i = 0; i < 25; i++) {
                const p = JSON.stringify(P.readProgress(ro, 'lectora', { env, capacity: CAP_WIDE }));
                first ??= p; same &&= p === first;
                P.readProgress(ro, 'otra-persona', { env, capacity: CAP_WIDE });
            }
        } catch (e) { threw = e; }
        ro.close();
        ok('25 lecturas sobre una conexión de SOLO LECTURA, sin error', threw === null, String(threw));
        ok('resultado idéntico en todas', same);
        ok('archivo de la base sin cambios', sha(env.GAMIFICATION_DB) === fileBefore);
        db = D.getGamificationDb({ env });
        ok('sin filas nuevas en ninguna tabla (gm_achievements sigue vacía)', counts() === before && count(db, 'gm_achievements') === 0);
    }

    section('[8] exclusión');
    {
        const { db: dbx, env: envx } = fresh();
        approve(dbx, envx, 'excluida', 'obra-a');
        approve(dbx, envx, 'excluida', 'obra-a');
        ok('antes de excluir tiene progreso', read(dbx, envx, 'excluida', { capacity: CAP_ONE }).xp === 50);
        E.excludeUser(dbx, { userId: 'excluida', env: envx });
        const excluded = JSON.stringify(read(dbx, envx, 'excluida', { capacity: CAP_ONE }));
        const nobody = JSON.stringify(read(dbx, envx, 'nunca-vista', { capacity: CAP_ONE }));
        ok('excluida: salida idéntica, byte a byte, a la de alguien sin actividad', excluded === nobody, `${excluded} ≠ ${nobody}`);
        ok('…sin ningún campo que la delate', !/exclu|erasure|tombstone|motivo|reason/i.test(excluded));
        ok('una puerta inyectada que excluye también da cero', P.readProgress(dbx, 'excluida', { env: envx, gate: { excludes: () => true } }).xp === 0);
        // Registro con una exclusión que la base aún no tiene (restauración a medias).
        X.appendRegistry({ id: crypto.randomUUID(), tombstone: X.tombstoneOf('pendiente'), day: L.periodsFor(Date.now()).day }, envx);
        ok('registro a medias: error explícito, nunca 0 XP', throwsCode(() => read(dbx, envx, 'lectora'), 'EXCLUSION_REPLAY_REQUIRED'));
        // Vuelve a la base principal (fresh() cierra la conexión compartida).
        D.closeGamificationDb({ resetBackoff: true });
        process.env.GAMIFICATION_DB = env.GAMIFICATION_DB; process.env.GAMIFICATION_EXCLUSION_REGISTRY = env.GAMIFICATION_EXCLUSION_REGISTRY;
        db = D.getGamificationDb({ env });
    }

    section('[9] privacidad');
    {
        const p = read(db, env, 'lectora', { capacity: CAP_WIDE });
        const keys = Object.keys(p).sort().join();
        ok('solo los campos del contrato', keys === 'achievements,deepWorks,level,reflections,works,xp', keys);
        const s = JSON.stringify(p);
        const refs = db.prepare('SELECT subject_ref FROM gm_subjects').all().map((r) => r.subject_ref);
        const workKeys = db.prepare('SELECT DISTINCT work_key FROM gm_work_cycles').all().map((r) => r.work_key);
        const factIds = db.prepare('SELECT fact_id FROM gm_source_facts').all().map((r) => r.fact_id);
        ok('sin sujetos, claves HMAC ni ids de hechos', ![...refs, ...workKeys, ...factIds].some((x) => s.includes(x)) && !/[0-9a-f]{32,}/.test(s));
        ok('sin obras, PM ni datos personales', !/obra-|pm|mediador|lectora/i.test(s), s);
        approve(db, env, 'otra-lectora', 'obra-z');
        ok('la actividad de otra persona no altera esta lectura', JSON.stringify(read(db, env, 'lectora', { capacity: CAP_WIDE })) === s);
        ok('cada persona solo ve lo suyo', read(db, env, 'otra-lectora').xp === 30);
    }

    section('[10] umbrales y catálogo');
    {
        ok('tramos del piloto: Semilla 0/0/0 y Brote 30/1/0, y nada más', JSON.stringify(P.PILOT_LEVELS) === JSON.stringify([
            { id: 'semilla', xp: 0, works: 0, reflections: 0 }, { id: 'brote', xp: 30, works: 1, reflections: 0 }]));
        ok('tramos provisionales válidos y congelados', R.validateLevels(P.PROPOSED_LEVELS).ok && Object.isFrozen(P.PROPOSED_LEVELS) && Object.isFrozen(P.PROPOSED_LEVELS[2]));
        ok('umbrales inválidos: error', throwsCode(() => read(db, env, 'lectora', { levels: [{ id: 'x', xp: 10, works: 0, reflections: 1 }] }), 'INVALID_LEVELS'));
        ok('catálogo inicial: los cuatro logros', P.PILOT_ACHIEVEMENTS.map((a) => a.id).join() === 'primera-obra,lector-reflexivo,tres-obras,mirada-profunda');
        ok('deepWorks es una métrica de logro admitida', R.ACHIEVEMENT_METRICS.includes('deepWorks'));
        const v = P.achievementView({ works: 0, reflections: 0, deepWorks: 0 }, P.PILOT_ACHIEVEMENTS, { works: 2, reflections: 4, deepWorks: 0 });
        ok('dos obras sin segunda producción: «Primera obra» alcanzable; «Tres mundos», «Lector reflexivo» y «Mirada profunda» no',
            JSON.stringify(v.reachable) === '["primera-obra"]', JSON.stringify(v));
        const none = P.achievementView({ works: 0, reflections: 0, deepWorks: 0 }, P.PILOT_ACHIEVEMENTS, { works: 0, reflections: 0, deepWorks: 0 });
        ok('sin actividades elegibles: nada alcanzable ni siguiente', none.reachable.length === 0 && none.next === null);
        ok('deepWorks cuenta evidencias distintas por obra', R.summarizeRecognition([
            { act: 'reflection', workRef: 'w', evidenceId: 'e1' }, { act: 'reflection', workRef: 'w', evidenceId: 'e1' },
            { act: 'reflection', workRef: 'v', evidenceId: 'e2' }, { act: 'reflection', workRef: 'v', evidenceId: 'e3' }]).deepWorks === 1);
        ok('el módulo no escribe: solo SELECT', !/\b(INSERT|UPDATE|DELETE|REPLACE|CREATE|DROP|ALTER)\b|\.transaction\(|ensureSubject|recordWorkRecognition|localStorage|RewardEngine/.test(
            fs.readFileSync(path.join(HERE, '..', 'progress.mjs'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
    }

    section('[10b] solo reconocimientos válidos: un asiento anulado no cuenta');
    {
        const { db: dbv, env: envv } = fresh();
        approve(dbv, envv, 'lectora-v', 'obra-v');
        approve(dbv, envv, 'lectora-v', 'obra-v');
        const first = dbv.prepare("SELECT entry_id, rule_version FROM gm_xp_entries WHERE kind = 'award' ORDER BY created_at, rowid LIMIT 1").get();
        const sref = dbv.prepare('SELECT subject_ref FROM gm_xp_entries WHERE entry_id = ?').get(first.entry_id).subject_ref;
        dbv.prepare("INSERT INTO gm_xp_entries VALUES (?, ?, 'void', 0, NULL, ?, ?, ?)").run(crypto.randomUUID(), sref, first.entry_id, first.rule_version, Date.now());
        const p = read(dbv, envv, 'lectora-v');
        ok('anulada la primera evidencia: 20 XP, 0 obras, 1 reflexión, 0 deepWorks', p.xp === 20 && p.works === 0 && p.reflections === 1 && p.deepWorks === 0, JSON.stringify(p));
        ok('…y vuelve a Semilla (el nivel deriva de los reconocimientos válidos)', p.level.id === 'semilla');
    }

    section('[11] aislamiento');
    ok('data/ intacto', realFiles.map(sha).join() === realBefore.join());
    ok('sin gamification.db real', fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db')) === realGam);
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    D.closeGamificationDb({ resetBackoff: true });
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nprogress (G4-UX-U1): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
