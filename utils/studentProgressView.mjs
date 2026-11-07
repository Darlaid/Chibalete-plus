/**
 * studentProgressView.mjs — CHP-V8-UNIFIED-XP-01.
 *
 * Presentación, para el mediador, del progreso individual de una persona de su
 * grupo (`GET /api/groups/:groupId/students/:studentId/progress`). Módulo PURO:
 * solo traduce valores del servidor a textos. Nunca calcula XP, nivel ni logros,
 * y no compara con nadie: si un dato no viene del servidor, no se muestra.
 */
import { ACHIEVEMENT_TEXT, LEVEL_NAMES } from './myProgressView.mjs';

const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/**
 * Vista o null si la respuesta no es válida (en ese caso no se pinta nada).
 * @returns {{ xp: number, levelName: string, recognizedWorks: number, achievements: string[] } | null}
 */
export function buildStudentProgressView(body) {
    if (!body || !isCount(body.xp) || !isCount(body.recognizedWorks) || !LEVEL_NAMES[body.level?.id]) return null;
    const achievements = (Array.isArray(body.achievements) ? body.achievements : [])
        .filter((id) => typeof id === 'string' && ACHIEVEMENT_TEXT[id])
        .map((id) => ACHIEVEMENT_TEXT[id].title);
    return { xp: body.xp, levelName: LEVEL_NAMES[body.level.id], recognizedWorks: body.recognizedWorks, achievements };
}

/**
 * Resultado de la llamada. `hidden`: la consulta no existe para esta persona o
 * este mediador (XP apagado, fuera de alcance o fuera del grupo): no se pinta nada.
 */
export function classifyStudentProgress(status, body) {
    if (status === 200) {
        const view = buildStudentProgressView(body);
        return view ? { kind: 'ok', view } : { kind: 'unavailable' };
    }
    if (status === 404 || status === 403 || status === 401) return { kind: 'hidden' };
    return { kind: 'unavailable' };
}
