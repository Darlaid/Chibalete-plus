/**
 * effectiveReadingTime.test.mjs — CHP-V6-INSIGHTS-PRODUCTION-01 / A2 §6.
 *
 * Contrato del tiempo efectivo (todos los productores emiten ACUMULADO):
 *   [A] heartbeats 60/120/180 s en una sesión → 180 s, NO 360 s
 *   [B] dos sesiones (60/120 + 60/180)        → 300 s
 *   [C] session_end mayor que el último heartbeat → gana, una sola vez
 *   [D] session_end menor o duplicado          → ni reduce ni duplica
 *   [E] eventos técnicos con elapsed_ms        → cero aporte
 *   [F] semántica canónica (elapsedMs/totalMs) → idéntica a la legacy
 *   [G] mismo event_id repetido                → no duplica
 *   [H] sesiones sin tiempo válido             → 0, sin excepciones
 *
 * Puro: sin disco, sin bases, sin red.
 */
import { computeEffectiveReadingMs, accumulatedMsOf } from '../analytics/effectiveReadingTime.mjs';
import { normalizeEventForSignals } from '../analytics/legacyEventNormalizer.mjs';
import { computeUserSignals } from '../services/signalCompute.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);

const nameOf = (e) => normalizeEventForSignals(e.event);
const T0 = Date.parse('2026-07-20T10:00:00Z');
let seq = 0;
const ev = (event, atSec, { ms = null, payload = null, content = 'c-1', id = null } = {}) => ({
    event_id: id ?? `e-${++seq}`, event, user_id: 'U1', content_id: content,
    session_id: `legacy-${++seq}`, server_ts: T0 + atSec * 1000, client_ts: T0 + atSec * 1000,
    elapsed_ms: ms, progress_fraction: null, payload_json: payload ? JSON.stringify(payload) : '{}',
});
const minutes = (rows) => computeEffectiveReadingMs(rows, nameOf).ms / 60_000;

// ── [A] heartbeats acumulativos ─────────────────────────────────────────────
section('[A] heartbeats 60/120/180 s en una sesión → 180 s (no 360)');
{
    const rows = [
        ev('immersive.session_start', 0),
        ev('immersive.session_heartbeat', 60,  { ms: 60_000 }),
        ev('immersive.session_heartbeat', 120, { ms: 120_000 }),
        ev('immersive.session_heartbeat', 180, { ms: 180_000 }),
    ];
    const r = computeEffectiveReadingMs(rows, nameOf);
    ok('ms = 180.000', r.ms === 180_000, String(r.ms));
    ok('NO es la suma 360.000', r.ms !== 360_000);
    ok('1 sesión contabilizada', r.sessions === 1, String(r.sessions));
    ok('sesión más larga = 180 s', r.longest_session_ms === 180_000);
}

// ── [B] dos sesiones distintas ──────────────────────────────────────────────
section('[B] dos sesiones (60/120 + 60/180) → 300 s');
{
    const rows = [
        ev('text.session_start', 0),
        ev('text.session_heartbeat', 60,  { ms: 60_000 }),
        ev('text.session_heartbeat', 120, { ms: 120_000 }),
        ev('text.session_end', 121, { ms: 120_000 }),
        ev('text.session_start', 3600),
        ev('text.session_heartbeat', 3660, { ms: 60_000 }),
        ev('text.session_heartbeat', 3780, { ms: 180_000 }),
        ev('text.session_end', 3781, { ms: 180_000 }),
    ];
    const r = computeEffectiveReadingMs(rows, nameOf);
    ok('ms = 300.000', r.ms === 300_000, String(r.ms));
    ok('2 sesiones', r.sessions === 2, String(r.sessions));
}
{
    // Sin session_end, un nuevo inicio también cierra el tramo anterior.
    const rows = [
        ev('text.session_start', 0),
        ev('text.session_heartbeat', 120, { ms: 120_000 }),
        ev('text.session_start', 3600),
        ev('text.session_heartbeat', 3780, { ms: 180_000 }),
    ];
    const r = computeEffectiveReadingMs(rows, nameOf);
    ok('sin session_end: 300 s en 2 sesiones', r.ms === 300_000 && r.sessions === 2,
        JSON.stringify(r));
}
{
    // Contenidos distintos son sesiones distintas aunque se solapen.
    const rows = [
        ev('text.session_start', 0, { content: 'c-1' }),
        ev('text.session_heartbeat', 60, { ms: 60_000, content: 'c-1' }),
        ev('pdf.session_start', 10, { content: 'c-2' }),
        ev('pdf.session_heartbeat', 70, { ms: 120_000, content: 'c-2' }),
    ];
    const r = computeEffectiveReadingMs(rows, nameOf);
    ok('dos contenidos en paralelo → 180 s en 2 sesiones', r.ms === 180_000 && r.sessions === 2,
        JSON.stringify(r));
}

// ── [C] session_end mayor que el último heartbeat ───────────────────────────
section('[C] session_end mayor → gana, una sola vez');
{
    const rows = [
        ev('album.session_start', 0),
        ev('album.session_heartbeat', 60, { ms: 60_000 }),
        ev('album.session_end', 95, { ms: 95_000 }),
    ];
    const r = computeEffectiveReadingMs(rows, nameOf);
    ok('ms = 95.000 (no 155.000)', r.ms === 95_000, String(r.ms));
    ok('1 sesión', r.sessions === 1);
}

// ── [D] session_end menor o duplicado ───────────────────────────────────────
section('[D] session_end menor o repetido no reduce ni duplica');
{
    const menor = computeEffectiveReadingMs([
        ev('a11y.session_start', 0),
        ev('a11y.session_heartbeat', 120, { ms: 120_000 }),
        ev('a11y.session_end', 121, { ms: 5_000 }),
    ], nameOf);
    ok('gana el máximo: 120.000', menor.ms === 120_000, String(menor.ms));

    const doble = computeEffectiveReadingMs([
        ev('a11y.session_start', 0),
        ev('a11y.session_heartbeat', 120, { ms: 120_000 }),
        ev('a11y.session_end', 121, { ms: 120_000 }),
        ev('a11y.session_end', 122, { ms: 120_000 }),   // doble disparo, event_id distinto
    ], nameOf);
    ok('doble session_end no duplica el tiempo', doble.ms === 120_000, String(doble.ms));
    ok('sigue siendo 1 sola sesión', doble.sessions === 1, String(doble.sessions));

    // Cierre sin apertura previa: no inventa una sesión.
    const huerfano = computeEffectiveReadingMs([ev('a11y.session_end', 10, { ms: 900_000 })], nameOf);
    ok('session_end huérfano abre y cierra su propio tramo una vez',
        huerfano.ms === 900_000 && huerfano.sessions === 1, JSON.stringify(huerfano));
    const triple = computeEffectiveReadingMs([
        ev('a11y.session_start', 0),
        ev('a11y.session_heartbeat', 60, { ms: 60_000 }),
        ev('a11y.session_end', 61, { ms: 60_000 }),
        ev('a11y.session_end', 62, { ms: 60_000 }),
        ev('a11y.session_end', 63, { ms: 60_000 }),
    ], nameOf);
    ok('triple session_end → 60.000 y 1 sesión', triple.ms === 60_000 && triple.sessions === 1,
        JSON.stringify(triple));
}

// ── [E] telemetría técnica ──────────────────────────────────────────────────
section('[E] eventos técnicos con elapsed_ms → cero aporte');
{
    const rows = [
        ev('immersive.chunk_audio_reuse', 10, { ms: 5_000_000 }),
        ev('immersive.sentence_time', 20, { ms: 5_000_000 }),
        ev('immersive.pb_audio_delayed', 30, { ms: 5_000_000 }),
        ev('immersive.audio_play', 40, { ms: 5_000_000 }),
        ev('lu.session_start', 50, { ms: 5_000_000, content: null }),
        ev('lu.session_end', 60, { ms: 5_000_000, content: null }),
        ev('pdf.page_change', 70, { ms: 5_000_000 }),
    ];
    const r = computeEffectiveReadingMs(rows, nameOf);
    ok('ms = 0', r.ms === 0, String(r.ms));
    ok('0 eventos considerados', r.events_considered === 0, String(r.events_considered));
    ok('0 sesiones', r.sessions === 0);
}

// ── [F] semántica canónica ──────────────────────────────────────────────────
section('[F] canónico (elapsedMs / totalMs) ≡ legacy');
{
    const canon = computeEffectiveReadingMs([
        ev('reading_started', 0),
        ev('session_heartbeat', 60,  { payload: { sessionId: 's', elapsedMs: 60_000 } }),
        ev('session_heartbeat', 120, { payload: { sessionId: 's', elapsedMs: 120_000 } }),
        ev('session_heartbeat', 180, { payload: { sessionId: 's', elapsedMs: 180_000 } }),
    ], nameOf);
    ok('acumulado canónico → 180.000', canon.ms === 180_000, String(canon.ms));

    const totalMs = computeEffectiveReadingMs([
        ev('reading_started', 0),
        ev('session_heartbeat', 60, { payload: { sessionId: 's', elapsedMs: 60_000 } }),
        ev('session_ended', 200, { payload: { sessionId: 's', totalMs: 200_000 } }),
    ], nameOf);
    ok('session_ended usa totalMs → 200.000', totalMs.ms === 200_000, String(totalMs.ms));
    ok('el payload manda sobre la columna',
        accumulatedMsOf({ payload_json: '{"elapsedMs":1000}', elapsed_ms: 999_999 }) === 1000);
    ok('sin payload cae a la columna',
        accumulatedMsOf({ payload_json: '{}', elapsed_ms: 4242 }) === 4242);
    ok('payload corrupto cae a la columna',
        accumulatedMsOf({ payload_json: '{no-json', elapsed_ms: 7 }) === 7);
}

// ── [G] duplicados lógicos ──────────────────────────────────────────────────
section('[G] mismo event_id repetido no duplica');
{
    const rows = [
        ev('text.session_start', 0, { id: 'dup-start' }),
        ev('text.session_heartbeat', 60, { ms: 60_000, id: 'dup-hb' }),
        ev('text.session_heartbeat', 60, { ms: 60_000, id: 'dup-hb' }),
        ev('text.session_start', 0, { id: 'dup-start' }),
        ev('text.session_end', 90, { ms: 90_000, id: 'dup-end' }),
        ev('text.session_end', 90, { ms: 90_000, id: 'dup-end' }),
    ];
    const r = computeEffectiveReadingMs(rows, nameOf);
    ok('ms = 90.000', r.ms === 90_000, String(r.ms));
    ok('1 sesión', r.sessions === 1, String(r.sessions));
    ok('3 duplicados descartados', r.duplicates_skipped === 3, String(r.duplicates_skipped));
}

// ── [H] sesiones sin tiempo válido ──────────────────────────────────────────
section('[H] sin tiempo válido → 0, sin excepciones');
for (const [label, rows] of [
    ['lista vacía', []],
    ['no-array', null],
    ['solo starts', [ev('text.session_start', 0), ev('text.session_start', 10)]],
    ['elapsed nulo', [ev('text.session_start', 0), ev('text.session_heartbeat', 60, { ms: null })]],
    ['elapsed negativo', [ev('text.session_start', 0), ev('text.session_end', 60, { ms: -5 })]],
    ['payload no-objeto', [ev('text.session_start', 0), ev('text.session_heartbeat', 60, { payload: 42 })]],
]) {
    let r; let threw = false;
    try { r = computeEffectiveReadingMs(rows, nameOf); } catch { threw = true; }
    ok(`${label} → 0 sin lanzar`, !threw && r.ms === 0, threw ? 'lanzó' : String(r?.ms));
}

// ── No muta la entrada ──────────────────────────────────────────────────────
section('[I] la entrada no se muta ni se reordena');
{
    const rows = [
        ev('text.session_end', 90, { ms: 90_000 }),
        ev('text.session_start', 0),
        ev('text.session_heartbeat', 60, { ms: 60_000 }),
    ];
    const before = JSON.stringify(rows);
    const r = computeEffectiveReadingMs(rows, nameOf);
    ok('array del llamador intacto', JSON.stringify(rows) === before);
    ok('se ordena internamente: 90.000', r.ms === 90_000, String(r.ms));
}

// ── Integración con la señal ────────────────────────────────────────────────
section('[J] tiempo_efectivo_lectura publica minutos y sesiones');
{
    const nowTs = T0 + 3600_000;
    const sig = computeUserSignals([
        ev('immersive.session_start', 0),
        ev('immersive.session_heartbeat', 60,  { ms: 60_000 }),
        ev('immersive.session_heartbeat', 120, { ms: 120_000 }),
        ev('immersive.session_end', 181, { ms: 180_000 }),
        ev('immersive.chunk_audio_reuse', 100, { ms: 9_000_000 }),
    ], { nowTs, windowDays: 28, userId: 'U1' });
    ok('3 minutos', sig.tiempo_efectivo_lectura.value === 3, JSON.stringify(sig.tiempo_efectivo_lectura));
    ok('meta.sessions = 1', sig.tiempo_efectivo_lectura.meta.sessions === 1);
    ok('confidence high con tiempo > 0', sig.tiempo_efectivo_lectura.confidence === 'high');

    const vacio = computeUserSignals([ev('immersive.chunk_audio_reuse', 10, { ms: 9_000_000 })],
        { nowTs, windowDays: 28, userId: 'U1' });
    ok('sin sesiones → 0 y confidence low',
        vacio.tiempo_efectivo_lectura.value === 0 && vacio.tiempo_efectivo_lectura.confidence === 'low');
}

// ── Plausibilidad física ────────────────────────────────────────────────────
section('[K] ningún usuario supera la duración de la ventana');
{
    // 28 días de heartbeats acumulativos cada minuto en UNA sesión continua.
    const rows = [ev('text.session_start', 0)];
    for (let m = 1; m <= 2000; m++) rows.push(ev('text.session_heartbeat', m * 60, { ms: m * 60_000 }));
    const nowTs = T0 + 2100 * 60_000;
    const sig = computeUserSignals(rows, { nowTs, windowDays: 28, userId: 'U1' });
    const windowMinutes = 28 * 24 * 60;
    ok(`${sig.tiempo_efectivo_lectura.value} min ≤ ventana (${windowMinutes} min)`,
        sig.tiempo_efectivo_lectura.value <= windowMinutes,
        JSON.stringify(sig.tiempo_efectivo_lectura));
    ok('igual al último acumulado (2000 min), no a la suma (2.001.000)',
        sig.tiempo_efectivo_lectura.value === 2000, String(sig.tiempo_efectivo_lectura.value));
}

console.log(`\neffectiveReadingTime: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
