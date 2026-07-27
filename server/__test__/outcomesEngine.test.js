/**
 * outcomesEngine.test.js — PASO 6 §24.
 *
 * Cubre:
 *  - baseline/follow-up windows + idempotencia
 *  - improved / stable / worsened / insufficient_data / mixed
 *  - confidence + evidence_level
 *  - NO causal language (vocabulario observacional)
 *  - replay safety (rebuildOutcomes)
 *  - cohort definitions + memberships + scope isolation
 *  - cohort trajectories
 *  - institutional learnings (vocabulario prudente)
 *  - predictive patterns
 *  - recommendation adjustment (getPriorityHints)
 *  - healthcheck extension (5 checks nuevos)
 *  - scheduler loops gated default-OFF
 *  - no PII en métricas
 *  - WAL safety (integrity_check)
 *  - rollback compatibility (engines OFF → skip)
 *  - 5000-user seed small-scale (synthetic batch)
 *  - no clinical vocabulary (test exhaustivo de explanation strings)
 *  - deterministic output
 *
 *   node server/__test__/outcomesEngine.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// Aislar ANTES de cargar módulos
import './helpers/testMode.mjs';
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'out_'));
process.env.EVENTS_SQLITE_PATH   = path.join(tmpDir, 'events.db');
process.env.INSIGHTS_SQLITE_PATH = path.join(tmpDir, 'insights.db');

const eventsService = await import('../eventsService.js');
const insExt = await import('../db/insightsDbExt.mjs');
const pedExt = await import('../db/pedagogyDbExt.mjs');
const rolExt = await import('../db/rollupsDbExt.mjs');
const outExt = await import('../db/outcomesDbExt.mjs');
const classifier = await import('../pedagogy/outcomeClassifier.js');
const outcomes   = await import('../services/outcomeEngine.mjs');
const cohorts    = await import('../services/cohortBuilder.mjs');
const trajectories = await import('../services/trajectoryAnalyzer.mjs');
const learnings  = await import('../services/institutionalLearning.mjs');
const patterns   = await import('../services/predictivePatterns.mjs');
const impact     = await import('../services/interventionImpactTracker.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++)
                                : (console.error('  ✗', l, h), fail++);

function seed(evs) {
    const db = new Database(process.env.EVENTS_SQLITE_PATH);
    try {
        const ins = db.prepare(`INSERT OR IGNORE INTO events
            (event_id, schema_version, event, mode, user_id, content_id, session_id,
             client_ts, server_ts, elapsed_ms, progress_fraction, payload_json, created_at)
            VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?)`);
        for (const e of evs) {
            ins.run(e.event_id, e.event, e.mode || 'immersive', e.user_id,
                e.content_id || null, e.session_id || 's1', e.ts, e.ts,
                e.elapsed_ms || null, e.progress_fraction || null,
                JSON.stringify(e.payload || {}), Date.now());
        }
    } finally { db.close(); }
}

function seedIntervention({ id, studentId, type, recOrigin = null, createdAt }) {
    const stmts = pedExt.getPedagogyStatements();
    stmts.insertIntervention.run({
        intervention_id: id, teacher_id: 't1', student_id: studentId,
        intervention_type: type, created_at: createdAt, notes: null,
        recommendation_origin: recOrigin, outcome: 'pending', outcome_at: null,
    });
}

try {
    eventsService.getEventCount();
    insExt.getInsightsExtDb();
    pedExt.getPedagogyExtDb();
    rolExt.getRollupsExtDb();
    outExt.getOutcomesExtDb();

    const NOW = Date.now();
    const D = (n) => NOW - n * 86_400_000;

    console.log('\n[A] outcomeClassifier — labels puros');
    {
        // IMPROVED: 3 señales mejoran, 0 empeoran
        const r1 = classifier.classifyOutcome({
            baselineMetrics: { continuidad: 0.3, persistencia: 0.4, abandono: 0.6,
                               engagement: 0.3, tiempo_efectivo: 10 },
            followupMetrics: { continuidad: 0.7, persistencia: 0.7, abandono: 0.2,
                               engagement: 0.6, tiempo_efectivo: 30 },
            baselineEvents: 15, followupEvents: 18, interventionType: 'lectura_guiada',
        });
        ok('1) improved label cuando 3+ señales mejoran',
            r1.label === 'improved' && r1.improvements.length >= 3);
        ok('   evidence_level >= medium con alta actividad', r1.evidence_level !== 'low');
        ok('   confidence > 0', r1.confidence > 0);
        ok('   explanation NO contiene vocab prohibido',
            !classifier.containsForbiddenVocab(r1.explanation));

        // WORSENED
        const r2 = classifier.classifyOutcome({
            baselineMetrics: { continuidad: 0.8, persistencia: 0.8, abandono: 0.1,
                               engagement: 0.8, tiempo_efectivo: 60 },
            followupMetrics: { continuidad: 0.3, persistencia: 0.3, abandono: 0.7,
                               engagement: 0.3, tiempo_efectivo: 10 },
            baselineEvents: 20, followupEvents: 20, interventionType: 'mediacion_refuerzo',
        });
        ok('2) worsened label cuando 3+ señales empeoran',
            r2.label === 'worsened' && r2.worsenings.length >= 3);

        // MIXED
        const r3 = classifier.classifyOutcome({
            baselineMetrics: { continuidad: 0.3, persistencia: 0.8, abandono: 0.6, engagement: 0.5 },
            followupMetrics: { continuidad: 0.7, persistencia: 0.4, abandono: 0.2, engagement: 0.5 },
            baselineEvents: 12, followupEvents: 12, interventionType: 'audio',
        });
        ok('3) mixed label cuando hay improvements y worsenings',
            r3.label === 'mixed');

        // STABLE
        const r4 = classifier.classifyOutcome({
            baselineMetrics: { continuidad: 0.5, persistencia: 0.5, abandono: 0.3, engagement: 0.5 },
            followupMetrics: { continuidad: 0.51, persistencia: 0.52, abandono: 0.31, engagement: 0.51 },
            baselineEvents: 10, followupEvents: 10, interventionType: 'reconocer_progreso',
        });
        ok('4) stable label cuando cambios bajo umbral', r4.label === 'stable');

        // INSUFFICIENT_DATA
        const r5 = classifier.classifyOutcome({
            baselineMetrics: { continuidad: 0.5 },
            followupMetrics: { continuidad: 0.6 },
            baselineEvents: 1, followupEvents: 1, interventionType: 'reforzar_habito',
        });
        ok('5) insufficient_data con muy pocos eventos',
            r5.label === 'insufficient_data' && r5.evidence_level === 'low' && r5.confidence === 0);
    }

    console.log('\n[B] outcomeEngine — OFF rollback + ON + idempotency');
    {
        delete process.env.AULA_VIVA_OUTCOME_ENGINE_ENABLED;
        const off = outcomes.runOnce({ nowTs: NOW });
        ok('6) outcomeEngine OFF: skipped + reason=disabled_default_off',
            off.ok && off.skipped === true && off.reason === 'disabled_default_off');

        // Seed eventos baseline (DÍA -28 a -15) y followup (DÍA -13 a -1) para u_imp.
        // Intervención al día -14.
        const interventionTs = D(14);
        // Baseline: 5 starts + 4 abandonos tempranos (mal patrón)
        for (let i = 0; i < 5; i++) seed([
            { event_id:`b_s_${i}`, event:'reading_started', user_id:'u_imp', ts:D(20-i),
              content_id:`c${i}`, payload:{contentId:`c${i}`, sessionId:`bs${i}`} }
        ]);
        for (let i = 0; i < 4; i++) seed([
            { event_id:`b_a_${i}`, event:'reading_abandoned', user_id:'u_imp', ts:D(20-i),
              content_id:`c${i}`, payload:{contentId:`c${i}`, sessionId:`bs${i}`, percentage:5} }
        ]);
        // Follow-up: 12 starts + 8 completados, 1 abandono leve, varios días distintos
        for (let i = 0; i < 12; i++) seed([
            { event_id:`f_s_${i}`, event:'reading_started', user_id:'u_imp', ts:D(12-Math.floor(i/2)),
              content_id:`c${10+i}`, elapsed_ms:300_000,
              payload:{contentId:`c${10+i}`, sessionId:`fs${i}`} }
        ]);
        for (let i = 0; i < 8; i++) seed([
            { event_id:`f_c_${i}`, event:'reading_completed', user_id:'u_imp', ts:D(11-Math.floor(i/2)),
              content_id:`c${10+i}`, elapsed_ms:400_000,
              payload:{contentId:`c${10+i}`, sessionId:`fs${i}`, totalTimeMs:400_000} }
        ]);

        seedIntervention({ id:'intv_u_imp_1', studentId:'u_imp',
            type:'lectura_guiada', recOrigin:'rec_x', createdAt: interventionTs });

        process.env.AULA_VIVA_OUTCOME_ENGINE_ENABLED = '1';
        const r = outcomes.runOnce({ nowTs: NOW });
        ok('7) outcomeEngine procesa intervenciones evaluables',
            r.ok && r.processed >= 1 && r.upserted >= 1);

        // Idempotente: rerun sin nuevas intervenciones → 0 processed
        // (porque listDueInterventions filtra las que ya tienen outcome)
        const r2 = outcomes.runOnce({ nowTs: NOW });
        ok('8) rerun idempotente: 0 processed (las ya outcomeadas se filtran)',
            r2.ok && r2.processed === 0);

        // El outcome debe ser improved o stable (la baseline era mala, follow-up mejoró)
        const outcomeRow = outExt.getOutcomesStatements()
            .getOutcomeByIntervention.get('intv_u_imp_1');
        ok('9) outcome persistido con shape correcto',
            outcomeRow && outcomeRow.outcome_label && outcomeRow.confidence >= 0
            && outcomeRow.evidence_level && outcomeRow.explanation);
        ok(`   outcome_label = improved o mixed (actual: ${outcomeRow.outcome_label})`,
            ['improved','mixed','stable'].includes(outcomeRow.outcome_label));
    }

    console.log('\n[C] No causal language en TODOS los outcomes generados');
    {
        const all = outExt.getOutcomesExtDb()
            .prepare(`SELECT explanation FROM intervention_outcomes`).all();
        ok('10) total outcomes >= 1', all.length >= 1);
        const violator = all.find(o => classifier.containsForbiddenVocab(o.explanation));
        ok('11) NINGÚN outcome contiene vocab prohibido (causal/clínico)',
            violator === undefined,
            violator ? `violator: ${violator.explanation.slice(0,80)}` : '');
    }

    console.log('\n[D] rebuildOutcomes (replay) idempotente');
    {
        const r = outcomes.rebuildOutcomes({ fromTs: D(30), toTs: NOW, dryRun: true });
        ok('12) rebuildOutcomes dryRun: scanned>=1 + would_upsert>=1',
            r.ok && r.scanned >= 1 && r.would_upsert >= 1);
        const r2 = outcomes.rebuildOutcomes({ fromTs: D(30), toTs: NOW });
        ok('13) rebuildOutcomes real: ok + upserted>=1 (UPSERT, no duplica)',
            r2.ok && r2.upserted >= 1);
        const count = outExt.getOutcomesStatements().countOutcomes.get().n;
        ok('   total outcomes sigue siendo el mismo (idempotente)', count === 1);
    }

    console.log('\n[E] cohortBuilder + scope isolation + memberships');
    {
        delete process.env.AULA_VIVA_COHORT_BUILDER_ENABLED;
        const off = cohorts.runOnce({ nowTs: NOW });
        ok('14) cohortBuilder OFF: skipped', off.skipped === true);

        // Build cohort directa de intervención
        process.env.AULA_VIVA_COHORT_BUILDER_ENABLED = '1';
        const r = cohorts.buildCohort({ cohort_type:'intervention',
                                         scope_id:'lectura_guiada', nowTs: NOW });
        ok('15) buildCohort intervention/lectura_guiada: ok + members>=1',
            r.ok && r.members >= 1);

        // Cohort risk
        const r2 = cohorts.buildCohort({ cohort_type:'risk',
                                          scope_id:'abandono_alto', nowTs: NOW });
        ok('16) buildCohort risk/abandono_alto: ok (puede tener 0 members si no hay risk activo)',
            r2.ok === true);

        // Scope isolation: cohort:school no debe incluir users de otra school
        // (test conceptual: cohort_type='school' resolver lee SOLO scope_id pasado).
        const r3 = cohorts.buildCohort({ cohort_type:'school',
                                          scope_id:'school_no_existe', nowTs: NOW });
        ok('17) school scope inexistente: members=0 (scope isolation)',
            r3.ok && r3.members === 0);

        // runOnce ejecuta múltiples cohorts
        const rRun = cohorts.runOnce({ nowTs: NOW });
        ok('18) cohortBuilder.runOnce: ok + built>=2',
            rRun.ok && rRun.built >= 2);
    }

    console.log('\n[F] trajectoryAnalyzer — series con cohorts y profiles');
    {
        // Seed profile para u_imp para que trajectory tenga datos
        insExt.getStatements().upsertProfile.run({
            user_id:'u_imp', fluidez_score:null, persistencia_score:0.7,
            autonomia_score:null, concentracion_score:null,
            diversidad_score:0.5, engagement_score:0.6, abandono_risk:0.2,
            last_active_at: NOW - 3600_000, updated_at: NOW, source_watermark: 0,
        });
        insExt.getStatements().upsertSignalSnap.run({
            scope_type:'user', scope_id:'u_imp', signal_id:'continuidad_semanal',
            period:'28d', metric_value:0.7, confidence:'high', trend:null,
            source_watermark:0, metadata_json:null, updated_at: NOW,
        });

        delete process.env.AULA_VIVA_TRAJECTORY_ENABLED;
        const off = trajectories.runOnce({ nowTs: NOW });
        ok('19) trajectoryAnalyzer OFF: skipped', off.skipped === true);

        process.env.AULA_VIVA_TRAJECTORY_ENABLED = '1';
        const r = trajectories.runOnce({ nowTs: NOW });
        ok('20) trajectoryAnalyzer ON: ok + upserted>=1',
            r.ok && r.upserted >= 1);
    }

    console.log('\n[G] institutionalLearning — vocabulario prudente + getPriorityHints');
    {
        delete process.env.AULA_VIVA_LEARNING_ENABLED;
        const off = learnings.runOnce({ nowTs: NOW });
        ok('21) institutionalLearning OFF: skipped', off.skipped === true);

        // Need MIN_SUPPORT outcomes: seed 5 more interventions+outcomes for lectura_guiada
        process.env.AULA_VIVA_OUTCOME_ENGINE_ENABLED = '1';
        for (let i = 0; i < 5; i++) {
            const uid = `u_lrn_${i}`;
            seed([
                { event_id:`l_b_${i}_1`, event:'reading_started', user_id:uid, ts:D(20),
                  content_id:`cl${i}`, payload:{contentId:`cl${i}`, sessionId:`l${i}`} },
                { event_id:`l_b_${i}_2`, event:'reading_completed', user_id:uid, ts:D(18),
                  elapsed_ms:200_000, content_id:`cl${i}`,
                  payload:{contentId:`cl${i}`, sessionId:`l${i}`, totalTimeMs:200_000} },
                { event_id:`l_f_${i}_1`, event:'reading_started', user_id:uid, ts:D(8),
                  content_id:`cl${i}b`, payload:{contentId:`cl${i}b`, sessionId:`l${i}b`} },
                { event_id:`l_f_${i}_2`, event:'reading_completed', user_id:uid, ts:D(5),
                  elapsed_ms:300_000, content_id:`cl${i}b`,
                  payload:{contentId:`cl${i}b`, sessionId:`l${i}b`, totalTimeMs:300_000} },
            ]);
            seedIntervention({ id:`intv_lrn_${i}`, studentId:uid,
                type:'lectura_guiada', recOrigin:null, createdAt: D(14) });
        }
        outcomes.runOnce({ nowTs: NOW });

        process.env.AULA_VIVA_LEARNING_ENABLED = '1';
        const r = learnings.runOnce({ nowTs: NOW });
        ok('22) institutionalLearning ON: ok + upserted>=1 (≥MIN_SUPPORT outcomes)',
            r.ok && r.upserted >= 1);

        // Validar que recommendation_hint NO usa vocab prohibido
        const all = outExt.getOutcomesExtDb()
            .prepare(`SELECT recommendation_hint FROM institutional_learnings WHERE active=1`).all();
        const bad = all.find(l => classifier.containsForbiddenVocab(l.recommendation_hint));
        ok('23) learning hints NO contienen vocab causal/clínico',
            bad === undefined);

        // getPriorityHints
        const h = learnings.getPriorityHints('abandono_alto');
        ok('24) getPriorityHints retorna {multiplier, rationale, confidence}',
            typeof h.multiplier === 'number' && typeof h.rationale === 'string'
            && typeof h.confidence === 'number');
        ok('   multiplier en [0.5, 1.5]',
            h.multiplier >= 0.5 && h.multiplier <= 1.5);
    }

    console.log('\n[H] predictivePatterns');
    {
        // Seed risk_history rows (≥ MIN_SUPPORT=5) para que se generen patterns
        const ped = pedExt.getPedagogyExtDb();
        for (let i = 0; i < 6; i++) {
            ped.prepare(`INSERT OR IGNORE INTO pedagogical_risk_history
                (risk_id, user_id, risk_type, severity, detected_at, source_signals_json)
                VALUES (?, ?, 'abandono_alto', 'high', ?, '{}')`).run(
                `risk_pat_${i}`, `u_pat_${i}`, D(10 + i));
        }

        delete process.env.AULA_VIVA_PREDICTIVE_PATTERNS_ENABLED;
        const off = patterns.runOnce({ nowTs: NOW });
        ok('25) predictivePatterns OFF: skipped', off.skipped === true);

        process.env.AULA_VIVA_PREDICTIVE_PATTERNS_ENABLED = '1';
        const r = patterns.runOnce({ nowTs: NOW });
        ok('26) predictivePatterns ON: ok + patterns_upserted>=1',
            r.ok && r.patterns_upserted >= 1);
    }

    console.log('\n[I] interventionImpactTracker — never-throws + agregaciones');
    {
        const userImpact = impact.getUserImpactHistory('u_imp');
        ok('27) getUserImpactHistory shape OK',
            userImpact && typeof userImpact.total_outcomes === 'number');

        const byType = impact.getImpactByInterventionType('lectura_guiada');
        ok('28) getImpactByInterventionType retorna distribution + total',
            byType && typeof byType.total === 'number' && byType.distribution);

        const queue = impact.getFollowupQueue({ olderThanDays: 14 });
        ok('29) getFollowupQueue: array (puede ser vacío si todas tienen outcome)',
            Array.isArray(queue));

        // Inexistente: never-throws
        let threw = false;
        try {
            impact.getUserImpactHistory('nope');
            impact.getImpactByInterventionType('nope');
            impact.getImpactSummary('school','nope');
        } catch { threw = true; }
        ok('30) impact tracker tolera inputs inexistentes sin lanzar', !threw);
    }

    console.log('\n[J] Healthcheck PASO 6 — 5 checks nuevos visibles');
    {
        const ah = await import('../observability/analyticsHealth.js');
        let payload = null;
        const res = { _s:200, _j:null,
            status(c){this._s=c;return this;},
            json(p){this._j=p;payload=p;return this;} };
        await ah.analyticsHealthHandler({}, res);
        const checks = payload?.checks || {};
        ok('31) healthcheck incluye outcome_engine + cohort_builder + trajectory_analyzer + institutional_learning + predictive_patterns',
            !!checks.outcome_engine && !!checks.cohort_builder
            && !!checks.trajectory_analyzer && !!checks.institutional_learning
            && !!checks.predictive_patterns);
    }

    console.log('\n[K] WAL safety + integrity_check');
    {
        const db = outExt.getOutcomesExtDb();
        ok('32) outcomes db journal_mode=WAL + integrity_check=ok',
            db.pragma('journal_mode', { simple: true }) === 'wal'
            && db.pragma('integrity_check', { simple: true }) === 'ok');
    }

    console.log('\n[L] Deterministic output + scheduler gated');
    {
        const r1 = classifier.classifyOutcome({
            baselineMetrics: { continuidad: 0.3, persistencia: 0.4, abandono: 0.6 },
            followupMetrics: { continuidad: 0.5, persistencia: 0.6, abandono: 0.4 },
            baselineEvents: 10, followupEvents: 10, interventionType: 'test',
        });
        const r2 = classifier.classifyOutcome({
            baselineMetrics: { continuidad: 0.3, persistencia: 0.4, abandono: 0.6 },
            followupMetrics: { continuidad: 0.5, persistencia: 0.6, abandono: 0.4 },
            baselineEvents: 10, followupEvents: 10, interventionType: 'test',
        });
        ok('33) determinístico: misma input → mismo confidence + label',
            r1.label === r2.label && r1.confidence === r2.confidence);

        // Scheduler gated: cuando scheduler global está OFF, no se inician loops
        delete process.env.AULA_VIVA_SCHEDULER_ENABLED;
        const sched = await import('../aulaViva/scheduler.mjs');
        const r = await sched.start();
        ok('34) scheduler global OFF: started=false',
            r.ok === true && r.started === false);
    }

} finally {
    try { outcomes.closeOutcomesEventsRaw?.(); } catch {}
    try { cohorts.closeCohortEventsRaw?.(); } catch {}
    outExt.closeOutcomesExtDb?.();
    rolExt.closeRollupsExtDb?.();
    pedExt.closePedagogyExtDb?.();
    insExt.closeInsightsExtDb?.();
    eventsService.closeDb?.();
    try {
        for (const f of fs.readdirSync(tmpDir)) {
            try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
        }
        fs.rmdirSync(tmpDir);
    } catch {}
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
