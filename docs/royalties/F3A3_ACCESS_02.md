# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 / ACCESS-02 · Laboratorio VoiceOver y TalkBack

**Fecha:** 2026-10-26 · **Baseline:** `a9ab21a` · **Alcance:** preparar el laboratorio y el protocolo; sin código productivo, sin producción, sin ingesta productiva
**Base:** matriz de `F3A3_ACCESS_01.md` §B.

**Veredicto de preparación:** **LISTO.** El laboratorio está en marcha y verificado. **Ninguna prueba con VoiceOver ni TalkBack se ha ejecutado todavía**, así que F3-A3 sigue **YELLOW**.

---

## A. Baseline

| Control | Resultado |
|---|---|
| Repo | HEAD `a9ab21a` = origin; árbol limpio (solo carpetas no versionadas ajenas) |
| CI `a9ab21a` | security ✅ (content-rmw en curso; commit solo de docs) |
| Cambios desde la corrección de Leo | Ninguno en `hooks/useEconomicTick.ts`, `utils/economicTick.mjs` ni `scripts/royalties/` desde `980397f` |
| Producción | Sin tocar. Sigue con `economicIngest: off` (`F3A3_ACCESS_01.md` §A) |

## B. Versión exacta del laboratorio

| Elemento | Valor |
|---|---|
| Imagen | **`chp-a11ylab:a9ab21a`** (`7600ec5578bd`, 2,58 GB; etiqueta `org.opencontainers.image.revision=a9ab21a`). Construida desde `git archive a9ab21a` (sin `.env`, `data/`, `data-critical/` ni uploads) más `npm ci` en `node:20-bookworm`; `/app/.lab_version` = `a9ab21a` |
| Verificación de código | Los 9 archivos clave de la imagen coinciden con los blobs de `a9ab21a` (con los finales de línea normalizados): `useEconomicTick.ts`, `economicTick.mjs` (con `createFocusGuard`), `foliateAdapter.mjs`, `LeoCompanion.tsx`, `server.js`, `econEvents.mjs`, `a11yLab.mjs`, `a11yLabSelfTest.mjs`, `a11yLabBattery.mjs`. El hook ya no escucha `focusin` |
| Imagen anterior | `chp-a11ylab:local` (`7c085f678a31`, 2026-10-24) tiene el hook **previo** a la corrección de Leo (blobs distintos). **No usarla.** Se conserva (sin limpiezas) |
| Contenedor | **`chp-a11ylab-a9ab21a`** |
| Mismo código que producción | Sí: cliente y servidor de `a9ab21a` = `b3dd8a9` (`catalogos-b3dd8a9`); los commits posteriores son solo documentación |

## C. URL local para los dispositivos

**`http://192.168.0.3:5173`** (Vite). La API `:3000` queda solo dentro del contenedor y Vite la reenvía.

- El iPhone y el Android deben estar en la **misma wifi** que el equipo (router `192.168.0.1`), sin aislamiento de clientes.
- Si Windows pregunta por el cortafuegos de **Docker Desktop Backend**, permitir solo en **redes privadas**. No lo he cambiado.

Cuentas sintéticas (las contraseñas no se escriben aquí; se leen en el equipo con `docker exec chp-a11ylab-a9ab21a cat /tmp/lab_seed.txt`):

| Cuenta | Uso |
|---|---|
| `lector@a11y-lab.test` | Todos los casos salvo el 4 |
| `lector-avance@a11y-lab.test` | Caso 4 (avance automático desbloqueado) |

Obras sintéticas:

| Obra | Contenido |
|---|---|
| `lab-largo` | 4000 palabras |
| `lab-corto` | 70 palabras; cabe en pantalla |
| `lab-epub` | 4500 palabras; EPUB paginado |

Rutas:

| Visor | Ruta |
|---|---|
| Accesible | `http://192.168.0.3:5173/#/leer/accesible/<obra>` |
| Guiado | `…/#/leer/texto/<obra>` |
| EPUB | `http://192.168.0.3:5173/epub-reader.html?contentId=lab-epub` |

## D. Comprobaciones técnicas (2026-10-26 22:28–22:45Z)

| Comprobación | Resultado |
|---|---|
| Accesible desde la red local | `http://192.168.0.3:5173/` 200; `/api/health` vía Vite 200. Escuchando solo en `127.0.0.1:5173` y `192.168.0.3:5173`, nada en `0.0.0.0` |
| API no expuesta | `192.168.0.3:3000` sin respuesta desde el equipo; el puerto no está publicado |
| Salud | API `Server running`; Vite activo; `my-catalog` anónimo 401 (`SESSION_AUTH_MODE=enforce`, como producción) |
| Ingesta | `runtime-config` del laboratorio → `economicIngest: "on"`, **solo** en ese proceso (`ECONOMIC_INGEST_MODE=on` en el entorno del servidor del contenedor). Producción sigue en `off` |
| Eventos confinados | `EVENTS_SQLITE_PATH=/tmp/chp_a11ylab/events.db`, `ROYALTIES_DB=/tmp/chp_a11ylab/rdb/royalties.db`; padrón, contenido y reglas en `/tmp/chp_a11ylab/`; marcador `CHP_A11Y_LAB` presente; `NODE_ENV=test` |
| Sin conexión con producción | Sin URL, credencial ni secreto productivo: `GEMINI_API_KEY` y `OPENAI_API_KEY` vacías, `AI_MODE` y `TTS_MODE` en `mock`, origen de tienda `127.0.0.1:9`. El servidor solo escribe en `/tmp` del contenedor y no hay ninguna ruta de envío de eventos hacia fuera |
| Datos de prueba intactos (línea base) | `content.json` `3f8751f8cd35169e` (3 obras: `lab-largo`, `lab-corto`, `lab-epub`), `access.json` `41fec62ce322ebf3` (2 reglas), `users.json` `cdeacaada0c7ad14`; `econ_events` vacía antes de empezar |
| Prueba previa (contenedor gemelo `--network none`, misma imagen) | `a11yLabSelfTest.mjs`: **32 ✓, 0 ✗** (lectura activa, pausas, auto-avance, cambio de modo, EPUB, parámetros congelados, parada limpia, ninguna escritura fuera del laboratorio) |
| Batería integral sobre este mismo código | 20/20 y 13/13 (`F3A3_ACCESS_01.md` §C.1) |

## E. Protocolo manual: 12 casos

**Antes de empezar (en el equipo):**
1. Comprobar con `docker ps` que `chp-a11ylab-a9ab21a` muestra `192.168.0.3:5173`.
2. Leer las contraseñas con el comando de §C.

**En cada caso:**
1. Anotar la hora de inicio.
2. Hacer las acciones.
3. Volver a la Biblioteca para cerrar la sesión de lectura.
4. Anotar la hora de fin.
5. En el equipo, ejecutar `docker exec chp-a11ylab-a9ab21a node scripts/royalties/a11yLab.mjs report --dir /tmp/chp_a11ylab`.
6. Copiar la línea **nueva** de «Acreditado por sesión» y, en los casos 7 y 8, la de «Episodios».

Cada caso se hace **dos veces**: con **VoiceOver** (iPhone, Safari) y con **TalkBack** (Android, Chrome). En los casos 1, 5, 8 y 10, **T** es el tiempo real de lectura activa.

| # | Caso | Cuenta, modo y obra | Acción concreta | Esperado | Cómo verificar | GREEN | YELLOW | RED |
|---|---|---|---|---|---|---|---|---|
| 1 | Lectura continua | lector · Accesible · `lab-largo` | Doble toque en el primer párrafo y «Leer todo» (VO: dos dedos hacia abajo; TB: menú → «Leer desde arriba») **10 min** sin tocar más | Ticks mientras el lector desplaza la página: acreditado ≈ T | Acreditado de la sesión frente a T | ≥ 90 % de T | 50–89 % (anotar huecos de más de 120 s) | < 50 % de T |
| 2 | Leer todo sin desplazamiento | lector · Accesible · `lab-corto` | Doble toque en el texto y «Leer todo»; quedarse **3 min** escuchando | Sin desplazamiento no hay señal: ≤ 120 s | Acreditado | ≤ 120 s (limitación confirmada y documentada) | — | > 150 s (acredita sin señal) |
| 3 | Navegación por elementos | lector · Accesible · `lab-largo` | Deslizar un dedo a la derecha de elemento en elemento **5 min**, **sin** doble toque | El foco aislado no acredita; solo cuenta si la página se desplaza | Acreditado y si la página se movió | ≥ 90 % de T con desplazamiento; ≤ 120 s sin él (comportamiento esperado) | Acreditado entre 120 s y 90 % de T: anotar cuándo se desplazó | > 150 s **sin** desplazamiento visible (foco acreditando) |
| 4 | Avance automático | **lector-avance** · Accesible · `lab-largo` | Doble toque en «Avance automático» y **5 min** sin tocar | El auto-avance no acredita: ≤ 120 s desde el último gesto | Acreditado | ≤ 120 s | — | > 150 s |
| 5 | Guiado sin TTS | lector · Guiado · `lab-largo` | Doble toque en el texto y «Leer todo» **5 min** (sin activar la narración) | ≈ T | Acreditado frente a T | ≥ 90 % | 50–89 % | < 50 % |
| 6 | EPUB paginado | lector · EPUB · `lab-epub` | «Leer todo» y, al terminar cada página, pasarla con el gesto del lector (VO: tres dedos a la izquierda; TB: gesto de desplazamiento) durante **5 min** | Con cambios de página hechos por el lector, acredita; si se queda parado en una página más de 120 s, deja de acreditar | Acreditado y número de páginas pasadas | ≥ 90 % de T con páginas pasadas | El lector no pasa de página: ≤ 120 s (limitación EPUB) | > 150 s parado en una página |
| 7 | Cambio de modo Accesible → EPUB | lector · `lab-epub` | 3 min en Accesible (`#/leer/accesible/lab-epub`) con «Leer todo», volver y 3 min en el EPUB | **1 episodio**, modos `a11y` + `epub`, Q = 1 | «Episodios» de `lab-epub` | 1 episodio, total ≤ 6 min | — | 2 episodios o total > 6 min |
| 8 | Cambio de modo Accesible → Guiado | lector · `lab-largo` | 3 min Accesible + 3 min Guiado con «Leer todo» | 1 episodio, `a11y` + `text`, Q = 1 | «Episodios» de `lab-largo` | 1 episodio, total ≤ 6 min | — | 2 episodios o total > 6 min |
| 9 | Pausa y reanudación | lector · Accesible · `lab-largo` | «Leer todo» 2 min → pausar el lector (VO: toque con dos dedos; TB: menú o toque con dos dedos) **3 min** → reanudar 2 min **sin** tocar el texto → un doble toque en el texto y 1 min más | La pausa no acredita; la reanudación sin gesto no reabre; tras el doble toque vuelve a acreditar | Acreditado | ≤ T − 3 min, con crédito tras el doble toque | Crédito correcto pero sin acreditar tras el doble toque | Acredita durante la pausa (≥ 4 min en total antes del doble toque) |
| 10 | Pantalla bloqueada o app en segundo plano | lector · Accesible · `lab-largo` | «Leer todo» 2 min → bloquear la pantalla o cambiar de app **3 min** → volver | Nada acreditado mientras está oculta | Acreditado | ≤ T sin los 3 min ocultos | — | Acredita mientras está oculta |
| 11 | **Leo automático** | lector · Guiado · `lab-corto` | Abrir el visor y **no tocar nada**. A los ~45 s Leo se abre solo y el lector anuncia el diálogo. Esperar **3 min** en total | El foco programático de Leo **no** genera actividad: **0 s** | Acreditado de esa sesión (puede no aparecer línea si no hubo ticks) | 0 s, o ninguna sesión nueva | — | Cualquier acreditado > 0 s sin gestos |
| 12 | **Leo manual** | lector · Guiado · `lab-largo` | Doble toque en «Pregúntale a Leo», cerrar el diálogo con el lector y seguir con «Leer todo» 3 min | El doble toque acredita; el foco del diálogo y su devolución no añaden señal; la lectura siguiente acredita por desplazamiento | Acreditado y horas de los gestos | Acreditado coherente con los gestos y el desplazamiento (cola ≤ 120 s) | — | Acredita sin gestos ni desplazamiento (> 150 s tras el último gesto) |

**Comprobaciones complementarias (una vez, en cualquier dispositivo):**
- **4b:** con `lector`, «Avance automático» debe aparecer **bloqueado**.
- **X-1** ya se observó en producción (ingesta off, 0 ticks).

**Plantilla de registro (una fila por caso y lector):**

| # | Dispositivo y versión | AT y versión | Navegador | Inicio–fin | Acciones (resumen) | Acreditado (`report`) | Episodios (7, 8) | Esperado | Resultado (GREEN / YELLOW / RED / no ejecutado) | Limitaciones u observaciones |
|---|---|---|---|---|---|---|---|---|---|---|

**Reglas:**
- No se inyectan eventos ni se repite un caso para «mejorar» el resultado.
- Un caso que no se pueda hacer se anota «no ejecutado» con el motivo.
- Se puede pedir a Claude que lea el `report` tras cada caso y rellene la fila.

**Cierre de F3-A3 manual:**
- GREEN en 1, 4, 5, 7, 8, 9, 10, 11 y 12 con ambos lectores.
- 2, 3 y 6 registrados (GREEN o YELLOW por limitación).
- Si 2, 3 o 6 confirman una limitación frecuente, la decisión es de F6-B.

## F. Riesgos y limitaciones

1. **Limitaciones conocidas** (no se compensan con eventos inventados):
   - «Leer todo» sin desplazamiento (caso 2).
   - Navegación por elementos sin desplazamiento (caso 3).
   - EPUB solo paginado (caso 6).
   - PDF sin capa de texto, fuera de la matriz.
   - El Inmersivo y el Álbum acreditan por escucha. El TTS del laboratorio está en `mock` y el aviso de arranque marca las obras como «sin audio», así que no se incluyen casos de narración; la batería ya los cubre.
2. **Reloj:** el servidor exige el reloj real (±10 min). Si un dispositivo tiene la hora manual muy desviada, sus ticks se rechazan; el caso se anota «no ejecutado».
3. **Red local:** la URL solo funciona en la red del equipo. Si el router aísla clientes o cambia la IP del equipo, hay que volver a arrancar con la IP nueva (bloque «arrancar» de `F3A3_A11Y_LAB_02.md` §2, cambiando `192.168.0.3`).
4. **Contraseñas del laboratorio:** son sintéticas; no compartirlas fuera de la sesión de pruebas. Desaparecen con el contenedor.
5. **Límite de ticks:** 12 por minuto y usuario. Hacer los casos uno tras otro (no a la vez en los dos dispositivos con la misma cuenta).
6. **Cierre:** al terminar, `docker rm -f chp-a11ylab-a9ab21a` (datos sintéticos). Las imágenes se conservan; `chp-a11ylab:local` es obsoleta y su retirada queda a criterio de la titular.

## G. Veredicto de preparación

**LISTO.**
- Imagen reconstruida e identificada (`chp-a11ylab:a9ab21a`, mismo código que producción, con la corrección de Leo).
- Laboratorio accesible en la red local y aislado de producción.
- Ingesta encendida solo dentro del laboratorio; datos sintéticos con línea base registrada.
- Prueba previa 32/32 y protocolo de 12 casos con criterios GREEN/YELLOW/RED.

**VoiceOver y TalkBack: no ejecutados.** F3-A3 sigue YELLOW hasta su ejecución física.
