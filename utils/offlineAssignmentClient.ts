/**
 * offlineAssignmentClient.ts — Cliente HTTP del nuevo backend offline-assignment.
 *
 * Reemplaza la lógica anterior basada en localStorage (offlineTextCache.ts) como
 * fuente de verdad. El localStorage queda intacto para no romper VisorTexto.tsx
 * (que aún lo usa como cache de lectura web), pero el botón "Disponible sin conexión"
 * ahora consulta y escribe al backend.
 *
 * Endpoints backend (Fase 2):
 *   GET    /api/offline/assignment        → consultar libro asignado al usuario actual
 *   POST   /api/offline/assignment        → asignar contentId (reemplaza el anterior si difiere)
 *   DELETE /api/offline/assignment        → eliminar assignment
 *
 * Auth: x-user-id header (mismo patrón que dataService.adminWriteHeaders).
 *       Sin sesión → backend devuelve 401, este cliente lo expone como error.
 *
 * Diseño:
 *   - Stateless. No cachea. La verdad vive en backend.
 *   - Errores tipados (union discriminado) para que el caller decida UX por reason.
 *   - No depende de OfflineContext, offlineService, offlineTextCache, IndexedDB
 *     ni localStorage. Cero acoplamiento al sistema offline antiguo.
 */

import { dataService } from '../services/dataService';

// ── Types ────────────────────────────────────────────────────────────────

export interface OfflineAssignmentBook {
    id: string;
    title: string | null;
    author: string | null;
    coverUrl: string | null;
    summary: string | null;
    authorBio: string | null;
    textoPlanoUrl: string | null;
}

export interface OfflineAssignmentProgress {
    percentage: number | null;
    updatedAt: string;
    isCompleted: boolean;
    canonicalProgress: Record<string, unknown>;
}

export interface OfflineAssignment {
    contentId: string;
    version: number;
    assignedAt: string;
    updatedAt: string;
    book: OfflineAssignmentBook | null;
    progress: OfflineAssignmentProgress | null;
}

/** Sin assignment activo. Backend devuelve `{"assignment": null}`. */
export interface NoAssignment {
    assignment: null;
}

export type AssignmentGetResponse = OfflineAssignment | NoAssignment;

export type AssignmentErrorReason =
    | 'unauthenticated'        // 401 — sin x-user-id o sesión inválida
    | 'forbidden_user'         // 403 — cuenta inactiva o no encontrada
    | 'forbidden_content'      // 403 — sin acceso al libro
    | 'content_not_found'      // 404 — contentId inexistente
    | 'invalid_body'           // 400 — body no pasa validación Zod
    | 'network'                // sin red
    | 'server'                 // 5xx
    | 'unknown';

export class OfflineAssignmentError extends Error {
    constructor(
        public readonly reason: AssignmentErrorReason,
        public readonly status: number,
        public readonly serverMessage?: string
    ) {
        super(`[offline-assignment] ${reason} (HTTP ${status})${serverMessage ? ` — ${serverMessage}` : ''}`);
        this.name = 'OfflineAssignmentError';
    }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function buildHeaders(includeContentType = false): Record<string, string> {
    const userId = dataService.getSessionUserId();
    const headers: Record<string, string> = {};
    if (userId) headers['x-user-id'] = userId;
    if (includeContentType) headers['Content-Type'] = 'application/json';
    return headers;
}

function endpoint(): string {
    return `${dataService.apiUrl}/offline/assignment`;
}

async function parseError(response: Response): Promise<OfflineAssignmentError> {
    let body: any = null;
    try { body = await response.json(); } catch { /* ignore */ }

    const serverReason: string | undefined = body?.reason || body?.error;
    const reason: AssignmentErrorReason = (() => {
        if (response.status === 401) return 'unauthenticated';
        if (response.status === 404) return 'content_not_found';
        if (response.status === 400) return 'invalid_body';
        if (response.status === 403) {
            // Backend distingue:
            //   - usuario inactivo / no encontrado → mensaje "Acceso denegado: ..."
            //   - sin acceso al contenido          → reason: 'no_access' o similar
            if (body?.reason && body.reason !== 'content_not_found') return 'forbidden_content';
            return 'forbidden_user';
        }
        if (response.status >= 500) return 'server';
        return 'unknown';
    })();

    return new OfflineAssignmentError(reason, response.status, serverReason);
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Consulta el libro offline asignado al usuario autenticado.
 * Si no hay sesión, lanza OfflineAssignmentError con reason='unauthenticated'.
 *
 * @returns assignment activo, o `{ assignment: null }` si el usuario no tiene ninguno.
 * @throws OfflineAssignmentError en 4xx/5xx o fallo de red.
 */
export async function getOfflineAssignment(): Promise<AssignmentGetResponse> {
    let response: Response;
    try {
        response = await fetch(endpoint(), { headers: buildHeaders(false) });
    } catch (e) {
        throw new OfflineAssignmentError('network', 0, (e as Error).message);
    }
    if (!response.ok) throw await parseError(response);

    const data = await response.json();
    return data;
}

/**
 * Asigna `contentId` como libro offline del usuario autenticado.
 * Si el usuario tenía otro libro distinto, lo reemplaza atómicamente en backend.
 * Si tenía el mismo libro, es idempotente (no rompe progress, no bumpea version).
 *
 * @throws OfflineAssignmentError con reason:
 *   - 'unauthenticated'    → sesión inválida
 *   - 'forbidden_user'     → cuenta inactiva
 *   - 'forbidden_content'  → el usuario no tiene acceso a este libro
 *   - 'content_not_found'  → contentId no existe en el catálogo
 *   - 'invalid_body'       → contentId vacío o body malformado
 */
export async function assignOfflineBook(contentId: string): Promise<OfflineAssignment> {
    if (!contentId || !contentId.trim()) {
        throw new OfflineAssignmentError('invalid_body', 0, 'contentId vacío');
    }

    let response: Response;
    try {
        response = await fetch(endpoint(), {
            method: 'POST',
            headers: buildHeaders(true),
            body: JSON.stringify({ contentId }),
        });
    } catch (e) {
        throw new OfflineAssignmentError('network', 0, (e as Error).message);
    }
    if (!response.ok) throw await parseError(response);

    return response.json();
}

/**
 * Elimina el libro offline asignado al usuario.
 * Idempotente: si no había nada, devuelve `{ assignment: null, removed: false }`.
 */
export async function deleteOfflineAssignment(): Promise<{ assignment: null; removed: boolean }> {
    let response: Response;
    try {
        response = await fetch(endpoint(), {
            method: 'DELETE',
            headers: buildHeaders(false),
        });
    } catch (e) {
        throw new OfflineAssignmentError('network', 0, (e as Error).message);
    }
    if (!response.ok) throw await parseError(response);

    return response.json();
}

/**
 * Guard: ¿la respuesta es un assignment activo o `null`?
 * Reemplaza el `entry?.contentId === id` pattern del viejo offlineTextCache.
 */
export function isActiveAssignment(resp: AssignmentGetResponse): resp is OfflineAssignment {
    return resp !== null && typeof resp === 'object' && 'contentId' in resp;
}
