/**
 * testSubjectKey.mjs — CHP-GAMIFICACION-PRIV-01B.
 *
 * Solo pruebas: instala la clave de sujeto que `testMode.mjs` genera al azar para
 * cada ejecución. Producción no la tiene: lee el archivo de secreto o falla.
 */
import { installSubjectKey } from '../../gamification/subjectKey.mjs';

if (process.env.CHP_TEST_SUBJECT_KEY && process.env.NODE_ENV !== 'production') installSubjectKey(process.env.CHP_TEST_SUBJECT_KEY);
