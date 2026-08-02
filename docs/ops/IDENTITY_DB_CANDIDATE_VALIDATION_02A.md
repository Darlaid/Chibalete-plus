# Validación de la candidate — CHP-IDDB-02A

La candidate se generó en un container efímero **sin red**, a partir de la
imagen de producción, con las fuentes montadas en solo lectura y la salida en un
directorio root-only fuera de todo mount productivo. Los containers `api_1` y
`api_2` no participaron.

## 1. Integridad SQLite

| Comprobación | Resultado |
|---|---|
| `PRAGMA quick_check` | ok |
| `PRAGMA integrity_check` | ok |
| `PRAGMA foreign_key_check` | 0 filas |
| `PRAGMA user_version` | 2 |

## 2. Conteos

| Entidad | Obtenido | Fuente de la expectativa |
|---|---|---|
| Usuarios | **247** | 103 migrables + 144 con aviso (01D) |
| Instituciones | **4** | 01C-R1 |
| Grupos productivos | **4** | 01C-R1 |
| Membresías productivas | **227** | 01D |
| Tombstones | **11** | 01D |
| Aliases de identidad | 258 | derivado: 247 + 11 |
| Aliases institucionales | 4 | derivado: un nombre oficial por institución |
| Exclusiones | 1 410 | derivado, no impuesto |

Ninguno de estos totales se fijó de antemano salvo los cinco que 01D congeló;
los aliases y las exclusiones se **derivaron** y luego se reconciliaron.

## 3. Nada sintético ni legacy entró

| Invariante | Valor |
|---|---|
| Usuarios sintéticos importados | 0 |
| Grupos sintéticos importados | 0 |
| Grupos legacy importados | 0 |
| Membresías sintéticas importadas | 0 |
| Membresías legacy importadas | 0 |
| Membresías hacia un tombstone | 0 |
| Membresías fabricadas | 0 |
| Rechazadas sin disposición | 0 |
| Usuarios provenientes del padrón superseded | 0 |

Se comprobó además que **todas** las identidades importadas provienen del padrón
canónico, no solo que ninguna venga del superseded.

## 4. Exclusiones reconciliadas

| Entidad | Disposición | n |
|---|---|---|
| user | `SYNTHETIC_LOADTEST_QUARANTINED` | 400 |
| group | `LEGACY_TEST_GROUP_PENDING_RETIREMENT` | 15 |
| group | `SYNTHETIC_LOADTEST_EXCLUDED` | 1 |
| membership | `SYNTHETIC_MEMBERSHIP_EXCLUDED` | 400 |
| membership | `LEGACY_GROUP_MEMBERSHIP_PENDING_RETIREMENT` | 26 |
| membership | `DELETED_IDENTITY_REFERENCE` | 1 |
| identity_reference | `SUPERSEDED_PADRON_SNAPSHOT_NOT_IMPORTED` | 484 |
| identity_reference | `SYNTHETIC_REFERENCE_EXCLUDED` | 66 |
| identity_reference | `DELETED_IDENTITY_TOMBSTONE_REQUIRED` | 11 |
| identity_reference | `LEGACY_GROUP_REFERENCE_PENDING_RETIREMENT` | 6 |

Cada cifra corresponde exactamente a la disposición congelada en 01B, 01C-R1 o
01D. La suma, 1 410, no se impuso: se calculó.

## 5. Unicidad e invariantes

Cero emails duplicados, cero identificadores canónicos duplicados, cero aliases
activos en colisión (ni de identidad ni institucionales). Cada alias resuelve a
exactamente un destino. Ningún tombstone es autenticable. Ninguna membresía
apunta a un tombstone ni a un usuario inexistente. La institución de cada
membresía coincide con la de su grupo. Roles y estados solo toman valores del
enumerado. Cero credenciales almacenadas y cero identificadores crudos en las
exclusiones.

## 6. Institución sin grupos

Exactamente una de las cuatro instituciones tiene cero grupos, está presente y
marcada como no direccionable; las otras tres son direccionables y se reparten
los cuatro grupos. Leerla por el repositorio devuelve una lista vacía, no un
error — la ausencia se representa como ausencia.

## 7. Idempotencia e interrupción

- Dos dry-run consecutivos: mismo plan, mismos conteos, cero escrituras.
- Primer apply: candidate creada, `migration_run` en estado completado.
- Segundo apply idéntico: `NOOP_ALREADY_APPLIED`, sin duplicados y con el mismo
  hash lógico.
- Interrupción simulada antes del commit: la importación falla y **no deja ni
  candidate ni fichero temporal**; la reanudación posterior produce una
  candidate con el mismo hash lógico.

## 8. Compatibilidad runtime

`identityRepo` detecta el esquema v2 y responde: lectura de usuario por id y por
correo, institución, institución sin grupos, grupo, miembros, doble rol,
usuario sin membresía, alias a identidad, alias a tombstone y tombstone.

Un usuario inexistente devuelve `null`: **no se degrada a 0, a lista vacía ni a
403**. `users.all()` sigue devolviendo el JSON reconstruido, que es el contrato
que consume `identityReadFacade`; `access.all()` y el informe de consistencia
siguen respondiendo.

Con los flags apagados —el estado de producción— la facade devuelve `null` y no
abre la candidate. Importar los módulos de identidad con los flags apagados no
crea ficheros, no abre conexiones y no toca la ruta por defecto.
