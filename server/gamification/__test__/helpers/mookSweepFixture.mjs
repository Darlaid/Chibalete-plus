/**
 * mookSweepFixture.mjs — CHP-GAMIFICACION-G4-PERF-01B.
 *
 * Documento MOOK sintético y determinista para medir y comparar barridos de
 * reconciliación. Cada experiencia se publica con el store real; después cada
 * evidencia replica la forma exacta de una entrega aprobada (run completado +
 * evidencia REVIEWED/aprobado con acceso congelado), con ids propios.
 * Solo datos sintéticos. Nunca toca data/ ni data-critical/.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const WORDS = 'una dos tres cuatro cinco seis siete ocho';

/**
 * @param {object} Store  módulo experienceStore
 * @param {{ n: number, experiences?: number, users?: number, reviewers?: number, sinceMs: number }} o
 */
export function buildSweepDoc(Store, { n, experiences = 20, users = 200, reviewers = 10, sinceMs }) {
    const doc = Store.emptyMookStore();
    const templates = [];
    for (let k = 0; k < experiences; k++) {
        const work = `obra-${k}`;
        const exp = Store.createExperience(doc, { slug: `perf-${k}`, title: `perf-${k}` });
        const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [
            { id: 'r', type: 'READING', title: 'r', resourceRef: work },
            { id: 'p', type: 'PRODUCTION', title: 'p', resourceRef: work, config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } },
        ] }] }, () => true);
        Store.publishVersion(doc, v.id);
        const { run } = Store.startRun(doc, { userId: 'plantilla', experienceId: exp.id });
        Store.completeNode(doc, run.id, 'r');
        const { evidence } = Store.submitEvidence(doc, { runId: run.id, nodeId: 'p', userId: 'plantilla', payload: { text: WORDS },
            workAccess: { workRef: work, decision: 'allowed', via: 'SCOPE_TITLE', at: new Date(sinceMs).toISOString() } });
        Store.reviewEvidence(doc, evidence.id, { reviewerId: 'plantilla-m', decision: 'aprobado' });
        templates.push({ run: structuredClone(doc.runs.at(-1)), ev: structuredClone(doc.evidence.at(-1)) });
    }
    doc.runs = [];
    doc.evidence = [];
    for (let i = 0; i < n; i++) {
        const t = templates[Math.floor(i / users) % experiences]; // cada persona recorre varias obras
        const userId = `u-${String(i % users).padStart(5, '0')}`;
        const reviewerId = `m-${i % reviewers}`;
        const at = new Date(sinceMs + 1000 + i * 10).toISOString();
        const runId = `run-perf-${i}`;
        const evId = `evid-perf-${i}`;
        doc.runs.push({ ...structuredClone(t.run), id: runId, userId, startedAt: at, completedAt: at,
            nodeStates: { r: { status: 'completed', completedAt: at, evidenceIds: [] }, p: { status: 'completed', completedAt: at, evidenceIds: [evId] } } });
        doc.evidence.push({ ...structuredClone(t.ev), id: evId, runId, userId, submittedAt: at,
            review: { status: 'REVIEWED', reviewerId, decision: 'aprobado', feedback: '', reviewedAt: at },
            versions: [{ text: WORDS, submittedAt: at }], history: [{ type: 'submitted', at }, { type: 'reviewed', reviewerId, decision: 'aprobado', at }] });
    }
    const roster = [];
    for (let u = 0; u < users; u++) roster.push({ id: `u-${String(u).padStart(5, '0')}`, accountStatus: 'active' });
    for (let r = 0; r < reviewers; r++) roster.push({ id: `m-${r}`, accountStatus: 'active' });
    return { doc, users: roster };
}

export const isUserActive = (u) => !u.accountStatus || u.accountStatus === 'active';
export const isSyntheticUser = (u) => !!u._loadtest_marker;

export const TEST_RECOGNITION = { approvalRef: 'PRUEBA-SINTETICA', amounts: { xp: { reading: 3, reflection: 4, validated: 4, route: 1 } },
    xpCeilingPerWorkCycle: 20, reread: { windowDays: 30, xpFactors: [0.5] } };

/**
 * Base y registro temporales, con reglas vigentes antes del corte.
 * `rules`: 'recognition' (registro por obra; MOOK no paga por hechos) o 'facts'
 * (sin registro por obra; la experiencia completada emite por hecho).
 */
export function freshLedger(D, L, dir, sinceMs, rules = 'recognition') {
    fs.mkdirSync(path.join(dir, 'db'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'reg'), { recursive: true });
    const reg = path.join(dir, 'reg', 'r.jsonl');
    fs.writeFileSync(reg, '');
    const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', GAMIFICATION_DB: path.join(dir, 'db', 'gamification.db'),
        GAMIFICATION_EXCLUSION_REGISTRY: reg, GAMIFICATION_MOOK_SINCE: new Date(sinceMs).toISOString() };
    process.env.GAMIFICATION_DB = env.GAMIFICATION_DB;
    process.env.GAMIFICATION_EXCLUSION_REGISTRY = reg;
    D.closeGamificationDb({ resetBackoff: true });
    const db = D.getGamificationDb({ env });
    L.createRuleSet(db, { ruleVersion: 'gm-perf-v1', createdBy: 'migration', now: sinceMs - 5000, effectiveFrom: sinceMs - 5000,
        rules: rules === 'facts'
            ? { schema: 1, facts: { 'mook_experience/experience_completed': { xp: 5 } } }
            : { schema: 1, facts: {}, recognition: TEST_RECOGNITION } });
    D.closeGamificationDb({ resetBackoff: true });
    return env;
}

/**
 * Huella del ledger independiente de ids aleatorios: por persona, su XP y la
 * secuencia de hechos y actos en orden de inserción; y los totales por tabla.
 */
export function ledgerDigest(L, S, db, users, { withTotals = true } = {}) {
    const perUser = {};
    const facts = db.prepare('SELECT source, fact_type, decision, occurred_at, rule_version FROM gm_source_facts WHERE subject_ref = ? ORDER BY rowid');
    const cycles = db.prepare('SELECT cycle, act, xp, pm FROM gm_work_cycles WHERE subject_ref = ? ORDER BY rowid');
    for (const u of users) {
        const ref = S.findSubject(db, u.id)?.subject_ref ?? null;
        perUser[u.id] = { xp: L.getXp(db, u.id), facts: ref ? facts.all(ref) : [], cycles: ref ? cycles.all(ref) : [] };
    }
    const totals = !withTotals ? null : Object.fromEntries(['gm_source_facts', 'gm_xp_entries', 'gm_work_cycles', 'gm_subjects', 'gm_pm_movements']
        .map((t) => [t, db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c]));
    const hash = crypto.createHash('sha256').update(JSON.stringify({ perUser, totals })).digest('hex');
    return { hash, totals };
}
