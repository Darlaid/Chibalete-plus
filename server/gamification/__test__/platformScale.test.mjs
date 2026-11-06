/**
 * platformScale.test.mjs — CHP-GAMIFICACION-V8-INTEGRATION-01.
 *
 * Escala de plataforma con datos sintéticos representativos: 3 colegios × 4
 * grupos × 25 lectores (300 lectores, 12 mediadores) y 4 entregas aprobadas por
 * lector (1200 evidencias): dos reflexiones y una tercera sobre la misma obra
 * (techo de 50) y una reflexión sobre otra obra. 24 lectores excluidos antes
 * del barrido y 12 sin acceso a la segunda obra.
 *  [1] barrido por lotes de una réplica: totales exactos y tiempo
 *  [2] cuatro réplicas a la vez sobre otra base: mismo resultado, sin duplicados
 *  [3] agregados por grupo (k ≥ 5) y exclusiones
 *  [4] latencia de «Mi progreso» con el documento completo
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/platformScale.test.mjs
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

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_scale_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');
const Store = await import('../../lib/experienceStore.js');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const M = await import('../mookSource.mjs');
const E = await import('../erasure.mjs');
const P = await import('../progress.mjs');
const { isUserActive, isSyntheticUser } = await import('./helpers/mookSweepFixture.mjs');

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const realFiles = ['data/mook_db.json', 'data/content.json'].map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f));
const realBefore = realFiles.map(sha);

const SINCE = Date.now() - 3_600_000;
const PILOT = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 10, reflection: 20, validated: 0, route: 0 }, pm: { reviewed: 0, validated: 0 } },
    xpCeilingPerWorkCycle: 50, reread: { windowDays: 30, xpFactors: [], pmFactors: [] } };
const WORDS = 'una dos tres cuatro cinco seis siete ocho';
const SCHOOLS = 3, GROUPS = 4, READERS = 25;

// ── Plataforma sintética ─────────────────────────────────────────────────────
const doc = Store.emptyMookStore();
const mkExp = (slug, work, prods) => {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [{ id: 'r', type: 'READING', title: 'r', resourceRef: work },
        ...prods.map((id) => ({ id, type: 'PRODUCTION', title: id, resourceRef: work, config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } }))] }] }, () => true);
    Store.publishVersion(doc, v.id);
    return exp;
};
const X1 = mkExp('x1', 'obra-1', ['p1', 'p2']), X1b = mkExp('x1b', 'obra-1', ['p']), X2 = mkExp('x2', 'obra-2', ['p']);
const users = [], groups = [], excluded = new Set(), noAccess = new Set();
const t0 = performance.now();
for (let s = 0; s < SCHOOLS; s++) for (let g = 0; g < GROUPS; g++) {
    const gid = `g-${s}-${g}`, med = `m-${s}-${g}`;
    const members = [];
    users.push({ id: med, accountStatus: 'active', roles: ['mediador'], organizationId: `org-${s}` });
    for (let r = 0; r < READERS; r++) {
        const id = `l-${s}-${g}-${String(r).padStart(2, '0')}`;
        members.push(id);
        users.push({ id, accountStatus: 'active', roles: ['lector'], organizationId: `org-${s}` });
        if (r < 2) excluded.add(id);
        if (r === 2) noAccess.add(id);
        const grant = (w) => ({ workRef: w, decision: noAccess.has(id) && w === 'obra-2' ? 'denied' : 'allowed', via: noAccess.has(id) && w === 'obra-2' ? 'SCOPE_NO_RULES' : 'SCOPE_TITLE', at: new Date().toISOString() });
        const deliver = (exp, node, w) => {
            const { run } = Store.startRun(doc, { userId: id, experienceId: exp.id });
            if (run.nodeStates.r?.status !== 'completed') Store.completeNode(doc, run.id, 'r');
            const { evidence } = Store.submitEvidence(doc, { runId: run.id, nodeId: node, userId: id, payload: { text: WORDS }, workAccess: grant(w) });
            Store.reviewEvidence(doc, evidence.id, { reviewerId: med, decision: 'aprobado' });
        };
        deliver(X1, 'p1', 'obra-1'); deliver(X1, 'p2', 'obra-1'); deliver(X1b, 'p', 'obra-1'); deliver(X2, 'p', 'obra-2');
    }
    groups.push({ id: gid, mediator: med, members });
}
const buildMs = Math.round(performance.now() - t0);
const readers = users.filter((u) => u.roles[0] === 'lector');
const active = readers.filter((u) => !excluded.has(u.id));
const expectXp = active.reduce((s, u) => s + 50 + (noAccess.has(u.id) ? 0 : 30), 0);
const expectFacts = active.reduce((s, u) => s + 2 + (noAccess.has(u.id) ? 0 : 1), 0);
const FIX = path.join(tmp, 'mook.json'), USERS = path.join(tmp, 'users.json');
fs.writeFileSync(FIX, JSON.stringify(doc));
fs.writeFileSync(USERS, JSON.stringify(users));

function lab(name) {
    const dir = path.join(tmp, name);
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true }); fs.mkdirSync(path.join(dir, 'reg'));
    const reg = path.join(dir, 'reg', 'r.jsonl'); fs.writeFileSync(reg, '');
    const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '', GAMIFICATION_DB: path.join(dir, 'db', 'gamification.db'),
        GAMIFICATION_EXCLUSION_REGISTRY: reg, GAMIFICATION_MOOK_SINCE: new Date(SINCE).toISOString() };
    Object.assign(process.env, { GAMIFICATION_DB: env.GAMIFICATION_DB, GAMIFICATION_EXCLUSION_REGISTRY: reg });
    D.closeGamificationDb({ resetBackoff: true });
    const db = D.getGamificationDb({ env });
    L.createRuleSet(db, { ruleVersion: 'gm-v8-scale', createdBy: 'migration', now: SINCE - 5000, effectiveFrom: SINCE - 5000,
        rules: { schema: 1, caps: { pmPerDay: 0, pmPerWeek: 0 }, facts: {}, recognition: PILOT } });
    for (const id of excluded) E.excludeUser(db, { userId: id, env });
    return { db, env };
}
const deps = { readMook: () => doc, readUsers: () => users, isUserActive, isSyntheticUser, workRefOf: Store.productionWorkRef, readRights: () => () => false };
const totals = (db) => ({
    facts: db.prepare('SELECT COUNT(*) c FROM gm_source_facts').get().c,
    xp: db.prepare('SELECT COALESCE(SUM(xp),0) n FROM gm_xp_entries').get().n,
    cycles: db.prepare('SELECT COALESCE(SUM(xp),0) n FROM gm_work_cycles').get().n,
    subjects: db.prepare("SELECT COUNT(*) c FROM gm_subjects WHERE role_class = 'reader'").get().c,
});

try {
    console.log(`plataforma: ${SCHOOLS} colegios, ${groups.length} grupos, ${readers.length} lectores, ${doc.evidence.length} evidencias aprobadas (construida en ${buildMs} ms)`);

    section('[1] barrido por lotes de una réplica');
    let single;
    {
        const { db, env } = lab('single');
        const t = performance.now();
        const r = await M.runMookReconcileBatched({ ...deps, env });
        const ms = Math.round(performance.now() - t);
        single = totals(db);
        console.log(`  · primer barrido: ${ms} ms (${(ms / doc.evidence.length).toFixed(2)} ms por evidencia)`);
        ok('termina bien', r.ok !== false && !r.skipped, JSON.stringify(r).slice(0, 300));
        ok(`XP exacto (${expectXp}) y hechos exactos (${expectFacts})`, single.xp === expectXp && single.facts === expectFacts, JSON.stringify(single));
        ok('XP del ledger = suma de ciclos de obra', single.xp === single.cycles);
        ok(`un sujeto por lector reconocido (${active.length}), ninguno para excluidos`, single.subjects === active.length);
        const t2 = performance.now();
        await M.runMookReconcileBatched({ ...deps, env });
        const ms2 = Math.round(performance.now() - t2);
        console.log(`  · segundo barrido sin novedades: ${ms2} ms`);
        ok('repetir no cambia nada', JSON.stringify(totals(db)) === JSON.stringify(single));
        ok('ledger íntegro, sin PM', L.verifyLedger(db).ok && db.prepare('SELECT COUNT(*) c FROM gm_pm_movements').get().c === 0);

        section('[3] agregados por grupo y exclusiones');
        const counts = groups.map((g) => P.readGroupRecognitionCounts(db, g.members, { eligibleWorkRefs: ['obra-1', 'obra-2'], env }));
        ok('cada grupo: 23 de 25 con obra reconocida (2 excluidos cuentan como sin reconocimiento)', counts.every((c) => c.studentsWithRecognizedWork === READERS - 2 && !c.suppressed),
            JSON.stringify(counts.slice(0, 2)));
        ok('grupo de 4: suprimido', P.readGroupRecognitionCounts(db, groups[0].members.slice(0, 4), { env }).suppressed === true);
        ok('excluidos: sin sujeto ni XP', [...excluded].every((id) => L.getXp(db, id) === 0) && db.prepare('SELECT COUNT(*) c FROM gm_erasures').get().c === excluded.size);
        ok('sin acceso a obra-2: solo los 50 de obra-1', [...noAccess].every((id) => L.getXp(db, id) === 50));
        ok('lector típico: 80', L.getXp(db, 'l-1-2-10') === 80);

        section('[4] latencia de «Mi progreso» con el documento completo');
        const pdeps = { ...deps, env, titleOf: (id) => `Título ${id}`, workAccessOf: async (w) => ({ workRef: w, decision: 'allowed', via: 'SCOPE_TITLE' }) };
        db.pragma('wal_checkpoint(PASSIVE)');
        const sample = active.filter((_, i) => i % 23 === 0).map((u) => u.id);
        const lat = [];
        for (const id of sample) { const t3 = performance.now(); const out = await M.readMyProgress(id, pdeps); lat.push(performance.now() - t3); if (out.xp !== L.getXp(db, id)) throw new Error(`xp ${id}`); }
        lat.sort((a, b) => a - b);
        const p50 = lat[Math.floor(lat.length / 2)].toFixed(1), p95 = lat[Math.floor(lat.length * 0.95)].toFixed(1);
        console.log(`  · ${sample.length} lecturas: p50 ${p50} ms, p95 ${p95} ms`);
        ok('cada lectura coincide con el ledger', lat.length === sample.length);
        ok('p95 por debajo de 1 s con 1200 evidencias', Number(p95) < 1000, p95);
    }

    section('[2] cuatro réplicas a la vez');
    {
        const { env } = lab('concurrent');
        D.closeGamificationDb({ resetBackoff: true });
        const worker = path.join(HERE, 'mookBatchedWorker.mjs');
        const barrier = path.join(tmp, 'barrier');
        const run = () => new Promise((resolve) => {
            const c = spawn(process.execPath, [worker, 'replica', barrier], { env: { ...process.env, ...env, CHP_FIXTURE: FIX, CHP_USERS: USERS }, stdio: ['ignore', 'pipe', 'pipe'] });
            let out = ''; c.stdout.on('data', (d) => { out += d; }); c.stderr.on('data', (d) => { out += d; });
            c.on('close', (code) => resolve({ code, out }));
        });
        const procs = [run(), run(), run(), run()];
        await sleep(500);
        const t = performance.now();
        fs.writeFileSync(barrier, '');
        const done = await Promise.all(procs);
        const ms = Math.round(performance.now() - t);
        console.log(`  · 4 réplicas × 3 barridos: ${ms} ms en total`);
        ok('las cuatro terminan', done.every((d) => d.code === 0), JSON.stringify(done.map((d) => d.out.slice(-200))));
        const check = new Database(env.GAMIFICATION_DB, { readonly: true });
        const conc = totals(check);
        ok('mismo resultado que una réplica, sin duplicados', JSON.stringify(conc) === JSON.stringify(single), JSON.stringify({ conc, single }));
        ok('integridad SQLite', check.pragma('integrity_check', { simple: true }) === 'ok');
        check.close();
    }

    section('[aislamiento]');
    ok('stores reales intactos', realFiles.map(sha).join() === realBefore.join());
} catch (e) {
    fail++;
    console.error('  ✗ excepción', e);
} finally {
    try { D.closeGamificationDb({ resetBackoff: true }); } catch { /* noop */ }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}
console.log(`\nplatformScale (V8-INTEGRATION-01): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
