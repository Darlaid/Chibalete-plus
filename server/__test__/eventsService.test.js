/**
 * eventsService.test.js — pruebas mínimas de Fase 0.
 *
 * Cómo correr (sin framework, solo Node):
 *   EVENTS_SQLITE_PATH=./.tmp-events-test.db node server/__test__/eventsService.test.js
 *
 * Tests:
 *   1. Inserción de 1 evento válido
 *   2. Batch de 10 eventos válidos
 *   3. Dedupe: insertar el mismo eventId 2 veces → 1 fila
 *   4. Validación: evento inválido → rejected, no insertado
 *   5. Concurrencia: 2 conexiones a la misma DB con 50 inserts paralelos cada una
 *
 * El test usa una DB temporal aparte (EVENTS_SQLITE_PATH override) para no
 * mezclar datos con la DB de dev. Al terminar, borra el archivo temporal.
 */

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Forzar ruta temporal ANTES de importar eventsService — singleton lazy.
const TMP_DB_PATH = path.resolve(__dirname, '../../.tmp-events-test.db');
process.env.EVENTS_SQLITE_PATH = TMP_DB_PATH;

// Limpiar artefactos de runs previos.
for (const ext of ['', '-shm', '-wal']) {
    const f = TMP_DB_PATH + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
}

const {
    validateBackboneEvent,
    insertEvent,
    getEventCount,
    getEventCountByName,
    getEventById,
    closeDb,
} = await import('../eventsService.js');
const { ulid } = await import('../ulid.js');

// ── Helpers ─────────────────────────────────────────────────────────────────
let pass = 0;
let fail = 0;

function assert(cond, label, detail = '') {
    if (cond) {
        pass += 1;
        console.log(`  ✓ ${label}`);
    } else {
        fail += 1;
        console.error(`  ✗ ${label}${detail ? ' — ' + detail : ''}`);
    }
}

function makeValidEvent(overrides = {}) {
    return {
        eventId:        ulid(),
        schemaVersion:  1,
        event:          'a11y.session_start',
        mode:           'a11y',
        userId:         'user-test-1',
        contentId:      'book-test-1',
        sessionId:      'sess-test-1',
        clientTs:       Date.now(),
        elapsedMs:      0,
        progressFraction: 0,
        payload:        { foo: 'bar' },
        ...overrides,
    };
}

// ── Tests ────────────────────────────────────────────────────────────────────

console.log('\n[TEST 1] Inserción de 1 evento válido');
{
    const evt = makeValidEvent();
    const v = validateBackboneEvent(evt, evt.userId);
    assert(v.ok, 'evento pasa validación', v.error);

    const inserted = insertEvent(evt);
    assert(inserted === true, 'insertEvent retorna true');

    const row = getEventById(evt.eventId);
    assert(row !== null, 'evento se encuentra por eventId');
    assert(row.user_id === evt.userId, 'user_id correcto');
    assert(row.event === evt.event, 'event correcto');
    assert(row.mode === evt.mode, 'mode correcto');
    assert(JSON.parse(row.payload_json).foo === 'bar', 'payload_json deserializa');
}

console.log('\n[TEST 2] Batch de 10 eventos válidos');
{
    const before = getEventCount();
    for (let i = 0; i < 10; i++) {
        const evt = makeValidEvent({
            eventId: ulid(),
            event: 'text.session_heartbeat',
            mode: 'text',
            elapsedMs: i * 60_000,
        });
        const inserted = insertEvent(evt);
        assert(inserted === true, `insert #${i + 1} retorna true`);
    }
    const after = getEventCount();
    assert(after - before === 10, '10 filas nuevas en la tabla', `before=${before} after=${after}`);
    const heartbeatCount = getEventCountByName('text.session_heartbeat');
    assert(heartbeatCount === 10, '10 eventos text.session_heartbeat por nombre');
}

console.log('\n[TEST 3] Dedupe — mismo eventId 2 veces');
{
    const evt = makeValidEvent({ event: 'pdf.page_change', mode: 'pdf' });
    const first = insertEvent(evt);
    const second = insertEvent(evt);  // mismo eventId — debe dedupar
    const third = insertEvent(evt);
    assert(first === true,  'primera inserción retorna true');
    assert(second === false, 'segunda inserción retorna false (dedup)');
    assert(third === false,  'tercera inserción retorna false (dedup)');

    const row = getEventById(evt.eventId);
    assert(row !== null, 'evento sigue presente tras intentos duplicados');
}

console.log('\n[TEST 4] Validación — eventos inválidos');
{
    const cases = [
        [{ ...makeValidEvent(), eventId: 'not-a-ulid' }, 'eventId inválido'],
        [{ ...makeValidEvent(), schemaVersion: 2 },      'schemaVersion incorrecta'],
        [{ ...makeValidEvent(), event: 'no_dot_format' }, 'event sin formato {mode}.{action}'],
        [{ ...makeValidEvent(), mode: 'unknown_mode' },   'mode inválido'],
        [{ ...makeValidEvent(), userId: '' },             'userId vacío'],
        [{ ...makeValidEvent(), sessionId: '' },          'sessionId vacío'],
        [{ ...makeValidEvent(), clientTs: 'abc' },        'clientTs no numérico'],
        [{ ...makeValidEvent(), payload: 'no-object' },   'payload no objeto'],
    ];

    for (const [evt, label] of cases) {
        const v = validateBackboneEvent(evt, evt.userId);
        assert(!v.ok, `rechazado: ${label}`, v.ok ? 'pero pasó validación' : '');
    }

    // x-user-id mismatch
    const evt = makeValidEvent({ userId: 'user-X' });
    const v = validateBackboneEvent(evt, 'user-Y');
    assert(!v.ok, 'rechazado: userId no coincide con header');

    // Payload > 4KB
    const big = makeValidEvent({ payload: { blob: 'A'.repeat(5000) } });
    const vBig = validateBackboneEvent(big, big.userId);
    assert(!vBig.ok, 'rechazado: payload > 4KB');
}

console.log('\n[TEST 5] Concurrencia — 2 conexiones SQLite simultáneas');
{
    const db1 = new Database(TMP_DB_PATH);
    const db2 = new Database(TMP_DB_PATH);
    db1.pragma('journal_mode = WAL');
    db2.pragma('journal_mode = WAL');
    db1.pragma('busy_timeout = 5000');
    db2.pragma('busy_timeout = 5000');

    const stmt1 = db1.prepare(`
        INSERT OR IGNORE INTO events (
            event_id, schema_version, event, mode, user_id, content_id, session_id,
            client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at
        ) VALUES (?, 1, 'concurrent.write', 'a11y', 'u-c1', NULL, 'sess-c', ?, ?, NULL, NULL, NULL, ?)
    `);
    const stmt2 = db2.prepare(`
        INSERT OR IGNORE INTO events (
            event_id, schema_version, event, mode, user_id, content_id, session_id,
            client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at
        ) VALUES (?, 1, 'concurrent.write', 'a11y', 'u-c2', NULL, 'sess-c', ?, ?, NULL, NULL, NULL, ?)
    `);

    const before = getEventCount();
    let errors1 = 0, errors2 = 0;

    // Inserciones intercaladas — simula api_1 y api_2 escribiendo al mismo tiempo.
    for (let i = 0; i < 100; i++) {
        const id1 = ulid();
        const id2 = ulid();
        const ts = Date.now();
        try { stmt1.run(id1, ts, ts, ts); } catch (e) { errors1 += 1; }
        try { stmt2.run(id2, ts, ts, ts); } catch (e) { errors2 += 1; }
    }

    db1.close();
    db2.close();

    const after = getEventCount();
    assert(errors1 === 0, 'sin errores de lock en conexión 1');
    assert(errors2 === 0, 'sin errores de lock en conexión 2');
    assert(after - before === 200, '200 inserciones concurrentes persistidas',
        `before=${before} after=${after} delta=${after - before}`);
}

console.log('\n[TEST 6] Sanity — count total');
{
    const total = getEventCount();
    console.log(`  total filas en events.db: ${total}`);
    assert(total > 0, 'la DB tiene filas');
}

// ── Cierre ───────────────────────────────────────────────────────────────────
closeDb();

console.log(`\n──────────────────────────────────────────────`);
console.log(`Resultado: ${pass} pass / ${fail} fail`);
console.log(`──────────────────────────────────────────────`);

// Cleanup de la DB temporal.
for (const ext of ['', '-shm', '-wal']) {
    const f = TMP_DB_PATH + ext;
    if (fs.existsSync(f)) fs.unlinkSync(f);
}

process.exit(fail === 0 ? 0 : 1);
