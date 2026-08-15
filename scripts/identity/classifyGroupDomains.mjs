#!/usr/bin/env node
/**
 * classifyGroupDomains.mjs — CHP-IDDB-02C-GAP3-GROUPS-01.
 *
 * Dry-run READ-ONLY del clasificador de dominios de grupos contra un par
 * (fuentes canónicas, identity.db). No muta nada; identity.db se abre en
 * readonly. Salida: solo agregados y hashes (sin PII).
 *
 *   node scripts/identity/classifyGroupDomains.mjs \
 *     --sources-root /src --identity-db /app/identity/identity.db
 *
 * Baseline productiva esperada: canonical=4, compat_legacy=15,
 * compat_synthetic=1, unknown=0, memberships fuera de canónico=0,
 * access rules hacia compat=1 (lt-access-v2 → sintético).
 */
import crypto from 'node:crypto';
import path from 'node:path';
import Database from 'better-sqlite3';
import {
    GROUP_DOMAIN,
    attestedGroupExclusionMap,
    classifyGroupReadDomain,
} from '../../server/db/identityGroupDomains.js';
import { resolveLiveSources } from './identityLiveSources.mjs';
import { assertIdentityDbPath } from './reconcileIdentityShadow.mjs';

const h16 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

export function classifyAll({ sourcesRoot, identityDbPath }) {
    const { sources, attestation } = resolveLiveSources({ sourcesRoot });
    const abs = assertIdentityDbPath(identityDbPath);
    const db = new Database(abs, { readonly: true });
    try {
        const excl = attestedGroupExclusionMap(db);
        const counts = { CANONICAL: 0, ATTESTED_LEGACY_COMPAT: 0,
            ATTESTED_SYNTHETIC_COMPAT: 0, UNKNOWN: 0 };
        const unknownRefs = [];
        const byDomain = {};
        for (const g of sources.groups) {
            const id = String(g?.id ?? '');
            const domain = classifyGroupReadDomain(db, id, excl);
            counts[domain]++;
            (byDomain[domain] ??= []).push(h16(id));
            if (domain === GROUP_DOMAIN.UNKNOWN) unknownRefs.push(h16(id));
        }
        // Membresías canónicas: TODAS deben resolver a un grupo CANONICAL.
        const memRows = db.prepare(`SELECT DISTINCT group_id FROM memberships`).all();
        let memCanonical = 0; const memOutside = [];
        for (const r of memRows) {
            if (classifyGroupReadDomain(db, r.group_id, excl) === GROUP_DOMAIN.CANONICAL) memCanonical++;
            else memOutside.push(h16(r.group_id));
        }
        // Dependencias de access hacia grupos por clase.
        const accessDeps = [];
        for (const rule of sources.access) {
            if (rule?.scope !== 'group') continue;
            accessDeps.push({ rule_ref: h16(String(rule.id)),
                group_domain: classifyGroupReadDomain(db, String(rule.scopeId), excl) });
        }
        return {
            tool: 'classifyGroupDomains', readOnly: true,
            counts,
            unknown_refs: unknownRefs,
            membership_group_ids: { total: memRows.length, canonical: memCanonical,
                outside_canonical: memOutside },
            access_group_scope_dependencies: accessDeps,
            attestation: { sourceMode: attestation.sourceMode,
                groups_sha256: attestation.canonicalSourceIdentity.groups.sha256,
                access_sha256: attestation.canonicalSourceIdentity.access.sha256 },
        };
    } finally { db.close(); }
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]).endsWith('classifyGroupDomains.mjs');
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
