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
import crypto from 'node:crypto';
import fs from 'node:fs';
import { flags } from '../lib/flags.js';
import { domainOf, assertRegisteredWriter } from './identityWriteSurface.mjs';

let _hook = null;

/**
 * Versión de la instantánea canónica: hash del contenido + una secuencia
 * monótona tomada del propio fichero ya escrito. Permite que el espejo
 * rechace una instantánea obsoleta sin comparar contenido.
 */
function sourceVersionOf(file, data) {
    const hash = crypto.createHash('sha256')
        .update(JSON.stringify(data ?? null)).digest('hex').slice(0, 32);
    let seq = 0;
    try { seq = fs.statSync(file).mtimeMs; } catch { seq = 0; }
    return { hash, seq };
}

/**
 * @param {{usersDb:string,groupsDb:string,accessDb:string,log:(m:string,t?:string)=>void}} cfg
 * @returns {(file:string,data:any)=>void}
 */
export function makeIdentityWriteHook(cfg) {
    if (_hook) return _hook;
    const { usersDb, groupsDb, accessDb, schoolsDb = null, log = () => {},
        writerId = 'server.writeJSON', now = () => new Date().toISOString() } = cfg;
    const paths = { usersDb, groupsDb, accessDb, schoolsDb };
    // Imports perezosos: si SQLITE no está activo nunca se cargan.
    let _db = null, _mirror = null, _mirrorV2 = null;
    async function ensure() {
        if (_db && _mirror && _mirrorV2) return true;
        const { getIdentityDb } = await import('./identityDb.js');
        _mirror = await import('./identityShadow.js');
        _mirrorV2 = await import('./identityShadowV2.js');
        _db = getIdentityDb();
        return true;
    }
    _hook = (file, data) => {
        if (!flags.identityDualWrite()) return;
        const domain = domainOf(file, paths);
        if (!domain) return;
        const unregistered = assertRegisteredWriter(writerId);
        if (unregistered) {
            log(`[identity-shadow] ${domain}: escritor no registrado (${writerId}) → espejo omitido`, 'WARN');
            return;
        }
        // No-bloqueante: el espejo NO está en el path crítico de la respuesta.
        // El write JSON ya está confirmado; pase lo que pase aquí, no se revierte.
        Promise.resolve()
            .then(ensure)
            .then(() => {
                const isV2 = Number(_db.pragma('user_version', { simple: true })) >= 2;
                if (!isV2) {
                    if (domain === 'users') _mirror.mirrorUsers(_db, data, log);
                    if (domain === 'groups') _mirror.mirrorGroups(_db, data, log);
                    if (domain === 'access') _mirror.mirrorAccess(_db, data, log);
                    return;
                }
                if (domain === 'access') {
                    // `access` no forma parte del modelo v2; se sigue espejando
                    // con el escritor v1, cuya tabla v2 conserva intacta.
                    _mirror.mirrorAccess(_db, data, log);
                    return;
                }
                const report = _mirrorV2.mirrorSnapshotV2(_db, {
                    domain, records: data, sourceVersion: sourceVersionOf(file, data),
                    writerId, at: now(),
                });
                if (report.status === 'FAILED_RECONCILABLE') {
                    // Nunca silencioso: queda en shadow_operations, en
                    // shadow_state y en el log operacional.
                    log(`[identity-shadow] ${domain}: espejo FAILED_RECONCILABLE `
                        + `(${report.classification}); el write JSON ya está confirmado`, 'ERROR');
                }
            })
            .catch(e => log(`[identity-shadow] mirror ${domain} failed: ${e.message}`, 'WARN'));
    };
    return _hook;
}

/** Solo para tests: el hook es un singleton memoizado por diseño. */
export function _resetIdentityWriteHook() { _hook = null; }

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
