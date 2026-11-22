/**
 * zodAdvisoryExposure.test.mjs — SEC-DEPS-02 / ZOD-01, cerrado en V9 65-SEC.
 *
 * GHSA-mrhx-c7xc-m3w5 / CVE-2023-54404 (zod: un array inválido generaba un issue por elemento y `.max()` no cortaba)
 * está CORREGIDO con zod >= 4.6.6: una colección con tope deja de recorrerse al superarlo. Ya no hay excepción en
 * osv-scanner.toml ni en .trivyignore, y este test impide que vuelva sin decisión expresa:
 *   - zod no baja de la versión corregida y las colecciones siguen teniendo tope (sin tope, el parche no aplica);
 *   - se conservan las defensas que justificaron la excepción (inventario de módulos, emisores, 100 kB por cuerpo);
 *   - los esquemas de entrada conservan su comportamiento tras la migración a zod 4.
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

console.log('\n[6] corrección aplicada: zod >= 4.6.6 y sin excepciones');
const lockPackages = JSON.parse(read('package-lock.json')).packages;
const lockZod = lockPackages['node_modules/zod']?.version;
const [zMaj, zMin, zPat] = String(lockZod).split('.').map((n) => parseInt(n, 10));
ok('zod instalado >= 4.6.6 (primera versión corregida)', zMaj > 4 || (zMaj === 4 && (zMin > 6 || (zMin === 6 && zPat >= 6))), lockZod);
ok('el lock no trae otra copia de zod', Object.keys(lockPackages).filter((k) => /(^|\/)node_modules\/zod$/.test(k)).length === 1);
const osv = read('osv-scanner.toml'), trivy = read('.trivyignore');
ok('osv-scanner.toml ya no ignora el aviso de zod', !/mrhx|CVE-2023-54404/.test(osv));
ok('.trivyignore ya no ignora el aviso de zod', !/mrhx|CVE-2023-54404/.test(trivy));
ok('osv-scanner.toml ya no ignora el aviso retirado de picomatch', !/fc5q|CVE-2026-112366|picomatch/i.test(osv));
const probe = (n) => { const t0 = process.hrtime.bigint(); const r = z.object({ keys: z.array(z.string().max(40)).max(50) }).strip().safeParse({ keys: Array(n).fill(0) });
    return { issues: r.success ? 0 : r.error.issues.length, ms: Number(process.hrtime.bigint() - t0) / 1e6 }; };
const big = probe(51000);
ok('z.array(...).max(50) con 51 000 elementos inválidos: corta en el tope (≤ 2 issues, < 50 ms)', big.issues >= 1 && big.issues <= 2 && big.ms < 50, JSON.stringify(big));
ok('dentro del tope se siguen validando los elementos', probe(3).issues === 3);

console.log('\n[7] los esquemas de entrada conservan su comportamiento con zod 4');
const msgs = (r) => (r.success ? [] : r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
ok('login: campo ausente → su mensaje propio', same(msgs(loginSchema.safeParse({})), ['email: email requerido', 'password: password requerido']), JSON.stringify(msgs(loginSchema.safeParse({}))));
ok('login: recorta el email y descarta campos extra', same(loginSchema.safeParse({ email: '  a@b.c  ', password: ' p ', rol: 'administrador' }).data, { email: 'a@b.c', password: ' p ' }));
ok('login: email corto y password vacío → mensajes propios', same(msgs(loginSchema.safeParse({ email: 'ab', password: '' })), ['email: email demasiado corto', 'password: password requerido']));
ok('login: no exige formato de email ni complejidad (cuentas heredadas)', loginSchema.safeParse({ email: 'usuario_heredado', password: 'x' }).success);
ok('login: tipo erróneo o cuerpo no objeto se rechaza', !loginSchema.safeParse({ email: 12345, password: ['a'] }).success && !loginSchema.safeParse(null).success && !loginSchema.safeParse('x').success);
ok('reset-confirm: token ausente y password de 7 → sus mensajes', same(msgs(resetConfirmSchema.safeParse({ password: '1234567' })), ['token: token requerido', 'password: mínimo 8 caracteres']));
ok('reset-confirm: token de 10 y password de 8 → válido', resetConfirmSchema.safeParse({ token: 't'.repeat(10), password: '12345678' }).success);
ok('reset-request: email de 255 se rechaza y de 254 se acepta', !resetRequestSchema.safeParse({ email: 'x'.repeat(255) }).success && resetRequestSchema.safeParse({ email: 'x'.repeat(254) }).success);
ok('offline: contentId ausente → su mensaje; solo espacios → vacío', same(msgs(assignBookSchema.safeParse({})), ['contentId: contentId requerido']) && same(msgs(assignBookSchema.safeParse({ contentId: '   ' })), ['contentId: contentId vacío']));
const reg4 = await import('../analytics/eventRegistry.js');
ok('registry: evento válido se acepta y descarta campos extra', same(reg4.validateEvent('session_heartbeat', { sessionId: 's', elapsedMs: 5, x: 1 }).payload, { sessionId: 's', elapsedMs: 5 }));
const badEv = reg4.validateEvent('session_heartbeat', { sessionId: '', elapsedMs: -1 });
ok('registry: evento inválido → invalid_payload con ruta y mensaje por campo', badEv.ok === false && badEv.code === 'invalid_payload' && same(badEv.issues.map((i) => i.path), ['sessionId', 'elapsedMs']) && badEv.issues.every((i) => typeof i.message === 'string' && i.message));
ok('registry: marca de tiempo como número o como texto, nunca decimal', reg4.validateEvent('session_started', { sessionId: 's', source: 'lu', startedAt: 1790000000000 }).ok
    && reg4.validateEvent('session_started', { sessionId: 's', source: 'lu', startedAt: '2026-11-22T00:00:00Z' }).ok && !reg4.validateEvent('session_started', { sessionId: 's', source: 'lu', startedAt: 1.5 }).ok);
for (const name of ARRAY_EVENTS) {
    const line = reg.split('\n').find((l) => l.trimStart().startsWith(`${name}:`)) || '';
    const field = (line.match(/(\w+):\s*z\.array\(/) || [])[1];
    const r = reg4.validateEvent(name, { [field]: Array(51000).fill(0) });
    const t0 = process.hrtime.bigint(); reg4.validateEvent(name, { [field]: Array(51000).fill(0) }); const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    ok(`registry · ${name}.${field}: 51 000 elementos inválidos no multiplican los issues (< 50 ms)`, !!field && r.ok === false && r.issues.length <= 10 && ms < 50, `field=${field} issues=${r.issues?.length} ms=${ms.toFixed(1)}`);
}

console.log(`\nzodAdvisoryExposure — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
