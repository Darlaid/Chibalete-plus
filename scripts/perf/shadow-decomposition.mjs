/** Descomposición del coste canónico: ¿dónde se va el tiempo por petición? */
import fs from 'node:fs';
const { createMetricsProvider } = await import('/app/server/metrics/metricsProvider.mjs');
const { loadCanonicalContext, computeCanonicalMetrics } = await import('/app/server/metrics/canonicalMetricsService.mjs');
const { buildIndex, computeOrganization } = await import('/app/engines/metrics/referenceEngine.mjs');
const { classifyGroup } = await import('/app/server/identity/organizationScope.mjs');

const S = JSON.parse(fs.readFileSync('/app/data/schools_db.json','utf8'));
const now = Date.now();
const P30 = { fromTs: now - 30*86400000, toTs: now, days: 30 };
const provider = createMetricsProvider();
const ms = (f) => { const t=process.hrtime.bigint(); const r=f(); return [Number(process.hrtime.bigint()-t)/1e6, r]; };
const msA = async (f) => { const t=process.hrtime.bigint(); const r=await f(); return [Number(process.hrtime.bigint()-t)/1e6, r]; };

console.log('=== DESCOMPOSICION (media de 5 corridas) ===');
const acc = { dir:0, ev:0, idx:0, org:0, total:0 };
let nEv = 0, nUsers = 0;
for (let i=0;i<5;i++){
  const [tDir, dir] = ms(() => provider.loadDirectory());
  const [tEv, events] = await msA(() => provider.loadEvents(P30));
  const [tIdx, index] = ms(() => buildIndex({ users:dir.users, groups:dir.groups, schools:dir.schools, classifyGroup }));
  const [tOrg] = ms(() => computeOrganization({ organizationId:S[0].id, events, index, users:dir.users, period:P30, idleMs:900000 }));
  acc.dir+=tDir; acc.ev+=tEv; acc.idx+=tIdx; acc.org+=tOrg; acc.total+=tDir+tEv+tIdx+tOrg;
  nEv = events.length; nUsers = dir.users.length;
}
const r = (x)=> (x/5).toFixed(1);
console.log(`  eventos_cargados_30d=${nEv}  usuarios=${nUsers}`);
console.log(`  loadDirectory   = ${r(acc.dir)} ms`);
console.log(`  loadEvents(30d) = ${r(acc.ev)} ms`);
console.log(`  buildIndex      = ${r(acc.idx)} ms`);
console.log(`  computeOrg(1)   = ${r(acc.org)} ms`);
console.log(`  TOTAL           = ${r(acc.total)} ms`);

// period=all para ver el coste completo
const [tAll, evAll] = await msA(() => provider.loadEvents(null));
console.log(`  loadEvents(all) = ${tAll.toFixed(1)} ms  eventos=${evAll.length}`);

// coste del listado de organizaciones (N organizaciones)
const [tList] = await msA(() => computeCanonicalMetrics({ scopeKind:'organizations', period:P30, idleMs:900000, includeQuality:true, provider, clock:()=>now }));
console.log(`  computeCanonicalMetrics(organizations, ${S.length} orgs) = ${tList.toFixed(1)} ms`);
const [tOne] = await msA(() => computeCanonicalMetrics({ scopeKind:'organization', organizationId:S[0].id, period:P30, idleMs:900000, includeQuality:true, provider, clock:()=>now }));
console.log(`  computeCanonicalMetrics(organization)                   = ${tOne.toFixed(1)} ms`);
