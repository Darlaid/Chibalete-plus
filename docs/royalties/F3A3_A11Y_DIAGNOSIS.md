# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 · Diagnóstico de accesibilidad (lectores de pantalla)

**Fecha:** 2026-10-24 · **HEAD auditado:** `dc22e19` · **Plan:** `PLAN_GENERAL_V1_1.md` §4.2, §4.6, unidad 7 (G4) · **Decisiones:** `DECISIONES_F0C.md` P3
**Modo:** diagnóstico y propuesta. **No hay cambios de código.** La propuesta requiere aprobación expresa antes de implementarse, porque cambia qué cuenta como señal en la acreditación.
**Estado de la accesibilidad:** **NO VERIFICADA.** Faltan todas las pruebas en dispositivo.
**CI de HEAD:** GREEN (`security`, `content-rmw` en el intento 2 e `identity-preflight` en el intento 3). Ver `F3A3_INSTRUMENTATION.md` §6.

## 1. Qué acredita hoy la actividad

Las reglas de tiempo (franjas de 15 s, pausa de 120 s, tope de 20 min, 45 s para cualificar) viven en el motor F3-A1 y no se tocan. El cliente solo declara dos cosas:

| Vía | Qué la alimenta en el cliente (`utils/economicTick.mjs`, `hooks/useEconomicTick.ts`) | Qué hace el motor (`economicEpisodes.mjs`) |
|---|---|---|
| **Visual** | Señal humana = evento de confianza en captura sobre `document`: `pointerdown`, `keydown`, `wheel`, `touchstart`, `click`, `focusin`. En EPUB, además, la interacción dentro de los iframes y los `relocate` con motivo `page`, `snap`, `scroll` o `navigation`. **El `scroll` del documento no cuenta.** | Acredita entre dos señales separadas por ≤ 120 s y la cola de ≤ 120 s tras la última, siempre que la pestaña esté visible. **Un hueco de más de 120 s entre señales se excluye entero.** |
| **Escucha** | Avance real del medio de **narración** del visor (Guiado, Inmersivo, Álbum), no silenciado, iniciado ≤ 10 s después de una señal | Acredita el avance dentro de `[señal, señal + 20 min]` (P3). No exige visibilidad. |

## 2. Por qué la lectura continua con lector de pantalla deja de acreditarse

En la lectura continua ("Leer todo" de VoiceOver con dos dedos hacia abajo, o "Leer desde arriba" / "Leer desde el siguiente elemento" de TalkBack), el lector de pantalla recorre el texto con su **cursor de accesibilidad**:

1. **No hay ningún evento de entrada.** No se producen `pointer*`, `touch*`, `key*` ni `click`. Al gesto de inicio lo consume el lector de pantalla y no llega a la página.
2. **El foco del DOM no se mueve sobre texto que no es enfocable.** El cursor de accesibilidad no es el foco del documento, así que no hay `focusin`.
3. **La web no expone el cursor del lector de pantalla ni su presencia.** No existe ninguna API para saber qué está leyendo, por diseño y por privacidad. Los eventos de accesibilidad del AOM nunca se publicaron.
4. **Lo único observable es el desplazamiento.** Cuando el texto que toca leer queda fuera de pantalla, el navegador desplaza la página para mostrarlo y se produce un evento `scroll`. Pero F3-A3 excluye el `scroll` a propósito, porque los visores también desplazan solos (auto-avance del Modo Accesible, sincronía del Inmersivo, reanudación del Guiado), y un `scroll` programático también llega con `isTrusted = true`.

**Resultado:** después de la última señal, el motor acredita como mucho 120 s de cola. Si la lectura sigue más tiempo sin señales, ese tramo no se acredita, y el hueco completo queda excluido cuando por fin llega otra señal. Una persona ciega que escucha un capítulo de 10 min con "Leer todo" acredita como mucho unos 2 min. Es una **desventaja sistemática** según §4.6 del Plan y bloquea G4.

**La vía de escucha no lo compensa:** el habla del lector de pantalla no es un medio de la página, así que no se puede observar, y no debe acreditarse como si fuera narración.

## 3. Diagnóstico por modo

| Modo | Uso con lector de pantalla | Señales que existen hoy | Riesgo en la lectura continua |
|---|---|---|---|
| `a11y` (`VisorAccesible`) | Es el modo previsto para lectores de pantalla. Segmentos con navegación propia (botones y teclado) y `aria-live` | `click` o `keydown` al pasar de segmento (con lector de pantalla, el doble toque llega como `click`). El `focusin` que provoca `goToSegment` viene de una acción del lector. **El auto-avance solo desplaza (`advanceSegmentAuto` → `scrollElementIntoReadingBand`) y no mueve el foco**, como corresponde a P3. | **ALTO.** "Leer todo" sobre el texto no genera señales. Navegar segmento a segmento con los botones sí acredita. |
| `text` (Modo Guiado) | Lectura con el TTS propio (`audioRef`) o con el lector de pantalla sobre el texto | Señales de interacción y vía de escucha si suena el TTS | **Bajo** con el TTS propio: acredita hasta el tope de 20 min, y basta un gesto para renovarlo. **Alto** si el lector de pantalla lee el texto sin el TTS. |
| `immersive` | Narración A/B propia | Vía de escucha | **Bajo** (igual que el Guiado con TTS) |
| `album` | Narración por región; imágenes | Vía de escucha | **Bajo** con narración. Sin narración, el lector de pantalla solo lee textos alternativos. |
| `epub` | El lector de pantalla entra en los iframes del libro | Interacción en los iframes y `relocate` de navegación | **Medio, sin confirmar.** Queda por ver en dispositivo si "Leer todo" pasa de página y con qué motivo de `relocate`. Si pasa como `page` o `scroll`, ya acredita. Si se detiene al final de la página, el lector tiene que pasar de página, y eso sí es una señal. |
| `pdf` | **El PDF se dibuja en un `canvas` sin capa de texto** (`VisorPDF` no usa `textLayer`): el lector de pantalla no puede leer el contenido | Navegación de página | No aplica a la lectura con lector de pantalla. Es una brecha de accesibilidad del visor, no de la medición, y queda fuera de esta unidad. |

**Hallazgo lateral (sin defecto confirmado):** un `.focus()` programático dispara `focusin` con `isTrusted = true`, así que el hook lo contaría como señal. Revisé el Modo Accesible, el Guiado, el lector EPUB y sus componentes: todos los `.focus()` llegan después de una acción del lector (abrir un menú, un índice o un enlace de salto). No encontré ningún foco automático al cargar ni al reanudar. Se recomienda una prueba estructural que lo mantenga así (§5).

## 4. Propuesta mínima

### 4.1 Alternativas

| | Alternativa | Fabrica actividad | Exige interacción táctil | Toca el contrato F3-A1/F3-A2 | Valoración |
|---|---|---|---|---|---|
| **A** | **Desplazamiento de navegación como señal**, en los modos y estados donde el visor no desplaza solo | No: es un desplazamiento real de la página, provocado por el lector o por su lector de pantalla | No | **No.** El Plan §4.2 ya incluye "navegación y señales propias de tecnologías de apoyo"; no cambia ningún tiempo. | **Recomendada** |
| B | Hacer enfocables los párrafos para que VoiceOver y TalkBack muevan el foco al navegar por gestos | No | Solo sirve para la navegación por gestos, no para "Leer todo" | No | Complementaria. Depende de cada dispositivo y cambia la experiencia del lector de pantalla (más paradas). No se recomienda por ahora. |
| C | Aviso periódico "¿Sigues leyendo?" o un botón de continuidad | No | **Sí** | No | **Rechazada:** es una verificación invasiva (P3) y exige acciones que no hacen falta. |
| D | Ampliar la pausa de 120 s o aplicar el tope de 20 min de P3 a la vía visual en el Modo Accesible | **Sí:** acreditaría tiempo no demostrado | No | **Sí:** cambia `pauseExclusionSeconds` o la semántica de P3 y exige un `rule_set` nuevo | **Rechazada** en F3-A3. Si se quiere, es una decisión de producto para F6-B. |
| E | Detectar el lector de pantalla | — | — | — | **Imposible e indebido:** la web no lo expone, y hacerlo sería una huella sobre la discapacidad. |

### 4.2 Detalle de A (aún no implementada)

Solo en `utils/economicTick.mjs` (función pura que decide), `hooks/useEconomicTick.ts` (un listener más) y una opción por visor. Sin cambios en el servidor, el motor, el validador ni la base de datos.

1. **El `scroll` del documento cuenta como señal de navegación solo si se cumplen TODAS estas condiciones:**
   - el visor declara que en ese momento **no desplaza solo**. Cada visor aporta un `isAutoScrolling()`: el Accesible con el auto-avance encendido, el Inmersivo durante la sincronía y el Guiado mientras suena el TTS o reanuda la posición. En esos estados ya existe la vía de escucha o el auto-avance, que según P3 no es señal;
   - no hubo un desplazamiento programático propio en los últimos 1,5 s (marca alrededor de cada `scrollTo` o `scrollIntoView` del visor);
   - la posición **avanza de verdad**: un desplazamiento neto de al menos media altura de línea desde la última señal por desplazamiento;
   - como mucho una señal por desplazamiento cada 15 s (una franja). Así un desplazamiento continuo no inunda la cola y no se gana nada respecto de una sola señal por franja.
2. **No cambia nada más:** visibilidad obligatoria, pausa de 120 s, 45 s para cualificar, 3 episodios al día, unión entre modos y atribución por el servidor.
3. **EPUB:** sin cambios en el cliente. Los `relocate` con motivo `scroll` ya cuentan; solo hay que confirmarlo en dispositivo.

### 4.3 Riesgo residual de A (hay que aceptarlo explícitamente)

- **Antifraude:** una extensión de desplazamiento automático produciría señales, igual que hoy lo haría un clic automático. Siguen aplicándose los mismos límites: pestaña visible, máximo 3 episodios por obra y día, P12 (anomalías, en F3-B) y la exclusión por un administrador.
- **"Leer todo" sin desplazamiento:** si todo el texto que se lee cabe en pantalla, no hay `scroll` ni señal, y tras 120 s se deja de acreditar. Con segmentos cortos ocurre poco, porque la lectura pasa de segmento enseguida. Se mide en dispositivo (matriz §6, VO-2 y TB-2). Si es frecuente, la decisión pasa a F6-B (alternativa D o una señal accesible explícita), no a F3-A3.

## 5. Pruebas automáticas

**Ya existentes (verdes en `dc22e19`):**
- `economicTick`: 62 ✓, con inercia estructural en los 6 visores, sin listeners ni red con la ingesta apagada, el scroll que no cuenta como señal, los seeks, el silencio y el relevo A/B;
- `test:a11y-reader`: auto-avance, hooks, estructural y desbloqueo, todo ✓;
- `test:royalties`.

**Pendientes si se aprueba A:**
- núcleo puro: un `scroll` durante `isAutoScrolling()` o tras una marca programática no cuenta; un `scroll` sin avance neto no cuenta; como máximo una señal por franja;
- una lectura de 10 min con desplazamiento cada 40 s acredita los 10 min, y la misma lectura con desplazamiento programático acredita 0;
- prueba estructural: cada `scrollTo` o `scrollIntoView` de los visores instrumentados pasa por la marca programática, y ningún `.focus()` se ejecuta al montar ni al reanudar sin acción del lector;
- equivalencia entre modos (G4): el mismo perfil leído con lector de pantalla en `a11y` y leído visualmente en `text` da el mismo número de minutos acreditados, con una tolerancia de una franja.

## 6. Matriz de pruebas manuales (dispositivo real; ingesta encendida solo en un entorno de pruebas)

Requisitos: entorno de pruebas con `ECONOMIC_INGEST_MODE=enforce`, una cuenta de pruebas y una obra de pruebas. **Nunca en producción.** El resultado se lee en `econ_events` y con una vista previa del motor.

| ID | Dispositivo y AT | Modo | Acción | Resultado esperado | Aceptación |
|---|---|---|---|---|---|
| VO-1 | iPhone, Safari, VoiceOver | a11y | Navegar segmento a segmento con los botones durante 5 min | Ticks con señal en cada franja | Minutos acreditados ≥ 90 % del tiempo real |
| VO-2 | iPhone, VoiceOver | a11y | "Leer todo" durante 10 min sin tocar la pantalla | **Hoy:** ≤ 2 min acreditados (defecto confirmado). **Con A:** señales por desplazamiento | Con A: ≥ 90 % acreditado. Si no hay desplazamiento, registrar cuántas veces ocurre. |
| VO-3 | iPhone, VoiceOver | epub | "Leer todo" al cruzar 3 páginas | `relocate` con motivo `page` o `scroll` | Señal al cambiar de página; sin huecos de más de 120 s mientras haya lectura |
| VO-4 | iPhone, VoiceOver | text | Iniciar el TTS propio con doble toque y bloquear la pantalla 10 min | Vía de escucha con `gesture: true` | 10 min acreditados (por debajo del tope de 20 min) |
| VO-5 | iPhone, VoiceOver | a11y | Auto-avance encendido, sin interactuar, 5 min | **Sin** señales (P3) | Acredita como mucho 120 s después del último gesto |
| TB-1…TB-5 | Android, Chrome, TalkBack | los mismos casos que VO-1…VO-5 | "Leer desde arriba" o "desde el siguiente elemento"; doble toque para activar | Los mismos | Los mismos |
| X-1 | Cualquiera | a11y → text → epub | Leer 3 min en cada modo con lector de pantalla | 1 episodio, Q = 1 | Unión, nunca suma |
| X-2 | Cualquiera | todos | Ingesta apagada | Ninguna petición a `/api/v1/events` desde el hook | 0 peticiones en el inspector de red |

## 7. Impacto sobre el contrato económico

- **Diagnóstico:** ninguno. No hay cambios de código.
- **Alternativa A:** solo amplía en el cliente las señales de navegación que el Plan §4.2 ya admite. **Sin cambios** en el motor F3-A1, la ingesta F3-A2, `rs-2026-01-v1`, los episodios, los tiempos, la elegibilidad, la atribución ni la distribución. No hay `rule_set` nuevo.
- Las alternativas C y D quedan descartadas en esta unidad. D sí tocaría el contrato.

## 8. Decisiones que requieren aprobación

1. **Aprobar o rechazar la alternativa A**, el desplazamiento de navegación como señal con las cuatro guardas de §4.2, y aceptar su riesgo residual (§4.3).
2. **Quién hace las pruebas en dispositivo** (VoiceOver en iOS y TalkBack en Android) y en qué entorno de pruebas con la ingesta encendida. Sin ellas G4 sigue abierto y F3-A3 no puede ser GREEN según el Plan.
3. **Si "Leer todo sin desplazamiento" resulta frecuente** (VO-2 y TB-2), abrir para F6-B la decisión sobre D o sobre una señal accesible explícita.
4. **Fuera de la medición:** el PDF sin capa de texto no se puede leer con lector de pantalla. Es una brecha de accesibilidad del visor, a priorizar en una unidad aparte.
