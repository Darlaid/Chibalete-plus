# V7 — Decisiones para activar el primer piloto XP

**Fecha:** 2026-11-06. **Unidad:** V7-G4-PRIV-DECISION-01. **Estado:** `DECISIONS_READY`, propuesta para Dirección y Legal.

**No aprueba PRIV-6, no elige una base jurídica y no fija plazos.** Ordena las decisiones pendientes y separa lo que el sistema ya cumple de lo que falta.

**Base verificada:** producción `chibalete/api:zlib-6d09d47` ×2 ([evidencia](../ops/SEC_ZLIB_2026_DEPLOY_EVIDENCE.md)) y front `uxfix-b18f6f0`. Gamificación sin flags, sin clave, sin registro y sin `gamification.db`; `mook_review` en `XP_LOCKED_SOURCES` (`server/gamification/policy.mjs:36`). Experiencia `exp-1793925477270-j1onug` en borrador (versión `expv-1793925477472-portnp`, obra `content-1775766806680`).

**Fuentes** (no se repiten aquí): [PRIV-6 revisión](GAMIFICACION_PRIV_06_REVISION_JURIDICA_V1.md) (decisiones D1–D9, matriz R1–R18, checklist C-1…C-12), [aviso propuesto](GAMIFICACION_PRIV_06_AVISO_PROPUESTA_V1.md), [PRIV-C7 retiro](GAMIFICACION_PRIV_C7_RETIRO_EXCLUSION_V1.md) (L1–L5, requisitos P1–P4) y [ficha 03A](GAMIFICACION_G4_PILOT_03A_FICHA.md).

---

## 1. Resumen ejecutivo

1. **La parte técnica de privacidad está hecha y probada.** Minimización, seudonimización, fallo cerrado, agregados con k ≥ 5, sin calificación ni canjes, y retiro probado en laboratorio, incluida la restauración (PRIV-6 §2; PRIV-C7 §3, 60/60).
2. **Lo que falta son decisiones**: 9 de PRIV-6 (D1–D9), 5 de PRIV-C7 (L1–L5) y una nueva (N1, §2). Ninguna la puede tomar Ingeniería.
3. **Hallazgo nuevo: las flags no limitan el piloto a 5–10 lectores.** Al activarlo, puede ganar XP cualquier lector que cumpla dos condiciones: tener acceso explícito a la obra y recibir la aprobación de un mediador de alguno de sus grupos. Según la ficha 03A (2026-11-04), eso son unas **227 cuentas**: Grado 005 ×2 (160), Club FilBo (64) y 3 reglas de usuario. Además, la experiencia publicada se lista a **todos** los usuarios autenticados (§3.1).
4. **Esto importa según lo que decida Legal en D1:**
   - **Con información y oposición** (si Legal la considera válida), el sistema actual basta. El aviso debe llegar a todas las familias de los grupos con acceso, no solo a las 5–10 del piloto. El tamaño del piloto lo limita el mediador al invitar y aprobar: es un control humano, no técnico.
   - **Con autorización previa individual**, hoy solo se puede garantizar que nadie sin autorización genere datos excluyendo a las ~220 personas restantes. Esa exclusión es **irreversible** (PRIV-C7 §1) y crea un tombstone por cada menor que nunca participó. **No se recomienda.** Es el único **bloqueo técnico real**: se resolvería con una lista de participantes reversible, en una unidad técnica pequeña que no se ha implementado (§6).
5. **La activación exige en cualquier caso una release de código:** `mook_review` está bloqueado en una constante de `policy.mjs`. También hacen falta la clave de sujeto y el volumen del registro de exclusiones (P1–P3), cada uno con su propia orden.
6. **Recomendación a Dirección:** pedir a Legal que resuelva **primero D1 y N1**, porque fijan el modelo operativo y la siguiente unidad técnica. Después, cerrar D3, D7 y D9 (canal, entrega del aviso y responsable) y D4/D5 (conservación y copias).

## 2. Matriz de decisiones

Quién decide: **L** = Legal · **D** = Dirección · **L+D** = ambas. **Bloquea** = sin esa decisión no se activa.

| # | Decisión | Quién | Bloquea | Qué aporta ya el sistema | Si se decide… |
|---|---|---|---|---|---|
| **D1** | Base para tratar datos de menores: autorización previa o información con oposición | **L** | Sí | Nada lo impone; las flags activan para todos los elegibles (§3.1) | Autorización → bloqueo técnico B1 (§4). Oposición → sin código, pero el aviso llega a todos los elegibles |
| **D2** | Papel del colegio de «Grado 005» y el instrumento que lo documenta | **L+D** | Sí | — | Documento firmado; sin efecto técnico |
| **D3** | Canal formal de solicitudes y verificación de la representación | **L+D** | Sí | Retiro ejecutable por operador (PRIV-C7 §5.4) | Completa los pasos 0–1 del runbook |
| **D4** | Plazo de conservación del ledger, o declarar que no hay ninguno | **L+D** | Sí (como declaración) | El ledger no caduca (PRIV-6 §1, fila 4) | Un plazo exigiría una unidad de borrado (código); declarar «sin plazo» no requiere nada |
| **D5** | Copias: (a) activar declarando que no se depuran, o (b) ejecutar antes la retención aprobada | **L+D** | Sí | `forget`/`prune` prohibidos (COMP-07) | (a) Solo el texto del aviso. (b) Unidad de Ops propia |
| **D6** | Si PRIV-6 + Evidencia G4 bastan como DPIA del piloto | **L** | Sí | Paquete documental listo | Otro documento si Legal lo exige |
| **D7** | Canal y momento de entrega del aviso | **D** | Sí | No hay superficie en la app | Por el colegio, sin código; en la app, unidad de frontend |
| **D8** | Redacción de los derechos y plazos de respuesta | **L** | Sí | — | Completa el aviso B §8 |
| **D9** | Responsable operativo de retiros y bajas, y plazo interno | **D** | Sí | Runbook probado (PRIV-C7 §5) | Nombra los roles de PRIV-C7 §5.2 |
| **L1** | ¿Basta excluir y desvincular, o hay que borrar los asientos? | **L** | Sí | Excluye y desvincula; no borra (PRIV-C7 §4) | Borrar = código nuevo (bloqueo) |
| **L2** | ¿Se pueden conservar tombstone y referencia para impedir la reincorporación? | **L** | Sí | El tombstone es necesario para que la exclusión sobreviva a una restauración | Si no se permite, la exclusión no se puede garantizar tras restaurar (bloqueo de diseño) |
| **L3** | ¿Es aceptable que la exclusión sea irreversible? | **L+D** | Sí | No hay reincorporación | Si no es aceptable: código nuevo. **Pesa en D1:** con autorización previa, la exclusión no sirve para dejar fuera a quien no autorizó (§3.2) |
| **L4** | Texto de respuesta al titular | **L** | No para activar; sí antes del primer retiro | Lo que se puede afirmar: PRIV-C7 §4 | — |
| **L5** | Custodia del registro de solicitudes y de la copia del registro de exclusiones | **D** | Sí | El diseño exige custodia separada (PRIV-01D §8) | Completa P2 y P4 |
| **N1** | ¿Es aceptable que el piloto de 5–10 lectores se limite por invitación del mediador, sin garantía técnica? | **L+D** | Sí | Las flags son globales (§3.1) | Sí → modelo B. No → lista de participantes (B1) |

Todas las decisiones bloquean salvo L4. Seis son de Legal (D1, D6, D8, L1, L2, L4), tres de Dirección (D7, D9, L5) y seis de ambas (D2, D3, D4, D5, L3, N1).

## 3. Modelo operativo recomendado (sujeto a Legal)

### 3.1 Lo que hace el sistema al activar

| Hecho | Evidencia |
|---|---|
| `GAMIFICATION_ENABLED`, `XP_EARNING_ENABLED` y el conjunto de reglas son **globales**. No hay ninguna lista de participantes en el código | `policy.mjs`; `mookSource.mjs:65-73` (`makeResolveUser` solo comprueba que la cuenta exista, esté activa y no sea sintética) |
| Solo genera XP una entrega **aprobada** por un mediador con membresía activa en un grupo del lector, o por un administrador | `server.js:3069` `requireReviewScope` |
| Solo cuenta un acceso **explícito** a la obra, congelado en la primera entrega | `mookWorks.mjs:37` `EXPLICIT_ACCESS_VIAS`; `progress.mjs:185` |
| Una experiencia publicada se lista a todos los usuarios autenticados | `server.js:2904` → `experienceStore.listPublishedFor` (sin filtro de grupo) |
| La obra piloto tiene acceso explícito para Grado 005 ×2, Club FilBo y 3 reglas de usuario (~227 cuentas) | Ficha 03A §2 (lectura del 2026-11-04; no se volvió a comprobar) |
| «Mi progreso» solo se enlaza tras una producción aprobada | `pages/Experiencias.tsx:572,684` |
| La única experiencia con nodos PRODUCTION es la del piloto: nada más puede generar XP de `mook_review` | Ficha 03A §1; G4-PILOT-GATE-03C |

### 3.2 Alternativas de participación

| | **A. Autorización previa individual** | **B. Información y oposición** (solo si Legal la valida) |
|---|---|---|
| Quién participa | Solo quienes autorizan | Todos los elegibles que completen y reciban aprobación, salvo quienes se opongan |
| A quién se informa | Familias de los 5–10 invitados | **Todas** las familias con acceso a la obra (~227), antes del corte |
| Cómo se deja fuera a los demás | **Con el sistema actual, solo excluyéndolos.** La exclusión es irreversible y crea tombstones de menores que nunca participaron (L2, L3). Alternativa: una lista de participantes reversible (B1, código nuevo) | Con el retiro de PRIV-C7 para quien se oponga |
| Tamaño real del piloto | Garantizado técnicamente (con B1) | Lo limita el mediador al invitar y aprobar. Otros mediadores de los mismos grupos también podrían aprobar |
| Código antes de activar | **Sí:** B1 | No, aparte de la release de activación |
| Riesgo principal | Retraso por la unidad B1 | Que participe alguien a cuya familia no le llegó el aviso. Depende de la cobertura de D7 |

### 3.3 Modelo común (cualquiera que sea la alternativa)

1. **Cohorte:** de 5 a 10 lectores de **un** grupo «Grado 005» y **un** mediador responsable, que es quien invita y aprueba (ficha 03A §3). [DIRECCIÓN: nombrar el grupo y el mediador; ningún dato de menores en documentos de Ingeniería.]
2. **Comunicación:** aviso B a las familias y aviso C a los mediadores, por el canal de D7, **antes** de fijar `GAMIFICATION_MOOK_SINCE`. El colegio, según D2. El aviso A, a los lectores invitados.
3. **Exclusión de quienes no deban participar:** retiro de PRIV-C7 §5.4, con verificación cruzada, **antes** del corte. En la alternativa A, mediante B1, no con exclusiones masivas.
4. **Solicitudes:** canal de D3. Las ejecuta el responsable de D9 y se anotan con una referencia opaca (PRIV-C7 §5.3–5.5).
5. **Custodia independiente:** el registro de exclusiones en su propio volumen, compartido por las dos réplicas, con una copia separada (P1, P2). El registro de solicitudes queda en Dirección (P4, L5).
6. **Conservación y restauración:** lo que decidan D4/D5. Tras cualquier restauración, contrastar las líneas del registro con las solicitudes atendidas (PRIV-C7 §5.6).
7. **Información visible:**
   - El lector ve su XP, su nivel y sus logros en «Mi progreso».
   - El mediador ve las entregas (como hoy) y, en Aula Viva, solo el número de lectores con obra reconocida, nunca con menos de 5 (PRIV-6 §1, filas 5a–5b).

## 4. Checklist GO / NO-GO

**GO: satisfecho, con evidencia**

| # | Requisito | Evidencia |
|---|---|---|
| G1 | Minimización (sin textos, `features` vacío, día) | PRIV-6 §1, fila 2; `ledger.mjs:46` |
| G2 | Seudonimización por sujeto aleatorio y HMAC | PRIV-6 R10; `subjects.mjs` |
| G3 | Fallo cerrado sin clave o sin registro | PRIV-6 §2.3; PRIV-C7 §3 (OP, N) |
| G4 | No califica, no condiciona, sin PM ni canjes | PRIV-6 R13; `policy.mjs:35` |
| G5 | Mediador: agregados con k ≥ 5 | PRIV-6 R12; `progress.mjs:333` |
| G6 | Retiro ejecutable e idempotente; la vista queda a cero; la revisión pedagógica sigue intacta | PRIV-C7 §3 (C3–C5, OP) |
| G7 | La exclusión sobrevive a una restauración con reaplicación | PRIV-C7 §3 (C6–C7) |
| G8 | Sin retroactividad (`GAMIFICATION_MOOK_SINCE`) | PRIV-6 §2.5 |
| G9 | Contenido piloto cargado como borrador privado | G4-PILOT-GATE-03C |
| G10 | Imagen API productiva sin HIGH/CRITICAL conocidos | SEC-ZLIB-2026-DEPLOY |
| G11 | Aviso redactado y verificado frente al código | PRIV-6 §7 |

**DECISIÓN: requiere aprobación**

- [ ] D1, D6, D8, L1, L2 y L4 (Legal).
- [ ] D2, D3, D4, D5, L3 y N1 (Legal y Dirección).
- [ ] D7, D9 y L5 (Dirección).
- [ ] Aviso B sin marcas, aprobado por escrito con autoridad y fecha (PRIV-6 C-3).
- [ ] `approvalRef` del conjunto de reglas, emitido por Dirección (el código no fija ninguno: `xpPilotEmission.test.mjs` [8]).

**BLOQUEO TÉCNICO: imposible con el sistema actual**

| # | Bloqueo | Cuándo aplica | Alternativa mínima (no implementada) |
|---|---|---|---|
| **B1** | Limitar técnicamente la participación a una lista de autorizados **sin efectos irreversibles** | Si D1 = autorización previa, o si N1 = no | Una lista de participantes en el servidor, rechazada por defecto y reversible, consultada en la elegibilidad del sujeto. Sin interfaz. Ver §6 |
| B2 | Borrar los asientos del ledger | Solo si L1 lo exige | Unidad de borrado (sin diseñar) |
| B3 | Reincorporar a una persona excluida | Solo si L3 lo exige | Unidad propia (sin diseñar) |
| B4 | Plazo de conservación ejecutado | Solo si D4 fija un plazo | Unidad de caducidad (sin diseñar) |

**No son bloqueos** (preparación con orden propia, PRIV-6 C-5…C-12): clave de sujeto, volumen y copia del registro, desbloqueo de `mook_review` (release de código), carga de reglas, corte y publicación de la versión. Tampoco lo son las mejoras diferibles de PRIV-6 (R15–R18), la cascada de baja de cuenta (COMP-08, cubierta por el runbook C-8) ni la entrega del aviso dentro de la app.

**NO-GO hoy:** faltan todas las decisiones. Si D1 = A o N1 = no, falta además B1.

## 5. Decisiones que Dirección debe adoptar

1. **Encargar a Legal** D1, D6, D8, L1, L2 y L4, empezando por **D1**.
2. **Con Legal:** N1 (límite por invitación), D2 (colegio), D3 (canal y verificación), D4/D5 (conservación y copias) y L3 (irreversibilidad).
3. **Por sí misma:**
   - **D7:** cómo y cuándo se entrega el aviso. La recomendación técnica es por el colegio, sin código.
   - **D9:** quién recibe, verifica y ejecuta retiros, y en qué plazo.
   - **L5:** quién custodia el registro de solicitudes y la copia del registro.
   - Nombrar el grupo y el mediador del piloto.
   - Emitir el `approvalRef` de las reglas A7-A12-V3 cuando todo lo anterior esté cerrado.
4. **Aceptar o rechazar por escrito el riesgo residual** de PRIV-C7 §6 T3: si base y registro se restauran juntos desde copias antiguas, una exclusión puede perderse. Se mitiga con custodia separada y con el contraste tras cada restauración.

## 6. Condiciones para la próxima unidad técnica

**Ninguna unidad técnica empieza sin D1 y N1 resueltos por escrito.**

| Si… | Próxima unidad | Alcance máximo |
|---|---|---|
| D1 = autorización previa, o N1 = no | **G4-PILOT-ALLOWLIST-01** | Lista de participantes en el servidor, rechazada por defecto, fuera de `data/` y montada como el registro. La consulta el punto único de alta del sujeto (`ensureSubject`/`resolveUser`). Quitar a alguien de la lista no excluye ni borra. Probada en laboratorio con datos sintéticos. **Sin interfaz, sin activar y sin desplegar en la misma unidad** |
| D1 = oposición y N1 = sí | **G4-ACTIVATE-PREP-01** | Clave de sujeto (P3), volumen y copia del registro (P1, P2), release con `mook_review` desbloqueado y flags **sin definir**. Sin reglas, sin corte y sin publicar |
| En ambos casos, después | **G4-ACTIVATE-01** | Reglas con `approvalRef`, `GAMIFICATION_MOOK_SINCE` y, **después**, publicar la versión (PRIV-6 C-12). Solo con C-1…C-11 cerrados y los avisos entregados |
| L1, L3 o D4 exigen borrado, reincorporación o plazo | Unidad propia por cada uno | Diseño previo; no se adelanta |

**Ninguna de estas unidades se ha iniciado.**
