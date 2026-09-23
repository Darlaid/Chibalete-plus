/**
 * readingCanonicalProducer.test.mjs — CHP-V6-READING-CANONICAL-PRODUCER-01.
 *
 * QUÉ FIJA ESTA SUITE
 * -------------------
 * Antes del cutover una lectura real solo dejaba en events.db el vocabulario
 * del Backbone v1 (`text.session_start`…); el registry v2 nunca recibía un
 * `reading_started`. Además el mismo hecho de sesión llegaba DOS veces: por el
 * hook nativo (/api/v1/events) y por el dual-write de analyticsService
 * (/api/analytics/events), con el modo inferido.
 *
 * Desde el cutover:
 *   - el ingreso traduce en el servidor y persiste el nombre del registry v2;
 *   - una acción de lectura = un evento canónico (el hook es autoritativo);
 *   - la historia legacy sigue significando lo mismo (normalizador intacto);
 *   - materializador y Dashboard de Lectura dan el MISMO resultado sobre una
 *     sesión canónica que sobre la misma sesión en vocabulario v1.
 */
import { spawn } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import {
    toCanonicalReadingEnvelope, recordCanonicalReading, canonicalReadingNameOf,
    READING_MODE_TO_REGISTRY, backboneActionOf, isCanonicalReadingEventName,
} from '../analytics/readingCanonical.mjs';
import { normalizeEventForSignals, LEGACY_EVENT_MAP } from '../analytics/legacyEventNormalizer.mjs';
import { validateEvent, EVENT_NAMES } from '../analytics/eventRegistry.js';
import { computeUserSignals } from '../services/signalCompute.mjs';
import { aggregateBackboneMetrics } from '../backboneMetrics.js';
import { computeBackboneFunnels } from '../backboneFunnels.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ULID de prueba: 26 caracteres Crockford, distinto por índice.
const CROCK = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
let _seq = 0;
const ulid = () => {
    let n = ++_seq, s = '';
    for (let i = 0; i < 6; i++) { s = CROCK[n % 32] + s; n = Math.floor(n / 32); }
    return ('01J8Z' + 'A'.repeat(15) + s).slice(0, 26);
};

// ────────────────────────────────────────────────────────────────────────────
section('[1] MAPEO CONGELADO — deriva de la tabla de Etapa 9, no se reinventa');
{
    const EXPECTED = {
        'text.session_start': 'reading_started', 'text.session_heartbeat': 'session_heartbeat',
        'text.session_end': 'session_ended', 'text.block_complete': 'reading_progress',
        'pdf.progress': 'reading_progress', 'album.progress': 'reading_progress', 'a11y.progress': 'reading_progress',
        'immersive.session_completed': 'reading_completed', 'text.album_completed': 'reading_completed',
    };
    for (const [v1, c] of Object.entries(EXPECTED)) ok(`${v1} → ${c}`, canonicalReadingNameOf(v1) === c);
    ok('cada destino existe en el registry v2',
        Object.values(LEGACY_EVENT_MAP).every(c => EVENT_NAMES.includes(c)));
    ok('lu.* no es lectura', canonicalReadingNameOf('lu.session_start') === null);
    ok('telemetría técnica sin equivalencia', canonicalReadingNameOf('immersive.audio_play') === null
        && canonicalReadingNameOf('pdf.page_change') === null);
    ok('modo del registry: text es el Modo Guiado', READING_MODE_TO_REGISTRY.text === 'guided'
        && READING_MODE_TO_REGISTRY.a11y === 'accessible' && !('lu' in READING_MODE_TO_REGISTRY));
}

section('[R5/R6/R7/R8/R10] traducción pura');
{
    const base = { eventId: ulid(), mode: 'text', userId: 'u1', contentId: 'c1', sessionId: ulid(), clientTs: 1_790_000_000_000 };
    const start = toCanonicalReadingEnvelope({ ...base, event: 'text.session_start', elapsedMs: 0,
        payload: { source: 'VisorTexto', language: 'es', freeText: 'NO DEBE PASAR' } });
    ok('start → reading_started con payload válido', start?.event === 'reading_started'
        && validateEvent('reading_started', start.envelope.payload).ok, JSON.stringify(start));
    ok('R10 · el payload del cliente no pasa tal cual (ni texto libre ni título)',
        !JSON.stringify(start.envelope.payload).includes('NO DEBE PASAR') && !('source' in start.envelope.payload));
    ok('R10 · solo claves del schema', Object.keys(start.envelope.payload).sort().join(',') === 'contentId,mode,sessionId,startedAt');
    ok('el eventId del cliente se conserva (idempotencia)', start.envelope.eventId === base.eventId);
    ok('la columna mode conserva el modo del visor', start.envelope.mode === 'text');

    const bad = toCanonicalReadingEnvelope({ ...base, eventId: ulid(), event: 'text.session_heartbeat' });
    const r5 = recordCanonicalReading(bad.envelope, () => { throw new Error('no debe persistir'); });
    ok('R5 · latido sin elapsedMs → rechazado, sin persistir', r5.status === 'rejected' && r5.code === 'invalid_payload', JSON.stringify(r5));
    ok('R6 · evento v1 sin equivalencia → null (el llamador conserva su camino)',
        toCanonicalReadingEnvelope({ ...base, event: 'immersive.audio_play' }) === null
        && toCanonicalReadingEnvelope({ ...base, mode: 'lu', event: 'lu.session_start' }) === null);
    ok('R7 · el normalizador sigue traduciendo la historia',
        normalizeEventForSignals('text.session_start') === 'reading_started'
        && normalizeEventForSignals('immersive.session_completed') === 'reading_completed');
    ok('R8 · sobre un nombre canónico el normalizador es identidad',
        ['reading_started', 'session_heartbeat', 'session_ended', 'reading_progress', 'reading_completed']
            .every(n => normalizeEventForSignals(n) === n));
    ok('Dashboard · acción v1 de una fila canónica',
        backboneActionOf('reading_started') === 'session_start' && backboneActionOf('session_ended') === 'session_end'
        && backboneActionOf('text.session_start') === 'session_start' && isCanonicalReadingEventName('reading_progress'));
}

// ────────────────────────────────────────────────────────────────────────────
// HARNESS HTTP — servidor real sobre stores temporales, TODAS las rutas al sandbox.
// ────────────────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_readcanon_'));
const D = path.join(tmp, 'data');
fs.mkdirSync(D, { recursive: true });
fs.mkdirSync(path.join(tmp, 'uploads'), { recursive: true });
const U = 'lec-1';
fs.writeFileSync(path.join(tmp, 'users.json'), JSON.stringify([{ id: U, roles: ['lector'], organizationId: 'org-a', accountStatus: 'active' }]));
fs.writeFileSync(path.join(tmp, 'groups.json'), '[]');
fs.writeFileSync(path.join(tmp, 'schools.json'), JSON.stringify([{ id: 'org-a', name: 'Colegio A' }]));
fs.writeFileSync(path.join(tmp, 'access.json'), '[]');
fs.writeFileSync(path.join(tmp, 'content.json'), JSON.stringify([{ id: 'c-1', titulo: 'Uno', tipo: 'libro', status: 'disponible' }]));
const EVENTS_DB = path.join(D, 'events.db');

function spawnApi(port) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port), CHP_DATA_DIR: D,
            USERS_DB: path.join(tmp, 'users.json'), GROUPS_DB: path.join(tmp, 'groups.json'),
            SCHOOLS_DB: path.join(tmp, 'schools.json'), ACCESS_DB: path.join(tmp, 'access.json'),
            CONTENT_DB: path.join(tmp, 'content.json'), UPLOADS_ROOT: path.join(tmp, 'uploads'),
            USER_AUDIT_DB: path.join(D, 'user_audit.json'),
            PROGRESS_SQLITE_PATH: path.join(D, 'progress.db'), EVENTS_SQLITE_PATH: EVENTS_DB,
            ARCHIVE_SQLITE_PATH: path.join(D, 'events.archive.db'), INSIGHTS_SQLITE_PATH: path.join(D, 'insights.db'),
            OFFLINE_ASSIGNMENT_DB_PATH: path.join(D, 'offline_assignments.db'),
            IDENTITY_DB: path.join(D, 'identity.db'), SESSIONS_DB: path.join(D, 'sessions.db'),
            LEO_EVIDENCE_DB: path.join(D, 'leo_evidence_db.json'),
            ACCESS_FALLBACK_MODE: 'restricted', SESSION_AUTH_MODE: 'off',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '',
        },
    });
    let bootLog = '';
    child.stdout.on('data', x => { bootLog += x; });
    child.stderr.on('data', x => { bootLog += x; });
    child._boot = () => bootLog;
    return child;
}
async function waitHealthy(base, child) {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child._boot().slice(-2000)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy\n${child._boot().slice(-2000)}`);
}
const PORT = ((p) => (p === 5040 ? 5041 : p))(5520 + (process.pid % 80));
const BASE = `http://127.0.0.1:${PORT}`;
let api;
const post = (p, body) => fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-user-id': U }, body: JSON.stringify(body) });
const rows = () => { const db = new Database(EVENTS_DB, { readonly: true }); try { return db.prepare('SELECT * FROM events ORDER BY id').all(); } finally { db.close(); } };
const count = (rs, name) => rs.filter(r => r.event === name).length;

async function httpPhase() {
    api = spawnApi(PORT);
    await waitHealthy(BASE, api);

    section('[R1–R4/R12] sesión completa por /api/v1/events → canónica en reposo, sin duplicados');
    const sid = ulid();
    const ev = (event, extra = {}) => ({ eventId: ulid(), schemaVersion: 1, event, mode: 'text', userId: U,
        contentId: 'c-1', sessionId: sid, clientTs: Date.now(), ...extra });
    const session = [
        ev('text.session_start', { elapsedMs: 0, progressFraction: 0, payload: { source: 'VisorTexto', language: 'es', sentenceCount: 12 } }),
        ev('text.session_heartbeat', { elapsedMs: 15_000, progressFraction: 0.05 }),
        ev('text.session_heartbeat', { elapsedMs: 30_000, progressFraction: 0.1 }),
        ev('text.session_end', { elapsedMs: 41_000, progressFraction: 0.12, payload: { source: 'VisorTexto' } }),
    ];
    const r = await post('/api/v1/events', { events: session });
    const body = await r.json();
    ok('contrato de respuesta intacto (200, accepted=4)', r.status === 200 && body.accepted === 4 && body.rejected === 0, JSON.stringify(body));
    let all = rows();
    ok('R1 · exactamente 1 reading_started', count(all, 'reading_started') === 1);
    ok('R2 · exactamente 2 session_heartbeat', count(all, 'session_heartbeat') === 2);
    ok('R3 · exactamente 1 session_ended', count(all, 'session_ended') === 1);
    ok('R12 · CERO filas v1 de esa sesión', all.filter(x => x.event.startsWith('text.')).length === 0);
    const st = all.find(x => x.event === 'reading_started');
    ok('schema_version=1, modo del visor, sujeto y contenido correctos',
        st.schema_version === 1 && st.mode === 'text' && st.user_id === U && st.content_id === 'c-1' && st.session_id === sid);
    const stp = JSON.parse(st.payload_json);
    ok('payload validado por el registry (modo guided, sin texto libre del cliente)',
        stp.mode === 'guided' && !('source' in stp) && !('language' in stp), st.payload_json);
    const end = all.find(x => x.event === 'session_ended');
    ok('session_ended lleva totalMs y la columna elapsed_ms', JSON.parse(end.payload_json).totalMs === 41_000 && end.elapsed_ms === 41_000);

    const r2 = await post('/api/v1/events', { events: session });
    const b2 = await r2.json();
    ok('reenvío idéntico → deduplicado, sin filas nuevas', b2.deduplicated === 4 && rows().length === all.length, JSON.stringify(b2));

    section('[R4/R6] avance y eventos sin equivalencia');
    const sidPdf = ulid();
    const pdf = [
        { eventId: ulid(), schemaVersion: 1, event: 'pdf.session_start', mode: 'pdf', userId: U, contentId: 'c-1', sessionId: sidPdf, clientTs: Date.now(), elapsedMs: 0 },
        { eventId: ulid(), schemaVersion: 1, event: 'pdf.progress', mode: 'pdf', userId: U, contentId: 'c-1', sessionId: sidPdf, clientTs: Date.now(), elapsedMs: 9000, progressFraction: 0.25 },
        { eventId: ulid(), schemaVersion: 1, event: 'immersive.audio_play', mode: 'immersive', userId: U, contentId: 'c-1', sessionId: ulid(), clientTs: Date.now() },
        { eventId: ulid(), schemaVersion: 1, event: 'lu.page_view', mode: 'lu', userId: U, contentId: null, sessionId: ulid(), clientTs: Date.now() },
    ];
    const r3 = await (await post('/api/v1/events', { events: pdf })).json();
    all = rows();
    const prog = all.find(x => x.event === 'reading_progress');
    ok('R4 · pdf.progress → reading_progress con percentage 25', !!prog && JSON.parse(prog.payload_json).percentage === 25 && prog.mode === 'pdf', prog?.payload_json);
    ok('R6 · immersive.audio_play conserva su camino v1', count(all, 'immersive.audio_play') === 1);
    ok('R6 · lu.page_view conserva su camino v1', count(all, 'lu.page_view') === 1);
    ok('   el lote completo aceptado', r3.accepted === 4, JSON.stringify(r3));

    section('[§7] el dual-write legacy ya no duplica los hechos de sesión');
    const before = rows().length;
    const now = Date.now();
    const legacy = [
        { event: 'session_start', userId: U, contentId: 'c-1', timestamp: now, sessionId: sid, streak: 1, level: 2 },
        { event: 'session_end', userId: U, contentId: 'c-1', timestamp: now + 1, sessionId: sid, sessionDuration: 41_000 },
        { event: 'block_complete', userId: U, contentId: 'c-1', timestamp: now + 2, sessionId: sid, progressPercentage: 50 },
        { event: 'level_up', userId: U, contentId: 'c-1', timestamp: now + 3, sessionId: sid, level: 3 },
    ];
    const lr = await post('/api/analytics/events', legacy);
    ok('/api/analytics/events responde como siempre', lr.status === 200 || lr.status === 201, String(lr.status));
    await sleep(300);
    all = rows();
    const added = all.slice(before);
    ok('0 reading_started / session_ended nuevos desde el legacy',
        count(added, 'reading_started') === 0 && count(added, 'session_ended') === 0
        && count(added, 'text.session_start') === 0 && count(added, 'text.session_end') === 0, added.map(x => x.event).join(','));
    ok('block_complete (productor único) → 1 reading_progress canónico',
        count(added, 'reading_progress') === 1 && JSON.parse(added.find(x => x.event === 'reading_progress').payload_json).percentage === 50);
    // level_up: la inferencia de modo legacy (preexistente) lo etiqueta 'immersive'.
    ok('level_up (gamificación) conserva su fila v1', count(added, 'immersive.level_up') === 1, added.map(x => x.event).join(','));
    ok('analytics_db.json sigue recibiendo el legacy', fs.existsSync(path.join(D, 'analytics_db.json'))
        && fs.readFileSync(path.join(D, 'analytics_db.json'), 'utf8').includes('session_start'));

    section('[§7] /api/events: la terminación inmersiva se persiste canónica');
    const b4 = rows().length;
    const er = await post('/api/events', { event: 'session_completed', ts: Date.now(), contentId: 'c-1', sessionId: ulid(), totalSentences: 30 });
    ok('/api/events responde como siempre', er.status === 200, String(er.status));
    const addedC = rows().slice(b4);
    ok('1 reading_completed, 0 immersive.session_completed',
        count(addedC, 'reading_completed') === 1 && count(addedC, 'immersive.session_completed') === 0, addedC.map(x => x.event).join(','));
    ok('R10 · ninguna fila canónica guarda texto libre ni claves fuera de schema',
        rows().filter(x => isCanonicalReadingEventName(x.event)).every(x => {
            const p = JSON.parse(x.payload_json || '{}');
            return !('_source' in p) && !('streak' in p) && !('level' in p) && !('source' in p)
                && Object.values(p).every(v => typeof v !== 'string' || v.length <= 40);
        }));
}

// ────────────────────────────────────────────────────────────────────────────
section('[R9/§13] materializador y Dashboard: sesión canónica ≡ la misma sesión histórica');
{
    // La MISMA lectura dos veces: en vocabulario v1 (historia) y canónica (post-cutover).
    const T0 = Date.UTC(2026, 8, 20, 10, 0, 0);
    const mk = (id, event, ts, extra = {}) => ({ id, event, mode: 'text', user_id: 'u', content_id: 'c-1',
        session_id: 's', server_ts: ts, client_ts: ts, elapsed_ms: extra.elapsed_ms ?? null,
        progress_fraction: extra.pf ?? null, payload_json: JSON.stringify(extra.payload ?? {}),
        // forma que consumen backboneMetrics/Funnels
        eventId: `e${id}`, userId: 'u', contentId: 'c-1', sessionId: 's', serverTs: ts, clientTs: ts,
        elapsedMs: extra.elapsed_ms, progressFraction: extra.pf, payload: extra.payload ?? {} });
    const v1 = [
        mk(1, 'text.session_start', T0, { elapsed_ms: 0, payload: { _source: 'native' } }),
        mk(2, 'text.session_heartbeat', T0 + 15e3, { elapsed_ms: 15e3, pf: 0.1, payload: { _source: 'native' } }),
        mk(3, 'text.session_heartbeat', T0 + 30e3, { elapsed_ms: 30e3, pf: 0.2, payload: { _source: 'native' } }),
        mk(4, 'text.session_end', T0 + 95e3, { elapsed_ms: 95e3, pf: 0.3, payload: { _source: 'native' } }),
    ];
    const canon = [
        mk(1, 'reading_started', T0, { elapsed_ms: 0, payload: { contentId: 'c-1', mode: 'guided', sessionId: 's', startedAt: T0 } }),
        mk(2, 'session_heartbeat', T0 + 15e3, { elapsed_ms: 15e3, pf: 0.1, payload: { sessionId: 's', elapsedMs: 15e3 } }),
        mk(3, 'session_heartbeat', T0 + 30e3, { elapsed_ms: 30e3, pf: 0.2, payload: { sessionId: 's', elapsedMs: 30e3 } }),
        mk(4, 'session_ended', T0 + 95e3, { elapsed_ms: 95e3, pf: 0.3, payload: { sessionId: 's', totalMs: 95e3 } }),
    ];
    const ctx = { nowTs: T0 + 86_400_000, windowDays: 28, leoExtractionEnabled: false };
    const a = computeUserSignals(v1, ctx), b = computeUserSignals(canon, ctx);
    for (const k of ['continuidad_semanal', 'tiempo_efectivo_lectura', 'abandono_temprano', 'diversidad_lectora', 'persistencia']) {
        ok(`señal ${k}: canónica == histórica`, JSON.stringify(a[k]?.value) === JSON.stringify(b[k]?.value)
            && JSON.stringify(a[k]?.meta) === JSON.stringify(b[k]?.meta), `${JSON.stringify(a[k])} | ${JSON.stringify(b[k])}`);
    }
    ok('tiempo efectivo = 95 s en ambos (máximo acumulado, no suma)', b.tiempo_efectivo_lectura.meta.ms === 95_000);

    // Historia + post-cutover en el mismo corpus: dos sesiones distintas cuentan dos, no cuatro.
    const later = canon.map(e => ({ ...e, id: e.id + 10, session_id: 's2', sessionId: 's2', server_ts: e.server_ts + 3_600_000 }));
    const mixed = computeUserSignals([...v1, ...later], ctx);
    ok('corpus mixto: 2 arranques (no 4)', mixed.abandono_temprano.meta.starts === 2, JSON.stringify(mixed.abandono_temprano));
    ok('corpus mixto: tiempo = 2 × 95 s', mixed.tiempo_efectivo_lectura.meta.ms === 190_000, JSON.stringify(mixed.tiempo_efectivo_lectura.meta));

    const ma = aggregateBackboneMetrics(v1, {}), mb = aggregateBackboneMetrics(canon, {});
    const pick = (m) => JSON.stringify({ u: m.usageByMode, t: m.readingTimeByMode, p: m.progressByMode, h: m.heartbeatCoverage });
    ok('Dashboard · backboneMetrics idéntico (uso, tiempo, avance, cobertura)', pick(ma) === pick(mb), `${pick(ma)}\n${pick(mb)}`);
    // `generatedAt` es la hora del cálculo, no un resultado: se excluye.
    const noTs = (f) => { const { generatedAt, ...rest } = f; return rest; };
    const fa = noTs(computeBackboneFunnels(v1, {})), fb = noTs(computeBackboneFunnels(canon, {}));
    ok('Dashboard · backboneFunnels idéntico', JSON.stringify(fa) === JSON.stringify(fb), `${JSON.stringify(fa).slice(0, 300)}\n${JSON.stringify(fb).slice(0, 300)}`);
}

httpPhase()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message, e.stack); fail++; })
    .finally(async () => {
        try { api?.kill('SIGKILL'); } catch { /* ya muerto */ }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows retiene a veces */ }
        console.log(`\nreadingCanonicalProducer: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    });
