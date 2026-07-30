/**
 * target-guard.mjs — CHP-STATS-SHADOW-PERF-01D-CHKPT.
 *
 * Barrera de destino para los clientes del banco de pruebas.
 *
 * Estos scripts generan carga sostenida. Apuntarlos por accidente a un host
 * real —un manifiesto reutilizado, una variable heredada, un copiar y pegar—
 * sería un ataque de denegación de servicio contra la propia plataforma. La
 * barrera hace que eso requiera una decisión explícita, y que contra los
 * dominios públicos sea directamente imposible.
 *
 * Reglas, en orden:
 *   1. los dominios públicos de la plataforma están PROHIBIDOS siempre, aunque
 *      se pase `--allowRemote`;
 *   2. sin `--allowRemote`, solo se permiten destinos locales o de red interna
 *      de contenedores;
 *   3. `--allowRemote` exige además `--iUnderstandThisGeneratesLoad`.
 */

/** Dominios que jamás pueden recibir carga del banco, con o sin confirmación. */
const FORBIDDEN_SUFFIXES = [
    'chibaleteplus.com',
    'chibaleteeditores.com',
];

/** Destinos considerados seguros sin confirmación explícita. */
const LOOPBACK_NAMES = new Set(['localhost', '::1', '0.0.0.0']);

/** Todo el bloque 127.0.0.0/8 es loopback, no solo 127.0.0.1. */
const isLoopback = (h) => LOOPBACK_NAMES.has(h) || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(h);

/**
 * Nombres de servicio del banco efímero. Solo resuelven dentro de la red
 * Docker interna, así que no pueden alcanzar nada externo.
 */
const INTERNAL_HOST_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/i;

export class UnsafeTargetError extends Error {
    constructor(message) {
        super(message);
        this.name = 'UnsafeTargetError';
        this.code = 'UNSAFE_BENCHMARK_TARGET';
    }
}

/** ¿El host es un nombre con puntos (dominio) o una IP no loopback? */
function looksExternal(host) {
    if (isLoopback(host)) return false;
    // Un nombre de servicio de Docker no lleva puntos; un dominio o IP sí.
    if (!host.includes('.') && !host.includes(':')) return !INTERNAL_HOST_PATTERN.test(host);
    return true;
}

/**
 * Valida el destino antes de emitir una sola petición.
 *
 * @param {string} host
 * @param {object} opts
 * @param {boolean} [opts.allowRemote]
 * @param {boolean} [opts.acknowledged]  confirmación de que esto genera carga
 * @returns {{host: string, classification: 'loopback'|'internal'|'remote'}}
 */
export function assertSafeTarget(host, { allowRemote = false, acknowledged = false } = {}) {
    if (!host || typeof host !== 'string') {
        throw new UnsafeTargetError('destino vacío: el manifiesto debe declarar `host`');
    }
    const h = host.trim().toLowerCase().replace(/^\[|\]$/g, '');

    for (const suffix of FORBIDDEN_SUFFIXES) {
        if (h === suffix || h.endsWith(`.${suffix}`)) {
            throw new UnsafeTargetError(
                `destino PROHIBIDO: "${host}" pertenece a un dominio productivo de la plataforma. ` +
                'El banco de pruebas no puede generar carga contra producción bajo ninguna bandera.');
        }
    }

    if (isLoopback(h)) return { host: h, classification: 'loopback' };

    if (!looksExternal(h)) return { host: h, classification: 'internal' };

    if (!allowRemote) {
        throw new UnsafeTargetError(
            `destino no local: "${host}". Este script genera carga sostenida. ` +
            'Si de verdad es un entorno de pruebas aislado, repite con ' +
            '--allowRemote --iUnderstandThisGeneratesLoad');
    }
    if (!acknowledged) {
        throw new UnsafeTargetError(
            '--allowRemote requiere además --iUnderstandThisGeneratesLoad');
    }
    return { host: h, classification: 'remote' };
}

/** Azúcar para los clientes: lee las banderas del objeto de argumentos. */
export function guardFromArgs(host, args = {}) {
    return assertSafeTarget(host, {
        allowRemote: Boolean(args.allowRemote),
        acknowledged: Boolean(args.iUnderstandThisGeneratesLoad),
    });
}
