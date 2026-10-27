# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A3 / ACCESS-03-AUTO · Cobertura automatizada de los 12 casos

**Plan:** `PLAN_INTEGRADO_V1_4.md` · **Protocolo:** `F3A3_ACCESS_02.md` §E · **Seguimiento:** `F3A3_ACCESS_03.md` · **Baseline:** `ae2c432`
**Laboratorio:** contenedor `chp-a11ylab-a9ab21a` (imagen `chp-a11ylab:a9ab21a` con las correcciones locales L-1 y LAB-FIX-01), sin reiniciar ni reconstruir.

## A. Baseline y laboratorio

- Baseline `ae2c432` (= remoto). Preflight de `F3A3_ACCESS_03.md` (00:51Z) vigente: laboratorio sano, sin reiniciar ni reconstruir; correcciones L-1 y LAB-FIX-01 presentes; eventos confinados en `/tmp/chp_a11ylab`.
- No se repitieron baterías completas: la batería de ACCESS-01 (20/20 y 13/13) y la autoprueba de LAB-FIX-01 (33/33) se hicieron sobre el mismo código.
- Ejecución: 2026-10-27 00:56–02:22Z, Chrome de escritorio contra `http://localhost:5173` del mismo contenedor, con las cuentas sintéticas `lector` y `lector-avance`.

## B. Matriz de automatización

**Método (Chrome real de escritorio contra el laboratorio, `http://localhost:5173`):**
- **Entrada de confianza:** clics y teclas con la extensión de Chrome (CDP; `isTrusted = true`). Equivalen a la **activación** de VoiceOver/TalkBack (doble toque → `click`). **No** reproducen el gesto del lector.
- **«Leer todo» de un lector de pantalla:** se imita su efecto observable en la página, un avance de la ventana **sin ningún evento de entrada** (`window.scrollBy` desde un arnés en la página, sin `markProgrammaticScroll`). Es la misma forma de señal que produce VO/TB al desplazar mientras lee. **No** demuestra que VO/TB desplacen así en un dispositivo real.
- **Observación:** un arnés en la página envuelve `fetch` solo para **leer** los `econ_tick` reales del hook y las respuestas del servidor (no crea, cambia ni descarta eventos), y anota visibilidad, foco y desplazamientos. La verdad es el servidor: `a11yLab.mjs report` (sesión técnica, acreditado aislado, episodios del motor F3-A1).
- **Separación:** cada caso tiene sesión propia (identificada por `sessionId`) y ventana temporal propia. Las 3 sesiones del intento inválido (anteriores a las 00:49Z) quedan fuera.
- **Separación de episodios:** la fusión de episodios es por lector y obra (ventana de 30 min). Los casos de identidad de obra (7 y 8) se hacen con combinaciones lector-obra que no usa ningún otro caso: `lector` + `lab-epub` para el 7; `lector-avance` + `lab-corto` para el 8.

Clasificación: **AUTO** = reproducible y verificable de extremo a extremo sin tecnología de apoyo; **PARCIAL** = la lógica de medición se verifica, pero falta comprobar qué señales produce de verdad VO/TB; **MANUAL** = depende solo del dispositivo.

| # | Caso | Clase | Qué se reproduce | Qué queda fuera |
|---|---|---|---|---|
| 1 | Lectura continua | PARCIAL | Activación + avance de la ventana sin entrada | Que VO/TB desplacen la ventana mientras leen |
| 2 | «Leer todo» sin desplazamiento | PARCIAL | Activación y ninguna señal más (`lab-corto` cabe en pantalla) | La lectura sonora en sí |
| 3 | Navegación por elementos | PARCIAL | Avance de la ventana sin entrada ni activación | El foco virtual de VO/TB (no es foco DOM) y si desplaza |
| 4 | Avance automático | AUTO | Activación real de «Avance automático» (`lector-avance`) y espera | — (no depende del lector de pantalla) |
| 5 | Guiado sin narración | PARCIAL | Igual que el 1, en Guiado | Ídem 1 |
| 6 | EPUB paginado | PARCIAL | Paso de página con activación real del botón y parada | El gesto de paso de página de VO/TB dentro del iframe |
| 7 | Accesible → EPUB | AUTO | Cambio de modo real sobre la misma obra | — |
| 8 | Accesible → Guiado | AUTO | Cambio de modo real sobre la misma obra | — |
| 9 | Pausa y reanudación | PARCIAL | Lectura, pausa sin señales, reanudación sin gesto, activación | Que la pausa de VO/TB no emita entrada |
| 10 | Segundo plano | PARCIAL | Pestaña oculta de verdad (`visibilityState`) | Bloqueo de pantalla de iOS/Android y la suspensión de Safari/Chrome móvil |
| 11 | Leo automático | AUTO | Guiado sin entrada; Leo se abre solo y mueve el foco | El anuncio de VO/TB |
| 12 | Leo manual | PARCIAL | Activación de «Pregúntale a Leo», cierre y lectura | Cómo cierra el diálogo VO/TB |

## C. Casos ejecutados y resultados

Orden de ejecución: 1, 2, 3, 5, 9, 10, 11, 12, 7 (`lector`) y 8, 4, 6 (`lector-avance`). La tabla está en ese orden.

### Entorno de ejecución E-1 (pestaña oculta)

En el primer intento del caso 1 (sesión `01M5XDRF…`, 00:56:59–01:02:20Z), Chrome pasó la pestaña a `hidden` unos 20 s después de cada llamada de la extensión: dos parpadeos y un tramo oculto de 01:00:07 a 01:01:56. El hook hizo lo correcto: no acreditó nada oculto (dos ticks perdidos en el parpadeo de 2 s; 120 s acreditados de unos 150 s de ventanas) y, al volver, el desplazamiento **no** reabrió la lectura (más de 120 s sin señal).

- Es un **artefacto del entorno**, no del caso: queda como intento inválido de entorno, sin borrarlo. Es evidencia útil para el caso 10.
- **Mitigación desde entonces:** la pestaña se mantiene activa con consultas a la página cada ≤ 30 s, y cada caso registra los cambios de visibilidad. Un caso con ocultación no prevista se anota.

| # | Caso | Clase | Sesión | Ventana (UTC) | Acciones | Tiempo real | Ticks (aceptados / rechazados) | Acreditado | Esperado | Resultado |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Lectura continua (Accesible, `lab-largo`) | PARCIAL | `01M5XE4A…` | 01:03:24–01:08:39 | 1 clic de confianza en el primer párrafo; 7 avances de ½ pantalla sin entrada, cada 40 s, durante 300 s; salida a la Biblioteca | ≈ 307 s (clic 01:03:28 → cierre 01:08:35) | 21 / 0, todos visibles, señal ≤ 36 s | **300 s (98 %)** | ≥ 90 % de T | **GREEN_AUTO** |
| 2 | «Leer todo» sin desplazamiento (Accesible, `lab-corto`) | PARCIAL | `01M5XEEN…` | 01:09:03–01:12:30 | 1 clic de confianza; 180 s sin ninguna señal ni desplazamiento | ≈ 184 s | 8 / 0; señal de 12 → 117 s (solo la cola del clic) | **105 s** (no acreditado: ≈ 79 s, el 43 %, por pausa > 120 s sin señal) | ≤ 120 s | **GREEN_AUTO**: la limitación se confirma y queda medida |
| 3 | Navegación por elementos (Accesible, `lab-largo`) | PARCIAL | ninguna | 01:12:41–01:17:02 | **Sin** clic ni tecla; 5 avances de ½ pantalla sin entrada (cada 40 s, 240 s) | ≈ 240 s | **0 ticks**: no se abrió ninguna sesión económica | **0 s** | sin acreditación por foco o desplazamiento sin señal | **GREEN_AUTO** en la regla: no hay crédito ficticio. **Submedición legítima del 100 %**: el desplazamiento solo mantiene una lectura con señal vigente, nunca la abre |
| 5 | Guiado sin narración (`lab-largo`) | PARCIAL | `01M5XEX9…` | 01:17:02–01:21:37 | 1 clic de confianza; 5 avances de ½ pantalla sin entrada (cada 40 s, 240 s). **Leo se abrió solo** durante la lectura (diálogo visible al final) | ≈ 245 s | 17 / 0, señal ≤ 45 s | **240 s (98 %)** | ≥ 90 % de T | **GREEN_AUTO**. Además, la apertura automática de Leo no añadió señal (1 `focusin`, ningún tick extra) |
| 9 | Pausa y reanudación (Accesible, `lab-largo`) | PARCIAL | `01M5XF6F…` | 01:22:03–01:30:24 | Clic 01:22:07; lectura con avances sin entrada hasta 01:24:07; **pausa** de 180 s sin señales (01:24:07–01:27:07); **reanudación sin gesto**: avances sin entrada durante 120 s; clic 01:29:14 y 60 s más con avances | ≈ 492 s; lectura legítima ≈ 306 s (120 + 120 reanudada + 66) | 19 / 0: 13 antes de la pausa (la cola llega a 111 s), **ninguno durante la reanudación sin gesto**, 6 tras el clic | **120 s** (motor: 80 s de pares de señales antes de la pausa + 30 s + cola de 36 s tras el clic, en franjas completas) | ≤ T − 3 min (≤ 312 s), con crédito tras el clic | **GREEN_AUTO**: la pausa no acredita, la reanudación sin gesto no reabre y el clic sí. **Submedición medida: 39 % de la lectura legítima**, ver S-3 en §E |
| 10 | Segundo plano (Accesible, `lab-largo`) | PARCIAL | `01M5XDRF…` (E-1, ocultación real) y `01M5XFQP…` (intento con guion) | 00:56:59–01:02:20 y 01:31:27–01:37:39 | **E-1:** lectura con avances; la pestaña pasa a `hidden` de 01:00:07 a 01:01:56 mientras siguen 3 avances; vuelve a `visible`. **Guion:** se intentó ocultar abriendo otra pestaña y dejando de consultar 170 s, pero Chrome mantuvo la pestaña `visible` (la extensión la conserva activa): no hubo ocultación | E-1: ≈ 300 s, 109 s ocultos | E-1: 10 / 0; **ningún tick mientras estuvo oculta**; al volver, los avances **no** reabren (> 120 s sin señal). Guion: 25 / 0, todos visibles | E-1: 120 s, nada del tramo oculto. Guion: 345 s de ≈ 353 s (lectura continua, no caso 10) | nada acreditado mientras está oculta | **GREEN_AUTO** por la evidencia real de E-1. El guion no consiguió ocultar la pestaña (anotado, no cuenta). Falta el bloqueo de pantalla real de iOS/Android |
| 11 | Leo automático (Guiado, `lab-corto`) | AUTO | ninguna | 01:40:59–01:43:57 | Ninguna entrada durante 174 s. **Leo se abrió solo a los 42 s** (01:41:44, `focusin` en el diálogo, que siguió abierto hasta el final) | ≈ 174 s | **0 ticks**, ninguna sesión económica | **0 s** | 0 s | **GREEN_AUTO** |
| 12 | Leo manual (Guiado, `lab-largo`) | PARCIAL | `01M5XGES…` | 01:44:05–01:47:42 | Clic de confianza en «Pregúntale a Leo» (01:44:14), clic en «Cerrar» (01:44:27), 4 avances de ½ pantalla sin entrada (01:45:07, :47, 01:46:27, 01:47:07). **Leo se volvió a abrir solo a las 01:45:05** | ≈ 203 s | 9 / 0; señal de 5 → 113 s **desde el clic de cierre**; los avances **no** renovaron la señal | **120 s** (gestos + cola de 120 s) | Gestos acreditados; el foco del diálogo y su devolución no añaden señal; la lectura posterior acredita por desplazamiento | **YELLOW**: sin acreditación ficticia (los focos de abrir y cerrar no suman), pero la lectura posterior **no** acreditó → defecto candidato **DEF-1** (§E). Un diagnóstico aparte (sesiones `DIAG`, 01:48–01:54) mostró que con Leo abierto automáticamente, y con Leo cerrado sin reapertura, los avances **sí** cuentan. El fallo aparece solo cuando Leo se reabre tras una apertura manual temprana |
| 7 | Accesible → EPUB (`lector`, `lab-epub`) | AUTO | `01M5XH3B…` (a11y) + `01M5XH7B…` (epub) | 01:55:18–01:59:45 | Accesible: clic + 4 avances sin entrada (cada 30 s, 120 s). Cambio al lector EPUB (página completa) y 4 pasos de página con clic de confianza en «›» cada 30 s (120 s); salida a la Biblioteca | ≈ 127 s + 119 s; 17 s de transición | 9 + 9 / 0; mismo `contentId` | a11y **105 s** + epub **105 s** | **1 episodio**, `a11y` + `epub`, Q = 1, ≤ 6 min | **GREEN_AUTO**: 1 episodio de `lab-epub`, 210 s `{"a11y":105,"epub":105}`, cualificado, Q = 1 |
| 8 | Accesible → Guiado (`lector-avance`, `lab-corto`) | AUTO | `01M5XHVH…` (a11y) + `01M5XHZX…` (text) | 02:08:30–02:12:59 | Accesible: 4 clics de confianza cada 30 s (120 s); cambio a Guiado y 4 clics cada 30 s (120 s); salida | ≈ 127 s + 106 s | 10 + 9 / 0; mismo `contentId` | a11y **120 s** + text **105 s** | **1 episodio**, `a11y` + `text`, Q = 1, ≤ 6 min | **GREEN_AUTO**: 1 episodio de `LAB-AVANCE`/`lab-corto`, 225 s `{"a11y":120,"text":105}`, cualificado |
| 4 | Avance automático (`lector-avance`, Accesible, `lab-largo`) | AUTO | `01M5XJ41…` | 02:13:10–02:17:44 | 1 clic de confianza en «Avance automático» (interruptor `aria-checked=true`); 240 s sin tocar. El auto-avance desplazó la página 514 px a las 02:15:50 | ≈ 250 s | 8 / 0; señal de 10 → 115 s (solo la cola del clic) | **90 s** | ≤ 120 s | **GREEN_AUTO**: el desplazamiento del auto-avance no renueva la señal |
| 6 | EPUB paginado (`lector-avance`, `lab-epub`) | PARCIAL | `01M5XJCR…` | 02:17:55–02:22:20 | 4 pasos de página con clic de confianza en «›» (02:18:00, :47, 02:19:16, :46); después **153 s parado** en la misma página | ≈ 260 s | 15 / 0 | **195 s** (tramo con pasos ≈ 106 s + cola < 120 s; nada más allá) | ≥ 90 % de T con pasos; parado: ≤ 120 s | **GREEN_AUTO**: la parada acredita solo la cola (< 150 s). El paso de página de VO/TB dentro del iframe queda para el dispositivo |

### Entorno E-2 (pérdida de entrada automatizada)

Tras cambiar de cuenta (cerrar sesión e iniciar con `lector-avance`, 02:00Z), los clics y teclas de la extensión **dejaron de llegar a la página**. Un oyente en captura registró 0 eventos ante un clic y una tecla. Es el fallo ya documentado en ECON-FOCUS-05 §4.

- El primer intento del caso 8 (02:00:50–02:05:21) quedó **sin ningún tick**: no llegó ninguna entrada. Se anota como **intento inválido de entorno**, sin sesión económica.
- Se resolvió abriendo una pestaña nueva. Desde entonces el arnés cuenta las entradas de confianza recibidas en cada caso (`inputs`); el caso 8 válido registra 8 de 8.

### Controles transversales (todas las pruebas desde las 00:49Z)

| Control | Resultado |
|---|---|
| Ticks económicos | 183 (más 17 `econ.session_start`), de 2 usuarios sintéticos y 3 obras sintéticas |
| Rechazos de la ingesta | **0** (107 lotes `[ECON]`, todos con `rejected=0`) |
| Límite de ticks | máximo **5 por usuario y minuto** (límite: 12) |
| Identidad de obra | 0 sesiones con más de una obra o modo; los cambios de modo crean una sesión por modo con el mismo `contentId` y el motor los une en un solo episodio (casos 7 y 8) |
| Doble contabilización | el motor une las franjas por obra; no suma pestañas ni modos (casos 7 y 8: total = suma de modos sin solapes) |
| Respuestas 5xx del laboratorio | 0 |
| Datos sintéticos | `content.json` `65ecdab8b76c73da` y `access.json` `41fec62ce322ebf3` sin cambios; `users.json` cambia solo por `lastLoginAt` de los inicios de sesión |
| Producción | sin tocar |

Sesiones de diagnóstico de DEF-1 (`DIAG`, `lector`, `lab-largo`, Guiado, 01:48–01:54Z): son exploratorias y no son un caso. Suman tiempo al episodio de `lab-largo` del laboratorio.

## D. Cobertura real obtenida

- **Verificado de extremo a extremo** con Chrome real, el hook real, la ingesta real y el motor F3-A1, para los 12 casos: la regla de cada caso y su resultado económico.
- **No verificado:** qué eventos producen de verdad VoiceOver (Safari/iOS) y TalkBack (Chrome/Android):
  - si «Leer todo» desplaza la ventana;
  - si la navegación por elementos produce `click` o desplazamiento;
  - cómo pasa página el lector dentro del iframe EPUB;
  - qué ocurre al bloquear la pantalla.

  La simulación imita la **forma** de esas señales; no demuestra que existan. **Ningún caso se declara superado con VoiceOver ni con TalkBack.**
- **Fuera de cobertura:** Inmersivo y Álbum (TTS en `mock`; los cubre la batería de ACCESS-01) y PDF sin capa de texto.

## E. Errores y submediciones identificados

| Id | Tipo | Hallazgo | Magnitud medida | Dirección |
|---|---|---|---|---|
| **S-1** | Submedición por regla (conocida) | Lectura sin desplazamiento: solo la cola de 120 s tras el último gesto (caso 2) | 105 s de 184 s (57 %) | a la baja, por contrato |
| **S-2** | Submedición por regla | Navegación con desplazamiento pero **sin ninguna activación**: 0 s; el desplazamiento solo **mantiene** una lectura con señal, nunca la abre (caso 3) | 0 s de 240 s | a la baja, por contrato |
| **S-3** | Submedición por regla del motor | Una pausa de más de 120 s entre señales excluye **todo** el tramo, también la cola previa, y la reanudación sin gesto no reabre (caso 9) | 120 s de ≈ 306 s de lectura legítima (39 %) | a la baja, por contrato (`economicEpisodes.mjs`: «Un hueco mayor se excluye completo») |
| **S-4** | Pérdida por redondeo | Solo franjas de 15 s completas; la primera y la última franja parciales se pierden | 0–15 s por sesión (casos 1, 5, 7, 8) | a la baja, por contrato |
| **DEF-1** | **Defecto candidato** (no corregido) | Guiado: si Leo se abre a mano antes de su intervención automática (≈ 42 s) y se cierra, su intervención se dispara después y, desde entonces, los desplazamientos de la ventana **no** renuevan la señal: solo queda la cola de 120 s del cierre (caso 12) | 120 s acreditados; ≈ 75 s de lectura con desplazamiento perdidos en el caso | **a la baja**: sin crédito ficticio |
| L-1 | Entorno del laboratorio | `dataService.ts:145` (`crypto.randomUUID`) rompe la app fuera de contexto seguro | — | no afecta a producción (HTTPS) |
| E-1 / E-2 | Entorno de automatización | Ocultación de la pestaña tras unos 20 s sin consultas; pérdida de la entrada automatizada tras cambiar de cuenta | — | anotados; intentos marcados inválidos |

**Ningún RED:** no hubo acreditación ficticia (foco, auto-avance, desplazamiento sin señal, Leo automático, pestaña oculta), atribución incorrecta, acceso indebido, rechazos ni superación de límites.

## F. Pruebas manuales estrictamente indispensables

En lugar de las 24 ejecuciones originales: **8 comprobaciones** (4 por tecnología). Cada una cubre una diferencia que la automatización no puede observar. Se hacen con el `report` del laboratorio tras cada una, como en `F3A3_ACCESS_02.md` §E.

| # | Comprobación (VO en iPhone/Safari y TB en Android/Chrome) | Qué demuestra | Sustituye a | Criterio |
|---|---|---|---|---|
| M-1 | Un doble toque en el texto + «Leer todo» **5 min** en Accesible `lab-largo` | Que el lector **desplaza la ventana** mientras lee (y por tanto acredita como en el caso 1 automatizado) | 1, 5 (y la base de 9 y 12) | GREEN ≥ 90 % de T; YELLOW si se queda en ≤ 120 s (el lector no desplaza: S-1/S-2 se vuelven frecuentes → F6-B) |
| M-2 | **Sin** doble toque: deslizar de elemento en elemento **3 min** | Si el foco virtual produce algún `click`/desplazamiento. Lo esperado por regla: 0–120 s | 3 | GREEN ≤ 120 s; RED > 150 s sin desplazamiento |
| M-3 | EPUB `lab-epub`: pasar **3 páginas** con el gesto del lector y quedarse 2 min | Que el gesto de página del lector llega como señal dentro del iframe | 6, 7 | GREEN: acredita los pasos y la cola ≤ 120 s; YELLOW si los pasos no acreditan |
| M-4 | Accesible `lab-largo`: «Leer todo» 1 min → **bloquear la pantalla 2 min** → desbloquear y esperar 1 min | La suspensión real del sistema (no la pestaña oculta de escritorio) | 10 (y 9) | GREEN: nada acreditado bloqueada ni tras volver sin gesto |

Sin repetir en dispositivo (AUTO, no dependen del lector): 4, 7, 8, 11. Del 12 basta con anotar en M-1 si Leo aparece y cómo se cierra; DEF-1 se trata aparte. Duración estimada: unos 15 min por dispositivo.

## G. Impacto sobre F3-A3 y F3-B

- **F3-A3:**
  - La medición accesible queda **verificada en su lógica** con navegador real: 11 de 12 casos GREEN_AUTO y 1 YELLOW (DEF-1, a la baja).
  - Sigue **sin** verificarse con VO/TB reales: quedan las 8 comprobaciones de §F.
  - Además, el gate del Plan sigue exigiendo 1 episodio en producción con la ingesta encendida, que requiere autorización.
- **F3-B:** no se desbloquea por esta unidad. Las submediciones S-1, S-2 y S-3 son reglas de contrato y su posible ajuste es una decisión de **F6-B**. DEF-1 conviene diagnosticarlo antes de encender la ingesta en producción, aunque solo reduce crédito.

## H. Documentación

Este documento; `F3A3_ACCESS_03.md` (seguimiento); `SEGUIMIENTO_PLAN_V1_1.md` fila 7. El arnés de observación y las utilidades de solo lectura usadas viven fuera del repositorio (scratchpad de la sesión). No se escribieron credenciales.

## I. Veredicto

**YELLOW_ACCESS.**
- **GREEN_AUTO** en todo lo automatizable: 11 casos GREEN_AUTO, 1 YELLOW por el defecto candidato DEF-1 (submedición, sin crédito ficticio), 0 RED.
- Los comportamientos reales de VoiceOver y TalkBack siguen sin verificar y se reducen a las **8 comprobaciones manuales** de §F.
- No se convierte en GREEN_ACCESS por inferencia.
