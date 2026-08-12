/**
 * identityLiveSources.mjs — CHP-IDDB-RECONCILE-LIVE-SOURCES-01.
 *
 * Contrato LIVE de fuentes canónicas para la reconciliación productiva.
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * --------------------------
 * `readSources()` del reconciliador mezcla dos contratos distintos en una sola
 * función: autoriza la ruta, FIJA el contenido contra el sha256 congelado del
 * manifiesto de importación, y parsea. Ese pin es correcto para atestiguar una
 * migración histórica reproducible (CHP-IDDB-02A) y es EQUIVOCADO para
 * reconciliar contra el estado canónico de hoy: cualquier escritura productiva
 * legítima sobre `groups_db.json` —un mediador añadiendo un estudiante, o la
 * propia normalización de `normalizeGroup`— aborta el instrumento con
 * SOURCE_HASH_MISMATCH aunque el dominio lógico sea perfectamente correcto.
 * Detectado en producción durante CHP-IDDB-02B-D-B.
 *
 * La separación NO se hace debilitando el pin, sino dándole al modo LIVE un
 * conjunto de garantías PROPIAS que no dependen de conocer el contenido de
 * antemano. El modo FROZEN queda intacto en `reconcileIdentityShadow.mjs`.
 *
 * QUÉ GARANTIZA EL MODO LIVE (todo fail-closed)
 * ---------------------------------------------
 *  1. Ruta canónica exacta: la fuente se DERIVA de la raíz declarada más un
 *     basename fijo por rol. No se acepta una ruta arbitraria, así que no hay
 *     forma de apuntar el reconciliador a otro fichero «por descuido».
 *  2. Sin fallback a stores legacy: se rechazan además, por basename, el padrón
 *     superseded (`users_db.json`), backups, `.env` y los stores de telemetría.
 *  3. Fichero existente.            4. Fichero legible.
 *  5. JSON parseable.               6. Forma esperada: array NO vacío.
 *  7. Claves requeridas: todo registro es un objeto con `id` no vacío; las
 *     instituciones exigen además `name` no vacío.
 *  8. Sin duplicados incompatibles: dos registros con el mismo `id` solo se
 *     toleran si son idénticos campo a campo.
 *  9. Cohorte sintética contabilizada y excluida por contrato.
 * 10. Invariantes estructurales cruzadas entre las tres fuentes.
 * 11. Hash ACTUAL calculado y devuelto como EVIDENCIA de la corrida.
 * 12. Identidad de fuente canónica inequívoca: rol → ruta → hash.
 *
 * EL HASH ACTUAL ES EVIDENCIA, NO UNA ALLOWLIST
 * ---------------------------------------------
 * Los hashes que devuelve este módulo se registran en el reporte de cada
 * ejecución para poder auditar CONTRA QUÉ BYTES se reconcilió. Jamás se
 * comparan contra los de una corrida anterior ni se persisten como pin: hacerlo
 * reintroduciría exactamente el defecto que este módulo corrige.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { ImportError, canonicalJson, FORBIDDEN_SOURCE_BASENAMES } from './importIdentityCandidate.mjs';

const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

/**
 * Disposición canónica de las fuentes vivas, relativa a la raíz de datos del
 * despliegue. Es deliberadamente la MISMA que en producción (`data/` y
 * `data-critical/`), de modo que una fixture correcta y el VPS se validan con
 * el mismo contrato.
 */
export const CANONICAL_LIVE_SOURCES = {
    padron: { dir: 'data-critical', basename: 'usuarios_colegios_oro.json', label: 'padrón' },
    groups: { dir: 'data', basename: 'groups_db.json', label: 'grupos' },
    institutions: { dir: 'data', basename: 'schools_db.json', label: 'instituciones' },
};

/**
 * Basenames que jamás pueden actuar como fuente viva, por encima de la
 * comprobación de ruta canónica. Redundante a propósito: si algún día la
 * derivación de rutas cambiara, esta reja sigue en pie.
 */
export const FORBIDDEN_LIVE_BASENAMES = [
    ...FORBIDDEN_SOURCE_BASENAMES,
    /^\.env/i, /^events\.db$/i, /^progress\.db$/i, /\.candidate\.db$/i,
];

function assertNotForbidden(p, label) {
    const base = path.basename(p);
    for (const re of FORBIDDEN_LIVE_BASENAMES) {
        if (re.test(base)) {
            throw new ImportError('LIVE_SOURCE_NOT_AUTHORIZED',
                `${label}: fuente no autorizada "${base}"`);
        }
    }
}

/** Lee y valida UNA fuente viva. Devuelve `{ json, sha256, path, count }`. */
function readLiveSource(sourcesRoot, role) {
    const spec = CANONICAL_LIVE_SOURCES[role];
    if (!spec) throw new ImportError('LIVE_SOURCE_ROLE_UNKNOWN', String(role));
    const abs = path.resolve(sourcesRoot, spec.dir, spec.basename);
    const label = spec.label;

    // (1)(2) ruta canónica por construcción + reja de basenames prohibidos.
    assertNotForbidden(abs, label);
    if (path.basename(abs) !== spec.basename) {
        throw new ImportError('LIVE_SOURCE_NOT_CANONICAL',
            `${label}: se esperaba "${spec.basename}"`);
    }

    // (3) existencia
    if (!fs.existsSync(abs)) throw new ImportError('LIVE_SOURCE_NOT_FOUND', `${label}: ${abs}`);
    const st = fs.statSync(abs);
    if (!st.isFile()) throw new ImportError('LIVE_SOURCE_NOT_A_FILE', `${label}: ${abs}`);

    // (4) legibilidad
    let buf;
    try { buf = fs.readFileSync(abs); }
    catch (e) { throw new ImportError('LIVE_SOURCE_UNREADABLE', `${label}: ${e.message}`); }

    // (5) JSON válido
    let json;
    try { json = JSON.parse(buf.toString('utf8')); }
    catch (e) { throw new ImportError('LIVE_SOURCE_MALFORMED_JSON', `${label}: ${e.message}`); }

    // (6) forma esperada. Sin esta reja un objeto o un array vacío se
    // proyectarían como CERO filas en silencio —`Array.isArray(x) ? x : []`— y
    // el reconciliador lo leería como «todo el padrón desapareció», no como
    // «me han dado el fichero equivocado».
    if (!Array.isArray(json)) {
        throw new ImportError('LIVE_SOURCE_SHAPE_INVALID',
            `${label}: se esperaba un array, llegó ${json === null ? 'null' : typeof json}`);
    }
    if (json.length === 0) throw new ImportError('LIVE_SOURCE_EMPTY', label);

    // (7) claves requeridas
    for (const [i, rec] of json.entries()) {
        if (!rec || typeof rec !== 'object' || Array.isArray(rec)) {
            throw new ImportError('LIVE_SOURCE_RECORD_NOT_OBJECT', `${label}: índice ${i}`);
        }
        if (!String(rec.id ?? '').trim()) {
            throw new ImportError('LIVE_SOURCE_RECORD_WITHOUT_ID', `${label}: índice ${i}`);
        }
        if (role === 'institutions' && !String(rec.name ?? '').trim()) {
            throw new ImportError('LIVE_SOURCE_INSTITUTION_WITHOUT_NAME', `${label}: índice ${i}`);
        }
    }

    // (8) duplicados incompatibles
    const byId = new Map();
    for (const rec of json) {
        const id = String(rec.id);
        const prev = byId.get(id);
        if (prev === undefined) { byId.set(id, canonicalJson(rec)); continue; }
        if (prev !== canonicalJson(rec)) {
            throw new ImportError('LIVE_SOURCE_DUPLICATE_IDENTITY', `${label}: id repetido y divergente`);
        }
    }

    return { json, sha256: sha256(buf), path: abs, count: json.length, distinctIds: byId.size };
}

/**
 * Resuelve las tres fuentes vivas desde una raíz canónica.
 *
 * @param {{sourcesRoot:string}} opts
 * @returns {{sources:{users:any[],groups:any[],institutions:any[]}, attestation:object}}
 */
export function resolveLiveSources({ sourcesRoot } = {}) {
    if (!sourcesRoot) {
        throw new ImportError('LIVE_SOURCES_ROOT_REQUIRED', 'se exige --sources-root en modo live');
    }
    const root = path.resolve(sourcesRoot);
    if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        throw new ImportError('LIVE_SOURCES_ROOT_NOT_FOUND', root);
    }

    const padron = readLiveSource(root, 'padron');
    const groups = readLiveSource(root, 'groups');
    const institutions = readLiveSource(root, 'institutions');

    // (9) cohorte sintética: se contabiliza aquí y el reconciliador verifica
    // después que NINGUNA de estas identidades sobrevivió a la proyección.
    const syntheticIds = padron.json.filter(u => u?._loadtest_marker).map(u => String(u.id));

    // (10) invariantes estructurales cruzadas.
    //
    // OJO — lo que NO se exige, y por qué: NO se exige que todo grupo tenga
    // `organizationId`, ni que ese `organizationId` resuelva a una institución
    // conocida. En producción hoy hay 20 grupos de los que solo 5 llevan
    // `organizationId`, y uno de ellos (`lt-test-group-v2` → `lt-org`) apunta
    // deliberadamente a una organización inexistente por ser carga de prueba
    // excluida en `migration_exclusions`. Exigirlo rompería el instrumento con
    // datos legítimos, que es justo el defecto que esta unidad corrige.
    // Lo que sí se exige es que la parte del grafo que SÍ se espeja sea
    // coherente: al menos una institución y al menos un grupo resoluble.
    const instIds = new Set(institutions.json.map(i => String(i.id)));
    const resolvable = groups.json.filter(g => instIds.has(String(g.organizationId ?? '')));
    if (resolvable.length === 0) {
        throw new ImportError('LIVE_SOURCE_NO_RESOLVABLE_GROUP',
            'ningún grupo referencia una institución conocida: fuentes incoherentes entre sí');
    }
    const realUsers = padron.count - syntheticIds.length;
    if (realUsers <= 0) {
        throw new ImportError('LIVE_SOURCE_PADRON_ONLY_SYNTHETIC',
            'el padrón no contiene ninguna identidad real');
    }

    return {
        sources: { users: padron.json, groups: groups.json, institutions: institutions.json },
        syntheticIds,
        // (11)(12) evidencia de la corrida: rol → ruta → hash actual.
        attestation: {
            sourceMode: 'live',
            sourcesRoot: root,
            canonicalSourceIdentity: {
                padron: { path: padron.path, sha256: padron.sha256, records: padron.count },
                groups: { path: groups.path, sha256: groups.sha256, records: groups.count },
                institutions: { path: institutions.path, sha256: institutions.sha256,
                    records: institutions.count },
            },
            accounting: {
                padronRecords: padron.count,
                padronSynthetic: syntheticIds.length,
                padronReal: realUsers,
                groupRecords: groups.count,
                groupsResolvableToInstitution: resolvable.length,
                institutionRecords: institutions.count,
            },
            hashesArePinned: false,
            note: 'hashes registrados como evidencia de la corrida; NUNCA como allowlist histórica',
        },
    };
}
