/**
 * pdfAdapter.mjs — CRR Fase 1 / Modo PDF.
 *
 * VisorPDF no tiene audio per-página. El adapter monta el runtime con un
 * audioFactory NULL: la state machine sigue funcionando (idle → opening →
 * ready → playing ⇄ paused → closing → closed), pero `playing` semánticamente
 * representa "la página está visible y el usuario la está leyendo".
 *
 * El índice del runtime mapea a página del PDF. `hydrateContent` debe
 * resolver `totalIndices` = número de páginas.
 *
 * NO conecta el visor. Factory pura.
 */

import { createImmersiveRuntime }  from '../ImmersiveRuntime.mjs';
import { createAudioRuntime }      from '../AudioRuntime.mjs';
import { createDiagnostics }       from '../Diagnostics.mjs';
import { createNullAudioFactory, nullResolveSrc, nullCleanup } from './_nullAudio.mjs';

/**
 * @param {object} opts
 * @param {(args: {contentId: string}) => Promise<{totalIndices: number}>} opts.hydrateContent
 * @param {object} [opts.diagnostics]
 * @param {number} [opts.visibilityTimeoutMs]
 * @param {string} [opts.idPrefix]
 */
export function createPdfAdapter(opts = {}) {
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
        idPrefix:            opts.idPrefix ?? 'pdf',
    });

    let disposed = false;
    async function dispose(reason) {
        if (disposed) return { ok: true, reason: 'already_disposed' };
        disposed = true;
        try { await runtime.destroy(reason ?? 'pdf_adapter_dispose'); } catch { /* ignore */ }
        return { ok: true };
    }

    return Object.freeze({
        mode:        'pdf',
        runtime,
        diagnostics,
        dispose,
        _state: () => Object.freeze({ disposed, mode: 'pdf' }),
    });
}
