/**
 * mookReview01.test.mjs — CHP-MOOK-REVIEW-01.
 * Ciclo de revisión humana de producciones: estados, historial append-only,
 * aislamiento del participante, fail-closed de mediadores (estructural sobre
 * las rutas), eventos sin PII y vecindad intacta.
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    emptyMookStore, createExperience, createDraftVersion, publishVersion,
    startRun, completeNode, submitEvidence,
    addReviewFeedback, requestChanges, resubmitEvidence, reviewEvidence,
    participantEvidenceView, reviewListView, reviewDetailView, REVIEW_STATES,
} from '../lib/experienceStore.js';
import { validateEvent } from '../analytics/eventRegistry.js';

const CATALOG = [{ id: 'content-a', titulo: 'Libro A', autor: 'x', tipo: 'libro', status: 'disponible' }];
const bookExists = (id) => CATALOG.some(c => c.id === id);
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

function fixture() {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'rev', title: 'Revisable' });
    const v = createDraftVersion(doc, exp.id, {
        objectives: ['objetivo'],
        modules: [{
            id: 'm1', title: 'Uno', nodes: [
                { id: 'n1', type: 'ACTIVITY', title: 'Actividad', config: { preguntas: [{ texto: 'p1', tipo: 'text_short' }] } },
                { id: 'n2', type: 'PRODUCTION', title: 'Producir', config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 5, maxPalabras: 40 } },
            ],
        }],
    }, bookExists);
    publishVersion(doc, v.id);
    const { run } = startRun(doc, { userId: 'user-participante', experienceId: exp.id });
    submitEvidence(doc, { runId: run.id, nodeId: 'n1', userId: 'user-participante', payload: { answers: ['mi respuesta'] } });
    const { evidence } = submitEvidence(doc, { runId: run.id, nodeId: 'n2', userId: 'user-participante', payload: { text: words(10) } });
    return { doc, exp, run, evidence };
}

let passed = 0;
const t = (name, fn) => { fn(); passed += 1; console.log(`  ✓ ${name}`); };

// 1 — entrega crea SUBMITTED con historial y versión original
t('la entrega nace SUBMITTED con versions[0] e historial append-only', () => {
    const { evidence } = fixture();
    assert.equal(evidence.review.status, 'SUBMITTED');
    assert.equal(evidence.versions.length, 1);
    assert.deepEqual(evidence.history.map(h => h.type), ['submitted']);
    assert.deepEqual(REVIEW_STATES, ['SUBMITTED', 'REVISION_REQUESTED', 'RESUBMITTED', 'REVIEWED']);
});

// 2 — aparece en la bandeja autorizada con identificación mínima
t('la bandeja lista la producción con estado y nombre resuelto server-side', () => {
    const { doc, evidence } = fixture();
    const list = reviewListView(doc, (uid) => uid === 'user-participante' ? 'Nombre Legible' : null);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, evidence.id);
    assert.equal(list[0].status, 'SUBMITTED');
    assert.equal(list[0].participantName, 'Nombre Legible');
    assert.ok(!('userId' in list[0]), 'la bandeja no expone el userId crudo');
    assert.ok(!('text' in list[0]), 'la bandeja no expone el contenido (solo el detalle autorizado)');
});

// 3 — otro participante no puede tocarla; su vista es solo de SUS runs
t('el reenvío exige ser el dueño; la vista del participante no expone reviewerId', () => {
    const { doc, evidence } = fixture();
    requestChanges(doc, evidence.id, { reviewerId: 'admin-1', comment: 'ajusta el cierre' });
    assert.throws(() => resubmitEvidence(doc, evidence.id, { userId: 'user-intruso', text: words(10) }), (e) => e.code === 'NOT_EVIDENCE_OWNER');
    const view = participantEvidenceView(evidence);
    assert.equal(view.canResubmit, true);
    assert.ok(!JSON.stringify(view).includes('admin-1'), 'la proyección del participante no incluye reviewerId');
});


/**
 * CHP-CI-MOOK-RELEASE-GATES-01 — normalización de fin de línea.
 *
 * Solo unifica CRLF y CR sueltos a LF. NO recorta, NO colapsa espacios y NO
 * toca ninguna otra cosa: una línea de más, un espacio distinto o texto en otro
 * orden siguen siendo diferencias reales y deben seguir fallando.
 */
const normalizeEol = (s) => String(s).replace(/\r\n/g, '\n').replace(/\r/g, '\n');

/**
 * «El mediador jamás pasa», expresado como el invariante que de verdad importa.
 *
 * La versión anterior buscaba el literal `return true;\n    if (isMediatorRole`
 * y afirmaba que NO debía aparecer. Pero ese literal es exactamente la forma del
 * código CORRECTO —`if (admin) return true;` seguido del gate de mediador—, así
 * que la aserción solo pasaba porque en Windows el archivo tiene CRLF y el
 * patrón con `\n` no casaba. En cualquier clon Linux, donde el blob de git está
 * en LF, fallaba sobre código correcto.
 *
 * Lo que se comprueba ahora es el invariante real y es INDEPENDIENTE del fin de
 * línea: hay un único `return true`, es el del administrador, está ANTES del
 * gate de mediador, y la rama del mediador responde 403 y devuelve false.
 */
function assertMediatorNeverPasses(body) {
    const returnTrues = body.match(/return true;/g) ?? [];
    assert.strictEqual(returnTrues.length, 1, 'solo debe existir UN return true en el guard');

    const idxTrue = body.indexOf('return true;');
    const idxMediator = body.indexOf('isMediatorRole');
    assert.ok(idxTrue !== -1 && idxMediator !== -1, 'el guard debe contemplar admin y mediador');
    assert.ok(idxTrue < idxMediator, 'el único return true es el del admin, antes del gate de mediador');

    const mediatorBranch = body.slice(idxMediator);
    assert.ok(!mediatorBranch.includes('return true'), 'la rama del mediador jamás devuelve true');
    assert.ok(mediatorBranch.includes('MEDIATOR_SCOPE_GATED'), 'el mediador cae en el gate declarado');
    assert.ok(mediatorBranch.includes('return false;'), 'la rama del mediador devuelve false');
}

// 4 — mediador fail-closed (estructural: la ruta lo gatea, sin cola global)
const serverSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'server.js'), 'utf8');
t('estructural: mediador sin scope = 403 fail-closed; solo administrador opera la revisión', () => {
    assert.ok(serverSrc.includes('MEDIATOR_SCOPE_GATED'), 'código estructurado del gate M1-B');
    assert.ok(serverSrc.includes('function requireReviewAccess'), 'guard único de revisión');
    for (const route of ['/api/experiences/review/queue', '/api/experiences/review/:evidenceId/detail', '/api/experiences/review/:evidenceId/feedback', '/api/experiences/review/:evidenceId/request-changes']) {
        assert.ok(serverSrc.includes(route), `ruta ${route} presente`);
    }
    const guardBody = normalizeEol(serverSrc.slice(serverSrc.indexOf('function requireReviewAccess'), serverSrc.indexOf('function resolveParticipantName')));
    assert.ok(guardBody.includes(`roles.includes('administrador')`), 'admin explícito');
    assert.ok(guardBody.includes('isMediatorRole'), 'mediador contemplado y gateado');
    assertMediatorNeverPasses(guardBody);
    // el actor de las mutaciones se deriva de la sesión, no del cliente
    assert.ok(serverSrc.includes('reviewerId: req.user.id'), 'reviewer derivado de sesión');
    assert.ok(serverSrc.includes('userId: req.user.id, text: req.body?.text'), 'dueño del reenvío derivado de sesión');
});

// 5 — detalle completo para el revisor autorizado
t('el detalle trae contexto, entrega, historial y respuestas de actividad del run', () => {
    const { doc, evidence } = fixture();
    const d = reviewDetailView(doc, evidence.id, () => 'Nombre');
    assert.equal(d.experience, 'Revisable');
    assert.equal(d.consigna, 'c');
    assert.equal(d.criterioRevision, 'cr');
    assert.equal(d.versions.length, 1);
    assert.equal(d.activityContext.length, 1);
    assert.deepEqual(d.activityContext[0].answers, ['mi respuesta']);
    assert.equal(d.runStatus, 'completed');
});

// 6 — feedback atribuido y en historial
t('la retroalimentación queda atribuida al revisor con timestamp de servidor', () => {
    const { doc, evidence } = fixture();
    addReviewFeedback(doc, evidence.id, { reviewerId: 'admin-1', comment: 'buen arranque' });
    const fb = evidence.history.find(h => h.type === 'feedback');
    assert.equal(fb.reviewerId, 'admin-1');
    assert.equal(fb.comment, 'buen arranque');
    assert.ok(fb.at, 'timestamp del servidor');
    assert.equal(evidence.review.status, 'SUBMITTED', 'el feedback no cambia el estado');
    assert.throws(() => addReviewFeedback(doc, evidence.id, { reviewerId: 'admin-1', comment: '' }), (e) => e.code === 'COMMENT_REQUIRED');
});

// 7 — solicitar ajustes exige comentario
t('solicitar ajustes sin comentario falla; con comentario transiciona a REVISION_REQUESTED', () => {
    const { doc, evidence } = fixture();
    assert.throws(() => requestChanges(doc, evidence.id, { reviewerId: 'admin-1', comment: '  ' }), (e) => e.code === 'COMMENT_REQUIRED');
    requestChanges(doc, evidence.id, { reviewerId: 'admin-1', comment: 'faltan razones' });
    assert.equal(evidence.review.status, 'REVISION_REQUESTED');
});

// 8 — participante ve el feedback
t('la vista del participante incluye comentarios de mediación y estado con texto', () => {
    const { doc, evidence } = fixture();
    addReviewFeedback(doc, evidence.id, { reviewerId: 'admin-1', comment: 'nota previa' });
    requestChanges(doc, evidence.id, { reviewerId: 'admin-1', comment: 'ajusta el final' });
    const view = participantEvidenceView(evidence);
    assert.equal(view.status, 'REVISION_REQUESTED');
    assert.deepEqual(view.comments.map(c => c.comment), ['nota previa', 'ajusta el final']);
});

// 9 — reenvío conserva la entrega anterior
t('el reenvío AGREGA versión (append-only) y la anterior sobrevive intacta', () => {
    const { doc, evidence } = fixture();
    const original = evidence.versions[0].text;
    requestChanges(doc, evidence.id, { reviewerId: 'admin-1', comment: 'ajusta' });
    resubmitEvidence(doc, evidence.id, { userId: 'user-participante', text: words(12) });
    assert.equal(evidence.review.status, 'RESUBMITTED');
    assert.equal(evidence.versions.length, 2);
    assert.equal(evidence.versions[0].text, original, 'la entrega original NUNCA se sobrescribe');
    assert.equal(evidence.payload.text, words(12), 'el payload apunta a la vigente');
    // y respeta el rango de palabras del nodo
    requestChanges(doc, evidence.id, { reviewerId: 'admin-1', comment: 'otra vez' });
    assert.throws(() => resubmitEvidence(doc, evidence.id, { userId: 'user-participante', text: 'corto' }), (e) => e.code === 'PRODUCTION_LENGTH');
});

// 10 — transiciones inválidas fallan
t('transiciones inválidas: reenviar sin ajustes pedidos; pedir ajustes dos veces; tocar una REVIEWED', () => {
    const { doc, evidence } = fixture();
    assert.throws(() => resubmitEvidence(doc, evidence.id, { userId: 'user-participante', text: words(10) }), (e) => e.code === 'INVALID_TRANSITION');
    requestChanges(doc, evidence.id, { reviewerId: 'admin-1', comment: 'ajusta' });
    assert.throws(() => requestChanges(doc, evidence.id, { reviewerId: 'admin-1', comment: 'de nuevo' }), (e) => e.code === 'INVALID_TRANSITION');
    reviewEvidence(doc, evidence.id, { reviewerId: 'admin-1', decision: 'aprobado' });
    assert.throws(() => requestChanges(doc, evidence.id, { reviewerId: 'admin-1', comment: 'tarde' }), (e) => e.code === 'ALREADY_REVIEWED');
    assert.throws(() => addReviewFeedback(doc, evidence.id, { reviewerId: 'admin-1', comment: 'tarde' }), (e) => e.code === 'ALREADY_REVIEWED');
});

// 11 — doble submit de revisión no duplica
t('marcar revisada dos veces falla y el historial no se duplica', () => {
    const { doc, evidence } = fixture();
    reviewEvidence(doc, evidence.id, { reviewerId: 'admin-1', decision: 'con_comentarios', feedback: 'cierre' });
    const len = evidence.history.length;
    assert.throws(() => reviewEvidence(doc, evidence.id, { reviewerId: 'admin-1', decision: 'aprobado' }), (e) => e.code === 'ALREADY_REVIEWED');
    assert.equal(evidence.history.length, len, 'sin entradas duplicadas');
});

// 12 — el cierre conserva todo el historial
t('REVIEWED conserva el ciclo completo en el historial (nada se borra)', () => {
    const { doc, evidence } = fixture();
    addReviewFeedback(doc, evidence.id, { reviewerId: 'admin-1', comment: 'primera nota' });
    requestChanges(doc, evidence.id, { reviewerId: 'admin-1', comment: 'ajusta' });
    resubmitEvidence(doc, evidence.id, { userId: 'user-participante', text: words(15) });
    reviewEvidence(doc, evidence.id, { reviewerId: 'admin-1', decision: 'aprobado', feedback: 'quedó muy bien' });
    assert.deepEqual(evidence.history.map(h => h.type), ['submitted', 'feedback', 'revision_requested', 'resubmitted', 'reviewed']);
    assert.equal(evidence.versions.length, 2);
    assert.equal(evidence.review.status, 'REVIEWED');
});

// 13 — consulta fallida ≠ cero (estructural frontend)
const tabSrc = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'components', 'review', 'ProduccionesTab.tsx'), 'utf8');
t('estructural: la bandeja distingue fallo de vacío y jamás muestra un 0 falso', () => {
    assert.ok(tabSrc.includes('No se pudieron cargar las producciones'), 'estado de error propio');
    assert.ok(tabSrc.includes('El conteo no está disponible'), 'el fallo no se disfraza de cero');
    assert.ok(tabSrc.includes(`state === 'ready' && (`), 'el contador solo se muestra con datos');
    assert.ok(tabSrc.includes('MEDIATOR_SCOPE_GATED'), 'el gate de mediadores tiene estado propio');
    assert.ok(tabSrc.includes('Ninguna producción coincide con el filtro'), 'vacío filtrado ≠ vacío real');
});

// 14 — eventos sin PII ni contenido
t('los payloads de eventos validan en el registry y no admiten texto/PII', () => {
    const submitted = { experienceId: 'e', experienceVersionId: 'v', runId: 'r', nodeId: 'n2', nodeType: 'PRODUCTION', evidenceId: 'evid-1', requiresReview: true };
    const reviewed = { experienceId: 'e', experienceVersionId: 'v', evidenceId: 'evid-1', decision: 'aprobado' };
    assert.equal(validateEvent('evidence_submitted', submitted).ok, true);
    assert.equal(validateEvent('evidence_reviewed', reviewed).ok, true);
    // strip: un payload contaminado con contenido/PII se DESCARTA del evento
    const dirty = validateEvent('evidence_submitted', { ...submitted, text: 'contenido íntegro', nombre: 'PII' });
    assert.equal(dirty.ok, true);
    assert.ok(!('text' in dirty.payload) && !('nombre' in dirty.payload), 'el schema .strip() elimina campos no declarados');
    // el server NO emite eventos nuevos para request-changes (estado de dominio)
    assert.ok(!serverSrc.includes('evidence_changes_requested'), 'sin tipos de evento inventados');
});

// 15 — vecindad intacta
t('estructural: bundles legacy, Studio y pestaña técnica retirada', () => {
    assert.ok(serverSrc.includes(`'/api/bundles'`), 'bundles legacy intactos');
    assert.ok(serverSrc.includes('adminListExperiences'), 'Studio backend intacto');
    const rootDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
    assert.ok(existsSync(join(rootDir, 'components', 'studio', 'ExperienceStudio.tsx')), 'Studio frontend presente');
    const expSrc = readFileSync(join(rootDir, 'pages', 'Experiencias.tsx'), 'utf8');
    assert.ok(!expSrc.includes(`'revision'`), 'la pestaña técnica de revisión se retiró de Experiencias (D1)');
    assert.ok(expSrc.includes('MyProductionPanel'), 'la vista del participante existe');
    const aulaSrc = readFileSync(join(rootDir, 'pages', 'AulaViva.tsx'), 'utf8');
    assert.ok(aulaSrc.includes('ProduccionesTab'), 'Aula Viva monta la pestaña Producciones');
});

console.log(`\nmookReview01: ${passed} tests OK`);

// ─────────── Cobertura del arreglo EOL (CHP-CI-MOOK-RELEASE-GATES-01) ────────
// Demuestra las dos mitades: el MISMO contenido pasa con LF y con CRLF, y una
// diferencia REAL sigue fallando. Sin esto, «normalizar» podría ser un atajo
// para dejar de comprobar.

const GUARD_OK = "function requireReviewAccess(req, res) {\n    const roles = req.user?.roles || [];\n    if (roles.includes(`administrador`)) return true;\n    if (isMediatorRole(req.user)) {\n        res.status(403).json({ code: 'MEDIATOR_SCOPE_GATED' });\n        return false;\n    }\n    return false;\n}\n";
const GUARD_MEDIATOR_PASSES = "function requireReviewAccess(req, res) {\n    const roles = req.user?.roles || [];\n    if (roles.includes(`administrador`)) return true;\n    if (isMediatorRole(req.user)) {\n        res.status(403).json({ code: 'MEDIATOR_SCOPE_GATED' });\n        return true;\n    }\n    return false;\n}\n";

t('EOL: el mismo guard pasa con LF y con CRLF', () => {
    const lf = normalizeEol(GUARD_OK);
    const crlf = normalizeEol(GUARD_OK.replace(/\n/g, '\r\n'));
    const cr = normalizeEol(GUARD_OK.replace(/\n/g, '\r'));
    assert.strictEqual(lf, crlf, 'LF y CRLF deben normalizar al mismo texto');
    assert.strictEqual(lf, cr, 'CR suelto también');
    assertMediatorNeverPasses(lf);
    assertMediatorNeverPasses(crlf);
    assertMediatorNeverPasses(cr);
});

t('EOL: una diferencia REAL sigue fallando, con cualquier terminador', () => {
    for (const variante of [GUARD_MEDIATOR_PASSES, GUARD_MEDIATOR_PASSES.replace(/\n/g, '\r\n')]) {
        assert.throws(() => assertMediatorNeverPasses(normalizeEol(variante)),
            /return true/, 'un mediador que devuelve true DEBE seguir fallando');
    }
    // Y la normalización no puede tapar contenido ausente ni texto distinto.
    assert.throws(() => assertMediatorNeverPasses(normalizeEol(
        GUARD_OK.replace('MEDIATOR_SCOPE_GATED', 'OTRA_COSA'))), /gate declarado/);
    // Sin ningún `return false`, la rama del mediador deja de ser fail-closed.
    assert.throws(() => assertMediatorNeverPasses(normalizeEol(
        GUARD_OK.replace(/return false;/g, ''))), /devuelve false/);
    // Y el ORDEN importa: si el `return true` cayera DESPUÉS del gate, falla.
    const invertido = [
        'function requireReviewAccess(req, res) {',
        '    if (isMediatorRole(req.user)) {',
        "        res.status(403).json({ code: 'MEDIATOR_SCOPE_GATED' });",
        '        return false;',
        '    }',
        "    if (roles.includes('administrador')) return true;",
        '    return false;',
        '}',
    ].join('\n');
    assert.throws(() => assertMediatorNeverPasses(normalizeEol(invertido)), /antes del gate/);
});
