# CHP-MOOK-PILOT-01 — Piloto de inducción docente (inventario de fuentes)

Fecha: 2026-08-19. Tipo: unidad de autoría del piloto «Inducción al Programa Integral de Lectura, Escritura, Oralidad y Gestión del Conocimiento» (contrato: ADR §17.8; estructura contractual de 3 módulos).
Resultado de esta pasada: **inventario de fuentes canónicas cerrado; autoría NO iniciada** por la regla editorial principal.

---

## A. Veredicto

**YELLOW-CONTENT-SOURCES** — las fuentes pedagógicas esenciales del piloto **no existen** en el repositorio ni en el catálogo canónico local, y la unidad prohíbe expresamente rellenar los vacíos con texto genérico o redactar afirmaciones pedagógicas/institucionales sin fuente. Aplican además dos stop conditions: «fuente pedagógica ausente» y «video/audio sin transcripción y sin alternativa». La infraestructura (Studio, Runtime, Review, 6 nodos, transcripción por nodo, revisión humana) está **GREEN y lista**: en cuanto el equipo editorial aporte las fuentes de la matriz §D, la materialización es un ejercicio directo del Studio ya validado.

## B. Qué se verificó (Fase A completa)

- Rama `chp/mook-contract-00`, HEAD `5150ee3` = origin, working tree limpio.
- ADR §17 (piloto §17.8, contrato Leo §17.6), UX D1–D4, docs de Studio/Review releídos.
- Búsqueda en TODO el repo versionado de «Programa Integral» / «Lectura, Escritura, Oralidad»: **0 documentos** (únicas coincidencias: una etiqueta de UI «Laboratorio de oralidad» en `OralityModal`/`VisorTexto`).
- Catálogo canónico local consultado por la API autorizada (`GET /api/content`, 12 piezas) — inventario completo en §C.
- Candidatos versionados revisados (`CHIBALETE-READING-RUNTIME.md`, `EDITORIAL-EXPERIENCE.md`, `LEO-PEDAGOGICAL-SIGNALS.md`, `LEO-LONGITUDINAL-EVENTS.md`, `AULA-VIVA-PASO-3-INTERVENCION-PEDAGOGICA.md`): son documentación **técnica de ingeniería** (runtimes, señales, fases de implementación), no material editorial para docentes; sin `contentId` canónico.
- `CHP_MOOK_PILOT_DESIGN_00.md` corresponde al piloto anterior («Me desconecto, luego existo», hoy fixture dev por §16) — no cubre la inducción docente.

## C. Inventario clasificado del catálogo local

| contentId | Tipo | Título | Clasificación | Nota |
|---|---|---|---|---|
| content-1773089901847 | libro | Las aventuras de Alicia… | **CANONICAL_READY** | dominio público; útil SOLO como material de práctica de mediación |
| content-1778097541576 | libro | La guerra de los mundos | **CANONICAL_READY** | ídem |
| content-1772817449967 | libro | Llegaba tarde la tortuga | **CANONICAL_READY** | ídem |
| content-1765893250573 | libro | Lectores en Red | **CANONICAL_READY** | ídem |
| content-1779494582113 | libro_album | Sol de los venados | **CANONICAL_READY** | ídem |
| content-1765895265631 | video | «De la tierra a la luna (YouTube Test)» | **UNVERIFIED** | fixture de QA; sin transcripción → NO READY (regla D) |
| content-1765978848219 (+child) | video ×2 | «Video Test Final» / «Video de prueba» | **UNVERIFIED** | fixtures de QA; sin transcripción → NO READY |
| content-1773089910035-0 | guia | «GUia profes» | **UNVERIFIED** | fixture sin contenido pedagógico verificable |
| content-1773239761665/2035/2374 | guia ×3 | «guia» | **UNVERIFIED** | ídem |

**Cero** piezas `articulo_pedagogico`/`contexto_pedagogico`; **cero** textos dirigidos a docentes; **cero** medios con transcripción.

## D. Matriz exacta de lo necesario (por nodo contractual)

| Módulo · nodo | Fuente requerida | Estado | Qué debe aportar el equipo editorial/institucional |
|---|---|---|---|
| M1 · READING | Texto institucional: propósito del Programa Integral; seguimiento vs. evidencia vs. evaluación | **MISSING** | Documento aprobado (o su redacción) + alta como contenido canónico (`articulo_pedagogico`, «Contenido para una Experiencia») |
| M1 · VIDEO/AUDIO | Pieza audiovisual institucional de bienvenida **con transcripción completa** (idioma, duración) | **MISSING** | El medio + su transcripción oficial; sin transcripción no puede ser READY y esta unidad no genera medios |
| M1 · ACTIVITY | Consigna reflexiva derivada del texto M1 | bloqueada por M1·READING | — (formato text_short ya soportado) |
| M2 · READING | Texto: competencias, trayectorias lectoras y acompañamiento (mediación) | **MISSING** | Documento aprobado + alta canónica |
| M2 · LEO | Fuentes autorizadas del nodo (texto M2) + libro de práctica | **PARCIAL** | El texto M2; el libro de práctica puede ser cualquiera de los CANONICAL_READY (p. ej. «La guerra de los mundos») |
| M2 · ACTIVITY | Consigna derivada de M2 | bloqueada por M2·READING | — |
| M3 · READING o VIDEO | Texto/medio: qué evidencia registra Chibalete+, qué interpreta el profesional, cómo documentar decisiones | **CANONICAL_REQUIRES_ADAPTATION** | Base técnica veraz EXISTE (contrato de métricas, eventRegistry, docs LEO-*/AULA-VIVA-*), pero exige adaptación editorial HUMANA a lenguaje docente + aprobación + alta canónica; si es video, con transcripción |
| M3 · LEO | Fuentes autorizadas (texto M3) + configuración distinta a M2 | bloqueada por M3 | — |
| M3 · PRODUCTION | Consigna de propuesta de aplicación + criterios transparentes de revisión | bloqueada por M1–M3 | Los criterios deben citar los textos del piloto |

Transversales YA RESUELTOS por unidades previas (nada que aportar): aviso de IA del nodo Leo (§17.6, cableado), mínimo de intercambios visible, revisión humana con ajustes/reenvío/historial, campo de transcripción por nodo VIDEO/AUDIO, plantilla Leer→Conversar→Producir en Studio, accesibilidad de las superficies.

## E. Por qué NO se materializó nada

La regla editorial principal («no redactes afirmaciones pedagógicas, normativas o institucionales sin fuente») convierte cada texto de M1–M3 en contenido que YO tendría que inventar: propósito del Programa, política de seguimiento vs. evaluación, responsabilidad institucional. Hacerlo violaría la unidad y produciría un piloto institucionalmente falso. Tampoco se puede cumplir la Fase D: ningún medio del catálogo tiene transcripción y redactar la transcripción de un video que no está descrito en ninguna fuente también sería inventarla (`YELLOW-TRANSCRIPT-MISSING` subsumido en este veredicto). Por lo mismo, no hay fixture/seed nuevo, no hay E2E de contenidos y no se tocó el catálogo.

## F. Procedimiento de reanudación (cuando existan las fuentes)

1. Equipo editorial entrega los 3–4 documentos de la matriz (y el medio con transcripción) → se dan de alta con el flujo `Subir` existente marcados «Contenido para una Experiencia».
2. Re-ejecutar esta unidad: la autoría completa se hace con el Studio validado (STUDIO-01), el contrato Leo de §17.6 y el ciclo de revisión (REVIEW-01); el E2E de tres actores ya está ensayado (REVIEW-01 §H).
3. Nada de esta pasada requiere rollback: el único artefacto es este documento.

## G. Próximo paso

Bloqueado en el operador/equipo editorial: aportar las fuentes de la matriz §D (o indicar dónde viven fuera del repo y cómo autorizarlas). La infraestructura no requiere trabajo adicional para el piloto.

---
---

# ANEXO DE CIERRE — CHP-MOOK-PILOT-01-CLOSURE (2026-08-19)

**Veredicto: GREEN-MOOK-PILOT.** El operador aportó el corpus institucional **V9** (10 PDF en `Programa integral/`, local, untracked y fuera de Git) y autorizó la reanudación. El YELLOW histórico de arriba se conserva como evidencia; este anexo lo cierra.

## H. Corpus adoptado y trazabilidad

Leídos íntegros: documento general V9, Módulo 1 (Fundamentos), Módulo 2 (Competencia lectora), Módulo 3 (Experiencia pedagógica y mediación), Módulo 7 (Evaluación y medición) y Módulo 8 (Implementación). **M4, M5, M6 y M9 no se citaron** (regla de uso mínimo: ninguna afirmación del piloto los requirió; las actividades se fundamentan en M3 §6 y M1 §9, ambos leídos íntegros).

Matriz fuente → contenido → nodo (páginas de los PDF V9):

| Contenido creado | Fuente(s) y páginas | Nodo(s) |
|---|---|---|
| **Texto 1 — Bienvenida y fundamentos de Chibalete+** | Doc. general §1 propósito/problema estructural (pp. 3–5), §2 sistema/5 componentes/espacios (pp. 5–7), §3 cuatro principios (pp. 11–14), §7 evaluación/ICDLI «no reemplaza la evaluación pedagógica: la ordena» (pp. 27–29), «la plataforma no reemplaza la mediación» (p. 18); M1 §11 invariantes (pp. 15–18), §12 variables (pp. 18–20) | n1 (READING m1) |
| **Texto 2 — Competencia lectora, trayectorias y mediación** | M2 §1 proceso/3 dimensiones (p. 2), §3–4 niveles como capas (pp. 4–8), §5 cinco habilidades (pp. 8–10), §6 evidencias dice/escribe/produce (pp. 12–13), §7 trayectorias (pp. 13–14), §8 puntos de quiebre (pp. 14–17); M3 §3 mediación cognitiva/emocional/crítica (pp. 12–18), §4 tipologías de preguntas (pp. 18–24), §5 conversación/rol docente (pp. 24–29), §6 producción breve con sentido (pp. 29–34); Doc. general p. 19 (Leo extiende, no reemplaza) | n4 (READING m2) |
| **Texto 3 — Seguimiento, evidencia y responsabilidad institucional** | M7 presentación «evaluar = comprender cómo piensa» (pp. 2–3), §1 interpretación vs verificación (pp. 3–5), §2 evidencia como pensamiento en acción (pp. 5–8), §3 ICDLI modelo de lectura, no clasificación (pp. 8–11), §4.1 trayectorias receptor/constructor/crítico/productor «no etiquetas» (pp. 14–25), §6 evaluación ecosistémica/«qué condiciones no se activan» (pp. 27–31), §8 datos→decisiones (pp. 36–40); M8 §2.1 ICDLI motor (pp. 5–7), §10 corresponsabilidad (pp. 37–39), §12 «la plataforma no toma decisiones» (pp. 41–43) | n7 (READING m3) |
| **Guion/transcripción audio 1 — Bienvenida** | Doc. general Presentación (p. 2), §1 (p. 3), §5 corresponsabilidad/«la lectura debe circular» (pp. 16–17), flujo pedagógico (pp. 18–21) | n2 (AUDIO m1), `config.transcripcion` |
| **Guion/transcripción audio 2 — La evidencia acompaña** | M7 §1 (pp. 3–5) y cierre (p. 42); M8 §2.1 (pp. 5–7); regla institucional del operador | n8 (AUDIO m3), `config.transcripcion` |
| Consignas de actividades (n3, n6) y producción (n10) | M1 §9 retos (pp. 11–13); M3 §4 preguntas y §6 producción; M7/M8 para la decisión documentada | n3, n6, n10 |

**Regla institucional aplicada en todos los textos**: colegios/docentes/instituciones evalúan; Chibalete+ hace seguimiento, organiza evidencia y reporta; Leo acompaña sin diagnosticar/calificar/determinar niveles; toda interpretación y decisión pedagógica es humana; sin rankings ni comparaciones. Donde los PDF usan «evaluación» en sentido amplio, la redacción del piloto la reasigna a esta distribución sin alterar los PDF.

## I. Alta canónica (IDs)

Vía `/api/upload` + `/api/content` (flujo existente, admin; **sin importadores**), todos `standalone:false`, tipo y MIME verificados por el backend:

| contentId | Tipo | Archivo | Detalle |
|---|---|---|---|
| `pilot-texto-fundamentos-1787163953220` | articulo_pedagogico | texto_m1_bienvenida.txt (4 258 B) | texto_plano_url; legible en Modo Guiado |
| `pilot-texto-competencia-1787163953220` | articulo_pedagogico | texto_m2 (4 413 B) | ídem |
| `pilot-texto-evidencia-1787163953220` | articulo_pedagogico | texto_m3 (4 214 B) | ídem |
| `pilot-audio-bienvenida-1787163953220` | podcast | WAV 3 600 878 B | **narración sintética local** (System.Speech, voz Microsoft Helena es-ES), 22 050 Hz, ~81,7 s; MIME `audio/wav` verificado; servido HTTP 200 |
| `pilot-audio-evidencia-1787163953220` | podcast | WAV 4 166 516 B | ídem, ~94,5 s |

Los WAV reproducen **exactamente** su guion (el TTS lee el archivo del guion literal; guion = transcripción, colocada en `config.transcripcion` del nodo). Desviación declarada: **WAV en lugar de MP3** — no hay codificador MP3 local sin dependencias nuevas y WAV está en la whitelist canónica de upload (`server.js` allowedExtensions); reproducción validada en VisorAudio. Guiones y textos fuente viven en el scratchpad de sesión (fuera del repo); su contenido íntegro queda en el catálogo local (texto_plano_url) y en este anexo por referencia.

Nota de shape: los registros creados por API requirieron un segundo pase con los campos estándar del catálogo (`etiquetas[]`, `sectionIds[]`, `ilustraciones_url[]`, `isCollection`, `metricas`, `publico_objetivo`, `descripcion_corta`) — la Home los itera y sin ellos la SPA crashea (`.includes` sobre undefined). Corregido por datos (API), sin tocar código.

## J. Experiencia y estructura

`exp-1787164160874-u50h52`, slug `piloto-induccion-docente`, **v1 `expv-1787164160889-vf9lj2` PUBLICADA localmente** (la publicación local no autoriza publicación productiva). 3 módulos congelados / 10 nodos:

- **mod1 Bienvenida y fundamentos**: n1 READING → n2 AUDIO (transcripción en nodo) → n3 ACTIVITY (2 preguntas reflexivas).
- **mod2 Competencias, trayectorias y mediación con Leo**: n4 READING → n5 LEO (objetivo: tres dimensiones de la mediación; semilla propia; minIntercambios 3) → n6 ACTIVITY.
- **mod3 Seguimiento, evidencia y responsabilidad institucional**: n7 READING → n8 AUDIO → n9 LEO (objetivo distinto: leer evidencia sin calificar; semilla distinta) → n10 PRODUCTION (consigna con «no es una calificación», criterio de revisión transparente, 120–350 palabras).

**Resolución contractual de tipos**: el ADR §17.8 define los slots audiovisuales como alternativos («VIDEO/AUDIO», «READING **o** VIDEO»); se instanciaron los cinco tipos que el contrato exige para esta estructura (READING×3, AUDIO×2, LEO×2, ACTIVITY×2, PRODUCTION×1). **VIDEO no se instancia**: no existe fuente audiovisual canónica en video (los fixtures de QA están prohibidos y esta unidad no genera videos); el tipo VIDEO queda cubierto por el mismo código de nodo (proyección, transcripción y tests compartidos con AUDIO).

**Cambio mínimo de código** (carencia real vs. ADR §17.4 «alternativa textual accesible desde el nodo»): `pages/Experiencias.tsx` ahora renderiza `config.transcripcion` en nodos VIDEO/AUDIO como `<details>` «Ver transcripción (alternativa textual)». Cubierto por `server/__test__/mookPilot01.test.mjs` (test estructural) y validado visualmente en preview y runtime.

## K. E2E de tres actores (local)

1. **Autor (admin)**: experiencia creada por APIs del Studio, validada en el Studio UI; **preview** (pestaña Vista previa) recorrida: banner «nada de lo que hagas aquí se guarda», completar bloqueado, y verificación por API tras la preview: **cero runs, cero evidencias**. Publicación v1.
2. **Participante (demo-lector)**: descubre el piloto en Biblioteca→Experiencias, portada con 3 módulos/10 pasos y aviso de revisión humana; inicia; **reanuda** tras recarga dura (3/10 conservado, nodo actual correcto); recorre los 10 nodos: lecturas abiertas en Modo Guiado, audios reproducidos en VisorAudio (currentTime real: 14,3 s/81,7 s y 2,9 s/94,5 s), transcripciones visibles desde el nodo, actividades respondidas, **nodos Leo con enforcement real** (validar sin conversar → 409 «exige ≥3 intercambios (lleva 0)»; con 3 interacciones registradas en `leo_interactions` → valida), producción final entregada (220 palabras).
3. **Revisor (admin)**: Producciones muestra la entrega («Lector Demo · Inducción… · v1»); detalle con consigna, criterio, respuestas de actividades y estado del recorrido; **solicita ajustes** con comentario; el participante ve el aviso en el cierre y el feedback en «Tu producción», **reenvía** (versión 1 conservada); el revisor ve «2 versiones», **marca revisada (Aprobar)** con confirmación en dos pasos; el participante ve `REVIEWED / aprobado` + feedback + 2 versiones, `canResubmit=false`.

Verificaciones adicionales: **v1 inmutable** (re-publish → HTTP 409); run pineado a `expv-…vf9lj2` (visible en cola y proyecciones); **flag `EXPERIENCE_EVENTS_BACKBONE_ENABLED` no seteado = OFF** (cero eventos; payloads cubiertos por test 14 de REVIEW-01); **cero accesos a producción** (todo en localhost; los PDF untracked; `.env` tracked intacto).

## L. Accesibilidad y QA visual

Transcripción exacta visible y expandible en ambos nodos AUDIO (elemento nativo `details/summary`, focusable por teclado); audio sin autoplay, con controles y velocidades en VisorAudio; estados con texto en todo el recorrido; aviso de IA del nodo LEO visible con el mínimo de intercambios; **móvil 390 px** (iframe): portada y recorrido apilados sin scroll horizontal (`scrollWidth == clientWidth`); elementos interactivos nativos (button/summary/textarea/label). No probado: lectores de pantalla reales, zoom 200 % — sin declarar conformidad WCAG completa.

## M. Entorno local (para reproducir) y hallazgos

- Workaround dev habitual + **dos adiciones de esta unidad**: (1) acceso a los contenidos del piloto vía **club canónico** `group-pilot-induccion` (POST /api/groups, availableContentIds = 5 ids, miembros demo-lector/user-tono/admin); (2) backend con **`ACCESS_FALLBACK_MODE=open`** (env soportada por `server.js`; el default no-seteado es `restricted`). Motivo: `/api/access` exige el ADMIN_SECRET file-only con modo POSIX 0400 exacto (`secretFile.js`), **inviable en Windows** (Node reporta 0444/0666) — no hay vía de crear reglas en `access_db.json` en dev Windows; con open + club, el acceso lo gobierna la capa legacy de grupos, que es exactamente el contrato vigente («no eliminar fallback legacy aún»).
- Claves de IA del `.env` dev inválidas (OpenAI 401, Gemini API_KEY_INVALID): Leo respondió con su **fallback seguro** y el orchestrator **registró la interacción** igualmente — el circuito del nodo LEO (aviso, semilla, mínimo, conteo, validación) quedó validado end-to-end en modo controlado; la calidad de respuesta del modelo no es objeto del piloto local.
- El TTS on-upload de los textos terminó `listo` (cola interna); inocuo.

## N. Suites, archivos y rollback

Suites: `test:mook` (6 archivos, todos exit 0; incluye los 2 tests nuevos del piloto), `test:library`, `test:metric-contract`, `test:memberships`, `typecheck:baseline`, `npm run build` — **todo GREEN**.

Archivos de la unidad (commit único): `pages/Experiencias.tsx` (transcripción en nodo), `server/__test__/mookPilot01.test.mjs` (nuevo), `package.json` (encadena el test), `docs/ops/CHP_MOOK_PILOT_01.md` (este anexo). Fuera del commit: PDF de `Programa integral/` (untracked), `data/`, `data-critical/`, uploads.

Rollback local: `git revert` del commit; los datos del piloto (5 contenidos, club, experiencia, run, evidencia) viven solo en el store dev local y pueden archivarse/retirarse por los flujos existentes (archivo de experiencia no destructivo §17.3; Gestionar Biblioteca para contenidos).

## O. Próximo paso

Unidad separada de **revisión editorial/pedagógica humana y preflight de liberación** (los textos/guiones son adaptaciones con trazabilidad, pendientes de aprobación editorial formal). No desplegar.
