
import React, { useState, useEffect, useRef } from 'react';
import { Send, Minimize2, Loader2, Volume2, Mic, StopCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { Content, ChatMessage, VisualContext, LeoReaderProfile } from '../types';
import { chatConBibliotecario, generarMicroResumenRecordatorio } from '../services/geminiService';
import type { LeoSessionMemory } from '../services/geminiService';
import { useLocation } from 'react-router-dom';
import { dataService } from '../services/dataService';

// --- ACTION TOKEN TYPES ---
type InteractionType = 'vocab' | 'inferential' | 'reflection';

interface ParsedActions {
    cleanText: string;
    points: number | null;
    savedVocab: string | null;
    interactionType: InteractionType | null;
}

/** Parses all Leo action tokens from a response, returning clean text and structured data. */
const parseActions = (text: string): ParsedActions => {
    let cleanText = text;
    let points: number | null = null;
    let savedVocab: string | null = null;
    let interactionType: InteractionType | null = null;

    const pointsMatch = cleanText.match(/\[AWARD_POINTS:\s*(\d+)\]/);
    if (pointsMatch) {
        const n = parseInt(pointsMatch[1], 10);
        if (!isNaN(n) && n > 0) points = n;
        cleanText = cleanText.replace(pointsMatch[0], '').trim();
    }

    const vocabMatch = cleanText.match(/\[SAVE_VOCAB:\s*([^\]]+)\]/);
    if (vocabMatch) {
        savedVocab = vocabMatch[1].trim();
        cleanText = cleanText.replace(vocabMatch[0], '').trim();
    }

    const typeMatch = cleanText.match(/\[INTERACTION_TYPE:\s*(vocab|inferential|reflection)\]/);
    if (typeMatch) {
        interactionType = typeMatch[1] as InteractionType;
        cleanText = cleanText.replace(typeMatch[0], '').trim();
    }

    return { cleanText, points, savedVocab, interactionType };
};

/**
 * Classifies a user message into a pedagogical interaction type.
 * Rules are explicit and auditable — no ML, no heuristics.
 * Returns null if no pattern matches.
 * Priority on overlap: vocab > inferential > reflection.
 *
 * Regex note: accented chars (é, ó, í) are not \w in JS without the u flag,
 * so trailing \b is omitted on patterns ending with accented vowels.
 */
const classifyUserMessage = (text: string): InteractionType | null => {
    const t = text.toLowerCase();

    // VOCAB: explicit request for word/concept meaning
    if (/qu[eé] significa|qu[eé] quiere decir|el significado de|\bdefine\b/.test(t)) {
        return 'vocab';
    }

    // INFERENTIAL: why/how/speculation questions about the text
    if (/\bpor qu[eé]|qu[eé] crees|qu[eé] piensas|c[oó]mo crees|qu[eé] pasar[ií]a|qu[eé] habr[ií]a pasado/.test(t)) {
        return 'inferential';
    }

    // REFLECTION: personal opinion, connection, or identification
    if (/\bpienso que|\bcreo que|\bme parece|\ben mi opini[oó]n|\bme recuerda|\bme identifico|\bsi yo fuera/.test(t)) {
        return 'reflection';
    }

    return null;
};

/**
 * Merges frontend classification (primary) with Leo's token signal (complementary).
 * - Both present and match  → count once, return frontendType.
 * - Both present and differ → frontend wins; discrepancy logged to console.
 * - Only one present        → use whichever is available.
 * - Neither present         → null, no profile update.
 */
const mergeInteractionTypes = (
    frontendType: InteractionType | null,
    leoType: InteractionType | null
): InteractionType | null => {
    if (frontendType && leoType && frontendType !== leoType) {
        console.debug(`[Leo] Señal discrepante — usuario: "${frontendType}" / Leo: "${leoType}". Prevalece clasificación del usuario.`);
    }
    return frontendType ?? leoType;
};

interface ChatbotProps {
  onVisibilityChange?: (isOpen: boolean) => void;
  visualContext?: VisualContext; // New prop for Album Mode
  initialMessage?: string | null; // New prop for proactive interventions
  /**
   * When true, Leo's button applies a single gentle pulse animation.
   * Driven by useLeoMediator.shouldPulse — a soft invite after dwell.
   * Only meaningful when isHidden is false.
   */
  isPulsing?: boolean;
  /**
   * When true, the entire chatbot UI is visually hidden (CSS visibility: hidden)
   * but not unmounted — chat history and state are preserved.
   * Driven by useLeoMediator.isVisible.
   */
  isHidden?: boolean;
  /**
   * Incrementing counter — each new value opens the chat.
   * Use case: tapping the Leo mediator hint bubble should open the chat.
   * Callers increment this value; the component reacts to the change.
   * Starting value 0 = no open requested at mount.
   */
  openTrigger?: number;
  /**
   * When true, a recap message is being fetched asynchronously.
   * Shows a "Leo está recordando..." state if the chat is opened before
   * the recap arrives, so the user knows something is coming.
   */
  isRecapLoading?: boolean;
  /**
   * Region action trigger — when a region with action.type='leo' fires.
   * Each unique id causes Leo to inject message as a proactive prompt and
   * open the chat. Use a nonce (Date.now()) so repeated actions all fire.
   * VisorAlbum sets this; Chatbot consumes it once per unique id.
   */
  leoActionNonce?: { message: string; id: number } | null;
}

const Chatbot: React.FC<ChatbotProps> = ({ onVisibilityChange, visualContext, initialMessage, isPulsing = false, isHidden = false, openTrigger = 0, isRecapLoading = false, leoActionNonce }) => {
  const { user } = useAuth();
  const location = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false); // STT State
  const [speakingMsgId, setSpeakingMsgId] = useState<string | null>(null); // TTS State

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initializedRef = useRef(false);
  const recognitionRef = useRef<any>(null); // For SpeechRecognition
  const leoProfileRef = useRef<LeoReaderProfile | undefined>(undefined);
  const leoMemoryRef = useRef<LeoSessionMemory | null>(null);
  const sessionStorageKeyRef = useRef<string | null>(null);
  const proactiveTriggeredRef = useRef<Set<string>>(new Set()); // keyed by contentId

  // Determine context based on URL
  const [currentContextContent, setCurrentContextContent] = useState<Content | undefined>(undefined);

  useEffect(() => {
    if (location.pathname.startsWith('/contenido/')) {
      const contentId = location.pathname.split('/')[2];
      const content = dataService.getContenidoById(contentId);
      setCurrentContextContent(content);
    } else {
      setCurrentContextContent(undefined);
    }
  }, [location.pathname]);

  // Load reader profile, restore session history, load Leo memory, trigger proactive if applicable
  useEffect(() => {
    if (!user) return;

    // 1. Load cumulative reader profile (sync, localStorage)
    leoProfileRef.current = dataService.getLeoReaderProfile(user.id);

    // 2. Determine content ID and session storage key
    const contentId = location.pathname.startsWith('/contenido/')
      ? location.pathname.split('/')[2]
      : null;
    const storageKey = `leo-chat-${user.id}-${contentId ?? 'global'}`;
    sessionStorageKeyRef.current = storageKey;

    // 3. Restore chat history from sessionStorage (sync)
    // Always call setMessages to clear stale messages when switching content.
    let restored: ChatMessage[] = [];
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const parsed: ChatMessage[] = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) restored = parsed;
      }
    } catch (_) { /* sessionStorage unavailable — continue without history */ }
    setMessages(restored);

    if (!contentId) return;

    // 4. Load Leo memory and trigger proactive re-engagement once per session
    dataService.getLeoMemory(user.id, contentId).then(memory => {
      leoMemoryRef.current = memory
        ? { sessionReadingProgress: memory.sessionReadingProgress ?? 0, pedagogicalStage: memory.pedagogicalStage, lastQuestionType: memory.lastQuestionType }
        : null;

      const progress = memory?.sessionReadingProgress ?? 0;
      const hasHistory = restored.length > 0;

      if (progress > 0 && !initialMessage && !proactiveTriggeredRef.current.has(contentId) && !hasHistory) {
        proactiveTriggeredRef.current.add(contentId);
        const contentItem = dataService.getContenidoById(contentId);
        const bookTitle = contentItem?.titulo ?? 'este libro';
        // Try to get the actual sentence where the reader stopped.
        // Falls back to descripcion_corta if no TTS manifest or sentenceIndex === 0.
        dataService.getLastPassageText(user.id, contentId)
          .then(passageText => passageText ?? contentItem?.descripcion_corta ?? '')
          .catch(() => contentItem?.descripcion_corta ?? '')
          .then(pageText => generarMicroResumenRecordatorio(pageText, bookTitle, user.id))
          .then(proactiveMsg => {
          setMessages(prev => {
            if (prev.length > 0) return prev; // Guard: don't overwrite if already populated
            return [{ id: `proactive-${Date.now()}`, role: 'model', text: proactiveMsg, timestamp: Date.now() }];
          });
          setIsOpen(true);
          if (onVisibilityChange) onVisibilityChange(true);
        }).catch(() => { /* Falla en silencio */ });
      }
    }).catch(() => {
      leoMemoryRef.current = null;
    });
  }, [user?.id, location.pathname]); // Re-runs when user or content changes

  // Persist chat history to sessionStorage after each message change
  // Skip when messages is empty — that's the cleared state after navigation, not a valid save.
  useEffect(() => {
    if (!sessionStorageKeyRef.current || messages.length === 0) return;
    try {
      sessionStorage.setItem(sessionStorageKeyRef.current, JSON.stringify(messages.slice(-30)));
    } catch (_) { /* sessionStorage full or unavailable */ }
  }, [messages]);

  // External open trigger — incremented by callers to open the chat imperatively.
  // Typical use: tapping the Leo mediator hint bubble.
  const prevOpenTriggerRef = useRef(0);
  useEffect(() => {
    if (openTrigger > prevOpenTriggerRef.current) {
      prevOpenTriggerRef.current = openTrigger;
      setIsOpen(true);
      if (onVisibilityChange) onVisibilityChange(true);
    }
  }, [openTrigger, onVisibilityChange]);

  // Leo region action trigger — fires when a region with action.type='leo' activates.
  // Each unique id injects leoActionNonce.message as a Leo message and opens the chat.
  // Uses a nonce id so repeated triggers on the same region all fire.
  const prevActionNonceIdRef = useRef<number>(-1);
  useEffect(() => {
    if (!leoActionNonce) return;
    if (leoActionNonce.id === prevActionNonceIdRef.current) return;
    prevActionNonceIdRef.current = leoActionNonce.id;
    const msg: ChatMessage = {
      id: `leo-action-${leoActionNonce.id}`,
      role: 'model',
      text: leoActionNonce.message,
      timestamp: Date.now(),
    };
    setMessages(prev => [...prev, msg]);
    setIsOpen(true);
    if (onVisibilityChange) onVisibilityChange(true);
  }, [leoActionNonce, onVisibilityChange]);

  // Handle Initial Message (Proactive Intervention)
  useEffect(() => {
    if (initialMessage && !initializedRef.current) {
      setIsOpen(true);
      if (onVisibilityChange) onVisibilityChange(true);

      const leoMsg: ChatMessage = {
        id: `init-${Date.now()}`,
        role: 'model',
        text: initialMessage,
        timestamp: Date.now()
      };
      setMessages(prev => [...prev, leoMsg]);
      initializedRef.current = true;
    }
  }, [initialMessage, onVisibilityChange]);

  const toggleChat = (open: boolean) => {
    setIsOpen(open);
    if (onVisibilityChange) {
      onVisibilityChange(open);
    }
  };

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // --- TTS LOGIC (Browser Native for Low Latency) ---
  const speakText = (text: string, msgId: string) => {
    if (speakingMsgId === msgId) {
      window.speechSynthesis.cancel();
      setSpeakingMsgId(null);
      return;
    }

    window.speechSynthesis.cancel(); // Stop any previous
    setSpeakingMsgId(msgId);

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'es-ES'; // Force Spanish
    utterance.onend = () => setSpeakingMsgId(null);
    utterance.onerror = () => setSpeakingMsgId(null);

    window.speechSynthesis.speak(utterance);
  }

  // --- STT LOGIC (Browser Native Speech Recognition) ---
  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
      setIsListening(false);
      return;
    }

    // Check browser support
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Tu navegador no soporta dictado por voz. Intenta usar Chrome.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = 'es-ES';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => setIsListening(true);

    recognition.onresult = (event: any) => {
      const transcript = event.results[0][0].transcript;
      setInput(prev => prev + (prev ? ' ' : '') + transcript);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech error", event.error);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
  }

  const handleSend = async () => {
    if (!input.trim() || !user) return;

    const userMsg: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      text: input,
      timestamp: Date.now(),
    };

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setIsLoading(true);

    try {
      // Classify before calling Leo — this is the primary signal for profile updates.
      const frontendType = classifyUserMessage(userMsg.text);

      const responseText = await chatConBibliotecario(
        userMsg.text,
        messages,
        currentContextContent,
        undefined,
        visualContext,
        leoProfileRef.current,
        leoMemoryRef.current ?? undefined,
        user.id
      );

      // leoType = complementary signal from Leo's [INTERACTION_TYPE:X] token
      const { cleanText, points, savedVocab, interactionType: leoType } = parseActions(responseText);
      const systemMessages: ChatMessage[] = [];

      // Handle AWARD_POINTS
      if (points !== null) {
        dataService.addPoints(user.id, points, 'Recompensa de Leo (Conversación)');
        systemMessages.push({
          id: `sys-points-${Date.now()}`,
          role: 'model',
          text: `✨ ¡Has ganado ${points} Puntos de Magia por tu excelente participación! ✨`,
          timestamp: Date.now(),
        });
      }

      // Handle SAVE_VOCAB
      if (savedVocab) {
        try {
          const vocabKey = `chibalete_vocab_${user.id}`;
          const existing: string[] = JSON.parse(localStorage.getItem(vocabKey) ?? '[]');
          if (!existing.includes(savedVocab)) {
            existing.push(savedVocab);
            localStorage.setItem(vocabKey, JSON.stringify(existing));
          }
        } catch (_) { /* localStorage unavailable */ }
        systemMessages.push({
          id: `sys-vocab-${Date.now()}`,
          role: 'model',
          text: `📖 Leo guardó la palabra "${savedVocab}" en tu glosario personal.`,
          timestamp: Date.now(),
        });
      }

      // Resolve interaction type: frontend is primary, Leo token is complementary.
      // mergeInteractionTypes handles: match (count once), differ (frontend wins + log), only one present.
      const resolvedType = mergeInteractionTypes(frontendType, leoType);

      if (resolvedType) {
        dataService.updateLeoReaderProfile(user.id, {
          vocabularyDelta:  resolvedType === 'vocab'       ? 1 : 0,
          inferentialDelta: resolvedType === 'inferential' ? 1 : 0,
          reflectionDelta:  resolvedType === 'reflection'  ? 1 : 0,
        });
        leoProfileRef.current = dataService.getLeoReaderProfile(user.id);

        // Update session memory — only send the delta we own.
        // Backend merges with existing, preserving recentAnchors, difficultyLevel, sessionReadingProgress.
        const contentId = location.pathname.startsWith('/contenido/')
          ? location.pathname.split('/')[2]
          : null;
        if (contentId) {
          if (leoMemoryRef.current) {
            leoMemoryRef.current = { ...leoMemoryRef.current, lastQuestionType: resolvedType };
          }
          dataService.updateLeoMemory(user.id, contentId, { lastQuestionType: resolvedType }).catch(() => {});
        }
      }

      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: cleanText,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, botMsg, ...systemMessages]);
    } catch (error) {
      console.error(error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!user) return null;

  return (
    <div
      className="fixed bottom-20 md:bottom-6 right-6 z-50 flex flex-col items-end"
      style={isHidden ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}
    >
      {isOpen ? (
        <div className="bg-white dark:bg-gray-900 w-80 md:w-96 h-[500px] rounded-2xl shadow-2xl flex flex-col overflow-hidden border border-gray-200 dark:border-gray-700 animate-in slide-in-from-bottom-5">
          {/* Header */}
          <div className="bg-indigo-600 p-4 flex justify-between items-center text-white">
            <div className="flex items-center space-x-3">
              <img src="/leo_character.png" alt="Leo" className="w-10 h-10 object-contain drop-shadow-sm" />
              <div>
                <h3 className="font-bold text-sm">Leo - Asistente</h3>
                {visualContext ? (
                  <p className="text-xs text-indigo-200 truncate w-40 flex items-center">
                    <span className="w-2 h-2 bg-green-400 rounded-full mr-1 animate-pulse"></span> Viendo Escena
                  </p>
                ) : currentContextContent && (
                  <p className="text-xs text-indigo-200 truncate w-40">
                    Contexto: {currentContextContent.titulo}
                  </p>
                )}
              </div>
            </div>
            <div className="flex items-center space-x-1">
              <button onClick={() => toggleChat(false)} className="hover:bg-indigo-700 p-1 rounded text-indigo-100" title="Minimizar">
                <Minimize2 size={18} />
              </button>
            </div>
          </div>

          {/* Messages Area */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-gray-50 dark:bg-gray-800/50">
            {messages.length === 0 && (
              <div className="text-center text-gray-500 text-sm mt-10">
                <img src="/leo_character.png" alt="Leo" className="w-24 h-24 object-contain mx-auto mb-2 drop-shadow-md" />
                {isRecapLoading ? (
                  // Recap is being fetched — user opened chat while it's still loading.
                  // Show a "thinking" state so the user knows something is coming.
                  <>
                    <p className="text-indigo-500 font-medium">Leo está recordando...</p>
                    <div className="flex justify-center gap-1 mt-3">
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:75ms]" />
                      <div className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce [animation-delay:150ms]" />
                    </div>
                  </>
                ) : (
                  <>
                    <p>¡Hola! Soy Leo.</p>
                    {visualContext ? (
                      <p className="mt-2">Estoy viendo la imagen contigo. ¡Pregúntame qué veo!</p>
                    ) : (
                      <p className="mt-2">Puedo recomendarte libros o hablar sobre lo que estás leyendo.</p>
                    )}
                  </>
                )}
              </div>
            )}
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}
              >
                <div
                  className={`max-w-[85%] p-3 rounded-2xl text-sm ${msg.role === 'user'
                    ? 'bg-indigo-600 text-white rounded-br-none'
                    : 'bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-bl-none shadow-sm border border-gray-200 dark:border-gray-600'
                    }`}
                >
                  {msg.text}
                </div>

                {/* TTS Button for Leo's messages */}
                {msg.role === 'model' && (
                  <button
                    onClick={() => speakText(msg.text, msg.id)}
                    className={`mt-1 ml-2 p-1 rounded-full text-xs flex items-center gap-1 transition-colors ${speakingMsgId === msg.id ? 'text-indigo-600 bg-indigo-100' : 'text-gray-400 hover:text-gray-600'}`}
                    title="Leer en voz alta"
                  >
                    <Volume2 size={14} className={speakingMsgId === msg.id ? "animate-pulse" : ""} />
                    {speakingMsgId === msg.id && <span>Leyendo...</span>}
                  </button>
                )}
              </div>
            ))}
            {isLoading && (
              <div className="flex justify-start">
                <div className="bg-white dark:bg-gray-700 p-3 rounded-2xl rounded-bl-none shadow-sm">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Input Area */}
          <div className="p-3 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700">
            <div className="relative flex items-center gap-2">
              <button
                onClick={toggleListening}
                className={`p-2 rounded-full transition-colors ${isListening ? 'bg-red-500 text-white animate-pulse' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
                title={isListening ? "Detener dictado" : "Dictar a Leo"}
              >
                {isListening ? <StopCircle size={20} /> : <Mic size={20} />}
              </button>

              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isListening ? "Escuchando..." : (visualContext ? "Pregunta sobre la imagen..." : "Pregunta sobre libros...")}
                className="flex-1 pl-4 pr-10 py-3 rounded-full border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-800 focus:ring-2 focus:ring-indigo-500 focus:outline-none text-sm"
                disabled={isLoading}
              />

              <button
                onClick={handleSend}
                disabled={isLoading || !input.trim()}
                className="absolute right-0 p-2 bg-indigo-600 text-white rounded-full hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      ) : (
        <button
          onClick={() => toggleChat(true)}
          className={`bg-indigo-600 hover:bg-indigo-700 text-white w-16 h-16 rounded-full shadow-xl transition-transform transform hover:scale-110 flex items-center justify-center border-2 border-white dark:border-gray-800 ${isPulsing ? 'animate-leo-invite' : ''}`}
          title="Abrir Chat con Leo"
        >
          <span className="text-3xl" role="img" aria-label="crab">
            <img src="/leo_character.png" alt="Leo" className="w-12 h-12 object-contain drop-shadow-md" />
          </span>
        </button>
      )}
    </div>
  );
};

export default Chatbot;
