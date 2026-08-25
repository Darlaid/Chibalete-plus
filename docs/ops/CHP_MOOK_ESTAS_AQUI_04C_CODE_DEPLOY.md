# CHP-MOOK-ESTAS-AQUI-04C — PRODUCTION CODE DEPLOY

**Veredicto:** 🟢 **`GREEN-MOOK-CODE-PRODUCTION`**
**Rama:** `chp/mook-contract-00` · **SHA desplegado:** `ffc90a1`
**Fecha:** 2026-08-25 · **Operador:** Nicolás Jiménez

> **El código MOOK está en producción, sano y verificado por humano.** Smoke autenticado **5/5 PASS**.
>
> **Alcance de la autorización ejecutada:** solo código. **No se cargó ningún recurso, no se creó
> ninguna experiencia, `mook_db.json` sigue sin existir, no se creó ninguna cuenta y no se publicó
> nada.**

---

## A. VEREDICTO

| Fase | Resultado |
|---|---|
| A · Preflight productivo | 🟢 sin drift, backups GREEN, 51 GB libres |
| B · Construcción sin activación | 🟢 ambas imágenes, exit 0, smoke aislado GREEN |
| C · Rolling de API (1 → 2) | 🟢 ambas en `ffc90a1`, healthy, 0 restarts |
| D · Frontend | 🟢 `lib01-ffc90a1`, resuelve ambos upstreams |
| E · Smoke productivo | 🟢 server-side **y UI autenticada 5/5 PASS** |
| F · Observación | 🟢 0 errores, **0 5xx en 60 min** |
| K · Ausencia de escrituras | 🟢 verificada punto por punto |

**`GREEN-MOOK-CODE-PRODUCTION` emitido:** el operador completó el smoke de UI autenticada con
**5/5 PASS** y el cierre técnico posterior verificó **9/9** comprobaciones read-only.

**No se emitió** `STOP-PRODUCTION-DRIFT`, `STOP-BACKUP-GATE` ni `RED-DEPLOY-ROLLBACK`.

---

## B. BASELINE PRODUCTIVO

### Antes del deploy

| Container | Imagen | Digest | Health | Restarts | StartedAt |
|---|---|---|---|---|---|
| `chibalete_api_1` | `chibalete/api:679b036` | `sha256:0addbc588768…` | healthy | 0 | 2026-08-18T19:13:44Z |
| `chibalete_api_2` | `chibalete/api:679b036` | `sha256:0addbc588768…` | healthy | 0 | 2026-08-18T19:12:24Z |
| `chibalete_front` | `chibalete/front:lib01-679b036` | `sha256:6687c2f3c1a9…` | healthy | 0 | 2026-08-18T19:15:52Z |
| `chibalete_edge` | `nginx:alpine` | — | healthy | 0 | 2026-08-11T01:33:31Z |

### Después del deploy

| Container | Imagen | Digest | Health | Restarts | StartedAt |
|---|---|---|---|---|---|
| `chibalete_api_1` | **`chibalete/api:ffc90a1`** | `sha256:9c1d2ad45f74…` | **healthy** | **0** | 2026-08-25T23:26:10Z |
| `chibalete_api_2` | **`chibalete/api:ffc90a1`** | `sha256:9c1d2ad45f74…` | **healthy** | **0** | 2026-08-25T23:27:42Z |
| `chibalete_front` | **`chibalete/front:lib01-ffc90a1`** | `sha256:8f7ddffcc488…` | **healthy** | **0** | 2026-08-25T23:29:04Z |
| `chibalete_edge` | `nginx:alpine` | — | healthy | 0 | **2026-08-11T01:33:31Z — INTACTO** |

**`StartedAt` cambió exactamente en API 1, API 2 y frontend. Edge no se tocó.**

---

## C. IMÁGENES CONSTRUIDAS

Construidas en el VPS desde un **`git archive` del SHA exacto**, no desde el working tree.

| Elemento | Valor |
|---|---|
| Archive | `git archive ffc90a1` · **3 998 030 bytes** · SHA-256 `851376539aeabc0d0fd77673dd06623c7ba07590be472b4d9f9d38f0beb8cf29` |
| Integridad en destino | `sha256sum` en el VPS **idéntico** al local |
| Contenido | **935 archivos rastreados** · **0 carpetas editoriales, 0 MP3** · ambos Dockerfiles presentes |

| Imagen | Tag | Digest | Tamaño | Base | Exit |
|---|---|---|---|---|---|
| API | `chibalete/api:ffc90a1` | `sha256:9c1d2ad45f748218d7aafb65eba738cba673d2ddea374d55a0cb0f2c60d39cc7` | 154 303 906 B | `node:20-alpine` **pineada por digest** | **0** |
| Frontend | `chibalete/front:lib01-ffc90a1` | `sha256:8f7ddffcc488ec12c6be8559b482462b84bcc0da13063b361afe428c4a049de6` | 22 415 766 B | `node:20-alpine` → `nginx:1.27-alpine` | **0** |

Build args productivos: `GIT_SHA=ffc90a1`, `RELEASE_TAG=mook-ffc90a1`. **Sin secretos.**

**Trazabilidad confirmada en caliente:** `GIT_SHA=ffc90a1` y `CHIBALETE_RELEASE=mook-ffc90a1` leídos
**dentro de los containers en producción**.

### Smoke aislado previo a la activación

Container temporal en el puerto **3099**, con **copias** de los stores (nunca los montajes
productivos), destruido al terminar:

| Prueba | Resultado |
|---|---|
| Health del container | ✅ healthy |
| `/api/health` | ✅ 200 |
| `GIT_SHA` embebido | ✅ `ffc90a1` |
| admin → `/api/experiences` · Studio `admin/list` | ✅ **`[]` 200** en ambas |
| lector → Studio `admin/list` | ✅ **403** |
| mediador → `review/queue` | ✅ **403** |
| sin sesión → `/api/content` | ✅ **401** |
| `mook_db.json` en el temporal | ✅ ausente |

**Hallazgo del smoke, resuelto:** `lt-user-001` devolvía 401 en `/api/content`. Se comprobó que su
`accountStatus` es **`disabled`** (usuario de load-test) — **comportamiento correcto, no regresión**.
Se repitió con un lector **activo real** (`user-1777177383214`) → **200**.

---

## D. PREFLIGHT Y BACKUPS

| Comprobación | Resultado |
|---|---|
| `ffc90a1 == origin/chp/mook-contract-00` | ✅ |
| `679b036` es ancestro de `ffc90a1` | ✅ |
| Diferencia `150fbf0..ffc90a1` | ✅ **un solo archivo, documental** |
| Producción en `679b036` sin drift | ✅ |
| `mook_db.json` ausente | ✅ |
| Catálogo: 67 entradas, **0 ids MOOK** | ✅ |
| `structured-backup` | ✅ exit 0 — 2026-08-25 18:02:34 UTC |
| `uploads-backup` | ✅ exit 0 — 2026-08-25 03:38:55 UTC |
| `backup-verify` | ✅ exit 0 — 2026-08-23 05:13:37 UTC |
| Espacio antes / después | 51 GB → **48 GB libres** (build consumió ~3 GB) |
| 5xx recientes en edge | ✅ **0** — la distribución previa era 200/304/301/401/400/404/403/405 |
| Errores en las APIs (6 h) | ✅ **0 / 0** |
| Compose efectivo | ✅ 4 servicios: `api_1`, `api_2`, `front`, `edge` |

---

## E. ROLLING DE API 1

**Mutación:** una sola línea del `docker-compose.override.yml` (línea 40), con **backup previo** en
`/root/chp-04c-override.bak.yml`. Recreado con `docker compose up -d --no-deps api_1`.

Estado inmediatamente después: `api_1` en `ffc90a1` **healthy, 0 restarts**; `api_2`, `front` y
`edge` **intactos en su imagen anterior**. Logs: `Server running on port 3000`, **0 errores**.

### Verificación funcional directa contra `api_1` (172.21.0.4)

| Prueba | Resultado |
|---|---|
| `/api/health` | ✅ 200 |
| sin sesión → `/api/content` | ✅ **401** |
| lector → `/api/content` | ✅ **200** |
| lector → `/api/experiences` | ✅ **`[]` 200** |
| admin → Studio `admin/list` | ✅ **`[]` 200** |
| lector → Studio `admin/list` | ✅ **403** |
| mediador → `review/queue` | ✅ **403** |
| lector → `/api/groups` (legacy) | ✅ **200** |
| 5xx en edge tras el recreate | ✅ **0** |
| `mook_db.json` | ✅ ausente |

**No se continuó a API 2 hasta comprobar todo lo anterior.**

---

## F. ROLLING DE API 2

Misma mecánica sobre la línea 73, con `api_1` **sirviendo tráfico**.

| Prueba contra `api_2` (172.21.0.2) | Resultado |
|---|---|
| `GIT_SHA` | ✅ `ffc90a1` |
| `/api/health` | ✅ 200 |
| sin sesión → `/api/content` | ✅ **401** |
| lector → `/api/content` | ✅ **200** |
| lector → `/api/experiences` | ✅ **`[]` 200** |
| admin → Studio `admin/list` | ✅ **`[]` 200** |
| mediador → `review/queue` | ✅ **403** |
| Errores en `api_2` | ✅ **0** |
| 5xx en edge (5 min) | ✅ **0** |
| `mook_db.json` | ✅ ausente |

**Ambas APIs ejecutan exactamente `ffc90a1`, healthy, `RestartCount=0`, mismo entorno que el
baseline.**

---

## G. FRONTEND

Antes de tocarlo se confirmó que **ambas APIs estaban presentes, resolubles y healthy** — condición
crítica, porque el nginx del frontend declara los dos upstreams por nombre y **aborta al arrancar si
alguno no resuelve** (comprobado en el smoke aislado de 04B-R1).

Actualizada la línea 108 y recreado solo `front`. **Edge no se recreó.**

| Prueba | Resultado |
|---|---|
| Resolución de `chibalete_api_1` | ✅ **172.21.0.4** |
| Resolución de `chibalete_api_2` | ✅ **172.21.0.2** |
| `index.html` desde el propio container | ✅ **HTTP/1.1 200 OK** |
| Proxy `/api/health` → APIs nuevas | ✅ **HTTP/1.1 200 OK** |
| Errores/`emerg` en el log del front | ✅ **0** |
| Chunks del release servidos | ✅ `Experiencias` (1), `SubirContenido` (1), `AulaViva` (2) |

**Ningún 502/503, ni siquiera transitorio.**

---

## H. EDGE Y RED

**Edge no se tocó en ningún momento.** `StartedAt` sigue en `2026-08-11T01:33:31Z`, health `healthy`,
`RestartCount=0`. No se editó `nginx.conf` ni el Compose de edge.

### Smoke público a través de edge (solo GET, dominio real)

| Prueba | Resultado |
|---|---|
| `/` (edge → front) | ✅ 200 |
| `/api/health` | ✅ 200 |
| `/api/content` sin sesión | ✅ **401** |
| `/api/experiences` sin sesión | ✅ **401** |
| Asset del bundle nuevo | ✅ 200 |
| TLS y cabeceras | ✅ 200 |

---

## I. SMOKE LEGACY

Verificado server-side con **actores reales del padrón productivo** (solo ids, sin PII):
admin `user-1774362611303`, lector activo `user-1777177383214`, mediador `user-1776618688276`.

`/api/content` **200** para lector · `/api/groups` **200** · `401` sin sesión · TLS y assets 200.
**Sin loops 401** y **sin 5xx**. Android LU no se tocó y no depende de rutas modificadas por este
release.

---

## J. SMOKE MOOK SIN DATOS

| Requisito | Resultado |
|---|---|
| Participante autenticado → `GET /api/experiences` | ✅ **`200 []`** |
| Administrador → lista de Studio | ✅ **`200 []`** |
| Lector común en rutas admin | ✅ **403** |
| Mediador en Review | ✅ **403 `MEDIATOR_SCOPE_GATED`** |
| Eventos MOOK emitidos | ✅ **0** |

**Todas las comprobaciones fueron GET.** No se pulsó crear, guardar, publicar, archivar, enviar
evidencia ni iniciar run.

---

## K. PERSISTENCIA Y AUSENCIA DE ESCRITURAS

| Comprobación | Resultado |
|---|---|
| `mook_db.json` | ✅ **sigue sin existir** |
| Catálogo | ✅ **67 entradas**, `mtime` **2026-05-29** — sin tocar |
| Ids MOOK en catálogo | ✅ **0** |
| Uploads | ✅ **64 dirs / 5,1 GB** — sin cambio |
| `groups_db.json` | ✅ `mtime` 2026-08-12 — sin tocar |
| Padrón | ✅ `mtime` 2026-08-25 15:12 (previo al deploy) — sin tocar |
| **Eventos MOOK en `events.db`** | ✅ **0** de 19 575 eventos totales |
| Bandera de eventos MOOK | ✅ **ausente → OFF** |
| `SESSION_AUTH_MODE` | ✅ **`compat`** conservado |

**Cero escrituras de datos. La única mutación de esta unidad fueron tres líneas de imagen en el
override y la recreación de tres containers.**

---

## L. SALUD Y OBSERVACIÓN

Ventana de ~20 minutos tras el último recreate:

| Métrica | Resultado |
|---|---|
| Health de los 4 containers | ✅ **healthy** |
| `RestartCount` | ✅ **0 / 0 / 0 / 0** |
| Errores en `api_1` / `api_2` | ✅ **0 / 0** |
| Errores en `front` | ✅ **0** |
| **5xx en edge (20 min)** | ✅ **0** |
| Tráfico observado | 200 y 401 (los 401 corresponden a las pruebas sin sesión de este smoke) |

⚠️ **Nota honesta sobre el volumen:** el tráfico en la ventana fue **bajo** y en buena medida
generado por este propio smoke. La estabilidad está demostrada, pero **no equivale a carga real de
usuarios**.

---

## M. ROLLBACK DISPONIBLE

| Elemento | Estado |
|---|---|
| `chibalete/api:679b036` | ✅ **presente**, `sha256:0addbc588768…` |
| `chibalete/front:lib01-679b036` | ✅ **presente**, `sha256:6687c2f3c1a9…` |
| Backup del override | ✅ `/root/chp-04c-override.bak.yml` (4 493 B) |
| Imágenes `chibalete/*` en el host | ✅ **28 — ninguna borrada** |
| Artefacto de build | ✅ conservado en `/root/chp-build-ffc90a1` (16 MB) para trazabilidad |

**Orden de rollback:** frontend → API 2 → API 1, restaurando los tags anteriores en el override y
`up -d --no-deps` por servicio. **No se borra ninguna imagen y no se toca ningún dato.**

---

## N-BIS. SMOKE AUTENTICADO — ✅ 5/5 PASS · `YELLOW-AUTHENTICATED-SMOKE-PENDING` CERRADO

**Nicolás Jiménez, sesión administradora legítima en producción.** No creó, guardó, publicó,
archivó ni revisó ningún elemento.

| # | Comprobación | Resultado |
|---|---|---|
| 1 | Biblioteca y visor | ✅ **PASS** |
| 2 | Aula Viva | ✅ **PASS** |
| 3 | Studio carga y muestra lista vacía | ✅ **PASS** |
| 4 | Experiencias muestra lista vacía | ✅ **PASS** |
| 5 | Producciones conserva su estado previo | ✅ **PASS** |

### Evidencia visual aportada (descrita, **no copiada ni indexada en el repositorio**)

- Chibalete+ **3.0.2** cargando en producción.
- Biblioteca y catálogo visibles.
- Ficha correcta de *Me desconecto, luego existo*.
- URL canónica **`#/contenido/content-1774362922886`**.
- **Portada correcta del libro.**
- Visor textual cargando contenido.
- Studio de Experiencias disponible para admin, con el mensaje **«Aún no hay Experiencias»**.
- Pestaña Experiencias en estado vacío: **«Pronto habrá Experiencias disponibles»**.

### 🟢 R-4 CERRADO

La evidencia confirma en producción lo que 04B había deducido por hash:
**`content-1774362922886` es la fuente correcta de la portada y el `parentId` del libro.**
**`content-1765751139919` (La metamorfosis, de Kafka) NO debe usarse.** El riesgo R-4 queda
resuelto antes de 04D.

### Cierre técnico posterior — 9/9 read-only

| # | Comprobación | Resultado |
|---|---|---|
| 1–3 | APIs y frontend healthy · edge intacto | ✅ los 4 `healthy`; edge `StartedAt` sigue en **2026-08-11T01:33:31Z** |
| 2 | `RestartCount` | ✅ **0 / 0 / 0 / 0** |
| 4 | Errores y 5xx durante la ventana del smoke (60 min) | ✅ **0 errores** en `api_1`, `api_2` y `front` · **0 5xx** |
| 5 | `mook_db.json` | ✅ **sigue ausente** |
| 6 | Studio y Experiencias | ✅ **`[]` 200** en ambas |
| 7 | Recursos/experiencias MOOK creados | ✅ catálogo **67 entradas**, `mtime` de mayo · **0 ids MOOK** · **0 hijos** de `content-1774362922886` |
| 8 | Eventos MOOK | ✅ **0** |
| 9 | Mutaciones atribuibles al MOOK | ✅ uploads **64 / 5,1 GB** sin cambio · `groups_db.json` sin tocar · `SESSION_AUTH_MODE=compat` · bandera de eventos **OFF** |

**Tráfico del smoke humano:** 119 × 304, 71 × 200, 5 × 403, 2 × 401. **Ningún 5xx.** Los 403
corresponden a comprobaciones de permisos de ruta durante la navegación — comportamiento esperado.

### Dos deltas observados, explicados y NO atribuibles al MOOK

| Delta | Explicación |
|---|---|
| `events.db` **19 575 → 19 584** (+9) | **Telemetría ordinaria de lectura** generada por la apertura legítima del libro y del visor. **Cero de esos eventos es MOOK** (consulta explícita sobre los 6 tipos `experience_*`/`node_*`/`evidence_*` → 0). No se borró ningún evento ni progreso. |
| Padrón `mtime` **2026-08-25 15:12 → 23:47** | El handler de login actualiza `lastLoginAt` del usuario que inicia sesión. Es consecuencia directa y esperada del propio smoke autenticado, **no una mutación de datos MOOK**. |

---

## N. RIESGOS RESTANTES Y SOLICITUD PARA 04D

### Estado del gate de smoke

✅ **Cerrado.** El operador confirmó 5/5 y el cierre técnico verificó 9/9. Veredicto elevado a
**`GREEN-MOOK-CODE-PRODUCTION`**.

### Riesgos restantes

| # | Riesgo | Estado |
|---|---|---|
| **R-1** | `CVE-2026-45447` heredado en la imagen base | Aceptado como deuda **`CHP-SEC-IMAGE-CVE-01`**; re-verificado no alcanzable (Node con OpenSSL estático). **Cero hallazgos nuevos.** |
| **R-2** | Ventana de observación con tráfico bajo | Vigilar en la próxima jornada de uso real |
| **R-3** | `YELLOW-AUDIENCE-DECISION` (de 04B) | **Sigue abierto.** No afecta a 04C ni a 04D; bloquea 04F |
| **R-4** | Portada y `parentId` del libro | ✅ **CERRADO** — confirmado en producción que la fuente correcta es `content-1774362922886` |

### Solicitud

**No se ejecutó 04D.** No se cargaron activos, no se creó el MOOK, no se creó cuenta QA y no se
publicó ninguna experiencia. **Producción no se modificó en esta unidad de cierre**: todas las
comprobaciones posteriores fueron read-only.

**Se solicita autorización explícita para `04D-CONTENT-LOAD-AND-DRAFT`.** Con R-4 cerrado, el único
bloqueador pendiente del tren es `YELLOW-AUDIENCE-DECISION`, que **no afecta a 04D** —la carga nace
en DRAFT, no descubrible— pero **sigue bloqueando 04F**.

---

## TRAZA

| Fecha | Operador | Acción |
|---|---|---|
| 2026-08-25 | Nicolás Jiménez | Deploy de código `ffc90a1` a producción: build desde `git archive` verificado por hash, smoke aislado, rolling API 1 → API 2, frontend, edge intacto. **Cero escrituras de datos; `mook_db.json` sigue ausente.** Veredicto `YELLOW-AUTHENTICATED-SMOKE-PENDING` a la espera del smoke de UI con sesión legítima. |
| 2026-08-25 | Nicolás Jiménez | **Smoke autenticado 5/5 PASS** con sesión administradora legítima + cierre técnico **9/9** read-only. **R-4 cerrado**: la fuente correcta de portada y `parentId` es `content-1774362922886`. Veredicto elevado a 🟢 **`GREEN-MOOK-CODE-PRODUCTION`**. 04D no ejecutado. |
