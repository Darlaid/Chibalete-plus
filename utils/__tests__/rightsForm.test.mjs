/**
 * U1 DERECHOS-UI-01 — núcleo del formulario de derechos (utils/rightsForm.mjs)
 * contrastado con el validador REAL del servidor (rightsStore.validateRightsInput)
 * y con su predicado de elegibilidad. Sin red, sin disco, sin royalties.db.
 * Más una comprobación estructural de la página, la ruta y el enlace.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    RIGHTS_CAPABILITIES, emptyRightsForm, formFromVersion, buildRightsBody, pctToBp, sharesTotalBp,
    bogotaLocalToIso, reasonLabel, serverErrorLabel, ELIGIBILITY_REASON_LABELS,
} from '../rightsForm.mjs';
import * as server from '../../server/royalties/rightsStore.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

// Titulares sintéticos: editorial interna, editorial externa, tercero y una inactiva.
const PUBS = {
    'pub-chibalete-editores': { id: 'pub-chibalete-editores', kind: 'editorial', status: 'active' },
    'pub-ext-lab': { id: 'pub-ext-lab', kind: 'editorial', status: 'active' },
    'pub-autora-lab': { id: 'pub-autora-lab', kind: 'tercero', status: 'active' },
    'pub-baja-lab': { id: 'pub-baja-lab', kind: 'editorial', status: 'inactive' },
};
const publisherById = (id) => PUBS[id] || null;
const ACTIVE = Object.values(PUBS).filter((p) => p.status === 'active').map((p) => p.id);
const book = (publisherId, extra = {}) => ({ id: 'lab-obra', tipo: 'libro', status: 'disponible', publisherId, ...extra });

const allPerms = (v) => Object.fromEntries(RIGHTS_CAPABILITIES.map((c) => [c, v]));
const fullForm = (over = {}) => ({
    ...emptyRightsForm(),
    actRef: 'ACTA-LAB-001', actSignedOn: '2026-10-01', validFrom: '2026-10-01', validUntil: '',
    effectiveAt: '2026-10-01T00:00', legalStatus: 'active', economicStatus: 'active', settlementClass: 'liquidable',
    alphaPct: '70', expectedMinutes: '180',
    shares: [{ publisherId: 'pub-ext-lab', pct: '60' }, { publisherId: 'pub-autora-lab', pct: '40' }],
    permissions: allPerms('yes'),
    ...over,
});
const serverAccepts = (body, content) => {
    try { server.validateRightsInput(body, { content, publisherById }); return null; } catch (e) { return e.code || e.message; }
};
// Versión con la forma de la API a partir de un cuerpo aceptado.
const asVersion = (body, id, versionNo) => ({ id, contentId: 'lab-obra', versionNo, ...server.validateRightsInput(body, { content: book(body.publisherId), publisherById }) });

console.log('\n[1] sin valores por defecto');
{
    const f = emptyRightsForm();
    ok('formulario vacío: sin titulares, sin estados, sin alfa ni minutos', f.shares.length === 0 && !f.legalStatus && !f.economicStatus && !f.settlementClass && f.alphaPct === '' && f.expectedMinutes === '');
    ok('formulario vacío: los 7 permisos sin decidir', RIGHTS_CAPABILITIES.every((c) => f.permissions[c] === ''));
    const r = buildRightsBody(f, { publisherId: 'pub-ext-lab', isEconomicType: true, activePublisherIds: ACTIVE });
    ok('formulario vacío no se envía', r.body === null && r.errors.length >= 6, JSON.stringify(r.errors));
    ok('la editorial responsable no entra sola en la matriz', buildRightsBody(fullForm({ shares: [] , settlementClass: 'auxiliary' }), { publisherId: 'pub-ext-lab', isEconomicType: true, activePublisherIds: ACTIVE }).body.shares.length === 0);
}

console.log('\n[2] editorial interna y externa, varios titulares (aceptados por el servidor)');
{
    for (const pid of ['pub-chibalete-editores', 'pub-ext-lab']) {
        const r = buildRightsBody(fullForm(), { publisherId: pid, isEconomicType: true, activePublisherIds: ACTIVE });
        ok(`${pid}: cuerpo construido`, r.body !== null, JSON.stringify(r.errors));
        ok(`${pid}: el servidor lo acepta`, r.body && serverAccepts(r.body, book(pid)) === null, String(r.body && serverAccepts(r.body, book(pid))));
    }
    const r = buildRightsBody(fullForm(), { publisherId: 'pub-ext-lab', isEconomicType: true, activePublisherIds: ACTIVE });
    ok('matriz 60/40 → 6000 + 4000 pb', JSON.stringify(r.body.shares) === JSON.stringify([{ publisherId: 'pub-ext-lab', shareBp: 6000 }, { publisherId: 'pub-autora-lab', shareBp: 4000 }]));
    ok('alfa 70 % → 0,7; minutos 180', r.body.alpha === 0.7 && r.body.expectedMinutes === 180);
    ok('fecha de efecto en hora de Colombia → UTC', r.body.effectiveAt === '2026-10-01T05:00:00.000Z');
    const v = asVersion(r.body, 'rv-1', 1);
    const elig = server.economicEligibility({ content: book('pub-ext-lab'), versions: [v], publisherById, at: new Date('2026-10-15T12:00:00Z') });
    ok('versión completa → elegible', elig.eligible === true, JSON.stringify(elig.reasons));
    const thirds = buildRightsBody(fullForm({ shares: [{ publisherId: 'pub-ext-lab', pct: '33,34' }, { publisherId: 'pub-autora-lab', pct: '33,33' }, { publisherId: 'pub-chibalete-editores', pct: '33.33' }] }), { publisherId: 'pub-ext-lab', isEconomicType: true, activePublisherIds: ACTIVE });
    ok('tres titulares con decimales (coma o punto) que suman 100 %', thirds.body !== null && serverAccepts(thirds.body, book('pub-ext-lab')) === null, JSON.stringify(thirds.errors));
}

console.log('\n[3] matrices y referencias inválidas: el cliente no envía y el servidor también rechaza');
{
    const ctx = { publisherId: 'pub-ext-lab', isEconomicType: true, activePublisherIds: ACTIVE };
    const bad = buildRightsBody(fullForm({ shares: [{ publisherId: 'pub-ext-lab', pct: '60' }, { publisherId: 'pub-autora-lab', pct: '30' }] }), ctx);
    ok('matriz 60/30 → no se envía, con el total', bad.body === null && bad.errors.some((m) => /suman 90 %/.test(m)), JSON.stringify(bad.errors));
    ok('el servidor rechaza la misma matriz (shares_not_100)', serverAccepts({ ...buildRightsBody(fullForm(), ctx).body, shares: [{ publisherId: 'pub-ext-lab', shareBp: 6000 }, { publisherId: 'pub-autora-lab', shareBp: 3000 }] }, book('pub-ext-lab')) === 'shares_not_100');
    ok('titular repetido → no se envía', buildRightsBody(fullForm({ shares: [{ publisherId: 'pub-ext-lab', pct: '50' }, { publisherId: 'pub-ext-lab', pct: '50' }] }), ctx).body === null);
    ok('titular inactivo → no se envía', buildRightsBody(fullForm({ shares: [{ publisherId: 'pub-baja-lab', pct: '100' }] }), ctx).body === null);
    ok('fila sin titular → no se envía', buildRightsBody(fullForm({ shares: [{ publisherId: '', pct: '100' }] }), ctx).body === null);
    ok('porcentaje con 3 decimales → no se envía', buildRightsBody(fullForm({ shares: [{ publisherId: 'pub-ext-lab', pct: '99.999' }, { publisherId: 'pub-autora-lab', pct: '0.001' }] }), ctx).body === null);
    ok('obra sin editorial responsable → no se envía', buildRightsBody(fullForm(), { ...ctx, publisherId: null }).body === null);
    ok('editorial responsable inactiva → no se envía', buildRightsBody(fullForm(), { ...ctx, publisherId: 'pub-baja-lab' }).body === null);
    ok('el servidor exige que la editorial del Acta sea la responsable (publisher_mismatch)', serverAccepts(buildRightsBody(fullForm(), ctx).body, book('pub-chibalete-editores')) === 'publisher_mismatch');
}

console.log('\n[4] Acta incompleta, vigencia vencida, permisos insuficientes');
{
    const ctx = { publisherId: 'pub-ext-lab', isEconomicType: true, activePublisherIds: ACTIVE };
    const noAct = buildRightsBody(fullForm({ actRef: '  ', actSignedOn: '', effectiveAt: '' }), ctx);
    ok('Acta incompleta: referencia, firma y efecto señalados', noAct.body === null && noAct.errors.length === 3, JSON.stringify(noAct.errors));
    const oneUndecided = buildRightsBody(fullForm({ permissions: { ...allPerms('yes'), offline: '' } }), ctx);
    ok('un permiso sin decidir → no se envía y se nombra', oneUndecided.body === null && oneUndecided.errors.some((m) => /Descarga sin conexión/.test(m)));
    const inverted = buildRightsBody(fullForm({ validFrom: '2026-10-10', validUntil: '2026-10-01' }), ctx);
    ok('fin de vigencia anterior al inicio → no se envía', inverted.body === null);
    const liqNoRead = buildRightsBody(fullForm({ permissions: { ...allPerms('yes'), subscription_reading: 'no' } }), ctx);
    ok('liquidable sin lectura por suscripción → no se envía', liqNoRead.body === null);
    ok('…y el servidor la rechaza (reading_required)', serverAccepts({ ...buildRightsBody(fullForm(), ctx).body, permissions: { ...allPerms(true), subscription_reading: false } }, book('pub-ext-lab')) === 'reading_required');
    const liqMissing = buildRightsBody(fullForm({ alphaPct: '', expectedMinutes: '', shares: [] }), ctx);
    ok('liquidable sin alfa, minutos ni matriz → los tres motivos', liqMissing.body === null && liqMissing.errors.length === 3, JSON.stringify(liqMissing.errors));
    ok('recurso no libro como liquidable → no se envía', buildRightsBody(fullForm(), { ...ctx, isEconomicType: false }).body === null);

    const aux = buildRightsBody(fullForm({ settlementClass: 'auxiliary', permissions: { ...allPerms('no'), cover_metadata: 'yes' }, alphaPct: '', expectedMinutes: '', shares: [] }), ctx);
    ok('auxiliar con permisos mínimos: se registra (el servidor acepta)', aux.body !== null && serverAccepts(aux.body, book('pub-ext-lab')) === null, JSON.stringify(aux.errors));
    const vAux = asVersion(aux.body, 'rv-aux', 1);
    const eAux = server.economicEligibility({ content: book('pub-ext-lab'), versions: [vAux], publisherById, at: new Date('2026-10-15T12:00:00Z') });
    ok('…pero no es elegible, con motivos legibles', !eAux.eligible && ['SETTLEMENT_AUXILIARY', 'READING_NOT_AUTHORIZED', 'ALPHA_MISSING'].every((c) => eAux.reasons.includes(c)) && eAux.reasons.every((c) => !reasonLabel(c).startsWith('Motivo no reconocido')), JSON.stringify(eAux.reasons));

    const expired = buildRightsBody(fullForm({ validFrom: '2025-01-01', validUntil: '2025-12-31', actSignedOn: '2024-12-15', effectiveAt: '2025-01-01T00:00' }), ctx);
    const vExp = asVersion(expired.body, 'rv-exp', 1);
    const eExp = server.economicEligibility({ content: book('pub-ext-lab'), versions: [vExp], publisherById, at: new Date('2026-10-15T12:00:00Z') });
    ok('vigencia vencida: se registra pero no es elegible (OUT_OF_VALIDITY)', expired.body !== null && !eExp.eligible && eExp.reasons.includes('OUT_OF_VALIDITY'), JSON.stringify(eExp.reasons));
}

console.log('\n[5] guardar ≠ activar; versión nueva conserva el historial');
{
    const ctx = { publisherId: 'pub-ext-lab', isEconomicType: true, activePublisherIds: ACTIVE };
    const pending = buildRightsBody(fullForm({ economicStatus: 'pending' }), ctx);
    const v1 = asVersion(pending.body, 'rv-1', 1);
    const e1 = server.economicEligibility({ content: book('pub-ext-lab'), versions: [v1], publisherById, at: new Date('2026-10-15T12:00:00Z') });
    ok('guardada con estado económico pendiente → no elegible (ECONOMIC_PENDING)', pending.body !== null && !e1.eligible && e1.reasons.join() === 'ECONOMIC_PENDING', JSON.stringify(e1.reasons));
    const next = formFromVersion(v1);
    ok('partir de una versión copia todo salvo la fecha de efecto', next.actRef === 'ACTA-LAB-001' && next.alphaPct === '70' && next.shares.length === 2 && next.shares[0].pct === '60' && next.effectiveAt === '' && next.permissions.tts === 'yes');
    const v2body = buildRightsBody({ ...next, economicStatus: 'active', effectiveAt: '2026-10-20T08:30' }, ctx).body;
    const v2 = asVersion(v2body, 'rv-2', 2);
    const v1Before = JSON.stringify(v1);
    const before = server.economicEligibility({ content: book('pub-ext-lab'), versions: [v1, v2], publisherById, at: new Date('2026-10-18T12:00:00Z') });
    const after = server.economicEligibility({ content: book('pub-ext-lab'), versions: [v1, v2], publisherById, at: new Date('2026-10-25T12:00:00Z') });
    ok('antes de su efecto rige la v1 (pendiente)', before.versionId === 'rv-1' && !before.eligible);
    ok('después rige la v2 (activa) y es elegible', after.versionId === 'rv-2' && after.eligible, JSON.stringify(after.reasons));
    ok('la v1 no cambia', JSON.stringify(v1) === v1Before);
}

console.log('\n[6] conversiones y etiquetas');
{
    ok('pctToBp', pctToBp('33,33') === 3333 && pctToBp('100') === 10000 && pctToBp('0.01') === 1 && pctToBp('1.234') === null && pctToBp('') === null && pctToBp('-5') === null);
    ok('sharesTotalBp ignora filas ilegibles', sharesTotalBp([{ pct: '50' }, { pct: 'x' }, { pct: '25,5' }]) === 7550);
    ok('bogotaLocalToIso', bogotaLocalToIso('2026-11-01T00:00') === '2026-11-01T05:00:00.000Z' && bogotaLocalToIso('2026-11-01') === null);
    const src = read('server/royalties/rightsStore.mjs');
    const reasonCodes = new Set([...src.matchAll(/reasons\.push\('([A-Z_]+)'\)/g)].map((m) => m[1]));
    for (const s of server.LEGAL_STATUSES.filter((x) => x !== 'active')) reasonCodes.add(`LEGAL_${s.toUpperCase()}`);
    for (const s of server.ECONOMIC_STATUSES.filter((x) => x !== 'active')) reasonCodes.add(`ECONOMIC_${s.toUpperCase()}`);
    for (const s of server.SETTLEMENT_CLASSES.filter((x) => x !== 'liquidable')) reasonCodes.add(`SETTLEMENT_${s.toUpperCase()}`);
    const missing = [...reasonCodes].filter((c) => !ELIGIBILITY_REASON_LABELS[c]);
    ok(`los ${reasonCodes.size} motivos del servidor tienen texto`, missing.length === 0, missing.join(','));
    const errCodes = [...new Set([...src.matchAll(/bad\('([a-z_0-9]+)'/g)].map((m) => m[1]))];
    const missingErr = errCodes.filter((c) => serverErrorLabel(c, '__fallback__') === '__fallback__');
    ok(`los ${errCodes.length} códigos de error del validador tienen texto`, missingErr.length === 0, missingErr.join(','));
    ok('las capacidades coinciden con las del servidor', JSON.stringify(RIGHTS_CAPABILITIES) === JSON.stringify(server.RIGHTS_CAPABILITIES));
}

console.log('\n[7] integración (estructural): solo administración, solo endpoints existentes, append-only');
{
    const page = read('pages/AdminDerechos.tsx');
    const ds = read('services/dataService.ts');
    const block = ds.slice(ds.indexOf('U1 DERECHOS-UI-01'), ds.indexOf('CHP-LIB-01'));
    ok('página: guarda de rol administrador', /user\.roles\.includes\('administrador'\)/.test(page));
    ok('página: sin edición ni borrado de versiones', !/method:\s*'(PUT|PATCH|DELETE)'/.test(page) && !/deleteRights|updateRights/.test(page + block));
    ok('dataService: solo GET y POST de /admin/rights', block.includes('/admin/rights/') && !/'(PUT|PATCH|DELETE)'/.test(block) && (block.match(/method: 'POST'/g) || []).length === 1);
    ok('ruta /admin/derechos/:contentId con acceso admin', /path: '\/admin\/derechos\/:contentId',\s*\n\s*access: 'admin'/.test(read('config/routePermissions.ts')));
    ok('App: ruta protegida con getRouteAccess', /<Route path="\/admin\/derechos\/:contentId"[\s\S]{0,120}getRouteAccess\('\/admin\/derechos\/:contentId'\)/.test(read('App.tsx')));
    ok('catálogo administrativo: enlace «Derechos» solo para libros', /\{isBookForm\(content\.tipo\) && \(\s*<RouterLink to=\{`\/admin\/derechos\//.test(read('pages/SubirContenido.tsx')));
    const readerSurfaces = fs.readdirSync(path.join(ROOT, 'pages')).filter((f) => /\.tsx$/.test(f) && f !== 'AdminDerechos.tsx')
        .filter((f) => /getRights|createRightsVersion|rightsForm/.test(read(`pages/${f}`)));
    ok('ninguna otra página usa los datos de derechos', readerSurfaces.length === 0, readerSurfaces.join(','));
}

console.log(`\nrightsForm — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
