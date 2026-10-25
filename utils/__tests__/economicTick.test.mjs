/**
 * economicTick.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F3-A3.
 *
 * Cadena completa sin navegador: núcleo del cliente (utils/economicTick.mjs)
 * → validador REAL del servidor (normalizeEconTick, F3-A2) → motor REAL
 * (computeEconomicEpisodes, F3-A1). Comprueba G3 (cambiar de modo no duplica),
 * G4 (los 6 modos miden igual; la escucha accesible no queda en desventaja) y
 * G5 (sin acceso pagado o sin derechos no hay episodio cualificado), y que los
 * 6 visores montan la instrumentación de forma inerte con la ingesta apagada.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ECON_TICK_MODES, ECON_TICK_PARAMS, createEconomicTickCore, createTickBuffer,
    econIngestEnabled, isEpubReaderRelocate, serverClockOffset, windowScrollObservation, EPUB_SCROLL_RELOCATE_REASON,
} from '../economicTick.mjs';
import { normalizeEconTick, engineClockContext } from '../../server/royalties/econEvents.mjs';
import { computeEconomicEpisodes, RULE_SET_RS_2026_01_V1 } from '../../server/royalties/economicEpisodes.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const T0 = Date.UTC(2026, 9, 20, 15, 0, 0); // 10:00 en Bogotá
const MIN = 60_000;
let seq = 0;
const nextId = () => `01J${String(++seq).padStart(23, '0')}`;

/**
 * Simula una sesión segundo a segundo. `signals(t)`: hay señal humana en t;
 * `visible(t)`; `media(t)`: muestras de narración; `tickEvery(t)`: periodo
 * real del temporizador (los navegadores lo espacian en segundo plano).
 */
function simulate({ mode, contentId = 'c1', sessionId, from, to, signals = () => false, visible = () => true, media = null, tickEvery = () => 15_000, scroll = null, accepted = null }) {
    const core = createEconomicTickCore({ mode, contentId, sessionId, startedAt: from, visible: visible(from) });
    if (scroll) core.scrollObserved(from, { position: 0, auto: true }); // posición de partida (como el hook)
    const out = [];
    let nextTick = from + tickEvery(from);
    let vis = visible(from);
    for (let t = from + 1000; t <= to; t += 1000) {
        const v = visible(t);
        if (v !== vis) { core.setVisible(v, t); vis = v; }
        if (signals(t)) core.humanSignal(t);
        if (media) core.sampleMedia(t, media(t));
        const so = scroll ? scroll(t) : null;
        if (so && core.scrollObserved(t, so) && accepted) accepted.push(t);
        if (t >= nextTick) { const e = core.tick(t, nextId()); if (e) out.push(e); nextTick = t + tickEvery(t); }
    }
    const last = core.tick(to + 500, nextId()); // tick final parcial
    if (last) out.push(last);
    return out;
}

/** Lo que hace el servidor: valida cada tick y registra la atribución con el primero. */
function serverRows(events, { userId = 'U1', commercialClass = 'paid_b2c' } = {}) {
    const rows = [];
    const rejected = [];
    const started = new Set();
    for (const e of events) {
        const now = e.clientTs + 1_000;
        const n = normalizeEconTick(e, { userId, now });
        if (!n.ok) { rejected.push(n.code); continue; }
        const k = n.tick.sessionId;
        if (!started.has(k)) {
            started.add(k);
            rows.push({ event_id: `start-${k}`, event: 'econ.session_start', mode: n.tick.mode, user_id: userId, content_id: n.tick.contentId,
                session_id: k, client_ts: n.tick.clientTs - n.tick.payload.windowMs, server_ts: now,
                payload_json: JSON.stringify({ econAccess: { ruleId: 'r1', commercialClass } }) });
        }
        rows.push({ event_id: n.tick.eventId, event: 'econ_tick', mode: n.tick.mode, user_id: userId, content_id: n.tick.contentId,
            session_id: k, client_ts: n.tick.clientTs, server_ts: now, payload_json: JSON.stringify(n.tick.payload) });
    }
    return { rows, rejected };
}

const engine = (rows, extra = {}) => computeEconomicEpisodes(rows, {
    ruleSet: RULE_SET_RS_2026_01_V1, eligibleContentIds: ['c1', 'c2'], expectedMinutesByContent: { c1: 10, c2: 10 },
    ...engineClockContext(), ...extra,
});
const every = (ms, offset = 0) => (t) => (t - T0 - offset) % ms === 0;
const reading = (mode, from, to, sessionId = `S-${mode}`, extra = {}) => simulate({ mode, sessionId, from, to, signals: every(20_000, 3_000), ...extra });

console.log('\n[1] lectura visual continua (PDF, 5 min, una señal cada 20 s)');
{
    const ev = reading('pdf', T0, T0 + 5 * MIN);
    const { rows, rejected } = serverRows(ev);
    ok('todos los ticks pasan el validador del servidor', rejected.length === 0, rejected.join(','));
    ok('cadencia de 15 s (≈ 20 ticks)', ev.length >= 19 && ev.length <= 21, String(ev.length));
    ok('ventanas ≤ 2 min, visibles y con señal', ev.every((e) => e.payload.windowMs <= 120_000 && e.payload.visible === true && e.payload.humanSignalAgoMs !== null));
    const r = engine(rows);
    ok('un episodio cualificado', r.episodes.length === 1 && r.episodes[0].qualified, JSON.stringify(r.episodes));
    const a = r.episodes[0].activeSeconds;
    ok('tiempo acreditado ≤ real y conservador (≥ 4,5 min)', a <= 300 && a >= 270, String(a));
}

console.log('\n[2] G3 — cambiar de modo a mitad de lectura da 1 episodio');
{
    const ev = [...reading('pdf', T0, T0 + 3 * MIN), ...reading('text', T0 + 3 * MIN + 5_000, T0 + 6 * MIN)];
    const r = engine(serverRows(ev).rows);
    ok('1 episodio con los dos modos', r.episodes.length === 1 && Object.keys(r.episodes[0].modeSeconds).sort().join() === 'pdf,text', JSON.stringify(r.episodes));
    ok('Q = 1 (no una lectura por modo)', r.works[0].Q === 1);
    ok('minutos no duplicados (≤ 6 min reales)', r.episodes[0].activeSeconds <= 360);
    const six = ECON_TICK_MODES.flatMap((m, i) => reading(m, T0 + i * MIN, T0 + (i + 1) * MIN - 2_000, `S6-${m}`));
    const r6 = engine(serverRows(six).rows);
    ok('recorrer los 6 modos seguidos = 1 episodio', r6.episodes.length === 1 && Object.keys(r6.episodes[0].modeSeconds).length === 6, JSON.stringify(r6.episodes.map((e) => e.modeSeconds)));
}

console.log('\n[3] G3 — dos pestañas a la vez sobre la misma obra se unen, no se suman');
{
    const ev = [...reading('pdf', T0, T0 + 4 * MIN, 'TAB-A'), ...reading('immersive', T0, T0 + 4 * MIN, 'TAB-B')];
    const r = engine(serverRows(ev).rows);
    ok('1 episodio y ≤ 4 min', r.episodes.length === 1 && r.episodes[0].activeSeconds <= 240, JSON.stringify(r.episodes));
}

console.log('\n[4] G4 — el mismo perfil de lectura mide igual en los 6 modos');
{
    const secs = ECON_TICK_MODES.map((m) => engine(serverRows(reading(m, T0, T0 + 4 * MIN, `EQ-${m}`)).rows).episodes[0]?.activeSeconds ?? -1);
    ok('activeSeconds idéntico en pdf, text, immersive, a11y, album y epub', new Set(secs).size === 1 && secs[0] > 0, secs.join(','));
}

console.log('\n[5] inactividad y pausas');
{
    const idle = simulate({ mode: 'pdf', sessionId: 'IDLE', from: T0, to: T0 + 5 * MIN });
    ok('sin señales ni audio no se emite nada', idle.length === 0, String(idle.length));
    const gap = simulate({ mode: 'text', sessionId: 'GAP', from: T0, to: T0 + 6 * MIN,
        signals: (t) => (t - T0 <= 60_000 || t - T0 >= 260_000) && every(10_000)(t) });
    const r = engine(serverRows(gap).rows);
    const a = r.episodes.reduce((s, e) => s + e.activeSeconds, 0);
    ok('una pausa de 200 s no se acredita', a <= 60 + 100 + 30, String(a));
    const hidden = simulate({ mode: 'pdf', sessionId: 'HID', from: T0, to: T0 + 3 * MIN, signals: every(10_000), visible: (t) => t - T0 < 60_000 });
    const rh = engine(serverRows(hidden).rows);
    ok('con la pestaña oculta no hay vía visual', (rh.episodes[0]?.activeSeconds ?? 0) <= 60, JSON.stringify(rh.episodes));
}

// Narración: un elemento que avanza `rate` s por segundo mientras `playing(t)`.
const narration = ({ from, playing = () => true, rate = 1, muted = false, key = 'A', seekAt = null }) => {
    let pos = 0;
    return (t) => {
        const p = playing(t);
        if (p) pos += 1000 * rate;
        if (seekAt !== null && t === seekAt) pos += 60_000;
        return [{ key, src: 'narr.mp3', posMs: pos, paused: !p, ended: false, muted, volume: 1, rate }];
    };
};

console.log('\n[6] vía de escucha (inmersivo, pestaña oculta)');
{
    const listen = (o, extraSignals = (t) => t === T0 + 2_000) => simulate({ mode: 'immersive', sessionId: `L-${++seq}`, from: T0, to: T0 + 5 * MIN,
        signals: extraSignals, visible: () => false, tickEvery: () => 60_000, media: narration({ from: T0, playing: (t) => t >= T0 + 4_000, ...o }) });
    const base = listen({});
    const { rows, rejected } = serverRows(base);
    ok('ticks de escucha válidos aun espaciados a 60 s en segundo plano', rejected.length === 0, rejected.join(','));
    ok('gesto detectado (la reproducción siguió a una señal)', base.every((e) => e.payload.audio?.gesture === true));
    const a = engine(rows).episodes[0]?.activeSeconds ?? 0;
    ok('escucha acreditada sin visibilidad (≈ 5 min)', a >= 270 && a <= 300, String(a));
    const noGesture = listen({}, () => false);
    ok('sin gesto humano no se acredita', (engine(serverRows(noGesture).rows).episodes[0]?.activeSeconds ?? 0) === 0);
    const muted = listen({ muted: true });
    ok('silenciado no se acredita', (engine(serverRows(muted).rows).episodes[0]?.activeSeconds ?? 0) === 0);
    const fast = listen({ rate: 2 });
    const af = engine(serverRows(fast).rows).episodes[0]?.activeSeconds ?? 0;
    ok('a velocidad 2× se acredita el tiempo de reloj, no el del medio', af >= 270 && af <= 300, String(af));
    const seek = listen({ seekAt: T0 + 100_000 });
    ok('un salto (seek) no suma avance', serverRows(seek).rejected.length === 0 && seek.every((e) => (e.payload.audio?.mediaAdvancedMs ?? 0) <= e.payload.windowMs + 1000));
    // Relevo A/B del inmersivo: dos elementos que se alternan cada 5 s.
    const ab = simulate({ mode: 'immersive', sessionId: 'AB', from: T0, to: T0 + 3 * MIN, signals: (t) => t === T0 + 1_000, visible: () => false,
        media: (() => { const pos = { A: 0, B: 0 }; return (t) => { const cur = Math.floor((t - T0) / 5_000) % 2 ? 'B' : 'A';
            pos[cur] += 1000; return ['A', 'B'].map((k) => ({ key: k, src: `${k}-${Math.floor((t - T0) / 10_000)}`, posMs: pos[k], paused: k !== cur, ended: false, muted: false, volume: 1, rate: 1 })); }; })() });
    const aab = engine(serverRows(ab).rows).episodes[0]?.activeSeconds ?? 0;
    ok('relevo A/B: escucha continua acreditada', aab >= 150, String(aab));
}

console.log('\n[7] tope de escucha sin presencia (P3: 20 min)');
{
    const ev = simulate({ mode: 'album', sessionId: 'CAP', from: T0, to: T0 + 30 * MIN, signals: (t) => t === T0 + 1_000,
        visible: () => false, tickEvery: () => 60_000, media: narration({ from: T0 }) });
    const r = engine(serverRows(ev).rows);
    const a = r.episodes.reduce((s, e) => s + e.activeSeconds, 0);
    ok('el cliente sigue declarando la reproducción', ev.length >= 29);
    ok('se acreditan ≤ 20 min', a <= 20 * 60 && a >= 19 * 60, String(a));
}

console.log('\n[8] G5 — procedencia y elegibilidad');
{
    const ev = reading('epub', T0, T0 + 3 * MIN);
    const q = (cls, extra) => engine(serverRows(ev, { commercialClass: cls }).rows, extra).episodes[0];
    ok('pagada → cualificado', q('paid_b2c').qualified === true);
    for (const cls of ['unclassified', 'pilot', 'courtesy', 'internal', 'template', 'promo_authorized']) {
        ok(`${cls} → no cualificado`, q(cls).qualified === false, JSON.stringify(q(cls).reasons));
    }
    ok('cuenta interna o de QA → no cualificado', q('paid_b2c', { excludedUsers: { U1: 'internal' } }).qualified === false);
    ok('obra sin derechos vigentes → no cualificado', q('paid_b2c', { eligibleContentIds: [] }).reasons.includes('work_not_eligible'));
    const r = engine(serverRows(ev, { commercialClass: 'unclassified' }).rows);
    ok('sin elegibilidad: Q = 0', r.works[0].Q === 0);
    const short = engine(serverRows(reading('pdf', T0, T0 + 30_000, 'SHORT')).rows).episodes[0];
    ok('< 45 s activos → no cualificado', short.qualified === false && short.reasons.includes('below_min_active'), JSON.stringify(short));
}

console.log('\n[9] idempotencia y recálculo');
{
    const ev = [...reading('pdf', T0, T0 + 3 * MIN), ...reading('a11y', T0 + 3 * MIN, T0 + 5 * MIN)];
    const { rows } = serverRows(ev);
    const once = JSON.stringify(engine(rows));
    ok('reenviar el mismo lote no cambia nada (dedup por eventId)', JSON.stringify(engine([...rows, ...rows])).replace(/"invalid[^]*$/, '') === once.replace(/"invalid[^]*$/, ''));
    ok('el orden de llegada no cambia el resultado', JSON.stringify(engine([...rows].reverse())) === once);
    ok('ids de evento únicos', new Set(ev.map((e) => e.eventId)).size === ev.length);
}

console.log('\n[10] buffer, reloj, flag y señales del EPUB');
{
    const b = createTickBuffer();
    for (let i = 0; i < 70; i++) b.push({ clientTs: T0 + i * 1000 });
    b.push({ clientTs: T0 - 20 * MIN });
    const first = b.drain(T0 + 70_000);
    ok('lote ≤ 50 y sin ticks que el servidor rechazaría por antigüedad', first.length === 50 && first.every((e) => e.clientTs >= T0) && b.size === 20);
    ok('offset de reloj del servidor', serverClockOffset(1000, 1200, 5100) === 4000 && serverClockOffset(1000, 900, 5) === 0 && serverClockOffset(1, 2, undefined) === 0);
    ok('flag: solo "on" explícito activa', econIngestEnabled({ economicIngest: 'on' }) && !econIngestEnabled({ economicIngest: 'off' }) && !econIngestEnabled({ mediaBaseUrl: '' }) && !econIngestEnabled(null));
    ok('EPUB: pasar página sí; re-maquetación y restauración al abrir no', isEpubReaderRelocate('page') && isEpubReaderRelocate('snap')
        && !isEpubReaderRelocate('navigation') && !isEpubReaderRelocate('anchor') && !isEpubReaderRelocate(null));
    ok('EPUB: el scroll continuo no es señal humana directa (pasa por la regla de desplazamiento)', !isEpubReaderRelocate('scroll') && EPUB_SCROLL_RELOCATE_REASON === 'scroll');
    let threw = false; try { createEconomicTickCore({ mode: 'lu', contentId: 'c', sessionId: 's', startedAt: 0, visible: true }); } catch { threw = true; }
    ok('modo fuera de V1 (LU) rechazado', threw);
    ok('parámetros alineados con el servidor y el rule_set', ECON_TICK_PARAMS.tickIntervalMs === RULE_SET_RS_2026_01_V1.slotSeconds * 1000
        && ECON_TICK_PARAMS.pauseMs === RULE_SET_RS_2026_01_V1.pauseExclusionSeconds * 1000
        && JSON.stringify(ECON_TICK_MODES) === JSON.stringify(RULE_SET_RS_2026_01_V1.includedModes));
}

console.log('\n[11] instrumentación de los 6 modos (estructural)');
{
    const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
    const SURFACES = [
        ['pages/VisorPDF.tsx', 'pdf', null],
        ['pages/VisorTexto.tsx', 'text', 'audioRef.current'],
        ['pages/VisorInmersivo.tsx', 'immersive', 'pb.audioRefA.current, pb.audioRefB.current'],
        ['pages/VisorAccesible.tsx', 'a11y', null],
        ['pages/VisorAlbum.tsx', 'album', 'audio.getNarrationMedia()'],
        ['components/epub-reader/EpubReaderApp.tsx', 'epub', null],
    ];
    for (const [f, mode, narr] of SURFACES) {
        const src = read(f);
        const calls = src.match(/useEconomicTick\(\{[\s\S]*?\}\);/g) || [];
        ok(`${f}: una llamada, modo '${mode}'`, calls.length === 1 && calls[0].includes(`mode:      '${mode}'`), String(calls.length));
        if (narr) ok(`${f}: narración observada (${narr})`, calls[0].includes(narr));
        else ok(`${f}: sin medio de narración`, !calls[0].includes('getNarrationMedia'));
    }
    const hook = read('hooks/useEconomicTick.ts');
    ok('hook: listeners y timers solo con la sesión activa (flag del servidor)', /const active = wanted && ingestOn && clockOffset !== null;/.test(hook)
        && /useEffect\(\(\) => \{\s*if \(!active \|\| !contentId\) return;[\s\S]*addEventListener/.test(hook));
    ok('hook: solo eventos de confianza; el scroll no es señal humana', hook.includes('if (e.isTrusted) signal()')
        && !/SIGNAL_EVENTS = \[[^\]]*'scroll'/.test(hook));
    ok('hook: envío propio, sin emitir eventos de sesión del backbone', !/['"`][\w.]*session_(heartbeat|start|end)['"`]/.test(hook.replace(/^\s*(\/\/|\*).*$/gm, '')) && !hook.includes('useBackboneReadingSession('));
    ok('álbum: la narración es la región, no el ambiente', /get narrationElement\(\): HTMLAudioElement \{ return this\._region; \}/.test(read('utils/NarrativeAudioEngine.ts')));
    const adapter = read('components/epub-reader/foliateAdapter.mjs');
    ok('EPUB: el adaptador reenvía solo interacción de confianza de los iframes', /if \(ev\.isTrusted && !stale\(\)\) for \(const cb of activityListeners\) cb\(\);/.test(adapter));
    ok('servidor: runtime-config expone el modo de ingesta', /economicIngest: econEvents\.econIngestMode\(\)/.test(read('server/server.js')));
}

console.log('\n[12] A11Y-FIX-01 — desplazamiento como señal de continuidad');
{
    const MINADV = 0.02;
    // Avance de la ventana cada `ms` a partir de `fromMs`: `step` de documento por salto.
    const scrolling = ({ ms = 40_000, fromMs = 10_000, step = 0.05, until = Infinity, extra = {} } = {}) => {
        let pos = 0;
        return (t) => {
            const dt = t - T0;
            if (dt < fromMs || dt > until || (dt - fromMs) % ms !== 0) return null;
            pos += step;
            return { position: pos, minAdvance: MINADV, ...extra };
        };
    };
    const click = (t) => t === T0 + 2_000;
    const a11y = (o) => simulate({ mode: 'a11y', sessionId: `SC-${++seq}`, from: T0, to: T0 + 10 * MIN, signals: click, ...o });
    const secs = (ev) => engine(serverRows(ev).rows).episodes.reduce((s, e) => s + e.activeSeconds, 0);

    const base = secs(a11y({}));
    ok('referencia: sin desplazamiento, la lectura continua se corta tras la pausa (≤ 120 s)', base <= 120, String(base));
    const real = secs(a11y({ scroll: scrolling() }));
    ok('desplazamiento real hacia adelante cada 40 s: se acreditan ≈ 10 min', real >= 570 && real <= 600, String(real));
    const still = secs(a11y({ scroll: (t) => ((t - T0) % 40_000 === 0 ? { position: 0, minAdvance: MINADV } : null) }));
    ok('sin avance de posición (oscilación o eventos sin movimiento): nada extra', still <= 120, String(still));
    const back = secs(a11y({ scroll: scrolling({ step: -0.05 }) }));
    ok('desplazamiento hacia atrás: nada extra', back <= 120, String(back));
    const tiny = secs(a11y({ scroll: scrolling({ step: MINADV / 4, ms: 40_000 }) }));
    ok('avance menor que ¼ de pantalla entre señales: no basta por sí solo', tiny <= 300, String(tiny));
    const auto = secs(a11y({ scroll: scrolling({ extra: { auto: true } }) }));
    ok('desplazamiento automático del visor (auto-avance): nada extra', auto <= 120, String(auto));

    // Ventana de exclusión tras un desplazamiento propio.
    const prog = (since, pending) => secs(a11y({ scroll: scrolling({ extra: { sinceProgrammaticMs: since, programmaticPending: pending } }) }));
    ok('desplazamiento propio hace 1 s: excluido', prog(1_000, false) <= 120, String(prog(1_000, false)));
    ok('desplazamiento propio hace 1,5 s exactos: excluido', prog(1_500, false) <= 120);
    ok('desplazamiento propio hace 2 s y terminado: cuenta', prog(2_000, false) >= 570);
    ok('desplazamiento propio hace 3 s todavía en curso (sin scrollend): excluido', prog(3_000, true) <= 120);
    ok('desplazamiento propio hace 6 s: cuenta aunque el navegador no emita scrollend', prog(6_000, true) >= 570);

    // Una señal por franja como mucho; el avance pendiente no se pierde.
    const acc = [];
    a11y({ scroll: scrolling({ ms: 1_000, step: 0.01 }), accepted: acc });
    const gaps = acc.slice(1).map((t, i) => t - acc[i]);
    ok('desplazamiento continuo: ≤ 1 señal cada 15 s', acc.length > 0 && gaps.every((g) => g >= 15_000), `${acc.length} señales, gaps ${gaps.slice(0, 3).join(',')}`);

    // Solo continuidad: nunca abre ni reanuda una lectura.
    const alone = a11y({ signals: () => false, scroll: scrolling() });
    ok('solo desplazamiento, sin interacción previa: ningún tick, ningún episodio', alone.length === 0 && engine(serverRows(alone).rows).episodes.length === 0, String(alone.length));
    const broken = secs(a11y({ scroll: scrolling({ fromMs: 160_000 }) }));
    ok('tras más de 120 s sin señal, el desplazamiento no reanuda la acreditación', broken <= 120, String(broken));
    const resumed = secs(a11y({ signals: (t) => t === T0 + 2_000 || t === T0 + 200_000, scroll: scrolling({ fromMs: 210_000 }) }));
    // El clic aislado de t=2 s no se acredita (el motor exige pares ≤ 120 s o ser la última señal): 200 s → 600 s.
    ok('con una interacción nueva, el desplazamiento vuelve a mantener la continuidad', resumed >= 380 && resumed <= 400, String(resumed));

    // Visibilidad.
    const hid = a11y({ visible: (t) => t - T0 < 60_000, scroll: scrolling() });
    ok('pestaña oculta: sin vía visual aunque haya desplazamiento', secs(hid) <= 60, String(secs(hid)));
    const coreV = createEconomicTickCore({ mode: 'a11y', contentId: 'c1', sessionId: 'V', startedAt: T0, visible: true });
    coreV.scrollObserved(T0, { position: 0, auto: true });
    coreV.humanSignal(T0 + 1_000);
    coreV.setVisible(false, T0 + 2_000);
    const hiddenAcc = coreV.scrollObserved(T0 + 3_000, { position: 0.5, minAdvance: MINADV });
    coreV.setVisible(true, T0 + 4_000);
    const afterAcc = coreV.scrollObserved(T0 + 20_000, { position: 0.51, minAdvance: MINADV });
    ok('el avance con la pestaña oculta se absorbe y no se acredita al volver', !hiddenAcc && !afterAcc);

    // Cambio de modo: la sesión nueva necesita su propia interacción.
    const s1 = simulate({ mode: 'a11y', sessionId: 'MC-1', from: T0, to: T0 + 4 * MIN, signals: click, scroll: scrolling() });
    const s2alone = simulate({ mode: 'text', sessionId: 'MC-2', from: T0 + 4 * MIN + 5_000, to: T0 + 8 * MIN, scroll: scrolling({ fromMs: 4 * MIN + 15_000 }) });
    ok('al cambiar de modo, el desplazamiento solo no continúa la sesión nueva', s2alone.length === 0, String(s2alone.length));
    const s2 = simulate({ mode: 'text', sessionId: 'MC-3', from: T0 + 4 * MIN + 5_000, to: T0 + 8 * MIN, signals: (t) => t === T0 + 4 * MIN + 6_000, scroll: scrolling({ fromMs: 4 * MIN + 15_000 }) });
    const rmc = engine(serverRows([...s1, ...s2]).rows);
    ok('con interacción al cambiar de modo: 1 episodio, Q = 1, minutos ≤ reales', rmc.episodes.length === 1 && rmc.works[0].Q === 1 && rmc.episodes[0].activeSeconds <= 8 * 60, JSON.stringify(rmc.episodes.map((e) => [e.activeSeconds, e.modeSeconds])));

    // Sin doble conteo: desplazamiento + clics no suman sobre los clics.
    const clicks = (t) => every(20_000, 3_000)(t);
    const onlyClicks = secs(simulate({ mode: 'a11y', sessionId: 'DC-1', from: T0, to: T0 + 5 * MIN, signals: clicks }));
    const both = secs(simulate({ mode: 'a11y', sessionId: 'DC-2', from: T0, to: T0 + 5 * MIN, signals: clicks, scroll: scrolling({ ms: 10_000 }) }));
    ok('desplazamiento y clics a la vez: se unen, no se suman (≤ tiempo real)', both <= 300 && both - onlyClicks <= 15, `${onlyClicks} vs ${both}`);
    const twoTabs = engine(serverRows([...a11y({ scroll: scrolling() }), ...simulate({ mode: 'text', sessionId: 'TAB2', from: T0, to: T0 + 10 * MIN, signals: click, scroll: scrolling() })]).rows);
    ok('dos visores a la vez con desplazamiento: 1 episodio, ≤ 10 min', twoTabs.episodes.length === 1 && twoTabs.episodes[0].activeSeconds <= 600);

    // Posición por fracción: estable ante re-maquetación.
    const o1 = windowScrollObservation({ scrollY: 1000, scrollHeight: 10_000, innerHeight: 800 });
    const o2 = windowScrollObservation({ scrollY: 2000, scrollHeight: 20_000, innerHeight: 800 });
    ok('re-maquetación (letra al doble): la posición no avanza', o1.position === o2.position);
    ok('avance mínimo = ¼ de pantalla', Math.abs(o1.minAdvance - 200 / 10_000) < 1e-12 && windowScrollObservation({ scrollY: 0, scrollHeight: 0, innerHeight: 0 }).position === 0);
    ok('todos los ticks con desplazamiento pasan el validador', serverRows(a11y({ scroll: scrolling() })).rejected.length === 0);
}

console.log('\n[13] A11Y-FIX-01 — integración por visor (estructural)');
{
    const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
    const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    const hook = read('hooks/useEconomicTick.ts');
    ok('hook: el listener de scroll solo existe con la sesión activa y si el visor lo pide', /if \(!active \|\| !contentId\) return;[\s\S]*if \(withScroll\) \{[\s\S]*addEventListener\('scroll', onScroll/.test(hook));
    ok('hook: scroll de la ventana sin captura (no los paneles internos)', /addEventListener\('scroll', onScroll, \{ passive: true \}\)/.test(hook));
    ok('hook: la posición de partida se absorbe como automática', /observeWindow\(true\); \/\/ posición de partida/.test(hook));
    ok('hook: ante un error del visor, el desplazamiento se trata como automático', /let auto = true;\s*try \{ auto = !!scrollRef\.current\?\.isAutoScrolling\(\); \}/.test(hook));
    const marker = hook.match(/export function markProgrammaticScroll\(\): void \{([\s\S]*?)\n\}/)?.[1] ?? '';
    ok('markProgrammaticScroll: solo anota la hora (sin listeners, timers ni red)', marker.includes('Date.now()') && !/addEventListener|setTimeout|setInterval|fetch/.test(marker));

    const call = (f) => (read(f).match(/useEconomicTick\(\{[\s\S]*?\}\);/g) || [])[0] || '';
    ok('Accesible: desplazamiento activado salvo con el auto-avance activo', call('pages/VisorAccesible.tsx').includes('scrollSignal: { isAutoScrolling: () => autoAdvanceActiveRef.current }')
        && read('pages/VisorAccesible.tsx').includes("autoAdvanceActiveRef.current = autoAdvance.status === 'ACTIVE';"));
    ok('Guiado: desplazamiento activado (el TTS no desplaza)', call('pages/VisorTexto.tsx').includes('scrollSignal: { isAutoScrolling: () => false }'));
    for (const f of ['pages/VisorPDF.tsx', 'pages/VisorInmersivo.tsx', 'pages/VisorAlbum.tsx', 'components/epub-reader/EpubReaderApp.tsx']) {
        ok(`${f}: sin desplazamiento de ventana como señal`, !call(f).includes('scrollSignal'));
    }
    ok('Inmersivo y Álbum: la vía de escucha sigue intacta', call('pages/VisorInmersivo.tsx').includes('getNarrationMedia') && call('pages/VisorAlbum.tsx').includes('getNarrationMedia'));
    const epub = read('components/epub-reader/EpubReaderApp.tsx');
    ok('EPUB: el scroll continuo de foliate va a la regla de desplazamiento', /else if \(reason === EPUB_SCROLL_RELOCATE_REASON && typeof loc\.fraction === 'number'\) markScrollProgress\(loc\.fraction\);/.test(epub));

    // Todo desplazamiento propio de los visores con la señal activa va marcado.
    const SCROLLERS = ['hooks/useA11yReaderNavigation.ts', 'components/accesible/A11ySkipLinks.tsx', 'components/accesible/A11yTableOfContents.tsx',
        'components/accesible/A11yReadingSettings.tsx', 'components/accesible/A11ySidebar.tsx', 'pages/VisorAccesible.tsx', 'pages/VisorTexto.tsx'];
    for (const f of SCROLLERS) {
        const lines = strip(read(f)).split('\n');
        const isA11y = !f.endsWith('VisorTexto.tsx');
        const re = isA11y ? /\.(scrollTo|scrollBy|scrollIntoView)\(|\.focus\(/ : /\.(scrollTo|scrollBy|scrollIntoView)\(/;
        const unmarked = lines.map((l, i) => [l, i]).filter(([l]) => re.test(l) && !/preventScroll: true/.test(l))
            .filter(([l, i]) => !lines.slice(Math.max(0, i - 4), i + 1).join('\n').includes('markProgrammaticScroll()'))
            .map(([l, i]) => `${i + 1}: ${l.trim()}`);
        ok(`${f}: todos los desplazamientos${isA11y ? ' y focos' : ''} propios marcados`, unmarked.length === 0, unmarked.join(' | '));
    }
}

console.log('\n[14] ECON-FOCUS-05 — el foco no es señal; el foco por código es desplazamiento propio');
{
    const read = (f) => fs.readFileSync(path.join(REPO, f), 'utf8');
    const hook = read('hooks/useEconomicTick.ts');
    const signals = (hook.match(/const SIGNAL_EVENTS = \[([^\]]*)\]/) || [])[1] || '';
    ok('hook: solo eventos de ENTRADA (sin focusin)', signals.includes("'keydown'") && signals.includes("'click'") && !/focus/.test(signals), signals);
    const adapterEvents = (read('components/epub-reader/foliateAdapter.mjs').match(/const ACTIVITY_EVENTS = \[([^\]]*)\]/) || [])[1] || '';
    ok('EPUB: los iframes reenvían solo entrada (sin focusin)', adapterEvents.includes("'keydown'") && !/focus/.test(adapterEvents), adapterEvents);
    ok('hook: la guarda de foco se instala con la sesión activa y se suelta al desmontar',
        /if \(!active \|\| !contentId\) return;[\s\S]*const releaseFocusGuard = focusGuard\.acquire\(focusPrototypes\(\)\);[\s\S]*return \(\) => \{[\s\S]*releaseFocusGuard\(\);/.test(hook));
    ok('hook: el foco por código marca desplazamiento propio', /const focusGuard = createFocusGuard\(markProgrammaticScroll\);/.test(hook));

    const { createFocusGuard } = await import('../economicTick.mjs');
    const calls = [];
    const proto = { focus(x) { calls.push(['orig', this.id, x]); return 'ret'; } };
    const svg = { focus() { calls.push(['svg', this.id]); } };
    const original = proto.focus;
    let marks = 0;
    const guard = createFocusGuard(() => { marks++; calls.push(['mark']); });
    const r1 = guard.acquire([proto, svg, null, {}]);
    const r2 = guard.acquire([proto, svg]);
    ok('guarda activa: focus() envuelto', proto.focus !== original && guard.active);
    const out = proto.focus.call({ id: 'leo' }, { preventScroll: false });
    ok('el aviso llega ANTES de enfocar y el foco original se ejecuta igual (this, argumentos, retorno)',
        JSON.stringify(calls.slice(0, 2)) === JSON.stringify([['mark'], ['orig', 'leo', { preventScroll: false }]]) && out === 'ret');
    svg.focus.call({ id: 's' });
    ok('también SVGElement', marks === 2 && calls.at(-1)[0] === 'svg');
    r1(); r1();
    ok('con dos usuarios, soltar uno (dos veces) no restaura', proto.focus !== original && guard.active);
    r2();
    ok('al soltar el último se restaura el original', proto.focus === original && !guard.active);
    const g2 = createFocusGuard(() => { throw new Error('x'); });
    const rel = g2.acquire([proto]);
    let threw = false; try { proto.focus.call({ id: 'z' }); } catch { threw = true; }
    ok('un fallo de la medición nunca rompe el foco', !threw);
    const theirs = function theirs() {};
    proto.focus = theirs; rel();
    ok('no pisa un envoltorio instalado después por otro código', proto.focus === theirs);
    proto.focus = original;

    // Núcleo: sin señales de entrada, un foco (que ya no llega como señal) no
    // produce ticks; y el desplazamiento que provoque un foco por código se
    // absorbe como propio (no prolonga una lectura en curso).
    const core = createEconomicTickCore({ mode: 'text', contentId: 'c1', sessionId: 'F', startedAt: T0, visible: true });
    core.scrollObserved(T0, { position: 0, auto: true });
    const idle = [];
    for (let t = T0 + 15_000; t <= T0 + 5 * MIN; t += 15_000) { const e = core.tick(t, nextId()); if (e) idle.push(e); }
    ok('sesión sin entrada (Leo se abre solo y enfoca): 0 ticks', idle.length === 0);
    const c2 = createEconomicTickCore({ mode: 'text', contentId: 'c1', sessionId: 'F2', startedAt: T0, visible: true });
    c2.scrollObserved(T0, { position: 0, auto: true });
    c2.humanSignal(T0 + 1_000);
    const scrolledByFocus = c2.scrollObserved(T0 + 60_000, { position: 0.4, minAdvance: 0.02, sinceProgrammaticMs: 5, programmaticPending: true });
    ok('el desplazamiento provocado por un foco por código no es señal', scrolledByFocus === false);
}

console.log(`\neconomicTick — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
