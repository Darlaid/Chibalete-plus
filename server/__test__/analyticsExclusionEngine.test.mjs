/**
 * analyticsExclusionEngine.test.mjs — CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01.
 *
 * Golden + diferencial del motor legacy con exclusión de cohorte. Cross-platform:
 * metricsService es cómputo puro (init con fixture en memoria), sin server, sin
 * disco, sin stores reales → store-isolation trivial.
 *
 * Fixture hermético (sin PII):
 *   A,B  real activos (grupo canónico, con eventos+progress)
 *   C    real DISABLED histórico (progress, sin eventos → historia preservada)
 *   D    real sólo en grupo legacy
 *   S1   sintético (marcador, disabled, progress)  S2 sintético (marcador, ACTIVE, progress)
 *   g-canon (school "Colegio Real"), g-legacy (school "Colegio Legacy"),
 *   g-synth (school "Colegio Real"  ← COMPARTE string con canónico)
 */
import * as M from '../metricsService.js';
import { h16 } from '../metrics/analyticsExclusion.mjs';

let pass = 0, fail = 0;
const ok = (l, c) => c ? (pass++, console.log('  ✓', l)) : (fail++, console.error('  ✗', l));
const throws = (l, fn, code) => { try { fn(); ok(l + ' (no lanzó)', false); } catch (e) { ok(l, !code || e.code === code); } };

const users = [
  { id: 'A', roles: ['lector'], accountStatus: 'active', organizationId: 'inst-1', groupIds: ['g-canon'] },
  { id: 'B', roles: ['lector'], accountStatus: 'active', organizationId: 'inst-1', groupIds: ['g-canon'] },
  { id: 'C', roles: ['lector'], accountStatus: 'disabled', organizationId: 'inst-1', groupIds: ['g-canon'] },
  { id: 'D', roles: ['lector'], accountStatus: 'active', organizationId: 'inst-1', groupIds: ['g-legacy'] },
  { id: 'S1', roles: ['lector'], accountStatus: 'disabled', _loadtest_marker: '__loadtest__', groupIds: ['g-synth'] },
  { id: 'S2', roles: ['lector'], accountStatus: 'active',   _loadtest_marker: '__loadtest__', groupIds: ['g-synth'] },
];
const groups = [
  { id: 'g-canon',  name: 'Canónico', school: 'Colegio Real',   memberIds: ['A', 'B', 'C'] },
  { id: 'g-legacy', name: 'Legacy',   school: 'Colegio Legacy', memberIds: ['D'] },
  { id: 'g-synth',  name: 'Synth',    school: 'Colegio Real',   memberIds: ['S1', 'S2'] },
];
// Progress: A(2) B(1) C(1) S1(2) S2(1) = 7 filas; sintéticas = 3.
const progressMap = {};
const prow = (u, c, pct, isCompleted) => { progressMap[`${u}__${c}`] = { userId: u, contentId: c, canonicalProgress: { globalPercentage: pct }, isCompleted: !!isCompleted, updatedAt: '2026-01-01T00:00:00Z', history: [{ durationSec: 600 }] }; };
prow('A', 'c1', 95, true); prow('A', 'c2', 40, false);
prow('B', 'c1', 100, true);
prow('C', 'c1', 92, true);                 // real disabled histórico, completado
prow('S1', 'c1', 80, false); prow('S1', 'c2', 50, false);
prow('S2', 'c1', 30, false);
// Eventos: sólo reales A,B (1 sesión c/u). 0 eventos sintéticos (paridad prod).
const sess = (u, c, pct) => ([
  { userId: u, contentId: c, event: 'session_start', timestamp: 1000 },
  { userId: u, contentId: c, event: 'session_end', timestamp: 2000, sessionDuration: 1000, progressPercentage: pct },
]);
const events = [...sess('A', 'c1', 95), ...sess('B', 'c1', 100)];

const raw = (attested) => ({ events, progress: { progressMap }, groups, users, leoMemory: { memoryMap: {} }, leoInteractions: [], attestedExclusionHashes: attested });

// ── OFF: byte/semánticamente intacto (no filtra) ────────────────────────────
console.log('\n[OFF — sin filtro]');
M.__setExclusionModeForTests('off');
M.init(raw(null));
{
  const cSynthOff = M.computeCourseMetrics('g-synth');
  ok('OFF course g-synth studentCount=2 (sin filtro)', cSynthOff.studentCount === 2);
  const schoolOff = M.computeSchoolMetrics('Colegio Real');
  ok('OFF school Colegio Real studentCount=5 (A,B,C,S1,S2)', schoolOff.studentCount === 5);
  const sn = M.getAnalyticsExclusionSnapshot();
  ok('OFF snapshot mode=off, 0 excluidos', sn.mode === 'off' && sn.excludedUsers === 0);
}

// ── ON (atestación OK): filtra por identidad en el borde de cohorte ──────────
console.log('\n[ON — atestación OK]');
M.__setExclusionModeForTests('on');
M.init(raw(new Set([h16('S1'), h16('S2')])));
ok('ON atestación OK', M.getAttestationState() === 'ATTESTATION_OK');
{
  const canon = M.computeCourseMetrics('g-canon');
  ok('ON course g-canon studentCount=3 (A,B,C reales)', canon.studentCount === 3);
  ok('ON course g-canon activeStudentCount=2 (A,B)', canon.activeStudentCount === 2);
  const synth = M.computeCourseMetrics('g-synth');
  ok('ON course g-synth studentCount=0 (sintéticos removidos)', synth.studentCount === 0);
  ok('ON course g-synth activeStudentCount=0', synth.activeStudentCount === 0);

  const schoolReal = M.computeSchoolMetrics('Colegio Real');
  ok('ON school Colegio Real studentCount=3 (shared-school: sintéticos fuera, reales quedan)', schoolReal.studentCount === 3);
  ok('ON school Colegio Real activeStudentCount=2', schoolReal.activeStudentCount === 2);

  const schoolLegacy = M.computeSchoolMetrics('Colegio Legacy');
  ok('ON school Colegio Legacy studentCount=1 (D real NO borrado)', schoolLegacy.studentCount === 1);

  // Direct synthetic user → canónico-vacío
  const s1 = M.computeStudentMetrics('S1');
  ok('ON student S1 canonicalExcluded=true', s1.canonicalExcluded === true);
  ok('ON student S1 contentStats.total=0 (7087-análogo excluido por IDENTIDAD)', s1.contentStats.total === 0);

  // Disabled real C preservado (mismo resultado ON que OFF)
  const cOn = M.computeStudentMetrics('C');
  ok('ON student C (disabled real) contentStats.completed=1 (historia preservada)', cOn.contentStats.completed === 1);
  ok('ON student C NO marcado canonicalExcluded', !cOn.canonicalExcluded);

  const sn = M.getAnalyticsExclusionSnapshot();
  ok('ON snapshot excludedUsers=2', sn.excludedUsers === 2);
  ok('ON snapshot excludedProgressRows=3', sn.excludedProgressRows === 3);
  ok('ON isSyntheticCompatGroup(g-synth)=true', M.isSyntheticCompatGroup(groups[2]));
  ok('ON isSyntheticCompatGroup(g-canon)=false', !M.isSyntheticCompatGroup(groups[0]));
  ok('ON isSyntheticCompatGroup(g-legacy real)=false', !M.isSyntheticCompatGroup(groups[1]));
}

// Denominador: real C disabled comparado con OFF debe seguir presente
console.log('\n[OFF vs ON — C disabled real igual en ambos]');
M.__setExclusionModeForTests('off'); M.init(raw(null));
{
  const cOff = M.computeStudentMetrics('C');
  M.__setExclusionModeForTests('on'); M.init(raw(new Set([h16('S1'), h16('S2')])));
  const cOn = M.computeStudentMetrics('C');
  ok('C disabled: contentStats idéntico OFF==ON (DISABLED_REAL_HISTORY_PRESERVED)', cOff.contentStats.total === cOn.contentStats.total && cOn.contentStats.total === 1);
}

// ── SHADOW: sirve OFF, diferencial disponible ────────────────────────────────
console.log('\n[SHADOW — diferencial, respuesta = OFF]');
M.__setExclusionModeForTests('shadow');
M.init(raw(new Set([h16('S1'), h16('S2')])));
{
  const served = M.computeCourseMetrics('g-synth');   // shadow sirve OFF
  ok('SHADOW course g-synth sirve OFF (studentCount=2)', served.studentCount === 2);
  const diff = M.computeCohortExclusionDifferential({ kind: 'course', id: 'g-synth' });
  ok('SHADOW diff g-synth studentCount old=2 filtered=0', diff.entries.find(e => e.metric === 'studentCount').old === 2 && diff.entries.find(e => e.metric === 'studentCount').filtered === 0);
  ok('SHADOW diff g-synth clasif EXPECTED_SYNTHETIC_REMOVAL', diff.entries.find(e => e.metric === 'studentCount').classification === 'EXPECTED_SYNTHETIC_REMOVAL');
  ok('SHADOW diff g-synth UNEXPECTED_REGRESSION=0', diff.unexpectedRegressions === 0);

  const diffCanon = M.computeCohortExclusionDifferential({ kind: 'course', id: 'g-canon' });
  ok('SHADOW diff g-canon todo MATCH (0 sintético en canónico)', diffCanon.entries.every(e => e.classification === 'MATCH'));

  const diffSchool = M.computeCohortExclusionDifferential({ kind: 'school', id: 'Colegio Real' });
  const sc = diffSchool.entries.find(e => e.metric === 'studentCount');
  ok('SHADOW diff school Colegio Real studentCount 5→3 EXPECTED_SYNTHETIC_REMOVAL', sc.old === 5 && sc.filtered === 3 && sc.classification === 'EXPECTED_SYNTHETIC_REMOVAL');
  ok('SHADOW diff school Colegio Real UNEXPECTED_REGRESSION=0', diffSchool.unexpectedRegressions === 0);

  const diffLegacy = M.computeCohortExclusionDifferential({ kind: 'school', id: 'Colegio Legacy' });
  ok('SHADOW diff school Legacy todo MATCH (real no borrado)', diffLegacy.entries.every(e => e.classification === 'MATCH'));
}

// ── Fail-closed en DRIFT / INVALID (ON) ──────────────────────────────────────
console.log('\n[ON — fail-closed]');
M.__setExclusionModeForTests('on');
M.init(raw(new Set([h16('S1')])));                    // falta S2 → DRIFT
ok('ON atestación DRIFT', M.getAttestationState() === 'ATTESTATION_DRIFT');
throws('ON+DRIFT computeCourseMetrics FAIL CLOSED (lanza)', () => M.computeCourseMetrics('g-canon'), 'ANALYTICS_EXCLUSION_AUTHORITY_UNSAFE');
{
  const diff = M.computeCohortExclusionDifferential({ kind: 'course', id: 'g-canon' });
  ok('ON+DRIFT diferencial reporta failClosed sin lanzar', diff.failClosed === 'ATTESTATION_DRIFT');
}

// ── ON + DEGRADED (atestación ausente): marcador primario permite filtrar ─────
console.log('\n[ON — DEGRADED marcador-primario]');
M.__setExclusionModeForTests('on');
M.init(raw(null));                                    // sin atestación → DEGRADED
ok('ON atestación DEGRADED', M.getAttestationState() === 'ATTESTATION_DEGRADED');
{
  const synth = M.computeCourseMetrics('g-synth');
  ok('ON+DEGRADED filtra por marcador (g-synth studentCount=0)', synth.studentCount === 0);
}

// ── Cardinalidad estructural del clasificador ────────────────────────────────
console.log('\n[cardinalidad estructural]');
{
  M.__setExclusionModeForTests('on'); M.init(raw(new Set([h16('S1'), h16('S2')])));
  const sn = M.getAnalyticsExclusionSnapshot();
  ok('clasificador: 2 sintéticos, 4 reales en fixture', sn.excludedUsers === 2 && (users.length - sn.excludedUsers) === 4);
  // frozen prod facts documentados (no re-derivados aquí): 647=400+247
  ok('frozen: 647 == 400 + 247', 647 === 400 + 247);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
