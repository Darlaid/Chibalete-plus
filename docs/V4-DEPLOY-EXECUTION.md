# V4 Deploy Plan — Redesigned (post Kodee VPS audit)

> **Estado:** redesign 2026-05-20. Reemplaza la versión previa de este doc
> (que asumía un flujo git-driven en VPS y endpoints `/api/health/ready` y
> `/api/health/analytics` ya en producción — supuestos falsos según la
> auditoría real de Kodee).
>
> **No se ejecutó deploy.** Este doc es el plan que el operador humano
> debe seguir, con decisiones GO/NO-GO ya tomadas a la entrada.

---

## 0. Executive summary

| Stage | Decisión | Razón |
|---|---|---|
| **A — Frontend v4** | **GO condicional** (operador) | Image-driven, sin bind mounts, rollback de 1 línea en compose. Riesgo acotado: si el frontend nuevo llama APIs backend v4 que aún no existen, esas vistas mostrarán errores pero el resto sigue. Validar smoke antes de declarar verde. |
| **B — Backend v4** | **NO-GO** hasta cerrar Operationalization Sprint (B1-B14) | Producción real usa bind-mount `/var/www/chibalete/server` + `/var/www/chibalete/utils`. No hay `.git` usable en VPS. La imagen `chibalete/api:latest` no contiene el código gobernando. No hay snapshot ni rollback real validado. Hacer swap de `server/` sin estos pasos es irrevocable y arriesga corromper data. |

**Reglas absolutas no negociables:**

- NO tocar `/var/www/chibalete/data`, `data-critical`, `public/uploads`.
- NO tocar `/root/apps-spa/chibaleteplus` (legacy, no gobierna producción).
- NO usar `git checkout` en VPS (no hay `.git` usable).
- NO usar `docker compose down`.
- NO activar flags v4 backend hasta smoke verde post backend deploy.
- Frontend y backend NO se mezclan: no se toca backend hasta que sea
  release-managed y rollbackable.

**Prioridad explícita:** `datos > deploy`, `rollback > velocidad`, `evidencia > suposición`.

---

## 1. Hechos confirmados (Kodee audit + repo)

### Producción real

| Campo | Valor |
|---|---|
| Dominio | `https://chibaleteplus.chibaleteeditores.com` |
| Compose canónico | `/opt/chibaleteplus/docker-compose.yml` |
| Containers | `chibalete_edge`, `chibalete_front`, `chibalete_api_1`, `chibalete_api_2` |
| Imagen frontend actual | `chibalete/front:sprint-022-e73b9cf` |
| Imagen API actual | `chibalete/api:latest` |
| VPS | `root@72.60.158.97` |

### Frontend

- **Image-driven puro.** Sin bind mounts. Deploy = nueva imagen → update compose → recreate container → reload edge.
- Build local con `Dockerfile.front` produce SPA + nginx alpine.

### Backend

- Imagen `chibalete/api:latest` corre el runtime pero **el código gobernando viene del host**:
  - `/var/www/chibalete/server` → `/app/server:ro`
  - `/var/www/chibalete/utils` → `/app/utils:ro`
- Data crítica en bind mounts:
  - `/var/www/chibalete/data`
  - `/var/www/chibalete/data-critical` (incluye `events.db` sqlite)
  - `/var/www/chibalete/public/uploads`

### Drift respecto a runbooks previos

| Endpoint | Estado real |
|---|---|
| `/api/health` | OK |
| `/api/health/ready` | **404** (no existe en producción actual) |
| `/api/health/analytics` | **404** (no existe en producción actual) |

→ Los healthchecks asumidos en `V4-DEPLOY-RUNBOOK.md` y en la versión previa de este doc **no pueden usarse como gate**. Solo `/api/health` es contractual hoy. Los otros aparecerán **después** del backend v4 deploy.

### Repos / código

- Local: branch `sprint-022/operational-stack`, commit `fb2f610` = tag `v4.0.0`, working tree limpio salvo este doc.
- VPS: **NO hay `.git` usable** ni en `/var/www/chibalete` ni en `/root/apps-spa/chibaleteplus`. → todo deploy de código debe ir por paquete tarball verificado por checksum, **no por git pull / git checkout**.
- `/root/apps-spa/chibaleteplus` es **legacy**. No gobierna producción. No tocar.

---

## 2. STAGE A — Frontend v4 deploy

### A.0 Pre-condiciones (GO solo si todas verdes)

- [ ] Docker daemon UP en workstation del operador (`docker info` responde).
- [ ] Working tree limpio en commit `fb2f610` / tag `v4.0.0`.
- [ ] `npm ci && npm run build` exit 0 en workstation.
- [ ] `npm audit --omit=dev` → critical 0 (3 high OTEL aceptados, ver `V4-SECURITY-AUDIT.md`).
- [ ] Backup del compose actual disponible **antes** de cualquier cambio (paso A.7).
- [ ] Tag previo del frontend conocido y anotado (paso A.7).

Si falta cualquiera → **STOP**.

### A.1 Build de la imagen frontend (workstation)

```bash
cd /path/to/repo
git checkout v4.0.0
git log --oneline -1   # → fb2f610

TAG=v4.0.0
docker build -f Dockerfile.front -t chibalete/front:$TAG .
docker images chibalete/front:$TAG
docker history chibalete/front:$TAG | head -5
```

### A.2 Export tarball + checksum

```bash
docker save chibalete/front:$TAG -o /tmp/chibalete-front-$TAG.tar
sha256sum /tmp/chibalete-front-$TAG.tar > /tmp/chibalete-front-$TAG.tar.sha256
ls -lh /tmp/chibalete-front-$TAG.tar*
```

Tamaño esperado: 50-150 MB.

### A.3 SCP al VPS

```bash
scp /tmp/chibalete-front-$TAG.tar         root@72.60.158.97:/root/
scp /tmp/chibalete-front-$TAG.tar.sha256  root@72.60.158.97:/root/
```

### A.4 Verificar checksum y load en VPS

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /root
sha256sum -c chibalete-front-v4.0.0.tar.sha256   # debe imprimir OK
docker load -i chibalete-front-v4.0.0.tar
docker images | grep "chibalete/front"
EOF
```

Si `sha256sum -c` falla → **STOP**, retransmitir.

### A.5 Pre-flight VPS (read-only)

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /opt/chibaleteplus
docker ps
docker compose ps
df -h | head -3
free -h | head -3
for c in chibalete_edge chibalete_front chibalete_api_1 chibalete_api_2; do
  status=$(docker inspect "$c" --format '{{.State.Status}}' 2>/dev/null || echo "MISSING")
  echo "$c: $status"
done
EOF
```

Los 4 deben estar `running`. Si alguno `exited` o `MISSING` → **STOP**.

### A.6 Capturar estado previo (para rollback)

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
docker inspect chibalete_front --format '{{.Config.Image}}' > /root/front-image-pre-v4.txt
cat /root/front-image-pre-v4.txt
EOF
```

Anotar localmente: `IMAGE_PREV=chibalete/front:sprint-022-e73b9cf` (o lo que reporte).

### A.7 Backup compose + diff controlado

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /opt/chibaleteplus
TS=$(date -u +%Y%m%dT%H%M%SZ)
cp docker-compose.yml docker-compose.yml.bak-v4-front-$TS
echo "BAK_FRONT=$TS"

# Mostrar las líneas exactas de imagen
grep -n "chibalete/front" docker-compose.yml

# Cambio QUIRÚRGICO — solo el tag del frontend
sed -i.tmp "s|chibalete/front:[^[:space:]]*|chibalete/front:v4.0.0|g" docker-compose.yml
rm -f docker-compose.yml.tmp

# El diff DEBE mostrar exactamente 1 línea cambiada (el image: del front)
diff -u docker-compose.yml.bak-v4-front-$TS docker-compose.yml || true
EOF
```

Si el diff muestra algo distinto a **una sola línea** del tag de `chibalete/front`:

```bash
ssh root@72.60.158.97 'cp /opt/chibaleteplus/docker-compose.yml.bak-v4-front-$TS /opt/chibaleteplus/docker-compose.yml'
```

y **STOP**, investigar.

### A.8 Recreate solo el frontend

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /opt/chibaleteplus
docker compose up -d --no-deps chibalete_front
sleep 3
docker ps --filter name=chibalete_front
docker logs --tail=50 chibalete_front
EOF
```

NO usar `down`, NO tocar `chibalete_api_1`, `chibalete_api_2`, `chibalete_edge` aquí.

### A.9 Reload edge

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
docker exec chibalete_edge nginx -t
docker exec chibalete_edge nginx -s reload
docker logs --tail=20 chibalete_edge
EOF
```

### A.10 Healthcheck externo (lo único contractual hoy)

```bash
curl -fsS https://chibaleteplus.chibaleteeditores.com/api/health | head -c 300; echo
```

Esperado: HTTP 200 con payload JSON.

**Importante:** `/api/health/ready` y `/api/health/analytics` aún devolverán 404 (backend no se tocó). Eso es esperado en Stage A.

### A.11 Smoke frontend (manual, navegador)

| Caso | Resultado esperado |
|---|---|
| Login con cuenta real | OK |
| Biblioteca carga | OK |
| Portadas vertical / apaisada / cuadrada | OK |
| `/leer/pdf/:id` abre | OK |
| `/leer/texto/:id` (Modo Guiado) abre | OK |
| `/leer/inmersivo/:id` abre | OK |
| `/ver/album/:id` abre | OK |
| Leo responde | OK *si backend actual lo soporta* |
| Aula Viva carga | OK *si backend actual lo soporta* |
| Vistas que dependen de APIs **nuevas v4** | Pueden mostrar errores → documentar, **no es rollback** |

Si alguno de los críticos (login, biblioteca, lectores, healthcheck) falla → **ROLLBACK A** (§ A.12).

### A.12 Rollback Stage A

Pre-condición: `BAK_FRONT` y `IMAGE_PREV` capturados en A.6/A.7.

```bash
ssh root@72.60.158.97 << EOF
set -euo pipefail
cd /opt/chibaleteplus
cp docker-compose.yml.bak-v4-front-$BAK_FRONT docker-compose.yml
docker compose up -d --no-deps chibalete_front
sleep 3
docker exec chibalete_edge nginx -t && docker exec chibalete_edge nginx -s reload
docker ps --filter name=chibalete_front
EOF

curl -fsS https://chibaleteplus.chibaleteeditores.com/api/health | head -c 300; echo
```

Tiempo objetivo: < 2 min desde decisión a healthcheck verde.

---

## 3. STAGE B — Backend Operationalization Sprint

**Decisión:** **NO-GO** para deploy backend v4 hasta completar B1-B14 con éxito.

**Por qué obligatorio antes de cualquier swap de `server/`:**

1. No hay `.git` en VPS → no se puede `git checkout v4.0.0` para rollback.
2. La imagen `chibalete/api:latest` no contiene el código gobernando (bind-mount manda). Sin snapshot del `server/` actual, **no hay rollback posible** una vez sobrescrito.
3. Producción no tiene `/api/health/ready` ni `/api/health/analytics` → si backend v4 los agrega, son **nuevos** y no pueden usarse como gate hasta confirmar que existen.
4. `events.db` (sqlite WAL) en `data-critical` puede corromperse si el process es matado en mal momento → integrity_check obligatorio post-deploy.
5. El `package.json` cambió por hardening (overrides protobufjs + bump express-rate-limit) → la imagen API actual lleva lockfile vulnerable. Rebuild de imagen API es necesario.

### B1 — Auditoría backend actual (read-only)

```bash
ssh root@72.60.158.97 << 'EOF'
set -e
echo "=== Host server dir ==="
ls -la /var/www/chibalete/server | head -50
echo "=== Host utils dir ==="
ls -la /var/www/chibalete/utils | head -50
echo "=== File counts ==="
find /var/www/chibalete/server -maxdepth 2 -type f | wc -l
find /var/www/chibalete/utils  -maxdepth 2 -type f | wc -l
echo "=== Container Node ==="
docker exec chibalete_api_1 node -v
docker exec chibalete_api_1 npm -v
echo "=== Container view of mounts ==="
docker exec chibalete_api_1 ls -la /app/server | head
docker exec chibalete_api_1 ls -la /app/utils  | head
EOF
```

Responder por escrito:

- Qué archivos gobiernan el backend (esperado: lo que se ve en `/var/www/chibalete/server`).
- Versión Node (esperado: `v20.x`).
- Si `/app/server` refleja `/var/www/chibalete/server` (esperado: sí, bind-mount).
- Si `/app/utils` refleja `/var/www/chibalete/utils`.

Si algo no cuadra → **STOP**, documentar antes de seguir.

### B2 — Snapshot release actual (inmutable)

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
echo "TS=$TS"
mkdir -p /root/chibalete-releases/backend-current-$TS

cp -a /var/www/chibalete/server /root/chibalete-releases/backend-current-$TS/server
cp -a /var/www/chibalete/utils  /root/chibalete-releases/backend-current-$TS/utils

du -sh /root/chibalete-releases/backend-current-$TS/server
du -sh /root/chibalete-releases/backend-current-$TS/utils

# Marcar como inmutable (defensa contra rm accidental)
chattr +i -R /root/chibalete-releases/backend-current-$TS 2>/dev/null || \
  echo "WARN: chattr no aplicable en este FS — confiar en no-rm manual"
EOF
```

Anotar `TS` en este doc al cierre del sprint.

### B3 — Backup datos críticos

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p /root/chibalete-backups/$TS

tar -czf /root/chibalete-backups/$TS/data.tgz          -C /var/www/chibalete data
tar -czf /root/chibalete-backups/$TS/data-critical.tgz -C /var/www/chibalete data-critical
tar -czf /root/chibalete-backups/$TS/uploads.tgz       -C /var/www/chibalete/public uploads
cp /opt/chibaleteplus/docker-compose.yml /root/chibalete-backups/$TS/docker-compose.yml

ls -lh /root/chibalete-backups/$TS
EOF
```

**Tamaños esperados:**
- `data.tgz` > 5 MB
- `data-critical.tgz` > 100 KB (crece con uso de events.db)
- `uploads.tgz` > 50 MB
- compose: pocos KB

Si algún tar es 0 bytes o falla → **STOP**.

### B4 — Crear paquete backend v4 (workstation)

NO copiar archivos sueltos. Paquete versionado y firmado.

Estructura:

```
backend-v4.0.0/
├── server/
├── utils/
├── package.json
├── package-lock.json
└── RELEASE.txt
```

`RELEASE.txt` debe incluir:

```
commit:    fb2f610
tag:       v4.0.0
fecha:     <ISO 8601 UTC>
contenido: server/ + utils/ + package.json + package-lock.json
checksum:  <sha256 del .tar.gz, llenado tras comprimir>
notas:     hardening seguridad (overrides protobufjs, bump express-rate-limit),
           agrega /api/health/ready y /api/health/analytics, agrega /metrics,
           agrega eventos backbone y aula viva audit (gated por flags).
```

Comprimir:

```bash
cd /path/to/staging
tar -czf backend-v4.0.0.tar.gz backend-v4.0.0/
sha256sum backend-v4.0.0.tar.gz > backend-v4.0.0.tar.gz.sha256
ls -lh backend-v4.0.0.tar.gz*
```

Subir al VPS:

```bash
scp backend-v4.0.0.tar.gz         root@72.60.158.97:/root/
scp backend-v4.0.0.tar.gz.sha256  root@72.60.158.97:/root/
```

### B5 — Validar paquete en VPS

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /root
sha256sum -c backend-v4.0.0.tar.gz.sha256   # OK obligatorio

mkdir -p /root/chibalete-releases/backend-v4.0.0
tar -xzf backend-v4.0.0.tar.gz \
  -C /root/chibalete-releases/backend-v4.0.0 \
  --strip-components=1

ls -la /root/chibalete-releases/backend-v4.0.0/server | head
ls -la /root/chibalete-releases/backend-v4.0.0/utils  | head
cat   /root/chibalete-releases/backend-v4.0.0/RELEASE.txt
EOF
```

### B6 — Rebuild API image

Como `package.json` y `package-lock.json` cambiaron por hardening:

**Opción preferida:** build local + save + scp + load (consistente con el flujo frontend).

```bash
# Workstation
docker build -f Dockerfile.api -t chibalete/api:v4.0.0 .
docker save chibalete/api:v4.0.0 -o /tmp/chibalete-api-v4.0.0.tar
sha256sum /tmp/chibalete-api-v4.0.0.tar > /tmp/chibalete-api-v4.0.0.tar.sha256
scp /tmp/chibalete-api-v4.0.0.tar*  root@72.60.158.97:/root/

# VPS
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /root
sha256sum -c chibalete-api-v4.0.0.tar.sha256
docker load -i chibalete-api-v4.0.0.tar
docker images | grep chibalete/api
EOF
```

### B7 — Sync backend a staging (sin sobrescribir aún)

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
rm -rf /var/www/chibalete/server.v4.0.0
rm -rf /var/www/chibalete/utils.v4.0.0

cp -a /root/chibalete-releases/backend-v4.0.0/server /var/www/chibalete/server.v4.0.0
cp -a /root/chibalete-releases/backend-v4.0.0/utils  /var/www/chibalete/utils.v4.0.0

ls -la /var/www/chibalete/server.v4.0.0 | head
ls -la /var/www/chibalete/utils.v4.0.0  | head
EOF
```

Producción sigue corriendo con el `server/` y `utils/` actuales — nada activado todavía.

### B8 — Swap atómico

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
TS=$(date -u +%Y%m%dT%H%M%SZ)
echo "SWAP_TS=$TS"

mv /var/www/chibalete/server /var/www/chibalete/server.pre-v4-$TS
mv /var/www/chibalete/utils  /var/www/chibalete/utils.pre-v4-$TS

mv /var/www/chibalete/server.v4.0.0 /var/www/chibalete/server
mv /var/www/chibalete/utils.v4.0.0  /var/www/chibalete/utils

ls -la /var/www/chibalete/ | grep -E "server|utils"
EOF
```

**Inalterado por contrato:** `data`, `data-critical`, `public/uploads`.

### B9 — Update API image en compose

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /opt/chibaleteplus
TS=$(date -u +%Y%m%dT%H%M%SZ)
cp docker-compose.yml docker-compose.yml.bak-v4-api-$TS
echo "BAK_API=$TS"

grep -n "chibalete/api" docker-compose.yml

sed -i.tmp "s|chibalete/api:[^[:space:]]*|chibalete/api:v4.0.0|g" docker-compose.yml
rm -f docker-compose.yml.tmp

diff -u docker-compose.yml.bak-v4-api-$TS docker-compose.yml || true
EOF
```

Diff esperado: solo 2 líneas (image en `api_1` y `api_2`). Cualquier otra cosa → revertir y **STOP**.

### B10 — Restart escalonado

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /opt/chibaleteplus
docker compose up -d --no-deps chibalete_api_1
sleep 5
docker logs --tail=120 chibalete_api_1

# Health interno
until docker exec chibalete_api_1 wget -qO- http://localhost:3000/api/health > /dev/null 2>&1; do
  sleep 2
done
echo "api_1 healthy"
EOF
```

Validar en logs de `api_1`:

- No crash loop.
- No `SQLITE_BUSY`, `SQLITE_LOCKED`, `database is locked`, `disk I/O error`.
- No `Cannot find module`.
- No `EACCES` / `EPERM`.

**Solo si todo OK** → `api_2`:

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail
cd /opt/chibaleteplus
docker compose up -d --no-deps chibalete_api_2
sleep 5
docker logs --tail=120 chibalete_api_2

until docker exec chibalete_api_2 wget -qO- http://localhost:3000/api/health > /dev/null 2>&1; do
  sleep 2
done
echo "api_2 healthy"
EOF
```

Si `api_1` falla antes de tocar `api_2`: aplicar **§ B14 rollback inmediato**.

### B11 — Validar health contract real

```bash
curl -fsS https://chibaleteplus.chibaleteeditores.com/api/health | head -c 300; echo

# Estos son NUEVOS en v4 — pueden o no existir tras swap
curl -i https://chibaleteplus.chibaleteeditores.com/api/health/ready     | head -20
curl -i https://chibaleteplus.chibaleteeditores.com/api/health/analytics | head -20
```

| Resultado | Acción |
|---|---|
| `/api/health` 200 + `/ready` 200 + `/analytics` 200 | OK — health contract completo |
| `/api/health` 200, `/ready` o `/analytics` 404 | **NO necesariamente rollback.** Documentar drift y abrir ticket; flags backend v4 quedan OFF |
| `/api/health` falla | **ROLLBACK B14** |

### B12 — Validar events.db

```bash
ssh root@72.60.158.97 << 'EOF'
set -euo pipefail

# Integridad SQLite
sqlite3 /var/www/chibalete/data-critical/events.db "pragma integrity_check;"

# Logs SQLite/WAL
docker logs --tail=300 chibalete_api_1 2>&1 | grep -iE "sqlite|wal|locked|error|exception" || true
docker logs --tail=300 chibalete_api_2 2>&1 | grep -iE "sqlite|wal|locked|error|exception" || true
EOF
```

`integrity_check` debe imprimir literalmente `ok`. Cualquier otra cosa → **STOP**, evaluar rollback.

### B13 — Smoke backend (cuenta admin REAL)

NO usar el seed `admin@chibaleteeditores.com / admin123` en producción.

| Caso | Resultado esperado |
|---|---|
| Login admin real | 200 |
| `/api/users` | 200 con payload |
| `/api/groups` | 200 |
| Leo `/api/leo/ask` | 200 |
| Aula Viva listados | 200 |
| Timeline | 200 |
| Recomendaciones | 200 |
| Eventos se escriben (heartbeat, completion) | Verificar `data-critical/events.db` crece o `data/analytics_db.json` muta |
| `/metrics` (si existe en v4) | text/plain con counters `chibalete_*` |

### B14 — Rollback backend

Pre-condición: `SWAP_TS` (de B8) y `BAK_API` (de B9) capturados.

```bash
ssh root@72.60.158.97 << EOF
set -euo pipefail
TS_FAIL=$(date -u +%Y%m%dT%H%M%SZ)

# 1. Revertir code (server + utils)
mv /var/www/chibalete/server /var/www/chibalete/server.failed-v4-$TS_FAIL
mv /var/www/chibalete/utils  /var/www/chibalete/utils.failed-v4-$TS_FAIL
mv /var/www/chibalete/server.pre-v4-$SWAP_TS /var/www/chibalete/server
mv /var/www/chibalete/utils.pre-v4-$SWAP_TS  /var/www/chibalete/utils

# 2. Revertir compose (imagen API)
cp /opt/chibaleteplus/docker-compose.yml.bak-v4-api-$BAK_API \
   /opt/chibaleteplus/docker-compose.yml

# 3. Restart escalonado
cd /opt/chibaleteplus
docker compose up -d --no-deps chibalete_api_1
sleep 5
until docker exec chibalete_api_1 wget -qO- http://localhost:3000/api/health > /dev/null 2>&1; do
  sleep 2
done

docker compose up -d --no-deps chibalete_api_2
sleep 5
until docker exec chibalete_api_2 wget -qO- http://localhost:3000/api/health > /dev/null 2>&1; do
  sleep 2
done
EOF

# 4. Verificar
curl -fsS https://chibaleteplus.chibaleteeditores.com/api/health | head -c 300; echo
```

Tiempo objetivo: < 5 min desde decisión a healthcheck verde.

Si `api_1` falla **antes** de tocar `api_2`: ejecutar B14 inmediatamente con `api_2` aún en versión anterior — minimiza ventana de inconsistencia.

---

## 4. Reglas absolutas

```
NO tocar:  /var/www/chibalete/data
NO tocar:  /var/www/chibalete/data-critical
NO tocar:  /var/www/chibalete/public/uploads
NO tocar:  /root/apps-spa/chibaleteplus
NO usar:   docker compose down
NO hacer:  git checkout en VPS
NO activar flags v4 backend hasta smoke verde
NO mezclar deploy frontend y backend en una misma ventana hasta que backend sea release-managed
```

---

## 5. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Frontend v4 invoca APIs backend v4 que no existen → vistas en error | Media | Bajo (vistas degradadas, no caída general) | Feature flags client-side OFF por defecto; smoke A.11 detecta antes de declarar verde |
| Swap `server/` corrompe `events.db` por kill durante write | Baja | Alto (data crítica) | `integrity_check` B12 obligatorio; rollback B14 lista pre-validada |
| Compose con cambio no quirúrgico (sed afecta otras líneas) | Baja | Alto (puede tumbar todo el stack) | Diff obligatorio antes de `up -d`; revert con bak.* si > 1-2 líneas |
| Imagen API v4 con `npm install` (no `npm ci`) → drift de lock | Media | Medio | `Dockerfile.api` usa `npm install` por mismatch de `better-sqlite3` nativo; aceptado pero documentado en `RELEASE.txt` |
| Endpoints `/api/health/ready`, `/analytics` siguen 404 post-swap | Media | Bajo (drift documental, no funcional) | B11 documenta drift sin rollback automático |
| Operador ejecuta paso sin capturar `BAK_FRONT` / `SWAP_TS` / `BAK_API` | Media | Alto (sin rollback) | Cada paso de creación de backup imprime el TS — pegar al doc al cierre |
| Confusión entre `/var/www/chibalete` (real) y `/root/apps-spa/chibaleteplus` (legacy) | Media | Alto | Regla absoluta + grep en pre-flight si el operador duda |

---

## 6. Entregable (a llenar por el operador al cierre)

| Campo | Valor |
|---|---|
| Decisión frontend deploy | GO / NO-GO / EJECUTADO |
| Decisión backend deploy | NO-GO (operationalization pendiente) |
| Imagen frontend previa | `chibalete/front:____________________` |
| Imagen frontend nueva | `chibalete/front:v4.0.0` |
| Compose diff frontend | (pegar `diff -u`) |
| `BAK_FRONT` (TS) | `____________________` |
| `/api/health` post-deploy frontend | (pegar respuesta) |
| Smoke frontend | OK / FAIL (anotar fallos) |
| Snapshot backend creado | `/root/chibalete-releases/backend-current-____________________` |
| Backup datos | `/root/chibalete-backups/____________________` |
| Paquete backend v4 cargado | `chibalete-releases/backend-v4.0.0` SHA: ______ |
| Imagen API v4 cargada | `chibalete/api:v4.0.0` SHA: ______ |
| `SWAP_TS` backend | (vacío si NO-GO) |
| `BAK_API` compose | (vacío si NO-GO) |
| `api_1` health | (vacío si NO-GO) |
| `api_2` health | (vacío si NO-GO) |
| Smoke backend | (vacío si NO-GO) |
| `events.db integrity_check` | (vacío si NO-GO) |
| Rollback disponible | SÍ — A.12 (frontend), B14 (backend) |
| Riesgos restantes | (anotar) |
| Próxima acción recomendada | (anotar) |

---

## 7. Próxima acción recomendada (a hoy, 2026-05-20)

1. **Stage A** — operador con Docker Desktop UP ejecuta A.1 → A.11. Smoke verde, declarar Stage A cerrado.
2. **Operationalization Sprint B1-B3** — auditoría + snapshot + backups, sin tocar nada todavía. Esto cierra el debt de "no hay rollback real" del backend.
3. **Operationalization Sprint B4-B7** — preparar paquete + imagen API v4 + staging. Sigue sin tocar producción.
4. **Ventana de cambio acordada** con stakeholders para B8-B13 (swap + restart + smoke). 30 min mínimo, ideal hora de bajo tráfico.
5. Solo después: planificar activación gradual de flags v4 según `V4-FLAGS-MATRIX.md`.

---

## 8. Cambios respecto a la versión previa de este doc

| Antes (asumía) | Ahora (auditado) |
|---|---|
| `git checkout v4.0.0` viable en VPS | NO — paquete tarball + sha256 |
| `/api/health/ready` y `/analytics` ya existen | NO — solo `/api/health` es contractual hoy |
| Swap de `server/` es seguro con tag git | NO — requiere snapshot inmutable + staging dir + swap atómico (B2/B7/B8) |
| Dominio ambiguo (mención a `tiendachibalete.com`) | Resuelto: `chibaleteplus.chibaleteeditores.com` |
| Backend y frontend desplegables en misma ventana | Separados: frontend GO, backend NO-GO hasta operationalization |
| Backup compose suficiente | Suma snapshot `server/` + `utils/` + dump tarballs `data*` + `uploads` con tamaños esperados |
| Activación de flags v4 podía seguir inmediato | Postergada hasta smoke backend verde con drift documentado |
