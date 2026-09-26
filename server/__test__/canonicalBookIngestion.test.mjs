/**
 * canonicalBookIngestion.test.mjs — CHP-CONTENT-CANONICAL-2026-01 PARTE 2B.
 *
 * POST /api/content persiste el CanonicalBook como derivado del TXT:
 *   /uploads/<id>/canonical/book.json + canonicalBookUrl/SchemaVersion/Fingerprint.
 *
 * Parte 1: helpers del store (ruta confinada, escritura atómica, determinismo,
 *          paridad de la rendición sobre el corpus de fixtures).
 * Parte 2: server.js REAL contra stores y uploads temporales (TTS en mock).
 * NUNCA toca data/, data-critical/, uploads productivos ni la red.
 *
 *   node server/__test__/canonicalBookIngestion.test.mjs
 */
// Primero: NODE_ENV=test y stores SQLite en un temporal; el hijo los hereda.
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { computeContentFingerprint as fp } from '../contentFingerprint.js';
import { validateCanonicalBook, CANONICAL_SCHEMA_VERSION } from '../content/canonicalBook.js';
import { renderCanonicalBookToPlainText as render } from '../content/canonicalTxtRenderer.js';
import {
    canonicalBookUrlFor, canonicalBookPathFor, isSafeCanonicalContentId, serializeCanonicalBook,
    buildCanonicalBookFromText, writeCanonicalBookAtomic, restoreCanonicalBook,
    readPersistedCanonicalBook, isCanonicalBookCurrent,
} from '../content/canonicalBookStore.js';
import { classifyUploadPath } from '../accessService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const throws = (fn) => { try { fn(); return false; } catch { return true; } };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_canon2b_'));
const up = path.join(tmp, 'uploads');
fs.mkdirSync(up, { recursive: true });

// ─────────────────────────────────────────────────────────────────────────────
console.log('[1] ruta del artefacto (seguridad)');
ok('URL fija por contentId', canonicalBookUrlFor('c-1') === '/uploads/c-1/canonical/book.json');
ok('ruta confinada a uploads', canonicalBookPathFor(up, 'c-1') === path.join(path.resolve(up), 'c-1', 'canonical', 'book.json'));
for (const bad of ['../x', '..', '.', 'a/b', 'a\\b', '/abs', 'C:\\x', 'a.b', '', 'a b', 'x'.repeat(129), null, 7]) {
    ok(`contentId inseguro rechazado: ${JSON.stringify(bad)?.slice(0, 20)}`, !isSafeCanonicalContentId(bad) && throws(() => canonicalBookPathFor(up, bad)));
}

console.log('\n[2] construcción, determinismo y paridad (I13, §20)');
const corpusDir = path.join(REPO, 'utils', '__test__', 'corpus');
const fixtures = fs.readdirSync(corpusDir).filter(f => f.endsWith('.txt'));
ok('hay fixtures de corpus', fixtures.length >= 5, String(fixtures.length));
for (const f of fixtures) {
    const text = fs.readFileSync(path.join(corpusDir, f), 'utf8');
    const F = fp(text);
    const book = buildCanonicalBookFromText({ contentId: 'fx-1', text, contentFingerprint: F });
    const again = buildCanonicalBookFromText({ contentId: 'fx-1', text, contentFingerprint: F });
    const parsed = JSON.parse(serializeCanonicalBook(book));
    ok(`${f}: serialización determinista, parseable, válida y fingerprint(render) == fingerprint(fuente)`,
        serializeCanonicalBook(book) === serializeCanonicalBook(again)
        && validateCanonicalBook(parsed).length === 0
        && fp(render(parsed)) === F);
}
{
    const book = buildCanonicalBookFromText({ contentId: 'fx-1', text: 'Hola.', contentFingerprint: fp('Hola.') });
    const keys = Object.keys(book);
    ok('artefacto autodescriptivo sin fechas/URL/archivo/formato', keys.join(',') === 'schemaVersion,contentId,contentFingerprint,chapters'
        && !/uploads|\.txt|T\d\d:\d\d/.test(serializeCanonicalBook(book)), keys.join(','));
    ok('fingerprint que no corresponde al texto → rechazo (paridad)', throws(() => buildCanonicalBookFromText({ contentId: 'fx-1', text: 'Hola.', contentFingerprint: fp('Adiós.') })));
}

console.log('\n[3] escritura atómica y deshacer (I14)');
{
    const A = buildCanonicalBookFromText({ contentId: 'at-1', text: 'Uno.', contentFingerprint: fp('Uno.') });
    const big = Array.from({ length: 4000 }, (_, i) => `Párrafo número ${i} con algo de texto para que pese.`).join('\n\n');
    const B = buildCanonicalBookFromText({ contentId: 'at-1', text: big, contentFingerprint: fp(big) });
    const target = canonicalBookPathFor(up, 'at-1');
    ok('primer write: sin bytes previos', writeCanonicalBookAtomic(up, A) === null && readPersistedCanonicalBook(up, 'at-1')?.contentFingerprint === fp('Uno.'));
    // Un lector en paralelo nunca debe ver JSON parcial mientras se alternan A/B.
    const { Worker } = await import('node:worker_threads');
    const stop = new Int32Array(new SharedArrayBuffer(4));
    const reader = new Worker(`
        const fs = require('fs'); const { parentPort, workerData } = require('worker_threads');
        let reads = 0, partial = 0;
        while (Atomics.load(workerData.stop, 0) === 0) {
            let raw; try { raw = fs.readFileSync(workerData.target); } catch { continue; }
            reads++; try { JSON.parse(raw); } catch { partial++; }
        }
        parentPort.postMessage({ reads, partial });`, { eval: true, workerData: { target, stop } });
    const result = new Promise(r => reader.once('message', r));
    const WRITES = 30;
    for (let i = 0; i < WRITES; i++) { writeCanonicalBookAtomic(up, i % 2 ? A : B); await sleep(1); }
    Atomics.store(stop, 0, 1);
    const { reads, partial } = await result;
    ok(`lector concurrente: ${reads} lecturas / ${WRITES} escrituras, 0 JSON parcial`, reads > 0 && partial === 0, `partial=${partial}`);
    ok('sin temporales residuales', fs.readdirSync(path.dirname(target)).every(n => n === 'book.json'), fs.readdirSync(path.dirname(target)).join(','));
    writeCanonicalBookAtomic(up, A);
    const prev = writeCanonicalBookAtomic(up, B);
    restoreCanonicalBook(up, 'at-1', prev);
    ok('restore repone los bytes previos', fs.readFileSync(target, 'utf8') === serializeCanonicalBook(A));
    restoreCanonicalBook(up, 'at-1', null);
    ok('restore sin previo retira el artefacto nuevo', !fs.existsSync(target));
}

console.log('\n[4] autorización del artefacto (clasificación de /uploads)');
{
    const url = canonicalBookUrlFor('p-1');
    const ped = { id: 'p-1', tipo: 'guia', texto_plano_url: '/uploads/p-1/g.txt', canonicalBookUrl: url };
    const gen = { id: 'g-1', tipo: 'libro', texto_plano_url: '/uploads/g-1/g.txt', canonicalBookUrl: canonicalBookUrlFor('g-1') };
    ok('pedagogía: el artefacto hereda PEDAGOGY_RESTRICTED (igual que su .txt)',
        classifyUploadPath(url, [ped]) === 'PEDAGOGY_RESTRICTED' && classifyUploadPath(ped.texto_plano_url, [ped]) === 'PEDAGOGY_RESTRICTED');
    ok('general: el artefacto tiene la misma clase que su .txt (GENERAL)',
        classifyUploadPath(gen.canonicalBookUrl, [gen]) === classifyUploadPath(gen.texto_plano_url, [gen]));
    ok('texto retirado: la referencia conservada mantiene la clase (no UNMAPPED)',
        classifyUploadPath(url, [{ ...ped, texto_plano_url: '', contentFingerprint: null }]) === 'PEDAGOGY_RESTRICTED');
    ok('sin referencia sería UNMAPPED (por eso la referencia nunca se retira)', classifyUploadPath(url, [{ id: 'p-1', tipo: 'guia' }]) === 'UNMAPPED_ASSET');
}

// ─────────────────────────────────────────────────────────────────────────────
// Parte 2: server.js real
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'),
};
fs.mkdirSync(P.data, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([{ id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active' }], null, 2));
for (const f of [P.groups, P.schools, P.access]) fs.writeFileSync(f, '[]');
const putText = (rel, text) => { const p = path.join(up, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return `/uploads/${rel}`; };
const LEGACY = { id: 'legacy-1', titulo: 'Legado', tipo: 'libro', standalone: true, status: 'disponible', ttsStatus: 'listo', etiquetas: ['a'], texto_plano_url: putText('legacy-1/orig.txt', 'Capítulo 1\n\nTexto legado.') };
const LEGACY_NOTXT = { id: 'legacy-2', titulo: 'Video legado', tipo: 'video', status: 'disponible', url_recurso: 'https://youtu.be/x' };
const LEGACY_BROKEN = { id: 'legacy-3', titulo: 'Legado roto', tipo: 'libro', status: 'disponible', ttsStatus: 'listo', texto_plano_url: '/uploads/legacy-3/perdido.txt' };
fs.writeFileSync(P.content, JSON.stringify([LEGACY, LEGACY_NOTXT, LEGACY_BROKEN], null, 2));

const PORT = 5400 + (process.pid % 100);
const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT),
        CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: up,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), SESSION_AUTH_MODE: 'off',
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    },
});
let boot = '';
child.stdout.on('data', d => { boot += d; });
child.stderr.on('data', d => { boot += d; });

const H = { 'content-type': 'application/json', 'x-user-id': 'ADM' };
const rec = (id) => JSON.parse(fs.readFileSync(P.content, 'utf8')).find(c => c.id === id);
const bookPath = (id) => path.join(up, id, 'canonical', 'book.json');
const bookRaw = (id) => { try { return fs.readFileSync(bookPath(id), 'utf8'); } catch { return null; } };
const bookMtime = (id) => fs.statSync(bookPath(id)).mtimeMs;
const audioDir = (id) => path.join(up, 'audio', id);
const save = async (body) => {
    const r = await fetch(`${base}/api/content`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const j = await r.json();
    await sleep(2100); // ventana de idempotencia de 2 s por actor+id
    return { status: r.status, body: j };
};
const waitFor = async (pred, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await sleep(100); } return pred(); };
const consistent = (id) => {
    const c = rec(id); const b = JSON.parse(bookRaw(id) ?? 'null');
    return !!c && !!b && c.contentFingerprint === c.canonicalFingerprint && b.contentFingerprint === c.contentFingerprint
        && c.canonicalSchemaVersion === CANONICAL_SCHEMA_VERSION && b.schemaVersion === CANONICAL_SCHEMA_VERSION
        && b.contentId === id && c.canonicalBookUrl === canonicalBookUrlFor(id) && isCanonicalBookCurrent(up, c);
};

try {
    let healthy = false;
    for (let i = 0; i < 150 && !healthy; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* arrancando */ }
        if (!healthy) await sleep(400);
    }
    if (!healthy) throw new Error(`nunca healthy\n${boot.slice(-2000)}`);

    console.log('\n[5] ingestión — creación');
    const T1 = 'Capítulo 1\n\nEl gato duerme.\n\nCapítulo 2\n\nEl perro corre.';
    const B = { id: 'c-1', titulo: 'Uno', tipo: 'libro', standalone: true };
    let r = await save({ ...B, texto_plano_url: putText('c-1/a.txt', T1.replace(/\n/g, '\r\n')),
        canonicalFingerprint: 'sha256:' + 'f'.repeat(64), canonicalBookUrl: '/uploads/otro/x.json', canonicalSchemaVersion: 99 });
    ok('I1 Content nuevo + TXT → 200 y book.json persistido', r.status === 200 && bookRaw('c-1') !== null);
    const b1 = JSON.parse(bookRaw('c-1'));
    ok('I2 fingerprint/schema/contentId correctos', b1.contentFingerprint === fp(T1) && b1.schemaVersion === 1 && b1.contentId === 'c-1' && rec('c-1').contentVersion === 1);
    ok('I7 canonicalFingerprint falso del cliente → ignorado', rec('c-1').canonicalFingerprint === fp(T1));
    ok('I8 canonicalBookUrl falso del cliente → ignorado', rec('c-1').canonicalBookUrl === '/uploads/c-1/canonical/book.json' && rec('c-1').canonicalSchemaVersion === 1 && !fs.existsSync(path.join(up, 'otro')));
    ok('I12 respuesta con metadata canónica y TTS disparado (generando)', r.body.content?.canonicalFingerprint === fp(T1) && r.body.content?.ttsStatus === 'generando');
    ok('I13 JSON persistido parseable, válido y con paridad de rendición', validateCanonicalBook(b1).length === 0 && fp(render(b1)) === fp(T1));
    ok('invariante Content ↔ artefacto', consistent('c-1'));
    ok('I12 el trigger TTS existente se ejecuta tras publicar', await waitFor(() => fs.existsSync(path.join(audioDir('c-1'), 'manifest.json'))));
    await waitFor(() => rec('c-1').ttsStatus === 'listo');

    console.log('\n[6] idempotencia, misma fuente, metadata');
    const raw1 = bookRaw('c-1'); const m1 = bookMtime('c-1');
    await sleep(50);
    r = await save({ ...rec('c-1') });
    ok('I3 mismo POST / mismo texto → sin regeneración', r.status === 200 && bookRaw('c-1') === raw1 && bookMtime('c-1') === m1 && rec('c-1').contentVersion === 1);
    r = await save({ ...rec('c-1'), texto_plano_url: putText('c-1/otro-nombre.txt', '﻿' + T1 + '\n\n') });
    ok('I4 URL distinta / texto igual → misma versión y canonical reutilizado', r.status === 200 && rec('c-1').contentVersion === 1
        && rec('c-1').texto_plano_url.endsWith('otro-nombre.txt') && bookMtime('c-1') === m1 && consistent('c-1'));
    r = await save({ ...rec('c-1'), titulo: 'Uno (editado)', descripcion_corta: 'x' });
    ok('I6 metadata cambia → canonical intacto', r.status === 200 && rec('c-1').titulo === 'Uno (editado)' && bookMtime('c-1') === m1 && consistent('c-1'));
    const sinCampos = { ...rec('c-1') }; for (const k of ['canonicalBookUrl', 'canonicalSchemaVersion', 'canonicalFingerprint']) delete sinCampos[k];
    await save(sinCampos);
    ok('update que omite los campos canónicos no los borra', consistent('c-1') && bookMtime('c-1') === m1);

    console.log('\n[7] texto cambiado');
    const T2 = 'Capítulo 1\n\nEl gato despierta.';
    await waitFor(() => rec('c-1').ttsStatus !== 'generando');
    r = await save({ ...rec('c-1'), texto_plano_url: putText('c-1/b.txt', T2) });
    ok('I5 texto cambia → versión 2 y canonical nuevo con fingerprint B', r.status === 200 && rec('c-1').contentVersion === 2
        && JSON.parse(bookRaw('c-1')).contentFingerprint === fp(T2) && consistent('c-1'));
    ok('I5 TTS encolado para la nueva versión', r.body.content?.ttsStatus === 'generando');
    await waitFor(() => rec('c-1').ttsStatus !== 'generando');

    console.log('\n[8] fail-closed');
    const before = JSON.stringify(rec('c-1')); const rawBefore = bookRaw('c-1');
    r = await save({ ...rec('c-1'), texto_plano_url: '/uploads/c-1/no-existe.txt' });
    ok('lectura falla → 422, Content y artefacto sin cambios', r.status === 422 && r.body.code === 'source_unreadable' && JSON.stringify(rec('c-1')) === before && bookRaw('c-1') === rawBefore);

    // I9: el importador no puede producir un artefacto (id no apto para ruta).
    r = await save({ id: 'c.9', titulo: 'Id con punto', tipo: 'libro', texto_plano_url: putText('c9/a.txt', 'Hola.') });
    ok('I9 importador falla → 422 y el Content no se publica', r.status === 422 && r.body.code === 'canonical_import_failed' && !rec('c.9'));
    ok('I11 fallo canonical → TTS no encolado', !fs.existsSync(audioDir('c.9')));
    ok('fallo canonical → no se borra el TXT subido', fs.existsSync(path.join(up, 'c9', 'a.txt')));

    // I10: la escritura del artefacto falla (canonical/ es un archivo).
    fs.mkdirSync(path.join(up, 'c-10'), { recursive: true });
    fs.writeFileSync(path.join(up, 'c-10', 'canonical'), 'bloqueo');
    r = await save({ id: 'c-10', titulo: 'Diez', tipo: 'libro', texto_plano_url: putText('c-10/a.txt', 'Diez.') });
    ok('I10 write falla → 500 y el Content no se publica', r.status === 500 && r.body.code === 'canonical_write_failed' && !rec('c-10'));
    ok('I11 write falla → TTS no encolado', !fs.existsSync(audioDir('c-10')));

    // content.json no llega a escribirse → el artefacto previo se repone.
    const tmpBlock = `${P.content}.tmp`;
    fs.mkdirSync(tmpBlock);
    const beforeDb = JSON.stringify(rec('c-1')); const rawDb = bookRaw('c-1');
    r = await save({ ...rec('c-1'), texto_plano_url: putText('c-1/c.txt', 'Texto que no llegará.') });
    fs.rmSync(tmpBlock, { recursive: true, force: true });
    ok('content.json falla → 500, artefacto previo repuesto, Content intacto', r.status === 500 && bookRaw('c-1') === rawDb && JSON.stringify(rec('c-1')) === beforeDb && consistent('c-1'));
    r = await save({ id: 'c-11', titulo: 'Once', tipo: 'libro', texto_plano_url: putText('c-11/a.txt', 'Once.') });
    ok('tras el bloqueo el servidor sigue guardando', r.status === 200 && consistent('c-11'));

    console.log('\n[9] texto retirado');
    await waitFor(() => rec('c-11').ttsStatus !== 'generando');
    r = await save({ ...rec('c-11'), texto_plano_url: '' });
    const c11 = rec('c-11');
    ok('TXT retirado → contentFingerprint null; metadata y book.json conservados, ya NO vigentes', r.status === 200 && c11.contentFingerprint === null
        && c11.canonicalFingerprint === fp('Once.') && c11.canonicalBookUrl === canonicalBookUrlFor('c-11') && bookRaw('c-11') !== null && !isCanonicalBookCurrent(up, c11));
    ok('TXT retirado → el artefacto sigue referenciado (no UNMAPPED)', classifyUploadPath(c11.canonicalBookUrl, JSON.parse(fs.readFileSync(P.content, 'utf8'))) !== 'UNMAPPED_ASSET');

    console.log('\n[10] legacy');
    const list = await (await fetch(`${base}/api/content`, { headers: H })).json();
    const leg = list.find(c => c.id === 'legacy-1');
    ok('L1 legacy sin metadata canónica se lee normalmente', !!leg && !('canonicalBookUrl' in leg) && leg.titulo === 'Legado');
    r = await save({ ...LEGACY_NOTXT, titulo: 'Video legado 2' });
    ok('L2 metadata-only sobre Content sin TXT → 200 sin artefacto ni campos', r.status === 200 && rec('legacy-2').titulo === 'Video legado 2'
        && !('canonicalBookUrl' in rec('legacy-2')) && !('contentVersion' in rec('legacy-2')) && !fs.existsSync(path.join(up, 'legacy-2')));
    r = await save({ ...LEGACY, titulo: 'Legado 2' });
    ok('L3 legacy con TXT que pasa por POST → materializa CanonicalBook (versión 1)', r.status === 200 && rec('legacy-1').contentVersion === 1 && consistent('legacy-1')
        && rec('legacy-1').etiquetas?.[0] === 'a' && rec('legacy-1').texto_plano_url === LEGACY.texto_plano_url);
    ok('L3 adopción no dispara TTS (el manifest no cambia de estado)', rec('legacy-1').ttsStatus === 'listo');
    r = await save({ ...LEGACY_BROKEN, titulo: 'Legado roto 2' });
    ok('legacy con TXT ilegible → metadata se guarda igual (adopción best-effort)', r.status === 200 && rec('legacy-3').titulo === 'Legado roto 2' && !('canonicalBookUrl' in rec('legacy-3')));
    const books = fs.readdirSync(up).filter(d => fs.existsSync(path.join(up, d, 'canonical', 'book.json')));
    ok('solo los contenidos que pasaron por POST tienen artefacto (sin backfill)', JSON.stringify(books.sort()) === JSON.stringify(['c-1', 'c-11', 'legacy-1']), books.join(','));

    console.log('\n[11] runtime no exige CanonicalBook (L4)');
    fs.rmSync(bookPath('c-1'));
    const got = await (await fetch(`${base}/api/content`, { headers: H })).json();
    ok('L4 listado sirve el Content aunque falte book.json', got.some(c => c.id === 'c-1' && c.texto_plano_url?.endsWith('b.txt')));
    const txt = await fetch(`${base}${rec('c-1').texto_plano_url}`, { headers: H });
    ok('L4 el TXT fuente se sigue sirviendo igual', txt.ok && (await txt.text()) === T2);
    r = await save({ ...rec('c-1'), titulo: 'Uno (reparado)' });
    ok('artefacto perdido + POST → se vuelve a materializar (misma versión)', r.status === 200 && rec('c-1').contentVersion === 2 && consistent('c-1'));
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\ncanonicalBookIngestion — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
