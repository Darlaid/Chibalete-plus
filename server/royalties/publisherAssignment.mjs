/**
 * publisherAssignment.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-B.
 *
 * Editorial responsable obligatoria por libro y su historial.
 *
 * - LIBRO = `tipo` libro o libro_album, en cualquier formato (PDF, TXT, EPUB,
 *   álbum). Incluye capítulos y colecciones de tipo libro: la obligación es de
 *   trazabilidad, más amplia que la liquidabilidad (`isEconomicContentType`).
 *   Guías, vídeos, podcasts y recursos pedagógicos —aunque lleguen en EPUB—
 *   conservan el comportamiento de F1-A.
 * - La decisión es pura (`resolvePublisherAssignment`); la existencia y el
 *   estado del titular los valida server.js contra `publishers`.
 * - Cada cambio efectivo se anota en `content_publisher_history` (solo
 *   inserciones) en la MISMA transacción que envuelve la escritura del
 *   catálogo: si content.json no se escribe, la fila no queda.
 * - La editorial responsable no acredita derechos económicos: la elegibilidad
 *   sigue en `rightsStore.eligibilityFor` (PUBLISHER_MISMATCH incluido).
 */
import { getRoyaltiesDb, PublisherError } from './publishersStore.mjs';
import { ulid } from '../ulid.js';

export const BOOK_CONTENT_TYPES = Object.freeze(['libro', 'libro_album']);

/** ¿La ficha es un libro sujeto a editorial obligatoria? */
export function isBookContent(record) {
    return !!record && typeof record === 'object' && BOOK_CONTENT_TYPES.includes(record.tipo);
}

const pidOrNull = (v) => (typeof v === 'string' && v ? v : null);

/**
 * Decide la editorial final de una ficha que se guarda.
 *   sent      ¿el cuerpo trae la clave publisherId?
 *   value     su valor ('' y null = quitar)
 *   next      la ficha que se va a guardar
 *   stored    la ficha vigente (null si es alta)
 *   confirmed el cliente confirmó expresamente la reasignación
 * Devuelve { publisherId, change } (change = null si no cambia) o lanza
 * PublisherError con el código del rechazo. Un libro lo es si lo es la ficha
 * nueva o la guardada: cambiar el tipo no sirve para retirar la editorial.
 */
export function resolvePublisherAssignment({ sent, value, next, stored, confirmed = false }) {
    const before = pidOrNull(stored?.publisherId);
    const after = sent ? pidOrNull(value) : before;
    const book = isBookContent(next) || isBookContent(stored);
    if (book && !after) {
        if (before) throw new PublisherError(400, 'publisher_removal_forbidden', 'Un libro no puede quedar sin editorial responsable; reasígnalo a otra editorial');
        throw new PublisherError(400, 'publisher_required', 'Todo libro debe tener una editorial responsable');
    }
    if (before && after && before !== after && confirmed !== true) {
        throw new PublisherError(409, 'publisher_reassign_unconfirmed', 'Cambiar la editorial responsable requiere confirmación expresa');
    }
    return { publisherId: after, change: before === after ? null : { from: before, to: after } };
}

/**
 * Ejecuta `writeContent` (la escritura de content.json) y anota el cambio en la
 * misma transacción de royalties.db: si `writeContent` lanza, no queda fila.
 */
export function recordPublisherChange({ contentId, change, actor, at = new Date().toISOString() }, writeContent, db = getRoyaltiesDb()) {
    const insert = db.prepare(`INSERT INTO content_publisher_history
        (id, content_id, from_publisher_id, to_publisher_id, actor, changed_at)
        VALUES (@id, @content_id, @from, @to, @actor, @changed_at)`);
    const row = { id: `cph-${ulid().toLowerCase()}`, content_id: contentId, from: change.from, to: change.to, actor: String(actor || 'unknown').slice(0, 128), changed_at: at };
    db.transaction(() => { insert.run(row); writeContent(); })();
    return { id: row.id, contentId, from: change.from, to: change.to, actor: row.actor, changedAt: at };
}

export function listPublisherHistory(contentId, db = getRoyaltiesDb()) {
    return db.prepare('SELECT * FROM content_publisher_history WHERE content_id = ? ORDER BY changed_at, id').all(contentId)
        .map((r) => ({ id: r.id, contentId: r.content_id, from: r.from_publisher_id, to: r.to_publisher_id, actor: r.actor, changedAt: r.changed_at }));
}

/** Filas del historial que mencionan al titular (como anterior o nuevo). */
export function countPublisherHistoryRefs(publisherId, db = getRoyaltiesDb()) {
    return db.prepare('SELECT COUNT(*) n FROM content_publisher_history WHERE from_publisher_id = ? OR to_publisher_id = ?').get(publisherId, publisherId).n;
}

/**
 * Editorial que figuraba en la ficha en el instante `at` (puro). `history` en
 * orden cronológico; sin filas, la vigente. Antes de la primera fila, la
 * `from` de esa fila: lo que había antes del historial (ver brechas F1-B §H:
 * las asignaciones previas a F1-B no tienen fila).
 */
export function publisherAt(history, currentPublisherId, at) {
    const t = at instanceof Date ? at.toISOString() : String(at);
    if (!Array.isArray(history) || history.length === 0) return pidOrNull(currentPublisherId);
    let pid = history[0].from ?? null;
    for (const h of history) {
        if (h.changedAt <= t) pid = h.to ?? null;
        else break;
    }
    return pid;
}

/** Censo de cumplimiento: libros sin editorial o con una editorial inexistente. */
export function publisherCompliance(contentList, publishers) {
    const known = new Map((publishers || []).map((p) => [p.id, p]));
    const out = { books: 0, booksWithPublisher: 0, nonBooks: 0, missing: [], unknown: [], byPublisher: {} };
    for (const c of contentList || []) {
        if (!c || typeof c !== 'object') continue;
        const pid = pidOrNull(c.publisherId);
        if (pid) {
            const slot = out.byPublisher[pid] || (out.byPublisher[pid] = { books: 0, contents: 0 });
            slot.contents++;
            if (isBookContent(c)) slot.books++;
        }
        if (!isBookContent(c)) { out.nonBooks++; continue; }
        out.books++;
        const brief = { id: c.id, titulo: c.titulo ?? null, tipo: c.tipo ?? null, publisherId: pid };
        if (!pid) out.missing.push(brief);
        else if (!known.has(pid)) out.unknown.push(brief);
        else out.booksWithPublisher++;
    }
    return out;
}
