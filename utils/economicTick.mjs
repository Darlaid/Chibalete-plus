/**
 * economicTick.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F3-A3.
 *
 * Núcleo PURO de la medición económica del cliente: decide qué declara cada
 * `econ_tick`. No toca el DOM, la red ni el reloj: el hook `useEconomicTick`
 * le inyecta el tiempo (ya corregido con el reloj del servidor), las señales
 * humanas, la visibilidad y muestras de los medios de narración.
 *
 * Contrato: docs/royalties/PLAN_GENERAL_V1_1.md §4 y el validador del servidor
 * (`server/royalties/econEvents.mjs` · normalizeEconTick). El cliente DECLARA
 * actividad; la elegibilidad, los episodios y Q los concluye solo el motor
 * F3-A1 en el servidor. Aquí no se calcula nada económico.
 *
 * Reglas del cliente (conservadoras: ante la duda, no se declara):
 *  - Una ventana cubre desde el tick emitido anterior (o el inicio de la
 *    sesión) hasta ahora, con un máximo de 2 min.
 *  - `visible` solo si la pestaña estuvo visible TODA la ventana.
 *  - Señales humanas: solo las que el hook recibe de eventos de confianza
 *    (`isTrusted`) o de navegación iniciada por el lector. Ni la
 *    reproducción, ni el auto-avance, ni el scroll programático lo son.
 *  - Audio: solo el avance real del medio de narración, no silenciado, a una
 *    velocidad admitida; un salto (seek) no cuenta. La reproducción vale como
 *    iniciada por gesto si arrancó dentro de los 10 s siguientes a una señal
 *    humana; tras más de 2 min sin avance hace falta un gesto nuevo.
 *  - Sin señal, sin audio y sin cola acreditable ⇒ no se emite nada.
 */

export const ECON_TICK_EVENT = 'econ_tick';

/** Modos de V1 (DECISIONES_F0C.md P10, `includedModes`). */
export const ECON_TICK_MODES = Object.freeze(['pdf', 'text', 'immersive', 'a11y', 'album', 'epub']);

export const ECON_TICK_PARAMS = Object.freeze({
    tickIntervalMs: 15_000,     // = slotSeconds del rule_set
    flushIntervalMs: 30_000,    // F3-A2 §6.3: agrupar envíos (30–60 s)
    maxWindowMs: 120_000,       // = maxWindowMs del servidor
    pauseMs: 120_000,           // = pauseExclusionSeconds
    maxSignalAgoMs: 3_600_000,  // = maxSignalAgoMs del servidor
    gestureWindowMs: 10_000,
    audioRunGapMs: 120_000,
    seekToleranceMs: 1_500,
    minRate: 0.25,
    maxRate: 4,
    maxBatch: 50,               // tope de lote de POST /api/v1/events
    maxBufferAgeMs: 540_000,    // < maxIngestDelayMs (10 min) del servidor
});

/**
 * @param {object} o
 * @param {string} o.mode        uno de ECON_TICK_MODES
 * @param {string} o.contentId
 * @param {string} o.sessionId   ULID de la sesión técnica (una por montaje)
 * @param {number} o.startedAt   reloj corregido al abrir la sesión
 * @param {boolean} o.visible    visibilidad de la pestaña al abrir
 */
export function createEconomicTickCore({ mode, contentId, sessionId, startedAt, visible, params = ECON_TICK_PARAMS }) {
    if (!ECON_TICK_MODES.includes(mode)) throw new TypeError(`economicTick: modo no incluido "${mode}"`);
    let lastEmitAt = startedAt;
    let lastSignalAt = null;
    let firstSignalSinceEmit = null;
    let isVisible = !!visible;
    let visibleSince = visible ? startedAt : null;

    // Audio de narración: muestras por elemento y acumulado de la ventana.
    const media = new Map(); // key → { src, posMs, at }
    let lastSampleAt = null;
    let advancedMs = 0;
    let unmutedPlaying = false;
    let mutedSeen = false;
    let observed = false;
    let rate = 1;
    let lastAdvanceAt = null;
    let runGesture = false;

    const isRate = (r) => typeof r === 'number' && Number.isFinite(r) && r >= params.minRate && r <= params.maxRate;

    return {
        humanSignal(t) {
            lastSignalAt = t;
            if (firstSignalSinceEmit === null) firstSignalSinceEmit = t;
        },

        setVisible(v, t) {
            if (v && !isVisible) visibleSince = t;
            if (!v) visibleSince = null;
            isVisible = !!v;
        },

        /**
         * @param {number} t
         * @param {Array<{key:unknown, src:string, posMs:number, paused:boolean, ended:boolean, muted:boolean, volume:number, rate:number}>} samples
         */
        sampleMedia(t, samples) {
            const elapsed = lastSampleAt === null ? 0 : Math.max(0, t - lastSampleAt);
            lastSampleAt = t;
            let playingNow = false;
            for (const s of samples || []) {
                if (!s || s.key == null) continue;
                const prev = media.get(s.key);
                media.set(s.key, { src: s.src, posMs: s.posMs, at: t });
                if (s.paused || s.ended || !isRate(s.rate) || !Number.isFinite(s.posMs)) continue;
                playingNow = true;
                observed = true;
                const muted = s.muted === true || !(s.volume > 0);
                if (muted) { mutedSeen = true; continue; }
                unmutedPlaying = true;
                // Avance desde la muestra anterior del MISMO medio; un medio que
                // empezó entre muestras (relevo A/B, segmento nuevo) cuenta desde 0.
                const base = prev && prev.src === s.src ? prev.posMs : 0;
                const since = prev && prev.src === s.src ? t - prev.at : elapsed;
                const delta = s.posMs - base;
                if (!(delta > 0) || delta > since * s.rate + params.seekToleranceMs) continue;
                if (lastAdvanceAt === null || t - lastAdvanceAt > params.audioRunGapMs) {
                    runGesture = lastSignalAt !== null && t - lastSignalAt <= params.gestureWindowMs;
                }
                lastAdvanceAt = t;
                advancedMs += delta;
                rate = s.rate;
            }
            return playingNow;
        },

        /**
         * Cierra la ventana en `t`. Devuelve el evento a enviar o null.
         * @param {number} t
         * @param {string} eventId  ULID nuevo
         */
        tick(t, eventId) {
            const windowStart = Math.max(lastEmitAt, t - params.maxWindowMs);
            const windowMs = Math.round(t - windowStart);
            if (!(windowMs > 0)) return null;
            const visibleAll = isVisible && visibleSince !== null && visibleSince <= windowStart;
            const signalInWindow = firstSignalSinceEmit !== null && firstSignalSinceEmit > windowStart;
            const tail = visibleAll && lastSignalAt !== null && t - lastSignalAt <= params.pauseMs;
            const audioAdv = advancedMs > 0;
            const resetWindow = () => {
                lastEmitAt = t;
                firstSignalSinceEmit = null;
                advancedMs = 0; unmutedPlaying = false; mutedSeen = false; observed = false;
            };
            if (!signalInWindow && !audioAdv && !tail) {
                // Nada acreditable: no se emite. Si tampoco hay audio sonando,
                // la próxima ventana empieza aquí.
                if (!observed) resetWindow();
                return null;
            }
            const payload = { windowMs, visible: visibleAll, humanSignalAgoMs: null };
            if (lastSignalAt !== null && t - lastSignalAt <= params.maxSignalAgoMs) {
                payload.humanSignalAgoMs = Math.round(t - lastSignalAt);
                if (signalInWindow) {
                    const first = Math.round(t - firstSignalSinceEmit);
                    if (first <= windowMs && first >= payload.humanSignalAgoMs) payload.firstHumanSignalAgoMs = first;
                }
            }
            payload.audio = observed
                ? {
                    playing: audioAdv || unmutedPlaying,
                    gesture: runGesture,
                    mediaAdvancedMs: Math.round(Math.min(advancedMs, windowMs * rate)),
                    rate,
                    muted: !audioAdv && mutedSeen,
                }
                : null;
            resetWindow();
            return { eventId, event: ECON_TICK_EVENT, mode, contentId, sessionId, clientTs: Math.round(t), payload };
        },
    };
}

/** Buffer de envío: descarta lo que el servidor ya rechazaría por antigüedad. */
export function createTickBuffer(params = ECON_TICK_PARAMS) {
    let items = [];
    return {
        push(evt) { if (evt) items.push(evt); },
        /** Saca hasta `maxBatch` eventos todavía admisibles en `now`. */
        drain(now) {
            items = items.filter((e) => now - e.clientTs <= params.maxBufferAgeMs);
            return items.splice(0, params.maxBatch);
        },
        get size() { return items.length; },
    };
}

/**
 * Desfase del reloj local frente al del servidor, a partir de una petición a
 * /api/server-time: `serverNow` respecto al punto medio del viaje.
 */
export function serverClockOffset(sentAt, receivedAt, serverNow) {
    if (![sentAt, receivedAt, serverNow].every((x) => typeof x === 'number' && Number.isFinite(x))) return 0;
    if (receivedAt < sentAt) return 0;
    return Math.round(serverNow - (sentAt + receivedAt) / 2);
}

/** Interpretación del flag público que expone /api/runtime-config. */
export function econIngestEnabled(runtimeConfig) {
    return !!runtimeConfig && typeof runtimeConfig === 'object' && runtimeConfig.economicIngest === 'on';
}

/** Motivos de relocate del lector EPUB que son navegación del lector (3E.6). */
export const EPUB_READER_RELOCATE_REASONS = Object.freeze(['page', 'snap', 'scroll', 'navigation']);
export function isEpubReaderRelocate(reason) {
    return EPUB_READER_RELOCATE_REASONS.includes(reason);
}
