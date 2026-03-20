import { validateLeoRequest } from './leoGuard.js';
import { buildLeoContextPacket } from './leoContextBuilder.js';
import { buildSystemPrompt } from './leoPolicy.js';
import { askAI } from './leoResponder.js';

/**
 * processLeoRequest — orchestrates the full Leo request pipeline.
 *
 * @param {string}      contentId
 * @param {number}      chunkIndex
 * @param {string}      interactionType   — 'vocab' | 'question'
 * @param {string}      payload           — user-entered text
 * @param {string}      exactSentence     — the current sentence being read
 * @param {object|null} sessionMemory     — LeoSessionMemory from frontend (optional)
 * @param {string|null} difficultyLevel   — 'inicial'|'medio'|'avanzado' (optional)
 * @param {string|null} pedagogicalStage  — 'comprehension'|'interpretation'|'reflection'|'creation' (optional)
 * @param {object|null} readerProfile     — LeoReaderProfile subset from frontend (optional)
 */
export const processLeoRequest = async (
    contentId,
    chunkIndex,
    interactionType,
    payload,
    exactSentence,
    sessionMemory,
    difficultyLevel,
    pedagogicalStage,
    readerProfile
) => {
    // 1. Guard — validate domain and input constraints
    validateLeoRequest(contentId, chunkIndex, interactionType, payload, exactSentence);

    // 2. Context builder — assemble all sources into a structured packet
    const contextPacket = buildLeoContextPacket(
        contentId,
        chunkIndex,
        sessionMemory    ?? null,
        difficultyLevel  ?? null,
        pedagogicalStage ?? null,
        readerProfile    ?? null
    );

    // 3. Policy — assemble the multi-section system prompt from the structured packet
    const systemPrompt = buildSystemPrompt(contextPacket);

    // 4. Responder — send to AI engine
    const answer = await askAI(systemPrompt, payload, exactSentence);

    return { answer };
};
