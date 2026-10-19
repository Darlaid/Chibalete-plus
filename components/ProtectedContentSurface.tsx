import React, { useEffect, useMemo } from 'react';
import {
    PROTECTED_PRINT_CSS,
    interceptExtraction,
    watermarkLabel,
    watermarkOffset,
    watermarkTileDataUri,
} from '../utils/contentProtection.mjs';

/**
 * CHP-CONTENT-PROTECTION-2026-01 — CP-4A.
 *
 * Envoltorio común de las superficies editoriales: fricción de copia /
 * menú contextual / arrastre, impresión protegida y marca de agua visible.
 * NO decide acceso (eso es /access y el servidor), NO carga contenido, NO
 * toca progreso y NO conoce contratos.
 *
 * `display: contents`: no crea caja, así que el layout del visor no cambia;
 * los eventos siguen burbujeando por este nodo.
 */
export type ProtectedSurfaceMode = 'standard' | 'accessible';

interface ProtectedContentSurfaceProps {
    mode?: ProtectedSurfaceMode;
    watermark?: boolean;
    viewer?: { id?: string | null; institution?: string | null } | null;
    children: React.ReactNode;
}

const PRINT_STYLE_ID = 'chp-protected-print';
let mounted = 0;

const ProtectedContentSurface: React.FC<ProtectedContentSurfaceProps> = ({
    mode = 'standard',
    watermark = true,
    viewer,
    children,
}) => {
    const label = useMemo(
        () => watermarkLabel({ userId: viewer?.id, institution: viewer?.institution }),
        [viewer?.id, viewer?.institution],
    );
    const tile = useMemo(() => watermarkTileDataUri(label), [label]);
    const offset = useMemo(() => watermarkOffset(), []);

    // Impresión: mientras haya una superficie montada, la página impresa (y
    // «Guardar como PDF») es solo el aviso + el marcador.
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
            if (mounted === 0) {
                document.documentElement.removeAttribute('data-chp-protected');
                document.body.removeAttribute('data-chp-mark');
            }
        };
    }, []);

    useEffect(() => {
        document.body.setAttribute('data-chp-mark', label);
    }, [label]);

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
            {watermark && (
                <div
                    className="chp-watermark"
                    aria-hidden="true"
                    role="presentation"
                    style={{
                        position: 'fixed',
                        inset: 0,
                        pointerEvents: 'none',
                        zIndex: 2147483000,
                        backgroundImage: tile,
                        backgroundRepeat: 'repeat',
                        backgroundPosition: offset,
                    }}
                />
            )}
        </div>
    );
};

export default ProtectedContentSurface;
