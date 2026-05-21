/**
 * _nullAudio.mjs — helper interno compartido por los adapters de modos sin
 * audio per-sentence (pdf, album).
 *
 * Provee:
 *   - createNullAudioFactory(): factory que devuelve un audio-stub inerte.
 *     play() resuelve a undefined; pause() es no-op; src/currentTime son
 *     slots ignorables. Cumple la interfaz mínima que AudioRuntime espera.
 *   - nullResolveSrc: resolveSrc que siempre devuelve null. AudioRuntime
 *     reportará 'audio.acquire.null_url' y la sesión no intentará play.
 *   - nullCleanup: noop.
 *
 * NO se exporta del barrel — uso interno de los adapters PDF/álbum.
 */

export function createNullAudioFactory() {
    return () => ({
        play:  async () => undefined,
        pause: () => {},
        set src(_v) {},
        get src() { return ''; },
        get currentTime() { return 0; },
        set currentTime(_v) {},
        get readyState() { return 0; },
    });
}

export async function nullResolveSrc() {
    return null;
}

export function nullCleanup() {}
