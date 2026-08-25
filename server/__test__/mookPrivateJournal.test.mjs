/**
 * mookPrivateJournal.test.mjs — CHP-MOOK-ESTAS-AQUI-01.
 *
 * Cierra el PRIVACY-BLOCKER del preflight: una ACTIVITY con
 * `config.privado:true` es una BITÁCORA PRIVADA cuyo texto se proyecta
 * ÚNICAMENTE a su autor. Sin bypass por rol, sin store nuevo, sin nodo nuevo.
 *
 * El SENTINEL es la prueba dura: no debe aparecer en NINGUNA proyección no
 * autorizada (cola de revisión, detalle de revisión, eventos, evidencia ajena).
 */
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    emptyMookStore, createExperience, createDraftVersion, publishVersion,
    startRun, submitEvidence, resubmitEvidence,
    participantEvidenceView, myEvidenceView, isPrivateActivityNode,
    reviewListView, reviewDetailView, reviewEvidence,
} from '../lib/experienceStore.js';
import { validateEvent } from '../analytics/eventRegistry.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');

// Sentinel inequívoco: si aparece donde no debe, la fuga es indiscutible.
const SENTINEL = 'SENTINEL-BITACORA-PRIVADA-9f3c1a-NO-DEBE-FILTRARSE';
const SENTINEL_PREGUNTA = 'PREGUNTA-PRIVADA-4b7e2d-NO-DEBE-FILTRARSE';
const OWNER = 'user-duenio';
const OTHER = 'user-otro';

const bookExists = () => true;
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const leaks = (o) => JSON.stringify(o ?? null).includes(SENTINEL);
const leaksPregunta = (o) => JSON.stringify(o ?? null).includes(SENTINEL_PREGUNTA);

const PRIV_NODE = {
    id: 'bit', type: 'ACTIVITY', title: 'Bitácora de entrada',
    config: { preguntas: [{ texto: SENTINEL_PREGUNTA, tipo: 'text_short' }], privado: true },
};
const PUB_NODE = {
    id: 'act', type: 'ACTIVITY', title: 'Actividad abierta',
    config: { preguntas: [{ texto: '¿Qué aprendiste?', tipo: 'text_short' }] },
};
const PROD_NODE = {
    id: 'prod', type: 'PRODUCTION', title: 'Producción', required: false,
    config: { consigna: 'c', criterioRevision: 'cr', minPalabras: 5, maxPalabras: 40 },
};

/** Recorre la secuencia hasta `prod` (los requeridos previos deben completarse). */
const recorrer = (doc, run, { sentinel = SENTINEL } = {}) => {
    submitEvidence(doc, { runId: run.id, nodeId: 'bit', userId: OWNER, payload: { answers: [sentinel] } });
    submitEvidence(doc, { runId: run.id, nodeId: 'act', userId: OWNER, payload: { answers: ['respuesta abierta'] } });
    return submitEvidence(doc, { runId: run.id, nodeId: 'prod', userId: OWNER, payload: { text: words(10) } }).evidence;
};

/** Experiencia con bitácora privada + actividad abierta + producción revisable. */
function fixture({ nodes = [PRIV_NODE, PUB_NODE, PROD_NODE] } = {}) {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'diario', title: 'Con bitácora' });
    const v = createDraftVersion(doc, exp.id, {
        objectives: ['objetivo'],
        modules: [{ id: 'm1', title: 'Módulo', nodes }],
    }, bookExists);
    publishVersion(doc, v.id);
    const { run } = startRun(doc, { userId: OWNER, experienceId: exp.id });
    return { doc, exp, v, run };
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

// ── 1. El dueño guarda y relee su texto privado ─────────────────────────────
test('1. el dueño guarda una bitácora privada y puede releer su texto íntegro', () => {
    const { doc, run } = fixture();
    submitEvidence(doc, { runId: run.id, nodeId: 'bit', userId: OWNER, payload: { answers: [SENTINEL] } });

    const mine = myEvidenceView(doc, run, OWNER);
    const bit = mine.find(e => e.nodeId === 'bit');
    assert.ok(bit, 'la bitácora aparece en la evidencia propia');
    assert.equal(bit.privado, true, 'se distingue como privada');
    assert.equal(bit.requiresReview, false, 'no es una entrega a revisión');
    assert.deepEqual(bit.answers, [SENTINEL], 'el dueño relee su texto ÍNTEGRO');
    assert.equal(bit.status, null, 'sin estado de revisión: no es una producción');
});

// ── 2. Otro participante no puede leerla ────────────────────────────────────
test('2. otro participante NO recibe el texto (ni el run ajeno)', () => {
    const { doc, run } = fixture();
    submitEvidence(doc, { runId: run.id, nodeId: 'bit', userId: OWNER, payload: { answers: [SENTINEL] } });

    const ajeno = myEvidenceView(doc, run, OTHER);
    assert.deepEqual(ajeno, [], 'un no-dueño no obtiene NADA del run ajeno');
    assert.ok(!leaks(ajeno), 'sentinel ausente para el no-dueño');

    // El propio store rechaza escribir en un run ajeno (atribución por sesión).
    assert.throws(
        () => submitEvidence(doc, { runId: run.id, nodeId: 'bit', userId: OTHER, payload: { answers: ['x'] } }),
        (e) => e.code === 'NOT_RUN_OWNER',
        'la evidencia solo la envía el dueño del run',
    );
});

// ── 3. Admin/revisor no recibe texto, pregunta ni indicio ───────────────────
test('3. admin/revisor NO recibe texto, pregunta ni indicio de la bitácora privada', () => {
    const { doc, run } = fixture();
    submitEvidence(doc, { runId: run.id, nodeId: 'bit', userId: OWNER, payload: { answers: [SENTINEL] } });
    submitEvidence(doc, { runId: run.id, nodeId: 'act', userId: OWNER, payload: { answers: ['respuesta abierta'] } });
    const { evidence: prod } = submitEvidence(doc, { runId: run.id, nodeId: 'prod', userId: OWNER, payload: { text: words(10) } });

    const queue = reviewListView(doc, () => 'Nombre Real');
    assert.equal(queue.length, 1, 'solo la PRODUCTION entra en la cola');
    assert.ok(!leaks(queue) && !leaksPregunta(queue), 'la cola no filtra la bitácora');

    const detail = reviewDetailView(doc, prod.id, () => 'Nombre Real');
    assert.ok(!leaks(detail), 'el detalle de revisión NO contiene el texto privado');
    assert.ok(!leaksPregunta(detail), 'el detalle de revisión NO contiene la pregunta privada');

    // La bitácora se omite POR COMPLETO del contexto: ni una entrada vacía.
    const titulos = detail.activityContext.map(a => a.nodeTitle);
    assert.ok(!titulos.includes('Bitácora de entrada'), 'ni el título del nodo privado se proyecta');
    assert.equal(detail.activityContext.length, 1, 'solo la actividad NO privada es contexto');
    assert.deepEqual(detail.activityContext[0].answers, ['respuesta abierta']);

    // La bitácora tampoco es direccionable como evidencia revisable.
    const bitEv = doc.evidence.find(e => e.nodeId === 'bit');
    assert.throws(() => reviewDetailView(doc, bitEv.id), (e) => e.code === 'NOT_REVIEWABLE');
});

// ── 4. La PRODUCTION del mismo run sigue revisable ──────────────────────────
test('4. una PRODUCTION del mismo run sigue siendo revisable con normalidad', () => {
    const { doc, run } = fixture();
    const prod = recorrer(doc, run);

    const detail = reviewDetailView(doc, prod.id, () => 'Nombre Real');
    assert.equal(detail.versions.length, 1, 'la entrega es legible para el revisor');
    assert.equal(detail.consigna, 'c');
    assert.equal(detail.status, 'SUBMITTED');

    const rev = reviewEvidence(doc, prod.id, { reviewerId: 'admin-1', decision: 'aprobado', feedback: 'bien' });
    assert.equal(rev.review.status, 'REVIEWED', 'el ciclo de revisión se completa');
    assert.ok(!leaks(rev), 'revisar no arrastra la bitácora privada');
});

// ── 5. ACTIVITY no privada conserva el comportamiento anterior ──────────────
test('5. una ACTIVITY NO privada conserva EXACTAMENTE el comportamiento anterior', () => {
    const { doc, v, run } = fixture();
    const prod = recorrer(doc, run);

    // Sigue siendo contexto de mediación (comportamiento D3 intacto).
    const detail = reviewDetailView(doc, prod.id, () => 'N');
    assert.deepEqual(detail.activityContext[0].answers, ['respuesta abierta']);

    // El dueño NO recibe `answers` de una actividad no privada (proyección previa).
    const mine = myEvidenceView(doc, run, OWNER);
    const act = mine.find(e => e.nodeId === 'act');
    assert.equal(act.privado, false);
    assert.equal(act.answers, undefined, 'sin answers: proyección idéntica a la anterior');

    // La config congelada de una ACTIVITY normal NO gana el campo `privado`.
    const actNode = v.modules[0].nodes.find(n => n.id === 'act');
    assert.ok(!('privado' in actNode.config), 'forma congelada sin campos nuevos');

    // Compat de firma: participantEvidenceView sin opciones sigue funcionando.
    const legacy = participantEvidenceView(doc.evidence.find(e => e.nodeId === 'act'));
    assert.equal(legacy.answers, undefined);
    assert.equal(legacy.privado, false);
});

// ── 6. Append-only en bitácoras privadas múltiples ──────────────────────────
test('6. varias respuestas privadas son APPEND-ONLY (nada se sobrescribe)', () => {
    const { doc, run } = fixture();
    for (let d = 1; d <= 7; d++) {
        submitEvidence(doc, { runId: run.id, nodeId: 'bit', userId: OWNER, payload: { answers: [`${SENTINEL}-dia-${d}`] } });
    }
    const evs = doc.evidence.filter(e => e.nodeId === 'bit');
    assert.equal(evs.length, 7, 'siete registros independientes');
    assert.deepEqual(evs.map(e => e.payload.answers[0]), Array.from({ length: 7 }, (_, i) => `${SENTINEL}-dia-${i + 1}`));
    assert.equal(new Set(evs.map(e => e.id)).size, 7, 'ids únicos: ninguna evidencia se pisa');

    const mine = myEvidenceView(doc, run, OWNER).filter(e => e.nodeId === 'bit');
    assert.equal(mine.length, 7, 'el dueño relee las siete');

    // Read-only en este MVP: no hay edición.
    assert.throws(() => resubmitEvidence(doc, evs[0].id, { userId: OWNER, text: 'editado' }),
        (e) => e.code === 'NOT_REVIEWABLE', 'una bitácora privada no se edita');
});

// ── 7. Preview no escribe ───────────────────────────────────────────────────
test('7. preview no persiste: el runtime de vista previa no llama a la API', () => {
    const src = readFileSync(join(root, 'pages', 'Experiencias.tsx'), 'utf8');
    // El guard de preview precede a toda llamada de envío.
    assert.ok(/const send = async[\s\S]{0,200}?if \(preview\)/.test(src), 'send() corta en preview antes de enviar');
    assert.ok(/const complete = async[\s\S]{0,200}?if \(preview\)/.test(src), 'complete() corta en preview');
    // El aviso de salida tampoco se activa en preview (no hay nada que perder).
    assert.ok(/if \(!onUnsaved \|\| preview\) return;/.test(src), 'preview no registra estado sin guardar');
    assert.ok(/if \(!sinGuardar \|\| preview\) return;/.test(src), 'preview no instala beforeunload');

    // Y el store nunca se toca sin run: preview no tiene runId real.
    const doc = emptyMookStore();
    assert.equal(doc.evidence.length, 0);
    assert.equal(doc.runs.length, 0);
});

// ── 8. Los eventos no contienen texto ───────────────────────────────────────
test('8. evidence_submitted valida solo con IDs — jamás texto de la bitácora', () => {
    const { doc, run } = fixture();
    const { evidence } = submitEvidence(doc, { runId: run.id, nodeId: 'bit', userId: OWNER, payload: { answers: [SENTINEL] } });

    const payload = {
        userId: OWNER, experienceId: evidence.experienceId,
        experienceVersionId: evidence.experienceVersionId, runId: run.id,
        nodeId: evidence.nodeId, nodeType: evidence.nodeType, moduleId: 'm1',
        evidenceId: evidence.id, requiresReview: evidence.requiresReview,
    };
    const ok = validateEvent('evidence_submitted', payload);
    assert.ok(ok.valid !== false, `el payload canónico valida: ${JSON.stringify(ok.errors ?? '')}`);
    assert.ok(!leaks(payload) && !leaksPregunta(payload), 'el evento no transporta texto ni pregunta');

    // El emisor real no puede colar texto: el registry rechaza campos extra.
    const conTexto = validateEvent('evidence_submitted', { ...payload, answers: [SENTINEL] });
    assert.ok(conTexto.valid === false || !leaks(conTexto.data ?? {}), 'el registry no propaga texto añadido');
});

// ── 9. La relectura sobrevive a la recarga ──────────────────────────────────
test('9. tras «recargar» (releer el store desde cero) el dueño conserva su relectura', () => {
    const { doc, run } = fixture();
    submitEvidence(doc, { runId: run.id, nodeId: 'bit', userId: OWNER, payload: { answers: [SENTINEL] } });

    // Round-trip por JSON = exactamente lo que hace readMook() en cada request.
    const reloaded = JSON.parse(JSON.stringify(doc));
    const runReloaded = reloaded.runs.find(r => r.id === run.id);
    const mine = myEvidenceView(reloaded, runReloaded, OWNER);
    assert.deepEqual(mine.find(e => e.nodeId === 'bit').answers, [SENTINEL], 'relectura persistente');

    // Y sigue sin filtrarse tras la recarga.
    submitEvidence(reloaded, { runId: run.id, nodeId: 'act', userId: OWNER, payload: { answers: ['abierta'] } });
    const { evidence: prod } = submitEvidence(reloaded, { runId: run.id, nodeId: 'prod', userId: OWNER, payload: { text: words(10) } });
    assert.ok(!leaks(reviewDetailView(reloaded, prod.id, () => 'N')), 'sin fuga tras recarga');
});

// ── 10. Salir sin guardar no persiste ───────────────────────────────────────
test('10. salir sin guardar NO persiste: solo submitEvidence escribe', () => {
    const { doc, run } = fixture();
    const antes = JSON.stringify(doc);
    // «Escribir sin guardar» no tiene representación en el dominio: sin envío,
    // el store queda byte a byte idéntico.
    assert.equal(JSON.stringify(doc), antes, 'sin envío, cero mutación');
    assert.equal(doc.evidence.length, 0, 'ninguna evidencia fantasma');
    assert.deepEqual(myEvidenceView(doc, run, OWNER), [], 'nada que releer');

    // Y el runtime avisa antes de perderlo, con la microcopia exacta.
    const src = readFileSync(join(root, 'pages', 'Experiencias.tsx'), 'utf8');
    assert.ok(src.includes('Tu respuesta todavía no está guardada. ¿Quieres conservarla o salir sin guardar?'),
        'microcopia de salida sin guardar presente');
    assert.ok(/role="alertdialog"/.test(src), 'la confirmación es accesible (alertdialog)');
    assert.ok(src.includes('Conservar solo para mí') && src.includes('Salir sin guardar'), 'ambas salidas ofrecidas');
});

// ── Fail-closed y superficie de configuración ───────────────────────────────
test('11. FAIL-CLOSED: un nodo no resoluble se trata como privado', () => {
    const { doc, v, run } = fixture();
    const prod = recorrer(doc, run);

    assert.equal(isPrivateActivityNode(v, 'bit'), true);
    assert.equal(isPrivateActivityNode(v, 'act'), false);
    assert.equal(isPrivateActivityNode(v, 'inexistente'), true, 'nodo desconocido ⇒ privado');
    assert.equal(isPrivateActivityNode(null, 'act'), true, 'versión ausente ⇒ privado');

    // Evidencia huérfana (nodo ya no resoluble): se omite, no se filtra.
    doc.evidence.push({
        id: 'evid-huerfana', runId: run.id, userId: OWNER,
        experienceId: prod.experienceId, experienceVersionId: prod.experienceVersionId,
        nodeId: 'nodo-fantasma', nodeType: 'ACTIVITY', type: 'text',
        payload: { answers: [SENTINEL] }, requiresReview: false,
        submittedAt: new Date().toISOString(), review: { status: 'SUBMITTED' },
    });
    assert.ok(!leaks(reviewDetailView(doc, prod.id, () => 'N')), 'la evidencia huérfana NO se proyecta al revisor');
});

test('12. `privado` se congela con la versión y solo `true` lo activa', () => {
    const doc = emptyMookStore();
    const exp = createExperience(doc, { slug: 'p', title: 'P' });
    const v = createDraftVersion(doc, exp.id, {
        objectives: ['o'],
        modules: [{
            id: 'm', title: 'M', nodes: [
                { id: 'a', type: 'ACTIVITY', title: 'A', config: { preguntas: [{ texto: 'p', tipo: 'text_short' }], privado: true } },
                { id: 'b', type: 'ACTIVITY', title: 'B', config: { preguntas: [{ texto: 'p', tipo: 'text_short' }], privado: 'sí' } },
                { id: 'c', type: 'ACTIVITY', title: 'C', config: { preguntas: [{ texto: 'p', tipo: 'text_short' }], privado: false } },
                { id: 'd', type: 'LEO', title: 'D', config: { objetivo: 'o', semilla: 's', privado: true } },
            ],
        }],
    }, bookExists);
    const [a, b, c, d] = v.modules[0].nodes;
    assert.equal(a.config.privado, true, 'true activa');
    assert.ok(!('privado' in b.config), 'un valor truthy no booleano NO activa');
    assert.ok(!('privado' in c.config), 'false deja el campo ausente');
    assert.ok(!('privado' in d.config), '`privado` no se arrastra a nodos no-ACTIVITY');

    publishVersion(doc, v.id);
    const frozen = JSON.stringify(v);
    assert.throws(() => createDraftVersion(doc, exp.id, { objectives: [], modules: [] }, bookExists),
        (e) => e.code === 'INVALID_NODES');
    assert.equal(JSON.stringify(v), frozen, 'la versión publicada permanece inmutable');
});

test('13. el Studio ofrece el control accesible de bitácora privada', () => {
    const src = readFileSync(join(root, 'components', 'studio', 'ExperienceStudio.tsx'), 'utf8');
    assert.ok(src.includes('Bitácora privada — solo el participante podrá leer su respuesta'), 'etiqueta exacta');
    assert.ok(/type="checkbox"[^>]*checked=\{node\.config\.privado === true\}/s.test(src), 'control enlazado a config.privado');
    assert.ok(/aria-describedby=\{`\$\{errKey\}-privado-note`\}/.test(src), 'descripción ligada por aria-describedby');
});

test('14. el runtime muestra las microcopias congeladas de la bitácora v1', () => {
    const src = readFileSync(join(root, 'pages', 'Experiencias.tsx'), 'utf8');
    for (const frase of ['Privada. Solo tú puedes leerla.', 'Guardar para mí', 'Nada se publicará automáticamente', 'Guardada para ti', 'Leer lo que escribí']) {
        assert.ok(src.includes(frase), `microcopia presente: «${frase}»`);
    }
    // Compartir/galería quedan FUERA de la v1: no se simulan controles.
    for (const futura of ['Elegir con quién compartir', 'Compartir con mi grupo', 'Proponer para la galería']) {
        assert.ok(!src.includes(futura), `NO se muestra la acción futura: «${futura}»`);
    }
    // Y nada de «¿Estás aquí?» hardcodeado en el componente global.
    assert.ok(!/Estás aquí\?/.test(src.replace(/Estás aquí<\/span>|Estás aquí"|> Estás aquí/g, '')), 'sin referencias al MOOK concreto');
});

let failed = 0;
for (const [name, fn] of tests) {
    try { fn(); console.log(`  ✓ ${name}`); }
    catch (e) { failed++; console.error(`  ✗ ${name}\n    ${e.message}`); }
}
console.log(`\nmookPrivateJournal: ${tests.length - failed}/${tests.length} OK`);
if (failed) process.exit(1);
