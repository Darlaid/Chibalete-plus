#!/usr/bin/env node
/**
 * reconcileIdentityShadow.mjs — CHP-IDDB-02B-A.
 *
 * Compara el padrón JSON (autoridad) contra el espejo SQLite y, si se pide,
 * converge el espejo. El JSON nunca se modifica: la reconciliación es
 * unidireccional JSON → SQLite.
 *
 *   --check   read-only, devuelve el diagnóstico
 *   --plan    read-only, devuelve además las operaciones que aplicaría
 *   --apply   converge el espejo (idempotente, con auditoría propia)
 *
 * Reglas heredadas de 01A–01D y del contrato del importador: no se leen
 * backups ni `.env`, no se consultan eventos, progreso ni insights, no se
 * fusiona por nombre o correo, no se recrean tombstones como usuarios y no se
 * importan las exclusiones congeladas.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import {
    mirrorSnapshotV2, assertShadowCapable, projectUsers, projectGroups,
    projectMemberships, projectInstitutions,
} from '../../server/db/identityShadowV2.js';
import { composeWriterId } from '../../server/db/identityWriteSurface.mjs';
import { runtimeInstanceId } from '../../server/healthHandler.js';
import { loadManifest, canonicalJson, ImportError } from './importIdentityCandidate.mjs';

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const h16 = (s) => sha(s).slice(0, 16);

export const RECONCILIATION_STATES = ['MATCH', 'MISSING_IN_SQLITE', 'STALE_IN_SQLITE',
    'UNEXPECTED_IN_SQLITE', 'CONTRACT_VIOLATION'];

export const FORBIDDEN_SOURCE = [/backup/i, /^\.env/i, /^insights\.db$/i,
    /^events\.db$/i, /^progress\.db$/i];

export function assertReadableSource(p) {
    const base = path.basename(p);
    for (const re of FORBIDDEN_SOURCE) {
        if (re.test(base)) {
            throw new ImportError('SOURCE_NOT_AUTHORIZED', `fuente no autorizada: ${base}`);
        }
    }
}

export function assertIdentityDbPath(dbPath, { allowProduction = false } = {}) {
    if (!dbPath) throw new ImportError('IDENTITY_DB_REQUIRED', 'se exige --identity-db explícito');
    const abs = path.resolve(dbPath);
    const norm = abs.split(path.sep).join('/');
    if (!allowProduction) {
        for (const marker of ['/var/www/chibalete', '/opt/chibaleteplus', '/app/data']) {
            if (norm.includes(marker)) {
                throw new ImportError('PRODUCTION_PATH_REJECTED', `ruta productiva: ${marker}`);
            }
        }
    }
    if (!fs.existsSync(abs)) throw new ImportError('IDENTITY_DB_NOT_FOUND', abs);
    return abs;
}

/** Proyección canónica del JSON: lo que el espejo DEBERÍA contener. */
export function projectCanonical(db, sources, at) {
    const sv = { hash: 'reconcile', seq: 0 };
    const inst = projectInstitutions(sources.institutions, at);
    const usersP = projectUsers(sources.users, at, sv);
    const tombs = new Set(db.prepare(`SELECT legacy_identity_hash FROM identity_tombstones`)
        .all().map(r => r.legacy_identity_hash));
    const exclUser = new Set(db.prepare(
        `SELECT reference_hash FROM migration_exclusions WHERE entity='user'`).all().map(r => r.reference_hash));
    const exclGroup = new Set(db.prepare(
        `SELECT reference_hash FROM migration_exclusions WHERE entity='group'`).all().map(r => r.reference_hash));
    const users = usersP.rows.filter(u => !tombs.has(u.legacy_identity_hash)
        && !exclUser.has(u.legacy_identity_hash));
    const groupsP = projectGroups(sources.groups, at);
    const instIds = new Set(inst.rows.map(i => i.institution_id));
    const groups = groupsP.rows.filter(g => !exclGroup.has(h16(g.group_id)) && instIds.has(g.institution_id));
    const mem = projectMemberships(groups, sources.groups, new Set(users.map(u => u.canonical_id)), at);
    return { institutions: inst.rows, users, groups, memberships: mem.rows };
}

function compare(expected, actual, keyOf, fieldsOf) {
    const exp = new Map(expected.map(r => [keyOf(r), r]));
    const act = new Map(actual.map(r => [keyOf(r), r]));
    const out = { MATCH: [], MISSING_IN_SQLITE: [], STALE_IN_SQLITE: [], UNEXPECTED_IN_SQLITE: [] };
    for (const [k, e] of exp) {
        const a = act.get(k);
        if (!a) { out.MISSING_IN_SQLITE.push(h16(k)); continue; }
        out[canonicalJson(fieldsOf(e)) === canonicalJson(fieldsOf(a)) ? 'MATCH' : 'STALE_IN_SQLITE'].push(h16(k));
    }
    for (const k of act.keys()) if (!exp.has(k)) out.UNEXPECTED_IN_SQLITE.push(h16(k));
    return out;
}

export function diagnose(db, sources, at) {
    const expected = projectCanonical(db, sources, at);
    const actual = {
        institutions: db.prepare(`SELECT institution_id, official_name, status FROM institutions`).all(),
        users: db.prepare(`SELECT canonical_id, email_norm, global_role, status FROM users
                           WHERE deleted_at IS NULL`).all(),
        groups: db.prepare(`SELECT group_id, institution_id, name, type, status FROM groups
                            WHERE deleted_at IS NULL`).all(),
        memberships: db.prepare(`SELECT membership_id, user_id, group_id, institution_id, role, status
                                 FROM memberships`).all(),
    };
    const result = {
        institutions: compare(expected.institutions, actual.institutions,
            r => r.institution_id, r => ({ n: r.official_name, s: r.status })),
        users: compare(expected.users, actual.users,
            r => r.canonical_id, r => ({ e: r.email_norm, r: r.global_role, s: r.status })),
        groups: compare(expected.groups, actual.groups,
            r => r.group_id, r => ({ i: r.institution_id, n: r.name, t: r.type, s: r.status })),
        memberships: compare(expected.memberships, actual.memberships,
            r => r.membership_id, r => ({ u: r.user_id, g: r.group_id, i: r.institution_id,
                r2: r.role, s: r.status })),
    };
    // Violaciones de contrato: cosas que el espejo NO debería contener jamás.
    const violations = [];
    const tombIds = db.prepare(`SELECT tombstone_id FROM identity_tombstones`).all().map(r => r.tombstone_id);
    for (const t of tombIds) {
        if (db.prepare(`SELECT 1 FROM users WHERE canonical_id=?`).get(t)) {
            violations.push({ kind: 'TOMBSTONE_AS_USER', ref: h16(t) });
        }
        if (db.prepare(`SELECT 1 FROM memberships WHERE user_id=?`).get(t)) {
            violations.push({ kind: 'MEMBERSHIP_TO_TOMBSTONE', ref: h16(t) });
        }
    }
    const orphanMem = db.prepare(`SELECT COUNT(*) c FROM memberships m
        LEFT JOIN users u ON u.canonical_id=m.user_id WHERE u.canonical_id IS NULL`).get().c;
    if (orphanMem) violations.push({ kind: 'MEMBERSHIP_WITHOUT_USER', ref: String(orphanMem) });
    const excl = db.prepare(`SELECT reference_hash FROM migration_exclusions WHERE entity='user'`).all()
        .map(r => r.reference_hash);
    const exclSet = new Set(excl);
    for (const u of actual.users) {
        if (exclSet.has(h16(u.canonical_id))) {
            violations.push({ kind: 'EXCLUDED_IDENTITY_PRESENT', ref: h16(u.canonical_id) });
        }
    }
    const counts = {};
    for (const [entity, r] of Object.entries(result)) {
        counts[entity] = Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.length]));
    }
    counts.CONTRACT_VIOLATION = violations.length;
    const clean = violations.length === 0 && Object.values(result).every(r =>
        r.MISSING_IN_SQLITE.length === 0 && r.STALE_IN_SQLITE.length === 0
        && r.UNEXPECTED_IN_SQLITE.length === 0);
    return { counts, detail: result, violations, state: clean ? 'MATCH' : 'DIVERGENT', expected };
}

/**
 * Deriva de la candidate si sigue siendo promovible frente al JSON de hoy.
 *
 * Una candidate es un CORTE, no un store vivo. Que el fichero fuente haya
 * cambiado no la invalida por sí solo: lo que importa es si cambió algo que la
 * candidate realmente importa.
 *
 *   ALLOWED_NON_IMPORTED_DRIFT — el hash de la fuente cambió pero las
 *   proyecciones canónicas coinciden (p. ej. un lastLoginAt, que identity.db
 *   no almacena y que no altera la identidad).
 *
 *   BLOCKING_IDENTITY_DRIFT — cambió algo que sí define identidad: un usuario
 *   añadido o retirado, un rol, un estado, una membresía, un grupo o una
 *   institución. Ante esto hay que regenerar una candidate atestada con el
 *   mismo importador; promover la vieja sería promover una foto caducada.
 */
export function classifyCandidateDrift(db, manifest, sources, at) {
    const d = diagnose(db, sources, at);
    const sourceChanged = [];
    for (const [key, entry] of Object.entries(manifest.sources ?? {})) {
        try {
            if (entry.sha256 && sha(fs.readFileSync(entry.path)) !== entry.sha256) sourceChanged.push(key);
        } catch { sourceChanged.push(key); }
    }
    const blocking = [];
    for (const [entity, r] of Object.entries(d.detail)) {
        for (const state of ['MISSING_IN_SQLITE', 'STALE_IN_SQLITE', 'UNEXPECTED_IN_SQLITE']) {
            if (r[state].length) blocking.push({ entity, state, n: r[state].length });
        }
    }
    if (d.violations.length) blocking.push({ entity: 'contract', state: 'CONTRACT_VIOLATION',
        n: d.violations.length });
    const classification = blocking.length
        ? 'BLOCKING_IDENTITY_DRIFT'
        : (sourceChanged.length ? 'ALLOWED_NON_IMPORTED_DRIFT' : 'NO_DRIFT');
    return { classification, promotable: blocking.length === 0, sourceChanged, blocking,
        counts: d.counts };
}

export function readSources(manifest) {
    const read = (entry, label) => {
        assertReadableSource(entry.path);
        const buf = fs.readFileSync(entry.path);
        if (entry.sha256 && sha(buf) !== entry.sha256) {
            throw new ImportError('SOURCE_HASH_MISMATCH', label);
        }
        return JSON.parse(buf.toString('utf8'));
    };
    return {
        users: read(manifest.sources.padron, 'padrón'),
        groups: read(manifest.sources.groups, 'grupos'),
        institutions: read(manifest.sources.institutions, 'instituciones'),
    };
}

export async function reconcileIdentityShadow({
    mode = 'check', manifestPath, identityDbPath, at = null, log = () => {}, allowProduction = false,
} = {}) {
    const manifest = loadManifest(manifestPath);
    const abs = assertIdentityDbPath(identityDbPath, { allowProduction });
    const stamp = at ?? manifest.generatedAt;
    const sources = readSources(manifest);

    const db = new Database(abs, { readonly: mode !== 'apply' });
    try {
        const incapable = assertShadowCapable(db);
        if (incapable) throw new ImportError('SHADOW_NOT_CAPABLE', incapable);
        const before = diagnose(db, sources, stamp);
        if (mode === 'check') {
            return { mode, state: before.state, counts: before.counts, violations: before.violations };
        }
        if (mode === 'plan') {
            return { mode, state: before.state, counts: before.counts, violations: before.violations,
                plannedOperations: {
                    institutions: before.counts.institutions.MISSING_IN_SQLITE
                        + before.counts.institutions.STALE_IN_SQLITE,
                    users: before.counts.users.MISSING_IN_SQLITE + before.counts.users.STALE_IN_SQLITE
                        + before.counts.users.UNEXPECTED_IN_SQLITE,
                    groups: before.counts.groups.MISSING_IN_SQLITE + before.counts.groups.STALE_IN_SQLITE
                        + before.counts.groups.UNEXPECTED_IN_SQLITE,
                    memberships: before.counts.memberships.MISSING_IN_SQLITE
                        + before.counts.memberships.STALE_IN_SQLITE
                        + before.counts.memberships.UNEXPECTED_IN_SQLITE,
                } };
        }

        const reconciliationId = 'rec_' + sha(canonicalJson({ manifest: manifest.runId, stamp })).slice(0, 16);
        db.prepare(`INSERT INTO reconciliation_runs(reconciliation_id,mode,source_version,status,
                    counts_json,started_at) VALUES (?,?,?,?,?,?)
                    ON CONFLICT(reconciliation_id) DO UPDATE SET started_at=excluded.started_at`)
            .run(reconciliationId, 'apply', manifest.expectedPlanHash ?? 'n/a', 'failed',
                canonicalJson(before.counts), stamp);

        // Converge dominio a dominio con el mismo espejo del runtime: una sola
        // implementación, un solo conjunto de reglas.
        const reports = [];
        for (const [domain, records] of [['institutions', sources.institutions],
                                         ['users', sources.users], ['groups', sources.groups]]) {
            reports.push(mirrorSnapshotV2(db, {
                domain, records,
                sourceVersion: { hash: sha(canonicalJson(records)).slice(0, 32) + ':' + stamp, seq: Date.now() },
                // El reconciliador NO es el seam HTTP: se atribuye como el
                // escritor fuera de banda que es (CHP-IDDB-02B-D-A).
                writerId: composeWriterId({ runtimeInstance: runtimeInstanceId(),
                    callSite: 'reconcileIdentityShadow.apply' }),
                at: stamp,
            }));
        }
        const after = diagnose(db, sources, stamp);
        db.prepare(`UPDATE reconciliation_runs SET status=?, counts_json=?, completed_at=?
                    WHERE reconciliation_id=?`)
            .run(after.state === 'MATCH' ? 'completed' : 'failed',
                canonicalJson(after.counts), stamp, reconciliationId);
        log(`[reconcile] ${before.state} → ${after.state}`);
        return { mode, reconciliationId, before: before.counts, after: after.counts,
            state: after.state, violations: after.violations,
            applied: reports.reduce((a, r) => a + r.applied, 0),
            noops: reports.reduce((a, r) => a + r.noop, 0),
            failures: reports.reduce((a, r) => a + r.failed, 0) };
    } finally {
        db.close();
    }
}

// ── CLI ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const a = { mode: 'check' };
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i];
        if (t === '--check') a.mode = 'check';
        else if (t === '--plan') a.mode = 'plan';
        else if (t === '--apply') a.mode = 'apply';
        else if (t === '--source-manifest') a.manifestPath = argv[++i];
        else if (t === '--identity-db') a.identityDbPath = argv[++i];
    }
    return a;
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]).endsWith('reconcileIdentityShadow.mjs');
if (invokedDirectly) {
    const a = parseArgs(process.argv.slice(2));
    reconcileIdentityShadow({ ...a, log: m => console.log(m) })
        .then(r => console.log(JSON.stringify(r, null, 1)))
        .catch(e => {
            console.error(`STOP — ${e.classification ?? 'RECONCILE_FAILED'}: ${e.message}`);
            process.exit(1);
        });
}
