# Operational Architecture Summary — Chibalete+

> Mapa de **un vistazo** de cómo se despliega Chibalete+ en producción.
> Para procedimiento paso a paso, ver los runbooks canónicos al pie.

## Topología productiva (recordatorio)

VPS único (Hostinger, `root@72.60.158.97`). Docker Compose en
`/opt/chibaleteplus/docker-compose.yml`. **4 containers:**

- `chibalete_edge` — nginx:alpine, puertos 80/443
- `chibalete_front` — imagen `chibalete/front:<tag>`, sin mounts
- `chibalete_api_1`, `chibalete_api_2` — imagen `chibalete/api:latest`, con bind mounts a `server/`, `utils/`, `data/`, `data-critical/`, `public/uploads/`

## Dos stacks de deploy paralelos

Chibalete+ usa **dos modelos de deploy distintos y coherentes**, uno por
cada lado de la app. **No comparten mecanismo.**

### Backend deploy model

- **Payload:** bind-mounted runtime — el código vive en `/var/www/chibalete/server/` y `/var/www/chibalete/utils/` montado dentro de `chibalete_api_1` y `chibalete_api_2`.
- **Mecanismo:** swap atómico de directorio (`server/` → `server.old-<TS>` + nuevo `server/`) orquestado desde local por `scripts/deploy-backend.sh`.
- **Restart:** staggered — primero `api_1`, validación de health/validate, luego `api_2`. Mantiene servicio activo durante todo el deploy.
- **Rollback:** automático ante fallo de validación o health, vía `mv server.old-<TS> server` + restart inverso. Ventana de minutos, sin pérdida de tráfico.
- **Validate-aware:** el deploy se aborta si el endpoint `/api/admin/membership/validate` no devuelve `ok=true` (con flag opcional `--accept-legacy-validate` para legacy drift).
- **Sin rebuild de imagen:** `chibalete/api:latest` no cambia salvo modificación de `package.json`. El bind-mount evita el ciclo image build/push/pull.
- **Runbook canónico:** `docs/sprint022-runbook.md`

### Frontend deploy model

- **Payload:** imagen Docker inmutable — el bundle React/Vite + nginx.prod.conf viajan dentro de `chibalete/front:<tag>`. Sin mounts en runtime.
- **Mecanismo:** build determinístico local (`docker build --pull`) → `docker save | gzip` → `scp` con sha256 verificado → `docker load` en VPS → edición manual de `image:` en `docker-compose.yml` → `docker compose up -d --no-deps front`.
- **Restart:** recreate único de `chibalete_front`. `--no-deps` garantiza que api_1, api_2 y edge no se tocan.
- **Edge nginx:** sólo `nginx -t` + `nginx -s reload` desde `chibalete_edge`. Nunca recreate, nunca modificación de config.
- **Rollback:** swap inverso — editar `image:` al tag previo (documentado pre-deploy) + `docker compose up -d --no-deps front` + reload edge. Validación post-rollback explícita (R1-R18 en runbook).
- **Browser cache realities:** el HTML servido puede quedar cacheado en clientes; el bundle hashed es immutable safe. Verificación post-deploy distingue "deploy llegó al edge" (curl) de "deploy llegó al cliente" (incognito/hard-refresh).
- **Runbook canónico:** `docs/sprint022-frontend-deploy.md`

## Principio central

> **Backend y frontend NO comparten mecanismo de deploy.**

| Eje | Backend | Frontend |
|---|---|---|
| Payload | bind-mount | imagen Docker |
| Inmutabilidad | mutable (swap directorio) | inmutable (tag por release) |
| Rebuild | no (salvo `package.json`) | sí, cada release |
| Rollback | automático, validación-driven | manual, tag-driven |
| Tooling | `deploy-backend.sh`, `backup-vps.sh` | `docker save/load` + edición compose |
| Granularidad | restart staggered de 2 réplicas | recreate de 1 container |
| Cache cliente | irrelevante (server-side) | factor de validación post-deploy |

**No mezclar ambos procedimientos en la misma release window** sin
razón documentada por escrito (issue, post-mortem, hotfix de seguridad).
Los modos de falla son ortogonales — mezclarlos contamina el diagnóstico
y hace ambiguo el rollback.

Si ambos lados requieren cambio: ejecutar en ventanas separadas, con
smoke verde de la primera antes de iniciar la segunda.

## Referencias canónicas

- **Backend runbook:** `docs/sprint022-runbook.md`
- **Frontend runbook:** `docs/sprint022-frontend-deploy.md`
- **Arquitectura general:** `CLAUDE.md` § "Deployment"
- **Guía de despliegue (canónica, alto nivel):** `deployment_guide.md`
- **Documentos archivados (PM2-first, NO usar):** `deployment_guide.legacy.md`, `deployment_emergency_kit.md`
