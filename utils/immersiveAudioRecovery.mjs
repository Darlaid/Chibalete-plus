/**
 * immersiveAudioRecovery.mjs — HF4A (Immersive Reader Frontend Resilience).
 *
 * Decisión PURA sobre la recuperabilidad de un fallo de audio en el Modo
 * Inmersivo. Extraída del hook (useImmersivePlayback) para ser unit-testeable:
 * el hook IMPORTA y USA estas mismas funciones, por lo que los tests ejercen
 * el código real de decisión, NO una simulación.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * PROBLEMA QUE RESUELVE (deuda HF4A confirmada en producción)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Una frase quedaba marcada como "Sin audio" de forma PERMANENTE cuando:
 *   1. la primera generación TTS tardaba más que el timeout frontend;
 *   2. el frontend abortaba / marcaba fallo (no_url) y añadía el key a
 *      audioFailedKeysRef;
 *   3. el backend completaba después y cacheaba el audio (HF4B-1);
 *   4. una petición posterior devolvía /api/tts HIT 200 con audio válido;
 *   5. el frontend SEGUÍA bloqueando porque el key permanecía en
 *      audioFailedKeysRef y pre_play_check emitía PB_AUDIO_UNRECOVERABLE.
 *
 * La regla central (clear-on-valid-url) sólo es segura para fallos
 * RECUPERABLES (sin URL / timeout / abort): un fallo de DECODE del blob
 * (NotSupportedError) no se cura porque "ahora hay una URL" — la URL puede
 * apuntar al mismo blob corrupto. Limpiar ciegamente esos fallos generaría un
 * loop sobre blob roto. Por eso clasificamos antes de limpiar y conservamos la
 * protección de audioRetriedKeysRef en el hook.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * CONTRATO
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * - RECUPERABLE: el fallo fue de OBTENCIÓN (red/latencia/cancelación). Si una
 *   re-petición devuelve una URL válida, la frase es reproducible → limpiar la
 *   marca.
 *     reasons: 'no_url', 'timeout', 'TimeoutError', 'abort', 'AbortError'
 *
 * - PERSISTENTE: el fallo fue de DECODE/REPRODUCCIÓN del blob. Tener una URL no
 *   garantiza que el blob decodifique. NO limpiar por "valid_url".
 *     reasons: 'decode', 'NotSupportedError', 'EncodingError'
 *
 * El hook sólo añade dos motivos a audioFailedKeysRef: 'no_url' (recuperable) y
 * 'NotSupportedError' (persistente, tras agotar el retry de audioRetriedKeysRef).
 * Los demás motivos están contemplados para robustez futura.
 */

/** @typedef {'recoverable'|'persistent'} AudioFailureClass */

/** Motivos cuyo fallo es de OBTENCIÓN → recuperable con una URL válida. */
export const RECOVERABLE_REASONS = Object.freeze([
    'no_url',
    'timeout',
    'TimeoutError',
    'abort',
    'AbortError',
]);

/** Motivos cuyo fallo es de DECODE del blob → NO curar por "valid_url". */
export const PERSISTENT_REASONS = Object.freeze([
    'decode',
    'NotSupportedError',
    'EncodingError',
]);

const _PERSISTENT = new Set(PERSISTENT_REASONS);
const _RECOVERABLE = new Set(RECOVERABLE_REASONS);

/**
 * Clasifica un motivo de fallo. Un motivo persistente conocido es 'persistent';
 * cualquier otro (incluyendo recuperables conocidos, null/undefined y motivos
 * desconocidos) se trata como 'recoverable'.
 *
 * Racional del default 'recoverable': los únicos fallos que el hook marca como
 * persistentes provienen explícitamente del path NotSupportedError. Un motivo
 * desconocido NO debería atrapar a una frase en estado terminal permanente
 * cuando hay una URL válida disponible — preferimos liberar y dejar que el
 * intento real (play()) vuelva a clasificar si el blob no decodifica.
 *
 * @param {string|null|undefined} reason
 * @returns {AudioFailureClass}
 */
export function classifyAudioFailure(reason) {
    if (reason == null) return 'recoverable';
    const r = String(reason);
    if (_PERSISTENT.has(r)) return 'persistent';
    return 'recoverable';
}

/**
 * @param {string|null|undefined} reason
 * @returns {boolean} true si el fallo es recuperable.
 */
export function isRecoverableFailure(reason) {
    return classifyAudioFailure(reason) === 'recoverable';
}

/**
 * @param {string|null|undefined} reason
 * @returns {boolean} true si el fallo es persistente (decode/NotSupported).
 */
export function isPersistentFailure(reason) {
    return classifyAudioFailure(reason) === 'persistent';
}

/**
 * REGLA CENTRAL — ¿debe limpiarse la marca de fallo de un índice?
 *
 * Sólo true cuando AMBAS condiciones se cumplen:
 *   - hay una URL válida disponible para ese índice (hasValidUrl), y
 *   - el fallo previo era recuperable (no_url / timeout / abort).
 *
 * Un fallo persistente NUNCA se limpia por tener URL — eso evita el loop sobre
 * blob corrupto (la URL puede ser el mismo blob que falló al decodificar).
 *
 * @param {string|null|undefined} reason  motivo del fallo previo registrado.
 * @param {boolean} hasValidUrl           ¿getAudioUrl devolvió una URL válida?
 * @returns {boolean}
 */
export function shouldClearFailure(reason, hasValidUrl) {
    if (!hasValidUrl) return false;
    return classifyAudioFailure(reason) === 'recoverable';
}

/**
 * Guard anti-loop para reintentos. Un fallo persistente sólo admite UN
 * reintento (el que ya consume audioRetriedKeysRef en el hook); una vez
 * agotado, no debe re-intentarse automáticamente. Los fallos recuperables
 * pueden reintentarse (acotados por gesto del usuario / fetch fresco).
 *
 * @param {string|null|undefined} reason
 * @param {boolean} alreadyRetried  ¿este índice ya consumió su retry?
 * @returns {boolean} true si un reintento adicional es admisible.
 */
export function canRetryAfterFailure(reason, alreadyRetried) {
    if (classifyAudioFailure(reason) === 'persistent') {
        return !alreadyRetried;
    }
    return true;
}

/**
 * @typedef {Object} RecoveryCoherence
 * @property {boolean} ok
 * @property {'coherent'|'stale_token'|'index_moved'|'session_completed'} reason
 */

/**
 * HF4A-R2 — REGLA RECTORA DE TRIPLE COHERENCIA.
 *
 * Un resultado tardío de getAudioUrl (o un reintento manual) SÓLO puede
 * limpiar el fallo, cambiar status, reproducir, avanzar o spawnear audio si las
 * TRES condiciones se cumplen en el momento exacto de actuar:
 *
 *   1. token/generación vigente   — la carga no fue invalidada por otra más nueva;
 *   2. índice solicitado === índice visual/current vigente — el usuario no navegó
 *      a otra frase mientras la petición estaba pendiente (cubre el hueco
 *      same-chunk de manualSentenceJump, que mueve currentIdxRef vía setIdx pero
 *      no incrementa loadToken);
 *   3. sesión NO completada — el overlay "Lectura Completada" no está activo.
 *
 * Decisión PURA para ser unit-testeable: el hook pasa sus refs como números/
 * booleanos y actúa según `ok`. El `reason` permite logs precisos
 * (PB_AUDIO_STALE_RESULT_DROPPED / PB_AUDIO_RETRY_SKIPPED_STALE_CONTEXT).
 *
 * El orden de chequeo es deliberado: token (lo más barato y frecuente) →
 * índice → completion.
 *
 * @param {Object} p
 * @param {number} p.requestedIndex  índice que la operación pretende reproducir/limpiar.
 * @param {number} p.currentIndex    currentIdxRef.current al momento de actuar.
 * @param {number} p.token           token capturado por la operación.
 * @param {number} p.currentToken    loadToken.current al momento de actuar.
 * @param {boolean} p.sessionCompleted  ¿la sesión llegó a "Lectura Completada"?
 * @returns {RecoveryCoherence}
 */
export function evaluateRecoveryCoherence({
    requestedIndex,
    currentIndex,
    token,
    currentToken,
    sessionCompleted,
}) {
    if (token !== currentToken)        return { ok: false, reason: 'stale_token' };
    if (requestedIndex !== currentIndex) return { ok: false, reason: 'index_moved' };
    if (sessionCompleted === true)     return { ok: false, reason: 'session_completed' };
    return { ok: true, reason: 'coherent' };
}
