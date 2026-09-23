/**
 * legacyEventNormalizer.mjs — CHP-V6-INSIGHTS-PRODUCTION-01 / Continuación A1.
 *
 * Traduce el NOMBRE LÓGICO de los eventos legacy de `events.db` al vocabulario
 * canónico que `signalCompute` ya comprende. Nada más.
 *
 * POR QUÉ EXISTE
 * --------------
 * `events.db` es inmutable y contiene 19.985 filas legacy con la forma
 * `<modo>.<acción>`, producidas por `legacyEventNameToBackbone(mode, event)`
 * en el dual-write de `POST /api/analytics/events`. `signalCompute` compara
 * `e.event === 'reading_started'` con igualdad exacta, así que esas filas eran
 * invisibles: 16.130 eventos históricos de un colegio real no alimentaban
 * ninguna señal. Este módulo cierra esa brecha SIN tocar el store.
 *
 * ROL DESDE CHP-V6-READING-CANONICAL-PRODUCER-01: COMPATIBILIDAD HISTÓRICA.
 * Desde el cutover las lecturas nuevas se persisten ya con su nombre del
 * registry v2 (`readingCanonical.mjs`, que reutiliza ESTA tabla en el ingreso);
 * sobre un nombre canónico esta función es identidad, así que no hay doble
 * traducción. Aquí solo quedan por traducir las filas anteriores al cutover.
 *
 * CONTRATO
 * --------
 *   - Función PURA. No lee disco, no abre bases, no muta su argumento.
 *   - Traduce ÚNICAMENTE el nombre lógico. `event_id`, `server_ts`, `user_id`,
 *     `session_id`, `content_id`, `elapsed_ms` y `payload_json` quedan intactos:
 *     el llamador sigue leyendo la fila original.
 *   - Tabla EXPLÍCITA, entrada por entrada. PROHIBIDO derivar el nombre con
 *     `split('.')` o quitando el prefijo: `session_start` NO es
 *     `session_started` y `session_end` NO es `session_ended` — son cadenas
 *     distintas — y, sobre todo, `lu.session_start` NO es una sesión de
 *     lectura (es telemetría de distribución de la app: el 100 % de sus filas
 *     no tiene `content_id`). Una regla genérica lo contaría como lectura.
 *   - Un nombre canónico se devuelve tal cual (identidad).
 *   - Un legacy sin equivalencia demostrada se devuelve tal cual, y por tanto
 *     sigue siendo invisible para las señales. Eso es deliberado: no se
 *     inventa significado pedagógico para subir cobertura.
 *
 * EVIDENCIA DE EQUIVALENCIA (call-sites, no conjeturas)
 * ----------------------------------------------------
 *   `<modo>.session_start`     ← `analyticsService.track({event:'session_start'})`
 *        disparado UNA vez por contenido abierto en un visor
 *        (`VisorTexto.tsx:388`, `VisorPDF.tsx:183`, `VisorInmersivo.tsx:1522`).
 *        La fila lleva `content_id`, `session_id` y el modo en el nombre →
 *        es exactamente `reading_started {contentId, mode, sessionId, startedAt}`.
 *        Verificado en producción: 816 filas, 0 sin `content_id`.
 *   `<modo>.session_end`       ← `VisorTexto.tsx:542`, `VisorPDF.tsx:334`,
 *        `VisorInmersivo.tsx:340/387/1059`, `useA11yAnalytics`. Cierre de la
 *        sesión de lectura (unmount / cierre duro). NO implica terminación del
 *        contenido, así que NO se mapea a `reading_completed` ni a
 *        `reading_abandoned`: se mapea a `session_ended`.
 *   `<modo>.session_heartbeat` ← `analyticsService.startHeartbeat()`, cada 60 s
 *        con `elapsedMs`. Semántica idéntica a `session_heartbeat`.
 *   `<modo>.progress`          ← avance dentro del contenido
 *        (`useA11yAnalytics.ts:356` emite al ver un párrafo nuevo ≥60 %;
 *        `VisorAlbum.tsx:604` y `VisorPDF.tsx:312` en paralelo al save legacy).
 *   `<modo>.block_complete`    ← cruce de umbral 25/50/75/100 % de avance
 *        (`VisorTexto.tsx:520`, `VisorInmersivo.tsx:1167`) → `reading_progress`.
 *   `immersive.session_completed` ← `useImmersivePlayback.ts:2796`, emitido al
 *        agotar las oraciones del contenido → `reading_completed`.
 *   `text.album_completed`     ← contenido álbum terminado → `reading_completed`.
 *
 * `tiempo_efectivo_lectura` funciona sobre estas filas porque `signalCompute`
 * ya cae a la columna `elapsed_ms` cuando el payload no trae `elapsedMs`; el
 * dual-write legacy mueve ese valor del payload a la columna. Medido en
 * producción: el 100 % de los `*.session_end` y `*.session_heartbeat` de modos
 * de lectura trae `elapsed_ms > 0`.
 */

/** Modos de lectura reales del producto. `lu` NO está aquí a propósito. */
const READING_MODES = Object.freeze(['immersive', 'text', 'pdf', 'album', 'a11y']);

/**
 * Sufijo legacy → evento canónico, para los modos de lectura.
 * Cada entrada se expande a `<modo>.<sufijo>` en LEGACY_EVENT_MAP.
 */
const READING_SUFFIX_MAP = Object.freeze({
    session_start:     'reading_started',
    session_end:       'session_ended',
    session_heartbeat: 'session_heartbeat',
    progress:          'reading_progress',
    block_complete:    'reading_progress',
});

/** Equivalencias que solo aplican a un modo concreto. */
const EXPLICIT_MAP = Object.freeze({
    'immersive.session_completed': 'reading_completed',
    'text.album_completed':        'reading_completed',
});

/**
 * Tabla completa y explícita legacy → canónico. Congelada.
 * Se construye por producto cartesiano de modos × sufijos, pero el resultado
 * es una tabla enumerada: `normalizeEventForSignals` NUNCA parsea el nombre.
 */
export const LEGACY_EVENT_MAP = Object.freeze(Object.assign(
    Object.create(null),
    ...READING_MODES.flatMap(mode =>
        Object.entries(READING_SUFFIX_MAP).map(([suffix, canonical]) => ({
            [`${mode}.${suffix}`]: canonical,
        }))),
    EXPLICIT_MAP,
));

/**
 * Familias legacy DELIBERADAMENTE no mapeadas, con su razón. Documental: el
 * normalizador no la consulta (todo lo ausente de LEGACY_EVENT_MAP se ignora),
 * pero deja por escrito que la omisión es una decisión, no un olvido.
 */
export const IGNORED_BY_DESIGN = Object.freeze({
    'lu.*':                                'telemetría de distribución de la app Lector Único (descarga, versión, ayuda offline). 100 % de sus filas SIN content_id: no es lectura.',
    'pdf.page_change':                     'se emite en el MISMO call-site que pdf.progress (VisorPDF.tsx:301/312). Mapear ambos duplicaría el avance.',
    'immersive.sentence_*':                'telemetría técnica de reproducción (tiempos, ritmo, saltos), no hechos pedagógicos.',
    'immersive.audio_*':                   'internals del reproductor de audio.',
    'immersive.playback_paused':           'internals del reproductor.',
    'immersive.pb_*':                      'diagnóstico del pipeline de audio (preparing, delayed, stale, retry, unrecoverable, jumps).',
    'immersive.chunk_audio_*':             'caché de audio por chunk; técnico.',
    'immersive.blob_invalid':              'error técnico de blob.',
    'immersive.tts_fail':                  'error técnico de TTS.',
    'immersive.load_cancelled':            'cancelación técnica de carga.',
    'immersive.level_up':                  'gamificación, no lectura.',
    'immersive.streak_break':              'gamificación, no lectura.',
    'immersive.transition_to_next_content': 'la terminación ya la cubre immersive.session_completed; mapear ambos duplicaría completions.',
    'text.leo_interaction':                'marcador legacy genérico de Leo; el ciclo canónico es leo_interaction_started/completed. Fuera del alcance de lectura de esta unidad.',
});

/**
 * Devuelve el nombre lógico con el que `signalCompute` debe comparar esta fila.
 *
 * @param {string|null|undefined} eventName  valor crudo de la columna `event`.
 * @returns {string} nombre canónico si hay equivalencia demostrada; si no, el
 *                   mismo nombre recibido (canónico → identidad; legacy sin
 *                   equivalencia → sigue sin consumirse).
 */
export function normalizeEventForSignals(eventName) {
    if (typeof eventName !== 'string' || eventName === '') return eventName;
    const mapped = LEGACY_EVENT_MAP[eventName];
    return mapped === undefined ? eventName : mapped;
}

/** true si el nombre recibido tiene una equivalencia legacy declarada. */
export function isNormalizedLegacyEvent(eventName) {
    return typeof eventName === 'string' && LEGACY_EVENT_MAP[eventName] !== undefined;
}
