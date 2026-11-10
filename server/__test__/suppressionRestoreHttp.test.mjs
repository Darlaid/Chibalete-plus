/**
 * suppressionRestoreHttp.test.mjs — CHP-V8.1-CLOSE-08A (G-05/G-08).
 *
 * Supresión efectiva sobre las fuentes identificadas y recuperación de respaldos,
 * con server.js REAL y datos sintéticos:
 *  [0] antes: el mediador ve a la persona (status, Aula Viva, exportación)
 *  [1] supresión: constancia y retiros, MOOK (recorridos y producciones), entregas de
 *      tareas y baja con la operación existente (DELETE)
 *  [2] restauración desde un «respaldo» anterior con el servidor en marcha: la cuenta
 *      vuelve al padrón, pero ningún mediador vuelve a ver su información; la
 *      conciliación la desactiva y vuelve a suprimir MOOK y entregas
 *  [3] MOOK: conservación por orden escrita (legalHold) y seudónimo del revisor suprimido
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/suppressionRestoreHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { freePort } from './helpers/freePort.mjs';
import { a2RegistryPath, grantA1, grantA2, grantC005 } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as Store from '../lib/experienceStore.js';
import * as SUP from '../privacy/suppression.mjs';
import * as R from '../privacy/a2Registry.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

const ORG = 'org-alfa';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_suprestore_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), uploads: path.join(tmp, 'uploads'), bak: path.join(tmp, 'backup') };
for (const d of [P.data, P.uploads, P.bak]) fs.mkdirSync(d, { recursive: true });
P.mook = path.join(P.data, 'mook_db.json');
P.subs = path.join(P.data, 'submissions_db.json');
a2RegistryPath();
const READERS = ['sup', 'k1', 'k2', 'k3', 'k4', 'k5'];
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'adm', roles: ['administrador'], accountStatus: 'active' },
    { id: 'med', roles: ['mediador'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher' },
    ...READERS.map((id) => ({ id, nombre_completo: `Sint ${id}`, email: `${id}@fixture.invalid`, roles: ['lector'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active' })),
], null, 2));
fs.writeFileSync(P.groups, JSON.stringify([{ id: 'g-a1', type: 'course', organizationId: ORG, school: 'Colegio Alfa', mediatorIds: ['med'], memberIds: READERS, studentIds: READERS }], null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG, name: 'Colegio Alfa' }]));
fs.writeFileSync(P.access, '[]'); fs.writeFileSync(P.content, '[]');
grantA1(READERS); grantA2(READERS); grantC005(['med']);

// MOOK: producción pendiente de `sup` y otra de `k1` revisada por `med`.
const doc = Store.emptyMookStore();
const exp = Store.createExperience(doc, { slug: 'e', title: 'E' });
const ver = Store.createDraftVersion(doc, exp.id, { modules: [{ id: 'm', title: 'M', nodes: [{ id: 'p', type: 'PRODUCTION', title: 'p', config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } }] }] }, () => true);
Store.publishVersion(doc, ver.id);
const produce = (u) => { const run = Store.startRun(doc, { userId: u, experienceId: exp.id }).run; return Store.submitEvidence(doc, { runId: run.id, nodeId: 'p', userId: u, payload: { text: `TEXTO-PRIVADO-${u} dos tres` } }).evidence; };
produce('sup');
const evK1 = produce('k1');
Store.reviewEvidence(doc, evK1.id, { reviewerId: 'med', decision: 'aprobado', feedback: 'bien' });
fs.writeFileSync(P.mook, JSON.stringify(doc, null, 2));
fs.writeFileSync(P.subs, JSON.stringify([
    { id: 's-sup', taskId: 't-1', studentId: 'sup', groupId: 'g-a1', responseText: 'RESPUESTA-PRIVADA-sup', status: 'submitted', submittedAt: '2026-11-01T15:00:00.000Z', wordCount: 2 },
    { id: 's-k1', taskId: 't-1', studentId: 'k1', groupId: 'g-a1', responseText: 'respuesta k1', status: 'submitted', submittedAt: '2026-11-01T15:00:00.000Z', wordCount: 2 },
], null, 2));

const spawnApi = (port) => {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(P.data, 'progress.db'),
            EVENTS_SQLITE_PATH: path.join(P.data, 'events.db'), ARCHIVE_SQLITE_PATH: path.join(P.data, 'archive.db'),
            INSIGHTS_SQLITE_PATH: path.join(P.data, 'insights.db'), OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, 'offline.db'),
            IDENTITY_DB: path.join(P.data, 'identity.db'), SESSIONS_DB: path.join(P.data, 'sessions.db'), LEO_EVIDENCE_DB: path.join(P.data, 'leo_evidence_db.json'),
            ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off', OPENAI_API_KEY: '', GEMINI_API_KEY: '',
        },
    });
    let logs = ''; child.stdout.on('data', (d) => { logs += d; }); child.stderr.on('data', (d) => { logs += d; });
    child.logs = () => logs; child.base = `http://127.0.0.1:${port}`;
    return child;
};
const healthy = async (c) => { for (let i = 0; i < 200; i++) { if (c.exitCode !== null) throw new Error(c.logs().slice(-1500)); try { if ((await fetch(`${c.base}/api/health`)).ok) return; } catch { /* */ } await sleep(300); } throw new Error('nunca healthy'); };
const req = (c, method, url, as) => fetch(`${c.base}${url}`, { method, headers: { 'x-user-id': as, 'sec-fetch-site': 'same-origin' } });
const status = async (c, s) => (await req(c, 'GET', `/api/students/${s}/status`, 'med')).status;
const readers = async (c) => { const r = await req(c, 'GET', '/api/groups/g-a1/analytics-summary', 'med'); const b = await r.json().catch(() => null); return (b?.readers ?? []).map((x) => x.userId); };
const exportOf = async (c, s) => (await req(c, 'GET', `/api/students/${s}/export-submissions`, 'med')).status;
const J = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const mookHas = (u) => { const d = J(P.mook); return d.runs.some((r) => r.userId === u) || d.evidence.some((e) => e.userId === u); };
const subsHas = (u) => J(P.subs).some((s) => s.studentId === u);
const TODAY = R.dayOf(Date.now());

let api;
try {
    api = spawnApi(await freePort());
    await healthy(api);

    section('[0] antes');
    ok('el mediador ve a la persona: status 200, en Aula Viva y exportable', (await status(api, 'sup')) === 200 && (await readers(api)).includes('sup') && (await exportOf(api, 'sup')) === 200);
    for (const f of [P.users, P.groups, P.mook, P.subs]) fs.copyFileSync(f, path.join(P.bak, path.basename(f)));

    section('[1] supresión');
    const a = SUP.suppressAccount(null, { userId: 'sup', requestRef: 'SOL-SINT-0100', requestDay: TODAY, capacity: 'legal_representative' });
    const m = await SUP.suppressMookParticipant({ mookPath: P.mook, userId: 'sup', requestRef: 'SOL-SINT-0100' });
    const s = await SUP.suppressSubmissions({ submissionsPath: P.subs, userId: 'sup', requestRef: 'SOL-SINT-0100' });
    const del = await req(api, 'DELETE', '/api/users/sup', 'adm');
    ok('constancia y retiros; MOOK y entregas eliminadas; baja con DELETE', a.tombstoned && m.evidenceRemoved === 1 && m.runsRemoved === 1 && s.submissionsRemoved === 1 && del.status === 200,
        JSON.stringify({ a, m, s, del: del.status }));
    ok('los archivos ya no contienen a la persona ni su texto', !mookHas('sup') && !subsHas('sup') && !fs.readFileSync(P.mook, 'utf8').includes('TEXTO-PRIVADO-sup')
        && !fs.readFileSync(P.subs, 'utf8').includes('RESPUESTA-PRIVADA-sup') && !J(P.users).some((u) => u.id === 'sup'));
    ok('lo de los demás se conserva', mookHas('k1') && subsHas('k1') && J(P.mook).evidence.find((e) => e.id === evK1.id)?.review?.reviewerId === 'med');
    ok('acuses sin ids', !JSON.stringify([a, m, s]).includes('sup'));
    ok('el mediador ya no la ve', (await status(api, 'sup')) !== 200 && !(await readers(api)).includes('sup'));

    section('[2] restauración desde el respaldo, con el servidor en marcha');
    for (const f of [P.users, P.groups, P.mook, P.subs]) fs.copyFileSync(path.join(P.bak, path.basename(f)), f);
    ok('el respaldo la reintroduce en el padrón, MOOK y entregas', J(P.users).some((u) => u.id === 'sup' && u.accountStatus === 'active') && mookHas('sup') && subsHas('sup'));
    ok('…pero ningún mediador vuelve a ver su información (A2 revocada fuera del respaldo)', (await status(api, 'sup')) === 403
        && !(await readers(api)).includes('sup') && (await exportOf(api, 'sup')) === 403);
    const restrict = SUP.accountsToRestrictAfterRestore(J(P.users));
    ok('la conciliación identifica la cuenta que no puede volver', restrict.join() === 'sup', restrict.join());
    const dis = await req(api, 'POST', '/api/users/sup/disable', 'adm');
    const rm = await SUP.reapplyMookSuppressionsAfterRestore({ mookPath: P.mook });
    const rs = await SUP.reapplySubmissionSuppressionsAfterRestore({ submissionsPath: P.subs });
    ok('AT la desactiva y se vuelven a suprimir MOOK y entregas', dis.status === 200 && J(P.users).find((u) => u.id === 'sup').accountStatus === 'disabled'
        && rm.participants === 1 && rm.evidenceRemoved === 1 && rs.submissionsRemoved === 1 && !mookHas('sup') && !subsHas('sup'), JSON.stringify({ dis: dis.status, rm, rs }));
    ok('…y la lista queda vacía', SUP.accountsToRestrictAfterRestore(J(P.users)).length === 0);
    ok('repetir la conciliación no cambia nada', (await SUP.reapplyMookSuppressionsAfterRestore({ mookPath: P.mook })).participants === 0);
    ok('los demás siguen visibles para su mediador', (await status(api, 'k1')) === 200);

    section('[3] MOOK: conservación justificada y revisor suprimido');
    const d2 = Store.emptyMookStore();
    const e2 = Store.createExperience(d2, { slug: 'f', title: 'F' });
    const v2 = Store.createDraftVersion(d2, e2.id, { modules: [{ id: 'm', title: 'M', nodes: [{ id: 'p', type: 'PRODUCTION', title: 'p', config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 3, maxPalabras: 30 } }] }] }, () => true);
    Store.publishVersion(d2, v2.id);
    const mk = (u) => Store.submitEvidence(d2, { runId: Store.startRun(d2, { userId: u, experienceId: e2.id }).run.id, nodeId: 'p', userId: u, payload: { text: 'uno dos tres' } }).evidence;
    const hx = mk('h'); const other = mk('o');
    Store.addReviewFeedback(d2, other.id, { reviewerId: 'h', comment: 'x' });
    ok('conservar sin orden completa ⇒ INVALID_HOLD', codeOf(() => Store.suppressParticipant(structuredClone(d2), 'h', { hold: { evidenceIds: [hx.id] } })) === 'INVALID_HOLD');
    const held = Store.suppressParticipant(d2, 'h', { hold: { evidenceIds: [hx.id], ref: 'DIR-ORDEN-1', until: '2027-06-30' } });
    ok('con orden escrita: conserva solo lo listado, marcado con su orden y fin', held.evidenceHeld === 1 && d2.evidence.find((e) => e.id === hx.id)?.legalHold?.ref === 'DIR-ORDEN-1');
    ok('su id de revisor se sustituye por un seudónimo en lo ajeno', held.reviewerRefsPseudonymized === 1
        && d2.evidence.find((e) => e.id === other.id).history.every((h) => h.reviewerId !== 'h'));
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    try { api?.kill('SIGKILL'); } catch { /* noop */ }
    await sleep(400);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(`\nsuppression & restore HTTP (V8.1-CLOSE-08A G-05/G-08): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
