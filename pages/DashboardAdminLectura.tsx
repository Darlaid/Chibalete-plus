import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import {
    AlertTriangle, Info, AlertCircle, Lightbulb,
    Users, BookOpen, School, BarChart2,
    ChevronRight, ExternalLink, FileText,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

interface Alert { type: string; severity: 'low' | 'medium' | 'high'; message: string; }

interface GroupedAlert {
    type: string;
    severity: Alert['severity'];
    message: string;
    schoolCount: number;
    schoolNames: string[];
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
}

interface SchoolMetrics {
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
    alerts: Alert[];
    courseBreakdown: CourseBreakdownItem[];
}

interface CourseRow extends CourseBreakdownItem {
    schoolId: string;
    schoolName: string;
    level: string;
}

interface GlobalSummary {
    schoolCount: number;
    totalCourses: number;
    totalStudents: number;
    activeStudents: number;
    avgComposite: number;
    level: string;
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

const ALERT_SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Institutional-level suggested actions derived from active alert patterns.
 * Framed for a coordinator/admin audience, not individual teachers.
 */
const INSTITUTIONAL_ACTIONS: Partial<Record<string, string>> = {
    low_trance:     'Implementar bloques de lectura sostenida a nivel institucional (20–30 min por sesión). Coordinar con mediadores para reducir interrupciones y asegurar que los textos sean adecuados al nivel de cada grupo.',
    low_continuity: 'Revisar la adecuación de los textos al nivel lector de cada grupo. Priorizar lecturas breves que permitan sesiones completas antes de avanzar a textos más extensos.',
    low_inference:  'Establecer una estrategia institucional de comprensión inferencial: formación docente en andamiaje lector, preguntas guiadas por curso, y seguimiento del nivel inferencial en reuniones de acompañamiento.',
    low_sessions:   'Establecer una política mínima de lectura semanal por grupo (ej. 3 sesiones de 15 min). Compartir el progreso de la red con los coordinadores académicos para generar responsabilidad colectiva.',
    low_engagement: 'Identificar barreras de acceso a la plataforma e implementar estrategias de motivación colectiva. Involucrar a las familias a través de comunicaciones sobre la rutina lectora del estudiante.',
};

// ---------------------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------------------

function pct(rate: number): string { return `${Math.round(rate * 100)}%`; }
function r1(n: number): number { return Math.round(n * 10) / 10; }
function meanOf(arr: number[]): number {
    if (arr.length === 0) return 0;
    return arr.reduce((s, v) => s + v, 0) / arr.length;
}
function compositeToLabel(score: number): string {
    if (score >= 75) return 'Avanzado';
    if (score >= 55) return 'En desarrollo';
    if (score >= 30) return 'Básico';
    return 'Inicial';
}

/**
 * One-sentence executive summary of the full network's reading state.
 * Combines level, engagement rate, and most urgent signal into a plain statement.
 */
function buildNetworkInterpretation(
    summary: GlobalSummary,
    groupedAlerts: GroupedAlert[],
    allCourses: CourseRow[]
): string {
    if (summary.activeStudents === 0) {
        return 'No hay actividad lectora registrada en la red. Se necesita activación por parte de los mediadores.';
    }

    const levelPart: Record<string, string> = {
        'Avanzado':      'La red lectora muestra un nivel avanzado en promedio',
        'En desarrollo': 'La red lectora está en desarrollo activo',
        'Básico':        'La red lectora se encuentra en nivel básico',
        'Inicial':       'La red lectora está en etapa inicial de comprensión',
    };
    const level = levelPart[summary.level] ?? 'La red lectora tiene actividad registrada';

    const engRate = summary.totalStudents > 0 ? summary.activeStudents / summary.totalStudents : 0;
    const eng = engRate >= 0.70
        ? 'con alta participación estudiantil'
        : engRate >= 0.45
        ? 'con participación moderada'
        : 'pero con baja participación estudiantil';

    const highAlerts    = groupedAlerts.filter(a => a.severity === 'high').length;
    const riskCourses   = allCourses.filter(c => c.avgComposite < 30).length;

    const state = highAlerts > 0
        ? `Hay ${highAlerts} alerta${highAlerts > 1 ? 's' : ''} crítica${highAlerts > 1 ? 's' : ''} que requieren intervención coordinada.`
        : riskCourses > 0
        ? `${riskCourses} curso${riskCourses > 1 ? 's requieren' : ' requiere'} seguimiento pedagógico.`
        : 'No hay alertas críticas activas en la red.';

    return `${level} ${eng}. ${state}`;
}

// ---------------------------------------------------------------------------
// COURSE STATUS
// ---------------------------------------------------------------------------

type CourseStatus = 'ok' | 'risk' | 'nodata';

function courseStatus(c: CourseRow): CourseStatus {
    if (c.studentCount === 0) return 'nodata';
    if (c.avgComposite < 30)  return 'risk';
    return 'ok';
}

const COURSE_STATUS_CONFIG: Record<CourseStatus, { label: string; dot: string; cls: string }> = {
    ok:     { label: 'Normal',    dot: 'bg-emerald-400',                     cls: 'text-emerald-600 dark:text-emerald-400' },
    risk:   { label: 'En riesgo', dot: 'bg-amber-400',                       cls: 'text-amber-600 dark:text-amber-400'   },
    nodata: { label: 'Sin datos', dot: 'bg-gray-300 dark:bg-gray-600',        cls: 'text-gray-400 dark:text-gray-500'     },
};

// ---------------------------------------------------------------------------
// SHARED VISUAL COMPONENTS (consistent with DashboardMediador)
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

interface StatCardProps { icon: React.ReactNode; label: string; value: string | number; sub?: string; }
const StatCard: React.FC<StatCardProps> = ({ icon, label, value, sub }) => (
    <Card className="p-5 flex items-start gap-3">
        <div className="mt-0.5 text-indigo-500 shrink-0">{icon}</div>
        <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-1">{label}</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-gray-100 leading-none">{value}</p>
            {sub && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{sub}</p>}
        </div>
    </Card>
);

// ---------------------------------------------------------------------------
// SCHOOL CARD
// Visual hierarchy: name → level + alert → secondary stats | composite (primary) + engagement
// Uses a <div> wrapper (not <button>) to allow valid nested action buttons.
// ---------------------------------------------------------------------------

const SchoolCard: React.FC<{
    metrics: SchoolMetrics;
    selected: boolean;
    onSelect: () => void;
    onViewReport: () => void;
}> = ({ metrics, selected, onSelect, onViewReport }) => {
    const { summary, alerts } = metrics;
    const highCount = alerts.filter(a => a.severity === 'high').length;
    const hasAlerts = alerts.length > 0;

    return (
        <div
            className={`rounded-xl border shadow-sm bg-white dark:bg-gray-800 transition-all ${
                selected
                    ? 'border-indigo-400 dark:border-indigo-600 ring-1 ring-indigo-200 dark:ring-indigo-900'
                    : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
            }`}
        >
            {/* Selectable body */}
            <div
                role="button"
                tabIndex={0}
                onClick={onSelect}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
                className="p-4 cursor-pointer"
            >
                <div className="flex items-center justify-between gap-4">

                    {/* Left: name → level + alert → context */}
                    <div className="min-w-0">
                        <p className="font-semibold text-gray-900 dark:text-gray-100 truncate">
                            {metrics.schoolName}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LEVEL_COLORS[summary.level] ?? ''}`}>
                                {summary.level}
                            </span>
                            {hasAlerts && (
                                <span className={`flex items-center gap-1 text-xs font-medium ${
                                    highCount > 0
                                        ? 'text-red-600 dark:text-red-400'
                                        : 'text-amber-600 dark:text-amber-400'
                                }`}>
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${highCount > 0 ? 'bg-red-500' : 'bg-amber-400'}`} />
                                    {alerts.length} {alerts.length === 1 ? 'alerta' : 'alertas'}
                                </span>
                            )}
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1.5">
                            {summary.courseCount} cursos · {summary.activeStudentCount} activos de {summary.studentCount}
                        </p>
                    </div>

                    {/* Right: composite + engagement + chevron */}
                    <div className="flex items-center gap-5 shrink-0">
                        <div className="text-right">
                            <div className="flex items-baseline gap-0.5 justify-end">
                                <span className="text-2xl font-bold text-gray-900 dark:text-gray-100 tabular-nums leading-none">
                                    {summary.avgComposite.toFixed(1)}
                                </span>
                                <span className="text-xs text-gray-400 dark:text-gray-500">/100</span>
                            </div>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide mt-0.5">compuesto</p>
                        </div>
                        <div className="text-right">
                            <p className="text-base font-semibold text-gray-700 dark:text-gray-300 tabular-nums leading-none">
                                {pct(summary.engagementRate)}
                            </p>
                            <p className="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wide mt-0.5">activos</p>
                        </div>
                        <ChevronRight
                            size={16}
                            className={`text-gray-300 dark:text-gray-600 transition-transform duration-200 ${
                                selected ? 'rotate-90 !text-indigo-500' : ''
                            }`}
                        />
                    </div>

                </div>
            </div>

            {/* Footer — report action, stops propagation from reaching the selection handler */}
            <div className="px-4 pb-3 flex justify-end border-t border-gray-50 dark:border-gray-700/50 pt-2.5">
                <button
                    onClick={onViewReport}
                    className="flex items-center gap-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                >
                    <FileText size={12} />
                    Ver informe
                </button>
            </div>
        </div>
    );
};

// ---------------------------------------------------------------------------
// COURSE TABLE
// Column priority: Curso | (Colegio) | Nivel | Estado | Compuesto | detail… | →
// Secondary columns (Literal, Infer., Crítico, Alumnos) are visually de-emphasized.
// ---------------------------------------------------------------------------

const CourseTable: React.FC<{
    courses: CourseRow[];
    multiSchool: boolean;
    onNavigate: (path: string) => void;
}> = ({ courses, multiSchool, onNavigate }) => {
    if (courses.length === 0) {
        return (
            <Card className="p-8 text-center">
                <p className="text-sm text-gray-400 dark:text-gray-500">No hay cursos que mostrar.</p>
            </Card>
        );
    }

    const thPrimary = 'px-3 py-2.5 text-left text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide';
    const thSecondary = 'px-3 py-2.5 text-right text-xs font-medium text-gray-300 dark:text-gray-600 uppercase tracking-wide';

    return (
        <Card className="overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="border-b border-gray-100 dark:border-gray-700">
                        <tr>
                            {/* Primary columns */}
                            <th className={`pl-4 pr-3 py-2.5 text-left text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wide`}>
                                Curso
                            </th>
                            {multiSchool && (
                                <th className={thPrimary}>Colegio</th>
                            )}
                            <th className={thPrimary}>Nivel</th>
                            <th className={thPrimary}>Estado</th>
                            <th className={`${thPrimary} text-right`}>Compuesto</th>
                            {/* Secondary columns — lighter weight */}
                            <th className={thSecondary}>Literal</th>
                            <th className={thSecondary}>Infer.</th>
                            <th className={thSecondary}>Crítico</th>
                            <th className={thSecondary}>Alumnos</th>
                            <th className="px-3 pr-4 py-2.5" />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                        {courses.map(course => {
                            const status = courseStatus(course);
                            const sc     = COURSE_STATUS_CONFIG[status];
                            return (
                                <tr
                                    key={course.courseId}
                                    className={`transition-colors ${
                                        status === 'risk'
                                            ? 'bg-amber-50/50 dark:bg-amber-900/10'
                                            : status === 'nodata'
                                            ? 'opacity-60'
                                            : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'
                                    }`}
                                >
                                    {/* Primary data — full weight */}
                                    <td className="pl-4 pr-3 py-2.5 font-medium text-gray-800 dark:text-gray-200">
                                        {course.courseName}
                                    </td>
                                    {multiSchool && (
                                        <td className="px-3 py-2.5 text-xs text-gray-500 dark:text-gray-400">
                                            {course.schoolName}
                                        </td>
                                    )}
                                    <td className="px-3 py-2.5">
                                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${LEVEL_COLORS[course.level] ?? ''}`}>
                                            {course.level}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2.5">
                                        <div className={`flex items-center gap-1.5 ${sc.cls}`}>
                                            <span className={`w-2 h-2 rounded-full shrink-0 ${sc.dot}`} />
                                            <span className="text-xs font-medium">{sc.label}</span>
                                        </div>
                                    </td>
                                    <td className="px-3 py-2.5 text-right font-semibold text-gray-900 dark:text-gray-100 tabular-nums">
                                        {course.studentCount > 0 ? course.avgComposite : '—'}
                                    </td>
                                    {/* Secondary data — reduced weight */}
                                    <td className="px-3 py-2.5 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                                        {course.studentCount > 0 ? r1(course.avgLiteral) : '—'}
                                    </td>
                                    <td className="px-3 py-2.5 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                                        {course.studentCount > 0 ? r1(course.avgInferential) : '—'}
                                    </td>
                                    <td className="px-3 py-2.5 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                                        {course.studentCount > 0 ? r1(course.avgCritical) : '—'}
                                    </td>
                                    <td className="px-3 py-2.5 text-right text-xs text-gray-400 dark:text-gray-500 tabular-nums">
                                        {course.studentCount}
                                    </td>
                                    <td className="px-3 pr-4 py-2.5">
                                        <div className="flex items-center gap-3 whitespace-nowrap">
                                            <button
                                                onClick={() => onNavigate(`/dashboard/curso/${course.courseId}`)}
                                                className="flex items-center gap-0.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 transition-colors"
                                            >
                                                Detalle
                                                <ChevronRight size={11} />
                                            </button>
                                            <span className="text-gray-200 dark:text-gray-700">·</span>
                                            <button
                                                onClick={() => onNavigate(`/reportes/curso/${course.courseId}`)}
                                                className="flex items-center gap-1 text-xs text-gray-400 dark:text-gray-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                            >
                                                <FileText size={11} />
                                                Informe
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </Card>
    );
};

// ---------------------------------------------------------------------------
// INSTITUTIONAL RECOMMENDATIONS
// Derived from the top severity grouped alerts, framed for admin audience.
// ---------------------------------------------------------------------------

const InstitutionalActions: React.FC<{ alerts: GroupedAlert[] }> = ({ alerts }) => {
    const actions = useMemo(() => {
        const seen = new Set<string>();
        const result: string[] = [];
        for (const alert of alerts) { // already sorted high → low
            const action = INSTITUTIONAL_ACTIONS[alert.type];
            if (action && !seen.has(alert.type)) {
                seen.add(alert.type);
                result.push(action);
                if (result.length >= 3) break;
            }
        }
        return result;
    }, [alerts]);

    if (actions.length === 0) return null;

    return (
        <div>
            <SectionTitle>Recomendaciones institucionales</SectionTitle>
            <Card className="p-5">
                <div className="flex items-center gap-2 mb-4">
                    <Lightbulb size={16} className="text-indigo-500 shrink-0" />
                    <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                        Basadas en los patrones detectados en la red
                    </p>
                </div>
                <div className="space-y-4">
                    {actions.map((text, i) => (
                        <div key={i} className="flex items-start gap-3">
                            <div className="mt-0.5 w-5 h-5 rounded-full bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center shrink-0">
                                <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400">{i + 1}</span>
                            </div>
                            <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">{text}</p>
                        </div>
                    ))}
                </div>
            </Card>
        </div>
    );
};

// ---------------------------------------------------------------------------
// MAIN COMPONENT
// ---------------------------------------------------------------------------

type CourseFilter = 'all' | 'top' | 'attention';

const DashboardAdminLectura: React.FC = () => {
    const navigate = useNavigate();
    const { user }  = useAuth();

    const [schools,       setSchools]       = useState<Array<{ schoolId: string; schoolName: string }>>([]);
    const [schoolMetrics, setSchoolMetrics] = useState<Record<string, SchoolMetrics>>({});
    const [loading,       setLoading]       = useState(true);
    const [error,         setError]         = useState<string | null>(null);

    const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
    const [courseFilter,   setCourseFilter]   = useState<CourseFilter>('all');

    // ── Fetch ───────────────────────────────────────────────────────────────
    useEffect(() => {
        if (!user) return;

        const headers: Record<string, string> = {
            'x-user-id': user.id,
        };

        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const listRes = await fetch('/api/metrics/schools', { headers });
                if (!listRes.ok) throw new Error(`Error ${listRes.status} al cargar colegios`);
                const { schools: schoolList } = await listRes.json() as { schools: Array<{ schoolId: string; schoolName: string }> };
                setSchools(schoolList);

                const results = await Promise.allSettled(
                    schoolList.map(s =>
                        fetch(`/api/metrics/school/${encodeURIComponent(s.schoolId)}`, { headers })
                            .then(r => r.json() as Promise<SchoolMetrics & { error?: string }>)
                    )
                );

                const metricsMap: Record<string, SchoolMetrics> = {};
                results.forEach((result, i) => {
                    if (result.status === 'fulfilled' && !result.value.error) {
                        metricsMap[schoolList[i].schoolId] = result.value;
                    }
                });
                setSchoolMetrics(metricsMap);
            } catch (e: unknown) {
                setError(e instanceof Error ? e.message : 'Error al cargar datos');
            } finally {
                setLoading(false);
            }
        };

        load();
    }, [user]);

    // ── Derived data ────────────────────────────────────────────────────────

    const loaded = useMemo(() => Object.values(schoolMetrics), [schoolMetrics]);

    const globalSummary = useMemo((): GlobalSummary | null => {
        if (loaded.length === 0) return null;
        const totalCourses   = loaded.reduce((s, m) => s + m.summary.courseCount, 0);
        const totalStudents  = loaded.reduce((s, m) => s + m.summary.studentCount, 0);
        const activeStudents = loaded.reduce((s, m) => s + m.summary.activeStudentCount, 0);
        const composites     = loaded.map(m => m.summary.avgComposite).filter(x => x > 0);
        const avgComposite   = r1(meanOf(composites));
        return {
            schoolCount: loaded.length,
            totalCourses,
            totalStudents,
            activeStudents,
            avgComposite,
            level: compositeToLabel(avgComposite),
        };
    }, [loaded]);

    const visibleSchools = useMemo(
        () => selectedSchool ? loaded.filter(m => m.schoolId === selectedSchool) : loaded,
        [loaded, selectedSchool]
    );

    const allCourses = useMemo((): CourseRow[] =>
        visibleSchools
            .flatMap(m =>
                (m.courseBreakdown ?? []).map(c => ({
                    ...c,
                    avgComposite: r1(c.avgComposite),
                    schoolId:    m.schoolId,
                    schoolName:  m.schoolName,
                    level:       compositeToLabel(c.avgComposite),
                }))
            )
            .sort((a, b) => b.avgComposite - a.avgComposite),
        [visibleSchools]
    );

    const filteredCourses = useMemo((): CourseRow[] => {
        if (courseFilter === 'top')       return allCourses.slice(0, 5);
        if (courseFilter === 'attention') return allCourses.filter(c => c.avgComposite < 30);
        return allCourses;
    }, [allCourses, courseFilter]);

    const attentionCount = useMemo(
        () => allCourses.filter(c => c.avgComposite < 30 && c.studentCount > 0).length,
        [allCourses]
    );

    // Grouped alerts: one entry per alert type, counting affected schools
    const groupedAlerts = useMemo((): GroupedAlert[] => {
        const map = new Map<string, GroupedAlert>();
        for (const m of loaded) {
            for (const alert of m.alerts) {
                if (!map.has(alert.type)) {
                    map.set(alert.type, {
                        type:        alert.type,
                        severity:    alert.severity,
                        message:     alert.message,
                        schoolCount: 0,
                        schoolNames: [],
                    });
                }
                const entry = map.get(alert.type)!;
                entry.schoolCount++;
                entry.schoolNames.push(m.schoolName);
            }
        }
        return [...map.values()].sort(
            (a, b) => (ALERT_SEVERITY_ORDER[a.severity] ?? 2) - (ALERT_SEVERITY_ORDER[b.severity] ?? 2)
        );
    }, [loaded]);

    const interpretation = useMemo(
        () => globalSummary ? buildNetworkInterpretation(globalSummary, groupedAlerts, allCourses) : null,
        [globalSummary, groupedAlerts, allCourses]
    );

    // ── Loading / Error ─────────────────────────────────────────────────────
    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <div className="text-center">
                    <div className="animate-spin rounded-full h-8 w-8 border-t-2 border-b-2 border-indigo-500 mx-auto mb-3" />
                    <p className="text-sm text-gray-400">Cargando métricas institucionales…</p>
                </div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
                <AlertCircle size={36} className="text-red-400 mb-3" />
                <p className="text-gray-600 dark:text-gray-400 mb-4">{error}</p>
                <button
                    onClick={() => navigate(-1)}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 transition-colors"
                >
                    Volver
                </button>
            </div>
        );
    }

    if (schools.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
                <School size={36} className="text-gray-300 dark:text-gray-600 mb-3" />
                <p className="text-gray-500 dark:text-gray-400">No hay colegios con datos disponibles.</p>
            </div>
        );
    }

    // ── Render ───────────────────────────────────────────────────────────────
    return (
        <div className="max-w-6xl mx-auto px-4 pb-16 pt-6 space-y-8">

            {/* ── HEADER ── */}
            <div>
                <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                    Panel de lectura institucional
                </h1>
                <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">
                    Vista consolidada de actividad lectora · {schools.length} {schools.length === 1 ? 'colegio' : 'colegios'}
                </p>
            </div>

            {/* ── GLOBAL SUMMARY + INTERPRETATION ── */}
            {globalSummary && (
                <div>
                    <SectionTitle>Resumen global</SectionTitle>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatCard
                            icon={<School size={18} />}
                            label="Colegios"
                            value={globalSummary.schoolCount}
                        />
                        <StatCard
                            icon={<BookOpen size={18} />}
                            label="Cursos"
                            value={globalSummary.totalCourses}
                        />
                        <StatCard
                            icon={<Users size={18} />}
                            label="Estudiantes activos"
                            value={globalSummary.activeStudents}
                            sub={`de ${globalSummary.totalStudents} totales`}
                        />
                        <StatCard
                            icon={<BarChart2 size={18} />}
                            label="Compuesto promedio"
                            value={globalSummary.avgComposite}
                            sub={globalSummary.level}
                        />
                    </div>
                    {/* Executive interpretation sentence */}
                    {interpretation && (
                        <p className="mt-3 text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                            {interpretation}
                        </p>
                    )}
                </div>
            )}

            {/* ── SCHOOL COMPARISON ── */}
            {loaded.length > 0 && (
                <div>
                    <div className="flex items-center justify-between mb-3">
                        <SectionTitle>
                            {loaded.length === 1 ? 'Colegio' : `Colegios (${loaded.length})`}
                        </SectionTitle>
                        {selectedSchool && (
                            <button
                                onClick={() => setSelectedSchool(null)}
                                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                            >
                                Ver todos
                            </button>
                        )}
                    </div>
                    <div className="space-y-3">
                        {loaded.map(m => (
                            <SchoolCard
                                key={m.schoolId}
                                metrics={m}
                                selected={selectedSchool === m.schoolId}
                                onSelect={() => setSelectedSchool(prev => prev === m.schoolId ? null : m.schoolId)}
                                onViewReport={() => navigate(`/reportes/colegio/${m.schoolId}`)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* ── COURSE COMPARISON ── */}
            {allCourses.length > 0 && (
                <div>
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <h2 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-widest">
                            {selectedSchool
                                ? `Cursos — ${loaded.find(m => m.schoolId === selectedSchool)?.schoolName ?? selectedSchool}`
                                : `Todos los cursos (${allCourses.length})`
                            }
                        </h2>
                        <div className="flex gap-1.5">
                            {(['all', 'top', 'attention'] as CourseFilter[]).map(f => (
                                <button
                                    key={f}
                                    onClick={() => setCourseFilter(f)}
                                    className={`px-3 py-1 text-xs font-medium rounded-full border transition-colors ${
                                        courseFilter === f
                                            ? 'bg-indigo-600 border-indigo-600 text-white'
                                            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 hover:border-indigo-400 hover:text-indigo-600 dark:hover:border-indigo-600 dark:hover:text-indigo-400'
                                    }`}
                                >
                                    {f === 'all'
                                        ? 'Todos'
                                        : f === 'top'
                                        ? 'Top 5'
                                        : `Requieren atención${attentionCount > 0 ? ` (${attentionCount})` : ''}`
                                    }
                                </button>
                            ))}
                        </div>
                    </div>
                    <CourseTable
                        courses={filteredCourses}
                        multiSchool={!selectedSchool && loaded.length > 1}
                        onNavigate={navigate}
                    />
                </div>
            )}

            {/* ── GLOBAL ALERTS — grouped by type, with affected school count ── */}
            {groupedAlerts.length > 0 && (
                <div>
                    <SectionTitle>
                        Alertas institucionales ({groupedAlerts.length} {groupedAlerts.length === 1 ? 'patrón' : 'patrones'})
                    </SectionTitle>
                    <div className="space-y-2">
                        {groupedAlerts.map(alert => {
                            const cfg = ALERT_CONFIG[alert.severity];
                            return (
                                <div
                                    key={alert.type}
                                    className={`px-4 py-3 rounded-lg border text-sm ${cfg.cls}`}
                                >
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="flex items-start gap-2.5 min-w-0">
                                            <span className="mt-0.5 shrink-0">{cfg.icon}</span>
                                            <span className="font-medium">{alert.message}</span>
                                        </div>
                                        <span className="text-xs opacity-70 shrink-0 whitespace-nowrap pt-0.5">
                                            {alert.schoolCount === 1
                                                ? alert.schoolNames[0]
                                                : `${alert.schoolCount} colegios`
                                            }
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── INSTITUTIONAL RECOMMENDATIONS ── */}
            <InstitutionalActions alerts={groupedAlerts} />

            {/* ── REPORT ACTIONS ── */}
            {allCourses.length > 0 && (
                <div>
                    <SectionTitle>Acceso rápido a informes</SectionTitle>
                    <Card className="p-5">
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                            Accede al informe pedagógico detallado de cada curso directamente.
                        </p>
                        <div className="flex flex-wrap gap-2">
                            {allCourses.map(c => (
                                <button
                                    key={c.courseId}
                                    onClick={() => navigate(`/dashboard/curso/${c.courseId}`)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 rounded-lg hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition-colors"
                                >
                                    {c.courseName}
                                    <ExternalLink size={11} />
                                </button>
                            ))}
                        </div>
                    </Card>
                </div>
            )}

            {/* ── FOOTER ── */}
            <p className="text-center text-xs text-gray-300 dark:text-gray-600">
                Datos calculados en tiempo real al abrir el panel
            </p>

        </div>
    );
};

export default DashboardAdminLectura;
