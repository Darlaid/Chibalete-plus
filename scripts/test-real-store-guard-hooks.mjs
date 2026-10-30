/**
 * test-real-store-guard-hooks.mjs — CHP-GAMIFICACION-SAFE-01.
 *
 * Node 20 no consulta `require.cache` al hacer `import` de un paquete CJS, así
 * que `import Database from 'better-sqlite3'` recibiría el constructor sin
 * guard. Este hook lo redirige al módulo puente, que lo obtiene por `require`.
 */
const BRIDGE = new URL('./test-real-store-guard-sqlite.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
    if (specifier === 'better-sqlite3' && context.parentURL !== BRIDGE) return { url: BRIDGE, shortCircuit: true };
    return next(specifier, context);
}
