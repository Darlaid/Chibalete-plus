/**
 * economicEpisodes.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F3-A1.
 *
 * Gate F3-A1 (PLAN_GENERAL_V1_1.md §7, DECISIONES_F0C.md): escenarios T1–T19
 * del contrato multimodo con fixtures sintéticos para PDF, Guiado (text),
 * Inmersivo, Accesible (a11y), EPUB y Libro-Álbum.
 *
 * Puro: sin disco, sin bases, sin red.
 */
import assert from 'node:assert/strict';
import { computeEconomicEpisodes, RULE_SET_RS_2026_01_V1 } from '../economicEpisodes.mjs';
import { computeEffectiveReadingMs } from '../../analytics/effectiveReadingTime.mjs';
import { normalizeEventForSignals } from '../../analytics/legacyEventNormalizer.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const eq = (l, a, b) => ok(l, JSON.stringify(a) === JSON.stringify(b), `→ ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`);
const section = (t) => console.log(`\n${t}`);

// ── fixtures ────────────────────────────────────────────────────────────────
const MODES = ['pdf', 'text', 'immersive', 'a11y', 'album', 'epub'];
const AUDIO_MODES = ['immersive', 'text', 'a11y', 'album'];
const T0 = Date.parse('2026-11-03T15:00:00Z'); // 10:00 en Bogotá; múltiplo de 15 s
const PAID = { ruleId: 'access-b2c-production-order-1', commercialClass: 'paid_b2c' };
let seq = 0;
const at = (sec) => T0 + sec * 1000;
const everyN = (from, to, step) => { const o = []; for (let s = from; s <= to; s += step) o.push(s); return o; };

function row(event, { user, content, mode, sid, sec, payload, ingest = 2 }) {
    return {
        event_id: `ev-${String(++seq).padStart(7, '0')}`, event, mode, user_id: user, content_id: content,
        session_id: sid, client_ts: at(sec), server_ts: at(sec + ingest), elapsed_ms: null,
        progress_fraction: null, payload_json: JSON.stringify(payload ?? {}),
    };
}

/**
 * Sesión técnica sintética: session_start + econ_tick cada `tick` s en (from, to],
 * más un tick de cierre en `to` si no cae en la rejilla (requisito para F3-A3:
 * el hook emite un econ_tick final al desmontar).
 */
function session(o = {}) {
    const {
        user = 'U1', content = 'W1', mode = 'pdf', sid = `s-${++seq}`, from = 0, to = 600,
        visible = true, audio = null, access = PAID, start = true, tick = 15, kind,
    } = o;
    const signals = [...(o.signals ?? everyN(from, to, 10))].sort((a, b) => a - b);
    const rows = [];
    if (start) rows.push(row(`${mode}.session_start`, { user, content, mode, sid, sec: from, payload: { econAccess: access } }));
    let prev = from;
    const times = [];
    for (let t = from + tick; t <= to; t += tick) times.push(t);
    if (times[times.length - 1] !== to && to > from) times.push(to);
    for (const t of times) {
        const lo = prev;
        const inWin = signals.filter((s) => (prev === from ? s >= lo : s > lo) && s <= t);
        const upTo = signals.filter((s) => s <= t);
        const last = upTo.length ? upTo[upTo.length - 1] : null;
        const payload = {
            windowMs: (t - prev) * 1000,
            visible: typeof visible === 'function' ? visible(t) : visible,
            humanSignalAgoMs: last === null ? null : (t - last) * 1000,
            firstHumanSignalAgoMs: inWin.length ? (t - inWin[0]) * 1000 : null,
        };
        if (kind) payload.humanSignalKind = kind;
        if (audio) payload.audio = audio(t);
        rows.push(row('econ_tick', { user, content, mode, sid, sec: t, payload }));
        prev = t;
    }
    return rows;
}
const play = (over = {}) => () => ({ playing: true, gesture: true, mediaAdvancedMs: 15_000, rate: 1, muted: false, ...over });
/** Escucha: gesto inicial y pantalla oculta. */
const listening = (o = {}) => session({ signals: [o.from ?? 0], visible: false, audio: play(o.audioOver), ...o });

const BASE_CTX = {
    ruleSet: RULE_SET_RS_2026_01_V1,
    eligibleContentIds: ['W1', 'W2', 'W3'],
    expectedMinutesByContent: { W1: 10, W2: 10 },
    excludedUsers: {},
    clockSkewToleranceMs: 5_000,
    maxIngestDelayMs: 120_000,
};
const run = (rows, extra = {}) => computeEconomicEpisodes(rows, { ...BASE_CTX, ...extra });
const work = (res, id) => res.works.find((w) => w.contentId === id) ?? { Q: 0, R: null };
const epsOf = (res, id) => res.episodes.filter((e) => e.contentId === id);
const active = (res, id) => epsOf(res, id).reduce((s, e) => s + e.activeSeconds, 0);

// ── T1 ──────────────────────────────────────────────────────────────────────
section('T1 — 10 min continuos en un modo → 1 episodio, 600 s');
{
    const r = run(session({ mode: 'pdf' }));
    eq('1 episodio', r.episodes.length, 1);
    eq('600 s activos', r.episodes[0].activeSeconds, 600);
    eq('Q = 1', work(r, 'W1').Q, 1);
    eq('R = min(1, 10/10) = 1', work(r, 'W1').R, 1);
}

// ── T2 ──────────────────────────────────────────────────────────────────────
section('T2 — PDF → Guiado → Accesible sin interrupción → Q = 1, tiempo = unión');
{
    const rows = [
        ...session({ mode: 'pdf', from: 0, to: 200 }),
        ...session({ mode: 'text', from: 200, to: 400 }),
        ...session({ mode: 'a11y', from: 400, to: 600 }),
    ];
    const r = run(rows);
    eq('1 episodio pese a 3 modos', r.episodes.length, 1);
    eq('Q = 1', work(r, 'W1').Q, 1);
    eq('600 s (unión, no suma)', r.episodes[0].activeSeconds, 600);
    eq('desglose por modo suma el total', Object.values(r.episodes[0].modeSeconds).reduce((a, b) => a + b, 0), 600);
    eq('desglose descriptivo de los tres modos', Object.keys(r.episodes[0].modeSeconds), ['a11y', 'pdf', 'text']);
}

// ── T3 ──────────────────────────────────────────────────────────────────────
section('T3 — dos pestañas de la misma obra a la vez → sin duplicación');
{
    const r = run([...session({ mode: 'pdf' }), ...session({ mode: 'text' })]);
    eq('1 episodio', r.episodes.length, 1);
    eq('600 s, no 1200', r.episodes[0].activeSeconds, 600);
    ok('marca de concurrencia no se activa con 2 pestañas', !r.episodes[0].flags.includes('anomaly_concurrency'));
}

// ── T4 ──────────────────────────────────────────────────────────────────────
section('T4 — dos obras simultáneas → cada franja a una sola obra');
{
    const r = run([
        ...session({ content: 'W1', mode: 'pdf', signals: everyN(0, 600, 10) }),
        ...session({ content: 'W2', mode: 'text', signals: everyN(5, 600, 10) }),
    ]);
    const total = active(r, 'W1') + active(r, 'W2');
    ok('suma de ambas obras ≤ 600 s de reloj', total <= 600, `total=${total}`);
    eq('las 40 franjas se reparten sin perder ni duplicar', total, 600);
    ok('ambas obras reciben tiempo', active(r, 'W1') > 0 && active(r, 'W2') > 0);
    const tie = run([...session({ content: 'W1', mode: 'pdf' }), ...session({ content: 'W2', mode: 'text' })]);
    eq('empate exacto → ninguna obra acredita', tie.episodes.length, 0);
    eq('franjas descartadas por empate auditadas', tie.audit.crossWorkDroppedSlots, 80);
}

// ── T5 ──────────────────────────────────────────────────────────────────────
section('T5 — reanudación a 30:00 (misma) y a 30:15 (nueva; granularidad = franja de 15 s)');
{
    const a = session({ mode: 'pdf', from: 0, to: 120 });
    const same = run([...a, ...session({ mode: 'epub', from: 120 + 1800, to: 120 + 1800 + 120 })]);
    eq('hueco de 30:00 → 1 episodio', same.episodes.length, 1);
    eq('Q = 1', work(same, 'W1').Q, 1);
    eq('tiempo = 120 + 120', same.episodes[0].activeSeconds, 240);
    const next = run([...a, ...session({ mode: 'epub', from: 120 + 1815, to: 120 + 1815 + 120 })]);
    eq('hueco de 30:15 → 2 episodios', next.episodes.length, 2);
    eq('Q = 2', work(next, 'W1').Q, 2);
}

// ── T6 ──────────────────────────────────────────────────────────────────────
section('T6 — tope de 3 episodios cualificados por usuario, obra y día (America/Bogota)');
{
    const rows = [0, 2400, 4800, 7200].flatMap((f) => session({ mode: 'album', from: f, to: f + 60 }));
    const r = run(rows);
    eq('4 episodios construidos', r.episodes.length, 4);
    eq('3 cualificados', r.episodes.filter((e) => e.qualified).length, 3);
    eq('el 4.º excluido por daily_cap', r.episodes[3].reasons, ['daily_cap']);
    eq('Q = 3', work(r, 'W1').Q, 3);
    const MID = 14 * 3600; // 05:00 UTC del 4-nov = 00:00 Bogotá
    const d = run([MID - 7500, MID - 5000, MID - 2500, MID + 60].flatMap((f) => session({ mode: 'pdf', from: f, to: f + 60 })));
    eq('días contractuales', d.episodes.map((e) => e.day), ['2026-11-03', '2026-11-03', '2026-11-03', '2026-11-04']);
    eq('el día siguiente tiene su propio tope → Q = 4', work(d, 'W1').Q, 4);
    const cross = run(session({ mode: 'pdf', from: MID - 30, to: MID + 60 }));
    eq('episodio que cruza medianoche pertenece al día de inicio', cross.episodes[0].day, '2026-11-03');
}

// ── T7 ──────────────────────────────────────────────────────────────────────
section('T7 — pausas: ≤ 120 s cuentan; > 120 s se excluyen completas');
{
    const withGap = (g) => run(session({ mode: 'pdf', from: 0, to: 300, signals: [...everyN(0, 60, 10), ...everyN(60 + g, 300, 10)] }));
    eq('pausa de 119 s → 300 s', withGap(119).episodes[0].activeSeconds, 300);
    eq('pausa de 120 s → 300 s', withGap(120).episodes[0].activeSeconds, 300);
    eq('pausa de 121 s → [0,60] + [195,300] = 165 s', withGap(121).episodes[0].activeSeconds, 165);
    const hidden = run(session({ mode: 'pdf', visible: (t) => t <= 300 }));
    eq('pestaña oculta sin audio no acredita', hidden.episodes[0].activeSeconds, 300);
}

// ── T8′ ─────────────────────────────────────────────────────────────────────
section('T8′ — escucha acreditable');
{
    eq('pantalla oculta + gesto → 600 s', run(listening({ mode: 'immersive' })).episodes[0]?.activeSeconds, 600);
    eq('reproducción automática sin gesto → 0', run(listening({ mode: 'immersive', audioOver: { gesture: false } })).episodes.length, 0);
    eq('reproductor silenciado → 0', run(listening({ mode: 'immersive', audioOver: { muted: true } })).episodes.length, 0);
    eq('reproducción detenida (sin avance del medio) → 0', run(listening({ mode: 'immersive', audioOver: { mediaAdvancedMs: 0 } })).episodes.length, 0);
    eq('2× acredita reloj, no el doble', run(listening({ mode: 'immersive', audioOver: { rate: 2, mediaAdvancedMs: 30_000 } })).episodes[0].activeSeconds, 600);
    eq('0,5× acredita el reloj real', run(listening({ mode: 'immersive', audioOver: { rate: 0.5, mediaAdvancedMs: 7_500 } })).episodes[0].activeSeconds, 600);
    const cap = run(listening({ mode: 'immersive', to: 3600, signals: [0, 2400] }));
    eq('tope de presencia: 0–20 min + 40–60 min = 2400 s', cap.episodes[0].activeSeconds, 2400);
    eq('la escucha sigue siendo 1 episodio (la acreditación pausa, no la reproducción)', cap.episodes.length, 1);
    const loop = run(listening({ mode: 'album', to: 7200, signals: [0] }));
    eq('bucle desatendido 2 h → acotado a 20 min', loop.episodes[0].activeSeconds, 1200);
    const prolonged = run(listening({ mode: 'immersive', to: 5400, signals: everyN(0, 5400, 900) }));
    eq('escucha prolongada legítima (señal cada 15 min) → 90 min completos', prolonged.episodes[0].activeSeconds, 5400);
    const paused = run(session({
        mode: 'immersive', to: 600, visible: false, signals: [0, 300],
        audio: (t) => (t > 195 && t <= 300 ? { playing: false } : play()()),
    }));
    eq('pausa de reproducción de 105 s con reanudación → cuenta', paused.episodes[0].activeSeconds, 600);
    const longPause = run(session({
        mode: 'immersive', to: 600, visible: false, signals: [0, 405],
        audio: (t) => (t > 195 && t <= 405 ? { playing: false } : play()()),
    }));
    eq('pausa de reproducción de 210 s → se excluye completa (195 + 195)', longPause.episodes.reduce((s, e) => s + e.activeSeconds, 0), 390);
    const lateSignal = run(listening({ mode: 'immersive', to: 1800, signals: [0, 1500] }));
    eq('una señal nunca acredita hacia atrás (0–1200 + 1500–1800)', lateSignal.episodes[0].activeSeconds, 1500);
}

// ── T9′ ─────────────────────────────────────────────────────────────────────
section('T9′ — equivalencia económica entre los seis modos');
{
    const visual = MODES.map((m) => run(session({ user: `U-${m}`, mode: m })));
    eq('vía visual: mismos segundos en los 6 modos', visual.map((r) => r.episodes[0].activeSeconds), MODES.map(() => 600));
    eq('vía visual: misma Q', visual.map((r) => work(r, 'W1').Q), MODES.map(() => 1));
    eq('vía visual: misma R', visual.map((r) => work(r, 'W1').R), MODES.map(() => 1));
    const aural = AUDIO_MODES.map((m) => run(listening({ user: `L-${m}`, mode: m })));
    eq('vía escucha: mismos segundos en los modos con audio', aural.map((r) => r.episodes[0].activeSeconds), AUDIO_MODES.map(() => 600));
    ok('lectura y escucha equivalentes difieren ≤ 1 franja', Math.abs(visual[0].episodes[0].activeSeconds - aural[0].episodes[0].activeSeconds) <= 15);
    const all = run(MODES.flatMap((m) => session({ user: 'U-all', mode: m, from: 0, to: 600 })));
    eq('los 6 modos abiertos a la vez → 600 s, Q = 1', [all.episodes[0].activeSeconds, work(all, 'W1').Q], [600, 1]);
}

// ── T10′ ────────────────────────────────────────────────────────────────────
section('T10′ — accesibilidad sin penalización');
{
    const base = run(session({ mode: 'a11y' }));
    const focus = run(session({ mode: 'a11y', kind: 'focusin' }));
    eq('señales de foco/lector de pantalla = señales de puntero', focus, base);
    const sparse = run(session({ mode: 'a11y', signals: everyN(0, 600, 100) }));
    eq('señales espaciadas (≤ 120 s) no penalizan', sparse.episodes[0].activeSeconds, 600);
    const tts = run(listening({ mode: 'a11y', kind: 'selectionchange' }));
    eq('TTS accesible con pantalla oculta = escucha estándar', tts.episodes[0].activeSeconds, run(listening({ mode: 'immersive' })).episodes[0].activeSeconds);
}

// ── T11 ─────────────────────────────────────────────────────────────────────
section('T11 — procedencia del acceso');
{
    const cls = (c) => ({ ruleId: 'r', commercialClass: c });
    eq('paid_b2c → cualificado', run(session({ access: cls('paid_b2c') })).episodes[0].qualified, true);
    eq('paid_institutional → cualificado', run(session({ access: cls('paid_institutional') })).episodes[0].qualified, true);
    eq('courtesy → access_not_paid', run(session({ access: cls('courtesy') })).episodes[0].reasons, ['access_not_paid']);
    eq('unclassified → access_not_paid', run(session({ access: cls('unclassified') })).episodes[0].reasons, ['access_not_paid']);
    eq('sin session_start → access_unattributed', run(session({ start: false })).episodes[0].reasons, ['access_unattributed']);
    eq('atribución null → access_unattributed', run(session({ access: null })).episodes[0].reasons, ['access_unattributed']);
    eq('promo sin fondo autorizado → no pagado', run(session({ access: cls('promo_authorized') })).episodes[0].qualified, false);
    eq('promo con fondo autorizado → cualificado', run(session({ access: cls('promo_authorized') }), { promoFundAuthorized: true }).episodes[0].qualified, true);
    const mixed = run([...session({ mode: 'pdf', access: cls('courtesy') }), ...session({ mode: 'text', access: cls('paid_b2c') })]);
    eq('mixto (pagado + cortesía al inicio) → cualificado (P8)', [mixed.episodes[0].qualified, mixed.episodes[0].accessClasses], [true, ['courtesy', 'paid_b2c']]);
    eq('lectura gratuita: Q = 0', work(run(session({ access: cls('pilot') })), 'W1').Q, 0);
}

// ── T12 ─────────────────────────────────────────────────────────────────────
section('T12 — QA, tráfico sintético, legacy y modos fuera de alcance');
{
    const qa = run(session({ user: 'U-qa' }), { excludedUsers: { 'U-qa': 'qa' } });
    eq('usuario excluido → motivo auditable', qa.episodes[0].reasons, ['user_excluded:qa']);
    eq('usuario excluido → Q = 0', work(qa, 'W1').Q, 0);
    eq('mediador sin exclusión explícita cuenta (P7: no se excluye por rol)', run(session({ user: 'M-1' })).episodes[0].qualified, true);
    const legacy = run(session({ sid: 'legacy-01H0000000' }));
    ok('sesión legacy descartada', legacy.episodes.length === 0 && legacy.audit.invalidByReason.legacy_session > 0);
    const lu = run(session({ mode: 'lu' }));
    ok('modo LU fuera de alcance (P10)', lu.episodes.length === 0 && lu.audit.invalidByReason.mode_not_included > 0);
    eq('obra sin derechos vigentes → work_not_eligible', run(session({ content: 'W9' })).episodes[0].reasons, ['work_not_eligible']);
    eq('menos de 45 s → below_min_active', run(session({ to: 30 })).episodes[0].reasons, ['below_min_active']);
}

// ── T13 ─────────────────────────────────────────────────────────────────────
section('T13 — eventos duplicados o reenviados');
{
    const rows = session({ mode: 'immersive' });
    const base = run(rows);
    const dup = run([...rows, ...rows]);
    eq('mismo event_id repetido → mismos episodios', dup.episodes, base.episodes);
    eq('duplicados auditados', dup.audit.invalidByReason.duplicate_event_id, rows.length);
    const resent = rows.map((r) => ({ ...r, event_id: `${r.event_id}-retry` }));
    const replay = run([...rows, ...resent.filter((r) => r.event === 'econ_tick')]);
    eq('reenvío con ids nuevos → tiempo idéntico (unión)', replay.episodes.map((e) => e.activeSeconds), base.episodes.map((e) => e.activeSeconds));
}

// ── T14 ─────────────────────────────────────────────────────────────────────
section('T14 — desfase de reloj');
{
    const ahead = session().map((r) => ({ ...r, client_ts: r.client_ts + 600_000, server_ts: r.server_ts }));
    const a = run(ahead);
    ok('cliente adelantado 10 min → rechazado', a.episodes.length === 0 && a.audit.invalidByReason.clock_out_of_bounds === ahead.length);
    const late = session().map((r) => ({ ...r, server_ts: r.client_ts + 300_000 }));
    ok('ingesta retrasada 5 min > tolerancia → rechazado', run(late).episodes.length === 0);
}

// ── T15′ ────────────────────────────────────────────────────────────────────
section('T15′ — R por minutos activos ÷ minutos esperados; nunca por progreso');
{
    const noExp = run(session({ content: 'W3' }));
    eq('sin minutos esperados → R = null, bloqueada', [work(noExp, 'W3').R, work(noExp, 'W3').blockedReason], [null, 'expected_minutes_missing']);
    eq('sin minutos esperados → Q no cambia', work(noExp, 'W3').Q, 1);
    const three = run([[0, 150], [2400, 300], [4800, 1200]].flatMap(([f, d]) => session({ from: f, to: f + d })));
    eq('r = 0,25 / 0,5 / min(1, 2) → R = mediana = 0,5', work(three, 'W1').R, 0.5);
    const progress = session().map((r) => ({ ...r, progress_fraction: 0.99, payload_json: r.payload_json.replace('{', '{"progress":0.99,"page":250,') }));
    eq('el progreso no altera R ni Q', [work(run(progress), 'W1').R, work(run(progress), 'W1').Q], [1, 1]);
}

// ── T16 ─────────────────────────────────────────────────────────────────────
section('T16 — las métricas de producto no cambian con econ_tick');
{
    const nameOf = (e) => normalizeEventForSignals(e.event);
    const product = [
        { event_id: 'p1', event: 'pdf.session_start', user_id: 'U1', content_id: 'W1', session_id: 'S', server_ts: at(0), client_ts: at(0), elapsed_ms: 0, payload_json: '{}' },
        { event_id: 'p2', event: 'pdf.session_heartbeat', user_id: 'U1', content_id: 'W1', session_id: 'S', server_ts: at(60), client_ts: at(60), elapsed_ms: 60_000, payload_json: '{}' },
        { event_id: 'p3', event: 'pdf.session_end', user_id: 'U1', content_id: 'W1', session_id: 'S', server_ts: at(120), client_ts: at(120), elapsed_ms: 120_000, payload_json: '{}' },
    ];
    const before = computeEffectiveReadingMs(product, nameOf).ms;
    const after = computeEffectiveReadingMs([...product, ...session({ sid: 'S' }).filter((r) => r.event === 'econ_tick')], nameOf).ms;
    eq('tiempo efectivo de producto idéntico', after, before);
}

// ── T17 ─────────────────────────────────────────────────────────────────────
section('T17 — determinismo y ausencia de efectos secundarios');
{
    const rows = [
        ...session({ mode: 'pdf', from: 0, to: 300 }), ...session({ mode: 'immersive', from: 300, to: 900, visible: false, signals: [300], audio: play() }),
        ...session({ user: 'U2', content: 'W2', mode: 'album' }), ...session({ user: 'U2', content: 'W1', mode: 'epub', from: 5000, to: 5200 }),
    ];
    const deepFreeze = (o) => { Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v)); return Object.freeze(o); };
    const snapshot = JSON.stringify(rows);
    const frozenRows = deepFreeze(rows.map((r) => ({ ...r })));
    const ctx = deepFreeze({ ...BASE_CTX, eligibleContentIds: [...BASE_CTX.eligibleContentIds], expectedMinutesByContent: { ...BASE_CTX.expectedMinutesByContent } });
    const a = computeEconomicEpisodes(frozenRows, ctx);
    const b = computeEconomicEpisodes(frozenRows, ctx);
    let x = 7; const rnd = () => (x = (x * 48271) % 2147483647) / 2147483647;
    const shuffled = [...frozenRows].map((r) => [rnd(), r]).sort((p, q) => p[0] - q[0]).map(([, r]) => r);
    const c = computeEconomicEpisodes(shuffled, ctx);
    eq('recálculo idéntico', JSON.stringify(b), JSON.stringify(a));
    eq('orden de entrada irrelevante', JSON.stringify(c), JSON.stringify(a));
    eq('entradas intactas', JSON.stringify(rows), snapshot);
    ok('salida por obra sin identificadores de lectores', !JSON.stringify(a.works).includes('U1') && !JSON.stringify(a.works).includes('U2'));
}

// ── T18 ─────────────────────────────────────────────────────────────────────
section('T18 — escucha de una obra y lectura visual de otra a la vez');
{
    const r = run([...listening({ content: 'W1', mode: 'immersive' }), ...session({ content: 'W2', mode: 'pdf', signals: everyN(5, 600, 10) })]);
    const total = active(r, 'W1') + active(r, 'W2');
    ok('nunca más franjas que el reloj', total <= 600, `total=${total}`);
    ok('la obra con interacción humana más reciente gana', active(r, 'W2') >= active(r, 'W1'));
}

// ── T19 ─────────────────────────────────────────────────────────────────────
section('T19 — dos dispositivos, misma obra (audio + visual) → unión');
{
    const r = run([...listening({ mode: 'immersive', from: 0, to: 600 }), ...session({ mode: 'epub', from: 300, to: 900 })]);
    eq('1 episodio', r.episodes.length, 1);
    eq('900 s (unión de [0,600] y [300,900])', r.episodes[0].activeSeconds, 900);
    const four = run(MODES.slice(0, 4).map((m) => session({ mode: m })).flat());
    eq('4 sesiones simultáneas → marcada, no excluida (P12)', [four.episodes[0].flags, four.episodes[0].qualified], [['anomaly_concurrency'], true]);
    const many = run(['W1', 'W2', 'W3'].flatMap((w, i) => [0, 2400, 4800].map((f) => session({ content: w, from: f + i * 600, to: f + i * 600 + 60 }))).flat());
    ok('> 6 episodios por día → marcados, siguen cualificados', many.episodes.every((e) => e.flags.includes('anomaly_episodes_per_day')) && many.episodes.filter((e) => e.qualified).length === 9);
}

// ── Contrato del contexto ───────────────────────────────────────────────────
section('Contrato — parámetros no aprobados y tolerancias obligatorias');
{
    assert.throws(() => run([], { ruleSet: { ...RULE_SET_RS_2026_01_V1, equivalentProgress: 'on' } }), /P4/);
    ok('equivalentProgress ≠ off rechazado (P4)', true);
    assert.throws(() => computeEconomicEpisodes([], { ...BASE_CTX, clockSkewToleranceMs: undefined }), /clockSkewToleranceMs/);
    ok('tolerancias de reloj sin valor por defecto', true);
    eq('rule_set congelado = rs-2026-01-v1', [RULE_SET_RS_2026_01_V1.id, Object.isFrozen(RULE_SET_RS_2026_01_V1)], ['rs-2026-01-v1', true]);
}

console.log(`\n${pass} ok, ${fail} fallos`);
if (fail) process.exit(1);
