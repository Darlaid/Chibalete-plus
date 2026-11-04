# G4-PILOT-GATE-03A: ficha del primer piloto MOOK elegible para XP

**Fecha:** 2026-11-04. **Veredicto:** `PILOT_CONTENT_READY`. El contenido está listo para cargar; la activación sigue bloqueada por requisitos que no son de contenido (§5).
**Alcance:** auditoría editorial y diseño. No se creó nada en producción: ni experiencias, ni versiones, ni entregas, accesos, reglas, flags o secretos.
**Fuentes:** el código de `g4inert-cf27126`, que es la imagen productiva, y lecturas en producción hechas por stdin dentro de `chibalete_api_1`. Fueron solo lecturas: SQLite se abrió en `readonly` con escritor vivo y solo se imprimieron conteos de personas.

## 1. Estado verificado

| | Valor |
|---|---|
| Rama, HEAD | `chp/epub-mainfile-r1-release`, `01e22ba` = origin. La orden indicaba `81bb889`; `01e22ba` solo añade la evidencia documental de 02B |
| Producción | `api_1`, `api_2` y `front` en `g4inert-cf27126`; flags de gamificación sin definir |
| MOOK prod | 2 experiencias: «¿Estás aquí?» v1–v5 publicada, con 0 nodos PRODUCTION, y un borrador sin versiones. 0 evidencias y 2 recorridos. **Experiencias elegibles: 0** |
| Derechos | `royalties.db`: **0 versiones de derechos registradas**. `RIGHTS_ENFORCEMENT_MODE=off` |
| Acceso | 17 reglas activas: 14 de grupo y 3 de usuario; ninguna de organización. 21 grupos; ninguno con `availableContentIds: 'all'` |

## 2. Inventario de obras: la discrepancia 44 frente a 36 + 9 + 5

La regla `workBlock` (`utils/workEligibility.mjs`) aplicada a los 110 contenidos da **44 obras = 34 libros + 9 libros álbum + 1 video**.

| Motivo de exclusión | Contenidos |
|---|---|
| `work_not_standalone` (piezas creadas solo para Experiencias) | 31 |
| `work_is_part` (10 libros y 3 videos) | 26 |
| `work_not_classified` (podcast, artículo, guía…) | 8 |
| `work_is_collection` (1 video) | 1 |

El total de 44 del preflight era correcto, pero su desglose estaba mal:
- **«5 videos»** contó el tipo sin aplicar la regla. De los 5 videos, 3 son partes y 1 es colección; solo «Tutorial Chibalete+» es obra.
- **«36 libros»** no sale con ningún criterio. Hay 44 libros en total, de los que 10 son partes: quedan 34.

La suma 36 + 9 + 5 = 50 no podía cuadrar con 44.

Las 44 obras están `disponible` y no tienen régimen de derechos. **43 de ellas** tienen la misma cobertura de acceso explícito:
- **Grado 005** (dos grupos distintos con el mismo nombre): 80 + 80 lectores, sin solapamiento, todos activos y no sintéticos, con 10 + 10 mediadores activos.
- **Club FilBo 2026:** 64 lectores y 1 mediador.
- 10 subgrupos FilBo sin mediador.
- 3 reglas de usuario.

«Drácula» no tiene ninguna regla. **Ninguna obra declara `edad_recomendada`**: todas tienen `publico_objetivo: "todos"`.

## 3. Obras evaluadas

| Criterio | **Cuentos de la selva** (Quiroga) `content-1775766806680` | Llegaba tarde la tortuga (Chibalete Editores) `content-1773676835077` | Dinosaurios (en orden de estatura) (N. Caballero) `content-1776094921021` |
|---|---|---|---|
| 1. Disponibilidad y derechos | Original en español, dominio público (Quiroga murió en 1937: vida + 80 en Colombia). Sin traducción que licenciar. Edición propia. Sin régimen en `royalties.db` | Obra de la casa; los derechos parecen propios, pero no hay Acta registrada | Obra de la casa; sin Acta registrada |
| 2. Lectores de 7 a 11 años | Narrativa clásica infantil de 1 700 palabras («La tortuga gigante»). Adecuada para 9–11 con autonomía y para 7–8 con lectura acompañada | Microhistoria infantil, mejor para 5–8 | Informativo; bueno para 7–11, pero menos narrativo |
| 3. Acceso institucional | `SCOPE_TITLE` para Grado 005 ×2 y FilBo | Igual | Igual |
| 4. Lectura y reflexión genuina | Alta: causa, reciprocidad, perseverancia, con evidencia textual clara | Media: el ritmo propio, con poco texto que citar | Media o baja: comparar y ordenar, más dato que interpretación |
| 5. Complejidad mínima | TXT completo, UTF-8 limpio (0 caracteres de reemplazo) y Modo Guiado disponible; `ttsStatus: listo`; 0 partes | Solo PDF; sin TXT; TTS no iniciado; 2 guías como partes | Visor de álbum; sin TXT; TTS no iniciado |

**Descartadas a propósito:**
- «Zorrito, cómo te sientes hoy», «Búho y la noche inquieta» y «Mi sombra»: su tema (emociones, ansiedad infantil) empujaría a menores a escribir sobre su vida emocional en una entrega que guarda MOOK y lee un mediador.
- «Millones de gatos»: Wanda Gág murió en 1946, así que en Colombia no es de dominio público hasta el 1 de enero de 2027.
- Las traducciones de clásicos (El principito, Pinocho…): exigen comprobar los derechos de traducción.
- Las obras juveniles y de filosofía: quedan fuera del rango de 7 a 11 años.

**Recomendación: «Cuentos de la selva», cuento «La tortuga gigante».**
- Es la única candidata infantil sin dudas de derechos que tiene texto completo para Modo Guiado.
- El cuento abre el libro: el lector no tiene que navegar.
- Su reflexión natural (por qué la tortuga ayudó al hombre) se apoya en el texto y no pide datos personales.

**Cohorte del piloto:** uno de los dos grupos «Grado 005» (aprox. 10–11 años, extremo superior del rango). Son los únicos con acceso explícito y mediadores suficientes; FilBo tiene un solo mediador para 64 lectores.

**Arranque:** de 5 a 10 lectores y un solo mediador de ese grupo. La experiencia es visible para todo el que tenga acceso, así que el mediador invita solo a esos lectores. Ampliar al resto del grupo es una decisión posterior, tomada con lo aprendido.

## 4. Experiencia piloto, lista para Studio

### Experiencia

| Campo | Texto |
|---|---|
| `slug` | `selva-tortuga-gigante` |
| Título | La tortuga que no se rindió |
| Descripción | Lee «La tortuga gigante», de Horacio Quiroga, y descubre por qué una tortuga cruzó montes, ríos y pantanos para salvar a un hombre. Al final escribirás lo que piensas y tu mediador te dará su opinión. |
| Público (`audience`) | Lectores de 7 a 11 años, con acompañamiento del mediador. |
| Cohorte (dato interno de planificación; **no se carga en Studio**, el lector no lo ve) | Piloto: Grado 005 (§3) |
| Duración (`durationLabel`) | 2 sesiones de 40 minutos |
| Objetivos | 1. Comprender qué pasa en el cuento y en qué orden. 2. Explicar por qué actúa un personaje usando momentos del texto. 3. Escribir con palabras propias una idea apoyada en el cuento. |

### Módulo 1: «Leer el cuento»

**Nodo `n-leer`: READING**, obligatorio.
- Título: «Lee "La tortuga gigante"».
- `resourceRef`: `content-1775766806680`.
- Instrucciones: «Abre el libro y elige el Modo Guiado. Lee solo el primer cuento, "La tortuga gigante". Termina cuando la tortuga llega al Jardín Zoológico. Si te cuesta, pide a tu mediador que lo lean juntos.»

**Nodo `n-comprender`: ACTIVITY**, obligatorio, no privado. Calentamiento: no se revisa ni da XP.
- Título: «¿Qué pasó en el cuento?».
- Consigna: «Responde con tus palabras. No hay respuestas largas ni cortas: basta con que se entienda.»
- Preguntas:
  1. ¿Por qué el hombre se fue a vivir al monte?
  2. ¿Qué hizo el hombre cuando encontró a la tortuga herida?
  3. ¿Cómo ayudó la tortuga al hombre cuando él se enfermó?

### Módulo 2: «Pensar y escribir»

**Nodo `n-reflexion-1`: PRODUCTION**, obligatorio.
- Título: «¿Por qué lo hizo?».
- `resourceRef` (obra evaluada): `content-1775766806680`.
- Consigna: «La tortuga caminó días y semanas con el hombre en el lomo, aunque estaba muy cansada. ¿Por qué crees que lo hizo? Escribe tu idea y cuenta dos momentos del cuento que te ayudaron a pensarla.»
- Criterio de revisión (lo ven el lector y su mediador): «Se aprueba si tu texto da una razón de la tortuga y la apoya en al menos un momento del cuento, con tus palabras. No se califica la ortografía.»
- Palabras: mínimo 40, máximo 150.

**Nodo `n-reflexion-2`: PRODUCTION**, obligatorio (ver la nota de diseño).
- Título: «Una carta para la tortuga».
- `resourceRef`: `content-1775766806680`.
- Consigna: «Imagina que eres el hombre del cuento y ya estás curado. Escríbele una carta a la tortuga: cuéntale qué recuerdas de lo que hizo por ti y por qué fue importante. Usa cosas que pasan en el cuento.»
- Criterio de revisión: «Se aprueba si la carta recuerda al menos una acción de la tortuga que está en el cuento y explica por qué importó. Puede ser creativa, pero no puede contradecir el cuento.»
- Palabras: mínimo 30, máximo 120.

**Nota de diseño.** La segunda reflexión es **obligatoria**:
- Al terminar los nodos obligatorios, la experiencia muestra la pantalla de cierre (`renderCierre`). Un nodo opcional solo se alcanza desde «Revisar recorrido», y un lector de 7 a 11 años probablemente no lo encuentre.
- Un recorrido lineal es más claro para esta edad.
- El techo sigue siendo 50 XP.

Los mínimos de palabras se bajan del valor por defecto (150–300), que es inalcanzable a esta edad.

### Evidencia esperada y revisión del mediador

**Evidencia.** Dos textos breves (40–150 y 30–120 palabras) escritos por el lector, cada uno con:
- una idea propia;
- al menos un hecho del cuento: el hombre cura a la tortuga y no se la come; ella le da agua y raíces; lo carga hasta Buenos Aires; casi muere de cansancio.

**Decisiones del mediador:**
- **Aprobado:** cumple el criterio. Es lo único que puede sumar XP.
- **Con comentarios:** hay una idea, pero sin apoyo en el texto, o lo cuenta sin explicar por qué. Hay devolución y no hay XP.
- **Pedir ajustes:** no se relaciona con el cuento, está copiado o es genérico. El lector reenvía y solo cuenta si después se aprueba.

**Dos reflexiones distintas:**
- La primera es de **inferencia**: explicar una causa con pruebas del texto.
- La segunda es de **perspectiva**: ponerse en el lugar de otro personaje y valorar lo que pasó.
- Una misma respuesta no sirve para las dos. Si el lector repite la primera en la carta, se piden ajustes.

**Pautas para mediadores:**
- No se penalizan la ortografía, la extensión por encima del mínimo ni la letra.
- Un texto copiado del libro no se aprueba.
- **IA:** no se usan detectores automáticos, porque no son fiables y acusan a niños sin razón. El mediador decide con lo que sabe del lector.
  - Si el texto no se parece a cómo escribe, pide ajustes con una pregunta sobre el cuento («¿Qué parte te hizo pensar eso?») y lo conversa en clase.
  - Nunca acusa por escrito.
- La devolución nombra primero lo que el lector hizo bien y es breve (una o dos frases).

**Encuadre de contenido, antes de leer.** El cuento incluye:
- caza de animales para vender sus cueros;
- la muerte de un tigre;
- víboras guardadas en un mate;
- un hombre que fuma;
- una enfermedad grave con fiebre y delirio.

Guion sugerido para el mediador: «Este cuento se escribió hace más de cien años. Entonces se cazaban animales para vender su piel; hoy muchos están protegidos. Fíjense en cómo cambia el hombre cuando cuida a la tortuga.» Si un lector cuenta una enfermedad o una pérdida propia, el mediador lo atiende fuera de la plataforma y no lo usa como criterio de revisión.

### Resultado para la persona

- **Con XP apagado (hoy):** ve «Revisada · Aprobado» y la devolución del mediador en la propia experiencia.
- **Con XP activo:**
  - Primera entrega aprobada: **30 XP** (lectura 10 + reflexión 20). «Mi progreso» muestra «Cuentos de la selva · 30 de 50 XP».
  - Segunda entrega aprobada: **+20 XP**, en total 50 de 50.
  - Más entregas sobre la misma obra en el mismo ciclo: 0 XP.
- No se gana XP por abrir el libro, por el tiempo leyendo, por escuchar el audio, por la actividad de comprensión, por terminar la ruta (`XP_RUTA = 0`) ni por respuestas de Leo. PM = 0.
- **El techo es por obra, no por experiencia:** cualquier experiencia futura sobre otro cuento de «Cuentos de la selva» comparte esos 50 XP en el mismo ciclo.

## 5. Contratos de elegibilidad (contrastados con el código)

| Requisito | Dónde | Estado |
|---|---|---|
| `PRODUCTION.resourceRef` = la obra, ofrecida antes en un nodo READING, VIDEO o AUDIO | `productionWorkRef`, `workOfferedBefore`, `publishVersion` (rechaza `WORK_NOT_IN_VERSION`) | ✅ En el diseño (`n-leer` precede); falta cargarlo |
| Tipo de contenido válido: `libro`, `disponible`, ni parte, ni colección, ni `standalone: false` | `workBlock`, en guardado, publicación y entrega | ✅ Verificado en producción |
| Versión `published` con `publishedAt ≥ GAMIFICATION_MOOK_SINCE` | `resolveEvidenceWork`: `version_predates_contract` | ⏳ Si se publica **antes** del corte, esa versión no es elegible nunca (hay que crear otra) |
| Revisión con `reviewedAt ≥ SINCE` y decisión `aprobado`; `con_comentarios` no cuenta | `mookReviewCandidates` | ✅ Contrato |
| Acceso explícito: `via` ∈ {`SCOPE_TITLE`, `SCOPE_COLLECTION`, `GROUP_CATALOG`, `GROUP_ALL`} | `EXPLICIT_ACCESS_VIAS` | ✅ Lectores de Grado 005 y FilBo: `SCOPE_TITLE`, deducido del código y las reglas. Un lector que entre por la vía heredada o por rol obtiene una `via` no explícita y no suma XP. `SCOPE_COLLECTION` nunca aplica a una obra (exige `parentId`) |
| Snapshot `workAccess`, congelado en la primera entrega con lectura sin caché | `checkWorkAccess`, `submitEvidence` | ✅ Desplegado en `g4inert-cf27126`; automático |
| Derechos: retirada legal (`suspended`/`revoked`/`disputed`) bloquea | `readWithdrawnWorks`, `isWorkWithdrawn` | ✅ Sin régimen = no retirada. Recomendable: Editorial registra una versión de derechos con `subscription_reading` para que la retirada tenga efecto real |
| Sujeto y revisor activos, no sintéticos, sin autorrevisión ni exclusión | `candidateEligibility`, `exclusionGate` | ✅ 160 lectores y 20 mediadores elegibles. ⛔ El registro de exclusiones no existe |
| Revisión pedagógica por un mediador del grupo, reautorizada dentro del lock | `assertReviewScopeInLock` (`cf27126`) | ✅ En producción |
| `mook_review` puede emitir XP | `XP_LOCKED_SOURCES` contiene `mook_review` (`policy.mjs`), y `recordWorkRecognition` devuelve `source_locked` | ⛔ Bloqueado por código; desbloquearlo es una unidad propia |
| Conjunto de reglas activo con `recognition` aprobado (`approvalRef`, reading 10, reflection 20, techo 50, PM 0) y `effectiveFrom ≤ reviewedAt` | `validateApprovedRecognition`, `getActiveRuleSet` | ⛔ No existe; `gamification.db` no existe |
| Clave de sujeto | `getSubjectKey` | ⛔ No existe |
| Flags `GAMIFICATION_ENABLED`, `XP_EARNING_ENABLED`, `GAMIFICATION_MOOK_SINCE` | `db.mjs`, `mookSource.mjs` | ⛔ Sin definir; no fijar en esta unidad |
| Reconciliación e idempotencia | Gancho tras la revisión + barrido cada 15 min, lock O_EXCL entre réplicas, clave = `evidence.id`, techo aplicado en una transacción `IMMEDIATE` | ✅ En el código; corre cuando existan base, flags y corte |
| Aviso de privacidad de gamificación para menores (PRIV-6) | Legal | ⛔ Pendiente |

**Satisfecho hoy:** obra, tipo, acceso explícito de la cohorte, snapshot, revisión autorizada, idempotencia y techo.

**Pendiente:** cargar la experiencia, fijar el corte, desbloquear `mook_review`, reglas aprobadas en el ledger, clave de sujeto, registro de exclusiones, PRIV-6 y flags.

## 6. Secuencia mínima de publicación (cuando Dirección autorice)

1. **Laboratorio**, con la imagen `g4inert-cf27126` y datos sintéticos:
   - Cargar esta ficha en Studio y recorrerla como lector: Modo Guiado y audio del cuento, mínimos de palabras, las dos entregas y la pantalla de cierre.
   - Revisar como mediador del grupo y como mediador ajeno.
2. **Producción, borrador:** crear la experiencia y su versión en Studio **sin publicar**. Un borrador no es visible para lectores.
3. **Prerrequisitos, cada uno con su orden:**
   - PRIV-6;
   - clave de sujeto;
   - registro de exclusiones con custodia;
   - unidad que desbloquea `mook_review`;
   - conjunto de reglas aprobado (A7-A12-V3).
4. **Ventana de activación:**
   - Fijar `GAMIFICATION_MOOK_SINCE = T` con las flags, réplica a réplica.
   - **Después** publicar la versión, con `publishedAt > T`.
   - Nunca publicar antes de fijar T: la versión quedaría fuera del contrato para siempre.
5. **Grado 005:**
   - Comunicar a los 20 mediadores el criterio de revisión del §4.
   - Comprobar con un lector real que la obra abre con acceso permitido.
6. **Tras la primera aprobación:**
   - Verificar el conteo agregado del ledger y «Mi progreso» = 30 de 50.
   - Verificar que `con_comentarios` no suma.

## 7. Riesgos

**Editoriales:**
- El PDF de la obra (`place-….pdf`, 98 KB, 1 página) es un marcador de posición: el Modo Visual no muestra el libro. El piloto depende del Modo Guiado.
- **Audio no disponible.** El manifiesto TTS de producción (79 bytes) solo contiene `_meta` (68 fragmentos declarados) y no hay ningún `.mp3`. `VisorTexto` toma la vía «manifiesto», encuentra el índice 0 vacío y no reproduce nada, sin mostrar error, aunque el catálogo dice `ttsStatus: listo`. El piloto no debe prometer audio hasta regenerar el TTS de la obra, que es una unidad editorial propia.
- No hay edades registradas en el catálogo.
- Los dos grupos «Grado 005» no tienen `gradeLevel` ni sección.

**Legales:**
- PRIV-6 está pendiente.
- Se guardan textos de menores en MOOK y los lee un mediador. Las consignas evitan datos personales, pero un niño puede incluirlos igual.
- No hay Acta de derechos registrada para ninguna obra. Quiroga es de dominio público; la edición y la portada son propias.

**Operativos:**
- Carga de revisión: hasta 320 entregas para 20 mediadores.
- Criterios desiguales entre mediadores afectan a la equidad del XP.
- Los listados pueden ir hasta 30 s por detrás según la réplica (no afecta a las escrituras).
- El techo por obra se comparte entre experiencias futuras del mismo libro.
