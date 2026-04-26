
import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { QuizQuestion, Content, ChatMessage, TriviaQuestion, AlbumRegion, VisualContext, LeoReaderProfile, PedagogicalStage } from "../types";
import { dataService } from "./dataService";
import { derivePedagogicalStage } from "../utils/leoStage";

// ── AI Model Registry ─────────────────────────────────────────────────────
// Single source of truth for all Gemini model IDs used in this service.
// Update HERE when Google releases new stable versions — not scattered inline.
//
//   GEMINI_FLASH        → gemini-2.0-flash   GA stable, general-purpose fast tasks
//   GEMINI_FLASH_LATEST → gemini-2.5-flash   GA newer, heavier prompts & multi-turn chat
//   GEMINI_TTS          → gemini-2.5-flash-preview-tts  Preview; no GA TTS alternative yet
//
// DO NOT use 'gemini-3-pro-preview' — not a public GA model; causes HTTP 404.
const GEMINI_FLASH        = 'gemini-2.0-flash';
const GEMINI_FLASH_LATEST = 'gemini-2.5-flash';
const GEMINI_TTS          = 'gemini-2.5-flash-preview-tts';

// ── Shared error logger ────────────────────────────────────────────────────
// Extracts the HTTP status from the SDK error object so DevTools show the
// real cause: 400/403 = bad/wrong key, 404 = model not found, 429 = quota.
const logAiError = (fnName: string, error: unknown): void => {
    const err = error as any;
    const status = err?.status ?? err?.httpStatus ?? err?.code ?? 'unknown';
    const msg    = err?.message ?? String(error);
    console.error(`[Gemini] ${fnName} failed — HTTP ${status}: ${msg}`);
};

// ── Client init ────────────────────────────────────────────────────────────
// Required env var: VITE_GEMINI_API_KEY (from Google AI Studio)
// IMPORTANT: this must be a Gemini/AI Studio key, NOT a Firebase API key.
//            Both start with "AIzaSy" but are different credentials.
//            Add VITE_GEMINI_API_KEY to .env.local — never commit real keys.
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

try {
  if (apiKey) {
    if (apiKey === import.meta.env.VITE_FIREBASE_API_KEY) {
      console.debug("[Gemini] VITE_GEMINI_API_KEY matches VITE_FIREBASE_API_KEY (silenced; backend mediates AI).");
    }
    ai = new GoogleGenAI({ apiKey });
  } else {
    console.debug("[Gemini] VITE_GEMINI_API_KEY not set; safe fallback (silenced; backend mediates AI).");
  }
} catch (e) {
  logAiError('init', e);
}

// --- PERSISTENT CACHE SYSTEM ---
// Wrappers for LocalStorage to act as a persistent L2 cache
const CACHE_PREFIX = 'gemini_cache_';

const getCached = (key: string): any => {
  try {
    // 1. Check In-Memory (L1) - Fast access
    if (requestCache.has(key)) return requestCache.get(key);

    // 2. Check LocalStorage (L2) - Persistence
    const stored = localStorage.getItem(CACHE_PREFIX + key);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Restore to L1 for faster future access
      requestCache.set(key, parsed);
      return parsed;
    }
  } catch (e) {
    console.warn("Cache retrieval failed", e);
  }
  return undefined;
};

const setCached = (key: string, value: any) => {
  try {
    // 1. Save to In-Memory
    if (requestCache.size > 50) {
      const firstKey = requestCache.keys().next().value;
      if (firstKey) requestCache.delete(firstKey);
    }
    requestCache.set(key, value);

    // 2. Save to LocalStorage
    // Only cache reasonable sizes
    if (typeof value === 'string' && value.length < 500000) {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
    } else if (typeof value === 'object') {
      localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
    }
  } catch (e: any) {
    if (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED') {
      console.warn("LocalStorage Full! Clearing old Gemini cache...");
      try {
        // Smart Clear: Remove only our keys
        Object.keys(localStorage).forEach(k => {
          if (k.startsWith(CACHE_PREFIX)) localStorage.removeItem(k);
        });
        // Retry once
        try {
          localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
        } catch (retryE) { console.error("Cache retry failed, storage critical."); }
      } catch (clearE) { console.error("Could not clear cache", clearE); }
    } else {
      console.warn("Cache write failed", e);
    }
  }
};

// L1 Memory Cache
const requestCache = new Map<string, any>();

/**
 * Generates an intelligent summary using Gemini 2.5 Flash for speed.
 */
export const generarResumenInteligente = async (textoPagina: string, modelName?: string): Promise<string> => {
  const cacheKey = `summary-${modelName}-${textoPagina.substring(0, 50)}`; // Use first 50 chars as content hash approximation
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (!ai) return "Resumen simulado: El texto habla sobre la importancia de la lectura. (Configura tu API Key para resúmenes reales).";

  try {
    const response = await ai.models.generateContent({
      model: modelName || GEMINI_FLASH_LATEST,
      contents: `Eres un asistente de lectura experto y amigable. Resume el siguiente texto de manera concisa, utilizando viñetas para destacar los puntos clave y facilitar la lectura rápida. Texto: ${textoPagina}`,
    });
    const result = response.text || "No se pudo generar el resumen.";
    setCached(cacheKey, result);
    return result;
  } catch (error) {
    logAiError('generarResumenInteligente', error);
    return "Hubo un error al conectar con el asistente inteligente.";
  }
};

/**
 * Adapts the difficulty level using Gemini 3 Pro with Thinking Config.
 */
export const adaptarNivelDificultad = async (textoPagina: string, nivelUsuario: string): Promise<string> => {
  const cacheKey = `adapt-${nivelUsuario}-${textoPagina.substring(0, 50)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (!ai) return textoPagina; // Return original if no AI

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_FLASH_LATEST,
      contents: `Reescribe el siguiente texto para un lector de nivel "${nivelUsuario}".
      - Si el nivel es "Novato", usa oraciones cortas y vocabulario muy sencillo.
      - Si es "Intermedio", mantén un tono narrativo fluido pero claro.
      - Explica términos complejos entre paréntesis si es necesario.
      Texto original: ${textoPagina}`,
    });
    const result = response.text || "No se pudo adaptar el texto.";
    setCached(cacheKey, result);
    return result;
  } catch (error) {
    logAiError('adaptarNivelDificultad', error);
    return "Hubo un error al adaptar el nivel de dificultad.";
  }
};

/**
 * Generates a micro-summary for re-engagement notifications via Chatbot.
 * Routes through /api/leo/recap (backend) — no direct Gemini call from client.
 */
export const generarMicroResumenRecordatorio = async (
    textoPagina: string,
    tituloLibro: string,
    userId?: string
): Promise<string> => {
    try {
        const res = await fetch('/api/leo/recap', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(userId ? { 'x-user-id': userId } : {}),
            },
            body: JSON.stringify({ textoPagina, tituloLibro }),
        });
        if (!res.ok) return '¡Hola! 🦀 Te extrañé. ¡Sigamos leyendo!';
        const data = await res.json();
        return data.answer || '¡Hola! 🦀 Hace días no te veía. ¿Listo para continuar donde lo dejamos?';
    } catch (error) {
        logAiError('generarMicroResumenRecordatorio', error);
        return '¡Hola! 🦀 Te extrañé. ¡Sigamos leyendo!';
    }
};

/**
 * Generates quiz questions using Gemini 3 Pro with Structured Output.
 */
export const generarPreguntasQuiz = async (textoPagina: string, modelName?: string): Promise<QuizQuestion[]> => {
  const cacheKey = `quiz-${modelName}-${textoPagina.substring(0, 50)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    if (!ai) return [];

    const response = await ai.models.generateContent({
      model: modelName || GEMINI_FLASH_LATEST,
      contents: `Basado en el siguiente texto, crea 3 preguntas de opción múltiple para comprobar la comprensión lectora.
      Texto: ${textoPagina}`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctAnswer: { type: Type.STRING },
            },
            required: ["question", "options", "correctAnswer"],
          },
        },
      },
    });

    const jsonText = response.text;
    if (jsonText) {
      const result = JSON.parse(jsonText) as QuizQuestion[];
      setCached(cacheKey, result);
      return result;
    }
    return [];
  } catch (error) {
    logAiError('generarPreguntasQuiz', error);
    return [];
  }
};

/**
 * Generates a random Trivia Question about the app's content.
 */
export const generarPreguntaTrivia = async (): Promise<TriviaQuestion | null> => {
  try {
    // Trivia is random, so we don't cache it to ensure variety
    const contenidos = dataService.getContenidos(['lector']).map(c => `Título: ${c.titulo}, Autor: ${c.autor}, Tipo: ${c.etiquetas.join(', ')}`).join('\n');
    if (dataService.getContenidos(['lector']).length === 0) return null;
    const randomContent = dataService.getContenidos(['lector'])[Math.floor(Math.random() * dataService.getContenidos(['lector']).length)];

    if (!ai) {
      return {
        question: "¿Cuál es el autor de " + randomContent.titulo + "?",
        options: [randomContent.autor, "Cervantes", "García Márquez", "J.K. Rowling"],
        correctAnswer: randomContent.autor,
        sourceTitle: randomContent.titulo
      };
    }

    const response = await ai.models.generateContent({
      model: GEMINI_FLASH_LATEST,
      contents: `Genera una pregunta de trivia desafiante pero educativa sobre el siguiente contenido de la biblioteca:
            Título: ${randomContent.titulo}
            Autor: ${randomContent.autor}
            Tipo: ${randomContent.tipo}
            Descripción: ${randomContent.descripcion_corta}
            ${randomContent.biografia_autor ? `Biografía Autor: ${randomContent.biografia_autor}` : ''}
            
            La pregunta puede ser sobre la trama (inferida), el autor, el género o el tema.
            Debe tener 4 opciones de respuesta.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            question: { type: Type.STRING },
            options: { type: Type.ARRAY, items: { type: Type.STRING } },
            correctAnswer: { type: Type.STRING },
            sourceTitle: { type: Type.STRING, description: "Titulo del libro o fuente de la pregunta" }
          },
          required: ["question", "options", "correctAnswer", "sourceTitle"]
        }
      }
    });

    const jsonText = response.text;
    if (jsonText) {
      return JSON.parse(jsonText) as TriviaQuestion;
    }
    return null;
  } catch (error) {
    logAiError('generarPreguntaTrivia', error);
    return null;
  }
}

/**
 * Generates TTS Audio from text using Gemini 2.5 Flash TTS
 */
export const generarAudioTTS = async (texto: string): Promise<string | undefined> => {
  const cacheKey = `tts-${texto.substring(0, 100)}`; // Cache audio based on first 100 chars
  // For audio, we check local storage carefully as strings can be huge
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    if (!ai) return undefined;

    const response = await ai.models.generateContent({
      model: GEMINI_TTS,
      contents: [{ parts: [{ text: texto }] }],
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: 'Kore' },
          },
        },
      },
    });

    const data = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (data) {
      // We save to cache, but `setCached` handles logic to only save to LS if size is reasonable
      // Base64 audio for a sentence is usually fine for LS
      setCached(cacheKey, data);
    }
    return data;
  } catch (error) {
    logAiError('generarAudioTTS', error);
    return undefined;
  }
}

/**
 * Analyzes Reading Fluency (Audio vs Text)
 */
export const analizarFluidezLectora = async (audioBase64: string, textoReferencia: string): Promise<{ score: number, feedback: string, emoji: string } | null> => {
  try {
    if (!ai) return { score: 5, feedback: "¡Excelente lectura! (Simulado - Sin AI)", emoji: "🎉" };

    // Flash is multimodal — handles audio + text in a single request
    const response = await ai.models.generateContent({
      model: GEMINI_FLASH_LATEST,
      contents: [
        {
          role: 'user',
          parts: [
            {
              inlineData: {
                mimeType: 'audio/wav', // Generic WAV container usually works best for browser blobs
                data: audioBase64
              }
            },
            {
              text: `Actúa como Leo 🦀, un entrenador de lectura amable y divertido para niños.
                            Escucha el audio del niño leyendo y compáralo con este texto esperado:
                            "${textoReferencia}"
                            
                            Evalúa:
                            1. Precisión (¿Leyó las palabras correctas?)
                            2. Entonación (¿Sonó robótico o expresivo?)
                            3. Fluidez (¿Hizo pausas correctas?)
                            
                            Genera una respuesta en formato JSON con:
                            - score: Un número del 1 al 5 (siendo 5 excelente).
                            - feedback: Un mensaje CORTO, MOTIVADOR y AMABLE en español, hablándole directamente al niño (tú). Menciona algo específico que hizo bien y un consejo suave para mejorar. Usa tono de cangrejo amigo.
                            - emoji: Un emoji que represente el desempeño (ej. 🌟, 🚀, 🔥).`
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            score: { type: Type.NUMBER },
            feedback: { type: Type.STRING },
            emoji: { type: Type.STRING }
          },
          required: ["score", "feedback", "emoji"]
        }
      }
    });

    const jsonText = response.text;
    if (jsonText) {
      return JSON.parse(jsonText);
    }
    return null;
  } catch (error) {
    logAiError('analizarFluidezLectora', error);
    return null;
  }
}

/**
 * Search content semantically using Gemini 3 Pro.
 */
export const buscarContenidoSemantico = async (query: string): Promise<{ id: string, reason: string }[]> => {
  const cacheKey = `semantic-search-${query.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    const catalogo = dataService.getContenidos(['lector']).map(c => `ID: ${c.id}, Título: ${c.titulo}, Autor: ${c.autor}, Desc: ${c.descripcion_corta}, Etiquetas: ${c.etiquetas.join(', ')}`).join('\n');

    if (!ai) {
      // Simple fallback search without AI
      return dataService.buscarContenido(query, ['lector']).map(c => ({
        id: c.id,
        reason: "Coincidencia de palabra clave (Sin AI)"
      }));
    }

    const response = await ai.models.generateContent({
      model: GEMINI_FLASH_LATEST,
      contents: `Analiza la siguiente consulta de búsqueda de un usuario: "${query}".
        
        Catálogo disponible:
        ${catalogo}

        Instrucciones:
        1. Encuentra los libros o contenidos que mejor coincidan semánticamente (temas, sentimientos, conceptos, citas aproximadas).
        2. Devuelve un JSON con una lista de coincidencias.
        3. Incluye una breve razón de por qué lo elegiste.
        `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              reason: { type: Type.STRING }
            },
            required: ["id", "reason"]
          }
        }
      }
    });

    const jsonText = response.text;
    const result = jsonText ? JSON.parse(jsonText) : [];
    setCached(cacheKey, result);
    return result;

  } catch (e) {
    logAiError('buscarContenidoSemantico', e);
    return [];
  }
};

/**
 * Generates a proactive, pedagogical intervention question (PISA/Saber style)
 */
export const generarPreguntaProactiva = async (textoContexto: string, tituloLibro: string): Promise<string> => {
  // No cache here, we want variety in interruptions
  try {
    const competencias = [
      "Comprensión Literal (Recuperación de información explícita)",
      "Comprensión Inferencial (Relacionar partes, deducir causas/efectos)",
      "Reflexión Crítica (Evaluar propósito, estructura, validez de argumentos)",
      "Escritura Creativa (Proponer finales alternativos, cartas a personajes)",
      "Reflexión Socioemocional (Conectar dilemas de personajes con la vida propia)",
      "Metacognición (Autoevaluación de la comprensión)"
    ];
    const objetivo = competencias[Math.floor(Math.random() * competencias.length)];

    if (!ai) return "¿Qué opinas de lo que acabas de leer?";

    const response = await ai.models.generateContent({
      model: GEMINI_FLASH_LATEST,
      contents: `Actúa como un entrenador de lectura experto en pruebas PISA y Saber.
            El estudiante está leyendo "${tituloLibro}".

            Texto actual: "${textoContexto.substring(0, 1000)}..."

            TU OBJETIVO: Generar UNA sola pregunta corta pero desafiante que evalúe la competencia: ${objetivo}.

            La pregunta debe invitar al estudiante a detenerse y pensar. No debe ser de Sí/No.
            Empieza la pregunta directamente.`,
    });

    return response.text || "¿Qué opinas de lo que acabas de leer?";
  } catch (error) {
    logAiError('generarPreguntaProactiva', error);
    return "¿Qué te parece la historia hasta ahora?";
  }
};

/**
 * Analyzes pedagogical progress for reports.
 */
export const analizarProgresoPedagogico = async (stats: any): Promise<string> => {
  const cacheKey = `report-${stats.userId}-${stats.lastAssessmentDate}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    if (!ai) return "El estudiante muestra progreso constante. Se recomienda continuar con lecturas de su interés. (Análisis AI no disponible).";

    const response = await ai.models.generateContent({
      model: GEMINI_FLASH_LATEST,
      contents: `Analiza las siguientes estadísticas detalladas de un estudiante y genera un reporte pedagógico breve y estratégico para el docente (máx 150 palabras).
            
            DATOS DEL ESTUDIANTE:
            - Velocidad Lectora: ${stats.readingSpeedWPM} palabras/minuto
            - Tiempo Promedio Sesión: ${stats.avgSessionDurationMinutes} min
            - Relecturas Totales: ${stats.rereadCount} (Alto índice indica dificultad o mucho interés; bajo índice puede ser fluidez o superficialidad)
            - Comprensión Literal: ${stats.comprension_literal}/100
            - Comprensión Inferencial: ${stats.comprension_inferencial}/100
            - Reflexión Crítica: ${stats.reflexion_critica}/100
            - Libros Completados: ${stats.booksCompleted}
            
            Instrucciones:
            1. Identifica el perfil lector (ej. "Lector ágil pero superficial", "Lector reflexivo", etc.).
            2. Relaciona la velocidad/relectura con su comprensión.
            3. Sugiere 1 estrategia concreta para el aula (ej. "Debates orales", "Fichas de rastreo").`,
    });
    const result = response.text || "Análisis no disponible.";
    setCached(cacheKey, result);
    return result;
  } catch (e) {
    logAiError('analizarProgresoPedagogico', e);
    return "Error generando análisis.";
  }
}

/**
 * Generates standardized THEMA tags for content categorization.
 * Returns null on error so callers can distinguish failure from empty results.
 */
export const sugerirEtiquetasThema = async (titulo: string, descripcion: string): Promise<string[] | null> => {
  const cacheKey = `thema-${titulo}-${descripcion.substring(0, 50)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  if (!ai) {
    console.debug("[Gemini] sugerirEtiquetasThema: AI client not initialized (silenced).");
    return null;
  }

  try {
    const response = await ai.models.generateContent({
      model: GEMINI_FLASH,
      contents: `Analiza el siguiente libro/contenido y sugiere exactamente 4 etiquetas de clasificación estandarizada (estilo THEMA o BISAC pero simplificado para escuela).

            Título: ${titulo}
            Descripción: ${descripcion}

            Las etiquetas deben cubrir:
            1. Tema Principal (ej. "Aventura", "Ciencia")
            2. Género/Formato (ej. "Novela Gráfica", "Documental")
            3. Público/Edad (ej. "Infantil", "Juvenil")
            4. Un valor o tema transversal (ej. "Amistad", "Ecología")

            Devuelve SOLO las 4 palabras o frases cortas separadas por comas.`,
    });

    const text = response.text || "";
    const tags = text.split(',').map(t => t.trim()).filter(Boolean).slice(0, 4);

    if (tags.length > 0) {
      setCached(cacheKey, tags);
      return tags;
    }
    return null;
  } catch (error) {
    logAiError('sugerirEtiquetasThema', error);
    return null;
  }
};

// --- LEO CHAT TYPES ---

/**
 * Minimal session memory consumed by chatConBibliotecario.
 * Only fields that are actively used for context adaptation.
 */
export interface LeoSessionMemory {
    sessionReadingProgress: number;        // 0–100; used to derive pedagogical stage
    pedagogicalStage?: PedagogicalStage;  // pre-computed if available; overrides derivation
    lastQuestionType?: 'vocab' | 'inferential' | 'reflection' | null;
    // Visor-level operational fields (used by VisorTexto / VisorInmersivo)
    recentAnchors?: number[];             // sentence indices visited in session
    difficultyLevel?: string;             // 'inicial' | 'medio' | 'avanzado'
    // Persistent reading position fields (Phase Leo-M3)
    lastSentenceIndex?: number;           // last sentence/segment reached
    lastReadAt?: string;                  // ISO timestamp of last meaningful reading activity
    behavior?: { pauses: number; replays: number }; // user reading behavior counters
}


function buildAdaptiveSection(profile: LeoReaderProfile | undefined, stage: PedagogicalStage): string {
    const stageHints: Record<PedagogicalStage, string> = {
        comprehension:  'Prioriza comprensión literal (Obj.1) y vocabulario (Obj.6).',
        interpretation: 'Prioriza inferencia (Obj.2) y conexión entre textos (Obj.4).',
        reflection:     'Prioriza evaluación crítica (Obj.3) y conexión personal (Obj.5).',
        creation:       'Prioriza expresión creativa (Obj.7) e invita al estudiante a producir.',
    };
    const supportHints: Record<NonNullable<LeoReaderProfile['preferredSupportType']>, string> = {
        vocabulary:  'Este lector prefiere apoyo de vocabulario — explica palabras difíciles en contexto.',
        inferential: 'Este lector responde bien a preguntas de inferencia — formula preguntas implícitas.',
        reflection:  'Este lector reflexiona bien — invita a conectar el texto con experiencias propias.',
    };
    const lines = [`Etapa: ${stage}. ${stageHints[stage]}`];
    if (profile?.preferredSupportType) lines.push(supportHints[profile.preferredSupportType]);
    return `\n\n      ADAPTACIÓN PEDAGÓGICA:\n      ${lines.join('\n      ')}`;
}

/**
 * Chat with Leo (The Librarian).
 * Routes through /api/leo/chat (backend) — no direct Gemini call from client.
 * Signature is backward-compatible; userId added as optional last param for auth header.
 */
export const chatConBibliotecario = async (
  mensajeUsuario: string,
  historialChat: ChatMessage[],
  contextoLibroActual?: Content,
  contenidoPaginaActual?: string,
  visualContext?: VisualContext,
  readerProfile?: LeoReaderProfile,
  sessionMemory?: LeoSessionMemory,
  userId?: string
): Promise<string> => {
    try {
        const res = await fetch('/api/leo/chat', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                ...(userId ? { 'x-user-id': userId } : {}),
            },
            body: JSON.stringify({
                mensaje: mensajeUsuario,
                historial: historialChat,
                contentId: contextoLibroActual?.id,
                contenidoPagina: contenidoPaginaActual,
                visualContext,
                readerProfile,
                sessionMemory,
            }),
        });
        if (!res.ok) {
            return '¡Hola! Soy Leo 🦀. Mi conexión con la biblioteca central está fallando un poco. ¿Me repites eso?';
        }
        const data = await res.json();
        return data.answer || '¡Hola! Soy Leo 🦀. Estoy releyendo un clásico. ¿En qué puedo ayudarte con tu lectura?';
    } catch (error) {
        logAiError('chatConBibliotecario', error);
        return '¡Hola! Soy Leo 🦀. Mi conexión con la biblioteca central está fallando un poco. ¿Me repites eso?';
    }
};

// --- ALBUM ILLUSTRATION ANALYSIS (multimodal) ---

// Valid enum values used by sanitization — kept here so the sanitizer never
// depends on runtime imports from types.
const _REGION_TYPES     = ['focus', 'challenge'] as const;
const _PEDAGOGICAL_OBJS = ['literal', 'inferential', 'reflective', 'writing'] as const;

/**
 * Sanitizes a raw region object returned by the model before it enters editor state.
 *
 * Rules:
 *   text           — required, trimmed, capped at 200 chars; region rejected if empty
 *   x, y           — clamped to [0, 90] (leaves room for minimum box size)
 *   width, height  — clamped to [10, 60]; additionally capped so x+w ≤ 100, y+h ≤ 100
 *   type           — must be 'focus' | 'challenge'; defaults to 'focus'
 *   pedagogicalObjective — must be a valid enum value; omitted otherwise
 *   leoHint        — optional, trimmed, capped at 200 chars
 *
 * Returns null when the region is unsalvageable (no text, non-finite coords).
 */
function _sanitizeRegion(raw: unknown): Omit<AlbumRegion, 'id'> | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;

    const text = typeof r.text === 'string' ? r.text.trim().substring(0, 200) : '';
    if (!text) return null;

    const rx = Number(r.x ?? 0);
    const ry = Number(r.y ?? 0);
    const rw = Number(r.width  ?? 10);
    const rh = Number(r.height ?? 10);
    if (!isFinite(rx) || !isFinite(ry) || !isFinite(rw) || !isFinite(rh)) return null;

    const x      = Math.max(0, Math.min(90, rx));
    const y      = Math.max(0, Math.min(90, ry));
    const width  = Math.max(10, Math.min(60, rw,  100 - x));
    const height = Math.max(10, Math.min(60, rh,  100 - y));

    const type: AlbumRegion['type'] =
        _REGION_TYPES.includes(r.type as any) ? (r.type as 'focus' | 'challenge') : 'focus';

    const region: Omit<AlbumRegion, 'id'> = { text, x, y, width, height, type };

    if (_PEDAGOGICAL_OBJS.includes(r.pedagogicalObjective as any)) {
        region.pedagogicalObjective = r.pedagogicalObjective as AlbumRegion['pedagogicalObjective'];
    }
    const hint = typeof r.leoHint === 'string' ? r.leoHint.trim().substring(0, 200) : '';
    if (hint) region.leoHint = hint;

    return region;
}

/**
 * Sends an album illustration to Gemini and returns 3–6 suggested narrative
 * regions for reading mediation.
 *
 * @param imageFile  The raw File uploaded by the editor (from AlbumPageDraft.file).
 *                   Must be an image MIME type.
 * @returns          Array of sanitized AlbumRegion objects without id fields.
 *                   Caller is responsible for assigning stable ids before storing.
 * @throws           Error with a user-facing message if the model call fails or
 *                   the response cannot be parsed. Caller should catch and show
 *                   the message in the editor UI.
 */
export const analizarIlustracionAlbum = async (imageFile: File): Promise<Omit<AlbumRegion, 'id'>[]> => {
    if (!ai) {
        throw new Error('No hay clave de API configurada. Agrega VITE_GEMINI_API_KEY en .env.local.');
    }

    // Convert File → base64 string (strip the data:mime;base64, prefix)
    const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            const comma  = result.indexOf(',');
            resolve(comma >= 0 ? result.slice(comma + 1) : result);
        };
        reader.onerror = () => reject(new Error('No se pudo leer el archivo de imagen.'));
        reader.readAsDataURL(imageFile);
    });

    const mimeType = imageFile.type || 'image/jpeg';

    const prompt = `Eres un asistente pedagógico que analiza ilustraciones de libros álbum infantiles para una plataforma de lectura mediada.

TAREA: Identifica entre 3 y 6 regiones visualmente distintas y narrativamente significativas en esta imagen. Estas regiones se usarán para guiar la comprensión lectora y la literacidad visual con niños.

REGLAS DE SALIDA:
- Devuelve ÚNICAMENTE JSON válido. Sin markdown, sin explicaciones.
- Entre 3 y 6 regiones en total. Nunca más de 6.
- Cada región debe corresponder a un elemento claramente visible en la imagen.
- NO inventes ni describas elementos que no estén presentes visualmente.

COORDENADAS:
- x e y son el extremo superior izquierdo de la caja, en porcentaje del área de imagen (0–100).
- width y height son el tamaño de la caja en porcentaje.
- Tamaño mínimo: 10×10. Tamaño máximo: 60×60.
- Las cajas no deben solaparse significativamente.
- Evita cajas que cubran toda la imagen o que sean demasiado genéricas.

PRIORIDAD DE SELECCIÓN (en orden):
1. Personaje(s) principal(es): cara, expresión, postura corporal.
2. Acción central o conflicto visible en la escena.
3. Objetos con carga emocional o simbólica significativa.
4. Elementos del fondo que aporten contexto narrativo o emocional.

CAMPOS:
- text: Descripción narrativa breve en español para lectores infantiles. Máximo 2 oraciones.
- type: Usa "focus" para regiones narrativas estándar. Usa "challenge" SOLO si el elemento es visualmente ambiguo, está parcialmente oculto o es un momento de descubrimiento intencional.
- pedagogicalObjective: Elige el más adecuado:
    "literal"     — algo directamente visible y nombrable
    "inferential" — algo que requiere inferir más allá de lo visible
    "reflective"  — algo que invita a evaluar o conectar con experiencias propias
    "writing"     — algo que puede inspirar producción escrita
- leoHint: Una oración interna en español para el asistente de IA (nunca se muestra al estudiante). Opcional.`;

    let rawJson: unknown;
    try {
        const response = await ai.models.generateContent({
            model: GEMINI_FLASH_LATEST,
            contents: [
                {
                    role: 'user',
                    parts: [
                        { inlineData: { mimeType, data: base64 } },
                        { text: prompt },
                    ],
                },
            ],
            config: {
                responseMimeType: 'application/json',
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        regions: {
                            type: Type.ARRAY,
                            items: {
                                type: Type.OBJECT,
                                properties: {
                                    text:                 { type: Type.STRING },
                                    x:                    { type: Type.NUMBER },
                                    y:                    { type: Type.NUMBER },
                                    width:                { type: Type.NUMBER },
                                    height:               { type: Type.NUMBER },
                                    type:                 { type: Type.STRING },
                                    pedagogicalObjective: { type: Type.STRING },
                                    leoHint:              { type: Type.STRING },
                                },
                                required: ['text', 'x', 'y', 'width', 'height', 'type'],
                            },
                        },
                    },
                    required: ['regions'],
                },
            },
        });
        rawJson = JSON.parse(response.text ?? '{}');
    } catch (error) {
        logAiError('analizarIlustracionAlbum', error);
        throw new Error('El modelo no pudo analizar la imagen. Verifica la clave API o intenta con otra imagen.');
    }

    const rawRegions = Array.isArray((rawJson as any)?.regions) ? (rawJson as any).regions : [];

    // Sanitize each region; reject unsalvageable ones; cap at 6
    const sanitized = (rawRegions as unknown[])
        .slice(0, 6)
        .map(_sanitizeRegion)
        .filter((r): r is Omit<AlbumRegion, 'id'> => r !== null);

    if (sanitized.length === 0) {
        throw new Error('El modelo no devolvió regiones válidas. Intenta con otra imagen o ajusta la ilustración.');
    }

    return sanitized;
}
