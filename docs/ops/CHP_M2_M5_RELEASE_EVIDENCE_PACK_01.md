# CHP-M2-M5-RELEASE-EVIDENCE-PACK-01 — Evidence pack reproducible

**Veredicto:** `GREEN-M2-M5-EVIDENCE-PACK-REPRODUCIBLE-AND-PUBLISHED`
**Fecha:** 2026-09-14. **Tipo:** paquete de evidencia documental.

Este documento **no certifica cumplimiento, no autoriza release y no despliega**.
Demuestra el estado integrado de M2–M5 sobre un commit concreto, con comandos y
artefactos que cualquiera puede repetir.

---

## 1. Baseline y alcance

```text
Rama: chp/mook-contract-00
HEAD: cb0a9ce6cda18f017950ea51904cc229947f87a9
Local == remoto (git ls-remote, sin fetch)
Tracked limpio · 3 stashes y 5 untracked preexistentes, sin abrir
```

Criterios tomados **literalmente** de `docs/ops/CHP_ROADMAP_2026_05.md` §4.2–4.5
y §8, y de la reconciliación `docs/ops/CHP_M2_M5_ARCHITECTURE_CLOSURE_AUDIT_01.md`
(`d54a827`). No se inventó ningún criterio ni se convirtió un pendiente operativo
en un fallo arquitectónico.

**Alcance:** arquitectura e invariantes de M2–M5 verificables localmente sobre
HEAD, más los gates de CI vigentes. **Fuera de alcance:** producción, despliegue,
activación de flags, datos reales y evidencia de campo de M1.

---

## 2. Matriz de trazabilidad

Todos los commits citados fueron verificados como **ancestros de HEAD**
(`git merge-base --is-ancestor`), y todos los archivos citados existen en HEAD.
Ninguna evidencia depende de un worktree ni de un cambio sin publicar.

### 2.1 M2 — Cadena canónica de evidencia

| Requisito (§4.2) | Implementación | Prueba | Commit | Estado |
|---|---|---|---|---|
| Eventos mínimos en el registry | `server/analytics/eventRegistry.js` — `experience_started`, `node_started`, `node_completed`, `experience_completed`, `evidence_submitted`, `evidence_reviewed` | `analyticsCanon` 60/60 | `21823db` | `COMPLETE` |
| Emisión desde sesión canónica | `server/experienceBackboneEmitter.mjs` | `experienceBackboneEmitter` 34/34 | `21823db`, `3a2f98c`, `a247f47` | `COMPLETE` · `LOCAL_ONLY` |
| Persistencia en `events.db` | `server/eventsService.js` + sink | `analyticsCanon`, `experienceStore` 22 escenarios | `21823db` | `COMPLETE` |
| Materialización reconstruible | `server/services/signalCompute.mjs`, `insightMaterializer.mjs` | `insightMaterializer` 62/62 | `7588a86` | `COMPLETE` |
| Reconciliación fuente/proyección | recómputo idempotente en el materializador | `insightMaterializer` | `7588a86` | `COMPLETE` |
| Minimización de payload inválido | sink sin payload crudo | `analyticsCanon` | `69e32ad` | `COMPLETE` |
| Rotación y retención | `server/aulaViva/archiveRotation.mjs` | `archiveRotation01d` 25/25 | `8e18ae8` | `COMPLETE` · flag OFF |
| Retención de snapshots | `pruneSignalSnapshots` en el materializador | `insightMaterializer` | `055ac8f` | `COMPLETE` · sin scheduler |
| `events.archive.db` en el backup | `ops/backup/CHP-BACKUP-01B/.../stores.py` | CI `backup-capacity` verde en `ec11c0a` | `b69bf58`, `ec11c0a` | `COMPLETE` |
| Retención y privacidad documentadas | `CHP_MOOK_EVENTS_EVIDENCE_RETENTION_POLICY_01.md` | — | `02a4708` | `COMPLETE` |

**Gate M2** (`acción → evento → events.db → materialización → insights.db → API`):
la cadena existe y está probada por tramos. La demostración **en ejecución real**
exige activar `EXPERIENCE_EVENTS_BACKBONE_ENABLED` (hoy OFF), que depende del
GREEN de M1 → `OPERATION` + `VALIDATION`, no arquitectura ausente.

### 2.2 M3 — Aula Viva

| Requisito (§4.3) | Implementación | Prueba | Commit | Estado |
|---|---|---|---|---|
| Consumir proyecciones canónicas | `experience_insights` (5 señales) en `operationalRouter.mjs` | `aulaVivaOperational` 64/64 | `c6d8239` | `COMPLETE` |
| Iniciadas / completadas / continuidad / nodos | `LongitudinalStudentTimeline.tsx` | timeline estructural 71/71 | `c6d8239` | `COMPLETE` |
| Datos faltantes sin inventar conclusiones | lenguaje no evaluativo fijado por test | timeline estructural | `c6d8239` | `COMPLETE` |
| Sin ranking, score ni diagnóstico automático | prohibición fijada por test | timeline estructural | `c6d8239` | `COMPLETE` |
| Aislamiento de mediadores e instituciones | CIS + **principal canónico en los 6 sitios** | `aulaVivaInstitutional` 55/55, `cisScopeAccess` 69/69, `organizationScope` 36/36 | `cb0a9ce` | `COMPLETE` |

### 2.3 M4 — Ecosistema pedagógico

| Componente (§4.4) | Implementación | Prueba | Estado |
|---|---|---|---|
| Biblioteca: tres capas | `server/lib/libraryStore.js` (`EDITORIAL`, `INSTITUTIONAL`, `PERSONAL`) | `libraryStore` 17 escenarios | `COMPLETE` en código · capas 2 y 3 `PENDING_DEPLOY`, bloqueadas por M1 |
| Review sistémico | identidad canónica del mediador | `test:mook` (`mookReview01`, `mookReviewIdentity01a`) | `COMPLETE` · camino legacy gateado hasta ENFORCE |
| Eventos MOOK y Aula Viva | cubiertos por M2/M3 | — | `COMPLETE` |
| Runtime, Studio, MVP freeze, journal, audio a11y, portada, revisit, retorno contextual | `server/lib/experienceStore.js` y routers MOOK | **`npm run test:mook` completo, 222 aserciones, `rc=0`** | `COMPLETE` |
| Aislamiento: guarda de stores reales | — | `realStoreGuard` 16/16 | `COMPLETE` |
| Prueba integral de aislamiento extremo a extremo | — | — | `VALIDATION` pendiente |
| Cierre operacional LU | — | — | `FIELD_DEPENDENCY` |

### 2.4 M5 — Accesibilidad, seguridad y release

| Requisito (§4.5) | Implementación | Prueba | Commit | Estado |
|---|---|---|---|---|
| WCAG 2.2 AA de las cinco superficies | 12 archivos productivos corregidos | `useReducedMotion.structural` **141/141** (§11 P1, §12 P2, §13 aviso de IA) | `deffc98`, `6a10e38`, `631df93` | `COMPLETE` dentro del alcance auditado |
| Teclado, foco, zoom/reflow, contraste, errores | idem | idem + auditorías en Chrome documentadas en 01A/01B/01C | idem | `COMPLETE` |
| Privacidad y retención de eventos/evidencias | política + implementaciones | `analyticsCanon`, `archiveRotation01d`, `insightMaterializer` | `69e32ad`, `8e18ae8`, `055ac8f` | `COMPLETE` (arquitectura) |
| Cuerpo de eventos fuera del log | `server.js` sin `JSON.stringify(rest)` | `eventsWriteAuth` 9 escenarios | `a510631` | `COMPLETE` · `LOCAL_ONLY` |
| Alcance canónico del mediador de Leo | `requireLeoMediatorScope` | `leoMediatorScope` 29/29 | `25d0a76` | `COMPLETE` · `LOCAL_ONLY` |
| Aviso visible de IA | banda en `Chatbot.tsx` y `LeoCompanion.tsx` | `useReducedMotion.structural` §13, 37 aserciones | `e8f98ae` | `COMPLETE` · `LOCAL_ONLY` |
| Minimización de evidencia de Leo | proyección de 18 campos en el writer | `leoEvidenceMinimization` 47/47 | `bd77695` | `COMPLETE` · `LOCAL_ONLY` |
| Sin texto libre en eventos ni señales | emisor y `signalCompute` | `leoBackboneEmitter` 60/60, `leoPedagogicalSignals` 70/70 | `21823db` | `COMPLETE` |
| Identidad y sesión | `sessionAuth`, guarda de navegador | `sessionIdentity` 42/42, `browserNoXUserIdGuard` 2/2 (131 archivos) | — | `COMPLETE` |
| Evidencia de aislamiento y autorización | principal canónico + CIS | `aulaVivaInstitutional`, `cisScopeAccess`, `organizationScope` | `cb0a9ce` | `COMPLETE` |
| Redacción y ratchet de evidencia | `scripts/security/*` | `test:evidence` GREEN 68 + 34 + 31 | — | `COMPLETE` |
| Gates bloqueantes de CI vigentes | `identity-preflight`, `content-rmw`, `image-integrity`, `evidence-hardening` | verdes en HEAD | `5f6fc64` | `COMPLETE` |
| **Evidence pack reproducible** | este documento | — | — | `COMPLETE` con esta unidad |

---

## 3. Resultados reproducibles

Todos ejecutados sobre HEAD `cb0a9ce`, con `node <ruta>` o el script indicado.

| Hito | Suite | Resultado |
|---|---|---|
| M2 | `server/__test__/analyticsCanon.test.js` | 60 ✓, 0 ✗ |
| M2 | `server/__test__/experienceBackboneEmitter.test.mjs` | 34 ok, 0 fallos |
| M2 | `server/__test__/experienceStore.test.mjs` | 22 escenarios OK |
| M2 | `server/__test__/insightMaterializer.test.js` | 62 ✓, 0 ✗ |
| M2 | `server/__test__/archiveRotation01d.test.mjs` | 25 ✓, 0 ✗ |
| M3 | `server/__test__/aulaVivaOperational.test.js` | 64 ✓, 0 ✗ |
| M3 | `server/__test__/aulaVivaInstitutional.test.js` | 55 ✓, 0 ✗ |
| M3 | `server/__test__/cisScopeAccess.test.js` | pass=69, fail=0 |
| M3 | `server/__test__/organizationScope.test.js` | 36 ok, 0 fallidos |
| M3 | `components/aula-viva/__tests__/LongitudinalStudentTimeline.structural.test.mjs` | 71 ✓, 0 ✗ |
| M4 | `server/__test__/libraryStore.test.mjs` | 17 escenarios OK |
| M4 | `server/__test__/realStoreGuard.test.js` | 16 ok, 0 fallidos |
| M4 | `npm run test:mook` (13 suites) | `rc=0`, 222 aserciones, 0 fallos |
| M5 | `hooks/__tests__/useReducedMotion.structural.test.mjs` | 141 ✓, 0 ✗ |
| M5 | `server/__test__/sessionIdentity.test.mjs` | 42 ✓, 0 ✗ |
| M5 | `server/__test__/browserNoXUserIdGuard.test.mjs` | 2 ✓, 0 ✗ (131 archivos escaneados) |
| M5 | `server/__test__/eventsWriteAuth.test.mjs` | 9 escenarios OK |
| M5 | `server/__test__/leoMediatorScope.test.mjs` | 29 ✓, 0 ✗ |
| M5 | `server/__test__/leoEvidenceMinimization.test.mjs` | 47 ✓, 0 ✗ |
| M5 | `server/__test__/leoBackboneEmitter.test.js` | 60 ✓, 0 ✗ |
| M5 | `server/__test__/leoPedagogicalSignals.test.js` | 70 ✓, 0 ✗ |
| M5 | `npm run test:evidence` | GREEN 68 + 34 + 31, 0 fallos |
| Todos | `npm run build` | ✓ built in 47.29 s |
| Todos | `npm run typecheck:baseline` | ✅ sin regresiones (current == baseline) |
| Todos | `npm run lint:evidence` | OK — 872 archivos, 0 violaciones |
| Todos | `git diff --check` | limpio |

No se añadió ningún comando a `package.json` ni se creó ningún script.

---

## 4. Hermeticidad

**Gate previo.** Cada suite se clasificó antes de ejecutarla en una de tres
formas de aislamiento, todas aceptables:

1. **Temporal propio** — `mkdtemp` más `EVENTS_SQLITE_PATH`, `INSIGHTS_SQLITE_PATH`,
   `USERS_DB`, `GROUPS_DB`, `SCHOOLS_DB`, `CHP_DATA_DIR` o `LEO_EVIDENCE_DB`
   (`analyticsCanon`, `insightMaterializer`, `archiveRotation01d`, ambos routers
   de Aula Viva, `cisScopeAccess`, `organizationScope`, `sessionIdentity`,
   `leoMediatorScope`, `leoEvidenceMinimization`, `mookReviewIdentity01a`).
2. **Lectura estructural** — leen código fuente, nunca stores
   (`useReducedMotion.structural`, timeline estructural, `libraryStore`,
   `experienceStore`, `mookReview01`, `browserNoXUserIdGuard`).
3. **Puramente en memoria** — cero `writeFileSync`, con inyección de dependencias
   (`setInserterForTest`): `leoBackboneEmitter`, `leoPedagogicalSignals`,
   `eventsWriteAuth`, `mookRuntime01`.

Tres suites **citan** rutas de `data/` o `data-critical/` y fue necesario
adjudicarlas a mano: `cisScopeAccess`, `archiveRotation01d`,
`leoEvidenceMinimization` y `realStoreGuard` las nombran **solo para comprobar
por `stat` que no se tocan**. Es lo contrario de una brecha.

**Resultado medido.** Huella de metadata (ruta + tamaño + mtime, **sin abrir
contenido**) de `data/`, `data-critical/` y `public/uploads/`:

```text
archivos comparados: 441
HUELLA_ANTES : fd82585e5f119dfbdbe53176490b4c6cbe890d57a098da190395ec668e2d8b4a
HUELLA_DESPUÉS: fd82585e5f119dfbdbe53176490b4c6cbe890d57a098da190395ec668e2d8b4a
IDÉNTICAS: sí
```

Cero escrituras reales. No aplicó `STOP-M2-M5-EVIDENCE-PACK-HERMETICITY-BREACH`.

---

## 5. CI

### 5.1 Checks en HEAD `cb0a9ce`

| Conclusión | Checks |
|---|---|
| **success (5)** | `identity-preflight` · `content-rmw` · `image-integrity` · `evidence-hardening` · `gitleaks-head` |
| **failure (4)** | `trivy` · `trivy-image` · `osv-scanner` · `gitleaks-history` |

`identity-preflight` es el gate bloqueante y cubre `test:identity`,
`test:session-browser`, `test:memberships`, `test:metric-contract`,
`test:ai-model-compat`, `test:request-context-telemetry`, `typecheck:baseline`,
**`test:mook`** y `build`. Al estar verde en HEAD, cubre también
`sessionIdentityIntegration`, que localmente se salta por ser POSIX-only
(secret file 0400/uid) — el SKIP local está resuelto por CI, no ignorado.

### 5.2 Los cuatro rojos son heredados

Demostrado con los tres criterios exigidos:

| Criterio | Evidencia |
|---|---|
| Ya fallaban en la baseline comparable | En `a510631` —el commit anterior a todo este trabajo— fallan **exactamente los mismos cuatro**: `gitleaks-history`, `osv-scanner`, `trivy`, `trivy-image` |
| Fallan en los mismos jobs | Mismos nombres de check, mismo workflow `security.yml` |
| Ningún archivo relacionado cambió | `git diff --name-only a510631 HEAD` = 14 archivos (5 docs, 4 tests, 5 fuentes). **Cero** cambios en `package.json`, `package-lock.json`, `Dockerfile*`, `.github/` u `ops/` |

Contexto adicional: en `7dff7c6` (adopción del roadmap) solo fallaban dos;
`osv-scanner` y `trivy` viraron a rojo **antes** de este trabajo. Son escáneres
de vulnerabilidades cuyo veredicto depende del feed de CVE, no solo del
repositorio. **No se corrigen ni se ocultan en esta unidad.** No aplicó
`STOP-M2-M5-EVIDENCE-PACK-NEW-REGRESSION`.

### 5.3 Gates no ejecutados en HEAD

| Workflow | Motivo | Evidencia sustitutiva |
|---|---|---|
| `backup-capacity` | filtrado por ruta (`ops/backup/**`), sin cambios | Última ejecución **verde en `ec11c0a`**, ancestro de HEAD, y `git diff ec11c0a HEAD -- ops/backup/**` vacío → evidencia válida para el gate de backup/restore |
| `a11y-baseline` | **no está registrado en GitHub Actions**: el archivo existe en esta rama (`aa8fee5`) pero **no en `origin/main`**, y la rama está 256 commits por delante | Ninguna. La evidencia WCAG descansa en la suite estructural (141 aserciones) y en las auditorías manuales en Chrome de 01A/01B/01C |

El propio workflow declara que «hoy NO bloquea merges», así que su ausencia no
contradice un gate bloqueante; pero **la auditoría axe-core automatizada no se
está ejecutando** y conviene decirlo sin adornos.

Nota histórica sin consecuencia: `backup-capacity` falló en `b69bf58` y quedó
verde cinco minutos después en `ec11c0a`, el commit que elevó el ratchet. Rojo
resuelto, no heredado.

---

## 6. Estado local frente a producción

Lo publicado en esta rama **no está en producción**. La imagen productiva vigente
es `ped01d-bef0afe` (2026-09-07), anterior a todo este trabajo.

Marcados `LOCAL_ONLY`: aviso de IA, alcance del mediador de Leo, minimización de
evidencia de Leo, cuerpo de eventos fuera del log, principal canónico de Aula
Viva, correcciones WCAG P1/P2 y toda la cadena canónica de eventos.

---

## 7. Estado honesto

```text
ARCHITECTURE:                  COMPLETE
LOCAL_VALIDATION:              COMPLETE
PRODUCTION_DEPLOYMENT:         PENDING
M1_FIELD_DEPENDENCY:           OPEN
ENFORCE:                       NOT_AUTHORIZED
COMP-05_PRIVACY_NOTICE:        HUMAN_DECISION_PENDING
HISTORICAL_PREVIEW_PURGE:      NOT_AUTHORIZED
COMPLIANCE_CERTIFICATION:      NOT_CLAIMED
RELEASE_AUTHORIZATION:         NOT_GRANTED
```

**M2–M5 no están operativamente cerrados.** Tener arquitectura completa y pruebas
locales verdes no es lo mismo que estar desplegado, activado y verificado con
datos y usuarios reales.

### 7.1 Pendientes operativos

Activar `EXPERIENCE_EVENTS_BACKBONE_ENABLED` · activar rotación de archivo y
retención de snapshots · activar las capas Institucional y Personal de Biblioteca
· retirar `ACCESS_FALLBACK_MODE=open` tras poblar reglas y migrar los 20/20 grupos
sin `availableContentIds` · desplegar todo lo `LOCAL_ONLY` · purgar el histórico
de previews de `leo_evidence_db.json`. Todos tienen mecanismo y pruebas; ninguno
es arquitectura.

### 7.2 Decisiones humanas

**COMP-05** — aviso de privacidad y texto para menores en la UI (`P1 + HUMAN`; no
existe hoy ninguna cadena de privacidad en `pages/` ni `components/`) · revisión
jurídica de los stores `leo_*`, hoy `NEEDS_LEGAL_REVIEW` · autorización de la
purga histórica · decisión sobre registrar `a11y-baseline` como workflow activo.

### 7.3 Dependencias de campo

Cierre del drain de M1 —sin tráfico LU observable no hay cierre posible— y
confirmación de los colegios sobre el bloque realizado. De ahí cuelgan todas las
activaciones de M2 y todo M4 operativo.

---

## 8. Conclusión de release

El paquete demuestra que la **arquitectura de M2–M5 está completa y validada
localmente** sobre `cb0a9ce`, con hermeticidad medida, CI vigente y rojos de
seguridad acreditadamente heredados.

**No constituye autorización de release.** El release exige, además: desplegar,
activar los flags, cerrar M1 con evidencia de campo, resolver COMP-05 y decidir
la purga histórica. Este documento es la línea base reproducible contra la cual
medir esos pasos, no su sustituto.

---

## 9. Privacidad y mutaciones

Sin logs crudos, correos, IP, sesiones, tokens, payloads ni contenido de menores.
Cero producción, SSH, Docker, deploy, flags y stores reales. Cero cambios en
código, tests, configuración, workflows o `package.json`. Único archivo creado:
este documento.

## 10. Único siguiente paso

Resolver la decisión humana **COMP-05**: el aviso de privacidad y el texto para
menores en la interfaz.
