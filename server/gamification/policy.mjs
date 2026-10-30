/**
 * policy.mjs — CHP-GAMIFICACION-G3-02.
 *
 * Política de emisión del lado del servidor. Módulo PURO (sin disco): valida
 * conjuntos de reglas y decide, para un hecho ya elegible, qué XP y PM le
 * corresponden según las reglas vigentes y el consumo de topes del usuario.
 *
 * Nadie más fija montos: `ledger.recordFact` no acepta xp/pm/grado/decisión del
 * llamador; los toma de aquí dentro de la misma transacción `IMMEDIATE`, así
 * que dos réplicas no pueden exceder un tope.
 *
 * Las cifras viven en `gm_rule_sets` (CONFIGURABLE). Ninguna está aprobada como
 * tarifa: los valores de las pruebas son ilustrativos.
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
 * G4-04. Bloqueos por código, por encima de cualquier regla:
 *  - lectura libre y ruta MOOK nunca dan PM: no demuestran comprensión (A1);
 *  - una misión es institucional: nunca da PM personales (D38);
 *  - revisión y validación necesitan cobertura verificable de obra y ciclo, que
 *    aún no existe. Sin ella no se puede aplicar la unicidad de PM ni el techo de
 *    XP por obra (A4), así que tampoco dan XP. Se registran como `observed`.
 */
export const PM_LOCKED_SOURCES = Object.freeze(['reading_completion', 'mook_experience', 'mission', 'mook_review', 'offline_validation']);
export const XP_LOCKED_SOURCES = Object.freeze(['reading_completion', 'mook_review', 'offline_validation']);

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
 * Valida un conjunto de reglas. Estructura:
 * {
 *   schema: 1,
 *   facts: { "<source>/<factType>": { xp, pm, emitWhen?: { <feature>: [valores] } } },
 *   caps:  { pmPerDay, pmPerWeek, pmPerDayBySource?: { <source>: n } }
 * }
 * Los topes son OBLIGATORIOS: no existe la emisión sin techo (D13).
 * Una regla que intente emitir desde una fuente bloqueada se rechaza.
 */
export function validateRules(rules, { featureAllowlist }) {
    if (!rules || typeof rules !== 'object' || Array.isArray(rules)) throw bad('INVALID_RULES', 'objeto requerido');
    if (rules.schema !== 1) throw bad('INVALID_RULES', 'schema debe ser 1');
    const extra = Object.keys(rules).filter((k) => !['schema', 'facts', 'caps'].includes(k));
    if (extra.length) throw bad('INVALID_RULES', `claves desconocidas: ${extra.join(',')}`);
    const facts = rules.facts ?? {};
    if (typeof facts !== 'object' || Array.isArray(facts)) throw bad('INVALID_RULES', 'facts');
    for (const [key, r] of Object.entries(facts)) {
        const m = RULE_KEY_RX.exec(key);
        if (!m || !(m[1] in SOURCE_GRADE)) throw bad('INVALID_RULES', `regla de fuente desconocida: ${key}`);
        const source = m[1];
        if (!r || typeof r !== 'object') throw bad('INVALID_RULES', key);
        const rk = Object.keys(r).filter((k) => !['xp', 'pm', 'emitWhen'].includes(k));
        if (rk.length) throw bad('INVALID_RULES', `${key}: claves desconocidas ${rk.join(',')} (el grado no es configurable)`);
        if (!isAmount(r.xp ?? 0) || !isAmount(r.pm ?? 0)) throw bad('INVALID_RULES', `${key}: xp/pm enteros entre 0 y ${MAX_RULE_AMOUNT}`);
        if (LOCKED_SOURCES.includes(source) && ((r.xp ?? 0) > 0 || (r.pm ?? 0) > 0)) {
            throw bad('READING_EMISSION_LOCKED', `${key}: la lectura terminada sigue en observación`);
        }
        if (PM_LOCKED_SOURCES.includes(source) && (r.pm ?? 0) > 0) throw bad('PM_SOURCE_LOCKED', `${key}: esta fuente no puede emitir PM`);
        if (XP_LOCKED_SOURCES.includes(source) && (r.xp ?? 0) > 0) throw bad('XP_SOURCE_LOCKED', `${key}: esta fuente no puede emitir XP`);
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
    const caps = rules.caps;
    if (!caps || typeof caps !== 'object') throw bad('INVALID_RULES', 'caps obligatorio (sin emisión sin techo)');
    const ck = Object.keys(caps).filter((k) => !['pmPerDay', 'pmPerWeek', 'pmPerDayBySource'].includes(k));
    if (ck.length) throw bad('INVALID_RULES', `caps: claves desconocidas ${ck.join(',')}`);
    if (!isAmount(caps.pmPerDay) || !isAmount(caps.pmPerWeek)) throw bad('INVALID_RULES', 'caps.pmPerDay y caps.pmPerWeek obligatorios');
    if (caps.pmPerDay > caps.pmPerWeek) throw bad('INVALID_RULES', 'pmPerDay no puede superar pmPerWeek');
    for (const [s, n] of Object.entries(caps.pmPerDayBySource ?? {})) {
        if (!(s in SOURCE_GRADE) || !isAmount(n)) throw bad('INVALID_RULES', `caps.pmPerDayBySource.${s}`);
    }
    return rules;
}

/**
 * Decide la emisión de un hecho. Pura.
 * @param {object} p
 * @param {object} p.rules          conjunto vigente (ya validado)
 * @param {string} p.source
 * @param {string} p.factType
 * @param {string} p.eligibility    uno de ELIGIBILITY
 * @param {object} p.features
 * @param {boolean} p.xpEnabled
 * @param {boolean} p.pmEnabled
 * @param {{ day: number, week: number, daySource: number }} p.usage  PM `earn` ya emitidos
 * @returns {{ grade, decision, xp, pm }}
 */
export function decideEmission({ rules, source, factType, eligibility, features, xpEnabled, pmEnabled, usage }) {
    const grade = SOURCE_GRADE[source];
    const none = (decision) => ({ grade, decision, xp: 0, pm: 0 });
    if (eligibility !== 'eligible') return none(eligibility === 'observe' ? 'observed' : eligibility);
    if (LOCKED_SOURCES.includes(source)) return none('observed');
    const rule = rules.facts?.[`${source}/${factType}`];
    if (!rule) return none('rejected_not_eligible');
    for (const [f, vals] of Object.entries(rule.emitWhen ?? {})) {
        if (!vals.includes(features?.[f])) return none('observed');
    }
    // Los bloqueos valen también para un conjunto de reglas ya guardado.
    const ruleXp = XP_LOCKED_SOURCES.includes(source) ? 0 : (rule.xp ?? 0);
    const rulePm = PM_LOCKED_SOURCES.includes(source) ? 0 : (rule.pm ?? 0);
    if (XP_LOCKED_SOURCES.includes(source) && PM_LOCKED_SOURCES.includes(source)) return none('observed');
    if (!xpEnabled && !pmEnabled) return none('disabled_source');
    const xp = xpEnabled ? ruleXp : 0;
    const want = pmEnabled ? rulePm : 0;
    if (xp === 0 && want === 0 && ruleXp + rulePm > 0) return none('disabled_source');
    const caps = rules.caps;
    const bySource = caps.pmPerDayBySource?.[source];
    const room = Math.max(0, Math.min(
        caps.pmPerDay - usage.day,
        caps.pmPerWeek - usage.week,
        bySource === undefined ? Infinity : bySource - usage.daySource,
    ));
    const pm = Math.min(want, room);
    return { grade, decision: pm < want ? 'capped' : 'awarded', xp, pm };
}
