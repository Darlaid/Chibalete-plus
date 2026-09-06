/**
 * pedagogyAccess01dB.test.mjs — CHP-ACCESS-PEDAGOGY-01D-B-R2.
 *
 * Protección del material pedagógico independiente: metadata (listado y
 * preflight) y assets (autorizador que consulta el edge por `auth_request`).
 *
 * Server REAL levantado contra fixtures TEMPORALES. No lee, copia ni toca
 * ningún asset editorial real ni ningún store del repositorio: el catálogo, el
 * padrón, los grupos y las reglas de acceso viven en un mkdtemp por ejecución.
 * Las rutas `/uploads/...` de las fixtures son cadenas: jamás se abre un fichero.
 *
 * Modo de sesión 'off' (contrato histórico x-user-id) para que la suite corra
 * igual en Windows y en Linux; la resolución de identidad del código bajo
 * prueba es la misma función en ambos modos.
 *
 *   node server/__test__/pedagogyAccess01dB.test.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    classifyContentItem,
    classifyUploadPath,
    normalizeUploadRequestPath,
} from '../accessService.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const ok = (label, cond, hint = '') => cond
    ? (console.log('  ✓', label), pass++)
    : (console.error('  ✗', label, hint), fail++);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES — reproducen la forma de la clasificación cerrada:
//   88 general/Experience (73 general + 15 nodos embebidos)
//   20 pedagogía independiente
//   27 assets exclusivos de pedagogía
//    1 asset compartido general/pedagógico
// ─────────────────────────────────────────────────────────────────────────────
const SHARED_ASSET = '/uploads/compartido.pdf';
const PED_TYPES = ['articulo_pedagogico', 'guia', 'contexto_pedagogico'];

const CATALOG = [];
for (let i = 0; i < 73; i++) {
    CATALOG.push({
        id: `gen-${i}`,
        tipo: ['libro', 'podcast', 'video'][i % 3],
        titulo: `General ${i}`,
        portada_url: `/uploads/cover-gen-${i}.jpg`,
        // gen-0 comparte fichero con un material pedagógico: debe seguir siendo general.
        url_recurso: i === 0 ? SHARED_ASSET : `/uploads/gen-${i}.pdf`,
    });
}
for (let i = 0; i < 15; i++) {
    CATALOG.push({
        id: `exp-${i}`,
        tipo: 'articulo_pedagogico',
        standalone: false,                      // nodo de una Experience publicada
        titulo: `Nodo Experience ${i}`,
        portada_url: `/uploads/cover-exp-${i}.jpg`,
        texto_plano_url: `/uploads/exp-${i}.txt`,
    });
}
for (let i = 0; i < 20; i++) {
    const item = {
        id: `ped-${i}`,
        tipo: PED_TYPES[i % 3],
        titulo: `Pedagogía ${i}`,
        portada_url: `/uploads/cover-ped-${i}.jpg`,   // portada: sigue pública
        url_recurso: `/uploads/ped-${i}.pdf`,
    };
    if (i < 7) item.texto_plano_url = `/uploads/ped-txt-${i}.txt`;
    if (i === 0) item.texto_ingles_url = SHARED_ASSET;
    CATALOG.push(item);
}

// La Experience de referencia: 41 nodos, 15 de ellos artículos embebidos.
const EXPERIENCE_NODE_IDS = [
    ...Array.from({ length: 15 }, (_, i) => `exp-${i}`),
    ...Array.from({ length: 26 }, (_, i) => `gen-${i}`),
];

const USERS = [
    { id: 'ADM',  roles: ['administrador'], accountStatus: 'active' },
    { id: 'MED',  roles: ['mediador'],      accountStatus: 'active' },
    { id: 'RDR',  roles: ['lector'],        accountStatus: 'active' },
    { id: 'RDR2', roles: ['lector'],        accountStatus: 'active' },
];
// Restricción explícita preexistente: RDR2 solo tiene autorizados gen-1 y ped-3.
const ACCESS_RULES = [
    { id: 'rule-rdr2', scope: 'user', scopeId: 'RDR2', titleIds: ['gen-1', 'ped-3'], collectionIds: [] },
];

const APK_PATH = '/uploads/chibalete-lu-0.9.0.apk';   // no referenciado en el catálogo
const UNLINKED_PATH = '/uploads/ruta-no-vinculada.bin';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Conteos y predicate (sin red)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[1] Predicate y conteos');

const byClass = CATALOG.reduce((acc, item) => {
    const c = classifyContentItem(item);
    acc[c] = (acc[c] || 0) + 1;
    return acc;
}, {});
const restricted = byClass.PEDAGOGY_RESTRICTED || 0;
const openItems = (byClass.GENERAL || 0) + (byClass.EMBEDDED_EXPERIENCE || 0);

ok('88 registros generales o de Experience', openItems === 88, `→ ${openItems}`);
ok('20 registros de pedagogía independiente', restricted === 20, `→ ${restricted}`);
ok('108 registros en total', CATALOG.length === 108, `→ ${CATALOG.length}`);

const allPaths = new Set();
for (const item of CATALOG) {
    for (const v of Object.values(item)) {
        if (typeof v === 'string' && v.startsWith('/uploads/')) allPaths.add(v);
    }
}
const assetClasses = {};
for (const p of allPaths) {
    const c = classifyUploadPath(p, CATALOG);
    (assetClasses[c] = assetClasses[c] || []).push(p);
}
const exclusive = assetClasses.PEDAGOGY_RESTRICTED || [];
ok('27 assets exclusivos de pedagogía', exclusive.length === 27, `→ ${exclusive.length}`);
ok('el asset compartido se clasifica como general',
    classifyUploadPath(SHARED_ASSET, CATALOG) === 'GENERAL',
    `→ ${classifyUploadPath(SHARED_ASSET, CATALOG)}`);
ok('las portadas de pedagogía siguen siendo públicas',
    classifyUploadPath('/uploads/cover-ped-0.jpg', CATALOG) === 'PUBLIC_ASSET');
ok('los textos de los nodos Experience NO son restringidos',
    classifyUploadPath('/uploads/exp-0.txt', CATALOG) === 'GENERAL');
ok('APK y ruta no vinculada quedan sin mapear',
    classifyUploadPath(APK_PATH, CATALOG) === 'UNMAPPED_ASSET'
    && classifyUploadPath(UNLINKED_PATH, CATALOG) === 'UNMAPPED_ASSET');

console.log('\n[2] Normalización de URI');
ok('traversal codificado denegado',
    normalizeUploadRequestPath('/uploads/%2e%2e/etc/passwd').ok === false);
ok('traversal literal denegado',
    normalizeUploadRequestPath('/uploads/../../etc/passwd').ok === false);
ok('backslash denegado',
    normalizeUploadRequestPath('/uploads/a\\b.txt').ok === false);
ok('codificación inválida denegada',
    normalizeUploadRequestPath('/uploads/%ZZ').ok === false);
ok('ruta fuera de /uploads/ denegada',
    normalizeUploadRequestPath('/etc/passwd').ok === false);
ok('ruta válida con query se normaliza',
    normalizeUploadRequestPath('/uploads/ped-0.pdf?v=2').path === '/uploads/ped-0.pdf');

// ─────────────────────────────────────────────────────────────────────────────
// 3. Contrato del edge (estructural sobre ops/edge/nginx.conf)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n[3] Contrato del edge');
const NGINX = fs.readFileSync(path.join(REPO, 'ops', 'edge', 'nginx.conf'), 'utf8');
const uploadsBlock = NGINX.slice(
    NGINX.indexOf('location ^~ /uploads/ {'),
    NGINX.indexOf('location /assets/ {'),
);
ok('/uploads/ conserva el alias', uploadsBlock.includes('alias /var/uploads/;'));
ok('/uploads/ consulta el autorizador', uploadsBlock.includes('auth_request /internal/uploads-authz;'));
ok('nginx sigue sirviendo los bytes (sin proxy_pass en /uploads/)', !uploadsBlock.includes('proxy_pass'));
ok('la location del autorizador es internal',
    /location = \/internal\/uploads-authz \{[^}]*\binternal;/s.test(NGINX));
ok('el autorizador recibe URI original, cookie y Authorization',
    /X-Original-URI \$request_uri/.test(NGINX)
    && /proxy_set_header Cookie \$http_cookie;/.test(NGINX)
    && /proxy_set_header Authorization \$http_authorization;/.test(NGINX));
ok('la caché pública por defecto se conserva',
    /default\s+30d;/.test(NGINX)
    && /default\s+"public, max-age=2592000, immutable";/.test(NGINX));
ok('la pedagogía autorizada usa private, no-store',
    /"private"\s+"private, no-store";/.test(NGINX) && /"private"\s+off;/.test(NGINX));
ok('el veredicto llega por auth_request_set',
    /auth_request_set \$chp_upload_cache_hint \$upstream_http_x_chp_cache;/.test(NGINX));
ok('no se tocan upstreams, TLS ni el vhost de Studio BI',
    NGINX.includes('upstream studio_bi_upstream {')
    && NGINX.includes('ssl_protocols TLSv1.2 TLSv1.3;')
    && NGINX.includes('server_name studio.chibaleteeditores.com;'));
ok('nginx.prod.conf queda fuera de esta unidad',
    !fs.readFileSync(path.join(REPO, 'nginx.prod.conf'), 'utf8').includes('auth_request'));

// ─────────────────────────────────────────────────────────────────────────────
// 4. Server real
// ─────────────────────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chp_pedagogy_'));
const P = {
    users: path.join(tmp, 'users.json'),
    groups: path.join(tmp, 'groups.json'),
    schools: path.join(tmp, 'schools.json'),
    access: path.join(tmp, 'access.json'),
    content: path.join(tmp, 'content.json'),
    uploads: path.join(tmp, 'uploads'),
    data: path.join(tmp, 'data'),
};
fs.mkdirSync(P.uploads, { recursive: true });
fs.writeFileSync(P.users, JSON.stringify(USERS));
fs.writeFileSync(P.groups, JSON.stringify([]));
fs.writeFileSync(P.schools, JSON.stringify([]));
fs.writeFileSync(P.access, JSON.stringify(ACCESS_RULES));
fs.writeFileSync(P.content, JSON.stringify(CATALOG));

const PORT = 3900 + (process.pid % 90);
const BASE = `http://127.0.0.1:${PORT}`;
const child = spawn(process.execPath, ['server/server.js'], {
    cwd: REPO,
    env: {
        ...process.env,
        NODE_ENV: 'test', PORT: String(PORT),
        SESSION_AUTH_MODE: 'off',
        // Mismo modo que producción: el fallback legacy sigue abierto y la
        // protección pedagógica debe demostrarse SOBRE él, no gracias a él.
        ACCESS_FALLBACK_MODE: 'open',
        CHP_DATA_DIR: P.data,
        USERS_DB: P.users, GROUPS_DB: P.groups, SCHOOLS_DB: P.schools,
        ACCESS_DB: P.access, CONTENT_DB: P.content, UPLOADS_ROOT: P.uploads,
        USER_AUDIT_DB: path.join(tmp, 'user_audit.json'),
        OFFLINE_ASSIGNMENT_DB_PATH: path.join(tmp, 'offline.db'),
        IDENTITY_DB: path.join(tmp, 'identity.db'),
        SESSIONS_DB: path.join(tmp, 'sessions.db'),
        EVENTS_SQLITE_PATH: path.join(tmp, 'events.db'),
        INSIGHTS_SQLITE_PATH: path.join(tmp, 'insights.db'),
        PROGRESS_SQLITE_PATH: path.join(tmp, 'progress.db'),
        ARCHIVE_SQLITE_PATH: path.join(tmp, 'events.archive.db'),
    },
});
let bootLog = '';
child.stdout.on('data', d => { bootLog += d; });
child.stderr.on('data', d => { bootLog += d; });

async function waitHealthy() {
    for (let i = 0; i < 150; i++) {
        if (child.exitCode !== null) throw new Error(`server rc=${child.exitCode}\n${bootLog.slice(-2000)}`);
        try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* aún no escucha */ }
        await sleep(300);
    }
    throw new Error(`el server nunca respondió healthy\n${bootLog.slice(-2000)}`);
}

const asUser = (id) => (id ? { 'x-user-id': id } : {});
const authz = (uri, userId) => fetch(`${BASE}/api/internal/uploads-authz`, {
    headers: { 'x-original-uri': uri, ...asUser(userId) },
});
const preflight = (contentId, userId) => fetch(
    `${BASE}/api/content/${encodeURIComponent(contentId)}/access?userId=${encodeURIComponent(userId)}`,
    { headers: asUser(userId) },
);

try {
    await waitHealthy();

    // ── Metadata por rol ────────────────────────────────────────────────────
    console.log('\n[4] Listado de catálogo por rol');
    const listFor = async (id) => {
        const r = await fetch(`${BASE}/api/content`, { headers: asUser(id) });
        return { status: r.status, body: await r.json() };
    };
    const readerList = await listFor('RDR');
    ok('el lector recibe 88 registros', readerList.status === 200 && readerList.body.length === 88,
        `→ ${readerList.status} / ${readerList.body?.length}`);
    ok('el lector no recibe ningún material pedagógico independiente',
        readerList.body.every(c => !String(c.id).startsWith('ped-')));
    ok('el lector conserva los 15 nodos de Experience',
        readerList.body.filter(c => String(c.id).startsWith('exp-')).length === 15);

    const medList = await listFor('MED');
    ok('el mediador recibe 108 registros', medList.status === 200 && medList.body.length === 108,
        `→ ${medList.status} / ${medList.body?.length}`);
    const admList = await listFor('ADM');
    ok('el administrador recibe 108 registros', admList.status === 200 && admList.body.length === 108,
        `→ ${admList.status} / ${admList.body?.length}`);

    // ── Preflight ───────────────────────────────────────────────────────────
    console.log('\n[5] Preflight de acceso');
    const rPed = await preflight('ped-0', 'RDR');
    ok('lector → pedagogía independiente = 403', rPed.status === 403, `→ ${rPed.status}`);
    const mPed = await preflight('ped-0', 'MED');
    ok('mediador → pedagogía independiente permitida', mPed.status === 200, `→ ${mPed.status}`);
    const aPed = await preflight('ped-0', 'ADM');
    ok('administrador → pedagogía independiente permitida', aPed.status === 200, `→ ${aPed.status}`);

    let embeddedAllowed = 0;
    for (const id of EXPERIENCE_NODE_IDS.filter(x => x.startsWith('exp-'))) {
        const r = await preflight(id, 'RDR');
        if (r.status === 200) embeddedAllowed++;
    }
    ok('los 15 nodos embebidos siguen permitidos al lector', embeddedAllowed === 15,
        `→ ${embeddedAllowed}`);

    const gen = await preflight('gen-5', 'RDR');
    ok('el contenido general sigue permitido al lector', gen.status === 200, `→ ${gen.status}`);

    // La Experience conserva sus 41 nodos resolviendo contra el catálogo visible.
    const readerIds = new Set(readerList.body.map(c => c.id));
    const resolved = EXPERIENCE_NODE_IDS.filter(id => readerIds.has(id));
    ok('la Experience conserva sus 41 nodos para el lector', resolved.length === 41,
        `→ ${resolved.length}`);

    // ── Restricción explícita preexistente ──────────────────────────────────
    console.log('\n[6] Restricción explícita preexistente');
    ok('la regla explícita sigue concediendo lo suyo',
        (await preflight('gen-1', 'RDR2')).status === 200);
    ok('la regla explícita sigue denegando lo demás',
        (await preflight('gen-2', 'RDR2')).status === 403);
    ok('una regla explícita no abre pedagogía a un lector',
        (await preflight('ped-3', 'RDR2')).status === 403);

    // ── Autorizador de assets ───────────────────────────────────────────────
    console.log('\n[7] Autorizador de assets');
    const noSession = await authz('/uploads/ped-0.pdf');
    ok('sin sesión → pedagogía = 401', noSession.status === 401, `→ ${noSession.status}`);
    const rdrAsset = await authz('/uploads/ped-0.pdf', 'RDR');
    ok('lector → pedagogía = 403', rdrAsset.status === 403, `→ ${rdrAsset.status}`);
    ok('el 403 no devuelve bytes', (await rdrAsset.text()) === '');
    ok('el 403 no emite caché pública', !rdrAsset.headers.get('cache-control'));

    const medAsset = await authz('/uploads/ped-txt-0.txt', 'MED');
    ok('mediador → pedagogía = 204', medAsset.status === 204, `→ ${medAsset.status}`);
    ok('la pedagogía autorizada se marca privada',
        medAsset.headers.get('x-chp-cache') === 'private');
    const admAsset = await authz('/uploads/ped-0.pdf', 'ADM');
    ok('administrador → pedagogía = 204', admAsset.status === 204, `→ ${admAsset.status}`);

    console.log('\n[8] Lo que NO debe cambiar');
    for (const [label, uri] of [
        ['libro general sin sesión', '/uploads/gen-5.pdf'],
        ['texto de nodo Experience sin sesión', '/uploads/exp-0.txt'],
        ['portada de pedagogía sin sesión', '/uploads/cover-ped-0.jpg'],
        ['asset compartido sin sesión', SHARED_ASSET],
        ['APK sin sesión', APK_PATH],
        ['ruta no vinculada sin sesión', UNLINKED_PATH],
    ]) {
        const r = await authz(uri);
        ok(`${label} → 204`, r.status === 204, `→ ${r.status}`);
        if (r.status === 204) {
            ok(`${label} no se marca privado`, !r.headers.get('x-chp-cache'));
        }
    }

    console.log('\n[9] Rutas inválidas');
    for (const [label, uri] of [
        ['traversal codificado', '/uploads/%2e%2e/etc/passwd'],
        ['traversal literal', '/uploads/../secret'],
        ['codificación inválida', '/uploads/%ZZ'],
        ['fuera de /uploads/', '/etc/passwd'],
        ['URI ausente', ''],
    ]) {
        const r = await authz(uri);
        ok(`${label} → 404`, r.status === 404, `→ ${r.status}`);
    }
} catch (e) {
    console.error('  ✗ fallo de la suite:', e.message);
    fail++;
} finally {
    child.kill();
    await sleep(300);
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ }
}

console.log(`\npedagogyAccess01dB: ${pass} ok, ${fail} fallos`);
process.exit(fail === 0 ? 0 : 1);
