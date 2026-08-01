# Atestado de runtime del canary — CHP-STATS-LEGACY-PERF-CORPUS-01A-R2

```
CORPUS:              FROZEN AND UNCHANGED  (sha256 e4f792e9…)
ACCEPTANCE CONTRACT: 1.0.0 — UNCHANGED     (sha256 3441172…)
RUNTIME ATTESTATION: SUPPORTED BUT NOT YET GENERATED
PRODUCTION:          UNCHANGED ON 4c407af  ·  FLAGS off/off
```

Complementa `STATS_LEGACY_PERF_PRODUCTION_CORPUS_01A.md`. Aquí no se cambia una
sola cifra del contrato: se explica por qué **el contrato y la imagen que lo
ejecuta son dos artefactos distintos**, y cómo se ata el segundo al primero.

---

## 1. El problema

El corpus congelado lleva dentro la identidad del runtime productivo actual:

```
production.commit  = 4c407af…
production.imageId = sha256:0b31f5a2…
```

Eso permite detectar drift hoy, y por eso está bien puesto. Pero haría
**imposible desplegar legítimamente la observabilidad**: la imagen nueva tendrá
otro commit y otro `ImageID`, aunque el contrato estadístico —población, alias,
R1–R7, periodos, normalización, muestra, gates— sea idéntico byte a byte.

Las salidas fáciles estaban todas descartadas de antemano, y con razón:

| salida | por qué no |
|---|---|
| regenerar el corpus | un corpus que se regenera en cada despliegue no está congelado: es un formulario |
| cambiar `productionCommit` dentro del corpus | cambia el artefacto que existe para no cambiar |
| tocar `acceptanceContractSha256` | invalida la prueba de que nadie ajustó los gates tras ver resultados |
| aceptar cualquier descendiente | un descendiente puede traer literalmente cualquier cosa |
| desactivar la validación de revisión | elimina la única prueba que une imagen y código |
| override por variable de entorno | un control que se apaga con una variable no es un control |
| ignorar `ImageID` | dos builds del mismo commit no son la misma imagen |
| actualizar el artefacto automáticamente | convierte la detección de drift en su aceptación silenciosa |

## 2. La separación

**El corpus describe qué se mide.** Población, alias `ORG_A`–`ORG_D`,
`GROUP_R7`, `USER_R6`, rutas R1–R7, parámetros, periodos, normalización,
muestra de 64 por brazo, gates, lifecycle y criterios de selección. Inmutable.

**El binding describe con qué se mide.** Qué commit ejecuta el contrato, de qué
baseline desciende, qué ficheros cambiaron, qué cambios runtime están
autorizados, qué `ImageID` se construyó, qué etiqueta OCI lleva, qué manifiesto
lo respalda y hasta cuándo vale.

`PRODUCTION-CANARY-RUNTIME-BINDING.json` **no forma parte del
`acceptanceContract`** y no entra en su hash. Verificado por prueba: el módulo
del contrato no importa el del binding, y `acceptanceContractSha256()` sigue
devolviendo `3441172…`.

## 3. Clasificación del acoplamiento

Cada comprobación del validador se clasificó antes de tocar código:

| clase | comprobaciones | dónde vive la referencia |
|---|---|---|
| **CONTRACT_BINDING** | hash del contrato, contrato incrustado, rutas, normalización, periodos, muestra, gates, alias, población, membresías, caducidad del corpus | corpus (inmutable) |
| **RUNTIME_BINDING** | `ImageID`, etiqueta OCI `image.revision` | corpus en modo A · **binding en modo B** |
| **LIVE_SAFETY** | flags `off`/`legacy`, salud, reinicios, presencia de contenedores, ausencia de valores sensibles, sondas de ruta, `insights.db` intacto | contenedores vivos, siempre |

Solo dos comprobaciones cambian de referencia. Todo lo demás queda donde estaba.

## 4. Qué se congela y qué se atesta

| | corpus | binding |
|---|---|---|
| población, alias, R1–R7 | ✅ congelado | — |
| periodos, normalización, muestra, gates | ✅ congelado | — |
| commit, árbol, `ImageID`, revisión OCI, manifiesto | — | ✅ atestado |
| ficheros runtime autorizados y su huella | — | ✅ atestado |
| caducidad | `2026-08-24T23:17:59Z` | ≤ la del corpus |

## 5. Por qué ser descendiente no basta

Descender del baseline solo prueba que el commit vino después. No dice nada de
lo que trae. Un descendiente puede subir una dependencia, cambiar el
`Dockerfile`, tocar el motor de métricas o reescribir la identidad.

Lo que autoriza es **el contenido del diff, fichero a fichero**, contra una
allowlist exacta:

**`RUNTIME_OBSERVABILITY`** — cambian el comportamiento de la imagen. Rutas
exactas, nunca prefijos, porque un prefijo bajo `server/` autorizaría medio
backend:

```
server/lib/operationalAdminAuth.js    middleware secret-only file-only
server/metricsService.js              snapshot READ-ONLY de contadores
server/server.js                      montaje de la ruta operacional
```

**`VALIDATION_AND_TESTS`** — no alteran el runtime servido: `docs/`,
`scripts/perf/`, `server/__test__/`, `package.json` (solo scripts) y el workflow
de `identity-preflight`.

**`FORBIDDEN`** — denegación explícita, evaluada **antes** que la allowlist, de
modo que ampliar un prefijo por descuido no puede abrir ninguna de estas
puertas: `package-lock.json`, `Dockerfile`, `.dockerignore`, `docker-compose*`,
`.env*`, `node_modules/`, `data/`, `data-critical/`, `public/uploads/`,
`engines/`, `server/leo/`, `scripts/migrations/`, `pages/`, `components/`,
`services/`, `hooks/`.

**Todo lo demás es `UNKNOWN`, y `UNKNOWN` no pasa.** El defecto es denegar.

Además, `package.json` está permitido pero sus campos de dependencias
(`dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies`,
`bundledDependencies`, `overrides`, `resolutions`) se comparan uno a uno entre
baseline y source: permitir el fichero no es permitir subir una dependencia.

Clasificación real del diff acumulado `4c407af..4b000cc`: 15 ficheros, 3
`RUNTIME_OBSERVABILITY`, 12 `VALIDATION_AND_TESTS`, **0 prohibidos, 0
desconocidos**, dependencias intactas, `package-lock.json` y `Dockerfile` sin
tocar. El diff runtime es puramente aditivo: 198 inserciones, 0 borrados.

## 6. Por qué `ImageID` y revisión OCI son obligatorios

Son dos pruebas distintas y ninguna sustituye a la otra:

- **La revisión OCI** une la imagen al **código**. Es una etiqueta que estampa
  el build, no una variable de entorno — no puede divergir de lo que se
  construyó. El binding exige `imageRevision === sourceCommit`.
- **El `ImageID`** identifica la **imagen concreta**. Dos builds del mismo
  commit producen `ImageID` distintos; sin él, cualquier reconstrucción pasaría
  por la autorizada.

Ambos se exigen completos. Un `ImageID` truncado no identifica de forma única y
se rechaza como `UNSAFE`, no como aviso.

`GIT_SHA` **no** se usa: no está en `ENV_VALUE_ALLOWLIST` y la evidencia segura
lo devuelve `[REDACTED]`, correctamente.

## 7. La huella del cambio: `approvedDiffSha256`

No es el hash del texto de `git diff`. El formato de `git diff` no es estable
—la longitud de los hashes abreviados de la línea `index` depende de
`core.abbrev` y del tamaño del repositorio—, así que hashearlo produciría falsos
`DRIFTED` al cambiar de máquina.

Se hashea el **manifiesto canónico de pares de blobs**
`[{path, baselineBlob, sourceBlob}]` ordenado por ruta. Es exactamente
reproducible y además más fuerte: identifica el contenido final de cada fichero,
no su representación.

Consecuencia práctica, probada: un commit que toca `package-lock.json` pero
ningún fichero runtime tiene **la misma huella** — lo que lo rechaza es la
clasificación, no la huella. Y un commit que cambia el contenido de un fichero
autorizado tiene **huella distinta**, aunque la ruta siga permitida. Son dos
defensas separadas y conviene no confundirlas.

## 8. Cómo se genera

```bash
node scripts/perf/buildProductionCanaryRuntimeBinding.mjs \
  --corpus /root/stats-legacy-perf-corpus-01a/PRODUCTION-CANARY-CORPUS.json \
  --repo   /ruta/al/repo \
  --sourceCommit <sha40> \
  --imageId sha256:<64hex> \
  --imageRevision <sha40> \
  --imageManifestSha256 <64hex> \
  --createdAt <iso> --expiresAt <iso> \
  --out /root/stats-legacy-perf-corpus-01a/PRODUCTION-CANARY-RUNTIME-BINDING.json
```

El generador **no inventa nada**: lo que no puede probar lo exige por parámetro,
y lo que puede derivar de Git lo deriva y lo compara. Valida **antes** de
escribir; si algo falla, no escribe. Escribe de forma atómica (`rename`) con
modo `0600`, y se niega a sobrescribir un binding existente sin `--force`,
porque un binding sobrescrito en silencio invalidaría la evidencia del anterior.

No toca el corpus, no lee `.env`, no consulta contenedores y no contacta con
ningún registry.

## 9. Cómo se valida

### Modo A — producción actual (sin `--runtime-binding`)

Comportamiento de siempre: el runtime se compara contra el corpus. La producción
en `4c407af` valida; cualquier otro commit o `ImageID` devuelve `DRIFTED`.
**Esta vía no se relaja**, y hay una prueba que lo fija.

### Modo B — runtime atestado (con `--runtime-binding`)

```bash
node scripts/perf/validateProductionCanaryCorpus.mjs \
  --corpus <corpus> --runtime-binding <binding> --repo <repo> \
  --data /var/www/chibalete/data --dataCritical /var/www/chibalete/data-critical
```

Tres capas, y **las tres son obligatorias** para `VALID`:

1. **estructural** — forma, campos exactos, hashes completos, baseline,
   `imageRevision === sourceCommit`, alcance de `approvedRuntimeFiles`,
   caducidad no posterior a la del corpus;
2. **caducidad** del propio binding;
3. **atestación contra Git** — descendencia, árbol, clasificación de *cada*
   fichero cambiado, invariancia de dependencias y huella del diff runtime.

La tercera no es opcional. **Sin `--repo` el veredicto es `UNSAFE`**, no una
omisión silenciosa: un atestado que nadie contrasta es una declaración de
intenciones. No existe bandera ni variable de entorno que lo relaje. Git está
disponible tanto en el repositorio de desarrollo como en el VPS, así que la
exigencia es cumplible en los dos sitios donde hace falta.

El validador **nunca crea, corrige ni actualiza el binding**.

## 10. Clasificación de veredictos

**`UNSAFE`** — binding sin esquema o con campo desconocido · hash de corpus o de
contrato incorrecto · `sourceCommit` fuera de ancestry · fichero no allowlisted
o prohibido · `package-lock.json` o `Dockerfile` modificados · dependencias
modificadas · `ImageID` truncado · revisión ≠ commit · manifiesto o huella
distintos · permisos distintos de `0600` · propietario distinto de root ·
secreto o PII detectado · sin `--repo`.

**`DRIFTED`** — el runtime **vivo** no coincide con el binding: otro `ImageID`,
otra revisión, otro commit, otras banderas, contenedor ausente, o corpus
productivo cambiado.

**`EXPIRED`** — corpus caducado, binding caducado, o binding con caducidad
posterior a la del corpus.

El peor veredicto gana, y cualquier excepción no prevista imprime `UNSAFE`.

## 11. Privacidad

El binding son trece campos: hashes, commits, rutas de fichero bajo `server/` y
dos fechas. **Cero** identificadores de usuario, grupo u organización; cero
alias del corpus; cero secretos; cero cabeceras. Verificado por prueba sobre la
serialización completa, y por el mismo detector de fugas que ya cubre el corpus.

## 12. Cómo se evita ampliar el alcance

El riesgo real de un mecanismo así no es que falle: es que se ensanche. Tres
frenos, todos en código y con prueba:

1. **`RUNTIME_OBSERVABILITY` son rutas exactas.** Añadir un cuarto fichero exige
   editar una constante versionada y pasa por revisión.
2. **La denegación gana.** Aunque alguien ampliara un prefijo de la allowlist,
   `FORBIDDEN_PATHS` se evalúa primero.
3. **El defecto es denegar.** Lo que nadie clasificó es `UNKNOWN`, y `UNKNOWN`
   produce `UNSAFE`.

## 13. Qué sigue — `CHP-STATS-LEGACY-PERF-OBS-01B-R2`

1. construir **una sola** imagen desde el commit exacto;
2. obtener su `ImageID`, su revisión OCI y el digest de su manifiesto;
3. generar el binding root-only con el generador de arriba;
4. validar candidate + corpus + binding **con `--repo`**;
5. desplegar con `off`/`off`;
6. validar producción con **el mismo** binding.

El corpus no se toca en ninguno de los seis pasos.
