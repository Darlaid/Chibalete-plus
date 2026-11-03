/**
 * myProgressView.mjs — CHP-GAMIFICACION-G4-UX-U3.
 *
 * Presentación de «Mi progreso» a partir de la respuesta de `GET /api/me/progress`
 * (contrato U2). Módulo PURO: solo traduce valores del servidor a textos.
 * Nunca calcula XP, nivel ni logros: si un dato no viene del servidor, no se muestra.
 * Textos para lectores de 7 a 11 años (GAMIFICACION_G4_UX_01 §D.2–§D.5).
 */

/** Tramos activos del piloto. Un id desconocido no se muestra. */
export const LEVEL_NAMES = Object.freeze({ semilla: 'Semilla', brote: 'Brote' });

/** Los ocho estados de obra del contrato U2. */
export const WORK_STATE_TEXT = Object.freeze({
    started: 'Empezaste esta experiencia',
    in_review: 'Tu mediador está revisando lo que escribiste',
    revision_requested: 'Tu mediador te dejó una sugerencia',
    pending_recognition: '¡Aprobada! Tus XP aparecerán en unos minutos',
    recognized: 'Reconocida',
    complete: '¡Obra completa!',
    approved_no_xp: 'Aprobada. Esta entrega cuenta para tu aprendizaje, pero no suma XP',
    reviewed: 'Tu mediador revisó tu entrega y te dejó comentarios',
});

/** Tono visual por estado (nunca el único portador del significado: siempre va con texto). */
export const WORK_STATE_TONE = Object.freeze({
    started: 'neutral', in_review: 'waiting', revision_requested: 'action', pending_recognition: 'good',
    recognized: 'good', complete: 'good', approved_no_xp: 'neutral', reviewed: 'neutral',
});

/** Logros del catálogo inicial: se describe lo que hizo la persona, nunca puntos. */
export const ACHIEVEMENT_TEXT = Object.freeze({
    'primera-obra': { title: 'Primera obra', body: 'Compartiste lo que pensaste de tu primera obra.' },
    'mirada-profunda': { title: 'Mirada profunda', body: 'Volviste a pensar en una obra y escribiste algo nuevo.' },
    'lector-reflexivo': { title: 'Lector reflexivo', body: 'Escribiste varias reflexiones sobre lo que leíste.' },
    'tres-obras': { title: 'Tres obras', body: 'Compartiste lo que pensaste de tres obras distintas.' },
});

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const isCount = (n) => Number.isSafeInteger(n) && n >= 0;

/** Cómo conseguir el siguiente logro, según la métrica que indica el servidor. */
export function nextAchievementText(next) {
    if (!next || !ACHIEVEMENT_TEXT[next.id] || !isCount(next.missing)) return null;
    const m = next.missing;
    const how = {
        works: `Te falta escribir sobre ${plural(m, 'obra más', 'obras más')}.`,
        reflections: `Te ${m === 1 ? 'falta' : 'faltan'} ${plural(m, 'reflexión aprobada', 'reflexiones aprobadas')}.`,
        deepWorks: 'Vuelve a escribir sobre una obra que ya leíste.',
    }[next.metric];
    return how ? { title: ACHIEVEMENT_TEXT[next.id].title, how } : null;
}

/** Requisitos del siguiente nivel como lista con marca (la barra solo muestra XP). */
export function levelRequirements(next) {
    if (!next?.missing) return [];
    const { xp, works, reflections } = next.missing;
    const out = [];
    if (isCount(xp)) out.push({ key: 'xp', done: xp === 0, text: xp === 0 ? 'XP suficiente' : `Te ${xp === 1 ? 'falta' : 'faltan'} ${xp} XP` });
    if (isCount(works)) out.push({ key: 'works', done: works === 0, text: works === 0 ? 'Obras suficientes' : `Escribir sobre ${plural(works, 'obra', 'obras')}` });
    if (isCount(reflections) && reflections > 0) out.push({ key: 'reflections', done: false, text: `${plural(reflections, 'reflexión aprobada', 'reflexiones aprobadas')} más` });
    return out;
}

/**
 * Vista completa. Devuelve null si la respuesta no es un progreso válido: la
 * pantalla muestra entonces «no pudimos cargar», nunca 0 XP inventados.
 */
export function buildProgressView(data) {
    if (!data || data.enabled !== true || !isCount(data.xp) || !data.level || !LEVEL_NAMES[data.level.id]) return null;
    const next = data.level.next && LEVEL_NAMES[data.level.next.id] && Number.isSafeInteger(data.level.next.xpTarget) ? data.level.next : null;
    const availability = data.availability ?? { works: 0, activities: 0 };
    const canEarn = isCount(availability.activities) && availability.activities > 0;
    const works = (Array.isArray(data.works) ? data.works : []).filter((w) => w && WORK_STATE_TEXT[w.state]).map((w) => {
        const ceiling = Number.isSafeInteger(w.ceiling) && w.ceiling > 0 ? w.ceiling : null;
        const xp = isCount(w.xp) ? w.xp : 0;
        const showsXp = ceiling !== null && (xp > 0 || ['started', 'in_review', 'revision_requested', 'pending_recognition'].includes(w.state));
        const reflections = isCount(w.reflections) ? w.reflections : 0;
        return {
            contentId: w.contentId,
            title: typeof w.title === 'string' && w.title ? w.title : 'Obra sin título',
            experienceId: typeof w.experienceId === 'string' ? w.experienceId : null,
            state: w.state,
            stateText: WORK_STATE_TEXT[w.state],
            tone: WORK_STATE_TONE[w.state],
            xp: showsXp ? { value: Math.min(xp, ceiling), max: ceiling, text: `Esta obra: ${xp} de ${ceiling} XP` } : null,
            marks: showsXp ? [1, 2].map((i) => ({ label: `${i}.ª reflexión`, done: reflections >= i })) : [],
        };
    });
    const earned = (Array.isArray(data.achievements?.earned) ? data.achievements.earned : []).filter((id) => ACHIEVEMENT_TEXT[id])
        .map((id) => ({ id, ...ACHIEVEMENT_TEXT[id] }));
    const levelName = LEVEL_NAMES[data.level.id];
    return {
        xp: data.xp,
        level: {
            name: levelName,
            nextName: next ? LEVEL_NAMES[next.id] : null,
            // Barra hacia el siguiente nivel: solo XP, y solo si hay actividades que lo permitan.
            bar: next && canEarn ? { value: Math.min(data.xp, next.xpTarget), max: next.xpTarget,
                text: `Avance a ${LEVEL_NAMES[next.id]}: ${Math.min(data.xp, next.xpTarget)} de ${next.xpTarget} XP` } : null,
            requirements: next && canEarn ? levelRequirements(next) : [],
            reached: next ? null : `¡Llegaste a ${levelName}!`,
        },
        zero: data.xp === 0 && earned.length === 0,
        canEarn,
        works,
        earned,
        nextAchievement: canEarn ? nextAchievementText(data.achievements?.next) : null,
    };
}

/** Resultado de la llamada, ya clasificado para la pantalla. */
export function classifyProgressResponse(status, body) {
    if (status === 200 && body?.enabled === true) return { kind: 'ok', data: body };
    if (status === 200 && body?.enabled === false) return { kind: 'disabled' };
    if (status === 404) return { kind: 'off' };
    if (status === 401) return { kind: 'unauthenticated' };
    if (status === 403) return { kind: 'forbidden' };
    return { kind: 'unavailable' };
}
