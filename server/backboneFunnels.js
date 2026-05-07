/**
 * backboneFunnels.js — agregador puro de funnels de producto.
 *
 * Sprint Data Backbone — Fase 6A.
 *
 * Convierte eventos del Backbone v1 en embudos de conversión por flujo
 * (LU, lectura general, modo accesible, inmersivo, PDF, álbum). Es el
 * espejo "comportamental" de backboneMetrics.js, que solo agregaba
 * conteos.
 *
 * Reglas de cálculo:
 *   - Solo se consideran eventos con payload._source === 'native'.
 *     Legacy y unknown se ignoran (los mismos buckets que el agregador
 *     trata como duplicación contaminante en Sprint 5A).
 *   - Funnel monotónico: una sesión cuenta en el step N si y solo si
 *     emitió TODOS los steps 1..N (en cualquier orden temporal). Esto
 *     evita que una sesión que reportó `download_success` sin
 *     `version_check` previo infle el step de éxito.
 *   - Dedupe por sessionId: el mismo step en la misma sesión cuenta 1.
 *   - uniqueUsers se calcula sobre los userIds de las sesiones que
 *     alcanzan ese step (no sobre todos los emisores del evento).
 *   - Conversión: count(N) / count(N-1). El step 1 tiene
 *     conversionFromPrevious = null y conversionFromStart = 1 cuando
 *     hay datos.
 *
 * Lo que NO hace:
 *   - No emite eventos. No persiste. No llama a la DB. Recibe events ya
 *     parseados por eventsService.
 *   - No mezcla con `aggregateBackboneMetrics`. Endpoint y consumidores
 *     deciden si publicar funnels además del shape base.
 *   - No hace estadística avanzada (intervalos de confianza, regresión).
 *     Sprint 6B podría agregarlo.
 */

// ── Constantes ───────────────────────────────────────────────────────────────

const SOURCE_NATIVE = 'native';

const READING_MODES = ['text', 'immersive', 'a11y', 'pdf', 'album'];

// ── Helpers ──────────────────────────────────────────────────────────────────

function getEventSource(event) {
    const s = event && event.payload && event.payload._source;
    return s === 'native' || s === 'legacy' ? s : 'unknown';
}

function actionFromEventName(eventName) {
    if (typeof eventName !== 'string') return null;
    const dot = eventName.indexOf('.');
    return dot >= 0 ? eventName.slice(dot + 1) : eventName;
}

// Filtra a native-only. Es el primer paso que aplica todo cómputo de funnel.
function filterNative(events) {
    if (!Array.isArray(events)) return [];
    return events.filter(e => getEventSource(e) === SOURCE_NATIVE);
}

/**
 * Indexa eventos en mapa por sessionId. Cada sesión registra:
 *   - mode, userId
 *   - actionsSeen: Set<action> deduplicado
 *   - errorTypes: contador de payload.errorType vistos en eventos *.error
 *
 * Las sesiones se construyen aunque no exista session_start: si una
 * sesión solo emite errores, queda registrada (útil para a11y.error).
 */
function indexBySession(events) {
    const map = new Map();
    for (const e of events) {
        if (!e || typeof e !== 'object') continue;
        const sid = e.sessionId;
        if (typeof sid !== 'string' || sid.length === 0) continue;

        let s = map.get(sid);
        if (!s) {
            s = {
                sessionId:   sid,
                mode:        e.mode,
                userId:      typeof e.userId === 'string' ? e.userId : null,
                actionsSeen: new Set(),
                errorTypes:  {},
                errorCount:  0,
            };
            map.set(sid, s);
        }
        const action = actionFromEventName(e.event);
        if (!action) continue;
        s.actionsSeen.add(action);

        // Un evento es "error" si la action es exactamente 'error' (a11y.error)
        // o termina en '_error' (lu.download_error, lu.version_error, etc.).
        // Convención del backbone v1; mantener este match alineado con cualquier
        // futura acción de error.
        if (action === 'error' || action.endsWith('_error')) {
            s.errorCount += 1;
            const t = (e.payload && typeof e.payload.errorType === 'string')
                ? e.payload.errorType
                : 'unknown';
            s.errorTypes[t] = (s.errorTypes[t] ?? 0) + 1;
        }
    }
    return map;
}

/**
 * Núcleo del funnel monotónico.
 *
 * @param {string} id       - id estable (ej: 'lu', 'reading', 'a11y')
 * @param {string} label    - etiqueta humana
 * @param {Array<{key,label}>} stepDefs - pasos en orden
 * @param {Iterable<object>} sessions   - sesiones a evaluar
 * @returns {object} funnel shape
 */
function buildMonotonicFunnel(id, label, stepDefs, sessions) {
    const stepKeys = stepDefs.map(s => s.key);

    // Para cada step k, accumulamos count y usuarios únicos.
    const counts      = stepKeys.map(() => 0);
    const userSets    = stepKeys.map(() => new Set());

    for (const s of sessions) {
        // Recorremos los steps en orden; en cuanto la sesión no contenga
        // un step, paramos: monotonic funnel.
        for (let i = 0; i < stepKeys.length; i++) {
            if (!s.actionsSeen.has(stepKeys[i])) break;
            counts[i] += 1;
            if (s.userId) userSets[i].add(s.userId);
        }
    }

    // Materializar steps con conversiones.
    const startCount = counts[0] ?? 0;
    const steps = stepDefs.map((def, i) => {
        const count = counts[i];
        const prev  = i > 0 ? counts[i - 1] : null;
        const convFromPrev  = prev === null ? null : (prev > 0 ? count / prev : 0);
        const convFromStart = i === 0
            ? (count > 0 ? 1 : 0)
            : (startCount > 0 ? count / startCount : 0);
        return {
            key:                    def.key,
            label:                  def.label,
            count,
            uniqueUsers:            userSets[i].size,
            conversionFromPrevious: convFromPrev,
            conversionFromStart:    convFromStart,
        };
    });

    // Dropoffs entre pares consecutivos.
    const dropoffs = [];
    for (let i = 1; i < stepKeys.length; i++) {
        const lost        = Math.max(0, counts[i - 1] - counts[i]);
        const lostPercent = counts[i - 1] > 0 ? lost / counts[i - 1] : 0;
        dropoffs.push({
            from:        stepKeys[i - 1],
            to:          stepKeys[i],
            lost,
            lostPercent,
        });
    }

    // Mayor abandono (desempate por orden de aparición).
    let biggestDropoff;
    for (const d of dropoffs) {
        if (!biggestDropoff || d.lost > biggestDropoff.lost) biggestDropoff = d;
    }

    const completions    = counts[counts.length - 1] ?? 0;
    const completionRate = startCount > 0 ? completions / startCount : 0;

    return {
        id,
        label,
        steps,
        dropoffs,
        summary: {
            starts:         startCount,
            completions,
            completionRate,
            biggestDropoff: biggestDropoff && biggestDropoff.lost > 0 ? biggestDropoff : null,
        },
    };
}

// ── Definiciones de cada funnel ──────────────────────────────────────────────

const LU_STEPS = [
    { key: 'page_view',        label: 'Vista de pantalla' },
    { key: 'version_check',    label: 'Versión consultada' },
    { key: 'download_start',   label: 'Descarga iniciada' },
    { key: 'download_success', label: 'Descarga entregada' },
];

const READING_STEPS = [
    { key: 'session_start',     label: 'Sesión iniciada' },
    { key: 'session_heartbeat', label: 'Sesión activa' },
    { key: 'progress',          label: 'Progreso reportado' },
    { key: 'session_end',       label: 'Sesión cerrada' },
];

const A11Y_STEPS = [
    { key: 'session_start', label: 'Sesión iniciada' },
    { key: 'progress',      label: 'Progreso reportado' },
    { key: 'session_end',   label: 'Sesión cerrada' },
];

const IMMERSIVE_STEPS = [
    { key: 'session_start',     label: 'Sesión iniciada' },
    { key: 'audio_play',        label: 'Audio reproducido' },
    { key: 'session_heartbeat', label: 'Sesión activa' },
    { key: 'session_end',       label: 'Sesión cerrada' },
];

const PDF_STEPS = [
    { key: 'session_start', label: 'Sesión iniciada' },
    { key: 'progress',      label: 'Progreso reportado' },
    { key: 'session_end',   label: 'Sesión cerrada' },
];

const ALBUM_STEPS = [
    { key: 'session_start', label: 'Sesión iniciada' },
    { key: 'progress',      label: 'Progreso reportado' },
    { key: 'session_end',   label: 'Sesión cerrada' },
];

// ── Constructores específicos ────────────────────────────────────────────────

function buildLuFunnel(sessionMap) {
    const luSessions = [];
    for (const s of sessionMap.values()) {
        if (s.mode === 'lu') luSessions.push(s);
    }
    const base = buildMonotonicFunnel('lu', 'Distribución Chibalete LU', LU_STEPS, luSessions);

    // Errores: agregamos lu.download_error a nivel funnel (no es step).
    const errors = aggregateErrors(luSessions);
    return { ...base, errors };
}

function buildReadingFunnel(sessionMap) {
    const readingSessions = [];
    for (const s of sessionMap.values()) {
        if (READING_MODES.includes(s.mode)) readingSessions.push(s);
    }
    const base = buildMonotonicFunnel('reading', 'Lectura general', READING_STEPS, readingSessions);

    // Por modo (cada modo es un funnel independiente con los mismos pasos).
    const byMode = {};
    for (const mode of READING_MODES) {
        const sessionsOfMode = readingSessions.filter(s => s.mode === mode);
        byMode[mode] = buildMonotonicFunnel(`reading.${mode}`, `Lectura · ${mode}`, READING_STEPS, sessionsOfMode);
    }

    return { ...base, byMode };
}

function buildA11yFunnel(sessionMap) {
    const a11ySessions = [];
    for (const s of sessionMap.values()) {
        if (s.mode === 'a11y') a11ySessions.push(s);
    }
    const base = buildMonotonicFunnel('a11y', 'Modo Accesible', A11Y_STEPS, a11ySessions);

    // Errores: a11y.error puede ocurrir sin session_start. Cuenta total
    // se computa sobre TODAS las sesiones a11y (incluso las que solo
    // tienen el evento error).
    const errors = aggregateErrors(a11ySessions);
    return { ...base, errors };
}

function buildImmersiveFunnel(sessionMap) {
    const immersiveSessions = [];
    for (const s of sessionMap.values()) {
        if (s.mode === 'immersive') immersiveSessions.push(s);
    }
    const base = buildMonotonicFunnel('immersive', 'Modo Inmersivo', IMMERSIVE_STEPS, immersiveSessions);

    // Auxiliar: ratio play/pause.
    let playSessions  = 0;
    let pauseSessions = 0;
    for (const s of immersiveSessions) {
        if (s.actionsSeen.has('audio_play'))  playSessions  += 1;
        if (s.actionsSeen.has('audio_pause')) pauseSessions += 1;
    }
    const totalActions = playSessions + pauseSessions;
    const audio = {
        playSessions,
        pauseSessions,
        playPauseRatio: totalActions > 0 ? playSessions / totalActions : 0,
    };
    return { ...base, audio };
}

function buildPdfFunnel(sessionMap) {
    const pdfSessions = [];
    for (const s of sessionMap.values()) {
        if (s.mode === 'pdf') pdfSessions.push(s);
    }
    return buildMonotonicFunnel('pdf', 'Modo Visual (PDF)', PDF_STEPS, pdfSessions);
}

function buildAlbumFunnel(sessionMap) {
    const albumSessions = [];
    for (const s of sessionMap.values()) {
        if (s.mode === 'album') albumSessions.push(s);
    }
    return buildMonotonicFunnel('album', 'Modo Álbum', ALBUM_STEPS, albumSessions);
}

function aggregateErrors(sessionsOfFlow) {
    const byType = {};
    let total = 0;
    for (const s of sessionsOfFlow) {
        total += s.errorCount;
        for (const [t, n] of Object.entries(s.errorTypes)) {
            byType[t] = (byType[t] ?? 0) + n;
        }
    }
    return { total, byType };
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Calcula los funnels de producto sobre eventos del Backbone v1.
 *
 * @param {Array<object>} events  - eventos parseados por eventsService.
 * @param {object}        meta    - { windowDays, windowFrom, windowTo }.
 * @returns {object} shape de funnels (ver doc del módulo).
 */
export function computeBackboneFunnels(events, meta = {}) {
    const safeEvents = Array.isArray(events) ? events : [];
    const nativeOnly = filterNative(safeEvents);

    // Registramos cuántos eventos descartamos por no ser native — útil
    // como meta diagnóstica para distinguir "sin datos" vs "solo legacy".
    const nativeEventCount = nativeOnly.length;
    const ignoredCount     = safeEvents.length - nativeEventCount;

    const sessionMap = indexBySession(nativeOnly);

    const funnels = {
        lu:        buildLuFunnel(sessionMap),
        reading:   buildReadingFunnel(sessionMap),
        a11y:      buildA11yFunnel(sessionMap),
        immersive: buildImmersiveFunnel(sessionMap),
        pdf:       buildPdfFunnel(sessionMap),
        album:     buildAlbumFunnel(sessionMap),
    };

    return {
        generatedAt:        Date.now(),
        windowDays:         meta.windowDays ?? null,
        windowFrom:         meta.windowFrom ?? null,
        windowTo:           meta.windowTo   ?? null,
        sourceFilter:       'native',
        nativeEventCount,
        ignoredNonNativeEvents: ignoredCount,
        funnels,
    };
}

/**
 * Shape vacío válido — fallback cuando events.db no existe o falla.
 * Garantiza que consumidores no necesiten chequeos defensivos.
 */
export function emptyBackboneFunnels(meta = {}) {
    const empty = (id, label, stepDefs) => ({
        id, label,
        steps: stepDefs.map((d, i) => ({
            key: d.key, label: d.label, count: 0, uniqueUsers: 0,
            conversionFromPrevious: i === 0 ? null : 0,
            conversionFromStart:    0,
        })),
        dropoffs: stepDefs.slice(1).map((d, i) => ({
            from: stepDefs[i].key, to: d.key, lost: 0, lostPercent: 0,
        })),
        summary: { starts: 0, completions: 0, completionRate: 0, biggestDropoff: null },
    });
    const lu        = { ...empty('lu',        'Distribución Chibalete LU', LU_STEPS),       errors: { total: 0, byType: {} } };
    const reading   = { ...empty('reading',   'Lectura general',           READING_STEPS),  byMode: {} };
    for (const mode of READING_MODES) {
        reading.byMode[mode] = empty(`reading.${mode}`, `Lectura · ${mode}`, READING_STEPS);
    }
    const a11y      = { ...empty('a11y',      'Modo Accesible',     A11Y_STEPS),      errors: { total: 0, byType: {} } };
    const immersive = { ...empty('immersive', 'Modo Inmersivo',     IMMERSIVE_STEPS), audio: { playSessions: 0, pauseSessions: 0, playPauseRatio: 0 } };
    const pdf       =        empty('pdf',     'Modo Visual (PDF)',  PDF_STEPS);
    const album     =        empty('album',   'Modo Álbum',         ALBUM_STEPS);

    return {
        generatedAt:            Date.now(),
        windowDays:             meta.windowDays ?? null,
        windowFrom:             meta.windowFrom ?? null,
        windowTo:               meta.windowTo   ?? null,
        sourceFilter:           'native',
        nativeEventCount:       0,
        ignoredNonNativeEvents: 0,
        funnels: { lu, reading, a11y, immersive, pdf, album },
    };
}
