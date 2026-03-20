import React, { useState, useRef, useEffect } from 'react';
import { X, Send, UserCircle2 } from 'lucide-react';
import { dataService } from '../services/dataService';
import { useAuth } from '../context/AuthContext';
import type { PedagogicalStage, LeoReaderProfile } from '../types';

interface LeoCompanionProps {
    contentId: string;
    currentIndex: number;
    exactSentence: string;
    onClose: () => void;
    // Optional: session memory + difficulty forwarded to the server for structured context
    sessionMemory?: {
        recentAnchors: number[];
        lastQuestionType: string | null;
        sessionReadingProgress: number;
        difficultyLevel: string;
        pedagogicalStage?: PedagogicalStage;
    };
    difficultyLevel?: string;
    // Phase 5.5: pedagogical layer
    pedagogicalStage?: PedagogicalStage;
    readerProfile?: Pick<LeoReaderProfile, 'preferredSupportType' | 'vocabularySupportCount' | 'oralityAttemptsCount' | 'averageOralityScore'>;
    // Phase 4: transitional context
    leoContext?: {
        isAssignedContext: boolean;
        mediatorKind?: 'teacher' | 'librarian' | 'coordinator' | 'parent';
        organizationName?: string;
    };
    onMemoryUpdate?: (updates: Partial<LeoCompanionProps['sessionMemory']>) => void;
    onNavigate?: (index: number) => void;
}

export const LeoCompanion: React.FC<LeoCompanionProps> = ({ contentId, currentIndex, exactSentence, onClose, sessionMemory, difficultyLevel, pedagogicalStage, readerProfile, leoContext, onMemoryUpdate, onNavigate }) => {
    const { user } = useAuth();
    const [mode, setMode] = useState<'menu' | 'vocab' | 'question' | 'loading' | 'result'>('menu');
    const [inputValue, setInputValue] = useState('');
    const [answer, setAnswer] = useState('');
    
    const abortControllerRef = useRef<AbortController | null>(null);

    const greetingMessage = React.useMemo(() => {
        if (!sessionMemory) return "¿En qué te puedo ayudar con esta parte del libro?";
        
        const hasProgress = sessionMemory.sessionReadingProgress > 5;
        const hasAnchors = sessionMemory.recentAnchors && sessionMemory.recentAnchors.length > 0;
        const lastAnchor = hasAnchors ? sessionMemory.recentAnchors[sessionMemory.recentAnchors.length - 1] : null;
        const lastQ = sessionMemory.lastQuestionType;

        if (lastAnchor !== null && lastAnchor !== currentIndex && onNavigate) {
            return "Te quedaste por aquí la última vez. ¿Quieres continuar desde ese punto o prefieres explorar algo nuevo?";
        }

        if (lastQ === 'vocab') return "¿Quieres que te explique alguna palabra nueva de esta parte?";
        if (lastQ === 'question') return "¿Quieres que revisemos juntos el sentido de esta parte del texto?";
        if (hasAnchors) return "Parece que ya habías analizado este texto antes. ¿En qué te puedo ayudar ahora?";
        if (hasProgress) return "¡Qué bueno verte continuar leyendo! ¿Tienes alguna duda sobre lo que llevas del texto?";
        
        return "¿En qué te puedo ayudar con esta parte del libro?";
    }, [sessionMemory]);

    const suggestedActions = React.useMemo(() => {
        if (!sessionMemory) return [];
        const actions = [];
        
        const hasProgress = sessionMemory.sessionReadingProgress > 5;
        const lastQ = sessionMemory.lastQuestionType;
        const hasAnchors = sessionMemory.recentAnchors && sessionMemory.recentAnchors.length > 0;
        const lastAnchor = hasAnchors ? sessionMemory.recentAnchors[sessionMemory.recentAnchors.length - 1] : null;

        if (lastAnchor !== null && lastAnchor !== currentIndex && onNavigate) {
            actions.push({ 
                reason: 'Te quedaste en otra parte',
                label: 'Continuar donde iba', 
                action: () => { onNavigate(lastAnchor); onClose(); } 
            });
        }

        if (lastQ === 'vocab') {
            actions.push({ 
                reason: 'Vimos palabras aquí',
                label: 'Explicar vocabulario', 
                action: () => askLeo('vocab', 'Explícame las palabras más difíciles o clave de este fragmento.') 
            });
        } else if (lastQ === 'question') {
            actions.push({ 
                reason: 'Antes hiciste una pregunta',
                label: 'Revisar sentido', 
                action: () => askLeo('question', 'Ayúdame a revisar el sentido y la idea principal de este texto.') 
            });
        } else if (hasAnchors) {
            actions.push({ 
                reason: 'Ya exploraste esta parte',
                label: 'Explicar de nuevo', 
                action: () => askLeo('question', 'Resume brevemente este fragmento para que pueda entenderlo mejor.') 
            });
        }

        if (hasProgress || hasAnchors || lastQ) {
            actions.push({ 
                reason: '¿Todo claro?',
                label: 'Seguir leyendo', 
                action: onClose 
            });
        }

        return actions.slice(0, 3); // Max 3 acciones para no saturar
    }, [sessionMemory, onClose]);

    useEffect(() => {
        return () => {
            if (abortControllerRef.current) abortControllerRef.current.abort();
        };
    }, []);

    async function askLeo(type: 'vocab' | 'question', payload: string) {
        if (!payload.trim()) return;
        setMode('loading');
        setAnswer('');
        
        try {
            // Update local memory preemptively so Leo context gets richer
            if (onMemoryUpdate && sessionMemory) {
                onMemoryUpdate({
                    lastQuestionType: type,
                    recentAnchors: [...(sessionMemory.recentAnchors || []), currentIndex]
                });
            }
            
            if (abortControllerRef.current) abortControllerRef.current.abort();
            abortControllerRef.current = new AbortController();

            const userId = user?.id;
            const res = await fetch('/api/leo/ask', {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    ...(userId ? { 'x-user-id': userId } : {})
                },
                body: JSON.stringify({
                    contentId, chunkIndex: currentIndex, interactionType: type, payload, exactSentence,
                    // Optional advanced context for structured Leo prompt assembly
                    ...(sessionMemory ? { sessionMemory } : {}),
                    ...(difficultyLevel ? { difficultyLevel } : {}),
                    // Phase 5.5: pedagogical layer context
                    ...(pedagogicalStage ? { pedagogicalStage } : {}),
                    ...(readerProfile ? { readerProfile } : {}),
                    // Phase 4: transitional context
                    ...(leoContext ? { leoContext } : {}),
                }),
                signal: abortControllerRef.current.signal
            });
            const data = await res.json();
            if (data && data.success) {
                setAnswer(data.answer);
                // Phase 5.5: accumulate inferential profile counter on question interactions
                if (type === 'question' && user?.id) {
                    dataService.updateLeoReaderProfile(user.id, { inferentialDelta: 1 });
                }
            } else {
                setAnswer(data?.answer || data?.error || "Leo está un poco confundido. Intenta luego.");
            }
            setMode('result');
        } catch (e: any) {
            if (e.name !== 'AbortError') {
                setAnswer("Hubo un error de conexión, intenta de nuevo.");
                setMode('result');
            }
        }
    };

    const handleAction = () => {
        let textPayload = '';
        if (mode === 'vocab') textPayload = `¿Qué significa la palabra "${inputValue}" en este contexto?`;
        else if (mode === 'question') textPayload = inputValue;
        askLeo(mode, textPayload);
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in">
            <div className="bg-white dark:bg-gray-900 w-full max-w-sm rounded-[2rem] shadow-2xl overflow-hidden border border-gray-200 dark:border-gray-700 animate-in slide-in-from-bottom-8">
                {/* Header */}
                <div className="bg-indigo-600 p-4 flex justify-between items-center text-white">
                    <div className="flex items-center gap-2">
                        <img src="/leo_character.png" alt="Leo" className="w-10 h-10 object-contain drop-shadow-sm bg-indigo-500 rounded-full" onError={(e) => { e.currentTarget.style.display='none'; }} />
                        <h2 className="text-lg font-bold">Leo</h2>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full transition-colors">
                        <X size={24} />
                    </button>
                </div>
                
                {/* Body */}
                <div className="p-6 relative min-h-[250px] flex flex-col justify-center">
                    {mode === 'menu' && (
                        <div className="space-y-4 w-full">
                            <p className="text-gray-600 dark:text-gray-300 text-center mb-6 font-medium leading-relaxed px-2">
                                {greetingMessage}
                            </p>
                            <button onClick={() => setMode('vocab')} className="w-full py-4 px-6 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:border-indigo-800 dark:hover:bg-indigo-800/50 rounded-2xl flex items-center justify-between text-indigo-700 dark:text-indigo-300 transition-all font-bold">
                                <span>💡 Explicar vocabulario</span>
                            </button>
                            <button onClick={() => setMode('question')} className="w-full py-4 px-6 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 dark:bg-indigo-900/30 dark:border-indigo-800 dark:hover:bg-indigo-800/50 rounded-2xl flex items-center justify-between text-indigo-700 dark:text-indigo-300 transition-all font-bold">
                                <span>🤔 Pregunta sobre el texto</span>
                            </button>
                            
                            {suggestedActions.length > 0 && (
                                <div className="pt-3 pb-1 flex flex-col gap-2 animate-in zoom-in-95 border-t border-gray-100 dark:border-gray-800 mt-2">
                                    <p className="text-[10px] uppercase font-bold text-gray-400 text-center tracking-wider mb-1">Para ti</p>
                                    {suggestedActions.map((act, i) => (
                                        <div key={i} className="flex items-center justify-between bg-gray-50 dark:bg-gray-800/40 px-3 py-2 rounded-xl">
                                            <span className="text-xs text-gray-500 font-medium mr-2 leading-tight">{act.reason}</span>
                                            <button 
                                                onClick={act.action}
                                                className="shrink-0 px-3 py-1.5 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-900/60 dark:hover:bg-indigo-800 text-indigo-700 dark:text-indigo-300 text-[11px] font-bold rounded-lg transition-colors shadow-sm"
                                            >
                                                {act.label}
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {(mode === 'vocab' || mode === 'question') && (
                        <div className="flex flex-col gap-4 animate-in slide-in-from-right-4">
                            <button onClick={() => { setMode('menu'); setInputValue(''); }} className="text-xs uppercase font-bold text-gray-400 hover:text-indigo-600 self-start mb-2">
                                ← Volver
                            </button>
                            <p className="font-bold text-gray-800 dark:text-gray-200">
                                {mode === 'vocab' ? '¿Qué palabra no entiendes?' : '¿Qué te gustaría saber del texto?'}
                            </p>
                            <div className="relative">
                                <input 
                                    type="text" 
                                    value={inputValue} 
                                    onChange={(e) => setInputValue(e.target.value)}
                                    placeholder={mode === 'vocab' ? 'Escribe una palabra...' : 'Escribe tu pregunta...'}
                                    className="w-full pl-4 pr-12 py-3 bg-gray-100 dark:bg-gray-800 border-transparent rounded-xl focus:ring-2 focus:ring-indigo-500 focus:bg-white dark:focus:bg-gray-700 transition-all"
                                    onKeyDown={(e) => e.key === 'Enter' && handleAction()}
                                    autoFocus
                                />
                                <button 
                                    onClick={handleAction} 
                                    disabled={!inputValue.trim()}
                                    className="absolute right-1 top-1 bottom-1 p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                                >
                                    <Send size={18} />
                                </button>
                            </div>
                        </div>
                    )}

                    {mode === 'loading' && (
                        <div className="flex flex-col items-center justify-center space-y-4 animate-in fade-in">
                            <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                            <p className="text-indigo-600 dark:text-indigo-400 font-bold animate-pulse">Leo está pensando...</p>
                        </div>
                    )}

                    {mode === 'result' && (
                        <div className="flex flex-col items-center animate-in zoom-in-95 w-full">
                            <div className="bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-100 dark:border-indigo-800 rounded-2xl p-6 relative w-full mb-6">
                                <UserCircle2 className="absolute -top-4 -left-2 text-indigo-500 bg-white dark:bg-gray-900 rounded-full" size={32} />
                                <p className="text-gray-800 dark:text-gray-200 leading-relaxed font-medium">
                                    {answer}
                                </p>
                            </div>
                            <button onClick={() => { setMode('menu'); setInputValue(''); }} className="w-full py-3 font-bold text-gray-500 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 rounded-xl transition-colors">
                                Gracias, Leo
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
