# CHP-SEC-DEPS-01 — Remediación de advisories bloqueantes de dependencias

**Estado:** aplicado en `chp/sec-deps-01-ci-remediation`, sin desplegar.
**Objetivo:** recuperar los gates bloqueantes `osv-scanner` y `trivy`, que
pasaron de verdes a rojos **sin que cambiara una sola dependencia**.

---

## 1. Qué pasó

El CI del baseline `2945fa8` cerró en **verde el 2026-08-02 a las 18:18 UTC**,
incluidos `osv-scanner` y `trivy`. Ocho días después, el commit `5ee7b6d` de
CHP-IDDB-02B-B-H1 —que solo toca `ops/` y `docs/`— encontró ambos gates en rojo.

`package-lock.json` es **idéntico** entre `2945fa8` y `5ee7b6d`. Lo que cambió
no fue el árbol de dependencias sino la base de vulnerabilidades: entre una
fecha y otra se publicaron advisories nuevos sobre paquetes que ya estaban
instalados.

Es la propiedad esperada de un gate que consulta una base viva: un
repositorio congelado puede volverse rojo sin que nadie lo toque. La lectura
correcta no es "el CI se rompió", sino "aparecieron vulnerabilidades reales que
antes no se conocían".

## 2. Advisories que bloqueaban

Cinco hallazgos activos sobre tres paquetes. Ninguno estaba cubierto por los
ignores vigentes de `osv-scanner.toml` / `.trivyignore`.

| Advisory | Paquete | Versión | Severidad | Publicado | Directa/transitiva | Runtime/dev |
|---|---|---|---|---|---|---|
| `GHSA-rgw5-rvv9-x895` (CVE-2026-69152) | `brace-expansion` | 5.0.8 | HIGH | 2026-08-03 | transitiva (override) | **runtime** |
| `GHSA-mwp4-54f8-5fhr` (CVE-2026-69192) | `ip-address` | 10.2.0 | HIGH | 2026-08-03 | transitiva | **runtime** |
| `GHSA-4xrf-jv44-h6hh` (CVE-2026-69198) | `ip-address` | 10.2.0 | MODERATE | 2026-08-03 | transitiva | **runtime** |
| `GHSA-22jq-vg5j-6vgg` (CVE-2026-54272) | `ip-address` | 10.2.0 | MODERATE | 2026-08-03 | transitiva | **runtime** |
| `GHSA-2v37-7h3g-55p8` (CVE-2026-67213) | `nanoid` | 3.3.16 | HIGH | 2026-07-29, revisado 2026-08-07 | transitiva | dev-only |

Cuatro de los cinco se publicaron el **2026-08-03**, el día después del último
CI verde. `nanoid` es el caso raro: publicado el 2026-07-29, cuando el CI del
2026-08-02 ya escaneaba `nanoid@3.3.16` sin marcarlo. La **revisión del
2026-08-07** es la que trae la versión instalada al rango afectado.

`nanoid` es dev-only —entra por `vite → postcss`, nunca llega al artefacto de
runtime— pero igualmente bloquea: `osv-scanner` analiza el lockfile completo,
sin distinguir `dependencies` de `devDependencies`.

### Cadenas exactas

```
brace-expansion@5.0.8   archiver@7.0.1 → readdir-glob@1.1.3 → minimatch@10.2.5 (override) → brace-expansion (override)
ip-address@10.2.0       express-rate-limit@8.5.2 → ip-address
nanoid@3.3.16           vite@6.4.3 (dev) → postcss@8.5.23 → nanoid
```

## 3. Estrategia

Los tres padres **ya declaraban rangos que admiten la versión corregida**:

| Paquete | Rango declarado por el padre | Versión fijada en el lock | Corregida |
|---|---|---|---|
| `ip-address` | `^10.2.0` (`express-rate-limit`, en todas sus versiones hasta 8.6.2) | 10.2.0 | 10.5.0 |
| `nanoid` | `^3.3.16` (`postcss@8.5.23`) | 3.3.16 | 3.3.18 |
| `brace-expansion` | `^5.0.8` (`overrides` de este repo) | 5.0.8 | 5.0.9 |

El lockfile las tenía ancladas a la versión vulnerable simplemente porque nadie
había vuelto a resolverlas. La remediación mínima es, por tanto, **refrescar
esas tres entradas del lockfile** (`npm update ip-address nanoid brace-expansion`).

No hizo falta:

- actualizar ningún padre — subir `express-rate-limit` a 8.6.2 **no habría
  arreglado nada**: sigue declarando `^10.2.0`, el mismo rango;
- añadir overrides nuevos;
- ningún salto de major;
- `npm audit fix --force`, que habría arrastrado cambios masivos ajenos.

El único cambio en `package.json` es subir el suelo del override existente de
`brace-expansion` de `^5.0.8` a `^5.0.9`. Ese override existe precisamente como
suelo de seguridad, y declarar como suelo una versión que hoy se sabe
vulnerable es engañoso.

## 4. Delta aplicado

`package-lock.json`: **681 entradas antes y después**, sin paquetes añadidos ni
eliminados, y exactamente tres versiones distintas:

```
brace-expansion   5.0.8  → 5.0.9
ip-address        10.2.0 → 10.5.0
nanoid            3.3.16 → 3.3.18
```

`package.json`: una línea.

```diff
-    "brace-expansion": "^5.0.8",
+    "brace-expansion": "^5.0.9",
```

## 5. Riesgo de compatibilidad

**`ip-address` es el único con superficie de runtime real.** `server/server.js`
importa `ipKeyGenerator` de `express-rate-limit` y lo usa como `keyGenerator` de
los cinco limitadores (global, login, accept-invite, reset-request,
reset-confirm), así que `ip-address` interviene en **cada petición**. Es también
un salto de minor (10.2 → 10.5), el mayor del delta.

Verificado contra la superficie que el servidor consume de verdad: agrupación
IPv6 por subred `/56` estable, IPv4 intacta, entradas degeneradas sin excepción,
y limitación efectiva sobre HTTP real para IPv4 y para IPv6 sin arrastre entre
claves distintas.

**Una diferencia de comportamiento merece registrarse:** las direcciones
IPv4-mapped ahora se desenvuelven —`::ffff:192.168.1.1` produce la clave
`192.168.1.1`, no una clave IPv6—. Es exactamente lo que corrige
`GHSA-22jq-vg5j-6vgg`: antes una misma dirección podía contar como dos claves
distintas y eludir el límite. El efecto práctico es que un cliente IPv4-mapped
comparte cubo con su forma IPv4, que es lo correcto.

`brace-expansion` (parche) y `nanoid` (parche, dev-only) no tienen superficie de
API relevante. El bundle de frontend sale con **hashes idénticos** a los del
commit anterior, lo que confirma impacto nulo en el artefacto servido.

## 6. Verificación

| Gate / suite | Antes | Después |
|---|---|---|
| OSV (hallazgos activos, ignores vigentes aplicados) | 5 | **0** |
| `npm audit` (advisories activos) | 5 | **0** |
| Trivy `fs` (HIGH/CRITICAL, ignore-unfixed) | RC 1, 2 hallazgos | **RC 0** |
| Trivy `config` | — | **RC 0** |
| `npm ci` desde cero | — | **RC 0** |
| `test:identity-preflight` | — | GREEN |
| `test:identity` | — | GREEN |
| `test:store-isolation` | — | GREEN, 367 stores intactos |
| `lint:evidence` / `test:evidence` | — | GREEN |
| `typecheck:baseline` | — | GREEN, sin regresiones |
| `build` | — | GREEN |
| auth (`loginPersistsLastLoginAt`) | — | GREEN 11/11 |
| `metricsRequestContext` | — | GREEN 40/40 |
| compatibilidad `express-rate-limit` + `ip-address` | — | GREEN 14/14 |

Sobre los escaneos locales: hay que ejecutarlos contra un árbol de **solo
ficheros versionados**. El working tree contiene `.env`, `_prod_snapshot_/` y
`deployment_package/`, los tres gitignorados; Trivy los escanea si están
presentes y produce decenas de hallazgos que el CI **nunca ve** —lockfiles
congelados de despliegues viejos, con `multer@1.4.5-lts.2` y demás deuda ya
resuelta en el árbol real—. Confundirlos con hallazgos del CI lleva a
conclusiones equivocadas.

## 7. Lo que NO se tocó

Los ignores vigentes de `osv-scanner.toml` y `.trivyignore` se dejan como
están: OpenTelemetry (`GHSA-q7rr-3cgh-j5r3`, `GHSA-45rx-2jwx-cxfr`,
`GHSA-8988-4f7v-96qf`), `uuid` (`GHSA-w5hq-g745-h8pq`) y `react-router`
(`GHSA-qwww-vcr4-c8h2`). Todos tienen justificación de no alcanzabilidad y
`ignoreUntil` sin vencer.

**No se creó ninguna excepción nueva.** Los cinco advisories de esta unidad
tenían versión corregida disponible dentro de los rangos ya declarados: no
había nada que justificar, solo que corregir.

## 8. Rollback

```bash
git revert <sha de este commit>     # o borrar la rama, que no está fusionada
npm ci                              # restaura node_modules al lockfile anterior
```

Revertir devuelve `ip-address@10.2.0`, `nanoid@3.3.16` y
`brace-expansion@5.0.8`, y con ellos los cinco advisories y los dos gates en
rojo. No hay rollback de producción que ejecutar: esta unidad no despliega, no
construye imagen y no toca el VPS.

## 9. Deuda que queda abierta

- **`nanoid` volverá a aparecer.** El fix vive en el lockfile, no en un suelo
  declarado. Una regeneración del lockfile desde cero elegiría igualmente la
  última `3.3.x`, pero conviene revisarlo si `postcss` cambia de rango.
- **Los ignores caducan.** `GHSA-q7rr-3cgh-j5r3` y `GHSA-w5hq-g745-h8pq` vencen
  el **2026-08-31**; `GHSA-qwww-vcr4-c8h2` el **2026-09-30**;
  `GHSA-45rx-2jwx-cxfr` y `GHSA-8988-4f7v-96qf` el **2026-10-21**. Pasadas esas
  fechas `osv-scanner` deja de honrarlos y el gate vuelve a rojo por diseño. Las
  dos migraciones asociadas —Sentry v10 + OTel v2, y react-router 8.3.0— siguen
  pendientes.
- **Este tipo de rojo se repetirá.** Mientras el gate consulte una base viva,
  cualquier unidad futura puede encontrarse el CI rojo sin haber tocado nada. No
  es un fallo del proceso: conviene tratarlo como trabajo de seguridad normal y
  no como un bloqueo sorpresa.
