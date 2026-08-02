#!/usr/bin/env node
/**
 * buildImportManifest.mjs — CHP-IDDB-02A.
 *
 * Emite el manifiesto root-only que consume el importador. Todas las rutas
 * entran por argumento: este fichero versionado no contiene ni una ruta ni un
 * identificador de producción.
 *
 * Los conteos esperados NO se inventan ni se copian del plan recién calculado:
 * se derivan del dry-run congelado de CHP-IDDB-01D, que es la autoridad. Así
 * la reconciliación del importador compara contra una fuente independiente.
 *
 * Uso:
 *   node scripts/identity/buildImportManifest.mjs \
 *     --out <manifest.json> --output-db <path.candidate.db> \
 *     --padron <p> --groups <p> --institutions <p> \
 *     --mapping <p> --tombstones <p> --orphans <p> --dry-run-01d <p> \
 *     --attestation <p> --source-commit <sha> --generated-at <iso>
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildPlan, canonicalJson, SCHEMA_VERSION } from './importIdentityCandidate.mjs';

const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

function parseArgs(argv) {
    const a = {};
    for (let i = 0; i < argv.length; i++) {
        if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[++i];
    }
    return a;
}

export function expectedCountsFrom01D(dryRun01d) {
    const c = dryRun01d.counts;
    const users = (c.users.MIGRATABLE ?? 0) + (c.users.MIGRATABLE_WITH_WARNING ?? 0);
    return {
        users,
        institutions: c.institutions.MIGRATABLE ?? 0,
        groups: c.groups.MIGRATABLE ?? 0,
        memberships: c.memberships.MIGRATABLE ?? 0,
        tombstones: c.tombstones ?? 0,
        syntheticUsersImported: 0,
        syntheticGroupsImported: 0,
        legacyGroupsImported: 0,
        syntheticMembershipsImported: 0,
        legacyMembershipsImported: 0,
        membershipsTowardTombstones: 0,
        fabricatedMemberships: 0,
        rejectedWithoutDisposition: 0,
    };
}

export function buildManifest(opts) {
    const src = (p) => ({ path: p, sha256: sha256File(p) });
    const dryRun01d = JSON.parse(fs.readFileSync(opts.dryRun01d, 'utf8'));
    const base = {
        unit: 'CHP-IDDB-02A',
        policyVersion: '1.0.0',
        schemaVersion: SCHEMA_VERSION,
        sourceCommit: opts.sourceCommit,
        generatedAt: opts.generatedAt,
        canonicalUserSource: path.basename(opts.padron),
        sources: {
            padron: src(opts.padron),
            groups: src(opts.groups),
            institutions: src(opts.institutions),
        },
        frozenArtifacts: {
            groupInstitutionMapping: src(opts.mapping),
            tombstoneProposal: src(opts.tombstones),
            orphanReferenceMap: src(opts.orphans),
            dryRun01D: src(opts.dryRun01d),
            reproductionAttestation01D: src(opts.attestation),
        },
        expectedCounts: expectedCountsFrom01D(dryRun01d),
        dispositions: {
            syntheticCohort: 'SYNTHETIC_LOADTEST_QUARANTINED (01B)',
            syntheticGroup: 'SYNTHETIC_LOADTEST_EXCLUDED (01C-R1)',
            legacyGroups: 'LEGACY_TEST_GROUP_PENDING_RETIREMENT (01C-R1)',
            supersededPadron: 'SUPERSEDED_PADRON_SNAPSHOT_NOT_IMPORTED (01D)',
            benchReferences: 'SYNTHETIC_REFERENCE_EXCLUDED (01D)',
            historicReferences: 'DELETED_IDENTITY_TOMBSTONE_REQUIRED (01D)',
            legacyGroupReferences: 'LEGACY_GROUP_REFERENCE_PENDING_RETIREMENT (01D)',
            rejectedMembership: 'DELETED_IDENTITY_REFERENCE (01D)',
        },
        privacyRules: {
            noCredentialsStored: true,
            noRawIdentifiersInExclusions: true,
            noPiiInVersionedArtifacts: true,
            candidateIsRootOnlyAndOffProduction: true,
        },
        outputPath: opts.outputDb,
        runId: 'PENDING', expectedPlanHash: null,
    };
    // El plan se calcula con el manifiesto ya formado para derivar run_id y
    // hash de plan; los conteos esperados siguen viniendo de 01D.
    const built = buildPlan({ ...base, runId: 'PENDING' });
    return { ...base, runId: built.derivedRunId, expectedPlanHash: built.planHash,
        runIdDerivation: 'sha256(canonical({planHash, sourceHashes}))[0:16]',
        computedCounts: built.counts };
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]).endsWith('buildImportManifest.mjs');
if (invokedDirectly) {
    const a = parseArgs(process.argv.slice(2));
    const required = ['out', 'output-db', 'padron', 'groups', 'institutions', 'mapping',
        'tombstones', 'orphans', 'dry-run-01d', 'attestation', 'source-commit', 'generated-at'];
    const missing = required.filter(k => !a[k]);
    if (missing.length) {
        console.error('Faltan argumentos: ' + missing.map(m => '--' + m).join(' '));
        process.exit(2);
    }
    const manifest = buildManifest({
        outputDb: a['output-db'], padron: a.padron, groups: a.groups,
        institutions: a.institutions, mapping: a.mapping, tombstones: a.tombstones,
        orphans: a.orphans, dryRun01d: a['dry-run-01d'], attestation: a.attestation,
        sourceCommit: a['source-commit'], generatedAt: a['generated-at'],
    });
    fs.writeFileSync(a.out, JSON.stringify(manifest, null, 1));
    try { fs.chmodSync(a.out, 0o600); } catch { /* sistemas sin modo POSIX */ }
    console.log(`manifiesto escrito: ${a.out}`);
    console.log(`  runId          : ${manifest.runId}`);
    console.log(`  planHash       : ${manifest.expectedPlanHash}`);
    console.log(`  expectedCounts : ${canonicalJson(manifest.expectedCounts)}`);
}
