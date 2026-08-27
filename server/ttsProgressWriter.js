/**
 * ttsProgressWriter.js — CHP-TTS-PROGRESS-CALLBACK-RACE-01.
 *
 * Serializa, POR JOB de TTS, las escrituras de estado en el catálogo, y protege
 * el estado terminal frente a callbacks de progreso tardíos.
 *
 * El problema que resuelve: `generateAudioForContent` invoca `onProgress` de
 * forma síncrona una vez por chunk y, al terminar, el llamador emite el estado
 * terminal. Si cada callback lanza una tarea desligada que compite por
 * `withFileLock`, el orden de escritura queda a merced del lock — que es polling
 * con reintentos cada 40 ms y SIN cola FIFO. El contendiente recién llegado
 * prueba `openSync` de inmediato, así que el `completed` final suele ganar el
 * lock libre y un `processing` rezagado lo pisa después. Con la caché de audio
 * caliente todos los callbacks colapsan en milisegundos y la carrera se pierde
 * de forma sistemática: en producción, 14 de 14 recursos quedaron en
 * `ttsStatus:'generando'` con el audio ya generado al 100 %.
 *
 * La corrección es local y mínima: una cadena de promesas por job. No hay cola
 * global, ni store nuevo, ni dependencias, ni locks adicionales. Cada `persist`
 * sigue haciendo su propio read-modify-write dentro de `withFileLock`, así que
 * la protección cross-réplica de CHP-CONTENT-STORE-RMW-01 queda intacta: aquí
 * solo se ordena, no se cambia cómo se escribe.
 *
 * Invariantes:
 *   - las escrituras se aplican en el orden en que se llamó al escritor;
 *   - un estado terminal (`completed`, `failed`, `error_proveedor`) no puede
 *     ser revertido por un progreso posterior DEL MISMO job;
 *   - una regeneración nueva usa un escritor nuevo y sí puede volver a
 *     `generando`;
 *   - el progreso normal se sigue viendo mientras el job avanza;
 *   - un fallo de persistencia se notifica por `onError` y no rompe la cadena.
 */

const ESTADOS_TERMINALES = new Set(['completed', 'failed', 'error_proveedor']);

/**
 * @param {object}   opciones
 * @param {string}   opciones.contentId  id del contenido (solo para trazas)
 * @param {(status: object) => Promise<void>} opciones.persist  escritura real
 * @param {(err: Error, status: object) => void} opciones.onError  fallo observable
 * @returns {((status: object) => Promise<void>) & { drain(): Promise<void> }}
 */
export function createTtsProgressWriter({ contentId, persist, onError }) {
    let cadena = Promise.resolve();
    let terminal = false;

    const escribir = (status) => {
        cadena = cadena.then(async () => {
            const esTerminal = ESTADOS_TERMINALES.has(status && status.status);
            // Un progreso tardío jamás revierte el estado terminal de ESTE job.
            if (terminal && !esTerminal) return;
            if (esTerminal) terminal = true;
            await persist(status);
        }).catch((err) => {
            // Nunca se traga: se notifica y la cadena sigue viva para el resto.
            try { onError(err, status); } catch { /* el notificador no puede tumbar el job */ }
        });
        return cadena;
    };

    /** Espera a que se drene todo lo encolado hasta ahora. */
    escribir.drain = () => cadena;
    escribir.contentId = contentId;
    return escribir;
}
