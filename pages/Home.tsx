
import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import { useUserClubs } from '../hooks/useUserClubs';
import ContentCarousel from '../components/ContentCarousel';
import ProgressUpdater from '../components/ProgressUpdater';
import CommunityPostCard from '../components/CommunityPostCard';
import type { Content, ProgresoLectura, User, CommunityPost, Assignment } from '../types';
import { MessageSquare, Heart, PenTool, ClipboardList, CheckCircle, Camera, Video, X, Upload, Check, Mic, StopCircle, Play, Square, Lightbulb, Calendar as CalendarIcon, ChevronLeft, ChevronRight, CheckSquare, Gift, BookOpen, Users, Plus, Zap } from 'lucide-react';
import QuickClubModal from '../components/QuickClubModal';

// Helper to handle local dates without timezone shifting
const toLocalISOString = (date: Date) => {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().split('T')[0];
};

const Home: React.FC = () => {
    const { user, accessReady } = useAuth();
    const navigate = useNavigate();

    // Club Activation — hook de clubes del usuario
    const { clubsWithContent } = useUserClubs(user);

    // Club Activation — banner de bienvenida post-login (one-shot desde sessionStorage)
    const [clubWelcome, setClubWelcome] = useState<{ clubName: string; contentCount: number } | null>(null);
    const [showClubBanner, setShowClubBanner] = useState(false);

    useEffect(() => {
        try {
            const raw = sessionStorage.getItem('chibalete_club_welcome');
            if (raw) {
                sessionStorage.removeItem('chibalete_club_welcome'); // limpiar inmediatamente
                const data = JSON.parse(raw);
                if (data?.clubName) {
                    setClubWelcome(data);
                    setShowClubBanner(true);
                }
            }
        } catch (_e) {
            // Best-effort
        }
    }, []);

    const [enProgreso, setEnProgreso] = useState<{ content: Content, progress: ProgresoLectura }[]>([]);
    const [nuevos, setNuevos] = useState<{ content: Content }[]>([]);
    const [recomendados, setRecomendados] = useState<{ content: Content }[]>([]);
    const [articulosPedagogicos, setArticulosPedagogicos] = useState<{ content: Content }[]>([]);

    // Assignments State
    const [assignments, setAssignments] = useState<Assignment[]>([]);
    const [filteredAssignments, setFilteredAssignments] = useState<Assignment[]>([]);
    const [selectedAssignment, setSelectedAssignment] = useState<Assignment | null>(null);
    const [submissionFile, setSubmissionFile] = useState<File | null>(null);
    const [submissionText, setSubmissionText] = useState('');
    const [submissionAudioUrl, setSubmissionAudioUrl] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Calendar State
    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [calendarView, setCalendarView] = useState<'week' | 'month'>('week');

    // Audio Recording Refs
    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);

    // Community Reviews State
    const [misPublicaciones, setMisPublicaciones] = useState<CommunityPost[]>([]);
    const [guardados, setGuardados] = useState<CommunityPost[]>([]);
    const [activeReviewTab, setActiveReviewTab] = useState<'mis_publicaciones' | 'guardados'>('mis_publicaciones');

    const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
    const [isQuickClubModalOpen, setIsQuickClubModalOpen] = useState(false);
    const [selectedContent, setSelectedContent] = useState<Content | null>(null);

    const fetchData = React.useCallback(() => {
        if (user && accessReady) {
            setEnProgreso(dataService.getContenidosEnProgreso(user.id, user.roles).map(item => ({ content: item.content, progress: item.progress })));
            setNuevos(dataService.getNuevosTitulos(user.roles).map(content => ({ content })));
            setRecomendados(dataService.getRecomendadosComunidad(user.roles).map(content => ({ content })));

            if (user.roles.includes('profesor') || user.roles.includes('mediador') || user.roles.includes('administrador')) {
                setArticulosPedagogicos(dataService.getArticulosPedagogicos().map(content => ({ content })));
            }

            // Fetch Assignments
            const userAssignments = dataService.getAssignmentsForStudent(user.id) || [];
            setAssignments(userAssignments);
            setFilteredAssignments(userAssignments);

            // Fetch community data
            setMisPublicaciones(dataService.getMisPublicaciones(user.id));
            setGuardados(dataService.getSavedPosts(user.id));
        }
    }, [user, accessReady]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    // Filter assignments when date is selected
    useEffect(() => {
        if (selectedDate) {
            const filtered = assignments.filter(a => a.dueDate === selectedDate);
            setFilteredAssignments(filtered);
        } else {
            setFilteredAssignments(assignments);
        }
    }, [selectedDate, assignments]);

    if (!user) {
        return null; // or a loading spinner
    }

    const handleOpenProgressModal = (content: Content) => {
        setSelectedContent(content);
        setIsProgressModalOpen(true);
    };

    const handleCloseProgressModal = (shouldRefresh: boolean) => {
        setIsProgressModalOpen(false);
        setSelectedContent(null);
        if (shouldRefresh) {
            fetchData(); // Refresh data after progress update
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorderRef.current = new MediaRecorder(stream);
            audioChunksRef.current = [];

            mediaRecorderRef.current.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunksRef.current.push(event.data);
                }
            };

            mediaRecorderRef.current.onstop = () => {
                const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
                const audioUrl = URL.createObjectURL(audioBlob);
                setSubmissionAudioUrl(audioUrl);
            };

            mediaRecorderRef.current.start();
            setIsRecording(true);
            setSubmissionAudioUrl(null); // Clear previous
        } catch (err) {
            console.error("Error accessing microphone:", err);
            alert("No se pudo acceder al micrófono.");
        }
    };

    const stopRecording = () => {
        if (mediaRecorderRef.current && isRecording) {
            mediaRecorderRef.current.stop();
            setIsRecording(false);
            mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
    };

    const handleAssignmentSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !selectedAssignment) return;

        setIsSubmitting(true);

        // Determine content based on type
        let contentToSubmit = "";
        if (selectedAssignment.submissionType === 'text') contentToSubmit = submissionText;
        else if (selectedAssignment.submissionType === 'audio') contentToSubmit = submissionAudioUrl || "";
        else contentToSubmit = submissionFile ? URL.createObjectURL(submissionFile) : "";

        // Simulate Upload
        setTimeout(() => {
            dataService.submitAssignment(
                selectedAssignment.id,
                user.id,
                contentToSubmit
            );

            setIsSubmitting(false);
            setSelectedAssignment(null);
            setSubmissionText('');
            setSubmissionFile(null);
            setSubmissionAudioUrl(null);
            alert('¡Tarea entregada con éxito!');
            fetchData(); // Refresh assignments list
        }, 1500);
    };

    const getGreeting = () => {
        const firstName = user.nombre_completo.split(' ')[0];
        if (user.roles.includes('administrador')) {
            return `Hola, ${firstName} Administrador`;
        }
        if (user.roles.includes('profesor') || user.roles.includes('mediador')) {
            return `Bienvenido, Profesor ${firstName}`;
        }
        return `Hola, ${firstName}`;
    };

    // --- CALENDAR LOGIC ---
    const getDaysInView = () => {
        const days = [];
        const start = new Date(currentDate);

        if (calendarView === 'week') {
            // Start from Monday of current week
            const day = start.getDay();
            const diff = start.getDate() - day + (day === 0 ? -6 : 1);
            start.setDate(diff);

            for (let i = 0; i < 7; i++) {
                const d = new Date(start);
                d.setDate(start.getDate() + i);
                days.push(d);
            }
        } else {
            // Month view
            start.setDate(1);
            const month = start.getMonth();
            while (start.getMonth() === month) {
                days.push(new Date(start));
                start.setDate(start.getDate() + 1);
            }
        }
        return days;
    };

    const hasAssignment = (date: Date) => {
        const dateStr = toLocalISOString(date);
        return assignments.some(a => a.dueDate === dateStr);
    };

    const isSelected = (date: Date) => {
        return selectedDate === toLocalISOString(date);
    };

    const isToday = (date: Date) => {
        const today = new Date();
        return date.getDate() === today.getDate() &&
            date.getMonth() === today.getMonth() &&
            date.getFullYear() === today.getFullYear();
    };

    const changeDateRange = (direction: 'prev' | 'next') => {
        const newDate = new Date(currentDate);
        if (calendarView === 'week') {
            newDate.setDate(newDate.getDate() + (direction === 'next' ? 7 : -7));
        } else {
            newDate.setMonth(newDate.getMonth() + (direction === 'next' ? 1 : -1));
        }
        setCurrentDate(newDate);
    };

    // Referencia al carrusel del club para scroll desde el banner
    const clubCarouselRef = useRef<HTMLDivElement>(null);

    return (
        <div className="w-full">
            <header className="p-4 md:p-8">
                <h1 className="text-3xl md:text-4xl font-bold text-gray-800 dark:text-gray-200">
                    {getGreeting()}
                </h1>
                <div className="mt-2 flex items-center gap-2 flex-wrap min-h-[24px]">
                    {(user.roles.includes('administrador') || user.roles.includes('profesor') || user.roles.includes('mediador')) && (
                        <div className="flex flex-wrap items-center gap-3">
                            <p className="text-md text-gray-500 dark:text-gray-400">Tus roles:</p>
                            {user.roles.map(role => (
                                <span key={role} className="px-3 py-1 text-xs font-semibold leading-tight text-indigo-700 bg-indigo-100 rounded-full dark:bg-indigo-900 dark:text-indigo-200">
                                    {role.charAt(0).toUpperCase() + role.slice(1)}
                                </span>
                            ))}
                            <button 
                                onClick={() => setIsQuickClubModalOpen(true)}
                                className="ml-2 flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-amber-500 to-orange-500 text-white font-black text-xs rounded-xl shadow-lg shadow-amber-500/20 hover:shadow-amber-500/40 hover:-translate-y-0.5 active:translate-y-0 transition-all"
                            >
                                <Zap size={14} className="fill-current" />
                                CREAR CLUB
                            </button>
                        </div>
                    )}
                </div>
            </header>

            {/* QUICK CLUB MODAL */}
            <QuickClubModal 
                isOpen={isQuickClubModalOpen} 
                onClose={() => setIsQuickClubModalOpen(false)} 
            />

            {/* ── CLUB ACTIVATION: Carrusel(s) de libros del club ── */}
            {clubsWithContent.length > 0 && (
                <div ref={clubCarouselRef} className="mb-2">
                    {clubsWithContent.map(({ club, content }) => (
                        <div key={club.id}>
                            {/* Etiqueta del club */}
                            <div className="px-4 md:px-8 pt-4 pb-1 flex items-center gap-2">
                                <Users size={18} className="text-indigo-500" />
                                <span className="text-xs font-bold uppercase tracking-wider text-indigo-500">
                                    Tu club
                                </span>
                                <span className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                                    · {club.name}
                                </span>
                            </div>
                            <ContentCarousel
                                title={`📖 ${club.name}`}
                                items={content.map(c => ({ content: c }))}
                            />
                        </div>
                    ))}
                </div>
            )}

            {/* ── CLUB ACTIVATION: Banner de bienvenida (one-shot post-login) ── */}
            {showClubBanner && clubWelcome && (
                <div className="mx-4 md:mx-8 mb-4 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-2xl shadow-lg overflow-hidden animate-in slide-in-from-top-2">
                    <div className="flex items-start justify-between p-4 md:p-5">
                        <div className="flex items-start gap-3">
                            <div className="text-3xl mt-0.5">📚</div>
                            <div>
                                <p className="font-bold text-lg leading-tight">Estás en: {clubWelcome.clubName}</p>
                                {clubWelcome.contentCount > 0 && (
                                    <p className="text-indigo-100 text-sm mt-0.5">
                                        {clubWelcome.contentCount} {clubWelcome.contentCount === 1 ? 'libro disponible' : 'libros disponibles'} para ti
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {clubsWithContent.length > 0 && (
                                <button
                                    onClick={() => clubCarouselRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                                    className="text-xs font-bold bg-white/20 hover:bg-white/30 text-white px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap"
                                >
                                    Ver libros
                                </button>
                            )}
                            <button
                                onClick={() => setShowClubBanner(false)}
                                className="p-1 hover:bg-white/20 rounded-full transition-colors"
                                aria-label="Cerrar"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* NOTIFICATIONS / ALERTS SYSTEM */}
            <div className="px-4 md:px-8 mb-6 space-y-3">

                {/* 1. ADMIN: Pending Reward Requests */}
                {user.roles.includes('administrador') && (() => {
                    const pendingRewards = dataService.getRewardRequests('submitted');
                    if (pendingRewards.length === 0) return null;
                    return (
                        <div className="bg-orange-50 dark:bg-orange-900/20 border-l-4 border-orange-500 p-4 rounded-r-lg flex justify-between items-center animate-in slide-in-from-top-2">
                            <div className="flex items-center text-orange-800 dark:text-orange-200">
                                <Gift className="mr-3" />
                                <div>
                                    <p className="font-bold">Solicitudes de Recompensa Pendientes</p>
                                    <p className="text-sm">Hay {pendingRewards.length} estudiantes esperando aprobación de cupones.</p>
                                </div>
                            </div>
                            <button onClick={() => navigate('/admin/recompensas')} className="px-4 py-2 bg-orange-100 dark:bg-orange-800 text-orange-700 dark:text-orange-100 font-bold rounded-lg text-sm hover:bg-orange-200 transition-colors">
                                Gestionar
                            </button>
                        </div>
                    );
                })()}

                {/* 2. STUDENT: New Assignments Alert */}
                {(() => {
                    // Simple logic: If there are assignments due in the future that are NOT submitted.
                    // In a real app we'd track "seen" status. For now, just show "Active Pending Tasks".
                    const pendingTasks = assignments.filter(a => {
                        const submitted = a.studentSubmissions?.find(s => s.studentId === user.id);
                        return !submitted;
                    });

                    if (pendingTasks.length === 0) return null;

                    return (
                        <div className="bg-indigo-50 dark:bg-indigo-900/20 border-l-4 border-indigo-500 p-4 rounded-r-lg flex justify-between items-center animate-in slide-in-from-top-2">
                            <div className="flex items-center text-indigo-800 dark:text-indigo-200">
                                <ClipboardList className="mr-3" />
                                <div>
                                    <p className="font-bold">¡Tienes tareas pendientes!</p>
                                    <p className="text-sm">{pendingTasks.length} actividades por entregar. ¡No pierdas la racha!</p>
                                </div>
                            </div>
                            <button onClick={() => {
                                // Scroll to tasks section
                                const element = document.getElementById('tasks-section');
                                if (element) element.scrollIntoView({ behavior: 'smooth' });
                            }} className="px-4 py-2 bg-indigo-100 dark:bg-indigo-800 text-indigo-700 dark:text-indigo-100 font-bold rounded-lg text-sm hover:bg-indigo-200 transition-colors">
                                Ver Tareas
                            </button>
                        </div>
                    );
                })()}

                {/* 3. NEW CONTENT NOTIFICATION (General) */}
                {nuevos.length > 0 && (
                    <div className="bg-green-50 dark:bg-green-900/20 border-l-4 border-green-500 p-4 rounded-r-lg flex justify-between items-center animate-in slide-in-from-top-4">
                        <div className="flex items-center text-green-800 dark:text-green-200">
                            <BookOpen className="mr-3" />
                            <div>
                                <p className="font-bold">Nuevo Contenido en la Biblioteca</p>
                                <p className="text-sm">Se han agregado {nuevos.length} nuevos títulos recientemente.</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* HIGH PRIORITY: Reading Progress (Moved Up) */}
            <ContentCarousel title="Estoy leyendo" items={enProgreso} onUpdateProgressClick={handleOpenProgressModal} />

            {/* Sección Mis Tareas Pendientes con Calendario (Always Visible) */}
            <section id="tasks-section" className="px-4 md:px-8 py-6">
                <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-200 flex items-center">
                    <ClipboardList className="mr-2 text-indigo-600" /> Mis Tareas
                </h2>

                {/* CALENDAR WIDGET */}
                <div className="bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm border border-gray-200 dark:border-gray-700 mb-6">
                    <div className="flex justify-between items-center mb-4">
                        <div className="flex items-center gap-2">
                            <button onClick={() => changeDateRange('prev')} className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full touch-manipulation"><ChevronLeft size={24} /></button>
                            <span className="font-bold text-lg capitalize px-2">
                                {currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}
                            </span>
                            <button onClick={() => changeDateRange('next')} className="p-3 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full touch-manipulation"><ChevronRight size={24} /></button>
                        </div>
                        <div className="flex bg-gray-100 dark:bg-gray-700 rounded-lg p-1 text-xs font-bold">
                            <button
                                onClick={() => setCalendarView('week')}
                                className={`px-3 py-1 rounded-md transition-colors ${calendarView === 'week' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600' : 'text-gray-500'}`}
                            >
                                Semana
                            </button>
                            <button
                                onClick={() => setCalendarView('month')}
                                className={`px-3 py-1 rounded-md transition-colors ${calendarView === 'month' ? 'bg-white dark:bg-gray-600 shadow text-indigo-600' : 'text-gray-500'}`}
                            >
                                Mes
                            </button>
                        </div>
                    </div>

                    <div className={`grid gap-2 ${calendarView === 'week' ? 'grid-cols-7' : 'grid-cols-7'} pb-2`}>
                        {getDaysInView().map((date, idx) => {
                            const hasTask = hasAssignment(date);
                            const active = isSelected(date);
                            const today = isToday(date);

                            return (
                                <button
                                    key={idx}
                                    onClick={() => setSelectedDate(active ? null : toLocalISOString(date))}
                                    className={`flex flex-col items-center justify-center h-[70px] rounded-2xl border transition-all ${active
                                        ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg scale-105'
                                        : today
                                            ? 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:border-indigo-800'
                                            : 'bg-transparent border-transparent hover:bg-gray-50 dark:hover:bg-gray-700'
                                        }`}
                                >
                                    <span className="text-[10px] font-bold uppercase">{date.toLocaleDateString('es-ES', { weekday: 'short' }).slice(0, 3)}</span>
                                    <span className="text-xl font-bold">{date.getDate()}</span>
                                    <div className={`w-1.5 h-1.5 rounded-full mt-1 transition-colors ${hasTask ? (active ? 'bg-white' : 'bg-red-500') : 'bg-transparent'}`}></div>
                                </button>
                            )
                        })}
                    </div>
                    {selectedDate && (
                        <div className="text-center mt-2">
                            <button onClick={() => setSelectedDate(null)} className="text-xs text-indigo-500 hover:underline">
                                Ver todas las tareas
                            </button>
                        </div>
                    )}
                </div>

                {/* LISTA DE TAREAS */}
                <div className="flex overflow-x-auto space-x-4 pb-4 scrollbar-hide min-h-[150px]">
                    {filteredAssignments.length > 0 ? (
                        filteredAssignments.map(assign => {
                            const mySubmission = assign.studentSubmissions?.find(s => s.studentId === user.id);
                            const hasSubmitted = !!mySubmission;
                            const isGraded = mySubmission?.status === 'graded';
                            const groupCtx = dataService.getAllGroups().find(g => g.id === assign.groupId);

                            return (
                                <div key={assign.id} className={`bg-white dark:bg-gray-800 p-5 rounded-xl shadow-md border min-w-[280px] md:min-w-[320px] flex flex-col ${hasSubmitted ? 'border-green-200 dark:border-green-900' : groupCtx?.type === 'club' ? 'border-pink-200 dark:border-pink-900' : 'border-gray-200 dark:border-gray-700'}`}>
                                    {groupCtx && (
                                        <div className="mb-2">
                                            <span className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${groupCtx.type === 'club' ? 'bg-pink-50 text-pink-600 border-pink-200 dark:bg-pink-900/30 dark:text-pink-400 dark:border-pink-800' : 'bg-blue-50 text-blue-600 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800'}`}>
                                                {groupCtx.type === 'club' ? '🎪 Club' : '🏫 Curso'} · {groupCtx.name}
                                            </span>
                                        </div>
                                    )}
                                    <div className="flex justify-between items-start mb-2">
                                        <span className="text-xs font-bold text-indigo-600 uppercase tracking-wide bg-indigo-50 dark:bg-indigo-900/30 px-2 py-1 rounded">
                                            {assign.submissionType === 'text' ? 'Texto' : assign.submissionType === 'photo' ? 'Foto' : assign.submissionType === 'video' ? 'Video' : 'Audio'}
                                        </span>
                                        <span className={`text-xs font-bold ${assign.dueDate === selectedDate ? 'text-red-500 bg-red-50 px-2 py-1 rounded' : 'text-gray-500'}`}>
                                            Vence: {assign.dueDate}
                                        </span>
                                    </div>
                                    <h3 className="font-bold text-lg mb-1">{assign.contentTitle}</h3>
                                    <p className="text-sm text-gray-600 dark:text-gray-300 mb-4 flex-grow line-clamp-2">{assign.description}</p>

                                    {hasSubmitted ? (
                                        <div className="mt-auto">
                                            <div className="flex items-center justify-center text-green-600 font-bold mb-2">
                                                <Check size={20} className="mr-1" /> Tarea Entregada
                                            </div>
                                            {isGraded && (
                                                <div className="bg-green-50 dark:bg-green-900/20 p-3 rounded text-sm">
                                                    <p className="font-bold text-green-800 dark:text-green-300">Calificación: {mySubmission.grade}/5.0</p>
                                                    {mySubmission.teacherFeedback && <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 italic">"{mySubmission.teacherFeedback}"</p>}
                                                </div>
                                            )}
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setSelectedAssignment(assign)}
                                            className="mt-auto w-full py-2 bg-indigo-600 text-white rounded-lg font-semibold hover:bg-indigo-700 transition-colors flex items-center justify-center"
                                        >
                                            <Upload size={16} className="mr-2" /> Entregar
                                        </button>
                                    )}
                                </div>
                            );
                        })
                    ) : (
                        <div className="w-full flex flex-col items-center justify-center text-gray-400 bg-gray-50 dark:bg-gray-800/50 rounded-xl border-2 border-dashed border-gray-200 dark:border-gray-700 p-6">
                            <CheckSquare size={32} className="mb-2 opacity-50" />
                            <p>No tienes tareas pendientes {selectedDate ? 'para esta fecha' : ''}.</p>
                        </div>
                    )}
                </div>
            </section>

            {/* Ideas y Reflexiones (Profesores/Admin Only) */}
            {(user.roles.includes('profesor') || user.roles.includes('mediador') || user.roles.includes('administrador')) && articulosPedagogicos.length > 0 && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-gray-800 dark:to-gray-900 py-2 my-6">
                    <div className="px-4 md:px-8 mb-2 flex items-center gap-2">
                        <Lightbulb className="text-yellow-500" />
                        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200">Ideas y Reflexiones: Actualización Docente</h2>
                    </div>
                    <ContentCarousel title="" items={articulosPedagogicos} />
                </div>
            )}

            <ContentCarousel title="Nuevos títulos" items={nuevos} />
            <ContentCarousel title="Recomiéndame algo" items={nuevos.slice().reverse()} />
            <ContentCarousel title="Más recomendados por la comunidad" items={recomendados} />

            {/* Sección Mis Reseñas */}
            <section className="py-8 px-4 md:px-8 bg-gray-50 dark:bg-gray-900/50 mt-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                    <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-200 flex items-center">
                        <MessageSquare className="mr-2 text-indigo-600" /> Mis Reseñas y Guardados
                    </h2>
                    <div className="flex bg-gray-200 dark:bg-gray-800 rounded-lg p-1 self-start md:self-auto">
                        <button
                            onClick={() => setActiveReviewTab('mis_publicaciones')}
                            className={`flex items-center px-4 py-2 rounded-md text-sm font-bold transition-colors ${activeReviewTab === 'mis_publicaciones' ? 'bg-white dark:bg-gray-700 shadow text-indigo-600 dark:text-indigo-300' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'}`}
                        >
                            <PenTool size={16} className="mr-2" /> Mis Publicaciones
                        </button>
                        <button
                            onClick={() => setActiveReviewTab('guardados')}
                            className={`flex items-center px-4 py-2 rounded-md text-sm font-bold transition-colors ${activeReviewTab === 'guardados' ? 'bg-white dark:bg-gray-700 shadow text-red-500 dark:text-red-400' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'}`}
                        >
                            <Heart size={16} className="mr-2" /> Favoritos
                        </button>
                    </div>
                </div>

                <div className="flex overflow-x-auto pb-4 space-x-4 scrollbar-hide">
                    {activeReviewTab === 'mis_publicaciones' ? (
                        misPublicaciones.length > 0 ? (
                            misPublicaciones.map(post => (
                                <div key={post.id} className="w-80 md:w-96 flex-shrink-0">
                                    <CommunityPostCard post={post} />
                                </div>
                            ))
                        ) : (
                            <div className="w-full text-center py-10 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                                <p className="text-gray-500">Aún no has publicado ninguna reseña.</p>
                                <p className="text-sm text-indigo-500 mt-2">Ve a la biblioteca y comparte tu opinión sobre un libro.</p>
                            </div>
                        )
                    ) : (
                        guardados.length > 0 ? (
                            guardados.map(post => (
                                <div key={post.id} className="w-80 md:w-96 flex-shrink-0">
                                    <CommunityPostCard post={post} />
                                </div>
                            ))
                        ) : (
                            <div className="w-full text-center py-10 bg-white dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-700">
                                <p className="text-gray-500">No tienes reseñas guardadas.</p>
                                <p className="text-sm text-gray-400 mt-2">Dale ❤️ a las reseñas de la comunidad para verlas aquí.</p>
                            </div>
                        )
                    )}
                </div>
            </section>

            {isProgressModalOpen && selectedContent && (
                <ProgressUpdater
                    content={selectedContent}
                    onClose={handleCloseProgressModal}
                />
            )}

            {/* Assignment Submission Modal */}
            {selectedAssignment && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                    <div className="bg-white dark:bg-gray-900 rounded-xl shadow-2xl w-full max-w-lg p-6 animate-in zoom-in-95">
                        <div className="flex justify-between items-center mb-4 border-b border-gray-100 dark:border-gray-800 pb-4">
                            <h3 className="text-xl font-bold">Entregar Tarea</h3>
                            <button onClick={() => setSelectedAssignment(null)} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full"><X size={20} /></button>
                        </div>

                        <div className="mb-6">
                            <h4 className="font-bold text-indigo-600 dark:text-indigo-400">{selectedAssignment.contentTitle}</h4>
                            <p className="text-gray-600 dark:text-gray-300 mt-1 text-sm bg-gray-50 dark:bg-gray-800 p-3 rounded-lg">{selectedAssignment.description}</p>
                        </div>

                        <form onSubmit={handleAssignmentSubmit}>
                            {selectedAssignment.submissionType === 'text' && (
                                <div className="mb-4">
                                    <label className="block text-sm font-bold mb-2">Tu Respuesta</label>
                                    <textarea
                                        className="w-full p-3 border rounded-lg dark:bg-gray-800 dark:border-gray-600 focus:ring-2 focus:ring-indigo-500"
                                        rows={5}
                                        placeholder="Escribe tu respuesta aquí..."
                                        value={submissionText}
                                        onChange={(e) => setSubmissionText(e.target.value)}
                                        required
                                    />
                                </div>
                            )}

                            {selectedAssignment.submissionType === 'photo' && (
                                <div className="mb-4">
                                    <label className="block text-sm font-bold mb-2">Subir Foto</label>
                                    <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer relative">
                                        <input
                                            type="file"
                                            accept="image/*"
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            onChange={(e) => setSubmissionFile(e.target.files?.[0] || null)}
                                            required
                                        />
                                        <Camera className="mx-auto text-gray-400 mb-2" size={32} />
                                        <p className="text-sm text-gray-500">{submissionFile ? submissionFile.name : 'Haz clic o arrastra una imagen'}</p>
                                    </div>
                                </div>
                            )}

                            {selectedAssignment.submissionType === 'video' && (
                                <div className="mb-4">
                                    <label className="block text-sm font-bold mb-2">Subir Video Corto</label>
                                    <div className="border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-8 text-center hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors cursor-pointer relative">
                                        <input
                                            type="file"
                                            accept="video/*"
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                            onChange={(e) => setSubmissionFile(e.target.files?.[0] || null)}
                                            required
                                        />
                                        <Video className="mx-auto text-gray-400 mb-2" size={32} />
                                        <p className="text-sm text-gray-500">{submissionFile ? submissionFile.name : 'Haz clic o arrastra un video'}</p>
                                    </div>
                                </div>
                            )}

                            {selectedAssignment.submissionType === 'audio' && (
                                <div className="mb-4">
                                    <label className="block text-sm font-bold mb-2">Grabar Respuesta de Voz</label>
                                    <div className="flex flex-col items-center justify-center p-6 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
                                        {!isRecording && !submissionAudioUrl && (
                                            <button
                                                type="button"
                                                onClick={startRecording}
                                                className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 text-white flex items-center justify-center shadow-lg transition-transform hover:scale-110"
                                            >
                                                <Mic size={32} />
                                            </button>
                                        )}

                                        {isRecording && (
                                            <div className="flex flex-col items-center">
                                                <div className="animate-pulse text-red-500 font-bold mb-4">Grabando...</div>
                                                <button
                                                    type="button"
                                                    onClick={stopRecording}
                                                    className="w-16 h-16 rounded-full bg-gray-800 text-white flex items-center justify-center hover:bg-black transition-colors"
                                                >
                                                    <Square size={24} className="fill-current" />
                                                </button>
                                            </div>
                                        )}

                                        {submissionAudioUrl && !isRecording && (
                                            <div className="w-full">
                                                <audio src={submissionAudioUrl} controls className="w-full mb-4" />
                                                <button
                                                    type="button"
                                                    onClick={() => setSubmissionAudioUrl(null)}
                                                    className="text-sm text-red-500 hover:underline mx-auto block"
                                                >
                                                    Borrar y grabar de nuevo
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isSubmitting || (selectedAssignment.submissionType === 'audio' && !submissionAudioUrl)}
                                className="w-full py-3 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors flex justify-center items-center"
                            >
                                {isSubmitting ? 'Enviando...' : 'Confirmar Entrega'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default Home;
