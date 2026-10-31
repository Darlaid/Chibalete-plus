# Contrato de XP A7/A12 — versión 2

**SUSTITUIDA por la [versión 3](GAMIFICACION_A7_A12_APROBACION_V3.md).** Su análisis sigue vigente; su estado no.

**ESTADO: PENDIENTE DE APROBACIÓN DE DIRECCIÓN.** Las cifras son una propuesta. Ninguna está aprobada ni cargada. Sustituye a la [versión 1](GAMIFICACION_A7_A12_APROBACION_V1.md).

| Campo | Valor |
|---|---|
| Documento | `A7-A12-V2`, 2026-10-31 |
| Base técnica | `75911b4` (GREEN_CI tras reintento de `identity-preflight`) |
| `approvalRef` | **Sin asignar** |
| `ruleVersion` y vigencia | **Sin asignar**; prospectiva (D48) |
| Firmante (D50) | **Sin designar** |

Validado con el `decideRecognition` real: [`simulaciones/xp_rules_02.mjs`](simulaciones/xp_rules_02.mjs). Análisis previo: [XP-RULES-01](GAMIFICACION_XP_RULES_01_PROPUESTA.md).

## 1. Parámetros propuestos

| Parámetro | Valor | Campo |
|---|---|---|
| Primera evidencia aprobada de una obra | **10** | `amounts.xp.reading` |
| Cada reflexión aprobada | **20** | `amounts.xp.reflection` |
| Techo por obra y ciclo | **50** | `xpCeilingPerWorkCycle` |
| Completar ruta MOOK | **0** | Sin regla `mook_experience` |
| `amounts.xp.route`, `validated` | **0** | Sin efecto; obligatorios por validación |
| PM, también de relectura | **0** | `amounts.pm.*`, `pmFactors` |
| Relectura en piloto | **Ciclo único** | `xpFactors: []`, `windowDays: 30` |
| Relectura posterior | `xpFactors: [0.5, 0.25]` | **Nueva `ruleVersion`,** al conectar lectura |
| Tope semanal | **Ninguno en piloto** | — |

La regla supera `validateApprovedRecognition`.

**Efecto:** la primera evidencia de una obra da 30 XP y la segunda 20, hasta 50. La tercera y siguientes no dan XP.

## 2. Fundamento pedagógico

- **Comprender vale más que declarar:** la reflexión pesa el doble y solo cuenta con revisión humana aprobada.
- **Variedad antes que repetición:** 5 obras con una reflexión dan 150 XP; una obra con 5 reflexiones da 50.
- **Profundizar suma, pero no sin fin:** la segunda reflexión aporta; la tercera no paga.
- **Sin tiempo, clics, velocidad ni Leo:** nada de eso entra en la decisión.
- **Escala neutra:** 5/10/25 y 15/30/75 son la misma regla. Se elige 10/20/50 por sus números redondos.

| Alternativa | XP por evidencia sucesiva | Máximo | Lectura |
|---|---|---|---|
| **10 / 20 / 50** | 30 + 20 + 0 | 50 | **Premia una segunda reflexión** |
| Techo 30 | 30 + 0 | 30 | No reconoce profundizar |
| Techo 70 | 30 + 20 + 20 + 0 | 70 | Favorece repetir en la misma obra |
| 20 / 20 / 60 | 40 + 20 + 0 | 60 | Iguala lectura y comprensión |

## 3. Decisiones

**A. Nuevo ciclo.** `resolveCycle` exige cuatro cosas: recorrido nuevo declarado, lectura en el ciclo actual, `windowDays` cumplidos y factores disponibles. La prueba válida es un recorrido nuevo del validador de lectura, y hoy no llega: **MOOK no aporta `newTraversal`**. Una evidencia posterior no demuestra relectura, y no se infiere. En 400 días, 10 evidencias siguen en el ciclo 1. **Piloto: ciclo único.**

**B. Disminución.** Al conectar lectura, `[0.5, 0.25]` da 30 / 15 / 7 por recorrido. El techo no decrece: una obra llega a **150 XP** (3 × techo). Queda acotado y no es indefinido: 500 evidencias por ciclo no lo superan.

**C. Factores agotados.** No se abre otro ciclo. Las evidencias siguientes usan el último factor hasta el techo; después el resultado es 0, sin fila. Con `[0.5]`, una evidencia en un ciclo posterior aún paga 10 si queda techo.

**D. Doble recompensa.**

| Par | Control |
|---|---|
| Ruta y obra | `XP_RUTA = 0`: la ruta muestra progreso, no paga |
| Lectura y reflexión | Actos distintos de una evidencia, sumados bajo el techo |
| Varias rutas sobre una obra | El techo es por obra: 3 rutas dan 50, con una sola lectura |
| Misma evidencia | `duplicate` y clave única |
| Lectura validada y MOOK (futuro) | Una sola lectura por ciclo: 10 + 20 |

**E. Techo semanal: no hace falta en el piloto.** El techo por obra ya fija el máximo: 6 obras elegibles × 50 = **300 XP** en la copia local. Cada XP exige además revisión humana. Un tope semanal requeriría cambiar el producto y solo retrasaría a clases revisadas por lotes. Reconsiderar si la alarma D41 lo indica, o con un catálogo mucho mayor.

**F. Modalidades.**

- **Piloto:** `reading_completion` sigue bloqueada, así que PDF, EPUB, audio y accesible obtienen XP por la misma vía y con los mismos importes. El visor no interviene.
- **Barrera real:** la evidencia es texto escrito, de 150 a 300 palabras por defecto. Puede perjudicar a lectores con dislexia o menor expresión escrita. **Mitigación disponible:** `minPalabras` es configurable por nodo; Pedagogía debe fijar un criterio. La evidencia oral u observada (VU-2) no tiene flujo.
- **Sin mediador no hay XP:** cada lector necesita revisión posible.
- **Después:** conectar lectura sin VU-2 abre una brecha; con 20 % de cobertura MOOK, la razón EPUB/PDF es 0,43.

## 4. Casos límite

| Caso | Resultado | Control |
|---|---|---|
| 1000 producciones en una obra | 50 XP | Techo |
| Tercera evidencia aprobada | 0, sin fila | `no_xp_to_emit` |
| Autorrevisión | 0 | `self_review` |
| `con_comentarios` | 0 | A6 pendiente |
| Relectura antes de la ventana | Sigue en el ciclo actual | `reread_window_not_elapsed` |
| Obra retirada legalmente | Pendiente | `isWithdrawn` |
| Acceso no explícito | 0 | `workAccess` |
| Mediador que aprueba todo | Techo × obras | **Solo revisión y alarma D41** |
| Texto de IA aprobado | Paga | **Sin control técnico** |

## 5. Niveles y logros

| Elemento | Consecuencia |
|---|---|
| `T_n` | Fijar sobre esta escala: una obra típica aporta de 30 a 50 XP |
| `obras_distintas` | Solo obras con evidencia aprobada |
| `reflexiones_verificadas` | **Máximo 2 por obra:** la tercera no deja fila. Fijar `r_n` con esto en cuenta |
| «Primera obra» | Alcanzable |
| «Lector reflexivo» | Alcanzable, con el mismo límite |
| «Volver a una obra» | **Inalcanzable en piloto:** sin ciclo 2 |
| «Ruta recorrida» | **Inalcanzable con `XP_RUTA = 0`:** cuenta entradas de ruta. Debe derivarse de otra fuente o diferirse |
| «Lectura compartida» | Inalcanzable hasta G7 |

Ni niveles ni logros existen en el producto.

## 6. Relación con PM

PM permanece desactivado. `validateApprovedRecognition` exige PM en cero, `mook_review` sigue en `PM_LOCKED_SOURCES` y esta ruta nunca escribe movimientos. XP no se convierte en PM. Abrir PM exige otra decisión (A1, D13, D46).

## 7. Estado de implementación

| Elemento | Estado |
|---|---|
| Techo, actos, ciclo, idempotencia y validación | **Implementado** |
| Escritura atómica de hecho, XP y actos | **Implementado, bloqueado** |
| Regla con estos parámetros | **Sin migración:** `createRuleSet` |
| `XP_RUTA = 0`, `xpFactors: []` | **Sin migración:** basta la regla |
| `minPalabras` por nodo | **Sin migración:** Studio |
| Sin tope semanal | **Sin cambio** |
| Selector de obra en `PRODUCTION` | **Requiere producto** |
| Relectura en MOOK o lectura validada | **Requiere producto** |
| Tope semanal, VU-2, logros de ruta | **Requiere producto** |

## 8. Condiciones para levantar `XP_LOCKED_SOURCES`

Solo para `mook_review`, todas antes de retirar el bloqueo y en una unidad con autorización expresa:

1. Este documento firmado, con `approvalRef` emitido por Dirección.
2. Owner y comité designados (D50).
3. Regla editorial de obra aprobada y selector disponible en Studio.
4. Regla creada en `gm_rule_sets`, sin regla `mook_experience`, que supere la validación.
5. `GAMIFICATION_MOOK_SINCE` fijado antes de publicar las versiones que declaren obra.
6. Clave de sujeto y registro de exclusiones operativos.
7. Condiciones de PRIV-01 Implementación §6: DPIA, aviso, supresión transversal y retención.
8. Criterio de Pedagogía para `minPalabras` y revisión disponible en las cohortes del piloto.
9. Alarma D41 definida, incluida la de aprobaciones anómalas.
10. CI verde y prueba con base temporal en el entorno de despliegue.

`reading_completion` sigue bloqueada, y `XP_EARNING_ENABLED` se enciende por orden separada, solo después.

## 9. Decisiones de Dirección

| # | Decisión | Propuesta | Estado |
|---|---|---|---|
| 1 | 10 / 20 / 50 | Aprobar | ☐ Pendiente |
| 2 | `XP_RUTA = 0` y PM 0 | Aprobar | ☐ Pendiente |
| 3 | Ciclo único en piloto | Aprobar | ☐ Pendiente |
| 4 | `[0.5, 0.25]` para la etapa posterior | Aprobar la estructura | ☐ Pendiente |
| 5 | Sin tope semanal en piloto | Aprobar | ☐ Pendiente |
| 6 | `reading_completion` bloqueada en piloto | Aprobar | ☐ Pendiente |
| 7 | Criterio de `minPalabras` | Pedagogía | ☐ Pendiente |
| 8 | Logros de ruta y relectura | Diferir | ☐ Pendiente |

| Rol | Nombre | Fecha | Referencia |
|---|---|---|---|
| Owner ejecutivo (D50) | *Pendiente* | *Pendiente* | *Pendiente* |
| Finanzas | *Pendiente* | *Pendiente* | *Pendiente* |
| Pedagogía | *Pendiente* | *Pendiente* | *Pendiente* |
| Producto | *Pendiente* | *Pendiente* | *Pendiente* |
