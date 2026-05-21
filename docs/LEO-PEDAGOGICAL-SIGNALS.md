# Leo Pedagogical Signals — Fase 2B LEC

> **Estado:** Fase 2B — Leo events alimentan signal extraction real.
>
> Continuación de Fase 2A (`LEO-LONGITUDINAL-EVENTS.md`): los 4 eventos
> `leo_*` que llegan a events.db ahora son consumidos por `signalCompute.mjs`
> y derivan 4 señales pedagógicas observables.

## 1. Principio rector

Chibalete+ **NUNCA debe afirmar que el estudiante comprende**. Estas
señales son **OBSERVADAS** — clasificaciones del objetivo pedagógico de
la interacción Leo, NO juicios sobre la cognición del lector. El sufijo
`_observada` está intencionalmente en los IDs para que ningún consumidor
las confunda con métricas de comprensión.

## 2. Qué se agregó

| Pieza | Ubicación | Cambio |
|---|---|---|
| 4 signals nuevas | `server/analytics/signals.js` | `mediacion_leo`, `inferencia_observada`, `metacognicion_observada`, `emocion_observada` con `source_events`, `formula`, `confidence_now='low'`, `notes` con caveat explícito |
| Cómputo real | `server/services/signalCompute.mjs` | Procesa eventos `leo_interaction_started` y `leo_evidence_recorded`. Gated por `LEO_SIGNAL_EXTRACTION_ENABLED`. |
| Schema extendido | `server/analytics/eventRegistry.js` | `leo_evidence_recorded` ahora acepta `pedagogicalObjective?` opcional. Backward-compat (`.strip()` + `optional`). |
| Emitter | `server/leoBackboneEmitter.mjs` | `emitEvidenceRecorded` propaga `pedagogicalObjective` al payload cuando se pasa. |
| Orquestador | `server/leoOrchestrator.js` | Pasa `evidenceEntry.pedagogicalObjective` (ya calculado por `classifyPedagogicalObjective`) al emitter. |
| Catálogo objetivos | `server/analytics/objectives.js` | `comprension_lectora`, `lectura_autonoma`, `lectura_critica` declaran las nuevas signals en `required_signals`. `data_gaps` documenta que son OBSERVADAS. |
| Flag | `server/lib/flags.js` | `LEO_SIGNAL_EXTRACTION_ENABLED` (default OFF). |
| Tests | `server/__test__/leoPedagogicalSignals.test.js` | 70 asserts. |

## 3. Las 4 signals

### 3.1 `mediacion_leo`
- **Fórmula:** `count(leo_interaction_started)` en ventana.
- **Confidence:** `low <3`, `medium 3-9`, `high ≥10` interacciones.
- **Caveat:** alta frecuencia **NO** implica baja autonomía — puede reflejar lector activo que busca andamiaje. El objetivo `lectura_autonoma` declara este caveat en `data_gaps`.
- **Útil para:** detectar lectores que solicitan mediación frecuente (insumo para PASO 3 reglas de intervención futuras).

### 3.2 `inferencia_observada`
- **Fórmula:** `count(leo_evidence con pedagogicalObjective='inferential') / total_evidence` en ventana.
- **Confidence:** `low` siempre (es proxy, no juicio).
- **Threshold:** `<5 evidencias en ventana → insufficient_data: true, value: null`.
- **Caveat:** la evidencia fue clasificada por `classifyPedagogicalObjective` (función determinística que mira interactionType + payload), **no por el modelo entendiendo la respuesta del estudiante**. No afirma comprensión inferencial.

### 3.3 `metacognicion_observada`
- **Fórmula:** `count(leo_evidence con pedagogicalObjective='metacognitive') / total_evidence`.
- **Confidence:** `low` siempre.
- **Threshold:** mismo (`<5 → insufficient_data`).
- **Caveat:** refleja que la interacción se clasificó como metacognitiva, **no que el estudiante reflexionó genuinamente**.

### 3.4 `emocion_observada`
- **Fórmula:** `count(leo_evidence con pedagogicalObjective='emotional') / total_evidence`.
- **Confidence:** `low` siempre.
- **Threshold:** mismo.
- **Caveat máximo:** **JAMÁS infiere emoción real del estudiante**. Solo cuenta interacciones cuyo objetivo pedagógico fue emocional (e.g., el estudiante usó Leo para hablar de cómo se sintió). NO usar para diagnóstico afectivo. El `meta.caveat` lo dice explícitamente en cada snapshot.

## 4. Cómo se conectan a los objetivos

| Objetivo | Signals nuevas referenciadas |
|---|---|
| `comprension_lectora` | `inferencia_observada`, `metacognicion_observada` |
| `lectura_autonoma` | `mediacion_leo` (con caveat) |
| `lectura_critica` | `inferencia_observada`, `metacognicion_observada` |
| Otros 5 objetivos | Sin cambios — siguen con sus signals base |

`data_gaps` en cada objetivo afectado documenta el caveat de OBSERVADA.

## 5. Activación segura

### 5.1 Pre-requisitos

| Pre-check | Cómo |
|---|---|
| Fase 2A activa (`LEO_EVENTS_BACKBONE_ENABLED=1`) | Sin esto NO hay eventos Leo en events.db → signals devuelven null/pending igual. |
| Pipeline `npm run test:analytics` verde (9 suites) | CI gate antes de promover |
| `INSIGHTS_MATERIALIZER_ENABLED=1` (PASO 2) | Para que las signals se persistan a `signal_snapshots` |

### 5.2 Activación

```bash
# /opt/chibaleteplus/.env (Docker Compose)
LEO_EVENTS_BACKBONE_ENABLED=1
LEO_SIGNAL_EXTRACTION_ENABLED=1
INSIGHTS_MATERIALIZER_ENABLED=1
```

Restart staggered:

```bash
docker compose restart chibalete_api_1   # validar logs
docker compose restart chibalete_api_2
```

### 5.3 Verificación post-activación

```sql
-- Eventos Leo llegando a events.db (esperado tras ~5 interacciones):
SELECT event, COUNT(*) FROM events WHERE mode='leo' GROUP BY event;

-- Signals materializadas (esperado tras próximo run del materializer):
SELECT signal_id, COUNT(*), AVG(metric_value)
FROM signal_snapshots
WHERE signal_id LIKE '%_observada' OR signal_id = 'mediacion_leo'
GROUP BY signal_id;
```

### 5.4 Rollback

```bash
LEO_SIGNAL_EXTRACTION_ENABLED=0    # las 4 signals vuelven a 'pending'
docker compose restart chibalete_api_1 chibalete_api_2
```

Las signals previamente computadas quedan en `signal_snapshots` (no se borran). Para limpiar: query manual.

## 6. Relación con PASO 3 / PASO 6

| Engine | Cambio en este sprint |
|---|---|
| `interventionEngine` (PASO 3) | **Cero cambios.** Sigue con sus 8 reglas determinísticas, todas verdes (29/29 tests). Las nuevas signals están en `signal_snapshots` listas para futura regla `rule_uso_leo_excesivo` o equivalente — wiring de regla es decisión separada. |
| `outcomeEngine` + 5 engines (PASO 6) | **Cero cambios.** Siguen leyendo `signal_snapshots`; cuando las signals Leo aparezcan, ya las consumen como cualquier otra (307/307 tests intactos). |
| `insightMaterializer` | **Cero cambios** estructurales. `signalCompute` extendido — el materializer sigue su loop habitual. |
| Aula Viva UI | **Cero cambios.** Endpoints `/api/groups/:id/diagnosis` y `/api/students/:id/status` siguen con su lógica heurística. UI consumirá signals cuando se decida cablear (no en este sprint). |

## 7. Garantías

### Sin PII en signals
- Test `[9]` valida que ningún `meta` contiene `text`, `answer`, `message`, `prompt`, `response`, `body`, `userInput`.
- El cómputo NUNCA lee `leo_evidence_db.json` (que sí tiene previews de texto). Solo lee events.db payloads que ya excluyen texto libre.
- Las signals solo guardan: `count`, `total`, `ratio`, `threshold`, `insufficient_data`, `caveat`.

### Sin scoring mágico
- Cada fórmula es un conteo o ratio simple, documentada en `signals.js`.
- Confidence es heurística declarada (`<3 / 3-9 / ≥10` para `mediacion_leo`; `low` siempre para las 3 ratio-based).
- `insufficient_data: true` cuando `total_evidence < 5` — value pasa a null, no se inventa valor.

### Sin afirmaciones pedagógicas excesivas
- Sufijo `_observada` en 3 de 4 IDs hace explícito que es observación, no juicio.
- `notes` en cada signal documenta el caveat.
- `confidence_now='low'` en las 3 ratio-based reconoce que son proxies.
- `meta.caveat` en `emocion_observada` reitera "no infiere emoción real".

### Sin duplicación
- 4 nuevas signals viven en el catálogo único (`signals.js`).
- Cómputo en el módulo único (`signalCompute.mjs`).
- Storage en la tabla única (`signal_snapshots`).
- Ningún store nuevo, ningún event bus nuevo.

### Sin loops, sin memory growth
- `computeUserSignals` es pura. Sin estado entre calls.
- El materializer ya tiene watermark — no re-procesa eventos viejos.
- events.db sigue con dedup ULID (Fase 2A).

## 8. Tests ejecutados

```bash
node server/__test__/leoPedagogicalSignals.test.js   # 70 ✓ / 0 ✗
npm run test:analytics                               # 9 suites encadenadas:
#   analyticsCanon      46 ✓
#   insightMaterializer 24 ✓
#   pedagogicalEngine   29 ✓
#   scalability         45 ✓
#   aulaVivaOperational 31 ✓
#   outcomesEngine      40 ✓
#   aulaVivaInstitutional 44 ✓
#   leoBackboneEmitter  60 ✓  (Fase 2A)
#   leoPedagogicalSignals 70 ✓  (Fase 2B — ESTE sprint)
#                       ───────
#                       389 ✓ / 0 ✗
npm run test:reading-runtime                         # 162 ✓ / 0 ✗  (Fase 1+2 CRR sin regresión)
```

## 9. Pendientes (próximas fases)

- **Aula Viva UI** consume las nuevas signals (decisión separada — actualmente la UI no consume `signal_snapshots` directamente).
- **PASO 3 reglas Leo-aware**: agregar reglas tipo `uso_leo_muy_alto`, `evidencia_metacognitiva_creciente`. Las reglas existen como código declarativo — agregar una nueva es ~15 líneas + test.
- **PASO 6 cohortes Leo-intensity**: `cohortBuilder` puede agregar tipo `leo_intensity` (alto/medio/bajo uso de Leo). Trivial cuando se decida.
- **Wiring de `leo_profile_updated` y `leo_recommendation_generated`**: pendientes de Fase 2A; stubs ya existen en el emitter.
