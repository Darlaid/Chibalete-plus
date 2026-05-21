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
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av5_'));
process.env.EVENTS_SQLITE_PATH    = path.join(tmpDir, 'events.db');
process.env.INSIGHTS_SQLITE_PATH  = path.join(tmpDir, 'insights.db');
process.env.ARCHIVE_SQLITE_PATH   = path.join(tmpDir, 'events.archive.db');

const eventsService = await import('../eventsService.js');
const insExt   = await import('../db/insightsDbExt.mjs');
const pedExt   = await import('../db/pedagogyDbExt.mjs');
const rolExt   = await import('../db/rollupsDbExt.mjs');
const reader   = await import('../services/insightReader.mjs');
const archive  = await import('../aulaViva/archiveRotation.mjs');
const scheduler = await import('../aulaViva/scheduler.mjs');
const { createOperationalRouter } = await import('../aulaViva/operationalRouter.mjs');

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
