/**
 * identityReadFacade.js — P4-A: cutover REAL de LECTURA JSON → SQLite,
 * gated, per-dominio y FALLBACK-SAFE (recovery-first / rollback-first).
 *
 * Completa el arco P1→P4: P1 creó el repo de lectura SQLite pero NADA leía
 * de él. Acá `readJSON` (seam DRY) puede servir desde SQLite — pero SOLO si
 * TODAS estas condiciones se cumplen, si no → JSON (comportamiento actual,
 * intacto):
 *   1. IDENTITY_READ=sqlite
 *   2. el dominio está en IDENTITY_READ_DOMAINS (csv; default vacío = ninguno)
 *   3. la ÚLTIMA shadow_audit del dominio es ok=1 (NUNCA servir datos
 *      divergentes — recovery-first)
 *   4. la lectura SQLite no lanza y devuelve un array
 * Cualquier fallo/duda → `null` ⇒ readJSON cae a JSON + métrica de fallback.
 *
 * raw_json del repo es byte-equivalente al registro JSON original → el resto
 * del backend no nota el cambio de origen. Reversible total: IDENTITY_READ
 * =json (default) ⇒ esta ruta jamás se ejecuta.
 */
import { flags } from '../lib/flags.js';
import {
    identityReadSource as mSrc, identityReadFallback as mFb,
} from '../observability/metrics.js';

/**
 * CHP-IDDB-READ-RMW-SEAM-01 — marca de procedencia. Todo array servido desde
 * SQLite por esta facade queda etiquetado (Symbol no enumerable: invisible
 * para JSON.stringify, res.json y los consumidores de lectura). El seam de
 * ESCRITURA lo usa para rehusar persistir un array servido desde SQLite sobre
 * el JSON canónico: una mutación cuya base fuera el espejo (subconjunto sin
 * credenciales) truncaría el padrón. Ver assertWritableIdentityPayload.
 */
export const IDENTITY_SQLITE_SERVED = Symbol.for('chp.identity.sqliteServed');

/**
 * Guard de regresión del seam RMW: lanza si `data` (el payload que va a
 * persistirse en un store de identidad) es un array que la facade sirvió
 * desde SQLite. Con IDENTITY_READ=json nunca existe la marca → no-op.
 * @throws {Error} IDENTITY_MUTATION_SQLITE_GUARD
 */
export function assertWritableIdentityPayload(file, data, paths) {
    let domain = null;
    if (file === paths.usersDb) domain = 'users';
    else if (file === paths.groupsDb) domain = 'groups';
    else if (file === paths.accessDb) domain = 'access';
    if (!domain) return;
    if (data && data[IDENTITY_SQLITE_SERVED] === true) {
        throw new Error(
            `IDENTITY_MUTATION_SQLITE_GUARD: intento de persistir en '${domain}' un array `
            + 'servido desde SQLite; la base de una mutación debe leerse del JSON canónico '
            + 'físico (readCanonicalStoreForMutation), nunca del seam conmutable');
    }
}

let _repo = null;
function domainsAllowed() {
    return new Set(String(process.env.IDENTITY_READ_DOMAINS || '')
        .split(',').map(s => s.trim()).filter(Boolean));
}

function lastAuditOk(db, domain) {
    const row = db.prepare(
        `SELECT ok FROM shadow_audit WHERE domain = ? ORDER BY id DESC LIMIT 1`).get(domain);
    return !!row && row.ok === 1;
}

/**
 * @returns {Array|null}  array (servir desde SQLite) o null (caer a JSON).
 *                         NUNCA lanza.
 */
export function tryIdentitySqliteRead(file, paths, log = () => {}) {
    let domain = null;
    if (file === paths.usersDb) domain = 'users';
    else if (file === paths.groupsDb) domain = 'groups';
    else if (file === paths.accessDb) domain = 'access';
    if (!domain) return null;                                  // no es identidad

    // Gate 1+2: flag global + dominio habilitado. Default ⇒ JSON sin overhead.
    if (flags.identityReadSource() !== 'sqlite') return null;
    if (!domainsAllowed().has(domain)) return null;

    try {
        if (!flags.identitySqliteEnabled()) {                  // SQLite ni bootstrapeado
            try { mFb.labels(domain, 'sqlite_disabled').inc(); } catch {}
            return null;
        }
        // Imports perezosos (sync better-sqlite3): solo si el gate pasó.
        const { getIdentityDb } = requireSync('./identityDb.js');
        const { makeIdentityRepo } = requireSync('../repositories/identityRepo.js');
        const db = getIdentityDb();
        // Gate 3: consistencia. Nunca servir divergente.
        if (!lastAuditOk(db, domain)) {
            try { mFb.labels(domain, 'shadow_mismatch').inc(); } catch {}
            log(`[identity-read] ${domain}: shadow no-ok → fallback JSON`, 'WARN');
            return null;
        }
        if (!_repo) _repo = makeIdentityRepo(db);
        const arr = domain === 'users' ? _repo.users.all()
                  : domain === 'groups' ? _repo.groups.all()
                  : _repo.access.all();
        if (!Array.isArray(arr)) {
            try { mFb.labels(domain, 'bad_shape').inc(); } catch {}
            return null;
        }
        // CHP-IDDB-READ-RMW-SEAM-01: marca de procedencia para el guard RMW.
        Object.defineProperty(arr, IDENTITY_SQLITE_SERVED, { value: true });
        try { mSrc.labels(domain, 'sqlite').inc(); } catch {}
        return arr;
    } catch (e) {
        // Gate 4: cualquier error → JSON. El cutover JAMÁS rompe lecturas.
        try { mFb.labels(domain, 'exception').inc(); } catch {}
        log(`[identity-read] ${domain} sqlite read failed → fallback JSON: ${e.message}`, 'WARN');
        return null;
    }
}

/** Marca una lectura servida desde JSON (para el ratio de cutover). */
export function markJsonRead(file, paths) {
    let domain = null;
    if (file === paths.usersDb) domain = 'users';
    else if (file === paths.groupsDb) domain = 'groups';
    else if (file === paths.accessDb) domain = 'access';
    if (domain) { try { mSrc.labels(domain, 'json').inc(); } catch {} }
}

// readJSON es SÍNCRONO; los módulos ESM identityDb/identityRepo se precargan
// UNA vez en bootstrap vía warmupReadFacade() y se cachean acá. Si NO están
// warmed (warmup no corrió / cutover off), requireSync devuelve {} →
// getIdentityDb es undefined → throw → catch → fallback JSON (recovery-first,
// 100% seguro). Sin trucos sync de import.
const _warm = {};
function requireSync(rel) { return _warm[rel] || {}; }
export async function warmupReadFacade() {
    if (flags.identityReadSource() !== 'sqlite') return false;
    _warm['./identityDb.js'] = await import('./identityDb.js');
    _warm['../repositories/identityRepo.js'] = await import('../repositories/identityRepo.js');
    return true;
}
