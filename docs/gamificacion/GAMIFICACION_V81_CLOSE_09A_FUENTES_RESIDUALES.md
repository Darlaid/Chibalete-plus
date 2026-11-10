# V8.1-CLOSE-09A: cierre de G-08, fuentes residuales de datos personales

**Fecha:** 2026-11-10.
- **Base:** `112b6d8`, publicado (fast-forward `eb3f1bf..112b6d8`). Ese commit contiene solo `docs/ops/V81_CLOSE_08B_RELEASE_FINAL.md`. CI security y content-rmw en verde; identity-preflight no se dispara con cambios de solo documentación.
- **Sin despliegue y sin XP.** No se han tocado `data/`, `data-critical/`, uploads, recursos editoriales, respaldos ni WooCommerce. No hay autorizaciones ni evidencias jurídicas fabricadas.

## 1. Alcance

Solo las seis fuentes que CLOSE-08B dejó fuera de la supresión:
- `events*`
- `progress*`
- `leo_*`
- `user_audit_log.json`
- `access_db.json`
- `identity.db`

**Criterio:** desvincular no es anonimizar. Ningún dato que siga permitiendo reidentificar a la persona se declara anónimo.

## 2. Resultado por fuente

| Fuente | Datos personales o identificadores | Finalidad | Antes de CLOSE-09A | Qué se conserva y por qué | Ante una supresión válida |
|---|---|---|---|---|---|
| `events.db`, `events.archive.db` | `user_id`, `session_id`, contenido, tiempos, progreso y `payload_json`. Los eventos de auditoría de Aula Viva de un mediador llevan el `studentId` del lector consultado | Métricas de lectura, Aula Viva, tiempo efectivo | Solo rotación por antigüedad (90 d / 12 meses). No había borrado por persona | Eventos **de un mediador** que mencionan a la persona: se conservan como constancia de quién consultó qué, sin la persona. Plazo C10 | **Se eliminan** sus eventos propios. En los eventos de terceros, su id pasa a `suppressed-subject` |
| `progress.db`, `progress_db.json` (legado; el servidor ya no lo escribe) | `user_id`, contenido, avance, historial de sesiones | Servicio: retomar la lectura | Sin borrado por persona | Nada: no hay ninguna obligación verificada | **Se eliminan** sus filas y sus claves `<id>__…`. Después, `VACUUM` (§3.4) |
| `leo_memory_db.json`, `leo_profile_db.json`, `leo_interactions_db.json`, `leo_evidence_db.json` | Memoria de sesión por persona y contenido, perfil de aprendizaje, metadatos de interacción, evidencia pedagógica estructurada | Servicio de Leo | Sin borrado por persona | Nada. C08 dice «mientras exista la cuenta» | **Se eliminan** sus entradas, bajo el mismo `withFileLock` que usa el servidor |
| `user_audit_log.json` | `targetUserId`, `actor` y `details`. **La baja (`DELETE /api/users/:id`) escribe el correo y los roles de la cuenta eliminada** | Responsabilidad y seguridad de las operaciones administrativas | La baja creaba ella misma un dato personal nuevo | **Se conservan las entradas**, porque registran quién hizo qué. C07: casos 2 años ⚖ | Su id pasa a `suppressed-subject`, tanto en `targetUserId`/`actor` como dentro de `details`. Se eliminan `email`, `nombre_completo`, `nombre_usuario`, `colegio` y el teléfono |
| `access_db.json` | Reglas de ámbito usuario (`scopeId` = id). Las reglas B2C llevan además el número de pedido de la tienda | Control de acceso. B2C: vigencia, reembolso e idempotencia del pedido | Las reglas quedaban apuntando al id eliminado | Regla B2C: **se conserva sin titular y vencida**. Si se borrara, un reenvío firmado del mismo pedido volvería a crear la cuenta y a devolver un enlace de activación, porque la idempotencia va por id de regla. El número de pedido es seudónimo: lo vincula a la tienda. C01/C03 ⚖ | Reglas personales: **se eliminan**. Regla B2C: `scopeId` pasa a `suppressed-subject`, `expiresAt` ≤ ahora y se añade `b2c.suppressedAt` |
| `identity.db` (espejo con `IDENTITY_DUAL_WRITE=1`) | `users`: `email_norm`, `email_raw`, nombre, usuario, roles y `raw_json` completo. `access_rules.raw_json`. `memberships` | Sombra de identidad, sin autoridad mientras `IDENTITY_READ=json` | La baja solo marcaba `deleted_at`: se quedaban **el correo, el nombre y `raw_json`**. Las reglas eliminadas se quedaban dadas de baja con su `raw_json`. Además, las páginas libres conservaban copias antiguas | La fila queda dada de baja con `canonical_id` y `legacy_identity_hash`. Este último es `h16` del id, que ya figura en alias y operaciones. Se conserva por integridad de la sombra (C03 ⚖) | Correo → `suppressed-subject:<hash>`. Nombre, usuario y correo original → NULL. `raw_json` → `{}`. `status` → `inactive`. Se eliminan sus membresías. Las reglas pasan a `suppressed-subject`: las B2C con la regla conservada y el resto con `{}` y dadas de baja. Después, `VACUUM` |

## 3. Corrección (mínima, sin servicios, bases ni mecanismos nuevos)

Archivos modificados:
- `server/privacy/suppression.mjs`;
- `ops/a2/suppression_operator.mjs`;
- las pruebas: dos ajustadas y una nueva.

### 3.1 Supresión ≠ retiro de XP (defecto en `eb3f1bf`)

**El defecto:** el retiro de XP (PRIV-C7, `excludeUser`) también deja un tombstone, pero la persona **conserva su cuenta**. Las funciones de conciliación de CLOSE-07B/08A trataban cualquier tombstone como supresión. Tras una restauración, a quien solo se había retirado de XP se le habría borrado el MOOK y las entregas, y su cuenta se habría listado para desactivar.

**La corrección:**
- `suppressAccount` revoca también **T** (002), con la referencia del trámite: la relación con la plataforma termina. Solo este operador revoca T.
- **Suprimida** = tombstone **y** T revocada (`suppressionGate`). Los dos registros son independientes de los respaldos.
- `reapplyMook…`, `reapplySubmission…` y la nueva reaplicación residual actúan solo sobre personas suprimidas.

### 3.2 Restauración: eliminar, no desactivar

- `restoreActions(users)` devuelve dos listas:
  - `toDelete`: personas suprimidas que el respaldo reintrodujo, aunque estén desactivadas;
  - `toDisable`: A1 revocada sin supresión.
- Desactivar no bastaba: la cuenta restaurada seguía con correo y nombre en el padrón.
- `accountsToRestrictAfterRestore` se mantiene por compatibilidad, como unión de las dos listas.

### 3.3 Fuentes residuales

- `suppressResidualSources(paths, userId)` aplica la tabla del §2.
- `reapplyResidualAfterRestore(paths)` la reaplica a toda persona suprimida que aparezca en las fuentes o en el padrón restaurado.
- **Garantías:** es idempotente. Si un registro no es verificable, falla antes de escribir. Los acuses solo contienen recuentos.
- **Reutiliza** los mismos archivos, el mismo `withFileLock` y la misma escritura atómica que el servidor. Las rutas se resuelven con los mismos valores por defecto que el servidor (`residualPaths`).

### 3.4 Bytes antiguos en SQLite

- Las conexiones del servidor no usan `secure_delete`. Cada upsert de progreso y cada espejo de identidad deja la versión anterior de la fila en espacio libre. **La prueba lo detectó: el correo seguía en los bytes de `identity.db` con la fila ya limpia.**
- **Corrección:** el operador abre las bases con `secure_delete = ON`. Tras un cambio efectivo ejecuta `VACUUM` en `progress.db` e `identity.db` y `wal_checkpoint(TRUNCATE)` al cerrar.
  - Si una réplica tiene la base ocupada, el acuse indica `vacuumed: false` y la pasada se repite.
  - `events*` no lo necesita: sus filas no se reescriben y lo que borra el operador se sobrescribe con ceros.

### 3.5 Orden del operador

1. `DELETE /api/users/:id`, la operación existente.
2. `suppression_operator`.

**Por qué este orden:** con la cuenta todavía en el padrón, cualquier escritura del padrón volvería a espejarla en `identity.db`. Por eso el operador responde `ACCOUNT_STILL_PRESENT` y no escribe nada. Ir después de la baja permite además seudonimizar la entrada de auditoría que esa misma baja escribe. Esto **sustituye** el orden de CLOSE-08A.

## 4. Restauración (sustituye a CLOSE-08B §4, puntos 2 y 3)

1. Restaurar en una **cuarentena**, sin tráfico de usuarios.
2. Operador `{"reconcileAfterRestore":true}`.
3. AT ejecuta `DELETE` sobre `accountsToDelete` y `/disable` sobre `accountsToDisable`, en la instancia de cuarentena.
4. **Repetir el operador:** trata la auditoría y el espejo que acaba de generar la baja.
5. **Puerta:** la pasada siguiente devuelve listas vacías y `changes = 0` en MOOK, entregas y fuentes residuales. Con un registro no verificable, falla.
6. Promover y reabrir el edge.

## 5. Pruebas

**`suppressionResidualHttp` (nueva):** 40/0, estable en dos ejecuciones seguidas. Usa `server.js` real, dos réplicas, `identity.db` con dual-write y datos sintéticos.
- Siembra las seis fuentes de tres personas:
  - `sup`: se suprime;
  - `xpo`: solo se retira de XP;
  - `k1`: no cambia.
- **Supresión:**
  - se eliminan sus eventos propios, su progreso (SQLite y legado) y los cuatro archivos de Leo;
  - el evento del mediador, la auditoría y la regla B2C se conservan sin la persona;
  - `identity.db` queda sin correo, nombre, membresías ni reglas;
  - **ninguno de los cuatro SQLite conserva bytes del rastro ni del correo**, después de varias reescrituras de progreso;
  - `xpo` y `k1` quedan intactos;
  - login 401 en las dos réplicas;
  - repetir la operación no cambia nada;
  - una escritura posterior del padrón no reintroduce a la persona en `identity.db`.
- **Cuarentena:**
  - el respaldo trae todo de vuelta;
  - dos procesos concilian a la vez sin errores y el efecto se aplica una sola vez;
  - antes de eliminarla, la cuenta restaurada inicia sesión (200): es el riesgo que justifica la cuarentena;
  - la cuenta va a eliminar, no a desactivar, y el retiro de XP no aparece;
  - la segunda pasada trata la baja.
- **Puerta:** 0 pendientes y 0 cambios. Con un registro de exclusiones no disponible, falla.
- **Promoción:** ninguna réplica deja entrar a la persona; `k1` y `xpo` entran; los logs no contienen ni el rastro ni el correo.

**Ajustadas:**
- `rightsLifecycle` 27/0: el acuse incluye T.
- `suppressionRestoreHttp` 18/0: una cuenta suprimida y desactivada sigue pendiente hasta eliminarla.

**Imagen de laboratorio `chp-lab/api:09a`:** es la imagen API construida con estos cambios. No es un artefacto ni una release.
- **Operador real**, con el orden nuevo y restauración en cuarentena: 21/0.
  - Con la cuenta aún en el padrón responde `ACCOUNT_STILL_PRESENT` sin escribir.
  - Desactivar no basta.
  - Tras la baja, el operador trata lo que esta dejó.
  - La puerta se abre con 0 pendientes; con un registro no verificable, no se abre.
- **En Alpine/musl:**
  - `suppressionResidualHttp` 40, `suppressionRestoreHttp` 18 y `rightsLifecycle` 27;
  - `exclusion` 60 y `a2Registry` 34;
  - `mediatorValidityHttp` 14, `mookReviewIdentity01a` 30 y `xpA1Eligibility` 23;
  - `o8Check` 27.
- **O8 inerte:** OK, sin fallos ni avisos.

**Batería de CI en Linux** (`node:20-bookworm`, `git archive HEAD` más estos cambios en LF):
- **En verde:**
  - identity, memberships, metric-contract, mook y exports;
  - gamification-g0, credential-reset, session-browser y self-password;
  - `test:v81` en todas sus suites;
  - `typecheck:baseline` (sin regresiones TS) y `build`;
  - `store-isolation`: 0 archivos modificados, creados o eliminados en los stores reales.
- **Rojos del entorno**, que pasan en el repo local:
  - `verify:deploy-config`, `lint:evidence`, parte de `test:evidence` y la aserción L de `AulaVivaGroupAnalytics` necesitan git;
  - `test:analytics` (dentro de `store-isolation`) necesita `scripts/events-archive.mjs`, que no está versionado;
  - `o8Check` necesita `/app`.
- **Rojos preexistentes:** `mookWorkAccess` (4), `test:library` (5) y `test:auth-reset` fallan **igual sobre `HEAD` sin estos cambios** en el mismo contenedor. En el repo local, `mookWorkAccess` da 71/0 y `auth-reset` pasa; `test:library` mantiene 1 aserción ajena (`/api/content` no-store). En la CI remota de `eb3f1bf` todos pasan.

**Repo local:** ratchet OK (0 violaciones) y `test:evidence` GREEN 4/4.

## 6. Pendiente de validación jurídica (no se declara anonimización)

- **C07:** conservar la auditoría seudonimizada (2 años ⚖ para casos).
- **C10:** conservar los eventos de mediadores que mencionan a la persona (90 d / 12 meses).
- **C01/C03:** conservar la regla B2C sin titular, con el número de pedido, como antirreenvío y como traza del pedido (+90 d / 10 años en contabilidad, que vive en la tienda).
- **C03:** conservar la fila de `identity.db` dada de baja, con `canonical_id` y `h16(id)`.
- **Respaldos (G-04, sin cambios):**
  - la tabla D.3 y el objetivo 7/4/6 siguen como propuesta;
  - sin `forget` y sin tocar copias;
  - hasta que expiren, las copias contienen los datos y la cuarentena es lo que impide reabrirlos.

## 7. Bloqueos fuera de alcance (no corregidos)

1. **B2C, reenvío tras la supresión:**
   - un reenvío firmado del mismo pedido encuentra la regla conservada sin titular;
   - crea una cuenta **invitada nueva** con el correo del pedido (fase 1) y después responde 409 en la fase 2;
   - no se entrega enlace de activación, pero el correo y el nombre vuelven al padrón;
   - la conciliación no puede detectarlo, porque es un id nuevo y el tombstone va por id.

   Cerrarlo exige cambiar `planUserPhase` (flujo de contratación) o el emisor de WooCommerce. Ambos están fuera de esta unidad. Hasta entonces, AT debe vigilarlo tras cada supresión B2C.
2. **Escritores de Leo sin lock:** `leoMemoryService` y `leoEvidenceService` escriben con RMW sin `withFileLock`. Ya ocurría antes. Una escritura en curso de otra persona podría reescribir el archivo con la entrada ya suprimida. La segunda pasada del operador, que es la puerta, lo detecta y lo corrige. Cerrarlo del todo exige tocar Leo, que está fuera de alcance (regla 8).
3. **Derivados de `events*`:** las materializaciones de `insights.db` (perfiles, snapshots, vectores, rollups) contienen `user_id`. No están entre las seis fuentes: es otra fuente por tratar.
