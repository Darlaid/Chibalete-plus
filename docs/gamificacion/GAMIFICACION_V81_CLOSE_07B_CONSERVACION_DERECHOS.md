# V8.1-CLOSE-07B: conservación, derechos y recuperación (G-04 a G-08)

**Fecha:** 2026-11-09. Código en local, sin push (`4fb452f`, `51e230f`). Sin despliegue y con XP apagado.

**Fuentes** (solo se citan; los PDF no se copian):
- 001 §11.3 (criterios por categoría), §11.11 (respaldos y restauraciones), §13 (supresión).
- 006 P06, P08, P09, P10, H.1-04 y Anexo D (matriz D.3, C01–C12; calendario D.4).
- Política de retención aprobada de eventos y evidencias: `docs/ops/CHP_MOOK_EVENTS_EVIDENCE_RETENTION_POLICY_01.md`.

| Brecha | Estado |
|---|---|
| G-04 Respaldos | **Condicionada**: capacidad verificada, parámetros propuestos, pendiente la aprobación de Dirección y una unidad de activación |
| G-05 Baja de cuentas | **Resuelta en código**, condicionada a su procedimiento y a G-08 |
| G-06 Exclusiones | **Resuelta**: se mantiene la irreversibilidad y quedan distinguidos los tres casos |
| G-07 Mediadores | **Resuelta en código** |
| G-08 Anonimización | **Condicionada**: la desvinculación es **seudonimización**, no anonimización |

## G-04: respaldos

**Capacidad real** (`ops/backup/CHP-BACKUP-01B`; gate BACKUP en verde desde el 2026-07-27, con el restore aislado de 01C-R1/R2 ensayado):
- **Frecuencia:** restic cifrado hacia B2. Estructurado cada 6 h (24 stores: SQLite, JSON del padrón, grupos, MOOK, Leo, envíos, accesos…), `uploads` a diario y verificación semanal (`snapshots` + `check`).
- **Retención:** **no hay ninguna.** `forget` y `prune` están bloqueados por diseño hasta una unidad explícita (`BACKUP_01B_DESIGN.md` §5). La política 7/4/6 está diseñada, pero solo se ha simulado con `--dry-run`. Las instantáneas crecen sin límite, en contra de 001 §11.11 y de D.3 C11.
- **Granularidad:** la retención de un respaldo es **por instantánea**, no por categoría. Las categorías se cumplen en los stores activos; el respaldo solo puede tener un ciclo máximo.
- **Registros:** el de exclusiones y el de decisiones están **fuera** del respaldo a propósito (constancias que sobreviven a la restauración, 001 §11.11).

**Parámetros propuestos** (para aprobar por Dirección en D.3; los que exigen validación jurídica van marcados ⚖):

| D.3 | Categoría | Parámetro propuesto | Hecho inicial | Disposición |
|---|---|---|---|---|
| C01 | Comercial y contable (art. 28 Ley 962) | 10 años, **solo** los documentos comprendidos | Último asiento o comprobante | Archivo contable propio, **no** el respaldo operativo |
| C03 | Cuenta, roles y grupos | Mientras exista la vinculación, más **90 días** de cierre | Fin de la vinculación, de la suscripción o del convenio | Supresión (G-05). Los permisos terminan con la función (G-07) |
| C04 | Autorizaciones y prueba | Mientras sustenten el tratamiento, más **2 años** ⚖ | Fin del tratamiento o revocación | Depurar los soportes familiares excesivos. La constancia mínima, en el registro de decisiones |
| C05 | Producciones y revisión (`mook_db`, `submissions`) | Relación activa + **12 meses** (política aprobada) | Lo que ocurra después: fin de la relación o última actividad | Borrado de la producción y sus versiones (pendiente de vía, ver G-08) |
| C06 | Progreso y reconocimientos (XP) | Continuidad vigente; **12 meses** sin actividad tras el fin de la vinculación | Fin de la vinculación | Desvinculación (`excludeUser`) |
| C07 | Técnicos y soporte | Logs **30 días** (política aprobada). Casos de derechos e incidentes: **2 años** ⚖ | Evento; cierre del caso | Rotación / borrado |
| C08 | Leo | Interacción temporal 30 días; historial propio mientras exista la cuenta; proveedor según contrato ⚖ | Evento; cierre de cuenta | Borrado |
| C10 | Insumos y estadísticas (`events`, `signal_snapshots`) | `events` 90 d activos y 12 meses en total; `signal_snapshots` 90 d (política aprobada) | `occurred_at` / última actualización | Eliminación definitiva. Resultados «anónimos» solo con prueba (G-08) |
| **C11** | **Respaldos** | **Ciclo máximo: 7 diarias, 4 semanales, 6 mensuales (≈ 6 meses)**. Expiración máxima tras una supresión: **≤ 6 meses + 7 días**. Sin uso ordinario mientras expiran | Fecha de cada instantánea | `restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6` y después `prune` |
| C11 | Registros de exclusiones y de decisiones | Mientras sirvan como constancia contra reactivaciones (vida del servicio + C04) ⚖ | Anotación | Copia custodiada propia, nunca en el ciclo de respaldos |
| C12 | Comunicaciones opcionales | Mientras la decisión siga vigente; soporte de la baja 2 años ⚖ | Baja | Borrado |

**Transición segura** (no se borra ni se modifica ningún respaldo en esta unidad):
1. Dirección aprueba las filas D.3 anteriores, o las corrige, y su revisión en D.4.
2. Durante **4 semanas**, simulación por tipo: `restic forget --dry-run --tag <tipo> --group-by host --keep-daily 7 --keep-weekly 4 --keep-monthly 6`. AT registra qué instantáneas expirarían. **Corrección (CLOSE-08A):** el runner real **no** permite `forget` ni con `--dry-run` (`restic.py`, `DESTRUCTIVE_SUBCOMMANDS`); habilitar solo el `--dry-run` es un cambio aprobado de esa lista. Ver `GAMIFICACION_V81_CLOSE_08A_SUPRESION_FECHAS.md` §3.
3. Ensayo de restauración desde la instantánea **más antigua que se conservaría** (patrón 01C), con la conciliación posterior:
   - `replayExclusions`;
   - `accountsToRestrictAfterRestore` (G-05);
   - registro de decisiones vigente, porque no se restaura.
4. **Retenciones excepcionales:** la orden escrita de Dirección (006 P08) fija qué instantáneas quedan fuera del `forget` y hasta cuándo.
5. **Unidad de activación propia:** `forget` sin `--dry-run`, revisión y después `prune`, con evidencia G.2. Nunca en la misma ventana que un despliegue.

## G-05: baja de cuentas

- **Antes:** `DELETE /api/users/:id` borra la ficha del padrón, pero `gm_subjects` conservaba el `user_id` y no se retiraba ninguna decisión. Si se restauraba el padrón, la cuenta volvía.
- **Ahora** (`server/privacy/suppression.mjs`, solo operador y sin ruta HTTP), `suppressAccount` corre **solo** para una solicitud de supresión, con la referencia opaca del trámite y su fecha:
  - Con base de gamificación: `excludeUser` (desvincula y deja un tombstone en el registro independiente).
  - Sin base: solo el tombstone. Cuando se cree la base, la puerta exige `replayExclusions` (runbook PRIV-C7).
  - En el registro de decisiones: A1, A2 (y C005 si es mediador) `revoked`, sin borrar nada.
  - Después, Administración elimina la cuenta con la operación existente (`DELETE /api/users/:id`).
- **Qué no la activa:** una baja comercial (`/api/b2c/revoke`, que solo vence la regla de acceso), una desactivación temporal (`/disable`) ni una edición. Así distingue el vencimiento comercial, el cierre de cuenta y la petición de supresión (006 P08, paso 1).
- **Tras restaurar el padrón:** `accountsToRestrictAfterRestore(users)` lista las cuentas que no pueden volver a servicio (tombstone o A1 revocada). AT las desactiva **antes** de reabrir; si el registro está alterado, el resultado es error, nunca una lista vacía.
- **Pendiente** (procedimiento, sin código):
  - Constancia G.1 con lo ejecutado en activos y lo pendiente en respaldos (expira según C11).
  - La traza en `user_audit_log.json` (el correo de la cuenta borrada) sigue C07.

## G-06: exclusiones

Se mantiene la exclusión irreversible de PRIV-01D mientras no exista una decisión jurídica distinta (001 §14.7 ⚖). Tres casos distintos, probados en `rightsLifecycle`:

| Caso | Efecto | Reversible |
|---|---|---|
| **Exclusión** (supresión) | Tombstone de la cuenta. Esa cuenta no vuelve a tener sujeto ni XP aunque vuelva a constar A1 | No |
| **Revocación** de A1/A2 | Sin XP nuevo ni consulta institucional desde la revocación. Se conserva el histórico | Sí: una nueva decisión verificada habilita **solo hacia adelante**, con granularidad de día (una aprobación del mismo día de la nueva A1 cuenta) |
| **Nueva vinculación legítima** | Cuenta **nueva** con su 004 y su A1 verificada: suma XP | — |

No se crea ningún mecanismo de reincorporación. Una cuenta excluida no se «reabre»: si procede, se vincula una cuenta nueva con sus autorizaciones.

## G-07: mediadores

Con mecanismos existentes, sin módulo nuevo:
- **Vigencia del 005:** la consulta institucional individual de un mediador (status, `readers[]` de Aula Viva, progreso XP, exportaciones y revisión MOOK, incluida la recomprobación dentro del lock) exige además su **C005 efectivo**, con la vigencia del 005 («Vigencia desde/hasta»).
  - Vencido: cerrado solo.
  - Revocado: cerrado en la petición siguiente, en todas las réplicas.
- **Asignación** (`group.mediatorIds`): retirarla cierra el acceso en la petición siguiente, sin reiniciar (H.1-04).
- **Probado:** `mediatorValidityHttp` 14/0, con dos réplicas.
- **Regularización:** los mediadores existentes necesitan C005 (el 005 firmado, anotado por AT con `ops/a2/decision_operator.mjs` y su `validUntil`), o activar su cuenta con el compromiso. Sin él no tienen consulta individual.

## G-08: anonimización (probado con datos sintéticos, `rightsLifecycle` §4)

**Comprobado:**
- Tras `excludeUser`, **ningún texto** de `gamification.db` contiene el id.
- Los hechos y el XP quedan con claves aleatorias y **sin sal**, así que no se pueden recalcular.

**No es anonimización:**
- **Vínculo por combinación:** `mook_db.json` (C05) conserva el `userId` y la fecha de las entregas. Si ese día hubo un solo hecho, el XP desvinculado se puede asociar por fecha a la entrega identificada. Con varios hechos el mismo día, deja de ser atribuible.
- **Registros:** el tombstone y las líneas del registro de decisiones son **seudónimos con clave** (HMAC): quien tenga la clave puede reconocer a la persona, y es intencionado, porque es la constancia contra reactivaciones.

**Conclusión:** la desvinculación es **seudonimización**. Solo se podría declarar anonimización:
- si en la supresión también se borran o anonimizan las producciones identificadas (C05), lo que necesita una vía de borrado MOOK, pendiente;
- y si VER prueba el umbral (006 §9.2) ⚖.

## Pruebas

Linux (`node:20-bookworm`, sin root, pasos de `identity-preflight`): **22/23 pasos en verde**; `rightsLifecycle` 27/0, `mediatorValidityHttp` 14/0, revisión MOOK 30/0 y 14/0, exportaciones 83/0, alcance 45/0, activación 31/0, A1→XP 23/0, rectificación 44/0, O8 27/0.

El paso que falla es preexistente y ajeno: `myProgress` y `platformIntegration` comparan el día del ledger (Bogotá) con `new Date().toISOString()` (UTC), así que fallan entre las 19:00 y las 24:00 de Bogotá. El commit base `dd16a8a` falla igual a la misma hora, y las dos pasaron antes en la CI remota y en Linux.

## Pendientes de esta unidad

- **Imágenes:** `v81-dd16a8a` no incluye G-05 ni G-07. Hay que reconstruirlas desde el commit publicado con CI en verde.
- **Mediadores:** los de producción necesitan su C005 regularizado antes del despliegue, o pierden la consulta individual (además de A2).
