/**
 * pmMechanicsHooks.mjs — CHP-GAMIFICACION-SAFE-01.
 *
 * Hook de carga SOLO para pruebas: al cargar `policy.mjs` quita `mission`
 * de `PM_LOCKED_SOURCES` en ese proceso. Las demás fuentes siguen bloqueadas.
 * Ver pmMechanicsHarness.mjs.
 */
const LOCKS = /PM_LOCKED_SOURCES = Object\.freeze\(\[[^\]]*\]\)/;

export async function load(url, context, nextLoad) {
    const out = await nextLoad(url, context);
    if (!url.endsWith('/server/gamification/policy.mjs')) return out;
    const source = String(out.source);
    if (!LOCKS.test(source)) throw new Error('pmMechanicsHooks: PM_LOCKED_SOURCES no encontrado en policy.mjs');
    return { ...out, source: source.replace(LOCKS, (m) => m.replace("'mission', ", '')) };
}
