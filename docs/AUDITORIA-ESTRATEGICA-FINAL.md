# CHIBALETE+ · AUDITORÍA ESTRATÉGICA PROFUNDA
## Sistema pedagógico longitudinal institucional · 2026-05-19

**Roles asumidos:** Principal Architect · Pedagogical Systems Architect · Cognitive Runtime Auditor · Longitudinal Learning Systems Researcher · Runtime Reliability Lead · Institutional Governance Architect · Reading Analytics Specialist · Accessibility & Reading Inclusion Auditor

**Premisa:** la auditoría técnica anterior (despliegue) fue suficiente para *runtime*. Esta auditoría reinterpreta Chibalete+ como **infraestructura longitudinal institucional de aprendizaje lector** — no como producto SaaS. La pregunta central es **¿CÓMO leen?**, no *qué* ni *cuánto*. Las respuestas son verificadas en código con file:line.

---

## VEREDICTO EN UNA LÍNEA

**Chibalete+ tiene la mejor arquitectura pedagógica longitudinal que he visto sin encender — pero está apagada.**

Tres motores PASO 3 / 6 / 7 (intervención, outcomes, learnings) están **escritos, testados, documentados, con healthchecks y métricas Prometheus**, pero **default-OFF sin scheduler activo en `.env` ni en `server.js`**. Leo está implementado como buddy contextual robusto pero **opera como silo paralelo** — su evidencia nunca llega a `events.db`. Los 8 objetivos pedagógicos están mapeados pero **solo 3 tienen precisión observacional alta** (persistencia, diversidad, hábito). El sistema observa **cuánto leen con precisión**; observa **cómo leen** apenas en dos dimensiones: continuidad y abandono. Comprensión, inferencia, crítica, reflexión y relación emocional siguen siendo **proxies pobres**. El modo accesible vive en un backbone v1 paralelo **desconectado de los 8 objetivos**. La biblioteca como scope es **vapor explícitamente reconocido** en el código. La continuidad cross-modal funciona técnicamente pero **nunca se interpreta pedagógicamente**.

**Diferenciador real**: la disciplina con que el equipo construyó la **infraestructura de honestidad estadística** (vocab causal bloqueado mecánicamente, `evidence_level` separado de `confidence`, `insufficient_data` como label de primer nivel, hints observacionales testados) — eso no se ve en SaaS educativos comerciales. Es un activo cultural más que técnico.

---

## FASE 1 · RELECTURA ARQUITECTÓNICA POR CAPAS COGNITIVAS

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ CAPA 1 — EXPERIENCIA DE LECTURA (4 motores activos + 1 canary)               │
│                                                                              │
│   Inmersivo V1 ─── sincronía audio↔texto, observable único:                  │
│     pages/VisorInmersivo.tsx (3042 líneas, hardening M-5.4.* completo)       │
│     emite: immersive_visibility_stall  ← detecta distracción real            │
│             immersive_sentence_committed ← sync drift instrumental           │
│                                                                              │
│   Inmersivo V2 ─── refactor arquitectónico, MISMO propósito pedagógico       │
│     engines/ImmersiveRuntime.mjs (canary, gated)                             │
│                                                                              │
│   Guiado (Modo Texto) ─── agencia + mediación Leo OPCIONAL                   │
│     pages/VisorTexto.tsx (1355 líneas)                                       │
│     emite: guided_step_completed ← solo si Leo activado                      │
│                                                                              │
│   Accesible (a11y) ─── único modo WCAG/EPUB-aware                            │
│     pages/VisorAccesible.tsx (segmentación adaptativa, focus rule)           │
│     emite: a11y.session_start ← AL BACKBONE V1 SEPARADO                      │
│             /api/v1/events  ← NO entra en eventRegistry.js                   │
│             ─── DESCONECTADO de los 8 objetivos pedagógicos                  │
│                                                                              │
│   PDF ─── facsímil legacy, CERO pedagógico                                   │
│     pages/VisorPDF.tsx ← solo page-level, sin sentence granularity           │
│                                                                              │
│   Álbum ─── interacción visual                                               │
│     pages/VisorAlbum.tsx ← emite album_interaction (regionId) pero           │
│             sin criterios definidos de "lectura exitosa" → ruido potencial   │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ (continuidad técnica vía globalPercentage,
                                    │  cero interpretación pedagógica del cambio)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ CAPA 2 — MEDIACIÓN COGNITIVA (Leo · sub-sistema 7 layers)                    │
│                                                                              │
│   D1 leoOrchestrator   ← dispatcher único                                    │
│   D2 leoMemoryService  ← memoria sesión userId__contentId (sin decay)        │
│   D3 leoICDLIBridge    ← READ-ONLY de ICDLI (one-way feedback gap)           │
│   D4 leoEvidenceService← logs estructurados → leo_evidence_db.json (NO db)   │
│   D5 leoSequenceService← 4 objetivos × 2 steps (literal→inferential→reflex)  │
│   D6 leoMediatorView   ← GET /api/leo/mediator/student/:userId               │
│                          ⚠️ EXISTE pero AulaViva.tsx NO LO LLAMA             │
│   D7 leoActivationServ ← outputs re-engagement (NO auto-delivered)           │
│                                                                              │
│   ❌ leo_interaction_started/completed NUNCA persistido a events.db          │
│   ❌ Leo evidence NO alimenta signals/objectives                             │
│   ❌ getPriorityHints PASO 6 NO informa a Leo                                │
│   ❌ pedagogical_recommendations NO ajusta scaffolding de Leo                │
│                                                                              │
│   Veredicto: buddy lector longitudinal-en-sesión, NO mediador longitudinal   │
│              institucional. Episodic, no continuous.                         │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │ (silo paralelo)
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ CAPA 3 — OBSERVABILIDAD LONGITUDINAL (Aula Viva PASO 1-7)                    │
│                                                                              │
│   ✓ events.db (canon write log) ........... ACTIVO                           │
│   ✓ insights.db (read model) ............... ACTIVO                          │
│     ✓ signal_snapshots (UPSERT, NO append) . sin historia                    │
│     ✓ user_reading_profiles ................ snapshot único                  │
│     ✓ cohort_rollups ('all','global') ...... agregado global solo            │
│                                                                              │
│   ⚠️  PASO 3 interventionEngine .... CÓDIGO LISTO · ENGINE OFF              │
│       INTERVENTION_ENGINE_ENABLED NO en .env  → recomendaciones STALE        │
│                                                                              │
│   ⚠️  PASO 4 rollupsEngine ......... CÓDIGO LISTO · OFF                     │
│       ROLLUPS_ENABLED NO en .env  → daily/weekly/monthly nunca corren        │
│   ⚠️  PASO 4 featureExtractor ..... CÓDIGO LISTO · OFF                      │
│   ⚠️  PASO 4 snapshot_history ..... NUNCA append                            │
│       SNAPSHOT_HISTORY_ENABLED NO en .env  → previousProfile = shallow copy  │
│       → reglas longitudinales (deterioro/mejora_destacada) NUNCA disparan    │
│                                                                              │
│   ⚠️  PASO 5 scheduler ............ start() requiere AULA_VIVA_SCHEDULER_ENA │
│       AULA_VIVA_SCHEDULER_ENABLED NO en .env  → loops NO se inicializan      │
│                                                                              │
│   ⚠️  PASO 6 outcomeEngine ........ CÓDIGO LISTO · OFF                      │
│   ⚠️  PASO 6 cohortBuilder ........ CÓDIGO LISTO · OFF                      │
│   ⚠️  PASO 6 trajectoryAnalyzer ... CÓDIGO LISTO · OFF                      │
│   ⚠️  PASO 6 institutionalLearning . CÓDIGO LISTO · OFF                     │
│   ⚠️  PASO 6 predictivePatterns ... CÓDIGO LISTO · OFF                      │
│                                                                              │
│   ✓ PASO 7 institutionalRouter .... 13 endpoints ACTIVOS                     │
│      pero retornan vacío si engines PASO 6 no llenaron las tablas            │
│                                                                              │
│   ✓ scopeAccess.mjs default-deny ... OPERATIVO + TESTADO (15 combinaciones)  │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ CAPA 4 — GOVERNANCE INSTITUCIONAL                                            │
│                                                                              │
│   Modelo de datos:                                                           │
│     users_db.json [user].colegio: string SINGULAR                            │
│     users_db.json [user].groupIds: array (múltiples grupos OK)               │
│                                                                              │
│   ❌ Multi-organization (1 user = 1 colegio enforced)                        │
│   ❌ Library scope: vapor EXPLÍCITO                                          │
│      cohortBuilder.mjs:153  library: () => ({ users: [], note:              │
│         'library scope no implementado en PASO 6' })                         │
│      scopeAccess.mjs:104    library → return false (admin-only)              │
│   ❌ Sin export-history endpoint (GDPR data portability)                     │
│   ❌ Sin flag minor / consent / age en users_db.json                         │
│   ❌ Sin co-ownership de intervención (transferir si docente abandona)       │
│   ❌ Interinstitutional continuity: schema no soporta                        │
│                                                                              │
│   ✓ groups type ∈ {course, club} funcional                                   │
│   ✓ mediator de múltiples grupos OK                                          │
│   ✓ scope isolation testada (admin/mediator/lector/stranger)                 │
│   ✓ relapse handling: new risk record sin link al previo (by design)         │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Puntos fuertes arquitectónicos (estratégicos)
1. **Separación canon-vs-read-model** (events.db append-only + insights.db materialized). Es la arquitectura correcta para learning analytics longitudinal.
2. **Idempotencia y replay**: `outcomeEngine.rebuildOutcomes()`, `cohortBuilder.runOnce()` con UPSERT → permiten re-derivar el read model sin perder datos.
3. **Vocab causal bloqueado mecánicamente**: `outcomeClassifier.FORBIDDEN_VOCAB` + `containsForbiddenVocab()` validado en 3 sitios de tests. Hostility-to-overpromising arquitectónica.
4. **Default-deny scope isolation** en `scopeAccess.mjs` con tests cross-tenant explícitos.
5. **Reading runtime hardening** (12 invariantes, drift detector, state machine pura, PROGRESS_SAVE guard).

### Puntos ciegos arquitectónicos
1. **Leo es silo paralelo**: no emite events canónicos. La inteligencia conversacional no participa de la inteligencia institucional.
2. **VisorAccesible en backbone v1 separado** (`/api/v1/events`): el modo con mayor intencionalidad pedagógica NO alimenta los 8 objetivos.
3. **Snapshot history nunca encendido**: 3 reglas pedagógicas (deterioro_continuidad, mejora_destacada, habito_emergente con histórico) son código muerto en producción.
4. **Sin scheduler activo**: todos los engines requieren disparo manual o cron externo no documentado.
5. **Sin distinción pedagógica del cambio de modo**: cross-mode reading se trata como continuidad neutra cuando es señal pedagógica relevante (¿abandonó inmersivo por sobrecarga?).

### Ventajas estratégicas reales
1. **Cero deuda de causalidad**: ningún reporte afirma "X causó Y". Cuando llegue regulación / auditoría educativa, ya están protegidos.
2. **Honestidad estadística testada en CI**: cada PR que introduzca vocab clínico rompe los tests.
3. **SQLite WAL + leader election sin Redis**: stack operable por 1 ingeniero, escalable a 5000+ users sin cambio arquitectónico.
4. **Modos de lectura observables emiten señales distintas** (cuando emiten): la arquitectura de eventos canónicos permite distinguir estrategias, aunque el análisis cross-mode aún no exista.

---

## FASE 2 · MODOS DE LECTURA — VERDAD PEDAGÓGICA

### Resumen (auditado en código)

| Modo | Propósito real | Observable único | Objetivos que aporta | Mobile real | A11y real |
|---|---|---|---|---|---|
| **Inmersivo V1** | Sincronía + concentración | `immersive_visibility_stall` (detecta distracción) | 4 (continuidad), 5 (persistencia), 7 (concentración) | ⚠️ autoplay bloqueado en mobile | ❌ no WCAG, sin keyboard nav |
| **Inmersivo V2** | Refactor; mismo propósito | mismos eventos | mismos objetivos | mismo | mismo |
| **Guiado** | Agencia + mediación Leo opcional | `guided_step_completed` (solo si Leo activado) | 1, 2 (comprensión), 3 (crítica) — **si y solo si usa Leo** | ✓ funciona bien | ⚠️ parcial |
| **Accesible** | Lectura asistida WCAG/dislexia | **a11y.session_start a backbone v1 separado** | ❌ NINGUNO (desconectado de objetivos) | ✓ más robusto que otros | ✓ único con diseño a11y intencional |
| **PDF** | Facsímil legacy | `pdf_page_changed` (granularidad página) | 5 (persistencia) genérica solo | ❌ ilegible en phones | ❌ sin ARIA, sin text layer |
| **Álbum** | Interacción visual | `album_interaction` (region) | 7 (emocional) — sin criterios de éxito | ⚠️ regions tiny en phones | ❌ sin alt-text, sin kbd equivalents |

### Hallazgo crítico: continuidad cross-mode existe técnicamente, NO pedagógicamente

**Verificado en código** (`utils/canonicalProgress.ts:39-52` + `server/server.js:2186-2206`):
- `lastInteractedMode` se persiste en `progress_db.json`
- `globalPercentage` es la moneda universal: 50% en inmersivo ≡ 50% en guiado
- El sistema **NUNCA consulta** `lastInteractedMode` para análisis posterior
- **No existe** un evento canónico `mode_changed` ni `reading_strategy_switched`

**Implicación pedagógica**:
- Si Juan empieza en inmersivo a 0%, abandona a 20%, vuelve en guiado y completa al 100%, el sistema interpreta: **una sesión continua exitosa**.
- La realidad pedagógica: **inmersivo no funcionó para Juan; guiado sí.** Información clínicamente relevante perdida.
- Sin instrumentar esto, el sistema no puede responder: ¿qué modo funciona para qué perfil de lector?

### Hallazgo crítico: VisorAccesible vive fuera del registry pedagógico

`pages/VisorAccesible.tsx` + `hooks/useA11yAnalytics.ts` emiten a `/api/v1/events` (backbone v1) con shape como `event: 'a11y.session_start'`. **Ninguno de estos eventos está registrado en `server/analytics/eventRegistry.js`** que define los 74 eventos canónicos PASO 1.

**Consecuencia técnica**: los lectores que más se beneficiarían de instrumentación pedagógica (con discapacidad de lectura impresa, dislexia, ADHD) **no contribuyen señales a Aula Viva**.

**Consecuencia ética**: el sistema sub-representa estructuralmente a los lectores con necesidades de accesibilidad. Riesgo bias.

### Riesgo sobreinstrumentación
PDF y Álbum emiten eventos sin criterios pedagógicos definidos. Sin "qué es lectura exitosa en Álbum", `album_interaction.count` es ruido — métrica que puede *parecer* indicador pero no mide nada interpretable.

### Veredicto Fase 2
**Los modos son estrategias técnicamente diferenciadas (emiten eventos únicos) pero pedagógicamente desintegradas (el análisis cross-mode no existe).** El modo más intencionalmente pedagógico (Accesible) está desconectado del motor de objetivos. El modo más usado en producción (Inmersivo) es el menos accesible. Esta es la contradicción estructural más importante del sistema.

---

## FASE 3 · LEO — VERDAD LONGITUDINAL

### Lo que Leo SÍ es (auditado en `server/leo/*`)
- **Buddy contextual con memoria de sesión robusta**: `leo_memory_db.json` keyed `userId__contentId`, restaurado en re-entry, expone a docente vía `/api/leo/mediator/student/:userId` (D6).
- **Grounded a contenido**: `leoContextBuilder.retrieveStructuredContext()` inyecta anchors + vocabulary + pedagogicalGuide en prompt.
- **Pedagogical stage-aware**: `leoStage.derivePedagogicalStage(progress, anchors)` → 4 estadios (comprehension → interpretation → reflection → creation).
- **ICDLI-driven difficulty adjustment**: `leoICDLIBridge.resolveLeoPedagogicalAdjustment()` lee composite ICDLI → mapea a `inicial|medio|avanzado` (cache 30s).
- **Sequence engine**: `leoSequenceService` con 4 objetivos × 2 steps hardcoded, dedup por interaction count.
- **Multi-surface**: `companion` (modal embebido), `chatbot` (standalone), `recap` (re-engagement).
- **Privacy-safe**: keyed por userId, sin leakage cross-tenant (verificado).

### Lo que Leo NO es (gaps verificados)
| Capacidad | Estado | Evidencia |
|---|---|---|
| Eventos `leo_interaction_started/completed` en events.db | ❌ **NO existen** | `leo_interactions_db.json` = 2 bytes vacío |
| Evidence Leo → ICDLI signals (feedback loop) | ❌ **One-way read** | `leoICDLIBridge.js` lee de metricsService, no escribe |
| Aula Viva consume `/api/leo/mediator/student/:userId` | ❌ **No** | `AulaViva.tsx:419-422` construye leoAdvisor desde dataService local |
| Leo conoce intervenciones registradas por docente | ❌ **No** | sin endpoint `/api/leo/inject-intervention` |
| Leo conoce `pedagogical_recommendations` PASO 3 | ❌ **No** | sin lectura de `pedagogical_recommendations` table |
| Leo ajusta scaffolding con `getPriorityHints` PASO 6 | ❌ **No** | sin import de institutionalLearning |
| Output hallucination guard | ❌ **No** | `leoGuard.js` valida input only, no output |
| Turn limits / cooldown conversacional | ❌ **No** | sin rate limit en `/api/leo/ask` (también es bloqueador de seguridad) |
| Decay temporal de memoria | ❌ **No** | memoria persiste indefinidamente |
| Auto-cleanup secuencias huérfanas | ❌ **No** | activeSequenceId queda stale si user abandona |

### Veredicto Fase 3
**Leo es buddy lector longitudinal-EN-sesión, no mediador longitudinal INSTITUCIONAL.** La integración longitudinal con el resto del sistema (PASO 1-7) no existe: Leo es un sub-sistema paralelo bien diseñado que comparte usuarios pero no inteligencia. Para ser verdadero mediador longitudinal necesita: (1) emitir eventos canónicos, (2) feedback bidireccional ICDLI, (3) conocer intervenciones registradas, (4) output guard contra alucinación, (5) consumer en Aula Viva UI.

**Riesgo pedagógico inmediato**: docentes que usan AulaViva no ven nada de la conversación Leo del estudiante — pierden contexto crítico al planear intervenciones.

---

## FASE 4 · ¿CÓMO LEEN? — INVENTARIO TÉCNICO HONESTO

### Lo que el sistema realmente observa (con confianza ALTA)
| Dimensión | Cómo se observa | Confianza |
|---|---|---|
| **Continuidad semanal** | `distinct(days_with_session) / 7` ventana 28d | **alta** (cómputo robusto) |
| **Tiempo efectivo** | `sum(elapsedMs not paused)` por user/ventana | **alta** (sin proxy) |
| **Abandono temprano** | `early_abandons (progress<10%) / total_starts` | **alta** con `starts ≥ 5` |
| **Concentración (inmersivo)** | streaks de heartbeat sin `immersive_visibility_stall` | **alta** SOLO en inmersivo |

### Lo que el sistema observa con confianza MEDIA
| Dimensión | Limitación |
|---|---|
| **Diversidad lectora** | `distinct(contentId)` — sesgo de tamaño de catálogo |
| **Persistencia** | `(resumed+completed)/(resumed+completed+abandoned)` — denominador chico ruidoso |
| **Profundidad sesión** | `avg(progress_fraction final)` — proxy débil de comprensión |
| **Uso audio / accesibilidad** | conteos básicos, sin interpretación cualitativa |

### Lo que el sistema NO observa (data_gaps documentados en `objectives.js`)
| Objetivo pedagógico | Por qué no | Lo que faltaría |
|---|---|---|
| **Fluidez lectora** | proxy (palabras/min) sin mapa contenido→palabras | mapa léxico + anchors V2 + tasks fluencia opt-in |
| **Comprensión literal** | sin assessment formal | quizzes / micro-tasks Leo verificadas |
| **Comprensión inferencial** | sin instrumentación | prompts Leo específicos + rúbrica |
| **Lectura crítica** | sin marcadores de argumentación | tareas de inferencia/contraargumento |
| **Reflexión e interpretación** | sin assessment | activación productiva D7 Leo no entregada |
| **Relación emocional** | proxy débil (dwell time en imágenes Álbum) | sin instrumentos validados |

### Métricas engañosas potenciales identificadas
1. **`active_users`** sin distinguir "abrió app" vs "leyó >5 min": vanity metric si no se segmenta.
2. **`session_count`** sin tiempo mínimo: una sesión de 30 seg pesa igual que una de 30 min.
3. **`reading_progress` con cualquier mode**: igualar PDF page-flip a sentence-commit inmersivo distorsiona "cuánto leyó".
4. **`abandono_temprano` con `starts < 5`**: ruido puro; signal_compute SÍ aplica `confidence: 'low'` en esos casos (correcto), pero la UI debe filtrarlos.
5. **`engagement_score`**: composite arbitrario (`continuidad * 0.6 + tiempo/60min * 0.4`). 60min como techo es decisión no documentada pedagógicamente.

### Falsas correlaciones a vigilar
- **Tiempo en pantalla ≠ comprensión**: lector lento atento puntúa peor que skim-reader rápido.
- **Diversidad alta ≠ lectura profunda**: lector que abandona muchas obras al inicio aparenta diversidad alta.
- **Continuidad alta ≠ hábito sano**: forzamiento institucional (10 min diarios obligatorios) genera continuidad observable indistinguible de motivación intrínseca.
- **Outcome `improved` por mejora de continuidad post-intervención**: la intervención puede haber causado obediencia, no aprendizaje.

### Veredicto Fase 4
**El sistema observa "cuánto leen" con precisión alta y "cómo leen" apenas en dos dimensiones: continuidad y abandono.** Para responder verdaderamente "cómo leen" hacen falta instrumentos que el sistema reconoce documentalmente como faltantes (quizzes verificados, mapa léxico, prompts Leo instrumentados). **La honestidad arquitectónica al declarar estos gaps en `objectives.js:data_gaps` es un activo poco común.**

---

## FASE 5 · OUTCOME GOVERNANCE LOOP — ESTADO REAL

### Loop completo `signal → intervention → follow-up → persistence → relapse → closure → institutional learning`

| Eslabón | Estado | Evidencia |
|---|---|---|
| **signal generation** | ⚠️ código LISTO · engine OFF | `interventionEngine.runOnce()` requiere `INTERVENTION_ENGINE_ENABLED=1` no seteada |
| **recommendation persistence** | ✓ tabla `pedagogical_recommendations` operativa | UPSERT por scope+rule activo (UNIQUE parcial) |
| **intervention registration UI** | ✓ OPERATIVO | `POST /api/aula-viva/interventions` + UI `AulaVivaOperacional.tsx:94` |
| **follow-up queue** | ⚠️ endpoint EXISTE · UI NO LO MUESTRA | `impactTracker.getFollowupQueue()` existe; sin tab en UI |
| **closure formal con outcome** | ⚠️ endpoint EXISTE · UI NO EXPONE BOTÓN | `PATCH /interventions/:id/outcome` operativo; UI sin formulario |
| **outcome computation automática** | ⚠️ código LISTO · engine OFF | `AULA_VIVA_OUTCOME_ENGINE_ENABLED=1` no seteada |
| **risk auto-resolve** | ✓ código operativo CUANDO engine ON | PASO 3 autoResolveRisks fija `resolved_at` |
| **relapse handling** | ✓ tratado como nuevo registro | `hasActiveRisk()` solo cuenta `resolved_at IS NULL` |
| **link relapse → previous risk** | ❌ NO existe | sin `previous_risk_id` FK; pérdida de memoria institucional del caso |
| **institutional learning agregado** | ⚠️ código LISTO · engine OFF | `AULA_VIVA_LEARNING_ENABLED=1` no seteada |
| **comparative strategies sin ranking docente** | ✓ OPERATIVO + testado | `/institutional/comparative/strategies` ordena por improved_ratio sin nombrar mediators |
| **case ownership / co-ownership** | ❌ NO existe | `teacher_id` único; si mediator deja escuela, intervención orfana |
| **institutional review por coordinador** | ✓ scope school accesible | `scopeAccess` permite mediator/admin de school ver agregados |

### Verdad operacional
**El loop está 40% operativo, 60% conceptual scaffolding.** Si se enciende `INTERVENTION_ENGINE_ENABLED + AULA_VIVA_OUTCOME_ENGINE_ENABLED + AULA_VIVA_COHORT_BUILDER_ENABLED + AULA_VIVA_LEARNING_ENABLED + AULA_VIVA_SCHEDULER_ENABLED` (5 flags), el loop pasa a ~75% operativo. Lo que queda permanentemente conceptual hoy:
1. **Follow-up queue visible en UI** (endpoint pero no botón) — necesita feature pequeña UI.
2. **Cerrar intervención con outcome desde UI** (endpoint pero no formulario) — necesita feature UI.
3. **Link relapse↔previous risk** — necesita schema migration.
4. **Co-ownership / transferencia de caso** — necesita schema migration.

### Riesgo institucional crítico
**Hoy, si una docente registra una intervención en producción y deja de visitarla, nadie revisa.** El sistema acumula deuda silenciosa. La UI no expone followup queue, no envía recordatorios, no escala al coordinador. Esto es el gap más doloroso pedagógicamente: las intervenciones registradas operan sin governance.

---

## FASE 6 · LIBRARY / MULTI-INSTITUTION — VAPOR

### Verdad verificada en código

```
// server/services/cohortBuilder.mjs línea 153
library: (id, _crit) => ({ users: [],
    note: `library scope ${id} no implementado en PASO 6` })

// server/aulaViva/scopeAccess.mjs líneas 104-107
case 'library': {
    // No hay scope library funcional aún → admin-only.
    return false;
}

// data/groups_db.json
type ∈ {course, club} solamente (NO library)
```

**Si una biblioteca quiere usar Chibalete+ HOY**: recibe acceso de admin global o nada. No hay UI, no hay membership model, no hay scope dedicado. **La biblioteca como concepto institucional NO EXISTE en código.**

### Multi-institucionalidad: bloqueada por esquema
| Realidad | Verificación |
|---|---|
| Un user pertenece a 1 colegio | `users_db.json:colegio` es string SINGULAR |
| Un user puede estar en N grupos | `users_db.json:groupIds` array — ✓ |
| Un user en colegio X + club externo Y | ❌ no soportado (colegio bloqueante) |
| Historia lectora viaja con el user al cambiar de colegio | ❌ events.db por user_id pero perfil escolar único |
| Consent / minor flag | ❌ ausente en users_db.json |
| Right to be forgotten / export GDPR | ❌ sin endpoint `/api/user/:id/export` ni `/delete` |

### Veredicto Fase 6
**Library scope, multi-institucionalidad, consent de menores, portabilidad de datos son TODOS conceptos vapor.** El sistema HOY sirve a UN colegio con SUS docentes y SUS estudiantes. Cualquier cliente que no sea "un colegio" requiere replanteo arquitectónico antes de venta, no después.

---

## FASE 7 · MOBILE INSTITUTIONAL RUNTIME — DESKTOP-FIRST

### Auditoría de pretensión PWA vs realidad

| Item | Esperado | Verificado |
|---|---|---|
| `public/manifest.json` | PWA con install prompt | ❌ NO EXISTE |
| Service Worker funcional | offline + push | ⚠️ `public/sw.js` (60 líneas, cache-first básico, NO push, NO offline-write-queue) |
| Push notifications | alertas pedagógicas mobile | ❌ ningún `beforeinstallprompt` ni `pushManager` |
| Quick intervention 1-tap desde phone | botón→commit sin modal | ❌ usa `window.prompt('Nota breve…')` (anti-pattern mobile) |
| Layout mobile-first | ≤ sm prioritized | ⚠️ responsive `grid-cols-1 sm:grid-cols-2 lg:grid-cols-4` — desktop-first con adaptación |
| Tabs en mobile | dropdown selector | ❌ tabs horizontales fijas (`AulaVivaOperacional.tsx`) |
| Mediador en territorio sin laptop puede registrar intervención | flow nativo | ⚠️ funciona pero con UX hostile (`window.prompt`) |

### Veredicto Fase 7
**Chibalete+ es desktop-first con responsive, NO mobile-operational.** Para un bibliotecario en territorio o mediador haciendo trabajo de campo sin laptop, el sistema es usable bajo coacción pero no diseñado para esa realidad. Es la deuda más grande para escalar fuera de aula formal.

---

## FASE 8 · SNAPSHOT_HISTORY DENSITY

### Estado verificado en filesystem local
```
data-critical/
  events.db      962 KB  (canon log local dev)
  events.db-wal  473 KB  (WAL pending checkpoint)
  insights.db    356 KB  (read model con tablas PASO 2-7)
```

Esto es **datos de desarrollo local**, no producción real. La densidad longitudinal mínima para visualizaciones legítimas:

| Visualización | Densidad mínima | Estado |
|---|---|---|
| Sparkline simple (28d) | 7 puntos diarios | ❌ HOY los snapshots se sobrescriben (UPSERT) |
| Heatmap continuity (7d × 12sem) | 84 datapoints/user | ❌ requiere `SNAPSHOT_HISTORY_ENABLED=1` jamás encendido |
| Recovery curves (post-intervención) | N intervenciones × M días followup | ⚠️ posible si engines ON + history ON |
| Longitudinal cohort trajectories | ≥ 4 semanas continuas | ❌ tabla existe, jamás llenada |
| Intervention persistence maps | ≥ 30 intervenciones con outcome | ❌ outcome engine OFF |

### Verdad cruda
**El sistema tiene 0 days de longitudinal real density en producción.** Las visualizaciones longitudinales que la UI promete son legítimas solo a partir de N semanas DESPUÉS de encender `SNAPSHOT_HISTORY_ENABLED=1`. Hasta entonces son honest empty states (lo cual al menos está correctamente implementado — `EmptyState.tsx kind='snapshots_pending'`).

---

## FASE 9 · GOVERNANCE FUTURO — Capacidad evolutiva

### Lo que la arquitectura actual PUEDE evolucionar a (sin reescritura)
- ✓ Cohort scope `group/school/club` real (cohortBuilder ya resuelve, solo falta encender)
- ✓ Replay histórico de outcomes con `rebuildOutcomes()` idempotente
- ✓ Snapshot history append-only (cambio gated, sin migración destructiva)
- ✓ Comparative intelligence sin ranking docente (ya operativo)
- ✓ Múltiples mediadores por grupo (existing, falta ownership transfer)

### Lo que requiere replanteo arquitectónico (NO trivial)
- ❌ **Multi-organization**: user → N organizations requiere refactor de `colegio: string` a `organizationIds: []` + access engine actualizar layer order.
- ❌ **Library scope**: tabla SQLite + endpoints + role `librarian` + UI dedicada.
- ❌ **Consent / minors / GDPR**: añadir flags + export endpoint + delete endpoint + audit trail por requests.
- ❌ **Co-ownership intervención**: schema migration + UI multi-mediator.
- ❌ **Interinstitutional continuity**: historia portable cross-organization.
- ❌ **PWA real mobile-operational**: manifest + native forms + push.

### Veredicto Fase 9
**La arquitectura es evolutiva para crecer DENTRO del modelo actual (1 colegio, N grupos, course/club, mediator/admin/lector). Es bloqueante para evolucionar HACIA bibliotecas, clubes externos, multi-organización o consumo mobile institucional.** PASO 8 del plan maestro implícito (CLUBES EXTERNOS, BUNDLES) requiere primero refactor del modelo de identidad institucional.

---

## FASE 10 · VEREDICTO REAL

### 1. ¿Qué ES realmente Chibalete+ hoy?
Un **sistema multi-modo de lectura digital institucional** con runtime audio-sync **production-grade en inmersivo**, con un **scaffold de aprendizaje institucional longitudinal correctamente arquitectado** pero **apagado**. Una plataforma para UN colegio con SUS docentes/estudiantes con un buddy lector AI (Leo) bien integrado en sesión.

### 2. ¿Qué NO es todavía?
- NO es **infraestructura longitudinal operativa** (engines apagados)
- NO es **plataforma multi-institucional** (colegio singular)
- NO es **plataforma para bibliotecas** (library scope vapor)
- NO es **mobile-operational** (PWA missing, prompt() para notas)
- NO es **sistema de mediación cognitiva longitudinal** (Leo episódico)
- NO es **analytics con causalidad probada** (correctamente, por diseño ético)

### 3. ¿Qué ya funciona como infraestructura real?
- Runtime inmersivo V1 (hardening completo M-5.4.*)
- Modo Guiado + Accesible + PDF + Álbum operativos
- Aula Viva backend layer PASO 1-7 (351/351 tests verdes)
- Scope isolation con scopeAccess testado
- Healthcheck con 21 checks
- Leo como buddy con memoria sesión y mediator view API
- CI security workflow con gitleaks

### 4. ¿Qué sigue siendo conceptual?
- Los 5 engines PASO 3/4/6 sin scheduler activo
- Snapshot history (jamás encendido)
- Library scope
- Multi-organization
- Cierre formal de intervención desde UI
- Follow-up queue visible
- PWA mobile-first

### 5. Riesgos pedagógicos
| Riesgo | Severidad | Donde |
|---|---|---|
| Docente registra intervención y nadie revisa | **alta** | UI sin follow-up queue |
| Modo Accesible no contribuye a objetivos institucionales | **alta** | backbone v1 desconectado |
| Cross-mode reading interpretado como continuidad cuando es señal de falla | **media** | sin evento `strategy_switched` |
| Métricas vanity confunden compromiso con aprendizaje | **media** | `active_users`, `session_count` sin segmentar |
| Leo alucina sobre contenido sin output guard | **media** | `leoGuard.js` valida solo input |
| Recomendaciones stale porque engine OFF | **alta** | `INTERVENTION_ENGINE_ENABLED` no seteada |

### 6. Riesgos institucionales
| Riesgo | Severidad |
|---|---|
| Cliente biblioteca firma contrato → encuentra vapor | **crítica** |
| Estudiante cambia de colegio → historia se pierde (sin portabilidad) | **alta** |
| Padre solicita borrado GDPR → sin endpoint | **alta** |
| Coordinador quiere ranking docente → sistema lo niega correctamente | **mitigado** (feature, no bug) |
| Mediator orfano deja escuela → intervenciones huérfanas | **media** |

### 7. Riesgos técnicos
Cubiertos por **auditoría técnica anterior**: 3 P0 security (protobufjs CRITICAL, IDOR, rate limit Leo), SIGTERM ausente, etc. **No reabro** — ese reporte mantiene autoridad.

### 8. Riesgos de governance
- Sin flags de minor / consent → expuesto a regulación educativa.
- Sin audit trail de quien lee qué dashboard (PASO 7 expone metric, no log).
- Sin retention policy formal de `events.db` (archive rotation gated OFF).
- Sin política de cancelación de cuenta + qué pasa con data residual.

### 9. ¿Qué diferencia REALMENTE a Chibalete+?
**No es la AI. No son los dashboards. Es la disciplina arquitectónica de la honestidad estadística.**

`vocabulary_class:'observational'` testado en CI, `containsForbiddenVocab` validado en 3 sitios, `insufficient_data` como label de primera clase, `caveat` explícito en comparative API, NUNCA endpoint que ranke docentes, NUNCA función `predictFor(userId)`. Esto **no se ve en EdTech comercial**. Es el activo cultural que la auditoría técnica no podía ver.

### 10. ¿Qué NO debe sobreingenierizarse?
- **NO añadir XState** — `immersivePlaybackMachine.js` ya funciona.
- **NO añadir ECharts/Recharts/D3** — SVG puro gana en a11y child-appropriate.
- **NO migrar a PostgreSQL** — SQLite WAL + 4 handles + leader election es suficiente.
- **NO añadir Redis/Kafka** — leader election SQLite-based ya escala a 5000+ users.
- **NO añadir Workbox** — sw.js 60 líneas es auditable.
- **NO añadir LLM "agéntico"** — el sistema explícitamente rechaza causalidad falsa.
- **NO crear páginas dedicadas por scope (biblioteca, club)** antes de validar que cada rol demanda UI específica.

### 11. ¿Qué debe preservarse sí o sí?
1. **Vocab causal blocker mecánico** (`FORBIDDEN_VOCAB`).
2. **Default-deny scope isolation** con tests cross-tenant.
3. **events.db append-only** como canon único.
4. **Patrón 4-fase WAL safety** (compute → pedagogy tx → POST-COMMIT → insights tx).
5. **Idempotencia + replay** de cohorts/outcomes.
6. **Default-OFF gating** para todos los engines (rollback en caliente).
7. **`insufficient_data` como label** primera clase.
8. **Honesto empty states** (`EmptyState.tsx` con presets contextuales).
9. **Runtime inmersivo 12 invariantes + drift detector**.

### 12. ¿Qué capas tienen mayor valor estratégico?
| Capa | Valor estratégico | Razón |
|---|---|---|
| **Runtime inmersivo hardened** | **muy alto** | diferenciador técnico real; nadie más sincroniza así con esa honestidad |
| **Vocab causal + insufficient_data discipline** | **muy alto** | activo cultural irrecuperable si se diluye |
| **Aula Viva backend PASO 1-7 (apagado)** | **alto** potencial · **bajo** actual | infraestructura completa esperando flag |
| **Leo como buddy lector** | **alto** | UX diferencial; valor pedagógico real en sesión |
| **Modo Accesible** | **alto** ético · **bajo** sistémico | bien diseñado pero desconectado |
| **Modos PDF / Álbum como observables pedagógicos** | **bajo** | granularidad insuficiente sin instrumentación adicional |

### 13. Decisiones arquitectónicas CORRECTAS (preservar)
1. SQLite WAL multi-handle + leader election sin Redis.
2. events.db canon + insights.db read model con materializer incremental.
3. Idempotencia + UPSERT + UNIQUE constraints.
4. Default-OFF gating universal.
5. Componentes SVG puros sin chart libs.
6. Hooks de visor especializados (`useImmersivePlayback`, `useA11yAnalytics`, etc.).
7. Server.js como hot path único — no microservices.

### 14. Decisiones que deben REVISARSE
1. **VisorAccesible emitiendo a backbone v1 separado** — debe migrar a `eventRegistry.js`.
2. **Leo sin emisión de events canónicos** — añadir `leo_interaction_started/completed` a registry.
3. **`colegio: string` singular en users_db** — bloquea futuro institucional.
4. **`window.prompt()` para notas de intervención** — UX hostile mobile.
5. **`snapshot_history` default-OFF** — debería ser ON con purga a 365d.
6. **Sin scheduler en server.js boot** — engines deben arrancar con flag, no manual.
7. **Sin `mode_changed` event canónico** — pierde análisis cross-mode.

### 15. ¿Leo realmente está integrado longitudinalmente?
**NO.** Es buddy lector con memoria de sesión. La integración longitudinal hacia events.db, ICDLI feedback, intervention awareness y Aula Viva UI no existe. **Es el gap pedagógico más importante del sistema.**

### 16. ¿Los modos producen observabilidad útil?
**Parcialmente.** Inmersivo sí (sincronía + concentración). Guiado solo si Leo activado. Accesible bien diseñado pero desconectado. PDF/Álbum emiten ruido sin criterios pedagógicos. **El "cómo leen" se observa apenas en inmersivo; los otros modos son cajas negras pedagógicas.**

### 17. ¿Aula Viva es infraestructura longitudinal real?
**Es scaffolding completo apagado.** Cuando se enciendan los 5 flags + se conecte scheduler + se acumule snapshot history, sí. Hoy, **es teatro arquitectónico — código real, infraestructura real, datos cero**.

### 18. ¿Qué falta para llegar a madurez institucional?

**Para llegar a P1 (madurez operativa institucional)** — ~2 semanas:
1. Encender `INTERVENTION_ENGINE_ENABLED + OUTCOME_ENGINE_ENABLED + COHORT_BUILDER_ENABLED + LEARNING_ENABLED + SCHEDULER_ENABLED + SNAPSHOT_HISTORY_ENABLED` en `.env` de producción.
2. Cron o `setImmediate(scheduler.start)` en `server.js` boot (ya scaffold).
3. UI: añadir follow-up queue + botón "cerrar intervención con outcome" en `AulaVivaOperacional.tsx`.
4. Conectar `AulaViva.tsx` a `/api/leo/mediator/student/:userId` — exponer Leo evidence a docentes.
5. Migrar `VisorAccesible` a `eventRegistry.js` canónico.
6. Añadir evento canónico `mode_changed` + analizar cross-mode transitions.

**Para llegar a P2 (madurez institucional verdadera)** — ~2 meses:
7. Leo emite events canónicos + feedback loop bidireccional con ICDLI + intervention awareness + output hallucination guard.
8. PWA real: manifest.json + push + native form para intervenciones mobile.
9. Snapshot history append-only en producción con retention 365d.
10. Implementar library como tipo de scope real (tabla + UI + role librarian).
11. Refactor `colegio:string` → `organizationIds:[]` (multi-institucionalidad).
12. Endpoints GDPR: `/api/user/:id/export` + `/api/user/:id/delete` + audit trail.

**Para llegar a P3 (escalabilidad institucional + instrumentación pedagógica completa)** — ~6 meses:
13. Quizzes / micro-tasks Leo verificadas (objetivos 1, 2, 3 con confianza alta).
14. Mapa léxico contenido (objetivo fluidez con confianza alta).
15. Taxonomía géneros (diversidad cualitativa).
16. Recovery curves + heatmap continuity (con snapshot history acumulada).
17. Páginas dedicadas por rol (biblioteca, club, mediador móvil) si demanda real lo justifica.

---

## CRITERIO DE ÉXITO — auto-evaluación

| Pregunta | ¿Respondida? |
|---|---|
| ¿Logré reinterpretar Chibalete+ como sistema pedagógico longitudinal? | ✓ Capas cognitivas 1-4 |
| ¿Integré modos + Leo + Aula Viva? | ✓ Fases 1-3 cruzan los tres |
| ¿Respondí técnicamente cómo observa "cómo leen"? | ✓ Fase 4 con inventario de confianza |
| ¿Detecté vacíos reales? | ✓ Library vapor, Leo silo, snapshot_history nunca encendido, engines OFF, modo accesible desconectado |
| ¿Detecté riesgos futuros? | ✓ Multi-institucionalidad, GDPR, governance institucional |
| ¿Separé infraestructura sólida vs conceptualizaciones vs features estratégicas? | ✓ Veredicto §11-12 |

---

## CIERRE — distinción crítica que NO debe perderse

Hay una **diferencia abismal** entre:
- **"El sistema tiene engine de outcomes"** ← cierto técnicamente
- **"El sistema computa outcomes en producción"** ← falso hoy

La auditoría técnica anterior validó la primera. **Esta auditoría confirma que la segunda no es verdad.** No es porque el código esté roto. Es porque **nadie encendió el flag y nadie conectó el scheduler**.

Encender los 5 flags + conectar scheduler en boot es trabajo de **~4 horas**. Después, Chibalete+ pasa de "infraestructura pedagógica longitudinal en frío" a "infraestructura pedagógica longitudinal operacional". Es la diferencia entre **lo que el sistema dice que hace** (lo cual es cierto del código) y **lo que el sistema hace** (lo cual es menos).

**Mi recomendación estratégica única**: antes de cualquier feature nueva, antes de cualquier paso siguiente, antes de cualquier venta a colegios reales — encender los flags. La inteligencia ya existe. Solo necesita corriente.

---

**Auditoría compilada por:** auditor multidisciplinar (8 roles)
**Método:** verificación directa de código + 3 dispatches paralelos profundos + verificación independiente cruzada
**Honestidad:** máxima — sin maquillaje, sin inventar madurez, sin marketing
**Fecha:** 2026-05-19
