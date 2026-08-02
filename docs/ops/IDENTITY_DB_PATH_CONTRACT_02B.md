# Contrato de la ruta de identity.db — CHP-IDDB-02B-PATH-01

## 1. La variable

**`IDENTITY_DB`**, y solo esa. No existe `IDENTITY_DB_PATH` ni ninguna
alternativa: dos variables serían dos contratos y, antes o después, dos rutas.

La resuelve un **resolutor único**, `resolveIdentityDbPath()` en
`server/db/identityDbPath.mjs`, reexportado por `server/config.js` para que la
ruta se descubra junto a las demás rutas canónicas. Vive en un módulo sin
dependencias a propósito: el subsistema de identidad está dormido y debe poder
importarse sin arrastrar las aserciones de arranque de `config.js`.

Todo el runtime entra por ahí. `getIdentityDb()` es el **único** punto que abre
la base, y la facade de lectura, el espejo y `health` pasan por él. `health` no
tiene resolución propia.

## 2. Por qué el default histórico no vale en producción

El default histórico era `<app>/data-critical/identity.db`. Es inaceptable como
ruta productiva por dos motivos:

1. `data-critical/` es un directorio compartido: aloja `events.db`,
   `insights.db`, el padrón canónico y una quincena de respaldos.
2. **`better-sqlite3` crea el fichero si no existe.** Un default silencioso no
   habría fallado: habría fabricado una base vacía en el sitio equivocado y la
   habría dado por buena. Ese es exactamente el fallo que este contrato impide.

## 3. Comportamiento

| Situación | Resultado |
|---|---|
| Flags apagados, sin variable | resuelve al default histórico y **no abre nada** |
| Flags apagados, con variable | resuelve a la ruta declarada y **no abre nada** |
| Desarrollo o tests, sin variable | default histórico (compatibilidad) |
| **Producción + capacidad SQLite, sin variable** | `IDENTITY_DB_PATH_REQUIRED` |
| **Producción + capacidad SQLite, apuntando al default** | `IDENTITY_DB_UNSAFE_PRODUCTION_PATH` |
| Ruta relativa o vacía | `IDENTITY_DB_PATH_INVALID` |
| La ruta es un directorio o un symlink (al abrir) | `IDENTITY_DB_PATH_INVALID` |

Capacidades que exigen ruta explícita: `IDENTITY_SQLITE_ENABLED=on`,
`IDENTITY_DUAL_WRITE=on`, `IDENTITY_READ=sqlite`, y cualquier readiness que
realmente vaya a abrir SQLite.

El argumento explícito de `getIdentityDb(ruta)` —que usan los tests— queda
sujeto a las **mismas** validaciones en producción: no es una puerta trasera.

El resolutor no crea directorios ni ficheros, no abre SQLite, no lee `.env` y
**nunca registra la ruta completa**: los mensajes usan una forma abreviada
`…/directorio/fichero`.

## 4. Con los flags apagados

No se exige que el fichero exista, no se abre la ruta, no se crea el
directorio, no se crea la base y no aparecen WAL ni SHM. `health` responde
`disabled` y la identidad sigue sirviéndose desde JSON.

## 5. Ruta de despliegue prevista

- **Host:** `/var/www/chibalete/identity/`
- **Contenedor:** `/app/identity/identity.db`
- **Variable:** `IDENTITY_DB=/app/identity/identity.db`
- **Propiedad y permisos:** directorio `root:root` `0700`, fichero `0600`.
- Directorio **dedicado**: sin otros stores, fuera de `/app/data`,
  `/app/data-critical`, del repositorio y de los directorios de uploads.

El código **no hardcodea** ninguna de esas rutas. Declararlas en Compose —el
mount del directorio y la variable— es trabajo de la unidad de despliegue, no
de esta.

## 6. Relación con health

`checkIdentitySqlite` devuelve `disabled` con el flag apagado. Si el flag está
encendido y la ruta no es válida, devuelve
`{ ok: false, state: 'path_error', classification }` en vez de un error opaco, y
sin abrir ni crear nada. La comprobación va envuelta en el `safe()` del
readiness, así que un problema de ruta degrada ese check sin tumbar el resto.

## 7. Rollback

Es un cambio de código sin efecto mientras los flags sigan apagados: sin
capacidad SQLite activa, el resolutor devuelve lo mismo que antes y nadie abre
nada. Revertir es volver al commit anterior. Ninguna base, ningún fichero y
ninguna variable de producción se ven afectados por esta unidad.
