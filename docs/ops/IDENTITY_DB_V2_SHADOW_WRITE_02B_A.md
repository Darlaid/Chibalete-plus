# Shadow-write v2 — CHP-IDDB-02B-A

**Nada de esto está activo.** `IDENTITY_SQLITE_ENABLED`, `IDENTITY_DUAL_WRITE` e
`IDENTITY_READ` siguen apagados, `identity.db` productiva no existe y la lectura
sigue en JSON. Esta unidad solo deja la infraestructura lista.

## 1. Qué sigue mandando

- **El padrón JSON es la autoridad.** SQLite es un espejo no autoritativo.
- **La lectura sigue en JSON.** El cutover de lectura no es esta unidad.
- **Login y credenciales quedan fuera de identity.db.** El esquema v2 no tiene
  columna de contraseña y `raw_json` se guarda saneado.
- El espejo se intenta **solo después** de que la escritura JSON esté confirmada.
- Un fallo del espejo **no revierte** la escritura JSON ni cambia la respuesta
  HTTP, y **no queda silencioso**.

## 2. Superficies de escritura

El inventario se levantó sobre el árbol real, no de memoria:

| Superficie | Clase | Dominios | Espejo |
|---|---|---|---|
| `writeJSON` de server.js | cubierta por el seam | usuarios, grupos, acceso, **instituciones** | sí |
| `writeJSONAsync` de server.js | cubierta por el seam | usuarios | sí |
| `writeJsonAtomic` de groupMembershipService | **bloqueada con dual-write** | usuarios, grupos | no |
| escritores fuera del proceso | fuera de banda | todos | no, se detecta por reconciliación |

Dos huecos reales encontrados y cerrados:

1. **Instituciones.** `schools_db.json` se escribe por el seam pero el hook
   nunca lo miraba: v2 tiene tabla `institutions`, así que ahora el seam declara
   también `schoolsDb` y el dominio se espeja.
2. **`writeJsonAtomic`.** No pasa por el seam y ningún módulo del servidor lo
   invoca —solo scripts—. Con el dual-write encendido ahora **se niega** en vez
   de escribir JSON dejando el espejo atrás.

El contrato vive versionado en `server/db/identityWriteSurface.mjs`, y el espejo
solo acepta escrituras de un escritor registrado: "escritor desconocido" es un
estado detectable, no una sorpresa.

## 3. Cómo espeja

Es un espejo **convergente**: recibe la instantánea canónica ya escrita y deriva
las operaciones para que SQLite acabe igual. Eso lo hace idempotente por
construcción, sin necesidad de un log de eventos en el emisor.

Cada operación registra `operation_id` determinístico, tipo de entidad, tipo de
operación, hash de la clave canónica, versión de la fuente, estado, intentos,
momento de aplicación, clasificación del error y escritor. Estados:
`PENDING`, `APPLIED`, `NOOP_ALREADY_APPLIED`, `FAILED_RECONCILABLE`.

`shadow_audit` (v1) se conserva y sigue siendo el gate de consistencia por
dominio; `shadow_operations` añade el detalle que permite reparar dirigido.

**Sin PII:** solo hashes, clasificaciones y contadores. Ni correos, ni nombres,
ni payloads, ni identificadores crudos.

## 4. Lo que el espejo se niega a hacer

- No fabrica membresías: se derivan de la instantánea de grupos y solo para
  usuarios que existen.
- No recrea una identidad con tombstone como usuario.
- No importa la cohorte sintética ni los grupos legacy: la propia base lleva sus
  `migration_exclusions` y el espejo las respeta.
- No promueve una institución a direccionable si no tiene grupos.
- Una ausencia se refleja como **desactivación lógica**, nunca como borrado.

## 5. Orden y semántica de fallos

1. se valida la mutación;
2. se confirma la escritura canónica JSON;
3. se intenta el espejo;
4. se registra el resultado.

Si el JSON falla, no se toca SQLite. Si el JSON confirma y el espejo falla, el
JSON **no se revierte**, la respuesta HTTP no cambia, y queda
`FAILED_RECONCILABLE` en `shadow_operations`, con la clasificación en
`shadow_state` y una línea de log de nivel ERROR. La reparación es
determinística: el reconciliador vuelve a converger.

## 6. Idempotencia, obsolescencia y concurrencia

- La misma instantánea dos veces → `NOOP_ALREADY_APPLIED`, cero duplicados.
- Una instantánea **obsoleta no sobrescribe** un estado más nuevo: se compara la
  versión de la fuente por dominio y se ignora, contabilizándola sin mover la
  última vista buena.
- La unicidad `(group_id, user_id, role)` la garantiza el esquema, así que una
  persona puede ser miembro y mediadora del mismo grupo sin colisión.
- Cuatro espejos idénticos concurrentes: uno aplica, tres no-op.
- Transacciones cortas, `busy_timeout` explícito y WAL según el contrato ya
  existente de `identityDb.js`.

## 7. Telemetría

Agregada por dominio: intentos, aplicadas, no-ops, fallos, pendientes de
reconciliación, última clasificación de fallo y última reconciliación correcta.
Sin identificadores, sin nombres, sin correos, sin marcas por usuario.

**No se expone por ninguna ruta nueva.** Publicarla es decisión de la unidad que
encienda el canario, y deberá hacerlo sobre la superficie secret-only existente
manteniendo autorización file-only, `Cache-Control: no-store`, cero cambios en
`/api/system/metrics` y cero acceso vía `x-user-id`.
