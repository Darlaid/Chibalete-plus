/**
 * publishersStore.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F1-A.
 *
 * Registro de titulares sobre una royalties.db TEMPORAL (ROYALTIES_DB):
 * migración idempotente, semilla permanente, CRUD, validación, identidad
 * inmutable y protección de borrado. Nunca toca data-critical/.
 *
 *   node server/royalties/__test__/publishersStore.test.mjs
 */
import Database from 'better-sqlite3';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const throwsCode = (fn, code) => { try { fn(); return false; } catch (e) { return e.code === code; } };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REAL_DB = path.join(REPO, 'data-critical', 'royalties.db');
const realBefore = fs.existsSync(REAL_DB);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_royalties_store_'));
const DB_PATH = path.join(tmp, 'nested', 'royalties.db');
process.env.ROYALTIES_DB = DB_PATH;

const S = await import('../publishersStore.mjs');

try {
    section('[1] apertura perezosa y migración');
    ok('importar el módulo no crea la base', !fs.existsSync(DB_PATH));
    ok('la ruta resuelta es la de ROYALTIES_DB', S.resolveRoyaltiesDbPath() === path.resolve(DB_PATH));
    const db = S.getRoyaltiesDb();
    ok('la primera apertura crea la base (y su directorio)', fs.existsSync(DB_PATH));
    ok('modo WAL', String(db.pragma('journal_mode', { simple: true })).toLowerCase() === 'wal');
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map((r) => r.name);
    // F2-A añade rights_versions (0002); ninguna otra tabla del Plan existe aún.
    ok('solo _migrations + publishers + rights_versions', JSON.stringify(tables) === JSON.stringify(['_migrations', 'publishers', 'rights_versions']), tables.join(','));
    S.closeRoyaltiesDb();

    section('[2] migración idempotente');
    S.getRoyaltiesDb(); S.closeRoyaltiesDb();
    const raw = new Database(DB_PATH);
    const { runMigrations } = await import('../../db/migrate.js');
    const again = runMigrations(raw, () => {}, { dir: path.join(REPO, 'server', 'royalties', 'migrations'), tag: 'royalties-migrate' });
    ok('reaplicar = no-op', again.applied.length === 0 && again.already.includes('0001_publishers'));
    ok('versión registrada una sola vez', raw.prepare("SELECT COUNT(*) n FROM _migrations WHERE version='0001_publishers'").get().n === 1);
    ok('semilla presente una sola vez', raw.prepare('SELECT COUNT(*) n FROM publishers WHERE id = ?').get(S.CHIBALETE_PUBLISHER_ID).n === 1);
    raw.exec(fs.readFileSync(path.join(REPO, 'server', 'royalties', 'migrations', '0001_publishers.sql'), 'utf8').split('-- DOWN')[0].replace('-- UP', ''));
    ok('el SQL de la migración es re-ejecutable sin duplicar la semilla', raw.prepare('SELECT COUNT(*) n FROM publishers').get().n === 1);
    const identityDirUnchanged = runMigrations(new Database(':memory:'), () => {});
    ok('runner de identidad intacto sin opciones (aplica sus migraciones)', identityDirUnchanged.applied.includes('0001_identity'));
    raw.close();

    section('[3] semilla: Chibalete Editores con ID permanente');
    const seed = S.getPublisher(S.CHIBALETE_PUBLISHER_ID);
    ok('existe, editorial, activa', seed && seed.kind === 'editorial' && seed.status === 'active' && seed.legalName === 'Chibalete Editores');
    ok('ID permanente', S.CHIBALETE_PUBLISHER_ID === 'pub-chibalete-editores');

    section('[4] alta, consulta, edición y desactivación');
    const a = S.createPublisher({ kind: 'editorial', legalName: '  Editorial Prueba S.A.S. ', tradeName: 'Prueba', imprints: ['Sello A', 'Sello A', 'Sello B'], contactEmail: 'a@b.co', taxId: '900.000.000-1' });
    ok('id asignado por el servidor (pub-<ulid>)', /^pub-[0-9a-z]{26}$/.test(a.id), a.id);
    ok('texto normalizado y sellos sin duplicados', a.legalName === 'Editorial Prueba S.A.S.' && JSON.stringify(a.imprints) === '["Sello A","Sello B"]');
    ok('estado inicial activo', a.status === 'active');
    const t = S.createPublisher({ kind: 'tercero', legalName: 'Ilustradora Independiente' });
    ok('tercero admitido', t.kind === 'tercero');
    const u = S.updatePublisher(a.id, { tradeName: 'Prueba Editores', id: 'pub-hackeado', createdAt: '1999-01-01' });
    ok('edición aplicada', u.tradeName === 'Prueba Editores');
    ok('identidad inmutable (id y createdAt ignorados)', u.id === a.id && u.createdAt === a.createdAt && !S.getPublisher('pub-hackeado'));
    const off = S.updatePublisher(a.id, { status: 'inactive' });
    ok('desactivación', off.status === 'inactive' && S.getPublisher(a.id).status === 'inactive');
    ok('listado incluye semilla y altas', S.listPublishers().length === 3);

    section('[5] validación');
    ok('kind inválido', throwsCode(() => S.createPublisher({ kind: 'autor', legalName: 'X' }), 'invalid_kind'));
    ok('razón social obligatoria', throwsCode(() => S.createPublisher({ kind: 'editorial', legalName: '  ' }), 'legal_name_required'));
    ok('campo no admitido (p. ej. datos bancarios) rechazado', throwsCode(() => S.createPublisher({ kind: 'editorial', legalName: 'X', bankAccount: '123' }), 'unknown_field'));
    ok('correo inválido', throwsCode(() => S.createPublisher({ kind: 'editorial', legalName: 'X', contactEmail: 'no-es-correo' }), 'invalid_email'));
    ok('estado inválido', throwsCode(() => S.updatePublisher(a.id, { status: 'borrado' }), 'invalid_status'));
    ok('sellos inválidos', throwsCode(() => S.updatePublisher(a.id, { imprints: 'Sello' }), 'invalid_imprints'));
    ok('editar inexistente → not_found', throwsCode(() => S.updatePublisher('pub-x', { notes: 'n' }), 'not_found'));

    section('[6] borrado protegido');
    ok('semilla nunca se borra', throwsCode(() => S.deletePublisher(S.CHIBALETE_PUBLISHER_ID, { referenceCount: 0 }), 'protected_publisher'));
    ok('referenciado → 409', throwsCode(() => S.deletePublisher(a.id, { referenceCount: 2 }), 'publisher_referenced'));
    ok('sin conteo explícito → se niega (fail-closed)', throwsCode(() => S.deletePublisher(a.id, {}), 'publisher_referenced'));
    S.deletePublisher(t.id, { referenceCount: 0 });
    ok('no referenciado → borrado', !S.getPublisher(t.id));
} catch (e) {
    ok('suite', false, e.stack || e.message);
} finally {
    S.closeRoyaltiesDb();
    fs.rmSync(tmp, { recursive: true, force: true });
}

ok('la base real data-critical/royalties.db no se creó', fs.existsSync(REAL_DB) === realBefore);
console.log(`\npublishersStore — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
