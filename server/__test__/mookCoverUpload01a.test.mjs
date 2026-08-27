/**
 * mookCoverUpload01a.test.mjs — CHP-MOOK-COVER-UPLOAD-01A
 *
 * Tres capas, porque la unidad las necesita las tres:
 *
 *   A. Política pura      — dimensiones, ratio, peso, spoofing, corrupción.
 *   B. Endpoint real HTTP — auth, rol, límites, doble clic, y la garantía de
 *                           que subir una cubierta NO muta el store.
 *   D. Derivación (01A-R1) — la escalera de calidad que optimiza el original
 *                           antes de subirlo, con primitivas de navegador falsas.
 *   C. Contrato visual    — que los consumidores declaren 16:9 + cover + center.
 *
 * La capa B levanta el servidor de verdad contra un fixture aislado. Sin eso,
 * "requireAdminAccess está puesto" sería una afirmación sobre el código y no
 * sobre el comportamiento — que es justo el error que esta unidad ya cometió
 * una vez al leer la firma de `/api/upload` y no su `app.use`.
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { readImageDimensions } from '../lib/imageDimensions.js';
import { validateCover, extensionForMime } from '../lib/coverPolicy.js';
import {
    COVER_SOURCE_MAX_BYTES, COVER_UPLOAD_MAX_BYTES, COVER_HELP_TEXT,
} from '../../utils/coverContract.js';
import { optimizeCover, OPTIMIZE_ERROR } from '../../utils/coverOptimizer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '../..');

let passed = 0;
const ok = (name) => { passed++; console.log(`  ok — ${name}`); };

// ───────────────────────── generadores de imagen real ─────────────────────────

/** PNG válido de w×h. Los datos son rojos; lo que importa es la cabecera IHDR. */
function makePng(w, h) {
    const chunk = (type, data) => {
        const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
        const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
        const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
        return Buffer.concat([len, body, crc]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
    ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
    // Una fila de relleno basta: ningún validador de esta unidad decodifica píxeles.
    const raw = Buffer.concat(Array.from({ length: Math.min(h, 4) },
        () => Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3)])));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** CRC32 propio: zlib.crc32 no existe en todas las versiones de Node soportadas. */
function crc32(buf) {
    let c, crc = 0xffffffff;
    for (let n = 0; n < buf.length; n++) {
        c = (crc ^ buf[n]) & 0xff;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        crc = (crc >>> 8) ^ c;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

/** JPEG con SOI + APP0 + SOF0 declarando w×h. `file-type` lo reconoce por FFD8FF. */
function makeJpeg(w, h) {
    const sof = Buffer.alloc(19);
    sof.writeUInt16BE(0xffc0, 0); sof.writeUInt16BE(17, 2);
    sof[4] = 8; sof.writeUInt16BE(h, 5); sof.writeUInt16BE(w, 7); sof[9] = 3;
    return Buffer.concat([
        Buffer.from([0xff, 0xd8]),
        Buffer.from([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00,
            0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
        sof, Buffer.from([0xff, 0xd9]),
    ]);
}

/** WebP extendido (VP8X): dimensiones como uint24 LE menos uno. */
function makeWebp(w, h) {
    const buf = Buffer.alloc(30);
    buf.write('RIFF', 0, 'ascii'); buf.writeUInt32LE(22, 4);
    buf.write('WEBP', 8, 'ascii'); buf.write('VP8X', 12, 'ascii');
    buf.writeUInt32LE(10, 16); buf[20] = 0;
    const wm = w - 1, hm = h - 1;
    buf[24] = wm & 0xff; buf[25] = (wm >> 8) & 0xff; buf[26] = (wm >> 16) & 0xff;
    buf[27] = hm & 0xff; buf[28] = (hm >> 8) & 0xff; buf[29] = (hm >> 16) & 0xff;
    return buf;
}

// ───────────────────────────── A. POLÍTICA PURA ──────────────────────────────

console.log('\nA. Política de cubierta');

for (const [label, make] of [['PNG', makePng], ['JPEG', makeJpeg], ['WebP', makeWebp]]) {
    const buf = make(1600, 900);
    const d = readImageDimensions(buf);
    assert.deepStrictEqual(d, { width: 1600, height: 900 }, `${label} 1600x900`);
    ok(`${label} válido 1600 × 900 se lee correctamente`);
}

{
    const mimeOf = { PNG: 'image/png', JPEG: 'image/jpeg', WebP: 'image/webp' };
    for (const [label, make] of [['PNG', makePng], ['JPEG', makeJpeg], ['WebP', makeWebp]]) {
        const buf = make(1600, 900);
        const v = validateCover({ buffer: buf, mime: mimeOf[label], size: 200_000 });
        assert.strictEqual(v.ok, true, `${label} debería pasar: ${v.error}`);
    }
    ok('los tres formatos pasan la política con el tamaño recomendado');
}

{
    const v = validateCover({ buffer: makePng(3840, 2160), mime: 'image/png', size: 900_000 });
    assert.strictEqual(v.ok, true, v.error);
    ok('imagen 16:9 de mayor resolución (3840 × 2160) se acepta');
}

{
    const v = validateCover({ buffer: makePng(1024, 576), mime: 'image/png', size: 50_000 });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, 'TOO_SMALL');
    assert.match(v.error, /1280 × 720/);
    ok('dimensiones bajo el mínimo se rechazan con mensaje en español');
}

{
    const v = validateCover({ buffer: makePng(1600, 1200), mime: 'image/png', size: 50_000 });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, 'BAD_RATIO');
    ok('proporción 4:3 se rechaza');
}

{
    // 1366×768 = 1.7786. Se desvía 0.0011 del 16:9 ideal: debe entrar.
    const v = validateCover({ buffer: makePng(1366, 768), mime: 'image/png', size: 50_000 });
    assert.strictEqual(v.ok, true, 'la tolerancia técnica debe admitir 1366 × 768');
    ok('la tolerancia admite 1366 × 768 y no es holgura editorial');
}

{
    const v = validateCover({ buffer: makePng(1600, 900), mime: 'image/png', size: COVER_UPLOAD_MAX_BYTES + 1 });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, 'TOO_LARGE');
    ok('archivo por encima de 5 MB se rechaza');
}

{
    // Un PNG renombrado a .jpg llega con MIME real image/png: la política mira
    // el MIME detectado, nunca la extensión.
    const v = validateCover({ buffer: makePng(1600, 900), mime: 'application/pdf', size: 10_000 });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, 'MIME_NOT_ALLOWED');
    ok('MIME real no permitido se rechaza (extensión falsificada)');
}

{
    const v = validateCover({ buffer: Buffer.from('no soy una imagen'), mime: 'image/png', size: 17 });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, 'UNREADABLE');
    ok('archivo corrupto se rechaza sin lanzar excepción');
}

{
    const truncated = makePng(1600, 900).subarray(0, 12);
    assert.strictEqual(readImageDimensions(truncated), null);
    ok('cabecera truncada devuelve null en vez de lanzar');
}

{
    // Bomba de descompresión: cabecera minúscula que declara 30000×16875 (506 MP).
    const v = validateCover({ buffer: makePng(30000, 16875), mime: 'image/png', size: 40_000 });
    assert.strictEqual(v.ok, false);
    assert.strictEqual(v.code, 'TOO_MANY_PIXELS');
    ok('imagen con recuento de píxeles abusivo se rechaza');
}

{
    assert.strictEqual(extensionForMime('image/jpeg'), '.jpg');
    assert.strictEqual(extensionForMime('image/png'), '.png');
    assert.strictEqual(extensionForMime('image/webp'), '.webp');
    assert.strictEqual(extensionForMime('application/pdf'), null);
    ok('la extensión final la fija el MIME real, no el nombre del cliente');
}

// ───────────────────────── B. ENDPOINT REAL POR HTTP ─────────────────────────

console.log('\nB. Endpoint POST /api/experiences/:id/cover');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'chp-cover-01a-'));
const DATA = path.join(TMP, 'data');
const UPLOADS = path.join(TMP, 'uploads');
fs.mkdirSync(DATA); fs.mkdirSync(UPLOADS);

const EXP_ID = 'exp-cover-test';
const VER_ID = 'expv-cover-test';
const MOOK_FIXTURE = {
    experiences: [{
        id: EXP_ID, slug: 'cover-test', title: 'Cover Test', description: 'd',
        status: 'published', currentVersionId: VER_ID,
        imageUrl: '/uploads/original-intacta.jpg',
        createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    }],
    versions: [{
        id: VER_ID, experienceId: EXP_ID, status: 'published',
        publishedAt: '2026-01-02T00:00:00.000Z', objectives: ['o'],
        modules: [{ id: 'm0', title: 'M0', nodes: [{ id: 'n1', type: 'ACTIVITY', title: 'A', required: true, resourceRef: null, config: { privado: true } }] }],
    }],
    runs: [], evidence: [],
};
fs.writeFileSync(path.join(DATA, 'mook_db.json'), JSON.stringify(MOOK_FIXTURE, null, 2));
fs.writeFileSync(path.join(DATA, 'content.json'), '[]');
fs.writeFileSync(path.join(DATA, 'progress_db.json'), '[]');

const USERS = path.join(TMP, 'users.json');
fs.writeFileSync(USERS, JSON.stringify([
    { id: 'u-admin', email: 'a@t.test', nombre_completo: 'Admin', roles: ['administrador'], accountStatus: 'active', password: 'x' },
    { id: 'u-lector', email: 'l@t.test', nombre_completo: 'Lector', roles: ['lector'], accountStatus: 'active', password: 'x' },
]));

const PORT = 3987;
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, [path.join(REPO, 'server', 'server.js')], {
    env: {
        ...process.env,
        NODE_ENV: 'test', PORT: String(PORT),
        USERS_DB: USERS, CHP_DATA_DIR: DATA, UPLOADS_ROOT: UPLOADS,
        // Deliberadamente SIN ADMIN_SECRET: la vía que esta suite ejercita es la
        // de usuario con rol, y `requireAdminAccess` cae a ella cuando no hay
        // secreto. Además, un literal aquí dispararía la regla
        // `chibalete-admin-secret` de gitleaks — y con razón: un secreto de
        // fixture en el repo sigue siendo un secreto en el repo.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
});
let serverLog = '';
child.stdout.on('data', d => { serverLog += d; });
child.stderr.on('data', d => { serverLog += d; });

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitUp() {
    for (let i = 0; i < 120; i++) {
        try {
            const r = await fetch(`${BASE}/api/health`);
            if (r.ok) return;
        } catch { /* aún arrancando */ }
        await sleep(500);
    }
    throw new Error(`el servidor de prueba no arrancó:\n${serverLog.slice(-2000)}`);
}

function form(buf, filename, type) {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type }), filename);
    return fd;
}

const post = (expId, fd, headers = {}) =>
    fetch(`${BASE}/api/experiences/${expId}/cover`, { method: 'POST', body: fd, headers });

const readStore = () => JSON.parse(fs.readFileSync(path.join(DATA, 'mook_db.json'), 'utf8'));

try {
    await waitUp();

    {
        const r = await post(EXP_ID, form(makePng(1600, 900), 'c.png', 'image/png'));
        assert.strictEqual(r.status, 401, `esperaba 401, vino ${r.status}`);
        ok('usuario NO autenticado recibe 401');
    }

    {
        // `requireAdminAccess` colapsa "sin identidad" y "rol insuficiente" en un
        // mismo 401 — es el comportamiento de TODAS sus rutas hermanas
        // (publish, archive, update). La cubierta lo hereda a propósito: un 403
        // a medida aquí sería una incoherencia dentro de /api/experiences.
        // Lo que importa no es el número, sino que el lector queda fuera y no
        // escribe nada.
        const before = fs.existsSync(path.join(UPLOADS, 'experience-covers'))
            ? fs.readdirSync(path.join(UPLOADS, 'experience-covers')).length : 0;
        const r = await post(EXP_ID, form(makePng(1600, 900), 'c.png', 'image/png'), { 'x-user-id': 'u-lector' });
        assert.strictEqual(r.status, 401, `esperaba 401, vino ${r.status}`);
        const after = fs.existsSync(path.join(UPLOADS, 'experience-covers'))
            ? fs.readdirSync(path.join(UPLOADS, 'experience-covers')).length : 0;
        assert.strictEqual(after, before, 'un lector no puede dejar bytes en disco');
        ok('usuario sin rol autorizado queda fuera (401) y no escribe nada');
    }

    const ADMIN = { 'x-user-id': 'u-admin' };

    {
        const r = await post('exp-inexistente', form(makePng(1600, 900), 'c.png', 'image/png'), ADMIN);
        assert.strictEqual(r.status, 404);
        assert.strictEqual(fs.readdirSync(UPLOADS).filter(f => f !== 'temp').length, 0);
        ok('Experience inexistente da 404 y no escribe nada');
    }

    let uploadedUrl = null;
    {
        const r = await post(EXP_ID, form(makePng(1600, 900), 'mi cubierta.png', 'image/png'), ADMIN);
        const body = await r.json();
        assert.strictEqual(r.status, 201, JSON.stringify(body));
        assert.ok(body.url?.startsWith('/uploads/experience-covers/'), body.url);
        assert.deepStrictEqual(Object.keys(body), ['url'], 'debe devolver ÚNICAMENTE la URL');
        uploadedUrl = body.url;
        ok('administrador sube una cubierta válida y recibe solo la URL canónica');
    }

    {
        const disk = path.join(UPLOADS, 'experience-covers', path.basename(uploadedUrl));
        assert.ok(fs.existsSync(disk), 'el archivo debe existir en disco');
        assert.ok(fs.existsSync(path.join(DATA, 'mook_db.json')));
        ok('el archivo aterriza dentro de uploads (árbol respaldado)');
    }

    {
        const store = readStore();
        assert.strictEqual(store.experiences.length, 1);
        assert.strictEqual(store.versions.length, 1, 'no debe crearse una v2');
        assert.strictEqual(store.runs.length, 0);
        assert.strictEqual(store.evidence.length, 0);
        assert.strictEqual(store.experiences[0].imageUrl, '/uploads/original-intacta.jpg',
            'imageUrl NO debe cambiar hasta que el operador guarde Información');
        assert.strictEqual(store.experiences[0].updatedAt, '2026-01-01T00:00:00.000Z');
        assert.strictEqual(store.versions[0].modules[0].nodes.length, 1);
        ok('subir la cubierta NO muta el store: ni imageUrl, ni v2, ni módulos, ni runs, ni evidencias');
    }

    {
        const before = fs.readdirSync(path.join(UPLOADS, 'experience-covers'));
        const r = await post(EXP_ID, form(makePng(1600, 900), 'mi cubierta.png', 'image/png'), ADMIN);
        const body = await r.json();
        assert.strictEqual(r.status, 201);
        const after = fs.readdirSync(path.join(UPLOADS, 'experience-covers'));
        assert.strictEqual(after.length, before.length + 1, 'cada subida crea un archivo nuevo');
        assert.notStrictEqual(body.url, uploadedUrl, 'la URL debe ser distinta (cache-busting)');
        assert.ok(fs.existsSync(path.join(UPLOADS, 'experience-covers', path.basename(uploadedUrl))),
            'la cubierta anterior NO se sobrescribe ni se borra');
        ok('doble subida del mismo archivo: cero overwrite, URL nueva, anterior intacta');
    }

    {
        const r = await post(EXP_ID, form(makePng(1024, 576), 'chica.png', 'image/png'), ADMIN);
        const body = await r.json();
        assert.strictEqual(r.status, 400);
        assert.strictEqual(body.code, 'TOO_SMALL');
        ok('dimensiones insuficientes: 400 con mensaje en español');
    }

    {
        const r = await post(EXP_ID, form(makePng(1600, 1200), 'ratio.png', 'image/png'), ADMIN);
        assert.strictEqual((await r.json()).code, 'BAD_RATIO');
        ok('proporción incorrecta: rechazada por el backend');
    }

    {
        // PDF renombrado a .png y anunciado como image/png: pasa el filtro
        // nominal y lo tumban los magic bytes.
        const fakePdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(2048)]);
        const r = await post(EXP_ID, form(fakePdf, 'trampa.png', 'image/png'), ADMIN);
        assert.strictEqual(r.status, 415, `esperaba 415, vino ${r.status}`);
        ok('MIME y extensión falsificados: 415 por validación binaria');
    }

    {
        const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900"></svg>');
        const r = await post(EXP_ID, form(svg, 'x.svg', 'image/svg+xml'), ADMIN);
        assert.ok(r.status >= 400, 'el SVG debe rechazarse');
        ok('SVG rechazado (vector de XSS en cubiertas)');
    }

    {
        const r = await post(EXP_ID, form(Buffer.from('roto'), 'roto.png', 'image/png'), ADMIN);
        assert.ok(r.status >= 400);
        ok('archivo corrupto rechazado');
    }

    {
        const big = Buffer.concat([makePng(1600, 900), Buffer.alloc(COVER_UPLOAD_MAX_BYTES + 1024)]);
        const r = await post(EXP_ID, form(big, 'grande.png', 'image/png'), ADMIN);
        assert.strictEqual(r.status, 413, `esperaba 413, vino ${r.status}`);
        ok('archivo mayor de 5 MB: 413, cortado por multer antes de terminar de escribir');
    }

    {
        const evil = '../../../../etc/passwd.png';
        const r = await post(EXP_ID, form(makePng(1600, 900), evil, 'image/png'), ADMIN);
        const body = await r.json();
        assert.strictEqual(r.status, 201);
        assert.ok(!body.url.includes('..'), body.url);
        assert.ok(body.url.startsWith('/uploads/experience-covers/'), body.url);
        assert.ok(!fs.existsSync(path.join(TMP, 'passwd.png')));
        ok('nombre de archivo malicioso: neutralizado, sin escapar del directorio');
    }

    {
        // Doble clic real: dos peticiones simultáneas. Ninguna puede pisar a la
        // otra ni dejar el store tocado.
        const [a, b] = await Promise.all([
            post(EXP_ID, form(makePng(1600, 900), 'race.png', 'image/png'), ADMIN),
            post(EXP_ID, form(makePng(1600, 900), 'race.png', 'image/png'), ADMIN),
        ]);
        assert.strictEqual(a.status, 201); assert.strictEqual(b.status, 201);
        const ua = (await a.json()).url, ub = (await b.json()).url;
        assert.notStrictEqual(ua, ub, 'dos subidas concurrentes no pueden compartir ruta');
        const store = readStore();
        assert.strictEqual(store.versions.length, 1);
        assert.strictEqual(store.experiences[0].imageUrl, '/uploads/original-intacta.jpg');
        ok('doble clic concurrente: dos rutas distintas, cero colisión, store intacto');
    }

    {
        const store = readStore();
        assert.strictEqual(store.experiences[0].imageUrl, '/uploads/original-intacta.jpg');
        assert.strictEqual(store.versions.length, 1);
        assert.strictEqual(store.runs.length, 0);
        assert.strictEqual(store.evidence.length, 0);
        ok('tras toda la batería: cero v2, cero runs, cero evidencias, imageUrl original');
    }
} finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch { /* best effort */ }
}


// ───────────────── D. DERIVACIÓN AUTOMÁTICA (01A-R1) ─────────────────────────

console.log('\nD. Optimización automática en el navegador');

/**
 * Primitivas falsas y DETERMINISTAS. El navegador prueba los píxeles; aquí se
 * prueba la escalera de decisión, que es donde vive la lógica.
 *
 * `sizeAt` traduce calidad → bytes, así se puede modelar cualquier original.
 */
function fakeDeps({ size = { width: 3334, height: 1875 }, sizeAt = () => 900_000,
    webp = true, decodeFails = false, encodeFails = false } = {}) {
    const calls = [];
    return {
        calls,
        deps: {
            decodeSize: async () => (decodeFails ? null : size),
            render: async (_f, { width, height, type, quality }) => {
                calls.push({ width, height, type, quality });
                if (encodeFails) return null;
                return { size: sizeAt(quality), type };
            },
            supportsWebp: () => webp,
        },
    };
}
const srcFile = (bytes, type = 'image/webp') => ({ size: bytes, type });

{
    const { deps, calls } = fakeDeps({ sizeAt: () => 1_200_000 });
    const r = await optimizeCover(srcFile(7_069_200), deps);
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.width, 1600); assert.strictEqual(r.height, 900);
    assert.strictEqual(r.type, 'image/webp');
    assert.strictEqual(r.quality, 0.90, 'debe quedarse en el primer peldaño');
    assert.strictEqual(calls.length, 1, 'no debe codificar de más');
    assert.ok(r.outputBytes < COVER_UPLOAD_MAX_BYTES);
    ok('fuente de 6,74 MB aceptada y derivada a 1600 × 900 WebP en un solo intento');
}

{
    // Primer peldaño se pasa; el segundo entra. La escalera debe recorrerse EN
    // ORDEN y detenerse en cuanto cabe.
    const sizes = { 0.90: 6_000_000, 0.85: 4_000_000, 0.80: 1_000_000 };
    const { deps, calls } = fakeDeps({ sizeAt: (q) => sizes[q] });
    const r = await optimizeCover(srcFile(9_000_000), deps);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.quality, 0.85);
    assert.deepStrictEqual(calls.map(c => c.quality), [0.90, 0.85]);
    ok('la escalera baja a 0.85 solo cuando 0.90 no cabe, y se detiene ahí');
}

{
    const { deps, calls } = fakeDeps({ sizeAt: () => 6_000_000 });
    const r = await optimizeCover(srcFile(9_000_000), deps);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, OPTIMIZE_ERROR.STILL_TOO_LARGE);
    assert.deepStrictEqual(calls.map(c => c.quality), [0.90, 0.85, 0.80], 'debe agotar la escalera');
    ok('si ni a 0.80 baja de 5 MB: error y NO se envía nada');
}

{
    // R2: el tope de SELECCIÓN es 50 MiB. Se fija el número, no solo la
    // constante: si alguien la cambia sin querer, esto lo delata.
    assert.strictEqual(COVER_SOURCE_MAX_BYTES, 50 * 1024 * 1024, 'el tope de selección es 50 MiB');
    assert.strictEqual(COVER_UPLOAD_MAX_BYTES, 5 * 1024 * 1024, 'el de transmisión sigue en 5 MiB');
    ok('los dos topes son 50 MiB (selección) y 5 MiB (transmisión), fijados por valor');
}

{
    const { deps } = fakeDeps();
    const r = await optimizeCover(srcFile(COVER_SOURCE_MAX_BYTES), deps);
    assert.strictEqual(r.ok, true, 'exactamente 50 MiB debe entrar');
    ok('fuente de exactamente 50 MiB aceptada');
}

{
    const { deps, calls } = fakeDeps();
    const r = await optimizeCover(srcFile(COVER_SOURCE_MAX_BYTES + 1), deps);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, OPTIMIZE_ERROR.SOURCE_TOO_LARGE);
    assert.match(r.error, /50 MB/, 'el mensaje debe anunciar el tope real, no uno viejo');
    assert.strictEqual(calls.length, 0, 'no debe decodificar algo que ya rechazó');
    ok('fuente de 50 MiB + 1 byte rechazada antes de decodificar, con el número correcto');
}

{
    // El activo vinculante de R2: 32,7 MiB. Entra con 50 MiB y NO habría entrado
    // con el tope anterior de 20 MiB — que es la razón de existir de esta unidad.
    const REAL = 34_285_674;
    assert.ok(REAL > 20 * 1024 * 1024, 'el arte definitivo superaba el tope viejo');
    assert.ok(REAL < COVER_SOURCE_MAX_BYTES, 'y entra en el nuevo');
    const { deps } = fakeDeps({ size: { width: 6667, height: 3750 }, sizeAt: () => 1_100_000 });
    const r = await optimizeCover(srcFile(REAL, 'image/png'), deps);
    assert.strictEqual(r.ok, true, r.error);
    assert.strictEqual(r.width, 1600); assert.strictEqual(r.height, 900);
    assert.strictEqual(r.sourceBytes, REAL);
    ok('activo vinculante de 32,7 MiB y 6667 × 3750 aceptado y derivado a 1600 × 900');
}

{
    // 25 MP entran; el guard real contra abuso sigue siendo el de píxeles.
    const { deps } = fakeDeps({ size: { width: 6667, height: 3750 } });
    const r = await optimizeCover(srcFile(34_285_674, 'image/png'), deps);
    assert.strictEqual(r.ok, true);
    const abusiva = fakeDeps({ size: { width: 30000, height: 16875 } });
    const r2 = await optimizeCover(srcFile(10_000_000, 'image/png'), abusiva.deps);
    assert.strictEqual(r2.ok, false);
    assert.strictEqual(r2.code, 'TOO_MANY_PIXELS');
    assert.strictEqual(abusiva.calls.length, 0, 'no debe redibujar una bomba de píxeles');
    ok('subir el tope de peso NO relajó el de 40 MP: 25 MP entra, 506 MP no');
}

{
    const { deps } = fakeDeps({ webp: false });
    const r = await optimizeCover(srcFile(7_000_000), deps);
    assert.strictEqual(r.ok, true);
    assert.strictEqual(r.type, 'image/jpeg');
    ok('navegador sin WebP: fallback a JPEG de alta calidad');
}

{
    const { deps } = fakeDeps({ decodeFails: true });
    const r = await optimizeCover(srcFile(1_000_000), deps);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, OPTIMIZE_ERROR.DECODE_FAILED);
    ok('fallo de decodificación se comunica sin lanzar');
}

{
    const { deps } = fakeDeps({ encodeFails: true });
    const r = await optimizeCover(srcFile(1_000_000), deps);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, OPTIMIZE_ERROR.ENCODE_FAILED);
    ok('fallo de códec se comunica sin lanzar');
}

{
    const { deps } = fakeDeps();
    const r = await optimizeCover(srcFile(1_000_000, 'application/pdf'), deps);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, OPTIMIZE_ERROR.MIME_NOT_ALLOWED);
    ok('formato inválido rechazado antes de tocar el decodificador');
}

{
    // El ratio se juzga sobre el ORIGINAL. Si se juzgara después de redibujar a
    // 1600 × 900, cualquier proporción pasaría y deformaríamos en silencio.
    const { deps, calls } = fakeDeps({ size: { width: 1600, height: 1200 } });
    const r = await optimizeCover(srcFile(1_000_000), deps);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'BAD_RATIO');
    assert.strictEqual(calls.length, 0, 'no debe redibujar algo con proporción inválida');
    ok('un 4:3 se rechaza ANTES de redibujar: optimizar no puede tapar deformar');
}

{
    const { deps } = fakeDeps({ size: { width: 1024, height: 576 } });
    const r = await optimizeCover(srcFile(1_000_000), deps);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, 'TOO_SMALL');
    ok('un original bajo el mínimo no se «arregla» ampliándolo');
}

{
    // Reproducibilidad: la misma entrada produce exactamente la misma salida.
    const a = await optimizeCover(srcFile(7_069_200), fakeDeps({ sizeAt: () => 1_234_567 }).deps);
    const b = await optimizeCover(srcFile(7_069_200), fakeDeps({ sizeAt: () => 1_234_567 }).deps);
    assert.deepStrictEqual(
        { q: a.quality, t: a.type, n: a.outputBytes },
        { q: b.quality, t: b.type, n: b.outputBytes });
    ok('la derivación es reproducible: sin búsqueda binaria, misma entrada = misma salida');
}

{
    const { deps } = fakeDeps({ sizeAt: () => 1_500_000 });
    const r = await optimizeCover(srcFile(7_069_200), deps);
    assert.strictEqual(r.sourceBytes, 7_069_200);
    assert.strictEqual(r.outputBytes, 1_500_000);
    assert.deepStrictEqual(r.sourceSize, { width: 3334, height: 1875 });
    ok('se reportan tamaño original y optimizado para mostrarlos al operador');
}


// ───────────── E. OBJETIVOS MÚLTIPLES (CHP-STUDIO-OBJECTIVES-MULTI-01) ────────

console.log('\nE. Objetivos múltiples en el Studio');

{
    const src = fs.readFileSync(path.join(REPO, 'components', 'studio', 'ExperienceStudio.tsx'), 'utf8');

    assert.ok(!/setObjetivo\(working\?\.objectives\?\.\[0\]/.test(src),
        'ya no puede cargarse solo el primer objetivo');
    assert.ok(!/objectives: objetivo\.trim\(\)/.test(src),
        'ya no puede guardarse un array de uno');
    ok('el colapso N→1 desapareció de carga y de guardado');

    assert.match(src, /const \[objetivos, setObjetivos\] = useState<string\[\]>/, 'el estado es una lista');
    assert.match(src, /Array\.isArray\(working\?\.objectives\) \? \[\.\.\.working\.objectives\] : \[\]/,
        'se cargan TODOS los objetivos');
    ok('el formulario carga la lista completa de objetivos');

    assert.match(src, /objetivos\.map\(o => o\.trim\(\)\)\.filter\(Boolean\)/,
        'normaliza con trim y descarta vacíos preservando el orden');
    assert.ok(!/slice\(0, *\d+\)/.test(src.slice(src.indexOf('const cleanObjectives'), src.indexOf('const routeChanged'))),
        'no se inventa un máximo que el contrato no tiene');
    ok('normalización: trim, sin vacíos, orden preservado y sin máximos inventados');

    assert.match(src, /if \(hasRoute && !readOnlyRoute && routeChanged\(\)\)/,
        'guardar metadata sola no puede arrastrar una versión');
    assert.match(src, /const routeChanged = \(\): boolean =>/, 'existe la comparación contra lo cargado');
    assert.match(src, /routeBaseline\.current = JSON\.stringify/, 'se registra la instantánea de carga');
    ok('sin cambios en la ruta no se escribe versión: se compara contra lo cargado');

    // La publicación sigue siendo un acto explícito y separado del guardado.
    const saveBody = src.slice(src.indexOf('const save = async'), src.indexOf('const publish = async'));
    assert.ok(!/publishStudioVersion/.test(saveBody), 'guardar NUNCA publica');
    assert.match(src, /const publish = async \(\) => \{[\s\S]{0,400}?publishStudioVersion/,
        'publicar es una acción propia');
    ok('guardar crea borrador; publicar sigue siendo un acto explícito aparte');

    assert.match(src, /aria-label=\{`Objetivo pedagógico \$\{i \+ 1\}`\}/, 'cada campo etiquetado');
    assert.match(src, /aria-label=\{`Quitar objetivo \$\{i \+ 1\}`\}/, 'el botón de quitar es accesible');
    assert.match(src, /Añadir objetivo/, 'existe acción de añadir');
    assert.match(src, /<fieldset disabled=\{expStatus === 'archived' \|\| readOnlyRoute\}/,
        'la versión publicada sigue siendo inmutable desde el formulario');
    ok('accesibilidad: etiqueta por campo, acciones nombradas y fieldset que respeta la inmutabilidad');

    assert.match(src, /optimizeCover\(file, browserDeps\(\)\)/, 'el uploader sigue en su sitio');
    assert.match(src, /aspectRatio: '16 \/ 9'/, 'la previsualización 16:9 no se tocó');
    ok('sin regresión del uploader ni de su previsualización 16:9');
}

// ─────────────────────────── C. CONTRATO VISUAL ──────────────────────────────

console.log('\nC. Contrato visual de los consumidores');

{
    const src = fs.readFileSync(path.join(REPO, 'pages', 'Biblioteca.tsx'), 'utf8');
    const hero = src.slice(src.indexOf('destacada.imageUrl'), src.indexOf('destacada.imageUrl') + 400);
    assert.match(hero, /aspectRatio: '16 \/ 9'/, 'el hero debe declarar 16:9');
    assert.match(hero, /objectFit: 'cover'/);
    assert.match(hero, /objectPosition: 'center'/);
    assert.ok(!/h-44/.test(hero), 'el alto fijo h-44 debe haber desaparecido');
    ok('Biblioteca → Experiencia destacada aplica 16:9 + cover + center');
}

{
    const src = fs.readFileSync(path.join(REPO, 'components', 'studio', 'ExperienceStudio.tsx'), 'utf8');
    assert.match(src, /Cubierta del MOOK/, 'la etiqueta debe ser «Cubierta del MOOK»');
    assert.ok(!/Ilustración \(URL de una imagen ya subida\)/.test(src),
        'la etiqueta antigua debe haber desaparecido del formulario principal');
    assert.match(src, /Subir nueva cubierta/);
    assert.match(src, /aspectRatio: '16 \/ 9'/, 'la previsualización debe ser 16:9');
    assert.match(src, /coverState === 'optimizing'/, 'debe existir estado de optimización');
    assert.match(src, /coverState === 'uploading'/, 'debe existir estado de subida');
    assert.match(src, /const coverBusy = coverState === 'optimizing' \|\| coverState === 'uploading'/,
        'el guard de ocupado debe cubrir AMBAS fases, no solo la subida');
    assert.match(src, /disabled=\{coverBusy/, 'protección contra doble clic en el botón');
    assert.match(src, /if \(f && !coverBusy\)/, 'el input tampoco debe aceptar archivos mientras hay trabajo');
    assert.match(src, /optimizeCover\(file, browserDeps\(\)\)/, 'la subida debe pasar por la derivación');
    assert.match(src, /COVER_HELP_TEXT/, 'el texto de ayuda debe venir del contrato compartido');
    assert.match(src, /O usar la URL de una imagen ya subida/, 'la vía manual se conserva');
    ok('Studio → Información: cubierta, previsualización 16:9, estados y vía manual');
}

{
    // El texto de ayuda es contractual: si cambia, debe cambiar aquí también.
    assert.match(COVER_HELP_TEXT, /hasta 50 MB/);
    assert.ok(!/20 MB/.test(COVER_HELP_TEXT), 'la ayuda no puede seguir anunciando el tope viejo');
    assert.match(COVER_HELP_TEXT, /1600 × 900/);
    assert.match(COVER_HELP_TEXT, /optimizar/);
    assert.ok(!/máximo 5 MB/.test(COVER_HELP_TEXT), 'la ayuda ya no debe anunciar el tope de 5 MB al operador');
    ok('la ayuda anuncia el límite de SELECCIÓN (50 MB) y la optimización automática');
}

{
    // La cubierta del libro es de otro sistema: ningún archivo de esta unidad
    // puede escribir `portada_url`.
    for (const f of ['server/lib/coverPolicy.js', 'utils/coverContract.js', 'server/lib/imageDimensions.js', 'utils/coverOptimizer.mjs']) {
        const src = fs.readFileSync(path.join(REPO, f), 'utf8');
        assert.ok(!/portada_url/.test(src), `${f} no debe mencionar portada_url`);
    }
    ok('los módulos de esta unidad no tocan portada_url del libro');
}

console.log(`\nCHP-MOOK-COVER-UPLOAD-01A — ${passed} aserciones OK\n`);
