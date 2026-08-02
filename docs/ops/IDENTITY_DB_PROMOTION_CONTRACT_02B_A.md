# Contrato de promoción — CHP-IDDB-02B-A

`scripts/identity/promoteIdentityCandidate.mjs` lleva una candidate verificada a
la ruta de una `identity.db`. **En esta unidad solo se ejercita en sandbox**; la
promoción productiva es 02B-B.

> **Ruta de destino:** la fija el contrato de
> [`IDENTITY_DB_PATH_CONTRACT_02B.md`](IDENTITY_DB_PATH_CONTRACT_02B.md).
> El promotor no la deduce: exige una allowlist explícita, y el runtime resuelve
> la suya por `IDENTITY_DB`. El default histórico bajo `data-critical/` quedó
> rechazado como destino productivo.

## 1. Se verifica todo ANTES de tocar el destino

1. flags de identidad apagados;
2. manifiesto y candidate obligatorios;
3. **hash atestado obligatorio** (ver §3);
4. esquema v2 y tablas exigidas;
5. `quick_check`, `integrity_check`, `foreign_key_check`;
6. conteos reconciliados contra el manifiesto;
7. un único `migration_run` completado, con el `run_id` del manifiesto;
8. commit fuente dentro de la allowlist;
9. destino explícito, en la allowlist, llamado `identity.db`, fuera del
   repositorio y **no existente**.

## 2. La escritura

Copia a un temporal **del mismo filesystem** con creación exclusiva (`wx`), fsync
del fichero, modo 0600, comprobación de propietario si se exige, verificación de
que la copia coincide con la candidate, y **rename atómico**. Después, fsync del
directorio: es lo que hace durable el propio rename.

Si algo falla antes del rename, se limpia el temporal y no queda nada. Después
del rename se vuelve a verificar el destino: la promoción no se declara buena
por haber renombrado, sino por lo que hay al final.

En Linux —producción— el fsync de directorio y el modo 0600 son exigencias
duras. En Windows no existen: allí se reporta `directorySynced: false` y el modo
real, en vez de fingir.

## 3. Por qué el hash es obligatorio

Al alterar dos bytes de una candidate, `quick_check` e `integrity_check`
**siguieron devolviendo `ok`**. La integridad estructural de SQLite no acredita
la autenticidad del contenido. Por eso el promotor exige el hash atestado y falla
con `EXPECTED_SHA256_REQUIRED` si no se le pasa: sin él, una manipulación
silenciosa pasaría todos los demás controles.

## 4. Rechazos

Candidate modificada · manifiesto que no corresponde · destino existente · flags
activos · ruta fuera de la allowlist · destino dentro del repositorio · nombre
distinto de `identity.db` · esquema distinto de v2 · conteos que no reconcilian ·
commit fuente no autorizado.

## 5. Ensayo en sandbox

Sobre una **copia** de la candidate de 02A, con el manifiesto real: promovida con
modo 0600, `directorySynced: true`, rename atómico, destino byte-idéntico a la
candidate y conteos 247/4/4/227/11. La candidate congelada quedó intacta y
ninguna ruta productiva se tocó.

## 6. Rollback

Antes del rename no hay nada que revertir. Después, la reversión es retirar el
fichero promovido: mientras los flags sigan apagados, `identity.db` no la lee
nadie. La candidate es además reproducible desde su manifiesto.
