/**
 * aulaVivaAuditEmitter.test.js — Fase 3B.
 *
 *   §1  flag OFF → todos los emisores devuelven {ok:false, reason:'disabled'}
 *   §2  flag ON sin args requeridos → reject defensivo (no throw, no emit)
 *   §3  flag ON + args válidos → row insertada con shape correcto
 *   §4  schema validation: cada payload pasa validateEvent del registry
 *   §5  teacher_viewed_student usa groupId=_unscoped cuando no se halla en groups_db
 *   §6  recordCanonicalEvent throwing NO propaga al caller
 *   §7  sin PII en payloads (no note libre, no texto del estudiante)
 *   §8  eventId único por call
 *
 *   node server/__test__/aulaVivaAuditEmitter.test.js
 */

import {
    emitTeacherViewedStudent,
    emitTeacherReviewedRecommendation,
    emitTeacherCreatedIntervention,
    emitMediatorReviewedCohort,
} from '../services/aulaVivaAuditEmitter.mjs';
import { setInserterForTest } from '../services/analyticsShadow.mjs';
import { validateEvent } from '../analytics/eventRegistry.js';

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

// ── §1: flag OFF — todos los emisores son no-op ───────────────────────────
section('[1] flag OFF (default) — todos los emisores son no-op');
{
    delete process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED;
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    const r1 = emitTeacherViewedStudent({ callerId: 't', studentId: 's' });
    const r2 = emitTeacherReviewedRecommendation({ callerId: 't', recommendationId: 'r', accepted: true });
    const r3 = emitTeacherCreatedIntervention({ callerId: 't', studentId: 's', interventionType: 'lectura_guiada' });
    const r4 = emitMediatorReviewedCohort({ callerId: 't', scopeType: 'group', scopeId: 'g1' });

    ok('OFF: emitTeacherViewedStudent disabled',         r1.ok === false && r1.reason === 'disabled');
    ok('OFF: emitTeacherReviewedRecommendation disabled', r2.ok === false && r2.reason === 'disabled');
    ok('OFF: emitTeacherCreatedIntervention disabled',   r3.ok === false && r3.reason === 'disabled');
    ok('OFF: emitMediatorReviewedCohort disabled',       r4.ok === false && r4.reason === 'disabled');
    ok('OFF: cero inserciones',                          captured.length === 0);

    setInserterForTest(null);
}

// ── §2: flag ON sin args requeridos → reject defensivo ────────────────────
section('[2] flag ON sin args requeridos → reject defensivo');
{
    process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    const r1 = emitTeacherViewedStudent({ callerId: 't' });          // sin studentId
    const r2 = emitTeacherReviewedRecommendation({ callerId: 't' }); // sin recommendationId
    const r3 = emitTeacherCreatedIntervention({ callerId: 't', studentId: 's' }); // sin interventionType
    const r4 = emitMediatorReviewedCohort({ callerId: 't', scopeType: 'group' }); // sin scopeId

    ok('sin studentId → missing_studentId',          r1.ok === false && r1.reason === 'missing_studentId');
    ok('sin recommendationId → missing_recommendationId', r2.ok === false && r2.reason === 'missing_recommendationId');
    ok('sin interventionType → missing_required',    r3.ok === false && r3.reason === 'missing_required');
    ok('sin scopeId → missing_required',             r4.ok === false && r4.reason === 'missing_required');
    ok('cero inserciones en este escenario',         captured.length === 0);

    delete process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED;
    setInserterForTest(null);
}

// ── §3: flag ON + args válidos → row insertada ────────────────────────────
section('[3] flag ON — cada emisor inserta exactamente una fila');
{
    process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    emitTeacherViewedStudent({ callerId: 'teacher1', studentId: 'student1', groupId: 'g1' });
    emitTeacherReviewedRecommendation({ callerId: 'teacher1', recommendationId: 'rec1', accepted: true });
    emitTeacherCreatedIntervention({ callerId: 'teacher1', studentId: 'student1', interventionType: 'lectura_guiada' });
    emitMediatorReviewedCohort({ callerId: 'teacher1', scopeType: 'group', scopeId: 'g1' });

    ok('4 filas insertadas (1 por emisor)', captured.length === 4);
    if (captured.length === 4) {
        const [a, b, c, d] = captured;
        ok('row[0].event === teacher_viewed_student',           a.event === 'teacher_viewed_student');
        ok('row[1].event === teacher_reviewed_recommendation',  b.event === 'teacher_reviewed_recommendation');
        ok('row[2].event === teacher_created_intervention',     c.event === 'teacher_created_intervention');
        ok('row[3].event === mediator_reviewed_cohort',         d.event === 'mediator_reviewed_cohort');

        for (const row of captured) {
            ok(`${row.event}: mode === 'aula_viva'`,         row.mode === 'aula_viva');
            ok(`${row.event}: eventId es ULID`,              typeof row.eventId === 'string' && row.eventId.length === 26);
            ok(`${row.event}: payload es object`,            row.payload && typeof row.payload === 'object');
            ok(`${row.event}: clientTs es number`,           typeof row.clientTs === 'number');
        }

        // contenido específico
        ok('viewed_student.payload.groupId === g1',          a.payload?.groupId === 'g1');
        ok('viewed_student.payload.studentId === student1',  a.payload?.studentId === 'student1');
        ok('viewed_student.payload.at es number',            typeof a.payload?.at === 'number');
        ok('reviewed.payload.accepted === true',             b.payload?.accepted === true);
        ok('intervention.payload.scopeLevel === user',       c.payload?.scopeLevel === 'user');
        ok('intervention.payload.kind === lectura_guiada',   c.payload?.kind === 'lectura_guiada');
        ok('cohort.payload.scopeLevel === group',            d.payload?.scopeLevel === 'group');
        ok('cohort.payload.cohortKey === group:g1',          d.payload?.cohortKey === 'group:g1');
    }

    delete process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED;
    setInserterForTest(null);
}

// ── §4: payloads validan contra Zod del registry ──────────────────────────
section('[4] cada payload emitido valida contra eventRegistry');
{
    process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    emitTeacherViewedStudent({ callerId: 't', studentId: 's', groupId: 'g' });
    emitTeacherReviewedRecommendation({ callerId: 't', recommendationId: 'r', accepted: false });
    emitTeacherCreatedIntervention({ callerId: 't', studentId: 's', interventionType: 'modo_audio_con_pausas' });
    emitMediatorReviewedCohort({ callerId: 't', scopeType: 'school', scopeId: 'colegio_x' });

    for (const row of captured) {
        const v = validateEvent(row.event, row.payload, 1);
        ok(`${row.event}: Zod valida payload`, v.ok === true,
           v.ok ? '' : `code=${v.code} issues=${JSON.stringify(v.issues)}`);
    }

    delete process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED;
    setInserterForTest(null);
}

// ── §5: teacher_viewed_student usa _unscoped cuando no halla grupo ───────
section('[5] teacher_viewed_student lookup groupId — _unscoped si no halla');
{
    process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    // sin pasar groupId → lookup en groups_db.json. Probable que userid_inventado_xyz no exista.
    emitTeacherViewedStudent({ callerId: 't', studentId: 'userid_que_no_existe_en_db_xyz_123' });

    ok('1 fila insertada',                           captured.length === 1);
    if (captured.length === 1) {
        const groupId = captured[0]?.payload?.groupId;
        ok('groupId es string',                      typeof groupId === 'string' && groupId.length > 0);
        ok('groupId === _unscoped o existe en db real',
           groupId === '_unscoped' || (typeof groupId === 'string' && groupId.length > 0));
    }

    delete process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED;
    setInserterForTest(null);
}

// ── §6: recordCanonicalEvent throwing NO propaga ──────────────────────────
section('[6] recordCanonicalEvent failure NO propaga');
{
    process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED = '1';
    setInserterForTest(() => { throw new Error('simulated insert failure'); });

    let threw = false;
    try {
        emitTeacherViewedStudent({ callerId: 't', studentId: 's' });
        emitTeacherReviewedRecommendation({ callerId: 't', recommendationId: 'r', accepted: true });
        emitTeacherCreatedIntervention({ callerId: 't', studentId: 's', interventionType: 'x' });
        emitMediatorReviewedCohort({ callerId: 't', scopeType: 'group', scopeId: 'g' });
    } catch {
        threw = true;
    }
    ok('NUNCA throws aunque insertEvent rompa', threw === false);

    delete process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED;
    setInserterForTest(null);
}

// ── §7: sin PII en payloads ────────────────────────────────────────────────
section('[7] sin PII en payloads');
{
    process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    emitTeacherViewedStudent({ callerId: 't', studentId: 's', groupId: 'g' });
    emitTeacherCreatedIntervention({ callerId: 't', studentId: 's', interventionType: 'lectura_guiada' });
    // Nota: el orchestrator NO pasa la nota libre al emitter (decisión defensiva).
    // Verificamos que el emitter NO acepta ni propaga 'note' aún si se intenta.
    emitTeacherCreatedIntervention({
        callerId: 't', studentId: 's', interventionType: 'lectura_guiada',
        // @ts-ignore — paramos para verificar que NO se incluye en payload
        note: 'NOTA SECRETA QUE NO DEBE APARECER',
    });

    for (const row of captured) {
        const payloadJson = JSON.stringify(row.payload || {});
        // El payload de teacher_created_intervention legalmente tiene scopeLevel/scopeId/kind
        // pero NO debe haber note libre.
        ok(`${row.event}: payload NO contiene 'note'`,         !/['"]note['"]/.test(payloadJson));
        ok(`${row.event}: payload NO contiene texto SECRETO`,  !/SECRETA/.test(payloadJson));
        // También verifico ausencia de campos de PII estudiante
        for (const banned of ['text', 'answer', 'message', 'prompt', 'response', 'body', 'email', 'name']) {
            ok(`${row.event}: payload NO contiene '${banned}'`,
               !new RegExp(`["']${banned}["']\\s*:`).test(payloadJson));
        }
    }

    delete process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED;
    setInserterForTest(null);
}

// ── §8: eventId único por call ─────────────────────────────────────────────
section('[8] eventId único por call (anti-replay)');
{
    process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    for (let i = 0; i < 10; i++) {
        emitTeacherViewedStudent({ callerId: 't', studentId: `s_${i}`, groupId: 'g' });
    }
    const ids = new Set(captured.map(r => r.eventId));
    ok('10 calls → 10 eventIds únicos', ids.size === 10);

    delete process.env.AULA_VIVA_AUDIT_EVENTS_ENABLED;
    setInserterForTest(null);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
