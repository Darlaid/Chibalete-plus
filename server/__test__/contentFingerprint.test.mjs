/**
 * contentFingerprint.test.mjs — CHP-CONTENT-CANONICAL-2026-01 PARTE 1B.
 *
 * Contrato de versión textual de un Content:
 *   - contentFingerprint = 'sha256:' + sha256(texto normalizado), calculado SOLO
 *     por el servidor, independiente de URL, nombre de archivo y formato;
 *   - contentVersion monotónico por Content id (+1 cuando cambia el fingerprint);
 *   - canonicalProgress conserva contentFingerprint/contentVersion si vienen.
 *
 * Parte 1: funciones puras. Parte 2: un server.js REAL contra stores temporales.
 * NUNCA toca data/, data-critical/, uploads productivos ni la red.
 *
 *   node server/__test__/contentFingerprint.test.mjs
 */
// Primero: NODE_ENV=test y stores SQLite (progress.db incluido) en un temporal;
// el server.js hijo hereda estas rutas.
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    normalizeTextForContentFingerprint as norm,
    computeContentFingerprint as fp,
    nextContentTextVersion,
    readUploadTextForFingerprint,
} from '../contentFingerprint.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
console.log('[1] normalización y algoritmo (puro)');
const X = 'El gato duerme.\n\nSegundo párrafo.';
ok('F1 mismo texto → mismo fingerprint', fp(X) === fp(X));
ok('formato sha256:<64 hex> = SHA-256 del texto normalizado',
    fp(X) === 'sha256:' + crypto.createHash('sha256').update(X, 'utf8').digest('hex') && /^sha256:[0-9a-f]{64}$/.test(fp(X)));
ok('F2 texto distinto → fingerprint distinto', fp('El gato duerme.') !== fp('El perro corre.'));
ok('F3 CRLF y CR sueltos ≡ LF', fp(X.replace(/\n/g, '\r\n')) === fp(X) && fp(X.replace(/\n/g, '\r')) === fp(X));
ok('F4 BOM ≡ sin BOM', fp('﻿' + X) === fp(X));
ok('newline(s) final(es) ≡ sin newline', fp(X + '\n') === fp(X) && fp(X + '\r\n\r\n') === fp(X));
ok('espacios/tabs al final de línea ≡ sin ellos', fp('El gato duerme.  \t\n\nSegundo párrafo. ') === fp(X));
ok('párrafos: unir dos párrafos cambia el fingerprint', fp('El gato duerme.\nSegundo párrafo.') !== fp(X));
ok('puntuación distinta cambia el fingerprint', fp(X.replace('duerme.', 'duerme!')) !== fp(X));
ok('espacio interno distinto cambia el fingerprint', fp(X.replace('El gato', 'El  gato')) !== fp(X));
ok('NFC vs NFD distintos (el parser accesible los trata distinto)', fp('Capítulo 1'.normalize('NFC')) !== fp('Capítulo 1'.normalize('NFD')));
ok('BOM en medio del texto NO se elimina', norm('a﻿b') === 'a﻿b');
ok('fuente independiente: el fingerprint solo mira el texto', fp(X) === fp(String(X)));
ok('≠ hash de chunk TTS (md5 por chunk+motor): prefijo y longitud distintos', !/^[0-9a-f]{32}$/.test(fp(X)));

console.log('\n[1b] contentVersion (puro)');
let v = nextContentTextVersion(null, fp('A'));
ok('primer texto → versión 1', v.contentVersion === 1 && v.contentFingerprint === fp('A'));
const v1 = v;
v = nextContentTextVersion(v1, fp('A'));
ok('mismo fingerprint → misma versión', v.contentVersion === 1);
const v2 = nextContentTextVersion(v1, fp('B'));
const v3 = nextContentTextVersion(v2, fp('C'));
ok('F8 dos cambios sucesivos → 1 → 2 → 3', v2.contentVersion === 2 && v3.contentVersion === 3);
const v4 = nextContentTextVersion(v3, fp('A'));
ok('F9 volver al texto original → fingerprint original, versión 4 (no retrocede)', v4.contentFingerprint === fp('A') && v4.contentVersion === 4);
ok('legacy sin campos → versión 1', nextContentTextVersion({ titulo: 'x' }, fp('A')).contentVersion === 1);
ok('versión previa inválida se trata como ausente', nextContentTextVersion({ contentVersion: 'dos', contentFingerprint: fp('Z') }, fp('A')).contentVersion === 1);

console.log('\n[1c] lectura confinada a uploads');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_cfp_'));
const up = path.join(tmp, 'uploads');
fs.mkdirSync(path.join(up, 'c1'), { recursive: true });
fs.writeFileSync(path.join(up, 'c1', 'a.txt'), X);
fs.writeFileSync(path.join(tmp, 'fuera.txt'), 'secreto');
ok('lee /uploads/c1/a.txt', readUploadTextForFingerprint(up, '/uploads/c1/a.txt') === X);
ok('traversal → null', readUploadTextForFingerprint(up, '/uploads/../fuera.txt') === null);
ok('URL externa → null', readUploadTextForFingerprint(up, 'https://x.test/a.txt') === null);
ok('inexistente → null', readUploadTextForFingerprint(up, '/uploads/c1/nada.txt') === null);
ok('directorio → null', readUploadTextForFingerprint(up, '/uploads/c1') === null);

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
const LEGACY = { id: 'legacy-1', titulo: 'Legado', tipo: 'libro', standalone: true, status: 'disponible', ttsStatus: 'listo', etiquetas: ['a'], texto_plano_url: putText('legacy-1/orig.txt', 'Texto legado.') };
fs.writeFileSync(P.content, JSON.stringify([LEGACY], null, 2));

const PORT = 5300 + (process.pid % 100);
const base = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env, NODE_ENV: 'test', PORT: String(PORT),
        CHP_DATA_DIR: P.data, USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: up,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'), SESSION_AUTH_MODE: 'off',
        OPENAI_API_KEY: '', GEMINI_API_KEY: '',
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
const sync = async (cp, updatedAt) => {
    const r = await fetch(`${base}/api/progress/ADM/c-prog/sync`, { method: 'POST', headers: H, body: JSON.stringify({ canonicalProgress: cp, updatedAt }) });
    return { status: r.status, body: await r.json() };
};

try {
    let healthy = false;
    for (let i = 0; i < 150 && !healthy; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${boot.slice(-2000)}`);
        try { healthy = (await fetch(`${base}/api/health`)).ok; } catch { /* arrancando */ }
        if (!healthy) await sleep(400);
    }
    if (!healthy) throw new Error(`nunca healthy\n${boot.slice(-2000)}`);

    console.log('\n[2] /api/content — autoridad del servidor');
    const B = { id: 'c-1', titulo: 'Uno', tipo: 'libro', standalone: true };
    let r = await save({ ...B, texto_plano_url: putText('c-1/a.txt', 'El gato duerme.'), contentFingerprint: 'sha256:falso', contentVersion: 99 });
    ok('crear con texto → 200, versión 1 y fingerprint del texto', r.status === 200 && rec('c-1').contentVersion === 1 && rec('c-1').contentFingerprint === fp('El gato duerme.'));
    ok('valores del cliente ignorados', rec('c-1').contentFingerprint !== 'sha256:falso');
    ok('la respuesta devuelve los campos', r.body.content?.contentVersion === 1 && r.body.content?.contentFingerprint === fp('El gato duerme.'));

    r = await save({ ...rec('c-1'), texto_plano_url: putText('c-1/b-otro-nombre.txt', '﻿El gato duerme.\r\n') });
    ok('F5 URL/archivo distinto + mismo texto (BOM, CRLF) → mismo fingerprint y versión 1',
        rec('c-1').contentVersion === 1 && rec('c-1').contentFingerprint === fp('El gato duerme.') && rec('c-1').texto_plano_url.endsWith('b-otro-nombre.txt'));

    r = await save({ ...rec('c-1'), titulo: 'Uno (editado)', contentVersion: 7 });
    ok('F6 solo metadata → misma versión y fingerprint', rec('c-1').titulo === 'Uno (editado)' && rec('c-1').contentVersion === 1 && rec('c-1').contentFingerprint === fp('El gato duerme.'));
    const sinCampos = { ...rec('c-1') }; delete sinCampos.contentFingerprint; delete sinCampos.contentVersion;
    await save({ ...sinCampos, descripcion_corta: 'x' });
    ok('F6 update que omite los campos no los borra', rec('c-1').contentVersion === 1 && rec('c-1').contentFingerprint === fp('El gato duerme.'));

    await save({ ...rec('c-1'), texto_plano_url: putText('c-1/c.txt', 'El perro corre.') });
    ok('F7 texto cambia → versión 2', rec('c-1').contentVersion === 2 && rec('c-1').contentFingerprint === fp('El perro corre.'));
    await save({ ...rec('c-1'), texto_plano_url: putText('c-1/d.txt', 'El pez nada.') });
    ok('F8 segundo cambio → versión 3', rec('c-1').contentVersion === 3);
    await save({ ...rec('c-1'), texto_plano_url: putText('c-1/e.txt', 'El gato duerme.') });
    ok('F9 vuelve al texto original → fingerprint original, versión 4', rec('c-1').contentVersion === 4 && rec('c-1').contentFingerprint === fp('El gato duerme.'));

    await save({ ...rec('c-1'), texto_plano_url: '/uploads/c-1/no-existe.txt' });
    ok('fuente ilegible → fingerprint null, versión conservada (4)', rec('c-1').contentFingerprint === null && rec('c-1').contentVersion === 4);
    await save({ ...rec('c-1'), texto_plano_url: putText('c-1/f.txt', 'El gato duerme.') });
    ok('texto legible de nuevo → versión 5 (monotónica)', rec('c-1').contentVersion === 5 && rec('c-1').contentFingerprint === fp('El gato duerme.'));

    await save({ id: 'c-2', titulo: 'Sin texto', tipo: 'video', url_recurso: 'https://youtu.be/x' });
    ok('contenido sin texto → sin campos de versión', !('contentVersion' in rec('c-2')) && !('contentFingerprint' in rec('c-2')));

    console.log('\n[3] legacy');
    const list = await (await fetch(`${base}/api/content`, { headers: H })).json();
    const leg = list.find(c => c.id === 'legacy-1');
    ok('L1 contenido legacy sin campos sigue cargando igual', !!leg && !('contentVersion' in leg) && leg.titulo === 'Legado');
    await save({ ...LEGACY, titulo: 'Legado 2' });
    const L = rec('legacy-1');
    ok('L4 update de metadata legacy: sin campos nuevos ni pérdida de otros', L.titulo === 'Legado 2' && !('contentVersion' in L) && !('contentFingerprint' in L) && L.texto_plano_url === LEGACY.texto_plano_url && JSON.stringify(L.etiquetas) === '["a"]');
    await save({ ...rec('legacy-1'), texto_plano_url: putText('legacy-1/nuevo.txt', 'Texto legado revisado.') });
    ok('legacy con texto nuevo → versión 1', rec('legacy-1').contentVersion === 1 && rec('legacy-1').contentFingerprint === fp('Texto legado revisado.'));

    console.log('\n[4] canonicalProgress');
    let s = await sync({ globalPercentage: 40, lastInteractedMode: 'text' }, '2026-09-25T10:00:00.000Z');
    ok('L2 sync sin campos → 200, fingerprint null y sin contentVersion', s.status === 200 && s.body.progress.canonicalProgress.contentFingerprint === null && !('contentVersion' in s.body.progress.canonicalProgress));
    const F = fp('El gato duerme.');
    s = await sync({ sentenceIndex: 3, totalSentences: 10, globalPercentage: 30, lastInteractedMode: 'immersive', contentFingerprint: F, contentVersion: 4, anchor: { type: 'sentence', value: 3 } }, '2026-09-25T10:01:00.000Z');
    const cp = s.body.progress.canonicalProgress;
    ok('L3 sync con campos → se conservan completos (sin truncar)', cp.contentFingerprint === F && cp.contentVersion === 4 && cp.anchor?.value === 3);
    const item = await (await fetch(`${base}/api/progress/item/ADM/c-prog`, { headers: H })).json();
    const icp = (item.progress || item).canonicalProgress;
    ok('L3 lectura posterior devuelve los mismos campos', icp?.contentFingerprint === F && icp?.contentVersion === 4, JSON.stringify(item).slice(0, 300));
    for (const [bad, i] of [[0, 2], ['4', 3], [1.5, 4], [-1, 5]]) {
        s = await sync({ globalPercentage: 1, contentVersion: bad }, `2026-09-25T10:0${i}:00.000Z`);
        ok(`contentVersion inválida (${JSON.stringify(bad)}) → descartada`, s.status === 200 && !('contentVersion' in s.body.progress.canonicalProgress));
    }
    ok('sin política de desajuste: el sync no se rechaza aunque la versión no coincida', s.status === 200);
} catch (e) {
    ok('arnés del servidor', false, e.message);
} finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\ncontentFingerprint — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
