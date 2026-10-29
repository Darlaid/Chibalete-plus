# GAMIFICACION-G3-02: garantías operativas del ledger

**Fecha:** 2026-10-29 · **Base:** `3fd8d6b` (G3-01 publicado; CI 3/3 en verde, con el paso del ledger ejecutado en Ubuntu) · **Producción:** `g0-f4836d1`, sin cambios.
**Alcance:** respaldo, recuperación de hechos, política de emisión, y aislamiento y rendimiento. **Sin ganchos productivos, sin HTTP, sin flags activados y sin usuarios reales.**

## 1. Respaldo y restauración

| Cambio | Detalle |
|---|---|
| `ops/backup/CHP-BACKUP-01B/runners/chibalete_backup/stores.py` | Agrega `SqliteStore("data-critical/gamification.db", "CANON", reconstructible=False, required=False)`. Va justo después de `royalties.db`, que sigue el mismo patrón |
| `tests/test_capacity.py` | El guard del scope protegido pasa de 30 a **31** stores; `gamification.db` se suma a `must` |
| `tests/test_suite.py` | Los conteos SQLite pasan de 7 a **8** (ID01, EA y RY01; los obligatorios siguen siendo 4). Casos nuevos **GM01–GM04**: inventario; base ausente con el flag OFF (backup `ok`, ausencia anotada y archivo **no** creado); base presente (entrada íntegra y fuente intacta); restauración aislada con integridad, schema, 19 triggers, migraciones, el hash de las 10 tablas y el saldo igual a la suma del ledger. Los triggers siguen vigentes en la copia |

- El fixture de GM se construye con la **migración real** `server/gamification/migrations/0001_ledger.sql`, igual que RY con las migraciones de regalías.
- **Despliegue:** esto **no** despliega el runner. El orden sigue siendo: primero el runner con `required=False` y después, en su propia unidad, encender `GAMIFICATION_ENABLED`. Mientras la base no exista, los respaldos productivos solo anotan `absent_optional`.

## 2. Recuperación de hechos (`server/gamification/reconcile.mjs`)

**Barrido completo, sin marca de agua.**
- Una marca `MAX(occurred_at)` de lo ya procesado **no** descubre un hecho anterior que se perdió.
- La prueba [6] de concurrencia lo demuestra: con un hecho antiguo perdido y otros posteriores ya registrados, una marca de agua lo omitiría y el barrido completo lo recupera.
- Por eso `reconcile()` recorre **todos** los candidatos de la fuente, busca cada uno por su clave única y solo registra los ausentes. La idempotencia permite que dos réplicas barran a la vez.

| Fuente | ¿Recuperable? | Motivo |
|---|---|---|
| `mook_review` | **Sí** | La evidencia conserva su estado final (`REVIEWED`, `reviewerId`, `decision`, `reviewedAt`) y MOOK no la borra |
| `mook_experience` | **Sí** | El run conserva `status: 'completed'` y `completedAt`. Se registra una vez por usuario y versión, aunque se repita la ruta |
| `reading_completion` | **No; deshabilitada** | `progress.db` sobrescribe `updated_at` en cada sync y no guarda el instante de finalización, así que no se puede derivar la ventana de relectura (D08) de forma confiable |
| `offline_validation`, `mission` | **No; deshabilitadas** | Todavía no existe una fuente canónica (G7) |

- **Adaptadores puros.** `mookReviewCandidates(doc)` y `mookExperienceCandidates(doc)` reciben el documento MOOK **que les pasa el llamador**; no leen disco. No están conectados a nada.
- **Padrón obligatorio.** `reconcile` exige `resolveUser(userId) → { exists, active, synthetic }`. Sin él no reconcilia, porque no podría excluir cuentas sintéticas ni inactivas.
- **Coste:** O(n) sobre la fuente, con una consulta por clave única para cada candidato. Para el store MOOK (JSON acotado) es aceptable; una fuente masiva necesitaría paginación propia.

## 3. Política de emisión (`server/gamification/policy.mjs`)

- **El llamador ya no fija nada.** `recordFact` rechaza `xp`, `pm`, `amount`, `grade`, `decision` y `ruleVersion` con `CALLER_FIELD_NOT_ALLOWED`. Solo admite el hecho, su `eligibility` y unas `features` de la lista permitida.
- **Grado fijo por fuente:** MOOK revisado es A; el resto, B. Las reglas no pueden cambiarlo.
- **Reglas versionadas** (`gm_rule_sets`), validadas antes de guardarse:
  - **Formato:** `facts["<fuente>/<tipo>"] = { xp, pm, emitWhen? }`.
  - **Topes obligatorios:** `pmPerDay` y `pmPerWeek`, más `pmPerDayBySource` opcional. No hay emisión sin techo (D13).
  - **Rechazos:** una regla que haga emitir a la lectura terminada (`READING_EMISSION_LOCKED`), las fuentes desconocidas (como `leo`) y las features no permitidas en `emitWhen`.
  - **Vigencia prospectiva:** rige la versión más reciente cuya `effective_from` ya pasó (D48), y cada hecho guarda la `rule_version` con la que se decidió.
- **Decisión,** dentro de la misma transacción `IMMEDIATE`:

| Caso | Decisión |
|---|---|
| Rechazo del adaptador | El rechazo, tal cual |
| `observe` | `observed` |
| Lectura terminada | `observed` |
| Autorrevisión | `rejected_self_review` |
| Sin regla | `rejected_not_eligible` |
| `emitWhen` no cumplido (p. ej. `con_comentarios`) | `observed` |
| `PM_EARNING_ENABLED` OFF | `disabled_source` |
| Elegible y con regla | `awarded`, o `capped` si un tope recorta los PM. El XP no se recorta |

- **Topes** en America/Bogota por día y por semana ISO, calculados sobre los movimientos `earn` confirmados **dentro** de la transacción. Dos réplicas no pueden excederlos: la prueba [3] de concurrencia termina en exactamente 100 = tope, con 10 `awarded` y 90 `capped`.
- **Cifras:** las de las pruebas son ilustrativas. Las tarifas experimentales de la doctrina (D14, D20–D22) **no** se cargaron como valores definitivos y no existe ningún conjunto de reglas productivo.
- **Pendiente para otra unidad:** la bolsa mensual global (D46).

## 4. Aislamiento y rendimiento (`server/gamification/intake.mjs`)

- **`scheduleFact()`:**
  - corre en `setImmediate`, **después** de la respuesta;
  - usa una conexión propia con `busy_timeout` de **150 ms**;
  - **no abre ni migra** la base (la deja al arranque), así que si el archivo no existe desiste;
  - **nunca lanza ni espera**.
- **Solo fuentes recuperables:** perder un hecho en línea solo es aceptable si el barrido puede reconstruirlo.

**Medido en `ledgerIsolation.test.mjs`**, con otro proceso reteniendo el lock de escritura durante 2,5 s:

| Medida | Resultado |
|---|---|
| Operación simulada | Responde en ≤ 0,2 ms y antes de que se registre el hecho |
| Event loop | El hueco máximo queda acotado (en torno a 240 ms) |
| Ganchos | Los que coinciden con el lock **desisten** en lugar de esperar |
| Reconciliación posterior | Recupera exactamente los que desistieron, sin duplicar |
| Contraste: escribir con la conexión principal | Bloquea el event loop unos **1500 ms** |

- **Fuga corregida durante la unidad.** Con la base corrupta, la conexión del gancho quedaba abierta después de fallar, y Windows lo mostró como `EBUSY`. Ahora se cierra siempre.

## 5. Evidencia

| Suite | Resultado |
|---|---|
| `ledgerCore.test.mjs` | **134 ✓** (reglas validadas; el llamador no fija montos; topes de día y semana en Bogotá; reglas prospectivas; más todo lo de G3-01) |
| `ledgerConcurrency.test.mjs` | **36 ✓**, estable en 4 ejecuciones seguidas (arranque ×4; réplicas; topes ×2; reconciliación ×2; caída abrupta con código 137 y recuperación; sin marca de agua; fuentes no recuperables) |
| `ledgerBackupRestore.test.mjs` | **14 ✓** (`capture_sqlite` real) |
| `ledgerIsolation.test.mjs` | **16 ✓** |
| Runner de backups en `ubuntu:24.04` (igual que la CI `backup-suite-sandboxed`) | Línea base **134/134** antes del cambio. Después: **138/138** (GM01–GM04 incluidos) y `test_capacity` **94/0** |

## 6. Límites reales

1. **Hueco residual del event loop.** Con contención, cada gancho puede pausar el event loop hasta unos 150 ms (el busy corto). Es un límite acotado, no nulo; si molesta, el siguiente paso es un `worker_thread`, sin infraestructura externa.
2. **La lectura terminada no es recuperable** (§2) y sigue solo en observación. Hacerla recuperable exigiría que el progreso guarde el instante de finalización, lo que implica cambiar el progreso canónico en su propia unidad.
3. **Ventana entre respuesta y gancho.** Un hecho cuyo gancho desiste queda pendiente hasta el siguiente barrido. La reconciliación todavía no está programada: está la primitiva, pero el temporizador y el arranque se conectan en una unidad posterior.
4. **Restauración de un respaldo.** Los canjes y ajustes posteriores al punto de restauración no se reconstruyen desde las fuentes (ADR §7); los hechos MOOK sí.
5. **Sin bolsa mensual** (D46). **La DPIA sigue pendiente.**

## 7. Siguiente unidad (no iniciada)

Conectar los ganchos MOOK con `scheduleFact` y programar la reconciliación al arrancar y periódicamente, todo con los flags en OFF. Antes de cualquier activación:
- desplegar el runner de backups;
- terminar la DPIA;
- decidir sobre `con_comentarios`;
- definir un conjunto de reglas aprobado por Finanzas.
