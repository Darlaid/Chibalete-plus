/**
 * metricsLeoScopeHttp.test.mjs — CHP V9 F5-C2.
 *
 * Métricas y reporte de curso, y Leo del mediador, dentro del ámbito del mediador. Antes: al mediador asignado al curso
 * se le entregaba el desglose de TODOS los miembros (y los promedios sobre todos), y Leo le mostraba resumen, historial y
 * activaciones de cualquier miembro de sus grupos, sin A2 del lector ni C005 del mediador. Ahora rigen los controles del
 * resto de la mediación: grupo que realmente media (CIS) y, para todo dato individual, A2 del lector y C005 del mediador;
 * los agregados del curso se calculan SOLO sobre los lectores elegibles.
 *
 *   GET /api/metrics/course/:g      GET /api/leo/mediator/student/:id[/content/:c]
 *   GET /api/reports/course/:g      GET /api/leo/activation/:id
 *
 * Dos réplicas de server.js REAL sobre los MISMOS almacenes sintéticos, dos instituciones, SESSION_AUTH_MODE=off.
 *   [1] métricas de curso      [3] Leo del mediador          [5] rechazos sin datos; registro no verificable
 *   [2] reporte de curso       [4] dos réplicas: revocaciones [6] administración, lector propio y usos legítimos
 * Nunca escribe en data/ ni data-critical/.
 *
 *   node server/__test__/metricsLeoScopeHttp.test.mjs
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_ml_'));
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), evidence: path.join(tmp, 'leo_evidence.json') };
fs.mkdirSync(P.data, { recursive: true });
const A = { organizationId: 'org-a', colegio: 'Colegio Alfa' }, B = { organizationId: 'org-b', colegio: 'Colegio Beta' };
const med = (id, org) => ({ id, email: `${id}@fixture.invalid`, nombre_completo: `Mediador ${id}`, roles: ['mediador'], mediatorKind: 'teacher', accountStatus: 'active', ...org });
const reader = (id, org = {}, extra = {}) => ({ id, email: `${id}@fixture.invalid`, nombre_completo: `Lector ${id}`, roles: ['lector'], accountStatus: 'active', ...org, ...extra });
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'adm', email: 'adm@fixture.invalid', roles: ['administrador'], accountStatus: 'active' },
    med('med-a', A), med('med-a2', A), med('med-noc', A), med('med-b', B),
    reader('ra-yes', A), reader('ra-yes2', A), reader('ra-no', A), reader('ra-otro', A), reader('rb-yes', B),
    reader('b2c', {}, { b2c: true, createdVia: 'b2c-provision' }),
]));
// El lector B2C figura (indebidamente) en la nómina de g-a y tiene A2: solo su condición de cuenta personal lo excluye.
const G_A = ['ra-yes', 'ra-yes2', 'ra-no', 'b2c'];
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'g-a', name: 'Quinto A', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a', 'med-noc'], memberIds: G_A, studentIds: G_A },
    { id: 'g-a2', name: 'Quinto B', type: 'course', ...A, school: 'Colegio Alfa', mediatorIds: ['med-a2'], memberIds: ['ra-otro'], studentIds: ['ra-otro'] },
    { id: 'g-b', name: 'Sexto', type: 'course', ...B, school: 'Colegio Beta', mediatorIds: ['med-b'], memberIds: ['rb-yes'], studentIds: ['rb-yes'] },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }, { id: 'org-b', name: 'Colegio Beta' }]));
// V9 F7-C2: la obra del fixture está ASOCIADA a cada curso (regla de grupo): sin esa asociación, su mediador no ve actividad por obra.
fs.writeFileSync(P.access, JSON.stringify(['g-a', 'g-a2', 'g-b'].map((g) => ({ id: `r-${g}`, scope: 'group', scopeId: g, titleIds: ['c1'], collectionIds: [] })))); fs.writeFileSync(P.content, '[]');

// Actividad de lectura: una sesión por lector, con duración reconocible. La del lector sin A2 es enorme a propósito:
// si entrara en un promedio, se notaría.
const T0 = Date.now() - 3 * 86400000;
const DUR = { 'ra-yes': 60000, 'ra-yes2': 120000, 'ra-no': 9000000, b2c: 7000000, 'ra-otro': 30000, 'rb-yes': 45000 };
const events = [];
for (const [userId, d] of Object.entries(DUR)) {
    events.push({ event: 'session_start', userId, contentId: 'c1', timestamp: T0, streak: 0 });
    events.push({ event: 'block_complete', userId, contentId: 'c1', timestamp: T0 + 1000, streak: 1 });
    events.push({ event: 'session_end', userId, contentId: 'c1', timestamp: T0 + d, sessionDuration: d, progressPercentage: 50 });
}
fs.writeFileSync(path.join(P.data, 'analytics_db.json'), JSON.stringify(events));
// Evidencia de Leo con una pista reconocible por lector.
fs.writeFileSync(P.evidence, JSON.stringify({ schemaVersion: 1, entries: Object.keys(DUR).map((userId) => ({ userId, contentId: 'c1', timestamp: new Date(T0).toISOString(), surface: 'chatbot', pedagogicalObjective: 'vocabulary', evidenceType: 'question', interpretationHint: `pista-privada-${userId}` })) }));

const REG = a2RegistryPath();
const R = await import('../privacy/a2Registry.mjs');
grantA2(['ra-yes', 'ra-yes2', 'ra-otro', 'rb-yes', 'b2c']); grantA2(['ra-no'], 'denied');
grantC005(['med-a', 'med-a2', 'med-b']);            // med-noc media g-a pero no tiene compromiso 005

// V9 F7-C2R-U3B: la procedencia (obra–curso y membresía) consta desde antes de la actividad de esta suite.
const { ledgerEnv } = await (await import('./helpers/seedContextLedger.mjs')).seedContextLedger({ groupsPath: P.groups, accessPath: P.access, insightsPath: path.join(P.data, 'insights.db') });
const ports = await freePorts(2);
const start = (port, i) => {
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: path.join(tmp, 'uploads'), ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off',
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), LEO_EVIDENCE_DB: P.evidence,
        EVENTS_SQLITE_PATH: path.join(P.data, `events-${i}.db`), ARCHIVE_SQLITE_PATH: path.join(P.data, `archive-${i}.db`),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(P.data, `offline-${i}.db`), IDENTITY_DB: path.join(P.data, `identity-${i}.db`), SESSIONS_DB: path.join(P.data, `sessions-${i}.db`),
        IDENTITY_SQLITE_ENABLED: '0', IDENTITY_READ: 'json', CHP_A2_REGISTRY: REG, OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock', ...ledgerEnv,
    } });
    const s = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', (d) => { s.out += d; }); child.stderr.on('data', (d) => { s.out += d; });
    return s;
};
const ready = async (s) => { for (let i = 0; i < 200; i++) { if (s.child.exitCode !== null) throw new Error(`server rc=${s.child.exitCode}\n${s.out.slice(-1500)}`); try { if ((await fetch(`${s.base}/api/health`)).ok) return; } catch { /* arrancando */ } await sleep(200); } throw new Error(`server no arrancó
${s.out.slice(-1500)}`); };
const req = async (s, p, who) => {
    const r = await fetch(`${s.base}${p}`, { headers: who ? { 'x-user-id': who } : {} });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* */ }
    return { status: r.status, json, text };
};
const DENIED = '{"error":"Acceso denegado"}';
const ids = (r) => (r.json?.studentBreakdown ?? []).map((x) => x.userId).sort().join(',');
// Con la comilla de cierre: «ra-yes» no debe coincidir con «ra-yes2».
const names = (r, u) => r.text.includes(`"${u}"`) || r.text.includes(`Lector ${u}"`);
const hint = (r, u) => r.text.includes(`pista-privada-${u}"`);
const avgMs = (r) => r.json?.productMetrics?.totalReadingTimeMs;
const LEO = [(u) => `/api/leo/mediator/student/${u}`, (u) => `/api/leo/mediator/student/${u}/content/c1`, (u) => `/api/leo/activation/${u}`];
const leo3 = async (s, who, u) => { const out = []; for (const f of LEO) out.push(await req(s, f(u), who)); return out; };
const BASE_KEYS = ['alerts', 'computedAt', 'courseAttribution', 'courseId', 'courseName', 'distributions', 'icdli', 'needsAttention', 'productMetrics', 'readingLevels', 'studentBreakdown', 'summary', 'topPerformers'];
const SHAPE = { '/api/metrics/course': [...BASE_KEYS, 'backboneMetrics'].sort().join(), '/api/reports/course': [...BASE_KEYS, 'reportMeta'].sort().join() };
const PRIVATE = /pista-privada|Lector |Mediador |fixture\.invalid|nombre_completo|studentBreakdown|summary|history|outputs/;

const S1 = start(ports[0], 1), S2 = start(ports[1], 2);
try {
    await ready(S1); await ready(S2);

    for (const [n, route] of [['[1] métricas de curso', '/api/metrics/course'], ['[2] reporte de curso', '/api/reports/course']]) {
        console.log(n);
        const c = await req(S1, `${route}/g-a`, 'med-a'), c2 = await req(S2, `${route}/g-a`, 'med-a');
        ok('mediador del curso, con C005 → 200 con el desglose de los lectores con A2 (dos réplicas)', c.status === 200 && c2.status === 200 && ids(c) === 'ra-yes,ra-yes2' && ids(c2) === 'ra-yes,ra-yes2', `${c.status} ${ids(c)}`);
        ok('…sin el lector que no autorizó (A2 negada) ni el lector B2C: ni id ni nombre en toda la respuesta', !names(c, 'ra-no') && !names(c, 'b2c'));
        ok('…conteos sobre los elegibles (2 de 4 miembros)', c.json?.summary?.studentCount === 2 && c.json?.summary?.activeStudentCount === 2, JSON.stringify(c.json?.summary));
        ok('…promedios SOLO sobre los elegibles: el tiempo medio es (60 s + 120 s)/2, sin las sesiones de los excluidos', avgMs(c) === 90000, String(avgMs(c)));
        ok('…destacados y «necesitan atención» solo con lectores elegibles', [...(c.json?.topPerformers ?? []), ...(c.json?.needsAttention ?? [])].every((x) => ['ra-yes', 'ra-yes2'].includes(x.userId)));
        const cn = await req(S1, `${route}/g-a`, 'med-noc');
        ok('mediador del curso SIN C005 → ningún dato individual ni agregado derivado', cn.status === 200 && ids(cn) === '' && cn.json?.summary?.studentCount === 0 && !avgMs(cn) && !/ra-yes|ra-no|b2c|Lector /.test(cn.text), `${cn.status} ${cn.text.slice(0, 160)}`);
        if (route.includes('metrics')) ok('…y sin lectores el backbone es la forma vacía (no se consulta el agregado global de eventos)', cn.json?.backboneMetrics?.windowFrom === null && cn.json.backboneMetrics.totalEvents === 0 && !!cn.json.backboneMetrics.funnels && !!cn.json.backboneMetrics.insights && c.json.backboneMetrics.windowFrom !== null, String(c.json?.backboneMetrics?.windowFrom));
        else ok('…y el reporte conserva su cabecera, sin ventana de datos', cn.json?.reportMeta?.entityId === 'g-a' && cn.json?.reportMeta?.dataWindow === null);
        for (const [who, g, label] of [['med-b', 'g-a', 'curso de otra institución'], ['med-a2', 'g-a', 'curso de su institución que no media'], ['med-a', 'g-b', 'curso de la institución B'], ['med-a', 'g-inexistente', 'curso inexistente'], ['ra-yes', 'g-a', 'un lector del curso'], ['b2c', 'g-a', 'el lector B2C'], [null, 'g-a', 'sin identidad']]) {
            const r1 = await req(S1, `${route}/${g}`, who), r2 = await req(S2, `${route}/${g}`, who);
            ok(`${label} → rechazado en las dos réplicas, sin datos`, r1.status === 403 && r2.status === 403 && r1.text === DENIED && r2.text === DENIED, `${r1.status} ${r1.text.slice(0, 90)}`);
        }
        // En estas dos rutas la administración es la autoridad de máquina (secreto en archivo, solo POSIX), no un usuario:
        // su rama no cambia (`isAdminRequest` ⇒ sin filtro) y la cubren las suites de identidad en CI.
        ok('la forma de la respuesta no cambió', Object.keys(c.json).sort().join() === SHAPE[route] && Object.keys(cn.json).sort().join() === SHAPE[route], Object.keys(c.json).sort().join());
    }

    console.log('[3] Leo del mediador');
    const l = await leo3(S1, 'med-a', 'ra-yes'), l2 = await leo3(S2, 'med-a', 'ra-yes');
    ok('mediador → lector de su grupo con A2 y C005 → resumen, historial y activaciones (dos réplicas)', [...l, ...l2].every((r) => r.status === 200 && r.json?.success === true) && 'summary' in l[0].json && 'history' in l[1].json && 'outputs' in l[2].json, l.map((r) => r.status).join(' '));
    // V9 F7-C2R-U3: el contenido de Leo sale del contexto pedagógico con procedencia temporal (lo cubre pedagogicalRecoveryHttp).
    // V9 F7-C2R-U3B: esta suite registra la procedencia (la necesitan sus cifras de curso): el mediador recibe el estado de SU contexto, y nada de otros lectores.
    ok('…desde el contexto del curso: declara su estado, sin evidencia de otros lectores', typeof l[0].json.summary.data_state === 'string' && l[0].json.summary.reason !== 'provenance_not_recorded'
        && !/pista-privada-(ra-no|ra-otro|rb-yes|b2c)"/.test(l[0].text + l[1].text), l[0].text.slice(0, 200));
    for (const [who, u, label] of [['med-b', 'ra-yes', 'otra institución'], ['med-a2', 'ra-yes', 'misma institución, grupo que no media'], ['med-noc', 'ra-yes', 'mediador sin C005'], ['med-a', 'ra-no', 'lector sin A2'], ['med-a', 'b2c', 'lector B2C (aun en la nómina y con A2)'], ['med-b', 'b2c', 'lector B2C, otro mediador'], ['med-a', 'no-existe', 'lector inexistente'], ['ra-yes2', 'ra-yes', 'otro lector']]) {
        const r = [...await leo3(S1, who, u), ...await leo3(S2, who, u)];
        ok(`${label} → 403 en las tres rutas y las dos réplicas, sin resumen, historial ni activaciones`, r.every((x) => x.status === 403 && x.json?.error === 'scope_access_denied' && !/pista-privada|summary|history|outputs/.test(x.text)), r.map((x) => x.status).join(' '));
    }
    const self = await leo3(S1, 'ra-no', 'ra-no');
    ok('el propio lector (aun sin A2) conserva SU activación; las rutas de mediación siguen vedadas al lector', self[2].status === 200 && 'outputs' in self[2].json && self[0].status === 403 && self[1].status === 403, self.map((r) => r.status).join(' '));
    ok('el lector B2C conserva su propia activación', (await req(S2, LEO[2]('b2c'), 'b2c')).status === 200);

    console.log('[4] dos réplicas: revocaciones');
    R.appendDecisions([{ subjectId: 'ra-yes', kind: 'A2', status: 'revoked', actDay: R.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-F5C2-REV' }]);
    const rv = [...await leo3(S1, 'med-a', 'ra-yes'), ...await leo3(S2, 'med-a', 'ra-yes')];
    ok('se revoca la A2 del lector → Leo deja de mostrarlo en las DOS réplicas', rv.every((r) => r.status === 403 && !hint(r, 'ra-yes')), rv.map((r) => r.status).join(' '));
    const mr = [await req(S1, '/api/metrics/course/g-a', 'med-a'), await req(S2, '/api/metrics/course/g-a', 'med-a'), await req(S1, '/api/reports/course/g-a', 'med-a'), await req(S2, '/api/reports/course/g-a', 'med-a')];
    ok('…y métricas y reporte del curso ya no lo incluyen ni lo promedian, en las dos', mr.every((r) => r.status === 200 && ids(r) === 'ra-yes2' && !names(r, 'ra-yes') && avgMs(r) === 120000 && r.json.summary.studentCount === 1), mr.map((r) => `${ids(r)}:${avgMs(r)}`).join(' / '));
    const before = await req(S1, '/api/metrics/course/g-b', 'med-b');
    R.appendDecisions([{ subjectId: 'med-b', kind: 'C005', status: 'revoked', actDay: R.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-F5C2-REV' }]);
    const cb = [...await leo3(S1, 'med-b', 'rb-yes'), ...await leo3(S2, 'med-b', 'rb-yes')];
    ok('se revoca el C005 del mediador B → Leo le niega a su propio lector en las DOS réplicas', cb.every((r) => r.status === 403), cb.map((r) => r.status).join(' '));
    const mb = [await req(S1, '/api/metrics/course/g-b', 'med-b'), await req(S2, '/api/reports/course/g-b', 'med-b')];
    ok('…y su curso queda sin desglose ni promedios, en las dos', mb.every((r) => r.status === 200 && ids(r) === '' && !avgMs(r) && !names(r, 'rb-yes')) && ids(before) === 'rb-yes', mb.map((r) => `${r.status}:${ids(r)}`).join(' / '));

    console.log('[5] rechazos y registro no verificable');
    const all = [];
    for (const [who, p] of [['med-b', '/api/metrics/course/g-a'], ['med-a2', '/api/reports/course/g-a'], ['med-a', '/api/metrics/course/g-b'], ['med-a', '/api/reports/course/no-existe'], ['ra-yes', '/api/metrics/course/g-a']]) all.push(await req(S1, p, who));
    ok('curso ajeno, de otra institución o inexistente: el mismo 403 con el mismo cuerpo', all.every((r) => r.status === 403 && r.text === DENIED), [...new Set(all.map((r) => `${r.status}:${r.text}`))].join(' '));
    const leoDenied = [...rv, ...cb, ...await leo3(S1, 'med-a', 'ra-no'), ...await leo3(S1, 'med-a', 'b2c'), ...await leo3(S1, 'med-a', 'no-existe'), ...await leo3(S1, 'med-b', 'ra-yes2')];
    ok('Leo: A2 revocada, sin A2, sin C005, B2C, ajeno o inexistente → cuerpos idénticos salvo el id consultado', new Set(leoDenied.map((r) => JSON.stringify({ ...r.json, scope_id: null }))).size === 1, [...new Set(leoDenied.map((r) => r.text))].slice(0, 3).join(' '));
    ok('…ningún rechazo trae nombres, correos, evidencia de Leo ni indicadores', [...all, ...leoDenied].every((r) => !PRIVATE.test(r.text)));
    fs.renameSync(REG, `${REG}.off`);
    const blind = [await req(S1, '/api/metrics/course/g-a', 'med-a'), await req(S2, '/api/reports/course/g-a', 'med-a'), ...await leo3(S1, 'med-a', 'ra-yes2'), ...await leo3(S2, 'med-a', 'ra-yes2')];
    const admBlind = [await req(S2, LEO[0]('ra-yes2'), 'adm'), await req(S1, LEO[1]('ra-no'), 'adm'), await req(S1, LEO[2]('ra-yes2'), 'ra-yes2')];
    fs.renameSync(`${REG}.off`, REG);
    ok('registro de decisiones no verificable → 503 para el mediador en las cinco rutas, sin datos (fallo cerrado)', blind.every((r) => r.status === 503 && !PRIVATE.test(r.text) && !/ra-yes2/.test(r.text)), blind.map((r) => r.status).join(' '));
    ok('…y ni la administración ni el lector propio se ven afectados', admBlind.every((r) => r.status === 200), admBlind.map((r) => r.status).join(' '));

    console.log('[6] administración, lector propio y usos legítimos');
    const admLeo = [...await leo3(S1, 'adm', 'ra-no'), ...await leo3(S2, 'adm', 'b2c'), ...await leo3(S2, 'adm', 'rb-yes')];
    ok('administración: Leo de cualquier lector, como antes', admLeo.every((r) => r.status === 200), admLeo.map((r) => r.status).join(' '));
    ok('el lector conserva sus propias métricas', (await req(S1, '/api/metrics/student/ra-yes2', 'ra-yes2')).status === 200);
    const legit = [await req(S2, '/api/metrics/course/g-a', 'med-a'), await req(S1, '/api/reports/course/g-a', 'med-a'), ...await leo3(S2, 'med-a', 'ra-yes2')];
    ok('mediador con todo en regla: métricas, reporte y Leo de su lector siguen funcionando', legit.every((r) => r.status === 200) && ids(legit[0]) === 'ra-yes2' && legit[0].json.studentBreakdown[0].pedagogicalProfile !== undefined && legit[1].json.reportMeta?.entityId === 'g-a' && typeof legit[2].json.summary.data_state === 'string');
    ok('otro mediador de la misma institución ve SU curso, no el ajeno', ids(await req(S1, '/api/metrics/course/g-a2', 'med-a2')) === 'ra-otro');
    ok('los registros del servidor no contienen evidencia de Leo ni nombres de lectores', !/pista-privada|Lector ra-|Lector b2c/.test(S1.out + S2.out));
} catch (e) {
    fail++; console.error('ERROR', e?.message || e);
} finally {
    S1.child.kill('SIGKILL'); S2.child.kill('SIGKILL');
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
console.log(`\nresultado: ${pass} correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
