/**
 * test-real-store-guard.mjs — CHP-ID-CANON-01B.
 *
 * Módulo de precarga (`node --import`) que hace IMPOSIBLE que un test escriba
 * dentro de los stores reales del repositorio. Parchea las APIs de escritura de
 * `fs` y lanza ANTES de tocar el disco cuando la ruta destino cae dentro de:
 *
 *   data/ · data-critical/ · public/uploads/
 *
 * Las lecturas quedan intactas: un test puede leer un store real (p. ej. para
 * comprobar que sigue igual), pero jamás modificarlo. Tampoco se bloquea la
 * creación de los directorios en sí, solo la escritura de su contenido.
 *
 * Uso (lo aplica scripts/verify-test-store-isolation.mjs a toda la suite):
 *   NODE_OPTIONS="--import ./scripts/test-real-store-guard.mjs" node <test>
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const PROTECTED = [
    path.join(REPO_ROOT, 'data'),
    path.join(REPO_ROOT, 'data-critical'),
    path.join(REPO_ROOT, 'public', 'uploads'),
    path.join(REPO_ROOT, 'uploads'),
];

class RealStoreWriteError extends Error {
    constructor(op, target) {
        super(`[REAL_STORE_GUARD] ${op} bloqueado sobre un store real: `
            + `${path.relative(REPO_ROOT, target).split(path.sep).join('/')}. `
            + 'Los tests deben usar fs.mkdtemp + rutas inyectadas (CHP-ID-CANON-01B).');
        this.name = 'RealStoreWriteError';
        this.code = 'REAL_STORE_WRITE_BLOCKED';
    }
}

const toPath = (p) => {
    if (typeof p === 'string') return p;
    if (Buffer.isBuffer(p)) return p.toString('utf8');
    if (p instanceof URL) { try { return fileURLToPath(p); } catch { return null; } }
    return null; // descriptores numéricos: la apertura ya pasó por el guard
};

function isProtected(target) {
    const raw = toPath(target);
    if (!raw) return false;
    let abs;
    try { abs = path.resolve(raw); } catch { return false; }
    const cmp = process.platform === 'win32' ? (s) => s.toLowerCase() : (s) => s;
    for (const dir of PROTECTED) {
        const rel = path.relative(cmp(dir), cmp(abs));
        if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) continue;
        return true; // estrictamente DENTRO del directorio protegido
    }
    return false;
}

const guardArgs = (op, positions) => (target, ...rest) => {
    for (const pos of positions) {
        const candidate = pos === 0 ? target : rest[pos - 1];
        if (isProtected(candidate)) throw new RealStoreWriteError(op, toPath(candidate));
    }
};

/** Envuelve fn comprobando las posiciones de argumento que son rutas destino. */
function patch(obj, name, positions = [0]) {
    const original = obj?.[name];
    if (typeof original !== 'function') return;
    const check = guardArgs(name, positions);
    obj[name] = function guarded(...args) {
        check(...args);
        return original.apply(this, args);
    };
}

// Escrituras directas
for (const name of ['writeFileSync', 'appendFileSync', 'truncateSync', 'unlinkSync', 'rmSync',
                    'rmdirSync', 'createWriteStream', 'chmodSync', 'utimesSync']) {
    patch(fs, name);
}
for (const name of ['writeFile', 'appendFile', 'truncate', 'unlink', 'rm', 'rmdir', 'chmod', 'utimes']) {
    patch(fs, name);
    patch(fs.promises, name);
}
// Operaciones con destino en el segundo argumento
for (const name of ['renameSync', 'copyFileSync', 'linkSync', 'symlinkSync']) patch(fs, name, [0, 1]);
for (const name of ['rename', 'copyFile', 'link', 'symlink'])                 { patch(fs, name, [0, 1]); patch(fs.promises, name, [0, 1]); }
// mkdir solo se bloquea si crea contenido DENTRO del store protegido
patch(fs, 'mkdirSync');
patch(fs, 'mkdir');
patch(fs.promises, 'mkdir');

// open/openSync: solo modos de escritura
const WRITE_FLAGS = /[wa+]/;
const patchOpen = (obj, name) => {
    const original = obj?.[name];
    if (typeof original !== 'function') return;
    obj[name] = function guardedOpen(target, flags, ...rest) {
        const f = typeof flags === 'string' ? flags : '';
        if (WRITE_FLAGS.test(f) && isProtected(target)) {
            throw new RealStoreWriteError(`${name}(${f})`, toPath(target));
        }
        return original.call(this, target, flags, ...rest);
    };
};
patchOpen(fs, 'openSync');
patchOpen(fs, 'open');
patchOpen(fs.promises, 'open');

if (process.env.REAL_STORE_GUARD_VERBOSE === '1') {
    console.log('[REAL_STORE_GUARD] activo sobre:',
        PROTECTED.map(p => path.relative(REPO_ROOT, p)).join(', '));
}
