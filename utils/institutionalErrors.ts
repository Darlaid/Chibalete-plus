/**
 * institutionalErrors.ts — V9 F5-E2.
 *
 * Texto para la persona cuando una consulta institucional (seguimiento de un lector, analítica de un
 * curso o de un grupo) no se puede atender. El servidor responde con códigos pensados para programas
 * (`scope_access_denied`, `individual_access_unavailable`, `identity_unavailable`); ninguno debe
 * llegar a la pantalla tal cual.
 *
 * Solo presentación: no decide permisos ni reinterpreta la respuesta. Un 403 se explica como falta
 * de habilitación, sin decir cuál (no revela si falta la autorización del lector o el compromiso del
 * mediador); un 503 se explica como indisponibilidad temporal, nunca como falta de permiso.
 */
export type InstitutionalSubject = 'reader' | 'course' | 'group';

const CODES = /^(scope_access_denied|individual_access_unavailable|identity_unavailable|identity_not_established)$/;

/** true si el texto es un código de servidor y no una frase para personas. */
export function isServerErrorCode(text: unknown): boolean {
    return typeof text === 'string' && (CODES.test(text.trim()) || /^[a-z0-9]+(_[a-z0-9]+)+$/.test(text.trim()));
}

const UNAVAILABLE: Record<InstitutionalSubject, string> = {
    reader: 'El seguimiento individual no está disponible en este momento. Es una interrupción temporal del servicio, no un cambio en tus permisos. Inténtalo de nuevo en unos minutos.',
    course: 'La analítica del curso no está disponible en este momento. Es una interrupción temporal del servicio, no un cambio en tus permisos. Inténtalo de nuevo en unos minutos.',
    group:  'La información del grupo no está disponible en este momento. Es una interrupción temporal del servicio, no un cambio en tus permisos. Inténtalo de nuevo en unos minutos.',
};
const FORBIDDEN: Record<InstitutionalSubject, string> = {
    reader: 'El seguimiento individual de este lector no está habilitado para tu cuenta. Si crees que debería estarlo, consulta con la coordinación de tu institución.',
    course: 'No tienes acceso a la analítica de este curso. Si eres su mediador, pide a la administración de tu institución que revise la asignación.',
    group:  'No tienes acceso a este grupo como mediador asignado. Pide a la administración de tu institución que revise la asignación del grupo.',
};
const SIGNED_OUT = 'Tu sesión terminó. Vuelve a iniciar sesión para continuar.';

/**
 * Frase para mostrar ante un fallo HTTP de una consulta institucional.
 * @param status  código HTTP de la respuesta (0 o undefined si no hubo respuesta)
 * @param serverText  `error` del cuerpo, si lo hay; se muestra solo si ya es una frase
 */
export function describeInstitutionalError(subject: InstitutionalSubject, status?: number, serverText?: unknown): string {
    if (status === 503) return UNAVAILABLE[subject];
    if (status === 401) return SIGNED_OUT;
    if (status === 403) {
        // «Acceso denegado» y similares ya son frases; un código, no.
        return typeof serverText === 'string' && serverText.trim() && !isServerErrorCode(serverText) && serverText.trim() !== 'Acceso denegado'
            ? serverText.trim() : FORBIDDEN[subject];
    }
    if (typeof serverText === 'string' && serverText.trim() && !isServerErrorCode(serverText)) return serverText.trim();
    return subject === 'reader' ? 'No se pudo consultar el estado del lector. Inténtalo de nuevo.'
        : subject === 'course' ? 'No se pudo cargar la analítica del curso. Inténtalo de nuevo.'
        : 'No se pudo cargar la información del grupo. Inténtalo de nuevo.';
}

/**
 * Curso sin lectores con seguimiento habilitado: no es un resultado pedagógico. Distingue la nómina
 * del curso (cuántos estudiantes tiene), los lectores habilitados para seguimiento (ninguno) y la
 * consecuencia (no hay información consultable). No afirma nada sobre el desempeño del grupo.
 * @param rosterCount  estudiantes en la nómina del curso, o null si no se conoce
 */
export function describeNoEligibleReaders(rosterCount: number | null): { title: string; roster: string; body: string } {
    const roster = rosterCount == null ? 'Nómina del curso: no disponible.'
        : rosterCount === 0 ? 'Nómina del curso: sin estudiantes registrados.'
        : `Nómina del curso: ${rosterCount} ${rosterCount === 1 ? 'estudiante' : 'estudiantes'}.`;
    return {
        title: 'Sin lectores con seguimiento habilitado',
        roster,
        body: rosterCount === 0
            ? 'Este curso todavía no tiene estudiantes en su nómina, así que no hay información que consultar.'
            : 'Ningún lector de este curso tiene habilitado el seguimiento individual para tu cuenta, así que no hay información consultable. Esto no describe la actividad ni el nivel lector del grupo. Los datos generales del grupo siguen en Aula Viva.',
    };
}

/**
 * V9 F5-E4 — vista AGREGADA del curso (sesión de administración): el servidor entrega el curso entero en
 * totales y promedios, sin desglose por estudiante. Se dice; no se pinta una lista vacía.
 */
export const AGGREGATE_VIEW_NOTE = 'Vista agregada del curso: la sesión de administración muestra totales y promedios, sin desglose por estudiante.';
export function describeRosterCount(n: number): string {
    return `${n} ${n === 1 ? 'estudiante' : 'estudiantes'} en la nómina`;
}

/** «6 lectores con seguimiento habilitado · nómina del curso: 7», o solo el recuento si coinciden o no se conoce la nómina. */
export function describeReaderCoverage(eligible: number, rosterCount: number | null): string {
    const base = `${eligible} ${eligible === 1 ? 'lector con seguimiento habilitado' : 'lectores con seguimiento habilitado'}`;
    return rosterCount != null && rosterCount > eligible ? `${base} · nómina del curso: ${rosterCount}` : base;
}
