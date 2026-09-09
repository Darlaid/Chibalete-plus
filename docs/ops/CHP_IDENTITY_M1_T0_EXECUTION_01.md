# CHP-IDENTITY-M1-T0-EXECUTION-01

Fecha: 2026-09-09 (America/Bogota). Tipo: **establecimiento de `T0` e inicio formal del
drain** (carril A de `CHP-ROADMAP-2026-05`, sucesor de
`CHP_IDENTITY_M1_T0_AUTHORIZATION_01.md`). `T0` es un límite temporal y de telemetría
verificable, **no un deploy**: esta unidad no cambió configuración productiva, no
reinició ni recreó contenedores, no ejecutó reload, no desplegó código, no escribió en
bases ni stores y no alteró cuentas, sesiones ni memberships. Todo el acceso a
producción fue de solo lectura.

---

## 1. Veredicto

**`GREEN-M1-T0-ESTABLISHED-DRAIN-STARTED-AND-PUBLISHED`**

Qué significa exactamente:

- `T0` queda **establecido** para la cohorte de 180 cuentas de Nuevo Bosque y Villas de
  Aranjuez, por atestación directiva;
- el periodo de drain **queda iniciado en `T0`** y se evaluará con el criterio tracked
  (§7);
- `ENFORCE` y la activación de eventos MOOK en producción **siguen no autorizados**;
- el drain no se ha evaluado ni cerrado: su cierre es una unidad posterior.

## 2. Baseline verificado

```text
Rama: chp/mook-contract-00
HEAD: 77623e82ce75ce3d4034af94de9fccb8722b7952
Local == remoto (git ls-remote, sin fetch); ahead/behind 0/0
Tracked limpio
3 untracked preexistentes, sin abrir ni modificar
3 stashes preexistentes, sin abrir ni modificar
```

## 3. Gate documental

Fuentes leídas (únicas):

- `docs/ops/CHP_IDENTITY_M1_T0_AUTHORIZATION_01.md` (commit `77623e82…`), que
  referencia el commit completo del override
  `8e6ea5e3050058c1502ccc1f8679088553ed3f12` y registra:

  ```text
  INVENTORY: CLOSED_BY_MANAGEMENT_ATTESTATION
  T0_ELIGIBLE_BY_MANAGEMENT_ATTESTATION: 180
  T0_AUTHORIZATION: APPROVED
  T0_EXECUTION: NOT_STARTED
  ```

- `docs/ops/CHP_IDENTITY_M1_FIELD_INVENTORY_MANAGEMENT_OVERRIDE_01.md` (commit
  `8e6ea5e3…`), con `COHORT_ACCOUNTS: 180`, `DECLARED_READY: 180`,
  `DECLARED_EXCEPTIONS: 0`.

No se abrieron planillas ni CSV.

```text
COHORTE: 180 cuentas (90 Nuevo Bosque, 90 Villas de Aranjuez)
FUNDAMENTO_EXCLUSIVO: atestación directiva (override 8e6ea5e3…, autorización 77623e82…)
```

## 4. Preflight productivo (solo lectura)

### 4.1 Salud

| Servicio | Imagen | Salud | Reinicios | Inicio |
|---|---|---|---|---|
| `chibalete_edge` | `nginx:alpine` | healthy | 0 | 2026-09-07T12:51:35Z |
| `chibalete_front` | `chibalete/front:ped01d-bef0afe` | healthy | 0 | 2026-09-07T12:53:18Z |
| `chibalete_api_1` | `chibalete/api:ped01d-bef0afe` | healthy | 0 | 2026-09-07T12:50:28Z |
| `chibalete_api_2` | `chibalete/api:ped01d-bef0afe` | healthy | 0 | 2026-09-07T12:49:22Z |

### 4.2 Concurrencia

Sin deploy, backup, restore, `docker build`/`compose`, `restic`, `rsync` ni migración de
datos en curso (inspección de procesos del host; los únicos `migration/N` observados son
hilos del kernel de planificación de CPU, no operaciones de datos).

### 4.3 Flags de identidad

Verificados por nombre y valor en los archivos de compose productivos, sin volcar el
entorno completo ni secretos. Cada flag aparece exactamente dos veces (una por API):

```text
IDENTITY_SQLITE_ENABLED=1
IDENTITY_DUAL_WRITE=1
IDENTITY_SHADOW_COMPARE=1
IDENTITY_READ=json
SESSION_AUTH_MODE=compat
```

## 5. Frontera de telemetría (contrato tracked)

Contrato usado, sin crear nada nuevo:

- `server/observability/metrics.js` (CHP-IDDB-M1-A):
  `chibalete_auth_session_success_total{auth_method}` = **autenticación firmada**;
  `chibalete_auth_session_legacy_x_user_id_total{source_class}` = **autenticación
  legacy/compat por `x-user-id`**; `chibalete_auth_session_failure_total{reason}` y
  `chibalete_auth_session_subject_mismatch_total` como series de apoyo.
- `docs/ops/CHP_IDDB_M1_A_LEGACY_OBSERVABILITY_SEGMENTED_01.md` +
  `docs/ops/tools/lu_segment_analyzer.py`: segmentación **primaria por User-Agent** del
  access log del edge (`ChibaleteLU/0.9.0` = SEGMENT-09; `okhttp/*` = LEGACY-LU).
  Prometheus solo cruza totales (`source_class="browser"` está fijo; los contadores se
  reinician al recrear contenedores; retención TSDB 2 semanas; edge log rota ≈7 días).

### 5.1 Conteos agregados antes de `T0` (Prometheus, `increase`)

| Ventana | Firmada (`auth_method=session`) | Legacy `x-user-id` (`browser`) | Fallos `no_identity` | Fallos `legacy_analytics_accept_drop` |
|---|---|---|---|---|
| 24 h | 0 | 0 | 5 | 0 |
| 7 d | 4 | 78 | 89 | 0 |
| 30 d | 9 | 102 | 215 | 3 |

`subject_mismatch` = 0 en ambas APIs.

### 5.2 Segmentación del edge log (analizador tracked, ventana completa disponible)

```text
Ventana edge log: 2026-09-07T12:51:45Z -> 2026-09-09T12:06:31Z
Líneas parseadas: 223 · no parseables: 25
SEGMENT-09 (ChibaleteLU/0.9.0): 0
LEGACY-LU (okhttp/*): 0
SEGMENT-NON-LU: 201 · SEGMENT-UNKNOWN: 22
```

**Lectura honesta:** en la ventana observable no hay tráfico de la app LU de ninguna
versión. La telemetría a `T0` demuestra el punto de partida (cero legacy LU, cero 0.9.0),
no actividad de la cohorte. Es la limitación ya registrada en
`CHP_IDENTITY_FIELD_MIGRATION_EVIDENCE_01.md`: el sistema demuestra versión, sesión y
cuenta, nunca dispositivo.

## 6. `T0`

Hora del VPS capturada una sola vez, en la misma lectura que el high-watermark:

```text
T0_UTC:     2026-09-09T12:07:53Z
T0_BOGOTA:  2026-09-09 07:07:53 (America/Bogota, UTC-05:00)
T0_EPOCH:   1788955673
```

### 6.1 High-watermark asociado a `T0`

Valores brutos de los contadores in-process (acumulados desde el inicio de cada
contenedor el 2026-09-07) en el instante de `T0`:

```text
chibalete_auth_session_success_total:            sin serie activa (0 firmadas desde el inicio del contenedor)
chibalete_auth_session_legacy_x_user_id_total:   api_1=16 · api_2=33 (source_class=browser) · suma=49
chibalete_auth_session_failure_total:            api_1=5 · api_2=5 (reason=no_identity)
chibalete_auth_session_subject_mismatch_total:   api_1=0 · api_2=0
Prometheus time():                               1788955673.839
Último scrape de la serie legacy:                1788955673.163
Edge access log:                                 248 líneas · última entrada 2026-09-09T12:06:31Z · 0 líneas ChibaleteLU/okhttp
```

Toda actividad LU posterior al edge `12:06:31Z` / al scrape `1788955673.163` pertenece
al periodo de drain. Cualquier lectura futura debe restar estos valores brutos o usar
`increase()` desde `T0_EPOCH`.

## 7. Drain: inicio y criterio tracked de cierre

```text
DRAIN_STARTED_AT: 2026-09-09T12:07:53Z
```

Criterio, tomado literalmente del contrato tracked, sin modificarlo:

- `CHP_IDENTITY_FIELD_MIGRATION_EVIDENCE_01.md` §7: solo después de `T0`,
  **≥48 horas hábiles**, con los criterios ya aprobados: 0.9.0 sin regresiones · sin
  legacy incompatible · 202-drop sin crecimiento · sin 401/403 anómalos · sin 5xx
  atribuibles · UNKNOWN que no invalide la lectura · producción healthy.
- `CHP_IDDB_M1_A_LEGACY_OBSERVABILITY_SEGMENTED_01.md` §H: ventana con bloques
  escolares (martes 07:00 → jueves 19:00 COT), analizador al inicio, a diario y al
  cierre, extractos diarios del edge log preservados antes de la rotación (≈7 días),
  `query_range` de legacy / drop / session_required; STOPs = `session_required` no
  atribuible · crecimiento de 202-drop · patrón 50/50 · 5xx · 401 de SEGMENT-09 no
  pre-login.

Preservación: el edge log rota en ≈7 días y Prometheus retiene 2 semanas; la unidad de
observación debe extraer evidencia diaria antes de esos límites.

## 8. Limitaciones heredadas de la atestación

- Sin trazabilidad individual por dispositivo (renuncia solo para esta campaña).
- Sin 180 verificaciones técnicas independientes.
- Fecha uniforme del CSV = 8 de septiembre de 2026, anterior a la ventana del 9.
- El STOP técnico de la reconciliación 01C-R2 no se revierte: esta unidad se apoya en la
  decisión humana documentada, no en un GREEN técnico.
- A `T0` no hay tráfico LU observable; la eficacia de la campaña solo se verá durante el
  drain.

## 9. Estado resultante

```text
INVENTORY: CLOSED_BY_MANAGEMENT_ATTESTATION
T0_ELIGIBLE_BY_MANAGEMENT_ATTESTATION: 180
T0_AUTHORIZATION: APPROVED
T0_EXECUTION: ESTABLISHED
T0_UTC: 2026-09-09T12:07:53Z
DRAIN: STARTED_AT_T0
ENFORCE: NOT_AUTHORIZED
MOOK_PRODUCTION_ACTIVATION: NOT_AUTHORIZED
M1: AMBER-DRAIN-IN_PROGRESS
```

## 10. Privacidad y mutaciones

Este documento no contiene nombres, correos, identificadores de usuarios, sesiones,
cookies, tokens, payloads ni contenido del CSV. Cero mutaciones productivas: sin cambio
de flags, sin restart/recreate/reload, sin deploy, sin escrituras en bases o stores, sin
archivos temporales remotos, sin copias de bases. Único archivo creado en el
repositorio: este documento.

## 11. Único siguiente paso

Observar y evaluar el drain conforme al criterio de §7. **No ejecutar `ENFORCE` ni
activar MOOK en producción.**
