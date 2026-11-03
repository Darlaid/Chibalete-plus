# G4 inerte: plan de despliegue y rollback (G4-RELEASE-GATE-02A)

**Estado:** preparado, **no ejecutado**. Desplegar requiere una orden propia.
Procedimiento general: `deployment_guide.md` §12 (deploy por imagen), §13
(réplica a réplica), §14/§15 (rollback).

## Candidatos (G4-RELEASE-GATE-02A-R1, definitivos)

| | API | Front |
|---|---|---|
| Commit | `cf27126` (incluye SEC-MOOK-REVIEW-AUTHZ-01, CI 10/10) | igual |
| Tag | `chibalete/api:g4inert-cf27126` | `chibalete/front:g4inert-cf27126` |
| Image ID | `sha256:e19c1283d5e7ce306696ea9e0a2bcf6c132decaaea2fe145b332e4a0d69b8605` | `sha256:d4c12a327360ba9bedfe32b760d018e65855dc4a5606fc3dd5a6a4c2dd75542c` |
| Arquitectura | linux/amd64 | linux/amd64 |
| Artefacto | `api-g4inert-cf27126.tar.gz`, 151 413 697 B | `front-g4inert-cf27126.tar.gz`, 28 661 367 B |
| SHA-256 del artefacto | `edf5222cfd981c180e5f91e64fa4a071de146079e38317bc3462c4f92e1f44be` | `304c515efea99fd0e50d0c78cb67283f4c9da072f46f3b0a84d914c9dec8d690` |
| Trivy local (HIGH/CRITICAL, también sin corrección) | 0 | 0 |

Construidos con `git -c core.autocrlf=false archive cf27126`, `--platform linux/amd64`, `--pull`.
La API contiene `assertReviewScopeInLock` (1 definición, 3 usos); sus 420 dependencias
son idénticas a las de producción. El árbol estático del front es byte a byte el validado
en 2A (huella `5470d57c…`); libexpat 2.10.0-r0.

> **Retirados:** `g4inert-d0c72da` (api `3bd961d6…`, front `f72a6c67…`) **no** deben
> desplegarse: no incluyen la corrección de autorización de revisiones.

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
2. `mkdir /root/chp-g4inert`; `scp` de `api-g4inert-cf27126.tar.gz`; `sha256sum` = el de la tabla; `docker load`.
3. Rollback preparado **antes** de tocar nada:
   - `docker tag chibalete/api:secdeps-0a606c0 chibalete/api:rollback-pre-g4inert`
   - `cp docker-compose.override.yml docker-compose.override.yml.bak-pre-g4inert-$TS`
   - `ROLLBACK.txt` en `/root/chp-g4inert/`.
4. `edge-instance.sh drain api_1`; 65 s; `sed` **solo** de la línea 40; `docker compose config --images`; `docker compose up -d --no-deps --force-recreate api_1`. <!-- chp-evidence-ratchet: allow --images-no-imprime-config-ni-entorno -->
5. Gate de `api_1` en un paso propio: healthy, logs sin excepciones, `[ERROR]` ni lock; `GET /api/me/progress` con sesión → **404**; ningún `gamification*` en `/app/data-critical`. Después `rejoin api_1`.
6. Otro comando: lo mismo con la línea 85 y `api_2`. Ambas réplicas quedan en `chibalete/api:g4inert-cf27126`.
7. Post: mismo digest en las dos, `analytics-summary` **sin** `recognition`, validate ok, `structured-backup` posterior correcto y sin `gamification.db`.

**Convivencia de versiones:** las entregas MOOK nuevas llevan `workAccess`, que la imagen anterior ignora. No hay migraciones: las de gamificación solo corren al abrir el ledger, y con la flag apagada no se abre.

## Ventana 2: front (separada)

1. `scp` de `front-g4inert-cf27126.tar.gz`; `sha256sum`; `docker load`.
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

- CI verde sobre el commit de las imágenes: `cf27126` 10/10, incluidos `trivy-image (api)` y `trivy-image (front)`.
- Cualquier variable `GAMIFICATION_*`, `XP_*` o `PM_*` en el override: STOP.

## Autorización de revisiones entre réplicas: corregida

El riesgo detectado en 2A (`requireReviewScope` autorizaba con la caché de 30 s de
cada réplica) quedó corregido en `cf27126` (SEC-MOOK-REVIEW-AUTHZ-01): la revisión se
reautoriza dentro del lock de escritura, sobre la evidencia leída del disco y con los
grupos releídos. Verificado en el laboratorio con las imágenes candidatas: mediador
ajeno en la otra réplica, al instante, recibe 403 al revisar, comentar y pedir cambios;
un mediador retirado del grupo recibe 403; de cinco revisiones simultáneas solo una
transición es válida; y MOOK queda byte-idéntico tras cada denegación.
