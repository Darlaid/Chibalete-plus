import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, X, RefreshCw } from 'lucide-react';
import { dataService } from '../services/dataService';
import type { OralityAttempt } from '../types';

interface OralityModalProps {
    expectedText: string;
    onClose: () => void;
    // Phase 8: optional context for persisting attempts
    userId?: string;
    contentId?: string;
    onResult?: (attempt: OralityAttempt) => void;
}

// Distance algorithm simple
function levenshteinDistance(a: string, b: string): number {
    const matrix = [];
    for (let i = 0; i <= b.length; i++) { matrix[i] = [i]; }
    for (let j = 0; j <= a.length; j++) { matrix[0][j] = j; }
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    Math.min(matrix[i][j - 1] + 1, matrix[i - 1][j] + 1)
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

function calculateScore(expected: string, actual: string): number {
    const a = expected.toLowerCase().replace(/[^\w\s]/gi, '').trim();
    const b = actual.toLowerCase().replace(/[^\w\s]/gi, '').trim();
    if (!a && !b) return 100;
    if (!a || !b) return 0;
    const dist = levenshteinDistance(a, b);
    const maxLen = Math.max(a.length, b.length);
    return Math.max(0, Math.round(((maxLen - dist) / maxLen) * 100));
}

export const OralityModal: React.FC<OralityModalProps> = ({ expectedText, onClose, userId, contentId, onResult }) => {
    const [recording, setRecording] = useState(false);
    const [transcript, setTranscript] = useState('');
    const [score, setScore] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    // Phase 8: duration tracking + history
    const [history, setHistory] = useState<OralityAttempt[]>([]);
    const recordingStartMs = useRef<number>(0);

    const streamRef = useRef<MediaStream | null>(null);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const recognitionRef = useRef<any>(null);
    const chunksRef = useRef<Blob[]>([]);

    // A4: Guard against state updates on an unmounted component.
    // This can happen if the modal is closed while recognition is still processing audio.
    const isMountedRef = useRef(true);
    // T4: Store the 500ms finalizeScore timeout so it can be cancelled on unmount.
    const finalizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    useEffect(() => {
        return () => {
            isMountedRef.current = false;
            if (finalizeTimeoutRef.current) clearTimeout(finalizeTimeoutRef.current);
        };
    }, []);

    // Load history for this user+content on mount
    useEffect(() => {
        if (userId && contentId) {
            setHistory(dataService.getOralityHistory(userId, contentId));
        }
    }, [userId, contentId]);

    useEffect(() => {
        // Init Speech Recognition if available
        const SpeechRecognition = window.SpeechRecognition || (window as any).webkitSpeechRecognition;
        if (!SpeechRecognition) {
            setError('Tu navegador no soporta reconocimiento de voz.');
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.lang = 'es-ES';
        recognition.continuous = true;
        recognition.interimResults = true;

        recognition.onresult = (event: any) => {
            if (!isMountedRef.current) return; // A4: skip if already unmounted
            let currentTranscript = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                currentTranscript += event.results[i][0].transcript;
            }
            setTranscript(currentTranscript);
        };

        recognition.onerror = (event: any) => {
            console.error('Speech recognition error', event.error);
            if (!isMountedRef.current) return; // A4: skip if already unmounted
            if (event.error !== 'aborted') {
                // 'network' error is common in Chrome Android without internet
                const msg = event.error === 'network'
                    ? 'El reconocimiento de voz requiere conexión a internet en este navegador.'
                    : `Error de reconocimiento: ${event.error}`;
                setError(msg);
            }
        };

        recognitionRef.current = recognition;

        return () => {
            // A4: Ensure media resources are released when component unmounts
            cleanupMedia();
        };
    }, []);

    const cleanupMedia = () => {
        if (recognitionRef.current) {
            try { recognitionRef.current.stop(); } catch (e) { }
        }
        if (recorderRef.current && recorderRef.current.state !== 'inactive') {
            recorderRef.current.stop();
        }
        if (streamRef.current) {
            streamRef.current.getTracks().forEach(track => track.stop());
            streamRef.current = null;
        }
    };

    const startRecording = async () => {
        if (!isMountedRef.current) return;
        setError(null);
        setTranscript('');
        setScore(null);
        recordingStartMs.current = Date.now();

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            if (!isMountedRef.current) {
                // Component unmounted while waiting for mic permission — release stream immediately
                stream.getTracks().forEach(t => t.stop());
                return;
            }
            streamRef.current = stream;

            // A4: Correct try/catch for MediaRecorder constructor.
            // The old `.catch` check was wrong — MediaRecorder throws synchronously, not a Promise.
            let recorder: MediaRecorder;
            try {
                recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
            } catch {
                recorder = new MediaRecorder(stream); // fallback: browser picks mimeType
            }
            recorderRef.current = recorder;
            chunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) chunksRef.current.push(e.data);
            };

            // Audio blob is captured for potential future upload — not sent anywhere yet (Beta)
            recorder.onstop = () => {
                // const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
            };

            recorder.start();
            if (recognitionRef.current) {
                try {
                    recognitionRef.current.start();
                } catch (e) {
                    console.warn('[OralityModal] Recognition start error (may already be running):', e);
                }
            }

            if (isMountedRef.current) setRecording(true);
        } catch (err: any) {
            console.error('[OralityModal] getUserMedia error:', err);
            if (isMountedRef.current) {
                setError(err.name === 'NotAllowedError'
                    ? 'Permiso de micrófono denegado. Habilítalo en la configuración del navegador.'
                    : 'No se pudo acceder al micrófono.');
            }
        }
    };

    const stopRecording = () => {
        if (isMountedRef.current) setRecording(false);
        cleanupMedia();

        const durationMs = Date.now() - recordingStartMs.current;

        const finalizeScore = (resolvedTranscript: string) => {
            if (!isMountedRef.current) return; // A4: skip if unmounted during async wait
            const s = calculateScore(expectedText, resolvedTranscript);
            setScore(s);

            // Phase 8: persist attempt if context provided
            if (userId && contentId) {
                const attempt: OralityAttempt = {
                    id: `oral-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                    userId,
                    contentId,
                    createdAt: new Date().toISOString(),
                    score: s,
                    status: 'completed',
                    metrics: {
                        wordsRead: resolvedTranscript.trim().split(/\s+/).filter(Boolean).length,
                        durationMs,
                    },
                };
                dataService.saveOralityAttempt(attempt);
                if (isMountedRef.current) {
                    setHistory(dataService.getOralityHistory(userId, contentId));
                }
                onResult?.(attempt);
            }
        };

        if (transcript) {
            finalizeScore(transcript);
        } else if (!error) {
            // T4: Store timeout ref so it can be cancelled if the modal is closed
            // before the 500ms grace period elapses (isMountedRef guard inside finalizeScore
            // still protects state updates, but cancelling avoids the call entirely).
            finalizeTimeoutRef.current = setTimeout(() => {
                finalizeScore(transcript);
            }, 500);
        }
    };

    const handleClose = () => {
        cleanupMedia();
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in zoom-in-95">
            <div className="bg-white dark:bg-gray-900 w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700">
                <div className="bg-indigo-600 p-4 flex justify-between items-center text-white">
                    <div>
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Mic size={24} /> Laboratorio de oralidad
                            {/* A4: Beta badge — honest about the experimental status */}
                            <span className="bg-amber-400 text-amber-900 text-[10px] font-black px-2 py-0.5 rounded-full leading-tight">
                                BETA
                            </span>
                        </h2>
                        {/* A4: Connectivity notice — SpeechRecognition requires internet in Chrome Android */}
                        <p className="text-indigo-200 text-xs mt-0.5">
                            Función experimental · Requiere micrófono e internet
                        </p>
                    </div>
                    <button onClick={handleClose} className="p-1 hover:bg-white/20 rounded-full transition-colors" aria-label="Cerrar">
                        <X size={24} />
                    </button>
                </div>
                
                <div className="p-6">
                    {error && (
                        <div className="mb-4 p-3 bg-red-100 text-red-800 rounded-lg text-sm font-semibold border border-red-200">
                            {error}
                        </div>
                    )}

                    <div className="mb-6">
                        <p className="text-xs font-bold text-gray-500 uppercase mb-2">Texto a leer:</p>
                        <p className="text-lg text-gray-800 dark:text-gray-200 font-serif p-4 bg-gray-50 dark:bg-gray-800 rounded-xl border border-gray-100 dark:border-gray-700">
                            "{expectedText}"
                        </p>
                    </div>

                    <div className="flex flex-col items-center justify-center py-4">
                        {!recording && score === null && (
                            <button 
                                onClick={startRecording}
                                className="flex flex-col items-center justify-center gap-2 text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300 transition-colors"
                            >
                                <div className="w-20 h-20 bg-indigo-100 dark:bg-indigo-900 rounded-full flex items-center justify-center hover:scale-105 transition-transform shadow-lg">
                                    <Mic size={40} />
                                </div>
                                <span className="font-bold">Grabar</span>
                            </button>
                        )}

                        {recording && (
                            <button 
                                onClick={stopRecording}
                                className="flex flex-col items-center justify-center gap-2 text-red-500 hover:text-red-600 transition-colors"
                            >
                                <div className="w-20 h-20 bg-red-100 dark:bg-red-900/30 rounded-full flex items-center justify-center animate-pulse shadow-lg border-2 border-red-500">
                                    <Square size={32} className="fill-current" />
                                </div>
                                <span className="font-bold">Detener</span>
                            </button>
                        )}
                    </div>

                    {(transcript || recording) && (
                        <div className="mb-6">
                            <p className="text-xs font-bold text-gray-500 uppercase mb-2">Tu voz:</p>
                            <p className="text-md text-gray-600 dark:text-gray-400 italic p-3 bg-indigo-50/50 dark:bg-gray-800/50 rounded-lg min-h-[3rem]">
                                {transcript || "Escuchando..."}
                            </p>
                        </div>
                    )}

                    {score !== null && (
                        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-700 text-center animate-in slide-in-from-bottom-4">
                            <div className="inline-flex items-center justify-center w-24 h-24 rounded-full border-4 shadow-sm mb-4 bg-white dark:bg-gray-800" 
                                style={{ 
                                    borderColor: score > 90 ? '#22c55e' : score >= 70 ? '#eab308' : '#ef4444' 
                                }}>
                                <span className={`text-3xl font-black ${score > 90 ? 'text-green-500' : score >= 70 ? 'text-yellow-500' : 'text-red-500'}`}>
                                    {score}%
                                </span>
                            </div>
                            
                            <h3 className="text-xl font-bold mb-1">
                                {score > 90 ? '¡Excelente!' : score >= 70 ? 'Bien hecho' : 'Intenta nuevamente'}
                            </h3>
                            <p className="text-gray-500 dark:text-gray-400 mb-4 text-sm">Nivel de coincidencia</p>

                            {/* Phase 8: History panel — last 3 attempts */}
                            {history.length > 0 && (
                                <div className="mb-4 text-left bg-gray-50 dark:bg-gray-800 rounded-xl p-3">
                                    <p className="text-xs font-bold text-gray-400 uppercase mb-2">Últimos intentos</p>
                                    <ul className="space-y-1">
                                        {history.slice(0, 3).map((a, i) => (
                                            <li key={a.id} className="flex justify-between items-center text-sm">
                                                <span className="text-gray-500 dark:text-gray-400">
                                                    {i === 0 ? 'Este' : new Date(a.createdAt).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                <span className={`font-bold px-2 py-0.5 rounded-full text-xs ${
                                                    a.score > 90 ? 'bg-green-100 text-green-700' :
                                                    a.score >= 70 ? 'bg-yellow-100 text-yellow-700' :
                                                    'bg-red-100 text-red-700'
                                                }`}>{a.score}%</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            
                            <div className="flex gap-3">
                                <button onClick={handleClose} className="flex-1 py-3 rounded-xl border border-gray-200 dark:border-gray-600 font-bold hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
                                    Cerrar
                                </button>
                                <button onClick={startRecording} className="flex-1 py-3 rounded-xl bg-indigo-600 text-white font-bold hover:bg-indigo-700 transition-colors flex items-center justify-center gap-2">
                                    <RefreshCw size={18} /> Reintentar
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
