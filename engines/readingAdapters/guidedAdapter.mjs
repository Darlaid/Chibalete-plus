/**
 * guidedAdapter.mjs — CRR Fase 1 / Modo Guiado.
 *
 * Hoy "Modo Guiado" comparte ruta e implementación con accesible
 * (utils/readerMode.ts:'text'). Mantenemos un adapter separado para que el
 * roadmap pueda divergir en Fase 2+ (p.ej. word-level highlighting, métricas
 * de lectura distintas) sin tocar el path accesible.
 *
 * En esta fase el wiring es idéntico al accesible: TTS-only, sin manifest.
 *
 * NO conecta visores. Factory pura.
 */

import { createProductionRuntime } from '../../utils/immersiveV2/createProductionRuntime.mjs';

/**
 * @param {object} opts — misma forma que AccessibleAdapterDeps.
 */
export function createGuidedAdapter(opts = {}) {
    const stack = createProductionRuntime({
        ...opts,
        getManifest: () => null,
        idPrefix: opts.idPrefix ?? 'gui',
    });
    return Object.freeze({
        mode:        'guided',
        runtime:     stack.runtime,
        diagnostics: stack.diagnostics,
        dispose:     stack.dispose,
        _state:      stack._state,
    });
}
