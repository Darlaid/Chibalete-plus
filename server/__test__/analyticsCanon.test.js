/**
 * analyticsCanon.test.js — Phase-1 (P5) canonicalización analítica.
 * Cubre: eventRegistry (cobertura+rejection+migración), analyticsShadow
 * (recovery-first row build) y events-archive (idempotencia + transacción).
 * Aislado: temp event DBs, NUNCA toca data-critical/ ni data/ reales.
 *
 *   node server/__test__/analyticsCanon.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { validateEvent, describeEvent, listRegistry, EVENT_NAMES, EVENT_CATEGORIES, REGISTRY_VERSION, getMeta } from '../analytics/eventRegistry.js';
import { __buildRowForTest, recordCanonicalEvent, setInserterForTest } from '../services/analyticsShadow.mjs';
import { SIGNALS, SIGNAL_IDS } from '../analytics/signals.js';
import { OBJECTIVES, OBJECTIVE_IDS } from '../analytics/objectives.js';

let pass = 0, fail = 0;
const ok = (l,c,h='') => c ? (console.log('  ✓',l),pass++) : (console.error('  ✗',l,h),fail++);

// ── Sample payloads válidos por evento (cobertura del registry) ────────────
const SAMPLES = {
    // reading
    reading_started:   { contentId:'c1', mode:'immersive', sessionId:'s1', startedAt: Date.now() },
    reading_progress:  { contentId:'c1', sessionId:'s1', sentenceIndex:5, percentage:12.5, elapsedMs:1200 },
    reading_completed: { contentId:'c1', sessionId:'s1', totalTimeMs:60000 },
    reading_paused:    { contentId:'c1', sessionId:'s1' },
    reading_resumed:   { contentId:'c1', sessionId:'s1' },
    reading_abandoned: { contentId:'c1', sessionId:'s1', reason:'switch_book' },
    reading_reopened:  { contentId:'c1', sessionId:'s1', gapMs: 3600_000 },
    reading_repeated_segment: { contentId:'c1', sessionId:'s1', fromSentence:10, toSentence:5 },
    // session
    session_started:    { sessionId:'s1', source:'visor_inmersivo', startedAt: Date.now() },
    session_heartbeat:  { sessionId:'s1', elapsedMs: 60_000 },
    session_ended:      { sessionId:'s1', totalMs: 300_000, reason:'user_exit' },
    session_timeout:    { sessionId:'s1', inactiveMs: 600_000 },
    session_recovered:  { sessionId:'s1', gapMs: 1500 },
    // immersive
    immersive_started: { contentId:'c1', sessionId:'s1', runtime:'v2', audioMode:'perChunkNoAnchors' },
    immersive_sentence_committed: { sessionId:'s1', runtime:'v2', sentenceIndex: 12 },
    immersive_sync_drift_detected: { sessionId:'s1', runtime:'v2', deltaMs: 240 },
    immersive_sync_recovered: { sessionId:'s1', runtime:'v2', kind:'hold_release' },
    immersive_visibility_stall: { sessionId:'s1', runtime:'v2', stallMs:240 },
    immersive_runtime_error: { sessionId:'s1', runtime:'v2', code:'audio_init_failed' },
    // audio
    audio_started: { sessionId:'s1', runtime:'v1' },
    audio_paused: { sessionId:'s1', runtime:'v1' },
    audio_resumed: { sessionId:'s1', runtime:'v1' },
    audio_autoplay_blocked: { sessionId:'s1', runtime:'v1', via:'gapless' },
    audio_desync_detected: { sessionId:'s1', runtime:'v2', deltaMs:-12 },
    audio_recovered: { sessionId:'s1', runtime:'v2', kind:'soft_resync' },
    // accessibility
    accessibility_mode_enabled: { feature:'high_contrast' },
    accessibility_mode_disabled: { feature:'high_contrast' },
    tts_started: { contentId:'c1', voice:'es-CL' },
    tts_interrupted: { reason:'user_pause' },
    tts_completed: { contentId:'c1', durationMs: 45000 },
    font_adjusted: { from:'base', to:'lg' },
    contrast_adjusted: { from:'dark', to:'high-contrast' },
    // pdf
    pdf_opened: { contentId:'c1', sessionId:'s1' },
    pdf_page_changed: { contentId:'c1', sessionId:'s1', page: 5 },
    pdf_zoom_changed: { sessionId:'s1', zoom: 1.5 },
    pdf_completed: { contentId:'c1', sessionId:'s1', pages: 24 },
    // guided
    guided_step_started: { contentId:'c1', sessionId:'s1', stepId:'q1' },
    guided_step_completed: { contentId:'c1', sessionId:'s1', stepId:'q1', elapsedMs: 8000 },
    guided_prompt_opened: { contentId:'c1', sessionId:'s1', promptId:'p1' },
    // album
    album_opened: { contentId:'c1', sessionId:'s1' },
    album_page_changed: { contentId:'c1', sessionId:'s1', page: 3 },
    album_audio_started: { contentId:'c1', sessionId:'s1', regionId:'r1' },
    album_interaction: { contentId:'c1', sessionId:'s1', kind:'tap_region' },
    // aula viva
    teacher_viewed_dashboard: { at: Date.now() },
    teacher_viewed_group: { groupId:'g1', at: Date.now() },
    teacher_viewed_student: { groupId:'g1', studentId:'u1', at: Date.now() },
    teacher_detected_risk: { scopeLevel:'group', scopeId:'g1', kind:'abandonment', severity:'warn' },
    teacher_created_intervention: { scopeLevel:'user', scopeId:'u1', kind:'call_home', note:'sin lecturas 14d' },
    teacher_reviewed_recommendation: { recommendationId:'r1', accepted: true },
    mediator_reviewed_cohort: { scopeLevel:'school', scopeId:'s1', cohortKey:'1A_2026' },
    intervention_detected: { scopeLevel:'group', scopeId:'g1', kind:'abandonment_risk', severity:'warn' },
    // institutional
    institution_created: { schoolId:'sch1', name:'Colegio Demo' },
    group_created: { groupId:'g1', name:'1A', kind:'course' },
    group_updated: { groupId:'g1', fields:['name','teacherId'] },
    membership_added:   { groupId:'g1', userId:'u1', role:'student' },
    membership_removed: { groupId:'g1', userId:'u1', role:'student' },
    membership_moved:   { fromGroupId:'g1', toGroupId:'g2', userIds:['u1','u2'] },
    bulk_assignment:    { groupId:'g1', added:3, removed:1 },
    bulk_membership_imported: { scopeLevel:'school', scopeId:'sch1', imported: 24, failed: 0 },
    access_granted:     { scopeLevel:'group', scopeId:'g1', kind:'collection', expiresAt: Date.now() + 86400000 },
    access_revoked:     { scopeLevel:'group', scopeId:'g1', kind:'collection' },
    scope_violation_detected: { scopeLevel:'group', scopeId:'g1', actor:'u9', path:'/api/groups/g2' },
    // leo
    leo_interaction_started: { sessionId:'s1', kind:'comprension' },
    leo_interaction_completed: { sessionId:'s1', kind:'comprension', durationMs: 30000 },
    leo_memory_updated: { userId:'u1', keys:['fav_genre','last_book'] },
    leo_profile_updated: { userId:'u1', fields:['nivel_lectura'] },
    leo_evidence_recorded: { userId:'u1', kind:'reread_attempt', sourceEvent:'reading_repeated_segment' },
    leo_recommendation_generated: { userId:'u1', recommendationId:'r1', kind:'next_book' },
    // system
    deploy_started: { release:'r-2026-05-19', commit:'abc1234' },
    deploy_completed: { release:'r-2026-05-19', durationMs: 5400 },
    migration_applied: { name:'0001_identity', durationMs:12 },
    archive_started: { cutoffTs: Date.now()-1, candidate: 50 },
    archive_completed: { archived:120, cutoffTs: Date.now()-1, durationMs:80 },
    shadow_divergence_detected: { domain:'analytics', legacy: 100, canon: 98, missing: 2 },
};

console.log('\n[1] eventRegistry — taxonomía completa, cobertura, rejection');
ok(`EVENT_CATEGORIES = ${EVENT_CATEGORIES.length} (12 PASO 1: +session/pdf/guided/album/leo)`,
    EVENT_CATEGORIES.length === 12);
ok('cada evento del registry tiene sample válido en el test',
   EVENT_NAMES.every(n => SAMPLES[n]),
   `faltan: ${EVENT_NAMES.filter(n => !SAMPLES[n]).join(',')}`);
let allValid = true;
for (const n of EVENT_NAMES) {
    const r = validateEvent(n, SAMPLES[n]);
    if (!r.ok) { allValid = false; console.error('   sample inválido:', n, JSON.stringify(r)); }
}
ok('todos los samples canónicos validan',          allValid);
ok('payload inválido es rechazado (invalid_payload)',
   validateEvent('reading_started', { /* falta todo */ }).code === 'invalid_payload');
ok('evento desconocido → unknown_event',
   validateEvent('mystery_event', {}).code === 'unknown_event');
ok('versión no soportada sin migrate → unsupported_version',
   validateEvent('reading_started', SAMPLES.reading_started, 99).code === 'unsupported_version');
ok('describeEvent() OK', describeEvent('reading_started')?.category === 'reading');
ok('listRegistry() devuelve todos', listRegistry().length === EVENT_NAMES.length);

// .strip() del registry: campos extras son descartados, no rechazados.
const stripped = validateEvent('reading_paused',
    { contentId:'c1', sessionId:'s1', injected:'evil', __proto__:null });
ok('payload con extras: .strip() los descarta sin fallar',
   stripped.ok === true && !('injected' in stripped.payload));

console.log('\n[2] analyticsShadow — recovery-first row build (jamás pierde evento)');
{
    const okEnv = { eventId:'e1', event:'reading_started', mode:'immersive',
        userId:'u1', sessionId:'s1', contentId:'c1', clientTs: 100,
        payload: SAMPLES.reading_started };
    const r1 = __buildRowForTest(okEnv);
    ok('válido → validated true + schema_version=1', r1.validated === true && r1.row.schema_version === 1);
    ok('payload limpio (sin marker)',
       !JSON.parse(r1.row.payload_json).__validation_failed);

    const badEnv = { eventId:'e2', event:'reading_started', mode:'immersive',
        userId:'u1', sessionId:'s1', payload: { foo:'bar' /* schema requiere contentId+mode+startedAt */ } };
    const r2 = __buildRowForTest(badEnv);
    ok('inválido → validated false PERO se construye fila igual (recovery-first)',
       r2.validated === false && typeof r2.row.payload_json === 'string');
    const pj = JSON.parse(r2.row.payload_json);
    ok('marker __validation_failed presente para auditoría',
       pj.__validation_failed === 'invalid_payload' && Array.isArray(pj.__issues));

    const unknownEnv = { eventId:'e3', event:'never_was', mode:'guided',
        userId:'u1', sessionId:'s1', payload: { x: 1 } };
    const r3 = __buildRowForTest(unknownEnv);
    ok('unknown_event → row con marker, NO se pierde',
       r3.validated === false && JSON.parse(r3.row.payload_json).__validation_failed === 'unknown_event');
}

console.log('\n[3] events-archive.mjs — dry-run + apply + idempotencia');
{
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arc_'));
    const HOT = path.join(dir, 'events.db');
    const COLD = path.join(dir, 'events.archive.db');
    // Crear hot db con schema mínimo + sembrar 50 viejos + 5 recientes.
    const db = new Database(HOT); db.pragma('journal_mode = WAL');
    db.exec(`CREATE TABLE events (id INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT UNIQUE NOT NULL,
      schema_version INTEGER NOT NULL, event TEXT NOT NULL, mode TEXT NOT NULL,
      user_id TEXT NOT NULL, content_id TEXT, session_id TEXT NOT NULL,
      client_ts INTEGER NOT NULL, server_ts INTEGER NOT NULL,
      elapsed_ms INTEGER, progress_fraction REAL, payload_json TEXT, created_at INTEGER NOT NULL);`);
    const ins = db.prepare(`INSERT INTO events (event_id,schema_version,event,mode,user_id,session_id,client_ts,server_ts,created_at)
      VALUES (?, 1, 'reading_started', 'immersive', 'u1', 's1', 0, ?, ?)`);
    const oldTs = Date.now() - 200 * 24 * 3600 * 1000;  // 200d → viejo
    const newTs = Date.now() - 1 * 24 * 3600 * 1000;    // 1d  → reciente
    for (let i = 0; i < 50; i++) ins.run(`old-${i}`, oldTs + i, oldTs + i);
    for (let i = 0; i < 5;  i++) ins.run(`new-${i}`, newTs + i, newTs + i);
    db.close();

    const env = { ...process.env, EVENTS_HOT_DB: HOT, EVENTS_ARCHIVE_DB: COLD };
    const script = path.resolve(path.join('scripts','events-archive.mjs'));

    const dry = spawnSync(process.execPath, [script, '--days', '90', '--dry-run'], { env, encoding: 'utf8' });
    ok('dry-run exit 0', dry.status === 0, dry.stderr);
    ok('dry-run reporta 50 candidatos', /candidatos a archivar: 50/.test(dry.stdout), dry.stdout);
    ok('dry-run NO crea archive.db', !fs.existsSync(COLD));

    const app1 = spawnSync(process.execPath, [script, '--days', '90', '--apply'], { env, encoding: 'utf8' });
    ok('apply exit 0', app1.status === 0, app1.stderr);
    ok('apply: archived=50 deleted=50', /archived=50 deleted=50/.test(app1.stdout), app1.stdout);
    ok('archive.db creado', fs.existsSync(COLD));
    const db2 = new Database(HOT,  { readonly:true });
    const dba = new Database(COLD, { readonly:true });
    ok('hot quedó con 5 recientes',  db2.prepare('SELECT COUNT(*) c FROM events').get().c === 5);
    ok('archive recibió 50',         dba.prepare('SELECT COUNT(*) c FROM events').get().c === 50);
    db2.close(); dba.close();

    const app2 = spawnSync(process.execPath, [script, '--days', '90', '--apply'], { env, encoding: 'utf8' });
    ok('rerun idempotente (0 candidatos)', /nada que rotar/.test(app2.stdout), app2.stdout);

    // cleanup temp
    try {
        for (const f of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, f));
        fs.rmdirSync(dir);
    } catch {}
}

console.log('\n[4] §16.3-5 — TODOS los eventos tienen category, retention_class, materialization_hint, pedagogical_weight, privacy_level');
{
    const VALID_RETENTION       = new Set(['hot_90d','warm_1y','cold_archive','transient_30d']);
    const VALID_MATERIALIZATION = new Set(['snapshot_user','snapshot_group','snapshot_school','counter_runtime','log_only']);
    const VALID_PRIVACY         = new Set(['public','institutional','pedagogical','sensitive']);
    const VALID_WEIGHT          = new Set([0,1,2,3]);
    let bad = [];
    for (const n of EVENT_NAMES) {
        const d = describeEvent(n); const m = getMeta(n);
        if (!d?.category) bad.push(`${n}:category`);
        if (!m || !VALID_RETENTION.has(m.retention_class)) bad.push(`${n}:retention_class`);
        if (!m || !VALID_MATERIALIZATION.has(m.materialization_hint)) bad.push(`${n}:materialization_hint`);
        if (!m || !VALID_PRIVACY.has(m.privacy_level)) bad.push(`${n}:privacy_level`);
        if (!m || !VALID_WEIGHT.has(m.pedagogical_weight)) bad.push(`${n}:pedagogical_weight`);
    }
    ok(`metadata completa y enums válidos en ${EVENT_NAMES.length} eventos`, bad.length === 0, bad.slice(0,5).join(','));
    ok(`REGISTRY_VERSION = 2 (bumpeada en PASO 1)`, REGISTRY_VERSION === 2);
}

console.log('\n[5] §16.11 — duplicate event_id no duplica (UNIQUE tolerado como idempotente)');
{
    let inserts = 0;
    setInserterForTest((row) => {
        inserts++;
        if (inserts > 1) {
            const e = new Error('UNIQUE constraint failed: events.event_id');
            throw e;
        }
    });
    const env = { eventId:'dup-1', event:'reading_paused', mode:'immersive', userId:'u1',
        sessionId:'s1', payload: SAMPLES.reading_paused };
    const r1 = recordCanonicalEvent(env);
    const r2 = recordCanonicalEvent(env);
    ok('1er insert OK',                    r1.ok === true && r1.inserted === true);
    ok('2do insert detectado como duplicado, ok:true, inserted:false, duplicate:true',
        r2.ok === true && r2.inserted === false && r2.duplicate === true);
    setInserterForTest(null);
}

console.log('\n[6] §16.17 — recordCanonicalEvent NUNCA lanza al caller (entradas adversariales)');
{
    setInserterForTest(() => {});
    const cases = [
        null, undefined, {}, { eventId:null, event:'reading_started', payload:{} },
        { event: 'mystery_event', payload: null },
        { event: 'reading_started', payload: 'no-es-objeto' },
        { event: 123, payload: {} },
        { eventId:'e', event:'reading_started', payload:{ huge: 'x'.repeat(10_000) } },
    ];
    let threw = 0;
    for (const c of cases) {
        try { const r = recordCanonicalEvent(c); if (!r || typeof r !== 'object') threw++; }
        catch { threw++; }
    }
    ok('todas las entradas adversariales NO lanzan y devuelven objeto',  threw === 0);
    setInserterForTest(null);
}

console.log('\n[7] §11/§12 — signals (≥15) + objectives (8) bien formados');
{
    // Fase 2B LEC sumó 4 signals Leo-derived (mediacion_leo, inferencia_observada,
    // metacognicion_observada, emocion_observada). El mínimo legal pasa a ser 15
    // (las base obligatorias); extensiones solo pueden incrementar el conteo.
    ok('SIGNALS.length >= 15 (base obligatoria + extensiones)', SIGNALS.length >= 15);
    ok('SIGNAL_IDS únicos', new Set(SIGNAL_IDS).size === SIGNAL_IDS.length);
    const VALID_SCOPE = ['user','group','school','user/group','user/group/school','por sesión','por contenido','user/school','group','user'];
    let bad = [];
    for (const s of SIGNALS) {
        if (!s.id || !Array.isArray(s.source_events) || s.source_events.length === 0) bad.push(`${s.id}:src`);
        if (!s.formula || !s.scope || !s.utility) bad.push(`${s.id}:fields`);
        if (!['low','medium','high'].includes(s.confidence_now)) bad.push(`${s.id}:conf`);
        for (const ev of s.source_events) {
            if (!EVENT_NAMES.includes(ev)) bad.push(`${s.id}:src_unknown:${ev}`);
        }
    }
    ok('signals: cada source_event pertenece al registry, fields completos',
        bad.length === 0, bad.slice(0,5).join(' '));

    ok('OBJECTIVES.length === 8 (Saber/PISA framework)', OBJECTIVES.length === 8);
    bad = [];
    for (const o of OBJECTIVES) {
        if (!o.id || !Array.isArray(o.required_events) || !Array.isArray(o.required_signals)) bad.push(`${o.id}:shape`);
        for (const ev of o.required_events) {
            if (!EVENT_NAMES.includes(ev)) bad.push(`${o.id}:event_unknown:${ev}`);
        }
        for (const sg of o.required_signals) {
            if (!SIGNAL_IDS.includes(sg)) bad.push(`${o.id}:signal_unknown:${sg}`);
        }
    }
    ok('objectives: required_events ⊆ registry, required_signals ⊆ SIGNAL_IDS',
        bad.length === 0, bad.slice(0,5).join(' '));
}

console.log('\n[8] §16.16 — métricas: cardinalidad CONTROLADA (no userId/contentId/email/sessionId)');
{
    const fs2 = await import('node:fs'); const path2 = await import('node:path');
    const src = fs2.readFileSync(path2.resolve('server','observability','metrics.js'), 'utf8');
    const re = /labelNames:\s*\[([^\]]*)\]/g; let m, dangerous = [];
    while ((m = re.exec(src)) !== null) {
        const labels = m[1];
        if (/['"]userId['"]|['"]contentId['"]|['"]email['"]|['"]sessionId['"]/.test(labels)) {
            dangerous.push(labels.trim());
        }
    }
    ok('ningún labelNames incluye userId/contentId/email/sessionId',
        dangerous.length === 0, dangerous.join(' | '));
    // Métricas obligatorias §15 presentes (declaradas, no requeridas activas).
    for (const name of [
        'chibalete_events_recorded_total', 'chibalete_event_validation_failures_total',
        'chibalete_payload_schema_version_total', 'chibalete_analytics_shadow_consistency_ok',
        'chibalete_analytics_shadow_divergence_total', 'chibalete_archive_rotations_total',
        'chibalete_unsupported_event_types_total',
    ]) {
        ok(`métrica ${name} declarada`, src.includes(name));
    }
}

console.log('\n[9] §14 — /api/health/analytics never-throws + estructura mínima');
{
    const mod = await import('../observability/analyticsHealth.js');
    let body = null, status = null;
    const fakeRes = {
        status(c) { status = c; return this; },
        json(b)   { body = b; return this; },
    };
    let threw = false;
    try { await mod.analyticsHealthHandler({}, fakeRes); } catch { threw = true; }
    ok('handler no lanza',                                   threw === false);
    ok('responde 200 o 503 (nunca otro)',                    status === 200 || status === 503);
    ok('body trae status + checks',                          !!body && typeof body.status === 'string' && body.checks);
    ok('checks incluye registry (PASO 1)',                   !!body && !!body.checks?.registry);
    ok('checks.registry trae event_names y categories',
        body?.checks?.registry?.event_names > 0 && body?.checks?.registry?.categories > 0);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
