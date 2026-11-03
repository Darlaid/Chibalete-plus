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
import { getXp } from './ledger.mjs';
import { deriveLevel, evaluateAchievements, summarizeRecognition, validateLevels } from './recognition.mjs';
import { findSubject, isExcluded } from './subjects.mjs';

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
        SELECT c.fact_id AS evidenceId, c.work_key AS workRef, c.cycle, c.act, c.xp
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
