#!/usr/bin/env node
/**
 * CHP-SEC-ADMIN-EVIDENCE-HARDEN-01B — Ratchet CI de captura de secretos.
 *
 * Bloquea que vuelvan a entrar al repositorio los patrones que ya produjeron
 * credenciales persistidas en producción. Analiza SOLO archivos versionados
 * (`git ls-files`): nunca abre `.env`, ni ignorados, ni stores reales.
 *
 * Escape hatch explícito y auditable: una línea con
 *
 *     chp-evidence-ratchet: allow <motivo>
 *
 * en la propia línea o en la anterior exime esa ocurrencia. El motivo es
 * obligatorio — sin texto detrás, la exención no cuenta.
 *
 *   node scripts/security/evidence-ratchet.mjs            # todo lo versionado
 *   node scripts/security/evidence-ratchet.mjs <archivo…> # subconjunto
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';

const HELPER = 'safeOperationalEvidence';
const ALLOW_MARK = /chp-evidence-ratchet:\s*allow\s+\S+/;

/**
 * Reglas. Cada una recibe la línea y devuelve true si la línea la viola.
 * Se documenta el incidente que justifica cada una.
 */
export const RULES = [
    {
        id: 'docker-inspect-raw',
        why: 'docker inspect sin --format vuelca Config.Env completo; así se persistieron las dos claves en m1-hardening y en containers.inspect.json',
        test: (l) => /\bdocker\s+inspect\b/.test(l) && !/--format|\s-f\s/.test(l),
        fix: `usar 'node scripts/security/${HELPER}.mjs container-summary <nombre>'`,
    },
    {
        id: 'compose-config-persisted',
        why: 'docker compose config imprime el entorno efectivo con valores', // chp-evidence-ratchet: allow texto-de-la-propia-regla
        test: (l) => /docker[\s-]compose\b[^\n]*\bconfig\b/.test(l)
            && !/(^|\s)(-q|--quiet)(\s|$)/.test(l)
            && !l.includes(HELPER),
        fix: `'docker compose config -q' para validar, o '${HELPER}.mjs compose-summary' para evidencia`, // chp-evidence-ratchet: allow texto-de-la-propia-regla
    },
    {
        id: 'env-file-copy',
        why: 'copiar .env entero arrastra TODAS las credenciales; una copia de 2026-04 seguía viva en 2026-07 con las dos claves de IA',
        test: (l) => {
            const m = /(?:^|[\s|;&(])(cat|cp|scp|mv|tar|less|more|head|tail)\s+((?:-\S+\s+)*)(\S+)/.exec(l);
            if (!m) return false;
            const src = m[3].replace(/^["']|["']$/g, '');
            if (!/(^|\/)\.env($|[^.\w])|(^|\/)\.env$/.test(src)) return false;
            return !/\.env\.(example|template|sample|dist)$/.test(src);
        },
        fix: `'${HELPER}.mjs redact-env <archivo>' produce el artefacto sin valores`,
    },
    {
        id: 'config-env-values',
        why: 'imprimir .Config.Env expone los valores, no solo los nombres', // chp-evidence-ratchet: allow texto-de-la-propia-regla
        test: (l) => /\.Config\.Env\b/.test(l) && !l.includes(HELPER),
        fix: `'${HELPER}.mjs environment-names <nombre>' publica nombres y solo banderas permitidas`,
    },
    {
        id: 'secret-as-prompt',
        why: 'el prompt de read va al historial de shell; así llegó una clave a /root/.bash_history el 2026-07-31',
        test: (l) => /\bread\b[^\n]*-[a-z]*p\s*(["'])[^"'\n]*\$/.test(l),
        fix: 'prompt literal fijo + provisionSecret.mjs leyendo de stdin',
    },
    {
        id: 'secret-in-argv',
        why: 'un secreto en la línea de comandos es visible en `ps` para cualquier usuario del host',
        test: (l) => /-H\s+["']?\s*(x-admin-secret|authorization)\s*:[^"'\n]*\$/i.test(l),
        fix: "curl --config <archivo 0600> con la línea 'header = \"...\"'",
    },
    {
        id: 'env-dump',
        why: 'volcar el entorno entero y filtrar después materializa todos los valores; basta borrar el grep para tener una fuga',
        test: (l) => /(^|[\s|;&(])printenv(\s|$)/.test(l)
            || /docker\s+exec\s+[^\n]*\senv\s*$/.test(l.trim()),
        fix: `'${HELPER}.mjs environment-names <nombre>' construye la salida por allowlist`,
    },
    {
        id: 'unauthorized-evidence-helper',
        why: 'un segundo recolector de evidencia fuera de scripts/security/ no hereda la allowlist',
        // Solo aplica a ejecutables: la documentación puede nombrar comandos
        // sin ser un recolector.
        test: (l, ctx) => ctx.outsideSecurityDir
            && /\.(sh|bash|zsh|mjs|cjs|js|py)$/.test(ctx.path)
            && /evidence|operational[-_]?snapshot/i.test(ctx.path)
            && /\bdocker\s+(inspect|compose)\b/.test(l),
        fix: `extender scripts/security/${HELPER}.mjs en vez de crear otro recolector`,
    },
];

const TEXT_EXT = /\.(md|sh|bash|zsh|mjs|cjs|js|ts|tsx|py|yml|yaml|txt|json|conf|env\.example)$/i;
const SKIP_PATH = /(^|\/)(node_modules|dist|package-lock\.json)(\/|$)/;

/**
 * Parte una línea en segmentos de comando por `|`, `;`, `&&`, `||` y `$(`.
 * No pretende ser un parser de shell: solo evita que un flag seguro de un
 * comando enmascare a otro comando inseguro de la misma línea.
 */
export const splitCommandSegments = (line) =>
    String(line ?? '')
        .split(/\|\||&&|[|;]|\$\(|`/)
        .map((s) => s.trim())
        .filter((s) => s !== '')
        // Un `echo "=== docker inspect x ==="` es un encabezado, no una captura.
        // Se descarta el segmento entero: lo que imprime es texto, no evidencia.
        .filter((s) => !/^(echo|printf)\b/.test(s));

/**
 * ¿La línea entera es un comentario o un encabezado de prosa?
 *
 * Un comentario no se ejecuta, y la propia herramienta necesita EXPLICAR los
 * patrones peligrosos sin autodetectarse. La comprobación va sobre la línea
 * completa, no sobre el segmento: partir por `|` o por comilla invertida deja
 * fragmentos sin el prefijo de comentario.
 *
 * Coste conocido y aceptado: un comando dentro de una viñeta markdown que
 * empiece por `*` no se analiza. Las viñetas de este repositorio usan `-`, y
 * los bloques de código sí se analizan.
 */
export const isCommentLine = (line) => /^\s*(#{1,6}\s|#(?!\s*chp-)|\/\/|\/\*|\*(?!\*))/.test(String(line ?? ''));

export const trackedFiles = () =>
    execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
        .split('\n').filter((f) => f !== '' && TEXT_EXT.test(f) && !SKIP_PATH.test(f));

/**
 * Analiza un texto. Devuelve las violaciones encontradas.
 * @param {string} text
 * @param {string} filePath  ruta relativa, solo para contexto y mensajes
 */
export const scanText = (text, filePath = '<memoria>') => {
    const lines = String(text ?? '').split(/\r?\n/);
    const ctx = {
        path: filePath,
        outsideSecurityDir: !filePath.replace(/\\/g, '/').includes('scripts/security/'),
    };
    const out = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (ALLOW_MARK.test(line)) continue;
        if (i > 0 && ALLOW_MARK.test(lines[i - 1])) continue;
        if (isCommentLine(line)) continue;
        // Se evalúa por SEGMENTO de comando, no por línea. Un one-liner de
        // observación puede encadenar diez comandos: si se mira la línea
        // entera, el `--format` de un `docker ps` inocente tapa el
        // `docker inspect` crudo que viene tres tuberías después. Eso es
        // exactamente lo que ocurrió en OBSERVATION-PLAYBOOK-72H.md.
        for (const segment of splitCommandSegments(line)) {
            for (const rule of RULES) {
                let hit = false;
                try { hit = rule.test(segment, ctx); } catch { hit = false; }
                if (hit && !out.some((v) => v.line === i + 1 && v.rule === rule.id)) {
                    out.push({ file: filePath, line: i + 1, rule: rule.id, why: rule.why, fix: rule.fix });
                }
            }
        }
    }
    return out;
};

export const scanFiles = (files) => {
    const violations = [];
    for (const f of files) {
        let text;
        try {
            if (statSync(f).size > 4 * 1024 * 1024) continue;
            text = readFileSync(f, 'utf8');
        } catch { continue; }
        violations.push(...scanText(text, f));
    }
    return violations;
};

const invokedDirectly = process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('scripts/security/evidence-ratchet.mjs');
if (invokedDirectly) {
    const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
    const files = args.length ? args : trackedFiles();
    const violations = scanFiles(files);
    if (violations.length === 0) {
        console.log(`evidence-ratchet: OK — ${files.length} archivos versionados, 0 violaciones`);
        process.exit(0);
    }
    console.error(`evidence-ratchet: ${violations.length} violación(es)\n`);
    for (const v of violations) {
        console.error(`  ${v.file}:${v.line}  [${v.rule}]`);
        console.error(`      motivo: ${v.why}`);
        console.error(`      arreglo: ${v.fix}`);
    }
    console.error('\nSi una ocurrencia es legítima, márcala en su línea o en la anterior con:');
    console.error('  chp-evidence-ratchet: allow <motivo>');
    process.exit(1);
};
