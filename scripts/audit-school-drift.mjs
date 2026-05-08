// ─────────────────────────────────────────────────────────────────────────────
// scripts/audit-school-drift.mjs
//
// READ-ONLY auditoría de drift institucional sobre la data de producción.
// NO modifica producción. NO escribe archivos. NO ejecuta migraciones. Sólo
// lee usuarios y grupos (vía bind mounts del container API), agrega métricas
// y emite el reporte por stdout.
//
// ── Cómo ejecutarlo ─────────────────────────────────────────────────────────
//
// Diseñado para correr DENTRO del container chibalete_api_1, donde los bind
// mounts a /app/data-critical/ y /app/data/ están disponibles. Se inyecta
// vía stdin pipe — el script no tiene que estar copiado en el VPS:
//
//   cat scripts/audit-school-drift.mjs | ssh root@72.60.158.97 \
//     'docker exec -i chibalete_api_1 node --input-type=module'
//
// (Si en el futuro algún script lo orqueste como parte de un health check,
// la firma stdin-pipe se conserva para no requerir despliegue separado del
// archivo en el VPS.)
//
// ── Qué detecta ─────────────────────────────────────────────────────────────
//
//   §1 Estados de campos en users.json:
//      colegio / organizationId con valores normal | empty | whitespace-only |
//      null | undefined | edge-whitespace.
//
//   §2 Estados de campos en groups_db.json (school + organizationId, mismo
//      esquema).
//
//   §3 Drift de strings:
//      - duplicados case/whitespace (mismo trim+lowercase, raw distinto)
//      - duplicados accent (mismo después de stripDiacritics)
//      - edge whitespace en colegio/school
//      - distintos valores únicos con sus counts.
//
//   §4 Cross-correlación lectores ↔ grupos:
//      - lectores cuyo colegio no matchea ningún group.school (orfanatos)
//      - groups cuyo school no matchea ningún lector.colegio
//      - groups con fallback colegio activo (school única + canales vacíos)
//        + cuántos lectores aparecen vía ese fallback.
//
//   §5 Impacto del hardening de _sameSchool (Commit 3.5):
//      - users con colegio empty/whitespace × groups con school empty/
//        whitespace = pares cuyo comportamiento cambia.
//
//   §6 Adopción de organizationId (% de users / groups con campo poblado).
//
// ── Interpretación básica ───────────────────────────────────────────────────
//
//   • Si §3 lista variantes case/accent/whitespace > 0 → typos en CSV import
//     o data manual; cada cluster es una institución potencialmente
//     fragmentada. Investigar si son legítimamente distintas o el mismo
//     colegio mal escrito.
//
//   • Si §4 reporta groups con fallback colegio activo y N lectores vía
//     fallback > 0 → esos N lectores aparecen en Aula Viva pero NO tienen
//     groupIds explícitos. Es legítimo hoy, pero la primera asignación
//     explícita en ese grupo extingue el fallback para los restantes — la
//     UI del Gestor de Membresías debe advertir antes de actuar.
//
//   • Si §5 reporta "SI cambia comportamiento" → hay drift de empty strings
//     que el hardening de _sameSchool va a frenar. Antes de deploy del
//     hardening, decidir si esos pares deben repararse o son data garbage.
//
//   • Si §6 muestra adopción organizationId baja (<50%) → la mayoría de
//     validaciones cross-school caen al fallback colegio normalizado.
//     Mantener vigilancia sobre §3 (cualquier drift es vector real).
//
// ── Reglas operacionales ────────────────────────────────────────────────────
//
//   • READ-ONLY: lee dos archivos JSON, no escribe nada.
//   • Sin dependencias: usa sólo node:fs (built-in).
//   • Sin runtime productivo: no monta endpoints, no abre puertos, no
//     interactúa con el process tree del API.
//   • NO integrado al pipeline de deploy: ejecutar manualmente cuando se
//     necesite (pre-deploy, post-import CSV, soporte migración).
//   • NO automatizado vía cron: si en el futuro se quiere programar,
//     evaluar primero el blast radius de output verboso en logs.
//
// ─────────────────────────────────────────────────────────────────────────────

import fs from "node:fs";

const USERS_PATH  = "/app/data-critical/usuarios_colegios_oro.json";
const GROUPS_PATH = "/app/data/groups_db.json";

const users  = JSON.parse(fs.readFileSync(USERS_PATH,  "utf8"));
const groups = JSON.parse(fs.readFileSync(GROUPS_PATH, "utf8"));

const classify = (val) => {
    if (val === null) return "null";
    if (val === undefined) return "undefined";
    if (typeof val !== "string") return "non-string-" + typeof val;
    if (val.length === 0) return "empty";
    if (val.trim().length === 0) return "whitespace-only";
    if (val !== val.trim()) return "string-with-edge-whitespace";
    return "string";
};
const norm = (s) => (typeof s === "string" ? s.trim().toLowerCase() : null);
const stripAccents = (s) => typeof s === "string"
    ? s.normalize("NFD").replace(/[̀-ͯ]/g, "")
    : null;
const normLoose = (s) => stripAccents(norm(s));
const isLector = (u) => Array.isArray(u && u.roles) && u.roles.includes("lector");

console.log("================================================");
console.log("§1  USERS - total: " + users.length);
console.log("================================================");
const ucState = {}, uoState = {};
for (const u of users) {
    const c = classify(u && u.colegio);
    const o = classify(u && u.organizationId);
    ucState[c] = (ucState[c] || 0) + 1;
    uoState[o] = (uoState[o] || 0) + 1;
}
console.log("user.colegio states:");
Object.entries(ucState).sort((a,b)=>b[1]-a[1]).forEach((e) => console.log("  " + e[1].toString().padStart(5) + "  " + e[0]));
console.log("user.organizationId states:");
Object.entries(uoState).sort((a,b)=>b[1]-a[1]).forEach((e) => console.log("  " + e[1].toString().padStart(5) + "  " + e[0]));

const lectores = users.filter(isLector);
console.log("lectores (rol=lector): " + lectores.length);

console.log("");
console.log("================================================");
console.log("§2  GROUPS - total: " + groups.length);
console.log("================================================");
const gsState = {}, goState = {};
for (const g of groups) {
    const s = classify(g && g.school);
    const o = classify(g && g.organizationId);
    gsState[s] = (gsState[s] || 0) + 1;
    goState[o] = (goState[o] || 0) + 1;
}
console.log("group.school states:");
Object.entries(gsState).sort((a,b)=>b[1]-a[1]).forEach((e) => console.log("  " + e[1].toString().padStart(3) + "  " + e[0]));
console.log("group.organizationId states:");
Object.entries(goState).sort((a,b)=>b[1]-a[1]).forEach((e) => console.log("  " + e[1].toString().padStart(3) + "  " + e[0]));

console.log("");
console.log("================================================");
console.log("§3  DRIFT - colegios y schools (variantes)");
console.log("================================================");

const colegioCounts = new Map();
for (const u of users) {
    if (typeof (u && u.colegio) !== "string" || u.colegio.trim().length === 0) continue;
    colegioCounts.set(u.colegio, (colegioCounts.get(u.colegio) || 0) + 1);
}
console.log("distinct user.colegio values (non-empty): " + colegioCounts.size);
[...colegioCounts.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 30).forEach((e) =>
    console.log("  " + e[1].toString().padStart(5) + " x " + JSON.stringify(e[0])));

const byNorm = new Map();
for (const u of users) {
    if (typeof (u && u.colegio) !== "string" || u.colegio.trim().length === 0) continue;
    const k = norm(u.colegio);
    if (!byNorm.has(k)) byNorm.set(k, new Set());
    byNorm.get(k).add(u.colegio);
}
const caseVariants = [...byNorm.entries()].filter((e) => e[1].size > 1);
console.log("");
console.log("case/whitespace variants of colegio (same trim+lowercase, distinct raw): " + caseVariants.length);
caseVariants.forEach((e) => console.log("  norm=" + JSON.stringify(e[0]) + "  variants: " + [...e[1]].map(v => JSON.stringify(v)).join(", ")));

const byLoose = new Map();
for (const u of users) {
    if (typeof (u && u.colegio) !== "string" || u.colegio.trim().length === 0) continue;
    const k = normLoose(u.colegio);
    if (!byLoose.has(k)) byLoose.set(k, new Set());
    byLoose.get(k).add(norm(u.colegio));
}
const accentVariants = [...byLoose.entries()].filter((e) => e[1].size > 1);
console.log("");
console.log("accent variants (same after stripDiacritics, distinct trim+lower): " + accentVariants.length);
accentVariants.forEach((e) => console.log("  loose=" + JSON.stringify(e[0]) + "  variants: " + [...e[1]].map(v => JSON.stringify(v)).join(", ")));

const wsUsers = users.filter(u => typeof (u && u.colegio) === "string" && u.colegio.trim().length > 0 && u.colegio !== u.colegio.trim());
console.log("");
console.log("users with edge whitespace in colegio: " + wsUsers.length);
wsUsers.slice(0, 10).forEach(u => console.log("  user.id=" + u.id + " colegio=" + JSON.stringify(u.colegio)));

const schoolCounts = new Map();
for (const g of groups) {
    if (typeof (g && g.school) !== "string") { schoolCounts.set("NON_STRING", (schoolCounts.get("NON_STRING")||0)+1); continue; }
    schoolCounts.set(g.school, (schoolCounts.get(g.school) || 0) + 1);
}
console.log("");
console.log("distinct group.school values: " + schoolCounts.size);
[...schoolCounts.entries()].sort((a,b)=>b[1]-a[1]).forEach((e) =>
    console.log("  " + e[1].toString().padStart(3) + " x " + JSON.stringify(e[0])));

const wsGroups = groups.filter(g => typeof (g && g.school) === "string" && g.school.trim().length > 0 && g.school !== g.school.trim());
console.log("");
console.log("groups with edge whitespace in school: " + wsGroups.length);
wsGroups.slice(0, 10).forEach(g => console.log("  group.id=" + g.id + " school=" + JSON.stringify(g.school)));

console.log("");
console.log("================================================");
console.log("§4  CROSS-CORRELATION lectores vs grupos");
console.log("================================================");

const groupSchoolNormSet = new Set(groups.map(g => norm(g && g.school)).filter(s => s));

const orphanColegios = new Map();
let lectorsWithEmptyColegio = 0;
let lectorsWithNullColegio  = 0;
for (const u of lectores) {
    if (u && (u.colegio === null || u.colegio === undefined)) { lectorsWithNullColegio++; continue; }
    if (typeof u.colegio === "string" && u.colegio.trim().length === 0) { lectorsWithEmptyColegio++; continue; }
    const c = norm(u.colegio);
    if (!groupSchoolNormSet.has(c)) {
        orphanColegios.set(u.colegio, (orphanColegios.get(u.colegio) || 0) + 1);
    }
}
console.log("lectores con colegio null/undefined: " + lectorsWithNullColegio);
console.log("lectores con colegio empty/whitespace: " + lectorsWithEmptyColegio);
const orphanTotal = [...orphanColegios.values()].reduce((a,b)=>a+b,0);
console.log("lectores cuyo colegio NO matchea ningun group.school: " + orphanTotal + " (" + orphanColegios.size + " colegios distintos)");
[...orphanColegios.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 20).forEach((e) =>
    console.log("  " + e[1].toString().padStart(5) + " x " + JSON.stringify(e[0])));

const lectorColegioNormSet = new Set(lectores.map(u => norm(u && u.colegio)).filter(s => s));
const groupsNoLectores = groups.filter(g => {
    const s = norm(g && g.school);
    return s && !lectorColegioNormSet.has(s);
});
console.log("");
console.log("grupos cuyo school no matchea ningun lector.colegio: " + groupsNoLectores.length);
groupsNoLectores.slice(0, 10).forEach(g => console.log("  group.id=" + g.id + " school=" + JSON.stringify(g.school)));

const groupsBySchoolNorm = new Map();
for (const g of groups) {
    const s = norm(g && g.school);
    if (!s) continue;
    if (!groupsBySchoolNorm.has(s)) groupsBySchoolNorm.set(s, []);
    groupsBySchoolNorm.get(s).push(g);
}
const fallbackActive = [];
for (const entry of groupsBySchoolNorm.entries()) {
    const s = entry[0], gs = entry[1];
    if (gs.length !== 1) continue;
    const g = gs[0];
    const sids = Array.isArray(g.studentIds) ? g.studentIds : [];
    const mids = Array.isArray(g.memberIds)  ? g.memberIds  : [];
    if (sids.length === 0 && mids.length === 0) {
        const lecCount = lectores.filter(u => norm(u && u.colegio) === s).length;
        fallbackActive.push({ groupId: g.id, school: g.school, lectoresImplicit: lecCount });
    }
}
console.log("");
console.log("=== FALLBACK COLEGIO ACTIVO ===");
console.log("grupos con fallback colegio activo (school unico + canales vacios): " + fallbackActive.length);
fallbackActive.forEach(o =>
    console.log("  group=" + o.groupId + "  school=" + JSON.stringify(o.school) + "  lectores via fallback=" + o.lectoresImplicit));

console.log("");
console.log("================================================");
console.log("§5  IMPACTO COMMIT 3.5 (_sameSchool empty hardening)");
console.log("================================================");
const usersEmptyColegio = users.filter(u =>
    typeof (u && u.colegio) === "string" && u.colegio.trim().length === 0);
const groupsEmptySchool = groups.filter(g =>
    typeof (g && g.school) === "string" && g.school.trim().length === 0);
console.log("users con colegio empty/whitespace-only: " + usersEmptyColegio.length);
console.log("groups con school empty/whitespace-only: " + groupsEmptySchool.length);
const wouldChange = usersEmptyColegio.length > 0 && groupsEmptySchool.length > 0;
console.log("");
console.log("hay AL MENOS UN par (user empty x group empty) que cambia comportamiento? " + (wouldChange ? "SI" : "NO"));
if (wouldChange) {
    console.log("user.id list (empty colegio, hasta 10):");
    usersEmptyColegio.slice(0, 10).forEach(u =>
        console.log("  " + u.id + " email=" + JSON.stringify(u.email || "no-email") + " roles=" + JSON.stringify(u.roles || [])));
    console.log("group.id list (empty school, hasta 10):");
    groupsEmptySchool.slice(0, 10).forEach(g =>
        console.log("  " + g.id + " name=" + JSON.stringify(g.name || "no-name")));
}

console.log("");
console.log("================================================");
console.log("§6  ORGANIZATION_ID - adopcion actual");
console.log("================================================");
const usersWithOrg  = users.filter(u => typeof (u && u.organizationId) === "string" && u.organizationId.trim().length > 0);
const groupsWithOrg = groups.filter(g => typeof (g && g.organizationId) === "string" && g.organizationId.trim().length > 0);
console.log("users con organizationId no-vacio: " + usersWithOrg.length + "/" + users.length);
console.log("groups con organizationId no-vacio: " + groupsWithOrg.length + "/" + groups.length);
console.log("adopcion users: " + (users.length > 0 ? Math.round(100 * usersWithOrg.length / users.length) + "%" : "n/a"));
console.log("adopcion groups: " + (groups.length > 0 ? Math.round(100 * groupsWithOrg.length / groups.length) + "%" : "n/a"));

console.log("");
console.log("AUDIT COMPLETE - read-only, sin escrituras");
