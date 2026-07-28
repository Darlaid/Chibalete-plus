# CHP-RELEASE-IMAGE-01A — Plan de compose (PREPARADO, NO APLICADO)

> **Estado:** este documento describe el delta recomendado para
> `/opt/chibaleteplus/docker-compose.yml`. **No se ha aplicado.** El despliegue
> es una unidad posterior.

## 1. Por qué existe este delta

La imagen `chibalete/api:af319ca` se construía con `npm install` copiando sólo
`package.json` —sin lockfile— y **sin copiar `utils/` ni `engines/`**. Dos
consecuencias:

1. **Dependencias a la deriva.** Quedó con `multer 2.1.1` cuando el lockfile fija
   `2.2.0`, y sin `@opentelemetry/core`. La versión vieja arrastraba además
   `CVE-2026-5079` (HIGH).
2. **Imagen incompleta.** `server/server.js` importa `../utils/*.mjs` y
   `server/metrics/metricsRouterV2.mjs` importa `../../engines/metrics/*.mjs`.
   La API sólo arrancaba gracias a los bind mounts de código del compose.

El resultado era que el compose **compensaba una imagen rota** montando código
desde el host. La imagen nueva es autosuficiente y elimina esa compensación.

## 2. Estado actual (ambas API)

```yaml
  api_1:                              # idéntico en api_2
    image: chibalete/api:af319ca
    volumes:
      - /var/www/chibalete/data:/app/data:rw
      - /var/www/chibalete/public/uploads:/app/public/uploads:rw
      - /var/www/chibalete/data-critical:/app/data-critical:rw
      - /var/www/chibalete/server:/app/server:ro     # ← mount de CÓDIGO
      - /var/www/chibalete/utils:/app/utils:ro       # ← mount de CÓDIGO
      - type: bind
        source: /var/www/chibalete/secrets
        target: /app/secrets
        read_only: true
        bind: { create_host_path: false }
```

Nota: `engines/` **ni siquiera está montado hoy** ni existe en
`/var/www/chibalete/`. Por eso `8e2855d` no puede desplegarse por bind mount
sobre `af319ca`.

## 3. Delta recomendado (aplicar a `api_1` **y** `api_2`)

```yaml
  api_1:
    image: chibalete/api:<FINAL_COMMIT>-candidate   # ← imagen nueva, tag por commit
    volumes:
      - /var/www/chibalete/data:/app/data:rw
      - /var/www/chibalete/public/uploads:/app/public/uploads:rw
      - /var/www/chibalete/data-critical:/app/data-critical:rw
      # RETIRAR: - /var/www/chibalete/server:/app/server:ro
      # RETIRAR: - /var/www/chibalete/utils:/app/utils:ro
      # NO AÑADIR mount de engines/: el código viaja dentro de la imagen.
      - type: bind
        source: /var/www/chibalete/secrets
        target: /app/secrets
        read_only: true
        bind: { create_host_path: false }
      - type: bind                                   # ← NUEVO
        source: /var/www/chibalete/deploy/.deploy-info
        target: /app/server/.deploy-info
        read_only: true
        bind: { create_host_path: false }
```

`METRICS_ENGINE` **permanece en `legacy`**. Este delta no lo toca.

### Evidencia de que los mounts de código ya no son necesarios

Dos canaries con la imagen nueva y **cero mounts de código** (Fase 6 y Fase 8):

| Verificación | Resultado |
|---|---|
| Arranque, `restarts=0`, healthcheck Docker | `healthy` |
| `/api/health`, `/api/health/ready` | 200 / 200 |
| `/app/server`, `/app/utils`, `/app/engines` | presentes desde la imagen |
| `multer` / `@opentelemetry/core` | 2.2.0 / 1.30.1 (== lockfile) |
| Admin secret file-only (archivo vs entorno señuelo) | 200 vs 401 |
| `/api/users`, `/api/groups`, `/api/schools` | 200 sobre fixtures |
| API v2 (`contractVersion: 2`), org inexistente, cross-org | 200 / 404 / 403 |
| Aula Viva operacional e institucional | 200 / 200 |
| Upload multipart real (multer 2.2.0) | 200 |

**Conclusión: no se demostró ninguna incompatibilidad. Ningún mount de código
es necesario.** Recomendación: código inmutable dentro de la imagen; externos
únicamente stores, uploads, secrets y deploy-info.

## 4. `.deploy-info` — requisito bloqueante del despliegue

`server/healthHandler.js` resuelve:

- `commit` ← `deploy-info.git_sha` → `GIT_SHA` (env) → `null`
- `deployed_at` ← `deploy-info.deployed_at` → `null` (**sin fallback de env**)

Hoy `/var/www/chibalete/server/.deploy-info` **no existe**, así que
`deployed_at` sería `null` y el smoke productivo debe fallar por contrato.

La imagen fija `GIT_SHA` como build-arg, de modo que `commit` nunca es nulo
aunque falte el archivo; pero `deployed_at` exige que **el flujo de despliegue
genere `.deploy-info` al publicar la release**, con la fecha real del deploy.
No se hornea en la imagen a propósito: una fecha de build mentiría sobre cuándo
se desplegó.

Formato esperado:

```json
{
  "release_tag": "<tag de la release>",
  "git_sha": "<sha completo>",
  "deployed_at": "<ISO 8601 del deploy real>"
}
```

## 5. Procedimiento de despliegue previsto (no ejecutar aquí)

1. Publicar la imagen nueva en el host (build o carga).
2. Generar `/var/www/chibalete/deploy/.deploy-info` con la fecha real.
3. Editar el compose (delta §3) para **ambas** API.
4. Recreado **escalonado**: `api_1` → validar smoke → `api_2`.
5. Verificar en cada instancia: health 200, `commit` y `deployed_at` no nulos,
   admin file-only, API v2, Aula Viva.
6. Los bind mounts de código (`/var/www/chibalete/server`, `utils`) quedan en
   disco tras el cambio: **conservarlos** hasta consolidar, son el rollback.

## 6. Rollback

Revertir `image:` a `chibalete/api:af319ca` y restaurar los dos mounts de
código. Como el árbol `/var/www/chibalete/server` no se toca, el rollback es
una edición de compose + recreado escalonado.

## 7. Riesgo residual

Con la imagen nueva, `server/`, `utils/` y `engines/` dejan de ser
hot-swappables por rsync: **todo cambio de backend exige rebuild de imagen**.
Es el objetivo (inmutabilidad y trazabilidad), pero cambia el runbook de
despliegue de backend descrito en `deployment_guide.md`, que debe actualizarse
en la unidad de despliegue.
