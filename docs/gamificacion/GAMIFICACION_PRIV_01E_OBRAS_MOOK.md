# GAMIFICACION-PRIV-01E: vinculación canónica entre MOOK y obras

**Fecha:** 2026-10-31 · **Base:** `03d2d29` (CI 10/10) · **Producción:** api `secexport-3091a25`, front `g0-f4836d1`, sin cambios.
**Alcance:** contrato, validación de autoría y resolutor del servidor. Sin esquema, migraciones, flags, ganchos nuevos ni datos reales. `gm_work_cycles` sigue vacía: conectarla es G4-05.

## 1. Modelo encontrado

| Entidad | Hecho verificado | Uso aquí |
|---|---|---|
| Contenido | `id` canónico; `status` solo admite `procesando`, `disponible` o `error`. **No existe un estado «retirada»** | Obra = `contentId`. Retirada = ausente o distinta de `disponible` |
| Versión | Módulos y nodos embebidos, inmutables al publicar; conserva `publishedAt` | Autoridad de la asociación |
| Nodo | `resourceRef` existe en **todos** los tipos. Obligatorio en READING, VIDEO y AUDIO; opcional sin validar en el resto | En PRODUCTION declara la obra |
| Run | Fija `experienceVersionId` y registra `evidenceIds` por nodo | Comprueba que la evidencia pertenece a esa ruta |
| Evidencia | Guarda run, versión, nodo y `payload`. El store solo copia `text` o `answers` | Nunca aporta la obra |
| Revisión | `reviewerId`, `decision`, `reviewedAt` | Solo `aprobado` |
| Acceso | `decideContentAccess` es **asíncrona** y `/api/experiences` no la consulta | Se inyecta como `canAccess` |

**Uso actual (copia local, sin contrastar con producción):** 12 versiones; 6 nodos PRODUCTION, ninguno con `resourceRef`; 2 evidencias aprobadas.

## 2. Decisión: no se amplía el esquema

El modelo PRIV-01A proponía `node.config.recognition`. **No hace falta para este contrato.** `PRODUCTION.resourceRef` ya expresa la relación, es inmutable tras publicar y `usedBy` ya lo protege al borrar contenido.

| Caso | Expresión | Resultado |
|---|---|---|
| **Obra única** | PRODUCTION con `resourceRef` | Su evidencia aprobada se atribuye a esa obra |
| **Varias obras** | Un nodo PRODUCTION por obra, cada uno con su `resourceRef` | Cada evidencia va solo a la obra de su nodo. Nunca se reparte |
| **Experiencia general** | PRODUCTION sin `resourceRef` | Sin obra. Puede haber progreso de ruta |

General y sin declarar son el mismo estado: el efecto es idéntico, ninguna obra. `versionWorkCoverage` deriva `single`, `multi` o `general` solo de esas asociaciones. Las lecturas de la ruta nunca asocian nada.

Declarar `resourceRef` en una PRODUCTION significa «esta producción evalúa esta obra». Si solo se relaciona con ella, se deja sin declarar.

**Lo que el modelo no puede expresar: una sola producción que evalúa dos obras** (comparativa). Queda sin atribución y `validateNode` rechaza listas. **Modificación mínima, no aplicada:** un `config.workRefs` validado en autoría, junto con la regla de emisión de Modelo §5.2 (una emisión que reserva el ciclo de todas) y `N_MAX`. Requiere decisión editorial y de Dirección.

## 3. Contrato implementado

**Identificadores:**

| Concepto | Clave | Quién la fija |
|---|---|---|
| Obra | `contentId`; en el ledger, `deriveWorkKey` | Autoría, en la versión |
| Actividad | `experienceVersionId:nodeId` | Versión fijada por el run |
| Evidencia | `evidence.id` | Store MOOK |
| Ciclo | Entero por obra | `decideRecognition`, en la transacción de G4-05. Nunca el adaptador ni el cliente |

**Cambios:**

| Archivo | Cambio |
|---|---|
| `server/lib/experienceStore.js` | `productionWorkRef`. En PRODUCTION, `resourceRef` debe ser un `contentId` existente al guardar. Publicar exige que la obra se haya ofrecido antes en READING, VIDEO o AUDIO (`WORK_NOT_IN_VERSION`). Sin `resourceRef` no cambia nada |
| `server/gamification/mookWorks.mjs` (nuevo) | `workBlock`, `versionWorkCoverage`, `resolveEvidenceWork`, `mookRecognitionEvidence`. Solo lectura y **sin llamadores de producto**. Recibe `productionWorkRef` inyectado: el motor no importa stores de producto |
| `server/gamification/__test__/mookWorks.test.mjs` (nuevo) | Suite, añadida a `test:gamification-core` |

**Sin cambios:** `server.js`, `recognition.mjs`, `ledger.mjs`, `policy.mjs`, `reconcile.mjs`, `mookSource.mjs`, Studio y migraciones. `mook_review` sigue bloqueada y no deja fila, y `recordFact` sigue rechazando `workRef`.

**Comprobaciones de `resolveEvidenceWork`, en orden. La primera que falla decide:**

| Motivo | Condición |
|---|---|
| `evidence_not_approved` | La revisión no es `REVIEWED` con `aprobado` |
| `evidence_binding_mismatch` | Run, dueño, experiencia, versión, nodo, tipo o `evidenceIds` no coinciden |
| `no_activation_cutoff` | Falta el corte |
| `version_predates_contract` | Versión publicada antes de `GAMIFICATION_MOOK_SINCE` |
| `activity_not_comprehension` | No es PRODUCTION con revisión requerida |
| `no_work_declared` | Sin `resourceRef` |
| `work_not_in_version` | Obra no ofrecida antes en la ruta |
| `work_not_found`, `work_unavailable` | Ausente del catálogo o no disponible |
| `work_is_collection`, `work_is_part`, `work_not_standalone`, `work_not_classified` | No es obra según §4 |
| `work_not_accessible` | `canAccess` no devolvió exactamente `true`, faltó o falló |

`mookRecognitionEvidence` añade los filtros de cuenta, actor y exclusión. Sin puerta de exclusiones no devuelve nada, y sus motivos son recuentos sin datos personales. La autorrevisión la rechaza `decideRecognition`.

## 4. Qué cuenta como obra

Aplica Modelo §5.1 de forma conservadora: raíz, no colección, `standalone` distinto de `false`, y `tipo` entre `libro`, `libro_album` y `video`. Lo demás queda sin elegibilidad **hasta que Editorial lo decida**: capítulos, guías, videos hijos, colecciones, podcasts y artículos pedagógicos.

## 5. Garantías de idempotencia

- El resolutor es determinista y no escribe.
- Una misma evidencia es `duplicate` en `decideRecognition` y conserva su clave única en el ledger.
- Dos evidencias sobre una obra dan un PM por ciclo, también en orden inverso.
- `ux_gm_cycle_pm` rechaza un segundo PM por sujeto, obra y ciclo. Se probó en SQL directo sobre base temporal.
- **La carrera real entre dos procesos no se probó:** ningún código escribe aún en esa tabla (T14, G4-05).

## 6. Casos históricos

No se migró ni se modificó nada.

| Caso | Tratamiento |
|---|---|
| Versiones publicadas antes del corte | Nunca atribuyen. Requieren versión nueva y publicada después |
| Evidencia ya aprobada | Sin efecto retroactivo: la excluye el corte |
| Borrador con PRODUCTION y `resourceRef` inválido | Al volver a guardar se rechaza; localmente no hay ninguno, en producción **no se midió** |
| PRODUCTION publicada con `resourceRef` no ofrecido antes | Se conserva y no atribuye |
| Hijos `libro` en las versiones de «¿Estás aquí?» | Sin elegibilidad hasta la decisión de Editorial; esa ruta tampoco tiene PRODUCTION asociada |

## 7. Requisitos para G4-05

1. `decideContentAccess` es asíncrona y `reconcile` es síncrono: hay que resolver el acceso antes de la transacción.
2. El acceso se evalúa al procesar, no al entregar. Si vence entre gancho y barrido, el resultado depende del momento; no duplica, pero puede omitir un reconocimiento. Hay que decidir el instante de referencia.
3. `GAMIFICATION_MOOK_SINCE` debe fijarse antes de publicar las versiones que declaren obra.
4. Studio no ofrece el selector en PRODUCTION. Hoy se declara por API de administración; Studio conserva el valor al guardar.
5. El llamador debe inyectar `workRefOf` y `canAccess`; sin ellos no se atribuye nada.
6. Escribir `gm_work_cycles` y desbloquear `mook_review` exigen las condiciones de Implementación V1 §6.

## 8. Pruebas

`mookWorks.test.mjs`: 96 ✓, con store real, base temporal y `server.js` real por HTTP. 14 defectos introducidos a propósito hicieron fallar la suite; los archivos se restauraron y se comprobaron byte a byte.
