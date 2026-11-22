/**
 * institutionSurfacesScopeHttp.test.mjs — CHP V9 F5-C3.
 *
 * Listados y superficies institucionales dentro del ámbito de quien consulta. Antes: cualquier mediador leía las
 * métricas GLOBALES de la plataforma; cualquier sesión (también un lector o una cuenta B2C) recibía el directorio de
 * instituciones; el mediador recibía el correo de todos los lectores de su institución, y nómina, candidatos y
 * asignaciones traían correos, grupos ajenos y reglas de compra.
 *
 *   GET /api/metrics/backbone|funnels|insights|insights/states|insights/notifications   → solo administración
 *   GET /api/metrics/schools            GET /api/groups/:g/members|candidates|diagnosis
 *   GET /api/users                      GET /api/access/by-user/:id
 *
 * Dos réplicas de server.js REAL sobre los MISMOS almacenes sintéticos, dos instituciones, SESSION_AUTH_MODE=off.
 *   [1] métricas globales   [3] usuarios              [5] diagnóstico     [7] revocación de relaciones
 *   [2] instituciones       [4] nómina y candidatos   [6] asignaciones    [8] rechazos y usos legítimos
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/institutionSurfacesScopeHttp.test.mjs
 */
import './helpers/testMode.mjs';
import { a2RegistryPath, grantA2, grantC005 } from './helpers/testA2.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { freePorts } from './helpers/freePort.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_is_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json') };
fs.mkdirSync(P.data, { recursive: true });
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const med = (id, org) => ({ id, email: `${id}@fixture.invalid`, nombre_completo: `Mediador ${id}`, roles: ['mediador'], mediatorKind: 'teacher', accountStatus: 'active', lastLoginAt: '2026-01-01T00:00:00.000Z', ...org });
const reader = (id, org = {}, extra = {}) => ({ id, email: `${id}@fixture.invalid`, nombre_completo: `Lector ${id}`, roles: ['lector'], accountStatus: 'active', lastLoginAt: '2026-01-01T00:00:00.000Z', ...org, ...extra });
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'adm', email: 'adm@fixture.invalid', roles: ['administrador'], accountStatus: 'active' },
    med('med-a', A), med('med-a2', A), med('med-noc', A), med('med-libre', A), med('med-b', B),
    reader('ra-yes', A), reader('ra-yes2', A), reader('ra-no', A), reader('ra-otro', A), reader('rb-yes', B),
    reader('b2c', {}, { b2c: true, createdVia: 'b2c-provision' }),
    // V9 F5-C3T: cuentas desactivadas que conservan rol y, el mediador, su asignación al grupo.
    { id: 'adm-off', email: 'adm-off@fixture.invalid', roles: ['administrador'], accountStatus: 'disabled' }, { ...med('med-off', A), accountStatus: 'disabled' },
]));
const G_A = ['ra-yes', 'ra-yes2', 'ra-no'];
const GROUPS = [
    { id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a', 'med-noc', 'med-off'], memberIds: G_A, studentIds: G_A },
    { id: 'g-a2', name: 'Quinto B', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a2'], memberIds: ['ra-otro'], studentIds: ['ra-otro'] },
    { id: 'g-club', name: 'Club Poe', type: 'club', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a2'], memberIds: ['ra-yes', 'ra-otro'], studentIds: ['ra-yes', 'ra-otro'] },
    { id: 'g-b', name: 'Sexto', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: ['rb-yes'], studentIds: ['rb-yes'] },
];
fs.writeFileSync(P.groups, JSON.stringify(GROUPS));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
fs.writeFileSync(P.content, '[]');
// Asignaciones: una del grupo, una individual puesta por la administración y una COMPRA (regla B2C con su pedido).
fs.writeFileSync(P.access, JSON.stringify([
    { id: 'access-grupo', scope: 'group', scopeId: 'g-a', titleIds: ['t-grupo'], collectionIds: [], expiresAt: null },
    { id: 'access-individual', scope: 'user', scopeId: 'ra-yes', titleIds: ['t-individual'], collectionIds: [], expiresAt: null },
    { id: 'b2c-woo-PEDIDO-7781', scope: 'user', scopeId: 'ra-yes', titleIds: ['t-comprado'], collectionIds: [], expiresAt: null, b2c: { source: 'woo', orderId: 'PEDIDO-7781' } },
    { id: 'b2c-woo-PEDIDO-9902', scope: 'user', scopeId: 'b2c', titleIds: ['t-comprado-b2c'], collectionIds: [], expiresAt: null, b2c: { source: 'woo', orderId: 'PEDIDO-9902' } },
]));

const REG = a2RegistryPath();
grantA2(['ra-yes', 'ra-yes2', 'ra-otro', 'rb-yes']); grantA2(['ra-no'], 'denied');
grantC005(['med-a', 'med-a2', 'med-b']);            // med-noc media g-a pero no tiene compromiso 005

const ports = await freePorts(2);
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off',
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), LEO_EVIDENCE_DB: path.join(tmp, 'leo_evidence.json'),
        EVENTS_SQLITE_PATH: path.join(P.data, `events-${i}.db`), INSIGHTS_SQLITE_PATH: path.join(P.data, `insights-${i}.db`), ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`), SESSIONS_DB: path.join(P.data, `sessions-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const ready = async (s) => { for (let i = 0; i < 400; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch { /* arrancando */ } await sleep(200); } throw new Error(`server no arrancó\n${s.out.slice(-1500)}`); };
const req = async (s, p, who) => {
    const r = await fetch(`${s.base}${p}`, { headers: who ? { 'x-user-id': who } : {} });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
};
const both = async (p, who) => [await req(S1, p, who), await req(S2, p, who)];
const DENIED = '{"error":"Acceso denegado"}';
const mail = (r, u) => r.text.includes(`${u}@fixture.invalid`);
const PRIVATE = /fixture\.invalid|Lector |Mediador |nombre_completo|PEDIDO|t-comprado|lastLoginAt/;
const GLOBAL = ['/api/metrics/backbone', '/api/metrics/funnels', '/api/metrics/insights', '/api/metrics/insights/states', '/api/metrics/insights/notifications'];

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
try {
    await ready(S1); await ready(S2);

    console.log('[1] métricas globales: solo administración');
    for (const p of GLOBAL) {
        const denied = [];
        for (const who of ['med-a', 'med-b', 'med-noc', 'med-libre', 'ra-yes', 'b2c', 'no-existe', null]) denied.push(...await both(p, who));
        ok(`${p} → mediadores (con o sin C005), lectores, B2C y anónimos: 403 sin datos, en las dos réplicas`, denied.every((r) => r.status === 403 && r.text === DENIED), [...new Set(denied.map((r) => `${r.status}:${r.text.slice(0, 60)}`))].join(' '));
        const adm = await both(p, 'adm');
        ok('…administración: 200, como antes', adm.every((r) => r.status === 200 && r.json?.ok !== undefined), adm.map((r) => r.status).join(' '));
    }

    console.log('[2] instituciones');
    const names = (r) => (r.json?.schools ?? []).map((x) => x.schoolName).join(',');
    ok('administración → el directorio completo', names(await req(S1, '/api/metrics/schools', 'adm')) === 'Colegio Alfa,Colegio Beta');
    const sa = await both('/api/metrics/schools', 'med-a');
    ok('mediador → solo la institución de los grupos que media', sa.every((r) => r.status === 200 && names(r) === 'Colegio Alfa') && names(await req(S2, '/api/metrics/schools', 'med-b')) === 'Colegio Beta', sa.map(names).join(' / '));
    ok('…con la misma forma {schoolId, schoolName}', Object.keys(sa[0].json.schools[0]).sort().join() === 'schoolId,schoolName');
    for (const [who, label] of [['b2c', 'lector B2C'], ['ra-yes', 'lector de un colegio'], ['med-libre', 'mediador sin grupos']]) {
        const r = await both('/api/metrics/schools', who);
        ok(`${label} → 403, sin ningún nombre de institución`, r.every((x) => x.status === 403 && x.text === DENIED), r.map((x) => `${x.status}:${x.text.slice(0, 50)}`).join(' '));
    }
    for (const [who, label] of [['adm-off', 'administrador desactivado'], ['med-off', 'mediador desactivado (aún asignado a un grupo)']]) {
        const r = await both('/api/metrics/schools', who);
        ok(`${label} → 403, sin ningún nombre de institución`, r.every((x) => x.status === 403 && x.text === DENIED), r.map((x) => `${x.status}:${x.text.slice(0, 50)}`).join(' '));
    }
    const anon = [await req(S1, '/api/metrics/schools', null), await req(S1, '/api/metrics/schools', 'no-existe')];
    ok('sin identidad o identidad desconocida → 401, sin datos', anon.every((r) => r.status === 401 && !/Colegio/.test(r.text)), anon.map((r) => r.status).join(' '));

    console.log('[3] usuarios');
    const row = (r, id) => (r.json ?? []).find((u) => u.id === id);
    const ua = await both('/api/users', 'med-a');
    ok('mediador → correo de los lectores de los grupos que media (gestión: también el que no dio A2)', ua.every((r) => r.status === 200 && G_A.every((u) => row(r, u)?.email === `${u}@fixture.invalid`)), `${ua[0].status}`);
    ok('…SIN correo ni datos privados del lector de otro grupo de su institución', ua.every((r) => row(r, 'ra-otro') && !mail(r, 'ra-otro') && row(r, 'ra-otro').lastLoginAt === undefined && row(r, 'ra-otro').accountStatus === undefined), JSON.stringify(row(ua[0], 'ra-otro')));
    ok('…que conserva el perfil público que usan las pantallas (nombre, rol, colegio)', row(ua[0], 'ra-otro').nombre_completo === 'Lector ra-otro' && row(ua[0], 'ra-otro').roles?.[0] === 'lector' && row(ua[0], 'ra-otro').colegio === 'Colegio Alfa');
    ok('…ni correo de otros mediadores; el suyo, completo', ua.every((r) => !mail(r, 'med-a2') && !mail(r, 'med-noc') && row(r, 'med-a')?.email === 'med-a@fixture.invalid'));
    ok('…y nadie de otra institución ni la cuenta B2C', ua.every((r) => !row(r, 'rb-yes') && !row(r, 'med-b') && !row(r, 'b2c') && !mail(r, 'rb-yes') && !mail(r, 'b2c')));
    ok('mediador sin grupos → ningún correo ajeno', (await both('/api/users', 'med-libre')).every((r) => r.status === 200 && (r.text.match(/@fixture\.invalid/g) || []).length === 1));
    const ub = await req(S1, '/api/users', 'b2c');
    ok('cuenta B2C → solo su propio registro', ub.status === 200 && ub.json.length === 1 && ub.json[0].id === 'b2c', `${ub.status} ${ub.json?.length}`);
    const ul = await req(S2, '/api/users', 'ra-yes');
    ok('lector → sin regresión: su registro completo y perfiles públicos de su institución, sin correos', ul.status === 200 && row(ul, 'ra-yes')?.email === 'ra-yes@fixture.invalid' && (ul.text.match(/@fixture\.invalid/g) || []).length === 1 && !!row(ul, 'ra-yes2') && !row(ul, 'rb-yes'));
    const uadm = await req(S1, '/api/users', 'adm');
    ok('administración → padrón completo con correos, como antes', uadm.status === 200 && uadm.json.length === 14 && ['ra-otro', 'rb-yes', 'b2c', 'med-b'].every((u) => row(uadm, u)?.email === `${u}@fixture.invalid`), String(uadm.json?.length));

    console.log('[4] nómina y candidatos (gestión)');
    const m = await both('/api/groups/g-a/members', 'med-a');
    const mrow = (r, id) => (r.json?.members ?? []).find((x) => x.userId === id);
    ok('mediador del grupo → su nómina completa (sin exigir A2: es gestión)', m.every((r) => r.status === 200 && r.json.count === 3 && G_A.every((u) => mrow(r, u)?.name === `Lector ${u}`)), `${m[0].status} ${m[0].json?.count}`);
    ok('…sin correos', m.every((r) => !/fixture\.invalid/.test(r.text) && r.json.members.every((x) => x.email === null)));
    ok('…y de los otros grupos de cada persona, solo los que él media (no el club ajeno)', m.every((r) => mrow(r, 'ra-yes').currentGroups.join() === 'g-a' && mrow(r, 'ra-yes').currentGroupsByType.club.length === 0 && !r.text.includes('g-club')), JSON.stringify(mrow(m[0], 'ra-yes')));
    ok('…con la misma forma de respuesta', Object.keys(m[0].json).sort().join() === 'count,groupId,groupType,members,school' && Object.keys(mrow(m[0], 'ra-yes')).sort().join() === 'colegio,currentGroups,currentGroupsByType,email,healthState,name,userId');
    // V9 65E-A (contrato de Dirección): un mediador sin C005 vigente ya no consulta la nómina. Antes (F5-C3) la recibía, mínima.
    ok('mediador del grupo sin C005 → no consulta la nómina: 403 sin ningún dato de sus lectores', (await both('/api/groups/g-a/members', 'med-noc')).every((r) => r.status === 403 && r.json?.error === 'scope_access_denied' && !/fixture\.invalid|"count"|"members"/.test(r.text)));
    const c = await both('/api/groups/g-a/candidates', 'med-a');
    ok('candidatos → lectores de su institución fuera del grupo, sin correos ni grupos ajenos', c.every((r) => r.status === 200 && r.json.candidates.map((x) => x.userId).join() === 'ra-otro' && r.json.candidates[0].email === null && r.json.candidates[0].currentGroups.length === 0 && !/fixture\.invalid|g-a2|g-club/.test(r.text)), c[0].text.slice(0, 200));
    ok('…nunca lectores de otra institución ni cuentas B2C', c.every((r) => !/rb-yes|b2c/.test(r.text)));
    const madm = await req(S1, '/api/groups/g-a/members', 'adm'), cadm = await req(S2, '/api/groups/g-a/candidates', 'adm');
    ok('administración → nómina y candidatos con correo y todos los grupos, como antes', mrow(madm, 'ra-yes')?.email === 'ra-yes@fixture.invalid' && mrow(madm, 'ra-yes').currentGroups.join() === 'g-a,g-club' && cadm.json?.candidates?.[0]?.email === 'ra-otro@fixture.invalid' && cadm.json.candidates[0].currentGroups.join() === 'g-a2,g-club', JSON.stringify(mrow(madm, 'ra-yes')));
    for (const sub of ['members', 'candidates', 'diagnosis']) {
        const denied = [];
        for (const who of ['med-a2', 'med-b', 'med-libre', 'ra-yes', 'b2c']) denied.push(...await both(`/api/groups/g-a/${sub}`, who));
        ok(`${sub}: mediador de otro grupo, de otra institución, sin grupos, un lector del grupo y B2C → 403 sin datos`, denied.every((r) => r.status === 403 && r.json?.error === 'scope_access_denied' && !PRIVATE.test(r.text)), denied.map((r) => r.status).join(' '));
    }

    console.log('[5] diagnóstico');
    const d = await both('/api/groups/g-a/diagnosis', 'med-a');
    ok('mediador del grupo → diagnóstico de membresía (200), con su forma de siempre', d.every((r) => r.status === 200 && r.json.groupId === 'g-a' && r.json.totalMembers === 3) && Object.keys(d[0].json).sort().join() === 'channels,groupId,groupName,healthStatus,inconsistencies,school,summary,totalMembers,type,warnings', Object.keys(d[0].json ?? {}).sort().join());
    ok('…sin correos, nombres ni indicadores pedagógicos de ningún lector: solo salud de la nómina', d.every((r) => !/fixture\.invalid|Lector |progress|icdli|reading|score|nivel|leo/i.test(r.text)));
    ok('administración → igual', (await req(S1, '/api/groups/g-b/diagnosis', 'adm')).json?.groupId === 'g-b');

    console.log('[6] asignaciones de contenido');
    const t = (r) => [...(r.json?.titleIds ?? [])].sort().join(',');
    const ba = await both('/api/access/by-user/ra-yes', 'med-a');
    ok('mediador → asignación operativa de su lector: la del grupo y la individual', ba.every((r) => r.status === 200 && t(r) === 't-grupo,t-individual'), `${ba[0].status} ${t(ba[0])}`);
    ok('…sin la compra: ni el título comprado ni la regla con su pedido', ba.every((r) => !/t-comprado|PEDIDO|b2c/.test(r.text) && r.json.appliedRules.join() === 'access-grupo,access-individual'), ba[0].text);
    ok('…con la misma forma, y sin progreso ni decisiones', Object.keys(ba[0].json).sort().join() === 'appliedRules,collectionIds,hasBroadAccess,titleIds');
    ok('…también para el lector sin A2 (consulta operativa, no seguimiento)', t(await req(S1, '/api/access/by-user/ra-no', 'med-a')) === 't-grupo');
    const own = await req(S2, '/api/access/by-user/ra-yes', 'ra-yes');
    ok('el propio lector → su resolución completa, con lo que compró', own.status === 200 && t(own) === 't-comprado,t-grupo,t-individual' && own.json.appliedRules.includes('b2c-woo-PEDIDO-7781'));
    ok('administración → completa', t(await req(S1, '/api/access/by-user/ra-yes', 'adm')) === 't-comprado,t-grupo,t-individual' && t(await req(S1, '/api/access/by-user/b2c', 'adm')) === 't-comprado-b2c');
    ok('la cuenta B2C → la suya', t(await req(S2, '/api/access/by-user/b2c', 'b2c')) === 't-comprado-b2c');
    const bd = [];
    for (const [who, u] of [['med-a', 'b2c'], ['med-b', 'b2c'], ['med-b', 'ra-yes'], ['med-a2', 'ra-yes2'], ['med-libre', 'ra-yes'], ['med-a', 'no-existe'], ['ra-yes2', 'ra-yes'], ['b2c', 'ra-yes']]) bd.push(...await both(`/api/access/by-user/${u}`, who));
    ok('B2C, otra institución, otro grupo, sin grupos, inexistente u otro lector → 403 sin títulos ni reglas', bd.every((r) => r.status === 403 && r.json?.error === 'scope_access_denied' && !/titleIds|appliedRules|t-|PEDIDO/.test(r.text)), bd.map((r) => r.status).join(' '));

    console.log('[7] revocación de relaciones');
    // La administración retira a med-noc de la mediación de g-a y saca a ra-yes2 del grupo.
    fs.writeFileSync(P.groups, JSON.stringify(GROUPS.map((g) => (g.id === 'g-a' ? { ...g, mediatorIds: ['med-a'], memberIds: ['ra-yes', 'ra-no'], studentIds: ['ra-yes', 'ra-no'] } : g))));
    const settled = async (fn) => { let r; for (let i = 0; i < 160; i++) { r = await fn(); if (r.every(Boolean)) return true; await sleep(250); } return false; };
    ok('mediador retirado del grupo → pierde nómina, candidatos y diagnóstico en las DOS réplicas', await settled(async () => { const r = []; for (const sub of ['members', 'candidates', 'diagnosis']) r.push(...(await both(`/api/groups/g-a/${sub}`, 'med-noc')).map((x) => x.status === 403)); return r; }));
    ok('…deja de recibir correos en el listado de usuarios y de ver instituciones', (await both('/api/users', 'med-noc')).every((r) => (r.text.match(/@fixture\.invalid/g) || []).length === 1) && (await both('/api/metrics/schools', 'med-noc')).every((r) => r.status === 403));
    ok('…y ya no consulta las asignaciones de quien fue su lector', (await both('/api/access/by-user/ra-yes', 'med-noc')).every((r) => r.status === 403));
    ok('lector retirado del grupo → su mediador deja de recibir su correo y sus asignaciones, en las DOS réplicas', await settled(async () => [...(await both('/api/users', 'med-a')).map((r) => !mail(r, 'ra-yes2') && mail(r, 'ra-yes')), ...(await both('/api/access/by-user/ra-yes2', 'med-a')).map((r) => r.status === 403)]));
    ok('…y la nómina del grupo ya no lo trae', (await both('/api/groups/g-a/members', 'med-a')).every((r) => r.json?.count === 2 && !r.text.includes('ra-yes2')));

    console.log('[8] rechazos y usos legítimos');
    const all = [];
    for (const p of GLOBAL) all.push(await req(S1, p, 'med-a'), await req(S2, p, 'b2c'));
    all.push(await req(S1, '/api/metrics/schools', 'b2c'), await req(S1, '/api/groups/g-b/members', 'med-a'), await req(S1, '/api/groups/no-existe/members', 'med-a'), await req(S2, '/api/groups/g-b/diagnosis', 'med-a'), await req(S2, '/api/access/by-user/rb-yes', 'med-a'));
    ok('ningún rechazo trae nombres, correos, instituciones, títulos ni pedidos', all.every((r) => r.status === 403 && !PRIVATE.test(r.text) && !/Colegio/.test(r.text)), all.map((r) => r.status).join(' '));
    ok('grupo ajeno y grupo inexistente → el mismo rechazo (sin oráculo)', JSON.stringify({ ...all[11].json, scope_id: 0 }) === JSON.stringify({ ...all[12].json, scope_id: 0 }));
    ok('gestión legítima sin regresión: la administración sigue leyendo nómina, candidatos y diagnóstico de cualquier grupo', (await req(S1, '/api/groups/g-b/members', 'adm')).json?.count === 1 && (await req(S2, '/api/groups/g-b/candidates', 'adm')).status === 200 && (await req(S1, '/api/groups/g-a2/diagnosis', 'adm')).status === 200);
    ok('…y el mediador, las de sus otros grupos', (await req(S1, '/api/groups/g-club/members', 'med-a2')).json?.count === 2 && (await req(S2, '/api/groups/g-b/members', 'med-b')).json?.count === 1);
    ok('los registros del servidor no contienen correos de lectores', !/ra-[a-z0-9]+@fixture\.invalid|rb-yes@fixture\.invalid/.test(S1.out + S2.out));
} catch (e) {
    fail++; console.error('ERROR', e?.message || e);
} finally {
    S1.child.kill('SIGKILL'); S2.child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
