import React, { useEffect } from 'react';
import { PROTECTED_PRINT_CSS, interceptExtraction } from '../utils/contentProtection.mjs';

/**
 * CHP-CONTENT-PROTECTION-2026-01 — CP-4A.
 *
 * Envoltorio común de las superficies editoriales: fricción de copia /
 * menú contextual / arrastre e impresión protegida. Sin marca de agua
 * (WATERMARK_POLICY: PROHIBITED). NO decide acceso (eso es /access y el
 * servidor), NO carga contenido, NO toca progreso y NO conoce contratos.
 *
 * `display: contents`: no crea caja, así que el layout del visor no cambia;
 * los eventos siguen burbujeando por este nodo.
 */
export type ProtectedSurfaceMode = 'standard' | 'accessible';

interface ProtectedContentSurfaceProps {
    mode?: ProtectedSurfaceMode;
    children: React.ReactNode;
}

const PRINT_STYLE_ID = 'chp-protected-print';
let mounted = 0;

const ProtectedContentSurface: React.FC<ProtectedContentSurfaceProps> = ({ mode = 'standard', children }) => {
    // Impresión: mientras haya una superficie montada, la página impresa (y
    // «Guardar como PDF») es solo el aviso.
    useEffect(() => {
        if (!document.getElementById(PRINT_STYLE_ID)) {
            const style = document.createElement('style');
            style.id = PRINT_STYLE_ID;
            style.textContent = PROTECTED_PRINT_CSS;
            document.head.appendChild(style);
        }
        mounted += 1;
        document.documentElement.setAttribute('data-chp-protected', '');
        return () => {
            mounted = Math.max(0, mounted - 1);
            if (mounted === 0) document.documentElement.removeAttribute('data-chp-protected');
        };
    }, []);

    const onExtraction = (e: React.SyntheticEvent) => { interceptExtraction(e.nativeEvent, mode); };

    return (
        <div
            data-chp-surface={mode}
            style={{ display: 'contents' }}
            onCopy={onExtraction}
            onCut={onExtraction}
            onContextMenu={onExtraction}
            onDragStart={onExtraction}
        >
            {children}
        </div>
    );
};

export default ProtectedContentSurface;
