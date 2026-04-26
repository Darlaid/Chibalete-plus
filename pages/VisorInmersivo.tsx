import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Content } from '../types';
import { ChevronLeft, Play, Pause, Zap, Clock, Award, SkipForward, Minus, Plus, Infinity as InfinityIcon, Battery, RotateCcw, Settings, Type, AlignLeft, Sun, Moon, MessageCircle, X } from 'lucide-react';
import type { LeoSessionMemory as BaseLeoSessionMemory } from '../services/geminiService';
import { useImmersivePlayback } from '../hooks/useImmersivePlayback';
import { dataService } from '../services/dataService';
import type { PedagogicalStage, LeoReaderProfile } from '../types';
import { LeoCompanion } from '../components/LeoCompanion';
import ImmersiveShell from '../components/ImmersiveShell';
import { StartupEngine } from '../engines/StartupEngine';
import type { ContextualAnchor } from '../engines/StartupEngine';
import { BlockEngine } from '../engines/BlockEngine';
import { RewardEngine } from '../engines/RewardEngine';
import { TranceEngine } from '../engines/TranceEngine';
import { getNextContent, preloadContentText } from '../engines/ContentQueue';
import * as analyticsService from '../services/analyticsService';
import { useRewardFeedback } from '../hooks/useRewardFeedback';
import RewardToasts from '../components/RewardToasts';
import { shouldTriggerLeo } from '../utils/leoTriggerEngine';
import type { LeoTriggerReason } from '../utils/leoTriggerEngine';
import { derivePedagogicalStage, deriveInitialDifficulty } from '../utils/leoStage';
import { getResumeToast } from '../utils/canonicalProgress';

// --- CONFIGURATION ---
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2.0];
const PREFETCH_WINDOW = 5;

const LEVELS = {
    1: { duration: 40, label: "Nivel 1: Novato" },
    2: { duration: 180, label: "Nivel 2: Aprendiz" },
    3: { duration: 300, label: "Nivel 3: Explorador" },
    4: { duration: 1200, label: "Nivel 4: Maestro" },
    5: { duration: Infinity, label: "Nivel 5: Leyenda" }
};


// ContextualAnchor is defined in and imported from engines/StartupEngine.ts

// Stricter local variant of the shared LeoSessionMemory: operational fields that
// VisorInmersivo always initialises at startup are required here, so no null-guards
// are needed at call sites. Derived from the shared type so new shared fields
// propagate automatically.
type LeoSessionMemory = Omit<BaseLeoSessionMemory, 'recentAnchors' | 'difficultyLevel' | 'pedagogicalStage' | 'lastQuestionType'> & {
    recentAnchors: number[];
    lastQuestionType: 'vocab' | 'inferential' | 'reflection' | null;
    difficultyLevel: 'inicial' | 'medio' | 'avanzado';
    pedagogicalStage: PedagogicalStage;
};


const ANCHOR_TYPE_PRIORITY: Record<LeoSessionMemory['difficultyLevel'], string[]> = {
    inicial:  ['vocabulary', 'friction_support', 'insight'],
    medio:    ['vocabulary', 'insight', 'reflexion'],
    avanzado: ['reflexion', 'insight', 'vocabulary'],
};

function selectBestAnchor(
    candidates: ContextualAnchor[],
    difficulty: LeoSessionMemory['difficultyLevel']
): ContextualAnchor | undefined {
    if (!candidates || candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0];
    const priority = ANCHOR_TYPE_PRIORITY[difficulty] ?? ANCHOR_TYPE_PRIORITY['medio'];
    for (const preferredType of priority) {
        const match = candidates.find(a => a.type === preferredType);
        if (match) return match;
    }
    return candidates[0];
}

const VisorInmersivo: React.FC<{ content: Content }> = ({ content }) => {
    const { user } = useAuth();
    const navigate = useNavigate();

    // -----------------------------------------------------------------------
    // PHASE 0: STATE — all initialized with no async dependencies
    // UI renders immediately with these values, then hydrates progressively.
    // -----------------------------------------------------------------------

    // Placeholder sentence so teleprompter is never empty on first render
    const [sentences, setSentences] = useState<string[]>([content.titulo || 'Preparando tu lectura...']);
    const [audioSentences, setAudioSentences] = useState<string[]>([content.titulo || '']);
    const [isHydrating, setIsHydrating] = useState(true); // non-blocking indicator

    // Background access check — never blocks rendering
    const [accessDenied, setAccessDenied] = useState(false);
    const [accessDenyReason, setAccessDenyReason] = useState<string>('');

    // Playback speed — state para la UI del selector, ref para el hook
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const speedRef = useRef(playbackSpeed);

    // Level / Timer
    const [currentLevel, setCurrentLevel] = useState<number>(user?.immersive_level || 1);
    const [timeLeft, setTimeLeft] = useState(LEVELS[currentLevel as keyof typeof LEVELS].duration);
    const [sessionComplete, setSessionComplete] = useState(false);

    // BlockEngine — instantiated once per content session via ref.
    // React never controls the timer; it only observes engine events.
    const blockEngineRef = useRef<BlockEngine | null>(null);
    if (!blockEngineRef.current) {
        blockEngineRef.current = new BlockEngine();
    }
    // Block duration in ms, derived from level. Infinity = Level 5 (no timer).
    const blockDurationMsRef = useRef<number>(
        (() => {
            const dur = LEVELS[(user?.immersive_level || 1) as keyof typeof LEVELS].duration;
            return dur === Infinity ? Infinity : dur * 1000;
        })()
    );

    // RewardEngine — subscribes to BlockEngine internally. Instantiated once.
    // blockEngineRef must already be initialized at this point (declared above).
    const rewardEngineRef = useRef<RewardEngine | null>(null);
    if (!rewardEngineRef.current) {
        rewardEngineRef.current = new RewardEngine(blockEngineRef.current!, user?.id);
    }

    // TranceEngine — subscribes to RewardEngine, drives gradual UI fade.
    const tranceEngineRef = useRef<TranceEngine | null>(null);
    if (!tranceEngineRef.current) {
        tranceEngineRef.current = new TranceEngine(rewardEngineRef.current!);
    }

    // Trance intensity (0–1): drives opacity of chrome elements in the render.
    // Updated by TranceEngine subscription below.
    const [tranceIntensity, setTranceIntensity] = useState(0);

    // ContentQueue — next content to seamlessly transition into.
    // Populated in background after enough sentences load.
    const nextContentRef = useRef<Content | null>(null);

    // Brief dark overlay shown while state resets between contents.
    const [isTransitioning, setIsTransitioning] = useState(false);
    // Ref prevents double-trigger when block-complete and audio-end fire simultaneously.
    const transitionFiredRef = useRef(false);
    // When true, post-hydration plays immediately (set by transition, cleared after use).
    const autoPlayAfterTransitionRef = useRef(false);
    // Guards the content-change reset from running on the initial mount.
    const isFirstContentRenderRef = useRef(true);

    // Analytics — render-time refs stay fresh inside any closure ([] dep effects, callbacks).
    const analyticsUserIdRef = useRef(user?.id ?? 'guest');
    analyticsUserIdRef.current = user?.id ?? 'guest';
    const analyticsContentIdRef = useRef(content.id);
    analyticsContentIdRef.current = content.id;
    const analyticsPrevStreakRef = useRef(0); // for streak_break detection

    // ── Refs para el hook de playback ────────────────────────────────────────
    // Declarados aquí (antes de Leo state) para que pb pueda ser la fuente
    // canónica de currentIndex desde el inicio del componente.
    const manifest        = useRef<Record<string, { file: string, index: number }> | null>(null);
    const sentenceToChunk = useRef<number[]>([]);
    const unmounted       = useRef(false);
    const sentencesRef      = useRef<string[]>(sentences);
    const audioSentencesRef = useRef<string[]>(audioSentences);
    const onIndexChangeRef = useRef<(idx: number) => void>(() => {});
    const onSessionEndRef  = useRef<() => void>(() => {});
    const onPlayChangeRef  = useRef<(playing: boolean) => void>(() => {});

    // Render-time ref updates — frescos en cada render antes de cualquier call
    sentencesRef.current      = sentences;
    audioSentencesRef.current = audioSentences;
    speedRef.current          = playbackSpeed;

    // Callbacks del hook — actualizados en cada render para closures frescos
    onIndexChangeRef.current = (_idx: number) => {
        // No-op: setIdx() en el hook actualiza su propio state (currentIndex),
        // lo que dispara un re-render y actualiza el alias `const currentIndex` abajo.
    };
    onSessionEndRef.current = () => {
        triggerTransitionRef.current();
    };
    onPlayChangeRef.current = (playing: boolean) => {
        const engine = blockEngineRef.current!;
        const dur    = blockDurationMsRef.current;
        if (playing) {
            if (engine.getState().status === 'idle' && dur !== Infinity) {
                engine.startBlock(dur);
            } else {
                engine.notifyPlayback(true);
            }
            tranceEngineRef.current?.notifyPlayback(true);
        } else {
            engine.notifyPlayback(false);
            tranceEngineRef.current?.notifyPlayback(false);
        }
    };

    // ── Hook de playback — fuente única de verdad del audio y del índice ─────
    const pb = useImmersivePlayback({
        sentencesRef,
        audioSentencesRef,
        manifestRef:   manifest,
        toChunkRef:    sentenceToChunk,
        speedRef,
        userIdRef:     analyticsUserIdRef,
        contentIdRef:  analyticsContentIdRef,
        unmountedRef:  unmounted,
        onIndexChange: onIndexChangeRef,
        onSessionEnd:  onSessionEndRef,
        onPlayChange:  onPlayChangeRef,
    });

    // Índice activo — alias de pb.currentIndex (fuente de verdad en el hook).
    // Cambia con cada re-render disparado por setIdx() dentro del hook.
    const currentIndex = pb.currentIndex;

    // Render-time refs for values needed inside [] dep closures.
    const progressPercentageRef = useRef(0);
    progressPercentageRef.current = sentences.length > 1
        ? Math.round((currentIndex / sentences.length) * 100) : 0;
    const isTransitioningRef = useRef(false);
    isTransitioningRef.current = isTransitioning;

    // Always-fresh trigger: called at session end to start the next content.
    // Stored as a ref so closures with [] deps (block engine subscriber) always
    // call the latest version without needing to re-subscribe.
    const triggerTransitionRef = useRef<() => void>(() => {});
    // Updated on every render — captures latest navigate, refs, and setters.
    triggerTransitionRef.current = () => {
        if (transitionFiredRef.current) return;
        const next = nextContentRef.current;
        if (!next) {
            // No queued content — fall back to the standard completion screen.
            const _rs = rewardEngineRef.current?.getState();
            analyticsService.track({
                event: 'session_end',
                userId: analyticsUserIdRef.current,
                contentId: analyticsContentIdRef.current,
                timestamp: Date.now(),
                streak: _rs?.streak ?? 0,
                level: _rs?.level ?? 1,
                sessionDuration: Date.now() - sessionStartRef.current,
                source: 'completion',
                progressPercentage: progressPercentageRef.current,
            });
            analyticsService.flush();
            setSessionComplete(true);
            pb.pause();
            return;
        }

        transitionFiredRef.current = true;

        // Pause audio immediately — no perceptible delay for the user.
        // onPlayChange callback en pb.pause() notifica Block + TranceEngine.
        pb.pause();

        autoPlayAfterTransitionRef.current = true;
        const _rState = rewardEngineRef.current?.getState();
        const _dur = Date.now() - sessionStartRef.current;
        analyticsService.track({
            event: 'session_end',
            userId: analyticsUserIdRef.current,
            contentId: analyticsContentIdRef.current,
            timestamp: Date.now(),
            streak: _rState?.streak ?? 0,
            level: _rState?.level ?? 1,
            sessionDuration: _dur,
            source: 'transition',
            progressPercentage: progressPercentageRef.current,
        });
        analyticsService.track({
            event: 'transition_to_next_content',
            userId: analyticsUserIdRef.current,
            contentId: analyticsContentIdRef.current,
            timestamp: Date.now(),
            streak: _rState?.streak ?? 0,
            level: _rState?.level ?? 1,
            sessionDuration: _dur,
            nextContentId: next.id,
        });
        analyticsService.flush();

        // Pause before showing the dark overlay — gives the reader a moment to
        // mentally complete the current sentence. Duration scales with session
        // momentum: 300ms at rest (no flow), up to 500ms at peak deep-focus.
        const momentum = tranceEngineRef.current?.getSessionMomentum() ?? 0;
        const transitionDelayMs = 300 + Math.round(momentum * 200);
        setTimeout(() => {
            // Guard: user may have navigated away manually within the delay window.
            // Without this check, the navigate() call would override the user's choice.
            if (unmounted.current) return;
            setIsTransitioning(true);
            // Replace the current history entry so back-button returns to the library.
            navigate(`/leer/inmersivo/${encodeURIComponent(next.id)}`, { replace: true });
        }, transitionDelayMs);
    };

    // Lightweight reward toasts — no logic here, just state from the engine
    const rewardToasts = useRewardFeedback(rewardEngineRef.current);


    // Hydration-based overlay removal: dismiss the transition overlay as soon as
    // the new content finishes loading, instead of waiting for a fixed 700ms timer.
    useEffect(() => {
        if (!isHydrating && isTransitioningRef.current) {
            setIsTransitioning(false);
        }
    }, [isHydrating]);

    // --- PHASE 5.3: LEO CHATBOT ---
    const [activeLeoModal, setActiveLeoModal] = useState<ContextualAnchor | null>(null);
    const [anchorsMap, setAnchorsMap] = useState<Record<number, ContextualAnchor[]>>({});

    // --- PHASE 5.3: LEO SESSION MEMORY ---
    const [leoMemory, setLeoMemory] = useState<LeoSessionMemory>(() => {
        try {
            const stored = sessionStorage.getItem(`leo_session_${content?.id}`);
            if (stored) return JSON.parse(stored);
        } catch { /* sessionStorage unavailable */ }
        const seedDifficulty = user?.id
            ? deriveInitialDifficulty(dataService.getLeoReaderProfile(user.id))
            : 'medio';
        return {
            recentAnchors: [],
            lastQuestionType: null,
            sessionReadingProgress: 0,
            difficultyLevel: seedDifficulty,
            pedagogicalStage: 'comprehension',
            behavior: { pauses: 0, replays: 0 },
        };
    });
    const [isMemoryLoaded, setIsMemoryLoaded] = useState(false);
    const [showLeoWelcome, setShowLeoWelcome] = useState(false);
    // D/E: Resume toast — shown once after post-hydration resume when targetIndex > 0
    const [resumeToast, setResumeToast] = useState<{ label: string; crossMode: boolean; fromRemote: boolean } | null>(null);
    const resumeToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // E: Stores whether the remote progress fetch adopted a newer server record this load.
    const fromRemoteProgressRef = useRef(false);
    const [leoReaderProfile, setLeoReaderProfile] = useState<LeoReaderProfile | undefined>(
        user?.id ? dataService.getLeoReaderProfile(user.id) : undefined
    );

    // Hydrate Leo memory from backend (background, never blocks render)
    useEffect(() => {
        if (!user?.id || !content?.id) { setIsMemoryLoaded(true); return; }
        let isMounted = true;
        (async () => {
            const remoteMemory = await dataService.getLeoMemory(user.id, content.id);
            if (isMounted && remoteMemory) {
                if (!remoteMemory.pedagogicalStage) {
                    remoteMemory.pedagogicalStage = derivePedagogicalStage(
                        remoteMemory.sessionReadingProgress ?? 0,
                        remoteMemory.recentAnchors?.length ?? 0
                    );
                }
                setLeoMemory(prev => ({ ...prev, ...remoteMemory }));
                if (remoteMemory.sessionReadingProgress > 5 || (remoteMemory.recentAnchors && remoteMemory.recentAnchors.length > 0)) {
                    setLeoTriggerReason('welcome_back');
                    setShowLeoWelcome(true);
                    setTimeout(() => { if (isMounted) setShowLeoWelcome(false); }, 6000);
                }
            }
            if (isMounted) setIsMemoryLoaded(true);
        })();
        return () => { isMounted = false; };
    }, [user?.id, content?.id]);

    // Persist Leo memory changes
    const memorySaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        if (!isMemoryLoaded || !user) return;
        sessionStorage.setItem(`leo_session_${content.id}`, JSON.stringify(leoMemory));
        if (memorySaveTimeoutRef.current) clearTimeout(memorySaveTimeoutRef.current);
        memorySaveTimeoutRef.current = setTimeout(() => {
            dataService.updateLeoMemory(user.id, content.id, leoMemory);
        }, 2000);
        return () => { if (memorySaveTimeoutRef.current) clearTimeout(memorySaveTimeoutRef.current); };
    }, [leoMemory, content.id, isMemoryLoaded, user]);

    // Track reading progress + sentence position in Leo memory
    useEffect(() => {
        if (sentences.length <= 1) return;
        const prog = Math.round((currentIndex / sentences.length) * 100);
        const now = new Date().toISOString();
        setLeoMemory(prev => {
            const progChanged = prev.sessionReadingProgress !== prog;
            const newStage = progChanged
                ? derivePedagogicalStage(prog, prev.recentAnchors.length)
                : prev.pedagogicalStage;
            return {
                ...prev,
                ...(progChanged ? { sessionReadingProgress: prog, pedagogicalStage: newStage } : {}),
                lastSentenceIndex: currentIndex,
                lastReadAt: now,
            };
        });
    }, [currentIndex, sentences.length]);

    // Auto-upgrade difficulty level (one-directional, no demotion)
    useEffect(() => {
        setLeoMemory(prev => {
            if (prev.difficultyLevel === 'avanzado') return prev;
            if (prev.difficultyLevel === 'inicial' && prev.sessionReadingProgress >= 50 && prev.recentAnchors.length >= 3) {
                console.log('[Leo] Auto-upgrading difficultyLevel: inicial → medio');
                return { ...prev, difficultyLevel: 'medio' };
            }
            if (prev.difficultyLevel === 'medio' && prev.sessionReadingProgress >= 75 && prev.recentAnchors.length >= 6) {
                console.log('[Leo] Auto-upgrading difficultyLevel: medio → avanzado');
                return { ...prev, difficultyLevel: 'avanzado' };
            }
            return prev;
        });
    }, [leoMemory.sessionReadingProgress, leoMemory.recentAnchors.length]);

    // Track user-initiated pauses in behavior memory.
    // Fires only when playback transitions from playing → stopped,
    // and only outside of session-complete or content-transition paths.
    useEffect(() => {
        const wasPrevPlaying = prevIsPlayingRef.current;
        prevIsPlayingRef.current = pb.isPlaying;
        if (!pb.isPlaying && wasPrevPlaying && !isTransitioningRef.current && !sessionComplete) {
            setLeoMemory(prev => ({
                ...prev,
                behavior: {
                    pauses: (prev.behavior?.pauses ?? 0) + 1,
                    replays: prev.behavior?.replays ?? 0,
                },
            }));
        }
    }, [pb.isPlaying, sessionComplete]);

    const pendingAnchor = useMemo(
        () => selectBestAnchor(anchorsMap[currentIndex] ?? [], leoMemory.difficultyLevel),
        [anchorsMap, currentIndex, leoMemory.difficultyLevel]
    );

    // Leo context derivation
    const leoContext = useMemo(() => {
        if (!user) return undefined;
        let targetGroupId: string | null = null;
        let isAssigned = false;
        const userGroups = dataService.getUserGroups(user.id);
        if (userGroups.length > 0) {
            const allAssignments = userGroups.flatMap(g => dataService.getAssignmentsByGroup(g.id));
            const activeAssig = allAssignments.find(a => a.contentId === content.id);
            if (activeAssig) { targetGroupId = activeAssig.groupId; isAssigned = true; }
            else if (userGroups.length === 1) { targetGroupId = userGroups[0].id; }
        }
        if (targetGroupId) {
            const group = dataService.groups?.find(g => g.id === targetGroupId);
            if (group) {
                const medIds = dataService.getGroupMediatorIds(group);
                let medKind: any = undefined;
                if (medIds.length > 0) {
                    const mainMed = dataService.getUsuarioById(medIds[0]);
                    // DT-05: 'profesor' eliminado — solo 'mediador' es rol canónico.
                    if (mainMed) medKind = mainMed.mediatorKind || (mainMed.roles?.includes('mediador') ? 'teacher' : undefined);
                }
                return { isAssignedContext: isAssigned, groupType: group.type || 'course', mediatorKind: medKind, organizationName: group.school };
            }
        }
        return { isAssignedContext: false };
    }, [user, content.id]);

    const [showLeoCompanion, setShowLeoCompanion] = useState(false);
    const [leoInitialMsg, setLeoInitialMsg] = useState<string | null>(null);
    const [leoTriggerReason, setLeoTriggerReason] = useState<LeoTriggerReason | null>(null);
    const lastTriggerTimeRef = useRef<number>(0);
    const TRIGGER_COOLDOWN_MS = 5 * 60 * 1000;
    const triggeredMilestonesRef = useRef<Set<number>>(new Set());
    const backNavCountRef = useRef<number>(0);
    const lastNavIndexRef = useRef<number>(0);
    const prevIsPlayingRef = useRef<boolean>(false);
    const lastIndexChangeTimeRef = useRef<number>(Date.now());
    const showLeoCompanionRef = useRef(false);
    const activeLeoModalRef = useRef<ContextualAnchor | null>(null);
    // B4: tracks when the user last interacted with an anchor modal (index + timestamp)
    const lastAnchorContextRef = useRef<{ index: number; at: number } | null>(null);
    // Always-fresh ref for leoMemory — used inside interval/effect closures with [] deps.
    const leoMemoryRef = useRef(leoMemory);
    // Tracks the previous sessionReadingProgress so the engine can detect threshold crossings.
    const prevMemoryProgressRef = useRef(0);
    useEffect(() => { showLeoCompanionRef.current = showLeoCompanion; }, [showLeoCompanion]);
    useEffect(() => { activeLeoModalRef.current = activeLeoModal; }, [activeLeoModal]);
    useEffect(() => { leoMemoryRef.current = leoMemory; }, [leoMemory]);
    useEffect(() => { lastIndexChangeTimeRef.current = Date.now(); }, [currentIndex]);
    useEffect(() => { if (pb.isPlaying) lastIndexChangeTimeRef.current = Date.now(); }, [pb.isPlaying]);

    const fireIntervention = useCallback((msg: string, reason: LeoTriggerReason) => {
        const now = Date.now();
        if (now - lastTriggerTimeRef.current < TRIGGER_COOLDOWN_MS) return;
        if (showLeoCompanionRef.current || activeLeoModalRef.current) return;
        lastTriggerTimeRef.current = now;
        setLeoInitialMsg(msg);
        setLeoTriggerReason(reason);
        setShowLeoCompanion(true);
        setShowLeoWelcome(false);
    }, []);

    // T1: Inactivity trigger — decision routed through shouldTriggerLeo
    useEffect(() => {
        if (!pb.isPlaying) return;
        const id = setInterval(() => {
            const inactivityMs = Date.now() - lastIndexChangeTimeRef.current;
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
    }, [pb.isPlaying, fireIntervention]);

    // T2: Progress milestone trigger — decision routed through shouldTriggerLeo.
    // prevMemoryProgressRef holds the previous value so the engine can detect exact
    // threshold crossings (prev < threshold <= current) without per-milestone state.
    useEffect(() => {
        if (sentences.length <= 1) return;
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
    }, [leoMemory.sessionReadingProgress, sentences.length, fireIntervention]);

    // T3: Backward navigation → confusion detection routed through shouldTriggerLeo.
    // behavior.replays is incremented on every backward step; the engine decides when
    // the cumulative count crosses the confusion threshold (replays >= 2).
    useEffect(() => {
        if (sentences.length <= 1) return;
        if (currentIndex < lastNavIndexRef.current) {
            const newReplays = (leoMemoryRef.current.behavior?.replays ?? 0) + 1;
            const updatedBehavior = {
                pauses: leoMemoryRef.current.behavior?.pauses ?? 0,
                replays: newReplays,
            };
            setLeoMemory(prev => ({
                ...prev,
                behavior: updatedBehavior,
            }));
            const reason = shouldTriggerLeo({
                memory: {
                    sessionReadingProgress: leoMemoryRef.current.sessionReadingProgress,
                    behavior: updatedBehavior,
                },
                currentIndex,
                progress: leoMemoryRef.current.sessionReadingProgress,
                inactivityMs: 0,
                isReturningUser: false,
            });
            if (reason === 'confusion') {
                fireIntervention('Parece que volviste varias veces a esta parte. ¿Hay algo que no esté quedando claro? Puedo ayudarte a entenderlo.', 'confusion');
            }
        }
        lastNavIndexRef.current = currentIndex;
    }, [currentIndex, sentences.length, fireIntervention]);

    // Reading preferences
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg' | 'xl'>(() => (localStorage.getItem('inv_fontSize') as any) || 'base');
    const [lineSpacing, setLineSpacing] = useState<'normal' | 'relaxed' | 'loose'>(() => (localStorage.getItem('inv_lineSpacing') as any) || 'relaxed');
    const [theme, setTheme] = useState<'dark' | 'high-contrast'>(() => (localStorage.getItem('inv_theme') as any) || 'dark');

    useEffect(() => {
        localStorage.setItem('inv_fontSize', fontSize);
        localStorage.setItem('inv_lineSpacing', lineSpacing);
        localStorage.setItem('inv_theme', theme);
    }, [fontSize, lineSpacing, theme]);

    // --- REFS DE LAYOUT ---
    const heightCache        = useRef<Map<number, number>>(new Map());
    const lastMeasuredHeight = useRef<number>(150);
    const containerRef       = useRef<HTMLDivElement>(null);
    const itemRefs           = useRef<(HTMLDivElement | null)[]>([]);

    // Cleanup on unmount
    useEffect(() => {
        unmounted.current = false;
        return () => {
            unmounted.current = true;
            // Audio cache/blob cleanup es responsabilidad del hook (su propio useEffect).
            blockEngineRef.current?.destroy();
            rewardEngineRef.current?.destroy();
            tranceEngineRef.current?.destroy();
            // Flush any buffered events on unmount (catches manual back-navigation)
            analyticsService.track({
                event: 'session_end',
                userId: analyticsUserIdRef.current,
                contentId: analyticsContentIdRef.current,
                timestamp: Date.now(),
                streak: rewardEngineRef.current?.getState().streak ?? 0,
                level: rewardEngineRef.current?.getState().level ?? 1,
                sessionDuration: Date.now() - sessionStartRef.current,
                source: 'unmount',
            });
            analyticsService.flush();
        };
    }, []);

    // -----------------------------------------------------------------------
    // BLOCK ENGINE WIRING — subscribe only. Zero logic inside this effect.
    // All timer logic lives in BlockEngine. React state is only updated here
    // as a consequence of engine events, never as a cause.
    // -----------------------------------------------------------------------
    useEffect(() => {
        const engine = blockEngineRef.current!;

        const unsubscribe = engine.subscribe((event) => {
            switch (event.type) {
                case 'tick':
                    // Keep timeLeft display accurate via engine's timestamp-based elapsed
                    setTimeLeft(Math.ceil(event.remaining / 1000));
                    break;
                case 'complete':
                    triggerTransitionRef.current();
                    break;
                case 'pause':
                case 'resume':
                    // No additional React state needed — isPlaying is already
                    // updated by the caller before notifyPlayback() is invoked.
                    break;
            }
        });

        return () => { unsubscribe(); };
    }, []); // stable — engine lives in ref, audioRefs are stable

    // -----------------------------------------------------------------------
    // TRANCE ENGINE WIRING — observe intensity changes, update React state.
    // -----------------------------------------------------------------------
    useEffect(() => {
        const engine = tranceEngineRef.current!;
        const unsubscribe = engine.subscribe((state) => {
            setTranceIntensity(state.intensity);
        });
        return () => { unsubscribe(); };
    }, []); // stable — engine lives in ref

    // -----------------------------------------------------------------------
    // ANALYTICS WIRING — subscribe to engines, emit reading events.
    // All data accessed via render-time refs so [] deps are correct.
    // -----------------------------------------------------------------------
    useEffect(() => {
        const blockEngine = blockEngineRef.current!;
        const rewardEngine = rewardEngineRef.current!;

        const unsubBlock = blockEngine.subscribe((event) => {
            if (event.type !== 'complete') return;
            const s = rewardEngine.getState();
            analyticsService.track({
                event: 'block_complete',
                userId: analyticsUserIdRef.current,
                contentId: analyticsContentIdRef.current,
                timestamp: Date.now(),
                streak: s.streak,
                level: s.level,
                sessionDuration: Date.now() - sessionStartRef.current,
                blocksCompleted: s.blocksCompleted,
            });
        });

        const unsubReward = rewardEngine.subscribe((ev) => {
            if (ev.type === 'xp') {
                const currentStreak = ev.state.streak;
                // streak_break: streak reset to 1 after being on a meaningful run
                if (analyticsPrevStreakRef.current > 1 && currentStreak === 1) {
                    analyticsService.track({
                        event: 'streak_break',
                        userId: analyticsUserIdRef.current,
                        contentId: analyticsContentIdRef.current,
                        timestamp: Date.now(),
                        streak: currentStreak,
                        level: ev.state.level,
                        sessionDuration: Date.now() - sessionStartRef.current,
                        previousStreak: analyticsPrevStreakRef.current,
                    });
                }
                analyticsPrevStreakRef.current = currentStreak;
            }

            if (ev.type === 'levelUp') {
                analyticsService.track({
                    event: 'level_up',
                    userId: analyticsUserIdRef.current,
                    contentId: analyticsContentIdRef.current,
                    timestamp: Date.now(),
                    streak: ev.state.streak,
                    level: ev.newLevel ?? ev.state.level,
                    sessionDuration: Date.now() - sessionStartRef.current,
                    oldLevel: ev.oldLevel,
                    xp: ev.state.xp,
                });
            }
        });

        return () => {
            unsubBlock();
            unsubReward();
        };
    }, []); // stable — all data accessed via refs

    // -----------------------------------------------------------------------
    // BACKGROUND ACCESS CHECK — never blocks rendering.
    // Shows a soft overlay only if access is explicitly denied after render.
    // -----------------------------------------------------------------------
    useEffect(() => {
        if (!user?.id) {
            setAccessDenied(true);
            setAccessDenyReason('No hay usuario autenticado.');
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(
                    `/api/content/${encodeURIComponent(content.id)}/access?userId=${encodeURIComponent(user.id)}`,
                    { headers: { 'x-user-id': user.id } }
                );
                if (cancelled) return;
                const data = await res.json();
                if (cancelled) return;
                if (data.allowed !== true) {
                    setAccessDenied(true);
                    setAccessDenyReason(data.reason || 'Acceso no autorizado.');
                }
            } catch {
                if (!cancelled) {
                    setAccessDenied(true);
                    setAccessDenyReason('No se pudo verificar el acceso.');
                }
            }
        })();
        return () => { cancelled = true; };
    }, [content.id, user?.id]);

    // -----------------------------------------------------------------------
    // MANIFEST v2: sentenceIndex → chunkIndex resolver
    // -----------------------------------------------------------------------
    const toAudioKey = useCallback((si: number): number => {
        return sentenceToChunk.current.length > 0 ? (sentenceToChunk.current[si] ?? si) : si;
    }, []);

    // -----------------------------------------------------------------------
    // ENGINE WIRING — StartupEngine (pure TS, no React logic inside)
    //
    // The engine is created exactly once per content load via useRef.
    // The useEffect only subscribes and calls start() — all fetch/parse
    // logic lives inside the engine, never in React.
    // -----------------------------------------------------------------------
    const postHydrationDoneRef = useRef(false);
    const engineRef = useRef<StartupEngine | null>(null);

    // Re-runs on every content change. Creates a fresh StartupEngine for each
    // content and, on transitions (not the initial mount), resets all content-
    // specific state while keeping engines (Block/Reward/Trance) alive.
    useEffect(() => {
        const engine = new StartupEngine(content.id, content.texto_plano_url);
        engineRef.current = engine;

        const unsubscribe = engine.subscribe((state) => {
            if (state.status !== 'ready') return;
            sentenceToChunk.current = state.sentenceToChunk;
            manifest.current = state.manifest;
            if (state.sentences.length > 0) {
                setSentences(state.sentences);
                setAudioSentences(state.sentences);
            }
            setAnchorsMap(state.anchorsMap);
            setIsHydrating(false);
        });

        engine.start();

        // On content transitions (not the initial mount), reset content-specific
        // state. Engine state (XP, streak, trance intensity) is intentionally
        // preserved across transitions.
        if (!isFirstContentRenderRef.current) {
            setSentences([content.titulo || 'Preparando tu lectura...']);
            setAudioSentences([content.titulo || '']);
            setIsHydrating(true);
            setSessionComplete(false);
            setAnchorsMap({});
            setActiveLeoModal(null);
            setShowLeoCompanion(false);
            setShowLeoWelcome(false);
            setLeoInitialMsg(null);
            setLeoTriggerReason(null);
            setIsMenuOpen(false);
            setIsMemoryLoaded(false);

            pb.reset();  // limpia cache, blobs, players, status → idle
            heightCache.current.clear();
            postHydrationDoneRef.current = false;
            nextContentRef.current = null;
            transitionFiredRef.current = false;
            sessionStartRef.current = Date.now();
            triggeredMilestonesRef.current = new Set();
            backNavCountRef.current = 0;

            blockEngineRef.current?.reset();

            // Reset Leo memory for the new content
            try {
                const stored = sessionStorage.getItem(`leo_session_${content.id}`);
                if (stored) {
                    setLeoMemory(JSON.parse(stored));
                } else {
                    const seedDifficulty = user?.id
                        ? deriveInitialDifficulty(dataService.getLeoReaderProfile(user.id))
                        : 'medio';
                    setLeoMemory({
                        recentAnchors: [], lastQuestionType: null,
                        sessionReadingProgress: 0, difficultyLevel: seedDifficulty,
                        pedagogicalStage: 'comprehension',
                        behavior: { pauses: 0, replays: 0 },
                    });
                }
            } catch { /* sessionStorage unavailable */ }

            // Overlay removal is handled by the isHydrating useEffect above —
            // it fires as soon as the new content finishes loading.
        }

        isFirstContentRenderRef.current = false;

        // E: Kick off remote progress fetch. Sentences load async from the engine,
        // so this usually resolves before post-hydration fires (sentence build takes ~200-500ms).
        // If it loses the race, post-hydration falls back to local progress — no harm done.
        if (user) {
            dataService.fetchAndMergeRemoteProgress(user.id, content.id)
                .then(fromRemote => { fromRemoteProgressRef.current = fromRemote; })
                .catch(() => {});
        }

        return () => { unsubscribe(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [content.id]);

    // Post-hydration: resume progress + start audio (runs once per content load)
    useEffect(() => {
        // sentences.length <= 1 means we still have the placeholder
        if (sentences.length <= 1 || postHydrationDoneRef.current) return;
        postHydrationDoneRef.current = true;

        let targetIndex = 0;
        const isAutoTransition = autoPlayAfterTransitionRef.current;
        autoPlayAfterTransitionRef.current = false;

        // On seamless transitions, always start from the beginning.
        // On manual opens, resume from saved progress.
        if (!isAutoTransition && user) {
            const prog = dataService.getProgresoUsuarioLibro(user.id, content.id);
            if (prog) {
                const anchor = prog.canonicalProgress?.anchor;
                const exactSentence = prog.canonicalProgress?.sentenceIndex;
                const hasExactSentence = exactSentence !== undefined && exactSentence > 0;
                const isLastImmersive =
                    prog.canonicalProgress?.lastInteractedMode === 'immersive' ||
                    prog.last_device_mode === 'immersive';

                // E: Priority order for resume precision:
                // 1. anchor.type='sentence' — explicit sentence anchor (most precise, immersive-saved)
                // 2. sentenceIndex + last mode was immersive — legacy exact sentence (same precision)
                // 3. globalPercentage fallback — cross-mode, cross-device
                if (anchor?.type === 'sentence' && anchor.value > 0) {
                    targetIndex = Math.min(anchor.value, sentences.length - 1);
                } else if (hasExactSentence && isLastImmersive) {
                    targetIndex = Math.min(exactSentence as number, sentences.length - 1);
                } else if (prog.porcentaje > 0) {
                    const resumeIdx = Math.floor((prog.porcentaje / 100) * sentences.length);
                    targetIndex = Math.min(resumeIdx, sentences.length - 1);
                }
            }
            dataService.recordReaderOpen(user.id, content.id, 'inmersivo');
            sessionStartRef.current = Date.now();
        }

        // Track session_start for both initial loads and seamless transitions
        analyticsService.track({
            event: 'session_start',
            userId: analyticsUserIdRef.current,
            contentId: content.id,
            timestamp: Date.now(),
            streak: rewardEngineRef.current?.getState().streak ?? 0,
            level: rewardEngineRef.current?.getState().level ?? 1,
            sessionDuration: 0,
            isTransition: isAutoTransition,
        });

        // D/E: Resume toast — fires once when we actually resume (targetIndex > 0).
        // Transitions always start from 0, so we skip them here.
        if (!isAutoTransition && targetIndex > 0 && user) {
            const prog = dataService.getProgresoUsuarioLibro(user.id, content.id);
            if (prog) {
                const lastMode = prog.canonicalProgress?.lastInteractedMode ?? prog.last_device_mode;
                const fromRemote = fromRemoteProgressRef.current;
                fromRemoteProgressRef.current = false; // consume once
                const toast = getResumeToast(prog.porcentaje, lastMode, 'inmersivo', fromRemote);
                if (toast) {
                    setResumeToast(toast);
                    if (resumeToastTimerRef.current) clearTimeout(resumeToastTimerRef.current);
                    resumeToastTimerRef.current = setTimeout(() => setResumeToast(null), 5000);
                }
            }
        }

        // forcePlay=true on transitions keeps the session uninterrupted
        pb.load(targetIndex, isAutoTransition);

    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sentences.length]);

    // -----------------------------------------------------------------------
    // AUDIO ENGINE — delegado a useImmersivePlayback (pb)
    // -----------------------------------------------------------------------

    // --- PROGRESS TRACKING ---
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const sessionStartRef = useRef<number>(Date.now());
    // QW-3: acumulado ya enviado a updateProgreso. Permite emitir deltas incrementales
    // en vez del elapsed absoluto desde session start, que inflaba totalTimeMs en el backend.
    const lastElapsedSentRef = useRef<number>(0);

    useEffect(() => {
        // Skip while placeholder is showing
        if (!user || sentences.length <= 1) return;
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            saveTimeoutRef.current = null;
            // QW-3: delta incremental (no absoluto desde session start).
            const nowElapsed = Date.now() - sessionStartRef.current;
            const deltaMs = Math.max(0, nowElapsed - lastElapsedSentRef.current);
            lastElapsedSentRef.current = nowElapsed;
            // E: anchor type='sentence' stores the exact sentence index for same-mode precision.
            dataService.updateProgreso(
                user.id, content.id,
                currentIndex + 1, sentences.length,
                currentIndex, 'immersive',
                { lastMode: 'inmersivo', elapsedMs: deltaMs },
                { type: 'sentence', value: currentIndex }
            );
        }, 800); // FT-3: debounce 1500 → 800ms
        return () => {
            // QW-2: si el debounce aún no disparó, forzar un save con la posición actual ANTES
            // de cancelar el timer. Evita perder la última posición al salir/cerrar rápido o
            // al transicionar a otro contenido (content.id en deps dispara esta cleanup).
            if (saveTimeoutRef.current && user && sentences.length > 1) {
                const nowElapsed = Date.now() - sessionStartRef.current;
                const deltaMs = Math.max(0, nowElapsed - lastElapsedSentRef.current);
                lastElapsedSentRef.current = nowElapsed;
                dataService.updateProgreso(
                    user.id, content.id,
                    currentIndex + 1, sentences.length,
                    currentIndex, 'immersive',
                    { lastMode: 'inmersivo', elapsedMs: deltaMs },
                    { type: 'sentence', value: currentIndex }
                );
            }
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            dataService.forceFlush();
        };
    }, [currentIndex, user, content.id, sentences.length]);

    // togglePlay: fuente única de intención del usuario.
    //
    // 'paused' → resume() eficiente: el audio ya está cargado, solo reinicia play().
    // todo lo demás (idle, error, blocked, loading) → load() con token fresco:
    //   - 'blocked': la URL sigue en cache; play() tras gesto del usuario funciona.
    //   - 'error':   re-intenta fetch (TTS puede estar disponible ahora).
    //   - 'idle':    carga inicial.
    //
    // Nota: usa pb.currentIndex (fuente canónica) no el mirror local del visor.
    const togglePlay = () => {
        if (pb.isPlaying)           pb.pause();
        else if (pb.status === 'paused') pb.resume();
        else                        pb.load(pb.currentIndex, true);
    };

    // Live speed update — aplica inmediatamente a los elementos de audio del hook
    useEffect(() => {
        if (pb.audioRefA.current) pb.audioRefA.current.playbackRate = playbackSpeed;
        if (pb.audioRefB.current) pb.audioRefB.current.playbackRate = playbackSpeed;
    }, [playbackSpeed]);

    // --- VISUAL ENGINE ---
    const [translateY, setTranslateY] = useState(0);
    const [ContainerResized, setContainerResized] = useState(0);

    useEffect(() => {
        if (!containerRef.current) return;
        const resizeObserver = new ResizeObserver(() => { setContainerResized(prev => prev + 1); });
        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
        if (!containerRef.current || itemRefs.current.length === 0) return;
        const containerHeight = containerRef.current.clientHeight;
        const currentParams = itemRefs.current[currentIndex];
        if (currentParams) {
            if (!heightCache.current.has(currentIndex) && currentParams.clientHeight > 0) {
                heightCache.current.set(currentIndex, currentParams.clientHeight);
            }
            const elTop = currentParams.offsetTop;
            const elHeight = currentParams.clientHeight;
            const targetY = (containerHeight / 2) - (elTop + (elHeight / 2));
            setTranslateY(targetY);
        }
    }, [currentIndex, sentences.length, ContainerResized, fontSize, lineSpacing]);

    // Memory GC — el hook lee su currentIdxRef interno, no necesita parámetro.
    useEffect(() => {
        pb.runGC();
    }, [currentIndex, sentences.length]);

    // ContentQueue: preload next content in the background once enough sentences
    // have loaded. Warming the HTTP cache means the next StartupEngine fetch is instant.
    useEffect(() => {
        if (sentences.length <= 3 || nextContentRef.current) return;
        const next = getNextContent(content, dataService.getBooks());
        if (!next) return;
        nextContentRef.current = next;
        preloadContentText(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [sentences.length, content.id]);

    // Timer is now owned entirely by BlockEngine.
    // No useEffect here — see BLOCK ENGINE WIRING above.

    // -----------------------------------------------------------------------
    // RENDER
    // -----------------------------------------------------------------------

    if (sessionComplete) {
        return (
            <div className="h-screen w-full bg-black flex flex-col items-center justify-center text-white p-8 animate-in fade-in">
                <Award size={80} className="text-yellow-400 mb-6" />
                <h1 className="text-4xl font-bold mb-4">¡Lectura Completada!</h1>
                <p className="text-xl text-gray-400 mb-8">{content.titulo}</p>
                <div className="flex gap-4">
                    <button onClick={() => { blockEngineRef.current?.startBlock(300_000); setSessionComplete(false); togglePlay(); }} className="px-8 py-3 bg-indigo-600 rounded-full font-bold hover:bg-indigo-500">
                        +5 Minutos
                    </button>
                    <button onClick={() => navigate(-1)} className="px-8 py-3 bg-white/10 rounded-full font-bold hover:bg-white/20">
                        Salir
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className={`relative h-screen w-full overflow-hidden font-sans select-none ${theme === 'high-contrast' ? 'bg-black text-white' : 'bg-neutral-950 text-white'}`}>

            {/* AUDIO (Hidden) — refs y handlers delegados al hook */}
            <audio
                ref={pb.audioRefA}
                className="hidden"
                preload="auto"
                onEnded={() => pb.handleEnded('A')}
                onError={() => pb.handleAudioError('A')}
            />
            <audio
                ref={pb.audioRefB}
                className="hidden"
                preload="auto"
                onEnded={() => pb.handleEnded('B')}
                onError={() => pb.handleAudioError('B')}
            />

            {/* HEADER — fades with trance intensity; CSS transition handles the ease */}
            <div
                className="absolute top-0 left-0 right-0 z-20 p-6 flex justify-between items-center bg-gradient-to-b from-black/90 to-transparent"
                style={{ opacity: 1 - tranceIntensity * 0.85, transition: 'opacity 1.5s ease' }}
            >
                <button onClick={() => navigate(-1)} className="p-2 bg-white/10 rounded-full hover:bg-white/20"><ChevronLeft /></button>
                <div className="flex items-center gap-4">
                    <button onClick={() => setIsMenuOpen(!isMenuOpen)} className={`p-2 rounded-full transition-colors ${isMenuOpen ? 'bg-indigo-600' : 'bg-white/10 hover:bg-white/20'}`}>
                        <Settings size={20} />
                    </button>
                    <div className="flex items-center gap-2 bg-black/40 px-3 py-1 rounded-full border border-white/10">
                        <Zap size={14} className="text-yellow-400" />
                        <span className="text-xs font-bold uppercase">{LEVELS[currentLevel as keyof typeof LEVELS].label}</span>
                    </div>
                    <div className="font-mono font-bold text-xl flex items-center gap-2">
                        <Clock size={16} className="text-indigo-400" />
                        {timeLeft === Infinity ? "∞" : `${Math.floor(timeLeft / 60)}:${(timeLeft % 60).toString().padStart(2, '0')}`}
                    </div>
                </div>
            </div>

            {/* PHASE 0: TELEPROMPTER SHELL — renders immediately, no async deps */}
            <ImmersiveShell
                sentences={sentences}
                currentIndex={currentIndex}
                isHydrating={isHydrating}
                translateY={translateY}
                containerRef={containerRef}
                itemRefs={itemRefs}
                theme={theme}
                fontSize={fontSize}
                lineSpacing={lineSpacing}
                onClickSentence={(idx) => pb.skip(idx)}
                heightCache={heightCache}
                lastMeasuredHeight={lastMeasuredHeight}
                playbackSpeed={playbackSpeed} /* QW-5 */
            />

            {/* LEO CONTEXTUAL ANCHOR (Floating) */}
            {pendingAnchor && !activeLeoModal && !leoMemory.recentAnchors.includes(currentIndex) && (
                <div className="absolute right-6 top-1/2 -translate-y-1/2 z-30 animate-in slide-in-from-right fade-in duration-500">
                    <button
                        onClick={() => {
                            if (pb.isPlaying) pb.pause();
                            lastAnchorContextRef.current = { index: currentIndex, at: Date.now() };
                            setActiveLeoModal(pendingAnchor);
                            setLeoMemory(prev => {
                                const newAnchors = [...prev.recentAnchors, currentIndex].slice(-10);
                                const newStage = derivePedagogicalStage(prev.sessionReadingProgress, newAnchors.length);
                                return { ...prev, recentAnchors: newAnchors, lastQuestionType: pendingAnchor.type, pedagogicalStage: newStage };
                            });
                            if (user?.id) {
                                const anchorType = pendingAnchor.type ?? '';
                                dataService.updateLeoReaderProfile(user.id, {
                                    vocabularyDelta: (anchorType === 'vocabulary' || anchorType === 'friction_support') ? 1 : 0,
                                    reflectionDelta: (anchorType === 'reflexion' || anchorType === 'insight') ? 1 : 0,
                                });
                            }
                        }}
                        className="group relative flex items-center justify-center w-14 h-14 rounded-full bg-indigo-600 shadow-xl shadow-indigo-500/30 hover:scale-110 transition-all border-2 border-indigo-400"
                    >
                        <span className="absolute -inset-2 rounded-full border border-indigo-500 animate-ping opacity-50"></span>
                        <MessageCircle className="text-white" size={28} />
                        <div className="absolute right-full mr-4 bg-black/80 px-4 py-2 rounded-xl text-sm font-bold whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity">
                            {pendingAnchor.title}
                        </div>
                    </button>
                </div>
            )}

            {/* LEO MODAL OVERLAY */}
            {activeLeoModal && (
                <div className="absolute inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-6 animate-in fade-in">
                    <div className="bg-neutral-900 border border-white/10 rounded-3xl max-w-lg w-full p-8 shadow-2xl relative">
                        <button onClick={() => { lastAnchorContextRef.current = { index: currentIndex, at: Date.now() }; setActiveLeoModal(null); }} className="absolute top-6 right-6 text-gray-400 hover:text-white">
                            <X size={24} />
                        </button>
                        <div className="flex items-center gap-4 mb-6">
                            <div className="w-12 h-12 rounded-full bg-indigo-600 flex items-center justify-center">
                                <MessageCircle className="text-white" size={24} />
                            </div>
                            <div>
                                <span className="text-indigo-400 text-xs font-bold uppercase tracking-wider">{activeLeoModal.type}</span>
                                <h2 className="text-2xl font-bold text-white">{activeLeoModal.title}</h2>
                            </div>
                        </div>
                        <p className="text-gray-300 text-lg leading-relaxed mb-8">{activeLeoModal.payload}</p>
                        <button
                            onClick={() => { lastAnchorContextRef.current = { index: currentIndex, at: Date.now() }; setActiveLeoModal(null); if (!pb.isPlaying) togglePlay(); }}
                            className="w-full py-4 bg-white text-black font-bold rounded-xl text-lg hover:bg-gray-200 transition-colors shadow-lg"
                        >
                            Continuar Leyendo
                        </button>
                    </div>
                </div>
            )}

            {/* LEO WELCOME TOAST */}
            {showLeoWelcome && !showLeoCompanion && !activeLeoModal && (
                <div
                    className="fixed bottom-24 right-6 z-50 bg-indigo-600/90 backdrop-blur-md text-white px-5 py-4 rounded-2xl shadow-2xl border border-indigo-400/30 animate-in slide-in-from-bottom-5 fade-in duration-500 max-w-xs cursor-pointer hover:bg-indigo-600 transition-colors"
                    onClick={() => { setShowLeoWelcome(false); setShowLeoCompanion(true); if (pb.isPlaying) pb.pause(); }}
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

            {/* LEO COMPANION BUTTON — kept more visible than other chrome so the user can always reach Leo */}
            {!showLeoCompanion && !activeLeoModal && (
                <button
                    onClick={() => { setShowLeoWelcome(false); const isRecentAnchor = lastAnchorContextRef.current !== null && Date.now() - lastAnchorContextRef.current.at < 15_000 && Math.abs(currentIndex - lastAnchorContextRef.current.index) <= 2; setLeoTriggerReason(isRecentAnchor ? 'anchor' : null); setShowLeoCompanion(true); if (pb.isPlaying) pb.pause(); }}
                    className="fixed bottom-6 right-6 z-[60] bg-indigo-600 hover:bg-indigo-700 text-white w-14 h-14 rounded-full shadow-2xl transition-transform transform hover:scale-110 flex items-center justify-center border-2 border-white/50"
                    style={{ opacity: 1 - tranceIntensity * 0.65, transition: 'opacity 1.5s ease' }}
                    title="Pregúntale a Leo"
                >
                    <img src="/leo_character.png" alt="Leo" className="w-10 h-10 object-contain drop-shadow-md" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                </button>
            )}

            {/* LEO COMPANION PANEL */}
            {showLeoCompanion && sentences.length > 0 && (
                <LeoCompanion
                    contentId={content.id}
                    currentIndex={currentIndex}
                    exactSentence={sentences[currentIndex].trim()}
                    onClose={() => { setShowLeoCompanion(false); setLeoInitialMsg(null); setLeoTriggerReason(null); }}
                    initialMessage={leoInitialMsg}
                    sessionMemory={leoMemory}
                    difficultyLevel={leoMemory.difficultyLevel}
                    pedagogicalStage={leoMemory.pedagogicalStage}
                    readerProfile={leoReaderProfile}
                    leoContext={leoContext}
                    onMemoryUpdate={(updates) => setLeoMemory(prev => ({ ...prev, ...updates }))}
                    onNavigate={(idx) => pb.skip(idx)}
                    triggerReason={leoTriggerReason}
                    hasAnchorAvailable={!!pendingAnchor}
                    hasAudioAvailable={true}
                    isAudioPlaying={pb.isPlaying}
                    onAction={(actionId) => {
                        console.log('[Leo] action:', actionId, '| trigger:', leoTriggerReason);
                        if (actionId === 'open_anchor' && pendingAnchor) {
                            setShowLeoCompanion(false);
                            setLeoInitialMsg(null);
                            setLeoTriggerReason(null);
                            if (pb.isPlaying) pb.pause();
                            setActiveLeoModal(pendingAnchor);
                            setLeoMemory(prev => {
                                const newAnchors = [...prev.recentAnchors, currentIndex].slice(-10);
                                const newStage = derivePedagogicalStage(prev.sessionReadingProgress, newAnchors.length);
                                return { ...prev, recentAnchors: newAnchors, pedagogicalStage: newStage };
                            });
                        } else if (actionId === 'open_anchor') {
                            console.warn('[Leo] open_anchor failed: no anchor available at index', currentIndex);
                        } else if (actionId === 'play_audio') {
                            setShowLeoCompanion(false);
                            setLeoInitialMsg(null);
                            setLeoTriggerReason(null);
                            if (!pb.isPlaying) togglePlay();
                        }
                    }}
                />
            )}

            {/* CONTROLS — fades with trance; pointer-events remain active so user can still interact */}
            <div
                className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30"
                style={{ opacity: 1 - tranceIntensity * 0.80, transition: 'opacity 1.5s ease' }}
            >
                <div className="flex items-center gap-6 bg-neutral-900/80 backdrop-blur-xl border border-white/10 px-8 py-4 rounded-2xl shadow-2xl">
                    <button onClick={() => { console.log('🔥 RS btn:prev_click', { renderCurrentIndex: currentIndex, pbCurrentIndex: pb.currentIndex, sentencesLength: sentences.length, pbStatus: pb.status }); pb.skipPrev(); }} className="p-2 hover:bg-white/10 rounded-full transition-colors"><ChevronLeft size={24} /></button>
                    <button
                        onClick={togglePlay}
                        // QW-1: bloquear click mientras isHydrating. Evita el race donde el usuario
                        // dispara pb.load(0, true) antes de que post-hydration calcule targetIndex,
                        // lo que causaba el "reinicio del texto" al tocar play tempranamente.
                        disabled={pb.status === 'loading' || isHydrating}
                        title={
                            isHydrating             ? 'Preparando lectura...' :
                            pb.status === 'error'   ? 'Sin audio — modo texto' :
                            pb.status === 'blocked' ? 'Toca para activar audio' : undefined
                        }
                        className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95
                            ${pb.isPlaying       ? 'bg-white text-black' :
                              pb.status === 'loading' ? 'bg-indigo-400 text-white cursor-wait' :
                              pb.status === 'error'   ? 'bg-gray-700 text-gray-400' :
                              pb.status === 'blocked' ? 'bg-amber-600 text-white animate-pulse' :
                              'bg-indigo-600 text-white shadow-indigo-500/50'}`}
                    >
                        {pb.status === 'loading'
                            ? <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            : pb.status === 'error'
                                ? <span className="text-xs font-bold leading-tight text-center px-1">Sin audio</span>
                                : pb.status === 'blocked'
                                    ? <Play size={28} className="ml-1 fill-current" />
                                    : pb.isPlaying
                                        ? <Pause size={32} className="fill-current" />
                                        : <Play size={32} className="ml-1 fill-current" />
                        }
                    </button>
                    <button onClick={() => { console.log('🔥 RS btn:next_click', { renderCurrentIndex: currentIndex, pbCurrentIndex: pb.currentIndex, sentencesLength: sentences.length, pbStatus: pb.status }); pb.skipNext(); }} className="p-2 hover:bg-white/10 rounded-full transition-colors"><SkipForward size={24} /></button>
                    <div className="w-px h-8 bg-white/20 mx-2" />
                    <div className="flex flex-col items-center gap-1">
                        <button onClick={() => { const i = SPEEDS.indexOf(playbackSpeed); if (i < SPEEDS.length - 1) setPlaybackSpeed(SPEEDS[i + 1]); }} className="p-1 hover:bg-white/10 rounded-full"><Plus size={16} /></button>
                        <span className="text-xs font-mono font-bold">{playbackSpeed}x</span>
                        <button onClick={() => { const i = SPEEDS.indexOf(playbackSpeed); if (i > 0) setPlaybackSpeed(SPEEDS[i - 1]); }} className="p-1 hover:bg-white/10 rounded-full"><Minus size={16} /></button>
                    </div>
                </div>
            </div>

            {/* SETTINGS MENU */}
            {isMenuOpen && (
                <div className="absolute top-24 right-6 z-50 bg-neutral-900 border border-white/10 rounded-2xl p-6 shadow-2xl flex flex-col gap-6 w-80 animate-in slide-in-from-top-4">
                    <div className="flex items-center justify-between pb-4 border-b border-white/10">
                        <h3 className="font-bold text-lg">Preferencias de Lectura</h3>
                        <button onClick={() => setIsMenuOpen(false)} className="text-gray-400 hover:text-white">✕</button>
                    </div>
                    <div className="space-y-3">
                        <label className="text-sm font-semibold text-gray-400 flex items-center gap-2"><Sun size={14}/> Tema Visual</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => setTheme('dark')} className={`py-2 px-3 rounded-xl border flex items-center justify-center gap-2 ${theme === 'dark' ? 'bg-indigo-600 border-indigo-500' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>Oscuro</button>
                            <button onClick={() => setTheme('high-contrast')} className={`py-2 px-3 rounded-xl border flex items-center justify-center gap-2 ${theme === 'high-contrast' ? 'bg-yellow-500 text-black border-yellow-400 font-bold' : 'bg-black border-white/20 hover:bg-white/10'}`}>Alto Contraste</button>
                        </div>
                    </div>
                    <div className="space-y-3">
                        <label className="text-sm font-semibold text-gray-400 flex items-center gap-2"><Type size={14}/> Tamaño de Letra</label>
                        <div className="flex gap-2">
                            {(['sm', 'base', 'lg', 'xl'] as const).map(s => (
                                <button key={s} onClick={() => setFontSize(s)} className={`flex-1 py-2 rounded-xl border ${fontSize === s ? 'bg-indigo-600 border-indigo-500' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                                    {s === 'sm' ? 'A-' : s === 'xl' ? 'A+' : 'A'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-3">
                        <label className="text-sm font-semibold text-gray-400 flex items-center gap-2"><AlignLeft size={14}/> Espaciado</label>
                        <div className="grid grid-cols-3 gap-2">
                            {(['normal', 'relaxed', 'loose'] as const).map(s => (
                                <button key={s} onClick={() => setLineSpacing(s)} className={`py-2 rounded-xl border text-sm ${lineSpacing === s ? 'bg-indigo-600 border-indigo-500' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                                    {s === 'normal' ? 'Denso' : s === 'relaxed' ? 'Medio' : 'Laxo'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-3">
                        <label className="text-sm font-semibold text-gray-400 flex items-center gap-2">
                            🧠 Nivel Leo
                            <span className="ml-auto text-indigo-400 text-xs font-normal normal-case">adapta intervenciones</span>
                        </label>
                        <div className="grid grid-cols-3 gap-2">
                            {(['inicial', 'medio', 'avanzado'] as const).map(lvl => (
                                <button
                                    key={lvl}
                                    onClick={() => setLeoMemory(prev => ({ ...prev, difficultyLevel: lvl }))}
                                    className={`py-2 rounded-xl border text-xs font-bold capitalize ${leoMemory.difficultyLevel === lvl ? 'bg-indigo-600 border-indigo-500 text-white' : 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300'}`}
                                >
                                    {lvl}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* D: RESUME TOAST — shown once per open when progress ≥ 5% */}
            {resumeToast && (
                <div
                    className="fixed bottom-24 left-6 z-50 px-4 py-3 rounded-2xl shadow-xl border border-white/15 bg-neutral-900/80 backdrop-blur-md text-white animate-in slide-in-from-bottom-5 fade-in duration-400 max-w-xs flex items-center gap-3"
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
                        <p className="text-xs text-white/60 leading-snug truncate">
                            Retomando desde {resumeToast.label}
                        </p>
                    </div>
                    <button
                        onClick={() => { if (resumeToastTimerRef.current) clearTimeout(resumeToastTimerRef.current); setResumeToast(null); }}
                        className="shrink-0 p-1 rounded-full hover:bg-white/10 transition-colors"
                        aria-label="Cerrar"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* REWARD TOASTS — bottom-left, non-blocking, never interrupts reading */}
            <RewardToasts toasts={rewardToasts} />

            {/* NEXT CONTENT INDICATOR — appears near session end, pointer-events enabled for skip */}
            {nextContentRef.current && leoMemory.sessionReadingProgress >= 93 && !isTransitioning && (
                <div
                    className="fixed bottom-28 left-1/2 -translate-x-1/2 z-30 flex items-center gap-2 px-4 py-2 rounded-full bg-neutral-900/60 backdrop-blur-sm border border-white/10 animate-in fade-in duration-700"
                    style={{ opacity: 1 - tranceIntensity * 0.9 }}
                >
                    <span className="text-xs text-white/40">Próximo:</span>
                    <span className="text-xs text-white/60 max-w-[160px] truncate">{nextContentRef.current.titulo}</span>
                    <button
                        onClick={() => triggerTransitionRef.current()}
                        className="text-xs text-indigo-400/60 hover:text-indigo-300 ml-1 transition-colors"
                    >→</button>
                </div>
            )}

            {/* CONTENT TRANSITION OVERLAY — covers state reset gap between contents */}
            {isTransitioning && (
                <div className="absolute inset-0 z-[75] bg-neutral-950 animate-in fade-in duration-300 pointer-events-none" />
            )}

            {/* ACCESS DENIAL — soft overlay, appears only if server denies after render */}
            {accessDenied && (
                <div className="absolute inset-0 z-[70] bg-black/95 backdrop-blur-sm flex flex-col items-center justify-center p-8 animate-in fade-in duration-300">
                    <div className="text-6xl mb-4">🔒</div>
                    <h2 className="text-2xl font-bold text-white mb-3">Acceso no autorizado</h2>
                    <p className="text-gray-400 text-center max-w-sm mb-6">{accessDenyReason || 'No tienes permiso para acceder a este contenido.'}</p>
                    <button
                        onClick={() => navigate(-1)}
                        className="px-6 py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-500 transition-colors"
                    >
                        ← Volver
                    </button>
                </div>
            )}

        </div>
    );
};

export default VisorInmersivo;
