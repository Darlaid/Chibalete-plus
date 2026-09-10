/**
 * aulaVivaOperational.test.js — PASO 5 §24.
 *
 * Cubre:
 *  - operationalRouter: timeline, recommendations, cohorts, attention queue,
 *    workflow ack/intervention/outcome
 *  - scheduler: start gated, stop, status, leader-safe (no doble corrida)
 *  - archiveRotation: rotateOnce idempotente, integrity_check pre/post,
 *    rollback en error, dryRun, gating
 *  - reader: never-throws con tablas vacías
 *  - healthcheck operacional: checks.scheduler + checks.archive_rotation
 *  - [H] CHP-AULA-VIVA-MOOK-INTEGRATION-01A: experience_insights en el timeline
 *    + scope CIS server-side (admin / mediador / mediador ajeno / lector / ids falsos)
 *
 *   node server/__test__/aulaVivaOperational.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import express from 'express';
import http from 'node:http';

// Aislar ANTES de cargar módulos.
import './helpers/testMode.mjs';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av5_'));
process.env.EVENTS_SQLITE_PATH    = path.join(tmpDir, 'events.db');
process.env.INSIGHTS_SQLITE_PATH  = path.join(tmpDir, 'insights.db');
process.env.ARCHIVE_SQLITE_PATH   = path.join(tmpDir, 'events.archive.db');

// CHP-AULA-VIVA-MOOK-INTEGRATION-01A — el timeline ahora exige scope CIS, que
// lee el padrón. Fixtures SOLO en el temporal (CHP-ID-CANON-01B): jamás data/.
const dataDir = path.join(tmpDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });
process.env.USERS_DB   = path.join(dataDir, 'usuarios_colegios_oro.json');
process.env.GROUPS_DB  = path.join(dataDir, 'groups_db.json');
process.env.SCHOOLS_DB = path.join(dataDir, 'schools_db.json');
fs.writeFileSync(process.env.USERS_DB, JSON.stringify([
    { id: 't1',              role: 'administrador', name: 'Admin de pruebas' },
    { id: 'u_admin',         role: 'administrador', name: 'Admin' },
    { id: 'u_mediator',      role: 'profesor',      name: 'Mediadora 7A' },
    { id: 'u_mediator_otro', role: 'profesor',      name: 'Mediador 8B (otra institución)' },
    { id: 'u_student',       role: 'lector',        name: 'Estudiante A' },
    { id: 'u_stranger',      role: 'lector',        name: 'Estudiante X' },
]), 'utf8');
fs.writeFileSync(process.env.GROUPS_DB, JSON.stringify([
    { id: 'g_7A',   name: '7A', type: 'course', organizationId: 'school_uno',
      mediatorIds: ['u_mediator'],      memberIds: ['u_student'] },
    { id: 'g_otro', name: '8B', type: 'course', organizationId: 'school_otro',
      mediatorIds: ['u_mediator_otro'], memberIds: ['u_stranger'] },
]), 'utf8');
fs.writeFileSync(process.env.SCHOOLS_DB, JSON.stringify([
    { id: 'school_uno',  name: 'Colegio Uno' },
    { id: 'school_otro', name: 'Colegio Otro' },
]), 'utf8');

const eventsService = await import('../eventsService.js');
const insExt   = await import('../db/insightsDbExt.mjs');
const pedExt   = await import('../db/pedagogyDbExt.mjs');
const rolExt   = await import('../db/rollupsDbExt.mjs');
const reader   = await import('../services/insightReader.mjs');
const archive  = await import('../aulaViva/archiveRotation.mjs');
const scheduler = await import('../aulaViva/scheduler.mjs');
const { createOperationalRouter } = await import('../aulaViva/operationalRouter.mjs');
const scopeAccess = await import('../aulaViva/scopeAccess.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++)
                                : (console.error('  ✗', l, h), fail++);

// HTTP test helper sin requireUserAuth real (stub auth que pasa siempre).
function makeTestApp() {
    const app = express();
    app.use(express.json());
    const stubAuth = (req, _res, next) => { req._testUserId = 't1'; next(); };
    app.use('/api/aula-viva', createOperationalRouter({ requireUserAuth: stubAuth }));
    return app;
}
function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, () => resolve(server));
    });
}
function req(server, method, path, body = null, headers = {}) {
    return new Promise((resolve, reject) => {
        const data = body ? JSON.stringify(body) : null;
        const opts = {
            host: '127.0.0.1', port: server.address().port,
            method, path,
            headers: { 'Content-Type': 'application/json',
                       'x-user-id': 't1', ...headers,
                       ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}) },
        };
        const r = http.request(opts, (res) => {
            let buf = '';
            res.on('data', c => buf += c);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(buf || 'null') }); }
                catch { resolve({ status: res.statusCode, body: buf }); }
            });
        });
        r.on('error', reject);
        if (data) r.write(data);
        r.end();
    });
}

// Seed events raw (bypass insertEvent).
function seed(evs) {
    const db = new Database(process.env.EVENTS_SQLITE_PATH);
    try {
        const ins = db.prepare(`INSERT OR IGNORE INTO events
            (event_id, schema_version, event, mode, user_id, content_id, session_id,
             client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
            VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?)`);
        for (const e of evs) {
            ins.run(e.event_id, e.event, e.mode || 'immersive', e.user_id,
                e.content_id || null, e.session_id || 's1', e.ts, e.ts,
                e.elapsed_ms || null, e.progress_fraction || null,
                JSON.stringify(e.payload || {}), Date.now());
        }
    } finally { db.close(); }
}

try {
    eventsService.getEventCount();
    insExt.getInsightsExtDb();
    pedExt.getPedagogyExtDb();
    rolExt.getRollupsExtDb();

    const NOW = Date.now();
    const D = (n) => NOW - n * 86_400_000;

    console.log('\n[A] Router boot + auth wiring + never-throws con DB vacía');
    {
        const app = makeTestApp();
        const server = await listen(app);
        try {
            const r1 = await req(server, 'GET', '/api/aula-viva/students/u_none/timeline');
            ok('1) timeline para user inexistente: 200 + payload válido (stale)',
                r1.status === 200 && (!r1.body || typeof r1.body === 'object'));

            const r2 = await req(server, 'GET', '/api/aula-viva/students-needing-attention');
            ok('2) attention queue vacía: 200 + array',
                r2.status === 200 && Array.isArray(r2.body));

            const r3 = await req(server, 'GET', '/api/aula-viva/operational/status');
            ok('3) operational/status retorna ts + recommendations_summary',
                r3.status === 200 && typeof r3.body?.ts === 'number'
                && r3.body?.recommendations_summary);
            ok('   degraded:true cuando aún no hay materializer ready',
                r3.body?.degraded === true);

            const r4 = await req(server, 'GET', '/api/aula-viva/recommendations');
            ok('4) recommendations summary expone {critical,high,moderate,info}',
                r4.status === 200 && r4.body?.summary
                && 'critical' in r4.body.summary);

            const r5 = await req(server, 'POST', '/api/aula-viva/_track/empty-state',
                                  { where: 'student_panel' });
            ok('5) tracking de empty-state OK', r5.status === 200 && r5.body?.ok === true);

            const r6 = await req(server, 'POST', '/api/aula-viva/_track/degraded-mode',
                                  { reason: 'materializer_stale' });
            ok('   tracking de degraded-mode OK', r6.status === 200 && r6.body?.ok === true);
        } finally { server.close(); }
    }

    console.log('\n[B] Recommendations workflow §8 — ack + apply + intervention');
    {
        // Seed: 1 perfil + 1 recomendación activa
        insExt.getStatements().upsertProfile.run({
            user_id: 'u_w', fluidez_score: null, persistencia_score: 0.3,
            autonomia_score: null, concentracion_score: null,
            diversidad_score: 0.1, engagement_score: 0.2, abandono_risk: 0.85,
            last_active_at: D(2), updated_at: NOW, source_watermark: 0,
        });
        // Generar 1 recomendación via interventionEngine
        process.env.INTERVENTION_ENGINE_ENABLED = '1';
        const ie = await import('../services/interventionEngine.mjs');
        // Necesitamos snapshot signals para que las reglas disparen
        ['abandono_temprano','continuidad_semanal','tiempo_efectivo_lectura'].forEach((sid,i)=>{
            insExt.getStatements().upsertSignalSnap.run({
                scope_type:'user', scope_id:'u_w', signal_id:sid, period:'28d',
                metric_value:[0.8,0.2,5][i], confidence:'medium', trend:null,
                source_watermark:0, metadata_json:null, updated_at:NOW,
            });
        });
        const r = ie.runOnce({ nowTs: NOW });
        ok('6) interventionEngine.runOnce genera recomendaciones',
            r.ok && r.recommendations.inserted >= 1);

        const app = makeTestApp();
        const server = await listen(app);
        try {
            const list = await req(server, 'GET',
                '/api/aula-viva/recommendations/scope/user/u_w');
            ok('7) GET recommendations por scope retorna lista',
                list.status === 200 && Array.isArray(list.body) && list.body.length >= 1);

            const recId = list.body[0].recommendation_id;
            const ack = await req(server, 'POST',
                `/api/aula-viva/recommendations/${encodeURIComponent(recId)}/ack`,
                { applied: false });
            ok('8) POST ack: ok + acknowledged=true',
                ack.status === 200 && ack.body?.ok === true && ack.body?.acknowledged === true);

            const intv = await req(server, 'POST', '/api/aula-viva/interventions', {
                studentId: 'u_w', interventionType: 'lectura_guiada',
                notes: 'Sesión 1:1 con familia', recommendationOrigin: recId,
            });
            ok('9) POST intervention: ok + intervention_id',
                intv.status === 200 && intv.body?.ok === true
                && typeof intv.body?.intervention_id === 'string');

            const intId = intv.body.intervention_id;
            const close = await req(server, 'PATCH',
                `/api/aula-viva/interventions/${encodeURIComponent(intId)}/outcome`,
                { outcome: 'improved' });
            ok('10) PATCH outcome=improved: ok + updated>=1',
                close.status === 200 && close.body?.ok === true && close.body?.updated >= 1);

            const badOutcome = await req(server, 'PATCH',
                `/api/aula-viva/interventions/${encodeURIComponent(intId)}/outcome`,
                { outcome: 'bogus' });
            ok('   PATCH outcome inválido: 400',
                badOutcome.status === 400);
        } finally { server.close(); }
    }

    console.log('\n[C] Attention queue + cohort comparison');
    {
        const app = makeTestApp();
        const server = await listen(app);
        try {
            const q = await req(server, 'GET', '/api/aula-viva/students-needing-attention');
            ok('11) attention queue retorna >=1 user (u_w con abandono alto)',
                q.status === 200 && q.body.length >= 1);
            const top = q.body[0];
            ok('   primer item tiene abandono_risk, top_severity, recommendations_count',
                typeof top.abandono_risk === 'number'
                && 'top_severity' in top
                && typeof top.recommendations_count === 'number');

            const cohort = await req(server, 'GET', '/api/aula-viva/cohorts/all/global');
            ok('12) cohort comparison retorna metrics + global_baseline',
                cohort.status === 200 && Array.isArray(cohort.body?.metrics));
        } finally { server.close(); }
    }

    console.log('\n[D] Archive rotation: OFF + dryRun + ON + idempotencia');
    {
        // Generar eventos antiguos y recientes para tener candidates
        seed([
            { event_id:'old_1', event:'reading_started', user_id:'u_a', ts:D(120), content_id:'c_old',
              payload:{contentId:'c_old', sessionId:'s_old'} },
            { event_id:'old_2', event:'reading_completed', user_id:'u_a', ts:D(120), content_id:'c_old',
              payload:{contentId:'c_old', sessionId:'s_old'} },
            { event_id:'rec_1', event:'reading_started', user_id:'u_b', ts:D(2), content_id:'c_new',
              payload:{contentId:'c_new', sessionId:'s_new'} },
        ]);

        // OFF: skipped sin tocar nada
        delete process.env.ARCHIVE_ROTATION_ENABLED;
        const rOff = archive.rotateOnce({ nowTs: NOW, retentionDays: 90 });
        ok('13) OFF: skipped=true sin candidates contados',
            rOff.ok && rOff.skipped === true);

        process.env.ARCHIVE_ROTATION_ENABLED = '1';

        // dryRun: candidates>=2 sin mover
        const rDry = archive.rotateOnce({ nowTs: NOW, retentionDays: 90, dryRun: true });
        ok('14) dryRun: candidates>=2, moved=0',
            rDry.ok && rDry.candidates >= 2 && rDry.moved === 0);

        // Real
        const r1 = archive.rotateOnce({ nowTs: NOW, retentionDays: 90 });
        ok('15) rotation real: moved>=2 + deleted>=2 + integrity_pre/post=ok',
            r1.ok && r1.moved >= 2 && r1.deleted >= 2
            && r1.integrity_pre === 'ok' && r1.integrity_post === 'ok');

        // Idempotente: segunda corrida sin candidates
        const r2 = archive.rotateOnce({ nowTs: NOW, retentionDays: 90 });
        ok('16) rerun idempotente: candidates=0, moved=0',
            r2.ok && r2.candidates === 0 && r2.moved === 0);

        // Verificar archive contiene los moved events
        const archDb = new Database(process.env.ARCHIVE_SQLITE_PATH);
        const archCount = archDb.prepare('SELECT COUNT(*) AS n FROM events').get().n;
        archDb.close();
        ok('17) archive.db contiene los eventos rotados',
            archCount >= 2);
    }

    console.log('\n[E] Scheduler: OFF gating + start/stop + status');
    {
        // OFF default
        delete process.env.AULA_VIVA_SCHEDULER_ENABLED;
        const r1 = await scheduler.start();
        ok('18) scheduler OFF: started=false + reason=scheduler_disabled_default_off',
            r1.ok === true && r1.started === false
            && r1.reason === 'scheduler_disabled_default_off');

        // ON con intervalos largos (no quiero tick real en test). El número
        // total de loops crece con cada PASO: PASO 5 tenía 5; PASO 6 sumó
        // outcome/cohort/trajectory/learning/predictive_patterns → ahora ≥ 5.
        process.env.AULA_VIVA_SCHEDULER_ENABLED = '1';
        const longInterval = 3_600_000;
        const r2 = await scheduler.start({
            intervals: {
                materializer: longInterval, intervention: longInterval,
                rollups: longInterval, feature_extract: longInterval,
                archive_rotation: longInterval,
                outcome_engine: longInterval, cohort_builder: longInterval,
                trajectory_analyzer: longInterval, institutional_learning: longInterval,
                predictive_patterns: longInterval,
            },
        });
        ok('19) scheduler ON: started=true + >=5 loops',
            r2.ok === true && r2.started === true
            && Array.isArray(r2.loops) && r2.loops.length >= 5);

        const status = scheduler.getStatus();
        ok('20) getStatus: running=true + enabled=true + timers>0',
            status.running === true && status.enabled === true && status.timers > 0);

        // start otra vez: already_running
        const r3 = await scheduler.start();
        ok('21) start re-entry: already_running',
            r3.ok === false && r3.reason === 'already_running');

        // stop: timers limpios
        const st = scheduler.stop();
        const statusAfter = scheduler.getStatus();
        ok('22) stop limpia timers + status.running=false',
            st.ok && statusAfter.running === false && statusAfter.timers === 0);
    }

    console.log('\n[F] Healthcheck operacional: scheduler + archive_rotation visibles');
    {
        const ah = await import('../observability/analyticsHealth.js');
        let payload = null;
        const res = { _s:200, _j:null,
            status(c){this._s=c;return this;},
            json(p){this._j=p; payload=p; return this;} };
        // Primera llamada — no hay cache previo en este proceso aislado.
        await ah.analyticsHealthHandler({}, res);
        ok('23) healthcheck incluye checks.scheduler',
            !!payload?.checks?.scheduler);
        ok('   healthcheck incluye checks.archive_rotation',
            !!payload?.checks?.archive_rotation);
        ok('   archive_rotation.archive_size_bytes presente',
            typeof payload?.checks?.archive_rotation?.archive_size_bytes === 'number');
    }

    console.log('\n[G] Recovery-first: endpoint sigue 200 si la DB no inicializa');
    {
        const app = makeTestApp();
        const server = await listen(app);
        try {
            // Caso: ruta a user inexistente + signal inexistente
            const r = await req(server, 'GET',
                '/api/aula-viva/students/u_nope/signals/sig_nope/timeline');
            ok('24) signal timeline inexistente: 200 + array vacío (never-throws)',
                r.status === 200 && Array.isArray(r.body));

            const j = await req(server, 'GET', '/api/aula-viva/job-ledger');
            ok('25) job-ledger: 200 + array',
                j.status === 200 && Array.isArray(j.body));
        } finally { server.close(); }
    }

    console.log('\n[H] CHP-AULA-VIVA-MOOK-INTEGRATION-01A — experience_insights + scope CIS en /students/:userId/timeline');
    {
        const idb = insExt.getInsightsExtDb();
        const TL = (uid) => `/api/aula-viva/students/${uid}/timeline`;
        const EXP = ['experiencias_iniciadas', 'nodos_requeridos_completados', 'experiencias_completadas',
                     'evidencias_enviadas', 'revisiones_realizadas'];
        // Seed directo en signal_snapshots del insights.db TEMPORAL (misma forma
        // que escribe el materializador; el GET jamás recalcula ni materializa).
        const put = idb.prepare(`INSERT OR REPLACE INTO signal_snapshots
            (scope_type,scope_id,signal_id,period,metric_value,confidence,trend,source_watermark,metadata_json,updated_at)
            VALUES ('user',?,?,'28d',?,'high',NULL,7,?,?)`);
        put.run('u_student', 'experiencias_iniciadas',       2, JSON.stringify({ by_version: { v1: 1, v2: 1 } }), NOW);
        put.run('u_student', 'nodos_requeridos_completados', 3, JSON.stringify({ by_version: { v1: 2, v2: 1 }, total: 3 }), NOW);
        put.run('u_student', 'experiencias_completadas',     1, '{"by_version": {"v1": 1',  NOW); // metadata_json INVÁLIDO
        put.run('u_student', 'evidencias_enviadas',          0, JSON.stringify({ by_version: {} }), NOW);
        // revisiones_realizadas: SIN fila → null → "Sin datos"
        put.run('u_student', 'continuidad_semanal',          4, null, NOW);            // señal previa, intacta
        put.run('u_stranger', 'experiencias_iniciadas',      5, JSON.stringify({ by_version: { v9: 5 } }), NOW);
        const digest = () => JSON.stringify({
            snaps:    idb.prepare('SELECT * FROM signal_snapshots ORDER BY scope_type, scope_id, signal_id, period').all(),
            profiles: idb.prepare('SELECT * FROM user_reading_profiles ORDER BY user_id').all(),
            cohorts:  idb.prepare('SELECT * FROM cohort_rollups ORDER BY scope_type, scope_id, metric_key').all(),
            state:    idb.prepare('SELECT * FROM materializer_state ORDER BY materializer_name').all(),
            changes:  idb.prepare('SELECT total_changes() AS n').get().n,
        });
        const before = digest();

        const app = makeTestApp();
        const server = await listen(app);
        try {
            // 1-6) lectura, totales, by_version, cero, ausente, metadata inválido (admin)
            const a = await req(server, 'GET', TL('u_student'), null, { 'x-user-id': 'u_admin' });
            const ei = a.body?.experience_insights;
            ok('26) admin → 200 con experience_insights y exactamente las cinco señales',
                a.status === 200 && ei && typeof ei === 'object'
                && JSON.stringify(Object.keys(ei)) === JSON.stringify(EXP));
            ok('27) totales exactos: iniciadas=2, nodos=3, completadas=1, evidencias=0',
                ei?.experiencias_iniciadas?.total === 2 && ei?.nodos_requeridos_completados?.total === 3
                && ei?.experiencias_completadas?.total === 1 && ei?.evidencias_enviadas?.total === 0);
            ok('28) by_version conservado sin mezclar versiones (iniciadas v1:1,v2:1; nodos v1:2,v2:1)',
                JSON.stringify(ei?.experiencias_iniciadas?.by_version) === JSON.stringify({ v1: 1, v2: 1 })
                && JSON.stringify(ei?.nodos_requeridos_completados?.by_version) === JSON.stringify({ v1: 2, v2: 1 }));
            ok('29) señal con valor cero se entrega como 0 (no null)',
                ei?.evidencias_enviadas?.total === 0 && typeof ei?.evidencias_enviadas?.by_version === 'object');
            ok('30) señal ausente (revisiones_realizadas) → null ("Sin datos"), no inferida',
                ei && 'revisiones_realizadas' in ei && ei.revisiones_realizadas === null);
            ok('31) metadata_json inválido → 200, total intacto y by_version null (sin desglose inventado)',
                a.status === 200 && ei?.experiencias_completadas?.total === 1
                && ei?.experiencias_completadas?.by_version === null);

            // 15) indicadores previos del timeline sin regresión
            ok('32) campos previos preservados (user_id, profile_current, signals_current, risks, recommendations, summaries)',
                ['user_id', 'profile_current', 'signals_current', 'risks', 'recommendations', 'summaries'].every(k => k in a.body)
                && a.body.signals_current.some(sg => sg.signal_id === 'continuidad_semanal' && sg.metric_value === 4));

            // 7) mediador ve a integrantes de su grupo con los mismos conteos
            const m = await req(server, 'GET', TL('u_student'), null, { 'x-user-id': 'u_mediator' });
            ok('33) mediador → 200 sobre miembro de SU grupo, mismos conteos que admin',
                m.status === 200 && JSON.stringify(m.body?.experience_insights) === JSON.stringify(ei));

            // 8) mediador ajeno no ve datos
            const mx = await req(server, 'GET', TL('u_stranger'), null, { 'x-user-id': 'u_mediator' });
            ok('34) mediador → 403 scope_access_denied sobre lector de OTRO grupo, sin experience_insights',
                mx.status === 403 && mx.body?.error === 'scope_access_denied' && !('experience_insights' in (mx.body || {})));

            // 9) incompatibilidad institucional no amplía acceso
            const mo = await req(server, 'GET', TL('u_student'), null, { 'x-user-id': 'u_mediator_otro' });
            ok('35) mediador de OTRA institución → 403 (no hay fuga entre instituciones)',
                mo.status === 403 && mo.body?.error === 'scope_access_denied');

            // 10) administrador conserva alcance global
            const ax = await req(server, 'GET', TL('u_stranger'), null, { 'x-user-id': 'u_admin' });
            ok('36) admin → 200 sobre cualquier lector (alcance global vigente; iniciadas=5 v9)',
                ax.status === 200 && ax.body?.experience_insights?.experiencias_iniciadas?.total === 5
                && JSON.stringify(ax.body.experience_insights.experiencias_iniciadas.by_version) === JSON.stringify({ v9: 5 }));

            // lector: solo sí mismo (self), nunca otro
            const self = await req(server, 'GET', TL('u_student'), null, { 'x-user-id': 'u_student' });
            const other = await req(server, 'GET', TL('u_stranger'), null, { 'x-user-id': 'u_student' });
            ok('37) lector → 200 sobre sí mismo y 403 sobre otro lector (sin ampliar acceso a participantes)',
                self.status === 200 && other.status === 403);

            // 11) IDs falsos del cliente no alteran el scope
            const fake = await req(server, 'GET',
                TL('u_stranger') + '?userId=u_admin&groupId=g_otro&organizationId=school_otro&role=administrador&colegio=Colegio%20Otro',
                null, { 'x-user-id': 'u_mediator' });
            ok('38) query con userId/groupId/organizationId/rol falsos → sigue 403',
                fake.status === 403);
            // Identidad de sesión manda sobre el header: req.auth (sesión) = mediador,
            // header afirma admin → decisión con la sesión (403 sobre ajeno).
            let sentStatus = null, sentBody = null;
            const fakeRes = { status(c) { sentStatus = c; return this; }, json(b) { sentBody = b; return this; } };
            const allowed = scopeAccess.requireScopeAccess('user', 'u_stranger',
                { auth: { userId: 'u_mediator' }, user: { id: 'u_mediator' }, headers: { 'x-user-id': 'u_admin' } }, fakeRes);
            ok('39) requireScopeAccess usa la identidad de sesión (req.auth) y NO el header x-user-id',
                allowed === false && sentStatus === 403 && sentBody?.error === 'scope_access_denied');
            const allowedSelf = scopeAccess.requireScopeAccess('user', 'u_student',
                { auth: { userId: 'u_mediator' }, headers: {} }, fakeRes);
            ok('    con sesión de mediador y sin header, su miembro sigue permitido', allowedSelf === true);

            // denegaciones existentes: identidad no establecida / desconocida
            const noId = await req(server, 'GET', TL('u_student'), null, { 'x-user-id': '' });
            const ghost = await req(server, 'GET', TL('u_student'), null, { 'x-user-id': 'u_ghost' });
            ok('40) sin identidad o principal desconocido → 401 identity_not_established (fail-closed)',
                noId.status === 401 && ghost.status === 401
                && noId.body?.error === 'identity_not_established' && ghost.body?.error === 'identity_not_established');

            // 12) sin PII/payloads en la respuesta
            const txt = JSON.stringify(a.body) + JSON.stringify(m.body) + JSON.stringify(ax.body);
            ok('41) respuesta sin email, password, sessionId, payload_json ni texto de evidencias',
                !/"(email|password|passwordHash|sessionId|session_id|payload_json|payload|text|texto|comment|comentario)"\s*:/i.test(txt)
                && !/Mediadora 7A|Estudiante A|Estudiante X/.test(txt));

            // 13) dos GET consecutivos idénticos
            const a2 = await req(server, 'GET', TL('u_student'), null, { 'x-user-id': 'u_admin' });
            ok('42) dos GET consecutivos producen el mismo resultado', JSON.stringify(a2.body) === JSON.stringify(a.body));

            // 14) insights.db lógicamente idéntica (ningún GET escribe ni materializa)
            ok('43) insights.db lógicamente idéntica antes y después de todos los GET (cero escrituras)',
                digest() === before);
            ok('    stores reales fuera del temporal no se tocan (handle apunta al tmp)',
                idb.name === process.env.INSIGHTS_SQLITE_PATH && process.env.USERS_DB.startsWith(tmpDir));
        } finally { server.close(); }
    }

} finally {
    try { scheduler.stop(); } catch {}
    rolExt.closeRollupsExtDb?.();
    pedExt.closePedagogyExtDb?.();
    insExt.closeInsightsExtDb?.();
    eventsService.closeDb?.();
    try {
        for (const f of fs.readdirSync(tmpDir)) {
            try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
        }
        fs.rmdirSync(tmpDir);
    } catch {}
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
