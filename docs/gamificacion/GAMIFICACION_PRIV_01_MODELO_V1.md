# GAMIFICACION-PRIV-01A: modelo de identidad, privacidad y conservación V1

**Fecha:** 2026-10-30 · **Base:** `bfde5c0` · **Producción:** `g0-f4836d1`. `gamification.db` no existe en producción ni en este equipo.
**Naturaleza:** propuesta de ingeniería, solo documento. **No es una valoración jurídica:** todo lo marcado **[LEGAL]** o **[DIRECCIÓN]** está pendiente de esa revisión. Sustituye a G4-06 y desarrolla PRIV-1 a PRIV-7 de [Evidencia y privacidad V1](GAMIFICACION_G4_EVIDENCIA_PRIVACIDAD_V1.md).
**Hermano:** [Implementación V1](GAMIFICACION_PRIV_01_IMPLEMENTACION_V1.md).

**Convención:** **[ING]** = decisión técnica propuesta. **[LEGAL]** = requiere DPO/Legal. **[DIRECCIÓN]** = requiere aprobación de Dirección. Ningún plazo de este documento está aprobado.

---

## 1. Auditoría

### 1.1 Qué permite reconocer a una persona

Ningún identificador de este sistema anonimiza. `user_id` es seudónimo vinculable al padrón (`CHP_MOOK_EVENTS_EVIDENCE_PRIVACY_RETENTION_01`). Sustituirlo por un hash tampoco elimina el carácter personal.

| Dato | Dónde | Reconocimiento | Riesgo |
|---|---|---|---|
| `user_id` | `gm_source_facts`, `gm_xp_entries`, `gm_achievements`, `gm_redemptions`, `gm_pm_movements`, `gm_pm_balances`, `gm_reward_grants` | Directo vía padrón | Sin `UPDATE`: no se puede desvincular |
| `actor_id` | Hechos, movimientos, transiciones, auditoría | Directo: mediador o administrador | Igual |
| `target_user` | `gm_admin_audit` | Directo | Append-only |
| `source_event_id` de `mook_experience` | `usuario:versión` (`reconcile.mjs`) | **`userId` dentro de una clave** | No se limpia desvinculando la columna |
| `source_event_id` de `mook_review` | `evidenceId` | Indirecto: `mook_db.json` encadena al usuario | Sobrevive a la desvinculación |
| `idempotency_key` de ajuste | `adj:${actorId}:…` (`ledger.mjs:243`) | **`actorId` en la clave** | Igual |
| `fact_id`, `movement_id`, `entry_id` | `ulid(now)` | **Incrustan el milisegundo** | Cuasi-identificador |
| `occurred_at` | Hechos | Igual a `reviewedAt` o `completedAt` de MOOK **al milisegundo** | Un cruce reidentifica filas desvinculadas |
| `features_json` | Hechos | `experienceVersionId`, y `verdict`/`distinctDays`/`maxProgressPct` si hay lectura | Permanente: la tabla es append-only |
| Combinación fecha + experiencia | Hechos | Cuasi-identificador en grupos pequeños | Reidentificación por singularidad |

**El resto de sistemas (deuda previa, fuera de esta unidad):**

| Sistema | Hallazgo |
|---|---|
| `DELETE /api/users/:id` | Quita padrón y grupos. No toca progreso, eventos, MOOK ni Leo (COMP-08) |
| Auditoría `delete_user` | Conserva el **correo** del usuario borrado (`writeAuditLog`) |
| Logs | `Contenido completado: <usuario>:<obra>` (`server.js:5231`) y `user=<id>` en accesos. Registra lectura por persona; retención objetivo de 30 días |
| `mook_db.json` | Texto libre de menores, sin función de borrado |
| Backups | `forget/prune` no ejecutados según la última evidencia; el runner los rechaza a propósito |
| `events.archive.db` | Expiración apagada en la última evidencia (2026-09-21); no reverificado en producción |
| Exportaciones | `/api/*/export-submissions` y `/api/reports/*` no leen gamificación. No existe ruta `/api/gamification/*` |
| RBAC | Sin lectura de ledger expuesta. El padrón no tiene edad fiable: `fecha_nacimiento` es opcional |

### 1.2 Hallazgos que condicionan el diseño

| # | Hallazgo | Verificación | Consecuencia |
|---|---|---|---|
| H1 | **La supresión se desharía sola.** `reconcile` barre `mook_db.json`; si el usuario ya no está en el padrón, registra `rejected_not_eligible` **con su `userId`** | `reconcile.mjs`, `mookSource.mjs` | Hace falta bloqueo de reaparición |
| H2 | Se persisten hechos que no emiten: `rejected_*` y `observed` | `ledger.mjs` | Datos personales sin finalidad |
| H3 | **Borrar una fila no borra el dato:** sin `secure_delete`, el id sigue legible en el archivo | Probado en SQLite temporal | `secure_delete=ON` + checkpoint |
| H4 | Un `restore` reactivaría vínculos suprimidos | Backups cada 6 h | Puerta de restauración |
| H5 | El bloqueo por obra aún no tiene dónde vivir | G4-04 | Tabla de ciclos |

---

## 2. Contrato de sujeto

### 2.1 Modelo [ING]

```text
padrón (user_id) ──► gm_subjects ──► subject_ref ──► resto del ledger
                     mutable y borrable             append-only, sin user_id
```

| Campo | Contenido |
|---|---|
| `subject_ref` | Aleatorio de 128 bits. **No derivado de `user_id`:** no se puede recalcular |
| `user_id` | Único vínculo con la identidad canónica. `UNIQUE` |
| `subject_salt` | 32 bytes aleatorios por sujeto. Clave de sus `source_key` y `work_key` |
| `role_class` | `reader` o `actor` |
| `created_on` | Solo día |

**Por qué aleatorio y no hash:** un hash de `user_id` se recalcula con el padrón, de modo que borrar la tabla no desvincularía nada. Con referencia aleatoria y sal por sujeto, borrar una fila rompe el vínculo y además impide recalcular sus claves.

**No se afirma que esto anonimice.** Tras desvincular, las filas restantes podrían reidentificarse en combinación con otras fuentes. Si equivalen a datos anónimos es **[LEGAL]** (§4.4).

### 2.2 Reglas

| Tema | Regla [ING] |
|---|---|
| **Creación** | Solo con cuenta existente, activa, no sintética y sin tombstone, dentro de la transacción `IMMEDIATE` del primer hecho que emite |
| **Duplicados entre réplicas** | `INSERT … ON CONFLICT(user_id) DO NOTHING` + relectura en la misma transacción. `BEGIN IMMEDIATE` serializa |
| **Asociación controlada** | Un solo módulo (`subjects.mjs`) resuelve `user_id ↔ subject_ref`. Nada de la API ni del RBAC devuelve `subject_ref` |
| **Sintéticas** | `isSyntheticUser`: sin sujeto y **sin fila**. Hoy se escribe un rechazo (H2) |
| **Inactivas o inexistentes** | Sin sujeto y sin fila. Reactivar no da efecto retroactivo |
| **Reconciliación** | El barrido resuelve al sujeto en memoria, calcula `source_key` y compara. Nunca escribe `user_id` fuera de `gm_subjects`, ni lo registra en logs |
| **Mediadores** | Mismo modelo con `role_class='actor'`. Su `actor_ref` nunca se expone al lector |

### 2.3 Claves sin identidad [ING]

| Clave | Hoy | Propuesta |
|---|---|---|
| `source_event_id` de `mook_review` | `evidenceId` | `HMAC(subject_salt, 'mook_review:' ‖ evidenceId)` |
| `source_event_id` de `mook_experience` | `usuario:versión` | `HMAC(subject_salt, 'mook_experience:' ‖ versión)` |
| `reading_completion` | Sin implementar | `HMAC(subject_salt, 'reading:' ‖ work ‖ ':' ‖ ciclo)` (GATED por PRIV-2 y PRIV-3) |
| Ajuste | `adj:${actorId}:…` | `adj:${actor_ref}:…` |
| Ids de filas | `ulid(now)` | Aleatorios sin tiempo. El orden lo da `seq` |

Con sal por sujeto, dos lectores producen claves distintas para el mismo hecho y no se pueden cruzar entre sí. Al borrar la sal, las claves dejan de ser recalculables.

**Coste aceptado:** no habrá estadísticas por obra desde el ledger. Para eso existen los agregados de Aula Viva.

### 2.4 Precisión temporal [ING]

`occurred_at`, `recorded_at` y `created_at` se guardan como **día en Bogotá**. Los topes ya usan `period_day` y `period_week`, y el orden lo da `seq`, así que no se necesita el milisegundo. Las secuencias y fechas siguen siendo datos de comportamiento; la mitigación reduce el riesgo de cruce, no lo elimina.

---

## 3. Evidencias y minimización

### 3.1 Qué necesita el ledger

| Dato | Decisión |
|---|---|
| Sujeto, `source`, `fact_type`, `grade`, `decision`, `rule_version`, día | **Persistir** |
| `source_key` | **Persistir:** idempotencia |
| `work_key`, ciclo | **Persistir** solo en `gm_work_cycles` |
| Montos de XP y PM | **Persistir** |
| `actor_ref` | **Persistir** solo si un humano validó |
| `verdict` | Solo `plausible`, y solo cuando emite |
| `experienceVersionId` | No: `features_json` vacío en MOOK |

### 3.2 Qué no se persiste

| Dato | Motivo |
|---|---|
| `mode`, `activeMinutes`, `sessions`, `distinctDays`, `maxProgressPct`, `monotonic`, `lengthUnits` | Ritmo e inferencias; sin finalidad aprobada |
| **Observaciones individuales del validador** | Sin finalidad ni política aprobadas (PRIV-1b) |
| `implausible` o `insufficient_data` por persona | Etiqueta negativa sobre un menor |
| Hechos sin efecto (`observed`, `rejected_*`, `disabled_source`) | H2: se reevalúan en cada barrido si hace falta |
| Texto libre, respuestas, retroalimentación, contenido de Leo | Prohibido (ADR §8) |
| Fechas con precisión de milisegundo | §2.4 |
| Nombre, correo, grupo, colegio, edad | Sin necesidad |

**Efecto de no persistir `observed`:** un hecho ya observado podría emitir si una regla cambia. El corte de activación por regla impide ese efecto retroactivo (D48).

### 3.3 Modalidad accesible

- `mode` no se persiste en ningún store de gamificación. `recognition.mjs` ya no lo devuelve y G4-04 lo retiró de `features`.
- La comparación entre modalidades se hace solo en lote agregado con mínimos de cohorte (PRIV-1), nunca por persona.
- El logro «Varios formatos» usa la familia de la obra, no el visor, y sigue diferido.
- Equivalencia de resultado: el accesible no da más ni menos reconocimiento por sí mismo.
- **`mode` sigue en `events.db`,** como columna de telemetría ajena al ledger. Es deuda del sistema de eventos, que la DPIA debe cubrir **[LEGAL]**.

### 3.4 Logros y progreso sin telemetría

- XP, nivel y logros se derivan de `gm_xp_entries`, `gm_achievements` y `gm_work_cycles`, sin eventos.
- La expiración de `events.db` no borra ningún reconocimiento: el hecho ya emitido es la prueba.
- **Evidencia temporal:** telemetría en `events.db`, con su retención y fuera del ledger.
- **Reconocimiento duradero:** hechos mínimos.
- **Movimientos económicos:** `gm_pm_movements`. Nunca dependen de que exista la evidencia original.

---

## 4. Eliminación, retención y respaldos

### 4.1 Clases de dato

| Clase | Contenido | Tratamiento en supresión | Plazo propuesto |
|---|---|---|---|
| **Vínculo** | `gm_subjects` | **Borrado físico** | Hasta supresión o fin de relación + N **[LEGAL]** |
| **Reconocimiento** | Hechos, XP, logros, ciclos | Se conserva sin vínculo; alternativa §4.4 | **[LEGAL]** |
| **Económico** | PM, canjes | Se extingue y se conserva sin vínculo | **[LEGAL]** |
| **Obligación legal** | Cupones y datos comerciales (no existen; G6) | Según la norma aplicable | **[LEGAL]** |
| **Auditoría** | `gm_admin_audit` | Sin `target_ref` resoluble | **[LEGAL]** |
| **Registro de supresión** | `gm_erasures` | Se conserva mientras exista riesgo de reaparición | **[LEGAL]** |
| **Copias** | Backups | Expiran; no se editan | Política 7/4/6, aún sin ejecutar |

Lo conservado por obligación legal debe registrarse aparte, con fundamento, alcance y fecha de expiración (política de retención §6). Sin ese registro, no aplica la excepción.

### 4.2 Procedimiento de supresión [ING]

| Paso | Acción | Evidencia |
|---|---|---|
| 1 | Recibir la solicitud y verificar identidad y representación **[LEGAL]** | Referencia opaca de solicitud |
| 2 | Detener nuevas emisiones del sujeto: tombstone | Fila en `gm_erasures` |
| 3 | Cerrar canjes abiertos | Transiciones |
| 4 | Extinguir saldo con `compensation` auditada | Movimiento |
| 5 | Borrar `gm_subjects` en esa misma transacción | Recuento antes y después |
| 6 | `wal_checkpoint(TRUNCATE)` con `secure_delete=ON` | Comprobación de bytes |
| 7 | Anotar el tombstone en el registro externo | Entrada en el registro |
| 8 | Emitir acuse sin datos personales | Id, fecha, recuentos, `verifyLedger` |

Es idempotente: repetirlo no cambia nada. El saldo se extingue porque los PM dejan de tener titular.

**Tombstone:** `HMAC(pepper, user_id)`, con `pepper` como secreto de archivo. Sin él no se puede recalcular. Sigue siendo un dato seudónimo: su conservación es **[LEGAL]**.

### 4.3 Prevención de reaparición [ING]

| Vía | Control |
|---|---|
| Barrido del reconciliador | Antes de cualquier lectura, comprueba tombstone: no crea sujeto ni fila |
| Gancho en línea | Igual |
| Usuario borrado del padrón | Sin cuenta no hay sujeto ni fila. Elimina H1 |
| Nueva cuenta de la misma persona | `user_id` nuevo: empieza de cero. Ligarlas sería reidentificar |
| Restauración de backup | §4.5 |

### 4.4 Física frente a desvinculación

**Recomendación [ING]: desvinculación.** Mantiene append-only, I1–I6 y el saldo agregado sin excepciones.

**Alternativa disponible si Legal concluye que lo desvinculado sigue siendo dato personal:** purga física de **todas** las filas de un sujeto, dentro de una migración autorizada que retire y restaure los triggers. No rompe las invariantes por sujeto, porque un sujeto no referencia filas de otro; sí deja huecos de `seq` y exige acta. No se implementa ahora.

### 4.5 Restauración [ING]

Un `restore` trae de vuelta vínculos suprimidos después del snapshot, y también un `gm_erasures` antiguo. Por eso:

1. El **registro de supresiones** se mantiene **fuera del conjunto restaurado**. Su custodia es **[DIRECCIÓN]**.
2. `GAMIFICATION_ENABLED` permanece OFF al restaurar.
3. Se reaplican todas las supresiones del registro con posterioridad al snapshot.
4. Se verifica que ningún tombstone tiene sujeto.
5. Solo entonces se activa. Un `restore` sin ese paso no reabre la gamificación.

Cada copia restaurada para pruebas debe tratarse como dato personal, y el `pepper` se respalda aparte.

**Límite que debe informarse al titular:** mientras no se ejecute `forget/prune`, no se puede prometer un plazo de desaparición de las copias.

---

## 5. Modelo de obra para MOOK

### 5.1 Identidad de obra

**`workRef` es el `contentId` canónico.** No se crea otra identidad. `resourceRef` de los nodos ya es canónico y `bookExists` lo valida al publicar; la versión es inmutable, así que la atribución no cambia.

**Lo que aún no existe:** una regla editorial sobre qué contenidos son «obra». En el catálogo local, de 61 elementos sin contrastar con producción, 15 tienen `parentId`: capítulos, guías y videos asociados.

| Contenido | Propuesta | Estado |
|---|---|---|
| Sin `parentId` | Es obra | [ING] |
| Hijo `libro` | Cuenta para su raíz | **[DIRECCIÓN]** Editorial |
| Hijo `guia` o `video` | Material de apoyo, no obra | **[DIRECCIÓN]** Editorial |
| `isCollection` | No es obra; sus piezas se evalúan aparte | **[DIRECCIÓN]** Editorial |
| `podcast`, `articulo_pedagogico` | Obra si se decide | **[DIRECCIÓN]** Editorial |

Hasta decidirlo, cualquier `resourceRef` no clasificado **queda sin elegibilidad**.

### 5.2 Atribución explícita

La atribución se **declara en la autoría** de la versión, nunca se infiere:

```js
node.config.recognition = {
    evidenceKind: 'comprehension' | 'participation',
    coverage: 'single' | 'multi' | 'general',
    workRefs: ['<contentId>', ...],   // subconjunto de resourceRef de esa versión
};
```

**Se prohíbe** inferir la obra por título, por texto generado por IA, por proximidad entre nodos o por ser el único `resourceRef` del módulo.

| Caso | Declaración | XP dependiente de obra | PM (cuando se habilite) |
|---|---|---|---|
| **Una obra** | `single`, una ref | Sí, con techo por obra y ciclo | Uno por obra y ciclo |
| **Varias obras** | `multi`, 2 a `N_MAX` | Corrobora lectura de cada una, con techo | **Una emisión** que reserva el ciclo de todas; si alguna ya lo tiene, 0 |
| **Experiencia general** | `general`, sin refs | No | No. Solo XP de ruta |
| **Participación** | `participation` | No como comprensión | No |
| **Sin declaración** | — | **No** | **No** |
| **Versión ya publicada** | Inmutable | **No** | **No.** Requiere nueva versión |

**Comprensión:** solo `evidenceKind='comprehension'` en una `PRODUCTION`, con revisión `aprobado` de otra persona. `ACTIVITY` sigue siendo participación aunque se declare otra cosa: el servidor lo rechaza al publicar. La bitácora privada no es evaluable.

**Ciclos:** usan `decideRecognition`, con el historial de `gm_work_cycles`, dentro de la transacción. Los de lectura dependen de PRIV-2 y PRIV-3.

**Efecto actual:** en la copia local solo 6 de 253 nodos son `PRODUCTION`, y existen módulos con dos o más recursos. La mayoría de la evidencia MOOK no será elegible hasta que Editorial la declare. Es el resultado correcto: ante una atribución ambigua no se otorga nada.

### 5.3 En el ledger

`work_key = HMAC(subject_salt, contentId)`. El `contentId` en claro no se persiste en gamificación. Al borrar la sal, la obra leída no se puede recalcular.

---

## 6. Matriz PRIV-1 a PRIV-7

| ID | Tema | Resolución propuesta | Tipo | Estado | Condición de desbloqueo |
|---|---|---|---|---|---|
| **PRIV-1** | Calibración | Lote agregado sin persistencia por persona | [ING] + [LEGAL] | **GATED** | Visto bueno DPO, cohorte mínima, unidad operativa |
| **PRIV-1b** | Observaciones individuales | **No persistir** | [ING] | **Cerrado: no se hace** | Solo con finalidad y política aprobadas |
| **PRIV-2** | Instante de finalización | No conservar. `progress.db` no cambia | [ING] | **Cerrado por ahora** | Reabrir solo si el piloto lo exige, con autorización |
| **PRIV-3** | Hechos con obra | `work_key` con sal, `source_key`, solo día | [ING] + [LEGAL] | **GATED** | DPIA, retención, PRIV-4 |
| **PRIV-4** | Sujeto | `gm_subjects` aleatorio con sal | [ING] + [LEGAL] | **Propuesta lista, GATED** | Aprobación de la opción; antes del primer hecho real |
| **PRIV-5** | Supresión | §4, con tombstone y puerta de restauración | [ING] + [LEGAL] + [DIRECCIÓN] | **GATED** | Procedimiento aprobado, custodia del registro, `forget/prune` ejecutado |
| **PRIV-6** | Aviso y base | Fuera de ingeniería | [LEGAL] | **GATED** | Texto y base del tratamiento, información a menores y mediadores |
| **PRIV-7** | Instrumentación | No instrumentar en V1 | [ING] + [DIRECCIÓN] | **GATED** | Decisión A9 y análisis propio |

---

## 7. Decisiones pendientes

### Revisión jurídica [LEGAL]

1. Base del tratamiento y aviso para menores y mediadores (PRIV-6).
2. Si los datos desvinculados dejan de ser personales, o si procede purga física (§4.4).
3. Plazos de cada clase (§4.1) y de los tombstones.
4. Quién puede solicitar por un menor y cómo se verifica, sin vínculo adulto-menor en el sistema.
5. Procedencia de la oposición a participar, por cuenta o por colegio.
6. Obligaciones legales aplicables a canjes y cupones futuros.
7. Si `mode` en `events.db` requiere medidas adicionales.

### Dirección [DIRECCIÓN]

1. Aprobar el modelo de sujeto.
2. Responsable de la DPIA y owner (D50).
3. Custodia del registro de supresiones.
4. Autorizar `forget/prune` y la expiración del archivo.
5. Comprometer cobertura de `recognition` en nuevas versiones MOOK.

### Editorial y Pedagogía

1. Qué contenidos son obra (§5.1) y `N_MAX`.
2. Criterio de `comprehension` frente a `participation`.
3. A5, A6, A7, A9, A10 y A12 siguen abiertas.
