# V8 — Correspondencia entre los documentos 001–006 y la gamificación

**Fecha:** 2026-11-09. **Unidad:** V8-DOC-TECH-CORRESPONDENCE-01. **Veredicto:** `YELLOW`.

**Qué hace este documento:** contrasta, contrato por contrato, lo que exigen los documentos 001–006 de Chibalete Editores con lo que hace hoy el código. Señala las brechas comprobadas y la secuencia que falta antes de F2–F8.

**Qué no hace:** no activa nada ni aprueba los documentos. Tampoco elige una base jurídica ni valora la validez de ningún tratamiento.

**Fuentes:**
- Documentos 001–006 en PDF, leídos solo para consulta. Se citan por número, apartado y página, sin reproducir su texto.
- Código en `f175d5a`. Las modificaciones del árbol de trabajo son solo de fin de línea: `git diff --ignore-cr-at-eol` sale vacío.
- Unidades anteriores: [cierre operativo](GAMIFICACION_V8_GATE_CIERRE_OPERATIVO.md), [PRIV-C7](GAMIFICACION_PRIV_C7_RETIRO_EXCLUSION_V1.md) y [procedimiento F0–F8](GAMIFICACION_V8_ACTIVACION_OPERATIVA_V1.md).

**Notación:**
- **[H]** es un hecho comprobado en esta unidad, en el documento o en el código.
- **[Hip]** es una hipótesis no verificada.

## 0. Línea base verificada (2026-11-09, solo lectura)

| Elemento | Estado |
|---|---|
| Git | `chp/v8-integration-clean` = `f175d5a`, **1 commit por delante** de `origin/chp/epub-mainfile-r1-release` (`7aea77d`) [H]. `Tratamiento de datos/` sin seguimiento y fuera de Git [H] |
| Producción | `chibalete_api_1`, `chibalete_api_2` y `chibalete_front` = `unifiedxp-13b8045`, healthy; la imagen efectiva del override coincide [H] |
| Gamificación | 0 variables `GAMIFICATION_*` / `XP_EARNING*` / `PM_EARNING*` en las dos réplicas; sin `secrets/gamification_subject_key`; sin `data-critical/gamification.db` [H]. XP apagado; PM retirado |
| Acta O1 | `DIR-XP-O1-20261107`, validada 40/0 (unidad anterior) |
| O8 | `o8-check.mjs` comprobado en las dos réplicas (V8-O8-PRODUCTION-READY) |

### Estado formal de los documentos [H]

Ninguno de los seis consta como aprobado formalmente. Dirección los entregó como base de trabajo, y esa es la única condición que este documento les atribuye.

| Doc. | Estado declarado en el propio documento |
|---|---|
| 001 Política | v1.0, «borrador para revisión y aprobación» (p. 1). §14.1 (p. 92): versión, fecha de aprobación y entrada en vigor «por completar»; mientras siga en borrador, no sustituye la política vigente |
| 002 Términos | v1.0, entrada en vigor 09/11/2026 (p. 1). No consta fecha de aprobación, que §12.2 (p. 25) exige para la versión definitiva |
| 003 Acuerdo institucional | Plantilla v1.0, «propuesta contractual», no habilita tratamientos mientras falten condiciones esenciales (p. 1) |
| 004 Autorización de menores | Proforma v1.0. Exige completar los campos y validar el funcionamiento real antes de circular (p. 1). Revisión jurídica y validación operativa pendientes; advierte que el 001 figura como borrador (p. 9) |
| 005 Compromiso de mediadores | Plantilla v1.0 sin diligenciar (pp. 1–2) |
| 006 Protocolo interno | v1.0. Aprobación, entrada en vigor y responsables en blanco (p. 1). Declara que su aprobación no acredita controles (p. 1, «Aplicación») |

## 1. Matriz documental-técnica

### C1 — A1: cuenta, lectura y reconocimientos XP

| | Contenido |
|---|---|
| **Qué exigen** | **004 §8 A1** (p. 7): decisión individual del representante; cubre D1, D3, D4, D6, D7 y «los reconocimientos incluidos de D5», y no habilita A2–A5. Si no se autoriza, **no se activa la cuenta del menor**. **004 §2 D5** (p. 2): el equipo debe declarar qué registros e indicadores incluye (XP, niveles, logros). **004, ficha interna** (p. 9): no activar tratamientos que requieran autorización antes de verificar la habilitación. **006 §3.3** (p. 6): solo se habilita una operación con decisión y prueba suficientes; estados de ejecución *no habilitada / habilitada / restringida / retirada*. **006 H.1, caso 01** (p. 33): con decisión pendiente, la finalidad no se activa. **001 §5.11** (pp. 31–32): una autorización que no se pueda acreditar ⇒ limitar o suspender el tratamiento mientras se regulariza. **001 §7.6** (p. 44) y **§9.7** (p. 59), **002 §8.3–8.4** (pp. 16–17): XP solo por actividades pedagógicas validadas, nunca por tiempo, clics, consumo automático, lectura terminada o lectura sin conexión; sin valor económico |
| **Qué implementa el código** | [H] La elegibilidad de un lector para XP es: la cuenta existe, está activa (`accountStatus` ausente o `'active'`, `server/server.js:4900-4903`), no es sintética y no está excluida (`server/gamification/mookSource.mjs:65-72`; `ledger.mjs:168-174, 245-246`). **No existe ningún registro de autorización (A0–A5) en el servidor:** no hay campos ni tablas de consentimiento o representación en `server/` (búsqueda en esta unidad). [H] Las fuentes bloqueadas para XP: `reading_completion` y `offline_validation` (`policy.mjs:29-44`); `mook_review` solo por reconocimiento aprobado por el mediador (`policy.mjs:46-50`) |
| **Evidencia operativa** | Laboratorio: bloqueos de emisión y reglas O1 (suites V8, 44/0). **No hay** registros C.1 (006 Anexo C, p. 23) ni ninguna constancia de A1 de cuentas existentes en el repositorio. Su existencia fuera de él **no está verificada** |
| **Qué falta** | (a) Que la instancia del 004 de cada implementación incluya XP, niveles y logros en D5. Sin eso, A1 no cubre XP. (b) La correspondencia **cuenta lectora activa ⇔ A1 verificada** para toda la población que podrá ganar XP en T0 |
| **Tipo de diferencia** | **Procedimiento**, si se adopta la regla «cuenta activa ⇔ A1» (ver G-01): el estado `active` que ya consulta el código hace de estado *habilitada*. **Código**, solo si Dirección quiere mantener la lectura de cuentas con A1 pendiente sin darles XP (G-01, ruta C) |

### C2 — A2: consulta individual del mediador

| | Contenido |
|---|---|
| **Qué exigen** | **004 §9 A2** (p. 8): decisión **separada** de A1, con las opciones *Sí / No / No aplica*. Sin A2 no hay consulta institucional individual ni reportes identificables. **004 §3** (p. 3): solo los mediadores asignados al lector o a su grupo; ni contraseñas, ni conversaciones completas con Leo, ni lecturas ajenas al programa. **006 §3.3** (p. 6): sin A2 suficiente no hay acceso individual. **006 §3.5** (p. 6): la falta de A2 no bloquea las funciones independientes autorizadas. **006 H.1, casos 02 y 03** (p. 33): A1 no habilita A2; el mediador solo ve sus grupos. **001 §5.6** (p. 29), **§8.2–8.3** (pp. 49–51) y **§8.13** (p. 55). **002 §7.2** (p. 14) y **§8.6** (p. 17). **003 cl. 7** (pp. 3–4): antes de habilitar a cada mediador se verifican identidad, función, grupos, vigencia y la aceptación del 005. **005 §2 y §8** (pp. 1–2) |
| **Qué implementa el código** | [H] `GET /api/groups/:groupId/students/:studentId/progress` (`server/server.js:9147-9180`) aplica cuatro puertas: (1) sesión; (2) sin las dos flags ⇒ 404; (3) el llamador debe mediar el grupo según el CIS (`via: mediator_of_group`), y el administrador de plataforma no pasa (403); (4) la persona debe estar en la cohorte del grupo, o 404 idéntico. Devuelve solo XP, nivel, obras reconocidas y logros (`progress.mjs:405-408`). Una persona excluida aparece a cero (`progress.mjs:89`). Los agregados de grupo se suprimen con menos de 5 personas (`progress.mjs:381`). **No hay ningún estado A2 por lector:** quien está en la cohorte del grupo es visible para su mediador [H] |
| **Evidencia operativa** | Laboratorio V8-UNIFIED-XP-01: 200 solo para el mediador del grupo, 403 y 404 para el resto. Producción: el endpoint responde 404 porque las flags están apagadas. **No hay** registros C.2 ni compromisos 005 firmados en el repositorio |
| **Qué falta** | Una forma de respetar **A2 = No** o **A2 revocada** para un lector que mantiene A1 sin sacarlo del grupo. Sacarlo del grupo le quitaría el acceso a contenidos que se le concede por grupo, lo que contradice 006 §3.5 |
| **Tipo de diferencia** | **Código** (G-02). Solo es innecesario si Dirección acredita que, en T0, todos los lectores de los grupos mediados tienen A2 = Sí. Aun así, la primera revocación parcial lo vuelve necesario |

> **Fuera del alcance V8, pero del mismo contrato [H]:** `GET /api/groups/:id/analytics-summary` (`server/server.js:9102`) ya entrega al mediador `readers[]` con detalle por lector (comentario en `server.js:9052`). Esto existe en producción desde antes de V8 y tampoco distingue A2. Se registra para Dirección; esta unidad no lo trata.

### C3 — Alta y vinculación: prueba de autorización vigente

| | Contenido |
|---|---|
| **Qué exigen** | **001 §5.10** (pp. 30–31): la prueba debe permitir reconstruir quién autoriza, su calidad, fecha, medio, versión, finalidades, soporte y custodio. **001 §5.5** (p. 28) y **003 cl. 5** (pp. 2–3): ni un listado, ni la firma del convenio, ni una declaración global sustituyen la prueba individual. **004 ficha interna** (p. 9): verificación, custodia y estado por decisión. **006 P03 §3.1–3.5** (pp. 5–6) y **Anexo C.1** (p. 23): registro individual por lector, que puede llevarse fuera del sistema («no se exige comprar una herramienta», p. 2). **006 P04-A §4.1** (p. 7) y **C.2** (p. 24): alta del mediador con el 005, la asignación, la prueba de límites y las rutas directas |
| **Qué implementa el código** | [H] El alta de lectores y mediadores no registra ni exige referencias de autorización. La pertenencia a un grupo y el rol de mediador se resuelven en el CIS (`server/identity/cis.mjs`). La asignación de mediador **no tiene vigencia** (desde / hasta): se retira a mano |
| **Evidencia operativa** | Ninguna de C.1, C.2 ni H.3 en el repositorio. El padrón canónico permite obtener el listado efectivo de cuentas que pide 006 §4.6 (p. 8) |
| **Qué falta** | (a) Conciliar, antes de T0, **cada cuenta lectora activa con su C.1**: A1 suficiente o cuenta restringida. (b) Una C.2 por mediador, con el 005 aceptado, antes de F5. (c) Las pruebas H.1 01–04 (p. 33) |
| **Tipo de diferencia** | **Procedimiento**, a cargo de Administración y Dirección. No hace falta código: el expediente puede estar fuera del sistema y el estado de la cuenta ya existe |

### C4 — Revocación, supresión y conservación de reconocimientos

| | Contenido |
|---|---|
| **Qué exigen** | **001 §11.3, fila «XP, niveles y logros»** (p. 71): mientras sean necesarios para la progresión y la revisión; al terminar, **eliminar o anonimizar los vínculos personales**, salvo conservación limitada y justificada. **001 §11.3, fila «Copias de respaldo»** (pp. 72–73): ciclo definido y limitado. **001 §9.7** (p. 59): la integridad del registro no es una excepción general a los derechos de rectificación, supresión o revocación. **001 §11.10** (pp. 75–76): sustituir el nombre por un código no basta si se puede reconstruir la identidad. **001 §5.12** (p. 32): se puede conservar la evidencia mínima para impedir reactivaciones. **001 §13.11** (pp. 89–90) y **§11.14** (pp. 77–78): no confirmar una eliminación total si quedan copias. **002 §8.5** (p. 17): revisión de reconocimientos omitidos, duplicados o incorrectos. **003 B.3, C06 y C11** (pp. 15–16) y **006 D.3, C06 y C11** (pp. 26–27): plazo, hecho inicial y ejecutor **antes de activar**. **006 P09 §9.1–9.3** (p. 15) y **§6.3** (p. 11) |
| **Qué implementa el código** | [H] `excludeUser` (`erasure.mjs:42`): escribe primero el registro y después, en una transacción `IMMEDIATE`, anota el tombstone y borra `gm_subjects`, que es el vínculo con `user_id` y la sal. Los asientos se quedan sin dueño y no se pueden recalcular (PRIV-C7 §1–4). Es **irreversible** y no tiene llamador de producto; lo ejecuta un operador (PRIV-C7 §5). [H] El esquema admite asientos `void` (`migrations/0001_ledger.sql:44-54`) y las lecturas los descuentan (`ledger.mjs:303`, `progress.mjs:78, 206`), pero **ninguna función los escribe**. [H] La baja de una cuenta (`server.js:6452`) no desvincula la gamificación (COMP-08). La exclusión no toca `mook_db.json` (PRIV-C7 §2) |
| **Evidencia operativa** | Runbook PRIV-C7 §5 probado en laboratorio (60/60). Política de retención de respaldos: COMP-07 prohíbe `forget`/`prune`, así que las copias no caducan |
| **Qué falta** | (a) Una vía para **corregir** un reconocimiento incorrecto sin escribir a mano en la base (G-03). (b) Un **ciclo máximo de respaldos** (C11) y una fila C06 aprobadas (G-04). (c) Validar que «desvincular» equivale a «eliminar o anonimizar los vínculos personales» (L-D). (d) Informar en el 004 de que la salida de la gamificación es definitiva (G-06) |
| **Tipo de diferencia** | (a) **Código**. (b) **Configuración y procedimiento** de respaldos, ajenos a la gamificación y con autorización propia. (c) **Jurídico**. (d) **Documental** |

### C5 — Restauración y vigencia independiente de las exclusiones

| | Contenido |
|---|---|
| **Qué exigen** | **001 §11.11** (p. 76): antes de reabrir lo restaurado, aplicar las supresiones, revocaciones y retiros posteriores a la copia. Si no se puede garantizar, no se habilita. Las constancias contra la reactivación se protegen **de forma independiente** de la restauración. **001 §12.7** (p. 81). **003 cl. 11** (p. 6): reaplicar antes de restaurar. **006 P10 §10.3** (p. 16): restauración aislada; conciliar con el registro vigente de decisiones, protegido de forma independiente; probar que no reaparece nada. **006 G.2** (p. 32) y **H.1, caso 08** (p. 33) |
| **Qué implementa el código** | [H] El registro de exclusiones (`exclusions.mjs:11-17, 35-41`) es append-only, con un MAC por línea y la ruta obligatoria `GAMIFICATION_EXCLUSION_REGISTRY`. Se niega a estar en el directorio de la base y **no figura en el inventario de respaldos**: `stores.py:93` solo incluye `data-critical/gamification.db`. La puerta `exclusionGate` (`exclusions.mjs:83-89`) cierra toda ingesta y lectura si el registro falta, está alterado o desalineado: `REPLAY_REQUIRED` o `STALE`. `replayExclusions` (`erasure.mjs:62`) reaplica de forma idempotente, y el barrido lo hace antes de leer la fuente |
| **Evidencia operativa** | PRIV-C7 §3: base restaurada ⇒ `REPLAY_REQUIRED` ⇒ reaplicación ⇒ la persona no reaparece. Control negativo N: base **y** registro restaurados juntos ⇒ la persona reaparece (T3). O8 vigila `registry_alignment` |
| **Qué falta** | (a) Una ficha G.2 de `gamification.db` y del registro. (b) La prueba H.1-08 con datos ficticios. (c) Aceptar T3 (L-G). (d) Que la conciliación de 006 §10.3, paso 3, incluya también el **estado de las cuentas** del padrón: una restauración de `data-critical/` podría reactivar una cuenta restringida por falta de A1 [Hip: no probado] |
| **Tipo de diferencia** | **Procedimiento** y aceptación de Dirección. El mecanismo técnico ya cumple lo que piden 001 §11.11 y 006 §10.3 |

## 2. Evidencias disponibles

| Evidencia | Contrato | Dónde |
|---|---|---|
| Producción inerte: 0 flags, sin clave ni base, imágenes `unifiedxp-13b8045` | Todos | Lectura de esta unidad (§0) |
| Acta de reglas O1, SHA `95613ec3…9878`, 40/0 | C1 | `aprobaciones/APROBACION-DIR-XP-O1-20261107.md` |
| Bloqueos de emisión (sin XP por lectura, offline ni tiempo) | C1 | `policy.mjs:29-50`; suites V8 (44/0 `on`, 34/0 `off`, 35/0 inerte) |
| Alcance del mediador: mediador del grupo, cohorte, 404 idéntico | C2 | `server.js:9147-9180`; laboratorio V8-UNIFIED-XP-01 |
| Agregados con k ≥ 5 | C2 | `progress.mjs:381` |
| Retiro y exclusión probados | C4, C5 | PRIV-C7 §3, 60/60 |
| Registro independiente con reaplicación | C5 | `exclusions.mjs`, `erasure.mjs`; PRIV-C7 §3 |
| O8 de solo lectura en las dos réplicas | C5 | `ops/gamification/o8-check.mjs`; laboratorio 24/0 |
| **No disponibles** | | C.1 (autorizaciones por lector), C.2 (permisos de mediadores), 005 firmados, D.3 y D.4 adoptados, G.1 y G.2, H.1 ejecutado, H.3, Anexo A del 006 con nombres, versión aprobada del 001. Que no estén en el repositorio no prueba que no existan |

## 3. Brechas reales, ordenadas por impacto

| # | Brecha | Contrato | Impacto | Tipo |
|---|---|---|---|---|
| **G-01** | No consta A1 de las cuentas lectoras activas. Con las flags encendidas, toda cuenta activa con una entrega aprobada recibe XP | C1, C3 | **Alto: bloquea T0** | Procedimiento (ruta P) o código (ruta C) |
| **G-02** | No hay un estado A2 por lector: el mediador ve el XP individual de toda su cohorte | C2 | **Alto** en cuanto un lector tenga A2 ≠ Sí | Código |
| **G-04** | Los respaldos no tienen ciclo máximo (COMP-07): el vínculo completo persiste indefinidamente en las copias anteriores a una exclusión | C4 | **Alto** frente a 001 §11.3 y §11.11 y 003/006 C11 | Configuración y procedimiento (fuera de la gamificación) |
| **G-03** | No se puede anular un reconocimiento incorrecto: el esquema tiene `void`, pero nada lo escribe | C4 | **Medio**: la primera solicitud de rectificación (002 §8.5) no tendría vía dentro del plazo | Código |
| **G-05** | La baja de cuenta no desvincula (COMP-08), y una restauración del padrón puede reactivar cuentas restringidas | C4, C5 | Medio | Procedimiento |
| **G-06** | La exclusión es irreversible. 001 §14.7 permite reanudar con una autorización nueva | C4 | Medio | Documental (004 §5) o jurídico (L3) |
| **G-07** | La asignación de mediador no tiene vigencia, y no se ha probado que el retiro sea efectivo con la sesión abierta (H.1-04) | C2, C3 | Medio | Procedimiento y prueba |
| **G-08** | La suficiencia de la desvinculación como anonimización no está probada: `mook_db.json` conserva `userId`, fechas y obra de las entregas [Hip: reidentificación por combinación] | C4 | Medio | Jurídico y prueba VER (006 §9.2) |

### Ajustes mínimos de código (solo si se confirman; no se implementan aquí)

**G-02 — puerta A2 en la consulta individual.**
- **Cambio:** una quinta puerta en `server.js:9147`. Antes de leer, se consulta del lado del servidor si el lector tiene A2 *habilitada*; si no, se responde el mismo 404 que a una persona ajena a la cohorte.
- **Fuente del estado:** una lista de lectores con A2 restringida, administrada por Administración. Debe sobrevivir a una restauración, como el registro de exclusiones (C5): ruta propia, fuera del inventario de respaldos, MAC por línea y fallo cerrado ante ausencia o alteración.
- **Límites:** no cambia «Mi progreso», los agregados k ≥ 5, el motor ni las reglas. Es reversible, porque A2 puede volver a autorizarse.
- **Pruebas:**
  - A2 restringida ⇒ 404 byte a byte igual al de una persona ajena.
  - A2 habilitada ⇒ 200.
  - Lista ausente o alterada ⇒ 503 para todos, nunca 200.
  - Restaurar una base anterior no reabre una A2 restringida.
  - El lector sigue ganando XP y viendo su progreso (006 §3.5).
  - El administrador de plataforma sigue en 403.

**G-03 — anulación de un asiento.**
- **Cambio:** una función de operador `voidAward(db, { entryId, requestRef })`.
- **Comportamiento:** un `void` por asiento en una transacción `IMMEDIATE` (`ux_gm_xp_void`), idempotente, con `requestRef` opaco con el formato de PRIV-C7 §5.3. Sin llamador HTTP; se invoca por stdin, igual que `excludeUser`.
- **Efecto pendiente de definir:** cómo afecta al techo por obra y ciclo. Se decide en la unidad de código y se refleja en `o8-check` (`work_caps`).
- **Pruebas:**
  - El `void` descuenta en «Mi progreso» y en la consulta del mediador.
  - Un segundo `void` sobre el mismo asiento no cambia nada.
  - Un asiento ya excluido se rechaza.
  - O8 sigue en OK tras el `void`.
  - Un barrido posterior no vuelve a emitir el hecho anulado.

**G-01, ruta C (solo si Dirección la elige):**
- **Cambio:** un estado reversible *XP no habilitado* por lector, distinto de la exclusión, que es irreversible.
- **Origen:** es técnicamente el mecanismo de la especificación B1. Aquí no se plantea como requisito de piloto; se deriva de 004 A1, 006 §3.3 y 001 §5.11 para la población general.
- **Con la ruta P no hace falta.**

## 4. Condiciones que Dirección puede formalizar

1. **Versiones:**
   - Aprobar el 001 completando §14.1 (p. 92) y el 006 (p. 1).
   - Fijar la versión del 002 con su fecha de aprobación (§12.2).
   - Completar 006 Anexo A: DIR = Dirección (incluida la custodia); GVA = Administración (solicitudes y exclusiones, según el cierre operativo §1); AT = operación técnica; VER, con control compensatorio si no hay segunda persona (006 §1.2–1.3).
2. **G-01, elegir ruta:**
   - **P**, recomendada: adoptar la regla «cuenta lectora activa ⇔ A1 suficiente en C.1», que es la consecuencia que el propio 004 A1 da a la falta de autorización, y restringir antes de T0 las cuentas sin prueba (001 §5.11).
   - **C**: mantener la lectura de esas cuentas y abrir la unidad de código.
3. **004 D5:** declarar en cada implementación que se incluyen XP, niveles y logros, con su explicación (002 §8). Si alguna implementación no los incluye, sus lectores no pueden ganar XP; hace falta la ruta C o se excluye a esa organización de T0.
4. **A2:** declarar si en T0 todos los lectores de grupos mediados tienen A2 = Sí. Con la primera A2 ≠ Sí o revocada, G-02 es obligatoria. **Recomendación:** implementar G-02 antes de F5.
5. **Conservación (006 D.3):** aprobar las filas C03, C04, C06 (XP: hecho inicial, cierre y «desvincular» como disposición) y C11 (ciclo máximo de respaldos y expiración tras una supresión; 006 §10.2 si la supresión selectiva no es viable). Con eso se abre la unidad de respaldos para G-04.
6. **006 D.4:** adoptar las frecuencias (p. 28), incluida la revisión de permisos de mediadores y la prueba semestral de restauración.
7. **Mediadores:** C.2 y 005 aceptado para cada mediador con grupo antes de F5. Retiro de asignaciones en su fecha (G-07).
8. **L-G:** aceptar por escrito el riesgo T3 con la custodia separada del registro (P2) y el contraste con el registro de solicitudes (P4).
9. **L-H / J8:** la orden de activación con T0, solo cuando se cumplan las condiciones 1–8 y §5.

## 5. Condiciones que requieren validación jurídica

Cada una enlaza con la condición equivalente del [cierre operativo](GAMIFICACION_V8_GATE_CIERRE_OPERATIVO.md) §4. Antes, la clase 2 de su §3 eran documentos sin localizar. Ahora existen como borradores, así que la revisión ya tiene un texto concreto.

| # | Pregunta concreta | Documentos | Enlaza |
|---|---|---|---|
| J-1 | ¿A1, con D5 completo, es base suficiente para el XP de menores? ¿Qué ocurre con las cuentas existentes cuya autorización anterior no menciona XP (001 §5.11 y §14.7)? | 004 §8; 001 §5, §7.6, §9.7 | L-A |
| J-2 | Responsable y encargado en T03, T04 y T05 (003 B.1, pp. 11–12). ¿Quién custodia C.1 (003 B.2)? | 003 cl. 5–6, B.1–B.2 | L-B |
| J-3 | Texto final del 004 por modalidad: D5 con XP; efecto definitivo de la exclusión; alcance real de A2 (XP individual) | 004 Partes I–III | L-C |
| J-4 | ¿«Desvincular» cumple «eliminar o anonimizar los vínculos personales» (001 §11.3) a la luz de §11.10 y de lo que queda en `mook_db.json` (G-08)? ¿Se puede conservar el tombstone de forma indefinida como evidencia mínima (001 §5.12)? ¿Es suficiente el ciclo de respaldos de C11? | 001 §11, §5.12; 006 §9 | L-D (L1, L2) |
| J-5 | ¿Es aceptable la irreversibilidad frente a 001 §14.7, o hace falta reincorporar a quien vuelva a autorizar? | 001 §14.7; 004 §5 | L-D (L3) |
| J-6 | ¿PRIV-6 sirve como evaluación de impacto, y el 006 aprobado como protocolo (001 §12.14)? | 006 §12; 001 §12.14 | L-E |
| J-7 | Canal formal y verificación de la representación: ¿basta lo descrito en 006 P06, sin cuenta ni formulario exclusivo? | 006 §6; 001 §13 | L-F |
| J-8 | ¿Los agregados con k ≥ 5 dejan de ser «reportes identificables» (001 §8.4), o requieren A2? | 001 §8.4; 004 A2 | Nueva |

## 6. Secuencia restante antes de F2–F8

| Paso | Qué | Quién | Gate de salida |
|---|---|---|---|
| S1 | Versiones aprobadas y Anexo A (§4.1); D.3 y D.4 (§4.5–4.6); decisiones de G-01 y A2 (§4.2–4.4) | Dirección | Actas versionadas en `aprobaciones/` |
| S2 | J-1…J-8 contra los documentos 001–006 | Legal | Dictamen por pregunta; cierra L-A…L-F |
| S3 | **Unidad de código mínima** (V8-DOC-GAPS-01): G-02 y G-03, más G-01 ruta C solo si se elige. Laboratorio, CI, imagen y despliegue **inerte** por réplica | Ingeniería | Pruebas de §3 en verde; producción inerte sin cambio de flags |
| S4 | Unidad de respaldos (G-04): ciclo C11 aprobado y su ejecución o restricción documentada (006 §10.2) | Operación + Dirección | Autorización propia; nunca dentro de un despliegue de código |
| S5 | Conciliación C.1 de todas las cuentas lectoras activas (G-01), C.2 y 005 de los mediadores (§4.7) | Administración (GVA) + VER | Ninguna cuenta activa sin A1 suficiente o restricción registrada |
| S6 | H.1 casos 01–08 con datos ficticios (09 LU y 10 Leo: «no aplica justificado» para XP); G.2 de `gamification.db` y del registro; H.3 firmado | AT + VER + DIR | H.3 con alcance «XP» habilitado |
| S7 | Entrega del 004 aprobado a las familias, con constancia anterior a T0 (L-C) | Dirección + instituciones | Constancias |
| S8 | L-G y orden J8 con T0 | Dirección | Acta |
| F0–F8 | [Procedimiento](GAMIFICACION_V8_ACTIVACION_OPERATIVA_V1.md) §3 y [checklist](GAMIFICACION_V8_GATE_CIERRE_OPERATIVO.md) §5, sin cambios | Operación | Gates propios |

S1, S2 y S3 pueden avanzar en paralelo. S5 depende de S1, porque la regla de G-01 tiene que estar adoptada. S6 depende de S3 y S5.

**STOP.** No se ejecuta F2–F8.
