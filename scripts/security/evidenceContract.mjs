/**
 * CHP-SEC-ADMIN-EVIDENCE-HARDEN-01B — Contrato de evidencia operativa segura.
 *
 * PRINCIPIO CENTRAL (vinculante):
 *
 *   La evidencia se genera SELECCIONANDO campos permitidos.
 *   Nunca copiando el objeto completo y redactando después.
 *
 * La diferencia no es estilística. Redactar-después falla en silencio ante
 * cualquier campo nuevo: cuando Docker añada `Config.NewSecretThing`, un
 * redactor por lista negra lo copiará tal cual. Un proyector por allowlist
 * simplemente no lo verá.
 *
 * Evidencia de que esto importa (CHP-SEC-AI-PROVIDER-KEYS-ROTATE-01A):
 *   - `docker inspect` crudo persistió las dos claves completas en dos
 *     snapshots de m1-hardening y en un `containers.inspect.json` de release;
 *   - `docker compose config` efectivo persistió las mismas variables;
 *   - quitarle UNA variable a un `.env` copiado no lo dejó limpio, porque
 *     contenía otras credenciales.
 */

export const EVIDENCE_CONTRACT_VERSION = '1.0.0';

/**
 * Campos permitidos de un contenedor. Cada entrada es una proyección explícita
 * desde el objeto de `docker inspect` hacia el objeto de evidencia.
 *
 * `path` es la ruta de lectura; `as` el nombre en la salida. Nada que no esté
 * aquí llega jamás a un archivo.
 */
export const CONTAINER_ALLOWLIST = Object.freeze([
    { as: 'name', path: ['Name'], transform: (v) => (typeof v === 'string' ? v.replace(/^\//, '') : null) },
    { as: 'imageId', path: ['Image'] },
    { as: 'imageRef', path: ['Config', 'Image'] },
    { as: 'status', path: ['State', 'Status'] },
    { as: 'health', path: ['State', 'Health', 'Status'] },
    { as: 'restartCount', path: ['RestartCount'] },
    { as: 'created', path: ['Created'] },
    { as: 'startedAt', path: ['State', 'StartedAt'] },
    { as: 'restartPolicy', path: ['HostConfig', 'RestartPolicy', 'Name'] },
    { as: 'memoryLimitBytes', path: ['HostConfig', 'Memory'] },
    { as: 'memoryReservationBytes', path: ['HostConfig', 'MemoryReservation'] },
    { as: 'nanoCpus', path: ['HostConfig', 'NanoCpus'] },
    { as: 'cpuShares', path: ['HostConfig', 'CpuShares'] },
]);

/**
 * Labels que pueden publicarse tal cual. Cualquier otro label se reporta solo
 * por nombre: un label es texto libre controlado por quien construye la imagen
 * y ha llevado tokens de CI más de una vez en la industria.
 */
export const LABEL_ALLOWLIST = Object.freeze([
    'com.docker.compose.project',
    'com.docker.compose.service',
    'org.opencontainers.image.revision',
    'org.opencontainers.image.version',
    'org.opencontainers.image.created',
    'chibalete.commit',
    'chibalete.deployed_at',
]);

/**
 * Nombres de variable cuyo VALOR puede publicarse como evidencia.
 *
 * Esta es la allowlist que hace útil la unidad: probar que
 * `LEGACY_METRICS_REQUEST_CONTEXT=off` es exactamente lo que hay que
 * demostrar en cada despliegue, y no exige volcar el entorno entero.
 *
 * Regla: se añaden banderas de comportamiento y modos. Nunca rutas con
 * información de topología, nunca nada cuyo valor no sea un enum corto.
 * Cualquier variable ausente de esta lista sale como `[REDACTED]`, incluso si
 * su nombre no parece sensible — porque el hallazgo #7 de la unidad anterior
 * fue precisamente una clave sin nombre obvio.
 */
export const ENV_VALUE_ALLOWLIST = Object.freeze([
    'NODE_ENV',
    'LOG_LEVEL',
    'AI_MODE',
    'TTS_MODE',
    'METRICS_ENABLED',
    'METRICS_ENGINE',
    'LEGACY_METRICS_REQUEST_CONTEXT',
    'INSIGHTS_MATERIALIZER_ENABLED',
    'ACCESS_FALLBACK_MODE',
    'UV_THREADPOOL_SIZE',
    'IMMERSIVE_V2_KILLSWITCH',
    'IMMERSIVE_V2_COHORT_PCT',
    'PRAGMA_TUNING_ENABLED',
    'IDENTITY_DUAL_WRITE',
    'IDENTITY_READ',
    'OTEL_ENABLED',
    // Configuración pública por definición: la allowlist CORS viaja en las
    // cabeceras de respuesta y la base de medios es una URL de CDN. Verificar
    // su valor es un requisito operativo real (preflight de despliegue).
    'ALLOWED_ORIGINS',
    'MEDIA_BASE_URL',
]);

const ENV_VALUE_SET = new Set(ENV_VALUE_ALLOWLIST);

/** ¿Puede publicarse el valor de esta variable? */
export const isPublishableEnvValue = (name) => ENV_VALUE_SET.has(String(name ?? '').toUpperCase());

/**
 * Campos que NUNCA salen, en ningún formato, por ninguna ruta. La lista es
 * documental: la garantía real es que el proyector no los lee. Se usa en el
 * test de contrato para detectar si alguien añade una proyección prohibida.
 */
export const FORBIDDEN_EVIDENCE_FIELDS = Object.freeze([
    'Config.Env',              // valores de entorno — el hallazgo original
    'Config.Cmd',              // argumentos de comando: pueden llevar secretos
    'Config.Entrypoint',
    'Config.Healthcheck.Test', // healthchecks con URLs firmadas
    'HostConfig.Binds',        // rutas crudas del host, sin sanitizar
    'GraphDriver',             // rutas internas del almacenamiento
    'NetworkSettings.Networks.*.IPAddress',
    'secrets',
    'auths',
    'registry',
    'X-Registry-Auth',
]);

/**
 * Formatos de evidencia admitidos. `text` existe solo como último recurso y
 * está prohibido para evidence packs definitivos cuando hay formato estructurado.
 */
export const EVIDENCE_FORMATS = Object.freeze({
    json: { canonical: true, redaction: 'structural' },
    manifest: { canonical: true, redaction: 'structural' },
    summary: { canonical: true, redaction: 'projection-only' },
    text: { canonical: false, redaction: 'best-effort', definitiveEvidence: false },
});

/** Lee una ruta anidada sin lanzar. */
const readPath = (obj, path) => path.reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);

/**
 * Proyecta un objeto de `docker inspect` al objeto de evidencia permitido.
 * El objeto de entrada NO se muta ni se conserva.
 *
 * @param {object} inspected  un elemento del array de `docker inspect`
 * @returns {object} objeto nuevo, construido campo a campo
 */
export const projectContainer = (inspected) => {
    const out = {};
    for (const field of CONTAINER_ALLOWLIST) {
        const value = readPath(inspected, field.path);
        const projected = field.transform ? field.transform(value) : value;
        out[field.as] = projected === undefined ? null : projected;
    }
    return out;
};

/**
 * Proyecta labels: los permitidos con valor, el resto solo por nombre.
 */
export const projectLabels = (labels) => {
    const allowed = {};
    const namesOnly = [];
    for (const [k, v] of Object.entries(labels ?? {})) {
        if (LABEL_ALLOWLIST.includes(k)) allowed[k] = v;
        else namesOnly.push(k);
    }
    return { allowed, namesOnly: namesOnly.sort() };
};

/**
 * Proyecta mounts: tipo, destino, modo y una ruta de origen SANEADA.
 *
 * La ruta de origen se recorta a su forma estructural (se conserva el prefijo
 * conocido y se sustituye el resto por un marcador) porque las rutas absolutas
 * del host filtran topología y, en algunos despliegues, nombres de cliente.
 */
export const sanitizeMountSource = (source) => {
    if (typeof source !== 'string' || source === '') return null;
    const known = ['/var/www/chibalete', '/opt/chibaleteplus', '/var/lib/docker'];
    const hit = known.find((prefix) => source === prefix || source.startsWith(prefix + '/'));
    if (hit) {
        const rest = source.slice(hit.length).replace(/^\//, '');
        return rest ? `${hit}/${rest.split('/')[0]}${rest.includes('/') ? '/…' : ''}` : hit;
    }
    // Ruta desconocida: se publica solo su forma, nunca su contenido.
    const depth = source.split('/').filter(Boolean).length;
    return `<ruta-no-reconocida depth=${depth}>`;
};

export const projectMounts = (mounts) =>
    (Array.isArray(mounts) ? mounts : []).map((m) => ({
        type: m?.Type ?? null,
        source: sanitizeMountSource(m?.Source),
        destination: m?.Destination ?? null,
        readOnly: m?.RW === undefined ? null : !m.RW,
    }));

/**
 * Proyecta redes: nombre y alias. Nunca IP ni credenciales de red.
 */
export const projectNetworks = (networks) =>
    Object.entries(networks ?? {}).map(([name, cfg]) => ({
        name,
        aliases: Array.isArray(cfg?.Aliases) ? [...cfg.Aliases].sort() : [],
    }));
