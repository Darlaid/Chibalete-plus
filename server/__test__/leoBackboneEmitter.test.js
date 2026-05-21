/**
 * leoBackboneEmitter.test.js — Fase 2A LEC.
 *
 * Cubre el contrato del emisor:
 *
 *   1. Default OFF — sin LEO_EVENTS_BACKBONE_ENABLED, cada emisor es no-op,
 *      no llama recordCanonicalEvent ni genera filas en events.db.
 *   2. Flag ON — cada emisor llama recordCanonicalEvent con un envelope
 *      que el registry Zod acepta (validateEvent.ok === true).
 *   3. Envelope shape — eventId ULID, mode='leo', event name canonical,
 *      payload conforma al schema del registry para cada tipo.
 *   4. Defensa — recordCanonicalEvent throwing NO propaga al caller.
 *   5. Sin PII en payload — solo IDs y kinds, sin texto libre del estudiante.
 *   6. Cleanup de keys — emitMemoryUpdated filtra non-string, cap a 50, max 40 char.
 *
 *   node server/__test__/leoBackboneEmitter.test.js
 */

import {
    emitInteractionStarted,
    emitInteractionCompleted,
    emitEvidenceRecorded,
    emitMemoryUpdated,
    emitProfileUpdated,
    emitRecommendationGenerated,
} from '../leoBackboneEmitter.mjs';
import { setInserterForTest } from '../services/analyticsShadow.mjs';
import { validateEvent } from '../analytics/eventRegistry.js';

let pass = 0, fail = 0;
function ok(label, cond, detail) {
    if (cond) { console.log(`  ✓ ${label}`); pass++; }
    else      { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); fail++; }
}
function section(name) { console.log(`\n${name}`); }

// ── §1: default OFF — no emite nada ─────────────────────────────────────────
section('[1] flag OFF (default) — todos los emisores son no-op');
{
    delete process.env.LEO_EVENTS_BACKBONE_ENABLED;
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    const r1 = emitInteractionStarted({ userId: 'u', sessionId: 's', surface: 'companion' });
    const r2 = emitInteractionCompleted({ userId: 'u', sessionId: 's', surface: 'companion', durationMs: 500 });
    const r3 = emitEvidenceRecorded({ userId: 'u', interactionType: 'explanation' });
    const r4 = emitMemoryUpdated({ userId: 'u', keys: ['x'] });
    const r5 = emitProfileUpdated({ userId: 'u', fields: ['y'] });
    const r6 = emitRecommendationGenerated({ userId: 'u', recommendationId: 'r1', kind: 'k' });

    ok('OFF: emitInteractionStarted devuelve disabled',     r1.ok === false && r1.reason === 'disabled');
    ok('OFF: emitInteractionCompleted devuelve disabled',   r2.ok === false && r2.reason === 'disabled');
    ok('OFF: emitEvidenceRecorded devuelve disabled',       r3.ok === false && r3.reason === 'disabled');
    ok('OFF: emitMemoryUpdated devuelve disabled',          r4.ok === false && r4.reason === 'disabled');
    ok('OFF: emitProfileUpdated devuelve disabled',         r5.ok === false && r5.reason === 'disabled');
    ok('OFF: emitRecommendationGenerated devuelve disabled', r6.ok === false && r6.reason === 'disabled');
    ok('OFF: cero inserciones en events.db',                captured.length === 0);

    setInserterForTest(null);
}

// ── §2: flag ON — todas las funciones llaman recorder ───────────────────────
section('[2] flag ON — cada emisor inserta exactamente una fila');
{
    process.env.LEO_EVENTS_BACKBONE_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    emitInteractionStarted({ userId: 'u1', sessionId: 'sess-1', surface: 'companion', contentId: 'c1' });
    emitInteractionCompleted({ userId: 'u1', sessionId: 'sess-1', surface: 'companion', contentId: 'c1', durationMs: 1234 });
    emitEvidenceRecorded({ userId: 'u1', interactionType: 'explanation', sessionId: 'sess-1', contentId: 'c1' });
    emitMemoryUpdated({ userId: 'u1', keys: ['interactionCount', 'lastInteractionTs'], sessionId: 'sess-1', contentId: 'c1' });

    ok('ON: 4 filas insertadas (1 por emisor)', captured.length === 4);
    if (captured.length === 4) {
        const [a, b, c, d] = captured;
        ok('row[0].event === leo_interaction_started',   a.event === 'leo_interaction_started');
        ok('row[1].event === leo_interaction_completed', b.event === 'leo_interaction_completed');
        ok('row[2].event === leo_evidence_recorded',     c.event === 'leo_evidence_recorded');
        ok('row[3].event === leo_memory_updated',        d.event === 'leo_memory_updated');

        for (const row of captured) {
            ok(`${row.event}: mode === 'leo'`,          row.mode === 'leo');
            ok(`${row.event}: userId presente`,         typeof row.userId === 'string' && row.userId.length > 0);
            ok(`${row.event}: eventId es ULID (26ch)`,  typeof row.eventId === 'string' && row.eventId.length === 26);
            ok(`${row.event}: clientTs es number`,      typeof row.clientTs === 'number');
            ok(`${row.event}: payload es object`,       row.payload && typeof row.payload === 'object');
        }

        // durationMs preservado en completed
        ok('completed: durationMs preservado',
           b.payload?.durationMs === 1234);
        // sourceEvent en evidence link al sessionId del started
        ok('evidence: sourceEvent === sessionId del started',
           c.payload?.sourceEvent === 'sess-1');
        // keys preservadas en memory_updated
        ok('memory_updated: keys preservadas',
           Array.isArray(d.payload?.keys) && d.payload.keys.length === 2);
    }

    delete process.env.LEO_EVENTS_BACKBONE_ENABLED;
    setInserterForTest(null);
}

// ── §3: payloads conforman a Zod del registry ───────────────────────────────
section('[3] cada payload emitido valida contra eventRegistry');
{
    process.env.LEO_EVENTS_BACKBONE_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    emitInteractionStarted({ userId: 'u', sessionId: 'sess-x', surface: 'chatbot' });
    emitInteractionCompleted({ userId: 'u', sessionId: 'sess-x', surface: 'chatbot', durationMs: 50 });
    emitEvidenceRecorded({ userId: 'u', interactionType: 'hint', sessionId: 'sess-x' });
    emitMemoryUpdated({ userId: 'u', keys: ['k1'] });
    emitProfileUpdated({ userId: 'u', fields: ['preferredSupportType'] });
    emitRecommendationGenerated({ userId: 'u', recommendationId: 'rec-001', kind: 'reflection' });

    for (const row of captured) {
        const v = validateEvent(row.event, row.payload, 1);
        ok(`${row.event}: Zod valida payload`, v.ok === true,
           v.ok ? '' : `code=${v.code} issues=${JSON.stringify(v.issues)}`);
    }

    delete process.env.LEO_EVENTS_BACKBONE_ENABLED;
    setInserterForTest(null);
}

// ── §4: recorder throwing NO propaga al caller ──────────────────────────────
section('[4] recordCanonicalEvent failure NO propaga');
{
    process.env.LEO_EVENTS_BACKBONE_ENABLED = '1';
    setInserterForTest(() => { throw new Error('simulated insert failure'); });

    let threw = false;
    try {
        emitInteractionStarted({ userId: 'u', sessionId: 's', surface: 'companion' });
        emitInteractionCompleted({ userId: 'u', sessionId: 's', surface: 'companion', durationMs: 1 });
        emitEvidenceRecorded({ userId: 'u', interactionType: 'x' });
        emitMemoryUpdated({ userId: 'u', keys: [] });
    } catch {
        threw = true;
    }
    ok('NUNCA throws aunque insertEvent rompa', threw === false);

    delete process.env.LEO_EVENTS_BACKBONE_ENABLED;
    setInserterForTest(null);
}

// ── §5: sin PII — payloads solo IDs y kinds ─────────────────────────────────
section('[5] sin PII en payloads');
{
    process.env.LEO_EVENTS_BACKBONE_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    // Simulamos texto del estudiante + respuesta Leo — el emisor NO debe replicarlos.
    emitInteractionStarted({ userId: 'u', sessionId: 's', surface: 'companion' });
    emitEvidenceRecorded({ userId: 'u', interactionType: 'explanation' });

    // No hay campo `text`, `answer`, `message`, `prompt`, `response` en payload.
    const banned = ['text', 'answer', 'message', 'prompt', 'response', 'content', 'body'];
    for (const row of captured) {
        const keys = Object.keys(row.payload || {});
        for (const b of banned) {
            ok(`${row.event}: payload NO contiene '${b}'`, !keys.includes(b));
        }
    }

    delete process.env.LEO_EVENTS_BACKBONE_ENABLED;
    setInserterForTest(null);
}

// ── §6: cleanup keys/fields (cap 50, max 40 chars, filtra non-string) ──────
section('[6] cleanup defensivo de keys/fields');
{
    process.env.LEO_EVENTS_BACKBONE_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    // 60 keys, algunas non-string, una muy larga (60 char)
    const messyKeys = [];
    for (let i = 0; i < 60; i++) messyKeys.push(`k${i}`);
    messyKeys.push(null, undefined, 123, 'a'.repeat(60), 'normal');
    emitMemoryUpdated({ userId: 'u', keys: messyKeys });

    const row = captured[0];
    ok('memory_updated: keys cap a 50', row.payload.keys.length <= 50);
    ok('memory_updated: ningun key non-string',
       row.payload.keys.every(k => typeof k === 'string' && k.length > 0));
    ok('memory_updated: cada key max 40 char',
       row.payload.keys.every(k => k.length <= 40));

    delete process.env.LEO_EVENTS_BACKBONE_ENABLED;
    setInserterForTest(null);
}

// ── §7: eventId único por call ──────────────────────────────────────────────
section('[7] eventId único por call (anti-replay)');
{
    process.env.LEO_EVENTS_BACKBONE_ENABLED = '1';
    const captured = [];
    setInserterForTest((row) => { captured.push(row); });

    for (let i = 0; i < 10; i++) {
        emitInteractionStarted({ userId: 'u', sessionId: `sess-${i}`, surface: 'companion' });
    }
    const ids = new Set(captured.map(r => r.eventId));
    ok('10 calls → 10 eventIds únicos', ids.size === 10);

    delete process.env.LEO_EVENTS_BACKBONE_ENABLED;
    setInserterForTest(null);
}

console.log(`\nResultados: ${pass} ✓, ${fail} ✗`);
process.exit(fail === 0 ? 0 : 1);
