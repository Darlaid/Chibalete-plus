/**
 * aulaVivaIndividualA2.test.mjs — CHP-V8.1-PROD-01B (DIR-V81-07, H-1).
 *
 * Todo seguimiento individual institucional de Aula Viva exige A2 vigente del lector,
 * C005 vigente del mediador y pertenencia autorizada al grupo. Con server.js REAL
 * (dos réplicas), el CIS real y el registro de decisiones real (sintético):
 *  [1] individuales: cronología, cronología de señal, vector de rasgos, historial de
 *      riesgo, perfil, recomendaciones del lector; A2 Sí/No/Pendiente/Revocada
 *  [2] C005 vigente / vencido / revocado; mediador no asignado; lo propio y la
 *      administración no cambian; la denegación es la misma que fuera de alcance
 *  [3] listados mixtos: cola de atención, cola de seguimiento y miembros de cohorte
 *      (solo los autorizados, recuento sin los excluidos)
 *  [4] revocación de A2 y de C005 efectiva en las dos réplicas sin reiniciar
 *  [5] registro no verificable ⇒ 503 (fallo cerrado), nunca datos
 * Nunca toca data/ ni data-critical/.
 *
 *   node server/__test__/aulaVivaIndividualA2.test.mjs
 */
import './helpers/testMode.mjs';
import { freePort } from './helpers/freePort.mjs';
import { a2RegistryPath, grantA2, grantC005 } from './helpers/testA2.mjs';
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_av_a2_'));
const P = { users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'), schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'), data: path.join(tmp, 'data'), uploads: path.join(tmp, 'up'),
    insights: path.join(tmp, 'insights.db') };
for (const d of [P.data, P.uploads]) fs.mkdirSync(d, { recursive: true });
process.env.INSIGHTS_SQLITE_PATH = P.insights;

// Lectores de g-a: A2 Sí (yes), No (no), sin decisión (pend), revocada (rev). r-b está en g-b.
const RA = ['r-yes', 'r-no', 'r-pend', 'r-rev'];
const MEDS = ['med-ok', 'med-exp', 'med-rev', 'med-none'];
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'adm', roles: ['administrador'], accountStatus: 'active' },
    ...MEDS.map((id) => ({ id, roles: ['mediador'], organizationId: 'org-a', colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher' })),
    { id: 'med-b', roles: ['mediador'], organizationId: 'org-a', colegio: 'Colegio Alfa', accountStatus: 'active', mediatorKind: 'teacher' },
    ...[...RA, 'r-b'].map((id) => ({ id, roles: ['lector'], organizationId: 'org-a', colegio: 'Colegio Alfa', accountStatus: 'active', email: `${id}@fixture.invalid` })),
]));
fs.writeFileSync(P.groups, JSON.stringify([
    { id: 'g-a', type: 'course', organizationId: 'org-a', school: 'Colegio Alfa', mediatorIds: MEDS, memberIds: RA, studentIds: RA },
    { id: 'g-b', type: 'course', organizationId: 'org-a', school: 'Colegio Alfa', mediatorIds: ['med-b'], memberIds: ['r-b'], studentIds: ['r-b'] },
]));
fs.writeFileSync(P.schools, JSON.stringify([{ id: 'org-a', name: 'Colegio Alfa' }]));
fs.writeFileSync(P.access, '[]'); fs.writeFileSync(P.content, '[]');

// Registro de decisiones sintético.
a2RegistryPath();
const R = await import('../privacy/a2Registry.mjs');
grantA2(['r-yes', 'r-b', 'r-rev']);
grantA2(['r-no'], 'denied');
R.appendDecisions([{ subjectId: 'r-rev', kind: 'A2', status: 'revoked', actDay: R.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-REV' }]);
grantC005(['med-ok', 'med-b']);
R.appendDecisions([
    { subjectId: 'med-exp', kind: 'C005', status: 'granted', actDay: '2025-01-01', version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-EXP', validUntil: '2025-12-31' },
    { subjectId: 'med-rev', kind: 'C005', status: 'granted', actDay: '2025-01-01', version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-REV1' },
    { subjectId: 'med-rev', kind: 'C005', status: 'revoked', actDay: R.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-REV2' },
]);

// insights.db con su esquema REAL y filas sintéticas por lector.
const Ins = await import('../db/insightsDbExt.mjs'), Ped = await import('../db/pedagogyDbExt.mjs'), Out = await import('../db/outcomesDbExt.mjs'), Rol = await import('../db/rollupsDbExt.mjs');
const idb = Ins.getInsightsExtDb(), pdb = Ped.getPedagogyExtDb(), odb = Out.getOutcomesExtDb(), rdb = Rol.getRollupsExtDb();
const NOW = Date.now();
let seq = 0;
const insertRow = (db, t, values) => {
    const info = db.prepare(`PRAGMA table_info(${t})`).all();
    const row = {};
    for (const c of info) {
        if (c.name in values) { row[c.name] = values[c.name]; continue; }
        if (c.pk && /INT/i.test(c.type) && info.filter((x) => x.pk).length === 1) continue;
        if (c.notnull && c.dflt_value === null) row[c.name] = /INT/i.test(c.type) ? NOW + (seq++) : /REAL|NUM/i.test(c.type) ? 1 : (/_json$/.test(c.name) ? '{}' : `${c.name}-${seq++}`);
    }
    const k = Object.keys(row);
    db.prepare(`INSERT INTO ${t} (${k.join(',')}) VALUES (${k.map((x) => '@' + x).join(',')})`).run(row);
};
const ALL = [...RA, 'r-b'];
for (const u of ALL) {
    insertRow(idb, 'user_reading_profiles', { user_id: u, abandono_risk: 0.9, engagement_score: 0.1, last_active_at: NOW - 86_400_000, updated_at: NOW, source_watermark: 1 });
    insertRow(idb, 'signal_snapshots', { scope_type: 'user', scope_id: u, signal_id: 'continuidad_semanal', period: '28d', metric_value: 0.4, updated_at: NOW, metadata_json: JSON.stringify({ who: u }) });
    insertRow(rdb, 'feature_vectors', { user_id: u, features_json: JSON.stringify({ who: u }) });
    insertRow(pdb, 'pedagogical_risk_history', { user_id: u, source_signals_json: JSON.stringify({ who: u }) });
    insertRow(pdb, 'pedagogical_recommendations', { recommendation_id: `rec-${u}`, scope_type: 'user', scope_id: u, rule_id: 'r', recommendation_type: 'lectura_guiada', severity: 'critical', created_at: NOW, expires_at: NOW + 86_400_000, explanation_json: JSON.stringify({ who: u }), rule_ids_json: '[]' });
    insertRow(pdb, 'pedagogical_interventions', { intervention_id: `int-${u}`, teacher_id: u === 'r-b' ? 'med-b' : 'med-ok', student_id: u, intervention_type: 'lectura_guiada', created_at: NOW - 20 * 86_400_000 });
}
insertRow(odb, 'cohort_definitions', { cohort_id: 'coh-risk', cohort_key: 'riesgo-alto', cohort_type: 'risk', scope_type: 'risk', scope_id: 'alto', criteria_json: '{}', active: 1 });
for (const u of ALL) insertRow(odb, 'cohort_memberships', { cohort_id: 'coh-risk', user_id: u, membership_reason_json: '{}', left_at: null });
for (const m of [Ins, Ped, Out, Rol]) for (const k of Object.keys(m)) if (/^close/.test(k)) try { m[k](); } catch { /* */ }

const spawnApi = async () => {
    const port = await freePort();
    const child = spawn(process.execPath, ['server/server.js'], { cwd: REPO, env: {
        ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: P.data,
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools, ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
        USER_AUDIT_DB: path.join(tmp, 'audit.json'), PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'), EVENTS_SQLITE_PATH: path.join(tmp, 'events.db'),
        ARCHIVE_SQLITE_PATH: path.join(tmp, 'archive.db'), INSIGHTS_SQLITE_PATH: P.insights, OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'off.db'),
        IDENTITY_DB: path.join(tmp, 'identity.db'), SESSIONS_DB: path.join(tmp, 'sessions.db'), LEO_EVIDENCE_DB: path.join(tmp, 'leo.json'),
        ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off', OPENAI_API_KEY: '', GEMINI_API_KEY: '',
    } });
    let logs = ''; child.stdout.on('data', (d) => { logs += d; }); child.stderr.on('data', (d) => { logs += d; });
    child.base = `http://127.0.0.1:${port}`; child.logs = () => logs;
    for (let i = 0; i < 300; i++) { if (child.exitCode !== null) throw new Error(logs.slice(-1500)); try { if ((await fetch(`${child.base}/api/health`)).ok) return child; } catch { /* */ } await sleep(300); }
    throw new Error('nunca healthy');
};
const stop = async (c) => { if (c && c.exitCode === null && c.signalCode === null) { const e = new Promise((r) => c.once('exit', r)); c.kill('SIGKILL'); await e; } };
const get = async (c, who, p) => { const r = await fetch(`${c.base}/api/aula-viva${p}`, { headers: { 'x-user-id': who, 'sec-fetch-site': 'same-origin' } }); const raw = await r.text(); let b = null; try { b = JSON.parse(raw); } catch { /* */ } return { s: r.status, b, raw }; };
const INDIVIDUAL = (u) => [`/students/${u}/timeline`, `/students/${u}/signals/continuidad_semanal/timeline`, `/students/${u}/feature-vector`,
    `/students/${u}/risk-history`, `/institutional/profile/${u}`, `/recommendations/scope/user/${u}`];
const statuses = async (c, who, u) => Promise.all(INDIVIDUAL(u).map(async (p) => (await get(c, who, p)).s));
const allEq = (arr, v) => arr.every((x) => x === v);
const ids = (rows, k) => (Array.isArray(rows) ? rows : []).map((r) => r?.[k]).filter(Boolean).sort().join(',');

let a1, a2;
try {
    a1 = await spawnApi(); a2 = await spawnApi();

    section('[1] individuales con un mediador asignado y C005 vigente');
    ok('A2 Sí ⇒ las seis operaciones individuales 200', allEq(await statuses(a1, 'med-ok', 'r-yes'), 200), JSON.stringify(await statuses(a1, 'med-ok', 'r-yes')));
    for (const [u, label] of [['r-no', 'No'], ['r-pend', 'Pendiente'], ['r-rev', 'Revocada']]) {
        ok(`A2 ${label} ⇒ 403 en las seis`, allEq(await statuses(a1, 'med-ok', u), 403), JSON.stringify(await statuses(a1, 'med-ok', u)));
    }
    const denyA2 = await get(a1, 'med-ok', '/students/r-no/timeline');
    const denyOther = await get(a1, 'med-ok', '/students/r-b/timeline');
    ok('la denegación por A2 es idéntica a la de un lector de otro grupo (no revela pertenencia)',
        denyA2.b?.error === denyOther.b?.error && denyA2.s === denyOther.s && Object.keys(denyA2.b ?? {}).sort().join() === Object.keys(denyOther.b ?? {}).sort().join(), `${denyA2.raw} | ${denyOther.raw}`);
    ok('…y no contiene datos del lector', !denyA2.raw.includes('"who"') && !denyA2.raw.includes('abandono'));

    section('[2] C005, asignación, lo propio y administración');
    ok('C005 vencido ⇒ 403 incluso con A2 Sí', allEq(await statuses(a1, 'med-exp', 'r-yes'), 403));
    ok('C005 revocado ⇒ 403', allEq(await statuses(a1, 'med-rev', 'r-yes'), 403));
    ok('sin C005 ⇒ 403', allEq(await statuses(a1, 'med-none', 'r-yes'), 403));
    ok('mediador NO asignado (med-b, C005 vigente) ⇒ 403 sobre r-yes', allEq(await statuses(a1, 'med-b', 'r-yes'), 403));
    ok('…y su propio lector con A2 ⇒ 200 (sin cambios)', allEq(await statuses(a1, 'med-b', 'r-b'), 200));
    ok('administración ⇒ 200 sobre cualquiera, sin A2 (no es consulta institucional)', allEq(await statuses(a1, 'adm', 'r-no'), 200));
    ok('lo propio: el lector sin A2 ve su perfil (200)', (await get(a1, 'r-no', '/institutional/profile/r-no')).s === 200);

    section('[3] listados mixtos');
    const att = await get(a1, 'med-ok', '/students-needing-attention');
    ok('cola de atención: solo r-yes', att.s === 200 && ids(att.b, 'user_id') === 'r-yes', att.raw.slice(0, 300));
    ok('…administración ve a todos', ids((await get(a1, 'adm', '/students-needing-attention')).b, 'user_id') === ALL.slice().sort().join(','));
    const fq = await get(a1, 'med-ok', '/institutional/outcomes/follow-up-queue');
    ok('cola de seguimiento: solo r-yes (ni r-no, r-pend, r-rev ni r-b de otro grupo)', fq.s === 200 && ids(fq.b, 'student_id') === 'r-yes', fq.raw.slice(0, 300));
    ok('…administración: los cinco', ids((await get(a1, 'adm', '/institutional/outcomes/follow-up-queue')).b, 'student_id') === ALL.slice().sort().join(','));
    const mem = await get(a1, 'med-ok', '/institutional/cohorts/coh-risk/members');
    ok('miembros de cohorte: solo r-yes y el recuento no incluye a los excluidos', mem.s === 200 && ids(mem.b?.members, 'user_id') === 'r-yes' && mem.b.members_count === 1, mem.raw.slice(0, 300));
    ok('…C005 vencido: ningún miembro', (await get(a1, 'med-exp', '/institutional/cohorts/coh-risk/members')).b?.members_count === 0);
    ok('…administración: los cinco', (await get(a1, 'adm', '/institutional/cohorts/coh-risk/members')).b?.members_count === 5);

    section('[4] revocación entre réplicas, sin reiniciar');
    ok('antes: r-yes visible en las dos réplicas', allEq(await statuses(a1, 'med-ok', 'r-yes'), 200) && allEq(await statuses(a2, 'med-ok', 'r-yes'), 200));
    R.appendDecisions([{ subjectId: 'r-yes', kind: 'A2', status: 'revoked', actDay: R.dayOf(Date.now()), version: '004@1.0', medium: 'admin_record', capacity: 'legal_representative', verification: 'verified', requestRef: 'A2-SINT-REV-YES' }]);
    ok('A2 revocada ⇒ 403 inmediato en la réplica 2', allEq(await statuses(a2, 'med-ok', 'r-yes'), 403));
    ok('…y en la réplica 1', allEq(await statuses(a1, 'med-ok', 'r-yes'), 403));
    ok('…y sale de los listados', ids((await get(a2, 'med-ok', '/students-needing-attention')).b, 'user_id') === '' && (await get(a1, 'med-ok', '/institutional/cohorts/coh-risk/members')).b?.members_count === 0);
    R.appendDecisions([{ subjectId: 'med-b', kind: 'C005', status: 'revoked', actDay: R.dayOf(Date.now()), version: '005@1.0', medium: 'paper', capacity: 'mediator', verification: 'verified', requestRef: 'C005-SINT-REV-B' }]);
    ok('C005 revocado ⇒ med-b deja de ver a su lector en las dos réplicas', allEq(await statuses(a1, 'med-b', 'r-b'), 403) && allEq(await statuses(a2, 'med-b', 'r-b'), 403));

    section('[5] registro no verificable');
    const reg = process.env.CHP_A2_REGISTRY;
    const saved = fs.readFileSync(reg, 'utf8');
    if (!saved.includes('"a":"granted"')) throw new Error('formato del registro inesperado');
    fs.writeFileSync(reg, saved.replace('"a":"granted"', '"a":"denied"')); // línea alterada ⇒ MAC inválido
    // Sujeto que el CIS SÍ concede (g-a): fuera de alcance el CIS deniega antes de leer el registro.
    const broken = await get(a1, 'med-ok', '/students/r-no/timeline');
    const brokenList = await get(a2, 'med-b', '/students-needing-attention');
    ok('registro alterado ⇒ 503 en un individual, sin datos', broken.s === 503 && broken.b?.error === 'individual_access_unavailable' && !broken.raw.includes('"who"'), broken.raw);
    ok('…y 503 en un listado (nunca una lista parcial)', brokenList.s === 503, brokenList.raw);
    ok('…la administración no depende del registro', (await get(a1, 'adm', '/students/r-b/timeline')).s === 200);
    fs.writeFileSync(reg, saved);
    ok('registro restaurado ⇒ vuelve la decisión vigente (A2 No ⇒ 403)', (await get(a2, 'med-ok', '/students/r-no/timeline')).s === 403);
    ok('logs sin correos ni contenido de los lectores', ![a1, a2].some((c) => c.logs().includes('@fixture.invalid') || c.logs().includes('"who"')));
} catch (e) {
    console.error('  ✗ excepción inesperada', e); fail++;
} finally {
    for (const c of [a1, a2]) await stop(c).catch(() => {});
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}
console.log(`\nAula Viva individual A2/C005 (V8.1-PROD-01B H-1): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
