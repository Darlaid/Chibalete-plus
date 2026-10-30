# GAMIFICACION-G4-02: contrato de reconocimiento lector V1

**Fecha:** 2026-10-30 · **Base:** `0252b7a` (G4-01 publicado; CI 3/3 en verde al primer intento) · **Producción:** `g0-f4836d1`, sin cambios.
**Estado:** PROPUESTA de contrato. Solo documento: sin código, sin escrituras, sin flags, sin despliegue. Nada de esto autoriza G4-03.
**Relacionados:** [Doctrina V1](GAMIFICACION_DOCTRINA_V1.md), [Contratos V1](GAMIFICACION_CONTRATOS_V1.md), [Eventos y API V1](GAMIFICACION_EVENTOS_API_V1.md), [G4-01](GAMIFICACION_G4_01_VALIDADOR.md) y [Evidencia y privacidad V1](GAMIFICACION_G4_EVIDENCIA_PRIVACIDAD_V1.md).

**Convención de cantidades.** Todo importe aparece como parámetro simbólico (`XP_LECTURA`, `ρ₂`, `W_RELECTURA`…). Ningún parámetro tiene valor en este documento: serán CONFIGURABLES en `gm_rule_sets` y su calibración es una decisión aparte.

---

## 1. Tesis del contrato

1. **Recorrer no es comprender.** La telemetría muestra, como mucho, que una lectura es plausible. Solo la comprensión o la reflexión verificable justifica valor canjeable.
2. **El XP reconoce la trayectoria; los PM reconocen evidencia.** Una lectura plausible puede dar XP. Por sí sola nunca da PM.
3. **Misma recompensa, distinta vía de prueba.** Ninguna modalidad vale menos. Si un formato no tiene telemetría, se prueba por una vía independiente del visor.
4. **La equidad no se consigue con más vigilancia.** Se prioriza la evidencia independiente del visor frente a instrumentar más cada formato (evaluación en el documento de privacidad, §7).

---

## 2. Las seis capas del reconocimiento

| Capa | Qué afirma | Quién la produce | Grado máximo | Dónde vive | ¿Da XP? | ¿Da PM? |
|---|---|---|---|---|---|---|
| **1. Progreso canónico** | «Aquí va el lector en esta obra» | Cliente (`/sync`, `/complete`, `/my`) | Ninguno: es una declaración | `progress.db` | No | No |
| **2. Evidencia observacional de recorrido** | «La declaración es coherente con la telemetría» | Validador sobre datos del cliente, con hora del servidor | B | Hoy no se persiste | Sí, si es `plausible` (R-XP-1) | **No** |
| **3. Comprensión o reflexión verificable** | «Hay un producto evaluado de lo leído» | Revisión humana (A) o corrección determinista en el servidor (B, no existe) | A | `mook_db.json`; validación offline (G7) | Sí | Sí, con topes |
| **4. XP permanente** | «Esta trayectoria acumuló hechos reconocidos» | Motor, desde capas 2 y 3 | Derivada | `gm_xp_entries` | — | — |
| **5. Logros pedagógicos** | «Alcanzó este hito cualitativo» | Regla sobre hechos | Derivada | `gm_achievements` | No suman XP en V1 | No |
| **6. PM canjeables** | «Tiene saldo gastable» | Motor, solo desde capa 3 | Derivada | `gm_pm_movements` | — | — |

**Reglas de frontera (propuestas como FIXED):**

- Nada pasa de la capa 1 a las capas 4–6 sin atravesar la capa 2 o la 3.
- El tiempo de pantalla, la velocidad, los clics y el porcentaje declarado por el cliente nunca generan PM por sí solos. Tampoco generan XP (P4), salvo como insumo de coherencia de la capa 2, y el validador no usa tiempo ni velocidad.
- `implausible` e `insufficient_data` no significan lo mismo que «no leyó». Son «sin reconocimiento automático», y siempre queda abierta la vía de la capa 3.

---

## 3. Hallazgos del contraste con el código

Estos hallazgos cambian lo que G1–G3 daban por supuesto.

| # | Hallazgo | Referencia | Consecuencia |
|---|---|---|---|
| H1 | Hay **tres** rutas que escriben finalización o avance: `/sync`, `/complete` y `POST /api/progress/my/:contentId`. G2 y G4-01 solo preveían dos | `server/server.js:5160`, `:5206`, `:11972` | Cualquier gancho futuro debe cubrir las tres |
| H2 | `isCompleted` es **pegajoso** y se acepta del payload en `/sync` y `/my`. Ningún visor web lo envía: el único declarante web es `/complete` (álbum) | `server.js:5190`, `:12002`; `services/dataService.ts:2862` | La transición `false→true` ocurre una sola vez en la vida. No sirve para detectar una relectura ni para inmersivo, guiado o PDF, que declaran el fin con `globalPercentage=100` |
| H3 | Un guardado EPUB nunca toca `isCompleted` | `server.js:5178-5190` | Un lector de EPUB no puede tener «obra terminada» en el progreso |
| H4 | Un nodo MOOK `READING`, `VIDEO` o `AUDIO` se completa con un POST del cliente, sin comprobar lectura ni reproducción | `server/lib/experienceStore.js:297-319`; `server.js:2883` | `experience_completed` puede reducirse a clics. No es evidencia de lectura |
| H5 | Una `ACTIVITY` se acepta con **cualquier** respuesta no vacía, sin corrección ni revisión. Solo `PRODUCTION` admite revisión | `experienceStore.js:358-362`, `:376`, `:451` | Hoy la única comprensión verificable es `PRODUCTION` revisada |
| H6 | `PRODUCTION` exige por defecto 150–300 palabras de texto, configurable por nodo; el tipo de evidencia es solo `text` | `experienceStore.js:154-155`, `:374` | Barrera real por edad y discapacidad (§8) |
| H7 | `con_comentarios` es **terminal**: una evidencia `REVIEWED` no se puede aprobar después | `experienceStore.js:507-516` | Esa decisión del revisor tendría efecto económico definitivo (§6.2) |
| H8 | Un run por (usuario, experiencia). Ningún código pasa un run a `abandoned` | `experienceStore.js:250` | Hoy no existe repetición de ruta. Si existiera, cada run crearía evidencias nuevas y `mook_review` volvería a emitir |
| H9 | `decideEmission` corta XP **y** PM con el mismo flag `PM_EARNING_ENABLED`; los topes solo limitan PM | `server/gamification/policy.mjs:77-85`, `:111` | No se puede emitir XP sin emitir PM, ni poner techo de XP por obra, sin cambiar la política |
| H10 | `gm_achievements` existe en el esquema, pero ningún módulo la escribe. Tampoco hay derivación de nivel | `migrations/0001_ledger.sql:57`; `server/gamification/*.mjs` | Logros y nivel están por construir |
| H11 | `contentId` no está en la lista de `features` de lectura. Con `observationKey` como clave, el ledger no sabría qué obra se leyó | `ledger.mjs:39`; `readingValidator.mjs:151` | Sin una referencia a la obra no hay diversidad ni relectura ni deduplicación |
| H12 | La `windowKey` por tramos de G2 tiene un defecto de frontera: dos finales con un día de diferencia pueden caer en ventanas distintas | `GAMIFICACION_EVENTOS_API_V1.md` §2 | Se sustituye por un ciclo calculado dentro de la transacción (§6.4) |
| H13 | `source` tiene un CHECK con cinco valores | `0001_ledger.sql:23` | Una fuente nueva exige migración; las de `mook_review` y `offline_validation` no |
| H14 | No existe atributo de dificultad editorial. Hay `edad_recomendada` y `numero_paginas`, escasos y sin normalizar (en el catálogo **local** de 61 obras: 49 y 5). `nivel_sugerido` está en el tipo. No se comprobó producción | `data/content.json`; `types/index.ts:416,443` | La dificultad no puede ser requisito ni multiplicador en V1 |
| H15 | No hay canal de comprensión automática utilizable. `pedagogicalStats` vive en `localStorage` y su propio código lo marca como mock; el puntaje de `OralityModal` se calcula en el cliente | `services/dataService.ts:290`, `:3311`; `components/OralityModal.tsx` | Nada de eso es evidencia emisora |
| H16 | Los lectores B2C no siempre tendrán un mediador que revise | `server/b2c/` | La vía humana no alcanza a todos (§8) |

---

## 4. Matriz de reconocimiento por modalidad

**Lectura de la columna 2.** «Sin nuevas escrituras» significa calculado al vuelo y solo para el propio lector. XP, logros y PM son siempre escrituras, así que ninguna modalidad los obtiene por esa vía.

**Vía universal (VU),** válida para todas las filas y sin depender del visor:

- **VU-1:** producción MOOK revisada por una persona (existe).
- **VU-2:** validación del mediador (`offline_validation`; la fuente existe en el esquema, falta el flujo).
- **VU-3:** actividad de corrección determinista en el servidor (no existe; requiere migración, H13).

| Modalidad | 1. Evidencia que existe realmente | 2. Reconocible sin nuevas escrituras | 3. Requiere evidencia adicional | 4. XP futuro | 5. PM futuro y validación adicional | 6. Excluido hasta resolver |
|---|---|---|---|---|---|---|
| **Inmersiva** | `/sync` con oración, total y sesión; eventos `immersive` con fracción; fin = última oración guardada | Barra de avance; estado «llegaste al final» | Un disparador de servidor para la declaración (100 % por `/sync`); relectura por recorrido nuevo | `XP_LECTURA` si `plausible`, o por VU | Solo por VU, una vez por obra y ciclo | Corte por temporizador como fin (G0); XP por bloque y multiplicador de 30 s (grado D, G4B.4); audio activo como evidencia |
| **Guiada** | `/sync` por scroll; eventos `text`; hitos 25/50/75/100 | Igual que inmersiva | Igual que inmersiva. El scroll al fondo no prueba recorrido por sí solo: el validador exige avance intermedio | `XP_LECTURA` si `plausible`, o por VU | Solo por VU | Bloques `block_complete` como XP; puntaje de oralidad (D11) |
| **Accesible** | **Sin** `progress.db`; eventos `a11y` por párrafo ≥ 60 % visible, heartbeat y sesión. Sin declaración de fin | Avance de la sesión desde su telemetría, solo para el lector | Una declaración de fin explícita y una regla que acepte `a11y`: hoy el validador la trata como no instrumentada aunque tenga observaciones | Por VU desde el primer día. `XP_LECTURA` automático cuando exista declaración y regla | Solo por VU | Registrar `mode='a11y'` en hechos duraderos (revela posible discapacidad; privacidad §6); cualquier criterio que le exija más que a otros |
| **PDF** | `/sync` por página; eventos `pdf` por página; fin = última página | Barra de avance por página | Corregir el avance de 2 en 2, que puede superar 100 % con páginas impares; el salto manual de página no es recorrido | `XP_LECTURA` si `plausible`, o por VU | Solo por VU | Páginas pasadas como unidad de XP |
| **EPUB** | `/sync` con CFI y fracción. **Sin eventos**. Nunca `isCompleted` (H3) | Porcentaje y posición del lector | Una decisión: instrumentar o usar solo VU. Recomendación: solo VU en V1 | **Por VU** | Solo por VU | `XP_LECTURA` automático: sin eventos, el veredicto es siempre `insufficient_data` |
| **Álbum visual** | `/sync` por página; eventos `album`; **único con `/complete`** y `album_completed` | «Terminaste esta ruta» | Fin de **ruta activa** frente a páginas totales: una ruta parcial da `end_not_observed`. El modo llega como `text` a `progress.db` | `XP_LECTURA` si `plausible`, o por VU, con regla que mida contra la ruta | Solo por VU | Confundir `/complete` con verificación; penalizar una ruta parcial legítima |
| **Audio** | **Nada**: `<audio>` con `onEnded` solo de UI, sin progreso ni eventos | Nada persistente | Una decisión: instrumentar o usar solo VU. Recomendación: solo VU en V1 | **Por VU** | Solo por VU | Reproducción o audio activo como evidencia (grado D) |
| **Video** | **Nada**: sin progreso ni eventos | Nada persistente | Igual que audio | **Por VU** | Solo por VU | Reproducción como evidencia (grado D) |

**Lectura transversal:**

- Ninguna modalidad obtiene PM por telemetría. Esa decisión iguala de entrada los formatos con más y con menos instrumentación.
- `XP_LECTURA` tiene el **mismo valor** venga del validador o de una VU, y **una sola vez** por ciclo.
- `manual` (`ProgressUpdater`) es declaración pura y queda fuera de todo reconocimiento.

---

## 5. Modelo pedagógico de progresión

### 5.1 Tres ejes que no se mezclan

| Eje | Qué describe | Se aplica a | Origen | Puede usarse para |
|---|---|---|---|---|
| **Nivel del lector** | Trayectoria acumulada y única | La persona | Derivado en el servidor de XP + requisitos | Mostrar progreso propio. Nunca comparar |
| **Dificultad editorial** | Exigencia de la obra | La obra | Metadato editorial (DC-02). **No existe** (H14) | Orientar la selección y, en el futuro, un logro de reto. No multiplica XP |
| **Duración de sesión inmersiva** | Minutos de una sesión | La sesión | Configuración (D44, `LEVELS`) | Organizar la sesión. **Nunca** nombrarse «nivel» ni premiarse |

`edad_recomendada` no es dificultad: es una orientación de público. Un lector mayor con una obra «fácil» no debe perder nada, ni uno menor ganar más por una obra «difícil». Tampoco se usa la edad del lector: `fecha_nacimiento` es opcional y D39 evita segmentar por edad.

### 5.2 Arquitectura mínima

```text
hechos (gm_source_facts)
   ├─ decisión de reconocimiento (función pura + rule_version)
   ├─ gm_xp_entries ──────┐
   ├─ gm_achievements ────┼─► nivel (derivado y cacheado, nunca escrito por el cliente)
   └─ gm_pm_movements     │     solo desde capa 3
                          └─ racha: fuera de V1 hasta D05
```

Sin tablas nuevas para XP, logros o nivel: el esquema 0001 ya los soporta. Se necesitan funciones puras, un flag de XP y topes de XP (H9), más una referencia de obra (H11).

### 5.3 XP permanente: reglas

XP = suma de **hechos pedagógicos cerrados**, nunca de interacciones.

| Regla | Hecho | XP | Condición |
|---|---|---|---|
| **R-XP-1** | Lectura terminada | `XP_LECTURA` | `plausible` **o** corroborada por una VU sobre esa obra, una vez por ciclo |
| **R-XP-2** | Reflexión aprobada | `XP_REFLEXION` | Evidencia A; una vez por `evidenceId` |
| **R-XP-3** | Reflexión con comentarios | `XP_REFLEXION_C` | Si se aprueba la decisión §6.2 |
| **R-XP-4** | Ruta MOOK completada | `XP_RUTA` | Una vez por usuario y versión; no cuenta como lectura de sus obras |
| **R-XP-5** | Validación del mediador | `XP_VALIDADA` | G7, con alcance; nunca un monto libre |
| **R-XP-6** | Relectura espaciada | `ρ₂ · XP_LECTURA`, `ρ₃ · …` | §6.4 |

**Salvaguardas contra «XP = total de interacciones»:**

- Lista cerrada de hechos: lo que no esté en la tabla no da XP. Sesiones, páginas, oraciones, minutos, bloques, intercambios con Leo y aperturas quedan fuera.
- `TECHO_XP_OBRA`: techo por obra y ciclo, sumadas todas las fuentes.
- Sin rendimiento por volumen: la obra larga no da más XP en V1, porque premiar la longitud premiaría pasar páginas y exige metadatos que no existen.
- El nivel exige requisitos cualitativos (§5.4): acumular XP no basta.
- Alarma (D41): razón XP por obra distinta y parte del XP que viene de cada fuente, medidas por cohorte.

### 5.4 Nivel lector único

Un solo nivel, monotónico, derivado:

```text
nivel(n) ⇔ XP ≥ T_n  ∧  obras_distintas ≥ k_n  ∧  reflexiones_verificadas ≥ r_n
```

- **`obras_distintas`:** obras con `R-XP-1`. Relecturas y repeticiones no cuentan.
- **`reflexiones_verificadas`:** VU-1, VU-2 o VU-3.
- **Amplitud temática:** requisito **diferido**. Necesita primero un catálogo con temas normalizados.
- **Dificultad y formato:** **nunca** requisitos de nivel en V1. Un requisito de formato excluiría a quien no puede usar uno.
- **Tramos iniciales:** `r_n = 0`, de modo que quien aún no tiene acceso a una VU avance. El tramo a partir del cual se exige `r_n > 0` no se activa para una cohorte sin vía de verificación disponible (§8).
- **Etiquetas:** no aluden a edad, curso ni capacidad.
- **Privacidad:** privado por defecto (P5 y D34). Nunca ranking.
- **Legado:** sustituye a `nivel_lectura`, `RewardEngine` y al uso de «nivel» en `LEVELS`.

### 5.5 Logros cualitativos

Cada logro tiene una evidencia definida y una regla pura. No dan XP ni PM en V1: reconocen, no pagan.

| Logro (nombre provisional) | Evidencia | Observaciones |
|---|---|---|
| Primera obra | Primer `R-XP-1` | Alcanzable por cualquier vía |
| Volver a una obra | Primera relectura reconocida | Se concede por obra; el logro acumulado cuenta obras distintas |
| Lector reflexivo | `r` reflexiones verificadas | Accesible vía mediador |
| Ruta recorrida | `R-XP-4` | Sin efecto en nivel |
| Lectura compartida | Validación del mediador (G7) | Reconoce la oralidad y la lectura en grupo sin telemetría |
| Exploración | Obras de temas distintos | Diferido hasta tener temas fiables |
| Varios formatos | Familia de formato **de la obra** (texto, audio, video), nunca del visor | Opcional; jamás requisito de nivel; no revela uso de modo accesible |

**Excluidos:** velocidad, tiempo acumulado, rachas (D05 abierta), puntaje de oralidad (D11 abierta), «obra larga» y toda comparación con otros.

### 5.6 Actividades de comprensión

| Tipo | Grado | XP | PM | Estado |
|---|---|---|---|---|
| Producción MOOK revisada por persona | A | Sí | Sí | **Existe** |
| Validación del mediador (oral, grupal, escrita, en aula) | B con actor humano | Sí | Sí, con tope propio | Fuente en esquema; falta el flujo |
| Ítems con corrección determinista en el servidor | B | Sí | Sí, con menor peso | **No existe.** Clave de respuesta nunca enviada al cliente; intentos acotados; banco de ítems por obra |
| `ACTIVITY` actual (respuesta no vacía) | D de hecho (H5) | No | No | Sirve pedagógicamente, no como evidencia |
| Bitácora privada | No evaluable | No | No | Es privada por contrato: premiarla la convertiría en vigilada |
| Leo o inferencia por IA | C | No | No | D10; un LLM nunca corrige con efecto económico |

Toda actividad debe poder hacerse con lectura asistida y admitir una respuesta alternativa a la escritura (§8).

---

## 6. Decisiones de producto recomendadas

### 6.1 Cuándo una lectura genera XP

**Recomendación:** cuando se cumple **R-XP-1** y el sujeto es elegible, en tres condiciones acumuladas:

1. Hay una declaración observada en el servidor: `/complete`, o `globalPercentage` que llega a 100 por `/sync` o `/my`.
2. El validador da `plausible` **o** existe una VU sobre esa obra y ciclo.
3. El ciclo no tiene ya reconocimiento.

Con `implausible` no hay XP automático, no hay acusación ni mensaje negativo, y la VU sigue abierta. El lector ve «aún no reconocida» y qué puede hacer.

**Requisito previo:** el grado de `reading_completion` se mantiene en **B**. No se promueve a A aunque `enforce` se apruebe: el validador prueba plausibilidad y la telemetría es del cliente (G4-01 §4).

### 6.2 Cuándo una actividad de comprensión genera XP o PM

| Evidencia | XP | PM |
|---|---|---|
| `aprobado` por una persona distinta del autor | Sí | Sí, `PM_EVIDENCIA`, con topes |
| Validación del mediador con alcance | Sí | Sí, `PM_VALIDADA`, con tope propio |
| `con_comentarios` | **Sí** (`XP_REFLEXION_C`) | **No** |
| Corrección determinista superada | Sí | `PM_ITEM`, menor peso, tras calibrar |
| `ACTIVITY`, Leo, oralidad | No | No |

**Sobre `con_comentarios`:** recomiendo reconocer el trabajo con XP sin PM, porque el lector sí produjo y fue leído por una persona. Como es terminal (H7), la interfaz del revisor debe explicar la consecuencia antes de activar esta regla: si quiere PM para el lector, debe aprobar o pedir ajustes. Hoy G3-03 no registra `con_comentarios` en absoluto, así que aplicar esta regla exige cambiar el adaptador.

### 6.3 Cómo evitar premios duplicados entre lectura y MOOK

**Recomendación: separar actos y fijar una cobertura por obra y ciclo.**

| Acto | Cuenta una vez por | Efecto |
|---|---|---|
| Leer la obra | (usuario, obra, ciclo) | `XP_LECTURA`. **Un nodo `READING` no es declaración de lectura** (H4) |
| Reflexionar sobre la obra | `evidenceId` | `XP_REFLEXION`, sujeto a `TECHO_XP_OBRA` |
| PM por la obra | (usuario, obra, ciclo) | **Como máximo una emisión**, sumadas todas las fuentes |
| Recorrer la ruta | (usuario, versión) | `XP_RUTA`; **sin PM** |

- **Duplicado de PM imposible por construcción:** la lectura sola no emite PM (§6.1 y R-PM-1), así que no hay pago por lectura que se sume a uno por MOOK.
- **Independencia del orden:** cada hecho conserva su clave. El primero que llega para esa cobertura emite; el siguiente se registra como `observed`, sin necesidad de compensar.
- **Obra cubierta por una evidencia:** se resuelve desde la versión fijada del run, con las `resourceRef` del **mismo módulo**. Si un módulo cubre varias obras, la autoría debe indicar cuál se evalúa; si no lo indica, la evidencia cubre solo la primera `READING` y lo demás no se corrobora.
- **`mook_experience`:** PM = 0 en la primera regla, porque completar una ruta puede ser solo clics más respuestas no vacías (H4 y H5). Se aparta de Contratos §3, que preveía «menor peso», y requiere aprobación.

### 6.4 Cómo reconocer relecturas sin incentivar repetición artificial

**Recomendación:**

- **Ciclo:** un número calculado en la transacción `IMMEDIATE`, desde los hechos previos del usuario y la obra. Sustituye a `windowKey` (H12).
- **Nuevo ciclo:** exige que hayan pasado `W_RELECTURA` días de calendario desde el reconocimiento anterior **y** que el validador vea un recorrido nuevo (`reread_segment` + `plausible`) o exista una VU nueva. `W_RELECTURA` es espaciado entre lecturas, no duración de lectura; por eso no entra en conflicto con P4.
- **XP decreciente:** `1 > ρ₂ ≥ ρ₃ …`, hasta un `ρ_n = 0`.
- **PM:** `ρ_PM = 0` en el piloto. Interpreta D08 en su extremo conservador, y cualquier valor mayor se decide con datos.
- **Reconocimiento cualitativo:** el logro «Volver a una obra» vale aunque ya no quede XP. El valor de releer se reconoce sin pagar por cantidad.
- **Sin penalización:** releer un fragmento, volver atrás o escuchar varias veces nunca resta ni bloquea. Esto importa especialmente a lectores con dislexia o que releen por necesidad.

### 6.5 Cómo evitar menos oportunidades en formatos con menor telemetría

**Recomendación:**

1. **PM independientes de la telemetría** (§4): la brecha se cierra en la capa que tiene valor.
2. **XP igual por VU:** quien lee EPUB, escucha audio o usa modo accesible obtiene el mismo `XP_LECTURA` al corroborar.
3. **Sin requisitos de formato** para nivel.
4. **Alarma de equidad antes de activar:** comparar por cohorte, mediante agregados de **familia de formato de la obra**, la tasa de reconocimiento y de disponibilidad de VU. Una brecha por encima de `UMBRAL_EQUIDAD` bloquea el avance (D41).
5. **Cobertura mínima de VU:** no abrir PM a una cohorte sin una VU real. Una obra sin MOOK necesita VU-2.

**Riesgo residual honesto:** con solo VU-1 y VU-2, el lector de PDF plausible obtiene XP sin esfuerzo adicional y el de EPUB debe hacer algo más. La asimetría es real en XP, aunque no en PM. Se reduce con VU-2 de bajo esfuerzo para el mediador y, después, con VU-3. Si se prefiere simetría estricta, la alternativa es instrumentar EPUB, audio y video, con el coste de privacidad descrito en el documento hermano.

### 6.6 Reglas de PM

| Regla | Contenido |
|---|---|
| **R-PM-1** | Solo capa 3 emite PM. `reading_completion` **sigue en `LOCKED_SOURCES`** para PM aunque el validador pase a `enforce` |
| **R-PM-2** | Exige actor humano distinto del sujeto, o corrección determinista calibrada |
| **R-PM-3** | Máximo una emisión por (usuario, obra, ciclo), más topes diario, semanal y bolsa (D13, D14 y D46) |
| **R-PM-4** | `mook_experience` = 0 mientras H4 y H5 sigan vigentes |
| **R-PM-5** | Leo, oralidad, Q/R/S y grado D = 0 siempre (D07, D10, D11 y P4) |
| **R-PM-6** | Sin emisión retroactiva: corte explícito, como `GAMIFICATION_MOOK_SINCE` (D48) |
| **R-PM-7** | Ninguna emisión a usuarios reales antes de la DPIA y de la decisión de sujeto (documento hermano) |

---

## 7. Consistencia con G1–G3

| Documento | Dice | Realidad o propuesta | Estado |
|---|---|---|---|
| Contratos §2 y Eventos §3.1 | El validador usa «tiempo activo mínimo», `too_fast` y ritmo implícito | G4-01 los descartó; vulneran P4 y discriminan ritmo y discapacidad. `activeMinutes` sigue en la lista de `features` sin uso | **Contradicción: prevalece G4-01.** Falta enmendar los contratos y retirar `activeMinutes` |
| Doctrina §3 y Contratos §3 | Lectura validada = A, con PM decreciente (D08) | Aquí: B y sin PM propia; PM solo por corroboración | **Reinterpreta D08.** Requiere aprobación |
| Contratos §3 | `mook_experience` da PM con menor peso | R-PM-4: 0 | **Se aparta.** Requiere aprobación; basta con la regla, sin código |
| Eventos §2 | `sourceEventId` de lectura = `usuario:obra:windowKey` | G4-01 proponía `observationKey`; aquí, referencia seudónima + ciclo | **Tres versiones.** Se resuelve en el documento hermano §4.3 |
| Eventos §9 (E5) | `con_comentarios` se registra como `observed` | `mookApprovedReviewCandidates` lo filtra y no registra nada | **Discrepancia preexistente** de G3-03 |
| G3-03 §1 | «Aunque el lector repita la ruta» | Hoy no se puede repetir (H8) | Inocuo; la clave sigue siendo correcta |
| G4-01 §6.1 | Persistir observaciones en `gm_source_facts` con 90 días | Imposible: la tabla es append-only | **Inviable.** Documento hermano §3.1 |
| G4-01 §6.2 | Ganchos en `/sync` y `/complete` | También `/my` (H1) | Se amplía |
| Contratos §1 | Dificultad como requisito de competencia | No hay metadato (H14) | Diferido; requiere aprobación |
| CLAUDE.md | `/leer/accesible/:id` reservado, sin implementar | Ruta y visor existen (`App.tsx:471`) | Documentación desactualizada, fuera de alcance |
| Métricas | Finalizado desde 90 % (`server.js:4997`) | Validador: final observado desde 95 % | Dos definiciones conviven; no unificar sin unidad propia. La cifra de métricas no es evidencia |

**Se mantiene sin cambios:** P1–P7, los cuatro grados, la autoridad interna sin HTTP de ingesta, I1–I6, la separación de regalías, los flags y la regla «ante la duda, `insufficient_data`».

---

## 8. Riesgos de inequidad

| Riesgo | Efecto | Mitigación propuesta |
|---|---|---|
| Producción MOOK de 150–300 palabras y solo texto (H6) | Excluye a lectores pequeños o con dificultad de escritura | Mínimos por nodo adecuados; VU-2 con respuesta oral, gráfica o asistida; la consigna evalúa comprensión, no redacción |
| Dependencia del mediador | Carga docente; colegios o B2C sin mediador activo (H16) | VU-3 antes de abrir PM a B2C; agregado de carga docente como alarma |
| Revisor desigual entre grupos | PM dependen de quién revisa | Rúbrica; agregado de tasas de aprobación por grupo sin exponer individuos |
| Modo accesible sin declaración de fin | Queda fuera del XP automático | VU desde el inicio; unidad para declarar fin; sin registrar `a11y` en hechos duraderos |
| Ruta parcial de álbum | `end_not_observed` | Regla medida contra la ruta activa |
| Uso sin conexión o con bloqueadores | Evidencia ausente | `insufficient_data` nunca penaliza; VU disponible |
| Dispositivos compartidos | Evidencia mezclada entre lectores | Sesión del usuario; la cola local multiusuario ya existe en `a11y`; revisar cada visor antes de `enforce` |
| Catálogo sin MOOK para muchas obras | Pocas VU | Priorizar VU-2 y medir cobertura antes de activar |
| Obras cortas | `no_intermediate_progress` | Comportamiento correcto: no acusa; VU disponible |
| Mensajes de «no reconocido» | Sensación de sospecha | Texto neutro; nunca mostrar `implausible` a lector ni mediador |

---

## 9. Unidades ejecutables propuestas

Ninguna está autorizada por este documento. Las marcadas **GATED** dependen del documento hermano.

| Unidad | Alcance | Escrituras reales | Depende de |
|---|---|---|---|
| **G4-03: núcleo puro de reconocimiento** | `recognition.mjs`: matriz (modalidad, veredicto, evidencia) → capa, elegibilidad XP/PM y cobertura; derivación pura de nivel y logros; parámetros simbólicos en reglas de prueba; sin ganchos ni llamadas desde producto | Ninguna | A1–A4 (§10) |
| **G4-04: XP y PM desacoplados** | Flag `XP_EARNING_ENABLED` hijo de `GAMIFICATION_ENABLED`, OFF; `TECHO_XP_OBRA`; regla con `mook_experience` PM = 0; prueba de que `reading_completion` sigue bloqueada para PM | Ninguna (flags OFF) | G4-03 |
| **G4-05: escritura inerte de logros** | Primitiva idempotente sobre `gm_achievements` + API interna de nivel, sin endpoints | Ninguna en real | G4-04 |
| **G4-06: decisión de sujeto** | Migración de indirección del sujeto y eliminación de `userId` en claves, antes de cualquier dato real | Solo esquema en pruebas | **GATED** DPIA (privacidad §4.4) |
| **G4-07: calibración agregada** | Lote de solo lectura en el VPS que produce **solo** agregados de veredicto por cohorte; sin persistencia por persona | Un informe agregado | **GATED** visto bueno DPO + unidad operativa |
| **G4-08: hechos de lectura** | Ganchos post-respuesta en las tres rutas; validador en `observe` con referencia de obra y ciclo | `gamification.db` | **GATED** G4-06 + DPIA |
| **G4-09: instante de finalización** | Marca de primera finalización de una sola escritura | `progress.db` | **GATED** DPIA + autorización de cambio canónico |
| **G4-10: declaración de fin accesible y regla de ruta** | Declaración de fin en accesible; regla `rv-reading-observe-v2` con álbum por ruta | Según diseño | G4-08 |
| **G4-11: flujo mínimo de validación del mediador** | VU-2 con alcance y sin montos; adelanta una parte de G7 | Hechos `offline_validation` | G4-06; RBAC |
| **G4-12: ítems de comprensión** | VU-3: banco por obra, corrección en servidor, nueva fuente con migración | `gamification.db` + contenido | Pedagogía + Editorial |
| **G4-13: paso a `enforce`** | Solo para XP de lectura; R-PM-1 sigue vigente | Sí | G4-07 + aprobación de Producto y Pedagogía |

**Primera unidad ejecutable:** **G4-03**. No toca datos personales, no depende de la DPIA y convierte este contrato en pruebas. Fija, además, el comportamiento antes de escribir nada.

**GREEN esperado de G4-03:** matriz probada caso por caso para las ocho modalidades; ninguna combinación da PM sin capa 3; XP idéntico por validador y por VU; una misma obra y ciclo no emiten dos veces en ningún orden de llegada; misma lectura en 30 s o en 60 h, mismo resultado; módulo sin importaciones de ledger, stores ni regalías; nada del producto lo llama.

**STOP de G4-03:** necesitar persistencia, ganchos o cambios en el ledger.

---

## 10. Decisiones que requieren aprobación

| # | Decisión | Recomendación | Responsable | Bloquea |
|---|---|---|---|---|
| A1 | La lectura sola nunca emite PM (reinterpreta D08 y Contratos §3) | **Aprobar** | Dirección + Pedagogía + Finanzas | G4-03 |
| A2 | La lectura se queda en grado B | **Aprobar** | Pedagogía | G4-03 |
| A3 | Retirar criterios de tiempo y velocidad del contrato del validador y `activeMinutes` | **Aprobar** | Pedagogía + Accesibilidad | G4-03 |
| A4 | Separar el flag de XP y añadir techo por obra | **Aprobar** | Producto | G4-03, G4-04 |
| A5 | `mook_experience` con XP y sin PM | **Aprobar** | Pedagogía + Finanzas | G4-04 |
| A6 | `con_comentarios`: XP sí, PM no, con aviso al revisor (Doctrina §6-8) | **Aprobar** | Pedagogía | Regla MOOK |
| A7 | Relectura: ciclo, `W_RELECTURA`, `ρ` y `ρ_PM = 0` en piloto | **Aprobar la estructura;** valores aparte | Pedagogía | G4-08 |
| A8 | Nivel: fórmula, tramos iniciales sin `r_n`; dificultad, formato y amplitud fuera en V1 | **Aprobar** | Pedagogía + Accesibilidad | G4-03 |
| A9 | EPUB, audio y video solo por VU en V1 | **Aprobar** y revisar tras el piloto | Producto + Privacidad | G4-10 |
| A10 | Oralidad (D11) | **Opción D: feedback** | Pedagogía + Accesibilidad | Logros |
| A11 | Racha (D05) | Fuera de V1; no bloquea | Pedagogía | — |
| A12 | Valores de todos los parámetros | Simulación; ninguno aprobado | Finanzas + Producto | Activación |
| A13 | Decisiones de privacidad (PRIV-1 a PRIV-7 del documento hermano) | Según ese documento | DPO + Legal | G4-06 en adelante |

**Sin cambio de doctrina:** ninguna recomendación altera P1–P7. A1 y A5 endurecen condiciones de reglas FIXED, por lo que pasan por el órgano de D48/D50, aún sin nombres.
