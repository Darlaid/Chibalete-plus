# CHP-IDDB-02B-D-A — Endurecimiento del espejo para dos escritores

**Estado:** el shadow-write sigue activo SOLO en `api_1`. Esta unidad NO
enciende `api_2`. El JSON conserva la autoridad de escritura, lectura y login.

Prepara `identity.db` para recibir dos escritores productivos simultáneos
(`CHP-IDDB-02B-D-B`). Todo lo que sigue se descubrió o se demostró con dos
procesos Node reales contra la misma base, porque es el único montaje en el que
los defectos de abajo se manifiestan.

---

## 1. Dos conceptos que estaban mezclados

| | `operation_id` | `writer_id` |
|---|---|---|
| Responde a | QUÉ hecho lógico | QUIÉN lo aplicó |
| Derivado de | entidad, tipo, clave canónica, versión de origen | instancia de runtime + call-site |
| Depende del proceso | **NUNCA** | sí, por definición |
| Si cambia | se rompe la idempotencia entre instancias | solo se pierde trazabilidad |

`operation_id` ya era ciego al escritor antes de esta unidad y lo sigue siendo;
hay un test que lo fija. Es lo que permite que `api_1` y `api_2` reconozcan el
mismo hecho y que la segunda quede en `NOOP_ALREADY_APPLIED` en vez de
duplicarlo.

### Contrato de atribución

```
writer_id = "<instancia de runtime>::<call-site>"
            p. ej.  0b55c4d3284d::server.writeJSON
```

- **instancia de runtime** — `runtimeInstanceId()`, exportado por
  `server/healthHandler.js`. Es exactamente la identidad que ya publica
  `/api/health → instance` (el `HOSTNAME` del container). No se inventa un
  sistema paralelo: hay una sola noción de instancia y ahora tiene un único
  punto de definición.
- **call-site** — el id de superficie registrada (`server.writeJSON`,
  `server.writeJSONAsync`). Es lo único que valida `assertRegisteredWriter`: el
  registro sigue comparando el call-site desnudo, así que componer la
  atribución no abre la puerta a escritores no registrados.
- Los `writer_id` anteriores a esta unidad (solo call-site) se siguen leyendo:
  `parseWriterId` devuelve `runtimeInstance: null` y no les inventa una.

> **Límite conocido, deliberado.** Sin `hostname:` explícito en el compose, el
> `HOSTNAME` de un container es su ID corto, así que **cambia cada vez que se
> recrea**. Identifica la instancia VIVA, no el servicio: distingue sin
> ambigüedad quién escribe en un momento dado —que es lo que exige el
> rollout— pero el mapa instancia → `api_1`/`api_2` se resuelve fuera, con
> `docker inspect --format` sobre el nombre del container (nunca con un volcado
> crudo del inspect). No se añade una variable de entorno nueva para eso porque
> sería un segundo sistema de identidad compitiendo con el de health.

`writer_id` nombra a quien **aplicó** la operación. Un escritor que llega
después y la encuentra hecha queda en NOOP y **no** reescribe la atribución.

---

## 2. Defectos corregidos

### 2.1 El hook memoizaba al primer llamador — *era el bloqueo declarado*

`makeIdentityWriteHook` empezaba por `if (_hook) return _hook`, de modo que el
hook memoizado conservaba el `cfg` **completo** del primer llamador, `writerId`
incluido. `server.js` lo construye desde dos call-sites (`writeJSON` en la
línea 744 y `writeJSONAsync` en la 757), así que el primero que corriera
capturaba la atribución del proceso entero.

Reproducido antes de tocar nada: `hookA === hookB → true`, y una escritura
ejecutada por `writeJSONAsync` quedaba registrada como `server.writeJSON`.

**Corrección.** Se memoiza solo `_shared` —los módulos perezosos y la conexión
SQLite, que sí son globales del proceso y sí son caros—. El hook se construye
por llamada. Medido: **25 ns** de sobrecoste por escritura de identidad, frente
al `writeFileSync` + `rename` que la precede. Se eligió eliminar la memoización
del hook en vez de cachearla por call-site porque así desaparece la *clase* de
defecto —"el primer llamador captura datos de otro"— y no solo esta instancia
suya.

### 2.2 `SQLITE_BUSY` no manejado con dos escritores

El cuerpo del espejo LEE (exclusiones, tombstones, padrón vivo) antes de
ESCRIBIR. Con `db.transaction()` diferido, SQLite tiene que ascender el lock de
lectura a escritura, y **ese ascenso no respeta `busy_timeout`**.

Medido con dos procesos: la transacción diferida falla en **1 ms** con
`SQLITE_BUSY: database is locked`, mientras que `BEGIN IMMEDIATE` espera los
5 s del timeout. No es un fallo raro de carrera: aparecía en cuanto los dos
escritores se solapaban.

**Corrección.** `tx.immediate()`. La contención pasa de fallo instantáneo a
espera acotada. `busy_timeout` se mantiene en **5000 ms**, que no se toca
porque la medición lo respalda: la proyección completa de 247 identidades tarda
~650–710 ms, así que hay ~7× de margen. Subirlo escondería contención en vez de
resolverla.

### 2.3 Un fallo de contabilidad post-commit mentía sobre el espejo

`bumpState` corría **después** del COMMIT pero **dentro** del mismo `try`. Con
dos escritores, una contención en ese `UPDATE` marcaba como
`FAILED_RECONCILABLE` un espejo que ya estaba confirmado, e insertaba una
operación de fallo espuria. Se manifestó como un fallo intermitente de la
proyección concurrente.

**Corrección.** `bumpState` entra en la MISMA transacción que las filas que
describe. Filas, log de operaciones y estado del dominio se confirman juntos o
no se confirma nada.

### 2.4 Una instantánea fallida podía quedar como "última vista buena"

`bumpState` respetaba `countersOnly` al actualizar, pero **no al insertar**: si
el dominio no tenía fila todavía, un intento fallido la creaba con su propia
`last_source_version`. **Corrección:** en ese caso se inserta con versión vacía.

### 2.5 El reconciliador se hacía pasar por el seam HTTP

`reconcileIdentityShadow.mjs --apply` escribía `writerId: 'server.writeJSON'`,
atribuyendo a la superficie HTTP unas escrituras que ocurren fuera del proceso
del API. Ahora se atribuye como `reconcileIdentityShadow.apply`, declarado en
el contrato como `OUT_OF_BAND` (y por tanto sigue sin ser un escritor
registrado).

### 2.6 La APERTURA de la base también compite por locks

`getIdentityDb()` fijaba `busy_timeout` **después** de `journal_mode = WAL`, de
modo que ese pragma corría con el timeout todavía en 0. Y, aunque se ordene
bien, **cambiar el journal mode no respeta `busy_timeout` en ningún caso**:
exige lock exclusivo y devuelve `SQLITE_BUSY` en el acto. Medido con dos
procesos abriendo a la vez: `database is locked` lanzado desde la apertura a
los **9 ms**, antes de tocar el espejo.

**Corrección.** `busy_timeout` va primero, y el cambio a WAL pasa por
`enableWalMode()`: si la base ya está en WAL —el caso productivo— no intenta
ningún cambio, con lo que además deja de pedir un lock exclusivo en cada
apertura; si no lo está, reintenta de forma acotada (20 × 50 ms) y falla claro
antes que seguir en modo `delete`, que es precisamente el modo incompatible con
dos escritores.

> Este fallo se manifestaba con la base recién creada, que es la forma que
> tenía el fixture, no la de producción (`identity.db` lleva en WAL desde que
> se creó). El fixture se corrigió para nacer en WAL —y así ejercitar la
> carrera que sí existe— y el caso de apertura concurrente pasó a estar
> cubierto por su propio escenario.

`server/eventsService.js` tiene el mismo orden histórico de pragmas. **No se
toca desde esta unidad**: allí solo hay un abridor por proceso y `events.db`
lleva años en WAL, así que el riesgo es mucho menor y el cambio no pertenece a
este alcance. Queda anotado como deuda conocida.

### 2.7 Un `FAILED_RECONCILABLE` sin diagnóstico

La clasificación (`MIRROR_WRITE_FAILED`) no decía nada de la causa. El informe
lleva ahora `detail` con el mensaje de SQLite —que nombra tablas y
restricciones, nunca valores de fila— y el hook lo registra junto a la
atribución. **No se persiste**: es diagnóstico en memoria para quien llama.

---

## 3. Qué se demostró, y cómo

`server/__test__/identityTwoProcessConcurrency.test.mjs` levanta **procesos
Node independientes** contra la misma SQLite, con barrera de ficheros e
instante de arranque común. No usa hilos: dos hilos compartirían la conexión y
no probarían nada del locking entre procesos, que es justo lo que hay que
demostrar. Los workers abren la base por el mismo resolutor y con los mismos
pragmas que el runtime, y espejan por la misma función que el hook.

| Escenario | Resultado exigido |
|---|---|
| Apertura concurrente de la misma base | ambas abren; las dos acaban en WAL con `busy_timeout` fijado |
| Misma operación lógica en paralelo | 247 finales; aplicada una sola vez; la otra corrida en NOOP; sin duplicados |
| Operaciones distintas en paralelo | ambas aplicadas; ninguna pisa a la otra |
| Proyección completa concurrente (247 reales + 400 sintéticos) | 247 finales; 400 excluidos; 0 desactivaciones; idempotencia determinística |
| Contención real de locking | espera acotada (~3,2 s con un lock de 2,5 s) y la operación completa |
| Muerte del proceso dentro de una transacción | operación ausente, nunca parcial; `quick_check=ok`; el otro escritor sigue vivo |
| JSON confirmado + espejo caído | JSON sin revertir; `FAILED_RECONCILABLE` una sola vez; versión del dominio sin avanzar |

`server/__test__/identityWriterAttribution.test.js` fija el contrato de
atribución y la independencia de `operation_id` respecto del escritor.

Ambos entran en `npm run test:identity`, es decir, en el gate bloqueante
`identity-preflight`.

---

## 4. Lo que esta unidad NO hace

- No enciende el shadow-write en `api_2` (sigue `off/off/json`).
- No mueve `IDENTITY_READ` a `sqlite`.
- No ejecuta `reconcile --apply` en producción.
- No toca login, `x-user-id`, membresías, instituciones ni grupos productivos.
- No cambia el esquema: `writer_id` ya era `TEXT NOT NULL` sin `CHECK`, así que
  la atribución compuesta cabe sin migración.
