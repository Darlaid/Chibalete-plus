# GAMIFICACION-PRIV-01B: modelo de sujeto y adecuación del ledger

**Fecha:** 2026-10-30 · **Base:** `e16bc9d` (PRIV-01A publicado; CI en verde) · **Producción:** `g0-f4836d1`, sin cambios.
**Alcance:** bases temporales y usuarios sintéticos. Sin despliegue, flags activos ni datos reales. Implementa la parte de sujeto de [Modelo V1](GAMIFICACION_PRIV_01_MODELO_V1.md) §2 y §3.

## 1. Qué se implementó

| Pieza | Contenido |
|---|---|
| `migrations/0002_subject_model.sql` | 12 columnas renombradas; `gm_subjects`, `gm_erasures` y `gm_work_cycles`. Aborta con cualquier fila en las 10 tablas de `0001` |
| `subjects.mjs` | Único módulo que toca `gm_subjects`: `findSubject`, `ensureSubject`, `deriveSourceKey`, `deriveWorkKey` |
| `subjectKey.mjs` | Clave de servidor en `/app/secrets/gamification_subject_key` |
| `ledger.mjs` | La API sigue recibiendo `userId`, pero solo persiste `subject_ref`. Ids aleatorios, fechas de día, sin fila para hechos sin emisión, `hasFact` |
| `db.mjs` | `secure_delete = ON` |
| `intake.mjs`, `reconcile.mjs`, `mookSource.mjs` | Solo compatibilidad: versión de migración, `hasFact`, recuento y carga de la clave. **La adaptación real es PRIV-01C** |

`gm_erasures` y `gm_work_cycles` están creadas e inertes, según el contrato aprobado. La supresión y los tombstones son PRIV-01D; `deriveWorkKey` y los ciclos, G4-05.

## 2. Claves y secretos

- `subject_ref`: 128 bits aleatorios. No es un hash de `user_id`.
- `subject_salt`: 32 bytes aleatorios por sujeto.
- Secreto del sujeto: `HMAC(clave de servidor, sal)`. Sin la clave de servidor, una copia de la base no permite derivar nada.
- `source_event_id`: `HMAC(secreto, 'source', fuente, tipo, id)`.

**Clave de servidor:** usa `readSecretFile`, el lector estricto existente: archivo 0400, sin symlinks y con 32 bytes como mínimo. Sin entorno, sin ruta configurable, sin valor por defecto. Si falta, `recordFact`, ajustes, compensaciones y altas lanzan `SUBJECT_KEY_UNAVAILABLE`; los ganchos desisten y **no se escribe nada**.

**La clave se mantiene en memoria,** a diferencia de los demás secretos, que se releen en cada uso: `recordFact` es síncrono y `readSecretFile` no. Se carga al arrancar el reconciliador.

**Antes de activar en producción hay que crear ese archivo.** Hoy no existe. Rotar la clave invalida todas las claves derivadas y necesita su propia unidad.

## 3. Cambios de comportamiento

| Antes | Ahora |
|---|---|
| `observed`, `rejected_*` y `disabled_source` dejaban fila | Sin fila ni sujeto. `recordFact` devuelve `persisted: false` |
| Mismo id con otro sujeto: `IDEMPOTENCY_CONFLICT` | Son hechos distintos: las claves no se cruzan entre sujetos |
| Regla aplicada aunque el hecho fuera anterior | D48: un hecho anterior a la vigencia de la regla no emite. Necesario porque ya no queda fila |
| Barrido contaba reintentos como `raced` | Los hechos sin fila solo cuentan en `byDecision` |

Consecuencia: un barrido reevalúa los hechos sin fila en cada pasada. Es idempotente, pero tiene un coste que debe medirse en PRIV-01C.

## 4. Pruebas

- `subjectModel.test.mjs`: 71 ✓. Cinco defectos introducidos a propósito hicieron fallar la suite.
- `ledgerConcurrency`: 4 procesos en arranque simultáneo aplican `0001` y `0002`; 2 réplicas sobre el mismo sujeto dan una sola fila.
- `ledgerBackupRestore`: captura con `capture_sqlite` real, incluye `gm_subjects`.
- El lector real de secretos requiere POSIX: se ejecuta en CI, no en Windows.

**Runner de backups:** GM01–GM04 aplican las migraciones reales, así que `0002` rompía su fixture. Se actualizó `tests/test_suite.py` (solo la prueba, sin tocar el runner). Las funciones del fixture se ejecutaron aisladas en Windows; la suite completa requiere `ubuntu:24.04` y la cubre el workflow `backup-capacity` al publicar.

## 5. Riesgos de reidentificación

- `subject_ref` sigue siendo **seudónimo**: quien tenga `gm_subjects` resuelve la identidad.
- `gm_subjects` está en el mismo archivo que el ledger y entra en los backups.
- Las secuencias de `seq` y las fechas de día siguen describiendo actividad.
- `features_json` puede guardar `decision` en `mook_review`, y `verdict` y métricas en lectura. Ninguna fuente emite hoy con esos datos. Vaciar esas listas corresponde a PRIV-01C.
- `role_class` conserva la primera clase del sujeto, aunque una misma persona actúe como lector y mediador.
- Reintentos tras borrar a un sujeto: sin PRIV-01D, un nuevo hecho crearía otro sujeto. Por eso la supresión no está disponible.

## 6. Condiciones para PRIV-01C

1. Aprobación jurídica del modelo sigue pendiente; esta unidad no la sustituye.
2. Reducir `FEATURE_ALLOWLIST` a lo aprobado en Modelo V1 §3.
3. Adaptadores MOOK: id de fuente sin `userId`, aunque hoy solo entra en el HMAC.
4. Sin filas para sintéticas e inactivas en todos los caminos, y logs sin identificadores.
5. Medir el barrido.

## 7. Intermitente preexistente

`commercialClassHttp` falló en la aserción `hora del servidor, no del cliente`: 3 de 8 corridas en `e16bc9d` y 0 de 8 en esta unidad, aunque también falló alguna vez aquí. No toca código de esta unidad. Sin causa determinada, y corta la cadena `test:royalties` cuando ocurre.
