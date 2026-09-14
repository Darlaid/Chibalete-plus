# PLAN MAESTRO DE EJECUCIÓN — CHIBALETE+ V6

**Código:** `CHP-ROADMAP-2026-06`
**Fecha de corte:** 14 de septiembre de 2026
**Estado:** transición controlada de arquitectura local completa a producción
**Sustituye operativamente:** `CHP-ROADMAP-2026-05`
**Avance global indicativo:** ≈85 %
**Autoridad real:** gates demostrados, no porcentajes

---

## 0. Decisión ejecutiva de V6

V5 organizó correctamente el cierre de las autoridades transversales. Desde entonces quedaron
terminadas y publicadas la arquitectura y la evidencia local de M2–M5.

La situación actual ya no exige construir nuevas capacidades. Exige desplegar, activar y demostrar
en producción lo que está terminado.

La Dirección establece además esta regla:

> Mientras Chibalete+ opere pilotos no remunerados, la participación de las entidades y sus índices
> de compromiso serán variables. Su inactividad no puede funcionar como bloqueo indefinido del
> desarrollo ni del despliegue. La ausencia de tráfico no demuestra adopción, migración o uso; ese
> límite se conserva documentalmente, pero la Dirección acepta el riesgo y autoriza continuar.

Consecuencias:

- el YELLOW técnico del drain de LU permanece intacto;
- no se afirma que los 180 dispositivos hayan migrado;
- la dependencia de campo deja de bloquear el release;
- la actividad de pilotos no pagos pasa de gate de liberación a indicador de adopción;
- los futuros contratos pagos podrán establecer gates obligatorios de participación, adopción o
  servicio;
- M1 puede avanzar hacia ENFORCE, acceso explícito y aislamiento mediante rollout controlado y
  rollback;
- M2–M5 pueden pasar de LOCAL_ONLY a producción.

V6 no abre arquitectura nueva. Establece una sola línea de ejecución hasta el cierre productivo.

---

## 1. Objetivo único

Llevar a producción el conjunto validado de Chibalete+ y cerrar los gates técnicos pendientes de
M1–M5, mediante:

1. despliegue del código acumulado;
2. enforcement controlado de identidad;
3. acceso y memberships explícitos;
4. cierre del fallback abierto;
5. activación de eventos y proyecciones;
6. activación de retención;
7. activación de Biblioteca Institucional y Personal;
8. validación integral;
9. publicación del evidence pack productivo final.

No se crean productos, plataformas, stores, servicios ni superficies nuevas.

---

## 2. Estado de partida vinculante

### 2.1 Repositorio

```text
Rama: chp/mook-contract-00
HEAD publicado al corte: b8350ab4b18dc91b43f694829918dc18aa2b1159
M2–M5_ARCHITECTURE: COMPLETE
M2–M5_LOCAL_EVIDENCE: COMPLETE
RELEASE_AUTHORIZATION: NOT_EXECUTED
```

### 2.2 Producción

- Imagen desplegada: `ped01d-bef0afe`
- Imagen anterior al conjunto LOCAL_ONLY.
- Identidad: modo compatibilidad.
- `ENFORCE`: no ejecutado.
- `ACCESS_FALLBACK_MODE`: abierto según la última evidencia productiva.
- Backbone canónico de eventos: apagado.
- Rotación y retención: apagadas o sin activación productiva demostrada.
- Biblioteca Institucional y Personal: no activadas.
- M1: drain técnico sin evidencia LU.

### 2.3 Dependencia de campo

El intervalo posterior a T0 acumuló 125 horas con producción saludable, pero:

- cero tráfico LU 0.9.0;
- cero tráfico LU de otra versión;
- cero tráfico LU legacy;
- cero bloques escolares con actividad.

Estado preservado:

```text
FIELD_TECHNICAL_EVIDENCE: YELLOW_NO_LU_TRAFFIC
FIELD_PARTICIPATION_GATE: WAIVED_BY_MANAGEMENT
FIELD_DEPENDENCY: CLOSED_BY_MANAGEMENT_RISK_ACCEPTANCE
T0: ESTABLISHED
DRAIN_TECHNICAL_RESULT: NOT_GREEN
```

La falta de actividad no se reclasifica como éxito técnico.

---

## 3. Barandas permanentes

### 3.1 Cero sobreingeniería

Extender y operar exclusivamente mecanismos existentes.

Prohibido crear: servicios paralelos · stores adicionales · schedulers nuevos · pipelines alternos ·
capas de identidad o permisos nuevas · sistemas de eventos, analítica o catálogo paralelos ·
frameworks de despliegue o compliance · abstracciones sin consumidor inmediato.

### 3.2 Cero digresiones fútiles

Cada unidad debe corresponder a un paso numerado de V6.

No trabajar: deudas no bloqueantes · warnings globales · scanners heredados · incidentes históricos
ya documentados · mejoras estéticas · refactors preventivos · funcionalidades futuras · segundos
MOOK como prueba artificial.

### 3.3 Cero código innecesario

Solo se modifica código cuando sea indispensable para: desplegar · activar un mecanismo ya aprobado ·
cerrar un gate productivo · corregir una regresión demostrada.

Una función existente sin invocador podrá recibir únicamente el wiring mínimo al scheduler o
configuración existentes. Esto no autoriza crear otro scheduler, servicio o sistema.

### 3.4 Cero casuística

No se abren unidades para: una cuenta · un dispositivo · una institución particular · una fila · un
evento · una evidencia sintética · una excepción aislada.

Toda solución debe expresar un invariante general, una migración de cohorte completa o un
procedimiento operativo reproducible.

### 3.5 Cero acciones destructivas no autorizadas

Prohibidos: `stash` · `clean` · `reset` · `checkout --` · amend o rebase · force-push · worktrees ·
junctions · symlinks · borrado, movimiento o truncamiento de stores y activos · purgas históricas
sin autorización humana específica.

`data/`, `data-critical/`, uploads, libros, textos, audios, imágenes, PDF y corpus editorial son
datos críticos protegidos.

---

## 4. Arquitectura congelada

No se reabren: identidad canónica existente · CIS como autoridad de alcance · catálogo canónico ·
Runtime MOOK · Studio · Review · cinco superficies de producto · seis eventos registrados ·
`events.db` · `insights.db` · materializador · rotador de eventos · backup estructurado · proyección
`experience_insights` · navegación y retorno contextual · versiones publicadas inmutables · ausencia
de ranking y diagnóstico automático · minimización de payloads, logs y evidencia de Leo · avisos de
IA y privacidad · correcciones WCAG de las cinco superficies.

Los cambios publicados entre V5 y V6 se tratan como release candidate, no como backlog de
arquitectura.

---

## 5. Estado actualizado por hito

| Hito | Arquitectura | Validación local | Producción | Estado V6 |
|---|---|---|---|---|
| Fase 0 | Completa | Completa | Operativa | GREEN |
| M1 | Completa para rollout | Probada | Enforcement y acceso pendientes | AMBER |
| M2 | Completa | Completa | Sin activar | AMBER operativo |
| M3 | Completa | Completa | Sin desplegar | AMBER operativo |
| M4 | Completa | Completa | Capas y gate integral pendientes | AMBER operativo |
| M5 | Completa en alcance aprobado | Evidence pack reproducible | Cambios no desplegados | AMBER release |

No queda arquitectura general pendiente.

---

## 6. Línea única de ejecución

No habrá carriles paralelos. Cada paso comienza únicamente cuando el anterior cierre en GREEN o en
una aceptación humana explícita prevista por este plan.

| Orden | Unidad | Resultado obligatorio |
|---:|---|---|
| 0 | Adopción de V6 | Plan publicado y release candidate definido |
| 1 | Preflight productivo consolidado | Viabilidad, alcance y rollback demostrados |
| 2 | Despliegue del código acumulado | Código nuevo live con flags intactos |
| 3 | Validación posterior al despliegue | LOCAL_ONLY demostrado en producción |
| 4 | Identity ENFORCE controlado | Sesión firmada como autoridad productiva |
| 5 | Acceso y memberships explícitos | Cohorte completa migrada idempotentemente |
| 6 | Cierre de fallback | `ACCESS_FALLBACK_MODE` deja de estar abierto |
| 7 | Gate de aislamiento | Positivos y negativos productivos demostrados |
| 8 | Activación de eventos | Eventos canónicos persistiendo |
| 9 | Activación del materializador | Proyecciones reconstruidas y reconciliadas |
| 10 | Activación de retención | Rotación y expiración gobernadas |
| 11 | Activación de Biblioteca | Capas Institucional y Personal operativas |
| 12 | Gate integrado M4 | Cinco superficies y autoridades verificadas |
| 13 | Evidence pack productivo | Release final reproducible y publicado |

No se altera este orden para trabajar deudas laterales.

---

## 7. Contrato de ejecución por etapa

### Etapa 0 — Adoptar V6

Publicar este plan como única autoridad de ejecución.

Debe registrar: baseline local y productiva · decisión sobre pilotos no remunerados · cierre
administrativo de la dependencia de campo · línea única V6 · release candidate · barandas y stop
conditions.

No modifica producción ni código funcional.

```text
V6_AUTHORITY: PUBLISHED
FIELD_DEPENDENCY: CLOSED_BY_MANAGEMENT_RISK_ACCEPTANCE
RELEASE_LINE: AUTHORIZED
```

### Etapa 1 — Preflight productivo consolidado

Comparar de forma read-only: HEAD candidato y remoto · imagen productiva vigente · archivos
cambiados desde la imagen desplegada · contratos y migraciones · flags actuales · mecanismos de
activación · capacidad · backups · salud · concurrencia · orden de rollout · rollback por imagen y
configuración.

Debe identificar expresamente si cada capacidad tiene un camino real de activación.

Una función sin invocador no se declarará activable. Si `pruneSignalSnapshots` continúa sin
invocador, se autorizará después únicamente su conexión mínima al scheduler existente.

```text
RELEASE_SCOPE: FROZEN
BACKUP_AND_ROLLBACK: VERIFIED
ACTIVATION_PATHS: VERIFIED
PRODUCTION_PREFLIGHT: GREEN
```

### Etapa 2 — Despliegue acumulado con flags intactos

Construir imágenes inmutables desde el SHA congelado.

Desplegar mediante el procedimiento escalonado ya demostrado: API secundaria → verificación → API
primaria → verificación → frontend → edge únicamente si existe un cambio real suyo.

Durante este despliegue: identidad permanece en compatibilidad · fallback permanece en su estado
anterior · eventos permanecen apagados · materializador no se activa · rotación y retención
permanecen apagadas · Biblioteca Institucional y Personal permanecen apagadas · no se ejecutan
migraciones ni purgas.

```text
RELEASE_SHA: DEPLOYED
SERVICES: HEALTHY
RESTART_COUNT: ZERO
FLAGS: UNCHANGED
DATA_MIGRATIONS: NONE
```

### Etapa 3 — Validación del código desplegado

Verificar en producción, sin crear contenido ni datos sintéticos: identidad canónica y
compatibilidad · principal canónico de Aula Viva · alcance CIS de Leo · minimización de logs ·
ausencia de previews nuevas · avisos de IA y privacidad · cinco superficies WCAG · Runtime, Studio y
Review · ausencia de regresiones en Biblioteca · salud y errores HTTP.

No se requiere actividad LU para cerrar esta etapa.

```text
LOCAL_ONLY_CHANGES: VERIFIED_IN_PRODUCTION
FUNCTIONAL_REGRESSIONS: ZERO
PRIVACY_P1: CLOSED_IN_PRODUCTION
WCAG_AUDITED_SCOPE: LIVE
```

### Etapa 4 — Identity ENFORCE controlado

Activar ENFORCE mediante el canary por réplica ya aprobado.

Observar: login · sesiones firmadas · subject mismatch · 401/403 · 5xx · salud · dependencia legacy.

La ausencia de tráfico LU no detiene el canary. Una regresión observada sí exige rollback.

```text
SESSION: SIGNED
IDENTITY_AUTHORITY: CANONICAL
ENFORCE: ACTIVE
ROLLBACK: VERIFIED
```

### Etapa 5 — Acceso explícito

Migrar la cohorte completa mediante el mecanismo canónico e idempotente.

Debe cubrir: institución · grupo · rol · memberships · contenido disponible · entitlements o reglas
equivalentes existentes.

No se corrigen grupos individualmente. Se aplica una transformación general con preflight, backup,
conteos y reconciliación.

```text
MEMBERSHIPS: EXPLICIT
ACCESS_RULES: COMPLETE
UNRESOLVED_GROUPS: ZERO
```

### Etapa 6 — Cerrar el fallback abierto

Solo después del gate anterior: cambiar el modo de acceso mediante configuración existente · usar
rollout escalonado · comprobar acceso permitido y denegado · conservar rollback inmediato · no
modificar simultáneamente identidad ni datos.

```text
ACCESS_FALLBACK_MODE: RESTRICTED
EXPLICIT_ACCESS: AUTHORITATIVE
UNINTENDED_DENIALS: ZERO
```

### Etapa 7 — Aislamiento productivo

Demostrar: lector sobre sí mismo · mediador sobre miembros autorizados · mediador sin membership ·
institución distinta · usuario inactivo · administrador global · payload y cabeceras falsificadas ·
ausencia de escrituras después de denegaciones.

```text
TENANT_ISOLATION: PROVEN
CROSS_TENANT_ACCESS: ZERO
CLIENT_ASSERTED_IDENTITY: NOT_TRUSTED
M1: GREEN_BY_CONTROLLED_PRODUCTION_EVIDENCE
```

El componente de campo permanecerá registrado como cerrado por aceptación de riesgo, no como prueba
de adopción.

### Etapas 8 y 9 — Eventos y materialización

Activar primero el backbone mediante el flag existente. Después demostrar una secuencia operacional
controlada:

```text
acción → evento canónico → events.db → materialización → insights.db → API de Aula Viva
```

La materialización debe ser: idempotente · reconstruible · reconciliada · sin ranking · sin
diagnóstico · sin payloads sensibles.

No activar retención en la misma unidad.

```text
EVENTS_BACKBONE: ACTIVE
CANONICAL_EVENTS: VERIFIED
MATERIALIZER: ACTIVE
SOURCE_PROJECTION_RECONCILIATION: GREEN
M2: GREEN
M3: GREEN
```

### Etapa 10 — Retención

Activar mediante mecanismos existentes: paso de eventos calientes a archivo a los 90 días ·
expiración del archivo después de 12 meses · retención de snapshots durante 90 días · cobertura de
`events.archive.db` en backup.

Si falta únicamente el invocador de `pruneSignalSnapshots`, se permite conectarlo al scheduler
existente con: un cambio mínimo · un test · ningún scheduler nuevo · ningún servicio nuevo · ninguna
tabla nueva.

No se autoriza una purga histórica de evidencias de Leo dentro de esta etapa.

```text
EVENT_ROTATION: ACTIVE
EVENT_ARCHIVE_RETENTION: ACTIVE
SNAPSHOT_RETENTION: ACTIVE
ARCHIVE_BACKUP: VERIFIED
```

### Etapa 11 — Biblioteca Institucional y Personal

Activar los contratos existentes después del cierre de acceso.

Verificar:

```text
visibilidad = referencia ∩ estado de publicación ∩ membership/rol ∩ entitlement
```

Condiciones: cero contenido duplicado · cero catálogo paralelo · Editorial permanece intacta ·
Personal deriva de la sesión · Institucional deriva de reglas explícitas.

```text
LIBRARY_EDITORIAL: ACTIVE
LIBRARY_INSTITUTIONAL: ACTIVE
LIBRARY_PERSONAL: ACTIVE
CONTENT_DUPLICATION: ZERO
```

### Etapa 12 — Gate integrado de M4

Verificar conjuntamente: Biblioteca · Runtime · Studio · Review · Aula Viva · identidad · eventos ·
accesibilidad · aislamiento · rollback.

LU se evalúa mediante: compatibilidad técnica ya demostrada · disponibilidad del cliente canónico ·
monitoreo de cualquier tráfico futuro · aceptación directiva de la ausencia de participación actual.

No se inventa actividad de campo.

```text
M4_INTEGRATION: GREEN
LU_FIELD_ADOPTION: NOT_DEMONSTRATED_ACCEPTED_RISK
PRODUCT_SURFACES: GREEN
```

### Etapa 13 — Evidence pack productivo

Reconstruir la evidencia sobre el SHA realmente desplegado.

Debe incluir: imágenes y commits productivos · flags efectivos · identidad y acceso · aislamiento ·
eventos y proyecciones · retención · Biblioteca · WCAG · privacidad · gobernanza de IA · backups y
restores · rollback · CI · excepciones vigentes.

Estado final objetivo:

```text
M1: GREEN_BY_CONTROLLED_PRODUCTION_EVIDENCE
M2: GREEN
M3: GREEN
M4: GREEN
M5_TECHNICAL_RELEASE: GREEN
M2_M5_ARCHITECTURE: COMPLETE
PRODUCTION_ALIGNMENT: COMPLETE
FIELD_ADOPTION: NOT_DEMONSTRATED_ACCEPTED_RISK
LEGAL_CERTIFICATION: NOT_CLAIMED
CHIBALETE_PLUS_V6: GREEN
```

---

## 8. Stop conditions globales

Detener la unidad activa si aparece: drift de baseline · servicio unhealthy · reinicio no explicado ·
backup o rollback no demostrable · migración con conteos ambiguos · escritura fuera de allowlist ·
cruce de institución · pérdida de acceso legítimo · crecimiento anómalo de 401/403 o 5xx · payload
sensible en logs o eventos · necesidad de crear infraestructura nueva · modificación simultánea de
dos autoridades productivas · imposibilidad de identificar el SHA o flag efectivo.

Un STOP no abre una reimplementación. Solo permite corregir la causa directa o ejecutar rollback.

---

## 9. Exclusiones de V6

No forman parte de la línea de release: alcanzar engagement mínimo de pilotos no pagos · perseguir a
colegios que no responden · corregir dispositivos individualmente · purgar una entrada sintética
particular · reescribir el historial de Git · resolver todos los scanners heredados · certificar
cumplimiento jurídico integral · crear una política legal sin revisión competente · abrir nuevas
Experiencias · ampliar MOOK · resolver P2 no bloqueantes · retirar el CLI manual de archivo sin
riesgo demostrado · construir nueva observabilidad · añadir recomendaciones o evaluaciones
automáticas.

Las purgas históricas requieren una decisión humana y una unidad sistémica independiente.

---

## 10. Regla de prompts

Después de adoptar V6: cada prompt llevará el código exacto de una unidad de la línea · tendrá un
solo objetivo y una sola clase de mutación · heredará estas barandas sin repetir contexto innecesario
· no anticipará trabajo de etapas posteriores · no declarará GREEN por intención · publicará
documento únicamente cuando el gate lo necesite · terminará indicando la siguiente unidad exacta de
V6.

No se emitirán prompts sueltos ni unidades fuera del plan.

---

## 11. Próximo punto de ejecución

La primera y única unidad siguiente será:

```text
CHP-ROADMAP-V6-ADOPTION-01
```

Objetivo:

- sustituir operativamente V5;
- publicar V6;
- registrar la aceptación directiva del riesgo de campo;
- congelar la línea única de ejecución;
- no tocar código ni producción.

Solo después de su GREEN se emitirá:

```text
CHP-V6-PRODUCTION-RELEASE-PREFLIGHT-01
```

---

## 12. Regla final de V6

> No construir más producto. No convertir la falta de participación en deuda técnica. Desplegar lo
> terminado, activar una autoridad por vez, demostrar cada gate y conservar rollback hasta cerrar la
> alineación productiva.

---
---

# ACTA DE ADOPCIÓN — `CHP-ROADMAP-V6-ADOPTION-01`

Fecha: 2026-09-14. Tipo: **adopción documental**. Cero código funcional, cero producción, cero
flags, cero migraciones, cero purgas.

## A. Autoridad

`CHP-ROADMAP-2026-06` (este documento) es desde ahora la **única autoridad de ejecución**.
`docs/ops/CHP_ROADMAP_2026_05.md` queda **superado operativamente** y conserva valor histórico; se le
añadió un encabezado de supersesión que apunta aquí, para que ninguna unidad futura tenga que
deducir cuál plan rige.

## B. Baseline verificado al adoptar

```text
Rama:  chp/mook-contract-00
HEAD:  b8350ab4b18dc91b43f694829918dc18aa2b1159  ← coincide con §2.1
Local == remoto (git ls-remote, sin fetch)
Tracked limpio · 3 stashes y 5 untracked preexistentes, sin abrir
```

Producción, según la última lectura read-only publicada hoy en
`CHP_IDENTITY_M1_DRAIN_CLOSURE_EVALUATION_01.md` (2026-09-14T17:27Z): cuatro contenedores `healthy`
con `RestartCount = 0`, imágenes `chibalete/api:ped01d-bef0afe`, `chibalete/front:ped01d-bef0afe` y
`nginx:alpine`, arrancados el 2026-09-07. El preflight completo corresponde a la Etapa 1, no a esta.

## C. Verificación de las afirmaciones técnicas del plan

Antes de publicarlo como autoridad se contrastaron contra HEAD las afirmaciones verificables:

| Afirmación de V6 | Verificación |
|---|---|
| «seis eventos registrados» (§4) | `eventRegistry.js` contiene exactamente `experience_started`, `node_started`, `node_completed`, `experience_completed`, `evidence_submitted`, `evidence_reviewed` |
| «`pruneSignalSnapshots` continúa sin invocador» (§7 Etapa 1) | confirmado: solo aparece en su propio módulo y en su test; ningún llamador productivo |
| «backbone canónico apagado» (§2.2) | `EXPERIENCE_EVENTS_BACKBONE_ENABLED` OFF por defecto en `experienceBackboneEmitter.mjs` |
| «`ACCESS_FALLBACK_MODE` abierto en producción» (§2.2) | el código usa `restricted` por defecto; el valor `open` proviene de la configuración productiva |
| «M2–M5_ARCHITECTURE: COMPLETE / LOCAL_EVIDENCE: COMPLETE» (§2.1) | coherente con `CHP_M2_M5_ARCHITECTURE_CLOSURE_AUDIT_01.md`, `CHP_AULA_VIVA_CANONICAL_PRINCIPAL_01A.md` y `CHP_M2_M5_RELEASE_EVIDENCE_PACK_01.md` |
| «125 horas, cero tráfico LU» (§2.3) | coherente con `CHP_IDENTITY_M1_DRAIN_CLOSURE_EVALUATION_01.md` |

Sin contradicciones. El plan se adopta tal cual, sin enmiendas.

## D. Release candidate congelado

```text
RELEASE_CANDIDATE_SHA: b8350ab4b18dc91b43f694829918dc18aa2b1159
```

Contenido acumulado hoy `LOCAL_ONLY`, que la línea V6 llevará a producción:

| Commit | Cambio |
|---|---|
| `a510631` | cuerpo de eventos fuera del log |
| `25d0a76` | alcance canónico del mediador de Leo |
| `e8f98ae` | aviso de IA en chat flotante y compañero |
| `bd77695` | minimización en origen de la evidencia de Leo |
| `cb0a9ce` | principal canónico en los routers de Aula Viva |
| `b8350ab` | aviso de privacidad para menores |
| `6a10e38`, `631df93` | correcciones WCAG P1 y P2 de las cinco superficies |
| `21823db`…`055ac8f`, `c6d8239`, `3a2f98c` | cadena canónica de eventos, materialización, retención y proyecciones (todo tras flag) |

## E. Cierre administrativo de la dependencia de campo

La Dirección acepta el riesgo y levanta el gate de participación de los pilotos no remunerados. El
resultado técnico **no se reclasifica**:

```text
FIELD_TECHNICAL_EVIDENCE: YELLOW_NO_LU_TRAFFIC
FIELD_PARTICIPATION_GATE: WAIVED_BY_MANAGEMENT
FIELD_DEPENDENCY: CLOSED_BY_MANAGEMENT_RISK_ACCEPTANCE
DRAIN_TECHNICAL_RESULT: NOT_GREEN
T0: ESTABLISHED (2026-09-09T12:07:53Z)
```

Sigue siendo falso afirmar que los 180 dispositivos migraron. Lo que cambia es que esa
indeterminación ya no bloquea el release.

## F. Estado resultante

```text
V6_AUTHORITY: PUBLISHED
FIELD_DEPENDENCY: CLOSED_BY_MANAGEMENT_RISK_ACCEPTANCE
RELEASE_LINE: AUTHORIZED
RELEASE_CANDIDATE: FROZEN AT b8350ab
V5: SUPERSEDED
PRODUCTION: UNCHANGED
```

## G. Mutaciones

Dos archivos: este documento y el encabezado de supersesión de
`docs/ops/CHP_ROADMAP_2026_05.md`. Sin código funcional, sin tests, sin configuración, sin
workflows, sin producción, sin SSH, sin flags, sin stores.

## H. Siguiente unidad exacta

```text
CHP-V6-PRODUCTION-RELEASE-PREFLIGHT-01
```
