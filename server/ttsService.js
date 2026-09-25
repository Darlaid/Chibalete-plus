
import fs from 'fs';
import path from 'path';
import { runHybridTask, AI_CONFIG, generateHash } from './aiEngine.js';

// DEV/MOCK mode via env (real | mock)
const AI_MODE = process.env.AI_MODE || 'real';
const TTS_MODE = process.env.TTS_MODE || 'real';

// --- HELPERS ---
const log = (msg, type = 'TTS') => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${type}] ${msg}`);
};

/**
 * Intelligent Chunking Strategy
 * Groups text into larger chunks (800-1500 chars) instead of single sentences.
 * This drastically reduces API calls, cost, and improves performance on long texts.
 */
const chunkText = (text, minChunkSize = 800, maxChunkSize = 1500) => {
    const cleanText = text.replace(/\r\n/g, ' ').replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
    if (!cleanText) return [];

    const matches = cleanText.match(/[^.!?]+[.!?]+[\s]*/g);
    const sentences = matches ? matches.map(s => s.trim()) : [cleanText];

    const chunks = [];
    let currentChunk = "";

    for (const sentence of sentences) {
        if (!sentence) continue;
        
        if (currentChunk.length + sentence.length + 1 > maxChunkSize && currentChunk.length >= minChunkSize) {
            chunks.push(currentChunk.trim());
            currentChunk = sentence;
        } else {
            currentChunk += (currentChunk ? " " : "") + sentence;
        }
    }

    if (currentChunk) {
        chunks.push(currentChunk.trim());
    }

    return chunks.filter(c => c.length > 0);
};

/**
 * MANIFEST v2: Segmentador determinista de oraciones para metadatos del manifest.
 * Separa el texto de un chunk en oraciones reales para granularidad fina de display.
 *
 * FROZEN: No modificar esta función sin re-generar todos los manifests existentes.
 * Cualquier cambio en el algoritmo invalidaría los sentenceStart almacenados en manifests activos.
 *
 * @param {string} chunkText - Texto del chunk de audio
 * @returns {string[]} Array de oraciones limpias
 */
const splitSentencesFromChunk = (chunkText) => {
    if (!chunkText || typeof chunkText !== 'string') return [];
    // Proteger abreviaciones comunes en español y números decimales para evitar falsos cortes
    const PLACEHOLDER = '\u00B6'; // Pilcrow — no aparece en texto editorial normal
    const protected_ = chunkText
        .replace(/\b(Dr|Sr|Sra|Srta|Prof|Lic|No|art|cap|núm|vs|etc|pág|vol|fig)\./gi, `$1${PLACEHOLDER}`)
        .replace(/(\d)\.(\d)/g, `$1${PLACEHOLDER}$2`);
    const raw = protected_.match(/[^.!?]+[.!?]+[\s]*/g) || [protected_];
    return raw
        .map(s => s.replace(/\u00B6/g, '.').trim())
        .filter(s => s.length > 5);
};

// --- AUDIO CACHE IDENTITY (CHP-CONTENT-CANONICAL-2026-01 1A) ---
// El audio de un chunk se identifica por su CONTENIDO, nunca por su posición:
// hash = generateHash(texto del chunk, idioma, voz, provider, model), el mismo
// que ya da nombre al archivo. Un HIT exige que exista el mp3 de la identidad
// esperada para el texto ACTUAL con un motor aceptable.
const chunkAudioFileName = (hash, provider, model) => `chunk_${hash}_${provider}_${model}.mp3`;

// Motores cuyo audio puede reutilizarse: los configurados para TTS. En modo
// real el audio mock nunca se acepta (barrera previa); en mock se acepta todo.
const acceptableTtsEngines = () => {
    const engines = [AI_CONFIG.tts.primary, AI_CONFIG.tts.fallback];
    if (TTS_MODE === 'mock' || AI_MODE === 'mock') engines.push({ provider: 'mock', model: 'mock-engine' });
    return engines;
};

const findCachedChunkAudio = (audioDir, text, language, voice) => {
    for (const { provider, model } of acceptableTtsEngines()) {
        const hash = generateHash(text, language, voice, provider, model);
        const fileName = chunkAudioFileName(hash, provider, model);
        const filePath = path.join(audioDir, fileName);
        if (fs.existsSync(filePath) && fs.statSync(filePath).size > 0) return { hash, provider, model, fileName };
    }
    return null;
};

// Escritura atómica: temporal + rename, para que ningún lector vea un archivo a medias.
const writeFileAtomic = (filePath, data) => {
    const tmpPath = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmpPath, data);
    fs.renameSync(tmpPath, filePath);
};

// --- CORE FUNCTION ---

export const generateAudioForContent = async (contentId, textFilePath, uploadDir, onProgress = null) => {
    // Basic task configuration
    const targetLanguage = 'es'; // Hardcoded scope for Chibalete+
    const targetVoice = 'alloy'; // Openai primary voice

    const audioDir = path.join(uploadDir, 'audio', contentId);

    try {
        if (!fs.existsSync(audioDir)) {
            fs.mkdirSync(audioDir, { recursive: true });
        }

        if (!fs.existsSync(textFilePath)) {
            throw new Error(`Text file not found: ${textFilePath}`);
        }
        const textContent = fs.readFileSync(textFilePath, 'utf8');
        let chunks = chunkText(textContent);

        log(`Starting generation for ${contentId}. Total chunks: ${chunks.length}`);

        // Safety limit: Don't process massive erroneous text dumps
        if (chunks.length > AI_CONFIG.maxChunksPerJob) {
            log(`[WARNING] Content exceeds chunk safety limit (${chunks.length} > ${AI_CONFIG.maxChunksPerJob}). Truncating to prevent blowout cost.`, "WARN");
            chunks = chunks.slice(0, AI_CONFIG.maxChunksPerJob);
        }

        if (onProgress) {
            onProgress({
                percentage: 0,
                currentSentence: 0,
                totalSentences: chunks.length,
                status: 'processing',
                lastUpdated: new Date().toISOString()
            });
        }

        const manifestPath = path.join(audioDir, 'manifest.json');
        // El manifest anterior solo se lee para no borrar su audio en la GC: la
        // reutilización se decide por identidad, nunca por sus entradas.
        let previousManifest = {};
        if (fs.existsSync(manifestPath)) {
            try {
                previousManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            } catch (e) {
                previousManifest = {};
            }
        }

        // Se construye un manifest NUEVO: ninguna entrada de la versión anterior
        // (texto distinto o índices sobrantes) sobrevive. Se publica una sola vez,
        // de forma atómica, al terminar; mientras tanto sigue visible el anterior.
        const manifest = {};
        const saveManifest = () => {
            try {
                writeFileAtomic(manifestPath, JSON.stringify(manifest, null, 2));
            } catch (e) {
                log(`Error saving manifest: ${e.message}`, "ERROR");
            }
        };

        // MANIFEST v2: Inicializar _meta. Se sobreescribe en cada job para mantener
        // totalChunks actualizado. totalSentences se calcula al finalizar el loop.
        manifest._meta = {
            version: 2,
            splitVersion: 1,
            totalChunks: chunks.length,
            totalSentences: 0,
        };

        let globalSentenceIndex = 0; // Contador acumulado para sentenceStart por chunk
        let createdCount = 0;
        let errorCount = 0;
        let skippedCount = 0;
        let circuitBreakerTripped = false;

        for (let i = 0; i < chunks.length; i++) {
            const chunkTextContent = chunks[i];

            // MANIFEST v2: Calcular oraciones del chunk antes de la decisión skip/new
            // Se computa siempre para mantener globalSentenceIndex consistente en ambos paths.
            const chunkSentences = splitSentencesFromChunk(chunkTextContent);
            const chunkSentenceStart = globalSentenceIndex;
            globalSentenceIndex += chunkSentences.length;
            
            // CACHE HIT solo si existe el audio de la identidad esperada para ESTE texto.
            const cached = findCachedChunkAudio(audioDir, chunkTextContent, targetLanguage, targetVoice);
            if (cached) {
                log(`[AI] Cache hit for content ${contentId} chunk ${i + 1} (Provider: ${cached.provider})`, "TTS");
                manifest[i] = {
                    text: chunkTextContent,
                    file: `audio/${contentId}/${cached.fileName}`,
                    index: i,
                    hash: cached.hash,
                    provider: cached.provider,
                    model: cached.model,
                    sentences: chunkSentences,
                    sentenceStart: chunkSentenceStart,
                };
                skippedCount++;
                if (onProgress && !circuitBreakerTripped) {
                    onProgress({ percentage: Math.round(((i + 1) / chunks.length) * 100), currentSentence: i + 1, totalSentences: chunks.length, status: 'processing', lastUpdated: new Date().toISOString() });
                }
                continue;
            }

            // Tras el circuit breaker no se genera nada más, pero se siguen
            // recogiendo los HIT para no perder audio válido.
            if (circuitBreakerTripped) continue;

            // Generate using Hybrid AI Engine
            log(`[AI] Cache miss, generating chunk ${i + 1}/${chunks.length}...`, "TTS");
            try {
                const result = await runHybridTask('tts', { text: chunkTextContent, voice: targetVoice });
                
                // POST-FLIGHT HASHING WITH THE ABSOLUTE REAL PROVIDER/MODEL THAT SUDATED IT
                log(`[AI] Using provider/model from actual result for hash: ${result.provider}/${result.model}`, "TTS");
                
                const exactHash = generateHash(chunkTextContent, targetLanguage, targetVoice, result.provider, result.model);
                
                const finalFileName = chunkAudioFileName(exactHash, result.provider, result.model);
                const finalFilePath = path.join(audioDir, finalFileName);

                // Atómica: un mp3 truncado con nombre de identidad válida sería un HIT falso.
                writeFileAtomic(finalFilePath, result.data);
                createdCount++;

                // If fallback happened, this elegantly captures the Gemini identity instead of OpenAI's
                if (result.provider !== AI_CONFIG.tts.primary.provider && result.provider !== 'mock') {
                    log(`[AI] Fallback result stored with real provider identity: ${result.provider}`, "WARN");
                }
                
                if (result.provider === 'mock') {
                    log(`[AI] Mock chunk stored for UI only: ${finalFileName}`, "MOCK");
                } else {
                    log(`[AI] Chunk ${i + 1}/${chunks.length} generated by ${result.provider}`, "SUCCESS");
                }

                // Append safely to Manifest
                manifest[i] = {
                    text: chunkTextContent,
                    file: `audio/${contentId}/${finalFileName}`,
                    index: i,
                    hash: exactHash,
                    provider: result.provider,
                    model: result.model,
                    sentences: chunkSentences,
                    sentenceStart: chunkSentenceStart,
                };

            } catch (e) {
                errorCount++;
                const errMsg = e.message ? e.message.toLowerCase() : '';
                log(`Failed to generate chunk ${i} after all engine fallbacks: ${e.message}`, "ERROR");
                
                // --- CIRCUIT BREAKER ---
                // Si el error es sistémico (Cuota, Bloqueos, Not Found en endpoint base), ABORTAR EL RESTO DEL LOOP
                if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate limit') || errMsg.includes('403') || errMsg.includes('404') || errMsg.includes('not found')) {
                     log(`[CRITICAL] Circuit Breaker activated due to provider error. Aborting job for content ${contentId}.`, "ERROR");
                     circuitBreakerTripped = true;
                     if (onProgress) {
                         onProgress({
                             percentage: Math.round(((i) / chunks.length) * 100),
                             currentSentence: i,
                             totalSentences: chunks.length,
                             status: 'error_proveedor',
                             error: `Interrumpido por el proveedor: ${e.message}`,
                             lastUpdated: new Date().toISOString()
                         });
                     }
                     continue; // no se genera nada más; el resto del bucle solo recoge HITs
                }
            }

            // Progreso cada 10 chunks. El manifest ya no se escribe a mitad de job:
            // se publica una vez al final. Un job interrumpido no pierde el audio
            // generado, porque su nombre es su identidad y el siguiente job lo reutiliza.
            if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
                const percent = Math.round(((i + 1) / chunks.length) * 100);
                if (onProgress) {
                    onProgress({
                        percentage: percent,
                        currentSentence: i + 1,
                        totalSentences: chunks.length,
                        status: 'processing',
                        lastUpdated: new Date().toISOString()
                    });
                }
            }
        } // end loop

        // MANIFEST v2: Totalizar oraciones ahora que el loop está completo
        manifest._meta.totalSentences = globalSentenceIndex;

        // Always ensure a final save at the very exit to guarantee consistency
        saveManifest();

        log(`[AI] Job completed. Created: ${createdCount}, Skipped: ${skippedCount}, Errors: ${errorCount}. Avg chunks: ${chunks.length}`, "INFO");

        // --- GARBAGE COLLECTION FOR ORPHAN AUDIO FILES ---
        try {
            log(`[TTS] Running audio garbage collection...`, "TTS");
            // Se conserva también el audio que referenciaba el manifest anterior: esta
            // pasada no borra audio que estaba publicado. Solo se borra, como antes,
            // el mp3 que no referencia ni el manifest nuevo ni el anterior.
            const validFiles = new Set();
            for (const source of [manifest, previousManifest]) {
                for (const key of Object.keys(source)) {
                    if (source[key] && source[key].file) {
                        validFiles.add(path.basename(source[key].file));
                    }
                }
            }

            const allFiles = fs.readdirSync(audioDir);
            let removedCount = 0;

            for (const file of allFiles) {
                if (file.endsWith('.mp3') && !validFiles.has(file)) {
                    fs.unlinkSync(path.join(audioDir, file));
                    log(`[TTS] Removed orphan audio file: ${file}`, "TTS");
                    removedCount++;
                }
            }
            log(`[TTS] Garbage collection completed. Removed ${removedCount} orphans.`, "TTS");
        } catch (gcError) {
            log(`[TTS] Garbage collection skipped due to error: ${gcError.message}`, "WARN");
        }

        if (circuitBreakerTripped) {
            return { success: false, abortedByProvider: true, error: "Job aborted strictly due to provider rejection (Quota/RateLimit/NotFound)." };
        }

        return { success: true, createdCount, errorCount };

    } catch (error) {
        log(`Fatal Error in TTS Generation: ${error.message}`, "ERROR");
        if (onProgress) {
            onProgress({
                percentage: 0,
                currentSentence: 0,
                totalSentences: chunks ? chunks.length : 0,
                status: 'error_proveedor',
                error: error.message,
                lastUpdated: new Date().toISOString()
            });
        }
        return { success: false, error: error.message };
    }
};
