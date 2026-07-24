/**
 * adminSecretFile.test.js — CHP-SEC-ADMIN-FILE-01A
 *
 * Pruebas del lector estricto file-only de secretos y del wrapper de ADMIN_SECRET.
 *
 * Run (requiere Linux + root, por la semántica POSIX de uid/gid/modo/nlink y
 * por O_NOFOLLOW; en win32 el helper falla cerrado a propósito):
 *   node server/__test__/adminSecretFile.test.js
 *
 * Todos los secretos usados aquí son sintéticos y desechables.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    readSecretFile,
    SecretFileError,
    SECRET_FILE_ERROR_CODES as E,
} from '../lib/secretFile.js';
import { readAdminSecret, ADMIN_SECRET_PATH } from '../lib/adminSecret.js';
import { zeroizeBuffer } from '../lib/zeroizeBuffer.js';

let pass = 0;
let fail = 0;

function ok(label, condition, detail = '') {
    if (condition) {
        console.log(`  ✓ ${label}`);
        pass++;
    } else {
        console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
        fail++;
    }
}

function section(label) {
    console.log(`\n${label}`);
}

// Valor centinela: si alguna vez aparece como retorno o dentro de un error,
// significa que hay fallback a environment o filtración de material.
const SENTINEL = 'SENTINEL-ENV-VALUE-MUST-NEVER-BE-RETURNED-0123456789';
const SECRET_A = 'A1a-secret-alpha-0123456789abcdefghij';
const SECRET_B = 'B2b_secret_bravo_9876543210zyxwvutsrq';
const SECRET_B64 = 'q1w2e3r4t5y6u7i8o9p0asdfghjklzxcvbnmQWERTY==';
const SECRET_B64URL = 'q1w2e3r4t5y6u7i8o9p0asdfghjklzxcvbnm-QWERTY_';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-secretfile-'));
fs.chmodSync(TMP, 0o700);

/** Escribe un archivo de secreto sintético con modo explícito. */
function writeSecret(name, content, mode = 0o400) {
    const p = path.join(TMP, name);
    if (fs.existsSync(p)) fs.chmodSync(p, 0o600);
    fs.writeFileSync(p, content);
    fs.chmodSync(p, mode);
    return p;
}

/** Ejecuta y captura el error, sin dejar que aborte la suite. */
async function grab(fn) {
    try {
        const value = await fn();
        return { value, err: null };
    } catch (err) {
        return { value: undefined, err };
    }
}

const codeOf = (err) => (err instanceof SecretFileError ? err.code : `NOT_SecretFileError(${err?.name})`);
const openFdCount = () => fs.readdirSync('/proc/self/fd').length;

console.log('adminSecretFile — helper file-only estricto');
console.log(`  runtime: ${process.platform} node ${process.version} uid=${process.getuid?.()} gid=${process.getgid?.()}`);

try {
    // ───────────────────────────────────────────── [1] import inocuo
    section('[1] import sin archivo presente');
    {
        ok('el import de adminSecret.js no lanzó', typeof readAdminSecret === 'function');
        ok('ruta canónica constante', ADMIN_SECRET_PATH === '/app/secrets/admin_secret', ADMIN_SECRET_PATH);
        const mod = await import(`../lib/adminSecret.js?fresh=${Date.now()}`);
        ok('re-import fresco tampoco lanza', typeof mod.readAdminSecret === 'function');
        ok('archivo canónico ausente en este host', !fs.existsSync(ADMIN_SECRET_PATH));
    }

    // ───────────────────────────────────────────── [2-4] contenido aceptado
    section('[2-4] terminadores aceptados');
    {
        const r1 = await grab(() => readSecretFile(writeSecret('ok-none', SECRET_A)));
        ok('sin salto final: aceptado', r1.value === SECRET_A, codeOf(r1.err));

        const r2 = await grab(() => readSecretFile(writeSecret('ok-lf', `${SECRET_A}\n`)));
        ok('un LF final: aceptado y eliminado', r2.value === SECRET_A, codeOf(r2.err));

        const r3 = await grab(() => readSecretFile(writeSecret('ok-crlf', `${SECRET_A}\r\n`)));
        ok('un CRLF final: aceptado y eliminado', r3.value === SECRET_A, codeOf(r3.err));
    }

    // ───────────────────────────────────────────── [20] base64 / base64url
    section('[20] formatos ASCII visibles equivalentes');
    {
        const r1 = await grab(() => readSecretFile(writeSecret('ok-b64', SECRET_B64)));
        ok('base64 con "+/=" aceptado', r1.value === SECRET_B64, codeOf(r1.err));
        const r2 = await grab(() => readSecretFile(writeSecret('ok-b64url', SECRET_B64URL)));
        ok('base64url con "-_" aceptado', r2.value === SECRET_B64URL, codeOf(r2.err));
    }

    // ───────────────────────────────────────────── [5] ausente
    section('[5] archivo inexistente');
    {
        const r = await grab(() => readSecretFile(path.join(TMP, 'no-existe')));
        ok('FILE_MISSING', codeOf(r.err) === E.FILE_MISSING, codeOf(r.err));
        ok('no devolvió valor', r.value === undefined);
    }

    // ───────────────────────────────────────────── [6-8] ausencia de fallback
    section('[6-8] sin fallback a environment');
    {
        const beforeSecret = process.env.ADMIN_SECRET;
        const beforeFile = process.env.ADMIN_SECRET_FILE;
        const decoy = writeSecret('decoy', SECRET_B);
        try {
            process.env.ADMIN_SECRET = SENTINEL;
            const r1 = await grab(() => readAdminSecret());
            ok('[6] env poblado + archivo ausente → falla', r1.err instanceof SecretFileError, codeOf(r1.err));
            ok('[6] jamás devuelve el sentinel', r1.value !== SENTINEL && r1.value === undefined);

            const invalid = writeSecret('invalid-mode', SECRET_A, 0o644);
            const r2 = await grab(() => readSecretFile(invalid));
            ok('[7] env poblado + archivo inválido → falla', codeOf(r2.err) === E.INVALID_MODE, codeOf(r2.err));
            ok('[7] jamás devuelve el sentinel', r2.value !== SENTINEL && r2.value === undefined);

            process.env.ADMIN_SECRET_FILE = decoy;
            const r3 = await grab(() => readAdminSecret());
            ok('[8] ADMIN_SECRET_FILE ignorado por completo', codeOf(r3.err) === E.FILE_MISSING, codeOf(r3.err));
            ok('[8] no devolvió el contenido del decoy', r3.value !== SECRET_B && r3.value === undefined);
        } finally {
            if (beforeSecret === undefined) delete process.env.ADMIN_SECRET;
            else process.env.ADMIN_SECRET = beforeSecret;
            if (beforeFile === undefined) delete process.env.ADMIN_SECRET_FILE;
            else process.env.ADMIN_SECRET_FILE = beforeFile;
        }
    }

    // ───────────────────────────────────────────── [9-11] symlink, dir, hardlink
    section('[9-11] tipo de archivo y enlaces');
    {
        const target = writeSecret('link-target', SECRET_A);
        const link = path.join(TMP, 'link-symlink');
        fs.symlinkSync(target, link);
        const r1 = await grab(() => readSecretFile(link));
        ok('[9] symlink rechazado (O_NOFOLLOW → ELOOP)', codeOf(r1.err) === E.SYMLINK_REJECTED, codeOf(r1.err));

        const dir = path.join(TMP, 'a-directory');
        fs.mkdirSync(dir, { mode: 0o400 });
        const r2 = await grab(() => readSecretFile(dir));
        ok('[10] directorio rechazado', codeOf(r2.err) === E.NOT_REGULAR_FILE, codeOf(r2.err));

        const hardBase = writeSecret('hard-base', SECRET_A);
        const hardAlias = path.join(TMP, 'hard-alias');
        fs.linkSync(hardBase, hardAlias);
        const r3 = await grab(() => readSecretFile(hardBase));
        ok('[11] nlink > 1 rechazado', codeOf(r3.err) === E.INVALID_LINK_COUNT, codeOf(r3.err));
        fs.unlinkSync(hardAlias);
    }

    // ───────────────────────────────────────────── [12] modos inseguros
    section('[12] modos rechazados');
    {
        for (const mode of [0o600, 0o440, 0o404, 0o644, 0o000]) {
            const p = writeSecret(`mode-${mode.toString(8)}`, SECRET_A, mode);
            const r = await grab(() => readSecretFile(p));
            ok(`modo 0${mode.toString(8).padStart(3, '0')} rechazado`, codeOf(r.err) === E.INVALID_MODE, codeOf(r.err));
        }
    }

    // ───────────────────────────────────────────── [13] owner / group
    section('[13] propietario y grupo');
    {
        const p = writeSecret('wrong-owner', SECRET_A);
        let chownOk = true;
        try {
            fs.chownSync(p, 65534, 65534);
        } catch {
            chownOk = false;
        }
        if (chownOk) {
            const r = await grab(() => readSecretFile(p));
            ok('uid/gid distintos del proceso → INVALID_OWNER', codeOf(r.err) === E.INVALID_OWNER, codeOf(r.err));
        } else {
            ok('chown no permitido en este entorno (test omitido)', false, 'requiere root');
        }
    }

    // ───────────────────────────────────────────── [14-16] tamaño
    section('[14-16] tamaño del contenido');
    {
        const r1 = await grab(() => readSecretFile(writeSecret('empty', '')));
        ok('[14] archivo vacío rechazado', codeOf(r1.err) === E.EMPTY_SECRET, codeOf(r1.err));

        const r1b = await grab(() => readSecretFile(writeSecret('only-lf', '\n')));
        ok('[14] archivo con sólo un LF rechazado', codeOf(r1b.err) === E.EMPTY_SECRET, codeOf(r1b.err));

        const r2 = await grab(() => readSecretFile(writeSecret('short', 'abc123')));
        ok('[15] menos de 32 bytes rechazado', codeOf(r2.err) === E.SECRET_TOO_SHORT, codeOf(r2.err));

        const r2b = await grab(() => readSecretFile(writeSecret('short-31', 'x'.repeat(31))));
        ok('[15] exactamente 31 bytes rechazado', codeOf(r2b.err) === E.SECRET_TOO_SHORT, codeOf(r2b.err));

        const r2c = await grab(() => readSecretFile(writeSecret('exact-32', 'x'.repeat(32))));
        ok('[15] exactamente 32 bytes aceptado (frontera)', r2c.value === 'x'.repeat(32), codeOf(r2c.err));

        const r3 = await grab(() => readSecretFile(writeSecret('too-large', 'x'.repeat(5000))));
        ok('[16] más de 4096 bytes rechazado', codeOf(r3.err) === E.SECRET_TOO_LARGE, codeOf(r3.err));
    }

    // ───────────────────────────────────────────── [17-19] formato
    section('[17-19] formato del contenido');
    {
        const cases = [
            ['espacio inicial', ` ${SECRET_A}`],
            ['espacio final', `${SECRET_A} `],
            ['espacio interno', `${SECRET_A.slice(0, 10)} ${SECRET_A.slice(10)}`],
            ['tab interno', `${SECRET_A.slice(0, 10)}\t${SECRET_A.slice(10)}`],
            ['salto interno', `${SECRET_A.slice(0, 10)}\n${SECRET_A.slice(10)}`],
            ['NUL', `${SECRET_A.slice(0, 10)}\u0000${SECRET_A.slice(10)}`],
            ['control 0x07', `${SECRET_A.slice(0, 10)}\u0007${SECRET_A.slice(10)}`],
            ['CR suelto', `${SECRET_A}\r`],
            ['no-ASCII (ñ)', `${SECRET_A}ñ`],
        ];
        for (const [label, content] of cases) {
            const p = writeSecret(`fmt-${label.replace(/[^a-z0-9]/gi, '_')}`, content);
            const r = await grab(() => readSecretFile(p));
            ok(`[17] ${label} rechazado`, codeOf(r.err) === E.INVALID_FORMAT, codeOf(r.err));
        }

        const badUtf8 = path.join(TMP, 'bad-utf8');
        fs.writeFileSync(badUtf8, Buffer.concat([Buffer.from('x'.repeat(40)), Buffer.from([0xff, 0xfe])]));
        fs.chmodSync(badUtf8, 0o400);
        const r2 = await grab(() => readSecretFile(badUtf8));
        ok('[18] UTF-8 inválido rechazado', codeOf(r2.err) === E.INVALID_UTF8, codeOf(r2.err));

        const r3 = await grab(() => readSecretFile(writeSecret('two-lf', `${SECRET_A}\n\n`)));
        ok('[19] dos saltos finales rechazados', codeOf(r3.err) === E.INVALID_FORMAT, codeOf(r3.err));

        const r3b = await grab(() => readSecretFile(writeSecret('crlf-lf', `${SECRET_A}\r\n\n`)));
        ok('[19] CRLF + LF rechazados', codeOf(r3b.err) === E.INVALID_FORMAT, codeOf(r3b.err));
    }

    // ───────────────────────────────────────────── [21] descriptores
    section('[21] cierre del descriptor');
    {
        const good = writeSecret('fd-good', SECRET_A);
        const bad = writeSecret('fd-bad', SECRET_A, 0o644);
        await readSecretFile(good).catch(() => {});
        const base = openFdCount();
        for (let i = 0; i < 25; i++) await readSecretFile(good).catch(() => {});
        ok('sin fugas de fd en éxito (x25)', openFdCount() === base, `base=${base} ahora=${openFdCount()}`);
        for (let i = 0; i < 25; i++) await readSecretFile(bad).catch(() => {});
        ok('sin fugas de fd en error (x25)', openFdCount() === base, `base=${base} ahora=${openFdCount()}`);
    }

    // ───────────────────────────────────────────── [22] primitiva de zeroización
    section('[22] zeroizeBuffer — borrado seguro aislado');
    {
        const b = Buffer.from(`${SECRET_A}${SECRET_B}`, 'utf8');
        ok('buffer sintético con contenido previo', b.some((x) => x !== 0));
        zeroizeBuffer(b);
        ok('todo el buffer quedó a cero', b.every((x) => x === 0));
        ok('ya no contiene el material sintético', !b.toString('latin1').includes(SECRET_A.slice(0, 8)));

        const empty = Buffer.alloc(0);
        let threw = false;
        try { zeroizeBuffer(empty); } catch { threw = true; }
        ok('buffer vacío no lanza', !threw);

        // No-op silencioso ante no-Buffer: no debe lanzar (uso en finally).
        let threw2 = false;
        try { zeroizeBuffer(null); zeroizeBuffer(undefined); zeroizeBuffer('x'); } catch { threw2 = true; }
        ok('no-Buffer es no-op sin lanzar', !threw2);
    }

    // ───────────────────────────── [22b] el finally borra en éxito y en error
    section('[22b] finally: sin fugas de fd en las rutas de borrado');
    {
        // El Buffer interno ya no es observable (seam eliminado); comprobamos el
        // efecto lateral verificable: éxito, INVALID_FORMAT e INVALID_UTF8
        // atraviesan el finally sin dejar descriptores abiertos.
        const good = writeSecret('fin-good', SECRET_A);
        const badFmt = writeSecret('fin-fmt', `${SECRET_A} `);
        const badUtf = path.join(TMP, 'fin-utf8');
        fs.writeFileSync(badUtf, Buffer.concat([Buffer.from('y'.repeat(40)), Buffer.from([0xff, 0xfe])]));
        fs.chmodSync(badUtf, 0o400);

        await readSecretFile(good).catch(() => {});
        const base = openFdCount();
        const rG = await grab(() => readSecretFile(good));
        ok('éxito atraviesa finally', rG.value === SECRET_A, codeOf(rG.err));
        const rF = await grab(() => readSecretFile(badFmt));
        ok('INVALID_FORMAT atraviesa finally', codeOf(rF.err) === E.INVALID_FORMAT, codeOf(rF.err));
        const rU = await grab(() => readSecretFile(badUtf));
        ok('INVALID_UTF8 atraviesa finally', codeOf(rU.err) === E.INVALID_UTF8, codeOf(rU.err));
        ok('sin fugas de fd en las tres rutas', openFdCount() === base, `base=${base} ahora=${openFdCount()}`);
    }

    // ───────────────────────────── [22c] ausencia total del seam de instrumentación
    section('[22c] superficie pública sin seam de buffer');
    {
        ok('readSecretFile.length === 1', readSecretFile.length === 1, String(readSecretFile.length));
        ok('readAdminSecret.length === 0', readAdminSecret.length === 0, String(readAdminSecret.length));

        // Un segundo argumento malicioso con onBufferAllocated jamás se ejecuta.
        const good = writeSecret('seam-good', SECRET_A);
        let hookFired = false;
        const evil = { onBufferAllocated: (buf) => { hookFired = true; buf?.toString?.(); } };
        const value = await readSecretFile(good, evil);
        ok('lectura correcta ignorando 2º argumento', value === SECRET_A);
        ok('el hook malicioso nunca se ejecutó', hookFired === false);

        // Ni el módulo ni sus exports ofrecen un canal hacia el Buffer interno.
        const mod = await import('../lib/secretFile.js');
        const exportNames = Object.keys(mod);
        ok('sin export onBufferAllocated/internalHooks', !exportNames.some((n) => /hook|onBuffer|internal/i.test(n)), exportNames.join(','));
        const src = fs.readFileSync(new URL('../lib/secretFile.js', import.meta.url), 'utf8');
        ok('el fuente no contiene internalHooks', !src.includes('internalHooks'));
        ok('el fuente no contiene onBufferAllocated', !src.includes('onBufferAllocated'));
    }

    // ───────────────────────────────────────────── [23] no filtración
    section('[23] los errores no filtran material');
    {
        const before = process.env.ADMIN_SECRET;
        process.env.ADMIN_SECRET = SENTINEL;
        try {
            const leakedFile = writeSecret('leak', `${SENTINEL}-inside-file`, 0o644);
            const r = await grab(() => readSecretFile(leakedFile));
            const serialized = JSON.stringify(r.err);
            const blob = `${r.err?.message}|${r.err?.stack}|${serialized}|${String(r.err)}`;
            ok('message es sólo el código', r.err?.message === E.INVALID_MODE, r.err?.message);
            ok('JSON.stringify no incluye el sentinel', !serialized.includes(SENTINEL), serialized);
            ok('JSON.stringify no incluye contenido del archivo', !serialized.includes('inside-file'));
            ok('stack/String(err) no incluyen el sentinel', !blob.includes(SENTINEL));
            ok('cause no es enumerable', !Object.keys(r.err ?? {}).includes('cause'), Object.keys(r.err ?? {}).join(','));
            ok('propiedades enumerables acotadas', JSON.stringify(Object.keys(r.err ?? {}).sort()) === '["code","name"]', Object.keys(r.err ?? {}).join(','));

            // El error de open() sí lleva cause nativo: comprobar que tampoco escapa.
            const r2 = await grab(() => readSecretFile(path.join(TMP, 'nope')));
            ok('FILE_MISSING no serializa la ruta', !JSON.stringify(r2.err).includes('nope'), JSON.stringify(r2.err));
        } finally {
            if (before === undefined) delete process.env.ADMIN_SECRET;
            else process.env.ADMIN_SECRET = before;
        }
    }

    // ───────────────────────────────────────────── [24-25] sin caché / rotación
    section('[24-25] sustitución atómica visible sin reiniciar');
    {
        const canonical = path.join(TMP, 'rotating_secret');
        const stageA = path.join(TMP, '.stage-a');
        const stageB = path.join(TMP, '.stage-b');

        const stage = (p, content) => {
            fs.writeFileSync(p, content);
            fs.chmodSync(p, 0o400);
        };

        stage(stageA, SECRET_A);
        fs.renameSync(stageA, canonical);
        const first = await readSecretFile(canonical);
        ok('[24] primera lectura devuelve A', first === SECRET_A);

        stage(stageB, SECRET_B);
        fs.renameSync(stageB, canonical);
        const second = await readSecretFile(canonical);
        ok('[24] tras rename, la siguiente lectura devuelve B', second === SECRET_B, second);
        ok('[24] no quedó cacheado el valor anterior', second !== SECRET_A);

        let alternations = 0;
        let partial = 0;
        for (let i = 0; i < 12; i++) {
            const expected = i % 2 === 0 ? SECRET_A : SECRET_B;
            const staged = path.join(TMP, `.stage-${i}`);
            stage(staged, expected);
            fs.renameSync(staged, canonical);
            const got = await readSecretFile(canonical);
            if (got === expected) alternations++;
            if (got !== SECRET_A && got !== SECRET_B) partial++;
        }
        ok('[25] 12 alternancias A/B correctas', alternations === 12, `ok=${alternations}/12`);
        ok('[25] nunca contenido parcial, vacío ni mezclado', partial === 0, `parciales=${partial}`);
    }
} finally {
    fs.rmSync(TMP, { recursive: true, force: true });
    console.log(`\n  temporales sintéticos eliminados: ${!fs.existsSync(TMP)}`);
}

// ────────────────────────────────────────────────────────────────────────────
console.log(`\nadminSecretFile — pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);
