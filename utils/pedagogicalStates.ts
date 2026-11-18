/**
 * pedagogicalStates.ts — V9 F7-C2R-U3C.
 *
 * Textos para docentes de los estados que el servidor declara en las consultas pedagógicas de mediación (Leo del
 * mediador, impacto de intervenciones, estado del estudiante). Solo presentación: no calcula indicadores, no decide
 * permisos y no reinterpreta la respuesta. Un estado que no permite calcular se explica; nunca se pinta como cero.
 */

export type DataState = 'ok' | 'no_activity' | 'insufficient' | 'no_course_works';

export interface StateText { kind: string; title: string; body: string }

/**
 * Estado de la evidencia del contexto del curso. Devuelve null cuando hay evidencia suficiente (`ok`).
 * @param state   `data_state` del servidor
 * @param reason  `reason` del servidor (precisa por qué no alcanza)
 * @param subject `leo` cuando el estado es el de las evidencias de Leo, no el de toda la lectura del curso
 */
export function describeDataState(state: unknown, reason?: unknown, subject: 'course' | 'leo' = 'course'): StateText | null {
    if (state === 'ok') return null;
    if (state === 'no_course_works' || reason === 'no_course_works') {
        return { kind: 'no_course_works', title: 'Curso sin obras asociadas',
            body: 'Los cursos que compartes con este lector no tienen obras asociadas, así que no hay lectura del curso que analizar. Esto no describe cuánto lee. Asocia obras al curso para empezar a ver su acompañamiento.' };
    }
    if (reason === 'provenance_not_recorded') {
        return { kind: 'ledger_off', title: 'Registro contextual todavía no habilitado',
            body: 'La plataforma aún no registra desde cuándo cada obra pertenece al curso ni desde cuándo cada lector está en él. Sin esas fechas no se puede saber qué actividad es del curso, y por eso no se muestran indicadores. No significa que el lector no lea.' };
    }
    if (reason === 'unverifiable_history') {
        return { kind: 'unverifiable_history', title: 'Lectura histórica no atribuible al curso',
            body: 'Hay actividad de este lector, pero ocurrió antes de que la obra se asignara al curso, antes de su ingreso o antes de que se registraran esas fechas. No se usa para calcular indicadores del curso ni se interpreta como falta de lectura.' };
    }
    if (state === 'no_activity' && subject === 'leo') {
        // Leo trabaja con SUS evidencias (conversaciones y sesiones acompañadas): que no las haya no dice que el lector no lea.
        return { kind: 'no_activity', title: 'Leo aún no tiene evidencia de este lector en el curso',
            body: 'En el período observado no hay conversaciones con Leo ni sesiones acompañadas por Leo en obras del curso, así que no hay lectura pedagógica que ofrecer. Esto no describe cuánto lee: su avance se ve en el estado del estudiante.' };
    }
    if (state === 'no_activity') {
        return { kind: 'no_activity', title: 'Sin actividad en el curso',
            body: 'No hay actividad registrada de este lector en las obras del curso durante el período observado. No se muestran indicadores.' };
    }
    return { kind: 'insufficient', title: 'Información insuficiente',
        body: 'Todavía hay muy poca actividad del curso para calcular indicadores confiables. Se mostrarán cuando haya más evidencia; mientras tanto no se afirma nada sobre el lector.' };
}

/** Etiqueta para docentes del estado del estudiante (el código del servidor nunca se muestra). */
const STUDENT_STATE_LABEL: Record<string, string> = {
    ACTIVE_PROGRESS: 'Activo con avance',
    ACTIVE_NO_PROGRESS: 'Activo sin avance',
    ACTIVE_UNVERIFIED_HISTORY: 'Lectura no atribuible al curso',
    NO_COURSE_WORKS: 'Curso sin obras',
    REGISTERED_NO_LOGIN: 'Nunca ha ingresado',
    NO_GROUP: 'Sin grupo',
    NO_ACCESS: 'Sin contenido habilitado',
    TECH_ISSUE: 'Posible problema técnico',
};
export function studentStateLabel(state: unknown): string {
    return (typeof state === 'string' && STUDENT_STATE_LABEL[state]) || 'Estado por confirmar';
}

const OBJECTIVE_LABEL: Record<string, string> = {
    literal: 'Comprensión literal', inferential: 'Inferencia', critical: 'Pensamiento crítico', vocabulary: 'Vocabulario',
    vocab: 'Vocabulario', writing: 'Escritura', emotional: 'Conexión emocional', metacognitive: 'Metacognición',
    reflection: 'Reflexión', orality: 'Oralidad',
};
/** Objetivo pedagógico o tipo de apoyo en palabras de aula; null si el servidor no lo declara. */
export function objectiveLabel(key: unknown): string | null {
    if (typeof key !== 'string' || !key.trim()) return null;
    return OBJECTIVE_LABEL[key] ?? key.replace(/_/g, ' ');
}

const ACTIVATION_LABEL: Record<string, string> = {
    family: 'Mensaje para la familia', continuity: 'Mensaje de continuidad para el lector',
    recommendation: 'Lectura recomendada', production: 'Propuesta de producción para el lector',
};
export function activationLabel(type: unknown): string {
    return (typeof type === 'string' && ACTIVATION_LABEL[type]) || 'Sugerencia';
}

const TREND_LABEL: Record<string, string> = { escalating: 'Aumenta la exigencia', stable: 'Estable', supported: 'Necesita más apoyo' };
export function trendLabel(t: unknown): string | null {
    return typeof t === 'string' && t ? (TREND_LABEL[t] ?? t.replace(/_/g, ' ')) : null;
}

// ── Impacto de intervenciones ───────────────────────────────────────────────

export type ImpactState = 'pending' | 'insufficient' | 'calculated';

export interface ImpactRow {
    outcome_id: string; intervention_id: string; user_id: string; intervention_type: string; created_at: number;
    data_state: string; reason?: string | null; followup_due_at?: number;
    outcome_label: string | null; confidence: number | null; evidence_level: string | null;
    baseline_metrics: Record<string, number | null> | null;
    followup_metrics: Record<string, number | null> | null;
    delta_metrics: Record<string, number> | null;
}

/** Los tres estados que la evaluación distingue. Solo `calculated` trae un resultado. */
export function impactStateOf(row: Pick<ImpactRow, 'data_state' | 'outcome_label'>): ImpactState {
    if (row.data_state === 'pending') return 'pending';
    return ['improved', 'stable', 'worsened', 'mixed'].includes(String(row.outcome_label)) ? 'calculated' : 'insufficient';
}

const OUTCOME_LABEL: Record<string, string> = { improved: 'Mejoró', stable: 'Se mantuvo', worsened: 'Empeoró', mixed: 'Resultado mixto' };
export function outcomeLabel(label: unknown): string {
    return (typeof label === 'string' && OUTCOME_LABEL[label]) || 'Sin resultado';
}

const INTERVENTION_LABEL: Record<string, string> = {
    lectura_guiada: 'Lectura guiada', acompanamiento: 'Acompañamiento', conversacion: 'Conversación', seguimiento: 'Seguimiento',
    // Tipos del tablero del curso (mismas etiquetas que su formulario «Anotar intervención»).
    sesion_acompanada: 'Sesión acompañada', retomar_contenido: 'Retomar contenido', cambio_texto: 'Cambio de texto',
    contacto_familia: 'Contacto con familia', seguimiento_remoto: 'Seguimiento remoto', otro: 'Otro',
};
export function interventionLabel(type: unknown): string {
    if (typeof type !== 'string' || !type) return 'Intervención';
    return INTERVENTION_LABEL[type] ?? (type.charAt(0).toUpperCase() + type.slice(1)).replace(/_/g, ' ');
}

/** Métricas de la comparación antes/después que se muestran, en este orden. `pct`: proporción 0..1; `min`: minutos. */
export const IMPACT_METRICS: ReadonlyArray<{ key: string; label: string; unit: 'pct' | 'min' }> = [
    { key: 'continuidad', label: 'Continuidad (días con actividad, sobre 7)', unit: 'pct' },
    { key: 'abandono', label: 'Abandono temprano (sobre inicios y abandonos)', unit: 'pct' },
    { key: 'tiempo_efectivo', label: 'Tiempo de lectura', unit: 'min' },
    { key: 'completitud', label: 'Lecturas terminadas (sobre inicios registrados)', unit: 'pct' },
];

/** Valor de una métrica para pantalla. Un valor que el servidor no calculó es «sin dato», nunca 0. */
export function formatImpactValue(value: number | null | undefined, unit: 'pct' | 'min'): string {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 'sin dato';
    return unit === 'pct' ? `${Math.round(value * 100)} %` : `${Math.round(value)} min`;
}

export function describeImpactState(row: Pick<ImpactRow, 'data_state' | 'outcome_label' | 'followup_due_at' | 'reason'>, formatDate: (ms: number) => string): string {
    const st = impactStateOf(row);
    if (st === 'pending') {
        return `En seguimiento: la comparación estará disponible ${typeof row.followup_due_at === 'number' ? `desde el ${formatDate(row.followup_due_at)}` : 'cuando termine el período de observación'}. Todavía no hay resultado.`;
    }
    if (st === 'insufficient' && row.reason === 'unverifiable_history') {
        return 'No evaluable: la actividad del lector alrededor de esta intervención no puede atribuirse al curso (ocurrió antes de la asignación, de su ingreso o de que se registraran esas fechas). No se afirma mejoría ni deterioro.';
    }
    if (st === 'insufficient' && row.reason === 'no_course_works') {
        return 'No evaluable: el curso no tiene obras asociadas, así que no hay actividad del curso que comparar.';
    }
    if (st === 'insufficient') {
        return 'Evidencia insuficiente: no hubo suficiente actividad del curso antes y después de la intervención para compararlas. No se afirma mejoría ni deterioro.';
    }
    return `Resultado calculado: ${outcomeLabel(row.outcome_label).toLowerCase()}.`;
}

// ── Analítica colectiva (V9 F7-C2R-U3D) ─────────────────────────────────────

const RULE_LABEL: Record<string, string> = {
    abandono_alto: 'Patrón de abandono temprano', fatiga_lectora: 'Posible fatiga lectora',
    invisibilidad_prolongada: 'Sin actividad lectora reciente', alta_autonomia: 'Buen momento para explorar más géneros',
    diversidad_baja: 'Lectura concentrada en pocos contenidos', deterioro_continuidad: 'Continuidad semanal descendió',
    mejora_destacada: 'Mejora notable en compromiso lector', habito_emergente: 'Hábito de lectura emergente',
};
/** Nombre para docentes de una regla pedagógica (las mismas etiquetas de las recomendaciones individuales). */
export function ruleLabel(id: unknown): string {
    return (typeof id === 'string' && RULE_LABEL[id]) || (typeof id === 'string' ? id.replace(/_/g, ' ') : 'Observación');
}

/** Nombre para docentes de una cohorte; la clave técnica (`risk:abandono_alto`) nunca se muestra. */
export function cohortLabel(c: { cohort_type: string; scope_id: string }, groupName?: (id: string) => string | undefined): string {
    switch (c.cohort_type) {
        case 'group': return `Curso: ${groupName?.(c.scope_id) ?? 'curso'}`;
        case 'club': return `Club: ${groupName?.(c.scope_id) ?? 'club de lectura'}`;
        case 'school': return 'Colegio';
        case 'habit': return c.scope_id === 'high_continuity' ? 'Hábito: continuidad alta de lectura' : 'Hábito de lectura';
        case 'trajectory': return c.scope_id === 'recovered_after_risk' ? 'Trayectoria: superaron una señal de riesgo' : 'Trayectoria';
        case 'modality': return c.scope_id === 'audio_plus_immersive' ? 'Modalidad: lectura inmersiva y con audio' : 'Modalidad de lectura';
        case 'intervention': return `Estrategia recibida: ${interventionLabel(c.scope_id)}`;
        case 'risk': return `Señal activa: ${ruleLabel(c.scope_id)}`;
        default: return 'Cohorte';
    }
}

/**
 * Estado de la evidencia de un agregado colectivo (una trayectoria, los patrones). null si hay lectores con
 * indicadores. Nunca afirma nada sobre cómo lee el grupo.
 */
export function describeCollectiveState(state: unknown, reason?: unknown): StateText | null {
    if (state === 'ok' || state === undefined || state === null) return null;
    if (state === 'no_eligible_readers') {
        return { kind: 'no_eligible_readers', title: 'Sin lectores con seguimiento habilitado',
            body: 'Ningún lector de tus cursos tiene habilitado el seguimiento individual para tu cuenta, así que no hay información colectiva que calcular. Esto no describe la actividad del grupo.' };
    }
    if (state === 'no_course_works' || reason === 'no_course_works') {
        return { kind: 'no_course_works', title: 'Curso sin obras asociadas',
            body: 'El curso no tiene obras asociadas, así que no hay lectura del curso con la que calcular agregados. Esto no describe cuánto leen sus estudiantes.' };
    }
    if (reason === 'provenance_not_recorded') {
        return { kind: 'ledger_off', title: 'Registro contextual todavía no habilitado',
            body: 'La plataforma aún no registra desde cuándo cada obra pertenece al curso ni desde cuándo cada lector está en él. Sin esas fechas no se puede saber qué actividad es del curso y no se calculan agregados. No significa que el grupo no lea.' };
    }
    if (reason === 'unverifiable_history') {
        return { kind: 'unverifiable_history', title: 'Lectura histórica no atribuible al curso',
            body: 'La actividad registrada ocurrió antes de la asignación de las obras, del ingreso de los lectores o del registro de esas fechas. No se usa para calcular agregados del curso ni se interpreta como falta de lectura.' };
    }
    if (state === 'no_activity') {
        return { kind: 'no_activity', title: 'Sin actividad en las obras del curso',
            body: 'No hay lectura registrada de las obras del curso en el período observado. No se calculan agregados.' };
    }
    return { kind: 'insufficient', title: 'Información insuficiente',
        body: 'Todavía hay muy poca actividad del curso para calcular agregados confiables. Se mostrarán cuando haya más evidencia.' };
}

/** Texto para una serie o un agregado que no se entrega por tener menos lectores que el mínimo de divulgación. */
export function describeSuppressed(min: number, members?: number): string {
    return `Esta cohorte reúne ${typeof members === 'number' ? `${members} ${members === 1 ? 'lector' : 'lectores'} con seguimiento` : 'pocos lectores'}; los agregados solo se muestran con al menos ${min}, para que no describan a personas concretas. No significa que no haya actividad.`;
}

/** Indicación de un aprendizaje sin la etiqueta técnica del ámbito («En el scope group:g-a, …»). */
export function learningHintText(hint: unknown, scopeType?: string): string {
    if (typeof hint !== 'string') return '';
    const where = scopeType === 'group' ? 'En este curso' : scopeType === 'club' ? 'En este club' : scopeType === 'cursos' ? 'En tus cursos' : null;
    return where ? hint.replace(/^En el scope [^,]+,/, `${where},`).replace(/"([a-z_]+)"/g, (_m, t) => `«${interventionLabel(t)}»`) : hint;
}
