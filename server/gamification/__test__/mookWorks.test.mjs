/**
 * mookWorks.test.mjs — CHP-GAMIFICACION-PRIV-01E.
 *
 * Vinculación entre evidencia MOOK y obra, con datos sintéticos, el store MOOK
 * real, gamification.db temporal y server.js real por HTTP:
 *  [1] autoría  [2] obra válida, inexistente, retirada, no accesible o no obra
 *  [3] varias obras  [4] experiencia general  [5] asociación falsificada
 *  [6] obra, actividad, ciclo e idempotencia  [7] sujetos  [8] reglas vigentes
 *  [9] HTTP real
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/gamification/__test__/mookWorks.test.mjs
 */
import '../../__test__/helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePort } from '../../__test__/helpers/freePort.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..', '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_gam_works_'));

const Store = await import('../../lib/experienceStore.js');
const W = await import('../mookWorks.mjs');
const Rec = await import('../recognition.mjs');
const D = await import('../db.mjs');
const L = await import('../ledger.mjs');
const R = await import('../reconcile.mjs');
const X = await import('../exclusions.mjs');
const E = await import('../erasure.mjs');
const S = await import('../subjects.mjs');

const SINCE = Date.now() - 60_000;
const CATALOG = [
    { id: 'obra-a', titulo: 'Obra A', tipo: 'libro', status: 'disponible' },
    { id: 'obra-b', titulo: 'Obra B', tipo: 'libro_album', status: 'disponible' },
    { id: 'obra-c', titulo: 'Obra C', tipo: 'video', status: 'disponible' },
    { id: 'coleccion', tipo: 'libro', status: 'disponible', isCollection: true },
    { id: 'parte', tipo: 'libro', status: 'disponible', parentId: 'coleccion' },
    { id: 'guia', tipo: 'guia', status: 'disponible', parentId: 'obra-a' },
    { id: 'podcast', tipo: 'podcast', status: 'disponible' },
    { id: 'articulo', tipo: 'articulo_pedagogico', status: 'disponible' },
    { id: 'pieza', tipo: 'libro', status: 'disponible', standalone: false },
    { id: 'procesando', tipo: 'libro', status: 'procesando' },
    { id: 'con-error', tipo: 'libro', status: 'error' },
];
const catalogMap = (list = CATALOG) => new Map(list.map((c) => [c.id, c]));
const bookExists = (id) => CATALOG.some((c) => c.id === id);
const allow = () => true;
const WORDS = 'una dos tres cuatro cinco seis siete ocho';
const production = (id, resourceRef) => ({ id, type: 'PRODUCTION', title: `Producir ${id}`, ...(resourceRef !== undefined ? { resourceRef } : {}),
    config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } });
const reading = (id, resourceRef, required = true) => ({ id, type: 'READING', title: `Leer ${id}`, required, resourceRef });

function publish(doc, slug, nodes) {
    const exp = Store.createExperience(doc, { slug, title: slug });
    const v = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm1', title: 'M', nodes }] }, bookExists);
    Store.publishVersion(doc, v.id);
    return { exp, v };
}
/** Recorre la versión con el store real hasta aprobar sus producciones. */
function walk(doc, exp, v, userId = 'lector', reviewerId = 'mediador') {
    const { run } = Store.startRun(doc, { userId, experienceId: exp.id });
    const out = [];
    for (const n of Store.versionNodes(v)) {
        if (n.type !== 'PRODUCTION') { Store.completeNode(doc, run.id, n.id); continue; }
        const { evidence } = Store.submitEvidence(doc, { runId: run.id, nodeId: n.id, userId, payload: { text: WORDS } });
        Store.reviewEvidence(doc, evidence.id, { reviewerId, decision: 'aprobado' });
        out.push(evidence);
    }
    return out;
}
const workRefOf = Store.productionWorkRef;
const opts = (over = {}) => ({ catalog: catalogMap(), canAccess: allow, workRefOf, sinceMs: SINCE, ...over });
const reason = (r) => r.reasons[0];

const AMOUNTS = { xp: { reading: 10, reflection: 20, validated: 20, route: 5 }, pm: { reviewed: 7, validated: 7 } };
const CONFIG = { amounts: AMOUNTS, xpCeilingPerWorkCycle: 100, reread: { windowDays: 30, xpFactors: [0.5], pmFactors: [0.5] } };
const FLAGS = { xpEarning: true, pmEarning: true };
const SUBJECT = { exists: true, active: true, synthetic: false };
const decide = (evidence, history = []) => Rec.decideRecognition({ evidence, subject: SUBJECT, history, config: CONFIG, flags: FLAGS });

const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const realFiles = ['data/mook_db.json', 'data/content.json'].map((f) => path.join(REPO, f)).filter((f) => fs.existsSync(f));
const realBefore = realFiles.map(sha);
const realDbExisted = fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db'));

try {
    section('[1] autoría');
    {
        const doc = Store.emptyMookStore();
        const { v } = publish(doc, 'una-obra', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        ok('una obra: se publica y queda en la versión inmutable', v.status === 'published' && Store.productionWorkRef(v, 'p').workRef === 'obra-a');
        const none = publish(doc, 'sin-obra', [production('p')]);
        ok('sin obra: se sigue publicando como siempre', none.v.status === 'published' && Store.productionWorkRef(none.v, 'p').workRef === null);
        const exp = Store.createExperience(doc, { slug: 'x', title: 'x' });
        const draft = (nodes) => Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes }] }, bookExists);
        ok('obra inexistente: rechazada al guardar', throwsCode(() => draft([production('p', 'fantasma')]), 'RESOURCE_NOT_FOUND'));
        ok('lista de obras en un nodo: rechazada', throwsCode(() => draft([production('p', ['obra-a', 'obra-b'])]), 'INVALID_NODE'));
        ok('objeto en vez de contentId: rechazado', throwsCode(() => draft([production('p', { id: 'obra-a' })]), 'INVALID_NODE'));
        const orphan = draft([reading('r', 'obra-a'), production('p', 'obra-b')]);
        const before = JSON.stringify(doc);
        ok('obra que no se ofrece en la ruta: no se publica', throwsCode(() => Store.publishVersion(doc, orphan.id), 'WORK_NOT_IN_VERSION'));
        ok('el rechazo no cambia el store', JSON.stringify(doc) === before);
        const late = draft([production('p', 'obra-a'), reading('r', 'obra-a')]);
        ok('obra ofrecida después de la producción: no se publica', throwsCode(() => Store.publishVersion(doc, late.id), 'WORK_NOT_IN_VERSION'));
        ok('una versión publicada sigue siendo inmutable', throwsCode(() => Store.updateDraftVersion(doc, v.id, { modules: [{ id: 'm', title: 'M', nodes: [production('p')] }] }, bookExists), 'VERSION_IMMUTABLE'));
        const legacy = { id: 'vl', experienceId: 'e', status: 'published', modules: [{ id: 'm', title: 'M', nodes: [reading('r', 'obra-a'), { ...production('p', 'obra-b'), required: true }] }] };
        ok('un documento histórico inválido no se toca ni lanza', W.versionWorkCoverage(legacy, workRefOf).coverage === 'general' && W.versionWorkCoverage(legacy, workRefOf).associations[0].issue === 'WORK_NOT_IN_VERSION');
    }

    section('[2] obra válida, inexistente, retirada, no accesible');
    {
        const doc = Store.emptyMookStore();
        const { exp, v } = publish(doc, 'una', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        const [ev] = walk(doc, exp, v);
        const r = W.resolveEvidenceWork(doc, ev, opts());
        ok('obra válida: se atribuye con su actividad', r.workRef === 'obra-a' && r.activityRef === `${v.id}:p` && r.reasons.length === 0, JSON.stringify(r));
        const gone = W.resolveEvidenceWork(doc, ev, opts({ catalog: catalogMap(CATALOG.filter((c) => c.id !== 'obra-a')) }));
        ok('inexistente hoy: nada', gone.workRef === null && reason(gone) === 'work_not_found');
        for (const status of ['procesando', 'error', 'retirado', undefined]) {
            const c = W.resolveEvidenceWork(doc, ev, opts({ catalog: catalogMap(CATALOG.map((x) => (x.id === 'obra-a' ? { ...x, status } : x))) }));
            ok(`retirada o no disponible (${status}): nada`, c.workRef === null && reason(c) === 'work_unavailable');
        }
        ok('no accesible: nada', reason(W.resolveEvidenceWork(doc, ev, opts({ canAccess: () => false }))) === 'work_not_accessible');
        ok('solo `true` concede acceso', reason(W.resolveEvidenceWork(doc, ev, opts({ canAccess: () => 'si' }))) === 'work_not_accessible');
        ok('sin el resolutor de obra inyectado: nada', W.resolveEvidenceWork(doc, ev, opts({ workRefOf: undefined })).workRef === null);
        ok('sin decisión de acceso: nada', reason(W.resolveEvidenceWork(doc, ev, opts({ canAccess: undefined }))) === 'work_not_accessible');
        ok('si el acceso falla: nada', reason(W.resolveEvidenceWork(doc, ev, opts({ canAccess: () => { throw new Error('x'); } }))) === 'work_not_accessible');
        let asked = null;
        W.resolveEvidenceWork(doc, ev, opts({ canAccess: (u, c) => { asked = [u, c]; return true; } }));
        ok('el acceso se pregunta por el dueño de la evidencia y la obra', asked?.[0] === 'lector' && asked?.[1] === 'obra-a');
        const blocks = { coleccion: 'work_is_collection', parte: 'work_is_part', guia: 'work_is_part', podcast: 'work_not_classified', articulo: 'work_not_classified', pieza: 'work_not_standalone' };
        for (const [id, why] of Object.entries(blocks)) {
            const d = Store.emptyMookStore();
            const p = publish(d, 'k', [reading('r', id), production('p', id)]);
            const [e] = walk(d, p.exp, p.v);
            ok(`${id}: no cuenta como obra`, reason(W.resolveEvidenceWork(d, e, opts())) === why);
        }
        ok('los tipos admitidos son los del modelo', JSON.stringify(W.WORK_TIPOS) === JSON.stringify(['libro', 'libro_album', 'video']));
        const r2 = W.resolveEvidenceWork(doc, ev, opts({ catalog: catalogMap(CATALOG.filter((c) => c.id !== 'obra-a')) }));
        ok('rechazar no altera la evidencia ni la versión', ev.review.decision === 'aprobado' && Store.productionWorkRef(v, 'p').workRef === 'obra-a' && r2.activityRef === `${v.id}:p`);
    }

    section('[3] varias obras');
    {
        const doc = Store.emptyMookStore();
        const { exp, v } = publish(doc, 'varias', [reading('ra', 'obra-a'), reading('rb', 'obra-b'), production('pa', 'obra-a'), production('pb', 'obra-b')]);
        const [ea, eb] = walk(doc, exp, v);
        const cov = W.versionWorkCoverage(v, workRefOf);
        ok('la versión declara varias asociaciones', cov.coverage === 'multi' && cov.associations.length === 2);
        ok('cada evidencia va solo a la obra de su nodo', W.resolveEvidenceWork(doc, ea, opts()).workRef === 'obra-a' && W.resolveEvidenceWork(doc, eb, opts()).workRef === 'obra-b');
        const { evidence } = W.mookRecognitionEvidence(doc, { catalog: CATALOG, canAccess: allow, workRefOf, resolveUser: () => SUBJECT, gate: { excludes: () => false }, sinceMs: SINCE });
        ok('dos evidencias, dos entradas, sin repartir ninguna', evidence.length === 2 && new Set(evidence.map((e) => e.evidenceId)).size === 2);
        const blockedB = W.resolveEvidenceWork(doc, eb, opts({ canAccess: (_, c) => c === 'obra-a' }));
        ok('una obra no accesible no afecta a la otra', blockedB.workRef === null && W.resolveEvidenceWork(doc, ea, opts({ canAccess: (_, c) => c === 'obra-a' })).workRef === 'obra-a');
        const doc2 = Store.emptyMookStore();
        const two = publish(doc2, 'dos', [reading('ra', 'obra-a'), reading('rb', 'obra-b'), production('p', 'obra-b')]);
        const [e2] = walk(doc2, two.exp, two.v);
        const cov2 = W.versionWorkCoverage(two.v, workRefOf);
        ok('dos lecturas y una producción: solo la obra declarada', cov2.coverage === 'single' && W.resolveEvidenceWork(doc2, e2, opts()).workRef === 'obra-b');
    }

    section('[4] experiencia general');
    {
        const doc = Store.emptyMookStore();
        const { exp, v } = publish(doc, 'general', [reading('ra', 'obra-a'), production('p')]);
        const [ev] = walk(doc, exp, v);
        const r = W.resolveEvidenceWork(doc, ev, opts());
        ok('sin declaración: ninguna obra, aunque solo haya una lectura', W.versionWorkCoverage(v, workRefOf).coverage === 'general' && r.workRef === null && reason(r) === 'no_work_declared');
        v.modules[0] = { ...v.modules[0], title: 'Obra A' };
        ok('un título igual al de una obra no la asocia', W.resolveEvidenceWork(doc, ev, opts()).workRef === null);
        const d = decide({ source: 'mook_review', evidenceId: ev.id, userId: 'lector', actorId: 'mediador', at: Date.now(), decision: 'aprobado' });
        ok('la revisión sin obra no se reconoce: ni XP ni PM', d.outcome === 'not_recognized' && d.xp === 0 && d.pm === 0 && d.reasons.includes('no_work_coverage'), JSON.stringify(d));
        const route = decide({ source: 'mook_experience', evidenceId: 'ruta', userId: 'lector', at: Date.now() });
        ok('el progreso de la experiencia sigue siendo posible, sin PM ni obra', route.outcome === 'recognized' && route.xp === 5 && route.pm === 0 && route.entries[0].workRef === null);
    }

    section('[5] asociación alterada o falsificada');
    {
        const doc = Store.emptyMookStore();
        const { exp, v } = publish(doc, 'real', [reading('ra', 'obra-a'), production('p', 'obra-a')]);
        const other = publish(doc, 'otra', [reading('rb', 'obra-b'), production('p', 'obra-b')]);
        const { run } = Store.startRun(doc, { userId: 'lector', experienceId: exp.id });
        Store.completeNode(doc, run.id, 'ra');
        const { evidence: ev } = Store.submitEvidence(doc, { runId: run.id, nodeId: 'p', userId: 'lector',
            payload: { text: WORDS, workRef: 'obra-b', resourceRef: 'obra-b', contentId: 'obra-b', cycle: 9, config: { recognition: {} } } });
        Store.reviewEvidence(doc, ev.id, { reviewerId: 'mediador', decision: 'aprobado' });
        ok('el store solo conserva el texto entregado', JSON.stringify(Object.keys(ev.payload)) === '["text"]');
        ok('los campos enviados no cambian la obra', W.resolveEvidenceWork(doc, ev, opts()).workRef === 'obra-a');
        const forged = (patch) => W.resolveEvidenceWork(doc, { ...ev, ...patch }, opts());
        ok('un `workRef` añadido a la evidencia se ignora', forged({ workRef: 'obra-b' }).workRef === 'obra-a');
        ok('un payload alterado se ignora', forged({ payload: { text: WORDS, workRef: 'obra-b' } }).workRef === 'obra-a');
        for (const [name, patch] of Object.entries({
            'otra versión': { experienceVersionId: other.v.id }, 'otra experiencia': { experienceId: other.exp.id },
            'otro dueño': { userId: 'intruso' }, 'run inexistente': { runId: 'run-falso' }, 'nodo inexistente': { nodeId: 'n-falso' },
            'tipo de nodo cambiado': { nodeType: 'ACTIVITY' }, 'id no registrado en el run': { id: 'evid-falsa' },
        })) ok(`${name}: nada`, reason(forged(patch)) === 'evidence_binding_mismatch');
        const notApproved = forged({ review: { ...ev.review, decision: 'con_comentarios' } });
        ok('`con_comentarios` no se atribuye', notApproved.workRef === null && reason(notApproved) === 'evidence_not_approved');
        ok('sin revisión final no se atribuye', reason(forged({ review: { status: 'SUBMITTED' } })) === 'evidence_not_approved');
        ok('producción con `requiresReview` falso: nada', reason(forged({ requiresReview: false })) === 'activity_not_comprehension');
        ok('sin corte de activación: nada', reason(W.resolveEvidenceWork(doc, ev, opts({ sinceMs: null }))) === 'no_activation_cutoff');
        const publishedBefore = W.resolveEvidenceWork(doc, ev, opts({ sinceMs: Date.parse(v.publishedAt) + 1 }));
        ok('versión publicada antes del corte: requiere una versión nueva', reason(publishedBefore) === 'version_predates_contract');

        const act = Store.emptyMookStore();
        const a = publish(act, 'act', [reading('r', 'obra-a'), { id: 'act', type: 'ACTIVITY', title: 'A', resourceRef: 'obra-a', config: { preguntas: [{ texto: 'q' }] } }]);
        const { run: ar } = Store.startRun(act, { userId: 'lector', experienceId: a.exp.id });
        Store.completeNode(act, ar.id, 'r');
        const { evidence: ae } = Store.submitEvidence(act, { runId: ar.id, nodeId: 'act', userId: 'lector', payload: { answers: ['r'] } });
        ok('una actividad es participación: sin obra aunque tenga recurso', reason(W.resolveEvidenceWork(act, { ...ae, review: { status: 'REVIEWED', decision: 'aprobado' } }, opts())) === 'activity_not_comprehension');
    }

    section('[6] obra, actividad, ciclo e idempotencia');
    {
        const doc = Store.emptyMookStore();
        const first = publish(doc, 'ruta-1', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        const second = publish(doc, 'ruta-2', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        const [e1] = walk(doc, first.exp, first.v);
        const [e2] = walk(doc, second.exp, second.v);
        const ra = W.resolveEvidenceWork(doc, e1, opts());
        const rb = W.resolveEvidenceWork(doc, e2, opts());
        ok('misma obra, actividades distintas', ra.workRef === rb.workRef && ra.activityRef !== rb.activityRef);
        ok('el resolutor no decide el ciclo', !('cycle' in ra));
        const snapshot = JSON.stringify(doc);
        const run = () => W.mookRecognitionEvidence(doc, { catalog: CATALOG, canAccess: allow, workRefOf, resolveUser: () => SUBJECT, gate: { excludes: () => false }, sinceMs: SINCE });
        const a = run(); const b = run();
        ok('determinista: repetir da lo mismo', JSON.stringify(a) === JSON.stringify(b) && a.evidence.length === 2);
        ok('no escribe en el documento MOOK', JSON.stringify(doc) === snapshot);
        const [x, y] = a.evidence;
        const d1 = decide(x);
        ok('primera evidencia: PM una vez, ciclo 1', d1.outcome === 'recognized' && d1.pm === 7 && d1.cycle === 1, JSON.stringify(d1));
        let history = Rec.applyRecognition([], d1);
        ok('reinicio o reconciliación: la misma evidencia es duplicado', decide(x, history).outcome === 'duplicate' && decide(x, history).pm === 0);
        const d2 = decide(y, history);
        ok('otra evidencia, misma obra y ciclo: sin PM doble', d2.pm === 0 && d2.reasons.includes('pm_already_granted_in_cycle'), JSON.stringify(d2));
        ok('tampoco repite la lectura de la obra', d2.entries.every((e) => e.act !== 'reading'));
        history = Rec.applyRecognition(history, d2);
        const other = decide({ ...y, evidenceId: 'evid-otra', workRef: 'obra-b' }, history);
        ok('otra obra tiene su propio ciclo', other.pm === 7 && other.cycle === 1);
        ok('el orden no duplica', decide(x, Rec.applyRecognition([], decide(y))).pm === 0);

        const dir = path.join(tmp, 'ledger'); const regDir = path.join(tmp, 'reg');
        fs.mkdirSync(dir); fs.mkdirSync(regDir);
        const reg = path.join(regDir, 'registry.jsonl'); fs.writeFileSync(reg, '');
        const env = { GAMIFICATION_ENABLED: '1', XP_EARNING_ENABLED: '1', PM_EARNING_ENABLED: '1', GAMIFICATION_DB: path.join(dir, 'gamification.db'), GAMIFICATION_EXCLUSION_REGISTRY: reg };
        process.env.GAMIFICATION_DB = env.GAMIFICATION_DB;
        process.env.GAMIFICATION_EXCLUSION_REGISTRY = reg;
        D.closeGamificationDb({ resetBackoff: true });
        const db = D.getGamificationDb({ env });
        const NOW = Date.now();
        L.createRuleSet(db, { ruleVersion: 'gm-works-v1', createdBy: 'migration', now: NOW - 1000, rules: { schema: 1, caps: { pmPerDay: 100, pmPerWeek: 500 },
            facts: { 'mook_review/evidence_reviewed': {}, 'mook_experience/experience_completed': { xp: 5 } } } });
        const n = (sql, ...p) => db.prepare(sql).get(...p).c;
        const cands = R.mookReviewCandidates(doc);
        const sweep = () => R.reconcile(db, cands, { resolveUser: () => SUBJECT, env, now: () => NOW });
        const s1 = sweep(); const s2 = sweep();
        ok('dos barridos con flags ON: la revisión sigue sin escribir', s1.recorded === 0 && s2.recorded === 0 && s1.byDecision.observed === 2,  JSON.stringify(s1));
        ok('sin hechos, ciclos, XP ni PM', n('SELECT COUNT(*) c FROM gm_source_facts') === 0 && n('SELECT COUNT(*) c FROM gm_work_cycles') === 0
            && n('SELECT COUNT(*) c FROM gm_xp_entries') === 0 && n('SELECT COUNT(*) c FROM gm_pm_movements') === 0);
        const fact = L.recordFact(db, { source: 'mook_experience', sourceEventId: 'xv', factType: 'experience_completed', userId: 'lector', occurredAt: NOW, eligibility: 'eligible', now: NOW }, { env });
        const subject = S.findSubject(db, 'lector');
        ok('la clave de obra es estable por sujeto', S.deriveWorkKey(subject, 'obra-a') === S.deriveWorkKey(subject, 'obra-a'));
        const fact2 = L.recordFact(db, { source: 'mook_experience', sourceEventId: 'xv', factType: 'experience_completed', userId: 'otro', occurredAt: NOW, eligibility: 'eligible', now: NOW }, { env });
        ok('y distinta entre sujetos', S.deriveWorkKey(subject, 'obra-a') !== S.deriveWorkKey(S.findSubject(db, 'otro'), 'obra-a') && fact2.inserted);
        const cycle = db.prepare('INSERT INTO gm_work_cycles VALUES (?, ?, ?, ?, ?, ?, ?)');
        const key = S.deriveWorkKey(subject, 'obra-a');
        cycle.run(fact.factId, subject.subject_ref, key, 1, 'reflection', 0, 7);
        ok('una segunda réplica no puede repetir PM por obra y ciclo', throwsCode(() => cycle.run(fact2.factId, subject.subject_ref, key, 1, 'reflection', 0, 7), 'SQLITE_CONSTRAINT_UNIQUE'));
        ok('la clave en claro no aparece', !JSON.stringify(db.prepare('SELECT * FROM gm_work_cycles').all()).includes('obra-a'));
        ok('el ledger cuadra', L.verifyLedger(db).ok);

        section('[7] usuario excluido, inactivo o sintético');
        const users = new Map([['lector', SUBJECT], ['mediador', SUBJECT], ['inactivo', { exists: true, active: false, synthetic: false }], ['sintetico', { exists: true, active: true, synthetic: true }], ['excluido', SUBJECT], ['mediador-excluido', SUBJECT]]);
        const resolveUser = (id) => users.get(id) ?? null;
        const scenario = (userId, reviewerId) => {
            const d = Store.emptyMookStore();
            const p = publish(d, 's', [reading('r', 'obra-a'), production('p', 'obra-a')]);
            walk(d, p.exp, p.v, userId, reviewerId);
            return d;
        };
        const gather = (d, gate) => W.mookRecognitionEvidence(d, { catalog: CATALOG, canAccess: allow, workRefOf, resolveUser, gate, sinceMs: SINCE });
        const gateOpen = () => X.exclusionGate(db, env);
        ok('sin exclusiones: pasa', gather(scenario('lector', 'mediador'), gateOpen()).evidence.length === 1);
        for (const [who, u, a] of [['inactivo', 'inactivo', 'mediador'], ['sintético', 'sintetico', 'mediador'], ['inexistente', 'nadie', 'mediador'], ['revisor inactivo', 'lector', 'inactivo']]) {
            const r = gather(scenario(u, a), gateOpen());
            ok(`${who}: nada, solo un recuento`, r.evidence.length === 0 && r.unattributed.subject_not_eligible === 1 && !JSON.stringify(r).includes(u === 'lector' ? a : u), JSON.stringify(r));
        }
        E.excludeUser(db, { userId: 'excluido', env, now: NOW });
        E.excludeUser(db, { userId: 'mediador-excluido', env, now: NOW });
        ok('excluido: nada', gather(scenario('excluido', 'mediador'), gateOpen()).unattributed.subject_excluded === 1);
        ok('revisor excluido: nada', gather(scenario('lector', 'mediador-excluido'), gateOpen()).unattributed.subject_excluded === 1);
        ok('resolver no crea sujetos', !S.findSubject(db, 'excluido') && !S.findSubject(db, 'mediador'));
        ok('sin puerta de exclusiones: nada', gather(scenario('lector', 'mediador'), null).evidence.length === 0);
        fs.appendFileSync(reg, 'alterado\n');
        ok('registro alterado: la puerta bloquea', throwsCode(() => gateOpen(), 'EXCLUSION_REGISTRY_UNAVAILABLE'));
        const self = gather(scenario('lector', 'lector'), { excludes: () => false }).evidence[0];
        const selfDecision = decide(self);
        ok('autorrevisión: no se reconoce', selfDecision.outcome === 'not_recognized' && selfDecision.pm === 0 && selfDecision.reasons.includes('self_review'), JSON.stringify(selfDecision));

        section('[8] reglas vigentes');
        ok('el ledger no acepta obra ni ciclo del llamador', throwsCode(() => L.recordFact(db, { source: 'mook_review', sourceEventId: 'e', factType: 'evidence_reviewed', userId: 'lector', occurredAt: NOW, eligibility: 'eligible', workRef: 'obra-a' }, { env }), 'CALLER_FIELD_NOT_ALLOWED'));
        const reading1 = decide({ source: 'reading_completion', evidenceId: 'l1', userId: 'lector', at: NOW, workRef: 'obra-a', verdict: 'plausible', modality: 'pdf' });
        ok('la lectura sola sigue sin PM', reading1.pm === 0 && reading1.reasons.includes('reading_alone_never_pm'), JSON.stringify(reading1));
        ok('con flags OFF no se reconoce nada', Rec.decideRecognition({ evidence: x, subject: SUBJECT, history: [], config: CONFIG }).outcome === 'disabled');
        D.closeGamificationDb({ resetBackoff: true });
    }

    section('[9] HTTP real: el cliente no puede fijar la obra');
    {
        const dir = path.join(tmp, 'http'); const data = path.join(dir, 'data'); const sqlite = path.join(tmp, 'http_sqlite');
        fs.mkdirSync(data, { recursive: true }); fs.mkdirSync(path.join(dir, 'uploads')); fs.mkdirSync(sqlite);
        const fixture = Store.emptyMookStore();
        const { exp, v } = publish(fixture, 'http', [reading('r', 'obra-a'), production('p', 'obra-a')]);
        const draft = Store.createDraftVersion(fixture, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [production('p')] }] }, bookExists);
        fs.writeFileSync(path.join(data, 'mook_db.json'), JSON.stringify(fixture));
        fs.writeFileSync(path.join(data, 'content.json'), JSON.stringify(CATALOG));
        for (const f of ['progress_db.json', 'groups_db.json', 'schools_db.json', 'leo_evidence_db.json']) fs.writeFileSync(path.join(data, f), '[]');
        fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify([
            { id: 'u-admin', email: 'a@t.test', nombre_completo: 'A', roles: ['administrador'], accountStatus: 'active', password: 'x' },
            { id: 'u-lector', email: 'l@t.test', nombre_completo: 'L', roles: ['lector'], accountStatus: 'active', password: 'x' },
        ]));
        const port = await freePort();
        const child = spawn(process.execPath, [path.join(REPO, 'server', 'server.js')], {
            env: { ...process.env, NODE_ENV: 'test', PORT: String(port), USERS_DB: path.join(dir, 'users.json'), CHP_DATA_DIR: data, UPLOADS_ROOT: path.join(dir, 'uploads'),
                GAMIFICATION_ENABLED: '', XP_EARNING_ENABLED: '', PM_EARNING_ENABLED: '', GAMIFICATION_DB: path.join(dir, 'gam', 'gamification.db'), GAMIFICATION_MOOK_SINCE: '', EXPERIENCE_EVENTS_BACKBONE_ENABLED: '',
                EVENTS_SQLITE_PATH: path.join(sqlite, 'events.db'), ARCHIVE_SQLITE_PATH: path.join(sqlite, 'events.archive.db'), INSIGHTS_SQLITE_PATH: path.join(sqlite, 'insights.db'),
                PROGRESS_SQLITE_PATH: path.join(sqlite, 'progress.db'), OFFLINE_ASSIGNMENT_DB_PATH: path.join(sqlite, 'offline_assignments.db'), ROYALTIES_DB: path.join(sqlite, 'royalties.db'),
                IDENTITY_DB: path.join(sqlite, 'identity.db'), SESSIONS_DB: path.join(sqlite, 'sessions.db'), GROUPS_DB: path.join(data, 'groups_db.json'), SCHOOLS_DB: path.join(data, 'schools_db.json'),
                LEO_EVIDENCE_DB: path.join(data, 'leo_evidence_db.json') },
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let logs = '';
        child.stdout.on('data', (d) => { logs += d; });
        child.stderr.on('data', (d) => { logs += d; });
        const BASE = `http://127.0.0.1:${port}`;
        const call = async (method, url, user, body) => {
            const r = await fetch(`${BASE}${url}`, { method, headers: { 'content-type': 'application/json', 'x-user-id': user }, body: body ? JSON.stringify(body) : undefined });
            return { status: r.status, body: await r.json().catch(() => null) };
        };
        const stored = () => JSON.parse(fs.readFileSync(path.join(data, 'mook_db.json'), 'utf8'));
        try {
            for (let i = 0; ; i++) {
                try { if ((await fetch(`${BASE}/api/health`)).ok) break; } catch { /* arrancando */ }
                if (i > 120) throw new Error(`no arrancó:\n${logs.slice(-1500)}`);
                await sleep(500);
            }
            const start = await call('POST', `/api/experiences/${exp.id}/run`, 'u-lector');
            const runId = stored().runs[0]?.id;
            ok('el lector inicia la ruta', start.status === 201 && !!runId, JSON.stringify(start).slice(0, 300));
            await call('POST', `/api/experiences/runs/${runId}/nodes/r/complete`, 'u-lector');
            const sub = await call('POST', `/api/experiences/runs/${runId}/nodes/p/evidence`, 'u-lector',
                { text: WORDS, workRef: 'obra-b', resourceRef: 'obra-b', contentId: 'obra-b', cycle: 7, nodeId: 'otro', experienceVersionId: 'otra' });
            ok('la entrega se acepta', sub.status === 201, JSON.stringify(sub).slice(0, 300));
            const ev = stored().evidence[0];
            ok('los campos falsificados no se guardan', JSON.stringify(Object.keys(ev.payload)) === '["text"]' && ev.workRef === undefined && ev.nodeId === 'p' && ev.experienceVersionId === v.id);
            const hacked = await call('PUT', `/api/experiences/versions/${draft.id}`, 'u-lector', { modules: [{ id: 'm', title: 'M', nodes: [production('p', 'obra-b')] }] });
            ok('un lector no puede cambiar una versión', hacked.status === 401 || hacked.status === 403, String(hacked.status));
            const live = await call('PUT', `/api/experiences/versions/${v.id}`, 'u-admin', { modules: [{ id: 'm', title: 'M', nodes: [production('p', 'obra-b')] }] });
            ok('ni un administrador puede cambiar una versión publicada', live.status === 409, `${live.status} ${JSON.stringify(live.body)}`);
            const missing = await call('PUT', `/api/experiences/versions/${draft.id}`, 'u-admin', { modules: [{ id: 'm', title: 'M', nodes: [production('p', 'fantasma')] }] });
            ok('una obra inexistente se rechaza en el servidor', missing.status === 404 && missing.body?.code === 'RESOURCE_NOT_FOUND', `${missing.status} ${JSON.stringify(missing.body)}`);
            ok('la versión publicada no cambió', stored().versions.find((x) => x.id === v.id).modules[0].nodes[1].resourceRef === 'obra-a');
        } finally {
            child.kill();
            await new Promise((r) => child.on('close', r));
        }
    }

    section('[10] aislamiento');
    ok('data/ intacto', realFiles.map(sha).join() === realBefore.join());
    ok('sin gamification.db real', fs.existsSync(path.join(REPO, 'data-critical', 'gamification.db')) === realDbExisted);
} catch (e) {
    fail++;
    console.error('  ✗ excepción', e);
} finally {
    try { D.closeGamificationDb({ resetBackoff: true }); } catch { /* noop */ }
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`\nmookWorks: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
