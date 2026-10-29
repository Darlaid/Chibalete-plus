# GAMIFICACION-G3-01: núcleo persistente del ledger

**Fecha:** 2026-10-29 · **Base:** `035f5f9` (G2 publicado, CI en verde) · **Producción:** `g0-f4836d1`, sin cambios.
**Alcance:** solo la infraestructura transaccional. Quedan fuera los ganchos de origen, HTTP, la UI, los canjes operativos y la activación de flags.

## 1. Qué se implementó

| Archivo | Contenido |
|---|---|
| `server/gamification/migrations/0001_ledger.sql` | Las 10 tablas `gm_` del [Modelo de datos V1](GAMIFICACION_MODELO_DATOS_V1.md), con sus índices, CHECK, UNIQUE y FK. Hay triggers append-only en 8 tablas, `gm_pm_balances` no se puede borrar y `gm_redemptions` solo admite transiciones legales. Todo va con `IF NOT EXISTS` |
| `server/gamification/db.mjs` | `isGamificationEnabled`, `resolveGamificationDbPath`, `getGamificationDb`, `safely` y `closeGamificationDb`. Abre con WAL, `busy_timeout=5000`, `synchronous=FULL` y `foreign_keys=ON`, y migra con `server/db/migrate.js` en su propio directorio |
| `server/gamification/ledger.mjs` | Primitivas internas: `createRuleSet`, `recordFact`, `appendAdjustment`, `appendCompensation`, `getBalance`, `listMovements`, `getXp`, `verifyLedger`, `rebuildBalances` y `periodsFor` |
| `server/gamification/__test__/*` | Tres suites (núcleo, concurrencia entre procesos, backup/restore) y el worker de réplica |
| `package.json` | Script `test:gamification-core` |
| `.github/workflows/identity-preflight.yml` | Paso «Núcleo del ledger de gamificación (G3-01)» |

### Diferencias respecto a G2

1. **Reintento de apertura ante BUSY.** Lo encontró la prueba de concurrencia.
   - Cuando 4 procesos arrancan a la vez sobre una base nueva, el paso a WAL y la migración (una transacción diferida que se convierte en escritura) devuelven `SQLITE_BUSY` **sin pasar por `busy_timeout`**. El patrón de un solo reintento heredado de `royalties.db` no alcanzaba.
   - `db.mjs` ahora reintenta la apertura completa hasta 12 veces, con espera aleatoria, y solo ante BUSY o LOCKED; cualquier otro error sale enseguida. No se tocó `migrate.js`.
   - **Observación para otra unidad:** `getRoyaltiesDb` tiene el mismo patrón de un reintento. En producción no ha fallado porque las réplicas se reinician de forma escalonada. No se modificó.
2. **Guardas de las primitivas, además del SQL:**
   - solo emiten los grados A y B (`GRADE_NOT_EMITTING`);
   - la lectura terminada queda bloqueada para emitir (`READING_EMISSION_LOCKED`) hasta que G4 apruebe su validador;
   - si el actor es el sujeto, se rechaza (`SELF_AWARD`);
   - las fuentes `leo` y cualquier otra fuera del enumerado se rechazan;
   - `features` solo admite las claves de la lista permitida, sin texto libre;
   - cota técnica de **10 000** por movimiento (`MAX_AMOUNT_PER_MOVEMENT`). **No es una tarifa**: los topes doctrinales D13, D14 y D46 llegarán con su propia unidad.
3. **Reservas y canjes:** existen sus tablas y el trigger de transiciones, pero **no hay ninguna primitiva** que los opere (fuera de alcance).

## 2. Evidencia

| Suite | Resultado | Qué cubre |
|---|---|---|
| `ledgerCore.test.mjs` | **107 ✓ / 0 ✗** | (1) Con el flag OFF no hay archivo ni directorio; los valores `0`, `false`, `off` y `yes` cuentan como OFF. (2) Pragmas aplicados, exactamente 10 tablas `gm_` más `_migrations` y `sqlite_sequence`, migración idempotente. (3) Reglas append-only y prospectivas. (4) **100 repeticiones dan 1 hecho, 1 asiento de XP y 1 movimiento.** (5) Las 14 operaciones inválidas se rechazan sin dejar filas. (6) Ajustes y compensaciones idempotentes, sin «set balance»; solo la compensación puede dejar el saldo negativo. (7) UPDATE y DELETE abortan; los CHECK, UNIQUE y FK se cumplen a nivel SQL; transiciones de canje ilegales. (8) **El snapshot es igual a la suma del ledger tras 300 operaciones pseudoaleatorias**; una alteración se detecta y la reconstrucción la repara. (9) Periodos en Bogotá, incluido el cambio de año ISO. (10) Con la base corrupta o inaccesible, `GAMIFICATION_DB_UNAVAILABLE` con backoff y `safely` nunca lanza; el archivo corrupto no se sobrescribe. (11) Aislamiento: no hay imports de regalías, no se escribe ningún otro store, no hay rutas HTTP, y ni `server.js`, ni el progreso, ni MOOK, ni Leo importan el motor |
| `ledgerConcurrency.test.mjs` | **13 ✓ / 0 ✗** (5 ejecuciones seguidas) | **4 procesos arrancando a la vez** ven 1 sola migración. **2 procesos (réplicas)** escriben 100 hechos compartidos y 100 propios cada uno, más ajustes: 300 hechos sin duplicados, 300 `earn`, 300 de XP, ningún ajuste perdido, snapshot igual al ledger, `seq` sin huecos y ningún saldo negativo |
| `ledgerBackupRestore.test.mjs` | **14 ✓ / 0 ✗** | Captura con **`capture_sqlite` real del runner** (Online Backup API más `integrity_check`) con la base abierta y el WAL sin volcar. La base restaurada tiene `integrity_check=ok`, el hash de las 11 tablas es idéntico, el punto de restauración es exacto, los triggers se conservan y reprocesar los hechos no duplica, mientras que los hechos perdidos después del punto se recuperan |

En todas las suites:
- se usa `GAMIFICATION_DB` en un directorio temporal;
- se comprueba que `data-critical/gamification.db` no se creó.

## 3. Garantías y limitaciones reales

**Garantías**
- Idempotencia de los hechos y los movimientos por restricción. La emisión ocurre en la misma transacción que el hecho.
- Las escrituras de las dos réplicas se serializan con `BEGIN IMMEDIATE`, y el snapshot se puede verificar y reconstruir.
- El ledger no se puede reescribir, ni siquiera con SQL directo.
- Con el flag OFF no hay ningún artefacto en disco.
- Ninguna parte del producto llama al motor, así que hoy **no puede** alterar la lectura, el progreso ni MOOK.

**Limitaciones**
- **Bloqueo del event loop.** better-sqlite3 es síncrono: si hay contención, una escritura puede esperar hasta `busy_timeout` (5 s) **bloqueando el event loop** de esa réplica, y el reintento de apertura también duerme de forma síncrona. Hoy no afecta a nada porque no hay llamadores. Condiciona el diseño de G3-02 (§4).
- **No hay topes doctrinales ni bolsa mensual.** Solo existe la cota técnica.
- **Rotura voluntaria del snapshot.** `gm_pm_balances` puede alterarse con SQL directo (es mutable por diseño). `verifyLedger` lo detecta y `rebuildBalances` lo repara, pero no lo impide.
- **Retención y borrado de datos:** sigue pendiente de la DPIA (ADR §8).
- **Validación local del backup.** Se validó en Windows con Python 3.14 local. En CI (Ubuntu) se ejecutará con `python3`; si no lo hubiera, la suite hace SKIP explícito.

## 4. Diseño para G3-02: procesamiento recuperable sin infraestructura externa

**Objetivo:** que un hecho de origen (revisión MOOK, experiencia completada o lectura terminada en observación) llegue al ledger **sin bloquear la operación original** y sin perderse si el motor falla. Todo se resuelve sin colas, brokers ni servicios nuevos.

1. **Gancho después de responder.**
   - El gancho se invoca después de que la operación original confirmó y de que `res.json()` se envió.
   - Usa `setImmediate`, envuelto en `safely()`.
   - Con el flag OFF solo cuesta leer una variable de entorno.
2. **Conexión del gancho con un `busy_timeout` corto.**
   - Para no bloquear el event loop hasta 5 s, los ganchos usan una conexión propia con `busy_timeout` de unos 200 ms (por calibrar).
   - Si devuelve BUSY, el gancho **desiste** y confía en el paso 3. No reintenta en línea.
   - La conexión de las rutas de administración puede conservar los 5 s.
3. **Reconciliación desde las fuentes, sin outbox.**
   - No se añaden tablas de outbox en MOOK ni en el progreso: sería modificar esos sistemas.
   - Un reconciliador recorre los **stores autoritativos**:
     - `mook_db.json`: evidencias `REVIEWED` y experiencias completadas;
     - `progress.db`: registros con `isCompleted`, solo para observación.
   - Para cada hecho llama a `recordFact`. La idempotencia I1 hace inocuo procesar dos veces.
   - **Marca de agua sin tabla nueva:** `MAX(occurred_at)` por fuente en `gm_source_facts`, con un solapamiento de seguridad. Como es idempotente, solapar no duplica.
   - Se ejecuta al arrancar (si el flag está ON), con un temporizador `unref()` de baja frecuencia y por `POST /admin/reconcile` cuando exista HTTP.
   - Las dos réplicas pueden ejecutarlo a la vez sin riesgo (`BEGIN IMMEDIATE` más I1).
4. **Precalentamiento.** Con el flag ON, la base se abre y se migra **al arrancar**, no en la primera petición. Así el reintento de apertura (con su espera síncrona) nunca ocurre dentro de una petición.
5. **Pruebas que tiene que añadir G3-02:**
   - el motor que lanza error, la base corrupta o la base bloqueada dejan `/complete` y la revisión MOOK **idénticos** (estado, cuerpo y escritura);
   - la latencia de la ruta original no aumenta con el motor bloqueado;
   - el reconciliador recupera los hechos perdidos sin duplicar;
   - la autorrevisión y los usuarios sintéticos se rechazan con su decisión registrada.

## 5. Incorporación al runner de respaldos (preparada, no aplicada)

Cambio previsto, para una unidad de backup propia:

```python
# ops/backup/CHP-BACKUP-01B/runners/chibalete_backup/stores.py — SQLITE_STORES
SqliteStore("data-critical/gamification.db", "CANON", reconstructible=False, required=False),
```

- **Ajustes asociados:** hay que actualizar los recuentos fijados en `tests/test_capacity.py` y `tests/test_suite.py`, porque cuentan los stores declarados.
- **Orden de despliegue** (igual que `royalties.db`): primero el runner con `required=False`, y después la activación de `GAMIFICATION_ENABLED`, que crea el archivo. Siempre **antes de cualquier emisión real**.
- La compatibilidad del archivo con `capture_sqlite` ya se demostró (§2).

## 6. Siguiente unidad

**G3-02:** ganchos de origen recuperables (§4) y emisión detrás de flags en OFF, más los topes doctrinales como reglas versionadas.

Antes de activar nada con usuarios reales siguen pendientes la DPIA, la unidad de backup (§5) y la decisión sobre `con_comentarios`.
