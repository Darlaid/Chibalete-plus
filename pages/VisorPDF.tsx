import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Content } from '../types';
import { useAuth } from '../context/AuthContext';
import { dataService } from '../services/dataService';
import * as analyticsService from '../services/analyticsService';
import { Sun, Moon, ChevronLeft, ChevronRight, Loader2, Minus, Plus, Maximize, Minimize, Smartphone, Info, X, Tag, User } from 'lucide-react';
import { useDevice } from '../hooks/useDevice';
import MobileOrientationOverlay from '../components/MobileOrientationOverlay';
import PinchZoomContainer from '../components/PinchZoomContainer';
import { getResumeToast } from '../utils/canonicalProgress';

declare const pdfjsLib: any;

const VisorPDF: React.FC<{ content: Content }> = ({ content }) => {
    const { user } = useAuth();
    const navigate = useNavigate();

    // -- State --
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [pageNum, setPageNum] = useState(1);
    const [numPages, setNumPages] = useState(0);
    const [scale, setScale] = useState(1.0); // Start at 1.0, will auto-adjust
    const [isDarkMode, setIsDarkMode] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [showInfo, setShowInfo] = useState(false);
    // D/E: Resume toast — shown once after PDF init when progress > 0
    const [resumeToast, setResumeToast] = useState<{ label: string; crossMode: boolean; fromRemote: boolean } | null>(null);
    const resumeToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    // E: Stores whether remote progress was adopted for cross-device hint.
    const fromRemoteProgressRef = useRef(false);

    const containerRef = useRef<HTMLDivElement>(null);

    // -- Auto Fit Logic --
    const autoFit = async (doc: any) => {
        if (!doc || !containerRef.current) return;
        try {
            const page = await doc.getPage(pageNum);
            const viewport = page.getViewport({ scale: 1.0 });

            // Measure available space (p-8 = 32px*2 = 64px. Let's assume approx 80px buffer)
            const availableWidth = containerRef.current.clientWidth - 80;
            const availableHeight = containerRef.current.clientHeight - 40;

            if (availableWidth <= 0 || availableHeight <= 0) return;

            // Calculate ratios
            const widthRatio = availableWidth / viewport.width;
            const heightRatio = availableHeight / viewport.height;

            // Default: Try to fit strictly inside (Contain)
            let optimal = Math.min(widthRatio, heightRatio);

            // If Spread (2 pages)
            if (pageNum > 1 && pageNum < doc.numPages) {
                const spreadWidth = viewport.width * 2;
                const spreadWidthRatio = availableWidth / spreadWidth;
                optimal = Math.min(spreadWidthRatio, heightRatio);
            }

            // HEURISTIC: If 'optimal' (Fit Page) is too small (< 50%), 
            // text is likely unreadable. Switch to Fit Width constraint instead.
            // This forces vertical scrolling but ensures readability.
            if (optimal < 0.50) {
                // Try fitting width instead
                const spreadMode = pageNum > 1 && pageNum < doc.numPages;
                const wRatio = spreadMode
                    ? availableWidth / (viewport.width * 2)
                    : availableWidth / viewport.width;

                // If fitting width is still huge (e.g. > 1.2), cap it.
                // If fitting width is decent (e.g. 0.8), use it.
                optimal = wRatio;
            }

            // Hard Sanity Caps
            optimal = Math.min(optimal, 1.5); // Don't auto-zoom bigger than 150% initially
            optimal = Math.max(optimal, 0.2); // Don't go microscopic

            setScale(optimal);
        } catch (e) {
            console.error("Auto fit failed", e);
        }
    };

    // -- PDF Init --
    useEffect(() => {
        let active = true;
        const loadPdf = async () => {
            let rawUrl = content.url_recurso || '';
            const url = rawUrl.startsWith('http') ? rawUrl : (rawUrl.startsWith('/') ? rawUrl : '/' + rawUrl);

            if (!url) {
                if (active) { setError("URL no disponible"); setIsLoading(false); }
                return;
            }

            try {
                if (active) setIsLoading(true);

                // Ensure Worker (Wait loop)
                if (typeof pdfjsLib === 'undefined') {
                    const start = Date.now();
                    while (typeof pdfjsLib === 'undefined' && Date.now() - start < 4000) {
                        await new Promise(r => setTimeout(r, 100));
                    }
                    if (typeof pdfjsLib === 'undefined') throw new Error("Motor PDF no inicializado.");
                }
                if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
                    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
                }

                const loadingTask = pdfjsLib.getDocument(url);
                const doc = await loadingTask.promise;

                if (active) {
                    setPdfDoc(doc);
                    setNumPages(doc.numPages);

                    // Resume Logic
                    if (user) {
                        // E: Fetch remote progress before computing resume page — ensures cross-device
                        // accuracy. 3s timeout, silent on failure. PDF load itself takes longer so
                        // this usually resolves before we reach this line.
                        const fromRemote = await dataService.fetchAndMergeRemoteProgress(user.id, content.id).catch(() => false);
                        fromRemoteProgressRef.current = fromRemote;

                        const progress = dataService.getProgresoUsuarioLibro(user.id, content.id);
                        if (progress && progress.porcentaje > 0) {
                            // E: Prefer anchor.type='page' (exact page number) over percentage translation.
                            // Without anchor: (porcentaje/100 * numPages) can land 1-2 pages off due to rounding.
                            // With anchor: the exact page that was open when progress was saved.
                            const anchor = progress.canonicalProgress?.anchor;
                            let p: number;
                            if (anchor?.type === 'page' && anchor.value > 0) {
                                p = anchor.value; // exact page — no translation needed
                            } else {
                                p = Math.floor((progress.porcentaje / 100) * doc.numPages);
                            }
                            if (p > 1 && p % 2 !== 0) p = p - 1; // spread-view: snap to even page
                            const target = Math.max(1, p);
                            setPageNum(target === 1 ? 1 : (target % 2 === 0 ? target : target - 1));

                            // D/E: Resume toast — notify user we're restoring their position.
                            const lastMode = progress.canonicalProgress?.lastInteractedMode ?? (progress as any).last_device_mode;
                            const toast = getResumeToast(progress.porcentaje, lastMode, 'pdf', fromRemote);
                            if (toast) {
                                setResumeToast(toast);
                                if (resumeToastTimerRef.current) clearTimeout(resumeToastTimerRef.current);
                                resumeToastTimerRef.current = setTimeout(() => setResumeToast(null), 5000);
                            }
                        }
                        // Record this reader open (sessionsCount + lastOpenedAt)
                        dataService.recordReaderOpen(user.id, content.id, 'pdf');
                        sessionStartRef.current = Date.now();
                        analyticsService.track({
                            event: 'session_start',
                            userId: user.id,
                            contentId: content.id,
                            timestamp: Date.now(),
                            streak: 0,
                            level: 0,
                            sessionDuration: 0,
                            source: 'pdf',
                        });
                        sessionStartedRef.current = true;
                        analyticsService.startHeartbeat({ userId: user.id, contentId: content.id, sessionStartRef });
                    }

                    // Trigger FIT
                    setTimeout(() => autoFit(doc), 100);

                    setIsLoading(false);
                }
            } catch (e: any) {
                if (active) {
                    console.error(e);
                    setError("Error cargando PDF. Verifica la URL o la conexión.");
                    setIsLoading(false);
                }
            }
        };
        loadPdf();
        return () => { active = false; };
    }, [content.url_recurso, user, content.id]);

    // Re-run autofit on window resize
    useEffect(() => {
        const handleResize = () => {
            if (pdfDoc) autoFit(pdfDoc);
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [pdfDoc, pageNum]);

    // -- Device & Orientation --
    const { isMobile } = useDevice();
    const [isLandscape, setIsLandscape] = useState(false);
    const [isFullScreen, setIsFullScreen] = useState(false);

    useEffect(() => {
        const checkOrientation = () => {
            setIsLandscape(window.matchMedia("(orientation: landscape)").matches);
        };
        checkOrientation();
        window.addEventListener('resize', checkOrientation);
        return () => window.removeEventListener('resize', checkOrientation);
    }, []);

    useEffect(() => {
        const handleFsChange = () => {
            setIsFullScreen(!!document.fullscreenElement);
        };
        document.addEventListener('fullscreenchange', handleFsChange);
        return () => document.removeEventListener('fullscreenchange', handleFsChange);
    }, []);

    const enterFullScreen = async () => {
        try {
            await document.documentElement.requestFullscreen();
        } catch (e) {
            console.error("Fullscreen denied", e);
        }
    };

    const exitFullScreen = async () => {
        if (document.fullscreenElement) {
            await document.exitFullscreen();
        }
    };

    const isCover = pageNum === 1;
    const showSpread = !isCover && (pageNum < numPages);

    // -- Navigation --
    const goPrev = () => {
        if (pageNum <= 1) return;
        if (pageNum === 2) setPageNum(1);
        else setPageNum(p => p - 2);
    };

    const goNext = () => {
        if (pageNum >= numPages) return;
        if (pageNum === 1) setPageNum(2);
        else setPageNum(p => p + 2);
    };

    // -- Saving Progress --
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const sessionStartRef = useRef<number>(Date.now()); // Session timer for totalTimeMs
    const sessionStartedRef = useRef<boolean>(false);   // guard: only emit session_end if session_start fired
    // Refs to read latest pageNum/numPages in the unmount-only effect below
    const pageNumRef = useRef<number>(pageNum);
    const numPagesRef = useRef<number>(numPages);

    // Progress-saving effect: fires on page changes, saves progress and emits page_change.
    // Cleanup only cancels the debounce timer and flushes progress — never touches session lifecycle.
    useEffect(() => {
        pageNumRef.current = pageNum;
        numPagesRef.current = numPages;

        if (user && numPages > 0) {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            saveTimeoutRef.current = setTimeout(() => {
                // emit physical page out of total pages, not percentage.
                // E: anchor type='page' stores the exact page number for same-mode precision.
                dataService.updateProgreso(
                    user.id, content.id, pageNum, numPages, undefined, 'pdf',
                    { lastMode: 'pdf', elapsedMs: Date.now() - sessionStartRef.current },
                    { type: 'page', value: pageNum }
                );
                // page_change event — only after session is live
                if (sessionStartedRef.current) {
                    analyticsService.track({
                        event: 'page_change',
                        userId: user.id,
                        contentId: content.id,
                        timestamp: Date.now(),
                        streak: 0,
                        level: 0,
                        sessionDuration: Date.now() - sessionStartRef.current,
                        pageNumber: pageNum,
                        totalPages: numPages,
                        progressPercentage: Math.round((pageNum / numPages) * 100),
                    });
                }
            }, 1000);
        }
        return () => {
            if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
            dataService.forceFlush();
        };
    }, [pageNum, numPages, user, content.id]);

    // Unmount-only effect: emits session_end and stops heartbeat exactly once when the
    // component is destroyed. Uses refs for pageNum/numPages so it always reads the
    // latest position even though deps are empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => {
        return () => {
            if (sessionStartedRef.current && user) {
                analyticsService.track({
                    event: 'session_end',
                    userId: user.id,
                    contentId: content.id,
                    timestamp: Date.now(),
                    streak: 0,
                    level: 0,
                    sessionDuration: Date.now() - sessionStartRef.current,
                    progressPercentage: numPagesRef.current > 0
                        ? Math.round((pageNumRef.current / numPagesRef.current) * 100)
                        : 0,
                    source: 'pdf',
                });
                analyticsService.flush();
            }
            analyticsService.stopHeartbeat();
        };
    // Empty deps: intentional. This effect runs its cleanup only on unmount.
    // pageNum and numPages are read from refs (pageNumRef / numPagesRef) which are
    // kept in sync by the progress-saving effect above.
    }, []); // eslint-disable-line react-hooks/exhaustive-deps


    // -- Canvas Renderer --
    const CanvasPage = ({ pNum }: { pNum: number }) => {
        const canvasRef = useRef<HTMLCanvasElement>(null);

        useEffect(() => {
            if (!pdfDoc || !canvasRef.current) return;
            let active = true;

            const render = async () => {
                try {
                    const page = await pdfDoc.getPage(pNum);
                    if (!active) return;

                    let renderScale = scale;
                    // Mobile Fullscreen Override:
                    if (isMobile && isLandscape && isFullScreen) {
                        const vp = page.getViewport({ scale: 1.0 });
                        const hRatio = window.innerHeight / vp.height;
                        renderScale = hRatio;
                    }

                    const viewport = page.getViewport({ scale: renderScale });

                    const canvas = canvasRef.current!;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) return;

                    canvas.width = viewport.width;
                    canvas.height = viewport.height;

                    await page.render({ canvasContext: ctx, viewport }).promise;
                } catch (e) { /* ignore cancel */ }
            };
            render();
            return () => { active = false; };
        }, [pdfDoc, pNum, scale, isMobile, isLandscape, isFullScreen]);

        return <canvas ref={canvasRef} className={`shadow-lg bg-white ${isMobile && isFullScreen ? 'mx-0 my-0' : 'mx-1 my-4'}`} />;
    };

    // Calculate thumbnail range
    const thumbRange = Array.from({ length: numPages }, (_, i) => i + 1);

    // -- Mobile Checks --
    if (isMobile && !isLandscape) {
        return <MobileOrientationOverlay />;
    }

    if (isMobile && isLandscape && !isFullScreen) {
        return (
            <div className="fixed inset-0 z-50 bg-gray-900 flex flex-col items-center justify-center p-6 text-center text-white">
                <h1 className="text-2xl font-bold mb-4">Modo Lectura</h1>
                <p className="mb-8 text-gray-300">Para la mejor experiencia, entra en pantalla completa.</p>
                <button
                    onClick={enterFullScreen}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-3 rounded-full text-lg font-semibold transition-transform active:scale-95"
                >
                    <Maximize size={24} />
                    Entrar
                </button>
            </div>
        );
    }


    // -- RENDER HELPERS --
    const RenderContent = () => (
        <>
            <button
                onClick={goPrev}
                disabled={pageNum <= 1}
                className={`absolute left-0 top-0 bottom-0 w-16 md:w-24 flex items-center justify-center group z-30 focus:outline-none disabled:pointer-events-none`}
                aria-label="Página anterior"
            >
                <div className={`p-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur shadow-lg rounded-full text-gray-700 dark:text-white group-hover:bg-white dark:group-hover:bg-gray-700 transition transform group-active:scale-95 ${pageNum <= 1 ? 'opacity-0' : ''}`}>
                    <ChevronLeft size={32} />
                </div>
            </button>

            {/* Pages Container */}
            <div className={`flex items-center gap-0 ${isMobile && isFullScreen ? '' : 'shadow-2xl'} transition-transform duration-200`}>
                <CanvasPage pNum={pageNum} />
                {!isCover && (pageNum + 1 <= numPages) && (
                    <CanvasPage pNum={pageNum + 1} />
                )}
            </div>

            <button
                onClick={goNext}
                disabled={pageNum >= numPages}
                className={`absolute right-0 top-0 bottom-0 w-16 md:w-24 flex items-center justify-center group z-30 focus:outline-none disabled:pointer-events-none`}
                aria-label="Página siguiente"
            >
                <div className={`p-3 bg-white/80 dark:bg-gray-800/80 backdrop-blur shadow-lg rounded-full text-gray-700 dark:text-white group-hover:bg-white dark:group-hover:bg-gray-700 transition transform group-active:scale-95 ${pageNum >= numPages ? 'opacity-0' : ''}`}>
                    <ChevronRight size={32} />
                </div>
            </button>
        </>
    );

    // -- Mobile Fullscreen Render --
    if (isMobile && isLandscape && isFullScreen) {
        return (
            <div className="fixed inset-0 bg-black flex items-center justify-center overflow-hidden z-50">
                <button
                    onClick={exitFullScreen}
                    className="absolute top-4 right-4 z-50 bg-black/50 text-white p-2 rounded-full hover:bg-black/70 backdrop-blur"
                >
                    <Minimize size={24} />
                </button>

                <PinchZoomContainer enabled={true}>
                    <div className="flex items-center justify-center h-full">
                        {(!isLoading && !error && pdfDoc) ? <RenderContent /> : <Loader2 className="animate-spin text-white" />}
                    </div>
                </PinchZoomContainer>
            </div>
        );
    }

    // -- Normal Render --
    return (
        <div className={`flex flex-col h-screen w-full ${isDarkMode ? 'dark' : ''}`}>
            {/* Header */}
            <header className="bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 h-16 shrink-0 flex items-center justify-between px-4 z-20">
                <div className="flex items-center gap-2">
                    <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-gray-700 dark:text-gray-200">
                        <ChevronLeft size={24} />
                    </button>
                    <h1 className="text-lg font-semibold text-gray-800 dark:text-white truncate max-w-xs">{content.titulo}</h1>
                </div>

                <div className="flex items-center gap-4">
                    {/* Zoom Controls */}
                    <div className="flex items-center bg-gray-100 dark:bg-gray-700 rounded-lg p-1">
                        <button onClick={() => setScale(s => Math.max(0.1, s - 0.1))} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded">
                            <Minus size={20} className="text-gray-700 dark:text-gray-200" />
                        </button>
                        <span className="w-12 text-center text-sm font-medium text-gray-700 dark:text-gray-200">{Math.round(scale * 100)}%</span>
                        <button onClick={() => setScale(s => Math.min(3.0, s + 0.1))} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-600 rounded">
                            <Plus size={20} className="text-gray-700 dark:text-gray-200" />
                        </button>
                    </div>

                    {/* Metadata Toggle */}
                    <button
                        onClick={() => setShowInfo(!showInfo)}
                        className={`p-2 rounded-full transition-colors ${showInfo ? 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900/50 dark:text-indigo-300' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'}`}
                        title="Información del Contenido"
                    >
                        <Info size={20} />
                    </button>

                    {/* Theme Toggle */}
                    <button onClick={() => setIsDarkMode(!isDarkMode)} className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-full text-gray-700 dark:text-gray-200">
                        {isDarkMode ? <Sun size={20} /> : <Moon size={20} />}
                    </button>
                </div>
            </header>

            {/* Info Drawer/Modal */}
            {showInfo && (
                <div className="absolute top-16 right-4 z-40 w-80 bg-white dark:bg-gray-800 shadow-2xl rounded-xl border border-gray-200 dark:border-gray-700 animate-in slide-in-from-top-2 p-4">
                    <div className="flex justify-between items-start mb-4">
                        <h3 className="font-bold text-gray-800 dark:text-white">Información</h3>
                        <button onClick={() => setShowInfo(false)}><X size={16} className="text-gray-500 hover:text-red-500" /></button>
                    </div>

                    <div className="space-y-4 text-sm text-gray-600 dark:text-gray-300">
                        {content.autor && (
                            <div className="flex items-center gap-2 text-indigo-600 dark:text-indigo-400 font-medium">
                                <User size={16} />
                                {content.autor}
                            </div>
                        )}

                        {content.descripcion_corta && (
                            <div className="bg-gray-50 dark:bg-gray-900 p-3 rounded-lg text-xs leading-relaxed">
                                {content.descripcion_corta}
                            </div>
                        )}

                        {content.etiquetas && content.etiquetas.length > 0 && (
                            <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-100 dark:border-gray-700">
                                {content.etiquetas.map((tag, i) => (
                                    <span key={i} className="flex items-center gap-1 px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs">
                                        <Tag size={10} /> {tag}
                                    </span>
                                ))}
                            </div>
                        )}

                        {!content.descripcion_corta && !content.etiquetas?.length && (
                            <p className="text-center italic text-gray-400">Sin información adicional.</p>
                        )}
                    </div>
                </div>
            )}

            {/* Main Area */}
            <main ref={containerRef} className="flex-1 overflow-auto bg-gray-100 dark:bg-gray-900 flex items-center justify-center relative p-8">
                {isLoading && (
                    <div className="flex flex-col items-center gap-4">
                        <Loader2 className="animate-spin text-indigo-600" size={48} />
                        <p className="text-gray-500 dark:text-gray-400">Cargando libro...</p>
                    </div>
                )}

                {error && (
                    <div className="text-red-500 bg-red-50 dark:bg-red-900/20 p-4 rounded-lg">
                        {error}
                    </div>
                )}

                {!isLoading && !error && pdfDoc && <RenderContent />}
            </main>

            {/* D: RESUME TOAST — shown once per open when progress ≥ 5% */}
            {resumeToast && (
                <div
                    className={`fixed bottom-32 left-6 z-50 px-4 py-3 rounded-2xl shadow-xl border animate-in slide-in-from-bottom-5 fade-in duration-400 max-w-xs flex items-center gap-3 ${
                        isDarkMode
                            ? 'bg-gray-800/95 text-gray-100 border-gray-600 backdrop-blur-sm'
                            : 'bg-white/95 text-gray-800 border-gray-200 backdrop-blur-sm'
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
                        <p className={`text-xs leading-snug truncate ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>
                            Retomando desde {resumeToast.label}
                        </p>
                    </div>
                    <button
                        onClick={() => { if (resumeToastTimerRef.current) clearTimeout(resumeToastTimerRef.current); setResumeToast(null); }}
                        className={`shrink-0 p-1 rounded-full transition-colors ${isDarkMode ? 'hover:bg-gray-700' : 'hover:bg-gray-100'}`}
                        aria-label="Cerrar"
                    >
                        <X size={14} />
                    </button>
                </div>
            )}

            {/* Thumbnail Footer */}
            {!isLoading && !error && pdfDoc && (
                <div className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 h-28 shrink-0 flex items-center px-4 gap-3 overflow-x-auto z-20">
                    {thumbRange.map(p => (
                        <Thumbnail
                            key={p}
                            pNum={p}
                            pdfDoc={pdfDoc}
                            isActive={pageNum === p || (pageNum !== 1 && pageNum + 1 === p)}
                            onClick={() => {
                                if (p === 1) setPageNum(1);
                                else setPageNum(p % 2 === 0 ? p : p - 1);
                            }}
                        />
                    ))}
                </div>
            )}

        </div>
    );
};

const Thumbnail: React.FC<{
    pdfDoc: any;
    pNum: number;
    isActive: boolean;
    onClick: () => void;
}> = ({ pdfDoc, pNum, isActive, onClick }) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        if (!pdfDoc || !canvasRef.current) return;
        let active = true;
        pdfDoc.getPage(pNum).then((page: any) => {
            if (!active) return;
            // Use slightly higher scale for crispness, but constraint with CSS
            const viewport = page.getViewport({ scale: 0.2 });
            const canvas = canvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            canvas.width = viewport.width;
            canvas.height = viewport.height;
            page.render({ canvasContext: ctx, viewport }).promise.catch(() => { });
        });
        return () => { active = false; };
    }, [pdfDoc, pNum]);

    return (
        <div
            onClick={onClick}
            className={`flex-shrink-0 cursor-pointer transition-transform hover:scale-105 flex flex-col items-center gap-1 p-1 rounded ${isActive ? 'bg-indigo-100 dark:bg-indigo-900 ring-2 ring-indigo-500' : ''}`}
        >
            {/* Force height with inline style to be absolutely safe against CSS overrides/loading delays */}
            <canvas
                ref={canvasRef}
                className="bg-white shadow-sm border border-gray-200 object-contain"
                style={{ height: '80px', width: 'auto' }}
            />
            <span className="text-[9px] font-bold">{pNum}</span>
        </div>
    );
};

export default VisorPDF;
