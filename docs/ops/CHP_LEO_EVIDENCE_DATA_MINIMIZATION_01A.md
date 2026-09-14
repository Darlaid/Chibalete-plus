# CHP-LEO-EVIDENCE-DATA-MINIMIZATION-01A — Minimización en origen de la evidencia de Leo

**Veredicto:** `GREEN-LEO-EVIDENCE-PREVIEW-COLLECTION-REMOVED-LOCAL-AND-PUBLISHED`
**Alcance:** local. Publicado en `origin/chp/mook-contract-00`. **NO desplegado.**
**Fecha:** 2026-09-14.

Cierra la **recolección futura** del P1 COMP-06 de
`docs/ops/CHP_PRIVACY_SECURITY_AI_EVIDENCE_01A.md`. **No cierra el riesgo
productivo**: los previews ya escritos siguen en el store hasta una purga
explícitamente autorizada (§9). No declara M5 GREEN.

---

## 1. Decisión arquitectónica

`leo_evidence_db.json` almacena **exclusivamente evidencia estructurada** y nunca
extractos verbatim de la entrada del alumno ni de la respuesta de Leo.

`userInputPreview` y `answerPreview` dejan de recolectarse. **No se sustituyen**
por longitudes, hashes, resúmenes, embeddings, campos nuevos, otro store ni logs.

Esta decisión reemplaza la vía de caducidad explorada en
`CHP-LEO-EVIDENCE-PREVIEW-RETENTION-01A`, que se detuvo con
`STOP-LEO-PREVIEW-RETENTION-AUTHORITY-INCOMPLETE`: la política §5.2
(`max(fin de la relación, última actividad) + 12 meses`) **no es computable**
porque ningún store representa el fin de la relación educativa —`accountStatus`
solo toma `active`/`invited` y no lleva fecha; `identity.db.users.deleted_at` es
un borrado técnico del registro, no el cierre de la relación, y además identity
es sombra (`IDENTITY_READ=json`). La minimización en origen **hace innecesario un
TTL** para las entradas futuras: no hay texto que caducar.

---

## 2. Baseline

```text
Rama: chp/mook-contract-00
HEAD: e04145950925d6a0bc9874fdf001614ce07ef26b
Local == remoto (git ls-remote, sin fetch)
Tracked limpio · 3 stashes y 5 untracked preexistentes, sin abrir
```

---

## 3. Contrato y consumidores (revalidado contra HEAD)

Consumidores de `userInputPreview` / `answerPreview` en todo el árbol tracked:
**ninguno productivo.**

| Consumidor | Qué lee de cada entrada |
|---|---|
| `leoMediatorViewService._toEvidenceSignal()` | `timestamp`, `surface`, `contentId`, `pedagogicalObjective`, `evidenceType`, `interpretationHint` |
| `leoActivationService.detectFamilyMessage()` | `timestamp`, `pedagogicalObjective`, `contentId` |
| `leoOrchestrator` (tras construir la entrada) | solo `pedagogicalObjective`, que pasa a `emitEvidenceRecorded` |

Las únicas otras apariciones son en `leoPedagogicalSignals.test.js:213-220`, donde
los previews son **sentinelas negativos**: el test afirma que la meta de las
señales NO los propaga. Ese test construye su propio payload sintético, es
independiente de este cambio y sigue verde (70/70).

No aplicó `STOP-LEO-EVIDENCE-PREVIEW-CONSUMER-FOUND`.

---

## 4. Allowlist exacta

| Archivo | Cambio |
|---|---|
| `server/leoEvidenceService.js` | writer: proyección explícita, builder sin verbatim, override de ruta para pruebas |
| `server/__test__/leoEvidenceMinimization.test.mjs` | nuevo — 47 aserciones |
| `docs/ops/CHP_LEO_EVIDENCE_DATA_MINIMIZATION_01A.md` | nuevo — este documento |

No se tocaron lectores, rutas, frontend, prompts, proveedores, identidad,
schemas, eventos, `package.json`, configuración productiva ni CI. Cero
dependencias, cero factories, cero helpers genéricos, cero archivos adicionales.

---

## 5. Invariante implementado

Tres cambios en un solo archivo, todos en la dirección de que el texto verbatim
**no exista** en lugar de existir y filtrarse:

**5.1 El builder ya no lo construye.** `buildLeoEvidenceEntry` dejó de
desestructurar `payload` (texto del alumno) y `tituloLibro`, y dejó de calcular
`answerClean`. Las constantes `_INPUT_PREVIEW_LEN` (80) y `_ANSWER_PREVIEW_LEN`
(150) se eliminaron por quedar sin uso. El texto del alumno ya ni entra a la
función.

**5.2 El writer proyecta explícitamente.** `persistLeoEvidence` copia **solo** los
18 campos de `_PERSISTED_FIELDS` antes de hacer `push`:

```js
const _PERSISTED_FIELDS = Object.freeze([
    'id', 'userId', 'contentId', 'surface', 'interactionType', 'chunkIndex',
    'pedagogicalObjective', 'promptType', 'pedagogicalStage', 'difficultyLevel',
    'evidenceType', 'interpretationHint', 'icdliHasData', 'preferredSupportType',
    'interactionCountAtEvent', 'sequenceId', 'sequenceStep', 'timestamp',
]);
```

La proyección es la baranda duradera: un campo nuevo en el objeto de entrada
**no llega al disco por el hecho de existir**. Es lo que convierte la corrección
puntual en invariante general, sin casuística por usuario, fecha ni registro.

**5.3 Override de ruta solo para pruebas.** `_EVIDENCE_DB` pasa a
`process.env.LEO_EVIDENCE_DB || path.resolve(__dirname, '../data/leo_evidence_db.json')`,
con la misma convención que `CONTENT_DB`, `SCHOOLS_DB` y `ACCESS_DB` en
`server.js`. **El default productivo es idéntico**, y el test lo fija por regex.

### Campos conservados y excluidos

| Conservados (18) | Excluidos (2) |
|---|---|
| `id`, `userId`, `contentId`, `surface`, `interactionType`, `chunkIndex`, `pedagogicalObjective`, `promptType`, `pedagogicalStage`, `difficultyLevel`, `evidenceType`, `interpretationHint`, `icdliHasData`, `preferredSupportType`, `interactionCountAtEvent`, `sequenceId`, `sequenceStep`, `timestamp` | `userInputPreview`, `answerPreview` |

Sin sustitutos: el test verifica que ninguna clave persistida coincida con
`len|length|hash|digest|sha|summary|resumen|excerpt|snippet|preview|text|chars`.

---

## 6. Compatibilidad

- **Append-only** intacto.
- **Recorte 2000 → 1800** intacto.
- **Escritura atómica** (`tmp` + `rename`) intacta.
- **No-throw** intacto: un fallo de escritura se registra y se traga, sin alterar
  la respuesta de Leo.
- **Histórico intacto**: la proyección se aplica **solo a la entrada nueva**. El
  array cargado se reescribe tal cual, así que una entrada legacy conserva sus
  previews aunque se añadan entradas nuevas. Esta unidad no purga ni reescribe
  nada de lo ya almacenado.
- **Lectores**: reciben exactamente los campos estructurados que ya proyectaban.
  Ninguno pierde un dato que usara.

---

## 7. Hermeticidad

El test redirige `LEO_EVIDENCE_DB` a un `mkdtemp` **antes** de importar el módulo
—la ruta se resuelve al cargar— y aplica una guarda fail-closed: si la ruta
efectiva no está dentro del temporal, o cae bajo `data/` o `data-critical/`,
**aborta con `exit 1` antes de escribir un solo byte**.

Huella del store real registrada antes y después mediante `stat` + SHA-256 de
bytes, **sin parsear ni imprimir su contenido**:

```text
data/leo_evidence_db.json — presencia, tamaño, mtime y sha256 IDÉNTICOS
sin .tmp huérfano junto al store real
```

No se arrancó el servidor, no se usó Chrome, no se abrió ningún store real.

---

## 8. Pruebas

| Gate | Resultado |
|---|---|
| `server/__test__/leoEvidenceMinimization.test.mjs` (nuevo) | **47/47 ✓** |
| `server/__test__/leoBackboneEmitter.test.js` | **60/60 ✓** |
| `server/__test__/leoPedagogicalSignals.test.js` | **70/70 ✓** |
| `server/__test__/leoMediatorScope.test.mjs` (lector de evidencia) | **29/29 ✓** |
| `npm run build` | **✓ built in 1m 13s** |
| `npm run typecheck:baseline` | **✅ Sin regresiones TS** |
| `npm run lint:evidence` | **OK — 868 archivos, 0 violaciones** |
| `git diff --check` | limpio |

Los 14 requisitos quedan cubiertos: builder sin verbatim (§1), proyección y
sentinelas ausentes del archivo (§2), legacy intacta (§3), recorte (§4),
atomicidad y rollback lógico ante fallo de escritura (§5), lectores (§6), default
productivo (§7) y store real (§8) del test.

CI no se modificó.

---

## 9. Datos históricos: riesgo NO cerrado

El store real contiene entradas anteriores con previews verbatim. **Siguen ahí**,
y también en los backups cifrados que los contienen.

```text
PREVIEW_COLLECTION: REMOVED
HISTORICAL_PREVIEWS: PRESENT
HISTORICAL_PURGE: NOT_AUTHORIZED
PRODUCTION_ACTIVATION: PENDING_DEPLOY
COMP-06: PARTIALLY_MITIGATED (origen sí, histórico no)
M5: sin cambio — NO GREEN
```

La purga del histórico es una unidad separada que requiere autorización humana
explícita, igual que la purga de eventos sintéticos de septiembre. Esta unidad no
la prepara ni la autoriza.

### 9.1 Observación de campo registrada

`data/leo_evidence_db.json` tiene `mtime` **2026-09-14 11:56:23 (−05)**, dentro de
la ventana de la revalidación en Chrome de `CHP-LEO-AI-TRANSPARENCY-NOTICE-01A`
(16:54–16:57Z). El entorno hermético de aquella unidad fijó `CHP_DATA_DIR` y las
rutas que admitían override, pero `_EVIDENCE_DB` **era una constante sin override**
—precisamente lo que §5.3 corrige—, así que la pregunta sintética hecha a Leo
escribió una entrada de evidencia en el store real. No se abrió el archivo para
confirmar su contenido (está prohibido en esta unidad) y no se purgó nada. Queda
registrado junto al histórico para la unidad de purga.

---

## 10. Cero datos reales y producción

Sin deploy, SSH, Docker, HTTP productivo ni cambios de flags. No se abrió ni
modificó `data/leo_evidence_db.json` (solo `stat` + hash de bytes para
demostrar inmutabilidad). Las escrituras de prueba ocurrieron exclusivamente en
un `mkdtemp` del sistema, eliminado al terminar. Ningún archivo nuevo dentro del
repositorio salvo el test y este documento.

---

## 11. Único siguiente paso

Decisión humana sobre la purga de los previews históricos de
`leo_evidence_db.json` —y, en la misma unidad, de la entrada escrita el
2026-09-14 descrita en §9.1—, con copia recuperable previa y predicado exacto,
siguiendo el procedimiento ya usado para los eventos sintéticos.
