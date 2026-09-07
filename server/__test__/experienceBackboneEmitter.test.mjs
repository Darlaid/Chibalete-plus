/**
 * experienceBackboneEmitter.test.mjs — CHP-MOOK-CANONICAL-EVENTS-01B.
 *
 * Los cinco hechos canónicos del MOOK se emiten desde el backend UNA sola vez
 * por transición real de dominio, con el contrato aditivo del registry y sin usar
 * `runId` como falsa sesión.
 *
 *   [A] Emisor en aislamiento: sink capturado con `setInserterForTest`, cero
 *       escrituras en events.db.
 *   [B] Rutas reales: server levantado contra fixtures TEMPORALES (mkdtemp) con
 *       el flag ENCENDIDO solo en ese proceso; se cuentan los hechos en el
 *       events.db temporal. Ningún store real se lee ni se escribe.
 *
 *   node server/__test__/experienceBackboneEmitter.test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

import { setInserterForTest } from '../services/analyticsShadow.mjs';
import * as emitter from '../experienceBackboneEmitter.mjs';
import { validateEvent, REGISTRY_VERSION } from '../analytics/eventRegistry.js';
import {
    emptyMookStore, createExperience, createDraftVersion, publishVersion,
    startRun, completeNode,
} from '../lib/experienceStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => cond
    ? (console.log('  ✓', label), pass++)
    : (console.error('  ✗', label, hint), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const words = (n) => Array.from({ length: n }, (_, i) => `palabra${i}`).join(' ');

const FLAG = 'EXPERIENCE_EVENTS_BACKBONE_ENABLED';
const BASE_PAYLOAD = { experienceId: 'exp-1', experienceVersionId: 'ver-1', runId: 'run-9' };

// ─────────────────────────────────────────────────────────────────────────────
// [A] Emisor en aislamiento
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[A] Emisor en aislamiento (sink capturado)');
const captured = [];
setInserterForTest((row) => { captured.push(row); });

ok('contrato aditivo: REGISTRY_VERSION sigue en 2 (precedente moduleId, sin bump)', REGISTRY_VERSION === 2, `→ ${REGISTRY_VERSION}`);

delete process.env[FLAG];
{
    const r = [
        emitter.emitExperienceStarted({ actorId: 'u1', sessionId: 's1', ...BASE_PAYLOAD }),
        emitter.emitNodeCompleted({ actorId: 'u1', sessionId: 's1', ...BASE_PAYLOAD, nodeId: 'n1', nodeType: 'READING', required: true }),
        emitter.emitExperienceCompleted({ actorId: 'u1', sessionId: 's1', ...BASE_PAYLOAD, requiredNodes: 3 }),
        emitter.emitEvidenceSubmitted({ actorId: 'u1', sessionId: 's1', ...BASE_PAYLOAD, nodeId: 'n2', nodeType: 'ACTIVITY', evidenceId: 'e1', requiresReview: false }),
        emitter.emitEvidenceReviewed({ actorId: 'u1', sessionId: 's1', experienceId: 'exp-1', experienceVersionId: 'ver-1', evidenceId: 'e1', reviewerId: 'adm', decision: 'aprobado' }),
    ];
    ok('1. flag OFF → los cinco emisores son no-op', r.every(x => x.ok === false && x.reason === 'disabled') && captured.length === 0);
}

process.env[FLAG] = '1';
{
    captured.length = 0;
    const r = emitter.emitExperienceStarted({ actorId: 'u1', sessionId: 'sess-abc', ...BASE_PAYLOAD });
    const row = captured[0];
    ok('flag ON → experience_started insertado una vez', r.ok === true && captured.length === 1 && row.event === 'experience_started');
    ok('actor = identidad autenticada; mode = experience; schema v1', row.userId === 'u1' && row.mode === 'experience' && row.schemaVersion === 1);
    ok('15. sessionId = la sesión real que entrega la ruta', row.sessionId === 'sess-abc');
    ok('16. runId permanece en el payload y no ocupa sessionId', row.payload.runId === 'run-9' && row.sessionId !== 'run-9');
    ok('payload validado (sin marca de fallo)', row.payload.__validation_failed === undefined);
}
{
    captured.length = 0;
    emitter.emitExperienceStarted({ actorId: 'u1', ...BASE_PAYLOAD });          // sin sesión firmada (modo off / legacy)
    const row = captured[0];
    ok('sin sesión firmada → sessionId vacío, jamás runId ni un id inventado', row.sessionId === '' && row.sessionId !== 'run-9');
}
{
    captured.length = 0;
    emitter.emitNodeCompleted({ actorId: 'u1', sessionId: 's', ...BASE_PAYLOAD, nodeId: 'n1', nodeType: 'READING', required: true, moduleId: 'm1' });
    ok('node_completed lleva required=true y valida contra el registry', captured[0].payload.required === true && captured[0].payload.__validation_failed === undefined);
    ok('node_completed sin `required` sigue validando (campo aditivo; el servidor lo envía siempre)', validateEvent('node_completed', { ...BASE_PAYLOAD, nodeId: 'n1', nodeType: 'READING' }).ok === true);
}
{
    captured.length = 0;
    emitter.emitEvidenceReviewed({ actorId: 'lector-1', sessionId: 's', experienceId: 'exp-1', experienceVersionId: 'ver-1', evidenceId: 'e1', reviewerId: 'admin-1', decision: 'aprobado' });
    const row = captured[0];
    ok('13. evidence_reviewed: sujeto = participante, reviewerId explícito en el payload', row.userId === 'lector-1' && row.payload.reviewerId === 'admin-1' && row.payload.__validation_failed === undefined);
    ok('evidence_reviewed sin reviewerId sigue validando (campo aditivo; el servidor lo envía siempre)', validateEvent('evidence_reviewed', { experienceId: 'exp-1', experienceVersionId: 'ver-1', evidenceId: 'e1', decision: 'aprobado' }).ok === true);
}
{
    // 17. El sink falla → el emisor no lanza y la transición de dominio previa sigue en pie.
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'x', title: 'X' });
    const v = createDraftVersion(doc, exp.id, { nodes: [{ id: 'n1', type: 'READING', title: 'Leer', resourceRef: 'book-1' }] }, () => true);
    publishVersion(doc, v.id);
    const { run } = startRun(doc, { userId: 'u1', experienceId: exp.id });
    const out = completeNode(doc, run.id, 'n1');
    setInserterForTest(() => { throw new Error('events.db caído'); });
    let threw = false;
    try { emitter.emitNodeCompleted({ actorId: 'u1', sessionId: null, experienceId: exp.id, experienceVersionId: v.id, runId: run.id, nodeId: 'n1', nodeType: 'READING', required: true }); }
    catch { threw = true; }
    ok('17. fallo del sink: el emisor no lanza y el nodo sigue completado en el dominio',
        !threw && out.nodeTransitioned === true && doc.runs[0].nodeStates.n1.status === 'completed');
    setInserterForTest(null);
}
delete process.env[FLAG];

// ─────────────────────────────────────────────────────────────────────────────
// [B] Rutas reales contra fixtures temporales
// ─────────────────────────────────────────────────────────────────────────────
const CATALOG = [{ id: 'book-1', titulo: 'Libro', autor: 'Autora', tipo: 'libro', status: 'disponible', portada_url: '/uploads/b.jpg' }];
const USERS = [
    { id: 'RDR', roles: ['lector'],        accountStatus: 'active', nombre_completo: 'Lectora' },
    { id: 'ADM', roles: ['administrador'], accountStatus: 'active', nombre_completo: 'Admin' },
];
const NODES = [
    { id: 'n1', type: 'READING',    title: 'Leer',        resourceRef: 'book-1' },
    { id: 'n2', type: 'ACTIVITY',   title: 'Actividad',   config: { instruccion: 'Responde', preguntas: [{ texto: 'p1' }] } },
    { id: 'n3', type: 'ACTIVITY',   title: 'Opcional',    required: false, config: { instruccion: 'Si quieres', preguntas: [{ texto: 'p2' }] } },
    { id: 'n4', type: 'PRODUCTION', title: 'Producción',  config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 5, maxPalabras: 40 } },
];
const mook = emptyMookStore();
const EXP = createExperience(mook, { slug: 'ruta', title: 'Ruta de prueba', description: 'fixture' });
const VER = createDraftVersion(mook, EXP.id, { objectives: ['o1'], nodes: NODES }, (id) => CATALOG.some(c => c.id === id));
publishVersion(mook, VER.id);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_mook_events_'));
const P = {
    data: path.join(tmp, 'data'), uploads: path.join(tmp, 'uploads'),
    users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'), events: path.join(tmp, 'events.db'),
};
fs.mkdirSync(P.data, { recursive: true }); fs.mkdirSync(P.uploads, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.groups, '[]'); fs.writeFileSync(P.schools, '[]'); fs.writeFileSync(P.access, '[]');
fs.writeFileSync(P.content, JSON.stringify(CATALOG));
fs.writeFileSync(path.join(P.data, 'mook_db.json'), JSON.stringify(mook));

const PORT = 3800 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env,
        NODE_ENV: 'test', PORT: String(PORT),
        SESSION_AUTH_MODE: 'off',
        [FLAG]: '1',                                   // solo en este proceso efímero
        CHP_DATA_DIR: P.data,
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'offline.db'),
        IDENTITY_DB: path.join(tmp, 'identity.db'),
        SESSIONS_DB: path.join(tmp, 'sessions.db'),
        EVENTS_SQLITE_PATH: P.events,
        INSIGHTS_SQLITE_PATH: path.join(tmp, 'insights.db'),
        PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'),
        ARCHIVE_SQLITE_PATH: path.join(tmp, 'events.archive.db'),
    },
});
let bootLog = '';
child.stdout.on('data', d => { bootLog += d; });
child.stderr.on('data', d => { bootLog += d; });

async function waitHealthy() {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${bootLog.slice(-2000)}`);
        try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* aún no escucha */ }
        await sleep(300);
    }
    throw new Error(`el server nunca respondió healthy\n${bootLog.slice(-2000)}`);
}
const call = async (method, p, userId, body) => {
    const r = await fetch(`${BASE}${p}`, {
        method, headers: { 'x-user-id': userId, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    let json = null; try { json = await r.json(); } catch { /* sin cuerpo */ }
    return { status: r.status, body: json };
};

let evdb = null;
const db = () => (evdb ??= new Database(P.events, { readonly: true, fileMustExist: true }));
const count = (event) => db().prepare('SELECT COUNT(*) AS n FROM events WHERE event = ?').get(event).n;
const rows = (event) => db().prepare('SELECT * FROM events WHERE event = ? ORDER BY id').all(event)
    .map(r => ({ ...r, payload: JSON.parse(r.payload_json || '{}') }));
const total = () => db().prepare('SELECT COUNT(*) AS n FROM events').get().n;
const storeEvidence = () => JSON.parse(fs.readFileSync(path.join(P.data, 'mook_db.json'), 'utf8')).evidence;

try {
    await waitHealthy();
    console.log('\n[B] Rutas reales — un hecho por transición');
    const runPath = `/api/experiences/${EXP.id}/run`;

    // 2–3. inicio
    const r1 = await call('POST', runPath, 'RDR');
    const runId = r1.body?.runId;
    ok('2. inicio nuevo → 201 y un experience_started', r1.status === 201 && count('experience_started') === 1, `→ ${r1.status}`);
    const r2 = await call('POST', runPath, 'RDR');
    ok('3. start repetido → 200 y cero eventos adicionales', r2.status === 200 && r2.body?.runId === runId && count('experience_started') === 1);

    // GET no emite
    const before = total();
    await call('GET', `/api/experiences/${EXP.id}/route`, 'RDR');
    await call('GET', `/api/experiences/${EXP.id}`, 'RDR');
    ok('GET de ruta y landing no emiten ningún hecho', total() === before);

    // 4–5. nodo requerido
    const c1 = await call('POST', `/api/experiences/runs/${runId}/nodes/n1/complete`, 'RDR');
    ok('4. nodo requerido nuevo → un node_completed', c1.status === 200 && count('node_completed') === 1, `→ ${c1.status}`);
    const nc = rows('node_completed')[0];
    ok('   payload: required=true, runId presente, actor = lector, sessionId ≠ runId', nc.payload.required === true && nc.payload.runId === runId && nc.user_id === 'RDR' && nc.session_id !== runId);
    ok('   sin sesión firmada (modo off) sessionId queda vacío', nc.session_id === '');
    const startedBefore = count('node_started');
    const c2 = await call('POST', `/api/experiences/runs/${runId}/nodes/n1/complete`, 'RDR');
    ok('5. nodo requerido repetido → 200, cero node_completed adicionales', c2.status === 200 && count('node_completed') === 1);
    ok('   y tampoco reemite node_started', count('node_started') === startedBefore);

    // 9–10. evidencia inicial y su retry
    const e2 = await call('POST', `/api/experiences/runs/${runId}/nodes/n2/evidence`, 'RDR', { answers: ['a'] });
    ok('9. evidencia inicial → 201, una evidencia y un evidence_submitted', e2.status === 201 && count('evidence_submitted') === 1 && storeEvidence().length === 1, `→ ${e2.status}`);
    ok('   la ACTIVITY requerida también cuenta como node_completed', count('node_completed') === 2);
    const e2b = await call('POST', `/api/experiences/runs/${runId}/nodes/n2/evidence`, 'RDR', { answers: ['a'] });
    ok('10. retry de la evidencia inicial → 200 con la MISMA evidencia, sin nueva evidencia ni eventos',
        e2b.status === 200 && e2b.body?.evidenceId === e2.body?.evidenceId && storeEvidence().length === 1
        && count('evidence_submitted') === 1 && count('node_completed') === 2 && count('experience_completed') === 0);

    // 6. nodo opcional
    const e3 = await call('POST', `/api/experiences/runs/${runId}/nodes/n3/evidence`, 'RDR', { answers: ['b'] });
    ok('6. nodo opcional → evidencia y evidence_submitted, pero cero node_completed', e3.status === 201 && count('evidence_submitted') === 2 && count('node_completed') === 2);

    // 7–8. finalización
    const e4 = await call('POST', `/api/experiences/runs/${runId}/nodes/n4/evidence`, 'RDR', { text: words(10) });
    ok('7. finalización nueva → run completed y un experience_completed', e4.status === 201 && e4.body?.status === 'completed' && count('experience_completed') === 1 && count('node_completed') === 3, `→ ${e4.status}`);
    const e4b = await call('POST', `/api/experiences/runs/${runId}/nodes/n4/evidence`, 'RDR', { text: words(10) });
    const c3 = await call('POST', `/api/experiences/runs/${runId}/nodes/n1/complete`, 'RDR');
    ok('8. run ya completado: retry de evidencia y completar de nuevo → cero eventos adicionales',
        e4b.status === 200 && c3.status === 200 && count('experience_completed') === 1 && count('node_completed') === 3
        && count('evidence_submitted') === 3 && storeEvidence().length === 3);

    // 11–12. reenvío solicitado
    const evidenceId = e4.body?.evidenceId;
    const rc = await call('POST', `/api/experiences/review/${evidenceId}/request-changes`, 'ADM', { comment: 'ajusta' });
    ok('   solicitar ajustes no emite hechos', rc.status === 200 && count('evidence_submitted') === 3, `→ ${rc.status}`);
    const rs = await call('POST', `/api/experiences/evidence/${evidenceId}/resubmit`, 'RDR', { text: words(12) });
    ok('11. resubmit válido → un nuevo evidence_submitted', rs.status === 200 && count('evidence_submitted') === 4, `→ ${rs.status}`);
    const rs2 = await call('POST', `/api/experiences/evidence/${evidenceId}/resubmit`, 'RDR', { text: words(12) });
    ok('12. resubmit repetido → 409 (transición consumida) y cero eventos', rs2.status === 409 && count('evidence_submitted') === 4, `→ ${rs2.status}`);

    // 13–14. revisión
    const rv = await call('POST', `/api/experiences/review/${evidenceId}`, 'ADM', { decision: 'con_comentarios', feedback: 'bien' });
    const er = rows('evidence_reviewed')[0];
    ok('13. revisión válida → un evidence_reviewed con reviewerId = revisor y sujeto = participante',
        rv.status === 200 && count('evidence_reviewed') === 1 && er.payload.reviewerId === 'ADM' && er.user_id === 'RDR', `→ ${rv.status}`);
    const rv2 = await call('POST', `/api/experiences/review/${evidenceId}`, 'ADM', { decision: 'aprobado' });
    ok('14. revisión repetida → 409 y cero eventos adicionales', rv2.status === 409 && count('evidence_reviewed') === 1, `→ ${rv2.status}`);

    // 16. ningún hecho usa runId como sesión
    const withRunAsSession = db().prepare("SELECT COUNT(*) AS n FROM events WHERE mode = 'experience' AND session_id = ?").get(runId).n;
    ok('16. ningún evento experience lleva el runId como session_id', withRunAsSession === 0);
    const invalid = db().prepare("SELECT COUNT(*) AS n FROM events WHERE payload_json LIKE '%__validation_failed%'").get().n;
    ok('todos los hechos emitidos validan contra el registry', invalid === 0, `→ ${invalid}`);
} catch (e) {
    console.error('  ✗ fallo de la suite:', e.message);
    fail++;
} finally {
    try { evdb?.close(); } catch { /* noop */ }
    child.kill();
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
}

console.log(`\nexperienceBackboneEmitter: ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
