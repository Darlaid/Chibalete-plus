/**
 * MookReturn.tsx — CHP-MOOK-CONTEXTUAL-READING-RETURN-01
 *
 * Navegación de retorno compartida por los cinco lectores.
 *
 * Existe para no repetir la misma lógica cinco veces: cada visor tenía su propia
 * forma de volver —dos usaban `navigate(-1)` y tres una ruta absoluta— y añadir
 * el retorno al MOOK en cada uno habría multiplicado el mismo error potencial.
 *
 * No es un servicio general de navegación ni un framework de deep links: son dos
 * ayudas mínimas sobre `utils/mookReturn.mjs`.
 */
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { readMookContext, withMookContext, mookReturnPath } from '../utils/mookReturn.mjs';

/** Origen MOOK de la lectura actual, leído de la URL. `null` si no lo hay. */
export function useMookContext(): { experienceId: string; nodeId: string } | null {
    const location = useLocation();
    return readMookContext(location.search);
}

/**
 * Ruta de vuelta a la ficha del contenido, conservando el origen si existe.
 * Los visores que ya volvían a la ficha siguen haciéndolo; lo único que cambia
 * es que el origen no se pierde por el camino.
 */
export function useFichaPath(contentId?: string): string {
    const ctx = useMookContext();
    return withMookContext(`/contenido/${contentId ?? ''}`, ctx);
}

/**
 * «Volver al MOOK»: salta directamente al nodo de origen, sin pasar otra vez por
 * la ficha. Se renderiza SOLO si hay origen válido — desde Biblioteca no debe
 * aparecer, porque no hay MOOK al que volver.
 */
export const MookReturnButton: React.FC<{ className?: string; compact?: boolean }> = ({ className, compact }) => {
    const ctx = useMookContext();
    const to = mookReturnPath(ctx);
    if (!to) return null;
    return (
        <Link
            to={to}
            aria-label="Volver al MOOK, al paso de origen"
            className={className ?? 'inline-flex items-center gap-1 px-3 py-2 rounded-full border border-white/20 '
                + 'text-sm font-bold hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400'}
        >
            <BookOpen size={16} aria-hidden />
            <span className={compact ? 'sr-only sm:not-sr-only' : ''}>Volver al MOOK</span>
        </Link>
    );
};
