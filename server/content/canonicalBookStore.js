/**
 * canonicalBookStore.js — CHP-CONTENT-CANONICAL-2026-01 PARTE 2B.
 *
 * Persistencia del CanonicalBook como artefacto DERIVADO del TXT fuente:
 *
 *   /uploads/<contentId>/canonical/book.json
 *
 * - La fuente sigue siendo el .txt original (texto_plano_url). La rendición TXT
 *   no se persiste: se deriva con renderCanonicalBookToPlainText().
 * - Ruta FIJA por contentId, nunca elegida por el cliente. El Content la
 *   referencia en `canonicalBookUrl`, así que el autorizador de /uploads la
 *   clasifica por referencia igual que el .txt del mismo registro (nunca
 *   UNMAPPED_ASSET) y el borrado del contenido la elimina con /uploads/<id>/.
 * - El artefacto es autodescriptivo (schemaVersion, contentId,
 *   contentFingerprint) y determinista: mismo texto → mismos bytes. Sin fechas,
 *   URLs ni nombres de archivo.
 * - Escritura atómica: temporal en el mismo directorio → fsync → rename.
 */
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

import { computeContentFingerprint } from '../contentFingerprint.js';
import { CANONICAL_SCHEMA_VERSION, CanonicalBookError, validateCanonicalBook } from './canonicalBook.js';
import { importTxtToCanonicalBook } from './txtImporter.js';
import { renderCanonicalBookToPlainText } from './canonicalTxtRenderer.js';

export const CANONICAL_DIR_NAME = 'canonical';
export const CANONICAL_BOOK_FILENAME = 'book.json';

// Mismo criterio que el guard de DELETE /api/content/:id: un solo segmento
// seguro. Nada de '.', '/', '\', rutas absolutas ni traversal.
const SAFE_CONTENT_ID_RX = /^[A-Za-z0-9_-]{1,128}$/;

export const isSafeCanonicalContentId = (contentId) =>
    typeof contentId === 'string' && SAFE_CONTENT_ID_RX.test(contentId);

/** URL pública (/uploads/…) del artefacto de un Content. Lanza si el id no es seguro. */
export function canonicalBookUrlFor(contentId) {
    if (!isSafeCanonicalContentId(contentId)) {
        throw new CanonicalBookError('UNSAFE_CONTENT_ID', 'contentId no apto para una ruta de /uploads');
    }
    return `/uploads/${contentId}/${CANONICAL_DIR_NAME}/${CANONICAL_BOOK_FILENAME}`;
}

/** Ruta absoluta confinada a uploadDir. Lanza si el id no es seguro o escapa. */
export function canonicalBookPathFor(uploadDir, contentId) {
    canonicalBookUrlFor(contentId);
    const root = path.resolve(uploadDir);
    const target = path.resolve(root, contentId, CANONICAL_DIR_NAME, CANONICAL_BOOK_FILENAME);
    if (!target.startsWith(root + path.sep)) {
        throw new CanonicalBookError('UNSAFE_CONTENT_ID', 'la ruta canónica escapa de uploads');
    }
    return target;
}

/** Serialización determinista (el orden de claves lo fija el importador). */
export const serializeCanonicalBook = (book) => JSON.stringify(book) + '\n';

/**
 * TXT → CanonicalBook validado. Lanza CanonicalBookError si el importador falla,
 * si el libro no es válido o si su rendición TXT no conserva el fingerprint.
 */
export function buildCanonicalBookFromText({ contentId, text, contentFingerprint }) {
    const book = importTxtToCanonicalBook({ contentId, text, contentFingerprint });
    const problems = validateCanonicalBook(book);
    if (problems.length) {
        throw new CanonicalBookError('INVALID_BOOK', `CanonicalBook inválido: ${problems.slice(0, 3).join('; ')}`);
    }
    if (computeContentFingerprint(renderCanonicalBookToPlainText(book)) !== contentFingerprint) {
        throw new CanonicalBookError('RENDER_PARITY', 'la rendición TXT no conserva el fingerprint de la fuente');
    }
    return book;
}

/**
 * Publica el artefacto de forma atómica y devuelve los bytes que había antes
 * (o null) para poder deshacerlo si content.json no llega a escribirse.
 */
export function writeCanonicalBookAtomic(uploadDir, book) {
    const target = canonicalBookPathFor(uploadDir, book.contentId);
    let previous = null;
    try { previous = fs.readFileSync(target); } catch { /* no había artefacto */ }
    writeBytesAtomic(target, serializeCanonicalBook(book));
    return previous;
}

/** Deshace writeCanonicalBookAtomic: repone los bytes previos o retira el nuevo. */
export function restoreCanonicalBook(uploadDir, contentId, previousBytes) {
    const target = canonicalBookPathFor(uploadDir, contentId);
    if (previousBytes) writeBytesAtomic(target, previousBytes);
    else fs.rmSync(target, { force: true });
}

// Windows (solo desarrollo local) rechaza el rename sobre un archivo que otro
// proceso tiene abierto (EPERM/EACCES/EBUSY); el destino sigue intacto, así que
// reintentar no rompe la atomicidad. En Linux (producción) no ocurre.
const RENAME_RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
function renameWithRetry(from, to) {
    for (let attempt = 0; ; attempt++) {
        try { fs.renameSync(from, to); return; } catch (e) {
            if (process.platform !== 'win32' || !RENAME_RETRY_CODES.has(e.code) || attempt >= 20) throw e;
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
    }
}

function writeBytesAtomic(target, data) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`);
    let fd = null;
    try {
        fd = fs.openSync(tmp, 'wx');
        fs.writeFileSync(fd, data);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = null;
        renameWithRetry(tmp, target);
    } catch (e) {
        if (fd !== null) { try { fs.closeSync(fd); } catch { /* ya cerrado */ } }
        fs.rmSync(tmp, { force: true });
        throw e;
    }
    // Durabilidad del rename (POSIX). En Windows no se puede abrir un directorio.
    try {
        const dfd = fs.openSync(path.dirname(target), 'r');
        try { fs.fsyncSync(dfd); } finally { fs.closeSync(dfd); }
    } catch { /* best-effort */ }
}

/** Lee y parsea el artefacto persistido; null si falta o no es JSON. */
export function readPersistedCanonicalBook(uploadDir, contentId) {
    try {
        return JSON.parse(fs.readFileSync(canonicalBookPathFor(uploadDir, contentId), 'utf8'));
    } catch {
        return null;
    }
}

/**
 * Invariante Content ↔ artefacto. El CanonicalBook declarado está VIGENTE solo si
 *   content.contentFingerprint == content.canonicalFingerprint == book.contentFingerprint,
 * la URL es la del contentId, el schema es compatible y el libro es válido.
 */
export function isCanonicalBookCurrent(uploadDir, record) {
    if (!record || !isSafeCanonicalContentId(record.id)) return false;
    const fingerprint = record.contentFingerprint;
    if (!fingerprint || record.canonicalFingerprint !== fingerprint) return false;
    if (record.canonicalSchemaVersion !== CANONICAL_SCHEMA_VERSION) return false;
    if (record.canonicalBookUrl !== canonicalBookUrlFor(record.id)) return false;
    const book = readPersistedCanonicalBook(uploadDir, record.id);
    return !!book
        && book.schemaVersion === CANONICAL_SCHEMA_VERSION
        && book.contentId === record.id
        && book.contentFingerprint === fingerprint
        && validateCanonicalBook(book).length === 0;
}
