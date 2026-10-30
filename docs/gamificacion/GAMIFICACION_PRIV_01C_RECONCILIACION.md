# GAMIFICACION-PRIV-01C: fuentes MOOK y reconciliación sobre el sujeto

**Fecha:** 2026-10-30 · **Base:** `8c62618` (PRIV-01B cerrado en CI) · **Producción:** `g0-f4836d1`, sin cambios.
**Alcance:** bases temporales y usuarios sintéticos. Sin flags activos, secretos productivos, supresión ni WooCommerce.

## 1. Cambios

| Archivo | Cambio |
|---|---|
| `reconcile.mjs` | `sourceEventId` de ruta = versión, sin `userId`. Solo candidatos `aprobado`, sin `features`. `candidateEligibility` comprueba sujeto y actor |
| `mookSource.mjs` | Usa `candidateEligibility`; logs con código, sin mensaje de error |
| `ledger.mjs` | `FEATURE_ALLOWLIST`: `mook_review` y `mook_experience` vacías; lectura solo `verdict`. Salida temprana sin transacción |
| `policy.mjs` | `isEmissionLocked` |

`userId` viaja solo en memoria, para resolver al sujeto. La tabla `gm_subjects` sigue siendo accesible únicamente desde `subjects.mjs`.

**Decisión conservadora:** un candidato con revisor inexistente, sintético o inactivo no es elegible. Así no se crean sujetos para actores que no deberían tenerlos. La consecuencia es que una revisión hecha por alguien que después se dio de baja deja de reconocerse.

## 2. Salida temprana

Los hechos sin emisión no dejan fila y se reevalúan en cada barrido. Por eso `recordFact` responde sin abrir transacción si el sujeto no es elegible, si la fuente está bloqueada o si ambos flags están apagados. Sin esto, cada barrido tomaría el lock de escritura una vez por revisión.

## 3. Coste de barridos

Windows, disco local, `synchronous=FULL`, base temporal. Mitad revisiones (no emiten), mitad rutas.

| Candidatos | Primer barrido | Sin novedades | Solo revisiones |
|---|---|---|---|
| 1 000 | 1,6 s | 74 ms | 41 ms |
| 10 000 | 15,6 s | 0,7 s | 0,35 s |
| 40 000 | 112 s | 2,6 s | 1,4 s |

- **Sin novedades:** unos 65 µs por candidato, lineal.
- **Primer barrido:** entre 3 y 6 ms por hecho registrado, por `fsync` de cada transacción.
- **Riesgo:** `reconcile` es síncrono y corre en el proceso de la API. Un primer barrido grande **bloquea esa réplica** durante toda su duración, y uno sin novedades lo hace unos segundos cada 15 minutos a gran escala.
- **Límite de la medición:** no se midió en Linux ni en el VPS, ni con lectura real de `mook_db.json`.
- **Sin mitigar a propósito:** no se autorizaron colas, caches ni tablas. Antes de una activación con volumen hay que trocear el barrido o moverlo fuera de la réplica. El corte `GAMIFICATION_MOOK_SINCE` acota el primer barrido.

## 4. Pruebas

- `subjectReconcile.test.mjs`: 50 ✓. Cinco defectos introducidos a propósito hicieron fallar la suite.
- Dos réplicas: `mookSource` [5] y `ledgerConcurrency` [4], con lock entre réplicas y sin duplicados.
- Caída a mitad de barrido: `ledgerConcurrency` [5].

## 5. Riesgos y condiciones para PRIV-01D

- **`mook_review` sigue sin emitir:** no hay `workRef`.
- **La supresión no existe:** tras borrar una fila de `gm_subjects`, un barrido crearía otro sujeto con su historial MOOK si la cuenta sigue activa. PRIV-01D necesita el tombstone antes de permitir cualquier borrado.
- **Inferencias:** nada deriva obras ni ciclos; `deriveWorkKey` sigue sin consumidores.
- **`hasFact` antes de `recordFact`:** es una lectura sin transacción; una carrera entre réplicas la resuelve `recordFact`.
- **Futuras recompensas y cupones:** el diseño conserva `subject_ref` como única referencia del ledger. Nada de cupones se implementó.

**Condiciones para PRIV-01D:** custodia del registro de supresiones, tratamiento jurídico del tombstone, decisión sobre el secreto para el tombstone (hoy, la misma clave de servidor) y orden de reaplicación tras un restore.
