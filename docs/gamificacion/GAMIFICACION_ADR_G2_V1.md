# ADR-GAM-G2-01: almacenamiento y transacciones del motor de gamificación

**Unidad:** GAMIFICACION-G2-01 · **Fecha:** 2026-10-29 · **Baseline:** `ce450ea` (CI 3/3 en verde; producción `g0-f4836d1`).
**Estado:** PROPUESTA. No crea tablas, archivos de base de datos ni código.
**Normativos:** [Doctrina V1](GAMIFICACION_DOCTRINA_V1.md), [Contratos V1](GAMIFICACION_CONTRATOS_V1.md), [Implementación V1](GAMIFICACION_IMPLEMENTACION_V1.md) y [Auditoría 01](GAMIFICACION_AUDIT_01.md).
**Hermanos G2:** [Eventos y API V1](GAMIFICACION_EVENTOS_API_V1.md) y [Modelo de datos V1](GAMIFICACION_MODELO_DATOS_V1.md).

---

## 1. Contexto: patrones reales verificados en el código

| Patrón | Dónde | Qué se reutiliza |
|---|---|---|
| SQLite compartido por `api_1` y `api_2` sobre el mismo archivo (bind mount) | `progress.db`, `events.db`, `royalties.db`, `identity.db` | La concurrencia entre réplicas la resuelve el lock de archivo de SQLite |
| Apertura perezosa e idempotente: `busy_timeout=5000`, `journal_mode=WAL`, `synchronous=NORMAL`, `foreign_keys=ON`; migración con un reintento si la otra réplica migró antes | `server/royalties/publishersStore.mjs:47-66` (`getRoyaltiesDb`) | El mismo esqueleto de apertura |
| Ruta configurable por entorno, con valor por defecto en `data-critical/` | `ROYALTIES_DB` → `data-critical/royalties.db` | `GAMIFICATION_DB` → `data-critical/gamification.db` |
| Migraciones versionadas UP/DOWN, una transacción por migración, registro en `_migrations` | `server/db/migrate.js` (`runMigrations(db, log, { dir, tag })`) | Un directorio propio `server/gamification/migrations/` |
| Escritores serializados entre réplicas | `db.transaction(fn).immediate()` en `server/royalties/closesStore.mjs:209` | Toda escritura del ledger va en `BEGIN IMMEDIATE` |
| Append-only por triggers | `econ_events` (`econEvents.mjs:86-89`) y `rights_versions` (`0002_rights_versions.sql`) | Triggers `RAISE(ABORT)` en UPDATE y DELETE |
| Idempotencia por restricción | `events.event_id UNIQUE` + `INSERT OR IGNORE` (`server/eventsService.js`); id determinista de `econ.session_start` | `UNIQUE` sobre la clave de idempotencia |
| Respaldo de SQLite por Online Backup API, declarado en una lista | `ops/backup/CHP-BACKUP-01B/runners/chibalete_backup/stores.py:86` (`SqliteStore(..., "CANON", reconstructible=False, required=False)`) | Una entrada nueva con el mismo formato |
| Stores JSON con lock de archivo | `mutateAccessRules` y `mutateMook` (`withFileLock`) en `server.js:1299` y `server.js:2568` | No hay transacción común con SQLite (§6) |
| Flags con OFF por defecto, leídos por llamada | `server/lib/flags.js`, `econIngestMode()` | Seis flags de gamificación |

**Conclusión:** la arquitectura actual soporta el motor. **No hace falta infraestructura adicional** (servidor de base de datos, colas ni microservicio). La gamificación tiene un volumen de escritura bajo (decenas de hechos por alumno y semana) y se sirve con el mismo patrón de un solo host y dos réplicas que ya usan regalías y progreso.

## 2. Decisión

### 2.1 Ubicación y propiedad
- **Archivo:** `data-critical/gamification.db`, configurable con `GAMIFICATION_DB`. Va en `data-critical/` porque el ledger de PM es **canónico y no se puede reconstruir** por completo: los canjes y los ajustes no se derivan de otras fuentes.
- **Propietario único:** el módulo `server/gamification/`. Ningún otro módulo abre el archivo, y el módulo no abre ningún store ajeno en escritura (§5).
- **Creación:** perezosa, **solo cuando `GAMIFICATION_ENABLED=1`**. Con el flag en OFF no se crea el archivo ni ninguna tabla.
  - Esto difiere de `royalties.db`, que se crea al arrancar en producción. El motivo es que G3 exige que, con los flags en OFF, no se cree ningún artefacto.

### 2.2 Apertura
Mismo esqueleto que `getRoyaltiesDb`, con una diferencia deliberada: **`synchronous=FULL`** en lugar de `NORMAL`.
- **Motivo:** en modo WAL, `NORMAL` puede perder la última transacción confirmada si el host se corta, y aquí se trata de saldos. El coste es despreciable con este volumen.
- **Antecedente:** el VPS ya sufrió un reinicio externo abrupto (`docs/ops/VPS_STORAGE_06.md`).

### 2.3 Alternativas descartadas

| Alternativa | Motivo del descarte |
|---|---|
| Tablas en `royalties.db` | Viola P6 (libro separado de regalías) |
| Tablas en `events.db` | La rotación de 90 días y la expiración de 12 meses, junto con los lectores de analítica, Aula Viva e insights, mezclan ciclos de vida. `econ_events` ya vive ahí por una decisión de regalías y no conviene sumar otro libro |
| Tablas en `identity.db` | Otro propietario y otro contrato de ruta (`IDENTITY_DB`); en cutover gradual |
| JSON (`data/*.json`) | Sin transacciones ni restricciones `UNIQUE`; los locks de archivo no garantizan I1 ni I4 bajo concurrencia |
| Servidor SQL o microservicio | No hay una necesidad demostrada (§1) |

## 3. Ledger append-only, saldo derivado y snapshot

El detalle de las tablas está en el [Modelo de datos V1](GAMIFICACION_MODELO_DATOS_V1.md). Las decisiones de arquitectura son estas:

1. **Movimientos de PM inmutables.**
   - `gm_pm_movements` tiene triggers que rechazan UPDATE y DELETE.
   - Cada movimiento lleva un `kind` cerrado (`earn`, `reserve`, `reserve_release`, `redeem_confirm`, `compensation`, `adjustment`), el signo del `amount` fijado por un CHECK según el `kind`, la `rule_version`, el actor y la clave de idempotencia.
2. **Snapshot por usuario** (`gm_pm_balances`).
   - Es la **única tabla mutable** del ledger y solo se actualiza **dentro de la misma transacción** que inserta el movimiento.
   - Se puede reconstruir en cualquier momento: `available = Σ amount` de todos los movimientos, y `reserved = Σ reservas abiertas`.
3. **El XP y los logros** van en tablas append-only **separadas** de los PM (P1). El XP no tiene movimientos negativos; una corrección se registra como anulación (`void`) y no resta.
4. **Hechos de fuente** (`gm_source_facts`).
   - Es un registro append-only de cada hecho de evidencia que llega al motor, **con la decisión tomada**: `awarded`, `observed`, `capped`, `rejected_*`, `disabled_source` y el resto de motivos.
   - Da trazabilidad incluso cuando no se emite nada, y es lo que permite el modo observación del validador de lectura.

## 4. Idempotencia, atomicidad y carreras

| Riesgo | Mecanismo |
|---|---|
| El mismo hecho llega dos veces (reintento, dos réplicas) | `UNIQUE(source, source_event_id, fact_type)` en `gm_source_facts`. La emisión ocurre **en la misma transacción** que inserta el hecho; si el `INSERT` no inserta nada, no se emite nada |
| Dos réplicas emiten a la vez para el mismo usuario | `BEGIN IMMEDIATE`: la segunda espera por `busy_timeout`. Los topes diario y semanal se calculan **dentro** de la transacción sobre los movimientos ya confirmados |
| Canjes concurrentes con saldo para uno solo | Reserva en `BEGIN IMMEDIATE` con lectura del snapshot y la condición `available >= amount` dentro de la transacción. El segundo canje ve el saldo ya reservado y falla con `INSUFFICIENT_BALANCE` |
| Un reintento del cliente en un canje | `Idempotency-Key` obligatoria, con `UNIQUE(user_id, idempotency_key)` en `gm_redemptions`. El reintento devuelve el mismo canje |
| `SQLITE_BUSY` agotado (más de 5 s) | La operación HTTP responde `503 GAMIFICATION_BUSY` (reintentable con la misma clave). Un gancho de fuente registra el fallo en el log y el hecho se recupera por reconciliación (§7) |

**Reglas de implementación:**
- No hay ningún `await` dentro de una transacción; better-sqlite3 es síncrono.
- No hay llamadas de red (Woo) ni a stores JSON (`access_db`) dentro de una transacción SQLite.

## 5. Límites con otros sistemas (FIXED)

| El motor PUEDE | El motor NUNCA |
|---|---|
| Recibir hechos de **ganchos aditivos** en `server.js` (después de una revisión MOOK o de `/complete`) | Escribir en `royalties.db`, `econ_events`, `closes`, `adjustments` de regalías, `rights_versions` ni `publishers` |
| Leer `progress.db` y `events.db` **en solo lectura** para el validador de finalización | Importar módulos de `server/royalties/` (Q/R/S fuera, D07) |
| Pedir al motor de acceso una regla de premio mediante una función interna dedicada (G5-B, GATED) | Escribir en `access_db.json` directamente desde el módulo, o fijar `commercialClass` fuera de su vía auditada |
| Llamar a WooCommerce `wc/v3` (G6, GATED) | Modificar `server/lib/wooCatalog.mjs` ni crear cupones con `WOO_COUPONS_ENABLED` en OFF |
| Leer identidad y alcance (`cis.mjs`, `isSyntheticUser`) | Modificar MOOK, Leo, el progreso canónico, la identidad o la autenticación |
| — | Usar `user.puntos`, el `localStorage` de canjes o el XP de `RewardEngine` como saldo o recompensa real (D53 y D54) |

## 6. Reservas, confirmaciones y compensaciones entre stores (saga)

El canje toca dos stores sin transacción común: el ledger (SQLite) y `access_db.json` o WooCommerce. Se resuelve con una **saga con estados persistidos**:

```
REQUESTED ─tx1─► RESERVED ─entrega (fuera de tx)─► DELIVERED ─tx2─► CONFIRMED
                     │                                  
                     └─fallo de entrega / timeout─► tx2' ─► RELEASED   (PM intactos)
```

- **tx1** (`IMMEDIATE`): se crea `gm_redemptions` en `RESERVED` y el movimiento `reserve`.
- **Entrega** idempotente por `redemption_id`:
  - activo digital: en la misma base, así que tx1 y la entrega pueden ser **una sola transacción**;
  - regla de acceso: id de regla determinista derivado del `redemption_id`;
  - cupón: id determinista en los metadatos de Woo; antes de crear, se consulta.
- **tx2:** se escribe `redeem_confirm` (o `reserve_release`) y el canje pasa a su estado final.
- **Reconciliador:** recorre los canjes en `RESERVED` o `DELIVERED` más antiguos que un umbral. Si la entrega consta, confirma; si no, libera. Es idempotente, se lanza a mano o con un temporizador interno, y está **apagado si `PM_REDEMPTION_ENABLED` está en OFF**.
- **Compensaciones** (D30): son movimientos `compensation` o `adjustment` con `related_movement_id` y `reason_code`. Nunca se edita un movimiento.

## 7. Integridad, recuperación y respaldos

1. **Integridad continua:** una verificación de solo lectura comprueba que el snapshot es igual a la Σ de los movimientos para cada usuario, y la ejecutan las pruebas de G3. En producción se convierte en un comando operativo de solo lectura.
2. **Respaldo:**
   - Se añade `SqliteStore("data-critical/gamification.db", "CANON", reconstructible=False, required=False)` a `stores.py` (Online Backup API, igual que `royalties.db`).
   - **Orden de despliegue:** primero el runner con `required=False`, y después la activación del flag que crea el archivo. Hay que hacerlo **antes de cualquier emisión real**.
   - Es una dependencia operativa de G3/G7 y requiere su propia unidad de backup.
3. **Recuperación tras restaurar un respaldo:**
   - el snapshot se reconstruye desde los movimientos;
   - los hechos posteriores al punto de restauración se pueden **reprocesar** desde sus fuentes (las revisiones MOOK en `mook_db.json` y el progreso en `progress.db`) con el mismo `source_event_id`, y la idempotencia I1 impide duplicados;
   - los canjes y ajustes posteriores al punto de restauración no se pueden reconstruir desde las fuentes, así que hay que conciliarlos manualmente con el log de auditoría (Woo y el acceso conservan sus propias huellas). Es un riesgo residual y queda documentado.
4. **Corrupción:** el runner ya aborta ante una base corrupta antes de invocar restic.
5. **Kill switch:** `GAMIFICATION_ENABLED=0` deja de abrir el archivo en la siguiente llamada. La lectura no se ve afectada.

## 8. Retención y trazabilidad

- **Trazabilidad completa:** cada movimiento lleva `source`, `source_event_id`, `rule_version`, `actor_id`, `reason_code` y `created_at` (reloj del servidor).
- **Minimización:** sin texto libre, sin nombres y sin contenido de Leo ni respuestas MOOK. Solo identificadores opacos y códigos de motivo.
- **Retención: PENDIENTE de la DPIA (N2).** Hay una tensión que esta ADR **no resuelve**: el ledger append-only choca con una eventual supresión de datos del titular. Las opciones a evaluar en la DPIA son:
  - conservar con el identificador opaco existente;
  - un procedimiento de anonimización por migración autorizada;
  - indirección del sujeto.
  
  Hasta que se decida, no se activa con usuarios reales (bloqueo de G7).
- **Independencia de `events.db`:** el ledger no depende de la rotación de 90 días. `gm_source_facts` guarda **un resumen de las características** que usó cada decisión (por ejemplo, el veredicto del validador), no los eventos crudos.

## 9. Consecuencias

- **Positivas:**
  - un solo patrón operativo, ya conocido (copia, respaldo y migraciones);
  - aislamiento físico de regalías;
  - kill switch sin tocar la lectura.
- **Negativas:**
  - un archivo más que respaldar y vigilar;
  - una saga entre stores en lugar de una transacción única;
  - `synchronous=FULL` cuesta un fsync por transacción, aceptable con este volumen.

## 10. Invariantes verificables y pruebas para G3

| # | Invariante | Prueba en G3 |
|---|---|---|
| A1 | Con `GAMIFICATION_ENABLED` en OFF no se crea `gamification.db` ni ninguna tabla | `bootFlagsOff.test.mjs`: arrancar el módulo con los flags en OFF y comprobar que no hay archivo |
| A2 | Movimientos, hechos, XP y logros rechazan UPDATE y DELETE | `appendOnly.test.mjs`: cada intento lanza `append-only` |
| A3 | Snapshot = Σ movimientos para todo usuario y toda secuencia | `ledgerInvariant.test.mjs` + propiedades (secuencias aleatorias) |
| A4 | Dos conexiones al mismo archivo (simulando dos réplicas) no producen doble emisión ni sobregasto | `twoReplicaConcurrency.test.mjs` (procesos hijos con `BEGIN IMMEDIATE`) |
| A5 | La migración es idempotente y tolera la carrera entre réplicas (reintento) | `migrationRace.test.mjs` |
| A6 | El módulo no importa `server/royalties/**` ni escribe stores ajenos | `royaltyIsolation.test.mjs`: estructural, más huella de `royalties.db` y `econ_events` sin cambios |
| A7 | El snapshot se reconstruye desde cero con el mismo resultado | `snapshotRebuild.test.mjs` |
| A8 | `synchronous=FULL`, WAL y `busy_timeout` aplicados | `pragmas.test.mjs` |
| A9 | Las pruebas no tocan `data/` ni `data-critical/` | Guard de stores reales existente (`realStoreGuard`) + `GAMIFICATION_DB` en un directorio temporal |
