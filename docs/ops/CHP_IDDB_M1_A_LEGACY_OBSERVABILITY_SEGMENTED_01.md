# CHP-IDDB-M1-A-LEGACY-OBSERVABILITY-SEGMENTED-01

Fecha: 2026-08-18 (14:28–14:45Z). Tipo: unidad EXCLUSIVAMENTE de observabilidad, análisis read-only.
Sin ENFORCE, sin tocar COMPAT/202-drop/lu_config/APK/contratos; cero cambios en producción (solo lectura de logs/métricas + scripts de análisis en `/root/chp-m1a-legacy-obs-segmented-01/`).

Pregunta de la unidad: **¿podemos distinguir de forma fiable el tráfico LU 0.9.0 del legacy y cuantificar el incompatible restante antes del drain?** Respuesta: **sí** (con los límites de muestra de §J).

---

## A. Veredicto

**GREEN-OBSERVABILITY** — los 12 criterios del gate se cumplen. La segmentación por UA sobre el access log del edge identifica 0.9.0 inequívocamente, separa el legacy, mide el 202-drop, atribuye estatus por segmento y endpoint, cuantifica UNKNOWN sin que invalide la lectura, y quedó **cross-validada contra Prometheus con coincidencia exacta** (delta del contador legacy = 3 = las 3 requests okhttp del segmento legacy en la misma ventana).

## B. Preflight

- Repos limpios: Chibalete+ `chp/m1a-android-session-migration-01a` (`0fdf8c9`); LU local `31325c0`.
- Producción (inicio y fin idénticos): `chibalete/api:8ed4e5e` ambas, healthy, restarts 0/0, COMPAT/COMPAT, 202-drop activo (contador =1/instancia, solo el probe del deploy — 0 drops naturales), 0×5xx en la ventana reciente.

## C. Fuentes de observabilidad

| Fuente | Aporta | Limitaciones |
|---|---|---|
| **Edge access log** (`docker logs chibalete_edge`) | UA + método + path + status + timestamp por request → **fuente PRIMARIA de segmentación** | retención rotativa ≈7 días (hoy cubre desde 11/Ago 01:33Z); **no registra la location `/uploads`** (0 líneas pese a descargas reales); no expone qué credencial usó la request; ~135 líneas no-parseables (ruido de arranque, cuantificado) |
| **Prometheus / contadores in-process** | `legacy_x_user_id_total`, `failure{legacy_analytics_accept_drop}`, `session_required*`, `subject_mismatch` | **`source_class="browser"` está HARDCODEADO** → prom da totales, NO segmenta cliente (la trampa que ocultó a Android en el drain original); contadores se resetean con cada recreate (baseline actual = post-mitigación 12:44/12:47Z); `success{session}` solo incrementa en emisión de login |
| Logcat del dispositivo canario | comportamiento cliente (sin credenciales) | solo el dispositivo accesible |

Conclusión metodológica: **la segmentación vive en el edge log por UA; prom es el cross-check de totales y del 202-drop.**

## D. Reglas de segmentación (reproducibles — `docs/ops/tools/lu_segment_analyzer.py`, copia ejecutable en `/root/chp-m1a-legacy-obs-segmented-01/segment_analyzer.py`)

| Segmento | Regla |
|---|---|
| SEGMENT-09 | UA comienza por `ChibaleteLU/0.9.0` |
| SEGMENT-LU-VERSIONED-OTRO | UA `ChibaleteLU/<v>` con v≠0.9.0 (hoy: vacío; detectaría futuras versiones o regresiones) |
| SEGMENT-LEGACY-LU | UA `okhttp/*` sobre endpoints exclusivos de LU (assignment, progress, analytics, login, lu/version). **0.7.1 y 0.8.0 son indistinguibles entre sí** (ambas emiten `okhttp/4.12.0` pelado) — se miden como una sola clase legacy, suficiente porque ambas requieren migración |
| SEGMENT-NON-LU | navegadores (Mozilla), curl/wget/python/Go/bots declarados, health interno (IP 172.*/127.*/host) |
| SEGMENT-UNKNOWN | resto — **incluido okhttp fuera de endpoints LU** (no se reclasifica como legacy por conveniencia) |

Invocación: `docker logs chibalete_edge 2>&1 | python3 segment_analyzer.py [--since ISO8601]`.

## E. Baseline segmentado (ventana completa 11/Ago 01:33Z → 18/Ago 14:42Z, 4.141 requests parseadas + 135 no parseadas)

| Segmento | Total | Detalle relevante |
|---|---|---|
| SEGMENT-NON-LU | 3.898 | curl health 1.853 + navegadores (incluye el emisor residual x-user-id del frontend en assignment: 7×2xx, y los 68×401 históricos de v1-events pre-fix) |
| SEGMENT-UNKNOWN | 219 | scanners/bots raros (`RootEvidence/1.0`, probe wp-admin, Palo Alto, UA vacío). **0 requests en endpoints LU** → no contamina la medición de migración |
| **SEGMENT-09** | **13** | analytics 2xx=4 · assignment 2xx=4, 401=1 (ping pre-login) · login 2xx=1 · progress-sync 2xx=3. Un solo UA exacto `ChibaleteLU/0.9.0 Android/35`. 100% del tráfico es de hoy 14h (canario) |
| **SEGMENT-LEGACY-LU** | **11** | todo `okhttp/4.12.0`: assignment 2xx=4/401=2 · login 2xx=2 · progress-sync 2xx=1/401=2 |
| SEGMENT-LU-VERSIONED-OTRO | 0 | esperado |

Ventana post-canario (14:20:40→14:42Z): SEGMENT-09=1 (assignment 200), legacy=0, UNKNOWN=2 (scanners). Tráfico bajo — solo válida técnica, no poblacionalmente (§G).

## F. Legacy incompatible

- Distribución temporal del legacy: **14/Ago 23h = 1 request** (un dispositivo de campo desconocido pingueó assignment — dato NUEVO: había actividad legacy antes del incidente), **18/Ago 01h = 7** (el incidente del enforce, user-1781223321961, patrón 401/200 50/50), **18/Ago 14h = 3** (la 0.8.0 del propio dispositivo QA justo antes del upgrade).
- **Cross-check exacto edge↔prom:** el contador `legacy_x_user_id_total` (reseteado 12:44/12:47Z) marca api_1=2 + api_2=1 = **3**, y el edge muestra exactamente 3 requests okhttp en esa ventana. La segmentación y el contador cuentan lo mismo.
- Naturaleza de la incompatibilidad: el legacy funciona hoy bajo COMPAT (headers aceptados en assignment/progress); su escritura de analytics está interceptada por el **202-drop (0 ocurrencias naturales hasta ahora — ningún cliente legacy ha posteado analytics desde la mitigación)**; bajo ENFORCE todo este segmento fallaría con 401. El tráfico que ya usa sesión correctamente = SEGMENT-09 + navegador cookie-only.
- Clientes distinguibles sin PII: ≥2 dispositivos legacy activos en la ventana (el del 14/Ago y el del 18/Ago 01h) + el QA pre-upgrade (ya migrado). Población legacy instalada real sigue siendo desconocida (sin update-check).

## G. Señal 0.9.0

Identificable consistentemente (UA exacto, un solo formato), respuestas normales (2xx en todo tras el login; el único 401 fue el ping pre-login esperado), sin loops, sin `x-user-id` (por diseño + test en el alambre), analytics aceptados (4×2xx — con header-only habrían sido 202), progress sync 2xx, y separable del legacy sin ambigüedad: **no existe colisión de UA** (`ChibaleteLU/*` vs `okhttp/*` pelado son disjuntos). Sin YELLOW-OBSERVABILITY-GAP.

## H. Readiness para DRAIN-REDO (metodología congelada — NO ejecutada)

Para `CHP-IDDB-M1-A-DRAIN-REDO-WEEKDAY-TRAFFIC-01`:

- **Ventana:** ≥48h de días hábiles cubriendo bloques escolares completos (p. ej. martes 07:00 COT → jueves 19:00 COT). El cierre exige tráfico real en horario laboral, no madrugadas/fines de semana.
- **Fuentes:** edge access log (segmentación primaria por UA con `lu_segment_analyzer.py`) + Prometheus `query_range` de `legacy_x_user_id_total`, `failure{legacy_analytics_accept_drop}`, `session_required*` (cross-check de totales; recordar reset por recreate y label browser hardcodeado).
- **Comandos:** `docker logs chibalete_edge 2>&1 | python3 segment_analyzer.py --since <T0>` corrido al inicio, a diario y al cierre; snapshots de métricas con `obs_preflight.sh`.
- **Conteos a reportar:** SEGMENT-09, SEGMENT-LEGACY-LU (delta por día), SEGMENT-LU-VERSIONED-OTRO, UNKNOWN, 202-drop (edge status 202 en analytics + contador prom), 401/403/5xx por segmento×endpoint.
- **Preservación de evidencia:** extractos diarios del edge log a `/root/chp-drain-redo-weekday-01/` ANTES de que la rotación (~7d) los consuma; dumps de query_range; NUNCA borrar/rotar manualmente.
- **Criterios de STOP:** cualquier `session_required` no atribuible; crecimiento de 202-drop (= legacy posteando analytics: población activa mayor a la censada); patrón 50/50; 5xx atribuibles; cualquier 401 de SEGMENT-09 que no sea ping pre-login.
- **Sin resultado anticipado:** el gate del drain se evalúa allí (delta legacy POR SEGMENTO, mínimos de tráfico, población), no aquí.

## I. Salud productiva

Inicio = fin: `8ed4e5e` ambas healthy, restarts 0/0, COMPAT/COMPAT, 202-drop intacto (=1/instancia, sin incrementos), 0×5xx, contadores sin anomalías. Cero impacto de esta unidad (no hubo cambios).

## J. Límites y riesgos

- **Muestra minúscula:** SEGMENT-09 = 13 requests de **1 dispositivo** (el canario). No es adopción (§G del brief): no se infiere población desde descargas (además `/uploads` ni se loguea) ni dispositivos únicos desde conteos de requests.
- Legacy observado = 11 requests / ≥2 dispositivos; la población legacy instalada real es desconocida y **el 202-drop en 0 natural NO significa drenaje** (los clientes legacy solo postean analytics al leer con red).
- 0.7.1 vs 0.8.0 indistinguibles (misma UA) — irrelevante para el gate (ambas son legacy a migrar).
- La retención ≈7 días del edge log obliga a preservar extractos durante el drain.
- Prom no segmenta cliente (label hardcodeado) — solo cross-check.
- Sin update automático: la adopción de 0.9.0 depende de la extensión manual del canario de campo (en paralelo, fuera de esta unidad).

## K. Próximo paso

**`CHP-IDDB-M1-A-DRAIN-REDO-WEEKDAY-TRAFFIC-01`** con la metodología de §H, idealmente tras extender el canario de campo (más señal 0.9.0 y menos legacy que drenar). ENFORCE sigue sin autorizarse por esta unidad.
