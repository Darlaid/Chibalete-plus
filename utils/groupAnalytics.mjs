/**
 * groupAnalytics.mjs — CHP-MAINT-AULA-VIVA-HISTORICAL-METRICS-01 (1B).
 *
 * Contrato del CLIENTE para la analítica de grupo de Aula Viva
 * (GET /api/groups/:id/analytics-summary). Módulo puro: sin React. Lo usan
 * `dataService`, `pages/AulaViva.tsx`, `components/aula-viva/*` y los tests.
 *
 * Reemplaza a `pedagogicalStats` (localStorage que nada alimentaba) como
 * autoridad. Regla central: un cero REAL del servidor se muestra como 0; una
 * métrica SIN fuente de servidor (tareas, PISA, evolución) se muestra como
 * estado vacío explícito, nunca como 0.
 */

import { userIsLectorLike } from './groupMembership.mjs';

export const GROUP_ANALYTICS_PATH =(groupId) => `/groups/${encodeURIComponent(groupId)}/analytics-summary`;
export const NO_SERVER_SOURCE = 'no_server_source';
export const GROUP_ANALYTICS_ERROR = 'No pudimos cargar la analítica del grupo.';
export const EMPTY_TEXT = Object.freeze({
    tasks: 'Sin tareas asignadas',
    pisa: 'Sin evaluaciones PISA',
    pisaCompetencies: 'Sin evaluaciones PISA disponibles.',
    evolution: 'Sin datos históricos',
});

/**
 * @typedef {{ totalEffectiveMs:number, readersWithActivity:number, averageEffectiveMsPerReader:number }} ReadingWindow
 * @typedef {{ userId:string, reading:{ allEffectiveMs:number, last28dEffectiveMs:number },
 *   leo:{ interactions:number }, progress:{ booksStarted:number, booksCompleted:number, averagePercent:number } }} ReaderAnalytics
 * @typedef {{ groupId:string, readerCount:number, reading:{ all:ReadingWindow, last28d:ReadingWindow },
 *   leo:{ interactions:number, readersWithInteractions:number, averageInteractionsPerReader:number },
 *   progress:{ readersWithProgress:number, booksStarted:number, booksCompleted:number },
 *   tasks:{ state:string }, pisa:{ state:string }, readers: ReaderAnalytics[] }} GroupAnalyticsSummary
 * @typedef {{ status:'loading' } | { status:'ready', summary:GroupAnalyticsSummary } | { status:'error' }} GroupAnalyticsState
 */

const num = (x) => typeof x === 'number' && Number.isFinite(x);
const win = (w) => w && num(w.totalEffectiveMs) && num(w.readersWithActivity) && num(w.averageEffectiveMsPerReader);

/**
 * Valida la respuesta del servidor. null si no tiene la forma esperada: el
 * llamador la trata como ERROR (jamás se rellena con ceros).
 * @returns {GroupAnalyticsSummary | null}
 */
export function parseGroupAnalyticsSummary(body) {
    if (!body || typeof body !== 'object' || typeof body.groupId !== 'string' || !num(body.readerCount)) return null;
    if (!win(body.reading?.all) || !win(body.reading?.last28d)) return null;
    if (!num(body.leo?.interactions) || !num(body.leo?.averageInteractionsPerReader)) return null;
    if (!num(body.progress?.booksStarted) || !num(body.progress?.booksCompleted)) return null;
    if (typeof body.tasks?.state !== 'string' || typeof body.pisa?.state !== 'string') return null;
    if (!Array.isArray(body.readers)) return null;
    const readers = body.readers.filter(r => r && typeof r.userId === 'string'
        && num(r.reading?.allEffectiveMs) && num(r.leo?.interactions) && num(r.progress?.booksStarted));
    return { ...body, readers };
}

/**
 * Estudiantes visibles de un grupo: los miembros resueltos MENOS los que el
 * grupo declara no-lectores (mediatorIds, teacherId) y solo con rol lector.
 * Misma regla que la cohorte del servidor (readerCohort + userIsLectorLike):
 * el contrato de membresía da user.groupIds también al mediador.
 * @template {{id:string}} U
 * @param {U[]} members
 * @returns {U[]}
 */
export function lectorOnlyStudents(members, group) {
    const nonReaders = new Set([
        ...(Array.isArray(group?.mediatorIds) ? group.mediatorIds : []),
        ...(typeof group?.teacherId === 'string' && group.teacherId ? [group.teacherId] : []),
    ]);
    return (Array.isArray(members) ? members : []).filter(u => u && !nonReaders.has(u.id) && userIsLectorLike(u));
}

/** Detalle por lector indexado por userId (para unir con la lista de usuarios). */
export function indexReadersById(summary) {
    return new Map((summary?.readers ?? []).map(r => [r.userId, r]));
}

/** true si la métrica NO tiene fuente de servidor (≠ cero real). */
export function hasNoServerSource(metric) {
    return !metric || metric.state === NO_SERVER_SOURCE;
}

/**
 * Duración efectiva legible: 0 → "0 min", 51,9 min → "52 min",
 * 135 min → "2 h 15 min". Redondeo al minuto.
 */
export function formatReadingDuration(ms) {
    const total = Math.round((num(ms) && ms > 0 ? ms : 0) / 60_000);
    if (total < 60) return `${total} min`;
    const h = Math.floor(total / 60), m = total % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

const DEC2 = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });
/**
 * Promedio de interacciones Leo por lector, SIN redondear a entero:
 * 14/80 = 0,175 → "0,18"; 0 → "0". El redondeo a 2 decimales se hace en
 * decimal (0,175 en binario vale 0,17499…).
 */
export function formatLeoAverage(x) {
    const v = num(x) && x > 0 ? Math.round(x * 100) / 100 : 0;
    return DEC2.format(v);
}

/**
 * Cargador "solo la última": cada `load` aborta la anterior y una respuesta
 * vieja nunca sobrescribe el estado del grupo nuevo.
 * @param {(groupId:string, signal:AbortSignal) => Promise<GroupAnalyticsSummary>} fetchSummary
 */
export function createLatestGroupAnalyticsLoader(fetchSummary) {
    let current = null;   // { controller, token }
    let seq = 0;
    return {
        /** @param {(s:GroupAnalyticsState) => void} onState */
        load(groupId, onState) {
            current?.controller.abort();
            const token = ++seq;
            const controller = new AbortController();
            current = { controller, token };
            onState({ status: 'loading' });
            return fetchSummary(groupId, controller.signal).then(
                (summary) => { if (current?.token === token) onState({ status: 'ready', summary }); },
                () => { if (current?.token === token && !controller.signal.aborted) onState({ status: 'error' }); },
            );
        },
        cancel() { current?.controller.abort(); current = null; },
    };
}
