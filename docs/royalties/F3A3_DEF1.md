# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 / DEF-1 · Diagnóstico de Leo en Guiado

**Fecha:** 2026-10-27 · **Baseline:** `2e9caaf` · **Plan:** `PLAN_INTEGRADO_V1_4.md` · **Evidencia previa:** `F3A3_ACCESS_03_AUTO.md` (intacta)
**Laboratorio:** contenedor `chp-a11ylab-a9ab21a` (imagen `chp-a11ylab:a9ab21a`), arrancado de nuevo con `docker start` tras el cierre de Docker Desktop, sin reconstruir ni volver a sembrar; API y Vite relanzados con los mismos comandos (los registros anteriores se copiaron a `/tmp/lab_*.access03.log`).

**Veredicto:** **GREEN_LOCAL.** DEF-1 queda caracterizado y **no es un defecto de Leo, del hook ni del motor**: la pérdida del caso 12 la produjo el propio arnés de prueba al llevar la página a 0 después de que el Guiado reanudara la lectura, combinado con una regla del contrato (la marca de avance máximo). Repetido fielmente, el caso 12 es **GREEN_AUTO**. Sin cambios de producto; una prueba de caracterización nueva.

## A. Causa raíz

1. Al entrar en cada caso, el arnés de ACCESS-03-AUTO ejecutaba `location.hash = …; esperar 4 s; window.scrollTo(0,0)` (en el caso 12, a las 01:44:04Z).
2. En el caso 12 la cuenta `lector` ya tenía progreso en Guiado sobre `lab-largo` (caso 5, ≈ 2220 px). El Guiado **reanuda** en esa posición con un desplazamiento propio (`markProgrammaticScroll` + `scrollTo`), y el núcleo absorbe esa posición como **marca de avance** (`scrollBase`, máximo ya absorbido; `utils/economicTick.mjs`, `scrollObserved`).
3. El `scrollTo(0,0)` del arnés retrocede: no es señal y **no baja la marca** (`Math.max`).
4. Los 4 avances del caso (registro bruto de la sesión original: 0→444→888→1332→1776 px) quedaron **todos por debajo de la marca** (≈ 2220 px): ninguno podía renovar la señal. Solo quedó la cola de 120 s del clic de cierre.

Leo no interviene en la pérdida. Su apertura y cierre solo coincidieron en el tiempo.

- **Por qué solo el caso 12:** es el único caso en Guiado con progreso previo de la misma cuenta. El caso 5 fue la primera lectura en Guiado (sin reanudación). En los casos de Accesible (1, 3, 9 y 10) los avances desde 0 sí renovaron la señal: en los registros originales del caso 9 la señal baja a 1 s y 6 s antes de la pausa.
- **Por qué las sesiones `DIAG` sí acreditaron:** DIAG2 empezó en 2821 px, por encima de la marca previa.

## B. Reproducción (antes y después)

Chrome real contra `http://localhost:5173`, cuenta sintética `lector-avance` (la sesión abierta en el navegador), `lab-largo`, Guiado. Arnés de solo lectura: lee los `econ_tick` enviados, los desplazamientos, `scrollend`, la visibilidad, las llamadas a `focus()` y la apertura del diálogo de Leo. Avance = `window.scrollBy(½ pantalla)` sin entrada. Pestaña visible en todo momento.

| Ejecución | Secuencia | Leo | Avances | Resultado |
|---|---|---|---|---|
| R1 · caso 12 fiel, sin progreso previo (13:40–13:43Z, `01M5YSE6…`) | Entrar; clic en «Pregúntale a Leo» 13:40:27; «Cerrar» 13:40:32; avances desde la reapertura | Reapertura automática 13:41:02 (retención) | 13:41:04 (2 s tras el foco de Leo: absorbido como propio), 13:41:44, 13:42:24 y 13:43:04 | Los 3 avances posteriores **renuevan** la señal (`humanSignalAgoMs` 2 s, 8 s y 12 s). **180 s** acreditados |
| R3 · caso 12 fiel, con progreso previo (14 %, reanudación en 1534 px; 13:45–13:47Z, `01M5YSQK…`) | Igual que R1, desde la posición reanudada | Clic 13:45:40, cierre 13:45:46, reapertura automática 13:46:25 | 13:46:27 (absorbido), 13:47:07 y 13:47:47 | Los avances **renuevan** la señal (2,7 s). Leo manual, cierre y reapertura no bloquean nada |
| A · DEF-1 sin Leo manual (13:49–13:53Z, `01M5YSZN…`) | Entrar (reanuda en 3232 px); `scrollTo(0,0)` como el arnés original; clic en el texto 13:49:58 | Ninguna interacción manual. Se abrió solo al hidratar (O-2) | 8 avances desde 0 cada 30 s (473…2838 px, todos < 3232) | **Ninguno renueva** (`humanSignalAgoMs` 6 → 111 s; sin ticks desde 13:51:49). **105 s** acreditados (solo la cola del clic) = patrón del caso 12 |
| Original · caso 12 (`01M5XGES…`) | Ídem A, con Leo manual | Manual y reapertura | 0→1776 px < ≈ 2220 px | 120 s, señal 5 → 113 s |

Informe del servidor (`a11yLab.mjs report`): R1 180 s, R3 135 s (sesión hasta la salida 13:49:46; tramo con avances completo), A 105 s. La sesión de 13:45:17 (`01M5YSN8…`, 0 s) es la entrada de preparación: Leo se abrió al hidratar (O-2) y se cerró.

**Apertura automática y manual:** ningún `focus()` de Leo (apertura automática, manual, cierre o devolución del foco al botón) produjo señal ni ticks propios. El único desplazamiento absorbido como propio fue el que llegó ≤ 5 s después del foco del diálogo con `scrollend` pendiente: es la regla ECON-FOCUS-05, que funciona como está diseñada.

## C. Corrección

**No procede.** El componente de Leo (`LeoCompanion.tsx`), el visor (`VisorTexto.tsx`), el hook (`useEconomicTick.ts`) y el núcleo funcionan según su diseño. Que el desplazamiento por debajo de lo ya absorbido no cuente es una regla del contrato A11Y-FIX-01 («lo ya desplazado no cuenta»), no un fallo. Sin cambios en fórmulas, elegibilidad, episodios ni derechos.

**Prueba añadida** (`utils/__tests__/economicTick.test.mjs`, sección `[15]`): reproduce en el núcleo la secuencia del caso 12. Desde la posición reanudada, los 4 avances renuevan la señal. Tras volver a 0, ninguno lo hace. Es una **caracterización**: pasa antes y después, porque no hay corrección. Fija la causa y protege la regla frente a cambios no deliberados.

## D. Pruebas y regresiones

| Suite | Entorno | Resultado |
|---|---|---|
| `npm run test:royalties` | Windows | rc = 0; `economicTick` 122/0 (antes 120); `econEvents` 67/0; resto en verde. `econIngestHttp` y `accessB2cPreservation` se omiten aquí (solo POSIX) |
| `econIngestHttp` · `accessB2cPreservation` · `economicEpisodes` · `economicTick` | Contenedor `chp-a11ylab-a9ab21a-test` (sin red; mismo código de servidor, con la prueba nueva copiada) | 26/0 · 12/0 · 95/0 · 122/0 |
| Instrumentación de los 6 modos (estructural, `[11]`, `[13]` y `[14]` de `economicTick`) | Windows y contenedor | En verde. Sin cambios de código de producto: no hay superficie de regresión en otros modos |
| `a11yLabSelfTest.mjs` | Contenedor de pruebas | **No ejecutada**: exige `/tmp/chp_a11ylab` vacío y el contenedor conserva el de su ejecución anterior. No se forzó, porque no cambia ningún script del laboratorio |

Evidencias anteriores intactas: `F3A3_ACCESS_03_AUTO.md` y sus sesiones no se modifican. Las sesiones nuevas (`01M5YS…`) son de `LAB-AVANCE` y se suman a los episodios de `lab-largo` del laboratorio (Guiado). El contenedor `-test` se volvió a detener.

## E. Observaciones de Leo (sin efecto económico, sin cambios)

- **O-1 · Reaparición tras abrirlo a mano (prevista por el diseño actual):** el disparador de retención (`VisorTexto.tsx`, T1: 45 s sin desplazamiento) no se reinicia al abrir Leo a mano. Ni el reloj de inactividad (`lastActivityTimeRef`) ni el enfriamiento (`lastTriggerTimeRef`) cambian. Si el lector abre y cierra Leo antes de su intervención, Leo vuelve a abrirse solo unos 30–40 s después (R1: 30 s; R3: 39 s). No acredita nada. Es una cuestión de experiencia pedagógica: queda para decisión de producto (regla 8, Leo).
- **O-2 · Checkpoint al volver a entrar:** con un progreso guardado ≥ 20 % (o 40, 60, 80), la hidratación de la memoria hace «cruzar» el umbral desde 0 y Leo se abre al entrar (R3 de preparación y A). Tampoco acredita. Mismo tratamiento que O-1.

## F. Impacto sobre F3-A3

- **DEF-1 sale de la lista de defectos.** Se reclasifica como **S-5 (submedición por regla, conocida):** releer por debajo de la posición máxima ya alcanzada en la sesión, incluida la posición reanudada, no renueva la señal por desplazamiento. Un retroceso del lector con rueda o toque sí es señal; la relectura posterior sin entrada (p. ej., «Leer todo») solo se acredita como cola de 120 s. Va **a la baja**, sin crédito ficticio. Su posible ajuste es decisión de **F6-B**, junto con S-1 a S-4.
- **Caso 12: GREEN_AUTO** en la repetición fiel (R1 y R3). Matriz automatizada: **12/12 GREEN_AUTO**.
- El estado global de F3-A3 sigue pendiente de lo que no se automatiza: las 8 comprobaciones VO/TB (`F3A3_ACCESS_03_AUTO.md` §F) y el episodio en producción, que requiere autorización.
- **Lección para próximos arneses:** no llevar la página a 0 después de que un visor reanude; o partir de una cuenta y obra sin progreso en ese modo.

## G. Límites respetados

Sin despliegue. Ingesta económica solo en el laboratorio, como estaba. Sin cambios en la Doctrina, los datos o los recursos editoriales, ni en Studio Editor BI. Laboratorio conservado y sin limpieza de Docker. No se inicia F6-B.
