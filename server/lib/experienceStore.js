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
    const versions = (Array.isArray(d.versions) ? d.versions : []).map(v => {
        // V4 REALIGN: compat trivial con el shape pre-módulos (version.nodes
        // plano) — datos solo de dev, se envuelven en un módulo único al leer.
        if (!Array.isArray(v.modules) && Array.isArray(v.nodes)) {
            const { nodes, ...rest } = v;
            return { ...rest, modules: [{ id: 'm1', title: 'Ruta', nodes }] };
        }
        return v;
    });
    return {
        experiences: Array.isArray(d.experiences) ? d.experiences : [],
        versions,
        runs: Array.isArray(d.runs) ? d.runs : [],
        evidence: Array.isArray(d.evidence) ? d.evidence : [],
    };
}

/** Secuencia global ordenada de nodos de una versión (módulos en orden). */
export function versionNodes(version) {
    return (version.modules ?? []).flatMap(m => m.nodes);
}

/** Módulo al que pertenece un nodo (contexto para UI/telemetría). */
export function moduleOfNode(version, nodeId) {
    return (version.modules ?? []).find(m => m.nodes.some(n => n.id === nodeId)) ?? null;
}

const nowIso = () => new Date().toISOString();
const rid = (p) => `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const err = (code, msg) => { const e = new Error(msg); e.code = code; return e; };

// ── Experiencia y versiones ─────────────────────────────────────────────────

export function createExperience(doc, { slug, title, description = '', imageUrl, durationLabel, audience }) {
    if (!slug || !/^[a-z0-9-]+$/.test(slug)) throw err('INVALID_SLUG', 'slug inválido (kebab-case)');
    if (!title || !String(title).trim()) throw err('INVALID_TITLE', 'title requerido');
    if (doc.experiences.some(e => e.slug === slug)) throw err('DUPLICATE_SLUG', `slug ya existe: ${slug}`);
    const exp = {
        id: rid('exp'), slug, title: String(title).trim(), description: String(description),
        // V4 RUNTIME-01 — únicos campos añadidos, declarados por el UX freeze:
        ...(imageUrl ? { imageUrl: String(imageUrl) } : {}),
        ...(durationLabel ? { durationLabel: String(durationLabel) } : {}),
        ...(audience ? { audience: String(audience) } : {}),
        status: 'draft', currentVersionId: null, createdAt: nowIso(), updatedAt: nowIso(),
    };
    doc.experiences.push(exp);
    return exp;
}

/**
 * STUDIO-01 — Información general de la Experiencia (entidad, no versión).
 * El invariante de inmutabilidad del ADR aplica a objectives+modules de la
 * versión publicada; los metadatos descriptivos de la Experiencia se editan
 * aquí. Una archivada no se edita.
 */
export function updateExperience(doc, experienceId, { title, description, imageUrl, durationLabel, audience } = {}) {
    const exp = doc.experiences.find(e => e.id === experienceId);
    if (!exp) throw err('EXPERIENCE_NOT_FOUND', `experience no existe: ${experienceId}`);
    if (exp.status === 'archived') throw err('EXPERIENCE_ARCHIVED', 'una Experiencia archivada no se edita');
    if (title !== undefined) {
        if (!String(title).trim()) throw err('INVALID_TITLE', 'title requerido');
        exp.title = String(title).trim();
    }
    if (description !== undefined) exp.description = String(description);
    const opt = { imageUrl, durationLabel, audience };
    for (const k of Object.keys(opt)) {
        if (opt[k] === undefined) continue;
        if (opt[k] === null || String(opt[k]).trim() === '') delete exp[k];
        else exp[k] = String(opt[k]);
    }
    exp.updatedAt = nowIso();
    return exp;
}

/**
 * STUDIO-01 — Archivo NO destructivo (contrato §17.3): la Experiencia deja de
 * descubrirse e iniciarse (startRun exige status published), pero versiones,
 * runs, progreso y evidencia quedan INTACTOS y los runs activos pueden
 * terminar su recorrido (completeNode/submitEvidence no dependen del status
 * de la Experiencia). Sin unarchive en el MVP.
 */
export function archiveExperience(doc, experienceId) {
    const exp = doc.experiences.find(e => e.id === experienceId);
    if (!exp) throw err('EXPERIENCE_NOT_FOUND', `experience no existe: ${experienceId}`);
    if (exp.status === 'archived') throw err('ALREADY_ARCHIVED', 'ya está archivada');
    exp.status = 'archived';
    exp.archivedAt = nowIso();
    exp.updatedAt = nowIso();
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

/**
 * Valida y congela la estructura de módulos (V4). Acepta `modules[]` o, por
 * compat trivial, `nodes[]` planos (se envuelven en un módulo único).
 */
function buildModules({ modules, nodes }, bookExists) {
    let mods = modules;
    if (!Array.isArray(mods) || mods.length === 0) {
        if (!Array.isArray(nodes) || nodes.length === 0) throw err('INVALID_NODES', 'la versión exige módulos con nodos');
        mods = [{ id: 'm1', title: 'Ruta', nodes }];
    }
    const nodeIds = new Set();
    const modIds = new Set();
    let globalIdx = 0;
    return mods.map((m, mi) => {
        if (!m || !m.title || !String(m.title).trim()) throw err('INVALID_MODULE', `módulo ${mi}: title requerido`);
        if (!Array.isArray(m.nodes) || m.nodes.length === 0) throw err('INVALID_MODULE', `módulo ${mi}: exige nodos`);
        const id = m.id || `m${mi + 1}`;
        if (modIds.has(id)) throw err('INVALID_MODULE', `módulo ${mi}: id duplicado ${id}`);
        modIds.add(id);
        return {
            id,
            title: String(m.title).trim(),
            ...(m.description ? { description: String(m.description) } : {}),
            nodes: m.nodes.map((n) => {
                const v = validateNode(n, globalIdx++, bookExists);
                if (nodeIds.has(v.id)) throw err('INVALID_NODE', `nodo ${v.id}: id duplicado global`);
                nodeIds.add(v.id);
                return v;
            }),
        };
    });
}

export function createDraftVersion(doc, experienceId, { objectives = [], nodes, modules }, bookExists) {
    const exp = doc.experiences.find(e => e.id === experienceId);
    if (!exp) throw err('EXPERIENCE_NOT_FOUND', `experience no existe: ${experienceId}`);
    if (exp.status === 'archived') throw err('EXPERIENCE_ARCHIVED', 'una Experiencia archivada no recibe versiones nuevas');
    const frozenModules = buildModules({ modules, nodes }, bookExists);
    const maxV = Math.max(0, ...doc.versions.filter(v => v.experienceId === experienceId).map(v => v.version));
    const version = {
        id: rid('expv'), experienceId, version: maxV + 1, status: 'draft',
        objectives: objectives.map(String), modules: frozenModules, createdAt: nowIso(),
    };
    doc.versions.push(version);
    return version;
}

export function updateDraftVersion(doc, versionId, { objectives, nodes, modules }, bookExists) {
    const v = doc.versions.find(x => x.id === versionId);
    if (!v) throw err('VERSION_NOT_FOUND', `versión no existe: ${versionId}`);
    if (v.status !== 'draft') throw err('VERSION_IMMUTABLE', 'una versión publicada es INMUTABLE (crea una versión nueva)');
    if (objectives !== undefined) v.objectives = objectives.map(String);
    if (nodes !== undefined || modules !== undefined) {
        v.modules = buildModules({ modules, nodes }, bookExists);
    }
    return v;
}

export function publishVersion(doc, versionId) {
    const v = doc.versions.find(x => x.id === versionId);
    if (!v) throw err('VERSION_NOT_FOUND', `versión no existe: ${versionId}`);
    if (v.status !== 'draft') throw err('VERSION_IMMUTABLE', 'solo un draft puede publicarse');
    const owner = doc.experiences.find(e => e.id === v.experienceId);
    if (owner?.status === 'archived') throw err('EXPERIENCE_ARCHIVED', 'una Experiencia archivada no publica versiones');
    v.status = 'published';
    v.publishedAt = nowIso();
    v.modules.forEach(m => { Object.freeze(m.nodes.map(n => Object.freeze(n))); Object.freeze(m); });
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
    const required = versionNodes(v).filter(n => n.required);
    const done = required.filter(n => run.nodeStates[n.id]?.status === 'completed');
    return { completedRequired: done.length, totalRequired: required.length, completed: done.length === required.length };
}

/** Estado DERIVADO de un módulo (V4) — jamás persistido. */
export function moduleState(module, run) {
    const req = module.nodes.filter(n => n.required);
    const anyDone = module.nodes.some(n => run.nodeStates[n.id]?.status === 'completed');
    const allReqDone = req.length > 0
        ? req.every(n => run.nodeStates[n.id]?.status === 'completed')
        : anyDone;
    if (allReqDone && anyDone) return 'COMPLETED';
    if (anyDone) return 'IN_PROGRESS';
    return 'NOT_STARTED';
}

function nodeAvailable(v, run, nodeId) {
    const flat = versionNodes(v);
    const idx = flat.findIndex(n => n.id === nodeId);
    if (idx === -1) return false;
    return flat.slice(0, idx).every(n => !n.required || run.nodeStates[n.id]?.status === 'completed');
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
    const node = versionNodes(v).find(n => n.id === nodeId);
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
    const node = versionNodes(v).find(n => n.id === nodeId);
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
            return {
                id: e.id, slug: e.slug, title: e.title, description: e.description,
                imageUrl: e.imageUrl ?? null,
                durationLabel: e.durationLabel ?? null,
                audience: e.audience ?? null,
                version: v?.version ?? null,
                nodeCount: v ? versionNodes(v).length : 0,
                moduleCount: v?.modules?.length ?? 0,
                moduleTitles: (v?.modules ?? []).map(m => m.title),
                nodeTypes: v ? [...new Set(versionNodes(v).map(n => n.type))] : [],
                hasProduction: v ? versionNodes(v).some(n => n.type === 'PRODUCTION') : false,
            };
        });
}

/** Resumen del run del usuario para descubrimiento/landing (derivado, sin persistir nada). */
function myRunSummary(doc, userId, experienceId) {
    const run = doc.runs.find(r => r.userId === userId && r.experienceId === experienceId && r.status !== 'abandoned');
    if (!run) return null;
    const v = doc.versions.find(x => x.id === run.experienceVersionId);
    return {
        runId: run.id,
        status: run.status,
        progress: runProgress(doc, run),
        moduleStates: (v?.modules ?? []).map(m => ({ id: m.id, title: m.title, state: moduleState(m, run) })),
    };
}

/** Listado publicado + `myRun` del usuario (declarado por CHP-MOOK-PRODUCT-UX-01). */
export function listPublishedFor(doc, userId) {
    return listPublished(doc).map(e => ({ ...e, myRun: myRunSummary(doc, userId, e.id) }));
}

/** Detalle para la landing: comprender ANTES de iniciar (no crea run). */
export function experienceDetail(doc, experienceId, userId) {
    const e = doc.experiences.find(x => x.id === experienceId && x.status === 'published' && x.currentVersionId);
    if (!e) throw err('NOT_PUBLISHED', 'la Experiencia no está publicada');
    const v = doc.versions.find(x => x.id === e.currentVersionId);
    return {
        id: e.id, slug: e.slug, title: e.title, description: e.description,
        imageUrl: e.imageUrl ?? null, durationLabel: e.durationLabel ?? null, audience: e.audience ?? null,
        version: v.version,
        objectives: v.objectives,
        modules: v.modules.map(m => ({ id: m.id, title: m.title, nodeCount: m.nodes.length, nodeTypes: [...new Set(m.nodes.map(n => n.type))] })),
        nodeTypes: [...new Set(versionNodes(v).map(n => n.type))],
        hasProduction: versionNodes(v).some(n => n.type === 'PRODUCTION'),
        myRun: myRunSummary(doc, userId, e.id),
    };
}

/**
 * STUDIO-01 — Listado de autoría (todas las Experiencias, con estado y
 * resumen de versiones). Solo proyección; no muta nada.
 */
export function adminListExperiences(doc) {
    return doc.experiences.map(e => {
        const versions = doc.versions
            .filter(v => v.experienceId === e.id)
            .sort((a, b) => a.version - b.version);
        const lastDraft = [...versions].reverse().find(v => v.status === 'draft') ?? null;
        const published = [...versions].reverse().find(v => v.status === 'published') ?? null;
        return {
            id: e.id, slug: e.slug, title: e.title, description: e.description,
            status: e.status,
            imageUrl: e.imageUrl ?? null, durationLabel: e.durationLabel ?? null, audience: e.audience ?? null,
            latestVersion: versions.at(-1)?.version ?? 0,
            publishedVersion: published?.version ?? null,
            draftVersionId: lastDraft?.id ?? null,
            draftVersion: lastDraft?.version ?? null,
            updatedAt: e.updatedAt,
        };
    });
}

/** STUDIO-01 — Detalle de autoría: Experiencia + versiones completas (modules). */
export function adminExperienceDetail(doc, experienceId) {
    const e = doc.experiences.find(x => x.id === experienceId);
    if (!e) throw err('EXPERIENCE_NOT_FOUND', `experience no existe: ${experienceId}`);
    const versions = doc.versions
        .filter(v => v.experienceId === experienceId)
        .sort((a, b) => a.version - b.version)
        .map(v => ({
            id: v.id, version: v.version, status: v.status,
            objectives: v.objectives, modules: v.modules,
            publishedAt: v.publishedAt ?? null, createdAt: v.createdAt,
        }));
    return {
        id: e.id, slug: e.slug, title: e.title, description: e.description,
        status: e.status,
        imageUrl: e.imageUrl ?? null, durationLabel: e.durationLabel ?? null, audience: e.audience ?? null,
        currentVersionId: e.currentVersionId, updatedAt: e.updatedAt,
        versions,
    };
}

export function computeRouteView(doc, run, contentList) {
    const v = versionOfRun(doc, run);
    const byId = new Map((contentList || []).map(c => [c.id, c]));
    const progress = runProgress(doc, run);
    let currentAssigned = false;
    const projectNode = (n) => {
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
    };
    // V4: la ruta se agrupa por módulos con estado DERIVADO; se conserva la
    // lista plana como conveniencia (misma secuencia global).
    const modules = v.modules.map(m => ({
        id: m.id,
        title: m.title,
        ...(m.description ? { description: m.description } : {}),
        state: moduleState(m, run),
        nodes: m.nodes.map(projectNode),
    }));
    const nodes = modules.flatMap(m => m.nodes);
    return {
        runId: run.id, experienceId: run.experienceId, experienceVersionId: run.experienceVersionId,
        status: run.status, progress, modules, nodes,
    };
}
