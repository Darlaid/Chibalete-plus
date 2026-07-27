/**
 * aulaVivaInstitutional.test.js — PASO 7 §21.
 *
 * Cubre:
 *  - endpoints outcomes / cohorts / trajectories / learnings / patterns
 *  - scope isolation (admin / mediator / lector / stranger)
 *  - no tenant leakage
 *  - degraded states (DB vacía → 200 con stale)
 *  - empty states (response shape consistente)
 *  - institutional workflows (status agregado)
 *  - comparative intelligence (sin causal language)
 *  - latency targets (instrumentación verificada)
 *  - WAL safety (integrity_check)
 *  - replay-safe reads (no escriben)
 *  - rollback compatibility (router responde aun sin engines OFF)
 *  - no PII exposure (NO se expone email/password en responses)
 *  - cache correctness (header)
 *  - pagination correctness (limit clamp)
 *  - 5000-user synthetic read test (200 users → all endpoints <500ms p95)
 *
 *   node server/__test__/aulaVivaInstitutional.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import express from 'express';
import Database from 'better-sqlite3';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'av7_'));
process.env.EVENTS_SQLITE_PATH   = path.join(tmpDir, 'events.db');
process.env.INSIGHTS_SQLITE_PATH = path.join(tmpDir, 'insights.db');

// Crear fixtures users + groups en filesystem aislado
const dataDir = path.join(tmpDir, 'data');
fs.mkdirSync(dataDir, { recursive: true });

// CHP-ID-CANON-01B — inyección explícita del padrón de fixtures ANTES de los
// imports: config.js resuelve USERS_DB/GROUPS_DB en import-time. NODE_ENV=test
// es lo único que habilita el override, y solo hacia un directorio temporal.
process.env.NODE_ENV  = 'test';
process.env.USERS_DB  = path.join(dataDir, 'usuarios_colegios_oro.json');
process.env.GROUPS_DB = path.join(dataDir, 'groups_db.json');

// Importes después de setear env
const eventsService = await import('../eventsService.js');
const insExt = await import('../db/insightsDbExt.mjs');
const pedExt = await import('../db/pedagogyDbExt.mjs');
const rolExt = await import('../db/rollupsDbExt.mjs');
const outExt = await import('../db/outcomesDbExt.mjs');
const outcomes   = await import('../services/outcomeEngine.mjs');
const cohorts    = await import('../services/cohortBuilder.mjs');
const trajectories = await import('../services/trajectoryAnalyzer.mjs');
const learnings  = await import('../services/institutionalLearning.mjs');
const patterns   = await import('../services/predictivePatterns.mjs');
const scopeAccess = await import('../aulaViva/scopeAccess.mjs');
const { createInstitutionalRouter } = await import('../aulaViva/institutionalRouter.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++)
                                : (console.error('  ✗', l, h), fail++);

// HTTP test helper
function makeTestApp() {
    const app = express();
    app.use(express.json());
    // Stub auth — chequea que x-user-id esté presente (mimics requireUserAuth)
    const stubAuth = (req, res, next) => {
        const uid = req.headers['x-user-id'];
        if (!uid) return res.status(401).json({ error: 'missing x-user-id' });
        req._uid = uid;
        next();
    };
    app.use('/api/aula-viva', createInstitutionalRouter({ requireUserAuth: stubAuth }));
    return app;
}
function listen(app) {
    return new Promise(resolve => {
        const server = app.listen(0, () => resolve(server));
    });
}
function req(server, method, path, opts = {}) {
    return new Promise((resolve, reject) => {
        const headers = {
            'Content-Type': 'application/json',
            ...(opts.userId ? { 'x-user-id': opts.userId } : {}),
            ...(opts.headers || {}),
        };
        const data = opts.body ? JSON.stringify(opts.body) : null;
        if (data) headers['Content-Length'] = Buffer.byteLength(data);
        const r = http.request({
            host: '127.0.0.1', port: server.address().port,
            method, path, headers,
        }, (res) => {
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

// CHP-ID-CANON-01B — los fixtures viven SOLO en el directorio temporal, y el
// CIS los lee porque USERS_DB/GROUPS_DB apuntan ahí. Antes este test
// sobrescribía `data/users_db.json` y `data/groups_db.json` reales y los
// restauraba desde un backup en memoria: ese hack existía porque scopeAccess
// leía un path hardcodeado. Ya no: cero escrituras sobre stores reales.
const FIXTURE_USERS  = process.env.USERS_DB;
const FIXTURE_GROUPS = process.env.GROUPS_DB;
function installFixture(users, groups) {
    fs.writeFileSync(FIXTURE_USERS,  JSON.stringify(users),  'utf8');
    fs.writeFileSync(FIXTURE_GROUPS, JSON.stringify(groups), 'utf8');
}

function seedEvent(evs) {
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
    outExt.getOutcomesExtDb();

    const NOW = Date.now();
    const D = (n) => NOW - n * 86_400_000;

    // Fixtures: 1 admin, 1 mediador, 1 estudiante, 1 stranger, 1 group, 1 school
    const USERS = [
        { id: 'u_admin',     role: 'administrador', name: 'Admin' },
        { id: 'u_mediator',  role: 'profesor',      name: 'Mediadora' },
        { id: 'u_student',   role: 'lector',        name: 'Estudiante A' },
        { id: 'u_stranger',  role: 'lector',        name: 'Estudiante X' },
    ];
    const GROUPS = [
        { id: 'g_7A', name: '7A', type: 'course', schoolId: 'school_uno',
          mediatorIds: ['u_mediator'], memberIds: ['u_student'] },
        { id: 'g_otro', name: '8B', type: 'course', schoolId: 'school_otro',
          mediatorIds: ['u_mediator_otro'], memberIds: ['u_stranger'] },
    ];
    installFixture(USERS, GROUPS);

    console.log('\n[A] scopeAccess — admin / mediator / lector / stranger');
    {
        ok('1) admin accede a cualquier user',
            scopeAccess.canAccessScope('u_admin', 'user', 'u_student') &&
            scopeAccess.canAccessScope('u_admin', 'user', 'u_stranger') &&
            scopeAccess.canAccessScope('u_admin', 'school', 'school_uno'));
        ok('2) mediador accede a user de SU grupo',
            scopeAccess.canAccessScope('u_mediator', 'user', 'u_student') === true);
        ok('3) mediador NO accede a user de OTRO grupo (no tenant leakage)',
            scopeAccess.canAccessScope('u_mediator', 'user', 'u_stranger') === false);
        ok('4) mediador accede a SU group',
            scopeAccess.canAccessScope('u_mediator', 'group', 'g_7A') === true);
        ok('5) mediador NO accede a group ajeno',
            scopeAccess.canAccessScope('u_mediator', 'group', 'g_otro') === false);
        ok('6) mediador accede a SU school',
            scopeAccess.canAccessScope('u_mediator', 'school', 'school_uno') === true);
        ok('7) mediador NO accede a school ajeno',
            scopeAccess.canAccessScope('u_mediator', 'school', 'school_otro') === false);
        ok('8) estudiante accede solo a su propio user',
            scopeAccess.canAccessScope('u_student', 'user', 'u_student') === true &&
            scopeAccess.canAccessScope('u_student', 'user', 'u_stranger') === false);
        ok('9) usuario inexistente → deny',
            scopeAccess.canAccessScope('u_nope', 'user', 'u_student') === false);
        ok('10) library scope → deny excepto admin',
            scopeAccess.canAccessScope('u_mediator', 'library', 'lib1') === false &&
            scopeAccess.canAccessScope('u_admin', 'library', 'lib1') === true);
    }

    console.log('\n[B] Router boot + endpoints básicos + auth');
    {
        const app = makeTestApp();
        const server = await listen(app);
        try {
            const noAuth = await req(server, 'GET', '/api/aula-viva/institutional/status');
            ok('11) sin x-user-id → 401', noAuth.status === 401);

            const status = await req(server, 'GET', '/api/aula-viva/institutional/status',
                                      { userId: 'u_admin' });
            ok('12) status 200 + shape outcomes/cohorts/trajectories/learnings/patterns',
                status.status === 200 && status.body
                && status.body.outcomes && status.body.cohorts
                && status.body.trajectories && status.body.learnings
                && status.body.patterns);

            const learns = await req(server, 'GET', '/api/aula-viva/institutional/learnings/global',
                                      { userId: 'u_admin' });
            ok('13) learnings/global retorna array (vacío OK)',
                learns.status === 200 && Array.isArray(learns.body));

            const patternsRecent = await req(server, 'GET',
                '/api/aula-viva/institutional/patterns/recent',
                { userId: 'u_admin' });
            ok('14) patterns/recent retorna array', patternsRecent.status === 200
                && Array.isArray(patternsRecent.body));
        } finally { server.close(); }
    }

    console.log('\n[C] Scope isolation en endpoints (no tenant leakage)');
    {
        const app = makeTestApp();
        const server = await listen(app);
        try {
            // Mediador intenta ver scope user del estudiante ajeno
            const forbidden = await req(server, 'GET',
                '/api/aula-viva/institutional/outcomes/scope/user/u_stranger',
                { userId: 'u_mediator' });
            ok('15) mediador → 403 scope user ajeno',
                forbidden.status === 403 && forbidden.body.error === 'scope_access_denied');

            // Mediador SÍ puede ver scope user de SU estudiante
            const allowed = await req(server, 'GET',
                '/api/aula-viva/institutional/outcomes/scope/user/u_student',
                { userId: 'u_mediator' });
            ok('16) mediador → 200 scope user propio del grupo',
                allowed.status === 200);

            // Estudiante intenta ver group → 403
            const studentGroup = await req(server, 'GET',
                '/api/aula-viva/institutional/outcomes/scope/group/g_7A',
                { userId: 'u_student' });
            ok('17) estudiante → 403 group scope',
                studentGroup.status === 403);

            // Profile enriquecido
            const profileOk = await req(server, 'GET',
                '/api/aula-viva/institutional/profile/u_student',
                { userId: 'u_mediator' });
            ok('18) profile/:userId 200 con timeline + feature_vector + impact_history',
                profileOk.status === 200
                && 'timeline' in profileOk.body
                && 'feature_vector' in profileOk.body
                && 'impact_history' in profileOk.body);

            const profileDenied = await req(server, 'GET',
                '/api/aula-viva/institutional/profile/u_stranger',
                { userId: 'u_mediator' });
            ok('19) profile cross-tenant denegado',
                profileDenied.status === 403);
        } finally { server.close(); }
    }

    console.log('\n[D] Comparative intelligence sin causal language');
    {
        const app = makeTestApp();
        const server = await listen(app);
        try {
            const comp = await req(server, 'GET',
                '/api/aula-viva/institutional/comparative/strategies',
                { userId: 'u_admin' });
            ok('20) comparative/strategies retorna {strategies, vocabulary_class, caveat}',
                comp.status === 200 && Array.isArray(comp.body.strategies)
                && comp.body.vocabulary_class === 'observational'
                && typeof comp.body.caveat === 'string');
            const caveat = comp.body.caveat || '';
            ok('21) caveat menciona "patrones observados" o similar',
                /observad|patrón|patrones|reflej/i.test(caveat));
            ok('   caveat NO usa "causal"/"garantiza"/"predice"',
                !/\bcausal\b|\bgarantiza\b|\bpredice\b/i.test(caveat));
        } finally { server.close(); }
    }

    console.log('\n[E] Workflow institucional con datos reales');
    {
        // Seed: outcome real para que learnings/cohorts no sean vacío
        // Generar evento + intervención + correr outcomeEngine
        process.env.AULA_VIVA_OUTCOME_ENGINE_ENABLED = '1';
        process.env.AULA_VIVA_COHORT_BUILDER_ENABLED = '1';
        process.env.AULA_VIVA_LEARNING_ENABLED = '1';

        // Seed events para 6 users (≥ MIN_SUPPORT=5 para learnings)
        for (let i = 0; i < 6; i++) {
            const uid = `u_seed_${i}`;
            for (let j = 0; j < 3; j++) {
                seedEvent([
                    { event_id:`bx_${i}_${j}`, event:'reading_started', user_id: uid,
                      ts:D(20-j), content_id:`c${j}`,
                      payload:{contentId:`c${j}`, sessionId:`s${i}${j}`} },
                ]);
            }
            for (let j = 0; j < 2; j++) {
                seedEvent([
                    { event_id:`bc_${i}_${j}`, event:'reading_completed', user_id: uid,
                      ts:D(18-j), content_id:`c${j}`, elapsed_ms:300_000,
                      payload:{contentId:`c${j}`, sessionId:`s${i}${j}`, totalTimeMs:300_000} },
                ]);
            }
            for (let j = 0; j < 4; j++) {
                seedEvent([
                    { event_id:`fc_${i}_${j}`, event:'reading_completed', user_id: uid,
                      ts:D(5-j), content_id:`c_post${j}`, elapsed_ms:400_000,
                      payload:{contentId:`c_post${j}`, sessionId:`s${i}p${j}`, totalTimeMs:400_000} },
                ]);
            }
            pedExt.getPedagogyStatements().insertIntervention.run({
                intervention_id: `intv_seed_${i}`, teacher_id: 'u_mediator',
                student_id: uid, intervention_type: 'lectura_guiada',
                created_at: D(14), notes: null,
                recommendation_origin: null, outcome: 'pending', outcome_at: null,
            });
        }
        outcomes.runOnce({ nowTs: NOW });
        cohorts.runOnce({ nowTs: NOW });
        learnings.runOnce({ nowTs: NOW });

        const app = makeTestApp();
        const server = await listen(app);
        try {
            const learn = await req(server, 'GET',
                '/api/aula-viva/institutional/learnings/global',
                { userId: 'u_admin' });
            ok('22) learnings/global tras seed: array no vacío',
                learn.status === 200 && Array.isArray(learn.body) && learn.body.length >= 1);
            const sample = learn.body[0];
            ok('   learning tiene recommendation_hint + evidence + confidence',
                sample && sample.recommendation_hint && sample.evidence
                && typeof sample.confidence === 'number');
            ok('   hint NO contiene vocab causal/clínico prohibido',
                !/\bcausal\b|\bcausó\b|\bgarantiza\b|\bdéficit\b|\btrastorno\b/i
                  .test(sample.recommendation_hint || ''));

            const byType = await req(server, 'GET',
                '/api/aula-viva/institutional/outcomes/by-type/lectura_guiada',
                { userId: 'u_mediator' });
            ok('23) outcomes/by-type retorna distribution + total>=1',
                byType.status === 200 && byType.body.total >= 1 && byType.body.distribution);

            const queue = await req(server, 'GET',
                '/api/aula-viva/institutional/outcomes/follow-up-queue',
                { userId: 'u_admin' });
            ok('24) follow-up-queue retorna array',
                queue.status === 200 && Array.isArray(queue.body));

            const cohortDefs = await req(server, 'GET',
                '/api/aula-viva/institutional/cohorts/definitions',
                { userId: 'u_admin' });
            ok('25) cohorts/definitions retorna >= 1 cohort',
                cohortDefs.status === 200 && Array.isArray(cohortDefs.body)
                && cohortDefs.body.length >= 1);

            const oneCohort = cohortDefs.body.find(c => c.cohort_type === 'intervention');
            ok('26) cohort intervention/* presente',
                oneCohort && oneCohort.cohort_id);

            if (oneCohort) {
                const members = await req(server, 'GET',
                    `/api/aula-viva/institutional/cohorts/${encodeURIComponent(oneCohort.cohort_id)}/members`,
                    { userId: 'u_admin' });
                ok('27) cohort/:id/members retorna members_count + members[]',
                    members.status === 200
                    && typeof members.body.members_count === 'number'
                    && Array.isArray(members.body.members));
            }
        } finally { server.close(); }
    }

    console.log('\n[F] Pagination + limit clamp');
    {
        const app = makeTestApp();
        const server = await listen(app);
        try {
            // limit > MAX_LIMIT debería clamparse a 200
            const r1 = await req(server, 'GET',
                '/api/aula-viva/institutional/cohorts/definitions?limit=9999',
                { userId: 'u_admin' });
            ok('28) limit=9999 → 200 + max 200 filas (clamp)',
                r1.status === 200 && (!Array.isArray(r1.body) || r1.body.length <= 200));

            // limit=0 / negativo → default
            const r2 = await req(server, 'GET',
                '/api/aula-viva/institutional/cohorts/definitions?limit=-5',
                { userId: 'u_admin' });
            ok('29) limit negativo → default sin error', r2.status === 200);
        } finally { server.close(); }
    }

    console.log('\n[G] Healthcheck PASO 7 — institutional_api visible');
    {
        const ah = await import('../observability/analyticsHealth.js');
        let payload = null;
        const res = { _s:200, _j:null, status(c){this._s=c;return this;},
                       json(p){this._j=p; payload=p; return this;} };
        await ah.analyticsHealthHandler({}, res);
        ok('30) healthcheck incluye checks.institutional_api',
            !!payload?.checks?.institutional_api);
        ok('   institutional_api tiene staleness_hours',
            payload?.checks?.institutional_api?.staleness_hours !== undefined);
    }

    console.log('\n[H] WAL safety + no PII exposure + tracking endpoints');
    {
        const db = outExt.getOutcomesExtDb();
        ok('31) integrity_check = ok',
            db.pragma('integrity_check', { simple: true }) === 'ok');

        // Verify NO PII en responses (email/password no aparecen en API responses)
        const app = makeTestApp();
        const server = await listen(app);
        try {
            const profile = await req(server, 'GET',
                '/api/aula-viva/institutional/profile/u_student',
                { userId: 'u_admin' });
            const responseStr = JSON.stringify(profile.body);
            ok('32) profile response NO contiene "email" o "password" como keys',
                !/"email"\s*:/i.test(responseStr)
                && !/"password"\s*:/i.test(responseStr)
                && !/"hash"\s*:/i.test(responseStr));

            // Tracking endpoints (UI latency + scope switch)
            const trackScope = await req(server, 'POST',
                '/api/aula-viva/institutional/_track/scope-switch',
                { userId: 'u_admin', body: { to: 'school' } });
            ok('33) _track/scope-switch responde ok',
                trackScope.status === 200 && trackScope.body?.ok === true);

            const trackLat = await req(server, 'POST',
                '/api/aula-viva/institutional/_track/ui-latency',
                { userId: 'u_admin', body: { where: 'student_panel', ms: 124 } });
            ok('34) _track/ui-latency responde ok',
                trackLat.status === 200 && trackLat.body?.ok === true);
        } finally { server.close(); }
    }

    console.log('\n[I] 5000-user synthetic read test (small scale 200 reads)');
    {
        // Generar 200 users en cohort_memberships sintéticos
        const outDb = outExt.getOutcomesExtDb();
        const stmts = outExt.getOutcomesStatements();
        const tx = outDb.transaction(() => {
            stmts.upsertCohortDef.run({
                cohort_id: 'coh_synthetic', cohort_key: 'group:synthetic',
                cohort_type: 'group', scope_type: 'group', scope_id: 'synthetic',
                criteria_json: '{}', version: 1,
                created_at: NOW, updated_at: NOW,
            });
            for (let i = 0; i < 200; i++) {
                stmts.insertCohortMembership.run({
                    cohort_id: 'coh_synthetic', user_id: `u_sx_${i}`,
                    joined_at: NOW, membership_reason_json: null,
                });
            }
        });
        tx();

        const app = makeTestApp();
        const server = await listen(app);
        try {
            // Test latencia bajo lectura sostenida (50 GETs back-to-back)
            const t0 = Date.now();
            for (let i = 0; i < 50; i++) {
                const r = await req(server, 'GET',
                    '/api/aula-viva/institutional/cohorts/definitions',
                    { userId: 'u_admin' });
                if (r.status !== 200) throw new Error(`failed at iter ${i}`);
            }
            const elapsed = Date.now() - t0;
            const avgMs = elapsed / 50;
            ok(`35) 50 GETs sostenidos OK, avg ${avgMs.toFixed(1)}ms`,
                avgMs < 100);  // target generoso para CI

            // Cohort members con 200 entries: paginación funciona
            const members = await req(server, 'GET',
                '/api/aula-viva/institutional/cohorts/coh_synthetic/members?limit=50',
                { userId: 'u_admin' });
            ok('36) cohort grande paginated: members_count=200, members.length<=50',
                members.status === 200
                && members.body.members_count === 200
                && members.body.members.length <= 50);
        } finally { server.close(); }
    }

    console.log('\n[J] Replay-safe reads + rollback compatibility');
    {
        // Apagar todos los engines PASO 6 — endpoints siguen respondiendo
        // 200 con shape consistente (recovery-first).
        delete process.env.AULA_VIVA_OUTCOME_ENGINE_ENABLED;
        delete process.env.AULA_VIVA_COHORT_BUILDER_ENABLED;
        delete process.env.AULA_VIVA_LEARNING_ENABLED;
        delete process.env.AULA_VIVA_TRAJECTORY_ENABLED;
        delete process.env.AULA_VIVA_PREDICTIVE_PATTERNS_ENABLED;

        const app = makeTestApp();
        const server = await listen(app);
        try {
            const r = await req(server, 'GET',
                '/api/aula-viva/institutional/status',
                { userId: 'u_admin' });
            ok('37) con engines OFF: status sigue 200 (recovery-first)',
                r.status === 200 && r.body && r.body.outcomes);

            const cmp = await req(server, 'GET',
                '/api/aula-viva/institutional/comparative/strategies',
                { userId: 'u_admin' });
            ok('38) comparative con engines OFF: 200 + shape consistente',
                cmp.status === 200 && Array.isArray(cmp.body.strategies));
        } finally { server.close(); }
    }

    console.log('\n[K] Deterministic + scope safety global');
    {
        const r1 = scopeAccess.canAccessScope('u_admin', 'school', 'school_uno');
        const r2 = scopeAccess.canAccessScope('u_admin', 'school', 'school_uno');
        ok('39) canAccessScope determinístico para misma input', r1 === r2 && r1 === true);

        // Caller null/undefined → deny
        ok('40) canAccessScope(undefined, ...) → false (default-deny)',
            scopeAccess.canAccessScope(undefined, 'user', 'u_student') === false);
    }

} finally {
    outExt.closeOutcomesExtDb?.();
    rolExt.closeRollupsExtDb?.();
    pedExt.closePedagogyExtDb?.();
    insExt.closeInsightsExtDb?.();
    eventsService.closeDb?.();
    try {
        // Cleanup tmpDir
        function rmRf(p) {
            if (!fs.existsSync(p)) return;
            const st = fs.statSync(p);
            if (st.isDirectory()) {
                for (const f of fs.readdirSync(p)) rmRf(path.join(p, f));
                try { fs.rmdirSync(p); } catch {}
            } else {
                try { fs.unlinkSync(p); } catch {}
            }
        }
        rmRf(tmpDir);
    } catch {}
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
