/**
 * pmMechanicsHarness.mjs — CHP-GAMIFICACION-SAFE-01.
 *
 * Desde SAFE-01 ninguna fuente puede emitir PM, así que `recordFact` ya no
 * alcanza el código de movimientos `earn`, topes y saldo. Para seguir probando
 * esas invariantes sin dejar una fuente ni un atajo en producción, este arnés
 * registra un hook de carga que libera solo `mission` en ESTE proceso de prueba:
 * sus hechos hacen de hechos sintéticos.
 *
 * Debe importarse antes que `policy.mjs`. Nada fuera de __test__ lo importa (hay
 * prueba), y `emissionLocks.test.mjs` verifica el bloqueo real sin este arnés.
 */
import { register } from 'node:module';

register(new URL('./pmMechanicsHooks.mjs', import.meta.url));
