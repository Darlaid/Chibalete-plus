/**
 * utils/studentStatus.mjs — capa narrativa por lector.
 *
 * Espejo del patrón establecido en utils/groupDiagnosis.mjs (Sprint visibilidad):
 * el sistema explica el estado de cada estudiante en lenguaje listo-para-UI.
 * El frontend no transforma — renderiza directamente message/cause/recommendedAction.
 *
 * Reglas de diseño:
 *   - Helper puro (cero I/O, cero deps Node) — corre en navegador y servidor.
 *   - Estados mutuamente excluyentes ordenados por prioridad. El primer match gana.
 *   - Mensajes en español, sin jerga técnica (no "groupIds", no "memberIds",
 *     no "null"). Habla de "estudiante", "grupo", "lectura", "ingreso".
 *   - Tres tonos visuales: ok | warning | error. Mismo mapeo que el grupo.
 *
 * El builder NO inventa datos: si un input no se provee, el estado se
 * resuelve con la información disponible. Documentar en el endpoint qué
 * inputs alimentar — la lógica acá no asume.
 */

// ─── Estados públicos ────────────────────────────────────────────────────────

/** Estados estables para clientes — mantener los strings exactos. */
export const STUDENT_STATE = Object.freeze({
    ACTIVE_PROGRESS:     'ACTIVE_PROGRESS',
    ACTIVE_NO_PROGRESS:  'ACTIVE_NO_PROGRESS',
    REGISTERED_NO_LOGIN: 'REGISTERED_NO_LOGIN',
    NO_GROUP:            'NO_GROUP',
    NO_ACCESS:           'NO_ACCESS',
    TECH_ISSUE:          'TECH_ISSUE',
});

// Mapeo estado → tono visual (consistente con groupDiagnosis: ok/warning/error).
const STATE_TONE = {
    ACTIVE_PROGRESS:     'ok',
    ACTIVE_NO_PROGRESS:  'warning',
    REGISTERED_NO_LOGIN: 'warning',
    NO_GROUP:            'warning',
    NO_ACCESS:           'warning',
    TECH_ISSUE:          'error',
};

// Narrativa por estado — message + cause + recommendedAction listos para UI.
// Si la regla de un estado cambia, se cambia acá y todas las capas heredan.
const STATE_NARRATIVE = {
    ACTIVE_PROGRESS: {
        headline:          'Estudiante activo con avance.',
        message:           'El estudiante está leyendo activamente en Chibalete+.',
        cause:             'Tiene ingresos recientes y registros de avance en lectura.',
        recommendedAction: 'Acompañar el proceso y revisar las lecturas en curso para apoyarlo cuando lo necesite.',
    },
    ACTIVE_NO_PROGRESS: {
        headline:          'Estudiante con sesión iniciada pero sin avance en lectura.',
        message:           'El estudiante ya entró a Chibalete+ pero todavía no ha registrado avance en ninguna lectura.',
        cause:             'No hay eventos de lectura asociados desde su último ingreso.',
        recommendedAction: 'Revisar si tiene contenido asignado o invitarlo a comenzar una lectura específica.',
    },
    REGISTERED_NO_LOGIN: {
        headline:          'El estudiante nunca ha entrado a Chibalete+.',
        message:           'La cuenta del estudiante existe pero no se ha registrado un primer ingreso.',
        cause:             'La cuenta fue creada o invitada y todavía no se ha activado un primer acceso.',
        recommendedAction: 'Reenviar la invitación o contactar al estudiante para acompañarlo en su primer ingreso.',
    },
    NO_GROUP: {
        headline:          'El estudiante no está asignado a ningún grupo.',
        message:           'El estudiante existe en el sistema pero no aparece en ningún curso ni club.',
        cause:             'La asignación a un grupo aún no se ha realizado o se eliminó.',
        recommendedAction: 'Asignar al estudiante a un grupo desde el gestor de usuarios o desde la lista de candidatos del grupo.',
    },
    NO_ACCESS: {
        headline:          'El estudiante pertenece a un grupo pero no tiene contenido disponible.',
        message:           'El estudiante está en un grupo pero no hay lecturas habilitadas para él.',
        cause:             'No se han habilitado contenidos para su grupo o la ventana de acceso ya cerró.',
        recommendedAction: 'Revisar las reglas de acceso del grupo o asignar contenido específico al estudiante.',
    },
    TECH_ISSUE: {
        headline:          'El estudiante tiene problemas técnicos recientes.',
        message:           'Se detectaron incidentes técnicos asociados a esta cuenta.',
        cause:             'En las últimas 24 horas se registraron errores en el uso normal de la plataforma por parte del estudiante.',
        recommendedAction: 'Revisar el detalle de los incidentes; si persisten, escalar al equipo técnico.',
    },
};

// ─── Internals ────────────────────────────────────────────────────────────────

const isNum  = (n) => typeof n === 'number' && Number.isFinite(n);
const isPos  = (n) => isNum(n) && n > 0;
const safe   = (v, fallback) => (v == null ? fallback : v);

/** Devuelve el nombre legible del estudiante usando los campos canónicos del User. */
function resolveDisplayName(user) {
    if (!user || typeof user !== 'object') return 'Estudiante';
    return (
        (typeof user.nombre_completo === 'string' && user.nombre_completo.trim()) ||
        (typeof user.nombre_usuario  === 'string' && user.nombre_usuario.trim())  ||
        (typeof user.email           === 'string' && user.email.trim())           ||
        'Estudiante'
    );
}

// ─── Decisión de estado — first match wins ────────────────────────────────────
//
// Orden narrativo:
//   1. TECH_ISSUE  — algo está roto, urgencia técnica
//   2. NO_GROUP    — sin grupo nada del flujo pedagógico aplica
//   3. NO_ACCESS   — tiene grupo pero ningún contenido habilitado
//   4. REGISTERED_NO_LOGIN — todo administrativo OK pero nunca llegó
//   5. ACTIVE_NO_PROGRESS  — entró pero no avanzó
//   6. ACTIVE_PROGRESS     — avance real
//
// Cada rama lee inputs específicos del payload. Si un input no se provee,
// la rama no se activa (no inventa estados).
function decideState(metrics, logs) {
    const m = metrics || {};
    const l = logs    || {};

    // 1. TECH_ISSUE — opcional. Solo se activa si el caller pasa evidencia.
    if (isPos(l.recentErrorsCount)) return STUDENT_STATE.TECH_ISSUE;

    // 2. NO_GROUP — el caller debe responder a "¿está en algún grupo?".
    if (m.inAnyGroup === false) return STUDENT_STATE.NO_GROUP;

    // 3. NO_ACCESS — solo se evalúa si el caller responde la pregunta.
    //    Si hasContentAccess es undefined (no calculado), no se activa.
    if (m.hasContentAccess === false) return STUDENT_STATE.NO_ACCESS;

    // 4. REGISTERED_NO_LOGIN — sin lastLoginAt el estudiante no llegó.
    //    Aceptamos accountStatus 'invited' como señal corroborante.
    const noLogin = !l.lastLoginAt;
    if (noLogin) return STUDENT_STATE.REGISTERED_NO_LOGIN;

    // 5. ACTIVE_NO_PROGRESS — entró pero no avanzó.
    const hasReading = !!m.lastReadingEventAt || isPos(m.booksStarted) || isPos(m.progressPercentage);
    if (!hasReading) return STUDENT_STATE.ACTIVE_NO_PROGRESS;

    // 6. ACTIVE_PROGRESS — el caso positivo.
    return STUDENT_STATE.ACTIVE_PROGRESS;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Construye el status interpretable de un estudiante.
 *
 * @param {object} user — record del User (users_db).
 * @param {object} metrics — agregado de lectura/asignaciones/acceso:
 *    {
 *      inAnyGroup?:         boolean,
 *      hasContentAccess?:   boolean,
 *      lastReadingEventAt?: string|null,   // ISO timestamp
 *      booksStarted?:       number,
 *      booksCompleted?:     number,
 *      progressPercentage?: number,        // 0..100, promedio o agregado
 *    }
 * @param {object} logs — eventos de uso/incidentes:
 *    {
 *      lastLoginAt?:        string|null,   // ISO timestamp
 *      recentErrorsCount?:  number,        // errores técnicos en 24h
 *    }
 *
 * @returns {object} StudentStatus con shape estable (ver studentStatus.d.ts).
 */
export function buildStudentStatus(user, metrics, logs) {
    const userId = user?.id ?? null;
    const name   = resolveDisplayName(user);

    // Si no hay user en absoluto, devolvemos un sentinel TECH_ISSUE — la UI
    // muestra siempre algo aun cuando el lookup falla.
    if (!user || typeof user !== 'object') {
        const narrative = STATE_NARRATIVE.TECH_ISSUE;
        return {
            userId:             null,
            name:               'Estudiante',
            state:              STUDENT_STATE.TECH_ISSUE,
            tone:               'error',
            headline:           'No se pudo identificar al estudiante.',
            message:            'No se encontró un registro de estudiante con ese identificador.',
            cause:              narrative.cause,
            recommendedAction:  'Verificar el identificador del estudiante o pedir apoyo al equipo técnico.',
            lastLoginAt:        null,
            lastReadingEventAt: null,
            progress: {
                booksStarted:   0,
                booksCompleted: 0,
                percentage:     0,
            },
        };
    }

    const state     = decideState(metrics, logs);
    const narrative = STATE_NARRATIVE[state];
    const m = metrics || {};
    const l = logs    || {};

    return {
        userId,
        name,
        state,
        tone:               STATE_TONE[state],
        headline:           narrative.headline,
        message:            narrative.message,
        cause:              narrative.cause,
        recommendedAction:  narrative.recommendedAction,
        lastLoginAt:        l.lastLoginAt        ?? null,
        lastReadingEventAt: m.lastReadingEventAt ?? null,
        progress: {
            booksStarted:   isNum(m.booksStarted)   ? m.booksStarted   : 0,
            booksCompleted: isNum(m.booksCompleted) ? m.booksCompleted : 0,
            percentage:     isNum(m.progressPercentage)
                ? Math.max(0, Math.min(100, m.progressPercentage))
                : 0,
        },
    };
}
