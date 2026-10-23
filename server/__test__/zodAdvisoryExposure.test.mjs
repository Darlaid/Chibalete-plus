/**
 * zodAdvisoryExposure.test.mjs — SEC-DEPS-02 / ZOD-01.
 *
 * Fija las condiciones que justifican la excepción temporal de OSV para
 * GHSA-mrhx-c7xc-m3w5 (zod: un array inválido genera un issue por elemento).
 * En zod 3 `.max()` NO corta la validación: registra too_big y aun así recorre
 * cada elemento. La mitigación es que ninguna entrada externa llegue a un
 * array de zod y que todo cuerpo JSON quede en 100 kB tras descomprimir.
 * Si este test falla, la excepción de osv-scanner.toml deja de estar
 * justificada: revisar antes de tocar el test.
 *
 *   node server/__test__/zodAdvisoryExposure.test.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { z } from 'zod';
import { validate } from '../middleware/validate.js';
import { loginSchema, resetRequestSchema, resetConfirmSchema } from '../schemas/auth.schema.js';
import { assignBookSchema } from '../schemas/offline.schema.js';
import { LEGACY_EVENT_MAP } from '../analytics/legacyEventNormalizer.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = path.join(ROOT, 'server');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

function walk(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (e.name !== '__test__' && e.name !== '__tests__' && e.name !== 'node_modules') walk(p, out); }
        else if (/\.(m?js|cjs)$/.test(e.name)) out.push(p);
    }
    return out;
}
const serverFiles = walk(SERVER).map((p) => path.relative(ROOT, p).split(path.sep).join('/'));
const src = Object.fromEntries(serverFiles.map((f) => [f, read(f)]));

const ZOD_MODULES = [
    'server/analytics/eventRegistry.js',
    'server/observability/rum.js',
    'server/schemas/auth.schema.js',
    'server/schemas/offline.schema.js',
];
const ARRAY_EVENTS = ['group_updated', 'membership_moved', 'leo_memory_updated', 'leo_profile_updated'];

console.log('\n[1] inventario: zod solo en los módulos auditados');
const importers = serverFiles.filter((f) => /from\s+['"]zod['"]|require\(\s*['"]zod['"]\s*\)/.test(src[f])).sort();
ok('los importadores de zod son exactamente los 4 auditados', JSON.stringify(importers) === JSON.stringify(ZOD_MODULES), JSON.stringify(importers));

console.log('\n[2] colecciones: solo 4 arrays, todos en el registry y con tope');
const COLL = /z\.(array|set|map|record|tuple)\(/g;
for (const f of ZOD_MODULES.filter((f) => !f.endsWith('eventRegistry.js'))) {
    ok(`${f}: sin colecciones de zod`, !(src[f].match(COLL) || []).length);
}
const reg = src['server/analytics/eventRegistry.js'];
const regColl = reg.match(COLL) || [];
ok('eventRegistry: exactamente 4 colecciones y todas son z.array', regColl.length === 4 && regColl.every((m) => m === 'z.array('), JSON.stringify(regColl));
for (const ev of ARRAY_EVENTS) {
    const line = reg.split('\n').find((l) => l.trimStart().startsWith(`${ev}:`)) || '';
    const m = line.match(/z\.array\(.*?\)\)\.max\((\d+)\)/);
    ok(`${ev}: array con .max(n ≤ 500)`, !!m && Number(m[1]) <= 500, line.trim().slice(0, 120));
}

console.log('\n[3] alcanzabilidad: ninguna entrada externa llega a esos arrays');
const emitters = (ev) => serverFiles.filter((f) => f !== 'server/analytics/eventRegistry.js' && new RegExp(`['"\`]${ev}['"\`]`).test(src[f]));
ok('group_updated: ningún emisor en el servidor', emitters('group_updated').length === 0, JSON.stringify(emitters('group_updated')));
ok('membership_moved: ningún emisor en el servidor', emitters('membership_moved').length === 0, JSON.stringify(emitters('membership_moved')));
for (const ev of ['leo_memory_updated', 'leo_profile_updated']) {
    ok(`${ev}: solo lo emite leoBackboneEmitter`, JSON.stringify(emitters(ev)) === JSON.stringify(['server/leoBackboneEmitter.mjs']), JSON.stringify(emitters(ev)));
}
const leo = src['server/leoBackboneEmitter.mjs'];
const clamps = leo.match(/\.filter\([^)]*typeof [a-z] === 'string'[^)]*\)\.slice\(0, 50\)\.map\(\w+ => \w+\.slice\(0, 40\)\)/g) || [];
ok('leoBackboneEmitter recorta keys/fields a 50 strings de ≤ 40 antes de validar', clamps.length === 2, `clamps=${clamps.length}`);
const readingNames = new Set(Object.values(LEGACY_EVENT_MAP));
ok('los eventos de lectura del cliente no incluyen eventos con array', ARRAY_EVENTS.every((ev) => !readingNames.has(ev)));

console.log('\n[4] cuerpo HTTP: 100 kB tras descomprimir en todos los parsers');
const serverJs = src['server/server.js'];
const jsonCalls = serverFiles.flatMap((f) => (src[f].match(/express\.json\([^)]*?\)\)?/g) || []).map((m) => `${f}: ${m}`));
ok('ningún express.json con `limit` propio', jsonCalls.every((c) => !/limit/.test(c)), JSON.stringify(jsonCalls));
ok('ningún express.text / raw / urlencoded / bodyParser', !serverFiles.some((f) => /express\.(text|raw|urlencoded)\(|bodyParser\./.test(src[f])));
ok('server.js mantiene el parser JSON global', /app\.use\(express\.json\(\{ verify:/.test(serverJs));

const app = express();
app.use(express.json());
app.post('/login', validate({ body: loginSchema }), (req, res) => res.json({ reached: true }));
app.use((err, req, res, next) => res.status(err.status || 500).json({ type: err.type }));
const srv = app.listen(0);
const base = `http://127.0.0.1:${srv.address().port}`;
const post = (body, headers = {}) => fetch(base + '/login', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });
ok('cuerpo de 101 kB → 413', (await post(JSON.stringify({ email: 'a@b.c', password: 'p', pad: 'x'.repeat(101 * 1024) }))).status === 413);
ok('gzip que se expande a 10 MB → 413', (await post(zlib.gzipSync(JSON.stringify({ pad: 'x'.repeat(10 * 1024 * 1024) })), { 'content-encoding': 'gzip' })).status === 413);
ok('deflate que se expande a 1 MB → 413', (await post(zlib.deflateSync(JSON.stringify({ pad: 'y'.repeat(1024 * 1024) })), { 'content-encoding': 'deflate' })).status === 413);
ok('array de 51k en un campo no declarado se descarta (.strip) → 200', (await post(JSON.stringify({ email: 'a@b.c', password: 'p', keys: Array(51000).fill(0) }))).status === 200);
srv.close();

console.log('\n[5] peor caso de los esquemas alcanzables con 100 kB adversariales');
const keysObj = () => { const o = {}; for (let i = 0; i < 8500; i++) o['k' + String(i).padStart(6, '0')] = 0; return o; };
const inputs = [['8.5k claves extra', keysObj()], ['string de ~100 kB', { email: 'x'.repeat(100 * 1024 - 200), password: 'y', token: 'tttttttttt', contentId: 'c' }]];
for (const [n, s] of [['login', loginSchema], ['resetRequest', resetRequestSchema], ['resetConfirm', resetConfirmSchema], ['offlineAssign', assignBookSchema]]) {
    for (const [label, input] of inputs) {
        const t0 = process.hrtime.bigint();
        const r = s.safeParse(input);
        const ms = Number(process.hrtime.bigint() - t0) / 1e6;
        const issues = r.success ? 0 : r.error.issues.length;
        ok(`${n} · ${label}: ≤ 2 issues y < 200 ms`, issues <= 2 && ms < 200, `issues=${issues} ms=${ms.toFixed(1)}`);
    }
}

console.log('\n[6] excepción OSV acotada');
const osv = read('osv-scanner.toml');
const entry = osv.split('[[IgnoredVulns]]').find((b) => /id\s*=\s*"GHSA-mrhx-c7xc-m3w5"/.test(b)) || '';
const until = (entry.match(/ignoreUntil\s*=\s*(\d{4}-\d{2}-\d{2})/) || [])[1];
ok('osv-scanner.toml ignora GHSA-mrhx-c7xc-m3w5 con fecha', !!until, entry.slice(0, 80));
ok('la excepción caduca a más tardar el 2026-11-23 (no se renueva sola)', !!until && until <= '2026-11-23', until);
ok('la excepción es solo para ese id (sin alias ni comodines)', (osv.match(/mrhx/g) || []).length >= 1 && !/id\s*=\s*"CVE-2023-54404"/.test(osv));
const lockZod = JSON.parse(read('package-lock.json')).packages['node_modules/zod']?.version;
ok('zod sigue en 3.25.76 (otra versión exige reevaluar)', lockZod === '3.25.76', lockZod);

// Informativo: si una versión futura corta en .max(), la excepción puede retirarse.
const probe = z.object({ keys: z.array(z.string().max(40)).max(50) }).strip().safeParse({ keys: Array(51000).fill(0) });
console.log(`  · zod ${lockZod}: z.array().max(50) con 51k elementos inválidos → ${probe.success ? 0 : probe.error.issues.length} issues (si fuera 1, .max() ya corta)`);

console.log(`\nzodAdvisoryExposure — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
