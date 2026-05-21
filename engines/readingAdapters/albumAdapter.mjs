/**
 * albumAdapter.mjs — CRR Fase 1 / Modo Álbum (libro ilustrado guiado).
 *
 * Idéntico en estructura al PDF adapter: audio NULL, índice = página/lámina.
 * Mantener separado del PDF deja la puerta abierta para Fase 2 (música
 * ambient opcional, transiciones más ricas entre láminas) sin tocar el path
 * PDF. En esta fase no hay diferencias operativas.
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
export function createAlbumAdapter(opts = {}) {
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
        idPrefix:            opts.idPrefix ?? 'alb',
    });

    let disposed = false;
    async function dispose(reason) {
        if (disposed) return { ok: true, reason: 'already_disposed' };
        disposed = true;
        try { await runtime.destroy(reason ?? 'album_adapter_dispose'); } catch { /* ignore */ }
        return { ok: true };
    }

    return Object.freeze({
        mode:        'album',
        runtime,
        diagnostics,
        dispose,
        _state: () => Object.freeze({ disposed, mode: 'album' }),
    });
}
