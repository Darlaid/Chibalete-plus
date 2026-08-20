# CHP-MOOK-MVP-SCOPE-FREEZE-01 — Congelación del alcance MVP

**Fecha:** 2026-08-19 · **Rama:** `chp/mook-contract-00` · **Baseline:** `c2c11cb`
**Veredicto:** `GREEN-MOOK-MVP-FROZEN` — contrato y código alineados; ninguna de
las tres decisiones exigió ampliar el modelo (no hubo `YELLOW-CONTRACT-CODE-GAP`)
y nada de Studio/Runtime/Review/versionado se rompió (suites completas GREEN).
**Alcance:** ADR §18 nuevo + 3 cambios mínimos de código + 7 tests. Sin deploy.

## 1. Decisiones congeladas (fuente: ADR §18, añadido en esta unidad)

1. **Alcance contractual MVP (§18.1):** módulos 1..N; cualquier subconjunto de
   los 6 tipos de nodo; Leer→Conversar→Producir = plantilla, no validación;
   PRODUCTION/revisión humana opcionales; versiones publicadas y runs inmutables
   y pineados; recursos por `contentId`; preview no persiste; cero
   calificaciones/diagnóstico/rankings/comparación.
2. **F1 (§18.2):** Información general (`title/description/imageUrl/
   durationLabel/audience`) queda como metadata global de `Experience` — edición
   inmediata, no versionada. Sin migración de campos. Mitigación: aviso
   persistente y accesible en la pestaña Información del Studio. Evolución futura
   registrada (no deuda MVP): `VERSIONED-EXPERIENCE-METADATA`.
3. **M4 (§18.3):** ACTIVITY respondida = evidencia técnica del recorrido
   (`requiresReview:false`), fuera de Producciones, sin circuito de revisión;
   la opcional puede omitirse; sin reflexión efímera en el MVP. Mitigación:
   nota accesible junto al envío en el Runtime.
4. **Transcripción (§18.4):** gate técnico en `publishVersion` — VIDEO/AUDIO sin
   `config.transcripcion` no vacía no publica (400, código `TRANSCRIPTION_REQUIRED`,
   identifica módulo y nodo); el draft sí guarda incompleto; calidad = editorial.

## 2. Evidencia A/B en la que se funda

Prototipo A (`CHP_MOOK_PROTOTYPE_02`): 3 módulos / 10 nodos / producción con
revisión — demostró versionado (v1 byte-idéntica bajo edición de v2), pinning,
preview sin mutaciones y F1 (info general en vivo). Prototipo B
(`CHP_MOOK_PROTOTYPE_03`): 1 módulo / 3 nodos / sin PRODUCTION — demostró que
publicar y completar no exige la plantilla extensa, cero evidencia con actividad
opcional omitida, y el matiz M4 (envío técnico si se responde). Ambos conviven
en el mismo store y runtime sin condiciones especiales: eso es lo que §18.1
convierte en contrato.

## 3. Cambios mínimos (5 archivos + 1 test nuevo)

| Archivo | Cambio |
|---|---|
| `docs/adr/CHP_ADR_MOOK.md` | **§18 MVP SCOPE FREEZE** (18.1–18.5), vinculante |
| `server/lib/experienceStore.js` | Gate en `publishVersion`: nodo VIDEO/AUDIO sin `config.transcripcion` → `err('TRANSCRIPTION_REQUIRED', 'módulo «…» (id) · nodo «…» (id): TIPO exige transcripción para publicar')`. `mookErrStatus` ya proyecta códigos no listados a **400 `{error, code}`** — cero cambios en server.js |
| `components/studio/ExperienceStudio.tsx` | Aviso F1: `<p id="st-info-scope-note" role="note">` primero en la pestaña Información + `aria-describedby` en la sección (visible antes de editar, persistente) |
| `pages/Experiencias.tsx` | Nota M4: `<p role="note">` sobre «Enviar respuestas» + `aria-describedby` en el botón (aplica a runtime y preview — mismo NodeShell) |
| `server/__test__/mookV4Realign.test.mjs` | La fixture sintética publica un VIDEO: se le añade `transcripcion` (alineación de fixture con el nuevo contrato; único test preexistente afectado) |
| `server/__test__/mookMvpFreeze.test.mjs` *(nuevo)* + `package.json` | 7 tests registrados en `test:mook` |

Nada más: sin stores nuevos, sin tipos de evidencia, sin flags, sin migraciones,
sin cambios de telemetría.

## 4. Validación

**Tests nuevos (7/7):** AUDIO sin transcripción → `TRANSCRIPTION_REQUIRED` con
módulo+nodo y store byte-idéntico tras el rechazo · VIDEO (incluida cadena de
espacios) → mismo gate · ambos publican con transcripción · draft incompleto se
crea y re-guarda, y READING/LEO/ACTIVITY/PRODUCTION publican sin transcripción ·
aviso F1 presente y ligado por `aria-describedby` · nota M4 presente y ligada ·
ACTIVITY respondida: `requiresReview:false`, run completa sin PRODUCTION,
`reviewListView` vacía.

**Suites:** `test:mook` 80/80 (73 previos + 7) · `test:library` 17/17 ·
`test:metric-contract` GREEN (16 ok equivalence harness) · `typecheck:baseline`
sin regresiones · `npm run build` OK.

**Smoke visual (desktop + iframe 390 px, entorno dev Windows habitual):**
aviso F1 visible al abrir Información de B antes de editar (ámbar, legible en
390) · nota M4 visible sobre «Enviar respuestas» en el paso de actividad ·
gate en vivo: experiencia descartable «Smoke gate transcripción [descartable]»
con AUDIO sin transcripción **se guardó como borrador** y al publicar mostró el
error rojo con módulo y nodo, conservando el borrador y todo el estado del
editor (verificado en desktop y 390). La descartable queda como draft local
(no descubrible; datos locales no committeados). A y B verificadas byte-idénticas
tras el smoke.

## 5. Backlog preservado (sin implementación)

`VERSIONED-EXPERIENCE-METADATA` (evolución futura, no deuda) · reflexión efímera
(descartada del MVP) · F2 sugerencia de título · F3 guardado sticky · F4/M3
pulido móvil · M2 drafts estructuralmente incompletos. Detalle en
`CHP_MOOK_PROTOTYPE_02/03` §6.

## 6. Rollback

Un solo commit documental+código: `git revert` del commit restaura el estado
`c2c11cb` completo (gate, avisos, ADR §18, tests). El gate no migra datos ni
toca stores: revertir no deja residuo. Las versiones ya publicadas no se
re-validan (el gate corre solo en el acto de publicar), así que revertir o
mantener no afecta contenido publicado existente.

## 7. Próximo paso

Con el MVP congelado: **diseñar la primera experiencia editorial real** (contenido
con dueño editorial y revisión humana de textos), ya no otro prototipo técnico.
Insumos listos: corpus V9 (local), Studio completo, contrato §17+§18.
