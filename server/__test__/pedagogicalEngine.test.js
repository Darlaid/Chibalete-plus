/**
 * pedagogicalEngine.test.js — PASO 3.
 *
 * Cubre §21 (15+ checks):
 *  - reglas válidas / inválidas
 *  - explicabilidad / confidence shape
 *  - longitudinal persistence
 *  - no duplicate recommendations
 *  - cohort risk detection
 *  - recommendation history
 *  - intervention persistence
 *  - profile evolution (timeline)
 *  - no overinference (confidence < MIN_CONFIDENCE descartado)
 *  - deterministic output (mismo input → mismo output)
 *  - WAL compatibility (integrity_check ok)
 *  - replay compatibility (rerun no duplica activas)
 *  - rollback (ENGINE_DISABLED → skip)
 *  - reader API never-throws
 *  - severity prioritization
 *
 * ISOLATION: env tmp dbs (mismo patrón que insightMaterializer.test.js) —
 * NUNCA toca prod ni data-critical/.
 *
 *   node server/__test__/pedagogicalEngine.test.js
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

// Aislar ANTES de cargar módulos.
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ped_'));
process.env.EVENTS_SQLITE_PATH   = path.join(tmpDir, 'events.db');
process.env.INSIGHTS_SQLITE_PATH = path.join(tmpDir, 'insights.db');
// Forzar engine ON sólo para tests donde lo necesitamos. Empezamos OFF para
// validar el path rollback (§21 rollback compatibility).

const rules        = await import('../pedagogy/pedagogicalRules.js');
const ext          = await import('../db/insightsDbExt.mjs');
const pedExt       = await import('../db/pedagogyDbExt.mjs');
const reader       = await import('../services/insightReader.mjs');
const engine       = await import('../services/interventionEngine.mjs');

let pass = 0, fail = 0;
const ok = (l, c, h = '') => c ? (console.log('  ✓', l), pass++)
                                : (console.error('  ✗', l, h), fail++);

// helpers: insertar perfiles + snapshots crudos (bypass materializer)
function seedProfile({ user_id, abandono_risk, engagement_score = null,
                       diversidad_score = null, persistencia_score = null,
                       continuidad_score = null,
                       last_active_at, updated_at }) {
    ext.getInsightsExtDb();
    ext.getStatements().upsertProfile.run({
        user_id, fluidez_score: null, persistencia_score, autonomia_score: null,
        concentracion_score: null, diversidad_score, engagement_score, abandono_risk,
        last_active_at, updated_at, source_watermark: 0,
    });
}
function seedSignal({ user_id, signal_id, value, confidence = 'medium',
                      updated_at = Date.now() }) {
    ext.getInsightsExtDb();
    ext.getStatements().upsertSignalSnap.run({
        scope_type: 'user', scope_id: user_id, signal_id, period: '28d',
        metric_value: value, confidence, trend: null,
        source_watermark: 0, metadata_json: null, updated_at,
    });
}

try {
    const NOW = Date.now();
    const D = (n) => NOW - n * 86_400_000;

    // Forzar creación de tablas insights antes de cualquier seed.
    ext.getInsightsExtDb();
    pedExt.getPedagogyExtDb();

    console.log('\n[A] §21.1-2 — reglas válidas vs inválidas + explicabilidad shape');
    {
        // u1 — abandono_alto trigger
        const ctxBad = {
            profile: { user_id: 'u1', last_active_at: D(2) },
            snapshots: [
                { signal_id: 'abandono_temprano',   metric_value: 0.8, confidence: 'medium' },
                { signal_id: 'continuidad_semanal', metric_value: 0.2, confidence: 'high'   },
            ],
            nowTs: NOW,
        };
        const r1 = rules.rule_abandono_alto(ctxBad);
        ok('1) rule_abandono_alto dispara con abandono>=0.6 + continuidad<=0.3',
            r1 && r1.rule_id === 'abandono_alto' && r1.severity === 'high');
        ok('   confidence en (0,1] y bien-formada',
            r1.confidence > 0 && r1.confidence <= 1
            && Array.isArray(r1.signals_used) && r1.signals_used.length === 2
            && r1.vocabulary_class === 'observational');

        // u2 — NO debe disparar (continuidad alta)
        const ctxGood = {
            profile: { user_id: 'u2', last_active_at: D(1) },
            snapshots: [
                { signal_id: 'abandono_temprano',   metric_value: 0.8, confidence: 'medium' },
                { signal_id: 'continuidad_semanal', metric_value: 0.9, confidence: 'high'   },
            ],
            nowTs: NOW,
        };
        ok('2) rule_abandono_alto NO dispara con continuidad>0.3',
            rules.rule_abandono_alto(ctxGood) === null);

        // shape estructural
        ok('3) isValidRuleResult acepta resultado bien formado', rules.isValidRuleResult(r1));
        ok('   isValidRuleResult rechaza objeto vacío', rules.isValidRuleResult({}) === false);
    }

    console.log('\n[B] §21.3 — confidence + overinference (MIN_CONFIDENCE)');
    {
        // diversidad_baja: confidence fija 0.6, sobrepasa MIN_CONFIDENCE.
        const r = rules.rule_diversidad_baja({
            snapshots: [
                { signal_id: 'diversidad_lectora', metric_value: 1, confidence: 'low' },
                { signal_id: 'tiempo_efectivo_lectura', metric_value: 60, confidence: 'high' },
            ],
        });
        ok('4) regla con confidence >= MIN_CONFIDENCE se emite', r !== null && r.confidence >= 0.3);

        // Simular underconfidence: rule_mejora_destacada con delta=0.01 → conf=0.01 < 0.3 → null
        const rOver = rules.rule_mejora_destacada({
            profile: { engagement_score: 0.51 },
            previousProfile: { engagement_score: 0.50 },
        });
        // delta=0.01 → ni siquiera pasa el primer guard (delta<0.25), pero la
        // implementación devuelve null antes. Lo que probamos formalmente:
        // delta=0.27 → conf=0.27 → bajo MIN_CONFIDENCE → null.
        const rUnder = rules.rule_mejora_destacada({
            profile: { engagement_score: 0.50 },
            previousProfile: { engagement_score: 0.23 },
        });
        ok('5) overinference: confidence<MIN_CONFIDENCE descartado',
            rUnder === null && rOver === null);
    }

    console.log('\n[C] §21.4 — evaluateAllRules + severity prioritization');
    {
        // Mismo lector con dos reglas posibles (abandono_alto HIGH + diversidad_baja MODERATE)
        const ctx = {
            profile: { user_id: 'u3', last_active_at: D(2), engagement_score: 0.5 },
            snapshots: [
                { signal_id: 'abandono_temprano',   metric_value: 0.85, confidence: 'medium' },
                { signal_id: 'continuidad_semanal', metric_value: 0.2,  confidence: 'high'   },
                { signal_id: 'diversidad_lectora',  metric_value: 1,    confidence: 'low'    },
                { signal_id: 'tiempo_efectivo_lectura', metric_value: 60, confidence: 'high' },
            ],
            nowTs: NOW,
        };
        const triggered = rules.evaluateAllRules(ctx);
        ok('6) evaluateAllRules retorna múltiples reglas', triggered.length >= 2);
        ok('   critical/high preceden moderate/info en orden',
            triggered[0].severity === 'high' || triggered[0].severity === 'critical');
    }

    console.log('\n[D] §21.13 — rollback compat: engine deshabilitado NO escribe');
    {
        delete process.env.INTERVENTION_ENGINE_ENABLED;
        seedProfile({ user_id: 'u_off', abandono_risk: 0.9,
                      last_active_at: D(1), updated_at: NOW });
        const before = pedExt.getPedagogyStatements().countAll.get().n;
        const r = engine.runOnce({ nowTs: NOW });
        const after = pedExt.getPedagogyStatements().countAll.get().n;
        ok('7) engine OFF retorna skipped y NO inserta',
            r.skipped === true && r.reason === 'disabled_default_off' && after === before);
    }

    console.log('\n[E] §21.5-6 — longitudinal persistence + no-duplicate');
    {
        process.env.INTERVENTION_ENGINE_ENABLED = '1';
        // Seed: u4 con perfil + signals que disparan abandono_alto + invisibilidad_prolongada
        seedProfile({ user_id: 'u4', abandono_risk: 0.85, engagement_score: 0.2,
                      continuidad_score: 0.2, persistencia_score: 0.3,
                      diversidad_score: 0.1,
                      last_active_at: D(20),  // → invisibilidad_prolongada
                      updated_at: NOW });
        seedSignal({ user_id: 'u4', signal_id: 'abandono_temprano',   value: 0.8, confidence: 'medium' });
        seedSignal({ user_id: 'u4', signal_id: 'continuidad_semanal', value: 0.2, confidence: 'high'   });
        seedSignal({ user_id: 'u4', signal_id: 'tiempo_efectivo_lectura', value: 5, confidence: 'low'  });

        const r1 = engine.runOnce({ nowTs: NOW });
        ok('8) runOnce produce ok=true + processed>=1',
            r1.ok && r1.profilesProcessed >= 1);
        const inserted1 = r1.recommendations.inserted;
        ok('   inserted>=2 (abandono_alto + invisibilidad_prolongada)', inserted1 >= 2);

        // Rerun inmediato — NO debe duplicar activas (unique index parcial)
        const r2 = engine.runOnce({ nowTs: NOW });
        ok('9) rerun NO duplica activas (refreshed/noop, NO inserted nuevo)',
            r2.recommendations.inserted === 0);
        ok('   rerun refresca (refreshed>=1) o no-op',
            r2.recommendations.refreshed + r2.recommendations.noop >= 1);

        // Persistencia real en DB
        const recs = reader.getRecommendations('user', 'u4');
        ok('10) recomendaciones persistidas y accesibles vía reader',
            Array.isArray(recs) && recs.length >= 2);
        ok('   explanation parseado y rule_id válido',
            recs.every(r => r.explanation && typeof r.explanation === 'object'
                          && rules.RULE_IDS.includes(r.rule_id)));
    }

    console.log('\n[F] §21.7 — cohort_rollups con at_risk_users + avg_continuidad');
    {
        const cohort = reader.getCohortComparison('all', 'global');
        ok('11) cohort_rollups incluye at_risk_users',
            cohort.metrics.some(m => m.metric_key === 'at_risk_users'));
        ok('   incluye avg_continuidad',
            cohort.metrics.some(m => m.metric_key === 'avg_continuidad'));
        ok('   incluye profiles_evaluated',
            cohort.metrics.some(m => m.metric_key === 'profiles_evaluated'));
    }

    console.log('\n[G] §21.8 — risk_history append-only + auto-resolve');
    {
        const before = reader.getRiskHistory('u4');
        ok('12) risk_history persistido con source_signals + active=true',
            Array.isArray(before) && before.length >= 1
            && before.every(r => r.source_signals && typeof r.source_signals === 'object'
                              && typeof r.active === 'boolean'));
        const activeBefore = before.filter(r => r.active).length;
        // Re-seed: ahora u4 NO cumple abandono_alto (continuidad sube a 0.9)
        seedProfile({ user_id: 'u4', abandono_risk: 0.05,
                      engagement_score: 0.7, continuidad_score: 0.9,
                      persistencia_score: 0.85, diversidad_score: 0.5,
                      last_active_at: NOW - 3600_000,  // 1h atrás → resuelve invisibilidad
                      updated_at: NOW });
        seedSignal({ user_id: 'u4', signal_id: 'abandono_temprano',   value: 0.05, confidence: 'high' });
        seedSignal({ user_id: 'u4', signal_id: 'continuidad_semanal', value: 0.9,  confidence: 'high' });
        const rResolve = engine.runOnce({ nowTs: NOW });
        const after = reader.getRiskHistory('u4');
        const activeAfter = after.filter(r => r.active).length;
        ok('   auto-resolve cierra riesgos cuya regla ya NO se cumple',
            activeAfter < activeBefore && rResolve.risks.resolved >= 1);
    }

    console.log('\n[H] §21.9 — intervention persistence');
    {
        const r = engine.recordIntervention({
            teacherId: 't1', studentId: 'u4',
            interventionType: 'lectura_guiada',
            notes: 'Sesión 1:1 acordada con familia.',
        });
        ok('13) recordIntervention persiste OK + retorna intervention_id',
            r.ok && typeof r.intervention_id === 'string');

        const list = pedExt.getPedagogyStatements().listInterventionsByStudent.all('u4', 10);
        ok('   intervención recuperable por student_id',
            list.length >= 1 && list[0].intervention_type === 'lectura_guiada');
    }

    console.log('\n[I] §21.10 — profile evolution / timeline');
    {
        const t = reader.getProfileTimeline('u4');
        ok('14) getProfileTimeline retorna profile_current + signals + risks + recommendations',
            t && t.profile_current && Array.isArray(t.signals_current)
            && Array.isArray(t.risks) && Array.isArray(t.recommendations));
    }

    console.log('\n[J] §21.11 — deterministic output');
    {
        const ctx = {
            profile: { user_id: 'det1', last_active_at: D(2) },
            snapshots: [
                { signal_id: 'abandono_temprano',   metric_value: 0.71, confidence: 'medium' },
                { signal_id: 'continuidad_semanal', metric_value: 0.22, confidence: 'high'   },
            ],
            nowTs: NOW,
        };
        const a = rules.rule_abandono_alto(ctx);
        const b = rules.rule_abandono_alto(ctx);
        ok('15) misma input → mismo confidence (determinístico)',
            a && b && Math.abs(a.confidence - b.confidence) < 1e-9
            && a.severity === b.severity);
    }

    console.log('\n[K] §21.12 — WAL compatibility / integrity_check');
    {
        const dbI = ext.getInsightsExtDb();
        const dbP = pedExt.getPedagogyExtDb();
        ok('16) insights.db WAL + integrity_check ok',
            dbI.pragma('journal_mode', { simple: true }) === 'wal'
            && dbI.pragma('integrity_check', { simple: true }) === 'ok');
        ok('   pedagogyDb (mismo archivo) integrity_check ok',
            dbP.pragma('integrity_check', { simple: true }) === 'ok');
    }

    console.log('\n[L] §21.14 — reader API never-throws (Aula Viva fallback safety)');
    {
        let threw = false;
        try {
            reader.getRecommendations('user', 'does-not-exist');
            reader.getRiskHistory('does-not-exist');
            reader.getProfileTimeline('does-not-exist');
            reader.getCohortComparison('group', 'no-group');
            reader.getActiveRecommendationsSummary();
        } catch { threw = true; }
        ok('17) reader API tolera inputs inexistentes sin lanzar', !threw);
    }

    console.log('\n[M] §21.15 — engine getStatus shape + healthcheck-ready');
    {
        const s = engine.getStatus();
        ok('18) getStatus expone engine, enabled, recommendation_backlog, rules_engine_version, ok',
            s && s.engine === 'aula_viva_intervention_v1'
            && typeof s.enabled === 'boolean'
            && typeof s.recommendation_backlog === 'number'
            && typeof s.rules_engine_version === 'number'
            && s.ok === true);
    }

} finally {
    pedExt.closePedagogyExtDb();
    ext.closeInsightsExtDb();
    try {
        for (const f of fs.readdirSync(tmpDir)) {
            try { fs.unlinkSync(path.join(tmpDir, f)); } catch {}
        }
        fs.rmdirSync(tmpDir);
    } catch {}
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
