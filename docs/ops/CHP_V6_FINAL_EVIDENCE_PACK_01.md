# CHIBALETE+ V6 — FINAL EVIDENCE PACK

**Unidad:** `CHP-V6-FINAL-EVIDENCE-PACK-01` — Etapa 13
**Autoridad:** `CHP-ROADMAP-2026-06` (`docs/ops/CHP_ROADMAP_2026_06.md`)
**Fecha de corte:** 2026-09-23
**Lectura final read-only:** 2026-09-24 ~01:20Z (2026-09-23 ~20:20, hora de Bogotá)
**Tipo:** documentación + verificación read-only. Cero código, deploy, migraciones, flags,
reglas, memberships, lecturas o eventos generados por esta unidad.

Este es el primer registro en el repositorio de la evidencia de las Etapas 1–12: esas etapas se
cerraron con actas operativas fuera del árbol. Aquí se consolidan sobre el SHA realmente desplegado.
Los valores marcados **histórico** son los de la etapa que los produjo; los marcados **actual** se
releyeron en producción para esta unidad.

---

## 1. Resumen ejecutivo

```text
ETAPA_12:                           GREEN
M4_INTEGRATED_GATE:                 GREEN
V6_TECHNICAL_INTEGRATION:           VERIFIED_IN_PRODUCTION
IDENTITY_TO_AULA_VIVA_CHAIN:        END_TO_END_VERIFIED
READING_CANONICAL_PRODUCER:         ACTIVE
READING_CANONICAL_AT_REST:          VERIFIED
AULA_VIVA_ACTIVE_OPERATIONAL_PATH:  SERVER_SCOPED
AUTHZ_AUDITED_SCOPE:                GREEN

FIELD_TECHNICAL_EVIDENCE:           YELLOW_NO_LU_TRAFFIC
FIELD_PARTICIPATION_GATE:           WAIVED_BY_MANAGEMENT
FIELD_DEPENDENCY:                   CLOSED_BY_MANAGEMENT_RISK_ACCEPTANCE
DRAIN_TECHNICAL_RESULT:             NOT_GREEN
```

La integración técnica de V6 está demostrada en producción: identidad firmada, acceso explícito,
fallback cerrado, autorización por tenant en el alcance auditado, Biblioteca server-authoritative,
eventos de lectura canónicos en reposo, materialización hacia `insights.db` y proyección operativa
de Aula Viva acotada por servidor.

Nada de esto demuestra adopción de campo. No se afirma que los 180 dispositivos LU hayan migrado ni
que exista adopción institucional. La dependencia de campo quedó cerrada por aceptación directiva
del riesgo, no por evidencia.

---

## 2. Baseline final de runtime

Leído en producción (read-only) para esta unidad:

| Elemento | Valor |
|---|---|
| Repo local | `523b0b591a2aa6faf4ec35ac1689f29a3734c8f4` |
| `origin/chp/mook-contract-00` | `523b0b5` (local == origin) |
| `chibalete_api_1` | `chibalete/api:aggscope-523b0b5` · image `sha256:8ab55a06052936cc…` · `GIT_SHA=523b0b5` · label OCI `revision=523b0b5` · healthy · rc=0 |
| `chibalete_api_2` | la misma imagen, `GIT_SHA` y label · healthy · rc=0 |
| `chibalete_front` | `chibalete/front:aggscope-523b0b5` · image `sha256:274a8add925eb675…` · healthy · rc=0 |
| `chibalete_edge` | `nginx:alpine` · image `sha256:582c496ccf79…` · healthy · rc=0 (arrancado 2026-09-07, sin cambios en V6 salvo `nginx -s reload`) |

Flags efectivos por réplica (entorno del contenedor; sin secretos):

| Flag | api_1 | api_2 |
|---|---|---|
| `SESSION_AUTH_MODE` | `enforce` | `enforce` |
| `ACCESS_FALLBACK_MODE` | `restricted` | `restricted` |
| `INSIGHTS_MATERIALIZER_ENABLED` | `1` | `1` |
| `AULA_VIVA_SCHEDULER_ENABLED` | `1` | `1` |
| `ARCHIVE_ROTATION_ENABLED` | `1` | ausente |
| `ARCHIVE_EXPIRY_ENABLED` | ausente (OFF) | ausente (OFF) |
| `ARCHIVE_VACUUM_AFTER_ROTATION` | ausente | ausente |
| `EXPERIENCE_EVENTS_BACKBONE_ENABLED` | `1` | `1` |
| `LEO_EVENTS_BACKBONE_ENABLED` | `1` | `1` |
| `AULA_VIVA_AUDIT_EVENTS_ENABLED` | `1` | `1` |
| `IDENTITY_DUAL_WRITE` | `1` | `1` |

```text
PURGE: NOT_AUTHORIZED
V6_FINAL_RUNTIME_BASELINE: VERIFIED
```

Sin drift material. Nota de lectura: `/api/health` sigue reportando `commit=2945fa8` desde un
`.deploy-info` congelado (deuda registrada en la Etapa 1, §20). La versión se demuestra por
`GIT_SHA` y por el label OCI de la imagen, no por ese endpoint.

---

## 3. Estado por etapa (0–13)

GREEN técnico ≠ adopción de campo. Ninguna fila de esta tabla afirma adopción.

| Etapa | Estado | Evidencia principal | SHA | Excepciones |
|---|---|---|---|---|
| 0 — Adopción V6 | GREEN documental | Acta de adopción en el roadmap; RC congelado | `4a09268`, `5d863cf` | Campo: `YELLOW_NO_LU_TRAFFIC` · gate de participación `WAIVED_BY_MANAGEMENT` · drain `NOT_GREEN` |
| 1 — Preflight productivo | `GREEN_FOR_STAGE_2_ONLY` | Preflight read-only; Biblioteca Institucional/Personal no implementadas; `/api/health` con SHA falso | `cbf07a8` (rectificación) | Etapa 11 pasó a «completar implementación mínima» |
| 2 — Despliegue acumulado | GREEN | `v6rc-b8350ab` en api_2 → api_1 → front, flags intactos, `migrations applied=0` | `b8350ab` | — |
| 3 — Validación post-deploy | `ACCEPTED_FOR_STAGE_4` | Avisos IA/privacidad y 8 correcciones WCAG en DOM real; hashes de módulos en contenedor = blobs del commit | `b8350ab` | Runtime MOOK, compañero de lectura y REVIEW-01: evidencia hermética, no ejecución productiva (§18) |
| 4 — Identity ENFORCE | GREEN | Login humano: `POST /api/auth/login` 200 en ambas réplicas; sesión nueva 8×200 por réplica; `legacy_x_user_id_total` ausente | `b8350ab` | — |
| 5 — Acceso explícito | GREEN | 73 escrituras con preimagen; 13 reglas de grupo | `fd48435`, `258c8b3` | — |
| 6 — Cierre de fallback | GREEN | `restricted` en ambas réplicas; simulación 247×109×2 sin pérdida ni ganancia | — (configuración) | `.env:9` sigue diciendo `open`; gana el override (§20) |
| 7 — Aislamiento | GREEN | 4 relaciones `mediatorIds` cross-tenant corregidas; FALSE_ALLOW=0 / FALSE_DENY=0 | `7e1ed69` | — |
| 8 — Eventos | GREEN tras 2 correcciones de especificación | acción→evento→`events.db` por `mediator_reviewed_cohort`, correlacionado con logs y Prometheus | `388e8a9` | `schema_version=2` imposible por construcción; el único evento Leo del gate nació de un `POST /api/leo/recap` 500 (§20) |
| 9 — Materializador | GREEN | Drenaje en 5 ticks a wm 20.077; 1.104→1.128 snapshots; Villas `reader_cohort` 80 | `9b461de`, `90af52f` | `materializer_runs` vacío por contrato |
| 10 — Retención | GREEN | Primera rotación 6.431 filas, huella idéntica hot ∪ archive | `5b358b2` | Expiry OFF; purge no autorizado |
| 11 — Biblioteca | GREEN | 3 capas vivas, writes reversibles con restauración byte a byte, `library_db` en backup | `604a40f`, `8de5e2a`, `ba835cf`, `62741be` | Deudas de metadata de catálogo y de lock (§20) |
| 12 — Gate integrado M4 | GREEN | Cadena identidad → lectura canónica (20143–20145) → insights → Aula Viva | runtime `523b0b5` | Hubo tres STOP previos, cada uno cerrado por su unidad (authz GETs, lectura canónica, router operacional) |
| 13 — Evidence pack | PENDING → ver §25 | Este documento | ver §25 | — |

---

## 4. Procedencia de commits

Todos verificados en git como ancestros de `HEAD` (`523b0b5`); el asunto es el literal del commit.

| SHA | Parent | Fecha | Asunto | Etapa |
|---|---|---|---|---|
| `4a09268` | `b8350ab` | 2026-09-14 | docs(plan): adopt CHP-ROADMAP-2026-06 as the governing master plan | 0 |
| `5d863cf` | `4a09268` | 2026-09-14 | docs(plan): restore V6 section 11 to the source text | 0 |
| `cbf07a8` | `5d863cf` | 2026-09-14 | docs(plan): rectify V6 stage 1 and 11 after production preflight | 1 |
| `fd48435` | `cbf07a8` | 2026-09-15 | feat(access): add general idempotent explicit-access migrator (V6 stage 5) | 5 |
| `258c8b3` | `e590ae5` | 2026-09-18 | fix(access): honor inert legacy groups in explicit-access planner (V6 stage 5) | 5 |
| `7e1ed69` | `258c8b3` | 2026-09-18 | fix(access): extend cross-tenant guard to mediator channels (V6 stage 7) | 7 |
| `388e8a9` | `7e1ed69` | 2026-09-19 | fix(events): drop free-text fields from canonical event schemas (V6 stage 8) | 8 |
| `9b461de` | `bac180e` | 2026-09-21 | feat(insights): make legacy history consumable by the materializer (V6 stage 9 A1) | 9 |
| `90af52f` | `9b461de` | 2026-09-21 | fix(insights): aggregate effective reading time per session, not per event (V6 stage 9 A2) | 9 |
| `5b358b2` | `90af52f` | 2026-09-21 | fix(retention): make archive rotation safe for production (V6 stage 10B) | 10 |
| `604a40f` | `5b358b2` | 2026-09-21 | feat(library): make /biblioteca derive its catalog from the server (V6 stage 11B-1) | 11 |
| `8de5e2a` | `604a40f` | 2026-09-22 | feat(library): add INSTITUTIONAL and PERSONAL backend layers (V6 stage 11B-2) | 11 |
| `ba835cf` | `8de5e2a` | 2026-09-22 | feat(library): expose the institutional and personal layers in /biblioteca (V6 stage 11B-3) | 11 |
| `62741be` | `ba835cf` | 2026-09-22 | fix(library): cover library_db in backup and make its views no-store (V6 stage 11D) | 11 |
| `a898cf1` | `62741be` | 2026-09-22 | fix(security): scope the targeted authenticated GETs by tenant (… fase 1) | authz 1 |
| `a213765` | `a898cf1` | 2026-09-23 | fix(security): scope authenticated listing GETs by tenant (… fase 2) | authz 2 |
| `6a2c5e3` | `a213765` | 2026-09-23 | fix(security): deny cross-tenant POST /api/groups/:id/join (… fase 2B) | authz 2B |
| `238c198` | `6a2c5e3` | 2026-09-23 | test(authz): skip port 5040 in the authzSubjectScope harness | harness |
| `6be88bf` | `238c198` | 2026-09-23 | fix(library): make my-catalog no-store and drop the Offline and For You tabs (CHP-V6-LIBRARY-VISIBILITY-01) | 12 (prep.) |
| `976aad0` | `6be88bf` | 2026-09-23 | feat(events): persist new reading events with registry v2 names (CHP-V6-READING-CANONICAL-PRODUCER-01) | 12 (cutover) |
| `96c8294` | `976aad0` | 2026-09-23 | fix(security): scope the Aula Viva operational router by role and tenant (…-OPERATIONAL-SCOPE-01) | 12 (authz) |
| `523b0b5` | `96c8294` | 2026-09-23 | fix(security): keep cross-institution aggregates away from mediators in Aula Viva (…-AGGREGATE-SCOPE-02) | 12 (authz) |

Release candidate de la Etapa 2: `b8350ab` (parent `0ae72cb`). En la misma cadena hay commits ajenos a
la línea V6, desplegados por sus propias unidades: `6a3dbbd`/`e590ae5` (banner de landing) y
`bac180e` (`CHP-SEC-PASSWORD-RESET-02`).

```text
V6_COMMIT_PROVENANCE: COMPLETE
```

---

## 5. Identidad

```text
SESSION:                    SIGNED
IDENTITY_AUTHORITY:         CANONICAL
ENFORCE:                    ACTIVE
ROLLBACK:                   VERIFIED
LOGIN_SESSION_ISSUANCE:     VERIFIED_IN_PRODUCTION
NEW_SIGNED_SESSION:         ACCEPTED_BY_BOTH_REPLICAS
```

- `SESSION_AUTH_MODE: compat → enforce` por override, canary api_2 → api_1 (Etapa 4). Antes del
  cambio, `chibalete_auth_session_legacy_x_user_id_total` no tenía datos: ninguna autenticación real
  dependía de `x-user-id`.
- Emisión: login humano; `success_total{auth_method=session}` pasó de ausente a 1 en cada réplica;
  cero `[SESSION] issue failed`. La sesión nueva sirvió 200 en ambas réplicas bajo enforce.
- Rollback: override pre-enforce conservado y verificado (Etapa 4).
- `compat` / `x-user-id` **no son autoridad productiva** de la cadena M4. Bajo enforce, un
  `x-user-id` sin cookie recibe 401 (`session_required`); en la Etapa 8, un `POST /api/events` con
  identidad autoafirmada dio 401 sin escribir fila.

---

## 6. Membership y acceso

```text
MEMBERSHIPS:           EXPLICIT
ACCESS_RULES:          AUTHORITATIVE
ACCESS_FALLBACK_MODE:  RESTRICTED
FALLBACK_AUTHORITY:    CLOSED
```

**Etapa 5 (histórico, acta de 2026-09-18):** 13 grupos operacionales · 7 inertes · 241 memberships
existentes · 17 creadas · 13 reglas de grupo (89 títulos, sin caducidad) · 0 unresolved / 0
cross-tenant. 73 escrituras en total, cada una con preimagen de campo.

**Etapa 6 (histórico):** los 2 únicos lectores activos sin grupo, cuyo acceso era 100 % `LEGACY_OPEN`,
quedaron preservados con reglas canónicas `scope=user` (89 títulos). `ACTIVE_REAL_FALLBACK_DEPENDENCIES`
2 → 0. Con fallback `restricted` un fixture sin autoridad pasa de 89/109 a 0/109.

**Library visibility (histórico, 2026-09-23):** una regla administrativa `scope=user` explícita de 89
títulos, creada por `POST /api/access`; `access_db` 17 → 18.

**Actual (releído para esta unidad):**

| Medida | Valor |
|---|---|
| Reglas en `access_db.json` | **18** = 15 `group` + 3 `user` |
| Reglas `user` | 3, todas de 89 títulos (2 de la Etapa 6 + 1 administrativa) |
| Reglas `group` | 13 de 89 títulos (Etapa 5) + 2 de 64 y 86 títulos ajenas a la migración |
| Registros de grupo | 21 (20 `course` + 1 sin tipo) |
| Grupos con `availableContentIds` | 13 (= los operacionales de la Etapa 5) |

---

## 7. Autorización

Alcance auditado, **no universal**.

| Fase | Commit | Cubierto | Evidencia productiva |
|---|---|---|---|
| 1 | `a898cf1` | 5 rutas con sujeto o grupo (`access/by-user/:userId`, `students/:id/status`, `groups/:id/{members,candidates,diagnosis}`) | mediador real: 30/30 403 cross-tenant y 30/30 200 propio |
| 2 | `a213765` | listados (`/api/users`, `/api/groups`, `/api/schools`, `schools/:name/config`) por tenant; 4 rutas admin/system/config admin-only | sonda 48/48 en ambas réplicas; lector y mediador: 90 usuarios, 1 grupo, 1 colegio |
| 2B | `6a2c5e3` | `POST /api/groups/:id/join` solo dentro del tenant; ajeno == inexistente | sonda 10/10; sha del groups store idéntico antes y después |
| Aula Viva operacional | `96c8294` | 17 rutas con rol (mediador/admin) + scope CIS; lector 403 | sonda 29/29 en ambas réplicas |
| Agregado Aula Viva | `523b0b5` | mediador acotado a su grupo; `all/global` solo admin | mediador real: «Lectores activos» 49 → 2; `all/global` 403 |

```text
AUTHZ_AUDITED_SCOPE: GREEN
KNOWN_CROSS_TENANT_AUTHZ_BYPASS: ZERO_WITHIN_AUDITED_ACTIVE_SCOPE
```

**No se declara** `ALL_ENDPOINTS_AUTHZ_AUDITED`. El router institucional de Aula Viva queda fuera
(§20, `AULA_VIVA_INSTITUTIONAL_ROUTER_SCOPE`).

---

## 8. Aislamiento

**Etapa 7 (histórico):**

- `assertNoCrossTenant` no inspeccionaba `mediatorIds` ni `teacherId`: 4 relaciones cross-tenant de
  2 mediadores atravesaron las Etapas 5 y 6 sin ser detectadas.
- Corregido en `7e1ed69` (guard extendido a los 4 canales) y datos saneados retirando esas 4
  relaciones por `PUT /api/groups/:id`.
- Simulación con el servidor real sobre copias aisladas y un oráculo independiente: 247 activos ×
  109 contenidos → `FALSE_ALLOW=0`, `FALSE_DENY=0`, `FALLBACK_REASON_OBSERVED=0`.

**Etapa 12 (histórico, mediador real de Villas en `523b0b5`):**

| Sonda | Resultado |
|---|---|
| Aula Viva operacional, cohorte de grupo ajeno | 403 |
| feature-vector de estudiante ajeno | 403 |
| recomendaciones de ámbito ajeno | 403 |
| `POST /api/groups/:id/join` a grupo ajeno | 403 |
| `cohorts/all/global` como mediador | 403 |
| cola de atención | acotada por CIS: solo el lector testigo de su grupo |
| `/api/users` · `/api/groups` | 90 usuarios, 0 ajenos · solo su grupo |

---

## 9. Biblioteca

- Las referencias de Biblioteca son **presentación y curaduría**, no autoridad de acceso.
- La autorización es server-side: `my-catalog` y `/api/content/:id/access` sobre acceso explícito.
- Capas: **EDITORIAL · INSTITUTIONAL · PERSONAL**, las tres vivas desde 11C.
- UI final de `/biblioteca`: **8 pestañas**: Libros · Experiencias · Mi biblioteca · Biblioteca
  institucional · Selección Chibalete · Libros Álbum · Continuar Leyendo · Comunidad. Se retiraron
  «Disponibles Offline» y «Para Ti» (`6be88bf`).
- `my-catalog` y las 3 vistas Library: `Cache-Control: no-store` (autenticado). El 401 anónimo de
  `my-catalog` no lleva la cabecera porque lo corta un middleware previo; es el comportamiento
  esperado.
- Administrador: 89 títulos por regla explícita. **No hay bypass por rol** (demostrado en 11C: admin
  sin regla = catálogo 0 y 403 `organization_required` al escribir en la capa institucional).
- Lector testigo: 89 títulos.
- Las capas vacías que se observaron durante las etapas eran estados vacíos legítimos (sin
  referencias guardadas o sin entitlement), no fallos.
- 11C/11D: altas y bajas reales en PERSONAL e INSTITUTIONAL con entitlement byte-idéntico en los cinco
  momentos medidos y `library_db.json` devuelto al sha exacto de la preimagen.

---

## 10. Registry de eventos

```text
REGISTRY_VERSION:            2
CANONICAL_EVENT_TYPES:       80
PER_EVENT_SCHEMA_VERSION:    1
CANONICAL_FREE_TEXT_FIELDS:  0
```

`REGISTRY_VERSION` es la versión del documento registry; `schema_version` es la de cada tipo. Los 80
tipos declaran `version: 1`, y `recordCanonicalEvent` escribe `schema_version=1` solo si la
validación pasó: por eso `schema_version=1` es prueba de validación, y `schema_version=2` es imposible
por construcción. `388e8a9` eliminó los 2 campos de texto libre que existían
(`teacher_created_intervention.note` e `immersive_runtime_error.message`) sin cambiar
`REGISTRY_VERSION`.

Backbones: Aula Viva audit **activo** (`mediator_reviewed_cohort`, `teacher_viewed_student`) · Leo
**activo** (`leo_*`) · Experience/MOOK **flag activo**, sin eventos productivos observados (no hubo
acción MOOK real, por la excepción de §18) · Lectura: productor canónico añadido después, en
`976aad0` (§11).

---

## 11. Cutover canónico de lectura

```text
CANONICAL_READING_CUTOVER: 976aad0 · 2026-09-23T17:21:40Z
(preimagen: MAX(id) de events.db = 20138)
```

**Antes del cutover.** La lectura real persistía nombres v1/legacy (`text.session_start`,
`text.session_heartbeat`, `immersive.*`, `album.*`, `a11y.*`…). El materializador los traducía con
el normalizador de la Etapa 9. Había doble conteo de inicio y fin de sesión, porque el hook nativo
y el dual-write legacy registraban el mismo hecho.

**Después del cutover.** `/api/v1/events` traduce en el servidor y persiste nombres del registry v2
por `recordCanonicalEvent`: `reading_started`, `session_heartbeat`, `session_ended`,
`reading_progress` y `reading_completed`, según la acción real. El dual-write legacy ya no escribe
start/heartbeat/end en `events.db`.

**Validación productiva (histórico, 17:35–17:40Z):**

| id | evento | schema | modo (columna / payload) |
|---|---|---|---|
| 20143 | `reading_started` | 1 | `text` / `guided` |
| 20144 | `session_heartbeat` | 1 | `text` / `guided` |
| 20145 | `session_ended` | 1 | `text` / `guided` |

Una sola sesión; válidas contra el registry v2; en HOT; sin equivalente legacy (el cliente mandó
los 3 POST legacy, que dieron 200 y dejaron 0 filas en `events.db`); sin doble conteo; payload
construido campo a campo, sin texto libre; modo correcto.

**Relectura para esta unidad:** las filas 20143–20145 siguen en HOT con el mismo evento, schema y
modo; `events.db` no tiene `event_id` duplicados. Desde el cutover, **0 filas v1 del ciclo de
lectura** (`*.session_start`, `*.session_heartbeat`, `*.session_end`, progreso o completado): los
nombres de lectura post-cutover son todos canónicos (9 `reading_started`, 17 `session_heartbeat`,
9 `session_ended`, 11 `reading_progress`).

**Precisión de alcance.** Tras el cierre de M4 (wm 20193), la actividad orgánica en Modo Inmersivo
dejó 27 filas `immersive.*` con nombre v1 (ids 20194–20233: `audio_play`, `audio_pause`,
`chunk_audio_reuse`, `pb_audio_preparing`, `tts_fail`…). Son telemetría de reproducción sin
equivalente declarado en el registry. `toCanonicalReadingEnvelope` devuelve `null` para ellas y el
llamador conserva su camino v1, **por contrato de `976aad0`**. No es drift. La afirmación exacta es
«0 filas v1 del ciclo de lectura post-cutover», no «0 filas v1».

```text
READING_CANONICAL_AT_REST: VERIFIED
LEGACY_NORMALIZER:         HISTORICAL_COMPATIBILITY
```

La historia anterior al cutover no se reescribe.

---

## 12. Eventos → Insights (M4)

```text
lectura real → filas 20143–20145 → events.db → materializador → watermark ≥ 20145
→ perfil y señales → rollup de cohorte → Aula Viva
```

- Materializador en la evidencia de M4: `degraded=0`, `last_error=null`, lag 0. El perfil del testigo
  se actualizó unos 49 s después de la fila 20145.
- Semánticas que se verificaron: `continuidad_semanal`, `diversidad_lectora`,
  `tiempo_efectivo_lectura` (en minutos redondeados: 29,6 s → 0) y `active_users` del rollup de
  grupo a 28 días.
- Valores del testigo (histórico): pre-test `active_users=0/80` → primer witness **1/80** → después,
  la actividad orgánica llevó el valor a 2/80. Los valores actuales pueden haber cambiado por uso real
  y no se presentan como fijos.

---

## 13. Aula Viva

| Superficie | Estado |
|---|---|
| `operational/status` | `ready` |
| cohorte | derivada de `insights.db` |
| feature vectors | acotados por scope (propio 200, ajeno 403) |
| cola de atención | acotada por CIS para mediador; global para admin |
| router operacional | `SERVER_SCOPED` (rol + scope en las 17 rutas) |
| `all/global` | mediador 403 · admin conservado |
| Centro operativo del mediador | agregado de su propio scope, no global |

**No se declara** `AULA_VIVA_ALL_ROUTERS_AUDITED`: el router institucional tiene un residual
previo a la activación (§20).

---

## 14. Materializador

```text
MATERIALIZER:                ACTIVE
SCHEDULER:                   ACTIVE
INSIGHTS_DB:                 MATERIALIZED
EVENTS_TO_INSIGHTS:          VERIFIED_IN_PRODUCTION
AULA_VIVA_OPERATIONAL:       READY
READER_COHORT_AUTHORITY:     GROUP_READERS
CURRENT_28D_SEMANTICS:       VERIFIED_IN_PRODUCTION
```

- La historia legacy (anterior al cutover) entra normalizada por el adaptador de `9b461de`. El
  tráfico canónico posterior al cutover se consume directamente: el normalizador es identidad sobre
  un nombre canónico.
- La cohorte lectora es la de lectores del grupo: Villas `reader_cohort=80` = 90 cuentas menos 10
  mediadores.
- **Actual:** `materializer_state` = `last_event_id 20263`, `lag_events 0`, `degraded 0`,
  `last_error null`; 1.176 `signal_snapshots`, 49 `user_reading_profiles`, 31 `cohort_rollups`.

---

## 15. Retención

```text
HOT:                           90 días
ARCHIVE:                       hasta 12 meses (política aprobada, 02a4708)
ARCHIVE_EXPIRY:                OFF
PURGE:                         NOT_AUTHORIZED
ROTATION:                      ON — solo api_1
HOT_PLUS_ARCHIVE:              LOSSLESS
REBUILD_FROM_ARCHIVE:          VERIFIED_IN_PRODUCTION
```

- **Etapa 10 (histórico):** primera rotación natural: 6.431 filas movidas, `expired=0`, 885 ms. La
  huella sha256 de las 14 columnas de las 20.034 filas preexistentes es idéntica al reconstruirla
  desde hot ∪ archive. `rebuildInsights` lee hot ∪ archive (rebuild antes == después). Villas es
  reproducible: 16.130 eventos / 36 usuarios.
- **Actual:** hot 12.738 filas `[7505..20263]` + archive 7.481 filas `[1..7504]`, sin solape, ambas
  bases con `quick_check ok`. Las rotaciones posteriores siguieron moviendo filas antiguas. Los eventos
  canónicos de M4 (20143–20145) están en HOT.
- No se ha probado ninguna purga ni expiración.

---

## 16. Backup y recuperación

**Baseline M4 (histórico):** snapshot **`08093b69`** (2026-09-23T13:14:37Z), 29 stores + topología,
`access_db` con `aggregate_count 18`, más `library_db`, `events.db`, `events.archive.db`,
`insights.db`, `identity.db`, `groups_db`, el padrón `usuarios_colegios_oro.json` y `users_db`.

**Actual:** último `structured-backup` el 2026-09-24T00:02:32Z, `result ok`, snapshot `3551a071`,
manifiesto de 31 entradas (29 stores + 2 archivos de topología), todas con `integrity_result ok`.

Evidencia de restore anterior:

- 11D: restore aislado de `library_db.json` desde el snapshot `0bf58390` → `cmp` byte-idéntico al
  productivo.
- Etapa 10: primer backup con `events.archive.db` capturado por la API de backup online de SQLite,
  `integrity ok` (snapshots `937c9fc4` → `455be7c6`).
- Suite de backup: 129/130 PASS, 1 SKIP, con toolchain sustituto (ver deuda).

```text
BACKUP_TEST_TOOLCHAIN_REPRODUCIBILITY: OPEN_DEBT
```

No se ha ensayado un restore completo del sistema desde el repositorio restic productivo; solo
restores de stores aislados.

---

## 17. Cadena causal M4

| # | Paso | Evidencia | Autoridad | Resultado |
|---|---|---|---|---|
| 1 | Sesión firmada | login humano del lector testigo (13:22:57Z) | `sessions.db` + cookie HttpOnly firmada, enforce | OK |
| 2 | Identidad canónica | sujeto resuelto sin `x-user-id` | CIS / `identity.db` | OK |
| 3 | Membership explícita | 1 membresía ACTIVE_REAL en un curso de Villas | `groups_db` (canales explícitos) | OK |
| 4 | Acceso explícito | regla de grupo de 89 títulos, sin caducidad | `access_db.json` | OK |
| 5 | `my-catalog` | 200 no-store, 89 títulos | servidor | OK |
| 6 | Tarjeta visible en Biblioteca | «La metamorfosis» visible | derivada de `my-catalog` | OK |
| 7 | Preflight de contenido | `GET /api/content/:id/access` → allow (304 sobre 200 idéntico); Y fuera de la regla → 403 | servidor | OK |
| 8 | Lectura real | Modo Guiado, lector humano | cliente → `/api/v1/events` | OK |
| 9 | Evento canónico | 20143–20145, registry v2, schema 1 | `recordCanonicalEvent` | OK |
| 10 | `events.db` | HOT, sin duplicados, sin legacy equivalente | SQLite | OK |
| 11 | Materializador | wm 20138 → 20145, lag 0 | `materializer_state` | OK |
| 12 | `insights.db` | perfil y señales del testigo; rollup del grupo 0 → 1/80 | SQLite | OK |
| 13 | Aula Viva operacional | mediador real ve al testigo en su cohorte y en su cola de atención; nada ajeno | router operacional con rol + CIS | OK |

```text
M4_AUTHORITY_CHAIN: CONSISTENT
PARALLEL_AUTHORITY: ZERO_IN_M4_ACTIVE_CHAIN
```

---

## 18. Excepción de validación en producción

En las fases tempranas (Etapa 3), ejecutar en producción las acciones reales de Runtime MOOK,
compañero de lectura (LeoCompanion) y REVIEW-01 habría producido escrituras productivas: resumir un
run reescribe el store (`RUN-RESUME-WRITE-ON-READ`), el visor dispara el recap de Leo y el progreso, y
no había entregas reales que abrir en Review. Por decisión de gestión, esas superficies se validaron
por evidencia hermética: suite estructural 195/195 y hashes de los módulos dentro de los
contenedores iguales a los blobs del commit desplegado. El resultado fue
`V6_WCAG_GATE: ACCEPTED_BY_MANAGEMENT_WITH_DOCUMENTED_EXCEPTION`.

Esa evidencia sigue siendo hermética. No se reclasifica después como una acción real que no
ocurrió.

---

## 19. Estado de campo y adopción

```text
FIELD_TECHNICAL_EVIDENCE:  YELLOW_NO_LU_TRAFFIC
FIELD_PARTICIPATION_GATE:  WAIVED_BY_MANAGEMENT
FIELD_DEPENDENCY:          CLOSED_BY_MANAGEMENT_RISK_ACCEPTANCE
DRAIN_TECHNICAL_RESULT:    NOT_GREEN
```

V6 puede cerrarse técnicamente sin afirmar adopción del parque. T0 quedó establecido el
2026-09-09T12:07:53Z. La ventana de drain (125 h con jornadas escolares completas) registró cero
tráfico LU. La ausencia de tráfico no demuestra migración ni uso.

**No se afirma:** que los 180 LU hayan migrado · uso real del nuevo camino de identidad en todo el
parque · compromiso de los pilotos · adopción institucional demostrada.

---

## 20. Deudas abiertas

Solo deudas ya observadas en etapas previas o riesgos demostrados. Ninguna se corrige en esta
unidad.

| Deuda | Estado | Impacto | ¿Bloquea V6? | Condición de activación |
|---|---|---|---|---|
| `GENERAL_CATALOG_METADATA_EXPOSURE` | OPEN_DEBT | el bootstrap de `/biblioteca` hace 2 `GET /api/content` (metadata del catálogo general); el conjunto visible lo decide `my-catalog` | No | — |
| `LIBRARY_LOCK_INTERNAL_ERROR_DISCLOSURE` | OPEN_DEBT | una ráfaga de ~120 escrituras agota el lock (8 s) y devuelve 500 con el PID en el cuerpo | No | — |
| `BACKUP_TEST_TOOLCHAIN_REPRODUCIBILITY` | OPEN_DEBT | la imagen fijada por digest ya no existe; la suite corre con un sustituto `python:3.12-slim` | No | — |
| `DEBT_LEO_RECAP_500` | OPEN | un `POST /api/leo/recap` 500 (2026-09-19), causa no determinable porque los logs se perdieron al recrear | No | — |
| `AUDIT_FIDELITY_MEDIATOR_REVIEWED_COHORT_POLLING` | OPEN | `mediator_reviewed_cohort` cuenta requests (polling ~5 s, incluso 304), no actos de revisión; 46 filas desde el cutover | No | — |
| `ATTENTION_ENDPOINT_RISK_ZERO` | OPEN | la cola filtra `abandono_risk IS NOT NULL`, no el umbral 0,5 de su comentario; ya acotada por CIS | No | — |
| `MATERIALIZER_RUNS_EMPTY` | DOCUMENTED_NONBLOCKING | `materializer_runs` = 0 filas por contrato (pertenece a otro subsistema); releído: 0 | No | no usarla como gate |
| `PROGRESS_ITEM_ROUTE_NOT_SESSION_AWARE` | OPEN_DEBT | `GET /api/progress/item/:userId/:contentId` sin middleware de sesión → 403 al propio dueño bajo enforce; el sync sigue 200 | No | — |
| `PRE_CUTOVER_READING_DOUBLE_COUNT` | HISTORICAL_DEBT | starts/ends anteriores al cutover contados por dos productores; no se reescriben | No | — |
| `LEGACY_DUAL_WRITE_MODE_INFERENCE` | HISTORICAL_DEBT | el dual-write legacy infería el modo (inmersivo → `text`) en filas anteriores al cutover | No | — |
| `CLAUDE_MD_ACCESSIBLE_MODE_STATUS` | STALE_DOCUMENTATION | CLAUDE.md da `a11y` como «sin implementar», pero `/leer/accesible/:id` está vivo (82 eventos) | No | — |
| `ACCESS_DB_CACHE_PROPAGATION` | UP_TO_30_SECONDS_BY_CURRENT_CACHE_CONTRACT | una regla nueva tarda ≤30 s en verse en la réplica que no la escribió | No | — |
| `AULA_VIVA_INSTITUTIONAL_ROUTER_SCOPE` | PRE_ACTIVATION_DEBT | `institutionalRouter.mjs` autoriza 8 rutas con scope `'all'` que el CIS concede al mediador (`follow-up-queue` es por estudiante; `cohorts/:id/members` puede cruzar tenant). Motores inactivos y tablas vacías (releído: `cohort_memberships`, `cohort_definitions`, `pedagogical_interventions`, `pedagogical_recommendations`, `institutional_learnings`, `intervention_outcomes` = 0 filas) | No (exposición latente, no activa) | **MUST_CLOSE_AUTHZ_BEFORE_ENGINE_ACTIVATION** |

Otras deudas registradas en etapas previas y todavía vigentes, releídas para esta unidad:

| Deuda | Estado | Impacto | ¿Bloquea V6? |
|---|---|---|---|
| `HEALTH_ENDPOINT_STALE_COMMIT` (Etapa 1) | OPEN_DEBT | `/api/health` reporta `2945fa8` por un `.deploy-info` congelado | No: la versión se demuestra por `GIT_SHA` y el label OCI |
| `ACCESS_FALLBACK_ENV_SOURCE` (Etapa 6) | OPEN_DEBT | `.env` conserva `ACCESS_FALLBACK_MODE=open`; el valor efectivo `restricted` viene del override por réplica | No, mientras el override se mantenga |

```text
PRE_ACTIVATION_BLOCKERS:
  AULA_VIVA_INSTITUTIONAL_ROUTER_SCOPE → MUST_CLOSE_AUTHZ_BEFORE_ENGINE_ACTIVATION
  ARCHIVE_EXPIRY / PURGE               → requieren decisión humana y unidad sistémica propia (roadmap §9)
```

---

## 21. Mapa de rollback y recuperación

Solo se lista lo ensayado o conocido.

| Autoridad | Rollback | Estado |
|---|---|---|
| Identidad | override `pre-enforce` (Etapa 4) | verificado |
| Deploy de imágenes | imagen previa + override por paso; cada unidad dejó su `ROLLBACK` (p. ej. `/root/chp-aggscope-deploy/`, imagen previa `avscope-96c8294`) | procedimiento conocido, usado en cada despliegue escalonado |
| Acceso | backup estructurado + preimágenes (manifiesto de 73 preimágenes de la Etapa 5; `access_db.pre.json` de la regla administrativa) | preimagen disponible; no existe `DELETE` de reglas |
| Fallback | borrar las 2 líneas `restricted` del override | conocido |
| Retención | snapshots previo y posterior a la rotación (`937c9fc4` / `455be7c6`) | snapshots existentes |
| Biblioteca | cobertura canónica de `library_db` en backup; restore aislado byte a byte (11D) | verificado para el store |

No se afirma ningún rollback que no se haya ensayado. El restore completo del sistema desde restic
no está demostrado (§16).

---

## 22. Matriz de afirmaciones

| Categoría | Afirmación |
|---|---|
| **PROVEN** | Integración técnica V6 en producción |
| PROVEN | Identidad canónica con sesión firmada (enforce) |
| PROVEN | Membership y acceso explícitos |
| PROVEN | Fallback `restricted` |
| PROVEN | Aislamiento por tenant en el alcance authz auditado |
| PROVEN | Autoridad server-side de Biblioteca |
| PROVEN | Eventos canónicos de lectura en reposo después del cutover |
| PROVEN | events → materializador → insights |
| PROVEN | Proyección operacional activa de Aula Viva |
| PROVEN | Retención hot ∪ archive lossless y rebuild |
| PROVEN | Cobertura de backup de los stores del contrato |
| **NOT PROVEN** | Adopción de LU en todo el parque |
| NOT PROVEN | Adopción de campo |
| NOT PROVEN | Auditoría de todos los routers de Aula Viva |
| NOT PROVEN | Auditoría authz de todos los endpoints de la API |
| NOT PROVEN | Purga / expiración |
| NOT PROVEN | Que los motores institucionales inactivos sean seguros en authz |
| NOT PROVEN | Restore completo del sistema desde el repositorio restic productivo |
| **MANAGEMENT ACCEPTED / WAIVED** | Participación de campo |
| MANAGEMENT ACCEPTED / WAIVED | Dependencia de campo |
| MANAGEMENT ACCEPTED / WAIVED | Excepciones de validación en producción registradas (§18) |

```text
V6_CLAIM_MATRIX: COMPLETE
```

---

## 23. Snapshot final de salud

Lectura read-only del 2026-09-24 ~01:20Z:

| Check | Resultado |
|---|---|
| Contenedores | 4/4 healthy, RestartCount=0 |
| api_1 / api_2 | mismo `GIT_SHA` `523b0b5` y misma imagen `8ab55a06052…` |
| Frontend | `front:aggscope-523b0b5`, image `274a8add925e…` (el artefacto esperado) |
| 5xx (6 h, por réplica) | 0 / 0 |
| `level >= 50` (6 h, por réplica) | 0 / 0 |
| Materializador | lag 0, degraded 0, `last_error` null |
| Timer de backup | `structured-backup` success 00:02:32Z; próximo 06:01Z |
| `events.db` | `quick_check ok`, 0 `event_id` duplicados |
| `events.archive.db` | `quick_check ok` |
| `insights.db` | `quick_check ok`, 25 tablas |

```text
V6_FINAL_HEALTH: GREEN
```

---

## 24. Revisión de consistencia

Se revisó este documento buscando:

- afirmaciones incompatibles entre secciones;
- SHAs equivocados (todos contrastados con `git log`);
- conteos obsoletos presentados como actuales (los valores actuales se releyeron; los históricos van
  marcados);
- afirmaciones más fuertes que la evidencia;
- confusión entre legacy y canónico;
- adopción de campo presentada como GREEN;
- «all routers audited»;
- una purga autorizada de forma implícita.

Corrección aplicada durante la revisión: la afirmación de la Etapa 12 «0 v1 post-cutover» se acotó
a «0 filas v1 **del ciclo de lectura** post-cutover», porque la telemetría inmersiva sin equivalente
canónico persiste como v1 por contrato (§11).

```text
EVIDENCE_PACK_INTERNAL_CONSISTENCY: GREEN
```

---

## 25. Gates de la Etapa 13 y cierre formal

```text
V6_FINAL_RUNTIME_BASELINE:            VERIFIED
V6_COMMIT_PROVENANCE:                 COMPLETE
V6_CLAIM_MATRIX:                      COMPLETE
M4_AUTHORITY_CHAIN:                   CONSISTENT
V6_FINAL_HEALTH:                      GREEN
EVIDENCE_PACK_INTERNAL_CONSISTENCY:   GREEN
FIELD_TECHNICAL_EVIDENCE:             YELLOW_NO_LU_TRAFFIC
FIELD_ADOPTION_GREEN_CLAIM:           ABSENT
OPEN_DEBTS:                           PRESERVED
PRE_ACTIVATION_BLOCKERS:              EXPLICIT
DOCUMENTATION_ONLY_CHANGE:            TRUE
V6_EVIDENCE_PACK_SHA:                 PUBLISHED (commit que introduce este archivo)
```

```text
ETAPA_13:                         GREEN
CHP-V6-FINAL-EVIDENCE-PACK-01:    GREEN
PLAN:                             CHP-ROADMAP-2026-06
V6_TECHNICAL_IMPLEMENTATION:      CLOSED
V6_TECHNICAL_INTEGRATION:         VERIFIED_IN_PRODUCTION
M4_INTEGRATED_GATE:               GREEN
V6:                               CLOSED_WITH_RECORDED_FIELD_LIMITATIONS_AND_OPEN_DEBTS
```

V6 no se declara «fully complete» sin esa cláusula, y no se declara `FIELD_ADOPTION: GREEN`.
