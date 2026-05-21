import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, useMemo } from 'react';
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
// Sprint Data Backbone — Fase 2: paridad de sesión vía /api/v1/events.
// Convive con analyticsService.track / usePlaybackAnalytics / pbLog. NO los reemplaza.
import { useBackboneReadingSession } from '../hooks/useBackboneReadingSession';
// Logger estructurado para auditoría del flujo inmersivo. OFF en prod por default;
// activable runtime con localStorage.setItem('immersive_debug', '1').
import { immersiveLog } from '../utils/immersiveLogger';
// INVARIANTE 2 — bloqueo central de auto-navegación entre libros.
// Todo navigate('/leer/inmersivo/<id>') DEBE pasar por assertManualNavigation
// con reason whitelisted (user_click_next, user_click_book_card, user_explicit_navigation).
import { assertManualNavigation } from '../utils/immersiveNavigation.js';
// F8 — validador de visibilidad real de la frase activa. Verifica rect,
// computed style, opacity, banda activa, clase requerida. Si falla, NO se
// emite visual_highlight_ack y la machine bloquea audio (REQUEST_AUDIO_START).
import { validateActiveSentenceVisibility } from '../utils/validateActiveSentenceVisibility.js';
import { detectSentenceAudioMode, audioModeToLogPayload } from '../utils/sentenceAudioMode.mjs';
// M-5.4.1 — observabilidad viva del runtime. El watchdog es PASIVO: solo
// observa el output de pb.getRuntimeDiagnostics() y emite warnings. NO
// auto-corrige. La decisión humana queda fuera del runtime.
import { startRuntimeWatchdog } from '../utils/runtimeWatchdog.mjs';
import { getRuntimeMemorySnapshot, classifyMemorySnapshot } from '../utils/runtimeMemorySnapshot.mjs';
// M-5.4.2 — runner operacional para smokes A–G. NO runtime code. Solo se
// expone bajo el mismo dev gate que __pbDiag/etc.
import { createSmokeCapture } from '../utils/smokeCapture.mjs';
// M-5.4.10 — estabilización perceptual. Decisiones PURAS visual-only; el visor
// las usa, los tests las ejercen. NO mutan playback/audio/executor.
import { decideFitTier, TERMINAL_TIER } from '../utils/activeSentenceFitLadder.mjs';
import { computeVisualDensityPlan, computeVisualPacing } from '../utils/visualDensityPlan.mjs';

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

/**
 * Construye la clave de sessionStorage para la memoria de Leo, namespaced por
 * userId + contentId. Sin esto, dos usuarios que comparten browser mezclaban
 * estado pedagógico de Leo (anchors recientes, difficultyLevel, behavior).
 *
 * Fallbacks 'guest' / 'unknown' garantizan que la key sea siempre escribible
 * incluso si user o content aún no están hidratados. La migración silenciosa
 * (ver effect dentro del componente) traslada la key antigua `leo_session_<cid>`
 * al nuevo formato una sola vez.
 */
function leoSessionKey(uid: string | undefined, cid: string | undefined): string {
    return `leo_session_${uid ?? 'guest'}_${cid ?? 'unknown'}`;
}

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
    // Suprime el incremento de behavior.pauses en Leo memory cuando el pause viene del
    // fin de sesión (BlockEngine.complete o onSessionEnd del audio), no de una acción
    // del usuario. Lo setea cada path de fin-de-sesión antes de pb.pause / setSessionComplete.
    const sessionCompletingRef = useRef(false);

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
    // M-5.3.4: refs nuevas para que el hook acceda al modo + anchors timestamps.
    // anchorsMap actual del runtime (chunk → anchor[]). Aún no contiene timestamps,
    // pero la API queda lista para cuando se agreguen (Whisper / forced-alignment).
    const anchorsMapRefForHook = useRef<Record<number, any[]> | null>(null);
    const audioModeRefForHook  = useRef<
        'perSentence' | 'perChunkWithAnchors' | 'perChunkNoAnchors' | 'ttsDynamic' | 'unknown' | null
    >(null);
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
        // Fin de sesión por audio: el último fragmento terminó. NO navegar a otro libro.
        // Mostrar pantalla "Lectura Completada" (sessionComplete) — el usuario decide
        // continuar (+5 min) o salir. El path manual al siguiente libro vive solo en el
        // botón → del banner "Próximo" (a >=93% de progreso).
        immersiveLog('SESSION_END_FROM_AUDIO', {
            contentId: analyticsContentIdRef.current,
            userId: analyticsUserIdRef.current,
        });
        sessionCompletingRef.current = true;
        setSessionComplete(true);
        // Audio ya está en estado 'paused' (esta callback viene de handleEnded en el hook),
        // por lo que NO se necesita pb.pause() aquí.
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
        // M-5.3.4: refs nuevas — opcionales para back-compat. El hook degrada a
        // perSentence si audioModeRef.current es null/ausente.
        anchorsMapRef: anchorsMapRefForHook,
        audioModeRef:  audioModeRefForHook,
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
    // F19/Cambio B: ref mirror de isHydrating para que el drift detector pueda
    // distinguir lifecycle violation real de transitorios legítimos durante carga.
    const isHydratingRef = useRef(true);
    isHydratingRef.current = isHydrating;

    // ─── BACKBONE v1: paridad de sesión ──────────────────────────────────────
    // Emite immersive.session_start / session_heartbeat / session_end hacia
    // /api/v1/events. Es un canal nuevo en paralelo a:
    //   - analyticsService.track legacy (analytics_db.json)
    //   - usePlaybackAnalytics (playback_events.log)
    //   - pbLog (/api/events)
    // Ninguno de los anteriores se elimina ni se modifica.
    //
    // enabled: misma señal que la legacy session_start (post-hydration con
    // sentences cargadas). Cuando isHydrating o sentences.length cambian,
    // el hook reinicia su sesión interna sin afectar a los engines.
    const backboneSession = useBackboneReadingSession({
        enabled:    !isHydrating && !!user?.id && !!content?.id && sentences.length > 1,
        userId:     user?.id,
        contentId:  content.id,
        mode:       'immersive',
        getProgressFraction: () => {
            const total = sentencesRef.current.length;
            return total > 0 ? pb.currentIndex / total : 0;
        },
        getPayload: () => ({
            source:               'VisorInmersivo',
            currentSentenceIndex: pb.currentIndex,
            totalSentences:       sentencesRef.current.length,
            playbackSpeed,
        }),
    });

    // Always-fresh trigger: ÚNICA puerta de salida hacia navegación cross-content.
    // INVARIANTE 2: exige un `reason` whitelisted (user_click_next | user_click_book_card |
    // user_explicit_navigation). Cualquier caller automático (BlockEngine.complete,
    // onSessionEnd, ContentQueue, fallback, etc.) que invoque esta función sin reason
    // manual es bloqueado por assertManualNavigation y loguea fatal en dev.
    //
    // NO REINTRODUCIR navegación automática entre libros. El contentId de la ruta
    // gobierna la sesión inmersiva. Ver docs/immersive-mode-invariants.md.
    const triggerTransitionRef = useRef<(reason?: string, source?: string) => void>(() => {});
    triggerTransitionRef.current = (reason?: string, source?: string) => {
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

        // INVARIANTE 2 — guard de navegación manual. Si reason no está en la
        // whitelist (user_click_next | user_click_book_card | user_explicit_navigation),
        // bloquear y loguear fatal. En dev/test lanza para detectar regresión.
        const navGuard = assertManualNavigation({
            fromContentId: content.id,
            toContentId:   next.id,
            reason:        reason ?? 'unspecified',
            source:        source ?? 'triggerTransitionRef',
            isDev:         import.meta.env.DEV === true,
        });
        if (!navGuard.ok) {
            immersiveLog('FATAL_MISMATCH', {
                kind: 'autonav_blocked',
                fromContentId: content.id,
                toContentId: next.id,
                reason: navGuard.reason,
                source: source ?? 'triggerTransitionRef',
            });
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
            // IMMERSIVE_NAV_OK: gateado por assertManualNavigation arriba en esta misma
            // función. La única ruta que llega aquí pasó por la whitelist de reasons.
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
            // Sin user en el initializer (AuthContext puede no estar hidratado aún),
            // leemos solo la key namespaced del 'guest'. La migración silenciosa más
            // abajo trae la key antigua o la promueve a la del user real al hidratar.
            const stored = sessionStorage.getItem(leoSessionKey(undefined, content?.id));
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

    // Migración silenciosa one-shot de las keys de Leo: traslada
    //   leo_session_<contentId>          (legacy, sin userId)
    //   leo_session_guest_<contentId>    (initializer pre-hidratación)
    // a la key namespaced del user real, una sola vez por par (userId, contentId).
    useEffect(() => {
        if (!user?.id || !content?.id) return;
        const newKey = leoSessionKey(user.id, content.id);
        try {
            if (sessionStorage.getItem(newKey)) return; // ya migrado
            const legacyKey = `leo_session_${content.id}`;
            const guestKey  = leoSessionKey(undefined, content.id);
            const src = sessionStorage.getItem(legacyKey) ?? sessionStorage.getItem(guestKey);
            if (src) {
                sessionStorage.setItem(newKey, src);
                sessionStorage.removeItem(legacyKey);
                sessionStorage.removeItem(guestKey);
                immersiveLog('LEO_MEMORY_MIGRATED', { userId: user.id, contentId: content.id });
            }
        } catch { /* sessionStorage unavailable */ }
    }, [user?.id, content?.id]);

    // Persist Leo memory changes
    const memorySaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        if (!isMemoryLoaded || !user) return;
        sessionStorage.setItem(leoSessionKey(user.id, content.id), JSON.stringify(leoMemory));
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
        // Si el pause viene de fin-de-sesión (BlockEngine.complete o onSessionEnd),
        // no es una pausa del usuario — no inflar behavior.pauses. Consumir el flag.
        if (sessionCompletingRef.current) {
            sessionCompletingRef.current = false;
            return;
        }
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

    // ─── BACKBONE v1: audio_play / audio_pause + markActivity ─────────────────
    // Watches pb.isPlaying transitions. Usa un ref propio (backbonePrevPlayingRef)
    // para no chocar con prevIsPlayingRef del effect de Leo (que re-asigna ese ref
    // en cada cambio). Emite eventos solo en transiciones — duplicados internos
    // del player se deduplican server-side por eventId UNIQUE.
    const backbonePrevPlayingRef = useRef(false);
    useEffect(() => {
        const wasPlaying = backbonePrevPlayingRef.current;
        backbonePrevPlayingRef.current = pb.isPlaying;
        if (pb.isPlaying && !wasPlaying) {
            backboneSession.markActivity();
            backboneSession.emitEvent('audio_play', {
                payload: { sentenceIndex: pb.currentIndex },
            });
        } else if (!pb.isPlaying && wasPlaying) {
            backboneSession.emitEvent('audio_pause', {
                payload: { sentenceIndex: pb.currentIndex },
            });
        }
    }, [pb.isPlaying, pb.currentIndex, backboneSession]);

    // ─── M-5.4.1: Runtime Watchdog + Heartbeat + Dev Console APIs ────────────
    //
    // PASIVO. Solo observa pb.getRuntimeDiagnostics() periódicamente. Cualquier
    // detección de degradación (stall, ownership violation, cache runaway,
    // hardResync cascade, etc.) emite WATCHDOG_* a console.warn. No interviene.
    //
    // Lifecycle: arranca solo cuando hay todo lo necesario para que el snapshot
    // tenga datos significativos. Se detiene en TODOS los paths de teardown.
    //   - Gate: user autenticado, content cargado, runtime hidratado, ≥2 frases.
    //   - Stop: unmount, content switch (deps cambian), gate cae a false,
    //           session complete (no tiene sentido watch sin playback activo).
    //
    // Dev console APIs (window.__pb*) SOLO se exponen en builds dev o con flag
    // localStorage.immersive_debug='1'. Production rollout deberá apagar
    // explícitamente.
    //
    // Heartbeat: cada 30s emite WATCHDOG_HEARTBEAT con resumen del snapshot.
    // Decoupled del tick interno del watchdog (que es cada 5s para detectar
    // degradación; heartbeat es para confirmar runtime alive y dar evidencia
    // operacional sin spam).
    //
    // Memory snapshot: cada 60s lee performance.memory (cuando esté disponible)
    // y emite MEMORY_PRESSURE_WARNING / MEMORY_GROWTH_WARNING si cruza umbrales.
    const watchdogEnabled =
        !isHydrating
        && !!user?.id
        && !!content?.id
        && sentences.length > 1
        && !sessionComplete;

    useEffect(() => {
        if (!watchdogEnabled) return;

        // Capturas frescas para closures del effect.
        const _userId    = user?.id;
        const _contentId = content.id;
        const _isDev     = (() => {
            try {
                if (typeof window === 'undefined') return false;
                const flag = window.localStorage.getItem('immersive_debug');
                if (flag === '1') return true;
                if (flag === '0') return false;
                return import.meta.env.DEV === true;
            } catch { return false; }
        })();

        // Clasificador de severidad para cada evento del watchdog. Determina si
        // el log es un WATCHDOG_RECOVERABLE_WARNING o WATCHDOG_CRITICAL_WARNING.
        // Mantener sincronizado con docs/M5.4-watchdog-audit.md.
        const SEVERITY: Record<string, 'critical' | 'recoverable' | 'info'> = {
            WATCHDOG_STARTED:               'info',
            WATCHDOG_STOPPED:               'info',
            WATCHDOG_HEARTBEAT:             'info',
            WATCHDOG_STALLED_AUDIO:         'recoverable',  // puede ser background tab
            WATCHDOG_STALLED_VISUAL:        'recoverable',
            WATCHDOG_DUPLICATE_OWNERSHIP:   'critical',
            WATCHDOG_TIMER_LEAK:            'recoverable',
            // BLOCKER FINAL V2 / TASK 1 — desync degradado a DIAGNÓSTICO
            // read-only. Antes era 'critical' (console.error + tier
            // WATCHDOG_CRITICAL_WARNING). El watchdog NUNCA acciona; el fix
            // real del desync de chunk vive en el guard de transición gapless
            // (utils/gaplessChunkGuard.mjs). 'info' ⇒ console.warn, sin
            // escalada, sin synthetic critical, sin impacto en playback.
            WATCHDOG_DESYNC_OBSERVED_READONLY: 'info',
            WATCHDOG_CACHE_RUNAWAY:         'recoverable',
            WATCHDOG_HARD_RESYNC_CASCADE:   'critical',
            WATCHDOG_DIAGNOSTICS_THREW:     'critical',
            MEMORY_PRESSURE_WARNING:        'recoverable',
            MEMORY_GROWTH_WARNING:          'recoverable',
        };

        const emit = (event: string, data: Record<string, unknown>) => {
            const sev = SEVERITY[event] ?? 'info';
            const payload = {
                event,
                severity: sev,
                contentId: _contentId,
                userId: _userId,
                ...data,
            };
            // eslint-disable-next-line no-console
            const sink = sev === 'critical' ? console.error : console.warn;
            sink(`[${event}]`, payload);
            // Synthetic tier-event para grep agregado:
            if (sev !== 'info') {
                const tier = sev === 'critical'
                    ? 'WATCHDOG_CRITICAL_WARNING'
                    : 'WATCHDOG_RECOVERABLE_WARNING';
                // eslint-disable-next-line no-console
                console.warn(`[${tier}]`, { sourceEvent: event, ...payload });
            }
        };

        // Watchdog handle — el sessionId que pasamos viaja con todos los logs.
        // Usamos contentId para human-readability; el contentSession numérico
        // ya viaja dentro del snapshot.
        const handle = startRuntimeWatchdog({
            getDiagnostics: () => pb.getRuntimeDiagnostics(),
            sessionId:      _contentId,
            intervalMs:     5000,
            logger:         emit,
        });

        emit('WATCHDOG_STARTED', {
            intervalMs: 5000,
            isDev: _isDev,
            sentencesLen: sentencesRef.current.length,
        });

        // Heartbeat — cada 30s. Resumen mínimo, NO snapshot completo (eso vive
        // detrás de __pbDiag para drill-down manual).
        const heartbeatInterval = setInterval(() => {
            try {
                const snap = pb.getRuntimeDiagnostics();
                emit('WATCHDOG_HEARTBEAT', {
                    sessionId:        snap.sessionId,
                    currentSentence:  snap.currentSentence,
                    currentChunk:     snap.currentChunk,
                    audioMode:        snap.audioMode,
                    isPlaying:        snap.playbackState?.isPlaying,
                    executorAlive:    !!(snap.activeExecutor && snap.activeExecutor.isAlive),
                    cacheSize:        snap.cacheEntries?.audioCache ?? 0,
                    hardResyncCount:  snap.hardResyncCount ?? 0,
                    ownershipViolations: snap.ownershipTokens?.ownershipViolationCount ?? 0,
                });
            } catch (err) {
                // Heartbeat NO debe romper el visor. Silenciamos errores transitorios.
                // eslint-disable-next-line no-console
                console.warn('[WATCHDOG_HEARTBEAT_FAILED]', {
                    error: (err && (err as Error).message) || String(err),
                });
            }
        }, 30_000);

        // Memory snapshot — cada 60s. Solo en builds con performance.memory.
        let prevMemSnap: ReturnType<typeof getRuntimeMemorySnapshot> | null = null;
        const memoryInterval = setInterval(() => {
            try {
                const diag = pb.getRuntimeDiagnostics();
                const snap = getRuntimeMemorySnapshot(diag, { watchdogActive: handle.isAlive() });
                const warnings = classifyMemorySnapshot(snap, prevMemSnap);
                for (const w of warnings) emit(w.event, w.data);
                prevMemSnap = snap;
            } catch (err) {
                // eslint-disable-next-line no-console
                console.warn('[MEMORY_SNAPSHOT_FAILED]', {
                    error: (err && (err as Error).message) || String(err),
                });
            }
        }, 60_000);

        // ── Dev runtime console APIs ─────────────────────────────────────────
        // Solo se exponen en dev o con flag explícito. Cleanup obligatorio.
        let exposedDevAPIs = false;
        if (_isDev && typeof window !== 'undefined') {
            const w = window as unknown as Record<string, unknown>;
            w.__pbDiag = () => {
                try { return pb.getRuntimeDiagnostics(); }
                catch (err) { return { error: (err as Error).message }; }
            };
            w.__pbWatchdog = () => ({
                alive:        handle.isAlive(),
                sessionId:    handle.sessionId,
                lastSnapshot: handle.lastSnapshot(),
            });
            w.__pbRuntime = () => {
                try {
                    const snap = pb.getRuntimeDiagnostics();
                    return {
                        sessionId:           snap.sessionId,
                        contentId:           snap.contentId,
                        audioMode:           snap.audioMode,
                        currentSentence:     snap.currentSentence,
                        currentChunk:        snap.currentChunk,
                        playbackState:       snap.playbackState,
                        syncStrategy:        snap.syncStrategy,
                        ownershipTokens:     snap.ownershipTokens,
                        activeTimers:        snap.activeTimers,
                        cacheEntries:        snap.cacheEntries,
                        cacheMetrics:        snap.cacheMetrics,
                        hardResyncCount:     snap.hardResyncCount,
                        activeAudioSrc:      snap.activeAudioSrc,
                        standbyAudioSrc:     snap.standbyAudioSrc,
                    };
                } catch (err) {
                    return { error: (err as Error).message };
                }
            };
            w.__pbMemory = () => {
                try {
                    const diag = pb.getRuntimeDiagnostics();
                    return getRuntimeMemorySnapshot(diag, { watchdogActive: handle.isAlive() });
                } catch (err) {
                    return { error: (err as Error).message };
                }
            };

            // M-5.4.2 — Smoke runner. Singleton por mount del visor. El operador
            // controla start/stop/note/snapshot desde la consola. Captura logs
            // estructurados del runtime, snapshots periódicos y memoria, y al
            // stop() emite un JSON estructurado para pegar en el failure journal.
            //
            // NO arranca automáticamente. Operador debe invocar:
            //   __pbSmokeCapture.start({ smoke:'A', operator:'nico', notes:'…' })
            const smokeCapture = createSmokeCapture({
                consoleRef: typeof console !== 'undefined' ? console : undefined,
                diagFn:     () => pb.getRuntimeDiagnostics(),
                memFn:      () => getRuntimeMemorySnapshot(
                    pb.getRuntimeDiagnostics(),
                    { watchdogActive: handle.isAlive() },
                ),
                wdFn:       () => ({
                    alive:        handle.isAlive(),
                    sessionId:    handle.sessionId,
                    lastSnapshot: handle.lastSnapshot(),
                }),
            });
            w.__pbSmokeCapture = smokeCapture;

            exposedDevAPIs = true;
            // eslint-disable-next-line no-console
            console.info('[DEV_RUNTIME_API_READY]', {
                contentId: _contentId,
                userId: _userId,
                api: ['__pbDiag', '__pbWatchdog', '__pbRuntime', '__pbMemory', '__pbSmokeCapture'],
            });
        }

        return () => {
            clearInterval(heartbeatInterval);
            clearInterval(memoryInterval);
            handle.stop();
            if (exposedDevAPIs && typeof window !== 'undefined') {
                const w = window as unknown as Record<string, unknown>;
                // Si el operador dejó una corrida activa, cerrarla limpiamente
                // para que console.* se restaure antes de borrar la referencia.
                const sc = w.__pbSmokeCapture as { stop?: (o?: object) => unknown } | undefined;
                if (sc && typeof sc.stop === 'function') {
                    try { sc.stop({ silent: true }); } catch { /* defensivo */ }
                }
                delete w.__pbDiag;
                delete w.__pbWatchdog;
                delete w.__pbRuntime;
                delete w.__pbMemory;
                delete w.__pbSmokeCapture;
            }
            // WATCHDOG_STOPPED ya lo emite el handle.stop() internamente.
        };
    // Re-arma cuando cambian las condiciones de gate. pb es estable (mismo ref
    // por mount); sentencesRef.current se lee dentro del interval por tanto NO
    // disparamos restart por cambios de length intra-mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [watchdogEnabled, user?.id, content.id]);

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
    // F9: ref al div con transform translateY (dentro de ImmersiveShell).
    // Usado por revealActiveSentence para aplicar transform directo y forzar
    // que el siguiente getBoundingClientRect refleje la nueva posición sin
    // esperar el próximo render de React.
    const transformWrapperRef = useRef<HTMLDivElement | null>(null);

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
        // F19/Cambio D — captura el contentId al subscribe time para invalidar
        // callbacks tardíos del libro anterior tras un content change.
        const subscribedContentId = analyticsContentIdRef.current;

        const unsubscribe = engine.subscribe((event) => {
            // F19/Cambio D — guards de lifecycle. Si el visor se desmontó o el
            // libro cambió desde el subscribe, ignorar eventos tardíos del
            // BlockEngine. Sin esto, el timer del libro anterior podía disparar
            // 'complete' tras un cambio de contenido y mutar state del libro nuevo.
            if (unmounted.current) return;
            if (analyticsContentIdRef.current !== subscribedContentId) return;
            switch (event.type) {
                case 'tick':
                    // Keep timeLeft display accurate via engine's timestamp-based elapsed
                    setTimeLeft(Math.ceil(event.remaining / 1000));
                    break;
                case 'complete':
                    // F20/P1 — Overlay BLOQUEANTE controlado (Opción B).
                    //
                    // Cuando el timer llega a 0:
                    //   - SÍ se pausa audio (controlado, NO destruye buffer
                    //     gracias a F10: PAUSE preserva buffer.current).
                    //   - SÍ se muestra overlay informativo (sigue siendo
                    //     overlay inline, no desmonta — Cambio A de F19).
                    //   - NO hardResync, NO content change, NO buffer cancel.
                    //   - Botón "+5 Minutos" extiende timer y reanuda.
                    //   - Botón "Salir" navega atrás con sesión cerrada.
                    //
                    // La frase activa sigue visible debajo del overlay (Cambio A).
                    // Tras "+5 Minutos", el resume() pasa por gates normales.
                    immersiveLog('BLOCK_COMPLETE_END_SESSION', {
                        contentId: analyticsContentIdRef.current,
                        userId: analyticsUserIdRef.current,
                        elapsed: event.elapsed,
                        duration: event.duration,
                        audioPolicy: 'pause',
                    });
                    immersiveLog('CONTENT_LOADED', {
                        kind: 'PB_BLOCK_COMPLETE_OVERLAY_SHOWN',
                        contentId: analyticsContentIdRef.current,
                        userId: analyticsUserIdRef.current,
                        currentIndex: pb.currentIndex,
                    });
                    immersiveLog('CONTENT_LOADED', {
                        kind: 'PB_BLOCK_COMPLETE_AUDIO_POLICY_PAUSE',
                        contentId: analyticsContentIdRef.current,
                    });
                    sessionCompletingRef.current = true;
                    setSessionComplete(true);
                    // F20: pausa controlada. F10 garantiza que buffer.current
                    // se preserva (status reading → visible). La frase sigue
                    // ack-confirmada para que un futuro resume pase los gates.
                    pb.pause();
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
        // AbortController: corta fetches in-flight del engine anterior al cambiar
        // contentId. Sin esto, un fetch lento del libro A podría resolver y mutar
        // state cuando el componente ya está en libro B (race condition).
        const ac = new AbortController();
        const engine = new StartupEngine(content.id, content.texto_plano_url, ac.signal);
        engineRef.current = engine;
        immersiveLog('IMMERSIVE_INIT',  { contentId: content.id, userId: user?.id });
        immersiveLog('ENGINE_START',    { contentId: content.id, hasTextUrl: !!content.texto_plano_url });

        const unsubscribe = engine.subscribe((state) => {
            // Guard anti-stale: si entretanto se creó un nuevo engine (cambio de
            // contentId), este subscriber no debe mutar el state del componente.
            if (engine !== engineRef.current) {
                immersiveLog('GUARD_STALE_ENGINE', { contentId: content.id });
                return;
            }
            if (state.status !== 'ready') return;
            immersiveLog('CONTENT_LOADED', {
                contentId: content.id,
                sentences: state.sentences.length,
                hasManifest: !!state.manifest,
                anchors: Object.keys(state.anchorsMap).length,
            });
            sentenceToChunk.current = state.sentenceToChunk;
            manifest.current = state.manifest;
            if (state.sentences.length > 0) {
                setSentences(state.sentences);
                setAudioSentences(state.sentences);
            }
            setAnchorsMap(state.anchorsMap);
            setIsHydrating(false);

            // ── M-5.3.3 — SentenceAudioMode detection ──────────────────────
            // M-5.3.4 — además de loguear, alimentamos refs que el hook usa
            // para spawn del SyncStrategyExecutor en pb.load.
            const _audioMode = detectSentenceAudioMode({
                manifest:          state.manifest,
                anchorsMap:        state.anchorsMap,
                sentenceToChunk:   state.sentenceToChunk,
                audioSentencesLen: state.sentences.length,
                contentId:         content.id,
            });
            audioModeRefForHook.current  = _audioMode.mode;
            anchorsMapRefForHook.current = state.anchorsMap ?? null;
            immersiveLog('CONTENT_LOADED', audioModeToLogPayload(_audioMode));
            if (_audioMode.degradedReason) {
                // eslint-disable-next-line no-console
                console.warn(
                    `[PB_AUDIO_MODE] ${_audioMode.mode} (degraded) — ` +
                    `${_audioMode.degradedReason}. Strategy: ${_audioMode.strategy}`,
                    _audioMode.diagnostics,
                );
            } else {
                // eslint-disable-next-line no-console
                console.log(
                    `[PB_AUDIO_MODE] ${_audioMode.mode} — ${_audioMode.strategy}`,
                    _audioMode.diagnostics,
                );
            }
        });

        engine.start();

        // F20/P3 — log de bootstrap del content change. Permite diagnosticar
        // cuando el libro nuevo queda en "Sin audio" o status='error': se ve
        // si arrancó correctamente, qué session pasó al hook, qué status quedó.
        if (!isFirstContentRenderRef.current) {
            immersiveLog('CONTENT_LOADED', {
                kind: 'PB_CONTENT_CHANGE_BOOTSTRAP_START',
                contentId: content.id,
                userId: user?.id,
                fromContentId: analyticsContentIdRef.current,
                pbStatusBefore: pb.status,
            });
        }

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
                const stored = sessionStorage.getItem(leoSessionKey(user?.id, content.id));
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
            // Guard anti-stale: si el contentId cambió mientras esperamos la red,
            // no mutar fromRemoteProgressRef del nuevo contenido con datos del viejo.
            const reqContentId = content.id;
            dataService.fetchAndMergeRemoteProgress(user.id, content.id)
                .then(fromRemote => {
                    if (reqContentId !== analyticsContentIdRef.current) {
                        immersiveLog('GUARD_STALE_PROGRESS', {
                            reqContentId,
                            current: analyticsContentIdRef.current,
                        });
                        return;
                    }
                    fromRemoteProgressRef.current = fromRemote;
                })
                .catch(() => {});
        }

        return () => {
            ac.abort();
            unsubscribe();
            immersiveLog('CLEANUP', { contentId: content.id });
        };
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
            let restoreSource: 'anchor' | 'sentence' | 'percentage' | 'none' = 'none';
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
                    restoreSource = 'anchor';
                } else if (hasExactSentence && isLastImmersive) {
                    targetIndex = Math.min(exactSentence as number, sentences.length - 1);
                    restoreSource = 'sentence';
                } else if (prog.porcentaje > 0) {
                    const resumeIdx = Math.floor((prog.porcentaje / 100) * sentences.length);
                    targetIndex = Math.min(resumeIdx, sentences.length - 1);
                    restoreSource = 'percentage';
                }
            }
            immersiveLog('PROGRESS_RESTORE', {
                contentId: content.id,
                userId: user.id,
                source: restoreSource,
                targetIndex,
            });
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

        immersiveLog('PLAY', {
            contentId: content.id,
            userId: user?.id,
            targetIndex,
            isAutoTransition,
        });
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
            // F5 — STRICT GATING: el guard anterior (basado solo en timers
            // pendientes) era parcial. Ahora `pb.canSaveProgress` exige que
            // la frase haya sido destacada visualmente, reproducida y marcada
            // completed en la machine. Si bloqueado → log y abort, sin tocar
            // playback (regla: bloquear progreso NO afecta audio).
            const gate = pb.canSaveProgress(currentIndex);
            if (!gate.ok) {
                immersiveLog('PROGRESS_SAVE', {
                    contentId: content.id,
                    userId: user.id,
                    currentIndex,
                    blocked: true,
                    reason: gate.reason,
                    tag: 'PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION',
                });
                return;
            }
            // QW-3: delta incremental (no absoluto desde session start).
            const nowElapsed = Date.now() - sessionStartRef.current;
            const deltaMs = Math.max(0, nowElapsed - lastElapsedSentRef.current);
            lastElapsedSentRef.current = nowElapsed;
            immersiveLog('PROGRESS_SAVE', {
                contentId: content.id,
                userId: user.id,
                currentIndex,
                deltaMs,
                tag: 'PB_PROGRESS_SAVE_ALLOWED',
            });
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
            // F5: el flush de salida también debe pasar por el gate. Si la frase
            // actual no fue completada, NO guardar — la próxima sesión retomará
            // desde el último índice persistido legítimamente.
            if (saveTimeoutRef.current && user && sentences.length > 1) {
                const gate = pb.canSaveProgress(currentIndex);
                if (gate.ok) {
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
                } else {
                    immersiveLog('PROGRESS_SAVE', {
                        contentId: content.id,
                        userId: user.id,
                        currentIndex,
                        blocked: true,
                        reason: gate.reason,
                        tag: 'PB_PROGRESS_SAVE_BLOCKED_NO_COMPLETION',
                        via: 'cleanup_flush',
                    });
                }
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
    // F16: schedule de diagnóstico universal. Tras 1500ms de un togglePlay
    // sin que pb pase a 'playing', emite PB_START_DIAGNOSTIC con snapshot
    // completo del estado runtime. Cancela el timer si pb.isPlaying llega
    // antes (caso normal).
    const startDiagnosticTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const togglePlay = () => {
        if (pb.isPlaying)           { pb.pause(); return; }
        // Schedule diagnostic
        if (startDiagnosticTimerRef.current) clearTimeout(startDiagnosticTimerRef.current);
        const targetIdx = pb.currentIndex;
        startDiagnosticTimerRef.current = setTimeout(() => {
            startDiagnosticTimerRef.current = null;
            // Si en 1500ms no llegamos a 'playing', algo bloqueó.
            if (!pb.isPlaying) {
                immersiveLog('FATAL_MISMATCH', {
                    kind: 'PB_START_DIAGNOSTIC',
                    contentId: content.id, userId: user?.id,
                    triggeredAfterMs: 1500,
                    snapshot: pb.getStartDiagnostic(targetIdx),
                });
            }
        }, 1500);

        if (pb.status === 'paused') pb.resume();
        else                        pb.load(pb.currentIndex, true);
    };

    // F16: cancelar diagnostic timer cuando el playback efectivamente arranca
    useEffect(() => {
        if (pb.isPlaying && startDiagnosticTimerRef.current) {
            clearTimeout(startDiagnosticTimerRef.current);
            startDiagnosticTimerRef.current = null;
        }
    }, [pb.isPlaying]);

    // F13 — botones de navegación local. SOLO cambian el índice activo:
    // pause + prepareSentence + setIdx + status='paused'. El user reanuda
    // con un click de play que pasa por visual ack + audio readiness gates.
    // Logs PB_MANUAL_PREVIOUS_SENTENCE / PB_MANUAL_NEXT_SENTENCE para auditoría.
    // M-5.4.7 Task 4 — Nav spam instrumentation.
    // Helper que registra cada gesto manual + emite NAV_SPAM_SEQUENCE para
    // observar bursts rápidos (>3 acciones/segundo). NO bloquea — solo emite.
    const _recordNavSpam = useCallback((action: 'next' | 'previous', toIndex: number) => {
        const now = Date.now();
        const seq = navSpamSequenceRef.current;
        seq.actionCount += 1;
        seq.lastFiveActions.push({ action, ts: now, index: toIndex });
        if (seq.lastFiveActions.length > 5) seq.lastFiveActions.shift();
        const burstMs = seq.lastActionAt > 0 ? now - seq.lastActionAt : null;
        seq.lastActionAt = now;
        // eslint-disable-next-line no-console
        console.log('[NAV_SPAM_SEQUENCE]', {
            action,
            generation:      seq.actionCount,
            timestamp:       now,
            currentIndex:    toIndex,
            burstMsSincePrev: burstMs,
            last5:           seq.lastFiveActions.slice(),
        });
    }, []);

    const goToPreviousSentence = useCallback(() => {
        immersiveLog('CONTENT_LOADED', {
            kind: 'PB_MANUAL_PREVIOUS_SENTENCE',
            contentId: content.id, userId: user?.id,
            from: pb.currentIndex, total: sentences.length,
        });
        _recordNavSpam('previous', Math.max(0, pb.currentIndex - 1));
        pb.manualSentenceJump(pb.currentIndex - 1, 'button_previous');
    }, [pb, content.id, user?.id, sentences.length, _recordNavSpam]);

    const goToNextSentence = useCallback(() => {
        immersiveLog('CONTENT_LOADED', {
            kind: 'PB_MANUAL_NEXT_SENTENCE',
            contentId: content.id, userId: user?.id,
            from: pb.currentIndex, total: sentences.length,
        });
        _recordNavSpam('next', pb.currentIndex + 1);
        pb.manualSentenceJump(pb.currentIndex + 1, 'button_next');
    }, [pb, content.id, user?.id, sentences.length, _recordNavSpam]);

    // Live speed update — aplica inmediatamente a los elementos de audio del hook
    useEffect(() => {
        if (pb.audioRefA.current) pb.audioRefA.current.playbackRate = playbackSpeed;
        if (pb.audioRefB.current) pb.audioRefB.current.playbackRate = playbackSpeed;
    }, [playbackSpeed]);

    // F8/F9 — ACTIVE SENTENCE VISIBILITY VALIDATOR + REVEAL.
    //
    // F8: validateActiveSentenceVisibility verifica que la frase activa esté
    //     verdaderamente visible (no solo que React reconcilió el atributo).
    //
    // F9: si la validación falla por causa "corregible" (outside_viewport,
    //     outside_active_band, opacity_too_low transitorio), llamamos
    //     revealActiveSentence para reposicionar el transform translateY
    //     y re-validamos en el mismo tick. Si sigue fallando, schedule un
    //     RAF retry hasta deadline 300ms. Si vence sin éxito → ack rechazado.
    //
    // Para causas "no corregibles" (active_missing/duplicate/index_mismatch/
    // empty_text/missing_active_class) se rechaza inmediato sin reveal ciego.
    //
    // M-5.4.6 — lastAckedVisualIndexRef eliminado junto con el writer del visor.
    const revealRetryTimerRef     = useRef<number | null>(null);

    // ────────────────────────────────────────────────────────────────────
    // M-5.4.6 (Phase 1.b.C Task 1) — ADAPTIVE GEOMETRIC FIT.
    //
    // El tier del active sentence ahora se decide por MEDICIÓN REAL del
    // rect post-render, NO por text.length. Flujo:
    //
    //   1. currentIndex cambia → fitStateRef se resetea a 'normal'.
    //   2. Render con tier='normal' → useLayoutEffect mide rect vs controlsTop.
    //   3. Si overlap + retries < 2 → setActiveFitTier(next) → re-render.
    //   4. Máximo 2 downgrades: normal → long → very-long.
    //   5. Si very-long todavía overlapea → emit ACTIVE_SENTENCE_OVERFLOW_UNRESOLVED.
    //
    // Bound deterministic: max 3 renders por sentence (normal, long, very-long).
    // ────────────────────────────────────────────────────────────────────
    // M-5.4.10 / TASK 2 — escalera extendida: normal→long→very-long→emergency
    // →scroll-safe. scroll-safe es terminal y GARANTIZA no-overlap (clamp).
    const [activeFitTier, setActiveFitTier] = useState<'normal' | 'long' | 'very-long' | 'emergency' | 'scroll-safe'>('normal');
    // M-5.4.10 / TASK 2 — px de la banda segura para el clamp scroll-safe.
    // null = sin clamp (tiers tipográficos normales). Solo se setea cuando el
    // pipeline llega a 'scroll-safe' → el texto queda contenido, NUNCA detrás
    // de los controles, con overflow-y interno.
    const [scrollSafeMaxPx, setScrollSafeMaxPx] = useState<number | null>(null);
    const fitStateRef = useRef<{
        index: number;
        tier: 'normal' | 'long' | 'very-long' | 'emergency' | 'scroll-safe';
        retries: number;
        firstRenderAt: number | null;   // M-5.4.7 Task 1 — perf instrumentation
        renderCount: number;            // M-5.4.7 Task 1
    }>(
        { index: -1, tier: 'normal', retries: 0, firstRenderAt: null, renderCount: 0 }
    );

    // ── M-5.4.10 / TASK 1 + 4 — densidad visual + pacing (PURO, visual-only) ──
    // computeVisualDensityPlan/computeVisualPacing NO tocan playback/audio/
    // executor. El plan decide cuánto CONTEXTO legible mostrar (frase corta)
    // o si compactar (frase larga); el pacing suaviza la animación de scroll.
    const densityPlan = useMemo(
        () => computeVisualDensityPlan({ sentences, currentIndex }),
        [sentences, currentIndex],
    );
    const _prevPacingIndexRef = useRef<number>(currentIndex);
    const visualPacing = useMemo(() => {
        const from = _prevPacingIndexRef.current;
        const _txt = sentences[currentIndex] ?? '';
        // M-5.4.14 / TASK 5 — estimación PURA y barata (sin DOM): lineCount ≈
        // chars / 42 (ancho perceptual típico del lector); complexity ≈
        // densidad de puntuación de cláusula (comas/;/:/—/paréntesis). Solo
        // afecta la duración VISUAL — jamás el timing de audio.
        const _lineCount  = Math.max(1, Math.ceil(_txt.length / 42));
        const _punct      = (_txt.match(/[,;:—()«»"]/g) || []).length;
        const _complexity = _txt.length > 0
            ? Math.max(0, Math.min(1, _punct / Math.max(1, _txt.length / 18)))
            : 0;
        const pacing = computeVisualPacing({
            fromIndex:     from,
            toIndex:       currentIndex,
            activeChars:   _txt.length,
            lineCount:     _lineCount,
            complexity:    _complexity,
            playbackSpeed,
        });
        _prevPacingIndexRef.current = currentIndex;
        return pacing;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentIndex, playbackSpeed]);
    // Log observacional gated por índice (1 por frase, sin spam, sin loop,
    // sin reconciliador — solo emite lo que el plan PURO ya decidió).
    const _densityLoggedIdxRef = useRef<number>(-1);
    useEffect(() => {
        if (_densityLoggedIdxRef.current === currentIndex) return;
        _densityLoggedIdxRef.current = currentIndex;
        const ev = densityPlan.mode === 'expanded' ? 'VISUAL_DENSITY_EXPANDED'
                 : densityPlan.mode === 'compacted' ? 'VISUAL_DENSITY_COMPACTED'
                 : 'VISUAL_DENSITY_NORMALIZED';
        // eslint-disable-next-line no-console
        console.log(`[${ev}]`, {
            index: currentIndex,
            activeChars: densityPlan.activeChars,
            windowChars: densityPlan.windowChars,
            contextLookahead: densityPlan.contextLookahead,
            reason: densityPlan.reason,
            contentId: content.id,
        });
        // eslint-disable-next-line no-console
        console.log('[VISUAL_PACING_APPLIED]', {
            index: currentIndex,
            indexDelta: visualPacing.indexDelta,
            reason: visualPacing.reason,
        });
        // eslint-disable-next-line no-console
        console.log('[VISUAL_PACING_DURATION]', {
            index: currentIndex,
            durationMs: visualPacing.durationMs,
            playbackSpeed,
        });
        if (visualPacing.segmented) {
            // eslint-disable-next-line no-console
            console.log('[VISUAL_PACING_SEGMENTED]', {
                index: currentIndex,
                activeChars: densityPlan.activeChars,
                note: 'extreme_sentence_visually_contained_by_fit_pipeline',
            });
        }
        // ── M-5.4.14 / TASK 1 — FINAL_TRANSITION_TRACE + FINAL_VISUAL_STATE ──
        // Observabilidad pura por transición de frase (1/idx, sin spam, sin
        // loop, sin reconciliador). Permite al smoke construir la tabla de
        // métricas (drift/blackout/restart/nav/perf) sin instrumentación
        // adicional. NO cambia control-flow ni runtime.
        let _diag: Record<string, unknown> = {};
        try { _diag = pb.getRuntimeDiagnostics?.() ?? {}; } catch { _diag = {}; }
        // eslint-disable-next-line no-console
        console.log('[FINAL_TRANSITION_TRACE]', {
            index: currentIndex,
            audioMode: (_diag as any).audioMode ?? null,
            densityMode: densityPlan.mode,
            pacingMs: visualPacing.durationMs,
            indexDelta: visualPacing.indexDelta,
            fitTier: activeFitTier,
            scrollSafe: scrollSafeMaxPx !== null,
            contentId: content.id,
        });
        // eslint-disable-next-line no-console
        console.log('[FINAL_VISUAL_STATE]', {
            index: currentIndex,
            activeFitTier,
            lastSettledTier: lastSettledTierRef.current,
            scrollSafeMaxPx,
            holding: visualHoldStateRef.current.holding,
            holdEpisode: visualHoldStateRef.current.episode,
            activeExecutor: (_diag as any).activeExecutor ?? null,
            hardResyncCount: (_diag as any).hardResyncCount ?? null,
            staleCallbackRejects: (_diag as any).staleCallbackRejects ?? null,
            contentId: content.id,
        });
    }, [currentIndex, densityPlan, visualPacing, content.id, playbackSpeed, pb, activeFitTier, scrollSafeMaxPx]);

    // M-5.4.7 Task 2 — flag para evitar spam de IMMERSIVE_CONTROLS_MARKER_MISSING
    // (un solo log por mount; el operador sabe el state inicial sin spam).
    const controlsMarkerMissingLoggedRef = useRef(false);
    // M-5.4.7 Task 4 — counter de IMMERSIVE_CONTROLS_MARKER_MISSING para health snapshot.
    const controlsMarkerMissingCountRef = useRef(0);
    // M-5.4.7 Task 3 — tracking de viewport dims para detectar resize/orientation real.
    const lastViewportRef = useRef<{ w: number; h: number; o: string }>({
        w: typeof window !== 'undefined' ? window.innerWidth : 0,
        h: typeof window !== 'undefined' ? window.innerHeight : 0,
        o: typeof window !== 'undefined' && window.matchMedia?.('(orientation: landscape)').matches
            ? 'landscape' : 'portrait',
    });
    // M-5.4.7 Task 4 — counters de runtime hygiene.
    const navSpamSequenceRef = useRef<{
        lastActionAt: number;
        actionCount: number;
        lastFiveActions: Array<{ action: string; ts: number; index: number }>;
    }>({
        lastActionAt: 0,
        actionCount: 0,
        lastFiveActions: [],
    });

    // F9: corregibles → conviene intentar reveal antes de rechazar.
    const REVEAL_CORRECTABLE_REASONS = new Set([
        'outside_viewport', 'outside_active_band', 'opacity_too_low',
    ]);
    // F10 — constantes unificadas. VISUAL_READY_TIMEOUT_MS del hook (800ms)
    // está derivado de estas: REVEAL + TRANSITION + margen.
    const REVEAL_TIMEOUT_MS         = 300;
    const VISUAL_TRANSITION_MAX_MS  = 500;
    // VISUAL_READY_TIMEOUT_MS (≈ 800) vive en el hook; documentado:
    //   VISUAL_READY_TIMEOUT_MS >= REVEAL_TIMEOUT_MS + VISUAL_TRANSITION_MAX_MS
    void VISUAL_TRANSITION_MAX_MS;  // referencia documental — evita unused-var

    // ── M-5.4.12 — VISUAL CONTINUITY GUARD ───────────────────────────────────
    //
    // Causa raíz (perChunkNoAnchors): el fit useLayoutEffect early-returnea en
    // reset-de-tier y en CADA downgrade de la escalera ANTES de aplicar el
    // transform de centrado. Para una frase de chunk gigante eso son hasta 4
    // re-renders (normal→long→very-long→emergency→scroll-safe) donde el
    // wrapper queda en el translateY de la frase ANTERIOR → la nueva frase
    // activa cae fuera de la banda visible (detrás del fade) → viewport negro
    // mientras el audio (executor) sigue avanzando → "se recupera solo" cuando
    // la escalera converge y recién ahí corre applyTransformForActiveSentence.
    //
    // Guard (RENDER-ONLY, cero mutación de runtime/executor/audio/índice):
    //   - lastRenderableSentenceRef preserva la última frase centrada válida.
    //   - Si en un pass la activa NO es renderizable (sin elemento medible /
    //     altura 0 mid-layout) NO se deja el viewport en blanco: se mantiene
    //     el transform de la última frase válida (continuidad) → nunca negro.
    //   - El transform se aplica en CADA pass del fit effect (incluido durante
    //     la convergencia de la escalera), no solo al settle.
    /** @type {{index:number;targetY:number;text:string}|null} */
    const lastRenderableSentenceRef = useRef<{ index: number; targetY: number; text: string } | null>(null);
    const visualHoldStateRef = useRef<{ holding: boolean; episode: number; sinceTs: number }>(
        { holding: false, episode: 0, sinceTs: 0 }
    );

    // F10 — helper interno SILENT: solo aplica transform y setea state.
    // No emite logs. Usado por el RAF retry para evitar spam (60 logs/seg).
    const applyTransformForActiveSentence = useCallback((index: number): { ok: boolean; targetY?: number } => {
        const containerEl = containerRef.current;
        const activeEl    = itemRefs.current[index];
        if (!containerEl || !activeEl) return { ok: false };
        const containerHeight = containerEl.clientHeight;
        const elTop           = activeEl.offsetTop;
        const elHeight        = activeEl.clientHeight;
        if (containerHeight === 0 || elHeight === 0) return { ok: false };

        const targetY = (containerHeight / 2) - (elTop + (elHeight / 2));
        const wrapper = transformWrapperRef.current;
        if (wrapper) {
            // F10: desactivar transition para que el getBoundingClientRect
            // siguiente refleje la nueva posición instantáneamente. Restaurar
            // en el próximo frame para no romper la animación normal.
            wrapper.style.transition = 'none';
            wrapper.style.transform  = `translateY(${targetY}px)`;
            requestAnimationFrame(() => {
                if (wrapper.style.transition === 'none') wrapper.style.transition = '';
            });
        }
        setTranslateY(targetY);
        return { ok: true, targetY };
    }, []);

    // ── M-5.4.12 — apply con CONTINUIDAD VISUAL ──────────────────────────────
    // Envuelve applyTransformForActiveSentence. RENDER-ONLY. NUNCA llama a
    // pb.* / setIdx / dispatch / executor / audio. Reglas:
    //   - ok  → persiste {index,targetY,text} como última frase renderizable;
    //           si veníamos en HOLD, emite VISUAL_CONTINUITY_RELEASE.
    //   - !ok → si hay una última frase válida Y la sesión sigue (audio puede
    //           seguir): re-aplica el translateY de esa última frase (mantiene
    //           la frase anterior visible, NO blanquea, NO fade-out) y emite
    //           VISUAL_CONTINUITY_HOLD + VISUAL_NULL_RENDER_BLOCKED (1 vez por
    //           episodio, sin spam). Si no hay última válida, no hay nada que
    //           sostener (primer render) — no se fuerza nada.
    const applyTransformWithContinuity = useCallback((index: number, via: string): { ok: boolean; held: boolean } => {
        const res = applyTransformForActiveSentence(index);
        const hold = visualHoldStateRef.current;
        if (res.ok && typeof res.targetY === 'number') {
            lastRenderableSentenceRef.current = {
                index,
                targetY: res.targetY,
                text: sentencesRef.current[index] ?? '',
            };
            if (hold.holding) {
                hold.holding = false;
                // eslint-disable-next-line no-console
                console.log('[VISUAL_CONTINUITY_RELEASE]', {
                    index, via, episode: hold.episode,
                    heldForMs: hold.sinceTs ? Math.round(performance.now() - hold.sinceTs) : null,
                    contentId: content.id,
                });
            }
            return { ok: true, held: false };
        }
        // res NOT ok → riesgo de viewport en blanco bajo audio activo.
        const last = lastRenderableSentenceRef.current;
        const wrapper = transformWrapperRef.current;
        if (last && wrapper) {
            // Mantener la última frase válida centrada (continuidad).
            wrapper.style.transition = 'none';
            wrapper.style.transform  = `translateY(${last.targetY}px)`;
            requestAnimationFrame(() => {
                if (wrapper.style.transition === 'none') wrapper.style.transition = '';
            });
            if (!hold.holding) {
                hold.holding = true;
                hold.episode += 1;
                hold.sinceTs = performance.now();
                // eslint-disable-next-line no-console
                console.warn('[VISUAL_CONTINUITY_HOLD]', {
                    requestedIndex: index, heldIndex: last.index, via,
                    episode: hold.episode,
                    reason: 'active_not_renderable_holding_last_valid',
                    contentId: content.id,
                });
                // eslint-disable-next-line no-console
                console.warn('[VISUAL_NULL_RENDER_BLOCKED]', {
                    requestedIndex: index, heldIndex: last.index, via,
                    episode: hold.episode,
                    note: 'blocked_blank_viewport_under_active_audio',
                    contentId: content.id,
                });
            }
            return { ok: false, held: true };
        }
        return { ok: false, held: false };
    }, [applyTransformForActiveSentence, content.id]);

    // ── M-5.4.13 — SEPARAR visual activation DE layout refinement ─────────────
    //
    // Causa del drift restante: setActiveFitTier() se llamaba DENTRO del
    // useLayoutEffect → React procesa ese setState de forma SÍNCRONA,
    // re-renderizando + re-corriendo layout effects + getBoundingClientRect
    // forzado ANTES del primer paint. Para una frase larga = hasta 5 ciclos
    // sync (normal→long→very-long→emergency→scroll-safe) = 240-360ms que
    // BLOQUEAN el primer paint, mientras el audio (desacoplado) ya suena.
    //
    // Solución: PHASE A (commit visual instantáneo, pre-paint, sin medición) +
    // PHASE B (refinement async post-paint). El continuity guard M-5.4.12
    // queda INTACTO. NO se toca executor/runtime/audio.
    type FitTier = 'normal' | 'long' | 'very-long' | 'emergency' | 'scroll-safe';
    const lastSettledTierRef     = useRef<FitTier>('normal');
    const fitRefineRafRef        = useRef<number | null>(null);
    const fitRefinePhaseRef      = useRef<{ index: number; phase: 'idle'|'committed'|'refining'|'settled'; startTs: number }>(
        { index: -1, phase: 'idle', startTs: 0 });
    const audioVisualDeltaIdxRef = useRef<number>(-1);
    const REFINE_BUDGET_MS       = 120;  // Task 7 — >presupuesto → degradar

    // PHASE B — refinement async POST-PAINT. NO bloquea la aparición visual.
    const runLayoutRefinement = useCallback((index: number) => {
        if (typeof document === 'undefined' || typeof window === 'undefined') return;
        if (pb.currentIndex !== index) return;  // navegó a otra frase → abortar
        try {
            const activeEl = document.querySelector('[data-active-sentence="true"]') as HTMLElement | null;
            if (!activeEl) {
                fitRefineRafRef.current = requestAnimationFrame(() => runLayoutRefinement(index));
                return;
            }
            const _now = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const ph = fitRefinePhaseRef.current;
            if (ph.index !== index || ph.phase === 'idle' || ph.phase === 'settled' || ph.phase === 'committed') {
                fitRefinePhaseRef.current = { index, phase: 'refining', startTs: _now };
                // eslint-disable-next-line no-console
                console.log('[VISUAL_LAYOUT_REFINEMENT_START]', {
                    index, startTier: fitStateRef.current.tier, contentId: content.id,
                });
            }
            const refineElapsed = _now - fitRefinePhaseRef.current.startTs;

            // M-5.4.13 — costo de la medición de ESTE pass (1 reflow async,
            // ya NO bloquea el primer paint). Se conserva la métrica.
            const _measureT0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
            const rect = activeEl.getBoundingClientRect();
            const controls = document.querySelector('[data-immersive-controls="true"]') as HTMLElement | null;
            let controlsTop: number; let controlsMarkerPresent: boolean;
            if (controls) { controlsTop = controls.getBoundingClientRect().top; controlsMarkerPresent = true; }
            else {
                controlsTop = window.innerHeight - 200; controlsMarkerPresent = false;
                if (!controlsMarkerMissingLoggedRef.current) {
                    controlsMarkerMissingLoggedRef.current = true;
                    controlsMarkerMissingCountRef.current += 1;
                    // eslint-disable-next-line no-console
                    console.error('[IMMERSIVE_CONTROLS_MARKER_MISSING]', {
                        currentIndex: index, viewportHeight: window.innerHeight,
                        contentId: content.id,
                        note: 'data-immersive-controls="true" debe existir en el DOM. Fit degradado.',
                    });
                }
            }
            const overlapsControls = rect.bottom > controlsTop;
            const cs = typeof window.getComputedStyle === 'function'
                ? window.getComputedStyle(activeEl.querySelector('p') ?? activeEl) : null;
            const computedFontSize   = cs?.fontSize ?? null;
            const computedLineHeight = cs?.lineHeight ?? null;
            const sentLen = parseInt(activeEl.getAttribute('data-sentence-len') ?? '0', 10);

            // eslint-disable-next-line no-console
            console.log('[ACTIVE_SENTENCE_LAYOUT_FIT]', {
                index, textLen: sentLen, sizeTier: fitStateRef.current.tier,
                retries: fitStateRef.current.retries, computedFontSize, computedLineHeight,
                activeBoxBottom: Math.round(rect.bottom), activeBoxHeight: Math.round(rect.height),
                controlsTop: Math.round(controlsTop), viewportHeight: window.innerHeight,
                overlapsControls, controlsMarkerPresent,
                phase: 'B_async_refinement', layoutMethod: 'adaptive-geometric-fit',
            });

            const _decision = decideFitTier({
                currentTier:      fitStateRef.current.tier,
                overlapsControls,
                retries:          fitStateRef.current.retries,
            });
            const _containerTop = containerRef.current ? containerRef.current.getBoundingClientRect().top : 0;
            const _safeBandPx = Math.max(140, Math.round(controlsTop - _containerTop - 24));
            const overBudget = refineElapsed > REFINE_BUDGET_MS;  // Task 7

            if (_decision.action === 'downgrade' && !overBudget) {
                fitStateRef.current.tier = _decision.nextTier as FitTier;
                fitStateRef.current.retries += 1;
                fitStateRef.current.renderCount += 1;
                if (_decision.applyScrollSafeClamp) setScrollSafeMaxPx(_safeBandPx);
                setActiveFitTier(_decision.nextTier as typeof activeFitTier);
                // re-render con nuevo tier → re-medir el PRÓXIMO frame (post-paint).
                fitRefineRafRef.current = requestAnimationFrame(() => runLayoutRefinement(index));
                return;
            }

            // settled | clamp-final | overBudget → cerrar refinement.
            let finalTier = fitStateRef.current.tier as FitTier;
            let degraded = false;
            if (overBudget && _decision.action === 'downgrade') {
                // Task 7 — saltar la cascada: ir directo a scroll-safe terminal
                // (no-overlap garantizado). Estabilidad perceptual > perfección
                // tipográfica instantánea.
                degraded = true;
                finalTier = TERMINAL_TIER as FitTier;
                fitStateRef.current.tier = finalTier;
                setScrollSafeMaxPx(_safeBandPx);
                setActiveFitTier(finalTier as typeof activeFitTier);
            } else if (_decision.action === 'clamp-final') {
                setScrollSafeMaxPx(_safeBandPx);
                if (fitStateRef.current.tier !== TERMINAL_TIER) {
                    finalTier = TERMINAL_TIER as FitTier;
                    fitStateRef.current.tier = finalTier;
                    setActiveFitTier(finalTier as typeof activeFitTier);
                }
            }
            lastSettledTierRef.current = finalTier;
            fitRefinePhaseRef.current = { index, phase: 'settled', startTs: fitRefinePhaseRef.current.startTs };

            if (fitStateRef.current.firstRenderAt !== null) {
                const _settleNow = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
                const _layoutFitDurationMs   = _settleNow - fitStateRef.current.firstRenderAt;
                const _measurementDurationMs = _settleNow - _measureT0;
                // eslint-disable-next-line no-console
                console.log('[ACTIVE_SENTENCE_LAYOUT_PERF]', {
                    index, tier: finalTier, retries: fitStateRef.current.retries,
                    renderCount: fitStateRef.current.renderCount,
                    layoutFitDurationMs:   Math.round(_layoutFitDurationMs * 100) / 100,
                    measurementDurationMs: Math.round(_measurementDurationMs * 100) / 100,
                    viewportHeight: window.innerHeight, sentenceLength: sentLen,
                    settled: !overlapsControls || _decision.action === 'clamp-final' || degraded,
                    phase: 'B_async_refinement',
                });
            }
            // eslint-disable-next-line no-console
            console.log('[ACTIVE_SENTENCE_LAYOUT_FINAL_STATE]', {
                index, fontSize: computedFontSize, lineHeight: computedLineHeight,
                renderCount: fitStateRef.current.renderCount,
                overflowDetected: overlapsControls,
                compactTier: finalTier,
                scrollSafeApplied: _decision.applyScrollSafeClamp || finalTier === TERMINAL_TIER,
                controlsTop: Math.round(controlsTop), activeBottom: Math.round(rect.bottom),
                viewportHeight: window.innerHeight, reason: _decision.reason,
                degraded, textLen: sentLen, controlsMarkerPresent,
            });
            // eslint-disable-next-line no-console
            console.log('[VISUAL_LAYOUT_REFINEMENT_DONE]', {
                index, finalTier, degraded,
                refineMs: Math.round((_now - fitRefinePhaseRef.current.startTs) * 100) / 100,
                reason: degraded ? 'degraded_budget_exceeded' : _decision.reason,
                contentId: content.id,
            });
        } catch { /* defensive — refinement nunca rompe el visor */ }
    }, [pb, content.id]);

    // PHASE A — COMMIT VISUAL INSTANTÁNEO (sync, pre-paint). NO mide, NO
    // cascada, NO espera ACTIVE_SENTENCE_LAYOUT_FINAL_STATE. Reusa el último
    // tier válido (tamaño provisional) → el texto aparece YA.
    const optimisticVisualCommit = useCallback((index: number, measureStart: number) => {
        const provisional: FitTier = lastSettledTierRef.current || 'normal';
        fitStateRef.current = {
            index, tier: provisional, retries: 0,
            firstRenderAt: measureStart, renderCount: 1,
        };
        if (scrollSafeMaxPx !== null && provisional !== 'scroll-safe') setScrollSafeMaxPx(null);
        if (activeFitTier !== provisional) setActiveFitTier(provisional as typeof activeFitTier);
        // eslint-disable-next-line no-console
        console.log('[VISUAL_EARLY_COMMIT]', {
            index, provisionalTier: provisional,
            reusedFromLastSettled: provisional !== 'normal',
            contentId: content.id,
        });
        // Medir delta audio→visual (post-paint vía rAF). audioStartTs usa la
        // misma base Date.now() que lastAudioEventAt del hook.
        if (audioVisualDeltaIdxRef.current !== index) {
            audioVisualDeltaIdxRef.current = index;
            requestAnimationFrame(() => {
                const firstPaintTs = Date.now();
                let audioStartTs: number | null = null;
                try { audioStartTs = pb.getRuntimeDiagnostics?.()?.lastAudioEventAt ?? null; }
                catch { audioStartTs = null; }
                // eslint-disable-next-line no-console
                console.log('[VISUAL_FIRST_PAINT_TS]', { index, firstPaintTs, contentId: content.id });
                if (typeof audioStartTs === 'number' && audioStartTs > 0) {
                    const deltaMs = firstPaintTs - audioStartTs;  // <=0 = texto ≤ audio (ideal)
                    // eslint-disable-next-line no-console
                    console.log('[VISUAL_AUDIO_DELTA_MS]', {
                        index, deltaMs,
                        textBeforeOrWithAudio: deltaMs <= 0,
                        withinPerceptualBudget: Math.abs(deltaMs) < 40,
                        audioStartTs, firstPaintTs, contentId: content.id,
                    });
                }
            });
        }
        // PHASE B — refinar DESPUÉS del primer paint (no bloquea aparición).
        if (fitRefineRafRef.current !== null) cancelAnimationFrame(fitRefineRafRef.current);
        fitRefinePhaseRef.current = { index, phase: 'committed', startTs: 0 };
        fitRefineRafRef.current = requestAnimationFrame(() => runLayoutRefinement(index));
    }, [pb, content.id, runLayoutRefinement, activeFitTier, scrollSafeMaxPx]);

    // F9/F10 — helper LOGGED: emite PB_ACTIVE_SENTENCE_REVEAL_ATTEMPT y delega
    // la mutación DOM a applyTransformForActiveSentence. Usado SOLO para el
    // primer attempt y para retries con razón distinta. El RAF tick interno
    // usa applyTransformForActiveSentence (silent) para evitar spam de logs.
    const revealActiveSentence = useCallback((index: number, reason: string): { ok: boolean; targetY?: number; activeRect?: DOMRect; containerRect?: DOMRect } => {
        const containerEl = containerRef.current;
        const activeEl    = itemRefs.current[index];
        if (!containerEl || !activeEl) {
            immersiveLog('FATAL_MISMATCH', {
                kind: 'PB_ACTIVE_SENTENCE_REVEAL_FAILED',
                contentId: content.id, userId: user?.id, currentIndex: index, reason,
                missing: !containerEl ? 'container' : 'activeEl',
            });
            return { ok: false };
        }
        const containerHeight = containerEl.clientHeight;
        const elTop           = activeEl.offsetTop;
        const elHeight        = activeEl.clientHeight;
        if (containerHeight === 0 || elHeight === 0) {
            immersiveLog('FATAL_MISMATCH', {
                kind: 'PB_ACTIVE_SENTENCE_REVEAL_FAILED',
                contentId: content.id, userId: user?.id, currentIndex: index, reason,
                containerHeight, elHeight,
            });
            return { ok: false };
        }
        const targetY = (containerHeight / 2) - (elTop + (elHeight / 2));

        immersiveLog('CONTENT_LOADED', {
            kind: 'PB_ACTIVE_SENTENCE_REVEAL_ATTEMPT',
            contentId: content.id, userId: user?.id, currentIndex: index, reason,
            strategy: 'translateY',
            targetY, elTop, elHeight, containerHeight,
        });

        applyTransformForActiveSentence(index);

        const activeRect    = activeEl.getBoundingClientRect();
        const containerRect = containerEl.getBoundingClientRect();
        return { ok: true, targetY, activeRect, containerRect };
    }, [content.id, user?.id, applyTransformForActiveSentence]);

    // F9 — validador encapsulado. Llama validateActiveSentenceVisibility con
    // el getStyle de window.
    const runValidator = useCallback((index: number) => {
        const activeEls   = document.querySelectorAll('[data-active-sentence="true"]');
        const containerEl = containerRef.current;
        return validateActiveSentenceVisibility({
            expectedIndex: index,
            activeEls:     activeEls as any,
            containerEl:   containerEl as any,
            getStyle:      (el: any) => {
                const cs = window.getComputedStyle(el);
                return {
                    opacity:         cs.opacity,
                    visibility:      cs.visibility,
                    display:         cs.display,
                    color:           cs.color,
                    backgroundColor: cs.backgroundColor,
                };
            },
        });
    }, []);

    // ────────────────────────────────────────────────────────────────────
    // M-5.4.6 (DEMOLITION Phase 1.b.2) — Visor pasa a READ-ONLY.
    //
    // ELIMINADO de este lugar:
    //   - emitAckIfNew (writer hacia la machine vía pb.acknowledgeVisualHighlight)
    //   - useLayoutEffect que llamaba acknowledgeVisualHighlight tras runValidator
    //   - pb.prepareSentence(currentIndex, 'initial_bootstrap') (bootstrap re-prepare)
    //   - lastAckedVisualIndexRef (estado de ack)
    //   - PB_VISUAL_HIGHLIGHT_ACK / PB_VISUAL_HIGHLIGHT_ACK_AFTER_REVEAL emits
    //   - PB_VISUAL_ACK_DEFERRED_NOT_PREPARED / PB_INITIAL_BOOTSTRAP_ACK_APPLIED
    //   - runtimeNeedsAck / willAckIfValid / runtime_already_confirmed
    //
    // NUEVO INVARIANTE: Playback never waits for render confirmation.
    //
    // Lo que SOBREVIVE acá:
    //   - applyTransformForActiveSentence en cada cambio de currentIndex,
    //     para que la frase activa quede dentro del viewport. Esto es PURA
    //     manipulación de render (transform: translateY) — no toca state
    //     del runtime, no llama a pb.*, no emite logs hacia la machine.
    //   - runValidator + revealActiveSentence se invocan SOLO para emitir
    //     logs observacionales (FATAL_MISMATCH si el DOM diverge). NO se
    //     usa el resultado para autorizar nada — sigue corriendo si falla.
    // ────────────────────────────────────────────────────────────────────
    useLayoutEffect(() => {
        if (sentences.length <= 1) return;
        if (typeof document === 'undefined') return;
        if (typeof window    === 'undefined') return;

        // ────────────────────────────────────────────────────────────────
        // M-5.4.6 (Phase 1.b.C Task 1) — ADAPTIVE GEOMETRIC FIT.
        // Mide rect.bottom vs controlsTop. Si overlap y retries < 2,
        // downgradea tier (normal → long → very-long) y deja que el
        // próximo render mida de nuevo. Si very-long todavía overlapea,
        // emite ACTIVE_SENTENCE_OVERFLOW_UNRESOLVED y se rinde (NO loop).
        // ────────────────────────────────────────────────────────────────
        try {
            // M-5.4.7 Task 1 — Perf instrumentation.
            const _measureStart = (typeof performance !== 'undefined' && performance.now)
                ? performance.now() : Date.now();

            // ── M-5.4.12 — CONTINUIDAD VISUAL: centrar SIEMPRE, en CADA pass ──
            // ANTES de cualquier early-return de la escalera. Sin esto, durante
            // la convergencia (hasta 4 downgrades) la frase activa nunca se
            // re-centra → viewport negro bajo audio activo. Esto es PURO render
            // (no toca runtime/executor/audio/índice). Si la frase no es
            // renderizable este pass, el guard sostiene la última válida
            // (nunca blanquea).
            applyTransformWithContinuity(currentIndex, 'fit_effect_entry');

            // ── M-5.4.13 — PHASE A: INSTANT VISUAL COMMIT (sync, pre-paint) ──
            // En cambio de índice NO medimos ni corremos la cascada de tiers
            // síncrona acá (eso bloqueaba el primer paint hasta ~360ms → la voz
            // arrancaba antes que el texto). Commit visual inmediato con tier
            // provisional (reusa el último válido) y se DELEGA medición +
            // escalera a PHASE B async (post-paint, runLayoutRefinement). El
            // continuity guard M-5.4.12 ya centró arriba (intacto). NO toca
            // executor/runtime/audio.
            if (fitStateRef.current.index !== currentIndex) {
                optimisticVisualCommit(currentIndex, _measureStart);
                return;
            }
            // Índice sin cambios: re-render de PHASE B (refinement aplicó un
            // tier) u otro state. El refinement corre en su propio rAF
            // post-paint — acá NO medimos (eso era exactamente lo que bloqueaba
            // el primer paint). Solo se cuenta el render.
            fitStateRef.current.renderCount += 1;
        } catch { /* defensive — measurement should not break visor */ }

        // Cancelar cualquier retry de reveal pendiente del index anterior.
        if (revealRetryTimerRef.current !== null) {
            cancelAnimationFrame(revealRetryTimerRef.current);
            revealRetryTimerRef.current = null;
        }

        // 1. Render: posicionar la frase activa (con continuidad — si este
        //    pass no es renderizable, sostiene la última frase válida en vez
        //    de dejar el viewport negro). RENDER-ONLY.
        applyTransformWithContinuity(currentIndex, 'fit_settle');

        // 2. Observabilidad: si el DOM no muestra la frase, log + intento de
        //    reveal. NO bloqueamos playback con esto. NO acknowledgeamos nada.
        const result = runValidator(currentIndex);
        if (result.ok) return;

        const isCorrectable = REVEAL_CORRECTABLE_REASONS.has(result.reason ?? '');
        if (!isCorrectable) {
            immersiveLog('FATAL_MISMATCH', {
                kind: 'PB_VISUAL_HIGHLIGHT_REJECTED',
                contentId: content.id, userId: user?.id, currentIndex,
                reason: result.reason, metrics: result.metrics,
                correctable: false,
            });
            return;
        }

        // Reveal sincrónico — si tras aplicar transform queda visible, OK
        // sin emitir ack (visor NO es writer).
        const reveal = revealActiveSentence(currentIndex, result.reason ?? 'unknown');
        if (reveal.ok && runValidator(currentIndex).ok) return;

        // Retry RAF hasta REVEAL_TIMEOUT_MS — render-only, sin emisión hacia
        // la machine. Solo loggea FATAL_MISMATCH si vence el deadline.
        const deadline = Date.now() + REVEAL_TIMEOUT_MS;
        const tick = () => {
            revealRetryTimerRef.current = null;
            if (runValidator(currentIndex).ok) return;
            if (Date.now() >= deadline) {
                immersiveLog('FATAL_MISMATCH', {
                    kind: 'PB_ACTIVE_SENTENCE_REVEAL_FAILED',
                    contentId: content.id, userId: user?.id, currentIndex,
                    elapsedMs: REVEAL_TIMEOUT_MS,
                });
                return;
            }
            applyTransformForActiveSentence(currentIndex);
            revealRetryTimerRef.current = requestAnimationFrame(tick);
        };
        revealRetryTimerRef.current = requestAnimationFrame(tick);

        return () => {
            if (revealRetryTimerRef.current !== null) {
                cancelAnimationFrame(revealRetryTimerRef.current);
                revealRetryTimerRef.current = null;
            }
            // M-5.4.13 — no dejar el rAF de PHASE B colgado en unmount /
            // teardown (optimisticVisualCommit ya cancela el previo en cambio
            // de índice; esto cubre el desmontaje).
            if (fitRefineRafRef.current !== null) {
                cancelAnimationFrame(fitRefineRafRef.current);
                fitRefineRafRef.current = null;
            }
        };
    }, [currentIndex, sentences.length, content.id, user?.id, activeFitTier, runValidator, revealActiveSentence, applyTransformForActiveSentence, applyTransformWithContinuity, optimisticVisualCommit]);

    // ────────────────────────────────────────────────────────────────────
    // M-5.4.6 (DEMOLITION Phase 1.a) — Drift detector ELIMINADO.
    //
    // El drift detector + grace windows (manual-nav + intra-chunk) era una
    // capa que validaba que DOM/visor/machine estuvieran sincronizados y,
    // ante divergencia, escalaba a hardResync. La cascada de logs
    // PB_INDEX_DRIFT_DETECTED → PB_DRIFT_RECOVERY_ATTEMPT → PB_HARD_RESYNC
    // peleaba con el executor y mutaba el índice automáticamente.
    //
    // En el nuevo modelo, currentSentenceIndex sólo cambia desde:
    //   1. manual navigation (botones next/prev)
    //   2. audio ended → setIdx(next)  (handleEnded perSentence + executor chunked)
    //
    // El render del visor es READ-ONLY. Si el DOM diverge del state,
    // se considera bug de render, NO se intenta corregir desde acá.
    // ────────────────────────────────────────────────────────────────────


    // ────────────────────────────────────────────────────────────────────
    // M-5.4.7 Task 3 — Resize / orientation handler.
    //
    // Cuando cambia el viewport (rotate device, resize browser, mobile chrome
    // collapse, keyboard appear/dismiss), el tier del fit puede quedar stale.
    // Solución mínima: reset el `fitStateRef` para la frase activa y dejar que
    // el useLayoutEffect de fit lo recalcule en el próximo render.
    //
    // NO listener storm: ambos eventos están throttled vía RAF.
    // NO rebuild de runtime: sólo resetea fit state.
    // ────────────────────────────────────────────────────────────────────
    useEffect(() => {
        if (typeof window === 'undefined') return;
        let rafId: number | null = null;
        const handleViewportChange = (reason: 'resize' | 'orientationchange') => {
            // Throttle via RAF para evitar bursts en mobile (donde resize
            // se dispara muchas veces durante una rotación).
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                const newW = window.innerWidth;
                const newH = window.innerHeight;
                const newO = window.matchMedia?.('(orientation: landscape)').matches
                    ? 'landscape' : 'portrait';
                const prev = lastViewportRef.current;
                // Solo accionamos si dims cambiaron realmente (resize a veces
                // se dispara sin cambio efectivo).
                if (prev.w === newW && prev.h === newH && prev.o === newO) return;
                // eslint-disable-next-line no-console
                console.log('[IMMERSIVE_VIEWPORT_CHANGED]', {
                    oldWidth:     prev.w,
                    oldHeight:    prev.h,
                    newWidth:     newW,
                    newHeight:    newH,
                    orientation:  newO,
                    prevOrientation: prev.o,
                    currentIndex,
                    reason,
                });
                lastViewportRef.current = { w: newW, h: newH, o: newO };
                // Reset fit state para la frase activa solamente.
                // El useLayoutEffect de fit detectará que `index !== currentIndex`?
                // No — el index sigue igual. Necesitamos forzar reset explícito.
                fitStateRef.current = {
                    index:         currentIndex,
                    tier:          'normal',
                    retries:       0,
                    firstRenderAt: null,
                    renderCount:   0,
                };
                if (activeFitTier !== 'normal') {
                    setActiveFitTier('normal');
                }
                // eslint-disable-next-line no-console
                console.log('[ACTIVE_SENTENCE_REFIT_TRIGGERED]', {
                    reason,
                    currentTier:    activeFitTier,
                    currentIndex,
                });
            });
        };
        const onResize       = () => handleViewportChange('resize');
        const onOrientChange = () => handleViewportChange('orientationchange');
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onOrientChange);
        return () => {
            if (rafId !== null) cancelAnimationFrame(rafId);
            window.removeEventListener('resize', onResize);
            window.removeEventListener('orientationchange', onOrientChange);
        };
    }, [currentIndex, activeFitTier]);

    // ────────────────────────────────────────────────────────────────────
    // M-5.4.7 Task 5 — Runtime health snapshot (long session leak detector).
    //
    // Cada 5 minutos, en builds dev (o con flag immersive_debug='1'),
    // emite un snapshot agregado del runtime. NO toca el runtime — sólo
    // lee de pb.getRuntimeDiagnostics() + métricas locales.
    //
    // Buscar en sesión 45-60 min:
    //   - cacheEntries crece pero no decrece → leak de blobs
    //   - staleCallbackRejects crece sin parar → spam o bug de generation
    //   - executorCancels >> esperado → cancel loop
    //   - controlsMarkerMissingCount > 0 → invariant violada
    //   - activeAudioElements > 2 (deberíamos tener exactamente 2)
    // ────────────────────────────────────────────────────────────────────
    useEffect(() => {
        const isDev = (() => {
            try {
                if (typeof window === 'undefined') return false;
                const flag = window.localStorage?.getItem?.('immersive_debug');
                if (flag === '1') return true;
                if (flag === '0') return false;
                return import.meta.env.DEV === true;
            } catch { return false; }
        })();
        if (!isDev) return;

        const id = setInterval(() => {
            try {
                const diag = pb.getRuntimeDiagnostics?.() ?? {};
                const detachedListenersEstimate = (() => {
                    if (typeof document === 'undefined') return null;
                    // Heurística: count de audio elements en el doc menos los 2 esperados.
                    const audios = document.querySelectorAll('audio');
                    return Math.max(0, audios.length - 2);
                })();
                // eslint-disable-next-line no-console
                console.log('[RUNTIME_HEALTH_SNAPSHOT]', {
                    contentId:                  content.id,
                    currentIndex:               pb.currentIndex,
                    activeExecutor:             diag.activeExecutor ?? null,
                    pendingTimeouts:            diag.activeTimers ?? null,
                    activeAudioElements:        (() => {
                        if (typeof document === 'undefined') return null;
                        return document.querySelectorAll('audio').length;
                    })(),
                    cacheEntries:               diag.cacheEntries ?? null,
                    cacheMetrics:               diag.cacheMetrics ?? null,
                    navGeneration:              diag.navGeneration ?? null,
                    staleCallbackRejects:       diag.staleCallbackRejects ?? null,
                    executorCancels:            diag.executorCancels ?? null,
                    hardResyncCount:            diag.hardResyncCount ?? null,
                    fitRetries:                 fitStateRef.current.retries,
                    fitTier:                    activeFitTier,
                    controlsMarkerMissingCount: controlsMarkerMissingCountRef.current,
                    detachedListenersEstimate,
                    uptimeMs:                   diag.uptimeMs ?? null,
                });
            } catch { /* defensive — snapshot should not break visor */ }
        }, 5 * 60 * 1000);

        return () => clearInterval(id);
    }, [pb, content.id, activeFitTier]);

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

    // F19/Cambio A — sessionComplete YA NO retorna otro JSX. Se renderiza
    // como OVERLAY dentro del return principal (al final, ver más abajo).
    // El árbol del lector queda montado siempre que el componente esté vivo:
    // <ImmersiveShell>, <audio A/B>, controles, refs y handlers persisten.
    // El overlay solo tapa visualmente. Sin esto, el timer/end-of-session
    // desmontaba [data-active-sentence] → drift detector veía domCount=0 →
    // loop de hardResync.

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
                transformWrapperRef={transformWrapperRef} /* F9 reveal */
                activeFitTier={activeFitTier} /* M-5.4.6 Phase 1.b.C Task 1 */
                scrollSafeMaxPx={scrollSafeMaxPx} /* M-5.4.10 TASK 2 */
                densityContextLookahead={densityPlan.contextLookahead} /* M-5.4.10 TASK 1 */
                densityMode={densityPlan.mode} /* M-5.4.10 TASK 1 */
                scrollDurationMsOverride={visualPacing.durationMs} /* M-5.4.10 TASK 4 */
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

            {/* CONTROLS — fades with trance; pointer-events remain active so user can still interact.
                M-5.4.7 (Task 2) — `data-immersive-controls="true"` es INVARIANT obligatoria.
                El visor mide rect.bottom de la frase activa vs `controls.getBoundingClientRect().top`
                para decidir si downgradear el tier del fit. Si este atributo NO existe en el DOM,
                el adaptive fit cae a `window.innerHeight` (≡ "no overlap nunca") y el texto puede
                quedar oculto bajo los botones. NO MOVER NI BORRAR este atributo. */}
            <div
                data-immersive-controls="true"
                className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30"
                style={{ opacity: 1 - tranceIntensity * 0.80, transition: 'opacity 1.5s ease' }}
            >
                <div className="flex items-center gap-6 bg-neutral-900/80 backdrop-blur-xl border border-white/10 px-8 py-4 rounded-2xl shadow-2xl">
                    <button onClick={goToPreviousSentence} className="p-2 hover:bg-white/10 rounded-full transition-colors"><ChevronLeft size={24} /></button>
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
                    <button onClick={goToNextSentence} className="p-2 hover:bg-white/10 rounded-full transition-colors"><SkipForward size={24} /></button>
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
                        onClick={() => triggerTransitionRef.current('user_click_next', 'banner_proximo_button')}
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

            {/* F19/Cambio A — Pantalla "Lectura Completada" como OVERLAY interno.
                Crítico: este JSX vive DENTRO del return principal, por lo que
                <ImmersiveShell />, <audio A/B>, controles y refs siguen montados
                debajo. El overlay tapa visualmente pero NO desmonta el árbol.
                Así [data-active-sentence] persiste en DOM y el drift detector
                no escala a hardResync por domCount=0. */}
            {sessionComplete && (
                <div
                    className="absolute inset-0 z-50 bg-black/95 flex flex-col items-center justify-center text-white p-8 backdrop-blur-sm animate-in fade-in"
                    role="dialog"
                    aria-modal="true"
                    aria-label="Lectura completada"
                    data-completion-overlay="true"
                >
                    <Award size={80} className="text-yellow-400 mb-6" />
                    <h1 className="text-4xl font-bold mb-4">¡Lectura Completada!</h1>
                    <p className="text-xl text-gray-400 mb-8">{content.titulo}</p>
                    <div className="flex gap-4">
                        <button
                            onClick={() => {
                                // F20/P1: +5 Minutos extiende timer, cierra overlay
                                // y reanuda audio vía pb.resume() (que pasa por
                                // gates de canStartAudio + bootstrap si hace falta).
                                immersiveLog('CONTENT_LOADED', {
                                    kind: 'PB_BLOCK_EXTEND_TIME',
                                    contentId: analyticsContentIdRef.current,
                                    extendMs: 300_000,
                                });
                                blockEngineRef.current?.startBlock(300_000);
                                setSessionComplete(false);
                                // Reanudar — pb.resume usa el path de bootstrap
                                // si canStartAudio falla. NO usamos togglePlay
                                // para evitar el branch load() innecesario.
                                if (pb.status === 'paused' || pb.status === 'blocked') {
                                    pb.resume();
                                } else if (pb.status === 'idle' || pb.status === 'error') {
                                    pb.load(pb.currentIndex, true);
                                }
                            }}
                            className="px-8 py-3 bg-indigo-600 rounded-full font-bold hover:bg-indigo-500"
                        >
                            +5 Minutos
                        </button>
                        <button
                            onClick={() => {
                                // F20/P1: Salir pausa explícitamente y navega atrás.
                                immersiveLog('CONTENT_LOADED', {
                                    kind: 'PB_BLOCK_EXIT',
                                    contentId: analyticsContentIdRef.current,
                                });
                                if (pb.isPlaying) pb.pause();
                                navigate(-1);
                            }}
                            className="px-8 py-3 bg-white/10 rounded-full font-bold hover:bg-white/20"
                        >
                            Salir
                        </button>
                    </div>
                </div>
            )}

        </div>
    );
};

export default VisorInmersivo;
