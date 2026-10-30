# GAMIFICACION-G4-02: evidencia, privacidad y persistencia V1

**Fecha:** 2026-10-30 · **Base:** `0252b7a` · **Producción:** `g0-f4836d1`, sin cambios. El código de G3 y G4 no está desplegado y `gamification.db` no existe en producción.
**Estado:** evaluación técnica previa a la DPIA. **No se implementa ninguna persistencia.** No es una valoración jurídica: las calificaciones legales (incluida la Ley 1581 y el tratamiento de datos de menores) corresponden a DPO/Legal, como ya estableció `CHP_PRIVACY_SECURITY_AI_EVIDENCE_01A`.
**Relacionados:** [Reconocimiento lector V1](GAMIFICACION_G4_RECONOCIMIENTO_LECTOR_V1.md), [ADR G2 §8](GAMIFICACION_ADR_G2_V1.md), [Modelo de datos §5](GAMIFICACION_MODELO_DATOS_V1.md) y `docs/ops/CHP_MOOK_EVENTS_EVIDENCE_RETENTION_POLICY_01.md`.

**GATED** significa aquí: no se implementa hasta cumplir la condición de desbloqueo indicada.

---

## 1. Conclusiones

1. **Persistir observaciones no es necesario para calibrar.** `events.db` ya conserva la telemetría, así que un lote de solo lectura puede producir agregados sin crear una copia por persona (§3.1).
2. **La propuesta de G4-01 no es viable tal como se escribió.** Una retención de 90 días en `gm_source_facts` es imposible: la tabla bloquea `DELETE` y `UPDATE` por trigger.
3. **Hay que decidir el sujeto antes de que exista un solo dato real.** Hoy eso es barato, porque la base no existe en producción. Después sería una migración de datos de menores sobre tablas append-only.
4. **El modo de lectura es un dato sensible por inferencia.** `mode='a11y'` en un hecho duradero sugiere una posible discapacidad de un menor. No debe persistir.
5. **«90 días» no significa 90 días** mientras no se ejecuten `restic forget/prune` y la expiración del archivo (§2).
6. **No existe vía de supresión.** `DELETE /api/users/:id` no alcanza progreso, eventos, MOOK ni el ledger.

---

## 2. Estado de partida verificado

| Elemento | Estado | Fuente | Implicación |
|---|---|---|---|
| `events.db` | Política: 90 días en caliente | `RETENTION_POLICY_01` §5.1 | Ventana del validador |
| `events.archive.db` | Política: hasta 12 meses y eliminación definitiva. Rotación activa en api_1 y **expiración OFF** en la última evidencia registrada (2026-09-21); no se reverificó en producción | Política §5.1; evidencia de la Etapa 10D | Hoy la telemetría cruda puede superar los 12 meses |
| Backups | Objetivo 7/4/6 snapshots. `forget/prune` **nunca ejecutados** según la última evidencia | Política §5.4; `PRIVACY_SECURITY_AI_EVIDENCE_01A` | Un dato borrado sigue en copia indefinidamente mientras no se ejecuten |
| `gamification.db` | Incluido en el runner como opcional | G3-02 | Toda fila viva entra en copia |
| Tablas `gm_` | 8 append-only; `gm_pm_balances` sin `DELETE`; `gm_redemptions` con transiciones vigiladas | `migrations/0001_ledger.sql` | No admiten borrado ni reescritura de filas |
| Identificadores | El `user_id` es seudónimo vinculable al padrón; **no hay anonimización** | `CHP_MOOK_EVENTS_EVIDENCE_PRIVACY_RETENTION_01` | Todo lo que lleve `user_id` es dato personal |
| Borrado de usuario | `DELETE /api/users/:id` quita al usuario del padrón y de los grupos. No toca otros stores | `server/server.js:6319` | Sin cascada |
| Vía de supresión de evidencias | ABSENT | `PRIVACY_SECURITY_AI_EVIDENCE_01A` (COMP-07) | Deuda previa, no creada por gamificación |
| Vínculo adulto ↔ menor | No existe | Doctrina D35 | Sin canal verificable para que un adulto ejerza derechos en línea |
| Aviso de privacidad | Informativo, sin consentimiento | `CHP_LEO_MINOR_PRIVACY_NOTICE_01A` | La gamificación no está cubierta por ese aviso; a confirmar por Legal |
| DPIA de gamificación | **No existe** (N2) | Doctrina §6-10 | Bloquea activación con menores reales |

---

## 3. Evaluación por objeto

### 3.1 Observaciones del validador durante 90 días

**Qué se conservaría:** por lector y obra, veredicto, motivos, sesiones, días distintos, avance máximo, monotonía, longitud y modo.

**Riesgo:**

- Crea un perfil lector nuevo por menor, con ritmo y hábitos por obra.
- Etiqueta negativa: `implausible` puede leerse como «hizo trampa», aunque solo indica incoherencia con telemetría del cliente.
- `mode` revela uso de herramientas de accesibilidad (§6).
- Duplica lo que `events.db` ya tiene: el valor añadido es bajo mientras dure la observación.

| Opción | Descripción | Evaluación |
|---|---|---|
| A. `gm_source_facts` + `observed` (G4-01 §6.1) | Sin cambio de esquema | **Inviable para 90 días:** los triggers abortan el borrado y las filas pasarían a ser permanentes de hecho |
| B. Tabla mutable propia con purga | `gm_reading_observations` en migración 0002 | Viable, pero crea un store nuevo de datos de menores, purga, backup y derechos |
| C. **Lote agregado sin persistencia por persona** | Corrida de solo lectura en servidor; solo sale una distribución por cohorte sin `userId` | **Recomendada.** Cubre la calibración sin copia personal |
| D. No observar | Sin datos de calibración | Bloquea `enforce` |

**Recomendación: C.** Si la calibración mostrara que necesita seguimiento longitudinal por persona, pasar a B con un análisis propio.

**Limitación de C:** `progress.db` no guarda el instante de finalización, de modo que el lote toma como declaración el último progreso visible. Es suficiente para distribuciones; no lo es para auditar un caso.

**Estado:**
- **C — GATED:** requiere visto bueno de DPO (finalidad nueva sobre datos existentes), umbral mínimo de cohorte para no reidentificar y unidad operativa propia con lectura productiva autorizada.
- **B — GATED:** DPIA aprobada, purga probada, duración de backups asumida y G4-06 resuelta.
- **A:** descartada.

### 3.2 Conservación del instante de finalización canónica

**Para qué sirve:** recuperar hechos perdidos (hoy `reading_completion` es no recuperable, `reconcile.mjs:32`), calcular ciclos y explicar un reconocimiento.

| Opción | Datos | Evaluación |
|---|---|---|
| A. No conservarlo | — | Mientras la lectura no emita, **es lo correcto** |
| B. `first_completed_at` de una sola escritura en `progress.db` | Una fecha por lector y obra | Mínima; permite recuperar la primera lectura; **cambia el progreso canónico** |
| C. Historial de finalizaciones | Una fila por lectura | Más datos: revela patrones de relectura |
| D. Solo el `occurred_at` del hecho ya emitido | El propio ledger | Sin copia nueva, pero un hecho perdido no se recupera |

**Recomendación:** **A** ahora. Al activar la emisión de XP, **D**; añadir **B** solo si el piloto demuestra pérdidas de hechos que importen. Perder un XP automático es recuperable por VU y no justifica por sí solo tocar `progress.db`.

**Estado:** **B y C — GATED:** DPIA aprobada y unidad con autorización de cambio del progreso canónico (G4-09). **D** depende de 3.3.

### 3.3 Datos mínimos para verificar eventos y prevenir duplicados

| Campo | Necesario para | Decisión | Retención propuesta |
|---|---|---|---|
| Sujeto | Asignar el hecho | **Conservar**, como referencia opaca (§4.4) | Clase duradera |
| `source`, `fact_type`, `decision`, `grade`, `rule_version` | Auditoría (P3, D48) | Conservar | Clase duradera |
| `occurred_at`, `recorded_at` | Topes, ciclos y orden | Conservar | Clase duradera |
| Referencia de obra (`workRef`) | Duplicados, relectura y `obras_distintas` | Conservar como **HMAC con clave de servidor**, no `contentId` en claro ni hash sin clave | Clase duradera |
| Ciclo | Relectura | Conservar | Clase duradera |
| `actor_id` | Autorrevisión y trazabilidad | Conservar; es dato personal del mediador | Clase duradera |
| Veredicto | Explicar la decisión | Solo cuando **emite**; nunca persistir `implausible` por persona en el ledger | Clase duradera |
| `mode` | — | **No conservar** en hechos duraderos (§6) | — |
| Familia de formato de la obra | Logro «Varios formatos» | Derivada del catálogo, nunca del visor | Clase duradera |
| `sessions`, `distinctDays`, `maxProgressPct`, `monotonic`, `lengthUnits` | Calibración | **No conservar**: basta el lote agregado | — |
| `activeMinutes` | — | **Retirar** de la lista permitida | — |
| Texto libre, respuestas, contenido de Leo | — | **Prohibido** (ADR §8) | — |
| Id de evento crudo | Auditoría fina | No: los eventos expiran y la referencia queda colgada | — |

**Advertencias:**

- `observationKey` usa SHA-256 **sin clave** de datos enumerables: con padrón y catálogo se revierte. Es útil para idempotencia, pero no protege identidad.
- Un HMAC con clave es **seudonimización**, no anonimización. La clave vive como secreto de archivo, nunca en argumentos ni en el repositorio. Rotarla rompe la deduplicación histórica, salvo que se conserve la anterior.
- `workRef` no impide saber qué obra leyó alguien a quien tenga la clave y el catálogo. Lo que reduce es la exposición en copias y exportaciones.

**Retención propuesta (a decidir en la DPIA):** clase duradera mientras la cuenta tenga relación activa y hasta `FIN_RELACION + 12 meses`, igual que las evidencias pedagógicas (política §5.2). Después se desvincula al sujeto (§4.4).

**Consecuencia para `features_json`:** el Modelo de datos §5 lo trata como «candidato natural a expirar antes», pero la tabla es append-only y **no puede expirar**. Lo que se escriba ahí es permanente: por eso la lista debe ser mínima desde la primera fila.

**Estado:** **GATED:** DPIA aprobada, y G4-06 antes de escribir el primer hecho de lectura.

### 3.4 Eliminación, anonimización y derechos del titular

Se desarrolla en §4.

---

## 4. Modelo de borrado y derechos

### 4.1 El problema

El ledger es append-only por doctrina (D27), y eso es correcto para la auditoría. Pero un derecho de supresión no puede depender de editar filas bloqueadas por trigger.

### 4.2 Filas que hoy impedirían desvincular a una persona

| Lugar | Contiene | Problema |
|---|---|---|
| `user_id` en 7 tablas `gm_` | Id del padrón | Sin `UPDATE` |
| `source_event_id` de `mook_experience` | `usuario:versión` | **El `userId` está incrustado dentro de una clave** |
| `source_event_id` de lectura (G2) | `usuario:obra:windowKey` | Igual, más la obra en claro |
| `gm_pm_movements.idempotency_key`, `reason_code` | Referencias derivadas | Revisar en la migración |
| `actor_id`, `gm_admin_audit.target_user` | Id de personas | Aplica también a mediadores y a soporte |
| `<db>` en backups | Todo lo anterior | Hasta que expire el último snapshot que lo contenga |

### 4.3 Clave de lectura unificada

Existen tres propuestas para `source_event_id`. **Recomendación:**

```text
source_event_id = HMAC(clave, subjectRef ‖ contentId) ‖ ':' ‖ ciclo
```

- Sustituye a `usuario:obra:windowKey` (G2) y a `observationKey` (G4-01).
- `UNIQUE(source, source_event_id, fact_type)` garantiza una sola lectura por ciclo sin `userId` en la clave.
- El mismo cambio aplica a `mook_experience`.

### 4.4 Opciones para el sujeto

| Opción | Descripción | Supresión | Coste | Evaluación |
|---|---|---|---|---|
| A. Conservar el id del padrón | Sin cambios | Las filas siguen vinculables por backups y logs | Nulo | **No recomendada** para datos de menores |
| B. Anonimizar por migración | Reescribir filas caso por caso, suspendiendo triggers | Real, pero rompe la inmutabilidad y es una operación manual de alto riesgo | Alto y recurrente | Solo como último recurso |
| C. **Indirección del sujeto** | `gm_subjects(subject_ref aleatorio, user_id)`, **mutable y borrable**; el resto del ledger solo guarda `subject_ref` | Se borra el vínculo y el ledger queda íntegro y sin conexión con la persona | Una migración, **hoy sin datos** | **Recomendada** |

**Con C:**

- Los invariantes I1–I6 y los triggers se mantienen sin excepciones.
- Tras borrar el vínculo, las filas restantes quedan como agregados históricos sin titular resoluble. **Si eso equivale a anonimización es una decisión de Legal, no se afirma aquí:** fechas y `workRef` podrían permitir reidentificar en combinación con otras fuentes.
- `actor_id` necesita el mismo tratamiento.
- **Ventana de oportunidad:** `0001` nunca se aplicó en producción, así que el cambio no migra datos. Debe hacerse antes de la primera activación real.

**Estado:** **GATED:** elección de la opción en la DPIA. Su condición es técnica además de legal: **ningún hecho real se escribe antes de cerrarla.**

### 4.5 Derechos: procedimiento propuesto

| Derecho o caso | Propuesta | Dependencia |
|---|---|---|
| **Acceso** | Exportación de hechos con motivos legibles, sin datos de terceros (`reviewerId` fuera) | `GET /me/*` (G3/G4); revisar el formato |
| **Rectificación** | Compensación o anulación (`void`), nunca edición (D30 y Contratos §5.6) | Existe en el ledger |
| **Oposición a la gamificación** | Opción de no participar sin afectar lectura, progreso, MOOK ni evaluación (P7, fallo seguro) | **Sin mecanismo.** Decidir si se ofrece por cuenta o por colegio |
| **Supresión** | Orden fija: (1) cerrar canjes abiertos; (2) extinguir saldo con movimiento compensatorio auditado; (3) borrar la fila de `gm_subjects`; (4) registrar en `gm_admin_audit` sin el id del padrón; (5) la copia expira según backups | Requiere 4.4 y la ejecución de `forget/prune` |
| **Baja de cuenta** | `DELETE /api/users/:id` debe invocar el paso anterior; hoy no lo hace, y no se modifica en esta unidad | Unidad propia |
| **Fin de la relación escolar** | Temporizador `FIN_RELACION + 12 meses`. Hoy no existe una fecha fiable de fin de relación | Definición funcional y Legal |
| **Menores** | Canal manual vía colegio o soporte con verificación de representación, mientras no exista vínculo adulto ↔ menor | Definir por Legal (D35) |
| **Decisiones automatizadas** | Ninguna sanción automática (DC-03). Toda consecuencia negativa pasa por revisión humana, con motivo y posibilidad de reclamar | DC-09 |
| **Efecto sobre logros y XP** | Se pierden al suprimir. El aviso debe decirlo antes de confirmar | UX + Legal |

**Límite honesto para el titular:** hasta que `forget/prune` esté en marcha, no se puede prometer un plazo de desaparición de las copias. Con la política 7/4/6, el dato vive hasta que expire el último snapshot mensual que lo contenga.

---

## 5. Matriz de estados GATED

| ID | Capacidad | Estado | Condición de desbloqueo | Responsable |
|---|---|---|---|---|
| PRIV-1 | Calibración agregada (§3.1 C) | **GATED** | Visto bueno de DPO, tamaño mínimo de cohorte y unidad con lectura productiva autorizada | DPO + Producto |
| PRIV-1b | Observaciones por persona (§3.1 B) | **GATED** | DPIA aprobada, necesidad demostrada por PRIV-1, purga probada y copias asumidas | DPO + Legal |
| PRIV-2 | Instante de finalización (§3.2 B y C) | **GATED** | DPIA aprobada y autorización de cambio en `progress.db` | DPO + Backend |
| PRIV-3 | Hechos de lectura con `workRef` (§3.3) | **GATED** | DPIA aprobada, retención decidida y PRIV-4 aplicada | DPO + Legal |
| PRIV-4 | Modelo de sujeto (§4.4) | **GATED** | Elección de opción en la DPIA, antes del primer hecho real | DPO + Legal + Backend |
| PRIV-5 | Supresión operativa (§4.5) | **GATED** | Procedimiento aprobado, PRIV-4 aplicada y calendario de `forget/prune` y expiración de archivo ejecutado | DPO + Ops |
| PRIV-6 | Aviso y base del tratamiento | **GATED** | Texto y base definidos por Legal, con información para menores y mediadores | Legal + UX |
| PRIV-7 | Instrumentar EPUB, audio o video | **GATED** | Decisión A9 y análisis propio de minimización | Producto + DPO |

**No GATED:** G4-03, G4-04 y G4-05, porque no tratan datos personales reales.

---

## 6. Inferencia de discapacidad por modo de lectura

- **Dato:** `mode` está en la lista permitida de `reading_completion` (`ledger.mjs:39`) y `readingValidator.mjs` lo devuelve en `features`.
- **Riesgo:** un `a11y` duradero, o la preferencia repetida por escucha guiada, puede sugerir discapacidad o dificultad lectora de un menor. Combinado con un perfil permanente, es una inferencia que nadie autorizó.
- **Recomendación:** no persistir el modo en hechos duraderos; retirar `mode` de la lista antes de G4-08; la diversidad usa la **familia de formato de la obra**; las métricas de equidad se calculan sobre esa familia y en agregado.
- **Tensión reconocida:** sin el modo no se puede medir en el ledger si el modo accesible recibe menos reconocimiento. Debe medirse en el lote agregado con mínimos de cohorte, no con una marca por persona.

---

## 7. Equidad frente a vigilancia

Instrumentar EPUB, audio y video daría XP automático simétrico. También significaría registrar cuánto escucha o mira un menor, con una telemetría igual de falsificable por el cliente. Añadiría datos personales sin añadir verificación real.

**Recomendación:** preferir evidencia independiente del visor (vías VU del documento hermano §4). Si tras el piloto la asimetría de XP resulta inaceptable, instrumentar con mínimos: solo hitos de avance, sin tiempo, y sin persistencia por persona más allá del hecho reconocido.

---

## 8. Riesgos de privacidad

| Riesgo | Severidad | Mitigación |
|---|---|---|
| Perfil lector permanente de menores en append-only | Alta | Sin datos de ritmo; `workRef`; PRIV-4 antes del primer dato |
| Etiqueta `implausible` asociada a una persona | Alta | No persistir por persona; nunca visible para lector ni mediador |
| Inferencia de discapacidad por `mode` | Alta | §6 |
| Claves con `userId` incrustado | Alta | §4.3, antes de activar |
| Copias que sobreviven al borrado | Alta | Ejecutar la política de backups y expiración antes de abrir a usuarios reales |
| Sin vía de supresión ni baja en cascada | Alta | PRIV-5 |
| Hash reversible tratado como anónimo | Media | HMAC y lenguaje correcto: seudónimo |
| Reidentificación en agregados de grupos pequeños | Media | Tamaño mínimo de cohorte |
| Texto libre filtrado en `note` o motivos | Media | Códigos enumerados; revisión de `note` en ajustes |
| Exposición al mediador de datos más allá de lo pedagógico | Media | XP, nivel y veredicto no se exponen individualmente (D37) |
| Clave HMAC perdida o filtrada | Media | Secreto de archivo, respaldo separado y rotación con procedimiento |
| Finalidad derivada hacia evaluación escolar | Media | Prohibir el uso de XP, nivel o veredicto para calificar; declararlo en el aviso |

---

## 9. Orden recomendado

1. Abrir la DPIA con este documento como insumo (N2).
2. Decidir PRIV-4 y aplicar G4-06 **mientras `gamification.db` no exista en producción**.
3. Ejecutar la retención aprobada de backups y archivo, o dejar por escrito qué plazo real puede prometerse.
4. Calibrar con PRIV-1.
5. Solo entonces, escribir hechos de lectura (G4-08).
