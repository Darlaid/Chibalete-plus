import React, { useState, useEffect, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import { analizarProgresoPedagogico } from '../services/geminiService';
import type { Group, User, PedagogicalStats, Assignment, Content, AssignmentSubmission, Bundle } from '../types';
import { Users, BookOpen, BrainCircuit, Clock, ChevronRight, BarChart2, Zap, Repeat, Timer, TrendingUp, ClipboardList, Plus, Calendar, Trash, FileText, X, Video, Image, Eye, EyeOff, Send, PenTool, MessageCircle, CheckCircle, Package, Sparkles } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

// Import extracted components
import { ProgressBar } from '../components/aula-viva/ProgressBar';
import { CompetencyBar } from '../components/aula-viva/CompetencyBar';
import { DistributionChart } from '../components/aula-viva/DistributionChart';
import { TrendChart } from '../components/aula-viva/TrendChart';
import { StudentRow } from '../components/aula-viva/StudentRow';

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
    const [selectedStudent, setSelectedStudent] = useState<User | null>(null);
    const [studentStats, setStudentStats] = useState<PedagogicalStats | undefined>(undefined);
    const [aiReport, setAiReport] = useState<string>('');
    const [loadingReport, setLoadingReport] = useState(false);
    const [activeTab, setActiveTab] = useState<'analytics' | 'tasks'>('analytics');

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

    // --- Bundle Management (Fase 7) ---
    const [showBundleModal, setShowBundleModal] = useState(false);
    const [bundles, setBundles] = useState<Bundle[]>([]);
    const [applyingBundleId, setApplyingBundleId] = useState<string | null>(null);
    const [activatedBundle, setActivatedBundle] = useState<Bundle | null>(null);
    const [replacedBundleName, setReplacedBundleName] = useState<string | null>(null);

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    const isTeacher = (user?.roles.includes('profesor') || user?.roles.includes('mediador') || user?.roles.includes('administrador')) && !isStudentViewMode;
    const isAdmin = user?.roles.includes('administrador');

    useEffect(() => {
        if (!user) return;

        // Logic for Teachers OR Admins in Student Mode (to allow context switching)
        const shouldLoadAdminContext = isAdmin; 
        const shouldLoadTeacherContext = isTeacher;

        if (shouldLoadTeacherContext || shouldLoadAdminContext) {
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
            } else if (isTeacher) {
                // Regular Teacher
                const teachersGroups = dataService.getTeacherGroups(user.id);
                setGroups(teachersGroups);
                if (teachersGroups.length > 0 && !selectedGroup) {
                    setSelectedGroup(teachersGroups[0].id);
                }
            }
        }

        // Student View Assignments Fetching
        if (!isTeacher) { // This means we are in Student View (real student or Admin toggled)
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
    }, [user, isTeacher, isAdmin, selectedSchool, selectedGroup]); // Added selectedGroup dependency to refresh student view content

    useEffect(() => {
        if (selectedGroup && isTeacher) {
            const groupStudents = dataService.getGroupStudents(selectedGroup);
            setStudents(groupStudents);
            setGroupAssignments(dataService.getAssignmentsByGroup(selectedGroup));
            setSelectedStudent(null);
            setCurrentPage(1);
        }
    }, [selectedGroup, isTeacher]);

    // --- Stats & Reports ---
    useEffect(() => {
        if (selectedStudent) {
            const stats = dataService.getPedagogicalStats(selectedStudent.id);
            setStudentStats(stats);
            setAiReport('');
        }
    }, [selectedStudent]);

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
    };

    const handleRemoveClubMember = (studentId: string) => {
        if (!selectedGroup) return;
        dataService.removeStudentFromGroup(selectedGroup, studentId);
        setStudents(dataService.getGroupStudents(selectedGroup));
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
    if (!isTeacher) {
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
                        {user?.roles.includes('administrador') && (
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
                    </div>
                </header>

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
            </div>

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

                    <div className="grid lg:grid-cols-3 gap-8">
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
                            {selectedStudent && studentStats ? (
                                <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg p-6 border border-gray-200 dark:border-gray-700 sticky top-24 animate-in slide-in-from-right-4">
                                    <div className="flex items-center mb-6">
                                        <img src={selectedStudent.avatar_url} className="w-16 h-16 rounded-full mr-4 shadow-md border-2 border-indigo-500" />
                                        <div>
                                            <h2 className="text-xl font-bold">{selectedStudent.nombre_completo}</h2>
                                            <p className="text-sm text-gray-500">{selectedStudent.email}</p>
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
                            <button onClick={() => setShowReviewModal(false)} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-full"><X size={24} /></button>
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
        </div>
    );
};

export default AulaViva;
