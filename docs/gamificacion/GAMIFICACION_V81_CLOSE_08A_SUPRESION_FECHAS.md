# V8.1-CLOSE-08A: supresión efectiva, estabilidad horaria y preparación de G-04

**Fecha:** 2026-11-10.
- **Publicado:** CLOSE-07B (`21000c2..cb9f705`).
- **Esta unidad:** `29c7497` y `41d9f21`, más este documento.
- Sin despliegue, sin XP y sin tocar datos reales ni respaldos.

## 1. Publicación y CI de `cb9f705`

| Workflow | Resultado |
|---|---|
| `security` | Verde |
| `content-rmw` | Verde |
| `identity-preflight` | **Rojo** por **una** aserción: `myProgress` 70/1 («cada entrada: día del hecho…») |

- **Causa:** la CI corrió a las 01:2x UTC (20:2x de Bogotá) y la prueba comparaba el día de Bogotá del ledger con el día UTC (§2).
- **No es una regresión:** el commit base `dd16a8a` falla igual a la misma hora.
- **Corrección:** `29c7497`.

## 2. Corrección horaria (solo pruebas)

**Producción es correcta:** el día del historial es la fecha ISO de `occurred_at`, que el ledger guarda como inicio del día de Bogotá, así que es el día de Bogotá.

**El defecto:** `myProgress` y `platformIntegration` esperaban `new Date().toISOString().slice(0, 10)`, el día **UTC** de ahora. Fallaban cada noche entre las 19:00 y las 24:00 de Bogotá.

**La corrección:** el valor esperado sale de `L.periodsFor(Date.now()).day`, la convención del propio ledger. No cambia ni código de producción, ni reglas, ni fechas.

**Prueba determinista nueva** (`historyDayBogota`, 9/0): reconocimientos en instantes fijos (18:59, 19:01 y 23:30 de Bogotá, y 00:10 del día siguiente). Comprueba el día guardado y el mostrado.

**Reproducción con `faketime`** (Linux):

| Hora simulada | Antes | Después |
|---|---|---|
| 20:00 Bogotá | `myProgress` 70/1, `platformIntegration` 57/1 | 71/0, 58/0 |
| 10:00 Bogotá | 71/0, 58/0 | 71/0, 58/0 |

## 3. G-05 / G-08: fuentes que la supresión dejaba identificables

**Criterio:** desvinculación ≠ anonimización.

### Fuentes tratadas

| Fuente | Qué conservaba | Tratamiento ahora |
|---|---|---|
| `mook_db.json` (D4) | Recorridos y producciones con `userId`, texto e historial de revisión; `reviewerId` del mediador | **Eliminación** de recorridos y producciones de la persona. **Conservación justificada** solo para las producciones listadas en una orden escrita de Dirección (`legalHold {ref, until}`, 006 P08). **Seudónimo** del revisor suprimido en las producciones ajenas |
| `submissions_db.json` (D4) | Entregas de tareas con `studentId` y texto | **Eliminación** |
| `gamification.db` | Sujeto con `user_id` | `excludeUser` (CLOSE-07B) |
| Padrón y grupos | Cuenta y membresías | `DELETE /api/users/:id`, la operación existente |
| Registros de exclusiones y decisiones | Tombstone; A1/A2/C005 `revoked` | **Constancias técnicas**, seudónimas con clave, contra reactivaciones. Se conservan |

**Cómo se ejecuta:**
- **Locks:** `suppressMookParticipant` y `suppressSubmissions` escriben bajo el **mismo lock** que `mutateMook` y `mutateSubmissions`, con escritura atómica.
- **Operador:** `ops/a2/suppression_operator.mjs`, por stdin, solo AT y sin ruta HTTP.
- **Caché:** las réplicas pueden servir la versión anterior de MOOK hasta 30 s (la misma TTL de caché que con cualquier cambio de otra réplica). Ningún mediador la ve, porque A2 está revocada y se consulta en cada petición.

### Recuperación de respaldos (`suppressionRestoreHttp`, 16/0, `server.js` real)

1. Se restaura un «respaldo» anterior (padrón, grupos, MOOK y entregas) con el servidor en marcha. La cuenta vuelve, pero **ningún mediador vuelve a ver su información**:
   - status 403;
   - Aula Viva sin la persona;
   - exportación 403.

   El motivo: A2 revocada en un registro que no se restaura.
2. `accountsToRestrictAfterRestore` identifica la cuenta y AT la desactiva con `/disable`.
3. `reapplyMookSuppressionsAfterRestore` y `reapplySubmissionSuppressionsAfterRestore` vuelven a suprimir a toda persona con tombstone.

### Fuera de esta operación

Fuentes identificables con su propia regla de conservación. Ninguna se expone al mediador de una persona suprimida, porque se requiere A2:

| Fuente | Regla |
|---|---|
| `events.db` / `events.archive.db` | Política aprobada: 90 d y 12 meses |
| `progress.db` / `progress_db.json` | C06 |
| `leo_*` | C08 |
| `user_audit_log.json` (con el correo de la cuenta borrada) | C07 |
| `access_db.json` (reglas de ámbito usuario) | C03 |
| `identity.db` | C03 |

Su tratamiento en la supresión queda en G.1 según D.3. **No se declara anonimización** mientras esas fuentes sigan identificando.

## 4. G-04: preparación, sin borrado (verificación de solo lectura en el repositorio)

**Estado:** la tabla D.3 y el objetivo C11 de **7 diarias, 4 semanales y 6 mensuales** quedan registrados como **propuesta pendiente de validación jurídica y de aprobación de Dirección** (CLOSE-07B). No se inicia ninguna simulación.

**Verificación contra la configuración real** (`ops/backup/CHP-BACKUP-01B`):

| Respaldo | Frecuencia | Etiquetas | ¿Rota con 7/4/6? |
|---|---|---|---|
| Estructurado (24 stores) | Cada 6 h (`structured-backup.timer`) | `structured` + `run_id` | Sí, si se agrupa por `host` y se filtra por `--tag structured`: queda la última del día. **No** con el agrupamiento por defecto de restic (host + rutas), porque la ruta de staging es `mkdtemp` y cambia en cada ejecución. Con ese agrupamiento, cada instantánea es su propio grupo y nada expira |
| `uploads` | Diaria (`uploads-backup.timer`) | `uploads` + `run_id` | Sí, con `--tag uploads --group-by host` |
| Manifiesto de uploads | Diaria | `uploads-manifest` + `run_id` | Sí, con su propio `--tag` |
| Verificación | Semanal | (no crea instantáneas) | — |

**Invocación correcta** (para la unidad futura, **no** ejecutada):

```
restic forget --dry-run --tag structured --group-by host --keep-daily 7 --keep-weekly 4 --keep-monthly 6
```

Y lo mismo con `--tag uploads` y con `--tag uploads-manifest`.

**Hallazgo que corrige CLOSE-07B:** el runner (`restic.py`) **no permite `forget` ni con `--dry-run`**: está en `DESTRUCTIVE_SUBCOMMANDS`. El documento de diseño que decía lo contrario está desactualizado. La simulación de 4 semanas exige un cambio aprobado de esa lista, solo para `forget --dry-run` y solo después de que Dirección lo autorice.

**Ubicaciones:**
- Repositorio restic remoto (B2/S3, `RESTIC_REPOSITORY`), la del ciclo C11.
- Copias del proveedor del VPS (Hostinger), con su propia retención: otra fila de C11 que Dirección debe confirmar con el proveedor (006 P10).
- Los registros de exclusiones y de decisiones quedan fuera del ciclo, con copia custodiada.

**Parámetros pendientes de aprobación** (sin cambios desde CLOSE-07B):
- **Ciclo C11:** 7/4/6 (≈ 6 meses); expiración tras una supresión ≤ 6 meses + 7 días.
- **C03:** +90 d. **C04:** +2 años ⚖. **C05:** relación + 12 meses. **C06:** 12 meses sin actividad.
- **C07:** logs 30 d; casos 2 años ⚖. **C08:** 30 d / mientras exista la cuenta ⚖. **C10:** 90 d / 12 meses.
- **C12:** baja 2 años ⚖. **C01:** 10 años, archivo contable aparte.

## 5. Impacto en las imágenes

- `v81-dd16a8a` es anterior a G-05, G-07 y G-08: **obsoleta**.
- Las imágenes definitivas se construyen desde el commit publicado de esta unidad, con CI en verde (procedimiento CLOSE-07A).
- El front no cambia desde `dd16a8a`, pero conviene reconstruirlo desde el mismo commit para que la pareja quede trazable.
