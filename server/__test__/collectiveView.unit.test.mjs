/**
 * collectiveView.unit.test.mjs — CHP V9 F7-C2R-U3D.
 *
 * Reglas de `server/aulaViva/collectiveView.mjs` sobre entradas construidas a mano (sin servidor ni fechas reales):
 * trayectoria de una cohorte (media por corte, tendencia con el umbral del motor, cortes retenidos por el mínimo de
 * lectores), patrones observados (soporte, lectores distintos, confianza por tramos) y pertenencia a cohortes.
 * La delimitación institucional y la autorización se prueban en collectiveContextHttp.test.mjs.
 *
 *   node server/__test__/collectiveView.unit.test.mjs
 */
import './helpers/testMode.mjs';
import { cohortTrajectoryBody, contextualPatternsBody, cohortMembers, populationState, parseCohortId, cohortIdOf, contextualCohortDefinitions } from '../aulaViva/collectiveView.mjs';

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++) : (console.error('  ✗', l, String(h).slice(0, 400)), fail++);
const near = (a, b) => typeof a === 'number' && Math.abs(a - b) < 0.002;

const WEEK = 7 * 86_400_000, NOW = 3000 * WEEK + 12_345;            // el corte «ahora» no es múltiplo de la semana
const CUTS = [NOW - (NOW % WEEK) - 2 * WEEK, NOW - (NOW % WEEK) - WEEK, NOW - (NOW % WEEK), NOW];
const okResult = (id, ar, cont) => ({ user_id: id, data_state: 'ok', reason: null, profile_current: { abandono_risk: ar, engagement_score: 1 - ar, persistencia_score: 0.5, diversidad_score: 0.1 },
    signals_current: [{ signal_id: 'continuidad_semanal', metric_value: cont }] });
const none = (id) => ({ user_id: id, data_state: 'no_activity', reason: 'no_activity_in_context', profile_current: null, signals_current: [] });
// values[k] = [abandono_risk, continuidad] del lector en el corte k, o null si no tiene indicadores en ese corte.
const member = (id, values, risks = []) => ({ readerId: id, groupIds: ['g-1'], context: { readerId: id }, events: [],
    view: { result: values.at(-1) ? okResult(id, ...values.at(-1)) : none(id), risks, points: CUTS.map((ts, k) => ({ ts, date: ts, result: values[k] ? okResult(id, ...values[k]) : none(id) })) } });

console.log('\n[1] trayectoria de una cohorte');
{
    // Seis lectores. Corte 0: solo 4 con indicadores (retenido). Cortes 1–3: 5 o 6.
    const members = [
        member('a', [[0.2, 0.4], [0.2, 0.4], [0.2, 0.4], [0.2, 0.4]]),
        member('b', [[0.4, 0.4], [0.4, 0.4], [0.4, 0.4], [0.4, 0.4]]),
        member('c', [[0.6, 0.4], [0.6, 0.4], [0.6, 0.4], [0.9, 0.4]]),
        member('d', [[0.8, 0.4], [0.8, 0.4], [0.8, 0.4], [0.9, 0.4]]),
        member('e', [null, [0.5, 0.4], [0.5, 0.4], [0.9, 0.4]]),
        member('f', [null, null, [0.56, 0.4], [0.9, 0.4]]),
    ];
    const t = cohortTrajectoryBody({ cohort_id: 'coh_group:g-1_v1', members, min: 5 });
    const s = t.series;
    ok('tres cortes entregados, del más reciente al más antiguo; el de 4 lectores no se entrega y se cuenta', s.length === 3 && s[0].period_end === NOW && s[2].period_end === CUTS[1] && t.suppressed_points === 1 && t.min_cohort === 5);
    ok('cada corte promedia SOLO a los lectores con indicadores en ese corte', s[2].sample_size === 5 && near(s[2].metrics.abandono_risk, (0.2 + 0.4 + 0.6 + 0.8 + 0.5) / 5)
        && s[1].sample_size === 6 && near(s[1].metrics.abandono_risk, (0.2 + 0.4 + 0.6 + 0.8 + 0.5 + 0.56) / 6) && s[0].sample_size === 6 && near(s[0].metrics.abandono_risk, (0.2 + 0.4 + 0.9 * 4) / 6),
        JSON.stringify(s.map((p) => [p.sample_size, p.metrics.abandono_risk])));
    ok('tendencia con el umbral del motor: sin corte anterior → null; diferencia < 0,05 → «flat»; subida → «up»', s[2].trend.abandono_risk === null && s[1].trend.abandono_risk === 'flat' && s[0].trend.abandono_risk === 'up'
        && s[0].trend.engagement_score === 'down' && s[0].trend.continuidad_semanal === 'flat', JSON.stringify(s.map((p) => p.trend.abandono_risk)));
    ok('las señales se promedian igual que los puntajes', near(s[0].metrics.continuidad_semanal, 0.4) && near(s[0].metrics.engagement_score, 1 - s[0].metrics.abandono_risk));
    ok('confianza = lectores / 30 (sin inflar una muestra pequeña)', near(s[0].confidence, 6 / 30) && near(s[2].confidence, 5 / 30));
    ok('cada punto cubre su ventana de 28 días', s.every((p) => p.period_end - p.period_start === 28 * 86_400_000));
    const four = cohortTrajectoryBody({ cohort_id: 'x', members: members.slice(0, 4), min: 5 });
    ok('con cuatro lectores ningún corte se entrega: serie vacía y cortes retenidos contados, sin cifras', four.series.length === 0 && four.suppressed_points === 4 && !/abandono_risk/.test(JSON.stringify(four)));
    ok('sin miembros: serie vacía, nada retenido', cohortTrajectoryBody({ cohort_id: 'x', members: [], min: 5 }).series.length === 0);
}

console.log('\n[2] patrones observados');
{
    const ep = (type, resolved = null) => ({ risk_type: type, detected_at: 1, resolved_at: resolved });
    const entries = [
        member('a', [null, null, null, [0.9, 0.2]], [ep('abandono_alto')]),
        member('b', [null, null, null, [0.9, 0.2]], [ep('abandono_alto')]),
        member('c', [null, null, null, [0.9, 0.2]], [ep('abandono_alto'), ep('fatiga_lectora')]),
        member('d', [null, null, null, [0.9, 0.2]], [ep('abandono_alto', 5)]),
        member('e', [null, null, null, [0.9, 0.2]], [ep('abandono_alto'), ep('fatiga_lectora'), ep('fatiga_lectora', 3), ep('fatiga_lectora', 4), ep('fatiga_lectora', 5), ep('fatiga_lectora', 6)]),
    ];
    const p = contextualPatternsBody(entries, { min: 5, nowTs: NOW });
    ok('«abandono alto»: 5 episodios de 5 lectores → patrón con soporte 5 y confianza 0,5', p.patterns.length === 1 && p.patterns[0].pattern_key === 'risk:abandono_alto' && p.patterns[0].support_count === 5
        && p.patterns[0].readers === 5 && p.patterns[0].confidence === 0.5, JSON.stringify(p.patterns));
    ok('«fatiga lectora»: 6 episodios pero de solo 2 lectores → NO se entrega (describiría a personas concretas)', !p.patterns.some((x) => x.pattern_key === 'risk:fatiga_lectora') && p.withheld_below_support === 1);
    ok('el patrón no nombra lectores ni trae nada por lector', !/"a"|"b"|user_id|readerId/.test(JSON.stringify(p)));
    ok('con cuatro lectores el patrón no alcanza el mínimo', contextualPatternsBody(entries.slice(0, 4), { min: 5 }).patterns.length === 0);
    const many = Array.from({ length: 20 }, (_, i) => member(`r${i}`, [null, null, null, [0.9, 0.2]], [ep('abandono_alto')]));
    ok('la confianza sigue los tramos del motor (20 observaciones → 0,7)', contextualPatternsBody(many, { min: 5 }).patterns[0].confidence === 0.7);
    ok('sin episodios: lista vacía y nada retenido', contextualPatternsBody([member('z', [null, null, null, [0.1, 0.9]])], { min: 5 }).withheld_below_support === 0);
}

console.log('\n[3] cohortes');
{
    const hi = member('h', [null, null, null, [0.1, 0.9]]), lo = member('l', [null, null, null, [0.1, 0.5]]), edge = member('e', [null, null, null, [0.1, 0.7]]);
    const risky = member('r', [null, null, null, [0.9, 0.2]], [{ risk_type: 'abandono_alto', resolved_at: null }]);
    const healed = member('x', [null, null, null, [0.1, 0.9]], [{ risk_type: 'abandono_alto', resolved_at: 9 }]);
    const all = [hi, lo, edge, risky, healed];
    const of = (type, scope, opts) => cohortMembers({ cohort_type: type, scope_id: scope }, all, opts).map((m) => m.readerId).join();
    ok('hábito: continuidad ≥ 0,7 (el umbral del constructor), incluido el valor exacto', of('habit', 'high_continuity') === 'h,e,x');
    ok('riesgo: solo el episodio ACTIVO de ese tipo', of('risk', 'abandono_alto') === 'r' && of('risk', 'fatiga_lectora') === '');
    ok('trayectoria: quien tiene un episodio ya resuelto', of('trajectory', 'recovered_after_risk') === 'x');
    ok('estrategia: quien recibió esa intervención', of('intervention', 'lectura_guiada', { interventionsOf: (id) => (id === 'l' ? [{ intervention_type: 'lectura_guiada' }] : []) }) === 'l');
    ok('nómina: los lectores de ese curso; un curso ajeno, nadie', of('group', 'g-1') === 'h,l,e,r,x' && of('group', 'g-otro') === '');
    ok('un ámbito desconocido no devuelve a nadie', of('habit', 'otra_cosa') === '' && of('library', 'x') === '');
    ok('identificadores: ida y vuelta; un colegio o un id arbitrario no se resuelven', parseCohortId(cohortIdOf('risk', 'abandono_alto')).scope_id === 'abandono_alto' && parseCohortId('coh_school:org-a_v1') === null
        && parseCohortId('coh-risk') === null && parseCohortId(null) === null);
    const defs = contextualCohortDefinitions({ groups: [{ id: 'g-1', type: 'course' }, { id: 'c-1', type: 'club' }], interventionTypes: ['lectura_guiada', 'lectura_guiada'] });
    ok('definiciones: nóminas propias y cohortes tipadas, abstractas y sin duplicados', defs.some((d) => d.cohort_key === 'group:g-1') && defs.some((d) => d.cohort_key === 'club:c-1')
        && defs.filter((d) => d.cohort_type === 'intervention').length === 1 && new Set(defs.map((d) => d.cohort_id)).size === defs.length && defs.every((d) => !('members' in d)));
    ok('estado de la población: con indicadores, sin lectores, y registro apagado', populationState(all).data_state === 'ok' && populationState([]).data_state === 'no_eligible_readers'
        && populationState([{ view: { result: { data_state: 'insufficient', reason: 'provenance_not_recorded' } } }]).reason === 'provenance_not_recorded');
}

console.log(`\ncollectiveView.unit — ${pass} ✓, ${fail} ✗`);
process.exit(fail ? 1 : 0);
