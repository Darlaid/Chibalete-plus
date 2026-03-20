import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Character caps per context section (prevents prompt overflow)
const CAPS = {
    pedagogicalGuide:  500,
    authorBio:         300,
    historicalContext: 400,
    literaryNotes:     400,
};

const cap = (str, limit) =>
    typeof str === 'string' && str.length > limit ? str.slice(0, limit) + '…' : (str ?? null);

const safeReadJson = (filePath) => {
    try {
        if (fs.existsSync(filePath)) {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        }
    } catch (e) {
        console.error(`[leoRetriever] Error reading ${filePath}:`, e.message);
    }
    return null;
};

/**
 * retrieveStructuredContext — returns a fully labeled, typed context object.
 *
 * All fields are optional (null if the corresponding file doesn't exist).
 * Excerpt fields are capped to prevent prompt overflow.
 *
 * @param {string} contentId
 * @param {number} chunkIndex
 * @returns {object}
 */
export const retrieveStructuredContext = (contentId, chunkIndex) => {
    const rootDir = path.resolve(__dirname, '..');
    const baseDir = path.join(rootDir, 'uploads', 'leo_context');
    const folderPath = path.join(baseDir, contentId);

    const result = {
        anchors:          null,
        vocabulary:       null,
        vocabularyNotes:  null,
        pedagogicalGuide: null,
        authorBio:        null,
        historicalContext: null,
        literaryNotes:    null,
    };

    // ── New directory structure ───────────────────────────────────────────
    if (fs.existsSync(folderPath) && fs.statSync(folderPath).isDirectory()) {

        // Chunk-indexed files (keyed by sentence/chunk index)
        const anchorsData = safeReadJson(path.join(folderPath, 'anchors.json'));
        if (anchorsData?.[chunkIndex]) result.anchors = anchorsData[chunkIndex];

        const vocabData = safeReadJson(path.join(folderPath, 'vocabulary.json'));
        if (vocabData?.[chunkIndex]) result.vocabulary = vocabData[chunkIndex];

        const vocabNotesData = safeReadJson(path.join(folderPath, 'vocabulary_notes.json'));
        if (vocabNotesData?.[chunkIndex]) {
            const raw = vocabNotesData[chunkIndex];
            result.vocabularyNotes = typeof raw === 'string'
                ? raw
                : JSON.stringify(raw);
        }

        const guideData = safeReadJson(path.join(folderPath, 'pedagogical_guide.json'));
        if (guideData?.[chunkIndex]) {
            const entry = guideData[chunkIndex];
            const text = entry.content || entry.objective || JSON.stringify(entry);
            result.pedagogicalGuide = cap(text, CAPS.pedagogicalGuide);
        }

        // Global (book-level) files
        const bioData = safeReadJson(path.join(folderPath, 'author_bio.json'));
        if (bioData?.bio) result.authorBio = cap(bioData.bio, CAPS.authorBio);

        const histData = safeReadJson(path.join(folderPath, 'historical_context.json'));
        if (histData?.context) result.historicalContext = cap(histData.context, CAPS.historicalContext);

        const litData = safeReadJson(path.join(folderPath, 'literary_notes.json'));
        if (litData?.notes) result.literaryNotes = cap(litData.notes, CAPS.literaryNotes);

        return result;
    }

    // ── Legacy single-file fallback ───────────────────────────────────────
    const legacyPath = path.join(baseDir, `${contentId}.json`);
    if (fs.existsSync(legacyPath)) {
        try {
            const fileData = fs.readFileSync(legacyPath, 'utf8');
            const contextJson = JSON.parse(fileData);
            if (contextJson.chunks?.[chunkIndex]) {
                // Legacy: treat the whole chunk as a pedagogical guide snippet
                result.pedagogicalGuide = cap(
                    JSON.stringify(contextJson.chunks[chunkIndex]),
                    CAPS.pedagogicalGuide
                );
            }
        } catch (error) {
            console.error(`[leoRetriever] Error reading legacy file ${legacyPath}:`, error);
        }
    }

    return result;
};

/**
 * retrieveContext — backward-compatibility shim.
 * Returns a flat JSON string (previous behavior) for any callers not yet updated.
 * @deprecated Use retrieveStructuredContext instead.
 */
export const retrieveContext = (contentId, chunkIndex) => {
    const structured = retrieveStructuredContext(contentId, chunkIndex);
    const hasAny = Object.values(structured).some(v => v !== null);
    if (!hasAny) return 'Material lector base.';
    return JSON.stringify(structured);
};
