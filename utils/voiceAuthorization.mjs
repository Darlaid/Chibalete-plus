/**
 * utils/voiceAuthorization.mjs — V8.1-PROD-02F (004 §6.3, decisión A5).
 *
 * El reconocimiento de voz del navegador envía la voz a su servicio. Solo puede abrirse el
 * micrófono con la A5 efectiva del lector, que decide el SERVIDOR (registro de decisiones) y
 * entrega `/api/auth/me` en `optionalProcessing.voiceTranscription`. Este módulo no decide nada:
 * solo pregunta y falla cerrado.
 *
 *   - isVoiceCaptureAllowed(): consulta sin caché antes de cada captura. Cualquier fallo
 *     (red, 401, respuesta sin el campo, JSON inválido) ⇒ false.
 *   - watchVoiceAuthorization(): mientras hay una captura abierta, vuelve a consultar cada
 *     `intervalMs`. Si la A5 deja de estar vigente (o no puede comprobarse), llama a `onRevoked`
 *     una sola vez y deja de vigilar.
 *
 * No pide ninguna autorización al usuario ni guarda estado propio: la decisión vive solo en el
 * servidor.
 */

/** Intervalo de nueva comprobación mientras el micrófono está abierto. */
export const VOICE_RECHECK_MS = 10000;

/**
 * @param {typeof fetch} [fetchImpl]
 * @returns {Promise<boolean>}
 */
export async function isVoiceCaptureAllowed(fetchImpl = globalThis.fetch) {
    try {
        const res = await fetchImpl('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' });
        if (!res || !res.ok) return false;
        const me = await res.json();
        return me?.optionalProcessing?.voiceTranscription === true;
    } catch {
        return false;
    }
}

/**
 * @param {{ onRevoked: () => void, check?: () => Promise<boolean>, intervalMs?: number,
 *           timers?: { setInterval: typeof setInterval, clearInterval: typeof clearInterval } }} opts
 * @returns {{ stop: () => void, checkNow: () => Promise<void> }}
 */
export function watchVoiceAuthorization({ onRevoked, check = isVoiceCaptureAllowed, intervalMs = VOICE_RECHECK_MS, timers = globalThis }) {
    let done = false;
    let inFlight = false;
    let id = null;
    const stop = () => {
        done = true;
        if (id !== null) { timers.clearInterval(id); id = null; }
    };
    const checkNow = async () => {
        if (done || inFlight) return;
        inFlight = true;
        let allowed = false;
        try { allowed = (await check()) === true; } catch { allowed = false; }
        inFlight = false;
        if (done || allowed) return;
        stop();
        onRevoked();
    };
    id = timers.setInterval(() => { void checkNow(); }, intervalMs);
    return { stop, checkNow };
}
