/**
 * bench-loader.mjs — CHP-STATS-SHADOW-PERF-01D.
 *
 * Hook de carga ESM **exclusivo del banco de pruebas**. Envuelve las dos
 * fábricas del shadow para que `bench-probe.mjs` pueda leer sus contadores.
 *
 * Por qué un hook y no un endpoint: los contadores viven en instancias creadas
 * en scope de módulo dentro de `server.js`. Exponerlos requeriría añadir una
 * ruta de diagnóstico al servidor productivo — superficie nueva que esta unidad
 * no está autorizada a crear. El hook consigue lo mismo sin tocar una sola
 * línea de código de producción: la transformación vive aquí y solo se activa
 * cuando el proceso arranca con `--import scripts/perf/bench-probe.mjs`.
 *
 * La transformación es una sustitución única y **verificada**: si el texto
 * esperado no aparece, se lanza en vez de continuar con instrumentación muda.
 */

/** Módulos interceptados → nombre de la fábrica y cubo del registro. */
const TARGETS = new Map([
    ['/metrics/shadowExecutor.mjs',   { fn: 'createShadowExecutor',   bucket: 'executors' }],
    ['/metrics/shadowWorkerPool.mjs', { fn: 'createShadowWorkerPool', bucket: 'pools' }],
]);

export async function load(url, context, nextLoad) {
    const result = await nextLoad(url, context);

    const key = [...TARGETS.keys()].find((suffix) => url.endsWith(suffix));
    if (!key || result.format !== 'module' || result.source == null) return result;

    const { fn, bucket } = TARGETS.get(key);
    const source = String(result.source);
    const needle = `export function ${fn}(`;

    if (!source.includes(needle)) {
        // Fallar ruidosamente: una instrumentación silenciosamente inerte
        // produciría un benchmark sin contadores de servidor, que es peor que
        // ningún benchmark.
        throw new Error(`bench-loader: no se encontró "${needle}" en ${url}`);
    }

    const rewritten = source.replace(needle, `function __benchOriginal_${fn}(`);
    const wrapper = `
export function ${fn}(...args) {
    const instance = __benchOriginal_${fn}(...args);
    const registry = (globalThis.__CHP_BENCH__ ??= { executors: [], pools: [] });
    registry.${bucket}.push(instance);
    return instance;
}
`;

    return { ...result, source: rewritten + wrapper };
}
