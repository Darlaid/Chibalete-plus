# CHP-IDDB-M1-A-DRAIN-REDO-WEEKDAY-TRAFFIC-01

Fecha: 2026-08-18 (15:48–15:55Z). Tipo: medición del drain legacy con la observabilidad validada. Read-only; cero cambios en producción, COMPAT/202-drop/lu_config/0.9.0 intactos. Sin sobreingeniería: mismo analizador, mismas fuentes.

Pregunta: **¿existe todavía tráfico legacy incompatible suficiente para impedir un futuro reintento de ENFORCE?** Respuesta: **sí — quedan clientes legacy por migrar, con evidencia directa.**

---

## A. Veredicto

**YELLOW-LEGACY-ACTIVE** — la secuencia hacia ENFORCE queda DETENIDA. La evidencia demuestra clientes legacy reales sin migrar:

1. **user-1781223321961 leyó activamente con cliente legacy (okhttp/4.12.0, header-only) el 18/Ago 01:11–01:19Z** — es exactamente el usuario que quedó bloqueado en el intento de ENFORCE anterior; su dispositivo sigue sin migrar y volvería a romperse.
2. **Un dispositivo de campo desconocido pingueó assignment con cliente legacy el 14/Ago 23h** — actividad legacy independiente del incidente.
3. **La migración de campo no se ha ejecutado**: cohorte canaria = 1 dispositivo (el de QA); no existe rollout automático ni update-check en los clientes desplegados → toda la población de campo (incl. la cohorte escolar `user-1779493121246-*` censada en la auditoría) permanece legacy por construcción.

Con la migración de campo pendiente, `GREEN-DRAIN` es **estructuralmente inalcanzable en cualquier ventana** — abrir 48h nuevas solo confirmaría lo ya demostrado. Por eso esta unidad cierra con la medición disponible (que ya cubre 5 días hábiles completos + la mañana escolar de hoy) en lugar de quemar una ventana con resultado predeterminado. No se disparó ningún STOP gate operativo (sin anomalías): el YELLOW es por población, no por regresión.

## B. Preflight (T0 = 2026-08-18T15:48Z)

Repos limpios (`d660dd4` / LU `31325c0`). Producción: `chibalete/api:8ed4e5e` ambas, healthy, restarts 0/0, COMPAT/COMPAT, 202-drop=1/instancia (solo el probe del deploy), legacy counter 2/1 (= los 3 pings del QA pre-upgrade, sin cambios), 0×5xx, APK `chibalete-lu-0.9.0.apk` publicado intacto, `lu_config.json` en 0.8.0. `lu_segment_analyzer.py` funcionando sin modificación sobre los logs actuales.

## C. Ventana observada

**Retrospectiva sobre la retención completa del edge: 11/Ago 01:33Z → 18/Ago 15:49Z** — incluye los días hábiles lunes 11 a viernes 15 completos y el bloque escolar del lunes 18, cumpliendo el requisito de representatividad laboral. Se documenta explícitamente que 0.9.0 solo existe desde el 18/Ago 14:19Z (canario), por lo que la ventana mide: (a) el comportamiento legacy en semana laboral real, y (b) la salud de 0.9.0 en su primera tarde. Evidencia preservada ANTES de la rotación (~7d) en `/root/chp-drain-redo-weekday-01/`: análisis segmentados T0, análisis desde el cierre de la unidad de observabilidad, las 27 líneas crudas LU de toda la ventana, y snapshots de métricas T0/cierre.

## D. Tráfico 0.9.0

13 requests (todas del canario, 18/Ago 14h): analytics 4×2xx · assignment 4×2xx + 1×401 (ping pre-login esperado) · login 1×2xx · progress-sync 3×2xx. **0 errores anómalos, 0 loops, 0 regresiones.** Sin tráfico 0.9.0 nuevo desde el cierre de la unidad anterior (esperable: 1 solo dispositivo migrado, en reposo).

## E. Tráfico legacy

11 requests `okhttp/4.12.0`, tres episodios: **14/Ago 23h = 1** (assignment, dispositivo de campo desconocido), **18/Ago 01h = 7** (lectura real de user-1781223321961: assignment 200/401, login 200×2, sync 401×2 — el patrón del incidente ENFORCE), **18/Ago 14h = 3** (la 0.8.0 del dispositivo QA minutos antes de su upgrade — ya migrado). Actividad compatible bajo COMPAT; **incompatible bajo el futuro contrato ENFORCE** (header-only). Sin tráfico legacy nuevo desde las 14:42Z. No se infieren dispositivos únicos desde conteos: los ≥2 dispositivos de campo se distinguen por episodio/usuario, no por volumen.

## F. 202-drop y errores

202-drop: inicial=1/instancia, final=1/instancia, **delta=0** (cero drops naturales vía edge también: 0×202 en analytics). Sin `session_required` no atribuibles, sin 401 anómalos de SEGMENT-09, sin patrón 50/50 nuevo, **0×5xx** en toda la ventana reciente. UNKNOWN=219 (scanners) con 0 requests en endpoints LU → no invalida la lectura. NON-LU≈3.9k (contexto, sin profundizar).

## G. Cross-check

Prometheus consistente con el edge en todas las señales que ya demostraron correspondencia: legacy counter 2+1=3 = las 3 requests okhttp del 18/Ago 14h (los episodios de 01h y 14/Ago son anteriores al reset del contador por el recreate de la mitigación — por eso el edge log es la fuente primaria); drop=1/1 sin movimiento. Snapshots T0/cierre byte-idénticos salvo el timestamp del propio probe de verificación.

## H. Evaluación del drain

| Criterio GREEN-DRAIN | Estado |
|---|---|
| 0.9.0 sin regresiones | ✅ |
| Sin señal material de legacy incompatible | ❌ **hay legacy real sin migrar (lector activo del 18/Ago + campo del 14/Ago + cohorte sin canario)** |
| 202-drop sin crecimiento | ✅ (delta 0) |
| Sin 401/403 anómalos en 0.9.0 | ✅ |
| Sin 5xx atribuibles | ✅ |
| UNKNOWN no invalida | ✅ |
| Producción healthy | ✅ |

Un solo criterio en rojo pero es el nuclear → **YELLOW-LEGACY-ACTIVE**.

## I. Salud productiva

Inicio = cierre: imágenes, health, restarts 0/0, COMPAT/COMPAT, 202-drop y contadores sin cambio alguno. COMPAT, mitigación, configuración de auth y `lu_config.json` intactos durante toda la unidad.

## J. Límites y riesgos

- La porción de ventana con 0.9.0 existente es corta (~1,5h); irrelevante para ESTE veredicto (el bloqueo es la población legacy, no la señal 0.9.0), pero el drain repetido deberá cubrir ≥48h hábiles POST-migración de campo.
- Población legacy instalada exacta desconocida (sin update-check); el censo mínimo demostrado es ≥2 dispositivos de campo activos en 7 días.
- 202-drop natural=0 solo significa que ningún legacy leyó con red posteando analytics en la ventana — no drenaje.
- La retención ~7d del edge log consumirá el episodio del 14/Ago hacia el 21/Ago — extractos ya preservados.

## K. Próximo paso

Según el propio contrato de esta unidad para YELLOW-LEGACY-ACTIVE — **sin crear infraestructura nueva**:

1. **Coordinación del operador (acción humana, no técnica):** migrar los clientes legacy observados instalando 0.9.0 desde `https://chibaleteplus.chibaleteeditores.com/uploads/chibalete-lu-0.9.0.apk` en los dispositivos de campo — prioritariamente el de user-1781223321961 (lector activo que volvería a romperse bajo ENFORCE) y la cohorte escolar censada. Credenciales tecleadas por cada usuario.
2. **Repetir este drain** (`DRAIN-REDO-WEEKDAY-TRAFFIC-02`) sobre una ventana ≥48h de días hábiles POSTERIOR a esa migración, con la misma metodología.
3. Solo si ese drain cierra GREEN-DRAIN: unidad separada de reintento controlado de ENFORCE.

ENFORCE permanece NO autorizado.
