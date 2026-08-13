/**
 * identityShadowCompare.js — CHP-IDDB-02C-B: comparación runtime JSON ↔ SQLite
 * en modo SOMBRA. Observa, jamás decide.
 *
 * CONTRATO DE SEGURIDAD (el corazón de esta unidad)
 * ------------------------------------------------
 * SHADOW COMPARISON NO ES SHADOW AUTHORITY. El flujo es:
 *
 *      lectura JSON  → RESULTADO OFICIAL (respuesta, authn, authz, mutación)
 *      lectura SQLite → resultado sombra (solo telemetría)
 *                     → comparador semántico → contadores agregados
 *
 * Este módulo se invoca DESPUÉS de que el resultado oficial ya existe, recibe
 * ese resultado por referencia y devuelve `undefined`. No lo muta, no lo
 * reemplaza, no lanza y no puede cambiar un status code ni una decisión de
 * autorización. Si algo falla dentro, se contabiliza COMPARATOR_ERROR y el
 * runtime continúa exactamente igual.
 *
 * SEPARACIÓN DEL CUTOVER
 * ----------------------
 * El interruptor es propio y NO reutiliza el del cutover:
 *   IDENTITY_SHADOW_COMPARE          '1'|'true' → activa la comparación. OFF por
 *                                     defecto: sin él, coste cero (una lectura de
 *                                     env y `return`).
 *   IDENTITY_SHADOW_COMPARE_DOMAINS  csv; default = todos los dominios con
 *                                     representación en el espejo.
 *   IDENTITY_SHADOW_COMPARE_TTL_MS   ventana de memoización de la huella de las
 *                                     fuentes (default 1000 ms). Ver más abajo.
 *
 * Activar la comparación NUNCA cambia el backend oficial: `IDENTITY_READ` y
 * `IDENTITY_READ_DOMAINS` son otro eje y este módulo no los lee ni los escribe.
 *
 * COSTE Y MEMOIZACIÓN (honesto, no oculta divergencias)
 * ----------------------------------------------------
 * Evaluar 647 usuarios campo a campo en cada request sería inaceptable. Se
 * memoiza el VEREDICTO por dominio, invalidado por la huella de ambas fuentes
 * (mtime+size del JSON, versión de shadow_state y cardinalidad de la tabla).
 * La huella se re-sondea como mucho una vez por TTL. Consecuencias exactas:
 *   - toda lectura elegible se clasifica (comparisons++);
 *   - la evaluación semántica completa solo se repite cuando alguna fuente
 *     cambia o expira el TTL (evaluations++);
 *   - una divergencia que aparezca en T se detecta como muy tarde en T+TTL.
 * Ambos contadores se publican por separado: nada se declara "comparado" sin
 * decir cuántas evaluaciones reales lo respaldan.
 *
 * CONTRATO DE LA VENTANA DE PROPAGACIÓN (02C-B-R1)
 * -------------------------------------------------
 * El dual-write escribe primero el JSON y espeja después, así que existe una
 * ventana de milisegundos en la que una lectura ve JSON nuevo + espejo anterior.
 * Esa diferencia es REAL pero transitoria y se clasifica como WRITE_PROPAGATION,
 * clase propia con contador propio: nunca MATCH, nunca gap de cobertura.
 *
 *   sello del espejo   `shadow_state.last_source_seq`, que el hook de escritura
 *                      fija con `statSync(file).mtimeMs` de la instantánea que
 *                      espejó (ver `sourceVersionOf` en identityWriteHook).
 *   sello de la fuente `statSync(file).mtimeMs` actual. MISMO reloj que el
 *                      anterior: comparar "quién es más nuevo" no cruza relojes.
 *   umbral             IDENTITY_SHADOW_COMPARE_STALE_MS (default 5000 ms, `0`
 *                      desactiva la gracia por completo). FINITO por contrato.
 *   edad               `Date.now() - mtime`. Aquí sí se cruza el reloj de pared
 *                      con el del filesystem; en el mismo host es la misma
 *                      fuente. Edad NEGATIVA (mtime futuro) ⇒ desfase de reloj
 *                      ⇒ NO se concede gracia.
 *   sellos ausentes    sin fila en `shadow_state` o sin mtime ⇒ NO hay gracia.
 *   pasado el umbral   la gracia CADUCA: la misma diferencia pasa a
 *                      UNEXPECTED_DIVERGENCE (o SECURITY_RELEVANT). Sin ese
 *                      límite, una edición del JSON fuera del flujo dual-write
 *                      (script, restore) quedaría enmascarada para siempre.
 * Un veredicto tomado con el espejo retrasado NO se memoiza: la siguiente
 * lectura vuelve a mirar cuando ya haya asentado.
 *
 * POLÍTICA DE GAPS CONOCIDOS (por regla, jamás por lista de IDs)
 * -------------------------------------------------------------
 * La ausencia de una entidad en el espejo solo es ESPERADA si la MISMA regla
 * que usa el espejo para no escribirla la explica: `projectUsers`/`projectGroups`
 * la rechazan, o está en `migration_exclusions`, o es un tombstone. No hay
 * excepciones ad hoc: si el espejo no sabe explicar la ausencia, es
 * UNEXPECTED_DIVERGENCE.
 *
 * PRIVACIDAD
 * ----------
 * Jamás se registran nombres, correos, tokens, ids crudos ni payloads. Las
 * referencias van hasheadas (h16 = sha256 truncado a 16 hex) y los campos de
 * credencial ni siquiera se comparan.
 */
import fs from 'node:fs';
import crypto from 'node:crypto';
import {
    identityShadowCompareTotal as mCmp,
    identityShadowCompareEntities as mEnt,
    identityShadowCompareDuration as mDur,
} from '../observability/metrics.js';

export const SHADOW_COMPARE_VERSION = 'chp-iddb-02c-b/1';

/** Resultado de una lectura comparada. Precedencia de peor a mejor. */
export const RESULT = Object.freeze({
    COMPARATOR_ERROR: 'comparator_error',
    SECURITY_RELEVANT_DIVERGENCE: 'security_relevant_divergence',
    UNEXPECTED_DIVERGENCE: 'unexpected_divergence',
    /**
     * Ventana de propagación del dual-write: el JSON ya se escribió y el espejo
     * todavía no ha aplicado ESA instantánea. CLASE PROPIA, con contador propio:
     * no es MATCH (hay diferencia real) y no es un gap de cobertura (no responde
     * a ninguna política de exclusión). Está ACOTADA en el tiempo — ver el
     * contrato en la cabecera del módulo.
     */
    WRITE_PROPAGATION: 'write_propagation',
    EXPECTED_COVERAGE_GAP: 'expected_coverage_gap',
    MATCH: 'match',
});
const PRECEDENCE = [
    RESULT.COMPARATOR_ERROR,
    RESULT.SECURITY_RELEVANT_DIVERGENCE,
    RESULT.UNEXPECTED_DIVERGENCE,
    RESULT.WRITE_PROPAGATION,
    RESULT.EXPECTED_COVERAGE_GAP,
    RESULT.MATCH,
];
const worst = (a, b) => (PRECEDENCE.indexOf(a) <= PRECEDENCE.indexOf(b) ? a : b);

/**
 * Clases de gap. Las CUATRO primeras son los gaps aprobados en 02C-A. Cualquier
 * otra clase que aparezca en producción exige investigación (no es un fallo del
 * comparador: es una ausencia explicada por política pero NO prevista).
 */
export const GAP = Object.freeze({
    SYNTHETIC_USER: 'SYNTHETIC_USER',
    LEGACY_GROUP: 'LEGACY_GROUP',
    CREDENTIAL_AUTHORITY: 'CREDENTIAL_AUTHORITY',
    ACCESS_RULES: 'ACCESS_RULES',
    // ── fuera de las cuatro aprobadas ────────────────────────────────────────
    TOMBSTONED_IDENTITY: 'TOMBSTONED_IDENTITY',
    EXCLUDED_BY_DISPOSITION: 'EXCLUDED_BY_DISPOSITION',
    NOT_PROJECTABLE_BY_POLICY: 'NOT_PROJECTABLE_BY_POLICY',
});
export const APPROVED_GAPS = Object.freeze([
    GAP.SYNTHETIC_USER, GAP.LEGACY_GROUP, GAP.CREDENTIAL_AUTHORITY, GAP.ACCESS_RULES,
]);

/** Campos cuya divergencia puede cambiar una decisión de autorización. */
const AUTHZ_FIELDS_USER = new Set([
    'roles', 'rol', 'accountStatus', 'organizationId', 'groupIds', 'colegio', 'id', 'email',
]);
const AUTHZ_FIELDS_GROUP = new Set([
    'organizationId', 'type', 'memberIds', 'studentIds', 'mediatorIds', 'teacherId',
    'school', 'id', 'titleIds', 'collectionIds',
]);

const sha = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const h16 = (v) => sha(v).slice(0, 16);

const envOn = (name) => {
    const v = process.env[name];
    return v === '1' || String(v).toLowerCase() === 'true';
};
export const shadowCompareEnabled = () => envOn('IDENTITY_SHADOW_COMPARE');
const DEFAULT_DOMAINS = ['users', 'groups', 'institutions', 'memberships', 'access'];
export function shadowCompareDomains() {
    const raw = String(process.env.IDENTITY_SHADOW_COMPARE_DOMAINS || '').trim();
    if (!raw) return new Set(DEFAULT_DOMAINS);
    return new Set(raw.split(',').map(s => s.trim()).filter(Boolean));
}
const ttlMs = () => {
    const n = Number.parseInt(process.env.IDENTITY_SHADOW_COMPARE_TTL_MS ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : 1000;
};
/**
 * Ventana máxima que se acepta como "propagación del dual-write". Es
 * DELIBERADAMENTE corta: el espejo escribe en el mismo tick del write JSON, así
 * que unos segundos sobran. Pasado ese plazo, que el espejo siga por detrás YA
 * NO es latencia sino divergencia real y debe reportarse como tal — si no, una
 * edición fuera de banda del JSON (script, restore) dejaría al comparador ciego
 * para siempre. `0` desactiva la gracia por completo.
 */
const staleWindowMs = () => {
    const n = Number.parseInt(process.env.IDENTITY_SHADOW_COMPARE_STALE_MS ?? '', 10);
    return Number.isFinite(n) && n >= 0 ? n : 5000;
};

// ── Estado agregado en proceso (cardinalidad acotada, sin PII) ───────────────
const MAX_SAMPLES = 20;
let STATE = freshState();
function freshState() {
    return { since: new Date().toISOString(), comparisons: 0, evaluations: 0, memoHits: 0,
        errors: 0, propagationWindowMaxAgeMs: 0, byDomain: {}, bySurface: {} };
}
function domainSlot(d) {
    if (!STATE.byDomain[d]) {
        STATE.byDomain[d] = {
            comparisons: 0, evaluations: 0,
            results: { match: 0, write_propagation: 0, expected_coverage_gap: 0,
                unexpected_divergence: 0, security_relevant_divergence: 0,
                comparator_error: 0 },
            entities: { compared: 0, match: 0, unexpected: 0, security: 0,
                stale_window: 0, gaps: {} },
            lastEvaluation: null, samples: [], staleEvaluations: 0,
        };
    }
    return STATE.byDomain[d];
}
function surfaceSlot(s) {
    if (!STATE.bySurface[s]) {
        STATE.bySurface[s] = { comparisons: 0, match: 0, write_propagation: 0,
            expected_coverage_gap: 0, unexpected_divergence: 0,
            security_relevant_divergence: 0, comparator_error: 0 };
    }
    return STATE.bySurface[s];
}
// json      = coste de la lectura OFICIAL (referencia)
// compare   = sobrecoste total del observador por lectura elegible
// evaluate  = coste de una evaluación semántica completa (subconjunto de compare)
const LAT = { json: null, compare: null, evaluate: null };
function observeLatency(key, ms) {
    if (!LAT[key]) LAT[key] = { n: 0, sum: 0, max: 0 };
    const s = LAT[key];
    s.n++; s.sum += ms; if (ms > s.max) s.max = ms;
}

// ── Memoización del veredicto por dominio ───────────────────────────────────
const MEMO = new Map();   // domain → { fingerprint, at, verdict }

function jsonFingerprint(file) {
    try {
        const st = fs.statSync(file);
        return { fp: `${st.mtimeMs}:${st.size}`, mtimeMs: st.mtimeMs };
    } catch (e) {
        return { fp: `nofile:${e.code || 'ERR'}`, mtimeMs: null };
    }
}
/**
 * Huella del espejo + detección de RETRASO. `shadow_state.last_source_seq` es
 * el mtime que tenía el JSON cuando el hook de escritura espejó esa
 * instantánea (ver `sourceVersionOf` en identityWriteHook). Si el fichero es
 * más nuevo que ese sello, el espejo todavía no ha aplicado lo que acabamos de
 * leer: no está equivocado, va por detrás. Cuesta cero: el mtime ya se leyó
 * para la huella del JSON.
 */
function sqliteFingerprint(db, domain, table, jsonMtimeMs) {
    let version = '-', lagging = false, ageMs = null;
    try {
        const row = db.prepare(
            `SELECT last_source_version, last_source_seq FROM shadow_state WHERE domain = ?`).get(domain);
        if (row) {
            version = `${row.last_source_version}:${row.last_source_seq}`;
            const grace = staleWindowMs();
            // Gate 1 — sin sello de espejo o sin mtime NO hay gracia: se
            //           clasifica como divergencia real (fail hacia reportar).
            if (grace > 0 && jsonMtimeMs !== null && Number.isFinite(row.last_source_seq)) {
                // Gate 2 — el JSON es efectivamente más nuevo que lo espejado.
                //           Ambos lados son el MISMO reloj (mtime del fichero:
                //           `sourceVersionOf` sella `statSync(file).mtimeMs` al
                //           escribir), así que esta comparación no cruza relojes.
                const newer = jsonMtimeMs > row.last_source_seq;
                // Gate 3 — y la escritura es RECIENTE. Aquí sí se cruza el reloj
                //           de pared con el del sistema de ficheros; en el mismo
                //           host es la misma fuente. Una edad NEGATIVA (mtime en
                //           el futuro) solo puede ser desfase de reloj: NO se
                //           concede gracia, se reporta como divergencia.
                ageMs = Date.now() - jsonMtimeMs;
                lagging = newer && ageMs >= 0 && ageMs <= grace;
            }
        }
    } catch { /* dominio sin estado de espejo: la cardinalidad basta */ }
    let count = -1;
    try { count = db.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c; } catch { /* tabla ausente */ }
    return { fp: `${version}#${count}`, lagging, ageMs };
}

// ── Políticas de ausencia (delegadas a las MISMAS reglas del espejo) ─────────
function makeAbsencePolicy(db, projectUsers, projectGroups, at) {
    const excluded = (entity) => {
        try {
            return new Set(db.prepare(
                `SELECT reference_hash FROM migration_exclusions WHERE entity = ?`).all(entity)
                .map(r => r.reference_hash));
        } catch { return new Set(); }
    };
    let tombs = new Set();
    try {
        tombs = new Set(db.prepare(`SELECT legacy_identity_hash FROM identity_tombstones`).all()
            .map(r => r.legacy_identity_hash));
    } catch { /* sin tabla: ninguna ausencia se explicará por tombstone */ }
    const exclUsers = excluded('user');
    const exclGroups = excluded('group');

    return {
        /** @returns {{gap:string, policy:string}|null} null ⇒ ausencia NO explicada */
        user(record) {
            const id = String(record?.id ?? '');
            if (record?._loadtest_marker) return { gap: GAP.SYNTHETIC_USER, policy: 'loadtest_marker' };
            if (tombs.has(h16(id))) return { gap: GAP.TOMBSTONED_IDENTITY, policy: 'tombstone' };
            if (exclUsers.has(h16(id))) return { gap: GAP.EXCLUDED_BY_DISPOSITION, policy: 'migration_exclusion' };
            const { rejected } = projectUsers([record], at, { hash: 'shadow-compare', seq: 0 });
            if (rejected.length) {
                return { gap: GAP.NOT_PROJECTABLE_BY_POLICY, policy: String(rejected[0].reason) };
            }
            return null;
        },
        group(record) {
            const id = String(record?.id ?? '');
            if (exclGroups.has(h16(id))) return { gap: GAP.LEGACY_GROUP, policy: 'migration_exclusion' };
            const { rejected } = projectGroups([record], at);
            if (rejected.length) return { gap: GAP.LEGACY_GROUP, policy: String(rejected[0].reason) };
            // Proyectable pero su institución no está registrada en el espejo:
            // misma regla que aplica mirrorSnapshotV2 antes de insertar.
            try {
                const oid = String(record?.organizationId ?? '');
                const inst = db.prepare(`SELECT 1 FROM institutions WHERE institution_id = ?`).get(oid);
                if (!inst) return { gap: GAP.LEGACY_GROUP, policy: 'institution_not_registered' };
            } catch { /* sin tabla */ }
            return null;
        },
    };
}

// ── Comparación semántica por entidad ───────────────────────────────────────
const stripCredentials = (u) => {
    const out = {};
    for (const k of Object.keys(u ?? {})) {
        if (k === 'password' || k === 'passwordHash') continue;
        out[k] = u[k];
    }
    return out;
};
const canon = (v) => {
    if (v === null || v === undefined) return 'null';
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    if (typeof v === 'object') {
        return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
};
/** Campos con diferencia semántica entre dos registros (orden de arrays de
 *  ids NO es semántico: se comparan como conjuntos). */
function divergentFields(a, b) {
    const keys = new Set([...Object.keys(a ?? {}), ...Object.keys(b ?? {})]);
    const out = [];
    for (const k of keys) {
        let x = a?.[k], y = b?.[k];
        if (Array.isArray(x) && Array.isArray(y)
            && x.every(e => typeof e === 'string') && y.every(e => typeof e === 'string')) {
            x = [...x].sort(); y = [...y].sort();
        }
        if (canon(x) !== canon(y)) out.push(k);
    }
    return out;
}

/**
 * Conserva las muestras MÁS GRAVES vistas por el dominio a lo largo de TODAS
 * las evaluaciones. Sustituir el muestrario en cada evaluación borraba la
 * evidencia de una divergencia transitoria en cuanto la siguiente evaluación
 * salía limpia — justo lo que hay que poder mirar. Defecto detectado por el
 * image canary de 02C-B.
 */
const BULK_SAMPLE_SLOTS = 6;
/**
 * Prioridad de retención. Los gaps de volumen (400 sintéticos, 16 grupos
 * legacy) son informativos pero repetitivos: no pueden ocupar el muestrario y
 * dejar fuera la única muestra que hay que mirar.
 *   0 = divergencia real (error/seguridad/inesperada)
 *   1 = diferencia atribuida a la ventana de propagación (conserva su forma)
 *   2 = gap de volumen
 */
function retentionRank(s) {
    if (s.class === RESULT.WRITE_PROPAGATION) return 1;
    if (s.class !== RESULT.EXPECTED_COVERAGE_GAP) return 0;
    return 2;
}
function retainSamples(slot, incoming) {
    for (const s of incoming) {
        const stamped = { ...s, at: new Date().toISOString() };
        const rank = retentionRank(stamped);
        if (rank === 2) {
            const bulk = slot.samples.filter(x => retentionRank(x) === 2);
            if (bulk.length >= BULK_SAMPLE_SLOTS) continue;          // cupo de volumen agotado
        }
        if (slot.samples.length < MAX_SAMPLES) { slot.samples.push(stamped); continue; }
        let victim = -1, victimRank = rank;
        for (let i = 0; i < slot.samples.length; i++) {
            const r = retentionRank(slot.samples[i]);
            if (r > victimRank) { victim = i; victimRank = r; }
        }
        if (victim >= 0) slot.samples[victim] = stamped;
    }
}

/** Acumulador de una evaluación completa de un dominio. */
function makeAcc(domain) {
    const slot = domainSlot(domain);
    const acc = { result: RESULT.MATCH, compared: 0, match: 0, unexpected: 0, security: 0,
        gaps: {}, samples: [] };
    // Muestrario con PRIORIDAD: cientos de gaps esperados (400 sintéticos) no
    // pueden desplazar a la única muestra de seguridad, que es justo la que hay
    // que poder mirar. Una muestra peor siempre desaloja a una mejor.
    const addSample = (sample) => {
        if (acc.samples.length < MAX_SAMPLES) { acc.samples.push(sample); return; }
        let victim = -1, victimRank = PRECEDENCE.indexOf(sample.class);
        for (let i = 0; i < acc.samples.length; i++) {
            const r = PRECEDENCE.indexOf(acc.samples[i].class);
            if (r > victimRank) { victim = i; victimRank = r; }
        }
        if (victim >= 0) acc.samples[victim] = sample;
    };
    acc.hit = () => { acc.compared++; acc.match++; };
    acc.gap = (gapClass, ref, policy) => {
        acc.compared++;
        acc.gaps[gapClass] = (acc.gaps[gapClass] ?? 0) + 1;
        acc.result = worst(acc.result, RESULT.EXPECTED_COVERAGE_GAP);
        // De un gap de volumen bastan unas pocas muestras: son todas iguales.
        if (acc.gaps[gapClass] <= 3) {
            addSample({ class: RESULT.EXPECTED_COVERAGE_GAP, gap: gapClass, ref, policy });
        }
    };
    acc.bad = (kind, ref, fields, security) => {
        acc.compared++;
        const cls = security ? RESULT.SECURITY_RELEVANT_DIVERGENCE : RESULT.UNEXPECTED_DIVERGENCE;
        if (security) acc.security++; else acc.unexpected++;
        acc.result = worst(acc.result, cls);
        addSample({ class: cls, kind, ref, fields: fields ? fields.slice(0, 6) : undefined });
    };
    /**
     * @param {{stale?:boolean}} extra  `stale` ⇒ el espejo aún no ha aplicado la
     * instantánea JSON que acabamos de leer: toda diferencia se atribuye a la
     * ventana de propagación, se cuenta aparte y NO se declara divergencia real.
     */
    acc.flush = (extra) => {
        const stale = !!extra?.stale;
        slot.evaluations++;
        slot.entities.compared += acc.compared;
        slot.entities.match += acc.match;
        if (stale) {
            slot.staleEvaluations++;
            const moved = acc.unexpected + acc.security;
            slot.entities.stale_window += moved;
            if (moved > 0) {
                acc.result = RESULT.WRITE_PROPAGATION;        // clase propia, nunca MATCH
                for (const s of acc.samples) {
                    if (s.class === RESULT.UNEXPECTED_DIVERGENCE
                        || s.class === RESULT.SECURITY_RELEVANT_DIVERGENCE) {
                        s.shape = s.class;                    // se conserva la forma original
                        s.class = RESULT.WRITE_PROPAGATION;
                    }
                }
            }
        } else {
            slot.entities.unexpected += acc.unexpected;
            slot.entities.security += acc.security;
        }
        for (const [g, n] of Object.entries(acc.gaps)) {
            slot.entities.gaps[g] = (slot.entities.gaps[g] ?? 0) + n;
            try { mEnt.labels(domain, g).inc(n); } catch { /* métricas jamás rompen */ }
        }
        slot.lastEvaluation = { at: new Date().toISOString(), ...extra, result: acc.result };
        retainSamples(slot, acc.samples);
        return acc.result;
    };
    return acc;
}

// ── Evaluadores por dominio ─────────────────────────────────────────────────
function evalUsers(officialArray, repo, policy, stale) {
    const acc = makeAcc('users');
    const json = Array.isArray(officialArray) ? officialArray : [];
    const shadow = repo.users.all();
    const shadowById = new Map(shadow.map(u => [String(u?.id ?? ''), u]));
    const jsonIds = new Set();
    for (const rec of json) {
        const id = String(rec?.id ?? '');
        jsonIds.add(id);
        const s = shadowById.get(id);
        if (!s) {
            const p = policy.user(rec);
            if (p) acc.gap(p.gap, h16(id), p.policy);
            else acc.bad('MISSING_IN_SQLITE', h16(id), null, false);
            continue;
        }
        const fields = divergentFields(stripCredentials(rec), s);
        if (!fields.length) { acc.hit(); continue; }
        acc.bad('FIELD_DIVERGENCE', h16(id), fields, fields.some(f => AUTHZ_FIELDS_USER.has(f)));
    }
    // Identidad presente SOLO en el espejo: podría CONCEDER acceso ⇒ seguridad.
    for (const id of shadowById.keys()) {
        if (!jsonIds.has(id)) acc.bad('EXTRA_IN_SQLITE', h16(id), null, true);
    }
    // Gap estructural del dominio: el espejo nunca guarda credenciales, así que
    // la autoridad de login no puede servirse desde él (una entrada por
    // evaluación, no por usuario).
    acc.gap(GAP.CREDENTIAL_AUTHORITY, 'domain:users', 'credential_excluded');
    return acc.flush({ jsonCount: json.length, sqliteCount: shadow.length, stale });
}

function evalGroups(officialArray, repo, policy, stale) {
    const acc = makeAcc('groups');
    const json = Array.isArray(officialArray) ? officialArray : [];
    const shadow = repo.groups.all();
    const shadowById = new Map(shadow.map(g => [String(g?.id ?? ''), g]));
    const jsonIds = new Set();
    for (const rec of json) {
        const id = String(rec?.id ?? '');
        jsonIds.add(id);
        const s = shadowById.get(id);
        if (!s) {
            const p = policy.group(rec);
            if (p) acc.gap(p.gap, h16(id), p.policy);
            else acc.bad('MISSING_IN_SQLITE', h16(id), null, false);
            continue;
        }
        const fields = divergentFields(rec, s);
        if (!fields.length) { acc.hit(); continue; }
        acc.bad('FIELD_DIVERGENCE', h16(id), fields, fields.some(f => AUTHZ_FIELDS_GROUP.has(f)));
    }
    for (const id of shadowById.keys()) {
        if (!jsonIds.has(id)) acc.bad('EXTRA_IN_SQLITE', h16(id), null, true);
    }
    return acc.flush({ jsonCount: json.length, sqliteCount: shadow.length, stale });
}

/** Membresías: se derivan del MISMO array de grupos que acaba de leerse. */
function evalMemberships(officialArray, db, repo, projectGroups, projectMemberships, policy, at, stale) {
    const acc = makeAcc('memberships');
    const json = Array.isArray(officialArray) ? officialArray : [];
    const proj = projectGroups(json, at);
    const eligible = proj.rows.filter(r => !policy.group(json.find(g => String(g?.id) === r.group_id) ?? {}));
    let knownUsers = new Set();
    try {
        knownUsers = new Set(db.prepare(`SELECT canonical_id FROM users WHERE deleted_at IS NULL`)
            .all().map(r => r.canonical_id));
    } catch { /* sin tabla */ }
    const expected = projectMemberships(eligible, json, knownUsers, at);
    const expKeys = new Map(expected.rows.map(m => [`${m.group_id}|${m.user_id}|${m.role}`, m]));
    let shadow = [];
    try {
        shadow = db.prepare(`SELECT user_id, group_id, institution_id, role, status FROM memberships`).all();
    } catch { /* sin tabla */ }
    const seen = new Set();
    for (const m of shadow) {
        const key = `${m.group_id}|${m.user_id}|${m.role}`;
        if (seen.has(key)) { acc.bad('DUPLICATE_IN_SQLITE', h16(key), null, true); continue; }
        seen.add(key);
        const e = expKeys.get(key);
        // Membresía que solo existe en el espejo ⇒ podría conceder scope de grupo.
        if (!e) { acc.bad('EXTRA_IN_SQLITE', h16(key), null, true); continue; }
        if (e.institution_id !== m.institution_id || m.status !== 'active') {
            acc.bad('FIELD_DIVERGENCE', h16(key), ['institution_id/status'], true); continue;
        }
        acc.hit();
    }
    for (const key of expKeys.keys()) {
        // Falta en el espejo una membresía de un grupo elegible: no hay política
        // que lo explique (el grupo sí se espeja) ⇒ divergencia, dirección negar.
        if (!seen.has(key)) acc.bad('MISSING_IN_SQLITE', h16(key), null, false);
    }
    return acc.flush({ jsonCount: expKeys.size, sqliteCount: shadow.length, stale });
}

function evalInstitutions(officialArray, repo, stale) {
    const acc = makeAcc('institutions');
    const json = Array.isArray(officialArray) ? officialArray : [];
    let shadow = [];
    try { shadow = repo.institutions ? repo.institutions.all() : []; } catch { shadow = []; }
    const shadowById = new Map(shadow.map(i => [String(i.institution_id), i]));
    const jsonIds = new Set();
    for (const rec of json) {
        const id = String(rec?.id ?? '');
        jsonIds.add(id);
        const s = shadowById.get(id);
        if (!s) {
            // El espejo solo registra instituciones referenciadas por el padrón
            // canónico; una institución JSON sin espejo no tiene política previa.
            acc.bad('MISSING_IN_SQLITE', h16(id), null, false);
            continue;
        }
        const nameOk = String(s.official_name) === String(rec?.name ?? '').trim();
        const activeOk = s.status === 'active';
        if (nameOk && activeOk) { acc.hit(); continue; }
        acc.bad('FIELD_DIVERGENCE', h16(id), [!nameOk ? 'official_name' : 'status'], !activeOk);
    }
    for (const id of shadowById.keys()) {
        if (!jsonIds.has(id)) acc.bad('EXTRA_IN_SQLITE', h16(id), null, true);
    }
    return acc.flush({ jsonCount: json.length, sqliteCount: shadow.length, stale });
}

function evalAccess(officialArray, repo, stale) {
    const acc = makeAcc('access');
    const json = Array.isArray(officialArray) ? officialArray : [];
    let shadow = [];
    try { shadow = repo.access.all(); } catch { shadow = []; }
    const shadowById = new Map(shadow.map(r => [String(r?.id ?? ''), r]));
    const jsonIds = new Set();
    for (const rec of json) {
        const id = String(rec?.id ?? '');
        jsonIds.add(id);
        const s = shadowById.get(id);
        if (!s) {
            // GAP-4: el dominio access no tiene backfill; el espejo solo recibe
            // reglas al escribirlas. Su ausencia es política conocida.
            acc.gap(GAP.ACCESS_RULES, h16(id), 'domain_not_backfilled');
            continue;
        }
        const fields = divergentFields(rec, s);
        if (!fields.length) { acc.hit(); continue; }
        acc.bad('FIELD_DIVERGENCE', h16(id), fields, true);   // toda regla es authz
    }
    for (const id of shadowById.keys()) {
        if (!jsonIds.has(id)) acc.bad('EXTRA_IN_SQLITE', h16(id), null, true);
    }
    return acc.flush({ jsonCount: json.length, sqliteCount: shadow.length, stale });
}

// ── Entrada pública ─────────────────────────────────────────────────────────
let _mods = null;                       // módulos ESM precargados en warmup
const _domainOf = (file, paths) => {
    if (!paths) return null;
    if (file === paths.usersDb) return 'users';
    if (file === paths.groupsDb) return 'groups';
    if (file === paths.accessDb) return 'access';
    if (file === paths.schoolsDb) return 'institutions';
    return null;
};

/**
 * Precarga perezosa de los módulos ESM del espejo. Solo si el comparador está
 * encendido; si falla, el comparador queda inerte (nunca rompe el arranque).
 * @returns {Promise<boolean>} true si quedó armado.
 */
export async function warmupShadowCompare() {
    if (!shadowCompareEnabled()) return false;
    try {
        const [dbMod, repoMod, projMod] = await Promise.all([
            import('./identityDb.js'),
            import('../repositories/identityRepo.js'),
            import('./identityShadowV2.js'),
        ]);
        _mods = {
            getIdentityDb: dbMod.getIdentityDb,
            makeIdentityRepo: repoMod.makeIdentityRepo,
            projectUsers: projMod.projectUsers,
            projectGroups: projMod.projectGroups,
            projectMemberships: projMod.projectMemberships,
        };
        return true;
    } catch {
        _mods = null;
        return false;
    }
}

/**
 * Observa una lectura de identidad y compara contra el espejo. NUNCA lanza,
 * NUNCA muta `officialArray`, NUNCA devuelve datos: solo contabiliza.
 *
 * @param {string} file          store leído
 * @param {*}      officialArray resultado OFICIAL ya calculado desde JSON
 * @param {{usersDb:string,groupsDb:string,accessDb:string,schoolsDb?:string}} paths
 * @param {{surface?:string, jsonMs?:number}} [opts]
 * @returns {void}
 */
export function observeIdentityShadowRead(file, officialArray, paths, opts = {}) {
    if (!shadowCompareEnabled()) return;                   // OFF ⇒ coste ~0
    const surface = opts.surface || 'seam';
    let domain = null;
    try {
        domain = _domainOf(file, paths);
        if (!domain) return;
        const domains = shadowCompareDomains();
        if (!domains.has(domain)) return;
        if (!_mods) return;                                 // sin warmup ⇒ inerte

        const t0 = performance.now();
        const db = _mods.getIdentityDb();
        const table = domain === 'users' ? 'users'
            : domain === 'groups' ? 'groups'
            : domain === 'access' ? 'access_rules' : 'institutions';
        const now = Date.now();
        const memo = MEMO.get(domain);
        let verdict;
        if (memo && (now - memo.at) < ttlMs()) {
            verdict = memo.verdict;                          // dentro de la ventana
            STATE.memoHits++;
        } else {
            const jf = jsonFingerprint(file);
            const sf = sqliteFingerprint(db, domain, table, jf.mtimeMs);
            const fp = `${jf.fp}|${sf.fp}`;
            if (memo && memo.fingerprint === fp && !sf.lagging) {
                verdict = memo.verdict;                      // fuentes intactas y asentadas
                MEMO.set(domain, { fingerprint: fp, at: now, verdict });
                STATE.memoHits++;
            } else {
                const tEval = performance.now();
                const repo = _mods.makeIdentityRepo(db);
                const at = new Date(0).toISOString();        // proyección determinista
                const policy = makeAbsencePolicy(db, _mods.projectUsers, _mods.projectGroups, at);
                const stale = sf.lagging;
                if (stale) STATE.propagationWindowMaxAgeMs =
                    Math.max(STATE.propagationWindowMaxAgeMs ?? 0, sf.ageMs ?? 0);
                verdict = domain === 'users' ? evalUsers(officialArray, repo, policy, stale)
                    : domain === 'groups' ? evalGroups(officialArray, repo, policy, stale)
                    : domain === 'access' ? evalAccess(officialArray, repo, stale)
                    : evalInstitutions(officialArray, repo, stale);
                STATE.evaluations++;
                // Un veredicto tomado con el espejo retrasado NO se memoiza: la
                // siguiente lectura debe volver a mirar cuando ya haya asentado.
                if (stale) MEMO.delete(domain);
                else MEMO.set(domain, { fingerprint: fp, at: now, verdict });

                // Membresías: derivadas del MISMO array de grupos ya leído.
                if (domain === 'groups' && shadowCompareDomains().has('memberships')) {
                    const mv = evalMemberships(officialArray, db, repo, _mods.projectGroups,
                        _mods.projectMemberships, policy, at, stale);
                    STATE.evaluations++;
                    const ms = domainSlot('memberships');
                    ms.comparisons++; ms.results[mv]++;
                    try { mCmp.labels('memberships', surface, mv).inc(); } catch {}
                }
                observeLatency('evaluate', performance.now() - tEval);
            }
        }
        const dt = performance.now() - t0;
        observeLatency('compare', dt);
        if (typeof opts.jsonMs === 'number') observeLatency('json', opts.jsonMs);

        STATE.comparisons++;
        const slot = domainSlot(domain);
        slot.comparisons++;
        slot.results[verdict]++;
        const surf = surfaceSlot(surface);
        surf.comparisons++; surf[verdict]++;
        try { mCmp.labels(domain, surface, verdict).inc(); } catch {}
        try { mDur.labels(domain).observe(dt / 1000); } catch {}
    } catch (e) {
        // Cualquier fallo del comparador es UN CONTADOR, jamás una excepción.
        try {
            STATE.errors++;
            STATE.comparisons++;
            const d = domain || 'unknown';
            const slot = domainSlot(d);
            slot.comparisons++;
            slot.results.comparator_error++;
            if (slot.samples.length < MAX_SAMPLES) {
                slot.samples.push({ class: RESULT.COMPARATOR_ERROR, kind: String(e?.message || 'error').slice(0, 80) });
            }
            const surf = surfaceSlot(surface);
            surf.comparisons++; surf.comparator_error++;
            mCmp.labels(d, surface, RESULT.COMPARATOR_ERROR).inc();
            MEMO.delete(domain);
        } catch { /* ni siquiera contabilizar puede romper una lectura */ }
    }
}

/** Instantánea agregada para la ruta operacional. Sin PII. */
export function getShadowCompareSnapshot() {
    const lat = {};
    for (const [k, v] of Object.entries(LAT)) {
        if (v && v.n) lat[k] = { n: v.n, avg_ms: +(v.sum / v.n).toFixed(4), max_ms: +v.max.toFixed(4) };
    }
    const gapsOutsideApproved = [];
    let staleEvaluations = 0, staleEntities = 0;
    for (const [d, s] of Object.entries(STATE.byDomain)) {
        staleEvaluations += s.staleEvaluations ?? 0;
        staleEntities += s.entities.stale_window ?? 0;
        for (const g of Object.keys(s.entities.gaps)) {
            if (!APPROVED_GAPS.includes(g)) gapsOutsideApproved.push(`${d}:${g}`);
        }
    }
    return {
        version: SHADOW_COMPARE_VERSION,
        enabled: shadowCompareEnabled(),
        domains: [...shadowCompareDomains()],
        ttl_ms: ttlMs(),
        // Contrato de la ventana de propagación, publicado para que la
        // telemetría se pueda auditar sin leer el código.
        propagation: {
            threshold_ms: staleWindowMs(),
            bounded: true,
            max_observed_age_ms: STATE.propagationWindowMaxAgeMs ?? 0,
            clock: 'file mtime (mismo reloj que shadow_state.last_source_seq); edad negativa ⇒ sin gracia',
            beyond_threshold: 'unexpected_divergence',
        },
        official_read_backend: 'json',
        official_sqlite_responses: 0,
        since: STATE.since,
        totals: { comparisons: STATE.comparisons, evaluations: STATE.evaluations,
            memo_hits: STATE.memoHits, comparator_errors: STATE.errors,
            // Evaluaciones tomadas mientras el espejo iba por detrás del JSON
            // recién escrito: sus diferencias se atribuyen a la propagación del
            // dual-write, no al espejo. Se cura sola.
            stale_mirror_evaluations: staleEvaluations,
            stale_mirror_entities: staleEntities },
        byDomain: STATE.byDomain,
        bySurface: STATE.bySurface,
        latency: lat,
        gaps_outside_approved: gapsOutsideApproved,
    };
}

/** Solo para pruebas: reinicia agregados y memo. */
export function __resetShadowCompare() {
    STATE = freshState();
    MEMO.clear();
    for (const k of Object.keys(LAT)) LAT[k] = null;
}
/** Solo para pruebas: inyecta los módulos sin pasar por warmup. */
export function __setShadowCompareModules(m) { _mods = m; }
