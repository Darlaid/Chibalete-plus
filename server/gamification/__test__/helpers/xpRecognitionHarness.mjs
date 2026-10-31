/**
 * xpRecognitionHarness.mjs — CHP-GAMIFICACION-G4-05A-4.
 *
 * `mook_review` sigue bloqueada para XP en producción. Para probar la emisión por
 * obra y ciclo sin dejar un atajo, este arnés registra un hook de carga que la
 * libera solo en ESTE proceso de prueba, como pmMechanicsHarness con `mission`.
 * El bloqueo de PM no cambia. Debe importarse antes que `policy.mjs`.
 */
import { register } from 'node:module';

register(new URL('./xpRecognitionHooks.mjs', import.meta.url));
