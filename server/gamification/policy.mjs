/**
 * policy.mjs — CHP-GAMIFICACION-G3-02.
 *
 * Política de emisión del lado del servidor. Módulo PURO (sin disco): valida
 * conjuntos de reglas y decide, para un hecho ya elegible, qué XP le corresponde
 * según las reglas vigentes.
 *
 * Nadie más fija montos: `ledger.recordFact` no acepta xp/grado/decisión del
 * llamador; los toma de aquí dentro de la misma transacción `IMMEDIATE`.
 *
 * V8-UNIFIED-XP-01: XP es la ÚNICA escala. Los Puntos de Magia (PM), sus topes
 * (`caps`) y su flag quedan retirados: una regla NUEVA con `pm` o `caps` se
 * rechaza (`PM_RETIRED`). Un conjunto ya guardado que los traiga (anterior a esta
 * unidad) se sigue leyendo y esos campos se ignoran: nunca emiten.
 *
 * Las cifras viven en `gm_rule_sets` (CONFIGURABLE). Los valores de las pruebas
 * son ilustrativos.
 */
import { GamificationError } from './db.mjs';

/** Grado FIJO por fuente (Doctrina §3). Las reglas no pueden subirlo. */
export const SOURCE_GRADE = Object.freeze({
    mook_review: 'A',
    mook_experience: 'B',
    reading_completion: 'B', // hasta que G4 apruebe el validador nunca es A, y hoy no emite
    offline_validation: 'B',
    mission: 'B',
});
/** Fuentes que no emiten en ningún caso todavía (READING_EMISSION_LOCKED). */
export const LOCKED_SOURCES = Object.freeze(['reading_completion']);
/**
 * G4-04. Bloqueos de XP por código, por encima de cualquier regla: la validación
 * presencial necesita cobertura verificable de obra y ciclo, que aún no existe.
 * Sin ella no se puede aplicar el techo de XP por obra (A4), así que no da XP.
 * Se registra como `observed`.
 *
 * V8-ACTIVATE-PREP-01: la revisión MOOK ya tiene esa cobertura (obra y ciclo en
 * `gm_work_cycles`) y sale de `XP_LOCKED_SOURCES`, pero SOLO por el reconocimiento
 * aprobado (`ledger.recordWorkRecognition`: `approvalRef`, techo por obra, corte,
 * acceso explícito, clave y registro). Por la vía genérica de `facts` sigue sin
 * poder dar XP: pagarla allí esquivaría el techo y el acta, y ocuparía la clave
 * del hecho que usa el reconocimiento.
 */
export const XP_LOCKED_SOURCES = Object.freeze(['reading_completion', 'offline_validation']);
/** Fuentes cuyo XP solo puede venir del reconocimiento aprobado, nunca de `facts`. */
export const XP_RECOGNITION_ONLY_SOURCES = Object.freeze(['mook_review']);
/** ¿La vía genérica (`facts`, `recordFact`) tiene prohibido dar XP a esta fuente? */
export const isXpLockedForFacts = (source) => XP_LOCKED_SOURCES.includes(source) || XP_RECOGNITION_ONLY_SOURCES.includes(source);
/** ¿Esta fuente no puede emitir nada por la vía genérica, sean cuales sean las reglas? (Solo hay XP.) */
export const isEmissionLocked = (source) => isXpLockedForFacts(source);

/** V8-UNIFIED-XP-01: claves de PM retiradas. Una regla NUEVA que las use se rechaza. */
export const RETIRED_PM_RULE_KEYS = Object.freeze(['caps']);
export const RETIRED_PM_FACT_KEYS = Object.freeze(['pm']);

export const ELIGIBILITY = Object.freeze([
    'eligible', 'observe',
    'rejected_self_review', 'rejected_excluded_user', 'rejected_inactive_account',
    'rejected_implausible', 'rejected_insufficient_data', 'rejected_not_eligible',
]);

export const MAX_RULE_AMOUNT = 10_000;
const RULE_KEY_RX = /^([a-z_]+)\/([A-Za-z0-9._-]+)$/;
const bad = (code, message) => new GamificationError(code, message);
const isAmount = (n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_RULE_AMOUNT;

/**
 * Valida un conjunto de reglas NUEVO. Estructura:
 * {
 *   schema: 1,
 *   facts: { "<source>/<factType>": { xp, emitWhen?: { <feature>: [valores] } } },
 *   recognition?: { ... }   // lo valida `ledger.createRuleSet`
 * }
 * Solo hay XP: `pm` y `caps` están retirados (PM_RETIRED). El techo del XP es el
 * techo por obra y ciclo del reconocimiento.
 * Una regla que intente emitir desde una fuente bloqueada se rechaza.
 */
export function validateRules(rules, { featureAllowlist }) {
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw bad('INVALID_RULES', 'objeto requerido');
    if (rules.schema !== 1) throw bad('INVALID_RULES', 'schema debe ser 1');
    const retired = Object.keys(rules).filter((k) => RETIRED_PM_RULE_KEYS.includes(k));
    if (retired.length) throw bad('PM_RETIRED', `los Puntos de Magia están retirados: ${retired.join(',')}`);
    // `recognition` (G4-05A-4) lo valida `ledger.createRuleSet`, junto al núcleo que lo usa.
    const extra = Object.keys(rules).filter((k) => !['schema', 'facts', 'recognition'].includes(k));
    if (extra.length) throw bad('INVALID_RULES', `claves desconocidas: ${extra.join(',')}`);
    const facts = rules.facts ?? {};
    if (typeof facts !== 'object' || Array.isArray(facts)) throw bad('INVALID_RULES', 'facts');
    for (const [key, r] of Object.entries(facts)) {
        const m = RULE_KEY_RX.exec(key);
        if (!m || !(m[1] in SOURCE_GRADE)) throw bad('INVALID_RULES', `regla de fuente desconocida: ${key}`);
        const source = m[1];
        if (!r || typeof r !== 'object') throw bad('INVALID_RULES', key);
        if (Object.keys(r).some((k) => RETIRED_PM_FACT_KEYS.includes(k))) throw bad('PM_RETIRED', `${key}: los Puntos de Magia están retirados`);
        const rk = Object.keys(r).filter((k) => !['xp', 'emitWhen'].includes(k));
        if (rk.length) throw bad('INVALID_RULES', `${key}: claves desconocidas ${rk.join(',')} (el grado no es configurable)`);
        if (!isAmount(r.xp ?? 0)) throw bad('INVALID_RULES', `${key}: xp entero entre 0 y ${MAX_RULE_AMOUNT}`);
        if (LOCKED_SOURCES.includes(source) && (r.xp ?? 0) > 0) {
            throw bad('READING_EMISSION_LOCKED', `${key}: la lectura terminada sigue en observación`);
        }
        if (isXpLockedForFacts(source) && (r.xp ?? 0) > 0) throw bad('XP_SOURCE_LOCKED', `${key}: esta fuente no puede emitir XP por facts`);
        if (r.emitWhen !== undefined) {
            if (!r.emitWhen || typeof r.emitWhen !== 'object' || Array.isArray(r.emitWhen)) throw bad('INVALID_RULES', `${key}.emitWhen`);
            const allowed = new Set(featureAllowlist[source] || []);
            for (const [f, vals] of Object.entries(r.emitWhen)) {
                if (!allowed.has(f)) throw bad('INVALID_RULES', `${key}.emitWhen: feature no admitida ${f}`);
                if (!Array.isArray(vals) || vals.length === 0 || !vals.every((v) => ['string', 'boolean', 'number'].includes(typeof v))) {
                    throw bad('INVALID_RULES', `${key}.emitWhen.${f}: lista de valores`);
                }
            }
        }
    }
    return rules;
}

/**
 * Decide la emisión de XP de un hecho. Pura.
 * Un conjunto guardado antes de V8-UNIFIED-XP-01 puede traer `pm`/`caps`: se ignoran.
 * @param {object} p
 * @param {object} p.rules          conjunto vigente
 * @param {string} p.source
 * @param {string} p.factType
 * @param {string} p.eligibility    uno de ELIGIBILITY
 * @param {object} p.features
 * @param {boolean} p.xpEnabled
 * @returns {{ grade, decision, xp }}
 */
export function decideEmission({ rules, source, factType, eligibility, features, xpEnabled }) {
    const grade = SOURCE_GRADE[source];
    const none = (decision) => ({ grade, decision, xp: 0 });
    if (eligibility !== 'eligible') return none(eligibility === 'observe' ? 'observed' : eligibility);
    if (LOCKED_SOURCES.includes(source)) return none('observed');
    const rule = rules.facts?.[`${source}/${factType}`];
    if (!rule) return none('rejected_not_eligible');
    for (const [f, vals] of Object.entries(rule.emitWhen ?? {})) {
        if (!vals.includes(features?.[f])) return none('observed');
    }
    // Los bloqueos valen también para un conjunto de reglas ya guardado.
    if (isEmissionLocked(source)) return none('observed');
    if (!xpEnabled) return none('disabled_source');
    const xp = isAmount(rule.xp) ? rule.xp : 0;
    return { grade, decision: 'awarded', xp };
}
