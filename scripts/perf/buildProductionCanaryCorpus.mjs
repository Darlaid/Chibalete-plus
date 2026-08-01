/**
 * buildProductionCanaryCorpus.mjs — CHP-STATS-LEGACY-PERF-CORPUS-01A.
 *
 * Genera el artefacto **root-only** `PRODUCTION-CANARY-CORPUS.json` aplicando
 * los criterios de selección congelados en `productionCanaryCorpus.mjs`.
 *
 * Existe para que reemplazar el corpus no sea un ejercicio de cherry-picking
 * manual: se vuelve a ejecutar, se comparan los hashes de población, y si la
 * selección cambió se ve exactamente por qué criterio cambió.
 *
 * READ-ONLY sobre producción:
 *   · los JSON se leen y no se reescriben;
 *   · SQLite se abre con `readonly` y `PRAGMA query_only=ON`, respetando el WAL
 *     (nada de `immutable`, que ignoraría el WAL y devolvería datos obsoletos);
 *   · `insights.db` **no se abre**: es una fuente derivada y consultarla está
 *     fuera de lo autorizado.
 *
 * Uso (dentro del contenedor de la API, que es donde vive `better-sqlite3`):
 *   node buildProductionCanaryCorpus.mjs \
 *     --data /app/data --dataCritical /app/data-critical \
 *     --out /out/PRODUCTION-CANARY-CORPUS.json \
 *     --commit <sha> --imageId <sha256:...> --generatedAt <iso>
 */

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
    CORPUS_ID, CORPUS_VERSION, ACCEPTANCE_CONTRACT_VERSION,
    ORG_ALIASES, GROUP_ALIAS, USER_ALIAS,
    ROUTE_CONTRACT, PERF_ROUTE_IDS, NEGATIVE_ROUTE_IDS,
    NORMALIZATION_CONTRACT, SAMPLING_CONTRACT, GATES, LIFECYCLE_GATES,
    PERIOD_CONTRACT, GROUP_SELECTION_CRITERIA, USER_SELECTION_CRITERIA,
    SYNTHETIC_PRINCIPAL_USER_ID, SYNTHETIC_ABSENT_SCHOOL_SLUG,
    acceptanceContractSha256, sha256Hex, shortHash, resolvePath, canonicalJson,
} from './productionCanaryCorpus.mjs';

const require = createRequire(import.meta.url);

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const k = argv[i].slice(2), v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; }
    }
    return out;
}
const args = parseArgs(process.argv);
const DATA = String(args.data || '/app/data');
const DC = String(args.dataCritical || '/app/data-critical');
const OUT = String(args.out || '/out/PRODUCTION-CANARY-CORPUS.json');

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const fileSha = (p) => sha256Hex(fs.readFileSync(p));

/** Réplica exacta de `schoolNameToSlug` de `server.js` — mismo orden de pasos. */
function slugify(name) {
    return String(name)
        .toLowerCase()
        .trim()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

const members = (g) => [...new Set([...(g.studentIds || []), ...(g.memberIds || [])])];

// ── fuentes ─────────────────────────────────────────────────────────────────
const schools = readJson(path.join(DATA, 'schools_db.json'));
const groups = readJson(path.join(DATA, 'groups_db.json'));
const oro = readJson(path.join(DC, 'usuarios_colegios_oro.json'));
const byId = new Map(oro.filter((u) => u.id).map((u) => [String(u.id), u]));
const registered = new Set(schools.map((s) => s.name));

const Database = require('better-sqlite3');
function readOnly(file, fn) {
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { db.pragma('query_only = ON'); return fn(db); } finally { db.close(); }
}

const progressUsers = readOnly(path.join(DATA, 'progress.db'), (db) =>
    new Set(db.prepare('SELECT DISTINCT user_id AS u FROM progress').all().map((r) => r.u)));
const eventUsers = readOnly(path.join(DC, 'events.db'), (db) =>
    new Set(db.prepare('SELECT DISTINCT user_id AS u FROM events').all().map((r) => r.u)));

let analyticsUsers = new Set();
try {
    const raw = readJson(path.join(DATA, 'analytics_db.json'));
    const evs = Array.isArray(raw) ? raw : (raw.events || []);
    analyticsUsers = new Set(evs.map((e) => e.userId || e.user_id).filter(Boolean));
} catch { /* la ausencia de analytics no invalida el corpus */ }

const isActive = (u) => progressUsers.has(u) || eventUsers.has(u) || analyticsUsers.has(u);

// ── Fase 3: instituciones ───────────────────────────────────────────────────
if (schools.length !== ORG_ALIASES.length) {
    console.error(`STOP — STATS-LEGACY-PERF-CORPUS-01A INSTITUTION SET DRIFTED: ` +
        `se esperaban ${ORG_ALIASES.length} instituciones registradas, hay ${schools.length}`);
    process.exit(4);
}

/**
 * El alias se asigna por el papel que la institución cumple en el contrato
 * histórico, no por su posición en el fichero:
 *   ORG_A alto volumen · ORG_B sin actividad · ORG_C FilBo · ORG_D sin grupos.
 */
const organizations = schools.map((s) => {
    const gs = groups.filter((g) => g.school === s.name);
    const us = [...new Set(gs.flatMap(members))].sort();
    const inOro = us.filter((u) => byId.has(u));
    const active = inOro.filter(isActive);
    return {
        name: s.name, id: s.id, slug: slugify(s.name),
        addressable: gs.length > 0,
        groups: gs.length, membersInOro: inOro.length, activeReaders: active.length,
        dataState: gs.length === 0 ? 'NOT_ADDRESSABLE'
            : active.length === 0 ? 'NO_ACTIVITY' : 'ACTIVE',
    };
});

const byRole = {
    ORG_A: organizations.filter((o) => o.addressable)
        .sort((a, b) => b.activeReaders - a.activeReaders || a.id.localeCompare(b.id))[0],
    ORG_B: organizations.filter((o) => o.addressable && o.dataState === 'NO_ACTIVITY')
        .sort((a, b) => b.membersInOro - a.membersInOro || a.id.localeCompare(b.id))[0],
    ORG_C: organizations.filter((o) => o.addressable && /filbo/i.test(o.name))
        .sort((a, b) => a.id.localeCompare(b.id))[0],
    ORG_D: organizations.filter((o) => !o.addressable)
        .sort((a, b) => a.id.localeCompare(b.id))[0],
};
for (const [alias, org] of Object.entries(byRole)) {
    if (!org) {
        console.error(`STOP — STATS-LEGACY-PERF-CORPUS-01A INSTITUTION SET DRIFTED: ` +
            `sin candidata para ${alias}`);
        process.exit(4);
    }
}
if (new Set(Object.values(byRole).map((o) => o.id)).size !== ORG_ALIASES.length) {
    console.error('STOP — STATS-LEGACY-PERF-CORPUS-01A INSTITUTION SET DRIFTED: ' +
        'los cuatro alias no resuelven a cuatro instituciones distintas');
    process.exit(4);
}

// ── Fase 4: GROUP_R7 ────────────────────────────────────────────────────────
const C = GROUP_SELECTION_CRITERIA;
const candidates = groups.map((g) => {
    const ms = members(g);
    const inOro = ms.filter((m) => byId.has(m));
    const active = inOro.filter(isActive).length;
    const rejected = [];
    if (!registered.has(g.school)) rejected.push('SCHOOL_NOT_REGISTERED');
    if (g.archived || g.isArchived) rejected.push('ARCHIVED');
    if (ms.length === 0) rejected.push('EMPTY');
    if (inOro.length === 0) rejected.push('NO_ORO_COVERAGE');
    if (rejected.length === 0) {
        if (inOro.length < C.minMembersInOro || inOro.length > C.maxMembersInOro) rejected.push('OUT_OF_RANGE');
        if (active < C.minActiveReaders) rejected.push('NO_ATTRIBUTABLE_ACTIVITY');
    }
    return { id: g.id, school: g.school, type: g.type, members: ms.length,
        membersInOro: inOro.length, activeReaders: active, rejected };
});

const eligible = candidates.filter((c) => c.rejected.length === 0)
    .sort((a, b) => b.activeReaders - a.activeReaders || String(a.id).localeCompare(String(b.id)));
if (eligible.length === 0) {
    console.error('STOP — STATS-LEGACY-PERF-CORPUS-01A GROUP SELECTION AMBIGUOUS: cero elegibles');
    process.exit(5);
}
const groupR7 = eligible[0];
const groupR7Record = groups.find((g) => g.id === groupR7.id);

// ── Fase 5: USER_R6 ─────────────────────────────────────────────────────────
const pool = members(groupR7Record)
    .filter((m) => byId.has(m))
    .filter((m) => (byId.get(m).roles || []).some((r) => String(r).toLowerCase() === USER_SELECTION_CRITERIA.requiredRole));
const ordered = pool.slice().sort((a, b) => sha256Hex(a).localeCompare(sha256Hex(b)));
if (ordered.length === 0) {
    console.error('STOP — STATS-LEGACY-PERF-CORPUS-01A USER SELECTION AMBIGUOUS: pool vacío');
    process.exit(6);
}
const userR6 = ordered[0];

// ── rutas resueltas ─────────────────────────────────────────────────────────
const bindings = {
    ORG_A_SLUG: byRole.ORG_A.slug, ORG_B_SLUG: byRole.ORG_B.slug,
    ORG_C_SLUG: byRole.ORG_C.slug, ORG_D_SLUG: byRole.ORG_D.slug,
    GROUP_R7_ID: groupR7.id, USER_R6_ID: userR6,
};
const routes = ROUTE_CONTRACT.map((r) => ({ ...r, path: resolvePath(r.pathTemplate, bindings) }));

// ── corpus ──────────────────────────────────────────────────────────────────
const corpus = {
    corpusId: CORPUS_ID,
    corpusVersion: CORPUS_VERSION,
    generatedAt: String(args.generatedAt || ''),
    expiresAt: String(args.expiresAt || ''),
    reviewBy: String(args.reviewBy || ''),
    production: {
        commit: String(args.commit || ''),
        imageRef: String(args.imageRef || ''),
        imageId: String(args.imageId || ''),
        observabilityCommit: String(args.observabilityCommit || ''),
        requiredFlags: { LEGACY_METRICS_REQUEST_CONTEXT: 'off', METRICS_ENGINE: 'legacy' },
    },
    acceptanceContractVersion: ACCEPTANCE_CONTRACT_VERSION,
    acceptanceContractSha256: acceptanceContractSha256(),
    organizations: ORG_ALIASES.map((alias) => {
        const o = byRole[alias];
        return { alias, name: o.name, id: o.id, idSha256: sha256Hex(o.id),
            slug: o.slug, addressable: o.addressable, groups: o.groups,
            membersInOro: o.membersInOro, activeReaders: o.activeReaders,
            dataState: o.dataState };
    }),
    group: {
        alias: GROUP_ALIAS, id: groupR7.id, idSha256: sha256Hex(groupR7.id),
        organizationAlias: ORG_ALIASES.find((a) => byRole[a].name === groupR7.school) || null,
        type: groupR7.type, membersInOro: groupR7.membersInOro,
        activeReaders: groupR7.activeReaders,
        selection: { ...C, eligibleCount: eligible.length,
            runnerUpActiveReaders: eligible[1] ? eligible[1].activeReaders : null },
    },
    user: {
        alias: USER_ALIAS, id: userR6, idSha256: sha256Hex(userR6),
        selection: { ...USER_SELECTION_CRITERIA, poolSize: ordered.length },
    },
    syntheticPrincipals: {
        userId: SYNTHETIC_PRINCIPAL_USER_ID,
        schoolSlug: SYNTHETIC_ABSENT_SCHOOL_SLUG,
    },
    periods: PERIOD_CONTRACT,
    routes,
    perfRouteIds: [...PERF_ROUTE_IDS],
    negativeRouteIds: [...NEGATIVE_ROUTE_IDS],
    normalization: NORMALIZATION_CONTRACT,
    sampling: SAMPLING_CONTRACT,
    gates: GATES,
    lifecycle: LIFECYCLE_GATES,
    populationHashes: {
        oroSha256: fileSha(path.join(DC, 'usuarios_colegios_oro.json')),
        groupsSha256: fileSha(path.join(DATA, 'groups_db.json')),
        schoolsSha256: fileSha(path.join(DATA, 'schools_db.json')),
        groupR7MembersSha256: sha256Hex(canonicalJson(members(groupR7Record).slice().sort())),
        groupR7MemberCount: members(groupR7Record).length,
        oroUserCount: oro.length,
        groupCount: groups.length,
    },
    driftCriteria: {
        productionCommitMustMatch: true,
        productionImageIdMustMatch: true,
        flagsMustBeOff: true,
        organizationIdsMustExist: true,
        groupIdMustExist: true,
        userIdMustExist: true,
        groupMembershipMustMatchHash: true,
        acceptanceContractShaMustMatch: true,
        routeStatusesMustMatch: true,
        routeTopLevelKeysMustMatch: true,
        expiryMustNotBePassed: true,
    },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(corpus, null, 1), { mode: 0o600 });
fs.chmodSync(OUT, 0o600);

/**
 * Descriptor sanitizado — el que sí se versiona.
 *
 * Regla aplicada tras la revisión de privacidad: **ningún identificador
 * exacto**, ni de usuario ni de grupo ni de organización. El nombre
 * institucional sí aparece porque ya es público en el propio producto y hace
 * falta para leer el documento; el `id` interno no aporta nada al lector y sí
 * amplía superficie, así que se sustituye por su hash truncado. Ante la duda,
 * alias y hash.
 */
if (args.sanitizedOut) {
    const sanitized = {
        corpusId: corpus.corpusId,
        corpusVersion: corpus.corpusVersion,
        generatedAt: corpus.generatedAt,
        expiresAt: corpus.expiresAt,
        reviewBy: corpus.reviewBy,
        production: {
            commit: corpus.production.commit,
            imageRef: corpus.production.imageRef,
            observabilityCommit: corpus.production.observabilityCommit,
            requiredFlags: corpus.production.requiredFlags,
        },
        acceptanceContractVersion: corpus.acceptanceContractVersion,
        acceptanceContractSha256: corpus.acceptanceContractSha256,
        rootOnlyArtifact: {
            path: '/root/stats-legacy-perf-corpus-01a/PRODUCTION-CANARY-CORPUS.json',
            mode: '0600 root:root',
            containsExactIdentifiers: true,
        },
        organizations: corpus.organizations.map((o) => ({
            alias: o.alias, name: o.name, idHash8: shortHash(o.id), slug: o.slug,
            addressable: o.addressable, groups: o.groups,
            membersInOro: o.membersInOro, activeReaders: o.activeReaders,
            dataState: o.dataState,
        })),
        group: {
            alias: corpus.group.alias, idHash8: shortHash(corpus.group.id),
            organizationAlias: corpus.group.organizationAlias, type: corpus.group.type,
            membersInOro: corpus.group.membersInOro, activeReaders: corpus.group.activeReaders,
            selection: corpus.group.selection,
        },
        user: {
            alias: corpus.user.alias, idHash8: shortHash(corpus.user.id),
            selection: corpus.user.selection,
        },
        syntheticPrincipals: corpus.syntheticPrincipals,
        periods: corpus.periods,
        routes: corpus.routes.map((r) => {
            const { path: _resolved, ...rest } = r;   // la ruta resuelta lleva IDs
            return rest;
        }),
        normalization: corpus.normalization,
        sampling: corpus.sampling,
        gates: corpus.gates,
        lifecycle: corpus.lifecycle,
        populationCounts: {
            oroUserCount: corpus.populationHashes.oroUserCount,
            groupCount: corpus.populationHashes.groupCount,
            groupR7MemberCount: corpus.populationHashes.groupR7MemberCount,
        },
        driftCriteria: corpus.driftCriteria,
    };
    fs.writeFileSync(String(args.sanitizedOut), `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o644 });
    console.log(`descriptor sanitizado: ${args.sanitizedOut}`);
}

console.log(`corpus escrito: ${OUT}`);
console.log(`  acceptanceContractSha256 : ${corpus.acceptanceContractSha256}`);
for (const o of corpus.organizations) {
    console.log(`  ${o.alias}  ${o.name.padEnd(28)} idHash=${shortHash(o.id)} ` +
        `addr=${o.addressable} inOro=${o.membersInOro} active=${o.activeReaders} ${o.dataState}`);
}
console.log(`  ${GROUP_ALIAS} idHash=${shortHash(groupR7.id)} inOro=${groupR7.membersInOro} ` +
    `active=${groupR7.activeReaders} (elegibles=${eligible.length})`);
console.log(`  ${USER_ALIAS} idHash=${shortHash(userR6)} (pool=${ordered.length})`);
