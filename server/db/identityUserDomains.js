/**
 * identityUserDomains.js — CHP-IDDB-02C-GAP2-USERS-AUTHORITY-01.
 *
 * Frontera EXPLÍCITA de dominios de lectura del dominio `users` (patrón
 * GAP3, sin framework genérico):
 *
 *   userId → classifyUserReadDomain(db, userId)
 *     CANONICAL                 → SQLite bajo cutover (247 hoy)
 *     ATTESTED_SYNTHETIC_COMPAT → JSON explícito SOLO en superficies
 *                                 admin/históricas (400 tras GAP1)
 *     TOMBSTONED                → NOT_FOUND contractual (11)
 *     UNKNOWN                   → fail-closed
 *
 * FUENTES ATESTADAS (identity.db, jamás heurísticas):
 *   - synthetic: migration_exclusions(entity='user',
 *     disposition='SYNTHETIC_LOADTEST_QUARANTINED') — h16(id);
 *   - tombstones: identity_tombstones (legacy_identity_hash = h16(id));
 *   - canonical: fila viva en users (proyección v2 ya validó email/rol/
 *     status; el clasificador re-verifica tombstone y exclusión: una fila
 *     manipulada para un id tombstoneado NO se vuelve canónica).
 *
 * AUTORIDADES (contrato M1 — ver docs/ops/IDENTITY_USERS_AUTHORITY_GAP2_01):
 *   CANONICAL READS=SQLite · LOGIN=JSON físico · CREDENTIALS=JSON físico ·
 *   MUTATIONS=JSON físico · METRICS LEGACY=JSON físico (denominadores
 *   intactos hasta Fase 2). Jamás `SQLite miss → JSON fallback` silencioso:
 *   la clasificación ocurre ANTES de elegir backend; el fallback
 *   recovery-first del facade (error ⇒ lectura oficial JSON íntegra,
 *   contada) restaura el comportamiento actual completo, nunca un
 *   subconjunto mudo.
 *
 * CREDENCIALES — lista ÚNICA compartida (proyección, comparador, guard):
 * ningún campo de esta lista puede persistir en identity.db ni servirse
 * desde el espejo. `credential_excluded=1` es diseño, no carencia.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';

export const USER_DOMAIN = Object.freeze({
    CANONICAL: 'CANONICAL',
    ATTESTED_SYNTHETIC_COMPAT: 'ATTESTED_SYNTHETIC_COMPAT',
    TOMBSTONED: 'TOMBSTONED',
    UNKNOWN: 'UNKNOWN',
});

export const USER_SYNTHETIC_DISPOSITION = 'SYNTHETIC_LOADTEST_QUARANTINED';

/**
 * Campos de material de credencial/secreto. Fuente ÚNICA para:
 * sanitizeUser (proyección v2), stripCredentials (comparador) y el
 * credential-guard de tests. Ampliar aquí = ampliar en todos a la vez.
 */
export const CREDENTIAL_FIELDS = Object.freeze([
    'password', 'passwordHash',
    'resetToken', 'resetExpiresAt',
    'inviteToken', 'inviteExpiresAt',
]);

/** Marca de procedencia por registro (Symbol no enumerable). */
export const USER_DOMAIN_MARKER = Symbol.for('chp.identity.userDomain');

const h16 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

/** Esquema v2 (CHP-IDDB-02A). El v1 legacy no tiene exclusiones/tombstones. */
function isV2Schema(db) {
    try { return Number(db.pragma('user_version', { simple: true })) >= 2; } catch { return false; }
}

export function attestedUserExclusionMap(db) {
    try {
        return new Map(db.prepare(
            `SELECT reference_hash, disposition FROM migration_exclusions WHERE entity='user'`)
            .all().map(r => [r.reference_hash, r.disposition]));
    } catch { return new Map(); }
}

export function tombstoneHashSet(db) {
    try {
        return new Set(db.prepare(`SELECT legacy_identity_hash FROM identity_tombstones`)
            .all().map(r => r.legacy_identity_hash));
    } catch { return new Set(); }
}

/**
 * Clasificación determinista y fail-closed. Orden: tombstone > exclusión
 * atestada > fila canónica > UNKNOWN. Un id tombstoneado clasifica
 * TOMBSTONED aunque alguien inserte una fila espuria en `users`.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId
 * @param {{exclMap?:Map, tombs?:Set}} [ctx] precalculado para bucles
 */
export function classifyUserReadDomain(db, userId, ctx = {}) {
    const id = String(userId ?? '');
    if (!id) return USER_DOMAIN.UNKNOWN;
    const hash = h16(id);
    const tombs = ctx.tombs ?? tombstoneHashSet(db);
    if (tombs.has(hash)) return USER_DOMAIN.TOMBSTONED;
    const excl = ctx.exclMap ?? attestedUserExclusionMap(db);
    const disposition = excl.get(hash);
    if (disposition === USER_SYNTHETIC_DISPOSITION) return USER_DOMAIN.ATTESTED_SYNTHETIC_COMPAT;
    if (disposition !== undefined) return USER_DOMAIN.UNKNOWN;   // otra exclusión: fuera
    try {
        // v2: clave canonical_id. v1 legacy (solo toolchain/pruebas: producción
        // es v2): clave `id`, sin atestaciones — se preserva su contrato
        // byte-equivalente original.
        const sql = isV2Schema(db)
            ? `SELECT 1 FROM users WHERE canonical_id = ? AND deleted_at IS NULL`
            : `SELECT 1 FROM users WHERE id = ? AND deleted_at IS NULL`;
        const row = db.prepare(sql).get(id);
        return row ? USER_DOMAIN.CANONICAL : USER_DOMAIN.UNKNOWN;
    } catch { return USER_DOMAIN.UNKNOWN; }
}

// ── Telemetría bounded (F18): clases fijas, sin IDs, sin PII ────────────────
const TELEMETRY = {
    user_reads_canonical: 0,
    user_reads_synthetic_compat: 0,
    user_reads_tombstoned: 0,
    user_reads_unknown: 0,
    operational_compositions: 0,
    admin_compositions: 0,
};
export function getUserDomainTelemetry() { return { ...TELEMETRY }; }
export function _resetUserDomainTelemetry() {
    for (const k of Object.keys(TELEMETRY)) TELEMETRY[k] = 0;
}

function mark(record, domain) {
    try { Object.defineProperty(record, USER_DOMAIN_MARKER, { value: domain }); } catch { /* frozen */ }
    return record;
}

/**
 * Vista OPERACIONAL bajo cutover: EXCLUSIVAMENTE usuarios canónicos desde
 * SQLite (247 hoy), cada fila re-verificada contra el clasificador (defensa
 * ante filas espurias). Sintéticos, tombstones y unknown quedan FUERA del
 * universo operativo. `null` ante anomalía ⇒ fallback oficial JSON íntegro.
 */
export function composeCanonicalUserView({ db, repo, onCount = () => {}, log = () => {} }) {
    try {
        const excl = attestedUserExclusionMap(db);
        const tombs = tombstoneHashSet(db);
        const rows = repo.users.all();
        const out = [];
        const seen = new Set();
        let rejected = 0;
        for (const rec of rows) {
            const id = String(rec?.id ?? '');
            if (!id || seen.has(id)) continue;
            if (classifyUserReadDomain(db, id, { exclMap: excl, tombs }) !== USER_DOMAIN.CANONICAL) {
                rejected++;
                continue;
            }
            seen.add(id);
            out.push(mark(rec, USER_DOMAIN.CANONICAL));
        }
        if (rejected) {
            log(`[user-domains] ${rejected} fila(s) SQLite fuera del contrato canónico `
                + 'excluida(s) de la vista operacional', 'WARN');
        }
        TELEMETRY.operational_compositions++;
        TELEMETRY.user_reads_canonical += out.length;
        try { onCount('canonical', out.length); } catch { /* telemetría jamás rompe */ }
        return out;
    } catch (e) {
        log(`[user-domains] composición operacional fallida → fallback JSON: ${e.message}`, 'WARN');
        return null;
    }
}

/**
 * Vista ADMIN/HISTÓRICA bajo cutover: canónico (SQLite) ∪ compat sintética
 * ATESTADA (JSON ∩ exclusiones, etiquetada). Para las superficies que
 * gestionan el histórico completo (listado admin, exports). UNKNOWN y
 * tombstones siguen fuera. Dedupe por id EXACTO con precedencia canónica.
 */
export function composeUserAdminView({ db, repo, usersJsonPath, onCount = () => {}, log = () => {} }) {
    try {
        const canonical = composeCanonicalUserView({ db, repo, onCount: () => {}, log });
        if (canonical === null) return null;
        const excl = attestedUserExclusionMap(db);
        const tombs = tombstoneHashSet(db);
        const jsonArr = JSON.parse(fs.readFileSync(usersJsonPath, 'utf8'));
        if (!Array.isArray(jsonArr)) throw new Error('users JSON no es un array');
        const seen = new Set(canonical.map(u => String(u.id)));
        const compat = [];
        let unknownExcluded = 0, tombstoned = 0;
        for (const rec of jsonArr) {
            const id = String(rec?.id ?? '');
            if (!id || seen.has(id)) continue;
            const domain = classifyUserReadDomain(db, id, { exclMap: excl, tombs });
            if (domain === USER_DOMAIN.ATTESTED_SYNTHETIC_COMPAT) {
                seen.add(id);
                // Compat NUNCA expone material de credencial aunque viva en el
                // registro físico: la superficie admin es de gestión, no de authn.
                const clean = {};
                for (const k of Object.keys(rec)) {
                    if (!CREDENTIAL_FIELDS.includes(k)) clean[k] = rec[k];
                }
                compat.push(mark(clean, domain));
            } else if (domain === USER_DOMAIN.TOMBSTONED) {
                tombstoned++;                                   // jamás en listados
            } else if (domain !== USER_DOMAIN.CANONICAL) {
                unknownExcluded++;                              // fail-closed
            }
        }
        TELEMETRY.admin_compositions++;
        TELEMETRY.user_reads_synthetic_compat += compat.length;
        TELEMETRY.user_reads_tombstoned += tombstoned;
        TELEMETRY.user_reads_unknown += unknownExcluded;
        try {
            onCount('synthetic_compat', compat.length);
            onCount('tombstoned', tombstoned);
            onCount('unknown_excluded', unknownExcluded);
        } catch { /* telemetría jamás rompe */ }
        if (unknownExcluded) {
            log(`[user-domains] ${unknownExcluded} usuario(s) JSON no atestado(s) excluido(s) `
                + 'de la vista admin (UNKNOWN fail-closed)', 'WARN');
        }
        return [...canonical, ...compat];
    } catch (e) {
        log(`[user-domains] composición admin fallida → fallback JSON: ${e.message}`, 'WARN');
        return null;
    }
}
