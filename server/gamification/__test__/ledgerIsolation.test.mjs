/**
 * ledgerIsolation.test.mjs — CHP-GAMIFICACION-G3-02.
 *
 * La entrada en línea (`intake.scheduleFact`) no puede frenar la operación que
 * la origina. Sobre una gamification.db TEMPORAL:
 *  [1] flag OFF, fuente no recuperable y base ausente: desiste sin crear nada;
 *  [2] la operación responde ANTES de que el hecho se registre;
 *  [3] con otra réplica reteniendo el lock de escritura: las operaciones no
 *      esperan, el event loop no se congela (busy corto en la conexión del
 *      gancho) y la reconciliación posterior recupera todo lo que desistió;
 *      contraste: la conexión principal (busy 5 s) SÍ habría bloqueado;
 *  [4] base corrupta: la operación no cambia y el archivo no se toca.
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/ledgerIsolation.test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const REAL_DB = path.join(REPO, 'data-critical', 'gamification.db');
const realBefore = fs.existsSync(REAL_DB);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_iso_'));
const DB_PATH = path.join(tmp, 'live', 'gamification.db');
const EARN = { GAMIFICATION_ENABLED: '1', PM_EARNING_ENABLED: '1', GAMIFICATION_DB: DB_PATH };

process.env.GAMIFICATION_ENABLED = '1';
process.env.GAMIFICATION_DB = DB_PATH;
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const R = await import('../reconcile.mjs');
const I = await import('../intake.mjs');

const schedule = (fact, env) => new Promise((resolve) => I.scheduleFact(fact, { env, onDone: resolve }));
const fact = (i) => ({ source: 'mook_review', sourceEventId: `iso-${i}`, factType: 'evidence_reviewed', userId: `u-${i % 3}`,
    actorId: 'u-med', occurredAt: Date.UTC(2026, 9, 29, 15) + i, eligibility: 'eligible', features: { decision: 'aprobado' } });

/** «Operación crítica» simulada: calcula su respuesta, programa el hecho y responde. */
function criticalOperation(i, env, onDone) {
    const t = performance.now();
    const body = { ok: true, id: i, saved: `progreso-${i}` };
    I.scheduleFact(fact(i), { env, onDone });
    return { body, ms: performance.now() - t };
}

function holdLock(dbPath, holdMs) {
    const code = `
        const { createRequire } = await import('node:module');
        const Database = createRequire(${JSON.stringify(path.join(REPO, 'package.json'))})('better-sqlite3');
        const db = new Database(${JSON.stringify(dbPath)});
        db.exec('BEGIN IMMEDIATE');
        process.stdout.write('locked\\n');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${holdMs});
        db.exec('COMMIT'); db.close();`;
    const p = spawn(process.execPath, ['--input-type=module', '-e', code], { stdio: ['ignore', 'pipe', 'inherit'] });
    const ready = new Promise((resolve) => p.stdout.on('data', (d) => { if (String(d).includes('locked')) resolve(); }));
    const done = new Promise((resolve) => p.on('close', resolve));
    return { ready, done };
}

try {
    section('[1] desiste sin crear nada');
    const ABSENT = path.join(tmp, 'absent', 'gamification.db');
    ok('flag OFF ⇒ GAMIFICATION_DISABLED', (await schedule(fact(0), { GAMIFICATION_DB: ABSENT })).code === 'GAMIFICATION_DISABLED');
    ok('fuente no recuperable (lectura) ⇒ SOURCE_NOT_RECOVERABLE', (await schedule({ ...fact(0), source: 'reading_completion' }, { ...EARN, GAMIFICATION_DB: ABSENT })).code === 'SOURCE_NOT_RECOVERABLE');
    ok('flag ON con la base ausente ⇒ GAMIFICATION_DB_UNAVAILABLE', (await schedule(fact(0), { ...EARN, GAMIFICATION_DB: ABSENT })).code === 'GAMIFICATION_DB_UNAVAILABLE');
    ok('el gancho NO crea la base ni su directorio (eso es del arranque)', !fs.existsSync(ABSENT) && !fs.existsSync(path.dirname(ABSENT)));
    I.closeIntake({ resetBackoff: true });

    section('[2] la operación responde antes de que el hecho se registre');
    const db = D.getGamificationDb(); // arranque: abre y migra fuera de las peticiones
    L.createRuleSet(db, { ruleVersion: 'gm-iso-v1', createdBy: 'migration',
        rules: { schema: 1, caps: { pmPerDay: 10000, pmPerWeek: 10000 }, facts: { 'mook_review/evidence_reviewed': { xp: 2, pm: 5 } } } });
    const order = [];
    const done1 = new Promise((resolve) => {
        const { body } = criticalOperation(1, EARN, (o) => { order.push('hecho'); resolve(o); });
        order.push(`respuesta:${body.saved}`);
    });
    const o1 = await done1;
    ok('primero la respuesta y después el hecho', order.join(' → ') === 'respuesta:progreso-1 → hecho', order.join(' → '));
    ok('el hecho quedó registrado y emitido por la regla', o1.ok && o1.result.inserted && o1.result.pm === 5);

    section('[3] otra réplica retiene el lock de escritura durante 2,5 s');
    const lock = holdLock(DB_PATH, 2500);
    await lock.ready;
    let maxGap = 0;
    let last = performance.now();
    const ticker = setInterval(() => { const t = performance.now(); maxGap = Math.max(maxGap, t - last); last = t; }, 10);
    const outcomes = [];
    const opMs = [];
    const all = [];
    for (let i = 10; i < 30; i++) {
        all.push(new Promise((resolve) => { const r = criticalOperation(i, EARN, (o) => { outcomes.push(o); resolve(); }); opMs.push(r.ms); }));
        await sleep(20);
    }
    await Promise.all(all);
    clearInterval(ticker);
    ok(`20 operaciones respondieron sin esperar (máx ${Math.max(...opMs).toFixed(2)} ms)`, Math.max(...opMs) < 20);
    ok(`el event loop no se congeló (hueco máximo ${maxGap.toFixed(0)} ms, busy del gancho ${I.HOOK_BUSY_MS} ms)`, maxGap < 600);
    const busy = outcomes.filter((o) => !o.ok).length;
    ok(`los ganchos desistieron ante el lock (${busy}/20) en vez de esperar`, busy > 0 && outcomes.every((o) => o.ok || /BUSY|LOCKED/.test(o.code)), JSON.stringify(outcomes.filter((o) => !o.ok).map((o) => o.code)));
    await lock.done;
    const missing = 20 - outcomes.filter((o) => o.ok && o.result.inserted).length;
    const rec = R.reconcile(db, Array.from({ length: 20 }, (_, k) => { const { eligibility, ...c } = fact(10 + k); return c; }),
        { resolveUser: () => ({ exists: true, active: true, synthetic: false }), env: EARN });
    ok(`la reconciliación recupera los ${missing} hechos que desistieron, sin duplicar`, rec.recorded === missing && rec.alreadyRecorded === 20 - missing);
    ok('21 hechos en total (1 de [2] + 20) y snapshot = Σ ledger', db.prepare('SELECT COUNT(*) n FROM gm_source_facts').get().n === 21 && L.verifyLedger(db).ok);

    const lock2 = holdLock(DB_PATH, 1500);
    await lock2.ready;
    const t0 = performance.now();
    let directCode = 'ok';
    try { L.recordFact(db, { ...fact(99), now: Date.now() }, { env: EARN }); } catch (e) { directCode = e.code; }
    const blocked = performance.now() - t0;
    await lock2.done;
    ok(`contraste: la conexión principal (busy 5 s) habría bloqueado el event loop ${blocked.toFixed(0)} ms`, blocked > 1000, `${blocked} ${directCode}`);

    section('[4] base corrupta');
    I.closeIntake({ resetBackoff: true });
    const BAD = path.join(tmp, 'corrupt', 'gamification.db');
    fs.mkdirSync(path.dirname(BAD), { recursive: true });
    fs.writeFileSync(BAD, Buffer.alloc(8192, 0x5a));
    const before = fs.readFileSync(BAD);
    const badRes = await new Promise((resolve) => { const r = criticalOperation(7, { ...EARN, GAMIFICATION_DB: BAD }, resolve); ok('la operación responde igual con la base corrupta', r.body.ok && r.body.saved === 'progreso-7'); });
    ok('el gancho desiste con GAMIFICATION_DB_UNAVAILABLE', badRes.ok === false && badRes.code === 'GAMIFICATION_DB_UNAVAILABLE');
    ok('el archivo corrupto no fue modificado', Buffer.compare(before, fs.readFileSync(BAD)) === 0);
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    I.closeIntake({ resetBackoff: true });
    D.closeGamificationDb({ resetBackoff: true });
    ok('la base real data-critical/gamification.db no se creó ni cambió de estado', fs.existsSync(REAL_DB) === realBefore);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nCHP-GAMIFICACION-G3-02 (aislamiento y rendimiento) — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
