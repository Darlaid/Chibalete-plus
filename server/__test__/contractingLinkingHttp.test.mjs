/**
 * contractingLinkingHttp.test.mjs — CHP-V8.1-CLOSE-06B.
 *
 * Correspondencia compra · documentos · vinculación sobre server.js REAL, datos sintéticos:
 *  [1] documentos: sin declaración de Dirección ⇒ pendientes y sin activación; declaración inválida ⇒ pendiente
 *  [2] alta administrativa: lector/mediador sin decisión ⇒ invitada con enlace; con regularización ⇒ activa;
 *      administración de plataforma ⇒ activa; registro no verificable ⇒ invitada
 *  [3] edición: invitada → activa sin decisión ⇒ 409; con A1 ⇒ 200; reactivar una desactivada y editar
 *      una cuenta antigua ⇒ sin cambios
 *  [4] la invitada se activa por la vía existente, con sus decisiones; reintentos sin efecto
 *  [5] T de la compra (contrato B2C): validación pura y efecto en la activación (no se repide T,
 *      A1/A2 siguen siendo del titular o del representante)
 * El tramo HTTP de /api/b2c/provision corre en b2cProvisioning.integration (contenedor desechable).
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/contractingLinkingHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { freePort } from './helpers/freePort.mjs';
import { a2RegistryPath, approveTestDocuments, ADULT_ACTIVATION, MEDIATOR_ACTIVATION } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as R from '../privacy/a2Registry.mjs';
import { validateProvisionInput, idempotencyKeyFor } from '../b2c/b2cProvisioning.mjs';
import { ACCEPTANCE_DOCUMENTS as DOCS } from '../../utils/acceptanceDocuments.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const codeOf = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };

const ORG = 'org-alfa';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_contract_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), uploads: path.join(tmp, 'uploads') };
fs.mkdirSync(P.data, { recursive: true }); fs.mkdirSync(P.uploads, { recursive: true });
const REG = a2RegistryPath();
const APPROVED = approveTestDocuments();
const later = Date.now() + 3_600_000;
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'adm', email: 'adm@fixture.invalid', nombre_completo: 'Admin', roles: ['administrador'], accountStatus: 'active' },
    { id: 'old-1', email: 'old1@fixture.invalid', nombre_completo: 'Cuenta antigua', roles: ['lector'], accountStatus: 'active' },
    { id: 'off-1', email: 'off1@fixture.invalid', nombre_completo: 'Desactivada', roles: ['lector'], accountStatus: 'disabled' },
    { id: 'inv-1', email: 'inv1@fixture.invalid', nombre_completo: 'Invitada', roles: ['lector'], accountStatus: 'invited', inviteToken: `tok-inv-1-${'x'.repeat(24)}`, inviteExpiresAt: later },
    { id: 'buyer-1', email: 'buyer1@fixture.invalid', nombre_completo: 'Comprador', roles: ['lector'], accountStatus: 'invited', inviteToken: `tok-buyer-1-${'x'.repeat(24)}`, inviteExpiresAt: later },
], null, 2));
fs.writeFileSync(P.groups, JSON.stringify([{ id: 'g-a1', type: 'course', organizationId: ORG, school: 'Colegio Alfa', mediatorIds: [], memberIds: [], studentIds: [] }]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: ORG, name: 'Colegio Alfa' }]));
fs.writeFileSync(P.access, '[]'); fs.writeFileSync(P.content, '[]');

function spawnApi(port, i, extra = {}) {
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
            ...extra,
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
const call = async (c, method, url, body, as = 'adm') => {
    const r = await fetch(`${c.base}${url}`, { method, headers: { 'content-type': 'application/json', 'x-user-id': as, 'sec-fetch-site': 'same-origin' },
        body: body === undefined ? undefined : JSON.stringify(body) });
    let b = null; try { b = await r.json(); } catch { /* sin JSON */ }
    return { status: r.status, body: b };
};
const activate = (c, token, acceptance) => call(c, 'POST', '/api/accept-invite', { token, password: 'Clave-Sintetica-2026!', acceptance });
const verifiedA1 = (id) => R.appendDecisions([{ subjectId: id, kind: 'A1', status: 'granted', actDay: '2026-01-10', version: '004@1.0', medium: 'paper',
    capacity: 'legal_representative', verification: 'verified', requestRef: `AUT-SINT-${id}` }]);
const PW = 'Clave-Admin-Sintetica-77!';

const servers = [];
try {
    const [p0, p1, p2] = [await freePort(), await freePort(), await freePort()];
    const noDocs = spawnApi(p0, 0, { CHP_ACCEPTANCE_DOCUMENTS: '' });
    const badDocs = spawnApi(p1, 1, { CHP_ACCEPTANCE_DOCUMENTS: JSON.stringify({ '001': { version: '001@0.9', url: 'https://x.invalid/a' }, '002': { version: '002@1.0', url: 'http://x.invalid/b' } }) });
    const api = spawnApi(p2, 2, { CHP_ACCEPTANCE_DOCUMENTS: APPROVED });
    servers.push(noDocs, badDocs, api);
    for (const s of servers) await healthy(s);

    section('[1] documentos');
    const d0 = await call(noDocs, 'GET', '/api/acceptance/documents');
    ok('sin declaración de Dirección: 001, 002, 004 y 005 pendientes, sin enlaces', d0.status === 200 && d0.body.documents.length === 4
        && d0.body.documents.every((d) => d.approved === false && d.url === null), JSON.stringify(d0.body));
    const blocked = await activate(noDocs, `tok-inv-1-${'x'.repeat(24)}`, ADULT_ACTIVATION);
    ok('sin documentos aprobados la activación no se ofrece (503) y la cuenta sigue invitada', blocked.status === 503 && blocked.body?.code === 'DOCUMENTS_NOT_APPROVED'
        && userOf('inv-1').accountStatus === 'invited' && fs.readFileSync(REG, 'utf8') === '', JSON.stringify(blocked.body));
    const d1 = await call(badDocs, 'GET', '/api/acceptance/documents');
    ok('versión distinta o enlace no https ⇒ pendiente (no se presenta como aprobado)', d1.body.documents.every((d) => !d.approved));
    const d2 = await call(api, 'GET', '/api/acceptance/documents');
    ok('declarados por Dirección: aprobados con su enlace https y la versión exigida', d2.body.documents.every((d) => d.approved && d.url.startsWith('https://')
        && d.version === Object.values(DOCS).find((x) => x.id === d.id).version));

    section('[2] alta administrativa');
    const lec = await call(api, 'POST', '/api/users', { id: 'new-lec', email: 'newlec@fixture.invalid', nombre_completo: 'Nuevo Lector', password: PW, roles: ['lector'], colegio: 'Colegio Alfa', groupIds: ['g-a1'] });
    ok('lector sin decisión ⇒ creado como invitado con enlace de activación', lec.status === 200 && lec.body.accountStatus === 'invited' && lec.body.activationRequired === true
        && /^\/#\/activar\?token=/.test(lec.body.activationUrl ?? '') && userOf('new-lec').accountStatus === 'invited', JSON.stringify(lec.body));
    ok('…la respuesta no expone el hash ni el token fuera del enlace', !JSON.stringify(lec.body).includes('$2') && !('inviteToken' in lec.body));
    const med = await call(api, 'POST', '/api/users', { id: 'new-med', email: 'newmed@fixture.invalid', nombre_completo: 'Nueva Mediadora', password: PW, roles: ['mediador'], mediatorKind: 'teacher' });
    ok('mediador sin 005 ⇒ invitado', med.status === 200 && med.body.accountStatus === 'invited', JSON.stringify(med.body));
    const adm2 = await call(api, 'POST', '/api/users', { id: 'new-adm', email: 'newadm@fixture.invalid', nombre_completo: 'Admin Dos', password: PW, roles: ['administrador'] });
    ok('administración de plataforma ⇒ activa como antes', adm2.status === 200 && adm2.body.accountStatus === 'active' && !adm2.body.activationRequired);
    verifiedA1('reg-lec');
    const reg = await call(api, 'POST', '/api/users', { id: 'reg-lec', email: 'reglec@fixture.invalid', nombre_completo: 'Regularizado', password: PW, roles: ['lector'], colegio: 'Colegio Alfa', groupIds: ['g-a1'] });
    ok('regularización con A1 verificada en el registro ⇒ activa', reg.status === 200 && reg.body.accountStatus === 'active' && !reg.body.activationRequired, JSON.stringify(reg.body));
    ok('…la regularización no inventa A2', R.decisionGate().status('A2', 'reg-lec') === 'pending');
    const raw = fs.readFileSync(REG, 'utf8');
    fs.rmSync(REG);
    const down = await call(api, 'POST', '/api/users', { id: 'down-lec', email: 'downlec@fixture.invalid', nombre_completo: 'Sin Registro', password: PW, roles: ['lector'], colegio: 'Colegio Alfa', groupIds: ['g-a1'] });
    fs.writeFileSync(REG, raw);
    ok('registro no verificable ⇒ invitada (fallo cerrado, nunca activa)', down.status === 200 && down.body.accountStatus === 'invited');
    const dup = await call(api, 'POST', '/api/users', { email: 'newlec@fixture.invalid', nombre_completo: 'Otra vez', password: PW, roles: ['lector'], colegio: 'Colegio Alfa', groupIds: ['g-a1'] });
    ok('reintento con el mismo correo ⇒ 409, sin cuenta nueva', dup.status === 409 && users().filter((u) => u.email === 'newlec@fixture.invalid').length === 1);

    section('[3] edición administrativa');
    const put1 = await call(api, 'PUT', '/api/users/new-lec', { accountStatus: 'active', password: PW });
    ok('invitada → activa sin decisión ⇒ 409 DECISIONS_REQUIRED y sigue invitada', put1.status === 409 && put1.body?.code === 'DECISIONS_REQUIRED' && userOf('new-lec').accountStatus === 'invited', JSON.stringify(put1.body));
    verifiedA1('inv-1');
    const put2 = await call(api, 'PUT', '/api/users/inv-1', { accountStatus: 'active' });
    ok('con A1 verificada (regularización) ⇒ 200 y activa', put2.status === 200 && userOf('inv-1').accountStatus === 'active', JSON.stringify(put2.body));
    const put3 = await call(api, 'PUT', '/api/users/off-1', { accountStatus: 'active' });
    ok('reactivar una cuenta desactivada no cambia (compatibilidad)', put3.status === 200 && userOf('off-1').accountStatus === 'active', JSON.stringify(put3.body));
    const put4 = await call(api, 'PUT', '/api/users/old-1', { nombre_completo: 'Cuenta antigua editada' });
    ok('editar una cuenta antigua sin decisiones no cambia ni las inventa', put4.status === 200 && userOf('old-1').accountStatus === 'active' && R.decisionGate().status('A1', 'old-1') === 'pending');

    section('[4] activación por la vía existente');
    const token = new URLSearchParams(lec.body.activationUrl.split('?')[1]).get('token');
    const instAdult = { ...ADULT_ACTIVATION, A2: 'no' };
    const act = await activate(api, token, instAdult);
    ok('el lector invitado por Administración se activa con sus decisiones', act.status === 200 && userOf('new-lec').accountStatus === 'active', JSON.stringify(act.body));
    ok('…A1 efectiva por su decisión; A2 = No registrada', R.decisionGate().effective('A1', 'new-lec') && R.decisionGate().status('A2', 'new-lec') === 'denied');
    const before = fs.readFileSync(REG, 'utf8');
    ok('reintento de la activación ⇒ 404 y sin líneas nuevas', (await activate(api, token, instAdult)).status === 404 && fs.readFileSync(REG, 'utf8') === before);
    const medTok = new URLSearchParams(med.body.activationUrl.split('?')[1]).get('token');
    ok('la mediadora se activa con el 005', (await activate(api, medTok, MEDIATOR_ACTIVATION)).status === 200 && R.decisionGate().effective('C005', 'new-med'));

    section('[5] T de la compra');
    const now = Date.now();
    const base = { orderId: 77, productId: 9, plan: 'digital', source: 'test', email: 'buyer1@fixture.invalid', activationAt: now - 1000, idempotencyKey: idempotencyKeyFor('test', 77) };
    ok('contrato: sin termsAcceptance ⇒ como antes (null)', validateProvisionInput(base, now).termsAcceptance === null);
    ok('contrato: versión vigente y fecha ⇒ aceptado', JSON.stringify(validateProvisionInput({ ...base, termsAcceptance: { version: DOCS.terms.version, acceptedAt: now - 5000 } }, now).termsAcceptance)
        === JSON.stringify({ version: DOCS.terms.version, acceptedAt: now - 5000 }));
    ok('contrato: otra versión ⇒ 400 invalid_terms_acceptance', codeOf(() => validateProvisionInput({ ...base, termsAcceptance: { version: '002@0.9', acceptedAt: now } }, now)) === 'invalid_terms_acceptance');
    ok('contrato: fecha futura ⇒ 400', codeOf(() => validateProvisionInput({ ...base, termsAcceptance: { version: DOCS.terms.version, acceptedAt: now + 60_000 } }, now)) === 'invalid_terms_acceptance');
    R.appendDecisions([{ subjectId: 'buyer-1', kind: 'T', status: 'granted', actDay: R.dayOf(now), version: DOCS.terms.version, medium: 'checkout',
        capacity: 'titular', verification: 'verified', requestRef: 'WOO:test:order:77' }]);
    const noTerms = { ...ADULT_ACTIVATION, terms: undefined, termsVersion: undefined };
    const ab = await activate(api, `tok-buyer-1-${'x'.repeat(24)}`, { ...noTerms, A1: undefined });
    ok('con T de la compra no se repide T, pero A1 sigue siendo obligatoria', ab.status === 422 && ab.body.required.includes('A1') && !ab.body.required.includes('T'), JSON.stringify(ab.body));
    const ab2 = await activate(api, `tok-buyer-1-${'x'.repeat(24)}`, noTerms);
    ok('activación con A1 y la T de la compra ⇒ 200', ab2.status === 200 && userOf('buyer-1').accountStatus === 'active', JSON.stringify(ab2.body));
    const tLines = fs.readFileSync(REG, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((e) => e.k === 'T' && e.w === 'checkout');
    ok('…la T queda una sola vez, con el pedido como referencia', tLines.length === 1 && tLines[0].r === 'WOO:test:order:77');
    ok('…la compra no concede A1 ni A2: A1 viene de la activación, A2 pendiente', R.decisionGate().state('A1', 'buyer-1')?.medium === 'in_app' && R.decisionGate().status('A2', 'buyer-1') === 'pending');
} catch (e) {
    console.error('  ✗ excepción inesperada', e);
    fail++;
} finally {
    for (const s of servers) { try { s.kill('SIGKILL'); } catch { /* noop */ } }
    await sleep(400);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}

console.log(`\ncontracting & linking HTTP (V8.1-CLOSE-06B): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
