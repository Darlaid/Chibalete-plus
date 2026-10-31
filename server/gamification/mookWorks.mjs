/**
 * mookWorks.mjs — CHP-GAMIFICACION-PRIV-01E.
 *
 * Vincula una evidencia MOOK con su obra. Contrato:
 * docs/gamificacion/GAMIFICACION_PRIV_01E_OBRAS_MOOK.md.
 *
 * La relación ya existe en MOOK: `resourceRef` de un nodo PRODUCTION, dentro de
 * la versión inmutable fijada por el run. No hay migración ni campo nuevo.
 *  - Obra: `contentId` canónico.
 *  - Actividad: `experienceVersionId:nodeId`.
 *  - Evidencia: `evidence.id`, la clave de idempotencia ya vigente.
 *  - Ciclo: NO se resuelve aquí. Lo calcula `decideRecognition` con el historial.
 *
 * Nunca lee `payload`, títulos, texto ni campos del cliente, ni deduce la obra
 * desde otros nodos. Ante cualquier duda no atribuye nada. Sin escrituras: los
 * documentos MOOK y el catálogo llegan como argumentos, y el ledger sigue sin
 * emitir por `mook_review`. Nada del producto llama a este módulo hasta G4-05.
 * `workRefOf` es `experienceStore.productionWorkRef`: se inyecta, como toda fuente
 * de este motor, y sin él no se atribuye nada.
 */
import { candidateEligibility, mookReviewCandidates } from './reconcile.mjs';

/**
 * Tipos que cuentan como obra mientras Editorial no decida otra cosa
 * (Modelo PRIV-01 §5.1). Colecciones, partes, guías, podcasts y artículos no.
 */
export const WORK_TIPOS = Object.freeze(['libro', 'libro_album', 'video']);

const versionNodes = (version) => (version.modules ?? []).flatMap((m) => m.nodes);

/** Motivo por el que un contenido no es una obra reconocible, o null. */
export function workBlock(content) {
    if (!content) return 'work_not_found';
    if (content.status !== 'disponible') return 'work_unavailable';
    if (content.isCollection === true) return 'work_is_collection';
    if (content.parentId) return 'work_is_part';
    if (content.standalone === false) return 'work_not_standalone';
    if (!WORK_TIPOS.includes(content.tipo)) return 'work_not_classified';
    return null;
}

/**
 * Cobertura de una versión. `multi` significa varias asociaciones, una por nodo:
 * cada evidencia sigue perteneciendo a una sola obra. Sin asociación es `general`.
 */
export function versionWorkCoverage(version, workRefOf) {
    const associations = versionNodes(version).filter((n) => n.type === 'PRODUCTION')
        .map((n) => ({ nodeId: n.id, ...workRefOf(version, n.id) }))
        .filter((a) => a.workRef !== null);
    const valid = new Set(associations.filter((a) => !a.issue).map((a) => a.workRef));
    return { coverage: valid.size === 0 ? 'general' : valid.size === 1 ? 'single' : 'multi', associations };
}

/** Evidencia, run, versión y nodo deben coincidir con lo fijado al iniciar el run. */
function boundContext(doc, evidence) {
    const run = doc?.runs?.find((r) => r.id === evidence?.runId);
    if (!run || run.userId !== evidence.userId || run.experienceId !== evidence.experienceId
        || run.experienceVersionId !== evidence.experienceVersionId) return null;
    const version = doc.versions?.find((v) => v.id === run.experienceVersionId);
    if (!version || version.experienceId !== run.experienceId) return null;
    const node = versionNodes(version).find((n) => n.id === evidence.nodeId);
    if (!node || node.type !== evidence.nodeType) return null;
    if (!run.nodeStates?.[node.id]?.evidenceIds?.includes(evidence.id)) return null;
    return { version, node };
}

/**
 * Obra de una evidencia, o ninguna con su motivo.
 * @param {object} doc  documento MOOK normalizado
 * @param {object} evidence
 * @param {{ catalog: Map<string, object>, canAccess: Function, workRefOf: Function, sinceMs: number }} opts
 *        `canAccess(userId, contentId)` es la decisión del servidor; solo `true` la concede.
 */
export function resolveEvidenceWork(doc, evidence, { catalog, canAccess, workRefOf, sinceMs } = {}) {
    const result = (reason, workRef = null, activityRef = null) => ({ evidenceId: evidence?.id ?? null, activityRef, workRef, reasons: reason ? [reason] : [] });
    if (evidence?.review?.status !== 'REVIEWED' || evidence.review.decision !== 'aprobado') return result('evidence_not_approved');
    const ctx = boundContext(doc, evidence);
    if (!ctx) return result('evidence_binding_mismatch');
    const { version, node } = ctx;
    const activityRef = `${version.id}:${node.id}`;
    if (!sinceMs) return result('no_activation_cutoff', null, activityRef);
    // Una versión anterior al corte es inmutable y nunca aceptó este contrato.
    if (version.status !== 'published' || !(Date.parse(version.publishedAt) >= sinceMs)) return result('version_predates_contract', null, activityRef);
    if (node.type !== 'PRODUCTION' || evidence.requiresReview !== true) return result('activity_not_comprehension', null, activityRef);
    if (typeof workRefOf !== 'function') return result('no_work_declared', null, activityRef);
    const { workRef, issue } = workRefOf(version, node.id);
    if (workRef === null) return result('no_work_declared', null, activityRef);
    if (issue) return result('work_not_in_version', null, activityRef);
    const blocked = workBlock(catalog?.get(workRef));
    if (blocked) return result(blocked, null, activityRef);
    let allowed = false;
    try { allowed = canAccess?.(evidence.userId, workRef) === true; } catch { allowed = false; }
    if (!allowed) return result('work_not_accessible', null, activityRef);
    return result(null, workRef, activityRef);
}

/**
 * Entradas para `decideRecognition`, desde el documento MOOK. Sujeto y actor
 * pasan los mismos filtros que la ingesta. Sin puerta de exclusiones no devuelve
 * nada. Los motivos son recuentos: ningún dato personal sale de aquí.
 * @returns {{ evidence: object[], unattributed: Record<string, number> }}
 */
export function mookRecognitionEvidence(doc, { catalog = [], canAccess, workRefOf, resolveUser, gate, sinceMs } = {}) {
    const out = { evidence: [], unattributed: {} };
    if (!sinceMs || typeof resolveUser !== 'function' || typeof gate?.excludes !== 'function') return out;
    const byId = new Map(catalog.map((c) => [c.id, c]));
    const docs = new Map((doc?.evidence ?? []).map((e) => [e.id, e]));
    const count = (reason) => { out.unattributed[reason] = (out.unattributed[reason] ?? 0) + 1; };
    for (const c of mookReviewCandidates(doc)) {
        if (c.occurredAt < sinceMs) continue;
        if (candidateEligibility(resolveUser, c) !== 'eligible') { count('subject_not_eligible'); continue; }
        if (gate.excludes(c.userId) || (c.actorId && gate.excludes(c.actorId))) { count('subject_excluded'); continue; }
        const { workRef, reasons } = resolveEvidenceWork(doc, docs.get(c.sourceEventId), { catalog: byId, canAccess, workRefOf, sinceMs });
        if (!workRef) { count(reasons[0]); continue; }
        out.evidence.push({ source: 'mook_review', evidenceId: c.sourceEventId, userId: c.userId, actorId: c.actorId,
            at: c.occurredAt, decision: 'aprobado', workRef });
    }
    return out;
}
