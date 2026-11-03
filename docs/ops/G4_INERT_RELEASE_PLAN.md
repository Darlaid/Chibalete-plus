# G4 inerte: plan de despliegue y rollback (G4-RELEASE-GATE-02A)

**Estado:** preparado, **no ejecutado**. Desplegar requiere una orden propia.
Procedimiento general: `deployment_guide.md` §12 (deploy por imagen), §13
(réplica a réplica), §14/§15 (rollback).

## Candidatos

| | API | Front |
|---|---|---|
| Commit | `d0c72da` (contenido de imagen = `893d810`; `d0c72da` solo neutraliza `scripts/deploy-backend.sh`, que no entra en ninguna imagen) | igual |
| Tag | `chibalete/api:g4inert-d0c72da` | `chibalete/front:g4inert-d0c72da` |
| Image ID | `sha256:3bd961d69274ee62db2eb72f61d51343aa3b0036a13fd1ae42f5f63402b738f3` | `sha256:f72a6c67a9324c200bff4bd37b2cb62705d3b983f60588960d642730baa237d9` |
| Artefacto | `api-g4inert-d0c72da.tar.gz`, 151 402 691 B | `front-g4inert-d0c72da.tar.gz`, 28 661 252 B |
| SHA-256 del artefacto | `b9aaa92eab377424ab6c7e09b1ee7698652e07ba9986242b255c4cf39ccdced0` | `02cf1575d5fa615195410f38c2157ddf051c69d23f5d37deb776b784d6286650` |

Construidos con `git -c core.autocrlf=false archive d0c72da`, `--platform linux/amd64`, `--pull`.

## Estado de producción de partida (2026-11-03 20:37Z)

| | Valor |
|---|---|
| `api_1`, `api_2` | `chibalete/api:secdeps-0a606c0` = `sha256:12460b15e61a…`, healthy, RestartCount 0 |
| `front` | `chibalete/front:g0-f4836d1` = `sha256:805ab8289273…`, healthy |
| Override | `b7ddcc3f7cece101bbc25fba033296483ea6c6e8a9a4b65c7070e93ef7ebfe31`; `image:` en líneas **40** (api_1), **85** (api_2), **130** (front) |
| `front-m1/conf.d/default.conf` | `d6fdff25…`; se monta sobre la imagen y **no cambia** |
| Respaldo | `structured-backup` ok 20:09Z, 32 entradas, `gamification.db` = `absent_optional`; runner `stores.py` = `62a3dcc4…` |
| Gamificación | 0 variables `GAMIFICATION_*`/`XP_*`/`PM_*`; sin clave de sujeto; sin `gamification.db` |
| Recursos | 61 GB libres; 6,7 GB de memoria disponible |

## Ventana 1: API (réplica a réplica)

1. Preflight solo lectura: los valores de la tabla anterior siguen iguales; `structured-backup` correcto en las últimas 6 h.
2. `mkdir /root/chp-g4inert`; `scp` del artefacto API; `sha256sum` = el de la tabla; `docker load`.
3. Rollback preparado **antes** de tocar nada:
   - `docker tag chibalete/api:secdeps-0a606c0 chibalete/api:rollback-pre-g4inert`
   - `cp docker-compose.override.yml docker-compose.override.yml.bak-pre-g4inert-$TS`
   - `ROLLBACK.txt` en `/root/chp-g4inert/`.
4. `edge-instance.sh drain api_1`; 65 s; `sed` **solo** de la línea 40; `docker compose config --images`; `docker compose up -d --no-deps --force-recreate api_1`. <!-- chp-evidence-ratchet: allow --images-no-imprime-config-ni-entorno -->
5. Gate de `api_1` en un paso propio: healthy, logs sin excepciones, `[ERROR]` ni lock; `GET /api/me/progress` con sesión → **404**; ningún `gamification*` en `/app/data-critical`. Después `rejoin api_1`.
6. Otro comando: lo mismo con la línea 85 y `api_2`.
7. Post: mismo digest en las dos, `analytics-summary` **sin** `recognition`, validate ok, `structured-backup` posterior correcto y sin `gamification.db`.

**Convivencia de versiones:** las entregas MOOK nuevas llevan `workAccess`, que la imagen anterior ignora. No hay migraciones: las de gamificación solo corren al abrir el ledger, y con la flag apagada no se abre.

## Ventana 2: front (separada)

1. `scp` del artefacto front; `sha256sum`; `docker load`.
2. `docker tag chibalete/front:g0-f4836d1 chibalete/front:rollback-pre-g4inert`; copia del override.
3. `sed` solo de la línea 130; `config --images`; `up -d --no-deps --force-recreate front`; `nginx -t` y `nginx -s reload` en el edge.
4. Post: el bundle nuevo se sirve (`index-*.js` distinto); Perfil sin «Nivel» ni «Puntos de Magia»; ningún enlace «Mi progreso»; lectura guiada e inmersiva correctas.

**Cambio visible aunque XP siga apagado (U0):** desaparecen el XP, el nivel, la racha y los avisos de XP del lector inmersivo, Perfil, Inicio y el panel del mediador. Debe comunicarse antes.

## Rollback

Solo imágenes y override; **nunca datos**.

- **API:** `cp docker-compose.override.yml.bak-pre-g4inert-$TS docker-compose.override.yml`; réplica a réplica (drain, recreate, gate, rejoin) con `rollback-pre-g4inert` = `12460b15e61a`.
- **Front:** restaurar el override (línea 130 → `g0-f4836d1`), recrear `front` y recargar el edge.
- No se borran `rollback-pre-*`; no se limpian locks ni se restauran stores.

## Condiciones que bloquean el despliegue

- `trivy-image (api)` debe quedar verde en CI sobre el commit desplegado. En `d0c72da` falló el paso de **build** del job; el mismo Dockerfile construyó bien en `image-integrity` y en local, y el escaneo local dio 0 hallazgos.
- Cualquier variable `GAMIFICATION_*`, `XP_*` o `PM_*` en el override: STOP.

## Riesgo preexistente que bloquea activar XP (no el despliegue inerte)

`requireReviewScope` (desde `3a2f98c`, 2026-09-09, ya en producción) autoriza
con la caché JSON de 30 s de cada réplica. Si la entrega aún no está en la
caché de la réplica que atiende, la comprobación deja pasar, y `mutateMook`,
que lee del disco, aplica la revisión. Reproducido en laboratorio: un
mediador de **otro** grupo aprueba una entrega creada en la otra réplica
(200); en la misma réplica, o pasados 30 s, recibe 403. Hoy no es explotable
en producción porque no hay nodos PRODUCTION ni entregas, y hace falta conocer
el id de la evidencia. Debe corregirse antes de publicar experiencias con
PRODUCTION para grupos reales y siempre antes de activar XP.
