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
 * V9 BI-65C — la pantalla ya mostraba información y, al volver a consultar, el servidor dejó de autorizarla (o no pudo
 * confirmarla). Se dice que se retiró y por qué, sin revelar qué permiso cambió ni de quién.
 */
export function describeAccessWithdrawn(subject: InstitutionalSubject, status?: number): string {
    const what = subject === 'reader' ? 'del lector' : subject === 'course' ? 'del curso' : 'del grupo';
    if (status === 401) return `Se retiró de la pantalla la información ${what}. ${SIGNED_OUT}`;
    if (status === 403) return `La información ${what} que estabas viendo dejó de estar disponible para tu cuenta y se retiró de la pantalla. ${FORBIDDEN[subject]}`;
    return `Se retiró de la pantalla la información ${what} porque en este momento no se puede confirmar que siga disponible para tu cuenta. ${UNAVAILABLE[subject]}`;
}

/**
 * V9 65E-A — el servidor retuvo la nómina de los grupos para esta cuenta (llegan sin estudiantes). No es un grupo
 * vacío ni un error: se dice que la lista no está disponible y a quién acudir, sin nombrar qué permiso falta.
 */
export const ROSTER_WITHHELD_NOTICE = 'La lista de estudiantes de tus grupos no está disponible para tu cuenta en este momento, así que no se muestra. '
    + 'Esto no significa que los grupos estén vacíos. Pide a la administración de tu institución que revise tu habilitación como mediador.';

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
/**
 * V9 65E-B — desde cuándo es completa la actividad con la que se calcularon las cifras. El registro de sesiones de los
 * visores web y de la aplicación de lectura sin conexión conserva una cantidad limitada de entradas; cuando está lleno,
 * lo más antiguo ya no entra en el cálculo. Se dice con la fecha, para que una cifra menor no se lea como menos lectura.
 */
export type ActivityDataCoverage = { telemetry?: { rolling: boolean; from: number | null }; leo?: { rolling: boolean; from: number | null } };
export function describeActivityCoverage(coverage: ActivityDataCoverage | null | undefined): string | null {
    const day = (ms: number | null | undefined) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toLocaleDateString('es', { dateStyle: 'medium' }) : null);
    const parts: string[] = [];
    if (coverage?.telemetry?.rolling) {
        const d = day(coverage.telemetry.from);
        parts.push(`Las sesiones y el tiempo de lectura registrados por los visores web y por la aplicación de lectura sin conexión se calculan con la actividad recibida ${d ? `desde el ${d}` : 'más recientemente'}: la anterior ya no está disponible para este cálculo.`);
    }
    if (coverage?.leo?.rolling) {
        const d = day(coverage.leo.from);
        parts.push(`Las interacciones con Leo se cuentan ${d ? `desde el ${d}` : 'solo en su tramo más reciente'}.`);
    }
    return parts.length > 0 ? `${parts.join(' ')} Una cifra menor que la de una consulta anterior no significa menos lectura.` : null;
}
/** 65E-B — de cada obra se conservan las últimas 20 sesiones del lector EPUB: con ese registro lleno, el total es un mínimo. */
export const SESSION_HISTORY_CAPPED_NOTE = 'de cada obra se conservan las últimas 20 sesiones registradas por el lector EPUB, así que el total real puede ser mayor';

export const AGGREGATE_VIEW_NOTE = 'Vista agregada del curso: la sesión de administración muestra totales y promedios, sin desglose por estudiante.';
export function describeRosterCount(n: number): string {
    return `${n} ${n === 1 ? 'estudiante' : 'estudiantes'} en la nómina`;
}

/** «6 lectores con seguimiento habilitado · nómina del curso: 7», o solo el recuento si coinciden o no se conoce la nómina. */
export function describeReaderCoverage(eligible: number, rosterCount: number | null): string {
    const base = `${eligible} ${eligible === 1 ? 'lector con seguimiento habilitado' : 'lectores con seguimiento habilitado'}`;
    return rosterCount != null && rosterCount > eligible ? `${base} · nómina del curso: ${rosterCount}` : base;
}
