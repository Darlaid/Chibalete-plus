/**
 * adminEpubUpload.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3D.1.
 *
 * Reproduce lo que hace SubirContenido con un EPUB, contra server.js REAL
 * (stores y uploads temporales, TTS en mock): upload con asEpubUploadFile
 * (application/epub+zip, parentId = content-<Date.now()>) → POST /api/content con
 * el payload de la UI pasado por withEpubSource (epub_url, sin texto_plano_url).
 * El servidor fija texto_plano_url, versión, canónicos y defaults, y el contenido
 * aparece en el listado admin. Sin contenido editorial real.
 *
 *   node server/__test__/adminEpubUpload.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeEpub, xhtml, IMG } from './helpers/epubFixture.mjs';
import { asEpubUploadFile, withEpubSource, epubSourceBlockReason, EPUB_REIMPORT_BLOCKED_MESSAGE } from '../../utils/epubSourceUpload.mjs';
import { buildCanonicalBookFromEpub, canonicalTextUrlFor, isCanonicalEpubCurrent } from '../content/canonicalBookStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_admin_epub_'));
const up = path.join(tmp, 'uploads');
fs.mkdirSync(up, { recursive: true });
const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json') };
fs.mkdirSync(P.data, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([{ id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active' }]));
fs.writeFileSync(P.content, '[]');
for (const f of ['groups', 'schools', 'access']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');

const EPUB = makeEpub({ 'Text/c.xhtml': xhtml('<h1>Capítulo 1</h1><p>Texto sintético.</p><img src="../i/a.png" alt=""/>') },
    { 'i/a.png': { mediaType: 'image/png', data: IMG.png(11) } });

const PORT = 5800 + (process.pid % 100);
const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT),
        CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: path.join(tmp, 'groups.json'), SCHOOLS_DB: path.join(tmp, 'schools.json'),
        ACCESS_DB: path.join(tmp, 'access.json'), CONTENT_DB: P.content, UPLOADS_ROOT: up,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), SESSION_AUTH_MODE: 'off',
        OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
    },
});
let boot = '';
child.stdout.on('data', d => { boot += d; });
child.stderr.on('data', d => { boot += d; });

const H = { 'x-user-id': 'ADM' };
// Mismo contrato que dataService.uploadFile: multipart con el File tal cual.
const uploadLikeUi = async (file, parentId) => {
    const fd = new FormData(); fd.append('file', file, file.name);
    const r = await fetch(`${base}/api/upload?parentId=${encodeURIComponent(parentId)}`, { method: 'POST', headers: H, body: fd });
    return { status: r.status, body: await r.json() };
};
const saveLikeUi = async (content) => {
    const r = await fetch(`${base}/api/content`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify(content) });
    const body = await r.json(); await sleep(2100);
    return { status: r.status, body };
};

try {
    let healthy = false;
    for (let i = 0; i < 150 && !healthy; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* arrancando */ }
        if (!healthy) await sleep(400);
    }
    if (!healthy) throw new Error(`nunca healthy\n${boot.slice(-2000)}`);

    console.log('[1] upload como la UI (EPUB con MIME del navegador vacío)');
    const parentId = `content-${Date.now()}`; // mismo mecanismo que SubirContenido
    const browserFile = new File([EPUB], 'Mi libro.epub', { type: '' });
    const file = asEpubUploadFile(browserFile);
    ok('la UI declara application/epub+zip', file.type === 'application/epub+zip');
    const u = await uploadLikeUi(file, parentId);
    ok('upload 200 con URL .epub bajo /uploads/<parentId>/', u.status === 200 && u.body.url?.startsWith(`/uploads/${parentId}/`) && u.body.url.endsWith('.epub') && u.body.mimetype === 'application/epub+zip', JSON.stringify(u));

    console.log('\n[2] POST /api/content con el payload de la UI');
    // Forma del newContent de SubirContenido (texto_plano_url: txtEsUrl || existing → undefined con EPUB).
    const uiContent = {
        id: parentId, tipo: 'libro', editorial: 'Chibalete',
        metricas: { veces_leido: 0, calificacion_promedio: 0 }, publico_objetivo: 'todos',
        titulo: 'Libro sintético', autor: 'Autora', biografia_autor: '', descripcion_corta: 'Descripción',
        etiquetas: ['Nuevo', 'libro'], isCollection: false, standalone: true,
        portada_url: '/uploads/x/portada.png', url_recurso: '', texto_plano_url: undefined,
        ilustraciones_url: [], numero_paginas: 10,
    };
    const payload = withEpubSource(uiContent, u.body.url);
    ok('payload: epub_url presente, texto_plano_url ausente', payload.epub_url === u.body.url && !('texto_plano_url' in JSON.parse(JSON.stringify(payload))));
    const r = await saveLikeUi(payload);
    const c = r.body.content || {};
    const expected = buildCanonicalBookFromEpub({ contentId: parentId, epubBuffer: EPUB });
    ok('200 y el servidor fija texto_plano_url canónico', r.status === 200 && c.texto_plano_url === canonicalTextUrlFor(parentId), JSON.stringify(r.body).slice(0, 200));
    ok('versión textual, fingerprint y canónicos los pone el servidor', c.contentVersion === 1 && c.contentFingerprint === expected.book.contentFingerprint && c.canonicalFingerprint === c.contentFingerprint && isCanonicalEpubCurrent(up, c));
    ok('defaults en la respuesta', JSON.stringify(c.metricas) === JSON.stringify({ veces_leido: 0, calificacion_promedio: 0 }) && c.publico_objetivo === 'todos');
    ok('metadata editorial de la UI intacta', c.titulo === 'Libro sintético' && c.autor === 'Autora' && c.descripcion_corta === 'Descripción' && c.editorial === 'Chibalete' && c.portada_url === '/uploads/x/portada.png');
    ok('artefactos: fuente .epub + canonical/book.json, book.txt y media', fs.existsSync(path.join(up, u.body.url.slice(9)))
        && ['book.json', 'book.txt'].every(f => fs.existsSync(path.join(up, parentId, 'canonical', f)))
        && fs.readdirSync(path.join(up, parentId, 'canonical', 'media')).length === 1);
    ok('TTS encolado con el estado existente (sin estados nuevos)', c.ttsStatus === 'generando');

    console.log('\n[3] visible en la UI administrativa (GET /api/content)');
    const list = await (await fetch(`${base}/api/content`, { headers: H })).json();
    const items = Array.isArray(list) ? list : (list.items || list.content || []);
    ok('el contenido nuevo aparece en el listado admin', items.some(x => x.id === parentId && x.epub_url === u.body.url));

    console.log('\n[4] reimportación bloqueada desde la UI');
    ok('editar ese contenido con otro EPUB → bloqueado antes de subir', epubSourceBlockReason({ isUpdate: true, existingContent: items.find(x => x.id === parentId), textoPlanoFile: browserFile }) === EPUB_REIMPORT_BLOCKED_MESSAGE);

    console.log('\n[5] errores del servidor llegan con mensaje utilizable');
    const bad = await uploadLikeUi(asEpubUploadFile(new File(['no soy un epub'], 'falso.epub')), `content-${Date.now()}`);
    ok('EPUB falso → 415 con mensaje del servidor', bad.status === 415 && typeof bad.body.error === 'string' && bad.body.error.length > 10, JSON.stringify(bad));
    const mime = await uploadLikeUi(new File([EPUB], 'x.epub', { type: 'image/png' }), `content-${Date.now()}`);
    ok('MIME incoherente (sin asEpubUploadFile) → 400 con mensaje', mime.status === 400 && /no permitido/i.test(mime.body.error || ''), JSON.stringify(mime));
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nadminEpubUpload — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
