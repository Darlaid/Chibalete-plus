/**
 * xpRecognitionHarness.mjs — CHP-GAMIFICACION-G4-05A-4.
 *
 * Liberaba `mook_review` de `XP_LOCKED_SOURCES` solo en el proceso de prueba.
 * Desde V8-ACTIVATE-PREP-01 el código real ya no la bloquea para XP (solo por
 * reconocimiento, nunca por `facts` ni con PM): el hook no cambia nada y se
 * conserva para que las suites que lo importan carguen igual.
 */
import { register } from 'node:module';

register(new URL('./xpRecognitionHooks.mjs', import.meta.url));
