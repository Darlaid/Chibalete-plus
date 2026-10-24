# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 / A11Y-AUTO-04 · Batería integral automatizada

**Fecha:** 2026-10-24 · **Base:** `47d86d7` (CI 3/3 verde) · **Ejecutor:** `scripts/royalties/a11yLabBattery.mjs` · **Evidencia:** `F3A3_A11Y_AUTO_04_battery.json`
**Modo:** laboratorio aislado (Docker, `--network none`) y Chrome real contra el laboratorio de dispositivos. Sin despliegue, sin producción y sin datos reales.
**Veredicto:** **RED**, por una **acreditación ficticia verificada** en el navegador real (§5): las intervenciones automáticas de Leo en Guiado e Inmersivo ponen el foco por código y el hook lo cuenta como señal humana. El resto de la batería pasa: 20/20 escenarios, 13/13 comprobaciones y 7 de 8 pruebas de navegador.

## 1. Base y preflight

- HEAD `47d86d7`, sincronizado y árbol limpio. CI de HEAD: `security`, `content-rmw` e `identity-preflight` en verde.
- `chp-a11ylab` activo y aislado: Vite solo en `127.0.0.1:5173` y `192.168.0.3:5173`; API :3000 no alcanzable desde el equipo; `/app` sin `data/`, `data-critical/` ni `.env`; datos en `/tmp/chp_a11ylab`.
- No hay ningún navegador sin interfaz en el repo. No se añadió Playwright: las pruebas de página se hicieron con Chrome real, a través de la extensión del entorno.

## 2. Cómo se probó

1. **Integración contra el laboratorio** (`a11yLabBattery.mjs`, contenedor sin red): servidor, ingesta F3-A2 y motor F3-A1 reales. El núcleo real del cliente emite los ticks **en tiempo real** (cada uno se envía al llegar, con el reloj real que exige el servidor), en hasta 4 carriles paralelos, ≤ 2 por cuenta para quedar por debajo del tope de 12 ticks/min. Las señales (interacción, desplazamiento, visibilidad, audio) son **simuladas** con las mismas reglas que el hook. Lo que se prueba de verdad es el camino núcleo → validador → `econ_events` → motor.
2. **Navegador real** (Chrome contra `http://localhost:5173`): el hook real, con eventos reales de la página. Los clics son de confianza (`isTrusted: true`); los desplazamientos de «lector de pantalla» se hacen con `window.scrollBy` desde la página, que para el hook equivale a un desplazamiento externo sin marcar. **No se atribuye nada a VoiceOver ni a TalkBack.**
3. **Unitarias:** `economicTick` (107 comprobaciones), para las ventanas exactas (1,5 s, 15 s, ¼ de pantalla) y las combinaciones que no merecen tiempo real.

## 3. Matriz de pruebas

### 3.1 Integración contra el laboratorio (tiempo real)

| Caso | Modo | Tipo | Resultado | Acreditado (obs. / esp.) | Episodios | Evidencia |
|---|---|---|---|---|---|---|
| A1 Lectura activa 5 min, interacción cada 20 s | a11y | integración | ✓ | 285 s / 255–300 | 1 cualificado | battery.json `A1` |
| A2 Lectura activa 10 min | a11y | integración | ✓ | 585 s / 555–600 | 1 cualificado | `A2` |
| A3 Continua 10 min: 1 interacción y desplazamiento cada 40 s | a11y | integración (señal simulada) | ✓ | 585 s / 555–600 | 1 | `A3` |
| A4 1 interacción y 5 min sin desplazamiento | a11y | integración | ✓ | 105 s / ≤ 120 (8 ticks; el cliente deja de emitir) | 1 | `A4` |
| A5 Pestaña oculta de 2 a 4 min y retorno (6 min) | a11y | integración | ✓ | 195 s / 195–245 | 1 | `A5` |
| A6 Sin interacción inicial, desplazamientos 4 min | a11y | integración | ✓ | 0 ticks / 0 | 0 | `A6` |
| A7 Pausa de 3 min y retorno (7 min) | a11y | integración | ✓ | 195 s / 195–250 (la pausa no cuenta) | 1 | `A7` |
| B1 Auto-avance 4 min | a11y | integración (simulada) | ✓ | 105 s / ≤ 120 | 1 | `B1` |
| B2 Desplazamiento propio hace 1 s (ventana 1,5 s) | a11y | integración (simulada) | ✓ | 105 s / ≤ 120 | 1 | `B2` |
| B3 Avance < ¼ de pantalla | a11y | integración (simulada) | ✓ | 105 s / ≤ 120 | 1 | `B3` |
| B4 Desplazamiento cada 1 s (tope 1/15 s) | a11y | integración (simulada) | ✓ | 225 s / 195–240, sin sumar de más | 1 | `B4` |
| E1 Misma obra: Accesible 3 min → Guiado 3 min | a11y→text | integración | ✓ | 330 s (165 + 165) / 315–360 | **1, Q = 1** | `E1` |
| E2 Lectura de 40 s | a11y | integración | ✓ | 30 s | 1 **no** cualificado | `E2` |
| E3 Obra sin regla ni catálogo (denegación por defecto) | a11y | integración | ✓ | 4 enviados, 0 guardados (`content_not_found`) | 0 | `E3` |
| M-pdf Paso de página cada 30 s, 5 min | pdf | integración | ✓ | 285 s / 255–300 | 1 | `M-pdf` |
| M-epub Paso de página cada 30 s, 5 min | epub | integración | ✓ | 285 s | 1 | `M-epub` |
| M-text TTS con gesto, 5 min de escucha | text | integración (audio simulado) | ✓ | 285 s | 1 | `M-text` |
| M-immersive Narración 5 min con la pestaña oculta | immersive | integración (audio simulado) | ✓ | 285 s | 1 | `M-immersive` |
| M-album Narración de región 5 min | album | integración (audio simulado) | ✓ | 285 s | 1 | `M-album` |
| M-a11y Interacción y desplazamiento cada 40 s, 5 min | a11y | integración (simulada) | ✓ | 285 s | 1 | `M-a11y` |

**Comprobaciones (13/13):**
- sin credenciales productivas en el entorno del servidor;
- los 11 almacenes dentro del laboratorio;
- sin salida hacia producción (`EAI_AGAIN`);
- login de las 2 cuentas sintéticas;
- equivalencia entre los 6 modos (285/285/285/285/285/285);
- 0 ticks de la obra del historial;
- el historial pedagógico no produce episodios;
- avance desbloqueado en la cuenta de avance (7 800 000 ms) y bloqueado en la normal;
- contrato intacto (`rs-2026-01-v1`: pausa 120, 45 s, tope 20 min, franja 15 s, 25 % BRD, **30/70**, fusión 30 min, 3 episodios/día) y umbral de 120 min;
- **ingesta apagada:** `runtime-config` `off` y 0 ticks guardados;
- parada limpia;
- ninguna escritura fuera del laboratorio;
- log sin errores de almacenamiento.

### 3.2 Navegador real (Chrome, hook real)

| Caso | Modo | Tipo | Resultado | Acreditado | Episodios | Evidencia |
|---|---|---|---|---|---|---|
| BR1 Clic real en «Siguiente párrafo» y desplazamiento de la ventana cada 40 s, 4 min | a11y | navegador real | ✓ | **240 s** en ≈ 245 s de ventana; 18 ticks, todos con señal; `humanSignalAgoMs` se reinicia tras cada desplazamiento | 1 cualificado | `report` del laboratorio de dispositivos |
| BR2 Abrir el visor sin interacción y desplazar 4 veces | a11y | navegador real | ✓ | **0 ticks**; 0 eventos de entrada; sin foco automático al montar | 0 | interceptor de `fetch` en la página |
| BR3 Texto que cabe en pantalla (`lab-corto`: el texto acaba a 447 px de 888): un clic y 3 min sin nada | a11y | navegador real | ✓ | 8 ticks hasta que la señal tenía 105 s; **después, ninguno** | — | ídem |
| BR4 Guiado: reanudación de la posición, 2,5 min sin interacción | text | navegador real | **✗** | **4 envíos con señal sin ninguna interacción** | — | §5 |
| BR5a EPUB: dos pasos de página reales y 2,5 min sin nada | epub | navegador real | ✓ | ticks hasta 112 s desde la señal; después, ninguno | — | ídem |
| BR5b EPUB: recarga con restauración de la posición, 2,5 min | epub | navegador real | ✓ | **0 ticks**, 0 `focusin` (la restauración `navigation` no cuenta) | 0 | ídem |
| BR6 Ingesta apagada: clic real y 40 s de lectura | a11y | navegador real | ✓ | **0 `econ_tick`**; solo telemetría pedagógica | 0 | ídem y lista de peticiones |
| BR-pdf / BR-immersive / BR-album | pdf, immersive, album | — | **NO AUTOMATIZABLE en el laboratorio** | — | — | El laboratorio no tiene PDF, manifiesto TTS ni álbum sintéticos. El Inmersivo necesita audio TTS (con `TTS_MODE=mock` no hay medio que reproducir). Cubiertos por la integración (3.1) y por la estructura (`economicTick` [11]). |

### 3.3 Unitarias (señales simuladas)

`economicTick` 107 ✓ (incluye [12]: ventanas de 1 / 1,5 / 2 / 3 / 6 s, separación ≥ 15 s, absorción con la pestaña oculta, cambio de modo y doble pestaña; y [13]: marcas de desplazamientos y focos propios en el árbol Accesible y el Guiado).

### 3.4 Requieren VoiceOver o TalkBack reales (pendientes)

VO/TB-1 a 9, 4b, 6 y 6c de `F3A3_A11Y_LAB_02.md` §6 y `F3A3_A11Y_LAB_03.md` §6.1. **Ninguno se ha ejecutado.**

### 3.5 Limitaciones conocidas del producto

- **EPUB sin modo continuo:** solo pagina (LAB-03 §2).
- **PDF sin capa de texto:** no se puede leer con lector de pantalla; los ticks del PDF solo nacen de la navegación de página.
- **«Leer todo» sin desplazamiento:** deja de acreditar a los 120 s (BR3 lo muestra con el texto que cabe en pantalla); pendiente de la frecuencia real en dispositivos.

## 4. Resultados económicos y comparación entre modos

- **Misma lectura de 5 min en los 6 modos: 285 s en todos** (PDF, EPUB, Guiado con TTS, Inmersivo oculto, Álbum, Accesible con desplazamiento). Diferencia 0 s. No hay ventaja ni desventaja por modo (G4) en la parte medible.
- **Sin doble conteo:** el cambio de modo da 1 episodio y Q = 1 (E1, y LAB-03 Accesible → EPUB).
- **Corte a los 120 s:** respetado en A4, B1–B3 (105 s) y en el navegador (BR3, BR5a).
- **Cualificación:** < 45 s → no cualificado (E2).
- **Denegación por defecto:** obra sin acceso → 0 guardados (E3).
- **Ingesta apagada:** 0 tráfico económico (batería y BR6).
- Los totales observados quedan **siempre por debajo** del tiempo real (bordes de franja conservadores).

## 5. Fallo verificado: acreditación ficticia por foco programático

| | |
|---|---|
| **Observado (BR4)** | Al volver al Guiado sin tocar nada, se produjo un `focusin` con `isTrusted: true` y el hook emitió ticks con señal. |
| **Causa** | `components/LeoCompanion.tsx` (diálogo de Leo) hace `dialogRef.current?.focus()` al montarse (línea 77) y devuelve el foco al disparador al cerrarse (80, 85). El Guiado (`pages/VisorTexto.tsx`) y el Inmersivo (`pages/VisorInmersivo.tsx`) **abren Leo solos**: por inactividad (`retention`, más de 45 s sin desplazarse, `utils/leoTriggerEngine.ts:35`), al cruzar umbrales de progreso (`checkpoint`, también en la reanudación) y por confusión, con un enfriamiento de 5 min. Un `.focus()` por código dispara `focusin` de confianza, y `useEconomicTick` cuenta `focusin` como señal humana. |
| **Efecto económico** | Una sesión **sin ninguna interacción**, con la pestaña visible, recibe una señal a los ~45–60 s y acredita hasta 120 s más: supera los 45 s y produce un **episodio cualificado ficticio**. En una lectura real, cada apertura automática prolonga la acreditación hasta 120 s durante una inactividad. Afecta a Guiado e Inmersivo; Accesible y EPUB no montan Leo (BR2 y BR5b: sin `focusin`). |
| **Por qué no lo vieron las pruebas anteriores** | La batería y las unitarias simulan las señales. La revisión de focos de A11Y-FIX-01 cubrió el árbol Accesible y los menús del Guiado, pero no el componente de Leo que monta el Guiado. |
| **Producción** | Sin impacto hoy: la ingesta está apagada (`ECONOMIC_INGEST_MODE` off) y el hook es inerte. **Bloquea encender la ingesta.** |

**Corrección propuesta (no implementada, requiere aprobación):**

- **Opción B, recomendada:** con la sesión económica activa, `useEconomicTick` envuelve `HTMLElement.prototype.focus` y `SVGElement.prototype.focus` para marcar el foco «en curso por código». El evento `focusin` se emite de forma síncrona dentro de esa llamada, así que el hook ignora cualquier `focusin` que llegue durante ella. Se restaura al desmontar. Cubre Leo y cualquier otro diálogo presente o futuro, y conserva el `focusin` real (teclado o, si se confirma en dispositivo, VoiceOver/TalkBack). Iría con una prueba estructural y otra en navegador (BR4 de nuevo).
- **Opción A:** quitar `focusin` de las señales. Es lo más simple, pero puede perder la navegación por foco de los lectores de pantalla (sin verificar en dispositivo).
- **Opción C:** marcar cada `.focus()` del producto, como `markProgrammaticScroll`. Es frágil: hay muchos diálogos y menús.

## 6. Cobertura

| Ámbito | Automatizado | Pendiente |
|---|---|---|
| Actividad, inactividad, pausas, pestaña oculta, sin interacción, 120 s | Integración (A1–A7) y navegador (BR1–BR3) | — |
| Accesibilidad simulada (¼ de pantalla, 1,5 s, 15 s, auto-avance, foco y restauración) | Integración (B1–B4), unitarias y navegador (BR2, BR4, BR5b) | Corrección del foco programático (§5) |
| Seis modos | Integración (6 modos), navegador (a11y, text, epub) | Navegador real de pdf, immersive y album: sin activos sintéticos |
| EPUB y auto-avance | Integración, navegador (BR5a/b) y LAB-03 | — |
| Contrato | Integración y unitarias | — |
| VoiceOver y TalkBack | — | Todos los casos de dispositivo |

## 7. Riesgos para la equidad de las liquidaciones

1. **Foco programático (§5): riesgo ALTO** si se enciende la ingesta sin corregirlo. Infla Q y los minutos de Guiado e Inmersivo frente a PDF, EPUB y Accesible: sesgo a favor de las obras más leídas en esos modos y episodios sin lectura.
2. **«Leer todo» sin desplazamiento y EPUB sin modo continuo:** riesgo de **infravalorar** la lectura con lector de pantalla en obras cortas o en EPUB. Pendiente de los dispositivos (F6-B).
3. **Señales declaradas por el cliente:** un cliente manipulado puede declarar actividad; se mitiga con P12 (F3-B) y los topes vigentes.

## 8. Seguridad (§4 de la unidad)

- Sin credenciales productivas: el servidor del laboratorio no tiene `ADMIN_SECRET` y las claves de IA están vacías (leído de `/proc/<pid>/environ`).
- Sin salida a producción: contenedor `--network none`, `EAI_AGAIN`.
- Sin escrituras fuera del laboratorio: no existen `/app/data`, `data-critical`, `public/uploads` ni `.env`.
- La API económica no está expuesta: :3000 no se publica; Vite solo en `127.0.0.1` y en la IP local.
- Ningún dato real modificado. Ninguna sesión económica productiva: la ingesta de producción sigue apagada y el laboratorio no tiene acceso a la red.

**Corrección de la guía:** el comando de parada de `F3A3_A11Y_LAB_02.md` §6 (`pkill -TERM -f 'a11yLab.mjs start'`) también coincide con su propio `sh -c` y puede no parar el servidor. Se sustituye por `pkill -TERM -f '^node scripts/royalties/a11yLab.mjs start'`, y hay que esperar unos 5 s al cierre ordenado antes de volver a arrancar.
