/**
 * equivalence-runner.mjs — CHP-STATS-LEGACY-PERF-01D.
 *
 * Proceso HIJO de un brazo de la comparación. El flag
 * `LEGACY_METRICS_REQUEST_CONTEXT` se resuelve al cargar `metricsService`, así
 * que cada brazo necesita su propio proceso: alternar el flag dentro del mismo
 * proceso no probaría nada.
 *
 * El reloj se fija **antes** de importar el módulo bajo prueba, de modo que
 * `computedAt` y los cálculos que dependen de `Date.now()` (la regla de
 * `abandoned` en `computeContentStats`) sean deterministas. Así la comparación
 * puede ser byte a byte, sin normalizar ningún campo funcional.
 *
 * Salida: JSON por stdout con un hash por caso. Devolver los 647 resultados
 * completos por tubería sería innecesario: si un hash difiere, el padre vuelve a
 * pedir ese caso concreto con `--full`.
 *
 * Cero PII en la salida: los casos se identifican por ordinal, nunca por su
 * clave real.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

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
const FIXTURE = String(args.fixture);
const MANIFEST = JSON.parse(fs.readFileSync(String(args.manifest), 'utf8'));
const FIXED_NOW = Number(args.now ?? 1800000000000);
const WANT_FULL = new Set(args.full ? String(args.full).split(',') : []);

// ── reloj fijo, ANTES de importar nada del servicio ────────────────────────
const _realNow = Date.now;
Date.now = () => FIXED_NOW;

const DATA = path.join(FIXTURE, 'data');
const CRIT = path.join(FIXTURE, 'data-critical');
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };

const { getAllProgressAsMap } = await import('../../server/progressService.js');
const metrics = await import('../../server/metricsService.js');

const raw = {
    events:          readJSON(path.join(DATA, 'analytics_db.json'), []),
    leoMemory:       readJSON(path.join(DATA, 'leo_memory_db.json'), { memoryMap: {} }),
    leoInteractions: readJSON(path.join(DATA, 'leo_interactions_db.json'), []),
    progress:        getAllProgressAsMap(),
    groups:          readJSON(path.join(DATA, 'groups_db.json'), []),
    users:           readJSON(path.join(CRIT, 'usuarios_colegios_oro.json'), []),
};

const sha = (v) => crypto.createHash('sha256').update(v).digest('hex');
/** Serialización estable: el orden de claves forma parte del contrato. */
const canon = (v) => JSON.stringify(v, (k, val) => (val === undefined ? '__undefined__' : val));

/**
 * Listado institucional. Se deriva de `groups`, igual que el handler legacy:
 * no invoca ningún `compute*`, así que no toca el camino del contexto. Se
 * compara de todos modos para detectar que `init()` no mutase los grupos.
 */
function schoolsListing() {
    const seen = new Map();
    for (const g of raw.groups) {
        const name = typeof g.school === 'string' ? g.school.trim() : '';
        if (!name) continue;
        if (!seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), { schoolName: name, groups: 0 });
        seen.get(name.toLowerCase()).groups += 1;
    }
    return [...seen.values()].sort((a, b) => a.schoolName.localeCompare(b.schoolName));
}

function runCase(c) {
    switch (c.kind) {
        case 'student':     return metrics.computeStudentMetrics(c.key);
        case 'course':      return metrics.computeCourseMetrics(c.key);
        case 'school':      return metrics.computeSchoolMetrics(c.key);
        case 'schoolsList': return schoolsListing();
        default: throw new Error(`kind desconocido: ${c.kind}`);
    }
}

// ── ejecución ──────────────────────────────────────────────────────────────
const results = [];
const order = MANIFEST.order ?? MANIFEST.cases.map((_, i) => i);

metrics.init(raw);

for (const idx of order) {
    const c = MANIFEST.cases[idx];
    let payload = null, error = null;
    try {
        payload = runCase(c);
    } catch (e) {
        error = { name: e?.name ?? 'Error', code: e?.code ?? null, message: e?.message ?? String(e) };
    }
    const body = error ? { __error: error } : payload;
    const serialized = canon(body);
    results.push({
        id: c.id,
        kind: c.kind,
        hash: sha(serialized),
        bytes: Buffer.byteLength(serialized),
        errored: Boolean(error),
        errorName: error?.name ?? null,
        errorCode: error?.code ?? null,
        // El mensaje se conserva solo si el padre lo pide: puede contener la
        // clave del caso (p. ej. `group "X" not found`).
        full: WANT_FULL.has(c.id) ? body : undefined,
    });
}

// ── contadores técnicos agregados ──────────────────────────────────────────
const c = metrics.metricsContextCounters;
const out = {
    arm: String(args.arm ?? 'unknown'),
    flag: process.env.LEGACY_METRICS_REQUEST_CONTEXT ?? '(ausente)',
    contextEnabled: metrics.isRequestContextEnabled(),
    fixedNow: FIXED_NOW,
    node: process.version,
    tz: process.env.TZ ?? null,
    caseCount: results.length,
    counters: {
        created: c.metrics_request_context_created_total,
        disposed: c.metrics_request_context_disposed_total,
        progressIndexed: c.metrics_request_context_progress_records_indexed,
        eventsIndexed: c.metrics_request_context_events_indexed,
        memoHits: c.metrics_student_memo_hits_total,
        memoMisses: c.metrics_student_memo_misses_total,
        legacyFallback: c.metrics_legacy_fallback_calls_total,
    },
    sources: {
        canonicalUsers: raw.users.length,
        groups: raw.groups.length,
        progressRecords: Object.keys(raw.progress.progressMap || {}).length,
        analyticsEvents: raw.events.length,
    },
    results,
};

Date.now = _realNow;

// El resultado va a FICHERO, no a stdout: `progressService` escribe su ruta
// con `console.log` al importarse, y cualquier traza futura contaminaría la
// salida. Un canal dedicado evita depender de que nadie más hable por stdout.
if (!args.result) { console.error('falta --result'); process.exit(2); }
fs.writeFileSync(String(args.result), JSON.stringify(out), { mode: 0o600 });
