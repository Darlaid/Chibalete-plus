/**
 * uploadDedupOwnership.test.mjs — CHP-CONTENT-CANONICAL-2026-01 3D.3-R4.
 *
 * Producción (2026-10-15): el índice de dedup (en memoria, por réplica, clave =
 * solo hash) devolvió (1) la portada de Alicia TXT a la Alicia EPUB nueva y
 * (2) tras borrar la Alicia EPUB en api_2, la URL del EPUB ya borrado en api_1.
 * El DELETE de la Alicia EPUB borró la portada aliased, que «bio carroll» sigue
 * usando. Este test arranca DOS server.js REALES (réplicas) sobre el mismo
 * uploads/content.json temporales. NUNCA toca data/, uploads productivos ni red.
 *
 *   node server/__test__/uploadDedupOwnership.test.mjs
 */
import './helpers/testMode.mjs';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import {
    uploadOwnerOfRel, uploadOwnerOfUrl, uploadDedupKey, collectUploadUrls,
    uploadReferencesExcept, externalReferrersUnder,
} from '../uploadOwnership.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

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

// ── 0. helpers puros ─────────────────────────────────────────────────────────
console.log('[0] helpers de propiedad');
ok('uploadOwnerOfRel: subárbol / raíz', uploadOwnerOfRel('content-a/x.png') === 'content-a' && uploadOwnerOfRel('x.png') === '' && uploadOwnerOfRel('audio/c-1/m.json') === 'audio');
ok('uploadOwnerOfUrl: solo /uploads/', uploadOwnerOfUrl('/uploads/content-a/x.png') === 'content-a' && uploadOwnerOfUrl('/uploads/x.png') === '' && uploadOwnerOfUrl('https://x/y') === null);
ok('uploadDedupKey separa dueños', uploadDedupKey('a', 'h') !== uploadDedupKey('b', 'h') && uploadDedupKey('', 'h') === ':h');
const rec = { id: 'r', portada_url: '/uploads/r/a.jpg', materials: [{ url: '/uploads/r/m.pdf' }], album_data: [{ pages: [{ img: '/uploads/q/p.png' }] }], x: 'https://e.com/uploads/n' };
ok('collectUploadUrls: a cualquier profundidad, solo /uploads/', [...collectUploadUrls(rec)].sort().join() === '/uploads/q/p.png,/uploads/r/a.jpg,/uploads/r/m.pdf');
const refs = uploadReferencesExcept([rec, { id: 's', portada_url: '/uploads/r/a.jpg' }, null], 'r');
ok('uploadReferencesExcept excluye el propio registro', refs.size === 1 && refs.get('/uploads/r/a.jpg').join() === 's');
ok('externalReferrersUnder', externalReferrersUnder(refs, '/uploads/r/').join() === 's' && externalReferrersUnder(refs, '/uploads/zz/').length === 0);

// ── fixture ──────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_dedup_owner_'));
const up = path.join(tmp, 'uploads');
const put = (rel, data) => { const p = path.join(up, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
const exists = (url) => fs.existsSync(path.join(up, url.replace(/^\/uploads\//, '')));

const TAPA = png([200, 100, 50]);
const REP = png([11, 22, 33]);
const CANON = png([44, 55, 66]);
put('content-txt/tapa.jpg', TAPA);                 // Alicia TXT: portada física
put('content-txt/texto.txt', 'Alicia TXT');
put('content-epub/book.epub', 'epub-bytes');      // Alicia EPUB: fuente propia
put('content-a/cover.png', png([1, 1, 1]));
put('content-a/shared.pdf', 'pdf compartido');     // B referencia un archivo de A
put('content-solo/cover.png', png([2, 2, 2]));
put('content-solo/texto.txt', 'solo');
put('audio/content-solo/manifest.json', '{}');
put('content-y/y.png', png([3, 3, 3]));
put('content-l1/doc.pdf', 'legacy compartido');
put('content-rep/rep.png', REP);                   // lo indexan ambas réplicas al arrancar
put('content-can/canonical/media/z.png', CANON);   // canónico: nunca indexado
put('audio/content-epub/manifest.json', '{}');

const CONTENT = [
    { id: 'content-txt', titulo: 'Alicia TXT', portada_url: '/uploads/content-txt/tapa.jpg', texto_plano_url: '/uploads/content-txt/texto.txt' },
    { id: 'content-epub', titulo: 'Alicia EPUB', portada_url: '/uploads/content-txt/tapa.jpg', epub_url: '/uploads/content-epub/book.epub' },
    { id: 'content-bio', titulo: 'bio carroll', tipo: 'contexto_pedagogico', parentId: 'content-txt', portada_url: '/uploads/content-txt/tapa.jpg' },
    { id: 'content-a', titulo: 'A', portada_url: '/uploads/content-a/cover.png', url_recurso: '/uploads/content-a/shared.pdf' },
    { id: 'content-c', titulo: 'C', url_recurso: '/uploads/content-a/shared.pdf' },
    { id: 'content-solo', titulo: 'Solo', portada_url: '/uploads/content-solo/cover.png', texto_plano_url: '/uploads/content-solo/texto.txt' },
    { id: 'content-x', titulo: 'X', portada_url: '/uploads/content-y/y.png' },
    { id: 'content-y', titulo: 'Y', portada_url: '/uploads/content-y/y.png' },
    { id: 'content-l1', titulo: 'L1', url_recurso: '/uploads/content-l1/doc.pdf' },
    { id: 'content-l2', titulo: 'L2', url_recurso: '/uploads/content-l1/doc.pdf' },
    { id: 'content-rep', titulo: 'Rep', portada_url: '/uploads/content-rep/rep.png' },
];
const P = { users: path.join(tmp, 'users.json'), content: path.join(tmp, 'content.json') };
fs.writeFileSync(P.users, JSON.stringify([{ id: 'ADM', email: 'adm@fx.test', roles: ['administrador'], accountStatus: 'active' }]));
fs.writeFileSync(P.content, JSON.stringify(CONTENT));
for (const f of ['groups', 'schools', 'access']) fs.writeFileSync(path.join(tmp, `${f}.json`), '[]');

const startReplica = (n) => {
    const dataDir = path.join(tmp, `data${n}`);
    fs.mkdirSync(dataDir, { recursive: true });
    const port = 5700 + (process.pid % 100) * 2 + n;
    const child = spawn(process.execPath, ['server/server.js'], {
        cwd: REPO,
        env: {
            ...process.env, NODE_ENV: 'test', PORT: String(port),
            CHP_DATA_DIR: dataDir, USERS_DB: P.users, GROUPS_DB: path.join(tmp, 'groups.json'), SCHOOLS_DB: path.join(tmp, 'schools.json'),
            ACCESS_DB: path.join(tmp, 'access.json'), CONTENT_DB: P.content, UPLOADS_ROOT: up,
            USER_AUDIT_DB: path.join(tmp, `user_audit${n}.json`), SESSION_AUTH_MODE: 'off',
            OPENAI_API_KEY: '', GEMINI_API_KEY: '', TTS_MODE: 'mock', AI_MODE: 'mock',
        },
    });
    const r = { child, base: `http://127.0.0.1:${port}`, out: '' };
    child.stdout.on('data', d => { r.out += d; });
    child.stderr.on('data', d => { r.out += d; });
    return r;
};
const waitIndex = async (r) => {
    for (let i = 0; i < 400; i++) {
        if (r.child.exitCode !== null) throw new Error(`server rc=${r.child.exitCode}\n${r.out.slice(-2000)}`);
        if (/\[HASH_INDEX\] Built: \d+ entries/.test(r.out)) return;
        await sleep(200);
    }
    throw new Error(`índice nunca construido\n${r.out.slice(-2000)}`);
};
const upload = async (r, name, data, type, parentId) => {
    const fd = new FormData();
    fd.append('file', new Blob([data], { type }), name);
    const q = parentId ? `?parentId=${encodeURIComponent(parentId)}` : '';
    const res = await fetch(`${r.base}/api/upload${q}`, { method: 'POST', headers: { 'x-user-id': 'ADM' }, body: fd });
    return { status: res.status, body: await res.json().catch(() => ({})) };
};
const del = async (r, id) => (await fetch(`${r.base}/api/content/${id}`, { method: 'DELETE', headers: { 'x-user-id': 'ADM' } })).status;
const purge = async (r, url) => {
    const res = await fetch(`${r.base}/api/upload/purge`, { method: 'POST', headers: { 'x-user-id': 'ADM', 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
};
const ids = () => JSON.parse(fs.readFileSync(P.content, 'utf8')).map(c => c.id);

const S1 = startReplica(1);
const S2 = startReplica(2);
try {
    await Promise.all([waitIndex(S1), waitIndex(S2)]);
    const K = png([7, 8, 9]);

    console.log('\n[1] dedup por dueño');
    let a1 = await upload(S1, 'k.png', K, 'image/png', 'content-p1');
    let a2 = await upload(S1, 'k2.png', K, 'image/png', 'content-p1');
    ok('A. mismo parentId + mismo hash → misma URL', a1.status === 200 && a2.body.deduplicated === true && a2.body.url === a1.body.url, JSON.stringify([a1.body, a2.body]));
    const b = await upload(S1, 'k.png', K, 'image/png', 'content-p2');
    ok('B. otro parentId + mismo hash → URL distinta bajo su propio dueño', b.status === 200 && b.body.deduplicated !== true && b.body.url !== a1.body.url && uploadOwnerOfUrl(b.body.url) === 'content-p2', JSON.stringify(b.body));
    ok('B. … dos archivos físicos distintos', exists(a1.body.url) && exists(b.body.url));
    const t = await upload(S1, 'tapa.jpg', TAPA, 'image/png', 'content-new');
    ok('B. caso Alicia: la portada de Alicia TXT NO se presta a un contenido nuevo', t.body.url !== '/uploads/content-txt/tapa.jpg' && uploadOwnerOfUrl(t.body.url) === 'content-new', JSON.stringify(t.body));

    const M = png([5, 6, 7]);
    const c1 = await upload(S1, 'm.png', M, 'image/png', 'content-p3');
    fs.unlinkSync(path.join(up, c1.body.url.replace(/^\/uploads\//, '')));
    const c2 = await upload(S1, 'm.png', M, 'image/png', 'content-p3');
    ok('C. entrada stale → se invalida y el upload se guarda normal', c2.status === 200 && c2.body.deduplicated !== true && c2.body.url !== c1.body.url && exists(c2.body.url), JSON.stringify(c2.body));
    const c3 = await upload(S1, 'm.png', M, 'image/png', 'content-p3');
    ok('C. … y el nuevo archivo pasa a ser el hit vivo', c3.body.deduplicated === true && c3.body.url === c2.body.url);
    ok('C. … log UPLOAD_DEDUP_STALE', /\[UPLOAD_DEDUP_STALE\]/.test(S1.out));

    const d = await upload(S1, 'z.png', CANON, 'image/png', 'content-can');
    ok('D. artefacto canónico sigue fuera del índice', d.status === 200 && d.body.deduplicated !== true && !d.body.url.includes('/canonical/'), JSON.stringify(d.body));

    console.log('\n[2] dos réplicas: DELETE en una, entrada stale en la otra');
    ok('E. pre: content-rep/rep.png existe', exists('/uploads/content-rep/rep.png'));
    ok('E. DELETE content-rep en réplica 2 → 200', await del(S2, 'content-rep') === 200);
    ok('E. … su subárbol se borró', !exists('/uploads/content-rep/rep.png'));
    const e = await upload(S1, 'rep.png', REP, 'image/png', 'content-rep');
    ok('E. réplica 1 NO devuelve la URL muerta: guarda el upload', e.status === 200 && e.body.deduplicated !== true && exists(e.body.url), JSON.stringify(e.body));

    console.log('\n[3] DELETE — propiedad por subárbol');
    ok('caso real: DELETE Alicia EPUB → 200', await del(S2, 'content-epub') === 200);
    ok('caso real: la portada física de Alicia TXT NO se borra', exists('/uploads/content-txt/tapa.jpg'));
    ok('caso real: «bio carroll» sigue resolviendo su portada', exists(CONTENT.find(c => c.id === 'content-bio').portada_url));
    ok('caso real: la fuente propia del EPUB y su audio sí se borran', !exists('/uploads/content-epub/book.epub') && !exists('/uploads/audio/content-epub/manifest.json'));
    ok('caso real: log DELETE_KEEP_FOREIGN', /\[DELETE_KEEP_FOREIGN\] contentId=content-epub url=\/uploads\/content-txt\/tapa\.jpg/.test(S2.out));

    ok('A. X referencia /uploads/content-y/y.png → DELETE X no lo borra', await del(S1, 'content-x') === 200 && exists('/uploads/content-y/y.png'));
    ok('B. C referencia /uploads/content-a/shared.pdf → DELETE A → 200', await del(S1, 'content-a') === 200);
    ok('B. … NO rm -rf de /uploads/content-a/: shared.pdf sigue', exists('/uploads/content-a/shared.pdf'));
    ok('B. … el archivo propio no referenciado (cover.png) sí se borra', !exists('/uploads/content-a/cover.png'));
    ok('B. … log DELETE_KEEP_SUBTREE', /\[DELETE_KEEP_SUBTREE\] contentId=content-a dir=\/uploads\/content-a\/ referencedBy=content-c/.test(S1.out));
    ok('C. sin referencias externas → subárbol y audio se borran como antes', await del(S1, 'content-solo') === 200 && !fs.existsSync(path.join(up, 'content-solo')) && !fs.existsSync(path.join(up, 'audio', 'content-solo')));
    ok('D. URL legacy compartida: DELETE L1 no rompe a L2', await del(S2, 'content-l1') === 200 && exists('/uploads/content-l1/doc.pdf'));
    ok('D. … log DELETE_KEEP_SHARED', /\[DELETE_KEEP_SHARED\] contentId=content-l1 url=\/uploads\/content-l1\/doc\.pdf referencedBy=content-l2/.test(S2.out));
    const left = ids();
    ok('E. content.json: solo se quitaron los registros borrados',
        left.join() === ['content-txt', 'content-bio', 'content-c', 'content-y', 'content-l2'].join(), left.join());

    console.log('\n[4] purge no borra archivos referenciados');
    const pr = await purge(S1, '/uploads/content-txt/tapa.jpg');
    ok('purge de una URL referenciada → se conserva', pr.status === 200 && pr.body.kept === true && exists('/uploads/content-txt/tapa.jpg'), JSON.stringify(pr.body));
    const orphan = await upload(S1, 'o.png', png([9, 1, 9]), 'image/png', 'content-tmp');
    const po = await purge(S1, orphan.body.url);
    ok('purge de un huérfano real → se borra como antes', po.status === 200 && po.body.kept !== true && !exists(orphan.body.url));
} catch (err) {
    ok('arnés de réplicas', false, err.stack || err.message);
} finally {
    S1.child.kill(); S2.child.kill();
    await sleep(400);
    fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\nuploadDedupOwnership — ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
