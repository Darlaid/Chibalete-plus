/**
 * archiveRotation01d.test.mjs — CHP-EVENTS-RETENTION-ROTATION-01D.
 *
 * Ciclo 0–90 días (events.db) → 90 días–12 meses (events.archive.db) → expirado.
 * Solo bases SQLite TEMPORALES creadas aquí; `nowTs` inyectado (determinista);
 * rotación forzada por opción explícita, jamás por entorno global.
 *
 *   node server/__test__/archiveRotation01d.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';

// Aislar ANTES de cargar módulos: los stores del helper apuntan a un tmp propio.
import './helpers/testMode.mjs';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_rot01d_'));
process.env.EVENTS_SQLITE_PATH  = path.join(tmp, 'events.db');
process.env.ARCHIVE_SQLITE_PATH = path.join(tmp, 'events.archive.db');
delete process.env.ARCHIVE_ROTATION_ENABLED;
delete process.env.AULA_VIVA_SCHEDULER_ENABLED;

const eventsService = await import('../eventsService.js');
const rot = await import('../aulaViva/archiveRotation.mjs');
const scheduler = await import('../aulaViva/scheduler.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 15, 12, 0, 0, 0);            // 2026-09-15T12:00:00Z
const AGO_DAYS = (d) => NOW - d * DAY;
const MONTHS_AGO = (m) => rot.subtractMonthsUtc(NOW, m); // calendario UTC

// ─── helpers sobre bases temporales ─────────────────────────────────────────
const LIVE = process.env.EVENTS_SQLITE_PATH;
const ARCH = process.env.ARCHIVE_SQLITE_PATH;
const open = (p, ro = true) => new Database(p, ro ? { readonly: true, fileMustExist: true } : {});
const rows = (p) => { const d = open(p); try { return d.prepare('SELECT * FROM events ORDER BY event_id').all(); } finally { d.close(); } };
const ids = (p) => rows(p).map(r => r.event_id);
const hashOf = (p) => crypto.createHash('sha256').update(JSON.stringify(rows(p))).digest('hex');
const rowById = (p, id) => rows(p).find(r => r.event_id === id) ?? null;
const insertLive = (r) => {
    const d = new Database(LIVE);
    try {
        d.prepare(`INSERT INTO events (event_id, schema_version, event, mode, user_id, content_id, session_id,
                    client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
                   VALUES (@event_id, @schema_version, @event, @mode, @user_id, @content_id, @session_id,
                    @client_ts, @server_ts, @elapsed_ms, @progress_fraction, @payload_json, @created_at)`).run({
            schema_version: 1, event: 'experience_started', mode: 'experience', user_id: 'u-rot', content_id: null,
            session_id: 's-rot', client_ts: r.server_ts, elapsed_ms: null, progress_fraction: null,
            payload_json: JSON.stringify({ experienceId: 'exp-1', experienceVersionId: 'ver-1', runId: 'run-' + r.event_id }),
            created_at: r.server_ts, ...r,
        });
    } finally { d.close(); }
};
const run = (extra = {}) => rot.rotateOnce({ nowTs: NOW, forceRun: true, retentionDays: 90, log: () => {}, ...extra });

// Schema del store vivo por la autoridad existente (eventsService), sin datos.
eventsService.getEventCount();
ok('precondición: store vivo temporal creado vacío por eventsService', fs.existsSync(LIVE) && rows(LIVE).length === 0);

console.log('\n[15] Imports e inicio normal no crean el archivo ni rotan');
{
    ok('15a. importar eventsService + archiveRotation no crea events.archive.db', !fs.existsSync(ARCH));
    const st = rot.getStatus();
    ok('15b. getStatus reporta apagado, 90 días / 12 meses, sin archivo', st.ok && st.enabled === false && st.retention_days === 90 && st.retention_months === 12 && st.archive_present === false && !fs.existsSync(ARCH));
    const s = await scheduler.start();
    ok('15c. scheduler.start() con defaults: no arranca ni rota', s.ok === true && s.started === false && !fs.existsSync(ARCH));
}

console.log('\n[fixture] filas vivas con edades controladas');
const INVALID_MARKER = JSON.stringify({ __validation_failed: 'EVENT_PAYLOAD_INVALID', __reason: 'invalid_payload' });
insertLive({ event_id: 'ev-1d',     server_ts: AGO_DAYS(1) });
insertLive({ event_id: 'ev-27d',    server_ts: AGO_DAYS(27) });
insertLive({ event_id: 'ev-89d',    server_ts: AGO_DAYS(89) });
insertLive({ event_id: 'ev-90d',    server_ts: AGO_DAYS(90) });                        // frontera inclusiva
insertLive({ event_id: 'ev-91d',    server_ts: AGO_DAYS(91), elapsed_ms: 1234, progress_fraction: 0.5, content_id: 'c-1' });
insertLive({ event_id: 'ev-invalid', server_ts: AGO_DAYS(120), payload_json: INVALID_MARKER, schema_version: 0 });
insertLive({ event_id: 'ev-11m',    server_ts: MONTHS_AGO(11) });
insertLive({ event_id: 'ev-12m',    server_ts: MONTHS_AGO(12) });                      // exactamente 12 meses
insertLive({ event_id: 'ev-12m+1',  server_ts: MONTHS_AGO(12) - 1 });                  // supera 12 meses
insertLive({ event_id: 'ev-dup',    server_ts: AGO_DAYS(200) });                       // ya presente en el archivo
const before = Object.fromEntries(rows(LIVE).map(r => [r.event_id, r]));

console.log('\n[14] Rotador apagado: cero escrituras');
{
    delete process.env.ARCHIVE_ROTATION_ENABLED;
    const h = hashOf(LIVE);
    const r = rot.rotateOnce({ nowTs: NOW, retentionDays: 90, log: () => {} }); // sin forceRun, sin env
    ok('14. OFF por defecto: skipped, store vivo byte-idéntico y sin archivo creado',
        r.ok === true && r.skipped === true && r.reason === 'disabled_default_off' && hashOf(LIVE) === h && !fs.existsSync(ARCH));
}

console.log('\n[8-pre] archivo pre-sembrado con un evento ya archivado y un bloqueo de inserción');
{
    // Primera rotación en dryRun crea el schema del archivo por la vía existente, sin mover nada.
    const dry = run({ dryRun: true });
    ok('dryRun crea el archivo vacío y cuenta candidatos sin mover', dry.ok && dry.dryRun && dry.candidates === 7 && dry.moved === 0 && fs.existsSync(ARCH) && rows(ARCH).length === 0 && hashOf(LIVE) === hashOf(LIVE));
    const a = new Database(ARCH);
    try {
        // ev-dup ya archivado (misma fila que en vivo) y un evento antiguo solo del archivo.
        const d = before['ev-dup'];
        a.prepare(`INSERT INTO events (id, event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
                   VALUES (@id, @event_id, @schema_version, @event, @mode, @user_id, @content_id, @session_id, @client_ts, @server_ts, @elapsed_ms, @progress_fraction, @payload_json, @created_at)`).run(d);
        a.prepare(`INSERT INTO events (id, event_id, schema_version, event, mode, user_id, content_id, session_id, client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
                   VALUES (9001, 'arch-13m', 1, 'experience_started', 'experience', 'u-rot', NULL, 's-rot', @ts, @ts, NULL, NULL, '{}', @ts)`).run({ ts: MONTHS_AGO(13) });
        // Restricción SQLite existente para provocar la falla de archivado (test 10).
        a.exec(`CREATE TRIGGER block_archive BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'archive blocked by test'); END;`);
    } finally { a.close(); }
}

console.log('\n[10] Falla de inserción en el archivo → el vivo queda intacto');
{
    const hLive = hashOf(LIVE), hArch = hashOf(ARCH);
    const r = run();
    ok('10. la rotación falla (trigger) y hace ROLLBACK: ok=false, nada movido, vivo y archivo byte-idénticos',
        r.ok === false && /archive blocked by test/.test(r.error || '') && hashOf(LIVE) === hLive && hashOf(ARCH) === hArch && rows(LIVE).length === 10);
}

console.log('\n[11] Reanudación tras retirar el bloqueo: la operación se completa sin pérdida');
let r1;
{
    const a = new Database(ARCH); try { a.exec('DROP TRIGGER block_archive'); } finally { a.close(); }
    r1 = run();
    ok('11. rotación completa: ok, candidatos=7, movidos=6 (ev-dup ya estaba), retirados=7, expirados=2',
        r1.ok === true && r1.candidates === 7 && r1.moved === 6 && r1.deleted === 7 && r1.expired === 2 && r1.integrity_pre === 'ok' && r1.integrity_post === 'ok',
        JSON.stringify(r1));
}

console.log('\n[1–5, 12] Fronteras temporales');
{
    const live = ids(LIVE), arch = ids(ARCH);
    ok('1. evento de 89 días permanece vivo', live.includes('ev-89d') && !arch.includes('ev-89d'));
    ok('2. evento que alcanza exactamente 90 días pasa al archivo', arch.includes('ev-90d') && !live.includes('ev-90d'));
    ok('2b. evento de 91 días pasa al archivo', arch.includes('ev-91d') && !live.includes('ev-91d'));
    ok('3. evento de 11 meses permanece archivado', arch.includes('ev-11m') && !live.includes('ev-11m'));
    ok('4. evento de exactamente 12 meses permanece archivado', arch.includes('ev-12m') && !live.includes('ev-12m'));
    ok('5. evento que supera 12 meses expira del archivo (y el pre-sembrado de 13 meses también)',
        !arch.includes('ev-12m+1') && !live.includes('ev-12m+1') && !arch.includes('arch-13m'));
    ok('13. eventos recientes y de la ventana analítica (1 d, 27 d) intactos byte a byte',
        JSON.stringify(rowById(LIVE, 'ev-1d')) === JSON.stringify(before['ev-1d']) && JSON.stringify(rowById(LIVE, 'ev-27d')) === JSON.stringify(before['ev-27d']) && live.length === 3);
    ok('expiry_cutoff = 12 meses calendario UTC antes de NOW (2025-09-15T12:00:00Z)',
        new Date(r1.expiry_cutoff_ts).toISOString() === '2025-09-15T12:00:00.000Z');
    // Calendario, no 365 días: cuando el intervalo contiene un 29 de febrero
    // (2028 bisiesto) 12 meses = 366 días y el cálculo por días divergiría.
    const leapNow = Date.UTC(2028, 8, 15, 12);
    ok('12 meses calendario UTC ≠ 365 días cuando el intervalo cruza un 29 de febrero',
        new Date(rot.subtractMonthsUtc(leapNow, 12)).toISOString() === '2027-09-15T12:00:00.000Z'
        && rot.subtractMonthsUtc(leapNow, 12) !== leapNow - 365 * DAY);
    ok('subtractMonthsUtc sujeta el día al último del mes destino (31 mar → 28 feb, 29 feb → 28 feb)',
        new Date(rot.subtractMonthsUtc(Date.UTC(2026, 2, 31), 1)).toISOString() === '2026-02-28T00:00:00.000Z'
        && new Date(rot.subtractMonthsUtc(Date.UTC(2028, 1, 29), 12)).toISOString() === '2027-02-28T00:00:00.000Z');
}

console.log('\n[6, 7, 8] Invariantes de contenido e idempotencia');
{
    const a91 = rowById(ARCH, 'ev-91d');
    ok('6. columnas y payload byte-idénticos tras archivar (incluido id, content_id, elapsed_ms, progress_fraction)',
        JSON.stringify(a91) === JSON.stringify(before['ev-91d']));
    const ainv = rowById(ARCH, 'ev-invalid');
    ok('7. el marcador de payload inválido saneado se conserva tal cual (schema_version 0)',
        !!ainv && ainv.payload_json === INVALID_MARKER && ainv.schema_version === 0 && JSON.stringify(ainv) === JSON.stringify(before['ev-invalid']));
    const dupCount = rows(ARCH).filter(r => r.event_id === 'ev-dup').length;
    ok('8. evento ya presente en el archivo no se duplica y se retira del vivo', dupCount === 1 && !ids(LIVE).includes('ev-dup'));
}

console.log('\n[9] Segunda ejecución idempotente');
{
    const hLive = hashOf(LIVE), hArch = hashOf(ARCH);
    const r2 = run();
    ok('9. rerun: ok, cero candidatos/movidos/retirados/expirados, ambas bases byte-idénticas',
        r2.ok === true && r2.candidates === 0 && r2.moved === 0 && r2.deleted === 0 && r2.expired === 0 && hashOf(LIVE) === hLive && hashOf(ARCH) === hArch);
}

console.log('\n[12] Evento tardío con más de 90 días se archiva en la siguiente corrida');
{
    insertLive({ event_id: 'ev-late-200d', server_ts: AGO_DAYS(200), created_at: NOW });
    const r3 = run();
    ok('12. el evento tardío (server_ts 200 d, created_at hoy) se archiva; nada más cambia',
        r3.ok && r3.candidates === 1 && r3.moved === 1 && r3.deleted === 1 && r3.expired === 0 && ids(ARCH).includes('ev-late-200d') && !ids(LIVE).includes('ev-late-200d'));
}

console.log('\n[cierre] Sin efectos fuera del entorno temporal');
{
    const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', '..');
    const stray = fs.existsSync(path.join(REPO, 'data-critical', 'events.archive.db'));
    ok('ningún events.archive.db creado en data-critical/ del repo (solo tmp)', !stray || fs.statSync(path.join(REPO, 'data-critical', 'events.archive.db')).mtimeMs < Date.now() - 10 * 60_000);
    ok('la rotación sigue apagada por defecto al terminar', !rot.ENABLED());
}

console.log(`\narchiveRotation01d: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
