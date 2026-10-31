# GAMIFICACION-G4-05A: STOP antes de implementar

**Fecha:** 2026-10-31 · **Base:** `757280e` · **Producción:** sin cambios.
**Resultado:** **no se implementó.** Sin cambios de código, esquema, flags ni datos. El encargo pedía detenerse y presentar la modificación mínima si no se podía garantizar la misma decisión de acceso ante reintentos, y ese es el caso.

## 1. Recorrido auditado

| Paso | Estado | Pieza |
|---|---|---|
| Evidencia aprobada | Listo | `mookReviewCandidates` |
| Obra canónica | Listo | `resolveEvidenceWork` (PRIV-01E) |
| Autorización | **Bloqueado** (§2) | `decideContentAccess` |
| Sujeto seudónimo | Listo | `subjects.mjs`, exclusiones |
| Reconocimiento | Listo, puro y sin conectar | `decideRecognition` |
| Ledger | **Bloqueado** (§3) | `recordFact`, `gm_work_cycles` |
| Parámetros | **Sin aprobar** (§4) | `gm_rule_sets` |

## 2. Bloqueo de acceso

`decideContentAccess` responde sobre el **ahora**. El motivo no es que el reconciliador sea síncrono: hacerlo asíncrono no lo resuelve.

- **Sin consulta histórica:** usa `Date.now()` y no admite una fecha de referencia.
- **Sin historial:** `POST /api/access` reconstruye y sobrescribe la regla; también cambian grupos, membresías y `schoolConfig`.
- **Una denegación no deja fila** (PRIV-01C), así que se reevalúa en cada barrido.

**Comprobado con `server.js` real y stores sintéticos.** Misma regla de usuario, vencida entre dos consultas y sin ninguna escritura en `access_db.json`:

| `ACCESS_FALLBACK_MODE` | Antes de vencer | Después de vencer |
|---|---|---|
| `restricted` | `200 allowed=true` | `403 allowed=false` |
| `open` | `200 allowed=true` | `200 allowed=true`, por fallback legacy |

**Tratamientos incompatibles para un mismo evento:**

| Situación | Con gancho | Gancho perdido, recupera el barrido |
|---|---|---|
| El acceso vence tras la aprobación | Reconocida | Sin reconocimiento |
| Sin acceso al aprobar, renovado después | Denegada y reevaluada | **Reconocida con efecto retroactivo** |
| Regla revocada y restaurada | Depende del momento del barrido | Depende del momento del barrido |

Un reinicio, un `SQLITE_BUSY` o el orden entre réplicas cambiaría el resultado. En modo `open` además una expiración no se distingue de un acceso legacy.

## 3. Bloqueo del ledger

`decideRecognition` produce **dos entradas para una evidencia aprobada**: `reading` y `reflection`, con el mismo `evidenceId` y la misma obra. `gm_work_cycles` tiene `PRIMARY KEY (fact_id, work_key)`: la segunda fila viola la clave.

Tampoco guarda la fecha que `resolveCycle` usa para el espaciado de relectura; se puede derivar del día de `gm_source_facts`, pero hay que decidirlo.

**Opciones:**

| Opción | Cambio | Coste |
|---|---|---|
| **A (recomendada)** | Migración `0003`: clave `(fact_id, work_key, act)`, sobre tabla vacía | Requiere aprobar el cambio de esquema |
| B | Una fila por evidencia | Pierde `obras_distintas` por `reading` y mezcla importes |

## 4. Parámetros sin aprobar

- **A12:** ningún valor aprobado para `reading`, `reflection`, `route` ni `xpCeilingPerWorkCycle`.
- **A7:** `windowDays` y `xpFactors` sin valor, y `validateRecognitionConfig` los exige.
- **`gm_rule_sets`:** `validateRules` rechaza claves nuevas. Hay que ampliar su esquema, sin cifras.

La configuración debe vivir en el conjunto de reglas: sin ella, `decideRecognition` responde `invalid_config` y no reconoce nada.

## 5. Modificación mínima propuesta: congelar la decisión

Registrar una vez, en la evidencia, la decisión tomada en el instante de referencia. Después nadie vuelve a consultar el acceso.

```js
evidence.workAccess = { workRef, decision: 'allowed' | 'denied' | 'indeterminate', at };
```

| Punto | Cambio |
|---|---|
| Ruta de entrega | `await decideContentAccess(...)` **antes** de `mutateMook`, solo en `PRODUCTION` con `resourceRef`. Un error da `indeterminate` y nunca bloquea la entrega |
| `submitEvidence` | Escribe el campo una vez. El reenvío lo conserva |
| `resolveEvidenceWork` | Sustituye `canAccess` por el campo: solo `allowed` concede. Sin campo, nada |
| Proyecciones | `workAccess` no sale al cliente ni al revisor |

**Efecto:** el reconciliador sigue síncrono, gancho y barrido leen lo mismo y un reintento no cambia nada. `indeterminate` es definitivo.

**Cambio de contrato:** es un campo aditivo en `mook_db.json`, sin migración. Las evidencias previas quedan sin reconocimiento.

**Decisiones que exige:**

| Decisión | Recomendación | Motivo |
|---|---|---|
| Instante del acceso | **Primera entrega** (`submittedAt`) | Es cuando el lector trabajó. Con la aprobación, un mediador lento haría perder el reconocimiento |
| Instante del corte | `reviewedAt`, el vigente | No cambia G3-03; versión y corte ya están probados |
| `ACCESS_FALLBACK_MODE=open` | Solo cuenta un `allowed` real; el fallback cuenta como `denied` | No premiar por ausencia de reglas. Exige que la decisión exponga su vía |

## 6. Orden para retomar

1. Dirección: autorizar §5 y elegir §3.
2. G4-05A-1: congelación de acceso, con pruebas de vencimiento, revocación e indeterminado.
3. G4-05A-2: migración `0003`, esquema de reglas sin cifras y escritura de XP en `recordFact`, con `PM_LOCKED_SOURCES` intacto.
4. Concurrencia real entre dos procesos (T14).
5. A7 y A12 antes de cualquier activación.

## 7. Fuera de esta unidad

Sin push de este documento, despliegue, merge ni flags. PM sigue bloqueado por código. G4-05B no se inició.
