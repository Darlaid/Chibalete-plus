
import React, { useState, useEffect, useRef } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Content } from '../types';
import { ChevronLeft, Type, Volume2, VolumeX, Globe, Moon, Sun, Loader2, Ruler, Image as ImageIcon, X, Mic, RefreshCw, Settings, ChevronUp, ChevronDown, Minus, Plus } from 'lucide-react';
import { generarAudioTTS, generarMicroResumenRecordatorio } from '../services/geminiService';
import { dataService } from '../services/dataService';
import { OralityModal } from '../components/OralityModal';
import { LeoCompanion } from '../components/LeoCompanion';
import Chatbot from '../components/Chatbot';

// Helper: PCM to WAV
const pcmToWav = (pcmData: Uint8Array, sampleRate: number = 24000, numChannels: number = 1) => {
    const buffer = new ArrayBuffer(44 + pcmData.length);
    const view = new DataView(buffer);
    const writeString = (view: DataView, offset: number, string: string) => { for (let i = 0; i < string.length; i++) view.setUint8(offset + i, string.charCodeAt(i)); };
    writeString(view, 0, 'RIFF'); view.setUint32(4, 36 + pcmData.length, true); writeString(view, 8, 'WAVE'); writeString(view, 12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * numChannels * 2, true); view.setUint16(32, numChannels * 2, true); view.setUint16(34, 16, true); writeString(view, 36, 'data'); view.setUint32(40, pcmData.length, true);
    const pcmView = new Uint8Array(buffer, 44); pcmView.set(pcmData); return buffer;
};

const VisorTexto: React.FC<{ content: Content }> = ({ content }) => {
    const { user } = useAuth();
    const location = useLocation();
    const useNavigateTo = useNavigate();
    const queryParams = new URLSearchParams(location.search);
    const initialLang = queryParams.get('lang') === 'en' ? 'en' : (queryParams.get('lang') === 'pt' ? 'pt' : 'es');

    const [language, setLanguage] = useState<'es' | 'en' | 'pt'>(initialLang as any);
    const [fontSize, setFontSize] = useState(18);
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [text, setText] = useState<string>('');
    const [loading, setLoading] = useState(true);

    // Display Menu State
    const [isDisplayMenuOpen, setIsDisplayMenuOpen] = useState(false);

    // Accessibility State
    const [isDyslexicFont, setIsDyslexicFont] = useState(false);
    const [showRuler, setShowRuler] = useState(false);
    const [mouseY, setMouseY] = useState(0);

    // TTS State
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [audioLoading, setAudioLoading] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Visualizer
    const [showGalleryVisualizer, setShowGalleryVisualizer] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const galleryImages = content.ilustraciones_url || [];

    // Orality Lab MVP
    const [showOralityModal, setShowOralityModal] = useState(false);

    // Leo Phase 5 MVP
    const [showLeoCompanion, setShowLeoCompanion] = useState(false);
    
    // --- LEO SESSION MEMORY ---
    const defaultLeoMemory = {
        recentAnchors: [],
        lastQuestionType: null,
        sessionReadingProgress: 0,
        difficultyLevel: "medio",
        pedagogicalStage: 'comprehension',
    };
    
    const [leoMemory, setLeoMemory] = useState<any>(() => {
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
                    setShowLeoWelcome(true);
                    setTimeout(() => { if (isMounted) setShowLeoWelcome(false); }, 6000);
                }
            }
            if (isMounted) setIsMemoryLoaded(true);
        })();
        return () => { isMounted = false; };
    }, [user?.id, content?.id]);

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
    
    // Sync State
    const [initialScrollSet, setInitialScrollSet] = useState(false);

    useEffect(() => {
        if (user) dataService.addToHistory(user.id, content.id);
        if (user) dataService.recordReaderOpen(user.id, content.id, 'texto');
        setLoading(true); setAudioUrl(null); setIsPlaying(false); setShowGalleryVisualizer(false);
        setInitialScrollSet(false);
        sessionStartRef.current = Date.now(); // Reset session timer on content/user change

        const loadContent = async () => {
            try {
                let targetUrl = '';
                if (language === 'es') targetUrl = content.texto_plano_url || '';
                else if (language === 'en') targetUrl = content.texto_ingles_url || '';
                else if (language === 'pt') targetUrl = content.texto_portugues_url || '';

                console.log(`[Visor] Loading Content: ${content.titulo} (${language})`);

                if (targetUrl) {
                    try {
                        const response = await fetch(targetUrl);
                        if (response.ok) {
                            const textData = await response.text();
                            if (textData && !textData.trim().startsWith("<!DOCTYPE")) {
                                setText(textData);
                                setLoading(false);
                                return;
                            }
                        }
                    } catch (fetchErr) {
                        console.warn("[Visor] Network error fetching file:", fetchErr);
                    }
                }

                setText(`⚠️ ERROR DE CARGA DE CONTENIDO\n\nNo se pudo encontrar el archivo de texto para este libro.\n\nDetalles:\n- ID: ${content.id}\n- Idioma: ${language}\n- URL Buscada: ${targetUrl || 'Ninguna configurada'}`);
                setLoading(false);

            } catch (e) {
                console.error("Critical error loading content:", e);
                setText("Error crítico cargando el contenido.");
                setLoading(false);
            }
        };

        loadContent();

        return () => { if (audioUrl) URL.revokeObjectURL(audioUrl); }
    }, [content, language, user]);

    // Check Inactivity Logic
    useEffect(() => {
        const checkInactivity = async () => {
            if (!user || checkedRecap) return;
            setCheckedRecap(true);
            const progress = dataService.getProgresoUsuarioLibro(user.id, content.id);

            // Welcome Back
            if (progress && progress.porcentaje > 0) {
                try {
                    const contextText = text.substring(0, 500) || content.descripcion_corta;
                    const recap = await generarMicroResumenRecordatorio(contextText, content.titulo);
                    setLeoRecapMessage(recap);
                } catch (e) { console.error(e); }
            }
        };
        if (!loading && text) checkInactivity();
    }, [user, content, loading, text, checkedRecap]);

    // SYNC LOGIC: SCROLL
    useEffect(() => {
        if (!loading && text && user && !initialScrollSet) {
            const progress = dataService.getProgresoUsuarioLibro(user.id, content.id);
            if (progress && progress.porcentaje > 0) {
                // Resume logic
                setTimeout(() => {
                    const scrollTarget = (progress.porcentaje / 100) * document.body.scrollHeight;
                    if (scrollTarget > 100) window.scrollTo({ top: scrollTarget, behavior: 'smooth' });
                }, 500); // Slight delay for render
            }
            setInitialScrollSet(true);
        }
    }, [loading, text, user, content.id, initialScrollSet]);
    // Session timer ref for totalTimeMs accumulation
    const sessionStartRef = useRef<number>(Date.now());

    // Save Progress logic
    const saveProgress = () => {
        if (!user || loading) return;
        const scrollTop = window.scrollY;
        const docHeight = document.body.scrollHeight - window.innerHeight;
        if (docHeight <= 0) return;
        const percentage = Math.max(0, Math.min(100, Math.round((scrollTop / docHeight) * 100)));
        // Phase 3.3 payload format: userId, contentId, physicalPage, totalPages, sentenceIndex, mode
        dataService.updateProgreso(
            user.id, content.id, percentage, 100, undefined, 'text',
            { lastMode: 'texto', elapsedMs: Date.now() - sessionStartRef.current }
        );
    };

    // Track Scroll for Progress Saving (Debounced)
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        const handleScroll = () => {
            // Only auto-save if user is logged in
            if (!user || loading) return;

            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }

            saveTimeoutRef.current = setTimeout(() => {
                saveProgress();
                
                // Also update sessionReadingProgress in Leo memory
                const docHeight = document.body.scrollHeight - window.innerHeight;
                if (docHeight > 0) {
                    const prog = Math.max(0, Math.min(100, Math.round((window.scrollY / docHeight) * 100)));
                    setLeoMemory((prev: any) => {
                        if (prev.sessionReadingProgress === prog) return prev;
                        // Simple pedagogical stage derivation
                        let newStage = prev.pedagogicalStage || 'comprehension';
                        const anchorsOpened = prev.recentAnchors?.length || 0;
                        if (prog >= 85) newStage = 'creation';
                        else if (prog >= 60 || anchorsOpened >= 5) newStage = 'reflection';
                        else if (prog >= 25 || anchorsOpened >= 2) newStage = 'interpretation';
                        
                        return { ...prev, sessionReadingProgress: prog, pedagogicalStage: newStage };
                    });
                }
            }, 1000);
        };

        window.addEventListener('scroll', handleScroll);
        return () => {
            window.removeEventListener('scroll', handleScroll);
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            dataService.forceFlush();
        };
    }, [user, content.id, loading]);


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
    const [playbackSpeed, setPlaybackSpeed] = useState(1.0);

    // Load Manifest
    useEffect(() => {
        const loadManifest = async () => {
            try {
                // Try fetching manifest for default/Turbo mode
                // Add timestamp to avoid caching issues during dev
                const response = await fetch(`/uploads/audio/${content.id}/manifest.json?t=${Date.now()}`);
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

    // Speed Effect
    useEffect(() => {
        if (audioRef.current) {
            audioRef.current.playbackRate = playbackSpeed;
            audioRef.current.preservePitch = true;
        }
    }, [playbackSpeed]);

    const playNextSegment = () => {
        if (!manifest) return;
        const nextIndex = currentAudioIndex + 1;
        if (manifest[nextIndex]) {
            setCurrentAudioIndex(nextIndex);
            playManifestAudio(nextIndex);
        } else {
            setIsPlaying(false);
            setCurrentAudioIndex(0);
        }
    };

    const playManifestAudio = (index: number) => {
        if (!manifest || !manifest[index]) return;
        const entry = manifest[index];
        const url = `/uploads/${entry.file}`;

        if (audioRef.current) {
            audioRef.current.src = url;
            audioRef.current.playbackRate = playbackSpeed; // Apply speed on load
            audioRef.current.play()
                .then(() => setIsPlaying(true))
                .catch(e => console.error("Play error:", e));
        }
    };

    const handleTTS = async () => {
        if (isPlaying) {
            audioRef.current?.pause();
            setIsPlaying(false);
            return;
        }

        // OPTION A: TURBO (Manifest)
        if (manifest && Object.keys(manifest).length > 0) {
            playManifestAudio(currentAudioIndex);
            return;
        }

        // OPTION B: LEGACY (Live Gen - Warning: Limited to 300 chars)
        setAudioLoading(true);
        try {
            const textToRead = text.substring(0, 300);
            const audioBase64 = await generarAudioTTS(textToRead);
            if (audioBase64) {
                const binaryString = atob(audioBase64);
                const len = binaryString.length;
                const bytes = new Uint8Array(len);
                for (let i = 0; i < len; i++) bytes[i] = binaryString.charCodeAt(i);
                const wavBuffer = pcmToWav(bytes, 24000, 1);
                const blob = new Blob([wavBuffer], { type: 'audio/wav' });
                const url = URL.createObjectURL(blob);
                setAudioUrl(url);

                if (audioRef.current) {
                    audioRef.current.src = url;
                    audioRef.current.play().then(() => setIsPlaying(true));
                }
            }
        } catch (e) {
            console.error("Legacy TTS failed", e);
            // L1: No alert — error visible in console, user can retry via the same button
        } finally {
            setAudioLoading(false);
        }
    };

    const toggleGallery = () => {
        if (galleryImages.length > 0) setShowGalleryVisualizer(!showGalleryVisualizer);
        // L4: No alert — button is disabled when empty (see toolbar below)
    }

    // Derived sentences for Orality Lab
    const sentences = text ? (text.match(/[^.!?]+(?:[.!?]+|$)/g) || [text.substring(0, 200)]) : [];
    const currentIndex = currentAudioIndex < sentences.length ? currentAudioIndex : 0;

    const scrollUp = () => {
        window.scrollBy({ top: -window.innerHeight * 0.8, behavior: 'smooth' });
    };

    const scrollDown = () => {
        window.scrollBy({ top: window.innerHeight * 0.8, behavior: 'smooth' });
    };

    return (
        <div className={`min-h-screen flex flex-col font-serif transition-colors duration-300 ${isDarkMode ? 'bg-gray-900 text-gray-300' : 'bg-[#fdfbf7] text-gray-900'}`}>


            <header className="sticky top-0 z-40 flex items-center justify-between p-3 bg-white/95 dark:bg-gray-800/95 backdrop-blur shadow-sm border-b border-gray-200 dark:border-gray-700">
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
                        title="Leer en voz alta"
                    >
                        {audioLoading ? <Loader2 size={24} className="animate-spin" /> : (isPlaying ? <VolumeX size={24} /> : <Volume2 size={24} />)}
                    </button>

                    <button
                        onClick={() => setShowOralityModal(true)}
                        className={`p-2 rounded-full transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center bg-indigo-100 text-indigo-700 hover:bg-indigo-200 dark:bg-indigo-900 dark:text-indigo-300`}
                        title="Laboratorio de oralidad"
                    >
                        <Mic size={24} />
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

            {isDisplayMenuOpen && (
                <div className="fixed top-[60px] right-2 z-[70] bg-white dark:bg-gray-800 rounded-xl shadow-2xl border border-gray-200 dark:border-gray-700 p-4 w-64 animate-in fade-in zoom-in-95">
                    <div className="space-y-4">
                        <div>
                            <p className="text-xs font-bold text-gray-500 uppercase mb-2">Tamaño de Fuente</p>
                            <div className="flex justify-between items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                                <button onClick={() => setFontSize(s => Math.max(14, s - 2))} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex-1 text-center"><Type size={16} /></button>
                                <span className="text-sm font-mono">{fontSize}px</span>
                                <button onClick={() => setFontSize(s => Math.min(32, s + 2))} className="p-2 hover:bg-gray-200 dark:hover:bg-gray-600 rounded flex-1 text-center"><Type size={24} /></button>
                            </div>
                        </div>

                        <div className="flex justify-between items-center">
                            <span className="text-sm font-medium">Modo Oscuro</span>
                            <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 bg-gray-100 dark:bg-gray-700 rounded-full">
                                {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                            </button>
                        </div>

                        <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                            <p className="text-xs font-bold text-gray-500 uppercase mb-2">Idioma del Texto</p>
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
                            <p className="text-xs font-bold text-gray-500 uppercase mb-2">Accesibilidad</p>
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
                                >
                                    Regla Focal
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="border-t border-gray-200 dark:border-gray-700 pt-2">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Velocidad de Voz</p>
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

            {/* SIDE FLOATING BUTTONS */}
            <button
                onClick={scrollUp}
                className="fixed left-4 top-1/2 -translate-y-1/2 z-50 p-4 bg-gray-200/90 dark:bg-gray-700/90 hover:bg-indigo-600 hover:text-white rounded-full shadow-xl transition-all border border-gray-300 dark:border-gray-600 opacity-70 hover:opacity-100"
                aria-label="Retroceder texto"
            >
                <ChevronUp size={32} />
            </button>

            <button
                onClick={scrollDown}
                className="fixed right-4 top-1/2 -translate-y-1/2 z-50 p-4 bg-gray-200/90 dark:bg-gray-700/90 hover:bg-indigo-600 hover:text-white rounded-full shadow-xl transition-all border border-gray-300 dark:border-gray-600 opacity-70 hover:opacity-100"
                aria-label="Avanzar texto"
            >
                <ChevronDown size={32} />
            </button>


            {
                showRuler && (
                    <div className="fixed inset-0 z-30 pointer-events-none overflow-hidden touch-none">
                        <div className="absolute top-0 left-0 right-0 bg-black/70 transition-all duration-75 ease-out" style={{ height: Math.max(0, mouseY - 60) }}></div>
                        <div className="absolute left-0 right-0 bg-black/70 transition-all duration-75 ease-out" style={{ top: mouseY + 60, bottom: 0 }}></div>
                        <div className="absolute left-0 right-0 border-t-2 border-b-2 border-indigo-500/30 transition-all duration-75 ease-out" style={{ top: Math.max(0, mouseY - 60), height: 120 }}></div>
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
                        onClose={() => setShowLeoCompanion(false)} 
                        sessionMemory={leoMemory}
                        difficultyLevel={leoMemory.difficultyLevel}
                        pedagogicalStage={leoMemory.pedagogicalStage}
                        onMemoryUpdate={(updates) => setLeoMemory((prev: any) => ({ ...prev, ...updates }))}
                        onNavigate={(idx) => { setCurrentAudioIndex(idx); playManifestAudio(idx); }}
                    />
                )
            }

            {/* LEO WELCOME TOAST (Fase B1.5) */}
            {showLeoWelcome && !showLeoCompanion && (
                <div 
                    className="fixed bottom-24 right-6 z-50 bg-indigo-600/90 backdrop-blur-md text-white px-5 py-4 rounded-2xl shadow-2xl border border-indigo-400/30 animate-in slide-in-from-bottom-5 fade-in duration-500 max-w-xs cursor-pointer hover:bg-indigo-600 transition-colors" 
                    onClick={() => { setShowLeoWelcome(false); setShowLeoCompanion(true); if (isPlaying) { audioRef.current?.pause(); setIsPlaying(false); } }}
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

            {/* LEO FLOATING BUTTON */}
            {!showLeoCompanion && (
                <button
                    onClick={() => {
                        setShowLeoWelcome(false);
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
                {loading ? <div className="flex justify-center py-20"><Loader2 size={40} className="animate-spin text-indigo-500" /></div> :
                    <article className={`prose dark:prose-invert max-w-none leading-relaxed whitespace-pre-wrap ${isDyslexicFont ? 'font-opendyslexic' : ''}`} style={{ fontSize: `${fontSize}px` }}>{text}</article>}
            </main>
        </div >
    );
};

export default VisorTexto;
