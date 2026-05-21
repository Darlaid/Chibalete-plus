/**
 * leoPedagogicalSignals.test.js — Fase 2B LEC.
 *
 * Cubre la extracción de señales pedagógicas derivadas de eventos Leo:
 *
 *   1. signals.js declara las 4 IDs nuevas con confidence_now y notes honestos.
 *   2. objectives.js referencia las nuevas signals en los objetivos relevantes.
 *   3. signalCompute respeta el flag OFF → las 4 signals quedan en pending.
 *   4. signalCompute con flag ON computa mediacion_leo desde
 *      leo_interaction_started.
 *   5. signalCompute con flag ON deriva inferencia/metacognicion/emocion
 *      desde payload.pedagogicalObjective.
 *   6. Threshold de insuficiencia: <5 evidencias → value=null,
 *      insufficient_data=true.
 *   7. pedagogicalObjective desconocido NO suma a ninguna ratio pero cuenta
 *      en total.
 *   8. Payload malformado (JSON.parse falla) NO rompe el batch.
 *   9. signals NO incluyen texto libre del estudiante en su meta (no PII).
 *  10. emitEvidenceRecorded acepta y pasa pedagogicalObjective al payload.
 *
 *   node server/__test__/leoPedagogicalSignals.test.js
 */

import { SIGNALS, SIGNAL_IDS, getSignal } from '../analytics/signals.js';
import { OBJECTIVES, getObjective } from '../analytics/objectives.js';
import { computeUserSignals } from '../services/signalCompute.mjs';
import { emitEvidenceRecorded } from '../leoBackboneEmitter.mjs';
import { setInserterForTest } from '../services/analyticsShadow.mjs';

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

// ── §1: signals.js declara las 4 IDs nuevas ────────────────────────────────
section('[1] signals.js declara 4 IDs Leo-derived con metadata honesta');
{
    const NEW_IDS = ['mediacion_leo', 'inferencia_observada', 'metacognicion_observada', 'emocion_observada'];
    for (const id of NEW_IDS) {
        const s = getSignal(id);
        ok(`signal '${id}' existe`, !!s);
        if (s) {
            ok(`'${id}' tiene source_events`, Array.isArray(s.source_events) && s.source_events.length > 0);
            ok(`'${id}' tiene formula textual`, typeof s.formula === 'string' && s.formula.length > 0);
            ok(`'${id}' confidence_now ∈ {low,medium,high}`,
               ['low', 'medium', 'high'].includes(s.confidence_now));
            ok(`'${id}' tiene notes con caveat`, typeof s.notes === 'string' && s.notes.length > 0);
        }
    }
    ok('SIGNAL_IDS incluye los 4 nuevos', NEW_IDS.every(id => SIGNAL_IDS.includes(id)));
}

// ── §2: objectives referencian las nuevas signals ──────────────────────────
section('[2] objectives.js referencia las nuevas signals');
{
    const compLec = getObjective('comprension_lectora');
    ok('comprension_lectora.required_signals incluye inferencia_observada',
       compLec.required_signals.includes('inferencia_observada'));
    ok('comprension_lectora.required_signals incluye metacognicion_observada',
       compLec.required_signals.includes('metacognicion_observada'));

    const lecAut = getObjective('lectura_autonoma');
    ok('lectura_autonoma.required_signals incluye mediacion_leo',
       lecAut.required_signals.includes('mediacion_leo'));
    ok('lectura_autonoma.data_gaps menciona caveat de mediacion_leo',
       lecAut.data_gaps.some(g => /mediacion_leo/.test(g)));

    const lecCrit = getObjective('lectura_critica');
    ok('lectura_critica.required_events incluye leo_evidence_recorded',
       lecCrit.required_events.includes('leo_evidence_recorded'));
    ok('lectura_critica.required_signals incluye inferencia_observada',
       lecCrit.required_signals.includes('inferencia_observada'));
    ok('lectura_critica.data_gaps reconoce que es OBSERVADA',
       lecCrit.data_gaps.some(g => /OBSERVADA/.test(g)));
}

// ── §3: signalCompute respeta flag OFF — 4 signals quedan en pending ───────
section('[3] flag OFF — 4 signals Leo en pending');
{
    const events = [
        { event: 'leo_interaction_started',  server_ts: Date.now(), payload_json: '{}' },
        { event: 'leo_evidence_recorded',    server_ts: Date.now(), payload_json: JSON.stringify({ pedagogicalObjective: 'inferential' }) },
    ];
    const out = computeUserSignals(events, { nowTs: Date.now(), windowDays: 28, leoExtractionEnabled: false });

    for (const id of ['mediacion_leo', 'inferencia_observada', 'metacognicion_observada', 'emocion_observada']) {
        ok(`OFF: ${id} confidence='pending'`, out[id]?.confidence === 'pending');
        ok(`OFF: ${id} value === null`,        out[id]?.value === null);
    }
}

// ── §4: flag ON — mediacion_leo cuenta interacciones reales ────────────────
section('[4] flag ON — mediacion_leo refleja count de interactions');
{
    const now = Date.now();
    const events = [
        { event: 'leo_interaction_started', server_ts: now - 1000, payload_json: '{}' },
        { event: 'leo_interaction_started', server_ts: now - 2000, payload_json: '{}' },
        { event: 'leo_interaction_started', server_ts: now - 3000, payload_json: '{}' },
        // un evento NO leo no debe contar
        { event: 'reading_started',         server_ts: now - 4000, payload_json: '{}' },
    ];
    const out = computeUserSignals(events, { nowTs: now, windowDays: 28, leoExtractionEnabled: true });
    ok('mediacion_leo.value === 3', out.mediacion_leo.value === 3);
    ok('mediacion_leo confidence medium (3..9)', out.mediacion_leo.confidence === 'medium');
    ok('mediacion_leo meta tiene count y window_days',
       out.mediacion_leo.meta.count === 3 && out.mediacion_leo.meta.window_days === 28);
}

// ── §5: flag ON — pedagogicalObjective deriva las 3 ratios ─────────────────
section('[5] flag ON — inferencia/metacognicion/emocion derivan de payload');
{
    const now = Date.now();
    const mk = (obj) => ({
        event: 'leo_evidence_recorded', server_ts: now - 1000,
        payload_json: JSON.stringify({ userId: 'u', kind: 'k', pedagogicalObjective: obj }),
    });
    // 10 evidencias total: 4 inferential, 3 metacognitive, 1 emotional, 2 vocab
    const events = [
        mk('inferential'), mk('inferential'), mk('inferential'), mk('inferential'),
        mk('metacognitive'), mk('metacognitive'), mk('metacognitive'),
        mk('emotional'),
        mk('vocabulary'), mk('vocabulary'),
    ];
    const out = computeUserSignals(events, { nowTs: now, windowDays: 28, leoExtractionEnabled: true });

    ok('inferencia_observada value === 4/10',         Math.abs(out.inferencia_observada.value - 0.4) < 0.001);
    ok('metacognicion_observada value === 3/10',      Math.abs(out.metacognicion_observada.value - 0.3) < 0.001);
    ok('emocion_observada value === 1/10',            Math.abs(out.emocion_observada.value - 0.1) < 0.001);
    ok('inferencia_observada meta.count === 4',       out.inferencia_observada.meta.count === 4);
    ok('inferencia_observada meta.total_evidence === 10', out.inferencia_observada.meta.total_evidence === 10);
    ok('emocion_observada meta.caveat presente',      typeof out.emocion_observada.meta.caveat === 'string');
    ok('emocion_observada caveat menciona "no infiere"',  /no infiere/i.test(out.emocion_observada.meta.caveat));
    ok('todas las 3 confidence === low (proxy)',
       out.inferencia_observada.confidence === 'low'
       && out.metacognicion_observada.confidence === 'low'
       && out.emocion_observada.confidence === 'low');
}

// ── §6: threshold <5 evidencias → insufficient_data ────────────────────────
section('[6] insufficient_data cuando total_evidence < 5');
{
    const now = Date.now();
    const events = [
        { event: 'leo_evidence_recorded', server_ts: now,
          payload_json: JSON.stringify({ pedagogicalObjective: 'inferential' }) },
        { event: 'leo_evidence_recorded', server_ts: now,
          payload_json: JSON.stringify({ pedagogicalObjective: 'inferential' }) },
    ];
    const out = computeUserSignals(events, { nowTs: now, windowDays: 28, leoExtractionEnabled: true });

    ok('value === null cuando insufficient',          out.inferencia_observada.value === null);
    ok('meta.insufficient_data === true',             out.inferencia_observada.meta.insufficient_data === true);
    ok('meta.threshold === 5',                        out.inferencia_observada.meta.threshold === 5);
    ok('meta.count preserva el conteo real',          out.inferencia_observada.meta.count === 2);
    ok('meta.total_evidence === 2',                   out.inferencia_observada.meta.total_evidence === 2);
}

// ── §7: pedagogicalObjective desconocido NO suma a ratio pero cuenta en total
section('[7] pedagogicalObjective no canónico → bucket _other');
{
    const now = Date.now();
    const events = [
        { event: 'leo_evidence_recorded', server_ts: now,
          payload_json: JSON.stringify({ pedagogicalObjective: 'inferential' }) },
        { event: 'leo_evidence_recorded', server_ts: now,
          payload_json: JSON.stringify({ pedagogicalObjective: 'inferential' }) },
        // valor no canónico (no en PEDAGOGICAL_OBJECTIVES_KNOWN)
        { event: 'leo_evidence_recorded', server_ts: now,
          payload_json: JSON.stringify({ pedagogicalObjective: 'made_up_value' }) },
        // payload sin pedagogicalObjective
        { event: 'leo_evidence_recorded', server_ts: now,
          payload_json: JSON.stringify({}) },
        { event: 'leo_evidence_recorded', server_ts: now,
          payload_json: JSON.stringify({}) },
    ];
    const out = computeUserSignals(events, { nowTs: now, windowDays: 28, leoExtractionEnabled: true });
    ok('total_evidence cuenta TODOS los recorded',    out.inferencia_observada.meta.total_evidence === 5);
    ok('inferencia.count solo cuenta inferential',    out.inferencia_observada.meta.count === 2);
    ok('value === 2/5 = 0.4',                          Math.abs(out.inferencia_observada.value - 0.4) < 0.001);
}

// ── §8: payload malformado NO rompe el batch ───────────────────────────────
section('[8] JSON malformado en payload — defensivo');
{
    const now = Date.now();
    const events = [
        { event: 'leo_evidence_recorded', server_ts: now, payload_json: '{not json}' },
        { event: 'leo_evidence_recorded', server_ts: now, payload_json: null },
        { event: 'leo_evidence_recorded', server_ts: now,
          payload_json: JSON.stringify({ pedagogicalObjective: 'inferential' }) },
    ];
    let threw = false;
    let out;
    try {
        out = computeUserSignals(events, { nowTs: now, windowDays: 28, leoExtractionEnabled: true });
    } catch { threw = true; }
    ok('NO throw con JSON malformado',                threw === false);
    ok('total_evidence cuenta los 3 eventos',         out.inferencia_observada.meta.total_evidence === 3);
}

// ── §9: signals NO incluyen texto libre del estudiante (no PII) ────────────
section('[9] meta de signals NO contiene texto del estudiante');
{
    const now = Date.now();
    const events = [
        { event: 'leo_evidence_recorded', server_ts: now,
          payload_json: JSON.stringify({
              pedagogicalObjective: 'inferential',
              // Si por error el payload incluyera texto, el computer NO debe propagarlo
              userInputPreview: 'lo que escribió el estudiante',
              answerPreview: 'lo que respondió Leo',
          }) },
    ];
    const out = computeUserSignals(events, { nowTs: now, windowDays: 28, leoExtractionEnabled: true });
    const metaJson = JSON.stringify(out.inferencia_observada.meta || {});
    ok('meta NO incluye userInputPreview',            !/userInputPreview|escribió el estudiante/.test(metaJson));
    ok('meta NO incluye answerPreview',               !/answerPreview|respondió Leo/.test(metaJson));
    const allMetas = JSON.stringify([
        out.mediacion_leo, out.inferencia_observada, out.metacognicion_observada, out.emocion_observada,
    ]);
    for (const banned of ['text', 'answer', 'message', 'prompt', 'response', 'body', 'userInput']) {
        ok(`ningún meta contiene '${banned}'`, !allMetas.toLowerCase().includes(banned.toLowerCase()));
    }
}

// ── §10: emitEvidenceRecorded propaga pedagogicalObjective ─────────────────
section('[10] emitEvidenceRecorded incluye pedagogicalObjective en payload');
{
    process.env.LEO_EVENTS_BACKBONE_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    emitEvidenceRecorded({
        userId: 'u', interactionType: 'inferential',
        pedagogicalObjective: 'inferential',
        sessionId: 's', contentId: 'c',
    });
    ok('1 fila insertada',                            captured.length === 1);
    ok('payload.pedagogicalObjective === inferential', captured[0]?.payload?.pedagogicalObjective === 'inferential');

    // Backward-compat: sin pedagogicalObjective sigue funcionando.
    captured.length = 0;
    emitEvidenceRecorded({ userId: 'u', interactionType: 'vocab' });
    ok('backward-compat: sin pedagogicalObjective NO rompe', captured.length === 1);
    ok('backward-compat: payload NO incluye pedagogicalObjective si no se pasa',
       captured[0]?.payload?.pedagogicalObjective === undefined);

    delete process.env.LEO_EVENTS_BACKBONE_ENABLED;
    setInserterForTest(null);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
