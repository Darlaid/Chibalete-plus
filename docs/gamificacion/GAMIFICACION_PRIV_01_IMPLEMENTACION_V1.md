# GAMIFICACION-PRIV-01A: implementación V1

**Fecha:** 2026-10-30 · **Base:** `bfde5c0` · **Producción:** `g0-f4836d1`.
**Naturaleza:** plan, solo documento. Ninguna unidad queda autorizada. **Modelo:** [Modelo V1](GAMIFICACION_PRIV_01_MODELO_V1.md).

**Invariante de todo el plan:** ningún hecho real se escribe antes de cerrar PRIV-4, PRIV-5 y PRIV-6. `GAMIFICACION_ENABLED` sigue OFF.

---

## 1. Cambios mínimos de esquema

**Migración `0002_subject_model`.** Validada contra `0001` en SQLite en memoria: se aplica; los 19 triggers siguen operando tras el renombrado, incluida la transición de canjes; unicidades probadas. **No está creada en el repositorio.**

```sql
-- Renombrados: 12 columnas (user_id → subject_ref; actor_id → actor_ref; target_user → target_ref)
ALTER TABLE gm_source_facts RENAME COLUMN user_id TO subject_ref;
-- … gm_xp_entries, gm_achievements, gm_redemptions, gm_pm_movements, gm_pm_balances, gm_reward_grants …

CREATE TABLE gm_subjects (
    subject_ref  TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL UNIQUE,
    subject_salt BLOB NOT NULL CHECK (length(subject_salt) = 32),
    role_class   TEXT NOT NULL CHECK (role_class IN ('reader','actor')),
    created_on   TEXT NOT NULL
);  -- mutable y borrable: sin triggers

CREATE TABLE gm_erasures (
    erasure_id  TEXT PRIMARY KEY,
    tombstone   TEXT NOT NULL UNIQUE,
    erased_on   TEXT NOT NULL,
    request_ref TEXT
);

CREATE TABLE gm_work_cycles (
    fact_id     TEXT NOT NULL REFERENCES gm_source_facts(fact_id),
    subject_ref TEXT NOT NULL,
    work_key    TEXT NOT NULL,
    cycle       INTEGER NOT NULL CHECK (cycle >= 1),
    act         TEXT NOT NULL CHECK (act IN ('reading','reflection')),
    xp          INTEGER NOT NULL CHECK (xp >= 0),
    pm          INTEGER NOT NULL CHECK (pm >= 0),
    PRIMARY KEY (fact_id, work_key)
);
CREATE UNIQUE INDEX ux_gm_cycle_reading ON gm_work_cycles(subject_ref, work_key, cycle) WHERE act = 'reading';
CREATE UNIQUE INDEX ux_gm_cycle_pm      ON gm_work_cycles(subject_ref, work_key, cycle) WHERE pm > 0;
-- gm_work_cycles: append-only, con el mismo patrón de triggers
```

**Por qué renombrar y no reconstruir:** `RENAME COLUMN` conserva triggers y CHECK sin copiar datos.

**Aplicación:** la migración aborta si alguna tabla `gm_` tiene filas. La base no existe en producción. Si alguien la creara antes, esta unidad se detiene: no se migran identificadores reales sin procedimiento propio.

**Mismo archivo para `gm_subjects`:** se necesita en la misma transacción. Separarlo exigiría `ATTACH`, sin atomicidad en WAL. La consecuencia es que el backup contiene el vínculo, lo que cubre la puerta de restauración.

---

## 2. Cambios de código

| Archivo | Cambio | Unidad |
|---|---|---|
| `db.mjs` | `PRAGMA secure_delete = ON` | 01B |
| `subjects.mjs` (nuevo) | `resolveSubject`, `sourceKey`, `workKey`, `isErased`. Único módulo que toca `user_id` | 01B |
| `ledger.mjs` | `subjectRef` en vez de `userId`; ids aleatorios; día en vez de ms; sin filas para hechos sin efecto | 01B |
| `reconcile.mjs`, `mookSource.mjs` | Resolver sujeto en memoria; comprobar tombstone; `source_key` | 01C |
| `erasure.mjs` (nuevo) | Procedimiento idempotente de §4.2 | 01D |
| `scripts/gamification/replayErasures.mjs` (nuevo) | Puerta de restauración | 01D |
| `experienceStore.js` | Validar `config.recognition` al publicar | 01E, **toca MOOK** |
| `recognition.mjs` | Conectarlo a `recordFact` con `gm_work_cycles` | G4-05 |

**Secretos:** `pepper` en archivo, nunca en argumentos ni repositorio, con respaldo separado.

**Sin cambios:** `progress.db`, `events.db`, padrón, autenticación, regalías, acceso, WooCommerce y vínculo adulto-menor.

---

## 3. Secuencia

| Unidad | Alcance | Datos reales | Bloqueada por |
|---|---|---|---|
| **PRIV-01B** | Migración `0002`, `subjects.mjs`, ledger sin `user_id`, ids sin tiempo, día, `secure_delete` | No: base temporal | Aprobación del modelo de sujeto |
| **PRIV-01C** | Reconciliador y ganchos con sujeto, sin filas para sintéticas ni rechazos | No | 01B |
| **PRIV-01D** | Supresión, tombstones, acuse, puerta de restauración | No | 01C; custodia del registro |
| **PRIV-01E** | `config.recognition`, validado al publicar | No | Regla editorial de obra; autorización de tocar MOOK |
| **G4-05** | Conectar el núcleo: `gm_work_cycles`, techo de XP, unicidad de PM | No | 01C, 01E |
| **OPS** | `forget/prune`, expiración de archivo | **Sí**, operación aparte | Autorización humana |
| **PILOTO** | Primera escritura real | **Sí** | DPIA, PRIV-4/5/6, OPS, todo lo anterior |

Las unidades 01B a 01E no tratan datos personales reales.

---

## 4. Plan de pruebas

Con bases temporales, usuarios sintéticos y el guard de SAFE-01.

| # | Prueba | Unidad |
|---|---|---|
| T1 | Ninguna columna `gm_`, fuera de `gm_subjects.user_id`, contiene un `user_id` conocido, tras un flujo completo | 01B |
| T2 | Bytes del archivo y WAL sin `user_id` tras suprimir | 01D |
| T3 | Dos procesos crean el mismo sujeto: una fila, misma referencia | 01B |
| T4 | `source_key` distinto entre sujetos para el mismo hecho | 01B |
| T5 | Ningún id incrusta tiempo; fechas solo día | 01B |
| T6 | Idempotencia, topes, compensaciones e I1–I6 sin regresión | 01B |
| T7 | Sintética, inactiva o inexistente: 0 filas, también por reconciliador | 01C |
| T8 | **Supresión + barrido: ninguna fila nueva** | 01D |
| T9 | Supresión repetida: mismo resultado | 01D |
| T10 | Ledger íntegro tras suprimir; `verifyLedger` en verde | 01D |
| T11 | **Restaurar copia anterior + replay: tombstones aplicados, sin sujetos** | 01D |
| T12 | Restaurar sin replay: gamificación no se activa | 01D |
| T13 | `single`, `multi`, `general`, sin declaración, versión antigua y `ACTIVITY` declarada comprensión | 01E |
| T14 | Dos procesos sobre `ux_gm_cycle_pm`: un PM. Sobre techo de XP: sin exceso | G4-05 |
| T15 | Ninguna inferencia de obra por título o texto | 01E |
| T16 | Logs sin `user_id` ni `subject_ref` en gamificación | 01C |
| T17 | Ninguna respuesta HTTP expone `subject_ref` o `work_key` | Con endpoints |

**Comprobación ya realizada en PRIV-01A:** sin `secure_delete` el id quedó legible en el archivo; con `secure_delete` y checkpoint, no.

---

## 5. Riesgos

| Riesgo | Severidad | Mitigación | Residual |
|---|---|---|---|
| Reidentificación de filas desvinculadas | Alta | Sal, sin ms, sin features | Patrones de actividad; **[LEGAL]** |
| Copias con vínculos suprimidos | Alta | Puerta de restauración, `forget/prune` | Hasta expirar el último snapshot |
| Pérdida de `pepper` | Alta | Respaldo separado | Tombstones inservibles; registro externo como autoridad |
| Registro de supresiones perdido o alterado | Alta | Custodia fuera del conjunto restaurado | **[DIRECCIÓN]** |
| Supresión parcial del sistema | Alta | Gamificación cubre lo suyo | `mook_db`, progreso, eventos y Leo siguen sin vía (COMP-07/08) |
| Sal por sujeto impide estadísticas por obra | Baja | Aula Viva | Aceptado |
| Poca evidencia MOOK elegible | Media | Nuevas versiones con `recognition` | Equidad: empeora la asimetría de XP |
| Bloquear por tombstone impide volver a participar | Media | Nueva cuenta o decisión de Legal | **[LEGAL]** |
| Coste del barrido con HMAC | Baja | Sujeto en memoria por lote | Medir en 01C |
| Migrar sobre datos existentes | Alta | La migración aborta con filas | — |

**Dependencia más importante:** suprimir solo en gamificación no satisface una solicitud completa. El titular seguiría presente en `mook_db.json`, `progress.db`, `events.db`, `leo_*` y el padrón. La vía transversal de supresión (COMP-07) debe resolverse antes del piloto, aunque está fuera de esta familia de unidades.

---

## 6. Condiciones GATED para la primera escritura real

1. DPIA aprobada, con base y aviso (PRIV-6).
2. Modelo de sujeto aprobado y aplicado (PRIV-4).
3. Supresión y restauración probadas (PRIV-5), con custodia asignada.
4. `forget/prune` y expiración de archivo ejecutados, o plazo real documentado.
5. Vía transversal de supresión (COMP-07 y COMP-08) definida.
6. Regla editorial de obra y `recognition` en las versiones elegibles.
7. Valores configurables calibrados y aprobados (A7, A12).
8. Owner y comité (D50).

**Decidir el modelo de sujeto no puede esperar a la DPIA completa:** PRIV-01B solo es barata mientras no haya datos. Por eso se propone aprobar la dirección técnica ahora, con validación jurídica final antes de cualquier activación.
