/**
 * backboneMetrics.js — agregador puro de eventos del Data Backbone v1.
 *
 * Sprint Data Backbone — Fase 3.
 *
 * Recibe un array de BackboneEvent (ya parseados por eventsService) y produce
 * el shape `backboneMetrics` consumido por dashboards y reportes. Es 100%
 * pure: no abre conexiones, no lee disco, no envía requests.
 *
 * Diseño por modos:
 *   - Cada métrica está bucketed por `mode` (text, immersive, a11y, …).
 *   - Las sesiones se reconstruyen agrupando eventos por `sessionId`.
 *   - Para cálculos temporales se prefiere `session_end.elapsedMs` (autoritativo);
 *     si la sesión no tiene end pero sí heartbeat, se estima con el último
 *     `session_heartbeat.elapsedMs` y se marca `estimatedFromHeartbeat: true`.
 *
 * Compatibilidad:
 *   - Si `events` está vacío → todas las secciones aparecen como objetos vacíos
 *     `{}`. Nunca lanza errores. Nunca devuelve null. Esto permite mergear
 *     additivamente en cualquier respuesta sin romper consumidores.
 *   - Eventos con shape malo se ignoran silenciosamente (defensivo).
 *
 * Lo que NO hace:
 *   - No persiste nada. No tiene side-effects.
 *   - No llama a metricsService legacy.
 *   - No transforma eventos legacy de analytics_db.json.
 */

// ── Constantes ───────────────────────────────────────────────────────────────

const COMPLETION_THRESHOLD = 0.98;
const ACTIONS = {
    SESSION_START:     'session_start',
    SESSION_END:       'session_end',
    SESSION_HEARTBEAT: 'session_heartbeat',
    PROGRESS:          'progress',
    COMPLETED:         'completed',
    ERROR:             'error',
    AUDIO_PLAY:        'audio_play',
    AUDIO_PAUSE:       'audio_pause',
};

// Sprint Data Backbone 5A — clasificación native vs legacy.
//
// Cada evento puede declarar `payload._source ∈ { 'native', 'legacy' }`.
// `unknown` es lo que aparece para filas históricas pre-sprint.
//
// Para los cómputos combinados, "legacy" engloba "unknown" (las filas
// pre-sprint son inevitablemente del flujo viejo). La distinción fina
// entre legacy/unknown no aporta valor a quien consume métricas.
const SOURCE_NATIVE  = 'native';
const SOURCE_LEGACY  = 'legacy';
const SOURCE_UNKNOWN = 'unknown';

function getEventSource(event) {
    const s = event && event.payload && event.payload._source;
    return s === SOURCE_NATIVE || s === SOURCE_LEGACY ? s : SOURCE_UNKNOWN;
}

// Buckets binarios: 'native' o 'legacy' (unknown → legacy).
function bucketSource(source) {
    return source === SOURCE_NATIVE ? SOURCE_NATIVE : SOURCE_LEGACY;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function actionFromEventName(eventName) {
    if (typeof eventName !== 'string') return null;
    const dot = eventName.indexOf('.');
    return dot >= 0 ? eventName.slice(dot + 1) : eventName;
}

function isFiniteNumber(n) {
    return typeof n === 'number' && Number.isFinite(n);
}

function median(sortedAsc) {
    const len = sortedAsc.length;
    if (len === 0) return 0;
    if (len % 2 === 1) return sortedAsc[(len - 1) / 2];
    return Math.round((sortedAsc[len / 2 - 1] + sortedAsc[len / 2]) / 2);
}

// ── Reconstrucción de sesiones ───────────────────────────────────────────────
//
// Una sesión se identifica por `sessionId` (ULID). Cada sesión acumula:
//   - mode/userId/contentId (del primer evento)
//   - hasStart, hasEnd, hasHeartbeat
//   - elapsedAtEnd: elapsedMs del session_end (autoritativo si existe)
//   - lastHeartbeatElapsedMs: máximo elapsedMs visto en heartbeats
//   - finalProgressFraction: máximo progressFraction visto
//   - audioPlay / audioPause: contadores
//   - errorCount: número de eventos `*.error`

function parseBackboneSessions(events) {
    const map = new Map();

    for (const e of events) {
        if (!e || typeof e !== 'object') continue;
        const sid = e.sessionId;
        if (typeof sid !== 'string' || sid.length === 0) continue;

        let s = map.get(sid);
        if (!s) {
            s = {
                sessionId:               sid,
                mode:                    e.mode,
                userId:                  e.userId,
                contentId:               e.contentId ?? null,
                startTs:                 null,
                endTs:                   null,
                elapsedAtEnd:            null,
                lastHeartbeatElapsedMs:  0,
                hasStart:                false,
                hasEnd:                  false,
                hasHeartbeat:            false,
                audioPlay:               0,
                audioPause:              0,
                errorCount:              0,
                finalProgressFraction:   0,
                // Sprint 5A: source derivado de los eventos. Promoción:
                // unknown < legacy < native. Una sesión cuenta como native
                // si CUALQUIER evento de ella vino del endpoint v1.
                source:                  SOURCE_UNKNOWN,
            };
            map.set(sid, s);
        }

        // Promover source a la marca más fuerte vista hasta ahora.
        const evtSource = getEventSource(e);
        if (evtSource === SOURCE_NATIVE) s.source = SOURCE_NATIVE;
        else if (evtSource === SOURCE_LEGACY && s.source !== SOURCE_NATIVE) s.source = SOURCE_LEGACY;

        const action = actionFromEventName(e.event);
        if (!action) continue;

        if (isFiniteNumber(e.progressFraction) && e.progressFraction > s.finalProgressFraction) {
            s.finalProgressFraction = Math.min(1, Math.max(0, e.progressFraction));
        }

        switch (action) {
            case ACTIONS.SESSION_START:
                s.hasStart = true;
                if (isFiniteNumber(e.clientTs)) s.startTs = e.clientTs;
                break;
            case ACTIONS.SESSION_END:
                s.hasEnd = true;
                if (isFiniteNumber(e.clientTs)) s.endTs = e.clientTs;
                if (isFiniteNumber(e.elapsedMs)) s.elapsedAtEnd = e.elapsedMs;
                break;
            case ACTIONS.SESSION_HEARTBEAT:
                s.hasHeartbeat = true;
                if (isFiniteNumber(e.elapsedMs) && e.elapsedMs > s.lastHeartbeatElapsedMs) {
                    s.lastHeartbeatElapsedMs = e.elapsedMs;
                }
                break;
            case ACTIONS.AUDIO_PLAY:
                s.audioPlay += 1;
                break;
            case ACTIONS.AUDIO_PAUSE:
                s.audioPause += 1;
                break;
            case ACTIONS.ERROR:
                s.errorCount += 1;
                break;
            case ACTIONS.COMPLETED:
                s.finalProgressFraction = 1;
                break;
            default:
                // progress, navigation y otros — ya capturados en el chequeo de progressFraction.
                break;
        }
    }

    return [...map.values()];
}

// ── Bucketing utilities ──────────────────────────────────────────────────────

function bucketByMode(items, getMode) {
    const out = new Map();
    for (const it of items) {
        const mode = getMode ? getMode(it) : it.mode;
        if (typeof mode !== 'string' || mode.length === 0) continue;
        if (!out.has(mode)) out.set(mode, []);
        out.get(mode).push(it);
    }
    return out;
}

// ── Sprint 5A — preferencia de fuente por modo ───────────────────────────────
//
// Regla central anti-duplicación: si un modo ya tiene al menos una sesión
// nativa, las métricas combinadas se calculan SOLO con eventos/sesiones
// nativos. Si no hay nativas todavía, se usa el flujo legacy (que incluye
// las filas históricas pre-Sprint 5A marcadas como 'unknown').
//
// Esto evita que dual-write cuente cada sesión dos veces — uno desde el
// emisor legacy, otro desde el endpoint v1 — durante el período en que
// ambos sistemas coexistan.

function computePreferredByMode(sessions) {
    const out = new Map();
    const buckets = bucketByMode(sessions);
    for (const [mode, modeSessions] of buckets) {
        const hasNative = modeSessions.some(s => bucketSource(s.source) === SOURCE_NATIVE);
        out.set(mode, hasNative ? SOURCE_NATIVE : SOURCE_LEGACY);
    }
    return out;
}

function filterEventsByPreferred(events, preferredByMode) {
    return events.filter(e => {
        const pref = preferredByMode.get(e.mode) || SOURCE_LEGACY;
        return bucketSource(getEventSource(e)) === pref;
    });
}

function filterSessionsByPreferred(sessions, preferredByMode) {
    return sessions.filter(s => {
        const pref = preferredByMode.get(s.mode) || SOURCE_LEGACY;
        return bucketSource(s.source) === pref;
    });
}

// ── Cómputos por modo ────────────────────────────────────────────────────────

function computeUsageByMode(events) {
    const out = {};
    const buckets = bucketByMode(events);
    for (const [mode, modeEvents] of buckets) {
        let starts = 0, ends = 0, hbs = 0;
        const users    = new Set();
        const contents = new Set();
        for (const e of modeEvents) {
            const action = actionFromEventName(e.event);
            if (action === ACTIONS.SESSION_START)     starts += 1;
            if (action === ACTIONS.SESSION_END)       ends   += 1;
            if (action === ACTIONS.SESSION_HEARTBEAT) hbs    += 1;
            if (typeof e.userId    === 'string') users.add(e.userId);
            if (typeof e.contentId === 'string') contents.add(e.contentId);
        }
        out[mode] = {
            sessionStarts:  starts,
            sessionEnds:    ends,
            heartbeats:     hbs,
            activeUsers:    users.size,
            activeContents: contents.size,
        };
    }
    return out;
}

function computeReadingTimeByMode(sessions) {
    const out = {};
    const buckets = bucketByMode(sessions);
    for (const [mode, modeSessions] of buckets) {
        let totalMs                = 0;
        let completedSessions      = 0;
        let openSessionsEstimate   = 0;
        let estimatedFromHeartbeat = false;
        const durations = [];

        for (const s of modeSessions) {
            let durationMs = 0;
            if (s.hasEnd && isFiniteNumber(s.elapsedAtEnd) && s.elapsedAtEnd >= 0) {
                durationMs = s.elapsedAtEnd;
                completedSessions += 1;
            } else if (s.hasHeartbeat && s.lastHeartbeatElapsedMs > 0) {
                durationMs = s.lastHeartbeatElapsedMs;
                openSessionsEstimate += 1;
                estimatedFromHeartbeat = true;
            } else if (!s.hasEnd) {
                openSessionsEstimate += 1;
            }
            if (durationMs > 0) {
                totalMs += durationMs;
                durations.push(durationMs);
            }
        }

        durations.sort((a, b) => a - b);
        out[mode] = {
            totalElapsedMs:        totalMs,
            averageSessionMs:      durations.length > 0 ? Math.round(totalMs / durations.length) : 0,
            medianSessionMs:       median(durations),
            completedSessions,
            openSessionsEstimate,
            estimatedFromHeartbeat,
        };
    }
    return out;
}

function computeProgressByMode(sessions) {
    const out = {};
    const buckets = bucketByMode(sessions);
    for (const [mode, modeSessions] of buckets) {
        let sum = 0;
        let max = 0;
        let completed = 0;
        for (const s of modeSessions) {
            const p = s.finalProgressFraction || 0;
            sum += p;
            if (p > max) max = p;
            if (p >= COMPLETION_THRESHOLD) completed += 1;
        }
        out[mode] = {
            averageProgressFraction: modeSessions.length > 0 ? sum / modeSessions.length : 0,
            maxProgressFraction:     max,
            completedCount:          completed,
        };
    }
    return out;
}

function computeErrorsByMode(events) {
    const out = {};
    const errorEvents = events.filter(e => actionFromEventName(e.event) === ACTIONS.ERROR);
    const buckets = bucketByMode(errorEvents);
    for (const [mode, modeErrors] of buckets) {
        const errorTypes = {};
        const users = new Set();
        for (const e of modeErrors) {
            const t = (e.payload && typeof e.payload.errorType === 'string')
                ? e.payload.errorType
                : 'unknown';
            errorTypes[t] = (errorTypes[t] ?? 0) + 1;
            if (typeof e.userId === 'string') users.add(e.userId);
        }
        out[mode] = {
            errorCount:     modeErrors.length,
            errorTypes,
            affectedUsers:  users.size,
        };
    }
    return out;
}

function computeImmersiveAudio(sessions) {
    const immersive = sessions.filter(s => s.mode === 'immersive');
    let audioPlayCount  = 0;
    let audioPauseCount = 0;
    let audioSessions   = 0;
    for (const s of immersive) {
        audioPlayCount  += s.audioPlay;
        audioPauseCount += s.audioPause;
        if (s.audioPlay > 0) audioSessions += 1;
    }
    const totalActions = audioPlayCount + audioPauseCount;
    return {
        audioPlayCount,
        audioPauseCount,
        audioSessions,
        averagePlayPauseRatio: totalActions > 0 ? audioPlayCount / totalActions : 0,
    };
}

function computeA11yAdoption(sessions) {
    const a11ySessions = sessions.filter(s => s.mode === 'a11y');
    if (a11ySessions.length === 0) {
        return { users: 0, sessions: 0, avgProgress: 0, errorRate: 0 };
    }
    const users = new Set(a11ySessions.map(s => s.userId).filter(u => typeof u === 'string'));
    const progressSum = a11ySessions.reduce((sum, s) => sum + (s.finalProgressFraction || 0), 0);
    const errorsSum   = a11ySessions.reduce((sum, s) => sum + s.errorCount, 0);
    return {
        users:       users.size,
        sessions:    a11ySessions.length,
        avgProgress: progressSum / a11ySessions.length,
        errorRate:   errorsSum   / a11ySessions.length,
    };
}

function computeHeartbeatCoverage(sessions) {
    const out = {};
    const buckets = bucketByMode(sessions);
    for (const [mode, modeSessions] of buckets) {
        let withHb = 0;
        let withoutHb = 0;
        for (const s of modeSessions) {
            if (s.hasHeartbeat) withHb += 1;
            else                withoutHb += 1;
        }
        const total = withHb + withoutHb;
        out[mode] = {
            sessionsWithHeartbeat:    withHb,
            sessionsWithoutHeartbeat: withoutHb,
            coveragePercent:          total > 0 ? Math.round((withHb / total) * 1000) / 10 : 0,
        };
    }
    return out;
}

// ── Enrichers Sprint 5A ──────────────────────────────────────────────────────
//
// Inyectan campos por-modo de breakdown native/legacy sobre los outputs ya
// calculados, sin alterar los campos preexistentes. Operan sobre el conjunto
// completo de sesiones (no filtrado por preferred) — el breakdown reporta lo
// que hay en cada bucket, no lo "elegido".

function sessionDurationMs(s) {
    if (s.hasEnd && isFiniteNumber(s.elapsedAtEnd) && s.elapsedAtEnd >= 0) return s.elapsedAtEnd;
    if (s.hasHeartbeat && s.lastHeartbeatElapsedMs > 0)                    return s.lastHeartbeatElapsedMs;
    return 0;
}

function enrichUsageWithSourceBreakdown(usageByMode, allSessions) {
    const buckets = bucketByMode(allSessions);
    for (const [mode, modeSessions] of buckets) {
        let nativeSessions = 0;
        let legacySessions = 0;
        for (const s of modeSessions) {
            if (bucketSource(s.source) === SOURCE_NATIVE) nativeSessions += 1;
            else                                          legacySessions += 1;
        }
        if (!usageByMode[mode]) {
            // El preferred del modo descartó todos los eventos visibles —
            // creamos la entrada para que los breakdowns sean visibles.
            usageByMode[mode] = {
                sessionStarts:  0,
                sessionEnds:    0,
                heartbeats:     0,
                activeUsers:    0,
                activeContents: 0,
            };
        }
        usageByMode[mode].nativeSessions = nativeSessions;
        usageByMode[mode].legacySessions = legacySessions;
        usageByMode[mode].totalSessions  = nativeSessions + legacySessions;
    }
}

function enrichReadingTimeWithSourceBreakdown(readingTimeByMode, allSessions) {
    const buckets = bucketByMode(allSessions);
    for (const [mode, modeSessions] of buckets) {
        let nativeMs = 0;
        let legacyMs = 0;
        for (const s of modeSessions) {
            const ms = sessionDurationMs(s);
            if (bucketSource(s.source) === SOURCE_NATIVE) nativeMs += ms;
            else                                          legacyMs += ms;
        }
        if (!readingTimeByMode[mode]) {
            readingTimeByMode[mode] = {
                totalElapsedMs:        0,
                averageSessionMs:      0,
                medianSessionMs:       0,
                completedSessions:     0,
                openSessionsEstimate:  0,
                estimatedFromHeartbeat: false,
            };
        }
        readingTimeByMode[mode].nativeElapsedMs = nativeMs;
        readingTimeByMode[mode].legacyElapsedMs = legacyMs;
    }
}

// Resumen global por bucket. Se basa en el conjunto crudo (sin preferred).
function computeSourceBreakdown(events, sessions) {
    const out = {
        native: { totalEvents: 0, totalSessions: 0, totalElapsedMs: 0 },
        legacy: { totalEvents: 0, totalSessions: 0, totalElapsedMs: 0 },
    };
    for (const e of events) {
        const bucket = bucketSource(getEventSource(e));
        out[bucket].totalEvents += 1;
    }
    for (const s of sessions) {
        const bucket = bucketSource(s.source);
        out[bucket].totalSessions  += 1;
        out[bucket].totalElapsedMs += sessionDurationMs(s);
    }
    return out;
}

// ── API pública ──────────────────────────────────────────────────────────────

/**
 * Agrega un array de BackboneEvent a una estructura de métricas por modo.
 *
 * @param {Array<object>} events  - eventos parseados por eventsService.
 * @param {object}        meta    - { windowDays, windowFrom, windowTo }.
 * @returns {object} backboneMetrics shape.
 */
export function aggregateBackboneMetrics(events, meta = {}) {
    const safeEvents = Array.isArray(events) ? events : [];
    const sessions   = parseBackboneSessions(safeEvents);

    // Sprint 5A — los cómputos combinados usan eventos/sesiones del source
    // preferido por modo (native si existe, legacy/unknown si no). Los
    // breakdowns del bloque sourceBreakdown y los campos *Sessions/*ElapsedMs
    // por modo se calculan sobre el conjunto crudo.
    const preferredByMode  = computePreferredByMode(sessions);
    const filteredEvents   = filterEventsByPreferred(safeEvents, preferredByMode);
    const filteredSessions = filterSessionsByPreferred(sessions, preferredByMode);

    const usageByMode       = computeUsageByMode(filteredEvents);
    const readingTimeByMode = computeReadingTimeByMode(filteredSessions);
    enrichUsageWithSourceBreakdown(usageByMode, sessions);
    enrichReadingTimeWithSourceBreakdown(readingTimeByMode, sessions);

    return {
        generatedAt:        Date.now(),
        windowDays:         meta.windowDays ?? null,
        windowFrom:         meta.windowFrom ?? null,
        windowTo:           meta.windowTo   ?? null,
        totalEvents:        filteredEvents.length,
        totalSessions:      filteredSessions.length,
        usageByMode,
        readingTimeByMode,
        progressByMode:     computeProgressByMode(filteredSessions),
        errorsByMode:       computeErrorsByMode(filteredEvents),
        immersiveAudio:     computeImmersiveAudio(filteredSessions),
        a11yAdoption:       computeA11yAdoption(filteredSessions),
        heartbeatCoverage:  computeHeartbeatCoverage(filteredSessions),
        sourceBreakdown:    computeSourceBreakdown(safeEvents, sessions),
    };
}

/**
 * Devuelve un shape vacío válido — útil cuando events.db no existe o falla.
 * Permite que dashboards y endpoints usen el campo sin chequeos defensivos.
 */
export function emptyBackboneMetrics(meta = {}) {
    return {
        generatedAt:       Date.now(),
        windowDays:        meta.windowDays ?? null,
        windowFrom:        meta.windowFrom ?? null,
        windowTo:          meta.windowTo   ?? null,
        totalEvents:       0,
        totalSessions:     0,
        usageByMode:       {},
        readingTimeByMode: {},
        progressByMode:    {},
        errorsByMode:      {},
        immersiveAudio:    { audioPlayCount: 0, audioPauseCount: 0, audioSessions: 0, averagePlayPauseRatio: 0 },
        a11yAdoption:      { users: 0, sessions: 0, avgProgress: 0, errorRate: 0 },
        heartbeatCoverage: {},
        sourceBreakdown:   {
            native: { totalEvents: 0, totalSessions: 0, totalElapsedMs: 0 },
            legacy: { totalEvents: 0, totalSessions: 0, totalElapsedMs: 0 },
        },
    };
}
