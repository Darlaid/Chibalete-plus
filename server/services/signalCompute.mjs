/**
 * signalCompute.mjs — cómputo PURO de señales pedagógicas para el PASO 2.
 *
 * Implementa REAL 5 señales de alto valor (las de mayor confidence_now y
 * mejor cobertura de eventos disponibles); las 10 restantes quedan como
 * "stub registrado" devolviendo {metric_value:null, confidence:'pending'}
 * — el contrato existe (SIGNAL_IDS de PASO 1), el cómputo se completa en
 * PASO 3 cuando exista más volumen de eventos diversos.
 *
 * Toma `events` (filas crudas de events.db) ya agrupadas por user_id +
 * window y devuelve `{ signalId → {value, confidence, trend?, meta?} }`.
 * Funciones puras, sin I/O — el materializer hace la persistencia.
 */
import { SIGNAL_IDS } from '../analytics/signals.js';
import { flags } from '../lib/flags.js';

const DAY = 86_400_000;

// ── Fase 2B LEC — clasificaciones canónicas de pedagogicalObjective ────────
// Vienen de leoEvidenceService.classifyPedagogicalObjective. NO duplicamos
// el clasificador; solo enumeramos los valores que el extractor agrupa.
// Si leoEvidenceService agrega un nuevo valor, este conjunto NO es exhaustivo
// — los valores no listados quedan fuera de las 4 signals pero el conteo
// total (denom) sigue siendo correcto porque solo cuentan eventos válidos.
const PEDAGOGICAL_OBJECTIVES_KNOWN = new Set([
    'vocabulary', 'inferential', 'critical', 'literal',
    'writing', 'metacognitive', 'emotional',
]);

/**
 * @param {Array<object>} events  filas crudas (id, event, server_ts, payload_json…)
 * @param {{nowTs:number, windowDays:number}} ctx
 */
export function computeUserSignals(events, ctx) {
    const out = {};
    const w = ctx.windowDays * DAY;
    const since = ctx.nowTs - w;
    const inWin = events.filter(e => e.server_ts >= since);
    const byEvent = (name) => inWin.filter(e => e.event === name);

    // ── 1. continuidad_semanal — distinct(days_with_session)/7 sobre 28d ─────
    {
        const days = new Set(inWin
            .filter(e => e.event === 'session_started' || e.event === 'reading_started')
            .map(e => new Date(e.server_ts).toISOString().slice(0, 10)));
        const recentDays = Math.min(28, ctx.windowDays);
        const value = Math.min(1, days.size / 7);
        out.continuidad_semanal = { value, confidence: days.size >= 3 ? 'high' : 'medium',
            meta: { distinct_days: days.size, window_days: recentDays } };
    }

    // ── 2. tiempo_efectivo_lectura — suma elapsedMs en heartbeats/ended ─────
    {
        let ms = 0;
        for (const e of inWin) {
            if (e.event === 'session_heartbeat' || e.event === 'session_ended') {
                try {
                    const p = JSON.parse(e.payload_json || '{}');
                    if (typeof p.elapsedMs === 'number' && p.elapsedMs > 0) ms += p.elapsedMs;
                    else if (typeof p.totalMs === 'number' && p.totalMs > 0) ms += p.totalMs;
                } catch {}
            } else if (typeof e.elapsed_ms === 'number' && e.elapsed_ms > 0) {
                ms += e.elapsed_ms;
            }
        }
        out.tiempo_efectivo_lectura = { value: Math.round(ms / 60_000),  // minutos
            confidence: ms > 0 ? 'high' : 'low',
            meta: { ms, minutes: Math.round(ms / 60_000), window_days: ctx.windowDays } };
    }

    // ── 3. abandono_temprano — abandoned con progress<10% / total starts ────
    {
        const starts = byEvent('reading_started').length;
        let earlyAbandon = 0;
        for (const e of byEvent('reading_abandoned')) {
            try {
                const p = JSON.parse(e.payload_json || '{}');
                // Si no hay progreso registrado, contar como early.
                if (typeof p.percentage === 'number' ? p.percentage < 10 : true) earlyAbandon++;
            } catch { earlyAbandon++; }
        }
        const value = starts > 0 ? earlyAbandon / starts : null;
        out.abandono_temprano = { value, confidence: starts >= 5 ? 'medium' : 'low',
            meta: { starts, early_abandons: earlyAbandon } };
    }

    // ── 4. diversidad_lectora — distinct(contentId) / starts ────────────────
    {
        const cids = new Set();
        for (const e of inWin) {
            if (e.content_id) cids.add(e.content_id);
        }
        const value = cids.size;  // conteo absoluto (no ratio: requiere catálogo)
        out.diversidad_lectora = { value, confidence: cids.size >= 3 ? 'medium' : 'low',
            meta: { distinct_contents: cids.size, window_days: ctx.windowDays } };
    }

    // ── 5. persistencia — (resumed+completed)/(resumed+completed+abandoned) ─
    {
        const r = byEvent('reading_resumed').length;
        const c = byEvent('reading_completed').length;
        const a = byEvent('reading_abandoned').length;
        const den = r + c + a;
        const value = den > 0 ? (r + c) / den : null;
        out.persistencia = { value, confidence: den >= 5 ? 'medium' : 'low',
            meta: { resumed: r, completed: c, abandoned: a } };
    }

    // ── Fase 2B LEC: 4 signals Leo-derived (gated por flag) ─────────────────
    // Permite que ctx pase la decisión del flag (testabilidad), con fallback
    // a la lectura runtime via `flags`. Cero impacto cuando flag OFF: las 4
    // signals quedan en el stub de pending igual que el resto.
    const leoEnabled = typeof ctx?.leoExtractionEnabled === 'boolean'
        ? ctx.leoExtractionEnabled
        : (() => { try { return flags.leoSignalExtractionEnabled(); } catch { return false; } })();
    if (leoEnabled) {
        // ── 6. mediacion_leo — frecuencia de interacciones Leo en ventana ──
        {
            const started = byEvent('leo_interaction_started').length;
            // Confidence: low <3; medium 3-9; high ≥10. Threshold conservador —
            // mediación es una señal cualitativa, no un score.
            const confidence = started >= 10 ? 'high' : started >= 3 ? 'medium' : 'low';
            out.mediacion_leo = {
                value: started,
                confidence,
                meta: { count: started, window_days: ctx.windowDays },
            };
        }

        // ── 7-9. evidencia por pedagogicalObjective (inferencial/metacognitiva/emocional)
        {
            const evidence = byEvent('leo_evidence_recorded');
            // Conteos por pedagogicalObjective. Sin pedagogicalObjective en
            // payload, cae al bucket 'unknown' que NO suma a ninguna signal.
            const counts = { inferential: 0, metacognitive: 0, emotional: 0, _other: 0, _missing: 0 };
            let total = 0;
            for (const e of evidence) {
                let obj = null;
                try {
                    const p = JSON.parse(e.payload_json || '{}');
                    if (typeof p.pedagogicalObjective === 'string'
                        && PEDAGOGICAL_OBJECTIVES_KNOWN.has(p.pedagogicalObjective)) {
                        obj = p.pedagogicalObjective;
                    }
                } catch { /* malformed payload: cuenta a _missing */ }
                if (obj === 'inferential')       counts.inferential++;
                else if (obj === 'metacognitive') counts.metacognitive++;
                else if (obj === 'emotional')     counts.emotional++;
                else if (obj === null)            counts._missing++;
                else                              counts._other++;
                total++;
            }
            const ratio = (n) => total > 0 ? n / total : null;
            // Threshold conservador: <5 evidencias en la ventana → insufficient_data
            // (confidence='low', value=null). Esto honra "no afirmar comprensión".
            const sufficient = total >= 5;
            const confidence = sufficient ? 'low' : 'low'; // siempre low: estas son proxies, NO juicios
            out.inferencia_observada = {
                value: sufficient ? ratio(counts.inferential) : null,
                confidence,
                meta: {
                    count: counts.inferential, total_evidence: total,
                    insufficient_data: !sufficient, threshold: 5, window_days: ctx.windowDays,
                },
            };
            out.metacognicion_observada = {
                value: sufficient ? ratio(counts.metacognitive) : null,
                confidence,
                meta: {
                    count: counts.metacognitive, total_evidence: total,
                    insufficient_data: !sufficient, threshold: 5, window_days: ctx.windowDays,
                },
            };
            out.emocion_observada = {
                value: sufficient ? ratio(counts.emotional) : null,
                confidence,
                meta: {
                    count: counts.emotional, total_evidence: total,
                    insufficient_data: !sufficient, threshold: 5, window_days: ctx.windowDays,
                    caveat: 'observada — no infiere emoción real del estudiante',
                },
            };
        }
    }

    // ── 10-15+: stubs registrados (contrato existe; cómputo deferred) ──────
    // Cubre TODAS las signals no calculadas — incluyendo las Leo cuando el
    // flag está OFF y cualquier signal nueva que se agregue al catálogo.
    for (const id of SIGNAL_IDS) {
        if (out[id]) continue;
        out[id] = { value: null, confidence: 'pending',
            meta: { reason: 'compute_deferred_to_paso3_more_events_needed' } };
    }
    return out;
}

/**
 * Perfil lector longitudinal (PASO 2): combina señales en un perfil
 * sintético + abandono_risk (regla determinística, 0..1).
 * @param {ReturnType<typeof computeUserSignals>} signals
 * @param {{nowTs:number}} ctx
 */
export function computeUserProfile(signals, ctx) {
    const n = (v, max = 1) => (typeof v === 'number' ? Math.max(0, Math.min(1, v / max)) : null);
    const persistencia = signals.persistencia?.value ?? null;
    const continuidad  = signals.continuidad_semanal?.value ?? null;
    const tiempoMin    = signals.tiempo_efectivo_lectura?.value ?? null;
    const diversidad   = signals.diversidad_lectora?.value ?? null;
    const abandono     = signals.abandono_temprano?.value ?? null;

    return {
        fluidez_score:       null,  // requiere mapa contenido→palabras (PASO 3)
        persistencia_score:  persistencia,
        autonomia_score:     null,  // requiere eventos accessibility/tts en volumen (PASO 3)
        concentracion_score: null,  // requiere immersive_visibility_stall en volumen
        diversidad_score:    n(diversidad, 10),         // normalizado: 10 contenidos = 1.0
        engagement_score:    avg([continuidad, n(tiempoMin, 60)]),  // 60 min ≈ 1.0
        abandono_risk:       typeof abandono === 'number'
            ? Math.max(0, Math.min(1, abandono * 0.7 + (continuidad != null ? (1 - continuidad) * 0.3 : 0.15)))
            : null,
    };
}

function avg(xs) {
    const vs = xs.filter(x => typeof x === 'number');
    return vs.length ? vs.reduce((s, x) => s + x, 0) / vs.length : null;
}
