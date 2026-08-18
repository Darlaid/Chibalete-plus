/**
 * experienceStore.js — CHP-MOOK-01 (contrato: docs/adr/CHP_ADR_MOOK.md).
 *
 * Dominio PURO de Experiencias/MOOK. Sin I/O (el server persiste con sus
 * helpers canónicos; los tests operan sobre objetos planos).
 *
 * Invariantes del ADR que este módulo garantiza:
 *  - Los nodos viven EMBEBIDOS en la versión y quedan INMUTABLES al publicar.
 *  - Un Run fija experienceVersionId al iniciarse y nunca cambia de versión.
 *  - El contenido canónico se REFERENCIA por contentId — aquí no se copia
 *    metadata, archivo, entitlement ni progreso de lectura.
 *  - ExperienceEvidence SOLO para envíos del usuario (ACTIVITY/PRODUCTION);
 *    la evidencia Leo vive en su store canónico y se referencia por id.
 *  - El progreso se DERIVA de nodos requeridos completados (no es un
 *    porcentaje mutable independiente).
 *  - Este módulo NO conoce el access engine ni concede acceso a nada.
 */

export const NODE_TYPES = Object.freeze(['READING', 'VIDEO', 'AUDIO', 'LEO', 'ACTIVITY', 'PRODUCTION']);

export function emptyMookStore() {
    return { experiences: [], versions: [], runs: [], evidence: [] };
}

export function normalizeMookStore(raw) {
    const d = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    return {
        experiences: Array.isArray(d.experiences) ? d.experiences : [],
        versions: Array.isArray(d.versions) ? d.versions : [],
        runs: Array.isArray(d.runs) ? d.runs : [],
        evidence: Array.isArray(d.evidence) ? d.evidence : [],
    };
}

const nowIso = () => new Date().toISOString();
const rid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const err = (code, msg) => { const e = new Error(msg); e.code = code; return e; };

// ── Experiencia y versiones ─────────────────────────────────────────────────

export function createExperience(doc, { slug, title, description = '' }) {
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw err('INVALID_SLUG', 'slug inválido (kebab-case)');
    if (!title || !String(title).trim()) throw err('INVALID_TITLE', 'title requerido');
    if (doc.experiences.some(e => e.slug === slug)) throw err('DUPLICATE_SLUG', `slug ya existe: ${slug}`);
    const exp = {
        id: rid('exp'), slug, title: String(title).trim(), description: String(description),
        status: 'draft', currentVersionId: null, createdAt: nowIso(), updatedAt: nowIso(),
    };
    doc.experiences.push(exp);
    return exp;
}

function validateNode(node, i, bookExists) {
    if (!node || !NODE_TYPES.includes(node.type)) throw err('INVALID_NODE_TYPE', `nodo ${i}: type inválido`);
    if (!node.title || !String(node.title).trim()) throw err('INVALID_NODE', `nodo ${i}: title requerido`);
    const out = {
        id: node.id || `node-${i + 1}`,
        type: node.type,
        title: String(node.title).trim(),
        required: node.required !== false,
        resourceRef: node.resourceRef ?? null,
        config: node.config && typeof node.config === 'object' ? { ...node.config } : {},
    };
    if (['READING', 'VIDEO', 'AUDIO'].includes(out.type)) {
        if (!out.resourceRef) throw err('INVALID_NODE', `nodo ${i}: ${out.type} exige resourceRef (contentId canónico)`);
        if (typeof bookExists === 'function' && !bookExists(out.resourceRef)) {
            throw err('RESOURCE_NOT_FOUND', `nodo ${i}: contentId no existe en el catálogo: ${out.resourceRef}`);
        }
    }
    if (out.type === 'LEO') {
        out.config.minIntercambios = Number.isFinite(out.config.minIntercambios) ? out.config.minIntercambios : 3;
        if (!out.config.objetivo) throw err('INVALID_NODE', `nodo ${i}: LEO exige config.objetivo`);
    }
    if (out.type === 'ACTIVITY') {
        if (!Array.isArray(out.config.preguntas) || out.config.preguntas.length === 0) {
            throw err('INVALID_NODE', `nodo ${i}: ACTIVITY exige config.preguntas`);
        }
    }
    if (out.type === 'PRODUCTION') {
        if (!out.config.consigna) throw err('INVALID_NODE', `nodo ${i}: PRODUCTION exige config.consigna`);
        out.config.minPalabras = Number.isFinite(out.config.minPalabras) ? out.config.minPalabras : 150;
        out.config.maxPalabras = Number.isFinite(out.config.maxPalabras) ? out.config.maxPalabras : 300;
    }
    return out;
}

export function createDraftVersion(doc, experienceId, { objectives = [], nodes = [] }, bookExists) {
    const exp = doc.experiences.find(e => e.id === experienceId);
    if (!exp) throw err('EXPERIENCE_NOT_FOUND', `experience no existe: ${experienceId}`);
    if (!Array.isArray(nodes) || nodes.length === 0) throw err('INVALID_NODES', 'la versión exige nodos');
    const ids = new Set();
    const frozenNodes = nodes.map((n, i) => {
        const v = validateNode(n, i, bookExists);
        if (ids.has(v.id)) throw err('INVALID_NODE', `nodo ${i}: id duplicado ${v.id}`);
        ids.add(v.id);
        return v;
    });
    const maxV = Math.max(0, ...doc.versions.filter(v => v.experienceId === experienceId).map(v => v.version));
    const version = {
        id: rid('expv'), experienceId, version: maxV + 1, status: 'draft',
        objectives: objectives.map(String), nodes: frozenNodes, createdAt: nowIso(),
    };
    doc.versions.push(version);
    return version;
}

export function updateDraftVersion(doc, versionId, { objectives, nodes }, bookExists) {
    const v = doc.versions.find(x => x.id === versionId);
    if (!v) throw err('VERSION_NOT_FOUND', `versión no existe: ${versionId}`);
    if (v.status !== 'draft') throw err('VERSION_IMMUTABLE', 'una versión publicada es INMUTABLE (crea una versión nueva)');
    if (objectives !== undefined) v.objectives = objectives.map(String);
    if (nodes !== undefined) {
        const ids = new Set();
        v.nodes = nodes.map((n, i) => {
            const out = validateNode(n, i, bookExists);
            if (ids.has(out.id)) throw err('INVALID_NODE', `nodo ${i}: id duplicado`);
            ids.add(out.id);
            return out;
        });
    }
    return v;
}

export function publishVersion(doc, versionId) {
    const v = doc.versions.find(x => x.id === versionId);
    if (!v) throw err('VERSION_NOT_FOUND', `versión no existe: ${versionId}`);
    if (v.status !== 'draft') throw err('VERSION_IMMUTABLE', 'solo un draft puede publicarse');
    v.status = 'published';
    v.publishedAt = nowIso();
    Object.freeze(v.nodes.map(n => Object.freeze(n)));
    const exp = doc.experiences.find(e => e.id === v.experienceId);
    exp.currentVersionId = v.id;
    exp.status = 'published';
    exp.updatedAt = nowIso();
    return v;
}

// ── Runs ────────────────────────────────────────────────────────────────────

export function startRun(doc, { userId, experienceId }) {
    if (!userId) throw err('INVALID_ACTOR', 'userId (derivado de sesión) requerido');
    const exp = doc.experiences.find(e => e.id === experienceId && e.status === 'published');
    if (!exp || !exp.currentVersionId) throw err('NOT_PUBLISHED', 'la Experiencia no está publicada');
    const existing = doc.runs.find(r => r.userId === userId && r.experienceId === experienceId && r.status !== 'abandoned');
    if (existing) return { run: existing, created: false };
    const run = {
        id: rid('run'), userId, experienceId,
        experienceVersionId: exp.currentVersionId,     // PIN inmutable
        status: 'active', currentNodeIndex: 0,
        nodeStates: {}, startedAt: nowIso(), completedAt: null,
    };
    doc.runs.push(run);
    return { run, created: true };
}

function versionOfRun(doc, run) {
    return doc.versions.find(v => v.id === run.experienceVersionId);
}

export function runProgress(doc, run) {
    const v = versionOfRun(doc, run);
    const required = v.nodes.filter(n => n.required);
    const done = required.filter(n => run.nodeStates[n.id]?.status === 'completed');
    return { completedRequired: done.length, totalRequired: required.length, completed: done.length === required.length };
}

function nodeAvailable(v, run, nodeId) {
    const idx = v.nodes.findIndex(n => n.id === nodeId);
    if (idx === -1) return false;
    return v.nodes.slice(0, idx).every(n => !n.required || run.nodeStates[n.id]?.status === 'completed');
}

/**
 * Completa un nodo. Para LEO, `leoInterchanges` DEBE venir contado por el
 * SERVIDOR (store de interacciones Leo) — jamás del cliente.
 * ACTIVITY/PRODUCTION se completan vía submitEvidence, no por aquí.
 */
export function completeNode(doc, runId, nodeId, { leoInterchanges } = {}) {
    const run = doc.runs.find(r => r.id === runId);
    if (!run) throw err('RUN_NOT_FOUND', `run no existe: ${runId}`);
    if (run.status === 'completed') return { run, progress: runProgress(doc, run) };
    const v = versionOfRun(doc, run);
    const node = v.nodes.find(n => n.id === nodeId);
    if (!node) throw err('NODE_NOT_FOUND', `nodo no existe en la versión: ${nodeId}`);
    if (!nodeAvailable(v, run, nodeId)) throw err('NODE_LOCKED', 'nodo bloqueado: completa los requeridos anteriores');
    if (['ACTIVITY', 'PRODUCTION'].includes(node.type)) {
        throw err('NODE_NEEDS_EVIDENCE', `${node.type} se completa enviando la evidencia`);
    }
    if (node.type === 'LEO' && (leoInterchanges ?? 0) < node.config.minIntercambios) {
        throw err('LEO_MIN_INTERCHANGES', `el nodo LEO exige ≥${node.config.minIntercambios} intercambios (lleva ${leoInterchanges ?? 0})`);
    }
    run.nodeStates[nodeId] = { ...(run.nodeStates[nodeId] || {}), status: 'completed', completedAt: nowIso(), evidenceIds: run.nodeStates[nodeId]?.evidenceIds ?? [] };
    return finalize(doc, run);
}

function finalize(doc, run) {
    const progress = runProgress(doc, run);
    if (progress.completed && run.status !== 'completed') {
        run.status = 'completed';
        run.completedAt = nowIso();
    }
    return { run, progress };
}

// ── Evidencia (SOLO envíos ACTIVITY/PRODUCTION) ─────────────────────────────

const countWords = (t) => String(t || '').trim().split(/\s+/).filter(Boolean).length;

export function submitEvidence(doc, { runId, nodeId, userId, payload }) {
    const run = doc.runs.find(r => r.id === runId);
    if (!run) throw err('RUN_NOT_FOUND', `run no existe: ${runId}`);
    if (run.userId !== userId) throw err('NOT_RUN_OWNER', 'la evidencia solo puede enviarla el dueño del run');
    const v = versionOfRun(doc, run);
    const node = v.nodes.find(n => n.id === nodeId);
    if (!node) throw err('NODE_NOT_FOUND', `nodo no existe: ${nodeId}`);
    if (!['ACTIVITY', 'PRODUCTION'].includes(node.type)) throw err('NODE_NO_EVIDENCE', `${node.type} no recibe envíos`);
    if (!nodeAvailable(v, run, nodeId)) throw err('NODE_LOCKED', 'nodo bloqueado');

    if (node.type === 'ACTIVITY') {
        const answers = Array.isArray(payload?.answers) ? payload.answers.map(a => String(a ?? '').trim()) : [];
        if (answers.length !== node.config.preguntas.length || answers.some(a => !a)) {
            throw err('ACTIVITY_INCOMPLETE', `responde las ${node.config.preguntas.length} preguntas`);
        }
    }
    if (node.type === 'PRODUCTION') {
        const words = countWords(payload?.text);
        if (words < node.config.minPalabras || words > node.config.maxPalabras) {
            throw err('PRODUCTION_LENGTH', `la producción exige ${node.config.minPalabras}–${node.config.maxPalabras} palabras (lleva ${words})`);
        }
    }
    const ev = {
        id: rid('evid'), runId, userId,
        experienceId: run.experienceId, experienceVersionId: run.experienceVersionId, nodeId,
        nodeType: node.type, type: 'text',
        payload: node.type === 'ACTIVITY' ? { answers: payload.answers.map(String) } : { text: String(payload.text) },
        requiresReview: node.type === 'PRODUCTION',
        submittedAt: nowIso(),
        review: { status: 'SUBMITTED' },
    };
    doc.evidence.push(ev);
    run.nodeStates[nodeId] = { status: 'completed', completedAt: nowIso(), evidenceIds: [...(run.nodeStates[nodeId]?.evidenceIds ?? []), ev.id] };
    const { progress } = finalize(doc, run);
    return { evidence: ev, run, progress };
}

/** Referencia (jamás copia) evidencia Leo canónica desde el estado del nodo. */
export function attachLeoEvidenceRefs(doc, runId, nodeId, leoEvidenceIds) {
    const run = doc.runs.find(r => r.id === runId);
    if (!run) throw err('RUN_NOT_FOUND', `run no existe: ${runId}`);
    const st = run.nodeStates[nodeId] || { status: 'pending', evidenceIds: [] };
    st.evidenceIds = [...new Set([...(st.evidenceIds ?? []), ...leoEvidenceIds.map(String)])];
    run.nodeStates[nodeId] = st;
    return st;
}

export function reviewEvidence(doc, evidenceId, { reviewerId, decision, feedback = '' }) {
    const ev = doc.evidence.find(e => e.id === evidenceId);
    if (!ev) throw err('EVIDENCE_NOT_FOUND', `evidencia no existe: ${evidenceId}`);
    if (!ev.requiresReview) throw err('NOT_REVIEWABLE', 'esta evidencia no requiere revisión');
    if (ev.review.status === 'REVIEWED') throw err('ALREADY_REVIEWED', 'ya revisada');
    if (!['aprobado', 'con_comentarios'].includes(decision)) throw err('INVALID_DECISION', 'decision inválida');
    if (!reviewerId) throw err('INVALID_ACTOR', 'reviewerId (derivado de sesión) requerido');
    ev.review = { status: 'REVIEWED', reviewerId, decision, feedback: String(feedback), reviewedAt: nowIso() };
    return ev;
}

// ── Vistas (proyección; jamás copia metadata canónica a disco) ──────────────

export function listPublished(doc) {
    return doc.experiences
        .filter(e => e.status === 'published' && e.currentVersionId)
        .map(e => {
            const v = doc.versions.find(x => x.id === e.currentVersionId);
            return { id: e.id, slug: e.slug, title: e.title, description: e.description, version: v?.version ?? null, nodeCount: v?.nodes.length ?? 0 };
        });
}

export function computeRouteView(doc, run, contentList) {
    const v = versionOfRun(doc, run);
    const byId = new Map((contentList || []).map(c => [c.id, c]));
    const progress = runProgress(doc, run);
    let currentAssigned = false;
    const nodes = v.nodes.map(n => {
        const st = run.nodeStates[n.id];
        const available = nodeAvailable(v, run, n.id);
        let state = 'locked';
        if (st?.status === 'completed') state = 'completed';
        else if (available && !currentAssigned) { state = 'current'; currentAssigned = true; }
        else if (available) state = 'available';
        const book = n.resourceRef ? byId.get(n.resourceRef) : null;
        return {
            id: n.id, type: n.type, title: n.title, required: n.required, state,
            config: n.config,
            resource: book && book.status === 'disponible'
                ? { id: book.id, titulo: book.titulo, autor: book.autor, tipo: book.tipo, portada_url: book.portada_url }
                : null,
            evidenceIds: st?.evidenceIds ?? [],
        };
    });
    return {
        runId: run.id, experienceId: run.experienceId, experienceVersionId: run.experienceVersionId,
        status: run.status, progress, nodes,
    };
}
