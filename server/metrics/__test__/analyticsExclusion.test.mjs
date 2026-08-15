/**
 * analyticsExclusion.test.mjs — CHP-STATS-SYNTHETIC-COHORT-EXCLUSION-01.
 * Unit puro del clasificador central. Cross-platform, sin I/O, sin server.
 */
import {
  EXCLUSION_MODE, ATTESTATION, GROUP_CLASS, DIFF_CLASS,
  resolveExclusionMode, isAnalyticsExcludedUser, getAnalyticsExcludedUserIds,
  getAnalyticsAttestationState, isMarkerAuthorityProven, isAnalyticsExcludedGroup,
  classifyAnalyticsGroup, filterCanonicalMemberIds, classifyDifferential, h16,
  AnalyticsExclusionConfigError,
} from '../analyticsExclusion.mjs';

let pass = 0, fail = 0;
const ok = (l, c) => c ? (pass++, console.log('  ✓', l)) : (fail++, console.error('  ✗', l));
const throws = (l, fn, code) => { try { fn(); ok(l + ' (no lanzó)', false); } catch (e) { ok(l, !code || e.code === code || e.message.includes(code)); } };

// ── Modo del flag ───────────────────────────────────────────────────────────
console.log('\n[modo]');
ok('default off', resolveExclusionMode({}) === EXCLUSION_MODE.OFF);
ok('vacío off', resolveExclusionMode({ LEGACY_ANALYTICS_COHORT_EXCLUSION: '' }) === EXCLUSION_MODE.OFF);
ok('shadow', resolveExclusionMode({ LEGACY_ANALYTICS_COHORT_EXCLUSION: 'shadow' }) === EXCLUSION_MODE.SHADOW);
ok('on', resolveExclusionMode({ LEGACY_ANALYTICS_COHORT_EXCLUSION: 'ON' }) === EXCLUSION_MODE.ON);
throws('valor inválido lanza', () => resolveExclusionMode({ LEGACY_ANALYTICS_COHORT_EXCLUSION: 'sí' }), 'ANALYTICS_EXCLUSION_CONFIG_ERROR');

// ── Clasificador de usuario ─────────────────────────────────────────────────
console.log('\n[usuario]');
const A = { id: 'A', roles: ['lector'] };
const C = { id: 'C', accountStatus: 'disabled' };                 // real disabled
const S1 = { id: 'S1', _loadtest_marker: '__loadtest__' };
const S2 = { id: 'S2', _loadtest_marker: '__loadtest__', accountStatus: 'active' };
ok('real no excluido', !isAnalyticsExcludedUser(A));
ok('DISABLED real NO excluido (no es clasificador)', !isAnalyticsExcludedUser(C));
ok('sintético excluido', isAnalyticsExcludedUser(S1));
ok('sintético ACTIVE igual excluido (marcador manda)', isAnalyticsExcludedUser(S2));
const users = [A, C, S1, S2];
const excl = getAnalyticsExcludedUserIds(users);
ok('set = {S1,S2}', excl.size === 2 && excl.has('S1') && excl.has('S2'));
ok('A,C fuera del set', !excl.has('A') && !excl.has('C'));

// ── Atestación ──────────────────────────────────────────────────────────────
console.log('\n[atestación]');
const attestedOK = new Set([h16('S1'), h16('S2')]);
ok('OK cuando marker==attested', getAnalyticsAttestationState({ users, excludedUserIds: excl, attestedHashes: attestedOK }) === ATTESTATION.OK);
ok('DEGRADED cuando atestación null', getAnalyticsAttestationState({ users, excludedUserIds: excl, attestedHashes: null }) === ATTESTATION.DEGRADED);
ok('DRIFT cuando falta un hash', getAnalyticsAttestationState({ users, excludedUserIds: excl, attestedHashes: new Set([h16('S1')]) }) === ATTESTATION.DRIFT);
ok('DRIFT cuando sobra un hash', getAnalyticsAttestationState({ users, excludedUserIds: excl, attestedHashes: new Set([h16('S1'), h16('S2'), h16('X')]) }) === ATTESTATION.DRIFT);
ok('INVALID cuando users no es array', getAnalyticsAttestationState({ users: null, excludedUserIds: excl, attestedHashes: attestedOK }) === ATTESTATION.AUTHORITY_INVALID);
ok('marker authority probada', isMarkerAuthorityProven({ users, excludedUserIds: excl }));
ok('marker authority NO probada (users malformado)', !isMarkerAuthorityProven({ users: 'x', excludedUserIds: excl }));

// ── Clasificador de grupo ───────────────────────────────────────────────────
console.log('\n[grupo]');
const gCanon  = { id: 'g-canon', memberIds: ['A', 'B'] };
const gLegacy = { id: 'g-legacy', memberIds: ['D'] };            // real solo-legacy
const gSynth  = { id: 'g-synth', memberIds: ['S1', 'S2'] };
const members = (g) => g.memberIds;
ok('grupo sintético (todos excluidos)', isAnalyticsExcludedGroup(gSynth, excl, members));
ok('grupo canónico NO sintético', !isAnalyticsExcludedGroup(gCanon, excl, members));
ok('grupo legacy con real NO sintético', !isAnalyticsExcludedGroup(gLegacy, excl, members));
ok('grupo vacío NO sintético', !isAnalyticsExcludedGroup({ id: 'x', memberIds: [] }, excl, members));
ok('classify: sintético', classifyAnalyticsGroup(gSynth, { excludedUserIds: excl, resolveMembers: members }) === GROUP_CLASS.SYNTHETIC_COMPAT);
ok('classify: canónico por marcador', classifyAnalyticsGroup(gCanon, { excludedUserIds: excl, resolveMembers: members }) === GROUP_CLASS.CANONICAL);
ok('classify: legacy≠sintético (marker) → no sintético', classifyAnalyticsGroup(gLegacy, { excludedUserIds: excl, resolveMembers: members }) !== GROUP_CLASS.SYNTHETIC_COMPAT);
// atestado manda
ok('classify: atestado sintético', classifyAnalyticsGroup(gSynth, { attestedSyntheticHashes: new Set([h16('g-synth')]) }) === GROUP_CLASS.SYNTHETIC_COMPAT);
ok('classify: atestado legacy ≠ sintético', classifyAnalyticsGroup(gLegacy, { attestedLegacyHashes: new Set([h16('g-legacy')]) }) === GROUP_CLASS.LEGACY_COMPAT);

// ── Filtro de cohorte ───────────────────────────────────────────────────────
console.log('\n[filtro]');
ok('filtra excluidos preservando orden', JSON.stringify(filterCanonicalMemberIds(['A', 'S1', 'B', 'S2', 'C'], excl)) === JSON.stringify(['A', 'B', 'C']));
ok('set vacío no filtra', filterCanonicalMemberIds(['A', 'S1'], new Set()).length === 2);

// ── Clasificación diferencial ───────────────────────────────────────────────
console.log('\n[diff]');
ok('iguales → MATCH', classifyDifferential(3, 3) === DIFF_CLASS.MATCH);
ok('baja con removal → EXPECTED_SYNTHETIC_REMOVAL', classifyDifferential(5, 3, { removedSynthetic: true }) === DIFF_CLASS.EXPECTED_SYNTHETIC_REMOVAL);
ok('sube sin motivo → UNEXPECTED_REGRESSION', classifyDifferential(3, 5, { removedSynthetic: true }) === DIFF_CLASS.UNEXPECTED_REGRESSION);
ok('baja sin removal → UNEXPECTED_REGRESSION', classifyDifferential(5, 3, { removedSynthetic: false }) === DIFF_CLASS.UNEXPECTED_REGRESSION);
ok('normalización legacy declarada', classifyDifferential(5, 4, { legacyNormalized: true }) === DIFF_CLASS.EXPECTED_LEGACY_GROUP_NORMALIZATION);

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
