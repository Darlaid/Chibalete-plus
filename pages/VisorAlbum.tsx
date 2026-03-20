
import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import { generarMicroResumenRecordatorio, generarAudioTTS } from '../services/geminiService';
import type { Content, AlbumPage, AlbumRegion, VisualContext } from '../types';
import { ChevronLeft, ZoomIn, ZoomOut, HelpCircle, CheckCircle, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import confetti from 'canvas-confetti';
import Chatbot from '../components/Chatbot';

// Helper: PCM to WAV (Same as VisorInmersivo)
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

const VisorAlbum: React.FC<{ content: Content }> = ({ content }) => {
    const navigate = useNavigate();
    const { user } = useAuth();
    const albumData = content.album_data || [];

    // Navigation State
    const [pageIndex, setPageIndex] = useState(0);
    const [regionIndex, setRegionIndex] = useState(0);
    const [viewMode, setViewMode] = useState<'full' | 'guided'>('full'); // Full Page vs Guided Region
    const [showText, setShowText] = useState(true);

    // Gamification State
    const [isInteractiveMode, setIsInteractiveMode] = useState(false);
    const [showHint, setShowHint] = useState(false);

    // Audio / TTS State
    const [isMuted, setIsMuted] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [loadingAudio, setLoadingAudio] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const audioCache = useRef<Map<string, string>>(new Map()); // Key: pageIndex-regionIndex

    // Recap State
    const [leoRecapMessage, setLeoRecapMessage] = useState<string | null>(null);
    const [checkedRecap, setCheckedRecap] = useState(false);
    // Phase 7: session completion flag (replaces alert)
    const [sessionComplete, setSessionComplete] = useState(false);

    // Session tracking refs (Advanced Reading patch)
    const sessionStartRef = useRef<number>(Date.now());
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const currentPage: AlbumPage = albumData[pageIndex];
    const currentRegion: AlbumRegion | undefined = currentPage?.regions[regionIndex];

    // Visual Context for Leo
    const [visualContext, setVisualContext] = useState<VisualContext | undefined>(undefined);

    useEffect(() => {
        // Update Leo's context whenever the view changes
        if (currentPage) {
            setVisualContext({
                imageUrl: currentPage.imageUrl,
                pageIndex: pageIndex,
                regionText: currentRegion ? currentRegion.text : "Vista general de la página completa",
                bookTitle: content.titulo
            });
        }
    }, [pageIndex, regionIndex, currentRegion, currentPage, content.titulo]);

    // Check Inactivity (Corrected)
    useEffect(() => {
        const checkInactivity = async () => {
            if (!user || checkedRecap) return;
            setCheckedRecap(true);
            const progress = dataService.getProgresoUsuarioLibro(user.id, content.id);

            // Simplified: If progress exists (>0%), assume returning user. Ignore days.
            if (progress && progress.porcentaje > 0) {
                try {
                    const recap = await generarMicroResumenRecordatorio(content.descripcion_corta, content.titulo);
                    setLeoRecapMessage(recap);
                } catch (e) { console.error(e); }
            }
        };
        checkInactivity();
    }, [user, content, checkedRecap]);

    // --- Advanced Reading: Open registration + resume ---
    useEffect(() => {
        if (!user) return;
        // 1. Record this session open
        dataService.recordReaderOpen(user.id, content.id, 'album');
        sessionStartRef.current = Date.now();

        // 2. Resume from last stored page
        if (albumData.length > 0) {
            const prog = dataService.getProgresoUsuarioLibro(user.id, content.id);
            if (prog && prog.porcentaje > 0) {
                // Only resume if last mode was album (or no mode stored — backward compat)
                const wasAlbum = !prog.lastMode || prog.lastMode === 'album';
                if (wasAlbum) {
                    const resumePage = Math.min(
                        Math.floor((prog.porcentaje / 100) * albumData.length),
                        albumData.length - 1
                    );
                    if (resumePage > 0) setPageIndex(resumePage);
                }
            }
        }

        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        };
    }, [user, content.id]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- Advanced Reading: Mid-session progress save on page navigation ---
    useEffect(() => {
        if (!user || albumData.length === 0) return;
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
            dataService.updateProgreso(
                user.id, content.id,
                pageIndex + 1, albumData.length,
                undefined, undefined,
                { lastMode: 'album', elapsedMs: Date.now() - sessionStartRef.current }
            );
        }, 1000);
    }, [pageIndex, user, content.id, albumData.length]); // eslint-disable-line react-hooks/exhaustive-deps

    // --- TTS Logic ---
    useEffect(() => {
        // Stop any playing audio when view changes
        if (audioRef.current) {
            audioRef.current.pause();
            setIsPlaying(false);
        }

        const generateAndPlay = async () => {
            if (isMuted || viewMode !== 'guided' || !currentRegion || isInteractiveMode || !currentRegion.text) return;

            const cacheKey = `${pageIndex}-${regionIndex}`;

            // 1. Check Cache
            if (audioCache.current.has(cacheKey)) {
                if (audioRef.current) {
                    audioRef.current.src = audioCache.current.get(cacheKey)!;
                    audioRef.current.play().then(() => setIsPlaying(true)).catch(e => console.error("Play error", e));
                }
                return;
            }

            // 2. Generate
            setLoadingAudio(true);
            try {
                const audioBase64 = await generarAudioTTS(currentRegion.text);
                if (audioBase64) {
                    const binaryString = atob(audioBase64);
                    const len = binaryString.length;
                    const bytes = new Uint8Array(len);
                    for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
                    const wavBuffer = pcmToWav(bytes);
                    const blob = new Blob([wavBuffer], { type: 'audio/wav' });
                    const url = URL.createObjectURL(blob);

                    audioCache.current.set(cacheKey, url);

                    if (audioRef.current && !isMuted && viewMode === 'guided') { // Double check state hasn't changed
                        audioRef.current.src = url;
                        audioRef.current.play().then(() => setIsPlaying(true));
                    }
                }
            } catch (error) {
                console.error("TTS Generation Error:", error);
            } finally {
                setLoadingAudio(false);
            }
        };

        generateAndPlay();

    }, [pageIndex, regionIndex, viewMode, isInteractiveMode, isMuted]); // deps

    // Cleanup audio cache
    useEffect(() => {
        return () => {
            audioCache.current.forEach(url => URL.revokeObjectURL(url));
            audioCache.current.clear();
        };
    }, []);


    // Calculate transform based on current region
    const transformStyle = React.useMemo(() => {
        if (viewMode === 'full' || !currentRegion) return { transform: 'translate(0, 0) scale(1)' };

        // Calculate scale to fit region in viewport (with some padding)
        const scaleFactor = 90 / Math.max(currentRegion.width, currentRegion.height);

        const regionCenterX = currentRegion.x + (currentRegion.width / 2);
        const regionCenterY = currentRegion.y + (currentRegion.height / 2);

        const x = 50 - (regionCenterX);
        const y = 50 - (regionCenterY);

        return {
            transform: `scale(${scaleFactor}) translate(${x}%, ${y}%)`,
            transformOrigin: 'center center'
        };
    }, [viewMode, currentRegion]);

    const handleNext = () => {
        if (isInteractiveMode) return; // Block navigation during game

        if (viewMode === 'full') {
            // Enter guided mode on first region
            if ((currentPage.regions?.length ?? 0) > 0) {
                setViewMode('guided');
                setRegionIndex(0);
            } else {
                // No regions, go to next page
                goToNextPage();
            }
        } else {
            // In Guided Mode
            const region = currentPage.regions[regionIndex];

            // Check for interactivity BEFORE moving
            if (region.isInteractive) {
                setIsInteractiveMode(true);
                return;
            }

            if (regionIndex < currentPage.regions.length - 1) {
                setRegionIndex(prev => prev + 1);
            } else {
                // End of regions, go to next page
                goToNextPage();
            }
        }
    };

    const handlePrev = () => {
        if (isInteractiveMode) return;

        if (viewMode === 'guided') {
            if (regionIndex > 0) {
                setRegionIndex(prev => prev - 1);
            } else {
                setViewMode('full');
            }
        } else {
            // In Full mode, go to prev page
            if (pageIndex > 0) {
                setPageIndex(prev => prev - 1);
                setViewMode('full'); // Start at full view of prev page
            }
        }
    };

    const goToNextPage = () => {
        if (pageIndex < albumData.length - 1) {
            setPageIndex(prev => prev + 1);
            setViewMode('full');
            setRegionIndex(0);
        } else {
            if (user) dataService.marcarComoTerminado(user.id, content.id);
            // Phase 7: Show inline completion screen instead of alert()
            setSessionComplete(true);
        }
    };

    // Phase 7: Keyboard navigation for desktop (ArrowLeft / ArrowRight / Space)
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); handleNext(); }
            else if (e.key === 'ArrowLeft') { e.preventDefault(); handlePrev(); }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pageIndex, regionIndex, viewMode, isInteractiveMode, sessionComplete]);

    // Interactive Click Handler
    const handleInteraction = (e: React.MouseEvent<HTMLDivElement>) => {
        if (!isInteractiveMode || !currentRegion) return;

        // Get click coordinates relative to the image container
        const rect = e.currentTarget.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;

        // Check if click is inside the region
        if (
            x >= currentRegion.x && x <= currentRegion.x + currentRegion.width &&
            y >= currentRegion.y && y <= currentRegion.y + currentRegion.height
        ) {
            // SUCCESS!
            confetti({
                particleCount: 100,
                spread: 70,
                origin: { y: 0.6 }
            });
            setIsInteractiveMode(false); // Unlock
            setShowHint(false);

            // Auto advance after success
            setTimeout(() => {
                if (regionIndex < currentPage.regions.length - 1) {
                    setRegionIndex(prev => prev + 1);
                } else {
                    goToNextPage();
                }
            }, 1500);
        } else {
            // Wrong click
            // Shake effect logic could go here
        }
    };

    const toggleMute = () => {
        if (isMuted) {
            setIsMuted(false);
            // Retry playing current if available
            const cacheKey = `${pageIndex}-${regionIndex}`;
            if (audioCache.current.has(cacheKey) && audioRef.current) {
                audioRef.current.src = audioCache.current.get(cacheKey)!;
                audioRef.current.play();
                setIsPlaying(true);
            }
        } else {
            setIsMuted(true);
            if (audioRef.current) {
                audioRef.current.pause();
                setIsPlaying(false);
            }
        }
    };

    const replayAudio = () => {
        if (audioRef.current && !isMuted) {
            audioRef.current.currentTime = 0;
            audioRef.current.play();
            setIsPlaying(true);
        }
    };

    // Phase 7: Inline completion screen
    if (sessionComplete) {
        return (
            <div className="fixed inset-0 bg-black flex flex-col items-center justify-center z-50 text-white">
                <div className="backdrop-blur-xl bg-white/10 border border-white/20 rounded-3xl p-10 text-center max-w-sm mx-4 shadow-2xl">
                    <div className="text-6xl mb-6">📖</div>
                    <h2 className="text-3xl font-bold mb-2">¡Álbum completado!</h2>
                    <p className="text-white/60 mb-8 text-sm">{content.titulo}</p>
                    <button
                        onClick={() => navigate(`/contenido/${content.id}`)}
                        className="px-8 py-3 bg-indigo-500 hover:bg-indigo-400 text-white rounded-full font-semibold transition-colors"
                    >
                        Finalizar
                    </button>
                </div>
            </div>
        );
    }

    if (!currentPage) {
        return (
            <div className="fixed inset-0 bg-black flex items-center justify-center text-white/50 text-sm">
                Este álbum no tiene páginas cargadas.
            </div>
        );
    }

    return (
        <div className="fixed inset-0 bg-black overflow-hidden flex flex-col">
            {/* Header Controls */}
            <div className="absolute top-0 left-0 right-0 z-50 p-4 flex justify-between items-center bg-gradient-to-b from-black/60 to-transparent pointer-events-none">
                <button onClick={() => navigate(`/contenido/${content.id}`)} className="pointer-events-auto p-2 bg-black/30 hover:bg-white/20 rounded-full text-white backdrop-blur-sm border border-white/10">
                    <ChevronLeft />
                </button>

                {/* Phase 7: Page counter */}
                <span className="pointer-events-none select-none text-white text-sm bg-black/30 backdrop-blur-sm px-3 py-1 rounded-full border border-white/10 self-center">
                    {pageIndex + 1} / {albumData.length}
                </span>

                <div className="pointer-events-auto flex gap-2">
                    {/* Audio Controls */}
                    {viewMode === 'guided' && !isInteractiveMode && (
                        <>
                            <button onClick={replayAudio} className="p-2 bg-black/30 hover:bg-white/20 rounded-full text-white backdrop-blur-sm border border-white/10" title="Repetir audio">
                                <RotateCcw size={20} />
                            </button>
                            <button onClick={toggleMute} className="p-2 bg-black/30 hover:bg-white/20 rounded-full text-white backdrop-blur-sm border border-white/10" title={isMuted ? "Activar voz" : "Silenciar voz"}>
                                {isMuted ? <VolumeX size={20} /> : <Volume2 size={20} className={isPlaying ? "text-indigo-400" : ""} />}
                            </button>
                        </>
                    )}

                    <button onClick={() => setShowText(!showText)} className="p-2 bg-black/30 hover:bg-white/20 rounded-full text-white backdrop-blur-sm border border-white/10">
                        {showText ? "Ocultar Texto" : "Ver Texto"}
                    </button>
                    <button onClick={() => setViewMode(viewMode === 'full' ? 'guided' : 'full')} className="p-2 bg-black/30 hover:bg-white/20 rounded-full text-white backdrop-blur-sm border border-white/10">
                        {viewMode === 'full' ? <ZoomIn /> : <ZoomOut />}
                    </button>
                </div>
            </div>

            {/* Main Canvas */}
            <div className="flex-1 relative flex items-center justify-center w-full h-full">
                <div
                    className="relative w-full h-full transition-transform duration-1000 ease-in-out will-change-transform"
                    style={transformStyle}
                >
                    {/* The Image — Phase 7: wide layout for double spreads */}
                    <img
                        src={currentPage.imageUrl}
                        alt=""
                        className={`select-none object-contain ${currentPage.doubleSpread ? 'w-full h-auto' : 'max-w-full max-h-full'}`}
                        onClick={handleInteraction}
                    />
                </div>
            </div>

            {/* Text / Narrative Overlay */}
            {showText && (viewMode === 'guided' || isInteractiveMode) && currentRegion && (
                <div className={`absolute bottom-8 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-[600px] z-40 transition-all duration-500 ${isInteractiveMode ? 'scale-105' : ''}`}>
                    <div className={`backdrop-blur-xl bg-black/60 border border-white/10 rounded-2xl p-6 text-center shadow-2xl ${isInteractiveMode ? 'border-yellow-400/50 bg-black/80' : ''}`}>
                        {isInteractiveMode ? (
                            <div className="flex flex-col items-center animate-in zoom-in">
                                <div className="bg-yellow-400 text-black rounded-full p-2 mb-2">
                                    <HelpCircle size={32} />
                                </div>
                                <p className="text-yellow-200 font-bold text-lg mb-1">¡Desafío de Leo!</p>
                                <p className="text-white text-xl font-serif italic">"{currentRegion.interactiveHint}"</p>
                                <p className="text-xs text-gray-400 mt-2 uppercase tracking-wider">Toca la pantalla para encontrarlo</p>
                            </div>
                        ) : (
                            <div className="relative">
                                {loadingAudio && !isMuted ? (
                                    <div className="flex justify-center mb-2">
                                        <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce mr-1"></div>
                                        <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce mr-1 delay-75"></div>
                                        <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce delay-150"></div>
                                    </div>
                                ) : null}
                                <p className="text-white text-lg md:text-2xl font-serif leading-relaxed">
                                    {currentRegion.text}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Phase 7: Page-level text overlay in full view */}
            {showText && viewMode === 'full' && currentPage.text && (
                <div className="absolute bottom-20 left-4 right-4 md:left-1/2 md:-translate-x-1/2 md:w-[600px] z-40 pointer-events-none">
                    <div className="backdrop-blur-xl bg-black/60 border border-white/10 rounded-2xl p-5 text-center shadow-2xl">
                        <p className="text-white text-lg md:text-2xl font-serif leading-relaxed">
                            {currentPage.text}
                        </p>
                    </div>
                </div>
            )}

            {/* Full View Prompt — hidden when page already has text overlay */}
            {viewMode === 'full' && !currentPage.text && (
                <div className="absolute bottom-10 left-0 right-0 text-center z-40 pointer-events-none">
                    <span className="bg-black/50 backdrop-blur text-white px-4 py-2 rounded-full text-sm animate-pulse">
                        Toca para explorar
                    </span>
                </div>
            )}

            {/* Invisible Navigation Zones */}
            <div className="absolute inset-0 flex z-30">
                <div className="w-1/3 h-full" onClick={handlePrev}></div>
                <div className="w-1/3 h-full" onClick={handleNext}></div> {/* Center also advances for simplicity */}
                <div className="w-1/3 h-full" onClick={handleNext}></div>
            </div>

            {/* Integrated Chatbot for Visual Literacy + Recap */}
            <Chatbot visualContext={visualContext} initialMessage={leoRecapMessage} />

            {/* Audio Element */}
            <audio
                ref={audioRef}
                onEnded={() => setIsPlaying(false)}
                onPause={() => setIsPlaying(false)}
                onPlay={() => setIsPlaying(true)}
                className="hidden"
            />
        </div>
    );
};

export default VisorAlbum;
