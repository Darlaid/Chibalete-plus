/**
 * immersiveSession.js — SessionKey + guards anti-stale del Visor Inmersivo.
 *
 * Materializa las INVARIANTES 1, 3 y 4 de docs/immersive-mode-invariants.md:
 *   - La URL gobierna el contentId activo (INV-1).
 *   - La sesión se define por (userId, contentId) (INV-3).
 *   - Todo callback async valida sesión activa antes de mutar estado (INV-4).
 *
 * Funciones puras, sin React. Importable desde tests y desde código de runtime.
 */

// ───────────────────────────────────────────────────────────────────────────
// sessionKey
// ───────────────────────────────────────────────────────────────────────────

/**
 * Compone la sessionKey canónica del visor inmersivo. NO incluir aquí
 * timestamps, tokens ni nada efímero — la sessionKey identifica la
 * sesión lógica del par (usuario, libro), no un mount específico.
 *
 * @param {string|undefined|null} userId
 * @param {string|undefined|null} contentId
 * @returns {string}
 */
export function buildSessionKey(userId, contentId) {
    const u = userId ?? 'guest';
    const c = contentId ?? 'unknown';
    return `${u}__${c}`;
}

/**
 * Compone la clave namespaced de almacenamiento para una subcategoría
 * del visor inmersivo. INVARIANTE 3 — claves prohibidas son las que
 * NO incluyen userId ni contentId.
 *
 * Ejemplos válidos:
 *   immersive:user-1:content-A:progress
 *   immersive:user-1:content-A:leo_session
 *
 * @param {string|undefined} userId
 * @param {string|undefined} contentId
 * @param {string} subKey   "progress" | "playback" | "leo_session" | "audio_cache_meta"
 * @returns {string}
 */
export function buildNamespacedStorageKey(userId, contentId, subKey) {
    const u = userId ?? 'guest';
    const c = contentId ?? 'unknown';
    return `immersive:${u}:${c}:${subKey}`;
}

/**
 * Patrones de claves PROHIBIDAS — usados por el lint estático y por
 * el detector runtime en dev. Una clave matcheada por estos patrones
 * indica una regresión potencial: storage global sin namespacing.
 */
export const FORBIDDEN_STORAGE_KEY_PATTERNS = Object.freeze([
    /^immersiveProgress$/,
    /^currentContent$/,
    /^activeBook$/,
    /^lastPlayback$/,
    /^currentSentenceIndex$/,
    /^playbackState$/,
    /^selectedContent$/,
    /^lastReadContent$/,
    /^leo_session_content-[^_]+$/, // legacy: leo_session_<contentId> sin userId
]);

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isForbiddenStorageKey(key) {
    return FORBIDDEN_STORAGE_KEY_PATTERNS.some(rx => rx.test(key));
}

// ───────────────────────────────────────────────────────────────────────────
// Session guards — INVARIANTE 4
// ───────────────────────────────────────────────────────────────────────────

/**
 * Resultado de la validación de sesión activa. NUNCA se lanza error en
 * producción — se devuelve false y se espera que el caller no mute estado.
 */

/**
 * Verifica que un callback async pueda mutar estado: el contentId y
 * sessionKey con los que el callback fue armado deben seguir siendo los
 * activos en el visor, y no debe haber abort/unmount.
 *
 * En desarrollo (`isDev: true`) puede lanzar para que tests fallen en
 * regresión. En producción siempre retorna false silenciosamente y el
 * caller debe abstenerse de mutar.
 *
 * @param {object} params
 * @param {string} params.source              Etiqueta del callback (para logs).
 * @param {string} params.sourceContentId     contentId capturado cuando el callback se armó.
 * @param {string} params.sourceSessionKey    sessionKey capturada cuando el callback se armó.
 * @param {string} params.routeContentId      contentId actual de la URL.
 * @param {string} params.activeContentId     contentId activo del visor (ref).
 * @param {string} params.activeSessionKey    sessionKey activa del visor (ref).
 * @param {boolean} [params.aborted=false]    true si AbortSignal.aborted.
 * @param {boolean} [params.unmounted=false]  true si el componente se desmontó.
 * @param {boolean} [params.isDev=false]      true en NODE_ENV=development o tests.
 * @returns {{ok: boolean, reason: string}}
 */
export function assertImmersiveSessionActive({
    source,
    sourceContentId,
    sourceSessionKey,
    routeContentId,
    activeContentId,
    activeSessionKey,
    aborted = false,
    unmounted = false,
    isDev = false,
}) {
    if (unmounted) {
        const reason = `${source}_unmounted`;
        if (isDev) throw new Error(`[IMMERSIVE_GUARD] ${reason}`);
        return { ok: false, reason };
    }
    if (aborted) {
        const reason = `${source}_aborted`;
        if (isDev) throw new Error(`[IMMERSIVE_GUARD] ${reason}`);
        return { ok: false, reason };
    }
    if (sourceContentId !== activeContentId) {
        const reason = `${source}_content_mismatch_source=${sourceContentId}_active=${activeContentId}`;
        if (isDev) throw new Error(`[IMMERSIVE_GUARD] ${reason}`);
        return { ok: false, reason };
    }
    if (sourceSessionKey !== activeSessionKey) {
        const reason = `${source}_session_mismatch`;
        if (isDev) throw new Error(`[IMMERSIVE_GUARD] ${reason}`);
        return { ok: false, reason };
    }
    if (routeContentId && routeContentId !== activeContentId) {
        // INV-1: routeContentId es fuente de verdad. Si el visor "activeContentId"
        // diverge de la ruta, eso es un bug del propio visor — log fatal en dev.
        const reason = `${source}_route_active_divergence_route=${routeContentId}_active=${activeContentId}`;
        if (isDev) throw new Error(`[IMMERSIVE_FATAL_MISMATCH] ${reason}`);
        return { ok: false, reason };
    }
    return { ok: true, reason: 'active' };
}
