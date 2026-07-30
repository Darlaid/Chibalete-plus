/**
 * http-equivalence.mjs — CHP-STATS-LEGACY-PERF-01E, Fase 5.
 *
 * Compara la respuesta pública completa —ruta Express, autorización,
 * `metricsService`, formatters y serialización JSON— entre los brazos
 * `LEGACY_METRICS_REQUEST_CONTEXT=off` y `=on`.
 *
 * Sobre los campos volátiles: no se aceptan por declaración, se **derivan de la
 * evidencia**. Se capturan dos respuestas consecutivas del MISMO brazo; solo
 * los campos que ya difieren ahí pueden excluirse de la comparación entre
 * brazos, y además deben pasar un filtro de nombre de sello técnico. Un campo
 * que cambie entre brazos pero no dentro de un brazo es una diferencia real y
 * se reporta como tal.
 *
 * Modos:
 *   --mode capture  --manifest m.json --repeats 2 --out arm.json
 *   --mode compare  --off off.json --on on.json
 */
import fs from 'node:fs';
import { guardFromArgs, UnsafeTargetError } from './target-guard.mjs';

function parseArgs(argv) {
    const out = {};
    for (let i = 2; i < argv.length; i++) {
        if (!argv[i].startsWith('--')) continue;
        const k = argv[i].slice(2), v = argv[i + 1];
        if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; }
    }
    return out;
}
const args = parseArgs(process.argv);

/**
 * Nombres admisibles como sello técnico. Un campo solo se excluye si además
 * varía dentro del mismo brazo: la lista acota, no autoriza por sí sola.
 */
const TECHNICAL_TIMESTAMP = /(^|\.)(computedAt|generatedAt|createdAt|timestamp|windowFrom|windowTo|from|to|fromTs|toTs)$/;

/** Recorre el objeto y devuelve un mapa ruta → valor primitivo. */
function flatten(v, p = '', out = new Map()) {
    if (Array.isArray(v)) { v.forEach((x, i) => flatten(x, `${p}[${i}]`, out)); return out; }
    if (v && typeof v === 'object') { for (const k of Object.keys(v)) flatten(v[k], p ? `${p}.${k}` : k, out); return out; }
    out.set(p, v);
    return out;
}

/** Rutas que difieren entre dos capturas del mismo brazo. */
function volatilePaths(a, b) {
    const fa = flatten(a), fb = flatten(b);
    const paths = new Set();
    for (const [k, v] of fa) if (!Object.is(v, fb.get(k))) paths.add(k);
    for (const [k, v] of fb) if (!Object.is(v, fa.get(k))) paths.add(k);
    return paths;
}

function structuralDiff(a, b, volatile, p = '', acc = []) {
    if (acc.length >= 40) return acc;
    const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
    const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
    if (ta !== tb) { acc.push({ path: p, kind: 'TYPE', off: ta, on: tb }); return acc; }
    if (ta === 'array') {
        if (a.length !== b.length) acc.push({ path: p, kind: 'ARRAY_LENGTH', off: a.length, on: b.length });
        for (let i = 0; i < Math.min(a.length, b.length); i++) structuralDiff(a[i], b[i], volatile, `${p}[${i}]`, acc);
        return acc;
    }
    if (ta === 'object') {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.join(',') !== kb.join(',')) acc.push({ path: p, kind: 'KEY_SET_OR_ORDER', off: ka.length, on: kb.length });
        for (const k of new Set([...ka, ...kb])) structuralDiff(a[k], b[k], volatile, p ? `${p}.${k}` : k, acc);
        return acc;
    }
    if (!Object.is(a, b)) {
        if (volatile.has(p) && TECHNICAL_TIMESTAMP.test(p)) return acc;   // sello técnico justificado
        const short = (v) => (typeof v === 'string' && v.length > 60 ? v.slice(0, 60) + '…' : v);
        let kind = 'VALUE';
        if (a === null || b === null || a === 0 || b === 0) kind = 'NULL_ZERO';
        acc.push({ path: p, kind, off: short(a), on: short(b) });
    }
    return acc;
}

// ── captura ────────────────────────────────────────────────────────────────
if (args.mode === 'capture') {
    const manifest = JSON.parse(fs.readFileSync(String(args.manifest), 'utf8'));
    manifest.host = manifest.host || '127.0.0.1';
    manifest.port = manifest.port || 3000;
    try { guardFromArgs(manifest.host, args); }
    catch (e) { if (e instanceof UnsafeTargetError) { console.error(`\n${e.message}\n`); process.exit(3); } throw e; }

    const base = `http://${manifest.host}:${manifest.port}`;
    const repeats = Number(args.repeats ?? 2);
    const all = manifest.routes.concat(manifest.negative ?? []);
    const captures = [];

    for (let rep = 0; rep < repeats; rep++) {
        const snap = {};
        for (const r of all) {
            const res = await fetch(base + r.path, { headers: r.headers });
            const text = await res.text();
            let body; try { body = JSON.parse(text); } catch { body = { __nonJson: text.slice(0, 200) }; }
            snap[r.id] = {
                status: res.status,
                contentType: res.headers.get('content-type'),
                body,
            };
        }
        captures.push(snap);
    }
    fs.writeFileSync(String(args.out), JSON.stringify({ arm: String(args.arm ?? '?'), captures }), { mode: 0o600 });
    console.log(`capturadas ${all.length} rutas x ${repeats} repeticiones → ${args.out}`);
    process.exit(0);
}

// ── comparación ────────────────────────────────────────────────────────────
const OFF = JSON.parse(fs.readFileSync(String(args.off), 'utf8'));
const ON  = JSON.parse(fs.readFileSync(String(args.on), 'utf8'));
const ids = Object.keys(OFF.captures[0]);

console.log('=== EQUIVALENCIA HTTP off vs on (formatters incluidos) ===\n');

// 1. Derivar volátiles: lo que ya cambia DENTRO de cada brazo.
const volatileOff = new Map(), volatileOn = new Map();
for (const id of ids) {
    volatileOff.set(id, OFF.captures.length > 1
        ? volatilePaths(OFF.captures[0][id].body, OFF.captures[1][id].body) : new Set());
    volatileOn.set(id, ON.captures.length > 1
        ? volatilePaths(ON.captures[0][id].body, ON.captures[1][id].body) : new Set());
}

const whitelist = new Set();
for (const id of ids) {
    for (const p of volatileOff.get(id)) if (TECHNICAL_TIMESTAMP.test(p)) whitelist.add(p.replace(/\[\d+\]/g, '[]'));
}
console.log('whitelist derivada de la variación DENTRO del brazo off (solo sellos técnicos):');
for (const p of [...whitelist].sort()) console.log(`  ${p}`);
if (!whitelist.size) console.log('  (ninguna)');

// Campos que varían dentro del brazo pero NO son sello técnico: se avisan, y no
// se excluyen — serían no-determinismo funcional del propio legacy.
const noTechnical = new Set();
for (const id of ids) for (const p of volatileOff.get(id)) if (!TECHNICAL_TIMESTAMP.test(p)) noTechnical.add(`${id}:${p}`);
if (noTechnical.size) {
    console.log('\nAVISO — varían dentro del brazo off y NO son sello técnico (no se excluyen):');
    for (const p of [...noTechnical].slice(0, 10)) console.log(`  ${p}`);
}

// 2. Comparar entre brazos.
console.log('\nruta      status      content-type   diferencias contractuales');
let total = 0;
for (const id of ids) {
    const a = OFF.captures[0][id], b = ON.captures[0][id];
    const vol = new Set([...volatileOff.get(id), ...volatileOn.get(id)]);
    const diffs = structuralDiff(a.body, b.body, vol);
    const statusOk = a.status === b.status;
    const ctOk = (a.contentType ?? null) === (b.contentType ?? null);
    const n = diffs.length + (statusOk ? 0 : 1) + (ctOk ? 0 : 1);
    total += n;
    console.log(`${id.padEnd(9)} ${String(a.status).padEnd(4)}${statusOk ? '==' : '!=' + b.status}   ${ctOk ? 'igual' : 'DISTINTO'}        ${n}`);
    for (const d of diffs.slice(0, 6)) console.log(`    ${d.kind} @ ${d.path}: off=${JSON.stringify(d.off)} on=${JSON.stringify(d.on)}`);
}

console.log(`\nDIFERENCIAS CONTRACTUALES TOTALES: ${total}`);
if (args.out) fs.writeFileSync(String(args.out), JSON.stringify({ total, whitelist: [...whitelist] }, null, 2));
process.exit(total === 0 ? 0 : 1);
