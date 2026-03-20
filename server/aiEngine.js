
import { GoogleGenAI } from "@google/genai";
import OpenAI from "openai";
import crypto from 'crypto';

const log = (msg) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${msg}`);
};

// DEV/MOCK mode via env (real | mock)
const AI_MODE = process.env.AI_MODE || 'real';
const TTS_MODE = process.env.TTS_MODE || 'real';

export const AI_CONFIG = {
    tts: {
        primary: { provider: 'openai', model: 'tts-1' },
        fallback: { provider: 'openai', model: 'tts-1' }, // Desactivado Fallback Gemini temporalmente (Fase 4.1)
        maxInputTokens: 2000, 
    },
    text_light: {
        primary: { provider: 'gemini', model: 'gemini-1.5-flash' },
        fallback: { provider: 'openai', model: 'gpt-4o-mini' },
        maxInputTokens: 4000
    },
    chat: {
        primary: { provider: 'openai', model: 'gpt-4o-mini' },
        fallback: { provider: 'gemini', model: 'gemini-1.5-flash' }
    },
    maxRetries: 2,
    timeoutMs: 15000,
    maxChunksPerJob: 500
};

// Initialize clients lazily
let openaiClient = null;
let geminiClient = null;

const getOpenAI = () => {
    if (openaiClient) return openaiClient;
    if (process.env.OPENAI_API_KEY) {
        openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        return openaiClient;
    }
    return null;
};

const getGemini = () => {
    if (geminiClient) return geminiClient;
    if (process.env.GEMINI_API_KEY) {
        geminiClient = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY, apiVersion: 'v1beta' });
        return geminiClient;
    }
    return null;
};

/**
 * Generates a hardened deterministic hash for cache deduplication.
 * Corrected to include context to prevent false cache-hits across different configurations.
 */
export const generateHash = (text, language = 'es', voice = 'default', provider = 'default', model = 'default') => {
    // Normalize text completely to avoid white-space cache misses
    const cleanText = text.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    
    // The payload strictly binds the chunk generation to the engine/voice used
    const payload = `${cleanText}|${language}|${voice}|${provider}|${model}`;
    
    return crypto.createHash('md5').update(payload).digest('hex');
};

const getMockResponse = (taskType, payload) => {
    log(`[AI] Using MOCK mode for task=${taskType}`);
    if (taskType === 'tts') {
        // Return an empty valid 1KB buffer representing silence/mock mp3
        return Buffer.alloc(1024, 0);
    } else if (taskType === 'text_light') {
        return "[MOCK] Resumen generado sin costo.";
    } else if (taskType === 'chat') {
        return "[MOCK] Respuesta del asistente pedagógico simulada.";
    }
    return "[MOCK]";
};

const executeWithProvider = async (provider, model, taskType, payload) => {
    // Guards
    if (taskType === 'tts' && payload.text?.length > AI_CONFIG.tts.maxInputTokens) {
        throw new Error(`Text length (${payload.text.length}) exceeds TTS chunk limit (${AI_CONFIG.tts.maxInputTokens})`);
    }

    if (provider === 'openai') {
        const ai = getOpenAI();
        if (!ai) throw new Error("OpenAI API Key missing");

        if (taskType === 'tts') {
            const mp3 = await ai.audio.speech.create({
                model: model,
                voice: payload.voice || 'alloy',
                input: payload.text,
            });
            const buffer = Buffer.from(await mp3.arrayBuffer());
            return { provider, model, data: buffer };
        } else if (taskType === 'text_light') {
            const completion = await ai.chat.completions.create({
                model: model,
                messages: [{ role: "user", content: payload.text }]
            });
            return { provider, model, data: completion.choices[0].message.content };
        } else if (taskType === 'chat') {
            const completion = await ai.chat.completions.create({
                model: model,
                messages: payload.messages,
                system: payload.systemInstruction || undefined
            });
            return { provider, model, data: completion.choices[0].message.content };
        }
    } else if (provider === 'gemini') {
        const ai = getGemini();
        if (!ai) throw new Error("Gemini API Key missing");

        if (taskType === 'tts') {
            const response = await ai.models.generateContent({
                model: model,
                contents: [{ parts: [{ text: payload.text }] }],
                config: {
                    response_mime_type: "audio/mp3",
                    speech_config: {
                        voice_config: {
                            prebuilt_voice_config: { voice_name: payload.voice || 'Kore' },
                        },
                    },
                },
            });
            const part = response.candidates?.[0]?.content?.parts?.[0];
            if (part?.inlineData?.data) {
                return { provider, model, data: Buffer.from(part.inlineData.data, 'base64') };
            }
            throw new Error("No audio data in Gemini response");
        } else if (taskType === 'text_light') {
            const response = await ai.models.generateContent({
                model: model,
                contents: payload.text
            });
            return { provider, model, data: response.text };
        } else if (taskType === 'chat') {
            const convertedMessages = payload.messages.map(m => ({
                role: m.role === 'user' ? 'user' : 'model',
                parts: [{ text: m.content || m.text }]
            }));
            const response = await ai.models.generateContent({
                model: model,
                contents: convertedMessages,
                config: {
                    systemInstruction: payload.systemInstruction || undefined
                }
            });
            return { provider, model, data: response.text };
        }
    }
    const err = new Error(`Unsupported provider: ${provider}`);
    err.status = 500;
    throw err;
};

/**
 * Main Hybrid AI Engine Executor
 */
export const runHybridTask = async (taskType, payload) => {
    // Check Dev/Mock Mode Safety Net
    if ((taskType === 'tts' && TTS_MODE === 'mock') || (AI_MODE === 'mock')) {
        const mockData = getMockResponse(taskType, payload);
        return { provider: 'mock', model: 'mock-engine', data: mockData };
    }

    const config = AI_CONFIG[taskType];
    if (!config) throw new Error(`Unknown task type: ${taskType}`);

    const primaryOption = config.primary;
    const fallbackOption = config.fallback;

    let attempts = 0;
    while (attempts < AI_CONFIG.maxRetries) {
        try {
            log(`[AI] Task=${taskType} Provider=${primaryOption.provider} Model=${primaryOption.model}`);
            const result = await executeWithProvider(primaryOption.provider, primaryOption.model, taskType, payload);
            return result;
        } catch (error) {
            attempts++;
            log(`[AI] Primary failed (${error.message}), Attempt ${attempts}/${AI_CONFIG.maxRetries}`);
            if (error.message.includes('missing')) break; // Don't retry if key missing
            
            // Falla rápida y definitiva para límites estrictos, sin retries inútiles
            const errMsg = error.message ? error.message.toLowerCase() : '';
            if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate limit') || errMsg.includes('403') || errMsg.includes('401')) {
                log(`[AI] Strict API Limit hit. Aborting primary retries immediately.`);
                break;
            }

            if (attempts >= AI_CONFIG.maxRetries) break;
            await new Promise(r => setTimeout(r, 1000 * attempts));
        }
    }

    // Fallback
    // Bloqueo estricto para TTS en Fase 4.1: No hay fallback para evitar dobles llamadas a OpenAI tras error
    if (taskType === 'tts') {
        const err = new Error("Provider exhausted limit or failed. No fallback active for TTS.");
        err.status = 500;
        throw err;
    }

    log(`[AI] Primary failed, trying fallback provider=${fallbackOption.provider} model=${fallbackOption.model}`);
    attempts = 0;
    while (attempts < AI_CONFIG.maxRetries) {
        try {
            const result = await executeWithProvider(fallbackOption.provider, fallbackOption.model, taskType, payload);
            return result;
        } catch (error) {
            attempts++;
            log(`[AI] Fallback failed (${error.message}), Attempt ${attempts}/${AI_CONFIG.maxRetries}`);
            if (error.message.includes('missing')) break;
            if (attempts >= AI_CONFIG.maxRetries) {
                log(`[AI] All providers failed for task=${taskType}`);
                throw new Error("All AI providers failed.");
            }
            await new Promise(r => setTimeout(r, 1000 * attempts));
        }
    }
};
