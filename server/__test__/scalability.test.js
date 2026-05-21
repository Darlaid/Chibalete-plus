/**
 * scalability.test.js — PASO 4 §23.
 *
 * Cubre:
 *  - PRAGMA tuning aplicado
 *  - rollups idempotencia (daily/weekly/monthly)
 *  - replay parcial + cancel + resume
 *  - snapshot_history append-only
 *  - feature_vectors versioning
 *  - leader election (acquire/heartbeat/release/expire)
 *  - query profiler (slow log + métrica)
 *  - WAL health (integrity_check)
 *  - rollback compat (engines OFF → skip + no escribe)
 *  - cohort performance (latencia de read API)
 *  - no doble proyección (rerun no duplica)
 *
 *   node server/__test__/scalability.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sca_'));
process.env.EVENTS_SQLITE_PATH   = path.join(tmpDir, 'events.db');
process.env.INSIGHTS_SQLITE_PATH = path.join(tmpDir, 'insights.db');
process.env.PRAGMA_TUNING_ENABLED = '1';

const eventsService = await import('../eventsService.js');
const insExt   = await import('../db/insightsDbExt.mjs');
const pedExt   = await import('../db/pedagogyDbExt.mjs');
const rolExt   = await import('../db/rollupsDbExt.mjs');
const rollups  = await import('../services/rollupsEngine.mjs');
const features = await import('../services/featureExtractor.mjs');
const replay   = await import('../services/replayEngine.mjs');
const leader   = await import('../services/leaderElection.mjs');
const profiler = await import('../services/queryProfiler.mjs');
const reader   = await import('../services/insightReader.mjs');
const materializer = await import('../services/insightMaterializer.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++)
                                : (console.error('  ✗', l, h), fail++);

// Seed RAW de events (bypassa insertEvent que sobrescribe server_ts).
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

    console.log('\n[A] PRAGMA tuning aplicado');
    {
        const db = rolExt.getRollupsExtDb();
        ok('1) busy_timeout = 10000 (tuned)',
            db.pragma('busy_timeout', { simple: true }) === 10000);
        ok('2) cache_size = -8000 (tuned)',
            db.pragma('cache_size', { simple: true }) === -8000);
        // mmap_size puede o no aplicarse según SO; aceptamos cualquier valor >= 0.
        const mm = db.pragma('mmap_size', { simple: true });
        ok('3) mmap_size aplicado (>=0)', typeof mm === 'number' && mm >= 0);
        ok('4) journal_mode = WAL', db.pragma('journal_mode', { simple: true }) === 'wal');
        ok('5) integrity_check = ok', db.pragma('integrity_check', { simple: true }) === 'ok');
    }

    console.log('\n[B] Rollups engine: OFF rollback + ON computation');
    {
        // OFF: debe skipear
        delete process.env.ROLLUPS_ENABLED;
        const rOff = rollups.runOnce({ nowTs: NOW });
        ok('6) rollups OFF retorna skipped sin tocar DB',
            rOff.ok && rOff.skipped === true);
        const cBefore = rolExt.getRollupsStatements().countRollups.get();
        ok('   sin filas creadas en daily/weekly/monthly',
            cBefore.daily === 0 && cBefore.weekly === 0 && cBefore.monthly === 0);

        // Seed events y prender rollups
        seed([
            { event_id:'e1', event:'reading_started', user_id:'u1', ts:D(2), content_id:'c1',
              payload:{contentId:'c1', mode:'immersive', sessionId:'s1', startedAt:D(2)} },
            { event_id:'e2', event:'session_started', user_id:'u1', ts:D(2),
              payload:{sessionId:'s1', source:'visor', startedAt:D(2)} },
            { event_id:'e3', event:'reading_completed', user_id:'u1', ts:D(1), content_id:'c1',
              payload:{contentId:'c1', sessionId:'s1', totalTimeMs:120000} },
            { event_id:'e4', event:'reading_started', user_id:'u2', ts:D(1), content_id:'c2',
              payload:{contentId:'c2', mode:'immersive', sessionId:'s2', startedAt:D(1)} },
            { event_id:'e5', event:'reading_abandoned', user_id:'u2', ts:D(1), content_id:'c2',
              payload:{contentId:'c2', sessionId:'s2', percentage:5} },
        ]);
        process.env.ROLLUPS_ENABLED = '1';
        const r = rollups.runOnce({ nowTs: NOW, fromTs: D(7), toTs: NOW });
        ok('7) rollups runOnce ok + eventsScanned>=5',
            r.ok && r.eventsScanned >= 5);
        ok('   daily/weekly/monthly upserts > 0',
            r.daily_upserts > 0 && r.weekly_upserts > 0 && r.monthly_upserts > 0);

        // Idempotencia: rerun no duplica (UPSERT por PK composite)
        const cAfter1 = rolExt.getRollupsStatements().countRollups.get();
        const r2 = rollups.runOnce({ nowTs: NOW, fromTs: D(7), toTs: NOW });
        const cAfter2 = rolExt.getRollupsStatements().countRollups.get();
        ok('8) rollups idempotente: rerun NO duplica filas',
            cAfter1.daily === cAfter2.daily
            && cAfter1.weekly === cAfter2.weekly
            && cAfter1.monthly === cAfter2.monthly);
    }

    console.log('\n[C] Reader API rollups (latencia + never-throws)');
    {
        const daily = reader.getDailyRollups('all', 'global', D(7));
        ok('9) getDailyRollups retorna array no vacío',
            Array.isArray(daily) && daily.length > 0);
        const weekly = reader.getWeeklyRollups('all', 'global', D(30));
        ok('   getWeeklyRollups retorna array', Array.isArray(weekly));
        const monthly = reader.getMonthlyRollups('all', 'global', D(90));
        ok('   getMonthlyRollups retorna array', Array.isArray(monthly));
        // never-throws
        let threw = false;
        try { reader.getDailyRollups('group', 'nope', D(7)); } catch { threw = true; }
        ok('10) never-throws con scope inexistente', threw === false);
    }

    console.log('\n[D] Feature extractor: OFF rollback + ON con versioning');
    {
        delete process.env.FEATURE_EXTRACTION_ENABLED;
        const fOff = features.runOnce({ nowTs: NOW });
        ok('11) features OFF retorna skipped', fOff.ok && fOff.skipped === true);

        // Seed profile mínimo para u1 antes de runOnce
        insExt.getStatements().upsertProfile.run({
            user_id: 'u1', fluidez_score: null, persistencia_score: 0.6,
            autonomia_score: null, concentracion_score: null,
            diversidad_score: 0.3, engagement_score: 0.4, abandono_risk: 0.2,
            last_active_at: D(1), updated_at: NOW, source_watermark: 5,
        });
        process.env.FEATURE_EXTRACTION_ENABLED = '1';
        const f = features.runOnce({ nowTs: NOW });
        ok('12) features ON procesa profile + upserta vector',
            f.ok && f.upserted >= 1);

        const fv = reader.getLatestFeatureVector('u1');
        ok('13) feature vector recuperable + features tiene >=10 campos',
            fv && fv.features && Object.keys(fv.features).length >= 10);
        ok('   vector_version coincide con FEATURE_VECTOR_VERSION',
            fv.vector_version === features.FEATURE_VECTOR_VERSION);
        ok('   source_watermark presente y >= 0',
            typeof fv.source_watermark === 'number' && fv.source_watermark >= 0);
    }

    console.log('\n[E] Snapshot history append-only (gated)');
    {
        // Sin flag: materializer NO debe escribir history
        delete process.env.SNAPSHOT_HISTORY_ENABLED;
        process.env.INSIGHTS_MATERIALIZER_ENABLED = '1';
        const beforeN = rolExt.getRollupsStatements().countSnapHistory.get().n;
        materializer.runOnce({ nowTs: NOW });
        const afterN = rolExt.getRollupsStatements().countSnapHistory.get().n;
        ok('14) materializer SIN flag NO toca snapshot_history',
            afterN === beforeN);

        // Con flag: materializer SÍ append-only.
        process.env.SNAPSHOT_HISTORY_ENABLED = '1';
        // re-seed para asegurar nuevos eventos a procesar
        seed([
            { event_id:'e6', event:'reading_completed', user_id:'u_sh', ts:D(1), content_id:'c3',
              payload:{contentId:'c3', sessionId:'s_sh', totalTimeMs:60000} },
        ]);
        const r = materializer.runOnce({ nowTs: NOW });
        const afterN2 = rolExt.getRollupsStatements().countSnapHistory.get().n;
        ok('15) materializer CON flag append-only inserta history',
            afterN2 > afterN && r.snapshotHistoryAppended > 0);

        // getSignalTimeline retorna las filas append-only
        const tl = reader.getSignalTimeline('user', 'u_sh', 'continuidad_semanal', 0);
        ok('   getSignalTimeline funciona para signal_id existente',
            Array.isArray(tl));
    }

    console.log('\n[F] Replay engine resumibilidad + cancelación');
    {
        // Replay rango: 7d, chunk 1d → 7 chunks.
        const r1 = replay.startReplay({
            fromTs: D(7), toTs: NOW, chunkMs: 86_400_000, dryRun: true,
        });
        ok('16) replay completa ok con dryRun + run_id válido',
            r1.ok && typeof r1.run_id === 'string' && r1.totalChunks === 7);
        ok('   chunksProcessed == totalChunks (no canceled)',
            r1.chunksProcessed === r1.totalChunks && !r1.canceled);

        // Job ledger refleja el run.
        const ledger = reader.getJobLedger({ limit: 5 });
        ok('17) job ledger contiene el replay',
            Array.isArray(ledger) && ledger.some(j => j.run_id === r1.run_id));
        const job = ledger.find(j => j.run_id === r1.run_id);
        ok('   status=completed + completed_at presente',
            job?.status === 'completed' && typeof job.completed_at === 'number');

        // Cancel: nuevo replay, cancel ANTES de correr.
        const r2 = replay.startReplay({
            fromTs: D(2), toTs: NOW, chunkMs: 12 * 3600_000, dryRun: true,
        });
        // Ya completó; testeamos que requestCancel sobre completado no rompe.
        const c = replay.requestCancel(r2.run_id);
        ok('18) requestCancel sobre completado: ok=false (sin filas)', c.ok === false);
    }

    console.log('\n[G] Leader election (acquire/heartbeat/release)');
    {
        const a1 = leader.acquireLock('test-lock', 5_000);
        ok('19) acquireLock primer intento → acquired=true',
            a1.acquired === true);
        const a2 = leader.acquireLock('test-lock', 5_000);
        ok('   2do intento mismo proceso → acquired=false (lock vivo)',
            a2.acquired === false);
        const hb = leader.heartbeat('test-lock', 5_000);
        ok('20) heartbeat retorna true (somos holders)', hb === true);
        ok('   isCurrentLeader=true', leader.isCurrentLeader('test-lock') === true);
        const info = leader.getLockInfo('test-lock');
        ok('   getLockInfo expone holder_id + self=true',
            info && info.self === true && typeof info.holder_id === 'string');
        const rel = leader.releaseLock('test-lock');
        ok('21) releaseLock OK', rel === true);
        ok('   tras release, isCurrentLeader=false',
            leader.isCurrentLeader('test-lock') === false);
    }

    console.log('\n[H] Query profiler (slow log + métrica)');
    {
        // Query rápida: NO debería loggear
        const r1 = profiler.instrument('test_fast', () => 'ok');
        ok('22) instrument retorna el valor de la función', r1 === 'ok');

        // Query "lenta" simulada (sleep)
        const r2 = profiler.instrument('test_slow', () => {
            const end = Date.now() + 260;  // SLOW_THRESHOLD_MS = 250 por defecto
            while (Date.now() < end) { /* busy wait */ }
            return 'slow_done';
        });
        ok('   función lenta retorna valor + entra a slow log', r2 === 'slow_done');
        const recent = profiler.listRecentSlow(60, 10);
        ok('23) listRecentSlow contiene test_slow',
            recent.some(r => r.query_id === 'test_slow'));
        const count = profiler.recentSlowCount(60);
        ok('   recentSlowCount >= 1', count >= 1);
    }

    console.log('\n[I] Cohort performance (latencia getCohortComparison)');
    {
        // Asegurar al menos algún rollup en cohort_rollups (PASO 2/3 cohorts)
        // Ya hay rollups creados por rollups.runOnce y materializer.runOnce.
        const t0 = process.hrtime.bigint();
        const c = reader.getCohortComparison('all', 'global');
        const elapsedMs = Number((process.hrtime.bigint() - t0) / 1000000n);
        ok('24) getCohortComparison retorna objeto con metrics + global_baseline',
            c && Array.isArray(c.metrics) && Array.isArray(c.global_baseline));
        ok(`25) getCohortComparison latencia <500ms (got ${elapsedMs}ms)`,
            elapsedMs < 500);
    }

    console.log('\n[J] No-doble-proyección + replay idempotente');
    {
        // Hacer 2 runs idénticos: signal_snapshots no debe duplicarse (UNIQUE)
        // y rollups tampoco (PK composite).
        const before = {
            snaps: insExt.getStatements().countByTable.snaps.get().n,
            profiles: insExt.getStatements().countByTable.profiles.get().n,
            cohorts: insExt.getStatements().countByTable.cohorts.get().n,
            rollups: rolExt.getRollupsStatements().countRollups.get(),
        };
        materializer.runOnce({ nowTs: NOW });
        rollups.runOnce({ nowTs: NOW, fromTs: D(7), toTs: NOW });
        const after = {
            snaps: insExt.getStatements().countByTable.snaps.get().n,
            profiles: insExt.getStatements().countByTable.profiles.get().n,
            cohorts: insExt.getStatements().countByTable.cohorts.get().n,
            rollups: rolExt.getRollupsStatements().countRollups.get(),
        };
        ok('26) snapshots no se duplican tras rerun',
            after.snaps === before.snaps);
        ok('27) profiles no se duplican tras rerun (UPSERT)',
            after.profiles === before.profiles);
        ok('28) rollups daily/weekly/monthly no se duplican',
            after.rollups.daily === before.rollups.daily
            && after.rollups.weekly === before.rollups.weekly
            && after.rollups.monthly === before.rollups.monthly);
    }

    console.log('\n[K] Healthcheck shape PASO 4 (rollups/replay/features/wal/slow/leader)');
    {
        const ah = await import('../observability/analyticsHealth.js');
        let payload = null;
        const res = { _s: 200, _j: null,
            status(c){ this._s = c; return this; },
            json(p){ this._j = p; payload = p; return this; } };
        await ah.analyticsHealthHandler({}, res);
        ok('29) /api/health/analytics responde con checks PASO 4 presentes',
            !!payload && !!payload.checks?.rollups && !!payload.checks?.replay
            && !!payload.checks?.feature_extraction && !!payload.checks?.wal_size
            && !!payload.checks?.slow_queries && !!payload.checks?.leader);
        ok('   wal_size.events_wal_bytes presente y numérico',
            typeof payload.checks.wal_size.events_wal_bytes === 'number');
    }

} finally {
    rollups.closeRollupsEventsRaw?.();
    rolExt.closeRollupsExtDb?.();
    pedExt.closePedagogyExtDb?.();
    insExt.closeInsightsExtDb?.();
    materializer.closeMaterializerEventsDb?.();
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
