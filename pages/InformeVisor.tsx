import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
// V9 F5-E2 — estados institucionales: textos para la persona y nómina del curso.
import { dataService } from '../services/dataService';
import { describeInstitutionalError, describeNoEligibleReaders, describeAccessWithdrawn, AGGREGATE_VIEW_NOTE, describeActivityCoverage, describeActivityBasis, type ActivityBasisInfo, SESSION_HISTORY_CAPPED_NOTE, type ActivityDataCoverage } from '../utils/institutionalErrors';
import { useAuthorizationRevalidation, useSessionRevalidation } from '../hooks/useAuthorizationRevalidation';
import {
    ArrowLeft, AlertCircle, AlertTriangle, Info, Lightbulb,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

interface Alert { type: string; severity: 'low' | 'medium' | 'high'; message: string; }

interface ProductMetrics {
    totalSessions: number;
    avgSessionDurationMs: number;
    avgBlocksPerSession: number;
    tranceEntryRate: number;
    autoTransitionRate: number;
    completionRate: number;
    distinctContentsRead: number;
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

interface CourseReportMeta {
    generatedAt: string;
    entityType: 'course';
    entityId: string;
    entityName: string;
    school: string | null;
    schoolId: string | null;
    grade: string | null;
    groupType: string;
    dataWindow: { from: number; to: number } | null;
}

interface SchoolReportMeta {
    generatedAt: string;
    entityType: 'school';
    entityId: string;
    entityName: string;
    courseCount: number;
    dataWindow: null;
}

interface StudentRow {
    userId: string;
    name: string;
    hasData: boolean;
    // V9 65D-1 — lectura del curso registrada solo por el progreso: sesiones sin nivel calculable.
    readsWithoutTelemetry?: boolean;
    sessionHistoryCapped?: boolean;   // V9 65E-B: total de sesiones mínimo (registro del lector EPUB lleno)
    // V9 F7-C2R-U3B — sin actividad acreditada del curso, pero con lectura que no puede atribuirse.
    dataState?: 'verified_context' | 'no_activity' | 'unverifiable_history';
    needsAttention: boolean;
    totalSessions: number;
    composite: number;
    literal: number;
    inferential: number;
    critical: number;
    reflective: number;
    level: string;
}

interface CourseBreakdownItem {
    courseId: string;
    courseName: string;
    studentCount: number;
    avgComposite: number;
    avgLiteral: number;
    avgInferential: number;
    avgCritical: number;
    avgReflective: number;
    hasWorks?: boolean;   // V9 65E-C: false = curso sin obras asociadas (sus ceros no son falta de lectura)
}

interface CourseReport {
    courseId: string;
    courseName: string;
    computedAt: number;
    summary: {
        studentCount: number;
        activeStudentCount: number;
        engagementRate: number;
        avgComposite: number;
        level: string;
    };
    productMetrics: ProductMetrics;
    readingLevels: ReadingLevels;
    icdli: ICDLIScores;
    alerts: Alert[];
    // V9 F5-E4: ausente en la vista agregada de administración (`aggregateOnly`).
    studentBreakdown?: StudentRow[];
    aggregateOnly?: boolean;
    // V9 F7-C2R-U3B — lectura que no pudo acreditarse como del curso y no entra en las cifras del informe.
    courseAttribution?: { verified_context: number; unverifiable_history: number; readers_with_unverifiable_history: number; course_has_works?: boolean };
    reportMeta: CourseReportMeta;
}

interface SchoolReport {
    schoolId: string;
    schoolName: string;
    computedAt: number;
    summary: {
        courseCount: number;
        studentCount: number;
        activeStudentCount: number;
        engagementRate: number;
        avgComposite: number;
        level: string;
    };
    productMetrics: ProductMetrics;
    readingLevels: ReadingLevels;
    icdli: ICDLIScores;
    alerts: Alert[];
    courseBreakdown: CourseBreakdownItem[];
    reportMeta: SchoolReportMeta;
}

// ---------------------------------------------------------------------------
// STATIC MAPS
// (mirrored from dashboards — read-only constants, not shared logic)
// ---------------------------------------------------------------------------

const LEVEL_COLORS: Record<string, string> = {
    'Avanzado':      'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
    'En desarrollo': 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
    'Básico':        'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    'Inicial':       'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const ALERT_CONFIG: Record<Alert['severity'], { icon: React.ReactNode; cls: string }> = {
    high:   { icon: <AlertCircle size={14} />,   cls: 'bg-red-50 border-red-200 text-red-700 dark:bg-red-900/20 dark:border-red-800 dark:text-red-300' },
    medium: { icon: <AlertTriangle size={14} />, cls: 'bg-amber-50 border-amber-200 text-amber-700 dark:bg-amber-900/20 dark:border-amber-800 dark:text-amber-300' },
    low:    { icon: <Info size={14} />,          cls: 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300' },
};

// Course-level suggested actions (from mediator perspective)
const COURSE_ACTIONS: Partial<Record<string, string>> = {
    low_trance:     'Introduce bloques de lectura ininterrumpida de al menos 10–15 minutos. Reduce las notificaciones y asegúrate de que los textos son adecuados al nivel del grupo.',
    low_continuity: 'Revisa si los textos asignados están alineados con el nivel lector del grupo. Considera empezar con textos más cortos que permitan completar la lectura en una sesión.',
    low_inference:  'Diseña actividades de predicción antes de leer y preguntas inferenciales después. Pide a los estudiantes que expliquen "¿qué crees que quiso decir el autor con…?"',
    low_sessions:   'Establece una rutina mínima de lectura semanal (ej. 3 sesiones de 15 minutos). Comparte el progreso del grupo con los estudiantes para generar motivación colectiva.',
    low_engagement: 'Identifica qué estudiantes no han iniciado y realiza un seguimiento directo. Considera si hay barreras de acceso técnico o de motivación que abordar con la familia.',
};

// School-level suggested actions (from coordinator/admin perspective)
const SCHOOL_ACTIONS: Partial<Record<string, string>> = {
    low_trance:     'Implementar bloques de lectura sostenida a nivel institucional (20–30 min). Coordinar con mediadores para reducir interrupciones y asegurar que los textos son adecuados al nivel de cada grupo.',
    low_continuity: 'Revisar la adecuación de los textos al nivel lector de cada grupo. Priorizar lecturas breves que permitan sesiones completas antes de avanzar a textos más extensos.',
    low_inference:  'Establecer una estrategia institucional de comprensión inferencial: formación docente en andamiaje lector, preguntas guiadas por curso, y seguimiento en reuniones de acompañamiento.',
    low_sessions:   'Establecer una política mínima de lectura semanal por grupo. Compartir el progreso de la red con los coordinadores académicos para generar responsabilidad colectiva.',
    low_engagement: 'Identificar barreras de acceso a la plataforma e implementar estrategias de motivación colectiva. Involucrar a las familias en la rutina lectora del estudiante.',
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

const ICDLI_GROUPS: Array<{ title: string; keys: (keyof ICDLIScores)[] }> = [
    { title: 'Comprensión lectora',  keys: ['comprehension', 'integration', 'inference'] },
    { title: 'Pensamiento crítico',  keys: ['criticalThinking', 'contextConnection', 'metacognition'] },
    { title: 'Expresión y creación', keys: ['ideaProduction', 'oralWriting'] },
];

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function pct(rate: number): string { return `${Math.round(rate * 100)}%`; }
function r1(n: number): number { return Math.round(n * 10) / 10; }

function formatDuration(ms: number): string {
    const m = Math.floor(ms / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    if (m === 0) return `${s}s`;
    if (s === 0) return `${m}m`;
    return `${m}m ${s}s`;
}

function formatDate(iso: string): string {
    try {
        return new Date(iso).toLocaleString('es', { dateStyle: 'long', timeStyle: 'short' });
    } catch {
        return iso;
    }
}

// ---------------------------------------------------------------------------
// DOCUMENT PRIMITIVES
// Lighter, more spacious than dashboard cards — designed for reading, not scanning.
// ---------------------------------------------------------------------------

const DocLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <h3 className="text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-4">
        {children}
    </h3>
);

// Horizontal reading-level bar (slimmer than dashboard version)
const LevelBar: React.FC<{ label: string; score: number }> = ({ label, score }) => (
    <div className="flex items-center gap-4">
        <span className="w-28 text-sm text-gray-600 dark:text-gray-400 shrink-0">{label}</span>
        <div className="flex-1 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
            <div
                className="h-full bg-indigo-500 rounded-full"
                style={{ width: `${Math.min(100, score)}%` }}
            />
        </div>
        <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 w-10 text-right tabular-nums">
            {score.toFixed(1)}
        </span>
    </div>
);

// Single ICDLI dimension row
const IcdliRow: React.FC<{ label: string; score: number }> = ({ label, score }) => (
    <div className="flex items-center gap-2 py-0.5">
        <span className="text-xs text-gray-500 dark:text-gray-400 w-36 shrink-0">{label}</span>
        <div className="flex gap-0.5">
            {[1, 2, 3, 4].map(i => (
                <div
                    key={i}
                    className={`h-2 w-5 rounded-sm ${i <= score ? 'bg-indigo-500' : 'bg-gray-100 dark:bg-gray-700'}`}
                />
            ))}
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400 w-24">
            {ICDLI_LEVEL[score] ?? '—'}
        </span>
    </div>
);

// Key metric block — used in the summary and product-metrics grids (no card border)
const StatBlock: React.FC<{ label: string; value: string; sub?: string }> = ({ label, value, sub }) => (
    <div>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide mb-0.5">{label}</p>
        <p className="text-xl font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-none">{value}</p>
        {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{sub}</p>}
    </div>
);

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------

interface Props { type: 'course' | 'school'; }

const InformeVisor: React.FC<Props> = ({ type }) => {
    const { id }   = useParams<{ id: string }>();
    const navigate = useNavigate();
    const { user } = useAuth();

    const [data,    setData]    = useState<CourseReport | SchoolReport | null>(null);
    const [loading, setLoading] = useState(true);
    const [error,   setError]   = useState<string | null>(null);
    // V9 F5-E4 — a qué informe pertenece `data`. Las rutas de curso y de colegio comparten esta pantalla: al pasar
    // de una a otra, el informe anterior (con otra forma) se pintaba un instante con el formato nuevo y hacía caer
    // la aplicación. Ahora un informe solo se pinta si es el de la ruta actual.
    const viewKey = `${type}:${id ?? ''}`;
    const [dataKey, setDataKey] = useState<string | null>(null);

    // V9 BI-65C — el informe abierto vuelve a preguntar al servidor (foco, visibilidad, reconexión e intervalo). Una
    // revalidación del mismo informe no pasa por «cargando»; si el servidor ya no lo autoriza, se retira y se explica.
    const [authTick, setAuthTick] = useState(0);
    const loadedFor = useRef<string | null>(null);
    const shown = useRef(false);
    useSessionRevalidation(user);
    useAuthorizationRevalidation(() => setAuthTick(t => t + 1), !!user && !!id);

    // ── Fetch ───────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!user || !id) return;
        let cancelled = false;
        const silent = loadedFor.current === viewKey;
        if (!silent) shown.current = false;
        loadedFor.current = viewKey;
        let withdrawnStatus = 0;
        let httpFailed = false;

        const headers: Record<string, string> = {};

        const url = type === 'course'
            ? `/api/reports/course/${encodeURIComponent(id)}`
            : `/api/reports/school/${encodeURIComponent(id)}`;

        if (!silent) { setLoading(true); setError(null); }

        fetch(url, { headers, cache: 'no-store' })
            .then(r => {
                if (!r.ok) { httpFailed = true; if (silent && shown.current) withdrawnStatus = r.status; shown.current = false; }
                // V9 F5-E2: el código del servidor (p. ej. `individual_access_unavailable` en un 503) se
                // explica; nunca se muestra crudo ni se conserva el informe cargado antes.
                if (!r.ok) {
                    if (!cancelled) setData(null);
                    return r.json().catch(() => ({})).then((b: { error?: string }) => Promise.reject(new Error(
                        type === 'course' ? describeInstitutionalError('course', r.status, b.error) : (b.error ?? `Error ${r.status}`))));
                }
                return r.json();
            })
            .then((d: CourseReport | SchoolReport) => { if (cancelled) return; shown.current = true; setData(d); setDataKey(viewKey); setError(null); setLoading(false); })
            .catch((e: Error) => {
                if (cancelled) return;
                // Sin respuesta durante una revalidación: no confirma ni desmiente; se conserva lo que había.
                if (silent && !httpFailed && shown.current) return;
                setError(withdrawnStatus && type === 'course' ? describeAccessWithdrawn('course', withdrawnStatus) : e.message);
                setLoading(false);
            });
        // Una respuesta que llega después de cambiar de informe ya no corresponde a esta pantalla.
        return () => { cancelled = true; };
    }, [user, id, type, authTick]);

    // ── Recommendations — derived from alerts in severity order ─────────────
    const recommendations = useMemo(() => {
        if (!data) return [];
        const actionsMap = type === 'course' ? COURSE_ACTIONS : SCHOOL_ACTIONS;
        const seen = new Set<string>();
        const result: string[] = [];
        for (const alert of data.alerts) {
            if (seen.has(alert.type)) continue;
            seen.add(alert.type);
            const action = actionsMap[alert.type];
            if (action) {
                result.push(action);
                if (result.length >= 3) break;
            }
        }
        return result;
    }, [data, type]);

    // ── Loading ──────────────────────────────────────────────────────────────
    if (loading || (data !== null && dataKey !== viewKey)) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500 mx-auto mb-3" />
                    <p className="text-sm text-gray-400">Generando informe…</p>
                </div>
            </div>
        );
    }

    // ── Error ────────────────────────────────────────────────────────────────
    if (error || !data) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
                <AlertCircle size={36} className="text-red-400 mb-3" />
                <p className="text-gray-600 dark:text-gray-400 mb-4">{error ?? 'No se pudo cargar el informe.'}</p>
                <button
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                    Volver
                </button>
            </div>
        );
    }

    // ── Narrow types ─────────────────────────────────────────────────────────
    const isCourse   = type === 'course';
    const cd         = isCourse ? (data as CourseReport) : null;

    // V9 F5-E2 — informe de un curso sin lectores con seguimiento habilitado: sus ceros, alertas y
    // recomendaciones no son resultados pedagógicos. Se distingue la nómina del curso de los lectores
    // habilitados y se dice que no hay información consultable.
    if (cd && cd.summary.studentCount === 0) {
        const rosterCount = id && dataService.getAllGroups().some(g => g.id === id && !g.rosterWithheld) ? dataService.getGroupStudents(id).length : null;
        // V9 F5-E4: en la vista agregada el recuento ES la nómina (no depende de habilitaciones).
        const none = describeNoEligibleReaders(cd.aggregateOnly ? 0 : rosterCount);
        if (cd.aggregateOnly) none.title = 'Curso sin estudiantes en la nómina';
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6" role="status">
                <Info size={36} className="text-gray-400 mb-3" aria-hidden="true" />
                <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">{cd.courseName}</h1>
                <p className="text-base font-semibold text-gray-700 dark:text-gray-300 mb-2">{none.title}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">{none.roster}</p>
                <p className="text-sm text-gray-600 dark:text-gray-400 mb-4 max-w-xl leading-relaxed">{none.body}</p>
                <button
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                    Volver
                </button>
            </div>
        );
    }
    const sd         = !isCourse ? (data as SchoolReport) : null;
    const entityName = cd?.courseName ?? sd!.schoolName;
    const { productMetrics: pm, readingLevels: rl, icdli, alerts } = data;
    const meta       = data.reportMeta;

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="max-w-3xl mx-auto px-4 pb-16 pt-6">

            {/* Back navigation — outside the document card */}
            <button
                onClick={() => navigate(-1)}
                className="flex items-center gap-1.5 text-sm text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors mb-6"
            >
                <ArrowLeft size={15} />
                Volver
            </button>

            {/* ── DOCUMENT CARD ── */}
            <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">

                {/* Document header */}
                <div className="px-8 pt-8 pb-6 border-b border-gray-100 dark:border-gray-700">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                            <p className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-widest mb-1.5">
                                {isCourse ? 'Informe de curso' : 'Informe de colegio'} · Chibalete+
                            </p>
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-tight">
                                {entityName}
                            </h1>
                            {/* Course meta: school and grade */}
                            {isCourse && (
                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-2 text-sm text-gray-500 dark:text-gray-400">
                                    {meta.school && <span>{meta.school}</span>}
                                    {meta.school && (cd?.reportMeta as CourseReportMeta).grade && (
                                        <span className="text-gray-300 dark:text-gray-600">·</span>
                                    )}
                                    {(cd?.reportMeta as CourseReportMeta).grade && (
                                        <span>Grado {(cd?.reportMeta as CourseReportMeta).grade}</span>
                                    )}
                                </div>
                            )}
                            {/* School meta: course count */}
                            {!isCourse && (
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                                    {sd!.summary.courseCount} cursos en seguimiento
                                </p>
                            )}
                        </div>

                        {/* Level + date */}
                        <div className="text-right shrink-0">
                            <span className={`inline-block text-sm font-medium px-3 py-1 rounded-full ${LEVEL_COLORS[data.summary.level] ?? ''}`}>
                                {data.summary.level}
                            </span>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">
                                {formatDate(meta.generatedAt)}
                            </p>
                        </div>
                    </div>
                </div>

                {/* ── DOCUMENT BODY ── */}
                <div className="px-8 py-8">
                    <div className="space-y-0 divide-y divide-gray-100 dark:divide-gray-700/60">

                        {/* ── RESUMEN ── */}
                        <section className="pb-8">
                            <DocLabel>Resumen</DocLabel>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-5">
                                {isCourse ? (
                                    <>
                                        <StatBlock
                                            label="Estudiantes activos"
                                            value={`${cd!.summary.activeStudentCount}`}
                                            sub={cd!.aggregateOnly ? `de ${cd!.summary.studentCount} en la nómina` : `de ${cd!.summary.studentCount} con seguimiento habilitado`}
                                        />
                                        <StatBlock
                                            label="Participación"
                                            value={pct(cd!.summary.engagementRate)}
                                        />
                                        <StatBlock
                                            label="Compuesto"
                                            value={`${cd!.summary.avgComposite.toFixed(1)}`}
                                            sub="/ 100"
                                        />
                                        <StatBlock
                                            label="Sesiones totales"
                                            value={`${pm.totalSessions}`}
                                        />
                                    </>
                                ) : (
                                    <>
                                        <StatBlock
                                            label="Cursos"
                                            value={`${sd!.summary.courseCount}`}
                                        />
                                        <StatBlock
                                            label="Estudiantes activos"
                                            value={`${sd!.summary.activeStudentCount}`}
                                            sub={`de ${sd!.summary.studentCount}`}
                                        />
                                        <StatBlock
                                            label="Participación"
                                            value={pct(sd!.summary.engagementRate)}
                                        />
                                        <StatBlock
                                            label="Compuesto"
                                            value={`${sd!.summary.avgComposite.toFixed(1)}`}
                                            sub="/ 100"
                                        />
                                    </>
                                )}
                            </div>
                        </section>

                        {/* ── MÉTRICAS DE PRODUCTO ── */}
                        <section className="py-8">
                            <DocLabel>Actividad lectora</DocLabel>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-5">
                                <StatBlock
                                    label="Flujo de concentración"
                                    value={pct(pm.tranceEntryRate)}
                                    sub="sesiones con streak ≥ 3"
                                />
                                <StatBlock
                                    label="Bloques por sesión"
                                    value={r1(pm.avgBlocksPerSession).toString()}
                                />
                                <StatBlock
                                    label="Tiempo por sesión"
                                    value={formatDuration(pm.avgSessionDurationMs)}
                                />
                                <StatBlock
                                    label="Tasa de completado"
                                    value={pct(pm.completionRate)}
                                    sub="sesiones ≥ 80%"
                                />
                            </div>
                        </section>

                        {/* ── NIVELES DE LECTURA ── */}
                        <section className="py-8">
                            <DocLabel>Niveles de lectura</DocLabel>
                            <div className="space-y-3">
                                <LevelBar label="Literal"     score={rl.literal}      />
                                <LevelBar label="Inferencial" score={rl.inferential}   />
                                <LevelBar label="Crítico"     score={rl.critical}      />
                                <LevelBar label="Reflexivo"   score={rl.reflective}    />
                                <div className="pt-2 border-t border-gray-100 dark:border-gray-700/60">
                                    <LevelBar label="Compuesto"  score={rl.composite}    />
                                </div>
                            </div>
                        </section>

                        {/* ── ICDLI ── */}
                        <section className="py-8">
                            <DocLabel>Dimensiones ICDLI</DocLabel>
                            <div className="space-y-4">
                                {ICDLI_GROUPS.map((group, gi) => (
                                    <div key={group.title}>
                                        {gi > 0 && <div className="border-t border-gray-100 dark:border-gray-700/60 mb-3" />}
                                        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400 dark:text-gray-500 mb-2">
                                            {group.title}
                                        </p>
                                        <div className="space-y-0">
                                            {group.keys.map(key => (
                                                <IcdliRow key={key} label={ICDLI_LABELS[key]} score={icdli[key]} />
                                            ))}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">Escala 1–4 · basada en señales de comportamiento lector</p>
                        </section>

                        {/* ── ALERTAS ── */}
                        {alerts.length > 0 && (
                            <section className="py-8">
                                <DocLabel>Alertas detectadas</DocLabel>
                                <div className="space-y-2">
                                    {alerts.map((alert, i) => {
                                        const cfg = ALERT_CONFIG[alert.severity];
                                        return (
                                            <div
                                                key={`${alert.type}-${i}`}
                                                className={`px-4 py-3 rounded-lg border text-sm ${cfg.cls}`}
                                            >
                                                <div className="flex items-start gap-2.5">
                                                    <span className="mt-0.5 shrink-0">{cfg.icon}</span>
                                                    <span className="font-medium">{alert.message}</span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        )}

                        {/* ── RECOMENDACIONES ── */}
                        {recommendations.length > 0 && (
                            <section className="py-8">
                                <DocLabel>Recomendaciones</DocLabel>
                                <div className="flex items-center gap-2 mb-4">
                                    <Lightbulb size={14} className="text-indigo-500 shrink-0" />
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        Basadas en los patrones detectados
                                    </p>
                                </div>
                                <div className="space-y-4">
                                    {recommendations.map((text, i) => (
                                        <div key={i} className="flex items-start gap-3">
                                            <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
                                                <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">{i + 1}</span>
                                            </div>
                                            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{text}</p>
                                        </div>
                                    ))}
                                </div>
                            </section>
                        )}

                        {/* ── DESGLOSE — Students (course) or Courses (school) ── */}
                        {/* V9 F5-E4: sin desglose (vista agregada de administración) se dice. */}
                        {isCourse && !Array.isArray(cd!.studentBreakdown) && (
                            <p role="note" className="text-sm text-gray-500 dark:text-gray-400 pb-8">{AGGREGATE_VIEW_NOTE}</p>
                        )}
                        {describeActivityBasis(data as ActivityBasisInfo) && (
                            <p role="note" data-testid="report-activity-basis" className="text-sm text-gray-600 dark:text-gray-300 pt-6">{describeActivityBasis(data as ActivityBasisInfo)}</p>
                        )}
                        {describeActivityCoverage((data as { dataCoverage?: ActivityDataCoverage }).dataCoverage) && (
                            <p role="note" data-testid="report-data-coverage" className="text-sm text-gray-600 dark:text-gray-300 pt-6">{describeActivityCoverage((data as { dataCoverage?: ActivityDataCoverage }).dataCoverage)}</p>
                        )}
                        {isCourse && cd!.courseAttribution?.course_has_works === false && (
                            <p role="note" data-testid="report-no-course-works" className="text-sm text-gray-600 dark:text-gray-300 pt-6">Este curso no tiene obras asociadas: no hay lectura del curso que mostrar. Las cifras en cero no significan que sus estudiantes no lean.</p>
                        )}
                        {isCourse && (cd!.courseAttribution?.readers_with_unverifiable_history ?? 0) > 0 && (
                            <p role="note" data-testid="report-unverifiable-history" className="text-sm text-gray-600 dark:text-gray-300 pt-6">
                                {cd!.courseAttribution!.readers_with_unverifiable_history} {cd!.courseAttribution!.readers_with_unverifiable_history === 1 ? 'estudiante tiene' : 'estudiantes tienen'} lectura de obras del curso que no puede atribuirse al curso (empezó antes de la asignación, del ingreso al curso o del registro de esas fechas, o la fecha de lectura no pudo verificarse). Esa lectura no entra en las cifras de este informe y no significa que no hayan leído.
                            </p>
                        )}
                        {isCourse && Array.isArray(cd!.studentBreakdown) && cd!.studentBreakdown.length > 0 && (
                            <section className="py-8">
                                <DocLabel>
                                    Desglose por estudiante ({cd!.studentBreakdown.length})
                                </DocLabel>
                                <StudentBreakdownTable students={cd!.studentBreakdown} />
                            </section>
                        )}

                        {!isCourse && sd!.courseBreakdown.length > 0 && (
                            <section className="py-8">
                                <DocLabel>
                                    Desglose por curso ({sd!.courseBreakdown.length})
                                </DocLabel>
                                <CourseBreakdownTable courses={sd!.courseBreakdown} />
                            </section>
                        )}

                    </div>
                </div>

                {/* Document footer */}
                <div className="px-8 py-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
                    <p className="text-[10px] text-gray-300 dark:text-gray-600">
                        Chibalete+ · {isCourse ? 'Informe de curso' : 'Informe de colegio'}
                    </p>
                    <p className="text-[10px] text-gray-300 dark:text-gray-600">
                        {formatDate(meta.generatedAt)}
                    </p>
                </div>

            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// BREAKDOWN TABLES
// Simplified — no sorting, no filters, just clean readable tables.
// ---------------------------------------------------------------------------

const StudentBreakdownTable: React.FC<{ students: StudentRow[] }> = ({ students }) => {
    const LIMIT  = 20;
    const rows   = students.slice(0, LIMIT);
    const hidden = students.length - rows.length;

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm">
                <thead>
                    <tr className="border-b border-gray-100 dark:border-gray-700">
                        <th className="pb-2 text-left text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Nombre</th>
                        <th className="pb-2 px-3 text-right text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Compuesto</th>
                        <th className="pb-2 px-3 text-right text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Literal</th>
                        <th className="pb-2 px-3 text-right text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Infer.</th>
                        <th className="pb-2 px-3 text-right text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Sesiones</th>
                        <th className="pb-2 text-left text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Nivel</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/40">
                    {rows.map(s => (
                        <tr key={s.userId} className={s.hasData || s.readsWithoutTelemetry ? '' : 'opacity-50'}>
                            <td className="py-2 pr-3">
                                <span className={`text-sm ${s.hasData || s.readsWithoutTelemetry ? 'text-gray-700 dark:text-gray-300' : 'text-gray-400 dark:text-gray-500 italic'}`}>
                                    {s.name}
                                </span>
                            </td>
                            <td className="py-2 px-3 text-right font-semibold text-gray-900 dark:text-gray-100 tabular-nums text-sm">
                                {s.hasData ? s.composite : '—'}
                            </td>
                            <td className="py-2 px-3 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                                {s.hasData ? s.literal : '—'}
                            </td>
                            <td className="py-2 px-3 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                                {s.hasData ? s.inferential : '—'}
                            </td>
                            <td className="py-2 px-3 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                                {s.dataState === 'unverifiable_history' ? '—' : s.sessionHistoryCapped ? <span title={`Al menos ${s.totalSessions}: ${SESSION_HISTORY_CAPPED_NOTE}`}>{s.totalSessions}+</span> : s.totalSessions}
                            </td>
                            <td className="py-2">
                                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                                    // V9 65D-1: sin nivel calculado no hereda el color de «Inicial».
                                    !s.hasData ? (s.readsWithoutTelemetry ? 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300' : 'bg-gray-100 text-gray-500') : {
                                        'Avanzado':      'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300',
                                        'En desarrollo': 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300',
                                        'Básico':        'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
                                        'Inicial':       'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
                                    }[s.level] ?? 'bg-gray-100 text-gray-500'
                                }`}>
                                    {s.hasData ? s.level : s.readsWithoutTelemetry ? 'Lee · nivel sin calcular' : s.dataState === 'unverifiable_history' ? 'Lectura no atribuible' : 'Sin datos'}
                                </span>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {hidden > 0 && (
                <p className="mt-3 text-xs text-gray-400 dark:text-gray-500 text-center">
                    Mostrando {rows.length} de {students.length} estudiantes
                </p>
            )}
        </div>
    );
};

const CourseBreakdownTable: React.FC<{ courses: CourseBreakdownItem[] }> = ({ courses }) => (
    <div className="overflow-x-auto">
        <table className="w-full text-sm">
            <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700">
                    <th className="pb-2 text-left text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Curso</th>
                    <th className="pb-2 px-3 text-right text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Compuesto</th>
                    <th className="pb-2 px-3 text-right text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Infer.</th>
                    <th className="pb-2 px-3 text-right text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Crítico</th>
                    <th className="pb-2 text-right text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide">Alumnos</th>
                </tr>
            </thead>
            <tbody className="divide-y divide-gray-50 dark:divide-gray-700/40">
                {courses.map(c => {
                    const level = c.avgComposite >= 75 ? 'Avanzado' : c.avgComposite >= 55 ? 'En desarrollo' : c.avgComposite >= 30 ? 'Básico' : 'Inicial';
                    return (
                        <tr key={c.courseId}>
                            <td className="py-2 pr-3 font-medium text-gray-700 dark:text-gray-300">{c.courseName}{c.hasWorks === false && <span className="ml-2 text-xs font-normal text-gray-500" data-state="no_course_works">· sin obras asociadas (sus cifras en cero no indican falta de lectura)</span>}</td>
                            <td className="py-2 px-3 text-right">
                                <span className="font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                                    {r1(c.avgComposite)}
                                </span>
                                <span className={`ml-2 text-xs font-medium px-1.5 py-0.5 rounded-full ${LEVEL_COLORS[level] ?? ''}`}>
                                    {level}
                                </span>
                            </td>
                            <td className="py-2 px-3 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                                {r1(c.avgInferential)}
                            </td>
                            <td className="py-2 px-3 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                                {r1(c.avgCritical)}
                            </td>
                            <td className="py-2 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                                {c.studentCount}
                            </td>
                        </tr>
                    );
                })}
            </tbody>
        </table>
    </div>
);

export default InformeVisor;
