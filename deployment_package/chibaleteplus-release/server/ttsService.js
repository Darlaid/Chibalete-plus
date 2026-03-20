
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
        let manifest = {};
        if (fs.existsSync(manifestPath)) {
            try {
                manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            } catch (e) {
                manifest = {}; 
            }
        }

        const saveManifest = () => {
            try {
                fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
            } catch (e) {
                log(`Error saving manifest: ${e.message}`, "ERROR");
            }
        };

        let createdCount = 0;
        let errorCount = 0;
        let skippedCount = 0;
        let circuitBreakerTripped = false;

        for (let i = 0; i < chunks.length; i++) {
            const chunkTextContent = chunks[i];
            
            // WE NO LONGER HASH PRE-FLIGHT TO AVOID INACCURATE FALLBACK MISMATCH
            // Check cache by index first to see if we already have it safely mapped
            
            let skipCurrentChunk = false;
            let existingEntry = manifest[i];

            if (existingEntry && existingEntry.file) {
                const oldFilePath = path.join(uploadDir, existingEntry.file);
                
                // If it physically exists and is not corrupt
                if (fs.existsSync(oldFilePath) && fs.statSync(oldFilePath).size > 0) {
                    
                    // Critical Barrier: If we are in REAL mode, we MUST REJECT any old MOCK files.
                    const isSystemInRealMode = (TTS_MODE !== 'mock' && AI_MODE !== 'mock');
                    const isOldFileFromMock = existingEntry.provider === 'mock';

                    if (isSystemInRealMode && isOldFileFromMock) {
                        log(`[AI] Mock cache ignored in real mode for chunk ${i+1}. Will regenerate with real API.`, "TTS");
                        // We do not skip! We will run it through the real engine and overwrite.
                        skipCurrentChunk = false;
                    } 
                    else {
                        // Acceptable Cache Hit (Either both are mock, or both are real, or we are in mock and accept old real/mock files)
                        log(`[AI] Cache hit for content ${contentId} chunk ${i + 1} (Provider: ${existingEntry.provider || 'legacy'})`, "TTS");
                        
                        // Phase 5.2: Self-heal old manifests to ensure they contain the FULL text, not the old substring
                        manifest[i].text = chunkTextContent;
                        
                        skippedCount++;
                        skipCurrentChunk = true;
                        
                        if (onProgress) {
                            onProgress({ percentage: Math.round(((i + 1) / chunks.length) * 100), currentSentence: i + 1, totalSentences: chunks.length, status: 'processing', lastUpdated: new Date().toISOString() });
                        }
                    }
                }
            }

            // Move to next iteration if cache was deemed solidly valid
            if (skipCurrentChunk) continue;

            // Generate using Hybrid AI Engine
            log(`[AI] Cache miss, generating chunk ${i + 1}/${chunks.length}...`, "TTS");
            try {
                const result = await runHybridTask('tts', { text: chunkTextContent, voice: targetVoice });
                
                // POST-FLIGHT HASHING WITH THE ABSOLUTE REAL PROVIDER/MODEL THAT SUDATED IT
                log(`[AI] Using provider/model from actual result for hash: ${result.provider}/${result.model}`, "TTS");
                
                const exactHash = generateHash(chunkTextContent, targetLanguage, targetVoice, result.provider, result.model);
                
                const finalFileName = `chunk_${exactHash}_${result.provider}_${result.model}.mp3`;
                const finalFilePath = path.join(audioDir, finalFileName);

                fs.writeFileSync(finalFilePath, result.data);
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
                    text: chunkTextContent, // Phase 5.2: Save full text for audio-sync
                    file: `audio/${contentId}/${finalFileName}`,
                    index: i,
                    hash: exactHash,
                    provider: result.provider,
                    model: result.model
                };

            } catch (e) {
                errorCount++;
                const errMsg = e.message ? e.message.toLowerCase() : '';
                log(`Failed to generate chunk ${i} after all engine fallbacks: ${e.message}`, "ERROR");
                
                // --- CIRCUIT BREAKER ---
                // Si el error es sistémico (Cuota, Bloqueos, Not Found en endpoint base), ABORTAR EL RESTO DEL LOOP
                if (errMsg.includes('429') || errMsg.includes('quota') || errMsg.includes('rate limit') || errMsg.includes('403') || errMsg.includes('404') || errMsg.includes('not found')) {
                     log(`[CRITICAL] Circuit Breaker activated due to provider error. Aborting job for content ${contentId}.`, "ERROR");
                     saveManifest(); // Conservamos lo avanzado exitosamente
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
                     break; // ROTURA DEFINITIVA DEL BUCLE
                }
                
                // We MUST save manifest if abort happens midway to lock-in the chunks mapped prior to crash
                saveManifest(); 
            }

            // 3. IO Manifest Saving Optimizer (Writes to DB only every 10 chunks or at exact completion)
            if ((i + 1) % 10 === 0 || i === chunks.length - 1) {
                saveManifest();
                
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

        // Always ensure a final save at the very exit to guarantee consistency
        saveManifest();

        log(`[AI] Job completed. Created: ${createdCount}, Skipped: ${skippedCount}, Errors: ${errorCount}. Avg chunks: ${chunks.length}`, "INFO");

        // --- GARBAGE COLLECTION FOR ORPHAN AUDIO FILES ---
        try {
            log(`[TTS] Running audio garbage collection...`, "TTS");
            const validFiles = new Set();
            
            for (const key of Object.keys(manifest)) {
                if (manifest[key] && manifest[key].file) {
                    validFiles.add(path.basename(manifest[key].file));
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
