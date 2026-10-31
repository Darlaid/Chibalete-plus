# GAMIFICACION-XP-RULES-01: propuesta de parámetros A7 y A12

**Fecha:** 2026-10-31 · **Base:** `75911b4` · **Estado:** PENDIENTE DE DIRECCIÓN.
**Naturaleza:** solo documento. **Todas las cifras son de simulación, no configuración productiva.** Código, reglas, flags y `XP_LOCKED_SOURCES` no cambian.
**Simulación:** [`simulaciones/xp_rules_01.mjs`](simulaciones/xp_rules_01.mjs) usa `decideRecognition` real, solo en memoria. **Aprobación:** [documento A7/A12](GAMIFICACION_A7_A12_APROBACION_V1.md).

## 1. Auditoría

| Referencia | Estado | Efecto |
|---|---|---|
| **A7** | Estructura recomendada, sin aprobar. `ρ_PM = 0` en piloto | Hoy sin efecto en MOOK (§4) |
| **A12** | Sin valores; requiere simulación, Finanzas y Producto | Bloquea la activación |
| **D48** | FIXED: cambios prospectivos, `ruleVersion` | `createRuleSet` es append-only y rechaza fechas pasadas |
| **D50** | FIXED: comité y owner, **nombres pendientes** | Sin firmante no hay `approvalRef` |
| **`validateRules`** | Admite `recognition`; `caps` solo cubre PM | **No existe límite de XP por periodo** |

## 2. Escenarios

Sin `XP_RUTA`. Una «reflexión» es una producción aprobada; la primera de cada obra también da lectura.

| Medida | Conservador | Equilibrado | Generoso |
|---|---|---|---|
| Lectura / reflexión / techo | 5 / 10 / 25 | 10 / 20 / 50 | 15 / 30 / 75 |
| Primera evidencia de una obra | 15 | 30 | 45 |
| Evidencias hasta el techo | 2 | 2 | 2 |
| 1 obra, 1 reflexión | 15 | 30 | 45 |
| 5 obras, 1 reflexión | 75 | 150 | 225 |
| 10 obras, 1 reflexión | 150 | 300 | 450 |
| 20 obras, 1 reflexión | 300 | 600 | 900 |
| 10 obras, reflexión en 5 de ellas | 75 | 150 | 225 |
| 10 obras, reflexión en 3 de ellas | 45 | 90 | 135 |
| 10 obras, 2 o más reflexiones | 250 | 500 | 750 |
| 20 obras, 2 o más reflexiones | 500 | 1000 | 1500 |
| Una obra, 20 o 200 producciones | 25 | 50 | 75 |
| Autorrevisión | 0 | 0 | 0 |

**Hallazgo principal:** los tres escenarios son **la misma regla a escala**. Proporciones, techo y equidad son idénticos. Su diferencia solo importa frente a los umbrales de nivel `T_n`, sin definir. Un escenario más generoso no motiva más por sí mismo: solo cambia la cifra visible.

**Recomendación: Equilibrado,** por sus números redondos: con factores 0,5 y 0,25, los redondeos pierden menos que en el Conservador. Los umbrales `T_n` deben fijarse después, sobre esta escala.

**Límite de los perfiles:** 20 obras es teórico. En el catálogo local solo 6 de 61 contenidos son elegibles, cada uno debe tener un MOOK con producción declarada y Editorial no ha decidido el resto. Producción no se midió.

## 3. Efecto en la progresión

- **Calidad sobre volumen de producciones:** la segunda reflexión de una obra suma; la tercera ya no, porque el techo la absorbe. Entre 1 y 2 reflexiones se gana 67 %; de 2 a 4, nada.
- **Leer más obras rinde más que repetir:** 5 obras con una reflexión dan 150; una obra con 5 da 50 (Equilibrado).
- **Sin evidencia no hay XP:** quien lee sin producción aprobada queda en 0 por esta vía.

## 4. A7: relectura

**Propuesta, simulación:** `W_RELECTURA = 30` días, `xpFactors = [0.5, 0.25]`, `pmFactors = [0, 0]`.

Una evidencia por ciclo, Equilibrado:

| Factores | Ciclos 1 / 2 / 3 / 4 | Total | Máximo por obra |
|---|---|---|---|
| `[0.25]` | 30 / 7 / 5 / 5 | 47 | 100 |
| `[0.5]` | 30 / 15 / 10 / 10 | 65 | 100 |
| **`[0.5, 0.25]`** | **30 / 15 / 7 / 5** | **57** | **150** |
| `[0.75, 0.5, 0.25]` | 30 / 22 / 15 / 7 | 74 | 200 |

**Tres límites del núcleo actual:**

1. **MOOK nunca abre un ciclo 2.** `recordWorkRecognition` no envía `newTraversal`, y solo la lectura validada lo aportaría. **A7 no tiene efecto hasta conectar lectura.** Aprobar la estructura no cambia nada hoy.
2. **El techo no decrece:** cada ciclo tiene el techo completo, con más evidencias. Una obra llega a 3× techo. `ρ` reduce el ritmo, no el máximo.
3. **Al agotar ciclos sigue pagando:** tras el límite, nuevas evidencias siguen en el último ciclo con su factor, hasta el techo. Es la «cola» de la columna Ciclos.

## 5. A12: límite por periodo

**No existe mecanismo para XP.** `caps` solo admite claves de PM y `validateRules` rechaza otras. Lo más cercano son `periodsFor`, la transacción `IMMEDIATE` y el patrón de `earnedUsage`.

**Propuesta:** `caps.xpPerWeek = 4 × techo`, en semana ISO de Bogotá. **Requiere un cambio de código en una unidad posterior.** Equilibrado: 200.

| Lote de 8 obras con una reflexión, Equilibrado | Semanas | XP total |
|---|---|---|
| Tope 2 × techo (100) | 3 | 240 |
| Tope 4 × techo (200) | 2 | 240 |

**Nada se pierde:** sin emisión no hay fila, y el barrido la reevalúa la semana siguiente. Solo se retrasa. Por eso un tope alto no daña a una clase cuyo mediador aprueba por lotes.

**Alternativa:** ninguna, y confiar en techo y revisión humana. El techo ya acota lo mecánico por obra (§7), así que el tope es defensa adicional. **Recomiendo no bloquear el piloto por él.**

## 6. `validated`, `route` y doble remuneración

| Parámetro | Hallazgo | Propuesta |
|---|---|---|
| `amounts.xp.validated` | Sin flujo: pertenece a G7. Obligatorio por el validador | **0 hasta G7** |
| `amounts.xp.route` | **Sin uso.** `recordWorkRecognition` no paga rutas; la ruta paga por `rules.facts['mook_experience/experience_completed']` | **0, y documentar que no gobierna nada.** Evita dos fuentes de verdad |

**Duplicación entre ruta y obra:** una misma entrega completa la ruta y, al aprobarse, genera lectura y reflexión. No choca en clave, porque son hechos distintos, pero es el mismo esfuerzo.

| `XP_RUTA`, Equilibrado, 10 rutas | XP total | Parte por ruta |
|---|---|---|
| 0 | 300 | 0 % |
| 5 | 350 | 14 % |
| 10 | 400 | 25 % |

La ruta además paga **al entregar, sin aprobación**, y grado B. Solo se puede cobrar una por experiencia: `startRun` reutiliza el run, y no hallé código que marque un run MOOK como `abandoned`.

**Propuesta: `XP_RUTA = 0` en piloto,** sin regla `mook_experience`. La ruta sigue mostrando progreso. Reabrirlo requiere A5 y datos.

**Riesgo operativo:** `mook_experience` es hoy la única fuente de XP sin bloqueo de código. Con el flag encendido y esa regla pagaría sin evidencia aprobada. Otro motivo para dejarla fuera.

## 7. Riesgos

### Duplicación

| Riesgo | Control | Residual |
|---|---|---|
| Misma evidencia dos veces | Clave por hecho, probada con 4 procesos | Ninguno observado |
| Dos lecturas por obra y ciclo | `ux_gm_cycle_reading` | Ninguno observado |
| Ruta + obra | `XP_RUTA = 0` | Depende de aprobarlo |
| Varias producciones | `TECHO_XP_OBRA` | Dentro del techo |

### Abuso

| Intento | Resultado, Equilibrado | Límite real |
|---|---|---|
| 200 producciones en una obra | 50 | Techo |
| Reabrir ciclo sin espaciar | 50 | `W_RELECTURA` |
| Autorrevisión | 0 | `self_review` |
| Mediador que aprueba todo | Techo × obras elegibles | **Solo revisión humana.** Hoy 6 obras × 50 = 300 en la copia local. Requiere alarma D41 |
| Texto generado con IA | Se paga si se aprueba | Sin control técnico |

### Desigualdad entre modalidades

Hipótesis futura con lectura validada, 10 obras, Equilibrado:

| Cobertura MOOK | PDF, XP / obras | EPUB o audio, XP / obras | Razón |
|---|---|---|---|
| 0 % | 100 / 10 | 0 / 0 | 0 |
| 20 % | 140 / 10 | 60 / 2 | 0,43 |
| 50 % | 200 / 10 | 150 / 5 | 0,75 |
| 100 % | 300 / 10 | 300 / 10 | 1,00 |

- **Hoy no hay brecha por modalidad:** la lectura está bloqueada y todos dependen de MOOK.
- **Conectar lectura sin VU-2 la abre:** también afecta a `obras_distintas` y al nivel. **Ningún escenario la corrige:** la razón es igual en los tres.
- **Requisito propuesto:** no conectar lectura sin VU-2, o sin cobertura MOOK suficiente. `UMBRAL_EQUIDAD` sigue sin valor.
- **Otras brechas:** lectores sin mediador disponible no obtienen revisión, y en `restricted` solo cuenta el acceso por reglas de scope.
