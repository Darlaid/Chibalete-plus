/**
 * clientEditorialStorage.ts — CHP-CONTENT-PROTECTION-2026-01 CP-3 (R7).
 *
 * Stores del navegador que Chibalete+ controla y que pueden contener contenido
 * editorial o localizadores de sus bytes. Se vacían al cerrar sesión: en los
 * equipos compartidos de un colegio, el siguiente usuario no debe heredarlos.
 *
 *   chibalete_offline_texto  texto íntegro del último libro de Guiado (ya no
 *                            se escribe desde CP-3; se purga lo heredado)
 *   chibalete_content        catálogo cacheado (con las URLs de los títulos
 *                            autorizados del usuario que salió)
 *   gemini_cache_*           respuestas de IA con fragmentos del texto
 *   leo_session_* / leo-chat-*  (sessionStorage) memoria y chat de Leo
 *
 * Preferencias (tema, accesibilidad), la cola de progreso pendiente y demás
 * claves no editoriales se conservan.
 */
import { clearOfflineText } from './offlineTextCache';

const LOCAL_KEYS = ['chibalete_content'];
const LOCAL_PREFIXES = ['gemini_cache_'];
const SESSION_PREFIXES = ['leo_session_', 'leo-chat-'];

function removeMatching(storage: Storage, keys: string[], prefixes: string[]): void {
    const doomed: string[] = [];
    for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && (keys.includes(k) || prefixes.some(p => k.startsWith(p)))) doomed.push(k);
    }
    doomed.forEach(k => storage.removeItem(k));
}

/** Borra los stores editoriales conocidos. Nunca lanza. */
export function clearEditorialClientStorage(): void {
    clearOfflineText();
    try { removeMatching(localStorage, LOCAL_KEYS, LOCAL_PREFIXES); } catch { /* storage no disponible */ }
    try { removeMatching(sessionStorage, [], SESSION_PREFIXES); } catch { /* storage no disponible */ }
}
