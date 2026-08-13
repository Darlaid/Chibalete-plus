/**
 * identityGroupDomains.js — CHP-IDDB-02C-GAP3-GROUPS-01.
 *
 * Frontera EXPLÍCITA de dominios de lectura del dominio `groups`:
 *
 *   groupId
 *     ↓ classifyGroupReadDomain(db, groupId)
 *   CANONICAL                → candidato SQLite (JSON sigue oficial en shadow)
 *   ATTESTED_LEGACY_COMPAT   → JSON explícito + telemetría de compatibilidad
 *   ATTESTED_SYNTHETIC_COMPAT→ JSON explícito + telemetría de compatibilidad
 *   UNKNOWN                  → fail-closed (excluido de toda vista compuesta)
 *
 * FUENTE ÚNICA Y ATESTADA (GAP3-00 F1): identity.db.
 *   - compat  = `migration_exclusions(entity='group')`, cuya `disposition`
 *     distingue LEGACY_TEST_GROUP_PENDING_RETIREMENT (15) de
 *     SYNTHETIC_LOADTEST_EXCLUDED (1). Son las exclusiones ATESTADAS de
 *     01C-R1/02A, versionadas en la base — no una segunda lista manual.
 *   - canonical = fila viva en `groups` CON institución registrada en
 *     `institutions`. «Existe en SQLite» NO basta: una fila espuria sin
 *     institución registrada clasifica UNKNOWN (mismo contrato que aplica
 *     mirrorSnapshotV2 y la absence policy del comparador).
 *
 * PROHIBIDO por diseño: clasificar por nombre, por grade textual, por
 * heurística o por «no está en SQLite». Jamás `SQLite miss → JSON fallback`
 * silencioso: la clasificación ocurre ANTES de elegir el backend, y un
 * UNKNOWN queda fuera de la vista compuesta (los consumidores responden su
 * NOT_FOUND contractual). El fallback recovery-first del facade (cualquier
 * error ⇒ lectura oficial JSON completa, contada en métricas) se conserva:
 * ese camino restaura el comportamiento actual íntegro, no inventa datos.
 *
 * Este módulo es puro: recibe el handle de better-sqlite3 y rutas; no importa
 * identityDb ni métricas (la telemetría se inyecta por callback) para que el
 * tooling read-only pueda usarlo sin arrastrar el runtime.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

export const GROUP_DOMAIN = Object.freeze({
    CANONICAL: 'CANONICAL',
    ATTESTED_LEGACY_COMPAT: 'ATTESTED_LEGACY_COMPAT',
    ATTESTED_SYNTHETIC_COMPAT: 'ATTESTED_SYNTHETIC_COMPAT',
    UNKNOWN: 'UNKNOWN',
});

export const DISPOSITION_LEGACY = 'LEGACY_TEST_GROUP_PENDING_RETIREMENT';
export const DISPOSITION_SYNTHETIC = 'SYNTHETIC_LOADTEST_EXCLUDED';

/** Marca de procedencia por registro (no enumerable: invisible en res.json). */
export const GROUP_DOMAIN_MARKER = Symbol.for('chp.identity.groupDomain');

const h16 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/**
 * Mapa hash→disposition de las exclusiones ATESTADAS de grupos.
 * Fuente compartida con la absence policy del comparador (una sola regla).
 */
export function attestedGroupExclusionMap(db) {
    try {
        return new Map(db.prepare(
            `SELECT reference_hash, disposition FROM migration_exclusions WHERE entity='group'`)
            .all().map(r => [r.reference_hash, r.disposition]));
    } catch { return new Map(); }
}

function domainForDisposition(disposition) {
    return disposition === DISPOSITION_SYNTHETIC
        ? GROUP_DOMAIN.ATTESTED_SYNTHETIC_COMPAT
        : GROUP_DOMAIN.ATTESTED_LEGACY_COMPAT;
}

/**
 * Clasifica un groupId contra la fuente atestada. Determinista y fail-closed:
 * todo lo no demostrado es UNKNOWN.
 *
 * @param {import('better-sqlite3').Database} db  identity.db (RO suficiente)
 * @param {string} groupId
 * @param {Map<string,string>} [exclMap]  mapa precalculado (para bucles)
 * @returns {'CANONICAL'|'ATTESTED_LEGACY_COMPAT'|'ATTESTED_SYNTHETIC_COMPAT'|'UNKNOWN'}
 */
export function classifyGroupReadDomain(db, groupId, exclMap = null) {
    const id = String(groupId ?? '');
    if (!id) return GROUP_DOMAIN.UNKNOWN;
    const excl = exclMap ?? attestedGroupExclusionMap(db);
    const disposition = excl.get(h16(id));
    if (disposition !== undefined) return domainForDisposition(disposition);
    try {
        const row = db.prepare(
            `SELECT institution_id FROM groups WHERE group_id = ? AND deleted_at IS NULL`).get(id);
        if (!row) return GROUP_DOMAIN.UNKNOWN;
        const inst = db.prepare(
            `SELECT 1 FROM institutions WHERE institution_id = ?`).get(String(row.institution_id));
        return inst ? GROUP_DOMAIN.CANONICAL : GROUP_DOMAIN.UNKNOWN;
    } catch { return GROUP_DOMAIN.UNKNOWN; }
}

// ── Telemetría bounded (F15): contadores agregados, sin IDs, sin PII ────────
const TELEMETRY = {
    group_reads_canonical: 0,
    group_reads_compat_legacy: 0,
    group_reads_compat_synthetic: 0,
    group_reads_unknown: 0,
    group_listing_compat_items: 0,
    compositions: 0,
};
export function getGroupDomainTelemetry() { return { ...TELEMETRY }; }
export function _resetGroupDomainTelemetry() {
    for (const k of Object.keys(TELEMETRY)) TELEMETRY[k] = 0;
}

function markDomain(record, domain) {
    try { Object.defineProperty(record, GROUP_DOMAIN_MARKER, { value: domain }); } catch { /* frozen */ }
    return record;
}

/**
 * Vista COMPUESTA del dominio groups para un cutover de lectura:
 *
 *     canonical (SQLite) ∪ compat atestada (JSON ∩ exclusiones)
 *
 * con dedupe por ID EXACTO, precedencia canónica, UNKNOWN excluido y
 * provenance por registro (GROUP_DOMAIN_MARKER). Nunca deduplica por nombre
 * ni inventa instituciones.
 *
 * Devuelve `null` ante cualquier anomalía ⇒ el facade cae a la lectura
 * oficial JSON completa (recovery-first, contada como fallback): la
 * degradación restaura el comportamiento actual, jamás un subconjunto mudo.
 *
 * @param {{db:any, repo:any, groupsJsonPath:string,
 *          onCount?:(cls:string,n:number)=>void, log?:(m:string,t?:string)=>void}} deps
 * @returns {Array|null}
 */
export function composeGroupReadView({ db, repo, groupsJsonPath, onCount = () => {}, log = () => {} }) {
    try {
        const excl = attestedGroupExclusionMap(db);
        const canonicalRaw = repo.groups.all();
        const canonical = [];
        const seen = new Set();
        let sqliteNonCanonical = 0;
        for (const rec of canonicalRaw) {
            const id = String(rec?.id ?? '');
            // El contrato canónico se re-verifica registro a registro: una fila
            // presente en SQLite pero fuera del contrato NO se vuelve confiable.
            if (classifyGroupReadDomain(db, id, excl) !== GROUP_DOMAIN.CANONICAL) {
                sqliteNonCanonical++;
                continue;
            }
            if (seen.has(id)) continue;                       // dedupe por id exacto
            seen.add(id);
            canonical.push(markDomain(rec, GROUP_DOMAIN.CANONICAL));
        }
        if (sqliteNonCanonical) {
            log(`[group-domains] ${sqliteNonCanonical} fila(s) SQLite fuera del contrato canónico `
                + 'excluida(s) de la vista compuesta', 'WARN');
        }

        const jsonArr = JSON.parse(fs.readFileSync(groupsJsonPath, 'utf8'));
        if (!Array.isArray(jsonArr)) throw new Error('groups JSON no es un array');
        const compat = [];
        let unknownExcluded = 0;
        let compatLegacy = 0, compatSynthetic = 0;
        for (const rec of jsonArr) {
            const id = String(rec?.id ?? '');
            if (!id || seen.has(id)) continue;                // precedencia canónica
            const domain = classifyGroupReadDomain(db, id, excl);
            if (domain === GROUP_DOMAIN.ATTESTED_LEGACY_COMPAT) {
                seen.add(id); compatLegacy++;
                compat.push(markDomain(rec, domain));
            } else if (domain === GROUP_DOMAIN.ATTESTED_SYNTHETIC_COMPAT) {
                seen.add(id); compatSynthetic++;
                compat.push(markDomain(rec, domain));
            } else if (domain === GROUP_DOMAIN.CANONICAL) {
                // Canónico aún no espejado en esta vista (p. ej. propagación):
                // se sirve la fila JSON marcada canónica — sigue sin ser compat.
                seen.add(id);
                canonical.push(markDomain(rec, GROUP_DOMAIN.CANONICAL));
            } else {
                unknownExcluded++;                            // fail-closed: fuera
            }
        }

        TELEMETRY.compositions++;
        TELEMETRY.group_reads_canonical += canonical.length;
        TELEMETRY.group_reads_compat_legacy += compatLegacy;
        TELEMETRY.group_reads_compat_synthetic += compatSynthetic;
        TELEMETRY.group_reads_unknown += unknownExcluded;
        TELEMETRY.group_listing_compat_items += compat.length;
        try {
            onCount('canonical', canonical.length);
            onCount('compat_legacy', compatLegacy);
            onCount('compat_synthetic', compatSynthetic);
            onCount('unknown_excluded', unknownExcluded);
        } catch { /* la telemetría jamás rompe la lectura */ }
        if (unknownExcluded) {
            log(`[group-domains] ${unknownExcluded} grupo(s) JSON no atestado(s) excluido(s) `
                + 'de la vista compuesta (UNKNOWN fail-closed)', 'WARN');
        }
        return [...canonical, ...compat];
    } catch (e) {
        log(`[group-domains] composición fallida → fallback oficial JSON: ${e.message}`, 'WARN');
        return null;
    }
}
