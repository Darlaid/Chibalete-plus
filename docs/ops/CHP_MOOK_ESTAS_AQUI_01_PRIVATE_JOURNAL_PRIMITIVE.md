# CHP-MOOK-ESTAS-AQUI-01 — Primitiva de bitácora privada

**Fecha:** 2026-08-24 · **Rama:** `chp/mook-contract-00` · **Baseline:** `523bc37`
**Alcance:** cerrar el `PRIVACY-BLOCKER` con una extensión mínima y reutilizable de ACTIVITY.
**NO se carga «¿Estás aquí?». NO se implementa compartir ni galería. NO se despliega.**
**Cero acceso a producción.**

## Veredicto

> ## 🟢 GREEN-PRIVATE-JOURNAL
>
> El bloqueador está cerrado y **demostrado tres veces**: por tests con sentinel, por HTTP real
> contra el backend local, y visualmente con dos actores (dueño y administrador). Ninguna
> condición de stop se activó. La ACTIVITY no privada conserva su comportamiento **exacto**.

---

## A. Decisión de producto aplicada

| Regla | Estado |
|---|---|
| ACTIVITY configurable como bitácora privada | ✅ `config.privado: true` |
| Privada = visible solo para el participante dueño | ✅ verificado por API y UI |
| Admin/revisor/mediador/otros participantes no reciben su contenido | ✅ fail-closed, sin bypass por rol |
| Append-only | ✅ preservado (§18.3 intacto) |
| El dueño puede releerla | ✅ antes y después de completar el paso |
| Sin edición, eliminación, compartir, grupo ni galería | ✅ no existen (ni simulados) |
| Sin promesa de cifrado en reposo | ✅ declarado en ADR §19.1 |
| Compartir → `MOOK-JOURNAL-SHARING`, bloqueado | ✅ ADR §19.4 |

---

## B. Modelo mínimo — qué cambió exactamente

**`config.privado: true` en nodos ACTIVITY.** El `config` de un nodo ya era un objeto de paso
libre, de modo que **no hubo cambio de esquema, ni store nuevo, ni tipo de nodo nuevo, ni
duplicación de evidencias**. No se tocó autenticación, grupos, telemetría ni la estructura de
`ExperienceEvidence`.

| Archivo | Cambio | Líneas |
|---|---|---|
| `server/lib/experienceStore.js` | normalización de `privado` en `validateNode`; `isPrivateActivityNode` (fail-closed); `myEvidenceView` (proyección del dueño); `participantEvidenceView(ev, {privado})`; filtro en `activityContext` | ~45 |
| `server/server.js` | `myEvidenceSummary` delega en el store y recibe el actor de sesión; 2 call sites pasan `req.user.id` | ~6 |
| `components/studio/ExperienceStudio.tsx` | control accesible de bitácora privada en ACTIVITY | ~18 |
| `pages/Experiencias.tsx` | microcopias, `PrivateJournalEntry`, relectura en `NodeRow`, aviso de salida sin guardar | ~75 |
| `server/__test__/mookPrivateJournal.test.mjs` | **nuevo**: 14 pruebas | — |
| `package.json` | encadena el test en `test:mook` | 1 |
| `docs/adr/CHP_ADR_MOOK.md` | **§19 aditiva** | — |

**Compatibilidad:** `privado` ausente o `false` deja el campo **fuera** de la versión congelada,
de modo que la forma de una ACTIVITY normal es byte a byte la de siempre. En nodos que no son
ACTIVITY el campo se descarta.

---

## C. Fail-closed server-side

La regla vive en **una sola sede** (`experienceStore.js`), no en React.

| Requisito | Implementación | Verificado |
|---|---|---|
| Guardar deriva el actor de sesión | `submitEvidence` ya exigía `NOT_RUN_OWNER`; sin cambios | test 2 |
| Respuesta asociada a su run y propietario | `evidence.userId` + `runId` | test 1 |
| Solo el dueño recibe el texto | `myEvidenceView(doc, run, userId)` exige `run.userId === userId` **y** `e.userId === userId` | tests 1, 2 |
| `activityContext` omite pregunta y respuesta privadas | `.filter(x => !isPrivateActivityNode(v, x.nodeId))` | test 3 + HTTP + visual |
| Ninguna cola/detalle de Producciones las proyecta | `reviewListView` ya filtra `requiresReview`; el detalle ahora filtra el contexto | test 3 |
| Otro participante: 403/404 canónico | `GET /route` → **404** «Sin run activo»; escribir en run ajeno → `NOT_RUN_OWNER` **403** | test 2 + HTTP |
| Sin bypass por rol | el filtro no consulta rol alguno; el admin pasa por el mismo camino | test 3 |
| Eventos solo con ids | payload sin texto; el registry rechaza campos extra | test 8 |
| Nodo no resoluble ⇒ privado | `isPrivateActivityNode` devuelve `true` sin nodo o sin versión | test 11 |

**Evidencia HTTP real** (backend local, `x-user-id` canónico):

```
dueño   GET /api/experiences/:id/route
        → evid b00 privado=true answers=["CONFESION-QA-PRIVADA-7781 …", "…"]

admin   GET /api/experiences/review/:prodId/detail
        → activityContext: [{ nodeTitle: "Actividad abierta (no privada)", … }]
        → SENTINEL en detalle admin: 0     ← privacidad OK
        → pregunta privada en detalle: 0   ← privacidad OK
        → versions: ["Mi manera de estar…"] ← la PRODUCTION sigue revisable

admin   GET /api/experiences/review/<idBitácora>/detail  → 409 NOT_REVIEWABLE
otro    GET /api/experiences/:id/route                   → 404 «Sin run activo»
mediador GET /api/experiences/review/queue               → 403 MEDIATOR_SCOPE_GATED
```

### Observación residual (pre-existente, sin exposición de contenido)

Un administrador que ya conociera un `evidenceId` distingue **404 `EVIDENCE_NOT_FOUND`** de
**409 `NOT_REVIEWABLE`**, lo que revela *existencia* pero **nunca contenido**. Es el
comportamiento previo para **toda** ACTIVITY, no una regresión de esta unidad, y los ids no son
enumerables. Se registra para la unidad de compartir; **no se cambió** la semántica de error para
no alterar comportamiento fuera de alcance.

---

## D. Relectura del dueño

Se usó la **proyección existente más próxima** (`route.evidence`, que ya viajaba en
`POST /run` y `GET /route`): **no se abrió ninguna API global de evidencias** ni se permite
consultar respuestas de otros runs.

| Capacidad exigida | Cómo se resolvió |
|---|---|
| Ver que guardó una respuesta | «Guardada para ti.» |
| Releer su texto íntegro | `answers` proyectadas solo al dueño; disclosure «Leer lo que escribí» |
| Regresar posteriormente desde el mismo run | **también tras completar el paso**: `NodeRow` muestra la bitácora guardada (hallazgo del QA visual, ver §F) |
| Distinguirla de una entrega a revisión | `privado: true` y `status: null`; el panel «Tu producción» no la incluye |
| Read-only | `resubmitEvidence` → `NOT_REVIEWABLE`; no existe borrado |

---

## E. Interfaz y microcopias

**Congeladas para bitácoras v1** (todas verificadas en pantalla):

| Microcopia | Dónde |
|---|---|
| `Privada. Solo tú puedes leerla.` | insignia del nodo y de la entrada guardada |
| `Guardar para mí` | botón de envío |
| `Nada se publicará automáticamente` | nota `role="note"` ligada por `aria-describedby` |
| `Tu respuesta todavía no está guardada. ¿Quieres conservarla o salir sin guardar?` | `role="alertdialog"` |
| `Conservar solo para mí` | acción de guardar del aviso |
| `Leer lo que escribí` | disclosure de relectura |
| `Guardada para ti.` | confirmación |

**Retiradas de la v1** y marcadas `FUTURE — MOOK-JOURNAL-SHARING` (no borradas del diseño
editorial histórico): `Elegir con quién compartir` · `Compartir con mi grupo` ·
`Proponer para la galería del mook`. El test 14 **falla si aparecen** en el runtime.

**Sin hardcodes de «¿Estás aquí?»**: todo el texto propio del MOOK vive en `config.preguntas`,
`config.instruccion` o recursos canónicos. El componente global no menciona el título.

**Preview**: conserva los mensajes y no persiste — no registra estado sin guardar ni instala
`beforeunload` (tests 7 y 10).

---

## F. Matriz editorial RATIFICADA

El preflight se actualizó para **sustituir la matriz derivada por la ratificada**. Esta es ahora
**canónica**, no una reconstrucción:

| Mov. | Secuencia |
|---|---|
| **M0** | `A01` → `T00` → libro **pp. 7–14** → `B00` |
| **M1** | `A02` → libro **pp. 15–33** → `T01` → `B01` |
| **M2** | `A03` → libro **pp. 35–40** → `T02` → `T03` → libro **pp. 41–47** → `B02` |
| **M3** | libro **pp. 49–57** → `A05` → `T04` → `B03` |
| **M4** | libro **pp. 59–67** → libro **pp. 69–77** → `A06` → `T05` → `B04` |
| **M5** | libro **pp. 79–87** → `A07.1` → `A07.2` → `A07.3` → `T06` → `B05`; **pp. 133–152** lectura adicional **opcional** |
| **M6** | libro **pp. 89–95** → `T07` → `A08`–`A14` con `B06` → libro **pp. 113–121** → `A15` → `B07` → `T08` |

`A04` está **retirado** y **no se renumera nada**. Las bitácoras `B00`–`B07` se montarán como
ACTIVITY **con `privado: true`**.

---

## G. Tests — 14/14, con sentinel

`server/__test__/mookPrivateJournal.test.mjs`, encadenado en `test:mook`. Sentinels inequívocos
(`SENTINEL-BITACORA-PRIVADA-9f3c1a-NO-DEBE-FILTRARSE` para el texto y
`PREGUNTA-PRIVADA-4b7e2d-NO-DEBE-FILTRARSE` para la pregunta), comprobados contra **toda**
proyección no autorizada.

| # | Prueba obligatoria | Resultado |
|---|---|---|
| 1 | dueño guarda y relee texto privado | ✓ |
| 2 | otro participante no puede leerlo | ✓ |
| 3 | admin/revisor no recibe texto, pregunta ni indicio | ✓ |
| 4 | PRODUCTION del mismo run sigue visible para revisión | ✓ |
| 5 | ACTIVITY no privada conserva comportamiento anterior | ✓ |
| 6 | respuestas privadas múltiples son append-only | ✓ (7 registros, ids únicos) |
| 7 | preview no escribe | ✓ |
| 8 | eventos no contienen texto | ✓ |
| 9 | recarga conserva la relectura del dueño | ✓ (round-trip JSON) |
| 10 | salida sin guardar no persiste | ✓ |
| + 11 | fail-closed: nodo no resoluble ⇒ privado (incluye evidencia huérfana) | ✓ |
| + 12 | `privado` se congela; solo `true` activa; no se arrastra a otros tipos | ✓ |
| + 13 | el Studio ofrece el control accesible | ✓ |
| + 14 | microcopias v1 presentes; acciones futuras ausentes | ✓ |

### Suites y build

| Comando | Resultado |
|---|---|
| `test:mook` | ✅ GREEN (8 archivos; **94 pruebas**, +14 de esta unidad) |
| `test:memberships` | ✅ GREEN |
| `test:metric-contract` | ✅ GREEN |
| `typecheck:baseline` | ✅ **Sin regresiones TS** (current == baseline) |
| `npm run build` | ✅ built |

---

## H. QA local con dos actores

Backend + Vite locales. Experiencia de QA sembrada **solo en el store de dev** (`data/` está
gitignored) y **retirada al terminar**: el store quedó restaurado byte a byte
(6 experiencias, 8 versiones, 5 runs, 7 evidencias) con **los prototipos A y B intactos**.

| Actor | Superficie | Resultado |
|---|---|---|
| **Dueño** (`demo-lector`) | nodo privado, escritorio | insignia, «Guardar para mí» y «Nada se publicará automáticamente» visibles |
| **Dueño** | tras guardar | «Guardada para ti.» + «Leer lo que escribí» con el texto íntegro |
| **Dueño** | tras completar el paso | la relectura **sigue disponible** en la fila del nodo |
| **Dueño** | salida sin guardar | `alertdialog` con la microcopia exacta y las dos acciones; foco inicial en «Conservar solo para mí» |
| **Dueño** | ACTIVITY no privada | conserva «Enviar respuestas» y su nota anterior — sin regresión |
| **Dueño** | **390 px** (iframe) | `scrollWidth == clientWidth` (386/386): **sin scroll horizontal**; guardado y relectura correctos |
| **Admin** (`demo-admin`) | Aula Viva → Producciones (cola) | ve la producción; **cero rastro** de la bitácora |
| **Admin** | detalle «Revisión de producción» | entrega visible; «Contexto» muestra **solo** la actividad no privada |
| **Admin** | Studio → ACTIVITY | control «Bitácora privada — solo el participante podrá leer su respuesta» + nota |
| **Admin** | versión publicada | sigue **inmutable** (banner «crea una nueva versión») |

**Hallazgo del QA visual (corregido en esta unidad):** al completar el paso, el nodo pasa a fila
compacta y la relectura desaparecía. Como §4 exige «regresar posteriormente desde el mismo run»,
`NodeRow` ahora muestra la bitácora guardada de su dueño. Sin este arreglo, `B07` («mostrar la
respuesta correspondiente de `B00`») seguiría siendo irrealizable.

**Entorno (trampas dev Windows, ya conocidas):** `USERS_DB` debe apuntar explícitamente a
`data-critical/usuarios_colegios_oro.json` (el `.env` apunta al padrón legacy y el guard canónico
aborta el arranque) · `ACCESS_FALLBACK_MODE=open` · el admin-secret es file-only 0400,
**inviable en Windows**, así que las rutas de autoría no se ejercitan por HTTP y la experiencia de
QA se sembró por el store · el bootstrap del frontend pide `/api/users` con `x-user-id`, por lo que
una recarga en frío cierra la sesión: el QA usó login real por formulario. Credenciales temporales
de QA creadas y **eliminadas al final** (`usuarios_colegios_oro.json` restaurado; es untracked).

---

## I. Stop conditions — ninguna se activó

| Condición | Evaluación |
|---|---|
| El texto privado debe pasar por una proyección compartida para que el dueño lo relea | ❌ No — `myEvidenceView` es **exclusiva del dueño**; `activityContext` (la proyección compartida) nunca lo lleva |
| El filtrado exige un bypass por administrador | ❌ No — el filtro ignora el rol; el admin recorre el mismo camino |
| El cambio altera evidencias o runs existentes | ❌ No — cero migración; el store restaurado quedó idéntico y los prototipos intactos |
| Garantizar privacidad requiere rediseñar auth, grupos o stores | ❌ No — un campo opcional y un filtro |

---

## J. Alcance NO ejecutado (deliberado)

No se cargó «¿Estás aquí?» · no se crearon extractos del libro · no se implementó compartir,
grupo ni galería · no se tocó edición/eliminación de bitácoras (contradiría §17.5 y §18.3) ·
no se desplegó nada.

## K. Próximo paso

1. Cerrar **descarga de transcripciones** y **duración de audio por nodo** (brechas §G del preflight).
2. Después: **ensamblar la experiencia completa** sobre la matriz ratificada de §F.

`MOOK-JOURNAL-SHARING` permanece bloqueado hasta M1-B + consentimiento explícito + retiro reversible.
