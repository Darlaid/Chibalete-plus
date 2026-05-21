import React, { useState, useCallback, useRef } from 'react';

/**
 * EditorialCover — Fase 4 Experiencia Editorial.
 *
 * Componente que RESPETA el aspect-ratio intrínseco de la portada de un libro.
 * Reemplaza el patrón legacy de `<img className="w-full h-full object-cover">`
 * que cropea destructivamente cualquier portada no-portrait.
 *
 * REGLAS DURAS:
 *
 *   1. NO crop destructivo. Las portadas se MUESTRAN como son:
 *      - portrait (alto > ancho): contenedor portrait, image fit.
 *      - landscape (ancho > alto): contenedor landscape, image fit.
 *      - square: contenedor square, image fit.
 *
 *   2. Detección por `<img>.onLoad` (naturalWidth/naturalHeight). Mientras
 *      carga, el contenedor usa el aspect-ratio "expected" (portrait por
 *      default; el caller puede override).
 *
 *   3. Loading skeleton coherente (bg gray + sutil pulse). Sin flash blanco.
 *
 *   4. Fallback en cadena defensivo (idéntico al patrón actual de ContentCard):
 *      maxresdefault → hqdefault → ui-avatars generator.
 *
 *   5. Accesibilidad obligatoria: `alt` requerido. Decoraciones internas
 *      `aria-hidden`. Sin role tweaks.
 *
 *   6. NO librerías externas. Solo React + Tailwind.
 *
 *   7. Mobile-friendly por defecto (no fixed widths).
 *
 * Uso:
 *   <EditorialCover
 *     src={content.portada_url}
 *     alt={`Portada de ${content.titulo}`}
 *     titulo={content.titulo}
 *     className="rounded-xl shadow-md"
 *   />
 */

export type CoverShape = 'portrait' | 'landscape' | 'square' | 'unknown';

export interface EditorialCoverProps {
    /** URL principal de la portada. null/'' → fallback a ui-avatars. */
    src: string | null | undefined;
    /** Texto alternativo OBLIGATORIO (accessibility). */
    alt: string;
    /** Título para el fallback ui-avatars cuando src falla. */
    titulo?: string;
    /**
     * Aspect-ratio esperado mientras la imagen carga. Default 'portrait' (2:3).
     * El componente lo SOBRESCRIBE con el aspect-ratio real una vez carga.
     */
    expectedShape?: CoverShape;
    /** Clases extra para el wrapper (rounded, shadow, etc). */
    className?: string;
    /** loading hint para el browser. Default 'lazy'. */
    loading?: 'lazy' | 'eager';
    /** Callback opcional cuando se detecta el shape real (telemetría/tests). */
    onShapeDetected?: (shape: CoverShape, ratio: number) => void;
    /** Si true, opacidad y blur visual (estado processing). */
    dim?: boolean;
}

const ASPECT_FOR_SHAPE: Record<CoverShape, string> = {
    portrait:  '2 / 3',   // libro tradicional
    landscape: '3 / 2',   // panorámico / álbum apaisado
    square:    '1 / 1',   // single / comic
    unknown:   '2 / 3',   // default conservador
};

/**
 * Clasifica el aspect-ratio en uno de los 3 shapes editoriales.
 * Threshold conservador: ±15% vs square = square; >15% más alto que ancho =
 * portrait; >15% más ancho que alto = landscape.
 */
export function classifyAspectRatio(width: number, height: number): CoverShape {
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        return 'unknown';
    }
    const ratio = width / height;
    if (ratio >= 0.85 && ratio <= 1.15) return 'square';
    if (ratio < 0.85) return 'portrait';
    return 'landscape';
}

function buildFallbackUrl(titulo?: string): string {
    const t = titulo && titulo.length > 0 ? titulo : 'libro';
    return `https://ui-avatars.com/api/?name=${encodeURIComponent(t)}&background=random&size=400`;
}

export const EditorialCover: React.FC<EditorialCoverProps> = ({
    src,
    alt,
    titulo,
    expectedShape = 'portrait',
    className = '',
    loading = 'lazy',
    onShapeDetected,
    dim = false,
}) => {
    const [shape, setShape] = useState<CoverShape>('unknown');
    const [loaded, setLoaded] = useState(false);
    const fallbackChain = useRef<{ triedHq: boolean; triedAvatar: boolean }>({ triedHq: false, triedAvatar: false });

    const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        const detected = classifyAspectRatio(img.naturalWidth, img.naturalHeight);
        setShape(detected);
        setLoaded(true);
        if (onShapeDetected) {
            try { onShapeDetected(detected, img.naturalWidth / Math.max(1, img.naturalHeight)); }
            catch { /* nunca propagar errores de telemetría */ }
        }
    }, [onShapeDetected]);

    const handleError = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const target = e.currentTarget;
        const currentSrc = target.src;
        if (currentSrc.includes('maxresdefault.jpg') && !fallbackChain.current.triedHq) {
            fallbackChain.current.triedHq = true;
            target.src = currentSrc.replace('maxresdefault.jpg', 'hqdefault.jpg');
            return;
        }
        if (!currentSrc.includes('ui-avatars.com') && !fallbackChain.current.triedAvatar) {
            fallbackChain.current.triedAvatar = true;
            target.src = buildFallbackUrl(titulo);
            return;
        }
        // Última opción ya falló — marcamos como loaded para que el skeleton se vaya.
        setLoaded(true);
    }, [titulo]);

    const effectiveShape = loaded && shape !== 'unknown' ? shape : expectedShape;
    const aspect = ASPECT_FOR_SHAPE[effectiveShape];
    const resolvedSrc = src && src.length > 0 ? src : buildFallbackUrl(titulo);

    return (
        <div
            className={`relative bg-gray-100 dark:bg-gray-800 overflow-hidden ${className}`.trim()}
            style={{ aspectRatio: aspect }}
            data-editorial-cover-shape={effectiveShape}
            data-editorial-cover-loaded={loaded ? 'true' : 'false'}
        >
            {/* Skeleton mientras carga (suave pulse, sin flash blanco) */}
            {!loaded && (
                <div
                    className="absolute inset-0 bg-gray-200 dark:bg-gray-700 animate-pulse motion-reduce:animate-none"
                    aria-hidden="true"
                />
            )}
            <img
                src={resolvedSrc}
                alt={alt}
                loading={loading}
                decoding="async"
                onLoad={handleLoad}
                onError={handleError}
                className={`absolute inset-0 w-full h-full object-contain transition-opacity duration-300 motion-reduce:transition-none ${
                    loaded ? 'opacity-100' : 'opacity-0'
                } ${dim ? 'opacity-50 blur-[1px]' : ''}`}
            />
        </div>
    );
};

export default EditorialCover;
