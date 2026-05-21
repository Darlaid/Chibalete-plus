/**
 * signals.js — Aula Viva PASO 1: contratos de señales pedagógicas BASE.
 *
 * IMPORTANTE: este módulo NO calcula nada. Solo define los CONTRATOS de
 * señales derivables del log canónico de eventos (events.db). El cómputo +
 * materialización en insights.db es el PASO 2.
 *
 * Cada contrato:
 *   - id            (camelCase estable)
 *   - source_events (qué events.db .event los alimenta)
 *   - formula       (descripción textual auditable, sin lib mágica)
 *   - window        (ventana temporal mínima recomendada)
 *   - scope         (user | group | school)
 *   - utility       (para qué sirve pedagógicamente)
 *   - saber_pisa    (relación con marcos evaluativos LATAM/intl)
 *   - confidence_now ('low'|'medium'|'high' con la data disponible HOY)
 *   - notes
 */
export const SIGNALS = Object.freeze([
    { id: 'continuidad_semanal',
      source_events: ['session_started','session_ended','reading_started'],
      formula: 'distinct(days_with_session) / 7 en ventana móvil de 28 días',
      window: '28d', scope: 'user',
      utility: 'detecta hábito de lectura sostenido',
      saber_pisa: 'PISA: engagement with reading; Saber: hábito lector',
      confidence_now: 'medium' },
    { id: 'tiempo_efectivo_lectura',
      source_events: ['session_started','session_heartbeat','session_ended','reading_paused','reading_resumed'],
      formula: 'sum(elapsedMs while not paused) por user por ventana',
      window: '7d/28d', scope: 'user',
      utility: 'volumen real de lectura (descuenta pausas/inactividad)',
      saber_pisa: 'PISA: time on reading task', confidence_now: 'high' },
    { id: 'profundidad_sesion',
      source_events: ['session_started','reading_progress','reading_completed','session_ended'],
      formula: 'avg(progress_fraction final) por sesión',
      window: '14d', scope: 'user',
      utility: 'señal de concentración / penetración del texto',
      saber_pisa: 'Saber: comprensión sostenida', confidence_now: 'medium' },
    { id: 'abandono_temprano',
      source_events: ['reading_started','reading_abandoned','session_timeout'],
      formula: 'abandonments_before_progress(0.10) / total_starts',
      window: '14d', scope: 'user',
      utility: 'detecta dificultad/desinterés inicial',
      saber_pisa: 'Saber: persistencia lectora', confidence_now: 'medium' },
    { id: 'recuperacion_tras_abandono',
      source_events: ['reading_abandoned','reading_reopened','reading_completed'],
      formula: 'reopened_after_abandon / abandoned (en ventana 14d)',
      window: '14d', scope: 'user',
      utility: 'capacidad de retomar lectura difícil',
      saber_pisa: 'PISA: resilience', confidence_now: 'medium' },
    { id: 'lectura_autonoma',
      source_events: ['reading_started','reading_completed','accessibility_mode_enabled','tts_started'],
      formula: 'sessions_without_assistance / total_sessions',
      window: '28d', scope: 'user',
      utility: 'progreso hacia lectura independiente',
      saber_pisa: 'Saber: autonomía lectora', confidence_now: 'medium' },
    { id: 'diversidad_lectora',
      source_events: ['reading_started','reading_completed'],
      formula: 'distinct(contentId) en ventana / contenidos disponibles',
      window: '28d/90d', scope: 'user/group',
      utility: 'amplitud temática del lector',
      saber_pisa: 'PISA: range of reading materials', confidence_now: 'high' },
    { id: 'concentracion',
      source_events: ['immersive_visibility_stall','session_heartbeat','reading_paused','session_timeout'],
      formula: 'streaks de heartbeat sin stalls/pausas largas; mediana stall_ms',
      window: '7d', scope: 'user',
      utility: 'atención sostenida durante lectura inmersiva',
      saber_pisa: 'PISA: cognitive engagement', confidence_now: 'medium' },
    { id: 'relectura',
      source_events: ['reading_repeated_segment','reading_reopened'],
      formula: 'count(repeated_segment) por contenido por user',
      window: '28d', scope: 'user',
      utility: 'señal de comprensión activa (releer = procesar)',
      saber_pisa: 'Saber: metacognición lectora', confidence_now: 'medium' },
    { id: 'uso_audio',
      source_events: ['audio_started','immersive_started','tts_started'],
      formula: 'sesiones_con_audio / total_sesiones',
      window: '28d', scope: 'user/group',
      utility: 'preferencia/dependencia multimodal',
      saber_pisa: 'PISA: multimodal literacy', confidence_now: 'high' },
    { id: 'uso_accesibilidad',
      source_events: ['accessibility_mode_enabled','accessibility_mode_disabled','font_adjusted','contrast_adjusted','tts_started'],
      formula: 'count(features_unique) y tiempo con feature on',
      window: '28d', scope: 'user',
      utility: 'detecta necesidades accesibilidad reales',
      saber_pisa: 'inclusión efectiva', confidence_now: 'high' },
    { id: 'dificultad_probable',
      source_events: ['reading_repeated_segment','reading_paused','reading_abandoned','tts_started'],
      formula: 'combinación ponderada repetidos+pausas+TTS sobre el mismo contenido',
      window: 'por contenido', scope: 'user',
      utility: 'detección temprana de texto difícil para ese lector',
      saber_pisa: 'Saber: zona de desarrollo próximo', confidence_now: 'low' },
    { id: 'engagement',
      source_events: ['session_started','session_ended','reading_completed','album_interaction','guided_step_completed'],
      formula: 'sessions_per_week * avg_session_minutes * completion_rate',
      window: '28d', scope: 'user/group',
      utility: 'compromiso global con la plataforma',
      saber_pisa: 'PISA: engagement composite', confidence_now: 'medium' },
    { id: 'persistencia',
      source_events: ['reading_resumed','reading_completed','reading_abandoned'],
      formula: '(resumed+completed)/(resumed+completed+abandoned)',
      window: '28d', scope: 'user/group',
      utility: 'capacidad de sostener tareas lectoras',
      saber_pisa: 'Saber: persistencia', confidence_now: 'medium' },
    { id: 'fluidez_inferida',
      source_events: ['reading_progress','immersive_sentence_committed','session_ended'],
      formula: 'palabras_leidas_estimadas / tiempo_efectivo (palabras/min)',
      window: 'por sesión', scope: 'user',
      utility: 'proxy de fluidez sin tasks invasivas',
      saber_pisa: 'Saber/PISA: fluencia lectora', confidence_now: 'low',
      notes: 'requiere mapa contenido→palabras; mejora con anchors V2' },

    // ──────────────────────────────────────────────────────────────────────
    // Fase 2B LEC — señales derivadas de eventos Leo. Honestidad estadística:
    // los IDs usan sufijo `_observada` (no `_signal`) para enfatizar que el
    // sistema OBSERVA evidencia, NUNCA afirma comprensión. Si no hay
    // suficiente data en ventana, el cómputo devuelve confidence='low' o
    // value=null (insufficient_data), NO un valor estimado.
    //
    // PII: el cómputo NO lee texto del estudiante ni respuestas Leo. Cuenta
    // eventos canónicos (`leo_*`) y agrega por payload.pedagogicalObjective
    // (clasificación determinística pre-existente en classifyPedagogicalObjective).
    // ──────────────────────────────────────────────────────────────────────

    { id: 'mediacion_leo',
      source_events: ['leo_interaction_started','leo_interaction_completed'],
      formula: 'count(leo_interaction_started) por user por ventana',
      window: '7d/28d', scope: 'user',
      utility: 'frecuencia de mediación pedagógica solicitada por el lector',
      saber_pisa: 'Saber: búsqueda de andamiaje',
      confidence_now: 'medium',
      notes: 'OBSERVADA — no implica comprensión, solo uso del andamiaje. Threshold mínimo: ≥3 interacciones para confidence medium.' },

    { id: 'inferencia_observada',
      source_events: ['leo_evidence_recorded'],
      formula: 'count(leo_evidence_recorded where pedagogicalObjective=inferential) / total leo_evidence_recorded',
      window: '28d', scope: 'user',
      utility: 'proporción de interacciones que generaron evidencia de objetivo inferencial',
      saber_pisa: 'PISA: integración e interpretación (proxy)',
      confidence_now: 'low',
      notes: 'OBSERVADA — la evidencia inferencial fue clasificada por classifyPedagogicalObjective, no por el modelo entendiendo la respuesta del estudiante. NO afirma comprensión inferencial.' },

    { id: 'metacognicion_observada',
      source_events: ['leo_evidence_recorded'],
      formula: 'count(leo_evidence_recorded where pedagogicalObjective=metacognitive) / total leo_evidence_recorded',
      window: '28d', scope: 'user',
      utility: 'proporción de interacciones con evidencia metacognitiva (reflexión sobre la lectura)',
      saber_pisa: 'Saber: metacognición lectora (proxy)',
      confidence_now: 'low',
      notes: 'OBSERVADA — refleja que la interacción se clasificó como metacognitiva, no que el estudiante reflexionó genuinamente. Datos insuficientes con menos de 5 evidencias por ventana.' },

    { id: 'emocion_observada',
      source_events: ['leo_evidence_recorded'],
      formula: 'count(leo_evidence_recorded where pedagogicalObjective=emotional) / total leo_evidence_recorded',
      window: '28d', scope: 'user',
      utility: 'proporción de interacciones con foco emocional (no es medición de emoción real del lector)',
      saber_pisa: 'NO aplica — no hay marco evaluativo establecido',
      confidence_now: 'low',
      notes: 'OBSERVADA — JAMÁS infiere emoción real del estudiante. Solo cuenta interacciones cuyo objetivo pedagógico fue emocional (e.g., el estudiante usó Leo para hablar de cómo se sintió leyendo). NO usar para diagnóstico afectivo.' },
]);

export const SIGNAL_IDS = Object.freeze(SIGNALS.map(s => s.id));
export function getSignal(id) { return SIGNALS.find(s => s.id === id) ?? null; }
