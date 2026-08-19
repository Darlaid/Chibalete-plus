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
