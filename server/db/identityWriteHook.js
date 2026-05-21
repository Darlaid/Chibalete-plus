/**
 * identityWriteHook.js — P3-E: activación REAL del dual-write shadow (P1 §6),
 * corregida tras diagnóstico: el seam DRY NO es mutateUsers/Groups (el
 * writeJSON real está disperso en ~25 call-sites) sino `writeJSON`/
 * `writeJSONAsync` mismos. UN punto cubre todos los paths.
 *
 * INVARIANTE DURO (no negociable):
 *   - GATED: no hace NADA salvo IDENTITY_DUAL_WRITE=1.
 *   - Solo intercepta los 3 archivos de identidad (users/groups/access).
 *   - Corre DESPUÉS del write JSON atómico exitoso (JSON = source of truth).
 *   - try/catch total: un fallo de espejo se loguea y se audita, JAMÁS
 *     lanza ni bloquea el write JSON ni la request.
 *   - Quitar la llamada = 100% JSON sin residuo (reversible).
 *
 * shadow_audit (P1) registra cada espejo (json_count vs sqlite_count, ok) →
 * fuente de verdad del gate de cutover y de la alerta de inconsistencia P3-C.
 */
import { flags } from '../lib/flags.js';

let _hook = null;

/**
 * @param {{usersDb:string,groupsDb:string,accessDb:string,log:(m:string,t?:string)=>void}} cfg
 * @returns {(file:string,data:any)=>void}
 */
export function makeIdentityWriteHook(cfg) {
    if (_hook) return _hook;
    const { usersDb, groupsDb, accessDb, log = () => {} } = cfg;
    // Imports perezosos: si SQLITE no está activo nunca se cargan.
    let _db = null, _mirror = null;
    async function ensure() {
        if (_db && _mirror) return true;
        const { getIdentityDb } = await import('./identityDb.js');
        const m = await import('./identityShadow.js');
        _db = getIdentityDb();
        _mirror = m;
        return true;
    }
    _hook = (file, data) => {
        if (!flags.identityDualWrite()) return;
        let domain = null;
        if (file === usersDb) domain = 'users';
        else if (file === groupsDb) domain = 'groups';
        else if (file === accessDb) domain = 'access';
        if (!domain) return;
        // No-bloqueante: el espejo NO está en el path crítico de la respuesta.
        Promise.resolve()
            .then(ensure)
            .then(() => {
                if (domain === 'users')  _mirror.mirrorUsers(_db, data, log);
                if (domain === 'groups') _mirror.mirrorGroups(_db, data, log);
                if (domain === 'access') _mirror.mirrorAccess(_db, data, log);
            })
            .catch(e => log(`[identity-shadow] mirror ${domain} failed: ${e.message}`, 'WARN'));
    };
    return _hook;
}

/** Bootstrap idempotente: corre migraciones si IDENTITY_SQLITE_ENABLED. */
export async function bootstrapIdentityDb(log = () => {}) {
    if (!flags.identitySqliteEnabled()) { log('[identity-db] disabled (inerte)'); return false; }
    try {
        const { getIdentityDb } = await import('./identityDb.js');
        const { runMigrations } = await import('./migrate.js');
        const r = runMigrations(getIdentityDb(), m => log(m));
        log(`[identity-db] migrations applied=${r.applied.length} already=${r.already.length}`);
        return true;
    } catch (e) {
        // El arranque del API JAMÁS depende de SQLite identity.
        log(`[identity-db] bootstrap failed (continuing JSON-only): ${e.message}`, 'WARN');
        return false;
    }
}
