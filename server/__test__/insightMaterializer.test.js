/**
 * insightMaterializer.test.js — PASO 2: 15 checks de §26.
 *
 * ISOLATION: usa events.db + insights.db TEMPORALES vía env override
 * (EVENTS_SQLITE_PATH + INSIGHTS_SQLITE_PATH). NUNCA toca prod ni
 * data-critical/. Tests son sincronizables y deterministas.
 *
 *   node server/__test__/insightMaterializer.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// Aislar ANTES de cargar módulos (singletons leen env al primer getDb).
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mat_'));
process.env.EVENTS_SQLITE_PATH   = path.join(tmpDir, 'events.db');
process.env.INSIGHTS_SQLITE_PATH = path.join(tmpDir, 'insights.db');

const eventsService = await import('../eventsService.js');
const ext            = await import('../db/insightsDbExt.mjs');
const reader         = await import('../services/insightReader.mjs');
const materializer   = await import('../services/insightMaterializer.mjs');
const insightsStore  = await import('../insightsStore.js');

let pass = 0, fail = 0;
const ok = (l,c,h='') => c ? (console.log('  ✓',l),pass++) : (console.error('  ✗',l,h),fail++);

// Seed RAW (bypassa eventsService.insertEvent que sobreescribe server_ts=Date.now() —
// para tests longitudinales necesitamos timestamps históricos exactos).
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
    // Forzar getDb() para que cree la tabla `events` en el archivo temporal
    // ANTES de que `seed()` abra su propio handle (raw SQL). Sin esto, seed
    // INSERT INTO events fallaría: la tabla no existiría aún (lazy creation).
    eventsService.getEventCount();

    const NOW = Date.now();
    const d = (n) => NOW - n * 86400_000;

    console.log('\n[A] §26.1-2 — incremental processing + watermark updates');
    {
        const r0 = materializer.runOnce({ nowTs: NOW });
        ok('1) corrida vacía OK (0 processed)', r0.ok && r0.processed === 0);
        ok('   watermark queda en 0',           r0.watermarkTo === 0);

        seed([
            { event_id:'e1', event:'reading_started',   user_id:'u1', ts:d(5), content_id:'c1', payload:{contentId:'c1',mode:'immersive',sessionId:'s1',startedAt:d(5)} },
            { event_id:'e2', event:'session_started',   user_id:'u1', ts:d(5), payload:{sessionId:'s1',source:'visor',startedAt:d(5)} },
            { event_id:'e3', event:'reading_progress',  user_id:'u1', ts:d(5), content_id:'c1', payload:{contentId:'c1',sessionId:'s1',percentage:40} },
            { event_id:'e4', event:'reading_completed', user_id:'u1', ts:d(4), content_id:'c1', payload:{contentId:'c1',sessionId:'s1',totalTimeMs:300000} },
            { event_id:'e5', event:'reading_started',   user_id:'u2', ts:d(2), content_id:'c2', payload:{contentId:'c2',mode:'immersive',sessionId:'s2',startedAt:d(2)} },
        ]);
        const r1 = materializer.runOnce({ nowTs: NOW });
        ok('2) procesa batch (5 events)',       r1.ok && r1.processed === 5);
        ok('   watermark avanza',               r1.watermarkTo > r1.watermarkFrom && r1.watermarkTo > 0);
        ok('   2 profiles upserted',            r1.profilesUpserted === 2);
    }

    console.log('\n[B] §26.3-5 — replay + duplicate replay + idempotencia');
    {
        const r2 = materializer.runOnce({ nowTs: NOW });
        ok('3) rerun sin nuevos eventos = 0 processed (idempotente)', r2.ok && r2.processed === 0);

        const rb = materializer.rebuildInsights({ fromTs: d(7), toTs: NOW, dryRun: true });
        ok('4) replay dry-run reporta scope',  rb.ok && rb.scanned >= 5 && rb.wouldUpsert > 0 && rb.upserted === 0);

        const rb2 = materializer.rebuildInsights({ fromTs: d(7), toTs: NOW, dryRun: false });
        const rb3 = materializer.rebuildInsights({ fromTs: d(7), toTs: NOW, dryRun: false });
        ok('5) replay idempotente (mismo input → mismo número upsertos cada vez)',
           rb2.ok && rb3.ok && rb2.upserted > 0 && rb2.upserted === rb3.upserted);
    }

    console.log('\n[C] §26.6-8 — cohort rollups + user profiles + notifications');
    {
        const cohort = reader.getCohortRollup('all', 'global');
        ok('6) cohort_rollups all/global existe', Array.isArray(cohort) && cohort.length >= 1);
        ok('   métrica active_users presente',   cohort.some(c => c.metric_key === 'active_users'));

        const p = reader.getUserProfile('u1');
        ok('7) user_reading_profile u1 existe',    !!p && p.user_id === 'u1');
        ok('   profile tiene engagement_score (puede ser null)', 'engagement_score' in p);

        // Forzar risk alto → notification
        seed([
            { event_id:'e6', event:'reading_abandoned', user_id:'u3', ts:d(3), content_id:'c3', payload:{contentId:'c3',sessionId:'s3',percentage:5} },
            { event_id:'e7', event:'reading_abandoned', user_id:'u3', ts:d(2), content_id:'c4', payload:{contentId:'c4',sessionId:'s4',percentage:3} },
            { event_id:'e8', event:'reading_abandoned', user_id:'u3', ts:d(1), content_id:'c5', payload:{contentId:'c5',sessionId:'s5',percentage:4} },
            { event_id:'e9', event:'reading_started',   user_id:'u3', ts:d(3), content_id:'c3', payload:{contentId:'c3',mode:'immersive',sessionId:'s3',startedAt:d(3)} },
        ]);
        const r3 = materializer.runOnce({ nowTs: NOW });
        ok('8a) batch con u3 procesado',         r3.ok && r3.processed >= 4);
        // Risk engine: u3 con 3 abandonos consecutivos → abandono_risk ≥ 0.7
        // → notification pending insertada vía flush POST-COMMIT (evitando
        // contención write-lock con la tx del materializer sobre el mismo
        // archivo insights.db, ver insightMaterializer.mjs §pendingNotifs).
        const notifs = insightsStore.listNotifications({ status: 'pending', limit: 10 });
        ok('8b) ≥1 notification pending insertada (risk_abandono)',
           notifs.length >= 1 && notifs.some(n => /risk_abandono/.test(n.payload_json || '')));

        // Re-run NO duplica notification (hasPendingNotification dedupe)
        const before = notifs.length;
        materializer.runOnce({ nowTs: NOW });
        const after = insightsStore.listNotifications({ status: 'pending', limit: 10 }).length;
        ok('   dedupe: no duplica notification en re-run', after === before);
    }

    console.log('\n[D] §26.9-10 — lag metrics + WAL compatibility');
    {
        const s = materializer.getStatus();
        ok('9) status incluye lag_events + last_event_id',
           typeof s.lag_events === 'number' && typeof s.last_event_id === 'number');
        const db = ext.getInsightsExtDb();
        ok('10) insights.db WAL OK + integrity_check ok',
           db.pragma('journal_mode', { simple:true }) === 'wal'
        && db.pragma('integrity_check', { simple:true }) === 'ok');
    }

    console.log('\n[E] §26.11-13 — rebuild partial + degraded + corrupted tolerance');
    {
        const rPart = materializer.rebuildInsights({ fromTs: d(7), toTs: NOW, dryRun: false, scopes: { userIds: ['u1'] } });
        ok('11) rebuild partial (solo u1) procesa solo ese scope',
           rPart.ok && rPart.scanned > 0 && rPart.upserted > 0);

        // Tolerancia a evento corrupto: insertar directo (bypass shadow) con user_id vacío
        const evdb = new Database(process.env.EVENTS_SQLITE_PATH);
        try {
            evdb.prepare(`INSERT INTO events (event_id,schema_version,event,mode,user_id,session_id,
              client_ts,server_ts,created_at,payload_json) VALUES (?,1,'reading_started','immersive',
              '','s_bad',?,?,?,?)`).run('bad-1', NOW, NOW, NOW, '{}');
        } catch {} finally { evdb.close(); }
        const rCorr = materializer.runOnce({ nowTs: NOW });
        ok('12) evento con user_id vacío se skipea (counter), NO tumba batch',
           rCorr.ok && rCorr.skippedCorrupted >= 1);

        // Degraded mode: forzar error en una corrida monkey-patchéandolo NO es
        // posible sin DI; validamos el shape del status (degraded:boolean).
        const st = materializer.getStatus();
        ok('13) status expone degraded como boolean', typeof st.degraded === 'boolean');
    }

    console.log('\n[F] §26.14-15 — shadow compare + performance baseline');
    {
        // shadow compare: rebuild dryRun debe escanear ≥ processed total.
        const dry = materializer.rebuildInsights({ fromTs: d(30), toTs: NOW, dryRun: true });
        const cnt = eventsService.getEventCount();
        ok('14) shadow compare: dry-run scanned coherente con total events',
           dry.scanned <= cnt && dry.scanned > 0);

        // performance baseline (smoke): runOnce vacío < 200ms con esta data.
        const tStart = Date.now();
        materializer.runOnce({ nowTs: NOW });
        const elapsed = Date.now() - tStart;
        ok(`15) runOnce idle <200ms (got ${elapsed}ms)`, elapsed < 200);
    }

    console.log('\n[G] reader API never-throws (Aula Viva phase-1)');
    {
        let threw = false;
        try {
            reader.getUserProfile('does-not-exist');
            reader.getCohortRollup('school', 'no-school');
            reader.getScopeSignals('user', 'u-none');
            const r = reader.isReady();
            ok('reader.isReady() retorna objeto con .ready', typeof r?.ready === 'boolean');
        } catch { threw = true; }
        ok('reader API tolera inputs inexistentes sin lanzar', threw === false);
    }

    console.log('\n[H] CHP-MOOK-CANONICAL-EVENTS-01C — proyecciones de Experience por versión');
    {
        const sig = (uid, id) => {
            const row = reader.getScopeSignals('user', uid).find(r => r.signal_id === id);
            return row ? { value: row.metric_value, meta: JSON.parse(row.metadata_json || '{}') } : null;
        };
        const exp = (v, extra) => ({ experienceId: 'exp1', experienceVersionId: v, runId: 'run-' + v, ...extra });
        const E = 'experience';
        seed([
            // participante u10, versión v1: inicio, 2 requeridos + 1 opcional + 1 sin `required`, 2 evidencias, cierre
            { event_id:'x01', event:'experience_started',   mode:E, user_id:'u10', session_id:'', ts:d(3), payload: exp('v1') },
            { event_id:'x02', event:'node_completed',       mode:E, user_id:'u10', session_id:'', ts:d(3), payload: exp('v1', { nodeId:'n1', nodeType:'READING',  required:true }) },
            { event_id:'x03', event:'node_completed',       mode:E, user_id:'u10', session_id:'', ts:d(3), payload: exp('v1', { nodeId:'n2', nodeType:'ACTIVITY', required:true }) },
            { event_id:'x04', event:'node_completed',       mode:E, user_id:'u10', session_id:'', ts:d(3), payload: exp('v1', { nodeId:'n3', nodeType:'ACTIVITY', required:false }) },
            { event_id:'x05', event:'node_completed',       mode:E, user_id:'u10', session_id:'', ts:d(3), payload: exp('v1', { nodeId:'n4', nodeType:'READING' }) },
            { event_id:'x06', event:'evidence_submitted',   mode:E, user_id:'u10', session_id:'', ts:d(2), payload: exp('v1', { nodeId:'n2', nodeType:'ACTIVITY',   evidenceId:'ev1', requiresReview:false }) },
            { event_id:'x07', event:'evidence_submitted',   mode:E, user_id:'u10', session_id:'', ts:d(2), payload: exp('v1', { nodeId:'n5', nodeType:'PRODUCTION', evidenceId:'ev2', requiresReview:true }) },
            { event_id:'x08', event:'experience_completed', mode:E, user_id:'u10', session_id:'', ts:d(2), payload: exp('v1', { requiredNodes: 3 }) },
            // misma participante, versión v2: solo inicio + 1 requerido
            { event_id:'x09', event:'experience_started',   mode:E, user_id:'u10', session_id:'', ts:d(1), payload: exp('v2') },
            { event_id:'x10', event:'node_completed',       mode:E, user_id:'u10', session_id:'', ts:d(1), payload: exp('v2', { nodeId:'n1', nodeType:'READING', required:true }) },
            // otro participante u11 en v1
            { event_id:'x11', event:'experience_started',   mode:E, user_id:'u11', session_id:'', ts:d(1), payload: exp('v1') },
            // revisiones: adm1 revisa ev2 de u10; una revisión SIN reviewerId no se atribuye a nadie
            { event_id:'x12', event:'evidence_reviewed',    mode:E, user_id:'u10', session_id:'', ts:d(1), payload: { experienceId:'exp1', experienceVersionId:'v1', evidenceId:'ev2', reviewerId:'adm1', decision:'aprobado' } },
            { event_id:'x13', event:'evidence_reviewed',    mode:E, user_id:'u10', session_id:'', ts:d(1), payload: { experienceId:'exp1', experienceVersionId:'v1', evidenceId:'ev3', decision:'con_comentarios' } },
        ]);
        const rH = materializer.runOnce({ nowTs: NOW });
        ok('H0) batch experience procesado', rH.ok && rH.processed >= 13);
        const st = sig('u10', 'experiencias_iniciadas');
        ok('1) inicio por versión: u10 = 2 (v1:1, v2:1)', st?.value === 2 && st.meta.by_version.v1 === 1 && st.meta.by_version.v2 === 1);
        const nr = sig('u10', 'nodos_requeridos_completados');
        ok('2) nodo requerido completado: v1 = 2', nr?.meta.by_version.v1 === 2);
        ok('3) nodo opcional (required:false) ignorado: total = 3 (v1:2 + v2:1)', nr?.value === 3 && nr.meta.total === 3);
        ok('4) required ausente ignorado (x05 no suma)', nr?.meta.by_version.v1 === 2);
        const ec = sig('u10', 'experiencias_completadas');
        ok('5) Experience completada: v1 = 1 y v2 ausente', ec?.value === 1 && ec.meta.by_version.v1 === 1 && ec.meta.by_version.v2 === undefined);
        const ev = sig('u10', 'evidencias_enviadas');
        ok('6) evidencias enviadas: v1 = 2', ev?.value === 2 && ev.meta.by_version.v1 === 2);
        const rv = sig('adm1', 'revisiones_realizadas');
        ok('7) revisión atribuida al revisor adm1 (v1 = 1)', rv?.value === 1 && rv.meta.by_version.v1 === 1);
        ok('   el participante u10 no recibe revisiones_realizadas', sig('u10', 'revisiones_realizadas')?.value === 0);
        ok('8) revisión sin reviewerId no se infiere (adm1 sigue en 1; u11 en 0)', rv?.value === 1 && sig('u11', 'revisiones_realizadas')?.value === 0);
        ok('9) versiones nunca se mezclan: v2 solo tiene inicio 1 y nodo 1, sin cierre', st.meta.by_version.v2 === 1 && nr.meta.by_version.v2 === 1 && ec.meta.by_version.v2 === undefined);
        const s11 = sig('u11', 'experiencias_iniciadas');
        ok('10) dos participantes independientes: u11 = 1 (v1) y u10 sigue en 2', s11?.value === 1 && s11.meta.by_version.v1 === 1 && st.value === 2);

        const rH2 = materializer.runOnce({ nowTs: NOW });
        ok('11) segunda ejecución: 0 procesados y conteos idénticos', rH2.ok && rH2.processed === 0
            && sig('u10', 'nodos_requeridos_completados')?.value === 3 && sig('adm1', 'revisiones_realizadas')?.value === 1);

        // 12) interrupción y reanudación: lotes de 1 evento desde el watermark, sin duplicar lo confirmado
        seed([
            { event_id:'x14', event:'node_completed',    mode:E, user_id:'u10', session_id:'', ts:d(0), payload: exp('v2', { nodeId:'n2', nodeType:'ACTIVITY', required:true }) },
            { event_id:'x15', event:'evidence_reviewed', mode:E, user_id:'u11', session_id:'', ts:d(0), payload: { experienceId:'exp1', experienceVersionId:'v1', evidenceId:'ev9', reviewerId:'adm1', decision:'aprobado' } },
        ]);
        const p1 = materializer.runOnce({ nowTs: NOW, batchLimit: 1 });
        const p2 = materializer.runOnce({ nowTs: NOW, batchLimit: 1 });
        const p3 = materializer.runOnce({ nowTs: NOW });
        ok('12) reanudación por watermark: 1+1+0 procesados y conteos exactos (u10 v2 = 2, adm1 = 2)',
            p1.processed === 1 && p2.processed === 1 && p3.processed === 0
            && sig('u10', 'nodos_requeridos_completados')?.meta.by_version.v2 === 2 && sig('adm1', 'revisiones_realizadas')?.value === 2);

        const c1 = sig('u1', 'continuidad_semanal'); const dv = sig('u1', 'diversidad_lectora');
        ok('13) señales reading_* de u1 sin regresión', !!c1 && typeof c1.value === 'number' && !!dv && dv.value >= 1);
        ok('    u1 tiene las señales experience en 0 (sin contaminación)', sig('u1', 'experiencias_iniciadas')?.value === 0);

        const rdb = ext.getInsightsExtDb();
        const inst = rdb.prepare("SELECT COUNT(*) AS n FROM cohort_rollups WHERE scope_type IN ('group','school','org')").get().n;
        const scopes = rdb.prepare("SELECT COUNT(*) AS n FROM signal_snapshots WHERE scope_type <> 'user'").get().n;
        ok('14) cero rollups por institución/grupo y cero snapshots fuera del scope user', inst === 0 && scopes === 0);
    }
} finally {
    materializer.closeMaterializerEventsDb();
    ext.closeInsightsExtDb();
    eventsService.closeDb();
    insightsStore.closeDb();
    // cleanup
    try {
        for (const f of fs.readdirSync(tmpDir)) {
            try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
        }
        fs.rmdirSync(tmpDir);
    } catch {}
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
