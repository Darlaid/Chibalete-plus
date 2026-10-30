/**
 * recognition.mjs — CHP-GAMIFICACION-G4-03.
 *
 * Núcleo PURO del reconocimiento lector: clasifica evidencia, decide
 * elegibilidad para XP y PM con motivos explícitos, limita lo reconocible por
 * obra y ciclo, deriva el nivel y evalúa logros. Contrato:
 * docs/gamificacion/GAMIFICACION_G4_RECONOCIMIENTO_LECTOR_V1.md.
 *
 * Sin disco, sin reloj, sin azar, sin entorno y sin persistencia: el historial
 * y la hora llegan como argumentos y el resultado se devuelve al llamador. No
 * importa el ledger ni la política (`policy.mjs` arrastra `db.mjs` y SQLite);
 * nada del producto llama a este módulo todavía.
 *
 * Decisiones aprobadas que implementa:
 *  - A1: la finalización de lectura por sí sola nunca genera PM.
 *  - A2: el recorrido es grado B y no demuestra comprensión.
 *  - A3: ni tiempo ni velocidad participan en ninguna decisión.
 *  - A4: XP con flag propio y techo por obra y ciclo.
 *  - A8: nivel = XP + obras distintas + reflexiones; primeros niveles sin reflexión.
 *
 * Lo que sigue sin aprobar queda SIN emisión comercial: `mook_experience` no da
 * PM y `con_comentarios` no se reconoce (A5 y A6 pendientes).
 *
 * Privacidad: la modalidad solo se lee aquí de forma transitoria. Ninguna
 * entrada resultante la contiene: `a11y` no debe ser un rasgo duradero.
 *
 * Todas las cantidades vienen de la configuración: este módulo no tiene valores
 * por defecto, y sin configuración válida no reconoce nada.
 */
import { MODE_INSTRUMENTATION } from './readingValidator.mjs';

export const RECOGNITION_RULE_VERSION = 'rv-recognition-v1';

/** Cota técnica contra errores de configuración, como MAX_RULE_AMOUNT. No es una tarifa. */
export const MAX_CONFIG_AMOUNT = 10_000;

/** A8: cuántos niveles iniciales no pueden exigir reflexión. */
export const MIN_LEVELS_WITHOUT_REFLECTION = 2;

export const LAYERS = Object.freeze({
    CANONICAL_PROGRESS: 'canonical_progress',
    TRAVERSAL: 'traversal',
    COMPREHENSION: 'comprehension',
    VALIDATED_ACTIVITY: 'validated_activity',
    ROUTE: 'route',
    EXCLUDED: 'excluded',
});

/** Fuentes reconocibles. Los grados deben coincidir con SOURCE_GRADE de policy.mjs (hay prueba). */
const SOURCES = Object.freeze({
    reading_completion: { grade: 'B' },
    mook_review: { grade: 'A' },
    mook_experience: { grade: 'B' },
    offline_validation: { grade: 'B' },
});

/** Señales que nunca se recompensan, cada una con su motivo. */
export const EXCLUDED_SIGNALS = Object.freeze({
    screen_time: { grade: 'D', reason: 'screen_time_never_rewarded' },
    reading_speed: { grade: 'D', reason: 'speed_never_rewarded' },
    clicks: { grade: 'D', reason: 'clicks_never_rewarded' },
    immersive_block: { grade: 'D', reason: 'immersive_block_never_rewarded' },
    audio_playback: { grade: 'D', reason: 'playback_never_rewarded' },
    video_playback: { grade: 'D', reason: 'playback_never_rewarded' },
    client_percentage: { grade: null, reason: 'client_percentage_is_a_claim', layer: LAYERS.CANONICAL_PROGRESS },
    manual_progress: { grade: null, reason: 'client_percentage_is_a_claim', layer: LAYERS.CANONICAL_PROGRESS },
    mook_reading_node: { grade: 'D', reason: 'mook_node_click_is_not_reading' },
    mook_activity: { grade: 'D', reason: 'unverified_activity_answers' },
    private_journal: { grade: null, reason: 'private_journal_not_evaluable' },
    leo_activity: { grade: 'C', reason: 'ai_never_rewarded' },
    ai_text: { grade: 'C', reason: 'ai_never_rewarded' },
    orality_score: { grade: 'C', reason: 'orality_score_is_client_side' },
    qrs: { grade: null, reason: 'economic_signal_never_rewarded' },
});

const VERDICT_REASON = Object.freeze({
    implausible: 'traversal_not_plausible',
    insufficient_data: 'traversal_insufficient',
});

const isId = (v) => typeof v === 'string' && v.length > 0;
const isAmount = (n) => Number.isSafeInteger(n) && n >= 0 && n <= MAX_CONFIG_AMOUNT;
const isFactorList = (list) => Array.isArray(list)
    && list.every((f, i) => Number.isFinite(f) && f >= 0 && f < 1 && (i === 0 || f <= list[i - 1]));
const BOGOTA_OFFSET_MS = 5 * 3_600_000;
const bogotaDay = (ms) => Math.floor((ms - BOGOTA_OFFSET_MS) / 86_400_000);

/** `accessible` es el id legado del Modo Guiado (utils/readerMode.ts). */
const normalizeModality = (m) => (m === 'accessible' ? 'text' : m);

/**
 * Clasificación según fuente y modalidad. La modalidad solo decide si existe
 * telemetría de recorrido: nunca el valor del reconocimiento.
 */
export function classifyEvidence(evidence) {
    const source = evidence?.source;
    const excluded = typeof source === 'string' && Object.hasOwn(EXCLUDED_SIGNALS, source) ? EXCLUDED_SIGNALS[source] : null;
    if (excluded) {
        return { known: false, source, layer: excluded.layer ?? LAYERS.EXCLUDED, grade: excluded.grade, demonstratesComprehension: false,
            traversalObservable: false, reason: excluded.reason };
    }
    if (typeof source !== 'string' || !Object.hasOwn(SOURCES, source)) {
        return { known: false, source: null, layer: LAYERS.EXCLUDED, grade: null, demonstratesComprehension: false,
            traversalObservable: false, reason: 'unknown_source' };
    }
    const { grade } = SOURCES[source];
    const base = { known: true, source, grade, demonstratesComprehension: false, traversalObservable: false };
    if (source === 'reading_completion') {
        const modality = normalizeModality(evidence.modality);
        const knownModality = typeof modality === 'string' && Object.hasOwn(MODE_INSTRUMENTATION, modality);
        return { ...base, layer: LAYERS.TRAVERSAL, traversalObservable: knownModality && MODE_INSTRUMENTATION[modality] === true };
    }
    if (source === 'mook_experience') return { ...base, layer: LAYERS.ROUTE };
    if (source === 'mook_review') {
        const approved = evidence.decision === 'aprobado';
        return { ...base, layer: approved ? LAYERS.COMPREHENSION : LAYERS.VALIDATED_ACTIVITY, demonstratesComprehension: approved };
    }
    const shows = evidence.demonstratesComprehension === true; // offline_validation
    return { ...base, layer: shows ? LAYERS.COMPREHENSION : LAYERS.VALIDATED_ACTIVITY, demonstratesComprehension: shows };
}

function subjectBlock(subject) {
    if (!subject || subject.exists !== true) return 'subject_unknown';
    if (subject.synthetic === true) return 'subject_synthetic';
    if (subject.active !== true) return 'subject_inactive';
    return null;
}

/** Motivos estructurales: el hecho no se puede evaluar. */
function structuralBlocks(evidence, cls) {
    const blocks = [];
    if (!isId(evidence?.userId)) blocks.push('missing_user');
    if (!isId(evidence?.evidenceId)) blocks.push('missing_evidence_id');
    if (!Number.isSafeInteger(evidence?.at) || evidence.at <= 0) blocks.push('invalid_at');
    if (cls.source !== 'mook_experience' && !isId(evidence?.workRef)) blocks.push('no_work_coverage');
    if (cls.source === 'mook_review' || cls.source === 'offline_validation') {
        if (!isId(evidence?.actorId)) blocks.push('human_actor_required');
        else if (evidence.actorId === evidence.userId) blocks.push('self_review');
    }
    return blocks;
}

/**
 * Elegibilidad para XP y PM, sin historial ni montos. `eligible` no significa
 * «se concede»: lo limitan después el ciclo, el techo, los flags y los topes.
 */
export function assessEligibility(evidence, subject) {
    const cls = classifyEvidence(evidence);
    const no = (reason) => ({ eligible: false, reasons: [reason] });
    const both = (reasons) => ({ classification: cls, xp: { eligible: false, reasons }, pm: { eligible: false, reasons }, alternativeRouteOpen: false });
    if (!cls.known) return both([cls.reason]);
    const blocked = [subjectBlock(subject), ...structuralBlocks(evidence, cls)].filter(Boolean);
    if (blocked.length) return both(blocked);

    const yes = { eligible: true, reasons: [] };
    if (cls.source === 'reading_completion') {
        const pm = no('reading_alone_never_pm'); // A1
        const { verdict } = evidence;
        if (verdict === 'plausible') {
            if (!cls.traversalObservable) return { classification: cls, xp: no('modality_without_traversal_evidence'), pm, alternativeRouteOpen: true };
            return { classification: cls, xp: yes, pm, alternativeRouteOpen: true };
        }
        return { classification: cls, xp: no(VERDICT_REASON[verdict] ?? 'invalid_verdict'), pm, alternativeRouteOpen: true };
    }
    if (cls.source === 'mook_experience') {
        return { classification: cls, xp: yes, pm: no('route_completion_not_comprehension'), alternativeRouteOpen: false };
    }
    if (cls.source === 'mook_review') {
        if (evidence.decision === 'aprobado') return { classification: cls, xp: yes, pm: yes, alternativeRouteOpen: false };
        return both([evidence.decision === 'con_comentarios' ? 'con_comentarios_pending_decision' : 'invalid_decision']);
    }
    if (cls.demonstratesComprehension) return { classification: cls, xp: yes, pm: yes, alternativeRouteOpen: false };
    return { classification: cls, xp: yes, pm: no('validated_activity_not_comprehension'), alternativeRouteOpen: false };
}

/**
 * Valida la configuración de reconocimiento. Forma:
 * {
 *   amounts: { xp: { reading, reflection, validated, route }, pm: { reviewed, validated } },
 *   xpCeilingPerWorkCycle,
 *   reread: { windowDays, xpFactors: [ρ₂, ρ₃…], pmFactors: [ρ_PM₂…] }
 * }
 * El techo y el espaciado son obligatorios: no existe XP sin techo por obra.
 */
export function validateRecognitionConfig(config) {
    const errors = [];
    const xp = config?.amounts?.xp;
    const pm = config?.amounts?.pm;
    for (const k of ['reading', 'reflection', 'validated', 'route']) if (!isAmount(xp?.[k])) errors.push(`amounts.xp.${k}`);
    for (const k of ['reviewed', 'validated']) if (!isAmount(pm?.[k])) errors.push(`amounts.pm.${k}`);
    if (!isAmount(config?.xpCeilingPerWorkCycle)) errors.push('xpCeilingPerWorkCycle');
    const reread = config?.reread;
    if (!Number.isSafeInteger(reread?.windowDays) || reread.windowDays < 1) errors.push('reread.windowDays');
    if (!isFactorList(reread?.xpFactors)) errors.push('reread.xpFactors');
    if (!isFactorList(reread?.pmFactors)) errors.push('reread.pmFactors');
    return { ok: errors.length === 0, errors };
}

function outcomeOf(outcome, cls, reasons, extra = {}) {
    return { outcome, source: cls?.source ?? null, layer: cls?.layer ?? LAYERS.EXCLUDED, grade: cls?.grade ?? null, cycle: null,
        xp: 0, pm: 0, entries: [], reasons, alternativeRouteOpen: false, ruleVersion: RECOGNITION_RULE_VERSION, ...extra };
}

/** Ciclo al que pertenece la evidencia. Solo una relectura espaciada abre uno nuevo. */
function resolveCycle(workEntries, evidence, reread) {
    const last = workEntries.reduce((m, e) => Math.max(m, e.cycle), 0);
    if (last === 0) return { cycle: 1, notes: [] };
    if (evidence.newTraversal !== true) return { cycle: last, notes: [] };
    const current = workEntries.filter((e) => e.cycle === last);
    if (!current.some((e) => e.act === 'reading')) return { cycle: last, notes: [] };
    if (last >= reread.xpFactors.length + 1) return { cycle: last, notes: ['reread_limit_reached'] };
    const lastAt = current.reduce((m, e) => Math.max(m, e.at), 0);
    if (bogotaDay(evidence.at) - bogotaDay(lastAt) < reread.windowDays) return { cycle: last, notes: ['reread_window_not_elapsed'] };
    return { cycle: last + 1, notes: [] };
}

/**
 * Decide qué se reconoce para una evidencia, dado el historial del usuario.
 * Pura: devuelve las entradas que resultarían, sin guardarlas. Nunca lanza.
 *
 * @param {object} input
 * @param {object} input.evidence  { source, userId, evidenceId, at, workRef?, actorId?, verdict?,
 *                                   decision?, demonstratesComprehension?, newTraversal?, modality? }
 * @param {{ exists, active, synthetic }} input.subject
 * @param {object[]} input.history entradas previas de ESE usuario
 * @param {object} input.config    ver validateRecognitionConfig
 * @param {{ xpEarning?: boolean, pmEarning?: boolean }} [input.flags]  OFF si faltan
 */
export function decideRecognition({ evidence, subject, history, config, flags } = {}) {
    try {
        const { classification: cls, xp: xpE, pm: pmE, alternativeRouteOpen } = assessEligibility(evidence, subject);
        const base = { alternativeRouteOpen };
        const reasons = [...new Set([...xpE.reasons, ...pmE.reasons])];
        const check = validateRecognitionConfig(config);
        if (!check.ok) return outcomeOf('rejected', cls, ['invalid_config'], { ...base, configErrors: check.errors });
        if (!Array.isArray(history) || !history.every((e) => e && isId(e.evidenceId))) return outcomeOf('rejected', cls, ['invalid_history'], base);
        if (!xpE.eligible && !pmE.eligible) return outcomeOf(cls.known ? 'not_recognized' : 'rejected', cls, reasons, base);
        if (history.some((e) => e.evidenceId === evidence.evidenceId)) return outcomeOf('duplicate', cls, ['evidence_already_recognized'], base);

        const xpOn = flags?.xpEarning === true;
        const pmOn = flags?.pmEarning === true;
        const flagNotes = [...(xpE.eligible && !xpOn ? ['xp_flag_off'] : []), ...(pmE.eligible && !pmOn ? ['pm_flag_off'] : [])];
        if ((!xpE.eligible || !xpOn) && (!pmE.eligible || !pmOn)) return outcomeOf('disabled', cls, [...reasons, ...flagNotes], base);

        const { amounts } = config;
        const entry = (act, cycle, workRef, via, xp, pm) => ({ act, via, evidenceId: evidence.evidenceId, workRef, cycle, xp, pm, at: evidence.at });

        if (cls.source === 'mook_experience') {
            return outcomeOf('recognized', cls, [...reasons, ...flagNotes], { ...base, xp: amounts.xp.route,
                entries: [entry('route', null, null, 'route', amounts.xp.route, 0)] });
        }

        const workEntries = history.filter((e) => e.workRef === evidence.workRef && Number.isSafeInteger(e.cycle));
        const { cycle, notes } = resolveCycle(workEntries, evidence, config.reread);
        const inCycle = workEntries.filter((e) => e.cycle === cycle);
        const xpFactor = cycle === 1 ? 1 : config.reread.xpFactors[cycle - 2];
        const pmFactor = cycle === 1 ? 1 : (config.reread.pmFactors[cycle - 2] ?? 0);
        let room = Math.max(0, config.xpCeilingPerWorkCycle - inCycle.reduce((s, e) => s + (e.xp || 0), 0));
        const notesOut = [...reasons, ...flagNotes, ...notes];
        const entries = [];
        const take = (want) => {
            const got = Math.min(Math.floor(want * xpFactor), room);
            if (got < Math.floor(want * xpFactor)) notesOut.push('xp_ceiling_reached');
            room -= got;
            return got;
        };
        const via = cls.source === 'reading_completion' ? 'traversal' : cls.source === 'mook_review' ? 'review' : 'offline';

        if (xpOn && xpE.eligible && !inCycle.some((e) => e.act === 'reading')) {
            const xp = take(amounts.xp.reading);
            if (cycle > 1 && xp === 0) notesOut.push('reread_xp_exhausted');
            entries.push(entry('reading', cycle, evidence.workRef, via, xp, 0));
        } else if (cls.source === 'reading_completion' || !cls.demonstratesComprehension) {
            notesOut.push('already_recognized_in_cycle');
        }

        if (cls.demonstratesComprehension) {
            const xp = xpOn ? take(cls.source === 'mook_review' ? amounts.xp.reflection : amounts.xp.validated) : 0;
            let pm = 0;
            if (pmOn) {
                if (inCycle.some((e) => (e.pm || 0) > 0)) notesOut.push('pm_already_granted_in_cycle');
                else pm = Math.floor((cls.source === 'mook_review' ? amounts.pm.reviewed : amounts.pm.validated) * pmFactor);
            }
            entries.push(entry('reflection', cycle, evidence.workRef, via, xp, pm));
        }

        if (entries.length === 0) return outcomeOf('not_recognized', cls, notesOut, { ...base, cycle });
        return outcomeOf('recognized', cls, notesOut, { ...base, cycle, entries,
            xp: entries.reduce((s, e) => s + e.xp, 0), pm: entries.reduce((s, e) => s + e.pm, 0) });
    } catch {
        return outcomeOf('rejected', null, ['recognition_error']);
    }
}

/** Historial resultante. No muta la entrada. */
export function applyRecognition(history, decision) {
    return [...(Array.isArray(history) ? history : []), ...(Array.isArray(decision?.entries) ? decision.entries : [])];
}

/** Métricas derivadas del historial. Las entradas anuladas (`voided`) no cuentan. */
export function summarizeRecognition(history) {
    const rows = (Array.isArray(history) ? history : []).filter((e) => e && e.voided !== true);
    const distinct = (list) => new Set(list).size;
    return {
        xp: rows.reduce((s, e) => s + (Number.isSafeInteger(e.xp) ? e.xp : 0), 0),
        works: distinct(rows.filter((e) => e.act === 'reading').map((e) => e.workRef)),
        reflections: distinct(rows.filter((e) => e.act === 'reflection').map((e) => e.evidenceId)),
        rereadWorks: distinct(rows.filter((e) => e.act === 'reading' && e.cycle >= 2).map((e) => e.workRef)),
        routes: distinct(rows.filter((e) => e.act === 'route').map((e) => e.evidenceId)),
        validated: distinct(rows.filter((e) => e.via === 'offline').map((e) => e.evidenceId)),
    };
}

/**
 * Valida los umbrales de nivel: lista de { id, xp, works, reflections } con
 * umbrales no decrecientes y los primeros niveles sin reflexión (A8).
 */
export function validateLevels(levels) {
    const errors = [];
    if (!Array.isArray(levels) || levels.length === 0) return { ok: false, errors: ['levels'] };
    const ids = new Set();
    levels.forEach((l, i) => {
        if (!isId(l?.id) || ids.has(l.id)) errors.push(`levels[${i}].id`);
        ids.add(l?.id);
        for (const k of ['xp', 'works', 'reflections']) {
            if (!Number.isSafeInteger(l?.[k]) || l[k] < 0) errors.push(`levels[${i}].${k}`);
            else if (i > 0 && l[k] < levels[i - 1]?.[k]) errors.push(`levels[${i}].${k}.decreasing`);
        }
        if (i < MIN_LEVELS_WITHOUT_REFLECTION && l?.reflections !== 0) errors.push(`levels[${i}].reflections.required_too_early`);
    });
    return { ok: errors.length === 0, errors };
}

/**
 * Nivel derivado. Exige TODAS las condiciones de cada tramo, en orden: acumular
 * XP no basta. `floorIndex` es el nivel ya alcanzado: el nivel nunca baja.
 * No recibe modalidad, edad, formato ni dificultad.
 */
export function deriveLevel(stats, levels, { floorIndex = -1 } = {}) {
    const check = validateLevels(levels);
    if (!check.ok) return { ok: false, index: null, levelId: null, next: null, reasons: check.errors };
    const num = (v) => (Number.isFinite(v) && v > 0 ? v : 0);
    const have = { xp: num(stats?.xp), works: num(stats?.works), reflections: num(stats?.reflections) };
    const meets = (l) => have.xp >= l.xp && have.works >= l.works && have.reflections >= l.reflections;
    let index = -1;
    while (index + 1 < levels.length && meets(levels[index + 1])) index += 1;
    const floor = Number.isSafeInteger(floorIndex) ? Math.min(floorIndex, levels.length - 1) : -1;
    index = Math.max(index, floor);
    const nextLevel = levels[index + 1] ?? null;
    return { ok: true, index, levelId: index >= 0 ? levels[index].id : null, reasons: [],
        next: nextLevel && { id: nextLevel.id, missing: {
            xp: Math.max(0, nextLevel.xp - have.xp),
            works: Math.max(0, nextLevel.works - have.works),
            reflections: Math.max(0, nextLevel.reflections - have.reflections),
        } } };
}

/** Únicas métricas admitidas en un logro. Ninguna mide tiempo, velocidad ni interacciones. */
export const ACHIEVEMENT_METRICS = Object.freeze(['works', 'reflections', 'rereadWorks', 'routes', 'validated']);

/**
 * Catálogo V1. `atLeast: null` exige un valor configurado. Exploración y Varios
 * formatos quedan diferidos: necesitan metadatos del catálogo.
 */
export const ACHIEVEMENT_RULES_V1 = Object.freeze([
    Object.freeze({ id: 'primera-obra', metric: 'works', atLeast: 1 }),
    Object.freeze({ id: 'volver-a-una-obra', metric: 'rereadWorks', atLeast: 1 }),
    Object.freeze({ id: 'lector-reflexivo', metric: 'reflections', atLeast: null }),
    Object.freeze({ id: 'ruta-recorrida', metric: 'routes', atLeast: 1 }),
    Object.freeze({ id: 'lectura-compartida', metric: 'validated', atLeast: 1 }),
]);
export const ACHIEVEMENTS_DEFERRED = Object.freeze(['exploracion', 'varios-formatos']);

/**
 * Logros nuevos, con su evidencia. Nunca repite uno ya concedido.
 * @param {object} stats  de summarizeRecognition
 * @param {{ catalog?, thresholds?: Record<string, number>, granted?: string[] }} [opts]
 */
export function evaluateAchievements(stats, { catalog = ACHIEVEMENT_RULES_V1, thresholds = {}, granted = [] } = {}) {
    const awarded = [];
    const skipped = [];
    const done = new Set(Array.isArray(granted) ? granted : []);
    for (const rule of Array.isArray(catalog) ? catalog : []) {
        if (!isId(rule?.id)) { skipped.push({ id: null, reason: 'invalid_rule' }); continue; }
        if (done.has(rule.id)) continue;
        if (!ACHIEVEMENT_METRICS.includes(rule.metric)) { skipped.push({ id: rule.id, reason: 'unknown_metric' }); continue; }
        const atLeast = rule.atLeast ?? thresholds?.[rule.id];
        if (!Number.isSafeInteger(atLeast) || atLeast < 1) { skipped.push({ id: rule.id, reason: 'threshold_not_configured' }); continue; }
        const value = Number.isSafeInteger(stats?.[rule.metric]) ? stats[rule.metric] : 0;
        if (value >= atLeast) {
            awarded.push({ id: rule.id, evidence: { metric: rule.metric, value, atLeast }, ruleVersion: RECOGNITION_RULE_VERSION });
            done.add(rule.id);
        }
    }
    return { awarded, skipped };
}
