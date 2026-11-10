# V8.1-CLOSE-09B: regresiones de supresión y seguridad operativa

**Fecha:** 2026-11-10.
- **Base:** `c4a062b`, publicado por fast-forward (`112b6d8..c4a062b`).
- **Sin despliegue, sin XP y sin supresiones reales.** No se han tocado `data/`, `data-critical/`, uploads, recursos editoriales ni respaldos. No se ha modificado WooCommerce, ningún documento jurídico ni ninguna regla de XP. Las imágenes definitivas todavía no se han construido.

## 1. Reenvío B2C (`server/b2c/b2cProvisioning.mjs`, `planUserPhase`)

**Defecto (CLOSE-09A §7):** un reenvío firmado del mismo pedido encontraba la regla conservada sin titular. La fase 1 creaba una cuenta invitada nueva, con el correo y el nombre del pedido, y la fase 2 respondía 409.

**Corrección:** una sola condición, evaluada **antes** de crear o invitar. Si la regla del pedido existe y lleva la constancia de supresión (`b2c.suppressedAt`), o si su titular ya no está en el padrón, la respuesta es `409 account_not_available`.
- **Código:** es el mismo que ya recibe la tienda para una cuenta deshabilitada, así que el contrato con WooCommerce no cambia.
- **Respuesta:** la misma con cualquier correo; sin id, sin enlace y sin datos del titular.
- **Ventana entre la baja y el operador:** también la cubre. Basta con que la cuenta ya no exista.
- **Pedido nuevo:** tiene otra regla (el id va por pedido) y se aprovisiona como siempre, tanto si es de la misma persona como de otra. Los reintentos de una cuenta viva siguen dando `already_activated`.
- **El reembolso** (`/api/b2c/revoke`) del pedido suprimido sigue funcionando.

## 2. Leo: escritores coordinados con la supresión

**Escritores identificados:**

| Escritor | Antes | Ahora |
|---|---|---|
| `leoMemoryService`: sesión, perfil, `recordInteraction` | RMW síncrono **sin lock** | RMW bajo el mismo lock del archivo (`withFileLockSync`) |
| `leoEvidenceService.persistLeoEvidence` | RMW síncrono **sin lock** | Ídem |
| `server.js`, `POST /api/leo/memory` | Con lock | Con lock |
| `server.js`, interacciones de `/api/leo/ask` | Con lock, pero leía la **caché JSON de 30 s** dentro del lock: otra réplica podía reescribir la lista antigua con la persona dentro | Con lock y sin caché dentro del lock |

**Mecanismo, reutilizando lo que ya existe:**
- **Mismo lock:** `usersLock.js` gana `withFileLockSync`, la variante síncrona del mismo lock: mismo archivo `<db>.lock`, mismo O_EXCL, misma caducidad y mismo timeout. Lo comparten el operador y `server.js`.
- **Mismo control:** dentro del lock solo se escribe la entrada de una persona que **sigue en el padrón**. El operador exige la baja antes de suprimir. `server.js` registra ese control (`setLeoSubjectGuard`) leyendo el padrón canónico, con caché por mtime, tamaño e inodo, y nunca la caché de 30 s.
- **Resultado:** ninguna petición en curso que termine después de la baja reintroduce a la persona, y no se pierden escrituras de otras personas.
- `leoMemoryService` respeta `CHP_DATA_DIR` igual que `server.js`. En producción no está definido, así que la ruta sigue siendo `../data`, como antes.

## 3. `insights.db`

**Tratamiento por columna**, sin una lista fija de tablas, dentro de la misma operación de supresión y de su reaplicación tras restaurar:
- **Filas personales:** se eliminan las que tienen `user_id` o `student_id` de la persona, o ámbito `user` (`scope_type`/`scope_level`). Por ejemplo, perfiles de lectura, vectores, riesgo, intervenciones, resultados, pertenencia a cohortes, snapshots y rollups personales.
- **Referencias en otras filas:** el `teacher_id` y las apariciones de su id dentro de JSON o notas pasan a `suppressed-subject`.
- **Agregados de grupo, colegio u organización:** no se tocan. La prueba compara su huella (todas las columnas no JSON) antes y después.

**Pendiente:** con cohortes muy pequeñas, un agregado podría seguir permitiendo inferir datos de la persona. Fijar un tamaño mínimo de cohorte es una decisión pendiente y no se declara anonimización.

## 4. Seguridad SQLite: supresión lógica y compactación separadas

**Qué se verificó:** en CLOSE-09A, el operador ejecutaba `VACUUM` y `wal_checkpoint(TRUNCATE)` dentro de la supresión. **No es seguro por defecto:**
- `VACUUM` toma el lock de escritura durante toda la reconstrucción, y las réplicas esperan su `busy_timeout`;
- necesita espacio para una copia temporal y para el WAL;
- `TRUNCATE` bloquea a los escritores nuevos mientras espera a los lectores.

**Supresión lógica:**
- Ya no compacta.
- Con `secure_delete`, lo que borra o reescribe el operador queda sobrescrito con ceros.
- Cierra con un checkpoint `PASSIVE`, que nunca bloquea.
- El acuse marca `compactionPending`.

**Compactación** (`compactAfterSuppression`, operador `{"compact":true}`):
- Es una operación aparte, nunca por defecto. Se ejecuta en la cuarentena antes de promover, o en una ventana controlada.
- **Antes:** verifica el espacio libre (al menos 2,5 × base+WAL en su directorio y el tamaño de la base en el temporal) y ejecuta `quick_check`.
- **Después:** `quick_check` y recuento de filas por tabla iguales a los de antes.
- **Bases afectadas:**
  - `progress.db`, `identity.db` e `insights.db`: `VACUUM` y checkpoint `TRUNCATE`;
  - `events*`: solo checkpoint `TRUNCATE`, porque sus filas nunca se reescriben.

**Comprobado con datos sintéticos:**

| Caso | Resultado |
|---|---|
| Base ocupada por un escritor (`BEGIN IMMEDIATE`) | `busy`, sin cambios, `quick_check` ok |
| Espacio insuficiente | `insufficient_space`, archivo idéntico (SHA-256) |
| Con las dos réplicas abiertas | `compacted`; datos no suprimidos idénticos; las réplicas siguen leyendo y escribiendo |
| SIGKILL a 40, 120 y 250 ms del inicio del proceso | Base íntegra, con el mismo número de filas y la misma suma de longitudes. Una compactación posterior termina bien |
| Tras compactar | Ninguno de los cinco SQLite conserva bytes del rastro ni del correo |

En la prueba de interrupción, el proceso puede morir antes de empezar el `VACUUM`. La garantía de fondo es que `VACUUM` es transaccional.

**Transacciones de escritura del operador:** `BEGIN IMMEDIATE` en eventos, `insights` e identidad.
- **Hallazgo en Linux:** con dos procesos conciliando a la vez, una transacción diferida que lee el esquema y luego escribe recibía `SQLITE_BUSY` al instante, sin esperar el `busy_timeout`, si otro proceso había escrito entretanto.
- **Corrección:** con `IMMEDIATE`, el lock se pide al principio y la espera funciona.

**Entre la supresión lógica y la compactación,** los bytes antiguos que dejaron las réplicas siguen en el archivo, aunque la aplicación no puede leerlos. El procedimiento exige compactar en la cuarentena antes de promover una restauración. En producción, en una ventana controlada.

## 5. Pruebas

**`suppressionResidualHttp`:** 67/0, estable en todos los entornos:
- tres ejecuciones seguidas en Windows;
- dos en Linux, unos 30 s cada una, con el árbol copiado dentro del contenedor;
- también sobre la imagen.

La prueba de interrupción se suscribe a la salida del proceso hijo en el momento de lanzarlo. En Linux la compactación puede terminar antes del SIGKILL. Cubre §1–§4, la restauración en cuarentena (con compactación antes de promover) y dos réplicas.

**Concurrencia real de Leo:**
- dos procesos escriben sin pausa durante 5 s mientras se elimina y se suprime a una persona;
- después de la supresión no queda ninguna entrada suya;
- el contador y la evidencia de otra persona suman exactamente las escrituras de los dos procesos, sin pérdidas;
- no hay escrituras descartadas.

**Hallazgo de Windows:** abrir con O_EXCL un `.lock` en borrado pendiente devuelve `EPERM`/`EACCES`. El lock síncrono lo reintenta. El asíncrono existente no se toca, porque en Linux no ocurre.

**`b2cProvisioning.integration`:** sección [11] por HTTP firmado. `test:b2c` da **77/0** en Linux como root.

**Imagen de laboratorio `chp-lab/api:09b`** (no es un artefacto):

| Prueba | Resultado |
|---|---|
| Operador real (incluye `{"compact":true}`) | 22/0 |
| `suppressionResidualHttp` | 67 |
| `suppressionRestoreHttp` | 18 |
| `rightsLifecycle` | 27 |
| B2C unit | 42 |
| `a2Registry` | 34 |
| `mediatorValidityHttp` | 14 |
| `mookReviewIdentity01a` | 30 |
| `xpA1Eligibility` | 23 |
| `workRecognition` | 120 |
| `leoMemoryOwnership` | 72 |
| `o8Check` | 27 |
| O8 inerte | OK |

**Nota de entorno:** en Docker Desktop sobre un bind mount de Windows, el servidor tarda unos 24 s en arrancar. Eso explicaba los rojos «de entorno» de CLOSE-09A (`auth-reset`, `mookWorkAccess`). Con el árbol copiado dentro del contenedor dan 21/0 y 71/0. `test:library` mantiene **1** aserción ajena (`/api/content` no-store), que también falla sobre la base limpia.
