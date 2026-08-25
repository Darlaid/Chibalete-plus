# CHP-MOOK-ESTAS-AQUI-03 — Carga canónica y ensamblaje local

**Fecha:** 2026-08-25 · **Rama:** `chp/mook-contract-00` · **Baseline:** `be16d83`
**Unidad de contenido y autoría.** Cero código nuevo, cero modelos, cero tipos de nodo,
cero importadores permanentes. **Cero producción. Sin deploy.**

## A. Veredicto

> ## 🟡 YELLOW-BOOK-SOURCE-UNAVAILABLE  ·  *(CERRADO el 2026-08-25 — ver ANEXO DE CIERRE 03B al final)*
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

---

# ANEXO DE CIERRE — CHP-MOOK-ESTAS-AQUI-03B

**Fecha:** 2026-08-25 · **Baseline:** `5beee8d` · Unidad de contenido y autoría, **sin código nuevo**.

## A. Veredicto: 🟢 `GREEN-BOOK-EXCERPTS-V2-LOCAL`

**El `YELLOW-BOOK-SOURCE-UNAVAILABLE` de la unidad 03 queda CERRADO.** Con el nuevo archivo
maestro se crearon el padre canónico local y los **diez extractos**, se insertaron en sus
posiciones, se corrigieron las dos promesas editoriales incompatibles y se demostró la versión
completa end-to-end en local.

> El YELLOW histórico **se conserva** en el cuerpo de este documento como registro de por qué la
> unidad 03 no pudo cerrarlo (producción devolvía 401). Este anexo documenta su cierre.

**No aplican:** `YELLOW-BOOK-SOURCE-INVALID` (fuente íntegra) · `YELLOW-EXCERPT-BOUNDARY` (los diez
límites son inequívocos: cada capítulo tiene su encabezado en línea propia) · `YELLOW-EDITORIAL-COPY`
(una sola interpretación posible en ambas correcciones) · `YELLOW-PARENT-CONTRACT` (`parentId`
resoluble) · `YELLOW-RUNTIME-CONTRACT-GAP` (cero cambios de React, backend, store o contrato) ·
`RED-PRIVACY` · `RED-REGRESSION`.

Pendiente separado, **no bloqueante**: **`YELLOW-HUMAN-AUDIO-QA`** (§K.2).

**Desviación declarada:** la versión completa es **v3**, no v2. Publiqué v2 antes de comprobar que
la corrección de `B00` llegara al participante; como una versión publicada es inmutable por
contrato, la corrección se completó en **v3** en lugar de mutar v2. Detalle y justificación en §D.2.

## B. Baseline e inmutabilidad de v1

| Verificación | Resultado |
|---|---|
| Rama / HEAD | `chp/mook-contract-00`, `5beee8d`, **ahead=0 behind=0** ✅ |
| Árbol | limpio salvo la carpeta editorial untracked ✅ |
| Suites baseline | GREEN ✅ |
| **v1 `expv-1787621835613-1g389f`** | **46 nodos, `published`** — sin tocar ✅ |
| **Run v1 `run-1787622134590-0kygq6`** | pineado a v1, `completed`, **14 evidencias** — sin tocar ✅ |
| v1 revertida / archivada / editada / borrada | **NO** ✅ |
| 32 recursos previos | intactos; sus `contentId` no cambiaron ✅ |

La inmutabilidad se comprobó **después** de crear v2 y v3: v1 conserva sus 46 nodos, su estado y
las 14 evidencias de su run.

## C. Fuente completa

`Me desconecto, luego existo.txt` — **`SOURCE-ONLY`**: no es asset faltante ni drift del manifest
49/49 (la carpeta pasa de 49 a 50 archivos; los 49 activos editoriales siguen verificados).

| Campo | Valor |
|---|---|
| **SHA-256** | `6a9734e4193056358bef8324b63162885c8385af1fec37b3ba374083535c5ce7` |
| Bytes | 148 647 |
| Codificación | **UTF-8 sin BOM** |
| Saltos de línea | **CRLF** (491) · 0 LF sueltos |
| Palabras | 24 272 · 145 713 caracteres · 492 líneas |

**Divisiones internas detectadas** (encabezado en línea propia, sin ambigüedad): Prólogo ·
*Aparecer o estar: el nuevo cogito* · *La multitud y la angustia* · *Mil pestañas abiertas* ·
*El silencio cartesiano* · *Simone Weil: atención como justicia* · *Presencias ausentes* ·
*Elegir un yo: Kierkegaard en la era del FOMO* · *Prácticas de atención* · *Me desconecto, luego
existo (otra vez)* · Epílogo · Glosario · *Diálogos imposibles*.

**Artefactos mecánicos de extracción: cero** — 0 números de página sueltos, 0 guiones de corte,
0 encabezados/pies repetidos, 0 espacios múltiples, 0 caracteres de control. Los 4 separadores
`* * *` son cortes editoriales legítimos y se conservan.

**El TXT no conserva cortes de página**, así que las páginas impresas son **exclusivamente
metadata del operador**; no se infirió ningún corte. El archivo **no se modificó, no se convirtió,
no se versionó** y **no se consultó producción**.

## D. Correcciones editoriales B00 / B03

Ambas promesas eran **inequívocas** (una sola ocurrencia). Cada reemplazo se validó revirtiéndolo
en memoria y comparándolo con el original: el resto del texto quedó byte a byte idéntico.

| Archivo | SHA-256 antes | SHA-256 después | Bytes | BOM | CRLF |
|---|---|---|---|---|---|
| `B00. Bitácora de entrada…` | `015593776c79…` | `054ad2acd9fa…` | 718 → 772 | no → no | 12 → 12 |
| `B03. Bitácora — Antes de enviar` | `0edce3e4bd6d…` | `6cee299fe3d9…` | 624 → 646 | no → no | 14 → 14 |

- **B00:** «Nadie más podrá verla a menos que tú decidas compartirla» → **«Tu respuesta será
  privada. Solo tú podrás leerla dentro de este recorrido. Nada se publicará automáticamente»**.
- **B03:** «Al final puedes copiarlo, guardarlo o borrarlo.» → **«Puedes copiar este borrador o
  conservarlo aquí para volver después.»**

Verificado: las palabras `compartir` y `borrar` **ya no aparecen** en sus archivos. Sin backups
dentro de la carpeta (copias en el scratchpad de sesión) y **fuera de Git**.

### D.2 Por qué la versión completa es v3

La corrección de `B00` vive en una **línea de directiva de autoría** («Al guardar la bitácora,
mostrar: «…»»), que el criterio establecido en la unidad 03 **excluye** de los campos visibles.
Al regenerar `B00` desde el TXT corregido, el nodo quedó **idéntico a v1**: la corrección no
llegaba al participante y §H («B00 muestra exclusivamente la promesa privada corregida») no se
cumplía.

Lo detecté **después** de publicar v2. Como una versión publicada es inmutable por contrato
(y respetarlo es justamente lo que esta unidad debe demostrar), **no mutéla v2**: creé **v3**,
idéntica a v2 salvo que `B00` incorpora a su instrucción el **payload citado** de la directiva.

- **v2 `expv-1787627232665-q0shao`** — 56 nodos, publicada; `B03` corregida, `B00` sin la
  microcopia visible. Sin runs. Queda como intermedia inmutable.
- **v3 `expv-1787627328985-qgaiki`** — 56 nodos, publicada, **`currentVersionId`**. Difiere de v2
  **solo en `n-b00`** (verificado por comparación nodo a nodo).

## E. Padre canónico local

| Campo | Valor |
|---|---|
| Título | `Me desconecto, luego existo` |
| **contentId local** | `content-1787627190805-00` |
| contentId **productivo conocido** | `content-1765751139919` (no reutilizado: el sistema no admite fijar ese id de forma natural en local) |
| Tipo canónico | `libro` (ya existente; **sin enums nuevos**) |
| `standalone` | `false` |
| SHA-256 del TXT fuente | `6a9734e4193056…535c5ce7` |
| Autoría / edición | tomadas del propio archivo (`Latitud Cero`); **nada inventado**, sin paginación fabricada |
| Referenciado como paso del mook | **NO** — solo actúa como padre de los extractos |

**→ No aplica `YELLOW-PARENT-CONTRACT`:** los diez extractos resuelven su `parentId` contra este
registro, presente en el catálogo local.

### G.1 Matriz final de v3 (56 nodos)

| Módulo | # | Nodo | Tipo | Título | Privado |
|---|---:|---|---|---|---|
| `m0` | 1 | `n-a01` | AUDIO | A01. Son las once de la noche | — |
| `m0` | 2 | `n-t00` | READING | Texto del mook · Carta de entrada | — |
| `m0` | 3 | `n-libro-ex01` | READING | Libro · Prólogo. Me desconecto, luego existo | — |
| `m0` | 4 | `n-b00` | ACTIVITY | Bitácora · B00 | **sí** |
| `m0` | 5 | `n-trans-m0` | READING | Transición · M0 | — |
| `m1` | 1 | `n-a02` | AUDIO | A02. Si no lo publicaste, ocurrió | — |
| `m1` | 2 | `n-libro-ex02` | READING | Libro · Aparecer o estar: el nuevo cogito | — |
| `m1` | 3 | `n-t01` | READING | Texto del mook · La vida sin testigos | — |
| `m1` | 4 | `n-b01` | ACTIVITY | Bitácora · B01 | **sí** |
| `m1` | 5 | `n-trans-m1` | READING | Transición · M1 | — |
| `m2` | 1 | `n-a03` | AUDIO | A03. Todos están hablando | — |
| `m2` | 2 | `n-libro-ex03` | READING | Libro · La multitud y la angustia | — |
| `m2` | 3 | `n-t02` | READING | Texto del mook · Quién eligió esta opinión | — |
| `m2` | 4 | `n-t03` | READING | Texto del mook · Cinco formas de repetir sin pensar | — |
| `m2` | 5 | `n-libro-ex04` | READING | Libro · Mil pestañas abiertas: lo dividido no elige | — |
| `m2` | 6 | `n-b02` | ACTIVITY | Bitácora · B02 | **sí** |
| `m2` | 7 | `n-trans-m2` | READING | Transición · M2 | — |
| `m3` | 1 | `n-libro-ex05` | READING | Libro · El silencio cartesiano: detenerse para empezar | — |
| `m3` | 2 | `n-a05` | AUDIO | A05. Noventa segundos | — |
| `m3` | 3 | `n-t04` | READING | Texto del mook · La pausa metódica | — |
| `m3` | 4 | `n-b03` | ACTIVITY | Bitácora · B03 | **sí** |
| `m3` | 5 | `n-trans-m3` | READING | Transición · M3 | — |
| `m4` | 1 | `n-libro-ex06` | READING | Libro · Simone Weil: atención como justicia | — |
| `m4` | 2 | `n-libro-ex07` | READING | Libro · Presencias ausentes: estar sin estar | — |
| `m4` | 3 | `n-a06` | AUDIO | A06. Me estás escuchando | — |
| `m4` | 4 | `n-t05` | READING | Texto del mook · El derecho a terminar una frase | — |
| `m4` | 5 | `n-b04` | ACTIVITY | Bitácora · B04 | **sí** |
| `m4` | 6 | `n-trans-m4` | READING | Transición · M4 | — |
| `m5` | 1 | `n-libro-ex08` | READING | Libro · Elegir un yo: Kierkegaard en la era del FOMO | — |
| `m5` | 2 | `n-a07-1` | AUDIO | A07.1. Si no posteo, desaparezco | — |
| `m5` | 3 | `n-a07-2` | AUDIO | A07.2. Libertad no paga las cuentas | — |
| `m5` | 4 | `n-a07-3` | AUDIO | A07.3. La elección de empezar a elegir | — |
| `m5` | 5 | `n-t06` | READING | Texto del mook · Elegir también es perder | — |
| `m5` | 6 | `n-b05` | ACTIVITY | Bitácora · B05 | **sí** |
| `m5` | 7 | `n-trans-m5` | READING | Transición · M5 | — |
| `m6` | 1 | `n-libro-ex09` | READING | Libro · Prácticas de atención: pequeñas rebeldías | — |
| `m6` | 2 | `n-t07` | READING | Texto del mook · Antes del reto... pequeñas rebeldías | — |
| `m6` | 3 | `n-trans-m6` | READING | Transición · M6 | — |
| `m6` | 4 | `n-a08` | AUDIO | A08. Día 1 — Una hora sin notificaciones | — |
| `m6` | 5 | `n-b06-dia-1` | ACTIVITY | Bitácora del reto · Día 1 | **sí** |
| `m6` | 6 | `n-a09` | AUDIO | A09. Día 2 — Una sola pestaña | — |
| `m6` | 7 | `n-b06-dia-2` | ACTIVITY | Bitácora del reto · Día 2 | **sí** |
| `m6` | 8 | `n-a10` | AUDIO | A10. Día 3 — Una fotografía que no vas a publicar | — |
| `m6` | 9 | `n-b06-dia-3` | ACTIVITY | Bitácora del reto · Día 3 | **sí** |
| `m6` | 10 | `n-a11` | AUDIO | A11. Día 4 — Escuchar sin interrumpir | — |
| `m6` | 11 | `n-b06-dia-4` | ACTIVITY | Bitácora del reto · Día 4 | **sí** |
| `m6` | 12 | `n-a12` | AUDIO | A12. Día 5 — Caminar sin audífonos | — |
| `m6` | 13 | `n-b06-dia-5` | ACTIVITY | Bitácora del reto · Día 5 | **sí** |
| `m6` | 14 | `n-a13` | AUDIO | A13. Día 6 — No responder todavía | — |
| `m6` | 15 | `n-b06-dia-6` | ACTIVITY | Bitácora del reto · Día 6 | **sí** |
| `m6` | 16 | `n-a14` | AUDIO | A14. Día 7 — Estar juntos sin pantallas | — |
| `m6` | 17 | `n-b06-dia-7` | ACTIVITY | Bitácora del reto · Día 7 | **sí** |
| `m6` | 18 | `n-libro-ex10` | READING | Libro · Epílogo — Una ética de la presencia | — |
| `m6` | 19 | `n-a15` | AUDIO | A15. Una ética de la presencia | — |
| `m6` | 20 | `n-b07` | ACTIVITY | Bitácora · B07 | **sí** |
| `m6` | 21 | `n-t08` | READING | Texto del mook · Mi manera de estar | — |

## F. Manifest de extractos

### F.2 Manifest de los diez extractos

| # | Título | contentId | SHA-256 (12) | Palabras | Págs. | Encabezado de origen | Posición |
|---:|---|---|---|---:|---|---|---|
| 1 | Libro · Prólogo. Me desconecto, luego existo | `content-1787627190901-01` | `47e73ce82d0b` | 1387 | 7–14 | «Prólogo. Me desconecto, luego existo» | M0 · entre T00 y B00 |
| 2 | Libro · Aparecer o estar: el nuevo cogito | `content-1787627190922-02` | `13ef9e9e5bd0` | 3634 | 15–33 | «Aparecer o estar: el nuevo cogito» | M1 · entre A02 y T01 |
| 3 | Libro · La multitud y la angustia | `content-1787627190941-03` | `6c9fda952939` | 1137 | 35–40 | «La multitud y la angustia» | M2 · entre A03 y T02 |
| 4 | Libro · Mil pestañas abiertas: lo dividido no elige | `content-1787627190958-04` | `87f9579ecc9b` | 1380 | 41–47 | «Mil pestañas abiertas: lo dividido no elige» | M2 · entre T03 y B02 |
| 5 | Libro · El silencio cartesiano: detenerse para empezar | `content-1787627190975-05` | `fad2f33d8fb7` | 1685 | 49–57 | «El silencio cartesiano: detenerse para empezar» | M3 · antes de A05 |
| 6 | Libro · Simone Weil: atención como justicia | `content-1787627190991-06` | `44618b03d1c4` | 1677 | 59–67 | «Simone Weil: atención como justicia» | M4 · antes de Presencias ausentes |
| 7 | Libro · Presencias ausentes: estar sin estar | `content-1787627191006-07` | `a0cc5fa9c906` | 1515 | 69–77 | «Presencias ausentes: estar sin estar» | M4 · antes de A06 |
| 8 | Libro · Elegir un yo: Kierkegaard en la era del FOMO | `content-1787627191021-08` | `36cc16ae3e38` | 1530 | 79–87 | «Elegir un yo: Kierkegaard en la era del FOMO» | M5 · antes de A07.1 |
| 9 | Libro · Prácticas de atención: pequeñas rebeldías | `content-1787627191035-09` | `933b26a70b96` | 1146 | 89–95 | «Prácticas de atención: pequeñas rebeldías» | M6 · antes de T07 |
| 10 | Libro · Epílogo — Una ética de la presencia | `content-1787627191051-10` | `c1b1b5295527` | 1539 | 113–121 | «Epílogo – Una ética de la presencia» | M6 · antes de A15 |

Todos con `parentId` = `content-1787627190805-00` y `standalone:false`.

#### Límites textuales (primeras y últimas 12 palabras)

**1. Libro · Prólogo. Me desconecto, luego existo** · pp. 7–14 · 1387 palabras
- inicio: «Prólogo. Me desconecto, luego existo Son las once de la noche y…»
- final: «…un gesto mínimo, ese gesto puede ser el inicio de la libertad.»

**2. Libro · Aparecer o estar: el nuevo cogito** · pp. 15–33 · 3634 palabras
- inicio: «Aparecer o estar: el nuevo cogito Vivimos en un mundo donde aparecer…»
- final: «…liberarnos de la ansiedad del aparecer y devolvernos la serenidad del estar.»

**3. Libro · La multitud y la angustia** · pp. 35–40 · 1137 palabras
- inicio: «La multitud y la angustia Imagina que abres tu celular y entras…»
- final: «…topic, sino en atrevernos a decidir quiénes somos más allá de él.»

**4. Libro · Mil pestañas abiertas: lo dividido no elige** · pp. 41–47 · 1380 palabras
- inicio: «Mil pestañas abiertas: lo dividido no elige Abres el computador para hacer…»
- final: «…¿cuántas pestañas abiertas puedo cerrar para empezar a estar de verdad aquí?»

**5. Libro · El silencio cartesiano: detenerse para empezar** · pp. 49–57 · 1685 palabras
- inicio: «El silencio cartesiano: detenerse para empezar Imagina que estás en medio de…»
- final: «…silencio, aunque sea breve, podemos escuchar la voz más importante: la nuestra.»

**6. Libro · Simone Weil: atención como justicia** · pp. 59–67 · 1677 palabras
- inicio: «Simone Weil: atención como justicia Simone Weil escribió alguna vez que la…»
- final: «…revolucionario. Y quizá, como ella decía, la forma más pura de generosidad.»

**7. Libro · Presencias ausentes: estar sin estar** · pp. 69–77 · 1515 palabras
- inicio: «Presencias ausentes: estar sin estar Estás sentado en una mesa con varios…»
- final: «…un mundo de presencias ausentes, ese gesto es más necesario que nunca.»

**8. Libro · Elegir un yo: Kierkegaard en la era del FOMO** · pp. 79–87 · 1530 palabras
- inicio: «Elegir un yo: Kierkegaard en la era del FOMO Estás mirando tu…»
- final: «…acto de elegir, aunque sintamos la angustia, empezamos a existir de verdad.»

**9. Libro · Prácticas de atención: pequeñas rebeldías** · pp. 89–95 · 1146 palabras
- inicio: «Prácticas de atención: pequeñas rebeldías Imagina que estás estudiando para un examen.…»
- final: «…en un tiempo de dispersión masiva, ese gesto ya es una revolución.»

**10. Libro · Epílogo — Una ética de la presencia** · pp. 113–121 · 1539 palabras
- inicio: «Epílogo – Una ética de la presencia Hay una escena que podríamos…»
- final: «…importa. Y entonces, quizá, puedas decirlo con convicción: me desconecto, luego existo.»

## G. Estructura y conteos de v3

| Elemento | Vinculante | Observado |
|---|---:|---:|
| AUDIO | 16 | **16** ✅ |
| READING (9 T + 7 transiciones + 10 extractos) | 26 | **26** ✅ |
| ACTIVITY privadas | 14 | **14** ✅ |
| **Total** | **56** | **56** ✅ |
| VIDEO / LEO / PRODUCTION | 0 | **0 / 0 / 0** ✅ |
| `A04` | ausente | **ausente** ✅ |
| Módulos | 7 | **7** ✅ |

**Posiciones verificadas** (M0 en el runtime: `n-a01 → n-t00 → n-libro-ex01 → n-b00 → n-trans-m0`):
prólogo entre T00 y B00 · *Aparecer o estar* entre A02 y T01 · *La multitud* entre A03 y T02 ·
*Mil pestañas* entre T03 y B02 · *El silencio cartesiano* antes de A05 · *Simone Weil* y luego
*Presencias ausentes* antes de A06 · *Elegir un yo* antes de A07.1 · *Prácticas de atención* antes
de T07 · epílogo antes de A15.

**Los otros 44 nodos no se alteraron:** comparación nodo a nodo v1 → v2 arroja como únicos
cambios `n-b03` (corrección) y, en v3, `n-b00`. Metadata global de la experiencia sin cambios;
ningún `contentId` de audios, textos o transiciones se modificó.

**Fidelidad de los extractos:** los diez son **byte a byte idénticos** al bloque correspondiente
del TXT fuente, y así los sirve el runtime (SHA-256 comparado contra el archivo servido: **10/10**).

## H. Preview y publicación local

- Orden de los 56 nodos confirmado **por API y en Studio**.
- Los diez extractos **abren correctamente** por el runtime; el nodo declara procedencia y páginas
  impresas: *«Fragmento de «Me desconecto, luego existo» · Prólogo… · páginas impresas 7–14.»*
- `parentId` resoluble y `standalone:false` en los diez ✅
- **Preview no creó runs, evidencias ni eventos** ✅
- **v1 y su run siguen byte-idénticos** ✅
- **v3 publicada únicamente en local.** v1 permanece publicada como evidencia histórica: **no se
  revirtió a draft ni se archivó** ✅

## I. Runs v1 / v3

| Run | Participante | Pin | Estado |
|---|---|---|---|
| `run-1787622134590-0kygq6` | `demo-lector` | **v1** `expv-…1g389f` | completed, 14 evidencias |
| `run-1787622255366-esjjvs` | `user-tono` | **v1** | active |
| **`run-1787627393666-tuw9fh`** | **`user-rosi`** (participante distinto) | **v3** `expv-…qgaiki` | active, 56 nodos |

- El run antiguo **continúa en v1** aunque v3 sea la versión actual ✅
- El participante nuevo **inicia pineado a v3** con los diez extractos en su posición ✅
- **Recarga conserva el mismo run** (segunda llamada devuelve el mismo `runId`) ✅
- **`B00` muestra exclusivamente la promesa privada corregida** («Tu respuesta será privada…»),
  sin rastro de compartir ✅
- **`B03` no promete borrar**, y conserva su aviso de no envío ✅
- `B00` y `B03` **se guardaron y releyeron** con sentinels neutrales ✅

## J. Privacidad

Sentinels: `SENTINEL-V2-B00-4c81`, `SENTINEL-V2-B03-9e02`.

| Superficie de administrador | Resultado |
|---|---|
| Cola de Producciones | 4 entradas, **0 de esta experiencia** ✅ |
| Sentinels en cola **y en el detalle de cada producción** | **0** ✅ |
| Títulos, preguntas o respuestas de bitácora en cualquier proyección | **ausentes** ✅ |
| Lectura directa de una evidencia privada | **409 `NOT_REVIEWABLE`** ✅ |
| Admin pidiendo la ruta del participante | **404**, sin fuga ✅ |
| Evidencias del run nuevo | todas `requiresReview:false` ✅ |

**→ No aplica `RED-PRIVACY`.**

## K. QA visual y accesibilidad

**Escritorio:** los tres tipos de lectura se distinguen a simple vista — **`Libro · …` (10)**,
**`Texto del mook · …` (9)**, **`Transición · Mx` (7)**. Estados con texto («Completado»,
«En curso», «Bloqueado»). Bitácoras con «Privada. Solo tú puedes leerla.» + «Guardada para ti» +
«Leer lo que escribí». **Sin scroll horizontal** (1093/1093).

**390 px:** `scrollWidth == clientWidth` (**386/386**), títulos completos que envuelven sin recorte,
los diez `Libro ·` y los nueve `Texto del mook ·` presentes.

**Controles ausentes, como exige el contrato:** cero **Compartir**, **grupo**, **galería**,
**Borrar/Eliminar respuesta**, cero **rankings**, cero **rachas**, cero **autoplay** y cero
lenguaje de abandono.

### K.2 `YELLOW-HUMAN-AUDIO-QA` (pendiente separado, no bloqueante)

Sigue sin poder reproducirse MP3 en el Chrome automatizado (documentado en la unidad 03: el
reproductor propio del navegador también falla con el archivo servido `200`/`206`). **No se declara
correspondencia voz–transcripción**: requiere escucha humana de los 16 audios.

## L. Tests y build

| Comando | Resultado |
|---|---|
| `npm run test:mook` | ✅ GREEN |
| `npm run test:library` | ✅ GREEN |
| `npm run test:metric-contract` | ✅ GREEN |
| `npm run test:memberships` | ✅ GREEN |
| `npm run typecheck:baseline` | ✅ Sin regresiones TS |
| `npm run build` | ✅ built |

**No se añadió código ni tests**: el sistema actual permitió completar la unidad tal cual.
**→ No aplica `YELLOW-RUNTIME-CONTRACT-GAP`.**

## M. Git, activos y producción

- **Commit exclusivamente documental** (este anexo). **Cero archivos de código modificados.**
- **No se versionan** TXT/MP3, la fuente completa, los recursos cargados, `data/`, `data-critical/`,
  `public/uploads/`, las sondas ni credenciales — todo gitignored o fuera del repositorio.
- **Cero producción**: ni consultas, ni escrituras, ni deploy, ni contenedores, ni flags.
- **Credenciales temporales de QA creadas y eliminadas** (0 usuarios con contraseña al cierre).
- Entitlement de los 11 recursos nuevos concedido por la **ruta canónica** `PUT /api/groups`.
- La carpeta editorial pasa de 49 a **50** archivos por la fuente `SOURCE-ONLY`; los 49 activos
  verificados siguen intactos.

## N. Pendientes y siguiente unidad

| Pendiente | Estado |
|---|---|
| **`YELLOW-HUMAN-AUDIO-QA`** | escucha humana de los 16 MP3 y correspondencia voz–transcripción |
| Navegación «Seguir leyendo en *Me desconecto, luego existo*» desde un extracto | no implementado (fuera de alcance) |
| *Diálogos imposibles* (pp. 133–152) como lectura opcional | no incluido (fuera de alcance) |
| Microcopias especiales del reto (repetir / adaptar / omitir) | no implementadas; la conducta sí existe |
| Compartir / grupo / galería · edición o borrado de entradas privadas | fuera del MVP |
| Capítulo *Me desconecto, luego existo (otra vez)* (pp. ~97–111) y Glosario | no solicitados como extractos |
| Descarga del archivo de audio en el visor genérico | stub ajeno a MOOK |
| Residual 404 vs 409 en ids de evidencia | revela existencia, nunca contenido |

**Siguiente unidad sugerida:** revisión editorial humana del recorrido completo sobre v3
(incluida la escucha de los 16 audios) y preflight de liberación. La estructura ya no requiere
trabajo de ingeniería: cualquier ajuste de orden, título o recurso se hace desde el Studio con
«Crear nueva versión».
