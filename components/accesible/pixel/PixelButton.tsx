/**
 * PixelButton — Sprint Modo accesible (experiencia).
 *
 * Botón con identidad "pixel": bordes duros, sombra de stamp, sin animaciones
 * complejas. Pensado para ser amigable a niños sin perder accesibilidad.
 *
 * Reglas:
 *   - Tamaño grande por defecto: min-h-12 (48px), padding generoso.
 *   - Estados claros: hover desplaza la sombra, active "hunde" el botón.
 *   - Foco visible: outline amarillo grueso para teclado.
 *   - Contraste AA en todas las variantes.
 *   - role/type por defecto correctos; hereda type='button' (no envía formularios).
 *
 * Dark mode (UX-2C — hardening de cohesión):
 *   - El stamp shadow per-tone (negro absoluto en `neutral`, indigo-900 en
 *     `primary`, etc.) se pierde sobre fondos oscuros (`bg-gray-900` de los
 *     PixelPanel). UX-2B ya resolvió esto en PixelPanel usando gray-500
 *     sólido como shadow oscuro; replicamos la misma lógica acá:
 *
 *       base   → dark:shadow-[4px_4px_0_0_rgb(107,114,128)]
 *       hover  → dark:hover:shadow-[5px_5px_0_0_rgb(107,114,128)]
 *       active → dark:active:shadow-[2px_2px_0_0_rgb(107,114,128)]
 *
 *     En dark, todos los tonos comparten el mismo stamp gris-500 — pierden
 *     la firma cromática per-tone que tenían en light, pero ganan presencia
 *     consistente con PixelPanel. Es la decisión correcta para cohesión.
 *
 * NO incluye animaciones complejas — el "feedback visual leve" del sprint
 * se logra con un solo translate + cambio de shadow al active. Todo lineal.
 */
import React from 'react';

export type PixelButtonTone = 'primary' | 'success' | 'warning' | 'danger' | 'neutral';

const TONE_STYLES: Record<PixelButtonTone, {
    bg:        string;
    text:      string;
    border:    string;
    shadow:    string;
    hoverBg:   string;
}> = {
    // Indigo 700 sobre blanco: 8.93:1 (AAA)
    primary:  { bg: 'bg-indigo-700',  text: 'text-white', border: 'border-indigo-900',
                shadow: 'shadow-[4px_4px_0_0_rgb(49,46,129)]',  hoverBg: 'hover:bg-indigo-800' },
    // Emerald 700: 4.83:1 (AA)
    success:  { bg: 'bg-emerald-700', text: 'text-white', border: 'border-emerald-900',
                shadow: 'shadow-[4px_4px_0_0_rgb(6,78,59)]',    hoverBg: 'hover:bg-emerald-800' },
    // Amber 700: 4.51:1 (AA) — fondo cálido con texto blanco
    warning:  { bg: 'bg-amber-700',   text: 'text-white', border: 'border-amber-900',
                shadow: 'shadow-[4px_4px_0_0_rgb(120,53,15)]',  hoverBg: 'hover:bg-amber-800' },
    // Rose 700: 5.13:1 (AA)
    danger:   { bg: 'bg-rose-700',    text: 'text-white', border: 'border-rose-900',
                shadow: 'shadow-[4px_4px_0_0_rgb(136,19,55)]',  hoverBg: 'hover:bg-rose-800' },
    // Gray 800: 12.63:1 (AAA)
    neutral:  { bg: 'bg-gray-800',    text: 'text-white', border: 'border-black',
                shadow: 'shadow-[4px_4px_0_0_rgb(0,0,0)]',      hoverBg: 'hover:bg-gray-900' },
};

export interface PixelButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
    tone?:        PixelButtonTone;
    /** Tamaño visual. Default 'md'. 'lg' es el preferido para Modo accesible. */
    size?:        'md' | 'lg';
    /** Icono opcional a la izquierda del label. Tamaño escalado automático. */
    icon?:        React.ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;
    /** Etiqueta visible. Si omitida, se requiere aria-label en props. */
    children?:    React.ReactNode;
}

export const PixelButton = React.forwardRef<HTMLButtonElement, PixelButtonProps>(function PixelButton(
    { tone = 'primary', size = 'lg', icon: Icon, children, className = '', disabled, type, ...rest },
    ref,
) {
    const styles      = TONE_STYLES[tone];
    const sizeClasses = size === 'lg'
        ? 'min-h-14 px-6 py-3 text-lg'
        : 'min-h-12 px-5 py-2.5 text-base';
    const iconSize    = size === 'lg' ? 24 : 20;

    return (
        <button
            ref={ref}
            type={type ?? 'button'}
            disabled={disabled}
            className={[
                // Base
                'inline-flex items-center justify-center gap-2',
                'font-bold tracking-wide select-none',
                'border-2 rounded-md',
                // Tono (light mode: stamp per-tone)
                styles.bg, styles.text, styles.border, styles.shadow,
                // Dark mode (UX-2C): stamp gray-500 sólido en los tres
                // estados. Sustituye al per-tone shadow cuando .dark está
                // activa. Cohesión con PixelPanel; ver docstring.
                'dark:shadow-[4px_4px_0_0_rgb(107,114,128)]',
                // Tamaño
                sizeClasses,
                // Hover (sin disabled): sombra crece levemente
                disabled ? '' : `${styles.hoverBg} hover:shadow-[5px_5px_0_0_rgba(0,0,0,0.85)] dark:hover:shadow-[5px_5px_0_0_rgb(107,114,128)]`,
                // Active: el botón "se hunde" (translate + sombra reducida)
                disabled ? '' : 'active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_rgba(0,0,0,0.85)] dark:active:shadow-[2px_2px_0_0_rgb(107,114,128)]',
                // Focus visible para teclado: outline contrastante
                'focus:outline-none focus-visible:ring-4 focus-visible:ring-amber-400 focus-visible:ring-offset-2',
                // Disabled
                disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
                // Transición LEVE — sin curvas elaboradas
                'transition-[transform,box-shadow] duration-75',
                className,
            ].filter(Boolean).join(' ')}
            {...rest}
        >
            {Icon && <Icon size={iconSize} aria-hidden={true} />}
            {children}
        </button>
    );
});
