#!/usr/bin/env node
/**
 * importIdentityCandidate.mjs — CHP-IDDB-02A.
 *
 * Construye una CANDIDATE local de identity.db (esquema v2) a partir de las
 * fuentes canónicas y de las disposiciones congeladas en CHP-IDDB-01A..01D.
 *
 * Principios:
 *   - FAIL-CLOSED en todo: ruta de salida, hashes de fuente, plan, conteos,
 *     run_id. Ante cualquier duda no escribe nada.
 *   - DETERMINÍSTICO: cero `Date.now()`, cero azar. Todas las marcas de tiempo
 *     salen del manifiesto; todos los identificadores derivados son hashes de
 *     su contenido. Dos ejecuciones con el mismo manifiesto producen el mismo
 *     volcado canónico.
 *   - ATÓMICO: la base se construye en un fichero temporal y solo se mueve a
 *     su sitio tras confirmar la transacción. Una interrupción deja la
 *     candidate anterior intacta o ningún fichero, nunca una a medias.
 *   - SIN IDs PRODUCTIVOS EN CÓDIGO: todo lo específico de producción entra
 *     por un manifiesto root-only que se pasa por argumento.
 *
 * Uso:
 *   node scripts/identity/importIdentityCandidate.mjs --dry-run \
 *        --source-manifest <path> --output <path.candidate.db> --repo <path>
 *   node scripts/identity/importIdentityCandidate.mjs --apply ...
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { runMigrations } from '../../server/db/migrate.js';

export const SCHEMA_VERSION = 'v2';
export const CANDIDATE_SUFFIX = '.candidate.db';

/** Marcadores de ruta productiva: la candidate jamás puede caer en ninguna. */
export const PRODUCTION_PATH_MARKERS = ['/var/www/chibalete', '/opt/chibaleteplus', '/app/data'];
/** Directorios de stores: prohibidos como destino. */
export const FORBIDDEN_OUTPUT_SEGMENTS = ['data', 'data-critical', 'public', 'uploads'];
/** Fuentes prohibidas: censos superseded, backups y el store de insights. */
export const FORBIDDEN_SOURCE_BASENAMES = [/^users_db\.json$/i, /backup/i, /^insights\.db$/i];

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** JSON canónico estable (claves ordenadas en profundidad). */
export function canonicalJson(value) {
    if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
    if (value && typeof value === 'object') {
        return '{' + Object.keys(value).sort()
            .map(k => JSON.stringify(k) + ':' + canonicalJson(value[k])).join(',') + '}';
    }
    return JSON.stringify(value === undefined ? null : value);
}

export class ImportError extends Error {
    constructor(classification, message) {
        super(`${classification}: ${message}`);
        this.classification = classification;
    }
}

// ── Validación de la ruta de salida ──────────────────────────────────────
export function assertSafeOutputPath(outputPath, repoRoot) {
    if (!outputPath) throw new ImportError('OUTPUT_REQUIRED', 'se exige --output explícito');
    const abs = path.resolve(outputPath);
    const base = path.basename(abs);
    if (!base.endsWith(CANDIDATE_SUFFIX)) {
        throw new ImportError('PRODUCTION_PATH_REJECTED',
            `el destino debe terminar en ${CANDIDATE_SUFFIX} (recibido "${base}")`);
    }
    const norm = abs.split(path.sep).join('/');
    for (const marker of PRODUCTION_PATH_MARKERS) {
        if (norm.includes(marker)) {
            throw new ImportError('PRODUCTION_PATH_REJECTED', `ruta productiva: contiene "${marker}"`);
        }
    }
    const segments = norm.split('/');
    for (const seg of FORBIDDEN_OUTPUT_SEGMENTS) {
        if (segments.includes(seg)) {
            throw new ImportError('PRODUCTION_PATH_REJECTED', `ruta de store: contiene el segmento "${seg}"`);
        }
    }
    if (repoRoot) {
        const rel = path.relative(path.resolve(repoRoot), abs);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
            throw new ImportError('PRODUCTION_PATH_REJECTED', 'el destino cae dentro del repositorio');
        }
    }
    const configured = process.env.IDENTITY_DB ? path.resolve(process.env.IDENTITY_DB) : null;
    if (configured && configured === abs) {
        throw new ImportError('PRODUCTION_PATH_REJECTED', 'el destino es la ruta configurada de identity.db');
    }
    return abs;
}

function assertSafeSource(sourcePath) {
    const base = path.basename(sourcePath);
    for (const re of FORBIDDEN_SOURCE_BASENAMES) {
        if (re.test(base)) {
            throw new ImportError('SOURCE_OF_TRUTH_CHANGED',
                `fuente no autorizada: "${base}" (padrón superseded, backup o insights)`);
        }
    }
}

// ── Manifiesto ───────────────────────────────────────────────────────────
const REQUIRED_MANIFEST_FIELDS = [
    'unit', 'runId', 'policyVersion', 'generatedAt', 'sourceCommit',
    'schemaVersion', 'sources', 'frozenArtifacts', 'expectedCounts', 'dispositions',
];

export function loadManifest(manifestPath) {
    if (!manifestPath) throw new ImportError('MANIFEST_REQUIRED', 'se exige --source-manifest');
    let m;
    try { m = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch (e) { throw new ImportError('MANIFEST_UNREADABLE', e.message); }
    for (const f of REQUIRED_MANIFEST_FIELDS) {
        if (m[f] === undefined) throw new ImportError('MANIFEST_INCOMPLETE', `falta el campo "${f}"`);
    }
    if (m.schemaVersion !== SCHEMA_VERSION) {
        throw new ImportError('MANIFEST_INCOMPLETE',
            `schemaVersion "${m.schemaVersion}" != "${SCHEMA_VERSION}"`);
    }
    return m;
}

function readVerifiedSource(entry, label) {
    assertSafeSource(entry.path);
    let buf;
    try { buf = fs.readFileSync(entry.path); }
    catch (e) { throw new ImportError('SOURCE_UNREADABLE', `${label}: ${e.message}`); }
    const got = sha256(buf);
    if (entry.sha256 && got !== entry.sha256) {
        throw new ImportError('SOURCE_HASH_MISMATCH',
            `${label}: el fichero cambió respecto al manifiesto`);
    }
    return { json: JSON.parse(buf.toString('utf8')), sha256: got };
}

// ── Normalizaciones deterministas ────────────────────────────────────────
const ROLE_PRECEDENCE = [
    [/^admin(istrador)?$/i, 'administrador'],
    [/^(mediador|profesor|teacher|librarian|coordinator)$/i, 'mediador'],
    [/^lector$/i, 'lector'],
];

export function resolveGlobalRole(roles) {
    const list = Array.isArray(roles) ? roles.map(String) : [];
    for (const [re, canonicalRole] of ROLE_PRECEDENCE) {
        if (list.some(r => re.test(r.trim()))) return canonicalRole;
    }
    return null;
}

const STATUS_MAP = { active: 'active', activo: 'active', inactive: 'inactive',
    inactivo: 'inactive', disabled: 'inactive', suspended: 'suspended' };

export function resolveStatus(accountStatus) {
    if (accountStatus === null || accountStatus === undefined || accountStatus === '') return 'active';
    return STATUS_MAP[String(accountStatus).trim().toLowerCase()] ?? null;
}

const COMBINING_MARKS = /[̀-ͯ]/g;

export function normalizeName(name) {
    return String(name ?? '').normalize('NFD').replace(COMBINING_MARKS, '')
        .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Copia del registro SIN credencial: la candidate no custodia contraseñas. */
export function sanitizeUserRecord(u) {
    const out = {};
    for (const k of Object.keys(u).sort()) {
        if (k === 'password' || k === 'passwordHash') continue;
        out[k] = u[k];
    }
    return out;
}

const h16 = (v) => sha256(String(v)).slice(0, 16);
const h8 = (v) => sha256(String(v)).slice(0, 8);

// ── Construcción del plan ────────────────────────────────────────────────
export function buildPlan(manifest) {
    const padron = readVerifiedSource(manifest.sources.padron, 'padrón canónico');
    const groupsSrc = readVerifiedSource(manifest.sources.groups, 'grupos');
    const schoolsSrc = readVerifiedSource(manifest.sources.institutions, 'instituciones');
    const mapping = readVerifiedSource(manifest.frozenArtifacts.groupInstitutionMapping, 'mapa 01C-R1');
    const tombstoneDoc = readVerifiedSource(manifest.frozenArtifacts.tombstoneProposal, 'tombstones 01D');
    const orphanDoc = readVerifiedSource(manifest.frozenArtifacts.orphanReferenceMap, 'huérfanos 01D');

    const ts = manifest.generatedAt;
    const gclass = new Map(mapping.json.groups.map(r => [r.groupAlias, r]));
    const schoolById = new Map(schoolsSrc.json.map(s => [String(s.id), s]));

    // ── instituciones ────────────────────────────────────────────────────
    const institutions = schoolsSrc.json.map(s => ({
        institution_id: String(s.id),
        official_name: String(s.name),
        name_norm: normalizeName(s.name),
        addressable: 0,           // se recalcula tras resolver los grupos
        status: 'active',
        provenance: 'schools_db.json@CHP-IDDB-01C-R1',
        created_at: ts, updated_at: ts,
    })).sort((a, b) => a.institution_id.localeCompare(b.institution_id));
    if (new Set(institutions.map(i => i.name_norm)).size !== institutions.length) {
        throw new ImportError('INSTITUTION_ALIAS_COLLISION', 'dos instituciones normalizan al mismo nombre');
    }

    // ── grupos ───────────────────────────────────────────────────────────
    const groups = [], excludedGroups = [];
    for (const g of groupsSrc.json) {
        const gid = String(g.id ?? '');
        const alias = 'GRP_' + h8(gid);
        const row = gclass.get(alias);
        if (!row) throw new ImportError('GROUP_NOT_IN_FROZEN_MAP', `grupo sin clasificación congelada: ${alias}`);
        if (row.resolutionClass !== 'CANONICAL_ORG_ID_CONFIRMED') {
            excludedGroups.push({ reference_hash: h16(gid), disposition: row.resolutionClass });
            continue;
        }
        const oid = String(g.organizationId ?? '');
        if (!schoolById.has(oid)) {
            throw new ImportError('INSTITUTION_NOT_REGISTERED', `grupo ${alias} sin institución registrada`);
        }
        if (row.proposedOrganizationIdHash && row.proposedOrganizationIdHash !== h8(oid)) {
            throw new ImportError('FROZEN_ARTIFACT_MISMATCH',
                `la institución de ${alias} no coincide con el mapa congelado`);
        }
        const type = String(g.type ?? '');
        if (type !== 'course' && type !== 'club') {
            throw new ImportError('GROUP_TYPE_INVALID', `grupo ${alias} con tipo "${type}"`);
        }
        groups.push({
            group_id: gid, institution_id: oid, name: String(g.name ?? ''), type,
            status: 'active',
            grade_level: g.gradeLevel ?? g.grade ?? null,
            section: g.section ?? null,
            legacy_school: g.school ?? null,        // procedencia, jamás join key
            provenance: 'groups_db.json@CHP-IDDB-01C-R1',
            raw_json: canonicalJson(g),
            created_at: ts, updated_at: ts, deleted_at: null,
        });
    }
    groups.sort((a, b) => a.group_id.localeCompare(b.group_id));
    const withGroups = new Set(groups.map(g => g.institution_id));
    for (const i of institutions) i.addressable = withGroups.has(i.institution_id) ? 1 : 0;

    // ── usuarios ─────────────────────────────────────────────────────────
    const users = [], excludedUsers = [];
    for (const u of padron.json) {
        const uid = String(u.id ?? '');
        if (!uid) throw new ImportError('USER_WITHOUT_ID', 'registro del padrón sin id');
        if (u._loadtest_marker) {
            excludedUsers.push({ reference_hash: h16(uid), disposition: 'SYNTHETIC_LOADTEST_QUARANTINED' });
            continue;
        }
        const email = String(u.email ?? '').trim();
        if (!email) throw new ImportError('USER_WITHOUT_EMAIL', `usuario ${'USR_' + h8(uid)} sin correo`);
        const globalRole = resolveGlobalRole(u.roles);
        if (!globalRole) throw new ImportError('ROLE_UNMAPPABLE', `usuario ${'USR_' + h8(uid)} sin rol reconocible`);
        const status = resolveStatus(u.accountStatus);
        if (!status) throw new ImportError('STATUS_UNMAPPABLE', `usuario ${'USR_' + h8(uid)} con estado desconocido`);
        users.push({
            canonical_id: uid,
            legacy_identity_hash: h16(uid),
            email_norm: email.toLowerCase(),
            email_raw: email,
            nombre_completo: u.nombre_completo ?? null,
            nombre_usuario: u.nombre_usuario ?? null,
            roles_json: canonicalJson(u.roles ?? []),
            global_role: globalRole,
            status,
            credential_excluded: 1,
            provenance: 'usuarios_colegios_oro.json',
            source_version: manifest.sources.padron.sha256 ?? padron.sha256,
            raw_json: canonicalJson(sanitizeUserRecord(u)),
            created_at: ts, updated_at: ts, deleted_at: null,
        });
    }
    users.sort((a, b) => a.canonical_id.localeCompare(b.canonical_id));
    const emails = users.map(u => u.email_norm);
    if (new Set(emails).size !== emails.length) {
        throw new ImportError('DUPLICATE_EMAIL', 'hay correos repetidos entre las identidades importables');
    }
    const userIds = new Set(users.map(u => u.canonical_id));
    const groupById = new Map(groups.map(g => [g.group_id, g]));

    // ── membresías: clave (grupo, usuario, rol) ──────────────────────────
    const FIELD_ROLES = [['studentIds', 'member'], ['memberIds', 'member'],
                         ['mediatorIds', 'mediator'], ['teacherId', 'mediator']];
    const memberships = [], excludedMemberships = [];
    const seen = new Set();
    for (const g of groupsSrc.json) {
        const gid = String(g.id ?? '');
        const alias = 'GRP_' + h8(gid);
        const cls = gclass.get(alias).resolutionClass;
        for (const [field, role] of FIELD_ROLES) {
            const raw = g[field];
            const list = Array.isArray(raw) ? raw : (raw ? [raw] : []);
            for (const x of list) {
                const uid = String(x);
                const key = `${gid}|${uid}|${role}`;
                if (seen.has(key)) continue;      // misma persona repetida con el mismo rol
                seen.add(key);
                if (cls !== 'CANONICAL_ORG_ID_CONFIRMED') {
                    excludedMemberships.push({
                        reference_hash: h16(key),
                        disposition: cls === 'SYNTHETIC_LOADTEST_EXCLUDED'
                            ? 'SYNTHETIC_MEMBERSHIP_EXCLUDED'
                            : 'LEGACY_GROUP_MEMBERSHIP_PENDING_RETIREMENT',
                    });
                    continue;
                }
                if (!userIds.has(uid)) {
                    excludedMemberships.push({ reference_hash: h16(key), disposition: 'DELETED_IDENTITY_REFERENCE' });
                    continue;
                }
                memberships.push({
                    membership_id: 'mem_' + h16(key),
                    user_id: uid, group_id: gid,
                    institution_id: groupById.get(gid).institution_id,
                    role, status: 'active',
                    provenance: 'groups_db.json@CHP-IDDB-01D',
                    created_at: ts, updated_at: ts,
                });
            }
        }
    }
    memberships.sort((a, b) => a.membership_id.localeCompare(b.membership_id));

    // ── tombstones ───────────────────────────────────────────────────────
    const tombstones = tombstoneDoc.json.tombstones.map(t => ({
        tombstone_id: t.tombstoneId,
        legacy_identity_hash: t.legacyIdentityHash,
        classification: t.classification,
        source: canonicalJson(t.source),
        first_seen_at: t.firstSeenAt ?? null,
        last_seen_at: t.lastSeenAt ?? null,
        reference_count: Number(t.referenceCount ?? 0),
        authentication_allowed: 0,
        provenance: canonicalJson(t.provenance ?? null),
        reviewed_at: t.reviewedAt ?? null,
        policy_version: t.policyVersion ?? manifest.policyVersion,
        created_at: ts,
    })).sort((a, b) => a.tombstone_id.localeCompare(b.tombstone_id));
    for (const t of tombstones) {
        if (t.authentication_allowed !== 0) {
            throw new ImportError('TOMBSTONE_AUTHENTICABLE', `${t.tombstone_id} sería autenticable`);
        }
    }
    const userHashes = new Set(users.map(u => u.legacy_identity_hash));
    for (const t of tombstones) {
        if (userHashes.has(t.legacy_identity_hash)) {
            throw new ImportError('TOMBSTONE_IDENTITY_COLLISION',
                `${t.tombstone_id} colisiona con una identidad canónica`);
        }
    }

    // ── aliases: derivados, nunca impuestos ──────────────────────────────
    const identityAliases = [
        ...users.map(u => ({
            alias_id: 'ali_' + h16('user|' + u.legacy_identity_hash),
            legacy_alias: u.legacy_identity_hash, user_id: u.canonical_id, tombstone_id: null,
            status: 'active', provenance: 'padron_canonico',
            policy_version: manifest.policyVersion, created_at: ts,
        })),
        ...tombstones.map(t => ({
            alias_id: 'ali_' + h16('tomb|' + t.legacy_identity_hash),
            legacy_alias: t.legacy_identity_hash, user_id: null, tombstone_id: t.tombstone_id,
            status: 'active', provenance: 'CHP-IDDB-01D',
            policy_version: manifest.policyVersion, created_at: ts,
        })),
    ].sort((a, b) => a.alias_id.localeCompare(b.alias_id));
    const aliasKeys = identityAliases.map(a => a.legacy_alias);
    if (new Set(aliasKeys).size !== aliasKeys.length) {
        throw new ImportError('IDENTITY_ALIAS_COLLISION', 'dos aliases activos apuntan al mismo identificador legacy');
    }

    const institutionAliases = institutions.map(i => ({
        alias_id: 'ali_inst_' + h16(i.institution_id),
        alias_original: i.official_name, alias_normalized: i.name_norm,
        institution_id: i.institution_id, status: 'active',
        provenance: 'nombre_oficial_confirmado_01C_R1', created_at: ts,
    })).sort((a, b) => a.alias_id.localeCompare(b.alias_id));

    // ── exclusiones: una fila por entidad no importada ───────────────────
    const orphanExclusions = orphanDoc.json.orphans
        .map(o => ({ entity: 'identity_reference', disposition: o.disposition,
            reference_hash: o.legacyIdentityHash }))
        .sort((a, b) => (a.disposition + a.reference_hash).localeCompare(b.disposition + b.reference_hash));

    const exclusions = [
        ...excludedUsers.map(e => ({ entity: 'user', ...e })),
        ...excludedGroups.map(e => ({ entity: 'group', ...e })),
        ...excludedMemberships.map(e => ({ entity: 'membership', ...e })),
        ...orphanExclusions,
    ].map(e => ({
        exclusion_id: 'exc_' + h16(`${e.entity}|${e.disposition}|${e.reference_hash}`),
        entity: e.entity, disposition: e.disposition, reference_hash: e.reference_hash,
        provenance: 'CHP-IDDB-01B/01C-R1/01D', created_at: ts,
    })).sort((a, b) => a.exclusion_id.localeCompare(b.exclusion_id));
    if (new Set(exclusions.map(e => e.exclusion_id)).size !== exclusions.length) {
        throw new ImportError('EXCLUSION_COLLISION', 'dos exclusiones comparten identificador derivado');
    }

    const counts = {
        users: users.length,
        institutions: institutions.length,
        groups: groups.length,
        memberships: memberships.length,
        tombstones: tombstones.length,
        identityAliases: identityAliases.length,
        institutionAliases: institutionAliases.length,
        exclusions: exclusions.length,
        exclusionsByDisposition: exclusions.reduce((acc, e) => {
            const k = `${e.entity}:${e.disposition}`;
            acc[k] = (acc[k] ?? 0) + 1; return acc;
        }, {}),
        syntheticUsersImported: 0,
        syntheticGroupsImported: 0,
        legacyGroupsImported: 0,
        syntheticMembershipsImported: 0,
        legacyMembershipsImported: 0,
        membershipsTowardTombstones: 0,
        fabricatedMemberships: 0,
        rejectedWithoutDisposition: 0,
    };

    const sourceHashes = {
        padron: padron.sha256, groups: groupsSrc.sha256, institutions: schoolsSrc.sha256,
        groupInstitutionMapping: mapping.sha256, tombstoneProposal: tombstoneDoc.sha256,
        orphanReferenceMap: orphanDoc.sha256,
    };
    const plan = { schemaVersion: SCHEMA_VERSION, users, institutions, groups, memberships,
        tombstones, identityAliases, institutionAliases, exclusions };
    const planHash = sha256(canonicalJson(plan));
    const derivedRunId = 'run_' + sha256(canonicalJson({ planHash, sourceHashes })).slice(0, 16);

    return { plan, planHash, derivedRunId, sourceHashes, counts, generatedAt: ts };
}

function reconcileCounts(counts, expected) {
    const diffs = [];
    for (const [k, v] of Object.entries(expected)) {
        if (counts[k] === undefined) { diffs.push(`${k}: no calculado`); continue; }
        if (counts[k] !== v) diffs.push(`${k}: esperado ${v}, obtenido ${counts[k]}`);
    }
    if (diffs.length) throw new ImportError('COUNT_RECONCILIATION_FAILED', diffs.join('; '));
}

// ── Escritura ────────────────────────────────────────────────────────────
function insertAll(db, table, rows) {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const stmt = db.prepare(
        `INSERT INTO ${table}(${cols.join(',')}) VALUES (${cols.map(c => '@' + c).join(',')})`);
    for (const r of rows) stmt.run(r);
}

/** Volcado canónico determinístico: base para comparar dos ejecuciones. */
export function logicalDump(db) {
    const tables = ['institutions', 'users', 'groups', 'memberships', 'identity_tombstones',
        'identity_aliases', 'institution_aliases', 'migration_exclusions'];
    const out = {};
    for (const t of tables) {
        const cols = db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name).sort();
        out[t] = db.prepare(`SELECT ${cols.join(',')} FROM ${t}`).all()
            .map(r => canonicalJson(r)).sort();
    }
    const runs = db.prepare(
        `SELECT run_id, schema_version, plan_hash, status, counts_json FROM migration_runs`).all();
    out.migration_runs = runs.map(r => canonicalJson(r)).sort();
    return out;
}

export function logicalHash(db) { return sha256(canonicalJson(logicalDump(db))); }

export async function importIdentityCandidate({
    manifestPath, outputPath, repoRoot, mode = 'dry-run', beforeCommit = null, log = () => {},
} = {}) {
    const manifest = loadManifest(manifestPath);
    const abs = assertSafeOutputPath(outputPath, repoRoot);
    const built = buildPlan(manifest);

    if (manifest.expectedPlanHash && manifest.expectedPlanHash !== built.planHash) {
        throw new ImportError('IMPORT_NONDETERMINISTIC',
            'el plan calculado no coincide con el declarado en el manifiesto');
    }
    if (manifest.runId !== built.derivedRunId) {
        throw new ImportError('SOURCE_OR_PLAN_MISMATCH_FOR_RUN_ID',
            'el run_id declarado no se deriva de esta fuente y este plan');
    }
    reconcileCounts(built.counts, manifest.expectedCounts);

    const report = {
        mode, runId: manifest.runId, planHash: built.planHash, schemaVersion: SCHEMA_VERSION,
        sourceHashes: built.sourceHashes, counts: built.counts, output: abs, applied: false,
        result: 'DRY_RUN_OK',
    };
    if (mode !== 'apply') return report;

    // ── ¿ya existe una candidate en el destino? ──────────────────────────
    if (fs.existsSync(abs)) {
        const existing = new Database(abs, { readonly: true });
        let stored = null;
        try {
            const hasRuns = existing.prepare(
                `SELECT name FROM sqlite_master WHERE type='table' AND name='migration_runs'`).get();
            if (!hasRuns) throw new ImportError('UNKNOWN_OUTPUT_FILE',
                'el destino existe y no es una candidate de este importador');
            stored = existing.prepare(
                `SELECT run_id, plan_hash, source_hashes_json, status FROM migration_runs`).all();
        } finally { existing.close(); }
        const mine = stored.find(r => r.run_id === manifest.runId);
        if (!mine) {
            throw new ImportError('UNKNOWN_OUTPUT_FILE',
                'el destino contiene otra importación; no se sobrescribe');
        }
        if (mine.plan_hash !== built.planHash
            || mine.source_hashes_json !== canonicalJson(built.sourceHashes)) {
            throw new ImportError('SOURCE_OR_PLAN_MISMATCH_FOR_RUN_ID',
                'el run_id ya existe con otra fuente o plan');
        }
        if (mine.status !== 'completed') {
            throw new ImportError('PARTIAL_IMPORT_LEFT', `run previo en estado "${mine.status}"`);
        }
        log(`[import] run ${manifest.runId} ya aplicado — no-op`);
        return { ...report, applied: false, result: 'NOOP_ALREADY_APPLIED' };
    }

    // ── construcción atómica sobre un temporal ───────────────────────────
    const tmp = abs + '.partial';
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true });
    for (const suffix of ['-wal', '-shm']) {
        if (fs.existsSync(tmp + suffix)) fs.rmSync(tmp + suffix, { force: true });
    }
    const db = new Database(tmp);
    try {
        db.pragma('journal_mode = DELETE');   // un único fichero: el rename es atómico
        db.pragma('foreign_keys = ON');
        runMigrations(db, m => log(m));

        const tx = db.transaction(() => {
            db.prepare(`INSERT INTO migration_runs(run_id,schema_version,source_hashes_json,plan_hash,
                        status,counts_json,started_at) VALUES (?,?,?,?,?,?,?)`)
                .run(manifest.runId, SCHEMA_VERSION, canonicalJson(built.sourceHashes),
                    built.planHash, 'started', canonicalJson(built.counts), built.generatedAt);
            insertAll(db, 'institutions', built.plan.institutions);
            insertAll(db, 'users', built.plan.users);
            insertAll(db, 'groups', built.plan.groups);
            insertAll(db, 'memberships', built.plan.memberships);
            insertAll(db, 'identity_tombstones',
                built.plan.tombstones.map(t => ({ ...t, migration_run_id: manifest.runId })));
            insertAll(db, 'identity_aliases', built.plan.identityAliases);
            insertAll(db, 'institution_aliases', built.plan.institutionAliases);
            insertAll(db, 'migration_exclusions',
                built.plan.exclusions.map(e => ({ ...e, run_id: manifest.runId })));

            const fk = db.pragma('foreign_key_check');
            if (fk.length) throw new ImportError('BROKEN_FOREIGN_KEY', `${fk.length} filas`);
            db.prepare(`UPDATE migration_runs SET status='completed', completed_at=? WHERE run_id=?`)
                .run(built.generatedAt, manifest.runId);

            // Punto de interrupción inyectable: los tests lo usan para simular
            // un fallo ANTES del commit y comprobar que no queda nada.
            if (typeof beforeCommit === 'function') beforeCommit(db);
        });
        tx();
        db.close();
        fs.renameSync(tmp, abs);            // publicación atómica
        try { fs.chmodSync(abs, 0o600); } catch { /* sistemas sin modo POSIX */ }
        log(`[import] candidate escrita: ${abs}`);
        return { ...report, applied: true, result: 'APPLIED' };
    } catch (e) {
        try { db.close(); } catch { /* noop */ }
        for (const p of [tmp, tmp + '-wal', tmp + '-shm']) {
            if (fs.existsSync(p)) fs.rmSync(p, { force: true });
        }
        throw e instanceof ImportError ? e : new ImportError('IMPORT_FAILED', e.message);
    }
}

// ── CLI ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const a = { mode: null };
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i];
        if (t === '--dry-run') a.mode = 'dry-run';
        else if (t === '--apply') a.mode = 'apply';
        else if (t === '--source-manifest') a.manifestPath = argv[++i];
        else if (t === '--output') a.outputPath = argv[++i];
        else if (t === '--repo') a.repoRoot = argv[++i];
    }
    return a;
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]).endsWith('importIdentityCandidate.mjs');
if (invokedDirectly) {
    const a = parseArgs(process.argv.slice(2));
    if (!a.mode) {
        console.error('Falta --dry-run o --apply');
        process.exit(2);
    }
    importIdentityCandidate({ ...a, log: m => console.log(m) })
        .then(r => { console.log(JSON.stringify(r, null, 1)); })
        .catch(e => {
            console.error(`STOP — ${e.classification ?? 'IMPORT_FAILED'}: ${e.message}`);
            process.exit(1);
        });
}
