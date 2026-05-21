
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
        primary:  { provider: 'openai', model: 'tts-1' },
        fallback: { provider: 'gemini', model: 'gemini-2.5-flash-preview-tts' },
        maxInputTokens: 2000,
    },
    text_light: {
        primary: { provider: 'gemini', model: 'gemini-1.5-flash' },
        fallback: { provider: 'openai', model: 'gpt-4o-mini' },
        maxInputTokens: 4000
    },
    chat: {
        primary:  { provider: 'openai',  model: 'gpt-4o-mini' },
        fallback: { provider: 'gemini',  model: 'gemini-1.5-flash' },
    },
    // chat_visual: album mode — image attached. Gemini is primary because it
    // handles inlineData natively. OpenAI fallback is text-only (imageData
    // is silently ignored on that branch) — acceptable graceful degradation.
    chat_visual: {
        primary:  { provider: 'gemini', model: 'gemini-1.5-flash' },
        fallback: { provider: 'openai', model: 'gpt-4o-mini' },
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

export const getGemini = () => {
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

// ─────────────────────────────────────────────────────────────────────────────
// M-4.3.2 — PCM → WAV wrap (surgical fix audio_contract_failed)
//
// Gemini TTS API devuelve audio raw PCM L16 (signed 16-bit LE, 24 kHz mono
// por defecto) en `part.inlineData.data`, IGNORANDO el hint
// `response_mime_type: 'audio/mp3'` del request. El backend antes lo enviaba
// como `audio/mpeg` produciendo `src_not_supported` en HTMLAudioElement (los
// bytes son PCM, no MPEG layer-3 frames).
//
// Helpers públicos al módulo: cero deps, ~25 líneas total. Wrappean el PCM
// en contenedor WAV (RIFF) para que cualquier browser pueda decodificarlo.
// ─────────────────────────────────────────────────────────────────────────────
function _wrapPcmAsWav(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
    const byteRate   = sampleRate * channels * bitsPerSample / 8;
    const blockAlign = channels * bitsPerSample / 8;
    const dataSize   = pcmBuffer.length;
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);              // SubChunk1Size (PCM)
    header.writeUInt16LE(1, 20);               // AudioFormat = 1 (PCM)
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    return Buffer.concat([header, pcmBuffer]);
}

function _parseSampleRate(mimeType) {
    if (typeof mimeType !== 'string') return 24000;
    const m = mimeType.match(/rate=(\d+)/i);
    return m ? parseInt(m[1], 10) : 24000;
}

const getMockResponse = (taskType, payload) => {
    log(`[AI] Using MOCK mode for task=${taskType}`);
    if (taskType === 'tts') {
        // M-4.3.2 — silent valid WAV (44 byte header + 980 bytes zero PCM @24kHz/16bit/mono
        // ≈ 20 ms de silencio). Reemplaza el Buffer.alloc(1024, 0) anterior que era
        // bytes nulos crudos enviados como audio/mpeg → src_not_supported en mock mode.
        return _wrapPcmAsWav(Buffer.alloc(980, 0), 24000, 1, 16);
    } else if (taskType === 'text_light') {
        return "[MOCK] Resumen generado sin costo.";
    } else if (taskType === 'chat' || taskType === 'chat_visual') {
        return "[MOCK] Respuesta del asistente pedagógico simulada.";
    }
    return "[MOCK]";
};

// INVARIANT — systemInstruction delivery contract:
//   Every provider + taskType combination that accepts a systemInstruction MUST
//   deliver it to the model without loss.
//   • OpenAI (chat / chat_visual): prepended as { role:'system', content } — first
//     message in the array. There is no top-level 'system' parameter.
//   • Gemini (chat / chat_visual): passed via config.systemInstruction.
//   • text_light: single-shot, no system instruction (caller builds a self-contained prompt).
//   Violating this invariant silently strips Leo's entire pedagogical context and
//   MODO ÁLBUM section, causing hallucinations and policy violations.
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
            // M-4.3.2 — declarar mimeType explícito (OpenAI sí devuelve MP3 real).
            return { provider, model, data: buffer, mimeType: 'audio/mpeg' };
        } else if (taskType === 'text_light') {
            const completion = await ai.chat.completions.create({
                model: model,
                messages: [{ role: "user", content: payload.text }]
            });
            return { provider, model, data: completion.choices[0].message.content };
        } else if (taskType === 'chat' || taskType === 'chat_visual') {
            // OpenAI chat.completions has no top-level 'system' parameter.
            // System instruction must be the first message with role:'system'.
            // This applies to both normal chat (primary) and album fallback
            // (chat_visual when Gemini is unavailable) — Leo's full pedagogical
            // context and MODO ÁLBUM section are preserved in either path.
            // imageData is intentionally not used here: OpenAI text-only is the
            // accepted degradation when Gemini is unavailable.
            if (!payload.systemInstruction) {
                log(`[aiEngine] WARN taskType=${taskType} provider=openai — systemInstruction missing; Leo context will be absent`);
            }
            const messagesWithSystem = payload.systemInstruction
                ? [{ role: 'system', content: payload.systemInstruction }, ...payload.messages]
                : payload.messages;
            const completion = await ai.chat.completions.create({
                model: model,
                messages: messagesWithSystem,
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
                    responseModalities: ['AUDIO'],
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
                const rawBuffer  = Buffer.from(part.inlineData.data, 'base64');
                const inlineMime = part.inlineData.mimeType ?? '';
                // M-4.3.2 — root cause de audio_contract_failed: Gemini devuelve
                // PCM L16 raw IGNORANDO el response_mime_type hint del request.
                // Wrap en contenedor WAV para que el browser pueda decodificarlo.
                // Si Gemini eventualmente devuelve MP3/OGG real, pasa-through.
                if (/^audio\/(l16|pcm)/i.test(inlineMime) || /codec=pcm/i.test(inlineMime)) {
                    const sampleRate = _parseSampleRate(inlineMime);
                    const wavBuffer  = _wrapPcmAsWav(rawBuffer, sampleRate, 1, 16);
                    return { provider, model, data: wavBuffer, mimeType: 'audio/wav' };
                }
                // mimeType desconocido o ya container-wrapped: pasa raw + mimeType honesto.
                return { provider, model, data: rawBuffer, mimeType: inlineMime || 'audio/mpeg' };
            }
            throw new Error("No audio data in Gemini response");
        } else if (taskType === 'text_light') {
            const response = await ai.models.generateContent({
                model: model,
                contents: payload.text
            });
            return { provider, model, data: response.text };
        } else if (taskType === 'chat' || taskType === 'chat_visual') {
            if (!payload.systemInstruction) {
                log(`[aiEngine] WARN taskType=${taskType} provider=gemini — systemInstruction missing; Leo context will be absent`);
            }
            const convertedMessages = payload.messages.map((m, idx, arr) => {
                const parts = [{ text: m.content || m.text || '' }];

                // Inject image into the last user message when imageData is present.
                // Multimodal only supported on Gemini — OpenAI fallback is text-only.
                const isLastUser = idx === arr.length - 1 && m.role === 'user';
                if (isLastUser && payload.imageData?.base64) {
                    parts.push({
                        inlineData: {
                            mimeType: payload.imageData.mimeType ?? 'image/jpeg',
                            data:     payload.imageData.base64,
                        },
                    });
                }

                return {
                    role:  m.role === 'user' ? 'user' : 'model',
                    parts,
                };
            });
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
        // M-4.3.2 — propagar mimeType para que el endpoint pueda enviar Content-Type
        // honesto. Mock TTS ahora devuelve WAV válido (silent), no zeros bytes.
        const mockMime = taskType === 'tts' ? 'audio/wav' : undefined;
        return { provider: 'mock', model: 'mock-engine', data: mockData, mimeType: mockMime };
    }

    const config = AI_CONFIG[taskType];
    if (!config) throw new Error(`Unknown task type: ${taskType}`);

    const primaryOption  = config.primary;
    const fallbackOption = config.fallback;

    // ── DIAGNÓSTICO: verificar keys antes de intentar ──────────────────────────
    const hasOpenAI = !!process.env.OPENAI_API_KEY;
    const hasGemini = !!process.env.GEMINI_API_KEY;
    log(`[AI] runHybridTask task=${taskType} openai_key=${hasOpenAI} gemini_key=${hasGemini}`);

    // ── PRIMARY ────────────────────────────────────────────────────────────────
    let primaryError = null;
    let attempts = 0;
    while (attempts < AI_CONFIG.maxRetries) {
        try {
            log(`[AI] PRIMARY task=${taskType} provider=${primaryOption.provider} model=${primaryOption.model}`);
            const result = await executeWithProvider(primaryOption.provider, primaryOption.model, taskType, payload);
            log(`[AI] PRIMARY success provider=${primaryOption.provider}`);
            return result;
        } catch (error) {
            attempts++;
            primaryError = error;
            const msg = error.message ?? '';
            log(`[AI] PRIMARY failed attempt=${attempts} error="${msg}"`);

            // No reintentar si la key no existe — el problema es de configuración
            if (msg.includes('missing')) break;

            // No reintentar en errores definitivos de auth / quota
            const low = msg.toLowerCase();
            if (low.includes('401') || low.includes('403') || low.includes('429') ||
                low.includes('quota') || low.includes('rate limit')) {
                log(`[AI] PRIMARY abort — auth/quota error, no retry`);
                break;
            }

            if (attempts >= AI_CONFIG.maxRetries) break;
            await new Promise(r => setTimeout(r, 1000 * attempts));
        }
    }

    // ── FALLBACK ───────────────────────────────────────────────────────────────
    log(`[AI] FALLBACK task=${taskType} provider=${fallbackOption.provider} model=${fallbackOption.model} (primary_err="${primaryError?.message}")`);
    attempts = 0;
    while (attempts < AI_CONFIG.maxRetries) {
        try {
            const result = await executeWithProvider(fallbackOption.provider, fallbackOption.model, taskType, payload);
            log(`[AI] FALLBACK success provider=${fallbackOption.provider}`);
            return result;
        } catch (error) {
            attempts++;
            const msg = error.message ?? '';
            log(`[AI] FALLBACK failed attempt=${attempts} error="${msg}"`);

            if (msg.includes('missing')) {
                // Fallback key también ausente — lanzar con diagnóstico completo
                throw new Error(`All providers failed: primary="${primaryError?.message}" fallback="${msg}"`);
            }
            if (attempts >= AI_CONFIG.maxRetries) {
                throw new Error(`All providers failed: primary="${primaryError?.message}" fallback="${msg}"`);
            }
            await new Promise(r => setTimeout(r, 1000 * attempts));
        }
    }

    // Esta línea es inalcanzable — el while siempre lanza si no retorna.
    // Defensive throw para satisfacer el análisis de tipos.
    throw new Error(`runHybridTask: unreachable exit for task=${taskType}`);
};
