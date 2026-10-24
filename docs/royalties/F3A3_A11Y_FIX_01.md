# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 / A11Y-FIX-01 · Señales de lectura accesible

**Fecha:** 2026-10-24 · **Base:** `2a5c29b` (F3-A3 GREEN_LOCAL+CI) · **Diagnóstico:** `F3A3_A11Y_DIAGNOSIS.md` (alternativa A, aprobada)
**Modo:** implementación local y CI. **Sin despliegue.** `ECONOMIC_INGEST_MODE` y `RIGHTS_ENFORCEMENT_MODE` siguen apagados en producción.
**Veredicto:** **YELLOW**, porque faltan las pruebas en dispositivo, que el criterio de la unidad exige. Lo automático (núcleo, integración, regresiones, build y CI, §4.3) está en verde.

## 1. Fiabilidad de la alternativa A por modo

| Modo | Desplazamientos propios del visor | ¿Se distingue el origen? | Decisión |
|---|---|---|---|
| `a11y` | Navegación por segmentos y capítulos (`smoothScrollToElement`), auto-avance (`scrollElementIntoReadingBand`), enlaces de salto, índice, y el foco al abrir Ajustes o la barra lateral | **Sí.** Todos pasan por `markProgrammaticScroll()`, y el auto-avance se declara con `isAutoScrolling()` (`status === 'ACTIVE'`) | **Activada** |
| `text` (Guiado) | Reanudación de la posición (`scrollTo` a los 500 ms) y botones ↑/↓. **El TTS no desplaza.** | **Sí.** Los tres pasan por `markProgrammaticScroll()` | **Activada** |
| `epub` | foliate: `navigation` (restauración e índice), `anchor` (re-maquetación), `page`, `snap` y `scroll` (modo continuo) | **Sí, en el modo continuo:** foliate solo emite `scroll` cuando el desplazamiento no es suyo (`#justAnchored`). **En el modo paginado no hay ninguna señal observable de un avance hecho por el lector de pantalla.** | `scroll` pasa por la misma regla (avance de la fracción del libro). Paginado: sin cambios, porque no hay nada observable. |
| `immersive` | Sincronía texto-audio durante la reproducción | No sin auditar el motor de sincronía | **No activada.** La vía de escucha sigue intacta. |
| `album` | Navegación por regiones e imágenes | No aplica: no es lectura de texto largo | **No activada.** La vía de escucha sigue intacta. |
| `pdf` | `canvas` sin capa de texto: el lector de pantalla no puede leerlo | — | **No activada.** La brecha del visor queda fuera de esta unidad. |

## 2. Cambios

| Archivo | Cambio |
|---|---|
| `utils/economicTick.mjs` | `core.scrollObserved(t, obs)` con las guardas de §3; `windowScrollObservation()` (posición = fracción del documento, estable al re-maquetar; avance mínimo = ¼ de pantalla); nuevos parámetros; los motivos de EPUB pasan a `page` y `snap`, y `scroll` va a la regla de desplazamiento |
| `hooks/useEconomicTick.ts` | Opción `scrollSignal: { isAutoScrolling }`; `markProgrammaticScroll()` exportada (solo anota la hora); listener de `scroll` y `scrollend` en la **ventana**, sin captura, **solo** con la sesión activa y si el visor lo pide; `markScrollProgress(position)` para el EPUB; la posición de partida se absorbe al montar |
| `pages/VisorAccesible.tsx` | `scrollSignal` con el auto-avance como automático |
| `pages/VisorTexto.tsx` | `scrollSignal`; marcas en la reanudación y en ↑/↓ |
| `hooks/useA11yReaderNavigation.ts`, `components/accesible/A11ySkipLinks.tsx`, `A11yTableOfContents.tsx`, `A11yReadingSettings.tsx`, `A11ySidebar.tsx` | `markProgrammaticScroll()` antes de cada desplazamiento o foco propio |
| `components/epub-reader/EpubReaderApp.tsx` | `navigation` deja de ser señal; `scroll` → `markScrollProgress(loc.fraction)` |
| `utils/__tests__/economicTick.test.mjs` | Secciones [12] y [13], y ajuste de [10] y [11] |
| `scripts/royalties/a11yLab.mjs` (nuevo) | Laboratorio aislado para las pruebas manuales (§5) |

**Defecto latente corregido (EPUB):** al abrir un libro con una posición guardada, `adapter.goTo(cfi)` emitía un `relocate` con motivo `navigation`, que contaba como señal humana sin acción del lector. Con la pestaña visible, eso podía acreditar hasta 120 s, lo bastante para cualificar (45 s). Ahora `navigation` no es señal. Ir a un capítulo desde el índice sigue contando, porque llega como click.

## 3. Reglas de la señal de desplazamiento

Todas tienen que cumplirse. Si no, el desplazamiento **se absorbe**: la posición sube y ese avance ya no podrá contar después.

1. **Pestaña visible.**
2. **Sin desplazamiento automático:** ni `isAutoScrolling()`, ni un desplazamiento propio hace ≤ 1,5 s, ni uno propio que siga en curso (sin `scrollend`, con un tope de 5 s). Si el visor falla al responder, se trata como automático.
3. **Solo continuidad:** debe haber una señal (de cualquier tipo) en los últimos 120 s. Un desplazamiento **nunca abre ni reanuda** una lectura. La cadena siempre nace de una interacción real, así que **el desplazamiento por sí solo no produce ningún tick ni ningún episodio**.
4. **Avance real:** la posición supera la máxima ya absorbida en al menos ¼ de pantalla (en EPUB, cualquier avance de la fracción del libro). Retroceder, oscilar o re-maquetar no avanza.
5. **Como mucho una señal por franja (15 s).** El avance que llega antes de tiempo queda pendiente, no se pierde.

No se infiere VoiceOver, TalkBack ni ninguna otra tecnología de apoyo. No cambia ninguna ventana del motor.

## 4. Pruebas

### 4.1 Automáticas (Windows, árbol de trabajo)

| Suite | Resultado |
|---|---|
| `economicTick` | **107 ✓, 0 ✗** (62 anteriores + 45 nuevas) |
| `test:royalties` | verde (la prueba HTTP es POSIX y se valida en CI) |
| `test:a11y-reader` | verde |
| `test:content-rmw` | verde |
| `chibaleteEpubReader` 47 ✓ · `epubProgress` 32 ✓ · `epubZipEntryResolver` 11 ✓ | verde |
| `typecheck:baseline` | sin regresiones |
| `npm run build` | correcto |

**Casos pedidos → sección [12]/[13] de `economicTick`:**

| Caso | Comprobación |
|---|---|
| Desplazamiento real hacia adelante | Un clic y luego desplazamiento cada 40 s: ≈ 10 min acreditados (sin la regla: ≤ 120 s) |
| Ausencia de desplazamiento | Eventos sin movimiento, retroceso y avance menor de ¼ de pantalla: nada extra |
| Movimiento automático | `auto: true` (auto-avance): nada extra |
| Ventana de 1,5 s | 1 s y 1,5 s excluidos; 2 s cuenta; 3 s todavía en curso excluido; 6 s cuenta aunque no haya `scrollend` |
| Una señal cada 15 s | Desplazamiento continuo: separación ≥ 15 s entre señales |
| Pérdida de visibilidad | Sin vía visual; el avance con la pestaña oculta se absorbe y no se acredita al volver |
| Cambios de modo | La sesión nueva necesita su propia interacción; con ella, 1 episodio, Q = 1 y minutos ≤ reales |
| Ingesta apagada | Estructural: el listener solo existe con la sesión activa; `markProgrammaticScroll` no registra nada ni hace red |
| Sin doble conteo | Desplazamiento más clics = clics solos (± 1 franja); dos visores a la vez = 1 episodio ≤ tiempo real |
| Sin señales artificiales | Solo desplazamiento → 0 ticks y 0 episodios; tras > 120 s sin señal no reanuda; todos los desplazamientos y focos propios de los visores activados están marcados (estructural, por archivo) |

### 4.2 Laboratorio (validación local del script)

- `seed` crea el laboratorio en el directorio temporal del sistema y rechaza `data/`, `data-critical/`, `public/uploads` y cualquier directorio fuera del temporal. El servidor de pruebas también lo exige.
- `start` arranca el servidor con `ECONOMIC_INGEST_MODE=on` **solo para ese directorio**. `/api/runtime-config` devuelve `economicIngest: "on"`. En Windows se detiene con un aviso: sin una clave de sesión 0400 no se emite cookie y la ingesta responde 401, igual que en la prueba HTTP, que es POSIX.
- `report` lee `econ_events` en solo lectura y aplica el motor. Probado con filas aceptadas por `recordEconTicks`: 5 min en `a11y`, con un clic y luego solo desplazamiento → **285 s, cualificado, Q = 1**.

### 4.3 CI

HEAD `44bc915` (el código está en `eb29090`; sus runs se cancelaron por concurrencia al publicar `44bc915`):

| Workflow | Run | Resultado |
|---|---|---|
| `security` | `40124272700` | success |
| `identity-preflight` | `40124272562` | **success** (incluye `test:royalties`: `economicTick` y la prueba HTTP [8] en Linux) |
| `content-rmw` | `40124272709` | **failure** en el paso 7 (`test:content-rmw`), sin anotación concreta; los logs no se pueden leer sin credencial |

Evaluación del fallo de `content-rmw`:
- **Sin indicios de regresión, aunque no está demostrado:**
  - las tres pruebas de la suite que inspeccionan archivos cambiados (`contentGlobalReadOnlyPolicy`, `ClientContentProtection.structural` y `ContentExtractionDeterrence`) pasan en local con el árbol final;
  - las únicas que solo corren en Linux (`progressReadIdentity`, `uploadsAuthzStrict`, `catalogResourceLocators`, `catalogAccessLogNoise`, `catalogAccessPerformance`, que es de rendimiento) prueban endpoints del servidor, y esta unidad no cambia el servidor.
- **Precedente:** el mismo paso falló el mismo día en `dc22e19`, con un diff ajeno a la suite, y pasó al relanzarlo sin cambios.
- **Confirmado como intermitencia:** en `77aa401` (solo documentación, mismo código que `44bc915`), `content-rmw` (run `40124833501`) y `security` (`40124833506`) pasaron sin relanzar nada. **CI de la unidad: GREEN.**

## 5. Pruebas con VoiceOver y TalkBack (pendientes, en dispositivo)

### 5.1 Preparación (macOS o Linux en la misma red que los dispositivos)

> **Desde Windows, usar el procedimiento con Docker de `F3A3_A11Y_LAB_02.md`** (copia limpia, prueba previa 19/19 y guía de dispositivos). El bloque de abajo solo vale en un árbol sin `.env`, `data/` ni `data-critical/`: `start` lo exige.

```bash
LAB=$(mktemp -d)/chp_a11ylab          # dentro del directorio temporal del sistema
node scripts/royalties/a11yLab.mjs seed  --dir "$LAB" --origin http://<IP-LAN>:5173
node scripts/royalties/a11yLab.mjs start --dir "$LAB"     # terminal 1 (API :3000, ingesta ON solo aquí)
npm run dev                                                # terminal 2 (Vite 0.0.0.0:5173, proxy a :3000)
# En el dispositivo: http://<IP-LAN>:5173 → entrar con la cuenta que imprime "seed"
# Obras: lab-largo (4000 palabras) y lab-corto (70 palabras, cabe en pantalla)
node scripts/royalties/a11yLab.mjs report --dir "$LAB"    # tras cada caso
```

Datos 100 % sintéticos: cuenta `lector@a11y-lab.test` con contraseña aleatoria, regla pagada de laboratorio y obras generadas. Se borra eliminando `$LAB`. **No se usa producción** ni se copian datos reales.

Anotar en cada caso: dispositivo, versión del sistema y del navegador, hora de inicio y de fin, y la salida de `report`.

### 5.2 Matriz

Notación: **T** = tiempo real de lectura del caso.

| ID | Dispositivo y AT | Modo, obra | Procedimiento | Resultado esperado | Aceptación |
|---|---|---|---|---|---|
| VO-1 | iPhone, Safari, VoiceOver | a11y, lab-largo | Abrir, tocar dos veces "Siguiente sección" y luego "Leer todo" (dos dedos hacia abajo) durante 10 min | Ticks con señal mientras VoiceOver desplaza la página | Acreditado ≥ 90 % de T. **Si no:** registrar en `report` los huecos de más de 120 s, que indican que no hubo desplazamiento observable. |
| VO-2 | iPhone, VoiceOver | a11y, lab-corto | Doble toque en el texto y "Leer todo" de un texto que cabe en pantalla, y quedarse escuchando 3 min | **Sin desplazamiento no hay señales:** acredita ≤ 120 s | Confirmar la limitación (§6). No es un fallo de la unidad. |
| VO-3 | iPhone, VoiceOver | a11y, lab-largo | Navegar elemento a elemento (un dedo a la derecha) durante 5 min | Señales por foco (si VoiceOver lo mueve) o por desplazamiento | ≥ 90 % de T. Anotar si llega `focusin`. |
| VO-4 | iPhone, VoiceOver | a11y, lab-largo | Auto-avance activado, sin tocar, 5 min | El desplazamiento del auto-avance **no** cuenta | ≤ 120 s tras el último gesto |
| VO-5 | iPhone, VoiceOver | text, lab-largo | "Leer todo" sin TTS, 5 min | Igual que VO-1 | ≥ 90 % de T |
| VO-6 | iPhone, VoiceOver | epub (modo continuo y paginado) | "Leer todo" cruzando páginas | Continuo: señales por `scroll`. Paginado: anotar si cambia de página solo. | Continuo ≥ 90 % de T. Paginado: registrar el resultado (§6). |
| VO-7 | iPhone, VoiceOver | a11y → text | 3 min en cada modo, cambiando de modo con doble toque | 1 episodio, Q = 1 | Minutos ≤ T. Unión, no suma. |
| VO-8 | iPhone, VoiceOver | a11y, lab-largo | "Leer todo", pausar VoiceOver (dos dedos, toque) 3 min y reanudar | La pausa de más de 120 s no se acredita. Al reanudar sin interacción nueva, el desplazamiento **no** reabre la acreditación. | Acreditado ≤ T − 3 min. Tras un doble toque, vuelve a acreditar. |
| VO-9 | iPhone, VoiceOver | a11y, lab-largo | Bloquear la pantalla o cambiar de app a mitad de la lectura (abandono) | Sin vía visual con la pestaña oculta | Nada acreditado mientras está oculta |
| TB-1…TB-9 | Android, Chrome, TalkBack | Los mismos casos | "Leer desde arriba" o "desde el siguiente elemento"; doble toque para activar; menú de TalkBack para pausar | Los mismos | Los mismos |
| X-1 | Cualquiera | todos | Con el laboratorio apagado (o `npm run dev` contra un servidor con la ingesta OFF) | Ninguna petición a `/api/v1/events` | 0 peticiones en el inspector de red |

**Criterio de cierre de las pruebas manuales:** todos los casos VO y TB ejecutados y anotados. VO-1, VO-3, VO-5, VO-7, VO-8, VO-9 y sus equivalentes TB deben cumplir la aceptación. VO-2, VO-6 (paginado) y TB-2 se registran tal como salgan; si confirman la limitación, se eleva a F6-B.

## 6. Limitaciones residuales (reales, no ocultas)

1. **"Leer todo" sin desplazamiento** (texto que cabe en pantalla, o lectores de pantalla que no desplazan): no hay nada observable y deja de acreditar a los 120 s. **No se inventa ninguna señal.** Si las pruebas VO-2 y TB-2 muestran que es frecuente o estructural, la decisión pasa a F6-B (señal accesible explícita o revisión de P3), no a F3-A3.
2. **EPUB paginado:** foliate no emite ningún `relocate` cuando un lector de pantalla mueve el contenido de una página a otra. Queda sin cubrir hasta verificarlo en dispositivo (VO-6).
3. **Inmersivo, Álbum y PDF** no usan la regla. Los dos primeros acreditan por escucha; el PDF no se puede leer con lector de pantalla.
4. **Antifraude:** una extensión que desplace la página sola podría encadenar señales, pero solo después de una interacción real y sin pausas de más de 120 s (lo mismo que hoy con clics automáticos). Siguen aplicándose la visibilidad, el máximo de 3 episodios por obra y día y P12 (F3-B).
5. **Un foco del navegador que desplace la página**, fuera de los focos marcados, solo podría añadir una señal pegada a un clic real, sin efecto en el tiempo acreditado.
6. **El laboratorio necesita macOS o Linux** para `start`, por la clave de sesión 0400.

## 7. Impacto sobre el contrato económico

- **Ninguno en el motor F3-A1, la ingesta F3-A2, `rs-2026-01-v1`, los episodios, las pausas, el tope de P3, la elegibilidad, la atribución, las clases comerciales ni el reparto.** No hay `rule_set` nuevo ni migraciones. El servidor no cambia.
- El cliente solo declara más señales de navegación, como ya admite el Plan §4.2, con guardas más estrictas que las del resto de señales. Además, deja de declarar una señal indebida (la restauración del EPUB).
- Con la ingesta apagada (producción), el producto no cambia: ni listeners, ni red. `markProgrammaticScroll()` solo guarda una hora en memoria.

## 8. Condiciones antes de desplegar F3-A3

1. Ejecutar la matriz §5 en dispositivos reales y registrar los resultados.
2. Si se confirma la limitación 1, decidir en F6-B si se despliega con ella documentada.
3. Mantener el resto del gate de F3-A3: despliegue autorizado, E2E por modo y 1 episodio en producción con la ingesta encendida.
