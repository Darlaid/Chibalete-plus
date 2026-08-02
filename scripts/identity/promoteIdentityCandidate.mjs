#!/usr/bin/env node
/**
 * promoteIdentityCandidate.mjs — CHP-IDDB-02B-A.
 *
 * Promueve una candidate verificada a la ruta de una identity.db. En esta
 * unidad SOLO se ejercita en sandbox: la promoción productiva es 02B-B.
 *
 * La promoción es una operación de un solo sentido y sin red de seguridad, así
 * que todo se verifica ANTES de tocar el destino y el paso final es un rename
 * atómico dentro del mismo filesystem:
 *
 *   1. candidate y manifiesto obligatorios, con hash exacto
 *   2. esquema v2 + quick_check + integrity_check + foreign_key_check
 *   3. conteos reconciliados contra el manifiesto
 *   4. commit fuente en la allowlist
 *   5. destino explícito, en la allowlist, fuera del repositorio y NO existente
 *   6. copia a un temporal del MISMO filesystem, con creación exclusiva
 *   7. fsync del fichero y del directorio
 *   8. modo 0600 y propietario exigido
 *   9. rename atómico
 *  10. verificación posterior; si algo falla antes del rename, se limpia
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import Database from 'better-sqlite3';
import { ImportError, loadManifest, canonicalJson } from './importIdentityCandidate.mjs';

const sha256File = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

export const REQUIRED_TABLES = ['users', 'institutions', 'groups', 'memberships',
    'identity_tombstones', 'identity_aliases', 'institution_aliases',
    'migration_runs', 'migration_exclusions'];

/** Ruta destino: solo dentro de la allowlist explícita. */
export function assertPromotionTarget(target, { allowlist, repoRoot, mustNotExist = true }) {
    if (!target) throw new ImportError('TARGET_REQUIRED', 'se exige --target explícito');
    const abs = path.resolve(target);
    const norm = abs.split(path.sep).join('/');
    if (!Array.isArray(allowlist) || allowlist.length === 0) {
        throw new ImportError('TARGET_ALLOWLIST_REQUIRED', 'se exige una allowlist de destinos');
    }
    const allowed = allowlist.some(a => norm.startsWith(a.split(path.sep).join('/')));
    if (!allowed) throw new ImportError('TARGET_NOT_ALLOWLISTED', 'destino fuera de la allowlist');
    if (path.basename(abs) !== 'identity.db') {
        throw new ImportError('TARGET_NOT_ALLOWLISTED', 'el destino debe llamarse identity.db');
    }
    if (repoRoot) {
        const rel = path.relative(path.resolve(repoRoot), abs);
        if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
            throw new ImportError('TARGET_NOT_ALLOWLISTED', 'el destino cae dentro del repositorio');
        }
    }
    if (mustNotExist && fs.existsSync(abs)) {
        throw new ImportError('TARGET_ALREADY_EXISTS', 'el destino ya existe; la promoción no sobrescribe');
    }
    return abs;
}

/** Los flags de identidad deben estar apagados durante la promoción. */
export function assertFlagsOff(env = process.env) {
    const on = (v) => v === '1' || String(v).toLowerCase() === 'true';
    if (on(env.IDENTITY_SQLITE_ENABLED) || on(env.IDENTITY_DUAL_WRITE)
        || String(env.IDENTITY_READ ?? 'json').toLowerCase() === 'sqlite') {
        throw new ImportError('IDENTITY_FLAGS_ACTIVE',
            'la promoción exige los flags de identidad apagados');
    }
}

export function verifyCandidate(candidatePath, manifest, { expectedSha256 } = {}) {
    if (!fs.existsSync(candidatePath)) throw new ImportError('CANDIDATE_NOT_FOUND', candidatePath);
    // El hash atestado es OBLIGATORIO. `quick_check` e `integrity_check`
    // verifican la coherencia estructural de la base, NO la autenticidad de su
    // contenido: una alteración de pocos bytes en espacio libre pasa ambos sin
    // inmutarse (comprobado en la suite). La única defensa real contra una
    // candidate manipulada es comparar el hash completo.
    if (!expectedSha256) {
        throw new ImportError('EXPECTED_SHA256_REQUIRED',
            'la promoción exige el hash atestado de la candidate');
    }
    const got = sha256File(candidatePath);
    if (got !== expectedSha256) {
        throw new ImportError('CANDIDATE_MODIFIED', 'el hash de la candidate no coincide con el atestado');
    }
    const db = new Database(candidatePath, { readonly: true });
    try {
        if (Number(db.pragma('user_version', { simple: true })) !== 2) {
            throw new ImportError('SCHEMA_MISMATCH', 'la candidate no declara el esquema v2');
        }
        if (db.pragma('quick_check', { simple: true }) !== 'ok') {
            throw new ImportError('CANDIDATE_INTEGRITY_FAILED', 'quick_check');
        }
        if (db.pragma('integrity_check', { simple: true }) !== 'ok') {
            throw new ImportError('CANDIDATE_INTEGRITY_FAILED', 'integrity_check');
        }
        if (db.pragma('foreign_key_check').length !== 0) {
            throw new ImportError('BROKEN_FOREIGN_KEY', 'foreign_key_check');
        }
        for (const t of REQUIRED_TABLES) {
            if (!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t)) {
                throw new ImportError('SCHEMA_MISMATCH', `falta la tabla ${t}`);
            }
        }
        const counts = {
            users: db.prepare(`SELECT COUNT(*) c FROM users WHERE deleted_at IS NULL`).get().c,
            institutions: db.prepare(`SELECT COUNT(*) c FROM institutions`).get().c,
            groups: db.prepare(`SELECT COUNT(*) c FROM groups WHERE deleted_at IS NULL`).get().c,
            memberships: db.prepare(`SELECT COUNT(*) c FROM memberships`).get().c,
            tombstones: db.prepare(`SELECT COUNT(*) c FROM identity_tombstones`).get().c,
        };
        const exp = manifest.expectedCounts ?? {};
        const diffs = [];
        for (const k of Object.keys(counts)) {
            if (exp[k] !== undefined && exp[k] !== counts[k]) {
                diffs.push(`${k}: esperado ${exp[k]}, obtenido ${counts[k]}`);
            }
        }
        if (diffs.length) throw new ImportError('COUNT_RECONCILIATION_FAILED', diffs.join('; '));
        const run = db.prepare(`SELECT run_id, status FROM migration_runs`).all();
        if (run.length !== 1 || run[0].status !== 'completed') {
            throw new ImportError('CANDIDATE_INTEGRITY_FAILED', 'la candidate no tiene un run completado');
        }
        if (run[0].run_id !== manifest.runId) {
            throw new ImportError('CANDIDATE_MODIFIED', 'el run_id no corresponde al manifiesto');
        }
        return { counts, runId: run[0].run_id, sha256: got };
    } finally { db.close(); }
}

/**
 * fsync del directorio: es lo que hace durable el propio rename. En Linux
 * —que es donde corre producción— se exige. Windows no permite abrir un
 * directorio para fsync, así que allí se reporta como no sincronizado en vez
 * de fingir que lo está.
 * @returns {boolean} si el directorio quedó sincronizado de verdad.
 */
function fsyncDir(p) {
    let fd = null;
    try {
        fd = fs.openSync(p, fs.constants.O_RDONLY);
        fs.fsyncSync(fd);
        return true;
    } catch (e) {
        const tolerable = ['EPERM', 'EINVAL', 'ENOTSUP', 'EISDIR', 'EACCES'].includes(e.code);
        if (process.platform === 'win32' && tolerable) return false;
        throw e;
    } finally {
        try { if (fd !== null) fs.closeSync(fd); } catch { /* noop */ }
    }
}

export async function promoteIdentityCandidate({
    candidatePath, manifestPath, target, allowlist, repoRoot, expectedSha256 = null,
    allowedSourceCommits = null, requiredOwnerUid = null, env = process.env, log = () => {},
} = {}) {
    assertFlagsOff(env);
    const manifest = loadManifest(manifestPath);
    if (Array.isArray(allowedSourceCommits) && !allowedSourceCommits.includes(manifest.sourceCommit)) {
        throw new ImportError('SOURCE_COMMIT_NOT_ALLOWED', 'el commit fuente no está en la allowlist');
    }
    const abs = assertPromotionTarget(target, { allowlist, repoRoot });
    const verified = verifyCandidate(candidatePath, manifest, { expectedSha256 });

    let directorySynced = false;
    const dir = path.dirname(abs);
    if (!fs.existsSync(dir)) throw new ImportError('TARGET_NOT_ALLOWLISTED', 'el directorio destino no existe');
    // Temporal en el MISMO filesystem: sin eso el rename no sería atómico.
    const tmp = path.join(dir, `.identity.promote.${process.pid}.tmp`);
    let fd = null;
    try {
        fd = fs.openSync(tmp, 'wx', 0o600);          // creación exclusiva
        fs.writeSync(fd, fs.readFileSync(candidatePath));
        fs.fsyncSync(fd);
        fs.closeSync(fd); fd = null;
        fs.chmodSync(tmp, 0o600);
        if (requiredOwnerUid !== null) {
            const st = fs.statSync(tmp);
            if (st.uid !== requiredOwnerUid) {
                throw new ImportError('OWNER_MISMATCH', 'el propietario del temporal no es el exigido');
            }
        }
        if (sha256File(tmp) !== verified.sha256) {
            throw new ImportError('CANDIDATE_INTEGRITY_FAILED', 'la copia no coincide con la candidate');
        }
        if (fs.existsSync(abs)) {
            throw new ImportError('TARGET_ALREADY_EXISTS', 'apareció un destino durante la promoción');
        }
        fs.renameSync(tmp, abs);                     // punto de no retorno, atómico
        directorySynced = fsyncDir(dir);             // durabilidad del propio rename
    } catch (e) {
        try { if (fd !== null) fs.closeSync(fd); } catch { /* noop */ }
        try { if (fs.existsSync(tmp)) fs.rmSync(tmp, { force: true }); } catch { /* noop */ }
        throw e instanceof ImportError ? e : new ImportError('PROMOTION_FAILED', e.message);
    }

    // Verificación posterior: la promoción no se declara buena por haber
    // renombrado, sino por lo que hay en el destino.
    const post = verifyCandidate(abs, manifest, { expectedSha256: verified.sha256 });
    const st = fs.statSync(abs);
    const mode = (st.mode & 0o777).toString(8).padStart(3, '0');
    // Windows no implementa modos POSIX: allí se reporta el modo real y no se
    // finge un 0600. En Linux —producción— la exigencia se mantiene dura.
    if (mode !== '600' && process.platform !== 'win32') {
        throw new ImportError('PROMOTION_FAILED', `modo ${mode} != 600`);
    }
    log(`[promote] identity.db promovida en ${abs}`);
    return { promoted: true, target: abs, sha256: post.sha256, runId: post.runId,
        counts: post.counts, mode, atomic: true, directorySynced,
        platform: process.platform };
}

// ── CLI ──────────────────────────────────────────────────────────────────
function parseArgs(argv) {
    const a = {};
    for (let i = 0; i < argv.length; i++) {
        const t = argv[i];
        if (t === '--candidate') a.candidatePath = argv[++i];
        else if (t === '--source-manifest') a.manifestPath = argv[++i];
        else if (t === '--target') a.target = argv[++i];
        else if (t === '--allow') (a.allowlist ??= []).push(argv[++i]);
        else if (t === '--repo') a.repoRoot = argv[++i];
        else if (t === '--expect-sha256') a.expectedSha256 = argv[++i];
        else if (t === '--allow-commit') (a.allowedSourceCommits ??= []).push(argv[++i]);
    }
    return a;
}

const invokedDirectly = process.argv[1]
    && path.resolve(process.argv[1]).endsWith('promoteIdentityCandidate.mjs');
if (invokedDirectly) {
    const a = parseArgs(process.argv.slice(2));
    promoteIdentityCandidate({ ...a, log: m => console.log(m) })
        .then(r => console.log(JSON.stringify(r, null, 1)))
        .catch(e => {
            console.error(`STOP — ${e.classification ?? 'PROMOTION_FAILED'}: ${e.message}`);
            process.exit(1);
        });
}

// Silencia el aviso de `os` sin uso en entornos que lo exigen.
export const _osTmp = () => os.tmpdir();
