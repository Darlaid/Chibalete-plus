/**
 * A11ySkipLinks — 4 enlaces de salto al inicio del documento accesible.
 *
 * Patrón canónico WCAG 2.4.1 (Bypass Blocks) y 2.4.13 (Focus Appearance):
 *   - Visualmente ocultos con sr-only por defecto.
 *   - Visibles al recibir foco (focus-visible) con alto contraste y posición fija.
 *   - Click/Enter mueve el foco programáticamente al target (cuyo id existe en
 *     A11yShell y tiene tabIndex=-1 para ser focuseable por programa).
 *
 * Por qué interceptamos el click:
 *   El proyecto usa HashRouter (App.tsx). Los href con # son interpretados como
 *   rutas hash, no como anclas DOM. Sin preventDefault, el navegador podría intentar
 *   navegar y dejar el foco en el body. La forma robusta es: preventDefault + focus()
 *   programático sobre el target. Esto también garantiza WCAG SC 2.4.13:
 *   el foco aterriza efectivamente en el destino y es visible.
 *
 * Por qué scrollIntoView sin behavior:
 *   En esta fase no leemos `prefers-reduced-motion`. Smooth-scroll puede causar
 *   mareo a usuarios con sensibilidad vestibular. Default sin animación es seguro.
 *   Fase 4 introducirá el respeto a motionPolicy.
 */

import React from 'react';

interface SkipTarget {
    id: string;
    label: string;
}

// POST-G1: solo destinos REALES. Los skip-links 'a11y-settings' y 'a11y-audio'
// fueron eliminados junto con sus landmarks vacíos. Cuando esas secciones
// vuelvan con contenido funcional, sus skip-links se reincorporan acá.
//
// 'a11y-controls' añadido cuando los controles se movieron de banner a
// sidebar derecha — el user de teclado/AT necesita una vía rápida para
// alcanzar Volver y los botones de navegación sin recorrer el TOC entero.
//
// 'a11y-toc-toggle' (en lugar del antiguo 'a11y-toc') — al integrar el TOC
// en sidebar como sección colapsable, el <nav id="a11y-toc"> solo existe
// cuando está expandido. El BOTÓN expandible (siempre presente) lleva el
// id del skip link, así el destino es estable. Si el TOC está colapsado,
// el user activa el botón con Enter.
const SKIP_TARGETS: ReadonlyArray<SkipTarget> = [
    { id: 'a11y-main',         label: 'Saltar al contenido' },
    { id: 'a11y-toc-toggle',   label: 'Saltar al índice' },
    { id: 'a11y-controls',     label: 'Saltar a controles de lectura' },
] as const;

/**
 * Nombre del CustomEvent que dispara el skip link "Saltar al índice".
 * La sidebar lo escucha y reacciona expandiendo el TOC + moviendo foco al
 * primer link (o al botón si no hay capítulos). Es un canal desacoplado:
 * SkipLinks no necesita conocer la sidebar ni viceversa.
 */
export const A11Y_REQUEST_TOC_EXPAND = 'a11y:request-toc-expand';

const A11ySkipLinks: React.FC = () => {
    const handleSkip = (
        event: React.MouseEvent<HTMLAnchorElement>,
        targetId: string,
    ) => {
        event.preventDefault();
        // Caso especial: "Saltar al índice" debe auto-expandir el TOC y
        // mover foco al primer link. La sidebar es la que maneja ese state
        // — disparamos un CustomEvent que ella escucha. El foco al botón
        // queda como fallback si no hay listener (escenarios donde la
        // sidebar no está montada).
        if (targetId === 'a11y-toc-toggle') {
            document.dispatchEvent(new CustomEvent(A11Y_REQUEST_TOC_EXPAND));
            // Si la sidebar atiende, ella hará foco al primer link tras
            // expandir; si no, caemos al focus default del botón.
        }
        const target = document.getElementById(targetId);
        if (!target) return;
        target.focus();
        target.scrollIntoView({ block: 'start' });
    };

    return (
        <nav aria-label="Enlaces de salto">
            <ul className="contents">
                {SKIP_TARGETS.map(({ id, label }) => (
                    <li key={id} className="contents">
                        <a
                            href={`#${id}`}
                            onClick={(e) => handleSkip(e, id)}
                            className={[
                                // Oculto por defecto, visible en foco
                                'sr-only',
                                'focus-visible:not-sr-only',
                                'focus:not-sr-only',
                                // Posición fija visible al recibir foco
                                'focus-visible:fixed focus-visible:top-2 focus-visible:left-2 focus-visible:z-[9999]',
                                'focus:fixed focus:top-2 focus:left-2 focus:z-[9999]',
                                // Estilo legible y de alto contraste
                                'focus-visible:bg-white focus-visible:text-black focus-visible:px-4 focus-visible:py-2',
                                'focus:bg-white focus:text-black focus:px-4 focus:py-2',
                                'focus-visible:rounded focus-visible:shadow-2xl focus-visible:font-semibold',
                                'focus:rounded focus:shadow-2xl focus:font-semibold',
                                // Outline propio garantizado (>3:1 contra fondo blanco)
                                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2',
                                'focus:outline focus:outline-2 focus:outline-blue-700 focus:outline-offset-2',
                            ].join(' ')}
                        >
                            {label}
                        </a>
                    </li>
                ))}
            </ul>
        </nav>
    );
};

export default A11ySkipLinks;
