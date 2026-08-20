# CHP-MOOK-PROTOTYPE-02 — Articulación y editabilidad del prototipo MOOK

**Fecha:** 2026-08-19 · **Rama:** `chp/mook-contract-00` · **Baseline:** `a665780`
**Veredicto:** `GREEN-PROTOTYPE-FLEXIBLE` (sin bloqueos; fricciones anotadas en §6)
**Alcance:** spot-check local, cero cambios productivos, cero cambios de código.

---

## 1. Declaración de prototipo — v1 NO es definitiva

La experiencia local `exp-1787164160874-u50h52` («Inducción al Programa Integral de
Lectura, Escritura, Oralidad y Gestión del Conocimiento», v1 publicada localmente
en PILOT-01) **es una experiencia de prueba**:

- sus textos, recursos, audios (narración sintética), actividades y configuraciones
  **no son definitivos**;
- su función es **demostrar cómo se articulan y editan los componentes** del modelo
  MOOK (READING / AUDIO / LEO / ACTIVITY / PRODUCTION organizados en módulos);
- **no es un release candidate**: no hay aprobación editorial ni preflight de
  liberación (siguen pendientes como unidades separadas).

Esta unidad evalúa el **prototipo como herramienta de ensamblaje y edición**, no su
contenido.

## 2. Entorno de prueba

Contrato dev Windows de RUNTIME-01/REVIEW-01/PILOT-01: backend local `:3010`
(`SESSION_AUTH_MODE=off`, `USERS_DB` explícito al fixture de `data-critical/`,
`ACCESS_FALLBACK_MODE=open`, flag de eventos experience OFF por defecto),
micro-proxy conmutable `:3000` (`/___qa/switch?user=`, switches secuenciados),
Vite `:5173`. Autor = `demo-admin` operando **exclusivamente el Studio**
(Subir → Crear / editar Experiencia). Todo apagado al cierre.

## 3. Cambios v1 → v2 (borrador creado solo con el Studio)

Desde la v1 publicada, el botón «Crear nueva versión» de la pestaña Ruta produjo la
copia editable v2 (`expv-1787186260534-lsl8ft`) en un clic, con ids de nodo estables
(n1–n10). Cambios representativos aplicados y verificados en el store:

| # | Cambio pedido | Qué se hizo | Verificado |
|---|---|---|---|
| 1 | Información general y duración | Descripción marcada como borrador de prueba; duración «3 sesiones» → «4 sesiones (~90 min cada una)» | ✔ (ver nota §6-F1: vive en `Experience`, no en la versión) |
| 2 | Reordenar un nodo | Módulo 1: AUDIO (n2) subido por encima de READING (n1) con el botón ↑ accesible | ✔ orden n2,n1,n3 en el draft |
| 3 | Referencia canónica de lectura | n1: `pilot-texto-fundamentos-…` → `content-1778097541576` (La guerra de los mundos) vía Bandeja de recursos; título del paso actualizado a mano | ✔ `resourceRef` por contentId |
| 4 | Nodo LEO | n5: objetivo y semilla reescritos, `minIntercambios` 3 → 2 | ✔ en config del draft |
| 5 | Actividad | n6: pregunta 1 reescrita + tercera pregunta añadida («+ Añadir pregunta») | ✔ 3 preguntas |
| 6 | Producción | n10: consigna reescrita, rango 120–350 → 100–250 palabras | ✔ min 100 / max 250 |
| 7 | Añadir y eliminar nodo de prueba | ACTIVITY «NODO DE PRUEBA…» añadido al módulo 3, guardado, y eliminado con confirmación inline «¿Eliminar paso? Sí/No»; segundo guardado | ✔ draft final = 10 nodos |
| 8 | Módulos y títulos | Título del módulo 3 editado inline: «Evidencia y responsabilidad (título editado en v2)» | ✔ en el draft |

**Transcripción (regla de la unidad):** no se modificó ninguna transcripción sin su
audio. Se verificó que el campo «Transcripción / alternativa textual» del nodo AUDIO
es un textarea editable (edición y reversión inmediata en la misma sesión de foco,
sin persistir). Sobre la validación ver §6-M1.

## 4. Invariantes demostradas

Metodología: extracción determinista de los registros (`experience`, `version v1`,
`run pineado`) de `mook_db.json` con serialización estable + SHA-256, en 4 puntos
(baseline, tras ediciones, tras preview, final).

| Invariante | Evidencia |
|---|---|
| **v1 byte a byte inmutable** | Registro `expv-1787164160889-vf9lj2` con hash `eff6b4d0…f408` idéntico en los 4 snapshots, a través de creación de v2, 8 ediciones, 2 guardados, preview y eliminación de nodo |
| **Runs de v1 siguen pineados** | `run-1787164749362-xynj6j` (demo-lector) byte-idéntico y `experienceVersionId` = v1 en todos los snapshots; `GET /api/experiences/:id` como demo-lector sirve `version: 1` (el draft v2 es invisible al participante) |
| **v2 cambia libremente sin afectar v1** | 8 cambios estructurales en v2; hash de v1 inalterado |
| **Preview refleja v2** | Vista previa mostró: AUDIO primero, «La guerra de los mundos» con su carátula canónica, módulo 3 renombrado, nodo de prueba, 11 pasos |
| **Preview no crea runs, evidencia ni eventos** | Durante todo el preview (incl. clic en «Terminé esta lectura», rechazado con mensaje textual «Vista previa — nada de lo que hagas aquí se guarda»): red = 1 GET de imagen, **cero** llamadas `/api`; hash de `mook_db.json` idéntico pre/post; `events.db` 2350 → 2350 filas; runs 4 → 4, evidencia 7 → 7 |
| **Recargar no pierde el borrador** | Recarga completa del navegador + navegación de vuelta al Studio: badge «borrador v2 en edición» y todas las ediciones presentes (persistencia server-side del draft) |
| **Recursos por `contentId`** | Todos los `resourceRef` del draft son contentIds del catálogo canónico; la validación rechaza referencias inexistentes (`RESOURCE_NOT_FOUND`) |
| **Sin segunda persistencia ni renderer paralelo** | Studio importa `NodeShell` desde `pages/Experiencias` (Runtime real) con prop `preview` y run sintético en memoria (`runId:'preview'`); persistencia única en `experienceStore` → `mook_db.json` vía rutas admin existentes |

**Validación de configuración incompleta** (empírico, sin tocar v2): POST de un
draft con ACTIVITY sin preguntas → HTTP 400 y `mook_db.json` intacto (la frontera
`validateNode`/`buildModules` corre en save Y en publish; una versión incompleta no
llega ni a guardarse). `publishVersion` solo acepta drafts y congela al publicar.

**Estado final:** v2 = `DRAFT` (10 nodos, 3 módulos). **No se publicó** ni se
reemplazó v1. Pestaña Publicación verificada: muestra «Versión publicada: v1 ·
Borrador en edición: v2» y explica el pinning en texto claro.

## 5. Evaluación de articulación (experiencia de autor)

Lo que funciona bien:

- **Versionar es trivial**: aviso de inmutabilidad + «Crear nueva versión» en el
  punto exacto donde el autor intenta editar; copia editable instantánea.
- **Combinar tipos es directo**: 6 botones «+ Añadir paso» por módulo; la plantilla
  Leer → Conversar → Producir se declara como guía, no como requisito.
- **Reordenar**: ↑/↓ accesibles por nodo y por módulo, con estados deshabilitados
  correctos en los extremos; eliminación con confirmación inline de 2 pasos.
- **Contenido vs. nodo se entiende**: el nodo tiene título/instrucciones/config
  propios; el contenido es una tarjeta de referencia con «Cambiar» que abre la
  Bandeja de recursos (chips «Para Experiencias» y «Listo», y «+ Crear contenido»
  que promete conservar el borrador).
- **Estados con texto siempre** (Guardado ✓ / Cambios sin guardar / borrador v2 en
  edición / Bloqueado / Pendiente), consistente con la UX congelada.
- **Amplitud real del modelo**: con los mismos 6 tipos y módulos libres se pueden
  ensamblar rutas muy distintas (la v2 ya mezcla libro de catálogo general +
  material «Para Experiencias» + audio + Leo + actividades + producción).
- **Móvil 390 px**: home del Studio, editor, Ruta y editores de nodo usables; los
  controles de nodo pasan a fila propia con buen tamaño táctil.

## 6. Hallazgos clasificados

**BLOQUEO:** ninguno.

**FRICCIÓN**

- **F1 — La Información general no es versionada y se publica de facto al guardar
  el borrador.** `title/description/durationLabel/audience/imageUrl` viven en
  `Experience` (decisión documentada de STUDIO-01: solo objetivos+módulos son de la
  versión). Consecuencia observada: al guardar el «borrador» v2, la landing de v1
  ya sirve «4 sesiones (~90 min cada una)» al participante, sin paso de publicación.
  El único aviso es el hint del campo objetivo («se guarda con la versión de la
  ruta»), por contraste. Candidata prioritaria si se itera el Studio: aviso
  explícito en la pestaña Información de una experiencia publicada.
- **F2 — Cambiar la referencia canónica no toca el título del paso**: quedó
  «Leer: Bienvenida y fundamentos…» apuntando a La guerra de los mundos hasta
  edición manual. Sugerir/preguntar el título al cambiar recurso evitaría rutas
  incoherentes.
- **F3 — «Guardar borrador» queda fuera de vista** al editar nodos al fondo de la
  ruta; hay que volver arriba (el estado «Cambios sin guardar» tampoco se ve).
  Un guardado sticky o flotante reduciría idas y vueltas.
- **F4 — Móvil: las acciones de la tabla del Studio (Editar/Preview) quedan tras
  scroll horizontal** del contenedor; funcional pero fácil de no descubrir.

**MEJORA OPCIONAL**

- **M1 — La transcripción de AUDIO/VIDEO no es requisito de publicación en código**:
  el campo existe y es editable, y la validación estructural (recurso, preguntas,
  consigna, objetivo LEO) sí bloquea guardar/publicar incompleto, pero la regla ADR
  §17.4 (transcripción obligatoria para publicar el piloto) hoy se cumple
  editorialmente, no por gate técnico.
- **M2 — Los drafts exigen completitud estructural también al guardar** (un READING
  sin recurso no se puede guardar). Robusto, pero impide «guardar a medias»; si la
  autoría real lo pide, separar validación de guardado y de publicación.
- **M3 — El título de módulo en móvil se recorta visualmente** (input estrecho);
  el botón flotante de Leo roza el borde de algunos campos en 390 px.

No se implementó ninguna mejora: diagnóstico primero, como pide la unidad.

## 7. Lo probado, con precisión

QA de autoría en desktop (958 px) y móvil (iframe same-origin 390×844, media
queries reales): home del Studio, editor (4 pestañas), creación de v2, los 8
cambios de §3, guardado y re-apertura tras recarga, preview completo con auditoría
de red, eliminación confirmada del nodo de prueba, pestaña Publicación (sin
publicar). Verificación server-side por snapshots hasheados de `mook_db.json` y
conteo de `events.db`. No se repitió el E2E de 3 actores ni las suites (GREEN en
REVIEW-01/PILOT-01); **cero cambios de código**, por lo que no se ejecutaron tests.

## 8. Próximos experimentos recomendados

1. **Segunda experiencia deliberadamente distinta** (p. ej. club lector escolar:
   VIDEO+libro de catálogo, sin producción final, actividades opcionales, 1 módulo)
   para probar la amplitud del modelo fuera del patrón inducción — es el camino que
   la propia unidad deja abierto y el prototipo ya lo soporta sin cambios.
2. Si se itera el Studio primero: F1 (aviso de info general en publicadas) y F2
   (título sugerido al cambiar recurso) son las dos de mejor relación costo/valor.
3. Cuando toque publicar de verdad: decidir M1 (gate técnico de transcripción)
   antes del preflight de liberación del piloto.

Sin deploy, sin aprobación editorial, sin preflight: fuera del alcance declarado.
