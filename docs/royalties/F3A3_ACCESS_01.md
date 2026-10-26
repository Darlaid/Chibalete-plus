# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 / ACCESS-01 · Validación accesible de la medición económica

**Fecha:** 2026-10-26 · **Baseline:** `20e9aad` (cliente y servidor = `b3dd8a9`, en producción como `catalogos-b3dd8a9`) · **Alcance:** validación y diagnóstico; sin implementación, sin despliegue, ingesta apagada

**Veredicto:** **YELLOW.**
- Lo automatizable está en GREEN sobre el código de producción: batería integral 20/20 escenarios y 13/13 comprobaciones; unitarias en verde.
- **Ninguna prueba con VoiceOver ni TalkBack se ha ejecutado**: no había dispositivos disponibles en esta unidad. Se entrega el protocolo ejecutable (§B y §C.3).

---

## A. Baseline F3-A3

| Elemento | Estado |
|---|---|
| Repo y CI | HEAD `20e9aad` = origin; árbol limpio; `20e9aad`: security ✅ (content-rmw en curso al abrir la unidad, commit solo de docs) |
| Commits que acreditan F3-A3 | `bdb7d79` (instrumentación de los 6 modos, inerte con la ingesta apagada), `dc22e19`/`2a5c29b` (CI y diagnóstico), `eb29090` A11Y-FIX-01 (regla de continuidad por desplazamiento), `94f295e`/`7e22057` A11Y-LAB-02 (laboratorio), `6c91eb2`/`47d86d7` A11Y-LAB-03 (EPUB y auto-avance), `f588cd8`/`3e8697a` A11Y-AUTO-04 (batería; RED por foco programático de Leo), **`980397f`/`ee75477` ECON-FOCUS-05 (corrección; GREEN_AUTO)** |
| Documentos | `F3A3_INSTRUMENTATION.md`, `F3A3_A11Y_DIAGNOSIS.md`, `F3A3_A11Y_FIX_01.md`, `F3A3_A11Y_LAB_02.md`, `F3A3_A11Y_LAB_03.md`, `F3A3_A11Y_AUTO_04.md`, `F3A3_ECON_FOCUS_05.md` |
| **Hallazgo: el código de F3-A3 ya está en producción, inerte** | `bdb7d79` y `980397f` son ancestros de `beb11e4` (F1-B, desplegado el 2026-10-26 16:13Z) y de `b3dd8a9` (F1-C, en producción). El hook se activa solo si `/api/runtime-config` declara `economicIngest: 'on'`. Producción responde `{"economicIngest":"off"}` (verificado desde Internet); **0** peticiones `econ_tick` en el edge en 7 días, **0** líneas `[ECON] econ_tick` en las API y **0** `econ_events`. Con la ingesta apagada, la guarda de foco no se instala (`focus()` nativo, ECON-FOCUS-05 §4 caso 8) |

## B. Matriz de validación (consolidada y actualizada tras ECON-FOCUS-05)

Sustituye, para la ejecución, a `F3A3_A11Y_FIX_01.md` §5.2 y a `F3A3_A11Y_LAB_03.md` §6.1. **T** = tiempo real del caso. «Acreditado» = segundos de la sesión en `report`.

| ID | AT | Modo, obra | Acciones | Esperado | Aceptación |
|---|---|---|---|---|---|
| VO-1 / TB-1 | VoiceOver iOS / TalkBack Android | Accesible, `lab-largo` | Doble toque en el texto y «Leer todo» 10 min | Señales por el desplazamiento que provoca el lector | ≥ 90 % de T; si no, anotar huecos > 120 s |
| VO-2 / TB-2 | ídem | Accesible, `lab-corto` (cabe en pantalla) | Doble toque y «Leer todo», 3 min escuchando | Sin desplazamiento no hay señal | ≤ 120 s. **Limitación documentada** (§D.2); no es un fallo |
| VO-3 / TB-3 | ídem | Accesible, `lab-largo` | Navegar elemento a elemento (un dedo a la derecha) 5 min, sin doble toque | **Cambio tras ECON-FOCUS-05:** el foco aislado **no** acredita; cuenta solo si el recorrido desplaza la página | Registrar el acreditado. ≥ 90 % si el lector desplaza; si no, ≤ 120 s (limitación, ver §D.2) |
| VO-4 / TB-4 | ídem | Accesible, `lab-largo`, cuenta `lector-avance` | Activar «Avance automático» y no tocar, 5 min | El auto-avance no acredita | ≤ 120 s tras el último gesto |
| VO-4b / TB-4b | ídem | Accesible, cuenta `lector` | Abrir el visor | «Avance automático» **bloqueado** (umbral de 120 min) | Bloqueado |
| VO-5 / TB-5 | ídem | Guiado sin TTS, `lab-largo` | «Leer todo» 5 min | Como VO-1 | ≥ 90 % de T |
| VO-6 / TB-6 | ídem | EPUB (solo paginado), `lab-epub` | «Leer todo» y pasar página con el gesto del lector, 5 min | Con cambios de página hechos por el lector, acredita; parado en una página > 120 s, no | Registrar; ≥ 90 % con cambios de página |
| VO-6c / TB-6c | ídem | Accesible 3 min → EPUB 3 min, `lab-epub` | Cambiar de modo | **1 episodio**, modos `a11y` + `epub`, Q = 1 | Total ≤ 6 min; una sola obra |
| VO-7 / TB-7 | ídem | Accesible 3 min → Guiado 3 min, `lab-largo` | Cambiar de modo con doble toque | 1 episodio, Q = 1 | Minutos ≤ T (unión, no suma) |
| VO-8 / TB-8 | ídem | Accesible, `lab-largo` | «Leer todo», pausar el lector 3 min y reanudar | La pausa > 120 s no acredita; el desplazamiento al reanudar **no** reabre sin un gesto nuevo | ≤ T − 3 min; tras un doble toque vuelve a acreditar |
| VO-9 / TB-9 | ídem | Accesible, `lab-largo` | Bloquear pantalla o cambiar de app a mitad | Pestaña oculta: no acredita | 0 mientras está oculta |
| **LEO-1** (nuevo) | ídem | Guiado, `lab-corto` | Abrir y **no tocar nada** > 45 s hasta que Leo se abra solo y el lector anuncie el diálogo; esperar 3 min | El foco programático de Leo **no** genera actividad | **0 s** acreditados en la sesión |
| **LEO-2** (nuevo) | ídem | Inmersivo, `lab-largo` | Igual que LEO-1 con la narración detenida | Igual | **0 s** |
| **LEO-3** (nuevo) | ídem | Guiado, `lab-largo` | Doble toque en «Pregúntale a Leo» (apertura manual), cerrar con el lector y seguir leyendo con «Leer todo» | El doble toque acredita; el foco del diálogo y la devolución del foco no añaden señal | Acreditado coherente con los gestos (cola ≤ 120 s desde el último) |
| X-1 | navegador del dispositivo | cualquiera | Contra un servidor con la ingesta apagada | Ninguna petición `econ_tick` | 0 peticiones. **Ya observado en producción** (§A) |

**Modos sin regla de continuidad:** el Inmersivo y el Álbum acreditan por escucha; el PDF no se lee con lector de pantalla (sin capa de texto). En dispositivo basta comprobar que se abren y que LEO-2 da 0.

**Criterio de cierre manual:**
- Deben cumplir la aceptación VO/TB-1, -3 (según su regla), -4, -5, -6c, -7, -8, -9 y LEO-1…3.
- VO/TB-2 y -6 se registran tal como salgan.
- Si confirman la limitación, la decisión es de F6-B (§D.2).

## C. Pruebas ejecutadas y pendientes

### C.1 Ejecutadas en esta unidad (automáticas, sobre el código de producción)

| Prueba | Resultado |
|---|---|
| **Batería integral** `a11yLabBattery.mjs` (servidor, ingesta F3-A2 y motor F3-A1 reales, núcleo real del cliente en tiempo real, contenedor `--network none`, fuente `git archive 20e9aad`) | **20/20 escenarios, 13/13 comprobaciones**, 30 min. Evidencia: `F3A3_ACCESS_01_battery.json` (sin datos personales). Es la primera ejecución completa en verde con ECON-FOCUS-05 (antes: 18/20 con rangos antiguos y repetición parcial 2/2) |
| `economicTick` (incluye [14]: foco nunca es señal, guarda del foco programático) | 120/120 |
| `economicEpisodes` (motor F3-A1) | 95/95 |
| `test:a11y-reader` | Verde (53 + 27 + 18 + 26) |

Lo que acredita la batería, por criterio de la unidad:

| Criterio | Escenarios |
|---|---|
| Navegación legítima con señal observable acredita | A1 285 s, A2 585 s, A3 585 s (lectura continua con desplazamiento), M-a11y 285 s, B4 225 s (continuidad con tope) |
| Sin interacción inicial no hay actividad | A6: 0 ticks con desplazamientos reales |
| Pausas y límites de inactividad | A4 105 s (≤ 120), A5 180 s (pestaña oculta: 0), A7 180 s (pausa > 120 s no cuenta), B1 auto-avance 105 s, B2 desplazamiento propio del visor 105 s, B3 avance pequeño 105 s |
| Varios modos de una obra = una obra | E1: Accesible + Guiado = **1 episodio, Q = 1** (165 + 165 s) |
| Seis modos comparables | 270 / 285 / 285 / 285 / 285 / 285 s (diferencia ≤ 30 s) |
| Contrato intacto | `rs-2026-01-v1` (pausa 120, 45 s, tope 20 min, franja 15 s, 25 % BRD, 30/70, 3 episodios/día); E2 lectura corta no cualifica; E3 obra sin regla: 0 guardados |
| Ingesta apagada | `runtime-config` `off`, 0 ticks guardados |
| Aislamiento | Sin salida hacia producción, sin credenciales productivas, ninguna escritura fuera del laboratorio |

El foco programático de Leo **no está en la batería**: la batería usa el núcleo y no el hook. Lo cubren las unitarias [14] y las 9 pruebas en Chrome real de ECON-FOCUS-05 §3–4 (RED antes, GREEN después, 0 ticks con Leo abriéndose solo). En dispositivo, LEO-1…3.

### C.2 Pendientes (no ejecutadas; no se declaran superadas)

**Todos** los casos VO y TB (1–9, 4b, 6c) y LEO-1…3 en iPhone con VoiceOver y en Android con TalkBack. No había dispositivos ni persona disponible para operarlos en esta unidad.

### C.3 Protocolo ejecutable

1. **Reconstruir la imagen del laboratorio desde el HEAD actual.** La imagen `chp-a11ylab:local` existente (2026-10-24) contiene el hook **anterior** a ECON-FOCUS-05 (md5 distinto), así que las pruebas en dispositivo darían resultados de código obsoleto. Usar el bloque «construir» de `F3A3_A11Y_LAB_02.md` §2 con `git archive HEAD` (el lockfile no cambió desde LAB-03).
2. Prueba previa sin red: `a11yLabSelfTest.mjs` y, si se quiere, `a11yLabBattery.mjs` (debe dar 20/20 y 13/13 como en §C.1).
3. Arrancar para dispositivos con el bloque de `F3A3_A11Y_LAB_02.md` §2. Vite publicado solo en `127.0.0.1` y en la IP local; la ingesta encendida **solo** dentro del laboratorio.
4. Acceso desde iPhone o Android en la misma red: `F3A3_A11Y_LAB_02.md` §5.
5. Por caso de §B: anotar la hora, ejecutar, volver a Biblioteca y en el equipo correr `docker exec chp-a11ylab node scripts/royalties/a11yLab.mjs report --dir /tmp/chp_a11ylab`. Copiar la línea de «Acreditado por sesión».
6. Registrar en la plantilla de `F3A3_A11Y_LAB_03.md` §6.2: dispositivo y versión, AT y versión, modo, acciones, eventos observados, acreditado, esperado, resultado (superado / no superado / no ejecutado) y limitaciones.
7. Al terminar: `docker rm -f chp-a11ylab`. Los datos son sintéticos y desaparecen con el contenedor.

## D. Hallazgos reales

### D.1 De esta unidad

1. **Código de F3-A3 en producción, inerte** (§A). No es un defecto: el diseño lo permite y está verificado (0 emisiones). Cambia el gate: el «despliegue» de la instrumentación ya está hecho. Lo que falta es **encender** la ingesta con autorización.
2. **Imagen de laboratorio obsoleta** respecto de ECON-FOCUS-05. Es un riesgo de validar código viejo en dispositivo. Se resuelve con el paso 1 de §C.3 (operativo, sin cambios de código).
3. **Sin defectos nuevos** en la medición: la batería pasa completa con el código de producción.

### D.2 Limitaciones documentadas (sin cambios; no se inventan eventos)

1. **«Leer todo» sin desplazamiento** (texto que cabe en pantalla) y **navegación por elementos sin desplazamiento**: no hay señal observable, así que acredita como máximo 120 s tras el último gesto. Es la regla conservadora de ECON-FOCUS-05: el navegador no distingue el foco del lector del foco programático. Si VO/TB-2 o -3 lo confirman como frecuente, la decisión es de F6-B (señal accesible explícita o revisión de P3), no de F3-A3.
2. **EPUB solo paginado:** la lectura continua con lector depende de que el lector pase de página (VO/TB-6).
3. **PDF** sin capa de texto: no se lee con lector de pantalla.
4. **Inmersivo y Álbum** acreditan por escucha (con la pestaña oculta en el Inmersivo, por diseño).

## E. Correcciones mínimas necesarias

**Ninguna en el código.** Solo la acción operativa de reconstruir la imagen del laboratorio antes de las pruebas en dispositivo (§C.3 paso 1).

## F. Impacto sobre el gate productivo de F3-A3

| Condición del gate (Plan V1.1 y `F3A3_A11Y_FIX_01.md` §8) | Estado |
|---|---|
| Instrumentación en producción | **Hecha, inerte** (desde `beb11e4`, hoy `catalogos-b3dd8a9`) |
| Pruebas automáticas de medición y equidad (G3) | GREEN (§C.1) |
| VoiceOver y TalkBack en dispositivo | **PENDIENTE** (§C.2) |
| Decisión sobre las limitaciones de §D.2 (F6-B) | Pendiente de los resultados de VO/TB-2, -3 y -6 |
| 1 episodio en producción con la ingesta encendida | **PENDIENTE**; exige autorización expresa para `ECONOMIC_INGEST_MODE=on` y no se toca en esta unidad |

F3-B sigue bloqueada por este gate.

## G. Documentación y commit

Este documento, `F3A3_ACCESS_01_battery.json` y la fila 7 del seguimiento.

## H. Veredicto

**YELLOW.**
- GREEN en todo lo automatizable sobre el código de producción.
- Las pruebas manuales con VoiceOver y TalkBack (incluidas las nuevas de Leo) **no se ejecutaron** y quedan con protocolo listo.
- El cierre requiere esas pruebas y, después, la autorización para encender la ingesta y observar un episodio en producción.
