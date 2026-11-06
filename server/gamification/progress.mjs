/**
 * progress.mjs — CHP-GAMIFICACION-G4-UX-U1.
 *
 * Progreso visible de UNA persona, derivado del ledger al leer
 * (docs/gamificacion/GAMIFICACION_G4_UX_01.md §B, §C y §E):
 *  - XP acumulado: `getXp`, el mismo total del ledger (asientos no anulados);
 *  - obras distintas, reflexiones y `deepWorks`: actos de `gm_work_cycles` cuyo
 *    hecho es `awarded` y cuyo asiento de XP no está anulado;
 *  - nivel actual y lo que falta para el siguiente (`deriveLevel`);
 *  - logros obtenidos, alcanzables y el siguiente alcanzable (`evaluateAchievements`).
 *
 * Solo lectura: no escribe en ninguna tabla (tampoco `gm_achievements`), no crea
 * sujetos, no genera XP y no abre transacciones de escritura. Nivel y logros
 * dependen solo de métricas que únicamente crecen (no existe escritura de
 * anulaciones), así que el resultado derivado es estable y monotónico.
 *
 * Privacidad: la salida no contiene `subject_ref`, claves HMAC (`work_key`,
 * `source_event_id`), ids de hechos ni motivos. Una persona excluida, o sin
 * sujeto, recibe exactamente la misma salida que alguien sin actividad. El
 * llamador (U2) es quien garantiza que `userId` es la persona de la sesión.
 */
import { GamificationError } from './db.mjs';
import { exclusionGate } from './exclusions.mjs';
import { getActiveRuleSet, getXp, REVIEW_FACT, REVIEW_SOURCE, workCycleHistory } from './ledger.mjs';
import { attributedEvidence, EXPLICIT_ACCESS_VIAS } from './mookWorks.mjs';
import { XP_LOCKED_SOURCES } from './policy.mjs';
import { decideRecognition, deriveLevel, evaluateAchievements, summarizeRecognition, validateApprovedRecognition, validateLevels } from './recognition.mjs';
import { deriveSourceKey, deriveWorkKey, findSubject, isExcluded } from './subjects.mjs';

const freezeAll = (list) => Object.freeze(list.map((x) => Object.freeze({ ...x })));

/**
 * Tramos del piloto (UX-1): Semilla y Brote son los únicos DEFINITIVOS y los
 * únicos activos por defecto.
 */
export const PILOT_LEVELS = freezeAll([
    { id: 'semilla', xp: 0, works: 0, reflections: 0 },
    { id: 'brote', xp: 30, works: 1, reflections: 0 },
]);

/**
 * Tramos superiores PROVISIONALES (UX-1): configurables, no activos. Solo se
 * pasan a `readProgress` como `levels` tras contar las obras elegibles y
 * recibir aprobación.
 */
export const PROPOSED_LEVELS = freezeAll([
    ...PILOT_LEVELS,
    { id: 'raiz', xp: 120, works: 3, reflections: 3 },
    { id: 'tallo', xp: 250, works: 6, reflections: 8 },
    { id: 'rama', xp: 450, works: 10, reflections: 14 },
    { id: 'arbol', xp: 700, works: 15, reflections: 22 },
]);

/** Catálogo inicial (UX-2). El umbral 5 de «lector-reflexivo» es provisional. */
export const PILOT_ACHIEVEMENTS = freezeAll([
    { id: 'primera-obra', metric: 'works', atLeast: 1 },
    { id: 'lector-reflexivo', metric: 'reflections', atLeast: 5 },
    { id: 'tres-obras', metric: 'works', atLeast: 3 },
    { id: 'mirada-profunda', metric: 'deepWorks', atLeast: 1 },
]);

/** Métricas que se exponen. */
const EXPOSED = ['works', 'reflections', 'deepWorks'];
const zeroStats = () => ({ xp: 0, works: 0, reflections: 0, deepWorks: 0 });

/**
 * Historial interno de la persona: un acto por fila, solo reconocimientos
 * válidos. Contiene claves HMAC e ids de hechos: NUNCA sale de este módulo.
 */
function validHistory(db, subjectRef) {
    return db.prepare(`
        SELECT c.fact_id AS evidenceId, c.work_key AS workRef, c.cycle, c.act, c.xp, f.occurred_at AS at
        FROM gm_work_cycles c
        JOIN gm_source_facts f ON f.fact_id = c.fact_id
        WHERE c.subject_ref = ? AND f.decision = 'awarded'
          AND EXISTS (SELECT 1 FROM gm_xp_entries a
                      WHERE a.fact_id = c.fact_id AND a.kind = 'award'
                        AND NOT EXISTS (SELECT 1 FROM gm_xp_entries v WHERE v.kind = 'void' AND v.voids_entry_id = a.entry_id))
        ORDER BY c.rowid
    `).all(subjectRef);
}

/**
 * Métricas del ledger para una persona. Excluida o sin sujeto ⇒ todo a cero.
 * @param {{ excludes: (id: string) => boolean }} gate
 */
export function readProgressStats(db, userId, gate) {
    if (typeof userId !== 'string' || userId.length === 0) throw new GamificationError('INVALID_USER');
    if (gate.excludes(userId) || isExcluded(db, userId)) return zeroStats();
    const subject = findSubject(db, userId);
    if (!subject) return zeroStats();
    const s = summarizeRecognition(validHistory(db, subject.subject_ref));
    return { xp: getXp(db, userId), works: s.works, reflections: s.reflections, deepWorks: s.deepWorks };
}

/**
 * Logros: obtenidos, alcanzables con las actividades disponibles y el siguiente.
 * `capacity` = valor máximo alcanzable de cada métrica con las actividades que la
 * persona tiene disponibles hoy (lo calcula U2 desde el catálogo MOOK). Sin
 * `capacity`, ningún logro pendiente se considera alcanzable (fallo cerrado).
 */
export function achievementView(stats, catalog = PILOT_ACHIEVEMENTS, capacity = null) {
    const earned = new Set(evaluateAchievements(stats, { catalog }).awarded.map((a) => a.id));
    const reachable = [];
    let next = null;
    for (const rule of catalog) {
        if (earned.has(rule.id)) continue;
        const cap = capacity?.[rule.metric];
        if (!Number.isSafeInteger(cap) || cap < rule.atLeast) continue;
        reachable.push(rule.id);
        const missing = rule.atLeast - (Number.isSafeInteger(stats[rule.metric]) ? stats[rule.metric] : 0);
        if (!next || missing < next.missing) next = { id: rule.id, metric: rule.metric, missing };
    }
    return { earned: catalog.filter((r) => earned.has(r.id)).map((r) => r.id), reachable, next };
}

/**
 * Progreso visible de una persona. Solo lectura.
 * @param {import('better-sqlite3').Database} db
 * @param {string} userId  la persona de la sesión (lo garantiza el llamador)
 * @param {{ levels?, catalog?, capacity?: Record<string, number>|null, gate?, env? }} [opts]
 * @throws GamificationError INVALID_LEVELS, o un error del registro de exclusiones:
 *         el llamador muestra «no pudimos cargar tu progreso», nunca 0 XP.
 */
export function readProgress(db, userId, { levels = PILOT_LEVELS, catalog = PILOT_ACHIEVEMENTS, capacity = null, gate = null, env = process.env } = {}) {
    if (!validateLevels(levels).ok) throw new GamificationError('INVALID_LEVELS');
    const stats = readProgressStats(db, userId, gate ?? exclusionGate(db, env));
    const lv = deriveLevel(stats, levels);
    const next = lv.next && { id: lv.next.id, xpTarget: levels[lv.index + 1].xp, missing: lv.next.missing };
    return {
        xp: stats.xp,
        ...Object.fromEntries(EXPOSED.map((k) => [k, stats[k]])),
        level: { id: lv.levelId, index: lv.index, next },
        achievements: achievementView(stats, catalog, capacity),
    };
}

// ── G4-UX-U2: progreso por obra y disponibilidad desde el catálogo propio ─────
//
// Solo lectura, con las piezas del escritor: `attributedEvidence` (la misma
// atribución que el barrido), `decideRecognition` con la regla vigente y
// `workCycleHistory` (la misma entrada que `recordWorkRecognition`). No hay un
// segundo motor: lo pendiente se PROYECTA con esas funciones y nunca se registra.

/** Estados de obra visibles (GAMIFICACION_G4_UX_01 §D.3; `reviewed` = cerrada «con comentarios»). */
export const WORK_STATES = Object.freeze(['started', 'in_review', 'revision_requested', 'pending_recognition',
    'recognized', 'complete', 'approved_no_xp', 'reviewed']);
/** Al combinar las entregas de una obra gana lo que pide atención. */
const STATE_ORDER = ['revision_requested', 'in_review', 'pending_recognition', 'complete', 'recognized', 'approved_no_xp', 'reviewed', 'started'];
/** Revisor ficticio de la proyección: solo tiene que ser distinto de la persona. */
const PROJECTION_ACTOR = 'gm-projection-actor';

const versionNodesOf = (version) => (version?.modules ?? []).flatMap((m) => m?.nodes ?? []);
const liveRun = (doc, userId, experienceId) => (doc.runs ?? []).find((r) => r.userId === userId && r.experienceId === experienceId && r.status !== 'abandoned');

/**
 * Actividades del catálogo propio que podrían sumar XP: nodos PRODUCTION con obra
 * declarada de experiencias publicadas, en la versión que la persona usaría (la
 * fijada por su run vigente o, si no tiene, la actual) y publicada después del
 * corte. `delivered`: ya hay entrega propia en ese nodo.
 * @returns {{ experienceId, versionId, nodeId, workRef, delivered }[]}
 */
export function catalogActivities(doc, userId, { workRefOf, sinceMs }) {
    if (!sinceMs || typeof workRefOf !== 'function') return [];
    const out = [];
    for (const exp of doc?.experiences ?? []) {
        if (exp?.status !== 'published' || !exp.currentVersionId) continue;
        const run = userId ? liveRun(doc, userId, exp.id) : null;
        const versionId = run ? run.experienceVersionId : exp.currentVersionId;
        const version = (doc.versions ?? []).find((v) => v.id === versionId && v.experienceId === exp.id);
        if (!version || version.status !== 'published' || !(Date.parse(version.publishedAt) >= sinceMs)) continue;
        for (const node of versionNodesOf(version)) {
            if (node?.type !== 'PRODUCTION') continue;
            let ref;
            try { ref = workRefOf(version, node.id); } catch { continue; }
            if (!ref?.workRef || ref.issue) continue;
            const delivered = !!run && (run.nodeStates?.[node.id]?.evidenceIds?.length ?? 0) > 0;
            out.push({ experienceId: exp.id, versionId, nodeId: node.id, workRef: ref.workRef, delivered });
        }
    }
    return out;
}

/** ¿El acceso resuelto para una obra autoriza reconocerla? Mismo criterio que la atribución. */
export const workAccessCounts = (access) => access?.decision === 'allowed' && EXPLICIT_ACCESS_VIAS.includes(access.via);

/** Regla con la que se proyecta, o null si hoy nada de `mook_review` puede sumar XP. */
function projectionRule(db, now) {
    if (XP_LOCKED_SOURCES.includes(REVIEW_SOURCE)) return null;
    const active = getActiveRuleSet(db, now);
    if (!active || now < active.effectiveFrom) return null;
    const config = active.rules?.recognition;
    return validateApprovedRecognition(config).ok ? { config, effectiveFrom: active.effectiveFrom } : null;
}

/** Estado de una entrega propia según su revisión, sin ledger. */
function reviewState(ev) {
    const st = ev?.review?.status;
    if (st === 'SUBMITTED' || st === 'RESUBMITTED') return 'in_review';
    if (st === 'REVISION_REQUESTED') return 'revision_requested';
    if (st === 'REVIEWED') return ev.review.decision === 'aprobado' ? 'approved' : 'reviewed';
    return null;
}

const FACT_SQL = `SELECT f.decision, EXISTS (SELECT 1 FROM gm_xp_entries a WHERE a.fact_id = f.fact_id AND a.kind = 'award'
        AND NOT EXISTS (SELECT 1 FROM gm_xp_entries v WHERE v.kind = 'void' AND v.voids_entry_id = a.entry_id)) AS live
    FROM gm_source_facts f WHERE f.source = ? AND f.source_event_id = ? AND f.fact_type = ?`;

/**
 * Progreso visible de la persona de la sesión: totales y nivel (`readProgress`,
 * U1), estado por obra y disponibilidad en su catálogo. Solo lectura.
 * @param {import('better-sqlite3').Database} db  conexión de solo lectura
 * @param {string} userId  la persona de la sesión (lo garantiza el llamador)
 * @param {object} deps
 * @param {object} deps.doc  documento MOOK normalizado
 * @param {Function} deps.workRefOf  `experienceStore.productionWorkRef`
 * @param {Function} deps.resolveUser  padrón del servidor (`makeResolveUser`)
 * @param {(contentId: string) => boolean} deps.isWithdrawn  retirada legal
 * @param {Map<string, {decision, via}>} deps.access  acceso resuelto por obra del catálogo
 * @param {(contentId: string) => string|null} [deps.titleOf]
 * @param {number} deps.sinceMs  corte de activación
 * @throws errores del registro de exclusiones o de la clave: el llamador responde «no disponible», nunca 0 XP
 */
export function readWorkProgress(db, userId, { doc, workRefOf, resolveUser, isWithdrawn, access, titleOf = () => null, sinceMs, env = process.env, now = Date.now() } = {}) {
    if (typeof userId !== 'string' || userId.length === 0) throw new GamificationError('INVALID_USER');
    const gate = exclusionGate(db, env);
    const excluded = gate.excludes(userId) || isExcluded(db, userId);
    // Excluida = exactamente alguien sin actividad: sin runs, sin entregas, sin sujeto.
    const mine = {
        experiences: doc?.experiences ?? [], versions: doc?.versions ?? [],
        runs: excluded ? [] : (doc?.runs ?? []).filter((r) => r?.userId === userId),
        evidence: excluded ? [] : (doc?.evidence ?? []).filter((e) => e?.userId === userId),
    };
    const subject = excluded ? null : findSubject(db, userId);
    const rule = projectionRule(db, now);
    const keyOf = (workRef) => (subject ? deriveWorkKey(subject, workRef) : `new\0${workRef}`);
    const valid = subject ? validHistory(db, subject.subject_ref) : [];
    const histories = new Map(); // workRef → historial del escritor + proyectado
    const historyOf = (workRef) => {
        if (!histories.has(workRef)) histories.set(workRef, subject ? workCycleHistory(db, subject.subject_ref, keyOf(workRef)) : []);
        return histories.get(workRef);
    };
    const project = (workRef, evidenceId, at) => {
        if (!rule || at < rule.effectiveFrom) return false;
        const h = historyOf(workRef);
        const d = decideRecognition({
            evidence: { source: REVIEW_SOURCE, userId, actorId: PROJECTION_ACTOR, evidenceId, at, workRef: keyOf(workRef), decision: 'aprobado' },
            subject: { exists: true, active: true, synthetic: false }, history: h, config: rule.config, flags: { xpEarning: true, pmEarning: false },
        });
        if (d.outcome !== 'recognized' || !(d.xp > 0)) return false;
        h.push(...d.entries.map((e) => ({ ...e, projected: true })));
        return true;
    };

    // 1) Entregas propias: revisión, reconocimiento real o proyectado.
    const works = new Map(); // workRef → { experienceId, states }
    const touch = (workRef, experienceId, state) => {
        const w = works.get(workRef) ?? { experienceId, states: new Set() };
        w.experienceId = experienceId;
        w.states.add(state);
        works.set(workRef, w);
    };
    const attribution = { workRefOf, resolveUser, sinceMs, gate, isWithdrawn };
    const factStmt = db.prepare(FACT_SQL);
    for (const ev of mine.evidence) {
        if (ev?.nodeType !== 'PRODUCTION' || ev.requiresReview !== true) continue;
        const run = mine.runs.find((r) => r.id === ev.runId);
        const version = run && mine.versions.find((v) => v.id === run.experienceVersionId);
        let workRef = null;
        try { workRef = version ? workRefOf(version, ev.nodeId)?.workRef ?? null : null; } catch { workRef = null; }
        const st = reviewState(ev);
        if (!workRef || !st) continue; // sin obra declarada: no aparece
        if (st !== 'approved') { touch(workRef, ev.experienceId, st); continue; }
        const fact = subject && factStmt.get(REVIEW_SOURCE, deriveSourceKey(subject, REVIEW_SOURCE, REVIEW_FACT, ev.id), REVIEW_FACT);
        if (fact) { touch(workRef, ev.experienceId, fact.decision === 'awarded' && fact.live ? 'recognized' : 'approved_no_xp'); continue; }
        // Sin hecho: ¿lo registraría el próximo barrido? Misma atribución, misma regla.
        let attributed = null;
        for (const a of attributedEvidence({ ...mine, evidence: [ev] }, attribution, {})) attributed = a;
        const pending = !!attributed && attributed.workRef === workRef && project(workRef, ev.id, attributed.at);
        touch(workRef, ev.experienceId, pending ? 'pending_recognition' : 'approved_no_xp');
    }

    // 2) Catálogo propio: experiencias empezadas y actividades aún disponibles.
    const activities = catalogActivities(mine, excluded ? null : userId, { workRefOf, sinceMs });
    for (const a of activities) if (!works.has(a.workRef) && liveRun(mine, userId, a.experienceId)) touch(a.workRef, a.experienceId, 'started');
    const eligible = activities.filter((a) => {
        if (!rule || !workAccessCounts(access?.get(a.workRef))) return false;
        try { return isWithdrawn?.(a.workRef) === false; } catch { return false; }
    });
    let remaining = 0;
    for (const a of eligible) {
        if (a.delivered) continue;
        remaining += 1;
        project(a.workRef, `catalog\0${a.versionId}\0${a.nodeId}`, now);
    }

    // 3) Totales y nivel con U1; capacidad = reconocido + proyectado.
    const projected = [...histories.values()].flat().filter((e) => e.projected);
    const cap = summarizeRecognition([...valid, ...projected]);
    const progress = readProgress(db, userId, { gate, env, capacity: { works: cap.works, reflections: cap.reflections, deepWorks: cap.deepWorks } });

    // 4) Por obra, solo valores visibles: nada de claves, sujetos, ids de hechos ni motivos.
    const ceiling = rule ? rule.config.xpCeilingPerWorkCycle : null;
    const list = [];
    for (const [workRef, w] of works) {
        const acts = valid.filter((e) => e.workRef === keyOf(workRef));
        const cycle = acts.reduce((m, e) => Math.max(m, e.cycle), 0);
        const inCycle = acts.filter((e) => e.cycle === cycle);
        const reflections = inCycle.filter((e) => e.act === 'reflection').length;
        if (w.states.has('recognized') && reflections >= 2) { w.states.delete('recognized'); w.states.add('complete'); }
        let title = null;
        try { title = titleOf(workRef) ?? null; } catch { title = null; }
        list.push({ contentId: workRef, title, experienceId: w.experienceId, state: STATE_ORDER.find((s) => w.states.has(s)),
            xp: inCycle.reduce((s, e) => s + (Number.isSafeInteger(e.xp) ? e.xp : 0), 0), ceiling, reflections });
    }

    return {
        xp: progress.xp,
        level: progress.level,
        stats: { works: progress.works, reflections: progress.reflections, deepWorks: progress.deepWorks },
        achievements: { earned: progress.achievements.earned, next: progress.achievements.next },
        availability: { works: new Set(eligible.map((a) => a.workRef)).size, activities: remaining },
        works: list,
        history: recognitionHistory(valid, [...works.keys(), ...activities.map((a) => a.workRef)], keyOf, titleOf),
    };
}

/** Máximo de entradas del historial visible (las más recientes). */
export const HISTORY_LIMIT = 50;

/**
 * V8-INTEGRATION-01. Historial visible: un acto reconocido por fila, con el día
 * del hecho (precisión del ledger), la obra y el XP. Las claves de obra se
 * resuelven solo contra obras que la persona ya ve (sus entregas y su catálogo);
 * una clave sin obra conocida sale sin `contentId` ni título. Nunca expone
 * claves, ids de hechos, ciclos ni motivos.
 */
function recognitionHistory(valid, workRefs, keyOf, titleOf) {
    const byKey = new Map();
    for (const workRef of workRefs) if (!byKey.has(keyOf(workRef))) byKey.set(keyOf(workRef), workRef);
    const order = { reading: 0, reflection: 1 };
    const rows = valid
        .filter((e) => Number.isSafeInteger(e.xp) && e.xp > 0 && Number.isSafeInteger(e.at) && e.act in order)
        .map((e, i) => ({ e, i }))
        .sort((a, b) => b.e.at - a.e.at || b.i - a.i)
        .slice(0, HISTORY_LIMIT);
    // Dentro de un mismo hecho, la lectura antes que la reflexión.
    rows.sort((a, b) => b.e.at - a.e.at || (a.e.evidenceId === b.e.evidenceId ? order[a.e.act] - order[b.e.act] : b.i - a.i));
    return rows.map(({ e }) => {
        const contentId = byKey.get(e.workRef) ?? null;
        let title = null;
        try { title = contentId ? titleOf(contentId) ?? null : null; } catch { title = null; }
        return { day: new Date(e.at).toISOString().slice(0, 10), contentId, title, act: e.act, xp: e.xp };
    });
}

// ── G4-UX-U4: agregados de reconocimiento de un grupo (vista del mediador) ────
//
// Solo conteos: ningún id, nombre, XP ni nivel individual sale de aquí. Una
// persona excluida cuenta igual que alguien sin reconocimiento.

/** Tamaño mínimo del grupo para mostrar agregados del ledger (UX-01 §D.6). */
export const GROUP_MIN_SIZE = 5;

/** ¿Puede hoy `mook_review` sumar XP con la regla vigente? Solo lectura. */
export const recognitionActive = (db, now = Date.now()) => projectionRule(db, now) !== null;

/**
 * Agregados del grupo. Solo lectura.
 * @param {import('better-sqlite3').Database} db  conexión de solo lectura
 * @param {string[]} studentIds  cohorte lectora del grupo (la resuelve el servidor)
 * @param {{ eligibleWorkRefs: Iterable<string>, env?, now? }} opts
 *        `eligibleWorkRefs`: obras del catálogo con acceso explícito para el grupo,
 *        ya filtradas por retirada legal (las resuelve el llamador).
 * @returns {{ studentsWithRecognizedWork: number|null, suppressed: boolean, eligibleWorks: number }}
 * @throws errores del registro de exclusiones o de la clave
 */
export function readGroupRecognitionCounts(db, studentIds, { eligibleWorkRefs = [], env = process.env, now = Date.now() } = {}) {
    const ids = [...new Set((Array.isArray(studentIds) ? studentIds : []).filter((id) => typeof id === 'string' && id))];
    const eligibleWorks = recognitionActive(db, now) ? new Set(eligibleWorkRefs).size : 0;
    if (ids.length < GROUP_MIN_SIZE) return { studentsWithRecognizedWork: null, suppressed: true, eligibleWorks };
    const gate = exclusionGate(db, env);
    const recognized = ids.filter((id) => readProgressStats(db, id, gate).works >= 1).length;
    return { studentsWithRecognizedWork: recognized, suppressed: false, eligibleWorks };
}
