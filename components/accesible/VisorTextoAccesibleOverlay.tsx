/**
 * VisorTextoAccesibleOverlay — Sprint Modo accesible (experiencia).
 *
 * Overlay accesible que se superpone al visor de texto SOLO cuando el
 * Modo accesible está activo. Su única responsabilidad es mostrar un
 * progreso visual tipo "nivel" en la parte inferior de la pantalla.
 *
 * Decisiones de diseño:
 *   - Cero acoplamiento con la lógica del visor: calcula su propio % de
 *     scroll (no toca analyticsProgressRef ni el sistema de progreso real).
 *   - Si el modo NO está activo, el componente devuelve null —
 *     comportamiento idéntico al visor sin Modo accesible.
 *   - Posición fixed bottom centrada, con margen para no chocar con el
 *     botón flotante de Leo (que vive bottom-right en el visor).
 *   - aria-live="polite" para que screen readers anuncien el avance sin
 *     interrumpir la lectura activa.
 *
 * Esto NO es una refactorización del visor — es una capa nueva opt-in.
 */
import React, { useEffect, useState } from 'react';
import { useModoAccesible } from '../../context/ModoAccesibleContext';
import { PixelReadingLevel } from './pixel/PixelReadingLevel';

export function VisorTextoAccesibleOverlay() {
    const { activo } = useModoAccesible();
    const [pct, setPct] = useState(0);

    useEffect(() => {
        if (!activo) return;
        const computePct = () => {
            const doc = document.documentElement;
            const scrollable = Math.max(1, doc.scrollHeight - doc.clientHeight);
            const next = Math.max(0, Math.min(100, (window.scrollY / scrollable) * 100));
            setPct(next);
        };
        computePct();
        window.addEventListener('scroll',  computePct, { passive: true });
        window.addEventListener('resize',  computePct);
        return () => {
            window.removeEventListener('scroll', computePct);
            window.removeEventListener('resize', computePct);
        };
    }, [activo]);

    if (!activo) return null;

    return (
        <div
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 w-[min(92vw,28rem)] pointer-events-none"
            aria-live="polite"
        >
            <PixelReadingLevel value={pct} blocks={10} />
        </div>
    );
}
