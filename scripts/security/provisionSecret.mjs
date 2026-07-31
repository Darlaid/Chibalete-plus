#!/usr/bin/env node
/**
 * CHP-SEC-ADMIN-EVIDENCE-HARDEN-01B — Provisión segura de un secreto.
 *
 * El valor entra SOLO por stdin. No hay `--value`, no hay argumento posicional
 * y no se imprime nunca. La salida es metadatos: ruta, modo, longitud y una
 * huella corta no reversible.
 *
 * POR QUÉ
 *
 * En CHP-SEC-AI-PROVIDER-KEYS-ROTATE-01A la clave Gemini nueva acabó en
 * `/root/.bash_history` (línea 1979) porque el operador construyó el prompt de
 * `read` con el propio valor:
 *
 *     read -r -s -p "<el valor>" GEMINI_KEY      ← el prompt VA al historial
 *
 * `read -s` oculta lo que se teclea, pero el historial guarda la LÍNEA DE
 * COMANDO. Si el valor forma parte de esa línea, queda escrito en disco.
 *
 * Reglas que impone esta herramienta:
 *   - el valor jamás viaja por argv (visible en `ps` para cualquier usuario);
 *   - el archivo se crea ya con su modo final, antes de escribir nada;
 *   - se rechaza sobrescribir salvo `--force`;
 *   - se valida forma (longitud, ASCII visible) sin revelar contenido.
 */

import { openSync, writeSync, fsyncSync, closeSync, existsSync, statSync, unlinkSync, readSync } from 'node:fs';
import { createHash } from 'node:crypto';

const FORBIDDEN = ['--value', '--secret', '--key', '--token', '--password'];

export const parseArgs = (argv) => {
    const bad = argv.find((a) => FORBIDDEN.includes(a.split('=')[0]));
    if (bad) {
        throw new Error(
            `${bad} no existe. El valor entra solo por stdin: cualquier secreto en argv queda ` +
            'visible en `ps` y suele terminar en el historial de shell.',
        );
    }
    const get = (n, d = null) => { const i = argv.indexOf(n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d; };
    return {
        out: get('--out'),
        mode: parseInt(get('--mode', '0400'), 8),
        minLength: parseInt(get('--min-length', '8'), 10),
        expectPrefix: get('--expect-prefix'),
        force: argv.includes('--force'),
    };
};

export const readStdin = (fd = 0) => {
    const chunks = [];
    const buf = Buffer.alloc(65536);
    for (;;) {
        let n;
        try { n = readSync(fd, buf, 0, buf.length, null); }
        catch (e) { if (e.code === 'EAGAIN') continue; if (e.code === 'EOF') break; throw e; }
        if (n === 0) break;
        chunks.push(Buffer.from(buf.subarray(0, n)));
    }
    return Buffer.concat(chunks);
};

/**
 * Escribe el valor con el modo final desde el instante de creación.
 * Devuelve metadatos; nunca el valor.
 */
export const provision = (value, opts) => {
    if (!opts.out) throw new Error('falta --out <ruta>');
    const text = value.toString('utf8').replace(/\r?\n$/, '');
    if (text.length < opts.minLength) throw new Error(`valor demasiado corto (mínimo ${opts.minLength})`);
    if (!/^[\x21-\x7e]+$/.test(text)) throw new Error('el valor contiene espacios o caracteres no imprimibles');
    if (opts.expectPrefix && !text.startsWith(opts.expectPrefix)) {
        throw new Error('el valor no empieza por el prefijo esperado');
    }
    if (existsSync(opts.out)) {
        if (!opts.force) throw new Error(`${opts.out} ya existe (usa --force si de verdad quieres reemplazarlo)`);
        unlinkSync(opts.out);
    }
    // O_EXCL: si aparece entre el check y el open, falla en vez de sobrescribir.
    // El modo va en el open, así que el archivo nunca existe con permisos laxos.
    const fd = openSync(opts.out, 'wx', opts.mode);
    try {
        writeSync(fd, text);
        fsyncSync(fd);
    } finally {
        closeSync(fd);
    }
    const st = statSync(opts.out);
    return {
        path: opts.out,
        mode: (st.mode & 0o7777).toString(8).padStart(4, '0'),
        uid: st.uid,
        gid: st.gid,
        bytes: st.size,
        length: text.length,
        fingerprint: createHash('sha256').update(text).digest('hex').slice(0, 16),
        note: 'el valor no se ha impreso ni ha pasado por argv',
    };
};

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/security/provisionSecret.mjs');
if (invokedDirectly) {
    try {
        const opts = parseArgs(process.argv.slice(2));
        const meta = provision(readStdin(), opts);
        process.stdout.write(JSON.stringify(meta, null, 2) + '\n');
    } catch (err) {
        process.stderr.write(`ERROR: ${err.message}\n`);
        process.exitCode = 1;
    }
}
