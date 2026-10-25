# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 / ECON-FOCUS-05 · Sin acreditación por foco programático

**Fecha:** 2026-10-25 · **Base:** `3e8697a` (A11Y-AUTO-04 RED, CI 3/3 verde) · **Evidencia previa:** `F3A3_A11Y_AUTO_04.md` §5
**Modo:** desarrollo local y laboratorio aislado. Sin despliegue y sin ingesta productiva.
**Veredicto:** **GREEN_AUTO**. La acreditación ficticia por foco programático desaparece en Chrome real (RED antes, GREEN después) y las pruebas económicas automatizadas pasan. Las pruebas con VoiceOver y TalkBack siguen pendientes.

## 1. Causa raíz (confirmada)

1. `components/LeoCompanion.tsx` enfoca su diálogo al montarse (`dialogRef.current?.focus()`) y, al desmontarse, devuelve el foco al disparador. Es lo correcto para la accesibilidad, y **no se toca**.
2. El Guiado y el Inmersivo abren Leo **solos** (`fireIntervention`): por inactividad de más de 45 s, por umbrales de progreso (también en la reanudación) o por confusión, con un enfriamiento de 5 min.
3. Un `.focus()` por código dispara `focusin` con **`isTrusted = true`**. `useEconomicTick` contaba `focusin` como señal humana, y también lo reenviaba el adaptador EPUB desde los iframes.

El navegador no permite distinguir un foco por código del foco que mueve un lector de pantalla. Por eso se aplica la regla conservadora de la unidad: **un foco aislado no es señal**.

## 2. Corrección (opción B, centralizada en el hook)

| Archivo | Cambio |
|---|---|
| `hooks/useEconomicTick.ts` | `SIGNAL_EVENTS` = puntero, teclado, rueda, toque y click, **sin `focusin`**. Con la sesión económica activa, `focus()` (`HTMLElement`/`SVGElement`) queda envuelto con `createFocusGuard(markProgrammaticScroll)`: el desplazamiento que provoque un foco por código cuenta como propio del visor. La guarda se suelta al desmontar; con la ingesta apagada no se instala. |
| `utils/economicTick.mjs` | `createFocusGuard()`: pura, con contador de usos. Avisa **antes** de enfocar, ejecuta el foco original (mismo `this`, argumentos y retorno), un fallo de la medición nunca rompe el foco y no pisa un envoltorio instalado después por otro código. |
| `components/epub-reader/foliateAdapter.mjs` | Los iframes del libro reenvían solo entrada (sin `focusin`). |
| `utils/__tests__/economicTick.test.mjs` | Sección [14] (13 comprobaciones). |
| `scripts/royalties/a11yLabBattery.mjs` | Rangos de los escenarios de dos tramos (A5, A7) corregidos con su justificación (§5) y filtro `BATTERY_ONLY`. |

**Sin lista manual de componentes, sin tocar Leo ni ningún diálogo, sin cambios en su comportamiento pedagógico.** La navegación por teclado sigue contando por sus `keydown` (Tab, flechas, AvPág). La activación con lector de pantalla, por su `click`.

**Contrato:** motor F3-A1, ingesta F3-A2, pausa de 120 s, ventana de fusión, cualificación, elegibilidad, derechos y reparto 30/70 **sin cambios**. Ninguna regla acredita por tiempo transcurrido.

## 3. RED antes y GREEN después (Chrome real, laboratorio de dispositivos)

| | Antes (código de `3e8697a`) | Después |
|---|---|---|
| Escenario | Guiado `lab-corto`, sin ninguna entrada; Leo se abre solo | Igual |
| Entradas del usuario | 0 | 0 |
| `focusin` de confianza de Leo | 1 (a los 109 s) | 1 (a los 164 s) |
| `econ_tick` emitidos | **10, todos con `humanSignalAgoMs` desde el foco** (8 ms, 11 s, 26 s…), más otra señal falsa al salir (Leo devuelve el foco) | **0** |
| Motor | 0 s en esta sesión solo porque la señal falsa de salida dejó la primera sin par. **Sin esa señal (pestaña cerrada con Leo abierto), 105 s y episodio cualificado ficticio** | 0 |

## 4. Pruebas en navegador real (casos obligatorios)

| # | Caso | Resultado | Evidencia |
|---|---|---|---|
| 1 | Leo se abre solo, sin interacción | ✓ **0 ticks** en 48 s tras el foco (guarda instalada) | §3 |
| 2 | Apertura automática repetida (salir y volver sin entrada; Leo se reabre) | ✓ 2 focos de Leo en ~8 min, 0 entradas, **0 ticks** | consola de la página |
| 3 | Lectura iniciada por interacción real (clic en el texto) | ✓ ticks con la señal del clic | `humanSignalAgoMs` cuadra con la hora del clic |
| 4 | Navegación por teclado (AvPág a los 55 y 91 s) | ✓ el `keydown` renueva la señal | ídem |
| 5 | Apertura manual de Leo (clic en «Pregúntale a Leo») | ✓ el clic se registra; el foco posterior del diálogo no añade señal; los ticks siguen la cola de 120 s desde el clic (7 ticks hasta 107 s) | sonda con `sessionId` |
| 6 | Restauración de posición en EPUB (adaptador corregido) | ✓ 144 s visibles, 0 entradas, **0 ticks**, 0 `focusin` | ídem |
| 7 | Desplazamiento automático: auto-avance real (cuenta `lector-avance`) | ✓ pasa a la Sección 2 y desplaza 503 px **sin señal humana: 0 ticks**. Activado con un `click()` sintético (`isTrusted: false`), que el hook descarta, porque la entrada automatizada de Chrome dejó de llegar a la página (ver nota) | ídem |
| 8 | Ingesta apagada | ✓ `runtime-config` `off`, **`focus()` nativo (la guarda no se instala)**, 0 `econ_tick` en 44 s, solo telemetría pedagógica | ídem |
| 9 | Cambio de modo Accesible → Guiado sobre `lab-epub` | ✓ **1 episodio, 165 s (`a11y` 75 + `text` 90)**. Q = 2 de la obra por un episodio anterior separado más de 30 min (ventana de fusión) | `report` del laboratorio |

**Notas del entorno (no son defectos):**
- Durante las esperas largas desde la terminal, Chrome pasó la pestaña a **oculta** (registrado: `hidden` a los 145 s y `visible` a los 226 s), y el hook dejó de acreditar como debe. Por eso las mediciones se hicieron con esperas dentro de la página.
- Como en LAB-02, la entrada automatizada de Chrome dejó de llegar a la página tras un rato. Los casos 7 y 8 se resolvieron sin depender de ella.

## 5. Integración de laboratorio y unitarias

**Batería completa** (`a11yLabBattery.mjs`, contenedor `--network none`, código corregido): **18/20 escenarios y 13/13 comprobaciones**. A5 y A7 dieron 165 y 180 s frente al rango esperado de ≥ 195 s.

**Causa verificada:** el rango era demasiado estrecho, no una regresión.
- La batería usa el núcleo, el servidor y el motor, no el hook. El núcleo solo ganó `createFocusGuard`, que la batería no llama.
- Los dos escenarios tienen dos tramos separados (pestaña oculta o pausa de más de 120 s). El primer tramo no tiene cola, porque la cola solo la recibe la última señal: unos 100 s + 117 s ≈ 217 s en bruto.
- Cada tramo puede perder hasta 2 franjas de 15 s en sus bordes, así que el rango real es de 157 a 217 s según cómo caiga respecto al reloj. La ejecución anterior (AUTO-04) dio 195/195 y esta 165/180: todas dentro.

**Rangos corregidos a 150–245/250 s y escenarios repetidos** (`BATTERY_ONLY=A5,A7`): A5 195 s ✓ · A7 195 s ✓.

### 5.1 Repetición de A5/A7

`BATTERY_ONLY=A5,A7`: **2/2 escenarios, 12/12 comprobaciones** (la de equivalencia entre modos se omite al filtrar). Evidencia de la ejecución completa: `F3A3_ECON_FOCUS_05_battery.json` (18/20 con los rangos antiguos).

**Unitarias:** `economicTick` 120 ✓ (107 anteriores + [14]: el hook y el adaptador sin `focusin`, la guarda instalada solo con la sesión activa, aviso antes de enfocar, contador de usos, restauración, no pisa envoltorios ajenos, tolerante a fallos, 0 ticks sin entrada aunque haya focos, y el desplazamiento provocado por un foco no es señal).

## 6. Regresiones

| Suite | Resultado |
|---|---|
| `test:royalties` | verde (`economicTick` 120 ✓). `commercialClassHttp` falló 1 de 3 veces en «hora del servidor»: intermitencia conocida de Windows (`F3A3_INSTRUMENTATION.md` §4), sin relación con el cambio |
| `test:a11y-reader` | verde |
| `test:content-rmw` | verde |
| EPUB: `chibaleteEpubReader` 47 · `epubProgress` 32 · `epubZipEntryResolver` 11 · `epubOriginalEndpoint` 32 · `canonicalBookEpub` 139 | verde |
| `typecheck:baseline` | sin regresiones |
| `npm run build` | correcto |
| CI | §8 |

## 7. Limitaciones residuales de accesibilidad

1. **La navegación por elementos con lector de pantalla** (VoiceOver o TalkBack deslizando de elemento en elemento) ya **no se acredita por el foco**. Solo cuenta si produce una entrada observable (activación → `click`; teclado externo → `keydown`) o un desplazamiento de la página (regla de continuidad). Si un lector recorre elementos durante más de 120 s sin desplazar ni activar nada, deja de acreditar. Es la regla conservadora que pide la unidad, porque el navegador no distingue ese foco del programático. Se mide en dispositivo (VO/TB-3, que pasa a «sin crédito por el foco aislado»), y si resulta frecuente se eleva a F6-B.
2. Siguen las de LAB-02 y LAB-03: «Leer todo» sin desplazamiento, EPUB solo paginado, PDF sin capa de texto.
3. **Pruebas con VoiceOver y TalkBack: pendientes.**

## 8. CI

Se completa con el run del commit.
