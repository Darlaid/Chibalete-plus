/**
 * uploadDedupCanonical.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3C.3A-R1.
 *
 * El índice de deduplicación de /api/upload (uploadHashIndex, en memoria) se
 * reconstruye al ARRANCAR recorriendo uploads. Los artefactos canónicos
 * (/uploads/<id>/canonical/**) son derivados con autoridad propia: nunca deben
 * ser candidatos de deduplicación. Este test arranca server.js REAL sobre un
 * uploads temporal (mismo camino de startup) y sube bytes idénticos.
 * NUNCA toca data/, data-critical/, uploads productivos ni la red.
 *
 *   node server/__test__/uploadDedupCanonical.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/** PNG 1×1 válido; `rgb` cambia los bytes. */
function png([r, g, b]) {
    const chunk = (type, data) => {
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const td = Buffer.concat([Buffer.from(type), data]);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td) >>> 0);
        return Buffer.concat([len, td, crc]);
    };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 2;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]), chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(Buffer.from([0, r, g, b]))), chunk('IEND', Buffer.alloc(0))]);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_dedup_canon_'));
const up = path.join(tmp, 'uploads');
const put = (rel, data) => { const p = path.join(up, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };

const X = png([1, 2, 3]);                 // solo existe como medio canónico
const T = 'Texto canónico derivado de un EPUB.\n\nSegundo párrafo.'; // solo existe como book.txt
const W = png([9, 9, 9]);                 // canónico Y fuente normal
const Z = png([4, 5, 6]);                 // solo fuente normal
const N = 'Un TXT normal cuyo nombre contiene canonical.';
const Q = png([7, 7, 7]);
put('content-a/canonical/media/logo.png', X);
put('content-a/canonical/book.txt', T);
put('content-a/canonical/book.json', '{"schemaVersion":1}\n');
put('content-a/canonical/media/w.png', W);
put('content-0/normal-w.png', W);
put('content-b/source.png', Z);
put('content-c/my-canonical-book.txt', N);
put('content-c/canonical-cover.png', Q);
const NORMAL_UNIQUE = 4; // W, Z, N, Q — ningún artefacto canónico

const P = { data: path.join(tmp, 'data'), users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json') };
fs.mkdirSync(P.data, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify([{ id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active' }]));
fs.writeFileSync(P.content, '[]');
for (const f of ['groups', 'schools', 'access']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');

const PORT = 5600 + (process.pid % 100);
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
let out = '';
child.stdout.on('data', d => { out += d; });
child.stderr.on('data', d => { out += d; });

const upload = async (name, data, type) => {
    const fd = new FormData();
    fd.append('file', new Blob([data], { type }), name);
    const r = await fetch(`${base}/api/upload`, { method: 'POST', headers: { 'x-user-id': 'ADM' }, body: fd });
    return { status: r.status, body: await r.json().catch(() => ({})) };
};
const isCanonical = (url) => typeof url === 'string' && url.split('/').slice(2, -1).includes('canonical');

try {
    let built = null;
    for (let i = 0; i < 200 && !built; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${out.slice(-2000)}`);
        built = out.match(/\[HASH_INDEX\] Built: (\d+) entries/);
        if (!built) await sleep(200);
    }
    if (!built) throw new Error(`índice nunca construido\n${out.slice(-2000)}`);

    console.log('[1] reconstrucción del índice al arrancar');
    ok(`índice = solo archivos normales (${NORMAL_UNIQUE}); 0 artefactos canónicos`, Number(built[1]) === NORMAL_UNIQUE, `entries=${built[1]}`);

    console.log('\n[2] canonical/media no es candidato de dedup');
    let r = await upload('logo.png', X, 'image/png');
    ok('bytes X (solo como medio canónico) → NO recibe content-a/canonical/media/logo.png', r.status === 200 && !isCanonical(r.body.url) && r.body.url !== '/uploads/content-a/canonical/media/logo.png', JSON.stringify(r.body));
    ok('… se guarda como archivo normal nuevo (no deduplicado)', r.body.deduplicated !== true && fs.existsSync(path.join(up, r.body.url.slice('/uploads/'.length))));
    const firstX = r.body.url;
    r = await upload('logo-otra-vez.png', X, 'image/png');
    ok('dedup incremental normal: segundo upload de X → el archivo normal recién subido', r.status === 200 && r.body.deduplicated === true && r.body.url === firstX, JSON.stringify(r.body));
    r = await upload('w.png', W, 'image/png');
    ok('bytes W (canónico + fuente normal) → dedup a la fuente normal', r.status === 200 && r.body.deduplicated === true && r.body.url === '/uploads/content-0/normal-w.png', JSON.stringify(r.body));

    console.log('\n[3] canonical/book.txt no es candidato de dedup');
    r = await upload('texto.txt', T, 'text/plain');
    ok('bytes de book.txt → NO recibe content-a/canonical/book.txt', r.status === 200 && !isCanonical(r.body.url) && r.body.deduplicated !== true, JSON.stringify(r.body));

    console.log('\n[4] dedup normal sin regresión');
    r = await upload('otra.png', Z, 'image/png');
    ok('fuente normal indexada al arrancar → dedup intacta', r.status === 200 && r.body.deduplicated === true && r.body.url === '/uploads/content-b/source.png', JSON.stringify(r.body));
    r = await upload('x.txt', N, 'text/plain');
    ok('nombre con «canonical» (my-canonical-book.txt) sigue indexado', r.body.deduplicated === true && r.body.url === '/uploads/content-c/my-canonical-book.txt', JSON.stringify(r.body));
    r = await upload('y.png', Q, 'image/png');
    ok('nombre con «canonical» (canonical-cover.png) sigue indexado', r.body.deduplicated === true && r.body.url === '/uploads/content-c/canonical-cover.png', JSON.stringify(r.body));
    ok('artefactos canónicos intactos', fs.readFileSync(path.join(up, 'content-a/canonical/media/logo.png')).equals(X) && fs.readFileSync(path.join(up, 'content-a/canonical/book.txt'), 'utf8') === T);
} catch (e) {
    ok('arnés del servidor', false, e.stack || e.message);
} finally {
    child.kill();
    await sleep(300);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nuploadDedupCanonical — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
