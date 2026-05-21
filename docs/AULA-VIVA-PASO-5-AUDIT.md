# AULA VIVA — PASO 5 · AUDITORÍA UX + OPERACIONAL (PRE-IMPLEMENTACIÓN)

> Mandato §3 del plan PASO 5. Antes de escribir UI/scheduler/endpoints,
> mapear lo que hoy existe y juzgarlo honestamente. Cada decisión PASO 5
> debe apoyarse en algo aquí.

---

## 1. Frontend actual de Aula Viva (verificado en repo)

### Páginas
| Archivo | Tamaño | Estado |
|---|---|---|
| `pages/AulaViva.tsx`             | 2656 líneas | activa, ruta `/aula-viva`, lazy-loaded en `App.tsx:77` |
| `pages/DashboardMediador.tsx`    | 2018 líneas | activa |
| `pages/DashboardAdminLectura.tsx`| medio       | activa |
| `pages/AdminDashboard.tsx`       | medio       | activa |

### Componentes existentes en `components/aula-viva/`
```
CompetencyBar.tsx       — barras por competencia
DistributionChart.tsx   — distribución (sin lib)
GroupDiagnosisPanel.tsx — diagnóstico narrativo (alimentado por geminiService)
ProgressBar.tsx         — % lectura
StudentRow.tsx          — fila por estudiante en lista
StudentStatusPanel.tsx  — status narrativo (geminiService)
TrendChart.tsx          — trend simple
```

### Dependencias visuales
- **lucide-react** para iconos (ya está).
- **Tailwind via CDN** (cargado en `index.html`).
- **NINGUNA librería de charts** instalada (ni ECharts, ni Recharts, ni Chart.js).
- `geminiService.analizarProgresoPedagogico` ya genera análisis narrativo.

---

## 2. Datos pedagógicos visibles HOY en la UI

| Pantalla | Fuente backend |
|---|---|
| AulaViva — header de grupo | `dataService.getGroups`, `dataService.getStudents` |
| AulaViva — diagnóstico narrativo | `geminiService.analizarProgresoPedagogico` (LLM, no estructurado) |
| AulaViva — fila estudiante | `dataService.getStudentSignals` (pre-PASO 1) |
| StudentStatusPanel | narrativo Gemini (sin trazabilidad a reglas) |
| GroupDiagnosisPanel | narrativo Gemini (sin trazabilidad) |
| TrendChart / DistributionChart | datos derivados ad-hoc en frontend |
| DashboardMediador | métricas calculadas en `dataService` (lecturas directas a JSON) |

### Conclusión del audit
**La inteligencia construida en PASO 1-4 NO está conectada a la UI.**
- `pedagogical_recommendations` (PASO 3) → sin pantalla.
- `user_reading_profiles.abandono_risk` → sin badge.
- `pedagogical_risk_history` → sin timeline.
- `cohort_rollups`, `daily/weekly/monthly_rollups` → sin visualización.
- `feature_vectors` → sin uso (estos sí pueden esperar PASO 6, son IA-ready).
- Los engines NO corren autónomamente (no hay scheduler conectado).
- Sin scheduler = sin recomendaciones nuevas = la UI mostraría lo mismo siempre.

**Esto es PASO 5: el puente que hace operacional lo ya construido.**

---

## 3. Decisiones críticas (constraints reales)

### 3.1 NO reescribir páginas existentes (regla "cambios mínimos")
- `AulaViva.tsx` (2.6K líneas) y `DashboardMediador.tsx` (2K líneas) son
  pre-existentes. Tocarlos masivamente viola la regla de oro del proyecto.
- **Estrategia:** página NUEVA `pages/AulaVivaOperacional.tsx` montada en
  ruta NUEVA `/aula-viva/operacional`, separada de las existentes.
  La existente sigue funcionando.

### 3.2 NO añadir deps de charts (regla "no deps innecesarias")
- ECharts (140KB+) y Recharts (no instalada) NO se introducen.
- **Estrategia:** chart primitives en **SVG puro** dentro de
  `components/aula-viva/`:
    - `Sparkline.tsx` — línea SVG simple
    - `TimelineChart.tsx` — área/línea SVG con eje tiempo
    - `HeatmapCells.tsx` — grid SVG para cohortes
    - `BarsSVG.tsx` — barras horizontales
  Esto cumple §14 (visualización de cohortes) sin inflar bundle.

### 3.3 NO tocar autenticación
- Reglas estrictas (`CLAUDE.md`): no modificar middleware de auth.
- **Estrategia:** los nuevos endpoints REST reutilizan `requireAuth` /
  `requireUserAuth` ya existentes en `server.js`.

### 3.4 NO tocar `server.js` masivamente
- 8700+ líneas, hot path crítico.
- **Estrategia:** crear `server/aulaViva/operationalRouter.mjs` como
  Express Router auto-contenido. En `server.js` se añaden **2 líneas**:
  `app.use('/api/aula-viva', require('./aulaViva/operationalRouter'))`
  y el init del scheduler gated por env.

### 3.5 Scheduler operacional gated default-OFF
- `AULA_VIVA_SCHEDULER_ENABLED=1` → init `setInterval` loops.
- Cada loop pasa por `leaderElection.withLeader` (PASO 4) → cero doble-cómputo
  api_1↔api_2.
- Sin env flag → loops NO se inicializan → cero impacto en prod actual.

---

## 4. Riesgos UX a vigilar (§3 obligatorio)

| Riesgo | Mitigación en diseño PASO 5 |
|---|---|
| Dashboard "vacío" tras login = parece roto | **EmptyState component** con explicación contextual (onboarding, primera lectura, sincronización). Nunca mostrar "0" sin contexto. |
| Recomendación sin explicación = black-box | **RecommendationCard** muestra reglas + señales + confidence + scope. Cumple §15. |
| Latencia visible (snapshot stale, materializer atrasado) | **DegradedModeBanner** alimentado por `/api/health/analytics`. Cumple §17. |
| Hiperestimulación visual | Tipografía sobria, max 3 colores accent (verde=mejora, ámbar=moderate, rojo=critical). Sparklines minúsculos, NO gauges. |
| Ranking individuo↔individuo = profecía autocumplida | UI NUNCA muestra "estudiante X vs estudiante Y". Solo comparativas scope vs promedio. |
| Etiquetas clínicas en pantalla | Vocabulario `observational` ya bloqueado backend (PASO 3 audit §5). UI hereda y NO inventa nuevas etiquetas. |
| Spinner infinito | Todos los `fetch` con timeout 5s + fallback a empty state explícito. |
| UI confunde "sin datos aún" con "sin riesgo" | EmptyState distingue claramente las dos. |

---

## 5. Riesgos pedagógicos a vigilar

| Riesgo | Mitigación |
|---|---|
| Docente actúa sobre recomendación stale | `expires_at` visible; UI marca "más de 7 días" en gris. |
| Auto-acuse de recomendación al solo verla | NO. El acuse requiere CLICK explícito → POST `/api/aula-viva/recommendations/:id/ack`. |
| Intervención registrada sin contexto | Modal de intervención muestra la recomendación origen + explanation antes de pedir notas. |
| "Riesgo activo" se mantiene tras mejora | Auto-resolve (PASO 3) cierra automáticamente; UI lo refleja como "resuelto el ___". |
| Recomendaciones inundan al docente | Severity-first ordering + paginación; default mostrar critical+high; moderate/info en pestaña secundaria. |

---

## 6. Riesgos institucionales

| Riesgo | Mitigación |
|---|---|
| Director compara colegio↔colegio en ranking | UI institucional muestra solo evolución propia + cohort vs línea base global (sin nombrar a otros colegios). |
| Métricas se interpretan como evaluación docente | Doc institucional explícito: "Aula Viva visibiliza patrones lectores, NO evalúa docentes." |
| Información sensible cruza scopes (ej.: bibliotecario ve perfil estudiante) | Endpoints aplican `requireAuth` + filtran por scope role. Pendiente endpoint hardening §3.3. |

---

## 7. Arquitectura UI objetivo

```
┌──────────────────────────────────────────────────────────────────────┐
│  /aula-viva (ruta existente)                                         │
│   AulaViva.tsx (existente, intacta)                                  │
└──────────────────────────────────────────────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────┐
│  /aula-viva/operacional (ruta NUEVA — PASO 5)                        │
│                                                                      │
│   pages/AulaVivaOperacional.tsx                                      │
│     ├── <DegradedModeBanner />          (health/analytics)           │
│     ├── <EstudiantesNecesitanAtencion /> (recommendations active)    │
│     │     └── <RecommendationCard />                                 │
│     ├── <CohortesEvolucion />            (cohort_comparison + spark) │
│     │     └── <Sparkline />                                          │
│     ├── <RiesgosActivos />               (risk_history active)       │
│     ├── <IntervencionesPendientes />     (workflow §8)               │
│     └── <ScopeSwitcher />                (student|teacher|school|lib)│
└──────────────────────────────────────────────────────────────────────┘
              │
              │  fetch
              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  REST endpoints NUEVOS — /api/aula-viva/*                            │
│                                                                      │
│  GET  /students-needing-attention       → severity DESC ordered list │
│  GET  /students/:id/timeline            → reader.getProfileTimeline  │
│  GET  /students/:id/feature-vector      → reader.getLatestFeatureV   │
│  GET  /cohorts/:scope_type/:scope_id    → reader.getCohortComparison │
│  GET  /cohorts/:scope_type/:scope_id/daily   → daily rollups         │
│  GET  /cohorts/:scope_type/:scope_id/weekly  → weekly rollups        │
│  GET  /recommendations                  → activas (paginated)        │
│  POST /recommendations/:id/ack          → workflow §8                │
│  POST /recommendations/:id/apply        → workflow §8                │
│  POST /interventions                    → registrar intervención     │
│  PATCH /interventions/:id/outcome       → cerrar intervención        │
│  GET  /risk-history/:userId             → reader.getRiskHistory      │
│  GET  /signal-timeline/:scope/:id/:sig  → reader.getSignalTimeline   │
│  GET  /job-ledger                       → últimas N jobs             │
│  GET  /operational/status               → resumen agregado para UI   │
└──────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Scheduler operacional (NEW — gated AULA_VIVA_SCHEDULER_ENABLED)     │
│                                                                      │
│   setInterval loops, cada uno bajo leaderElection.withLeader:        │
│     materializer  → cada 60s     lockKey='materializer'              │
│     intervention  → cada 5min    lockKey='intervention'              │
│     rollups       → cada 30min   lockKey='rollup'                    │
│     archiveRotation → cada 6h    lockKey='archive_rotation'          │
│     featureExtract  → cada 24h   lockKey='feature_extract'           │
│                                                                      │
│   Cada loop reporta a métricas + actualiza materializer_runs.        │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 8. Empty states diseño (§16)

| Estado | Hoy | PASO 5 |
|---|---|---|
| Sin estudiantes | "0 estudiantes" | "Aún no hay estudiantes en este grupo. Cuando agregues alumnos verás aquí su evolución." |
| Sin recomendaciones | nada visible | "No hay recomendaciones pendientes — los lectores muestran patrones estables." |
| Snapshots stale | nada visible | DegradedModeBanner: "Snapshots calculados hace 12 min. Refrescando." |
| Materializer never ran | "No hay datos" | "Materialización inicial pendiente. Tardará unos minutos en aparecer." |
| Profile sin actividad | "0%" | "Este lector aún no inicia sesiones de lectura. Considera asignarle una primera lectura." |
| Replay activo | nada visible | "Replay histórico en curso (3/7 chunks). Algunos datos pueden estar atrasados." |

---

## 9. Degraded modes UI (§17)

`DegradedModeBanner` lee `/api/health/analytics` y muestra cuando:
- `materializer.lag_events > 10000` → "Atraso en materialización: N eventos pendientes"
- `materializer.degraded === true` → "Materialización degradada — algunos datos pueden estar desactualizados"
- `replay.active_runs > 0` → "Replay histórico en curso"
- `wal_size.warning !== null` → "WAL grande detectado, optimización automática en próximos minutos"
- `slow_queries.count_5min > 50` → "Latencia elevada detectada"

**SIN romper experiencia:** banner discreto top, sin bloquear. Datos siguen
mostrándose con timestamp de "calculado hace X min".

---

## 10. Offline / recovery (§18)

- Reutilizar `OfflineContext` existente (ya hay en `/context/`).
- `aulaVivaOperationalService.ts` añade caché en `localStorage` por endpoint
  con TTL 5min. Si offline: devuelve cache + bandera `stale:true`.
- UI muestra "Modo offline — datos del XX:XX" sin romper.
- POSTs (ack, intervention) se diferiren a un cola si offline; reintentan
  al volver online. Pattern ya usado en `dataService` para progress.

---

## 11. Qué NO mostrar (vigilado en código)

- Listas que ranken estudiante vs estudiante.
- Comparativas colegio vs colegio nombradas.
- Etiquetas clínicas (`dislexia`, `tdah`, `déficit`, etc.) — bloqueadas backend.
- Métricas con `confidence: 'low'` o `null` — la UI las marca como "señal
  débil" o las omite del header.
- Predicciones de Saber/PISA individual (proxy, NO predicción).
- Información personal sensitive (la API ya filtra; UI nunca pide más).

---

## 12. Qué NO automatizar (cumple §5 plan)

- Envío automático a familias.
- Cambio automático de modo de lectura del estudiante.
- Aplicación automática de recomendación sin click del docente.
- "Aceptar todas" no existe — cada acción es deliberada.

---

## 13. Lo que queda visible siempre

- Estado del sistema (degraded/ok) — banner top.
- Última actualización ("calculado hace X min") en cada widget.
- Acción rápida: "Marcar como vista" en cada recomendación visible.
- Acceso a explicación: clic en recomendación abre detalle con signals_used.

---

## 14. Roadmap implementable PASO 5

1. **Audit doc** ← este (§3 obligatorio).
2. **Backend operational layer**:
   - `server/aulaViva/operationalRouter.mjs` — endpoints REST (§7 arriba).
   - `server/aulaViva/scheduler.mjs` — loops con leader election (§19).
   - `server/aulaViva/archiveRotation.mjs` — rotación eventos > 90d (§20).
3. **Wiring quirúrgico en server.js** — 2-3 líneas (router + scheduler init gated).
4. **Métricas (§22)** — 8 nuevas en `metrics.js`, cardinalidad fija.
5. **Healthcheck (§23)** — `checks.scheduler`, `checks.archive_rotation`.
6. **Tests backend** — `server/__test__/aulaVivaOperational.test.js`.
7. **Frontend mínimo**:
   - `pages/AulaVivaOperacional.tsx` (nueva).
   - `components/aula-viva/Sparkline.tsx`, `TimelineSVG.tsx`,
     `RecommendationCard.tsx`, `RiskBadge.tsx`, `EmptyState.tsx`,
     `DegradedModeBanner.tsx` — SVG puro, sin deps.
   - `services/aulaVivaOperationalService.ts` — fetch + cache.
   - `App.tsx` — lazy import + ruta nueva.
8. **Doc final** — `docs/AULA-VIVA-PASO-5-OPERACIONAL.md`.

Todo ADITIVO, todo DEFAULT-OFF, todo REVERSIBLE.
