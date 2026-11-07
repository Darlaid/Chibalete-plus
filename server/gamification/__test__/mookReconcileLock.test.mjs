/**
 * mookReconcileLock.test.mjs — CHP-GAMIFICACION-G4-PERF-01B-CLOSE.
 *
 * Contrato del lock de reconciliación MOOK con DOS procesos reales (esta prueba
 * y mookLockWorker.mjs como otra réplica), sobre bases temporales:
 *  [1] testigo inequívoco `pid:uuid` por proceso; exclusión entre procesos
 *  [2] quien perdió la propiedad no renueva ni borra el lock nuevo
 *  [3] carrera: la otra réplica toma el lock ENTRE la comprobación del testigo
 *      y la renovación → la renovación no toca el lock nuevo y se da por perdido
 *  [4] carrera: lo mismo entre la comprobación y la liberación → no lo borra
 *  [4b] sustitución forzada entre la última comprobación y el borrado: la
 *      liberación aparta el lock con rename, ve otro testigo y lo devuelve
 *  [4c] carrera en la restitución: una tercera réplica ocupa la ruta entre el
 *      rename y el link → el link no la pisa; la segunda detecta la pérdida
 *  [4d] liberación normal sin restos; testigo ajeno vigente intacto
 *  [5] barrido por lotes: expiración y toma por otra réplica a mitad, sin
 *      transacción abierta en las cesiones; recuperación sin duplicados ni pérdidas
 * Libera `mook_review` solo en este proceso. Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/mookReconcileLock.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/xpRecognitionHarness.mjs';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { buildSweepDoc, freshLedger, isSyntheticUser, isUserActive, ledgerDigest } from './helpers/mookSweepFixture.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_lock_'));

const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const S = await import('../subjects.mjs');
const K = M.__reconcileLockForTest;

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const realFiles = ['data/mook_db.json', 'data/content.json'].map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f));
const realBefore = realFiles.map(sha);
const realGam = fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db'));

/** La otra réplica: un proceso aparte con el código real del lock. */
const replica = (...args) => {
    const r = spawnSync(process.execPath, [path.join(HERE, 'mookLockWorker.mjs'), ...args], { encoding: 'utf8', env: process.env });
    try { return JSON.parse(r.stdout); } catch { return { err: r.stdout + r.stderr }; }
};
/** Deja el lock obsoleto, como si su dueño llevara más de LOCK_STALE_MS sin renovarlo. */
const ageOut = (lock) => { const past = new Date(Date.now() - M.LOCK_STALE_MS - 60_000); fs.utimesSync(lock, past, past); };
const read = (lock) => (fs.existsSync(lock) ? fs.readFileSync(lock, 'utf8') : null);
/**
 * Toma de la otra réplica dentro de la ventana. En Linux (producción) ocurre:
 * desvincula el inodo y crea uno nuevo mientras este proceso lo tiene abierto.
 * En Windows, un nombre con un descriptor abierto no se puede recrear hasta
 * cerrarlo: la toma falla (fallo cerrado, nadie queda con el lock).
 */
const stoleInWindow = (other) => (process.platform === 'win32'
    ? ['la otra réplica intentó la toma dentro de la ventana (Windows: nombre retenido, sin lock para nadie)', other && 'token' in other && (other.token === null || TOKEN.test(other.token)), JSON.stringify(other)]
    : ['la otra réplica tomó el lock dentro de la ventana', TOKEN.test(other?.token ?? ''), JSON.stringify(other)]);
const TOKEN = /^(\d+):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

try {
    section('[1] testigo inequívoco y exclusión entre procesos');
    {
        const lock = path.join(tmp, 'l1.lock');
        const mine = K.tryLock(lock, Date.now());
        ok('testigo pid:uuid de este proceso', TOKEN.test(mine ?? '') && mine.startsWith(`${process.pid}:`), mine);
        ok('…escrito tal cual en el lock', read(lock) === mine);
        const other = replica('steal', lock);
        ok('otra réplica no lo toma mientras está vigente', other.token === null && other.pid !== process.pid, JSON.stringify(other));
        K.unlock(lock, mine);
        ok('liberado por su dueño', !fs.existsSync(lock));
        const a = replica('steal', lock); replica('release', lock, a.token);
        const b = replica('steal', lock); replica('release', lock, b.token);
        ok('dos tomas sucesivas: testigos distintos aunque el pid se repitiera', TOKEN.test(a.token ?? '') && TOKEN.test(b.token ?? '') && a.token !== b.token);
    }

    section('[2] quien perdió la propiedad no renueva ni borra');
    {
        const lock = path.join(tmp, 'l2.lock');
        const mine = K.tryLock(lock, Date.now());
        ageOut(lock);
        const other = replica('steal', lock);
        ok('otra réplica toma el lock obsoleto', TOKEN.test(other.token ?? '') && read(lock) === other.token, JSON.stringify(other));
        const before = fs.statSync(lock).mtimeMs;
        const far = Date.now() + 3 * 3_600_000;
        ok('el antiguo dueño no puede renovar', K.renewLock(lock, mine, far) === false);
        ok('…ni tocar el lock nuevo', read(lock) === other.token && fs.statSync(lock).mtimeMs === before);
        K.unlock(lock, mine);
        ok('el antiguo dueño no lo borra', read(lock) === other.token);
        replica('release', lock, other.token);
        ok('el dueño nuevo sí lo libera', !fs.existsSync(lock));
    }

    section('[3] carrera entre comprobación y renovación');
    {
        const lock = path.join(tmp, 'l3.lock');
        const mine = K.tryLock(lock, Date.now());
        let other = null;
        K.setRaceHook(() => { K.setRaceHook(null); ageOut(lock); other = replica('steal', lock); });
        const far = Date.now() + 3 * 3_600_000;
        const renewed = K.renewLock(lock, mine, far);
        K.setRaceHook(null);
        ok(...stoleInWindow(other));
        ok('la renovación se da por perdida', renewed === false);
        ok('…y no altera el lock nuevo (testigo ni vigencia)', other?.token
            ? read(lock) === other.token && Math.abs(fs.statSync(lock).mtimeMs - far) > 3_600_000
            : read(lock) === null);
        if (other?.token) replica('release', lock, other.token);
    }

    section('[4] carrera entre comprobación y liberación');
    {
        const lock = path.join(tmp, 'l4.lock');
        const mine = K.tryLock(lock, Date.now());
        let other = null;
        K.setRaceHook(() => { K.setRaceHook(null); ageOut(lock); other = replica('steal', lock); });
        K.unlock(lock, mine);
        K.setRaceHook(null);
        ok(...stoleInWindow(other));
        ok('la liberación no borra el lock nuevo', other?.token ? read(lock) === other.token : read(lock) === null);
        if (other?.token) replica('release', lock, other.token);
        ok('…que su dueño libera después', !fs.existsSync(lock));
    }

    section('[4b] sustitución forzada entre la última comprobación y el borrado');
    {
        // La otra réplica solo puede reemplazar un lock que ve obsoleto. Aquí se
        // fuerza: el lock recién renovado se envejece (como un dueño congelado más
        // de LOCK_STALE_MS justo antes del unlink) y la otra réplica lo toma.
        const lock = path.join(tmp, 'l4b.lock');
        const mine = K.tryLock(lock, Date.now());
        let other = null;
        K.setRaceHook((phase) => { if (phase !== 'release') return; K.setRaceHook(null); ageOut(lock); other = replica('steal', lock); });
        K.unlock(lock, mine);
        K.setRaceHook(null);
        ok(...stoleInWindow(other));
        ok('el dueño anterior no borra el lock del nuevo dueño', other?.token ? read(lock) === other.token : true, JSON.stringify({ other, now: read(lock) }));
        ok('…y el nuevo dueño lo sigue renovando', other?.token ? K.renewLock(lock, other.token, Date.now()) === true : true);
        if (other?.token && read(lock) === other.token) replica('release', lock, other.token);
        ok('…que su dueño libera después', !fs.existsSync(lock));
        ok('sin restos del borrado', fs.readdirSync(tmp).every((f) => !f.startsWith('l4b.lock.')), fs.readdirSync(tmp).join());
    }

    section('[4c] carrera en la restitución: una tercera réplica ocupa la ruta');
    {
        // Tras apartar el lock ajeno con rename, la ruta queda libre un instante;
        // una tercera réplica la ocupa antes del link. El link no la pisa.
        const lock = path.join(tmp, 'l4c.lock');
        const mine = K.tryLock(lock, Date.now());
        let second = null, third = null;
        K.setRaceHook((phase) => {
            if (phase === 'release') { ageOut(lock); second = replica('steal', lock); }
            if (phase === 'restore') { K.setRaceHook(null); third = replica('steal', lock); }
        });
        K.unlock(lock, mine);
        K.setRaceHook(null);
        if (process.platform === 'win32' && !second?.token) {
            ok(...stoleInWindow(second));
        } else {
            ok('la segunda réplica tomó el lock antes del borrado', TOKEN.test(second?.token ?? ''), JSON.stringify(second));
            ok('la tercera tomó la ruta libre antes de la restitución', TOKEN.test(third?.token ?? '') && third.token !== second.token, JSON.stringify(third));
            ok('la restitución no sobrescribe el lock de la tercera', read(lock) === third?.token);
            ok('la segunda detecta la pérdida (no puede renovar)', K.renewLock(lock, second.token, Date.now()) === false);
            ok('la tercera conserva y renueva su lock', K.renewLock(lock, third.token, Date.now()) === true);
            replica('release', lock, second.token);
            ok('la segunda no puede liberar el lock de la tercera', read(lock) === third.token);
            replica('release', lock, third.token);
            ok('la tercera lo libera', !fs.existsSync(lock));
        }
        ok('sin restos del borrado', fs.readdirSync(tmp).every((f) => !f.startsWith('l4c.lock')), fs.readdirSync(tmp).join());
    }

    section('[4d] sin carrera: la liberación normal no deja restos');
    {
        const lock = path.join(tmp, 'l4d.lock');
        const mine = K.tryLock(lock, Date.now());
        K.unlock(lock, mine);
        ok('lock liberado y sin nombre de liberación', fs.readdirSync(tmp).every((f) => !f.startsWith('l4d.lock')));
        const theirs = replica('steal', lock);
        K.unlock(lock, mine);
        ok('un testigo ajeno vigente: no se aparta ni se borra', read(lock) === theirs.token && fs.readdirSync(tmp).filter((f) => f.startsWith('l4d.lock')).length === 1);
        replica('release', lock, theirs.token);
    }

    section('[5] barrido por lotes: expiración y toma a mitad');
    {
        const SINCE = Date.now() - 3_600_000;
        const { doc, users } = buildSweepDoc(Store, { n: 300, experiences: 5, users: 30, reviewers: 3, sinceMs: SINCE });
        const deps = (env) => ({ readMook: () => doc, readUsers: () => users, isUserActive, isSyntheticUser, workRefOf: Store.productionWorkRef, readRights: () => () => false, env });
        let k = 0;
        const fresh = () => freshLedger(D, L, path.join(tmp, `s${++k}`), SINCE);
        const digest = (env) => { const db = new Database(env.GAMIFICATION_DB, { readonly: true }); try { return ledgerDigest(L, S, db, users); } finally { db.close(); } };
        const verify = (env) => { const db = new Database(env.GAMIFICATION_DB, { readonly: true }); try { return db.prepare('SELECT (SELECT COUNT(*) FROM gm_pm_movements) + (SELECT COUNT(*) FROM gm_pm_balances) n').get().n === 0 && db.prepare("SELECT COUNT(*) n FROM gm_source_facts f WHERE (SELECT COUNT(*) FROM gm_xp_entries a WHERE a.fact_id = f.fact_id AND a.kind = 'award') <> 1").get().n === 0; } finally { db.close(); } };
        const refEnv = fresh();
        const ref = M.runMookReconcileOnce(deps(refEnv));
        ok('referencia síncrona', ref.ok && ref.recognition.recognized > 0);

        const env = fresh();
        const lock = `${env.GAMIFICATION_DB}.reconcile.lock`;
        const states = [];
        let other = null;
        const lost = await M.runMookReconcileBatched(deps(env), { sliceMax: 15, onPause: ({ db, slices }) => {
            states.push(db.inTransaction);
            if (slices === 4) { ageOut(lock); other = replica('steal', lock); }
        } });
        ok('expirado y tomado por otra réplica: el barrido se detiene', lost.ok === false && lost.code === 'RECONCILE_LOCK_LOST', JSON.stringify(lost));
        ok('…sin transacción abierta en ninguna cesión', states.length >= 4 && states.every((s) => s === false));
        ok('…y el lock nuevo queda intacto', TOKEN.test(other?.token ?? '') && read(lock) === other?.token);
        ok('lo escrito hasta ahí es coherente', verify(env));
        const blocked = await M.runMookReconcileBatched(deps(env));
        ok('mientras la otra réplica lo tiene, otro barrido se salta', blocked.skipped === 'locked');
        replica('release', lock, other.token);
        const again = await M.runMookReconcileBatched(deps(env));
        ok('recuperación: completa con el mismo ledger que la referencia', again.ok && digest(env).hash === digest(refEnv).hash, JSON.stringify([digest(env).totals, digest(refEnv).totals]));
        const retry = await M.runMookReconcileBatched(deps(env));
        ok('…y un reintento no añade nada', retry.ok && retry.recorded === 0 && retry.recognition.recognized === 0 && digest(env).hash === digest(refEnv).hash, JSON.stringify(retry).slice(0, 300));
        ok('sin lock huérfano', !fs.existsSync(lock));
    }

    section('[6] aislamiento');
    ok('data/ intacto', realFiles.map(sha).join() === realBefore.join());
    ok('sin gamification.db real', fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db')) === realGam);
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    K.setRaceHook(null);
    D.closeGamificationDb({ resetBackoff: true });
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nmookReconcileLock: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
