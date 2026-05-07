/**
 * PixelReadingLevel — Sprint Modo accesible (experiencia).
 *
 * Componente compuesto que muestra el progreso como "Nivel de lectura"
 * con la estética pixel del sprint:
 *
 *   ┌─────────────────────────────────────────┐
 *   │ Nivel de lectura                   60 % │
 *   │ ▓▓▓▓▓▓░░░░                              │
 *   └─────────────────────────────────────────┘
 *
 * Diseñado para superponerse a un visor sin tocar su lógica:
 * recibe `value` y se renderiza. La lógica de cálculo de % (scroll,
 * sentence index, etc.) la hace el caller.
 */
import React from 'react';
import { PixelProgressBar } from './PixelProgressBar';

export interface PixelReadingLevelProps {
    /** 0..100 — progreso de lectura. */
    value:   number;
    /** Etiqueta visible. Default: "Nivel de lectura". */
    label?:  string;
    /** Cantidad de bloques. Default 10. */
    blocks?: number;
    className?: string;
}

export function PixelReadingLevel({
    value,
    label  = 'Nivel de lectura',
    blocks = 10,
    className = '',
}: PixelReadingLevelProps) {
    return (
        <div
            className={[
                'bg-white text-gray-900 border-2 border-black rounded-md p-4',
                'shadow-[4px_4px_0_0_rgb(0,0,0)]',
                className,
            ].filter(Boolean).join(' ')}
        >
            <PixelProgressBar
                value={value}
                blocks={blocks}
                label={label}
                tone="primary"
            />
        </div>
    );
}
