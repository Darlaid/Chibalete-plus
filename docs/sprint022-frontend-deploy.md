# Sprint 022 — Frontend Deploy Runbook

> **Documento canónico** de **deploy frontend image-based** Chibalete+
> (modelo Docker image inmutable).
> Si la realidad del VPS difiere de este runbook, se resuelve a favor de la
> realidad y se actualiza este documento inmediatamente.

> **Hermano operacional:** `docs/sprint022-runbook.md` (deploy backend
> bind-mount). Son **stacks paralelos y distintos** — mecanismo, payload,
> rollback y tooling no se comparten. Ver
> `docs/operational-architecture-summary.md` para el modelo completo.
> No mezclar ambos procedimientos en la misma release window sin razón
> documentada.

---

## 0. Propósito de este runbook

Sprint 022 cerró el **backend** como verde condicionado (D8): pipeline de
deploy backend funciona, lock+watchdog+rollback verificados, api_1/api_2
healthy. Pero el bundle de `chibalete_front` quedó **previo** al sprint:
el botón "Accesible" en producción todavía resuelve a `/leer/texto/...`
porque la imagen Docker no se reconstruyó.

Este runbook entrega el bundle Sprint 022 al VPS, activando:

- Renombrado UI del visor de texto: **"Modo Guiado"** (antes "Modo Accesible")
- Nuevo **Modo Accesible** real (`/leer/accesible/:id`, `VisorAccesible`)
- Botón "Accesible" en detalle de libro apuntando al nuevo visor
- Cleanup documental de `utils/readerMode.ts` y `CLAUDE.md`

### 0.1 Filosofía operacional

| Principio | Implementación |
|---|---|
| Build determinístico | `npm run build` local + `docker build --pull` con base image pin'd |
| Sin toolchain en producción | Imagen construida 100% en máquina del operador |
| Transferencia auditable | `docker save \| gzip` + sha256 pre/post + `docker load` |
| Swap explícito | Edición del `image:` de `front` en `docker-compose.override.yml` del VPS — el archivo que declara la imagen efectiva (§4) |
| Aislamiento estricto | `docker compose up -d --no-deps front` — no toca api_1/api_2/edge |
| Rollback trivial | Tag previo documentado, swap inverso del `image:` |
| Sin builds en VPS | Si falla algo, falla local antes de tocar producción |

### 0.2 Architecture invariant

Chibalete+ tiene **dos stacks operacionales distintos y coherentes**.
Este runbook pertenece sólo al segundo. Mezclar procedimientos rompe el
modelo mental y abre superficie de error humano.

| Aspecto | Backend deploy | Frontend deploy (este runbook) |
|---|---|---|
| Payload | bind-mount runtime | imagen Docker inmutable |
| Mecanismo | swap atómico de `/var/www/chibalete/server` y `/var/www/chibalete/utils` | build fuera del VPS + transferencia con checksum + `docker load` + promoción del tag `image:` en `docker-compose.override.yml` |
| Build | sin rebuild de imagen api (salvo `package.json`) | rebuild de imagen front cada release |
| Tooling | `scripts/deploy-backend.sh`, `scripts/backup-vps.sh` | `docker save / load` + edición manual de compose |
| Granularidad | restart staggered `api_1 → validar → api_2` | recreate único de `chibalete_front` |
| Rollback | `mv server.old-<TS> server` + restart | `image:` ← tag previo + recreate |
| Runbook canónico | `docs/sprint022-runbook.md` | `docs/sprint022-frontend-deploy.md` (este) |

**Regla:** nunca ejecutar deploy backend y frontend en la **misma release
window** sin razón documentada por escrito (issue, post-mortem previo, o
nota explícita del operador). Si ambos cambios son necesarios, ejecutar
en ventanas separadas con un smoke verde de la primera antes de iniciar
la segunda. Razón: los modos de falla son ortogonales y el diagnóstico
se contamina si se mezclan.

> Excepción admitida: hotfix de seguridad que requiera ambos lados
> simultáneamente. En ese caso, abrir issue antes, documentar la razón y
> usar el mismo `~/deploys-frontend.log` + `~/deploys-backend.log` con
> referencia cruzada del issue.

### 0.3 Blast radius

Lo que este deploy **debe tocar** (única y explícitamente):

- ✅ Imagen Docker `chibalete/front:<tag>` (load nuevo en VPS)
- ✅ Línea `image:` del service `front` en `/opt/chibaleteplus/docker-compose.override.yml` (el archivo que gobierna la imagen efectiva; el compose base **no se toca**)
- ✅ Container `chibalete_front` (recreate)
- ✅ Edge nginx: validación (`nginx -t`) + reload (`nginx -s reload`) — sin tocar config

Lo que este deploy **NO debe tocar** bajo ninguna circunstancia:

- ❌ Recrear `chibalete_api_1` o `chibalete_api_2` (`--no-deps front` lo previene estructuralmente)
- ❌ Recrear `chibalete_edge` (sólo reload, nunca recreate)
- ❌ Bind mounts backend: `/var/www/chibalete/server`, `/var/www/chibalete/utils`, `/var/www/chibalete/data`, `/var/www/chibalete/data-critical`, `/var/www/chibalete/public/uploads`
- ❌ SQLite o cualquier base de datos JSON flat-file
- ❌ Config del edge: `/opt/chibaleteplus/nginx.conf` (o equivalente montado en `chibalete_edge`)
- ❌ `scripts/deploy-backend.sh`, `scripts/backup-vps.sh`, `/root/scripts/*` en VPS
- ❌ `.deploy-info`, `deploys.log` (esos son artefactos del stack backend)
- ❌ Cualquier service distinto de `front`, en cualquiera de los dos archivos compose
- ❌ Variables de entorno del API (`GEMINI_API_KEY`, `OPENAI_API_KEY`, `ADMIN_SECRET`, `USERS_DB`, etc.)

**Verificación post-deploy del blast radius:** §6.3 (restart counts de
api/edge sin cambio) es el contrato observable que confirma que la
restricción se respetó.

> Si durante el deploy se descubre que **algo de la lista NO debe tocar**
> necesita modificarse: **abortar el deploy frontend**, abrir issue, y
> tratarlo como cambio de infraestructura separado.

---

## 1. Pre-flight checklist

Antes de tocar nada, los siguientes ítems deben estar TODOS verdes:

### 1.1 Local (máquina del operador)

| # | Item | Verificación |
|---|---|---|
| L1 | Working tree limpio | `git status --porcelain` vacío |
| L2 | En la rama correcta | `git branch --show-current` (esperado: `sprint-022/operational-stack` o sucesora) |
| L3 | `npm run build` pasa limpio | `npm run build` (debe terminar exit 0, generar `dist/`) |
| L4 | `dist/` contiene la ruta nueva | `grep -r "leer/accesible" dist/ \| head` (esperado: ≥1 match en bundle) |
| L5 | Docker daemon corriendo | `docker version` |
| L6 | Espacio en disco local | ≥2 GB libres para `docker save` (imagen ~200-400 MB comprimida) |
| L7 | ssh sin password al VPS | `ssh -o BatchMode=yes root@72.60.158.97 "echo OK"` |
| L8 | `Dockerfile.front` sin cambios no commiteados | `git status Dockerfile.front` (vacío) |

### 1.2 VPS (producción)

| # | Item | Verificación |
|---|---|---|
| V1 | 4 containers UP | `ssh root@72.60.158.97 "docker ps --format '{{.Names}} {{.Status}}'"` (esperado: `chibalete_edge`, `chibalete_front`, `chibalete_api_1`, `chibalete_api_2`, todos `Up`) |
| V2 | api_1 + api_2 sin restart loop | `ssh root@72.60.158.97 "docker ps --format '{{.Names}} {{.RestartCount}}' \| grep api"` (esperado: ambos `0` o estable) |
| V3 | Disco VPS libre | `ssh root@72.60.158.97 "df -BG /var/lib/docker"` (≥3 GB libres) |
| V4 | Ambos compose existen y son readable | `ssh root@VPS "test -r /opt/chibaleteplus/docker-compose.yml && test -r /opt/chibaleteplus/docker-compose.override.yml && echo OK"` |
| V4b | La imagen efectiva de `front` se resuelve y se sabe dónde está declarada | `ssh root@VPS "cd /opt/chibaleteplus && docker compose config --images"` + `grep -n image:` en ambos archivos (ver §4.0) |
| V5 | Tag actual de `chibalete_front` documentado | ver §1.3 abajo — **BLOQUEANTE para rollback** |
| V6 | Health endpoint OK | `curl -sf https://chibaleteplus.chibaleteeditores.com/api/health \| head` |
| V7 | Sin deploy lock backend activo | `ssh root@72.60.158.97 "test -d /var/run/chib-deploy.lock && echo LOCK \|\| echo OK"` |

### 1.3 Documentar tag previo (rollback target)

**BLOQUEANTE.** No proceder sin esto.

```bash
ssh root@72.60.158.97 '
  echo "=== docker-compose service front ==="
  echo "--- imagen efectiva (merge base + override) ---"
  cd /opt/chibaleteplus && docker compose config --images
  echo "--- declaracion en el override (destino del swap) ---"
  grep -A 5 "^  front:" /opt/chibaleteplus/docker-compose.override.yml | grep image:
  echo "--- declaracion en la base (informativa; puede estar obsoleta) ---"
  grep -A 5 "^  front:" /opt/chibaleteplus/docker-compose.yml | grep image:
  echo
  echo "=== imagen corriendo en chibalete_front ==="
  docker inspect --format "{{.Config.Image}}" chibalete_front
  echo
  echo "=== imágenes locales chibalete/front ==="
  docker images chibalete/front --format "{{.Repository}}:{{.Tag}} {{.ID}} {{.CreatedSince}}"
'
```

Anotar el resultado en `~/deploys-frontend.log` local con timestamp:

```bash
{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) PRE-DEPLOY SPRINT-022 ==="
  ssh root@72.60.158.97 'docker inspect --format "{{.Config.Image}}" chibalete_front'
  echo "operador: $(whoami)"
} >> ~/deploys-frontend.log
```

> Si V5 no se documenta, abortar. Sin tag previo no hay rollback determinista.

---

## 2. Build determinístico local

### 2.1 Convención de tag

```
chibalete/front:sprint-022-<git-sha-corto>
```

Ejemplo: `chibalete/front:sprint-022-e73b9cf`

```bash
GIT_SHA=$(git rev-parse --short HEAD)
TAG="chibalete/front:sprint-022-${GIT_SHA}"
echo "TAG=$TAG"
```

### 2.2 Build

```bash
# Forzar pull de base images para reproducibilidad razonable
docker build \
  --pull \
  -f Dockerfile.front \
  -t "$TAG" \
  .
```

> Nota sobre determinismo estricto: las base images `node:20-alpine` y
> `nginx:1.27-alpine` se mueven dentro del tag minor. Si se requiere
> reproducibilidad bit-a-bit, pinear por digest SHA256 en `Dockerfile.front`
> (mejora futura — fuera del scope de este deploy).

### 2.3 Verificación post-build

```bash
# 1) Tamaño razonable (~50-150 MB layered, varía con base image)
docker images "$TAG"

# 2) Bundle dentro de la imagen contiene la ruta nueva
docker run --rm --entrypoint sh "$TAG" -c \
  'grep -r "leer/accesible" /usr/share/nginx/html/ | head -3'
# Esperado: ≥1 match

# 3) Smoke local del container (opcional pero recomendado)
docker run --rm -d -p 8089:80 --name front-smoke "$TAG"
curl -sf http://localhost:8089/ | grep -E "<title>|<script" | head
docker stop front-smoke
```

> Si el grep en (2) sale vacío: **abortar**. La build no incluyó el código
> nuevo. Probable causa: rama incorrecta, dist stale, o `Dockerfile.front`
> no copia `pages/` (verificar líneas 19-25 del Dockerfile).

---

## 3. Transfer al VPS

### 3.1 Save + checksum local

```bash
ARTIFACT="/tmp/chibalete-front-${GIT_SHA}.tar.gz"
docker save "$TAG" | gzip > "$ARTIFACT"

# Tamaño esperado: ~80-200 MB
ls -lh "$ARTIFACT"

# SHA256 local
sha256sum "$ARTIFACT" | tee "${ARTIFACT}.sha256"
```

### 3.2 Transfer

```bash
scp "$ARTIFACT" "${ARTIFACT}.sha256" root@72.60.158.97:/tmp/
```

### 3.3 Verificación post-transfer

```bash
# Comparar SHA local vs remoto
LOCAL_SHA=$(awk '{print $1}' "${ARTIFACT}.sha256")
REMOTE_SHA=$(ssh root@72.60.158.97 "sha256sum /tmp/$(basename $ARTIFACT) | awk '{print \$1}'")

[ "$LOCAL_SHA" = "$REMOTE_SHA" ] && echo "✓ checksum OK" || { echo "✗ MISMATCH"; exit 1; }
```

### 3.4 Load en VPS

```bash
ssh root@72.60.158.97 "
  gunzip -c /tmp/$(basename $ARTIFACT) | docker load
  docker images chibalete/front --format '{{.Repository}}:{{.Tag}} {{.ID}}' | head
"
# Esperado: ver la nueva tag listada
```

---

## 4. Swap explícito del tag de imagen

> 🔴 **Archivo destino: `docker-compose.override.yml`, no el compose base.**
>
> `docker compose`, ejecutado desde `/opt/chibaleteplus`, carga **base y override
> juntos** y mergea el segundo sobre el primero. En la topología vigente, la
> imagen efectiva de `front` (y la de `api_1` / `api_2`) está declarada en el
> **override**. El compose base puede contener un tag antiguo y obsoleto sin que
> eso afecte a lo que corre.
>
> ```text
> Editar docker-compose.yml mientras docker-compose.override.yml fija otra
> imagen no despliega el frontend nuevo. El comando puede terminar sin error
> y recrear el servicio con la imagen anterior.
> ```
>
> Ese es el **deploy fantasma**: `sed` no encuentra `OLD_TAG` en la base y no
> cambia nada —sin error—, el override sigue fijando la imagen vieja, el
> `up -d --no-deps front` recrea el container con ella y devuelve éxito, el
> health check pasa y `curl /` responde 200. Todo verde, cero código nuevo.
>
> Si una auditoría futura demuestra otra topología Compose (override retirado,
> archivos extra vía `-f`, `COMPOSE_FILE` en el entorno), **detenerse y
> actualizar este runbook**. No asumir en silencio otro archivo.

Convención de variables usada abajo: `OLD_TAG` (imagen efectiva actual),
`NEW_TAG` (imagen a desplegar), `SLUG` (identificador de la unidad de trabajo),
`TS` (sello temporal UTC). **No se codifican tags históricos en el
procedimiento.**

### 4.0 Localizar el archivo que declara la imagen efectiva  (BLOQUEANTE)

```bash
ssh root@VPS 'bash -s' <<'REMOTE'
  cd /opt/chibaleteplus
  echo "=== imagen efectiva resuelta (base + override mergeados) ==="
  docker compose config --images
  echo "=== donde esta declarada ==="
  grep -n "image:" docker-compose.override.yml
  grep -n "image:" docker-compose.yml
REMOTE
```

`docker compose config --images` es la **autoridad**: ningún archivo suelto lo
es. Anotar de ahí el `OLD_TAG` de `front` e identificar en cuál de los dos
archivos aparece. Hoy: el override.

Comprobación de unicidad, obligatoria antes de escribir:

```bash
ssh root@VPS   "grep -c 'image: $OLD_TAG' /opt/chibaleteplus/docker-compose.override.yml"
```

```text
== 1   → continuar
!= 1   → STOP — COMPOSE TARGET AMBIGUOUS
```

Cero coincidencias significa que la imagen se declara en otro sitio; más de una,
que el `sed` tocaría servicios que no son `front`. En ambos casos **no se
edita nada**: se vuelve a 4.0 y se determina el destino real.

### 4.1 Backup del override

```bash
ssh root@VPS 'bash -s' <<'REMOTE'
  TS=$(date -u +%Y%m%dT%H%M%SZ)
  SLUG=<SLUG>
  cd /opt/chibaleteplus
  cp docker-compose.override.yml "docker-compose.override.yml.bak-pre-${SLUG}-${TS}"
  ls -la "docker-compose.override.yml.bak-pre-${SLUG}-${TS}"
REMOTE
```

> **Comillas simples en el heredoc.** Con comillas dobles, `$TS` y `$SLUG` se
> expanden en el shell **local** —donde no existen— y el nombre del backup queda
> truncado. Ocurrió el 2026-09-03 al escribir en `deploys.log` y hubo que
> corregirlo con una segunda entrada. Toda variable destinada al host remoto se
> expande en el host remoto.

Verificar que el backup contiene el tag actual antes de seguir:

```bash
ssh root@VPS   "grep -n 'image: $OLD_TAG' /opt/chibaleteplus/docker-compose.override.yml.bak-pre-*"
```

### 4.2 Editar el `image:` del service `front` en el override

```bash
ssh root@VPS   "sed -i 's|image: $OLD_TAG|image: $NEW_TAG|'      /opt/chibaleteplus/docker-compose.override.yml"
```

> **Reglas duras durante la edición:**
> - Se edita **`docker-compose.override.yml`**. El compose base **no se toca**.
> - No tocar otros services (api_1, api_2, edge)
> - No tocar volumes ni networks
> - No tocar restart policies
> - Sólo la línea `image:` del service `front`

### 4.3 Verificar diff contra el backup

```bash
ssh root@VPS 'bash -s' <<'REMOTE'
  cd /opt/chibaleteplus
  BAK=$(ls -t docker-compose.override.yml.bak-pre-* | head -1)
  echo "backup: $BAK"
  diff "$BAK" docker-compose.override.yml || true
REMOTE
```

Esperado: **exactamente una línea funcional modificada**, la del `image:` de
`front`.

> Si el diff muestra más líneas → **restaurar el backup y re-editar**.

### 4.4 Validar sintaxis y verificar el merge  (BLOQUEANTE)

```bash
ssh root@VPS 'bash -s' <<'REMOTE'
  cd /opt/chibaleteplus
  docker compose config --quiet && echo 'compose valido' || echo 'ABORTAR'
  echo "=== imagenes efectivas tras el swap ==="
  docker compose config --images
REMOTE
```

Esperado, y se comprueba línea por línea:

```text
front         = NEW_TAG           ← debe haber cambiado
api_1, api_2  = imagen anterior   ← sin cambio
edge          = imagen anterior   ← sin cambio
```

> Si `front` sigue mostrando `OLD_TAG`, se editó el archivo equivocado: **es el
> deploy fantasma en curso**. Restaurar el backup y volver a 4.0. No continuar.

Esta verificación, junto con el hash del bundle en §6.1, es la única defensa
contra un deploy que parece verde y no desplegó nada. Ninguna de las dos es
opcional.

### 4.5 Recreate sólo el service `front`

```bash
ssh root@VPS "
  cd /opt/chibaleteplus
  docker compose up -d --no-deps front
"
```

> `--no-deps` garantiza que api_1 / api_2 / edge no se tocan.
> Compose recreará sólo `chibalete_front` con la imagen nueva.

### 4.6 Verificar que arrancó

```bash
ssh root@72.60.158.97 "
  docker ps --format '{{.Names}} {{.Status}} {{.Image}}' | grep -E 'chibalete_(front|edge|api)'
  echo '--- logs front (últimas 30) ---'
  docker logs chibalete_front --tail 30
"
```

Esperado:
- `chibalete_front` con `Up`, imagen = nuevo tag
- `chibalete_edge` intacto (no recreated)
- `chibalete_api_1` / `chibalete_api_2` intactos (no recreated)
- Logs del front: nginx arrancó sin errores

---

## 5. Edge nginx reload + cache invalidation

> El edge **no se recrea y su configuración no se edita**. Sólo se valida con
> `nginx -t` y se recarga con `nginx -s reload`.
>
> 🔴 **El reload NO es una precaución: es obligatorio.** El edge declara el
> frontend como un upstream **estático**:
>
> ```nginx
> upstream chibalete_front_upstream {
>   server chibalete_front:80;
>   keepalive 32;
> }
> ```
>
> nginx resuelve ese nombre **una sola vez, al cargar la configuración**.
> Recrear `chibalete_front` le asigna una IP nueva en la red interna, de modo
> que sin el reload el edge sigue apuntando a una dirección muerta y responde
> **502**. El bloque `resolver` presente en la config no rescata upstreams
> estáticos.

### 5.1 Validación + reload del edge

```bash
ssh root@72.60.158.97 "
  docker exec chibalete_edge nginx -t
"
# Esperado: 'syntax is ok' + 'test is successful'

ssh root@72.60.158.97 "
  docker exec chibalete_edge nginx -s reload
"
# Sin output = OK
```

> Si `nginx -t` falla → **NO reload**. Investigar antes de proceder. La
> falla aquí es independiente del deploy frontend (config del edge no se
> tocó), pero abortar reload por seguridad.
>
> `nginx -t` puede emitir `[warn]` preexistentes (p. ej. `ssl_stapling ignored`
> por un certificado sin OCSP responder). Lo que decide es la última línea:
> `test is successful`. Un warn conocido no aborta el reload.

### 5.2 Cache layers en juego

Hay **3 capas de cache** que pueden hacer parecer que el deploy falló
cuando técnicamente funcionó. Hay que entenderlas antes de interpretar
el smoke:

| Capa | Comportamiento actual | Riesgo |
|---|---|---|
| **Bundle hashed assets** (`/assets/index-<hash>.js`) | Vite genera hash en el nombre. nginx aplica `Cache-Control: public, max-age=31536000, immutable` (ver `nginx.prod.conf:31`). | Bajo: filenames cambian con cada build, no colisionan |
| **`index.html`** | Sin `Cache-Control` explícito en nginx → toma defaults (sin `max-age`, depende de validators del cliente). | **Medio-alto**: el navegador puede servir un `index.html` viejo desde memory cache / disk cache, lo que carga referencias a hashes de assets viejos |
| **Browser cache (cliente)** | Acumula HTML, JS, CSS en disk/memory cache | **Alto**: principal causa del síntoma "frontend viejo después del deploy" |
| **Service Worker** | **No existe en el repo actual** (verificado `grep -r serviceWorker` = 0 matches, sin `public/sw*.js`). | N/A hoy. Si en el futuro se agrega, este runbook debe extenderse. |
| **nginx upstream cache** | El edge no cachea respuestas del front (no hay `proxy_cache` configurado en el edge). El reload de §5.1 es por keep-alive y resolver hints. | Bajo |

### 5.3 Cache invalidation verification

> **Regla operacional crítica:** **NO asumir fallo de deploy sin haber
> descartado cache primero.** El 90% de los falsos positivos de "el
> deploy no funcionó" son cache del navegador del operador.

#### 5.3.1 Verificar que el HTML servido es el nuevo

```bash
# 1) Hash del bundle referenciado en index.html servido por nginx
curl -s -H "Cache-Control: no-cache" -H "Pragma: no-cache" \
  https://chibaleteplus.chibaleteeditores.com/ \
  | grep -oE 'index-[a-zA-Z0-9_-]+\.js' | head -1

# Esperado: hash distinto al pre-deploy (anotar el pre-deploy en §1.3 idealmente)
```

#### 5.3.2 Verificar que el bundle nuevo es accesible

```bash
NEW_BUNDLE=$(curl -s https://chibaleteplus.chibaleteeditores.com/ \
  | grep -oE '/assets/index-[a-zA-Z0-9_-]+\.js' | head -1)

curl -sf -o /dev/null -w "%{http_code} %{size_download}\n" \
  "https://chibaleteplus.chibaleteeditores.com${NEW_BUNDLE}"
# Esperado: 200 + tamaño razonable (no 0)
```

#### 5.3.3 Verificar contenido del bundle (la ruta nueva existe)

```bash
curl -s "https://chibaleteplus.chibaleteeditores.com${NEW_BUNDLE}" \
  | grep -oE 'leer/accesible' | head -3
# Esperado: ≥1 match
```

> Si §5.3.1, §5.3.2 o §5.3.3 fallan: el deploy realmente no llegó al
> cliente. Investigar:
> - ¿Está `chibalete_front` corriendo la imagen nueva? (`docker inspect --format '{{.Config.Image}}' chibalete_front`, o `safeOperationalEvidence.mjs image-summary` si hay que archivar la evidencia)
> - ¿El edge tiene cache stale? (descartado por mapa en §5.2, pero verificable con `docker exec chibalete_edge ls /var/cache/nginx 2>/dev/null`)
>
> Si pasan: **el deploy fue OK** y cualquier "frontend viejo" que el
> operador vea es cache local del navegador. Aplicar §5.3.4.

#### 5.3.4 Cache busting del cliente (operador y testers)

Para validar manualmente vía browser sin contaminación de cache:

| Método | Cuándo usar |
|---|---|
| **Hard refresh** (`Ctrl+Shift+R` / `Cmd+Shift+R`) | Primer intento — invalida memory + disk cache de la URL actual |
| **Modo incógnito / private window** | Smoke "limpio" — sin cache, sin localStorage, sin sesión persistente. **Recomendado para §6.2 S1-S10.** |
| **DevTools → Network → Disable cache** (con DevTools abiertas) | Testing iterativo durante validación |
| **DevTools → Application → Storage → Clear site data** | Si hay storage corrupto o si en el futuro se agrega service worker |

**Si el operador reporta "todavía veo el frontend viejo":**

1. Ejecutar §5.3.1 desde terminal — si el hash es nuevo, **el deploy es correcto**, problema es cache del cliente.
2. Pedir al operador hard refresh + retry.
3. Si persiste, pedir validación en incognito.
4. Sólo si §5.3.1 falla, considerar problema real de deploy.

#### 5.3.5 Comunicación a usuarios finales

Los usuarios finales con `index.html` cacheado verán el frontend viejo
hasta que su navegador revalide. Esto **no es un fallo del deploy** —
es comportamiento esperado del cache HTTP. Vías de mitigación:

- Aceptarlo como ventana de transición (los hashes hacen que la
  inconsistencia sea benigna: el HTML viejo carga assets viejos coherentes)
- Si urge forzar invalidación masiva: agregar `Cache-Control: no-cache`
  a `index.html` en `nginx.prod.conf` (cambio fuera de scope de este
  runbook — abrir issue)

---

## 6. Smoke validation (post-deploy)

### 6.1 HTTP básico

```bash
# Front responde
curl -sf -o /dev/null -w "%{http_code}\n" https://chibaleteplus.chibaleteeditores.com/
# Esperado: 200

# Bundle hash cambió (vs pre-deploy)
curl -s https://chibaleteplus.chibaleteeditores.com/ | grep -oE 'index-[a-zA-Z0-9_-]+\.js' | head -1
# Anotar el hash. Debe ser distinto al pre-deploy.
```

### 6.2 Validación funcional manual (browser, sesión limpia)

> Hacer hard-refresh (Ctrl+Shift+R) o probar en ventana incognito para
> evitar bundle cacheado en cliente.

| # | Acción | Resultado esperado |
|---|---|---|
| S1 | Login con cuenta lector existente | OK |
| S2 | Biblioteca carga | OK |
| S3 | Abrir detalle de un libro | OK |
| S4 | Click botón "Accesible" | URL navega a `/leer/accesible/<contentId>` (NO a `/leer/texto/...`) |
| S5 | `VisorAccesible` carga (no 404) | Render del nuevo visor |
| S6 | Volver al detalle, click "Texto/Guiado" | URL `/leer/texto/<id>`; visor con label "**Modo Guiado**" (no "Modo Accesible") |
| S7 | Click "PDF" desde detalle | `/leer/pdf/<id>` carga sin regresión |
| S8 | Click "Inmersivo" desde detalle | `/leer/inmersivo/<id>` carga sin regresión |
| S9 | Abrir un libro de tipo álbum | `/ver/album/<id>` carga sin regresión |
| S10 | DevTools console abierta durante S4-S9 | Sin errores rojos nuevos |

### 6.3 Backend impact check

```bash
ssh root@72.60.158.97 "
  echo '--- restart counts ---'
  docker ps --format '{{.Names}} restarts={{.RestartCount}}' | grep chibalete
  echo '--- api_1 last 10 logs ---'
  docker logs chibalete_api_1 --tail 10
  echo '--- api_2 last 10 logs ---'
  docker logs chibalete_api_2 --tail 10
"
```

Esperado:
- Restart count de api_1, api_2, edge **sin cambios** vs pre-deploy
- Logs de api sin nuevos errores
- Sólo `chibalete_front` cuenta como "cambiado"

### 6.4 Health post-deploy

```bash
curl -sf https://chibaleteplus.chibaleteeditores.com/api/health | head
# Esperado: idéntico al pre-deploy (el frontend no toca backend)
```

---

## 7. Plan de rollback

> Disparadores: cualquier S1-S10 falla, console errors generalizados,
> regresión funcional en modos previos (PDF / Texto / Inmersivo / Álbum).

### 7.1 Rollback rápido (≤2 min)

```bash
# 1) Restaurar el OVERRIDE desde el backup de §4.1 (no el compose base)
ssh root@VPS 'bash -s' <<'REMOTE'
  cd /opt/chibaleteplus
  BAK=$(ls -t docker-compose.override.yml.bak-pre-* | head -1)
  echo "restaurando desde: $BAK"
  cp docker-compose.override.yml docker-compose.override.yml.failed-$(date -u +%Y%m%dT%H%M%SZ)
  cp "$BAK" docker-compose.override.yml
REMOTE

# 2) Validar sintaxis Y verificar el merge (BLOQUEANTE)
ssh root@VPS 'bash -s' <<'REMOTE'
  cd /opt/chibaleteplus
  docker compose config --quiet && echo OK
  docker compose config --images
  # front = OLD_TAG (debe haber vuelto); api_1/api_2/edge sin cambio
REMOTE

# 3) Recreate UNICAMENTE front con el tag previo
ssh root@VPS "cd /opt/chibaleteplus && docker compose up -d --no-deps front"

# 4) Reload edge (mismo procedimiento §5)
docker exec chibalete_edge nginx -t
docker exec chibalete_edge nginx -s reload
```

### 7.2 Rollback verification criteria

> El rollback no se considera completo hasta que **todos** los criterios
> abajo pasen. Mismo principio de cache que en §5.3: el rollback puede
> verse contaminado por cache del navegador del operador. Aplicar §5.3.4
> antes de declarar rollback fallido.

#### 7.2.1 Estado de infraestructura

| # | Verificación | Comando |
|---|---|---|
| R1 | `chibalete_front` healthy (status `Up`, no restart loop) | `ssh root@72.60.158.97 "docker ps --format '{{.Names}} {{.Status}} restarts={{.RestartCount}}' \| grep front"` |
| R2 | `chibalete_front` corre la imagen del **tag previo** (no el descartado) | `ssh root@72.60.158.97 "docker inspect --format '{{.Config.Image}}' chibalete_front"` — debe coincidir con el valor anotado en §1.3 |
| R3 | `chibalete_edge` con restart count **sin cambio** vs pre-rollback | `ssh root@72.60.158.97 "docker ps --format '{{.Names}} restarts={{.RestartCount}}' \| grep edge"` |
| R4 | `chibalete_api_1` y `chibalete_api_2` intactos (no restart) | `ssh root@72.60.158.97 "docker ps --format '{{.Names}} restarts={{.RestartCount}}' \| grep api"` |
| R5 | `nginx -t` del edge sigue válido | `ssh root@72.60.158.97 "docker exec chibalete_edge nginx -t"` |
| R6 | Config del edge **sin cambios** (no se debió tocar en deploy ni rollback) | `ssh root@72.60.158.97 "docker exec chibalete_edge sha256sum /etc/nginx/conf.d/default.conf"` — comparar con valor pre-deploy si se anotó, o como sanity check de que no fue modificado |
| R7 | `docker-compose.override.yml` revertido a estado pre-deploy | `ssh root@VPS "diff /opt/chibaleteplus/docker-compose.override.yml /opt/chibaleteplus/docker-compose.override.yml.bak-pre-<SLUG>-<TS>"` — debe ser vacío |
| R7b | La imagen efectiva volvió al tag previo | `ssh root@VPS "cd /opt/chibaleteplus && docker compose config --images"` → `front` = `OLD_TAG`; api_1/api_2/edge sin cambio |

#### 7.2.2 Estado HTTP / bundle

| # | Verificación | Comando |
|---|---|---|
| R8 | HTML root devuelve 200 | `curl -sf -o /dev/null -w "%{http_code}\n" https://chibaleteplus.chibaleteeditores.com/` |
| R9 | Hash del bundle servido = hash **previo** al deploy | `curl -s -H "Cache-Control: no-cache" https://chibaleteplus.chibaleteeditores.com/ \| grep -oE 'index-[a-zA-Z0-9_-]+\.js' \| head -1` — debe coincidir con el hash pre-deploy |
| R10 | Assets referenciados por el HTML cargan (no 404) | `curl -sf -o /dev/null -w "%{http_code}\n" https://chibaleteplus.chibaleteeditores.com/assets/<hash>.js` para los principales — todos 200 |
| R11 | Health endpoint backend OK (no debería haberse afectado) | `curl -sf https://chibaleteplus.chibaleteeditores.com/api/health \| head` |

#### 7.2.3 Estado funcional (browser, **incógnito**)

| # | Verificación |
|---|---|
| R12 | Login funciona |
| R13 | Biblioteca carga |
| R14 | Botón "Accesible" en detalle navega a **`/leer/texto/<id>`** (comportamiento pre-deploy restaurado) |
| R15 | Modos previos funcionan: PDF / Texto / Inmersivo / Álbum |
| R16 | Sin errores nuevos en DevTools console |

> **Importante:** R12-R16 deben validarse en **modo incógnito** o tras
> hard refresh. Si el operador ve el comportamiento del bundle nuevo
> (post-deploy descartado) en una ventana normal, es cache local — NO
> es un rollback fallido. Confirmar con R9 antes de actuar.

#### 7.2.4 Smoke negativo (lo que NO debe pasar)

| # | Verificación |
|---|---|
| R17 | `/leer/accesible/<id>` devuelve 404 o redirige (la ruta del bundle nuevo ya no debe existir tras rollback) — **OPCIONAL**: dado que SPA hace fallback a `index.html`, en realidad cargará el bundle viejo y mostrará "página no encontrada" lógica del cliente o redirect. Ese comportamiento es aceptable; lo crítico es que **NO cargue `VisorAccesible`**. |
| R18 | No hay menciones de `VisorAccesible` en el bundle servido | `curl -s "<URL del bundle>" \| grep -c VisorAccesible` debe ser 0 |

### 7.3 Anotar rollback

```bash
{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) ROLLBACK SPRINT-022 ==="
  echo "razón: <descripción breve>"
  echo "tag descartado: $TAG"
  ssh root@72.60.158.97 'docker inspect --format "{{.Config.Image}}" chibalete_front'
} >> ~/deploys-frontend.log
```

---

## 8. Cleanup documental (post-deploy verde)

> Aplicar **sólo después** de que §6.2 (S1-S10) pase 100%. Commit aparte
> del deploy. Razón: si hay rollback, este cleanup queda inválido.

### 8.1 `utils/readerMode.ts`

Cambios requeridos para alinear con runtime real:

**Encabezado JSDoc (líneas 1-28):** mover `'a11y'` de la sección
"RESERVADO (futuro — no implementado)" a la sección "PRESENTE (UI activa hoy)":

```ts
// PRESENTE (UI activa hoy):
//   'pdf'        → "Modo Visual (PDF)"     /leer/pdf/:id        VisorPDF
//   'text'       → "Modo Guiado"            /leer/texto/:id      VisorTexto
//   'immersive'  → "Modo Inmersivo"         /leer/inmersivo/:id  VisorInmersivo
//   'album'      → "Modo Álbum"             /ver/album/:id       VisorAlbum
//   'a11y'       → "Modo Accesible"         /leer/accesible/:id  VisorAccesible
//
// LEGACY (compatibilidad con datos vivos — NO reutilizar):
//   'accessible' → corresponde al actual "Modo Guiado" (= 'text').
//                  ...
```

**`ACTIVE_READER_MODES` (líneas 55-60):** incluir `'a11y'`:

```ts
export const ACTIVE_READER_MODES: readonly ReaderMode[] = [
    'pdf',
    'text',
    'immersive',
    'album',
    'a11y',
] as const;
```

**`getReaderModeRoute` (líneas 91-101):** devolver ruta real para `'a11y'`:

```ts
case 'a11y':       return `/leer/accesible/${id}`;
```

**`isReaderModeImplemented` (líneas 104-106):** ya puede devolver `true`
sin excepciones:

```ts
export function isReaderModeImplemented(mode: ReaderMode): boolean {
    return true;
}
```

> Considerar si esa función sigue teniendo sentido (todos los modos
> implementados → función trivial). Si se elimina, grep de usos antes.

**`RESERVED_A11Y_ROUTE` (línea 67):** la constante puede eliminarse (la
ruta ya no es "reservada"). Grep de usos antes de borrar.

**`BACKEND_READER_MODES` (líneas 43-48):** decisión separada — sólo
agregar `'a11y'` si el backend ya lo valida en `canonicalProgress.lastInteractedMode`.
Si no, dejar como está y abrir ticket para ampliar el endpoint. **Verificar
antes de modificar:**

```bash
grep -n "canonicalProgress\|lastInteractedMode\|a11y\|accessible" server/server.js | head -30
```

### 8.2 `CLAUDE.md`

**Tabla de reader modes:** actualizar fila `a11y`:

| antes | después |
|---|---|
| Estado: `**RESERVADO** — para el nuevo Modo Accesible que se construirá desde cero` | Estado: `activo` |
| Visor: `(sin implementar)` | Visor: `VisorAccesible` |

**Reglas debajo de la tabla:** eliminar la regla:

> No registrar la ruta `/leer/accesible/:id` ni emitir `'a11y'` al backend hasta que el visor exista y `BACKEND_READER_MODES` se amplíe.

Reemplazar por (si el backend aún no acepta `'a11y'`):

> La ruta `/leer/accesible/:id` ya está activa. Emitir `'a11y'` al backend
> sólo cuando `BACKEND_READER_MODES` se amplíe; mientras tanto, persistir
> `'text'` como `lastInteractedMode` para sesiones de Modo Accesible.

### 8.3 Commit del cleanup

```bash
git add utils/readerMode.ts CLAUDE.md
git commit -m "docs(reader-modes): align readerMode.ts and CLAUDE.md with active 'a11y' runtime

VisorAccesible y la ruta /leer/accesible/:id están activas en producción
desde el deploy frontend Sprint 022. La documentación que las marcaba como
RESERVADO/sin implementar ya no refleja el estado real."
```

---

## 9. Failure injection matrix

Modos de falla documentados (no exhaustivos):

| Falla | Detección | Mitigación |
|---|---|---|
| `npm run build` falla local | exit ≠ 0 en §1.1 L3 | abortar, no se transfiere nada al VPS |
| `dist/` no contiene `/leer/accesible` | grep vacío en L4 | abortar, revisar rama / código |
| `docker build` falla | exit ≠ 0 en §2.2 | abortar, revisar Dockerfile.front |
| `docker save` llena disco local | `df` antes y después | limpiar `~/.cache`, reintentar |
| sha256 mismatch post-scp | §3.3 falla | re-scp, verificar red |
| `docker load` falla en VPS | exit ≠ 0 en §3.4 | re-transfer, verificar disco VPS |
| `docker compose config -q` inválido | §4.4 falla | restaurar `docker-compose.override.yml.bak-pre-*`, re-editar |
| Se editó el compose base en vez del override | §4.4 muestra `front` = `OLD_TAG` | **deploy fantasma**: restaurar el backup, volver a §4.0 y determinar el destino con `config --images`. No recrear el service |
| `front` no arranca tras swap | §4.6 logs muestran error | rollback (§7) inmediato |
| `nginx -t` del edge falla | §5 falla | NO reload; investigar config del edge (no debería haberse tocado) |
| Smoke S4 falla (botón sigue yendo a /texto) | bundle cacheado en cliente | hard-refresh; si persiste, verificar que el container front efectivamente tiene la imagen nueva |
| Smoke S5 falla (404 en /leer/accesible) | ruta no registrada o nginx.prod.conf rota SPA fallback | verificar `nginx.prod.conf` dentro de la imagen; rollback si no resuelve en <5 min |
| Regresión en api_1 / api_2 | restart count subió | imposible bajo `--no-deps front`; investigar timing coincidente o rollback preventivo |

---

## 10. Post-mortem checklist (siempre, deploy verde o rojo)

```bash
{
  echo "=== $(date -u +%Y-%m-%dT%H:%M:%SZ) POST-DEPLOY SPRINT-022 ==="
  echo "tag desplegado: $TAG"
  echo "tag previo: <copiar de §1.3>"
  echo "resultado: <verde | rollback>"
  echo "operador: $(whoami)"
  echo "duración aprox: <minutos>"
  echo "smoke results: S1-S10 = <pass/fail por ítem>"
} >> ~/deploys-frontend.log
```

Si fue rollback: abrir issue con causa raíz antes del segundo intento.

---

## Anexo A — Comandos atómicos resumidos

Una vez familiarizado con el procedimiento, esta es la secuencia mínima
(ejecutar cada bloque con verificación entre uno y otro):

```bash
# === LOCAL ===
GIT_SHA=$(git rev-parse --short HEAD)
TAG="chibalete/front:sprint-022-${GIT_SHA}"
ARTIFACT="/tmp/chibalete-front-${GIT_SHA}.tar.gz"

npm run build
grep -rq "leer/accesible" dist/ && echo "✓ bundle OK" || { echo "✗ ABORT"; exit 1; }

docker build --pull -f Dockerfile.front -t "$TAG" .
docker run --rm --entrypoint sh "$TAG" -c 'grep -q "leer/accesible" /usr/share/nginx/html/*.js && echo OK'

docker save "$TAG" | gzip > "$ARTIFACT"
sha256sum "$ARTIFACT" | tee "${ARTIFACT}.sha256"

scp "$ARTIFACT" "${ARTIFACT}.sha256" root@72.60.158.97:/tmp/

# === VPS ===
ssh root@72.60.158.97 "
  gunzip -c /tmp/$(basename $ARTIFACT) | docker load
"
# Localizar la imagen efectiva y respaldar el OVERRIDE (variables en el shell REMOTO)
ssh root@VPS 'bash -s' <<'REMOTE'
  cd /opt/chibaleteplus
  docker compose config --images            # autoridad: de aqui sale OLD_TAG
  TS=$(date -u +%Y%m%dT%H%M%SZ)
  cp docker-compose.override.yml "docker-compose.override.yml.bak-pre-<SLUG>-${TS}"
REMOTE
# Swap SOLO en el override:
ssh root@VPS "sed -i 's|image: $OLD_TAG|image: $NEW_TAG|' /opt/chibaleteplus/docker-compose.override.yml"

ssh root@VPS "
  cd /opt/chibaleteplus
  docker compose config --quiet
  docker compose config --images            # front=NEW_TAG, resto sin cambio (BLOQUEANTE)
  docker compose up -d --no-deps front
  docker exec chibalete_edge nginx -t
  docker exec chibalete_edge nginx -s reload
  docker ps --format '{{.Names}} {{.Status}} {{.Image}}' | grep chibalete
"

# === SMOKE ===
# Browser manual: §6.2 S1-S10
```

---

## Anexo B — Restricciones que este runbook respeta

- **No-touch api_1 / api_2:** `--no-deps front` lo garantiza estructuralmente (§4.5, §0.3 blast radius)
- **No-touch edge salvo nginx reload:** §5.1 sólo invoca `nginx -t` y `nginx -s reload`, sin modificar config ni recrear container
- **Rollback claro:** §7.1 (steps) + §7.2 (verification criteria R1-R18), dependiente de §1.3 (tag previo documentado)
- **Tag previo documentado:** §1.3 es bloqueante
- **Smoke explícito:**
  - `/leer/accesible/:id` activo (S4, S5)
  - "Modo Guiado" como rename visual (S6)
  - Sin regresiones en Texto / Inmersivo / PDF / Álbum (S6, S7, S8, S9)
- **Build determinístico local:** `--pull` + base images pin'd (mejorable a digest SHA en futuro)
- **No toolchain en VPS:** `docker load` es la única operación que toca producción para cargar artefacto
- **Cache invalidation explícita:** §5.3 separa "el deploy llegó al edge" de "el deploy llegó al cliente"; descarta falsos positivos por cache local antes de declarar fallo
- **Architecture invariant respetado:** §0.2 separa frontend image-based de backend bind-mount; este runbook es del primero, sin mezclar
- **Blast radius acotado:** §0.3 enumera explícitamente lo que NO se toca; §6.3 lo verifica observacionalmente
