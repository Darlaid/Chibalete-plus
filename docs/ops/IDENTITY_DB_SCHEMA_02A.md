# Esquema v2 de identity.db — CHP-IDDB-02A

`identity.db` **no existe en producción** y esta unidad no la crea. Aquí se
documenta el esquema objetivo, ya implementado como migración versionada y
verificado contra una candidate local.

## 1. Qué se reutiliza y qué se añade

La implementación dormida de P1-A se conserva entera: `identityDb.js`,
`migrate.js`, `identityShadow.js`, `identityWriteHook.js`,
`identityReadFacade.js`, `identityRepo.js` y la migración `0001_identity`.

`0001_identity` **no se toca ni se reescribe**: sigue siendo el primer eslabón
del historial. El modelo canónico llega en una migración posterior,
`0002_identity_v2`, que corre en una única transacción con
`PRAGMA foreign_keys=ON`.

## 2. Precondición fail-closed

El modelo v1 y el v2 no son convertibles entre sí: v1 indexa grupos por
`school::grade::name` y modela roles como `student`/`teacher`; v2 modela
institución → grupo → membresía con rol. Además, los usuarios de una
instalación v1 provendrían del padrón legacy que 01D dejó **fuera** de la
importación.

Por eso la migración **exige que las tres tablas de dominio v1 estén vacías**.
Si alguna tiene filas, la transacción aborta entera y no se destruye nada: no
existe un plan seguro de conversión y la migración se niega a inventar uno.
`access_rules` y `shadow_audit` sí conservan sus filas — son dominios que v2 no
redefine.

## 3. Tablas

| Tabla | Clave | Qué garantiza |
|---|---|---|
| `institutions` | `institution_id` | nombre normalizado único; `addressable` distingue una institución sin grupos de una direccionable |
| `users` | `canonical_id` | `email_norm` único entre las vivas; `global_role` y `status` acotados por CHECK; **sin columna de credencial** |
| `groups` | `group_id` | FK a institución; `legacy_school` es **solo procedencia**, jamás join key |
| `memberships` | `membership_id` | única por **(group_id, user_id, role)**; FK compuesta a `(group_id, institution_id)` |
| `identity_tombstones` | `tombstone_id` | `authentication_allowed` fijado por CHECK; sin rol ni credencial |
| `identity_aliases` | `alias_id` | destino excluyente: identidad **o** tombstone, nunca ambos |
| `institution_aliases` | `alias_id` | un alias normalizado activo por institución |
| `migration_runs` | `run_id` | hashes de fuente, hash de plan, estado y conteos |
| `migration_exclusions` | `exclusion_id` | una fila por entidad no importada, con hash de referencia |

## 4. Invariantes que el esquema impone, no que el código promete

- Una membresía **no puede** apuntar a un usuario inexistente (FK) ni a un
  tombstone (trigger `trg_membership_never_to_tombstone`).
- La institución de una membresía **no puede** contradecir la de su grupo: lo
  garantiza una clave foránea compuesta, no una comprobación en aplicación.
- Un tombstone **no puede** colisionar con una identidad canónica, ni una
  identidad nacer sobre un tombstone (dos triggers simétricos).
- Un tombstone **no puede** volverse autenticable: `CHECK (authentication_allowed = 0)`
  rechaza incluso un `UPDATE` posterior. La tabla tampoco tiene columna de
  credencial ni de rol, así que la autenticación es imposible **por forma**.
- Una persona **puede** ser miembro y mediadora del mismo grupo: son dos
  membresías distintas y la unicidad las admite.
- Una institución válida **puede** existir con cero grupos (corrección de
  contrato de 01C-R1). Nada en el esquema exige lo contrario.

## 5. Credenciales

`users` **no almacena contraseñas** y `raw_json` se guarda saneado. La candidate
no autentica a nadie: es un artefacto de verificación. La consecuencia está
declarada en el documento de preparación para el cutover — habilitar lectura
SQLite para la ruta de autenticación exige una decisión aparte, no se hereda de
esta unidad.

## 6. Reversibilidad

`0002_identity_v2` tiene sección `DOWN` completa: revierte a la forma v1 y
devuelve `user_version` a 1. `rollbackLast()` la ejecuta. El runner acepta
`{ until: '<versión>' }` para fijar una base en una versión concreta, que es
como las suites del contrato v1 siguen ejercitando v1 después de que exista v2.
