/**
 * A11yLiveRegion — regiones aria-live centralizadas del Modo accesible.
 *
 * Renderiza dos regiones:
 *   - polite (role="status")   → mensajes informativos (cambio de párrafo, settings…)
 *   - assertive (role="alert") → errores críticos que el usuario debe oír de inmediato
 *
 * En esta fase 1 no hay lógica de anuncios — solo la estructura. Las fases
 * siguientes conectarán `useA11yAnnouncer` para inyectar texto en estas regiones.
 *
 * Reglas técnicas que NO deben violarse al evolucionar este componente:
 *   - Las regiones existen siempre desde el primer render; un aria-live agregado
 *     después de mount NO es anunciado por NVDA/VoiceOver.
 *   - Las regiones están visualmente ocultas con la técnica sr-only (clip + size 1).
 *     NUNCA usar `display:none` ni `visibility:hidden` — eso las saca del árbol
 *     de accesibilidad.
 *   - aria-atomic="true" para que el lector lea el cambio completo, no solo el delta.
 *   - role="status" implica aria-live="polite"; role="alert" implica aria-live="assertive".
 *     Declarar ambos es redundante pero compatible — lo dejamos explícito para claridad.
 */

import React from 'react';

const A11yLiveRegion: React.FC = () => {
    return (
        <>
            <div
                id="a11y-announcer-polite"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="sr-only"
            />
            <div
                id="a11y-announcer-assertive"
                role="alert"
                aria-live="assertive"
                aria-atomic="true"
                className="sr-only"
            />
        </>
    );
};

export default A11yLiveRegion;
