# CHP-MOOK-COVER-UPLOAD-01A — CUBIERTA PROPIA Y CARGA SEGURA

**Estado:** 🟢 **`GREEN-MOOK-COVER-UPLOAD-READY-FOR-DEPLOY`**
**Este GREEN no autoriza desplegar ni cambiar la cubierta productiva.**
**Rama:** `chp/mook-contract-00`
**Fecha:** 2026-08-27
**Unidad previa:** 04F — `GREEN-MOOK-ESTAS-AQUI-V1-PRODUCTION` (`5e30fb8`)

---

## A. AUDITORÍA — GATE 1: EXPOSICIÓN DE `/api/upload`

### 🔴 Corrección de un hallazgo propio

La primera lectura de esta unidad afirmó que `POST /api/upload` **no estaba autenticado**. **Era
falso.** Se miró la firma de la ruta —que no lleva middleware inline— y no el montaje por path
registrado 1 737 líneas antes:

```js
server.js:621   app.use('/api/upload', requireAdminRole);
server.js:2480  // Protected by app.use('/api/upload', requireAdminRole) already registered above.
```

**`CHP-SEC-UNAUTHENTICATED-GENERIC-UPLOAD-01` NO se registra: el hallazgo no existe.** No hay unidad
de seguridad separada que proponer y no queda ningún hallazgo abierto que condicione este GREEN.

> **Lección de método.** Un `app.use` con prefijo protege rutas que se declaran mucho más abajo. En
> un archivo de ~10 000 líneas, leer la firma de una ruta **no** basta para afirmar nada sobre su
> autorización. La comprobación válida es ejercitar el endpoint.

### Demostración empírica

Servidor real, fixture aislado (`USERS_DB`, `CHP_DATA_DIR` y `UPLOADS_ROOT` fuera del repo), PNG
válido de 79 B, en **los dos modos de sesión** —incluido `compat`, el de producción—:

| Actor | `SESSION_AUTH_MODE=off` | `compat` (producción) | ¿Escribió en disco? |
|---|---|---|---|
| **Anónimo** | **401** `Auth requerida: x-user-id missing` | **401** `Auth requerida` | **no** |
| **Lector autenticado** | **403** `se requiere rol administrador` | **403** ídem | **no** |
| **Administrador** | 200 + URL única | 200 + URL única | sí |

Los rechazos ocurren **antes de multer**: el directorio quedó con **un solo archivo**, el del admin.

### Resto de la superficie

| Aspecto | Hallazgo |
|---|---|
| Middleware previo | `helmet` → `cors` → `express.json` → `httpLogger` → `metricsMiddleware` → rate limiter → guard CSRF → `requireAdminRole` |
| Rate limiting | global `/api/`: 1500 req / 15 min, clave `x-user-id` o IP (`trust proxy 1`). Sin limitador específico de upload |
| Límites efectivos | nginx `client_max_body_size 2g` en el bloque de la API · multer `MAX_UPLOAD_BYTES = 2 GiB` |
| Consumidores | backend: `/api/upload` y `/api/upload/purge`. Frontend: **una** función, `dataService.uploadFile()`, con **dos** llamadas, ambas en `pages/SubirContenido.tsx` (836, 2238) |
| Roles | hoy **solo `administrador`** sube cualquier tipo. No hace falta ampliar roles |

**Por qué no se reutiliza `/api/upload` para cubiertas:** acepta 2 GiB y once familias de archivo
porque sirve al catálogo editorial entero. Una cubierta necesita justo lo contrario —5 MB, tres
formatos, 16:9—. Heredar aquellos límites sería heredar una semántica que no le corresponde.

---

## B. AUDITORÍA — GATE 2: CONSUMIDORES VISUALES

Solo consumidores reales de `Experience.imageUrl`.

| Consumidor | Contenedor **antes** | Ratio | `object-fit` | Desktop | 390 px |
|---|---|---|---|---|---|
| **Biblioteca → «Experiencia destacada»** (`Biblioteca.tsx:162`) | `<img class="w-full h-44 object-cover opacity-80">` | sin `aspect-ratio`; **alto fijo 176 px** | `cover`, sin `object-position` (⇒ center) | ancho del card × 176 px → hasta **≈3:1** | ≈358 × 176 px → **≈2.03:1** |
| Biblioteca → «Otras Experiencias» (`:193-197`) | solo texto | — | — | — | — |
| Landing `/experiencias/:id` (`Experiencias.tsx`) | **no renderiza la cubierta**; `experienceDetail` devuelve `imageUrl` y la página lo ignora | — | — | — | — |
| Studio → Información (`ExperienceStudio.tsx:749`) | `<input type="text">`, sin previsualización | — | — | — | — |

**Un solo consumidor pinta la cubierta hoy.** La imagen de `Experiencias.tsx:253` es
`node.resource.portada_url` —miniatura del recurso dentro de un nodo—, **no** `Experience.imageUrl`:
fuera de alcance, no se toca.

**No hay incompatibilidad material**, así que se adopta el contrato recomendado:

```text
Cubierta recomendada: 1600 × 900 px
Mínimo: 1280 × 720 px
Ratio: 16:9
Zona segura: 1280 × 720 px centrales
Máximo: 5 MB
Formatos: JPEG, PNG y WebP
```

### Contrato visual aplicado

```css
aspect-ratio: 16 / 9;
object-fit: cover;
object-position: center;
```

**Consecuencia visible, declarada:** el hero de destacada pasa de 176 px fijos a ~0,5625 × ancho.
Es más alto en desktop. Era lo que hacía falta: con `h-44` la proporción real iba de ~2:1 a ~3:1
según el ancho, y la cubierta se recortaba de forma impredecible — justo lo que la zona segura no
puede compensar si el marco no es estable.

**No se tocan tarjetas de libros ni `portada_url`.** Una aserción de la suite lo verifica: ningún
módulo de esta unidad menciona `portada_url`.

---

## C. RUTA DEL UPLOAD

```text
POST /api/experiences/:id/cover        → 201 { "url": "/uploads/experience-covers/<único>" }
```

| Requisito | Implementación |
|---|---|
| Autorización | `requireAdminAccess`, el mismo guard que `publish`, `archive` y `update` |
| Experience existe | se comprueba **antes** de aceptar bytes ⇒ 404 sin escribir nada |
| 5 MB antes de escribir | `limits.fileSize` de multer aborta **durante** el stream |
| Magic bytes | `fileTypeFromFile` — el MIME declarado es una afirmación, no evidencia |
| Dimensiones y ratio | `server/lib/imageDimensions.js` lee cabeceras PNG/JPEG/WebP |
| Filename único | `<slug>-<timestamp>-<aleatorio><ext>`; la extensión la fija el **MIME real** |
| Cero overwrite | `copyFileSync(..., COPYFILE_EXCL)`: falla si el destino existe. No se deja a la probabilidad |
| Cero eliminación | la cubierta anterior permanece |
| Respuesta | **solo** `{ url }` |
| `mook_db.json` | **no se toca**; `imageUrl` cambia cuando el operador guarda Información |

**Sin dependencias nuevas.** El lector de dimensiones parsea las cabeceras a mano: son tres familias
conocidas y traer un decodificador de imágenes entero para leer cuatro enteros no se justifica.

**Fuente única del contrato.** Los números viven en `server/lib/coverContract.js`, sin dependencias
de Node, y los importan **tanto** el backend **como** el Studio. Si estuvieran duplicados en el
frontend acabarían divergiendo y el operador vería aceptada en pantalla una imagen que el servidor
rechaza.

### Path traversal

El nombre original **nunca llega al disco**: se reduce a un slug alfanumérico de 40 caracteres. Eso
neutraliza `../`, bytes nulos, rutas absolutas y nombres reservados de Windows de una vez. Verificado
con `../../../../etc/passwd.png`.

### Timeout ambiguo

`dataService.uploadExperienceCover` aborta a los 60 s y lanza un error **marcado como ambiguo**. El
Studio **no reintenta solo**: un upload sin respuesta puede haber llegado igualmente, y reintentar a
ciegas duplicaría el archivo. Se pide inspección humana — recargar y comprobar antes de reintentar.

### Doble clic

El botón queda **inerte** mientras hay una subida en vuelo. Es la barrera que **04F echó en falta en
«Publicar»**, donde el segundo clic solo lo frenó el 409 del backend, y encima cruzando réplicas.

---

## D. ALMACENAMIENTO Y BACKUPS

| Aspecto | Estado |
|---|---|
| Destino | `public/uploads/experience-covers/` |
| Volumen compartido | `/var/www/chibalete/public/uploads` está bind-mounteado `rw` en **api_1 y api_2** sobre la **misma ruta del host** ⇒ lo que sube una réplica lo sirve la otra |
| Cobertura de backup | el snapshot `a0c4ab09` contabilizó **exactamente 3328** archivos, que es el conteo de `find … -type f` sobre ese árbol ⇒ el destino **está respaldado**, con RPO diario (86 400 s) |
| Caché obsoleta | imposible: cada subida produce una ruta nueva |

---

## E. PRUEBAS — `server/__test__/mookCoverUpload01a.test.mjs`

**34 aserciones, todas GREEN en Docker Linux local** (`node:20-bookworm`, `linux/amd64`, engine
29.4.2, con `node_modules` instalado **dentro** del contenedor porque los binarios nativos locales
—`better-sqlite3`, `bcryptjs`— están compilados para Windows).

| Capa | Cobertura |
|---|---|
| **A · Política** | JPEG/PNG/WebP válidos · 1600×900 · 3840×2160 · bajo mínimo · ratio 4:3 · >5 MB · MIME falsificado · corrupto · cabecera truncada · bomba de píxeles · extensión por MIME real |
| **B · Endpoint HTTP** | no autenticado · sin rol · Experience inexistente · subida válida · destino respaldado · **store no mutado** · doble subida sin overwrite · dimensiones · ratio · spoofing · **SVG** · corrupto · >5 MB · **nombre malicioso** · **doble clic concurrente** · cero v2/runs/evidencias |
| **C · Contrato visual** | Biblioteca 16:9+cover+center y sin `h-44` · Studio con etiqueta, previsualización, estados, doble clic y vía manual · texto de ayuda · `portada_url` no mencionada |

### Suites en Docker Linux local

| Suite | Resultado |
|---|---|
| `test:mook` (10 suites, incluida la nueva) | ✅ **GREEN** |
| `test:content-rmw` (gate bloqueante) | ✅ **GREEN** |
| `test:store-isolation` | ✅ **stores reales: 0 modificados / 0 creados / 0 eliminados** |
| `npm run build` | ✅ compila (valida el import compartido del contrato) |

**Rojo pre-existente y ajeno:** `test:analytics` da **43 ✓ / 3 ✗**. Verificado con `git stash`
sobre **HEAD limpio**: **43 ✓ / 3 ✗ idéntico**. No lo introduce esta unidad. Los 3 fallos son samples
ausentes de eventos `experience_*` en el registry de analítica.

### Matiz honesto: 401 en vez de 403

`requireAdminAccess` **colapsa "sin identidad" y "rol insuficiente" en un mismo 401** — es el
comportamiento de todas sus rutas hermanas. La cubierta lo hereda **a propósito**: un 403 a medida
sería una incoherencia dentro de `/api/experiences`. La prueba asegura lo sustantivo: el lector queda
fuera **y no escribe bytes**.

### Lo que las pruebas NO cubren

La previsualización a **390 px y en desktop está verificada de forma estructural**, no visual: se
asserta que el marco declara `aspect-ratio: 16/9`, `object-fit: cover` y `object-position: center`, y
que el contenedor usa `w-full max-w-md` (sin desbordamiento posible). **No se ha abierto un navegador
a 390 px.** El contrato CSS es determinista y no hay media queries que lo rompan, pero la
confirmación visual sigue pendiente y conviene hacerla antes de desplegar.

---

## F. PROCEDIMIENTO DE USO

1. `Subir → Studio de Experiencias → <experiencia> → Información`.
2. **Subir nueva cubierta** → elegir un JPG, PNG o WebP **16:9**, idealmente 1600 × 900.
3. La previsualización muestra el recorte real. El aviso recuerda que falta guardar.
4. **Guardar Información** — hasta aquí no ha cambiado nada.
5. Alternativa conservada: desplegar *«O usar la URL de una imagen ya subida»* y pegar una ruta.
   Es como se resolvió la cubierta del primer MOOK, reutilizando el activo del libro.

> **Recordatorio F1 (ADR §18).** La información general **no está versionada**: guardarla afecta a la
> landing de la versión publicada de inmediato, sin crear v2. Es lo que permite cambiar una cubierta
> sin republicar, y también lo que obliga a mirar antes de guardar.

---

## G. LÍMITES RESPETADOS

Cero producción · cero deploy · cero uploads productivos · cero cambios en la Experience publicada ·
cero escritura directa de stores · cero eliminación o reemplazo de activos. No se tocó `data/`,
`data-critical/`, uploads ni recursos editoriales. No se trabajaron deudas ajenas.

---

## H. DIFF

| Archivo | Cambio |
|---|---|
| `server/lib/coverContract.js` | **nuevo** — números del contrato, sin dependencias de Node |
| `server/lib/coverPolicy.js` | **nuevo** — validación de servidor sobre bytes reales |
| `server/lib/imageDimensions.js` | **nuevo** — dimensiones de PNG/JPEG/WebP desde cabecera |
| `server/__test__/mookCoverUpload01a.test.mjs` | **nuevo** — 34 aserciones |
| `server/server.js` | ruta `POST /api/experiences/:id/cover` + 2 imports |
| `services/dataService.ts` | `uploadExperienceCover()` |
| `components/studio/ExperienceStudio.tsx` | bloque «Cubierta del MOOK» + estado + handler |
| `pages/Biblioteca.tsx` | contrato visual 16:9 en el hero de destacada |
| `package.json` | la nueva suite entra en `test:mook` |

---

## I. SIGUIENTE PASO

Confirmación visual a 390 px y en desktop, y **decisión editorial** sobre qué cubierta propia usará
«¿Estás aquí?». Hoy sigue mostrando la cubierta original del libro, que es **correcta y verificada**
en 04F.

El deploy de este código es una unidad aparte: implica reconstruir la imagen de frontend y hacer swap
del bind mount de `server/` con restart escalonado, y **no está autorizado por este GREEN**.
