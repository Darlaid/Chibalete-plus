# V4 Deploy Runbook — comandos exactos

> Runbook **canónico** del deploy v4. Complementa `deployment_guide.md`
> (arquitectura general) con los pasos específicos de esta release.
>
> **Operador humano ejecuta. NO automatizado.** Cada comando es
> deliberado y trazable en consola SSH.
>
> **Prerequisito**: leer `V4-RELEASE-HARDENING.md` y aceptar el GO/NO-GO.

## 0. Pre-flight (en la workstation local, antes de tocar el VPS)

```bash
# 1. Confirmar branch + commit
cd /path/to/repo
git status --short                         # debe estar limpio o sabido
git log --oneline -1                       # anotar commit hash

# 2. Tests verdes
npm ci                                     # consistente con package-lock
npm run test:analytics                     # 771 ✓ (15 suites)
npm run test:reading-runtime               # 162 ✓ (5 suites)
npm run test:seed-local-admin              # 40 ✓
npm run typecheck:baseline                 # solo error pre-existente useImmersivePlayback
npm run build                              # dist/ generado, sin errores

# 3. Anotar tag de release
TAG_V4=v4.0.0-$(git rev-parse --short HEAD)
echo $TAG_V4
```

## 1. Decisión de scope del deploy

Marcar qué se va a actualizar (esta release v4 podría requerir solo backend, solo frontend, o ambos):

| Componente | Modificado en v4? | Acción |
|---|---|---|
| Frontend | **SÍ** — `ContentCard`, `VisorAccesible`, `VisorTexto`, `VisorAlbum`, `AulaVivaOperacional`, hooks nuevos (EditorialCover, useReducedMotion, useReadingRuntimeBridge), services extended | **build + recreate front** |
| Backend `server/` | **SÍ** — `leoOrchestrator.js`, `server.js`, nuevos: `leoBackboneEmitter.mjs`, `aulaVivaAuditEmitter.mjs`, `longitudinalSummary.mjs`, `signalCompute.mjs` extended, `signals.js` extended, `objectives.js` extended, `flags.js` extended, `operationalRouter.mjs` extended | **swap bind-mount + restart staggered backend** |
| Nginx edge | NO | **no tocar** |
| Data / data-critical / uploads | NO | **no tocar** |

## 2. Tagging + build de imágenes (workstation local)

### 2.1 Frontend

```bash
# Build de la imagen Docker frontend (NO copiar dist/ al VPS)
docker build -f Dockerfile.front -t chibalete/front:$TAG_V4 .

# Verificar tamaño + assets
docker images chibalete/front:$TAG_V4
docker run --rm chibalete/front:$TAG_V4 ls /usr/share/nginx/html/ | head -10

# Export a tarball para subir por SCP
docker save chibalete/front:$TAG_V4 -o chibalete-front-$TAG_V4.tar
ls -lh chibalete-front-$TAG_V4.tar    # esperado: ~50-100 MB
```

### 2.2 Backend (solo si cambió package.json)

`package.json` cambió en v4 (nuevos scripts). El módulo bind-mount se actualiza con el `server/` SWAP. **NO reconstruir imagen backend SALVO que `package.json/package-lock.json` haya cambiado.**

Verificar:

```bash
git diff main..HEAD -- package.json package-lock.json | head -5
# Si vacío → NO rebuild backend, solo swap server/
# Si tiene cambios → docker build -f Dockerfile.api -t chibalete/api:$TAG_V4 .
```

En v4: `package.json` cambió (3 scripts nuevos: `test:reading-runtime`, `test:seed-local-admin`, `seed:admin-local`, +entries en `test:analytics`). **NO necesita rebuild** porque ningún cambio toca `dependencies`. El `server/` bind-mount es la fuente de verdad del código backend.

## 3. SCP al VPS

```bash
# Frontend tarball
scp chibalete-front-$TAG_V4.tar root@72.60.158.97:/tmp/

# Server/ bundle (solo si swap backend)
cd /path/to/repo
tar czf /tmp/chibalete-server-$TAG_V4.tar.gz server/
scp /tmp/chibalete-server-$TAG_V4.tar.gz root@72.60.158.97:/tmp/
```

## 4. Backup VPS antes de deploy

`scripts/backup-vps.sh` ya existe en el repo. Ejecutar EN el VPS:

```bash
ssh root@72.60.158.97 << 'EOF'
bash /opt/chibaleteplus/scripts/backup-vps.sh
ls -lh /opt/chibaleteplus/backups/ | tail -10
EOF
```

**Verificar antes de seguir:** el último backup creado tiene tamaño razonable (>10MB para `data/`, >100KB para `data-critical/events.db`).

## 5. Deploy frontend

```bash
ssh root@72.60.158.97 << EOF
set -euo pipefail
cd /opt/chibaleteplus

# 1. Load imagen
docker load -i /tmp/chibalete-front-$TAG_V4.tar
docker images chibalete/front | head -3

# 2. Update docker-compose.yml tag (sed in-place)
sed -i.bak "s|chibalete/front:.*|chibalete/front:$TAG_V4|" docker-compose.yml
diff docker-compose.yml docker-compose.yml.bak | head -5

# 3. Recreate solo front (NO down, NO touch otros)
docker compose up -d --no-deps chibalete_front

# 4. Verificar
docker ps --filter name=chibalete_front
docker logs chibalete_front --tail 20

# 5. Reload nginx edge (necesario si el frontend cambia upstream)
docker exec chibalete_edge nginx -t
docker exec chibalete_edge nginx -s reload
EOF
```

## 6. Deploy backend (SOLO si toca código `server/`)

```bash
ssh root@72.60.158.97 << EOF
set -euo pipefail
cd /var/www/chibalete

# 1. Swap atómico de bind-mount server/
mv server server.old-$TAG_V4
mkdir server
tar xzf /tmp/chibalete-server-$TAG_V4.tar.gz -C . --strip-components=0
ls server/ | head -10        # verificar archivos esperados

# 2. Restart staggered: api_1 primero
docker compose -f /opt/chibaleteplus/docker-compose.yml restart chibalete_api_1
sleep 5
docker logs chibalete_api_1 --tail 30
# Esperar a que /api/health responda 200:
until curl -sf http://127.0.0.1:3001/api/health > /dev/null; do sleep 2; done
echo "api_1 OK"

# 3. Restart api_2
docker compose -f /opt/chibaleteplus/docker-compose.yml restart chibalete_api_2
sleep 5
docker logs chibalete_api_2 --tail 30
until curl -sf http://127.0.0.1:3002/api/health > /dev/null; do sleep 2; done
echo "api_2 OK"
EOF
```

**REGLA DURA:** NUNCA `docker compose down`. NUNCA tocar `data/`, `data-critical/`, `public/uploads/`. El bind-mount `server/` SÍ se swappea (es el código), pero los demás bind-mounts JAMÁS.

## 7. Activación de flags v4 (gradual)

Después del deploy, los flags están en su default (OFF). Activar gradualmente según `V4-FLAGS-MATRIX.md` §3:

```bash
ssh root@72.60.158.97 << 'EOF'
# Fase A — observabilidad (eventos llegan a events.db)
sudo -i
nano /opt/chibaleteplus/.env
# Agregar:
#   LEO_EVENTS_BACKBONE_ENABLED=1
#   AULA_VIVA_AUDIT_EVENTS_ENABLED=1
# Guardar + salir

# Restart staggered
docker compose -f /opt/chibaleteplus/docker-compose.yml restart chibalete_api_1
sleep 5 && curl -sf http://127.0.0.1:3001/api/health
docker compose -f /opt/chibaleteplus/docker-compose.yml restart chibalete_api_2
sleep 5 && curl -sf http://127.0.0.1:3002/api/health
EOF
```

Validar tras Fase A (24h mínimo) antes de Fase B. Ver `V4-SMOKE-CHECKLIST.md`.

## 8. Post-deploy healthcheck inmediato

Desde la workstation:

```bash
# Health endpoints
curl -sf https://chibaleteplus.chibaleteeditores.com/api/health             | head -c 200
curl -sf https://chibaleteplus.chibaleteeditores.com/api/health/ready       | head -c 200
curl -sf https://chibaleteplus.chibaleteeditores.com/api/health/analytics   | head -c 500
curl -sf https://chibaleteplus.chibaleteeditores.com/metrics | grep "^chibalete_" | head -20

# Login real (con cuenta de admin de producción, NUNCA admin local)
curl -X POST https://chibaleteplus.chibaleteeditores.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"<EMAIL_REAL_ADMIN>","password":"<PASSWORD_REAL>"}' | head -c 200

# Smoke browser (manual): seguir V4-SMOKE-CHECKLIST.md
```

## 9. Si algo falla → rollback

Ver `V4-ROLLBACK-RUNBOOK.md`.

## 10. Limpieza post-deploy (después de 24h estable)

```bash
ssh root@72.60.158.97 << EOF
# Borrar tag anterior de docker
docker images chibalete/front | grep -v $TAG_V4 | grep -v REPOSITORY | head -5
# (revisar antes de docker rmi)

# Borrar server.old-* si el deploy está estable
ls /var/www/chibalete/ | grep server.old
# rm -rf /var/www/chibalete/server.old-<TAG_PREVIO>    # SOLO después de 24h

# Borrar tarballs en /tmp
rm /tmp/chibalete-front-$TAG_V4.tar
rm /tmp/chibalete-server-$TAG_V4.tar.gz
EOF
```

## Comandos PROHIBIDOS en este deploy

```
❌ docker compose down                       # rompería persistencia
❌ rm -rf /var/www/chibalete/data            # data productiva
❌ rm -rf /var/www/chibalete/data-critical   # events.db + insights.db
❌ rm -rf /var/www/chibalete/public/uploads  # contenido subido
❌ npm run seed:admin-local                  # solo local, JAMÁS en VPS
❌ docker build en el VPS                    # imágenes se construyen en workstation
❌ scp dist/* root@vps:/var/www/chibalete/   # frontend va por imagen Docker, no scp
```
