/**
 * ModoAccesibleLayout — Sprint Modo accesible (Objetivo 2, base).
 *
 * Wrapper de layout que prepara el subárbol para el Modo accesible:
 *   - Alto contraste base (texto oscuro sobre fondo claro, sin opacidades).
 *   - Tipografía legible (text-lg como mínimo de cuerpo).
 *   - Spacing amplio (gap-6 / py-6 generosos).
 *   - Layout limpio (sin gradientes, sin backdrop blur).
 *
 * Esta es la BASE. NO es el rediseño visual final. Cuando los siguientes
 * sprints añadan el "modo lectura pixel art" o variantes específicas para
 * el Modo accesible, se construyen sobre este wrapper.
 *
 * Reglas:
 *   - El wrapper NO modifica contenido ni mensajes — solo layout.
 *   - Cuando `activo=false` el wrapper se vuelve transparente (renderiza
 *     children sin clases adicionales) → comportamiento idéntico al actual.
 *   - Los componentes hijos pueden consultar `useModoAccesible()` para
 *     adaptar variantes finas (tipografía por nivel, padding interno, etc.).
 */
import React from 'react';
import { ModoAccesibleProvider } from '../../context/ModoAccesibleContext';

export interface ModoAccesibleLayoutProps {
    /** Si está activo, se aplican las clases base. Default: true. */
    activo?: boolean;
    /** Render override: por default, <main role="main"> para semántica HTML. */
    as?: 'main' | 'section' | 'div';
    children: React.ReactNode;
}

/**
 * Clases base aplicadas cuando el modo está activo. Son intencionalmente
 * conservadoras para no chocar con los estilos existentes — el wrapper se
 * coloca alrededor de páginas o paneles ya construidos.
 *
 *   - bg-white text-gray-900 → contraste fuerte y predecible
 *   - text-lg → cuerpo más legible (16→18px)
 *   - leading-relaxed → interlineado más cómodo
 *   - antialiased → suavizado uniforme
 *   - selection: → selección de texto con buen contraste
 *
 * NO se aplica nada que pueda romper el layout existente (no max-width forzado,
 * no font-family override, no padding global agresivo).
 */
const A11Y_BASE_CLASSES =
    'bg-white text-gray-900 text-lg leading-relaxed antialiased ' +
    'selection:bg-amber-200 selection:text-gray-900';

export function ModoAccesibleLayout({
    activo = true,
    as = 'main',
    children,
}: ModoAccesibleLayoutProps) {
    const Element = (as as unknown) as React.ElementType;
    return (
        <ModoAccesibleProvider activo={activo}>
            <Element
                role={as === 'main' ? 'main' : undefined}
                data-modo-accesible={activo ? 'true' : 'false'}
                lang="es"
                className={activo ? A11Y_BASE_CLASSES : undefined}
            >
                {children}
            </Element>
        </ModoAccesibleProvider>
    );
}
