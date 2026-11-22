# CHP V9 65D-2R — Conservación del registro de procedencia y de las constancias de sesión

Fecha: 2026-11-22 · Unidad: V9 Bloque I, 65D-2R · Estado: **capacidad implementada, apagada por defecto**.

## 1. Qué regula

Dos tablas de `data-critical/insights.db`, escritas por `server/aulaViva/contextLedger.mjs` cuando
`AULA_VIVA_CONTEXT_LEDGER_ENABLED=1`:

| Tabla | Contenido | ¿Identifica a una persona? |
|---|---|---|
| `reading_session_receipts` | Constancia del servidor de cada sesión de lectura recibida: lector, obra, id de sesión, fecha declarada, primera y última recepción | Sí (`user_id`) |
| `pedagogical_context_intervals`, `kind = 'member'` | Desde cuándo y hasta cuándo consta cada lector como miembro de un grupo | Sí (`user_id`) |
| `pedagogical_context_intervals`, `kind = 'work'` | Desde cuándo y hasta cuándo consta cada obra asociada a un grupo | No: solo id de grupo e id de obra (`user_id` siempre nulo, por restricción de la tabla) |

Son registros **originales**: no se derivan de `events.db` ni de ningún otro almacén. El registro no reconstruye
historia; lo que se pierde o caduca no se regenera.

## 2. Regla de conservación

Regla operativa indicada por Dirección para esta unidad (2026-11-22):

| Dato | Plazo | Hecho que inicia el plazo |
|---|---|---|
| Constancias de sesión | 12 meses | Última recepción (`last_received_ts`) |
| Membresía cerrada | 12 meses | Cierre del intervalo (`until_ts`) |
| Membresía abierta | Sin caducidad | Se conserva mientras exista la vinculación |
| Asociación obra–curso | Sin caducidad en este mecanismo | No contiene datos personales; se conserva mientras sirva al seguimiento |

El plazo es de calendario UTC, con la misma función que el archivo de eventos (`subtractMonthsUtc`): una fila caduca
cuando el reloj **supera** su fecha + 12 meses; a los 12 meses exactos todavía existe.

### Relación con la documentación vigente

- La política aprobada `CHP_MOOK_EVENTS_EVIDENCE_RETENTION_POLICY_01.md` (Dirección, 2026-09-09) fija 12 meses como
  horizonte máximo de los eventos (`events.db` 90 días + archivo hasta 12 meses) y «relación activa + 12 meses» para
  las evidencias pedagógicas. La regla de esta unidad usa el mismo horizonte y no lo contradice. Esa política **no
  nombra** estas dos tablas: esta regla es una decisión operativa adicional, no una lectura de aquella.
- La tabla D.3 (`GAMIFICACION_V81_CLOSE_07B_CONSERVACION_DERECHOS.md`) sigue **propuesta, sin aprobar**. Sus filas
  C03 (vinculación + 90 días) y C06 (12 meses) serían las categorías más próximas; ninguna asigna estas tablas.
- **No consta validación jurídica** de esta regla en el repositorio. Este documento no la afirma.
- No existe todavía una fecha fiable de «fin de la relación» (R18 / D4 siguen abiertas). Por eso la regla se apoya
  en hechos que el sistema sí registra: la última recepción y el cierre del intervalo.

## 3. Mecanismo

`pruneContextLedger()` en `contextLedger.mjs`, ejecutado por el planificador existente
(`server/aulaViva/scheduler.mjs`, bucle `context_ledger_retention`, cada 24 h, con elección de líder: una sola
réplica por ciclo).

Banderas, todas apagadas por defecto:

| Variable | Efecto |
|---|---|
| `AULA_VIVA_CONTEXT_LEDGER_ENABLED=1` | Enciende el registro |
| `AULA_VIVA_CONTEXT_LEDGER_RETENTION_ENABLED=1` | Habilita la caducidad (exige además la anterior) |
| `AULA_VIVA_SCHEDULER_ENABLED=1` | Ejecuta los bucles de mantenimiento |
| `CONTEXT_LEDGER_RETENTION_INTERVAL_MS` | Cadencia (24 h por defecto) |

La bandera habilita **capacidad**. Encenderla en producción es una decisión operativa aparte; esta unidad no la
enciende ni ejecuta ninguna poda sobre datos reales.

Propiedades comprobadas (`server/__test__/contextLedgerRetention.test.mjs` y sección [13] de
`operationalCoherenceHttp.test.mjs`):

- Idempotente; una sola transacción; dos procesos a la vez retiran exactamente lo caducado.
- `dryRun` cuenta lo que caducaría sin borrar.
- Nunca toca una membresía abierta ni una asociación obra–curso.
- Lo que borra se sobrescribe (`secure_delete`), como la supresión por titular.
- Lo podado no se reconstruye: una observación posterior no recrea un intervalo eliminado; si la persona vuelve al
  curso, su membresía empieza en la fecha del regreso.

### Efecto sobre los indicadores

Una sesión cuya constancia caducó deja de tener fecha acreditada (`no_server_receipt`), y el progreso de esa obra
deja de constar completo: el mediador lo ve como **lectura no atribuible**, nunca como «sin actividad» ni como
acreditada. Un periodo sin intervalo de membresía registrado no se atribuye al curso. Esto es deliberado: a los 12
meses también habrán caducado los eventos de ese periodo.

## 4. Supresión por titular

Independiente del plazo y sin esperar a él. `server/privacy/suppression.mjs` elimina de `insights.db` toda fila con
el `user_id` de la persona: sus constancias (vigentes o no) y sus intervalos de membresía (abiertos o cerrados). Desde
65D-2 también elimina sus eventos de `data/analytics_db.json`. Las asociaciones obra–curso no se tocan: no la
identifican. Tras una restauración, `reapplyResidualAfterRestore` vuelve a suprimir.

## 5. Respaldo y recuperación

`insights.db` deja de clasificarse como proyección reconstruible. En
`ops/backup/CHP-BACKUP-01B/runners/chibalete_backup/stores.py` pasa a `CANON`, `reconstructible=False`: además de las
materializaciones (que sí se regeneran desde `events.db`) contiene estos registros originales.

- La base ya se capturaba en cada respaldo estructurado; lo que cambia es su **clase**: la evaluación de puntos de
  recuperación previa a un despliegue la trata ahora como almacén crítico.
- Si se restaura una copia anterior, las constancias e intervalos posteriores a esa copia se pierden y la lectura
  de ese tramo queda como no atribuible. No se «rellenan».
- Una restauración puede devolver filas ya caducadas o de personas suprimidas: la conciliación de supresiones se
  aplica como hasta ahora, y la siguiente ejecución de la caducidad (si está habilitada) retira lo vencido.
- Las copias de respaldo conservan lo eliminado hasta que expire su propia retención (objetivo 7/4/6, DIR-V81-06;
  `forget`/`prune` siguen sin autorizar). Esta unidad no toca respaldos reales.

El cambio de clasificación está en el repositorio; el ejecutor instalado en el servidor no cambia hasta que se
despliegue por su procedimiento propio.

## 6. Lector Único (dispositivo)

Lo pendiente de entrega en el dispositivo sigue asociado a su cuenta y solo ella lo envía. La caducidad de lo
pendiente de una cuenta que **no** es la activa pasa de 45 días a 12 meses (LU `59d7ada`, local), el mismo horizonte
de esta regla; lo de la cuenta activa no caduca. La eliminación expresa es `LocalDataCleaner.clearPendingOf(userId)`.
Límite conocido: no existe una señal remota que ejecute esa eliminación en un dispositivo cuando la cuenta se suprime
en el servidor; lo pendiente de esa cuenta nunca se transmite (solo su dueña lo envía) y caduca a los 12 meses.

## 7. Pendiente de decisión

1. Validación jurídica de los plazos de esta regla.
2. Autorización para encender la caducidad en producción.
3. Definición del «fin de la relación» (R18 / D4), si se quiere un plazo ligado al vínculo y no a los hechos registrados.
