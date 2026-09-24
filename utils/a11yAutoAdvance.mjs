/**
 * a11yAutoAdvance.mjs — CHP-MAINT-ACCESSIBLE-NAV-AUTOADVANCE-01.
 *
 * Núcleo PURO del avance automático del Modo Accesible. Sin React, sin DOM,
 * sin red: `hooks/useA11yAutoAdvance.ts` lo orquesta y los tests lo ejercitan
 * con un reloj falso.
 *
 * Contrato congelado:
 *   - desbloqueo: 120 min de lectura efectiva (lo decide el servidor);
 *   - ritmo personal: mediana de las últimas 5 observaciones válidas de la
 *     sesión; con menos de 3, ritmo de respaldo conservador;
 *   - espera por segmento: palabras / ppm × 60 s, acotada a [8 s, 180 s];
 *   - vigilancia: 10 avances automáticos sin interacción humana → se apaga.
 *
 * Nada de esto se persiste: las observaciones viven en memoria de la sesión.
 */

export const AUTO_ADVANCE_UNLOCK_MS = 120 * 60 * 1000;

export const OBSERVATION_MIN_MS = 3_000;
export const OBSERVATION_MAX_MS = 300_000;
export const PACE_WINDOW = 5;
export const PACE_MIN_OBSERVATIONS = 3;
/**
 * Ritmo de respaldo (palabras por minuto) mientras no hay historia individual
 * suficiente. Deliberadamente LENTO: con lectores infantiles, esperar de más es
 * inocuo (siempre pueden avanzar a mano); adelantarse no lo es.
 */
export const FALLBACK_WPM = 80;

export const SEGMENT_MIN_MS = 8_000;
export const SEGMENT_MAX_MS = 180_000;

export const INACTIVITY_LIMIT = 10;

/** @typedef {'LOCKED' | 'AVAILABLE_OFF' | 'ACTIVE'} AutoAdvanceStatus */

/**
 * Exactamente tres estados. `enabled` sin `unlocked` nunca es ACTIVE.
 * @param {{ unlocked: boolean, enabled: boolean }} s
 * @returns {AutoAdvanceStatus}
 */
export function deriveAutoAdvanceStatus({ unlocked, enabled }) {
    if (!unlocked) return 'LOCKED';
    return enabled ? 'ACTIVE' : 'AVAILABLE_OFF';
}

/**
 * Una observación es válida si mide un segmento real con una permanencia
 * plausible (ni un salto de paso ni una pausa larga).
 * @param {{ words: number, durationMs: number }} o
 */
export function isValidObservation(o) {
    return !!o
        && Number.isFinite(o.words) && o.words > 0
        && Number.isFinite(o.durationMs)
        && o.durationMs >= OBSERVATION_MIN_MS
        && o.durationMs <= OBSERVATION_MAX_MS;
}

/**
 * Añade una observación (si es válida) conservando solo las últimas 5.
 * No muta la lista recibida.
 * @param {ReadonlyArray<{words:number, durationMs:number}>} list
 * @param {{words:number, durationMs:number}} o
 */
export function pushObservation(list, o) {
    if (!isValidObservation(o)) return list;
    const next = [...list, { words: o.words, durationMs: o.durationMs }];
    return next.length > PACE_WINDOW ? next.slice(next.length - PACE_WINDOW) : next;
}

/** @param {ReadonlyArray<number>} xs */
export function median(xs) {
    if (!xs.length) return NaN;
    const s = [...xs].sort((a, b) => a - b);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Ritmo personal en palabras por minuto.
 * @param {ReadonlyArray<{words:number, durationMs:number}>} observations
 * @returns {{ wpm: number, source: 'personal' | 'fallback' }}
 */
export function personalWpm(observations) {
    if (!observations || observations.length < PACE_MIN_OBSERVATIONS) {
        return { wpm: FALLBACK_WPM, source: 'fallback' };
    }
    const wpm = median(observations.map(o => o.words / (o.durationMs / 60_000)));
    if (!Number.isFinite(wpm) || wpm <= 0) return { wpm: FALLBACK_WPM, source: 'fallback' };
    return { wpm, source: 'personal' };
}

/**
 * Espera antes de avanzar desde un segmento de `words` palabras.
 * @param {number} words
 * @param {number} wpm
 */
export function segmentDurationMs(words, wpm) {
    const w = Number.isFinite(words) && words > 0 ? words : 0;
    const p = Number.isFinite(wpm) && wpm > 0 ? wpm : FALLBACK_WPM;
    const raw = (w / p) * 60_000;
    return Math.min(SEGMENT_MAX_MS, Math.max(SEGMENT_MIN_MS, raw));
}

/** true cuando la racha de avances automáticos sin interacción debe apagar el avance. */
export function inactivityLimitReached(autoAdvancesSinceHuman) {
    return autoAdvancesSinceHuman >= INACTIVITY_LIMIT;
}

/**
 * Temporizador pausable determinista. Solo cuenta mientras corre: al pausar
 * guarda el tiempo restante y al reanudar programa exactamente ese resto. Un
 * rato con la pestaña oculta o la ventana sin foco NUNCA dispara un avance.
 *
 * @param {{ now?: () => number, setTimer?: (fn: () => void, ms: number) => unknown,
 *           clearTimer?: (h: unknown) => void }} [clock]
 */
export function createPausableTimer(clock = {}) {
    const now = clock.now ?? (() => Date.now());
    const setTimer = clock.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    const clearTimer = clock.clearTimer ?? ((h) => clearTimeout(/** @type {any} */ (h)));

    let handle = null;
    let remaining = 0;
    let startedAt = 0;
    let callback = null;
    let armed = false;   // hay una espera pendiente (corriendo o en pausa)
    let running = false;

    const fire = () => {
        handle = null;
        running = false;
        armed = false;
        remaining = 0;
        const cb = callback;
        callback = null;
        if (cb) cb();
    };

    return {
        /** Programa una espera nueva. Si `paused`, queda armada sin correr. */
        start(ms, cb, { paused = false } = {}) {
            if (handle !== null) clearTimer(handle);
            handle = null;
            callback = cb;
            remaining = Math.max(0, ms);
            armed = true;
            running = false;
            if (!paused) {
                startedAt = now();
                running = true;
                handle = setTimer(fire, remaining);
            }
        },
        pause() {
            if (!armed || !running) return;
            if (handle !== null) clearTimer(handle);
            handle = null;
            remaining = Math.max(0, remaining - (now() - startedAt));
            running = false;
        },
        resume() {
            if (!armed || running) return;
            startedAt = now();
            running = true;
            handle = setTimer(fire, remaining);
        },
        cancel() {
            if (handle !== null) clearTimer(handle);
            handle = null;
            armed = false;
            running = false;
            remaining = 0;
            callback = null;
        },
        /** Tiempo restante (ms) a este instante. 0 si no hay espera. */
        remaining() {
            if (!armed) return 0;
            return running ? Math.max(0, remaining - (now() - startedAt)) : remaining;
        },
        isArmed: () => armed,
        isRunning: () => running,
    };
}
