/**
 * cohortDisclosure.test.mjs — CHP-V8.1-PROD-01 (DIR-V81-05).
 *
 * Umbral de cohortes de insights.db: ≥ 5 lectores distintos y sin inferencias por
 * diferencia entre totales y subconjuntos.
 *  [1] regla pura: 1, 4, 5, 6 y más lectores; mediadores fuera del recuento;
 *      pares anidados (grupo ⊂ colegio, club ⊂ curso); total − Σ subconjuntos;
 *      ámbitos individuales y globales no afectados
 *  [2] HTTP con los routers REALES (operacional e institucional) y el CIS real:
 *      comparativa, rollups, recomendaciones, outcomes, learnings y trayectoria;
 *      filtros (periodo, sinceTs); la respuesta suprimida no informa tamaño ni
 *      valores; administrador sin umbral; el detalle individual (ámbito user) no
 *      cambia; revocación de pertenencia surte efecto en la siguiente petición;
 *      fuentes ilegibles ⇒ fallo cerrado
 *
 *   node server/__test__/cohortDisclosure.test.mjs
 */
import './helpers/testMode.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import express from 'express';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_cohort_'));
const data = path.join(tmp, 'data');
fs.mkdirSync(data, { recursive: true });
process.env.INSIGHTS_SQLITE_PATH = path.join(tmp, 'insights.db');
process.env.EVENTS_SQLITE_PATH = path.join(tmp, 'events.db');
process.env.ARCHIVE_SQLITE_PATH = path.join(tmp, 'events.archive.db');
process.env.PROGRESS_SQLITE_PATH = path.join(tmp, 'progress.db');
process.env.IDENTITY_DB = path.join(tmp, 'identity.db');
process.env.SESSIONS_DB = path.join(tmp, 'sessions.db');
process.env.USERS_DB = path.join(data, 'usuarios_colegios_oro.json');
process.env.GROUPS_DB = path.join(data, 'groups_db.json');
process.env.SCHOOLS_DB = path.join(data, 'schools_db.json');

// V8.1-PROD-01B (DIR-V81-07): seguimiento individual con A2 del lector y C005 del mediador (registro sintético).
const { grantA2, grantC005 } = await import('./helpers/testA2.mjs');
grantA2(['s-1']); grantC005(['med-a']);
const C = await import('../analytics/cohortDisclosure.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const readers = (p, n) => Array.from({ length: n }, (_, i) => `${p}${i + 1}`);
const lect = (ids, org) => ids.map((id) => ({ id, role: 'lector', organizationId: org }));

section('[1] regla pura');
{
    // org-x: grupos disjuntos de 1, 4, 5 y 6 lectores (org = 16).
    const g = { g1: readers('x1-', 1), g4: readers('x4-', 4), g5: readers('x5-', 5), g6: readers('x6-', 6) };
    const groups = Object.entries(g).map(([id, m]) => ({ id, type: 'course', organizationId: 'org-x', mediatorIds: ['med-x'], memberIds: m }));
    const users = [{ id: 'med-x', role: 'mediador', organizationId: 'org-x' }, ...lect(Object.values(g).flat(), 'org-x')];
    const S = { groups, users };
    const d = (t, id) => C.cohortDisclosure(t, id, { sources: S });
    ok('1 lector ⇒ suprimido', d('group', 'g1').reason === 'cohort_below_min');
    ok('4 lectores ⇒ suprimido', d('group', 'g4').reason === 'cohort_below_min');
    ok('5 lectores ⇒ visible', d('group', 'g5').allowed === true, JSON.stringify(d('group', 'g5')));
    ok('6 lectores ⇒ visible', d('group', 'g6').allowed === true);
    ok('organización con un subgrupo de 1–4 ⇒ suprimida (org − g5 − g6 aislaría a g1+g4)', d('organization', 'org-x').reason === 'complement_below_min');
    ok('grupo inexistente ⇒ suprimido', d('group', 'nope').reason === 'cohort_below_min');
    ok('ámbito individual y global: no los decide esta regla (A2/C005 y política propia)', d('user', 'x5-1').allowed && d('all', 'global').allowed);

    // Mediador dentro de memberIds: no cuenta como lector.
    const S2 = { groups: [{ id: 'gm', type: 'course', organizationId: 'org-m', mediatorIds: ['med-m'], memberIds: [...readers('m-', 4), 'med-m'] }],
        users: [{ id: 'med-m', role: 'mediador', organizationId: 'org-m' }, ...lect(readers('m-', 4), 'org-m')] };
    ok('4 lectores + el mediador en memberIds ⇒ suprimido', C.cohortDisclosure('group', 'gm', { sources: S2 }).reason === 'cohort_below_min');

    // org-y: g5 (5) y g2 (2): g5 ⊂ org con diferencia 2 ⇒ se suprimen g5 y la organización.
    const S3 = { groups: [{ id: 'y5', type: 'course', organizationId: 'org-y', mediatorIds: [], memberIds: readers('y5-', 5) },
        { id: 'y2', type: 'course', organizationId: 'org-y', mediatorIds: [], memberIds: readers('y2-', 2) }],
    users: lect([...readers('y5-', 5), ...readers('y2-', 2)], 'org-y') };
    ok('grupo de 5 en organización de 7 ⇒ suprimido (org − grupo = 2 personas)', C.cohortDisclosure('group', 'y5', { sources: S3 }).reason === 'complement_below_min');
    ok('…y la organización también', C.cohortDisclosure('organization', 'org-y', { sources: S3 }).allowed === false);

    // org-z: curso C (8) ⊃ club K (6): diferencia 2 ⇒ se suprimen los dos.
    const c8 = readers('z-', 8);
    const S4 = { groups: [{ id: 'cz', type: 'course', organizationId: 'org-z', mediatorIds: [], memberIds: c8 },
        { id: 'kz', type: 'club', organizationId: 'org-z', mediatorIds: [], memberIds: c8.slice(0, 6) }], users: lect(c8, 'org-z') };
    ok('club de 6 dentro de un curso de 8 ⇒ club suprimido', C.cohortDisclosure('club', 'kz', { sources: S4 }).reason === 'complement_below_min');
    ok('…y el curso suprimido', C.cohortDisclosure('group', 'cz', { sources: S4 }).reason === 'complement_below_min');

    // org-w: dos grupos de 5 y 6 sin solapamiento (org = 11): todo visible.
    const S5 = { groups: [{ id: 'w5', type: 'course', organizationId: 'org-w', mediatorIds: [], memberIds: readers('w5-', 5) },
        { id: 'w6', type: 'course', organizationId: 'org-w', mediatorIds: [], memberIds: readers('w6-', 6) }],
    users: lect([...readers('w5-', 5), ...readers('w6-', 6)], 'org-w') };
    ok('grupos de 5 y 6 en una organización de 11 ⇒ los tres visibles', ['w5', 'w6'].every((id) => C.cohortDisclosure('group', id, { sources: S5 }).allowed)
        && C.cohortDisclosure('organization', 'org-w', { sources: S5 }).allowed);
    // Curso de 12 con dos clubes de 5 disjuntos: resto 2 ⇒ el curso se suprime.
    const c12 = readers('v-', 12);
    const S6 = { groups: [{ id: 'cv', type: 'course', organizationId: 'org-v', mediatorIds: [], memberIds: c12 },
        { id: 'kv1', type: 'club', organizationId: 'org-v', mediatorIds: [], memberIds: c12.slice(0, 5) },
        { id: 'kv2', type: 'club', organizationId: 'org-v', mediatorIds: [], memberIds: c12.slice(5, 10) }], users: lect(c12, 'org-v') };
    ok('curso de 12 con dos clubes de 5: total − Σ clubes = 2 ⇒ curso suprimido', C.cohortDisclosure('group', 'cv', { sources: S6 }).reason === 'complement_below_min');
}

section('[2] HTTP con los routers reales');
const MED = 'med-a';
const SMALL = readers('s-', 3), FIVE = readers('f-', 5), BIG = readers('b-', 6);
const writeSources = (fiveMembers = FIVE) => {
    fs.writeFileSync(process.env.USERS_DB, JSON.stringify([
        { id: 'adm', role: 'administrador' }, { id: MED, role: 'mediador', organizationId: 'org-a' },
        ...lect([...SMALL, ...FIVE, ...BIG], 'org-a'),
    ]));
    fs.writeFileSync(process.env.GROUPS_DB, JSON.stringify([
        { id: 'g-small', type: 'course', organizationId: 'org-a', mediatorIds: [MED], memberIds: SMALL },
        { id: 'g-five', type: 'course', organizationId: 'org-a', mediatorIds: [MED], memberIds: fiveMembers },
        { id: 'g-big', type: 'course', organizationId: 'org-a', mediatorIds: [MED], memberIds: BIG },
    ]));
};
writeSources();
fs.writeFileSync(process.env.SCHOOLS_DB, JSON.stringify([{ id: 'org-a', name: 'Alfa' }]));

const insExt = await import('../db/insightsDbExt.mjs');
const pedExt = await import('../db/pedagogyDbExt.mjs');
const outExt = await import('../db/outcomesDbExt.mjs');
const rolExt = await import('../db/rollupsDbExt.mjs');
const { createOperationalRouter } = await import('../aulaViva/operationalRouter.mjs');
const { createInstitutionalRouter } = await import('../aulaViva/institutionalRouter.mjs');
const idb = insExt.getInsightsExtDb(), pdb = pedExt.getPedagogyExtDb(), odb = outExt.getOutcomesExtDb(), rdb = rolExt.getRollupsExtDb();
const NOW = Date.now();
const SECRET_VALUE = 4242.5; // valor del agregado pequeño: no debe aparecer nunca para el mediador
let seqN = 0;
const insertRow = (db, t, values) => {
    const info = db.prepare(`PRAGMA table_info(${t})`).all();
    const row = {};
    for (const c of info) {
        if (c.name in values) { row[c.name] = values[c.name]; continue; }
        if (c.pk && /INT/i.test(c.type) && info.filter((x) => x.pk).length === 1) continue; // solo el alias de rowid
        if (c.notnull && c.dflt_value === null) row[c.name] = /INT/i.test(c.type) ? NOW + (seqN++) : /REAL|NUM/i.test(c.type) ? 1 : (/_json$/.test(c.name) ? '{}' : `${c.name}-${seqN++}`);
    }
    const k = Object.keys(row);
    db.prepare(`INSERT INTO ${t} (${k.join(',')}) VALUES (${k.map((x) => '@' + x).join(',')})`).run(row);
};
for (const [gid, v] of [['g-small', SECRET_VALUE], ['g-five', 11], ['g-big', 12]]) {
    insertRow(idb, 'cohort_rollups', { scope_type: 'group', scope_id: gid, period: '28d', metric_key: 'active_users', metric_value: v, updated_at: NOW, source_watermark: 1 });
    insertRow(idb, 'cohort_rollups', { scope_type: 'group', scope_id: gid, period: '7d', metric_key: 'active_users', metric_value: v, updated_at: NOW, source_watermark: 1 });
    insertRow(rdb, 'daily_rollups', { scope_type: 'group', scope_id: gid, metric_value: v });
    insertRow(pdb, 'pedagogical_recommendations', { recommendation_id: `rec-${gid}`, scope_type: 'group', scope_id: gid, rule_id: 'r', recommendation_type: 'lectura_guiada', severity: 'high', created_at: NOW, expires_at: NOW + 86_400_000, explanation_json: JSON.stringify({ v }), rule_ids_json: '[]' });
    insertRow(odb, 'institutional_learnings', { scope_type: 'group', scope_id: gid, evidence_json: JSON.stringify({ v }) });
    insertRow(odb, 'cohort_definitions', { cohort_id: `coh-${gid}`, scope_type: 'group', scope_id: gid, criteria_json: '{}' });
    insertRow(odb, 'cohort_trajectories', { cohort_id: `coh-${gid}`, period: '28d', metrics_json: JSON.stringify({ v }), trend_json: '{}', sample_size: gid === 'g-small' ? 3 : 5 });
}
insertRow(idb, 'user_reading_profiles', { user_id: 's-1', abandono_risk: 0.7, engagement_score: 0.2, last_active_at: NOW, updated_at: NOW, source_watermark: 1 });

const app = express();
app.use((req, _res, next) => { const who = req.headers['x-test-session']; if (who) { req.auth = { userId: who, sessionId: 's', authMethod: 'session' }; req.user = { id: who }; } next(); });
const pass1 = (_q, _s, n) => n();
app.use('/api/aula-viva', createOperationalRouter({ requireUserAuth: pass1 }));
app.use('/api/aula-viva', createInstitutionalRouter({ requireUserAuth: pass1 }));
const server = await new Promise((r) => { const s = app.listen(0, () => r(s)); });
const call = (who, p) => new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: server.address().port, method: 'GET', path: '/api/aula-viva' + p, headers: { 'x-test-session': who } }, (res) => {
        let buf = ''; res.on('data', (c) => { buf += c; });
        res.on('end', () => { let b = buf; try { b = JSON.parse(buf); } catch { /* texto */ } resolve({ s: res.statusCode, b, raw: buf }); });
    });
    r.on('error', reject); r.end();
});
const noSecret = (r) => !r.raw.includes(String(SECRET_VALUE)) && !/"size"|"sample_size":3|readerCount/.test(r.raw);

try {
    const small = await call(MED, '/cohorts/group/g-small');
    ok('comparativa de 3 lectores ⇒ 200 suprimida, misma forma', small.s === 200 && small.b.suppressed === true && Array.isArray(small.b.metrics) && small.b.metrics.length === 0, small.raw);
    ok('…sin valores ni tamaño en el cuerpo', noSecret(small) && small.b.minCohort === 5, small.raw);
    ok('filtro de periodo (7d) también suprimido', (await call(MED, '/cohorts/group/g-small?period=7d')).b.suppressed === true);
    const five = await call(MED, '/cohorts/group/g-five');
    ok('comparativa de 5 lectores ⇒ visible con su valor', five.s === 200 && !five.b.suppressed && five.b.metrics.some((m) => m.metric_value === 11), five.raw);
    ok('comparativa de 6 lectores ⇒ visible', (await call(MED, '/cohorts/group/g-big')).b.metrics.some((m) => m.metric_value === 12));
    ok('organización (3+5+6) con un grupo de 3 ⇒ suprimida (org − g-five − g-big = g-small)', (await call(MED, '/cohorts/organization/org-a')).b.suppressed === true);
    const roll = await call(MED, '/cohorts/group/g-small/rollups?sinceTs=0');
    ok('rollups (con filtro sinceTs) de 3 ⇒ suprimidos', roll.b.suppressed === true && roll.b.daily.length === 0 && noSecret(roll), roll.raw);
    ok('rollups de 5 ⇒ visibles', (await call(MED, '/cohorts/group/g-five/rollups?sinceTs=0')).b.daily.length >= 1);
    const recS = await call(MED, '/recommendations/scope/group/g-small');
    ok('recomendaciones de un grupo de 3 ⇒ [] sin pistas', recS.s === 200 && Array.isArray(recS.b) && recS.b.length === 0 && noSecret(recS), recS.raw);
    ok('recomendaciones de 5 ⇒ visibles', (await call(MED, '/recommendations/scope/group/g-five')).b.length === 1);
    const outS = await call(MED, '/institutional/outcomes/scope/group/g-small');
    ok('outcomes de 3 ⇒ suprimidos', outS.s === 200 && outS.b.suppressed === true && outS.b.outcomes.length === 0, outS.raw);
    const lrnS = await call(MED, '/institutional/learnings/scope/group/g-small');
    ok('learnings de 3 ⇒ [] sin pistas', Array.isArray(lrnS.b) && lrnS.b.length === 0 && noSecret(lrnS), lrnS.raw);
    ok('learnings de 5 ⇒ visibles', (await call(MED, '/institutional/learnings/scope/group/g-five')).b.length === 1);
    const trS = await call(MED, '/institutional/cohorts/coh-g-small/trajectory');
    ok('trayectoria de la cohorte de 3 ⇒ suprimida', trS.b.suppressed === true && trS.b.series.length === 0 && noSecret(trS), trS.raw);
    ok('trayectoria de la cohorte de 5 ⇒ visible', (await call(MED, '/institutional/cohorts/coh-g-five/trajectory')).b.series.length === 1);

    const adm = await call('adm', '/cohorts/group/g-small');
    ok('administrador: sin umbral (ve el agregado)', adm.b.metrics.some((m) => m.metric_value === SECRET_VALUE), adm.raw);
    ok('detalle individual (ámbito user) del mediador: no cambia', (await call(MED, '/students/s-1/timeline')).s === 200);

    writeSources(FIVE.slice(0, 4)); // baja de un lector del grupo de 5
    ok('revocación de pertenencia: el grupo baja a 4 ⇒ suprimido en la siguiente petición', (await call(MED, '/cohorts/group/g-five')).b.suppressed === true);
    writeSources();
    ok('…y vuelve a 5 ⇒ visible', !(await call(MED, '/cohorts/group/g-five')).b.suppressed);

    fs.writeFileSync(process.env.GROUPS_DB, '{corrupto');
    const broken = C.cohortDisclosure('group', 'g-five');
    ok('fuentes ilegibles ⇒ fallo cerrado (cohort_unavailable)', broken.allowed === false && broken.reason === 'cohort_unavailable');
    writeSources();
} catch (e) {
    console.error('  ✗ excepción inesperada', e); fail++;
} finally {
    server.close();
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows */ }
}
console.log(`\ncohort disclosure (V8.1-PROD-01 DIR-V81-05): ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
