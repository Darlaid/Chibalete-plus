/**
 * effectiveReadingTime.mjs — CHP-V6-INSIGHTS-PRODUCTION-01 / Continuación A2.
 *
 * Agregación del tiempo efectivo de lectura sobre filas de `events.db`.
 * Pura: no lee disco, no abre bases, no muta sus argumentos.
 *
 * EL PROBLEMA QUE RESUELVE
 * ------------------------
 * `tiempo_efectivo_lectura` sumaba el tiempo evento por evento. Pero **ningún
 * productor emite un delta**: todos mandan el acumulado desde el inicio de la
 * sesión. Verificado call-site por call-site:
 *
 *   analyticsService.startHeartbeat()  → `elapsedMs: Date.now() - sessionStart`
 *   VisorTexto.tsx:542  session_end    → `sessionDuration: Date.now() - sessionStart`
 *   VisorPDF.tsx:334    session_end    → idem
 *   VisorInmersivo.tsx:1059 session_end→ idem
 *   useA11yAnalytics.ts:374 session_end→ `elapsedMs: Date.now() - sessionStartTs`
 *   useA11yAnalytics.ts:356 progress   → idem (acumulado)
 *   registry canónico: `session_heartbeat {elapsedMs}` y `session_ended {totalMs}`
 *                      — ambos nombres denotan acumulado/total, no incremento.
 *
 * Sumar acumulados da crecimiento cuadrático: una sesión de 3 minutos con
 * heartbeats a 60/120/180 s se contaba como 6 minutos. Medido en producción,
 * la suma cruda de `elapsed_ms` de heartbeats y session_end da 4.061 horas
 * frente a las ~103 horas que resultan de quedarse con el máximo por sesión.
 *
 * LA REGLA (no es una heurística nueva)
 * -------------------------------------
 * Es la misma reconstrucción de sesiones que `server/metricsService.js` ya
 * usa desde siempre (`buildSessions`): recorrer los eventos en orden
 * cronológico por (usuario, contenido), abrir sesión al empezar a leer,
 * quedarse con el MEJOR acumulado conocido —«if session_end never arrives,
 * the last heartbeat provides a floor for durationMs»— y cerrarla con la
 * duración final. Aquí se aplica solo al eje temporal.
 *
 *   reading_started / session_started → cierra el tramo anterior, abre uno nuevo
 *   session_heartbeat                 → best = max(best, acumulado)
 *   session_ended                     → best = max(best, total); cierra el tramo
 *   fin de la ventana                 → cierra el tramo abierto
 *
 * POR QUÉ (usuario, contenido) Y NO `session_id`
 * ----------------------------------------------
 * `session_id` no es autoridad en este corpus: el dual-write legacy inventa
 * `legacy-<ulid>` por evento cuando el frontend no manda uno. Medido en
 * producción: los 621 `*.session_end` tienen 621 `session_id` distintos (1:1
 * con las filas, inservible para agrupar) y 507 de los 2.640 heartbeats llevan
 * un id sintético. Agrupar por `session_id` dejaría el total en 2.757 horas:
 * sigue siendo imposible. La clave (usuario, contenido) + segmentación por
 * evento de inicio/cierre es la que el repositorio ya demostró.
 *
 * Telemetría técnica (chunk_audio_*, sentence_time, pb_*) NO aporta tiempo:
 * solo cuentan los eventos de sesión.
 */

/** Nombres que abren un tramo de lectura. */
const OPENERS = new Set(['reading_started', 'session_started']);
/** Nombres que aportan un acumulado al tramo abierto. */
const TICKS   = new Set(['session_heartbeat']);
/** Nombres que cierran el tramo con su duración final. */
const CLOSERS = new Set(['session_ended']);
/** Únicos nombres lógicos que el cálculo consume; el resto se ignora. */
export const EFFECTIVE_READING_EVENT_NAMES = Object.freeze([...OPENERS, ...TICKS, ...CLOSERS]);

/**
 * Tiempo acumulado que declara una fila. Prioridad: payload.elapsedMs →
 * payload.totalMs → columna `elapsed_ms` (donde el dual-write legacy deja
 * `sessionDuration`). Devuelve 0 si no hay valor utilizable.
 */
export function accumulatedMsOf(row) {
    let v = 0;
    try {
        const p = JSON.parse(row?.payload_json || '{}');
        if (p && typeof p === 'object') {
            if (typeof p.elapsedMs === 'number' && p.elapsedMs > 0) v = p.elapsedMs;
            else if (typeof p.totalMs === 'number' && p.totalMs > 0) v = p.totalMs;
        }
    } catch { /* payload corrupto: cae a la columna */ }
    if (v > 0) return v;
    return (typeof row?.elapsed_ms === 'number' && row.elapsed_ms > 0) ? row.elapsed_ms : 0;
}

/**
 * Suma del tiempo efectivo de lectura de un usuario en una ventana.
 *
 * @param {Array<object>} rows    filas crudas de events.db, ya filtradas a la ventana.
 * @param {(row:object)=>string} nameOf  resuelve el nombre lógico (canónico o
 *                                normalizado desde legacy).
 * @returns {{ ms:number, sessions:number, longest_session_ms:number,
 *             events_considered:number, duplicates_skipped:number }}
 */
export function computeEffectiveReadingMs(rows, nameOf) {
    const list = Array.isArray(rows) ? rows : [];
    // Orden cronológico estable. No se muta el array del llamador.
    const ordered = list
        .map((row, i) => ({ row, i }))
        .sort((a, b) => (a.row.server_ts - b.row.server_ts) || (a.i - b.i))
        .map(x => x.row);

    const seenEventIds = new Set();
    /** @type {Map<string, {best:number, total:number}>} */
    const byContent = new Map();
    let considered = 0, duplicates = 0, sessions = 0, longest = 0;

    const bucket = (key) => {
        let b = byContent.get(key);
        // state: 'fresh' (aún sin tramo) | 'open' (tramo en curso) | 'closed'
        if (!b) { b = { best: 0, total: 0, state: 'fresh' }; byContent.set(key, b); }
        return b;
    };
    const close = (b) => {
        if (b.best > 0) {
            b.total += b.best;
            sessions++;
            if (b.best > longest) longest = b.best;
        }
        b.best = 0;
        b.state = 'closed';
    };

    for (const row of ordered) {
        const name = nameOf(row);
        if (!OPENERS.has(name) && !TICKS.has(name) && !CLOSERS.has(name)) continue;
        // Dedupe lógico: una misma fila reenviada no abre ni cierra dos veces.
        const eid = row?.event_id;
        if (typeof eid === 'string' && eid) {
            if (seenEventIds.has(eid)) { duplicates++; continue; }
            seenEventIds.add(eid);
        }
        considered++;
        const b = bucket(typeof row?.content_id === 'string' ? row.content_id : '');
        if (OPENERS.has(name)) { close(b); b.state = 'open'; continue; }
        // Cierre inmediatamente después de otro cierre = doble disparo de
        // session_end. Se ignora, igual que `metricsService.buildSessions`
        // ("ignore double-fire duplicates"): si no, volvería a sumar la sesión.
        // Un cierre sobre un bucket todavía 'fresh' SÍ cuenta: es la sesión que
        // empezó antes de la ventana y termina dentro de ella, y su `totalMs`
        // es la única evidencia que queda de ese tiempo.
        if (CLOSERS.has(name) && b.state === 'closed') continue;
        // Un heartbeat sin `session_start` previo evidencia lectura igualmente
        // (en el corpus legacy hay 2.640 heartbeats para 876 inicios): abre
        // tramo. Es conservador porque el tramo se resuelve por máximo.
        b.state = 'open';
        const acc = accumulatedMsOf(row);
        if (acc > b.best) b.best = acc;
        if (CLOSERS.has(name)) close(b);
    }
    for (const b of byContent.values()) close(b);

    let ms = 0;
    for (const b of byContent.values()) ms += b.total;
    return {
        ms,
        sessions,
        longest_session_ms: longest,
        events_considered: considered,
        duplicates_skipped: duplicates,
    };
}
