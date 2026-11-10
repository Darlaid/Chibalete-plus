/**
 * optionalProcessingHttp.test.mjs — CHP-V8.1-PROD-02B (004 A3 / A4 / A5).
 *
 * A3 (Leo / IA) y A5 (transcripción de voz) son decisiones independientes del 004, en el MISMO
 * registro de decisiones. Con server.js REAL (dos réplicas) y datos sintéticos:
 *  [1] activación: A3/A5 opcionales (sí/no/sin respuesta), nunca presumidas por A1/A2; valores
 *      inválidos rechazados; mediadores y administración no las deciden
 *  [2] Leo (ask, chat, recap, memoria): A3 efectiva ⇒ pasa; negada, pendiente, revocada o sin
 *      verificar ⇒ 403 A3_REQUIRED sin guardar nada; mediador y administración sin cambios
 *  [3] /api/auth/me expone el estado decidido en el servidor (A3 → leo, A5 → voiceTranscription)
 *  [4] revocación efectiva en las dos réplicas sin reiniciar; registro no verificable ⇒ 503 y false
 *  [5] sin efecto en la lectura ordinaria, el modo sin conexión (A4 comprendido en A1) ni las
 *      funciones del mediador
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/optionalProcessingHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { freePort } from './helpers/freePort.mjs';
import { a2RegistryPath, grantA1, grantA2, grantC005, grantOptional } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_optproc_'));
const P = { users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), data: path.join(tmp, 'data'), uploads: path.join(tmp, 'up') };
for (const d of [P.data, P.uploads]) fs.mkdirSync(d, { recursive: true });
const C1 = 'obra-1';
const READERS = ['r-yes', 'r-no', 'r-pend', 'r-rev', 'r-unv', 'r-a5'];
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'adm', roles: ['administrador'], accountStatus: 'active' },
    { id: 'med', roles: ['mediador'], organizationId: 'org-a', colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher' },
    ...READERS.map((id) => ({ id, roles: ['lector'], organizationId: 'org-a', colegio: 'Colegio Alfa', accountStatus: 'active', groupIds: ['g-a'], email: `${id}@fixture.invalid` })),
]));
fs.writeFileSync(P.groups, JSON.stringify([{ id: 'g-a', type: 'course', organizationId: 'org-a', school: 'Colegio Alfa', mediatorIds: ['med'], memberIds: READERS, studentIds: READERS }]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }]));
fs.writeFileSync(P.access, '[]');
fs.writeFileSync(P.content, JSON.stringify([{ id: C1, titulo: 'Obra', tipo: 'libro' }]));

a2RegistryPath();
const R = await import('../privacy/a2Registry.mjs');
const A = await import('../privacy/acceptance.mjs');
const { ACCEPTANCE_DOCUMENTS: DOCS } = await import('../../utils/acceptanceDocuments.mjs');
grantA1(READERS); grantA2(READERS); grantC005(['med']);
grantOptional('A3', ['r-yes', 'r-rev']);
grantOptional('A3', ['r-no'], { status: 'denied' });
grantOptional('A3', ['r-unv'], { verification: 'unverified' });              // representante en la app, sin verificar
grantOptional('A5', ['r-a5']);
R.appendDecisions([{ subjectId: 'r-rev', kind: 'A3', status: 'revoked', actDay: R.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'AUT-SINT-A3-REV' }]);

section('[1] activación: A3/A5 opcionales e independientes');
{
    const today = R.dayOf(Date.now());
    const base = { terms: true, termsVersion: DOCS.terms.version, dataNoticeVersion: DOCS.dataNotice.version, actingAs: 'titular', adultDeclared: true, A1: 'yes' };
    const reader = { id: 'nuevo', roles: ['lector'] };
    const kinds = (p) => (p.decisions ?? []).map((d) => `${d.kind}:${d.status}`).join(',');
    const none = A.planActivationDecisions(reader, base, { today, ref: 'REF-1' });
    ok('sin responder A3/A5 ⇒ activación válida y quedan pendientes (no se registran ni se presumen)', none.ok && !/A3|A5/.test(kinds(none)), kinds(none));
    const yes = A.planActivationDecisions(reader, { ...base, A3: 'yes', A5: 'no' }, { today, ref: 'REF-2' });
    ok('A3 sí y A5 no ⇒ A3:granted y A5:denied', yes.ok && kinds(yes).includes('A3:granted') && kinds(yes).includes('A5:denied'), kinds(yes));
    ok('…con la misma calidad que A1 (titular adulto ⇒ self_authenticated)', yes.decisions.find((d) => d.kind === 'A3').verification === 'self_authenticated');
    const rep = A.planActivationDecisions(reader, { ...base, actingAs: 'legal_representative', A0: 'yes', adultDeclared: undefined, A3: 'yes' }, { today, ref: 'REF-3' });
    ok('representante en la app ⇒ A3 sin verificar (no surte efecto hasta VER)', rep.ok && rep.decisions.find((d) => d.kind === 'A3').verification === 'unverified', JSON.stringify(rep));
    ok('valor inválido ⇒ DECISIONS_REQUIRED [A3]', A.planActivationDecisions(reader, { ...base, A3: 'maybe' }, { today, ref: 'R' }).required?.join() === 'A3');
    const med = A.planActivationDecisions({ id: 'm2', roles: ['mediador'] }, { terms: true, termsVersion: DOCS.terms.version, adultDeclared: true, mediatorCommitment: true, mediatorVersion: DOCS.mediator.version, A3: 'yes' }, { today, ref: 'R' });
    ok('mediador: A3/A5 no se registran (no es lector)', med.ok && !/A3|A5/.test(kinds(med)), kinds(med));
    ok('el registro admite A3 y A5 (mismo registro, sin otro sistema)', R.DECISION_KINDS.includes('A3') && R.DECISION_KINDS.includes('A5') && !R.DECISION_KINDS.includes('A4'));
}

const spawnApi = async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data,
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
        USER_AUDIT_DB: path.join(tmp, 'audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), EVENTS_SQLITE_PATH: path.join(tmp, 'events.db'),
        ARCHIVE_SQLITE_PATH: path.join(tmp, 'archive.db'), INSIGHTS_SQLITE_PATH: path.join(tmp, 'insights.db'), OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'off.db'),
        IDENTITY_DB: path.join(tmp, 'identity.db'), SESSIONS_DB: path.join(tmp, 'sessions.db'), LEO_EVIDENCE_DB: path.join(P.data, 'leo_evidence_db.json'),
        ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off', OPENAI_API_KEY: '', GEMINI_API_KEY: '', AI_MODE: 'mock', TTS_MODE: 'mock',
    } });
    let logs = ''; child.stdout.on('data', (d) => { logs += d; }); child.stderr.on('data', (d) => { logs += d; });
    child.base = `http://127.0.0.1:${port}`; child.logs = () => logs;
    for (let i = 0; i < 300; i++) { if (child.exitCode !== null) throw new Error(logs.slice(-1500)); try { if ((await fetch(`${child.base}/api/health`)).ok) return child; } catch { /* */ } await sleep(300); }
    throw new Error('nunca healthy');
};
const stop = async (c) => { if (c && c.exitCode === null && c.signalCode === null) { const e = new Promise((r) => c.once('exit', r)); c.kill('SIGKILL'); await e; } };
const call = async (c, who, method, p, body) => {
    const r = await fetch(`${c.base}${p}`, { method, headers: { 'x-user-id': who, 'sec-fetch-site': 'same-origin', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const raw = await r.text(); let b = null; try { b = JSON.parse(raw); } catch { /* */ } return { s: r.status, b, raw };
};
const LEO = (u) => [
    ['POST', '/api/leo/ask', { contentId: C1, chunkIndex: 0, interactionType: 'question', payload: '¿Qué pasa?' }],
    ['POST', '/api/leo/chat', { contentId: C1, message: 'hola' }],
    ['POST', '/api/leo/recap', { contentId: C1, text: 'texto' }],
    ['GET', `/api/leo/memory/${u}/${C1}`],
    ['POST', `/api/leo/memory/${u}/${C1}`, { recentAnchors: ['x'] }],
];
const leoBlocked = async (c, u) => (await Promise.all(LEO(u).map(([m, p, b]) => call(c, u, m, p, b)))).map((r) => r.s === 403 && r.b?.code === 'A3_REQUIRED');
const leoFiles = () => ['leo_memory_db.json', 'leo_interactions_db.json', 'leo_evidence_db.json', 'leo_profile_db.json']
    .map((f) => path.join(P.data, f)).map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '')).join('|');

let a1, a2;
try {
    a1 = await spawnApi(); a2 = await spawnApi();

    section('[2] Leo exige A3 efectiva del lector');
    ok('A3 efectiva ⇒ ninguna de las cinco rutas de Leo bloqueada por A3', (await leoBlocked(a1, 'r-yes')).every((x) => !x));
    for (const [u, label] of [['r-no', 'negada'], ['r-pend', 'pendiente'], ['r-rev', 'revocada'], ['r-unv', 'sin verificar']]) {
        const before = leoFiles();
        ok(`A3 ${label} ⇒ 403 A3_REQUIRED en las cinco`, (await leoBlocked(a1, u)).every(Boolean));
        ok(`…sin guardar nada (memoria, interacciones, evidencia, perfil)`, leoFiles() === before);
    }
    ok('mediador y administración: no son lectores, sin bloqueo por A3', (await leoBlocked(a1, 'med')).every((x) => !x) && (await leoBlocked(a1, 'adm')).every((x) => !x));
    ok('la respuesta no revela datos de la decisión', !(await call(a1, 'r-no', 'POST', '/api/leo/ask', LEO('r-no')[0][2])).raw.match(/AUT-SINT|granted|denied/));

    section('[3] /api/auth/me: estado decidido en el servidor');
    const me = async (u) => (await call(a1, u, 'GET', '/api/auth/me')).b?.optionalProcessing;
    ok('A3 sí, A5 pendiente ⇒ leo true, voiceTranscription false', JSON.stringify(await me('r-yes')) === JSON.stringify({ leo: true, voiceTranscription: false }));
    ok('A5 sí ⇒ voiceTranscription true; A3 pendiente ⇒ leo false', JSON.stringify(await me('r-a5')) === JSON.stringify({ leo: false, voiceTranscription: true }));
    ok('A3 sin verificar ⇒ leo false', (await me('r-unv'))?.leo === false);
    ok('mediador ⇒ no aplica (true/true)', JSON.stringify(await me('med')) === JSON.stringify({ leo: true, voiceTranscription: true }));

    section('[4] revocación entre réplicas y registro no verificable');
    ok('antes: r-yes no bloqueado en la réplica 2', (await leoBlocked(a2, 'r-yes')).every((x) => !x));
    R.appendDecisions([{ subjectId: 'r-yes', kind: 'A3', status: 'revoked', actDay: R.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'AUT-SINT-A3-REV2' }]);
    ok('A3 revocada ⇒ bloqueado en la réplica 2 de inmediato', (await leoBlocked(a2, 'r-yes')).every(Boolean));
    ok('…y en la réplica 1', (await leoBlocked(a1, 'r-yes')).every(Boolean));
    const reg = process.env.CHP_A2_REGISTRY, saved = fs.readFileSync(reg, 'utf8');
    if (!saved.includes('"a":"granted"')) throw new Error('formato del registro inesperado');
    fs.writeFileSync(reg, saved.replace('"a":"granted"', '"a":"denied"'));
    const broken = await call(a1, 'r-a5', 'POST', '/api/leo/ask', LEO('r-a5')[0][2]);
    ok('registro alterado ⇒ Leo 503 (nunca 200)', broken.s === 503 && broken.b?.error === 'leo_authorization_unavailable', broken.raw);
    ok('…y /api/auth/me ⇒ leo y voiceTranscription false', JSON.stringify(await me('r-a5')) === JSON.stringify({ leo: false, voiceTranscription: false }));
    fs.writeFileSync(reg, saved);

    section('[5] sin efecto en lectura, offline ni mediación');
    const accNo = await call(a1, 'r-no', 'GET', `/api/content/${C1}/access`), accYes = await call(a1, 'r-yes', 'GET', `/api/content/${C1}/access`);
    ok('lectura ordinaria: el acceso al contenido es el mismo con y sin A3', accNo.s === accYes.s && JSON.stringify(accNo.b?.allowed) === JSON.stringify(accYes.b?.allowed), `${accNo.raw} | ${accYes.raw}`);
    ok('sincronizar progreso sin A3 ⇒ no bloqueado por A3', (await call(a1, 'r-no', 'POST', `/api/progress/r-no/${C1}/sync`, { percentage: 10, sentenceIndex: 1, mode: 'text' })).b?.code !== 'A3_REQUIRED');
    ok('modo sin conexión (A4 comprendido en A1): consultar la asignación offline ⇒ 200', (await call(a1, 'r-no', 'GET', '/api/offline/assignment')).s === 200);
    ok('mediador con A2/C005 consulta el estado individual de un lector sin A3 ⇒ 200', (await call(a1, 'med', 'GET', '/api/students/r-no/status')).s === 200);
    ok('logs sin correos ni contenido de las preguntas', ![a1, a2].some((c) => c.logs().includes('@fixture.invalid') || c.logs().includes('¿Qué pasa?')));
} catch (e) {
    console.error('  ✗ excepción inesperada', e); fail++;
} finally {
    for (const c of [a1, a2]) await stop(c).catch(() => {});
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}
console.log(`\noptional processing A3/A5 HTTP (V8.1-PROD-02B): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
