/**
 * legacyEventNormalizer.test.mjs — CHP-V6-INSIGHTS-PRODUCTION-01 / A1 §12.
 *
 * Contrato del adapter legacy → semántica canónica:
 *   [1] canónico → identidad
 *   [2] <modo>.session_start     → reading_started
 *   [3] <modo>.session_end       → session_ended
 *   [4] <modo>.session_heartbeat → session_heartbeat
 *   [5] técnico sin equivalencia → sin cambio (no genera señal falsa)
 *   [6] la fila fuente queda intacta (id/user/ts/payload)
 *   [7] los eventos canónicos actuales no cambian de comportamiento
 *   [8] NO hay mapeo difuso por prefijo (lu.* y nombres inventados)
 *
 * Puro: no toca disco, ni bases, ni red.
 */
import {
    normalizeEventForSignals, isNormalizedLegacyEvent, LEGACY_EVENT_MAP,
} from '../analytics/legacyEventNormalizer.mjs';
import { computeUserSignals } from '../services/signalCompute.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const READING_MODES = ['immersive', 'text', 'pdf', 'album', 'a11y'];

// ── §[1] canónico → identidad ────────────────────────────────────────────────
section('[1] eventos canónicos → identidad');
for (const e of ['session_started', 'session_ended', 'session_heartbeat',
                 'reading_started', 'reading_progress', 'reading_completed',
                 'reading_abandoned', 'reading_resumed', 'leo_interaction_started',
                 'evidence_reviewed', 'mediator_reviewed_cohort']) {
    ok(`${e} → ${e}`, normalizeEventForSignals(e) === e);
}

// ── §[2][3][4] familias de sesión, por cada modo de lectura ─────────────────
section('[2] <modo>.session_start → reading_started');
for (const m of READING_MODES) {
    ok(`${m}.session_start`, normalizeEventForSignals(`${m}.session_start`) === 'reading_started');
}
section('[3] <modo>.session_end → session_ended (NO reading_completed/abandoned)');
for (const m of READING_MODES) {
    const r = normalizeEventForSignals(`${m}.session_end`);
    ok(`${m}.session_end → session_ended`, r === 'session_ended', `obtuvo ${r}`);
    ok(`${m}.session_end NO es completed/abandoned`,
        r !== 'reading_completed' && r !== 'reading_abandoned');
}
section('[4] <modo>.session_heartbeat → session_heartbeat');
for (const m of READING_MODES) {
    ok(`${m}.session_heartbeat`, normalizeEventForSignals(`${m}.session_heartbeat`) === 'session_heartbeat');
}

section('[4b] avance y terminación');
for (const e of ['album.progress', 'pdf.progress', 'a11y.progress',
                 'text.block_complete', 'immersive.block_complete']) {
    ok(`${e} → reading_progress`, normalizeEventForSignals(e) === 'reading_progress');
}
ok('immersive.session_completed → reading_completed',
    normalizeEventForSignals('immersive.session_completed') === 'reading_completed');
ok('text.album_completed → reading_completed',
    normalizeEventForSignals('text.album_completed') === 'reading_completed');

// ── §[5] técnico sin equivalencia → sin cambio ───────────────────────────────
section('[5] telemetría técnica NO produce señal falsa');
const TECHNICAL = [
    'immersive.chunk_audio_reuse', 'immersive.chunk_audio_skip_reload',
    'immersive.sentence_time', 'immersive.sentence_rhythm', 'immersive.sentence_skipped',
    'immersive.audio_play', 'immersive.audio_pause', 'immersive.playback_paused',
    'immersive.pb_audio_preparing', 'immersive.pb_manual_sentence_jump',
    'immersive.blob_invalid', 'immersive.tts_fail', 'immersive.load_cancelled',
    'immersive.level_up', 'immersive.streak_break',
    'immersive.transition_to_next_content', 'pdf.page_change', 'text.leo_interaction',
];
for (const e of TECHNICAL) {
    const r = normalizeEventForSignals(e);
    ok(`${e} sin cambio`, r === e, `obtuvo ${r}`);
    ok(`${e} no declarado`, !isNormalizedLegacyEvent(e));
}

// ── §[8] nada de mapeo difuso ────────────────────────────────────────────────
section('[8] sin heurística de prefijo');
for (const e of ['lu.session_start', 'lu.session_end', 'lu.page_view',
                 'lu.download_start', 'lu.version_check']) {
    const r = normalizeEventForSignals(e);
    ok(`${e} NO se trata como lectura`, r === e, `obtuvo ${r}`);
}
for (const e of ['video.session_start', 'inventado.session_end', 'session_start',
                 'session_end', '.session_start', 'immersive.', 'immersive']) {
    ok(`${e || '(vacío)'} sin cambio`, normalizeEventForSignals(e) === e);
}
ok('session_start desnudo NO es session_started',
    normalizeEventForSignals('session_start') !== 'session_started');
ok('session_end desnudo NO es session_ended',
    normalizeEventForSignals('session_end') !== 'session_ended');
ok('no hay entradas con lu. en la tabla',
    !Object.keys(LEGACY_EVENT_MAP).some(k => k.startsWith('lu.')));
ok('toda la tabla mapea a nombres canónicos conocidos',
    Object.values(LEGACY_EVENT_MAP).every(v => [
        'reading_started', 'reading_progress', 'reading_completed',
        'session_ended', 'session_heartbeat',
    ].includes(v)));

section('[8b] entradas no-string / vacías');
for (const v of [null, undefined, '', 0, {}, []]) {
    ok(`${JSON.stringify(v)} devuelto tal cual`, normalizeEventForSignals(v) === v);
}

// ── §[6] la fila fuente queda intacta ───────────────────────────────────────
section('[6] computeUserSignals no muta las filas');
const nowTs = Date.parse('2026-07-31T21:52:00Z');
const day = (d) => nowTs - d * 86400_000;
const row = (id, event, ts, extra = {}) => ({
    id, event, user_id: 'U1', session_id: `s-${id}`, content_id: `c-${id % 3}`,
    server_ts: ts, client_ts: ts, elapsed_ms: null, progress_fraction: null,
    payload_json: '{"k":"v"}', ...extra,
});
// Una sesión real: los tres eventos comparten contentId (si no, serían tres
// sesiones distintas y el tiempo no sería comparable).
const rows = [
    row(1, 'immersive.session_start', day(1), { content_id: 'c-A' }),
    row(2, 'immersive.session_heartbeat', day(1), { content_id: 'c-A', elapsed_ms: 600_000 }),
    row(3, 'immersive.session_end', day(1), { content_id: 'c-A', elapsed_ms: 900_000 }),
    row(4, 'text.session_start', day(3), { content_id: 'c-B' }),
    row(5, 'immersive.session_completed', day(3), { content_id: 'c-B' }),
    row(6, 'immersive.chunk_audio_reuse', day(3), { content_id: 'c-B' }),
];
const before = JSON.stringify(rows);
const sig = computeUserSignals(rows, { nowTs, windowDays: 28, userId: 'U1' });
ok('filas idénticas después del cómputo (id/user/ts/payload)', JSON.stringify(rows) === before);

// ── Efecto real: legacy deja de ser invisible ───────────────────────────────
section('[6b] las señales ya consumen legacy');
ok('continuidad_semanal cuenta 2 días distintos',
    sig.continuidad_semanal?.meta?.distinct_days === 2,
    JSON.stringify(sig.continuidad_semanal?.meta));
// A2: el tiempo es el MÁXIMO acumulado de la sesión (15 min del session_end),
// no la suma del heartbeat (10) más el cierre (15).
ok('tiempo_efectivo_lectura = 15 min (máximo de la sesión, no 25)',
    sig.tiempo_efectivo_lectura?.value === 15, JSON.stringify(sig.tiempo_efectivo_lectura));
ok('abandono_temprano ve 2 starts', sig.abandono_temprano?.meta?.starts === 2,
    JSON.stringify(sig.abandono_temprano?.meta));
ok('persistencia ve 1 completed', sig.persistencia?.meta?.completed === 1,
    JSON.stringify(sig.persistencia?.meta));

// ── §[7] los canónicos conservan su comportamiento ──────────────────────────
section('[7] canónicos: comportamiento previo intacto');
const canonRows = [
    row(11, 'reading_started', day(1), { content_id: 'c-A' }),
    row(12, 'session_heartbeat', day(1), { content_id: 'c-A', elapsed_ms: 600_000 }),
    row(13, 'session_ended', day(1), { content_id: 'c-A', elapsed_ms: 900_000 }),
    row(14, 'reading_started', day(3), { content_id: 'c-B' }),
    row(15, 'reading_completed', day(3), { content_id: 'c-B' }),
    row(16, 'immersive.chunk_audio_reuse', day(3), { content_id: 'c-B' }),
];
const canonSig = computeUserSignals(canonRows, { nowTs, windowDays: 28, userId: 'U1' });
for (const k of ['continuidad_semanal', 'tiempo_efectivo_lectura', 'abandono_temprano',
                 'diversidad_lectora', 'persistencia']) {
    ok(`${k}: legacy normalizado ≡ canónico equivalente`,
        JSON.stringify(canonSig[k]) === JSON.stringify(sig[k]),
        `${JSON.stringify(canonSig[k])} vs ${JSON.stringify(sig[k])}`);
}

// Un corpus puramente técnico no debe producir ninguna señal con valor.
section('[7b] corpus solo técnico → sin señales de lectura');
const techSig = computeUserSignals(
    [row(21, 'immersive.sentence_time', day(1)), row(22, 'immersive.audio_play', day(2))],
    { nowTs, windowDays: 28, userId: 'U1' });
ok('continuidad_semanal = 0 días', techSig.continuidad_semanal?.meta?.distinct_days === 0);
ok('tiempo_efectivo_lectura = 0', techSig.tiempo_efectivo_lectura?.value === 0);
ok('abandono_temprano sin starts', techSig.abandono_temprano?.meta?.starts === 0);

// La telemetría técnica NO es tiempo de lectura, aunque traiga elapsed_ms.
section('[7d] elapsed_ms de eventos técnicos no cuenta como tiempo de lectura');
{
    const noisy = computeUserSignals([
        row(41, 'immersive.session_heartbeat', day(1), { elapsed_ms: 600_000 }),
        row(42, 'immersive.chunk_audio_reuse', day(1), { elapsed_ms: 5_000_000 }),
        row(43, 'immersive.sentence_time',     day(1), { elapsed_ms: 5_000_000 }),
        row(44, 'immersive.pb_audio_delayed',  day(1), { elapsed_ms: 5_000_000 }),
    ], { nowTs, windowDays: 28, userId: 'U1' });
    ok('solo los 10 min del heartbeat', noisy.tiempo_efectivo_lectura?.value === 10,
        JSON.stringify(noisy.tiempo_efectivo_lectura));
}

// El payload manda: un canónico con ambas fuentes de tiempo NO suma dos veces.
section('[7c] payload.elapsedMs tiene prioridad sobre la columna');
const bothSig = computeUserSignals([
    row(31, 'session_heartbeat', day(1), { elapsed_ms: 999_999, payload_json: '{"elapsedMs":600000}' }),
], { nowTs, windowDays: 28, userId: 'U1' });
ok('suma 10 min (payload), no 26 ni 27', bothSig.tiempo_efectivo_lectura?.value === 10,
    JSON.stringify(bothSig.tiempo_efectivo_lectura));

console.log(`\nlegacyEventNormalizer: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
