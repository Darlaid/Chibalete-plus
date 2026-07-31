/**
 * CHP-SEC-ADMIN-EVIDENCE-HARDEN-01B — Redacción estructurada por formato.
 *
 * Redactar texto con expresiones regulares es lo que falla. Aquí cada formato
 * se PARSEA y se reconstruye:
 *
 *   ENV   → se parsea nombre/valor; por defecto solo sobreviven los nombres.
 *   JSON  → se recorre el árbol; las claves sensibles se sustituyen; los
 *           arrays de `KEY=value` (Config.Env y familia) se tratan aparte.
 *   YAML  → se recorre por indentación conservando la estructura; solo se
 *           sustituyen escalares, de modo que el YAML sigue siendo válido.
 *   TEXT  → último recurso, best-effort y marcado como tal.
 *
 * En los tres formatos estructurados la decisión de publicar un valor la toma
 * `isPublishableEnvValue` (allowlist), no `isSensitiveName` (lista negra). La
 * taxonomía solo añade una capa extra sobre claves que no son variables de
 * entorno (cookies, cabeceras, campos de JSON de terceros).
 */

import { isSensitiveName, REDACTED } from './sensitiveTaxonomy.mjs';
import { isPublishableEnvValue } from './evidenceContract.mjs';

// ── ENV ──────────────────────────────────────────────────────────────────────

/**
 * Parsea texto tipo dotenv sin evaluarlo (nada de `source`: eso ejecutaría
 * código). Reconoce comentarios, líneas vacías, `export NAME=`, y comillas.
 */
export const parseEnvText = (text) =>
    String(text ?? '').split(/\r?\n/).map((raw) => {
        const trimmed = raw.trim();
        if (trimmed === '') return { kind: 'blank', raw };
        if (trimmed.startsWith('#')) return { kind: 'comment', raw };
        const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/.exec(trimmed);
        if (!m) return { kind: 'other', raw };
        let value = m[2];
        let quote = '';
        if (value.length >= 2 && value[0] === value[value.length - 1] && (value[0] === '"' || value[0] === "'")) {
            quote = value[0];
            value = value.slice(1, -1);
        }
        return { kind: 'assignment', raw, name: m[1], value, quote };
    });

/** Nombres de variable declarados, en orden y sin valores. */
export const envNames = (text) =>
    parseEnvText(text).filter((e) => e.kind === 'assignment').map((e) => e.name);

/**
 * Redacta un artefacto .env.
 *
 * @param {string} text
 * @param {{mode?: 'names'|'redacted'}} opts
 *   'names'    → solo los nombres, una por línea. Es el modo de evidencia.
 *   'redacted' → conserva la forma del archivo; el valor sobrevive solo si el
 *                nombre está en la allowlist de valores publicables.
 */
export const redactEnvText = (text, { mode = 'names' } = {}) => {
    const entries = parseEnvText(text);
    if (mode === 'names') {
        return entries.filter((e) => e.kind === 'assignment').map((e) => e.name).join('\n');
    }
    return entries.map((e) => {
        if (e.kind !== 'assignment') return e.kind === 'blank' ? '' : e.raw;
        const publishable = isPublishableEnvValue(e.name) && !isSensitiveName(e.name);
        const value = publishable ? `${e.quote}${e.value}${e.quote}` : REDACTED;
        return `${e.name}=${value}`;
    }).join('\n');
};

// ── JSON ─────────────────────────────────────────────────────────────────────

/** Claves cuyo contenido es una lista de `NAME=value`. */
const ENV_ARRAY_KEYS = new Set(['ENV', 'ENVIRONMENT']);

/** Redacta una entrada `NAME=value` conservando el nombre. */
export const redactEnvAssignment = (entry) => {
    const s = String(entry ?? '');
    const eq = s.indexOf('=');
    if (eq <= 0) return REDACTED;
    const name = s.slice(0, eq);
    if (isPublishableEnvValue(name) && !isSensitiveName(name)) return s;
    return `${name}=${REDACTED}`;
};

/**
 * Redacta un valor JSON completo. Devuelve una estructura NUEVA; la entrada no
 * se muta (verificado por test).
 */
export const redactJson = (value, keyName = null) => {
    if (Array.isArray(value)) {
        const isEnvArray = keyName != null && ENV_ARRAY_KEYS.has(String(keyName).toUpperCase());
        return value.map((v) =>
            isEnvArray && typeof v === 'string' ? redactEnvAssignment(v) : redactJson(v));
    }
    if (value && typeof value === 'object') {
        const out = {};
        for (const [k, v] of Object.entries(value)) {
            if (isSensitiveName(k)) {
                // Se conserva la clave (es evidencia de que existe) y se pierde el valor.
                out[k] = Array.isArray(v) ? v.map(() => REDACTED) : REDACTED;
                continue;
            }
            out[k] = redactJson(v, k);
        }
        return out;
    }
    return value;
};

// ── YAML ─────────────────────────────────────────────────────────────────────

/**
 * Bloques cuyo CONTENIDO ENTERO es sensible, aunque las claves internas no lo
 * parezcan: dentro de `environment:` cualquier nombre puede ser una clave.
 */
const SENSITIVE_YAML_BLOCKS = new Set(['ENVIRONMENT', 'SECRETS', 'AUTH', 'AUTHS', 'HEADERS', 'CREDENTIALS']);

/**
 * Redacta YAML preservando su validez.
 *
 * Implementación deliberadamente conservadora y sin dependencias nuevas: se
 * recorre línea a línea manteniendo una pila de claves por indentación, y solo
 * se sustituyen ESCALARES. No se reordena, no se reserializa, no se tocan
 * comentarios. Limitaciones documentadas en
 * docs/ops/SAFE_OPERATIONAL_EVIDENCE.md: no interpreta flow-style (`{a: b}`),
 * anclas ni bloques literales multilinea; ante ellos redacta de más, nunca de
 * menos.
 */
export const redactYaml = (text) => {
    const lines = String(text ?? '').split(/\r?\n/);
    /** @type {{indent:number,key:string}[]} */
    const stack = [];
    const out = [];

    const inSensitiveBlock = () => stack.some((s) => SENSITIVE_YAML_BLOCKS.has(s.key.toUpperCase()));

    for (const line of lines) {
        if (line.trim() === '' || line.trim().startsWith('#')) { out.push(line); continue; }
        const indent = line.length - line.replace(/^\s*/, '').length;
        while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();

        const body = line.slice(indent);

        // Elemento de secuencia: `- NAME=value` o `- valor`
        if (body.startsWith('- ')) {
            const item = body.slice(2);
            if (inSensitiveBlock()) {
                out.push(`${' '.repeat(indent)}- ${item.includes('=') ? redactEnvAssignment(item) : REDACTED}`);
            } else {
                out.push(line);
            }
            continue;
        }

        const m = /^([^:#]+):(.*)$/.exec(body);
        if (!m) { out.push(line); continue; }
        const key = m[1].trim().replace(/^["']|["']$/g, '');
        const rest = m[2];

        if (rest.trim() === '') {
            // Apertura de bloque: se apila y se emite sin cambios.
            stack.push({ indent, key });
            out.push(line);
            continue;
        }

        const sensitive = isSensitiveName(key) ||
            (inSensitiveBlock() && !isPublishableEnvValue(key));
        if (sensitive) {
            out.push(`${' '.repeat(indent)}${m[1]}: ${REDACTED}`);
        } else {
            out.push(line);
        }
    }
    return out.join('\n');
};

// ── TEXTO PLANO (último recurso) ─────────────────────────────────────────────

/**
 * Redacción best-effort para texto sin estructura (logs pegados, notas).
 *
 * Está prohibida para evidence packs definitivos cuando existe un formato
 * estructurado; por eso devuelve `{ text, bestEffort: true }` y el CLI imprime
 * la advertencia. Un redactor de texto no puede prometer completitud: no sabe
 * dónde empieza y acaba un valor.
 */
export const redactText = (text, { literals = [] } = {}) => {
    let out = String(text ?? '');
    // 1) Literales conocidos primero (los más largos, para no dejar colas).
    for (const lit of [...literals].filter(Boolean).sort((a, b) => b.length - a.length)) {
        out = out.split(lit).join(REDACTED);
    }
    // 2) Asignaciones `NAME=value` y `NAME: value` con nombre sensible.
    //    Aquí sí manda la taxonomía (lista negra): en texto libre no hay
    //    estructura sobre la que aplicar una allowlist sin destrozar la prosa.
    //    Esa es exactamente la razón por la que este modo es best-effort y no
    //    sirve como evidencia definitiva.
    out = out.replace(/([A-Za-z_][A-Za-z0-9_.\-]*)\s*([=:])\s*("[^"\n]*"|'[^'\n]*'|[^\s,;}\]]+)/g,
        (whole, name, sep) => (isSensitiveName(name)
            ? `${name}${sep}${sep === ':' ? ' ' : ''}${REDACTED}`
            : whole));
    // 3) Cabeceras Authorization en cualquier forma.
    out = out.replace(/(authorization\s*:\s*)(bearer\s+)?\S+/gi, (_m, p1, p2) => `${p1}${p2 ?? ''}${REDACTED}`);
    return { text: out, bestEffort: true };
};
