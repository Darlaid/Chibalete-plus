/**
 * A11yFocusRuleOverlay — Sprint UX-3A.
 *
 * Implementación REAL de la Regla focal del Modo accesible. Sustituye al
 * sistema previo paragraph-based (.a11y-focus-primary/secondary +
 * opacity-tweak) que se sentía como "highlight leve de lectura". Aquí
 * convertimos la herramienta en un VIEWPORT BAND clásico de reading-ruler:
 * dos backdrops semi-transparentes anclados al viewport y una ventana
 * focal en el medio donde el contenido conserva contraste AA completo.
 *
 *     ┌──────────────────────────────┐  ← top de viewport
 *     │                              │
 *     │   ░░░░░ topBackdrop ░░░░░░   │  rgba(255,255,255,.65) light
 *     │                              │  rgba(15,23,42,.65)    dark
 *     ├──────────────────────────────┤
 *     │                              │
 *     │     focusWindow              │  ← gap sin veil — contenido pasa
 *     │     ~3 líneas (clamp)        │    a contraste completo
 *     │                              │
 *     ├──────────────────────────────┤
 *     │                              │
 *     │   ░░░░░ bottomBackdrop ░░░   │
 *     │                              │
 *     └──────────────────────────────┘  ← bottom de viewport
 *
 * Decisiones técnicas:
 *
 *   1. Tres `<div>` `position: fixed` con `pointer-events: none`. Los
 *      clicks/touches/selección de texto pasan limpios al article que
 *      vive debajo. No hay JS de scroll-sync ni listeners — el browser
 *      ya recompone capas en GPU al hacer scroll. Repaint cero.
 *
 *   2. Activación vía data-attribute en el shell ancestro:
 *        [data-a11y-shell-root][data-a11y-focus-rule="on"]
 *      Cuando off, los backdrops permanecen montados pero con opacity 0
 *      → el toggle es una transición opacity 120ms linear (suave, sin
 *      jitter, exactamente como pide el spec).
 *
 *   3. Los veils NO son negros agresivos. Light usa blanco al 65%
 *      (silenciamiento blando), dark usa slate-900 al 65% (mismo efecto
 *      en oscuro). El contenido debajo conserva legibilidad mínima
 *      WCAG AA — sólo pierde prioridad visual, no desaparece. Esto evita
 *      el patrón "spotlight gamer / máscara teatral" que el spec rechaza.
 *
 *   4. Altura de la ventana focal:
 *        clamp(5rem, 18vh, 9rem)
 *      ≈ 3-5 líneas de lectura según viewport y font-size del usuario.
 *      Se ajusta solo en mobile (claustrofobia controlada — el usuario
 *      ve mucho más que sólo la ventana porque el veil es traslúcido,
 *      no opaco).
 *
 *   5. Centrada vertical (`50vh ± window/2`). No "tracking hiperactivo":
 *      la ventana NO se mueve siguiendo párrafo activo — eso fragmenta
 *      la atención. Se queda fija; el contenido scrollea a través.
 *      `useA11yReaderNavigation` ya hace `scrollIntoView({block:'center'})`
 *      en prev/next, lo que aterriza el párrafo objetivo dentro de la
 *      ventana naturalmente.
 *
 *   6. z-index 10:
 *        - article p: z-auto = 0      → backdrop lo cubre ✓
 *        - header con z-20             → backdrop NO lo cubre ✓
 *        - sidebar mobile con z-30     → backdrop NO la cubre ✓
 *        - skip-links focused z-9999   → quedan arriba ✓
 *
 * Accesibilidad:
 *   - aria-hidden="true" en los tres divs: son decoración visual, AT
 *     no debe anunciarlos.
 *   - pointer-events: none: navegación con teclado, foco programático
 *     y selección de texto NO se ven afectados.
 *   - El article subyacente conserva su DOM y árbol AT íntegros — esta
 *     herramienta es para reducir carga cognitiva visual, no para
 *     ocultar contenido. EPUB Accessibility 1.1 / EN 301 549 / WCAG 2.2
 *     siguen cumpliéndose.
 *
 * NO hace:
 *   ❌ tracking de párrafo activo (sería motion excesivo)
 *   ❌ animaciones complejas (sólo opacity 120ms linear)
 *   ❌ partículas / glow / blur agresivo
 *   ❌ overlays negros pesados
 */
import React from 'react';

const STYLE_BLOCK = `
[data-a11y-shell-root] {
    --a11y-focus-window-h: clamp(5rem, 18vh, 9rem);
}

[data-a11y-shell-root] .a11y-focus-backdrop,
[data-a11y-shell-root] .a11y-focus-window {
    position: fixed;
    left: 0;
    right: 0;
    pointer-events: none;
    z-index: 10;
}

[data-a11y-shell-root] .a11y-focus-backdrop {
    background-color: rgb(255 255 255 / 0.65);
    opacity: 0;
    transition: opacity 120ms linear;
}

/* Dark theme: slate-900 al 65% — mismo efecto silencioso en oscuro,
   sin caer en negro absoluto que se siente teatral. */
[data-a11y-shell-root][data-a11y-mode="dark"] .a11y-focus-backdrop {
    background-color: rgb(15 23 42 / 0.65);
}

[data-a11y-shell-root][data-a11y-focus-rule="on"] .a11y-focus-backdrop {
    opacity: 1;
}

/* Top: del top del viewport hasta el inicio de la ventana focal. */
[data-a11y-shell-root] .a11y-focus-backdrop-top {
    top: 0;
    height: calc(50vh - var(--a11y-focus-window-h) / 2);
}

/* Bottom: desde el fin de la ventana hasta el bottom del viewport. */
[data-a11y-shell-root] .a11y-focus-backdrop-bottom {
    bottom: 0;
    height: calc(50vh - var(--a11y-focus-window-h) / 2);
}

/* La ventana focal es el gap entre los dos backdrops. La renderizamos
   como un <div> real para fidelidad arquitectónica con el spec
   (topBackdrop / focusWindow / bottomBackdrop) y para dejar un punto
   de extensión futuro (e.g., una guideline sutil), sin estilo visual
   por ahora — una ventana invisible es justo lo que necesitamos. */
[data-a11y-shell-root] .a11y-focus-window {
    top: calc(50vh - var(--a11y-focus-window-h) / 2);
    height: var(--a11y-focus-window-h);
}
`;

const A11yFocusRuleOverlay: React.FC = () => (
    <>
        <style dangerouslySetInnerHTML={{ __html: STYLE_BLOCK }} />
        <div aria-hidden="true" className="a11y-focus-backdrop a11y-focus-backdrop-top" />
        <div aria-hidden="true" className="a11y-focus-window" />
        <div aria-hidden="true" className="a11y-focus-backdrop a11y-focus-backdrop-bottom" />
    </>
);

export default A11yFocusRuleOverlay;
