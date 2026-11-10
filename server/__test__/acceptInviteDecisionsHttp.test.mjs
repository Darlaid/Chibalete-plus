/**
 * acceptInviteDecisionsHttp.test.mjs — CHP-V8.1-CLOSE-05 (DIR-V81-01).
 *
 * POST /api/accept-invite (punto de vinculación) sobre server.js REAL, dos
 * réplicas con el mismo registro de decisiones, datos sintéticos:
 *  [1] sin decisiones, sin términos o con A1 = No ⇒ 422 y la cuenta sigue invitada
 *  [2] titular adulto B2C ⇒ 200, T y A1 efectivas; repetir ⇒ 409 sin nuevas líneas
 *  [3] lector institucional: A2 = No ⇒ su mediador no ve su status (en ambas réplicas)
 *  [4] representante de un menor: A2 = Sí sin verificar ⇒ cerrado; verificada por GVA ⇒ abierto
 *  [5] mediador: exige C005
 *  [6] cuenta existente sin decisiones: nada se infiere; sus funciones propias siguen
 *  [7] registro no verificable ⇒ 503 y no se activa; la política de contraseña va antes
 *  [8] lectura, XP apagado y MOOK sin cambios para la cuenta activada
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/acceptInviteDecisionsHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { freePort } from './helpers/freePort.mjs';
import { a2RegistryPath, approveTestDocuments, grantC005 } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../privacy/a2Registry.mjs';
import { ACCEPTANCE_DOCUMENTS as DOCS } from '../../utils/acceptanceDocuments.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function realFingerprint() {
    const out = {};
    const walk = (d) => {
        let es; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
        for (const e of es) {
            const p = path.join(d, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.isFile()) out[path.relative(REPO, p)] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
        }
    };
    walk(path.join(REPO, 'data')); walk(path.join(REPO, 'data-critical'));
    return out;
}
const realBefore = realFingerprint();

const ORG = 'org-alfa';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_accept_http_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), uploads: path.join(tmp, 'uploads') };
fs.mkdirSync(P.data, { recursive: true }); fs.mkdirSync(P.uploads, { recursive: true });
const REG = a2RegistryPath();
approveTestDocuments();
const later = Date.now() + 3_600_000;
const invited = (id, extra = {}) => ({ id, email: `${id}@fixture.invalid`, nombre_completo: `Sint ${id}`, roles: ['lector'], accountStatus: 'invited',
    inviteToken: `tok-${id}-${'x'.repeat(24)}`, inviteExpiresAt: later, ...extra });
const USERS = [
    { id: 'med-a', roles: ['mediador'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher' },
    invited('b2c-1'),
    invited('inst-1', { organizationId: ORG, colegio: 'Colegio Alfa' }),
    invited('menor-1', { organizationId: ORG, colegio: 'Colegio Alfa' }),
    invited('med-new', { roles: ['mediador'], organizationId: ORG, colegio: 'Colegio Alfa', mediatorKind: 'teacher' }),
    invited('pol-1'),
    { id: 'antiguo-1', roles: ['lector'], organizationId: ORG, colegio: 'Colegio Alfa', accountStatus: 'active' },
];
const GROUPS = [{ id: 'g-a1', type: 'course', organizationId: ORG, school: 'Colegio Alfa', mediatorIds: ['med-a'],
    memberIds: ['inst-1', 'menor-1', 'antiguo-1'], studentIds: ['inst-1', 'menor-1', 'antiguo-1'] }];
fs.writeFileSync(P.users, JSON.stringify(USERS, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS, null, 2));
fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG, name: 'Colegio Alfa' }]));
fs.writeFileSync(P.access, JSON.stringify([{ id: 'r-b2c', scope: 'user', scopeId: 'b2c-1', titleIds: ['c-1'], collectionIds: [], expiresAt: null }]));
fs.writeFileSync(P.content, JSON.stringify([{ id: 'c-1', titulo: 'Uno', autor: 'A', tipo: 'libro', status: 'disponible' }]));

function spawnApi(port, i) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), CHP_A2_REGISTRY: REG,
            PROGRESS_SQLITE_PATH: path.join(P.data, `progress-${i}.db`), EVENTS_SQLITE_PATH: path.join(P.data, `events-${i}.db`),
            ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`), INSIGHTS_SQLITE_PATH: path.join(P.data, `insights-${i}.db`),
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`),
            SESSIONS_DB: path.join(P.data, `sessions-${i}.db`), LEO_EVIDENCE_DB: path.join(P.data, 'leo_evidence_db.json'),
            ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off', OPENAI_API_KEY: '', GEMINI_API_KEY: '',
            GAMIFICATION_ENABLED: '', XP_EARNING_ENABLED: '',
        },
    });
    let logs = '';
    child.stdout.on('data', (d) => { logs += d; });
    child.stderr.on('data', (d) => { logs += d; });
    child.logs = () => logs;
    child.base = `http://127.0.0.1:${port}`;
    return child;
}
async function healthy(c) {
    for (let i = 0; i < 200; i++) {
        if (c.exitCode !== null) throw new Error(`server rc=${c.exitCode}\n${c.logs().slice(-1500)}`);
        try { if ((await fetch(`${c.base}/api/health`)).ok) return; } catch { /* arrancando */ }
        await sleep(300);
    }
    throw new Error('nunca healthy');
}
const users = () => JSON.parse(fs.readFileSync(P.users, 'utf8'));
const userOf = (id) => users().find((u) => u.id === id);
const tokenOf = (id) => `tok-${id}-${'x'.repeat(24)}`;
const PW = 'Clave-Sintetica-2026!';
const activate = async (c, id, acceptance, password = PW) => {
    const r = await fetch(`${c.base}/api/accept-invite`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: tokenOf(id), password, ...(acceptance === undefined ? {} : { acceptance }) }) });
    let body = null; try { body = await r.json(); } catch { /* sin JSON */ }
    return { status: r.status, body };
};
const status = async (c, subject, as) => (await fetch(`${c.base}/api/students/${subject}/status`, { headers: { 'x-user-id': as } })).status;
const adult = { terms: true, termsVersion: DOCS.terms.version, dataNoticeVersion: DOCS.dataNotice.version, actingAs: 'titular', adultDeclared: true, A1: 'yes' };
const regRaw = () => fs.readFileSync(REG, 'utf8');
const gate = () => R.decisionGate();

const servers = [];
try {
    const [p1, p2] = [await freePort(), await freePort()];
    const r1 = spawnApi(p1, 1), r2 = spawnApi(p2, 2);
    servers.push(r1, r2);
    await healthy(r1); await healthy(r2);

    section('[1] sin decisiones no hay activación');
    const none = await activate(r1, 'b2c-1');
    ok('sin decisiones ⇒ 422 DECISIONS_REQUIRED con lo que falta', none.status === 422 && none.body?.code === 'DECISIONS_REQUIRED'
        && ['T', 'actingAs', 'A1'].every((k) => none.body.required.includes(k)), JSON.stringify(none.body));
    const noTerms = await activate(r1, 'b2c-1', { ...adult, terms: false });
    ok('sin aceptar términos ⇒ 422 con T', noTerms.status === 422 && noTerms.body.required.includes('T'));
    const noA1 = await activate(r1, 'b2c-1', { ...adult, A1: 'no' });
    ok('A1 = No ⇒ 422 A1_DENIED', noA1.status === 422 && noA1.body?.code === 'A1_DENIED');
    ok('…la cuenta sigue invitada, con su enlace, y no se escribió nada', userOf('b2c-1').accountStatus === 'invited' && userOf('b2c-1').inviteToken === tokenOf('b2c-1') && regRaw() === '');

    section('[2] titular adulto (B2C)');
    const okB2c = await activate(r1, 'b2c-1', adult);
    ok('decisiones completas ⇒ 200 y cuenta activa', okB2c.status === 200 && userOf('b2c-1').accountStatus === 'active', JSON.stringify(okB2c.body));
    ok('T y A1 efectivas; A2 no aplica (pendiente)', gate().effective('T', 'b2c-1') && gate().effective('A1', 'b2c-1') && gate().status('A2', 'b2c-1') === 'pending');
    const lines = regRaw().trim().split('\n').map((l) => JSON.parse(l));
    ok('evidencia: versión, fecha, medio, calidad, verificación y referencia', lines.length === 2 && lines.every((e) => e.w === 'in_app' && e.q === 'titular'
        && e.x === 'self_authenticated' && /^ACT-/.test(e.r) && e.e === e.d) && lines[0].v === '002@1.0' && lines[1].v === '004@1.0', JSON.stringify(lines[0]));
    ok('el registro no contiene el id ni el correo', !regRaw().includes('b2c-1') && !regRaw().includes('@fixture'));
    ok('el log del servidor enlaza la referencia sin nombres', new RegExp(`\\[ACCEPTANCE\\] user=b2c-1 ref=${lines[0].r} profile=titular kinds=T:granted,A1:granted`).test(r1.logs()) && !/Sint b2c-1/.test(r1.logs()));
    const before = regRaw();
    const again = await activate(r2, 'b2c-1', adult);
    ok('repetir en la otra réplica ⇒ 409 y ninguna línea nueva', again.status === 404 || again.status === 409, String(again.status));
    ok('…registro idéntico', regRaw() === before);

    section('[3] lector institucional con A2 = No');
    grantC005(['med-a']); // V8.1-CLOSE-07B (G-07): su mediador, con el 005 vigente
    ok('institucional sin A2 ⇒ 422 con A2', (await activate(r1, 'inst-1', adult)).body?.required?.includes('A2'));
    const inst = await activate(r1, 'inst-1', { ...adult, A2: 'no' });
    ok('A2 = No ⇒ 200 (A2 es independiente de la activación)', inst.status === 200);
    ok('su mediador no ve su status en ninguna réplica (403)', (await status(r1, 'inst-1', 'med-a')) === 403 && (await status(r2, 'inst-1', 'med-a')) === 403);
    ok('…pero él sí ve el suyo', (await status(r2, 'inst-1', 'inst-1')) === 200);

    section('[4] representante de un menor');
    const rep = { ...adult, actingAs: 'legal_representative', adultDeclared: undefined, A0: 'yes', A2: 'yes' };
    const menor = await activate(r2, 'menor-1', rep);
    ok('representante con A0, A1 y A2 ⇒ 200', menor.status === 200, JSON.stringify(menor.body));
    ok('lo declarado queda sin verificar: A2 cerrada para el mediador', gate().status('A2', 'menor-1') === 'granted_unverified' && (await status(r1, 'menor-1', 'med-a')) === 403);
    R.appendDecisions([{ subjectId: 'menor-1', kind: 'A2', status: 'granted', actDay: R.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record',
        capacity: 'legal_representative', verification: 'verified', requestRef: 'AUT-SINT-0001' }]);
    ok('verificada por GVA/VER ⇒ abierta en las dos réplicas sin reiniciar', (await status(r1, 'menor-1', 'med-a')) === 200 && (await status(r2, 'menor-1', 'med-a')) === 200);
    R.appendDecisions([{ subjectId: 'menor-1', kind: 'A2', status: 'revoked', actDay: R.dayOf(Date.now()), version: '004@1.0', medium: 'verifiable_message',
        capacity: 'legal_representative', verification: 'verified', requestRef: 'SOL-SINT-0001' }]);
    ok('revocada ⇒ cerrada de inmediato', (await status(r2, 'menor-1', 'med-a')) === 403);

    section('[5] mediador');
    const m1 = await activate(r1, 'med-new', { terms: true, termsVersion: DOCS.terms.version, adultDeclared: true });
    ok('mediador sin 005 ⇒ 422 con C005', m1.status === 422 && m1.body.required.includes('C005'), JSON.stringify(m1.body));
    const m2 = await activate(r1, 'med-new', { terms: true, termsVersion: DOCS.terms.version, adultDeclared: true, mediatorCommitment: true, mediatorVersion: DOCS.mediator.version });
    ok('con el compromiso 005 ⇒ 200; C005 efectiva', m2.status === 200 && gate().effective('C005', 'med-new'));

    section('[6] cuenta existente sin decisiones');
    ok('nada se infiere: A1 y A2 pendientes', gate().status('A1', 'antiguo-1') === 'pending' && gate().status('A2', 'antiguo-1') === 'pending');
    ok('sin A2 su mediador no ve su detalle', (await status(r1, 'antiguo-1', 'med-a')) === 403);
    ok('sus funciones propias siguen (status propio 200)', (await status(r1, 'antiguo-1', 'antiguo-1')) === 200);

    section('[7] fallo seguro y precedencia');
    const pol = await activate(r1, 'pol-1', undefined, 'chibalete123');
    ok('contraseña predeterminada ⇒ 400 default_password antes de decidir', pol.status === 400 && pol.body?.code === 'default_password');
    const raw = regRaw();
    fs.rmSync(REG);
    const down = await activate(r2, 'pol-1', adult);
    ok('registro no disponible ⇒ 503 y la cuenta no se activa', down.status === 503 && down.body?.code === 'ACCEPTANCE_REGISTRY_UNAVAILABLE' && userOf('pol-1').accountStatus === 'invited');
    fs.writeFileSync(REG, raw);
    ok('registro de vuelta ⇒ se activa', (await activate(r2, 'pol-1', adult)).status === 200);

    section('[8] lectura, XP apagado y MOOK');
    const access = await fetch(`${r1.base}/api/content/c-1/access?userId=b2c-1`, { headers: { 'x-user-id': 'b2c-1' } });
    const ab = await access.json().catch(() => null);
    ok('la cuenta activada lee su obra', access.status === 200 && ab?.allowed === true, JSON.stringify(ab));
    ok('XP apagado: «Mi progreso» no existe', [404, 403].includes((await fetch(`${r1.base}/api/me/progress`, { headers: { 'x-user-id': 'b2c-1' } })).status));
    ok('MOOK: la cola de revisión del administrador responde', (await fetch(`${r1.base}/api/experiences/review/queue`, { headers: { 'x-user-id': 'adm' } })).status !== 500);
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    for (const s of servers) { try { s.kill('SIGKILL'); } catch { /* noop */ } }
    await sleep(400);
    const diff = Object.entries(realFingerprint()).filter(([k, v]) => realBefore[k] !== v).map(([k]) => k);
    ok('stores reales intactos (data/, data-critical/)', diff.length === 0, diff.join());
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(`\naccept-invite decisions HTTP (V8.1-CLOSE-05): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
