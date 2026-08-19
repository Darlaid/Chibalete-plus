import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import { isMediator, isAdmin as checkIsAdmin } from '../utils/permissions';
import { analizarProgresoPedagogico } from '../services/geminiService';
import type { Group, User, PedagogicalStats, Assignment, Content, AssignmentSubmission, Bundle, StudentLearningSignals, StudentRecommendationBundle, LeoTeacherAdvisorSummary } from '../types';
import { Users, BookOpen, BrainCircuit, Clock, ChevronRight, BarChart2, Zap, Repeat, Timer, TrendingUp, ClipboardList, Plus, Calendar, Trash, FileText, X, Video, Image, Eye, EyeOff, Send, PenTool, MessageCircle, CheckCircle, Package, Sparkles, Download, Loader2, ExternalLink, BookMarked, PenLine } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Import extracted components
import { ProgressBar } from '../components/aula-viva/ProgressBar';
import { CompetencyBar } from '../components/aula-viva/CompetencyBar';
import { DistributionChart } from '../components/aula-viva/DistributionChart';
import { TrendChart } from '../components/aula-viva/TrendChart';
import { StudentRow } from '../components/aula-viva/StudentRow';
import { GroupDiagnosisPanel } from '../components/aula-viva/GroupDiagnosisPanel';
import { ProduccionesTab } from '../components/review/ProduccionesTab';
import type { GroupDiagnosis } from '../utils/groupDiagnosis';
import { StudentStatusPanel } from '../components/aula-viva/StudentStatusPanel';
import type { StudentStatus } from '../utils/studentStatus';
import ClubFormModal from '../components/ClubFormModal';

// --- Components for Charts & Visuals ---
// (Refactored to separate files in components/aula-viva)


const OBJECTIVES_DETAILS = [
    {
        id: 'comprender_global',
        title: '1. Comprender Globalmente',
        meta: 'Leer y comprender textos de diversas longitudes y complejidades, identificando ideas principales.',
        rol: 'Guiar al estudiante con preguntas sobre estructura del texto y significado general.'
    },
    {
        id: 'inferir_significados',
        title: '2. Inferir Significados',
        meta: 'Desarrollar la habilidad de "leer entre líneas", deducir intenciones del autor o emociones.',
        rol: 'Lanzar preguntas inferenciales, metáforas guiadas e hipótesis provocadoras.'
    },
    {
        id: 'evaluar_criticamente',
        title: '3. Evaluar Críticamente',
        meta: 'Analizar y cuestionar la validez de un texto, detectar sesgos o intenciones del autor.',
        rol: 'Proponer debates simulados y plantear contraargumentos.'
    },
    {
        id: 'integrar_fuentes',
        title: '4. Integrar Fuentes',
        meta: 'Leer varios textos sobre un mismo tema y articular sus ideas.',
        rol: 'Ayudar a comparar textos, identificar contradicciones y construir mapas de ideas.'
    },
    {
        id: 'conectar_contexto',
        title: '5. Conectar Contexto',
        meta: 'Relacionar el contenido textual con conocimientos previos y el entorno.',
        rol: 'Hacer preguntas situadas sobre la vida y cultura del estudiante.'
    },
    {
        id: 'expandir_vocabulario',
        title: '6. Expandir Vocabulario',
        meta: 'Comprender nuevas palabras por contexto y usar estrategias metacognitivas.',
        rol: 'Proponer definiciones por contexto, juegos de palabras y actividades de paráfrasis.'
    },
    {
        id: 'expresar_ideas',
        title: '7. Expresar Ideas',
        meta: 'Producir reflexiones, hipótesis o creaciones propias con base en lo leído.',
        rol: 'Invitar a escribir finales alternativos y proponer desafíos creativos.'
    },
    {
        id: 'disfrutar_lectura',
        title: '8. Disfrutar Lectura',
        meta: 'Desarrollar una relación positiva con la lectura como experiencia estética.',
        rol: 'Sugerir lecturas por interés y conversar sobre emociones.'
    }
];

const AssignmentCard: React.FC<{
    assignment: Assignment,
    userId: string,
    isStudent?: boolean,
    onDelete?: (id: string) => void,
    onReview?: (assignment: Assignment) => void,
    onSolve?: (assignment: Assignment) => void
}> = ({ assignment, userId, isStudent, onDelete, onReview, onSolve }) => {

    const mySubmission = isStudent ? assignment.studentSubmissions?.find(s => s.studentId === userId) : null;
    const isSubmitted = !!mySubmission;

    // Phase 3B: Identificación Transicional de Curso/Club
    const groupContext = useMemo(() => {
        return dataService.groups?.find(g => g.id === assignment.groupId);
    }, [assignment.groupId]);

    return (
        <div className="bg-white dark:bg-gray-800 p-4 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 flex flex-col justify-between h-full hover:shadow-md transition-shadow">
            <div>
                {/* Etiqueta Visual de Curso vs Club para Estudiantes y Mediadores */}
                {groupContext && (
                    <div className="mb-2">
                        <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${groupContext.type === 'club' ? 'bg-pink-50 text-pink-600 border-pink-200 dark:bg-pink-900/30 dark:text-pink-400' : 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400'}`}>
                            {groupContext.type === 'club' ? '🎪 Club' : '🏫 Curso'} • {groupContext.name}
                        </span>
                    </div>
                )}
                
                <h4 className="font-bold text-lg text-indigo-600 dark:text-indigo-400 mb-1 leading-tight">{assignment.contentTitle}</h4>
                <p className="text-sm text-gray-700 dark:text-gray-300 mb-3 line-clamp-2">{assignment.description}</p>
                <div className="flex items-center text-xs text-gray-500 gap-3 mb-4">
                    <span className="flex items-center"><Calendar size={14} className="mr-1" /> Vence: {assignment.dueDate}</span>
                    {!isStudent && (
                        <span className="bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded font-medium">
                            {assignment.studentSubmissions?.length || 0} entregas
                        </span>
                    )}
                </div>
            </div>

            <div className="mt-auto pt-3 border-t border-gray-100 dark:border-gray-700/50">
                {isStudent ? (
                    <div className="flex items-center justify-between">
                        {isSubmitted ? (
                            <span className="text-green-600 font-bold text-sm flex items-center"><ClipboardList size={16} className="mr-1" /> Enviado</span>
                        ) : (
                            <button
                                onClick={() => onSolve && onSolve(assignment)}
                                className="w-full py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center text-sm"
                            >
                                <PenTool size={16} className="mr-2" /> Editar en Bitácora
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="flex justify-between items-center">
                        <button
                            onClick={() => onReview && onReview(assignment)}
                            className="bg-indigo-50 text-indigo-600 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition-colors font-bold text-sm flex items-center shadow-sm"
                        >
                            <Eye size={14} className="mr-1" /> Revisar ({assignment.studentSubmissions?.length || 0})
                        </button>
                        {onDelete && (
                            <button onClick={() => onDelete(assignment.id)} className="text-red-400 hover:text-red-600 p-1.5 ml-2 rounded-full hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors" title="Eliminar tarea">
                                <Trash size={18} />
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

const AulaViva: React.FC = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    // --- Teacher State ---
    const [schools, setSchools] = useState<string[]>([]);
    const [selectedSchool, setSelectedSchool] = useState<string | null>(null);
    const [groups, setGroups] = useState<Group[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
    const [students, setStudents] = useState<User[]>([]);
    // Sprint visibilidad — capa narrativa del grupo seleccionado.
    // Aula Viva nunca queda "vacía sin explicación": este panel siempre dice
    // qué pasa con el grupo (sano, vacío, con advertencias o con incoherencias).
    const [diagnosis,        setDiagnosis]        = useState<GroupDiagnosis | null>(null);
    const [diagnosisLoading, setDiagnosisLoading] = useState(false);
    const [diagnosisError,   setDiagnosisError]   = useState<string | null>(null);
    const [selectedStudent, setSelectedStudent] = useState<User | null>(null);
    // Sprint Panel del estudiante — capa narrativa por lector. Se muestra
    // SIEMPRE que hay un estudiante seleccionado, incluso cuando no hay stats
    // técnicas (un estudiante sin login o sin grupo igual debe ser explicado).
    const [studentStatus,        setStudentStatus]        = useState<StudentStatus | null>(null);
    const [studentStatusLoading, setStudentStatusLoading] = useState(false);
    const [studentStatusError,   setStudentStatusError]   = useState<string | null>(null);
    const [studentStats, setStudentStats] = useState<PedagogicalStats | undefined>(undefined);
    const [aiReport, setAiReport] = useState<string>('');
    const [loadingReport, setLoadingReport] = useState(false);
    const [activeTab, setActiveTab] = useState<'analytics' | 'tasks' | 'producciones'>('analytics');

    // --- Task Mgmt ---
    const [groupAssignments, setGroupAssignments] = useState<Assignment[]>([]);
    const [showAssignmentModal, setShowAssignmentModal] = useState(false);
    const [showReviewModal, setShowReviewModal] = useState(false);
    const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);

    // --- Admin Verification Mode ---
    const [isStudentViewMode, setIsStudentViewMode] = useState(false); // Toggle for Admins

    // --- Grading ---
    const [gradingSubmission, setGradingSubmission] = useState<AssignmentSubmission | null>(null);
    const [gradeValue, setGradeValue] = useState('');
    const [feedbackValue, setFeedbackValue] = useState('');

    const [catalog, setCatalog] = useState<Content[]>([]);
    const [newAssignment, setNewAssignment] = useState({
        contentId: '',
        description: '',
        dueDate: ''
    });

    // --- Student State ---
    const [studentAssignments, setStudentAssignments] = useState<Assignment[]>([]);

    // --- Club Member Management ---
    const [showClubMemberModal, setShowClubMemberModal] = useState(false);
    const [allSchoolUsers, setAllSchoolUsers] = useState<User[]>([]);
    const [memberSearchQuery, setMemberSearchQuery] = useState('');

    // --- Club Content Management ---
    const [showClubContentModal, setShowClubContentModal] = useState(false);
    const [contentSearchQuery, setContentSearchQuery] = useState('');

    // --- Exportación académica ---
    const [downloadingTaskId, setDownloadingTaskId] = useState<string | null>(null);
    const [downloadError, setDownloadError] = useState<string | null>(null);
    const [downloadingStudentId, setDownloadingStudentId] = useState<string | null>(null);
    const [studentDownloadError, setStudentDownloadError] = useState<string | null>(null);

    // --- Club Creation ---
    const [clubModalOpen, setClubModalOpen] = useState(false);
    const [editingClub, setEditingClub] = useState<Group | null>(null);
    const [clubCreatedFeedback, setClubCreatedFeedback] = useState<string | null>(null);

    // --- C3 Mediation Actions ---
    const [c3Modal, setC3Modal] = useState<'message' | 'focus' | 'suggest' | 'intervene' | null>(null);
    const [c3Input, setC3Input] = useState('');
    const [c3FocusField, setC3FocusField] = useState<'weeklyFocus' | 'readingNow'>('weeklyFocus');
    const [c3IntervenStudent, setC3IntervenStudent] = useState<User | null>(null);
    const [c3SuggestionText, setC3SuggestionText] = useState('');
    const [c3Saving, setC3Saving] = useState(false);
    const [c3SavedFeedback, setC3SavedFeedback] = useState<string | null>(null);
    const [c3Filter, setC3Filter] = useState<'all' | 'rezago' | 'progreso' | 'avanzado'>('all');

    // --- Bundle Management (Fase 7) ---
    const [showBundleModal, setShowBundleModal] = useState(false);
    const [bundles, setBundles] = useState<Bundle[]>([]);
    const [applyingBundleId, setApplyingBundleId] = useState<string | null>(null);
    const [activatedBundle, setActivatedBundle] = useState<Bundle | null>(null);
    const [replacedBundleName, setReplacedBundleName] = useState<string | null>(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    // canManageClassroom: true si el usuario tiene capacidades de gestión del aula
    // (mediador, profesor legado, o administrador) y NO está en modo vista-estudiante.
    // Reemplaza el naming heredado 'isTeacher' que reflejaba el rol 'profesor' (legacy).
    const canManageClassroom = (isMediator(user) || checkIsAdmin(user)) && !isStudentViewMode;
    const isAdmin = checkIsAdmin(user);

    // Sprint 022 Fase 2A.2 — mount-only refetch de users.
    //
    // Resuelve Caso CRÍTICO 1: un mediador que fue asignado a un grupo
    // desde otra pestaña/admin tiene `user.groupIds` stale en su cache
    // local (porque el backend NO actualiza user.groupIds cuando solo
    // cambia mediatorIds del grupo, y porque cualquier cambio cross-tab
    // tampoco se propaga). Al entrar al panel Aula Viva refrescamos una
    // vez `this.users` desde server truth.
    //
    // Disparo: una sola vez por mount + cada vez que cambia user.id
    // (login/logout). NO en cambio de selectedGroup, NO en cambio de
    // selectedSchool, NO en cada render. Las deps son intencionalmente
    // mínimas; los demás useEffect del panel se encargan del refresco
    // por interacción.
    useEffect(() => {
        if (!user?.id) return;
        let cancelled = false;
        void (async () => {
            try {
                await dataService.reloadUsers();
                if (!cancelled) console.log('[AULA_VIVA_CACHE_INVALIDATION] reason=mount');
            } catch (e) {
                if (!cancelled) console.warn('[AULA_VIVA_CACHE_INVALIDATION] failed', (e as Error).message);
            }
        })();
        return () => { cancelled = true; };
    }, [user?.id]);

    useEffect(() => {
        if (!user) return;

        // Logic for Managers OR Admins in Student Mode (to allow context switching)
        const shouldLoadAdminContext = isAdmin;
        const shouldLoadManagementContext = canManageClassroom;

        if (shouldLoadManagementContext || shouldLoadAdminContext) {
            // LOAD CATALOG (Always needed for context)
            setCatalog(dataService.getContenidos(user.roles, user.id).filter(c => c.tipo === 'libro' || c.tipo === 'guia'));

            if (isAdmin) {
                // Admin sees all schools or their own school context
                const allSchools = dataService.getColegios();
                setSchools(allSchools);
                
                // Keep existing selection or default
                if (!selectedSchool && user.colegio) setSelectedSchool(user.colegio);
                if (!selectedSchool && allSchools.length > 0) setSelectedSchool(allSchools[0]);

                const currentSchool = selectedSchool || user.colegio || allSchools[0];

                if (currentSchool) {
                    const schoolGroups = dataService.getGroupsByColegio(currentSchool);
                    setGroups(schoolGroups);
                    
                    // Default group if none selected
                    if (schoolGroups.length > 0) {
                        if (!selectedGroup || !schoolGroups.find(g => g.id === selectedGroup)) {
                            setSelectedGroup(schoolGroups[0].id);
                        }
                    } else {
                        // Keep selected if it's valid, else null
                        if (selectedGroup && !schoolGroups.find(g => g.id === selectedGroup)) {
                            setSelectedGroup(null);
                        }
                    }
                }
            } else if (canManageClassroom) {
                // Regular Teacher
                const teachersGroups = dataService.getTeacherGroups(user.id);
                setGroups(teachersGroups);
                if (teachersGroups.length > 0 && !selectedGroup) {
                    setSelectedGroup(teachersGroups[0].id);
                }
            }
        }

        // Student View Assignments Fetching
        if (!canManageClassroom) { // This means we are in Student View (real student or Admin toggled)
            if (isAdmin && selectedGroup) {
                // Admin viewing specific group as student
                setStudentAssignments(dataService.getAssignmentsByGroup(selectedGroup));
            } else {
                // memberIds es fuente canónica; user.groupIds como fallback compat
                const userGroups = dataService.getUserGroups(user.id);
                const allAssignments = userGroups.flatMap(g => dataService.getAssignmentsByGroup(g.id));
                setStudentAssignments(allAssignments);
            }
        }
    }, [user, canManageClassroom, isAdmin, selectedSchool, selectedGroup]); // Added selectedGroup dependency to refresh student view content

    useEffect(() => {
        if (selectedGroup && canManageClassroom) {
            const groupStudents = dataService.getGroupStudents(selectedGroup);
            setStudents(groupStudents);
            setGroupAssignments(dataService.getAssignmentsByGroup(selectedGroup));
            setSelectedStudent(null);
            setCurrentPage(1);
        }
    }, [selectedGroup, canManageClassroom]);

    // Sprint visibilidad — fetch del diagnóstico narrativo del grupo.
    // Se vuelve a pedir tras asignar/remover estudiantes vía refetchDiagnosis().
    const refetchDiagnosis = React.useCallback(async (groupId: string | null) => {
        if (!groupId) { setDiagnosis(null); setDiagnosisError(null); return; }
        setDiagnosisLoading(true);
        setDiagnosisError(null);
        try {
            const d = await dataService.getGroupDiagnosis(groupId);
            setDiagnosis(d);
        } catch (e: any) {
            setDiagnosis(null);
            setDiagnosisError(e?.message || 'Error inesperado al obtener el diagnóstico.');
        } finally {
            setDiagnosisLoading(false);
        }
    }, []);

    useEffect(() => {
        if (selectedGroup && canManageClassroom) refetchDiagnosis(selectedGroup);
        else { setDiagnosis(null); setDiagnosisError(null); }
    }, [selectedGroup, canManageClassroom, refetchDiagnosis]);

    // --- Stats & Reports ---
    useEffect(() => {
        if (selectedStudent) {
            const stats = dataService.getPedagogicalStats(selectedStudent.id);
            setStudentStats(stats);
            setAiReport('');
        }
    }, [selectedStudent]);

    // Sprint Panel del estudiante — fetch del status narrativo cada vez que
    // cambia la selección. Si la selección se limpia, también limpiamos el
    // panel (sin stale data del estudiante anterior).
    useEffect(() => {
        if (!selectedStudent) {
            setStudentStatus(null);
            setStudentStatusError(null);
            setStudentStatusLoading(false);
            return;
        }
        let cancelled = false;
        setStudentStatusLoading(true);
        setStudentStatusError(null);
        dataService.getStudentStatus(selectedStudent.id)
            .then(s  => { if (!cancelled) setStudentStatus(s); })
            .catch(e => { if (!cancelled) {
                setStudentStatus(null);
                setStudentStatusError(e?.message || 'Error inesperado al obtener el estado del estudiante.');
            }})
            .finally(() => { if (!cancelled) setStudentStatusLoading(false); });
        return () => { cancelled = true; };
    }, [selectedStudent]);

    // Señales pedagógicas básicas derivadas de datos reales del estudiante seleccionado.
    // Se recalculan cuando cambia el estudiante o las tareas del grupo.
    const learningSignals: StudentLearningSignals | null = useMemo(() => {
        if (!selectedStudent || groupAssignments.length === 0) return null;
        return dataService.analyzeStudentLearningSignals(selectedStudent.id, groupAssignments);
    }, [selectedStudent, groupAssignments]);

    const recommendations: StudentRecommendationBundle | null = useMemo(() => {
        if (!learningSignals || learningSignals.totalSubmitted === 0) return null;
        return dataService.buildStudentPedagogicalRecommendations(learningSignals);
    }, [learningSignals]);

    // Síntesis de Leo para el docente — determinista, sin LLM, trazable.
    // Se genera solo cuando hay señales Y recomendaciones disponibles.
    const leoAdvisor: LeoTeacherAdvisorSummary | null = useMemo(() => {
        if (!learningSignals || !recommendations) return null;
        return dataService.buildLeoTeacherAdvisorSummary(learningSignals, recommendations);
    }, [learningSignals, recommendations]);

    // --- Teacher Actions ---
    const generateReport = async () => {
        if (!studentStats) return;
        setLoadingReport(true);
        const report = await analizarProgresoPedagogico(studentStats);
        setAiReport(report);
        setLoadingReport(false);
    };

    const handleDeleteAssignment = (id: string) => {
        if (window.confirm('¿Estás seguro de eliminar esta tarea?')) {
            dataService.deleteAssignment(id);
            if (selectedGroup) setGroupAssignments(dataService.getAssignmentsByGroup(selectedGroup));
        }
    };

    // Note: handleCreateAssignment is now handled inline in the modal, but keeping reference if needed or cleaning up
    // We will leave the original function undefined if it's not used, or re-define it if passing by reference.
    // Since the modal uses an inline submit handler now, we don't strictly need it, but let's keep other handlers.

    const handleOpenReview = (assignment: Assignment) => {
        setSelectedAssignment(assignment);
        setShowReviewModal(true);
        setGradingSubmission(null);
        setDownloadError(null);
    };

    const handleDownloadStudentSubmissions = async (studentId: string) => {
        if (!user) return;
        setDownloadingStudentId(studentId);
        setStudentDownloadError(null);
        try {
            const res = await fetch(`/api/students/${studentId}/export-submissions`, {
                headers: {},
            });
            if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const disposition = res.headers.get('Content-Disposition');
            const match = disposition?.match(/filename="([^"]+)"/);
            a.download = match?.[1] ?? `tareas_${studentId}.zip`;
            a.href = url;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err: any) {
            setStudentDownloadError('No se pudo descargar. Intenta de nuevo.');
        } finally {
            setDownloadingStudentId(null);
        }
    };

    const handleDownloadSubmissions = async (taskId: string) => {
        if (!user) return;
        setDownloadingTaskId(taskId);
        setDownloadError(null);
        try {
            const res = await fetch(`/api/tasks/${taskId}/export-submissions`, {
                headers: {},
            });
            if (!res.ok) throw new Error(`Error del servidor (${res.status})`);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            const disposition = res.headers.get('Content-Disposition');
            const match = disposition?.match(/filename="([^"]+)"/);
            a.download = match?.[1] ?? `tareas_${taskId}.zip`;
            a.href = url;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        } catch (err: any) {
            setDownloadError('No se pudo descargar. Intenta de nuevo.');
        } finally {
            setDownloadingTaskId(null);
        }
    };

    const handleSelectSubmission = (sub: AssignmentSubmission) => {
        setGradingSubmission(sub);
        setGradeValue(sub.grade ? sub.grade.toString() : '');
        setFeedbackValue(sub.teacherFeedback || '');
    };

    const handleSubmitGrade = () => {
        if (selectedAssignment && gradingSubmission) {
            dataService.gradeSubmission(selectedAssignment.id, gradingSubmission.studentId, parseFloat(gradeValue), feedbackValue);
            const updatedAssigns = dataService.getAssignmentsByGroup(selectedGroup!);
            setGroupAssignments(updatedAssigns);
            const updatedSel = updatedAssigns.find(a => a.id === selectedAssignment.id);
            if (updatedSel) setSelectedAssignment(updatedSel);
            setGradingSubmission(null);
            alert('Calificación guardada');
        }
    }

    // --- Club Member Management Handlers ---
    const handleOpenMemberModal = () => {
        const school = currentGroup?.school || currentGroup?.colegio || user?.colegio || '';
        const schoolUsers = school ? dataService.getUsuariosByColegio(school) : [];
        setAllSchoolUsers(schoolUsers);
        setMemberSearchQuery('');
        setShowClubMemberModal(true);
    };

    const handleAddClubMember = (studentId: string) => {
        if (!selectedGroup) return;
        dataService.addStudentsToGroup(selectedGroup, [studentId]);
        setStudents(dataService.getGroupStudents(selectedGroup));
        // Sprint visibilidad — la membresía cambió; el panel debe reflejarlo.
        refetchDiagnosis(selectedGroup);
    };

    const handleRemoveClubMember = (studentId: string) => {
        if (!selectedGroup) return;
        dataService.removeStudentFromGroup(selectedGroup, studentId);
        setStudents(dataService.getGroupStudents(selectedGroup));
        // Sprint visibilidad — la membresía cambió; el panel debe reflejarlo.
        refetchDiagnosis(selectedGroup);
    };

    // --- Club Content Management Handlers ---
    const handleOpenContentModal = () => {
        setContentSearchQuery('');
        setShowClubContentModal(true);
    };

    const handleAddClubContent = async (contentId: string) => {
        if (!selectedGroup) return;
        await dataService.addContentToClub(selectedGroup, contentId);
        if (isAdmin) {
            setGroups(dataService.getGroupsByColegio(selectedSchool || user?.colegio || ''));
        } else {
            setGroups(dataService.getTeacherGroups(user!.id));
        }
    };

    const handleRemoveClubContent = async (contentId: string) => {
        if (!selectedGroup) return;
        await dataService.removeContentFromClub(selectedGroup, contentId);
        if (isAdmin) {
            setGroups(dataService.getGroupsByColegio(selectedSchool || user?.colegio || ''));
        } else {
            setGroups(dataService.getTeacherGroups(user!.id));
        }
    };

    // --- Bundle Handlers (Fase 7) ---
    const handleOpenBundleModal = () => {
        setBundles(dataService.getBundles());
        setShowBundleModal(true);
    };

    const handleApplyBundle = async (bundleId: string) => {
        if (!selectedGroup) return;
        setApplyingBundleId(bundleId);
        const prevName = currentGroup?.activeExperienceId
            ? (bundles.find(b => b.id === currentGroup.activeExperienceId)?.name ?? null)
            : null;
        try {
            await dataService.applyBundleToGroup(selectedGroup, bundleId);
            const applied = bundles.find(b => b.id === bundleId) || null;
            if (isAdmin) {
                setGroups(dataService.getGroupsByColegio(selectedSchool || user?.colegio || ''));
            } else {
                setGroups(dataService.getTeacherGroups(user!.id));
            }
            setShowBundleModal(false);
            setActivatedBundle(applied);
            setReplacedBundleName(prevName && prevName !== applied?.name ? prevName : null);
            setTimeout(() => { setActivatedBundle(null); setReplacedBundleName(null); }, 7000);
        } finally {
            setApplyingBundleId(null);
        }
    };

    const handleDeactivateExperience = async () => {
        if (!selectedGroup) return;
        try {
            await dataService.clearGroupExperience(selectedGroup);
            if (isAdmin) {
                setGroups(dataService.getGroupsByColegio(selectedSchool || user?.colegio || ''));
            } else {
                setGroups(dataService.getTeacherGroups(user!.id));
            }
        } catch {
            // silent — no bloquear flujo por esto
        }
    };

    // --- C3 Mediation Action Handlers ---
    const refreshGroups = () => {
        const newGroups = isAdmin
            ? dataService.getGroupsByColegio(selectedSchool || user?.colegio || '')
            : dataService.getTeacherGroups(user!.id);
        setGroups(newGroups);
    };

    const showC3Feedback = (msg: string) => {
        setC3SavedFeedback(msg);
        setTimeout(() => setC3SavedFeedback(null), 3000);
    };

    const handleC3SaveMessage = async () => {
        if (!selectedGroup || !c3Input.trim()) return;
        setC3Saving(true);
        await dataService.updateGroup(selectedGroup, { mediationMessage: c3Input.trim() } as any);
        refreshGroups();
        setC3Modal(null);
        setC3Input('');
        setC3Saving(false);
        showC3Feedback('Mensaje guardado');
    };

    const handleC3SaveFocus = async () => {
        if (!selectedGroup || !c3Input.trim()) return;
        setC3Saving(true);
        await dataService.updateGroup(selectedGroup, { [c3FocusField]: c3Input.trim() } as any);
        refreshGroups();
        setC3Modal(null);
        setC3Input('');
        setC3Saving(false);
        showC3Feedback(c3FocusField === 'weeklyFocus' ? 'Foco semanal actualizado' : 'Lectura activa actualizada');
    };

    const handleC3OpenSuggest = () => {
        if (!currentGroup) return;
        const cg = currentGroup as typeof currentGroup & { mediationMessage?: string; weeklyFocus?: string; readingNow?: string };
        const allProgress = students.map(s => {
            const progs = clubContentItems.map(item => dataService.getProgresoUsuarioLibro(s.id, item.id)?.porcentaje ?? 0);
            const avg = progs.length > 0 ? Math.round(progs.reduce((a, b) => a + b, 0) / progs.length) : 0;
            return { student: s, avg };
        });
        const groupAvg = students.length > 0
            ? Math.round(allProgress.reduce((sum, p) => sum + p.avg, 0) / students.length)
            : 0;
        const behindStudents = allProgress.filter(p => p.avg < 20).map(p => p.student.nombre_completo);
        const aheadStudents  = allProgress.filter(p => p.avg >= 80).map(p => p.student.nombre_completo);

        let suggestion = `Progreso promedio del club: ${groupAvg}%.\n\n`;
        if (behindStudents.length > 0) {
            suggestion += `⚠️ ${behindStudents.length} miembro${behindStudents.length > 1 ? 's' : ''} con avance menor al 20%: ${behindStudents.join(', ')}.\n→ Recomendación: sesión de acompañamiento individualizado o lectura compartida en voz alta.\n\n`;
        }
        if (aheadStudents.length > 0) {
            suggestion += `✅ ${aheadStudents.length} miembro${aheadStudents.length > 1 ? 's han' : ' ha'} completado más del 80%: ${aheadStudents.join(', ')}.\n→ Considera asignarles el rol de comentaristas o proponerles una reflexión escrita.\n\n`;
        }
        if (groupAvg >= 70) {
            suggestion += `El grupo está en recta final. Momento ideal para una sesión de cierre: debate, reseña o presentación oral.`;
        } else if (groupAvg >= 40) {
            suggestion += `El grupo está a mitad de camino. Refuerza comprensión con preguntas inferenciales sobre${cg.readingNow ? ` "${cg.readingNow}"` : ' la lectura activa'}.`;
        } else {
            suggestion += `El grupo está en etapa inicial. Prioriza motivación: comparte el contexto del autor${cg.weeklyFocus ? ` y recuerda el foco: "${cg.weeklyFocus}"` : ''}.`;
        }
        setC3SuggestionText(suggestion.trim());
        setC3Modal('suggest');
    };

    const handleC3OpenIntervene = (student: User) => {
        setC3IntervenStudent(student);
        setC3Input('');
        setC3Modal('intervene');
    };

    // --- Student Actions ---
    const handleSolveInBitacora = (assignment: Assignment) => {
        if (!user) return;
        dataService.createDraftFromAssignment(user.id, assignment.id);
        navigate('/bitacora');
    };

    // --- Scroll to Detail on Mobile ---
    const detailPanelRef = React.useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (selectedStudent && window.innerWidth < 1024 && detailPanelRef.current) {
            detailPanelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
    }, [selectedStudent]);

    // --- ESC closes C3 modal ---
    useEffect(() => {
        if (!c3Modal) return;
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') { setC3Modal(null); setC3Input(''); setC3IntervenStudent(null); } };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [c3Modal]);

    // --- Reset grid filter when group changes ---
    useEffect(() => { setC3Filter('all'); }, [selectedGroup]);

    // --- Visuals ---

    const groupAverages = useMemo(() => {
        if (students.length === 0) return {
            time: 0,
            books: 0,
            botInteractions: 0,
            taskRate: 0,
            bgCompLiteral: 0,
            bgCompInferencial: 0,
            bgCompCritica: 0
        };

        // Accumulators
        let acc = {
            totalTime: 0,
            totalBooks: 0,
            totalBot: 0,
            totalTaskRate: 0,
            compL: 0,
            compI: 0,
            compC: 0
        };

        students.forEach(s => {
            const st = dataService.getPedagogicalStats(s.id);
            if (st) {
                acc.totalTime += st.totalReadingTimeMinutes;
                acc.totalBooks += st.booksCompleted;
                acc.totalBot += st.chatbotInteractions || 0;
                acc.totalTaskRate += st.taskCompletionRate || 0;
                acc.compL += st.comprension_literal;
                acc.compI += st.comprension_inferencial;
                acc.compC += st.reflexion_critica;
            }
        });

        const n = students.length;
        return {
            time: Math.round(acc.totalTime / n),
            books: (acc.totalBooks / n).toFixed(1),
            botInteractions: Math.round(acc.totalBot / n),
            taskRate: Math.round(acc.totalTaskRate / n),
            bgCompLiteral: Math.round(acc.compL / n),
            bgCompInferencial: Math.round(acc.compI / n),
            bgCompCritica: Math.round(acc.compC / n)
        };
    }, [students]);

    const groupDistribution = useMemo(() => selectedGroup ? dataService.getGroupDistribution(selectedGroup) : { low: 0, mid: 0, high: 0 }, [selectedGroup, students]);
    const groupTrend = useMemo(() => selectedGroup ? dataService.getGroupEvolution(selectedGroup) : [], [selectedGroup, students]);

    const paginatedStudents = useMemo(() => {
        const start = (currentPage - 1) * itemsPerPage;
        return students.slice(start, start + itemsPerPage);
    }, [students, currentPage]);

    // --- Phase 3B: Extracción dinámica de contexto Grupo/Mediadores ---
    const currentGroup = useMemo(() => groups.find(g => g.id === selectedGroup), [groups, selectedGroup]);
    const currentMediatorsInfo = useMemo(() => {
        if (!currentGroup) return '';
        const medIds = dataService.getGroupMediatorIds(currentGroup);
        const names = medIds.map(id => {
            const u = dataService.getUsuarioById(id);
            return u ? u.nombre_completo : 'Desconocido';
        });
        return names.join(', ');
    }, [currentGroup]);

    const clubContentIds = useMemo(() => {
        if (!currentGroup || currentGroup.type !== 'club') return [] as string[];
        const ids = currentGroup.availableContentIds;
        if (!ids || ids === 'all') return [] as string[];
        return ids as string[];
    }, [currentGroup]);

    const clubContentItems = useMemo(() =>
        catalog.filter(c => clubContentIds.includes(c.id)),
        [catalog, clubContentIds]
    );

    const activeBundle = useMemo(() => {
        if (!currentGroup?.activeExperienceId) return null;
        return dataService.getBundles().find(b => b.id === currentGroup.activeExperienceId) || null;
    }, [currentGroup]);

    if (!user) return null;

    // --- STUDENT VIEW RENDER ---
    if (!canManageClassroom) {
        return (
            <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
                <header className="flex flex-col md:flex-row justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center text-indigo-700 dark:text-indigo-400">
                            <Users className="mr-3" size={32} /> Aula Viva
                        </h1>
                        <p className="text-gray-500 dark:text-gray-400">Mis Tareas y Actividades</p>
                    </div>

                    {/* Admin Controls in Student View */}
                    {isAdmin && (
                        <div className="mt-4 md:mt-0 flex gap-3 items-center">
                            <button
                                onClick={() => setIsStudentViewMode(false)}
                                className="flex items-center px-3 py-2 rounded-lg text-sm font-bold bg-indigo-100 border border-indigo-500 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 hover:bg-indigo-200"
                            >
                                <EyeOff size={16} className="mr-2" /> Salir de Vista Alumno
                            </button>

                            {schools.length > 0 && (
                                <div className="flex bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-300 dark:border-gray-600 focus-within:ring-2 focus-within:ring-indigo-500 overflow-hidden">
                                    <span className="bg-gray-100 dark:bg-gray-700 px-3 py-2 text-xs font-bold text-gray-500 border-r border-gray-200 dark:border-gray-600 flex items-center">
                                        Institución
                                    </span>
                                    <select
                                        className="p-2 text-sm bg-transparent font-semibold min-w-[120px] outline-none"
                                        value={selectedSchool || ''}
                                    onChange={(e) => setSelectedSchool(e.target.value)}
                                >
                                    {schools.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                </div>
                            )}

                            <select
                                className="p-2 text-sm rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm font-semibold min-w-[150px]"
                                value={selectedGroup || ''}
                                onChange={(e) => setSelectedGroup(e.target.value)}
                            >
                                {groups.length === 0 && <option value="">Sin grupos</option>}
                                <option value="">-- Agrupación --</option>
                                {groups.map(g => <option key={g.id} value={g.id}>{g.type === 'club' ? '🎪 ' : '🏫 '}{g.name}</option>)}
                            </select>
                        </div>
                    )}
                </header>

                {/* Mis Grupos — contexto de pertenencia para el estudiante */}
                {(() => {
                    const myGroups = dataService.getUserGroups(user.id);
                    if (myGroups.length === 0) return null;
                    const courses = myGroups.filter(g => g.type !== 'club');
                    const clubs = myGroups.filter(g => g.type === 'club');
                    return (
                        <div className="mb-8 animate-in fade-in">
                            <p className="text-xs font-bold uppercase text-gray-400 mb-3 tracking-wider">Mis grupos</p>
                            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                                {courses.map(g => {
                                    const exp = g.activeExperienceId ? dataService.getBundles().find(b => b.id === g.activeExperienceId) : null;
                                    return (
                                        <div key={g.id} className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl px-4 py-3 flex items-center gap-3">
                                            <span className="text-2xl">🏫</span>
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-bold uppercase text-blue-500 tracking-wider">Curso</p>
                                                <p className="font-semibold text-sm text-blue-800 dark:text-blue-200 truncate">{g.name}</p>
                                                {exp && (
                                                    <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-0.5 flex items-center gap-1">
                                                        <Sparkles size={10} /> {exp.name}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                                {clubs.map(g => {
                                    const clubContent = dataService.getClubContent(g);
                                    const exp = g.activeExperienceId ? dataService.getBundles().find(b => b.id === g.activeExperienceId) : null;
                                    return (
                                        <div key={g.id} className="bg-pink-50 dark:bg-pink-900/20 border border-pink-100 dark:border-pink-800 rounded-xl px-4 py-3 flex items-center gap-3">
                                            <span className="text-2xl">🎪</span>
                                            <div className="min-w-0">
                                                <p className="text-[10px] font-bold uppercase text-pink-500 tracking-wider">Club de lectura</p>
                                                <p className="font-semibold text-sm text-pink-800 dark:text-pink-200 truncate">{g.name}</p>
                                                {exp ? (
                                                    <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-0.5 flex items-center gap-1">
                                                        <Sparkles size={10} /> {exp.name}
                                                    </p>
                                                ) : clubContent.length > 0 ? (
                                                    <p className="text-xs text-pink-400 mt-0.5">{clubContent.length} {clubContent.length === 1 ? 'libro disponible' : 'libros disponibles'}</p>
                                                ) : null}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })()}

                <div className="animate-in fade-in">
                    <h2 className="text-2xl font-bold mb-6 flex items-center"><ClipboardList className="mr-2" /> Tareas Pendientes</h2>

                    {studentAssignments.length === 0 ? (
                        <div className="bg-white dark:bg-gray-800 rounded-xl p-8 text-center text-gray-400 border border-dashed border-gray-300 dark:border-gray-700">
                            <ClipboardList size={48} className="mx-auto mb-4 opacity-50" />
                            <p>¡Todo al día! No tienes tareas pendientes por ahora.</p>
                        </div>
                    ) : (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {studentAssignments.map(assignment => (
                                <AssignmentCard
                                    key={assignment.id}
                                    assignment={assignment}
                                    userId={user.id}
                                    isStudent={true}
                                    onSolve={handleSolveInBitacora}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // --- TEACHER VIEW RENDER ---
        // ...
        return (
            <div className="p-4 md:p-8 min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-800 dark:text-gray-200">
                <header className="flex flex-col md:flex-row justify-between items-center mb-8">
                    <div>
                        <h1 className="text-3xl font-bold flex items-center text-indigo-700 dark:text-indigo-400">
                            <Users className="mr-3" size={32} /> Aula Viva {currentGroup && <span className="ml-3 text-xl font-bold text-gray-400 border-l border-gray-300 dark:border-gray-700 pl-3"> {currentGroup.type === 'club' ? '🎪 Club' : '🏫 Curso'}</span>}
                        </h1>
                        <p className="text-gray-500 dark:text-gray-400 mt-1">Dashboard de Analítica y Gestión Pedagógica</p>
                        {currentGroup && currentMediatorsInfo && (
                            <p className="text-xs text-indigo-600 dark:text-indigo-400 font-bold mt-2 bg-indigo-50 dark:bg-indigo-900/40 inline-flex items-center px-3 py-1 rounded-full border border-indigo-100 dark:border-indigo-800">
                                <span className="mr-2">🎙️</span> Mediador(es): <span className="opacity-80 ml-1"> {currentMediatorsInfo}</span>
                            </p>
                        )}
                    </div>
                    <div className="mt-4 md:mt-0 flex flex-col md:flex-row gap-4 items-end md:items-center">
                        {isAdmin && (
                            <button
                                onClick={() => setIsStudentViewMode(!isStudentViewMode)}
                                className={`flex items-center px-3 py-2 rounded-lg text-sm font-bold border transition-colors ${isStudentViewMode 
                                    ? 'bg-indigo-100 border-indigo-500 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300' 
                                    : 'bg-white border-gray-300 text-gray-600 dark:bg-gray-800 dark:text-gray-300 hover:bg-gray-50'}`}
                            >
                                {isStudentViewMode ? <Eye size={16} className="mr-2" /> : <Users size={16} className="mr-2" />}
                                {isStudentViewMode ? 'Salir de Vista Alumno' : 'Vista Alumno (Admin)'}
                            </button>
                        )}
                        
                        {/* School Selector (Admin Only) */}
                        {isAdmin && schools.length > 0 && (
                            <div className="flex bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-300 dark:border-gray-600 focus-within:ring-2 focus-within:ring-indigo-500 overflow-hidden">
                                <span className="bg-gray-100 dark:bg-gray-700 px-3 py-2 text-xs font-bold text-gray-500 border-r border-gray-200 dark:border-gray-600 flex items-center">
                                    Inst.
                                </span>
                                <select
                                    className="p-3 bg-transparent font-semibold outline-none"
                                    value={selectedSchool || ''}
                                onChange={(e) => setSelectedSchool(e.target.value)}
                            >
                                {schools.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            </div>
                        )}

                        {/* Group Selector */}
                        <select
                            className="p-3 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-sm min-w-[200px]"
                            value={selectedGroup || ''}
                            onChange={(e) => setSelectedGroup(e.target.value)}
                        >
                            {groups.length === 0 && <option value="">Sin grupos asignados</option>}
                            {groups.map(g => <option key={g.id} value={g.id}>{g.type === 'club' ? '🎪 ' : '🏫 '}{g.name}</option>)}
                        </select>

                        <button
                            onClick={() => { setEditingClub(null); setClubModalOpen(true); }}
                            className="flex items-center gap-2 px-4 py-3 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-lg text-sm transition-colors shadow-sm whitespace-nowrap"
                        >
                            <Plus size={16} />
                            Nuevo club
                        </button>
                    </div>
                </header>

                {/* Club creation success feedback */}
                {clubCreatedFeedback && (
                    <div className="mb-4 flex items-center gap-3 px-4 py-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl text-sm text-green-700 dark:text-green-400 animate-in fade-in slide-in-from-top-2">
                        <CheckCircle size={16} className="flex-shrink-0" />
                        <span>Club <strong>{clubCreatedFeedback}</strong> creado. Ya está disponible en el selector.</span>
                    </div>
                )}

                {/* --- Fase 6D: Banner de Vigencia Temporal del Grupo Activo --- */}
                {currentGroup?.type === 'club' && (currentGroup.accessStartsAt || currentGroup.accessEndsAt) && (() => {
                    const now = Date.now();
                    const endsAt = currentGroup.accessEndsAt ? new Date(currentGroup.accessEndsAt).getTime() : null;
                    const startsAt = currentGroup.accessStartsAt ? new Date(currentGroup.accessStartsAt).getTime() : null;
                    const isExpired = endsAt !== null && now > endsAt;
                    const isUpcoming = startsAt !== null && now < startsAt;

                    if (isExpired) return (
                        <div className="mb-6 px-4 py-3 rounded-xl border border-red-200 bg-red-50 dark:bg-red-900/20 dark:border-red-800 flex items-start gap-3">
                            <span className="text-red-500 text-xl">⏱</span>
                            <div>
                                <p className="font-bold text-red-700 dark:text-red-400 text-sm">Acceso del Club Expirado</p>
                                <p className="text-xs text-red-600 dark:text-red-500">
                                    La vigencia de <strong>{currentGroup.name}</strong> finalizó el {new Date(endsAt!).toLocaleDateString('es', { dateStyle: 'long' })}.
                                    El grupo, sus miembros y actividades se conservan intactos.
                                </p>
                            </div>
                        </div>
                    );
                    if (isUpcoming) return (
                        <div className="mb-6 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 flex items-start gap-3">
                            <span className="text-amber-500 text-xl">🕐</span>
                            <div>
                                <p className="font-bold text-amber-700 dark:text-amber-400 text-sm">Club Programado — Aún no Activo</p>
                                <p className="text-xs text-amber-600 dark:text-amber-500">
                                    El acceso de <strong>{currentGroup.name}</strong> se activará a partir del {new Date(startsAt!).toLocaleDateString('es', { dateStyle: 'long' })}.
                                </p>
                            </div>
                        </div>
                    );
                    return (
                        <div className="mb-6 px-4 py-3 rounded-xl border border-green-200 bg-green-50 dark:bg-green-900/20 dark:border-green-800 flex items-start gap-3">
                            <span className="text-green-500 text-xl">✅</span>
                            <div>
                                <p className="font-bold text-green-700 dark:text-green-400 text-sm">Club Temporal Activo</p>
                                <p className="text-xs text-green-600 dark:text-green-500">
                                    Acceso vigente para <strong>{currentGroup.name}</strong>
                                    {endsAt && `. Expira el ${new Date(endsAt).toLocaleDateString('es', { dateStyle: 'long' })}.`}
                                </p>
                            </div>
                        </div>
                    );
                })()}

            {/* Experiencia recién activada — confirmación temporal (Fase 8) */}
            {activatedBundle && (
                <div className="mb-5 px-4 py-4 rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-900/20 dark:border-amber-800 animate-in slide-in-from-top-2">
                    <div className="flex items-start gap-3">
                        <Sparkles className="text-amber-500 flex-shrink-0 mt-0.5" size={18} />
                        <div className="flex-1 min-w-0">
                            <p className="font-bold text-amber-700 dark:text-amber-400 text-sm">
                                ¡Experiencia activada! — {activatedBundle.name}
                            </p>
                            {replacedBundleName && (
                                <p className="text-xs text-amber-500 dark:text-amber-500 mt-0.5">Reemplazó a: {replacedBundleName}</p>
                            )}
                            {activatedBundle.shortDescription && (
                                <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">{activatedBundle.shortDescription}</p>
                            )}
                            {activatedBundle.includes && activatedBundle.includes.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                    {activatedBundle.includes.map(inc => (
                                        <span key={inc} className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-700 rounded dark:bg-amber-900/40 dark:text-amber-300">{inc}</span>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button onClick={() => setActivatedBundle(null)} className="text-amber-400 hover:text-amber-600 flex-shrink-0"><X size={16} /></button>
                    </div>
                </div>
            )}

            {/* Experiencia activa persistente (Fase 8) */}
            {activeBundle && !activatedBundle && (
                <div className="mb-5 px-4 py-3 rounded-xl border border-indigo-200 bg-indigo-50 dark:bg-indigo-900/20 dark:border-indigo-800 flex items-start gap-3">
                    <Sparkles className="text-indigo-400 flex-shrink-0 mt-0.5" size={15} />
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase text-indigo-500 tracking-wider mb-0.5">Experiencia activa</p>
                        <p className="font-bold text-indigo-700 dark:text-indigo-300 text-sm">{activeBundle.name}</p>
                        {activeBundle.shortDescription && (
                            <p className="text-xs text-indigo-500 dark:text-indigo-400 mt-0.5">{activeBundle.shortDescription}</p>
                        )}
                        {activeBundle.includes && activeBundle.includes.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                                {activeBundle.includes.map(inc => (
                                    <span key={inc} className="px-1.5 py-0.5 text-[10px] bg-indigo-100 text-indigo-600 rounded dark:bg-indigo-900/40 dark:text-indigo-300">{inc}</span>
                                ))}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={handleDeactivateExperience}
                        title="Quitar experiencia activa"
                        className="text-indigo-300 hover:text-indigo-600 dark:hover:text-indigo-300 flex-shrink-0 p-1 rounded hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Course Analytics Entry — paridad con el botón "Ver analítica completa" del C3 club panel.
                Sin esto los grupos tipo 'course' quedan sin punto de navegación a DashboardMediador,
                y /api/metrics/course/* nunca se invoca. */}
            {currentGroup && currentGroup.type !== 'club' && (
                <div className="mb-8 flex items-center justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                        <BookMarked size={15} /> Analítica del curso
                    </h3>
                    <button
                        type="button"
                        onClick={() => navigate(`/dashboard/curso/${currentGroup.id}`)}
                        aria-label={`Ver analítica completa del curso ${currentGroup.name}`}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-800/50 border border-indigo-200 dark:border-indigo-700 rounded-lg transition-colors"
                    >
                        <BarChart2 size={13} aria-hidden="true" /> Ver analítica completa <ExternalLink size={11} aria-hidden="true" />
                    </button>
                </div>
            )}

            {/* C3 — Club Session Panel (only when a club is selected) */}
            {currentGroup?.type === 'club' && (() => {
                const cg = currentGroup as typeof currentGroup & {
                    mediationMessage?: string;
                    mediationQuestions?: string[];
                    weeklyFocus?: string;
                    readingNow?: string;
                    nextMilestone?: string;
                };
                const hasSessionData = cg.mediationMessage || cg.weeklyFocus || cg.readingNow || cg.nextMilestone || (cg.mediationQuestions && cg.mediationQuestions.length > 0);

                // Per-student average across all club content (for detection + grouping)
                const studentAvgs = students.map(s => {
                    const progs = clubContentItems.map(item => dataService.getProgresoUsuarioLibro(s.id, item.id)?.porcentaje ?? 0);
                    const avg = progs.length > 0 ? Math.round(progs.reduce((a, b) => a + b, 0) / progs.length) : 0;
                    return { student: s, avg };
                });
                const rezagoCount    = studentAvgs.filter(p => p.avg < 20).length;
                const sinProgresoCount = studentAvgs.filter(p => p.avg === 0).length;
                const progresoCount  = studentAvgs.filter(p => p.avg >= 20 && p.avg < 80).length;
                const avanzadoCount  = studentAvgs.filter(p => p.avg >= 80).length;

                // Filtered students for the progress grid
                const filteredStudents = c3Filter === 'rezago'   ? students.filter((_, i) => studentAvgs[i].avg < 20)
                                       : c3Filter === 'progreso'  ? students.filter((_, i) => studentAvgs[i].avg >= 20 && studentAvgs[i].avg < 80)
                                       : c3Filter === 'avanzado'  ? students.filter((_, i) => studentAvgs[i].avg >= 80)
                                       : students;

                // Column highlight for readingNow
                const readingNowLower = cg.readingNow?.toLowerCase() ?? '';
                const isReadingNowCol = (item: Content) =>
                    readingNowLower.length > 0 && item.titulo.toLowerCase().includes(readingNowLower.split('—')[0].trim());

                return (
                    <div className="mb-8 space-y-4 animate-in fade-in">

                        {/* Part 1 — Save feedback toast */}
                        {c3SavedFeedback && (
                            <div className="flex items-center gap-2 px-4 py-2.5 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl text-sm font-bold text-green-700 dark:text-green-400 animate-in fade-in slide-in-from-top-1">
                                <CheckCircle size={14} /> {c3SavedFeedback}
                            </div>
                        )}

                        {/* Part 3 — Detection banner */}
                        {students.length > 0 && (rezagoCount > 0 || sinProgresoCount > 0) && (
                            <div className="flex items-center justify-between gap-3 px-4 py-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl">
                                <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400">
                                    <span className="text-base">⚠️</span>
                                    <span>
                                        {rezagoCount > 0 && <><strong>{rezagoCount}</strong> con rezago (&lt;20%){sinProgresoCount > 0 ? ' · ' : ''}</>}
                                        {sinProgresoCount > 0 && <><strong>{sinProgresoCount}</strong> sin progreso</>}
                                    </span>
                                </div>
                                <button
                                    onClick={handleC3OpenSuggest}
                                    className="shrink-0 px-3 py-1.5 text-xs font-bold text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                                >
                                    Intervenir ahora
                                </button>
                            </div>
                        )}

                        {/* Section header + DashboardMediador link */}
                        <div className="flex items-center justify-between">
                            <h3 className="text-sm font-bold uppercase tracking-wider text-pink-600 dark:text-pink-400 flex items-center gap-2">
                                <BookMarked size={15} /> Sesión del Club
                            </h3>
                            <button
                                onClick={() => navigate(`/dashboard/curso/${currentGroup.id}`)}
                                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/30 hover:bg-indigo-100 dark:hover:bg-indigo-800/50 border border-indigo-200 dark:border-indigo-700 rounded-lg transition-colors"
                            >
                                <BarChart2 size={13} /> Ver analítica completa <ExternalLink size={11} />
                            </button>
                        </div>

                        {/* Group-level action buttons */}
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={handleC3OpenSuggest}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/40 rounded-lg transition-colors"
                            >
                                <BrainCircuit size={13} /> Sugerir intervención
                            </button>
                            <button
                                onClick={() => { setC3Input(cg.mediationMessage ?? ''); setC3Modal('message'); }}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-700 text-pink-700 dark:text-pink-400 hover:bg-pink-100 dark:hover:bg-pink-800/40 rounded-lg transition-colors"
                            >
                                <MessageCircle size={13} /> Mensaje al grupo
                            </button>
                            <button
                                onClick={() => { setC3Input(cg.weeklyFocus ?? ''); setC3FocusField('weeklyFocus'); setC3Modal('focus'); }}
                                className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-indigo-800/40 rounded-lg transition-colors"
                            >
                                <PenTool size={13} /> Definir foco
                            </button>
                        </div>

                        {/* Session context tiles */}
                        {hasSessionData && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                {cg.mediationMessage && (
                                    <div className="md:col-span-2 px-4 py-3 bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-800 rounded-xl">
                                        <p className="text-[10px] font-bold uppercase text-pink-500 tracking-wider mb-1">Mensaje del mediador</p>
                                        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{cg.mediationMessage}</p>
                                    </div>
                                )}
                                {(cg.weeklyFocus || cg.readingNow || cg.nextMilestone) && (
                                    <div className="flex flex-col gap-2">
                                        {cg.weeklyFocus && (
                                            <div className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                                                <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Foco de la semana</p>
                                                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mt-0.5">{cg.weeklyFocus}</p>
                                            </div>
                                        )}
                                        {cg.readingNow && (
                                            <div className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                                                <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Leyendo ahora</p>
                                                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mt-0.5">{cg.readingNow}</p>
                                            </div>
                                        )}
                                        {cg.nextMilestone && (
                                            <div className="px-3 py-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
                                                <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider">Próximo hito</p>
                                                <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 mt-0.5">{cg.nextMilestone}</p>
                                            </div>
                                        )}
                                    </div>
                                )}
                                {cg.mediationQuestions && cg.mediationQuestions.length > 0 && (
                                    <div className="px-3 py-3 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl">
                                        <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Preguntas de reflexión</p>
                                        <ol className="space-y-1.5">
                                            {cg.mediationQuestions.map((q, i) => (
                                                <li key={i} className="flex gap-2 text-sm text-gray-700 dark:text-gray-300">
                                                    <span className="font-bold text-pink-500 shrink-0">{i + 1}.</span>
                                                    <span>{q}</span>
                                                </li>
                                            ))}
                                        </ol>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Per-content progress grid */}
                        {clubContentItems.length > 0 && students.length > 0 && (
                            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                                {/* Part 5 — Grouping summary + filter chips */}
                                <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex flex-wrap items-center gap-2">
                                    <p className="text-xs font-bold uppercase text-gray-500 tracking-wider mr-1">Progreso por lectura</p>
                                    {[
                                        { key: 'all',      label: `Todos (${students.length})`,   cls: 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-600' },
                                        { key: 'rezago',   label: `Rezago (${rezagoCount})`,       cls: 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 border-red-200 dark:border-red-700' },
                                        { key: 'progreso', label: `En progreso (${progresoCount})`, cls: 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border-indigo-200 dark:border-indigo-700' },
                                        { key: 'avanzado', label: `Avanzados (${avanzadoCount})`,  cls: 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400 border-green-200 dark:border-green-700' },
                                    ].map(chip => (
                                        <button
                                            key={chip.key}
                                            onClick={() => setC3Filter(chip.key as typeof c3Filter)}
                                            className={`px-2.5 py-1 text-[11px] font-bold rounded-full border transition-colors ${chip.cls} ${c3Filter === chip.key ? 'ring-2 ring-offset-1 ring-current' : 'opacity-70 hover:opacity-100'}`}
                                        >
                                            {chip.label}
                                        </button>
                                    ))}
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs">
                                        <thead>
                                            <tr className="border-b border-gray-100 dark:border-gray-700">
                                                <th className="text-left px-4 py-2 font-bold text-gray-500 uppercase tracking-wider min-w-[140px]">Miembro</th>
                                                {/* Part 4 — readingNow column highlight */}
                                                {clubContentItems.map(item => {
                                                    const isActive = isReadingNowCol(item);
                                                    return (
                                                        <th key={item.id} className={`text-center px-3 py-2 font-bold uppercase tracking-wider max-w-[120px] ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400' : 'text-gray-500'}`}>
                                                            <span className="block truncate" title={item.titulo}>{item.titulo}</span>
                                                            {isActive && <span className="block text-[9px] text-indigo-400 font-bold normal-case tracking-normal mt-0.5">leyendo ahora</span>}
                                                        </th>
                                                    );
                                                })}
                                                <th className="text-center px-3 py-2 font-bold text-gray-500 uppercase tracking-wider w-24"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {filteredStudents.map(student => {
                                                const sAvg = studentAvgs.find(p => p.student.id === student.id)?.avg ?? 0;
                                                const isLow = sAvg < 20;
                                                return (
                                                    <tr key={student.id} className={`border-b border-gray-50 dark:border-gray-700/50 transition-colors ${isLow ? 'bg-red-50/40 dark:bg-red-900/10 hover:bg-red-50 dark:hover:bg-red-900/20' : 'hover:bg-gray-50 dark:hover:bg-gray-700/30'}`}>
                                                        <td className="px-4 py-2 font-medium truncate max-w-[140px]">
                                                            <span className={isLow ? 'text-red-700 dark:text-red-400' : 'text-gray-700 dark:text-gray-300'}>
                                                                {student.nombre_completo}
                                                            </span>
                                                            {isLow && <span className="ml-1 text-[9px] font-bold text-red-500 uppercase">rezago</span>}
                                                        </td>
                                                        {clubContentItems.map(item => {
                                                            const isActive = isReadingNowCol(item);
                                                            const prog = dataService.getProgresoUsuarioLibro(student.id, item.id);
                                                            const pct = prog?.porcentaje ?? 0;
                                                            const color = pct >= 80 ? 'bg-green-500' : pct >= 30 ? 'bg-indigo-500' : 'bg-gray-300 dark:bg-gray-600';
                                                            return (
                                                                <td key={item.id} className={`px-3 py-2 text-center ${isActive ? 'bg-indigo-50/50 dark:bg-indigo-900/10' : ''}`}>
                                                                    <div className="flex flex-col items-center gap-1">
                                                                        <span className={`font-bold ${pct >= 80 ? 'text-green-600 dark:text-green-400' : pct >= 30 ? 'text-indigo-600 dark:text-indigo-400' : 'text-gray-400'}`}>{pct}%</span>
                                                                        <div className="w-12 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
                                                                            <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            );
                                                        })}
                                                        {/* Part 1 — Intervenir button highlights red for low-progress students */}
                                                        <td className="px-3 py-2 text-center">
                                                            <button
                                                                onClick={() => handleC3OpenIntervene(student)}
                                                                className={`px-2.5 py-1 text-[11px] font-bold border rounded-md transition-colors whitespace-nowrap ${isLow
                                                                    ? 'bg-red-100 dark:bg-red-900/30 border-red-300 dark:border-red-700 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800/40'
                                                                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-100 dark:hover:bg-amber-800/40'}`}
                                                            >
                                                                Intervenir
                                                            </button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            {filteredStudents.length === 0 && (
                                                <tr><td colSpan={clubContentItems.length + 2} className="px-4 py-4 text-center text-xs text-gray-400">Sin miembros en esta categoría.</td></tr>
                                            )}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}

                        {!hasSessionData && clubContentItems.length === 0 && (
                            <div className="px-4 py-5 bg-gray-50 dark:bg-gray-800/50 border border-dashed border-gray-200 dark:border-gray-700 rounded-xl text-center">
                                <p className="text-sm text-gray-400">No hay datos de sesión configurados para este club.</p>
                                <p className="text-xs text-gray-400 mt-1">Edita el club para agregar mensaje del mediador, foco semanal y lectura activa.</p>
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* C3 Mediation Modal */}
            {c3Modal !== null && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => { setC3Modal(null); setC3Input(''); }}>
                    <div className="bg-white dark:bg-gray-900 w-full max-w-sm rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-6" onClick={e => e.stopPropagation()}>

                        {/* Mensaje al grupo */}
                        {c3Modal === 'message' && (
                            <>
                                <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-1">Mensaje al grupo</h4>
                                <p className="text-xs text-gray-500 mb-4">Se mostrará a todos los miembros como mensaje del mediador.</p>
                                <textarea
                                    autoFocus
                                    rows={4}
                                    value={c3Input}
                                    onChange={e => setC3Input(e.target.value)}
                                    placeholder="Escribe tu mensaje..."
                                    className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 border-transparent rounded-xl focus:ring-2 focus:ring-pink-500 focus:bg-white dark:focus:bg-gray-700 transition-all resize-none"
                                />
                                <div className="flex gap-2 mt-4">
                                    <button onClick={() => { setC3Modal(null); setC3Input(''); }} className="flex-1 py-2 text-sm font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 rounded-xl transition-colors">Cancelar</button>
                                    <button onClick={handleC3SaveMessage} disabled={!c3Input.trim() || c3Saving} className="flex-1 py-2 text-sm font-bold text-white bg-pink-600 hover:bg-pink-700 disabled:opacity-50 rounded-xl transition-colors flex items-center justify-center gap-1">
                                        {c3Saving ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Guardar
                                    </button>
                                </div>
                            </>
                        )}

                        {/* Definir foco */}
                        {c3Modal === 'focus' && (
                            <>
                                <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-1">Definir foco</h4>
                                <p className="text-xs text-gray-500 mb-3">Actualiza el foco de la semana o la lectura activa del club.</p>
                                <div className="flex gap-2 mb-3">
                                    <button
                                        onClick={() => { setC3FocusField('weeklyFocus'); setC3Input((currentGroup as any).weeklyFocus ?? ''); }}
                                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${c3FocusField === 'weeklyFocus' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:bg-gray-200'}`}
                                    >Foco semanal</button>
                                    <button
                                        onClick={() => { setC3FocusField('readingNow'); setC3Input((currentGroup as any).readingNow ?? ''); }}
                                        className={`flex-1 py-1.5 text-xs font-bold rounded-lg border transition-colors ${c3FocusField === 'readingNow' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 border-gray-200 dark:border-gray-700 hover:bg-gray-200'}`}
                                    >Leyendo ahora</button>
                                </div>
                                <input
                                    autoFocus
                                    type="text"
                                    value={c3Input}
                                    onChange={e => setC3Input(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleC3SaveFocus()}
                                    placeholder={c3FocusField === 'weeklyFocus' ? 'Ej: Comprensión inferencial del capítulo 3' : 'Ej: El Principito — capítulos 1-5'}
                                    className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 border-transparent rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-700 transition-all"
                                />
                                <div className="flex gap-2 mt-4">
                                    <button onClick={() => { setC3Modal(null); setC3Input(''); }} className="flex-1 py-2 text-sm font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 rounded-xl transition-colors">Cancelar</button>
                                    <button onClick={handleC3SaveFocus} disabled={!c3Input.trim() || c3Saving} className="flex-1 py-2 text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 rounded-xl transition-colors flex items-center justify-center gap-1">
                                        {c3Saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />} Guardar
                                    </button>
                                </div>
                            </>
                        )}

                        {/* Sugerir intervención */}
                        {c3Modal === 'suggest' && (
                            <>
                                <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-3 flex items-center gap-2"><BrainCircuit size={16} className="text-amber-500" /> Sugerencia de intervención</h4>
                                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-4 text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-line mb-4">
                                    {c3SuggestionText}
                                </div>
                                {/* Part 2 — action bridge buttons */}
                                <p className="text-[10px] font-bold uppercase text-gray-400 tracking-wider mb-2">Usar sugerencia como</p>
                                <div className="flex gap-2 mb-3">
                                    <button
                                        onClick={() => { setC3Input(c3SuggestionText); setC3Modal('message'); }}
                                        className="flex-1 py-2 text-xs font-bold bg-pink-50 dark:bg-pink-900/20 border border-pink-200 dark:border-pink-700 text-pink-700 dark:text-pink-400 hover:bg-pink-100 rounded-lg transition-colors flex items-center justify-center gap-1"
                                    >
                                        <MessageCircle size={12} /> Mensaje al grupo
                                    </button>
                                    <button
                                        onClick={() => { setC3Input(c3SuggestionText.split('\n')[0]); setC3FocusField('weeklyFocus'); setC3Modal('focus'); }}
                                        className="flex-1 py-2 text-xs font-bold bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-100 rounded-lg transition-colors flex items-center justify-center gap-1"
                                    >
                                        <PenTool size={12} /> Foco semanal
                                    </button>
                                </div>
                                <button onClick={() => setC3Modal(null)} className="w-full py-2 text-sm font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 rounded-xl transition-colors">Cerrar</button>
                            </>
                        )}

                        {/* Intervenir — per student */}
                        {c3Modal === 'intervene' && c3IntervenStudent && (
                            <>
                                <h4 className="font-bold text-gray-800 dark:text-gray-100 mb-0.5">Intervención — {c3IntervenStudent.nombre_completo}</h4>
                                <p className="text-xs text-gray-500 mb-4">Escribe una nota de acompañamiento o sugerencia para este miembro.</p>
                                <textarea
                                    autoFocus
                                    rows={4}
                                    value={c3Input}
                                    onChange={e => setC3Input(e.target.value)}
                                    placeholder="Ej: Compartir vocabulario del capítulo 2. Preguntar por la escena del barco."
                                    className="w-full px-3 py-2 text-sm bg-gray-100 dark:bg-gray-800 border-transparent rounded-xl focus:ring-2 focus:ring-amber-500 focus:bg-white dark:focus:bg-gray-700 transition-all resize-none"
                                />
                                <div className="flex gap-2 mt-4">
                                    <button onClick={() => { setC3Modal(null); setC3Input(''); setC3IntervenStudent(null); }} className="flex-1 py-2 text-sm font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 rounded-xl transition-colors">Cancelar</button>
                                    <button
                                        onClick={() => {
                                            if (!c3Input.trim() || !selectedGroup || !c3IntervenStudent) return;
                                            // Part 6 — semantic tag via description prefix (future Leo integration)
                                            dataService.createAssignment({
                                                groupId: selectedGroup,
                                                contentId: '',
                                                contentTitle: `Nota: ${c3IntervenStudent.nombre_completo}`,
                                                assignedDate: new Date().toISOString(),
                                                dueDate: '',
                                                description: c3Input.trim(),
                                                submissionType: undefined,
                                                ...(({ _tag: 'mediator_intervention', _targetStudentId: c3IntervenStudent.id }) as any),
                                            } as any);
                                            setC3Modal(null);
                                            setC3Input('');
                                            setC3IntervenStudent(null);
                                            if (selectedGroup) setGroupAssignments(dataService.getAssignmentsByGroup(selectedGroup));
                                            showC3Feedback('Nota de intervención guardada');
                                        }}
                                        disabled={!c3Input.trim()}
                                        className="flex-1 py-2 text-sm font-bold text-white bg-amber-600 hover:bg-amber-700 disabled:opacity-50 rounded-xl transition-colors flex items-center justify-center gap-1"
                                    >
                                        <Send size={14} /> Guardar nota
                                    </button>
                                </div>
                            </>
                        )}

                    </div>
                </div>
            )}

            {/* Tab Switcher */}
            <div className="flex space-x-4 border-b border-gray-200 dark:border-gray-700 mb-8">
                <button
                    onClick={() => setActiveTab('analytics')}
                    className={`px-4 py-2 font-bold border-b-2 transition-colors flex items-center ${activeTab === 'analytics' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    <BarChart2 size={18} className="mr-2" /> Analítica de Grupo
                </button>
                <button
                    onClick={() => setActiveTab('tasks')}
                    className={`px-4 py-2 font-bold border-b-2 transition-colors flex items-center ${activeTab === 'tasks' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    <ClipboardList size={18} className="mr-2" /> Gestión de Tareas
                </button>
                {/* CHP-MOOK-REVIEW-01 — Producciones de Experiencias (UX D1). */}
                <button
                    onClick={() => setActiveTab('producciones')}
                    className={`px-4 py-2 font-bold border-b-2 transition-colors flex items-center ${activeTab === 'producciones' ? 'border-indigo-600 text-indigo-600' : 'border-transparent text-gray-500 hover:text-gray-700'}`}
                >
                    <PenLine size={18} className="mr-2" /> Producciones
                </button>
            </div>

            {activeTab === 'producciones' && <ProduccionesTab />}

            {activeTab === 'tasks' && (
                <div className="animate-in fade-in">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-2xl font-bold">Tareas Asignadas</h2>
                        <button
                            onClick={() => setShowAssignmentModal(true)}
                            className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 shadow-md transition-colors"
                        >
                            <Plus size={20} className="mr-2" /> Nueva Tarea
                        </button>
                    </div>

                    {groupAssignments.length === 0 ? (
                        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                            <ClipboardList size={48} className="mx-auto text-gray-300 mb-4" />
                            <p className="text-gray-500">No hay tareas activas para este grupo.</p>
                            <p className="text-sm text-indigo-500 mt-2 cursor-pointer hover:underline" onClick={() => setShowAssignmentModal(true)}>Asignar la primera tarea</p>
                        </div>
                    ) : (
                        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
                            {groupAssignments.map(assignment => (
                                <AssignmentCard
                                    key={assignment.id}
                                    assignment={assignment}
                                    userId={user.id}
                                    isStudent={false}
                                    onDelete={handleDeleteAssignment}
                                    onReview={handleOpenReview}
                                />
                            ))}
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'analytics' && (
                <>
                    {/* Sprint visibilidad — panel narrativo SIEMPRE visible cuando hay
                        grupo seleccionado. Aula Viva nunca queda "vacía sin explicación":
                        si el grupo no tiene estudiantes, el panel lo dice y propone qué
                        hacer. Si hay incoherencias o advertencias, las muestra antes que
                        cualquier KPI con ceros que pueda confundir al mediador. */}
                    {selectedGroup && (diagnosisLoading || diagnosis || diagnosisError) && (
                        <div className="mb-8 animate-in fade-in">
                            <GroupDiagnosisPanel
                                diagnosis={diagnosis}
                                loading={diagnosisLoading}
                                error={diagnosisError}
                            />
                        </div>
                    )}

                    {/* ADVANCED KPI ROW */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6 mb-8 animate-in fade-in">
                        {/* KPI 1 Interacción Chatbot */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col justify-between">
                            <div>
                                <p className="text-sm text-gray-500 font-bold uppercase mb-1">Interacción Chatbot</p>
                                <p className="text-[10px] text-gray-400">Promedio preguntas/alumno</p>
                            </div>
                            <div className="flex items-end justify-between mt-2">
                                <p className="text-3xl font-bold">{groupAverages.botInteractions}</p>
                                <MessageCircle className="text-blue-400 mb-1" size={28} />
                            </div>
                        </div>

                        {/* KPI 2 Tasa de Tareas */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col justify-between">
                            <div>
                                <p className="text-sm text-gray-500 font-bold uppercase mb-1">Cumplimiento Tareas</p>
                                <p className="text-[10px] text-gray-400">Tasa de entrega efectiva</p>
                            </div>
                            <div className="flex items-end justify-between mt-2">
                                <p className="text-3xl font-bold">{groupAverages.taskRate}%</p>
                                <CheckCircle className="text-green-400 mb-1" size={28} />
                            </div>
                        </div>

                        {/* KPI 3 Tiempo */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col justify-between">
                            <div>
                                <p className="text-sm text-gray-500 font-bold uppercase mb-1">Tiempo de Lectura</p>
                                <p className="text-[10px] text-gray-400">Promedio total acumulado</p>
                            </div>
                            <div className="flex items-end justify-between mt-2">
                                <p className="text-3xl font-bold">{groupAverages.time}<span className="text-lg text-gray-400 font-normal">min</span></p>
                                <Clock className="text-purple-400 mb-1" size={28} />
                            </div>
                        </div>

                        {/* KPI 4 Distribution */}
                        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-700 flex flex-col justify-center">
                            <p className="text-sm text-gray-500 font-bold uppercase mb-2">Distribución PISA</p>
                            <DistributionChart low={groupDistribution.low} mid={groupDistribution.mid} high={groupDistribution.high} total={students.length} />
                            <div className="flex justify-between text-xs mt-2 text-gray-400">
                                <span>Bajo</span><span>Medio</span><span>Alto</span>
                            </div>
                        </div>
                    </div>

                    {/* UX-3B — md:grid-cols-2 para tablet:
                          mobile  → 1 columna (analytics + panel apilados)
                          tablet  → 2 columnas (panel a la derecha del analytics)
                          desktop → 3 columnas (analytics 2/3, panel 1/3)
                        Antes: sólo grid-cols-1 → lg:grid-cols-3, así que en
                        tablet el panel detalle del estudiante caía DESPUÉS
                        de todos los charts — el mediador clickeaba un
                        estudiante y tenía que scrollear más de un viewport
                        para verlo. */}
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
                        {/* Left Column: Charts and Analysis */}
                        <div className="lg:col-span-2 space-y-8">

                            {/* PISA / Saber Pro Competencies Chart */}
                            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700">
                                <h3 className="text-lg font-bold flex items-center mb-6 text-indigo-800 dark:text-indigo-400">
                                    <BrainCircuit className="mr-2" /> Competencias PISA & Saber Pro (Promedio Grupo)
                                </h3>
                                <div className="space-y-6">
                                    <CompetencyBar
                                        label="Lectura Literal (Recuperar Información)"
                                        value={groupAverages.bgCompLiteral}
                                        color="bg-blue-500"
                                        description="Capacidad de ubicar y extraer información explícita en el texto."
                                    />
                                    <CompetencyBar
                                        label="Lectura Inferencial (Interpretar)"
                                        value={groupAverages.bgCompInferencial}
                                        color="bg-indigo-500"
                                        description="Capacidad de deducir el sentido, propósito y relaciones no explícitas."
                                    />
                                    <CompetencyBar
                                        label="Lectura Crítica (Reflexionar y Evaluar)"
                                        value={groupAverages.bgCompCritica}
                                        color="bg-purple-500"
                                        description="Capacidad de juzgar y relacionar el contenido con otros contextos."
                                    />
                                </div>
                            </div>

                            {/* Trend Chart (Existing) */}
                            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 border border-gray-200 dark:border-gray-700">
                                <h3 className="text-lg font-bold flex items-center mb-4"><TrendingUp className="mr-2 text-indigo-500" /> Evolución Histórica del Desempeño</h3>
                                <TrendChart data={groupTrend} />
                            </div>

                            {/* Student Table (Updated Columns) */}
                            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg overflow-hidden border border-gray-200 dark:border-gray-700">
                                <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                                    <h2 className="text-xl font-bold">{currentGroup?.type === 'club' ? 'Miembros del Club' : 'Listado Detallado de Estudiantes'}</h2>
                                    <div className="flex items-center gap-3">
                                        {currentGroup?.type === 'club' && (
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={handleOpenMemberModal}
                                                    className="flex items-center px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 text-sm font-bold transition-colors"
                                                >
                                                    <Plus size={16} className="mr-1" /> Gestionar Miembros
                                                </button>
                                                <button
                                                    onClick={handleOpenContentModal}
                                                    className="flex items-center px-3 py-1.5 bg-pink-600 text-white rounded-lg hover:bg-pink-700 text-sm font-bold transition-colors"
                                                >
                                                    <BookOpen size={16} className="mr-1" /> Gestionar Contenido
                                                </button>
                                            </div>
                                        )}
                                        {currentGroup && (
                                            <button
                                                onClick={handleOpenBundleModal}
                                                className="flex items-center px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-bold transition-colors"
                                            >
                                                <Package size={16} className="mr-1" /> Experiencias
                                            </button>
                                        )}
                                        <span className="text-xs text-gray-400">Mostrando {paginatedStudents.length} de {students.length}</span>
                                    </div>
                                </div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-left">
                                        <thead className="bg-gray-50 dark:bg-gray-700/50 text-xs uppercase text-gray-500">
                                            <tr>
                                                <th className="p-4 rounded-tl-lg">Participante</th>
                                                <th className="p-4 text-center">Libros</th>
                                                <th className="p-4 text-center">Tiempo (Sem/Día)</th>
                                                <th className="p-4 text-center">Chatbot</th>
                                                <th className="p-4 text-center">Tareas</th>
                                                <th className="p-4 text-right">PISA Global</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {paginatedStudents.map(student => (
                                                <StudentRow
                                                    key={student.id}
                                                    student={student}
                                                    stats={dataService.getPedagogicalStats(student.id)}
                                                    onSelect={() => setSelectedStudent(student)}
                                                />
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {/* Pagination Controls */}
                                <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex justify-center gap-4">
                                    <button
                                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                        disabled={currentPage === 1}
                                        className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-50"
                                    >Anterior</button>
                                    <span className="py-1">Pág {currentPage}</span>
                                    <button
                                        onClick={() => setCurrentPage(p => Math.min(Math.ceil(students.length / itemsPerPage), p + 1))}
                                        disabled={currentPage * itemsPerPage >= students.length}
                                        className="px-3 py-1 bg-gray-100 dark:bg-gray-700 rounded disabled:opacity-50"
                                    >Siguiente</button>
                                </div>
                            </div>

                            {/* Club Content Section */}
                            {currentGroup?.type === 'club' && (
                                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mt-6">
                                    <div className="p-5 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center">
                                        <h2 className="text-lg font-bold flex items-center">
                                            <BookOpen className="mr-2 text-pink-500" size={18} /> Contenido del Club
                                        </h2>
                                        <button
                                            onClick={handleOpenContentModal}
                                            className="flex items-center px-3 py-1.5 bg-pink-600 text-white rounded-lg hover:bg-pink-700 text-sm font-bold transition-colors"
                                        >
                                            <Plus size={14} className="mr-1" /> Gestionar
                                        </button>
                                    </div>
                                    <div className="p-4">
                                        {clubContentItems.length === 0 ? (
                                            <div className="text-center py-5 text-gray-400">
                                                <BookOpen size={28} className="mx-auto mb-2 opacity-25" />
                                                <p className="text-sm">No hay contenido habilitado para este club.</p>
                                                <p className="text-xs text-pink-500 mt-1 cursor-pointer hover:underline" onClick={handleOpenContentModal}>Agregar contenido</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-2">
                                                {clubContentItems.map(c => (
                                                    <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-700/30 rounded-lg">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <BookOpen size={13} className="text-pink-400 flex-shrink-0" />
                                                            <span className="text-sm font-medium truncate">{c.titulo}</span>
                                                            {c.autor && <span className="text-xs text-gray-400 flex-shrink-0">— {c.autor}</span>}
                                                        </div>
                                                        <button
                                                            onClick={() => handleRemoveClubContent(c.id)}
                                                            className="text-xs text-red-400 hover:text-red-600 font-bold ml-3 flex-shrink-0"
                                                        >×</button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right Column: Student Detail / Analytics Panel */}
                        <div className="lg:col-span-1" ref={detailPanelRef}>
                            {/* Sprint Panel del estudiante — capa narrativa SIEMPRE visible
                                cuando hay selección. Va ANTES del bloque de stats técnicas:
                                un estudiante sin login o sin grupo no tiene stats, pero
                                igual debe ser explicado por el sistema. La fila clickeada
                                en la tabla actúa como "Ver detalle" implícito. */}
                            {selectedStudent && (
                                <div className="mb-6">
                                    <StudentStatusPanel
                                        status={studentStatus}
                                        loading={studentStatusLoading}
                                        error={studentStatusError}
                                        onClose={() => setSelectedStudent(null)}
                                    />
                                </div>
                            )}

                            {selectedStudent && studentStats ? (
                                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 sticky top-24 animate-in slide-in-from-right-4">
                                    <div className="flex items-center justify-between mb-6">
                                        <div className="flex items-center">
                                            <img src={selectedStudent.avatar_url} className="w-16 h-16 rounded-full mr-4 shadow-md border-2 border-indigo-500" />
                                            <div>
                                                <h2 className="text-xl font-bold">{selectedStudent.nombre_completo}</h2>
                                                <p className="text-sm text-gray-500">{selectedStudent.email}</p>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-1 flex-shrink-0 ml-2">
                                            <button
                                                onClick={() => handleDownloadStudentSubmissions(selectedStudent.id)}
                                                disabled={downloadingStudentId === selectedStudent.id}
                                                title="Exportar tareas del estudiante"
                                                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg transition-colors shadow-sm whitespace-nowrap"
                                            >
                                                {downloadingStudentId === selectedStudent.id
                                                    ? <><Loader2 size={12} className="animate-spin" /> Descargando...</>
                                                    : <><Download size={12} /> Exportar tareas</>
                                                }
                                            </button>
                                            {studentDownloadError && (
                                                <span className="text-[11px] text-red-500 text-right leading-tight max-w-[120px]">
                                                    {studentDownloadError}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Reading Habits Section */}
                                    <div className="mb-8">
                                        <h3 className="font-bold text-gray-500 uppercase text-xs mb-4 tracking-wider border-b pb-1">Hábitos de Lectura y Estudio</h3>
                                        <div className="grid grid-cols-2 gap-4 mb-4">
                                            <div className="bg-gray-50 dark:bg-gray-700/30 p-3 rounded-lg text-center">
                                                <Zap className="mx-auto text-yellow-500 mb-1" size={20} />
                                                <p className="text-xl font-bold">{studentStats.readingSpeedWPM || '-'}</p>
                                                <p className="text-[10px] text-gray-400 uppercase">Palabras/Min</p>
                                            </div>
                                            <div className="bg-gray-50 dark:bg-gray-700/30 p-3 rounded-lg text-center">
                                                <Zap className="mx-auto text-yellow-500 mb-1" size={20} />
                                                <p className="text-xl font-bold">{studentStats.readingSpeedWPM || '-'}</p>
                                                <p className="text-[10px] text-gray-400 uppercase">Palabras/Min</p>
                                            </div>
                                            <div className="bg-gray-50 dark:bg-gray-700/30 p-3 rounded-lg text-center">
                                                <MessageCircle className="mx-auto text-blue-500 mb-1" size={20} />
                                                <p className="text-xl font-bold">{studentStats.chatbotInteractions || 0}</p>
                                                <p className="text-[10px] text-gray-400 uppercase">Preguntas a IA</p>
                                            </div>
                                        </div>
                                        <div className="bg-gray-50 dark:bg-gray-700/30 p-3 rounded-lg flex items-center justify-between mb-4">
                                            <div className="flex items-center">
                                                <Timer className="text-green-500 mr-2" size={20} />
                                                <span className="text-sm font-medium">Lectura Semanal</span>
                                            </div>
                                            <span className="font-bold">{studentStats.weeklyReadingTimeMinutes || 0} min</span>
                                        </div>

                                        <div>
                                            <p className="text-xs text-gray-400 mb-2 font-bold uppercase">Géneros Favoritos</p>
                                            <div className="flex flex-wrap gap-2">
                                                {studentStats.genrePreferences && studentStats.genrePreferences.length > 0 ? (
                                                    studentStats.genrePreferences.map((g, i) => (
                                                        <span key={i} className="px-2 py-1 bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 rounded text-xs font-medium">
                                                            {g.genre}
                                                        </span>
                                                    ))
                                                ) : <span className="text-xs text-gray-400">Sin datos suficientes</span>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Competencies Section (8 Objectives) */}
                                    <h3 className="font-bold text-gray-500 uppercase text-xs mb-4 tracking-wider border-b pb-1">Progreso en 8 Objetivos Pedagógicos</h3>

                                    {studentStats.pedagogicalObjectives ? (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-8">
                                            {OBJECTIVES_DETAILS.map((obj) => {
                                                const val = studentStats.pedagogicalObjectives?.[obj.id as keyof typeof studentStats.pedagogicalObjectives] || 0;
                                                return (
                                                    <div key={obj.id} className="group relative bg-white dark:bg-gray-700/50 p-3 rounded-lg border border-gray-100 dark:border-gray-600 hover:shadow-md transition-shadow">
                                                        <div className="flex justify-between items-end mb-1">
                                                            <span className="text-xs font-bold text-gray-600 dark:text-gray-300 truncate pr-2" title={obj.title}>{obj.title}</span>
                                                            <span className={`text-sm font-bold ${val >= 80 ? 'text-green-500' : val >= 60 ? 'text-yellow-500' : 'text-red-500'}`}>{val}%</span>
                                                        </div>
                                                        <div className="w-full bg-gray-200 dark:bg-gray-600 rounded-full h-1.5 mb-1">
                                                            <div className={`h-1.5 rounded-full ${val >= 80 ? 'bg-green-500' : val >= 60 ? 'bg-yellow-500' : 'bg-red-500'}`} style={{ width: `${val}%` }}></div>
                                                        </div>

                                                        <p className="text-[10px] text-gray-400 line-clamp-1 group-hover:hidden">{obj.meta}</p>

                                                        {/* Tooltip Card */}
                                                        <div className="hidden group-hover:block absolute z-20 bottom-full left-0 mb-2 w-64 bg-gray-900 text-white text-xs p-3 rounded-lg shadow-xl pointer-events-none">
                                                            <p className="mb-2"><strong className="text-indigo-300 block mb-0.5">Meta:</strong> {obj.meta}</p>
                                                            <p><strong className="text-pink-300 block mb-0.5">Rol Chatbot:</strong> {obj.rol}</p>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <div className="space-y-4 mb-8">
                                            <p className="text-xs text-red-400">Datos detallados de objetivos no disponibles para este usuario.</p>
                                            <ProgressBar value={studentStats.comprension_literal} color="bg-blue-500" label="Literal (Recuperar)" />
                                            <ProgressBar value={studentStats.comprension_inferencial} color="bg-indigo-500" label="Inferencial (Interpretar)" />
                                            <ProgressBar value={studentStats.reflexion_critica} color="bg-purple-500" label="Crítica (Reflexionar)" />
                                        </div>
                                    )}

                                    {/* ── Análisis pedagógico (señales básicas) ── */}
                                    <div className="mb-6">
                                        <h3 className="font-bold text-gray-500 uppercase text-xs mb-3 tracking-wider border-b pb-1 flex items-center gap-1.5">
                                            <ClipboardList size={13} />
                                            Análisis pedagógico
                                        </h3>

                                        {!learningSignals || learningSignals.totalAssigned === 0 ? (
                                            <p className="text-xs text-gray-400 italic">
                                                No hay tareas asignadas en este grupo aún.
                                            </p>
                                        ) : learningSignals.totalSubmitted === 0 ? (
                                            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-4">
                                                <p className="text-xs font-bold text-amber-700 dark:text-amber-400 mb-1">Sin entregas registradas</p>
                                                <p className="text-xs text-amber-600 dark:text-amber-500">
                                                    {learningSignals.totalAssigned} tarea{learningSignals.totalAssigned !== 1 ? 's' : ''} asignada{learningSignals.totalAssigned !== 1 ? 's' : ''} · 0 enviadas
                                                </p>
                                            </div>
                                        ) : (
                                            <>
                                                {/* Bloque A — Resumen rápido */}
                                                <div className="grid grid-cols-3 gap-2 mb-3">
                                                    <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-2.5 text-center">
                                                        <p className="text-lg font-black text-indigo-600 dark:text-indigo-400">
                                                            {learningSignals.completionRate}%
                                                        </p>
                                                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Cumplimiento</p>
                                                    </div>
                                                    <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-2.5 text-center">
                                                        <p className="text-lg font-black text-indigo-600 dark:text-indigo-400">
                                                            {learningSignals.averageWordCount}
                                                        </p>
                                                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Prom. palabras</p>
                                                    </div>
                                                    <div className="bg-gray-50 dark:bg-gray-700/40 rounded-lg p-2.5 text-center">
                                                        <p className="text-lg font-black text-indigo-600 dark:text-indigo-400">
                                                            {learningSignals.totalSubmitted}/{learningSignals.totalAssigned}
                                                        </p>
                                                        <p className="text-[10px] text-gray-400 uppercase tracking-wide">Entregas</p>
                                                    </div>
                                                </div>

                                                {/* Bloque B — Chips de indicadores */}
                                                {(() => {
                                                    const consistencyColor =
                                                        learningSignals.consistencyLevel === 'high'   ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                        learningSignals.consistencyLevel === 'medium' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                                                                                        'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
                                                    const developColor =
                                                        learningSignals.writingDevelopmentLevel === 'solid'     ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                        learningSignals.writingDevelopmentLevel === 'developing' ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                                                                                                    'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-400';
                                                    const trendColor =
                                                        learningSignals.trend === 'improving'       ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' :
                                                        learningSignals.trend === 'stable'          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' :
                                                        learningSignals.trend === 'irregular'       ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' :
                                                                                                      'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
                                                    const consistencyLabel =
                                                        learningSignals.consistencyLevel === 'high'   ? 'Consistencia alta' :
                                                        learningSignals.consistencyLevel === 'medium' ? 'Consistencia media' : 'Consistencia baja';
                                                    const developLabel =
                                                        learningSignals.writingDevelopmentLevel === 'solid'     ? 'Elaboración sólida' :
                                                        learningSignals.writingDevelopmentLevel === 'developing' ? 'Elaboración en desarrollo' : 'Elaboración inicial';
                                                    const trendLabel =
                                                        learningSignals.trend === 'improving'      ? 'Tendencia: mejorando' :
                                                        learningSignals.trend === 'stable'         ? 'Tendencia: estable' :
                                                        learningSignals.trend === 'irregular'      ? 'Tendencia: irregular' :
                                                                                                     'Requiere atención';
                                                    return (
                                                        <div className="flex flex-wrap gap-1.5 mb-3">
                                                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${consistencyColor}`}>{consistencyLabel}</span>
                                                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${developColor}`}>{developLabel}</span>
                                                            <span className={`text-[10px] font-bold px-2 py-1 rounded-full ${trendColor}`}>{trendLabel}</span>
                                                        </div>
                                                    );
                                                })()}

                                                {/* Bloque C — Resumen docente */}
                                                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed mb-3 italic">
                                                    {learningSignals.summary}
                                                </p>

                                                {/* Bloque D — Evidencia */}
                                                <div className="text-[10px] text-gray-400 space-y-0.5 border-t border-gray-100 dark:border-gray-700 pt-2">
                                                    <p>Tareas asignadas: <span className="font-bold text-gray-500">{learningSignals.evidence.basedOnAssignments}</span></p>
                                                    <p>Tareas enviadas: <span className="font-bold text-gray-500">{learningSignals.evidence.basedOnSubmissions}</span></p>
                                                    <p>Total de palabras: <span className="font-bold text-gray-500">{learningSignals.totalWordCount.toLocaleString('es-ES')}</span></p>
                                                    {learningSignals.evidence.lastSubmissionAt && (
                                                        <p>Última entrega: <span className="font-bold text-gray-500">{new Date(learningSignals.evidence.lastSubmissionAt).toLocaleDateString('es-ES')}</span></p>
                                                    )}
                                                </div>
                                            </>
                                        )}
                                    </div>

                                    {/* ── Recomendaciones pedagógicas ── */}
                                    {recommendations && (
                                        <div className="mb-6">
                                            <h3 className="font-bold text-gray-500 uppercase text-xs mb-3 tracking-wider border-b pb-1 flex items-center gap-1.5">
                                                <Sparkles size={13} />
                                                Recomendaciones para la mediación
                                            </h3>

                                            {/* Titular */}
                                            <p className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-3 leading-snug">
                                                {recommendations.headline}
                                            </p>

                                            {/* Fortalezas */}
                                            {recommendations.strengths.length > 0 && (
                                                <div className="mb-3">
                                                    <p className="text-[10px] uppercase font-bold text-green-600 dark:text-green-400 tracking-wider mb-1.5">Fortalezas</p>
                                                    <div className="space-y-2">
                                                        {recommendations.strengths.map((rec, i) => (
                                                            <div key={i} className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800/40 rounded-lg p-2.5">
                                                                <p className="text-xs font-bold text-green-800 dark:text-green-300 mb-0.5">{rec.title}</p>
                                                                <p className="text-xs text-green-700 dark:text-green-400 leading-relaxed">{rec.description}</p>
                                                                <p className="text-[10px] text-green-500 dark:text-green-600 mt-1 italic">{rec.rationale}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Alertas */}
                                            {recommendations.alerts.length > 0 && (
                                                <div className="mb-3">
                                                    <p className="text-[10px] uppercase font-bold text-amber-600 dark:text-amber-400 tracking-wider mb-1.5">Alertas</p>
                                                    <div className="space-y-2">
                                                        {recommendations.alerts.map((rec, i) => (
                                                            <div key={i} className={`rounded-lg p-2.5 border ${
                                                                rec.priority === 'high'
                                                                    ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800/40'
                                                                    : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800/40'
                                                            }`}>
                                                                <p className={`text-xs font-bold mb-0.5 ${rec.priority === 'high' ? 'text-red-800 dark:text-red-300' : 'text-amber-800 dark:text-amber-300'}`}>{rec.title}</p>
                                                                <p className={`text-xs leading-relaxed ${rec.priority === 'high' ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>{rec.description}</p>
                                                                <p className={`text-[10px] mt-1 italic ${rec.priority === 'high' ? 'text-red-500 dark:text-red-600' : 'text-amber-500 dark:text-amber-600'}`}>{rec.rationale}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Acciones */}
                                            {recommendations.actions.length > 0 && (
                                                <div>
                                                    <p className="text-[10px] uppercase font-bold text-indigo-600 dark:text-indigo-400 tracking-wider mb-1.5">Acciones sugeridas</p>
                                                    <div className="space-y-2">
                                                        {recommendations.actions.map((rec, i) => (
                                                            <div key={i} className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-800/40 rounded-lg p-2.5">
                                                                <p className="text-xs font-bold text-indigo-800 dark:text-indigo-300 mb-0.5">{rec.title}</p>
                                                                <p className="text-xs text-indigo-700 dark:text-indigo-400 leading-relaxed">{rec.description}</p>
                                                                <p className="text-[10px] text-indigo-400 dark:text-indigo-600 mt-1 italic">{rec.rationale}</p>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* ── Leo sugiere ── */}
                                    {leoAdvisor && (() => {
                                        const goalLabels: Record<NonNullable<typeof leoAdvisor>['dominantGoal'], string> = {
                                            emotional:     'Motivación y vínculo',
                                            reading_habit: 'Hábito lector',
                                            writing:       'Expresión escrita',
                                            metacognitive: 'Auto-regulación',
                                            critical:      'Pensamiento crítico',
                                            inferential:   'Comprensión inferencial',
                                            literal:       'Comprensión literal',
                                            vocabulary:    'Vocabulario',
                                            fluency:       'Fluidez lectora',
                                        };
                                        const goalColors: Record<NonNullable<typeof leoAdvisor>['dominantGoal'], string> = {
                                            emotional:     'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400',
                                            reading_habit: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
                                            writing:       'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
                                            metacognitive: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400',
                                            critical:      'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
                                            inferential:   'bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400',
                                            literal:       'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
                                            vocabulary:    'bg-lime-100 text-lime-700 dark:bg-lime-900/30 dark:text-lime-400',
                                            fluency:       'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
                                        };
                                        const confidenceLabels = { low: 'confianza baja', medium: 'confianza media', high: 'confianza alta' };
                                        const confidenceColors = {
                                            low:    'text-gray-400 dark:text-gray-500',
                                            medium: 'text-yellow-500 dark:text-yellow-400',
                                            high:   'text-green-500 dark:text-green-400',
                                        };
                                        return (
                                            <div className="mb-6">
                                                {/* Header */}
                                                <h3 className="font-bold text-gray-500 uppercase text-xs mb-3 tracking-wider border-b pb-1 flex items-center gap-1.5">
                                                    <BrainCircuit size={13} />
                                                    Leo sugiere
                                                </h3>

                                                <div className="bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 border border-violet-200 dark:border-violet-800/50 rounded-xl p-4 space-y-3">

                                                    {/* A. Headline */}
                                                    <p className="text-sm font-semibold text-violet-900 dark:text-violet-200 leading-snug">
                                                        {leoAdvisor.headline}
                                                    </p>

                                                    {/* B. Teacher guidance */}
                                                    <p className="text-xs text-gray-700 dark:text-gray-300 leading-relaxed">
                                                        {leoAdvisor.teacherGuidance}
                                                    </p>

                                                    {/* C. Acción concreta */}
                                                    <div className="bg-white/70 dark:bg-white/5 rounded-lg p-2.5 border border-violet-100 dark:border-violet-800/30">
                                                        <p className="text-[10px] uppercase font-bold text-violet-500 dark:text-violet-400 tracking-wider mb-1">Acción inmediata</p>
                                                        <p className="text-xs text-gray-800 dark:text-gray-200 leading-relaxed">{leoAdvisor.shortTermAction}</p>
                                                    </div>

                                                    {/* D. Objetivo dominante + confianza */}
                                                    <div className="flex items-center justify-between flex-wrap gap-2">
                                                        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${goalColors[leoAdvisor.dominantGoal]}`}>
                                                            {goalLabels[leoAdvisor.dominantGoal]}
                                                        </span>
                                                        <span className={`text-[10px] font-medium ${confidenceColors[leoAdvisor.confidence]}`}>
                                                            {confidenceLabels[leoAdvisor.confidence]}
                                                        </span>
                                                    </div>

                                                    {/* E. Justificación (rationale) */}
                                                    <p className="text-[10px] text-gray-400 dark:text-gray-500 italic leading-relaxed border-t border-violet-100 dark:border-violet-800/30 pt-2">
                                                        {leoAdvisor.rationale}
                                                    </p>
                                                </div>
                                            </div>
                                        );
                                    })()}

                                    {/* AI Analysis */}
                                    <div className="bg-indigo-50 dark:bg-indigo-900/30 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800">
                                        <div className="flex justify-between items-center mb-2">
                                            <h3 className="font-bold text-indigo-800 dark:text-indigo-300 flex items-center">
                                                <BrainCircuit size={16} className="mr-2" /> Análisis Pedagógico IA
                                            </h3>
                                            {!aiReport && (
                                                <button
                                                    onClick={generateReport}
                                                    disabled={loadingReport}
                                                    className="text-xs bg-indigo-600 text-white px-3 py-1 rounded hover:bg-indigo-700 transition-colors disabled:opacity-50"
                                                >
                                                    {loadingReport ? 'Analizando...' : 'Generar Informe'}
                                                </button>
                                            )}
                                        </div>
                                        {aiReport ? (
                                            <div className="prose prose-sm dark:prose-invert max-h-60 overflow-y-auto text-sm leading-relaxed">
                                                <p className="whitespace-pre-wrap">{aiReport}</p>
                                            </div>
                                        ) : (
                                            <p className="text-xs text-gray-500 italic">Solicita a Gemini que analice la velocidad lectora, relecturas y comprensión para sugerir estrategias.</p>
                                        )}
                                    </div>

                                </div>
                            ) : (
                                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-8 flex flex-col items-center justify-center text-center h-64 text-gray-400 border border-gray-200 dark:border-gray-700 sticky top-24">
                                    <BarChart2 size={48} className="mb-4 opacity-20" />
                                    <p>Selecciona un estudiante de la lista para ver su análisis detallado.</p>
                                </div>
                            )}
                        </div>
                    </div>
                </>
            )}

            {/* Club Member Management Modal */}
            {showClubMemberModal && currentGroup?.type === 'club' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold flex items-center">
                                <Users className="mr-2 text-indigo-600" size={20} /> Miembros — 🎪 {currentGroup.name}
                            </h3>
                            <button onClick={() => setShowClubMemberModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"><X size={20} /></button>
                        </div>

                        <input
                            type="text"
                            placeholder="Buscar por nombre..."
                            value={memberSearchQuery}
                            onChange={e => setMemberSearchQuery(e.target.value)}
                            className="w-full mb-4 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-indigo-500"
                        />

                        {/* Current members */}
                        <div className="mb-5">
                            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Miembros actuales ({students.length})</p>
                            {students.length === 0 && (
                                <p className="text-sm text-gray-400 italic">Este club no tiene miembros aún.</p>
                            )}
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                                {students
                                    .filter(s => !memberSearchQuery || s.nombre_completo.toLowerCase().includes(memberSearchQuery.toLowerCase()))
                                    .map(s => (
                                        <div key={s.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                            <div className="flex items-center gap-2">
                                                {s.avatar_url && <img src={s.avatar_url} className="w-7 h-7 rounded-full" />}
                                                <span className="text-sm font-medium">{s.nombre_completo}</span>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveClubMember(s.id)}
                                                className="text-xs text-red-500 hover:text-red-700 font-bold px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                                            >
                                                Quitar
                                            </button>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>

                        {/* Available users to add */}
                        <div>
                            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Agregar estudiante</p>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                                {allSchoolUsers
                                    .filter(u => !students.find(s => s.id === u.id))
                                    .filter(u => !memberSearchQuery || u.nombre_completo.toLowerCase().includes(memberSearchQuery.toLowerCase()))
                                    .map(u => (
                                        <div key={u.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                            <div className="flex items-center gap-2">
                                                {u.avatar_url && <img src={u.avatar_url} className="w-7 h-7 rounded-full" />}
                                                <span className="text-sm font-medium">{u.nombre_completo}</span>
                                            </div>
                                            <button
                                                onClick={() => handleAddClubMember(u.id)}
                                                className="text-xs text-indigo-600 hover:text-indigo-800 font-bold px-2 py-1 rounded hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
                                            >
                                                + Agregar
                                            </button>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Club Content Management Modal */}
            {showClubContentModal && currentGroup?.type === 'club' && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-bold flex items-center">
                                <BookOpen className="mr-2 text-pink-600" size={20} /> Contenido — 🎪 {currentGroup.name}
                            </h3>
                            <button onClick={() => setShowClubContentModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"><X size={20} /></button>
                        </div>

                        <input
                            type="text"
                            placeholder="Buscar por título..."
                            value={contentSearchQuery}
                            onChange={e => setContentSearchQuery(e.target.value)}
                            className="w-full mb-4 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 outline-none focus:ring-2 focus:ring-pink-500"
                        />

                        {/* Contenido habilitado */}
                        <div className="mb-5">
                            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Contenido habilitado ({clubContentItems.length})</p>
                            {clubContentItems.length === 0 && (
                                <p className="text-sm text-gray-400 italic">Este club no tiene contenido habilitado aún.</p>
                            )}
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                                {clubContentItems
                                    .filter(c => !contentSearchQuery || c.titulo.toLowerCase().includes(contentSearchQuery.toLowerCase()))
                                    .map(c => (
                                        <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <BookOpen size={13} className="text-pink-400 flex-shrink-0" />
                                                <span className="text-sm font-medium truncate">{c.titulo}</span>
                                            </div>
                                            <button
                                                onClick={() => handleRemoveClubContent(c.id)}
                                                className="text-xs text-red-500 hover:text-red-700 font-bold px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
                                            >
                                                Quitar
                                            </button>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>

                        {/* Agregar contenido */}
                        <div>
                            <p className="text-xs font-bold uppercase text-gray-500 mb-2">Agregar contenido</p>
                            <div className="space-y-1 max-h-48 overflow-y-auto">
                                {catalog
                                    .filter(c => !clubContentIds.includes(c.id))
                                    .filter(c => !contentSearchQuery || c.titulo.toLowerCase().includes(contentSearchQuery.toLowerCase()))
                                    .map(c => (
                                        <div key={c.id} className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <BookOpen size={13} className="text-gray-400 flex-shrink-0" />
                                                <span className="text-sm font-medium truncate">{c.titulo}</span>
                                            </div>
                                            <button
                                                onClick={() => handleAddClubContent(c.id)}
                                                className="text-xs text-pink-600 hover:text-pink-800 font-bold px-2 py-1 rounded hover:bg-pink-50 dark:hover:bg-pink-900/20 transition-colors flex-shrink-0"
                                            >
                                                + Agregar
                                            </button>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Bundle Modal (Fase 7) */}
            {showBundleModal && currentGroup && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-2">
                            <h3 className="text-xl font-bold flex items-center">
                                <Package className="mr-2 text-amber-500" size={20} /> Experiencias sugeridas
                            </h3>
                            <button onClick={() => setShowBundleModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"><X size={20} /></button>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
                            Activar en: <span className="font-bold">{currentGroup.type === 'club' ? '🎪' : '🏫'} {currentGroup.name}</span>
                            <span className="ml-1 text-xs text-gray-400">— el contenido de la experiencia reemplazará el habilitado actualmente</span>
                        </p>
                        {activeBundle && (
                            <div className="mb-4 px-3 py-2 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 text-xs text-orange-700 dark:text-orange-400">
                                <span className="font-bold">Actualmente activa:</span> {activeBundle.name} — se reemplazará al activar otra
                            </div>
                        )}

                        {bundles.length === 0 ? (
                            <p className="text-sm text-gray-400 italic text-center py-8">No hay experiencias disponibles.</p>
                        ) : (
                            <div className="space-y-3">
                                {bundles.map(b => {
                                    const items = b.contentIds
                                        .map(id => catalog.find(c => c.id === id))
                                        .filter(Boolean) as typeof catalog;
                                    return (
                                        <div key={b.id} className="bg-gray-50 dark:bg-gray-800 rounded-xl p-4 border border-gray-200 dark:border-gray-700">
                                            <div className="flex justify-between items-start gap-3">
                                                <div className="min-w-0">
                                                    <p className="font-bold text-sm">{b.name}</p>
                                                    <p className="text-xs text-gray-500 mt-0.5">{b.shortDescription || b.description}</p>
                                                    {b.includes && b.includes.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-2">
                                                            {b.includes.map(inc => (
                                                                <span key={inc} className="px-1.5 py-0.5 text-[10px] bg-amber-100 text-amber-700 rounded dark:bg-amber-900/30 dark:text-amber-300">{inc}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                    {b.tags && b.tags.length > 0 && (
                                                        <div className="flex flex-wrap gap-1 mt-1">
                                                            {b.tags.map(t => (
                                                                <span key={t} className="px-1.5 py-0.5 text-[10px] bg-gray-200 text-gray-500 rounded dark:bg-gray-700 dark:text-gray-400">{t}</span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => handleApplyBundle(b.id)}
                                                    disabled={applyingBundleId !== null}
                                                    className="flex-shrink-0 px-3 py-1.5 bg-amber-500 text-white rounded-lg hover:bg-amber-600 text-sm font-bold transition-colors disabled:opacity-50"
                                                >
                                                    {applyingBundleId === b.id ? 'Activando…' : 'Activar'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Assignment Creation Modal */}
            {showAssignmentModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-xl font-bold flex items-center"><ClipboardList className="mr-2 text-indigo-600" /> Nueva Asignación</h3>
                            <button onClick={() => setShowAssignmentModal(false)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"><X size={20} /></button>
                        </div>

                        <form onSubmit={async (e) => {
                            e.preventDefault();
                            // Validate
                            if (!selectedGroup || !newAssignment.contentId || !newAssignment.dueDate) {
                                alert("Por favor completa todos los campos requeridos.");
                                return;
                            }

                            try {
                                const content = catalog.find(c => c.id === newAssignment.contentId);
                                
                                // Simulating async delay for robustness
                                const assignmentPayload = {
                                    groupId: selectedGroup,
                                    contentId: newAssignment.contentId,
                                    contentTitle: content?.titulo || 'Material Asignado',
                                    assignedDate: new Date().toISOString().split('T')[0],
                                    dueDate: newAssignment.dueDate,
                                    description: newAssignment.description
                                };

                                dataService.createAssignment(assignmentPayload);
                                
                                // Refresh list
                                setGroupAssignments(dataService.getAssignmentsByGroup(selectedGroup));
                                
                                // Reset and Close
                                setNewAssignment({ contentId: '', description: '', dueDate: '' });
                                setShowAssignmentModal(false);
                                alert('Tarea asignada correctamente.');

                            } catch (error) {
                                console.error("Error creating assignment", error);
                                alert("Hubo un error al crear la tarea. Intenta nuevamente.");
                            }
                        }} className="space-y-4">

                            {/* Context Selectors - Fully Editable */}
                            <div className='bg-gray-50 dark:bg-gray-800 p-4 rounded-lg border border-gray-200 dark:border-gray-700 mb-4 space-y-3'>
                                <div className="flex items-center mb-2">
                                    <Users size={18} className='text-indigo-500 mr-2'/> 
                                    <span className='font-bold text-sm uppercase text-gray-500'>Asignar a:</span>
                                </div>
                                
                                {isAdmin && schools.length > 0 && (
                                    <div>
                                        <label className="block text-xs font-bold text-gray-400 mb-1">Colegio / Institución</label>
                                        <select
                                            className="w-full p-2 text-sm rounded border bg-white dark:bg-gray-700 dark:border-gray-600"
                                            value={selectedSchool || ''}
                                            onChange={(e) => setSelectedSchool(e.target.value)}
                                        >
                                            {schools.map(s => <option key={s} value={s}>{s}</option>)}
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-xs font-bold text-gray-400 mb-1">Grupo</label>
                                    <select 
                                        required
                                        className="w-full p-2 text-sm rounded border bg-white dark:bg-gray-700 dark:border-gray-600 cursor-pointer"
                                        value={selectedGroup || ''}
                                        onChange={(e) => setSelectedGroup(e.target.value)}
                                    >
                                        <option value="">-- Seleccionar Grupo --</option>
                                        {groups.map(g => <option key={g.id} value={g.id}>{g.type === 'club' ? '🎪 ' : '🏫 '}{g.name}</option>)}
                                    </select>
                                </div>
                            </div>


                            <div>
                                <label className="block text-sm font-bold mb-1">Seleccionar Material</label>
                                <select
                                    required
                                    className="w-full p-2 rounded border dark:bg-gray-800 dark:border-gray-600"
                                    value={newAssignment.contentId}
                                    onChange={(e) => setNewAssignment({ ...newAssignment, contentId: e.target.value })}
                                >
                                    <option value="">-- Elegir libro o guía --</option>
                                    {catalog.map(c => (
                                        <option key={c.id} value={c.id}>{c.titulo} ({c.tipo})</option>
                                    ))}
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-bold mb-1">Instrucciones (Descripción)</label>
                                <textarea
                                    required
                                    rows={3}
                                    placeholder="Ej. Leer Capítulo 3 y enviar reseña sobre el autor."
                                    className="w-full p-2 rounded border dark:bg-gray-800 dark:border-gray-600"
                                    value={newAssignment.description}
                                    onChange={(e) => setNewAssignment({ ...newAssignment, description: e.target.value })}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold mb-1">Fecha de Entrega</label>
                                <input
                                    type="date"
                                    required
                                    className="w-full p-2 rounded border dark:bg-gray-800 dark:border-gray-600"
                                    value={newAssignment.dueDate}
                                    onChange={(e) => setNewAssignment({ ...newAssignment, dueDate: e.target.value })}
                                />
                            </div>

                            <div className="pt-4 flex justify-end gap-3">
                                <button type="button" onClick={() => setShowAssignmentModal(false)} className="px-4 py-2 text-gray-600 hover:bg-indigo-100 rounded">Cancelar</button>
                                <button type="submit" className="px-6 py-2 bg-indigo-600 text-white font-bold rounded hover:bg-indigo-700 shadow-lg transform active:scale-95 transition-all">
                                    Asignar Tarea
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            {/* Review Submission Modal for Teacher */}
            {showReviewModal && selectedAssignment && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-3xl h-[80vh] flex flex-col animate-in zoom-in-95">
                        <div className="p-6 border-b border-gray-200 dark:border-gray-700 flex justify-between items-center bg-indigo-50 dark:bg-indigo-900/20 rounded-t-xl">
                            <div>
                                <h3 className="text-xl font-bold text-indigo-700 dark:text-indigo-300 h-8 overflow-hidden">{selectedAssignment.contentTitle}</h3>
                                <p className="text-sm text-gray-500">Revisando entregas</p>
                            </div>
                            <div className="flex items-center gap-2">
                                {downloadError && (
                                    <span className="text-xs text-red-500 font-medium max-w-[160px] text-right leading-tight">
                                        {downloadError}
                                    </span>
                                )}
                                <button
                                    onClick={() => handleDownloadSubmissions(selectedAssignment.id)}
                                    disabled={downloadingTaskId === selectedAssignment.id}
                                    title="Descargar tareas finalizadas"
                                    className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-bold rounded-lg transition-colors shadow-sm"
                                >
                                    {downloadingTaskId === selectedAssignment.id
                                        ? <><Loader2 size={14} className="animate-spin" /> Descargando...</>
                                        : <><Download size={14} /> Descargar tareas finalizadas</>
                                    }
                                </button>
                                <button onClick={() => setShowReviewModal(false)} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full"><X size={24} /></button>
                            </div>
                        </div>

                        <div className="flex flex-1 overflow-hidden">
                            {/* Left: Student List */}
                            <div className="w-1/3 border-r border-gray-200 dark:border-gray-700 overflow-y-auto bg-gray-50 dark:bg-gray-800/50">
                                {(!selectedAssignment.studentSubmissions || selectedAssignment.studentSubmissions.length === 0) ? (
                                    <p className="p-6 text-center text-gray-500">Aún no hay entregas.</p>
                                ) : (
                                    selectedAssignment.studentSubmissions.map((sub, idx) => (
                                        <button
                                            key={idx}
                                            onClick={() => handleSelectSubmission(sub)}
                                            className={`w-full text-left p-4 border-b border-gray-100 dark:border-gray-700 hover:bg-white dark:hover:bg-gray-700 transition-colors ${gradingSubmission?.studentId === sub.studentId ? 'bg-white dark:bg-gray-700 border-l-4 border-l-indigo-500' : ''}`}
                                        >
                                            <p className="font-bold">{sub.studentName}</p>
                                            <div className="flex justify-between mt-1">
                                                <span className="text-xs text-gray-500">{new Date(sub.date).toLocaleDateString()}</span>
                                                {sub.status === 'graded' && <span className="text-xs text-green-600 font-bold">Calificado</span>}
                                            </div>
                                        </button>
                                    ))
                                )}
                            </div>

                            {/* Right: Submission Content */}
                            <div className="w-2/3 flex flex-col p-6 overflow-y-auto">
                                {gradingSubmission ? (
                                    <>
                                        <div className="mb-6 bg-gray-50 dark:bg-gray-800/80 p-4 rounded-lg border border-gray-100 dark:border-gray-600">
                                            <h4 className="text-xs font-bold uppercase text-gray-500 mb-2">Contenido de la Entrega</h4>
                                            <p className="whitespace-pre-wrap">{gradingSubmission.content}</p>
                                        </div>

                                        <div className="mt-auto space-y-4 border-t pt-4 dark:border-gray-700">
                                            <div>
                                                <label className="block text-sm font-bold mb-1">Calificación (1.0 - 5.0)</label>
                                                <input
                                                    type="number"
                                                    min="1"
                                                    max="5"
                                                    step="0.1"
                                                    className="w-full p-2 rounded border dark:bg-gray-700 dark:border-gray-600"
                                                    value={gradeValue}
                                                    onChange={(e) => setGradeValue(e.target.value)}
                                                />
                                            </div>
                                            <div>
                                                <label className="block text-sm font-bold mb-1">Retroalimentación para el estudiante</label>
                                                <textarea
                                                    rows={3}
                                                    className="w-full p-2 rounded border dark:bg-gray-700 dark:border-gray-600"
                                                    value={feedbackValue}
                                                    onChange={(e) => setFeedbackValue(e.target.value)}
                                                    placeholder="Escribe un comentario motivador..."
                                                />
                                            </div>
                                            <button
                                                onClick={handleSubmitGrade}
                                                className="w-full py-3 bg-green-600 text-white font-bold rounded-lg hover:bg-green-700 shadow-md transition-all"
                                            >
                                                Guardar Calificación
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-full text-gray-400">
                                        <Eye size={48} className="mb-4 opacity-50" />
                                        <p>Selecciona un estudiante para revisar.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <ClubFormModal
                isOpen={clubModalOpen}
                onClose={() => { setClubModalOpen(false); setEditingClub(null); }}
                club={editingClub}
                onSaved={() => {
                    const prevIds = new Set(groups.map(g => g.id));
                    const newGroups = isAdmin
                        ? dataService.getGroupsByColegio(selectedSchool || user?.colegio || '')
                        : dataService.getTeacherGroups(user!.id);
                    setGroups(newGroups);
                    setClubModalOpen(false);
                    setEditingClub(null);
                    const newGroup = newGroups.find(g => !prevIds.has(g.id));
                    if (newGroup) {
                        if ((newGroup as any).kind === 'open') {
                            navigate(`/clubs/${newGroup.id}`);
                        } else {
                            setSelectedGroup(newGroup.id);
                            setClubCreatedFeedback(newGroup.name);
                            setTimeout(() => setClubCreatedFeedback(null), 4000);
                        }
                    }
                }}
            />
        </div>
    );
};

export default AulaViva;
