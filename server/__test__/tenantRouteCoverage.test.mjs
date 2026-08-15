/**
 * tenantRouteCoverage.test.mjs — CHP-IDDB-M1-B-TENANT-AUTHZ-01.
 *
 * Guard de COBERTURA: ninguna ruta sensible (que lee/escribe recursos con dueño
 * de tenant: users/groups-members/students/progress/aula-viva-students/leo-mediator)
 * puede quedar sin política de autorización tenant. Si aparece una ruta nueva que
 * matchea un patrón sensible sin token de scoping, el test falla.
 *
 * Tokens de scoping reconocidos: tenantGuard, membershipMutationGuard,
 * scopeUsersForActor/scopeGroupsForActor (en el handler), studentGuard (router).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.resolve(__dirname, '..', 'server.js');
const AULA = path.resolve(__dirname, '..', 'aulaViva', 'operationalRouter.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, h), fail++);

const serverSrc = fs.readFileSync(SERVER, 'utf8');
const aulaSrc = fs.readFileSync(AULA, 'utf8');

// Patrones de ruta SENSIBLE (recursos con dueño de tenant).
const SENSITIVE = [
    /\/api\/users\b/,
    /\/api\/groups\/:[^/']+\/members/,
    /\/api\/groups\/:[^/']+\/candidates/,
    /\/api\/groups\/:[^/']+\/diagnosis/,
    /\/api\/students\/:[^/']+\/status/,
    /\/api\/progress\/(user|item)\//,
    /\/api\/leo\/mediator\/student/,
];
// Rutas listadas como scoped-in-handler (no llevan middleware token en la línea,
// pero filtran server-side dentro del handler). Verificadas aparte.
const HANDLER_SCOPED = ['/api/users']; // GET usa scopeUsersForActor; groups usa scopeGroupsForActor

// ADMIN_GLOBAL explícito: CRUD de usuario (crear/editar/borrar) es autoridad
// global por diseño (00 doc §H): un mediador NO crea/borra usuarios. Quedan
// gobernadas por requireAdminAccess (rol admin server-side o admin-secret).
const ADMIN_GLOBAL = new Set(['PUT /api/users/:id', 'DELETE /api/users/:id']);

// Extrae todas las líneas app.METHOD('/api/...').
const routeLineRe = /app\.(get|post|put|delete|patch)\((['"])(\/api\/[^'"]+)\2([^\n]*)/g;
const routes = [];
let m;
while ((m = routeLineRe.exec(serverSrc))) {
    routes.push({ method: m[1], route: m[3], rest: m[4], line: m[0] });
}
ok('se extrajeron rutas /api de server.js', routes.length > 20, `n=${routes.length}`);

const scopingToken = (line) => /tenantGuard|membershipMutationGuard|scopeUsersForActor|scopeGroupsForActor/.test(line);

// GET /api/groups y GET /api/users filtran en handler → verificar en el cuerpo.
ok('GET /api/users filtra server-side (scopeUsersForActor)', /scopeUsersForActor\(req/.test(serverSrc));
ok('GET /api/groups filtra server-side (scopeGroupsForActor)', /scopeGroupsForActor\(req/.test(serverSrc));

// Cada ruta sensible (salvo las handler-scoped) debe tener token de scoping en su línea.
const uncovered = [];
for (const r of routes) {
    const sensitive = SENSITIVE.some(rx => rx.test(r.route));
    if (!sensitive) continue;
    if (HANDLER_SCOPED.includes(r.route)) continue; // scoped en handler (verificado arriba)
    const key = `${r.method.toUpperCase()} ${r.route}`;
    if (ADMIN_GLOBAL.has(key)) continue; // autoridad global explícita y declarada
    if (!scopingToken(r.line)) uncovered.push(key);
}
ok('todas las rutas sensibles de server.js tienen política tenant', uncovered.length === 0,
    `sin cubrir: ${uncovered.join(', ')}`);

// Aula Viva: rutas /students/:userId/* deben llevar studentGuard.
const aulaStudentRe = /router\.get\((['"])(\/students\/:[^'"]+)\1([^\n]*)/g;
const aulaUncovered = [];
let a;
while ((a = aulaStudentRe.exec(aulaSrc))) {
    if (!/studentGuard/.test(a[3])) aulaUncovered.push(a[2]);
}
ok('todas las rutas /students/* de Aula Viva llevan studentGuard', aulaUncovered.length === 0,
    `sin cubrir: ${aulaUncovered.join(', ')}`);

// Contadores concretos de cobertura (regresión si bajan).
const membersRoutes = routes.filter(r => /\/api\/groups\/:[^/']+\/members/.test(r.route));
ok('rutas de members cubiertas (≥3)', membersRoutes.length >= 3 && membersRoutes.every(r => scopingToken(r.line)),
    `n=${membersRoutes.length}`);

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
