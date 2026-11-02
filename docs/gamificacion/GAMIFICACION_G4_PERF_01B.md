# G4-PERF-01B — Reconciliador MOOK por lotes con cesión del event loop

**Fecha:** 2026-11-02. **Base:** `e0468ee` (G4-PERF-01A, CI 3/3 verde). **Estado:** local, sin push ni despliegue.
**Veredicto:** `GREEN_LOCAL_TARGET_PARTIAL`. El barrido ya no bloquea la API y decide exactamente igual que 01A. La meta de pausas < 100 ms a 20 000 evidencias se cumple en el barrido repetido y en p95/p99; el máximo del primer barrido depende de dos operaciones síncronas restantes (§5).

## 1. Diseño

Un solo camino de decisión, con dos conductores:

- `reconcile.mjs`: `reconcileSteps` (generador) contiene el cuerpo por candidato **sin cambios**; `reconcile()` lo recorre sin pausas con `drainSteps`.
- `mookWorks.mjs`: `attributedEvidence` (generador) atribuye una evidencia por paso, en el mismo orden; `mookRecognitionEvidence()` lo recolecta. Se conserva el índice `Map` de 01A (`contextIndex`, una vez por pasada).
- `mookSource.mjs`:
  - `recognizeMookWorksSteps`: atribuye y registra **intercalados**. La atribución completa ya no se calcula antes de registrar.
  - `sweepSteps`: `replayExclusions` → `readMook` → candidatos → reconciliación → registro por obra.
  - `runMookReconcileOnce`: conductor síncrono (compatibilidad, pruebas, ganchos).
  - `runMookReconcileBatched`: conductor por lotes. Corta por tiempo (`RECONCILE_SLICE_MS = 20`) o por pasos (`RECONCILE_SLICE_MAX = 500`) y cede con `setImmediate`.
  - `startMookReconciler` usa el conductor por lotes; `running` se mantiene durante todas las cesiones y `stop()` corta en la siguiente.

Cada `yield` cae **entre** transacciones: `recordFact` y `recordWorkRecognition` siguen siendo una transacción `IMMEDIATE` cada uno, ya cerrada al ceder. Probado: `db.inTransaction === false` en todas las cesiones.

Al reanudar tras una cesión se releen la puerta de exclusiones (`exclusionGate`) y los derechos (`readRights`). Una exclusión o una retirada legal posterior al inicio cuenta desde ese paso; `recordFact` y `recordWorkRecognition` mantienen su comprobación de exclusión dentro de la transacción. Si la puerta no valida (exclusión a medias en otra réplica), el barrido aborta cerrado y el siguiente lo retoma.

Sin cursor, archivo, cola, tabla ni memo nuevos. Un barrido cortado se repite entero; la idempotencia es la del ledger.

## 2. Lock

Mismo `O_EXCL` sobre `<base>.reconcile.lock` y mismo `LOCK_STALE_MS` (10 min). Modificación mínima:

| Antes | Ahora |
|---|---|
| Contenido: `pid` (en contenedores se repite: `pid 1`) | Testigo `pid:uuid` |
| Sin renovación (el barrido no cedía) | Cada cesión renueva el `mtime`, solo si el testigo sigue siendo el propio |
| Sin comprobación de propiedad | Testigo ajeno o lock ausente al ceder ⇒ `RECONCILE_LOCK_LOST` y se detiene |
| `unlink` incondicional al terminar | Solo borra un lock propio |

Reentrada en la misma réplica durante una cesión: `skipped: 'locked'` (síncrono y por lotes). Entre réplicas, igual.

**Corrección de 01B-CLOSE (renovación y liberación).** En `74495bd` la comprobación del testigo (lectura por ruta) y la operación (`utimes`/`unlink` por ruta) eran dos pasos. Si otra réplica daba el lock por obsoleto y lo reemplazaba entre ambos, el dueño antiguo renovaba el lock **nuevo** (y seguía creyéndose dueño) o lo **borraba**. `mookReconcileLock.test.mjs` lo reproduce con dos procesos reales: 3 ✗ con `74495bd` en Linux y en Windows. Contrato corregido, sin cambiar el mecanismo:

- `renewLock`: abre el lock, lee el testigo y renueva con `futimes` **por el mismo descriptor** (mismo inodo). Después confirma que la ruta sigue apuntando a ese inodo (`dev`+`ino`). Si lo reemplazaron entre medio, la renovación cae en el inodo desvinculado (inocuo) y devuelve `false` ⇒ `RECONCILE_LOCK_LOST` en ese mismo paso.
- `unlock` (corregido en 01B-LOCK-FINAL): renueva y confirma así, pero ya **no borra por ruta**.
  1. Aparta el lock con `rename` atómico a `<lock>.<testigo>.release`.
  2. Comprueba que lo apartado lleva **su testigo** (no basta con comparar inodos: sin un descriptor abierto, Linux reutiliza el número de inodo al instante).
  3. Si es suyo, borra ese nombre apartado.
  4. Si es ajeno (otra réplica lo sustituyó entre la confirmación y la liberación), lo devuelve con `link`, que falla si la ruta ya está ocupada y nunca pisa un lock creado entre medio. Después borra el nombre apartado.
  - El dueño sustituido conserva el mismo archivo y lo sigue renovando.
  - Si una tercera réplica ocupó la ruta en ese instante, su lock queda intacto y la segunda detecta la pérdida en su siguiente cesión.
  - Si falla el `rename`, el lock propio se queda y caduca en 10 min: solo se retrasa el siguiente barrido. La liberación ocurre siempre después de terminar el barrido, así que ninguna ruta de error deja a nadie barriendo sin lock.
- En Windows, un nombre con un descriptor abierto no se puede recrear: la toma concurrente falla y nadie queda con el lock (fallo cerrado). En Linux (producción) la toma ocurre y el lock nuevo queda intacto.

Con `80b357f`, la sustitución forzada entre la última confirmación y el `unlink` hacía que el dueño anterior borrara el lock del nuevo. Reproducido con dos procesos ([4b]): Linux 5 ✗ y Windows 1 ✗. Corregido: `mookReconcileLock` pasa 42/42, 10 de 10 ejecuciones en Linux, incluida la carrera de restitución con tres réplicas ([4c]).

**Salvaguarda estructural** (`ledgerCore.test.mjs`, [11]). La prohibición textual de `rename` en `mookSource.mjs` se sustituyó por comprobaciones sobre el código sin comentarios:
- exactamente un `rename`, `fs.renameSync(lockFile, aside)`, con `aside` derivado del lock;
- exactamente un `link`, `fs.linkSync(aside, lockFile)`;
- `unlinkSync` solo sobre `lockFile` o `aside`;
- `unlock` solo recibe `plan.lockFile`;
- ningún `rename`, `link` ni `unlink` fuera del código del lock;
- el código del lock no nombra stores, padrones, uploads ni respaldos.

Siguen intactas las demás aserciones, incluida la prohibición de `renameSync` y `unlinkSync` en el resto de `server/gamification`. Se verificaron tres mutaciones (renombrar la base, `rename` a otro destino y borrar un store) y todas hacen fallar la prueba.

Ventanas que quedan (documentadas, no cerradas; cerrarlas exige rediseñar la toma compartida):

- Toma de un lock obsoleto por dos réplicas a la vez (`stat` y `unlink` en `tryLock`): es la misma carrera de antes de 01B. La que pierde lo detecta en su siguiente cesión.
- Toda réplica congelada más de 10 min (SIGSTOP, pausa de VM) entre dos llamadas consecutivas puede escribir como mucho un lote después de que otra tome el lock. Es inherente a un lock con caducidad.

En ambos casos el resultado es inocuo por diseño: `BEGIN IMMEDIATE` por escritura y claves únicas. Probado: dos réplicas, toma a mitad, recuperación con el mismo ledger y reintento sin cambios.

## 3. Mediciones (Linux)

Entorno: contenedor `chibalete/api:secdeps-0a606c0` (Node 20.20.2, `node_modules` Linux) sobre WSL2 6.6, `--network none`. Datos 100 % sintéticos (`helpers/mookSweepFixture.mjs`): 200 lectores, 10 mediadores y 20 obras; evidencias aprobadas con acceso congelado. `mook_review` se libera solo en el proceso de medición, igual que en `workRecognition.test`. 01A se mide con `server/gamification` de `e0468ee` y el mismo documento.

### 3.1 Barrido en proceso (`mookReconcileBench.mjs`)

Pausa = hueco entre ticks de un `setInterval` de 1 ms. Salud = `/api/health` servido en el proceso del barrido y consultado sin parar desde otro proceso.

| N | Versión | Barrido | Duración | Pausa p95 | Pausa máx. | Salud p95 / máx. | Salud |
|---|---|---|---|---|---|---|---|
| 2 000 | 01A | primero | 16,2 s | — | 16 174 ms | — | 1 fallida |
| 2 000 | 01B | primero | 14,9 s | 29 ms | 39 ms | 24 / 34 ms | 593 OK |
| 2 000 | 01A | repetido | 2,1 s | — | 2 120 ms | 2 116 ms | 2 |
| 2 000 | 01B | repetido | 1,8 s | 22 ms | 53 ms | 26 / 48 ms | 81 OK |
| 20 000 | 01A | primero | 219,2 s | — | 219 198 ms | — | 1 fallida |
| 20 000 | 01B ×3 | primero | 168 / 174 / 215 s | 29 / 29 / 39 ms | **473 / 78 / 118 ms** | 24–34 / 73–469 ms | 6 952–8 206 OK, 0 fallidas |
| 20 000 | 01A | repetido | 16,9 s | — | 16 870 ms | — | 1 fallida, 0 OK |
| 20 000 | 01B ×3 | repetido | 8,1 / 8,6 / 8,5 s | 38 / 39 / 30 ms | **51 / 65 / 38 ms** | 25–35 / 34–50 ms | 368–389 OK |
| 80 000 | 01A | primero | 403,0 s | — | 402 965 ms | máx. 102,6 s | 1 fallida |
| 80 000 | 01B | primero | 348,7 s | 38 ms | 381 ms | 32 / 376 ms | 14 431 OK |
| 80 000 | 01A | repetido | 211,9 s | — | 211 855 ms | — | 1 fallida, 0 OK |
| 80 000 | 01B | repetido | 157,5 s | 23 ms | 97 ms | 18 / 87 ms | 7 270 OK |

Con 01A el event loop queda bloqueado durante todo el barrido. La consulta que cae en la ventana espera el barrido entero o falla al reanudarse.

Los tiempos del barrido repetido no son comparables con la memoria de 01A (6,1 s a 80 000). Este fixture tiene 60 000 evidencias sin XP restante que se reevalúan en transacción en cada barrido. Solo se comparan cifras dentro del mismo arnés.

### 3.2 `server.js` real (`mookReconcileHttpBench.mjs`)

Sin arnés: `mook_review` sigue bloqueada, como en producción. Store MOOK en disco, reglas por hecho (`mook_experience`, 4 000 escrituras), `/app/secrets` vacío (tmpfs) y clave de sujeto de prueba. La sonda está en otro proceso, cada 5 ms y con timeout de 30 s.

| N (store) | Versión | Consultas | p50 | p95 | p99 | Máx. | > 100 ms | Fallidas |
|---|---|---|---|---|---|---|---|---|
| 2 000 (2,6 MB) | 01B | 929 | 21 ms | 36 ms | 46 ms | 76 ms | 0 | 0 |
| 20 000 (26 MB) | 01A | 58 | 1,5 ms | 1,9 ms | 26,8 s | **26 771 ms** | 1 | 0 |
| 20 000 (26 MB) | 01B | 1 626 | 20 ms | 43 ms | 52 ms | **280 ms** | 1 | 0 |
| 80 000 (104 MB) | 01A | 41 | 1,6 ms | 6,4 ms | 30 s | timeout | 2 | **1 (30 s)** |
| 80 000 (104 MB) | 01B | 1 413 | 20 ms | 23 ms | 37 ms | **1 075 ms** | 3 | 0 |

## 4. Equivalencia, concurrencia y recuperación

- **Ledger 01A = 01B** en los tres tamaños: misma huella por persona (XP, hechos y actos en orden de inserción) y mismos totales (`c8d0a5ff…` a 2 000; `ffa13ef5…` a 20 000 y 80 000). Mismos recuentos y motivos en el resultado.
- `mookReconcileBatched.test.mjs`, 50/50 en Windows y en Linux, ahora dentro de `test:gamification-core`:
  1. Equivalencia síncrono/lotes con lotes de 7 pasos y con `sliceMs: 0`, con reglas por obra y con reglas por hecho.
  2. Cesiones reales (los temporizadores corren; en síncrono, ninguno), sin transacción abierta en ninguna.
  3. Testigo, renovación, reentrada síncrona y por lotes, pérdida del lock sin borrar el ajeno, y parada ordenada.
  4. Dos réplicas (procesos) × 3 barridos: hay solapamiento, sin duplicados, mismo ledger y sin lock huérfano.
  5. SIGKILL a mitad: trabajo parcial coherente; el lock del muerto bloquea hasta quedar obsoleto; después se completa con el mismo ledger.
  6. Exclusión aplicada durante una cesión: sin sujeto ni XP, resto idéntico a la referencia, y reintentar no la reincorpora.
  7. Retirada legal durante el barrido: los derechos se releen y la obra deja de reconocerse desde ese paso.
  8. Reintentos síncrono y por lotes: nada nuevo.
  9. El programador usa el conductor por lotes.
  10. Aislamiento de stores reales.

## 5. Meta y operaciones síncronas restantes

Meta: pausas < 100 ms a 20 000 evidencias.

- **Cumplida** en el barrido repetido (máx. 38–65 ms) y en p95/p99 del primer barrido (p95 29–39 ms).
- **No cumplida siempre** en el máximo del primer barrido (78, 118 y 473 ms en tres ejecuciones), ni en `server.js` real (280 ms a 20 000; 1 075 ms a 80 000).

Operaciones identificadas:

1. **`readMook()`**: lectura + `JSON.parse` del store completo en un solo paso. 180–250 ms a 20 000 (26 MB); 0,8–1,0 s a 80 000 (104 MB); `normalizeMookStore` < 1 ms. `server.js` llama a `readMook()` en 14 sitios: cada petición MOOK ya paga hoy ese mismo coste. Trocearlo exige cambiar el formato del store o leerlo en streaming, es decir, infraestructura nueva. No se hace.
2. **Commit `IMMEDIATE` con `synchronous = FULL`**: un registro individual mide p50 7,9 ms, p99 25,7 ms y máx. 153 ms en este disco. Con `sliceMs: 0`, el paso más largo del barrido real fue 68 ms y ninguno pasó de 100 ms. Los picos de 380–470 ms del banco son bloqueos de `fsync` del disco virtual de WSL2 y varían entre ejecuciones. Una transacción no se puede partir sin cambiar el contrato de durabilidad. Sin pausas de GC por encima de 30 ms.

Producción hoy: 0 evidencias, 2 runs y 5 versiones. Ninguna de las dos operaciones tiene efecto apreciable a ese volumen.

## 6. Límites respetados

Sin cambios de política XP/PM, Studio ni interfaces. `mook_review` sigue en `XP_LOCKED_SOURCES`. Sin flags, despliegue ni servicios nuevos. Los bancos (`mookReconcileBench.mjs`, `mookReconcileHttpBench.mjs`) no forman parte de la CI.

## 7. Cierre (G4-PERF-01B-CLOSE)

**`74495bd` publicado** sobre `e0468ee`. CI 3/3 verde: `security` (8 jobs), `identity-preflight` (incluye MOOK, exportaciones, G0, núcleo G3, typecheck y build) y `content-rmw`.

**Lock.** La auditoría con dos procesos encontró la carrera de §2 (comprobación y operación separadas) y la corrigió en un commit aparte. `mookReconcileLock.test.mjs` (27 aserciones) entra en `test:gamification-core`:

1. Testigo `pid:uuid` y exclusión entre procesos.
2. Quien perdió la propiedad no renueva ni borra.
3. Carrera en la renovación.
4. Carrera en la liberación.
5. Expiración y toma a mitad de un barrido por lotes, sin transacción abierta en las cesiones, con recuperación al mismo ledger y reintento sin cambios.

Resultados en Linux:

| Código | Resultado |
|---|---|
| `74495bd` | 24 ✓ / 3 ✗ (defecto reproducido) |
| Corrección | 27/27, 10 de 10 ejecuciones |

En Windows, 27/27.

**Repetición en Linux, 20 000 evidencias, con la corrección** (mismo arnés que §3):

| Versión | Barrido | Duración | Pausa p95 / máx. | `/api/health` p95 / máx. | Salud |
|---|---|---|---|---|---|
| 01A | primero | 178,7 s | — / 178 654 ms | — | 1 fallida |
| 01B | primero | 186,2 s | 34 / 137 ms | 29 / 132 ms | 7 515 OK, 0 fallidas |
| 01A | repetido | 17,1 s | — / 17 054 ms | — | 1 fallida |
| 01B | repetido | 8,2 s | 38 / 54 ms | 33 / 47 ms | 373 OK, 0 fallidas |
| 01B `server.js` real | barrido programado | — | — | 38 / 272 ms (p99 50; 1 de 1 594 > 100 ms) | 0 fallidas |

- **Ledger:** 01A = 01B (`ffa13ef5…`). Totales: 20 000 hechos, 20 000 asientos XP, 24 000 actos, 210 sujetos y 0 PM.
- **Exclusión y retirada legal durante el barrido:** [6] y [7] verdes en Linux.
- **Límites (sin garantía general de 100 ms):**
  - `readMook()` (un `JSON.parse` de unos 26 MB) explica el máximo de 272 ms en `server.js`.
  - Los picos de `fsync` explican los máximos del primer barrido, que varían entre ejecuciones: 137 ms aquí; 78–473 ms en §3.

**Stores reales.** Ningún archivo modificado en `data/`, `data-critical/`, `public/uploads/` ni en las carpetas protegidas sin rastrear.

**Veredicto:** `GREEN_CI_PERF_PILOT` cuando la CI de `80b357f` y del commit de liberación atómica (01B-LOCK-FINAL) esté verde.
