/**
 * libraryClientContract.test.mjs
 * CHP-V6-LIBRARY-INSTITUTIONAL-01 / Etapa 11B-3 §§2, 17, 18, 27, 28, 29.
 *
 * Une las dos mitades: los PAYLOADS y los PARSERS que usa el navegador
 * (`utils/libraryLayers.mjs`, los mismos que llama `dataService`) hablando con
 * el SERVIDOR REAL de 11B-2. No hay respuestas inventadas ni handlers
 * replicados: si el contrato del cliente se desviara del backend, esto falla.
 *
 * Qué NO cubre y por qué: la identidad. En este harness el servidor corre con
 * `SESSION_AUTH_MODE=off`, así que el sujeto viaja en `x-user-id` — eso es del
 * harness, no del producto. Que el navegador jamás emita ese header lo prueba
 * `browserNoXUserIdGuard`, y que estas rutas exijan sesión firmada en
 * compat/enforce lo prueba `libraryInstitutionalPersonal`. Aquí se prueba la
 * otra cosa: que el CUERPO que manda el cliente es exactamente el que el
 * servidor espera, y que lo que devuelve es exactamente lo que el cliente sabe
 * leer.
 *
 * Aislamiento: `fs.mkdtemp`. Stores reales — 0 lecturas, 0 escrituras.
 *
 *   node server/__test__/libraryClientContract.test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    LIBRARY_PATHS,
    parseLayerView, layerViewState, layerReferences, isLayerViewEmpty,
    savedReferenceIdByBookId, viewWithoutReference,
    personalReferencePayload, institutionalReferencePayload,
    institutionalCollectionPayload, institutionalCollectionPatch,
    libraryErrorText, LIBRARY_ERROR_TEXT,
    presentCollection,
} from '../../utils/libraryLayers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const section = (t) => console.log(`\n${t}`);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ────────────────────────────────────────────────────────────────────────────
const ORG_A = 'org-alfa', ORG_B = 'org-beta';
const EXPIRES_IN_MS = 4500;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_libui_'));
const P = {
    data: path.join(tmp, 'data'),
    users: path.join(tmp, 'users.json'),
    groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'),
    uploads: path.join(tmp, 'uploads'),
};
fs.mkdirSync(P.data, { recursive: true });
fs.mkdirSync(P.uploads, { recursive: true });
const LIBRARY = path.join(P.data, 'library_db.json');

const SCHOOLS = [{ id: ORG_A, name: 'Colegio Alfa' }, { id: ORG_B, name: 'Colegio Beta' }];
const GROUPS = [
    { id: 'g-a1', type: 'course', organizationId: ORG_A, mediatorIds: ['med-a'], memberIds: ['lec-a', 'lec-exp'] },
    { id: 'g-b1', type: 'course', organizationId: ORG_B, mediatorIds: [], memberIds: ['lec-b'] },
];
const USERS = [
    { id: 'lec-a',     roles: ['lector'],        organizationId: ORG_A, accountStatus: 'active' },
    { id: 'lec-exp',   roles: ['lector'],        organizationId: ORG_A, accountStatus: 'active' },
    { id: 'med-a',     roles: ['mediador'],      organizationId: ORG_A, accountStatus: 'active', mediatorKind: 'teacher' },
    { id: 'adm-a',     roles: ['administrador'], organizationId: ORG_A, accountStatus: 'active' },
    { id: 'lec-b',     roles: ['lector'],        organizationId: ORG_B, accountStatus: 'active' },
    { id: 'lec-noorg', roles: ['lector'],                               accountStatus: 'active' },
];
const CONTENT = [
    { id: 'c-1',        titulo: 'Uno',        autor: 'A', tipo: 'libro', status: 'disponible' },
    { id: 'c-2',        titulo: 'Dos',        autor: 'B', tipo: 'libro', status: 'disponible' },
    // §18 — el mediador SÍ tiene derecho sobre este; el lector de su misma
    // organización NO. Es el caso que el pliego declara esperado.
    { id: 'c-solo-med', titulo: 'Solo guía',  autor: 'C', tipo: 'libro', status: 'disponible' },
    { id: 'c-nadie',    titulo: 'De nadie',   autor: 'D', tipo: 'libro', status: 'disponible' },
    { id: 'c-temporal', titulo: 'Temporal',   autor: 'E', tipo: 'libro', status: 'disponible' },
];
const ACCESS = [
    { id: 'r-g-a1', scope: 'group', scopeId: 'g-a1',    titleIds: ['c-1', 'c-2'],   collectionIds: [] },
    { id: 'r-med',  scope: 'user',  scopeId: 'med-a',   titleIds: ['c-solo-med'],   collectionIds: [] },
    { id: 'r-g-b1', scope: 'group', scopeId: 'g-b1',    titleIds: ['c-1'],          collectionIds: [] },
    { id: 'r-exp',  scope: 'user',  scopeId: 'lec-exp', titleIds: ['c-temporal'],   collectionIds: [], expiresAt: Date.now() + EXPIRES_IN_MS },
];

fs.writeFileSync(P.users, JSON.stringify(USERS, null, 2));
fs.writeFileSync(P.groups, JSON.stringify(GROUPS, null, 2));
fs.writeFileSync(P.schools, JSON.stringify(SCHOOLS, null, 2));
fs.writeFileSync(P.access, JSON.stringify(ACCESS, null, 2));
fs.writeFileSync(P.content, JSON.stringify(CONTENT, null, 2));
fs.writeFileSync(LIBRARY, JSON.stringify({ collections: [], references: [] }, null, 2));

function spawnApi(port) {
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env,
            NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: P.data,
            USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
            ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
            USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
            ACCESS_FALLBACK_MODE: 'restricted',
            SESSION_AUTH_MODE: 'off',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '',
        },
    });
    let bootLog = '';
    child.stdout.on('data', d => { bootLog += d; });
    child.stderr.on('data', d => { bootLog += d; });
    child._boot = () => bootLog;
    return child;
}

async function waitHealthy(base, child) {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${child._boot().slice(-2000)}`);
        try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch { /* arrancando */ }
        await sleep(400);
    }
    throw new Error(`nunca healthy\n${child._boot().slice(-2000)}`);
}

const PORT = 4690 + (process.pid % 70);
const BASE = `http://127.0.0.1:${PORT}`;
let api;

/**
 * Réplica fiel de los métodos de `dataService`: mismo path, mismo método y —lo
 * que importa— el MISMO payload, construido por las mismas funciones puras.
 * `x-user-id` es del harness (ver cabecera), no del cliente.
 */
const H = (userId) => ({ 'content-type': 'application/json', 'x-user-id': userId });

async function readLayerView(userId, pathname, layer) {
    const res = await fetch(`${BASE}/api${pathname}`, { headers: H(userId) });
    if (!res.ok) return { httpOk: false, status: res.status, view: null, raw: await res.text() };
    const raw = await res.text();
    return { httpOk: true, status: res.status, view: parseLayerView(JSON.parse(raw), layer), raw };
}
async function writeLibrary(userId, pathname, method, payload) {
    const res = await fetch(`${BASE}/api${pathname}`, {
        method, headers: H(userId),
        body: payload === undefined ? undefined : JSON.stringify(payload),
    });
    let body = null;
    try { body = JSON.parse(await res.text()); } catch { body = null; }
    return { ok: res.ok, status: res.status, body };
}

const getPersonal = (u) => readLayerView(u, LIBRARY_PATHS.personal, 'PERSONAL');
const getInstitutional = (u) => readLayerView(u, LIBRARY_PATHS.institutional, 'INSTITUTIONAL');
const addPersonal = (u, bookId) => writeLibrary(u, LIBRARY_PATHS.personalReferences, 'POST', personalReferencePayload(bookId));
const delPersonal = (u, refId) => writeLibrary(u, `${LIBRARY_PATHS.personalReferences}/${refId}`, 'DELETE');
const createCollection = (u, name) => writeLibrary(u, LIBRARY_PATHS.institutionalCollections, 'POST', institutionalCollectionPayload(name));
const patchCollection = (u, id, patch) => writeLibrary(u, `${LIBRARY_PATHS.institutionalCollections}/${id}`, 'PUT', institutionalCollectionPatch(patch));
const addInstitutional = (u, bookId, colId) => writeLibrary(u, LIBRARY_PATHS.institutionalReferences, 'POST', institutionalReferencePayload(bookId, colId));
const delInstitutional = (u, refId) => writeLibrary(u, `${LIBRARY_PATHS.institutionalReferences}/${refId}`, 'DELETE');

const ids = (view) => layerReferences(view).map(r => r.bookId).sort();

// ────────────────────────────────────────────────────────────────────────────
async function main() {
    api = spawnApi(PORT);
    await waitHealthy(BASE, api);

    // ── §2 el parser del cliente entiende la respuesta REAL ─────────────────
    section('[2] LIBRARY_CLIENT_CONTRACT: el parser entiende la respuesta real');
    {
        const p = await getPersonal('lec-a');
        ok('GET personal responde 200', p.httpOk, String(p.status));
        ok('§2 · el parser del cliente NO la rechaza', p.view !== null, p.raw?.slice(0, 200));
        ok('PUI1 · una biblioteca sin referencias es EMPTY, no ERROR',
            layerViewState({ status: 'ready', view: p.view }) === 'empty');

        const i = await getInstitutional('lec-a');
        ok('GET institutional responde 200', i.httpOk, String(i.status));
        ok('§2 · el parser del cliente NO la rechaza', i.view !== null, i.raw?.slice(0, 200));
        ok('IUI1 · vista institucional vacía → EMPTY',
            layerViewState({ status: 'ready', view: i.view }) === 'empty');
    }

    // ── IUI10 sin organización ──────────────────────────────────────────────
    section('[IUI10/§13] sin organización: empty state neutro, no error');
    {
        const i = await getInstitutional('lec-noorg');
        ok('IUI10 · responde 200 con vista interpretable', i.httpOk && i.view !== null, String(i.status));
        ok('IUI10 · el cliente la clasifica como EMPTY',
            layerViewState({ status: 'ready', view: i.view }) === 'empty');
        ok('IUI10 · la respuesta no nombra ninguna organización',
            !i.raw.includes(ORG_A) && !i.raw.includes(ORG_B) && !i.raw.includes('Colegio'), i.raw.slice(0, 200));
    }

    // ── IUI4/§16 gestión institucional con los payloads del cliente ─────────
    section('[IUI4/§16] el servidor acepta EXACTAMENTE los payloads del cliente');
    let colId = null, refC1 = null, refSoloMed = null;
    {
        const c = await createCollection('med-a', '  Club de lectura  ');
        colId = c.body?.id ?? null;
        ok('IUI4 · crear colección con institutionalCollectionPayload → 201', c.status === 201 && !!colId, String(c.status));
        ok('IUI4 · el nombre llegó normalizado, sin campos extra', c.body?.name === 'Club de lectura');
        ok('§25 · la respuesta TRAE contextId… ', typeof c.body?.contextId === 'string');
        ok('§25 · …y la proyección del cliente lo descarta',
            !JSON.stringify(presentCollection(c.body)).includes(ORG_A));

        const a1 = await addInstitutional('med-a', 'c-1', colId);
        refC1 = a1.body?.reference?.id ?? null;
        ok('IUI4 · añadir referencia a una colección → 201', a1.status === 201 && !!refC1, String(a1.status));

        const a2 = await addInstitutional('med-a', 'c-solo-med', colId);
        refSoloMed = a2.body?.reference?.id ?? null;
        ok('§18 · el mediador cura un libro que solo él tiene autorizado', a2.status === 201 && !!refSoloMed);

        const pub = await patchCollection('med-a', colId, { published: true });
        ok('§16 · publicar la colección con institutionalCollectionPatch → 200', pub.status === 200, String(pub.status));
        ok('§16 · la colección queda publicada', pub.body?.published === true);

        const dup = await addInstitutional('med-a', 'c-1', colId);
        ok('idempotencia · re-añadir devuelve 200 con created:false',
            dup.status === 200 && dup.body?.created === false, String(dup.status));
    }

    // ── IUI2/IUI3/§18 la curaduría común se cruza con el derecho individual ──
    section('[IUI2/IUI3/§18] curaduría común ∩ entitlement individual');
    {
        const med = await getInstitutional('med-a');
        ok('IUI2 · el mediador ve lo que curó y tiene autorizado',
            ids(med.view).join(',') === 'c-1,c-solo-med', JSON.stringify(ids(med.view)));

        const lec = await getInstitutional('lec-a');
        ok('IUI2 · el lector ve la colección publicada', layerViewState({ status: 'ready', view: lec.view }) === 'content');
        ok('§18 · el lector ve c-1, que sí tiene autorizado', ids(lec.view).includes('c-1'));
        ok('IUI3/§18 · …y NO ve c-solo-med, curado pero sin entitlement propio',
            !ids(lec.view).includes('c-solo-med'), JSON.stringify(ids(lec.view)));
        ok('§18 · el mismo libro curado produce vistas distintas por lector, sin que sea un error',
            ids(med.view).length === 2 && ids(lec.view).length === 1);

        ok('IUI9 · la respuesta del lector no lleva metadata cross-tenant',
            !lec.raw.includes(ORG_A) && !lec.raw.includes(ORG_B)
            && !lec.raw.includes('g-a1') && !lec.raw.includes('r-g-a1')
            && !lec.raw.includes('med-a'), lec.raw.slice(0, 300));

        const beta = await getInstitutional('lec-b');
        ok('IUI9 · el lector de la otra organización no ve nada de esta',
            isLayerViewEmpty(beta.view) && !beta.raw.includes('Club de lectura'));
    }

    // ── IUI6 el 403 del servidor manda ──────────────────────────────────────
    section('[IUI6/§15] la UI no presume éxito: el backend decide');
    {
        const r = await createCollection('lec-a', 'Intruso');
        ok('IUI6 · un lector recibe 403 al escribir', r.status === 403, String(r.status));
        const msg = libraryErrorText(r.status, r.body);
        ok('IUI6 · el cliente lo traduce a un mensaje neutro', msg === LIBRARY_ERROR_TEXT.forbidden, msg);
        ok('§25 · el cuerpo del 403 SÍ trae el scope_id de la organización…',
            r.body?.scope_id === ORG_A, JSON.stringify(r.body));
        ok('§25 · …y el mensaje que vería el usuario no lo contiene',
            !msg.includes(ORG_A) && !msg.includes('scope'), msg);

        const sinOrg = await createCollection('lec-noorg', 'Intruso');
        ok('IUI10 · sin organización también es 403', sinOrg.status === 403, String(sinOrg.status));
        ok('IUI10 · y el mensaje sigue siendo neutro',
            libraryErrorText(sinOrg.status, sinOrg.body) === LIBRARY_ERROR_TEXT.forbidden);

        const after = await getInstitutional('lec-a');
        ok('IUI6 · nada del intento fallido aparece en la vista', !after.raw.includes('Intruso'));
    }

    // ── PUI3/PUI4/PUI5 acciones personales ──────────────────────────────────
    section('[PUI3–PUI5] guardar, reguardar y quitar');
    let personalRef = null;
    {
        const a = await addPersonal('lec-a', 'c-1');
        personalRef = a.body?.reference?.id ?? null;
        ok('PUI3 · guardar un libro autorizado con { bookId } → 201', a.status === 201 && !!personalRef, String(a.status));

        const again = await addPersonal('lec-a', 'c-1');
        ok('PUI4 · guardar otra vez → 200 con created:false (no es un error)',
            again.status === 200 && again.body?.created === false, String(again.status));

        const v = await getPersonal('lec-a');
        ok('PUI2 · la vista personal lo muestra', ids(v.view).join(',') === 'c-1', JSON.stringify(ids(v.view)));
        ok('PUI4 · y el mapa de «guardado» lo resuelve a su referencia',
            savedReferenceIdByBookId(v.view).get('c-1') === personalRef);

        const d = await delPersonal('lec-a', personalRef);
        ok('PUI5 · quitar → 200', d.status === 200, String(d.status));
        const after = await getPersonal('lec-a');
        ok('PUI5 · desaparece de la vista del servidor', isLayerViewEmpty(after.view));
        ok('PUI5 · el cálculo local coincide con el servidor',
            JSON.stringify(viewWithoutReference(v.view, personalRef)) === JSON.stringify(after.view));
        ok('PUI5 · quitar NO borró el contenido canónico',
            JSON.parse(fs.readFileSync(P.content, 'utf8')).some(c => c.id === 'c-1'));

        const ajena = await delPersonal('lec-b', personalRef);
        ok('PUI5 · una cuenta ajena no puede quitar esa referencia', ajena.status === 404, String(ajena.status));
    }

    // ── PUI5b/PUI8 entitlement y roles ──────────────────────────────────────
    section('[PUI5/PUI8/§22] ROLE_BYPASS: ZERO');
    {
        const noAuth = await addPersonal('lec-a', 'c-nadie');
        ok('§8 · guardar un libro sin entitlement → 403', noAuth.status === 403, String(noAuth.status));
        ok('§8 · el cliente lo traduce sin filtrar reglas',
            libraryErrorText(noAuth.status, noAuth.body) === LIBRARY_ERROR_TEXT.not_available);

        const admin = await addPersonal('adm-a', 'c-nadie');
        ok('PUI8 · el administrador tampoco puede', admin.status === 403, String(admin.status));
        const med = await addPersonal('med-a', 'c-nadie');
        ok('PUI8 · el mediador tampoco', med.status === 403, String(med.status));

        const adminView = await getPersonal('adm-a');
        ok('PUI8 · el administrador no recibe una biblioteca personal ampliada',
            isLayerViewEmpty(adminView.view));
        const adminInst = await getInstitutional('adm-a');
        ok('PUI8 · …ni una institucional ampliada: solo lo que su entitlement autoriza',
            !ids(adminInst.view).includes('c-solo-med'), JSON.stringify(ids(adminInst.view)));
    }

    // ── §29 aislamiento entre capas contra el store real ────────────────────
    section('[IUI7/IUI8/§29] LIBRARY_LAYER_ISOLATION: VERIFIED');
    {
        const add = await addPersonal('med-a', 'c-1');
        const personalRefId = add.body?.reference?.id;
        ok('§29 · el mismo bookId vive a la vez en PERSONAL e INSTITUTIONAL',
            add.status === 201 && !!personalRefId && personalRefId !== refC1);

        const doc = JSON.parse(fs.readFileSync(LIBRARY, 'utf8'));
        ok('§29 · 1 entidad de contenido, N referencias (no se duplicó el libro)',
            doc.references.filter(r => r.bookId === 'c-1').length === 2
            && JSON.parse(fs.readFileSync(P.content, 'utf8')).filter(c => c.id === 'c-1').length === 1);

        const instAntes = await getInstitutional('med-a');
        const personalAntes = await getPersonal('med-a');

        // IUI8 — quitar de PERSONAL no toca INSTITUTIONAL.
        ok('IUI8 · quitar de PERSONAL → 200', (await delPersonal('med-a', personalRefId)).status === 200);
        const instTrasPersonal = await getInstitutional('med-a');
        ok('IUI8 · INSTITUTIONAL queda intacta',
            JSON.stringify(instTrasPersonal.view) === JSON.stringify(instAntes.view));
        ok('IUI8 · PERSONAL sí cambió', isLayerViewEmpty((await getPersonal('med-a')).view));

        // IUI7 — quitar de INSTITUTIONAL no toca PERSONAL ni el editorial.
        await addPersonal('med-a', 'c-1');
        const personalAntes2 = await getPersonal('med-a');
        ok('IUI7 · quitar de INSTITUTIONAL → 200', (await delInstitutional('med-a', refSoloMed)).status === 200);
        const personalTrasInst = await getPersonal('med-a');
        ok('IUI7 · PERSONAL queda intacta',
            JSON.stringify(personalTrasInst.view) === JSON.stringify(personalAntes2.view));
        ok('IUI7 · INSTITUTIONAL sí cambió',
            !ids((await getInstitutional('med-a')).view).includes('c-solo-med'));
        ok('§29 · el id de una capa nunca alcanza a la otra',
            (await delPersonal('med-a', refC1)).status === 404
            && (await delInstitutional('med-a', layerReferences(personalAntes2.view)[0].id)).status === 404);

        const ed = await fetch(`${BASE}/api/library/editorial`);
        const edBody = await ed.json();
        ok('§20 · la capa editorial sigue respondiendo y sigue vacía (nadie la tocó)',
            ed.status === 200 && edBody.layer === 'EDITORIAL'
            && edBody.collections.length === 0 && edBody.unassigned.length === 0);
        ok('§20 · el editorial no muestra nada de las otras capas',
            !JSON.stringify(edBody).includes('Club de lectura'));

        ok('§19 · quitar referencias no tocó access_db',
            fs.readFileSync(P.access, 'utf8') === JSON.stringify(ACCESS, null, 2));
        ok('§19 · …ni content.json',
            fs.readFileSync(P.content, 'utf8') === JSON.stringify(CONTENT, null, 2));
        ok('§19 · …ni availableContentIds de los grupos',
            fs.readFileSync(P.groups, 'utf8') === JSON.stringify(GROUPS, null, 2));
    }

    // ── PUI6/§11 entitlement expirado ───────────────────────────────────────
    section('[PUI6/§11] EXPIRED_PERSONAL_REFERENCE: NOT_RENDERED');
    {
        const add = await addPersonal('lec-exp', 'c-temporal');
        ok('§11 · con derecho vigente se guarda', add.status === 201, String(add.status));
        const antes = await getPersonal('lec-exp');
        ok('§11 · y se ve', ids(antes.view).includes('c-temporal'));
        const mapaAntes = savedReferenceIdByBookId(antes.view);
        ok('§11 · la pestaña Libros lo marcaría como guardado', !!mapaAntes.get('c-temporal'));

        await sleep(Math.max(0, ACCESS.find(r => r.id === 'r-exp').expiresAt - Date.now()) + 900);

        const despues = await getPersonal('lec-exp');
        ok('PUI6 · tras expirar, el servidor ya no lo devuelve',
            !ids(despues.view).includes('c-temporal'), JSON.stringify(ids(despues.view)));
        ok('PUI6 · el cliente lo clasifica como EMPTY, no como contenido',
            layerViewState({ status: 'ready', view: despues.view }) === 'empty');
        ok('PUI6 · deja de estar marcado como guardado',
            savedReferenceIdByBookId(despues.view).get('c-temporal') === undefined);
        ok('PUI6 · la referencia SIGUE en el store (inerte, no borrada)',
            JSON.parse(fs.readFileSync(LIBRARY, 'utf8')).references
                .some(r => r.layer === 'PERSONAL' && r.contextId === 'lec-exp' && r.bookId === 'c-temporal'));
        ok('PUI6 · re-guardarlo ya no se permite',
            (await addPersonal('lec-exp', 'c-temporal')).status === 403);
    }

    // ── §17 la fuente para curar es my-catalog ──────────────────────────────
    section('[17] la fuente para curar es el conjunto autorizado del actor');
    {
        const res = await fetch(`${BASE}/api/content/my-catalog`, { headers: H('med-a') });
        const body = await res.json();
        const catalogIds = (body.catalog ?? []).map(c => c.id).sort();
        ok('§17 · my-catalog del mediador es su conjunto autorizado',
            catalogIds.join(',') === 'c-1,c-2,c-solo-med', JSON.stringify(catalogIds));
        ok('§17 · no incluye el libro que nadie tiene autorizado', !catalogIds.includes('c-nadie'));
        ok('§17 · ofrecer solo ese conjunto impide curar fuera del entitlement propio',
            !catalogIds.includes('c-temporal'));
    }

    // ── integridad final ────────────────────────────────────────────────────
    section('[final] el store compartido sigue sano');
    {
        const doc = JSON.parse(fs.readFileSync(LIBRARY, 'utf8'));
        ok('library_db es JSON válido con su forma contractual',
            Array.isArray(doc.references) && Array.isArray(doc.collections));
        ok('no queda lock huérfano', !fs.existsSync(`${LIBRARY}.lock`));
        ok('no queda temporal de escritura', !fs.existsSync(`${LIBRARY}.tmp`));
        ok('el padrón de usuarios no fue tocado',
            fs.readFileSync(P.users, 'utf8') === JSON.stringify(USERS, null, 2));
    }
}

main()
    .catch(e => { console.error('\n  ✗ error fatal:', e.message, e.stack); fail++; })
    .finally(async () => {
        try { api?.kill('SIGKILL'); } catch { /* ya muerto */ }
        await sleep(300);
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* Windows retiene a veces */ }
        console.log(`\nlibraryClientContract: ${pass} passed, ${fail} failed`);
        process.exit(fail === 0 ? 0 : 1);
    });
