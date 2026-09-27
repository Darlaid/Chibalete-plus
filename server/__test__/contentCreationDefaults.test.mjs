/**
 * contentCreationDefaults.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3C.3B-R1.
 *
 * POST /api/content aplica con autoridad backend los defaults mínimos que hasta
 * ahora solo fijaba SubirContenido.tsx (metricas, publico_objetivo, autor,
 * etiquetas). Solo rellena lo AUSENTE. server.js REAL contra stores y uploads
 * temporales (TTS en mock). Incluye el camino de reparación del piloto EPUB:
 * registro sin defaults + update metadata-only → defaults, sin tocar canónico,
 * versión ni TTS.
 *
 *   node server/__test__/contentCreationDefaults.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeEpub, xhtml, IMG } from './helpers/epubFixture.mjs';
import {
    buildCanonicalBookFromEpub, writeCanonicalArtifactsAtomic, canonicalTextUrlFor, canonicalBookUrlFor, isCanonicalEpubCurrent,
} from '../content/canonicalBookStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const METRICAS0 = JSON.stringify({ veces_leido: 0, calificacion_promedio: 0 });

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_content_defaults_'));
const up = path.join(tmp, 'uploads');
const put = (rel, data) => { const p = path.join(up, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); return `/uploads/${rel}`; };

const EPUB = makeEpub({ 'Text/c.xhtml': xhtml('<h1>Capítulo 1</h1><p>Texto del piloto.</p><img src="../i/a.png" alt=""/>') },
    { 'i/a.png': { mediaType: 'image/png', data: IMG.png(3) } });

// Réplica del piloto productivo: EPUB ya ingerido, SIN metricas/publico_objetivo,
// artefactos vigentes y TTS terminado (manifest presente).
const PILOT = 'content-pilot-1';
const built = buildCanonicalBookFromEpub({ contentId: PILOT, epubBuffer: EPUB });
fs.mkdirSync(up, { recursive: true });
writeCanonicalArtifactsAtomic(up, built);
const pilotEpubUrl = put(`${PILOT}/fuente.epub`, EPUB);
put(`audio/${PILOT}/manifest.json`, JSON.stringify({ _meta: { version: 2 }, 0: { text: 'x', file: 'chunk_0.mp3' } }));
const FP = built.book.contentFingerprint;
const PILOT_RECORD = {
    id: PILOT, titulo: 'Piloto (EPUB)', autor: 'Autora', tipo: 'libro', etiquetas: ['Filosofía'], epub_url: pilotEpubUrl,
    texto_plano_url: canonicalTextUrlFor(PILOT), status: 'disponible', ttsStatus: 'listo', contentFingerprint: FP, contentVersion: 1,
    canonicalBookUrl: canonicalBookUrlFor(PILOT), canonicalSchemaVersion: 1, canonicalFingerprint: FP,
    processingStatus: { percentage: 100, status: 'completed' },
};

const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json') };
fs.mkdirSync(P.data, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([{ id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active' }]));
fs.writeFileSync(P.content, JSON.stringify([PILOT_RECORD], null, 2));
for (const f of ['groups', 'schools', 'access']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');

const PORT = 5700 + (process.pid % 100);
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

const H = { 'content-type': 'application/json', 'x-user-id': 'ADM' };
const rec = (id) => JSON.parse(fs.readFileSync(P.content, 'utf8')).find(c => c.id === id);
const save = async (body) => {
    const r = await fetch(`${base}/api/content`, { method: 'POST', headers: H, body: JSON.stringify(body) });
    const j = await r.json();
    await sleep(2100); // ventana de idempotencia de 2 s por actor+id
    return { status: r.status, body: j };
};
const canonSnapshot = (id) => {
    const dir = path.join(up, id, 'canonical'); const out = {};
    const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out[path.relative(dir, p)] = `${fs.statSync(p).mtimeMs}:${fs.readFileSync(p).length}`; } };
    walk(dir); return JSON.stringify(out);
};

try {
    let healthy = false;
    for (let i = 0; i < 150 && !healthy; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* arrancando */ }
        if (!healthy) await sleep(400);
    }
    if (!healthy) throw new Error(`nunca healthy\n${boot.slice(-2000)}`);

    console.log('[1] creación por API con el payload mínimo del piloto EPUB');
    const e1 = put('c-e1/libro.epub', EPUB);
    let r = await save({ id: 'c-e1', titulo: 'Piloto 2', autor: 'Autora', tipo: 'libro', etiquetas: ['Filosofía'], epub_url: e1 });
    const c1 = rec('c-e1');
    ok('200 y Content utilizable', r.status === 200 && !!c1, JSON.stringify(r.body).slice(0, 200));
    ok('metricas con el shape canónico {veces_leido:0, calificacion_promedio:0}', JSON.stringify(c1.metricas) === METRICAS0, JSON.stringify(c1.metricas));
    ok('publico_objetivo = "todos"', c1.publico_objetivo === 'todos');
    ok('autor/etiquetas enviados se respetan', c1.autor === 'Autora' && JSON.stringify(c1.etiquetas) === '["Filosofía"]');
    ok('la respuesta ya incluye los defaults', JSON.stringify(r.body.content?.metricas) === METRICAS0 && r.body.content?.publico_objetivo === 'todos');
    ok('EPUB intacto: canónico vigente, fingerprint del texto, versión 1, texto_plano_url canónico',
        isCanonicalEpubCurrent(up, c1) && c1.contentFingerprint === FP && c1.contentVersion === 1 && c1.texto_plano_url === canonicalTextUrlFor('c-e1'));
    ok('sin metadata editorial inventada', !('descripcion_corta' in c1) && !('portada_url' in c1) && !('editorial' in c1) && !('biografia_autor' in c1) && !('ilustraciones_url' in c1));

    console.log('\n[2] creación sin autor/etiquetas/metricas (TXT)');
    r = await save({ id: 'c-t1', titulo: 'Mínimo', tipo: 'libro', texto_plano_url: put('c-t1/a.txt', 'Hola.') });
    const t1 = rec('c-t1');
    ok('defaults: autor "Anónimo" (el de SubirContenido), etiquetas [], metricas, publico "todos"',
        r.status === 200 && t1.autor === 'Anónimo' && JSON.stringify(t1.etiquetas) === '[]' && JSON.stringify(t1.metricas) === METRICAS0 && t1.publico_objetivo === 'todos');

    console.log('\n[3] valores del cliente se respetan');
    r = await save({ id: 'c-v1', titulo: 'V', autor: 'X', tipo: 'guia', etiquetas: [], publico_objetivo: 'profesores', metricas: { veces_leido: 7, calificacion_promedio: 4.5 } });
    ok('publico_objetivo y metricas del cliente intactos', rec('c-v1').publico_objetivo === 'profesores' && JSON.stringify(rec('c-v1').metricas) === JSON.stringify({ veces_leido: 7, calificacion_promedio: 4.5 }));
    r = await save({ id: 'c-v2', titulo: 'V2', autor: 'X', tipo: 'libro', etiquetas: [], metricas: { veces_leido: 3 } });
    ok('metricas parcial → se completa la clave faltante', JSON.stringify(rec('c-v2').metricas) === JSON.stringify({ veces_leido: 3, calificacion_promedio: 0 }));
    const ui = { id: 'c-ui', tipo: 'libro', editorial: 'Chibalete', metricas: { veces_leido: 0, calificacion_promedio: 0 }, publico_objetivo: 'todos',
        titulo: 'UI', autor: 'Anónimo', biografia_autor: '', descripcion_corta: 'd', etiquetas: ['Nuevo', 'libro'], isCollection: false, standalone: true,
        portada_url: '', url_recurso: '', ilustraciones_url: [] };
    r = await save(ui);
    ok('payload de la UI admin: todos sus campos quedan exactamente igual', Object.entries(ui).every(([k, v]) => JSON.stringify(rec('c-ui')[k]) === JSON.stringify(v)));

    console.log('\n[4] update que omite los campos → se conserva lo guardado');
    const { metricas, publico_objetivo, ...rest } = rec('c-v1');
    r = await save({ ...rest, titulo: 'V editado' });
    ok('metricas y publico_objetivo previos conservados (no se resetean)', rec('c-v1').titulo === 'V editado' && rec('c-v1').publico_objetivo === 'profesores'
        && JSON.stringify(rec('c-v1').metricas) === JSON.stringify({ veces_leido: 7, calificacion_promedio: 4.5 }));

    console.log('\n[5] reparación del piloto: update metadata-only del registro existente');
    const before = rec(PILOT); const snap = canonSnapshot(PILOT);
    const manifestMtime = fs.statSync(path.join(up, 'audio', PILOT, 'manifest.json')).mtimeMs;
    ok('estado previo = el del piloto productivo (sin metricas ni publico_objetivo)', !('metricas' in before) && !('publico_objetivo' in before));
    r = await save(before);
    const after = rec(PILOT);
    ok('200 y defaults añadidos', r.status === 200 && JSON.stringify(after.metricas) === METRICAS0 && after.publico_objetivo === 'todos');
    ok('campos existentes idénticos (epub_url, texto_plano_url, canonical*, fingerprint, versión, autor, etiquetas, ttsStatus)',
        ['id', 'titulo', 'autor', 'tipo', 'etiquetas', 'epub_url', 'texto_plano_url', 'contentFingerprint', 'contentVersion', 'canonicalBookUrl',
            'canonicalSchemaVersion', 'canonicalFingerprint', 'status', 'ttsStatus', 'processingStatus'].every(k => JSON.stringify(after[k]) === JSON.stringify(before[k])));
    ok('solo se añadieron metricas y publico_objetivo', JSON.stringify(Object.keys(after).filter(k => !(k in before)).sort()) === '["metricas","publico_objetivo"]');
    ok('artefactos canónicos NO reescritos (mtime y tamaño idénticos)', canonSnapshot(PILOT) === snap && isCanonicalEpubCurrent(up, after));
    ok('TTS NO reencolado (manifest intacto, ttsStatus sigue listo)', r.body.content?.ttsStatus === 'listo' && fs.statSync(path.join(up, 'audio', PILOT, 'manifest.json')).mtimeMs === manifestMtime);
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\ncontentCreationDefaults — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
