/**
 * response-integrity.mjs — CHP-STATS-SHADOW-PERF-01D, Fase 15.
 *
 * Verifica que la respuesta PÚBLICA es idéntica en `legacy` y en `shadow`:
 * status, cabeceras relevantes, JSON completo, orden de claves, nulls.
 *
 * Normalización: solo se neutralizan los campos que dependen del reloj de la
 * petición (`computedAt`, `generatedAt`, ventanas temporales relativas a
 * `now`). Todo lo demás se compara tal cual, incluidos ceros y nulls — la
 * distinción entre `value: 0` (NO_ACTIVITY) y `value: null` (NO_DATA) es
 * precisamente uno de los invariantes a proteger.
 *
 * Uso:
 *   node response-integrity.mjs --manifest m.json --mode capture --out legacy.json
 *   node response-integrity.mjs --compare legacy.json shadow.json
 */
import fs from 'node:fs';
import { guardFromArgs, UnsafeTargetError } from './target-guard.mjs';

function parseArgs(argv) {
    const out = { _: [] };
    for (let i = 2; i < argv.length; i++) {
        const a = argv[i];
        if (a.startsWith('--')) {
            const k = a.slice(2); const v = argv[i + 1];
            if (v === undefined || v.startsWith('--')) out[k] = true; else { out[k] = v; i++; }
        } else out._.push(a);
    }
    return out;
}
const args = parseArgs(process.argv);

/** Claves cuyo valor depende del instante de la petición, no del contenido. */
const VOLATILE = new Set([
    'computedAt', 'generatedAt', 'timestamp', 'windowFrom', 'windowTo',
    'from', 'to', 'fromTs', 'toTs', 'lastActivityAt', 'lastLoginAt',
    // `createdAt` de los insights se sella en el instante de generar la
    // respuesta: dos capturas separadas en el tiempo difieren por construcción,
    // igual que `computedAt`. No es contenido.
    'createdAt',
]);

/**
 * Normaliza recursivamente. NO ordena claves: el orden forma parte del
 * contrato y una reordenación debe detectarse como diferencia.
 */
function normalize(value, key = null) {
    if (Array.isArray(value)) return value.map((v) => normalize(v));
    if (value && typeof value === 'object') {
        const out = {};
        for (const k of Object.keys(value)) out[k] = normalize(value[k], k);
        return out;
    }
    if (key && VOLATILE.has(key)) return '<volatile>';
    return value;
}

/** Diferencias con ruta, sin volcar valores largos. */
function diff(a, b, path = '', acc = []) {
    if (acc.length >= 50) return acc;
    const ta = a === null ? 'null' : Array.isArray(a) ? 'array' : typeof a;
    const tb = b === null ? 'null' : Array.isArray(b) ? 'array' : typeof b;
    if (ta !== tb) { acc.push({ path, kind: 'TYPE', legacy: ta, shadow: tb }); return acc; }
    if (ta === 'array') {
        if (a.length !== b.length) acc.push({ path, kind: 'ARRAY_LENGTH', legacy: a.length, shadow: b.length });
        for (let i = 0; i < Math.min(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, acc);
        return acc;
    }
    if (ta === 'object') {
        const ka = Object.keys(a), kb = Object.keys(b);
        if (ka.join(',') !== kb.join(',')) {
            acc.push({ path, kind: 'KEY_ORDER_OR_SET',
                       legacy: ka.filter((k) => !kb.includes(k)).slice(0, 5),
                       shadow: kb.filter((k) => !ka.includes(k)).slice(0, 5) });
        }
        for (const k of new Set([...ka, ...kb])) diff(a[k], b[k], path ? `${path}.${k}` : k, acc);
        return acc;
    }
    if (a !== b) {
        const short = (v) => (typeof v === 'string' && v.length > 40 ? v.slice(0, 40) + '…' : v);
        acc.push({ path, kind: 'VALUE', legacy: short(a), shadow: short(b) });
    }
    return acc;
}

if (args.compare || args._.length === 2) {
    const [fa, fb] = args._.length === 2 ? args._ : [args.compare, args._[0]];
    const A = JSON.parse(fs.readFileSync(fa, 'utf8'));
    const B = JSON.parse(fs.readFileSync(fb, 'utf8'));

    let totalDiffs = 0;
    console.log(`comparando ${A.label ?? fa} (legacy) contra ${B.label ?? fb} (shadow)\n`);
    for (const id of Object.keys(A.samples)) {
        const a = A.samples[id], b = B.samples[id];
        if (!b) { console.log(`  ${id}: AUSENTE en shadow`); totalDiffs++; continue; }
        const statusSame = a.status === b.status;
        const ctSame = (a.contentType ?? null) === (b.contentType ?? null);
        const ds = diff(normalize(a.body), normalize(b.body));
        totalDiffs += ds.length + (statusSame ? 0 : 1) + (ctSame ? 0 : 1);
        console.log(`  ${id}: status ${a.status}${statusSame ? ' ==' : ' != ' + b.status}` +
                    ` | content-type ${ctSame ? 'igual' : 'DISTINTO'}` +
                    ` | diferencias JSON: ${ds.length}`);
        for (const d of ds.slice(0, 8)) {
            console.log(`      ${d.kind} @ ${d.path}: legacy=${JSON.stringify(d.legacy)} shadow=${JSON.stringify(d.shadow)}`);
        }
    }
    console.log(`\nDIFERENCIAS TOTALES: ${totalDiffs}`);
    process.exit(totalDiffs === 0 ? 0 : 1);
}

// ── modo captura ───────────────────────────────────────────────────────────
const manifest = JSON.parse(fs.readFileSync(String(args.manifest), 'utf8'));
manifest.host = manifest.host || '127.0.0.1';
manifest.port = manifest.port || 3000;
try {
    guardFromArgs(manifest.host, args);
} catch (e) {
    if (e instanceof UnsafeTargetError) { console.error(`\n${e.message}\n`); process.exit(3); }
    throw e;
}
const base = `http://${manifest.host}:${manifest.port}`;
const repeats = Number(args.repeats ?? 3);

const samples = {};
for (const r of [...manifest.routes, ...(manifest.negative ?? [])]) {
    // Se capturan varias veces y se conserva la ÚLTIMA: así el estado del
    // servidor está caliente y la muestra es determinística por posición.
    for (let i = 0; i < repeats; i++) {
        const res = await fetch(base + r.path, { headers: r.headers });
        const text = await res.text();
        let body = null;
        try { body = JSON.parse(text); } catch { body = { __nonJson: text.slice(0, 200) }; }
        samples[r.id] = { status: res.status, contentType: res.headers.get('content-type'), body };
    }
}

const out = { label: String(args.label ?? 'capture'), samples };
fs.writeFileSync(String(args.out), JSON.stringify(out));
console.log(`capturadas ${Object.keys(samples).length} rutas → ${args.out}`);
