/**
 * mediaBaseUrl.js — M3.1
 *
 * Helper centralizado para resolver URLs de media (/uploads/*) a través de CDN.
 *
 * Espejo del backend `resolveMediaUrl` en server.js. Misma semántica:
 *  - Si MEDIA_BASE_URL está vacío/null → URL relativa pasa intacta (default).
 *  - Si está set → prefijar paths /uploads/* con la base CDN.
 *  - URLs absolutas (http://...) pasan intactas.
 *
 * Bootstrap: `initMediaBaseUrl()` llamado UNA VEZ desde index.tsx antes del
 * render. Fire-and-forget: si falla, queda en default (relative). Nunca
 * bloquea el arranque de la app.
 *
 * Archivo es .js (no .ts) deliberadamente: lo importan tanto módulos TS
 * (vía Vite) como módulos .mjs (vía node tests). Ambos resuelven .js sin
 * fricción. Las definiciones de tipos están en mediaBaseUrl.d.ts.
 */

let _mediaBaseUrl = '';
let _initialized = false;
let _initPromise = null;

/**
 * Bootstrap: fetch /api/runtime-config y guarda mediaBaseUrl si está disponible.
 * Idempotente — múltiples llamadas devuelven el mismo Promise.
 * Nunca lanza — si falla, queda en default (relative URLs).
 */
export function initMediaBaseUrl() {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        try {
            if (typeof fetch !== 'function') return;
            const res = await fetch('/api/runtime-config', {
                method: 'GET',
                credentials: 'omit',
                cache: 'no-store',
            });
            if (!res.ok) return;
            const cfg = await res.json();
            if (cfg && typeof cfg.mediaBaseUrl === 'string' && cfg.mediaBaseUrl.length > 0) {
                _mediaBaseUrl = cfg.mediaBaseUrl.replace(/\/+$/, '');
            }
        } catch {
            // Default: relative URLs work via VPS edge — fail silent.
        } finally {
            _initialized = true;
        }
    })();
    return _initPromise;
}

/**
 * Resuelve un path/URL de media. Espejo de server.js resolveMediaUrl.
 */
export function resolveMediaUrl(u) {
    if (!u || typeof u !== 'string') return u;
    if (/^https?:\/\//i.test(u)) return u;
    if (!_mediaBaseUrl) return u;
    if (u.startsWith('/uploads/')) return _mediaBaseUrl + u;
    return u;
}

/**
 * Útil para construir URLs cuando el path no empieza con /uploads/
 * (e.g., manifest interno devuelve `audio/...` sin slash inicial).
 */
export function uploadsUrl(relativePath) {
    if (!relativePath || typeof relativePath !== 'string') return relativePath;
    if (/^https?:\/\//i.test(relativePath)) return relativePath;
    const normalized = relativePath.startsWith('/')
        ? relativePath
        : '/uploads/' + relativePath.replace(/^uploads\//, '');
    return resolveMediaUrl(normalized);
}

/** Estado del bootstrap — útil para diagnóstico/tests */
export function getMediaBaseUrlInfo() {
    return {
        initialized: _initialized,
        baseUrl: _mediaBaseUrl,
        cdnActive: _mediaBaseUrl.length > 0,
    };
}

/** Forzar valor — solo para tests/dev. NO usar en producción runtime. */
export function _setMediaBaseUrlForTests(url) {
    _mediaBaseUrl = (typeof url === 'string') ? url.replace(/\/+$/, '') : '';
    _initialized = true;
}

/** Reset para tests — NO usar en producción */
export function _resetForTests() {
    _mediaBaseUrl = '';
    _initialized = false;
    _initPromise = null;
}
