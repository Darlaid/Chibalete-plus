/**
 * aulaVivaOperationalAuthz.test.mjs — CHP-SEC-AUTHZ-AULA-VIVA-OPERATIONAL-SCOPE-01.
 *
 * QUÉ FIJA ESTA SUITE
 * -------------------
 * En producción (2026-09-23) un mediador de un colegio leyó, del router
 * operacional de Aula Viva, las métricas de cohorte de un grupo de OTRA
 * institución y el vector de rasgos de un estudiante ajeno: de las 17 rutas
 * solo `/students/:userId/timeline` comprobaba alcance. Aquí se fija, sobre el
 * router real y el CIS real (stores temporales), que:
 *
 *   - Aula Viva operacional es superficie de mediador/administrador: lector 403;
 *   - toda ruta con sujeto, grupo o scope pasa por el CIS antes de leer o mutar;
 *   - las escrituras denegadas no dejan rastro;
 *   - la cola de atención del mediador no contiene sujetos ajenos;
 *   - el administrador conserva su alcance global;
 *   - identidad indisponible → 503.
 */
import './helpers/testMode.mjs';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import crypto from 'crypto';
import express from 'express';
import Database from 'better-sqlite3';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_avauthz_'));
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

const USERS = [
    { id: 'adm',   role: 'administrador' },
    { id: 'med-a', role: 'mediador', organizationId: 'org-a' },
    { id: 'med-b', role: 'mediador', organizationId: 'org-b' },
    { id: 'lec-a', role: 'lector',   organizationId: 'org-a' },
    { id: 'lec-b', role: 'lector',   organizationId: 'org-b' },
];
const USERS_JSON = JSON.stringify(USERS);
fs.writeFileSync(process.env.USERS_DB, USERS_JSON);
fs.writeFileSync(process.env.GROUPS_DB, JSON.stringify([
    { id: 'g-a', type: 'course', organizationId: 'org-a', mediatorIds: ['med-a'], memberIds: ['lec-a'] },
    { id: 'g-b', type: 'course', organizationId: 'org-b', mediatorIds: ['med-b'], memberIds: ['lec-b'] },
]));
fs.writeFileSync(process.env.SCHOOLS_DB, JSON.stringify([{ id: 'org-a', name: 'Alfa' }, { id: 'org-b', name: 'Beta' }]));

const insExt = await import('../db/insightsDbExt.mjs');
const pedExt = await import('../db/pedagogyDbExt.mjs');
const rolExt = await import('../db/rollupsDbExt.mjs');
const { createOperationalRouter } = await import('../aulaViva/operationalRouter.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

// ── Siembra de insights/pedagogía para los dos tenants ─────────────────────
const idb = insExt.getInsightsExtDb();
const pdb = pedExt.getPedagogyExtDb();
rolExt.getRollupsExtDb();
const NOW = Date.now();
for (const [u, risk] of [['lec-a', 0.3], ['lec-b', 0.6], ['adm', 0.0]]) {
    idb.prepare(`INSERT INTO user_reading_profiles (user_id, abandono_risk, engagement_score, last_active_at, updated_at, source_watermark)
                 VALUES (?, ?, 0.2, ?, ?, 1)`).run(u, risk, NOW, NOW);
}
// Agregado interinstitucional (todas las instituciones): solo para el administrador.
idb.prepare(`INSERT INTO cohort_rollups (scope_type, scope_id, period, metric_key, metric_value, updated_at, source_watermark)
             VALUES ('all', 'global', '28d', 'active_users', 99, ?, 1)`).run(NOW);
for (const g of ['g-a', 'g-b']) {
    for (const [k, v] of [['reader_cohort', 1], ['active_users', 1]]) {
        idb.prepare(`INSERT INTO cohort_rollups (scope_type, scope_id, period, metric_key, metric_value, updated_at, source_watermark)
                     VALUES ('group', ?, '28d', ?, ?, ?, 1)`).run(g, k, v, NOW);
    }
}
const rec = (id, type, sid, rule, sev = 'high') => pdb.prepare(`INSERT INTO pedagogical_recommendations
    (recommendation_id, scope_type, scope_id, rule_id, recommendation_type, severity, created_at, expires_at, explanation_json, rule_ids_json)
    VALUES (?, ?, ?, ?, 'lectura_guiada', ?, ?, ?, '{}', '[]')`).run(id, type, sid, rule, sev, NOW, NOW + 86_400_000);
rec('rec-a', 'user', 'lec-a', 'r1'); rec('rec-a2', 'user', 'lec-a', 'r2', 'critical');
rec('rec-b', 'user', 'lec-b', 'r1'); rec('rec-b2', 'user', 'lec-b', 'r2', 'critical');
rec('rec-gb', 'group', 'g-b', 'r3');
pdb.prepare(`INSERT INTO pedagogical_interventions (intervention_id, teacher_id, student_id, intervention_type, created_at)
             VALUES ('int-b', 'med-b', 'lec-b', 'lectura_guiada', ?)`).run(NOW);
pdb.prepare(`INSERT INTO pedagogical_interventions (intervention_id, teacher_id, student_id, intervention_type, created_at)
             VALUES ('int-a', 'med-a', 'lec-a', 'lectura_guiada', ?)`).run(NOW);

// Huella de las tablas que las escrituras podrían tocar.
const digest = () => crypto.createHash('sha256').update(JSON.stringify([
    pdb.prepare('SELECT * FROM pedagogical_recommendations ORDER BY recommendation_id').all(),
    pdb.prepare('SELECT * FROM pedagogical_interventions ORDER BY intervention_id').all(),
])).digest('hex');

// ── App: router real con un stub que emula la sesión firmada ───────────────
const app = express();
app.use((req, _res, next) => {
    const who = req.headers['x-test-session'];
    if (who) { req.auth = { userId: who, sessionId: 's', authMethod: 'session' }; req.user = { id: who }; }
    next();
});
app.use('/api/aula-viva', createOperationalRouter({ requireUserAuth: (_q, _s, n) => n() }));
const server = await new Promise(r => { const s = app.listen(0, () => r(s)); });
const call = (who, method, p, body) => new Promise((resolve, reject) => {
    const d = body ? JSON.stringify(body) : null;
    const r = http.request({ host: '127.0.0.1', port: server.address().port, method, path: '/api/aula-viva' + p,
        headers: { 'Content-Type': 'application/json', ...(who ? { 'x-test-session': who } : {}),
            ...(d ? { 'Content-Length': Buffer.byteLength(d) } : {}) } }, (res) => {
        let buf = ''; res.on('data', c => buf += c);
        res.on('end', () => { let b = buf; try { b = JSON.parse(buf); } catch {} resolve({ s: res.statusCode, b }); });
    });
    r.on('error', reject); if (d) r.write(d); r.end();
});

// Las 17 rutas, con su objetivo del tenant A (propio) y B (ajeno).
const ROUTES = (t) => [
    ['GET',   `/students/${t.u}/timeline`],
    ['GET',   `/students/${t.u}/feature-vector`],
    ['GET',   `/students/${t.u}/risk-history`],
    ['GET',   `/students/${t.u}/signals/continuidad_semanal/timeline`],
    ['GET',   `/recommendations/scope/user/${t.u}`],
    ['GET',   `/recommendations/scope/group/${t.g}`],
    ['GET',   `/cohorts/group/${t.g}`],
    ['GET',   `/cohorts/group/${t.g}/rollups`],
];
const A = { u: 'lec-a', g: 'g-a' }, B = { u: 'lec-b', g: 'g-b' };

try {
    section('[A8] LECTOR → 403 en TODA la superficie operacional (también sobre sí mismo)');
    {
        const all = [...ROUTES(A),
            ['GET', '/recommendations'], ['GET', '/students-needing-attention'], ['GET', '/job-ledger'],
            ['GET', '/operational/status'], ['POST', '/recommendations/rec-a/ack'], ['POST', '/recommendations/rec-a/dismiss'],
            ['POST', '/interventions'], ['PATCH', '/interventions/int-a/outcome'],
            ['POST', '/_track/empty-state'], ['POST', '/_track/degraded-mode']];
        const before = digest();
        for (const [m, p] of all) {
            const r = await call('lec-a', m, p, m === 'GET' ? null
                : p.includes('outcome') ? { outcome: 'improved' } : { studentId: 'lec-a', interventionType: 'lectura_guiada' });
            ok(`lector ${m} ${p} → 403`, r.s === 403, `${r.s} ${JSON.stringify(r.b)}`);
        }
        ok('   las escrituras del lector no dejaron rastro', digest() === before);
        ok('sin sesión → 401', (await call(null, 'GET', '/operational/status')).s === 401);
    }

    section('[A1/A3] MEDIADOR A → su propio tenant: permitido');
    for (const [m, p] of ROUTES(A)) {
        const r = await call('med-a', m, p);
        ok(`med-a ${m} ${p} → 200`, r.s === 200, `${r.s} ${JSON.stringify(r.b).slice(0, 120)}`);
    }

    section('[A2/A4/A5] MEDIADOR A → tenant B: 403 en todas las rutas con objetivo');
    for (const [m, p] of ROUTES(B)) {
        const r = await call('med-a', m, p);
        ok(`med-a ${m} ${p} → 403`, r.s === 403, `${r.s} ${JSON.stringify(r.b).slice(0, 120)}`);
        ok('   sin datos del ajeno en el cuerpo', !JSON.stringify(r.b).includes('0.6') && !JSON.stringify(r.b).includes('rec-b'));
    }
    {
        const r = await call('med-a', 'GET', '/cohorts/organization/org-b');
        ok('med-a → cohorte de la organización B → 403', r.s === 403, String(r.s));
        // CHP-SEC-AUTHZ-AULA-VIVA-AGGREGATE-SCOPE-02: el agregado interinstitucional
        // ya no es del mediador (antes lo concedía mediator_aggregate_read).
        const g = await call('med-a', 'GET', '/cohorts/all/global');
        ok('med-a → agregado all/global → 403', g.s === 403, String(g.s));
    }

    section('[A6/§13] ESCRITURAS cross-tenant: 403 y CERO efectos');
    {
        const before = digest();
        const w = [
            ['POST', '/recommendations/rec-b/ack', { applied: true }],
            ['POST', '/recommendations/rec-b/dismiss', {}],
            ['POST', '/recommendations/rec-gb/ack', {}],
            ['POST', '/interventions', { studentId: 'lec-b', interventionType: 'lectura_guiada', notes: 'x' }],
            ['PATCH', '/interventions/int-b/outcome', { outcome: 'worsened' }],
        ];
        for (const [m, p, b] of w) {
            const r = await call('med-a', m, p, b);
            ok(`med-a ${m} ${p} (tenant B) → 403`, r.s === 403, `${r.s} ${JSON.stringify(r.b)}`);
            // Solo cuando el scope se DERIVA del store (ack/dismiss/outcome):
            // en POST /interventions el studentId lo envió el propio cliente.
            if (p !== '/interventions') {
                ok('   el 403 no revela a quién pertenece el id', !JSON.stringify(r.b).includes('lec-b') && !JSON.stringify(r.b).includes('g-b'));
            }
        }
        ok('AULA_VIVA_DENIED_WRITE_SIDE_EFFECTS = 0 (recomendaciones e intervenciones intactas)', digest() === before);
        const ghost = await call('med-a', 'POST', '/recommendations/rec-que-no-existe/ack', {});
        const foreign = await call('med-a', 'POST', '/recommendations/rec-b/ack', {});
        ok('id inexistente y ajeno → misma respuesta (sin oráculo)', ghost.s === foreign.s && JSON.stringify(ghost.b) === JSON.stringify(foreign.b));
        const gi = await call('med-a', 'PATCH', '/interventions/int-inexistente/outcome', { outcome: 'improved' });
        const fi = await call('med-a', 'PATCH', '/interventions/int-b/outcome', { outcome: 'improved' });
        ok('intervención inexistente y ajena → misma respuesta', gi.s === fi.s && JSON.stringify(gi.b) === JSON.stringify(fi.b));
        ok('validación de cuerpo previa intacta (400 sin studentId)', (await call('med-a', 'POST', '/interventions', {})).s === 400);
    }

    section('[A1] ESCRITURAS propias del mediador A: permitidas');
    {
        const ack = await call('med-a', 'POST', '/recommendations/rec-a/ack', { applied: false });
        ok('med-a ack de recomendación propia → 200', ack.s === 200, JSON.stringify(ack.b));
        const intv = await call('med-a', 'POST', '/interventions', { studentId: 'lec-a', interventionType: 'lectura_guiada' });
        ok('med-a intervención sobre su alumno → 200', intv.s === 200 && intv.b?.ok === true, JSON.stringify(intv.b));
        const out = await call('med-a', 'PATCH', '/interventions/int-a/outcome', { outcome: 'improved' });
        ok('med-a cierra su intervención → 200, updated=1', out.s === 200 && out.b?.updated === 1, JSON.stringify(out.b));
    }

    section('[A7] COLA DE ATENCIÓN del mediador: sin sujetos ajenos ni cuentas globales');
    {
        const r = await call('med-a', 'GET', '/students-needing-attention');
        const ids = (r.b || []).map(x => x.user_id);
        ok('200', r.s === 200);
        ok('contiene a su alumno', ids.includes('lec-a'), ids.join(','));
        ok('FOREIGN_STUDENTS_IN_ATTENTION = 0', !ids.includes('lec-b'), ids.join(','));
        ok('la cuenta administradora no aparece al mediador', !ids.includes('adm'), ids.join(','));
        const rb = await call('med-b', 'GET', '/students-needing-attention');
        ok('simétrico: med-b solo ve a lec-b', JSON.stringify((rb.b || []).map(x => x.user_id)) === '["lec-b"]', JSON.stringify(rb.b));
    }

    section('[§10] ESTADO OPERACIONAL: el resumen se acota al scope del mediador');
    {
        const a = await call('med-a', 'GET', '/operational/status');
        ok('med-a → 200', a.s === 200);
        // Tras el ack de rec-a, a med-a le queda rec-a2 (critical); rec-b/rec-b2/rec-gb son ajenas.
        ok('med-a cuenta solo lo suyo (critical=1, high=0)', a.b?.recommendations_summary?.critical === 1
            && a.b?.recommendations_summary?.high === 0, JSON.stringify(a.b?.recommendations_summary));
        const ad = await call('adm', 'GET', '/operational/status');
        ok('admin conserva el resumen global (critical=2, high=2)', ad.b?.recommendations_summary?.critical === 2
            && ad.b?.recommendations_summary?.high === 2, JSON.stringify(ad.b?.recommendations_summary));
    }

    section('[AGGREGATE-SCOPE-02] el mediador no ve agregados interinstitucionales');
    {
        for (const p of ['/cohorts/all/global', '/cohorts/all/global/rollups', '/cohorts/risk/any',
                         '/recommendations/scope/all/global']) {
            const r = await call('med-a', 'GET', p);
            ok(`A1 · med-a ${p} → 403`, r.s === 403, `${r.s} ${JSON.stringify(r.b)}`);
            ok('   sin el valor global en el cuerpo', !JSON.stringify(r.b).includes('99'));
        }
        const own = await call('med-a', 'GET', '/cohorts/group/g-a');
        ok('A2 · med-a cohorte propia → 200 con sus métricas', own.s === 200
            && (own.b?.metrics || []).some(m => m.metric_key === 'active_users'), JSON.stringify(own.b));
        ok('A6 · la cohorte propia NO trae baseline global (ni se lee)',
            Array.isArray(own.b?.global_baseline) && own.b.global_baseline.length === 0
            && (own.b?.metrics || []).every(m => m.global_value === null && m.delta_vs_global === null)
            && !JSON.stringify(own.b).includes('99'), JSON.stringify(own.b));
        ok('A3 · med-a cohorte del grupo B → 403', (await call('med-a', 'GET', '/cohorts/group/g-b')).s === 403);
        const adm = await call('adm', 'GET', '/cohorts/all/global');
        ok('A4 · admin all/global → 200 con el agregado', adm.s === 200
            && (adm.b?.metrics || []).some(m => m.metric_key === 'active_users' && m.metric_value === 99), JSON.stringify(adm.b));
        const admG = await call('adm', 'GET', '/cohorts/group/g-a');
        ok('   admin conserva el baseline global en la comparativa', (admG.b?.global_baseline || []).some(m => m.metric_value === 99), JSON.stringify(admG.b));
        ok('A5 · lector → agregado → 403', (await call('lec-a', 'GET', '/cohorts/all/global')).s === 403);
    }
    {
        // A7 · la UI del mediador ya no pide all/global (solo el administrador).
        const src = fs.readFileSync(new URL('../../pages/AulaVivaOperacional.tsx', import.meta.url), 'utf8');
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        ok('A7 · Centro operativo: all/global solo bajo isAdmin(user)',
            /isAdmin\(user\)\s*\?\s*\['all', 'global'\]/.test(code)
            && (code.match(/'all', 'global'/g) || []).length === 1, 'patrón no encontrado');
        ok('A7 · el mediador pide la cohorte de su grupo',
            code.includes("['group', mediated[0]]") && code.includes('getCohortComparison(scope[0], scope[1])'));
    }

    section('[§9/E] AGREGADOS GLOBALES sin consumidor → solo administrador');
    for (const p of ['/recommendations', '/job-ledger']) {
        ok(`med-a ${p} → 403`, (await call('med-a', 'GET', p)).s === 403);
        ok(`adm ${p} → 200`, (await call('adm', 'GET', p)).s === 200);
    }

    section('[A9] ADMINISTRADOR: contrato global intacto');
    {
        for (const [m, p] of [...ROUTES(A), ...ROUTES(B)]) {
            ok(`adm ${m} ${p} → 200`, (await call('adm', m, p)).s === 200);
        }
        const q = await call('adm', 'GET', '/students-needing-attention');
        ok('admin ve la cola global (incluye ambos tenants)', ['lec-a', 'lec-b'].every(u => (q.b || []).some(x => x.user_id === u)), JSON.stringify(q.b));
        const ghost = await call('adm', 'POST', '/recommendations/rec-que-no-existe/ack', {});
        ok('admin: id inexistente conserva el camino previo (no 403)', ghost.s !== 403, String(ghost.s));
    }

    section('[A10] IDENTIDAD INDISPONIBLE → 503, nunca allow ni deny silencioso');
    {
        fs.writeFileSync(process.env.USERS_DB, '{ esto no es json');
        try {
            const before = digest();
            const r1 = await call('med-a', 'GET', `/students/${A.u}/feature-vector`);
            ok('padrón ilegible → 503 en lectura', r1.s === 503 && r1.b?.error === 'identity_unavailable', `${r1.s} ${JSON.stringify(r1.b)}`);
            const r2 = await call('med-a', 'POST', '/recommendations/rec-a2/dismiss', {});
            ok('padrón ilegible → 503 en escritura', r2.s === 503, `${r2.s} ${JSON.stringify(r2.b)}`);
            const r3 = await call('med-a', 'GET', '/students-needing-attention');
            ok('padrón ilegible → 503 en la cola', r3.s === 503, `${r3.s} ${JSON.stringify(r3.b)}`);
            ok('   sin escrituras', digest() === before);
        } finally {
            fs.writeFileSync(process.env.USERS_DB, USERS_JSON);
        }
    }
} catch (e) {
    console.error('\n  ✗ error fatal:', e.message, e.stack); fail++;
} finally {
    server.close();
    try { insExt.closeInsightsExtDb?.(); pedExt.closePedagogyExtDb?.(); rolExt.closeRollupsExtDb?.(); } catch { /* noop */ }
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows retiene a veces */ }
    console.log(`\naulaVivaOperationalAuthz: ${pass} passed, ${fail} failed`);
    process.exit(fail === 0 ? 0 : 1);
}
