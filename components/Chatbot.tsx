
import React, { useState, useEffect, useRef } from 'react';
import { Send, Minimize2, Loader2, Volume2, Mic, StopCircle } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import type { Content, ChatMessage, VisualContext } from '../types';
import { chatConBibliotecario } from '../services/geminiService';
import { useLocation } from 'react-router-dom';
import { dataService } from '../services/dataService';

interface ChatbotProps {
  onVisibilityChange?: (isOpen: boolean) => void;
  visualContext?: VisualContext; // New prop for Album Mode
  initialMessage?: string | null; // New prop for proactive interventions
}

const Chatbot: React.FC<ChatbotProps> = ({ onVisibilityChange, visualContext, initialMessage }) => {
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
      const responseText = await chatConBibliotecario(
        userMsg.text,
        messages,
        currentContextContent,
        undefined, // Text content page (optional)
        visualContext // Pass the visual context if available
      );

      let processedText = responseText;
      const pointsMatch = responseText.match(/\[AWARD_POINTS:\s*(\d+)\]/);

      if (pointsMatch) {
        const points = parseInt(pointsMatch[1], 10);
        if (!isNaN(points) && points > 0) {
          dataService.addPoints(user.id, points, 'Recompensa de Leo (Conversación)');
          processedText = responseText.replace(pointsMatch[0], '').trim();

          // Trigger a localized "Toast" inside the chat
          setMessages(prev => [...prev, {
            id: `sys-${Date.now()}`,
            role: 'model',
            text: `✨ ¡Has ganado ${points} Puntos de Magia por tu excelente participación! ✨`,
            timestamp: Date.now()
          }]);
        }
      }

      const botMsg: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: processedText,
        timestamp: Date.now(),
      };
      setMessages(prev => [...prev, botMsg]);
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
    <div className="fixed bottom-20 md:bottom-6 right-6 z-50 flex flex-col items-end">
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
                <p>¡Hola! Soy Leo.</p>
                {visualContext ? (
                  <p className="mt-2">Estoy viendo la imagen contigo. ¡Pregúntame qué veo!</p>
                ) : (
                  <p className="mt-2">Puedo recomendarte libros o hablar sobre lo que estás leyendo.</p>
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
          className="bg-indigo-600 hover:bg-indigo-700 text-white w-16 h-16 rounded-full shadow-xl transition-transform transform hover:scale-110 flex items-center justify-center border-2 border-white dark:border-gray-800"
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
