# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 / A11Y-LAB-03 · EPUB sintético, auto-avance y pruebas en dispositivo

**Fecha:** 2026-10-24 · **Base:** `c2484a1` · **Laboratorio:** `scripts/royalties/a11yLab.mjs` · **Prueba previa:** `scripts/royalties/a11yLabSelfTest.mjs` · **Guía de base:** `F3A3_A11Y_LAB_02.md`
**Modo:** local. Sin despliegue, sin producción y sin datos reales.
**Veredicto:** **YELLOW**. Laboratorio completo y verificado; acceso preparado en `http://192.168.0.3:5173`. **Las pruebas con VoiceOver y TalkBack no se han ejecutado** y no se declaran superadas.

## 1. Base y CI

- HEAD `c2484a1`, sincronizado con el remoto, árbol limpio.
- CI de `c2484a1` (solo documentación): `security` ✓; **`content-rmw` ✗** (`40132147346`). El mismo código pasó en `7e22057`. Es la **tercera** intermitencia de `content-rmw` del día (`dc22e19` y `44bc915`, ambas verdes sin cambios después), ya registrada como incidencia abierta en `SEGUIMIENTO_PLAN_V1_1.md`.
- `chp-a11ylab` seguía aislado: Vite solo en `127.0.0.1:5173` y `192.168.0.3:5173`; API sin publicar; datos en `/tmp/chp_a11ylab` del contenedor.
- La IP del equipo sigue siendo **192.168.0.3** (Ethernet, red `192.168.0.0/24`), comprobado antes de usarla.

## 2. EPUB sintético (`lab-epub`)

- **Generación:** `seed` crea un EPUB 3 de 3 capítulos con el generador de texto del laboratorio y el empaquetador que ya usan las pruebas (`server/__test__/helpers/epubFixture.mjs`, solo `zlib`, sin dependencias nuevas). No contiene ningún recurso editorial.
- **Ubicación:** `/uploads/lab-epub/lab-epub.epub` del laboratorio, la ruta que exige `GET /api/content/:id/epub` (el propietario de la ruta debe ser la propia obra). La obra trae además `texto_plano_url` con el mismo texto, para leerla en Accesible o Guiado y comprobar el cambio de modo sobre una sola obra.
- Las obras de texto pasan también a `/uploads/<id>/`.

**Hallazgo (sin cambio de producto):** el lector EPUB de Chibalete+ **solo pagina**. foliate entra en modo continuo únicamente con `flow="scrolled"`, y ese atributo solo lo pone su lector de ejemplo (`vendor/foliate-js/reader.js`), que el producto no usa. Por tanto:
- la **lectura continua en EPUB no se puede probar en el producto actual**, ni en el laboratorio ni en dispositivo;
- la regla de desplazamiento para EPUB de A11Y-FIX-01 (los `relocate` con motivo `scroll`) es **correcta pero hoy inalcanzable**. Se activará sola si algún día se añade un modo continuo.

Añadir un selector de modo continuo sería un cambio de producto, fuera del alcance de esta unidad. Queda como decisión (§7).

## 3. Auto-avance sintético (`lector-avance@a11y-lab.test`)

- `/api/reading/my-effective-time` calcula el desbloqueo con `computeEffectiveReadingMs` sobre las sesiones **pedagógicas** del usuario (`events` caliente ∪ archivo). No lee `econ_events`.
- `seed` crea una segunda cuenta con **dos sesiones cerradas de 65 min (130 min en total)**, escritas con el propio `eventsService.insertEvent` en el `events.db` del laboratorio, sobre una obra (`lab-historial-sintetico`) que **no está en el catálogo ni en ninguna regla**.
- La primera cuenta (`lector@a11y-lab.test`) sigue sin historial y con el avance bloqueado, para poder comparar.
- `ARCHIVE_SQLITE_PATH` apunta al laboratorio. Antes caía, en modo solo lectura, en `data-critical/`.

| Verificación | Resultado (prueba previa) |
|---|---|
| El avance se habilita con el estado de prueba | `autoAdvanceUnlocked: true`, `effectiveReadingMs` = 7 800 000 |
| La cuenta normal sigue bloqueada | `autoAdvanceUnlocked: false` |
| El umbral real no cambia | `AUTO_ADVANCE_UNLOCK_MS` = 120 min en `utils/a11yAutoAdvance.mjs` y en `server.js` |
| Los desplazamientos automáticos siguen excluidos | Con la cuenta desbloqueada, 5 min de auto-avance → ≤ 120 s |
| El estado no sale del laboratorio | 4 filas en el `events.db` del laboratorio (dentro del contenedor); `econ_events` vacío para esa cuenta; el motor obtiene 0 episodios de ese historial |

## 4. Pruebas automáticas

| Suite | Resultado |
|---|---|
| Prueba previa del laboratorio (contenedor `--network none`) | ver §4.1 |
| `test:royalties` | verde |
| `test:a11y-reader` | verde |
| `test:content-rmw` | verde |
| `chibaleteEpubReader` 47 ✓ · `epubProgress` 32 ✓ · `epubZipEntryResolver` 11 ✓ · `epubOriginalEndpoint` 32 ✓ · `canonicalBookEpub` 139 ✓ | verde |

### 4.1 Prueba previa: **32 ✓, 0 ✗**

Las 19 comprobaciones de LAB-02 siguen en verde, más 13 nuevas:

| Escenario nuevo | Resultado |
|---|---|
| `lab-epub` con `epub_url` propio y texto para los demás modos | ✓ |
| `GET /api/content/lab-epub/epub` con sesión: 200, `application/epub+zip`, ZIP con `mimetype` primero | ✓ |
| EPUB de 3 capítulos (`OEBPS/Text/cap1..3.xhtml`) | ✓ |
| Sin sesión, el EPUB no se sirve (401) | ✓ |
| EPUB paginado, 4 min con un cambio de página cada 30 s | 225 s, 1 episodio cualificado ✓ |
| Cambio de modo Accesible → EPUB sobre `lab-epub` | 285 s (`a11y` 150 + `epub` 135), **1 episodio, Q = 1** ✓ |
| Login de la cuenta de avance | ✓ |
| Avance desbloqueado con 130 min; la cuenta normal sigue bloqueada | ✓ / ✓ |
| Umbral de 120 min intacto en el cliente y en el servidor | ✓ |
| Historial pedagógico (4 filas) y `econ_events` vacío para esa cuenta | ✓ |
| El motor obtiene 0 episodios del historial | ✓ |
| Con el avance desbloqueado, 5 min de desplazamiento automático | 90 s (≤ 120) ✓ |

**Sin señales económicas ficticias:**
- el historial sintético es pedagógico y el motor no saca nada de él;
- el EPUB no emite nada por sí solo: las páginas cuentan solo cuando las pasa el lector (`page`/`snap`), y la restauración al abrir no cuenta;
- el laboratorio no inyecta interacciones en el navegador.

## 5. Acceso desde dispositivos

Sin cambios respecto de `F3A3_A11Y_LAB_02.md` §5: misma red local, `http://192.168.0.3:5173`, sin puertos públicos. **Ahora hay dos cuentas**; las contraseñas se leen con `docker exec chp-a11ylab cat /tmp/lab_seed.txt`.

### Secuencia breve para Dirección

1. En el equipo: Docker Desktop abierto y `docker ps` con `chp-a11ylab` en marcha. Leer las contraseñas con el comando de arriba.
2. En el iPhone o Android, conectado a la misma wifi: abrir `http://192.168.0.3:5173` → «Soy Lector».
3. Por cada caso de la tabla (§6 y `F3A3_A11Y_LAB_02.md` §6):
   1. anotar la hora;
   2. hacer el caso;
   3. volver a la Biblioteca;
   4. en el equipo, ejecutar `docker exec chp-a11ylab node scripts/royalties/a11yLab.mjs report --dir /tmp/chp_a11ylab` y copiar la línea nueva de «Acreditado por sesión».
4. Registrar el resultado en la plantilla (§6.2). Si algo no se puede ejecutar, anotar «no ejecutado» y el motivo. **Nunca marcar como superado un caso que no se haya hecho.**

## 6. Guía manual: casos actualizados

Los demás casos siguen como en `F3A3_A11Y_LAB_02.md` §6.

### 6.1 Casos EPUB y auto-avance

| Caso | Cuenta | Qué hacer | Esperado (acreditado de la sesión) | Dónde |
|---|---|---|---|---|
| **VO-4 / TB-4** auto-avance | `lector-avance@…` | Accesible → `#/leer/accesible/lab-largo`. Activar «Avance automático» (debe aparecer desbloqueado) y no tocar nada durante 5 min | ≤ 120 s tras el último gesto: el auto-avance **no** acredita | Dispositivo |
| **VO-4b / TB-4b** contraste | `lector@…` | Abrir el mismo visor | «Avance automático» aparece **bloqueado** («Disponible después de 2 h de lectura») | Dispositivo o navegador |
| **VO-6 / TB-6** EPUB paginado | `lector@…` | `http://192.168.0.3:5173/epub-reader.html?contentId=lab-epub`. «Leer todo» con el lector de pantalla y, cuando se detenga al final de la página, pasar de página con el gesto del lector. Unos 5 min | Si el lector pasa de página solo, anotarlo. Con cambios de página hechos por el lector: ≥ 90 % de T. Sin cambios de página (lector parado en una página más de 120 s): ≤ 120 s (limitación) | Dispositivo |
| **VO-6b / TB-6b** EPUB continuo | — | **No ejecutable:** el producto no tiene modo continuo en EPUB (§2) | — | — |
| **VO-6c / TB-6c** cambio de modo con EPUB | `lector@…` | 3 min de `lab-epub` en Accesible (`#/leer/accesible/lab-epub`) y luego 3 min en EPUB (`/epub-reader.html?contentId=lab-epub`) | En «Episodios»: **1 episodio** de `lab-epub` con `a11y` y `epub`, Q = 1, total ≤ 6 min | Dispositivo |

### 6.2 Plantilla de registro (una fila por caso)

| Caso | Dispositivo y versión | AT y versión | Inicio y fin | Acreditado (de `report`) | Esperado | Resultado (superado / no superado / no ejecutado) | Observaciones |
|---|---|---|---|---|---|---|---|

El informe no contiene datos personales: identificador técnico de la sesión, cuenta sintética, modo, obra sintética, horas y segundos.

## 7. Riesgos residuales y decisiones

1. **Pruebas en dispositivo pendientes** (VO/TB 1–9, 4b, 6, 6c y X-1). Sin ellas, YELLOW.
2. **Sin modo continuo en EPUB** (§2): la lectura continua de un EPUB con lector de pantalla depende de que el lector pase de página. ¿Se añade un selector «continuo» al lector EPUB (unidad de producto aparte) o se acepta la limitación?
3. **«Leer todo» sin desplazamiento** (VO/TB-2): sigue siendo una limitación del mecanismo y se eleva a F6-B si resulta frecuente.
4. **Intermitencia de `content-rmw`** (3 veces hoy, sin relación con los cambios): conviene una unidad aparte para estabilizarla.
5. **Directorios sintéticos del equipo:** a los de la entrega anterior se suma `C:\Users\Home\AppData\Local\Temp\chp_a11ylab_lab03_check` (comprobación local del `seed`). El entorno no me deja borrarlos; los retira el usuario.
