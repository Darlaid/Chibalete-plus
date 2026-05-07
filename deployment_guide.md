# Chibalete+ — Guía Operacional de Despliegue

> Documento canónico de operación de producción.
> Cualquier divergencia entre este documento y la realidad del VPS debe
> resolverse **a favor de la realidad** y reflejarse aquí inmediatamente.

---

## 1. Introducción operacional

Chibalete+ corre en producción como un stack **Docker Compose** sobre un
único VPS Hostinger (`root@72.60.158.97`). No hay clúster, no hay
Kubernetes, no hay autoscaling, no hay registry privado, no hay CI
remoto. La operación es **single-host, manual, scripted**.

> 🔴 **Frase fundacional — debe entenderse antes de tocar nada:**
>
> Chibalete+ no se actualiza copiando archivos al VPS;
> se actualiza **reemplazando imágenes Docker (frontend)**
> y haciendo **swap controlado de bind mounts (backend)**.

Cualquier desviación de este principio (copiar `dist/` a `/var/www/`,
correr `npm run server` directo en el host, levantar PM2 paralelo,
etc.) corrompe la separación operativa, produce drift y abre puertas a
pérdida de datos.

Este documento describe **lo que ES**, no lo que sería ideal. Si necesitas
hacer cambios arquitectónicos, hazlos en un sprint dedicado y actualiza
este documento simultáneamente.

---

## 2. Arquitectura real de producción

```
                       ┌─────────────────────────────┐
   Internet  ──HTTPS──▶│   chibalete_edge            │
   :80 / :443           │   nginx:alpine              │
                       │   /opt/chibaleteplus/nginx/ │
                       │     nginx.conf              │
                       └──────────────┬──────────────┘
                                      │
                                      │  Docker bridge: chibalete_net
                                      │
                  ┌───────────────────┼───────────────────┐
                  │                   │                   │
                  ▼                   ▼                   ▼
         ┌────────────────┐  ┌────────────────┐  ┌────────────────┐
         │ chibalete_     │  │ chibalete_     │  │ chibalete_     │
         │   front        │  │   api_1        │  │   api_2        │
         │ chibalete/     │  │ chibalete/     │  │ chibalete/     │
         │   front:<tag>  │  │   api:latest   │  │   api:latest   │
         │                │  │                │  │                │
         │ SIN MOUNTS     │  │ Bind mounts ↓  │  │ Bind mounts ↓  │
         └────────────────┘  └────────┬───────┘  └────────┬───────┘
                                      │                   │
                                      └─────────┬─────────┘
                                                │
                                                ▼
                                ┌──────────────────────────────────┐
                                │  /var/www/chibalete/             │
                                │    data/             → /app/data │
                                │    data-critical/    → /app/data-critical │
                                │    public/uploads/   → /app/public/uploads │
                                │    server/           → /app/server │
                                └──────────────────────────────────┘
```

**Notas críticas:**
- `chibalete_edge` es el **único** punto de entrada público (puertos 80/443).
- `chibalete_front` y los `api_X` solo son accesibles vía la red interna `chibalete_net`.
- `chibalete_api_1` y `chibalete_api_2` corren la **misma imagen** (`chibalete/api:latest`) y comparten **los mismos bind mounts**. No son réplicas independientes — son **dos workers contra el mismo estado en disco**.
- Los archivos `data/`, `data-critical/`, `public/uploads/` y `server/` **viven en el host** (`/var/www/chibalete/`), NO en la imagen.

---

## 3. Topología Docker

| Componente | Tipo | Imagen | Mounts | Restart policy |
|---|---|---|---|---|
| `chibalete_edge` | service | `nginx:alpine` | `nginx.conf` (lectura) | `unless-stopped` |
| `chibalete_front` | service | `chibalete/front:<tag>` | ninguno | `unless-stopped` |
| `chibalete_api_1` | service | `chibalete/api:latest` | 4 bind mounts a `/var/www/chibalete/` | `unless-stopped` |
| `chibalete_api_2` | service | `chibalete/api:latest` | mismos 4 bind mounts | `unless-stopped` |

**Compose canónico:** `/opt/chibaleteplus/docker-compose.yml` — la **única**
fuente de verdad. Cualquier `docker-compose.prod.yml` o `docker-compose.yml`
en otras rutas (`/root/apps-spa/`, `deployment_package/`) es legacy o
artefacto de experimentación; **no gobierna producción**.

**Network:** `chibalete_net` (bridge interno). Los containers se descubren
entre sí por nombre DNS (`chibalete_front`, `chibalete_api_1`, etc.).

---

## 4. Componentes reales

### 4.1 `chibalete_edge`
Reverse proxy + terminación TLS. Configuración en `/opt/chibaleteplus/nginx/nginx.conf`. Define:
- `client_max_body_size 2G` (alineado con `MAX_UPLOAD_BYTES` del backend)
- `client_body_timeout 600s`, `proxy_read_timeout 600s`, `proxy_send_timeout 600s`
- `proxy_request_buffering off` para no acumular uploads grandes en cache de nginx
- `upstream` apunta a `chibalete_front:80` y `chibalete_api_1/api_2:3000`

**Cuándo se toca:** solo `nginx -s reload` tras recrear `chibalete_front` (porque la IP del nuevo container puede haber cambiado y el upstream tiene la vieja cacheada).

### 4.2 `chibalete_front`
Bundle estático (Vite build) servido por nginx interno dentro del container. **La imagen es autocontenida**: no depende de archivos del host.

**Implicación:** cambiar el frontend = construir una nueva imagen Docker, etiquetarla, y recrear el container. No se "copia el `dist/`" a ninguna parte del VPS.

### 4.3 `chibalete_api_1` y `chibalete_api_2`
Dos workers Express idénticos. Misma imagen `chibalete/api:latest`. Misma versión de Node. Mismas dependencias. Pero el **código real** que ejecutan vive en `/var/www/chibalete/server/` (host) montado como `/app/server` (container).

**Implicación:** cambiar el backend = reemplazar archivos en `/var/www/chibalete/server/` y reiniciar los containers. La imagen `chibalete/api:latest` permanece igual.

> ⚠️ Si cambian las dependencias (`package.json` modificado), el modelo bind-mount NO basta: hay que reconstruir la imagen api. Ese flujo NO está cubierto por los scripts de deploy actuales y debe tratarse como un sprint dedicado.

### 4.4 Lo que NO existe en producción
- ❌ **PM2** (no gobierna; `ecosystem.config.cjs` es solo para dev local)
- ❌ **nginx host** (puerto 80/443 los ocupa el container `chibalete_edge`)
- ❌ Carpeta `/var/www/chibalete/dist/` activa (es legacy)
- ❌ Proceso `node` directo en el host
- ❌ Registry privado (las imágenes se transfieren con `docker save`/`docker load`)

---

## 5. Frontend architecture

```
Local                       VPS
─────                       ───
git checkout                ssh root@72.60.158.97
npm run build               docker load -i /tmp/front-RELEASE.tar
docker build                cp docker-compose.yml docker-compose.yml.bak-$TS
  -f Dockerfile.front       sed -i 's|image: $OLD_TAG|image: $NEW_TAG|' compose
  -t chibalete/front:TAG    docker compose up -d --no-deps front
docker save chibalete/      docker exec chibalete_edge nginx -t
  front:TAG -o front.tar    docker exec chibalete_edge nginx -s reload
scp front.tar VPS:/tmp/     curl https://... → 200
```

**Reglas:**
- ✅ Cada deploy frontend produce una **imagen nueva con tag inmutable** (`YYYY-MM-DD-<slug>`).
- ✅ El tag anterior (`OLD_TAG`) se **conserva en disco** del VPS al menos 7 días para rollback rápido.
- ✅ El `nginx -s reload` del edge **es obligatorio** tras recrear `chibalete_front`.
- 🔴 Nunca se modifica el frontend "en caliente" dentro del container.
- 🔴 Nunca se copia `dist/` a `/var/www/`.

---

## 6. Backend architecture

```
Local                              VPS
─────                              ───
git checkout                       ssh root@72.60.158.97
npm run verify                     # Backup
                                   cp -a /var/www/chibalete/server  →  backup/$TS/server
                                   cp -a /var/www/chibalete/data    →  backup/$TS/data
                                   cp -a /var/www/chibalete/data-critical → backup/$TS/data-critical
                                   # Pre-validate
                                   curl /api/admin/membership/validate → ok=true
tar -czf server-RELEASE.tgz \
  server/ utils/ types/            # Transferir staging
                                   tar -xzf server-RELEASE.tgz \
                                     -C /var/www/chibalete/server.staging/
                                   # Swap atómico (mismo filesystem)
                                   mv /var/www/chibalete/server  → server.old-$TS
                                   mv server.staging/server      → server
                                   # Restart staggered
                                   docker stop chibalete_api_1 --time=30
                                   docker start chibalete_api_1
                                   wait healthy
                                   validate api_1
                                   docker stop chibalete_api_2 --time=30
                                   docker start chibalete_api_2
                                   wait healthy
                                   validate post-deploy
```

**Reglas:**
- ✅ `npm run verify` en local **debe pasar** antes del deploy (212 tests memberships + 96 parser + 9 corpus).
- ✅ Backup completo (`data/`, `data-critical/`, `server/`, `compose`) es obligatorio en cada deploy.
- ✅ Swap del directorio `server/` debe ser **atómico** (`mv` en mismo filesystem).
- ✅ Restart **staggered**: primero `api_1`, validar, después `api_2`. Nunca ambos a la vez.
- 🔴 Nunca se modifica `server.js` "en caliente" con `docker exec`.
- 🔴 Nunca se reinicia ambos `api_X` simultáneamente.

---

## 7. Datos persistentes y bind mounts

| Host | Container | Naturaleza | Política |
|---|---|---|---|
| `/var/www/chibalete/data/` | `/app/data` | JSONs principales (`users_db.json`, `groups_db.json`, `progress_db.json`, etc.) | 🔴 NUNCA tocar manualmente. Backup antes de cada deploy backend |
| `/var/www/chibalete/data-critical/` | `/app/data-critical` | Datos sensibles (auditoría, secrets vault, leo memory) | 🔴 NUNCA tocar. Backup obligatorio |
| `/var/www/chibalete/public/uploads/` | `/app/public/uploads` | Archivos subidos por administradores (PDF, audio, imágenes) | 🔴 NUNCA borrar. Backup como manifiesto (no por contenido — pesado) |
| `/var/www/chibalete/server/` | `/app/server` | Código backend ejecutado por los `api_X` | ✅ Solo se reemplaza con swap atómico durante deploy |

> ⚠️ Backup completo de `data/`, `data-critical/` y `server/` antes de cada
> deploy backend es **bloqueante**. Sin backup → sin deploy.

> ⚠️ `uploads/` no se backupea por contenido (puede pesar GBs); se guarda
> un **manifiesto** (lista de filenames con tamaños) para forensics. Si un
> upload se corrompe en producción, hay que decidir restore manual desde
> el origen original (CDN, editor que lo subió, etc.).

---

## 7.1 Backup operacional pre-deploy

> 🔴 **Sin backup → sin deploy.** Esta sección describe el script
> canónico que materializa esa regla.

### 7.1.1 Script canónico: `scripts/backup-vps.sh`

Script bash idempotente que captura un snapshot de los recursos
críticos del VPS en `/root/backups/chibalete/<TS>/`. Es la **única**
forma soportada de generar backups operacionales. No corre en
contenedores; corre directo en el host del VPS como root.

**Invocación:**
```bash
ssh root@72.60.158.97 "bash /root/scripts/backup-vps.sh"
# o desde el VPS:
sudo /root/scripts/backup-vps.sh
```

(El script vive en el repo en `scripts/backup-vps.sh`. Para usarlo en
producción se transfiere una vez a `/root/scripts/backup-vps.sh` con
`scp` y se mantiene allí. Cualquier cambio al script pasa por
commit + scp deliberado, **no** por edición en el VPS.)

### 7.1.2 Cuándo correrlo

| Situación | ¿Backup obligatorio? |
|---|---|
| **Pre-deploy backend** (FASE B1) | ✅ Sí, bloqueante |
| **Pre-edición manual de `/var/www/chibalete/server/`** (hotfix de emergencia, raro) | ✅ Sí, bloqueante |
| **Pre-importación masiva** (CSV admin, migración manual) | ✅ Sí |
| **Pre-cambio de compose** (recreate de api o front) | ⚠ Recomendado |
| **Pre-deploy frontend** | ❌ No requerido (no toca data/) |
| **Periódico (auditoría)** | ⚠ Una vez por semana, mínimo |

### 7.1.3 Qué respalda

| Recurso | Artefacto | Notas |
|---|---|---|
| `/var/www/chibalete/data/` | `data.tar.gz` | JSONs vivos completos |
| `/var/www/chibalete/data-critical/` | `data-critical.tar.gz` | Auditoría, vault, leo memory |
| `/var/www/chibalete/server/` | `server.tar.gz` | Código backend en bind mount |
| `/opt/chibaleteplus/docker-compose.yml` | `docker-compose.yml` (copia plana) | Topología canónica |
| `/var/www/chibalete/public/uploads/` | `uploads-manifest.txt` | **Sólo lista** (path+size+mtime), NO contenido |

Cada `.tar.gz` lleva su `sha256` registrado en `metadata.json` (formato
JSON parseable, schema_version `1.0`).

### 7.1.4 Qué NO respalda

- ❌ Contenido binario de `uploads/` (puede pesar GBs)
- ❌ Imágenes Docker (`chibalete/api:latest`, `chibalete/front:<tag>`).
  Las imágenes se conservan por retention de Docker, no por este script
- ❌ `node_modules` ni dependencias (vienen en la imagen)
- ❌ Logs de containers (`/var/lib/docker/containers/*/...`)
- ❌ Estado off-host (no hay disaster recovery a otro datacenter)
- ❌ Encriptación at-rest (los backups quedan en el mismo host que prod)

### 7.1.5 Estructura de salida

```
/root/backups/chibalete/2026-05-07T23-14-55Z/
├── data.tar.gz             # tar.gz completo
├── data-critical.tar.gz    # tar.gz completo
├── server.tar.gz           # tar.gz completo
├── docker-compose.yml      # copia plana
├── uploads-manifest.txt    # path<TAB>size<TAB>mtime + summary
├── metadata.json           # TS, hostname, sizes, sha256, status
└── backup.log              # log mirror del run
```

`<TS>` es UTC, formato ISO file-safe: `YYYY-MM-DDTHH-MM-SSZ` (los
colons del ISO estándar son ilegales en filenames Windows; UTC evita
ambigüedad con DST).

### 7.1.6 Retention

- **7 días**, aplicada al final del script y **sólo si el backup actual
  fue exitoso**. Si el de hoy falla, el de hace 8 días NO se borra
  (red de seguridad).
- Directorios `*.partial` (residuos de runs fallidos) **nunca se borran
  automáticamente**: son evidencia para post-mortem y requieren
  decisión humana.
- Override sólo para casos excepcionales:
  `RETENTION_DAYS=14 bash backup-vps.sh`.

### 7.1.7 Validaciones bloqueantes (fail-fast)

El script aborta antes de tocar nada si:

1. Falta `/var/www/chibalete/data`, `data-critical` o `server`
2. Falta `/opt/chibaleteplus/docker-compose.yml`
3. Espacio libre en `/root` < 5 GB **o** < 3× tamaño combinado de fuentes
4. No puede escribir en `/root/backups/chibalete/`
5. Ya existe un directorio con el mismo `<TS>` (idempotencia)
6. Existe un `<TS>.partial/` residual (limpiar manualmente primero)

Exit codes:
- `0` → backup OK, retention aplicada
- `1` → fail-fast en pre-flight (nada se creó)
- `2` → fallo durante ejecución (`.partial/` preservado para inspección)
- `3` → backup OK pero retention falló (advertencia, no abortar)

### 7.1.8 Restore manual

> ⚠️ **Política**: rollback de código (`server/`) es siempre seguro y
> rápido. Restore de `data/` o `data-critical/` es **última opción** —
> retrocede operaciones legítimas que ocurrieron post-backup. Requiere
> decisión humana documentada en `/root/deploys.log`.

**Verificar integridad del backup antes de restaurar:**
```bash
TS=2026-05-07T23-14-55Z
B=/root/backups/chibalete/$TS
cat $B/metadata.json | jq '.status, .artifacts'
sha256sum $B/data.tar.gz
# debe coincidir con: jq -r '.artifacts."data.tar.gz".sha256' $B/metadata.json
```

**Restore de `data/` (último recurso):**
```bash
TS=2026-05-07T23-14-55Z
B=/root/backups/chibalete/$TS
# 1. Backup del estado actual antes de pisar (por si hay que volver atrás)
cp -a /var/www/chibalete/data /var/www/chibalete/data.pre-restore-$(date -u +%Y%m%d-%H%M%S)
# 2. Extraer a staging
mkdir -p /var/www/chibalete/data.restore-$TS
tar -xzf $B/data.tar.gz -C /var/www/chibalete/data.restore-$TS
# 3. Inspeccionar diff
diff -r /var/www/chibalete/data /var/www/chibalete/data.restore-$TS/data | less
# 4. Si confirma intención: swap atómico + restart staggered
docker stop chibalete_api_1 --time=30
mv /var/www/chibalete/data           /var/www/chibalete/data.replaced-$(date -u +%Y%m%d-%H%M%S)
mv /var/www/chibalete/data.restore-$TS/data /var/www/chibalete/data
docker start chibalete_api_1
# Esperar healthy + validar
docker stop chibalete_api_2 --time=30
docker start chibalete_api_2
# Anotar en /root/deploys.log
echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) DATA RESTORE from $TS <actor> <razón>" >> /root/deploys.log
```

(Mismo patrón aplica a `data-critical.tar.gz` y `server.tar.gz`.
Para `server.tar.gz` el restart staggered es exactamente el del flujo
de rollback backend, sección 15.)

**Restore de `docker-compose.yml`:**
```bash
TS=2026-05-07T23-14-55Z
B=/root/backups/chibalete/$TS
cp /opt/chibaleteplus/docker-compose.yml /opt/chibaleteplus/docker-compose.yml.pre-restore-$(date -u +%Y%m%d-%H%M%S)
cp $B/docker-compose.yml /opt/chibaleteplus/docker-compose.yml
# Validar sintaxis (compose es YAML, no nginx)
cd /opt/chibaleteplus && docker compose config -q
```

### 7.1.9 Limitaciones conocidas

| # | Limitación | Mitigación actual |
|---|---|---|
| 1 | `tar` lee sin coordinación con `withFileLock` de los `api_X`. Un write puede ocurrir entre la lectura de `users_db.json` y `groups_db.json`, quedando inconsistencia inter-archivo en el snapshot | Validate endpoint detecta `studentMember_divergence`; `syncGroupMembership` repara. Riesgo aceptado en Sprint 022 |
| 2 | Backups co-residen con producción en el mismo host. Si el VPS se compromete o se pierde el disco, los backups también | Disaster recovery off-host queda como deuda futura |
| 3 | `uploads/` sólo se respalda como manifiesto. Si un PDF/MP3 se corrompe, restore desde el origen del editor (no automatizado) | Documentado en sección 7 |
| 4 | El script no verifica restore-test automáticamente (genera SHA256 pero no extrae+compara) | Restore manual incluye paso de `diff -r` |
| 5 | Sin encriptación at-rest. Cualquiera con acceso `root` lee los JSONs | Permisos `/root/backups/` son `700`; el host es single-user |
| 6 | `metadata.json` no firma criptográficamente el manifest | `sha256` por artefacto detecta corrupción accidental, no ataque dirigido |

### 7.1.10 Lo que NO resuelve este script (y NO debe usarse para)

- ❌ Disaster recovery (otro DC, otro host)
- ❌ Compliance / retention legal de largo plazo
- ❌ Snapshots transaccionalmente consistentes (eso requiere LVM/ZFS o pause-writes API)
- ❌ Backup continuo / WAL streaming (el sistema no tiene DB transaccional, son JSONs)
- ❌ Audit trail criptográfico

Para cualquiera de estos casos, abrir sprint dedicado.

---

## 8. Qué rutas SON producción

| Ruta | Qué es | Quién la toca |
|---|---|---|
| `/opt/chibaleteplus/docker-compose.yml` | Compose canónico | Scripts de deploy (lectura/edición controlada) |
| `/opt/chibaleteplus/nginx/nginx.conf` | Config nginx del edge | Solo cambios deliberados, requiere `nginx -t` y `nginx -s reload` |
| `/var/www/chibalete/data/` | JSONs vivos | Solo `chibalete_api_1` y `chibalete_api_2` con `withFileLock` |
| `/var/www/chibalete/data-critical/` | Datos sensibles | Idem |
| `/var/www/chibalete/public/uploads/` | Archivos subidos | `chibalete_api_1`, `chibalete_api_2` (escribe), `chibalete_edge` (lee) |
| `/var/www/chibalete/server/` | Código backend | Swap controlado por `deploy-backend.sh` |
| `/root/backups/chibalete/$TS/` | Backups con retention 7 días | `backup-vps.sh` (escribe), operador (lee para restore) |

---

## 9. Qué rutas NO SON producción

| Ruta | Qué es | Por qué importa |
|---|---|---|
| `/root/apps-spa/chibaleteplus/` | Source legacy de un experimento previo | Si alguien edita ahí, **no afecta producción**. Confunde auditorías. Marcado para archivar |
| `/var/www/chibalete/dist/` | Bundle frontend legacy | El frontend **vive en la imagen Docker**, no en este path. Cualquier copia aquí es ruido |
| `/var/www/chibalete/node_modules/` | Modules legacy (si existe) | El backend usa `node_modules` **dentro de la imagen `chibalete/api:latest`**, no del host |
| `~/.pm2/` | PM2 local user | PM2 no corre en producción; cualquier proceso aquí es residual |
| `/etc/nginx/sites-available/`, `/etc/nginx/sites-enabled/` | nginx host system | nginx system **no corre**; el edge es el container `chibalete_edge` |
| `deployment_package/` (en repo) | Snapshot histórico | Solo referencia. No representa producción actual |

> ⚠️ Si tras un deploy la app no responde y solo encuentras código viejo en
> alguna ruta de esta tabla, **NO es producción**. Verifica `docker ps` y
> `docker exec` antes de asumir nada.

---

## 10. Reglas de oro de deploy

### 10.1 Mandamientos

| # | Regla |
|---|---|
| 1 | El backend = bind mount + restart staggered. **Nunca rebuild de imagen api** salvo cambio de deps |
| 2 | El frontend = imagen nueva + recreate + reload edge. **Nunca tocar archivos en VPS** |
| 3 | `data/`, `data-critical/`, `uploads/` son **invariantes** durante el deploy. Solo backup antes |
| 4 | `validate endpoint` pasa **antes y después**. Si falla antes → no deploy. Si falla después → rollback |
| 5 | Backup del compose **antes** de editarlo. Backup de data **antes** de tocar el código |
| 6 | Restart staggered: `api_1` → validar → `api_2`. **Nunca paralelo** |
| 7 | `nginx -s reload` del edge tras recrear `chibalete_front` (no antes) |
| 8 | Toda operación destructiva queda **registrada** en `/root/deploys.log` con TS, actor, RELEASE_TAG |

### 10.2 Política de tags
- Frontend: `chibalete/front:YYYY-MM-DD-<slug>` (inmutable, ej. `2026-05-06-membership-cache`)
- Backend: el tag de la imagen api permanece `latest`. El SHA del código backend se rastrea por el `git log` del directorio `/var/www/chibalete/server/` (que es un checkout git en el VPS).

### 10.3 Política de retention
- Imágenes Docker: 5 tags más recientes para rollback (cleanup mensual con `docker image prune --filter "until=720h"`)
- Backups en `/root/backups/chibalete/`: 7 días
- `server.old-$TS` en `/var/www/chibalete/`: 7 días, luego cleanup manual

---

## 11. Flujo correcto deploy frontend

```
FASE F0 — LOCAL PRE-FLIGHT
  [ ] git status limpio
  [ ] git rev-parse HEAD (capturar SHA esperado)
  [ ] npm run verify → tests verdes
  [ ] npm run build → dist/ generado
  [ ] docker build -f Dockerfile.front -t chibalete/front:$NEW_TAG .
  [ ] docker save chibalete/front:$NEW_TAG -o /tmp/front-$NEW_TAG.tar

FASE F1 — TRANSFERIR IMAGEN
  [ ] scp /tmp/front-$NEW_TAG.tar root@VPS:/tmp/
  [ ] ssh: docker load -i /tmp/front-$NEW_TAG.tar
  [ ] ssh: docker images chibalete/front: confirmar $NEW_TAG presente
  [ ] ssh: docker images chibalete/front: confirmar $OLD_TAG aún presente (rollback ready)

FASE F2 — BACKUP COMPOSE
  [ ] ssh: TS=$(date +%Y%m%d-%H%M%S)
  [ ] ssh: cp /opt/chibaleteplus/docker-compose.yml \
                /opt/chibaleteplus/docker-compose.yml.bak-$TS
  [ ] ssh: ls -lh /opt/chibaleteplus/docker-compose.yml.bak-$TS

FASE F3 — IDENTIFICAR OLD_TAG
  [ ] ssh: OLD_TAG=$(docker inspect chibalete_front --format '{{.Config.Image}}')
  [ ] ssh: confirmar OLD_TAG != NEW_TAG (deploy idempotente sería abort)

FASE F4 — EDITAR COMPOSE
  [ ] ssh: sed -i "s|image: $OLD_TAG|image: $NEW_TAG|" \
                  /opt/chibaleteplus/docker-compose.yml
  [ ] ssh: grep "image: $NEW_TAG" docker-compose.yml → debe aparecer
  [ ] ssh: grep "image: $OLD_TAG" docker-compose.yml → NO debe aparecer

FASE F5 — RECREAR FRONT (sin tocar otros services)
  [ ] ssh: cd /opt/chibaleteplus && docker compose up -d --no-deps front

FASE F6 — VALIDAR FRONT INTERNO
  [ ] ssh: docker ps | grep chibalete_front → status=Up con $NEW_TAG
  [ ] ssh: loop max 15s:
            docker exec chibalete_edge wget -qO- http://chibalete_front:80/

FASE F7 — RELOAD EDGE
  [ ] ssh: docker exec chibalete_edge nginx -t  (validar sintaxis)
  [ ] ssh: docker exec chibalete_edge nginx -s reload

FASE F8 — VALIDAR PÚBLICO
  [ ] curl -sI https://chibaleteplus.chibaleteeditores.com/ → HTTP 200
  [ ] navegador: hard refresh (Ctrl+Shift+R) → bundle nuevo carga

FASE F9 — REGISTRAR
  [ ] ssh: echo "$TS frontend $NEW_TAG <actor>" >> /root/deploys.log
```

> 🔴 **Si CUALQUIER paso F5–F8 falla → rollback inmediato (sección 14).**

---

## 12. Flujo correcto deploy backend

```
FASE B0 — LOCAL PRE-FLIGHT
  [ ] git status limpio
  [ ] git rev-parse HEAD
  [ ] npm run verify → 212+96+9 asserts verdes
  [ ] npm run typecheck:baseline → errores ≤ baseline conocido (5)
  [ ] git diff HEAD~10..HEAD package-lock.json
        → si hay cambios, este sprint NO cubre rebuild de imagen api
  [ ] tar -czf /tmp/server-$RELEASE.tgz server/ utils/ types/
        (excluir: node_modules, __test__, *.log)

FASE B1 — BACKUP REMOTO  (canónico vía scripts/backup-vps.sh — ver §7.1)
  [ ] ssh: bash /root/scripts/backup-vps.sh
            → exit 0 obligatorio. Si exit != 0, ABORT deploy.
  [ ] ssh: TS=$(ls -1 /root/backups/chibalete | grep -E '^[0-9]{4}-' | tail -1)
            (capturar el TS del backup recién creado para registro)
  [ ] ssh: cat /root/backups/chibalete/$TS/metadata.json | jq '.status'
            → debe ser "ok"
  [ ] ssh: cp /opt/chibaleteplus/docker-compose.yml \
              /opt/chibaleteplus/docker-compose.yml.bak-$TS
            (snapshot extra del compose con el mismo TS — el script ya
             guarda una copia, este .bak vive en /opt para edición rápida)

FASE B2 — PRE-VALIDATE
  [ ] curl -H "x-admin-secret: $SECRET" \
            https://chibaleteplus.../api/admin/membership/validate
  [ ] confirmar ok=true
  [ ] capturar baseline counts para post-deploy comparison
  🔴 Si ok=false → ABORT. Limpiar drift histórico antes de cualquier deploy

FASE B3 — TRANSFERIR CÓDIGO
  [ ] scp /tmp/server-$RELEASE.tgz root@VPS:/tmp/
  [ ] ssh: rm -rf /var/www/chibalete/server.staging
  [ ] ssh: mkdir -p /var/www/chibalete/server.staging
  [ ] ssh: tar -xzf /tmp/server-$RELEASE.tgz \
              -C /var/www/chibalete/server.staging
  [ ] ssh: ls /var/www/chibalete/server.staging/server/server.js → debe existir

FASE B4 — SWAP ATÓMICO
  [ ] ssh: mv /var/www/chibalete/server \
              /var/www/chibalete/server.old-$TS
  [ ] ssh: mv /var/www/chibalete/server.staging/server \
              /var/www/chibalete/server
  [ ] ssh: ls /var/www/chibalete/server/server.js → confirmar
  En este punto: api_1 y api_2 SIGUEN sirviendo con código viejo en RAM.

FASE B5 — RESTART STAGGERED api_1
  [ ] ssh: docker stop chibalete_api_1 --time=30
  [ ] ssh: docker start chibalete_api_1
  [ ] ssh: loop max 30s:
            docker exec chibalete_api_1 \
              wget -qO- http://localhost:3000/api/health → status=ok
  🔴 Si NO healthy en 30s → FASE B9 ROLLBACK INMEDIATO

FASE B6 — VALIDAR api_1 AISLADO
  [ ] ssh: docker exec chibalete_api_1 \
            curl -sH "x-admin-secret: $SECRET" \
            http://localhost:3000/api/admin/membership/validate
  [ ] confirmar ok=true, counts == baseline

FASE B7 — RESTART STAGGERED api_2
  [ ] ssh: docker stop chibalete_api_2 --time=30
  [ ] ssh: docker start chibalete_api_2
  [ ] ssh: loop max 30s para healthy
  Durante este intervalo: api_1 (NUEVO) sirve, api_2 baja.
  🔴 Si NO healthy → ROLLBACK PARCIAL

FASE B8 — POST-VALIDATE
  [ ] curl validate vía edge → ok=true, counts == baseline
  [ ] /api/health desde edge → status=ok en ambas instancias
  [ ] Smoke A/B/C/D (sección 19)
  [ ] logs últimos 5min: cero ERROR, cero SECURITY, restarts=0

FASE B9 — REGISTRAR
  [ ] ssh: echo "$TS backend $RELEASE_TAG <actor>" >> /root/deploys.log
```

> 🔴 **Nunca `docker compose down`**. Nunca `docker stop chibalete_api_1 chibalete_api_2` simultáneo.

---

## 13. Restart staggered api_1/api_2

**Por qué staggered**: durante el restart de un container, el otro debe seguir sirviendo. Cero downtime.

```
T0 ───── api_1 [VIEJO en RAM] ──── api_2 [VIEJO en RAM]
            │                          │
            │ docker stop --time=30   │
            │ (drena requests)        │
            ▼                          │
T1 ───── api_1 [stopping]          api_2 [VIEJO sirve TODO]
            │                          │
            │ docker start              │
            │ Node lee bind mount      │
            │ código NUEVO              │
            ▼                          │
T2 ───── api_1 [NUEVO en RAM]      api_2 [VIEJO en RAM]
            │                          │
            │ wait healthy             │
            │ validate api_1           │
            │   ok=true                │
            │                          │
            │             docker stop ◀┤
            │             --time=30    │
            │                          ▼
T3 ───── api_1 [NUEVO sirve TODO]  api_2 [stopping]
            │                          │
            │             docker start │
            │             Node lee     │
            │             código NUEVO │
            │                          ▼
T4 ───── api_1 [NUEVO en RAM]      api_2 [NUEVO en RAM]
                                        │
                          wait healthy  │
                          validate api_2│
                            ok=true     ▼
T5 ───── ✅ deploy completo
```

> ⚠️ **Coexistencia momentánea de versiones (T2)**: `api_1` con código nuevo sirve junto a `api_2` con código viejo. Durante este intervalo, dos instancias operan sobre los mismos JSONs en disco con `withFileLock` cross-process. Para Sprint 022 (sin cambios de schema) esto es **seguro**. Para deploys futuros que cambien el formato de los JSONs, este modelo NO es válido — requiere parar ambas instancias o migración de schema con backward compatibility.

> ⚠️ `--time=30` da hasta 30s de gracia para drenar requests en curso (uploads de archivos grandes, llamadas largas). Si el deploy ocurre durante un upload de 2 GiB en red lenta, el cliente recibe error y debe reintentar.

---

## 14. Rollback frontend

```
PRE-REQUISITOS
  ✓ OLD_TAG sigue presente: docker image inspect $OLD_TAG
  ✓ Backup compose existe: ls -t /opt/chibaleteplus/docker-compose.yml.bak-*

PASO RF.1 — Snapshot del estado fallido
  ssh: cp /opt/chibaleteplus/docker-compose.yml \
            /opt/chibaleteplus/docker-compose.yml.failed-$TS

PASO RF.2 — Restaurar compose desde backup
  ssh: BAK=$(ls -t /opt/chibaleteplus/docker-compose.yml.bak-* | head -1)
  ssh: grep "image: $OLD_TAG" $BAK  → debe aparecer
  ssh: cp $BAK /opt/chibaleteplus/docker-compose.yml

PASO RF.3 — Recrear front con OLD_TAG
  ssh: cd /opt/chibaleteplus && docker compose up -d --no-deps front

PASO RF.4 — Esperar healthy
  ssh: loop 15s:
        docker exec chibalete_edge wget -qO- http://chibalete_front:80/

PASO RF.5 — Reload edge
  ssh: docker exec chibalete_edge nginx -t
  ssh: docker exec chibalete_edge nginx -s reload

PASO RF.6 — Validar HTTP público
  curl -sI https://... → 200

PASO RF.7 — Registrar
  ssh: echo "$TS rollback frontend $NEW_TAG → $OLD_TAG <actor>" >> /root/deploys.log
```

> 🔴 Si OLD_TAG **no existe** localmente en VPS → rollback imposible vía Docker. Requiere reconstruir imagen vieja desde commit anterior y reintentar.

---

## 15. Rollback backend

```
PRE-REQUISITOS
  ✓ /var/www/chibalete/server.old-$TS existe
  ✓ /root/backups/chibalete/$TS/ existe
  ✓ docker images chibalete/api:latest sigue presente

PASO RB.1 — Snapshot del estado fallido
  ssh: mv /var/www/chibalete/server \
            /var/www/chibalete/server.failed-$TS

PASO RB.2 — Restaurar código previo (swap atómico inverso)
  ssh: mv /var/www/chibalete/server.old-$TS \
            /var/www/chibalete/server
  ssh: ls /var/www/chibalete/server/server.js → confirmar

PASO RB.3 — Restart staggered (mismo patrón que deploy)
  ssh: docker stop chibalete_api_1 --time=30
  ssh: docker start chibalete_api_1
  ssh: wait healthy
  ssh: docker exec chibalete_api_1 curl validate → ok=true

  ssh: docker stop chibalete_api_2 --time=30
  ssh: docker start chibalete_api_2
  ssh: wait healthy

PASO RB.4 — Validar
  curl validate (vía edge) → ok=true
  comparar counts con baseline pre-deploy original

PASO RB.5 — Decidir sobre data/
  Si counts coinciden con baseline → rollback completo, NO restaurar data
  Si counts NO coinciden → posible corrupción de data durante el deploy fallido
    Decisión humana:
      Opción A: aceptar el estado actual (no restaurar data)
                — el deploy escribió cambios legítimos en data
      Opción B: restaurar data desde backup
                cp -a /root/backups/chibalete/$TS/data /var/www/chibalete/data
                cp -a /root/backups/chibalete/$TS/data-critical /var/www/chibalete/data-critical
                Restart staggered de nuevo
                ⚠️ Esto retrocede operaciones legítimas que ocurrieron post-deploy.
                Solo se elige si el daño es claramente mayor que la pérdida.

PASO RB.6 — Registrar
  ssh: echo "$TS rollback backend → estado pre-$TS <actor>" >> /root/deploys.log
```

> 🔴 **Política**: rollback de código es siempre seguro y rápido (~60s). Rollback de data es **última opción**, requiere decisión humana, retrocede operaciones reales.

---

## 16. Validate endpoint

`GET /api/admin/membership/validate` (auth: `x-admin-secret`)

Devuelve `{ ok, issues, counts }`:
- `ok: true` → integridad estructural intacta (`user.groupIds ↔ group.studentIds/memberIds` consistentes en ambos sentidos)
- `ok: false` → drift detectado, `issues[]` lista cada inconsistencia con `type`/`groupId`/`userId`

**Tipos de issue**:
- `orphan_studentId` — `group.studentIds[]` apunta a userId inexistente
- `orphan_memberId` — idem para `memberIds`
- `orphan_userGroupId` — `user.groupIds[]` apunta a groupId inexistente
- `lector_without_group` — usuario lector sin pertenecer a ningún grupo
- `studentMember_divergence` — `studentIds` y `memberIds` del mismo grupo difieren
- `school_with_users_no_group` — colegio con lectores pero sin grupo creado

**Cuándo invocarlo:**
- Pre-deploy backend (FASE B2): bloqueante. Si `ok=false`, no deploy.
- Post-deploy backend (FASE B8): bloqueante. Si counts cambian respecto al baseline pre-deploy, rollback.
- Tras cualquier importación masiva (CSV admin) o operación de membresía sospechosa.
- Auditoría periódica (recomendado: 1 vez por semana).

**Comando rápido:**
```bash
curl -sH "x-admin-secret: $ADMIN_SECRET" \
  https://chibaleteplus.chibaleteeditores.com/api/admin/membership/validate \
  | jq '{ok, counts, issuesCount: (.issues | length)}'
```

---

## 17. Health endpoint

`GET /api/health` (sin auth)

Devuelve un snapshot mínimo del estado de la instancia:
```json
{
  "status": "ok",
  "uptime": 12345,
  "ts": "2026-05-06T..."
}
```

**Cuándo invocarlo:**
- Loop de `wait healthy` en deploy/rollback.
- Healthcheck externo (uptime monitor) si se configura.
- Smoke post-deploy.

**Por qué sin auth**: para que el edge pueda usarlo como healthcheck sin
exponer credenciales y para que monitores externos (UptimeRobot, etc.) lo
puedan consumir libremente.

---

## 18. Checklist pre-deploy

### 18.1 Pre-deploy frontend

```
LOCAL
[ ] git status limpio
[ ] git pull --rebase origin master
[ ] npm run verify → todos los asserts verdes
[ ] npm run build → dist/ generado sin warnings rojos
[ ] docker build -t chibalete/front:$NEW_TAG .
[ ] docker save → tar generado
[ ] anunciar en canal: "deploy frontend $NEW_TAG en T-5min"

VPS
[ ] ssh: df -h /var → > 20% disponible
[ ] ssh: docker ps → todos los containers UP, restarts=0
[ ] ssh: docker images chibalete/front: $OLD_TAG presente (rollback ready)
[ ] ssh: cp docker-compose.yml a .bak-$TS y verificar tamaño > 0
```

### 18.2 Pre-deploy backend

```
LOCAL
[ ] git status limpio
[ ] git pull --rebase origin master
[ ] npm run verify → 212+96+9 asserts verdes
[ ] npm run typecheck:baseline → errores ≤ 5 (baseline conocido)
[ ] git diff HEAD~10 package-lock.json → vacío (si no, sprint distinto)
[ ] tar generado, excluyendo node_modules, __test__, *.log
[ ] anunciar: "deploy backend $RELEASE en T-10min"

VPS
[ ] ssh: df -h /var /root → > 20% disponible
[ ] ssh: docker ps → 4 containers UP, restarts=0
[ ] curl validate → ok=true (BLOQUEANTE)
[ ] ssh: bash /root/scripts/backup-vps.sh → exit 0 (ver §7.1)
[ ] confirmar /root/backups/chibalete/$TS contiene los 7 archivos esperados
      (data.tar.gz, data-critical.tar.gz, server.tar.gz, docker-compose.yml,
       uploads-manifest.txt, metadata.json, backup.log)
[ ] cat $TS/metadata.json | jq '.status' → "ok"
[ ] sesión SSH abierta con docker logs -f chibalete_api_1
[ ] navegador conectado a la app, listo para smoke
[ ] capturar baseline counts del validate pre-deploy
```

---

## 19. Checklist post-deploy

### 19.1 Post-deploy frontend

```
[ ] docker ps: chibalete_front con $NEW_TAG, status Up
[ ] docker exec chibalete_edge wget -qO- http://chibalete_front:80/ → 200
[ ] docker exec chibalete_edge nginx -t → ok
[ ] (post nginx -s reload) curl -sI https://... → 200
[ ] hard refresh navegador → bundle nuevo carga
[ ] smoke manual: login + Aula Viva + 1 mutación + validate → todo verde
[ ] logs frontend último 5min: cero error
[ ] echo entry en /root/deploys.log
```

### 19.2 Post-deploy backend

```
[ ] docker ps: api_1 + api_2 con uptime < 10min, restarts=0
[ ] /api/health vía edge → status=ok, uptime coherente con el restart
[ ] /api/admin/membership/validate → ok=true, counts == baseline
[ ] docker exec api_1 curl localhost:3000/api/health → ok
[ ] docker exec api_2 curl localhost:3000/api/health → ok

SMOKES (manuales en navegador, dos sesiones)
[ ] Smoke A: assignTeacherToGroup + abrir Aula Viva
            → mediador ve grupo nuevo sin hard refresh
[ ] Smoke B: admin1 modifica memberships + admin2 abre form fresco
            → checkboxes correctos
[ ] Smoke C: deleteGroup → no aparece como opción en form
[ ] Smoke D: deleteUser → no aparece como ID huérfano en Aula Viva

[ ] crear usuario de prueba → aparece en lista
[ ] eliminar usuario de prueba → desaparece
[ ] logs últimos 10min: cero ERROR, cero SECURITY, restarts=0
[ ] memoria estable durante 10min (no crece linealmente)
[ ] echo entry en /root/deploys.log
```

---

## 20. Qué NO hacer nunca

> 🔴 Esta sección lista las acciones que **rompen producción o destruyen datos**. Si vas a hacer cualquiera de estas, **detente y consulta**. No hay excepciones de "pero esta vez es diferente".

| # | Prohibido | Por qué |
|---|---|---|
| 1 | `docker compose down` | Tira **todos** los services (edge + front + api_1 + api_2) = downtime total. Solo `docker compose up -d --no-deps <service>` o `docker restart <container>` |
| 2 | Borrar o renombrar `/var/www/chibalete/data/` | Pérdida de datos vivos. Sin backup actualizado, irreversible |
| 3 | Borrar o renombrar `/var/www/chibalete/data-critical/` | Datos sensibles + auditoría. Sin esto, debugging post-incidente imposible |
| 4 | Borrar o renombrar `/var/www/chibalete/public/uploads/` | Archivos editoriales reales. No hay backup por contenido (solo manifiesto) |
| 5 | Copiar frontend (`dist/`) a `/var/www/chibalete/` | El frontend vive en la imagen Docker, NO en el filesystem. Esto crea ruido y NO sirve a nadie |
| 6 | Levantar PM2 en el host (`pm2 start ecosystem.config.cjs`) | Producción es Docker. PM2 paralelo intenta puerto 3000 que ya usan los api_X (interno) o entra en conflicto con healthchecks |
| 7 | `nano server/server.js` dentro del container con `docker exec` | Cambios "en caliente" se pierden al próximo restart, no quedan en git, no son auditables |
| 8 | Hotfix dentro del container (`docker exec ... apt install`, etc.) | El cambio se pierde al rebuild de imagen. Imposible reproducir en otro ambiente |
| 9 | `docker restart chibalete_edge` "porque sí" | Edge tiene IPs upstream cacheadas; reiniciar sin razón puede romper temporalmente la conexión a front/api |
| 10 | Asumir que `docker-compose.prod.yml` (en repo) gobierna producción | El compose canónico vive en `/opt/chibaleteplus/docker-compose.yml`. El del repo es ejemplo histórico |
| 11 | Editar `/etc/nginx/sites-available/*` esperando que afecte algo | nginx system NO corre. La config real está dentro del container `chibalete_edge` |
| 12 | Restart simultáneo de `api_1` y `api_2` | Ambos containers down a la vez = backend caído = todos los requests fallan |
| 13 | `docker rmi chibalete/api:latest` o cualquier imagen activa | Si los containers se reinician después, no encuentran imagen y fallan |
| 14 | `git pull` directamente en `/var/www/chibalete/server/` | Salta el flujo de deploy: sin verify, sin backup, sin pre-validate, sin staggered restart |
| 15 | Ejecutar el `.deploy-front-*.sh` de un sprint pasado contra una versión nueva | Los scripts son versionados con tags concretos. Reusarlos cross-version puede fallar de formas no obvias |
| 16 | `chmod -R 777 /var/www/chibalete/` | Pérdida total de control de permisos. No resuelve nada que un mount correcto no resuelva |
| 17 | Modificar `/opt/chibaleteplus/nginx/nginx.conf` sin `nginx -t` previo | Una syntax error en config → reload falla → edge sigue con config vieja silenciosamente, posible 502 si reinicia |

---

## 21. Diferencia fundamental entre frontend y backend

> Esta sección es la más importante de toda la guía. Si solo lees una sección, lee esta.

| Aspecto | Frontend | Backend |
|---|---|---|
| **Imagen Docker** | `chibalete/front:<tag>` con tag inmutable por release | `chibalete/api:latest` (estática, no cambia entre deploys) |
| **Mounts** | **Ninguno** | 4 bind mounts vivos a `/var/www/chibalete/` |
| **Dónde vive el código** | Dentro de la imagen | En el host (`/var/www/chibalete/server/`) |
| **Cómo se actualiza** | Build nueva imagen + recreate container | Reemplazar archivos en host + restart staggered |
| **Cómo se hace rollback** | Cambiar tag en compose al `OLD_TAG` + recreate | Swap atómico de directorio (`server.old-$TS` ↔ `server`) + restart staggered |
| **Reload de edge** | ✅ Obligatorio (IP cambió) | ❌ No necesario (containers mantienen IP en restart) |
| **¿Toca data?** | Nunca (sin mounts) | Lee/escribe (con `withFileLock`) — backup obligatorio |
| **¿Cambia con cada deploy?** | Casi siempre | Solo si `server/`, `utils/` o `types/` cambiaron |
| **Tiempo típico** | 2-3 min (build + transfer + reload) | 5-10 min (verify + backup + transfer + 2 restarts staggered + smoke) |

**Regla mnemotécnica:**
> ✅ Frontend = imagen inmutable
> ✅ Backend = bind mount vivo
> 🔴 Mezclar ambos modelos = deploy roto

---

## 22. Troubleshooting

### 22.1 "El deploy frontend completó pero los usuarios siguen viendo lo viejo"

**Causa probable**: navegador cacheó el `index.html` con referencias a los assets viejos.

**Diagnóstico:**
```bash
# Confirmar que el bundle nuevo está sirviendo
curl -s https://chibaleteplus.../index.html | grep -oE '/assets/[^"]+\.js' | head -5
# Comparar con el bundle nuevo construido localmente
ls dist/assets/*.js
```

**Solución:**
1. Hard refresh del navegador (Ctrl+Shift+R en Chrome/Firefox).
2. Si persiste: clear cache del browser.
3. Si afecta a muchos usuarios: revisar headers `Cache-Control` en nginx config del edge — `index.html` debe ir con `no-cache`.

### 22.2 "Después del deploy backend, validate devuelve `ok=false`"

**Causa probable**: el deploy mutó datos durante la transición.

**Diagnóstico:**
```bash
ssh root@VPS "curl -sH 'x-admin-secret: $SEC' \
  http://localhost:3000/api/admin/membership/validate | jq .issues"
```

**Solución:**
1. Si `issues[]` es nuevo (no estaba en baseline): **ROLLBACK BACKEND** (sección 15).
2. Si era pre-existente: limpieza manual con `syncGroupMembership` por grupo afectado, sin rollback.

### 22.3 "`docker compose up -d --no-deps front` falla con 'image not found'"

**Causa probable**: el `docker load` no completó o el tag está mal escrito.

**Diagnóstico:**
```bash
ssh root@VPS "docker images chibalete/front"
ssh root@VPS "grep 'image:' /opt/chibaleteplus/docker-compose.yml"
```

**Solución:**
1. Confirmar que el tag en compose coincide con el de `docker images`.
2. Re-cargar la imagen: `docker load -i /tmp/front-$TAG.tar`.
3. Si el tar no llegó al VPS, repetir el `scp`.

### 22.4 "api_1 entra en restart loop después del deploy"

**Causa probable**: el código nuevo tiene un error que crashea Express en el arranque.

**Diagnóstico:**
```bash
ssh root@VPS "docker logs --tail 100 chibalete_api_1"
```

Buscar excepción al arrancar o error de require/import.

**Solución:**
1. **ROLLBACK BACKEND inmediato** (sección 15).
2. Reproducir el error en local con `npm run server`.
3. Fix + nuevo deploy.

### 22.5 "/var lleno"

**Causa probable**: logs Docker sin rotación + uploads grandes acumulados.

**Diagnóstico:**
```bash
ssh root@VPS "df -h /var"
ssh root@VPS "du -sh /var/lib/docker/containers/*/* 2>/dev/null | sort -h | tail -10"
ssh root@VPS "du -sh /var/www/chibalete/public/uploads"
```

**Solución:**
1. **NO `docker system prune`** sin pensar — puede borrar imágenes necesarias para rollback.
2. Truncar logs específicos: `truncate -s 0 /var/lib/docker/containers/<id>/<id>-json.log`.
3. Cleanup de imágenes viejas: `docker image prune --filter "until=720h"` (cuidado con tags retenidos para rollback).
4. Configurar log rotation en `docker-compose.yml` (sub-fase 2B.10).

### 22.6 "Nginx edge devuelve 502 Bad Gateway"

**Causa probable**:
- `chibalete_front` o algún `api_X` está caído.
- IP cambió y edge no reloadeó.

**Diagnóstico:**
```bash
ssh root@VPS "docker ps | grep chibalete"
ssh root@VPS "docker exec chibalete_edge wget -qO- http://chibalete_front:80/"
ssh root@VPS "docker exec chibalete_edge wget -qO- http://chibalete_api_1:3000/api/health"
```

**Solución:**
1. Si front caído: `docker compose up -d --no-deps front`.
2. Si api_X caído: `docker start chibalete_api_X` y revisar logs.
3. Si todos UP pero edge sigue 502: `docker exec chibalete_edge nginx -s reload`.

### 22.7 "Working tree dirty en `/var/www/chibalete/server/`"

**Causa probable**: alguien editó archivos directamente en el VPS sin pasar por el flow de deploy.

**Diagnóstico:**
```bash
ssh root@VPS "cd /var/www/chibalete/server && git status"
```

**Solución:**
1. **NO descartar** los cambios sin entender qué hacen.
2. Hacer `git diff` y revisar.
3. Si son legítimos: traerlos a local, commit, deploy normal.
4. Si son hotfix de emergencia ya validados: backup del directorio, hacer `git checkout .` para limpiar, y considerar el incidente cerrado.

---

## 23. Glosario operacional

| Término | Definición |
|---|---|
| **Bind mount** | Carpeta del host expuesta dentro del container vía `volumes:` en compose. Cambios en el host se ven inmediatamente en el container y viceversa |
| **Compose canónico** | El único `docker-compose.yml` que gobierna producción: `/opt/chibaleteplus/docker-compose.yml` |
| **Edge** | El container `chibalete_edge`, único expuesto a Internet. Hace TLS y reverse proxy |
| **Healthy** | Container responde HTTP 200 a `/api/health`. Distinto de "running" (que solo significa que el proceso PID 1 está vivo) |
| **OLD_TAG / NEW_TAG** | Etiquetas Docker semánticas (formato `YYYY-MM-DD-<slug>`) usadas en deploy/rollback frontend |
| **Restart staggered** | Reiniciar `api_1`, validar, después reiniciar `api_2`. Garantiza zero-downtime |
| **Server truth** | El backend es la única fuente autoritativa. Cualquier cache (frontend, navegador) es derivado y puede estar stale |
| **Smoke test** | Verificación manual post-deploy desde el navegador, con sesiones reales, validando flujos críticos (login, Aula Viva, validate) |
| **Swap atómico** | `mv directoryA directoryB` en mismo filesystem es atómico a nivel kernel. Patrón usado en el deploy backend para reemplazar `/var/www/chibalete/server/` sin estado intermedio |
| **TS** | Timestamp `YYYYMMDD-HHMMSS` usado para nombrar backups, snapshots y entries en `/root/deploys.log` |
| **`unless-stopped`** | Restart policy de Docker: el container se reinicia automáticamente si crashea, pero NO si fue parado manualmente con `docker stop` |
| **Validate endpoint** | `GET /api/admin/membership/validate`. Termómetro estructural de integridad de membresías |
| **withFileLock** | Lock cooperativo cross-process implementado en el backend para serializar escrituras a JSONs entre `api_1` y `api_2` |

---

## 24. Referencias

- **Compose canónico**: `/opt/chibaleteplus/docker-compose.yml` (en VPS)
- **Nginx edge config**: `/opt/chibaleteplus/nginx/nginx.conf` (en VPS)
- **Backups**: `/root/backups/chibalete/$TS/` (retention 7 días)
- **Deploy log**: `/root/deploys.log` (append-only)
- **VPS host**: `root@72.60.158.97`
- **Dominio público**: `https://chibaleteplus.chibaleteeditores.com`
- **Repo**: ver `git remote -v` en local

### Archivos relacionados en el repo
- `nginx.prod.conf` — referencia local del nginx config; el real vive en VPS
- `Dockerfile.front` (en `deployment_package/`) — base para construir `chibalete/front:<tag>`
- `Dockerfile.api` (en `deployment_package/`) — base de `chibalete/api:latest`
- `scripts/backup-vps.sh` — backup operacional canónico (§7.1)
- `.audit-vps.sh` / `.audit-vps-2.sh` — scripts de auditoría read-only
- `.deploy-front-*.sh` — scripts de deploy frontend versionados por release
- `.rollback-front-*.sh` — scripts de rollback frontend versionados
- `debug_vps.sh` — diagnóstico operativo

### Documentos archivados (no canónicos)
- `deployment_guide.legacy.md` — versión PM2-first previa (referencia histórica solamente)
- `deployment_emergency_kit.md` — primera setup desde cero, parcialmente desactualizado
- `deployment_package/README_DEPLOY.md` — snapshot temprano

---

> Cualquier cambio en este documento debe ir acompañado del cambio
> correspondiente en el VPS (o viceversa). La doc y la realidad son **una
> sola cosa**. Si divergen, este documento miente.
