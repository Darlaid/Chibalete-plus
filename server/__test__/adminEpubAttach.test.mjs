/**
 * adminEpubAttach.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3F.1.
 *
 * Admin EPUB contra server.js REAL (stores y uploads temporales, TTS en mock):
 *   [0] inspectEpubArchive (mismo parser que la importación): capítulos,
 *       imágenes, diseño, TOC, scripts; Alicia si el EPUB fuente está presente.
 *   [1] POST /api/upload/epub-inspect: solo lectura (nada queda en uploads).
 *   [2] /api/upload rechaza un EPUB con scripts (EPUB_SCRIPTED).
 *   [3] ATTACH a un contenido TXT existente: cambia SOLO epub_url. canonical,
 *       book.txt, media, texto_plano_url, PDF, audio/TTS, fingerprints,
 *       contentVersion, progreso y acceso byte-idénticos; sin TTS nuevo.
 *   [4] segundo attach → 409 «Este contenido ya tiene una edición EPUB.»
 *   [5] ownership R4: EPUB de otro contenido, canónico, traversal o inexistente → 422.
 *   [6] EPUB con scripts ya en disco → 422 sin escribir.
 *   [7] edición normal posterior del contenido adjuntado: NO reimporta ni
 *       regenera TTS (el EPUB adjunto no es la fuente del texto).
 *   [8] crear desde EPUB (3C.2) sigue igual: canonical + media + epub_url.
 *
 *   node server/__test__/adminEpubAttach.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeEpub, xhtml, IMG } from './helpers/epubFixture.mjs';
import { inspectEpubArchive } from '../content/epubImporter.js';
import { asEpubUploadFile, withEpubSource } from '../../utils/epubSourceUpload.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');
let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const EPUB_OK = makeEpub({
    'Text/c1.xhtml': xhtml('<h1>Capítulo 1</h1><p>Texto uno.</p><img src="../i/a.png" alt="a"/>'),
    'Text/c2.xhtml': xhtml('<h1>Capítulo 2</h1><p>Texto dos.</p><img src="../i/b.png" alt="b"/>'),
}, { 'i/a.png': { mediaType: 'image/png', data: IMG.png(1) }, 'i/b.png': { mediaType: 'image/png', data: IMG.png(2) } });
const EPUB_SCRIPT = makeEpub({ 'Text/c.xhtml': xhtml('<p>Hola</p><script>alert(1)</script>') });
const EPUB_ONCLICK = makeEpub({ 'Text/c.xhtml': xhtml('<p onclick="x()">Hola</p>') });
const EPUB_JSURL = makeEpub({ 'Text/c.xhtml': xhtml('<p><a href="javascript:x()">Hola</a></p>') });
const EPUB_JSITEM = makeEpub({ 'Text/c.xhtml': xhtml('<p>Hola</p>') }, { 'js/a.js': { mediaType: 'application/javascript', data: Buffer.from('x()') } });

// ── [0] inspección pura ─────────────────────────────────────────────────────
{
    console.log('[0] inspectEpubArchive');
    const r = inspectEpubArchive(EPUB_OK);
    ok('EPUB textual: 2 capítulos, 2 imágenes, adaptable, sin TOC, sin scripts, publicable',
        r.chapters === 2 && r.images === 2 && r.layout === 'reflowable' && r.toc.present === false && r.toc.entries === 0 && r.scripts === false && r.publishable === true && r.bytes === EPUB_OK.length, JSON.stringify(r));
    ok('<script> → scripts, no publicable', inspectEpubArchive(EPUB_SCRIPT).scripts === true && inspectEpubArchive(EPUB_SCRIPT).publishable === false);
    ok('atributo on* → scripts', inspectEpubArchive(EPUB_ONCLICK).scripts === true);
    ok('URL javascript: → scripts', inspectEpubArchive(EPUB_JSURL).scripts === true);
    ok('item JavaScript en el manifest → scripts', inspectEpubArchive(EPUB_JSITEM).scripts === true);
    let threw = null; try { inspectEpubArchive(Buffer.from('no es un zip')); } catch (e) { threw = e.code; }
    ok('no-EPUB → lanza con código de importación', typeof threw === 'string' && threw.length > 0, String(threw));
    const alicia = path.join(REPO, 'EPUB test', 'Aventuras_Alicia_Maravillas_EPUB_V4.epub');
    if (fs.existsSync(alicia)) {
        const a = inspectEpubArchive(fs.readFileSync(alicia));
        ok('Alicia: 13 capítulos · 77 imágenes · adaptable · TOC sí (12) · sin scripts · 49.272.977 B',
            a.chapters === 13 && a.images === 77 && a.layout === 'reflowable' && a.toc.present && a.toc.entries === 12 && !a.scripts && a.bytes === 49272977 && a.publishable, JSON.stringify(a));
    } else console.log('  - Alicia: SKIP (EPUB fuente no presente)');
}

// ── servidor real ───────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_epub_attach_'));
const up = path.join(tmp, 'uploads');
fs.mkdirSync(up, { recursive: true });
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json'), access: path.join(tmp, 'access.json') };
fs.mkdirSync(P.data, { recursive: true });
const C_TXT = 'content-3f1-txt', C_OTHER = 'content-3f1-other', C_EPUB = 'content-3f1-epub';
fs.writeFileSync(P.users, JSON.stringify([
    { id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active' },
    { id: 'LEC', email: 'lec@fx.test', roles: ['lector'], accountStatus: 'active' },
]));
fs.writeFileSync(P.content, '[]');
fs.writeFileSync(P.access, JSON.stringify([{ id: 'r-lec', scope: 'user', scopeId: 'LEC', titleIds: [C_TXT], collectionIds: [], expiresAt: Date.now() + 86400000 }]));
for (const f of ['groups', 'schools']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');

const PORT = 6300 + (process.pid % 80);
const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT),
        CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: path.join(tmp, 'groups.json'), SCHOOLS_DB: path.join(tmp, 'schools.json'),
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: up, PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'),
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), SESSION_AUTH_MODE: 'off',
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    },
});
let out = '';
child.stdout.on('data', d => { out += d; });
child.stderr.on('data', d => { out += d; });

const H = { 'x-user-id': 'ADM' };
const fileOf = (bytes, name, type) => new File([bytes], name, { type });
const uploadLikeUi = async (file, parentId) => {
    const fd = new FormData(); fd.append('file', file, file.name);
    const r = await fetch(`${base}/api/upload?parentId=${encodeURIComponent(parentId)}`, { method: 'POST', headers: H, body: fd });
    return { status: r.status, body: await r.json() };
};
const inspectLikeUi = async (file) => {
    const fd = new FormData(); fd.append('file', file, file.name);
    const r = await fetch(`${base}/api/upload/epub-inspect`, { method: 'POST', headers: H, body: fd });
    return { status: r.status, body: await r.json() };
};
const post = async (p, body, headers = H) => {
    const r = await fetch(base + p, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    let json = null; try { json = await r.json(); } catch { /* */ }
    return { status: r.status, body: json };
};
const saveLikeUi = async (content) => { const r = await post('/api/content', content); await sleep(2100); return r; };
const attach = (id, epub_url) => post(`/api/content/${id}/epub-edition`, { epub_url });
const record = (id) => JSON.parse(fs.readFileSync(P.content, 'utf8')).find(c => c.id === id);
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const treeHashes = (dir) => {
    const outMap = {};
    const walk = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else outMap[path.relative(dir, f).split(path.sep).join('/')] = sha(f); } };
    walk(dir); return outMap;
};
const S = (o) => JSON.stringify(o);
const ttsTriggers = (id) => (out.match(new RegExp(`Triggering TTS background generation for ${id}`, 'g')) || []).length;
const waitTts = async (id) => { for (let i = 0; i < 100; i++) { if (record(id)?.ttsStatus !== 'generando') return; await sleep(200); } };

try {
    let healthy = false;
    for (let i = 0; i < 300 && !healthy; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${out.slice(-2000)}`);
        try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* arrancando */ }
        if (!healthy) await sleep(400);
    }
    if (!healthy) throw new Error(`nunca healthy\n${out.slice(-2000)}`);

    console.log('[1] POST /api/upload/epub-inspect (solo lectura)');
    const before = treeHashes(up);
    const i1 = await inspectLikeUi(asEpubUploadFile(fileOf(EPUB_OK, 'libro.epub', 'application/octet-stream')));
    ok('EPUB válido → 200 con el resumen', i1.status === 200 && i1.body.inspection?.chapters === 2 && i1.body.inspection.images === 2 && i1.body.inspection.publishable === true && i1.body.inspection.layout === 'reflowable', S(i1.body));
    ok('el resumen no expone motivos internos', !('scriptReasons' in (i1.body.inspection || {})));
    const i2 = await inspectLikeUi(asEpubUploadFile(fileOf(EPUB_SCRIPT, 'malo.epub', 'application/epub+zip')));
    ok('EPUB con scripts → 200 scripts:true publishable:false', i2.status === 200 && i2.body.inspection.scripts === true && i2.body.inspection.publishable === false, S(i2.body));
    ok('archivo no EPUB → 415', (await inspectLikeUi(fileOf(Buffer.from('hola'), 'x.epub', 'application/epub+zip'))).status === 415);
    ok('la inspección no deja nada en uploads', S(treeHashes(up)) === S(before));

    console.log('[2] /api/upload rechaza EPUB con scripts');
    const sUp = await uploadLikeUi(asEpubUploadFile(fileOf(EPUB_SCRIPT, 'malo.epub', 'application/epub+zip')), C_OTHER);
    ok('415 EPUB_SCRIPTED y nada escrito', sUp.status === 415 && sUp.body.code === 'EPUB_SCRIPTED' && !fs.existsSync(path.join(up, C_OTHER)), S(sUp.body));

    console.log('[3] ATTACH a un contenido TXT existente');
    const txt = await uploadLikeUi(fileOf(Buffer.from('Capítulo uno.\n\nHabía una vez un texto.\n'), 'obra.txt', 'text/plain'), C_TXT);
    const pdf = await uploadLikeUi(fileOf(Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n'), 'obra.pdf', 'application/pdf'), C_TXT);
    ok('fixture: TXT y PDF subidos bajo el contenido', txt.status === 200 && pdf.status === 200, S([txt.body, pdf.body]));
    const created = await saveLikeUi({ id: C_TXT, titulo: 'Obra TXT', autor: 'A', tipo: 'libro', texto_plano_url: txt.body.url, url_recurso: pdf.body.url });
    ok('fixture: contenido TXT creado (canonical + TTS mock)', created.status === 200, S(created.body));
    await waitTts(C_TXT); await sleep(500);
    ok('fixture: progreso del lector', (await post(`/api/progress/LEC/${C_TXT}/sync`, { canonicalProgress: { globalPercentage: 40, lastInteractedMode: 'text', anchor: { type: 'text', value: 40 }, viewportHint: 40.5 }, updatedAt: new Date().toISOString() }, { 'x-user-id': 'LEC' })).status === 200);
    const preRec = record(C_TXT);
    const preTree = treeHashes(path.join(up, C_TXT));
    const preAudio = treeHashes(path.join(up, 'audio', C_TXT));
    const preAccess = fs.readFileSync(P.access, 'utf8');
    const getProg = async () => (await (await fetch(`${base}/api/progress/item/LEC/${C_TXT}`, { headers: H })).json()).progress;
    const preProg = await getProg();
    const preTts = ttsTriggers(C_TXT);
    ok('PRE: canonical/book.json del TXT y audio TTS (mock) presentes', Object.keys(preTree).includes('canonical/book.json') && Object.keys(preAudio).includes('manifest.json') && !!preRec.contentFingerprint, S({ tree: Object.keys(preTree), audio: Object.keys(preAudio), fp: preRec.contentFingerprint }));

    const ep = await uploadLikeUi(asEpubUploadFile(fileOf(EPUB_OK, 'edicion.epub', 'application/octet-stream')), C_TXT);
    ok('EPUB subido bajo /uploads/<contentId existente>/', ep.status === 200 && ep.body.url.startsWith(`/uploads/${C_TXT}/`) && ep.body.url.endsWith('.epub'), S(ep.body));
    const a1 = await attach(C_TXT, ep.body.url);
    ok('attach → 200 con epub_url', a1.status === 200 && a1.body.content?.epub_url === ep.body.url, S(a1.body));
    const postRec = record(C_TXT);
    const { epub_url: addedUrl, ...postRest } = postRec;
    ok('J. el registro solo gana epub_url (resto byte-idéntico)', addedUrl === ep.body.url && S(postRest) === S(preRec), `${S(preRec)}\n${S(postRest)}`);
    ok('J. mismo contentId, texto_plano_url, url_recurso (PDF), contentFingerprint, contentVersion, canonical*, ttsStatus',
        ['id', 'texto_plano_url', 'url_recurso', 'contentFingerprint', 'contentVersion', 'canonicalBookUrl', 'canonicalFingerprint', 'canonicalSchemaVersion', 'ttsStatus', 'status'].every(k => S(postRec[k]) === S(preRec[k])));
    const postTree = treeHashes(path.join(up, C_TXT));
    const added = Object.keys(postTree).filter(k => !(k in preTree));
    ok('J. canonical/book.json, book.txt, media, TXT y PDF byte-idénticos; solo se añade el .epub',
        Object.keys(preTree).every(k => postTree[k] === preTree[k]) && added.length === 1 && added[0].endsWith('.epub'), S(added));
    ok('J. audio/TTS byte-idéntico y sin TTS encolado', S(treeHashes(path.join(up, 'audio', C_TXT))) === S(preAudio) && ttsTriggers(C_TXT) === preTts);
    ok('J. access_db byte-idéntico', fs.readFileSync(P.access, 'utf8') === preAccess);
    ok('J. progreso del lector idéntico', S(await getProg()) === S(preProg));
    ok('no hay log de reimportación canónica', !new RegExp(`CANONICAL_EPUB_WRITTEN\\] contentId=${C_TXT}`).test(out));

    console.log('[4] segundo attach');
    const ep2 = await uploadLikeUi(asEpubUploadFile(fileOf(makeEpub({ 'Text/x.xhtml': xhtml('<p>Otra edición.</p>') }), 'otra.epub', 'application/epub+zip')), C_TXT);
    const recBefore2 = S(record(C_TXT));
    const a2 = await attach(C_TXT, ep2.body.url);
    ok('segundo attach → 409 «Este contenido ya tiene una edición EPUB.»', a2.status === 409 && a2.body.error === 'Este contenido ya tiene una edición EPUB.', S(a2.body));
    ok('… y el registro no cambia (no se reemplaza)', S(record(C_TXT)) === recBefore2);

    console.log('[5] ownership (R4)');
    ok('fixture: contenido sin texto ni EPUB', (await saveLikeUi({ id: C_OTHER, titulo: 'Otra', autor: 'B', tipo: 'libro', url_recurso: pdf.body.url })).status === 200);
    const otherBefore = S(record(C_OTHER));
    const own = await attach(C_OTHER, ep.body.url);
    ok('EPUB subido para OTRO contenido → 422 epub_not_owned', own.status === 422 && own.body.code === 'epub_not_owned', S(own.body));
    ok('ruta con traversal → 422', (await attach(C_OTHER, `/uploads/${C_OTHER}/../${C_TXT}/${path.basename(ep.body.url)}`)).status === 422);
    ok('ruta canónica → 422', (await attach(C_OTHER, `/uploads/${C_OTHER}/canonical/x.epub`)).status === 422);
    ok('archivo inexistente / no .epub / sin url → 422', (await attach(C_OTHER, `/uploads/${C_OTHER}/nada.epub`)).status === 422
        && (await attach(C_OTHER, pdf.body.url)).status === 422 && (await attach(C_OTHER, undefined)).status === 422);
    ok('contenido inexistente → 404', (await attach('content-no-existe', ep.body.url)).status === 404);
    ok('el registro del otro contenido no cambió', S(record(C_OTHER)) === otherBefore);

    console.log('[6] EPUB con scripts ya en disco');
    fs.mkdirSync(path.join(up, C_OTHER), { recursive: true });
    fs.writeFileSync(path.join(up, C_OTHER, 'legado.epub'), EPUB_SCRIPT);
    const sc = await attach(C_OTHER, `/uploads/${C_OTHER}/legado.epub`);
    ok('attach de EPUB con scripts → 422 EPUB_SCRIPTED sin escribir', sc.status === 422 && sc.body.code === 'EPUB_SCRIPTED' && S(record(C_OTHER)) === otherBefore, S(sc.body));
    ok('attach a contenido solo-PDF con EPUB propio → 200 y nada más cambia', await (async () => {
        const e3 = await uploadLikeUi(asEpubUploadFile(fileOf(EPUB_OK, 'pdfonly.epub', 'application/epub+zip')), C_OTHER);
        const r = await attach(C_OTHER, e3.body.url);
        const { epub_url: u, ...rest } = record(C_OTHER);
        return r.status === 200 && u === e3.body.url && S(rest) === otherBefore && !record(C_OTHER).texto_plano_url;
    })());

    console.log('[7] edición normal posterior (como la UI: spread del registro)');
    const ttsBeforeEdit = ttsTriggers(C_TXT);
    const treeBeforeEdit = treeHashes(path.join(up, C_TXT));
    const audioBeforeEdit = treeHashes(path.join(up, 'audio', C_TXT));
    const recBeforeEdit = record(C_TXT);
    const ed = await saveLikeUi({ ...recBeforeEdit, titulo: 'Obra TXT (editada)' });
    const recAfterEdit = record(C_TXT);
    ok('edición → 200', ed.status === 200, S(ed.body));
    ok('el EPUB adjunto se conserva y texto_plano_url NO pasa a la rendición canónica',
        recAfterEdit.epub_url === recBeforeEdit.epub_url && recAfterEdit.texto_plano_url === recBeforeEdit.texto_plano_url && recAfterEdit.titulo === 'Obra TXT (editada)');
    ok('sin reimportación: canonical/media/TXT byte-idénticos y mismo fingerprint/versión',
        S(treeHashes(path.join(up, C_TXT))) === S(treeBeforeEdit) && recAfterEdit.contentFingerprint === recBeforeEdit.contentFingerprint && recAfterEdit.contentVersion === recBeforeEdit.contentVersion);
    ok('sin TTS: ni encolado ni audio cambiado', ttsTriggers(C_TXT) === ttsBeforeEdit && S(treeHashes(path.join(up, 'audio', C_TXT))) === S(audioBeforeEdit) && recAfterEdit.ttsStatus !== 'generando');

    console.log('[8] crear desde EPUB (pipeline 3C.2 intacto)');
    const e4 = await uploadLikeUi(asEpubUploadFile(fileOf(EPUB_OK, 'ilustrado.epub', 'application/octet-stream')), C_EPUB);
    const c4 = await saveLikeUi(withEpubSource({ id: C_EPUB, titulo: 'Ilustrado', autor: 'C', tipo: 'libro', texto_plano_url: '/ignorado.txt' }, e4.body.url));
    const r4 = record(C_EPUB);
    const media = fs.existsSync(path.join(up, C_EPUB, 'canonical', 'media')) ? fs.readdirSync(path.join(up, C_EPUB, 'canonical', 'media')).length : 0;
    ok('EPUB fuente: texto_plano_url canónico + canonical + 2 media + epub_url', c4.status === 200 && r4.texto_plano_url === `/uploads/${C_EPUB}/canonical/book.txt`
        && fs.existsSync(path.join(up, C_EPUB, 'canonical', 'book.json')) && media === 2 && r4.epub_url === e4.body.url, S({ status: c4.status, r4, media }));
    await waitTts(C_EPUB);
    const tree4 = treeHashes(path.join(up, C_EPUB));
    const ed4 = await saveLikeUi({ ...record(C_EPUB), titulo: 'Ilustrado (editado)' });
    ok('editar un contenido creado desde EPUB mantiene su semántica de fuente (sin cambios en canonical)',
        ed4.status === 200 && record(C_EPUB).texto_plano_url === `/uploads/${C_EPUB}/canonical/book.txt` && S(treeHashes(path.join(up, C_EPUB))) === S(tree4));
} catch (e) { ok('arnés', false, e.stack || e.message); }
finally { child.kill(); await sleep(300); fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`\nadminEpubAttach — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
