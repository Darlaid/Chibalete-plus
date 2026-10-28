/**
 * txtUtf8Guard.test.mjs — TXT-UTF8-GUARD-01.
 *
 *   [1] inspectTextFile: UTF-8 válido (tildes, ñ, signos tipográficos, emoji, BOM),
 *       Windows-1252, secuencias truncadas o inválidas, vacío, bytes nulos, frontera de bloque
 *   [2] readUtf8Strict: nunca sustituye por U+FFFD
 *   [3] TTS: un TXT no UTF-8 no produce sincronización (ni «�»), termina en error_proveedor
 *       y conserva el manifest anterior; un TXT ausente ya no deja la obra en «generando»
 * Sin red ni claves: proveedor doble inyectado, como ttsAtomicManifest.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

delete process.env.OPENAI_API_KEY;
delete process.env.GEMINI_API_KEY;
delete process.env.AI_MODE;
delete process.env.TTS_MODE;

const { inspectTextFile, readUtf8Strict, TEXT_UPLOAD_MESSAGES } = await import('../lib/textEncoding.js');
const ai = await import('../aiEngine.js');
const { generateAudioForContent } = await import('../ttsService.js');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_txtutf8_'));
let seq = 0;
const file = (bytes) => { const p = path.join(root, `t${++seq}.txt`); fs.writeFileSync(p, bytes); return p; };
const check = (bytes) => inspectTextFile(file(bytes));

try {
    console.log('\n[1] inspectTextFile');
    ok('UTF-8 con tildes, ñ y diéresis', check(Buffer.from('Antología poética. Prólogo I. Ñandú, pingüino.', 'utf8')).ok);
    ok('signos tipográficos (raya, comillas, puntos suspensivos, «»)', check(Buffer.from('—una vida— “entre” ‘así’ … «Ítaca»', 'utf8')).ok);
    ok('emoji y otros planos (4 bytes)', check(Buffer.from('Lectura 📚 𝄞 漢字', 'utf8')).ok);
    ok('UTF-8 con BOM', check(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('Hola', 'utf8')])).ok);
    const cp1252 = Buffer.from([0x41, 0x6e, 0x74, 0x6f, 0x6c, 0x6f, 0x67, 0xed, 0x61, 0x20, 0x97, 0x20, 0x93, 0x78, 0x94]); // «Antología — “x”» en Windows-1252
    const r1 = check(cp1252);
    ok('Windows-1252 (í, raya, comillas en 1 byte) → TXT_NOT_UTF8', !r1.ok && r1.code === 'TXT_NOT_UTF8', JSON.stringify(r1));
    ok('Latin-1 «canción» → TXT_NOT_UTF8', check(Buffer.from([0x63, 0x61, 0x6e, 0x63, 0x69, 0xf3, 0x6e])).code === 'TXT_NOT_UTF8');
    ok('secuencia truncada al final (c3 sin continuación) → TXT_NOT_UTF8', check(Buffer.from([0x61, 0x62, 0xc3])).code === 'TXT_NOT_UTF8');
    ok('secuencia de 3 bytes truncada en medio → TXT_NOT_UTF8', check(Buffer.from([0xe2, 0x80, 0x41])).code === 'TXT_NOT_UTF8');
    ok('byte de continuación suelto → TXT_NOT_UTF8', check(Buffer.from([0x41, 0x80, 0x42])).code === 'TXT_NOT_UTF8');
    ok('codificación sobrelarga (c0 af) → TXT_NOT_UTF8', check(Buffer.from([0xc0, 0xaf])).code === 'TXT_NOT_UTF8');
    ok('sustituto UTF-16 codificado en UTF-8 (ed a0 80) → TXT_NOT_UTF8', check(Buffer.from([0xed, 0xa0, 0x80])).code === 'TXT_NOT_UTF8');
    ok('archivo vacío → TXT_EMPTY', check(Buffer.alloc(0)).code === 'TXT_EMPTY');
    ok('byte nulo → TXT_BINARY (como antes)', check(Buffer.from([0x48, 0x00, 0x49])).code === 'TXT_BINARY');
    ok('UTF-16 con BOM (bytes nulos) → TXT_BINARY', check(Buffer.from('﻿Hola', 'utf16le')).code === 'TXT_BINARY');
    // Archivo > 64 KB con un carácter multibyte partido justo en la frontera del bloque de lectura.
    const big = Buffer.concat([Buffer.alloc(64 * 1024 - 1, 0x61), Buffer.from('í', 'utf8'), Buffer.from(' y más texto. '.repeat(500), 'utf8')]);
    ok('> 64 KB con «í» partido en la frontera de bloque → válido', check(big).ok);
    const bigBad = Buffer.concat([Buffer.from('ó'.repeat(40000), 'utf8'), Buffer.from([0xe9])]);
    ok('> 64 KB con un byte Windows-1252 al final → TXT_NOT_UTF8', check(bigBad).code === 'TXT_NOT_UTF8');
    ok('mensaje comprensible para TXT_NOT_UTF8', /UTF-8/.test(TEXT_UPLOAD_MESSAGES.TXT_NOT_UTF8) && /Guardar como/.test(TEXT_UPLOAD_MESSAGES.TXT_NOT_UTF8));

    console.log('\n[2] readUtf8Strict');
    ok('UTF-8 válido → mismo texto', readUtf8Strict(file(Buffer.from('Prólogo I.', 'utf8'))) === 'Prólogo I.');
    let err = null; try { readUtf8Strict(file(cp1252)); } catch (e) { err = e; }
    ok('Windows-1252 → lanza TXT_NOT_UTF8 (nunca devuelve «�»)', err?.code === 'TXT_NOT_UTF8');
    ok('contraste: readFileSync(…, "utf8") sí habría producido «�»', fs.readFileSync(file(cp1252), 'utf8').includes('�'));

    console.log('\n[3] TTS: sin sincronización con «�»');
    const calls = [];
    ai._setProviderClientsForTest({
        openai: { audio: { speech: { create: async ({ input }) => { calls.push(input); const b = Buffer.from(`AUDIO|${input}`); return { arrayBuffer: async () => b.buffer.slice(b.byteOffset, b.byteOffset + b.length) }; } } } },
        gemini: null,
    });
    const run = async (id, textPath, prevManifest) => {
        const up = path.join(root, `up-${id}`);
        const audioDir = path.join(up, 'audio', id);
        fs.mkdirSync(audioDir, { recursive: true });
        if (prevManifest) fs.writeFileSync(path.join(audioDir, 'manifest.json'), prevManifest);
        ai._resetBreakers(); calls.length = 0;
        const progress = [];
        const r = await generateAudioForContent(id, textPath, up, (p) => progress.push(p));
        return { r, progress, manifest: fs.existsSync(path.join(audioDir, 'manifest.json')) ? fs.readFileSync(path.join(audioDir, 'manifest.json'), 'utf8') : null };
    };
    const PREV = JSON.stringify({ _meta: { version: 2 }, 0: { text: 'anterior' } });
    const bad = await run('c-bad', file(Buffer.concat([Buffer.from('Antolog'), Buffer.from([0xed]), Buffer.from('a po'), Buffer.from([0xe9]), Buffer.from('tica. Fin del texto.')])), PREV);
    ok('TXT Windows-1252 → success:false con el error de codificación', bad.r.success === false && /UTF-8/.test(bad.r.error || ''), JSON.stringify(bad.r));
    ok('…0 llamadas al proveedor (nada sintetizado)', calls.length === 0);
    ok('…estado terminal error_proveedor (no queda en «generando»)', bad.progress.at(-1)?.status === 'error_proveedor', JSON.stringify(bad.progress));
    ok('…el manifest anterior se conserva byte a byte', bad.manifest === PREV);
    const missing = await run('c-missing', path.join(root, 'no-existe.txt'), null);
    ok('TXT ausente → error_proveedor (antes: ReferenceError en el catch y obra colgada)', missing.r.success === false && missing.progress.at(-1)?.status === 'error_proveedor', JSON.stringify(missing));
    const good = await run('c-good', file(Buffer.from('Antología poética. Prólogo I. Esa combinación —una vida aparentemente común— es una de las claves.', 'utf8')), null);
    const m = good.manifest ? JSON.parse(good.manifest) : null;
    const sents = m ? Object.keys(m).filter((k) => k !== '_meta').flatMap((k) => m[k].sentences) : [];
    ok('TXT UTF-8 válido → manifest publicado sin «�» y con tildes y raya', good.r.success === true && sents.length > 0 && !sents.some((s) => s.includes('�')) && sents[0].startsWith('Antología poética.') && sents.some((s) => s.includes('—una vida')), JSON.stringify(sents));
} catch (e) {
    ok('arnés', false, e.stack || e.message);
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
console.log(`\ntxtUtf8Guard — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
