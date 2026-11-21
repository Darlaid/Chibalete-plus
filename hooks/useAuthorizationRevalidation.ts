/**
 * useAuthorizationRevalidation.ts — V9 BI-65C.
 *
 * Una pantalla de mediación abierta no se entera sola de que el servidor dejó de autorizar lo que muestra (se retiró la
 * autorización de un lector, el compromiso de quien media, o su asignación al curso). No hay canal de avisos del
 * servidor: la única fuente de verdad es volver a preguntar. Este gancho vuelve a ejecutar la consulta de la pantalla
 *   - al recuperar el foco de la ventana o volver a ser visible la pestaña,
 *   - al recuperar la conexión,
 *   - y cada REVALIDATE_INTERVAL_MS mientras la pestaña esté visible.
 * No es inmediato: entre la revocación y la siguiente consulta puede pasar hasta ese intervalo (o lo que la pestaña
 * tarde en volver a primer plano). Cada pantalla decide qué hace con la respuesta; la regla común es que un 401, 403
 * o 5xx RETIRA lo que había (una respuesta 200 anterior no sustituye a la autorización vigente).
 *
 * Solo presentación: no decide permisos. El servidor sigue siendo la autoridad en cada petición.
 */
import { useEffect, useRef } from 'react';

export const REVALIDATE_INTERVAL_MS = 60_000;
/** Foco y visibilidad suelen dispararse juntos: una sola consulta por ráfaga. */
export const REVALIDATE_MIN_GAP_MS = 5_000;
const RELOAD_MARK = 'chibalete_session_revalidated_at';

export function useAuthorizationRevalidation(revalidate: () => void, enabled: boolean = true): void {
    const latest = useRef(revalidate);
    latest.current = revalidate;
    useEffect(() => {
        if (!enabled || typeof window === 'undefined') return;
        let last = Date.now();
        const run = () => {
            if (document.visibilityState === 'hidden') return;
            const now = Date.now();
            if (now - last < REVALIDATE_MIN_GAP_MS) return;
            last = now;
            latest.current();
        };
        const timer = window.setInterval(run, REVALIDATE_INTERVAL_MS);
        window.addEventListener('focus', run);
        window.addEventListener('online', run);
        window.addEventListener('pageshow', run);
        document.addEventListener('visibilitychange', run);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('focus', run);
            window.removeEventListener('online', run);
            window.removeEventListener('pageshow', run);
            document.removeEventListener('visibilitychange', run);
        };
    }, [enabled]);
}

/**
 * La sesión de ESTA pestaña puede haber cambiado sin que la página lo sepa (otra pestaña cerró sesión o entró con otra
 * cuenta; la administración cambió el rol). Pregunta al servidor quién es la sesión vigente (`GET /api/auth/me`, la
 * misma consulta con la que arranca la aplicación) y, si ya no es la cuenta con la que se cargó la pantalla o cambió
 * su rol, recarga la página: el arranque normal resuelve la sesión real y descarta todo lo que había en memoria.
 * Sin respuesta o con un fallo del servidor no hace nada (no confirma ni desmiente).
 */
export function useSessionRevalidation(user: { id: string; roles?: string[] } | null | undefined): void {
    const busy = useRef(false);
    useAuthorizationRevalidation(() => {
        if (!user?.id || busy.current) return;
        busy.current = true;
        fetch('/api/auth/me', { credentials: 'same-origin', cache: 'no-store' })
            .then(async (res) => {
                if (res.status === 401) return true;
                if (!res.ok) return false;
                const me = await res.json().catch(() => null);
                if (!me || typeof me.id !== 'string') return false;
                const roles = (r: unknown) => (Array.isArray(r) ? [...r].sort().join(',') : '');
                return me.id !== user.id || (Array.isArray(me.roles) && roles(me.roles) !== roles(user.roles));
            })
            .then((changed) => {
                if (!changed) return;
                try {
                    // Una sola recarga por minuto: si el arranque no resolviera la diferencia, no se entra en bucle.
                    const at = Number(sessionStorage.getItem(RELOAD_MARK) || 0);
                    if (Date.now() - at < REVALIDATE_INTERVAL_MS) return;
                    sessionStorage.setItem(RELOAD_MARK, String(Date.now()));
                    // El id local solo etiqueta la sesión; se quita para que el arranque pregunte por la cookie vigente.
                    sessionStorage.removeItem('chibalete_user_id');
                    localStorage.removeItem('chibalete_user_id');
                    // V9 BI-65C-S: las copias locales de Aula Viva de la cuenta anterior tampoco sobreviven a la recarga.
                    const doomed: string[] = [];
                    for (let i = 0; i < localStorage.length; i++) {
                        const k = localStorage.key(i);
                        if (k && k.startsWith('chibalete:aulaviva')) doomed.push(k);
                    }
                    doomed.forEach((k) => localStorage.removeItem(k));
                } catch { /* almacenamiento bloqueado: se recarga igual */ }
                window.location.reload();
            })
            .catch(() => { /* sin respuesta: no se concluye nada */ })
            .finally(() => { busy.current = false; });
    }, !!user?.id);
}
