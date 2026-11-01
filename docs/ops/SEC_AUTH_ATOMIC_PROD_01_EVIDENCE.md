# SEC-AUTH-ATOMIC-PROD-01 — Evidencia de despliegue

**Fecha:** 2026-11-01. **Veredicto:** `GREEN_PROD`. **Pendiente de observar:** un login real correcto.

## Release

| Campo | Valor |
|---|---|
| Base productiva | `3091a250adbc02af0b9ffde616b69770f6ae7e24` |
| Hotfix | `a0b48c5c4ab4e0e82b0673c88ccef4b473d15c5d`, rama `chp/sec-auth-atomic-hotfix-01` |
| Imagen | `chibalete/api:authatomic-a0b48c5`, ID `6f5fe4eb591d373d…` |
| SHA-256 del tar | `376108bc9aed4912fd8adfa85f202de2b3752371cacb27724ffc793e38af1c84` |
| Frontend | `g0-f4836d1`, sin cambios |
| Override | `454a0c4ed076890c…` → `f6c64f7ca366173a…`, solo líneas 40 y 85 |

## CI del hotfix

- `content-rmw`: verde.
- `identity-preflight`: verde en el intento 2. `loginAtomicity` 34/34, sin aserciones fallidas.
- `security`: 7/8 jobs verdes; falla solo `osv-scanner`, por la excepción siguiente.
- Intento 1 de `identity-preflight`: `retireSyntheticCohort` falló porque `4900 + pid % 200` dio 5060, puerto que `fetch` rechaza (`bad port`). El defecto es de la prueba, existe en la base y está corregido en la rama de desarrollo por TECH-STABILITY-01. Se relanzó el mismo SHA.

## Excepción OSV

Autorizada por Dirección solo para vulnerabilidades heredadas y solo para este despliegue. `package-lock.json`, `osv-scanner.toml` y `Dockerfile.api` son idénticos a la base; `node_modules` en imagen también.

| Identificador | Paquete | Versión | CVSS | En imagen API |
|---|---|---|---|---|
| GHSA-3g3m-2fjr-6pw4 | glob | 10.5.0 | 6.3 | Sí |
| GHSA-g3hv-75wg-m249 | minimatch | 10.2.5 | 6.9 | Sí |
| GHSA-8g5g-mxqh-grgj | vite (dev) | 6.4.4 | 6.9 | No |

Comparación con la imagen anterior: OSV 3 → 3 y Trivy 3 → 3, sin altas ni bajas. Trivy: 0 CRITICAL, 0 HIGH, 3 MEDIUM (zlib 1.3.2-r0, minimatch, glob). `GHSA-mrhx-c7xc-m3w5` sigue filtrado por la configuración vigente.

## Preflight

- `api_1`, `api_2`, edge y front saludables; `server.js` y `usersLock.js` iguales a los blobs de `3091a25`.
- Ambas réplicas ven `dev=2049 ino=812308`, ext4 local, bind mount rw.
- Padrón válido, 672 registros, sin registros sin id, hash `dda8613b0002b2e7…`.
- Respaldo: snapshot `7a199332`, 12:04Z, posterior a la última escritura del padrón (2026-10-31 20:07Z). Su copia del padrón, leída en memoria, coincidió por hash con el vivo.

## Despliegue

Drain por instancia, 65 s, recreate y gate en paso separado.

| Réplica | Inicio | Estado |
|---|---|---|
| `api_1` | 16:48:56Z | healthy en 22 s |
| `api_2` | 16:50:55Z | healthy en 20 s |

Versiones mezcladas: unos 2 minutos, con tráfico concentrado en una réplica.

## Después del despliegue

- Mismo digest en ambas réplicas, `RestartCount` 0, pool del edge con las dos.
- `/api/health` 200; login sintético 401; anónimo 401; spoof 401; front 200.
- Vigilancia hasta 17:01Z: 10/10 muestras sanas, padrón 672 en todas.
- `ELOCKTIMEOUT`, lock obsoleto, errores de escritura, `CANONICAL_MUTATION`, excepciones y `[ERROR]`: 0 en ambas réplicas.
- 5xx del edge desde 16:48Z: 0.
- Padrón sin cambios: mismo hash y mtime. Sin `.tmp` ni `.lock` en `data/` ni `data-critical/`.
- No hubo logins reales en la ventana: el camino correcto queda probado por suites y contenedores, no observado en producción.

## Rollback

Preparado, no usado. Tag `chibalete/api:rollback-pre-authatomic` = `30a574aad701`. Instrucciones en `/root/chp-authatomic/ROLLBACK.txt`. No requiere migrar datos, pero reabre el defecto.
