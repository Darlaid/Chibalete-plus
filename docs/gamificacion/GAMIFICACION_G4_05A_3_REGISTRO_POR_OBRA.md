# GAMIFICACION-G4-05A-3: registro por obra y ciclo

**Fecha:** 2026-10-31 · **Base:** `4d8f629` · **Producción:** sin cambios.
**Alcance:** conectar evidencias MOOK elegibles con `gm_work_cycles` por el ledger. Sin importes, flags activos, XP ni PM. Solo funciona con `XP_EARNING_ENABLED`, que sigue OFF.

## 1. Sin cifras aprobadas: registro sin importes

`decideRecognition` exige una configuración numérica, y A7 y A12 no tienen valores. No se inventaron: `recordWorkRecognition` usa una configuración interna **toda en cero** solo para obtener actos y ciclo. Para MOOK el ciclo no depende de A7, porque solo un recorrido nuevo abriría otro y MOOK no lo declara.

| Garantía | Cómo |
|---|---|
| Sin XP ni PM | Nunca escribe en `gm_xp_entries`, `gm_pm_movements` ni `gm_pm_balances` |
| Importes rechazados | Un acto distinto de cero aborta con `AMOUNT_WRITER_NOT_CONNECTED` |
| Bloqueos intactos | `mook_review` sigue en `PM_LOCKED_SOURCES` y `XP_LOCKED_SOURCES`; `recordFact` no cambia |
| Sin cifras nuevas | `validateRules` no se amplió |

**El escritor monetizable sigue sin conectar.** Conectar importes es una unidad posterior.

## 2. Fuente de derechos

`rightsStore.readWithdrawnWorks()` abre `royalties.db` con `readonly` y `fileMustExist` y reutiliza `rightsIndex`. No usa `getRoyaltiesDb`, que crea el archivo y migra.

| Estado | Efecto |
|---|---|
| `active`, sin régimen, versión futura o licencia vencida | No bloquea |
| `suspended`, `revoked`, `disputed` | Evidencia pendiente |
| Archivo ausente, esquema ilegible o error | Pendiente: no verificable |

La consulta ocurre una vez por barrido o gancho, **al reconocer**. Lo pendiente se reevalúa en cada barrido, así que una suspensión levantada lo libera. Una retirada posterior no revierte lo ya registrado.

## 3. Contrato de reconocimiento

```text
aprobada → obra (resourceRef) → workAccess congelado → retirada legal → sujeto y exclusión
        → decideRecognition (actos y ciclo) → hecho + gm_work_cycles
```

| Regla | Dónde |
|---|---|
| Solo aprobación real, corte y versión posterior | `resolveEvidenceWork`, `mookRecognitionEvidence` |
| Acceso sin recalcular | Solo se lee `evidence.workAccess` |
| Actos desde el servidor | Salen de `decideRecognition`; el llamador no aporta acto, ciclo ni montos |
| Autorrevisión | `decideRecognition` la rechaza |
| Sin obra en claro | `work_key` y claves HMAC por sujeto |

**Transacción:** `BEGIN IMMEDIATE` comprueba exclusión y hecho previo, lee el historial de esa obra, decide y escribe el hecho y sus actos juntos. Sin regla activa, o con la evidencia anterior a ella, no escribe.

**Actos:** la primera evidencia de una obra y ciclo da `reading` y `reflection`. Otra evidencia sobre la misma obra solo da `reflection`.

**Rutas:** el gancho de revisión corre después de la respuesta, por `scheduleOnHookDb`, y `intake.mjs` exige `0003`. El barrido `runMookReconcileOnce` recupera lo perdido.

**Hecho sin emisión:** queda con `decision='observed'`. Es una excepción acotada a la regla de PRIV-01C de no dejar fila sin emisión: aquí la fila es el registro de actividad. Solo existe con `XP_EARNING_ENABLED`.

## 4. Requisitos antes de activar

1. **El flag no puede encenderse antes de conectar importes:** una evidencia registrada a cero ya ocupa su clave y no recibiría XP después.
2. Aprobar A7 y A12 y ampliar `validateRules`.
3. `disputed` y `suspended` bloquean por decisión técnica: confirmar con Legal.
4. Sin selector en Studio, ningún nodo declara obra.
