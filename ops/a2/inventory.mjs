// V8.1-CLOSE-04 — inventario de solo lectura. Salida: agregados por grupo, sin nombres ni ids de personas.
import fs from 'node:fs';
const C = await import('/app/server/config.js');
const { resolveGroupLectorCohort } = await import('/app/server/analytics/groupAnalyticsSummary.mjs');
const O = await import('/app/server/identity/organizationScope.mjs');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const arr = (x) => (Array.isArray(x) ? x : []);
const users = arr(read(C.USERS_DB)), groups = arr(read(C.GROUPS_DB)), schools = arr(read(C.SCHOOLS_DB));
const byId = new Map(users.filter((u) => u?.id).map((u) => [u.id, u]));
const ctx = { registeredOrgIds: O.registeredOrganizationIds(schools), usersById: byId };
const active = (u) => !!u && (u.accountStatus === undefined || u.accountStatus === 'active');
const synthetic = (u) => { try { return !!O.isSyntheticUser?.(u); } catch { return false; } };
const roles = (u) => arr(u?.roles).map(String);
const isMed = (u) => roles(u).some((r) => /mediador|profesor/i.test(r));
const orgName = new Map(schools.map((s) => [s.id, s.name ?? s.nombre ?? s.id]));
const classes = {}, rows = [], all = new Set(), byOrg = new Map();
for (const g of groups) {
    const c = O.classifyGroup(g, ctx).class;
    classes[c] = (classes[c] ?? 0) + 1;
    if (c !== O.GROUP_CLASS.ACTIVE_REAL) continue;
    const cohort = resolveGroupLectorCohort(g, users, groups).filter((id) => active(byId.get(id)) && !synthetic(byId.get(id)));
    const meds = arr(g.mediatorIds).map((id) => byId.get(id)).filter((u) => active(u) && !synthetic(u) && isMed(u)).length;
    if (meds > 0) for (const id of cohort) { all.add(id); if (!byOrg.has(g.organizationId)) byOrg.set(g.organizationId, new Set()); byOrg.get(g.organizationId).add(id); }
    rows.push({ grupo: g.id, tipo: g.type ?? null, grado: g.gradeLevel ?? null, seccion: g.section ?? null,
        institucion: orgName.get(g.organizationId) ?? g.organizationId, lectores: cohort.length, mediadoresActivos: meds });
}
const lectorAccounts = users.filter((u) => active(u) && !synthetic(u) && roles(u).some((r) => /lector/i.test(r))).length;
console.log(JSON.stringify({ gruposTotal: groups.length, porClase: classes, institucionesRegistradas: schools.length,
    gruposActivos: rows.length, gruposConMediador: rows.filter((r) => r.mediadoresActivos > 0).length,
    lectoresDistintosEnGruposMediados: all.size, cuentasLectorActivas: lectorAccounts,
    lectoresPorInstitucion: Object.fromEntries([...byOrg].map(([k, v]) => [orgName.get(k) ?? k, v.size])) }));
rows.sort((a, b) => String(a.institucion).localeCompare(String(b.institucion)) || String(a.grupo).localeCompare(String(b.grupo)));
for (const r of rows) console.log(JSON.stringify(r));
