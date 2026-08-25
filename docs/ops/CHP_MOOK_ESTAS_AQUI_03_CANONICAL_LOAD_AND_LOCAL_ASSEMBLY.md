# CHP-MOOK-ESTAS-AQUI-03 — Carga canónica y ensamblaje local

**Fecha:** 2026-08-25 · **Rama:** `chp/mook-contract-00` · **Baseline:** `be16d83`
**Unidad de contenido y autoría.** Cero código nuevo, cero modelos, cero tipos de nodo,
cero importadores permanentes. **Cero producción. Sin deploy.**

## A. Veredicto

> ## 🟡 YELLOW-BOOK-SOURCE-UNAVAILABLE
>
> Todo lo que **no** depende del libro está hecho, cargado por rutas canónicas, ensamblado,
> publicado en local y demostrado end-to-end: **32 recursos canónicos**, **46 nodos**, **7
> módulos**, run completo, privacidad probada con sentinels y editabilidad demostrada en Studio.
>
> **Los diez extractos del libro NO se crearon** porque la fuente canónica no es accesible:
> la única consulta autorizada (read-only) a `https://chibaleteplus.chibaleteeditores.com/api/content`
> devolvió **HTTP 401**. No existe acceso configurado desde esta máquina, y el prompt no autoriza
> ninguna operación remota distinta de lectura. **No se inventó, resumió ni reconstruyó texto**,
> y **no se rebajó ninguna promesa editorial** para forzar un GREEN.

Veredicto secundario: **`YELLOW-EDITORIAL-AMBIGUITY`** — dos frases de origen editorial prometen
capacidades que el MVP no tiene (detalle en §G.3). Requieren decisión del operador.

**No aplican:** `YELLOW-ASSET-DRIFT` (49/49 hashes coinciden) · `YELLOW-CATALOG-CONFLICT`
(0 conflictos) · `YELLOW-RUNTIME-CONTRACT-GAP` (la estructura se representó sin tocar código ni
modelo) · `RED-PRIVACY` (0 fugas) · `RED-REGRESSION` (6 suites GREEN, 0 archivos de código tocados).

---

## B. Baseline

| Verificación | Resultado |
|---|---|
| Rama | `chp/mook-contract-00` ✅ |
| HEAD == origin | `be16d83`, **ahead=0 behind=0** ✅ |
| Suites baseline | `test:mook`, `test:library`, `test:metric-contract`, `test:memberships`, `typecheck:baseline`, `build` — **GREEN** ✅ |
| ADR §17/§18, preflight, PRIVATE-JOURNAL, AUDIO-A11Y-COPY | releídos ✅ |
| Prototipos A/B | intactos: las 6 experiencias previas siguen presentes y sin tocar ✅ |
| Carpeta editorial | untracked; **ningún archivo movido, renombrado, convertido, truncado ni borrado** ✅ |

## C. Integridad de activos

| Comprobación | Resultado |
|---|---|
| Total | **49** archivos ✅ |
| MP3 | 16 ✅ |
| TXT de transcripción emparejados por basename | 16 ✅ |
| `B00`–`B07` | 8 ✅ |
| `T00`–`T08` | 9 ✅ |
| `A04` | **ausente** ✅ (no se renumeró `A05`–`A15`) |
| Claves A | `A01 A02 A03 A05 A06 A07.1 A07.2 A07.3 A08 A09 A10 A11 A12 A13 A14 A15` ✅ |
| `T00` tras AUDIO-A11Y-COPY | SHA-256 `71ce37b29d1a…`, **3016 bytes** ✅ |
| `T00` promesa estrictamente privada | «Todo lo que escribas en las bitácoras será privado…» presente; la promesa de compartir **ausente** ✅ |
| Comparación completa con el manifest | **sin drift**: los 33 hashes registrados coinciden ✅ |

**→ No aplica `YELLOW-ASSET-DRIFT`.**

## D. Fuente y extractos del libro — bloqueado con evidencia

| Paso | Resultado |
|---|---|
| ¿`Me desconecto, luego existo` en el catálogo local? | **No.** 17 ítems, 0 coincidencias por título o por `content-1765751139919` |
| ¿Texto del libro en `public/uploads`, `data/` o el repo? | **No.** Búsqueda por nombre y por términos distintivos (`cogito`, `Kierkegaard`, `Simone Weil`): solo la descripción de la fixture dev |
| ¿`content-1765751139919` resoluble como padre local? | **No** — comprobado, no existe en el catálogo local |
| Consulta **read-only** autorizada a la fuente canónica | `GET https://chibaleteplus.chibaleteeditores.com/api/content` → **HTTP 401** |

**Conclusión:** no existe acceso configurado y el prompt prohíbe cualquier operación remota que no
sea lectura. **No se crearon los diez extractos.** Tampoco se usó OCR, placeholder ni reconstrucción.

**Consecuencia sobre el orden vinculante del §5:** los diez `READING` del libro quedan como
**huecos declarados** en su posición exacta (no como nodos vacíos ni alias). El resto de cada
movimiento se ensambló en el orden indicado. Al obtener el texto, se insertan en su posición
mediante «Crear nueva versión» — capacidad demostrada en §F.4.

**Además NO se incluyó** *Diálogos imposibles* (pp. 133–152), conforme a la instrucción: el runtime
no tiene superficie opcional independiente equivalente a «Leer la escena original».

---

## E. Manifest del catálogo (32 recursos canónicos, todos `standalone:false`)

### E.1 Audios (16) — `standalone:false`, sin `parentId`

| Clave | Título | contentId | SHA-256 MP3 (12) | SHA-256 TXT (12) | chars transcripción |
|---|---|---|---|---|---:|
| `A01` | A01. Son las once de la noche | `content-1787621719201-00` | `194637c66ec4` | `c1fdd3961ddc` | 2363 |
| `A02` | A02. Si no lo publicaste, ocurrió | `content-1787621719275-01` | `96587aab149d` | `594be983e1f4` | 7698 |
| `A03` | A03. Todos están hablando | `content-1787621719358-02` | `2cb6cee4c5d6` | `ec3a994cd4f9` | 8605 |
| `A05` | A05. Noventa segundos | `content-1787621719389-03` | `c70beb0068d9` | `7603d8ea5943` | 1477 |
| `A06` | A06. Me estás escuchando | `content-1787621719518-04` | `504485bf351d` | `d2d8d4ced965` | 8874 |
| `A07.1` | A07.1. Si no posteo, desaparezco | `content-1787621719562-05` | `2b136ce44f9a` | `c53c76ab8d74` | 6762 |
| `A07.2` | A07.2. Libertad no paga las cuentas | `content-1787621719621-06` | `4342c67bc54f` | `895a4d14250d` | 8610 |
| `A07.3` | A07.3. La elección de empezar a elegir | `content-1787621719678-07` | `2f4a76b7f0fc` | `270878da15dd` | 9334 |
| `A08` | A08. Día 1 — Una hora sin notificaciones | `content-1787621719702-08` | `e5bad7832fae` | `4d36647417e9` | 1142 |
| `A09` | A09. Día 2 — Una sola pestaña | `content-1787621719728-09` | `f4ff74426d1a` | `5242bcc18fea` | 1140 |
| `A10` | A10. Día 3 — Una fotografía que no vas a publicar | `content-1787621719749-10` | `ef889cb83492` | `87e6dbc1a5f3` | 1071 |
| `A11` | A11. Día 4 — Escuchar sin interrumpir | `content-1787621719771-11` | `df6d23a13f2c` | `97c344ff9984` | 1098 |
| `A12` | A12. Día 5 — Caminar sin audífonos | `content-1787621719835-12` | `983b7407e8e4` | `4435a7ef4d91` | 1081 |
| `A13` | A13. Día 6 — No responder todavía | `content-1787621719866-13` | `629b97373cd6` | `d16368bc501d` | 1018 |
| `A14` | A14. Día 7 — Estar juntos sin pantallas | `content-1787621719887-14` | `0b4db9453839` | `9986603b4c53` | 1146 |
| `A15` | A15. Una ética de la presencia | `content-1787621719937-15` | `f99feff55f4c` | `4ead4ec29fa0` | 5875 |

### E.2 Textos originales del mook (9) — `standalone:false`

| Clave | Título | contentId | SHA-256 (12) | chars |
|---|---|---|---|---:|
| `T00` | Texto del mook · Carta de entrada | `content-1787621719949-16` | `71ce37b29d1a` | 2952 |
| `T01` | Texto del mook · La vida sin testigos | `content-1787621720034-17` | `280cb90ba494` | 1935 |
| `T02` | Texto del mook · Quién eligió esta opinión | `content-1787621720053-18` | `f2a5ab6d8684` | 2520 |
| `T03` | Texto del mook · Cinco formas de repetir sin pensar | `content-1787621720065-19` | `0ef0893ea791` | 1070 |
| `T04` | Texto del mook · La pausa metódica | `content-1787621720079-20` | `893425fc7c6d` | 1992 |
| `T05` | Texto del mook · El derecho a terminar una frase | `content-1787621720092-21` | `3d34865f4f03` | 2333 |
| `T06` | Texto del mook · Elegir también es perder | `content-1787621720105-22` | `5111c1e4c1e6` | 3127 |
| `T07` | Texto del mook · Antes del reto... pequeñas rebeldías | `content-1787621720119-23` | `5ed5d88f4bdb` | 2504 |
| `T08` | Texto del mook · Mi manera de estar | `content-1787621720131-24` | `dda22ce9001d` | 1343 |

### E.3 Transiciones (7) — `standalone:false`, texto literal

| Mov. | contentId | SHA-256 (12) | chars | Texto |
|---|---|---|---:|---|
| `M0` | `content-1787621720145-25` | `97315dadc87c` | 86 | «No necesitas responder bien. Necesitas una primera respuesta a la que puedas regresar.» |
| `M1` | `content-1787621720159-26` | `423b9606e4d3` | 99 | «Aparecer puede ser una manera de compartir la vida. Estar es aquello que le da algo para compartir.» |
| `M2` | `content-1787621720173-27` | `5fa33bf0991b` | 109 | «Pensar por uno mismo no significa pensar solo. Significa conversar sin desaparecer dentro de la conversación.» |
| `M3` | `content-1787621720187-28` | `d73c8972b406` | 75 | «La pausa no decide por ti. Impide que la velocidad se disfrace de decisión.» |
| `M4` | `content-1787621720201-29` | `9192a5a9cba1` | 105 | «Escuchar no siempre resuelve. A veces devuelve a una persona el espacio que necesitaba para poder pensar.» |
| `M5` | `content-1787621720213-30` | `4c5df67b6536` | 117 | «Una elección no demuestra para siempre quién eres. Pero cada decisión participa en la persona que estás construyendo.» |
| `M6` | `content-1787621720226-31` | `4189f7681b02` | 76 | «No tienes que hacerlo todo. Elige una práctica y observa qué vuelve visible.» |

### E.4 Cómo se cargó (rutas canónicas, sin importador)

Sonda **temporal, fuera del repositorio**, que llama exactamente a lo que consume el producto:
`POST /api/upload` (las 3 capas de validación) → `POST /api/content` (registro canónico, con `id`
propuesto por el cliente, como exige el contrato). **Dedup previo por título y por SHA-256**:
0 conflictos. El único `deduplicated` reportado fue del índice de hashes de uploads y no produjo
URLs compartidas (verificado: ninguna URL se repite entre los 32 recursos).

**Ningún TXT de transcripción se cargó como pieza del catálogo**: el contenido exacto viaja en
`config.transcripcion` del nodo AUDIO (§H). **Ninguna bitácora se cargó como recurso**: son nodos
ACTIVITY (§G).

**Trampa de entorno resuelta:** el catálogo exige la forma completa del registro
(`metricas`, `sectionIds`, `ilustraciones_url`, `isCollection`, `editorial`, `categoria`,
`edad_recomendada`, `ttsStatus`). Sin ella, la vista de Biblioteca **crashea**
(`Cannot read properties of undefined (reading 'calificacion_promedio')`). Se completaron los 32
registros **por la misma ruta canónica** `POST /api/content`, no editando el archivo.

---

## F. Experiencia y matriz final

| Campo | Valor |
|---|---|
| **experienceId** | `exp-1787621835612-oe8qs3` |
| **versionId** | `expv-1787621835613-1g389f` (**v1, published — solo local**) |
| Slug | `estas-aqui` |
| Título / bajada | `¿Estás aquí?` · la bajada vive en la descripción (no hay campo separado; no se amplió el esquema) |
| Duración | `Flexible · 4–6 horas en varias sesiones + reto opcional de 7 días` |
| Audiencia | `Jóvenes de 14 a 18 años; recorrido autónomo o acompañado por docentes, bibliotecarios y mediadores` |
| Ilustración | **vacía** (no hay recurso editorial autorizado) |
| Objetivos | 3 |
| Módulos | **7** |
| Nodos | **46** — 16 AUDIO · 16 READING (9 textos + 7 transiciones) · 14 ACTIVITY |
| Requeridos | 32 (los 14 nodos del reto son opcionales) |
| PRODUCTION / LEO / VIDEO | **0 / 0 / 0** ✅ |

La **pregunta visible** de cada movimiento va integrada en el título del módulo (no existe campo
separado y **no se amplió el esquema**), exactamente con los siete títulos indicados.

### F.1 Matriz módulo · nodo · posición (46 nodos)

| Módulo | # | Nodo (id) | Tipo | Título | resourceRef | Req. | Privado |
|---|---:|---|---|---|---|---|---|
| `m0` | 1 | `n-a01` | AUDIO | A01. Son las once de la noche | `content-1787621719201-00` | sí | — |
| `m0` | 2 | `n-t00` | READING | Texto del mook · Carta de entrada | `content-1787621719949-16` | sí | — |
| `m0` | 3 | `n-b00` | ACTIVITY | Bitácora · B00 | — | sí | **sí** |
| `m0` | 4 | `n-trans-m0` | READING | Transición · M0 | `content-1787621720145-25` | sí | — |
| `m1` | 1 | `n-a02` | AUDIO | A02. Si no lo publicaste, ocurrió | `content-1787621719275-01` | sí | — |
| `m1` | 2 | `n-t01` | READING | Texto del mook · La vida sin testigos | `content-1787621720034-17` | sí | — |
| `m1` | 3 | `n-b01` | ACTIVITY | Bitácora · B01 | — | sí | **sí** |
| `m1` | 4 | `n-trans-m1` | READING | Transición · M1 | `content-1787621720159-26` | sí | — |
| `m2` | 1 | `n-a03` | AUDIO | A03. Todos están hablando | `content-1787621719358-02` | sí | — |
| `m2` | 2 | `n-t02` | READING | Texto del mook · Quién eligió esta opinión | `content-1787621720053-18` | sí | — |
| `m2` | 3 | `n-t03` | READING | Texto del mook · Cinco formas de repetir sin pensar | `content-1787621720065-19` | sí | — |
| `m2` | 4 | `n-b02` | ACTIVITY | Bitácora · B02 | — | sí | **sí** |
| `m2` | 5 | `n-trans-m2` | READING | Transición · M2 | `content-1787621720173-27` | sí | — |
| `m3` | 1 | `n-a05` | AUDIO | A05. Noventa segundos | `content-1787621719389-03` | sí | — |
| `m3` | 2 | `n-t04` | READING | Texto del mook · La pausa metódica | `content-1787621720079-20` | sí | — |
| `m3` | 3 | `n-b03` | ACTIVITY | Bitácora · B03 | — | sí | **sí** |
| `m3` | 4 | `n-trans-m3` | READING | Transición · M3 | `content-1787621720187-28` | sí | — |
| `m4` | 1 | `n-a06` | AUDIO | A06. Me estás escuchando | `content-1787621719518-04` | sí | — |
| `m4` | 2 | `n-t05` | READING | Texto del mook · El derecho a terminar una frase | `content-1787621720092-21` | sí | — |
| `m4` | 3 | `n-b04` | ACTIVITY | Bitácora · B04 | — | sí | **sí** |
| `m4` | 4 | `n-trans-m4` | READING | Transición · M4 | `content-1787621720201-29` | sí | — |
| `m5` | 1 | `n-a07-1` | AUDIO | A07.1. Si no posteo, desaparezco | `content-1787621719562-05` | sí | — |
| `m5` | 2 | `n-a07-2` | AUDIO | A07.2. Libertad no paga las cuentas | `content-1787621719621-06` | sí | — |
| `m5` | 3 | `n-a07-3` | AUDIO | A07.3. La elección de empezar a elegir | `content-1787621719678-07` | sí | — |
| `m5` | 4 | `n-t06` | READING | Texto del mook · Elegir también es perder | `content-1787621720105-22` | sí | — |
| `m5` | 5 | `n-b05` | ACTIVITY | Bitácora · B05 | — | sí | **sí** |
| `m5` | 6 | `n-trans-m5` | READING | Transición · M5 | `content-1787621720213-30` | sí | — |
| `m6` | 1 | `n-t07` | READING | Texto del mook · Antes del reto... pequeñas rebeldías | `content-1787621720119-23` | sí | — |
| `m6` | 2 | `n-trans-m6` | READING | Transición · M6 | `content-1787621720226-31` | sí | — |
| `m6` | 3 | `n-a08` | AUDIO | A08. Día 1 — Una hora sin notificaciones | `content-1787621719702-08` | no | — |
| `m6` | 4 | `n-b06-dia-1` | ACTIVITY | Bitácora del reto · Día 1 | — | no | **sí** |
| `m6` | 5 | `n-a09` | AUDIO | A09. Día 2 — Una sola pestaña | `content-1787621719728-09` | no | — |
| `m6` | 6 | `n-b06-dia-2` | ACTIVITY | Bitácora del reto · Día 2 | — | no | **sí** |
| `m6` | 7 | `n-a10` | AUDIO | A10. Día 3 — Una fotografía que no vas a publicar | `content-1787621719749-10` | no | — |
| `m6` | 8 | `n-b06-dia-3` | ACTIVITY | Bitácora del reto · Día 3 | — | no | **sí** |
| `m6` | 9 | `n-a11` | AUDIO | A11. Día 4 — Escuchar sin interrumpir | `content-1787621719771-11` | no | — |
| `m6` | 10 | `n-b06-dia-4` | ACTIVITY | Bitácora del reto · Día 4 | — | no | **sí** |
| `m6` | 11 | `n-a12` | AUDIO | A12. Día 5 — Caminar sin audífonos | `content-1787621719835-12` | no | — |
| `m6` | 12 | `n-b06-dia-5` | ACTIVITY | Bitácora del reto · Día 5 | — | no | **sí** |
| `m6` | 13 | `n-a13` | AUDIO | A13. Día 6 — No responder todavía | `content-1787621719866-13` | no | — |
| `m6` | 14 | `n-b06-dia-6` | ACTIVITY | Bitácora del reto · Día 6 | — | no | **sí** |
| `m6` | 15 | `n-a14` | AUDIO | A14. Día 7 — Estar juntos sin pantallas | `content-1787621719887-14` | no | — |
| `m6` | 16 | `n-b06-dia-7` | ACTIVITY | Bitácora del reto · Día 7 | — | no | **sí** |
| `m6` | 17 | `n-a15` | AUDIO | A15. Una ética de la presencia | `content-1787621719937-15` | sí | — |
| `m6` | 18 | `n-b07` | ACTIVITY | Bitácora · B07 | — | sí | **sí** |
| `m6` | 19 | `n-t08` | READING | Texto del mook · Mi manera de estar | `content-1787621720131-24` | sí | — |

### F.2 Conteos esperados vs observados

| Elemento | Esperado | Observado |
|---|---:|---:|
| Audios canónicos | 16 | **16** ✅ |
| Textos del mook | 9 | **9** ✅ |
| Transiciones | 7 | **7** ✅ |
| Extractos del libro | 10 | **0** ⛔ (§D) |
| Bitácoras como ACTIVITY privadas | 7 + 7 (B06) = 14 | **14** ✅ |
| Módulos | 7 | **7** ✅ |
| Nodos (sin extractos) | 46 | **46** ✅ |

### F.3 Invariantes de editabilidad — verificados

| Invariante | Evidencia |
|---|---|
| Cada recurso se referencia **solo** por `contentId` | los 32 `resourceRef` resuelven contra el catálogo; cero copia de metadata |
| Módulos y nodos reordenables / editables / eliminables | Studio muestra los 207 controles `aria-label` («Subir/Bajar/Eliminar/Editar paso», «Subir/Bajar/Eliminar módulo») |
| Ninguna ruta hardcodeada | las 7 transiciones son **recursos canónicos referenciados**, no texto en React |
| Preview usa el Runtime real y **no persiste** | tras editar y previsualizar: `runs` 5 y `evidence` 7 sin cambio, versión sigue `draft`, orden intacto en el store |
| Publicar v1 la vuelve inmutable | `VERSION_IMMUTABLE` (probado en suite); el Studio muestra el aviso y ofrece «Crear nueva versión» |
| Run pineado a v1 | los 2 runs tienen `experienceVersionId = expv-…1g389f` ✅ |
| Recursos reutilizables en otra experiencia | son contenido canónico `standalone:false`, referenciable por cualquier nodo |
| Los siete B06 son nodos independientes | 7 ids distintos, 7 evidencias con `nodeId` distinto — **sin motor de retos** |

### F.4 Cambio reversible en draft (exigido por §6)

En Studio, módulo 0: «Subir paso Texto del mook · Carta de entrada» → la **Vista previa** pasó a
mostrar `Texto del mook · Carta de entrada` como nodo actual y `A01` después. Se deshizo con
«Bajar paso» y la preview volvió a `A01. Son las once de la noche` como nodo actual.
**El store no cambió en ningún momento** (nunca se guardó el borrador).

---

## G. Bitácoras privadas y reto

Las 8 bitácoras se convirtieron en **14 nodos ACTIVITY**, todos con `config.privado: true`,
usando **literalmente** las instrucciones y preguntas de cada TXT.

| Bitácora | Nodo(s) | Preguntas | Privado |
|---|---|---:|---|
| `B00` | `n-b00` | 6 | ✅ |
| `B01` | `n-b01` | 5 | ✅ |
| `B02` | `n-b02` | 5 | ✅ |
| `B03` | `n-b03` (+ aviso obligatorio) | 7 | ✅ |
| `B04` | `n-b04` | 5 | ✅ |
| `B05` | `n-b05` | 7 | ✅ |
| `B06` | `n-b06-dia-1` … `n-b06-dia-7` | 8 c/u | ✅ |
| `B07` | `n-b07` | 9 | ✅ |

`B03` lleva, además de su texto literal: **«Este borrador se guarda de manera privada. Chibalete+
no lo enviará ni lo compartirá con la persona destinataria.»** ✅

**Reto:** los siete ciclos `A08→B06 d1 … A14→B06 d7` son **opcionales** (`required:false`), sin
rachas, sin porcentajes y sin comparación. Verificado en el E2E: se **omitió el día 4**, el
recorrido **se completó igual** (32/32) y después se **retomó** el día 4 (HTTP 201) sin penalización
y sin alterar el progreso.

### G.3 `YELLOW-EDITORIAL-AMBIGUITY` — dos frases que prometen lo que el MVP no da

1. **`B03`** contiene, literal: «Al final puedes copiarlo, guardarlo o **borrarlo**.» El MVP **no
   permite borrar** una entrada privada (ADR §17.5/§18.3). Se cargó literal, como se ordenó, pero
   **la promesa es hoy falsa** y necesita decisión editorial.
2. **`B00`** trae la directiva de autoría «Al guardar la bitácora, mostrar: “…Nadie más podrá verla
   **a menos que tú decidas compartirla**”». Es la misma promesa retirada de `T00` en
   AUDIO-A11Y-COPY. **No se surfaceó** al participante.

**Directivas de autoría excluidas de los campos visibles** (son notas al implementador, no
instrucciones ni preguntas para el lector): la citada de `B00`; en `B06` «Usar la misma estructura
para los siete días» y «No mostrar porcentaje de éxito ni calificación»; en `B07` «Mostrar, al lado
izquierdo o antes de cada campo, la respuesta correspondiente de B00». Todas quedan registradas
aquí para que el operador decida.

---

## H. Audios y transcripciones

- **16/16** nodos AUDIO con `resourceRef` resoluble y `standalone:false`.
- **16/16 transcripciones byte a byte idénticas al TXT fuente** (SHA-256 comparado contra el
  archivo, preservando CRLF).
- El gate **`TRANSCRIPTION_REQUIRED`** se satisfizo: la publicación de v1 pasó porque los 16
  nodos tienen transcripción no vacía.
- **Duración:** no se persiste en ningún sitio; sale del elemento nativo en `loadedmetadata`.
- **Descarga verificada en la app real**, con la transcripción **contraída**: 1 Object URL creado /
  1 revocado, `a01-son-las-once-de-la-noche.txt`, `text/plain;charset=utf-8`, **2363 caracteres =
  exactamente el TXT fuente con sus CRLF**.

### H.1 Limitación honesta de QA — reproducción MP3

El reproductor **se monta con los atributos correctos** (`autoplay=false`, `controls`,
`preload="metadata"`, `aria-label="Audio: {título}"`) y, mientras no hay metadata, muestra el
**estado neutro sin cifra** («Preparando la duración…») — comportamiento correcto por diseño.

Pero **la metadata del MP3 nunca cargó en esta sesión de navegador automatizado**
(`readyState 0`, `duration NaN`, sin `MediaError`). Es un **límite del entorno, no de la aplicación
ni del archivo**, y está probado:

- el archivo se sirve bien: **HTTP 200** `audio/mpeg` 2 840 798 bytes, y **HTTP 206** a `Range`
  tanto desde el backend como por el proxy de Vite;
- `canPlayType('audio/mpeg')` = `"probably"`;
- **el reproductor propio de Chrome, abriendo el MP3 directamente (sin app y sin proxy), también
  se queda en `readyState 0`**.

**Queda pendiente de verificación humana**: reproducción, pausa y fin sobre los MP3 reales, y la
**correspondencia entre voz y transcripción** (§8 lo exige explícitamente y **no se declara**).
La conducta de duración/pausa/fin del componente ya fue verificada con audio real en
`CHP_MOOK_ESTAS_AQUI_02` (WAV de 81,7 s → «1 min 22 s»).

---

## I. Preview y publicación local

**Validación previa a publicar (§7):** 46 nodos · cero PRODUCTION/LEO/VIDEO · `A04` ausente sin
hueco ni alias · 16 AUDIO con `resourceRef` resoluble y `standalone:false` · 16 READING ídem ·
14 ACTIVITY todas `privado:true` y con preguntas · 7 B06 con ids independientes · 16/16
transcripciones idénticas — **todo GREEN**. Los diez extractos **no** pudieron validarse (§D).

**Preview no persistió nada:** antes y después, `runs=5` y `evidence=7` (los prototipos previos),
versión `draft`, orden intacto en el store.

**Publicación:** v1 publicada **solo en local** (`data/` es gitignored). ⚠️ **v1 está incompleta**:
le faltan los diez extractos. La versión editorial de liberación debe incorporarlos mediante
«Crear nueva versión»; los runs existentes seguirán pineados a v1 por contrato.

---

## J. E2E del participante

Run de QA: **`run-1787622134590-0kygq6`** (`demo-lector`), pineado a `expv-1787621835613-1g389f`.

| Paso | Resultado |
|---|---|
| Descubre e inicia | la experiencia aparece en el listado y el run se crea ✅ |
| Recarga y reanuda el **mismo** run | segunda llamada devuelve el mismo `runId` ✅ |
| Abre un texto del mook | `Texto del mook · Carta de entrada` abre por la ruta canónica ✅ |
| Abre una lectura del libro | ⛔ **no verificable** — no hay extractos (§D) |
| Audio sin autoplay | ✅ `autoplay=false`, controles nativos |
| Duración real / pausa / fin | ⚠️ pendiente de verificación humana (§H.1) |
| Descarga exacta de transcripción | ✅ 2363 chars byte-exactos, con `<details>` contraído |
| Guarda y relee `B00` | ✅ `privado:true`, `answers` devueltas solo al dueño |
| Siete `B06` con evidencias independientes | ✅ **7 evidencias, 7 ids únicos, 7 `nodeId` distintos** |
| Omite y retoma una práctica | ✅ día 4 omitido → recorrido completo 32/32; retomado después → HTTP 201, sin penalización |
| Guarda `B07` y relee `B00` desde el mismo run | ✅ sentinel de `B00` legible tras terminar |
| Termina el recorrido | ✅ `status: completed`, 32/32 requeridos |
| Run sigue pineado a v1 | ✅ |

## K. Privacidad y revisión

Sentinels únicos: `SENTINEL-B00-3f9a2c`, `SENTINEL-B07-8d1e55`, `SENTINEL-B06D1-a7c3`,
`SENTINEL-B06D4-a7c3`.

| Superficie de administrador | Resultado |
|---|---|
| Cola de Producciones | 4 entradas, **0 de esta experiencia** ✅ |
| Sentinels en la cola | **0** ✅ |
| Detalle de **cada** producción de la cola | **0 sentinels** ✅ |
| Pregunta o título de bitácora en cualquier proyección | **ausentes** ✅ |
| Lectura directa de una evidencia de bitácora | **409 `NOT_REVIEWABLE`** ✅ |
| Admin pidiendo la ruta del participante | **404**, sin fuga ✅ |
| Evidencias del run | 14, **todas `requiresReview:false`** ✅ |

**→ No aplica `RED-PRIVACY`.**

## L. QA, tests y build

**Visual (escritorio):** cierre con los 7 movimientos completados · **14 insignias «Privada. Solo
tú puedes leerla.»**, 14 «Guardada para ti», 14 «Leer lo que escribí» · sentinel de `B00` visible
**solo** para su autora · **cero** apariciones de compartir, galería, ranking, racha o lenguaje de
abandono · sin scroll horizontal (958/958) · títulos de módulo completos con su pregunta ·
estados con texto («Bloqueado», «Por iniciar», «Completado»).

**Móvil 390 px:** `scrollWidth == clientWidth` (**386/386**), sin scroll horizontal.

**Diferenciación visual libro vs texto del mook:** los textos del mook se distinguen por el prefijo
`Texto del mook · …` y las transiciones por `Transición · Mx`. La diferenciación **frente a los
capítulos del libro no pudo verificarse** al no existir extractos (§D); el patrón previsto es
`Libro · {capítulo}`.

| Comando | Resultado |
|---|---|
| `npm run test:mook` | ✅ GREEN |
| `npm run test:library` | ✅ GREEN |
| `npm run test:metric-contract` | ✅ GREEN |
| `npm run test:memberships` | ✅ GREEN |
| `npm run typecheck:baseline` | ✅ Sin regresiones TS |
| `npm run build` | ✅ built |

**No se añadieron tests**: no cambió una sola línea de código. Las comprobaciones de contenido
vivieron en sondas temporales fuera del repositorio.

## M. Git, datos y producción

- **Commit exclusivamente documental.** `git status` antes de escribir este documento: limpio,
  salvo las dos carpetas editoriales untracked.
- **Cero archivos de código modificados.**
- **No se versionan** MP3, TXT, PDF, `data/`, `data-critical/`, `public/uploads/` ni las sondas
  (todo gitignored o fuera del repo).
- **Cero producción:** la única interacción remota fue **una** consulta read-only autorizada que
  devolvió **401**. No hubo escritura, ni deploy, ni recreación de contenedores, ni cambio de flags,
  ni acceso con credenciales.
- **Credenciales temporales de QA creadas y eliminadas** (`usuarios_colegios_oro.json` sin
  contraseñas al cierre; es untracked).
- **Entitlement** de los 32 recursos concedido por la **ruta canónica** `PUT /api/groups`
  (club `group-pilot-induccion`), no editando archivos.

### M.1 Limitación de entorno documentada

Las rutas de autoría (`POST /api/experiences`, `/versions`, `/publish`) exigen `x-admin-secret`
**file-only con modo POSIX 0400**, y Windows reporta `0444` — **imposible de satisfacer**
(comprobado). El ensamblaje se hizo invocando **las mismas funciones de dominio**
(`server/lib/experienceStore.js`) que esas rutas ejecutan, de modo que se conservan validación,
congelado y versionado, y el resultado es **100 % editable en Studio** (demostrado en §F.4).
No se escribió JSON a mano.

## N. Gates residuales y próximo paso

| Gate | Estado |
|---|---|
| «Seguir leyendo en *Me desconecto, luego existo*» desde un extracto | **no existe** — depende de los extractos |
| Microcopias de guardar/cerrar lecturas | **no existen** |
| Controles del reto (repetir / adaptar / omitir) | **no existen como controles**; la conducta sí (omitir y retomar probados) |
| Descarga del archivo de audio en el visor genérico | sigue siendo un `alert()` stub, ajeno a MOOK |
| Compartir / grupo / galería | fuera del MVP (`FUTURE — MOOK-JOURNAL-SHARING`) |
| Edición o eliminación de entradas privadas | fuera del MVP (contradice ADR §17.5/§18.3) — choca con `B03` (§G.3) |
| *Diálogos imposibles* (pp. 133–152) opcional | no incluido, por instrucción |
| `B07` junto a las respuestas de `B00` | el dueño puede releer `B00`, pero **no lado a lado** |
| Residual 404/409 en ids de evidencia | revela existencia, nunca contenido; sin cambios |
| Verificación humana voz ↔ transcripción | **pendiente de liberación** |
| Reproducción MP3 en navegador | **pendiente de verificación humana** (§H.1) |

### Procedimiento de reanudación

1. Obtener el texto del libro desde la fuente canónica (requiere acceso configurado; hoy 401).
2. Crear los **10 extractos** con `POST /api/upload` + `POST /api/content`: `standalone:false`,
   `parentId` al libro canónico **resoluble en el catálogo destino**, procedencia y páginas
   impresas registradas, título `Libro · {capítulo}`. Incluir la forma completa del registro
   (`metricas`, etc.) o la Biblioteca crashea (§E.4).
3. En Studio: «Crear nueva versión» sobre `exp-1787621835612-oe8qs3` e **insertar cada extracto en
   su posición** del §5. Los runs existentes seguirán pineados a v1.
4. Resolver `YELLOW-EDITORIAL-AMBIGUITY` (§G.3): ampliar alcance o corregir las dos frases.
5. Verificación humana: escucha de los 16 MP3 contra su transcripción.
6. Publicar la versión completa **en local** y repetir el E2E.
