/**
 * ModoAccesibleContext — Sprint Modo accesible (Objetivo 2, base).
 *
 * Provee a los componentes hijos la información mínima sobre si el Modo
 * accesible está activo en el subárbol actual. Esta es la base sobre la que
 * se construirá el rediseño visual completo en sprints futuros — hoy solo
 * se exponen `activo` y un setter para que los componentes puedan adaptar
 * tipografía, spacing y contraste sin reescribir contenido ni mensajes.
 *
 * Reglas:
 *   - Default `activo = false` → comportamiento idéntico al actual.
 *   - Cuando un componente quiere reaccionar al modo, llama `useModoAccesible()`.
 *   - El nombre del modo es definitivo: "Modo accesible". No renombrar.
 */
import React, { createContext, useContext, useMemo, useState } from 'react';

export interface ModoAccesibleValue {
    /** True cuando el Modo accesible está activo en este subárbol. */
    activo: boolean;
    /** Permite alternar el modo desde un toggle (opcional, fuera de scope si no se usa). */
    setActivo: (next: boolean) => void;
}

const DEFAULT_VALUE: ModoAccesibleValue = {
    activo: false,
    // No-op: si nadie envuelve, el setter no rompe — simplemente no cambia nada.
    setActivo: () => {},
};

const ModoAccesibleContext = createContext<ModoAccesibleValue>(DEFAULT_VALUE);

/**
 * Hook para que los componentes consulten si están dentro del Modo accesible.
 * Si no hay provider en el árbol, devuelve { activo: false } y un setter no-op.
 */
export function useModoAccesible(): ModoAccesibleValue {
    return useContext(ModoAccesibleContext);
}

interface ModoAccesibleProviderProps {
    /** Valor inicial del modo. Default: false. */
    initialActivo?: boolean;
    /** Si se provee, hace al provider controlado externamente. */
    activo?: boolean;
    onChange?: (next: boolean) => void;
    children: React.ReactNode;
}

/**
 * Provider del Modo accesible. Soporta dos modos de uso:
 *
 *   1. No controlado: <ModoAccesibleProvider initialActivo>...</ModoAccesibleProvider>
 *      mantiene el estado internamente; setActivo lo cambia.
 *
 *   2. Controlado: <ModoAccesibleProvider activo onChange>...</ModoAccesibleProvider>
 *      el padre controla el booleano; setActivo invoca onChange.
 */
export function ModoAccesibleProvider({
    initialActivo = false,
    activo: controlledActivo,
    onChange,
    children,
}: ModoAccesibleProviderProps) {
    const [internalActivo, setInternalActivo] = useState(initialActivo);
    const isControlled = typeof controlledActivo === 'boolean';
    const activo = isControlled ? controlledActivo! : internalActivo;

    const value = useMemo<ModoAccesibleValue>(() => ({
        activo,
        setActivo: (next: boolean) => {
            if (!isControlled) setInternalActivo(next);
            if (onChange) onChange(next);
        },
    }), [activo, isControlled, onChange]);

    return (
        <ModoAccesibleContext.Provider value={value}>
            {children}
        </ModoAccesibleContext.Provider>
    );
}
