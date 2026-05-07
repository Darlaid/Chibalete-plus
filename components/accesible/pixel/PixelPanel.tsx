/**
 * PixelPanel — Sprint Modo accesible (experiencia).
 *
 * Contenedor editorial del sistema pixel. Aporta IDENTIDAD a los bloques
 * de la sidebar (Progreso, Navegación, Índice, Lectura) sin caer en
 * "ventana gamer" ni "modal retro exagerado":
 *
 *     ┌─────────────────────────┐
 *     │ ░░░░░░░░░░░░░░░░░░░░░░░│
 *     │ contenido del bloque    │░░
 *     │ ░░░░░░░░░░░░░░░░░░░░░░░│░░
 *     └─────────────────────────┘░░
 *       ░░░░░░░░░░░░░░░░░░░░░░░░░░
 *
 * Decisiones visuales:
 *   - border-2: continuidad con PixelButton/PixelBadge/PixelReadingLevel
 *     (el borde duro es el ADN del sistema pixel).
 *   - rounded-md: idéntico a PixelButton — los bloques y los botones que
 *     viven dentro comparten el mismo radio.
 *   - stamp shadow 3px: medio paso entre PixelBadge (2px, badge pequeño)
 *     y PixelButton/PixelReadingLevel (4px, acción/hero). Suficiente
 *     presencia para leer como "módulo", lo bastante sobrio para no
 *     competir con los botones de adentro.
 *   - p-4: padding cómodo. La JERARQUÍA INTERNA (eyebrow → contenido →
 *     acciones) la maneja el caller con su propio espaciado vertical;
 *     PixelPanel sólo provee el contenedor.
 *
 * Dark mode (problema explícito del sprint UX-2B):
 *   - El stamp shadow negro `rgb(0,0,0)` se pierde sobre fondos oscuros.
 *     Aquí usamos un shadow gray-500 `rgb(107,114,128)` en dark — visible
 *     contra `bg-gray-900` sin glare ni ruido óptico.
 *   - El border en dark sube a gray-700 para no desaparecer.
 *
 * Semántica:
 *   - Default `<section>`: la mayoría de los usos en sidebar son secciones
 *     visuales. El caller puede sobreescribir con `as` ('div' / 'aside').
 *   - Forward de TODAS las props HTMLAttributes al elemento raíz
 *     (id, role, aria-*, tabIndex, onClick, etc).
 *
 * NO incluido a propósito:
 *   - Sin slots eyebrow/footer prescritos. Los componentes hijos
 *     (A11yProgressSummary, A11yReaderNavigation) ya traen su propio
 *     eyebrow interno consistente; reusarlos sin envolver con un slot
 *     extra evita doble-titulación.
 */
import React from 'react';

type PixelPanelTag = 'section' | 'div' | 'aside' | 'nav';

export interface PixelPanelProps extends React.HTMLAttributes<HTMLElement> {
    /** Tag semántico raíz. Default 'section'. */
    as?: PixelPanelTag;
    children?: React.ReactNode;
}

const BASE_CLASSES = [
    // Contenedor
    'block',
    'p-4',
    // Borde + radio: identidad pixel
    'border-2 rounded-md',
    'border-gray-300 dark:border-gray-700',
    // Fondo: panel propio para destacar sobre el bg del shell
    'bg-white dark:bg-gray-900',
    // Texto: hereda en general, pero forzamos color de cuerpo legible.
    // (No usamos var(--a11y-text) porque el panel tiene su propio bg
    //  pixel y necesita contraste consistente con su bg, no con el del
    //  shell.)
    'text-gray-900 dark:text-gray-100',
    // Stamp shadow: 3px sólido. En light mode shadow gray-800 sobre
    // fondo blanco = fuerte stamp editorial. En dark mode shadow
    // gray-500 sobre fondo gray-900 = stamp visible sin ruido.
    'shadow-[3px_3px_0_0_rgb(31,41,55)]',
    'dark:shadow-[3px_3px_0_0_rgb(107,114,128)]',
].join(' ');

export const PixelPanel = React.forwardRef<HTMLElement, PixelPanelProps>(function PixelPanel(
    { as = 'section', className = '', children, ...rest },
    ref,
) {
    // Renderizamos dinámicamente. React acepta string tags vía
    // createElement con typing genérico; el cast a `any` se acota a la
    // factory para no contaminar la API pública.
    const Tag = as as React.ElementType;
    return (
        <Tag
            ref={ref as React.Ref<HTMLElement>}
            className={[BASE_CLASSES, className].filter(Boolean).join(' ')}
            {...rest}
        >
            {children}
        </Tag>
    );
});

/**
 * Clases compartidas, exportadas para casos en los que NO podemos usar
 * <PixelPanel> como contenedor pero queremos el mismo lenguaje visual
 * — por ejemplo, el dialog de Ajustes de Lectura, que necesita
 * `role="dialog"` + management de focus propio y se renderiza fuera
 * del flujo normal de la sidebar.
 */
export const PIXEL_PANEL_CLASSES = BASE_CLASSES;
