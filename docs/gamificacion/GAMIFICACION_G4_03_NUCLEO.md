# GAMIFICACION-G4-03: núcleo puro de reconocimiento lector

**Fecha:** 2026-10-30 · **Base:** `d7d7de2` (G4-02 publicado; CI en verde) · **Producción:** `g0-f4836d1`, sin cambios.
**Alcance:** funciones puras en `server/gamification/recognition.mjs`. Sin tablas, ganchos, rutas, flags activos ni usuarios reales. **Nada del producto llama al módulo.** La política transaccional de G3 no se modificó.
**Contrato:** [Reconocimiento lector V1](GAMIFICACION_G4_RECONOCIMIENTO_LECTOR_V1.md). **Privacidad:** [Evidencia y privacidad V1](GAMIFICACION_G4_EVIDENCIA_PRIVACIDAD_V1.md).

## 1. Decisiones aplicadas

| Decisión | Dónde se cumple |
|---|---|
| **A1:** la lectura sola nunca da PM | `assessEligibility`: `reading_alone_never_pm`, sin excepción ni configuración que lo cambie |
| **A2:** recorrido = grado B, no comprensión | `classifyEvidence`: capa `traversal`; `demonstratesComprehension` falso. No suma a `reflections` |
| **A3:** sin tiempo ni velocidad | Ninguna función lee esos campos; `EXCLUDED_SIGNALS` los rechaza como fuente; `ACHIEVEMENT_METRICS` no los admite |
| **A4:** XP con flag propio y techo | `flags.xpEarning` y `flags.pmEarning` por separado; `xpCeilingPerWorkCycle` es obligatorio |
| **A8:** nivel por XP, obras y reflexiones | `deriveLevel`; `validateLevels` impide exigir reflexión en los dos primeros niveles |

**Sin aprobar, por tanto sin emisión comercial:** A5 y A6. `mook_experience` da XP (ya previsto en Contratos §3) y nunca PM. `con_comentarios` no se reconoce.

## 2. Funciones

| Función | Responde a |
|---|---|
| `classifyEvidence(evidence)` | Capa, grado y si hay recorrido observable, según fuente y modalidad |
| `assessEligibility(evidence, subject)` | Elegibilidad para XP y PM, por separado y con motivos |
| `decideRecognition({ evidence, subject, history, config, flags })` | Qué se reconocería: ciclo, XP, PM, entradas y motivos. No lanza |
| `applyRecognition(history, decision)` | Historial resultante, sin mutar |
| `summarizeRecognition(history)` | `xp`, `works`, `reflections`, `rereadWorks`, `routes`, `validated`. Excluye las entradas anuladas |
| `validateRecognitionConfig`, `validateLevels` | Configuración inválida = nada reconocido |
| `deriveLevel(stats, levels, { floorIndex })` | Nivel y lo que falta para el siguiente. Nunca baja |
| `evaluateAchievements(stats, opts)` | Logros nuevos con su evidencia. No repite |

**Salidas de `decideRecognition`:** `recognized`, `not_recognized`, `duplicate`, `disabled` y `rejected`.

**Reglas por obra y ciclo:**

- Una lectura por ciclo, venga del validador o de una vía universal, con el mismo XP.
- Como máximo una emisión de PM por obra y ciclo, sumadas todas las fuentes.
- Una reflexión sin obra asociada no se reconoce: sin obra no se puede aplicar el techo ni la unicidad. Una experiencia sin lectura debería aportar su propia referencia de obra.
- Un ciclo nuevo exige recorrido nuevo, espaciado de `windowDays` días de calendario en Bogotá y no haber agotado `xpFactors`.
- El orden de llegada no cambia el resultado si los importes son iguales. Con importes distintos, el primero en llegar fija el PM del ciclo.

**Cantidades:** todas vienen de la configuración. El módulo no tiene importes por defecto. La única cifra propia es la cota técnica `MAX_CONFIG_AMOUNT`, alineada con `MAX_RULE_AMOUNT`. El módulo no aplica los topes diario y semanal de PM: siguen en `policy.mjs`.

**Deriva controlada:** el módulo no importa `policy.mjs` porque arrastra `db.mjs` y SQLite. Una prueba exige que sus grados coincidan con `SOURCE_GRADE`.

## 3. Equidad: lo que garantiza y lo que no

**Garantiza:**
- `deriveLevel` y `evaluateAchievements` no reciben modalidad.
- La vía universal da el mismo resultado desde las ocho modalidades.
- `decideRecognition` no añade ninguna condición por modalidad a EPUB, audio, álbum o accesible.

**No garantiza:** un lector de EPUB, audio, video o modo accesible no puede obtener XP de lectura automático, porque no existe evidencia de su recorrido. Su XP llega por una vía universal que el lector de PDF no necesita.

El módulo no le exige nada distinto, pero **la asimetría persiste en XP, y por tanto en `obras_distintas` y en el nivel**. Además, VU-2 aún no tiene flujo y VU-3 no existe; hoy solo VU-1 funciona. Por eso, para esos lectores, la única vía real es una experiencia MOOK con producción revisada. **Debe resolverse antes de activar XP** (§7, decisión abierta 1).

## 4. Diferencias con G3

Revisados `policy.mjs`, `ledger.mjs` y `mookSource.mjs`. Hoy, el núcleo G4 y G3 **no están conectados**; estas diferencias solo importarían si se activara la emisión.

| Tema | G3 hoy | G4 aprobado | Riesgo si se activa sin alinear |
|---|---|---|---|
| **PM por experiencia MOOK completada** | `validateRules` admite `pm > 0` en `mook_experience/experience_completed`; `decideEmission` lo pagaría | Sin PM mientras A5 esté pendiente | PM por clics y respuestas no vacías |
| **PM por evidencia revisada y aprobada** | Emite por `evidenceId`; `mookApprovedReviewCandidates` no mira la obra | Exige obra asociada y una emisión por obra y ciclo | N producciones sobre una obra = N pagos |
| **Actividad validada frente a comprensión** | No existe el concepto. `offline_validation` tiene lista de `features` vacía; la regla paga por `fact_type` | Solo `demonstratesComprehension` abre PM | Toda validación pagaría igual |
| **Unicidad por usuario, obra y ciclo** | `UNIQUE(source, source_event_id, fact_type)`: por fuente y hecho, nunca entre fuentes. Sin `workRef` ni ciclo | Cobertura transversal | Lectura y MOOK no se reconocen como la misma obra |
| **Bloqueo de lectura** | `LOCKED_SOURCES` bloquea XP **y** PM | A1 bloquea solo PM | Bloqueo correcto hoy, pero más amplio de lo aprobado |
| **Flag de XP** | `decideEmission` corta XP con `PM_EARNING_ENABLED` | Flag independiente | Imposible XP sin abrir PM |
| **Techo de XP** | `caps` solo limita PM | Techo por obra y ciclo | XP sin techo |
| **Ciclos** | `windowKey` en contrato, sin implementar | Ciclo calculado dentro de la transacción | Defecto de frontera (G4-02 H12) |
| **`con_comentarios`** | Se filtra y no se registra; E5 decía `observed` | No se reconoce | Sin riesgo; discrepancia documental |
| **`activeMinutes`** | Sigue en la lista de `features` | A3 lo excluye | Un dato de tiempo persistible; retirarlo |
| **`mode`** | En la lista de `features` de lectura | PRIV: no persistir | Inferencia de discapacidad |

## 5. Intervención mínima antes de activar cualquier emisión

**No se aplica en esta unidad.** Es el alcance propuesto de G4-04:

1. **`policy.mjs`:**
   - separar `PM_LOCKED_SOURCES` (`reading_completion`, `mook_experience`) de `XP_LOCKED_SOURCES` (`reading_completion`, hasta `enforce`);
   - `validateRules` rechaza `pm > 0` en las primeras, y `decideEmission` lo fuerza a 0;
   - añadir `xpCeilingPerWorkCycle` y `reread` al esquema de reglas, sin cifras;
   - `decideEmission` recibe `xpEnabled` y `pmEnabled` por separado.
2. **`db.mjs`:** `isXpEarningEnabled` con `XP_EARNING_ENABLED`, hijo de `GAMIFICATION_ENABLED`, OFF.
3. **`ledger.mjs`:**
   - `recordFact` delega en `decideRecognition`, dentro de la misma transacción `IMMEDIATE`, con el historial de ese sujeto y obra;
   - retirar `activeMinutes` y `mode` de la lista de `features`, y añadir `workRef` y `cycle`;
   - ninguna migración: `workRef` y `cycle` viven en `features_json`. Si la consulta por obra lo exigiera, un índice sería una migración aparte.
4. **`mookSource.mjs`:** adaptadores que aporten `workRef` desde las `resourceRef` del módulo y `demonstratesComprehension`; sin obra resoluble, el hecho queda `observed`.
5. **Prueba de bloqueo:** ninguna regla ni orden de llegada produce PM por lectura o ruta, a través de `recordFact`.

**Orden obligatorio:** PRIV-01 (§6) antes de escribir `workRef` en `gm_source_facts`, porque esa tabla es append-only.

## 6. Unidad de privacidad propuesta: GAMIFICACION-PRIV-01

**No implementada.** Reúne PRIV-1 a PRIV-7 y sustituye a G4-06 del plan de G4-02. Depende de abrir la DPIA.

| Bloque | Contenido | Resuelve |
|---|---|---|
| **1. Sujeto** | `gm_subjects` (`subject_ref` aleatorio ↔ `user_id`), mutable y borrable; el resto de `gm_` solo usa `subject_ref`; igual para `actor_id` | PRIV-4 |
| **2. Identificadores de fuente** | Eliminar `userId` de `source_event_id` en `mook_experience`; `workRef` con HMAC con clave de servidor; revisar `idempotency_key` | PRIV-3, PRIV-4 |
| **3. Datos mínimos** | Sin `mode`, `activeMinutes` ni métricas de ritmo; el veredicto solo cuando emite; `implausible` nunca por persona | PRIV-3 |
| **4. Eliminación y desvinculación** | Orden fijo: cerrar canjes, extinguir saldo con compensación auditada, borrar `gm_subjects`, registrar sin id del padrón. `DELETE /api/users/:id` debe invocarlo | PRIV-5 |
| **5. Respaldos** | Calendario real de `restic forget/prune`, expiración de `events.archive.db` y plazo máximo que se puede prometer; clave HMAC con respaldo separado | PRIV-5 |
| **6. Observación y calibración** | Lote agregado de solo lectura con tamaño mínimo de cohorte; observaciones por persona solo si se demuestra necesario | PRIV-1, PRIV-1b |
| **7. Instante de finalización** | Mantener «no conservar» hasta que la emisión lo exija; cambiar `progress.db` solo con autorización | PRIV-2 |
| **8. Transparencia y derechos** | Aviso, canal para representantes, oposición sin afectar lectura ni evaluación | PRIV-6 |
| **9. Instrumentación** | Análisis propio antes de añadir telemetría en EPUB, audio o video | PRIV-7 |

**Ventana:** los bloques 1 y 2 no migran datos mientras `gamification.db` no exista en producción. Ese es el motivo para hacerlos antes de la primera activación.

**GREEN esperado:** suprimir a un sujeto deja el ledger íntegro y sin vínculo con el padrón; `verifyLedger` sigue en verde; ninguna clave contiene `userId`; un restore no resucita el vínculo sin el procedimiento documentado.

## 7. Decisiones abiertas

1. **Asimetría de XP (§3).** Elegir antes de activar XP entre: VU-2 de bajo esfuerzo disponible para esas modalidades, o XP de lectura detenido para **todos** hasta que exista. Recomiendo lo primero: G4-11 antes de abrir XP de lectura.
2. **A5** (`mook_experience` sin PM) y **A6** (`con_comentarios`), pendientes de aprobación formal.
3. **A7:** valores de `windowDays`, `xpFactors` y `pmFactors`. El módulo admite la estructura, sin valores.
4. **A9, A10 y A12,** y la DPIA con PRIV-1 a PRIV-7.
5. **Cobertura de obra en MOOK:** cómo indica la autoría qué obra evalúa un nodo cuando un módulo incluye varias.

## 8. Pruebas e incidente

- **`recognition.test.mjs`:** 202 ✓, añadida a `test:gamification-core`. Seis defectos introducidos a propósito (PM por lectura, sin unicidad, sin techo, sin ventana, modalidad en la salida, nivel sin reflexión) hicieron fallar la suite; el módulo se restauró y se comprobó byte a byte.
- **Regresiones:** `test:gamification-core`, `test:gamification-g0`, `test:mook`, `test:royalties`, `test:reading-runtime`, `test:a11y-reader`, `typecheck:baseline` y `build` en verde.
- **Incidente local sin causa determinada:** en la primera corrida, `mookHooksHttp` falló con `no arrancó off`: `server.js` no respondió `/api/health` en unos 60 s. No se reprodujo en 5 corridas aisladas ni en 2 cadenas completas (28 s cada una). No es atribuible a esta unidad: `server.js` no importa `recognition.mjs` y la suite corre antes que la nueva. Puertos fijos 3991–3993, así que no es el problema de puertos bloqueados de G4-01. La hipótesis de un arranque en frío lento en este disco no está comprobada.
- **Observación preexistente:** esa suite aísla `CHP_DATA_DIR`, pero el servidor registra `data-critical/events.db` como ruta. No se investigó si escribe allí; conviene revisarlo en una unidad aparte.

## 9. Fuera de esta unidad

Sin push de G4-03, despliegue, migraciones, flags activos ni conexión a usuarios reales. G4-04 no se inició. Contratos V1 y Eventos V1 siguen sin enmendar (G4-02 §7).
