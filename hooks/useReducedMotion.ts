import { useEffect, useState } from 'react';

/**
 * useReducedMotion — Fase 4 Accessibility Experience.
 *
 * Hook que devuelve true si el usuario tiene activada la preferencia de
 * sistema `prefers-reduced-motion: reduce`. Permite a los componentes adaptar
 * sus animaciones (zoom, slide, fade) a algo respetuoso:
 *
 *   - true  → usar transición instantánea (`duration-0`) o omitir animation.
 *   - false → motion normal (cinemática, ease, easing asimétrico, etc.).
 *
 * SSR-safe: si `window` o `matchMedia` no están disponibles (Node tests,
 * server render), devuelve false (default permisivo). Defensive: cualquier
 * throw en la suscripción se aísla; el componente NO se rompe.
 *
 * Tailwind ya respeta `motion-reduce:` para classes responsive — este hook
 * complementa para JS-driven animations (camera zoom timings, framer-style
 * orchestration, sequencing de overlays).
 *
 * Uso:
 *   const reducedMotion = useReducedMotion();
 *   const cameraDuration = reducedMotion ? 0 : 400;
 *   const overlayOpacityStages = reducedMotion
 *     ? [{ opacity: 1, delay: 0 }]
 *     : [{ opacity: 0.5, delay: 50 }, { opacity: 0.8, delay: 80 }, { opacity: 1, delay: 130 }];
 */
export function useReducedMotion(): boolean {
    const [reduced, setReduced] = useState<boolean>(() => {
        try {
            if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
                return false;
            }
            return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        } catch {
            return false;
        }
    });

    useEffect(() => {
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
            return;
        }
        let mql: MediaQueryList | null = null;
        try {
            mql = window.matchMedia('(prefers-reduced-motion: reduce)');
        } catch {
            return;
        }
        if (!mql) return;
        // Sincronizar por si el initial state difiere.
        setReduced(mql.matches);

        // Compat: addEventListener moderno + addListener legacy (Safari < 14).
        const onChange = (e: MediaQueryListEvent | MediaQueryList) => {
            try { setReduced(e.matches); } catch { /* ignore */ }
        };
        try {
            if (typeof mql.addEventListener === 'function') {
                mql.addEventListener('change', onChange as EventListener);
                return () => {
                    try { mql!.removeEventListener('change', onChange as EventListener); } catch { /* ignore */ }
                };
            }
            // Legacy fallback (Safari <14, IE no soportado).
            // TS reconoce addListener/removeListener como deprecated en su lib
            // pero existen como método runtime real.
            const legacyMql = mql as MediaQueryList & {
                addListener?: (l: (e: MediaQueryListEvent) => void) => void;
                removeListener?: (l: (e: MediaQueryListEvent) => void) => void;
            };
            if (typeof legacyMql.addListener === 'function') {
                legacyMql.addListener(onChange);
                return () => {
                    try { legacyMql.removeListener?.(onChange); } catch { /* ignore */ }
                };
            }
        } catch { /* ignore subscription failure — keep initial state */ }
        return undefined;
    }, []);

    return reduced;
}

export default useReducedMotion;
