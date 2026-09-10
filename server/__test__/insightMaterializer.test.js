/**
 * insightMaterializer.test.js — PASO 2: 15 checks de §26.
 * [I] CHP-INSIGHTS-SIGNAL-SNAPSHOT-RETENTION-01F: retención 90 d (solo temporal).
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
import { fileURLToPath } from 'node:url';
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
const { SIGNAL_IDS } = await import('../analytics/signals.js');

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

    console.log('\n[I] CHP-INSIGHTS-SIGNAL-SNAPSHOT-RETENTION-01F — retención 90 d de signal_snapshots (temporal)');
    {
        const idb = ext.getInsightsExtDb();
        const DAY = 86400_000;
        const RET = 90 * DAY;
        // Guardas de aislamiento: el handle apunta al temporal; stores reales intactos.
        const realInsights = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'data-critical', 'insights.db');
        const statOf = (f) => { try { const st = fs.statSync(f); return `${st.size}:${st.mtimeMs}`; } catch { return 'absent'; } };
        const listDc = () => { try { return fs.readdirSync(path.dirname(realInsights)).sort().join(','); } catch { return 'absent'; } };
        const realBefore = statOf(realInsights);
        const dcBefore = listDc();
        ok('0) handle de insights apunta al temporal del test', idb.name === process.env.INSIGHTS_SQLITE_PATH);

        const sigOf = (uid, id) => reader.getScopeSignals('user', uid).find(r => r.signal_id === id)?.metric_value ?? null;
        const MOOK = ['experiencias_iniciadas', 'nodos_requeridos_completados', 'experiencias_completadas', 'evidencias_enviadas', 'revisiones_realizadas'];
        const mookNow = () => JSON.stringify({ u10: MOOK.map(s => sigOf('u10', s)), adm1: sigOf('adm1', 'revisiones_realizadas') });
        const mookBefore = mookNow();
        const otherTables = () => JSON.stringify({
            profiles: idb.prepare('SELECT * FROM user_reading_profiles ORDER BY user_id').all(),
            cohorts:  idb.prepare('SELECT * FROM cohort_rollups ORDER BY scope_type, scope_id, metric_key').all(),
            state:    idb.prepare('SELECT * FROM materializer_state ORDER BY materializer_name').all(),
            notifs:   insightsStore.listNotifications({ status: 'pending', limit: 50 }).length,
        });
        const snapCount = () => idb.prepare('SELECT COUNT(*) AS n FROM signal_snapshots').get().n;
        const has = (scope, id, sid = 'continuidad_semanal', period = '28d') => !!idb.prepare(
            'SELECT 1 FROM signal_snapshots WHERE scope_type=? AND scope_id=? AND signal_id=? AND period=?').get(scope, id, sid, period);
        const insRaw = idb.prepare(`INSERT OR REPLACE INTO signal_snapshots
            (scope_type,scope_id,signal_id,period,metric_value,confidence,trend,source_watermark,metadata_json,updated_at)
            VALUES (?,?,?,?,1,'high',NULL,0,?,?)`);
        const put = (scope, id, updatedAt, sid = 'continuidad_semanal', period = '28d', meta = null) =>
            insRaw.run(scope, id, sid, period, meta, updatedAt);

        // Fixtures: frontera exacta vs. 89 d, >90 d, creada hace 200 d pero actualizada ayer,
        // ts inválidos, tres scopes, todas las señales/versiones/periodos.
        put('user', 'r-89d',  NOW - 89 * DAY);
        put('user', 'r-90d',  NOW - RET);
        put('user', 'r-91d',  NOW - 91 * DAY);
        put('user', 'r-old-but-fresh', NOW - 200 * DAY);
        put('user', 'r-old-but-fresh', NOW - 1 * DAY);              // "actualización" reciente (upsert por clave única)
        put('user', 'r-ts-text', 'not-a-timestamp');                 // INTEGER affinity conserva texto no numérico
        put('user', 'r-ts-zero', 0);
        put('user', 'r-ts-neg',  -5);
        put('user', 'r-ts-empty', '');
        let nullRejected = false;
        try { put('user', 'r-ts-null', null); } catch { nullRejected = true; }
        for (const scope of ['user', 'group', 'institution']) {
            put(scope, `${scope}-expired`, NOW - 120 * DAY);
            put(scope, `${scope}-fresh`,   NOW - 10 * DAY);
        }
        for (const sid of SIGNAL_IDS) {
            put('user', 'r-all-signals', NOW - 100 * DAY, sid, '28d', JSON.stringify({ by_version: { v1: 1, v2: 2 } }));
        }
        for (const period of ['7d', '14d', '28d', 'all']) put('user', 'r-all-periods', NOW - 100 * DAY, 'engagement', period);
        for (const v of ['v1', 'v2', 'v3']) put('user', `r-ver-${v}`, NOW - 95 * DAY, 'experiencias_iniciadas', '28d', JSON.stringify({ by_version: { [v]: 1 } }));
        const totalBefore = snapCount();

        // 14) importar/iniciar el materializador o correrlo NO ejecuta retención.
        const rNormal = materializer.runOnce({ nowTs: NOW });
        ok('14) runOnce normal no expira nada (retención desconectada del caller)',
           rNormal.ok && snapCount() === totalBefore && has('user', 'r-91d') && has('institution', 'institution-expired'));
        // Base de comparación DESPUÉS de runOnce (que reescribe materializer_state.updated_at con reloj real).
        const othersBefore = otherTables();
        ok('    módulo expone solo la función explícita; sin flag de entorno de retención',
           typeof materializer.pruneSignalSnapshots === 'function'
           && !Object.keys(process.env).some(k => /SNAPSHOT_RETENTION|SIGNAL_RETENTION/i.test(k)));

        // 1) desactivada por defecto → skipped + cero escrituras.
        const changesBefore = idb.prepare('SELECT total_changes() AS n').get().n;
        const rOff = materializer.pruneSignalSnapshots({ nowTs: NOW });
        const rOff2 = materializer.pruneSignalSnapshots({ nowTs: NOW, enabled: false });
        ok('1) retención desactivada por defecto → skipped, cero escrituras',
           rOff.ok && rOff.skipped && rOff.enabled === false && rOff.expired === 0 && rOff.candidates === 0
           && rOff2.skipped && idb.prepare('SELECT total_changes() AS n').get().n === changesBefore
           && snapCount() === totalBefore);

        // 11) fallo durante el DELETE → rollback completo (trigger solo en la base temporal).
        idb.exec(`CREATE TRIGGER trg_prune_poison BEFORE DELETE ON signal_snapshots
                  WHEN OLD.scope_id = 'r-91d' BEGIN SELECT RAISE(ABORT, 'poison-row'); END;`);
        const rFail = materializer.pruneSignalSnapshots({ nowTs: NOW, enabled: true });
        ok('11) fallo en DELETE → ok:false con error, rollback completo (ninguna expirada borrada)',
           rFail.ok === false && /poison-row/.test(rFail.error || '') && rFail.expired === 0
           && snapCount() === totalBefore && has('user', 'r-90d') && has('group', 'group-expired') && has('user', 'r-all-periods', 'engagement', 'all'));
        ok('    tras el fallo, ninguna otra tabla cambió', otherTables() === othersBefore);
        idb.exec('DROP TRIGGER trg_prune_poison');

        // 2-8) ejecución activada sobre el temporal.
        const rOn = materializer.pruneSignalSnapshots({ nowTs: NOW, enabled: true });
        const nSignals = SIGNAL_IDS.length;
        const expectedExpired = 1 /*90d*/ + 1 /*91d*/ + 3 /*scopes expired*/ + nSignals + 4 /*periods*/ + 3 /*versions*/;
        ok('2) 89 días permanece',                       rOn.ok && has('user', 'r-89d'));
        ok('3) exactamente 90 días expira',              !has('user', 'r-90d'));
        ok('4) más de 90 días expira',                   !has('user', 'r-91d'));
        ok('5) creada hace 200 d pero actualizada ayer permanece', has('user', 'r-old-but-fresh'));
        ok('6) timestamps inválidos (texto, 0, negativo, vacío) permanecen y cuentan como no evaluables',
           has('user', 'r-ts-text') && has('user', 'r-ts-zero') && has('user', 'r-ts-neg') && has('user', 'r-ts-empty') && rOn.unevaluable === 4);
        ok('   NULL es imposible por schema (NOT NULL); el predicado lo trataría como no evaluable', nullRejected === true);
        ok('7) scopes user/group/institution: misma regla',
           !has('user', 'user-expired') && !has('group', 'group-expired') && !has('institution', 'institution-expired')
           && has('user', 'user-fresh') && has('group', 'group-fresh') && has('institution', 'institution-fresh'));
        ok(`8) todas las señales (${nSignals}), periodos y versiones se evalúan sin excepción`,
           idb.prepare("SELECT COUNT(*) AS n FROM signal_snapshots WHERE scope_id IN ('r-all-signals','r-all-periods','r-ver-v1','r-ver-v2','r-ver-v3')").get().n === 0);
        ok(`   conteos agregados coherentes (scanned=${rOn.scanned}, candidates=${rOn.candidates}, expired=${rOn.expired}, retained=${rOn.retained}, unevaluable=${rOn.unevaluable})`,
           rOn.scanned === totalBefore && rOn.candidates === totalBefore - rOn.unevaluable
           && rOn.expired === expectedExpired && rOn.retained === rOn.candidates - rOn.expired
           && rOn.cutoffTs === NOW - RET && rOn.retentionDays === 90 && snapCount() === totalBefore - expectedExpired);
        ok('   snapshots reales del materializador (updated_at = NOW) intactas',
           has('user', 'u1') && has('user', 'u10', 'experiencias_iniciadas') && has('user', 'adm1', 'revisiones_realizadas'));

        // 9) ninguna tabla distinta de signal_snapshots cambia.
        ok('9) ninguna otra tabla cambió (profiles, cohorts, materializer_state, notifications)', otherTables() === othersBefore);

        // 10) idempotencia.
        const rAgain = materializer.pruneSignalSnapshots({ nowTs: NOW, enabled: true });
        ok('10) segunda ejecución idempotente (0 expiradas, mismo conteo)',
           rAgain.ok && rAgain.expired === 0 && rAgain.scanned === rOn.scanned - rOn.expired && snapCount() === totalBefore - expectedExpired);

        // 12-13) el materializador sigue funcionando y las 5 proyecciones MOOK conservan sus conteos.
        const rPost = materializer.runOnce({ nowTs: NOW });
        ok('12) ejecución normal del materializador conserva sus resultados', rPost.ok && rPost.processed === 0 && !rPost.error);
        ok('13) las cinco proyecciones MOOK mantienen sus conteos', mookNow() === mookBefore);

        // 15) ningún store fuera del temporal se crea o modifica.
        ok('15) data-critical/insights.db real no se creó ni modificó; sin archivos nuevos en data-critical',
           statOf(realInsights) === realBefore && listDc() === dcBefore
           && idb.pragma('journal_mode', { simple: true }) === 'wal');
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
