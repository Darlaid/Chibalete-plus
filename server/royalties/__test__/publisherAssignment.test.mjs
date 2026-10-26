/**
 * publisherAssignment.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-B.
 *
 * Decisión pura de editorial obligatoria por libro, historial solo de
 * inserciones sobre una royalties.db TEMPORAL (ROYALTIES_DB), atomicidad con
 * la escritura del catálogo, resolución por periodo y censo de cumplimiento.
 * Incluye la regla espejo del formulario (utils/publisherRequirement.mjs).
 * Nunca toca data-critical/.
 *
 *   node server/royalties/__test__/publisherAssignment.test.mjs
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code ?? e.message; } };
const msg = (fn) => { try { fn(); return ''; } catch (e) { return e.message; } };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REAL_DB = path.join(REPO, 'data-critical', 'royalties.db');
const realBefore = fs.existsSync(REAL_DB);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_royalties_assign_'));
process.env.ROYALTIES_DB = path.join(tmp, 'royalties.db');

const S = await import('../publishersStore.mjs');
const A = await import('../publisherAssignment.mjs');
const F = await import('../../../utils/publisherRequirement.mjs');
const { isEconomicContentType } = await import('../rightsStore.mjs');

const CH = 'pub-chibalete-editores';
const book = (extra = {}) => ({ id: 'b1', tipo: 'libro', titulo: 'Libro', ...extra });

try {
    section('[1] clasificación: libros frente a recursos');
    ok('libro → libro', A.isBookContent({ tipo: 'libro' }));
    ok('libro_album → libro', A.isBookContent({ tipo: 'libro_album' }));
    ok('libro con EPUB → libro', A.isBookContent({ tipo: 'libro', epub_url: '/uploads/x/a.epub' }));
    ok('capítulo (libro con parentId) → libro', A.isBookContent({ tipo: 'libro', parentId: 'p' }));
    ok('colección de tipo libro → libro', A.isBookContent({ tipo: 'libro', isCollection: true }));
    for (const t of ['guia', 'video', 'podcast', 'actividad', 'articulo_pedagogico', 'contexto_pedagogico', 'memoria_club']) {
        ok(`${t} → recurso (no libro)`, !A.isBookContent({ tipo: t }));
    }
    ok('guía pedagógica en EPUB → recurso', !A.isBookContent({ tipo: 'guia', epub_url: '/uploads/g/a.epub' }));
    ok('null / sin tipo → no libro', !A.isBookContent(null) && !A.isBookContent({}));
    ok('todo tipo liquidable es libro (la obligación cubre la liquidabilidad)',
        [{ tipo: 'libro' }, { tipo: 'libro_album' }].every((c) => isEconomicContentType(c) && A.isBookContent(c)));
    ok('el formulario clasifica igual que el servidor',
        ['libro', 'libro_album', 'guia', 'video', 'podcast', 'articulo_pedagogico'].every((t) => F.isBookForm(t) === A.isBookContent({ tipo: t })));

    section('[2] decisión pura');
    const R = (o) => A.resolvePublisherAssignment(o);
    ok('alta de libro con editorial', JSON.stringify(R({ sent: true, value: CH, next: book(), stored: null })) === JSON.stringify({ publisherId: CH, change: { from: null, to: CH } }));
    ok('alta de libro sin la clave → publisher_required', code(() => R({ sent: false, next: book(), stored: null })) === 'publisher_required');
    ok('alta de libro con null → publisher_required', code(() => R({ sent: true, value: null, next: book(), stored: null })) === 'publisher_required');
    ok('alta de libro con "" → publisher_required', code(() => R({ sent: true, value: '', next: book(), stored: null })) === 'publisher_required');
    ok('alta de álbum sin editorial → publisher_required', code(() => R({ sent: false, next: book({ tipo: 'libro_album' }), stored: null })) === 'publisher_required');
    const stored = book({ publisherId: CH });
    ok('edición parcial (sin la clave) conserva la editorial', JSON.stringify(R({ sent: false, next: book({ titulo: 'otro' }), stored })) === JSON.stringify({ publisherId: CH, change: null }));
    ok('reenviar la misma editorial no es un cambio', R({ sent: true, value: CH, next: book(), stored }).change === null);
    ok('quitar (null) la editorial de un libro → publisher_removal_forbidden', code(() => R({ sent: true, value: null, next: book(), stored })) === 'publisher_removal_forbidden');
    ok('quitar ("") la editorial de un libro → publisher_removal_forbidden', code(() => R({ sent: true, value: '', next: book(), stored })) === 'publisher_removal_forbidden');
    ok('cambiar a guía para quitarla también se rechaza', code(() => R({ sent: true, value: null, next: { id: 'b1', tipo: 'guia' }, stored })) === 'publisher_removal_forbidden');
    ok('reasignar sin confirmación → 409 publisher_reassign_unconfirmed', code(() => R({ sent: true, value: 'pub-otra', next: book(), stored })) === 'publisher_reassign_unconfirmed');
    ok('confirmación no booleana no vale', code(() => R({ sent: true, value: 'pub-otra', next: book(), stored, confirmed: 'true' })) === 'publisher_reassign_unconfirmed');
    ok('reasignar con confirmación', JSON.stringify(R({ sent: true, value: 'pub-otra', next: book(), stored, confirmed: true })) === JSON.stringify({ publisherId: 'pub-otra', change: { from: CH, to: 'pub-otra' } }));
    const legacy = book();
    ok('libro histórico sin editorial: editar sin asignar → publisher_required', code(() => R({ sent: false, next: book({ titulo: 'x' }), stored: legacy })) === 'publisher_required');
    ok('libro histórico sin editorial: asignar (regularizar) no exige confirmación', JSON.stringify(R({ sent: true, value: CH, next: book(), stored: legacy }).change) === JSON.stringify({ from: null, to: CH }));
    const guia = { id: 'g1', tipo: 'guia' };
    ok('recurso sin editorial sigue guardándose (F1-A)', JSON.stringify(R({ sent: false, next: guia, stored: null })) === JSON.stringify({ publisherId: null, change: null }));
    ok('recurso: quitar la editorial sigue permitido (F1-A) y es un cambio', JSON.stringify(R({ sent: true, value: '', next: guia, stored: { ...guia, publisherId: CH } }).change) === JSON.stringify({ from: CH, to: null }));
    ok('recurso: cambiar de editorial también exige confirmación', code(() => R({ sent: true, value: 'pub-otra', next: guia, stored: { ...guia, publisherId: CH } })) === 'publisher_reassign_unconfirmed');
    ok('errores con estado HTTP', (() => { try { R({ sent: false, next: book(), stored: null }); } catch (e) { return e instanceof S.PublisherError && e.status === 400; } })());

    section('[3] historial: transacción con la escritura del catálogo');
    ok('importar no crea la base', !fs.existsSync(process.env.ROYALTIES_DB));
    const db = S.getRoyaltiesDb();
    let wrote = 0;
    const row = A.recordPublisherChange({ contentId: 'b1', change: { from: null, to: CH }, actor: 'ADM', at: '2026-10-26T10:00:00.000Z' }, () => { wrote++; });
    ok('anota y ejecuta la escritura', wrote === 1 && /^cph-/.test(row.id) && row.from === null && row.to === CH && row.actor === 'ADM');
    const boom = code(() => A.recordPublisherChange({ contentId: 'b1', change: { from: CH, to: 'pub-x' }, actor: 'ADM' }, () => { throw new Error('disk full'); }));
    ok('si la escritura del catálogo falla, no queda fila', boom === 'disk full' && A.listPublisherHistory('b1').length === 1);
    A.recordPublisherChange({ contentId: 'b1', change: { from: CH, to: 'pub-x' }, actor: 'ADM', at: '2026-11-15T00:00:00.000Z' }, () => {});
    const hist = A.listPublisherHistory('b1');
    ok('historial cronológico con obra, actor, anterior, nueva y fecha',
        hist.length === 2 && hist.every((h) => h.contentId === 'b1' && h.actor && h.changedAt) && hist[1].from === CH && hist[1].to === 'pub-x');
    ok('UPDATE prohibido (solo inserciones)', /append-only/.test(msg(() => db.prepare("UPDATE content_publisher_history SET actor = 'x'").run())));
    ok('DELETE prohibido (solo inserciones)', /append-only/.test(msg(() => db.prepare('DELETE FROM content_publisher_history').run())));
    ok('una fila sin cambio real no se admite', code(() => db.prepare("INSERT INTO content_publisher_history VALUES ('cph-z','b1','a','a','ADM','2026-10-26')").run()) !== null);
    ok('referencias del historial por titular', A.countPublisherHistoryRefs(CH) === 2 && A.countPublisherHistoryRefs('pub-x') === 1 && A.countPublisherHistoryRefs('pub-nada') === 0);

    section('[4] editorial por periodo');
    ok('antes del primer cambio → la anterior (null)', A.publisherAt(hist, 'pub-x', '2026-10-01T00:00:00.000Z') === null);
    ok('entre cambios → la intermedia', A.publisherAt(hist, 'pub-x', '2026-11-01T00:00:00.000Z') === CH);
    ok('después → la vigente', A.publisherAt(hist, 'pub-x', new Date('2026-12-01T00:00:00Z')) === 'pub-x');
    ok('sin historial → la vigente en la ficha', A.publisherAt([], CH, '2020-01-01T00:00:00.000Z') === CH);

    section('[5] censo de cumplimiento');
    const catalog = [
        ...Array.from({ length: 109 }, (_, i) => ({ id: `c${i}`, tipo: i < 52 ? 'libro' : (i < 61 ? 'libro_album' : 'guia'), publisherId: CH })),
        { id: 'sin', tipo: 'libro', titulo: 'Sin editorial' },
        { id: 'fantasma', tipo: 'libro_album', titulo: 'Editorial inexistente', publisherId: 'pub-borrada' },
        { id: 'rec', tipo: 'podcast' },
    ];
    const c = A.publisherCompliance(catalog, S.listPublishers());
    ok('libros contados por tipo', c.books === 63 && c.nonBooks === 49, JSON.stringify({ b: c.books, n: c.nonBooks }));
    ok('61 libros con editorial válida', c.booksWithPublisher === 61);
    ok('excepciones identificadas sin modificarlas', c.missing.map((m) => m.id).join() === 'sin' && c.unknown.map((m) => m.id).join() === 'fantasma' && !('publisherId' in catalog[109]));
    ok('conteo por editorial: libros y contenidos', c.byPublisher[CH].books === 61 && c.byPublisher[CH].contents === 109);
    ok('un recurso sin editorial no es excepción', !c.missing.some((m) => m.id === 'rec'));

    section('[6] regla del formulario (espejo, no autoridad)');
    const base = { isBook: true, isUpdate: false, publishersLoaded: true, publisherId: CH };
    ok('libro nuevo con editorial → sin bloqueo', F.publisherFormBlock(base) === null);
    ok('libro nuevo sin editorial → bloqueo', /editorial responsable/.test(F.publisherFormBlock({ ...base, publisherId: '' }) || ''));
    ok('lista no cargada + libro nuevo → bloqueo', /No se pudo cargar/.test(F.publisherFormBlock({ ...base, publishersLoaded: false }) || ''));
    ok('lista no cargada + edición → no bloquea (el servidor conserva la guardada)', F.publisherFormBlock({ ...base, publishersLoaded: false, isUpdate: true }) === null);
    ok('edición: quitar editorial de un libro → bloqueo', /no puede quedar sin editorial/.test(F.publisherFormBlock({ ...base, isUpdate: true, publisherId: '', originalPublisherId: CH }) || ''));
    ok('edición: reasignar sin marcar confirmación → bloqueo', /Confirma/.test(F.publisherFormBlock({ ...base, isUpdate: true, publisherId: 'pub-x', originalPublisherId: CH }) || ''));
    ok('edición: reasignar confirmado → sin bloqueo', F.publisherFormBlock({ ...base, isUpdate: true, publisherId: 'pub-x', originalPublisherId: CH, reassignConfirmed: true }) === null);
    ok('recurso sin editorial → sin bloqueo', F.publisherFormBlock({ ...base, isBook: false, publisherId: '' }) === null);
    ok('reasignación solo con editorial previa y nueva distintas',
        F.isPublisherReassignment({ isUpdate: true, publisherId: 'pub-x', originalPublisherId: CH })
        && !F.isPublisherReassignment({ isUpdate: true, publisherId: CH, originalPublisherId: '' })
        && !F.isPublisherReassignment({ isUpdate: false, publisherId: 'pub-x', originalPublisherId: CH }));
} catch (e) {
    ok('arnés', false, e.stack || e.message);
} finally {
    S.closeRoyaltiesDb();
    fs.rmSync(tmp, { recursive: true, force: true });
}

ok('la base real data-critical/royalties.db no se creó', fs.existsSync(REAL_DB) === realBefore);
console.log(`\npublisherAssignment — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
