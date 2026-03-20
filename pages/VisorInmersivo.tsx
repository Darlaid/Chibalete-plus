import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Content } from '../types';
import { ChevronLeft, Play, Pause, Zap, Clock, Award, SkipForward, Minus, Plus, Infinity as InfinityIcon, Battery, RotateCcw, Settings, Type, AlignLeft, Sun, Moon, MessageCircle, X } from 'lucide-react';
import { generarAudioTTS } from '../services/geminiService';
import { dataService } from '../services/dataService';
import type { PedagogicalStage } from '../types';
import { LeoCompanion } from '../components/LeoCompanion';

// --- CONFIGURATION ---
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2.0];
const PREFETCH_WINDOW = 5; // Aggressive prefetch

const LEVELS = {
    1: { duration: 40, label: "Nivel 1: Novato" },
    2: { duration: 180, label: "Nivel 2: Aprendiz" },
    3: { duration: 300, label: "Nivel 3: Explorador" },
    4: { duration: 1200, label: "Nivel 4: Maestro" },
    5: { duration: Infinity, label: "Nivel 5: Leyenda" }
};

// --- HELPER: WAV CONVERSION (For Blob Caching) ---
const pcmToWav = (pcmData: Uint8Array, sampleRate: number = 24000, numChannels: number = 1) => {
    const buffer = new ArrayBuffer(44 + pcmData.length);
    const view = new DataView(buffer);
    const writeString = (view: DataView, offset: number, string: string) => {
        for (let i = 0; i < string.length; i++) { view.setUint8(offset + i, string.charCodeAt(i)); }
    };
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + pcmData.length, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, pcmData.length, true);
    const pcmView = new Uint8Array(buffer, 44);
    pcmView.set(pcmData);
    return buffer;
};

// --- PHASE 5.3 STEP 3: LEO CONTEXTUAL ANCHORS ---
export interface ContextualAnchor {
  id: string;
  chunkIndex: number;
  type: 'insight' | 'vocabulary' | 'reflexion' | 'friction_support';
  title: string;
  payload: string;
}

export interface LeoSessionMemory {
    recentAnchors: number[];
    lastQuestionType: string | null;
    sessionReadingProgress: number;
    difficultyLevel: "inicial" | "medio" | "avanzado";
    pedagogicalStage: PedagogicalStage;  // Phase 5.5: derived from progress + anchor usage
}

/**
 * derivePedagogicalStage — deterministic, no rule engine.
 * Anchors opened can accelerate stage regardless of progress %.
 */
function derivePedagogicalStage(
    progress: number,
    anchorsOpened: number
): PedagogicalStage {
    if (progress >= 85) return 'creation';
    if (progress >= 60 || anchorsOpened >= 5) return 'reflection';
    if (progress >= 25 || anchorsOpened >= 2) return 'interpretation';
    return 'comprehension';
}

// --- PHASE 5.4: READER-LEVEL ADAPTATION ---
// Priority order of anchor types per difficulty level.
// Types listed first will be preferred when a chunk has multiple anchors.
const ANCHOR_TYPE_PRIORITY: Record<LeoSessionMemory['difficultyLevel'], string[]> = {
    inicial:  ['vocabulary', 'friction_support', 'insight'],  // literal support first; reflexion suppressed
    medio:    ['vocabulary', 'insight', 'reflexion'],          // balanced
    avanzado: ['reflexion', 'insight', 'vocabulary'],          // deeper thinking promoted
};

/**
 * selectBestAnchor – picks the most appropriate anchor for the current difficulty.
 * Backward-compatible: if only one candidate exists it is always returned.
 */
function selectBestAnchor(
    candidates: ContextualAnchor[],
    difficulty: LeoSessionMemory['difficultyLevel']
): ContextualAnchor | undefined {
    if (!candidates || candidates.length === 0) return undefined;
    if (candidates.length === 1) return candidates[0]; // single-anchor: always pass through
    const priority = ANCHOR_TYPE_PRIORITY[difficulty] ?? ANCHOR_TYPE_PRIORITY['medio'];
    for (const preferredType of priority) {
        const match = candidates.find(a => a.type === preferredType);
        if (match) return match;
    }
    return candidates[0]; // fallback: first available
}

const VisorInmersivo: React.FC<{ content: Content }> = ({ content }) => {
    const { user } = useAuth();
    const navigate = useNavigate();

    // --- STATE ---
    // Core
    const [sentences, setSentences] = useState<string[]>([]);
    const [audioSentences, setAudioSentences] = useState<string[]>([]); // Separated for translation logic if needed
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isLoading, setIsLoading] = useState(true);

    // Playback
    const [isPlaying, setIsPlaying] = useState(false);
    const isPlayingRef = useRef(false); // Sync ref for async callbacks
    const [playbackSpeed, setPlaybackSpeed] = useState(1);

    // Level / Timer
    const [currentLevel, setCurrentLevel] = useState<number>(user?.immersive_level || 1);
    const [timeLeft, setTimeLeft] = useState(LEVELS[currentLevel as keyof typeof LEVELS].duration);
    const [isTimerActive, setIsTimerActive] = useState(false);
    const [sessionComplete, setSessionComplete] = useState(false);

    // Sync Ref
    useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);

    // --- PHASE 5.3: LEO CHATBOT ---
    const [activeLeoModal, setActiveLeoModal] = useState<ContextualAnchor | null>(null);
    const [anchorsMap, setAnchorsMap] = useState<Record<number, ContextualAnchor[]>>({});
    
    // --- PHASE 5.3: LEO SESSION MEMORY ---
    const defaultLeoMemory: LeoSessionMemory = {
        recentAnchors: [],
        lastQuestionType: null,
        sessionReadingProgress: 0,
        difficultyLevel: "medio",
        pedagogicalStage: 'comprehension',
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
    const [showLeoWelcome, setShowLeoWelcome] = useState(false);

    // Hydrate from persisted memory strictly in background
    useEffect(() => {
        if (!user?.id || !content?.id) {
            setIsMemoryLoaded(true);
            return;
        }
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
                
                // --- B1.5: Trigger visible memory hint ---
                if (remoteMemory.sessionReadingProgress > 5 || (remoteMemory.recentAnchors && remoteMemory.recentAnchors.length > 0)) {
                    setShowLeoWelcome(true);
                    setTimeout(() => { if (isMounted) setShowLeoWelcome(false); }, 6000);
                }
            }
            if (isMounted) setIsMemoryLoaded(true);
        })();
        
        return () => { isMounted = false; };
    }, [user?.id, content?.id]);

    // Persist memory changes to backend and sessionStorage
    const memorySaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        if (!isMemoryLoaded || !user) return;
        
        // Save to sessionStorage as immediate fallback
        sessionStorage.setItem(`leo_session_${content.id}`, JSON.stringify(leoMemory));

        // Debounce backend save
        if (memorySaveTimeoutRef.current) clearTimeout(memorySaveTimeoutRef.current);
        memorySaveTimeoutRef.current = setTimeout(() => {
            dataService.updateLeoMemory(user.id, content.id, leoMemory);
        }, 2000);

        return () => {
            if (memorySaveTimeoutRef.current) clearTimeout(memorySaveTimeoutRef.current);
        };
    }, [leoMemory, content.id, isMemoryLoaded, user]);

    useEffect(() => {
        if (sentences.length > 0) {
            const prog = Math.round((currentIndex / sentences.length) * 100);
            setLeoMemory(prev => {
                if (prev.sessionReadingProgress === prog) return prev;
                const newStage = derivePedagogicalStage(prog, prev.recentAnchors.length);
                return { ...prev, sessionReadingProgress: prog, pedagogicalStage: newStage };
            });
        }
    }, [currentIndex, sentences.length]);

    // PHASE 5.4: lightly infer difficulty upgrade (inicial → medio) once reader
    // has reached 50 % progress AND opened at least 3 anchors this session.
    // Deterministic, no backend, does not overwrite manually-set values above 'inicial'.
    useEffect(() => {
        setLeoMemory(prev => {
            if (prev.difficultyLevel !== 'inicial') return prev;
            if (prev.sessionReadingProgress >= 50 && prev.recentAnchors.length >= 3) {
                console.log('[Leo] Auto-upgrading difficultyLevel: inicial → medio');
                return { ...prev, difficultyLevel: 'medio' };
            }
            return prev;
        });
    }, [leoMemory.sessionReadingProgress, leoMemory.recentAnchors.length]);

    // PHASE 5.4: select anchor based on current difficultyLevel instead of always [0]
    const pendingAnchor = useMemo(
        () => selectBestAnchor(anchorsMap[currentIndex] ?? [], leoMemory.difficultyLevel),
        [anchorsMap, currentIndex, leoMemory.difficultyLevel]
    );

    // --- FASE 4: DERIVACIÓN TRANSICIONAL DE CONTEXTO ---
    const leoContext = useMemo(() => {
        if (!user) return undefined;
        let targetGroupId: string | null = null;
        let isAssigned = false;

        if (user.groupIds && user.groupIds.length > 0) {
            const allAssignments = user.groupIds.flatMap(gid => dataService.getAssignmentsByGroup(gid));
            const activeAssig = allAssignments.find(a => a.contentId === content.id);
            if (activeAssig) {
                targetGroupId = activeAssig.groupId;
                isAssigned = true;
            } else if (user.groupIds.length === 1) {
                targetGroupId = user.groupIds[0];
            }
        }

        if (targetGroupId) {
            const group = dataService.groups?.find(g => g.id === targetGroupId);
            if (group) {
                const medIds = dataService.getGroupMediatorIds(group);
                let medKind: any = undefined;
                if (medIds.length > 0) {
                    const mainMed = dataService.getUsuarioById(medIds[0]);
                    if (mainMed) medKind = mainMed.mediatorKind || (mainMed.roles?.includes('profesor') ? 'teacher' : undefined);
                }
                return {
                    isAssignedContext: isAssigned,
                    groupType: group.type || 'course',
                    mediatorKind: medKind,
                    organizationName: group.school
                };
            }
        }
        return { isAssignedContext: false };
    }, [user, content.id]);

    const [showLeoCompanion, setShowLeoCompanion] = useState(false);

    // --- PHASE 5.3: READING CONTROLS ---
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [fontSize, setFontSize] = useState<'sm' | 'base' | 'lg' | 'xl'>(() => (localStorage.getItem('inv_fontSize') as any) || 'base');
    const [lineSpacing, setLineSpacing] = useState<'normal' | 'relaxed' | 'loose'>(() => (localStorage.getItem('inv_lineSpacing') as any) || 'relaxed');
    const [theme, setTheme] = useState<'dark' | 'high-contrast'>(() => (localStorage.getItem('inv_theme') as any) || 'dark');

    // Persist Preferences
    useEffect(() => {
        localStorage.setItem('inv_fontSize', fontSize);
        localStorage.setItem('inv_lineSpacing', lineSpacing);
        localStorage.setItem('inv_theme', theme);
    }, [fontSize, lineSpacing, theme]);

    // --- REFS ---
    const audioRefA = useRef<HTMLAudioElement | null>(null);
    const audioRefB = useRef<HTMLAudioElement | null>(null);
    const activePlayer = useRef<'A' | 'B'>('A');
    const audioCache = useRef<Map<number, string>>(new Map());
    const inFlightRequests = useRef<Map<number, Promise<string | null>>>(new Map());
    const abortControllers = useRef<Map<number, AbortController>>(new Map()); // NEW: Abort controllers for flight requests
    const manifest = useRef<Record<string, { file: string, index: number }> | null>(null);
    const unmounted = useRef(false); // NEW: Unmount guard
    const heightCache = useRef<Map<number, number>>(new Map()); // NEW: Height Cache to prevent scroll geometric drift
    const lastMeasuredHeight = useRef<number>(150); // NEW: Stable fallback heuristic

    // UI Refs
    const containerRef = useRef<HTMLDivElement>(null);
    const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

    // --- INITIALIZATION ---
    useEffect(() => {
        const init = async () => {
            setIsLoading(true);
            try {
                // 1. Fetch Manifest FIRST (Phase 5.2: Manifest as Source of Truth)
                let loadedManifest: any = null;
                try {
                    const mRes = await fetch(`/uploads/audio/${content.id}/manifest.json?t=${Date.now()}`);
                    if (mRes.ok) {
                        loadedManifest = await mRes.json();
                        manifest.current = loadedManifest;
                    }
                } catch (e) { console.warn("No Audio Manifest", e); }

                let splits: string[] = [];

                // Check if manifest provides canonical text for every chunk
                if (loadedManifest) {
                    const values: any[] = Object.values(loadedManifest).sort((a: any, b: any) => a.index - b.index);
                    const manifestTexts = values.map(v => v.text).filter(t => t && typeof t === 'string');
                    
                    // Validate: We have text for all chunks, and it doesn't look like an old truncated Phase 4 manifest
                    if (manifestTexts.length === values.length && manifestTexts.length > 0 && !manifestTexts[0].endsWith("...")) {
                        splits = manifestTexts;
                        console.log(`[VisorInmersivo] Using canonical text from manifest (${splits.length} chunks)`);
                    }
                }

                // --- PHASE 5.2: Fetch Anchors ---
                try {
                    const aRes = await fetch(`/uploads/audio/${content.id}/anchors.json?t=${Date.now()}`);
                    if (aRes.ok) {
                        const aData = await aRes.json();
                        if (aData && aData.chunkMap) {
                            const parsedAnchors: Record<number, ContextualAnchor[]> = {};
                            Object.keys(aData.chunkMap).forEach((chunkIdxStr) => {
                                const chunkIdx = parseInt(chunkIdxStr, 10);
                                const arr = aData.chunkMap[chunkIdxStr];
                                if (Array.isArray(arr)) {
                                    parsedAnchors[chunkIdx] = arr.map((item: any, i: number) => {
                                        let title = 'Nota de Leo';
                                        let payload = item.payload || 'Información adicional disponible.';
                                        let type = item.type || 'insight';
                                        
                                        if (item.type === 'vocabulary') {
                                            title = item.word ? `Vocabulario: ${item.word}` : 'Vocabulario';
                                            payload = item.explanation || item.payload || payload;
                                        } else if (item.type === 'inferential' || item.type === 'reflection') {
                                            title = item.type === 'inferential' ? 'Para pensar...' : 'Reflexión';
                                            payload = item.question || item.payload || payload;
                                            type = item.type === 'inferential' ? 'insight' : 'reflexion';
                                        }

                                        return {
                                            id: `anchor-${chunkIdx}-${i}`,
                                            chunkIndex: chunkIdx,
                                            type,
                                            title,
                                            payload
                                        } as ContextualAnchor;
                                    });
                                }
                            });
                            setAnchorsMap(parsedAnchors);
                        }
                    }
                } catch(e) { 
                    console.log("[VisorInmersivo] No specific anchors.json found or failed to load. Resuming normal reader behavior."); 
                }

                // 2. Fallback to Raw Text Regex Parsing (Legacy Mode)
                if (splits.length === 0) {
                    console.log(`[VisorInmersivo] Falling back to Regex raw text parsing`);
                    const textUrl = content.texto_plano_url;
                    if (!textUrl) throw new Error("No text found and no canonical manifest text available");

                    const res = await fetch(textUrl);
                    const text = await res.text();
                    // Simple robust splitter
                    const clean = text.replace(/\r\n/g, ' ').replace(/\s+/g, ' ');
                    splits = clean.match(/[^.!?]+[.!?]+[\s]*/g)?.map(s => s.trim()).filter(s => s.length > 0) || [clean];
                }

                setSentences(splits);
                setAudioSentences(splits);

                // 3. Resume? (Phase 5 Canonical Aware)
                if (user) {
                    const prog = dataService.getProgresoUsuarioLibro(user.id, content.id);
                    if (prog) {
                        const exactSentence = prog.canonicalProgress?.sentenceIndex;
                        const hasExactSentence = exactSentence !== undefined && exactSentence > 0;
                        const isLastImmersive = prog.canonicalProgress?.lastInteractedMode === 'immersive' || prog.last_device_mode === 'immersive';

                        if (hasExactSentence && isLastImmersive) {
                            // Exact Restoration (Only if the last read was actually here)
                            setCurrentIndex(Math.min(exactSentence as number, splits.length - 1));
                        } else if (prog.porcentaje > 0) {
                            // Legacy Math Fallback (Cross-Viewer Resume or Old Record)
                            const resumeIdx = Math.floor((prog.porcentaje / 100) * splits.length);
                            setCurrentIndex(Math.min(resumeIdx, splits.length - 1));
                        }
                    }
                    // Record this reader open (increments sessionsCount, sets lastOpenedAt)
                    dataService.recordReaderOpen(user.id, content.id, 'inmersivo');
                    sessionStartRef.current = Date.now(); // Reset elapsed timer for this session
                }

            } catch (e) {
                console.error("Init failed", e);
                setSentences(["Error cargando contenido."]);
            } finally {
                setIsLoading(false);
            }
        };
        init();

        return () => {
            unmounted.current = true;
            // Cleanup Blobs
            audioCache.current.forEach(url => URL.revokeObjectURL(url));
            abortControllers.current.forEach(ctrl => ctrl.abort("Component unmounted"));
        }
    }, [content.id, user]);

    // --- AUDIO ENGINE ---

    // --- AUDIO ENGINE v2 ---

    // 1. Fetcher (Blob | Gen)
    const getAudioUrl = useCallback(async (index: number): Promise<string | null> => {
        if (index >= audioSentences.length) return null;
        if (audioCache.current.has(index)) return audioCache.current.get(index)!;
        if (inFlightRequests.current.has(index)) return inFlightRequests.current.get(index)!;

        const abortCtrl = new AbortController();
        abortControllers.current.set(index, abortCtrl);

        const task = async () => {
            try {
                // A. Manifest
                if (manifest.current && manifest.current[index]) {
                    const url = `/uploads/${manifest.current[index].file}`;
                    const res = await fetch(url, { signal: abortCtrl.signal }); // PASSED ABORT SIGNAL
                    if (res.ok) {
                        const blob = await res.blob();
                        if (abortCtrl.signal.aborted) return null; // DOUBLE CHECK
                        const blobUrl = URL.createObjectURL(blob);
                        audioCache.current.set(index, blobUrl);
                        return blobUrl;
                    }
                }

                // B. Generate
                const txt = audioSentences[index];
                if (!txt) return null;
                
                // NOTA: generarAudioTTS no soporta actualmente 'signal'. 
                // Se neutraliza el efecto de la promesa Zombi frenando cualquier asignación o cambio de estado posterior si abortó.
                const b64 = await generarAudioTTS(txt); // Returns base64 mp3/wav
                
                if (unmounted.current || abortCtrl.signal.aborted) return null; // EARLY EXIT NEUTRALIZATION

                if (b64) {
                    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
                    const wav = pcmToWav(bytes);
                    const blob = new Blob([wav], { type: 'audio/wav' });
                    const blobUrl = URL.createObjectURL(blob);
                    audioCache.current.set(index, blobUrl);
                    return blobUrl;
                }
            } catch (e: any) {
                if (e.name !== 'AbortError') console.error("Audio fetch/gen error", e);
            } finally {
                inFlightRequests.current.delete(index);
                abortControllers.current.delete(index);
            }
            return null;
        };

        const p = task();
        inFlightRequests.current.set(index, p);
        return p;
    }, [audioSentences]);

    // 2. Prefetcher
    const prefetch = useCallback((start: number) => {
        for (let i = 0; i < PREFETCH_WINDOW; i++) {
            getAudioUrl(start + i);
        }
    }, [getAudioUrl]);

    // 3. Player Logic (Direct Control)
    const playIndex = useCallback(async (index: number, forcePlay = false) => {
        // Validation
        if (index < 0 || index >= sentences.length) return;

        // Visual Update Immediately
        setCurrentIndex(index);

        // Determine Players
        // Strategy: Always load 'Index' into Player A, and 'Index+1' into Player B?
        // OR: Keep the alternating toggle which is smoother for gaps?
        // Let's stick to alternating for continuous reading, but for JUMPS we reset to A.

        const player = activePlayer.current === 'A' ? audioRefA.current : audioRefB.current;
        const otherPlayer = activePlayer.current === 'A' ? audioRefB.current : audioRefA.current;

        if (!player || !otherPlayer) return;

        // ABORT FLIGHTS TOO FAR AWAY FROM NEW JUMP (Cancel zombie requests instantly)
        Array.from(abortControllers.current.entries()).forEach(([reqIndex, ctrl]) => {
            if (reqIndex < index - 5 || reqIndex > index + PREFETCH_WINDOW + 2) {
                ctrl.abort("Jumped away");
            }
        });

        // STOP everything first if jumping
        player.pause();
        otherPlayer.pause();

        const url = await getAudioUrl(index);
        if (unmounted.current) return; // SAFEGUARD AFTER ASYNC

        if (url) {
            player.src = url;
            player.playbackRate = playbackSpeed;

            if (forcePlay || isPlayingRef.current) {
                player.play().catch(e => console.error("Jump play failed", e));
                setIsPlaying(true);
                setIsTimerActive(true);
            }
        }

        // Preload Next on other player
        const nextUrl = await getAudioUrl(index + 1);
        if (nextUrl) {
            otherPlayer.src = nextUrl;
            otherPlayer.playbackRate = playbackSpeed;
            otherPlayer.load();
        }

        // Trigger Prefetch
        prefetch(index + 2);

    }, [sentences.length, getAudioUrl, playbackSpeed, prefetch]);


    // Initial Load - MOUNT ONLY
    useEffect(() => {
        if (!isLoading && sentences.length > 0) { //  && currentIndex === 0 (Removed constraint to allow resume)
            // Only if not already initialized? 
            // Logic: If user clicks back/forward, we don't want this firing if it depended on currentIndex.
            // We removed currentIndex from dependency array!
            playIndex(currentIndex, false);
        }
    }, [isLoading, sentences.length]); // Intentionally exclude currentIndex

    // --- PROGRESS TRACKING (Canonical Phase 5) ---
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const sessionStartRef = useRef<number>(Date.now()); // Session timer for totalTimeMs

    useEffect(() => {
        if (!user || isLoading || sentences.length === 0) return;

        // Debounce to avoid spamming the backend/DB on rapid skips
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);

        saveTimeoutRef.current = setTimeout(() => {
            // updateProgreso(userId, contentId, legacyPage, legacyTotalPages, canonicalIndex, deviceMode)
            // For immersive, 'page' is visually the sentence index, and 'totalPages' is total sentences
            // But we also pass the explicit canonicalIndex
            dataService.updateProgreso(
                user.id,
                content.id,
                currentIndex + 1, // Visual pseudo-page (1-indexed for legacy math)
                sentences.length,
                currentIndex,     // Canonical Index (0-indexed real chunk)
                'immersive',
                { lastMode: 'inmersivo', elapsedMs: Date.now() - sessionStartRef.current }
            );
        }, 1500); // 1.5s debounce is safe for natural reading

        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            dataService.forceFlush();
        };
    }, [currentIndex, user, content.id, sentences.length, isLoading]);

    // Manual Play Toggle
    const togglePlay = () => {
        const player = activePlayer.current === 'A' ? audioRefA.current : audioRefB.current;
        if (isPlaying) {
            player?.pause();
            setIsPlaying(false);
            setIsTimerActive(false);
        } else {
            // Check if we need to reload (e.g. ended) or just resume
            if (player?.src) {
                player.play().then(() => {
                    setIsPlaying(true);
                    setIsTimerActive(true);
                }).catch(() => {
                    // Try re-init if stale
                    playIndex(currentIndex, true);
                });
            } else {
                playIndex(currentIndex, true);
            }
        }
    };

    // The Gapless Handler
    const onAudioEnded = (endedId: 'A' | 'B') => {
        if (unmounted.current || !isPlayingRef.current) return; // Don't auto-advance if paused or unmounted

        const nextIdx = currentIndex + 1;
        if (nextIdx >= sentences.length) {
            setSessionComplete(true);
            setIsPlaying(false);
            return;
        }

        // 1. Swap Active Player Ref
        const nextId = endedId === 'A' ? 'B' : 'A';
        activePlayer.current = nextId;
        const nextPlayer = nextId === 'A' ? audioRefA.current : audioRefB.current;
        const nextNextPlayer = endedId === 'A' ? audioRefA.current : audioRefB.current; // The one that just finished

        // 2. Play Next (It should be preloaded)
        if (nextPlayer && nextPlayer.src) {
            nextPlayer.playbackRate = playbackSpeed;
            nextPlayer.play().catch(e => {
                console.error("Gapless play failed, recovering...", e);
                playIndex(nextIdx, true); // Fallback
            });
            setCurrentIndex(nextIdx); // Visual Update ONLY now
        } else {
            console.warn("Buffer underrun! Loading next manually.");
            playIndex(nextIdx, true);
            return;
        }

        // 3. Prepare Next+1 on the (now idle) old player
        const nextNextIdx = nextIdx + 1;
        getAudioUrl(nextNextIdx).then(url => {
            if (nextNextPlayer && url) {
                nextNextPlayer.src = url;
                nextNextPlayer.playbackRate = playbackSpeed;
                nextNextPlayer.load();
            }
        });

        // 4. Prefetch
        prefetch(nextNextIdx + 1);
    };

    // Speed Watcher (Live Update)
    useEffect(() => {
        if (audioRefA.current) audioRefA.current.playbackRate = playbackSpeed;
        if (audioRefB.current) audioRefB.current.playbackRate = playbackSpeed;
    }, [playbackSpeed]);


    // --- VISUAL ENGINE (CSS TRANSFORMS) ---
    // Instead of scrolling the window, we translate the track.
    const [translateY, setTranslateY] = useState(0);

    // Force recalc on resize (Phase 5.3: Robust ResizeObserver)
    const [ContainerResized, setContainerResized] = useState(0);
    useEffect(() => {
        if (!containerRef.current) return;
        
        const resizeObserver = new ResizeObserver(() => {
            // Re-trigger layout calculation when container OR its children change size
            setContainerResized(prev => prev + 1);
        });
        
        resizeObserver.observe(containerRef.current);
        
        return () => resizeObserver.disconnect();
    }, []);

    useEffect(() => {
        if (!containerRef.current || itemRefs.current.length === 0) return;

        const containerHeight = containerRef.current.clientHeight;
        const currentParams = itemRefs.current[currentIndex];

        if (currentParams) {
            // CACHE REAL HEIGHT FOR FUTURE SCROLL JUMPS
            if (!heightCache.current.has(currentIndex) && currentParams.clientHeight > 0) {
                heightCache.current.set(currentIndex, currentParams.clientHeight);
            }

            // Center logic:
            // We want the MIDDLE of the current element to be at the MIDDLE of the container.
            // Element Top relative to parent = currentParams.offsetTop
            // Element Mid = offsetTop + height/2
            // Container Mid = containerHeight / 2
            // Translate = Container Mid - Element Mid

            const elTop = currentParams.offsetTop;
            const elHeight = currentParams.clientHeight;
            const targetY = (containerHeight / 2) - (elTop + (elHeight / 2));

            setTranslateY(targetY);
        }
    }, [currentIndex, sentences.length, ContainerResized, fontSize, lineSpacing]);


    // 5. Sliding Window Memory Management (Garbage Collector)
    // Prevents Out Of Memory (OOM) crashes on long books by revoking Blob URLs
    useEffect(() => {
        if (audioCache.current.size === 0) return;
        
        // Define safe window bounds: Keep [current-20] to [current+20] (Conservative GC)
        const lowerBound = currentIndex - 20;
        const upperBound = currentIndex + 20;
        
        const keysToDelete: number[] = [];
        audioCache.current.forEach((blobUrl, index) => {
            if (index < lowerBound || index > upperBound) {
                URL.revokeObjectURL(blobUrl); // Free RAM
                keysToDelete.push(index);
            }
        });
        
        keysToDelete.forEach(key => audioCache.current.delete(key));
        
        if (keysToDelete.length > 0) {
            console.log(`[Memory GC] Freed ${keysToDelete.length} stale blobs. Active cached Blobs: ${audioCache.current.size}`);
        }
    }, [currentIndex]);


    // --- TIMER & PROGRESS ---
    useEffect(() => {
        let interval: any;
        if (isTimerActive && timeLeft > 0 && timeLeft !== Infinity) {
            interval = setInterval(() => {
                setTimeLeft(prev => {
                    if (prev <= 1) {
                        // Time's up
                        setSessionComplete(true);
                        setIsPlaying(false);
                        setIsTimerActive(false);
                        audioRefA.current?.pause();
                        audioRefB.current?.pause();
                        return 0;
                    }
                    return prev - 1;
                });
            }, 1000);
        }
        return () => clearInterval(interval);
    }, [isTimerActive, timeLeft]);


    // --- RENDER ---
    if (sessionComplete) {
        // Simplified Completion Screen
        return (
            <div className="h-screen w-full bg-black flex flex-col items-center justify-center text-white p-8 animate-in fade-in">
                <Award size={80} className="text-yellow-400 mb-6" />
                <h1 className="text-4xl font-bold mb-4">¡Lectura Completada!</h1>
                <p className="text-xl text-gray-400 mb-8">{content.titulo}</p>
                <div className="flex gap-4">
                    <button onClick={() => { setTimeLeft(300); setSessionComplete(false); setIsPlaying(true); setIsTimerActive(true); togglePlay(); }} className="px-8 py-3 bg-indigo-600 rounded-full font-bold hover:bg-indigo-500">
                        +5 Minutos
                    </button>
                    <button onClick={() => navigate(-1)} className="px-8 py-3 bg-white/10 rounded-full font-bold hover:bg-white/20">
                        Salir
                    </button>
                </div>
            </div>
        )
    }

    return (
        <div className={`relative h-screen w-full overflow-hidden font-sans select-none ${theme === 'high-contrast' ? 'bg-black text-white' : 'bg-neutral-950 text-white'}`}>

            {/* AUDIO (Hidden) */}
            <audio ref={audioRefA} className="hidden" onEnded={() => onAudioEnded('A')} onError={(e) => console.error("Audio A err", e)} />
            <audio ref={audioRefB} className="hidden" onEnded={() => onAudioEnded('B')} onError={(e) => console.error("Audio B err", e)} />

            {/* HEADER */}
            <div className="absolute top-0 left-0 right-0 z-20 p-6 flex justify-between items-center bg-gradient-to-b from-black/90 to-transparent">
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

            {/* TELEPROMPTER TRACK */}
            <div className="absolute inset-0 z-0 flex items-center justify-center">
                <div ref={containerRef} className="w-full max-w-4xl h-full relative overflow-hidden">
                    {/* Gradients */}
                    <div className="absolute top-0 left-0 right-0 h-40 bg-gradient-to-b from-neutral-950 to-transparent z-10 pointer-events-none" />
                    <div className="absolute bottom-0 left-0 right-0 h-40 bg-gradient-to-t from-neutral-950 to-transparent z-10 pointer-events-none" />

                    {/* Moving Track */}
                    <div
                        className="w-full transition-transform duration-500 ease-[cubic-bezier(0.25,0.1,0.25,1.0)]"
                        style={{ transform: `translateY(${translateY}px)` }}
                    >
                        {sentences.map((txt, idx) => {
                            // OPTIMIZATION: Teleprompter Virtualization
                            // Only render nodes near the current reading position to avoid DOM Bloat
                            if (idx < currentIndex - 15 || idx > currentIndex + 15) {
                                // Mide contra el Cache exacto, o la última altura conocida válida, o el fallback estricto
                                const computedHeight = heightCache.current.get(idx) ?? lastMeasuredHeight.current;
                                return (
                                    <div 
                                      key={idx} 
                                      ref={el => { if(el) itemRefs.current[idx] = el }} 
                                      className="py-8 w-full" 
                                      style={{ height: computedHeight }} 
                                    />
                                );
                            }

                            const isActive = idx === currentIndex;
                            return (
                                <div
                                    key={idx}
                                    ref={el => {
                                        if (el) {
                                            itemRefs.current[idx] = el;
                                            // Opportunistic Caching to build steady offsetMap
                                            if (el.clientHeight > 0) {
                                                heightCache.current.set(idx, el.clientHeight);
                                                lastMeasuredHeight.current = el.clientHeight; // Keep stable fallback
                                            }
                                        }
                                    }}
                                    onClick={() => playIndex(idx, true)}
                                    className={`
                                            py-8 px-8 text-center transition-all duration-500 cursor-pointer
                                            ${isActive ? 'opacity-100 scale-105 blur-none' : 'opacity-20 scale-95 blur-[1px]'}
                                        `}
                                >
                                    <p className={`
                                            font-serif mx-auto transition-colors duration-300
                                            ${lineSpacing === 'normal' ? 'leading-normal' : lineSpacing === 'relaxed' ? 'leading-relaxed' : 'leading-loose'}
                                            ${theme === 'high-contrast' ? (isActive ? 'text-yellow-400 font-bold' : 'text-neutral-600') : (isActive ? 'text-white font-semibold' : 'text-gray-500')}
                                            ${fontSize === 'sm' ? (isActive ? 'text-2xl md:text-3xl max-w-2xl' : 'text-lg md:text-xl max-w-2xl') : ''}
                                            ${fontSize === 'base' ? (isActive ? 'text-3xl md:text-5xl max-w-3xl' : 'text-xl md:text-3xl max-w-3xl') : ''}
                                            ${fontSize === 'lg' ? (isActive ? 'text-4xl md:text-6xl max-w-4xl' : 'text-2xl md:text-4xl max-w-4xl') : ''}
                                            ${fontSize === 'xl' ? (isActive ? 'text-5xl md:text-7xl max-w-5xl' : 'text-3xl md:text-5xl max-w-5xl') : ''}
                                       `}>
                                        {txt}
                                    </p>
                                </div>
                            )
                        })}
                        {/* Padding at bottom to allow scrolling last item to center */}
                        <div className="h-[50vh]" />
                    </div>
                </div>
            </div>

            {/* LEO CONTEXTUAL ANCHOR (Floating) */}
            {pendingAnchor && !activeLeoModal && !leoMemory.recentAnchors.includes(currentIndex) && (
                <div className="absolute right-6 top-1/2 -translate-y-1/2 z-30 animate-in slide-in-from-right fade-in duration-500">
                    <button 
                        onClick={() => {
                            if (isPlaying) togglePlay(); 
                            setActiveLeoModal(pendingAnchor);
                            // --- PHASE 5.3 MEMORY UPDATE ---
                            setLeoMemory(prev => {
                                const newAnchors = [...prev.recentAnchors, currentIndex].slice(-10);
                                const newStage = derivePedagogicalStage(prev.sessionReadingProgress, newAnchors.length);
                                return {
                                    ...prev,
                                    recentAnchors: newAnchors,
                                    lastQuestionType: pendingAnchor.type,
                                    pedagogicalStage: newStage,
                                };
                            });
                            // --- PHASE 5.5: PROFILE UPDATE ---
                            if (user?.id) {
                                const anchorType = pendingAnchor.type ?? '';
                                dataService.updateLeoReaderProfile(user.id, {
                                    vocabularyDelta:  (anchorType === 'vocabulary' || anchorType === 'friction_support') ? 1 : 0,
                                    reflectionDelta:  (anchorType === 'reflexion' || anchorType === 'insight') ? 1 : 0,
                                });
                            }
                        }} 
                        className="group relative flex items-center justify-center w-14 h-14 rounded-full bg-indigo-600 shadow-xl shadow-indigo-500/30 hover:scale-110 transition-all border-2 border-indigo-400"
                    >
                        <span className="absolute -inset-2 rounded-full border border-indigo-500 animate-ping opacity-50"></span>
                        <MessageCircle className="text-white" size={28} />
                         {/* Tooltip hint */}
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
                        <button 
                            onClick={() => setActiveLeoModal(null)} 
                            className="absolute top-6 right-6 text-gray-400 hover:text-white"
                        >
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

                        <p className="text-gray-300 text-lg leading-relaxed mb-8">
                            {activeLeoModal.payload}
                        </p>

                        <button 
                            onClick={() => {
                                setActiveLeoModal(null);
                                if (!isPlaying) togglePlay(); // Resume reading seamlessly
                            }} 
                            className="w-full py-4 bg-white text-black font-bold rounded-xl text-lg hover:bg-gray-200 transition-colors shadow-lg"
                        >
                            Continuar Leyendo
                        </button>
                    </div>
                </div>
            )}

            {/* LEO WELCOME TOAST (Fase B1.5) */}
            {showLeoWelcome && !showLeoCompanion && !activeLeoModal && (
                <div 
                    className="fixed bottom-24 right-6 z-50 bg-indigo-600/90 backdrop-blur-md text-white px-5 py-4 rounded-2xl shadow-2xl border border-indigo-400/30 animate-in slide-in-from-bottom-5 fade-in duration-500 max-w-xs cursor-pointer hover:bg-indigo-600 transition-colors" 
                    onClick={() => { setShowLeoWelcome(false); setShowLeoCompanion(true); if (isPlaying) togglePlay(); }}
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

            {/* LEO COMPANION (Fase 5 MVP) */}
            {!showLeoCompanion && !activeLeoModal && (
                <button
                    onClick={() => {
                        setShowLeoWelcome(false);
                        setShowLeoCompanion(true);
                        if (isPlaying) togglePlay(); 
                    }}
                    className="fixed bottom-6 right-6 z-[60] bg-indigo-600 hover:bg-indigo-700 text-white w-14 h-14 rounded-full shadow-2xl transition-transform transform hover:scale-110 flex items-center justify-center border-2 border-white/50"
                    title="Pregúntale a Leo"
                >
                    <img src="/leo_character.png" alt="Leo" className="w-10 h-10 object-contain drop-shadow-md" onError={(e) => { e.currentTarget.style.display='none'; }} />
                </button>
            )}

            {showLeoCompanion && sentences.length > 0 && (
                <LeoCompanion 
                    contentId={content.id}
                    currentIndex={currentIndex}
                    exactSentence={sentences[currentIndex].trim()} 
                    onClose={() => setShowLeoCompanion(false)}
                    sessionMemory={leoMemory}
                    difficultyLevel={leoMemory.difficultyLevel}
                    pedagogicalStage={leoMemory.pedagogicalStage}
                    leoContext={leoContext}
                    onMemoryUpdate={(updates) => setLeoMemory(prev => ({ ...prev, ...updates }))}
                    onNavigate={(idx) => playIndex(idx, true)}
                />
            )}

            {/* CONTROLS (Floating Bottom) */}
            <div className="absolute bottom-10 left-1/2 -translate-x-1/2 z-30">
                <div className="flex items-center gap-6 bg-neutral-900/80 backdrop-blur-xl border border-white/10 px-8 py-4 rounded-2xl shadow-2xl">
                    <button onClick={() => playIndex(Math.max(0, currentIndex - 1), true)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><ChevronLeft size={24} /></button>

                    <button
                        onClick={togglePlay}
                        className={`w-16 h-16 rounded-full flex items-center justify-center transition-all shadow-lg hover:scale-105 active:scale-95 ${isPlaying ? 'bg-white text-black' : 'bg-indigo-600 text-white shadow-indigo-500/50'}`}
                    >
                        {isPlaying ? <Pause size={32} className="fill-current" /> : <Play size={32} className="ml-1 fill-current" />}
                    </button>

                    <button onClick={() => playIndex(Math.min(sentences.length - 1, currentIndex + 1), true)} className="p-2 hover:bg-white/10 rounded-full transition-colors"><SkipForward size={24} /></button>

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
                    
                    {/* Theme */}
                    <div className="space-y-3">
                        <label className="text-sm font-semibold text-gray-400 flex items-center gap-2"><Sun size={14}/> Tema Visual</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => setTheme('dark')} className={`py-2 px-3 rounded-xl border flex items-center justify-center gap-2 ${theme === 'dark' ? 'bg-indigo-600 border-indigo-500' : 'bg-white/5 border-white/10 hover:bg-white/10'}`}>
                                Oscuro
                            </button>
                            <button onClick={() => setTheme('high-contrast')} className={`py-2 px-3 rounded-xl border flex items-center justify-center gap-2 ${theme === 'high-contrast' ? 'bg-yellow-500 text-black border-yellow-400 font-bold' : 'bg-black border-white/20 hover:bg-white/10'}`}>
                                Alto Contraste
                            </button>
                        </div>
                    </div>

                    {/* Font Size */}
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

                    {/* Spacing */}
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

                    {/* PHASE 5.4: Difficulty Level (Leo Adaptation) */}
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
                                    className={`py-2 rounded-xl border text-xs font-bold capitalize ${
                                        leoMemory.difficultyLevel === lvl
                                            ? 'bg-indigo-600 border-indigo-500 text-white'
                                            : 'bg-white/5 border-white/10 hover:bg-white/10 text-gray-300'
                                    }`}
                                >
                                    {lvl}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* LOADING OVERLAY */}
            {isLoading && (
                <div className="absolute inset-0 z-50 bg-black flex items-center justify-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-indigo-500"></div>
                </div>
            )}

        </div>
    );
};

export default VisorInmersivo;
