/**
 * CHP-SEC-ADMIN-EVIDENCE-HARDEN-01B — Escáner genérico de artefactos.
 *
 * POR QUÉ EXISTE
 *
 * El escáner de la unidad anterior tokenizaba con `[A-Za-z0-9_-]{20,300}` y
 * comparaba el sha256 de cada token. Ese diseño falla en silencio: una clave
 * Google de formato v2 (`AQ.xxxx`) se parte por el punto y ningún fragmento
 * coincide con el hash del valor entero. El barrido dio "0 hallazgos" sobre un
 * archivo que contenía la clave.
 *
 * Aquí NO se tokeniza. Se busca el valor completo, byte a byte, en varias
 * codificaciones. No se asume prefijo (`sk-`, `AIza`), ni longitud, ni
 * hexadecimalidad, ni ausencia de puntos.
 *
 * Los valores a buscar se leen de un archivo (fixture sintética en tests,
 * archivo root-only en operación). Nunca se escriben en la salida: los
 * hallazgos se reportan por identificador, posición y codificación.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/** Identificador estable y no reversible de un valor, para reportar sin exponer. */
export const fingerprint = (value) =>
    createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8'))
        .digest('hex').slice(0, 16);

/**
 * Codificaciones en las que un mismo secreto puede aparecer dentro de un
 * artefacto. Cada una devuelve la forma literal a buscar, o null si no aplica.
 */
const ENCODINGS = [
    { name: 'raw', encode: (v) => v },
    // JSON / YAML entre comillas dobles: escapes de barra, comillas y unicode.
    { name: 'json-escaped', encode: (v) => { const s = JSON.stringify(v); return s.slice(1, -1); } },
    // YAML con comillas simples duplica la comilla interna.
    { name: 'yaml-single-quoted', encode: (v) => (v.includes("'") ? v.split("'").join("''") : null) },
    { name: 'percent-encoded', encode: (v) => { const e = encodeURIComponent(v); return e === v ? null : e; } },
    { name: 'base64', encode: (v) => Buffer.from(v, 'utf8').toString('base64') },
    { name: 'base64url', encode: (v) => Buffer.from(v, 'utf8').toString('base64url') },
    // Escapado de shell: `\.` y similares aparecen en heredocs y en sed.
    { name: 'backslash-escaped', encode: (v) => { const e = v.replace(/([.$*[\]^\\/])/g, '\\$1'); return e === v ? null : e; } },
];

/** Colapsa todo espacio en blanco y continuaciones de línea. */
const collapse = (s) => s.replace(/\\\r?\n/g, '').replace(/\s+/g, '');

/**
 * Busca un conjunto de valores literales dentro de un artefacto.
 *
 * @param {Buffer|string} artifact  contenido del archivo a auditar
 * @param {{id:string, value:string}[]} needles  valores a buscar
 * @returns {{id:string, fingerprint:string, encoding:string, line:number|null, offset:number}[]}
 */
export const scanArtifact = (artifact, needles) => {
    const text = Buffer.isBuffer(artifact) ? artifact.toString('binary') : String(artifact);
    const collapsed = collapse(text);
    const findings = [];

    for (const needle of needles) {
        const value = String(needle?.value ?? '');
        if (value.length < 4) continue;                  // demasiado corto: ruido
        const id = needle.id ?? fingerprint(value);
        const seen = new Set();

        for (const enc of ENCODINGS) {
            let form;
            try { form = enc.encode(value); } catch { form = null; }
            if (!form || form.length < 4) continue;
            const idx = text.indexOf(form);
            if (idx >= 0) {
                const key = `${enc.name}:${idx}`;
                if (seen.has(key)) continue;
                seen.add(key);
                findings.push({
                    id,
                    fingerprint: fingerprint(value),
                    encoding: enc.name,
                    offset: idx,
                    line: text.slice(0, idx).split('\n').length,
                });
            }
        }

        // Última pasada: el valor partido por espacios, saltos o continuaciones.
        // Cubre "valores multilínea controlados" y el envolvimiento de líneas
        // de los volcados de terminal.
        if (!findings.some((f) => f.fingerprint === fingerprint(value))) {
            const flat = collapse(value);
            if (flat.length >= 4 && collapsed.includes(flat)) {
                findings.push({
                    id,
                    fingerprint: fingerprint(value),
                    encoding: 'whitespace-collapsed',
                    offset: collapsed.indexOf(flat),
                    line: null,
                });
            }
        }
    }
    return findings;
};

/**
 * Carga los valores a buscar desde un archivo.
 *
 * Formatos admitidos:
 *   - una línea por valor (`# comentario` y líneas vacías se ignoran);
 *   - `id=valor` para etiquetar el hallazgo sin exponerlo.
 *
 * El archivo debe ser una fixture sintética o un archivo root-only. Nunca se
 * imprime su contenido.
 */
export const loadNeedles = (path) =>
    readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l !== '' && !l.startsWith('#'))
        .map((line, i) => {
            const m = /^([A-Za-z0-9_.\-]+)=(.+)$/.exec(line);
            return m ? { id: m[1], value: m[2] } : { id: `needle-${i + 1}`, value: line };
        });

/** Conveniencia: escanea un archivo del disco. */
export const scanArtifactFile = (artifactPath, needles) =>
    scanArtifact(readFileSync(artifactPath), needles);
