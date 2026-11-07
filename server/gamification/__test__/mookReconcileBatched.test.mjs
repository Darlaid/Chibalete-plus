/**
 * mookReconcileBatched.test.mjs — CHP-GAMIFICACION-G4-PERF-01B.
 *
 * Barrido MOOK por lotes con cesión del event loop, sobre bases temporales y
 * datos sintéticos:
 *  [1] equivalencia: mismas decisiones, resultados y ledger que el barrido síncrono
 *  [2] cesiones reales, sin transacción abierta durante ninguna
 *  [3] lock: testigo propio, renovación, reentrada y pérdida
 *  [4] dos réplicas barriendo a la vez
 *  [5] SIGKILL a mitad del barrido y recuperación
 *  [6] exclusión aplicada durante el barrido
 *  [7] retirada legal durante el barrido
 *  [8] reintento idempotente
 *  [9] el programador usa el barrido por lotes
 *  [10] aislamiento
 * Libera `mook_review` solo en este proceso para ejercitar el registro por obra.
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/mookReconcileBatched.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import './helpers/xpRecognitionHarness.mjs';
import { spawn } from 'node:child_process';
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_batched_'));

const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const E = await import('../erasure.mjs');
const S = await import('../subjects.mjs');

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const realFiles = ['data/mook_db.json', 'data/content.json'].map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f));
const realBefore = realFiles.map(sha);
const realGam = fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db'));

const SINCE = Date.now() - 3_600_000;
const { doc, users } = buildSweepDoc(Store, { n: 600, experiences: 6, users: 40, reviewers: 4, sinceMs: SINCE });
const FIX = path.join(tmp, 'doc.json'); fs.writeFileSync(FIX, JSON.stringify(doc));
const UF = path.join(tmp, 'users.json'); fs.writeFileSync(UF, JSON.stringify(users));
const versionOf = new Map(doc.versions.map((v) => [v.id, v]));
const ofWork = (w) => doc.evidence.filter((e) => Store.productionWorkRef(versionOf.get(e.experienceVersionId), e.nodeId).workRef === w).length;
const deps = (env, over = {}) => ({ readMook: () => doc, readUsers: () => users, isUserActive, isSyntheticUser,
    workRefOf: Store.productionWorkRef, readRights: () => () => false, env, ...over });

let n = 0;
const fresh = () => freshLedger(D, L, path.join(tmp, `l${++n}`), SINCE);
const digest = (env, only = users) => { const db = new Database(env.GAMIFICATION_DB, { readonly: true }); try { return ledgerDigest(L, S, db, only, { withTotals: only === users }); } finally { db.close(); } };
const verify = (env) => { const db = new Database(env.GAMIFICATION_DB, { readonly: true }); try { return db.prepare('SELECT (SELECT COUNT(*) FROM gm_pm_movements) + (SELECT COUNT(*) FROM gm_pm_balances) n').get().n === 0 && db.prepare("SELECT COUNT(*) n FROM gm_source_facts f WHERE (SELECT COUNT(*) FROM gm_xp_entries a WHERE a.fact_id = f.fact_id AND a.kind = 'award') <> 1").get().n === 0; } finally { db.close(); } };
const strip = ({ slices, ...r }) => r; // eslint-disable-line no-unused-vars
const lockOf = (env) => `${env.GAMIFICATION_DB}.reconcile.lock`;
const spawnW = (role, signal, env) => {
    const child = spawn(process.execPath, [path.join(HERE, 'mookBatchedWorker.mjs'), role, signal],
        { env: { ...process.env, ...env, CHP_FIXTURE: FIX, CHP_USERS: UF }, stdio: ['ignore', 'pipe', 'pipe'] });
    const done = new Promise((resolve) => {
        let so = '', se = ''; child.stdout.on('data', (d) => { so += d; }); child.stderr.on('data', (d) => { se += d; });
        child.on('close', (code, sig) => { try { resolve({ code, sig, ...JSON.parse(so) }); } catch { resolve({ code, sig, err: so + se }); } });
    });
    return { child, done };
};

try {
    section('[1] equivalencia con el barrido síncrono');
    const refEnv = fresh();
    const ref = M.runMookReconcileOnce(deps(refEnv));
    const refDigest = digest(refEnv);
    ok('el barrido de referencia registra reconocimientos por obra', ref.ok && ref.recognition.recognized > 0, JSON.stringify(ref));
    const bEnv = fresh();
    const b = await M.runMookReconcileBatched(deps(bEnv), { sliceMax: 7 });
    ok('por lotes: muchas cesiones', b.ok && b.slices > 100, String(b.slices));
    ok('mismos recuentos y motivos', JSON.stringify(strip(b)) === JSON.stringify(ref), JSON.stringify([strip(b), ref]));
    ok('mismo ledger: por persona, XP, hechos y actos en el mismo orden', digest(bEnv).hash === refDigest.hash, JSON.stringify([digest(bEnv).totals, refDigest.totals]));
    ok('snapshot = Σ ledger', verify(bEnv));
    const tEnv = fresh();
    const t = await M.runMookReconcileBatched(deps(tEnv), { sliceMs: 0 });
    ok('presupuesto de tiempo 0: cede en cada paso y decide igual', t.ok && t.slices > 1000 && digest(tEnv).hash === refDigest.hash, String(t.slices));
    const fEnv = freshLedger(D, L, path.join(tmp, `l${++n}`), SINCE, 'facts');
    const fRef = M.runMookReconcileOnce(deps(fEnv));
    const fEnv2 = freshLedger(D, L, path.join(tmp, `l${++n}`), SINCE, 'facts');
    const fB = await M.runMookReconcileBatched(deps(fEnv2), { sliceMax: 7 });
    ok('reglas por hecho: la reconciliación escribe hechos', fRef.ok && fRef.recorded > 0, JSON.stringify(fRef).slice(0, 300));
    ok('…y por lotes registra los mismos, con el mismo ledger', fB.ok && JSON.stringify(strip(fB)) === JSON.stringify(fRef) && digest(fEnv2).hash === digest(fEnv).hash);

    section('[2] cesiones reales, sin transacción abierta');
    {
        const env = fresh();
        let ticks = 0;
        const iv = setInterval(() => { ticks++; }, 1);
        const sync = (() => { const t0 = ticks; M.runMookReconcileOnce(deps(env)); return ticks - t0; })();
        ok('el barrido síncrono no deja correr ningún temporizador', sync === 0);
        const env2 = fresh();
        const states = [];
        ticks = 0;
        const r = await M.runMookReconcileBatched(deps(env2), { sliceMax: 25, onPause: ({ db }) => { states.push(db.inTransaction); } });
        clearInterval(iv);
        ok('el barrido por lotes deja correr temporizadores entre lotes', r.ok && ticks > 0, String(ticks));
        ok('ninguna transacción abierta en ninguna cesión', states.length > 10 && states.every((s) => s === false), String(states.length));
    }

    section('[3] lock: testigo, renovación, reentrada y pérdida');
    {
        const env = fresh();
        const lock = lockOf(env);
        const seen = { token: null, renewed: null, reentrySync: null, reentryBatched: null, stale: 0 };
        let pauses = 0;
        const r = await M.runMookReconcileBatched(deps(env), { sliceMax: 20, onPause: async () => {
            pauses++;
            if (pauses === 1) {
                seen.token = fs.readFileSync(lock, 'utf8');
                seen.reentrySync = M.runMookReconcileOnce(deps(env)).skipped;
                seen.reentryBatched = (await M.runMookReconcileBatched(deps(env))).skipped;
                const past = new Date(Date.now() - M.LOCK_STALE_MS / 2);
                fs.utimesSync(lock, past, past);
                seen.stale = past.getTime();
            } else if (pauses === 2) {
                seen.renewed = fs.statSync(lock).mtimeMs;
            }
        } });
        ok('testigo propio: pid y uuid', /^\d+:[0-9a-f-]{36}$/.test(seen.token ?? ''), seen.token);
        ok('reentrada síncrona en la misma réplica mientras cede: se salta', seen.reentrySync === 'locked');
        ok('reentrada por lotes mientras cede: se salta', seen.reentryBatched === 'locked');
        ok('cada cesión renueva el lock', seen.renewed > seen.stale + 60_000, JSON.stringify(seen));
        ok('el barrido termina y libera su lock', r.ok && !fs.existsSync(lock));
        ok('…con el mismo ledger', digest(env).hash === refDigest.hash);

        const env2 = fresh();
        const lock2 = lockOf(env2);
        const lost = await M.runMookReconcileBatched(deps(env2), { sliceMax: 20, onPause: ({ slices }) => {
            if (slices === 3) { fs.unlinkSync(lock2); fs.writeFileSync(lock2, 'otra-replica'); }
        } });
        ok('lock tomado por otra réplica: el barrido se detiene', lost.ok === false && lost.code === 'RECONCILE_LOCK_LOST', JSON.stringify(lost));
        ok('…y no borra el lock ajeno', fs.readFileSync(lock2, 'utf8') === 'otra-replica');
        ok('lo ya escrito es coherente', verify(env2));
        fs.unlinkSync(lock2);
        const again = await M.runMookReconcileBatched(deps(env2));
        ok('el siguiente barrido completa sin duplicar', again.ok && digest(env2).hash === refDigest.hash);

        const env3 = fresh();
        let stop = false;
        const stopped = await M.runMookReconcileBatched(deps(env3), { sliceMax: 20, shouldStop: () => stop, onPause: ({ slices }) => { if (slices === 2) stop = true; } });
        ok('parada ordenada: se detiene en la siguiente cesión y libera el lock', stopped.code === 'RECONCILE_STOPPED' && !fs.existsSync(lockOf(env3)));
        ok('…y el siguiente barrido completa', (await M.runMookReconcileBatched(deps(env3))).ok && digest(env3).hash === refDigest.hash);
    }

    section('[4] dos réplicas barriendo a la vez');
    {
        const env = fresh();
        const barrier = path.join(tmp, 'go4');
        const ws = [spawnW('replica', barrier, env), spawnW('replica', barrier, env)];
        setTimeout(() => fs.writeFileSync(barrier, 'go'), 300);
        const [w1, w2] = await Promise.all(ws.map((w) => w.done));
        const runs = [...(w1.runs ?? []), ...(w2.runs ?? [])];
        ok('ambas réplicas terminan sin error', w1.code === 0 && w2.code === 0 && runs.length === 6 && runs.every((r) => r.ok || r.skipped === 'locked'), JSON.stringify([w1, w2]).slice(0, 500));
        ok('hubo solapamiento: alguna réplica encontró el lock tomado', runs.some((r) => r.skipped === 'locked'), JSON.stringify(runs.map((r) => r.skipped ?? r.slices)));
        const effective = runs.filter((r) => r.ok);
        ok('los barridos efectivos suman exactamente lo de la referencia', effective.reduce((s, r) => s + r.recorded, 0) === ref.recorded
            && effective.reduce((s, r) => s + r.recognition.recognized, 0) === ref.recognition.recognized);
        ok('mismo ledger, sin duplicados', digest(env).hash === refDigest.hash && verify(env));
        ok('sin lock huérfano', !fs.existsSync(lockOf(env)));
    }

    section('[5] SIGKILL a mitad del barrido');
    {
        const env = fresh();
        const mark = path.join(tmp, 'kill5');
        const w = spawnW('kill', mark, env);
        for (let i = 0; i < 400 && !fs.existsSync(mark); i++) await sleep(25);
        const started = fs.existsSync(mark);
        await sleep(30);
        w.child.kill('SIGKILL');
        const res = await w.done;
        ok('el proceso murió a mitad del barrido', started && (res.sig === 'SIGKILL' || res.code !== 0) && !/terminó/.test(res.err ?? ''), JSON.stringify(res).slice(0, 300));
        const db = new Database(env.GAMIFICATION_DB, { readonly: true });
        const partial = db.prepare('SELECT COUNT(*) c FROM gm_source_facts').get().c;
        db.close();
        ok('quedó trabajo a medias, coherente', partial < refDigest.totals.gm_source_facts && verify(env), String(partial));
        ok('el lock del muerto sigue ahí', fs.existsSync(lockOf(env)));
        ok('mientras está vigente, nadie barre', (await M.runMookReconcileBatched(deps(env))).skipped === 'locked');
        const past = new Date(Date.now() - M.LOCK_STALE_MS - 60_000);
        fs.utimesSync(lockOf(env), past, past);
        const rec = await M.runMookReconcileBatched(deps(env), { sliceMax: 50 });
        ok('lock obsoleto: el siguiente barrido lo libera y completa', rec.ok && !fs.existsSync(lockOf(env)), JSON.stringify(rec).slice(0, 200));
        ok('sin pérdida ni duplicados: mismo ledger que la referencia', digest(env).hash === refDigest.hash && verify(env));
    }

    section('[6] exclusión aplicada durante el barrido');
    {
        const env = fresh();
        const target = users.find((u) => u.id === 'u-00039');
        const others = users.filter((u) => u !== target);
        let excluded = null;
        const r = await M.runMookReconcileBatched(deps(env), { sliceMax: 10, onPause: ({ slices }) => {
            if (slices !== 1) return;
            const other = new Database(env.GAMIFICATION_DB);
            other.pragma('busy_timeout = 2000');
            try { excluded = E.excludeUser(other, { userId: target.id, env }); } finally { other.close(); }
        } });
        ok('la exclusión entra durante una cesión, sin esperar al barrido', excluded?.inserted === true, JSON.stringify(excluded));
        ok('el barrido sigue y termina', r.ok, JSON.stringify(r).slice(0, 200));
        const db = new Database(env.GAMIFICATION_DB, { readonly: true });
        ok('la persona excluida no tiene sujeto ni XP', S.findSubject(db, target.id) === null && L.getXp(db, target.id) === 0);
        db.close();
        ok('las demás personas, idénticas a la referencia', digest(env, others).hash === digest(refEnv, others).hash);
        ok('reintentar no la reincorpora', (await M.runMookReconcileBatched(deps(env))).ok && digest(env, others).hash === digest(refEnv, others).hash
            && (() => { const d = new Database(env.GAMIFICATION_DB, { readonly: true }); try { return S.findSubject(d, target.id) === null; } finally { d.close(); } })());
    }

    section('[7] retirada legal durante el barrido');
    {
        const env = fresh();
        const withdrawn = new Set();
        let reads = 0;
        let atWithdrawal = null;
        const readRights = () => { reads++; const snapshot = new Set(withdrawn); return (id) => snapshot.has(id); };
        const r = await M.runMookReconcileBatched(deps(env, { readRights }), { sliceMax: 40, onPause: () => {
            if (reads > 0 && withdrawn.size === 0) { withdrawn.add('obra-0'); atWithdrawal = reads; }
        } });
        ok('los derechos se releen tras cada cesión', reads > atWithdrawal && atWithdrawal >= 1, `${reads} ${atWithdrawal}`);
        ok('desde la retirada, la obra no se reconoce', r.ok && r.recognition.unattributed.work_withdrawn > 0, JSON.stringify(r.recognition));
        ok('menos reconocimientos que la referencia', r.recognition.recognized < ref.recognition.recognized);
        ok('ledger coherente', verify(env));
        const again = await M.runMookReconcileBatched(deps(env, { readRights }));
        ok('reintento con la obra retirada: nada nuevo de esa obra', again.ok && again.recognition.recognized === 0 && again.recognition.unattributed.work_withdrawn === ofWork('obra-0'), String(again.recognition.unattributed.work_withdrawn));
    }

    section('[8] reintento idempotente');
    {
        const env = fresh();
        await M.runMookReconcileBatched(deps(env), { sliceMax: 13 });
        const before = digest(env).hash;
        const r2 = await M.runMookReconcileBatched(deps(env), { sliceMax: 5 });
        const r3 = M.runMookReconcileOnce(deps(env));
        ok('segundo barrido: nada nuevo', r2.ok && r2.recorded === 0 && r2.recognition.recognized === 0 && r2.alreadyRecorded === ref.recognition.recognized, JSON.stringify(r2).slice(0, 300));
        ok('tercer barrido síncrono: nada nuevo', r3.ok && r3.recorded === 0 && r3.recognition.recognized === 0);
        ok('ledger sin cambios', digest(env).hash === before && before === refDigest.hash);
    }

    section('[9] el programador usa el barrido por lotes');
    {
        const env = { ...fresh(), GAMIFICATION_RECONCILE_INITIAL_DELAY_MS: '0' };
        const got = await new Promise((resolve) => {
            const timer = setTimeout(() => resolve(null), 20_000);
            const h = M.startMookReconciler({ ...deps(env), onSweep: (r) => { clearTimeout(timer); h.stop(); resolve(r); } }, { env });
        });
        ok('barrido programado por lotes, con el mismo ledger', got?.ok === true && got.slices >= 1 && digest(env).hash === refDigest.hash, JSON.stringify(got).slice(0, 200));
    }

    section('[10] aislamiento');
    ok('data/ intacto', realFiles.map(sha).join() === realBefore.join());
    ok('sin gamification.db real', fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db')) === realGam);
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    D.closeGamificationDb({ resetBackoff: true });
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nmookReconcileBatched: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
