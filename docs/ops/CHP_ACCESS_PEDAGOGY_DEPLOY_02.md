# CHP-ACCESS-PEDAGOGY-01D-DEPLOY-02 — Despliegue productivo por imágenes

Veredicto: `GREEN-PEDAGOGY-01D-DEPLOYED-AND-VERIFIED`.
Fecha: 2026-09-07, 12:43–12:55 UTC. Ventana total ≈ 12 minutos; sin corte de servicio.
Alcance: llevar a producción la protección del material pedagógico independiente
(`1ce78cb` + `bef0afe`) con imágenes nuevas de API y frontend, actualización exacta
del override y despliegue del `nginx.conf` autorizado. No se ejecutó el corte FilBo.

---

## 1. Commits, tags e imágenes

| Componente | Anterior | Nuevo |
|---|---|---|
| Commits | `cf544c7` (contenido de `e70c0f1` para los archivos afectados) | `1ce78cb3862f1a8f67d78112ea6d00fe0816a5c8` + `bef0afe49fd8982f5c363a3e22e7b770615975b2` |
| API tag | `chibalete/api:e70c0f1` | `chibalete/api:ped01d-bef0afe` |
| API image ID | `sha256:d588994affe44f41cd0303eac1a1551ec3cd68a9a9a0e2d111d6c1b4bdfe8ee6` | `sha256:cccf3de4fc4fe6230c152c196f03152e131a367b2f931f145193587478d4bba9` |
| Front tag | `chibalete/front:lupub-9842238` | `chibalete/front:ped01d-bef0afe` |
| Front image ID | `sha256:fe2109339ff8c23022c92b964e83d99a82b23fb5ede9ce763f0305247a8449c1` | `sha256:b5318c946f2c24ca1ff7d3e539dddec0c2f78f294637f34d6dcc68b84689277f` |
| Bundle principal | `index-CtsJKdMt.js` = `cd4b13f2…d0fb` | `index-3J6bowmj.js` = `d42999bdc7535053c3da34cf8414a0309f9e8b1a51e38c8243f9447e15e13673` |
| `nginx.conf` (host y contenedor) | `543beec6a413d0769ea95cf17d26b38474c8fb1342e9311dfcfc70c70ece72ef` (blob `cf544c7`) | `7614df60701c7aab47a54c1fad58a03723976cde70bb71cf63a59c51cd4d7cc1` (blob `bef0afe`) |
| Override | `5a6f3d7a…9778` | `bbb59972d00cf6b372e2f5a2b6ba48ebc13deddaf8a82e68f6e86b891a7de28e` |
| Edge | `nginx:alpine` `sha256:582c496c…c93d` (sin cambio de imagen) | idem, contenedor recreado |

Etiquetas OCI de la imagen API: `revision=bef0afe49fd8982f5c363a3e22e7b770615975b2`,
`version=CHP-ACCESS-PEDAGOGY-01D`. Ambas imágenes `linux/amd64`, igual que el VPS.

## 2. Procedencia de los artefactos

Contexto de build = `git -c core.autocrlf=false archive bef0afe` extraído en un
directorio limpio: 50 entradas raíz, **0 untracked**, 0 bytes CR. Ambas imágenes se
construyeron fuera del VPS con `Dockerfile.api` (`--build-arg GIT_SHA`, `RELEASE_TAG`) y
`Dockerfile.front` (`--pull`), y viajaron con el mecanismo de los deploys anteriores:
`docker save | gzip` → `scp` → `sha256sum` en destino → `docker load`.

| Artefacto | SHA-256 | Bytes | Integridad remota |
|---|---|---|---:|
| `chibalete-api-ped01d-bef0afe.tar.gz` | `bcecbc4150e149db81d1de90c3f7e672070fe928c7a70783d874f72625be38ac` | 153 858 346 | idéntica |
| `chibalete-front-ped01d-bef0afe.tar.gz` | `c82dbcc4d8efb91fcb0261fca7f43adc318acf3207a55a074431f500c2547d51` | 22 358 522 | idéntica |

Los image IDs cargados en el VPS coinciden byte a byte con los locales.

Archivos dentro de la imagen API, verificados en la imagen local, en la cargada y
dentro de cada contenedor recreado — iguales a los **blobs LF** de `bef0afe`:

| Archivo | SHA-256 |
|---|---|
| `/app/server/accessService.js` | `c717a09f78cbf467533c57372184d19908947b95822ba30f534421e40f0a0ed5` |
| `/app/server/server.js` | `45d2f2606847b496441ea7fbab616fe7e2df494308b31cc9b798212dca1106b4` |

La imagen anterior `e70c0f1` contenía los mismos blobs de `cf544c7` materializados con
CRLF (construida desde un checkout Windows): esa diferencia es legítima y quedó
registrada en DEPLOY-01. La imagen nueva no contiene `/app/data` ni `/app/scripts`.

El bundle nuevo ya no contiene el filtro local `tipo !== "contexto_pedagogico"`
(0 coincidencias en `assets/*.js`).

## 3. Baseline y gates previos

Baseline local: `bef0afe`, local == remoto (`git ls-remote`, sin `fetch`), tracked
limpio, 3 untracked y 3 stashes intactos. Producción: 4/4 healthy, `RestartCount` 0,
sin deploy ni backup concurrente, 44 GB libres, hashes iguales a los esperados.

**Gate de canonicalización URI** (`scratch/uri_gate.mjs`, sobre el `accessService.js`
del contexto `bef0afe`): 58 variantes — normales, `%2d`/`%2D`, doble encoding
(`%252d`, `%2570`), `%25`, slash y backslash codificados (`%2F`, `%5C`), `..`/`.`
literales y codificados, slashes múltiples, NUL (`%00`), `%` inválido (`%ZZ`, `%Z`,
`%` final), `%3F`, `%23`, mayúsculas, trailing slash, UTF-8, `+`. Oráculo: lo que
nginx serviría (alias sobre `$uri` decodificado una vez, slashes fusionados, puntos
resueltos) frente al veredicto del autorizador sobre `$request_uri`, recordando que
`auth_request` deniega con 500 cualquier código distinto de 2xx/401/403.
**0 fugas**: en ninguna variante un archivo pedagógico servido resulta `GENERAL` o
`UNMAPPED_ASSET`. 4 «cambios» en URLs malformadas de generales (`//uploads//x`,
`/uploads%2Fx`, `/uploads/./x`, `a/../x`) pasan de 200 a 500 — denegación extra,
sin fuga, que ningún navegador emite (normalizan los puntos en cliente y no
codifican `/`). Cierre empírico sobre el catálogo productivo: 108 registros,
1 078 referencias `/uploads/`, **0 con `%`, 0 no-ASCII, 0 con espacio**, todos los
ids en `[A-Za-z0-9_-]` — la única clase de divergencia teórica (nombres con `%`
literal) no existe en producción.

**Gate `mediaBaseUrl`:** `/api/runtime-config` devuelve `mediaBaseUrl: ""` → mismo
origen, la cookie viaja.

**Candidato `nginx.conf`:** validado con la misma imagen del edge (`582c496c…`) en un
contenedor efímero conectado a las dos redes del edge (`chibalete_net`,
`studio_bi_net`) con los mismos bind mounts en solo lectura: `syntax is ok`,
`test is successful`; únicos avisos los dos `ssl_stapling` preexistentes, idénticos
al vigente validado por el mismo método.

## 4. Rollback preparado (conservado)

Directorio `/root/chp-pedagogy-01d-deploy-02/` con `docker-compose.override.yml.pre`,
`docker-compose.override.yml.post-api`, `nginx.conf.pre`, `nginx.conf.candidate`,
`ROLLBACK.env` (tags, image IDs y hashes anteriores/nuevos), `FIXTURES.env` (rutas de
assets usadas en el smoke) y los dos artefactos `.tar.gz`. Las imágenes anteriores
`chibalete/api:e70c0f1` y `chibalete/front:lupub-9842238` siguen presentes en el host.
No se borró ninguna imagen ni se ejecutó `prune`.

Procedimiento: restaurar `docker-compose.override.yml.pre`, `up -d --no-deps
--force-recreate front`, `nginx -s reload`; restaurar `nginx.conf.pre`, `up -d
--no-deps --force-recreate edge`, `nginx -t`; `up -d --no-deps --force-recreate` de
`api_2` y luego `api_1`, con `nginx -s reload` tras cada réplica. **No fue necesario.**

## 5. Rollout

### 5.1 APIs — override, 2 líneas exactas

Tag antiguo encontrado exactamente 2 veces (líneas 40 y 73); `sed` puntual; diff
funcional de 2 líneas; front intacto en la línea 108; `docker compose config -q`
válido y el merge resuelve `api_1`/`api_2` a la imagen nueva y `front` a la anterior.

Orden verificado previamente: **`api_2` → `api_1`**, cada una con `up -d --no-deps
--force-recreate` del servicio, espera a `healthy` (12 s), verificación de imagen e
ID, hashes LF dentro del contenedor, `/api/health` y `/api/health/ready` 200, `nginx -t`
+ `nginx -s reload` del edge (upstream estático) y 4–6 × `/api/health` vía edge sin
502. La otra réplica permaneció intacta durante cada paso.

Gate antes del edge, en cada réplica y directamente sobre `:3000` (aliases; ids solo en
variables, nunca impresos):

| Caso | api_2 | api_1 | Esperado |
|---|---:|---:|---:|
| authz general, sin sesión | 204 | 204 | 204 |
| authz portada pedagógica, sin sesión | 204 | 204 | 204 |
| authz pedagogía, sin sesión | 401 | 401 | 401 |
| authz pedagogía, lector | 403 | 403 | 403 |
| authz pedagogía, mediador | 204 | 204 | 204 |
| authz pedagogía, administrador | 204 | 204 | 204 |
| authz TTS pedagógico, sin sesión / lector / mediador | 401 / 403 / 204 | 401 / 403 / 204 | idem |
| authz TTS general, sin sesión | 204 | 204 | 204 |
| authz traversal | 404 | — | 404 |

La identidad de los probes se resolvió con la cabecera `x-user-id` aceptada por el
modo `compat`: ningún login, ninguna escritura de identidad ni de sesión.

### 5.2 Edge

Hash activo confirmado `543beec6…` (host y contenedor) justo antes del cambio.
Candidato instalado con `cp -f` (root:root, 644); hash del host `7614df60…`.
`up -d --no-deps --force-recreate edge`: healthy en 8 s, `RestartCount` 0, misma
imagen `582c496c…`. Dentro del contenedor recreado: `nginx -t` OK y
`/etc/nginx/nginx.conf` = `7614df60…` — la trampa del inodo del bind mount de
archivo queda cerrada por el recreate, no por un reload.

### 5.3 Frontend

Tag anterior encontrado exactamente 1 vez (línea 108); diff de 1 línea; las dos
líneas API conservan `ped01d-bef0afe`; compose válido. `up -d --no-deps
--force-recreate front`: healthy en 8 s; bundle dentro del contenedor
`index-3J6bowmj.js` = `d42999bd…`; `nginx -t` + `nginx -s reload` del edge
(obligatorio por el upstream estático); `index.html` servido por el edge referencia
`index-3J6bowmj.js`; el bundle responde 200 (412 389 bytes); 4 × `/` sin 502.

## 6. Matriz de acceso vía edge (público, TLS, `--resolve` al 127.0.0.1)

Fixtures reales del catálogo productivo (rutas en `FIXTURES.env`): PDF de un
artículo pedagógico independiente y su portada, PDF de un libro general, manifest TTS
del artículo pedagógico y manifest TTS de un libro general. Existen 8 materiales
pedagógicos con TTS en disco: **no fue necesario `NO-FIXTURE`**.

| Recurso | Anónimo | Lector | Mediador | Admin |
|---|---:|---:|---:|---:|
| Libro general (PDF) | 200 público | 200 público | 200 | 200 |
| Portada pedagógica (JPEG) | 200 público | 200 público | 200 | 200 |
| PDF pedagógico | **401** | **403** | **200 `private, no-store`** | **200 `private, no-store`** |
| TTS pedagógico (manifest) | **401** | **403** | **200 `private, no-store`** | 200 |
| TTS general (manifest) | 200 público | — | — | — |
| APK LU | 200 público | — | — | — |
| `/internal/uploads-authz` desde internet | 404 | — | — | — |
| `/api/internal/uploads-authz` sin `X-Original-URI` | 404 (0 bytes) | — | — | — |

«Público» = `expires` a 30 días + `Cache-Control: public, max-age=2592000, immutable`,
la misma caché que antes. Los cuerpos de 401 y 403 son la página HTML de error de
nginx (172 y 146 bytes, `text/html`), nunca bytes del asset. El mediador recibe el
PDF íntegro: 148 636 bytes descargados = 148 636 en disco.

## 7. Metadata, Experience, TTS y ficha

| Rol | `/api/content` | generales | embebidos | pedagogía independiente | `contexto_pedagogico` independiente |
|---|---:|---:|---:|---:|---:|
| Lector | **88** | 73 | **15** | **0** | **0** |
| Mediador | **108** | 73 | 15 | 20 | **2** |
| Administrador | **108** | 73 | 15 | 20 | 2 |

MOOK: la Experience publicada referencia **41** ids del catálogo; los 41 resuelven en el
listado del lector; 0 faltantes. La ficha de detalle consume ese listado sin filtro
local (bundle verificado), así que el mediador ve los `contexto_pedagogico` y el lector
no los recibe siquiera.

## 8. Logs, rate limit y salud

- Smoke acotado de 40 assets vía edge (20 portadas anónimas + 20 manifests TTS
  pedagógicos como mediador): **40 × 200, 0 × 429**.
- `httpLogger` (pino) desde el recreate, en ambas APIs: **0** líneas con
  `"url":"/api/internal/uploads-authz"`; `/api/content` sí registrado (3 líneas por
  réplica). La única traza del autorizador es 1 línea legacy `[uploads-authz] URI
  rechazada` por réplica, producida por los probes de traversal y de cabecera ausente.
- `/api/lu/version` 200; APK 200 (2 010 794 bytes).
- Cierre: `api_1`, `api_2`, `edge`, `front` healthy, `RestartCount` 0 en los cuatro.

## 9. Cero mutaciones de datos

`mtime` de los stores al cierre, todos anteriores al inicio de la unidad (12:43 UTC):
`usuarios_colegios_oro.json` 2026-09-06 22:56, `content.json` 2026-08-27,
`groups_db.json` 2026-09-05, `access_db.json` 2026-08-14, `mook_db.json` 2026-09-02.
`find … -newer ROLLBACK.env` sobre `public/uploads`: **0 archivos**. No se generó TTS,
no se editó contenido, no se crearon usuarios, sesiones ni memberships.
Escrituras fuera del stack: solo el directorio de rollback y tres listados temporales
en `/tmp` eliminados al terminar.

## 10. Observaciones (no corregidas, fuera de alcance)

- `/api/internal/uploads-authz` es alcanzable desde internet a través de `location /api/`
  (responde 404 sin `X-Original-URI`, y un veredicto 204/401/403 si se le envía). No
  entrega bytes — es un oráculo de clasificación, no un bypass — y la ruta `internal`
  del edge es la que gobierna la entrega. Queda anotado.
- En modo `compat` la identidad por cabecera `x-user-id` viaja hasta el autorizador
  (el subrequest hereda las cabeceras del cliente). Es la debilidad ya conocida de M1-A
  que ENFORCE cierra; no la introduce esta unidad.
- Deudas intactas: skip roto de `/api/health` en el limiter, autenticación de assets
  generales, cliente Android LU, `CHP-MOOK-RUN-RESUME-WRITE-ON-READ-01`, endpoint
  Express `/uploads`, corte FilBo. `CLAUDE.md` y `deployment_guide.md` siguen
  describiendo el backend como bind mount; el mecanismo real es la imagen.

## 11. Historial

| Fecha | Autor | Evento |
|---|---|---|
| 2026-09-07 | Nicolás Jiménez | DEPLOY-01 detenido en preflight: las APIs no montan `server/`; reformulado por imágenes. |
| 2026-09-07 | Nicolás Jiménez | DEPLOY-02 ejecutado: gate URI 0 fugas, imágenes `ped01d-bef0afe`, rollout `api_2 → api_1`, edge recreado, frontend, validación integral verde. Rollback conservado y no usado. |
