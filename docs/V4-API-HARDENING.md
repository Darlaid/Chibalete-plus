# V4 — Deployment Hardening Sprint (H-1 … H-4)

> Healthchecks reales · hardening del `Dockerfile.api` · política de
> reproducibilidad. Endurece el deploy integral del backend v4.0.2.
>
> **Formalizado en `v4.0.3`:** la imagen hardened es el artefacto API oficial
> del release — `chibalete/api:v4.0.3` (= `v4.0.2-hardened`), exportado como
> `chibalete-api-v4.0.3.tar`. Ver `RELEASE-v4.0.3.md`.
>
> **Estado:** implementado y validado en local. **NADA desplegado.** No se
> tocó compose de prod, `api_1`/`api_2`, `data*`, `uploads` ni SQLite
> productivo. Fecha: 2026-05-22.
>
> Archivos modificados: `server/observability/health.js`, `Dockerfile.api`.

## H-1 — Healthchecks reales

### Contrato de health oficial

| Endpoint | Rol | Valida | Auth | Código |
|---|---|---|---|---|
| `/api/health` | **liveness** | proceso Node vivo + Express responde | público | siempre `200` |
| `/api/health/ready` | **readiness** | SQLite/mounts/runtime listos | público | `200` ready · `503` degraded |
| `/api/health/analytics` | analítico | `events.db` + shadow consistency + throughput | — | informativo |
| `/metrics` | Prometheus | métricas | — | `404` si `METRICS_ENABLED` off (by-design) |

**`/api/health`** (liveness) — intacto. `buildHealthPayload` (healthHandler.js):
sin DB, sin mounts, sin locks, < 5 ms. Es lo que el orquestador usa para
matar/reiniciar. NO se tocó.

**`/api/health/ready`** (readiness) — ya existía en v4.0.2 (`readinessHandler`,
`observability/health.js`): cacheado 5 s, sin locks, sin escrituras, robusto
(cada check en `safe()`). `degraded` ≠ `down`: informa, nunca tumba liveness.

### Gap cerrado (H-1.3)

El `readinessHandler` v4.0.2 chequeaba `process`, `disk` (solo `data-critical`),
`identity_sqlite` (flag-gated), `flags` — **no** verificaba los mounts `data/`
ni `public/uploads/`. Se añadió **un check aditivo `mounts`** a `buildReadiness`:

```js
checks.mounts = await safe(async () => {
    const dirs = { data:'./data', data_critical:'./data-critical', uploads:'./public/uploads' };
    // fs.accessSync(R_OK) por dir — barato, sin abrir DBs, sin queries.
    // events.db / progress.db: presencia informativa (la app los crea).
});
```

Cumple el contrato "mounts críticos accesibles" sin checks lentos ni queries
pesadas. Aditivo, `safe()`-wrapped, no altera los checks existentes.
"Event loop funcional" se valida transitivamente: si el loop estuviera
bloqueado, `/api/health/ready` no respondería dentro del timeout del healthcheck.

### Docker HEALTHCHECK (H-1.4)

Añadido a `Dockerfile.api` (la imagen viva no tenía ninguno):

```dockerfile
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD ["node","-e","fetch('http://127.0.0.1:3000/api/health/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"]
```

- Usa `/api/health/ready` (readiness, no liveness) → Docker distingue
  "proceso vivo" de "backend realmente listo".
- `node -e` + `fetch` nativo (node 20) — **sin curl, sin bash, sin scripts**.
- `start-period=40s` cubre el boot (~5-15 s medidos); `retries=3` × `interval=30s`
  → 90 s de fallo sostenido antes de `unhealthy`.

## H-2 — Hardening del Dockerfile API

### Auditoría de layers (H-2.1)

`docker history` de la imagen v4.0.2 (single-stage, 2.26 GB) reveló:
- **313 MB** — `apk add python3 make g++` (toolchain de build).
- **1.35 GB** — `RUN npm install` (node_modules **+ cache de npm + cruft**).
- El `apk del python3 make g++` posterior solo añadía un whiteout de 106 kB:
  **el toolchain seguía en la imagen** (capa anterior) — error clásico de
  layering. La "eliminación" era cosmética.

### Multi-stage (H-2.2 / H-2.3)

`Dockerfile.api` reescrito a **multi-stage**:
- **builder** — `node:20-alpine` + `apk add python3 make g++` + `npm install`.
  Compila `better-sqlite3` nativo. Esta etapa se **descarta** entera.
- **runtime** — `node:20-alpine` + `dumb-init` + `COPY --from=builder
  /app/node_modules` + `server/` + `scripts/` + `package.json`.

builder y runtime comparten **exactamente** `node:20-alpine` → ABI musl/alpine
compatible: el binario nativo de `better-sqlite3` se copia sin recompilar.

| | v4.0.2 (single-stage) | v4.0.2-hardened (multi-stage) |
|---|---|---|
| Tamaño imagen | **2.26 GB** | **853 MB** |
| Toolchain build en imagen | sí (313 MB) | **no** (solo en builder) |
| `node_modules` layer | 1.35 GB (con cache npm) | **562 MB** (copia limpia) |
| npm CLI | removido (whiteout) | removido + sin toolchain |
| Labels OCI | ninguno | `title` + `version` |
| HEALTHCHECK | ninguno | ✅ |

**Reducción: −1.41 GB (−62 %).** Segura: solo se eliminó toolchain de build y
cache de npm — cero impacto en runtime. No se tocaron dependencias (ver H-3).

## H-3 — Reproducibilidad controlada

### Problema

`Dockerfile.api` usa `npm install` (no `npm ci`) y **no copia
`package-lock.json`**. El lockfile se genera en el workstation Windows y pinnea
binarios/opcionales win32 → `npm ci` rompe el build en Alpine. `better-sqlite3`
(módulo nativo, node-gyp) agrava el cross-platform.

### Decisión: **reproducibilidad de ARTEFACTO, no de BUILD**

| Garantizamos | NO garantizamos |
|---|---|
| `multer ≥ 2.1.1` (rango `^2.1.1`) — verificado `2.1.1` en la imagen | Build byte-reproducible: un rebuild `--no-cache` puede resolver versiones transitivas distintas |
| Deps directas dentro de sus rangos `^` de `package.json` | Pinning exacto de transitivas (sin lockfile en el build) |
| **El artefacto desplegado == el validado**: build 1× → validar → `docker save` → `.tar` + `sha256` + tag inmutable → desplegar ESE tar | — |

**Riesgo aceptado:** drift de transitivas entre builds. **Mitigado por:**
(a) el pipeline de congelado de artefacto (build único, se despliega el `.tar`
con `sha256` conocido — bit-exacto); (b) el rango `^2.1.1` fija la versión de
`multer` relevante a seguridad; (c) Trivy/OSV en CI detectan si una transitiva
drifteada introduce un CVE.

**Procedimiento futuro (deuda futura, no bloqueante):** generar un
`package-lock.json` musl/Linux **dentro del builder Alpine** y usarlo para
`npm ci` en el builder — reproducibilidad de build sin el mismatch win32.

> Esto es "reproducibilidad suficiente para deploy seguro" — no pureza teórica.
> Lo que el deploy necesita ("lo que probé es lo que despliego") está cubierto
> por el tar inmutable + checksum + tag.

## H-4 — Validación operacional

Toda en local, sin tocar producción.

| Validación | Resultado |
|---|---|
| Build `chibalete/api:v4.0.2-hardened` | ✅ exit 0 |
| `better-sqlite3` nativo en la imagen | ✅ `new Database(':memory:')` + CREATE/INSERT/SELECT → devolvió `42` |
| `multer` / `express` / `node` | ✅ `2.1.1` / `5.2.1` / `v20.20.2` |
| Container arranca | ✅ "Server running on port 3000", modo PRODUCTION, routers montados |
| `/api/health` | ✅ `200` |
| `/api/health/ready` | ✅ `200` `status:"ready"` — check `mounts:{ok:true,data:ok,data_critical:ok,uploads:ok}` operativo |
| Docker HEALTHCHECK → healthy | ✅ `health=healthy`, healthcheck log `exit=0` |
| Path unhealthy | ✅ CMD del healthcheck sin readiness alcanzable → `exit 1` |
| Readiness timing | ✅ 15 ms (frío) → 1 ms (cacheado) |

## H-5 — Readiness assessment

### 🟢 Listo
- Contrato de health de 3 capas (liveness / readiness / analytics) — completo y validado.
- Docker `HEALTHCHECK` real implementado y verificado (healthy + unhealthy).
- Imagen API **−62 %** (2.26 GB → 853 MB), `better-sqlite3` nativo intacto.
- `multer 2.x`, `express 5`, `node 20` confirmados en la imagen hardened.

### 🟡 Requiere seguimiento (deuda futura)
- Reproducibilidad de build: `npm install` sin lockfile. Mitigado por el
  artefacto inmutable; el `npm ci` con lock Linux queda como mejora.
- Re-exportar el artefacto `.tar` desde `v4.0.2-hardened` (supersede a
  `chibalete-api-v4.0.2.tar`) — procedimiento idéntico a `V4-API-IMAGE-v4.0.2.md §6`.
- `node_modules` 562 MB — reducible vía poda de deps muertas (ej. `firebase`,
  reportado dead-code en `V4-SECURITY-AUDIT`). Fuera de scope: cambia
  `package.json`, requiere verificar cero imports. **Deuda futura.**

### Deuda aceptable
- 3 capas del compose sin healthcheck (`edge`, `front`) — el healthcheck de
  `api` es el crítico; añadir a edge/front es mejora menor.
- npm CLI sigon en la capa base node:alpine (el `rm` es whiteout) — superficie
  reducida funcionalmente; el peso es despreciable.

### 🔴 Blockers reales
- **Ninguno** introducido por este sprint.
- Recordatorio (de `V4-BACKEND-OPERATIONALIZATION`): el deploy integral exige
  además snapshot → staging → swap atómico en ventana controlada.

## Veredicto

# 🟢 Backend operacionalmente listo para snapshot → staging → swap

Los healthchecks son reales y validados; la imagen API es **62 % más liviana**
sin romper `better-sqlite3`; la política de reproducibilidad es explícita y
realista. **Nada desplegado.** Próximo paso: re-exportar el `.tar` hardened y
ejecutar — en ventana controlada — el plan de `V4-BACKEND-OPERATIONALIZATION.md`.
