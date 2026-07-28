/**
 * migrate.mjs — CHP-MEM-MEDIATOR-647-01A.
 *
 * Migrador GENÉRICO de reparación de membership: añade un principal ya
 * existente al array `mediatorIds` de un grupo. **DRY-RUN POR DEFECTO.**
 *
 *   node scripts/migrations/chp-mem-mediator-647/migrate.mjs \
 *        --manifest <ruta> --root <dir> [--json]
 *   node ... --manifest <ruta> --root <dir> --apply     ← exige CHP_BACKUP_GATE=GREEN
 *
 * Por qué existe: un mediador legítimo puede figurar en `memberIds` de su grupo
 * y no en `mediatorIds`. `cis.resolveScope` sólo deriva scope institucional de
 * las membresías con `role === 'mediator'` (que se obtiene de `mediatorIds`),
 * así que ese usuario recibe 403 en la API de métricas v2 pese a ser mediador
 * por rol y pertenecer a la organización correcta.
 *
 * Deliberadamente NO conoce ningún dato productivo:
 *   - `--root` es obligatorio; no hay ruta por defecto.
 *   - El userId objetivo NUNCA está en el código: llega por manifiesto externo
 *     root-only, que no se versiona.
 *
 * Garantías:
 *   - dry-run por defecto; `--apply` exige flag explícito + backup gate;
 *   - rechaza symlinks y path escapes fuera de `--root`;
 *   - valida el schema del store antes de tocar nada;
 *   - precondición sobre el sha256 del grupo objetivo;
 *   - precondición sobre el fingerprint SEMÁNTICO del usuario (excluye
 *     `lastLoginAt`, que es volátil y legítimo);
 *   - backup byte a byte antes de escribir;
 *   - temporal + fsync + rename atómico (mismo filesystem);
 *   - idempotente: si el principal ya está en `mediatorIds` devuelve
 *     ALREADY_APPLIED con 0 cambios, SIN exigir el hash previo;
 *   - no toca `memberIds`, `studentIds`, el padrón de usuarios ni otros grupos;
 *   - la salida no contiene PII: sólo conteos y hashes.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const BACKUP_SUFFIX = '.pre-CHP-MEM-MEDIATOR-647';

/** Roles que el contrato canónico considera mediadores. */
export const MEDIATOR_ROLES = Object.freeze(
    new Set(['profesor', 'mediador', 'teacher', 'librarian', 'coordinator']),
);

/** Campos volátiles que NO invalidan el fingerprint semántico del usuario. */
export const VOLATILE_USER_FIELDS = Object.freeze(new Set(['lastLoginAt']));

export class MigrationStop extends Error {
    constructor(code, detail) {
        super(`STOP — ${code}${detail ? `: ${detail}` : ''}`);
        this.name = 'MigrationStop';
        this.code = code;
    }
}

// ── Rutas seguras ───────────────────────────────────────────────────────────

/** Resuelve una ruta relativa DENTRO de root, rechazando escapes y symlinks. */
export function safeResolve(root, relative) {
    const rootAbs = path.resolve(root);
    const abs = path.resolve(rootAbs, relative);
    const rel = path.relative(rootAbs, abs);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new MigrationStop('PATH_ESCAPE', relative);
    }
    let cursor = rootAbs;
    for (const part of rel.split(path.sep)) {
        cursor = path.join(cursor, part);
        let st;
        try { st = fs.lstatSync(cursor); } catch { break; }
        if (st.isSymbolicLink()) throw new MigrationStop('SYMLINK_REJECTED', relative);
    }
    return abs;
}

// ── Hashes y fingerprints ───────────────────────────────────────────────────

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** sha256 del registro de grupo serializado de forma estable. */
export function groupHash(group) {
    return sha256(JSON.stringify(group, Object.keys(group).sort()));
}

/**
 * Fingerprint SEMÁNTICO de un usuario: excluye los campos volátiles, de modo
 * que un login (que sólo actualiza `lastLoginAt`) NO invalida la precondición,
 * mientras que un cambio de rol, organización o memberships SÍ lo hace.
 */
export function userFingerprint(user) {
    const stable = Object.fromEntries(
        Object.entries(user).filter(([k]) => !VOLATILE_USER_FIELDS.has(k)),
    );
    return sha256(JSON.stringify(stable, Object.keys(stable).sort()));
}

const rolesOf = (u) => (Array.isArray(u?.roles) ? u.roles : (u?.rol ? [u.rol] : []));
export const isMediatorRole = (u) => rolesOf(u).some(r => MEDIATOR_ROLES.has(String(r).toLowerCase()));

// ── Lectura validada ────────────────────────────────────────────────────────

function readArrayStore(abs, label) {
    let st;
    try { st = fs.lstatSync(abs); } catch { throw new MigrationStop('INPUT_MISSING', label); }
    if (st.isSymbolicLink()) throw new MigrationStop('SYMLINK_REJECTED', label);
    if (!st.isFile()) throw new MigrationStop('NOT_REGULAR_FILE', label);
    const raw = fs.readFileSync(abs);
    let parsed;
    try { parsed = JSON.parse(raw.toString('utf8')); } catch { throw new MigrationStop('INVALID_JSON', label); }
    if (!Array.isArray(parsed)) throw new MigrationStop('INVALID_SCHEMA', `${label}: se esperaba un array`);
    return { raw, records: parsed };
}

function validateManifest(m) {
    for (const k of ['principalId', 'groupId', 'organizationId', 'groupsFile', 'usersFile']) {
        if (typeof m?.[k] !== 'string' || !m[k]) throw new MigrationStop('MANIFEST_INVALID', `falta ${k}`);
    }
    if (m.expectedGroupSha256 && typeof m.expectedGroupSha256 !== 'string') {
        throw new MigrationStop('MANIFEST_INVALID', 'expectedGroupSha256');
    }
    return m;
}

// ── Escritura atómica ───────────────────────────────────────────────────────

function atomicWrite(abs, contents) {
    const dir = path.dirname(abs);
    const tmp = path.join(dir, `.${path.basename(abs)}.${crypto.randomBytes(8).toString('hex')}.tmp`);
    let fd;
    try {
        fd = fs.openSync(tmp, 'wx', 0o644);
        fs.writeSync(fd, contents);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tmp, abs);
        // fsync del directorio: garantía POSIX de que la entrada renombrada
        // sobrevive a un corte. En Windows no está soportado (EPERM) y no hay
        // equivalente, así que es best-effort: el rename ya es atómico y el
        // contenido del archivo ya se sincronizó arriba. El destino productivo
        // es Linux, donde sí se ejecuta.
        try {
            const dfd = fs.openSync(dir, 'r');
            try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
        } catch (e) {
            if (e.code !== 'EPERM' && e.code !== 'EISDIR' && e.code !== 'EACCES') throw e;
        }
    } finally {
        if (fd !== undefined) { try { fs.closeSync(fd); } catch { /* noop */ } }
        if (fs.existsSync(tmp)) { try { fs.unlinkSync(tmp); } catch { /* noop */ } }
    }
}

// ── Núcleo ──────────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.root          Directorio raíz de los stores.
 * @param {object} opts.manifest      Manifiesto ya cargado (root-only, no versionado).
 * @param {boolean} [opts.apply]      false = dry-run (por defecto).
 * @param {boolean} [opts.enforceHashes] Exigir precondiciones de hash/fingerprint.
 * @param {string}  [opts.backupEvidence] Evidencia de BACKUP GATE GREEN.
 */
export function runMediatorRepair({
    root, manifest, apply = false, enforceHashes = true, backupEvidence = null,
} = {}) {
    if (!root) throw new MigrationStop('ROOT_REQUIRED', 'usa --root <dir>');
    const m = validateManifest(manifest);

    if (apply) {
        const evidence = backupEvidence ?? process.env.CHP_BACKUP_GATE ?? null;
        if (String(evidence).trim().toUpperCase() !== 'GREEN') {
            throw new MigrationStop('BACKUP_GATE_NOT_GREEN', 'apply exige BACKUP GATE GREEN');
        }
    }

    const groupsAbs = safeResolve(root, m.groupsFile);
    const usersAbs  = safeResolve(root, m.usersFile);
    const groupsStore = readArrayStore(groupsAbs, m.groupsFile);
    const usersStore  = readArrayStore(usersAbs, m.usersFile);

    // ── usuario objetivo ────────────────────────────────────────────────────
    const users = usersStore.records.filter(u => u?.id === m.principalId);
    if (users.length === 0) throw new MigrationStop('TARGET_NOT_FOUND', 'principal ausente del padrón');
    if (users.length > 1)   throw new MigrationStop('TARGET_AMBIGUOUS', `${users.length} registros con el mismo id`);
    const user = users[0];

    if (!isMediatorRole(user))                     throw new MigrationStop('ROLE_MISMATCH', 'el principal no tiene rol mediador');
    if (user.accountStatus && user.accountStatus !== 'active') throw new MigrationStop('ACCOUNT_NOT_ACTIVE', user.accountStatus);
    if (user.organizationId !== m.organizationId)  throw new MigrationStop('ORGANIZATION_MISMATCH', 'organizationId del principal');

    // ── grupo objetivo ──────────────────────────────────────────────────────
    const matches = groupsStore.records.filter(g => g?.id === m.groupId);
    if (matches.length === 0) throw new MigrationStop('GROUP_NOT_FOUND', m.groupId);
    if (matches.length > 1)   throw new MigrationStop('GROUP_AMBIGUOUS', `${matches.length} grupos con el mismo id`);
    const group = matches[0];
    const index = groupsStore.records.indexOf(group);

    if (!group.organizationId)                      throw new MigrationStop('GROUP_NOT_ACTIVE', 'grupo histórico (sin organizationId)');
    if (group.organizationId !== m.organizationId)  throw new MigrationStop('ORGANIZATION_MISMATCH', 'organizationId del grupo');
    if (m.forbiddenOrganizationIds?.includes(group.organizationId)) {
        throw new MigrationStop('GROUP_NOT_ACTIVE', `organización sintética: ${group.organizationId}`);
    }

    const mediatorIds = Array.isArray(group.mediatorIds) ? group.mediatorIds : [];
    const memberIds   = Array.isArray(group.memberIds) ? group.memberIds : [];
    const studentIds  = Array.isArray(group.studentIds) ? group.studentIds : [];

    // ── idempotencia: se evalúa ANTES de exigir el hash previo ──────────────
    // Tras un apply el grupo cambia de hash por definición; exigir el hash
    // original en la segunda ejecución convertiría la idempotencia en un STOP.
    const already = mediatorIds.filter(x => x === m.principalId).length;
    if (already > 0) {
        return {
            unit: 'CHP-MEM-MEDIATOR-647',
            mode: apply ? 'APPLY' : 'DRY_RUN',
            status: 'ALREADY_APPLIED',
            idempotent: true,
            totalChanges: 0,
            applied: false,
            written: [],
            counts: {
                groups: groupsStore.records.length,
                users: usersStore.records.length,
                mediatorIds: mediatorIds.length,
                memberIds: memberIds.length,
                studentIds: studentIds.length,
            },
            groupSha256: groupHash(group),
        };
    }

    // ── precondiciones (sólo cuando hay mutación pendiente) ─────────────────
    if (memberIds.filter(x => x === m.principalId).length !== 1) {
        throw new MigrationStop('MEMBERSHIP_PRECONDITION',
            'el principal debe aparecer exactamente una vez en memberIds');
    }
    if (enforceHashes) {
        if (m.expectedGroupSha256) {
            const actual = groupHash(group);
            if (actual !== m.expectedGroupSha256) {
                throw new MigrationStop('GROUP_HASH_MISMATCH',
                    `esperado ${m.expectedGroupSha256.slice(0, 16)}…, encontrado ${actual.slice(0, 16)}…`);
            }
        }
        if (m.expectedUserFingerprint) {
            const actual = userFingerprint(user);
            if (actual !== m.expectedUserFingerprint) {
                throw new MigrationStop('USER_FINGERPRINT_MISMATCH',
                    'el registro del principal cambió en campos no volátiles');
            }
        }
    }

    // ── mutación única ──────────────────────────────────────────────────────
    const nextGroup = { ...group, mediatorIds: [...mediatorIds, m.principalId] };
    const nextRecords = groupsStore.records.slice();
    nextRecords[index] = nextGroup;

    // invariantes duras antes de escribir
    const changedFields = Object.keys({ ...group, ...nextGroup })
        .filter(k => JSON.stringify(group[k]) !== JSON.stringify(nextGroup[k]));
    if (changedFields.length !== 1 || changedFields[0] !== 'mediatorIds') {
        throw new MigrationStop('OPERATION_SCOPE_EXPANDED', changedFields.join(','));
    }
    if (JSON.stringify(nextGroup.memberIds) !== JSON.stringify(group.memberIds)
        || JSON.stringify(nextGroup.studentIds) !== JSON.stringify(group.studentIds)) {
        throw new MigrationStop('OPERATION_SCOPE_EXPANDED', 'memberIds/studentIds mutados');
    }
    if (nextRecords.length !== groupsStore.records.length) {
        throw new MigrationStop('OPERATION_SCOPE_EXPANDED', 'cambió el número de grupos');
    }
    for (let i = 0; i < nextRecords.length; i++) {
        if (i === index) continue;
        if (JSON.stringify(nextRecords[i]) !== JSON.stringify(groupsStore.records[i])) {
            throw new MigrationStop('OPERATION_SCOPE_EXPANDED', 'otro grupo fue modificado');
        }
    }

    const result = {
        unit: 'CHP-MEM-MEDIATOR-647',
        mode: apply ? 'APPLY' : 'DRY_RUN',
        status: 'PENDING',
        idempotent: false,
        totalChanges: 1,
        applied: false,
        written: [],
        fieldsChanged: ['mediatorIds'],
        counts: {
            groups: groupsStore.records.length,
            users: usersStore.records.length,
            mediatorIdsBefore: mediatorIds.length,
            mediatorIdsAfter: nextGroup.mediatorIds.length,
            memberIds: memberIds.length,
            studentIds: studentIds.length,
        },
        groupSha256Before: groupHash(group),
        groupSha256After: groupHash(nextGroup),
    };

    if (!apply) return result;

    // backup byte a byte + escritura atómica
    const backup = `${groupsAbs}${BACKUP_SUFFIX}`;
    fs.writeFileSync(backup, groupsStore.raw, { mode: 0o600 });
    atomicWrite(groupsAbs, JSON.stringify(nextRecords, null, 2));

    result.status = 'APPLIED';
    result.applied = true;
    result.written = [m.groupsFile];
    result.backup = `${m.groupsFile}${BACKUP_SUFFIX}`;
    return result;
}

/** Restaura el store de grupos desde el backup byte a byte. */
export function rollback({ root, manifest }) {
    const groupsAbs = safeResolve(root, manifest.groupsFile);
    const backup = `${groupsAbs}${BACKUP_SUFFIX}`;
    if (!fs.existsSync(backup)) throw new MigrationStop('BACKUP_MISSING', manifest.groupsFile);
    const raw = fs.readFileSync(backup);
    atomicWrite(groupsAbs, raw);
    return { restored: manifest.groupsFile, sha256: sha256(raw) };
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function argOf(flag, fallback = null) {
    const i = process.argv.indexOf(flag);
    return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
        ? process.argv[i + 1] : fallback;
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (invokedDirectly) {
    try {
        const manifestPath = argOf('--manifest');
        if (!manifestPath) throw new MigrationStop('MANIFEST_REQUIRED', 'usa --manifest <ruta>');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        const out = runMediatorRepair({
            root: argOf('--root'),
            manifest,
            apply: process.argv.includes('--apply'),
            enforceHashes: !process.argv.includes('--no-hash-check'),
        });
        if (process.argv.includes('--json')) {
            console.log(JSON.stringify(out, null, 2));
        } else {
            console.log(`CHP-MEM-MEDIATOR-647 — modo ${out.mode} — ${out.status}`);
            console.log(`  grupos=${out.counts.groups} usuarios=${out.counts.users}`);
            if (out.totalChanges > 0) {
                console.log(`  mediatorIds: ${out.counts.mediatorIdsBefore} → ${out.counts.mediatorIdsAfter}`);
                console.log(`  memberIds=${out.counts.memberIds} studentIds=${out.counts.studentIds} (sin cambios)`);
            }
            console.log(`\n${out.totalChanges} cambio(s) ${out.applied ? 'APLICADOS' : 'pendientes — NADA se escribió'}.`);
        }
        process.exit(0);
    } catch (e) {
        console.error(e instanceof MigrationStop ? e.message : `STOP — UNEXPECTED: ${e.message}`);
        process.exit(1);
    }
}
