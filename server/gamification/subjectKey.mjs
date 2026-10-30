/**
 * subjectKey.mjs — CHP-GAMIFICACION-PRIV-01B.
 *
 * Clave de servidor del modelo de sujeto. Vive en un archivo de secreto, con el
 * lector estricto del repositorio (`readSecretFile`): sin valor por defecto, sin
 * variable de entorno y sin ruta configurable. Si no está, las operaciones que
 * la necesitan fallan: nunca se recurre a un valor sustituto.
 *
 * `readSecretFile` es asíncrono y `recordFact` es síncrono dentro de una
 * transacción, así que la clave se carga una vez en memoria. Rotarla invalida
 * las claves derivadas: la rotación necesita su propia unidad.
 */
import { readSecretFile } from '../lib/secretFile.js';

export const SUBJECT_KEY_PATH = '/app/secrets/gamification_subject_key';
export const SUBJECT_KEY_MIN_LENGTH = 32;

let _key = null;

const unavailable = () => Object.assign(new Error('clave de sujeto no disponible'), { name: 'GamificationError', code: 'SUBJECT_KEY_UNAVAILABLE' });

/** Instala la clave ya leída. Rechaza lo que no tenga la longitud mínima. */
export function installSubjectKey(key) {
    if (typeof key !== 'string' || key.length < SUBJECT_KEY_MIN_LENGTH) throw unavailable();
    _key = key;
}

/** Lee el archivo de secreto. Si falla, la clave sigue ausente y lanza. */
export async function loadSubjectKey({ read = readSecretFile, path = SUBJECT_KEY_PATH } = {}) {
    if (_key) return;
    installSubjectKey(await read(path));
}

export const hasSubjectKey = () => _key !== null;

/** @throws SUBJECT_KEY_UNAVAILABLE */
export function getSubjectKey() {
    if (!_key) throw unavailable();
    return _key;
}

/** Solo para pruebas y parada ordenada. */
export function clearSubjectKey() {
    _key = null;
}
