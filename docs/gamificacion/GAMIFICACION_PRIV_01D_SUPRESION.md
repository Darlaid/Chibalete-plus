# GAMIFICACION-PRIV-01D: supresión y no recreación

**Fecha:** 2026-10-30 · **Base:** `ebb5181` (PRIV-01C publicado; CI en verde) · **Producción:** `g0-f4836d1`, sin cambios.
**Alcance:** bases temporales y usuarios sintéticos. **Ninguna supresión real:** `excludeUser` no tiene llamadores. Sin esquema nuevo, secretos ni configuración productiva.

**Es el control técnico, no el proceso de supresión completo:** solo cubre gamificación. El titular seguiría en `mook_db.json`, `progress.db`, `events.db`, Leo y el padrón (COMP-07/08).

## 1. Mecanismo

| Pieza | Función |
|---|---|
| `exclusions.mjs` | Tombstones, registro independiente y puerta |
| `erasure.mjs` | `excludeUser` y `replayExclusions` |
| `subjects.mjs` | `isExcluded`, `deleteSubject`. `ensureSubject` es el punto único de alta y rechaza a una persona excluida |
| `ledger.mjs` | La puerta precede a toda escritura; `extinguishSubject` |
| `reconcile.mjs`, `mookSource.mjs` | Puerta por barrido; `replayExclusions` antes de leer la fuente |

**Exclusión:** primero se escribe el registro, con `fsync`. Después, en una transacción `IMMEDIATE`, se anota `gm_erasures`, se extingue el saldo con una compensación auditada y se borra `gm_subjects`. Sin la sal, las claves ya no se pueden recalcular. El ledger conserva sus filas y sigue cuadrando. Un canje abierto impide excluir.

**El tombstone** es `HMAC(clave de exclusión, user_id)`. No guarda identidad ni actividad; `gm_erasures` solo tiene id, tombstone, día y referencia opaca. Sigue siendo un dato seudónimo: su conservación es **[LEGAL]**.

**Carrera entre réplicas:** la puerta se lee fuera de la transacción, así que `recordFact` vuelve a consultar `gm_erasures` dentro de ella. Una ingesta que llega antes queda desvinculada; una que llega después es rechazada.

## 2. Registro y puerta de restauración

El registro es un archivo append-only, con una línea autenticada por exclusión. Su ruta es `GAMIFICATION_EXCLUSION_REGISTRY`: **sin valor por defecto, y no puede estar en el directorio de `gamification.db`**. No figura en el inventario de respaldos.

| Situación | Efecto |
|---|---|
| Sin ruta, archivo ausente, línea alterada o incompleta | `EXCLUSION_REGISTRY_UNAVAILABLE`: ingesta bloqueada |
| Mismo directorio que la base | `EXCLUSION_REGISTRY_NOT_INDEPENDENT`: bloqueada |
| Registro con exclusiones que la base no tiene (restauración o caída) | `EXCLUSION_REPLAY_REQUIRED`: bloqueada hasta reaplicar |
| Base con exclusiones que el registro no tiene (registro retrocedido) | `EXCLUSION_REGISTRY_STALE`: bloqueada, sin reparación automática |

`runMookReconcileOnce` reaplica antes de leer la fuente. Ganchos e ingesta directa solo comprueban: no reaplican.

**Los hechos que no pueden emitir no consultan el registro.** Con flags OFF o fuente bloqueada no hay escritura posible.

## 3. Separación criptográfica

Tres derivaciones con etiqueta propia desde la clave de servidor: `gm-subject-v1`, `gm-exclusion-v1` y `gm-exclusion-registry-v1`. Sus salidas son independientes, y la verificación de supresiones no puede usarse para derivar claves del ledger ni al revés.

**Límite:** es separación de dominio, no dos secretos. Si la clave de servidor se compromete, caen ambas. **Rotarla invalidaría los tombstones y dejaría de reconocer a las personas excluidas.** La rotación requiere su propia unidad, y un secreto separado requeriría aprobación.

## 4. Antes de activar

No se creó nada de esto:

1. Ruta del registro en un volumen que no se restaure con los respaldos, con **copia propia**: si se pierde, la ingesta queda bloqueada, y si se recrea vacío, `EXCLUSION_REGISTRY_STALE` lo detecta solo si la base conserva tombstones.
2. Custodia del registro **[DIRECCIÓN]**.
3. Archivo de clave de servidor.
4. Decisión jurídica sobre tombstones y filas desvinculadas **[LEGAL]**.
5. Procedimiento para la solicitud del titular, incluida la vía transversal COMP-07/08.

**Límite de detección:** si base y registro se restauran juntos desde copias antiguas, ambos coinciden y una exclusión posterior se perdería sin alarma. Por eso el registro no debe entrar en la misma rutina de respaldo.

## 5. Deuda bloqueante para la activación: reconciliación síncrona

`reconcile` corre de forma síncrona en el proceso de la API. Medido en PRIV-01C: 3 a 6 ms por hecho registrado y unos 65 µs por candidato sin novedad. Un primer barrido de 20 000 hechos tardó 112 s en Windows, con la réplica bloqueada.

**Ninguna activación con volumen debe hacerse hasta resolverlo.** La unidad de rendimiento debe permitir procesar por lotes e interrumpir de forma controlada, sin infraestructura adicional salvo necesidad demostrada. No se modificó aquí.

PRIV-01D añade una lectura del registro por barrido y una comprobación por hecho que puede emitir; `replayExclusions` calcula un tombstone por sujeto en cada barrido.

## 6. Pruebas

- `exclusion.test.mjs`: 62 ✓. Cinco controles negativos detectados; uno de ellos no era válido en Windows y se repitió con una mutación correcta.
- Dos pruebas estructurales de `ledgerCore` se ajustaron a propósito: `exclusions.mjs` es la segunda excepción de escritura, limitada a añadir, con prueba propia.
- `commercialClassHttp` sigue intermitente: 2 de 8 aquí, 3 de 8 en `e16bc9d`. No lo toca esta unidad.
- `test:store-isolation` sigue en rojo en local por `test:identity`, sin stores alterados.
