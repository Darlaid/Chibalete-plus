/**
 * a1TestHooks.mjs — CHP-V8.1-CLOSE-06A (G-01).
 * Hook de carga SOLO para pruebas (lo registra testA1Hook.mjs desde testMode.mjs): en las
 * suites del motor XP que no tratan A1, la puerta A1 de `a2Registry.mjs` concede.
 * Con `CHP_TEST_A1=real` la puerta es la real; así la usan la suite G-01
 * (`xpA1Eligibility.test.mjs`) y todo servidor que la suite lance con esa variable.
 * El código de producción no contiene ninguna excepción: este archivo solo se
 * carga en procesos de prueba (testMode.mjs y sus subprocesos).
 */
const ANCHOR = 'export function a1Gate(env = process.env, now = Date.now()) {';

export async function load(url, context, nextLoad) {
    const out = await nextLoad(url, context);
    if (!url.endsWith('/server/privacy/a2Registry.mjs')) return out;
    const source = String(out.source);
    if (!source.includes(ANCHOR)) throw new Error('a1TestHooks: a1Gate no encontrado en a2Registry.mjs');
    return { ...out, source: source.replace(ANCHOR, `${ANCHOR}\n    if ((env.CHP_TEST_A1 ?? process.env.CHP_TEST_A1) !== 'real') return { allowsAt: () => true };`) };
}
