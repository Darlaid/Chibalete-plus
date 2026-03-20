
import { GoogleGenAI, Type, Modality } from "@google/genai";
import type { QuizQuestion, Content, ChatMessage, TriviaQuestion, AlbumRegion, VisualContext } from "../types";
import { dataService } from "./dataService";

// Initialize the Gemini API client safely
// Support both process.env (via Vite define) and import.meta.env
const apiKey = import.meta.env.VITE_GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

try {
  if (apiKey) {
    ai = new GoogleGenAI({ apiKey });
  } else {
    console.warn("Chibalete+: Gemini API Key missing. AI features will return mock data.");
  }
} catch (e) {
  console.error("Error initializing Gemini client:", e);
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
      model: modelName || 'gemini-2.5-flash',
      contents: `Eres un asistente de lectura experto y amigable. Resume el siguiente texto de manera concisa, utilizando viñetas para destacar los puntos clave y facilitar la lectura rápida. Texto: ${textoPagina}`,
    });
    const result = response.text || "No se pudo generar el resumen.";
    setCached(cacheKey, result);
    return result;
  } catch (error) {
    console.error("Error en generarResumenInteligente:", error);
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
      model: 'gemini-3-pro-preview',
      contents: `Reescribe el siguiente texto para un lector de nivel "${nivelUsuario}".
      - Si el nivel es "Novato", usa oraciones cortas y vocabulario muy sencillo.
      - Si es "Intermedio", mantén un tono narrativo fluido pero claro.
      - Explica términos complejos entre paréntesis si es necesario.
      Texto original: ${textoPagina}`,
      config: {
        thinkingConfig: { thinkingBudget: 2048 },
      },
    });
    const result = response.text || "No se pudo adaptar el texto.";
    setCached(cacheKey, result);
    return result;
  } catch (error) {
    console.error("Error en adaptarNivelDificultad:", error);
    return "Hubo un error al adaptar el nivel de dificultad.";
  }
};

/**
 * Generates a micro-summary for re-engagement notifications via Chatbot.
 */
export const generarMicroResumenRecordatorio = async (textoPagina: string, tituloLibro: string): Promise<string> => {
  // No caching for reminders as context might change slightly or we want fresh greeting
  try {
    if (!ai) return "¡Hola! 🦀 Te extrañé. ¡Sigamos leyendo!";

    const response = await ai.models.generateContent({
      model: 'gemini-3-pro-preview',
      contents: `Eres Leo 🦀, el asistente amigable de la biblioteca Chibalete.
        El usuario ha dejado de leer el libro "${tituloLibro}" hace unos días. 
        
        Tu misión: Darle una cálida bienvenida en el chat y recordarle brevemente dónde quedó.
        
        Texto donde quedó: "${textoPagina.substring(0, 500)}..."
        
        Genera un mensaje de chat corto (máx 3 oraciones) que empiece con "¡Hola! 🦀 Hace días no te veía..." y luego resuma en una línea qué estaba pasando, invitando a seguir.
        Sé entusiasta y motivador.`,
      config: {
        thinkingConfig: { thinkingBudget: 1024 },
      }
    });
    return response.text || "¡Hola! 🦀 Hace días no te veía. ¿Listo para continuar donde lo dejamos?";
  } catch (error) {
    console.error("Error en generarMicroResumenRecordatorio:", error);
    return "¡Hola! 🦀 Te extrañé. ¡Sigamos leyendo!";
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
      model: modelName || 'gemini-2.5-flash',
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
    console.error("Error en generarPreguntasQuiz:", error);
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
      model: 'gemini-2.5-flash',
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
    console.error("Error generando trivia:", error);
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
      model: 'gemini-2.5-flash-preview-tts',
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
    console.error("Error en generarAudioTTS:", error);
    return undefined;
  }
}

/**
 * Analyzes Reading Fluency (Audio vs Text)
 */
export const analizarFluidezLectora = async (audioBase64: string, textoReferencia: string): Promise<{ score: number, feedback: string, emoji: string } | null> => {
  try {
    if (!ai) return { score: 5, feedback: "¡Excelente lectura! (Simulado - Sin AI)", emoji: "🎉" };

    // Gemini 2.5 Flash is multimodal and fast, perfect for audio analysis
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
    console.error("Error analizando fluidez:", error);
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
      model: 'gemini-2.5-flash',
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
    console.error("Error semantic search", e);
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
      model: 'gemini-3-pro-preview',
      contents: `Actúa como un entrenador de lectura experto en pruebas PISA y Saber.
            El estudiante está leyendo "${tituloLibro}".
            
            Texto actual: "${textoContexto.substring(0, 1000)}..."
            
            TU OBJETIVO: Generar UNA sola pregunta corta pero desafiante que evalúe la competencia: ${objetivo}.
            
            La pregunta debe invitar al estudiante a detenerse y pensar. No debe ser de Sí/No.
            Empieza la pregunta directamente.`,
      config: {
        thinkingConfig: { thinkingBudget: 2048 },
      }
    });

    return response.text || "¿Qué opinas de lo que acabas de leer?";
  } catch (error) {
    console.error("Error proactiva", error);
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
      model: 'gemini-2.5-flash',
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
    return "Error generando análisis.";
  }
}

/**
 * Generates standardized THEMA tags for content categorization.
 */
export const sugerirEtiquetasThema = async (titulo: string, descripcion: string): Promise<string[]> => {
  const cacheKey = `thema-${titulo}-${descripcion.substring(0, 50)}`;
  const cached = getCached(cacheKey);
  if (cached) return cached;

  try {
    if (!ai) return ["Generales", "Sin Clasificar", "Lectura", "Educación"];

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
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
    const tags = text.split(',').map(t => t.trim()).slice(0, 4);

    if (tags.length > 0) {
      setCached(cacheKey, tags);
      return tags;
    }
    return ["Generales", "Lectura"];
  } catch (error) {
    console.error("Error generando etiquetas THEMA:", error);
    return ["Error AI", "Intenta Manualmente"];
  }
};

/**
 * Chat with Leo (The Librarian).
 */
export const chatConBibliotecario = async (
  mensajeUsuario: string,
  historialChat: ChatMessage[],
  contextoLibroActual?: Content,
  contenidoPaginaActual?: string,
  visualContext?: VisualContext
): Promise<string> => {
  try {
    // Chat context changes too frequently to cache effectively in a simple key-value map without complexity
    const catalogo = dataService.getContenidos(['lector']).map(c => `Título: ${c.titulo}, Autor: ${c.autor}, Temas: ${c.etiquetas.join(', ')}`).join('\n');

    // Extract Critical Plot Points if they exist for the current book
    const plotPoints = contextoLibroActual?.plotPoints || [];
    let criticalContext = "";
    if (plotPoints.length > 0) {
      const relevantPoints = plotPoints.map(p => `- En capítulo/página ${p.pageOrChapter}: ${p.title}. Análisis: ${p.insight} (${p.type})`).join('\n');
      criticalContext = `
        HITOS CRÍTICOS Y CONTEXTUALES DE ESTE LIBRO (GUÍA DE LECTURA):
        ${relevantPoints}
        
        INSTRUCCIÓN CLAVE: Si el usuario menciona algo relacionado con estos hitos o si está cerca de esas páginas, ¡USA ESTA INFORMACIÓN! 
        Ofrece datos curiosos sobre el autor, el contexto histórico o el estilo literario. 
        Ejemplo: "¡Ah! Estás en la parte de la Falsa Tortuga. ¿Sabías que Lewis Carroll usó este personaje para criticar la educación victoriana?"
        `;
    }

    let systemInstruction = `
      Eres "Leo", el Mediador Pedagógico Virtual de Chibalete+.
      Tu misión es conversar con los estudiantes guiándote EXCLUSIVAMENTE por los 8 Objetivos Pedagógicos de la plataforma.
      
      TUS 8 OBJETIVOS DE MEDIACIÓN (ÚSALOS EN CADA INTERACCIÓN):
      1. COMPRENDER (Global): Haz preguntas sobre la estructura del texto y su significado general. Pide que lo expliquen con sus palabras.
      2. INFERIR (Implícito): Lanza preguntas tipo "¿Qué crees que pensaba este personaje?" o "¿Por qué pasó esto si no lo dice?".
      3. EVALUAR (Crítico): Propón debates. "¿Estás de acuerdo?", "¿Qué sesgo ves aquí?". Detecta falacias.
      4. INTEGRAR (Fuentes): Ayuda a conectar dos textos del catálogo. "¿En qué se parece esto al otro libro que leíste?".
      5. CONECTAR (Vida/Contexto): Pregunta "¿Has vivido algo así?", "¿Cómo se ve esto en tu barrio?".
      6. VOCABULARIO/METACOGNICIÓN: Define palabras por contexto. Pregunta "¿Qué hiciste para entender esa parte difícil?".
      7. EXPRESAR (Creación): Invita a escribir finales alternativos o cartas. "¿Qué le dirías al autor?".
      8. DISFRUTAR (Estético): Celebra el avance. Pregunta sobre emociones. "¿Qué sentiste en esa escena?".

      SISTEMA DE PREMIOS (PUNTOS DE MAGIA):
      Si el estudiante muestra una reflexión profunda, conecta ideas, o demuestra entusiasmo genuino, PUEDES PREMIARLO.
      Para hacerlo, escribe en una línea nueva al final de tu mensaje: [AWARD_POINTS: 5] (Máximo 5 puntos por interacción).
      Dile explícitamente "Te he dado 5 puntos de magia por esa gran respuesta".
      Úsalo con moderación (solo cuando sea muy bueno).

      REGLA DE ORO DE CONTENIDO:
      Toda la conversación debe surgir y volver a los contenidos de la App (los libros del catálogo).
      NO hables de cosas externas a menos que sea para conectarlas con un libro de la biblioteca.
      Si el usuario habla de un tema X, busca en el catálogo un libro relacionado y recomiéndalo.

      CATÁLOGO DE LA BIBLIOTECA (TUS HERRAMIENTAS):
      ${catalogo}
    `;

    if (visualContext) {
      systemInstruction += `
        *** MODO ÁLBUM (VISUAL) ***
        Estás viendo: Libro "${visualContext.bookTitle}", Página ${visualContext.pageIndex + 1}.
        Texto: "${visualContext.regionText}"
        Aplica los objetivos 2 (Inferir) y 8 (Disfrutar) enfocándote en la IMAGEN.
      `;
    } else {
      systemInstruction += `
        ${criticalContext}
      `;
    }

    if (contextoLibroActual && !visualContext) {
      systemInstruction += `
        CONTEXTO DE LECTURA (TEXTO):
        Libro: "${contextoLibroActual.titulo}" de ${contextoLibroActual.autor}.
        Descripción: ${contextoLibroActual.descripcion_corta}
        Texto visible ahora: "${contenidoPaginaActual ? contenidoPaginaActual.substring(0, 500) : 'N/A'}..."
        
        Usa este texto para formular preguntas específicas sobre la trama y estructura.
      `;
    }

    const recentHistory = historialChat.slice(-10).map(msg => ({
      role: msg.role === 'model' ? 'model' : 'user',
      parts: [{ text: msg.text }]
    }));

    if (!ai) return "¡Hola! Soy Leo 🦀. Veo que no tienes configurada mi mente (API Key), así que solo puedo saludarte. ¡Sigue leyendo!";

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [
        ...recentHistory,
        { role: 'user', parts: [{ text: mensajeUsuario }] }
      ],
      config: {
        systemInstruction: systemInstruction,
      }
    });

    return response.text || "¡Hola! Soy Leo 🦀. Estoy releyendo un clásico. ¿En qué puedo ayudarte con tu lectura?";

  } catch (error) {
    console.error("Error en chatConBibliotecario:", error);
    return "¡Hola! Soy Leo 🦀. Mi conexión con la biblioteca central está fallando un poco. ¿Me repites eso?";
  }
};

// --- VISION SIMULATION FOR ALBUM BOOKS ---
/**
 * Simulates Gemini Vision API analyzing an illustration.
 * Returns bounding boxes for narrative regions.
 */
export const analizarIlustracionAlbum = async (imageUrl: string): Promise<AlbumRegion[]> => {
  // In a real implementation, we would send the image to Gemini 2.5 Pro or Flash
  // and ask for JSON bounding boxes of key narrative elements.
  // Here, we simulate "Smart Detection" for the specific "Tortuga" book demo

  return new Promise(resolve => {
    setTimeout(() => {
      // Simulated "AI Detected Regions"
      const mockRegions: AlbumRegion[] = [
        { id: `reg-${Date.now()}-1`, text: "Detectado: Protagonista principal.", x: 10, y: 10, width: 40, height: 40 },
        { id: `reg-${Date.now()}-2`, text: "Detectado: Elemento secundario.", x: 60, y: 50, width: 30, height: 30 },
      ];
      resolve(mockRegions);
    }, 1500);
  });
}
