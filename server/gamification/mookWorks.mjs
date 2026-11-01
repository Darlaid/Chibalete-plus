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
 * Acceso y elegibilidad de la obra no se vuelven a consultar: vale la decisión
 * congelada en la primera entrega (`evidence.workAccess`). Sin ella no hay
 * reconocimiento. Lo único posterior que bloquea es una retirada legal explícita
 * de la obra, que llega como `isWithdrawn`: sin esa respuesta no se atribuye.
 *
 * Nunca lee `payload`, títulos, texto ni campos del cliente, ni deduce la obra
 * desde otros nodos. Ante cualquier duda no atribuye nada. Sin escrituras: los
 * documentos MOOK llegan como argumentos, y el ledger sigue sin
 * emitir por `mook_review`. Nada del producto llama a este módulo hasta G4-05.
 * `workRefOf` es `experienceStore.productionWorkRef`: se inyecta, como toda fuente
 * de este motor, y sin él no se atribuye nada.
 */
import { candidateEligibility, mookReviewCandidates } from './reconcile.mjs';

/** La regla de obra vive en un módulo puro compartido con Studio. */
export { WORK_TIPOS, workBlock } from '../../utils/workEligibility.mjs';

const versionNodes = (version) => (version.modules ?? []).flatMap((m) => m.nodes);

/**
 * Procedencias que autorizan esta obra de forma explícita. `via` queda guardada
 * tal cual: ampliar esta lista no exige recalcular ninguna decisión.
 */
export const EXPLICIT_ACCESS_VIAS = Object.freeze(['SCOPE_TITLE', 'SCOPE_COLLECTION', 'GROUP_CATALOG', 'GROUP_ALL']);

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

/**
 * Primer elemento por id: con ids repetidos gana el primero, igual que `find`.
 * Tras una entrada nula un fallo de búsqueda vuelve a `find`, que decide como siempre.
 */
function firstById(items) {
    const byId = new Map();
    for (const item of items ?? []) {
        if (item == null) return { get: (id) => (byId.has(id) ? byId.get(id) : items.find((x) => x.id === id)) };
        if (!byId.has(item.id)) byId.set(item.id, item);
    }
    return byId;
}

/** Índices de un documento. Viven lo que dura una pasada: nunca se guardan entre barridos. */
const contextIndex = (doc) => ({ runs: firstById(doc?.runs), versions: firstById(doc?.versions) });

/** Evidencia, run, versión y nodo deben coincidir con lo fijado al iniciar el run. */
function boundContext(index, evidence) {
    const run = index.runs.get(evidence?.runId);
    if (!run || run.userId !== evidence.userId || run.experienceId !== evidence.experienceId
        || run.experienceVersionId !== evidence.experienceVersionId) return null;
    const version = index.versions.get(run.experienceVersionId);
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
 * @param {{ workRefOf: Function, isWithdrawn: Function, sinceMs: number }} opts
 *        `isWithdrawn(contentId)` debe responder `false` para atribuir.
 *        `index` evita recorrer el documento en cada llamada de una misma pasada.
 */
export function resolveEvidenceWork(doc, evidence, { workRefOf, isWithdrawn, sinceMs, index } = {}) {
    const result = (reason, workRef = null, activityRef = null) => ({ evidenceId: evidence?.id ?? null, activityRef, workRef, reasons: reason ? [reason] : [] });
    if (evidence?.review?.status !== 'REVIEWED' || evidence.review.decision !== 'aprobado') return result('evidence_not_approved');
    const ctx = boundContext(index ?? contextIndex(doc), evidence);
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
    const frozen = evidence.workAccess;
    if (!frozen) return result('no_access_snapshot', null, activityRef);
    if (frozen.workRef !== workRef) return result('access_snapshot_mismatch', null, activityRef);
    if (frozen.decision === 'indeterminate') return result('access_indeterminate', null, activityRef);
    if (frozen.decision !== 'allowed') return result('work_not_accessible', null, activityRef);
    if (!EXPLICIT_ACCESS_VIAS.includes(frozen.via)) return result('access_not_explicit', null, activityRef);
    let withdrawn = true;
    try { withdrawn = isWithdrawn?.(workRef) !== false; } catch { withdrawn = true; }
    if (withdrawn) return result('work_withdrawn', null, activityRef);
    return result(null, workRef, activityRef);
}

/**
 * Entradas para `decideRecognition`, desde el documento MOOK. Sujeto y actor
 * pasan los mismos filtros que la ingesta. Sin puerta de exclusiones no devuelve
 * nada. Los motivos son recuentos: ningún dato personal sale de aquí.
 * @returns {{ evidence: object[], unattributed: Record<string, number> }}
 */
export function mookRecognitionEvidence(doc, { workRefOf, isWithdrawn, resolveUser, gate, sinceMs } = {}) {
    const out = { evidence: [], unattributed: {} };
    if (!sinceMs || typeof resolveUser !== 'function' || typeof gate?.excludes !== 'function') return out;
    const docs = new Map((doc?.evidence ?? []).map((e) => [e.id, e]));
    const count = (reason) => { out.unattributed[reason] = (out.unattributed[reason] ?? 0) + 1; };
    let index = null;
    for (const c of mookReviewCandidates(doc)) {
        if (c.occurredAt < sinceMs) continue;
        if (candidateEligibility(resolveUser, c) !== 'eligible') { count('subject_not_eligible'); continue; }
        if (gate.excludes(c.userId) || (c.actorId && gate.excludes(c.actorId))) { count('subject_excluded'); continue; }
        index ??= contextIndex(doc);
        const { workRef, reasons } = resolveEvidenceWork(doc, docs.get(c.sourceEventId), { workRefOf, isWithdrawn, sinceMs, index });
        if (!workRef) { count(reasons[0]); continue; }
        out.evidence.push({ source: 'mook_review', evidenceId: c.sourceEventId, userId: c.userId, actorId: c.actorId,
            at: c.occurredAt, decision: 'aprobado', workRef });
    }
    return out;
}
