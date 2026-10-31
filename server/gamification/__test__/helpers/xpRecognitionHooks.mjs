/**
 * xpRecognitionHooks.mjs — CHP-GAMIFICACION-G4-05A-4.
 * Hook de carga SOLO para pruebas: quita `mook_review` de `XP_LOCKED_SOURCES`.
 * Ver xpRecognitionHarness.mjs.
 */
const LOCK = /XP_LOCKED_SOURCES = Object\.freeze\(\[[^\]]*\]\)/;

export async function load(url, context, nextLoad) {
    const out = await nextLoad(url, context);
    if (!url.endsWith('/server/gamification/policy.mjs')) return out;
    const source = String(out.source);
    if (!LOCK.test(source)) throw new Error('xpRecognitionHooks: XP_LOCKED_SOURCES no encontrado en policy.mjs');
    return { ...out, source: source.replace(LOCK, (m) => m.replace("'mook_review', ", '')) };
}
