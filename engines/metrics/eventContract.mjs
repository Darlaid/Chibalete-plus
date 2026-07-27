/**
 * eventContract.mjs — CHP-METRICS-CONTRACT-01A.
 *
 * Semántica de los eventos de `events.db`, derivada del vocabulario REAL y del
 * código productor, no del nombre. Módulo PURO: no abre archivos, no escribe,
 * no usa reloj propio (todo periodo se inyecta) y es determinístico.
 *
 * ── Hallazgo que gobierna todo este archivo ─────────────────────────────────
 *
 * `elapsed_ms` es **acumulado desde el inicio de la sesión**, no la duración
 * del evento. Todos los productores lo calculan igual
 * (`Date.now() - sessionStartTs`): useBackboneReadingSession, useA11yAnalytics,
 * useLuAnalytics, analyticsSeam. Verificado además empíricamente sobre 349
 * sesiones productivas: monótono en 349/349 por extremos (1 violación en 2.659
 * pares consecutivos) y su rango coincide con la ventana temporal en el 62 %.
 *
 * Consecuencia: **SUMAR `elapsed_ms` es un error de categoría.** En producción
 * la suma supera el doble de la ventana real en el 83 % de las sesiones, con
 * un factor de inflación mediano de 3,67× y máximo de 815×. La única lectura
 * válida es el MÁXIMO por sesión (equivalente al valor del evento de cierre).
 */

// ── Taxonomía ───────────────────────────────────────────────────────────────

export const EVENT_CLASS = Object.freeze({
    SESSION_BOUNDARY:       'SESSION_BOUNDARY',
    USER_ACTIVITY:          'USER_ACTIVITY',
    READING_ACTIVITY:       'READING_ACTIVITY',
    PROGRESS_SIGNAL:        'PROGRESS_SIGNAL',
    HEARTBEAT_OR_TELEMETRY: 'HEARTBEAT_OR_TELEMETRY',
    CONTENT_OPEN:           'CONTENT_OPEN',
    CONTENT_CLOSE:          'CONTENT_CLOSE',
    SYSTEM_EVENT:           'SYSTEM_EVENT',
    UNKNOWN_REVIEW_REQUIRED:'UNKNOWN_REVIEW_REQUIRED',
});

/**
 * Reglas por SUFIJO (la parte tras `<mode>.`), en orden de precedencia. Se
 * clasifica por sufijo y no por lista cerrada para que un evento nuevo caiga en
 * UNKNOWN_REVIEW_REQUIRED en vez de colarse con una semántica supuesta.
 */
const SUFFIX_RULES = [
    [/^session_start$/,                 EVENT_CLASS.SESSION_BOUNDARY],
    [/^session_end$/,                   EVENT_CLASS.SESSION_BOUNDARY],
    [/^session_heartbeat$/,             EVENT_CLASS.HEARTBEAT_OR_TELEMETRY],
    [/^session_completed$/,             EVENT_CLASS.PROGRESS_SIGNAL],
    [/^progress$/,                      EVENT_CLASS.PROGRESS_SIGNAL],
    [/^block_complete$/,                EVENT_CLASS.READING_ACTIVITY],
    [/^page_change$/,                   EVENT_CLASS.READING_ACTIVITY],
    [/^sentence_(time|rhythm|skipped)$/,EVENT_CLASS.HEARTBEAT_OR_TELEMETRY],
    [/^audio_(play|pause)$/,            EVENT_CLASS.READING_ACTIVITY],
    [/^playback_paused$/,               EVENT_CLASS.READING_ACTIVITY],
    [/^level_up$|^streak_break$/,       EVENT_CLASS.PROGRESS_SIGNAL],
    [/^leo_interaction$/,               EVENT_CLASS.USER_ACTIVITY],
    [/^page_view$/,                     EVENT_CLASS.USER_ACTIVITY],
    [/_view$/,                          EVENT_CLASS.USER_ACTIVITY],
    [/^chunk_audio_|^pb_|^blob_|^load_cancelled$|^tts_fail$/, EVENT_CLASS.SYSTEM_EVENT],
    [/^download_|^version_check$|^install_/, EVENT_CLASS.SYSTEM_EVENT],
];

/** Modos de lectura conocidos; `lu` es la app companion, no un visor. */
export const READING_MODES = Object.freeze(['immersive', 'text', 'pdf', 'album', 'a11y']);

/**
 * @returns {{mode:string|null, suffix:string, class:string}}
 */
export function classifyEvent(eventName) {
    if (typeof eventName !== 'string' || !eventName) {
        return { mode: null, suffix: '', class: EVENT_CLASS.UNKNOWN_REVIEW_REQUIRED };
    }
    const dot = eventName.indexOf('.');
    const mode = dot > 0 ? eventName.slice(0, dot) : null;
    const suffix = dot > 0 ? eventName.slice(dot + 1) : eventName;
    for (const [rx, cls] of SUFFIX_RULES) {
        if (rx.test(suffix)) return { mode, suffix, class: cls };
    }
    return { mode, suffix, class: EVENT_CLASS.UNKNOWN_REVIEW_REQUIRED };
}

export const isSessionStart = (e) => classifyEvent(e).suffix === 'session_start';
export const isSessionEnd   = (e) => classifyEvent(e).suffix === 'session_end';
export const isReadingMode  = (m) => READING_MODES.includes(m);

// ── Tiempo ──────────────────────────────────────────────────────────────────

/** Tope de sesión aprobado en D5: 4 horas. */
export const SESSION_CAP_MS = 4 * 60 * 60 * 1000;
/** Umbral de inactividad aprobado en D3: 15 minutos. */
export const IDLE_MS = 15 * 60 * 1000;

/**
 * Duración de una sesión (D5, aprobado).
 *
 *   min(lastAttributableActivity - firstAttributableActivity, 4 h)
 *
 * La ventana entre el primer y el último evento atribuible es la magnitud
 * primaria. `elapsed_ms` NO se suma nunca; se usa solo para:
 *   · corroboración — se reporta la desviación frente a la ventana;
 *   · fallback validado — cuando la ventana es 0 (sesión de un solo evento)
 *     pero el acumulado del cierre demuestra una duración real.
 *
 * @returns {{ms:number|null, source:string, capped:boolean, corroborationMs:number|null,
 *            corroborationDeltaMs:number|null}}
 */
export function sessionDuration(events, { capMs = SESSION_CAP_MS } = {}) {
    const list = Array.isArray(events) ? events : [];
    if (list.length === 0) {
        return { ms: null, source: 'NO_EVENTS', capped: false, corroborationMs: null, corroborationDeltaMs: null };
    }

    const finite = (x) => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    const ts = list.map(e => e.serverTs).filter(finite);
    const window = ts.length ? Math.max(...ts) - Math.min(...ts) : null;

    // Corroboración: acumulado del cierre, o máximo observado. Nunca la suma.
    const closing = list.filter(e => isSessionEnd(e.event) && finite(e.elapsedMs));
    const corroboration = closing.length > 0
        ? Math.max(...closing.map(e => e.elapsedMs))
        : list.reduce((a, e) => (finite(e.elapsedMs) && e.elapsedMs > a ? e.elapsedMs : a), -1);
    const corroborationMs = corroboration >= 0 ? corroboration : null;

    let ms = null, source = 'NO_DURATION';
    if (window != null && window > 0) {
        ms = window;
        source = 'ATTRIBUTABLE_ACTIVITY_WINDOW';
    } else if (corroborationMs != null && corroborationMs > 0) {
        // Ventana nula pero el acumulado demuestra duración: fallback validado.
        ms = corroborationMs;
        source = 'ELAPSED_FALLBACK_VALIDATED';
    } else if (window != null) {
        ms = window; // 0 medido
        source = 'ATTRIBUTABLE_ACTIVITY_WINDOW';
    }
    if (ms == null) {
        return { ms: null, source, capped: false, corroborationMs, corroborationDeltaMs: null };
    }

    let capped = false;
    if (capMs != null && ms > capMs) { ms = capMs; capped = true; }
    return {
        ms, source, capped, corroborationMs,
        corroborationDeltaMs: corroborationMs != null && window != null ? corroborationMs - window : null,
    };
}

// ── Sesiones ────────────────────────────────────────────────────────────────

export const SESSION_STRATEGY = Object.freeze({
    EXPLICIT_BOUNDARIES: 'EXPLICIT_BOUNDARIES',
    SESSION_ID:          'SESSION_ID',
    INACTIVITY_WINDOW:   'INACTIVITY_WINDOW',
});

/**
 * Reconstruye las sesiones de UN usuario (D2, aprobado).
 *
 * Reglas, en el orden en que se aplican a cada evento ordenado por tiempo:
 *   · más de `idleMs` de inactividad          → abre sesión nueva;
 *   · `session_end`                            → cierra la sesión en curso
 *                                                (una sesión puede cerrarse
 *                                                antes del umbral de inactividad);
 *   · `session_start` sin sesión activa        → abre sesión;
 *   · un evento de SISTEMA no abre sesión por sí solo — si no hay ninguna
 *     activa, se registra como huérfano y no crea una sesión de lectura;
 *   · un `session_end` sin sesión activa TAMPOCO abre sesión: un cierre no
 *     puede iniciar lo que termina. Ocurre con reintentos, descargas offline y
 *     eventos duplicados; sin esta regla el fallback de `elapsed_ms` le
 *     atribuiría a ese huérfano la duración completa de la sesión ya cerrada, y
 *     el tiempo total se duplicaría;
 *   · `session_id` NO es autoridad: solo se conserva como referencia.
 *
 * Determinística: ordena por `serverTs` y desempata por `eventId`.
 */
export function reconstructSessions(userEvents, { idleMs = IDLE_MS, capMs } = {}) {
    const list = (Array.isArray(userEvents) ? userEvents : [])
        .filter(e => e && Number.isFinite(e.serverTs))
        .sort((a, b) => (a.serverTs - b.serverTs) || String(a.eventId ?? '').localeCompare(String(b.eventId ?? '')));

    const out = [];
    let cur = null;
    let orphanEvents = 0;
    const close = () => { if (cur) { out.push(cur); cur = null; } };

    for (const e of list) {
        const cls = classifyEvent(e.event);
        const isSystem = cls.class === EVENT_CLASS.SYSTEM_EVENT;

        if (cur && e.serverTs - cur.lastTs > idleMs) close();

        if (!cur) {
            // Ni un evento de sistema ni un cierre pueden abrir una sesión.
            if (isSystem || cls.suffix === 'session_end') { orphanEvents++; continue; }
            cur = { startTs: e.serverTs, lastTs: e.serverTs, events: [e], sessionIds: new Set([e.sessionId ?? null]) };
        } else {
            cur.lastTs = e.serverTs;
            cur.events.push(e);
            cur.sessionIds.add(e.sessionId ?? null);
        }

        // El cierre explícito termina la sesión aunque no haya llegado el idle.
        if (cls.suffix === 'session_end') close();
    }
    close();

    const sessions = out.map(s => {
        const d = sessionDuration(s.events, capMs === undefined ? {} : { capMs });
        return {
            startTs: s.startTs, endTs: s.lastTs, eventCount: s.events.length,
            durationMs: d.ms, durationSource: d.source, durationCapped: d.capped,
            corroborationDeltaMs: d.corroborationDeltaMs,
            windowMs: s.lastTs - s.startTs,
            distinctSessionIds: s.sessionIds.size,
        };
    });
    // Se adjunta como propiedad no enumerable para no alterar la serialización.
    Object.defineProperty(sessions, 'orphanEvents', { value: orphanEvents, enumerable: false });
    return sessions;
}

/** Estrategia de fallback: agrupación por `session_id`. Documentada, no recomendada. */
export function groupBySessionId(userEvents) {
    const by = new Map();
    for (const e of (Array.isArray(userEvents) ? userEvents : [])) {
        const k = e?.sessionId ?? '<null>';
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(e);
    }
    return [...by.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))
        .map(([sessionId, events]) => ({ sessionId, eventCount: events.length, ...sessionDuration(events) }));
}
