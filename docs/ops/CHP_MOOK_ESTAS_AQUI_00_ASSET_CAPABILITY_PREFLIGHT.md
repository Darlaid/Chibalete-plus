# CHP-MOOK-ESTAS-AQUI-00 — Preflight de activos y capacidades

**Fecha:** 2026-08-24 · **Rama:** `chp/mook-contract-00` · **HEAD baseline:** `4794604`
**Alcance:** verificación previa. **Cero cargas, cero contenidos creados, cero código modificado, cero deploy.**
**Entorno:** exclusivamente local. **Cero acceso a producción.**

## Veredicto

> ## 🟡 YELLOW-PRIVACY-CONTRACT-GAP
>
> Los **49 activos están completos, íntegros y son cargables** (`GREEN` en el eje de activos:
> 16/16 parejas exactas, 49/49 aceptados por el upload canónico real). La carga **se detiene**
> por una condición de stop explícita del propio prompt: **una bitácora declarada privada es
> legible por un tercero**. Es un hallazgo **demostrado con código ejecutable**, no inferido.

Veredictos secundarios acumulados: `YELLOW-CAPABILITY-GAPS` (releer/editar/eliminar bitácora,
compartir/galería, transcripción descargable) · `ASSET-GAP` acotado (libro canónico ausente del
catálogo local; lista de microcopias 38–59 no entregada).

**No se rebajó ninguna promesa editorial para obtener GREEN.** Las promesas se contrastaron
contra el código y las que no se sostienen se declaran brecha.

---

## A. Baseline verificado

| Ítem | Esperado | Real | Estado |
|---|---|---|---|
| Rama | `chp/mook-contract-00` | `chp/mook-contract-00` | ✅ |
| HEAD | `4794604` | `4794604` | ✅ |
| ADR MOOK §17 y §18 | vigentes | vigentes (leídos íntegros) | ✅ |
| Prototipos A/B | preservados | intactos (`mook_db.json` no tocado) | ✅ |
| `test:mook` | GREEN | **GREEN, sin cambios de código** | ✅ |
| Carpeta fuente | untracked, protegida | untracked; **no se movió, borró, renombró, convirtió ni indexó** | ✅ |

Las sondas ejecutables de este preflight se escribieron **fuera del repositorio** (scratchpad de
sesión) precisamente para no modificar código ni tests. Importan los módulos reales del servidor.

---

## B. Inventario vinculante — manifest

**Total: 49/49 archivos.** 16 MP3 + 33 TXT. Sin duplicados (SHA-256 comparado 49×49), sin
archivos vacíos, sin archivos adicionales, sin claves no parseables.

- **`A04`: ausente. Correcto y esperado** — eliminación editorial declarada. **NO es `ASSET-GAP`.**
  No se renumeró A05–A15. No apareció ningún archivo A04; si aparece en el futuro →
  `EXCLUIDO — NO CARGAR`.
- **Duración total de audio: 80,7 min** (4 840 s) en 16 piezas.
- **Codificación:** los 33 TXT son **UTF-8 sin BOM**, cero bytes nulos, cero caracteres de
  control anómalos, terminaciones CRLF consistentes.

### Audios y transcripciones — 16 parejas

| Clave | MP3 (nombre exacto) | MB | Duración | kbps | Modo | Hz / canales | SHA-256 MP3 (12) | TXT palabras | ppm | SHA-256 TXT (12) | Correspondencia |
|---|---|---:|---:|---:|---|---|---|---:|---:|---|---|
| `A01` | A01. Son las once de la noche.mp3 | 2.71 | 2:56 | 128 | CBR(est) | 44100 / mono | `194637c66ec4` | 394 | 134 | `c1fdd3961ddc` | OK 1+1 |
| `A02` | A02. Si no lo publicaste, ocurrió.mp3 | 6.09 | 9:26 | 90 | VBR/Xing | 44100 / mono | `96587aab149d` | 1196 | 127 | `594be983e1f4` | OK 1+1 |
| `A03` | A03. Todos están hablando.mp3 | 7.80 | 10:16 | 106 | VBR/Xing | 44100 / joint_stereo | `2cb6cee4c5d6` | 1353 | 132 | `ec3a994cd4f9` | OK 1+1 |
| `A05` | A05. Noventa segundos.mp3 | 1.66 | 1:47 | 128 | CBR(est) | 44100 / mono | `c70beb0068d9` | 236 | 131 | `7603d8ea5943` | OK 1+1 |
| `A06` | A06. Me estás escuchando.mp3 | 11.37 | 11:05 | 143 | VBR/Xing | 44100 / joint_stereo | `504485bf351d` | 1404 | 127 | `d2d8d4ced965` | OK 1+1 |
| `A07.1` | A07.1. Si no posteo, desaparezco.mp3 | 3.37 | 7:44 | 61 | VBR/Xing | 24000 / mono | `2b136ce44f9a` | 1106 | 143 | `c53c76ab8d74` | OK 1+1 |
| `A07.2` | A07.2. Libertad no paga las cuentas.mp3 | 4.33 | 9:58 | 61 | VBR/Xing | 24000 / mono | `4342c67bc54f` | 1379 | 138 | `895a4d14250d` | OK 1+1 |
| `A07.3` | A07.3. La elección de empezar a elegir.mp3 | 4.69 | 10:51 | 60 | VBR/Xing | 24000 / mono | `2f4a76b7f0fc` | 1487 | 137 | `270878da15dd` | OK 1+1 |
| `A08` | A08. Día 1 — Una hora sin notificaciones.mp3 | 1.27 | 1:21 | 128 | CBR(est) | 44100 / mono | `e5bad7832fae` | 178 | 130 | `4d36647417e9` | OK 1+1 |
| `A09` | A09. Día 2 — Una sola pestaña.mp3 | 1.22 | 1:19 | 128 | CBR(est) | 44100 / mono | `f4ff74426d1a` | 189 | 144 | `5242bcc18fea` | OK 1+1 |
| `A10` | A10. Día 3 — Una fotografía que no vas a publicar.mp3 | 1.15 | 1:14 | 128 | CBR(est) | 44100 / mono | `ef889cb83492` | 173 | 140 | `87e6dbc1a5f3` | OK 1+1 |
| `A11` | A11. Día 4 — Escuchar sin interrumpir.mp3 | 1.13 | 1:12 | 128 | CBR(est) | 44100 / mono | `df6d23a13f2c` | 171 | 141 | `97c344ff9984` | OK 1+1 |
| `A12` | A12. Día 5 — Caminar sin audífonos.mp3 | 1.20 | 1:17 | 128 | CBR(est) | 44100 / mono | `983b7407e8e4` | 169 | 131 | `4435a7ef4d91` | OK 1+1 |
| `A13` | A13. Día 6 — No responder todavía.mp3 | 1.18 | 1:16 | 128 | CBR(est) | 44100 / mono | `629b97373cd6` | 162 | 128 | `d16368bc501d` | OK 1+1 |
| `A14` | A14. Día 7 — Estar juntos sin pantallas.mp3 | 1.28 | 1:22 | 128 | CBR(est) | 44100 / mono | `0b4db9453839` | 172 | 125 | `9986603b4c53` | OK 1+1 |
| `A15` | A15. Una ética de la presencia.mp3 | 4.86 | 7:29 | 91 | VBR/Xing | 44100 / mono | `f99feff55f4c` | 903 | 121 | `4ead4ec29fa0` | OK 1+1 |

**MIME real de los 16 MP3 (detectado con la librería del servidor): `audio/mpeg`.**

### Bitácoras (B00–B07) y textos editoriales (T00–T08)

| Clave | Nombre exacto | bytes | Codificación | Palabras | Líneas | Bytes nulos | SHA-256 (12) |
|---|---|---:|---|---:|---:|---:|---|
| `B00` | B00. Bitácora de entrada — Dónde está mi atención.txt | 718 | UTF-8 | 112 | 12 | 0 | `015593776c79` |
| `B01` | B01. Bitácora — Algo importante que nunca publiqué.txt | 455 | UTF-8 | 73 | 11 | 0 | `f4b6971582dd` |
| `B02` | B02. Bitácora — La opinión que repetí.txt | 575 | UTF-8 | 84 | 12 | 0 | `e3ef25bcfbf6` |
| `B03` | B03. Bitácora — Antes de enviar.txt | 624 | UTF-8 | 92 | 14 | 0 | `0edce3e4bd6d` |
| `B04` | B04. Bitácora — Lo que escuché.txt | 486 | UTF-8 | 68 | 11 | 0 | `4cbe6826346b` |
| `B05` | B05. Bitácora — La puerta que no quiero cerrar.txt | 455 | UTF-8 | 66 | 12 | 0 | `96d1fb412817` |
| `B06` | B06. Bitácora del reto — Registro diario.txt | 472 | UTF-8 | 71 | 15 | 0 | `4b3d1d0775a5` |
| `B07` | B07. Bitácora de salida — Volver a estar.txt | 643 | UTF-8 | 100 | 17 | 0 | `4d8efa2bac06` |
| `T00` | T00. Carta de entrada.txt | 2951 | UTF-8 | 450 | 12 | 0 | `344e09ce6124` |
| `T01` | T01. La vida sin testigos.txt | 1964 | UTF-8 | 298 | 9 | 0 | `280cb90ba494` |
| `T02` | T02. Quién eligió esta opinión.txt | 2576 | UTF-8 | 389 | 14 | 0 | `f2a5ab6d8684` |
| `T03` | T03. Cinco formas de repetir sin pensar.txt | 1086 | UTF-8 | 171 | 11 | 0 | `0ef0893ea791` |
| `T04` | T04. La pausa metódica.txt | 2039 | UTF-8 | 312 | 15 | 0 | `893425fc7c6d` |
| `T05` | T05. El derecho a terminar una frase.txt | 2375 | UTF-8 | 354 | 14 | 0 | `3d34865f4f03` |
| `T06` | T06. Elegir también es perder.txt | 3183 | UTF-8 | 472 | 13 | 0 | `5111c1e4c1e6` |
| `T07` | T07. Antes del reto... pequeñas rebeldías.txt | 2550 | UTF-8 | 367 | 15 | 0 | `5ed5d88f4bdb` |
| `T08` | T08. Mi manera de estar.txt | 1374 | UTF-8 | 215 | 13 | 0 | `dda22ce9001d` |

**MIME real de los 33 TXT:** `file-type` devuelve `undefined` (texto plano, comportamiento
esperado) y la capa 2 del servidor los valida con `isTextFileSafe`: **0 bytes nulos en 33/33**.

### Aceptación por el upload canónico — probada, no supuesta

Se reprodujeron **las tres capas reales** de `/api/upload` (`server/server.js:2317-2421`) contra
los 49 archivos, usando la **misma librería `file-type` del servidor** (`node_modules/file-type`):

| Capa | Mecanismo | Resultado |
|---|---|---|
| 1 — filtro nominal | `allowedExtensions` + `allowedMimeTypes` (`server.js:2318`) | 49/49 pasan (`mp3`, `txt` en whitelist) |
| 2 — magic numbers | `fileTypeFromFile` + `matchesExpectedCategory('audio')` | **16/16 MP3 → `audio/mpeg`** ✅ |
| 2 — TXT | `isTextFileSafe` (null-byte scan 4 KiB) | 33/33 seguros ✅ |
| 3 — tamaño | `MAX_UPLOAD_BYTES` = 2 GiB | 49/49 muy por debajo (máx. 11,37 MB) |

**`ACEPTADOS: 49/49 · RECHAZADOS: ninguno`.** Los MP3 se dividen en 5 con cabecera ID3v2 y 11 con
frame sync crudo; `file-type` resuelve ambos a `audio/mpeg`. **No hay riesgo de rechazo por MIME.**

### Verificación de transcripciones

| Criterio | Resultado |
|---|---|
| UTF-8 legible | ✅ 16/16 |
| Título/clave correspondiente | ✅ 16/16 — nombre base **idéntico** entre MP3 y TXT |
| Contenido no vacío | ✅ 16/16 (mín. 162 palabras) |
| Relación palabras↔duración | ✅ 16/16 en **121–144 ppm**, rango plausible de narración en español |
| Voces conservadas en diálogo | ✅ **A06** conserva `VOZ 1`, `VOZ 2`, `VOZ 3`, `VOZ 4` y `NARRACIÓN` |
| Ausencia de acotaciones técnicas | ✅ 0 marcas `[música]`, `[pausa]`, timecodes o similares en los 16 |

> **Limitación registrada honestamente:** el entorno **no permite reproducir audio**. La
> correspondencia se verificó por **nombre idéntico + densidad palabras/duración + estructura de
> voces**, que es evidencia fuerte pero **no prueba** que la voz diga exactamente ese texto.
> **No se declara coincidencia exacta únicamente por el nombre.** La verificación fonética
> audio↔texto queda como **responsabilidad editorial humana** — consistente con ADR §18.4, que ya
> asigna la calidad lingüística al humano y no al código.

---

## C. Libro canónico — «Me desconecto, luego existo»

**`ASSET-GAP` (local, acotado, no bloqueante para el diseño).**

| Ítem | Hallazgo |
|---|---|
| Presencia en catálogo local | ❌ **Ausente.** `data/content.json` tiene 17 ítems; ninguno coincide |
| `contentId` documentado | `content-1765751139919` (según `CHP_MOOK_PILOT_DESIGN_00.md:9`) |
| Dónde existe | Catálogo **productivo** (con texto plano y contexto Leo ya construido) |
| Verificable aquí | **No** — este preflight tiene cero acceso a producción, por diseño |
| Referencia local viva | `data/mook_db.json` conserva la fixture dev `me-desconecto-luego-existo` |

**Formato / paginación / modos de lectura:** no verificables localmente al no estar el ítem. Lo
que sí está determinado por el **modelo canónico** (campos reales observados en `content.json`):
`tipo`, `numero_paginas`, `texto_plano_url`, `url_recurso`, `portada_url`, `parentId`,
`isCollection`, `standalone`.

### Apertura por capítulos o rangos — `CAPABILITY-GAP` confirmado

| Capacidad | Estado | Evidencia |
|---|---|---|
| Abrir un rango de páginas concreto | ❌ **No existe** | No hay campo `pagina_inicio`/`capitulo` en el modelo; `VisorPDF` no acepta parámetro de página inicial ni deep-link (`pages/VisorPDF.tsx`) |
| Continuar después en el libro completo | ✅ **Sí** | El progreso canónico es por `contentId` y el visor reanuda donde quedó (ADR §8: progreso de lectura único) |
| Nodo READING con rango | ⚠️ Solo **descriptivo** | `config` es passthrough libre (`experienceStore.js:127`), pero el runtime **no renderiza** ningún campo de rango; solo `config.instruccion` |

**Las 11 lecturas indicadas** (7–14, 15–33, 35–40, 41–47, 49–57, 59–67, 69–77, 79–87, 89–95,
113–121 y adicional 133–152) **no pueden abrirse hoy como rangos** del libro completo.

### Solución mínima propuesta — NO creada, solo especificada

`READY-WITH-CANONICAL-MAPPING`. **Extractos canónicos derivados**, con mecanismos que **ya
existen**, sin componente, ruta ni modelo especial para este título:

```
Contenido derivado (uno por rango)
  titulo:      "Fragmento de Me desconecto, luego existo — págs. 49–57"
  tipo:        libro                        (visor canónico existente, sin visor nuevo)
  parentId:    content-1765751139919        ← procedencia y vínculo con la obra
  standalone:  false                        ← no se descubre como obra independiente (ADR §16)
  status:      disponible
```

- `parentId` **ya es el mecanismo de pertenencia** del catálogo
  (`resolveCollectionContentIds`, `server.js:1081`) → **procedencia trazable**; satisface la
  condición de stop «fragmentos sin procedencia o vínculo con el libro».
- `standalone:false` **ya existe** en el modelo → el extracto no contamina Biblioteca.
- El nodo READING referencia el extracto por `contentId`; «continuar en el libro completo» se
  resuelve como un **nodo READING adicional** apuntando al `contentId` padre.
- **Cero duplicación de la obra** (ADR §2): el extracto es una pieza editorial acotada con
  procedencia declarada, no una copia del libro.

**Precondición de la siguiente unidad:** confirmar que `content-1765751139919` existe en el
catálogo donde se monte y que su paginación cubre hasta la página 152.

---

## D. Mapa de ensamblaje — matriz de siete movimientos

> **⚠️ Estado de esta matriz: DERIVADA — requiere ratificación editorial.**
> El documento de **estructura editorial** con la adscripción movimiento→pieza **no está en la
> carpeta fuente** (contiene exactamente los 49 activos y nada más) ni venía en el encargo. La
> matriz se reconstruyó desde: (1) el **único anclaje explícito entregado** — Movimiento 3 —,
> (2) los títulos de las piezas, (3) el arco declarado en `T00`, y (4) el orden de las claves.
> **Las columnas técnicas (tipo de nodo, configuración, terminación, privacidad) son
> vinculantes**; la adscripción de cada pieza a su movimiento debe confirmarla el editor.

Reglas aplicadas: `Axx` → AUDIO · `Txx` → READING con recurso canónico original del MOOK ·
capítulos/fragmentos → READING vinculado al libro · `Bxx` → **no asignado a ACTIVITY** (ver §E) ·
A08–A14 expandidos como **siete piezas independientes** · preguntas y transiciones en **campos
editables**, nunca hardcodeadas · toda la experiencia editable vía Studio, versiones y `contentId`.

| Mov. | Orden | Clave / recurso | Tipo nodo | Configuración | Terminación | Privacidad |
|---|---:|---|---|---|---|---|
| **0** | 1 | cap. **7–14** | READING | `resourceRef`=extracto derivado | marca explícita | pública |
| | 2 | `A01` Son las once de la noche | AUDIO | `resourceRef` + `config.transcripcion`=A01 | marca explícita | pública |
| | 3 | `T00` Carta de entrada | READING | `resourceRef`=texto canónico MOOK | marca explícita | pública |
| | 4 | `B00` Bitácora de entrada | ⛔ **BLOQUEADO** | — | — | **privada — no soportada** |
| **1** | 5 | cap. **15–33** | READING | extracto derivado | marca explícita | pública |
| | 6 | `A02` Si no lo publicaste, ocurrió | AUDIO | + transcripción A02 | marca explícita | pública |
| | 7 | `T01` La vida sin testigos | READING | texto canónico | marca explícita | pública |
| | 8 | `B01` Algo importante que nunca publiqué | ⛔ **BLOQUEADO** | — | — | **privada — no soportada** |
| **2** | 9 | cap. **35–40** y **41–47** | READING ×2 | extractos derivados | marca explícita | pública |
| | 10 | `A03` Todos están hablando | AUDIO | + transcripción A03 | marca explícita | pública |
| | 11 | `T02` Quién eligió esta opinión | READING | texto canónico | marca explícita | pública |
| | 12 | `T03` Cinco formas de repetir sin pensar | READING | texto canónico | marca explícita | pública |
| | 13 | `B02` La opinión que repetí | ⛔ **BLOQUEADO** | — | — | **privada — no soportada** |
| **3** | 14 | cap. **49–57** | READING | extracto derivado | marca explícita | pública |
| | 15 | `A05` Noventa segundos | AUDIO | + transcripción A05 | marca explícita | pública |
| | 16 | `T04` La pausa metódica | READING | texto canónico | marca explícita | pública |
| | 17 | `B03` Antes de enviar | ⛔ **BLOQUEADO** | — | — | **privada + borrable — no soportada** |
| **4** | 18 | cap. **59–67** | READING | extracto derivado | marca explícita | pública |
| | 19 | `A06` Me estás escuchando *(ficción sonora, 4 voces)* | AUDIO | + transcripción A06 **con voces** | marca explícita | pública |
| | 20 | `T05` El derecho a terminar una frase | READING | texto canónico | marca explícita | pública |
| | 21 | `B04` Lo que escuché | ⛔ **BLOQUEADO** | — | — | **privada — no soportada** |
| **5** | 22 | cap. **69–77** y **79–87** | READING ×2 | extractos derivados | marca explícita | pública |
| | 23 | `A07.1` Si no posteo, desaparezco | AUDIO | + transcripción A07.1 | marca explícita | pública |
| | 24 | `A07.2` Libertad no paga las cuentas | AUDIO | + transcripción A07.2 | marca explícita | pública |
| | 25 | `A07.3` La elección de empezar a elegir | AUDIO | + transcripción A07.3 | marca explícita | pública |
| | 26 | `T06` Elegir también es perder | READING | texto canónico | marca explícita | pública |
| | 27 | `B05` La puerta que no quiero cerrar | ⛔ **BLOQUEADO** | — | — | **privada — no soportada** |
| **6** | 28 | cap. **89–95** | READING | extracto derivado | marca explícita | pública |
| | 29 | `T07` Antes del reto… pequeñas rebeldías | READING | texto canónico | marca explícita | pública |
| | 30 | `A08` Día 1 — Una hora sin notificaciones | AUDIO `required:false` | + transcripción A08 | marca explícita | pública |
| | 31 | `A09` Día 2 — Una sola pestaña | AUDIO `required:false` | + transcripción A09 | marca explícita | pública |
| | 32 | `A10` Día 3 — Una fotografía que no vas a publicar | AUDIO `required:false` | + transcripción A10 | marca explícita | pública |
| | 33 | `A11` Día 4 — Escuchar sin interrumpir | AUDIO `required:false` | + transcripción A11 | marca explícita | pública |
| | 34 | `A12` Día 5 — Caminar sin audífonos | AUDIO `required:false` | + transcripción A12 | marca explícita | pública |
| | 35 | `A13` Día 6 — No responder todavía | AUDIO `required:false` | + transcripción A13 | marca explícita | pública |
| | 36 | `A14` Día 7 — Estar juntos sin pantallas | AUDIO `required:false` | + transcripción A14 | marca explícita | pública |
| | 37 | `B06` Bitácora del reto — registro diario | ⛔ **BLOQUEADO** | — | — | **privada ×7 — no soportada** |
| **Cierre** | 38 | cap. **113–121** | READING | extracto derivado | marca explícita | pública |
| | 39 | `A15` Una ética de la presencia | AUDIO | + transcripción A15 | marca explícita | pública |
| | 40 | `T08` Mi manera de estar | READING | texto canónico | marca explícita | pública |
| | 41 | `B07` Bitácora de salida — Volver a estar | ⛔ **BLOQUEADO** | — | — | **privada + relectura de B00 — no soportada** |
| | 42 | adicional **133–152** | READING `required:false` | extracto derivado | marca explícita | pública |
| | 43 | Continuar en el libro completo | READING `required:false` | `resourceRef`=`content-1765751139919` | marca explícita | pública |

**Cobertura:** los 49 activos quedan asignados — 16 AUDIO (A01–A15 incl. A07.1/.2/.3, **sin A04**),
9 READING de textos `T`, 11 READING de extractos + 1 al libro completo, y 8 bitácoras `B`
**bloqueadas**. La ausencia de A04 es intencional y no deja hueco en la secuencia.

**Sobre «Movimiento 0–6 → siete módulos editables»:** el bloque de cierre (filas 38–43) constituye
el séptimo módulo si el Movimiento 6 absorbe el reto. La matriz deja esa frontera marcada para
ratificación. **Ambas formas son publicables**: ADR §18.1 congela que una Experiencia admite uno o
varios módulos y **cualquier subconjunto** de los seis tipos de nodo.

**Nada de esto exige componente, ruta ni modelo especial para «¿Estás aquí?».** Son nodos
genéricos sobre `ExperienceVersion`, exactamente como los prototipos A y B.

---

## E. Auditoría de privacidad — `PRIVACY-BLOCKER`

Determinado **con código ejecutable** contra los módulos reales del servidor
(`server/lib/experienceStore.js`) y las guardas reales de ruta (`server/server.js`).

### E.1 ¿Quién puede leer hoy una respuesta ACTIVITY?

| Actor | Vía | ¿Puede leerla? | Evidencia |
|---|---|---|---|
| **Participante propietario** | `participantEvidenceView` | ❌ **NO** | `currentText` es `undefined` si `requiresReview:false` (`experienceStore.js:476`) |
| **Administrador (revisor)** | `reviewListView` | ❌ NO | filtra `requiresReview` (`:492`) |
| **Administrador (revisor)** | `reviewDetailView(id de la ACTIVITY)` | ❌ NO | `findReviewable` lanza `NOT_REVIEWABLE` (`:391`) |
| **Administrador (revisor)** | `reviewDetailView(id de una PRODUCTION del mismo run)` | ⚠️ **SÍ — íntegra** | **`activityContext`** (`:526-537`) devuelve `preguntas` + `answers` **verbatim** |
| **Revisor** | idem | ⚠️ **SÍ** | revisor y admin son el mismo actor en el MVP (§17.4) |
| **Mediador** | rutas `review/*` | ❌ NO | `requireReviewAccess` → **403 `MEDIATOR_SCOPE_GATED`** (fail-closed por M1-B) |
| **Miembros del grupo** | — | ❌ NO | no existe superficie de lectura por grupo |
| **Otro participante** | `GET /route` | ❌ NO | la ruta filtra por `req.user.id`; `submitEvidence` exige `NOT_RUN_OWNER` |

**Salida literal de la sonda:**

```
SÍ ⚠️  | admin (revisor) | reviewDetailView(evidenceId de PRODUCTION).activityContext
        | activityContext=1 entrada(s); answers=["CONFESION-PRIVADA-DE-BITACORA-42"]

RESULTADO: PRIVACY-BLOCKER — el revisor lee ACTIVITY íntegra vía activityContext.
```

> **`requiresReview:false` NO es privacidad.** Es exactamente la confusión que el encargo advertía.
> El campo excluye la evidencia de la *cola* de revisión, pero **no** del *detalle* de revisión:
> basta que el mismo run tenga **una** PRODUCTION para que **todas** las respuestas ACTIVITY de ese
> run se expongan al administrador, junto al **nombre real** del participante
> (`resolveParticipantName`, `server.js:1827`).

El comportamiento es **deliberado y correcto para su propósito declarado** — ADR D3 lo diseñó como
«contexto de mediación» para revisar una producción. **No es un bug del MOOK; es una incompatibilidad
con el contrato editorial de «¿Estás aquí?»**, que promete lo contrario.

### E.2 Contraste con la promesa editorial (literal de los activos)

| Promesa | Fuente | Estado |
|---|---|---|
| «Nadie más podrá verla a menos que tú decidas compartirla» | `B00` (microcopia obligatoria) | ❌ **VIOLADA** por `activityContext` |
| «Algunas respuestas podrán compartirse; otras serán privadas. Tú decides» | `T00` Carta de entrada | ❌ sin mecanismo de decisión |
| «puedes copiarlo, guardarlo o borrarlo» | `B03` | ❌ no existe borrado |
| «Mostrar… la respuesta correspondiente de B00» | `B07` | ❌ el dueño **no puede releer** su B00 |

### E.3 Nueve capacidades exigidas a las bitácoras

| # | Capacidad | Estado | Evidencia |
|---|---|---|---|
| 1 | Privadas por defecto | ❌ | `activityContext` (E.1) |
| 2 | Guardado y reanudación | ❌ | no hay borrador: `ACTIVITY_INCOMPLETE` rechaza el envío vacío; todo envío es definitivo |
| 3 | Invisibilidad para terceros mientras sean privadas | ❌ | E.1 |
| 4 | Edición | ❌ | `resubmitEvidence` → `NOT_REVIEWABLE` |
| 5 | Eliminación | ❌ | no existe función de borrado en el store |
| 6 | Compartir por decisión separada | ❌ | no existe backend de compartir |
| 7 | Retirar lo compartido | ❌ | idem |
| 8 | Compartir con grupo | ❌ | idem (además gateado por M1-B) |
| 9 | Proponer para galería | ❌ | no existe galería (grep en `server/`: cero resultados) |
| + | Aviso antes de salir sin guardar | ❌ runtime / ✅ Studio | `beforeunload` existe en `ExperienceStudio.tsx:410`, **no** en el runtime del participante |

**Conclusión: 0 de 9 capacidades se cumplen. `PRIVACY-BLOCKER` emitido.**
**NO se cargan B00–B07 como ACTIVITY.**

---

## F. Reto de siete días

Auditado con sonda ejecutable sobre el store real.

| Requisito | Estado | Evidencia ejecutable |
|---|---|---|
| Siete registros separados | ✅ **SÍ** | 7 envíos sucesivos al mismo nodo generan **7 evidencias**; `evidenceIds` crece 1→7 |
| **Sin sobrescritura** | ✅ **SÍ** | textos conservados: `["dia 1", …, "dia 7"]` — append puro |
| Conservar historial | ✅ **SÍ** | idem, `doc.evidence` acumula |
| Repetir una práctica | ✅ SÍ | reenviar el mismo nodo está permitido |
| Adaptarla | ✅ SÍ | texto libre; `B06` ya modela «¿Quiero repetirla? Sí / No / De otra manera» |
| Omitirla | ✅ SÍ | `required:false` permite saltar |
| Cerrar y continuar otro día | ✅ SÍ | el run persiste y reanuda (validado en PROTOTYPE-02) |
| Terminar el MOOK sin las siete | ✅ **SÍ** | con las 7 opcionales, `status=completed` con `1/1` requeridos |
| Cero rachas o penalizaciones | ✅ SÍ | no existe `racha`/`streak`/`ranking`/`score` en ninguna superficie MOOK |

> **La condición de stop «respuestas del reto sobrescritas» NO se cumple: el modelo es
> append-only y conserva las siete.** El reto **no** es el bloqueador.

### Representación mínima compatible

**`B06` repetible** es viable en el modelo actual **en su mecánica**, y es la opción recomendada
(un nodo, siete envíos, historial íntegro). La alternativa de **siete actividades independientes**
también funciona y permite omitir sin penalización.

**Pero ambas heredan el `PRIVACY-BLOCKER` de §E**: el registro diario del reto es material privado,
y hoy sería legible por el administrador si el recorrido incluye cualquier PRODUCTION.
**El reto es `CAPABILITY-READY` en mecánica y `PRIVACY-BLOCKED` en contrato.**

No se implementó lógica temporal, notificaciones ni desbloqueos diarios (fuera de alcance y no
requeridos: la fecha es un campo opcional del propio `B06`).

---

## G. Audio, lecturas y cierre

| Requisito | Estado | Evidencia |
|---|---|---|
| Audio sin autoplay | ✅ **SÍ** | el nodo AUDIO **no incrusta reproductor**: enlaza a `/contenido/:id`; `VisorAudio` sin `autoPlay`, `play()` solo por gesto (`VisorAudio.tsx:17`) |
| Pausa y reanudación | ✅ SÍ | `togglePlay` con pausa real |
| Sin reproducción automática siguiente | ✅ **SÍ** | `onEnded` solo hace `setIsPlaying(false)`; no hay cola ni «siguiente» |
| Transcripción visible | ✅ SÍ | `<details>` «Ver transcripción (alternativa textual)» (`Experiencias.tsx:89-95`) |
| **Transcripción descargable** | ❌ **NO** | se renderiza como `<p>`; no hay control de descarga. En `VisorAudio` el botón de descarga es un **stub**: `alert('Función de descarga no implementada.')` |
| Duración disponible | ⚠️ **Parcial** | `durationLabel` existe **solo a nivel de Experiencia** (global); **ningún nodo muestra su duración** |
| Lectura guardable/reanudable | ✅ SÍ | progreso canónico por `contentId` + reanudación del run |
| Salir tras cualquier pieza sin penalización | ✅ SÍ | el run persiste; no hay penalización ni caducidad |
| Botón para continuar en el libro | ⚠️ **Vía mapeo** | no existe como control propio; se resuelve con un nodo READING al `contentId` padre (§C) |
| **Regreso a B00 desde el cierre** | ❌ **NO** | el cierre ofrece «Volver a Biblioteca» / «Revisar recorrido» / «Otra Experiencia»; **y el dueño no puede releer su B00** (§E.1) |
| Proyecto final privado / de grupo / propuesto a galería | ❌ **NO** | PRODUCTION es **siempre** revisable por administrador; no hay opción privada, ni de grupo, ni galería |

> **Se cumple la regla «no presentar controles de compartir o galería sin autorización y
> persistencia reales»**: hoy el runtime **no muestra** ningún control de compartir ni galería.
> No hay nada simulado en producción. La brecha es de **capacidad ausente**, no de UI falsa —
> y por eso mismo esos controles **no deben añadirse** hasta que exista backend real.

---

## H. Microcopias

### H.1 Lista 38–59 — no entregada

**`ASSET-GAP`.** La carpeta fuente contiene **exactamente los 49 activos** y ningún documento de
microcopias. La numeración 38–59 no aparece en ningún archivo del repositorio ni de la carpeta.
**No se inventó su contenido.** Se requiere el documento para clasificarlas una por una.

### H.2 Clasificación de las microcopias sí presentes en los activos

| Microcopia (literal del activo) | Origen | Clasificación |
|---|---|---|
| «Volveremos a esta respuesta al final del recorrido» | `B00` | **REQUIERE CAMBIO MÍNIMO** (releer B00 en B07) |
| «Nadie más podrá verla a menos que tú decidas compartirla» | `B00` | ⛔ **FUERA DEL MVP hasta resolver `PRIVACY-BLOCKER`** — hoy sería **falsa** |
| «Al final puedes copiarlo, guardarlo o borrarlo. La plataforma no lo enviará» | `B03` | ⛔ **FUERA DEL MVP** (no hay borrado) |
| «No mostrar porcentaje de éxito ni calificación» | `B06` | ✅ **YA SOPORTADA** (no existen calificaciones en MOOK) |
| «La finalización se registra únicamente cuando el usuario guarda una observación» | `B06` | ✅ **YA SOPORTADA** (completitud por envío) |
| «Tiempo sugerido: cinco minutos» | `B00` | ✅ **CONFIGURABLE EN STUDIO** (`config.instruccion`) |
| Preguntas 1–5 y frases de cierre de cada bitácora | `B00`–`B07` | ✅ **CONFIGURABLE EN STUDIO** (`config.preguntas[].texto`) |
| Consignas y transiciones de cada movimiento | `T00`–`T08` | ✅ **CONFIGURABLE EN STUDIO** / recurso canónico |
| «Mostrar… la respuesta correspondiente de B00» | `B07` | ⛔ **REQUIERE CAMBIO MÍNIMO** (releer evidencia propia) |

**Ningún texto de «¿Estás aquí?» se hardcodea en componentes globales** — todos van a
`config.preguntas`, `config.instruccion`, `config.consigna` o a un recurso canónico referenciado.

### H.3 Confirmaciones transversales

| Compromiso | Estado | Evidencia |
|---|---|---|
| Sin autoplay | ✅ | §G |
| Sin scroll infinito | ✅ | cero `IntersectionObserver` / `loadMore` en `Experiencias.tsx` |
| Sin rankings, rachas ni comparaciones | ✅ | cero `racha`/`streak`/`ranking`/`score`; ADR §18.1.8 lo congela |
| Cierre de sesión sin lenguaje de abandono | ✅ | el estado interno `abandoned` **jamás** se muestra al usuario (cero ocurrencias en la UI) |
| Transcripción obligatoria para publicar | ✅ | `publishVersion` lanza **400 `TRANSCRIPTION_REQUIRED`** para todo nodo VIDEO/AUDIO sin transcripción (ADR §18.4; verificado por `test:mook`) |

**Los 16 AUDIO tienen su transcripción lista**, de modo que el gate de publicación se satisface
con solo pegar cada TXT en `config.transcripcion`.

---

## I. Flexibilidad — demostrada sobre el código

| Capacidad exigida | Estado | Evidencia |
|---|---|---|
| Añadir, eliminar y reordenar piezas | ✅ | `addNode` / `removeNode` / `moveNode` (`ExperienceStudio.tsx:562-571`) |
| Sustituir recursos por `contentId` | ✅ | botón «Cambiar» / «Quitar» del selector canónico |
| Modificar preguntas y transiciones sin código | ✅ | `config.preguntas`, `instruccion`, `semilla`, `consigna` editables en Studio |
| Añadir movimientos | ✅ | `addModule` (`:562`); ADR §18.1.1 admite uno o varios módulos |
| Crear v2 sin alterar v1 | ✅ | `newVersionFromPublished`; `VERSION_IMMUTABLE` protege lo publicado; **probado byte a byte en PROTOTYPE-02** |
| Archivar sin borrar runs | ✅ | «¿Archivar? No borra versiones ni progreso»; los runs activos terminan por el pin (§17.3) |
| Incorporar materiales nuevos después | ✅ | nueva versión DRAFT + nodos adicionales; los runs en curso quedan pineados |

**El plan de §D es enteramente ejecutable con estas capacidades. No requiere código nuevo** —
salvo las brechas de §E/§G, que son de contrato, no de estructura.

---

## J. Clasificación consolidada

| Elemento | Clasificación |
|---|---|
| 16 MP3 + 16 transcripciones | ✅ `READY` |
| 9 textos editoriales `T00`–`T08` | ✅ `READY` |
| Aceptación por el upload canónico (49/49) | ✅ `READY` |
| Gate de transcripción para publicar | ✅ `READY` |
| Reto de 7 días (mecánica append-only) | ✅ `READY` |
| Flexibilidad editorial (§I) | ✅ `READY` |
| Lecturas por rango de páginas | 🟡 `READY-WITH-CANONICAL-MAPPING` (extractos derivados) |
| Libro `Me desconecto, luego existo` en catálogo local | 🟡 `ASSET-GAP` (existe en producción) |
| Lista de microcopias 38–59 | 🟡 `ASSET-GAP` (no entregada) |
| Estructura editorial movimiento→pieza | 🟡 `ASSET-GAP` (matriz derivada, a ratificar) |
| Transcripción descargable | 🟡 `CAPABILITY-GAP` |
| Duración por nodo | 🟡 `CAPABILITY-GAP` |
| Regreso a B00 desde el cierre / releer evidencia propia | 🟡 `CAPABILITY-GAP` |
| Borrador, guardado y reanudación de bitácora | 🟡 `CAPABILITY-GAP` |
| Editar / eliminar una bitácora | 🟡 `CAPABILITY-GAP` |
| Aviso antes de salir sin guardar (runtime) | 🟡 `CAPABILITY-GAP` |
| Compartir / retirar / compartir con grupo / galería | 🟡 `CAPABILITY-GAP` (sin backend) |
| Proyecto final privado o de grupo | 🟡 `CAPABILITY-GAP` |
| **Bitácora privada legible por administrador** | 🔴 **`PRIVACY-BLOCKER`** |

### Condiciones de stop — evaluación

| Condición de stop | ¿Se activa? |
|---|---|
| Activo faltante o corrupto | ❌ No — 49/49 íntegros |
| Transcripción ausente | ❌ No — 16/16 presentes |
| MP3 no admitido | ❌ No — 16/16 aceptados |
| **Bitácora privada visible para terceros** | 🔴 **SÍ — DETIENE LA CARGA** |
| Respuestas del reto sobrescritas | ❌ No — append-only verificado |
| Fragmentos sin procedencia o vínculo con el libro | ⚠️ Evitable con `parentId` (§C) — no se crearán sin él |
| Compartir/galería simulados sin backend real | ❌ No hoy — **y no deben añadirse** hasta tener backend |

**Una sola condición de stop se activa. Es suficiente para no cargar B00–B07.**

---

## K. Solución mínima propuesta

Ninguna de estas correcciones se implementa en este preflight.

### K.1 Cerrar el `PRIVACY-BLOCKER` (obligatorio antes de cargar bitácoras)

**Opción recomendada — `privado` explícito por nodo, con corte en la frontera de lectura:**

1. Campo de configuración `config.privado: true` en nodos ACTIVITY (el `config` ya es passthrough:
   **cero cambio de esquema**).
2. `reviewDetailView` **excluye de `activityContext`** toda evidencia cuyo nodo sea `privado`.
   Cambio quirúrgico y localizado en `experienceStore.js:526-537`.
3. Test que **falle** si una respuesta de nodo privado aparece en cualquier vista de revisión —
   el equivalente permanente de la sonda de §E.1.

Alcance: **un campo y un filtro**. No toca autenticación, ni el modelo de grupos, ni el access
engine, ni la telemetría. Compatible con `CLAUDE.md` (cambio mínimo, localizado, retrocompatible:
sin `privado`, el comportamiento actual se conserva intacto).

### K.2 Releer la evidencia propia (habilita B07 y el regreso a B00)

Que `participantEvidenceView` devuelva `answers` **al dueño** cuando `requiresReview:false`
(hoy las oculta a todo el mundo, incluido quien las escribió — `experienceStore.js:476`).
Sin esto, B07 y «regreso a B00 desde el cierre» son **irrealizables**.

### K.3 Brechas restantes — decisión de producto, no de código

- **Compartir / galería:** requieren backend real (persistencia, autorización, retirada). Mientras
  no exista, **`T00` debe reescribirse** para no prometer «algunas respuestas podrán compartirse»,
  o el alcance debe ampliarse formalmente. **No se simula.**
- **Borrador / editar / eliminar bitácora:** ADR §17.5 declara explícitamente que los borradores no
  enviados **no se conservan**, y §18.3 congela que una ACTIVITY respondida persiste. Habilitarlos
  **contradice el contrato congelado** → exige decisión editorial explícita, no un parche.
- **Transcripción descargable, duración por nodo, aviso al salir:** cambios menores de UI, sin
  implicación contractual.

---

## L. Plan de reanudación

**Regla:** el siguiente prompt cierra **exclusivamente** las brechas que este preflight demostró.

| # | Paso | Bloquea a | Responsable |
|---|---|---|---|
| 1 | **Ratificar la matriz de §D** (movimiento→pieza) y entregar la **estructura editorial** | ensamblaje | editorial |
| 2 | **Entregar la lista de microcopias 38–59** | clasificación §H | editorial |
| 3 | **Decidir §K.3**: ¿se amplía el alcance con compartir/galería, o se reescribe `T00`/`B00`? | contrato editorial | producto |
| 4 | **Implementar K.1** (`config.privado` + filtro + test) | **carga de B00–B07** | ingeniería |
| 5 | **Implementar K.2** (releer evidencia propia) | B07 y regreso a B00 | ingeniería |
| 6 | Confirmar `content-1765751139919` en el catálogo destino | extractos | ingeniería |
| 7 | Crear los **11 extractos derivados** con `parentId` + `standalone:false` | lecturas por rango | editorial + ingeniería |
| 8 | Cargar los **16 MP3** y pegar las 16 transcripciones en `config.transcripcion` | publicación | ingeniería |
| 9 | Cargar los **9 textos `T`** como contenido canónico `standalone:false` | publicación | ingeniería |
| 10 | Montar los 7 módulos en Studio, DRAFT → preview → publicar | — | editorial |
| 11 | **Verificación editorial humana audio↔transcripción** (limitación de §B) | publicación | editorial |

**Orden obligatorio:** los pasos **4 y 5 preceden a cualquier carga de bitácoras**. Los pasos 6–9
(activos no sensibles: audios, textos, extractos) **pueden ejecutarse antes**, porque no tocan
material privado y ya están `READY`.

---

## Evidencia y reproducibilidad

Sondas ejecutables escritas **fuera del repositorio** (scratchpad de sesión), importando los
módulos reales del servidor sin modificarlos:

| Sonda | Qué prueba |
|---|---|
| `manifest.py` | 49 archivos: SHA-256, tamaño, MIME real, cabeceras MP3 (bitrate/Hz/canales/duración vía frame + Xing), codificación y conteos TXT |
| `upload_gate_probe.mjs` | Las 3 capas reales de `/api/upload` con el `file-type` del proyecto → **49/49** |
| `privacy_probe.mjs` | Quién puede leer una respuesta ACTIVITY → **`PRIVACY-BLOCKER`** |
| `challenge_probe.mjs` | Reto de 7 días: append-only, omisión, borrador, edición |

**Integridad del baseline:** `npm run test:mook` **GREEN**. Cero archivos del repositorio
modificados salvo este documento. La carpeta editorial no se movió, borró, renombró, convirtió ni
indexó en Git.
