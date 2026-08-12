# CHP-IDDB-RECONCILE-LIVE-SOURCES-01 — atestación congelada vs. reconciliación viva

## Causa raíz

`scripts/identity/reconcileIdentityShadow.mjs` tenía **un solo** camino de carga
de fuentes, `readSources()`, que mezclaba tres responsabilidades:

1. autorizar la ruta,
2. **fijar el contenido** contra el `sha256` congelado del manifiesto de
   importación de CHP-IDDB-02A,
3. parsear el JSON.

El punto 2 es correcto para atestiguar una migración histórica reproducible y es
**equivocado** para reconciliar contra el estado canónico de hoy. Cualquier
escritura productiva legítima sobre `data/groups_db.json` invalida el pin y el
instrumento aborta:

```
STOP — SOURCE_HASH_MISMATCH: grupos
```

…aunque la ruta sea correcta, el JSON válido, el dominio lógico correcto y
`identity.db` esté perfectamente reconciliada.

### Cómo se destapó

Durante CHP-IDDB-02B-D-B, el canary de atribución de `api_2`
(`PUT /api/groups/group-historical-grupo-101` con cuerpo `{}`) hizo que
`normalizeGroup` añadiera tres campos **derivados** al grupo objetivo —`type`,
`mediatorIds` (desde `teacherId`) y `gradeLevel` (desde `grade`)—. El fichero
pasó de `e83ae10a…` a `c938f6ea…`.

Conviene subrayar que **el éxito del canary y este defecto son el mismo hecho**:
`operationId` se deriva de `sha(entityType|opType|canonicalKey|sourceVersion)` y
`sourceVersion.hash` es `sha256(JSON.stringify(data))` —contenido puro, el `seq`
de mtime no entra—, así que fue justamente ese cambio de bytes el que hizo nacer
las 231 `operation_id` nuevas que demostraron la atribución de `api_2`.

**La fragilidad era anterior e independiente del canary.** Un mediador añadiendo
un estudiante a un grupo rompe el `--check` exactamente igual.

## Los dos contratos

| | `--source-mode frozen` | `--source-mode live` |
|---|---|---|
| Propósito | atestar la migración histórica | reconciliar contra el canon de hoy |
| Fuentes | rutas del manifiesto 02A | derivadas de `--sources-root` |
| Hashes | **fijados**; un byte distinto aborta | calculados y **registrados como evidencia** |
| Manifiesto | obligatorio | prohibido |
| `--check` / `--plan` | soportados | soportados (read-only) |
| `--apply` | soportado | **no autorizado** |
| Por omisión | **sí** | nunca por accidente |

El modo es **explícito** en CLI y API. Por omisión es `frozen`, el más estricto:
una invocación histórica se comporta igual que antes y nadie cae en `live` sin
haberlo escrito.

Ninguno puede suplantar al otro: `live` con `--source-manifest` y `frozen` con
`--sources-root` fallan con `SOURCE_MODE_AMBIGUOUS`.

## Uso

```bash
# Reconciliación productiva contra las fuentes canónicas de hoy (read-only)
node scripts/identity/reconcileIdentityShadow.mjs \
    --check --source-mode live \
    --sources-root /src \
    --identity-db /app/identity/identity.db

# Atestación de la migración histórica (debe seguir fallando por groups)
node scripts/identity/reconcileIdentityShadow.mjs \
    --check --source-mode frozen \
    --source-manifest /manifest.json \
    --identity-db /app/identity/identity.db
```

`--sources-root` es la raíz de datos del despliegue. Las rutas **no** se aceptan
sueltas: se derivan de la raíz más un basename fijo por rol
(`scripts/identity/identityLiveSources.mjs`), con la misma disposición que
producción:

| rol | ruta derivada |
|---|---|
| `padron` | `<root>/data-critical/usuarios_colegios_oro.json` |
| `groups` | `<root>/data/groups_db.json` |
| `institutions` | `<root>/data/schools_db.json` |

## Qué garantiza el modo LIVE

No se limita a «ignorar hashes». Sustituye el pin por garantías propias, todas
fail-closed:

1. **Ruta canónica exacta**, derivada por construcción; no se acepta una ruta
   arbitraria.
2. **Sin fallback a stores legacy**: veto por basename al padrón superseded
   (`users_db.json`), backups, `.env` y stores de telemetría.
3. Fichero existente. 4. Fichero legible. 5. JSON parseable.
6. **Forma esperada**: array no vacío. Sin esta reja, un objeto o un array vacío
   se proyectarían como cero filas *en silencio* —`Array.isArray(x) ? x : []`— y
   el reconciliador lo leería como «todo el padrón desapareció» en vez de «me han
   dado el fichero equivocado».
7. **Claves requeridas**: todo registro es un objeto con `id` no vacío; las
   instituciones exigen además `name`.
8. **Sin duplicados incompatibles**: dos registros con el mismo `id` solo se
   toleran si son idénticos campo a campo.
9. **Cohorte sintética** contabilizada, y se verifica que ninguna identidad
   marcada sobrevivió a la proyección canónica.
10. **Invariantes estructurales cruzadas** entre las tres fuentes.
11. **Hash actual** calculado y devuelto.
12. **Identidad de fuente canónica** inequívoca: rol → ruta → hash.

### Lo que deliberadamente NO se exige

No se exige que todo grupo tenga `organizationId`, ni que ese `organizationId`
resuelva a una institución conocida. Hoy en producción hay 20 grupos de los que
solo 5 llevan `organizationId`, y uno —`lt-test-group-v2` → `lt-org`— apunta a
propósito a una organización inexistente por ser carga de prueba excluida en
`migration_exclusions`. Exigirlo rompería el instrumento con datos legítimos,
que es exactamente el defecto que esta unidad corrige. Lo que sí se exige es que
la parte del grafo que **sí** se espeja sea coherente: al menos una institución
y al menos un grupo resoluble.

## Los hashes actuales son evidencia, no allowlist

El modo `live` devuelve el `sha256` de cada fuente en
`attestation.canonicalSourceIdentity`, para poder auditar **contra qué bytes** se
reconcilió cada corrida. Ese hash:

- se registra en el reporte y en el manifiesto de la corrida;
- **jamás** se compara contra el de una corrida anterior;
- **jamás** se persiste como pin.

Hacer cualquiera de las dos últimas cosas reintroduciría exactamente el defecto
que este trabajo corrige.

## Prohibiciones

- **No actualizar el manifiesto 02A** (`ce5aaada…`) para desbloquear
  producción. Ese artefacto debe seguir demostrando qué fuentes exactas se
  usaron en aquella migración; re-fijarlo destruye la evidencia histórica. Que
  `frozen` siga fallando hoy por `groups` **es el comportamiento correcto**.
- **No usar `live` para `--apply`.** Converger el espejo exige una atestación
  congelada, que es lo que hace auditable contra qué bytes se escribió. El gate
  devuelve `LIVE_APPLY_NOT_AUTHORIZED`; el escape interno `allowLiveApply` topa
  después con `APPLY_REQUIRES_ATTESTED_MANIFEST`. Abrir esa puerta requiere una
  unidad propia.
- **No inferir el modo** de un detalle de la invocación.

## Ficheros

| fichero | cambio |
|---|---|
| `scripts/identity/identityLiveSources.mjs` | **nuevo** — contrato LIVE |
| `scripts/identity/reconcileIdentityShadow.mjs` | `sourceMode`, gate de apply, CLI |
| `scripts/identity/__test__/reconcileSourceModes.test.mjs` | **nuevo** — 44 aserciones |
| `package.json` | la suite entra en `test:identity-candidate` |

## Verificación sobre datos reales

Con una copia de las fuentes canónicas y de `identity.db` de producción:

```
LIVE  --check → MATCH  (users 247, institutions 4, groups 4, memberships 227)
                        groups sha256 = c938f6ea…  aceptado
FROZEN --check → STOP — SOURCE_HASH_MISMATCH: grupos
```

Esa asimetría **es** el resultado deseado: demuestra que la reconciliación viva
sigue el canon actual mientras la atestación histórica permanece inmutable.
