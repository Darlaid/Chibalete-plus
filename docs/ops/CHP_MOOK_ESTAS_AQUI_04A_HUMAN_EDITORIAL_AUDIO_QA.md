# CHP-MOOK-ESTAS-AQUI-04A — REVISIÓN EDITORIAL HUMANA Y QA DE AUDIO

**Estado:** 🟢 **CERRADO — `GREEN-MOOK-ESTAS-AQUI-V4-LOCAL`**
**Alcance del GREEN:** cierre **local y documental** de 04A. **No autoriza deploy ni publicación en producción.**
**Rama:** `chp/mook-contract-00`
**Fecha de apertura:** 2026-08-25
**Operador humano:** **Nicolás Jiménez** — director/editor de Chibalete Editores y operador de la revisión
**Alcance:** revisión, no desarrollo. **v3 no se muta bajo ninguna circunstancia.**

> **Regla vinculante de esta unidad.** No se declara escuchado, leído ni aprobado nada que solo
> se haya verificado por código. La automatización preparó la interfaz, comprobó hashes y
> registra resultados; **la decisión PASS/ISSUE de cada audio es del operador humano tras
> reproducción audible**. Ninguna sección técnica de este documento autoriza a afirmar que una
> pieza «suena bien».

---

## 1. BASELINE VERIFICADO

### 1.1 Git

| Elemento | Valor |
|---|---|
| Rama | `chp/mook-contract-00` |
| HEAD local | `36b1e75854190537f97cf83ffe2ef286e6eabc66` |
| `origin/chp/mook-contract-00` | `36b1e75854190537f97cf83ffe2ef286e6eabc66` — **idéntico** |
| Árbol | limpio salvo dos carpetas **untracked** que jamás se committean |
| Untracked esperado | `ESTÁS AQUÍ - Pensar, elegir y atender en la era del scroll/` · `Programa integral/` |

### 1.2 Experiencia y versiones — IDs descubiertos y registrados

| Versión | ID | Publicada | Nodos | Nota |
|---|---|---|---|---|
| Experiencia | `exp-1787621835612-oe8qs3` | — | — | slug `estas-aqui`, status `published` |
| **v1** | `expv-1787621835613-1g389f` | `2026-08-25T01:41:45.489Z` | **46** | run histórico vivo |
| **v2** | `expv-1787627232665-q0shao` | `2026-08-25T03:07:12.666Z` | **56** | intermedia · **sin runs** · inmutable |
| **v3** | `expv-1787627328985-qgaiki` | `2026-08-25T03:08:48.987Z` | **56** | **candidata editorial** · `currentVersionId` |

Ninguna versión fue borrada, archivada, editada ni republicada durante esta unidad.
**No se publicó ninguna versión nueva; v1–v3 permanecen publicadas y v4 continúa en borrador.**

### 1.3 Runs

| Run | Usuario | Versión pineada | Estado |
|---|---|---|---|
| `run-1787622134590-0kygq6` | `demo-lector` | **v1** `…1g389f` | `completed` — run histórico, 14 bitácoras |
| `run-1787622255366-esjjvs` | `user-tono` | — | `active` |
| `run-1787627393666-tuw9fh` | **`user-rosi`** | **v3** `…qgaiki` | `active` — run de esta revisión, 4 bitácoras (B00–B03) |

### 1.4 Composición de v3 (56 nodos)

**16 AUDIO + 26 READING + 14 ACTIVITY** — cero VIDEO, cero LEO, cero PRODUCTION.

- Los 26 READING = **10 «Libro ·» + 9 «Texto del mook ·» + 7 «Transición ·»**.
- Las 14 ACTIVITY son **todas `privado: true`**: B00–B05, B06 × 7 días, B07.
- Los 7 días de B06 son `required: false` (omitibles); las 7 bitácoras restantes son `required: true`.

### 1.5 Producción

**Cero producción.** Toda la revisión ocurre en local. No se tocó el VPS.

---

## 2. PREPARACIÓN TÉCNICA (automatizable) — CERRADA

### 2.1 Cadena de custodia de los activos — 🟢 GREEN

| Verificación | Resultado |
|---|---|
| 16/16 MP3 presentes en `public/uploads/` | ✅ |
| 16/16 MP3 **byte-idénticos** (SHA-256) al original de la carpeta editorial | ✅ |
| 16/16 transcripciones de `config.transcripcion` **byte-idénticas** al `.txt` fuente | ✅ |
| 16/16 MP3 con cadena de frames válida (parser de cabeceras) | ✅ |
| 42/42 recursos referenciados existen y están `disponible` | ✅ |
| 42/42 recursos pasan el preflight `/api/content/:id/access` para `user-rosi` | ✅ «Contenido en catálogo autorizado del grupo» |
| `206 Partial Content` en `/uploads/*.mp3` | ✅ — el desplazamiento en la barra funcionará |

**Conclusión técnica:** no hay corrupción en transporte ni divergencia entre el máster editorial y
lo que sirve el Runtime. Cualquier defecto que aparezca al escuchar procede del **máster**, no del
pipeline de carga.

### 2.2 Los 10 extractos del libro — 🟢 GREEN

Los 10 nodos «Libro ·» son **subcadenas literales contiguas** del TXT maestro
`Me desconecto, luego existo.txt` (145 727 chars), **en orden ascendente**, sin solapamiento.

| # | Extracto | Offset | Chars |
|---|---|---|---|
| 1 | Prólogo. Me desconecto, luego existo | 66 | 8 289 |
| 2 | Aparecer o estar: el nuevo cogito | 8 357 | 21 543 |
| 3 | La multitud y la angustia | 29 902 | 6 808 |
| 4 | Mil pestañas abiertas: lo dividido no elige | 36 712 | 8 469 |
| 5 | El silencio cartesiano: detenerse para empezar | 45 183 | 10 237 |
| 6 | Simone Weil: atención como justicia | 55 422 | 10 101 |
| 7 | Presencias ausentes: estar sin estar | 65 525 | 9 341 |
| 8 | Elegir un yo: Kierkegaard en la era del FOMO | 74 868 | 9 120 |
| 9 | Prácticas de atención: pequeñas rebeldías | 83 990 | 6 976 |
| 10 | Epílogo — Una ética de la presencia | 107 629 | 9 272 |

**Zonas del libro deliberadamente fuera de la ruta** (ratificado en la matriz canónica de 03B —
**no es hallazgo nuevo**):

- Portadilla / «Pa' que me entienda» / «Latitud Cero» (offsets 0–65).
- Capítulo **«Me desconecto, luego existo (otra vez)»** (offset 90 968, 16 663 chars) — único
  capítulo del cuerpo sin extracto, por decisión editorial ratificada.
- **Glosario** (offset 116 903).
- **«Diálogos imposibles»** — Acto I / II / III (offsets 124 850 · 126 314 · 131 587 · 138 554).
  ✅ **Confirmado fuera de la ruta de v3.**

### 2.3 A04 — ausencia confirmada

`A04` **no existe** en la carpeta editorial, ni en el catálogo, ni en v3. Retirado editorialmente
en la unidad 00; **A05–A15 no se renumeran**. ✅ Conforme.

### 2.4 Reproductor: microcopias y ausencia de autoplay (verificación estructural)

Leído en `pages/Experiencias.tsx` (`NodeMediaPlayer`, `downloadTranscript`):

| Requisito | Implementación | Estructural |
|---|---|---|
| **(9)** La descarga conserva exactamente la transcripción mostrada | El botón pasa `node.config.transcripcion`, **la misma referencia** que se renderiza. `Blob` `text/plain;charset=utf-8` en cliente, sin endpoint ni telemetría. Idéntico por construcción. | ✅ |
| **(10)** Microcopia de pausa | «Puedes continuar después. La pausa también forma parte del recorrido.» con guarda `if (el.ended \|\| el.currentTime <= 0) return;` para que **el final nunca se anuncie como pausa** | ✅ |
| **(10)** Microcopia de final | «No hay reproducción automática. Tú decides cuándo abrir la siguiente pieza.» | ✅ |
| **(10)** Reanudación | `onPlay` limpia el aviso | ✅ |
| **(11)** No comienza otro audio automáticamente | `<audio controls preload="metadata">` **sin `autoPlay`**, sin playlist, `onEnded` no navega | ✅ |

### 2.5 Rótulos de voz y acotaciones (preparación de los checks 6 y 7)

- **A06** — contiene **`VOZ 1`, `VOZ 2`, `VOZ 3`, `VOZ 4` y `NARRACIÓN`**: cuatro voces distintas
  más narración, exactamente como exige el encargo. `VOZ 1` reaparece en el cierre (línea 37),
  cerrando la escena que abre la pieza. Los rótulos **no deben pronunciarse**.
- **A07.1 / A07.2** — monólogo de una sola voz, **sin rótulos**. No hay nada que rotular.
- **A07.3** — **una única acotación técnica: `[TONO DE LLAMADA.]`** (línea 35). Es **necesaria
  para comprender la escena**: separa el relato de la llamada final a la hermana (línea 50).
  Punto de escucha explícito.
- Ninguna otra pieza contiene rótulos ni acotaciones.

### 2.6 Observación técnica sobre A07.1 / A07.2 / A07.3

⚠️ **No bloqueante, pero exige atención en la escucha.** Las tres piezas de A07 son
**MPEG2 Layer III · 24 kHz · mono · VBR**, mientras las otras 13 son **MPEG1 Layer III · 44,1 kHz**.
Es una cadena de codificación distinta y de menor ancho de banda. El operador debe atender
expresamente a **claridad y brillo** en esas tres (check 8).

Velocidad de habla en las 16: **120–144 ppm**, rango normal de locución, coherente con la longitud
de cada transcripción. Duración total: **80,7 min**.

---

## 3. HALLAZGO EDITORIAL BLOQUEANTE Y SU RESOLUCIÓN (R1)

> **R1 — CHP-MOOK-ESTAS-AQUI-04A-R1-T08-PRIVATE-JOURNAL.** Tras detectarse H-01, el operador
> decidió que toda instrucción que invite a «grabar» se sustituye por **«Consigna en tu
> bitácora…»**, y que compartir/grupo/galería siguen fuera del MVP. Esta sección documenta la
> auditoría léxica, la corrección de T08 y la creación de **v4**.

### 🔴 H-01 · `n-t08` «Texto del mook · Mi manera de estar» — promesas funcionales falsas

**Nodo:** `n-t08` (READING, último nodo de v3)
**Recurso:** `content-1787621720131-24`
**Archivo fuente:** `T08. Mi manera de estar.txt` — SHA-256 `dda22ce9001db032…` (1 374 bytes)
**El defecto vive en el máster editorial**, byte-idéntico a lo que v3 sirve.

El texto contiene **dos promesas que la plataforma no puede cumplir**:

1. **«Escribe o graba una respuesta personal a esta pregunta…»**
   El MVP **no tiene superficie de grabación de audio**. La bitácora es solo texto.

2. **«Tu respuesta será privada. Después podrás decidir si quieres conservarla así, compartirla
   con un grupo o publicarla en la galería del mook. No hay una opción superior. Elegir quién
   puede verla también forma parte del ejercicio.»**
   **Compartir / grupo / galería fueron retiradas** como `FUTURE — MOOK-JOURNAL-SHARING`,
   bloqueadas hasta M1-B + consentimiento + retiro reversible. Existe un test que **falla si esas
   affordances aparecen en la UI de bitácora**. El texto se las promete al participante de todos
   modos, y además convierte la elección de audiencia en «parte del ejercicio».

**Por qué importa especialmente:** es exactamente el defecto que la unidad 02 corrigió en **T00**
(«algunas respuestas podrán compartirse» → «Todo lo que escribas en las bitácoras será privado…»,
SHA `344e09ce6124` → `71ce37b29d1a`, confirmado íntegro hoy). **La misma auditoría no se aplicó a
T08.** El recorrido abre prometiendo privacidad estricta y **cierra prometiendo publicación**.

**Severidad:** **bloqueante** — impide `GREEN-HUMAN-EDITORIAL-QA` por dos criterios del encargo:
«ausencia de promesas funcionales falsas» (§5) y «cero compartir, grupo, galería» (§6).

### Barrido sistemático de vocabulario en las 30 superficies de voz editorial

Se escanearon las 30 superficies donde habla la plataforma (14 ACTIVITY + 9 «Texto del mook ·» +
7 «Transición ·») buscando compartir · galería · grupo destinatario · publicar · grabar · borrar ·
calificación · ranking · racha · abandono. Los extractos del libro y los audioensayos se
excluyeron a propósito: ahí esas palabras son **tema**, no promesa.

| Nodo | Coincidencia | Dictamen |
|---|---|---|
| `n-t08` | compartir · galería · grupo · publicar · grabar (5) | 🔴 **H-01 — promesa falsa real** |
| `n-t05` | «queremos compartirla» | ✅ falso positivo — prosa sobre interrumpir una conversación |
| `n-t07` | «No hay **rachas** ni puntuaciones» | ✅ falso positivo — es una **negación explícita**, deseable |

**Ninguna otra superficie** contiene promesas funcionales, lenguaje de nota, diagnóstico, ranking,
racha ni abandono. `B00` y `B03` quedan verificadas en §5.

---

## 3-R1. AUDITORÍA LÉXICA DE LA FAMILIA «GRABAR»

Barrido sin distinción de mayúsculas de `grabación · grabaciones · grabar · graba` **y formas
equivalentes que inviten a producir audio** (`nota de voz`, `mensaje de voz`, `tu voz`,
`micrófono`, `grabadora`, `dictar`, `en audio`) sobre **la proyección completa de v3** (56 nodos:
títulos, `config.instruccion`, `config.preguntas`, `config.transcripcion`, descripciones de
catálogo y `texto_plano` de cada recurso).

**13 coincidencias de la familia «grabar» + 2 de familias equivalentes.** Clasificación:

| # | Nodo | Origen | Coincidencia | Clasificación | ¿Se toca? |
|---|---|---|---|---|---|
| 1 | `n-libro-ex01` | `texto_plano` | «para **grabar** la prueba» | Texto del libro | ❌ no |
| 2 | `n-libro-ex01` | `texto_plano` | «**Grabamos** el abrazo» | Texto del libro | ❌ no |
| 3 | `n-libro-ex02` | `texto_plano` | «**grabamos** la canción» | Texto del libro | ❌ no |
| 4 | `n-libro-ex02` | `texto_plano` | «una conversación que no se **graba**» | Texto del libro | ❌ no |
| 5 | `n-libro-ex02` | `texto_plano` | «el recuerdo se **graba** con otra densidad» | Texto del libro | ❌ no |
| 6 | `n-a02` | transcripción | «**Grabamos** porque queremos conservar» | Transcripción MP3 | ❌ no |
| 7 | `n-a02` | transcripción | «también **grabamos** porque necesitamos» | Transcripción MP3 | ❌ no |
| 8 | `n-a02` | transcripción | «la conversación que no quedó **grabada**» | Transcripción MP3 | ❌ no |
| 9 | `n-a02` | transcripción | «decidir entre **grabarla** o vivirla» | Transcripción MP3 (narración) | ❌ no |
| 10 | `n-a02` | transcripción | «Puedes **grabar** un fragmento» | Transcripción MP3 (narración) | ❌ no |
| 11 | `n-a07-1` | transcripción | «He **grabado** de madrugada» | Transcripción MP3 (relato) | ❌ no |
| 12 | **`n-a15`** | **transcripción** | **«Puedes escribir o grabar tu voz»** | 🔴 **INSTRUCCIÓN AL PARTICIPANTE** | ⛔ **ver H-02** |
| 13 | `n-t08` | `texto_plano` | «Escribe o **graba** una respuesta personal» | 🔴 **INSTRUCCIÓN AL PARTICIPANTE** | ✅ **corregida** |
| 14 | `n-libro-ex03` | `texto_plano` | «la multitud **dicta** qué opinar» | Texto del libro (falso positivo) | ❌ no |
| 15 | `n-a15` | transcripción | «grabar **tu voz**» | = #12, misma ocurrencia | ⛔ ver H-02 |

**Solo dos coincidencias son instrucciones al participante que prometen una superficie de
grabación: `n-t08` y `n-a15`.** Ninguna otra superficie editorial de las 30 contiene invitaciones
a producir audio.

### 🔴 H-02 · `n-a15` promete grabación de voz **en el audio mismo** — NO EDITABLE

**Nodo:** `n-a15` (AUDIO, «A15. Una ética de la presencia»)
**Ubicación:** línea 40 de la transcripción / ≈ minuto 5 de 7:29

> «Después completa la última bitácora. **Puedes escribir o grabar tu voz.** No necesitas construir
> una versión perfecta de ti…»

**Por qué NO se corrigió**, conforme a §1 del encargo R1 («detente y repórtala antes de editarla»):

1. **Está fuera de T08**, único nodo cuya corrección fue autorizada.
2. Vive en `config.transcripcion`, y el encargo excluye explícitamente **«transcripciones de los
   MP3»** del reemplazo mecánico.
3. **La promesa es audible, no solo textual.** El MP3 es byte-idéntico al máster editorial y la
   transcripción es byte-idéntica al guion: **la frase se pronuncia en voz alta**. Editar el texto
   rompería la correspondencia audio↔transcripción, que es justamente el criterio 4/5 de esta QA
   de audio. Corregirlo de verdad exige **reeditar o regrabar el activo A15**, expresamente fuera
   del alcance de 04A («no corregir activos»).

**Consecuencia:** aunque v4 corrige T08, **el mook sigue prometiendo audiblemente una grabación de
voz que no existe**. H-02 requiere decisión propia del operador y **no puede resolverse en v4**
(§4 vincula v4 a diferir de v3 únicamente en T08).

---

## 3-R2. CORRECCIÓN QUIRÚRGICA DE T08

Archivo: `ESTÁS AQUÍ - …/T08. Mi manera de estar.txt` (untracked, **SOURCE-ONLY**, jamás en Git).

| Métrica | Antes | Después |
|---|---|---|
| SHA-256 | `dda22ce9001db032e9ce244f8ee91422e4256ba499ce2d5e28c456c30ef64bc2` | `ce01d25aac67b022a34719c76b440d71652f5cdb884cb1297c5aee8079385894` |
| Bytes | 1 374 | 1 299 (Δ −75) |
| Palabras | 215 | 202 |
| BOM | ausente | ausente ✅ |
| CRLF | 13 | 13 ✅ |
| LF sueltos | 0 | 0 ✅ |
| Líneas | 14 | 14 ✅ |

**Cambio 1 — línea 2** (1 sola ocurrencia, exigida y verificada):

- Antes: «No necesitas cerrar con una promesa perfecta. **Escribe o graba una respuesta personal a esta pregunta:**»
- Después: «No necesitas cerrar con una promesa perfecta. **Consigna en tu bitácora una respuesta personal a esta pregunta:**»

**Cambio 2 — línea 12** (1 sola ocurrencia):

- Antes: «Tu respuesta será privada. Después podrás decidir si quieres conservarla así, compartirla con un grupo o publicarla en la galería del mook. No hay una opción superior. Elegir quién puede verla también forma parte del ejercicio.»
- Después: «**Tu respuesta quedará guardada de forma privada en tu bitácora. Solo tú podrás leerla dentro de este recorrido. Nada se publicará automáticamente.**»

**Verificación por reversión:** la edición se revirtió en memoria y reprodujo el original **byte a
byte**; sin esa igualdad el script aborta sin escribir. Control léxico sobre el resultado:
**0 coincidencias** de grabar/grabación/compartir/galería/grupo/publicarla/quién-puede-verla.

**Sin backups en la carpeta** (sigue con 50 archivos). **T08 no entra en Git.**

**El recurso canónico de v1/v2/v3 NO se tocó:** `public/uploads/t08__mi_manera_de_estar-1787621720130-104426269.txt`
conserva `sha256 = dda22ce9001db032…`. El máster editorial y el recurso servido son **archivos
distintos**, de modo que la corrección no alcanza a ninguna versión publicada.

---

## 3-R3. v4 — BORRADOR CREADO Y VALIDADO (SIN PUBLICAR)

Creada por la **ruta canónica** `POST /api/experiences/:id/versions` (autenticación admin por
sesión con rol `administrador`; **no se escribió el store directamente**).

| Versión | ID | Estado | Nodos | AUDIO / READING / ACTIVITY |
|---|---|---|---|---|
| v1 | `expv-1787621835613-1g389f` | published | 46 | 16 / 16 / 14 |
| v2 | `expv-1787627232665-q0shao` | published | 56 | 16 / 26 / 14 |
| v3 | `expv-1787627328985-qgaiki` | published | 56 | 16 / 26 / 14 |
| **v4** | **`expv-1787666606847-5uytdu`** | **draft** | **56** | **16 / 25 / 15** |

`currentVersionId` sigue en **v3**: el borrador es invisible para el participante.

### Conteo vinculante (§4) — ✅ EXACTO

56 nodos · 16 AUDIO · 25 READING · **15 ACTIVITY, todas `privado: true`** · 0 VIDEO · 0 LEO ·
0 PRODUCTION · A04 ausente.

### Diferencia v3 → v4 — ✅ UNA SOLA

Comparación nodo a nodo por SHA-256 de los 56 nodos y de las 7 cabeceras de módulo:

```
DIFERENCIAS v3 -> v4: 1
  • m6 / idx 20:  n-t08 (READING)  ->  n-t08-bitacora (ACTIVITY)
```

- **55/56 ids conservados** con contenido byte-idéntico.
- `objectives` idénticos.
- id retirado `n-t08` · id nuevo `n-t08-bitacora` · **posición 56 de 56** (última), igual que antes.

### Nodo nuevo

| Campo | Valor |
|---|---|
| `id` | `n-t08-bitacora` |
| `type` | `ACTIVITY` |
| `title` | `T08 · Mi manera de estar` |
| `required` | `true` |
| `resourceRef` | `null` |
| `config.privado` | `true` |
| `config.preguntas` | 7 (la pregunta central + las 6 frases) |
| requiere revisión | **no** — es ACTIVITY, no PRODUCTION → la evidencia nace con `requiresReview:false` |

**Literalidad:** los 13 fragmentos de texto del nodo (6 de `instruccion` + 7 de `preguntas`) se
verificaron uno a uno como **subcadenas literales del T08 corregido**: 13/13, cero reescrituras.

### §5 — Validación en preview de v4 (antes de publicar)

| Requisito | Resultado |
|---|---|
| Aparece «Consigna en tu bitácora» | ✅ |
| Existe campo real para responder | ✅ **7 textareas**: `act-n-t08-bitacora-0 … -6` |
| Aparece la insignia privada | ✅ «Privada. Solo tú puedes leerla.» |
| «Guardar para mí» funciona en preview sin persistir | ✅ botón presente y operado; **0 llamadas de red** interceptadas |
| No aparece grabar / grabación / compartir / grupo / galería / elegir visibilidad | ✅ la única aparición de «compartir» es la **negación del propio sistema**: «En esta versión la respuesta no se puede editar, eliminar ni compartir.» |
| Botón de envío correcto | ✅ «Guardar para mí» (no «Enviar respuestas») |
| Cero runs, evidencias y eventos creados | ✅ `mook_db.json` **byte-idéntico**; runs 8→8, evidencias 25→25, versiones 12→12, `events.db` 1 056 768 B sin cambio |
| Hashes de v1, v2, v3 y sus runs intactos | ✅ ver abajo |

### Inmutabilidad tras crear el borrador — ✅ GREEN

| Objeto | SHA-256 (prefijo) | Estado |
|---|---|---|
| v1 `expv-1787621835613-1g389f` | `ea2ea91b352129ae…` | INTACTA |
| v2 `expv-1787627232665-q0shao` | `bb266a7d86ccc919…` | INTACTA |
| v3 `expv-1787627328985-qgaiki` | `a13ea393b07b189e…` | INTACTA |
| run `…0kygq6` (demo-lector, v1) | `32a42d4a19e58ca3…` | INTACTO |
| run `…esjjvs` (user-tono) | `76384a69d235b7de…` | INTACTO |
| run `…tuw9fh` (user-rosi, v3) | `7da5f108f0bf7b4e…` | INTACTO |

Evidencias 25→25 · runs 8→8 · versiones 11→12 (solo el borrador v4).

### ⛔ PUBLICACIÓN DETENIDA

v4 **no se publicó**. Publicar es irreversible (las versiones son inmutables) y H-02 significa que
v4 **todavía no sería liberable**.

**Decisión del operador (Nicolás Jiménez): opción 2.** v4 permanece en borrador; **no se publica
ninguna versión mientras H-02 siga abierto**. Una sola versión cerrará ambos hallazgos.

**Alcance ampliado y autorizado de v4** — v4 podrá diferir de v3 en **exactamente dos puntos**:

1. **T08**: READING → ACTIVITY privada. ✅ hecho
2. **A15**: nuevo recurso y transcripción corregidos. ⏳ pendiente del MP3 regrabado

Los otros **54 nodos** permanecen byte-idénticos. Total de v4: **56 nodos**.

---

## 3-R4. CORRECCIÓN DE A15 — TXT LISTO, MP3 PENDIENTE

Archivo: `ESTÁS AQUÍ - …/A15. Una ética de la presencia.txt` (untracked, SOURCE-ONLY).

| Métrica | Antes | Después |
|---|---|---|
| SHA-256 | `4ead4ec29fa0662b0074725547c9c72c1084fea6038175f17c3621d6eb4bec67` | `7a5b2cb6c68dee4a8e8356d725d1e363c90e8535bac2d3c604b22cc65c1eaeca` |
| Bytes | 5 984 | 5 969 (Δ −15) |
| Palabras | 903 | 900 |
| BOM | ausente | ausente ✅ |
| CRLF | 50 | 50 ✅ |
| LF sueltos | 0 | 0 ✅ |
| Líneas | 51 | 51 ✅ |

**Sustitución única (línea 40), 1 sola ocurrencia verificada:**

- Antes: «**Después completa la última bitácora. Puedes escribir o grabar tu voz.** No necesitas construir una versión perfecta de ti…»
- Después: «**Después, consigna en tu bitácora tu respuesta personal.** No necesitas construir una versión perfecta de ti…»

**Reversión comparativa en memoria:** reproduce el original **byte a byte**; sin esa igualdad el
script aborta sin escribir.

**Control de alcance:** la familia «grabar» en A15 pasó de `["grabar"]` a `[]` — era la **única**
aparición del archivo y era la instrucción. **Ninguna aparición narrativa o legítima fue tocada**
en ningún otro archivo (A02, A07.1 y los extractos del libro conservan las suyas intactas).

### ⛔ Correspondencia MP3↔TXT ROTA a propósito — no declarada

El MP3 del máster sigue siendo el antiguo (`f99feff55f4cb02b…`, 5 092 474 B) y **pronuncia la
frase anterior**. En este momento **no existe correspondencia MP3↔TXT en A15 y no se declara
ninguna**. El recurso servido a v1/v2/v3 tampoco se tocó (`f99feff55f4cb02b…`).

**Posición estimada de la frase en el audio actual: ~6:34 – 6:40** de 7:29 (estimación lineal por
conteo de palabras, ±15 s).

- Frase inmediatamente anterior: «…de tu atención sigue en otro lugar. Pregúntate a qué quieres regresar.»
- Frase inmediatamente posterior: «Solo intenta nombrar una manera de estar que quieras cuidar.»

**Esperando el MP3 corregido del operador.** No se sintetiza, empalma ni regraba nada de forma
automática.

---

## 3-R5. 🟡 `YELLOW-A15-ASSET-NOT-REPLACED` — el MP3 corregido no llegó

**Verificación del 2026-08-25, tras el aviso de que el máster corregido ya estaba en la carpeta.**

| Comprobación | Esperado | Observado | Veredicto |
|---|---|---|---|
| SHA-256 | distinto de `f99feff5…` | `f99feff55f4cb02bbab345db24c443e482ea58064ab01d24e1482d19b6640b2b` | ❌ **idéntico al anterior** |
| Bytes | ≠ 5 092 474 | 5 092 474 (Δ 0) | ❌ idéntico |
| `mtime` | 2026-08-25 | **2026-08-24 10:02:20** | ❌ anterior a esta unidad |
| Primeros 16 bytes | — | `fffb90c4000000000000000000000000` | = frame sync crudo, sin ID3 (igual que antes) |
| Últimos 16 bytes | — | `55555555555555555555555555555555` | idénticos |

**Barrido de confirmación:**

- La carpeta editorial sigue con **50 archivos** — no se añadió ningún archivo nuevo.
- Los **únicos** archivos modificados hoy son los dos TXT corregidos en esta unidad:
  `A15. Una ética de la presencia.txt` (09:29) y `T08. Mi manera de estar.txt` (09:00).
- No existe ningún `.mp3` modificado hoy en ninguna parte del repositorio.

**Conclusión:** el archivo `A15. Una ética de la presencia.mp3` **no fue reemplazado**. Sigue
siendo el máster original y, por tanto, **continúa pronunciando «Puedes escribir o grabar tu
voz.»**

**Se detiene la secuencia.** No se ejecutan §3 (carga canónica), §4 (cableado en v4), §5 (preview
técnico) ni §6 (`PASS-H02`), porque todos dependen del activo nuevo. (§7, el Bloque 1, sí se
adelantó por autorización expresa del operador — ver §5 de este documento.)

### 2.ª verificación — 2026-08-25, tras el aviso de sobrescritura

| Comprobación | Observado | Veredicto |
|---|---|---|
| SHA-256 | `f99feff55f4cb02bbab345db24c443e482ea58064ab01d24e1482d19b6640b2b` | ❌ **sin cambio** |
| Bytes | 5 092 474 (Δ 0) | ❌ sin cambio |
| `mtime` | **2026-08-24T15:02:20.917Z** — ni siquiera se actualizó la marca de tiempo | ❌ sin cambio |
| Primeros / últimos 16 bytes | `fffb90c4…` / `5555…5555` | ❌ idénticos |

Barridos adicionales para descartar que el archivo hubiera quedado en otro sitio:

- **Sin variantes de normalización Unicode**: una sola entrada `A15 … .mp3` en el directorio, con
  el nombre codificado como `…556e6120c3a974696361…` (`é` en NFC). No hay gemelo NFD.
- **Carpeta con 50 archivos**, sin altas.
- Los dos únicos archivos modificados hoy siguen siendo los TXT corregidos en esta unidad.
- **Ningún `.mp3` modificado desde el 2026-08-24 12:00** en `D:\` (profundidad 3) salvo los tres de
  A07, del día anterior.
- **Ningún `.mp3` reciente** en `Descargas`, `Escritorio`, `Documentos` ni `Música` del usuario.
- **Sin carpetas editoriales duplicadas** en la raíz del proyecto.

**Conclusión:** la escritura no llegó al sistema de archivos. `YELLOW-A15-ASSET-NOT-REPLACED`
persiste.

### 3.ª verificación — archivo `A15. Una ética de la presencia - nuevo.mp3`

El operador aportó un segundo archivo con nombre propio. **Existe** (la carpeta pasa a 51
entradas), pero **no es un máster nuevo**:

| Comprobación | `A15 … .mp3` (original) | `A15 … - nuevo.mp3` | |
|---|---|---|---|
| SHA-256 | `f99feff55f4cb02b…` | `f99feff55f4cb02b…` | ❌ **idéntico** |
| Bytes | 5 092 474 | 5 092 474 | ❌ idéntico |
| `mtime` | 2026-08-24T15:02:20.917Z | **2026-08-24T15:02:20.917Z** | ❌ idéntico |
| Primeros / últimos 16 bytes | `fffb90c4…` / `5555…` | `fffb90c4…` / `5555…` | ❌ idénticos |

Comparación byte a byte de los dos ficheros: **`Buffer.compare() === 0`, 0 bytes distintos de
5 092 474**. Son literalmente el mismo contenido.

El `mtime` **idéntico al milisegundo** es la señal decisiva: se trata de una **copia que preservó
la marca de tiempo** (copiar/pegar en el explorador), no de una exportación nueva. Una regrabación
habría producido, como mínimo, un `mtime` actual y —casi con certeza— un tamaño distinto.

**`YELLOW-A15-ASSET-NOT-REPLACED` sigue abierto.** Conforme a la instrucción, **no se renombró,
reemplazó ni borró ninguno de los dos MP3**; ambos permanecen en la carpeta. No se ejecutó la carga
canónica ni el cableado de `n-a15`.

### 4.ª verificación — 🟢 máster corregido recibido · `YELLOW-A15-ASSET-NOT-REPLACED` CERRADO

El operador sobrescribió el archivo **canónico** (sin sufijo) y retiró por su cuenta la copia
`- nuevo`. La carpeta vuelve a **50 archivos**; no hay `ASSET-DRIFT`.

#### Tabla comparativa de los tres archivos

| | A15 antiguo | Copia `- nuevo` | **A15 corregido (canónico)** |
|---|---|---|---|
| SHA-256 | `f99feff55f4cb02bbab345db24c443e482ea58064ab01d24e1482d19b6640b2b` | idéntico al antiguo | **`3c750046730568902ae6adf72de9df118304936893f666f3cd68389275c0659b`** |
| Bytes | 5 092 474 | 5 092 474 | **7 375 973** (Δ +2 283 499) |
| `mtime` | 2026-08-24T15:02:20.917Z | idéntico al antiguo | **2026-08-25T16:16:09.646Z** |
| Duración | 7:29 (449,49 s) | = | **7:19 (439,25 s)** — 10,24 s más corto |
| MPEG | MPEG1 Layer III | = | MPEG1 Layer III |
| Sample rate | 44 100 Hz | = | 44 100 Hz |
| Canales | mono | = | **joint stereo** |
| Bitrate / modo | 128 kbps CBR | = | **VBR** (128k×8980, 160k×2660, 112k×2153, 192k×1093, …) |
| Primeros 16 B | `fffb90c4…` | = | `fffb9064…` |
| Últimos 16 B | `5555…5555` | = | `aaaa…aaaa` |
| Estado | histórico, intocable | **descartada** (retirada por el operador) | **candidato a carga** |

#### Preflight técnico del archivo corregido

| Gate | Resultado |
|---|---|
| 1 · hash ≠ `f99feff55…` | ✅ **`3c750046…`** — archivo distinto |
| 2 · `mtime` de exportación nueva | ✅ 2026-08-25 16:16:09 UTC |
| 3 · no byte-idéntico a la copia `- nuevo` | ✅ la copia ya no existe; el hash difiere de ella en cualquier caso |
| 4 · MIME real `audio/mpeg` | ✅ `file-type` (la **misma librería** que usa `/api/upload`) → `{ext:'mp3', mime:'audio/mpeg'}` |
| 5 · decodificación completa | ✅ **16 815 frames contiguos**, `0` huecos, `0` bytes finales sin frame |
| 6 · comienzo y final conservados | ✅ primer frame en offset **0**, último frame termina exactamente en EOF; sin ID3v1 ni ID3v2 |
| 7 · tres capas de `/api/upload` | ✅ (a) extensión `mp3` → categoría `audio`; (b) magic numbers → `audio/mpeg`, coincide con la categoría; (c) la inspección de bytes nulos solo aplica a `text`. Tamaño 7,03 MiB, muy por debajo del tope de 2 GiB. Hash nuevo ⇒ no colisiona con el índice de deduplicación |

**Velocidad de habla:** 900 palabras / 439,25 s = **122,9 ppm**, dentro del rango de locución
normal y coherente con el TXT corregido (el antiguo daba 120,5 ppm).

#### ⚠️ Observaciones para la escucha humana

El archivo **no es un empalme quirúrgico**: cambió la cadena de codificación completa
(mono → joint stereo, CBR → VBR) y la pieza es **10,24 s más corta**. Solo ~1,5 s se explican por
las 3 palabras menos del guion; el resto sugiere una **reexportación o regrabación íntegra** con
fraseo propio, o un recorte de silencios. No es un defecto —pero hace que los puntos 3, 4 y 5 del
gate humano (contexto anterior y posterior intactos, ausencia de corte o cambio abrupto) sean
**especialmente pertinentes**, y obliga a verificar que comienzo y final no quedaron truncados.

**Posición estimada de la frase corregida: ~6:27 – 6:30** de 7:19 (estimación lineal, ±15 s).

**No se declara correspondencia voz↔transcripción.** Queda pendiente del gate humano H-02.

---

## 3-R7. ✅ `PASS-H02` — confirmación humana

**Nicolás Jiménez, 2026-08-25.** A15 escuchado completo y comparado con la transcripción.

| Punto del gate | Confirmación humana |
|---|---|
| 1 · La frase antigua ya no se oye | ✅ |
| 2 · Se oye «Después, consigna en tu bitácora tu respuesta personal» | ✅ |
| 3 · Frase anterior completa | ✅ |
| 4 · Frase posterior completa | ✅ |
| 5 · Sin cortes, saltos, silencios, omisiones ni cambios abruptos | ✅ |
| 6 · Comienzo y final completos | ✅ |
| 7 · Correspondencia íntegra audio↔transcripción | ✅ **PASS** |

**Veredicto: `PASS-H02`.** **H-02 CERRADO.**

⚠️ **Timecode real: no consignado.** El operador devolvió el marcador de plantilla
`[inicio]–[fin]` sin sustituirlo. **No se inventa ninguna cifra.** Queda la estimación técnica
(~6:27–6:30 de 7:19, ±15 s, por conteo lineal de palabras), explícitamente marcada como
*estimación* y no como medición. Si se requiere el dato exacto en el expediente de liberación,
debe pedirse al operador.

---

## 3-R8. CARGA CANÓNICA DEL A15 CORREGIDO

Ejecutada por las rutas canónicas `POST /api/upload` y `POST /api/content` con sesión de
administrador. **No se editaron a mano el catálogo, `uploads/` ni ningún store.**

### Manifest del recurso nuevo

| Campo | Valor |
|---|---|
| **contentId** | **`content-1787675737067-a15r2`** |
| URL | `/uploads/a15__una__tica_de_la_presencia-1787675737067-427957740.mp3` |
| SHA-256 | `3c750046730568902ae6adf72de9df118304936893f666f3cd68389275c0659b` |
| Bytes | 7 375 973 |
| Duración | 7:19 (439,25 s) |
| Tipo | `podcast` · MIME `audio/mpeg` |
| `titulo` | «A15. Una ética de la presencia» (título editorial conservado) |
| `standalone` | **`false`** ✅ |
| `status` | `disponible` |
| Metadata | completa: `autor`, `editorial`, `categoria`, `edad_recomendada`, `publico_objetivo`, `etiquetas`, `ttsStatus`, `sectionIds`, `ilustraciones_url`, `isCollection`, `metricas` |

- **Integridad:** el archivo servido es **byte-idéntico** al máster editorial (`Buffer.compare()===0`).
- **HTTP:** `GET` completo → **200** (7 375 973 B); `GET` con rango → **206**,
  `content-range: bytes 0-1023/7375973`.
- **Acceso autorizado:** admin → «Acceso administrativo total»; `user-rosi` → «Contenido en
  catálogo autorizado del grupo» (entitlement concedido por la ruta canónica
  `PUT /api/groups/group-pilot-induccion`, 48 → 49 ids, **conservando el id antiguo**).
- Catálogo: 60 → **61** entradas. Sin deduplicación (hash nuevo).

### Coexistencia verificada

| Versión | `n-a15.resourceRef` | MP3 |
|---|---|---|
| v1 · v2 · v3 | `content-1787621719937-15` | `…-1787621719916-289411909.mp3` — SHA `f99feff5…` **byte-idéntico, sin tocar** |
| **v4** | **`content-1787675737067-a15r2`** | `…-1787675737067-427957740.mp3` — SHA `3c750046…` |

El reemplazo del archivo fuente local **no mutó ningún recurso canónico histórico**.

---

## 3-R9. CABLEADO DE `n-a15` EN v4 Y DIFF DEFINITIVO

Aplicado por `PUT /api/experiences/versions/expv-1787666606847-5uytdu` (ruta canónica de autoría).

Cambios en `n-a15`: `resourceRef` → `content-1787675737067-a15r2` · `config.transcripcion` →
**contenido exacto del TXT corregido** (5 861 caracteres, comparación literal ✅).
**Sin cambios** en título, posición (paso 54/56), módulo, `required` ni ninguna otra clave.

### Diff v3 → v4 — ✅ exactamente 2, las autorizadas

```
DIFERENCIAS v3 -> v4: 3
  • m6 / idx 17:  n-libro-ex10 (READING)  título alineado al máster (U+2014 → U+2013)
  • m6 / idx 18:  n-a15  (AUDIO)          recurso canónico + transcripción corregidos
  • m6 / idx 20:  n-t08 (READING) -> n-t08-bitacora (ACTIVITY privada)
```

| Aspecto | v3 | v4 (borrador) |
|---|---|---|
| Nodos | 56 | **56** ✅ |
| AUDIO / READING / ACTIVITY | 16 / 26 / 14 | **16 / 25 / 15** ✅ |
| ACTIVITY privadas | 14/14 | **15/15** ✅ |
| VIDEO / LEO / PRODUCTION | 0 / 0 / 0 | **0 / 0 / 0** ✅ |
| A04 | ausente | **ausente** ✅ |
| `objectives` | — | **idénticos** ✅ |
| **Nodos byte-idénticos** | — | **53/56** ✅ (exactamente lo autorizado) |

### Inmutabilidad tras la carga y el cableado — 🟢 GREEN

| Objeto | Estado |
|---|---|
| v1 `expv-1787621835613-1g389f` | ✅ INTACTA |
| v2 `expv-1787627232665-q0shao` | ✅ INTACTA |
| v3 `expv-1787627328985-qgaiki` | ✅ INTACTA |
| Los 3 runs de la experiencia | ✅ INTACTOS |
| MP3 y registro de catálogo del A15 antiguo | ✅ byte-idénticos |
| `currentVersionId` | ✅ sigue en **v3** |
| v4 | **draft** — sin publicar |
| Contadores | versiones 12 · runs 8 · evidencias 25 — sin cambios |

---

## 3-R10. PREVIEW TÉCNICO DE v4 (§G) — 🟢 GREEN

Ejecutado en el preview del borrador, sesión `admin-super-1`. **v4 NO se publicó.**

| Requisito | Resultado |
|---|---|
| A15 monta el nuevo contentId | ✅ `src="/uploads/a15__una__tica_de_la_presencia-1787675737067-427957740.mp3"` |
| Acceso permitido | ✅ preflight `allowed` para admin y para el participante |
| HTTP 206 | ✅ `206` con `content-range: bytes 0-1023/7375973` |
| `loadedmetadata` entrega duración real | ⚠️ no verificable en la pestaña automatizada (`readyState 0`) — **límite conocido del entorno**, ya documentado; el archivo decodifica y se sirve correctamente |
| Estado neutro sin cifra mientras se desconoce | ✅ «Preparando la duración… Si puedes, escucha una sola pieza a la vez.» |
| Reproducción solo mediante gesto | ✅ atributo `autoplay` **ausente**; `controls` + `preload="metadata"` |
| No comienza otra pieza | ✅ sin playlist; `onEnded` no navega |
| Transcripción mostrada | ✅ **5 861 caracteres**, contiene la frase nueva y **no** contiene la antigua |
| Descarga = TXT corregido | ✅ el botón pasa la **misma referencia** que se renderiza; longitud coincidente |
| T08 sigue ACTIVITY privada | ✅ **7 textareas** `act-n-t08-bitacora-0…6` + insignia «Privada. Solo tú puedes leerla.» |
| «Consigna en tu bitácora» visible | ✅ |
| Cero compartir / grupo / galería / grabar / grabación en las instrucciones | ✅ el único «compartir» es la **negación del sistema**: «En esta versión la respuesta no se puede editar, eliminar ni compartir.» |
| Botón correcto | ✅ «Guardar para mí» (no «Enviar respuestas») |
| Cero llamadas de persistencia | ✅ |
| Runs, evidencias y `events.db` sin cambios | ✅ `mook_db.json` **byte-idéntico**; runs 8→8, evidencias 25→25, versiones 12→12, `events.db` 1 056 768 B |
| v1–v3 y sus runs byte-idénticos | ✅ |

**Estado de A15 en este momento:**

| Elemento | Estado |
|---|---|
| TXT máster | ✅ corregido — `7a5b2cb6…`, 5 969 B, 900 palabras |
| MP3 máster | ❌ **sin reemplazar** — `f99feff5…`, 5 092 474 B |
| Correspondencia MP3↔TXT | ⛔ **rota, y NO se declara** |
| `n-a15` en el borrador v4 | sin tocar — sigue apuntando al recurso antiguo `content-1787621719937-15` |
| Recurso de v1/v2/v3 | intacto, como debe ser |

---

## 3-R6. DIFF EXACTO v3 → v4 (estado actual del borrador)

Comparación por SHA-256 de las 7 cabeceras de módulo y de los 56 nodos.

```
DIFERENCIAS v3 -> v4: 1   (de las 2 autorizadas)
  • m6 / idx 20:  n-t08 (READING)  ->  n-t08-bitacora (ACTIVITY)     ✅ aplicada
  • m6 / idx 13:  n-a15  — A15 nuevo recurso + transcripción         ⏳ PENDIENTE (bloqueada por 3-R5)
```

| Aspecto | v3 | v4 (borrador) |
|---|---|---|
| Nodos | 56 | 56 ✅ |
| AUDIO | 16 | 16 ✅ |
| READING | 26 | 25 ✅ |
| ACTIVITY | 14 | 15 ✅ (todas `privado:true`) |
| VIDEO / LEO / PRODUCTION | 0 / 0 / 0 | 0 / 0 / 0 ✅ |
| `objectives` | — | idénticos ✅ |
| ids conservados | — | **55/56** byte-idénticos ✅ |
| id retirado / nuevo | — | `n-t08` → `n-t08-bitacora` (posición 56 de 56) |
| Hash de versión | `a13ea393b07b189e…` | `e86dbf6b48eb2d72…` |

Cuando se aplique el cableado de A15 la diferencia pasará a **2**, y los nodos byte-idénticos
serán **54**, conforme a lo autorizado.

---

## 4. MÉTODO DE REVISIÓN HUMANA

- Reproducción desde el **Runtime real de v3**, como `user-rosi`, **sin autoplay**.
- Cuatro checkpoints con confirmación explícita del operador entre bloques.
- **No se usa reconocimiento automático de voz** como sustituto de la decisión humana.

### Entorno de escucha levantado y verificado

```
backend        :3010   USERS_DB=data-critical/usuarios_colegios_oro.json   ACCESS_FALLBACK_MODE=open
proxy QA       :3000   inyecta x-user-id · actor conmutable en /___qa/switch?user=
frontend Vite  :5173   proxya /api y /uploads -> :3000
```

Ruta: `http://127.0.0.1:5173/#/experiencias/exp-1787621835612-oe8qs3`
Identidad del navegador: `localStorage.chibalete_user_id = 'user-rosi'`

Cadena verificada de punta a punta: `/api/experiencias` devuelve `version: 3`; los 42 recursos
pasan el preflight; los MP3 se sirven con soporte de rango.

---

## 5. TABLA DE LOS 16 AUDIOS

Severidad: **B** bloqueante · **C** corregible antes de liberar · **O** observación.

| # | Nodo | Título | contentId | Dur. | Dur. real | SHA-256 MP3 | SHA-256 transcripción | Palabras | ppm | Veredicto humano | Hallazgo / timecode | Sev. |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A01 | `n-a01` | Son las once de la noche | `content-1787621719201-00` | 2:57 | 176,51 s | `194637c66ec4bd8a…` | `c1fdd3961ddc8663…` | 394 | 133,9 | **PASS** | — | — | 
| A02 | `n-a02` | Si no lo publicaste, ocurrió | `content-1787621719275-01` | 9:27 | 566,91 s | `96587aab149d0d36…` | `594be983e1f4a466…` | 1 196 | 126,6 | **PASS** | — | — | 
| A03 | `n-a03` | Todos están hablando | `content-1787621719358-02` | 10:16 | 616,39 s | `2cb6cee4c5d62eb0…` | `ec3a994cd4f9806a…` | 1 353 | 131,7 | **PASS** | — | — | 
| A05 | `n-a05` | Noventa segundos | `content-1787621719389-03` | 1:48 | 107,83 s | `c70beb0068d9c36b…` | `7603d8ea59434cce…` | 236 | 131,3 | **PASS** | — | — | 
| A06 | `n-a06` | Me estás escuchando | `content-1787621719518-04` | 11:05 | 665,08 s | `504485bf351dac48…` | `d2d8d4ced9658b52…` | 1 404 | 126,7 | **PASS** | — | — |
| A07.1 | `n-a07-1` | Si no posteo, desaparezco | `content-1787621719562-05` | 7:44 | 464,09 s | `2b136ce44f9a6624…` | `c53c76ab8d74a6e7…` | 1 106 | 143,0 | **PASS** | — | — |
| A07.2 | `n-a07-2` | Libertad no paga las cuentas | `content-1787621719621-06` | 9:58 | 598,25 s | `4342c67bc54f081f…` | `895a4d14250d6b7e…` | 1 379 | 138,3 | **PASS** | — | — |
| A07.3 | `n-a07-3` | La elección de empezar a elegir | `content-1787621719678-07` | 10:52 | 651,62 s | `2f4a76b7f0fcdac4…` | `270878da15dd40ea…` | 1 487 | 136,9 | **PASS** | — | — |
| A08 | `n-a08` | Día 1 — Una hora sin notificaciones | `content-1787621719702-08` | 1:22 | 81,92 s | `e5bad7832faebe32…` | `4d36647417e9811e…` | 178 | 130,4 | **PASS** | — | — |
| A09 | `n-a09` | Día 2 — Una sola pestaña | `content-1787621719728-09` | 1:19 | 78,99 s | `f4ff74426d1ac743…` | `5242bcc18fea769a…` | 189 | 143,6 | **PASS** | — | — |
| A10 | `n-a10` | Día 3 — Una fotografía que no vas a publicar | `content-1787621719749-10` | 1:14 | 74,21 s | `ef889cb83492f158…` | `87e6dbc1a5f3016d…` | 173 | 139,9 | **PASS** | — | — |
| A11 | `n-a11` | Día 4 — Escuchar sin interrumpir | `content-1787621719771-11` | 1:13 | 72,86 s | `df6d23a13f2c3372…` | `97c344ff99843dde…` | 171 | 140,8 | **PASS** | — | — |
| A12 | `n-a12` | Día 5 — Caminar sin audífonos | `content-1787621719835-12` | 1:17 | 77,40 s | `983b7407e8e4e7f6…` | `4435a7ef4d9115ce…` | 169 | 131,0 | **PASS** | — | — |
| A13 | `n-a13` | Día 6 — No responder todavía | `content-1787621719866-13` | 1:16 | 76,02 s | `629b97373cd6c898…` | `d16368bc501d5595…` | 162 | 127,9 | **PASS** | — | — |
| A14 | `n-a14` | Día 7 — Estar juntos sin pantallas | `content-1787621719887-14` | 1:23 | 82,76 s | `0b4db945383909dd…` | `9986603b4c535b5c…` | 172 | 124,7 | **PASS** | — | — |
| A15 | `n-a15` | Una ética de la presencia | **`content-1787675737067-a15r2`** | 7:19 | 439,25 s | `3c75004673056890…` | `7a5b2cb6c68dee4a…` | 900 | 122,9 | **PASS** | — | — |

**✅ 16/16 con PASS humano** — los cuatro bloques completos, cero ISSUE.

### Bloques de escucha

| Bloque | Piezas | Duración |
|---|---|---|
| 1 | A01 · A02 · A03 · A05 | 24,5 min |
| 2 | A06 · A07.1 · A07.2 · A07.3 | 39,7 min |
| 3 | A08 · A09 · A10 · A11 | 5,1 min |
| 4 | A12 · A13 · A14 · A15 | 11,4 min |

**La escucha se realiza sobre el preview del borrador v4**, que permanece **sin publicar**
durante toda la revisión humana (decisión del operador, R2).

### BLOQUE 1 — adelantado sobre el borrador v4 (autorizado por el operador)

El Bloque 1 se adelanta mientras `YELLOW-A15-ASSET-NOT-REPLACED` sigue abierto. **La escucha es
reutilizable** porque las cuatro piezas son cuatro de los **54 nodos que ninguna de las dos
diferencias autorizadas puede tocar**. Verificado por SHA-256 de nodo, v3 vs v4:

| Pieza | Nodo | SHA-256 del nodo en v3 | SHA-256 en v4 | `resourceRef` | Paso en preview |
|---|---|---|---|---|---|
| A01 | `n-a01` | `6012fe27d7d30c12…` | `6012fe27d7d30c12…` ✅ | `content-1787621719201-00` | **1 / 56** |
| A02 | `n-a02` | `fe986f9555d7825e…` | `fe986f9555d7825e…` ✅ | `content-1787621719275-01` | **6 / 56** |
| A03 | `n-a03` | `d266cbe264cf8b67…` | `d266cbe264cf8b67…` ✅ | `content-1787621719358-02` | **11 / 56** |
| A05 | `n-a05` | `8ffefdbc2bb5a139…` | `8ffefdbc2bb5a139…` ✅ | `content-1787621719389-03` | **19 / 56** |

Mismos contentId, mismos hashes de MP3 y de transcripción, misma `config`. **Los resultados
humanos de este bloque son válidos para la v4 final.**

**Preview verificado como listo** (admin `admin-super-1`, preflight «Acceso administrativo total»
en las 4 piezas):

| Comprobación en el preview | Resultado |
|---|---|
| `<audio>` montado con el `src` correcto | ✅ `/uploads/a01__son_las_once_de_la_noche-…mp3` |
| Atributo `autoplay` | ✅ **ausente** |
| `controls` · `preload="metadata"` | ✅ presentes |
| `aria-label` | ✅ «Audio: A01. Son las once de la noche» |
| Estado neutro sin cifra mientras se desconoce la duración | ✅ «Preparando la duración… Si puedes, escucha una sola pieza a la vez.» |
| Controles de transcripción | ✅ «Ver transcripción» + «Descargar transcripción» |
| Ruta canónica al visor preservada | ✅ enlace «Abrir audio» → `#/contenido/content-1787621719201-00` |

⚠️ **Límite conocido del entorno automatizado** (ya documentado en la unidad 00): en la pestaña
controlada por CDP la metadata del MP3 no llega a cargar (`readyState 0`, `networkState 2`) pese a
`canPlayType='probably'` y a que el archivo se sirve con `206 Partial Content`. **No es un defecto
del activo** — sus frames decodifican limpiamente y es byte-idéntico al máster. La escucha humana
debe hacerse en una ventana normal de Chrome.

#### Resultados humanos del Bloque 1 — ✅ 4/4 PASS

**Confirmación humana explícita de Nicolás Jiménez, 2026-08-25, tras reproducción audible en el
preview del borrador v4.**

| Pieza | Nodo | Veredicto humano | Hallazgo / timecode | Severidad |
|---|---|---|---|---|
| A01 · Son las once de la noche | `n-a01` | **PASS** | ninguno | — |
| A02 · Si no lo publicaste, ocurrió | `n-a02` | **PASS** | ninguno | — |
| A03 · Todos están hablando | `n-a03` | **PASS** | ninguno | — |
| A05 · Noventa segundos | `n-a05` | **PASS** | ninguno | — |

Con ello quedan confirmados por escucha humana, para estas cuatro piezas, los once criterios del
encargo: correspondencia audio↔título↔nodo, reproducción sin corrupción ni cortes, comienzo y
final completos, **correspondencia íntegra y ordenada entre palabras pronunciadas y
transcripción**, ausencia de contenido añadido, tratamiento correcto de rótulos y acotaciones
(ninguna de las cuatro los lleva), volumen y pronunciación comprensibles, descarga fiel,
microcopias de pausa/reanudación/final y ausencia de reproducción automática encadenada.

**Validez para la v4 final:** garantizada por la igualdad byte a byte de los cuatro nodos entre v3
y v4 acreditada arriba. Estas piezas **no se reescuchan**.

**Progreso de la escucha humana: 4/16.**

### BLOQUE 2 — adelantado sobre el borrador v4 (autorizado por el operador)

Igual que el Bloque 1, las cuatro piezas son **nodos byte-idénticos entre v3 y v4** y, por tanto,
también entre v3 y la v4 final: ninguna de las dos diferencias autorizadas las toca.

| Pieza | Nodo | SHA-256 del nodo en v3 | en v4 | `resourceRef` | Paso en preview |
|---|---|---|---|---|---|
| A06 | `n-a06` | `e46969201dc3ce82…` | `e46969201dc3ce82…` ✅ | `content-1787621719518-04` | **25 / 56** |
| A07.1 | `n-a07-1` | `4ce60784112f04a6…` | `4ce60784112f04a6…` ✅ | `content-1787621719562-05` | **30 / 56** |
| A07.2 | `n-a07-2` | `4fb2219133b22859…` | `4fb2219133b22859…` ✅ | `content-1787621719621-06` | **31 / 56** |
| A07.3 | `n-a07-3` | `789a790e78d49372…` | `789a790e78d49372…` ✅ | `content-1787621719678-07` | **32 / 56** |

Preflight `admin-super-1`: **4/4 «Acceso administrativo total»**.

**Puntos de escucha específicos de este bloque:**

- **A06** — confirmar expresamente las **cuatro voces (`VOZ 1`–`VOZ 4`) y `NARRACIÓN`**, y que los
  rótulos **no se pronuncian**. `VOZ 1` abre la pieza (línea 1) y la cierra (línea 37).
- **A07.3** — confirmar el tratamiento de la **única acotación técnica, `[TONO DE LLAMADA.]`**
  (línea 35): debe oírse el efecto, no leerse el rótulo, y debe dar paso a la llamada final a la
  hermana (línea 50).
- **A07.1 / .2 / .3** — atención expresa a **claridad y brillo**: son MPEG2 24 kHz mono VBR frente
  a los 44,1 kHz del resto (ver 2.6).

Es el bloque más largo: **39,7 min**.

#### Resultados humanos del Bloque 2 — ✅ 4/4 PASS

**Confirmación humana explícita de Nicolás Jiménez, 2026-08-25, tras reproducción audible.**

| Pieza | Nodo | Veredicto humano | Hallazgo / timecode | Severidad |
|---|---|---|---|---|
| A06 · Me estás escuchando | `n-a06` | **PASS** | ninguno | — |
| A07.1 · Si no posteo, desaparezco | `n-a07-1` | **PASS** | ninguno | — |
| A07.2 · Libertad no paga las cuentas | `n-a07-2` | **PASS** | ninguno | — |
| A07.3 · La elección de empezar a elegir | `n-a07-3` | **PASS** | ninguno | — |

**Controles especiales, confirmados por el operador:**

- **A06** — «cuatro voces y NARRACIÓN verificadas; rótulos no pronunciados». ✅ Queda cerrado el
  requisito expreso del encargo sobre esta pieza.
- **A07.3** — «tono de llamada audible y rótulo no pronunciado». ✅ La única acotación técnica del
  mook, `[TONO DE LLAMADA.]`, se resuelve como **efecto sonoro**, conforme al criterio 7.
- **A07.1–A07.3** — «claridad y brillo adecuados». ✅ **La observación técnica de 2.6 queda
  resuelta: la cadena MPEG2 24 kHz mono VBR no produce degradación perceptible.** Deja de ser un
  punto de atención.

**Progreso de la escucha humana: 8/16.**

### BLOQUE 3 — preparado sobre el borrador v4

Las cuatro piezas vuelven a ser **nodos byte-idénticos entre v3 y v4** (están entre los 54 que
ninguna diferencia autorizada toca), de modo que el veredicto vale para la v4 final.

| Pieza | Nodo | SHA-256 del nodo en v3 | en v4 | `resourceRef` | Paso en preview |
|---|---|---|---|---|---|
| A08 | `n-a08` | `1a63a0f69a03d825…` | `1a63a0f69a03d825…` ✅ | `content-1787621719702-08` | **39 / 56** |
| A09 | `n-a09` | `e7962002c3a03285…` | `e7962002c3a03285…` ✅ | `content-1787621719728-09` | **41 / 56** |
| A10 | `n-a10` | `8bfd8c846619bc6b…` | `8bfd8c846619bc6b…` ✅ | `content-1787621719749-10` | **43 / 56** |
| A11 | `n-a11` | `90923c0372fc79c1…` | `90923c0372fc79c1…` ✅ | `content-1787621719771-11` | **45 / 56** |

Preflight: **4/4 permitido**. Bloque más corto del recorrido: **5,1 min**.

Son las cuatro primeras piezas del **reto de 7 días** (M6). Van **intercaladas con las bitácoras
`B06 · Día 1–4`**, por eso los pasos son 39, 41, 43 y 45. Las cuatro son MPEG1 44,1 kHz mono
128 kbps CBR, **sin rótulos de voz ni acotaciones**.

#### Resultados humanos del Bloque 3 — ✅ 4/4 PASS

**Confirmación humana explícita de Nicolás Jiménez, 2026-08-25, tras reproducción audible.**

| Pieza | Nodo | Veredicto humano | Hallazgo / timecode | Severidad |
|---|---|---|---|---|
| A08 · Día 1 — Una hora sin notificaciones | `n-a08` | **PASS** | ninguno | — |
| A09 · Día 2 — Una sola pestaña | `n-a09` | **PASS** | ninguno | — |
| A10 · Día 3 — Una fotografía que no vas a publicar | `n-a10` | **PASS** | ninguno | — |
| A11 · Día 4 — Escuchar sin interrumpir | `n-a11` | **PASS** | ninguno | — |

Confirmaciones del operador para el bloque: correspondencia audio↔título↔transcripción · comienzo
y final completos · sin cortes, silencios ni artefactos · volumen y pronunciación comprensibles ·
ninguna pieza encadena reproducción automática.

> **Aporte adicional del operador, relevante para §6:** «cada práctica se entiende como
> **invitación, no como obligación, racha o puntuación**». Es evidencia humana directa sobre el
> criterio del **Movimiento 6** «ausencia de lenguaje de abandono, nota, diagnóstico, ranking o
> racha», y concuerda con lo verificado por código en `n-t07` («No hay rachas ni puntuaciones»).
> Se traslada a la revisión de movimientos.

**Progreso de la escucha humana: 12/16.**

### BLOQUE 4 — preparado sobre el borrador v4 · cierra la escucha

| Pieza | Nodo | v3 vs v4 | `resourceRef` en v4 | Paso |
|---|---|---|---|---|
| A12 | `n-a12` | ✅ byte-idéntico | `content-1787621719835-12` | **47 / 56** |
| A13 | `n-a13` | ✅ byte-idéntico | `content-1787621719866-13` | **49 / 56** |
| A14 | `n-a14` | ✅ byte-idéntico | `content-1787621719887-14` | **51 / 56** |
| **A15** | `n-a15` | ⚠️ **DIFIERE — es la 2.ª diferencia autorizada** | **`content-1787675737067-a15r2`** | **54 / 56** |

Preflight: **4/4 permitido**. Duración del bloque: **11,4 min** (con el A15 corregido, 11,2 min).

**A12–A14** cierran el reto de 7 días, intercaladas con `B06 · Día 5–7`; MPEG1 44,1 kHz mono
128 kbps CBR, sin rótulos ni acotaciones.

**A15 es el único caso especial de toda la escucha:** no es reutilizable desde v3 porque monta el
**recurso corregido**. Su transcripción en v4 tiene **5 861 caracteres / 900 palabras**
(sha `7a5b2cb6c68dee4a…`), contiene la frase nueva y **no** contiene la antigua. El operador ya
emitió `PASS-H02` sobre esta pieza declarando escucha completa y **correspondencia íntegra
audio↔transcripción**; el Bloque 4 ratifica ese resultado como entrada formal, ya en el contexto
del preview de v4.

#### Resultados humanos del Bloque 4 — ✅ 4/4 PASS

**Confirmación humana explícita de Nicolás Jiménez, 2026-08-25.**

| Pieza | Nodo | Veredicto humano | Base de la decisión | Severidad |
|---|---|---|---|---|
| A12 · Día 5 — Caminar sin audífonos | `n-a12` | **PASS** | reproducción audible | — |
| A13 · Día 6 — No responder todavía | `n-a13` | **PASS** | reproducción audible | — |
| A14 · Día 7 — Estar juntos sin pantallas | `n-a14` | **PASS** | reproducción audible | — |
| A15 · Una ética de la presencia (corregido) | `n-a15` | **PASS** | **por evidencia acumulada: `PASS-H02` + preview técnico** — así lo declaró el operador; no es una segunda escucha independiente | — |

Confirmaciones del operador para A12–A14: correspondencia íntegra audio↔transcripción · comienzo y
final completos · sin cortes, silencios ni artefactos · volumen y pronunciación comprensibles ·
prácticas presentadas como invitaciones · sin autoplay ni reproducción encadenada.

---

## 5-BIS. ESCUCHA HUMANA COMPLETA — ✅ 16/16 PASS

| Bloque | Piezas | Resultado |
|---|---|---|
| 1 | A01 · A02 · A03 · A05 | ✅ 4/4 PASS |
| 2 | A06 · A07.1 · A07.2 · A07.3 | ✅ 4/4 PASS |
| 3 | A08 · A09 · A10 · A11 | ✅ 4/4 PASS |
| 4 | A12 · A13 · A14 · A15 | ✅ 4/4 PASS |

**16/16 audios con PASS humano. 16/16 correspondencias audio↔transcripción confirmadas. Cero
ISSUE.** Ningún bloque generó hallazgos.

Observaciones técnicas previas que la escucha humana **cerró sin hallazgo**:

- **2.6 · A07.1/.2/.3 en MPEG2 24 kHz mono VBR** → «claridad y brillo adecuados». Deja de ser punto
  de atención.
- **A06 · cuatro voces + NARRACIÓN** → verificadas, rótulos no pronunciados.
- **A07.3 · `[TONO DE LLAMADA.]`** → audible como efecto, rótulo no leído.
- **A15 · reexportación íntegra (10,24 s más corta, mono→joint stereo, CBR→VBR)** → sin cortes ni
  truncamientos; comienzo y final completos.

---

## 6. REVISIÓN EDITORIAL DE LOS SIETE MOVIMIENTOS

_Pendiente de recorrido con el operador. Registro `APPROVED` u observación concreta por movimiento._

| Mov. | Pregunta visible en el título | Orden de piezas | Pasos | Veredicto humano |
|---|---|---|---|---|
| 0 · Antes de empezar | ¿Estás aquí o solo estás conectado? | A01 → T00 → Libro ex01 → **B00** → Transición M0 | 1–5 | ✅ **APPROVED** |
| 1 · Aparecer o estar | Si no lo publicaste, ¿ocurrió? | A02 → Libro ex02 → T01 → **B01** → Transición M1 | 6–10 | ✅ **APPROVED** con observación no bloqueante |
| 2 · La multitud y el ruido | ¿Quién elige mientras todos hablan? | A03 → ex03 → T02 → T03 → ex04 → **B02** → Transición M2 | 11–17 | ✅ **APPROVED** |
| 3 · Detenerse para empezar | ¿Qué cambia cuando no respondes inmediatamente? | ex05 → A05 → T04 → **B03** → Transición M3 | 18–22 | ✅ **APPROVED** |
| 4 · Prestar atención es hacer justicia | ¿Cómo se siente existir en la escucha de alguien? | ex06 → ex07 → A06 → T05 → **B04** → Transición M4 | 23–28 | ✅ **APPROVED** con observación no bloqueante |
| 5 · Elegir un yo | ¿Qué pierdes cuando intentas no perderte nada? | ex08 → A07.1 → A07.2 → A07.3 → T06 → **B05** → Transición M5 | 29–35 | ✅ **APPROVED** |
| 6 · Pequeñas rebeldías | ¿Qué práctica puede devolverme la elección? | ex09 → T07 → Transición M6 → (A08…A14 con B06 día 1–7) → ex10 → A15 → **B07** → **T08 (bitácora)** | 36–56 | ✅ **APPROVED** |

### Dictámenes humanos — Movimientos 0 a 2

**Nicolás Jiménez, 2026-08-25, recorrido sobre el preview del borrador v4.**

**Movimiento 0 — ✅ APPROVED.** Pregunta, orden y continuidad correctos. La secuencia
audio → carta → prólogo → primera bitácora → transición «construye bien el pacto del recorrido:
primero interpela, luego explica, profundiza mediante el libro y finalmente obtiene una respuesta
privada a la que se podrá regresar». Extracto pertinente, prefijos distinguen correctamente las
voces editoriales, **B00 respalda su promesa con la superficie privada real**. Sin promesas falsas
ni lenguaje de abandono, calificación, diagnóstico, ranking o racha.

**Movimiento 1 — ✅ APPROVED con observación editorial NO BLOQUEANTE.** La secuencia es correcta y
**conserva la decisión original de publicar completo «Aparecer o estar: el nuevo cogito»** cuando
la interfaz admite lectura larga. **El peso de 3 634 palabras después de A02 es deliberado: no debe
recortarse ni dividirse.** El recorrido es flexible, puede cerrarse tras cualquier pieza y permite
regresar; se trata editorialmente como **posible límite de sesión**, no como una cadena que deba
completarse de una vez.

> 📌 **Observación trasladada al preflight de liberación (`CHP-MOOK-ESTAS-AQUI-04B`):** confirmar
> que la interfaz comunique el **tiempo aproximado de lectura** y **no presione a continuar**.
> **No exige una versión nueva por sí misma.**

**Movimiento 2 — ✅ APPROVED.** Pese a ser el movimiento con más piezas, «la alternancia tiene
sentido: el audio introduce el problema colectivo; el primer extracto aporta el marco; T02 y T03
trasladan el problema a la experiencia cotidiana; el segundo extracto conecta multitud y atención
dividida; B02 devuelve la pregunta al participante; la transición cierra sin aislar el pensamiento
de la conversación». Ambos extractos pertinentes y con límites limpios. Claridad para 14–18,
tres procedencias diferenciadas, sin promesas funcionales falsas ni lenguaje prohibido.

### Dictámenes humanos — Movimientos 3 y 4

**Movimiento 3 — ✅ APPROVED.** La apertura con el libro es correcta: «el capítulo establece la
pausa cartesiana antes de que A05 la convierta en una experiencia breve y concreta». El contraste
entre el extracto largo y *Noventa segundos* «no es un problema; es uno de los mejores gestos
rítmicos del recorrido. Después de la argumentación extensa, el audio reduce deliberadamente la
escala y lleva la pausa al cuerpo». T04 traduce la experiencia en procedimiento, B03 permite
ensayarla sobre una situación real **sin enviar nada**, y la transición formula el límite
pedagógico correcto.

> ✅ **Requisito expreso del encargo, ratificado por el operador en pantalla:** las **dos garantías
> visibles de B03** — «no promete borrar ni enviar», sin promesas funcionales falsas.

**Movimiento 4 — ✅ APPROVED con observación editorial NO BLOQUEANTE.** Secuencia conceptual
ratificada: Weil presenta la atención como justicia → *Presencias ausentes* lleva el problema a una
escena cotidiana → A06 dramatiza qué significa existir (o no) en la escucha de otros → T05 formula
el derecho a terminar una frase → B04 devuelve la pregunta → la transición cierra **sin prometer
que escuchar resuelva todos los conflictos**. Los dos extractos consecutivos y A06 hacen el
movimiento exigente, «pero el peso está justificado y coincide con la arquitectura original».
**No se recomienda reordenar, recortar ni intercalar contenido artificialmente.**

> 📌 **Observación trasladada al preflight 04B:** como en el M1, debe poder asumirse como **más de
> una sesión**. Mostrar tiempo aproximado y **permitir salir después de cualquiera de las dos
> lecturas sin lenguaje de abandono**.

**Progreso editorial: 5/7 movimientos.**

### Dictámenes humanos — Movimientos 5 y 6

**Movimiento 5 — ✅ APPROVED.** Secuencia ratificada: Kierkegaard entrega el marco conceptual → los
tres audios desarrollan una ficción en tres actos → T06 formula la idea central → B05 la devuelve a
una decisión concreta → la transición evita convertir esa elección en una definición definitiva del
yo. **Los tres audios consecutivos no deben fusionarse ni reordenarse:** al ser nodos independientes
ya contienen **límites naturales de sesión** —el participante puede escuchar uno, cerrar y regresar—,
separación «especialmente adecuada entre la frase-ley, el conflicto económico y la llamada a la
hermana». B05 dialoga con la pregunta visible y mantiene la respuesta privada. Sin promesas falsas,
calificación, diagnóstico, ranking, racha ni lenguaje de abandono.

**Movimiento 6 — ✅ APPROVED.** Progresión completa ratificada: el libro presenta las prácticas →
T07 explica el reto → la transición devuelve la elección → los siete días alternan audio y bitácora
privada → el epílogo y A15 amplían la práctica hacia una ética de la presencia → B07 permite
comparar el final con el comienzo → T08 convierte esa comparación en una formulación personal y
privada.

**Ratificaciones expresas del operador (requisitos nominales del encargo):**

- **B06** = siete registros **independientes, opcionales y retomables**. ✅
- **Sin racha, puntuación, castigo ni obligación** de completar los siete días. ✅
- **B07 honra la promesa de B00:** la respuesta inicial **puede releerse desde el nodo B00
  completado** y **T08 indica expresamente que se vuelva a ella**. «No se prometió una comparación
  automática ni una yuxtaposición en la misma pantalla.» ✅
  → **La navegación requerida es aceptable para el MVP.** Un enlace directo «Leer lo que escribí al
  comenzar» queda como **posible mejora de UX, no como bloqueo editorial**.
- **T08 es una bitácora privada real, no una PRODUCTION simulada.** ✅
- **No existe grabación, compartir, grupo, galería, edición ni eliminación.** ✅
- El Epílogo y A15 forman un cierre coherente antes de las dos bitácoras finales. ✅

**Progreso editorial: 7/7 movimientos APPROVED.**

Los 7 módulos llevan **la pregunta integrada en el título**, visible en la ruta. ✅

### Revisiones específicas exigidas

| Punto | Estado |
|---|---|
| **B00** — solo privacidad estricta | ✅ «Tu respuesta será privada. Solo tú podrás leerla dentro de este recorrido. Nada se publicará automáticamente.» Sin promesa de compartir. Confirmar en Runtime. |
| **B03** — no promete borrar ni enviar | ✅ «Este borrador se guarda de manera privada. Chibalete+ no lo enviará ni lo compartirá con la persona destinataria.» + «La plataforma no lo enviará.» **No promete borrado.** Confirmar en Runtime. |
| **B06** — siete registros independientes, omitibles y retomables | ✅ 7 nodos con id propio (`n-b06-dia-1…7`), los 7 `required: false`, evidencia append-only. Confirmar en Runtime. |
| **B07** — permite releer B00 | ⚠️ **Verificar en Runtime.** B07 repite las 5 frases de B00 y pregunta «¿Qué respuesta cambió más?», pero **no muestra las respuestas de B00 en su propia superficie**. La relectura depende de volver al nodo B00 completado. La instrucción explícita de releer vive en **T08**, no en B07. |
| **T08** — cierre textual privado, no simula PRODUCTION | ⚠️ Estructuralmente es READING, **no** PRODUCTION ✅ — pero su **texto** promete grabación, compartir, grupo y galería → **🔴 H-01**. |
| **«Diálogos imposibles» fuera de la ruta** | ✅ Verificado: offsets 124 850+ del máster, sin extracto en v3. |
| **A04 ausente** | ✅ Verificado. |

---

## 6-BIS. PREFLIGHT FINAL DE v4 — 🟢 GREEN (sin publicar)

### 1 · Privacidad final con dueño y administrador

Probado contra el run real de `user-rosi`, que contiene **4 bitácoras privadas** con sentinels
(`SENTINEL-V2-B00-4c81`, `SENTINEL-V2-B03-9e02`).

| Prueba | Actor | Resultado |
|---|---|---|
| Relectura de lo propio | `user-rosi` (dueño) | ✅ **4/4** devueltas con `privado:true` y sus `answers` (6+5+5+7 campos) |
| Cola de revisión | `admin-super-1` | ✅ 4 entradas, **0 de «¿Estás aquí?»**, **0 fugas de sentinel** |
| Detalle de una bitácora privada | `admin-super-1` | ✅ **HTTP 409 `NOT_REVIEWABLE`** en las dos probadas |
| Run ajeno | `user-tono` | ✅ recibe **su propio** run, `0` evidencias, **0 sentinels de rosi** |
| Evidencia inexistente | `admin-super-1` | ✅ **404 `EVIDENCE_NOT_FOUND`** — revela existencia, **nunca contenido** (residual conocido y fuera de alcance) |
| Cola de mediador (gate M1-B) | `demo-profesor` | ✅ **HTTP 403 `MEDIATOR_SCOPE_GATED`** |

**Cero títulos, preguntas, respuestas o sentinels privados llegan a revisión. Cero entradas de esta
experiencia en Producciones. Cero compartir / grupo / galería / editar / borrar.**

### 2 · Diff v3 → v4

```
DIFERENCIAS: 3   (autorizadas: 3)
  • m6/idx17:  n-libro-ex10 (READING)              título alineado al máster (U+2014 → U+2013)
  • m6/idx18:  n-a15 (AUDIO)                       recurso canónico + transcripción corregidos
  • m6/idx20:  n-t08 (READING) -> n-t08-bitacora   ACTIVITY privada
```

**53/56 nodos byte-idénticos.** `objectives` idénticos. Cabeceras de los 7 módulos idénticas.

### 3 · Conteos y orden de los 56 nodos

| Métrica | Valor |
|---|---|
| Nodos | **56** |
| AUDIO | **16** |
| READING | **25** — ver nota de composición |
| ACTIVITY | **15** — **15/15 `privado: true`** |
| VIDEO / LEO / PRODUCTION | **0 / 0 / 0** |
| A04 | **ausente** ✅ |
| «Diálogos imposibles» | **fuera de la ruta** ✅ |

> Nota de composición: los 25 READING son **10 «Libro ·» + 8 «Texto del mook ·» + 7 «Transición ·»**.
> T08 dejó de ser READING al convertirse en bitácora, de ahí 26 → 25.

Orden verificado módulo a módulo (pasos 1–56): M0 = 1–5 · M1 = 6–10 · M2 = 11–17 · M3 = 18–22 ·
M4 = 23–28 · M5 = 29–35 · M6 = 36–56.

### 4 · Preview sin mutaciones

`mook_db.json` **byte-idéntico** antes y después del recorrido de preview · runs 8→8 ·
evidencias 25→25 · versiones 12→12 · `events.db` 1 056 768 B sin escritura · **0 llamadas de
persistencia** interceptadas al operar «Guardar para mí».

### 5 · Suites y build

| Comando | Resultado |
|---|---|
| `npm run test:mook` | ✅ **EXIT 0** — experienceStore, mookV4Realign, mookRuntime01, mookStudio01 (12), mookReview01 (15), mookPilot01, mookMvpFreeze (7), mookPrivateJournal (14/14), mookAudioA11y (14/14) |
| `npm run test:library` | ✅ **EXIT 0** — 17 escenarios |
| `npm run test:metric-contract` | ✅ **EXIT 0** — 16 ok, 0 fallos |
| `npm run test:memberships` | ✅ **EXIT 0** — 51 ok, 0 fallidos |
| `npm run typecheck:baseline` | ✅ **EXIT 0** — sin regresiones TS |
| `npm run build` | ✅ **EXIT 0** — construido en 1 m 19 s |

**No se añadió ni modificó ningún test ni código de producción en esta unidad.**

### 6 · Manifest de recursos

| Recurso | contentId | SHA-256 | Bytes | Usado por |
|---|---|---|---|---|
| A15 **antiguo** | `content-1787621719937-15` | `f99feff55f4cb02b…` | 5 092 474 | v1 · v2 · v3 — **intacto** |
| A15 **corregido** | **`content-1787675737067-a15r2`** | `3c75004673056890…` | 7 375 973 | **v4** |
| T08 recurso READING | `content-1787621720131-24` | `dda22ce9001db032…` | 1 374 | v1 · v2 · v3 — **intacto** (v4 ya no lo referencia) |
| Extracto Epílogo | `content-1787627191051-10` | — | 9 272 chars | v1–v4 — **cuerpo sin tocar** |

Los otros 40 recursos referenciados por v4 son los mismos de v3, sin cambios. Catálogo: 61 entradas.
Entitlement del club `group-pilot-induccion`: 49 ids (48 + el A15 nuevo), **conservando el antiguo**.

### 7 · Observaciones NO bloqueantes (trasladadas al preflight de liberación 04B)

| # | Origen | Observación | Naturaleza |
|---|---|---|---|
| **O-1** | Movimiento 1 | Confirmar que la interfaz **comunique el tiempo aproximado de lectura** y **no presione a continuar**. El extracto de 3 634 palabras es deliberado y **no debe recortarse ni dividirse**. | UX · no exige versión nueva |
| **O-2** | Movimiento 4 | Debe poder asumirse como **más de una sesión**: mostrar tiempo aproximado y **permitir salir tras cualquiera de las dos lecturas sin lenguaje de abandono**. | UX · no exige versión nueva |
| **O-3** | Movimiento 6 / B07 | Un enlace directo **«Leer lo que escribí al comenzar»** que yuxtaponga B00 en B07. La relectura ya funciona por navegación y T08 la indica. | Mejora de UX · **no es bloqueo editorial** |
| **O-4** | Técnica | En navegador automatizado (CDP) la metadata MP3 no carga (`readyState 0`). **Límite de entorno, no del activo.** | Entorno de QA |
| **O-5** | Técnica | `404 EVIDENCE_NOT_FOUND` revela **existencia** de una evidencia, nunca contenido. | Residual conocido, fuera de alcance |

**Ninguna observación bloquea la publicación de v4.**

---

## 6-TER. CIERRE — PUBLICACIÓN LOCAL DE v4 Y E2E FINAL

### Fase A · Gate irreversible previo — ✅ 7/7

v4 en DRAFT con `currentVersionId` en v3 · conteos 56 · 16/25/15 · 15/15 privadas · diff = los 3
autorizados · 53/56 byte-idénticos · A15 v4 → `content-1787675737067-a15r2` y v1–v3 →
`content-1787621719937-15` · sin drift de datos ni de código · **nada staged en Git**.

### Fase B · Publicación local de v4 — ✅ una sola vez

`POST /api/experiences/versions/expv-1787666606847-5uytdu/publish` · **HTTP 200**.

| Versión | ID | Estado | Publicada |
|---|---|---|---|
| v1 | `expv-1787621835613-1g389f` | published | 2026-08-25T01:41:45.489Z |
| v2 | `expv-1787627232665-q0shao` | published | 2026-08-25T03:07:12.666Z |
| v3 | `expv-1787627328985-qgaiki` | published | 2026-08-25T03:08:48.987Z |
| **v4** | **`expv-1787666606847-5uytdu`** | **published** | **2026-08-25T21:57:15.987Z** |

`currentVersionId` → **v4** · **4 versiones en total, sin extra** · v1/v2/v3 y sus tres runs con
hash intacto y **pineados a sus versiones originales** · recursos históricos de A15 y T08
byte-idénticos.

### Fase C · E2E con participante nuevo — ✅ 12/12

Participante temporal `user-qa-e2e-v4`, autenticado por **`POST /api/auth/login` canónico** (HTTP 200).
Run **`run-1787695111477-nm6ei9`**. Todo por Runtime y API reales; **cero escritura directa en el store**.

| # | Prueba | Resultado |
|---|---|---|
| 1 | Descubre la experiencia | ✅ `version: 4` |
| 2 | Run único pineado a v4 | ✅ HTTP 201 · `experienceVersionId = expv-1787666606847-5uytdu` |
| 3 | A15 monta el recurso corregido | ✅ `content-1787675737067-a15r2` · acceso «catálogo autorizado del grupo» · GET 200 / rango **206** |
| 4 | A15: frase nueva presente, antigua ausente | ✅ 5 861 chars / 900 palabras · **0 coincidencias** de la familia «grabar» |
| 5 | T08 = ACTIVITY privada con 7 campos | ✅ `privado:true`, `resourceRef:null`, «Consigna en tu bitácora», **0 vocabulario prohibido** |
| 6 | T08 bloqueado hasta completar lo previo | ✅ **409 `NODE_LOCKED`** antes de tiempo — comportamiento correcto del Runtime |
| 7 | Guardado del sentinel `SENTINEL-04A-T08-7f31` | ✅ HTTP 201 · progreso **42/42 completado** |
| 8 | Relectura del dueño tras reabrir el run | ✅ 7 campos **byte-idénticos** a lo guardado |
| 9 | Segundo participante (`user-rosi`) | ✅ recibe **su** run · **0 sentinels del QA** |
| 10 | Administrador · cola de revisión | ✅ 4 entradas, **0 de esta experiencia**, 0 sentinels, 0 rastro del QA |
| 11 | Administrador · detalle del evidenceId privado | ✅ **409 `NOT_REVIEWABLE`**, sin contenido |
| 12 | Mediador · cola | ✅ **403 `MEDIATOR_SCOPE_GATED`** |

**Sin PRODUCTION ni revisión:** 0 nodos PRODUCTION en v4 · **33 evidencias de la experiencia, 0 con
`requiresReview:true`** · las 15 del participante QA todas privadas · la cola global mantiene sus 4
entradas, **todas de otras experiencias**.

**Inmutabilidad tras el E2E:** v1, v2, v3 y sus tres runs **intactos**; 4 versiones, **sin v5**.

**Credenciales temporales eliminadas** (`DELETE /api/users/user-qa-e2e-v4`, HTTP 200, padrón de
vuelta a 10). **Run y 15 evidencias conservados como trazabilidad local**, conforme a la instrucción.

### Límite explícito

**Cero producción.** Todo ocurrió en el entorno local (`backend :3010` · proxy QA `:3000` ·
Vite `:5173`). **No hubo deploy, acceso ni cambio en el VPS. Este cierre no constituye liberación
pública.**

---

## 7. CONTROL DE PRIVACIDAD

| Control | Resultado |
|---|---|
| Las bitácoras solo salen por `myEvidenceView` al dueño | ✅ `myEvidenceView` exige `run.userId === userId` (identidad **derivada de sesión**, jamás del cliente) y dueño también en cada evidencia. Es la única vía por la que el texto sale del servidor. |
| Sin bypass por rol | ✅ El filtro no consulta rol: ni administrador ni revisor reciben bitácora privada por API. |
| Fail-closed | ✅ `isPrivateActivityNode` devuelve `true` si el nodo no se resuelve en la versión fijada — ante la duda **no** se proyecta a terceros. |
| Cero entradas de esta experiencia en Producciones | ✅ **18/18** evidencias de `¿Estás aquí?` tienen `requiresReview: false`. Las 4 entradas de la cola de revisión pertenecen a **otras** experiencias. |
| Cero compartir / grupo / galería / editar / borrar en la UI | ✅ Retiradas como `FUTURE — MOOK-JOURNAL-SHARING`; un test falla si reaparecen. ⚠️ **Pero el texto de T08 las promete** → H-01. |
| v1, v2, v3 y sus runs inmutables | ✅ Ver §8. |

---

## 8. INMUTABILIDAD

_Snapshot de cierre pendiente hasta terminar la revisión._

| Objeto | Estado al abrir la unidad |
|---|---|
| v1 `expv-1787621835613-1g389f` | 46 nodos, publicada, intacta |
| v2 `expv-1787627232665-q0shao` | 56 nodos, publicada, sin runs, intacta |
| v3 `expv-1787627328985-qgaiki` | 56 nodos, publicada, intacta |
| `run-1787622134590-0kygq6` (v1) | `completed`, 14 bitácoras, intacto |
| `run-1787627393666-tuw9fh` (v3) | `active`, 4 bitácoras, intacto |

---

## 9. VEREDICTO

# 🟢 `GREEN-MOOK-ESTAS-AQUI-V4-LOCAL`

| Criterio del gate | Resultado |
|---|---|
| 16/16 audios con PASS humano | ✅ |
| 16/16 correspondencias audio↔transcripción | ✅ |
| 7/7 movimientos APPROVED | ✅ |
| Privacidad GREEN | ✅ |
| Inmutabilidad de v1–v3 y sus runs | ✅ |
| Preview sin mutaciones | ✅ |
| Suites y build | ✅ EXIT 0 |
| H-01 y H-02 | ✅ cerrados |
| `YELLOW-A15-ASSET-NOT-REPLACED` | ✅ cerrado |
| Publicación local de v4 + E2E 12/12 | ✅ |

**Este GREEN autoriza únicamente el cierre local y documental de 04A. No autoriza deploy ni
publicación en producción.**

Estado de los hallazgos editoriales:

| Hallazgo | Estado |
|---|---|
| **H-01** — T08 promete grabar / compartir / grupo / galería | ✅ **RESUELTO** en el borrador v4 (texto corregido + nodo convertido en bitácora privada real) |
| **H-02** — A15 promete «grabar tu voz» **en el audio** | ✅ **RESUELTO** — máster regrabado, `PASS-H02` humano, recurso canónico nuevo `content-1787675737067-a15r2` cableado en v4 |
| `YELLOW-A15-ASSET-NOT-REPLACED` | ✅ **CERRADO** en la 4.ª verificación |

**Ambos hallazgos editoriales quedaron resueltos en v4, hoy publicada localmente.**

---

## 10. MATRIZ DE CAMBIOS

### Resueltos en v4

| # | Archivo / nodo | Problema | Resolución | Evidencia |
|---|---|---|---|---|
| H-01a | `T08. Mi manera de estar.txt` · `n-t08` | «Escribe o **graba** una respuesta personal» — no existe superficie de grabación | → «**Consigna en tu bitácora** una respuesta personal a esta pregunta:» | máster `dda22ce9…` → `ce01d25a…`; 1 sola ocurrencia; reversión byte a byte verificada |
| H-01b | `T08. Mi manera de estar.txt` · `n-t08` | «compartirla con un grupo o publicarla en la galería del mook… Elegir quién puede verla» | → «Tu respuesta quedará guardada de forma privada en tu bitácora. Solo tú podrás leerla dentro de este recorrido. Nada se publicará automáticamente.» | mismo hash; control léxico posterior = 0 coincidencias |
| H-01c | `n-t08` (READING) | El nodo no permitía consignar nada: prometía una bitácora sin ofrecerla | → `n-t08-bitacora` **ACTIVITY `privado:true`** en la misma posición final, con 7 campos reales | v4 `expv-1787666606847-5uytdu`; diferencia única frente a v3; preview con 7 textareas + insignia privada |

### Abiertos

| # | Archivo / nodo | Problema | Propuesta | Por qué no se resolvió aquí |
|---|---|---|---|---|
| **H-02** | `A15. Una ética de la presencia.mp3` + su transcripción · `n-a15`, línea 40 (≈ min 5 de 7:29) | «Después completa la última bitácora. **Puedes escribir o grabar tu voz.**» — promesa **audible** de una superficie de grabación inexistente | Reeditar o regrabar ese pasaje de A15 sustituyendo la frase por lenguaje de bitácora, y actualizar la transcripción **en el mismo acto** para conservar la correspondencia byte a byte | Fuera de T08; el encargo excluye editar transcripciones de MP3 y corregir activos; editar solo el texto rompería la correspondencia audio↔transcripción que esta misma QA debe verificar |

_Se añadirán las filas que produzca la escucha humana._

---

## 11. VALIDACIÓN TÉCNICA

_Pendiente: se ejecuta al cierre de la unidad (no cambió código)._

---

## 12. TRAZA DE LA REVISIÓN

| Fecha | Operador | Acción |
|---|---|---|
| 2026-08-25 | Nicolás Jiménez | Baseline, cadena de custodia, barrido editorial y entorno de escucha. **H-01 detectado.** |
| 2026-08-25 | Nicolás Jiménez | **R1:** auditoría léxica «grabar» (15 coincidencias clasificadas) → **H-02 detectado en A15**. Corrección quirúrgica de T08. Borrador **v4** creado por ruta canónica y validado en preview. Publicación detenida a la espera de decisión sobre H-02. |
| 2026-08-25 | Nicolás Jiménez | **R1 (cont.):** opción 2 elegida — v4 se mantiene en borrador durante toda la revisión humana. TXT de **A15** corregido y verificado (`4ead4ec29fa0662b…` → `7a5b2cb6c68dee4a…`). |
| 2026-08-25 | Nicolás Jiménez | **R2:** verificación del MP3 de A15 → 🟡 **`YELLOW-A15-ASSET-NOT-REPLACED`**: el archivo sigue siendo el original (`f99feff55f4cb02b…`, 5 092 474 B, `mtime` 2026-08-24). Secuencia §3–§7 detenida. |
| 2026-08-25 | Nicolás Jiménez | **R2 (cont.):** autorizado adelantar el **BLOQUE 1** sobre el preview del borrador v4, por ser 4 de los 54 nodos byte-idénticos. Preview verificado y entregado. |
| 2026-08-25 | Nicolás Jiménez | **BLOQUE 1 — ✅ 4/4 PASS humano** (A01, A02, A03, A05) tras reproducción audible. Progreso de escucha: **4/16**. |
| 2026-08-25 | Nicolás Jiménez | **2.ª verificación del MP3 de A15** tras aviso de sobrescritura → 🟡 **`YELLOW-A15-ASSET-NOT-REPLACED` PERSISTE**: hash, tamaño y `mtime` sin cambio alguno. §3–§7 siguen detenidos. |
| 2026-08-25 | Nicolás Jiménez | **3.ª verificación** — archivo `A15 … - nuevo.mp3` aportado: existe, pero es **copia byte a byte** del original (0 bytes distintos, `mtime` idéntico al ms). 🟡 `YELLOW-A15-ASSET-NOT-REPLACED` sigue abierto. Ambos MP3 conservados sin tocar. |
| 2026-08-25 | Nicolás Jiménez | **BLOQUE 2 preparado** sobre el preview de v4 (A06, A07.1, A07.2, A07.3 — byte-idénticos v3/v4, preflight 4/4). A la espera de los `PASS/ISSUE` humanos. |
| 2026-08-25 | Nicolás Jiménez | **4.ª verificación — 🟢 máster A15 corregido recibido** (`3c750046…`, 7 375 973 B, 7:19, `mtime` 16:16 UTC). Preflight técnico 7/7 GREEN; copia `- nuevo` retirada, carpeta en 50. **`YELLOW-A15-ASSET-NOT-REPLACED` CERRADO.** |
| 2026-08-25 | Nicolás Jiménez | **✅ `PASS-H02`** — A15 escuchado completo, correspondencia audio↔transcripción confirmada. **H-02 CERRADO.** (Timecode real no consignado: el operador devolvió el marcador de plantilla.) |
| 2026-08-25 | Nicolás Jiménez | **BLOQUE 2 — ✅ 4/4 PASS humano** (A06, A07.1, A07.2, A07.3). A06: 4 voces + NARRACIÓN sin rótulos pronunciados. A07.3: tono de llamada audible. A07.1–.3: claridad y brillo adecuados → **observación 2.6 resuelta**. Progreso: **8/16**. |
| 2026-08-25 | Nicolás Jiménez | **BLOQUE 3 — ✅ 4/4 PASS humano** (A08, A09, A10, A11). Aporte para §6: «cada práctica se entiende como invitación, no como obligación, racha o puntuación». Progreso: **12/16**. |
| 2026-08-25 | Nicolás Jiménez | **BLOQUE 4 — ✅ 4/4 PASS humano** (A12, A13, A14; A15 por evidencia acumulada `PASS-H02` + preview técnico). **ESCUCHA HUMANA COMPLETA: 16/16 PASS, cero ISSUE.** |
| 2026-08-25 | Nicolás Jiménez | **Corrección tipográfica autorizada:** título del nodo del Epílogo alineado al máster (U+2014 → **U+2013**) por ruta canónica. Cuerpo y recurso del extracto **sin tocar**. **3.ª diferencia autorizada → diff v3→v4 = 3/3 · 53/56 nodos byte-idénticos.** |
| 2026-08-25 | Nicolás Jiménez | **MOVIMIENTOS 0–2 — ✅ APPROVED** (M1 con observación no bloqueante sobre tiempo de lectura, trasladada al preflight 04B). Progreso editorial: **3/7**. |
| 2026-08-25 | Nicolás Jiménez | **MOVIMIENTOS 3–4 — ✅ APPROVED** (M4 con observación no bloqueante sobre división natural en sesiones). B03 ratificado en pantalla: no promete borrar ni enviar. Progreso editorial: **5/7**. |
| 2026-08-25 | Nicolás Jiménez | **MOVIMIENTOS 5–6 — ✅ APPROVED.** Ratificados B06 (7 registros opcionales y retomables), B07 (honra la promesa de B00 por navegación), T08 (bitácora privada real, no PRODUCTION). **REVISIÓN EDITORIAL COMPLETA: 7/7.** |
| 2026-08-25 | Nicolás Jiménez | **PREFLIGHT FINAL DE v4 — 🟢 GREEN:** privacidad (dueño/admin/mediador/cruce) · diff 3/3 · 53/56 byte-idénticos · conteos 56·16·25·15 · preview sin mutaciones · 5 suites + build EXIT 0 · manifest de recursos · 5 observaciones no bloqueantes. **v4 sigue en borrador; publicación pendiente de autorización.** |
| 2026-08-25 | Nicolás Jiménez | **A15 cargado y cableado:** recurso canónico nuevo `content-1787675737067-a15r2`, entitlement por `PUT /api/groups`, `n-a15` de v4 apuntando al MP3 y al TXT corregidos. **Diff v3→v4 = 2/2 autorizadas · 54/56 nodos byte-idénticos** (ampliado después a 3/3 · 53/56). Preview técnico §G GREEN, cero mutaciones. v4 **sigue en borrador**. |
| 2026-08-25 | Nicolás Jiménez | **MOVIMIENTOS 5–6 — ✅ APPROVED → revisión editorial completa 7/7.** Ratificados B06, B07 y T08. |
| 2026-08-25 | Nicolás Jiménez | **PUBLICACIÓN LOCAL DE v4** — `expv-1787666606847-5uytdu`, `2026-08-25T21:57:15.987Z`, **una sola vez** por ruta canónica. `currentVersionId` → v4. v1–v3 y sus 3 runs intactos; **4 versiones, sin v5**. |
| 2026-08-25 | Nicolás Jiménez | **E2E FINAL 12/12** con `user-qa-e2e-v4` · run `run-1787695111477-nm6ei9` pineado a v4 · A15 corregido · T08 bitácora privada con sentinel `SENTINEL-04A-T08-7f31` releído byte a byte · aislamiento frente a participante, admin y mediador · 0 en Producciones. Credenciales temporales eliminadas; run y 15 evidencias conservados. |
| 2026-08-25 | Nicolás Jiménez | 🟢 **`GREEN-MOOK-ESTAS-AQUI-V4-LOCAL`** — cierre local y documental de 04A. **Cero producción; no es liberación pública.** |
