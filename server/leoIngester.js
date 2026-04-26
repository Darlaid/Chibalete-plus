import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { UPLOADS_ROOT } from './config.js';
const require = createRequire(import.meta.url);
const pdfParse = require('pdf-parse');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_TYPES = [
    'author_bio',
    'historical_context',
    'literary_notes',
    'pedagogical_guide',
    'vocabulary_notes',
    'update_article'
];

export const ingestPedagogicalFile = async (tempFilePath, originalName, contentId, documentType) => {
    if (!ALLOWED_TYPES.includes(documentType)) {
        throw new Error(`Tipo de documento '${documentType}' no autorizado. Permitidos: ${ALLOWED_TYPES.join(', ')}`);
    }

    const ext = path.extname(originalName).toLowerCase();
    if (ext !== '.txt' && ext !== '.pdf') {
        throw new Error(`Formato '${ext}' no soportado. Solo .txt o .pdf permitidos.`);
    }

    const bookDir = path.join(UPLOADS_ROOT, 'leo_context', contentId);
    const sourcesDir = path.join(bookDir, 'sources');

    if (!fs.existsSync(bookDir)) fs.mkdirSync(bookDir, { recursive: true });
    if (!fs.existsSync(sourcesDir)) fs.mkdirSync(sourcesDir, { recursive: true });

    // Move source file safely
    const sourcePath = path.join(sourcesDir, `${documentType}${ext}`);
    fs.copyFileSync(tempFilePath, sourcePath);

    // Extract Text
    let rawText = '';
    try {
        if (ext === '.pdf') {
            const dataBuffer = fs.readFileSync(sourcePath);
            const data = await pdfParse(dataBuffer);
            rawText = data.text;
        } else {
            rawText = fs.readFileSync(sourcePath, 'utf8');
        }
    } catch (extractErr) {
        throw new Error('Error al extraer texto del archivo: ' + extractErr.message);
    }

    // Clean text
    const cleanText = rawText.replace(/\0/g, '').replace(/\n{3,}/g, '\n\n').trim();
    if (!cleanText) {
        throw new Error('El archivo extraído no contiene texto válido.');
    }

    // Determine JSON Shape
    let jsonContent = {};

    switch (documentType) {
        case 'author_bio':
            jsonContent = { author: "Importado", bio: cleanText };
            break;
        case 'historical_context':
            jsonContent = { context: cleanText };
            break;
        case 'literary_notes':
            jsonContent = { notes: cleanText };
            break;
        case 'update_article':
            jsonContent = { article: cleanText };
            break;
        case 'pedagogical_guide':
            jsonContent = { "0": { objective: "Guía General Importada", content: cleanText } };
            break;
        case 'vocabulary_notes':
            jsonContent = { "0": [{ word: "Glosario Importado", meaning: cleanText }] };
            break;
    }

    const jsonFileName = documentType + '.json';
    const finalJsonPath = path.join(bookDir, jsonFileName);
    const tempJsonPath = finalJsonPath + '.tmp';
    const backupJsonPath = finalJsonPath + '.bak';

    try {
        if (fs.existsSync(finalJsonPath)) {
            fs.copyFileSync(finalJsonPath, backupJsonPath);
        }
        
        fs.writeFileSync(tempJsonPath, JSON.stringify(jsonContent, null, 2), 'utf8');
        fs.renameSync(tempJsonPath, finalJsonPath);
    } catch (writeErr) {
        // Rollback on write fail
        if (fs.existsSync(backupJsonPath) && fs.existsSync(finalJsonPath) === false) {
             fs.renameSync(backupJsonPath, finalJsonPath);
        }
        throw new Error('Fallo atómico al guardar JSON: ' + writeErr.message);
    }

    // Clean up tmp backup if succeeded
    if (fs.existsSync(backupJsonPath)) {
        try { fs.unlinkSync(backupJsonPath); } catch (e) {}
    }

    return { 
        success: true, 
        message: 'Archivo ingerido y convertido con éxito',
        jsonFile: jsonFileName,
        sourceFile: `${documentType}${ext}` 
    };
};
