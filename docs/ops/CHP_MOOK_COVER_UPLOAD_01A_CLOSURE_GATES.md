# CHP-MOOK-COVER-UPLOAD-01A — CIERRE DE GATES PREVIOS AL DEPLOY

**Veredicto:** 🟡 **`YELLOW-COVER-PENDING-DEFINITIVE-ART`**
**Rama:** `chp/mook-contract-00` · **Baseline:** `3003ef4` (local = remoto al abrir la unidad)
**Fecha:** 2026-08-27 · **Cero producción, cero deploy.**

**No se emite `GREEN-MOOK-COVER-UPLOAD-DEPLOY-GATES-CLOSED`.** Tres de las cuatro condiciones se
cumplen; la cuarta —que la cubierta actual no degrade el MOOK— **no se cumple**. Detalle en §5.

---

## 1. ESTADO DE COVER-UPLOAD

El código está **completo y verificado**. Commits de la unidad: `234b5c4`, `3161b5c`, `3003ef4`,
más `b73ac08` de este cierre.

Novedad de esta unidad: además de las 34 aserciones automáticas, el flujo se ejercitó **de extremo a
extremo por la interfaz real**, con un administrador autenticado en el navegador:

| Paso | Resultado |
|---|---|
| Selección de archivo en `Subir → Studio → Editar → Información` | ✅ el selector acepta el archivo |
| Subida | ✅ `imageUrl` se rellena con `/uploads/experience-covers/cubierta_editorial-1787859736462-160860909.png` |
| Nombre con espacio (`cubierta editorial.png`) | ✅ saneado a `cubierta_editorial-…` |
| Aviso al operador | ✅ «Cubierta lista. Guarda Información para aplicarla.» |
| **Store tras la subida** | ✅ `imageUrl` **sin cambiar**, `updatedAt` **sin cambiar**, 1 versión, 0 runs, 0 evidencias |
| Cero overwrite | ✅ conviven en disco el activo previo y el nuevo |

La subida **no muta nada** hasta que el operador guarda. Verificado sobre el store, no deducido.

---

## 2. ESTADO DE `/api/upload`

**No hay hallazgo de seguridad. No se registra `CHP-SEC-UNAUTHENTICATED-GENERIC-UPLOAD-01`.**

### Middleware efectivo, en orden

```
helmet → cors → express.json → httpLogger → metricsMiddleware
      → rateLimit('/api/')  →  guard CSRF('/api/')
      → app.use('/api/upload', requireAdminRole)   ← server.js:621
      → app.post('/api/upload', …)                 ← server.js:2358
```

`requireAdminRole` exige, para métodos mutantes: identidad resuelta (sesión firmada en
`compat`/`enforce`; `x-user-id` en `off`), cuenta activa, y **rol `administrador`** en el padrón.

### Límites y rate limiting

| Capa | Valor |
|---|---|
| nginx (bloque API) | `client_max_body_size 2g` |
| multer | `MAX_UPLOAD_BYTES = 2 GiB` |
| Rate limit | global `/api/`, 1500 req / 15 min, clave `x-user-id` o IP (`trust proxy 1`). **Sin limitador propio de upload** |

Son deliberadamente altos porque `/api/upload` sirve al catálogo editorial (audiolibros, PDF
grandes). Es exactamente la razón por la que la cubierta **no** puede heredarlos.

### Consumidores y roles legítimos

- Backend: `POST /api/upload` y `POST /api/upload/purge` — ambos bajo el mismo `app.use`.
- Frontend: **una** función, `dataService.uploadFile()` (`dataService.ts:671`), con **dos** llamadas,
  ambas en `pages/SubirContenido.tsx` (836 y 2238). Superficie ya exclusiva de administración.
- Roles: hoy **solo `administrador`** sube cualquier tipo de archivo. No hace falta ampliar roles;
  el uploader de cubiertas apunta al mismo rol.

### Test local, archivo mínimo válido, cero sesión

PNG válido de 79 B, servidor real con fixture aislado (`USERS_DB`, `CHP_DATA_DIR` y `UPLOADS_ROOT`
fuera del repositorio). **No se probó nada contra producción.**

| Actor | `SESSION_AUTH_MODE=off` | `compat` (el de PRODUCCIÓN) | ¿Persistió bytes? |
|---|---|---|---|
| **Anónimo, cero cabeceras** | **HTTP 401** · `{"error":"Auth requerida: x-user-id missing"}` | **HTTP 401** · `{"error":"Auth requerida"}` | **NINGUNO** |
| **Lector autenticado** | **HTTP 403** · `{"error":"Acceso denegado: se requiere rol administrador"}` | **HTTP 403** · ídem | **NINGUNO** |
| **Administrador** | HTTP 200 + URL única | HTTP 200 + URL única | sí (1 archivo) |

La comprobación de persistencia recorrió **todo** `UPLOADS_ROOT`, incluido `temp/`. Los rechazos
ocurren **antes de multer**, así que un anónimo no llega a tocar disco.

**Ninguna petición anónima devolvió 2xx ni escribió un archivo ⇒ no se dispara
`STOP-UNAUTHENTICATED-GENERIC-UPLOAD`.**

> **Origen del falso hallazgo.** La primera auditoría leyó la firma de la ruta —que no lleva
> middleware inline— y no el `app.use` con prefijo registrado 1 737 líneas antes. En un archivo de
> ~10 000 líneas, la firma de una ruta no dice nada sobre su autorización: hay que ejercitarla.

---

## 3. DELTA DE GITLEAKS

### El hallazgo, identificado con precisión

| Campo | Valor |
|---|---|
| **Regla** | `chibalete-admin-secret` |
| **Ruta** | `server/__test__/mookCoverUpload01a.test.mjs` |
| **Línea** | 228 |
| **Commit** | `234b5c4da366151dfe7b544164ee0ea71280bf30` |
| **Fingerprint** | `234b5c4da366151dfe7b544164ee0ea71280bf30:server/__test__/mookCoverUpload01a.test.mjs:chibalete-admin-secret:228` |

### Delta medido, no estimado

| Commit | Hallazgos en historial |
|---|---|
| `5e30fb8` (antes de la unidad) | **10** |
| `3003ef4` (con la unidad) | **11** |

**Exactamente uno nuevo, y es el mío.** Los otros diez son históricos ajenos
(`adminSecretFile.test.js`, `ecosystem.config.cjs`, `test_persistence_flow.js`, `test_user_flow.js`,
`simulate_novelty.js`, `verify_pipeline.cjs`, `studio-editor-bi/assets/…`).

### Ningún secreto real fue expuesto

- El valor es una cadena de fixture inventada para el test; **nunca fue una credencial**.
- El secreto real es **file-only 0400 en el VPS** y se inyecta por entorno, jamás por código.
- Ya no está en el árbol —eliminado en `3161b5c`— y no aparece en ningún otro archivo del repositorio.
- El gate duro **`gitleaks-head` ya estaba en verde** sin necesidad de esta entrada.

### Neutralización: el mecanismo más estrecho posible

`.gitleaksignore` con **un único fingerprint exacto**. Sin regexes y sin allowlist de rutas. Un
fingerprint ata commit + archivo + regla + línea: la misma cadena en otro archivo, otra línea u otro
commit **vuelve a disparar**. **No se reescribió historia ni se hizo force-push.**

### Demostración con gitleaks 8.21.2 real, la misma versión que usa CI

| Comprobación | Resultado |
|---|---|
| Historial con el ignore | **10 hallazgos** — exactamente el baseline previo |
| El propio `.gitleaksignore` + `server/` | **`no leaks found`, exit 0** |
| `gitleaks-head` en CI | ✅ **success** |

> **Trampa que casi introduzco.** La primera versión del comentario del `.gitleaksignore`
> reproducía la sintaxis de asignación que dispara la regla, creando un hallazgo **nuevo** en el
> árbol de trabajo y rompiendo el gate duro. El archivo que silencia un hallazgo no puede ser la
> causa del siguiente. Reescrito y verificado.

**No se dispara `STOP-NEW-GITLEAKS-HISTORY-DELTA`.**

> Contexto: `gitleaks-history` es un **reporte no bloqueante** por diseño del propio workflow; el
> gate duro es `gitleaks-head`.

---

## 4. QA VISUAL

Build local real, administrador autenticado en navegador. El viewport se fijó con **iframes de
ancho exacto** —viewports reales para layout y media queries— porque la ventana de Chrome estaba
maximizada e ignoraba el redimensionado.

**Evidencia visual guardada** en `…/scratchpad/gateC/evidencia/`:
`01-desktop-1440-hero-cubierta-vertical-real.jpg` · `02-desktop-1440-hero-cubierta-1600x900.jpg` ·
`03-movil-390-hero-cubierta-1600x900.jpg` · `04-desktop-1440-studio-informacion.jpg` ·
`05-movil-390-studio-informacion.jpg`.

### Desktop — viewport 1440 × 880

| Comprobación | Resultado |
|---|---|
| Formulario Información completo | ✅ título, descripción, objetivo, **Cubierta del MOOK**, duración, audiencia |
| Previsualización 16:9 | ✅ **446 × 250** (ratio 1.784), `object-fit: cover`, `object-position: 50% 50%` |
| Selector utilizable | ✅ botón «Subir nueva cubierta» activo |
| Campo URL utilizable | ✅ dentro del `<details>`, 308 px, editable, con valor |
| Hero de Biblioteca 16:9 | ✅ **1088 × 612** = ratio **1.7778** exacto |
| Deformación | ✅ ninguna — `cover` preserva proporción |
| Overflow / scroll horizontal | ✅ ninguno |
| Altura visual | ⚠️ 612 px. Razonable como *hero*, pero ocupa el 70 % del pliegue |

### Móvil — viewport 390 × 844

| Comprobación | Resultado |
|---|---|
| Selector accesible | ✅ botón 168 × 36, dentro del viewport |
| Mensajes legibles | ✅ ayuda completa en tres líneas, sin truncar |
| Previsualización | ✅ **306 × 171** (ratio 1.787) |
| Hero | ✅ **358 × 201** (ratio 1.7778) |
| Scroll horizontal | ✅ **ninguno** — `scrollWidth 390 == clientWidth 390` |
| Solapamiento de botones | ✅ ninguno (comprobado por geometría, no a ojo) |

### Caso 1 — cubierta vertical actual del libro

Se descargó **el activo real de producción** (solo lectura): `1241 × 2126`, ratio **0.584**.

| Geometría | Caja | Ratio | % de alto visible |
|---|---|---|---|
| **Antes** (`h-44`, 176 px fijos) | 1088 × 176 | **6.18 : 1** | **9.4 %** |
| **Ahora** (16:9) | 1088 × 612 | 1.78 : 1 | **32.8 %** |

**El cambio mejora 3,5×.** No es una regresión: es la mejor recuperación posible de una cubierta
vertical dentro de un marco horizontal.

**Pero el resultado sigue sin ser aceptable.** En la captura se ve una franja central del arte y
**el título del libro queda fuera del encuadre**: lo que el participante lee en el hero no es el
título de la obra. Con un original de ratio 0.584 en un marco 16:9, `object-fit: cover` **debe**
descartar dos tercios de la altura; no hay CSS que lo arregle sin deformar la imagen.

### Caso 2 — fixture válido 1600 × 900

| Viewport | Caja | Ratio | % visible | Scroll horizontal |
|---|---|---|---|---|
| 1440 | 1088 × 612 | 1.7778 | **100 %** | no |
| 390 | 358 × 201 | 1.7778 | **100 %** | no |

**Cero recorte en ambos viewports**, con la zona segura 1280 × 720 íntegra. El contrato funciona
exactamente como se diseñó.

---

## 5. AUTORIZACIÓN O BLOQUEO DE DEPLOY

**🔴 BLOQUEADO.** No por el código, sino por el activo.

| Condición del GREEN | Estado |
|---|---|
| `/api/upload` no permite persistencia anónima | ✅ **cumplida** — 401 y cero bytes en ambos modos |
| gitleaks no incorpora un hallazgo nuevo | ✅ **cumplida** — historial de vuelta a 10, `head` verde |
| desktop y 390 px pasan visualmente | ✅ **cumplida** — geometría exacta, sin overflow ni solapamiento |
| **la cubierta actual no degrada el MOOK** | ❌ **NO cumplida** |

Se emite **`YELLOW-COVER-PENDING-DEFINITIVE-ART`**: el mecanismo está listo para desplegar en
cuanto exista una cubierta 16:9. Desplegar **hoy** cambiaría el hero productivo de un recorte del
9,4 % a uno del 32,8 % —mejor, pero seguiría sin mostrar el título del libro—.

**Lo que desbloquea el deploy:** una cubierta propia **1600 × 900** para «¿Estás aquí?», con títulos
y elementos importantes dentro de los 1280 × 720 centrales. Es una **decisión editorial**, no técnica,
y el Studio ya tiene todo lo necesario para cargarla.

No se improvisó CSS. No se subió nada a producción. La cubierta productiva y `portada_url` del libro
siguen intactas, y el MOOK sigue publicado y sano.

---

## 6. ENTORNO DE LA QA — NOTAS ÚTILES

- La ventana de Chrome maximizada **ignora el redimensionado**; los **iframes de ancho exacto** son
  la vía fiable para fijar viewport.
- El frontend es **cookie-only** desde M1-A, y la cookie **no puede emitirse en Windows**: el lector
  de la clave de firma es un guard POSIX (`O_NOFOLLOW`, dueño, modo 0400) que devuelve `READ_FAILED`
  fuera de Linux. Se usó el workaround conocido: **proxy local que inyecta `x-user-id`**
  (`navegador → vite:5173 → proxy:3000 → backend:3001`). Solo desarrollo; nada de esto se versiona.
- Todo el fixture vivió fuera del repositorio. `git status` quedó limpio salvo las dos carpetas
  editoriales untracked de siempre.
