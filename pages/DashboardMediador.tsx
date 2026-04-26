import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    ArrowLeft, AlertTriangle, Info, AlertCircle,
    Users, Clock, Zap, CheckCircle, BookOpen,
    ChevronUp, ChevronDown, Lightbulb, FileText, X, PenLine,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

interface Alert {
    type: string;
    severity: 'low' | 'medium' | 'high';
    message: string;
}

interface ProductMetrics {
    totalSessions: number;
    totalReadingTimeMs: number;
    avgSessionDurationMs: number;
    avgBlocksPerSession: number;
    tranceEntryRate: number;
    autoTransitionRate: number;
    completionRate: number;
    avgProgressPercentage: number;
    avgPeakStreak: number;
    streakBreakRate: number;
    distinctContentsRead: number;
    rereadsRate: number;
}

interface ReadingLevels {
    literal: number;
    inferential: number;
    critical: number;
    reflective: number;
    composite: number;
}

interface ICDLIScores {
    comprehension: number;
    integration: number;
    inference: number;
    criticalThinking: number;
    contextConnection: number;
    metacognition: number;
    ideaProduction: number;
    oralWriting: number;
}

interface PedagogicalProfile {
    readingConsistencyScore:  number;
    weeklyPresenceRate:       number;
    weekendReadingRate:       number;
    conversationalDepthScore: number;
}

interface StudentRow {
    userId: string;
    name: string;
    hasData: boolean;
    needsAttention: boolean;
    totalSessions: number;
    totalReadingTimeMs: number;
    composite: number;
    literal: number;
    inferential: number;
    critical: number;
    reflective: number;
    level: string;
    totalLeoInteractions: number;
    totalLeoOfflineAttempts: number;
    dominantLeoType: string | null;
    lastAccessAt: number | null;
    contentsInProgress: number;
    contentsCompleted: number;
    contentsAbandoned: number;
    pedagogicalProfile?: PedagogicalProfile;
    readingDetails: {
        inProgress: Array<{ contentId: string; title: string; type: string | null; progressPercentage: number; totalReadingTimeMs: number }>;
        completed:  Array<{ contentId: string; title: string; type: string | null; lastReadAt: string | null }>;
        abandoned:  Array<{ contentId: string; title: string; type: string | null; progressPercentage: number }>;
    };
}

interface CourseMetrics {
    courseId: string;
    courseName: string;
    computedAt: number;
    summary: {
        studentCount: number;
        activeStudentCount: number;
        engagementRate: number;
        avgComposite: number;
        level: string;
        totalLeoInteractions: number;
        totalLeoOfflineAttempts: number;
    };
    productMetrics: ProductMetrics;
    readingLevels: ReadingLevels;
    icdli: ICDLIScores;
    alerts: Alert[];
    studentBreakdown: StudentRow[];
}

interface SuccessPattern {
    pattern: string;
    type: string;
    total: number;
    improved: number;
    improvementRate: number;
}

interface CoursePedagogicalProfile {
    readingConsistencyScore:  number;
    weeklyPresenceRate:       number;
    weekendReadingRate:       number;
    conversationalDepthScore: number;
    studentCount:             number;
    activeCount:              number;
}

interface EffectivenessData {
    totalInterventions: number;
    totalImproved: number;
    overallImprovementRate: number;
    overallImmediateRate: number;
    overallSustainedRate: number;
    totalAssessed: number;
    topTypes: Array<{ type: string; total: number; improved: number; improvementRate: number }>;
    successPatterns: SuccessPattern[];
    coursePedagogicalProfile: CoursePedagogicalProfile | null;
}

interface Intervention {
    id: string;
    mediatorId: string;
    studentId: string;
    courseId: string;
    type: string;
    note: string;
    contentId: string | null;
    patternsAtIntervention: string[];
    readingTimeMsAtIntervention: number;
    createdAt: string;
}

// ---------------------------------------------------------------------------
// STATIC MAPS
// ---------------------------------------------------------------------------

const LEVEL_COLORS: Record<string, string> = {
    'Avanzado':      'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    'En desarrollo': 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    'Básico':        'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    'Inicial':       'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const ALERT_CONFIG: Record<Alert['severity'], { icon: React.ReactNode; cls: string }> = {
    high:   { icon: <AlertCircle size={15} />,   cls: 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300' },
    medium: { icon: <AlertTriangle size={15} />, cls: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300' },
    low:    { icon: <Info size={15} />,          cls: 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300' },
};

/**
 * Pedagogical implication shown below each alert message.
 * Explains WHY the alert matters for learning, not just what was detected.
 */
const ALERT_IMPLICATIONS: Partial<Record<string, string>> = {
    low_trance:          'Los estudiantes que no entran en flujo de concentración procesan los textos de forma superficial, lo que limita la comprensión profunda y la retención a largo plazo.',
    low_continuity:      'La lectura fragmentada dificulta la construcción de significado global del texto. Los estudiantes pueden comprender párrafos aislados pero perder la coherencia narrativa.',
    low_inference:       'Sin habilidad inferencial, los lectores dependen de lo explícito y tienen dificultad para interpretar metáforas, intenciones del autor o información implícita.',
    low_sessions:        'Con pocas sesiones, las métricas son poco fiables. Además, la lectura sostenida requiere frecuencia para desarrollar hábito y progresión.',
    low_engagement:      'Los estudiantes inactivos no generan señales pedagógicas y pueden estar experimentando barreras de acceso, motivación o tiempo.',
    leo_offline_barrier: 'Los estudiantes están intentando consultar a Leo sin conexión a internet. Esto puede indicar que leen en contextos con conectividad limitada o nula.',
};

/**
 * Suggested pedagogical action for each alert type.
 * Shown in the action block at the bottom of the dashboard.
 */
const ALERT_ACTIONS: Partial<Record<string, string>> = {
    low_trance:          'Introduce momentos de lectura ininterrumpida de al menos 10–15 minutos. Reduce las notificaciones y asegúrate de que los textos son adecuados al nivel del grupo.',
    low_continuity:      'Revisa si los textos asignados están alineados con el nivel lector del grupo. Considera empezar con textos más cortos que permitan completar la lectura en una sesión.',
    low_inference:       'Diseña actividades de predicción antes de leer y preguntas inferenciales después. Pide a los estudiantes que expliquen "¿qué crees que quiso decir el autor con…?"',
    low_sessions:        'Establece una rutina mínima de lectura semanal (ej. 3 sesiones de 15 minutos). Comparte el progreso del grupo con los estudiantes para generar motivación colectiva.',
    low_engagement:      'Identifica qué estudiantes no han iniciado y realiza un seguimiento directo. Considera si hay barreras de acceso técnico o de motivación que abordar con la familia.',
    leo_offline_barrier: 'Verifica que los estudiantes tengan acceso a internet cuando usan la app de lectura. Considera coordinar horarios de lectura donde haya WiFi disponible.',
};

const LEO_TYPE_LABELS: Record<string, string> = {
    vocab:       'Vocabulario',
    question:    'Preguntas',
    inferential: 'Inferencial',
    reflection:  'Reflexión',
};

const ICDLI_LABELS: Record<keyof ICDLIScores, string> = {
    comprehension:    'Comprensión',
    integration:      'Integración',
    inference:        'Inferencia',
    criticalThinking: 'Pensamiento crítico',
    contextConnection:'Conexión contextual',
    metacognition:    'Metacognición',
    ideaProduction:   'Producción de ideas',
    oralWriting:      'Expresión',
};

const ICDLI_LEVEL: Record<number, string> = { 1: 'Inicial', 2: 'Básico', 3: 'En desarrollo', 4: 'Avanzado' };

const INTERVENTION_TYPES = [
    { value: 'sesion_acompanada',  label: 'Sesión acompañada'   },
    { value: 'retomar_contenido',  label: 'Retomar contenido'   },
    { value: 'cambio_texto',       label: 'Cambio de texto'     },
    { value: 'contacto_familia',   label: 'Contacto con familia'},
    { value: 'seguimiento_remoto', label: 'Seguimiento remoto'  },
    { value: 'otro',               label: 'Otro'                },
];

const INTERVENTION_TYPE_LABELS: Record<string, string> = Object.fromEntries(
    INTERVENTION_TYPES.map(t => [t.value, t.label])
);

// ---------------------------------------------------------------------------
// STUDENT PATTERNS
// ---------------------------------------------------------------------------

interface StudentPatternDef {
    type: string;
    severity: 'high' | 'medium' | 'low' | 'positive';
    label: string;
    explanation: string;
    action: string;
}

const STUDENT_PATTERNS: StudentPatternDef[] = [
    {
        type: 'sin_actividad',
        severity: 'high',
        label: 'Sin actividad',
        explanation: 'No ha registrado sesiones de lectura.',
        action: 'Contactar al estudiante para verificar acceso a la plataforma y descartar barreras técnicas.',
    },
    {
        type: 'dificultad_comprension',
        severity: 'high',
        label: 'Dificultad de comprensión',
        explanation: 'Invierte tiempo en la lectura pero muestra señales de dificultad en la comprensión.',
        action: 'Proponer textos de menor dificultad y trabajar vocabulario clave antes de la lectura.',
    },
    {
        type: 'lectura_fragmentada',
        severity: 'medium',
        label: 'Lectura fragmentada',
        explanation: 'Lee con cierta frecuencia pero no logra consolidar la comprensión del texto.',
        action: 'Proponer bloques de lectura continua de 10–15 minutos sin interrupciones.',
    },
    {
        type: 'dependencia_leo',
        severity: 'medium',
        label: 'Alta dependencia de Leo',
        explanation: 'Consulta a Leo con alta frecuencia — puede necesitar apoyo para la comprensión autónoma.',
        action: 'Trabajar estrategias de inferencia de vocabulario antes de recurrir al asistente.',
    },
    {
        type: 'barrera_conectividad',
        severity: 'medium',
        label: 'Barrera de conectividad',
        explanation: 'Intenta usar Leo sin conexión. Puede leer en contextos con internet limitado.',
        action: 'Verificar condiciones de conectividad y coordinar horarios con acceso a WiFi.',
    },
    {
        type: 'sesiones_cortas',
        severity: 'low',
        label: 'Sesiones muy cortas',
        explanation: 'Lee con frecuencia pero en sesiones muy cortas (menos de 5 minutos en promedio).',
        action: 'Establecer un mínimo de 10 minutos por sesión y crear un ambiente sin distracciones.',
    },
    {
        type: 'perfil_consolidado',
        severity: 'positive',
        label: 'Perfil consolidado',
        explanation: 'Lectura sostenida con buen progreso — hábito lector establecido.',
        action: 'Proponer textos de mayor complejidad o actividades de creación a partir de la lectura.',
    },
];

const PATTERN_MAP = Object.fromEntries(STUDENT_PATTERNS.map(p => [p.type, p]));

/**
 * Three thematic groups that reduce the 8 ICDLI dimensions to a scannable structure.
 * Comprensión: decoding and making sense of what is read.
 * Pensamiento: higher-order evaluation and metacognitive awareness.
 * Expresión:   production, synthesis and communication from reading.
 */
const ICDLI_GROUPS: Array<{ title: string; keys: (keyof ICDLIScores)[] }> = [
    { title: 'Comprensión lectora',  keys: ['comprehension', 'integration', 'inference'] },
    { title: 'Pensamiento crítico',  keys: ['criticalThinking', 'contextConnection', 'metacognition'] },
    { title: 'Expresión y creación', keys: ['ideaProduction', 'oralWriting'] },
];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function formatDuration(ms: number): string {
    const totalSec = Math.round(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m === 0) return `${s}s`;
    if (s === 0) return `${m}m`;
    return `${m}m ${s}s`;
}

function pct(rate: number): string {
    return `${Math.round(rate * 100)}%`;
}

/**
 * Generate one interpretive sentence for the course header.
 * Combines level, engagement rate, and alert presence into a plain-language summary.
 */
function buildSummaryInterpretation(
    summary: CourseMetrics['summary'],
    alerts: Alert[]
): string {
    if (summary.activeStudentCount === 0) {
        return 'Aún no hay actividad lectora registrada en este grupo.';
    }

    const levelPart = {
        'Avanzado':      'muestra un nivel lector avanzado',
        'En desarrollo': 'está en desarrollo lector activo',
        'Básico':        'se encuentra en un nivel lector básico',
        'Inicial':       'muestra señales iniciales de comprensión',
    }[summary.level] ?? 'tiene actividad lectora registrada';

    const engPct = Math.round(summary.engagementRate * 100);
    const engPart = engPct >= 75
        ? 'con alta participación del grupo'
        : engPct >= 45
        ? 'con participación moderada'
        : 'aunque con baja participación';

    const hasHigh = alerts.some(a => a.severity === 'high');
    const hasMed  = alerts.some(a => a.severity === 'medium');
    const alertPart = hasHigh
        ? 'Hay áreas críticas que requieren intervención.'
        : hasMed
        ? 'Hay aspectos que vale la pena fortalecer.'
        : 'El grupo avanza sin señales de alerta críticas.';

    return `El grupo ${levelPart} (${summary.avgComposite.toFixed(0)}/100) ${engPart}. ${alertPart}`;
}

/**
 * Derive a three-state status from the student's flags.
 * 'stable'    — active, composite ≥ 30
 * 'risk'      — active but composite < 30 (needsAttention + hasData)
 * 'attention' — no activity recorded
 */
function studentStatus(s: StudentRow): 'stable' | 'risk' | 'attention' {
    if (!s.hasData)          return 'attention';
    if (s.needsAttention)    return 'risk';
    return 'stable';
}

const STATUS_CONFIG = {
    stable:    { label: 'Estable',   dot: 'bg-emerald-400', cls: 'text-emerald-600 dark:text-emerald-400' },
    risk:      { label: 'En riesgo', dot: 'bg-amber-400',   cls: 'text-amber-600 dark:text-amber-400'   },
    attention: { label: 'Inactivo',  dot: 'bg-gray-300 dark:bg-gray-600',    cls: 'text-gray-400 dark:text-gray-500'    },
};

/**
 * Detect behavioral patterns for a single student from available StudentRow fields.
 * Returns an ordered list of pattern type strings (highest severity first).
 */
function detectStudentPatterns(student: StudentRow): string[] {
    if (!student.hasData) return ['sin_actividad'];

    const avgSessionMs = student.totalSessions > 0
        ? student.totalReadingTimeMs / student.totalSessions
        : 0;

    const patterns: string[] = [];

    // High severity
    if (student.totalReadingTimeMs > 1_200_000 && student.composite < 30) {
        patterns.push('dificultad_comprension');
    }
    // Medium severity — prefer real abandonment data over heuristic literal score
    const hasRealAbandonment = student.contentsAbandoned >= 1 && student.contentsCompleted === 0;
    if (hasRealAbandonment || (student.totalSessions >= 3 && student.literal < 25)) {
        patterns.push('lectura_fragmentada');
    }
    if (student.totalSessions >= 2 && student.totalLeoInteractions > 0 &&
        student.totalLeoInteractions / student.totalSessions > 1.5) {
        patterns.push('dependencia_leo');
    }
    if (student.totalLeoOfflineAttempts >= 2) {
        patterns.push('barrera_conectividad');
    }
    // Low severity
    if (student.totalSessions >= 3 && avgSessionMs > 0 && avgSessionMs < 300_000) {
        patterns.push('sesiones_cortas');
    }
    // Positive — use real completion data: at least 1 completed content
    if (patterns.length === 0 && student.contentsCompleted >= 1 && student.composite >= 40) {
        patterns.push('perfil_consolidado');
    } else if (patterns.length === 0 && student.totalSessions >= 3 && student.composite >= 55) {
        patterns.push('perfil_consolidado');
    }

    return patterns;
}

function buildStudentProfileSummary(student: StudentRow, patterns: string[]): string {
    if (!student.hasData) return 'No ha registrado actividad lectora aún.';
    if (patterns.length === 0) {
        const inProg = student.readingDetails.inProgress[0];
        if (inProg) return `Leyendo "${inProg.title}" (${inProg.progressPercentage}%) — ${student.totalSessions} sesiones.`;
        return `Lee con regularidad — ${student.totalSessions} sesión${student.totalSessions !== 1 ? 'es' : ''}, ${formatDuration(student.totalReadingTimeMs)} en total.`;
    }
    const primary = PATTERN_MAP[patterns[0]];
    if (!primary) return '';

    // Enrich pattern explanation with real content context where possible
    let base = primary.explanation;
    if (patterns[0] === 'lectura_fragmentada' && student.readingDetails.abandoned.length > 0) {
        const ab = student.readingDetails.abandoned[0];
        base = `Dejó "${ab.title}" al ${ab.progressPercentage}% sin terminar.`;
    } else if (patterns[0] === 'perfil_consolidado' && student.readingDetails.completed.length > 0) {
        const titles = student.readingDetails.completed.slice(0, 2).map(c => `"${c.title}"`).join(' y ');
        base = `Completó ${titles}. Lector activo con buen ritmo.`;
    } else if (patterns[0] === 'dificultad_comprension' && student.readingDetails.inProgress.length > 0) {
        const ip = student.readingDetails.inProgress[0];
        base = `Lleva ${formatDuration(ip.totalReadingTimeMs)} en "${ip.title}" (${ip.progressPercentage}%) con señales de dificultad.`;
    }

    const extras: string[] = [];
    if (patterns.includes('barrera_conectividad') && patterns[0] !== 'barrera_conectividad') {
        extras.push(`${student.totalLeoOfflineAttempts} intento${student.totalLeoOfflineAttempts > 1 ? 's' : ''} de Leo sin red`);
    }
    if (patterns.includes('dependencia_leo') && patterns[0] !== 'dependencia_leo') {
        extras.push('usa Leo con frecuencia');
    }
    return extras.length > 0 ? `${base} (${extras.join(', ')})` : base;
}

/**
 * Build a contextual, personalized action string for a student.
 * Uses real content titles when available; falls back to the static pattern action.
 */
function buildContextualAction(student: StudentRow, patterns: string[]): string {
    const primary   = patterns[0] ? PATTERN_MAP[patterns[0]] : null;
    if (!primary || primary.severity === 'positive') return '';

    const ip  = student.readingDetails.inProgress[0]  ?? null;
    const ab  = student.readingDetails.abandoned[0]   ?? null;
    const done = student.readingDetails.completed[0]  ?? null;
    const t   = (c: { title: string }) => `"${c.title}"`;

    switch (primary.type) {
        case 'lectura_fragmentada':
            if (ab)  return `Retomar ${t(ab)} — proponer sesiones continuas de 10–15 min sin interrupciones.`;
            if (ip)  return `Establecer bloques de 10–15 min continuos para ${t(ip)}.`;
            break;

        case 'dificultad_comprension':
            if (ip)  return `Trabajar vocabulario clave de ${t(ip)} antes de cada sesión.`;
            if (ab)  return `Retomar ${t(ab)} con textos de apoyo de nivel más accesible.`;
            break;

        case 'dependencia_leo':
            if (ip)  return `Practicar inferencias en ${t(ip)} antes de consultar a Leo.`;
            break;

        case 'barrera_conectividad':
            if (ip)  return `Coordinar horario con WiFi disponible para continuar ${t(ip)}.`;
            break;

        case 'sesiones_cortas':
            if (ip)  return `Reservar al menos 10 min continuos para ${t(ip)} en la próxima sesión.`;
            break;

        case 'perfil_consolidado':
            if (done) return `Proponer un texto más desafiante que ${t(done)}.`;
            break;
    }

    return primary.action; // static fallback
}

/**
 * Compare current student state to the snapshot stored when the intervention was created.
 * 'improved': reading time grew >20% OR a negative pattern resolved.
 * 'unchanged': neither condition met.
 */
function computeInterventionImpact(
    currentPatterns: string[],
    currentReadingTimeMs: number,
    intervention: Intervention
): 'improved' | 'unchanged' {
    const timeGrowth = intervention.readingTimeMsAtIntervention > 0
        ? currentReadingTimeMs / intervention.readingTimeMsAtIntervention
        : 1;
    if (timeGrowth > 1.2) return 'improved';

    const negativePatterns = ['sin_actividad', 'dificultad_comprension', 'lectura_fragmentada'];
    const prevNeg = intervention.patternsAtIntervention.filter(p => negativePatterns.includes(p)).length;
    const currNeg = currentPatterns.filter(p => negativePatterns.includes(p)).length;
    if (currNeg < prevNeg) return 'improved';

    return 'unchanged';
}

// Which pedagogical dimension each intervention type primarily targets (mirrors server)
const INTERVENTION_DIMENSION_MAP: Record<string, string[]> = {
    sesion_acompanada:  ['engagement', 'continuity'],
    retomar_contenido:  ['continuity'],
    cambio_texto:       ['engagement'],
    contacto_familia:   ['familySupport'],
    seguimiento_remoto: ['continuity'],
    otro:               [],
};

// Map behavioral pattern to primary dimension problem
const PATTERN_DIMENSION_MAP: Record<string, string> = {
    sin_actividad:          'continuity',
    lectura_fragmentada:    'continuity',
    dificultad_comprension: 'engagement',
    dependencia_leo:        'engagement',
    barrera_conectividad:   'continuity',
    sesiones_cortas:        'continuity',
    perfil_consolidado:     '',
};

function getRecommendedInterventionType(pattern: string, successPatterns: SuccessPattern[], problemDimension?: string): string | null {
    const relevant = successPatterns.filter(e => e.pattern === pattern);

    if (problemDimension) {
        const aligned = relevant.filter(e =>
            (INTERVENTION_DIMENSION_MAP[e.type] ?? []).includes(problemDimension)
        );
        if (aligned.length > 0 && aligned[0].improvementRate >= 0.35) return aligned[0].type;
        // No historical data — use dimension map directly
        const mapped = Object.entries(INTERVENTION_DIMENSION_MAP)
            .filter(([, dims]) => dims.includes(problemDimension))
            .map(([type]) => type);
        if (mapped.length > 0) return mapped[0];
    }

    if (relevant.length === 0) return null;
    return relevant[0].improvementRate >= 0.4 ? relevant[0].type : null;
}

// ---------------------------------------------------------------------------
// READER TYPOLOGIES
// ---------------------------------------------------------------------------

interface ReaderTypologyDef {
    name: string;
    description: string;
    familyMessage: string;
    immediateAction: string;
    readerExperience: string;
    ecosystem: { aula: string; familia: string; leo: string };
    trajectory: string;
    colorClass: string;
    badgeCls: string;
}

const READER_TYPOLOGIES: Record<string, ReaderTypologyDef> = {
    lector_consolidado: {
        name:             'Lector/a consolidado/a',
        description:      'Lee con regularidad y construye sentido profundo. Hábito establecido con conversación real.',
        familyMessage:    'Su hijo/a ya tiene el hábito de leer y hace preguntas profundas sobre lo que lee. Es un buen momento para ofrecerle textos más desafiantes o conversar juntos sobre lo que leyó.',
        immediateAction:  'Proponer un texto de mayor complejidad o de un género nuevo.',
        readerExperience: 'Narrativa larga, ensayo o textos con múltiples perspectivas.',
        ecosystem: {
            aula:    'Rol como par lector; círculos de debate sobre el texto.',
            familia: 'Preguntar qué fue lo más interesante; proponer leer el mismo libro.',
            leo:     'Invitar a preguntas de evaluación y reflexión crítica.',
        },
        trajectory: 'evaluar → transformar',
        colorClass: 'bg-emerald-400',
        badgeCls:   'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800',
    },
    constante_superficial: {
        name:             'Lector/a constante pero superficial',
        description:      'Lee con frecuencia y mantiene el hábito, pero la conversación sobre el texto es escasa.',
        familyMessage:    'Su hijo/a lee con constancia — eso es muy valioso. Ahora sería útil que conversen más sobre lo que lee: qué le sorprendió, qué no entendió, qué opina.',
        immediateAction:  'Abrir una conversación sobre el último texto: ¿qué fue lo más raro o interesante?',
        readerExperience: 'Textos que provoquen pregunta y diálogo, no solo seguimiento de historia.',
        ecosystem: {
            aula:    'Círculo de lectura con preguntas abiertas antes y después de leer.',
            familia: 'Una pregunta al día sobre el libro: "¿qué pasó hoy en el libro?"',
            leo:     'Invitar a preguntas inferenciales antes de buscar vocabulario.',
        },
        trajectory: 'reconocer → interpretar',
        colorClass: 'bg-sky-400',
        badgeCls:   'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-900/20 dark:text-sky-300 dark:border-sky-800',
    },
    intermitente_con_vinculo: {
        name:             'Lector/a intermitente con vínculo',
        description:      'No lee con regularidad, pero cuando lo hace hay un engagement real. El vínculo afectivo con el texto existe.',
        familyMessage:    'Su hijo/a tiene momentos de lectura muy valiosos, aunque no siempre regulares. Un ritual pequeño y fijo — incluso 10 minutos — puede marcar la diferencia.',
        immediateAction:  'Establecer un ritual mínimo: 10 minutos en un horario fijo esta semana.',
        readerExperience: 'Textos cortos con fuerte conexión emocional; álbumes ilustrados o cuentos breves.',
        ecosystem: {
            aula:    'Lectura en voz alta compartida para reconectar con el ritmo lector.',
            familia: 'Proponer 10 minutos fijos en casa; si es posible, leer juntos.',
            leo:     'Disponible; no forzar si el momento de lectura es breve.',
        },
        trajectory: 'reconocer → interpretar (desde el vínculo)',
        colorClass: 'bg-violet-400',
        badgeCls:   'bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800',
    },
    sostenimiento_familiar: {
        name:             'Lector/a con sostén familiar',
        description:      'La lectura ocurre principalmente fuera del aula, con señales de acompañamiento desde el hogar.',
        familyMessage:    'La lectura en casa es un regalo enorme. Su hijo/a se beneficia mucho de ese espacio. Pueden seguir leyendo juntos o simplemente preguntar qué está leyendo.',
        immediateAction:  'Coordinar con la familia para sostener y nombrar el momento de lectura en casa.',
        readerExperience: 'Textos que funcionen bien en contexto familiar: álbumes, historias de vida, cuentos regionales.',
        ecosystem: {
            aula:    'Celebrar el hábito en casa como logro del grupo; compartir con pares.',
            familia: 'Invitar a la familia a hacer UNA pregunta sobre el libro leído esta semana.',
            leo:     'Disponible; especialmente útil para dudas de vocabulario al leer en casa.',
        },
        trajectory: 'reconocer → interpretar (desde el hogar)',
        colorClass: 'bg-amber-400',
        badgeCls:   'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-800',
    },
    en_dificultad: {
        name:             'Lector/a en dificultad',
        description:      'Invierte tiempo en la lectura pero muestra señales de dificultad de comprensión. El esfuerzo existe; falta andamiaje.',
        familyMessage:    'Su hijo/a está haciendo un esfuerzo real para leer. Con un poco de apoyo en palabras difíciles y conversación sobre el texto, puede avanzar mucho.',
        immediateAction:  'Sesión acompañada: leer junto al estudiante para identificar dónde se produce la dificultad.',
        readerExperience: 'Textos de menor dificultad léxica o con apoyo visual; sesiones cortas con pausa de verificación.',
        ecosystem: {
            aula:    'Trabajo en dúo lector; el par como mediador cercano.',
            familia: 'Alertar sin alarmar; pedir que conversen sobre el texto en casa.',
            leo:     'Usar en modo vocabulario antes de cada sesión de lectura.',
        },
        trajectory: 'reconocer (con andamiaje)',
        colorClass: 'bg-red-400',
        badgeCls:   'bg-red-50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800',
    },
    inicio_de_habito: {
        name:             'Lector/a en inicio de hábito',
        description:      'Está comenzando a desarrollar una práctica lectora. La regularidad aún no está establecida, pero hay movimiento.',
        familyMessage:    'Su hijo/a está comenzando a leer de manera más regular. Cualquier apoyo pequeño — un rato tranquilo, preguntar qué leyó — suma mucho en este momento.',
        immediateAction:  'Asegurar que tiene un texto que le interese; verificar que el acceso es fluido.',
        readerExperience: 'Textos muy cortos (microcuentos, álbumes) para lograr completaciones rápidas y satisfactorias.',
        ecosystem: {
            aula:    'Registro visible de lo leído; celebrar cualquier completación.',
            familia: 'Proponer 5 minutos en casa; sin presión ni evaluación.',
            leo:     'Primera consulta acompañada en clase para que conozca la herramienta.',
        },
        trajectory: 'reconocer (inicio)',
        colorClass: 'bg-blue-400',
        badgeCls:   'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800',
    },
    sin_datos_suficientes: {
        name:             'Sin datos suficientes',
        description:      'Aún no hay actividad suficiente registrada para construir un perfil lector.',
        familyMessage:    'Todavía estamos conociendo los hábitos de lectura de su hijo/a. Pronto podremos compartir más sobre su proceso.',
        immediateAction:  'Verificar acceso a la plataforma y si hubo alguna barrera técnica o de motivación.',
        readerExperience: 'Comenzar con contenido de elección libre; que elija qué quiere leer primero.',
        ecosystem: {
            aula:    'Primer contacto directo; verificar si lee en otro contexto (papel, otro dispositivo).',
            familia: 'Indagar si lee en casa en otro formato.',
            leo:     'Presentar Leo como recurso de conversación, no de evaluación.',
        },
        trajectory: 'desconocida',
        colorClass: 'bg-gray-300 dark:bg-gray-600',
        badgeCls:   'bg-gray-50 text-gray-500 border-gray-200 dark:bg-gray-700 dark:text-gray-400 dark:border-gray-600',
    },
};

interface ReaderProfileResult {
    profileId: string;
    confidence: 'alto' | 'medio' | 'bajo';
    signals: string[];
}

/**
 * Classify a student into one of 7 reader typologies using transparent rules.
 * Uses pedagogicalProfile when available; falls back to StudentRow approximations.
 * Each rule is legible and explainable to a mediator.
 */
function classifyReaderProfile(student: StudentRow): ReaderProfileResult {
    if (!student.hasData || student.totalSessions < 2) {
        return { profileId: 'sin_datos_suficientes', confidence: 'bajo', signals: ['sin_actividad'] };
    }

    const p = student.pedagogicalProfile;

    // Continuity: weeklyPresenceRate if available, else session-count bucket
    const continuity = p?.weeklyPresenceRate ?? (
        student.totalSessions >= 8 ? 0.80
        : student.totalSessions >= 5 ? 0.60
        : student.totalSessions >= 3 ? 0.45
        : 0.20
    );

    const weekendRate = p?.weekendReadingRate ?? 0;

    // Conversational depth: precise if available, else derive from dominant Leo type
    const convDepth = p?.conversationalDepthScore ?? (
        student.dominantLeoType === 'reflection'   ? 0.90
        : student.dominantLeoType === 'inferential' ? 0.70
        : student.dominantLeoType === 'comprehension'? 0.50
        : student.dominantLeoType === 'vocab'       ? 0.25
        : student.totalLeoInteractions > 0          ? 0.35
        : 0
    );

    const signals: string[] = [];

    // Rule 1 — En dificultad: significant time invested, low comprehension
    if (student.totalReadingTimeMs > 1_200_000 && student.composite < 30) {
        signals.push('alto_tiempo', 'baja_comprension');
        return { profileId: 'en_dificultad', confidence: student.totalSessions >= 5 ? 'alto' : 'medio', signals };
    }

    // Rule 2 — Lector consolidado: regular + conversational depth + completions
    if (continuity >= 0.65 && convDepth >= 0.45 && student.contentsCompleted >= 1) {
        signals.push('alta_continuidad', 'conversacion_profunda', 'completados');
        return { profileId: 'lector_consolidado', confidence: 'alto', signals };
    }

    // Rule 3 — Sostenimiento familiar: weekend reading is dominant signal (needs real data)
    if (weekendRate >= 0.4 && continuity >= 0.4) {
        signals.push('lectura_fin_semana', 'continuidad_media');
        const conf = p ? 'alto' : 'bajo'; // only high confidence when real timestamps available
        return { profileId: 'sostenimiento_familiar', confidence: conf, signals };
    }

    // Rule 4 — Constante superficial: regular reading, low conversational depth
    if (continuity >= 0.65 && convDepth < 0.35) {
        signals.push('alta_continuidad', 'baja_conversacion');
        return { profileId: 'constante_superficial', confidence: 'medio', signals };
    }

    // Rule 5 — Intermitente con vínculo: low regularity but engagement signals present
    const hasEngagement = convDepth >= 0.45 || student.contentsCompleted >= 1 || weekendRate >= 0.3;
    if (continuity < 0.45 && hasEngagement && student.totalSessions >= 3) {
        signals.push('baja_continuidad', 'vinculo_presente');
        return { profileId: 'intermitente_con_vinculo', confidence: 'medio', signals };
    }

    // Rule 6 — Inicio de hábito: some activity, no dominant pattern yet
    if (student.totalSessions >= 2) {
        signals.push('actividad_inicial');
        return { profileId: 'inicio_de_habito', confidence: continuity >= 0.3 ? 'medio' : 'bajo', signals };
    }

    return { profileId: 'sin_datos_suficientes', confidence: 'bajo', signals: ['sin_datos'] };
}

/**
 * Build adaptive recommendations for a student based on their reader profile.
 * Personalizes the immediate action with real content titles where possible.
 */
function getAdaptiveRecommendations(profileId: string, student: StudentRow) {
    const typology = READER_TYPOLOGIES[profileId] ?? READER_TYPOLOGIES['sin_datos_suficientes'];

    const ip   = student.readingDetails.inProgress[0] ?? null;
    const done = student.readingDetails.completed[0]  ?? null;
    const ab   = student.readingDetails.abandoned[0]  ?? null;
    const t    = (c: { title: string }) => `"${c.title}"`;

    let immediateAction = typology.immediateAction;

    if (profileId === 'lector_consolidado' && done) {
        immediateAction = `Proponer un texto más desafiante después de ${t(done)}.`;
    } else if (profileId === 'constante_superficial' && ip) {
        immediateAction = `Abrir conversación sobre ${t(ip)}: ¿qué fue lo más sorprendente o extraño?`;
    } else if (profileId === 'intermitente_con_vinculo' && ab) {
        immediateAction = `Retomar ${t(ab)} — establecer un ritual de 10 min fijos en la semana.`;
    } else if (profileId === 'intermitente_con_vinculo' && ip) {
        immediateAction = `Establecer 10 min fijos para continuar ${t(ip)}.`;
    } else if (profileId === 'en_dificultad' && ip) {
        immediateAction = `Sesión acompañada con ${t(ip)} para identificar dónde está la dificultad.`;
    } else if (profileId === 'sostenimiento_familiar' && ip) {
        immediateAction = `Coordinar con la familia para sostener el momento de lectura de ${t(ip)} en casa.`;
    }

    return {
        immediateAction,
        readerExperience: typology.readerExperience,
        ecosystem:        typology.ecosystem,
        familyMessage:    typology.familyMessage,
        trajectory:       typology.trajectory,
    };
}

// ---------------------------------------------------------------------------
// SMALL COMPONENTS
// ---------------------------------------------------------------------------

const SectionTitle: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-3">
        {children}
    </h2>
);

const Card: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
    <div className={`bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm ${className}`}>
        {children}
    </div>
);

// KPI metric card — primary cards receive an indigo accent border + left bar
interface MetricCardProps {
    icon: React.ReactNode;
    label: string;
    value: string;
    sub?: string;
    primary?: boolean;
}
const MetricCard: React.FC<MetricCardProps> = ({ icon, label, value, sub, primary = false }) => (
    <div className={`bg-white dark:bg-gray-800 rounded-xl shadow-sm border flex flex-col p-5 relative overflow-hidden ${
        primary
            ? 'border-indigo-200 dark:border-indigo-800'
            : 'border-gray-200 dark:border-gray-700'
    }`}>
        {primary && (
            <div className="absolute left-0 top-0 bottom-0 w-1 bg-indigo-500 rounded-l-xl" />
        )}
        <div className="flex items-start gap-3 pl-1">
            <div className={`mt-0.5 shrink-0 ${primary ? 'text-indigo-500' : 'text-gray-400 dark:text-gray-500'}`}>
                {icon}
            </div>
            <div className="min-w-0">
                <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{label}</p>
                <p className={`font-bold text-gray-900 dark:text-gray-100 leading-none ${primary ? 'text-3xl' : 'text-2xl'}`}>
                    {value}
                </p>
                {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
            </div>
        </div>
    </div>
);

// Horizontal reading-level bar with a short description below the label
interface LevelBarProps {
    label: string;
    description: string;
    score: number; // 0–100
}
const LevelBar: React.FC<LevelBarProps> = ({ label, description, score }) => (
    <div className="flex items-center gap-3">
        <div className="w-32 shrink-0">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 block">{label}</span>
            <span className="text-xs text-gray-400 dark:text-gray-500 leading-tight">{description}</span>
        </div>
        <div className="flex-1 h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, score)}%` }}
            />
        </div>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 w-10 text-right tabular-nums">
            {score.toFixed(1)}
        </span>
    </div>
);

// Single ICDLI dimension row
interface ICDLIItemProps { label: string; score: number }
const ICDLIItem: React.FC<ICDLIItemProps> = ({ label, score }) => (
    <div className="flex items-center gap-2 py-1">
        <span className="text-xs text-gray-500 dark:text-gray-400 w-36 shrink-0">{label}</span>
        <div className="flex gap-0.5">
            {[1, 2, 3, 4].map(i => (
                <div key={i} className={`h-2 w-5 rounded-sm transition-colors ${i <= score ? 'bg-indigo-500' : 'bg-gray-100 dark:bg-gray-700'}`} />
            ))}
        </div>
        <span className="text-xs font-medium text-gray-500 dark:text-gray-400 w-24">
            {ICDLI_LEVEL[score] ?? '—'}
        </span>
    </div>
);

// Suggested action item inside the action block
const ActionItem: React.FC<{ text: string }> = ({ text }) => (
    <div className="flex items-start gap-3">
        <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
            <div className="w-1.5 h-1.5 rounded-full bg-indigo-500" />
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{text}</p>
    </div>
);

// Action block — only renders when there are actionable alerts
const ActionBlock: React.FC<{ alerts: Alert[] }> = ({ alerts }) => {
    const actions = useMemo(() => {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const alert of alerts) {
            const action = ALERT_ACTIONS[alert.type];
            if (action && !seen.has(alert.type)) {
                seen.add(alert.type);
                result.push(action);
            }
        }
        return result;
    }, [alerts]);

    if (actions.length === 0) return null;

    return (
        <div>
            <SectionTitle>Sugerencias pedagógicas</SectionTitle>
            <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                    <Lightbulb size={16} className="text-indigo-500 shrink-0" />
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Basadas en las alertas activas de este grupo
                    </p>
                </div>
                <div className="space-y-3">
                    {actions.map((text, i) => <ActionItem key={i} text={text} />)}
                </div>
            </Card>
        </div>
    );
};

// Intervention registration modal
interface InterventionModalProps {
    student: StudentRow;
    mediatorId: string;
    courseId: string;
    successPatterns?: SuccessPattern[];
    onClose: () => void;
    onSaved: (intervention: Intervention) => void;
}

const InterventionModal: React.FC<InterventionModalProps> = ({ student, mediatorId, courseId, successPatterns = [], onClose, onSaved }) => {
    const patterns   = detectStudentPatterns(student);
    const primaryDim = patterns[0] ? (PATTERN_DIMENSION_MAP[patterns[0]] ?? undefined) : undefined;
    const recommended = patterns[0]
        ? getRecommendedInterventionType(patterns[0], successPatterns, primaryDim || undefined)
        : null;
    const modalProfile      = classifyReaderProfile(student);
    const modalRecs         = getAdaptiveRecommendations(modalProfile.profileId, student);
    const [type,   setType]   = useState(recommended ?? INTERVENTION_TYPES[0].value);
    const [note,   setNote]   = useState('');
    const [saving, setSaving] = useState(false);
    const [err,    setErr]    = useState<string | null>(null);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!note.trim()) return;
        setSaving(true);
        setErr(null);
        try {
            const res = await fetch('/api/interventions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'x-user-id': mediatorId },
                body: JSON.stringify({
                    mediatorId,
                    studentId: student.userId,
                    courseId,
                    type,
                    note: note.trim(),
                    contentId: student.readingDetails.inProgress[0]?.contentId ?? null,
                    patternsAtIntervention: patterns,
                    readingTimeMsAtIntervention: student.totalReadingTimeMs,
                }),
            });
            if (!res.ok) {
                const body = await res.json().catch(() => ({}));
                throw new Error(body.error ?? `Error ${res.status}`);
            }
            const body = await res.json();
            onSaved(body.intervention ?? body);
        } catch (e: unknown) {
            setErr(e instanceof Error ? e.message : 'Error al guardar');
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-xl w-full max-w-md">
                <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                        Anotar intervención — {student.name}
                    </h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors">
                        <X size={15} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    {patterns.length > 0 && (
                        <div className="flex items-start gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg">
                            <Info size={13} className="text-gray-400 dark:text-gray-500 shrink-0 mt-0.5" />
                            <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                                Situación detectada:{' '}
                                <span className="font-medium text-gray-700 dark:text-gray-300">
                                    {PATTERN_MAP[patterns[0]]?.label ?? patterns[0]}
                                </span>
                                {patterns.length > 1 && ` (+${patterns.length - 1} más)`}
                            </p>
                        </div>
                    )}
                    {modalRecs.familyMessage && modalProfile.profileId !== 'sin_datos_suficientes' && (
                        <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 rounded-lg border border-amber-100 dark:border-amber-800/30">
                            <span className="text-[11px] text-amber-600 dark:text-amber-400 shrink-0 mt-0.5">👨‍👩‍👧</span>
                            <div>
                                <p className="text-[10px] font-medium text-amber-700 dark:text-amber-400 uppercase tracking-wide mb-0.5">
                                    Mensaje para la familia
                                </p>
                                <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                                    {modalRecs.familyMessage}
                                </p>
                            </div>
                        </div>
                    )}
                    <div>
                        <div className="flex items-center justify-between mb-1.5">
                            <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                Tipo de intervención
                            </label>
                            {recommended && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-medium">
                                    Sugerido por resultados
                                </span>
                            )}
                        </div>
                        <select
                            value={type}
                            onChange={e => setType(e.target.value)}
                            className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400"
                        >
                            {INTERVENTION_TYPES.map(t => (
                                <option key={t.value} value={t.value}>
                                    {t.label}{t.value === recommended ? ' ✓' : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1.5">
                            Nota{' '}
                            <span className="font-normal text-gray-400 dark:text-gray-500">({note.length}/500)</span>
                        </label>
                        <textarea
                            value={note}
                            onChange={e => setNote(e.target.value.slice(0, 500))}
                            rows={4}
                            placeholder="Describe la acción tomada o planificada…"
                            className="w-full text-sm rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 resize-none"
                        />
                    </div>
                    {err && <p className="text-xs text-red-500 dark:text-red-400">{err}</p>}
                    <div className="flex justify-end gap-2 pt-1">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                        >
                            Cancelar
                        </button>
                        <button
                            type="submit"
                            disabled={saving || !note.trim()}
                            className="px-4 py-2 text-sm font-medium bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving ? 'Guardando…' : 'Guardar'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// Sort chevron indicator
interface SortIndicatorProps { active: boolean; dir: 'asc' | 'desc' }
const SortIndicator: React.FC<SortIndicatorProps> = ({ active, dir }) => (
    active
        ? (dir === 'asc' ? <ChevronUp size={12} className="inline ml-0.5" /> : <ChevronDown size={12} className="inline ml-0.5" />)
        : null
);

// ---------------------------------------------------------------------------
// STUDENT PROFILES VIEW
// ---------------------------------------------------------------------------

const TYPE_LABELS: Record<string, string> = {
    libro:        'Libro',
    libro_album:  'Libro álbum',
    cuento:       'Cuento',
    novela:       'Novela',
    video:        'Video',
    audio:        'Audio',
    guia:         'Guía',
};

const ReadingSnapshot: React.FC<{ details: StudentRow['readingDetails'] }> = ({ details }) => {
    const hasAny = details.inProgress.length > 0 || details.completed.length > 0 || details.abandoned.length > 0;
    if (!hasAny) return null;
    return (
        <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700/60 space-y-1.5">
            {details.inProgress.map(c => (
                <div key={c.contentId} className="flex items-baseline gap-2 min-w-0">
                    <span className="text-[10px] font-semibold text-sky-500 dark:text-sky-400 shrink-0 w-14">Leyendo</span>
                    <span className="text-xs text-gray-700 dark:text-gray-300 truncate flex-1">{c.title}</span>
                    <span className="text-[10px] tabular-nums text-sky-500 dark:text-sky-400 shrink-0 font-medium">{c.progressPercentage}%</span>
                    {c.totalReadingTimeMs > 0 && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">{formatDuration(c.totalReadingTimeMs)}</span>
                    )}
                </div>
            ))}
            {details.completed.map(c => (
                <div key={c.contentId} className="flex items-baseline gap-2 min-w-0">
                    <span className="text-[10px] font-semibold text-emerald-500 dark:text-emerald-400 shrink-0 w-14">Terminó</span>
                    <span className="text-xs text-gray-600 dark:text-gray-400 truncate flex-1">{c.title}</span>
                    {c.type && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">{TYPE_LABELS[c.type] ?? c.type}</span>
                    )}
                </div>
            ))}
            {details.abandoned.map(c => (
                <div key={c.contentId} className="flex items-baseline gap-2 min-w-0">
                    <span className="text-[10px] font-semibold text-amber-500 dark:text-amber-400 shrink-0 w-14">Dejó en</span>
                    <span className="text-xs text-gray-500 dark:text-gray-500 truncate flex-1">{c.title}</span>
                    <span className="text-[10px] tabular-nums text-amber-500 dark:text-amber-400 shrink-0">{c.progressPercentage}%</span>
                </div>
            ))}
        </div>
    );
};

interface StudentCardProps {
    student: StudentRow;
    interventions?: Intervention[];
    onAnnotate?: () => void;
}

const StudentCard: React.FC<StudentCardProps> = ({ student, interventions = [], onAnnotate }) => {
    const patterns        = detectStudentPatterns(student);
    const summary         = buildStudentProfileSummary(student, patterns);
    const profile         = classifyReaderProfile(student);
    const recs            = getAdaptiveRecommendations(profile.profileId, student);
    const typologyDef     = READER_TYPOLOGIES[profile.profileId];
    const primary    = patterns[0] ? PATTERN_MAP[patterns[0]] : null;
    const isPositive = primary?.severity === 'positive';
    const isHigh     = primary?.severity === 'high';
    const isMedium   = primary?.severity === 'medium';

    const lastIntervention = interventions.length > 0
        ? [...interventions].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0]
        : null;
    const impact = lastIntervention
        ? computeInterventionImpact(patterns, student.totalReadingTimeMs, lastIntervention)
        : null;

    return (
        <div className={`p-4 rounded-lg border ${
            !student.hasData
                ? 'border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-800/50 opacity-60'
                : isHigh
                ? 'border-red-100 dark:border-red-900/40 bg-red-50/30 dark:bg-red-900/10'
                : isMedium
                ? 'border-amber-100 dark:border-amber-900/40 bg-amber-50/20 dark:bg-amber-900/5'
                : isPositive
                ? 'border-emerald-100 dark:border-emerald-900/40 bg-emerald-50/20 dark:bg-emerald-900/5'
                : 'border-gray-100 dark:border-gray-700 bg-white dark:bg-gray-800'
        }`}>
            <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                        <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${
                            !student.hasData ? 'bg-gray-300 dark:bg-gray-600'
                            : isHigh ? 'bg-red-400'
                            : isMedium ? 'bg-amber-400'
                            : isPositive ? 'bg-emerald-400'
                            : 'bg-sky-400'
                        }`} />
                        <span className={`font-medium text-sm truncate ${
                            student.hasData ? 'text-gray-800 dark:text-gray-200' : 'text-gray-400 dark:text-gray-500 italic'
                        }`}>
                            {student.name}
                        </span>
                        {student.lastAccessAt && (
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 shrink-0">
                                {new Date(student.lastAccessAt).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
                            </span>
                        )}
                        {impact === 'improved' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 font-medium shrink-0">
                                ↑ Retomó
                            </span>
                        )}
                        {impact === 'unchanged' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500 font-medium shrink-0">
                                = Sin cambio
                            </span>
                        )}
                    </div>
                    {student.hasData && typologyDef && (
                        <span className={`inline-block text-[10px] px-1.5 py-0.5 rounded-full font-medium mb-1 ${typologyDef.badgeCls}`}>
                            {typologyDef.name}
                        </span>
                    )}
                    <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed mb-2">
                        {summary}
                    </p>
                    {recs.immediateAction && (
                        <p className="text-xs text-indigo-600 dark:text-indigo-400 leading-relaxed">
                            → {recs.immediateAction}
                        </p>
                    )}
                </div>
                <div className="shrink-0 flex flex-col items-end gap-1 text-right">
                    {onAnnotate && (
                        <button
                            onClick={onAnnotate}
                            className="flex items-center gap-1 text-[10px] text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors mb-0.5"
                        >
                            <PenLine size={10} />
                            Anotar
                        </button>
                    )}
                    <span className="text-xs tabular-nums text-gray-400 dark:text-gray-500">
                        {student.totalSessions} ses.
                    </span>
                    {student.totalReadingTimeMs > 0 && (
                        <span className="text-xs tabular-nums text-gray-400 dark:text-gray-500">
                            {formatDuration(student.totalReadingTimeMs)}
                        </span>
                    )}
                    {(student.contentsInProgress > 0 || student.contentsCompleted > 0) && (
                        <span className="text-[10px] text-gray-400 dark:text-gray-500 tabular-nums">
                            {student.contentsCompleted > 0 && `${student.contentsCompleted}✓`}
                            {student.contentsInProgress > 0 && ` ${student.contentsInProgress}↻`}
                            {student.contentsAbandoned > 0 && ` ${student.contentsAbandoned}✗`}
                        </span>
                    )}
                    {student.totalLeoOfflineAttempts > 0 && (
                        <span className="text-[10px] text-amber-500 dark:text-amber-400 tabular-nums">
                            {student.totalLeoOfflineAttempts}× sin red
                        </span>
                    )}
                </div>
            </div>
            {lastIntervention && (
                <div className="mt-2 pt-2 border-t border-gray-100 dark:border-gray-700/60 flex items-start gap-2">
                    <PenLine size={10} className="text-gray-300 dark:text-gray-600 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-gray-400 dark:text-gray-500 leading-relaxed">
                        <span className="font-medium">{INTERVENTION_TYPE_LABELS[lastIntervention.type] ?? lastIntervention.type}</span>
                        {' · '}{new Date(lastIntervention.createdAt).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
                        {' · '}<span className="italic">{lastIntervention.note.length > 60 ? lastIntervention.note.slice(0, 60) + '…' : lastIntervention.note}</span>
                    </p>
                </div>
            )}
            {patterns.length > 1 && (
                <div className="flex flex-wrap gap-1 mt-2">
                    {patterns.slice(1).map(p => {
                        const def = PATTERN_MAP[p];
                        if (!def) return null;
                        return (
                            <span key={p} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400">
                                {def.label}
                            </span>
                        );
                    })}
                </div>
            )}
            {student.hasData && <ReadingSnapshot details={student.readingDetails} />}
        </div>
    );
};

const SEVERITY_ORDER_MAP: Record<string, number> = { high: 0, medium: 1, low: 2, positive: 3 };

interface StudentProfilesViewProps {
    students: StudentRow[];
    interventionsByStudentId: Record<string, Intervention[]>;
    onRequestIntervention: (student: StudentRow) => void;
}

const StudentProfilesView: React.FC<StudentProfilesViewProps> = ({ students, interventionsByStudentId, onRequestIntervention }) => {
    const groups = useMemo(() => {
        const buckets: Record<string, StudentRow[]> = {};
        for (const p of STUDENT_PATTERNS) buckets[p.type] = [];
        buckets['sin_patron'] = [];

        for (const student of students) {
            const patterns = detectStudentPatterns(student);
            const primary  = patterns[0];
            if (primary && buckets[primary] !== undefined) {
                buckets[primary].push(student);
            } else {
                buckets['sin_patron'].push(student);
            }
        }

        const result = STUDENT_PATTERNS
            .filter(p => buckets[p.type].length > 0)
            .sort((a, b) => SEVERITY_ORDER_MAP[a.severity] - SEVERITY_ORDER_MAP[b.severity])
            .map(p => ({ def: p, students: buckets[p.type] }));

        if (buckets['sin_patron'].length > 0) {
            result.push({
                def: { type: 'sin_patron', severity: 'low' as const, label: 'Sin patrón identificado', explanation: 'Actividad registrada sin patrón dominante.', action: '' },
                students: buckets['sin_patron'],
            });
        }
        return result;
    }, [students]);

    return (
        <div className="space-y-6">
            {groups.map(({ def, students: gs }) => (
                <div key={def.type}>
                    <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                            {def.label} ({gs.length})
                        </h3>
                        {def.severity === 'high' && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400 font-medium">
                                requiere atención
                            </span>
                        )}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {gs.map(s => (
                            <StudentCard
                                key={s.userId}
                                student={s}
                                interventions={interventionsByStudentId[s.userId] ?? []}
                                onAnnotate={() => onRequestIntervention(s)}
                            />
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

// ---------------------------------------------------------------------------
// STUDENT TABLE
// ---------------------------------------------------------------------------

type SortKey = 'name' | 'composite' | 'literal' | 'inferential' | 'critical' | 'reflective' | 'totalSessions' | 'totalReadingTimeMs' | 'totalLeoInteractions';

const StudentTable: React.FC<{ students: StudentRow[] }> = ({ students }) => {
    const [sortKey,    setSortKey]    = useState<SortKey>('composite');
    const [sortDir,    setSortDir]    = useState<'asc' | 'desc'>('desc');
    const [onlyAlerts, setOnlyAlerts] = useState(false);

    const toggleSort = (key: SortKey) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const visible = useMemo(() => {
        const base = onlyAlerts ? students.filter(s => s.needsAttention) : students;
        return [...base].sort((a, b) => {
            const va = a[sortKey] as number | string;
            const vb = b[sortKey] as number | string;
            const cmp = typeof va === 'string'
                ? (va as string).localeCompare(vb as string, 'es')
                : (va as number) - (vb as number);
            return sortDir === 'asc' ? cmp : -cmp;
        });
    }, [students, sortKey, sortDir, onlyAlerts]);

    const attentionCount = students.filter(s => s.needsAttention || !s.hasData).length;

    const Th: React.FC<{ col: SortKey; className?: string; children: React.ReactNode }> = ({ col, className = '', children }) => (
        <th
            onClick={() => toggleSort(col)}
            className={`px-3 py-2 text-left text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-600 dark:hover:text-gray-300 transition-colors ${className}`}
        >
            {children}
            <SortIndicator active={sortKey === col} dir={sortDir} />
        </th>
    );

    return (
        <div>
            <div className="flex items-center justify-between mb-3">
                <SectionTitle>Estudiantes ({students.length})</SectionTitle>
                {attentionCount > 0 && (
                    <button
                        onClick={() => setOnlyAlerts(v => !v)}
                        className={`flex items-center gap-1.5 text-xs font-medium px-3 py-1 rounded-full border transition-colors ${
                            onlyAlerts
                                ? 'bg-amber-100 border-amber-300 text-amber-700 dark:bg-amber-900/30 dark:border-amber-700 dark:text-amber-400'
                                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-amber-300 hover:text-amber-600'
                        }`}
                    >
                        <AlertTriangle size={11} />
                        {onlyAlerts ? 'Ver todos' : `${attentionCount} requieren atención`}
                    </button>
                )}
            </div>

            <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="border-b border-gray-100 dark:border-gray-700">
                            <tr>
                                <Th col="name" className="pl-4">Nombre</Th>
                                <th className="px-3 py-2 text-left text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Estado</th>
                                <Th col="composite">Compuesto</Th>
                                <Th col="literal">Literal</Th>
                                <Th col="inferential">Infer.</Th>
                                <Th col="critical">Crítico</Th>
                                <Th col="reflective">Refl.</Th>
                                <Th col="totalSessions">Sesiones</Th>
                                <Th col="totalReadingTimeMs">Tiempo lect.</Th>
                                <Th col="totalLeoInteractions" className="pr-4">Leo</Th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                            {visible.map(student => {
                                const status = studentStatus(student);
                                const sc     = STATUS_CONFIG[status];
                                return (
                                    <tr
                                        key={student.userId}
                                        className={`transition-colors ${
                                            status === 'attention'
                                                ? 'opacity-60'
                                                : status === 'risk'
                                                ? 'bg-amber-50/50 dark:bg-amber-900/10'
                                                : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                                        }`}
                                    >
                                        <td className="pl-4 pr-3 py-2.5">
                                            <span className={`font-medium ${
                                                student.hasData
                                                    ? 'text-gray-800 dark:text-gray-200'
                                                    : 'text-gray-400 dark:text-gray-500 italic'
                                            }`}>
                                                {student.name}
                                            </span>
                                            {student.lastAccessAt && (
                                                <span className="block text-[10px] text-gray-400 dark:text-gray-500 leading-none mt-0.5">
                                                    {new Date(student.lastAccessAt).toLocaleDateString('es', { day: '2-digit', month: 'short' })}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2.5">
                                            <div className={`flex items-center gap-1.5 ${sc.cls}`}>
                                                <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${sc.dot}`} />
                                                <span className="text-xs font-medium">{sc.label}</span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2.5 font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                                            {student.hasData ? student.composite : '—'}
                                        </td>
                                        <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 tabular-nums">
                                            {student.hasData ? student.literal : '—'}
                                        </td>
                                        <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 tabular-nums">
                                            {student.hasData ? student.inferential : '—'}
                                        </td>
                                        <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 tabular-nums">
                                            {student.hasData ? student.critical : '—'}
                                        </td>
                                        <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 tabular-nums">
                                            {student.hasData ? student.reflective : '—'}
                                        </td>
                                        <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 tabular-nums">
                                            {student.totalSessions}
                                        </td>
                                        <td className="px-3 py-2.5 text-gray-600 dark:text-gray-400 tabular-nums text-xs">
                                            {student.hasData ? formatDuration(student.totalReadingTimeMs) : '—'}
                                        </td>
                                        <td className="pr-4 px-3 py-2.5">
                                            {student.totalLeoInteractions > 0 || student.totalLeoOfflineAttempts > 0 ? (
                                                <div className="flex flex-col gap-0.5">
                                                    {student.totalLeoInteractions > 0 && (
                                                        <span className="text-indigo-600 dark:text-indigo-400 font-semibold tabular-nums text-xs">
                                                            {student.totalLeoInteractions}
                                                            {student.dominantLeoType && (
                                                                <span className="font-normal text-gray-400 dark:text-gray-500 ml-1">
                                                                    {LEO_TYPE_LABELS[student.dominantLeoType] ?? student.dominantLeoType}
                                                                </span>
                                                            )}
                                                        </span>
                                                    )}
                                                    {student.totalLeoOfflineAttempts > 0 && (
                                                        <span className="text-[10px] text-amber-500 dark:text-amber-400 leading-none tabular-nums">
                                                            +{student.totalLeoOfflineAttempts} sin red
                                                        </span>
                                                    )}
                                                </div>
                                            ) : (
                                                <span className="text-gray-300 dark:text-gray-600 text-xs">—</span>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}

                            {visible.length === 0 && (
                                <tr>
                                    <td colSpan={10} className="px-4 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                                        No hay estudiantes que mostrar
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </Card>
        </div>
    );
};

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------

const DashboardMediador: React.FC = () => {
    const { courseId } = useParams<{ courseId: string }>();
    const navigate     = useNavigate();
    const { user }     = useAuth();

    const [data,               setData]               = useState<CourseMetrics | null>(null);
    const [loading,            setLoading]            = useState(true);
    const [error,              setError]              = useState<string | null>(null);
    const [studentView,        setStudentView]        = useState<'profiles' | 'table'>('profiles');
    const [interventions,      setInterventions]      = useState<Intervention[]>([]);
    const [interventionModal,  setInterventionModal]  = useState<{ student: StudentRow } | null>(null);
    const [effectiveness,      setEffectiveness]      = useState<EffectivenessData | null>(null);

    const interventionsByStudentId = useMemo<Record<string, Intervention[]>>(() => {
        const map: Record<string, Intervention[]> = {};
        for (const iv of interventions) {
            if (!map[iv.studentId]) map[iv.studentId] = [];
            map[iv.studentId].push(iv);
        }
        return map;
    }, [interventions]);

    useEffect(() => {
        if (!courseId || !user) return;

        const fetchMetrics = async () => {
            setLoading(true);
            setError(null);
            try {
                const headers: Record<string, string> = { 'x-user-id': user.id };
                const [metricsRes, interventionsRes, effectivenessRes] = await Promise.all([
                    fetch(`/api/metrics/course/${encodeURIComponent(courseId)}`, { headers }),
                    fetch(`/api/interventions/course/${encodeURIComponent(courseId)}`, { headers }),
                    fetch(`/api/interventions/effectiveness?courseId=${encodeURIComponent(courseId)}`, { headers }),
                ]);
                if (!metricsRes.ok) {
                    const body = await metricsRes.json().catch(() => ({}));
                    throw new Error(body.error ?? `Error ${metricsRes.status}`);
                }
                setData(await metricsRes.json());
                if (interventionsRes.ok) {
                    const iv = await interventionsRes.json();
                    setInterventions(iv.interventions ?? []);
                }
                if (effectivenessRes.ok) {
                    setEffectiveness(await effectivenessRes.json());
                }
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : 'Error al cargar métricas');
            } finally {
                setLoading(false);
            }
        };

        fetchMetrics();
    }, [courseId, user]);

    // ── Loading ──────────────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500 mx-auto mb-3" />
                    <p className="text-sm text-gray-400">Cargando métricas…</p>
                </div>
            </div>
        );
    }

    // ── Error ────────────────────────────────────────────────────────────────
    if (error || !data) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
                <AlertCircle size={36} className="text-red-400 mb-3" />
                <p className="text-gray-600 dark:text-gray-400 mb-4">{error ?? 'No se pudo cargar el curso.'}</p>
                <button
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                    Volver
                </button>
            </div>
        );
    }

    const { summary, productMetrics: pm, readingLevels: rl, icdli, alerts, studentBreakdown } = data;
    const interpretation = buildSummaryInterpretation(summary, alerts);

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="max-w-5xl mx-auto px-4 pb-16 pt-6 space-y-8">

            {/* ── HEADER ── */}
            <div>
                <div className="flex items-center justify-between mb-4">
                    <button
                        onClick={() => navigate(-1)}
                        className="flex items-center gap-1.5 text-sm text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                    >
                        <ArrowLeft size={15} />
                        Volver
                    </button>
                    <button
                        onClick={() => navigate(`/reportes/curso/${courseId}`)}
                        className="flex items-center gap-1.5 text-sm font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                    >
                        <FileText size={14} />
                        Ver informe
                    </button>
                </div>

                <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
                            {data.courseName}
                        </h1>
                        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                            {summary.studentCount} estudiantes &bull; {summary.activeStudentCount} activos &bull; {pct(summary.engagementRate)} participación
                        </p>
                        {/* Interpretive sentence */}
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-2 max-w-xl leading-relaxed">
                            {interpretation}
                        </p>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <span className={`text-sm font-semibold px-3 py-1 rounded-full ${LEVEL_COLORS[summary.level] ?? ''}`}>
                            {summary.level}
                        </span>
                        <span className="text-sm text-gray-400 dark:text-gray-500 tabular-nums">
                            {summary.avgComposite.toFixed(1)} / 100
                        </span>
                    </div>
                </div>
            </div>

            {/* ── ALERTS ── */}
            {alerts.length > 0 && (
                <div className="space-y-2">
                    {alerts.map((alert, i) => {
                        const cfg        = ALERT_CONFIG[alert.severity];
                        const implication = ALERT_IMPLICATIONS[alert.type];
                        return (
                            <div
                                key={`${alert.type}-${i}`}
                                className={`px-4 py-3 rounded-lg border text-sm ${cfg.cls}`}
                            >
                                <div className="flex items-start gap-2.5">
                                    <span className="mt-0.5 shrink-0">{cfg.icon}</span>
                                    <span className="font-medium">{alert.message}</span>
                                </div>
                                {implication && (
                                    <p className="mt-1.5 ml-6 text-xs opacity-75 leading-relaxed">
                                        {implication}
                                    </p>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}

            {/* ── PRIMARY KPI CARDS — concentration and engagement depth ── */}
            <div>
                <SectionTitle>Concentración y profundidad</SectionTitle>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <MetricCard
                        primary
                        icon={<Zap size={18} />}
                        label="Flujo de concentración"
                        value={pct(pm.tranceEntryRate)}
                        sub="sesiones donde el lector alcanzó ritmo sostenido (streak ≥ 3)"
                    />
                    <MetricCard
                        primary
                        icon={<BookOpen size={18} />}
                        label="Bloques por sesión"
                        value={pm.avgBlocksPerSession.toFixed(1)}
                        sub="promedio de bloques de lectura completados por sesión"
                    />
                </div>
            </div>

            {/* ── SECONDARY KPI CARDS — activity overview ── */}
            <div>
                <SectionTitle>Actividad lectora</SectionTitle>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <MetricCard
                        icon={<Clock size={18} />}
                        label="Tiempo / sesión"
                        value={formatDuration(pm.avgSessionDurationMs)}
                    />
                    <MetricCard
                        icon={<CheckCircle size={18} />}
                        label="Tasa de completado"
                        value={pct(pm.completionRate)}
                        sub="sesiones ≥ 80%"
                    />
                    <MetricCard
                        icon={<Users size={18} />}
                        label="Sesiones promedio"
                        value={pm.totalSessions.toFixed(1)}
                        sub="por estudiante"
                    />
                    <MetricCard
                        icon={<CheckCircle size={18} />}
                        label="Continuidad"
                        value={pct(pm.autoTransitionRate)}
                        sub="transiciones automáticas"
                    />
                </div>
            </div>

            {/* ── LEO USAGE ── */}
            {(summary.totalLeoInteractions > 0 || summary.totalLeoOfflineAttempts > 0) && (
                <div>
                    <SectionTitle>Uso de Leo</SectionTitle>
                    <div className="grid grid-cols-2 sm:grid-cols-2 gap-3">
                        <MetricCard
                            icon={<Zap size={18} />}
                            label="Consultas a Leo"
                            value={String(summary.totalLeoInteractions)}
                            sub="interacciones con Leo (online)"
                        />
                        <MetricCard
                            icon={<AlertTriangle size={18} />}
                            label="Intentos sin conexión"
                            value={String(summary.totalLeoOfflineAttempts)}
                            sub={summary.totalLeoOfflineAttempts > 0 ? 'estudiantes intentaron usar Leo sin internet' : 'sin intentos offline registrados'}
                        />
                    </div>
                    {summary.totalLeoOfflineAttempts > 0 && (
                        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-400">
                            <Info size={12} className="shrink-0 mt-0.5" />
                            Los intentos sin red provienen de la app LU (datos reales). Las interacciones online son del sistema de Leo de Chibalete+.
                        </p>
                    )}
                </div>
            )}

            {/* ── READING LEVELS + ICDLI (side by side on md+) ── */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

                {/* Reading levels */}
                <div>
                    <SectionTitle>Niveles de lectura</SectionTitle>
                    <Card className="p-5 space-y-4">
                        <LevelBar label="Literal"     description="Extracción de información explícita"  score={rl.literal} />
                        <LevelBar label="Inferencial" description="Interpretación y deducción"           score={rl.inferential} />
                        <LevelBar label="Crítico"     description="Análisis y evaluación del texto"      score={rl.critical} />
                        <LevelBar label="Reflexivo"   description="Reflexión y creación a partir de lo leído" score={rl.reflective} />
                        <div className="pt-2 border-t border-gray-100 dark:border-gray-700">
                            <LevelBar label="Compuesto" description="Puntuación integrada ponderada"    score={rl.composite} />
                        </div>
                    </Card>
                </div>

                {/* ICDLI — grouped into 3 thematic sections */}
                <div>
                    <SectionTitle>Dimensiones ICDLI</SectionTitle>
                    <Card className="p-5">
                        <div className="space-y-4">
                            {ICDLI_GROUPS.map((group, gi) => (
                                <div key={group.title}>
                                    {gi > 0 && <div className="border-t border-gray-100 dark:border-gray-700 mb-3" />}
                                    <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-1.5">
                                        {group.title}
                                    </p>
                                    <div className="space-y-0.5">
                                        {group.keys.map(key => (
                                            <ICDLIItem key={key} label={ICDLI_LABELS[key]} score={icdli[key]} />
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                        <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
                            Escala 1–4 · basada en señales de comportamiento lector
                        </p>
                    </Card>
                </div>
            </div>

            {/* ── DISCLAIMER — heuristic scores + data sources ── */}
            <div className="space-y-1.5 px-1">
                <div className="flex items-start gap-2">
                    <Info size={14} className="text-gray-400 dark:text-gray-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                        Los niveles lectores son estimaciones basadas en comportamiento. No corresponden a evaluaciones pedagógicas directas.
                    </p>
                </div>
                <div className="flex items-start gap-2">
                    <Info size={14} className="text-gray-400 dark:text-gray-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                        Tiempo de lectura y sesiones incluyen datos de la app LU (Android, offline-first). Los intentos de Leo sin red son datos reales, no estimaciones.
                    </p>
                </div>
            </div>

            {/* ── INTERVENTION EFFECTIVENESS ── only shown when there are enough data points */}
            {effectiveness && effectiveness.totalInterventions >= 3 && (
                <div>
                    <SectionTitle>Efectividad de intervenciones</SectionTitle>
                    <Card className="p-4">
                        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
                            {/* Overall binary rate */}
                            <div className="flex items-baseline gap-2">
                                <span className="text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums">
                                    {Math.round(effectiveness.overallImprovementRate * 100)}%
                                </span>
                                <span className="text-sm text-gray-400 dark:text-gray-500">
                                    efectivas ({effectiveness.totalImproved}/{effectiveness.totalInterventions})
                                </span>
                            </div>
                            {/* Temporal rates — only shown when there is enough assessed data */}
                            {effectiveness.totalAssessed >= 3 && (
                                <div className="flex items-center gap-4">
                                    {effectiveness.overallImmediateRate > 0 && (
                                        <div className="flex items-baseline gap-1">
                                            <span className="text-base font-semibold text-sky-600 dark:text-sky-400 tabular-nums">
                                                {Math.round(effectiveness.overallImmediateRate * 100)}%
                                            </span>
                                            <span className="text-xs text-gray-400 dark:text-gray-500">inmediato</span>
                                        </div>
                                    )}
                                    <div className="flex items-baseline gap-1">
                                        <span className="text-base font-semibold text-indigo-600 dark:text-indigo-400 tabular-nums">
                                            {Math.round(effectiveness.overallSustainedRate * 100)}%
                                        </span>
                                        <span className="text-xs text-gray-400 dark:text-gray-500">sostenido</span>
                                    </div>
                                </div>
                            )}
                            {/* Top types */}
                            {effectiveness.topTypes.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {effectiveness.topTypes.map(t => (
                                        <div key={t.type} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800">
                                            <span className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                                                {INTERVENTION_TYPE_LABELS[t.type] ?? t.type}
                                            </span>
                                            <span className="text-xs text-emerald-500 dark:text-emerald-400 tabular-nums">
                                                {Math.round(t.improvementRate * 100)}%
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        {/* Pedagogical dimension indicators */}
                        {effectiveness.coursePedagogicalProfile && effectiveness.coursePedagogicalProfile.activeCount > 0 && (
                            <div className="mt-3 pt-3 border-t border-gray-100 dark:border-gray-700 flex flex-wrap gap-x-5 gap-y-1">
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 w-20">Continuidad</span>
                                    <div className="w-20 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-indigo-400 rounded-full" style={{ width: `${Math.round(effectiveness.coursePedagogicalProfile.weeklyPresenceRate * 100)}%` }} />
                                    </div>
                                    <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{Math.round(effectiveness.coursePedagogicalProfile.weeklyPresenceRate * 100)}%</span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 w-20">Vínculo</span>
                                    <div className="w-20 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                        <div className="h-full bg-rose-400 rounded-full" style={{ width: `${Math.round(effectiveness.coursePedagogicalProfile.weekendReadingRate * 100)}%` }} />
                                    </div>
                                    <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{Math.round(effectiveness.coursePedagogicalProfile.weekendReadingRate * 100)}%</span>
                                </div>
                                {effectiveness.coursePedagogicalProfile.conversationalDepthScore > 0 && (
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500 w-20">Conversación</span>
                                        <div className="w-20 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                            <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${Math.round(effectiveness.coursePedagogicalProfile.conversationalDepthScore * 100)}%` }} />
                                        </div>
                                        <span className="text-[10px] tabular-nums text-gray-500 dark:text-gray-400">{Math.round(effectiveness.coursePedagogicalProfile.conversationalDepthScore * 100)}%</span>
                                    </div>
                                )}
                            </div>
                        )}
                        {effectiveness.totalInterventions < 10 && (
                            <p className="mt-2 flex items-start gap-1.5 text-[10px] text-gray-400 dark:text-gray-500">
                                <Info size={10} className="shrink-0 mt-0.5" />
                                Con {effectiveness.totalInterventions} intervención{effectiveness.totalInterventions !== 1 ? 'es' : ''}, los datos son preliminares. La confianza aumenta con el uso.
                            </p>
                        )}
                    </Card>
                </div>
            )}

            {/* ── STUDENTS — tabbed: profiles / table ── */}
            <div>
                <div className="flex items-center gap-0 border-b border-gray-100 dark:border-gray-700 mb-5">
                    {(['profiles', 'table'] as const).map(v => (
                        <button
                            key={v}
                            onClick={() => setStudentView(v)}
                            className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                                studentView === v
                                    ? 'border-indigo-500 text-indigo-600 dark:text-indigo-400'
                                    : 'border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300'
                            }`}
                        >
                            {v === 'profiles' ? 'Por situación' : 'Tabla completa'}
                        </button>
                    ))}
                </div>
                {studentView === 'profiles'
                    ? (
                        <StudentProfilesView
                            students={studentBreakdown}
                            interventionsByStudentId={interventionsByStudentId}
                            onRequestIntervention={student => setInterventionModal({ student })}
                        />
                    )
                    : <StudentTable students={studentBreakdown} />
                }

            </div>

            {/* ── ACTION BLOCK ── */}
            <ActionBlock alerts={alerts} />

            {/* ── FOOTER ── */}
            <p className="text-center text-xs text-gray-300 dark:text-gray-600">
                Calculado el {new Date(data.computedAt).toLocaleString('es', {
                    dateStyle: 'medium', timeStyle: 'short'
                })}
            </p>

            {/* ── INTERVENTION MODAL ── */}
            {interventionModal && user && (
                <InterventionModal
                    student={interventionModal.student}
                    mediatorId={user.id}
                    courseId={courseId!}
                    successPatterns={effectiveness?.successPatterns ?? []}
                    onClose={() => setInterventionModal(null)}
                    onSaved={saved => {
                        setInterventions(prev => [saved, ...prev]);
                        setInterventionModal(null);
                    }}
                />
            )}
        </div>
    );
};

export default DashboardMediador;
