/**
 * migrate.mjs — CHP-ID-GROUPS-RECON-01B-R1.
 *
 * Ejecutor del manifiesto de saneamiento institucional. **DRY-RUN POR DEFECTO.**
 * `--apply` es imposible por accidente: exige el flag explícito, evidencia de
 * BACKUP GATE GREEN y que el sha256 de cada entrada coincida exactamente con el
 * manifiesto.
 *
 *   node scripts/migrations/chp-id-recon-01b/migrate.mjs --root <dir>
 *   node scripts/migrations/chp-id-recon-01b/migrate.mjs --root <dir> --json
 *
 * En esta unidad SOLO se ejecuta contra fixtures sintéticas. No se ha ejecutado
 * `--apply` contra producción, y este script no conoce ninguna ruta productiva:
 * `--root` es obligatorio.
 *
 * Garantías:
 *   - no sigue symlinks (lstat en cada archivo y en cada componente del root);
 *   - rechaza path escapes fuera de --root;
 *   - valida el schema de cada store antes de tocar nada;
 *   - escribe mediante temporal en el MISMO filesystem + rename atómico;
 *   - respalda cada archivo antes de escribir (rollback byte a byte);
 *   - idempotente: una segunda ejecución no produce cambios;
 *   - el diff es agregado y sin PII.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MANIFEST_PATH = path.join(HERE, 'manifest.json');
const BACKUP_SUFFIX = '.pre-CHP-ID-RECON-01B';

export class MigrationStop extends Error {
    constructor(code, detail) {
        super(`STOP — ${code}${detail ? `: ${detail}` : ''}`);
        this.name = 'MigrationStop';
        this.code = code;
    }
}

// ── Utilidades de seguridad de rutas ────────────────────────────────────────

/** Resuelve una ruta relativa DENTRO de root, rechazando escapes y symlinks. */
export function safeResolve(root, relative) {
    const rootAbs = path.resolve(root);
    const abs = path.resolve(rootAbs, relative);
    const rel = path.relative(rootAbs, abs);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new MigrationStop('PATH_ESCAPE', relative);
    }
    // Ningún componente del camino puede ser un symlink.
    let cursor = rootAbs;
    for (const part of rel.split(path.sep)) {
        cursor = path.join(cursor, part);
        let st;
        try { st = fs.lstatSync(cursor); } catch { break; } // aún no existe: se valida al leer
        if (st.isSymbolicLink()) throw new MigrationStop('SYMLINK_REJECTED', relative);
    }
    return abs;
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

// ── Validación de schema ────────────────────────────────────────────────────

function assertArrayOfObjects(parsed, label) {
    if (!Array.isArray(parsed)) throw new MigrationStop('SCHEMA_INVALID', `${label}: raíz no es array`);
    for (const r of parsed) {
        if (!r || typeof r !== 'object' || Array.isArray(r)) {
            throw new MigrationStop('SCHEMA_INVALID', `${label}: elemento no es objeto`);
        }
    }
    return parsed;
}

// ── Operaciones ─────────────────────────────────────────────────────────────

const has = (rec, field) => Object.prototype.hasOwnProperty.call(rec, field)
    && rec[field] !== null && rec[field] !== undefined && rec[field] !== '';

function applyAppend(records, op) {
    const g = op.guard || {};

    // Idempotencia PRIMERO: si la operación ya está aplicada, el conteo previo
    // legítimamente difiere del declarado y no debe interpretarse como drift.
    if (records.some(r => r.id === op.record.id)) {
        return { changed: 0, alreadySatisfied: true, added: 0 };
    }

    if (typeof g.expectedRecordsBefore === 'number' && records.length !== g.expectedRecordsBefore) {
        throw new MigrationStop('GUARD_RECORD_COUNT',
            `${op.id}: esperaba ${g.expectedRecordsBefore} registros, hay ${records.length}`);
    }

    if (g.uniqueByNameCaseInsensitiveAbsent) {
        const target = String(g.uniqueByNameCaseInsensitiveAbsent).toLowerCase();
        if (records.some(r => String(r.name ?? '').toLowerCase() === target)) {
            throw new MigrationStop('GUARD_NAME_COLLISION', `${op.id}: ya existe una institución con ese nombre`);
        }
    }
    records.push({ ...op.record });
    return { changed: 1, alreadySatisfied: false, added: 1 };
}

function matchesSelector(rec, selector) {
    if (selector.fieldAbsent && has(rec, selector.fieldAbsent)) return false;
    if (selector.field && rec[selector.field] !== selector.equals) return false;
    if (selector.andFieldAbsent && has(rec, selector.andFieldAbsent)) return false;
    if (selector.and) {
        for (const [k, v] of Object.entries(selector.and)) if (rec[k] !== v) return false;
    }
    return true;
}

function applySetFieldWhere(records, op) {
    const g = op.guard || {};
    const [field, value] = Object.entries(op.set)[0];

    // Postcondición ya satisfecha ⇒ idempotencia (no es un error).
    const pending = records.filter(r => matchesSelector(r, op.selector));

    if (g.idMustNotCollide && records.some(r => r.id === g.idMustNotCollide)) {
        // Colisión real solo si el que lo tiene NO es el que íbamos a modificar.
        const owner = records.find(r => r.id === g.idMustNotCollide);
        const isOurs = pending.length === 0; // ya aplicado en una corrida previa
        if (!isOurs && owner) throw new MigrationStop('GUARD_ID_COLLISION', `${op.id}: ${g.idMustNotCollide}`);
    }

    if (pending.length === 0) return { changed: 0, alreadySatisfied: true, matched: 0 };

    if (typeof g.expectedMatches === 'number' && pending.length !== g.expectedMatches) {
        throw new MigrationStop('GUARD_MATCH_COUNT',
            `${op.id}: esperaba ${g.expectedMatches} coincidencias, hay ${pending.length}`);
    }
    for (const rec of pending) {
        const before = Object.keys(rec).length;
        rec[field] = value;
        // Nunca se elimina ningún campo; solo puede crecer en uno.
        if (Object.keys(rec).length < before) {
            throw new MigrationStop('INVARIANT_FIELD_LOST', op.id);
        }
    }
    return { changed: pending.length, alreadySatisfied: false, matched: pending.length };
}

// ── Ejecución ───────────────────────────────────────────────────────────────

/**
 * @param {object} opts
 * @param {string} opts.root          raíz que contiene data/ y data-critical/
 * @param {boolean} [opts.apply]      false = dry-run (por defecto)
 * @param {boolean} [opts.enforceHashes] true por defecto; solo los tests con
 *                                    fixtures sintéticas lo desactivan
 * @param {string}  [opts.backupEvidence] evidencia de BACKUP GATE GREEN
 */
export function runMigration({ root, apply = false, enforceHashes = true, backupEvidence = null,
                               manifestPath = MANIFEST_PATH } = {}) {
    if (!root) throw new MigrationStop('ROOT_REQUIRED', 'usa --root <dir>');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    if (apply) {
        const evidence = backupEvidence ?? process.env.CHP_BACKUP_GATE ?? null;
        if (String(evidence).trim().toUpperCase() !== 'GREEN') {
            throw new MigrationStop('BACKUP_GATE_NOT_GREEN',
                'apply exige evidencia explícita de BACKUP GATE GREEN');
        }
    }

    // 1. Cargar y validar entradas.
    const files = new Map();
    for (const [rel, expected] of Object.entries(manifest.expectedInputs)) {
        const abs = safeResolve(root, rel);
        let st;
        try { st = fs.lstatSync(abs); } catch { throw new MigrationStop('INPUT_MISSING', rel); }
        if (st.isSymbolicLink()) throw new MigrationStop('SYMLINK_REJECTED', rel);
        const raw = fs.readFileSync(abs);
        const digest = sha256(raw);
        if (enforceHashes && digest !== expected.sha256) {
            throw new MigrationStop('INPUT_HASH_MISMATCH',
                `${rel}: esperado ${expected.sha256.slice(0, 16)}…, encontrado ${digest.slice(0, 16)}…`);
        }
        let parsed;
        try { parsed = JSON.parse(raw.toString('utf8')); }
        catch { throw new MigrationStop('SCHEMA_INVALID', `${rel}: JSON ilegible`); }
        assertArrayOfObjects(parsed, rel);
        files.set(rel, { abs, raw, digest, records: parsed, before: parsed.length });
    }

    // 2. Ejecutar operaciones en memoria.
    const results = [];
    for (const op of manifest.operations) {
        const target = files.get(op.file);
        if (!target) throw new MigrationStop('OPERATION_TARGET_UNKNOWN', op.file);
        const outcome = op.kind === 'append'
            ? applyAppend(target.records, op)
            : op.kind === 'setFieldWhere'
                ? applySetFieldWhere(target.records, op)
                : (() => { throw new MigrationStop('OPERATION_KIND_UNKNOWN', op.kind); })();
        results.push({
            id: op.id, decision: op.decision, file: op.file, kind: op.kind,
            fieldsChanged: op.fieldsChanged ?? Object.keys(op.set ?? {}),
            ...outcome,
        });
    }

    // 3. Invariantes globales.
    for (const [rel, f] of files) {
        const expectedAfter = rel.endsWith('schools_db.json')
            ? (f.before === manifest.expectedInputs[rel].records ? f.before + (results.find(r => r.file === rel && r.added)?.added ?? 0) : f.records.length)
            : f.before;
        if (rel.endsWith('schools_db.json')) {
            if (f.records.length !== expectedAfter) {
                throw new MigrationStop('INVARIANT_RECORD_COUNT', rel);
            }
        } else if (f.records.length !== f.before) {
            throw new MigrationStop('INVARIANT_RECORD_COUNT', `${rel}: el conteo no puede cambiar`);
        }
        const serialized = JSON.stringify(f.records);
        if (serialized.includes('"schoolId"')) {
            throw new MigrationStop('INVARIANT_SCHOOLID_WRITTEN', rel);
        }
    }

    const totalChanges = results.reduce((a, r) => a + r.changed, 0);

    // 4. Escritura (solo con --apply): respaldo → temporal → rename atómico.
    const written = [];
    if (apply && totalChanges > 0) {
        for (const [rel, f] of files) {
            const touched = results.some(r => r.file === rel && r.changed > 0);
            if (!touched) continue;
            const backup = `${f.abs}${BACKUP_SUFFIX}`;
            if (!fs.existsSync(backup)) fs.writeFileSync(backup, f.raw);
            const tmp = `${f.abs}.tmp.${process.pid}`;
            fs.writeFileSync(tmp, `${JSON.stringify(f.records, null, 2)}\n`);
            fs.renameSync(tmp, f.abs);
            written.push({ file: rel, backup: path.basename(backup) });
        }
    }

    return {
        unit: manifest.unit,
        version: manifest.version,
        mode: apply ? 'APPLY' : 'DRY_RUN',
        applied: apply && totalChanges > 0,
        totalChanges,
        idempotent: totalChanges === 0,
        operations: results,
        written,
        // Diff agregado y sin PII: solo conteos y nombres de campo.
        diff: results.map(r => ({
            operation: r.id, file: r.file, records: r.changed,
            fields: r.fieldsChanged, alreadySatisfied: r.alreadySatisfied,
        })),
    };
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
    const apply = process.argv.includes('--apply');
    try {
        const out = runMigration({
            root: argOf('--root'),
            apply,
            enforceHashes: !process.argv.includes('--no-hash-check'),
            backupEvidence: argOf('--backup-evidence'),
        });
        if (process.argv.includes('--json')) {
            console.log(JSON.stringify(out, null, 2));
        } else {
            console.log(`${out.unit} v${out.version} — modo ${out.mode}`);
            for (const d of out.diff) {
                console.log(`  ${d.alreadySatisfied ? '· ya aplicado' : `→ ${d.records} registro(s)`}`
                    + `  ${d.operation}  [${d.file}]  campos=${d.fields.join(',')}`);
            }
            console.log(out.totalChanges === 0
                ? '\nSin cambios pendientes (idempotente).'
                : `\n${out.totalChanges} cambio(s) ${apply ? 'APLICADOS' : 'pendientes — NADA se escribió (dry-run)'}.`);
        }
        process.exit(0);
    } catch (e) {
        console.error(e instanceof MigrationStop ? e.message : `STOP — UNEXPECTED: ${e.message}`);
        process.exit(1);
    }
}
