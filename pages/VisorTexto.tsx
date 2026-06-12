
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Content, Assignment } from '../types';
import { getOfflineText, saveOfflineText } from '../utils/offlineTextCache';
import { getResumeToast } from '../utils/canonicalProgress';
import { ChevronLeft, Type, Volume2, VolumeX, Globe, Moon, Sun, Loader2, Ruler, Image as ImageIcon, X, Mic, RefreshCw, Settings, ChevronUp, ChevronDown, Minus, Plus, MessageCircle } from 'lucide-react';
import { generarMicroResumenRecordatorio } from '../services/geminiService';
import type { LeoSessionMemory } from '../services/geminiService';
import { dataService } from '../services/dataService';
import { resolveMediaUrl, uploadsUrl } from '../utils/mediaBaseUrl';
import { shouldTriggerLeo } from '../utils/leoTriggerEngine';
import type { LeoTriggerReason } from '../utils/leoTriggerEngine';
import { deriveInitialDifficulty } from '../utils/leoStage';
import { OralityModal } from '../components/OralityModal';
import { LeoCompanion } from '../components/LeoCompanion';
import Chatbot from '../components/Chatbot';
import * as analyticsService from '../services/analyticsService';
// Sprint Data Backbone — Fase 2: paridad de sesión vía /api/v1/events.
// Se ejecuta en paralelo a analyticsService.track legacy. NO reemplaza nada.
import { useBackboneReadingSession } from '../hooks/useBackboneReadingSession';
// Sprint Modo accesible (experiencia) — overlay opt-in que solo aparece
// cuando el contexto del Modo accesible está activo. Si no, render = null.
import { VisorTextoAccesibleOverlay } from '../components/accesible/VisorTextoAccesibleOverlay';
// CRR Fase 2 — bridge de observación. Default OFF; cuando QA activa
// localStorage 'READING_RUNTIME__guided=v2' abre una sesión paralela del CRR
// sin tocar TTS, audioRef ni el lifecycle existente. El TTS sigue siendo
// 100% manejado por VisorTexto (legacy) en esta fase.
import { useReadingRuntimeBridge } from '../hooks/useReadingRuntimeBridge';

// Cache de TTS legacy eliminada — /api/tts usa Cache-Control: 1h desde el servidor.
// El navegador evita re-generar el mismo texto sin necesidad de cache en memoria.

// B2: Local calculation of days remaining — no backend dependency.
// Returns a label and urgency level for the task banner in VisorTexto.
function calcDaysLeft(dueDate: string): { label: string; urgency: 'ok' | 'soon' | 'overdue' } {
    try {
        const due = new Date(dueDate);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        due.setHours(0, 0, 0, 0);
        const diff = Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diff < 0)  return { label: 'Vencida',   urgency: 'overdue' };
        if (diff === 0) return { label: 'Vence hoy', urgency: 'soon' };
        if (diff === 1) return { label: 'Mañana',    urgency: 'soon' };
        if (diff <= 3)  return { label: `${diff} días`, urgency: 'soon' };
        return { label: `${diff} días`, urgency: 'ok' };
    } catch {
        return { label: '—', urgency: 'ok' };
    }
}

const VisorTexto: React.FC<{ content: Content }> = ({ content }) => {
    const { user } = useAuth();
    const location = useLocation();
    const useNavigateTo = useNavigate();
    const queryParams = new URLSearchParams(location.search);
    const initialLang = queryParams.get('lang') === 'en' ? 'en' : (queryParams.get('lang') === 'pt' ? 'pt' : 'es');

    const [language, setLanguage] = useState<'es' | 'en' | 'pt'>(initialLang as any);

    // --- ACCESSIBILITY PREFERENCES — persisted to localStorage with 'vt_' prefix.
    // Lazy initializers run synchronously before first render: no flash, no layout shift.
    const [fontSize, setFontSize] = useState<number>(() => {
        try {
            const v = localStorage.getItem('vt_fontSize');
            const n = v ? parseInt(v, 10) : 18;
            return n >= 14 && n <= 32 ? n : 18;
        } catch { return 18; }
    });
    const [isDarkMode, setIsDarkMode] = useState<boolean>(() => {
        try { return localStorage.getItem('vt_darkMode') === 'true'; } catch { return false; }
    });
    // High-contrast: black bg + white text. Mutually exclusive with dark mode.
    const [isHighContrast, setIsHighContrast] = useState<boolean>(() => {
        try { return localStorage.getItem('vt_highContrast') === 'true'; } catch { return false; }
    });

    const [text, setText]       = useState<string>('');
    const [loading, setLoading] = useState(true);
    // UX-3B — error de carga discreto + token de retry. Antes, errores se
    // pintaban como "⚠️ ERROR DE CARGA…" dentro del propio article (texto
    // visible al lector como si fuera el libro). Ahora se separa: loadError
    // dispara una pantalla limpia con botón Reintentar.
    const [loadError, setLoadError] = useState<string | null>(null);
    const [retryNonce, setRetryNonce] = useState(0);
    const retryLoad = useCallback(() => setRetryNonce(n => n + 1), []);

    // B4: True when text was loaded from offline cache (network failed, cache hit).
    // Drives the "Modo sin conexión" banner so the student knows they're reading cached content.
    const [offlineMode, setOfflineMode] = useState(false);

    // B1: Active assignments for this content — loaded from dataService (localStorage-backed).
    // Works offline because dataService stores assignments in localStorage on every sync.
    const [activeTasks, setActiveTasks] = useState<Assignment[]>([]);
    const [showTaskPanel, setShowTaskPanel] = useState(true); // start expanded

    // Display Menu State
    const [isDisplayMenuOpen, setIsDisplayMenuOpen] = useState(false);

    // Accessibility State
    const [isDyslexicFont, setIsDyslexicFont] = useState<boolean>(() => {
        try { return localStorage.getItem('vt_dyslexicFont') === 'true'; } catch { return false; }
    });
    const [showRuler, setShowRuler] = useState<boolean>(() => {
        try { return localStorage.getItem('vt_showRuler') === 'true'; } catch { return false; }
    });
    const [mouseY, setMouseY] = useState(0);

    // TTS State
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioLoading, setAudioLoading] = useState(false);
    // Visible error feedback when TTS fails — auto-clears after 6s
    const [audioError, setAudioError] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Visualizer
    const [showGalleryVisualizer, setShowGalleryVisualizer] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const galleryImages = content.ilustraciones_url || [];

    // Orality Lab MVP
    const [showOralityModal, setShowOralityModal] = useState(false);

    // Leo Phase 5 MVP
    const [showLeoCompanion, setShowLeoCompanion] = useState(false);
    const [leoInitialMsg, setLeoInitialMsg] = useState<string | null>(null);
    const [leoTriggerReason, setLeoTriggerReason] = useState<LeoTriggerReason | null>(null);
    
    // --- LEO SESSION MEMORY ---
    const defaultLeoMemory = {
        recentAnchors: [],
        lastQuestionType: null,
        sessionReadingProgress: 0,
        difficultyLevel: user?.id ? deriveInitialDifficulty(dataService.getLeoReaderProfile(user.id)) : "medio" as const,
        pedagogicalStage: 'comprehension' as const,
        behavior: { pauses: 0, replays: 0 },
    };
    
    const [leoMemory, setLeoMemory] = useState<LeoSessionMemory>(() => {
        try {
            const stored = sessionStorage.getItem(`leo_session_${content?.id}`);
            return stored ? JSON.parse(stored) : defaultLeoMemory;
        } catch {
            return defaultLeoMemory;
        }
    });
    const [isMemoryLoaded, setIsMemoryLoaded] = useState(false);

    useEffect(() => {
        if (!user?.id || !content?.id) {
            setIsMemoryLoaded(true);
            return;
        }
        let isMounted = true;
        (async () => {
            const persisted = await dataService.getLeoMemory(user.id, content.id);
            if (isMounted && persisted) {
                setLeoMemory((prev: any) => ({ ...prev, ...persisted }));
                
                // --- B1.5: Trigger visible memory hint ---
                if (persisted.sessionReadingProgress > 5 || (persisted.recentAnchors && persisted.recentAnchors.length > 0)) {
                    setLeoTriggerReason('welcome_back');
                    setShowLeoWelcome(true);
                    setTimeout(() => { if (isMounted) setShowLeoWelcome(false); }, 6000);
                }
            }
            if (isMounted) setIsMemoryLoaded(true);
        })();
        return () => { isMounted = false; };
    }, [user?.id, content?.id]);

    // B1: Load active assignments for this content from local dataService.
    // getAssignmentsForStudent reads from localStorage (persistenceService) — works offline.
    // Runs whenever user or content changes so the panel is always in sync with local state.
    useEffect(() => {
        if (!user?.id) { setActiveTasks([]); return; }
        try {
            const all = dataService.getAssignmentsForStudent(user.id);
            setActiveTasks(all.filter(a => a.contentId === content.id));
        } catch {
            setActiveTasks([]); // dataService read failure is non-fatal
        }
    }, [user?.id, content.id]);

    const memorySaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        if (!isMemoryLoaded || !user) return;
        
        sessionStorage.setItem(`leo_session_${content.id}`, JSON.stringify(leoMemory));

        if (memorySaveTimeoutRef.current) clearTimeout(memorySaveTimeoutRef.current);
        memorySaveTimeoutRef.current = setTimeout(() => {
            dataService.updateLeoMemory(user.id, content.id, leoMemory);
        }, 2000);

        return () => {
            if (memorySaveTimeoutRef.current) clearTimeout(memorySaveTimeoutRef.current);
        };
    }, [leoMemory, content.id, isMemoryLoaded, user]);

    const [showLeoWelcome, setShowLeoWelcome] = useState(false);

    // D/E: Resume toast — shown once when text loads and we resume from saved progress (≥5%).
    const [resumeToast, setResumeToast] = useState<{ label: string; crossMode: boolean; fromRemote: boolean } | null>(null);
    const resumeToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // E: Stores whether the remote progress fetch adopted a newer server record.
    const fromRemoteProgressRef = useRef(false);

    // Sync State
    const [initialScrollSet, setInitialScrollSet] = useState(false);

    useEffect(() => {
        if (user) dataService.addToHistory(user.id, content.id);
        if (user) dataService.recordReaderOpen(user.id, content.id, 'texto');
        setLoading(true); setAudioUrl(null); setIsPlaying(false); setShowGalleryVisualizer(false);
        setOfflineMode(false); // reset on content/language change
        setInitialScrollSet(false);
        // C1: Reset audio position and cancel any in-flight legacy TTS request.
        // currentAudioIndex staying at e.g. 12 on a new content would play the wrong segment.
        // audioLoading staying true would show a stuck spinner on the new content.
        // [RS-DEBUG] traza para diagnostico — remover en cleanup
        setCurrentAudioIndex(0);
        setAudioLoading(false);
        legacyTtsGenRef.current += 1; // any pending generarAudioTTS call will see a stale genId
        sessionStartRef.current = Date.now(); // Reset session timer on content/user change
        analyticsSessionFiredRef.current = false;
        analyticsBlocksRef.current = 0;
        analyticsLastThresholdRef.current = 0;
        analyticsProgressRef.current = 0;

        const loadContent = async () => {
            try {
                let targetUrl = '';
                if (language === 'es') targetUrl = content.texto_plano_url || '';
                else if (language === 'en') targetUrl = content.texto_ingles_url || '';
                else if (language === 'pt') targetUrl = content.texto_portugues_url || '';

                console.log(`[Visor] Loading Content: ${content.titulo} (${language})`);

                // E: Kick off remote progress fetch in parallel with the text load.
                // If it resolves before setLoading(false), the scroll-resume effect sees the best data.
                const remoteProgressPromise = user
                    ? dataService.fetchAndMergeRemoteProgress(user.id, content.id).catch(() => false)
                    : Promise.resolve(false);

                if (targetUrl) {
                    try {
                        const response = await fetch(targetUrl);
                        if (response.ok) {
                            const textData = await response.text();
                            if (textData && !textData.trim().startsWith("<!DOCTYPE")) {
                                setText(textData);
                                // B3/B4: Cache the text for offline reading.
                                // Always overwrites the previous entry — 1-book-at-a-time design.
                                // Failure is silent (quota / private mode): the read session proceeds normally.
                                saveOfflineText({
                                    contentId: content.id,
                                    title: content.titulo,
                                    autor: content.autor,
                                    portada_url: content.portada_url,
                                    texto: textData,
                                    language,
                                    cachedAt: new Date().toISOString(),
                                });
                                // E: Wait for remote progress — ensures resume effect sees latest data.
                                fromRemoteProgressRef.current = await remoteProgressPromise;
                                setLoading(false);
                                return;
                            }
                        }
                    } catch (fetchErr) {
                        console.warn("[Visor] Network error fetching file:", fetchErr);
                    }
                }

                // B4: Network failed (or no URL configured) — try offline cache before showing error.
                // Only serves cache for the exact same language to avoid wrong-language reads.
                const offlineCached = getOfflineText(content.id, language);
                if (offlineCached) {
                    setText(offlineCached.texto);
                    setOfflineMode(true);
                    // E: Offline path — remote sync already failed (network down); mark as local-only.
                    fromRemoteProgressRef.current = false;
                    setLoading(false);
                    return;
                }

                // UX-3B — error de carga: pantalla limpia con Reintentar
                // en vez de "⚠️ ERROR DE CARGA…" pintado como texto del libro.
                setLoadError(
                    'No se pudo descargar el texto del libro. Verifica tu conexión e intenta de nuevo.',
                );
                setLoading(false);

            } catch (e) {
                console.error("Critical error loading content:", e);
                setLoadError('Error crítico cargando el contenido.');
                setLoading(false);
            }
        };

        // Reset del error al re-disparar la carga (retry o cambio de libro/idioma).
        setLoadError(null);
        loadContent();

        return () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }
    }, [content, language, user, retryNonce]);

    // [Removed] Orphaned recap effect (checkedRecap/setLeoRecapMessage never declared) — was a no-op / crash risk.

    // SYNC LOGIC: SCROLL
    useEffect(() => {
        if (!loading && text && user && !initialScrollSet) {
            const progress = dataService.getProgresoUsuarioLibro(user.id, content.id);
            if (progress && progress.porcentaje > 0) {
                // F: Priority order for scroll precision:
                // 1. viewportHint — full-precision float (e.g. 42.73%) saved by this visor
                // 2. anchor.value — rounded integer (e.g. 42%) — same-mode, from any device
                // 3. porcentaje — cross-mode fallback
                const cp = progress.canonicalProgress;
                const scrollPct = (cp?.viewportHint !== undefined && isFinite(cp.viewportHint))
                    ? cp.viewportHint
                    : (cp?.anchor?.type === 'text')
                        ? cp.anchor.value
                        : progress.porcentaje;

                // Resume logic
                setTimeout(() => {
                    const scrollTarget = (scrollPct / 100) * document.body.scrollHeight;
                    if (scrollTarget > 100) window.scrollTo({ top: scrollTarget, behavior: 'smooth' });
                }, 500); // Slight delay for render

                // D/E: Resume toast — tell the user where we're picking up from.
                const lastMode = progress.canonicalProgress?.lastInteractedMode ?? progress.last_device_mode;
                const fromRemote = fromRemoteProgressRef.current;
                fromRemoteProgressRef.current = false; // consume once
                const toast = getResumeToast(progress.porcentaje, lastMode, 'texto', fromRemote);
                if (toast) {
                    setResumeToast(toast);
                    if (resumeToastTimerRef.current) clearTimeout(resumeToastTimerRef.current);
                    resumeToastTimerRef.current = setTimeout(() => setResumeToast(null), 5000);
                }
            }
            setInitialScrollSet(true);
        }
    }, [loading, text, user, content.id, initialScrollSet]);

    // --- ANALYTICS: session_start ---
    // Emite session_start una sola vez cuando el texto está cargado y el usuario es válido.
    // El guard analyticsSessionFiredRef evita doble emisión si el efecto se vuelve a ejecutar.
    useEffect(() => {
        if (loading || !user?.id || !text || analyticsSessionFiredRef.current) return;
        analyticsSessionFiredRef.current = true;
        analyticsService.track({
            event: 'session_start',
            userId: user.id,
            contentId: content.id,
            timestamp: Date.now(),
            streak: 0,
            level: user.immersive_level ?? 1,
            sessionDuration: 0,
        });
    }, [loading, user?.id, content.id, text]);

    // Session timer ref for totalTimeMs accumulation
    const sessionStartRef = useRef<number>(Date.now());
    // Refs for Leo behavior tracking — persist across scroll/playback events
    const prevScrollPctRef = useRef<number>(0);
    const sentencesCountRef = useRef<number>(0);
    // Leo trigger engine refs
    const leoMemoryRef = useRef<LeoSessionMemory>(leoMemory);
    const showLeoCompanionRef = useRef(false);
    const isMemoryLoadedRef = useRef(false);      // guards against on-mount spurious triggers
    const prevMemoryProgressRef = useRef(0);      // checkpoint crossing: previous progress value
    const lastTriggerTimeRef = useRef<number>(0);
    const lastActivityTimeRef = useRef<number>(Date.now()); // tracks last scroll for retention
    const TRIGGER_COOLDOWN_MS = 5 * 60 * 1000;
    // C1: Generation counter — increments on content/language change to cancel stale legacy TTS.
    // Any in-flight `generarAudioTTS` call that completes after the counter advances is discarded.
    const legacyTtsGenRef = useRef<number>(0);

    // --- ANALYTICS REFS (ICDLI) ---
    const analyticsSessionFiredRef = useRef(false);  // guard: no duplicar session_start
    const analyticsBlocksRef = useRef(0);             // bloques completados en la sesión
    const analyticsLastThresholdRef = useRef(0);      // último umbral de 25% alcanzado
    const analyticsProgressRef = useRef(0);           // progreso actual para session_end

    // ─── BACKBONE v1: paridad de sesión ──────────────────────────────────────
    // Emite text.session_start / text.session_heartbeat / text.session_end
    // hacia /api/v1/events. Es un canal nuevo en paralelo a analyticsService.
    // Las refs de progreso ya existentes (analyticsProgressRef en 0..100,
    // sentencesCountRef) se leen vía getters — el hook usa ref pattern internamente
    // y no invalida sus effects cuando cambian.
    const backboneSession = useBackboneReadingSession({
        enabled:    !loading && !!user?.id && !!text,
        userId:     user?.id,
        contentId:  content.id,
        mode:       'text',
        getProgressFraction: () => (analyticsProgressRef.current ?? 0) / 100,
        getPayload: () => ({
            source:        'VisorTexto',
            language,
            sentenceCount: sentencesCountRef.current,
            offlineMode,
        }),
    });

    // Save Progress logic
    const saveProgress = () => {
        if (!user || loading) return;
        const scrollTop = window.scrollY;
        const docHeight = document.body.scrollHeight - window.innerHeight;
        if (docHeight <= 0) return;
        // F: Store precise float in viewportHint (e.g. 42.73) alongside the rounded integer in
        // anchor.value (e.g. 42). On resume, viewportHint drives the exact scroll target so we
        // don't land ~0.5% off due to rounding. Difference on a 10 000px doc: ~50px precision gain.
        const precisePct = Math.max(0, Math.min(100, (scrollTop / docHeight) * 100));
        const percentage = Math.round(precisePct);
        // Phase 3.3 payload format: userId, contentId, physicalPage, totalPages, sentenceIndex, mode
        // E: anchor type='text' stores the scroll percentage for same-mode precision.
        dataService.updateProgreso(
            user.id, content.id, percentage, 100, undefined, 'text',
            { lastMode: 'texto', elapsedMs: Date.now() - sessionStartRef.current },
            { type: 'text', value: percentage },
            precisePct  // F: viewportHint — full-precision scroll fraction
        );
    };

    // Track Scroll for Progress Saving (Debounced)
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const handleScroll = () => {
            // Only auto-save if user is logged in
            if (!user || loading) return;
            lastActivityTimeRef.current = Date.now(); // keep retention timer fresh

            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }

            saveTimeoutRef.current = setTimeout(() => {
                saveProgress();
                
                // Also update sessionReadingProgress + position in Leo memory
                const docHeight = document.body.scrollHeight - window.innerHeight;
                if (docHeight > 0) {
                    const prog = Math.max(0, Math.min(100, Math.round((window.scrollY / docHeight) * 100)));
                    const isBackward = prog < prevScrollPctRef.current - 5;
                    prevScrollPctRef.current = prog;
                    setLeoMemory((prev: any) => {
                        if (prev.sessionReadingProgress === prog && !isBackward) return prev;
                        // Simple pedagogical stage derivation
                        let newStage = prev.pedagogicalStage || 'comprehension';
                        const anchorsOpened = prev.recentAnchors?.length || 0;
                        if (prog >= 85) newStage = 'creation';
                        else if (prog >= 60 || anchorsOpened >= 5) newStage = 'reflection';
                        else if (prog >= 25 || anchorsOpened >= 2) newStage = 'interpretation';
                        const estimatedIdx = Math.floor((prog / 100) * sentencesCountRef.current);
                        return {
                            ...prev,
                            sessionReadingProgress: prog,
                            pedagogicalStage: newStage,
                            lastSentenceIndex: estimatedIdx,
                            lastReadAt: new Date().toISOString(),
                            ...(isBackward ? {
                                behavior: {
                                    pauses: prev.behavior?.pauses ?? 0,
                                    replays: (prev.behavior?.replays ?? 0) + 1,
                                },
                            } : {}),
                        };
                    });

                    // --- ANALYTICS: block_complete + progress tracking ---
                    // Un "bloque" = cruzar un umbral de 25% de scroll.
                    // Produce 4 eventos máximo por sesión (25, 50, 75, 100).
                    analyticsProgressRef.current = prog;
                    const BLOCK_THRESHOLDS = [25, 50, 75, 100] as const;
                    const nextThreshold = BLOCK_THRESHOLDS.find(
                        t => t > analyticsLastThresholdRef.current && prog >= t
                    );
                    if (nextThreshold && user?.id && analyticsSessionFiredRef.current) {
                        analyticsLastThresholdRef.current = nextThreshold;
                        analyticsBlocksRef.current += 1;
                        analyticsService.track({
                            event: 'block_complete',
                            userId: user.id,
                            contentId: content.id,
                            timestamp: Date.now(),
                            streak: 0,
                            level: user.immersive_level ?? 1,
                            sessionDuration: Date.now() - sessionStartRef.current,
                            blocksCompleted: analyticsBlocksRef.current,
                        });
                    }
                }
            }, 1000);
        };

        window.addEventListener('scroll', handleScroll);
        return () => {
            window.removeEventListener('scroll', handleScroll);
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            // --- ANALYTICS: session_end ---
            // Solo emite si la sesión fue iniciada para este contenido.
            if (user?.id && analyticsSessionFiredRef.current) {
                analyticsService.track({
                    event: 'session_end',
                    userId: user.id,
                    contentId: content.id,
                    timestamp: Date.now(),
                    streak: 0,
                    level: user.immersive_level ?? 1,
                    sessionDuration: Date.now() - sessionStartRef.current,
                    progressPercentage: analyticsProgressRef.current,
                    source: 'unmount',
                });
                analyticsService.flush();
            }
            dataService.forceFlush();
        };
    }, [user, content.id, loading]);

    // --- LEO TRIGGER ENGINE ---
    // Sync refs so closures inside intervals/effects are never stale.
    useEffect(() => { leoMemoryRef.current = leoMemory; }, [leoMemory]);
    useEffect(() => { showLeoCompanionRef.current = showLeoCompanion; }, [showLeoCompanion]);
    useEffect(() => { isMemoryLoadedRef.current = isMemoryLoaded; }, [isMemoryLoaded]);

    // Single fire path: cooldown + mutual-exclusion with open companion or welcome toast.
    const fireIntervention = useCallback((msg: string, reason: LeoTriggerReason) => {
        if (!isMemoryLoadedRef.current) return; // skip until hydration settles
        const now = Date.now();
        if (now - lastTriggerTimeRef.current < TRIGGER_COOLDOWN_MS) return;
        if (showLeoCompanionRef.current) return;
        lastTriggerTimeRef.current = now;
        setLeoInitialMsg(msg);
        setLeoTriggerReason(reason);
        setShowLeoCompanion(true);
        setShowLeoWelcome(false);
    }, []);

    // T1: Retention — reader has not scrolled for 45s
    useEffect(() => {
        const id = setInterval(() => {
            const inactivityMs = Date.now() - lastActivityTimeRef.current;
            const reason = shouldTriggerLeo({
                memory: {
                    sessionReadingProgress: leoMemoryRef.current.sessionReadingProgress,
                    behavior: leoMemoryRef.current.behavior,
                },
                currentIndex: 0,
                progress: leoMemoryRef.current.sessionReadingProgress,
                inactivityMs,
                isReturningUser: false,
            });
            if (reason === 'retention') {
                fireIntervention('Llevo un rato en la misma parte. ¿Hay alguna palabra o idea que te esté costando?', 'retention');
            }
        }, 15_000);
        return () => clearInterval(id);
    }, [fireIntervention]);

    // T2: Checkpoint — progress crosses 20/40/60/80.
    // Passes prevMemoryProgressRef as the "before" value so the engine detects the crossing,
    // then advances the ref to prevent re-firing on the same threshold.
    useEffect(() => {
        const prog = leoMemory.sessionReadingProgress;
        const prevProg = prevMemoryProgressRef.current;
        const reason = shouldTriggerLeo({
            memory: {
                sessionReadingProgress: prevProg,
                behavior: leoMemory.behavior,
            },
            currentIndex: 0,
            progress: prog,
            inactivityMs: 0,
            isReturningUser: false,
        });
        prevMemoryProgressRef.current = prog; // advance only after engine has seen prevProg
        if (reason !== 'checkpoint') return;
        const THRESHOLDS = [20, 40, 60, 80] as const;
        const crossed = THRESHOLDS.find(t => prevProg < t && prog >= t);
        if (!crossed) return;
        const msgs: Record<number, string> = {
            20: '¡Llevas un 20% del texto! ¿Qué está pasando en la historia hasta ahora?',
            40: 'Ya llevas casi la mitad. ¿Hay algo que te haya sorprendido o confundido?',
            60: 'Estás en la parte más intensa. ¿Quieres que hablemos de lo que está pasando?',
            80: '¡Casi terminas! ¿Cómo crees que va a acabar esto?',
        };
        fireIntervention(msgs[crossed], 'checkpoint');
    }, [leoMemory.sessionReadingProgress, fireIntervention]);

    // T3: Confusion — fires when backward scrolls (replays) or TTS pauses accumulate.
    // behavior is a new object reference only when pauses or replays actually change,
    // so scroll jitter (forward-only) never re-runs this effect.
    useEffect(() => {
        const reason = shouldTriggerLeo({
            memory: {
                sessionReadingProgress: leoMemoryRef.current.sessionReadingProgress,
                behavior: leoMemory.behavior,
            },
            currentIndex: 0,
            progress: leoMemoryRef.current.sessionReadingProgress,
            inactivityMs: 0,
            isReturningUser: false,
        });
        if (reason === 'confusion') {
            fireIntervention('Parece que volviste varias veces a esta parte. ¿Hay algo que no esté quedando claro? Puedo ayudarte a entenderlo.', 'confusion');
        }
    }, [leoMemory.behavior, fireIntervention]);

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => setMouseY(e.clientY);
        const handleTouchMove = (e: TouchEvent) => { if (e.touches.length > 0) setMouseY(e.touches[0].clientY); };
        if (showRuler) { window.addEventListener('mousemove', handleMouseMove); window.addEventListener('touchmove', handleTouchMove); }
        return () => { window.removeEventListener('mousemove', handleMouseMove); window.removeEventListener('touchmove', handleTouchMove); };
    }, [showRuler]);

    useEffect(() => {
        let interval: any;
        if (showGalleryVisualizer && isPlaying && galleryImages.length > 0) {
            interval = setInterval(() => setCurrentImageIndex(prev => (prev + 1) % galleryImages.length), 10000);
        }
        return () => clearInterval(interval);
    }, [showGalleryVisualizer, isPlaying, galleryImages]);

    // --- TTS & MANIFEST LOGIC ---
    const [manifest, setManifest] = useState<Record<string, any> | null>(null);
    const [currentAudioIndex, setCurrentAudioIndex] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState<number>(() => {
        try {
            const v = localStorage.getItem('vt_playbackSpeed');
            const n = v ? parseFloat(v) : 1.0;
            return n >= 0.75 && n <= 2.0 ? n : 1.0;
        } catch { return 1.0; }
    });

    // Update Leo memory position when TTS advances to a new segment (forward only)
    useEffect(() => {
        if (currentAudioIndex === 0) return; // skip initial state and end-of-manifest reset
        setLeoMemory((prev: any) => ({
            ...prev,
            lastSentenceIndex: currentAudioIndex,
            lastReadAt: new Date().toISOString(),
        }));
    }, [currentAudioIndex]);

    // Load Manifest
    useEffect(() => {
        const loadManifest = async () => {
            try {
                // Try fetching manifest for default/Turbo mode
                // Add timestamp to avoid caching issues during dev
                const response = await fetch(resolveMediaUrl(`/uploads/audio/${content.id}/manifest.json`) + `?t=${Date.now()}`);
                if (response.ok) {
                    const data = await response.json();
                    setManifest(data);
                    console.log("[VisorTexto] Audio Manifest Loaded (Turbo Mode)");
                }
            } catch (e) {
                console.warn("[VisorTexto] No manifest found, falling back to legacy.");
            }
        };
        loadManifest();
    }, [content.id]);

    // Reading-sync hotfix (2026-04-26): seed currentAudioIndex from saved progress
    // so that "Escuchar" resumes near the user's last position instead of restarting at 0.
    // Runs once when manifest + user + content are all available. Idempotent: only sets when
    // target > 0, never overwrites a non-zero index the user already moved to in this session.
    useEffect(() => {
        if (!manifest || !user?.id || !content?.id) return;
        const totalChunks = Object.keys(manifest).length;
        if (totalChunks <= 0) return;
        const prog = dataService.getProgresoUsuarioLibro(user.id, content.id);
        // [RS-DEBUG]
        if (!prog) return;
        // Preferred: canonicalProgress.globalPercentage. Fallback: legacy porcentaje.
        const pct = prog.canonicalProgress?.globalPercentage ?? prog.porcentaje ?? 0;
        if (pct <= 0) return;
        const target = Math.min(Math.floor((pct / 100) * totalChunks), totalChunks - 1);
        if (target > 0) {
            setCurrentAudioIndex(target);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [manifest, user?.id, content?.id]);

    // Speed Effect
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = playbackSpeed;
            audioRef.current.preservePitch = true;
        }
    }, [playbackSpeed]);

    // --- A1: Write accessibility preferences to localStorage whenever they change.
    // Lazy state initializers (above) read these on mount — no round-trip, no flash.
    // try/catch: setItem throws in Safari private mode (SecurityError) or on QuotaExceededError.
    // A failed write is silent — preferences revert to defaults next session but the visor keeps working.
    useEffect(() => {
        try {
            localStorage.setItem('vt_fontSize',       String(fontSize));
            localStorage.setItem('vt_darkMode',       String(isDarkMode));
            localStorage.setItem('vt_highContrast',   String(isHighContrast));
            localStorage.setItem('vt_dyslexicFont',   String(isDyslexicFont));
            localStorage.setItem('vt_showRuler',      String(showRuler));
            localStorage.setItem('vt_playbackSpeed',  String(playbackSpeed));
        } catch { /* Storage unavailable (private mode / quota exceeded) — preferences lost on reload but visor works */ }
    }, [fontSize, isDarkMode, isHighContrast, isDyslexicFont, showRuler, playbackSpeed]);

    // --- A5: Auto-clear audioError after 6s so the banner doesn't linger forever.
    useEffect(() => {
        if (!audioError) return;
        const t = setTimeout(() => setAudioError(null), 6000);
        return () => clearTimeout(t);
    }, [audioError]);

    // --- A5: Flush Leo memory on unmount so fast navigation never loses progress.
    // Uses leoMemoryRef (kept fresh by a sync effect above) to avoid stale closure.
    // memorySaveTimeoutRef is also cancelled here to avoid a race with the debounce.
    useEffect(() => {
        return () => {
            if (memorySaveTimeoutRef.current) clearTimeout(memorySaveTimeoutRef.current);
            if (user?.id && content?.id) {
                dataService.updateLeoMemory(user.id, content.id, leoMemoryRef.current);
            }
        };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const playNextSegment = () => {
        if (!manifest) return;
        const nextIndex = currentAudioIndex + 1;
        // [RS-DEBUG]
        if (manifest[nextIndex]) {
            setCurrentAudioIndex(nextIndex);
            playManifestAudio(nextIndex);
        } else {
            setIsPlaying(false);
            setCurrentAudioIndex(0);
        }
    };

    const playManifestAudio = (index: number) => {
        // [RS-DEBUG]
        if (!manifest || !manifest[index]) return;
        const entry = manifest[index];
        // Guard: malformed manifest entries (missing 'file') must not crash the player.
        if (!entry?.file || typeof entry.file !== 'string') {
            console.warn('[VisorTexto] Manifest entry missing or invalid file field at index', index);
            setAudioError('Archivo de audio no disponible en este punto. Intenta avanzar.');
            return;
        }
        // M3.1: uploadsUrl prefija con CDN si MEDIA_BASE_URL set, sino mantiene /uploads/.
        const url = uploadsUrl(entry.file);
        if (audioRef.current) {
            audioRef.current.src = url;
            audioRef.current.playbackRate = playbackSpeed;
            audioRef.current.play()
                .then(() => setIsPlaying(true))
                .catch(e => {
                    console.error('[VisorTexto] Manifest audio play error:', e);
                    setAudioError('No se pudo reproducir el audio. Intenta de nuevo.');
                    setIsPlaying(false);
                });
        }
    };

    const handleTTS = async () => {
        setAudioError(null);

        // C1: Guard — prevent double-press while a Gemini request is already in-flight.
        if (audioLoading) return;

        // C4: Guard — text not yet loaded. Don't fire TTS on empty or stale content.
        if (loading || !text.trim()) {
            setAudioError('El texto aún se está cargando. Espera un momento.');
            return;
        }

        if (isPlaying) {
            audioRef.current?.pause();
            setIsPlaying(false);
            setLeoMemory((prev: any) => ({
                ...prev,
                behavior: {
                    pauses: (prev.behavior?.pauses ?? 0) + 1,
                    replays: prev.behavior?.replays ?? 0,
                },
            }));
            return;
        }

        // OPTION A: TURBO (Manifest pre-generado).
        // C1: Only valid for Spanish — the server generates manifests from ES text only.
        // Non-ES languages fall through to the legacy path.
        if (manifest && Object.keys(manifest).length > 0 && language === 'es') {
            // JIT seed (2026-04-26 hotfix): si currentAudioIndex es 0 y hay progreso
            // guardado, calcular el indice correcto AL MOMENTO DEL CLICK. Esto es
            // inmune al reset de linea ~205 (content-load effect que re-fire si user
            // reference cambia en AuthContext).
            // Si el usuario navego manualmente (idx != 0), respetamos su navegacion.
            let idxToPlay = currentAudioIndex;
            if (idxToPlay === 0 && user?.id && content?.id) {
                const prog = dataService.getProgresoUsuarioLibro(user.id, content.id);
                const totalChunks = Object.keys(manifest).length;
                const pct = prog?.canonicalProgress?.globalPercentage ?? prog?.porcentaje ?? 0;
                if (pct > 0 && totalChunks > 0) {
                    idxToPlay = Math.min(Math.floor((pct / 100) * totalChunks), totalChunks - 1);
                    if (idxToPlay > 0) {
                        setCurrentAudioIndex(idxToPlay);
                    }
                }
            }
            playManifestAudio(idxToPlay);
            return;
        }

        // OPTION B: On-demand TTS via backend /api/tts (centralizado, sin API key en frontend).
        // Limitación intencional: solo los primeros 300 chars — modo preview.
        // El manifest (OPTION A) es el camino correcto para textos completos.
        setAudioLoading(true);
        // C1: Capture generation ID before the async wait.
        const genId = legacyTtsGenRef.current;
        try {
            const textToRead = text.substring(0, 300);
            if (!textToRead.trim()) {
                setAudioError('No hay texto disponible para leer.');
                return;
            }

            // Llamar a /api/tts — backend centralizado (OpenAI primary → Gemini fallback).
            // El servidor aplica Cache-Control: 1h; el navegador evita re-generar el mismo texto.
            const ttsRes = await fetch('/api/tts', {
                method:  'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-user-id':    user?.id ?? '',
                },
                body: JSON.stringify({ text: textToRead }),
            });

            // C1: Stale check
            if (legacyTtsGenRef.current !== genId) return;

            if (!ttsRes.ok) {
                setAudioError('No se pudo generar el audio. Verifica tu conexión e intenta de nuevo.');
                return;
            }

            const mp3Buffer = await ttsRes.arrayBuffer();
            if (legacyTtsGenRef.current !== genId) return;

            const blob = new Blob([mp3Buffer], { type: 'audio/mpeg' });
            // Revoke previous BlobURL antes de crear uno nuevo — previene acumulación.
            if (audioUrl) URL.revokeObjectURL(audioUrl);
            const url = URL.createObjectURL(blob);
            setAudioUrl(url);
            if (audioRef.current) {
                audioRef.current.src = url;
                audioRef.current.playbackRate = playbackSpeed;
                audioRef.current.play()
                    .then(() => setIsPlaying(true))
                    .catch(() => {
                        setAudioError('El navegador bloqueó la reproducción. Toca la pantalla e intenta de nuevo.');
                        setIsPlaying(false);
                    });
            }
        } catch (e) {
            if (legacyTtsGenRef.current !== genId) return; // stale: suppress error UI for old request
            console.error('[VisorTexto] Legacy TTS failed:', e);
            setAudioError('No se pudo reproducir el audio. Verifica tu conexión.');
        } finally {
            // C1: Only clear audioLoading if this is still the current generation.
            // If content changed, the effect already set audioLoading=false; don't re-set it here.
            if (legacyTtsGenRef.current === genId) setAudioLoading(false);
        }
    };

    const toggleGallery = () => {
        if (galleryImages.length > 0) setShowGalleryVisualizer(!showGalleryVisualizer);
        // L4: No alert — button is disabled when empty (see toolbar below)
    }

    // Derived sentences for Orality Lab — memoized: text only changes on content/language switch,
    // not on scroll or state changes. Avoids re-running the regex on every render.
    const sentences = useMemo(
        () => text ? (text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text.substring(0, 200)]) : [],
        [text]
    );
    const currentIndex = currentAudioIndex < sentences.length ? currentAudioIndex : 0;
    // Keep ref fresh so the scroll handler (stale closure) can read sentence count
    sentencesCountRef.current = sentences.length;

    // CRR Fase 2 — observation bridge (default OFF). Cuando el flag se
    // activa con localStorage 'READING_RUNTIME__guided=v2' abre una sesión
    // paralela del CRR. `enabled` se desactiva hasta que el texto esté
    // hidratado, para no spawnar/cerrar sesiones huérfanas durante la carga.
    // El TTS y el audioRef siguen 100% en el path legacy.
    useReadingRuntimeBridge({
        mode:         'guided',
        userId:       user?.id ?? null,
        contentId:    content.id,
        totalIndices: sentences.length,
        enabled:      !loading && !!text && sentences.length > 0,
    });

    const scrollUp = () => {
        window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
    };

    const scrollDown = () => {
        window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
    };

    return (
        <div className={`min-h-screen flex flex-col font-serif transition-colors duration-300 ${
            isHighContrast ? 'bg-black text-white' :
            isDarkMode     ? 'bg-gray-900 text-gray-300' :
                             'bg-[#fdfbf7] text-gray-900'
        }`}>

            {/* A2: Audio error banner — auto-dismisses after 6s, also manually closable.
                T3: HC variant uses yellow-on-black for maximum contrast (red-100 is unreadable on black). */}
            {audioError && (
                <div className={`sticky top-0 z-[60] flex items-center gap-2 px-4 py-2 text-sm font-medium border-b ${
                    isHighContrast
                        ? 'bg-yellow-400 text-black border-yellow-600'
                        : 'bg-red-100 text-red-800 border-red-200'
                }`} role="alert">
                    <span className="flex-1">{audioError}</span>
                    <button onClick={() => setAudioError(null)} className="p-1 rounded hover:bg-black/10" aria-label="Cerrar">×</button>
                </div>
            )}

            <header className={`sticky top-0 z-40 flex items-center justify-between p-3 backdrop-blur shadow-sm border-b ${
                isHighContrast
                    ? 'bg-black border-white/40'
                    : 'bg-white/95 dark:bg-gray-800/95 border-gray-200 dark:border-gray-700'
            }`}>
                <div className="flex items-center">
                    <button onClick={() => useNavigateTo(`/contenido/${content.id}`)} className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 mr-1 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Volver">
                        <ChevronLeft size={24} />
                    </button>
                    <h1 className="font-sans font-bold text-sm truncate max-w-[120px] sm:max-w-[300px]">{content.titulo}</h1>
                </div>

                <div className="flex items-center gap-1 mr-12 md:mr-0">
                    <button
                        onClick={handleTTS}
                        disabled={audioLoading}
                        className={`p-2 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center ${isPlaying ? 'bg-indigo-600 text-white' : 'hover:bg-gray-200 dark:hover:bg-gray-700 text-indigo-600 dark:text-indigo-400'}`}
                        title={
                            audioLoading ? 'Generando audio…' :
                            isPlaying    ? 'Pausar lectura' :
                            manifest && language === 'es' ? 'Leer en voz alta (libro completo)' :
                            'Leer en voz alta (vista previa — primeros 300 caracteres)'
                        }
                    >
                        {audioLoading ? <Loader2 size={24} className="animate-spin" /> : (isPlaying ? <VolumeX size={24} /> : <Volume2 size={24} />)}
                    </button>

                    {/* A4: Orality lab button — BETA badge indicates experimental status.
                        SpeechRecognition requires a microphone and, in Chrome Android, internet. */}
                    <button
                        onClick={() => setShowOralityModal(true)}
                        className="relative p-2 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900 dark:text-indigo-300"
                        title="Laboratorio de oralidad (Beta — requiere micrófono e internet)"
                    >
                        <Mic size={24} />
                        <span className="absolute -top-1 -right-1 bg-amber-400 text-amber-900 text-[8px] font-black leading-none px-1 py-0.5 rounded-full select-none">
                            BETA
                        </span>
                    </button>

                    <button
                        onClick={() => setIsDisplayMenuOpen(!isDisplayMenuOpen)}
                        className="p-2 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 min-w-[44px] min-h-[44px] flex items-center justify-center"
                        title="Ajustes de Lectura"
                    >
                        <Settings size={24} />
                    </button>
                </div>
            </header>

            {/* B4: Offline mode banner — shown only when text was loaded from cache, not on every offline visit */}
            {offlineMode && (
                <div className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold border-b ${
                    isHighContrast
                        ? 'bg-white text-black border-white/40'
                        : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/40'
                }`} role="status">
                    <span className="text-sm">📴</span>
                    <span className="flex-1">Leyendo en modo sin conexión — contenido descargado previamente</span>
                </div>
            )}

            {/* B1: Task panel — shows active assignments for this book, works offline */}
            {activeTasks.length > 0 && (
                <div className={`border-b ${
                    isHighContrast
                        ? 'bg-black border-white/30'
                        : 'bg-indigo-50 dark:bg-indigo-950/30 border-indigo-100 dark:border-indigo-900/50'
                }`}>
                    <button
                        className={`w-full flex items-center justify-between px-4 py-2 text-xs font-bold uppercase tracking-wide ${
                            isHighContrast ? 'text-white' : 'text-indigo-700 dark:text-indigo-300'
                        }`}
                        onClick={() => setShowTaskPanel(v => !v)}
                        aria-expanded={showTaskPanel}
                    >
                        <span>📋 {activeTasks.length === 1 ? 'Tarea asignada' : `${activeTasks.length} tareas asignadas`}</span>
                        <span className="text-lg leading-none">{showTaskPanel ? '▲' : '▼'}</span>
                    </button>

                    {showTaskPanel && (
                        <div className="px-4 pb-3 space-y-2">
                            {activeTasks.map(task => {
                                const dl = calcDaysLeft(task.dueDate);
                                return (
                                    <div
                                        key={task.id}
                                        className={`rounded-lg p-3 ${
                                            isHighContrast
                                                ? 'bg-white/10 border border-white/30'
                                                : 'bg-white dark:bg-gray-800 border border-indigo-100 dark:border-indigo-900/50 shadow-sm'
                                        }`}
                                    >
                                        <div className="flex items-start justify-between gap-2">
                                            <p className={`text-sm font-semibold leading-snug ${isHighContrast ? 'text-white' : 'text-gray-800 dark:text-gray-100'}`}>
                                                {task.description
                                                    ? task.description
                                                    : <em className={`font-normal ${isHighContrast ? 'text-gray-400' : 'text-gray-400'}`}>Sin instrucciones del mediador</em>
                                                }
                                            </p>
                                            <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded-full ${
                                                dl.urgency === 'overdue' ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' :
                                                dl.urgency === 'soon'    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' :
                                                                           'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                                            } ${isHighContrast ? '!bg-white !text-black' : ''}`}>
                                                {dl.label}
                                            </span>
                                        </div>
                                        <p className={`text-xs mt-1 ${isHighContrast ? 'text-gray-300' : 'text-gray-500 dark:text-gray-400'}`}>
                                            Fecha límite: {new Date(task.dueDate).toLocaleDateString('es', { day: 'numeric', month: 'long' })}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {isDisplayMenuOpen && (
                <div className={`fixed top-[60px] right-2 z-[70] rounded-xl shadow-2xl p-4 w-64 animate-in fade-in zoom-in-95 border ${isHighContrast ? 'bg-black border-white/40 text-white' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
                    <div className="space-y-4">
                        <div>
                            <p className={`text-xs font-bold uppercase mb-2 ${isHighContrast ? 'text-gray-300' : 'text-gray-500'}`}>Tamaño de Fuente</p>
                            <div className="flex justify-between items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                                <button onClick={() => setFontSize(s => Math.max(14, s - 2))} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex-1 text-center"><Type size={16} /></button>
                                <span className="text-sm font-mono">{fontSize}px</span>
                                <button onClick={() => setFontSize(s => Math.min(32, s + 2))} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex-1 text-center"><Type size={24} /></button>
                            </div>
                        </div>

                        {/* A3: Selector de 3 modos visuales — Claro / Oscuro / Alto Contraste.
                            Alto contraste: fondo negro + texto blanco para máxima legibilidad. */}
                        <div>
                            <p className={`text-xs font-bold uppercase mb-2 ${isHighContrast ? 'text-gray-300' : 'text-gray-500'}`}>Apariencia</p>
                            <div className="grid grid-cols-3 gap-1">
                                <button
                                    onClick={() => { setIsDarkMode(false); setIsHighContrast(false); }}
                                    className={`p-2 rounded text-xs font-bold border flex flex-col items-center gap-1 ${!isDarkMode && !isHighContrast ? 'bg-indigo-100 border-indigo-500 text-indigo-700' : 'border-gray-200 dark:border-gray-600'}`}
                                >
                                    <Sun size={14} />Claro
                                </button>
                                <button
                                    onClick={() => { setIsDarkMode(true); setIsHighContrast(false); }}
                                    className={`p-2 rounded text-xs font-bold border flex flex-col items-center gap-1 ${isDarkMode && !isHighContrast ? 'bg-indigo-100 border-indigo-500 text-indigo-700' : 'border-gray-200 dark:border-gray-600'}`}
                                >
                                    <Moon size={14} />Oscuro
                                </button>
                                <button
                                    onClick={() => { setIsDarkMode(false); setIsHighContrast(true); }}
                                    className={`p-2 rounded text-xs font-bold border flex flex-col items-center gap-1 ${isHighContrast ? 'bg-yellow-100 border-yellow-500 text-yellow-800' : 'border-gray-200 dark:border-gray-600'}`}
                                    title="Fondo negro + texto blanco — máxima legibilidad"
                                >
                                    <span className="text-base leading-none font-black">HC</span>Alto C.
                                </button>
                            </div>
                        </div>

                        <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                            <p className={`text-xs font-bold uppercase mb-2 ${isHighContrast ? 'text-gray-300' : 'text-gray-500'}`}>Idioma del Texto</p>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setLanguage('es')}
                                    disabled={!content.texto_plano_url}
                                    className={`flex-1 p-2 rounded text-xs font-bold border transition-colors ${language === 'es' ? 'bg-indigo-100 border-indigo-500 text-indigo-700' : 'border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'}`}
                                >
                                    ES
                                </button>
                                <button
                                    onClick={() => setLanguage('en')}
                                    disabled={!content.texto_ingles_url}
                                    className={`flex-1 p-2 rounded text-xs font-bold border transition-colors ${language === 'en' ? 'bg-indigo-100 border-indigo-500 text-indigo-700' : 'border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'} ${!content.texto_ingles_url ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    EN
                                </button>
                                <button
                                    onClick={() => setLanguage('pt')}
                                    disabled={!content.texto_portugues_url}
                                    className={`flex-1 p-2 rounded text-xs font-bold border transition-colors ${language === 'pt' ? 'bg-indigo-100 border-indigo-500 text-indigo-700' : 'border-gray-200 dark:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700'} ${!content.texto_portugues_url ? 'opacity-50 cursor-not-allowed' : ''}`}
                                >
                                    PT
                                </button>
                            </div>
                        </div>

                        <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                            <p className={`text-xs font-bold uppercase mb-2 ${isHighContrast ? 'text-gray-300' : 'text-gray-500'}`}>Accesibilidad</p>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setIsDyslexicFont(!isDyslexicFont)}
                                    className={`p-2 rounded text-xs font-bold border ${isDyslexicFont ? 'bg-indigo-100 border-indigo-500 text-indigo-700' : 'border-gray-200 dark:border-gray-600'}`}
                                >
                                    OpenDyslexic
                                </button>
                                <button
                                    onClick={() => setShowRuler(!showRuler)}
                                    className={`p-2 rounded text-xs font-bold border ${showRuler ? 'bg-indigo-100 border-indigo-500 text-indigo-700' : 'border-gray-200 dark:border-gray-600'}`}
                                    title="Banda de foco que sigue el cursor para guiar la lectura línea a línea"
                                >
                                    Guía de lectura
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                        <p className={`text-xs font-bold uppercase mb-2 ${isHighContrast ? 'text-gray-300' : 'text-gray-500'}`}>Velocidad de Voz</p>
                        <div className="flex items-center gap-2 bg-gray-100 dark:bg-gray-800 p-2 rounded-lg">
                            <button onClick={() => setPlaybackSpeed(s => Math.max(0.75, s - 0.25))} className="p-1 hover:bg-white dark:hover:bg-gray-600 rounded"><Minus size={16} /></button>
                            <span className="flex-1 text-center text-xs font-bold">{playbackSpeed}x</span>
                            <button onClick={() => setPlaybackSpeed(s => Math.min(2.0, s + 0.25))} className="p-1 hover:bg-white dark:hover:bg-gray-600 rounded"><Plus size={16} /></button>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                        <button
                            onClick={toggleGallery}
                            className={`w-full p-2 rounded text-xs font-bold flex items-center justify-center gap-2 ${showGalleryVisualizer ? 'bg-pink-100 text-pink-700 border border-pink-300' : 'bg-gray-100 dark:bg-gray-700'}`}
                        >
                            <ImageIcon size={16} /> Visualizador Galería
                        </button>
                    </div>
                </div>
            )}

            {/* SIDE FLOATING BUTTONS — T3: HC variant: white bg + black text for maximum contrast */}
            <button
                onClick={scrollUp}
                className={`fixed left-4 top-1/2 -translate-y-1/2 z-50 p-4 rounded-full shadow-xl transition-all opacity-70 hover:opacity-100 ${
                    isHighContrast
                        ? 'bg-white text-black hover:bg-yellow-300 border-2 border-white'
                        : 'bg-gray-200/90 dark:bg-gray-700/90 hover:bg-indigo-600 hover:text-white border border-gray-300 dark:border-gray-600'
                }`}
                aria-label="Retroceder texto"
            >
                <ChevronUp size={32} />
            </button>

            <button
                onClick={scrollDown}
                className={`fixed right-4 top-1/2 -translate-y-1/2 z-50 p-4 rounded-full shadow-xl transition-all opacity-70 hover:opacity-100 ${
                    isHighContrast
                        ? 'bg-white text-black hover:bg-yellow-300 border-2 border-white'
                        : 'bg-gray-200/90 dark:bg-gray-700/90 hover:bg-indigo-600 hover:text-white border border-gray-300 dark:border-gray-600'
                }`}
                aria-label="Avanzar texto"
            >
                <ChevronDown size={32} />
            </button>


            {
                showRuler && (
                    <div className="fixed inset-0 z-30 pointer-events-none overflow-hidden touch-none">
                        <div className="absolute top-0 left-0 right-0 bg-black/70 transition-all duration-75 ease-out" style={{ height: Math.max(0, mouseY - 60) }}></div>
                        <div className="absolute left-0 right-0 bg-black/70 transition-all duration-75 ease-out" style={{ top: mouseY + 60, bottom: 0 }}></div>
                        {/* T3: HC uses white border — indigo/30 is invisible on black background */}
                        <div className={`absolute left-0 right-0 border-t-2 border-b-2 transition-all duration-75 ease-out ${isHighContrast ? 'border-white/80' : 'border-indigo-500/30'}`} style={{ top: Math.max(0, mouseY - 60), height: 120 }}></div>
                    </div>
                )
            }

            {
                showGalleryVisualizer && galleryImages.length > 0 && (
                    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col items-center justify-center animate-in fade-in">
                        <button onClick={() => setShowGalleryVisualizer(false)} className="absolute top-4 right-4 p-3 bg-white/20 hover:bg-white/30 rounded-full text-white z-50"><X size={32} /></button>
                        <img key={currentImageIndex} src={galleryImages[currentImageIndex]} alt="" className="max-w-full max-h-[70vh] object-contain shadow-2xl rounded animate-in zoom-in-95 duration-1000" />
                        <div className="mt-8 text-white/70 text-center"><p className="text-sm mb-4">{content.titulo}</p></div>
                    </div>
                )
            }

            {
                showOralityModal && sentences.length > 0 && (
                    <OralityModal 
                        expectedText={sentences[currentIndex].trim()} 
                        onClose={() => setShowOralityModal(false)}
                        userId={user?.id}
                        contentId={content.id}
                    />
                )
            }

            <audio
                ref={audioRef}
                onEnded={() => {
                    if (manifest) playNextSegment();
                    else setIsPlaying(false);
                }}
                onPlay={() => setIsPlaying(true)}
                onPause={() => setIsPlaying(false)}
            />

            {
                showLeoCompanion && sentences.length > 0 && (
                    <LeoCompanion
                        contentId={content.id}
                        currentIndex={currentIndex}
                        exactSentence={sentences[currentIndex].trim()}
                        onClose={() => { setShowLeoCompanion(false); setLeoInitialMsg(null); setLeoTriggerReason(null); }}
                        sessionMemory={leoMemory}
                        difficultyLevel={leoMemory.difficultyLevel}
                        pedagogicalStage={leoMemory.pedagogicalStage}
                        onMemoryUpdate={(updates) => setLeoMemory((prev: any) => ({ ...prev, ...updates }))}
                        onNavigate={(idx) => { setCurrentAudioIndex(idx); playManifestAudio(idx); }}
                        initialMessage={leoInitialMsg}
                        triggerReason={leoTriggerReason}
                        hasAnchorAvailable={false}
                        hasAudioAvailable={audioUrl !== null}
                        isAudioPlaying={isPlaying}
                        onAction={(actionId) => {
                            console.log('[Leo] action:', actionId, '| trigger:', leoTriggerReason);
                            if (actionId === 'play_audio' && audioUrl && audioRef.current) {
                                setShowLeoCompanion(false);
                                setLeoInitialMsg(null);
                                setLeoTriggerReason(null);
                                audioRef.current.play().then(() => setIsPlaying(true)).catch(() => {});
                            } else if (actionId === 'play_audio') {
                                console.warn('[Leo] play_audio failed: no audio loaded yet');
                            }
                        }}
                    />
                )
            }

            {/* LEO WELCOME TOAST (Fase B1.5) */}
            {showLeoWelcome && !showLeoCompanion && (
                <div 
                    className="fixed bottom-24 right-6 z-50 bg-indigo-600/90 backdrop-blur-md text-white px-5 py-4 rounded-2xl shadow-2xl border border-indigo-400/30 animate-in slide-in-from-bottom-5 fade-in duration-500 max-w-xs cursor-pointer hover:bg-indigo-600 transition-colors" 
                    onClick={() => { setShowLeoWelcome(false); setShowLeoCompanion(true); if (isPlaying) { audioRef.current?.pause(); setIsPlaying(false); } /* leoTriggerReason already welcome_back from hydration */ }}
                >
                    <div className="flex gap-3 items-start">
                        <MessageCircle size={22} className="text-indigo-200 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-bold mb-1">¡Hola de nuevo!</p>
                            <p className="text-xs text-indigo-100 leading-tight">
                                Parece que te quedaste por aquí la última vez. ¿Continuamos la lectura o quieres recordar algo?
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* D: RESUME TOAST — shown once per open when progress ≥ 5% */}
            {resumeToast && (
                <div
                    className={`fixed bottom-24 left-6 z-50 px-4 py-3 rounded-2xl shadow-xl border animate-in slide-in-from-bottom-5 fade-in duration-400 max-w-xs flex items-center gap-3 ${
                        isHighContrast
                            ? 'bg-black text-white border-white/60'
                            : 'bg-white/95 dark:bg-gray-800/95 text-gray-800 dark:text-gray-100 border-gray-200 dark:border-gray-600 backdrop-blur-sm'
                    }`}
                    role="status"
                    aria-live="polite"
                >
                    <span className="text-lg shrink-0">📖</span>
                    <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold leading-snug">
                            {resumeToast.fromRemote
                                ? 'Actualizado desde otro dispositivo'
                                : resumeToast.crossMode
                                    ? 'Continuando desde otro modo'
                                    : 'Continuando donde lo dejaste'}
                        </p>
                        <p className="text-xs text-gray-500 dark:text-gray-400 leading-snug truncate">
                            Retomando desde {resumeToast.label}
                        </p>
                    </div>
                    <button
                        onClick={() => { if (resumeToastTimerRef.current) clearTimeout(resumeToastTimerRef.current); setResumeToast(null); }}
                        className="shrink-0 p-1 rounded-full hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                        aria-label="Cerrar"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* LEO FLOATING BUTTON */}
            {!showLeoCompanion && (
                <button
                    onClick={() => {
                        setShowLeoWelcome(false);
                        setLeoTriggerReason(null); // manual open — no trigger reason
                        setShowLeoCompanion(true);
                        if (isPlaying) { audioRef.current?.pause(); setIsPlaying(false); }
                    }}
                    className="fixed bottom-6 right-6 z-50 bg-indigo-600 hover:bg-indigo-700 text-white w-14 h-14 rounded-full shadow-2xl transition-transform transform hover:scale-110 flex items-center justify-center border-2 border-white dark:border-gray-800"
                    title="Pregúntale a Leo"
                >
                    <img src="/leo_character.png" alt="Leo" className="w-10 h-10 object-contain drop-shadow-md" onError={(e) => { e.currentTarget.style.display='none'; }} />
                </button>
            )}

            <main className="flex-1 max-w-3xl mx-auto w-full p-6 md:p-12 pb-32">
                {loading
                    ? <div className="flex justify-center py-20"><Loader2 size={40} className="animate-spin text-indigo-500" /></div>
                    : loadError
                        // UX-3B — pantalla de error con Reintentar. role="alert"
                        // para que AT lo anuncie. El botón llama retryLoad que
                        // re-dispara el effect de carga sin reload manual.
                        ? <div role="alert" className="py-12 text-center">
                            <h1 className="text-2xl font-bold mb-3 text-gray-900 dark:text-gray-100">
                                No se pudo cargar el libro
                            </h1>
                            <p className="text-gray-700 dark:text-gray-300 mb-6 max-w-md mx-auto">
                                {loadError}
                            </p>
                            <button
                                type="button"
                                onClick={retryLoad}
                                className="px-5 py-2 bg-indigo-600 text-white font-bold rounded-lg hover:bg-indigo-700 transition-colors shadow focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-700 focus-visible:outline-offset-2"
                            >
                                Reintentar
                            </button>
                          </div>
                        : <article
                            className={`prose max-w-none leading-relaxed whitespace-pre-wrap ${isDyslexicFont ? 'font-opendyslexic' : ''} ${isHighContrast ? '' : 'dark:prose-invert'}`}
                            style={{
                                fontSize: `${fontSize}px`,
                                // HC override: inline color wins over prose's cascaded text-gray-* colors
                                ...(isHighContrast ? { color: 'white', background: 'black' } : {}),
                            }}
                          >{text}</article>}
            </main>

            {/* Sprint Modo accesible (experiencia) — barra "Nivel de lectura"
                pixel, fija en la base de la ventana. Solo se renderiza cuando
                el contexto del Modo accesible está activo; si no, devuelve
                null y el visor queda exactamente igual que antes. */}
            <VisorTextoAccesibleOverlay />
        </div >
    );
};

export default VisorTexto;
