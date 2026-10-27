# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 / ACCESS-03 · Ejecución asistida VoiceOver y TalkBack

**Plan:** `docs/royalties/PLAN_INTEGRADO_V1_4.md` · **Protocolo:** `docs/royalties/F3A3_ACCESS_02.md` §E · **Baseline:** `101893b`
**Laboratorio:** contenedor `chp-a11ylab-a9ab21a`, imagen `chp-a11ylab:a9ab21a` · **URL:** `http://192.168.0.3:5173`

Informe incremental: una fila por caso, escrita justo después de leer el `report`. Sin credenciales, tokens ni datos de sesión.

## 1. Preflight (2026-10-27 00:09Z)

| Control | Resultado |
|---|---|
| HEAD = remoto | `101893b` = `origin/chp/epub-mainfile-r1-release` |
| CI de `101893b` | `security` ✅, `content-rmw` ✅ |
| Contenedor | `chp-a11ylab-a9ab21a` en marcha, imagen `7600ec5578bd`, publicado solo en `127.0.0.1:5173` y `192.168.0.3:5173` |
| Corrección de Leo `980397f` | ancestro de HEAD; `hooks/useEconomicTick.ts` y `utils/economicTick.mjs` del contenedor idénticos a los blobs de `a9ab21a` (normalizando CRLF) |
| Red local | front 200, `/api/health` 200 vía `192.168.0.3:5173`; `runtime-config` → `economicIngest: "on"` (solo laboratorio) |
| Aislamiento | proceso del servidor: `USERS_DB` y almacenes en `/tmp/chp_a11ylab`, claves de IA vacías, `AI_MODE`/`TTS_MODE=mock`, Woo `127.0.0.1:9`; no existen `/app/data` ni `/app/data-critical` |
| Datos sintéticos | `content.json` `3f8751f8cd35169e`, `access.json` `41fec62ce322ebf3`, `users.json` `cdeacaada0c7ad14` (= línea base de ACCESS-02) |
| Eventos | `econ_events` vacía al empezar |
| Producción | sin tocar |

No se repitió la autoprueba (32/32 en ACCESS-02, mismo contenedor e imagen, sin cambios de código).

## 2. Matriz de resultados

T = tiempo real de lectura activa. Resultado según los criterios de `F3A3_ACCESS_02.md` §E.

### VoiceOver (iOS, Safari)

| # | Caso | Dispositivo / AT | Obra y modo | Inicio–fin (UTC) | Acciones | Ticks / sesión | Acreditado | Descartado y motivo | Episodios | Resultado |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Lectura continua | | `lab-largo` · Accesible | | | | | | | pendiente |
| 2 | «Leer todo» sin desplazamiento | | `lab-corto` · Accesible | | | | | | | pendiente |
| 3 | Navegación por elementos | | `lab-largo` · Accesible | | | | | | | pendiente |
| 4 | Avance automático | | `lab-largo` · Accesible (lector-avance) | | | | | | | pendiente |
| 5 | Guiado sin narración | | `lab-largo` · Guiado | | | | | | | pendiente |
| 6 | EPUB paginado | | `lab-epub` · EPUB | | | | | | | pendiente |
| 7 | Accesible → EPUB | | `lab-epub` | | | | | | | pendiente |
| 8 | Accesible → Guiado | | `lab-largo` | | | | | | | pendiente |
| 9 | Pausa y reanudación | | `lab-largo` · Accesible | | | | | | | pendiente |
| 10 | Pantalla bloqueada / segundo plano | | `lab-largo` · Accesible | | | | | | | pendiente |
| 11 | Leo automático | | | | | | | | | pendiente |
| 12 | Leo manual | | `lab-largo` · Guiado | | | | | | | pendiente |

### TalkBack (Android, Chrome)

| # | Caso | Dispositivo / AT | Obra y modo | Inicio–fin (UTC) | Acciones | Ticks / sesión | Acreditado | Descartado y motivo | Episodios | Resultado |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Lectura continua | | `lab-largo` · Accesible | | | | | | | pendiente |
| 2 | «Leer todo» sin desplazamiento | | `lab-corto` · Accesible | | | | | | | pendiente |
| 3 | Navegación por elementos | | `lab-largo` · Accesible | | | | | | | pendiente |
| 4 | Avance automático | | `lab-largo` · Accesible (lector-avance) | | | | | | | pendiente |
| 5 | Guiado sin narración | | `lab-largo` · Guiado | | | | | | | pendiente |
| 6 | EPUB paginado | | `lab-epub` · EPUB | | | | | | | pendiente |
| 7 | Accesible → EPUB | | `lab-epub` | | | | | | | pendiente |
| 8 | Accesible → Guiado | | `lab-largo` | | | | | | | pendiente |
| 9 | Pausa y reanudación | | `lab-largo` · Accesible | | | | | | | pendiente |
| 10 | Pantalla bloqueada / segundo plano | | `lab-largo` · Accesible | | | | | | | pendiente |
| 11 | Leo automático | | | | | | | | | pendiente |
| 12 | Leo manual | | `lab-largo` · Guiado | | | | | | | pendiente |

## 3. Evidencia por caso

(se completa después de cada caso)

### Incidencia L-1 · La app no arranca por `http://192.168.0.3` (2026-10-27 00:15Z)

- **Síntoma:** en el iPhone la página no carga. La conexión sí llega al equipo (`192.168.0.4` → `192.168.0.3:5173`), pero el servidor no recibe ninguna llamada a la API.
- **Causa (reproducida en Chrome de escritorio con la misma URL):** `TypeError: crypto.randomUUID is not a function` en `services/dataService.ts:145` (`currentSessionId = crypto.randomUUID()`), al crear el servicio de datos. `crypto.randomUUID` solo existe en contexto seguro (HTTPS o `localhost`); `http://192.168.0.3` no lo es (`isSecureContext=false`). La app queda en blanco.
- **Producción no está afectada:** se sirve por HTTPS. Es un defecto del laboratorio por LAN, no reproducible en producción.
- **Medición económica:** no usa `crypto.randomUUID` (`hooks/useEconomicTick.ts`, `utils/economicTick.mjs`).
- **Caso 1 VoiceOver:** no iniciado. No se generaron eventos (`econ_events` vacía).
- ACCESS-02 §D comprobó la red con `curl` (sin ejecutar JavaScript), por lo que no detectó el fallo.
- **Decisión de Dirección (00:20Z):** complemento solo en el laboratorio. Se insertó en `/app/index.html` **del contenedor** (no en el repositorio) un `<script>` que, si falta `crypto.randomUUID`, genera un UUID v4 con `crypto.getRandomValues`. Original guardado en el contenedor como `/tmp/index.html.orig` (md5 `5201d9a8…` → `259a9ec3…`).
- **Verificación:** Chrome por `http://192.168.0.3:5173` → la app arranca (pantalla «Soy Lector / Soy Mediador…»), sin errores de consola; `isSecureContext` sigue en `false`. `econ_events` sigue vacía.
- **Diferencia con producción:** solo esa línea, inerte en producción (HTTPS tiene `randomUUID` nativo). No toca la medición económica.
- **Pendiente para después de F3-A3 (no corregido aquí):** `dataService.ts:145` rompe la app fuera de contexto seguro. Producción no se ve afectada; queda como deuda menor.

### Intento previo al caso 1 VoiceOver · no válido (00:23:57–00:26:08Z)

- Sesión `01M5XBVK…MT9`, `lab-largo`, Accesible: 9 ticks, 9 con señal; acreditado 105 s (episodio `lab-largo` 105 s, Q = 1).
- Dirección seleccionó el párrafo, pero VoiceOver no reconoció el gesto «Leer todo» (dos dedos hacia abajo). No hubo lectura continua: **no cuenta como caso 1**.
- Los 105 s se deben a los gestos reales de exploración y quedan en la base del laboratorio, sin borrarse. El caso 1 se evaluará solo con su propia sesión nueva.

## LAB-FIX-01 · «Algo salió mal» en la ficha del libro (2026-10-27 00:26–00:49Z)

**Síntoma (iPhone, VoiceOver):** `TypeError: undefined is not an object (evaluating 'content.metricas.calificacion_promedio')` y la pantalla «Algo salió mal».

**A. Causa raíz (demostrada):** reproducida en Chrome por `localhost:5173` con la cuenta sintética: `/#/contenido/lab-largo` → «Algo salió mal», `TypeError … reading 'calificacion_promedio'` en `PaginaDetalleLibro`. Las 3 fichas del laboratorio no tenían `metricas`. No es un fallo de VoiceOver: se reproduce sin lector de pantalla.

**B. Archivo y línea:**
- El fallo se dispara en `pages/PaginaDetalleLibro.tsx:271` (y en la línea 273, `veces_leido`), que leen `content.metricas` sin protección.
- El defecto está en `scripts/royalties/a11yLab.mjs` (seed). Escribe `content.json` directamente y se salta `applyContentDefaults` (`server/server.js:4097`, invocado en `POST /api/content`, `:4410`), que garantiza `metricas` y `publico_objetivo` en toda ficha creada por la API.

**¿Puede ocurrir en producción?** No por esta vía:
- `types/index.ts` declara `metricas` obligatorio.
- El servidor lo rellena en todo alta o edición desde 3C.3B-R1.
- F1-C/CATÁLOGOS-02 dejó constancia de que todas las fichas reales lo tienen.
- No se hizo una lectura de producción en esta unidad: el permiso de lectura productiva fue denegado.

Queda como **mejora opcional, no urgente**: `content.metricas?.…` en `PaginaDetalleLibro.tsx`, para fichas antiguas o escritas fuera de la API. Es decisión de Dirección y no se aplica aquí.

**C. Corrección mínima (solo laboratorio):**
- `a11yLab.mjs`: las fichas sintéticas llevan los **mismos defaults del servidor**, `publico_objetivo: 'todos'` y `metricas: { veces_leido: 0, calificacion_promedio: 0 }`. No se inventan calificaciones ni lecturas: son los ceros del default.
- `a11yLabSelfTest.mjs`: nueva comprobación de regresión, «fichas sintéticas con los defaults del servidor».
- Laboratorio en marcha (sin reconstruir, para conservar la evidencia del intento inválido):
  - scripts copiados al contenedor (md5 idénticos al repositorio);
  - `content.json` de las 3 obras completado **solo en los campos ausentes**, con escritura atómica;
  - original en el contenedor como `/tmp/content.json.pre-labfix` (`3f8751f8cd35169e` → `65ecdab8b76c73da`).
- No se tocaron eventos, usuarios, reglas, la instrumentación, las fórmulas ni la lógica de sesiones.

**D. Pruebas:**

| Prueba | Resultado |
|---|---|
| Chrome `localhost:5173`: Biblioteca, fichas de `lab-largo` / `lab-corto` / `lab-epub` (★ 0 · 0 lecturas), Accesible, Guiado, EPUB e Inicio | Sin errores de consola |
| Apertura y cierre sin gestos (00:32–00:34Z) | **0 ticks**: no se crea sesión económica sin entrada humana |
| `a11yLabSelfTest` con los scripts nuevos (contenedor gemelo `--network none`) | **33/33** (32 previas + la nueva) |
| `economicTick` (incluye ECON-FOCUS-05: «Leo se abre solo y enfoca: 0 ticks») | 120/120 |
| `econEvents` | 67/67 |
| `econIngestHttp`, `economicEpisodes`, `accessB2cPreservation` | rc 0 |
| `publishers*`, `rights*`, `commercialClass`, `AdminEditoriales` | verdes |
| `commercialClassHttp` | intermitente: 1 de 4 ejecuciones falla «hora del servidor, no del cliente» (`since >= t0`). Es un test de F2-B (`106f8f2`) sin relación con el cambio; anotado, no corregido |

**E. Versión del laboratorio corregido:**
- Imagen `chp-a11ylab:a9ab21a` (`7600ec5578bd`), contenedor `chp-a11ylab-a9ab21a`.
- Más `scripts/royalties/a11yLab.mjs` y `a11yLabSelfTest.mjs` del commit de esta unidad.
- Más el complemento L-1 (`crypto.randomUUID`) en `index.html`.
- Más los defaults completados en `content.json`.
- El código servido del producto sigue siendo el de `a9ab21a`.

**Sesiones inválidas (se conservan, no cuentan para ningún caso):** las tres sesiones del iPhone entre las 00:23:57 y las 00:26:39Z, sobre `lab-largo` en modo Accesible: `01M5XBVK…MT9` (105 s), `01M5XC04…DEA` (15 s) y `01M5XC0Z…Y9Z` (0 s). Episodio `lab-largo` de 120 s, Q = 1. Los casos se evalúan solo con sesiones iniciadas después de las **00:49Z**.

**F. Corrección productiva:** no necesaria para continuar. Queda opcional el acceso seguro en `PaginaDetalleLibro.tsx` (además de `dataService.ts:145` de L-1).

**G. Veredicto: READY.** La interfaz es estable en Chrome por la red local.
