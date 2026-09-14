# CHP-IDENTITY-M1-DRAIN-CLOSURE-EVALUATION-01

Fecha: 2026-09-14 (America/Bogota). Tipo: **evaluación del drain de identidad**
iniciado en `T0 = 2026-09-09T12:07:53Z` por
`docs/ops/CHP_IDENTITY_M1_T0_EXECUTION_01.md`. Sucesora directa de esa unidad.

Todo el acceso a producción fue **de solo lectura**: no se ejecutó `ENFORCE`, no
se cambiaron flags, no hubo deploy, restart, reload, recreate ni build, no se
ejecutó `docker exec`, no se leyeron stores ni bases, y no se crearon archivos
temporales remotos.

---

## 1. Veredicto

**`YELLOW-M1-DRAIN-NO-LU-EVIDENCE-PUBLISHED`**

El drain **no puede cerrarse**. La ventana temporal se cumplió con holgura y la
producción está sana, pero **no existe una sola solicitud de la app Chibalete+ LU
—de ninguna versión— en toda la ventana observada**. Se aplica literalmente la
regla del contrato: *cero tráfico LU no demuestra drain completo*.

---

## 2. Baseline

```text
Rama: chp/mook-contract-00
HEAD: ec18c1f992f2073c90f79178a9c0dbf92497be49
Local == remoto (git ls-remote, sin fetch)
Tracked limpio · 3 stashes y 5 untracked preexistentes, sin abrir
Presentes: CHP_IDENTITY_M1_T0_AUTHORIZATION_01.md · CHP_IDENTITY_M1_T0_EXECUTION_01.md
Ausente antes de esta unidad: CHP_IDENTITY_M1_DRAIN_CLOSURE_EVALUATION_01.md
```

Criterio de cierre tomado **literalmente** de `CHP_IDENTITY_M1_T0_EXECUTION_01.md`
§7, que a su vez cita `CHP_IDENTITY_FIELD_MIGRATION_EVIDENCE_01.md` §7 y
`CHP_IDDB_M1_A_LEGACY_OBSERVABILITY_SEGMENTED_01.md` §H. No se redefinió ningún
gate ni se sustituyó actividad real por la atestación directiva del inventario.

---

## 3. Ventana observada

| | UTC | America/Bogota |
|---|---|---|
| `T0` | 2026-09-09T12:07:53Z | 2026-09-09 07:07:53 |
| Cierre de la observación | 2026-09-14T17:27:30Z | 2026-09-14 12:27:30 |

Duración: **5 días 5 h 20 min** (≈125 h), muy por encima del mínimo de 48 h
hábiles. Reloj leído en el VPS, no en la estación local.

Cobertura por jornada (COT):

| Día | Tipo | Cobertura |
|---|---|---|
| mié 09-09 | hábil | parcial, desde 07:07 |
| jue 09-10 | hábil | **completa**, bloques escolares íntegros |
| vie 09-11 | hábil | **completa**, bloques escolares íntegros |
| sáb 09-12 · dom 09-13 | fin de semana | completa (sin bloques escolares) |
| lun 09-14 | hábil | parcial, hasta 12:27 |

**Tres jornadas hábiles completas o parciales más dos íntegras**, con observación
continua en horario laboral. El gate de ventana se cumple.

---

## 4. Fuentes y su disponibilidad

| Fuente | Estado | Cobertura respecto de `T0` |
|---|---|---|
| Access log del edge (`docker logs chibalete_edge`, driver `local`) | disponible | 2026-09-07T12:51:45Z → 2026-09-14T17:01:27Z — **continuo, sin rotación ni hueco**, empieza antes de `T0` |
| Prometheus (`prom/prometheus:v2.55.1`, up 2 meses) | `healthy`, responde | contadores in-process de ambas APIs, **sin reset** (ver §5) |
| Analizador de segmentos | `docs/ops/tools/lu_segment_analyzer.py`, SHA-256 `f08eba2c…2beb`; la copia del VPS es **byte-idéntica** | ejecutado con `--since 2026-09-09T12:07:53Z` |

Los cuatro contenedores arrancaron el **2026-09-07**, es decir **antes de `T0`**, y
tienen `RestartCount = 0`. Por eso la resta directa del high-watermark de `T0` es
válida y no hay que corregir por reinicio de contador.

Ninguna fuente estaba indisponible: no aplica `STOP-M1-DRAIN-TELEMETRY-UNAVAILABLE`.

---

## 5. Salud y concurrencia (preflight productivo)

| Servicio | Imagen | Estado | Salud | Reinicios | `FailingStreak` | Inicio |
|---|---|---|---|---|---|---|
| `chibalete_edge` | `nginx:alpine` | running | healthy | 0 | 0 | 2026-09-07T12:51:35Z |
| `chibalete_front` | `chibalete/front:ped01d-bef0afe` | running | healthy | 0 | 0 | 2026-09-07T12:53:18Z |
| `chibalete_api_1` | `chibalete/api:ped01d-bef0afe` | running | healthy | 0 | 0 | 2026-09-07T12:50:28Z |
| `chibalete_api_2` | `chibalete/api:ped01d-bef0afe` | running | healthy | 0 | 0 | 2026-09-07T12:49:22Z |

Imágenes **idénticas a las de `T0`**: no hubo deploy durante el drain.

`docker events` entre `T0` y el cierre, filtrado por `health_status`, `die`,
`restart` y `oom`: **ningún evento**. Sin periodos unhealthy.

Concurrencia: sin `restic`, `rsync`, `docker build`, `docker compose`, `pg_dump`
ni migración de datos en curso. Los únicos `migration/N` son hilos del kernel de
planificación de CPU, como ya se registró en `T0`. Carga del host
`0.38 / 0.27 / 0.23`, uptime 69 días.

No aplica `STOP-M1-DRAIN-PRODUCTION-NOT-STABLE`.

---

## 6. Actividad LU y versiones

Analizador tracked sobre el access log del edge, `--since T0`:

```text
ventana: 2026-09-09T12:43:37Z -> 2026-09-14T17:01:27Z
lineas parseadas: 1089 · no parseables: 74 (log completo)

SEGMENT-09              (ChibaleteLU/0.9.0)        : 0
SEGMENT-LU-VERSIONED-OTRO (ChibaleteLU/<otra>)     : 0
SEGMENT-LEGACY-LU       (okhttp/* en endpoints LU) : 0
SEGMENT-NON-LU                                     : 923
SEGMENT-UNKNOWN                                    : 166
```

- Solicitudes atribuibles a Chibalete+ LU: **0**.
- Distribución por versión identificable: **vacía** — ninguna versión observada.
- Actividad de 0.9.0: **0**.
- Actividad de versiones anteriores (0.7.1 / 0.8.0, indistinguibles entre sí como
  `okhttp/4.12.0`): **0**.
- Primera y última observación LU: **no existen**.
- Bloques escolares con actividad LU: **0 de 3** jornadas hábiles con bloques.

### 6.1 Falsos positivos descartados (verificación explícita)

El log contiene cadenas que **parecen** LU y no lo son. Se resolvieron una a una
para no cerrar ni descartar el gate por una coincidencia textual:

| Coincidencia | Ocurrencias | Resolución |
|---|---|---|
| UA `okhttp/*` | 3 | **`okhttp/5.3.0`**, no la `okhttp/4.12.0` de LU legacy; sobre rutas **no-API** (1×200, 2×404) en una ráfaga de 2 s el 2026-09-10T20:45Z. Patrón de escáner. El analizador ya las clasifica como `SEGMENT-UNKNOWN`, y no las reetiqueta como legacy «por conveniencia». |
| Texto `ChibaleteLU` | 2 | Rastreadores web (`Googlebot`, `OAI-SearchBot`) pidiendo el **bundle JS del frontend** `/assets/ChibaleteLU-*.js`. El nombre del archivo contiene la cadena; el cliente es un bot. Clasificadas como `SEGMENT-NON-LU`. |

Las 74 líneas no parseables **no pueden ocultar tráfico LU**: una búsqueda de
subcadena sobre el log completo encuentra exactamente 3 `okhttp` y 2
`ChibaleteLU`, todas ya explicadas arriba y todas parseadas.

`SEGMENT-UNKNOWN` (166) está dominado por sondas hostiles de internet
(`wp-admin/install.php`, detectores de CVE, agentes de escaneo) y no invalida la
lectura: ninguna de sus líneas es LU.

**Conclusión del gate:** la app LU no se conectó ni una vez. Esto no distingue
entre «todos los dispositivos migraron y nadie usó la app» y «la campaña no ha
llegado a los dispositivos»: es exactamente la limitación ya registrada en
`CHP_IDENTITY_FIELD_MIGRATION_EVIDENCE_01.md` —el sistema demuestra versión,
sesión y cuenta, **nunca dispositivo**.

---

## 7. Identidad: sesiones firmadas y legacy

Valores **brutos** de los contadores in-process, comparados contra el
high-watermark de `T0` (válido porque no hubo reinicio):

| Serie | `T0` | 2026-09-14T17:27Z | Δ desde `T0` |
|---|---|---|---|
| `auth_session_success_total{auth_method=session}` api_1 | sin serie (0) | 1 | **+1** |
| `auth_session_success_total` api_2 | sin serie (0) | sin serie (0) | 0 |
| `auth_session_legacy_x_user_id_total{source_class=browser}` api_1 | 16 | 16 | **0** |
| `auth_session_legacy_x_user_id_total{source_class=browser}` api_2 | 33 | 33 | **0** |
| `auth_session_failure_total{reason=no_identity}` api_1 | 5 | 30 | **+25** |
| `auth_session_failure_total{reason=no_identity}` api_2 | 5 | 25 | **+20** |
| `auth_session_subject_mismatch_total` api_1 · api_2 | 0 · 0 | 0 · 0 | **0** |
| `auth_session_failure_total{reason=legacy_analytics_accept_drop}` (202-drop) | 0 | **sin serie** | **0** |

`increase()` sobre la ventana confirma los mismos valores para legacy (0),
`no_identity` (45.0) y `subject_mismatch` (0). Para la serie firmada `increase()`
devuelve 0 porque la serie **nació dentro de la ventana** y un único punto no
permite extrapolar; la lectura autoritativa ahí es la resta del bruto: **+1**.

### 7.1 Atribución de la única sesión firmada

`query_range` sitúa la aparición de la serie en el scrape de
**2026-09-11T16:07:53Z** sobre `api_1`, valor 1, estable hasta hoy. El access log
del edge registra exactamente **un** `POST /api/auth/login` con `200` en toda la
ventana, a las **2026-09-11T16:07:27Z**, con familia de cliente `Mozilla/5.0`
(navegador). Correlación completa: 26 segundos entre el login y el scrape.

**La única sesión firmada del drain es de navegador, no de LU.** No hay tráfico
LU autenticado mediante sesión, porque no hay tráfico LU en absoluto.

### 7.2 Dependencia legacy

`x-user-id` no creció **en absoluto** (Δ = 0 en ambas APIs). No hay dependencia
legacy incompatible creciente. Pero, igual que arriba, esto se explica por la
ausencia total de tráfico LU, no por una migración demostrada.

---

## 8. Fallos y anomalías HTTP

Agregado del access log del edge desde `T0` (1089 líneas):

| Familia | Conteo |
|---|---|
| 2xx | 642 |
| 3xx | 301 |
| 4xx | 145 |
| 5xx | **1** |

| Estado de interés | Conteo | Atribución |
|---|---|---|
| 401 | **45** | 35 de `SEGMENT-NON-LU` + 10 de `SEGMENT-UNKNOWN`. **Coincide exactamente** con el Δ de `no_identity` (25 + 20 = 45): todo el crecimiento de fallos de identidad procede de navegadores sin sesión y de escáneres de internet, **nada de LU**. |
| 403 | 4 | 3 en `api-otros` + 1 en `progress-read`, todas de `SEGMENT-NON-LU`. |
| 429 | **0** | Sin throttling. |
| 502 | 1 | `POST /api/v1/events` el 2026-09-11T16:18:17Z, `rt=1.956`, desde un navegador móvil (`SEGMENT-NON-LU`). Incidente aislado, no atribuible a LU, sin repetición en 3 días. |
| 5xx restantes | 0 | — |

Reinicios: **0**. Periodos unhealthy: **0**. Sin eventos `die`/`oom`.

El crecimiento de `no_identity` (+45) es **explicado y no anómalo**: cada
incremento tiene su 401 correlativo en el edge, y su origen es ruido de internet
y navegación sin sesión, no la cohorte. `subject_mismatch` sigue en 0 y el
202-drop no tiene ni serie activa.

Ninguno de los STOP de `CHP_IDDB_M1_A_LEGACY_OBSERVABILITY_SEGMENTED_01.md` §H se
activó: sin `session_required` no atribuible, sin crecimiento de 202-drop, sin
patrón 50/50, sin 5xx atribuible a LU, sin 401 de `SEGMENT-09` (no hay
`SEGMENT-09`).

---

## 9. Matriz de decisión

Sin compensar un gate fallido con otro:

| Gate | Condición GREEN | Resultado | Evidencia |
|---|---|---|---|
| Ventana | 48 h hábiles y bloques escolares completos | ✅ **PASA** | 125 h; jue 10 y vie 11 completos |
| Actividad LU | Evidencia real y suficiente durante la ventana | ❌ **FALLA** | 0 solicitudes LU de cualquier versión |
| Versión | 0.9.0 observable, sin regresión incompatible | ⚠️ **NO DEMOSTRABLE** | 0 observaciones; no hay regresión porque no hay nada que observar |
| Sesión | Adopción firmada demostrada | ❌ **INSUFICIENTE** | 1 sesión firmada, de navegador, frente a 180 cuentas de la cohorte |
| Legacy | Sin crecimiento incompatible | ✅ **PASA** | Δ `x-user-id` = 0 |
| Fallos | Sin crecimiento anómalo | ✅ **PASA** | Δ `no_identity` = +45, íntegramente explicado; `subject_mismatch` = 0; 202-drop = 0 |
| HTTP | Sin 401/403, 429 o 5xx anómalos | ✅ **PASA** | 45×401 y 4×403 de ruido/navegador; 0×429; 1×502 aislado no LU |
| Salud | Servicios sanos y sin reinicios inesperados | ✅ **PASA** | 4/4 healthy, 0 reinicios, 0 eventos, imágenes sin cambio |
| Evidencia | Cobertura completa desde `T0` | ✅ **PASA** | edge log continuo desde antes de `T0`; contadores sin reset |

**Dos gates no se demuestran (Actividad LU y Sesión) y uno queda indeterminado
(Versión).** El cierre exige que todos estén demostrados, así que no procede.

---

## 10. Conclusión

El drain cumplió su ventana temporal y transcurrió sobre una producción
impecable —sin reinicios, sin degradación, sin regresión de errores y con cero
crecimiento de identidad legacy—, pero **no produjo la evidencia que el gate
exige**. Seis de nueve gates pasan; los dos que importan para decidir la
migración de campo no.

Lo que la telemetría sí demuestra, y conviene no sobreinterpretar en sentido
contrario: durante cinco días, incluidas dos jornadas escolares completas,
**ningún dispositivo de campo se conectó con ninguna versión de la app**. Eso es
compatible tanto con una migración completa y silenciosa como con una campaña que
no ha llegado a los dispositivos, y la telemetría disponible **no puede
distinguir entre ambas**. Cerrar el drain sobre esta base sería convertir una
ausencia de señal en una prueba de éxito.

```text
DRAIN: IN_PROGRESS
ENFORCE: NOT_AUTHORIZED
M1: AMBER-DRAIN-EVIDENCE-INCOMPLETE
T0_UTC: 2026-09-09T12:07:53Z (sin cambio)
MOOK_PRODUCTION_ACTIVATION: NOT_AUTHORIZED (sin cambio)
```

### 10.1 Prohibición explícita

**`ENFORCE` no queda autorizado por este documento ni por ningún resultado que
contenga.** Su ejecución exige una autorización humana separada y explícita de
Nicolás Jiménez, posterior a un drain efectivamente cerrado. Tampoco se autoriza
la activación de eventos MOOK en producción.

### 10.2 Perecibilidad de la evidencia

El access log del edge rota en ≈7 días y `T0` tiene 5 días: **esta evaluación
capturó la evidencia dentro del plazo**, pero una repetición posterior al
2026-09-14 perderá el tramo inicial del drain. Los contadores de Prometheus son
in-process: cualquier recreación de contenedor los reinicia y anula el
high-watermark de `T0`. Los agregados de este documento son, por tanto, el
registro duradero de la ventana.

---

## 11. Privacidad y mutaciones

Este documento no contiene nombres, correos, identificadores de usuarios,
sesiones, cookies, tokens, direcciones IP, User-Agent completos, rutas con
identificadores, payloads ni logs crudos. Solo agregados y una ruta de bundle
estático necesaria para descartar un falso positivo.

Cero mutaciones productivas: sin `ENFORCE`, sin cambio de flags, sin
restart/reload/recreate/build/deploy, sin `docker exec`, sin SQL, sin lectura de
stores, sin archivos temporales remotos. Único archivo creado en el repositorio:
este documento.

---

## 12. Único siguiente paso

Decisión humana sobre cómo continuar el drain: prolongarlo, o intervenir la
campaña de campo para que la app LU genere tráfico observable. Sin actividad LU
real no habrá cierre posible, por muchos días que se acumulen.
