/**
 * accessibleAdapter.mjs — CRR Fase 1 (rev Fase 2) / Modo Accesible.
 *
 * El Modo Accesible (visor `pages/VisorAccesible.tsx`, mode interno 'a11y')
 * NO tiene TTS. Es un visor de lectura pura optimizado para tecnologías
 * asistivas (screen readers, focus rule, navegación por capítulos/párrafos).
 *
 * El adapter monta el CRR con audio NULL: la state machine sigue funcionando
 * (idle → opening → ready → playing ⇄ paused → closing → closed) y representa
 * "el lector está en este párrafo/segmento". El AudioRuntime es no-op.
 *
 * Fase 1A montaba este adapter con TTS habilitado por error de asunción
 * (asumió que "accesible" = "TTS para personas con dificultad lectora"). El
 * visor real no usa audio; Fase 2 lo corrige antes de cablear.
 *
 * NO conecta visores. Factory pura, sin side effects al import.
 */

import { createImmersiveRuntime }  from '../ImmersiveRuntime.mjs';
import { createAudioRuntime }      from '../AudioRuntime.mjs';
import { createDiagnostics }       from '../Diagnostics.mjs';
import { createNullAudioFactory, nullResolveSrc, nullCleanup } from './_nullAudio.mjs';

/**
 * @param {object} opts
 * @param {(args: {contentId: string}) => Promise<{totalIndices: number}>} opts.hydrateContent
 *   `totalIndices` = número de segmentos/párrafos navegables del libro.
 * @param {object} [opts.diagnostics]
 * @param {number} [opts.visibilityTimeoutMs]
 * @param {string} [opts.idPrefix]
 */
export function createAccessibleAdapter(opts = {}) {
    const diagnostics = opts.diagnostics ?? createDiagnostics();
    const audio = createAudioRuntime({
        audioFactory: createNullAudioFactory(),
        audioCleanup: nullCleanup,
        diagnostics,
        resolveSrc:   nullResolveSrc,
    });
    const runtime = createImmersiveRuntime({
        audio,
        diagnostics,
        hydrateContent:      opts.hydrateContent,
        visibilityTimeoutMs: opts.visibilityTimeoutMs,
        idPrefix:            opts.idPrefix ?? 'acc',
    });

    let disposed = false;
    async function dispose(reason) {
        if (disposed) return { ok: true, reason: 'already_disposed' };
        disposed = true;
        try { await runtime.destroy(reason ?? 'accessible_adapter_dispose'); } catch { /* ignore */ }
        return { ok: true };
    }

    return Object.freeze({
        mode:        'accessible',
        runtime,
        diagnostics,
        dispose,
        _state: () => Object.freeze({ disposed, mode: 'accessible' }),
    });
}
