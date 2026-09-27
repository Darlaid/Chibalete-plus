/**
 * canonicalBookEpubIngestion.test.mjs — CHP-CONTENT-CANONICAL-2026-01 PARTE 3C.2.
 *
 * EPUB como formato de ingestión, en local:
 *   Parte 1: materializeCanonicalMedia (magic bytes, sha256, dedup, fingerprint).
 *   Parte 2: canonicalBookStore (media + book.txt + book.json atómicos, rollback).
 *   Parte 3: autorización de canonical/media (convención de dueño).
 *   Parte 4: server.js REAL — /api/upload (.epub) y POST /api/content (epub_url),
 *            contra stores y uploads temporales (TTS en mock).
 * EPUB sintéticos en memoria. NUNCA toca data/, data-critical/, uploads
 * productivos ni la red.
 *
 *   node server/__test__/canonicalBookEpubIngestion.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import { makeEpub, xhtml, IMG } from './helpers/epubFixture.mjs';
import { computeContentFingerprint as fp } from '../contentFingerprint.js';
import { validateCanonicalBook } from '../content/canonicalBook.js';
import { renderCanonicalBookToPlainText as render } from '../content/canonicalTxtRenderer.js';
import { importEpubToCanonicalBook } from '../content/epubImporter.js';
import { importTxtToCanonicalBook } from '../content/txtImporter.js';
import { materializeCanonicalMedia, detectImageMediaType, CANONICAL_MEDIA_SRC_RX } from '../content/canonicalMedia.js';
import {
    buildCanonicalBookFromEpub, writeCanonicalArtifactsAtomic, isCanonicalEpubCurrent, canonicalTextUrlFor,
    canonicalBookUrlFor, canonicalMediaPathFor, serializeCanonicalBook, readUploadSourceBytes,
} from '../content/canonicalBookStore.js';
import { classifyUploadPath } from '../accessService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const code = (fn) => { try { fn(); return null; } catch (e) { return e.code || e.message; } };
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_canon3c2_'));
const up = path.join(tmp, 'uploads');
fs.mkdirSync(up, { recursive: true });

const png = { mediaType: 'image/png', data: IMG.png(1) };
const T = (s) => xhtml(s);
const E_BASIC = makeEpub(
    { 'Text/c1.xhtml': T('<h1>Capítulo 1</h1><p>El gato duerme.</p><img src="../Images/a.png" alt="Un gato"/><p>Fin.</p>'),
      'Text/c2.xhtml': T('<h2>Parte</h2><p>Otro.</p><img src="../Images/b.jpg" alt=""/><img src="../Images/a.png"/>') },
    { 'Images/a.png': png, 'Images/b.jpg': { mediaType: 'image/jpeg', data: IMG.jpeg(1) } });
const imgs = (book) => book.chapters.flatMap(c => c.blocks.filter(b => b.type === 'image'));

// ─────────────────────────────────────────────────────────────────────────────
console.log('[1] materializeCanonicalMedia');
{
    ok('magic bytes: JPEG/PNG/GIF/WebP detectados; SVG/texto → null',
        detectImageMediaType(IMG.jpeg()) === 'image/jpeg' && detectImageMediaType(IMG.png()) === 'image/png'
        && detectImageMediaType(IMG.gif()) === 'image/gif' && detectImageMediaType(IMG.webp()) === 'image/webp'
        && detectImageMediaType(IMG.svg()) === null && detectImageMediaType(Buffer.from('hola')) === null);

    const imported = importEpubToCanonicalBook({ contentId: 'm-1', epubBuffer: E_BASIC });
    const calls = { net: 0, fs: 0 };
    const spies = [[http, 'request', 'net'], [https, 'request', 'net'], [net, 'connect', 'net'], [fs, 'readFileSync', 'fs'], [fs, 'writeFileSync', 'fs'], [fs, 'openSync', 'fs']]
        .map(([o, k, b]) => { const orig = o[k]; o[k] = function (...a) { calls[b]++; return orig.apply(this, a); }; return () => { o[k] = orig; }; });
    let m;
    try { m = materializeCanonicalMedia(E_BASIC, imported); } finally { spies.forEach(r => r()); }
    ok('puro: 0 red, 0 filesystem', calls.net === 0 && calls.fs === 0, JSON.stringify(calls));
    const before = imgs(imported), after = imgs(m.book);
    ok('src reescrito a media/<sha256>.<ext>', after.every(b => CANONICAL_MEDIA_SRC_RX.test(b.src)) && after[0].src === `media/${sha(png.data)}.png` && after[1].src.endsWith('.jpg'));
    ok('id, alt, orden y capítulos intactos', JSON.stringify(after.map(b => [b.id, b.alt])) === JSON.stringify(before.map(b => [b.id, b.alt]))
        && JSON.stringify(m.book.chapters.map(c => c.blocks.map(b => b.id))) === JSON.stringify(imported.chapters.map(c => c.blocks.map(b => b.id))));
    ok('sin rastro de rutas del ZIP', !/OEBPS|Images\//.test(JSON.stringify(m.book)));
    ok('dedup: misma imagen referenciada 2 veces → 1 medio, mismo src', m.media.length === 2 && after[0].src === after[2].src);
    ok('bytes del medio = bytes de la fuente (sha en el nombre)', m.media.every(x => x.path === `media/${sha(x.bytes)}.${x.path.split('.').pop()}`));
    ok('fingerprint antes == después de materializar', m.book.contentFingerprint === imported.contentFingerprint && fp(render(m.book)) === imported.contentFingerprint);
    ok('el libro de entrada no se muta', imgs(imported)[0].src === 'OEBPS/Images/a.png');
    ok('libro materializado válido', validateCanonicalBook(m.book).length === 0);
    ok('determinismo ×2', JSON.stringify(materializeCanonicalMedia(E_BASIC, imported).book) === JSON.stringify(m.book));

    const sameBytes = makeEpub({ 'Text/c.xhtml': T('<p>t</p><img src="../A/x.png" alt=""/><img src="../B/y.png" alt=""/>') },
        { 'A/x.png': png, 'B/y.png': png });
    const sb = buildCanonicalBookFromEpub({ contentId: 'm-2', epubBuffer: sameBytes });
    ok('dedup: dos entradas distintas con los mismos bytes → 1 medio', sb.media.length === 1 && imgs(sb.book)[0].src === imgs(sb.book)[1].src);
    const sameName = makeEpub({ 'Text/c.xhtml': T('<p>t</p><img src="../A/x.png" alt=""/><img src="../B/x.png" alt=""/>') },
        { 'A/x.png': { mediaType: 'image/png', data: IMG.png(1) }, 'B/x.png': { mediaType: 'image/png', data: IMG.png(2) } });
    const sn = buildCanonicalBookFromEpub({ contentId: 'm-3', epubBuffer: sameName });
    ok('mismo nombre de origen, bytes distintos → no colisionan', sn.media.length === 2 && imgs(sn.book)[0].src !== imgs(sn.book)[1].src);
    const four = makeEpub({ 'Text/c.xhtml': T('<p>t</p><img src="../i/a.jpg"/><img src="../i/b.png"/><img src="../i/c.gif"/><img src="../i/d.webp"/>') },
        { 'i/a.jpg': { mediaType: 'image/jpeg', data: IMG.jpeg() }, 'i/b.png': png, 'i/c.gif': { mediaType: 'image/gif', data: IMG.gif() }, 'i/d.webp': { mediaType: 'image/webp', data: IMG.webp() } });
    ok('JPEG/PNG/GIF/WebP → .jpg/.png/.gif/.webp', JSON.stringify(imgs(buildCanonicalBookFromEpub({ contentId: 'm-4', epubBuffer: four }).book).map(b => b.src.split('.').pop())) === '["jpg","png","gif","webp"]');

    const mis = (decl, data) => makeEpub({ 'Text/c.xhtml': T('<p>t</p><img src="../i/a.png" alt=""/>') }, { 'i/a.png': { mediaType: decl, data } });
    ok('manifest PNG, bytes JPEG → MEDIA_TYPE_MISMATCH', code(() => buildCanonicalBookFromEpub({ contentId: 'x', epubBuffer: mis('image/png', IMG.jpeg()) })) === 'MEDIA_TYPE_MISMATCH');
    ok('manifest GIF, bytes WebP → MEDIA_TYPE_MISMATCH', code(() => buildCanonicalBookFromEpub({ contentId: 'x', epubBuffer: mis('image/gif', IMG.webp()) })) === 'MEDIA_TYPE_MISMATCH');
    ok('manifest PNG, bytes no imagen (HTML/script) → MEDIA_UNKNOWN_BYTES', code(() => buildCanonicalBookFromEpub({ contentId: 'x', epubBuffer: mis('image/png', Buffer.from('<script>alert(1)</script>')) })) === 'MEDIA_UNKNOWN_BYTES');
    ok('manifest PNG, bytes SVG → MEDIA_UNKNOWN_BYTES', code(() => buildCanonicalBookFromEpub({ contentId: 'x', epubBuffer: mis('image/png', IMG.svg()) })) === 'MEDIA_UNKNOWN_BYTES');
    const svgOnly = makeEpub({ 'Text/c.xhtml': T('<p>t</p><img src="../i/s.svg" alt=""/>') }, { 'i/s.svg': { mediaType: 'image/svg+xml', data: IMG.svg() } });
    ok('SVG declarado → fuera de alcance (ni bloque ni medio)', (() => { const b = buildCanonicalBookFromEpub({ contentId: 'x', epubBuffer: svgOnly }); return b.media.length === 0 && imgs(b.book).length === 0; })());
    ok('imagen ausente → EPUB_IMAGE_MISSING', code(() => buildCanonicalBookFromEpub({ contentId: 'x', epubBuffer: makeEpub({ 'Text/c.xhtml': T('<p>t</p><img src="../i/no.png"/>') }) })) === 'EPUB_IMAGE_MISSING');
    ok('imagen no declarada → EPUB_IMAGE_UNDECLARED', code(() => buildCanonicalBookFromEpub({ contentId: 'x', epubBuffer: makeEpub({ 'Text/c.xhtml': T('<p>t</p><img src="../i/u.png"/>') }, {}, { extra: [{ name: 'OEBPS/i/u.png', data: IMG.png() }] }) })) === 'EPUB_IMAGE_UNDECLARED');
    ok('traversal en src → EPUB_PATH_ESCAPE', code(() => buildCanonicalBookFromEpub({ contentId: 'x', epubBuffer: makeEpub({ 'Text/c.xhtml': T('<p>t</p><img src="../../../../etc/a.png"/>') }) })) === 'EPUB_PATH_ESCAPE');
    ok('libro ajeno al EPUB (src no aceptado) → MEDIA_NOT_IN_EPUB', code(() => materializeCanonicalMedia(makeEpub({ 'Text/c.xhtml': T('<p>t</p>') }), imported)) === 'MEDIA_NOT_IN_EPUB');
    ok('mismo texto por TXT y por EPUB (con imágenes) → mismo fingerprint',
        buildCanonicalBookFromEpub({ contentId: 'x', epubBuffer: makeEpub({ 'Text/c.xhtml': T('<h1>Capítulo 1</h1><img src="../i/a.png"/><p>Uno.</p>') }, { 'i/a.png': png }) }).book.contentFingerprint
        === importTxtToCanonicalBook({ contentId: 'x', text: 'Capítulo 1\n\nUno.', contentFingerprint: fp('Capítulo 1\n\nUno.') }).contentFingerprint);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[2] persistencia atómica de artefactos EPUB');
const canonDir = (id) => path.join(up, id, 'canonical');
const listTree = (dir) => { const out = []; const walk = (d, rel) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const r = rel ? `${rel}/${e.name}` : e.name; if (e.isDirectory()) walk(path.join(d, e.name), r); else out.push(r); } }; walk(dir, ''); return out.sort(); };
const snapshot = (id) => Object.fromEntries(listTree(canonDir(id)).map(f => [f, sha(fs.readFileSync(path.join(canonDir(id), f)))]));
{
    const A = buildCanonicalBookFromEpub({ contentId: 's-1', epubBuffer: E_BASIC });
    ok('build: text == render(book) y fingerprint(text) == book.contentFingerprint', A.text === render(A.book) && fp(A.text) === A.book.contentFingerprint);
    const undoA = writeCanonicalArtifactsAtomic(up, A);
    const files = listTree(canonDir('s-1'));
    ok('escribe book.json, book.txt y media/<sha>.<ext>', JSON.stringify(files) === JSON.stringify(['book.json', 'book.txt', ...A.media.map(m => m.path).sort()]), files.join(','));
    ok('book.txt = rendición canónica exacta (UTF-8)', fs.readFileSync(path.join(canonDir('s-1'), 'book.txt'), 'utf8') === A.text);
    ok('book.json = serialización determinista', fs.readFileSync(path.join(canonDir('s-1'), 'book.json'), 'utf8') === serializeCanonicalBook(A.book));
    ok('medios con los bytes exactos', A.media.every(m => sha(fs.readFileSync(canonicalMediaPathFor(up, 's-1', m.path))) === sha(m.bytes)));
    const rec = { id: 's-1', contentFingerprint: A.book.contentFingerprint, canonicalFingerprint: A.book.contentFingerprint, canonicalSchemaVersion: 1,
        canonicalBookUrl: canonicalBookUrlFor('s-1'), texto_plano_url: canonicalTextUrlFor('s-1') };
    ok('isCanonicalEpubCurrent: vigente', isCanonicalEpubCurrent(up, rec));
    const mediaPath = canonicalMediaPathFor(up, 's-1', A.media[0].path);
    const mtime = fs.statSync(mediaPath).mtimeMs;
    const snapA = snapshot('s-1');
    const undoAgain = writeCanonicalArtifactsAtomic(up, A);
    ok('medio ya presente con el mismo hash → no se reescribe', fs.statSync(mediaPath).mtimeMs === mtime);
    undoAgain();
    ok('undo de una republicación idéntica conserva los medios compartidos', JSON.stringify(snapshot('s-1')) === JSON.stringify(snapA));
    writeCanonicalArtifactsAtomic(up, A);

    // B: mismo texto, otra imagen → media nueva, mismo fingerprint.
    const E_B = makeEpub({ 'Text/c1.xhtml': T('<h1>Capítulo 1</h1><p>El gato duerme.</p><img src="../Images/a.png" alt="Un gato"/><p>Fin.</p>'),
        'Text/c2.xhtml': T('<h2>Parte</h2><p>Otro.</p><img src="../Images/b.jpg" alt=""/><img src="../Images/a.png"/>') },
    { 'Images/a.png': { mediaType: 'image/png', data: IMG.png(9) }, 'Images/b.jpg': { mediaType: 'image/jpeg', data: IMG.jpeg(1) } });
    const B = buildCanonicalBookFromEpub({ contentId: 's-1', epubBuffer: E_B });
    ok('cambiar solo medios → mismo fingerprint textual', B.book.contentFingerprint === A.book.contentFingerprint && B.text === A.text);

    // Fallo al escribir un medio → nada nuevo, estado previo intacto.
    const origRename = fs.renameSync;
    let n = 0;
    fs.renameSync = function (from, to) { if (String(to).includes(`${path.sep}media${path.sep}`) && ++n === 1) throw Object.assign(new Error('EIO simulado'), { code: 'EIO' }); return origRename.call(this, from, to); };
    let err;
    try { writeCanonicalArtifactsAtomic(up, B); } catch (e) { err = e; } finally { fs.renameSync = origRename; }
    ok('fallo en escritura de medio → error propagado', err?.code === 'EIO');
    ok('rollback medio: estado previo intacto (book.json, book.txt, media)', JSON.stringify(snapshot('s-1')) === JSON.stringify(snapA));

    // Fallo al escribir book.json → media nuevos retirados, book.txt repuesto.
    n = 0;
    fs.renameSync = function (from, to) { if (String(to).endsWith(`${path.sep}book.json`)) throw Object.assign(new Error('ENOSPC simulado'), { code: 'ENOSPC' }); return origRename.call(this, from, to); };
    err = null;
    try { writeCanonicalArtifactsAtomic(up, B); } catch (e) { err = e; } finally { fs.renameSync = origRename; }
    ok('fallo en book.json → error propagado', err?.code === 'ENOSPC');
    ok('rollback book.json: estado previo intacto', JSON.stringify(snapshot('s-1')) === JSON.stringify(snapA));

    // Éxito B y luego undo (content.json no se escribió) → vuelve A exacto.
    const undoB = writeCanonicalArtifactsAtomic(up, B);
    ok('B publicado: book.json apunta a medios presentes', isCanonicalEpubCurrent(up, rec));
    undoB();
    ok('undo tras publicar B → estado A exacto', JSON.stringify(snapshot('s-1')) === JSON.stringify(snapA));

    ok('libro con src no materializado → INVALID_MEDIA_REF sin escribir nada',
        code(() => writeCanonicalArtifactsAtomic(up, { ...A, book: importEpubToCanonicalBook({ contentId: 's-2', epubBuffer: E_BASIC }) })) === 'INVALID_MEDIA_REF' && !fs.existsSync(canonDir('s-2')));
    fs.rmSync(mediaPath);
    ok('isCanonicalEpubCurrent: falta un medio → no vigente', !isCanonicalEpubCurrent(up, rec));
    undoA();
    ok('undo del primer write → directorio sin artefactos', listTree(canonDir('s-1')).length === 0 || listTree(canonDir('s-1')).every(f => f.startsWith('media/')));
    ok('sin temporales residuales', !listTree(up).some(f => /\.tmp-/.test(f)), listTree(up).join(','));
    ok('readUploadSourceBytes confinado: traversal/fuera de uploads → null',
        readUploadSourceBytes(up, '/uploads/../x.epub', 1e6) === null && readUploadSourceBytes(up, '/etc/passwd', 1e6) === null && readUploadSourceBytes(up, '/uploads/nope.epub', 1e6) === null);
}

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] autorización de canonical/media');
{
    const ped = { id: 'p-1', tipo: 'guia', epub_url: '/uploads/p-1/x.epub', texto_plano_url: canonicalTextUrlFor('p-1'), canonicalBookUrl: canonicalBookUrlFor('p-1') };
    const gen = { id: 'g-1', tipo: 'libro', epub_url: '/uploads/g-1/x.epub', texto_plano_url: canonicalTextUrlFor('g-1'), canonicalBookUrl: canonicalBookUrlFor('g-1') };
    const media = (id) => `/uploads/${id}/canonical/media/${'a'.repeat(64)}.png`;
    ok('pedagogía: media hereda PEDAGOGY_RESTRICTED (igual que book.txt y el .epub)',
        [media('p-1'), ped.texto_plano_url, ped.canonicalBookUrl, ped.epub_url].every(u => classifyUploadPath(u, [ped, gen]) === 'PEDAGOGY_RESTRICTED'));
    ok('general: media con la clase de su contenido (GENERAL)', classifyUploadPath(media('g-1'), [ped, gen]) === 'GENERAL');
    ok('embebido en Experience: media EMBEDDED_EXPERIENCE', classifyUploadPath(media('p-1'), [{ ...ped, standalone: false }]) === 'EMBEDDED_EXPERIENCE');
    ok('sin dueño en el catálogo → UNMAPPED_ASSET', classifyUploadPath(media('nadie'), [ped, gen]) === 'UNMAPPED_ASSET');
    ok('otros subdirectorios del contenido no heredan por convención', classifyUploadPath('/uploads/p-1/suelto.png', [ped]) === 'UNMAPPED_ASSET');
    ok('el directorio canonical/ sin archivo no es asset', classifyUploadPath('/uploads/p-1/canonical/', [ped]) === 'UNMAPPED_ASSET');
}

// ─────────────────────────────────────────────────────────────────────────────
// Parte 4: server.js real
const P = {
    data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'), access: path.join(tmp, 'access.json'), content: path.join(tmp, 'content.json'),
};
fs.mkdirSync(P.data, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([{ id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active' }], null, 2));
for (const f of [P.groups, P.schools, P.access]) fs.writeFileSync(f, '[]');
fs.writeFileSync(P.content, '[]');
const put = (rel, data) => { const p = path.join(up, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return `/uploads/${rel}`; };

const PORT = 5500 + (process.pid % 100);
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
const audioManifest = (id) => path.join(up, 'audio', id, 'manifest.json');
const save = async (body) => {
    const r = await fetch(`${base}/api/content`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const j = await r.json();
    await sleep(2100); // ventana de idempotencia de 2 s por actor+id
    return { status: r.status, body: j };
};
const uploadFile = async (name, data, type, parentId) => {
    const fd = new FormData();
    fd.append('file', new Blob([data], { type }), name);
    const r = await fetch(`${base}/api/upload${parentId ? `?parentId=${parentId}` : ''}`, { method: 'POST', headers: { 'x-user-id': 'ADM' }, body: fd });
    return { status: r.status, body: await r.json().catch(() => ({})) };
};
const waitFor = async (pred, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (pred()) return true; await sleep(100); } return pred(); };
const consistentEpub = (id) => { const c = rec(id); return !!c && c.contentFingerprint === c.canonicalFingerprint && isCanonicalEpubCurrent(up, c); };

try {
    let healthy = false;
    for (let i = 0; i < 150 && !healthy; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* arrancando */ }
        if (!healthy) await sleep(400);
    }
    if (!healthy) throw new Error(`nunca healthy\n${boot.slice(-2000)}`);

    console.log('\n[4] /api/upload — .epub en tres capas');
    let u = await uploadFile('libro.epub', E_BASIC, 'application/epub+zip', 'e-1');
    ok('EPUB válido (application/epub+zip) → 200 y URL .epub en /uploads/<parentId>/', u.status === 200 && /^\/uploads\/e-1\/libro-.*\.epub$/.test(u.body.url) && u.body.mimetype === 'application/epub+zip', JSON.stringify(u));
    const epubUrl = u.body.url;
    ok('la fuente se guarda byte a byte', sha(fs.readFileSync(path.join(up, epubUrl.slice('/uploads/'.length)))) === sha(E_BASIC));
    u = await uploadFile('otro.epub', makeEpub({ 'Text/c.xhtml': T('<p>Octet.</p>') }), 'application/octet-stream');
    ok('EPUB válido con MIME genérico application/octet-stream → 200', u.status === 200 && u.body.url?.endsWith('.epub'));
    u = await uploadFile('falso.epub', 'esto es texto, no un epub', 'application/epub+zip');
    ok('EPUB falso (texto con extensión .epub) → 415', u.status === 415);
    u = await uploadFile('mime.epub', E_BASIC, 'image/png');
    ok('MIME incoherente (.epub declarado image/png) → 400 en capa 1', u.status === 400);
    const { buildZip } = await import('./helpers/epubFixture.mjs');
    u = await uploadFile('zip.epub', buildZip([{ name: 'a.txt', data: 'hola' }]), 'application/epub+zip');
    ok('ZIP arbitrario con extensión .epub → 415', u.status === 415);
    u = await uploadFile('mimetype-ok.epub', makeEpub({ 'Text/c.xhtml': T('<p>t</p><img src="../i/a.png"/>') }, { 'i/a.png': { mediaType: 'image/png', data: IMG.jpeg() } }), 'application/epub+zip');
    ok('EPUB con imagen de tipo real ≠ manifest → 415 (capa 3)', u.status === 415);
    u = await uploadFile('trav.epub', makeEpub({ 'Text/c.xhtml': T('<p>t</p><img src="../../../../x.png"/>') }), 'application/epub+zip');
    ok('EPUB con traversal en imagen → 415', u.status === 415);
    ok('rechazos no dejan archivos (ni en uploads ni en temp de subida)', !listTree(up).some(f => /falso|mime|zip-|mimetype-ok|trav/.test(f)), listTree(up).filter(f => /epub/.test(f)).join(','));
    u = await uploadFile('texto.txt', 'Hola TXT.', 'text/plain');
    ok('TXT sigue aceptado igual', u.status === 200 && u.body.url.endsWith('.txt'));
    u = await uploadFile('texto.txt', Buffer.from([0x48, 0x00, 0x49]), 'text/plain');
    ok('TXT binario sigue rechazado', u.status === 415);

    console.log('\n[5] POST /api/content — fuente EPUB');
    const B = { id: 'e-1', titulo: 'Libro EPUB', tipo: 'libro', standalone: true };
    let r = await save({ ...B, epub_url: epubUrl, texto_plano_url: '/uploads/otro/malicioso.txt', canonicalFingerprint: 'sha256:' + 'f'.repeat(64) });
    const c1 = rec('e-1');
    const expected = buildCanonicalBookFromEpub({ contentId: 'e-1', epubBuffer: E_BASIC });
    ok('EPUB nuevo → 200', r.status === 200, JSON.stringify(r.body));
    ok('texto_plano_url = /uploads/<id>/canonical/book.txt (valor del cliente descartado)', c1.texto_plano_url === '/uploads/e-1/canonical/book.txt');
    ok('epub_url (fuente) se conserva tal cual y el archivo sigue intacto', c1.epub_url === epubUrl && sha(fs.readFileSync(path.join(up, epubUrl.slice(9)))) === sha(E_BASIC));
    ok('contentFingerprint = fingerprint(book.txt) = canonicalFingerprint, versión 1',
        c1.contentFingerprint === fp(fs.readFileSync(path.join(canonDir('e-1'), 'book.txt'), 'utf8')) && c1.canonicalFingerprint === c1.contentFingerprint
        && c1.contentFingerprint === expected.book.contentFingerprint && c1.contentVersion === 1);
    ok('artefactos: book.json + book.txt + media, vigentes', consistentEpub('e-1') && listTree(canonDir('e-1')).filter(f => f.startsWith('media/')).length === 2);
    ok('book.json persistido == construcción pura', fs.readFileSync(path.join(canonDir('e-1'), 'book.json'), 'utf8') === serializeCanonicalBook(expected.book));
    ok('sin sourceFormat ni otros campos nuevos: solo epub_url', !('sourceFormat' in c1));
    ok('TTS encolado sobre el TXT derivado', r.body.content?.ttsStatus === 'generando' && await waitFor(() => fs.existsSync(audioManifest('e-1'))));
    const manifest = JSON.parse(fs.readFileSync(audioManifest('e-1'), 'utf8'));
    const spoken = Object.entries(manifest).filter(([k]) => k !== '_meta').map(([, v]) => v.text).join(' ');
    ok('TTS lee texto plano (sin XHTML/EPUB/rutas de imagen)', spoken.includes('El gato duerme.') && !/<|OEBPS|media\/|\.png/.test(spoken), spoken.slice(0, 80));
    await waitFor(() => rec('e-1').ttsStatus === 'listo');
    const mMtime = fs.statSync(audioManifest('e-1')).mtimeMs;

    // Mismo POST → nada se reescribe.
    const bookMtime = fs.statSync(path.join(canonDir('e-1'), 'book.json')).mtimeMs;
    r = await save({ ...rec('e-1'), titulo: 'Libro EPUB (editado)' });
    ok('metadata cambia, mismo epub_url → artefactos intactos, misma versión', r.status === 200 && fs.statSync(path.join(canonDir('e-1'), 'book.json')).mtimeMs === bookMtime && rec('e-1').contentVersion === 1 && rec('e-1').titulo === 'Libro EPUB (editado)');
    ok('… y sin TTS', rec('e-1').ttsStatus === 'listo' && fs.statSync(audioManifest('e-1')).mtimeMs === mMtime);

    // Solo medios cambian → mismo fingerprint, sin TTS.
    const E_MEDIA = makeEpub(
        { 'Text/c1.xhtml': T('<h1>Capítulo 1</h1><p>El gato duerme.</p><img src="../Images/a.png" alt="Un gato"/><p>Fin.</p>'),
          'Text/c2.xhtml': T('<h2>Parte</h2><p>Otro.</p><img src="../Images/b.jpg" alt=""/><img src="../Images/a.png"/>') },
        { 'Images/a.png': { mediaType: 'image/png', data: IMG.png(7) }, 'Images/b.jpg': { mediaType: 'image/jpeg', data: IMG.jpeg(1) } });
    r = await save({ ...rec('e-1'), epub_url: put('e-1/v2.epub', E_MEDIA) });
    const bookMedia = JSON.parse(fs.readFileSync(path.join(canonDir('e-1'), 'book.json'), 'utf8')).chapters.flatMap(c => c.blocks).filter(b => b.type === 'image').map(b => b.src);
    ok('nuevo EPUB solo con otras imágenes → mismo fingerprint y versión', r.status === 200 && rec('e-1').contentFingerprint === c1.contentFingerprint && rec('e-1').contentVersion === 1);
    ok('… book.json apunta a los medios nuevos (presentes)', bookMedia.includes(`media/${sha(IMG.png(7))}.png`) && consistentEpub('e-1'));
    ok('… NO regenera TTS', r.body.content?.ttsStatus === 'listo' && fs.statSync(audioManifest('e-1')).mtimeMs === mMtime);

    // Texto cambia → versión 2 y TTS.
    const E_TEXT = makeEpub({ 'Text/c1.xhtml': T('<h1>Capítulo 1</h1><p>El perro corre.</p>') });
    r = await save({ ...rec('e-1'), epub_url: put('e-1/v3.epub', E_TEXT) });
    ok('texto cambia → versión 2 y fingerprint nuevo', r.status === 200 && rec('e-1').contentVersion === 2 && rec('e-1').contentFingerprint !== c1.contentFingerprint && consistentEpub('e-1'));
    ok('… TTS encolado', r.body.content?.ttsStatus === 'generando');
    await waitFor(() => rec('e-1').ttsStatus === 'listo');

    // Fallos: EPUB inválido, ilegible, escritura de medios.
    r = await save({ id: 'e-2', titulo: 'Falso', tipo: 'libro', epub_url: put('e-2/falso.epub', 'no soy un epub') });
    ok('EPUB inválido → 422 y el Content no se publica', r.status === 422 && r.body.code === 'canonical_import_failed' && !rec('e-2'));
    ok('… sin artefactos ni TTS; la fuente no se borra', !fs.existsSync(canonDir('e-2')) && !fs.existsSync(audioManifest('e-2')) && fs.existsSync(path.join(up, 'e-2', 'falso.epub')));
    r = await save({ id: 'e-3', titulo: 'Perdido', tipo: 'libro', epub_url: '/uploads/e-3/no-existe.epub' });
    ok('EPUB ilegible → 422 source_unreadable', r.status === 422 && r.body.code === 'source_unreadable' && !rec('e-3'));
    r = await save({ id: 'e-4', titulo: 'Fuera', tipo: 'libro', epub_url: '/uploads/../../etc/x.epub' });
    ok('epub_url con traversal → 422 sin leer fuera de uploads', r.status === 422 && !rec('e-4'));
    fs.mkdirSync(canonDir('e-5'), { recursive: true });
    fs.writeFileSync(path.join(canonDir('e-5'), 'media'), 'bloqueo');
    r = await save({ id: 'e-5', titulo: 'Bloqueado', tipo: 'libro', epub_url: put('e-5/a.epub', E_BASIC) });
    ok('escritura de medios falla → 500, no publicado, sin book.json/book.txt', r.status === 500 && r.body.code === 'canonical_write_failed' && !rec('e-5')
        && JSON.stringify(listTree(canonDir('e-5'))) === '["media"]');
    ok('… TTS no encolado', !fs.existsSync(audioManifest('e-5')));

    // content.json no llega a escribirse → artefactos previos repuestos.
    const snapE1 = snapshot('e-1'); const beforeRec = JSON.stringify(rec('e-1'));
    fs.mkdirSync(`${P.content}.tmp`);
    r = await save({ ...rec('e-1'), epub_url: put('e-1/v4.epub', E_BASIC) });
    fs.rmSync(`${P.content}.tmp`, { recursive: true, force: true });
    ok('content.json falla → 500, artefactos y Content previos intactos', r.status === 500 && JSON.stringify(snapshot('e-1')) === JSON.stringify(snapE1) && JSON.stringify(rec('e-1')) === beforeRec && consistentEpub('e-1'));

    // TXT → EPUB y EPUB → TXT sobre el mismo Content.
    r = await save({ id: 't-1', titulo: 'TXT', tipo: 'libro', texto_plano_url: put('t-1/a.txt', 'Capítulo 1\n\nEl gato duerme.') });
    ok('TXT sin cambios de contrato (texto_plano_url del cliente, sin epub_url)', r.status === 200 && rec('t-1').texto_plano_url === '/uploads/t-1/a.txt' && !('epub_url' in rec('t-1')));
    r = await save({ ...rec('t-1'), epub_url: put('t-1/a.epub', makeEpub({ 'Text/c.xhtml': T('<h1>Capítulo 1</h1><p>El gato duerme.</p>') })) });
    ok('TXT → EPUB con el mismo texto: misma versión, texto_plano_url canónico', r.status === 200 && rec('t-1').contentVersion === 1 && rec('t-1').texto_plano_url === canonicalTextUrlFor('t-1') && consistentEpub('t-1'));

    // Autorización real del edge para medios de pedagogía.
    const pedEpub = makeEpub({ 'Text/c.xhtml': T('<p>Guía.</p><img src="../i/a.png"/>') }, { 'i/a.png': { mediaType: 'image/png', data: IMG.png(42) } });
    r = await save({ id: 'ped-1', titulo: 'Guía', tipo: 'guia', standalone: true, epub_url: put('ped-1/g.epub', pedEpub) });
    const pedMedia = `/uploads/ped-1/canonical/media/${sha(IMG.png(42))}.png`;
    const authz = async (uri, headers = {}) => (await fetch(`${base}/api/internal/uploads-authz`, { headers: { 'x-original-uri': uri, ...headers } })).status;
    ok('pedagogía EPUB: media, book.txt, book.json y .epub → 401 sin sesión',
        r.status === 200 && fs.existsSync(path.join(up, pedMedia.slice(9)))
        && (await Promise.all([pedMedia, rec('ped-1').texto_plano_url, rec('ped-1').canonicalBookUrl, rec('ped-1').epub_url].map(u2 => authz(u2)))).every(s => s === 401));
    ok('general EPUB: media → 204 sin sesión', await authz(`/uploads/e-1/canonical/media/${sha(IMG.png(1))}.png`) === 204);

    ok('sin temporales residuales en uploads', !listTree(up).some(f => /\.tmp-/.test(f)), listTree(up).filter(f => /\.tmp-/.test(f)).join(','));
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\ncanonicalBookEpubIngestion — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
