#!/usr/bin/env node
/**
 * classifyUserDomains.mjs — CHP-IDDB-02C-GAP2-USERS-AUTHORITY-01.
 *
 * Dry-run READ-ONLY del clasificador de dominios de users contra
 * (fuentes canónicas, identity.db). Solo agregados, sin PII.
 *
 *   node scripts/identity/classifyUserDomains.mjs \
 *     --sources-root /src --identity-db /app/identity/identity.db
 *
 * Baseline productiva esperada: CANONICAL=247, SYNTHETIC_COMPAT=400,
 * TOMBSTONES=11, UNKNOWN=0, AUTHZ_CANONICAL_UNRESOLVED=0,
 * MEMBERSHIP_USER_UNRESOLVED=0, CREDENTIALS_IN_SQLITE=0.
 */
import path from 'node:path';
import Database from 'better-sqlite3';
import {
    CREDENTIAL_FIELDS, USER_DOMAIN,
    attestedUserExclusionMap, classifyUserReadDomain, tombstoneHashSet,
} from '../../server/db/identityUserDomains.js';
import { resolveLiveSources } from './identityLiveSources.mjs';
import { assertIdentityDbPath } from './reconcileIdentityShadow.mjs';

export function classifyAll({ sourcesRoot, identityDbPath }) {
    const { sources, attestation } = resolveLiveSources({ sourcesRoot });
    const abs = assertIdentityDbPath(identityDbPath);
    const db = new Database(abs, { readonly: true });
    try {
        const ctx = { exclMap: attestedUserExclusionMap(db), tombs: tombstoneHashSet(db) };
        const counts = { CANONICAL: 0, ATTESTED_SYNTHETIC_COMPAT: 0, TOMBSTONED: 0, UNKNOWN: 0 };
        for (const u of sources.users) {
            counts[classifyUserReadDomain(db, String(u?.id ?? ''), ctx)]++;
        }
        // Tombstones del padrón serían anómalos; las 11 atestadas viven fuera.
        const tombstonesAttested = ctx.tombs.size;
        // Membresías: todo user_id debe ser canónico.
        const memUsers = db.prepare(`SELECT DISTINCT user_id FROM memberships`).all();
        const memUnresolved = memUsers.filter(r =>
            classifyUserReadDomain(db, r.user_id, ctx) !== USER_DOMAIN.CANONICAL).length;
        // Credenciales: cero material en el espejo.
        let credLeaks = 0;
        for (const r of db.prepare(
            `SELECT raw_json FROM users WHERE deleted_at IS NULL`).all()) {
            const o = JSON.parse(r.raw_json);
            if (CREDENTIAL_FIELDS.some(f => f in o)) credLeaks++;
        }
        return {
            tool: 'classifyUserDomains', readOnly: true,
            counts, tombstones_attested: tombstonesAttested,
            AUTHZ_CANONICAL_UNRESOLVED: counts.UNKNOWN,   // padrón sin dominio = irresoluble
            MEMBERSHIP_USER_UNRESOLVED: memUnresolved,
            MEMBERSHIP_USER_IDS: memUsers.length,
            CREDENTIALS_IN_SQLITE: credLeaks,
            attestation: { sourceMode: attestation.sourceMode,
                padron_sha256: attestation.canonicalSourceIdentity.padron.sha256 },
        };
    } finally { db.close(); }
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]).endsWith('classifyUserDomains.mjs');
if (invokedDirectly) {
    const a = {};
    const argv = process.argv.slice(2);
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === '--sources-root') a.sourcesRoot = argv[++i];
        else if (argv[i] === '--identity-db') a.identityDbPath = argv[++i];
    }
    try {
        console.log(JSON.stringify(classifyAll(a), null, 1));
    } catch (e) {
        console.error(`STOP — ${e.classification ?? 'CLASSIFY_FAILED'}: ${e.message}`);
        process.exit(1);
    }
}
