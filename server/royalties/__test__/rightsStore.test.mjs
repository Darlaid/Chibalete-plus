/**
 * rightsStore.test.mjs — CHP-EDITORIAL-ROYALTIES-2026-01 / F2-A.
 *
 * Derechos versionados sobre una royalties.db TEMPORAL (ROYALTIES_DB):
 *   [1] migración 0002 idempotente y encadenada a 0001
 *   [2] versión asociada a contentId, editorial existente y activa
 *   [3] historial solo de inserciones (UPDATE/DELETE fallan; v2 no pisa v1)
 *   [4] rechazo de participaciones y datos inválidos
 *   [5] editorial responsable ≠ titular económico
 *   [6] vigencia y activación temporal (día America/Bogota)
 *   [7] permisos expresos e independientes; sin autorización implícita
 *   [8] elegibilidad económica (publisherId solo no basta)
 *   [9] guardia off / shadow / enforce y obras sin régimen
 *   [10] respaldo y restauración de la base migrada
 * Nunca toca data-critical/.
 *
 *   node server/royalties/__test__/rightsStore.test.mjs
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
const throwsMsg = (fn, rx) => { try { fn(); return false; } catch (e) { return rx.test(e.message); } };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const REAL_DB = path.join(REPO, 'data-critical', 'royalties.db');
const realBefore = fs.existsSync(REAL_DB);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_rights_store_'));
const DB_PATH = path.join(tmp, 'royalties.db');
process.env.ROYALTIES_DB = DB_PATH;

const P = await import('../publishersStore.mjs');
const R = await import('../rightsStore.mjs');
const { runMigrations } = await import('../../db/migrate.js');

const ALL_YES = Object.fromEntries(R.RIGHTS_CAPABILITIES.map((c) => [c, true]));
const ALL_NO = Object.fromEntries(R.RIGHTS_CAPABILITIES.map((c) => [c, false]));
const book = (id, extra = {}) => ({ id, tipo: 'libro', status: 'disponible', publisherId: P.CHIBALETE_PUBLISHER_ID, ...extra });
const base = (extra = {}) => ({
    publisherId: P.CHIBALETE_PUBLISHER_ID, actRef: 'ACTA-2026-001', actSignedOn: '2026-10-01', validFrom: '2026-10-01',
    validUntil: '2027-09-30', effectiveAt: '2026-10-01T05:00:00.000Z', legalStatus: 'active', economicStatus: 'active',
    settlementClass: 'auxiliary', permissions: { ...ALL_YES }, ...extra,
});

try {
    section('[1] migración');
    const db = P.getRoyaltiesDb();
    const versions = () => db.prepare('SELECT version FROM _migrations ORDER BY version').all().map((r) => r.version);
    ok('0001 y 0002 aplicadas en orden', JSON.stringify(versions()) === JSON.stringify(['0001_publishers', '0002_rights_versions']));
    const second = runMigrations(db, () => {}, { dir: path.join(REPO, 'server', 'royalties', 'migrations'), tag: 't' });
    ok('re-ejecutar no aplica nada', second.applied.length === 0 && second.already.length === 2);
    const cols = db.prepare('PRAGMA table_info(rights_versions)').all().map((c) => c.name);
    ok('columnas mínimas presentes', ['content_id', 'publisher_id', 'act_ref', 'act_signed_on', 'valid_from', 'valid_until', 'effective_at',
        'legal_status', 'economic_status', 'settlement_class', 'alpha', 'expected_minutes', 'shares', 'version_no', 'created_at',
        ...R.RIGHTS_CAPABILITIES.map((c) => `perm_${c}`)].every((c) => cols.includes(c)));
    const permCols = db.prepare('PRAGMA table_info(rights_versions)').all().filter((c) => c.name.startsWith('perm_'));
    ok('permisos sin valor por defecto y NOT NULL', permCols.length === 7 && permCols.every((c) => c.dflt_value === null && c.notnull === 1));
    ok('publishers intacto (semilla única)', P.listPublishers(db).length === 1);

    section('[2] asociación a contentId y editorial');
    const C1 = book('content-r1');
    const v1 = R.createRightsVersion('content-r1', base(), { content: C1, actor: 'ADM', now: '2026-10-01T10:00:00.000Z' });
    ok('versión 1 creada con id del servidor', /^rv-/.test(v1.id) && v1.versionNo === 1 && v1.contentId === 'content-r1');
    ok('editorial y Acta registradas', v1.publisherId === P.CHIBALETE_PUBLISHER_ID && v1.actRef === 'ACTA-2026-001');
    ok('obra inexistente → 404', throwsCode(() => R.createRightsVersion('content-x', base(), { content: null, actor: 'ADM' }), 'content_not_found'));
    ok('editorial inexistente → rechazada', throwsCode(() => R.createRightsVersion('content-r1', base({ publisherId: 'pub-nadie' }), { content: C1, actor: 'ADM' }), 'unknown_publisher'));
    const ina = P.createPublisher({ kind: 'editorial', legalName: 'Inactiva' });
    P.updatePublisher(ina.id, { status: 'inactive' });
    ok('editorial inactiva → rechazada', throwsCode(() => R.createRightsVersion('content-r1', base({ publisherId: ina.id }), { content: { ...C1, publisherId: ina.id }, actor: 'ADM' }), 'inactive_publisher'));
    ok('editorial distinta de la responsable → rechazada', throwsCode(() => R.createRightsVersion('content-r1', base(), { content: { ...C1, publisherId: 'pub-otra' }, actor: 'ADM' }), 'publisher_mismatch'));

    section('[3] historial solo de inserciones');
    const v2 = R.createRightsVersion('content-r1', base({ actRef: 'ACTA-2026-002', effectiveAt: '2026-11-01T05:00:00.000Z', permissions: { ...ALL_YES, tts: false } }), { content: C1, actor: 'ADM' });
    const hist = R.listRightsVersions('content-r1');
    ok('v2 se añade; v1 intacta', hist.length === 2 && hist[0].id === v1.id && hist[0].actRef === 'ACTA-2026-001' && hist[0].permissions.tts === true && v2.versionNo === 2);
    ok('UPDATE bloqueado por trigger', throwsMsg(() => db.prepare("UPDATE rights_versions SET act_ref='X' WHERE id=?").run(v1.id), /append-only/));
    ok('DELETE bloqueado por trigger', throwsMsg(() => db.prepare('DELETE FROM rights_versions WHERE id=?').run(v1.id), /append-only/));
    ok('versión duplicada imposible (UNIQUE)', throwsMsg(() => db.prepare("INSERT INTO rights_versions SELECT 'rv-dup', content_id, version_no, publisher_id, act_ref, act_signed_on, valid_from, valid_until, effective_at, legal_status, economic_status, settlement_class, alpha, expected_minutes, shares, perm_subscription_reading, perm_tts, perm_ai_leo, perm_offline, perm_indexing, perm_promo_fragments, perm_cover_metadata, notes, created_by, created_at FROM rights_versions WHERE id=?").run(v1.id), /UNIQUE/));
    ok('la versión efectiva sigue la activación', R.effectiveVersion(hist, '2026-10-15T12:00:00Z').id === v1.id && R.effectiveVersion(hist, '2026-11-02T12:00:00Z').id === v2.id);

    section('[4] validación');
    const ext = P.createPublisher({ kind: 'tercero', legalName: 'Autora Titular' });
    const liq = (extra) => base({ settlementClass: 'liquidable', alpha: 0.5, expectedMinutes: 120, shares: [{ publisherId: P.CHIBALETE_PUBLISHER_ID, shareBp: 10000 }], ...extra });
    ok('suma ≠ 100 % → rechazada', throwsCode(() => R.validateRightsInput(liq({ shares: [{ publisherId: P.CHIBALETE_PUBLISHER_ID, shareBp: 6000 }, { publisherId: ext.id, shareBp: 3000 }] }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'shares_not_100'));
    ok('participación no entera → rechazada', throwsCode(() => R.validateRightsInput(liq({ shares: [{ publisherId: P.CHIBALETE_PUBLISHER_ID, shareBp: 99.5 }] }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'invalid_shares'));
    ok('titular repetido → rechazado', throwsCode(() => R.validateRightsInput(liq({ shares: [{ publisherId: ext.id, shareBp: 5000 }, { publisherId: ext.id, shareBp: 5000 }] }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'invalid_shares'));
    ok('titular inexistente → rechazado', throwsCode(() => R.validateRightsInput(liq({ shares: [{ publisherId: 'pub-fantasma', shareBp: 10000 }] }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'unknown_share_holder'));
    ok('titular inactivo → rechazado', throwsCode(() => R.validateRightsInput(liq({ shares: [{ publisherId: ina.id, shareBp: 10000 }] }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'inactive_share_holder'));
    ok('liquidable sin matriz → rechazada', throwsCode(() => R.validateRightsInput(liq({ shares: [] }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'shares_required'));
    ok('liquidable sin alpha → rechazada', throwsCode(() => R.validateRightsInput(liq({ alpha: null }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'alpha_required'));
    ok('alpha fuera de (0,1] → rechazada', throwsCode(() => R.validateRightsInput(liq({ alpha: 1.2 }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'invalid_alpha'));
    ok('liquidable sin minutos esperados → rechazada (P1)', throwsCode(() => R.validateRightsInput(liq({ expectedMinutes: null }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'expected_minutes_required'));
    ok('liquidable sin lectura → rechazada', throwsCode(() => R.validateRightsInput(liq({ permissions: { ...ALL_YES, subscription_reading: false } }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'reading_required'));
    ok('podcast liquidable → rechazado (P10)', throwsCode(() => R.validateRightsInput(liq(), { content: { ...C1, tipo: 'podcast' }, publisherById: (id) => P.getPublisher(id) }), 'not_economic_type'));
    ok('capítulo MOOK liquidable → rechazado (P10)', throwsCode(() => R.validateRightsInput(liq(), { content: { ...C1, id: 'content-mook-eaq-x', parentId: 'p' }, publisherById: (id) => P.getPublisher(id) }), 'not_economic_type'));
    ok('vigencia invertida → rechazada', throwsCode(() => R.validateRightsInput(base({ validUntil: '2026-09-01' }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'invalid_validity'));
    ok('fecha imposible → rechazada', throwsCode(() => R.validateRightsInput(base({ validFrom: '2026-02-30' }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'invalid_date'));
    ok('Acta vacía → rechazada', throwsCode(() => R.validateRightsInput(base({ actRef: '  ' }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'invalid_act_ref'));
    ok('campo desconocido → rechazado', throwsCode(() => R.validateRightsInput(base({ royalties: 1 }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'unknown_field'));
    ok('la matriz del 100 % entre dos titulares es válida', R.validateRightsInput(liq({ shares: [{ publisherId: P.CHIBALETE_PUBLISHER_ID, shareBp: 4000 }, { publisherId: ext.id, shareBp: 6000 }] }), { content: C1, publisherById: (id) => P.getPublisher(id) }).shares.length === 2);
    ok('nada se insertó por los rechazos', R.listRightsVersions('content-r1').length === 2);

    section('[5] editorial responsable ≠ titular económico');
    const C2 = book('content-r2');
    const vT = R.createRightsVersion('content-r2', liq({ shares: [{ publisherId: ext.id, shareBp: 10000 }] }), { content: C2, actor: 'ADM' });
    ok('la editorial es Chibalete y quien cobra es el tercero', vT.publisherId === P.CHIBALETE_PUBLISHER_ID && vT.shares[0].publisherId === ext.id);

    section('[6] vigencia y activación temporal');
    ok('día contractual en Bogotá (UTC−5)', R.bogotaDay('2026-10-01T04:59:59Z') === '2026-09-30' && R.bogotaDay('2026-10-01T05:00:00Z') === '2026-10-01');
    const at = (iso) => R.capabilityVerdict(R.listRightsVersions('content-r1'), 'subscription_reading', iso);
    ok('antes de activarse: sin versión efectiva → denegado', at('2026-09-30T12:00:00Z').reason === 'NO_EFFECTIVE_VERSION' && !at('2026-09-30T12:00:00Z').allowed);
    ok('dentro de vigencia → autorizado', at('2026-10-10T12:00:00Z').allowed);
    ok('último día de vigencia (Bogotá) → autorizado', at('2027-10-01T04:59:00Z').allowed);
    ok('vencida → denegada (no vuelve al régimen libre)', at('2027-10-01T05:00:00Z').reason === 'OUT_OF_VALIDITY');
    const C3 = book('content-r3');
    R.createRightsVersion('content-r3', base(), { content: C3, actor: 'ADM' });
    R.createRightsVersion('content-r3', base({ legalStatus: 'suspended', effectiveAt: '2026-12-01T05:00:00.000Z' }), { content: C3, actor: 'ADM' });
    const h3 = R.listRightsVersions('content-r3');
    ok('suspensión posterior deniega desde su activación', R.capabilityVerdict(h3, 'tts', '2026-11-15T12:00:00Z').allowed && R.capabilityVerdict(h3, 'tts', '2026-12-02T12:00:00Z').reason === 'LEGAL_SUSPENDED');

    section('[7] permisos expresos');
    ok('permiso omitido → rechazado', throwsCode(() => R.validateRightsInput(base({ permissions: { subscription_reading: true } }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'permission_not_explicit'));
    ok('permiso no booleano → rechazado', throwsCode(() => R.validateRightsInput(base({ permissions: { ...ALL_YES, tts: 1 } }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'permission_not_explicit'));
    ok('sin bloque de permisos → rechazado', throwsCode(() => R.validateRightsInput(base({ permissions: undefined }), { content: C1, publisherById: (id) => P.getPublisher(id) }), 'permissions_required'));
    const C4 = book('content-r4');
    R.createRightsVersion('content-r4', base({ permissions: { ...ALL_NO, subscription_reading: true, cover_metadata: true } }), { content: C4, actor: 'ADM' });
    const h4 = R.listRightsVersions('content-r4');
    const now = '2026-10-15T12:00:00Z';
    const verdicts = Object.fromEntries(R.RIGHTS_CAPABILITIES.map((c) => [c, R.capabilityVerdict(h4, c, now).allowed]));
    ok('cada capacidad se decide por separado', verdicts.subscription_reading && verdicts.cover_metadata
        && !verdicts.tts && !verdicts.ai_leo && !verdicts.offline && !verdicts.indexing && !verdicts.promo_fragments, JSON.stringify(verdicts));
    ok('motivo explícito al denegar', R.capabilityVerdict(h4, 'tts', now).reason === 'CAPABILITY_NOT_AUTHORIZED');
    ok('obra sin versiones → sin régimen y sin cambio', JSON.stringify(R.capabilityVerdict([], 'tts', now)) === JSON.stringify({ regime: false, allowed: true, reason: 'NO_RIGHTS_REGIME' }));
    ok('capacidad desconocida → error', throwsMsg(() => R.capabilityVerdict(h4, 'printing', now), /desconocida/));

    section('[8] elegibilidad económica');
    const elig = (content, iso) => R.eligibilityFor(content, { at: iso });
    ok('solo publisherId → NO elegible', !elig(book('content-sin-derechos'), now).eligible && elig(book('content-sin-derechos'), now).reasons.includes('NO_RIGHTS_VERSION'));
    ok('obra liquidable completa → elegible', elig(C2, now).eligible, JSON.stringify(elig(C2, now)));
    ok('auxiliar → no elegible', elig(C1, now).reasons.includes('SETTLEMENT_AUXILIARY'));
    ok('fuera de vigencia → no elegible', elig(C2, '2027-10-02T12:00:00Z').reasons.includes('OUT_OF_VALIDITY'));
    ok('contenido no disponible → no elegible', elig({ ...C2, status: 'borrador' }, now).reasons.includes('CONTENT_NOT_AVAILABLE'));
    ok('editorial cambiada en la ficha → no elegible', elig({ ...C2, publisherId: ext.id }, now).reasons.includes('PUBLISHER_MISMATCH'));
    const C5 = book('content-r5');
    R.createRightsVersion('content-r5', liq({ economicStatus: 'retained', legalStatus: 'disputed' }), { content: C5, actor: 'ADM' });
    const e5 = elig(C5, now);
    ok('en disputa / retenida → no elegible con ambos motivos', !e5.eligible && e5.reasons.includes('LEGAL_DISPUTED') && e5.reasons.includes('ECONOMIC_RETAINED'));
    P.updatePublisher(ext.id, { status: 'inactive' });
    ok('titular económico desactivado después → no elegible', elig(C2, now).reasons.includes('SHARE_HOLDER_NOT_ACTIVE'));
    P.updatePublisher(ext.id, { status: 'active' });
    ok('obra inexistente → no elegible', elig(null, now).reasons[0] === 'CONTENT_NOT_FOUND');
    ok('predicado puro: mismas entradas, mismo resultado', JSON.stringify(elig(C2, now)) === JSON.stringify(elig(C2, now)));

    section('[9] guardia off / shadow / enforce');
    const logs = [];
    const mk = (mode, extra = {}) => R.createRightsGate({ log: (m) => logs.push(m), env: { RIGHTS_ENFORCEMENT_MODE: mode }, ...extra });
    let reads = 0;
    const counting = () => { reads++; return R.rightsIndex(); };
    const off = mk('off', { getIndex: counting });
    ok('off: nunca deniega ni lee la base', !off('content-r4', 'tts').deny && reads === 0);
    ok('valor desconocido = off', R.rightsEnforcementMode({ RIGHTS_ENFORCEMENT_MODE: 'yes' }) === 'off' && R.rightsEnforcementMode({}) === 'off');
    const sh = mk('shadow');
    const sr = sh('content-r4', 'tts');
    ok('shadow: no deniega y registra lo que denegaría', !sr.deny && sr.verdict.reason === 'CAPABILITY_NOT_AUTHORIZED' && logs.some((l) => l.includes('[RIGHTS_SHADOW] would_deny contentId=content-r4 capability=tts')));
    const en = mk('enforce');
    ok('enforce: deniega lo no autorizado', en('content-r4', 'tts').deny && en('content-r4', 'ai_leo').deny && en('content-r4', 'offline').deny);
    ok('enforce: permite lo autorizado', !en('content-r4', 'subscription_reading').deny && !en('content-r4', 'cover_metadata').deny);
    ok('enforce: obra sin régimen intacta en las 7 capacidades', R.RIGHTS_CAPABILITIES.every((c) => !en('content-sin-derechos', c).deny));
    ok('enforce: exento (administración) no se deniega', !en('content-r4', 'tts', { exempt: true }).deny);
    ok('silent no registra', (() => { const n = logs.length; en('content-r4', 'tts', { silent: true }); return logs.length === n; })());
    let fails = false;
    let good = 0;
    const flaky = mk('enforce', { getIndex: () => { if (fails) throw new Error('disk'); good++; return R.rightsIndex(); }, refreshMs: 0 });
    flaky('content-r4', 'tts');
    fails = true;
    ok('fallo de lectura: usa el último índice bueno', flaky('content-r4', 'tts').deny && !flaky('content-sin-derechos', 'tts').deny && good === 1);
    const never = mk('enforce', { getIndex: () => { throw new Error('disk'); } });
    ok('sin índice nunca leído: enforce falla cerrado', never('content-sin-derechos', 'tts').verdict.reason === 'RIGHTS_UNAVAILABLE' && never('content-sin-derechos', 'tts').deny);
    ok('… y shadow no deniega', !mk('shadow', { getIndex: () => { throw new Error('disk'); } })('content-sin-derechos', 'tts').deny);
    let t = 0;
    let loads = 0;
    const cachedGate = mk('enforce', { getIndex: () => { loads++; return R.rightsIndex(); }, refreshMs: 1000, now: () => t });
    cachedGate('content-r4', 'tts'); cachedGate('content-r4', 'tts');
    t = 1500; cachedGate('content-r4', 'tts');
    cachedGate.invalidate(); cachedGate('content-r4', 'tts');
    ok('índice cacheado, refresco por tiempo e invalidación', loads === 3, String(loads));

    section('[10] respaldo y restauración de la base migrada');
    const backupPath = path.join(tmp, 'backup', 'royalties.db');
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    await db.backup(backupPath);
    const restored = new Database(backupPath, { readonly: true, fileMustExist: true });
    ok('integrity_check ok', restored.pragma('integrity_check', { simple: true }) === 'ok');
    const dump = (d) => JSON.stringify(d.prepare('SELECT * FROM rights_versions ORDER BY id').all());
    ok('versiones idénticas tras restaurar', dump(restored) === dump(db));
    ok('titulares idénticos tras restaurar', JSON.stringify(restored.prepare('SELECT * FROM publishers ORDER BY id').all()) === JSON.stringify(db.prepare('SELECT * FROM publishers ORDER BY id').all()));
    ok('triggers de inmutabilidad restaurados', restored.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='trigger' AND tbl_name='rights_versions'").get().n === 2);
    ok('migraciones registradas restauradas', JSON.stringify(restored.prepare('SELECT version FROM _migrations ORDER BY version').all().map((r) => r.version)) === JSON.stringify(versions()));
    restored.close();
    const writable = new Database(backupPath);
    ok('la copia restaurada sigue siendo solo de inserciones', throwsMsg(() => writable.prepare('DELETE FROM rights_versions').run(), /append-only/));
    writable.close();
} catch (e) {
    ok('arnés', false, e.stack || e.message);
} finally {
    P.closeRoyaltiesDb();
    fs.rmSync(tmp, { recursive: true, force: true });
}

ok('la base real data-critical/royalties.db no se creó', fs.existsSync(REAL_DB) === realBefore);
console.log(`\nrightsStore — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
