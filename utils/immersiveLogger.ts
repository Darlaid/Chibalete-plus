/**
 * Logger estructurado para el flujo del Visor Inmersivo.
 *
 * Objetivo: trazabilidad de auditoría para diagnosticar cualquier futura mutación
 * cross-contenido del visor sin redeploy. Los tags forman un catálogo cerrado
 * (tipo `ImmersiveLogTag`) para evitar typos y simplificar parsing posterior.
 *
 * Activación:
 *   - OFF por default en producción.
 *   - ON por default en dev (Vite `import.meta.env.DEV === true`).
 *   - Override runtime con localStorage.setItem('immersive_debug', '1' | '0').
 *     Esto permite a un operador habilitar logs en producción sin redeploy.
 *
 * No depende de React. No alloc en hot paths (early-return cuando deshabilitado).
 */

const ENABLED: boolean = (() => {
    try {
        if (typeof window === 'undefined') return false;
        const flag = window.localStorage.getItem('immersive_debug');
        if (flag === '1') return true;
        if (flag === '0') return false;
        return import.meta.env.DEV === true;
    } catch {
        return false;
    }
})();

export type ImmersiveLogTag =
    | 'IMMERSIVE_INIT'
    | 'ENGINE_START'
    | 'CONTENT_LOADED'
    | 'ANCHORS_404'
    | 'RAW_FALLBACK'
    | 'PLAY'
    | 'PROGRESS_RESTORE'
    | 'PROGRESS_SAVE'
    | 'BLOCK_COMPLETE_END_SESSION'
    | 'SESSION_END_FROM_AUDIO'
    | 'LEO_MEMORY_MIGRATED'
    | 'GUARD_STALE_ENGINE'
    | 'GUARD_STALE_PROGRESS'
    | 'CLEANUP'
    | 'FATAL_MISMATCH';

export function immersiveLog(
    tag: ImmersiveLogTag,
    data: Record<string, unknown> = {},
): void {
    if (!ENABLED) return;
    try {
        const ts = new Date().toISOString().slice(11, 23);
        // eslint-disable-next-line no-console
        console.log(`[IMM ${ts}][${tag}]`, data);
    } catch {
        /* defensive — un log roto nunca debe romper el visor */
    }
}
