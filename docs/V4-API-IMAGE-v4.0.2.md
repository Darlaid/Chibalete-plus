# V4 — Imagen API v4.0.2 como artefacto

> Operacionalización de la imagen backend Chibalete+ v4.0.2: tag inmutable de
> rollback, build versionado, validación de dependencias, artefacto exportable.
>
> Resuelve los blockers **B2** (rebuild de imagen) y **B3** (tag mutable) de
> `V4-BACKEND-OPERATIONALIZATION.md §8`.
>
> **Estado:** artefacto listo. **NADA desplegado.** No se tocó compose,
> containers, `data*`, `uploads` ni SQLite. Fecha: 2026-05-22.

## 1. Coordenadas

| Campo | Valor |
|---|---|
| Imagen v4.0.2 | `chibalete/api:v4.0.2` |
| Image ID | `sha256:caaee2af6b60…e3b6` (`caaee2af6b60`) |
| Tamaño imagen | 2.26 GB |
| Build context | 2.88 MB |
| Commit | `6dc5efb` (v4.0.2) |
| Artefacto | `chibalete-api-v4.0.2.tar` — 432 MB |
| SHA-256 | `1aacfbc0a3750c86d7539dde8f7cc913ecb9012ccc1aecce5e3377051787ce86` |
| Tag rollback | `chibalete/api:pre-v4.0.2` (en el VPS) |

## 2. Imagen API viva actual (FASE 1)

`chibalete_api_1` y `chibalete_api_2` corren **la misma imagen**:

| Campo | Valor |
|---|---|
| Tag | `chibalete/api:latest` |
| Image ID | `sha256:0001a71be10ac2a3…dadb1` (`0001a71be10a`) |
| Tamaño | 1.99 GB |
| Antigüedad | ~4 semanas |
| RepoDigest | ninguno (build local, nunca pusheado a registry) |
| Labels | ninguno |
| Entrypoint / Cmd | `dumb-init --` / `node server/server.js` |

**Riesgos de la imagen viva:**
- 🔴 Tag `:latest` **mutable** — sin referencia inmutable para rollback (resuelto en §3).
- 🟡 Sin labels ni RepoDigest → trazabilidad de versión nula a nivel de imagen.
- 🟡 4 semanas de antigüedad → predaría el endurecimiento de `Dockerfile.api` (npm stripped) y el bump de `multer`.

## 3. Tag inmutable de rollback (FASE 2)

Antes de construir nada, se congeló la imagen viva:

```bash
docker tag 0001a71be10a chibalete/api:pre-v4.0.2
```

Validado en el VPS:
- `chibalete/api:latest` y `chibalete/api:pre-v4.0.2` → **mismo image ID** `0001a71be10a`.
- `pre-v4.0.2` es un tag fijo: aunque `:latest` se reescriba en el deploy, `pre-v4.0.2` seguirá apuntando a la imagen de producción actual.
- **Este es el destino de rollback de la imagen API.**

## 4. Dockerfile.api + contexto auditados (FASE 3)

`Dockerfile.api` (`FROM node:20-alpine`):
- `COPY package.json ./` → `RUN npm install --omit=dev --prefer-offline`.
- `apk del python3 make g++` + `rm` de `npm`/`npx` → build tooling y npm CLI eliminados (reduce superficie de ataque).
- `COPY server/ ./server/` y `COPY scripts/ ./scripts/` — **no copia** `utils/`, `data/`, `data-critical/`, `public/uploads/`.
- Bootstrap de `/app/data/*.json` con placeholders vacíos (`[]`) — el bind mount de prod los sombrea.
- `ENTRYPOINT dumb-init --` · `CMD node server/server.js` · `EXPOSE 3000`.

Checklist FASE 3:

| Verificación | Resultado |
|---|---|
| `multer` 2.x | ✅ `package.json` `^2.1.1`, lockfile resuelve `2.1.1` |
| `node_modules` no viene del host | ✅ `.dockerignore` excluye `**/node_modules`; se instala dentro de la imagen |
| `data/` no se copia | ✅ `.dockerignore` excluye `data`; Dockerfile no la copia |
| `data-critical/` no se copia | ✅ `.dockerignore` excluye `data-critical` |
| `public/uploads/` no se copia | ✅ `.dockerignore` excluye `public/uploads` |
| `.git/` no se copia | ✅ `.dockerignore` excluye `.git` |
| Tarballs de release no se copian | ✅ `.dockerignore` excluye `*.tar`/`*.tar.gz`/`*.tgz` |
| Backups no se copian | ✅ bajo `data*/` (excluida) + `*.log` excluido |
| Contexto pequeño | ✅ **2.88 MB transferido** (no enorme — no DETENER) |

⚠️ **Limitación de reproducibilidad (conocida):** el Dockerfile usa `npm install`
(no `npm ci`) y **no copia `package-lock.json`** — decisión documentada en el
propio Dockerfile por el platform-mismatch de `better-sqlite3` (un lockfile
generado en el workstation Windows pinnea binarios win32). Consecuencia:
`multer 2.x` está garantizado por el rango `^2.1.1`, pero las versiones
transitivas exactas **no** están pinneadas → un rebuild `--no-cache` podría
resolver versiones distintas. La imagen es **versionada, rollbackable y
verificable**, pero no byte-reproducible. Follow-up en §10.

## 5. Build v4.0.2 (FASE 4)

```bash
docker build -f Dockerfile.api -t chibalete/api:v4.0.2 .
```

| Campo | Valor |
|---|---|
| Resultado | exit 0 — todas las capas CACHED (reproducible a nivel de capa) |
| Image ID | `caaee2af6b60` |
| Tamaño | **2.26 GB** |
| Contexto | 2.88 MB |
| Base | `node:20-alpine` |

**Diferencias vs imagen previa (`0001a71be10a`, 1.99 GB):**
- `multer` → **2.1.1** (la viva, de hace 4 sem, predaría el bump → 1.x).
- `npm`/`npx` **eliminados** de la imagen (la viva predaría el commit `c837fcc`).
- `node` `v20.20.2` + `server/` con el código v4.0.2 (estructura anidada, fix
  P0 GET-bypass).
- Tamaño **+270 MB** vs la viva — drift de base + dependencias; no es regresión
  (rango normal para una imagen node-alpine con `better-sqlite3` nativo).

## 6. Validación de dependencias dentro de la imagen (FASE 5)

`docker run --rm chibalete/api:v4.0.2 …` (sin tocar producción):

| Check | Resultado |
|---|---|
| `node` | `v20.20.2` ✅ |
| **`multer`** | **`2.1.1`** ✅ — 2.x confirmado DENTRO de la imagen |
| `better-sqlite3` | `11.10.0` ✅ |
| `express` | `5.2.1` ✅ |
| `/app/data` | solo 19 placeholders vacíos, 80 K — **sin datos reales** ✅ |
| `/app/data-critical` | **no existe** en la imagen ✅ |
| `/app/public/uploads` | **no existe** en la imagen ✅ |
| `npm` | **ausente** ✅ |

⚠️ **Nota — boot standalone no aplica:** la imagen hornea `server/` pero **no**
`utils/` (el modelo de prod monta `server/`+`utils/` por bind mount). Un
`docker run` sin mounts crashearía en `import '../utils/*.mjs'` — **por diseño,
no es defecto**. La validación de arranque completo corresponde a la fase de
staging/swap (con los bind mounts presentes), no a este artefacto.

## 7. Plan de carga en VPS (FASE 7) — diseño, NO ejecutar

```bash
# 1. Transferir artefacto + checksum al VPS
scp chibalete-api-v4.0.2.tar chibalete-api-v4.0.2.tar.sha256 root@72.60.158.97:/opt/chibaleteplus/artifacts/

# 2. En el VPS — verificar integridad ANTES de cargar
cd /opt/chibaleteplus/artifacts
sha256sum -c chibalete-api-v4.0.2.tar.sha256          # debe decir: OK

# 3. Cargar la imagen al daemon del VPS
docker load -i chibalete-api-v4.0.2.tar               # → carga chibalete/api:v4.0.2

# 4. Validar — la imagen queda DISPONIBLE pero NO en uso
docker images chibalete/api
#   Esperado tras la carga:
#     chibalete/api  latest      0001a71be10a   (en uso por api_1/api_2)
#     chibalete/api  pre-v4.0.2  0001a71be10a   (rollback)
#     chibalete/api  v4.0.2      caaee2af6b60   (cargada, lista, SIN USO)
```

**Hasta aquí, NADA cambia:** el compose sigue referenciando `chibalete/api:latest`;
`api_1`/`api_2` siguen corriendo `0001a71be10a`. La imagen `v4.0.2` solo queda
**lista en el daemon**. El swap (compose → `v4.0.2` + recreate escalonado) es la
fase posterior — ver `V4-BACKEND-OPERATIONALIZATION.md §5`.

## 8. Rollback de imagen API (FASE 8)

Si el deploy de `v4.0.2` falla, la API vuelve a `chibalete/api:pre-v4.0.2`.

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /opt/chibaleteplus

# 1. Backup del compose antes de editar
cp -p docker-compose.yml docker-compose.yml.bak-rollback-$(date -u +%Y%m%dT%H%M%SZ)

# 2. Apuntar api_1 y api_2 al tag inmutable de rollback
sed -i 's#chibalete/api:v4.0.2#chibalete/api:pre-v4.0.2#g' docker-compose.yml
grep 'image: chibalete/api' docker-compose.yml          # validar: ambos = pre-v4.0.2

# 3. Recreate escalonado (up -d detecta el cambio de imagen y recrea).
#    --no-deps → NO toca front ni edge.
docker compose up -d --no-deps api_1
until docker exec chibalete_api_1 node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"; do sleep 2; done
#    validar api_1: health 200 + escritura admin (x-admin-secret) → 200

docker compose up -d --no-deps api_2
until docker exec chibalete_api_2 node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"; do sleep 2; done
#    validar api_2
EOF
```

**Tiempo estimado:** 2-3 min. **Validación post-rollback:** `/api/health` 200 en
ambos · login admin real · escritura admin → 200 · `docker logs --since 5m` sin
5xx · `events.db` sigue creciendo.

**Garantías del rollback:**
- ✅ `--no-deps` → `chibalete_front` y `chibalete_edge` **no se tocan**.
- ✅ Los bind mounts `data`/`data-critical`/`public/uploads` no se mueven ni se
  remontan — el recreate del container los re-liga al mismo path.
- ❌ **Prohibido `docker compose down`** (derribaría los 4 containers).
- ❌ No `docker rmi chibalete/api` sin tag — borraría la imagen de rollback.

## 9. Riesgos restantes

| Riesgo | Sev | Nota |
|---|---|---|
| Build no byte-reproducible (`npm install`, sin lockfile) | 🟡 | `multer 2.x` sí garantizado y verificado; transitivas flotan. Follow-up §10 |
| Imagen sin `LABEL` de versión | 🟡 | trazabilidad solo por tag; añadir `LABEL` con commit/versión |
| `chibalete-api-v4.0.2.tar` (432 MB) untracked en el repo | 🔵 | `.dockerignore` excluye `*.tar` (no entra a contextos); `.gitignore` no — no commitear |
| Imagen `v4.0.2` +270 MB vs la viva | 🔵 | drift de base/deps, no regresión |
| Boot completo no validado en este artefacto | 🔵 | requiere bind mounts `server`+`utils` — corresponde a staging/swap |

## 10. Follow-ups

1. Hornear `LABEL org.opencontainers.image.revision=6dc5efb` + versión en `Dockerfile.api`.
2. Evaluar `npm ci` con un `package-lock.json` linux-compatible (o build multi-stage) para reproducibilidad byte-exacta — sopesar contra el platform-mismatch de `better-sqlite3`.
3. Considerar push a un registry para tener RepoDigest inmutable verificable.

## Recomendación

# 🟢 LISTO para snapshot / staging / swap

La imagen API v4.0.2 es un **artefacto real**: versionado (`chibalete/api:v4.0.2`),
verificable (`multer 2.1.1` confirmado dentro), exportado (`chibalete-api-v4.0.2.tar`
432 MB, sha256 verificada) y **rollbackable** (`chibalete/api:pre-v4.0.2`
inmutable, creado y validado en el VPS). Los blockers **B2** y **B3** de
`V4-BACKEND-OPERATIONALIZATION.md` quedan **resueltos**.

Riesgos restantes son 🟡/🔵 — ninguno bloquea avanzar. **No se desplegó nada:**
compose, containers, `data*`, `uploads` y SQLite intactos.
