# Contrato del importador de identidad — CHP-IDDB-02A

`scripts/identity/importIdentityCandidate.mjs` construye una candidate de
`identity.db` a partir de las fuentes canónicas y de las disposiciones
congeladas en CHP-IDDB-01A..01D. **Nunca escribe en producción.**

## 1. Fuente única

La única fuente autorizada de identidades es el padrón canónico
(`data-critical/usuarios_colegios_oro.json`), que es además el que lee
producción.

El importador **rechaza por contrato** cualquier fuente cuyo nombre sea el
padrón legacy superseded, un backup o el store de insights. No infiere usuarios
desde eventos ni progreso, no fusiona por nombre ni por correo, y no inventa
grupos, instituciones ni membresías.

## 2. Destino

`--output` es obligatorio y debe terminar en `.candidate.db`. Se rechaza un
destino que:

- caiga en un mount productivo o en el directorio de despliegue;
- contenga un segmento de store (`data`, `data-critical`, `public`, `uploads`);
- caiga dentro del repositorio;
- coincida con la ruta configurada como `IDENTITY_DB`;
- se llame `identity.db`.

Si el destino ya existe y no es una candidate de este importador, o contiene
otra importación, **no se sobrescribe**.

## 3. Manifiesto

El importador no lleva ninguna ruta ni identificador de producción incrustado:
todo entra por un manifiesto root-only. El manifiesto declara el commit fuente,
la versión de esquema, los hashes de cada fuente y de cada artefacto congelado,
los conteos esperados, las disposiciones y las reglas de privacidad.

Los **conteos esperados no se copian del plan recién calculado**: se derivan del
dry-run congelado de 01D, que es la autoridad. Así la reconciliación compara
contra una fuente independiente y no contra sí misma.

Cualquier fuente cuyo hash no coincida con el declarado detiene la importación.

## 4. Determinismo e identidad del run

Cero `Date.now()`, cero azar: todas las marcas de tiempo salen del manifiesto y
todos los identificadores derivados son hashes de su propio contenido. Dos
ejecuciones producen el mismo plan y el mismo volcado canónico.

`run_id` se **deriva** de `sha256(canonical({planHash, sourceHashes}))`. Un
`run_id` declarado que no corresponda a esa fuente y ese plan se rechaza; y si
el destino ya contiene ese `run_id` con otra fuente u otro plan, también. Un
`run_id` no es una etiqueta: es una función de lo que se importó.

## 5. Atomicidad e idempotencia

La base se construye en un fichero temporal y solo se mueve a su sitio tras
confirmar la transacción. Una interrupción antes del commit deja **la candidate
anterior intacta o ningún fichero**, nunca una a medias — y la reanudación
posterior produce el mismo resultado.

Un segundo apply idéntico devuelve `NOOP_ALREADY_APPLIED`: cero duplicados,
mismos conteos, mismo hash lógico. La comparación **no es byte a byte** sobre el
fichero SQLite —que no es reproducible bit a bit— sino sobre un volcado
canónico ordenado de todas las tablas.

## 6. Qué se importa y qué no

| Entra | Queda fuera, con su disposición registrada |
|---|---|
| 247 identidades no sintéticas | 400 de la cohorte de carga (01B) |
| 4 instituciones | 484 filas del padrón superseded (01D) |
| 4 grupos institucionales | 1 grupo sintético y 15 grupos legacy (01C-R1) |
| 227 membresías | 400 membresías sintéticas y 26 legacy |
| 11 tombstones | 66 referencias de banco de pruebas y 6 de grupos legacy |
| 258 aliases de identidad, 4 institucionales | 1 referencia eliminada resuelta |

Ninguna exclusión se pierde en silencio: cada entidad no importada deja una fila
en `migration_exclusions` con su disposición y un **hash** de referencia, nunca
el identificador crudo.

## 7. Privacidad

La candidate no almacena contraseñas ni hashes de contraseña; `raw_json` se
sanea antes de guardarse. Los artefactos versionados no contienen nombres,
correos, identificadores completos ni contenido de actividad. El manifiesto y la
candidate viven fuera del repositorio, en un directorio root-only con modo 0600.
