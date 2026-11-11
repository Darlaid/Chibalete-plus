/**
 * utils/audioTaskRecorder.mjs — V8.1-PROD-02H (ciclo de vida del audio en Home).
 *
 * Grabación de respuestas orales de las tareas (pages/Home.tsx). La grabación es SOLO local:
 * vive en la memoria de la pestaña como `blob:` y nunca se envía al servidor. Este módulo
 * concentra su ciclo de vida para que pueda probarse con MediaRecorder/getUserMedia simulados:
 *
 *   - start():   comprueba A5 (004 §6.3) sin caché ANTES de abrir el micrófono; sin A5 no hay
 *                captura. Vigila A5 mientras graba.
 *   - stop():    termina la toma, cierra las pistas y deja la grabación disponible para escuchar.
 *   - discard(): «Borrar y grabar de nuevo»: libera la URL de la toma.
 *   - reset():   cierre del modal o tras la entrega: corta cualquier captura (también una que
 *                esté arrancando), cierra pistas, deja de vigilar A5 y libera la URL.
 *   - dispose(): salida de Home (desmontaje): como reset() y sin más avisos.
 *   - A5 revocada durante la grabación: se corta, se descartan los fragmentos y no se genera
 *     ningún resultado posterior.
 *
 * Cada captura tiene su propio número de sesión: cualquier evento (permiso concedido tarde,
 * `dataavailable`, `stop`) de una sesión ya cerrada se ignora.
 */
import { isVoiceCaptureAllowed, watchVoiceAuthorization } from './voiceAuthorization.mjs';

/**
 * Texto que se guarda en localStorage en lugar de la URL `blob:` de una respuesta oral:
 * la URL deja de existir al cerrar la pestaña y no sirve a nadie. No se envía al servidor.
 */
export const AUDIO_SUBMISSION_LOCAL_NOTE = '[Respuesta de voz grabada solo en el dispositivo del estudiante; no se envía al servidor]';

/**
 * Entrega sin texto medible: URL `blob:` (entradas antiguas de audio/foto/video) o la nota de
 * audio local. Compatibilidad: las entradas antiguas con `blob:` siguen clasificándose igual.
 * @param {unknown} content
 */
export function isNonTextSubmissionContent(content) {
    return typeof content === 'string' && (content.startsWith('blob:') || content === AUDIO_SUBMISSION_LOCAL_NOTE);
}

/**
 * Contenido de una entrega tal como se guarda en localStorage.
 * Solo cambia las respuestas orales con URL `blob:`; el resto (texto, foto, video) queda igual.
 * @param {string | undefined} submissionType
 * @param {string} content
 */
export function storedSubmissionContent(submissionType, content) {
    if (submissionType === 'audio' && typeof content === 'string' && content.startsWith('blob:')) {
        return AUDIO_SUBMISSION_LOCAL_NOTE;
    }
    return content;
}

/**
 * @typedef {{ isRecording: boolean, audioUrl: string | null, blocked: 'a5' | null }} AudioTaskState
 *
 * @param {{
 *   onChange: (state: AudioTaskState) => void,
 *   onMicError?: (err: unknown) => void,
 *   checkAllowed?: () => Promise<boolean>,
 *   watch?: typeof watchVoiceAuthorization,
 *   getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>,
 *   MediaRecorderCtor?: typeof MediaRecorder,
 *   createObjectURL?: (b: Blob) => string,
 *   revokeObjectURL?: (u: string) => void,
 *   BlobCtor?: typeof Blob,
 * }} deps
 */
export function createAudioTaskRecorder({
    onChange,
    onMicError = () => {},
    checkAllowed = () => isVoiceCaptureAllowed(),
    watch = watchVoiceAuthorization,
    getUserMedia = (c) => globalThis.navigator.mediaDevices.getUserMedia(c),
    MediaRecorderCtor = globalThis.MediaRecorder,
    createObjectURL = (b) => globalThis.URL.createObjectURL(b),
    revokeObjectURL = (u) => globalThis.URL.revokeObjectURL(u),
    BlobCtor = globalThis.Blob,
}) {
    let session = 0;
    let starting = false;
    let disposed = false;
    /** @type {MediaRecorder | null} */ let recorder = null;
    /** @type {MediaStream | null} */ let stream = null;
    /** @type {{ stop: () => void } | null} */ let watcher = null;
    /** @type {Blob[]} */ let chunks = [];
    /** @type {AudioTaskState} */
    let state = { isRecording: false, audioUrl: null, blocked: null };

    const emit = (patch) => {
        state = { ...state, ...patch };
        if (!disposed) onChange(state);
    };
    const stopWatch = () => { try { watcher?.stop(); } catch { /* ya detenida */ } watcher = null; };
    const closeTracks = (s) => { try { s?.getTracks().forEach((t) => t.stop()); } catch { /* sin pistas */ } };
    const releaseUrl = () => {
        const url = state.audioUrl;
        if (url) { try { revokeObjectURL(url); } catch { /* ya liberada */ } }
        return url;
    };

    /** Corta la captura en curso (o la que esté arrancando) sin producir resultado. */
    const abortCapture = () => {
        session += 1;
        stopWatch();
        chunks = [];
        const rec = recorder;
        recorder = null;
        try { if (rec && rec.state !== 'inactive') rec.stop(); } catch { /* ya detenido */ }
        closeTracks(stream);
        stream = null;
    };

    const onRevoked = () => {
        abortCapture();
        releaseUrl();
        emit({ isRecording: false, audioUrl: null, blocked: 'a5' });
    };

    const start = async () => {
        if (disposed || starting || state.isRecording) return;
        starting = true;
        const my = ++session;
        try {
            // Sin A5 efectiva (o si no puede comprobarse) no se abre el micrófono.
            const allowed = await checkAllowed();
            if (my !== session || disposed) return;
            if (!allowed) { emit({ blocked: 'a5' }); return; }

            let s;
            try {
                s = await getUserMedia({ audio: true });
            } catch (err) {
                if (my === session && !disposed) onMicError(err);
                return;
            }
            // El modal se cerró, Home se desmontó o A5 se revocó mientras se pedía el micrófono.
            if (my !== session || disposed) { closeTracks(s); return; }

            // Nueva toma: la anterior ya no se necesita.
            releaseUrl();
            stream = s;
            chunks = [];
            const rec = new MediaRecorderCtor(s);
            recorder = rec;
            rec.ondataavailable = (event) => {
                if (my !== session) return;
                if (event.data && event.data.size > 0) chunks.push(event.data);
            };
            rec.onstop = () => {
                if (my !== session) return; // sesión cortada: no hay resultado
                stopWatch();
                const blob = new BlobCtor(chunks, { type: 'audio/webm' });
                chunks = [];
                recorder = null;
                emit({ audioUrl: createObjectURL(blob) });
            };
            watcher = watch({ onRevoked });
            rec.start();
            emit({ isRecording: true, audioUrl: null, blocked: null });
        } finally {
            starting = false;
        }
    };

    const stop = () => {
        if (!state.isRecording || !recorder) return;
        const rec = recorder;
        stopWatch();
        try { if (rec.state !== 'inactive') rec.stop(); } catch { /* ya detenido */ }
        closeTracks(stream);
        stream = null;
        emit({ isRecording: false });
    };

    const discard = () => {
        if (state.isRecording) return;
        releaseUrl();
        emit({ audioUrl: null });
    };

    const reset = () => {
        abortCapture();
        releaseUrl();
        emit({ isRecording: false, audioUrl: null, blocked: null });
    };

    const dispose = () => {
        abortCapture();
        releaseUrl();
        state = { isRecording: false, audioUrl: null, blocked: null };
        disposed = true;
    };

    return { start, stop, discard, reset, dispose, getState: () => state };
}
