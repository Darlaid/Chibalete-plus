/**
 * snapshotCore.mjs — CHP-BACKUP-01-SNAPSHOT-01.
 *
 * Generador fail-closed de snapshots consistentes del estado ESTRUCTURADO
 * autoritativo de Chibalete+ (JSON stores + SQLite + sinks legacy), con
 * verificador independiente. NO cubre uploads (CHP-BACKUP-01-UPLOADS-01),
 * secretos/config DR, retención, cifrado, off-host ni cron (unidades
 * posteriores). No sustituye a scripts/backup-vps.sh todavía.
 *
 * Garantías:
 *   - SQLite: API nativa de online backup (better-sqlite3 db.backup()) desde
 *     una conexión READ-ONLY; jamás cp/tar de .db vivos; jamás se copian
 *     -wal/-shm como archivos; integrity_check sobre la COPIA; una base que
 *     no lo supere invalida el snapshot completo.
 *   - JSON: captura estable por cohorte (fingerprint → copia → parse →
 *     re-fingerprint); cualquier cambio de inode/tamaño/mtime/hash durante la
 *     captura descarta el staging de la cohorte y reintenta completa, con
 *     reintentos acotados; sin estabilidad → fallo sin publicar.
 *   - playback_events.log (JSONL append-only): misma captura estable + cada
 *     línea no vacía debe parsear como JSON y el archivo no vacío debe
 *     terminar en '\n'; un registro parcial estable = fallo (no se trunca,
 *     normaliza ni repara).
 *   - Publicación atómica: todo se construye en <dest>/.staging/<id> y se
 *     publica con rename dentro del mismo filesystem SOLO tras escribir el
 *     marcador COMPLETE; nunca se sobreescribe un snapshot existente; ante
 *     error se retira únicamente el staging de esta ejecución.
 *   - Sin PII: logs, manifiesto y verificador solo manejan nombres lógicos,
 *     tamaños, hashes y estados; jamás contenido de stores.
 *
 * Límites de consistencia (declarados en el manifiesto):
 *   - No hay punto-en-el-tiempo GLOBAL entre bases SQLite distintas ni entre
 *     SQLite y la cohorte JSON: cada activo es internamente consistente y el
 *     conjunto queda acotado por la ventana [started_utc, completed_utc].
 *   - Abrir una fuente WAL en read-only puede requerir crear el -shm de la
 *     FUENTE si no existe (comportamiento de SQLite); no modifica datos.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');           // dependencia YA instalada; no se añade ninguna
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const SCHEMA_VERSION = 1;

export class SnapshotError extends Error {
    constructor(code, detail) {
        super(`SNAPSHOT_${code}${detail ? `: ${detail}` : ''}`);
        this.name = 'SnapshotError';
        this.code = code;
    }
}

// ── FASE 1: allowlist de activos estructurados (nombres reales verificados
//    contra writers/config en CHP-BACKUP-01-AUDIT-01) ────────────────────────
export const ASSET_CATALOG = Object.freeze([
    // data-critical/
    { name: 'usuarios_colegios_oro', root: 'dataCritical', file: 'usuarios_colegios_oro.json', type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'events_db',             root: 'dataCritical', file: 'events.db',                  type: 'sqlite', clazz: 'REQUIRED' },
    { name: 'events_archive_db',     root: 'dataCritical', file: 'events.archive.db',          type: 'sqlite', clazz: 'REQUIRED_IF_PRESENT' },
    // data/
    { name: 'users_db',              root: 'data', file: 'users_db.json',            type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'groups_db',             root: 'data', file: 'groups_db.json',           type: 'json',   clazz: 'REQUIRED' },
    { name: 'content',               root: 'data', file: 'content.json',             type: 'json',   clazz: 'REQUIRED' },
    { name: 'access_db',             root: 'data', file: 'access_db.json',           type: 'json',   clazz: 'REQUIRED' },
    { name: 'progress_db',           root: 'data', file: 'progress.db',              type: 'sqlite', clazz: 'REQUIRED' },
    { name: 'offline_assignments_db',root: 'data', file: 'offline_assignments.db',   type: 'sqlite', clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'sections',              root: 'data', file: 'sections.json',            type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'schools_db',            root: 'data', file: 'schools_db.json',          type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'school_configs',        root: 'data', file: 'school_configs.json',      type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'bundles_db',            root: 'data', file: 'bundles_db.json',          type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'leo_memory_db',         root: 'data', file: 'leo_memory_db.json',       type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'leo_profile_db',        root: 'data', file: 'leo_profile_db.json',      type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'leo_evidence_db',       root: 'data', file: 'leo_evidence_db.json',     type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'leo_interactions_db',   root: 'data', file: 'leo_interactions_db.json', type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'submissions_db',        root: 'data', file: 'submissions_db.json',      type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'interventions_db',      root: 'data', file: 'interventions_db.json',    type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'user_audit_log',        root: 'data', file: 'user_audit_log.json',      type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    // sinks legacy vivos hasta CHP-STATS-02
    { name: 'analytics_db',          root: 'data', file: 'analytics_db.json',        type: 'json',   clazz: 'REQUIRED_IF_PRESENT' },
    { name: 'playback_events_log',   root: 'data', file: 'playback_events.log',      type: 'jsonl',  clazz: 'REQUIRED_IF_PRESENT' },
]);

/** Regla adicional: debe existir AL MENOS un padrón de usuarios. */
const USERS_STORE_NAMES = ['usuarios_colegios_oro', 'users_db'];

/** Exclusiones documentadas (van al manifiesto; jamás se copian aquí). */
export const EXCLUSIONS = Object.freeze([
    { name: 'insights.db (+ext)',            reason: 'EXCLUDED_REGENERABLE: proyección reconstruible desde events.db' },
    { name: 'identity.db',                   reason: 'EXCLUDED_DERIVED: shadow no autoritativo mientras flags IDENTITY_* sigan OFF' },
    { name: '*-wal / *-shm',                 reason: 'EXCLUDED_EPHEMERAL: transitorios SQLite; el online backup ya integra su contenido' },
    { name: '*.bak* / *.pre-* / *.corrupt.* / *.partial', reason: 'EXCLUDED_EPHEMERAL: residuos operativos, no autoritativos' },
    { name: 'dev_seeds.json / test_import_*.csv', reason: 'EXCLUDED_DEV: fixtures de desarrollo' },
    { name: 'public/uploads/',               reason: 'DEFERRED_TO_ANOTHER_UNIT: CHP-BACKUP-01-UPLOADS-01' },
    { name: 'secretos / certificados / compose / nginx', reason: 'DEFERRED_TO_ANOTHER_UNIT: configuración DR' },
    { name: 'código y assets (git/imagenes)', reason: 'EXCLUDED: reconstruible desde Git e imágenes Docker' },
]);

// ── Utilidades ───────────────────────────────────────────────────────────────

function sha256File(p) {
    const h = crypto.createHash('sha256');
    h.update(fs.readFileSync(p));
    return h.digest('hex');
}

function fingerprint(p) {
    const st = fs.statSync(p);
    return { size: st.size, mtimeMs: st.mtimeMs, ino: String(st.ino), sha256: sha256File(p) };
}
function sameFingerprint(a, b) {
    return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ino === b.ino && a.sha256 === b.sha256;
}

function assertNoSymlink(p, what) {
    const st = fs.lstatSync(p);
    if (st.isSymbolicLink()) throw new SnapshotError('SYMLINK_REJECTED', what);
    return st;
}

function isInside(child, parent) {
    const rel = path.relative(parent, child);
    return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function utc() { return new Date().toISOString(); }

function generatorCommit() {
    try {
        return execSync('git rev-parse HEAD', { cwd: __dirname, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim();
    } catch { return 'unknown'; }
}

const noop = () => {};

// ── Validación de raíces y destino (CLI segura) ─────────────────────────────

export function validateRootsAndDest({ dataRoot, dataCriticalRoot, dest }) {
    for (const [label, p] of [['dataRoot', dataRoot], ['dataCriticalRoot', dataCriticalRoot], ['dest', dest]]) {
        if (!p || typeof p !== 'string' || !p.trim()) throw new SnapshotError('PATH_EMPTY', label);
        if (p.split(/[\\/]/).includes('..')) throw new SnapshotError('PATH_TRAVERSAL', label);
    }
    const rData = path.resolve(dataRoot);
    const rDc   = path.resolve(dataCriticalRoot);
    const rDest = path.resolve(dest);

    for (const [label, p] of [['dataRoot', rData], ['dataCriticalRoot', rDc]]) {
        if (!fs.existsSync(p)) throw new SnapshotError('ROOT_MISSING', label);
        if (!assertNoSymlink(p, label).isDirectory()) throw new SnapshotError('ROOT_NOT_DIR', label);
    }
    // Destino: rechazar raíces demasiado amplias.
    const home = path.resolve(os.homedir());
    const fsRoot = path.parse(rDest).root;
    if (rDest === fsRoot || rDest === home) throw new SnapshotError('DEST_TOO_BROAD', rDest);
    if (rDest === rData || rDest === rDc) throw new SnapshotError('DEST_EQUALS_SOURCE');
    if (isInside(rDest, rData) || isInside(rDest, rDc)) throw new SnapshotError('DEST_INSIDE_SOURCE');
    if (isInside(rData, rDest) || isInside(rDc, rDest)) throw new SnapshotError('SOURCE_INSIDE_DEST');
    if (fs.existsSync(rDest)) assertNoSymlink(rDest, 'dest');
    return { dataRoot: rData, dataCriticalRoot: rDc, dest: rDest };
}

// ── Descubrimiento y clasificación ──────────────────────────────────────────

export function discoverAssets({ dataRoot, dataCriticalRoot }) {
    const rootOf = (a) => (a.root === 'data' ? dataRoot : dataCriticalRoot);
    const present = [], absentRequired = [], absentOptional = [];
    for (const a of ASSET_CATALOG) {
        const src = path.join(rootOf(a), a.file);
        if (fs.existsSync(src)) {
            const st = assertNoSymlink(src, `asset:${a.name}`);
            if (!st.isFile()) throw new SnapshotError('ASSET_NOT_FILE', a.name);
            present.push({ ...a, srcPath: src, logicalPath: `${a.root === 'data' ? 'data' : 'data-critical'}/${a.file}` });
        } else if (a.clazz === 'REQUIRED') {
            absentRequired.push(a.name);
        } else {
            absentOptional.push(a.name);
        }
    }
    if (!USERS_STORE_NAMES.some(n => present.find(p => p.name === n))) {
        absentRequired.push('users_store(any-of: usuarios_colegios_oro|users_db)');
    }
    // Archivos no clasificados presentes en las raíces (solo nombres; no se copian).
    const known = new Set(ASSET_CATALOG.map(a => `${a.root}:${a.file}`));
    const unclassified = [];
    for (const [rootKey, rootPath] of [['data', dataRoot], ['dataCritical', dataCriticalRoot]]) {
        for (const f of fs.readdirSync(rootPath)) {
            const full = path.join(rootPath, f);
            let st; try { st = fs.lstatSync(full); } catch { continue; }
            if (!st.isFile()) continue;
            if (known.has(`${rootKey}:${f}`)) continue;
            if (/(-wal|-shm)$/.test(f) || /\.(bak|backup|corrupt|partial)/i.test(f) || /\.pre-/.test(f)
                || /\.pre_/.test(f) || /\.original$/.test(f)
                || f === 'insights.db' || f === 'identity.db' || f === 'dev_seeds.json'
                || f === 'content_db.json' || f === 'progress_db.json'   // huérfano/legacy (ARC-05/ARC-03)
                || /^test_import_.*\.csv$/.test(f)
                || /^insights\.db/.test(f) || /^identity\.db/.test(f) || /^events\.db\./.test(f)) {
                continue; // exclusión documentada por la auditoría (no autoritativo)
            }
            unclassified.push(`${rootKey}/${f}`);
        }
    }
    return { present, absentRequired, absentOptional, unclassified };
}

// ── SQLite: online backup + integrity de la copia ───────────────────────────

/** Exportado para test: la fuente SIEMPRE se abre read-only. */
export function _openSourceReadonly(p) {
    const db = new Database(p, { readonly: true, fileMustExist: true });
    db.pragma('busy_timeout = 5000');            // connection-local; no escribe en la fuente
    return db;
}

async function backupSqliteAsset(asset, destPath, hooks) {
    const started = utc();
    const src = _openSourceReadonly(asset.srcPath);
    try {
        let attempt = 0;
        for (;;) {
            attempt += 1;
            try {
                await src.backup(destPath, hooks?.sqliteProgress
                    ? { progress: (info) => hooks.sqliteProgress(asset.name, info) }
                    : undefined);
                break;
            } catch (e) {
                try { fs.rmSync(destPath, { force: true }); } catch {}
                if (attempt >= 3) throw new SnapshotError('SQLITE_BACKUP_FAILED', `${asset.name} (${e.code || e.message})`);
            }
        }
    } finally {
        try { src.close(); } catch {}
    }
    // integrity_check sobre la COPIA (read-only). Cualquier resultado ≠ ok
    // invalida el snapshot completo.
    let rows;
    const copy = new Database(destPath, { readonly: true, fileMustExist: true });
    try { rows = copy.pragma('integrity_check'); }
    finally { try { copy.close(); } catch {} }
    for (const suf of ['-wal', '-shm']) { try { fs.rmSync(destPath + suf, { force: true }); } catch {} }
    const ok = Array.isArray(rows) && rows.length === 1
        && String(rows[0].integrity_check).toLowerCase() === 'ok';
    if (!ok) throw new SnapshotError('SQLITE_INTEGRITY_FAILED', asset.name);
    return { started, ended: utc(), validation: 'integrity_ok' };
}

// ── JSON / JSONL: captura estable por cohorte ───────────────────────────────

function validateJsonl(text, name) {
    if (text.length === 0) return;                       // log recién inicializado
    if (!text.endsWith('\n')) throw new SnapshotError('JSONL_INCOHERENT', `${name}: sin terminador final`);
    const lines = text.split('\n');
    lines.pop();                                          // '' final por el \n terminal
    for (let i = 0; i < lines.length; i++) {
        if (lines[i] === '') continue;
        try { JSON.parse(lines[i]); }
        catch { throw new SnapshotError('JSONL_INCOHERENT', `${name}: línea ${i + 1} no es JSON completo`); }
    }
}

function captureJsonCohort(assets, stagePathOf, maxRetries, hooks, log) {
    if (assets.length === 0) return { attempts: 0, window: null, fingerprints: new Map() };
    let lastError = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const start = utc();
        const before = new Map(assets.map(a => [a.name, fingerprint(a.srcPath)]));
        for (const a of assets) fs.copyFileSync(a.srcPath, stagePathOf(a));
        hooks?.afterJsonCopy?.(attempt);
        // Validación de las COPIAS (nunca se registra contenido).
        let malformed = null;
        for (const a of assets) {
            const txt = fs.readFileSync(stagePathOf(a), 'utf8');
            try {
                if (a.type === 'json') JSON.parse(txt);
                else validateJsonl(txt, a.name);
            } catch (e) {
                malformed = { asset: a, error: e };
                break;
            }
        }
        const after = new Map(assets.map(a => [a.name, fingerprint(a.srcPath)]));
        const stable = assets.every(a => sameFingerprint(before.get(a.name), after.get(a.name)));
        if (stable && !malformed) {
            return { attempts: attempt, window: { start, end: utc() }, fingerprints: after };
        }
        // Descartar SOLO el staging de la cohorte y reintentar completa.
        for (const a of assets) { try { fs.rmSync(stagePathOf(a), { force: true }); } catch {} }
        if (malformed && stable) {
            // Fuente estable y aún así inválida → fallo cerrado inmediato.
            throw malformed.error instanceof SnapshotError
                ? malformed.error
                : new SnapshotError('JSON_MALFORMED', malformed.asset.name);
        }
        lastError = malformed?.error || new SnapshotError('JSON_COHORT_UNSTABLE');
        log(`[snapshot] cohorte JSON inestable (intento ${attempt}/${maxRetries}) — reintentando`);
    }
    throw lastError instanceof SnapshotError ? lastError : new SnapshotError('JSON_COHORT_UNSTABLE');
}

// ── Permisos ────────────────────────────────────────────────────────────────

function hardenTree(dir) {
    // 0700 dirs / 0600 files. En win32 chmod es best-effort (documentado).
    try { fs.chmodSync(dir, 0o700); } catch {}
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) hardenTree(p);
        else { try { fs.chmodSync(p, 0o600); } catch {} }
    }
}

// ── Dry-run (FASE 3): cero escrituras ───────────────────────────────────────

export function dryRunPlan(optsIn, log = console.log) {
    const roots = validateRootsAndDest(optsIn);
    const disc = discoverAssets(roots);
    const plan = {
        mode: 'dry-run',
        wouldCopy: disc.present.map(a => ({ name: a.name, type: a.type, clazz: a.clazz, action: 'would-copy' })),
        absentRequired: disc.absentRequired,
        absentOptional: disc.absentOptional,
        unclassified: disc.unclassified,
        excluded: EXCLUSIONS.map(e => e.name),
    };
    log(`[dry-run] activos a copiar: ${plan.wouldCopy.length}`);
    for (const a of plan.wouldCopy) log(`  · ${a.name} [${a.type}] (${a.clazz})`);
    if (plan.absentOptional.length) log(`[dry-run] ausentes opcionales: ${plan.absentOptional.join(', ')}`);
    if (plan.absentRequired.length) log(`[dry-run] REQUIRED ausentes: ${plan.absentRequired.join(', ')}`);
    if (plan.unclassified.length)   log(`[dry-run] sin clasificar (no se copiarían): ${plan.unclassified.join(', ')}`);
    return plan; // no crea destino, no abre bases, no copia, no genera manifiesto
}

// ── Creación de snapshot ────────────────────────────────────────────────────

export async function createSnapshot(optsIn) {
    const {
        snapshotId: requestedId,
        maxJsonRetries = 3,
        log = noop,
        _testHooks = null,
    } = optsIn;
    if (!Number.isInteger(maxJsonRetries) || maxJsonRetries < 1 || maxJsonRetries > 20) {
        throw new SnapshotError('BAD_RETRY_LIMIT');
    }
    try { process.umask(0o077); } catch {}

    const roots = validateRootsAndDest(optsIn);
    const snapshotId = requestedId ?? `snap-${utc().replace(/[:.]/g, '-')}`;
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(snapshotId) || snapshotId.includes('..')) {
        throw new SnapshotError('BAD_SNAPSHOT_ID', snapshotId);
    }

    const finalDir   = path.join(roots.dest, snapshotId);
    const stagingDir = path.join(roots.dest, '.staging', snapshotId);
    if (fs.existsSync(finalDir))   throw new SnapshotError('SNAPSHOT_ID_COLLISION', snapshotId);
    if (fs.existsSync(stagingDir)) throw new SnapshotError('STAGING_COLLISION', snapshotId);

    const startedUtc = utc();
    const disc = discoverAssets(roots);
    if (disc.absentRequired.length) {
        throw new SnapshotError('REQUIRED_ASSET_MISSING', disc.absentRequired.join(', '));
    }

    fs.mkdirSync(stagingDir, { recursive: true, mode: 0o700 });
    const stagePathOf = (a) => {
        const sub = a.root === 'data' ? 'data' : 'data-critical';
        const dir = path.join(stagingDir, sub);
        fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
        return path.join(dir, a.file);
    };

    const manifestAssets = [];
    try {
        // 1) SQLite: online backup por base.
        for (const a of disc.present.filter(x => x.type === 'sqlite')) {
            log(`[snapshot] sqlite backup: ${a.name}`);
            const r = await backupSqliteAsset(a, stagePathOf(a), _testHooks);
            manifestAssets.push({
                name: a.name, clazz: a.clazz, type: a.type, logical_path: a.logicalPath,
                captured: { start: r.started, end: r.ended }, validation: r.validation,
            });
        }
        // 2) Cohorte JSON + JSONL: captura estable.
        const cohort = disc.present.filter(x => x.type === 'json' || x.type === 'jsonl');
        const cj = captureJsonCohort(cohort, stagePathOf, maxJsonRetries, _testHooks, log);
        for (const a of cohort) {
            manifestAssets.push({
                name: a.name, clazz: a.clazz, type: a.type, logical_path: a.logicalPath,
                captured: cj.window, validation: a.type === 'json' ? 'parse_ok' : 'jsonl_ok',
                json_capture_attempts: cj.attempts,
            });
        }
        // 3) Bytes + SHA-256 de cada copia publicable.
        for (const m of manifestAssets) {
            const p = path.join(stagingDir, m.logical_path);
            const st = fs.statSync(p);
            m.bytes = st.size;
            m.sha256 = sha256File(p);
        }
        // 4) Manifiesto (sin datos personales, sin contenido).
        const manifest = {
            schema_version: SCHEMA_VERSION,
            snapshot_id: snapshotId,
            started_utc: startedUtc,
            completed_utc: utc(),
            generator_commit: generatorCommit(),
            consistency: {
                sqlite: 'online-backup-api per-database (internally consistent copies)',
                json: 'stable-capture cohort (fingerprint→copy→parse→re-fingerprint)',
                limits: [
                    'no global point-in-time across databases/cohorts; bounded by [started_utc, completed_utc]',
                    'uploads/, secrets and DR config are out of scope of this snapshot',
                ],
            },
            assets: manifestAssets.sort((x, y) => x.logical_path.localeCompare(y.logical_path)),
            absent_optional: disc.absentOptional,
            unclassified_not_copied: disc.unclassified,
            excluded: EXCLUSIONS,
            status: 'COMPLETE',
        };
        const manifestPath = path.join(stagingDir, 'manifest.json');
        fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
        // 5) Marcador COMPLETE (último artefacto): sella el manifiesto.
        fs.writeFileSync(path.join(stagingDir, 'COMPLETE'), JSON.stringify({
            schema_version: SCHEMA_VERSION,
            snapshot_id: snapshotId,
            manifest_sha256: sha256File(manifestPath),
            completed_utc: manifest.completed_utc,
        }, null, 2), { mode: 0o600 });
        hardenTree(stagingDir);
        // 6) Publicación atómica (mismo filesystem).
        fs.renameSync(stagingDir, finalDir);
        log(`[snapshot] publicado: ${snapshotId} (${manifestAssets.length} activos)`);
        return { snapshotId, dir: finalDir, assets: manifestAssets.length, attempts: cj.attempts };
    } catch (e) {
        // Ante error: retirar SOLO el staging de esta ejecución. Nunca tocar
        // snapshots previos. La retención pertenece a otra unidad.
        try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch {}
        try { fs.rmdirSync(path.join(roots.dest, '.staging')); } catch {} // solo si quedó vacío
        throw e;
    }
}

// ── Verificador independiente (no necesita las fuentes) ─────────────────────

export function verifySnapshot(snapshotDir, log = noop) {
    const errors = [];
    const dir = path.resolve(snapshotDir);
    const fail = (code, detail) => errors.push(`${code}${detail ? `: ${detail}` : ''}`);

    if (!fs.existsSync(dir)) return { ok: false, errors: ['SNAPSHOT_MISSING'] };
    if (fs.lstatSync(dir).isSymbolicLink()) return { ok: false, errors: ['SYMLINK_REJECTED: snapshot dir'] };

    // 1) COMPLETE + manifiesto sellado.
    const completePath = path.join(dir, 'COMPLETE');
    const manifestPath = path.join(dir, 'manifest.json');
    if (!fs.existsSync(completePath)) fail('COMPLETE_MISSING');
    if (!fs.existsSync(manifestPath)) fail('MANIFEST_MISSING');
    if (errors.length) return { ok: false, errors };

    let complete, manifest;
    try { complete = JSON.parse(fs.readFileSync(completePath, 'utf8')); }
    catch { return { ok: false, errors: ['COMPLETE_UNPARSEABLE'] }; }
    try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); }
    catch { return { ok: false, errors: ['MANIFEST_UNPARSEABLE'] }; }
    if (manifest.schema_version !== SCHEMA_VERSION) fail('SCHEMA_VERSION_MISMATCH');
    if (manifest.status !== 'COMPLETE') fail('STATUS_NOT_COMPLETE');
    if (sha256File(manifestPath) !== complete.manifest_sha256) fail('MANIFEST_SEAL_MISMATCH');
    if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) fail('MANIFEST_ASSETS_EMPTY');
    if (errors.length) return { ok: false, errors };

    // 2) Recorrido: ni archivos extra, ni faltantes, ni symlinks, ni WAL/SHM,
    //    ni paths fuera del snapshot.
    const expected = new Set(manifest.assets.map(a => a.logical_path.split('/').join(path.sep)));
    expected.add('manifest.json'); expected.add('COMPLETE');
    const found = new Set();
    (function walk(d) {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, entry.name);
            const st = fs.lstatSync(p);
            if (st.isSymbolicLink()) { fail('SYMLINK_REJECTED', path.relative(dir, p)); continue; }
            if (!isInside(p, dir) && p !== dir) { fail('PATH_ESCAPE', entry.name); continue; }
            if (entry.isDirectory()) { walk(p); continue; }
            const rel = path.relative(dir, p);
            if (/(-wal|-shm)$/.test(rel)) { fail('WAL_SHM_PRESENT', rel); continue; }
            found.add(rel);
            if (!expected.has(rel)) fail('UNEXPECTED_FILE', rel);
        }
    })(dir);
    for (const e of expected) if (!found.has(e)) fail('EXPECTED_FILE_MISSING', e);
    if (errors.length) return { ok: false, errors };

    // 3) Checksums + revalidación por tipo (sin PII en salida).
    let checked = 0;
    for (const a of manifest.assets) {
        const p = path.join(dir, ...a.logical_path.split('/'));
        if (sha256File(p) !== a.sha256) { fail('CHECKSUM_MISMATCH', a.name); continue; }
        if (fs.statSync(p).size !== a.bytes) { fail('SIZE_MISMATCH', a.name); continue; }
        try {
            if (a.type === 'json') JSON.parse(fs.readFileSync(p, 'utf8'));
            else if (a.type === 'jsonl') validateJsonl(fs.readFileSync(p, 'utf8'), a.name);
            else if (a.type === 'sqlite') {
                const db = new Database(p, { readonly: true, fileMustExist: true });
                let rows;
                try { rows = db.pragma('integrity_check'); }
                finally { try { db.close(); } catch {} }
                for (const suf of ['-wal', '-shm']) { try { fs.rmSync(p + suf, { force: true }); } catch {} }
                const okDb = Array.isArray(rows) && rows.length === 1
                    && String(rows[0].integrity_check).toLowerCase() === 'ok';
                if (!okDb) { fail('SQLITE_INTEGRITY_FAILED', a.name); continue; }
            }
        } catch (e) {
            fail('REVALIDATION_FAILED', `${a.name} (${e instanceof SnapshotError ? e.code : 'parse'})`);
            continue;
        }
        checked += 1;
    }

    // 4) Permisos (POSIX). En win32 el bit de modo no es fiable → skipped.
    let permCheck = 'ok';
    if (process.platform === 'win32') {
        permCheck = 'skipped_win32';
    } else {
        (function walkPerm(d) {
            const stD = fs.statSync(d);
            if ((stD.mode & 0o077) !== 0) fail('DIR_PERMS_TOO_OPEN', path.relative(dir, d) || '.');
            for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
                const p = path.join(d, entry.name);
                if (entry.isDirectory()) walkPerm(p);
                else if ((fs.statSync(p).mode & 0o177) !== 0) fail('FILE_PERMS_TOO_OPEN', path.relative(dir, p));
            }
        })(dir);
    }

    const ok = errors.length === 0;
    log(`[verify] snapshot=${manifest.snapshot_id} assets_ok=${checked}/${manifest.assets.length} perms=${permCheck} → ${ok ? 'OK' : 'FAIL'}`);
    return { ok, errors, checked, total: manifest.assets.length, permCheck, snapshotId: manifest.snapshot_id };
}
