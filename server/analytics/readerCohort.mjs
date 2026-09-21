/**
 * readerCohort.mjs — CHP-V6-INSIGHTS-PRODUCTION-01 / Continuación A1.
 *
 * Única definición de "cohorte LECTORA de un grupo" para las métricas
 * materializadas. Puro: recibe el grupo y los usuarios, devuelve ids.
 *
 * POR QUÉ EXISTE
 * --------------
 * `cohort_rollups` publicaba `active_users` = COUNT(*) de
 * `user_reading_profiles`, es decir TODOS los perfiles del sistema bajo
 * `scope_id='global'`. No existía ninguna fila por grupo, así que la vista
 * institucional no podía distinguir la cohorte objetivo del total. Además, el
 * conteo de "estudiantes" que se ve en producción sale de las cuentas de la
 * institución, que incluyen a los mediadores: en Villas de Aranjuez eso da 90
 * donde la cohorte lectora real es 80 (los otros 10 son los mediadores del
 * propio grupo, en `mediatorIds`).
 *
 * AUTORIDAD (decisión vinculante de la unidad)
 * --------------------------------------------
 *   1. `getGroupMembers` de `utils/groupMembership.mjs` — la fuente única ya
 *      vigente: `studentIds ∪ memberIds ∪ user.groupIds`, con el fallback
 *      legacy por `colegio` que esa función ya gobierna. NO se crea otra
 *      autoridad de membresía.
 *   2. Menos `group.mediatorIds`: un mediador nunca cuenta como lector, aunque
 *      aparezca en las arrays por un arrastre de datos.
 *   3. Menos el `teacherId` del grupo, por la misma razón.
 *
 * Lo que NO es autoridad: la población institucional (cuentas con el mismo
 * `colegio`/`organizationId` que no pertenecen al grupo) ni el padrón legacy
 * de `data/` (`USERS_DB_LEGACY_NON_CANONICAL` en server/config.js, prohibido en
 * runtime por CHP-ID-CANON-01A). El materializer no los consulta.
 *
 * La regla es general: no hay ids ni números de ningún colegio en este módulo.
 */

import { getGroupMembers } from '../../utils/groupMembership.mjs';

const arr = (x) => (Array.isArray(x) ? x : []);

/**
 * Ids que el grupo declara como NO-lectores: mediadores y el profesor legacy.
 * @param {object} group
 * @returns {Set<string>}
 */
export function groupNonReaderIds(group) {
    const out = new Set();
    for (const id of arr(group?.mediatorIds)) if (typeof id === 'string' && id) out.add(id);
    if (typeof group?.teacherId === 'string' && group.teacherId) out.add(group.teacherId);
    return out;
}

/**
 * Cohorte lectora de un grupo: miembros resueltos por la autoridad vigente,
 * menos los mediadores declarados. Sin duplicados, orden estable de entrada.
 *
 * @param {object}   group  record de groups_db
 * @param {object[]} users  users del store (lo que `getGroupMembers` ya espera)
 * @param {{allGroups?:object[], useLegacyColegioFallback?:boolean}} [opts]
 * @returns {{ readerIds:string[], excludedMediatorIds:string[] }}
 */
export function resolveGroupReaderCohort(group, users, opts = {}) {
    if (!group || typeof group !== 'object') {
        return { readerIds: [], excludedMediatorIds: [] };
    }
    const nonReaders = groupNonReaderIds(group);
    const members = getGroupMembers(group, users, {
        allGroups: opts.allGroups,
        useLegacyColegioFallback: opts.useLegacyColegioFallback !== false,
        // El fallback legacy ya emite su propio warning en producción; aquí lo
        // silenciamos para no duplicar ruido por cada corrida del materializer.
        warnFn: opts.warnFn || (() => {}),
    });
    const seen = new Set();
    const readerIds = [];
    const excluded = [];
    for (const id of members) {
        if (typeof id !== 'string' || !id || seen.has(id)) continue;
        seen.add(id);
        if (nonReaders.has(id)) { excluded.push(id); continue; }
        readerIds.push(id);
    }
    return { readerIds, excludedMediatorIds: excluded };
}
