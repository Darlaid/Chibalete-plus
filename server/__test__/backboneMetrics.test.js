/**
 * backboneMetrics.test.js — Sprint Data Backbone Fase 3
 *
 * Cubre dos capas:
 *   1. aggregateBackboneMetrics (pure) — fixtures en memoria, sin DB.
 *   2. eventsService getBackboneEvents* — DB real temporal.
 *
 * Ejecutar:
 *   node server/__test__/backboneMetrics.test.js
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// DB temporal aislada — no contamina la DB de dev.
const TMP_DB_PATH = path.resolve(__dirname, '../../.tmp-backbone-metrics-test.db');
process.env.EVENTS_SQLITE_PATH = TMP_DB_PATH;

for (const ext of ['', '-shm', '-wal']) {
    const f = TMP_DB_PATH + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
}

const {
    aggregateBackboneMetrics,
    emptyBackboneMetrics,
} = await import('../backboneMetrics.js');
const {
    insertEvent,
    getBackboneEventsForMetrics,
    getBackboneEventStats,
    closeDb,
} = await import('../eventsService.js');
const { ulid } = await import('../ulid.js');

let pass = 0;
let fail = 0;
function assert(cond, label, detail = '') {
    if (cond) { pass += 1; console.log(`  ✓ ${label}`); }
    else      { fail += 1; console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`); }
}

const baseEvent = (overrides = {}) => ({
    eventId:       ulid(),
    schemaVersion: 1,
    event:         'a11y.session_start',
    mode:          'a11y',
    userId:        'user-1',
    contentId:     'book-1',
    sessionId:     'sess-base',
    clientTs:      Date.now(),
    ...overrides,
});

// ──────────────────────────────────────────────────────────────────────────
// TEST 1 — events vacíos
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 1] aggregateBackboneMetrics() con eventos vacíos');
{
    const m = aggregateBackboneMetrics([], { windowDays: 30 });
    assert(m.totalEvents === 0,        'totalEvents = 0');
    assert(m.totalSessions === 0,      'totalSessions = 0');
    assert(typeof m.usageByMode === 'object', 'usageByMode es objeto');
    assert(Object.keys(m.usageByMode).length === 0, 'usageByMode vacío');
    assert(m.immersiveAudio.audioPlayCount === 0, 'audioPlayCount = 0');
    assert(m.a11yAdoption.users === 0, 'a11yAdoption.users = 0');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 2 — sesión completa con start + end
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 2] sesión completa start+end (a11y, 5 min)');
{
    const sid = 'sess-2-complete';
    const events = [
        baseEvent({ event: 'a11y.session_start',   sessionId: sid, clientTs: 1000 }),
        baseEvent({ event: 'a11y.session_heartbeat', sessionId: sid, clientTs: 1000 + 15_000, elapsedMs: 15_000, progressFraction: 0.10 }),
        baseEvent({ event: 'a11y.session_end',     sessionId: sid, clientTs: 1000 + 300_000, elapsedMs: 300_000, progressFraction: 0.45 }),
    ];
    const m = aggregateBackboneMetrics(events, { windowDays: 30 });
    assert(m.totalSessions === 1,                              'totalSessions = 1');
    assert(m.usageByMode.a11y.sessionStarts === 1,             'sessionStarts = 1');
    assert(m.usageByMode.a11y.sessionEnds === 1,               'sessionEnds = 1');
    assert(m.usageByMode.a11y.heartbeats === 1,                'heartbeats = 1');
    assert(m.readingTimeByMode.a11y.totalElapsedMs === 300_000,'totalElapsedMs = 300k');
    assert(m.readingTimeByMode.a11y.completedSessions === 1,   'completedSessions = 1');
    assert(m.readingTimeByMode.a11y.openSessionsEstimate === 0,'openSessionsEstimate = 0');
    assert(m.readingTimeByMode.a11y.estimatedFromHeartbeat === false, 'NO estimado desde heartbeat');
    assert(Math.abs(m.progressByMode.a11y.maxProgressFraction - 0.45) < 1e-6, 'maxProgress = 0.45');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 3 — sesión sin session_end pero con heartbeat → estimación
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 3] sesión SIN session_end, con heartbeats (estimar tiempo)');
{
    const sid = 'sess-3-open';
    const events = [
        baseEvent({ event: 'text.session_start',     mode: 'text', sessionId: sid, clientTs: 0 }),
        baseEvent({ event: 'text.session_heartbeat', mode: 'text', sessionId: sid, clientTs: 60_000,  elapsedMs: 60_000,  progressFraction: 0.05 }),
        baseEvent({ event: 'text.session_heartbeat', mode: 'text', sessionId: sid, clientTs: 120_000, elapsedMs: 120_000, progressFraction: 0.10 }),
    ];
    const m = aggregateBackboneMetrics(events, { windowDays: 30 });
    assert(m.readingTimeByMode.text.totalElapsedMs === 120_000,         'totalElapsedMs = 120k (último heartbeat)');
    assert(m.readingTimeByMode.text.completedSessions === 0,            'completedSessions = 0');
    assert(m.readingTimeByMode.text.openSessionsEstimate === 1,         'openSessionsEstimate = 1');
    assert(m.readingTimeByMode.text.estimatedFromHeartbeat === true,    'estimatedFromHeartbeat = true');
    assert(m.heartbeatCoverage.text.sessionsWithHeartbeat === 1,        'heartbeatCoverage 1');
    assert(m.heartbeatCoverage.text.coveragePercent === 100,            'coverage 100%');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 4 — eventos error a11y.error → errorsByMode
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 4] errores a11y.error');
{
    const sid = 'sess-4-err';
    const events = [
        baseEvent({ event: 'a11y.session_start', sessionId: sid }),
        baseEvent({ event: 'a11y.error', sessionId: sid, payload: { errorType: 'parse_failed' } }),
        baseEvent({ event: 'a11y.error', sessionId: sid, payload: { errorType: 'parse_failed' } }),
        baseEvent({ event: 'a11y.error', sessionId: sid, userId: 'user-2', payload: { errorType: 'doc_empty' } }),
    ];
    const m = aggregateBackboneMetrics(events, { windowDays: 30 });
    assert(m.errorsByMode.a11y.errorCount === 3,                      'errorCount = 3');
    assert(m.errorsByMode.a11y.errorTypes.parse_failed === 2,         'parse_failed x2');
    assert(m.errorsByMode.a11y.errorTypes.doc_empty === 1,            'doc_empty x1');
    assert(m.errorsByMode.a11y.affectedUsers === 2,                   'affectedUsers = 2');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 5 — eventos immersive.audio_play / audio_pause
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 5] immersiveAudio counters');
{
    const sid1 = 'sess-5-a';
    const sid2 = 'sess-5-b';
    const events = [
        baseEvent({ event: 'immersive.session_start', mode: 'immersive', sessionId: sid1 }),
        baseEvent({ event: 'immersive.audio_play',    mode: 'immersive', sessionId: sid1 }),
        baseEvent({ event: 'immersive.audio_pause',   mode: 'immersive', sessionId: sid1 }),
        baseEvent({ event: 'immersive.audio_play',    mode: 'immersive', sessionId: sid1 }),
        baseEvent({ event: 'immersive.session_start', mode: 'immersive', sessionId: sid2 }),
        // sid2 sin audio_play
    ];
    const m = aggregateBackboneMetrics(events, { windowDays: 30 });
    assert(m.immersiveAudio.audioPlayCount === 2,           'audioPlayCount = 2');
    assert(m.immersiveAudio.audioPauseCount === 1,          'audioPauseCount = 1');
    assert(m.immersiveAudio.audioSessions === 1,            'audioSessions = 1 (solo sid1)');
    assert(Math.abs(m.immersiveAudio.averagePlayPauseRatio - (2 / 3)) < 1e-6, 'ratio = 2/3');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 6 — múltiples modos coexisten
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 6] múltiples modos (text + immersive + a11y)');
{
    const events = [
        baseEvent({ event: 'text.session_start',      mode: 'text',      sessionId: 't1', userId: 'u-A' }),
        baseEvent({ event: 'text.session_end',        mode: 'text',      sessionId: 't1', userId: 'u-A', elapsedMs: 60_000 }),
        baseEvent({ event: 'immersive.session_start', mode: 'immersive', sessionId: 'i1', userId: 'u-A' }),
        baseEvent({ event: 'immersive.session_end',   mode: 'immersive', sessionId: 'i1', userId: 'u-A', elapsedMs: 120_000, progressFraction: 0.20 }),
        baseEvent({ event: 'a11y.session_start',      mode: 'a11y',      sessionId: 'a1', userId: 'u-B' }),
        baseEvent({ event: 'a11y.session_end',        mode: 'a11y',      sessionId: 'a1', userId: 'u-B', elapsedMs: 180_000, progressFraction: 1.0 }),
    ];
    const m = aggregateBackboneMetrics(events, { windowDays: 30 });
    assert(m.totalSessions === 3,                             'totalSessions = 3');
    assert(m.usageByMode.text.activeUsers === 1,              'text activeUsers = 1');
    assert(m.usageByMode.immersive.activeUsers === 1,         'immersive activeUsers = 1');
    assert(m.usageByMode.a11y.activeUsers === 1,              'a11y activeUsers = 1');
    assert(m.readingTimeByMode.text.totalElapsedMs === 60_000, 'text totalElapsedMs = 60k');
    assert(m.readingTimeByMode.immersive.totalElapsedMs === 120_000, 'immersive totalElapsedMs = 120k');
    assert(m.readingTimeByMode.a11y.totalElapsedMs === 180_000,'a11y totalElapsedMs = 180k');
    assert(m.progressByMode.a11y.completedCount === 1,        'a11y completedCount = 1 (>= 0.98)');
    assert(m.a11yAdoption.users === 1,                        'a11yAdoption.users = 1');
    assert(m.a11yAdoption.sessions === 1,                     'a11yAdoption.sessions = 1');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 7 — payload corrupto en eventsService → no rompe lectura
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 7] payload_json corrupto en DB → payload = {}');
{
    // Insertamos un evento válido y luego corrompemos su payload_json directamente
    // en la tabla SQLite para simular una fila vieja con datos malos.
    const validEvent = baseEvent({
        event: 'a11y.error',
        sessionId: 'sess-corrupt',
        payload: { errorType: 'doc_empty' },
    });
    insertEvent(validEvent);

    // Acceso directo a la DB via better-sqlite3 para corromper.
    const Database = (await import('better-sqlite3')).default;
    const db = new Database(TMP_DB_PATH);
    db.prepare('UPDATE events SET payload_json = ? WHERE event_id = ?')
        .run('{this is not json', validEvent.eventId);
    db.close();

    const result = getBackboneEventsForMetrics({ windowDays: 30 });
    const corrupted = result.events.find(e => e.eventId === validEvent.eventId);
    assert(corrupted !== undefined,                       'evento sigue siendo leído');
    assert(typeof corrupted.payload === 'object',         'payload es objeto');
    assert(Object.keys(corrupted.payload).length === 0,   'payload = {}');
    // Verificamos que el agregador no rompe con esa fila.
    const m = aggregateBackboneMetrics(result.events, { windowDays: 30 });
    assert(m.totalEvents === result.events.length,        'aggregator no descarta evento corrupto');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 8 — eventsService.getBackboneEventStats devuelve conteos por modo
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 8] getBackboneEventStats — conteos por modo');
{
    // Insertamos eventos frescos de cada modo.
    const now = Date.now();
    const insertN = (count, mode, eventName) => {
        for (let i = 0; i < count; i++) {
            insertEvent({
                eventId:       ulid(),
                schemaVersion: 1,
                event:         eventName,
                mode,
                userId:        'u-stats',
                contentId:     'c-stats',
                sessionId:     `s-stats-${mode}`,
                clientTs:      now,
            });
        }
    };
    insertN(3, 'text',      'text.session_start');
    insertN(2, 'immersive', 'immersive.audio_play');
    insertN(1, 'a11y',      'a11y.session_end');

    const stats = getBackboneEventStats({ sinceTs: now - 60_000 });
    assert(typeof stats.byMode === 'object',            'stats.byMode es objeto');
    assert((stats.byMode.text      ?? 0) >= 3,          'text >= 3');
    assert((stats.byMode.immersive ?? 0) >= 2,          'immersive >= 2');
    assert((stats.byMode.a11y      ?? 0) >= 1,          'a11y >= 1');
    assert(stats.total >= 6,                            'total >= 6');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 9 — emptyBackboneMetrics shape válido
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 9] emptyBackboneMetrics shape válido');
{
    const m = emptyBackboneMetrics({ windowDays: 30 });
    assert(m.totalEvents === 0,                        'totalEvents = 0');
    assert(typeof m.usageByMode === 'object',          'usageByMode existe');
    assert(typeof m.readingTimeByMode === 'object',    'readingTimeByMode existe');
    assert(typeof m.progressByMode === 'object',       'progressByMode existe');
    assert(typeof m.errorsByMode === 'object',         'errorsByMode existe');
    assert(m.immersiveAudio.audioPlayCount === 0,      'immersiveAudio shape');
    assert(m.a11yAdoption.users === 0,                 'a11yAdoption shape');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 10 — Sprint 5A: native vs legacy + sourceBreakdown + anti-duplicación
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 10] Sprint 5A — _source native/legacy + sourceBreakdown');
{
    // Escenario:
    //   - text: 1 sesión native + 1 sesión legacy = 2 sesiones brutas
    //     → preferred='native' → combinada cuenta solo la native (1)
    //   - immersive: 0 native + 1 legacy → preferred='legacy' → combinada=1
    //   - a11y: 1 sesión sin _source (unknown → bucket legacy) → combinada=1
    const events = [
        // text — sesión nativa (5 min)
        baseEvent({ event: 'text.session_start', mode: 'text', sessionId: 't-native',
                    payload: { _source: 'native' }, clientTs: 1000 }),
        baseEvent({ event: 'text.session_end',   mode: 'text', sessionId: 't-native',
                    payload: { _source: 'native' }, clientTs: 1000 + 300_000, elapsedMs: 300_000 }),
        // text — misma cobertura legacy (10 min) — debe quedar suprimida en combinada
        baseEvent({ event: 'text.session_start', mode: 'text', sessionId: 't-legacy',
                    payload: { _source: 'legacy' }, clientTs: 2000 }),
        baseEvent({ event: 'text.session_end',   mode: 'text', sessionId: 't-legacy',
                    payload: { _source: 'legacy' }, clientTs: 2000 + 600_000, elapsedMs: 600_000 }),
        // immersive — solo legacy
        baseEvent({ event: 'immersive.session_start', mode: 'immersive', sessionId: 'i-legacy',
                    payload: { _source: 'legacy' } }),
        baseEvent({ event: 'immersive.session_end',   mode: 'immersive', sessionId: 'i-legacy',
                    payload: { _source: 'legacy' }, elapsedMs: 100_000 }),
        // a11y — sin _source (unknown → bucket legacy)
        baseEvent({ event: 'a11y.session_start', mode: 'a11y', sessionId: 'a-old' }),
        baseEvent({ event: 'a11y.session_end',   mode: 'a11y', sessionId: 'a-old', elapsedMs: 50_000 }),
    ];
    const m = aggregateBackboneMetrics(events, { windowDays: 30 });

    // Combinadas — text usa solo native, no duplica
    assert(m.totalSessions === 3,                                       'totalSessions filtered = 3 (1 text-native + 1 immersive + 1 a11y)');
    assert(m.usageByMode.text.sessionStarts === 1,                      'text.sessionStarts combinada = 1 (native, no duplicado)');
    assert(m.readingTimeByMode.text.totalElapsedMs === 300_000,         'text.totalElapsedMs combinada = 300k (solo native)');

    // Breakdown crudo — sin filtro
    assert(m.usageByMode.text.nativeSessions === 1,                     'text.nativeSessions = 1');
    assert(m.usageByMode.text.legacySessions === 1,                     'text.legacySessions = 1');
    assert(m.usageByMode.text.totalSessions === 2,                      'text.totalSessions (raw) = 2');
    assert(m.readingTimeByMode.text.nativeElapsedMs === 300_000,        'text.nativeElapsedMs = 300k');
    assert(m.readingTimeByMode.text.legacyElapsedMs === 600_000,        'text.legacyElapsedMs = 600k');

    // immersive: preferred=legacy → combinada usa legacy
    assert(m.usageByMode.immersive.sessionStarts === 1,                 'immersive.sessionStarts = 1');
    assert(m.usageByMode.immersive.nativeSessions === 0,                'immersive.nativeSessions = 0');
    assert(m.usageByMode.immersive.legacySessions === 1,                'immersive.legacySessions = 1');

    // a11y unknown → bucket legacy
    assert(m.usageByMode.a11y.legacySessions === 1,                     'a11y.legacySessions = 1 (unknown→legacy)');
    assert(m.usageByMode.a11y.nativeSessions === 0,                     'a11y.nativeSessions = 0');

    // sourceBreakdown global
    assert(m.sourceBreakdown.native.totalSessions === 1,                'sourceBreakdown.native.totalSessions = 1');
    assert(m.sourceBreakdown.legacy.totalSessions === 3,                'sourceBreakdown.legacy.totalSessions = 3 (1 text + 1 immersive + 1 a11y unknown)');
    assert(m.sourceBreakdown.native.totalEvents === 2,                  'sourceBreakdown.native.totalEvents = 2');
    assert(m.sourceBreakdown.legacy.totalEvents === 6,                  'sourceBreakdown.legacy.totalEvents = 6');
    assert(m.sourceBreakdown.native.totalElapsedMs === 300_000,         'sourceBreakdown.native.totalElapsedMs = 300k');
    assert(m.sourceBreakdown.legacy.totalElapsedMs === 750_000,         'sourceBreakdown.legacy.totalElapsedMs = 600k+100k+50k');
}

// ──────────────────────────────────────────────────────────────────────────
// TEST 11 — Sprint 5A: solo legacy → métricas siguen funcionando como antes
// ──────────────────────────────────────────────────────────────────────────
console.log('\n[TEST 11] Sprint 5A — fallback a legacy cuando no hay native');
{
    const events = [
        baseEvent({ event: 'text.session_start', mode: 'text', sessionId: 'l1',
                    payload: { _source: 'legacy' } }),
        baseEvent({ event: 'text.session_end',   mode: 'text', sessionId: 'l1',
                    payload: { _source: 'legacy' }, elapsedMs: 60_000 }),
    ];
    const m = aggregateBackboneMetrics(events, { windowDays: 30 });
    assert(m.totalSessions === 1,                              'totalSessions = 1');
    assert(m.usageByMode.text.sessionStarts === 1,             'text.sessionStarts = 1 (fallback legacy)');
    assert(m.readingTimeByMode.text.totalElapsedMs === 60_000, 'text.totalElapsedMs = 60k');
    assert(m.sourceBreakdown.native.totalSessions === 0,       'native breakdown = 0');
    assert(m.sourceBreakdown.legacy.totalSessions === 1,       'legacy breakdown = 1');
}

// ── Cierre y cleanup ─────────────────────────────────────────────────────────
closeDb();

console.log(`\n──────────────────────────────────────────────`);
console.log(`Resultado: ${pass} pass / ${fail} fail`);
console.log(`──────────────────────────────────────────────`);

for (const ext of ['', '-shm', '-wal']) {
    const f = TMP_DB_PATH + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
}

process.exit(fail === 0 ? 0 : 1);
