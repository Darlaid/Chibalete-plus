# PRIV-C7 — Procedimiento verificable de retiro y exclusión de la gamificación

**Fecha:** 2026-11-06. **Unidad:** V7-G4-PRIV-C7 (punto C-7 de la checklist de [PRIV-6](GAMIFICACION_PRIV_06_REVISION_JURIDICA_V1.md) §6). **Veredicto:** `GREEN_LOCAL_PRIV_C7`.

**No es una autorización jurídica.** Este documento describe cómo se ejecutaría un retiro con los mecanismos que ya existen y qué muestra el ensayo de laboratorio. Los canales, responsables, plazos y la base del tratamiento siguen pendientes de Legal y Dirección (PRIV-6 D1, D3, D8 y D9). No se ha excluido a nadie en producción.

**Base:** código de `80ea6a9`, que en `server/` es idéntico a `f11fecd`. Producción, según la evidencia del 2026-11-05 (no se volvió a comprobar en esta unidad): API `chibalete/api:ratelimit-f11fecd` ×2 y front `uxfix-b18f6f0`. La gamificación no tiene flags, ni `gamification.db`, ni clave de sujeto, ni registro de exclusiones. `mook_review` sigue en `XP_LOCKED_SOURCES`. La experiencia `exp-1793925477270-j1onug` está en borrador privado.

**Método:** solo código, documentación y un laboratorio con bases temporales, usuarios ficticios y una clave de prueba aleatoria. No se consultaron identidades ni datos de menores. No se creó ningún secreto, registro ni ledger productivo.

**Construye sobre:** [PRIV-01B](GAMIFICACION_PRIV_01B_SUJETO.md) (modelo de sujeto), [PRIV-01D](GAMIFICACION_PRIV_01D_SUPRESION.md) (supresión, registro y custodia) y [PRIV-6](GAMIFICACION_PRIV_06_REVISION_JURIDICA_V1.md).

---

## 1. Tres operaciones distintas

| Operación | Qué hace | ¿Existe? |
|---|---|---|
| **Exclusión** | Impide que la persona vuelva a participar: nunca más se le crea un sujeto ni se le atribuye XP | Sí: `excludeUser` (`erasure.mjs:41`). **Es irreversible:** no hay forma de reincorporar a una persona |
| **Desvinculación** | Borra la fila de `gm_subjects` (vínculo con `user_id` y sal). Sin ella, los asientos ya no se pueden atribuir a nadie | Sí, **solo como parte de la exclusión** (`deleteSubject`); no se puede ejecutar por separado |
| **Eliminación** | Borrar los asientos, los ciclos de obra, las copias de seguridad y los textos MOOK | **No.** Ningún código borra filas del ledger ni snapshots (`forget`/`prune` están prohibidos: COMP-07). La baja de la cuenta (`DELETE /api/users/:id`, `server.js:6447`) no toca la gamificación (COMP-08) |

**Retirar a una persona hoy significa excluirla y desvincularla. No significa eliminar sus datos.**

## 2. El mecanismo real

| # | Pieza | Código | Comportamiento comprobado |
|---|---|---|---|
| 1 | Registro de exclusiones | `exclusions.mjs:30-73` | Archivo append-only definido por `GAMIFICATION_EXCLUSION_REGISTRY`, sin valor por defecto y nunca en el directorio de la base. Cada línea `{id, t, d, m}` lleva un tombstone `HMAC(clave, user_id)`, el día y un MAC. **No guarda el `user_id`.** Se escribe con `fsync` **antes** que la base |
| 2 | Cuenta ↔ sujeto seudónimo | `subjects.mjs:23-50` | `gm_subjects(user_id, subject_ref aleatorio, sal)` es la única unión. Al borrarla, `subject_ref` ya no se puede recalcular |
| 3 | Bloqueo posterior | `subjects.mjs:28,39`; `ledger.mjs`; `mookSource.mjs:98` | `ensureSubject` rechaza con `SUBJECT_EXCLUDED`. El barrido marca la evidencia como `subject_excluded`. La puerta `exclusionGate` precede a toda ingesta |
| 4 | Reconocimientos anteriores | `erasure.mjs:20-24`; `ledger.mjs:432` | **Se conservan** en el ledger, sin vínculo y sin anular (`void`). `extinguishSubject` solo compensa el saldo de **PM**; en el piloto no hay PM, así que extingue 0 |
| 5 | «Mi progreso» | `progress.mjs:87-94,224-235` | La persona excluida ve exactamente lo mismo que alguien sin actividad: 0 XP, nivel inicial, sin obras ni entregas. El agregado del mediador la cuenta como «sin reconocimiento» |
| 6 | Restauración y reaplicación | `exclusions.mjs:84-90`; `erasure.mjs:60-72`; `mookSource.mjs:367` | Si el registro tiene exclusiones que la base no, se bloquea toda ingesta y lectura (`EXCLUSION_REPLAY_REQUIRED`). `runMookReconcileOnce` reaplica antes de leer la fuente. Si la base tiene exclusiones que el registro no, se bloquea (`EXCLUSION_REGISTRY_STALE`) y no hay reparación automática |

**Fuera de la gamificación, la exclusión no toca nada:** `erasure.mjs` no importa el store MOOK. Las entregas, los textos y la revisión pedagógica del mediador siguen intactos en `mook_db.json`. También siguen intactos `progress.db`, `events.db`, Leo y el padrón (COMP-07/08).

**Producto sin llamador:** ninguna ruta HTTP, tarea ni script de producto invoca `excludeUser`. Por eso el procedimiento (§5) necesita una invocación de operador.

## 3. Ensayo sintético

**Script:** `privC7_rehearsal.mjs` (sha256 `f55a02db…5e5a`) y la plantilla de operador `privC7_operator.mjs` (sha256 `098bbb58…6b50`, reproducida en §5.4). Los scripts se quedaron fuera del repositorio porque esta unidad solo admite documentación. Importan los módulos reales con el arnés de prueba (`testMode.mjs` y `xpRecognitionHarness.mjs`, que liberan `mook_review` **solo en ese proceso**). Usan la configuración del piloto A7-A12-V3 (lectura 10, reflexión 20, techo de 50 por ciclo de obra, PM 0) y siete usuarios ficticios.

**Resultado:** 60 ✓ / 0 ✗ en tres corridas consecutivas (Windows, Node 20.18).

| Paso | Comprobación | Resultado |
|---|---|---|
| C1 | Primera evidencia aprobada de A, más la de B | A = 30 XP · B = 30 XP ✓ |
| C2 | Segunda evidencia de A sobre la misma obra | A = 50 XP en el ledger y en «Mi progreso», nivel `brote` ✓ |
| C3 | `excludeUser(A, requestRef 'SOL-SINT-0001')` | Acuse `{inserted, unlinked, extinguished: 0, checkpointed}` sin `user_id` ✓. Registro: 1 línea sin `user_id` ✓. `gm_erasures`: 1 fila con la referencia opaca ✓. **Repetir es idempotente:** `inserted=false` y sigue habiendo 1 línea ✓ |
| C4 | Nueva evidencia aprobada de A | Barrido: `subject_excluded`, 0 XP ✓. Gancho de revisión: sin emisión ✓. `ensureSubject`: `SUBJECT_EXCLUDED` ✓. `recordWorkRecognition` directo: sin XP ✓ |
| C5 | Estado tras la exclusión | Sin fila en `gm_subjects` ✓. **El ledger conserva 2 asientos (50 XP) de A sin vínculo**, ninguno anulado ✓. 3 ciclos de obra conservados sin vínculo ✓. `getXp(A) = 0` ✓. «Mi progreso» de A es byte a byte igual al de un lector sin actividad (nivel `semilla`) ✓. Ni `gamification.db` ni `-wal` contienen el `user_id` de A (`secure_delete` + checkpoint) ✓. Agregado del mediador: 2 de 6 ✓. Integridad: `integrity_check`, `foreign_key_check`, `verifyLedger` y suma de XP igual a la suma de los ciclos ✓. **La copia previa sí contiene el vínculo de A** ✓ (esperado) |
| C6 | Restaurar la copia anterior al retiro (`VACUUM INTO` → reemplazo del archivo) | Vuelven el vínculo de A y `gm_erasures = 0` ✓. Puerta: `EXCLUSION_REPLAY_REQUIRED` ✓. «Mi progreso» de A **falla cerrado y no muestra los 50 XP**; el de B también falla (bloqueo general) ✓. Barrido bloqueado ✓. **Dos réplicas reiniciadas en paralelo sin reaplicar: las dos se niegan** ✓. Ninguna escritura mientras dura el bloqueo ✓ |
| C7 | Reaplicar el registro con `runMookReconcileOnce` (el barrido programado) | Termina bien; A queda desvinculada otra vez y `gm_erasures = 1` ✓. La evidencia nueva de A sigue sin XP ✓. «Mi progreso» vuelve a cero ✓. **Dos réplicas en paralelo después de reaplicar:** terminan sin que A participe ✓. Reaplicar de nuevo: `applied=0, unlinked=0` ✓. Tras reiniciar: puerta abierta y A fuera ✓. Íntegro ✓ |
| C8 | Otras personas | B y C conservan sus 30 XP ✓. B sigue participando: +30 por otra obra (60) ✓. Íntegro ✓ |
| OP | La plantilla de §5.4 en **un proceso aparte, con la réplica viva** | Referencia inválida → `INVALID_REQUEST_REF`, sin escribir nada ✓. Registro no configurado → `EXCLUSION_REGISTRY_UNAVAILABLE`, la base queda intacta ✓. Ejecución: acuse `ok`, `verified`, sin `user_id` en la salida ✓. La réplica viva lo ve **sin reiniciarse** ✓. Repetir: idempotente ✓. Después: 0 XP nuevo ✓. B intacto ✓ |
| N | Controles negativos de custodia | Base vigente + registro antiguo: `STALE` ✓. Registro ausente o alterado: `UNAVAILABLE` ✓. **Base y registro restaurados juntos desde copias previas al retiro: la puerta abre y A reaparece con 50 XP.** Esto confirma el límite ya documentado en PRIV-01D §8 |
| — | Aislamiento | `data/mook_db.json` y `data/content.json` tienen el mismo sha256 antes y después ✓. No se creó `data-critical/gamification.db` ✓ |

**Límites del ensayo:** la restauración fue una copia de archivo de un `VACUUM INTO`, no `restic` ni el runner completo del VPS. GM04 y `ledgerBackupRestore` cubren `capture_sqlite`, y PRIV-01D §7 cubre la exclusión con `capture_sqlite`. Las «réplicas» fueron procesos Node sobre la misma base, no contenedores.

### Pruebas existentes (sin datos productivos)

| Suite | Resultado |
|---|---|
| `exclusion.test.mjs` | 62 ✓ / 0 ✗ |
| `xpPilotEmission.test.mjs` | 65 ✓ / 0 ✗ |
| `myProgress.test.mjs` | 60 ✓ / 0 ✗ |
| `myProgressHttp.test.mjs` | 39 ✓ / 0 ✗ |
| `ledgerBackupRestore.test.mjs` | 14 ✓ / 0 ✗ |
| `subjectModel.test.mjs` | 71 ✓ / 0 ✗ |
| `subjectReconcile.test.mjs` | 50 ✓ / 0 ✗ |
| `progress.test.mjs` | 56 ✓ / 0 ✗ |
| `ledgerCore.test.mjs` | 145 ✓ / 0 ✗ |
| `groupRecognitionHttp.test.mjs` | 33 ✓ / **1 ✗**, de forma determinista **solo en Windows**. La comprobación estática `[8]` busca `\n}\n` en `server.js`, y la copia de trabajo tiene CRLF (`core.autocrlf=true`). Con LF, como en el repositorio y en CI, la comprobación pasa (1406 caracteres, sin coincidencias prohibidas). No es un defecto del código |

## 4. Reconocimientos anteriores: qué ocurre exactamente

1. **No se borran ni se anulan.** Los asientos `award` de la persona, sus ciclos de obra (`work_key` HMAC por sujeto) y sus hechos de origen (`source_key` derivada) se quedan en `gamification.db`. Solo cambia que ya no tienen dueño: sin `gm_subjects` y sin sal, no se pueden volver a calcular ni atribuir.
2. **Dejan de verse.** «Mi progreso» muestra 0 XP y el nivel inicial. El agregado del mediador cuenta a la persona como alguien sin reconocimiento. Ninguna superficie muestra XP individual a terceros.
3. **No se pueden recuperar.** Ni por ingesta, ni por gancho, ni por alta directa, ni por barrido, ni tras reiniciar, ni tras restaurar una copia anterior **mientras el registro esté custodiado** (§6). Con una exclusión hecha por error tampoco: no hay vía de reincorporación.
4. **Siguen en las copias anteriores** a la exclusión, con el vínculo completo, durante tanto tiempo como existan esas copias. Hoy eso es indefinidamente (COMP-07, PRIV-6 D5).
5. **La baja de la cuenta no los desvincula** (COMP-08). Durante el piloto, cada baja de un participante debe ejecutar antes este procedimiento (C-8).

**Lo que puede afirmarse al titular, si Legal lo aprueba:** «la persona deja de participar y deja de ver su progreso; el registro que queda ya no permite saber a quién pertenecía». **No puede afirmarse** «hemos borrado sus datos de reconocimiento» ni «se ha eliminado de las copias de seguridad».

## 5. Procedimiento operativo propuesto

> **Propuesta, no autorizada.** Requiere que Legal y Dirección aprueben D1, D3, D8 y D9 de PRIV-6 y que se cumplan los requisitos previos de §5.1. Los elementos marcados **[PENDIENTE]** no están decididos.

### 5.1 Requisitos previos (ninguno existe hoy en producción)

| # | Requisito | Estado |
|---|---|---|
| P1 | Volumen persistente para el registro, **distinto** de `data/` y `data-critical/`, montado en lectura y escritura en **ambas** réplicas, con `GAMIFICATION_EXCLUSION_REGISTRY` declarado en el override | [PENDIENTE] unidad de despliegue propia |
| P2 | Copia independiente del registro (destino y credenciales distintos de los de `gamification.db`, con retención igual o mayor) | [PENDIENTE] custodia de Dirección |
| P3 | Archivo de clave `/app/secrets/gamification_subject_key` (modo 0400) con su propia copia segura. **Prohibido rotarla** (invalidaría los tombstones) | [PENDIENTE] unidad de secretos |
| P4 | Registro de solicitudes de Dirección **fuera del sistema**: la autoridad final para contrastar el número de exclusiones | [PENDIENTE] D9 |
| P5 | Base del tratamiento (D1), canal (D3), redacción y plazos (D8), responsable (D9) | [LEGAL] / [DIRECCIÓN] |

`excludeUser` no consulta los flags: puede ejecutarse con la gamificación apagada. Esto permite excluir **antes del corte** a quienes no autoricen si D1 = *opt-in* (C-9).

### 5.2 Roles

| Rol | Hace | Ve |
|---|---|---|
| **Receptor/verificador** [PENDIENTE D9] | Recibe la solicitud por el canal aprobado, verifica la representación y asigna una referencia opaca | Identidad del titular y del representante |
| **Resolutor de identidad** [PENDIENTE D9] | Traduce la solicitud al `user_id` canónico con el padrón (`USERS_DB`). Comprueba el resultado **con una segunda persona**, porque la exclusión es irreversible | Padrón |
| **Operador** (Ops) | Ejecuta §5.4 y verifica el resultado | Solo `user_id` + referencia, en el momento de ejecutar |

### 5.3 Datos mínimos

- **`user_id` canónico:** el único identificador que necesita la operación. Se pasa por stdin, nunca como argumento, en el chat, en un ticket ni en la evidencia.
- **Referencia opaca del trámite** (`requestRef`): formato `^[A-Za-z0-9._:-]{1,128}$`, por ejemplo `SOL-2026-0001`. No puede contener nombre, curso ni fecha de nacimiento. Es lo único que enlaza `gm_erasures` con el registro de solicitudes de Dirección.

### 5.4 Pasos

0. **Recepción** por el canal aprobado [PENDIENTE D3]. Se anota en el registro de solicitudes de Dirección con la referencia opaca y la fecha. Plazo de atención: [PENDIENTE D8/D9].
1. **Verificación de representación** del menor según el procedimiento que apruebe Legal [LEGAL D1/D3]. Si no se verifica, se detiene sin tocar nada.
2. **Resolución del `user_id`** y comprobación cruzada por dos personas (§5.2).
3. **Comprobaciones previas** (operador, en el VPS, sin leer secretos):
   - `docker compose ps` muestra las dos réplicas sanas.
   - El registro existe y su número de líneas coincide con las exclusiones atendidas del registro de Dirección (`wc -l` sobre la ruta de P1). Si no coincide, **STOP** y se escala.
   - Se hace una copia del registro con su sha256, antes de tocar nada.
4. **Ejecución en una sola réplica.** La otra lo ve sin reiniciarse, porque comparten la base y el registro (comprobado en el paso OP). La plantilla `privC7_operator.mjs` va como `-e` y los datos por stdin:

   ```js
   // stdin: línea 1 = user_id canónico; línea 2 = referencia opaca. Salida: solo el acuse.
   const ROOT = process.env.CHP_GAM_ROOT || '/app/server/gamification';
   const { loadSubjectKey } = await import(`${ROOT}/subjectKey.mjs`);
   const { getGamificationDb, closeGamificationDb } = await import(`${ROOT}/db.mjs`);
   const { excludeUser } = await import(`${ROOT}/erasure.mjs`);
   const { exclusionGate } = await import(`${ROOT}/exclusions.mjs`);
   const { findSubject } = await import(`${ROOT}/subjects.mjs`);
   let input = '';
   for await (const chunk of process.stdin) input += chunk;
   const [userId, requestRef] = input.split(/\r?\n/).map((s) => s.trim());
   try {
       await loadSubjectKey();
       const db = getGamificationDb();
       const ack = excludeUser(db, { userId, requestRef: requestRef || null });
       exclusionGate(db);
       const verified = !findSubject(db, userId);
       closeGamificationDb();
       console.log(JSON.stringify({ ok: true, ...ack, verified }));
   } catch (e) {
       console.log(JSON.stringify({ ok: false, code: e?.code || 'ERROR' }));
       process.exitCode = 1;
   }
   ```

   ```sh
   # En /opt/chibaleteplus. CHP_UID se lee sin eco y no queda en el historial.
   read -rs CHP_UID; read -r CHP_REF
   printf '%s\n%s\n' "$CHP_UID" "$CHP_REF" | docker compose exec -T <servicio api_1> \
     node --input-type=module -e "$(cat /root/chp-priv-c7/privC7_operator.mjs)"
   unset CHP_UID
   ```

   El nombre de servicio de la réplica se confirma con `docker compose ps --services`. **Esta invocación no se ha ejecutado contra ningún contenedor:** se probó en laboratorio como proceso aparte.
5. **Verificación del resultado:**
   - El acuse tiene `ok: true` y `verified: true`. Además, `inserted: true` en una exclusión nueva, o `inserted: false` si se repite (idempotente).
   - El registro tiene exactamente una línea más que en el paso 3.
   - Ninguna réplica registra `EXCLUSION_*` en sus logs del barrido siguiente.
   - **Se copia el registro a su destino independiente (P2) ANTES de confirmar al titular** (PRIV-01D §8).
6. **Respuesta al titular** por el canal aprobado, con el texto que apruebe Legal (§4: lo que puede y no puede afirmarse) [PENDIENTE D8].
7. **Baja de cuenta (C-8):** si la solicitud incluye la baja, este procedimiento se completa **antes** de `DELETE /api/users/:id`.

### 5.5 Evidencia mínima del trámite

| Dónde | Qué se guarda | Qué nunca se guarda |
|---|---|---|
| Registro de solicitudes de Dirección | Referencia, fecha de recepción, fecha de ejecución, `erasureId`, `day`, `inserted`, `verified`, quién verificó y quién ejecutó (por rol) | — (custodia propia de Dirección) |
| Evidencia de operación (repositorio u ops) | Referencia, número de líneas del registro antes y después, sha256 de la copia independiente, códigos de error | `user_id`, nombre, curso, XP, nivel, tombstone, contenido del registro |

### 5.6 Errores y restauraciones

| Situación | Señal | Qué hacer |
|---|---|---|
| Referencia con un formato inválido | `INVALID_REQUEST_REF` | Corregir la referencia. No se escribió nada |
| Registro sin configurar, ausente o alterado | `EXCLUSION_REGISTRY_UNAVAILABLE` / `_NOT_INDEPENDENT` | STOP. Restaurar el registro desde su copia independiente. **Nunca crear un archivo vacío** |
| Clave ausente | `SUBJECT_KEY_UNAVAILABLE` | STOP. Escalar (P3). No generar una clave nueva |
| Base restaurada más antigua que el registro | `EXCLUSION_REPLAY_REQUIRED` en la puerta, en «Mi progreso» y en los barridos | Esperar o forzar el barrido programado (`runMookReconcileOnce` reaplica primero), o ejecutar `replayExclusions` con una plantilla equivalente. Comprobar: registro = `gm_erasures` = solicitudes atendidas. Hasta entonces, todo queda bloqueado (fallo cerrado) |
| Registro más antiguo que la base | `EXCLUSION_REGISTRY_STALE` | STOP. Restaurar un registro al menos tan reciente. No hay reparación automática |
| Base **y** registro restaurados juntos desde antes de una exclusión | **Ninguna:** la puerta abre y la persona reaparece (paso N) | Lo evita la custodia: copias separadas, y tras **cualquier** restauración contrastar el número de líneas del registro con el registro de solicitudes. Si falta alguna, se vuelve a ejecutar §5.4 con la referencia original antes de reabrir la ingesta |
| Caída entre el registro y la base | `EXCLUSION_REPLAY_REQUIRED` | Repetir §5.4 (idempotente) o reaplicar |
| Canje abierto | `OPEN_REDEMPTIONS` | No aplica al piloto (PM = 0). Si apareciera: STOP y escalar |
| Exclusión de la persona equivocada | — | **Irreversible.** No hay vía de reincorporación. Se previene con la comprobación cruzada del paso 2 |

## 6. Brechas y decisiones pendientes

**Técnicas (no bloquean el procedimiento; algunas bloquean la activación):**

| # | Brecha | Efecto | Tratamiento |
|---|---|---|---|
| T1 | `excludeUser` no tiene llamador de producto | Hace falta una invocación de operador (§5.4) | Aceptable para el piloto. Una interfaz queda **DIF** |
| T2 | No existen el registro, su volumen ni la clave (P1–P3) | Sin ellos no se puede excluir: falla cerrado | Unidad de despliegue y secretos **antes** de activar |
| T3 | Base y registro antiguos restaurados juntos: sin detección | Una exclusión podría perderse | Custodia separada + contraste con el registro de Dirección (PRIV-01D §8). Ya documentado |
| T4 | No hay reincorporación | Un error no tiene remedio; una persona que retire la oposición no puede volver | Decisión jurídica (L3) |
| T5 | Copias indefinidas (COMP-07) | El vínculo persiste en las copias anteriores | PRIV-6 D5 |
| T6 | La baja de la cuenta no desvincula (COMP-08) | Requiere C-8 manual | Mantener COMP-08 explícito; la cascada queda **DIF** |
| T7 | Rotar la clave invalida los tombstones | Las personas excluidas dejarían de reconocerse | Prohibido rotar sin una unidad propia |

**Jurídicas y de dirección (además de D1–D9 de PRIV-6):**

- **L1.** ¿Basta «excluir y desvincular» para atender una oposición o una solicitud de supresión, o Legal exige borrar los asientos (lo que requeriría código nuevo)?
- **L2.** ¿Se pueden conservar el tombstone y la referencia opaca de forma indefinida para impedir la reincorporación? (PRIV-01D §1).
- **L3.** Irreversibilidad: ¿es aceptable que una persona excluida no pueda volver, o hace falta una vía de reincorporación, que también sería código nuevo?
- **L4.** Texto exacto de la respuesta al titular (§4) y plazo (D8).
- **L5.** Quién custodia el registro de solicitudes y la copia del registro (D9 y PRIV-01D §8).

## 7. Checklist de PRIV-6 afectada

- **C-7:** el procedimiento queda **probado en laboratorio** (acuse sin datos personales, vista a cero, revisión pedagógica intacta por construcción). Falta la aprobación jurídica de los puntos [PENDIENTE] y los requisitos P1–P4.
- **C-8:** queda cubierto por §5.4 paso 7, con la misma condición.
- **C-9:** es viable con flags OFF (§5.1), con la misma condición.
