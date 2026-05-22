# Release v4.0.3 — Chibalete+ (release institucional integral)

> Consolidación final del release integral: v4.0.2 + fixes de runtime frontend
> + Deployment Hardening Sprint. Documento maestro del release.
>
> **Estado operacional:** Frontend 🟢 (requiere rebuild de imagen — ver §8) ·
> Backend 🟢 listo para snapshot → staging → swap.
> **NADA desplegado.** Este doc cierra el release antes de la ventana de deploy.

## 0. Coordenadas

| Campo | Valor |
|---|---|
| Release | `v4.0.3` |
| Base | `v4.0.2` (`6dc5efb`) |
| Branch | `sprint-022/operational-stack` |
| Fecha | 2026-05-22 |
| Tipo | Consolidación integral — fixes runtime frontend + hardening operacional backend |
| Imagen API | `chibalete/api:v4.0.3` (= `v4.0.2-hardened`) — 853 MB |
| Imagen rollback API | `chibalete/api:pre-v4.0.2` (en el VPS) |

## 1. Qué es v4.0.3

`v4.0.3` consolida, sobre la base estable `v4.0.2` (`6dc5efb`):
1. **Fixes de runtime frontend** — `canStartAudio` (ReferenceError eliminado) +
   `EDITORIAL_COVER_SYSTEM` ON por defecto.
2. **Deployment Hardening Sprint** — healthchecks reales, `Dockerfile.api`
   multi-stage (−62 % de tamaño), readiness multi-capa, contrato de health.

No hay cambios de arquitectura, de modelo de datos ni de autenticación.

## 2. Cambios vs v4.0.2

### Frontend
- `hooks/useImmersivePlayback.ts` — elimina la referencia rota `canStartAudio`
  de `getStartDiagnostic` (cerraba un `ReferenceError` en la ruta de
  diagnóstico de playback atascado). Detalle: smoke v4.0.2 BUG-1.
- `components/ContentCard.tsx` — `EDITORIAL_COVER_SYSTEM` **ON por defecto**
  (kill switch `localStorage==='0'`): las cubiertas respetan su aspect-ratio,
  sin crop destructivo.
- Tests estructurales actualizados (`EditorialCover`, `playbackStartDiagnostic`).

### Backend (hardening)
- `server/observability/health.js` — check `mounts` aditivo en `readiness`
  (`data/`, `data-critical/`, `public/uploads/` accesibles; barato, `safe()`).
- `Dockerfile.api` — **multi-stage** (builder descarta el toolchain de build) +
  **`HEALTHCHECK`** real contra `/api/health/ready` + labels OCI.

### Docs
`RELEASE-v4.0.2.md`, `V4-BACKEND-OPERATIONALIZATION.md`, `V4-API-IMAGE-v4.0.2.md`,
`V4-API-HARDENING.md`, este `RELEASE-v4.0.3.md`.

## 3. Artefactos

| Artefacto | Valor |
|---|---|
| Imagen API | `chibalete/api:v4.0.3` — 853 MB (de 2.26 GB, −62 %) |
| Tarball API | `chibalete-api-v4.0.3.tar` (~430 MB) + `.sha256` |
| Imagen rollback API | `chibalete/api:pre-v4.0.2` (VPS) |
| Imagen frontend | ⚠️ debe rebuildearse para v4.0.3 — ver §8 |

`chibalete-api-v4.0.2.tar` queda **superado** — el artefacto API del release
es el de `v4.0.3` (hardened).

## 4. Contrato de health / healthchecks

| Endpoint | Rol | Código |
|---|---|---|
| `/api/health` | liveness (proceso+Express, <5 ms) | siempre `200` |
| `/api/health/ready` | readiness (process·disk·mounts·sqlite·flags) | `200` ready / `503` degraded |
| `/api/health/analytics` | analítico | informativo |
| `/metrics` | Prometheus | `404` si `METRICS_ENABLED` off (by-design) |

**Docker `HEALTHCHECK`** en `Dockerfile.api`: `interval=30s timeout=5s
start-period=40s retries=3`, `node -e`+`fetch` contra `/api/health/ready`.
Validado: container hardened → `health=healthy`; CMD sin readiness → `exit 1`.

## 5. Estado operacional

- **Frontend** 🟢 runtime validado + smoke humano aprobado. ⚠️ **La imagen
  debe rebuildearse** (la `chibalete/front:v4.0.2` predata los fixes — §8).
- **Backend** 🟢 operacionalmente listo: imagen hardened reproducible-como-
  artefacto, healthchecks reales, `better-sqlite3`/`multer 2.1.1` validados.
  **No desplegado** — pendiente de la ventana snapshot → staging → swap.

## 6. Reproducibilidad adoptada

**"Reproducibilidad de artefacto, no de build"** (ver `V4-API-HARDENING.md §3`).
Se garantiza: `multer ≥2.1.1`; el artefacto desplegado == el validado (build
1× → `docker save` → `.tar`+`sha256`+tag inmutable). No se garantiza build
byte-reproducible (`npm install` sin lockfile — razón: mismatch win32 con
`npm ci` en Alpine). Riesgo aceptado, mitigado por el congelado de artefacto.

## 7. Rollback

| Capa | Destino | Procedimiento |
|---|---|---|
| Frontend | imagen previa | `RELEASE-v4.0.2.md §7` |
| Imagen API | `chibalete/api:pre-v4.0.2` | `V4-API-IMAGE-v4.0.2.md §8` |
| `server/`+`utils/` | `*.pre-v4.0.3-<ts>` | swap inverso, `V4-BACKEND-OPERATIONALIZATION.md §5-6` |
| compose / env | `.bak` timestamped | restaurar + `--force-recreate` escalonado |

Reglas absolutas: **nunca `docker compose down`**; `data*`/`uploads` jamás se
mueven; recreate escalonado `api_1`→validar→`api_2`.

## 8. Riesgos aceptados / deuda

- ⚠️ **Rebuild de imagen frontend para v4.0.3 (pre-deploy obligatorio).** La
  `chibalete/front:v4.0.2` (79 MB) se construyó en `6dc5efb`, **antes** de los
  fixes `canStartAudio` + `EDITORIAL_COVER`. Para el deploy integral hay que
  `docker build -f Dockerfile.front -t chibalete/front:v4.0.3 .` desde el árbol
  v4.0.3 y exportar el artefacto (procedimiento: `RELEASE-v4.0.2.md`).
- 🟡 Reproducibilidad de build parcial (`npm install`) — mitigada (§6).
- 🟡 `node_modules` 562 MB — reducible podando deps muertas (`firebase`) — deuda futura.
- 🟡 `edge`/`front` sin Docker healthcheck (el de `api` es el crítico).
- 🔵 Markers de deploy del backend desplegado inconsistentes (`V4-BACKEND-OPERATIONALIZATION.md §1`).
- 🔵 DR off-host inexistente para los 5 GB de `uploads`.

## 9. Siguiente fase — checklist operacional (snapshot → swap → deploy)

> Ejecutar EN ORDEN, en ventana controlada. Detalle en
> `V4-BACKEND-OPERATIONALIZATION.md` y `V4-API-IMAGE-v4.0.2.md`.

### 9.1 Pre-deploy
- [ ] Rebuild + export de `chibalete/front:v4.0.3` (§8).
- [ ] Re-export confirmado de `chibalete-api-v4.0.3.tar` + `.sha256`.
- [ ] `scp` de ambos artefactos al VPS + `sha256sum -c`.

### 9.2 Snapshot (`V4-BACKEND-OPERATIONALIZATION.md §3`)
- [ ] `server/` + `utils/` → `tar` timestamped.
- [ ] SQLite vía `sqlite3 .backup` (events.db, progress.db) — nunca `cp` sobre WAL.
- [ ] `data/` → `tar`; `public/uploads/` (5 GB) → `tar` sin gzip.
- [ ] Checksums `sha256` + `PRAGMA integrity_check` en los `.db`.

### 9.3 Staging
- [ ] `server.v4.0.3` + `utils.v4.0.3` extraídos junto a los vivos (sin reemplazar).
- [ ] `docker load -i chibalete-api-v4.0.3.tar`.
- [ ] `diff -rq` staging vs vivo; permisos/ownership.

### 9.4 Swap atómico (`V4-BACKEND-OPERATIONALIZATION.md §5`)
- [ ] `mv server server.pre-v4.0.3-<ts>` · `mv utils utils.pre-v4.0.3-<ts>`.
- [ ] `mv server.v4.0.3 server` · `mv utils.v4.0.3 utils`.
- [ ] compose `image:` → `chibalete/api:v4.0.3`.
- [ ] `docker compose up -d --no-deps --force-recreate api_1` → **validar** → `api_2` → **validar**.

### 9.5 Frontend deploy
- [ ] `docker compose up -d --no-deps --force-recreate front` con `chibalete/front:v4.0.3`.
- [ ] `docker exec chibalete_edge nginx -t && nginx -s reload` (solo si hace falta).

### 9.6 Smoke producción
- [ ] `auth` (login admin real) · `Aula Viva` · `Leo` · `uploads` ·
      `immersive` · `analytics` · `/api/health` + `/api/health/ready`.

## 10. Veredicto

# 🟢 v4.0.3 consolidado — listo para snapshot → staging → swap

Backend operacionalmente listo (imagen hardened, healthchecks, rollback). El
**único pendiente pre-deploy** es el rebuild de la imagen frontend v4.0.3 (§8).
Nada desplegado.
