# AULA VIVA — PASO 3 · AUDITORÍA PEDAGÓGICA PRE-IMPLEMENTACIÓN

> **Mandato §4 del plan maestro PASO 3.** Antes de programar, mapear con
> precisión lo que PASO 2 ya materializa y juzgar — señal por señal — qué es
> **confiable hoy**, qué es **vanity**, qué es **sobreinferencia**.
>
> Premisa de diseño: el motor que construiremos sólo puede usar señales que
> aquí queden marcadas **CONFIABLE** o **CONFIABLE CON CAVEAT**. Las "PENDING"
> generan recomendaciones DESCRIPTIVAS, no accionables.

---

## 1. Mapa de lo materializado HOY (PASO 2)

### 1.1 `signal_snapshots` por (scope_type, scope_id, signal_id, period='28d')

| `signal_id`               | Confidence formal (PASO 1) | Computado real (`signalCompute.mjs`)              | Veredicto                |
|---------------------------|----------------------------|----------------------------------------------------|--------------------------|
| `continuidad_semanal`     | medium                     | ✅ real (`distinct_days/7`)                        | **CONFIABLE**            |
| `tiempo_efectivo_lectura` | high                       | ✅ real (suma elapsedMs)                           | **CONFIABLE**            |
| `abandono_temprano`       | medium                     | ✅ real (early_abandons / starts)                  | **CONFIABLE CON CAVEAT** |
| `diversidad_lectora`      | high                       | ✅ real (distinct contentId)                       | **CONFIABLE CON CAVEAT** |
| `persistencia`            | medium                     | ✅ real ((resumed+completed)/(r+c+a))              | **CONFIABLE CON CAVEAT** |
| `profundidad_sesion`      | medium                     | ⏳ stub                                            | **PENDING**              |
| `recuperacion_tras_abandono` | medium                  | ⏳ stub                                            | **PENDING**              |
| `lectura_autonoma`        | medium                     | ⏳ stub                                            | **PENDING**              |
| `concentracion`           | medium                     | ⏳ stub                                            | **PENDING**              |
| `relectura`               | medium                     | ⏳ stub                                            | **PENDING**              |
| `uso_audio`               | high                       | ⏳ stub                                            | **PENDING (eventos OK)** |
| `uso_accesibilidad`       | high                       | ⏳ stub                                            | **PENDING (eventos OK)** |
| `dificultad_probable`     | low                        | ⏳ stub                                            | **NO USAR (low conf)**   |
| `engagement`              | medium                     | ⏳ stub (parcialmente en `profile.engagement_score`)| **CONFIABLE CON CAVEAT** |
| `fluidez_inferida`        | low                        | ⏳ stub                                            | **NO USAR (low conf)**   |

### 1.2 `user_reading_profiles`

| Campo                | Origen                                              | Hoy |
|----------------------|-----------------------------------------------------|-----|
| `fluidez_score`      | `null` (requiere mapa contenido→palabras)          | **NULL — no inferir** |
| `persistencia_score` | `signals.persistencia.value`                       | **OK** |
| `autonomia_score`    | `null` (stub)                                       | **NULL — no inferir** |
| `concentracion_score`| `null` (stub)                                       | **NULL — no inferir** |
| `diversidad_score`   | `n(distinct_contents, 10)` — 10 = 1.0              | **OK con CAVEAT (catálogo grande sesga)** |
| `engagement_score`   | `avg(continuidad, n(tiempoMin, 60))`               | **OK con CAVEAT (60min = 1.0 es arbitrario)** |
| `abandono_risk`      | `abandono*0.7 + (1-continuidad)*0.3` clamp [0,1]   | **OK — fórmula determinística auditable** |
| `last_active_at`     | `max(server_ts)` en historia 28d                   | **OK** |

### 1.3 `cohort_rollups`

Hoy sólo: `('all','global','28d','active_users') = count(user_reading_profiles)`.

**Falta para PASO 3:** rollups por `group` (curso) y `school` (organización),
y métricas accionables: `at_risk_users`, `avg_continuidad`, `avg_diversidad`,
`active_users_delta_vs_prev_period`.

### 1.4 `materializer_state`

Singleton `aula_viva_pedagogical_v1` con `last_event_id` (watermark),
`lag_events`, `lag_seconds`, `degraded`, `last_error`.
Read API: `insightReader.isReady()` consulta esto.

### 1.5 Notifications (`insight_notifications` en `insightsStore`)

Hoy: 1 sola regla emite — `risk_abandono` (severity `warning`) cuando
`abandono_risk ≥ 0.7`. Dedupe por `hasPendingNotification(key, type)`.
Flush POST-COMMIT (resuelto en PASO 2 §8b).

**Falta para PASO 3:** prioritización (info/moderate/high/critical),
explicabilidad estructurada, expiración automática.

---

## 2. Respuestas a las preguntas obligatorias del §4

### ¿Qué señales son suficientemente confiables?
- `continuidad_semanal`, `tiempo_efectivo_lectura`, `diversidad_lectora` (con
  caveat tamaño-de-catálogo), `persistencia` (con caveat de denominador chico),
  `abandono_temprano` (con caveat de progress=undefined → cuenta como early).
- Composite: `abandono_risk` (determinístico, auditable).

### ¿Qué señales son todavía débiles?
- `fluidez_inferida` (requiere mapa palabras/contenido).
- `dificultad_probable` (ponderación multifactor sin calibrar).
- `lectura_autonoma`, `concentracion`, `relectura`, `recuperacion_tras_abandono`
  (stub: el evento existe en el registry pero el cómputo está diferido).

### ¿Qué métricas tienen valor pedagógico real?
- **Continuidad semanal** → indicador directo de hábito. Lo más accionable.
- **Tiempo efectivo** → volumen real (descuenta pausas/visibilidad oculta).
- **Diversidad lectora** → cobertura. Visualiza qué docente no rota géneros.
- **Persistencia** → tasa real de terminación frente a abandono.
- **Abandono temprano + abandono_risk** → señal de intervención.

### ¿Qué métricas son vanity?
- Conteo total de eventos.
- "Sesiones iniciadas" sin tiempo efectivo asociado.
- "active_users" sin distinción entre activo-real vs `last_active_at < 7d`.
- Cualquier ratio cuyo denominador sea < 5 — ruido puro (la fórmula ya
  marca `confidence: 'low'` en esos casos; el motor debe respetarlo).

### ¿Qué inferencias ya pueden hacerse?
- **Riesgo de abandono** (composite determinístico, hay datos).
- **Hábito sostenido** (continuidad alta + tiempo efectivo).
- **Invisibilidad prolongada** (last_active_at > N días + profile no recién creado).
- **Bajo volumen lectura** (tiempo_efectivo bajo + sesiones cortas).
- **Concentración temática** (diversidad baja sostenida).
- **Recuperación / mejora** (delta entre snapshot actual y N días atrás).

### ¿Qué inferencias NO deben hacerse todavía?
- **NUNCA** "comprensión lectora" sin assessment estructurado.
- **NUNCA** "fluidez" sin mapa palabras/contenido validado.
- **NUNCA** "nivel cognitivo / capacidad / desorden" (prohibido §8).
- **NUNCA** "engagement_score 0.6 = mala lectora" — el score sólo indica
  baja exposición observada, no juicio cognitivo.
- **NUNCA** comparaciones individuo↔individuo presentadas como ranking.
- **NUNCA** predicciones de futuro académico (Saber/PISA proxy ≠ predicción).

### ¿Qué datos faltan?
- Taxonomía de contenidos (género, dificultad, autor) — bloquea `diversidad`
  como cobertura cualitativa y `dificultad_probable`.
- Mapa palabras/contenido — bloquea `fluidez_inferida`.
- Volumen real de eventos `accessibility_mode_*`, `tts_*`, `immersive_visibility_stall`
  — el contrato existe, el cómputo espera tráfico.
- Group→User membership consolidada en read model — hoy `cohort_rollups`
  sólo agrega 'all/global'. Para cohorts reales necesitamos join contra
  `groups_db.json` o `group_memberships` materializadas.

### ¿Qué señales sirven para Saber/PISA?
- **PISA-engagement composite:** `continuidad_semanal` + `tiempo_efectivo` +
  `engagement_score`.
- **PISA-time-on-task:** `tiempo_efectivo_lectura`.
- **Saber-hábito:** `continuidad_semanal` + `construccion_habito` derivado.
- **Saber-persistencia:** `persistencia` + `recuperacion_tras_abandono`.
- **PISA-range-of-materials:** `diversidad_lectora` (necesita taxonomía
  para volverse cualitativa).

### ¿Qué señales sirven para intervención?
- **DIRECTAS:** `abandono_risk`, `continuidad_semanal`, `tiempo_efectivo`,
  `diversidad`, `persistencia`, `last_active_at` (invisibilidad).
- **DERIVADAS LONGITUDINALES** (necesitamos historia de snapshots):
  `delta_continuidad_28d`, `delta_engagement_28d`, `tendencia`.

### ¿Qué señales sirven para IA futura?
Todas, **siempre que la persistencia sea limpia y reconstruible**.
Específicamente PASO 3 debe asegurar:
- `pedagogical_recommendations` con `rule_ids` + `confidence` + `signals_used`
  (labels para entrenamiento futuro).
- `pedagogical_interventions` con `outcome` (label supervisado natural:
  ¿la recomendación funcionó?).
- Snapshots históricos no-destructivos (timeline reconstruible).

---

## 3. Reglas explícitas vs `json-rules-engine` — DECISIÓN

| Criterio                       | Custom (puro JS)                         | json-rules-engine            |
|--------------------------------|------------------------------------------|------------------------------|
| Auditabilidad por docente      | ✅ `if (x < 0.3 && y < 0.5)` legible     | ⚠️ JSON DSL menos directo    |
| Explicabilidad estructurada    | ✅ regla retorna `{reasons, signals}`    | ⚠️ requiere event handlers   |
| Deps nuevas                    | ✅ cero                                  | ❌ +1 dep                    |
| Performance                    | ✅ <1µs por regla                        | ✅ similar (overhead bajo)   |
| Hot-reload de reglas en runtime| ⚠️ requiere code-deploy                  | ✅ permite JSON dinámico     |
| Test unitario directo          | ✅ funciones puras                       | ⚠️ instancia engine en test  |
| Riesgo de complejidad          | ✅ explícito                             | ⚠️ DSL puede esconder        |

**VEREDICTO:** **custom JS puro**. Beneficio principal de json-rules-engine
(hot-reload JSON) no aplica al modelo de governance pedagógica que
queremos (las reglas pasan por code review como código pedagógico
auditable). Documentado para futuro: si Aula Viva necesitara que
coordinadores editen reglas vía UI, se reevaluaría.

---

## 4. Mapa de RIESGOS pedagógicos a vigilar en PASO 3

| Riesgo | Mitigación obligatoria |
|---|---|
| **Sobreinferencia** ("este niño no entiende") | Cada recomendación lleva `explanation` que cita SEÑALES observadas, no inferencias cognitivas. Vocabulario controlado (ver §6 abajo). |
| **Etiquetado clínico/psicológico** | Lista negra explícita de vocabulario prohibido (TDAH, dislexia, "déficit"...). El sistema NO genera estas etiquetas. |
| **Ranking interno** | Las cohorts comparan **grupos contra promedio institucional**, NUNCA individuo↔individuo. |
| **Profecía autocumplida** | `severity` nunca `critical` para señales con `confidence: 'low'`. `confidence < 0.3` → no se persiste recomendación. |
| **Datos viejos como verdad** | `expires_at` obligatorio en `pedagogical_recommendations`. UI debe marcar "stale" si `now > expires_at`. |
| **Spam de notificaciones** | Dedupe por `(scope, rule_id, status=active)`. Severity-aware: `info` no notifica, sólo aparece en dashboard. |
| **Cohort invisibilidad** | Cohort report explícitamente lista "usuarios sin actividad reciente" — visibilizar lo invisible es función pedagógica del sistema. |

---

## 5. Vocabulario PERMITIDO y PROHIBIDO

### Permitido (observacional)
- "sesiones cortas observadas en las últimas 28d"
- "continuidad semanal baja en la última ventana"
- "no se registra actividad desde hace N días"
- "mayor uso de modo audio en este período"
- "concentración temática en un solo contenido"
- "abandono temprano frecuente — considerar mediación guiada"

### **PROHIBIDO** (clínico / cognitivo / predictivo)
- "déficit", "trastorno", "dislexia", "TDAH", "discapacidad"
- "bajo nivel cognitivo", "no comprende", "incapaz"
- "predice fracaso", "alto riesgo académico"
- "atención reducida" (sin más matiz)
- "lector lento" / "lector rápido" como etiqueta de persona

El motor `pedagogicalRules.js` jamás emite estas cadenas. Cualquier PR
que las introduzca falla la regla de revisión.

---

## 6. Definición operacional de las 8 reglas que SÍ se implementan

| Regla | Severidad | Condición (todas en perfil `28d`) | Confidence formula | Recomendación |
|---|---|---|---|---|
| `abandono_alto` | high | `abandono_temprano ≥ 0.6` AND `continuidad ≤ 0.3` | `abandono*0.6 + (1-cont)*0.4` | lectura_guiada |
| `fatiga_lectora` | moderate | `tiempo_efectivo < 30min` AND `abandono ≥ 0.4` AND `continuidad ≤ 0.4` | `0.5 + (1-cont)*0.3` | audio + pausas |
| `invisibilidad_prolongada` | critical | `last_active_at` antiguedad > 14d AND `last_active_at != null` | constante `0.95` | restablecer_vinculo (alerta docente) |
| `alta_autonomia` | info | `persistencia ≥ 0.7` AND `continuidad ≥ 0.6` AND `diversidad ≥ 3` | `(p + c + d_norm) / 3` | exploracion_generos |
| `diversidad_baja` | moderate | `diversidad_lectora ≤ 2` (count absoluto) AND `tiempo_efectivo ≥ 30min` | constante `0.6` | sugerir_rotacion |
| `deterioro_continuidad` | moderate | `continuidad_actual - continuidad_previa ≤ -0.25` (delta vs snapshot >7d atrás) | abs(delta) | mediacion_renfuerzo |
| `mejora_destacada` | info | `engagement_actual - engagement_previo ≥ 0.25` | abs(delta) | reconocer_progreso |
| `habito_emergente` | info | `continuidad ≥ 0.5` AND nuevo (`last_active_at` < 14d atrás) AND no había snapshot anterior | constante `0.55` | reforzar_habito |

Reglas 6, 7, 8 requieren historia → el `interventionEngine` debe consultar
snapshot anterior. Para PASO 3 se implementa con `signal_snapshots` (que
ya guarda `updated_at`), comparando snapshot actual vs anterior si lo hay.

---

## 7. Estrategia de explicabilidad (obligatoria, §7)

Cada `pedagogical_recommendations` row almacena en `explanation_json`:

```json
{
  "rule_id": "abandono_alto",
  "rule_version": 1,
  "signals_used": [
    {"id": "abandono_temprano", "value": 0.71, "confidence": "medium",
     "observed_at": 1779231400000},
    {"id": "continuidad_semanal", "value": 0.22, "confidence": "high",
     "observed_at": 1779231400000}
  ],
  "reasons": ["abandono_temprano_alto", "continuidad_baja"],
  "explanation": "Se observan sesiones que se interrumpen antes de progresar y baja continuidad semanal en la última ventana de 28d.",
  "recommended_action": "lectura_guiada",
  "vocabulary_class": "observational",
  "computed_at": 1779231410000
}
```

`vocabulary_class` siempre `"observational"` en PASO 3 — nunca `"diagnostic"`.

---

## 8. Lo que NO automatizamos

- **Mensajes a estudiantes:** el docente decide qué comunicar.
- **Cambios de configuración del lector** (modo, accesibilidad): el sistema
  *sugiere*, el docente aplica.
- **Modificación de plan de lectura:** sugerencia, no acción.
- **Notificación a familia:** fuera de alcance PASO 3.
- **Etiquetas en el perfil del estudiante:** no se "marca" al estudiante con
  ninguna etiqueta visible para él/ella; las recomendaciones son para el
  docente.

---

## 9. Listo para implementar

Con este audit firmado, las decisiones de implementación PASO 3 son:

1. **Nueva extensión schema:** `pedagogyDbExt.mjs` con
   `pedagogical_recommendations`, `pedagogical_interventions`,
   `pedagogical_risk_history` (insights.db, mismo PRAGMA pattern).
2. **Engine puro:** `pedagogicalRules.js` con 8 reglas listadas en §6, cada una
   una función pura `(profile, signals, previousSnapshot?) → ruleResult | null`.
3. **Orquestador:** `interventionEngine.mjs` con `runOnce()` + `getStatus()` +
   default-OFF (`INTERVENTION_ENGINE_ENABLED`).
4. **Reader extension:** `insightReader.mjs` añade `getRecommendations`,
   `getRiskHistory`, `getProfileTimeline`, `getCohortComparison`.
5. **Métricas (§19):** 6 contadores/gauges, cardinalidad fija.
6. **Healthcheck (§20):** `checks.intervention_engine` con backlog y degraded.
7. **Tests (§21):** 15+ checks aislados con env tmp dbs.
