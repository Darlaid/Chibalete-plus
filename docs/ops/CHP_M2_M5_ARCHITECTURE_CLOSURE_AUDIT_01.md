# CHP-M2-M5-ARCHITECTURE-CLOSURE-AUDIT-01 — Reconciliación de cierre arquitectónico

**Veredicto:** `AMBER-M2-M5-ARCHITECTURE-REMAINDER-IDENTIFIED-AND-PUBLISHED`
**Fecha:** 2026-09-14. **Tipo:** auditoría documental de reconciliación.
Cero código, cero producción, cero despliegue, cero activación.

Esta unidad **no reabre ni sustituye el plan maestro**: lo reconcilia con lo
publicado hasta HEAD.

---

## 1. Plan autoritativo

```text
docs/ops/CHP_ROADMAP_2026_05.md — «PLAN MAESTRO DE EJECUCIÓN — CHIBALETE+ V5»
adoptado en el commit 7dff7c6 («docs(plan): adopt CHP-ROADMAP-2026-05 as the
governing master plan»)
```

Es el **único** roadmap tracked bajo `docs/ops/`; los otros archivos con «plan»
en el nombre (`CHP-RELEASE-IMAGE-01A-compose-plan.md`,
`P1B-plan-productivizacion-runtime-v2.md`, `identity/write-freeze-plan.md`) son
planes de unidad, no planes generales. No hubo ambigüedad de autoridad.

Criterios usados, literales: §1 (definición vinculante de 100 %), §4.2–4.5
(M2–M5), §5.1 (deudas abiertas), §8 (gates de salida), §10 (lista de «no
construir»).

## 2. Baseline

```text
Rama: chp/mook-contract-00
HEAD: bd776951dffcf9cb2478c77e7f27dc244dafc7b8
Local == remoto (git ls-remote, sin fetch)
Tracked limpio · 3 stashes y 5 untracked preexistentes, sin abrir
```

## 3. Verificación de evidencia (Fase 2)

Los 17 commits que sustentan M2–M5 son **todos ancestros de HEAD**:

`21823db` · `7588a86` · `69e32ad` · `8e18ae8` · `b69bf58` · `055ac8f` ·
`c6d8239` · `3a2f98c` · `a247f47` · `a510631` · `25d0a76` · `b1efa9b` ·
`631df93` · `6a10e38` · `deffc98` · `e8f98ae` · `bd77695`.

Artefactos verificados presentes en HEAD: los **cinco eventos mínimos** que exige
§4.2 (`experience_started`, `node_completed`, `experience_completed`,
`evidence_submitted`, `evidence_reviewed`, más `node_started`) registrados en
`server/analytics/eventRegistry.js` y emitidos por
`server/experienceBackboneEmitter.mjs`; `server/services/signalCompute.mjs` e
`insightMaterializer.mjs` con `pruneSignalSnapshots`;
`server/aulaViva/archiveRotation.mjs`; `events.archive.db` en el inventario de
`stores.py`; `experience_insights` en `operationalRouter.mjs` y en
`LongitudinalStudentTimeline.tsx`; las tres capas de `libraryStore.js`.

**Hallazgo documental:** las unidades del carril M2/M3 se publicaron como código
y pruebas **sin documento de cierre en `docs/ops/`** (`21823db`, `7588a86`,
`69e32ad`, `8e18ae8`, `055ac8f`, `c6d8239`, `3a2f98c`; solo `b69bf58` actualizó
`BACKUP_01B_DESIGN.md`). El §9 del plan exige «cierre documental» por unidad y
§4.5 exige un *evidence pack* reproducible. No es inconsistencia —el código
existe y está probado— sino material que el evidence pack deberá reconstruir.

---

## 4. Matriz M2–M5

### M2 — Cadena canónica de evidencia · `COMPLETE` (arquitectura)

| | |
|---|---|
| Arquitectura requerida (§4.2) | registro de eventos mínimos · emisión desde sesión canónica · persistencia en `events.db` · materialización reconstruible en `insights.db` · reconciliación fuente/proyección · retención y privacidad documentadas |
| Evidencia | `21823db` (hechos una vez por transición) · `7588a86` (5 señales, idempotencia por recómputo) · `3a2f98c`+`a247f47` (identidad canónica del actor) · `69e32ad` · `8e18ae8` · `b69bf58` · `055ac8f` · política aprobada en `CHP_MOOK_EVENTS_EVIDENCE_RETENTION_POLICY_01.md` |
| Pendiente real | demostrar la secuencia **en ejecución real**: `acción → evento → events.db → materialización → insights.db → API` |
| Categoría | `OPERATION` (activar `EXPERIENCE_EVENTS_BACKBONE_ENABLED`, hoy OFF por defecto) + `VALIDATION` (la demostración end-to-end del gate) |
| Bloqueo | activación bloqueada hasta GREEN de M1 |

Aplica la regla de Fase 3: *un flag apagado no significa arquitectura incompleta
si su mecanismo y pruebas existen*. Existen ambos.

### M3 — Aula Viva · `PARTIAL`

| | |
|---|---|
| Arquitectura requerida (§4.3) | consumir proyecciones canónicas · mostrar iniciadas/completadas, continuidad y nodos requeridos · evidencia pendiente/revisada · datos faltantes sin inventar conclusiones · **probar aislamiento de mediadores e instituciones** |
| Evidencia | `c6d8239`: `experience_insights` (5 señales) en `/students/:userId/timeline`, con lenguaje no evaluativo y sin ranking |
| Pendiente real | **el principal de los routers de Aula Viva se toma del header `x-user-id`, no de la sesión firmada** |
| Categoría | `ARCHITECTURE` |
| Bloqueo | ninguno técnico: la autoridad canónica ya existe y se aplica en otras rutas |

Detalle verificable: `server/aulaViva/institutionalRouter.mjs:65` y cinco sitios
de `server/aulaViva/operationalRouter.mjs` leen `req.headers['x-user-id']`
directamente. El resolutor canónico
`req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id']` **ya existe** y se
usa en `server/server.js:3268` (`reqUserId`), en las rutas de mediación de Leo
(`server.js:7868`, cerrado por `25d0a76`) y en
`server/aulaViva/scopeAccess.mjs:67`. El CIS decide bien el alcance, pero recibe
un principal afirmado por el cliente.

### M4 — Ecosistema pedagógico completo · `PARTIAL`

| Componente | Estado | Pendiente | Categoría |
|---|---|---|---|
| Biblioteca Institucional y Personal | `PARTIAL` — las tres capas existen en `libraryStore.js`; solo EDITORIAL está en producción | activar capas con identidad de sesión | `OPERATION`, bloqueado por M1 |
| Review sistémico | `PARTIAL` | alcance del mediador ya canónico (`3a2f98c`); el camino legacy sigue gateado hasta ENFORCE | `OPERATION`, bloqueado por M1 |
| Eventos MOOK y Aula Viva | cubierto por M2/M3 | — | — |
| Prueba integral de aislamiento | `NOT_STARTED` | aislamiento positivo y negativo entre instituciones, extremo a extremo | `VALIDATION` |
| Accesibilidad global | `COMPLETE` dentro del alcance aprobado | §4.5 acota a cinco superficies y excluye reescribir la interfaz | — |
| Cierre operacional LU | `NOT_STARTED` | sin tráfico LU observable | `FIELD_DEPENDENCY` |

### M5 — Accesibilidad, seguridad y release · `PARTIAL`

| Componente | Estado | Evidencia / pendiente | Categoría |
|---|---|---|---|
| Auditoría WCAG 2.2 AA de las cinco superficies | `COMPLETE` | `deffc98` (0 P0 / 13 P1 / 24 P2) · `6a10e38` (13 P1) · `631df93` (22 P2) → `CONFORMANT_WITHIN_AUDITED_FIVE-SURFACE-SCOPE` | — |
| Teclado, foco, zoom/reflow, contraste, errores | `COMPLETE` | mismas tres unidades, con verificación en Chrome real | — |
| Privacidad y retención de eventos/evidencias | `COMPLETE` (arquitectura) | política aprobada + `69e32ad`, `8e18ae8`, `b69bf58`, `055ac8f`, `a510631`, `bd77695` | purga histórica → `OPERATION` |
| Gobernanza de Leo/IA y límites visibles | `PARTIAL` | cerrados COMP-02 (`a510631`), COMP-03 (`25d0a76`), COMP-04 (`e8f98ae`), COMP-06 (`bd77695`); abierto **COMP-05** | `HUMAN_DECISION` |
| Evidencia de aislamiento y autorización | `PARTIAL` | depende del principal canónico de M3 y de la prueba integral de M4 | `ARCHITECTURE` + `VALIDATION` |
| **Evidence pack reproducible de release** | `NOT_STARTED` | seguridad · WCAG · IA · backups y restores · rollback · CI equivalente al artefacto · límites y deudas | `VALIDATION` |
| Gates bloqueantes de CI | `COMPLETE` | `5f6fc64` conserva su GREEN | — |

---

## 5. Arquitectura completa

- **Cadena canónica de evidencia (M2)**: vocabulario, emisión idempotente,
  persistencia, materialización reconstruible, reconciliación, rotación,
  retención de snapshots y cobertura de backup.
- **Minimización de datos**: payloads inválidos sin crudo, cuerpo de eventos
  fuera del log, evidencias de Leo sin texto verbatim en origen.
- **Gobernanza visible de IA**: aviso en las dos superficies activas de Leo y
  alcance canónico del mediador.
- **Accesibilidad de las cinco superficies auditadas**, con sus correcciones P1 y
  P2 cerradas y fijadas por tests estructurales.
- **Proyecciones de Aula Viva** alimentadas por las señales canónicas, sin
  ranking, score ni diagnóstico automático.

## 6. Arquitectura pendiente

**(A) Principal canónico en los routers de Aula Viva** — `ARCHITECTURE`,
**siguiente unidad**. Seis sitios toman la identidad del header en lugar de la
sesión. Bloquea el gate de M3 («probar aislamiento de mediadores e
instituciones»), la evidencia de aislamiento de M5 y el invariante de §1 («no
existe cruce de tenant ni confianza residual en `x-user-id`»).

**(B) Rotador de archivo duplicado** — `ARCHITECTURE`, registrada y **sin unidad
abierta**. `scripts/events-archive.mjs` es un segundo rotador manual sin
expiración, frente a la autoridad `server/aulaViva/archiveRotation.mjs`. §4.2
exige usar el mecanismo existente «y no crear otro sistema». Hoy no bloquea
ningún gate ni eleva un riesgo demostrado, así que por §5.1 del plan no se
convierte en unidad activa.

## 7. Operaciones y activaciones diferidas

| Operación | Bloqueo |
|---|---|
| Activar `EXPERIENCE_EVENTS_BACKBONE_ENABLED` | GREEN de M1 |
| Activar capas Institucional y Personal de Biblioteca | GREEN de M1 |
| Retirar `ACCESS_FALLBACK_MODE=open` (COMP-01) | poblar reglas explícitas y migrar los 20/20 grupos sin `availableContentIds` |
| Desplegar lo publicado y sin desplegar | M1 en drain |
| Purga del histórico de previews de `leo_evidence_db.json` | autorización humana explícita |
| Activar rotación de archivo y retención de snapshots | GREEN de M1 |

Ninguna es arquitectura: sus mecanismos y pruebas existen.

## 8. Decisiones humanas

- **COMP-05** — aviso de privacidad y texto para menores en la UI. Marcado
  `P1 + HUMAN` por la propia auditoría; exige decisión de texto y, con toda
  probabilidad, revisión jurídica. No hay ninguna cadena de privacidad visible
  en `pages/` ni en `components/` hoy.
- **Revisión jurídica de los stores `leo_*`**, hoy `NEEDS_LEGAL_REVIEW`.
- **Autorización de purgas** históricas (evidencias de Leo).

## 9. Dependencias de campo

- **Cierre del drain de M1**: sin tráfico LU observable no hay cierre posible
  (`CHP_IDENTITY_M1_DRAIN_CLOSURE_EVALUATION_01.md`).
- **Confirmación de los colegios** sobre el bloque realizado, requisito previo de
  cualquier evaluación de primer tráfico LU.
- Todo M4 operativo y toda activación de M2 cuelgan de esta dependencia.

## 10. Casuística excluida

No abren unidad y no pertenecen al plan:

- las 9 filas sintéticas de `events.db` (ya purgadas con autorización);
- la entrada de evidencia escrita en `leo_evidence_db.json` el 2026-09-14 durante
  una revalidación hermética;
- `CHP-TTS-RETRY-STUCK-STATE-DEADLOCK-01` y
  `CHP-MOOK-RUN-RESUME-WRITE-ON-READ-01` (P2 no bloqueantes, §5.1);
- `sessionIdentityIntegration` flaky;
- hallazgos heredados de `gitleaks-history` / `trivy-image`;
- el solapamiento del panel del chat a 320 px (P2 de presentación).

---

## 11. Único siguiente paso

**Unidad siguiente: llevar el principal de los routers de Aula Viva a la
autoridad canónica de sesión**, con la misma forma que `25d0a76` aplicó a las
rutas de mediación de Leo.

Por qué es arquitectura general y no casuística: corrige la **frontera de
autoridad de identidad** de una familia completa de rutas, reutiliza un resolutor
que ya existe, no crea capa, servicio ni dependencia, y desbloquea dos gates
(aislamiento de M3, evidencia de autorización de M5) además del invariante de
§1.

Allowlist preliminar mínima (a congelar en su propia unidad):

```text
server/aulaViva/institutionalRouter.mjs
server/aulaViva/operationalRouter.mjs
server/__test__/aulaVivaInstitutional.test.js   (o aulaVivaOperational.test.js)
docs/ops/<documento de la unidad>.md
```

Excluido por casuístico: cualquier excepción por usuario, ruta suelta,
institución concreta o cabecera particular. El cambio debe ser el mismo
invariante en los seis sitios.

Esta unidad no implementa, no despliega, no activa y no purga nada.
