# Release v4.0.2 — Chibalete+

> **Primer release institucional reproducible de Chibalete+.**
> Resumen técnico del tag `v4.0.2`. Documento canónico de la release.
>
> **Estado operacional:** Frontend 🟢 **GO** · Backend 🔴 **NO-GO**.

## 0. Coordenadas del release

| Campo | Valor |
|---|---|
| Tag | `v4.0.2` (anotado) |
| Commit | `6dc5efba9e8afa937b03eccc94bfdcfbf4131601` (`6dc5efb`) |
| Branch | `sprint-022/operational-stack` |
| Fecha | 2026-05-22 |
| Tag anterior | `v4.0.1` → `72b39ef` (freeze 2026-05-21) |
| Tipo | Hardening de seguridad + build reproducible. **Sin cambios de código runtime.** |
| Remoto | `github.com/Darlaid/Chibalete-plus.git` — tag publicado y verificado |

La secuencia de tags `v4.0.0 → v4.0.1 → v4.0.2` es continua y todos son tags
anotados. `v4.0.2` formaliza el tag que ya se proponía en
`docs/V4-RELEASE-HARDENING.md §4` tras el upgrade de `multer`.

## 1. Qué cambió (`v4.0.1` → `v4.0.2`)

Delta de **4 commits / 10 archivos / +392 −59**. **Ningún archivo de código
runtime** (`server/`, viewers, `services/`, `pages/`) fue tocado: el
comportamiento de la aplicación es idéntico a `v4.0.1`.

| Commit | Área | Cambio |
|---|---|---|
| `3e32bd3` | CI seguridad | `security.yml` en verde: versión de Trivy corregida, OSV-Scanner + upgrade real `multer` → `^2.1.1`, gitleaks separado en `gitleaks-head` (bloqueante) y `gitleaks-history` (report-only) |
| `ca619fb` | CI seguridad | Trivy `fs`/`config` en verde: `.trivyignore` con `CVE-2026-44902` + `AVD-DS-0002` auditados |
| `c837fcc` | CI / imagen API | Trivy `image`: `npm` removido de la imagen API (menos superficie de ataque); `image-scan` queda report-only |
| `6dc5efb` | Docker build | `.dockerignore` añadido: contexto de build front **1.12 GB → 6.87 MB**, imagen **1.12 GB → 79 MB**, builds reproducibles |

Archivos modificados: `.dockerignore` (nuevo), `.github/workflows/security.yml`,
`.gitleaks.toml`, `.trivyignore`, `Dockerfile.api`, `osv-scanner.toml`,
`package.json`, `package-lock.json`, `docs/V4-RELEASE-HARDENING.md`,
`docs/V4-SECURITY-AUDIT.md`.

## 2. Riesgos eliminados

| Riesgo (en `v4.0.1`) | Estado en `v4.0.2` |
|---|---|
| Pipeline de seguridad CI en rojo (Trivy/OSV/gitleaks) | ✅ Verde y auditable |
| `multer@1.4.5-lts.2` (EOL, **7 HIGH** OSV; alcanzable vía `/api/upload`, `/api/leo/ingest`) | ✅ Upgrade a `multer@^2.1.1` (drop-in, cero cambio de código) |
| Contexto Docker de **1.12 GB** (incluía `node_modules`, `public/uploads`, `data`) | ✅ Contexto de **6.87 MB** vía `.dockerignore` |
| Imagen front de **1.12 GB**, no reproducible (dependía del filesystem local) | ✅ Imagen de **79 MB**, reproducible (todas las capas determinísticas) |
| `npm` embebido en la imagen API (superficie de ataque innecesaria) | ✅ Removido de `Dockerfile.api` |
| `ADMIN_SECRET` hardcoded en historia | ✅ Removido de HEAD ya en `v4.0.1` (gitleaks-history lo reporta como histórico) |

**No alcanzables / aceptados** (documentados en `docs/V4-SECURITY-AUDIT.md`):
3 HIGH de OpenTelemetry — el código vulnerable existe en `node_modules` pero
no se carga (Chibalete+ usa `prom-client`, no el exporter de OTEL). Upgrade
major de OTEL excede el scope de v4.

## 3. Artefacto reproducible

| Campo | Valor |
|---|---|
| Imagen | `chibalete/front:v4.0.2` |
| Image ID (manifest) | `13b6aead061e` |
| Tamaño imagen (`docker images`, descomprimido) | **78.9 MB** |
| Contexto de build transferido | **6.87 MB** |
| Base | `node:20-alpine` (builder) + `nginx:1.27-alpine` (runner) |
| Tarball portable | `chibalete-front-v4.0.2.tar` — **22 MB** (22 405 632 bytes) |
| Checksum | `chibalete-front-v4.0.2.tar.sha256` |
| SHA-256 | `b25b517268677ff452af22e4b9e71fb8aa3cf111962afea1f2ebd22348bf77aa` |
| Verificación | `sha256sum -c` → `OK` |

> **Nota sobre el tamaño — dos cifras correctas, no contradictorias:**
> `docker images` reporta **78.9 MB** = suma de capas **descomprimidas** (lo
> que ocupa la imagen corriendo; coincide con los "79 MB" del commit
> `6dc5efb`). El tarball de `docker save` pesa **22 MB** = capas
> **comprimidas** (gzip), que es lo que se transfiere por red y lo que un
> registry reportaría. La expectativa de "~22–30 MB" corresponde al
> **artefacto comprimido**, y el tarball entra exactamente en ese rango. No
> hay regresión: contexto pequeño (6.87 MB), sin `COPY` accidental, sin
> `uploads`, sin capas >100 MB.

## 4. Estado operacional real

### Frontend — 🟢 GO (deployable)

- Imagen `chibalete/front:v4.0.2` construida, reproducible y verificada.
- SPA estática servida por `nginx:1.27-alpine`; sin mounts, sin estado.
- Runtime de lectores estable, Aula Viva estable, Leo longitudinal operativo.
- Deploy = build de imagen + recreate del container `chibalete_front` +
  (si hace falta) reload de edge. No toca datos.

### Backend — 🔴 NO-GO (NO desplegable todavía)

- El backend permanece en **NO-GO operacional**. Esta release **no**
  habilita ni autoriza deploy de backend.
- `v4.0.2` arrastra en el árbol el bump de `multer 2.x` y el cambio de
  `Dockerfile.api`, pero **el backend no se despliega en esta ventana** →
  esos cambios no llegan a producción ahora.
- El NO-GO es **operacional**, no un fallo de seguridad: la validación
  operativa del backend (smoke, cambios pre-existentes, ventana de
  observación) sigue pendiente.

## 5. Qué queda pendiente

| Pendiente | Responsable | Bloquea |
|---|---|---|
| Rotación de `ADMIN_SECRET` | Operador | Deploy frontend (recomendado antes) |
| Smoke local completo | Operador | Deploy frontend |
| Validación operacional del backend | Operador / dirección | Salir del NO-GO de backend |
| Revisión de cambios pre-existentes (`App.tsx`, `useImmersivePlayback.ts`, etc. — ver `V4-RELEASE-HARDENING.md §1.2`) | Autores | Deploy backend |
| Añadir `chibalete-front-*.tar` / `*.tar.sha256` a `.gitignore` | Operador | — (higiene; ver §7) |

## 6. Qué NO debe desplegarse aún

**NO desplegar en esta ventana:**

- Backend (`chibalete_api_1`, `chibalete_api_2`).
- `server/` (bind mount) — no hacer swap.
- `docker-compose.yml` del backend — sin cambios.
- Mounts: `data`, `data-critical`, `public/uploads` — no tocar.
- SQLite (`events.db`, `insights.db`, `identity.db`) — no migrar, no tocar.
- Imagen `chibalete/api` — no rebuild, no push.

El único componente con luz verde es la **imagen frontend**.

## 7. Rollback de frontend — procedimiento exacto (FASE 6)

> Consistente con `docs/V4-ROLLBACK-RUNBOOK.md` **Nivel 3**. Aquí, concreto
> para el tag `v4.0.2`. El rollback recrea **solo** el container frontend.

### 7.1 Pre-deploy — capturar el tag previo (OBLIGATORIO)

Antes de desplegar `v4.0.2`, anotar qué imagen está corriendo, para tener
destino de rollback:

```bash
ssh root@72.60.158.97 'grep "chibalete/front:" /opt/chibaleteplus/docker-compose.yml'
# Anotar el tag → <TAG_PREVIO>  (ej. chibalete/front:v4.0.1)
# El deploy de frontend deja docker-compose.yml.bak con ese tag previo.
```

### 7.2 Rollback — recrear SOLO el frontend

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /opt/chibaleteplus

# 1. Confirmar que la imagen previa sigue disponible localmente
docker images chibalete/front
# Esperado: ver chibalete/front:v4.0.2  Y  chibalete/front:<TAG_PREVIO>

# 2. Restaurar docker-compose.yml al tag previo (.bak lo dejó el deploy)
mv docker-compose.yml docker-compose.yml.failed-$(date +%s)
mv docker-compose.yml.bak docker-compose.yml
grep 'chibalete/front:' docker-compose.yml   # validar que apunta a <TAG_PREVIO>

# 3. Recrear SOLO el container frontend (--no-deps = no toca api ni edge)
docker compose up -d --no-deps chibalete_front

# 4. Validar
docker ps --filter name=chibalete_front
curl -sI https://chibaleteplus.chibaleteeditores.com/ | head -5
EOF
```

### 7.3 Reglas del rollback frontend

- ✅ `docker compose up -d --no-deps chibalete_front` — `--no-deps` garantiza
  que **no se tocan** `chibalete_api_1`, `chibalete_api_2` ni `chibalete_edge`.
- ✅ No se toca el bind mount `server/`, ni `data`, ni `data-critical`, ni
  `public/uploads` — el frontend no monta ninguno de esos volúmenes.
- ❌ **NO usar `docker compose down`** — derriba los 4 containers, incluido el
  backend en producción. Prohibido.
- ❌ **NO reiniciar edge/nginx innecesariamente.** `chibalete_front` conserva
  su nombre y red; `chibalete_edge` lo resuelve por DNS interno y sigue
  ruteando. Solo si el smoke devuelve 502 tras recrear, hacer un **reload
  graceful** (no restart): `docker exec chibalete_edge nginx -t && docker exec
  chibalete_edge nginx -s reload`.
- ❌ NO `docker rmi chibalete/front` sin tag — podría borrar la imagen de
  rollback.
- El frontend es estático y sin estado: el rollback no implica pérdida de
  datos en ningún escenario.

## 8. Siguiente acción

1. **Rotar `ADMIN_SECRET`** (recomendado antes del deploy frontend).
2. **Smoke local completo** del build `v4.0.2` (`docs/V4-SMOKE-CHECKLIST.md`).
3. **Deploy frontend en ventana controlada**: cargar la imagen, recrear
   `chibalete_front`, validar. Backend permanece intacto y en NO-GO.

---

**Confirmación final:** Frontend 🟢 **GO** · Backend 🔴 **NO-GO**.
Tag `v4.0.2` publicado y verificado. Artefacto reproducible con checksum.
