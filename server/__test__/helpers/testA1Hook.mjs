/**
 * testA1Hook.mjs — CHP-V8.1-CLOSE-06A (G-01).
 *
 * Solo pruebas: registra `a1TestHooks.mjs` en este proceso. `testMode.mjs` lo carga
 * y lo hereda a todo subproceso (`NODE_OPTIONS`), como el guard y la clave de prueba.
 * Producción no lo carga nunca.
 */
import { register } from 'node:module';

if (process.env.NODE_ENV !== 'production') register(new URL('./a1TestHooks.mjs', import.meta.url));
