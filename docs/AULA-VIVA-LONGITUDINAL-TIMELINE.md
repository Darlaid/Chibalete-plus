# Aula Viva — Longitudinal Student Timeline (Fase 3A)

> **Estado:** Fase 3A — primera pieza del giro "analytics → operacional".
> Resuelve los gaps reales identificados en auditoría: timeline UI + engine
> determinístico de summaries longitudinales.

## 1. Por qué este documento existe

El prompt Fase 3A pedía transformar Aula Viva de "dashboard analytics" a
"centro operacional para mediadores". La auditoría reveló que **24 endpoints
+ 16 componentes + AulaVivaOperacional + scheduler + reglas + outcomes ya
existían** — la mayoría del prompt ya estaba construido.

Los únicos gaps reales eran:

1. **Frontend timeline por estudiante** — el endpoint
   `/api/aula-viva/students/:userId/timeline` devolvía datos longitudinales
   crudos pero NO había componente UI cronológico.
2. **Longitudinal summary engine** — no había generador determinístico de
   frases honestas tipo "Persistencia estable en últimas semanas" /
   "Datos insuficientes para observar continuidad".

Esta fase cierra esos dos gaps sin tocar engines, sin nueva página, sin
nuevo dashboard.

## 2. Qué se agregó

| Pieza | Ubicación | Función |
|---|---|---|
| Summary engine determinístico | `server/services/longitudinalSummary.mjs` (308 líneas) | 11 templates con `condition(t) → bool` y `render(t) → Summary`. Cero LLM, cero narrativa libre. |
| Extensión endpoint | `server/aulaViva/operationalRouter.mjs` | `/students/:userId/timeline` ahora agrega `summaries[]` cuando el flag está ON. Defensivo (fallo del engine → `summaries=[]`). |
| Feature flag | `server/lib/flags.js` | `AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED` (default OFF). |
| Componente React | `components/aula-viva/LongitudinalStudentTimeline.tsx` (240 líneas) | Render cronológico: summaries → riesgos activos → recomendaciones recientes → footer con caveat global. Reusa `RiskBadge` y `EmptyState`. Mobile-friendly via Tailwind. |
| Tests engine | `server/__test__/longitudinalSummary.test.js` | 102 asserts: flag OFF, cada template, defensa, sin PII, vocabulario observacional, determinismo. |
| Tests componente | `components/aula-viva/__tests__/LongitudinalStudentTimeline.structural.test.mjs` | 48 asserts: no fetch interno, no canvas/D3, reusa componentes, aria-labels, mobile breakpoints, defensa null. |

## 3. Catálogo de los 11 templates

| Template ID | Kind | Cuándo dispara |
|---|---|---|
| `insufficient_no_profile` | `insufficient_data` | `profile_current === null` |
| `insufficient_few_signals` | `insufficient_data` | Hay perfil pero <3 signals con valor real |
| `invisibility_prolonged` | `attention` | Risk `invisibilidad_prolongada` sin resolver |
| `abandonment_risk_high` | `attention` | `abandono_risk > 0.6` |
| `persistence_low` | `attention` | `persistencia_score < 0.3` |
| `persistence_stable` | `positive` | `persistencia_score > 0.6` + actividad ≤14d |
| `recovery_after_help` | `positive` | `mediacion_leo ≥ 3` + `persistencia_score > 0.5` |
| `autonomy_growing` | `positive` | `autonomia_score > 0.6` |
| `diversity_low` | `observation` | `diversidad_score < 0.3` |
| `leo_emotional_observed` | `observation` | Signal `emocion_observada` con valor + confidence ≠ pending |
| `no_active_recommendations` | `neutral` | Sin risks no resueltos + sin recomendaciones pendientes |

Cada summary devuelve:

```ts
{
  id: string,         // estable, mismo que template_id
  kind: 'insufficient_data' | 'attention' | 'positive' | 'observation' | 'neutral',
  headline: string,   // observacional, sin afirmar comprensión
  evidence: string,   // 1 línea, sin PII
  confidence: 'low' | 'medium' | 'high',
  caveat: string,     // SIEMPRE presente
  sources: string[],  // qué campos del timeline alimentaron
}
```

## 4. Activación

```bash
# /opt/chibaleteplus/.env
AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED=1
```

Restart staggered (los containers se levantan rápido — sin warmup):

```bash
docker compose restart chibalete_api_1   # validar logs
docker compose restart chibalete_api_2
```

### Verificación

```bash
# Pedir timeline a un estudiante real (reemplazar X):
curl -H "x-user-id: <mediator_uid>" \
  https://chibalete/api/aula-viva/students/X/timeline | jq .summaries
```

Esperado: array de summaries (no vacío si el estudiante tiene perfil + signals).

### Rollback

```bash
AULA_VIVA_LONGITUDINAL_SUMMARY_ENABLED=0
docker compose restart chibalete_api_1 chibalete_api_2
```

`summaries=[]` en el payload — el resto del timeline sigue intacto.
El componente React grácilmente no renderiza la sección "Observaciones
recientes" cuando `summaries=[]`.

## 5. Cómo integrar el componente en una página

El componente NO está cableado en ningún `pages/*` todavía — eso es
decisión de UX/diseño. Para integrarlo:

```tsx
import { LongitudinalStudentTimeline } from '../components/aula-viva/LongitudinalStudentTimeline';
import { aulaVivaOperationalService } from '../services/aulaVivaOperationalService';

// Dentro de tu componente, cuando el mediador selecciona un estudiante:
const [data, setData] = useState(null);
const [loading, setLoading] = useState(true);

useEffect(() => {
    let cancelled = false;
    aulaVivaOperationalService.getStudentTimeline(studentId)
        .then(d => !cancelled && setData(d))
        .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
}, [studentId]);

return <LongitudinalStudentTimeline data={data} loading={loading} />;
```

Notar: `aulaVivaOperationalService.getStudentTimeline` no existe aún
como método explícito — agregarlo trivialmente cuando se decida cablear.

## 6. Garantías

### NO LLM
El engine es 100% templates con `condition()`/`render()` puros. Cero
llamadas a aiEngine. Cero generación de texto libre. Cualquier intento
futuro de "mejorar" con LLM debe pasar revisión arquitectónica.

### NO PII
- El engine NUNCA lee `leo_evidence_db.json` (que sí tiene previews).
- Los payloads de events.db excluyen texto libre por diseño (Fase 2A).
- Test `[14]` valida que ningún summary contiene nombres, emails, mensajes
  del estudiante.

### Vocabulario observacional
- Sufijo "_observada" en signal IDs.
- Headlines tipo "Se observa", "Se observan indicios", "Datos insuficientes".
- Caveats explícitos en cada summary (test `[6]` del componente cubre las
  frases prohibidas tipo "comprende perfectamente", "fracasa", "tiene
  problemas de").
- Footer global del componente reitera "Ninguna afirma comprensión".

### Defensivo
- Engine: `try/catch` por template → un template malformado NO afecta otros.
- Endpoint: `try/catch` envolvente → fallo del engine → `summaries=[]`, el
  resto del payload queda intacto.
- Componente: chequeos `Array.isArray`, `!data`, `loading`, `profile === null`
  → siempre degrada a `<EmptyState>`.

### Determinístico
- Test `[11]` valida que llamados idénticos producen mismos summaries en
  mismo orden.

### Mobile-friendly
- Tailwind responsive breakpoints (`sm:`) en padding, fuentes, layout.
- Stack vertical por defecto, sin tablas anchas.
- Iconos `lucide-react` (ya en deps).
- Touch targets ≥44px de altura (botones nativos del componente padre).

## 7. Lo que NO se hizo (defer)

| Cosa | Por qué se difirió |
|---|---|
| Cablear el componente en una página | Decisión UX/diseño — varios candidatos (AulaViva, AulaVivaOperacional). Mejor decidir con mediadores reales. |
| `aulaVivaOperationalService.getStudentTimeline()` método | Trivial; se agrega cuando se decida cablear. El endpoint ya devuelve los datos. |
| Audit trail de "mediator viewed student" | Existen los eventos canónicos (`teacher_viewed_*`) en el registry pero no se emiten. Fase 3B. |
| `organizationId` propagation en todos los endpoints | `scopeAccess` ya filtra; gap menor (mediador del Colegio A puede ver `/students/X/timeline` si user X está en algún grupo donde el mediador media). Fase 3B. |
| Vista cohort-level usando summaries agregadas | Los summaries son per-user; agregación por cohort requiere otro engine. Fase 3B. |
| 3 flags adicionales que pedía el prompt | `LONGITUDINAL_TIMELINE_ENABLED`, `MEDIATOR_QUEUE_ENABLED`, `INVISIBLE_STUDENTS_ENABLED` cubren funcionalidad ya existente. Innecesarios. |

## 8. Tests

```bash
node server/__test__/longitudinalSummary.test.js                              # 102 ✓ / 0 ✗
node components/aula-viva/__tests__/LongitudinalStudentTimeline.structural.test.mjs   # 48 ✓ / 0 ✗
npm run test:analytics                                                        # 11 suites:
#   analyticsCanon           46 ✓
#   insightMaterializer       24 ✓
#   pedagogicalEngine         29 ✓
#   scalability               45 ✓
#   aulaVivaOperational       31 ✓
#   outcomesEngine            40 ✓
#   aulaVivaInstitutional     44 ✓
#   leoBackboneEmitter        60 ✓  (Fase 2A)
#   leoPedagogicalSignals     70 ✓  (Fase 2B)
#   longitudinalSummary      102 ✓  (Fase 3A — ESTE sprint)
#   LongitudinalStudentTimeline.structural  48 ✓  (Fase 3A — ESTE sprint)
#                          ────────
#                          539 ✓ / 0 ✗
```

Sin regresión en `test:reading-runtime` (162/162 Fase 1+2 CRR intactos).
TS baseline: solo el error pre-existente en `useImmersivePlayback.ts`
(`canStartAudio`) que viene de cambios previos al sprint — no introducido
por Fase 3A.

## 9. Próximas fases

- **Fase 3B**: cableo del componente en página + cohort summaries + audit
  trail de mediador.
- **Fase 4**: governance institucional (organizationId middleware, RBAC
  estructurado, mediator scope filtering granular).
