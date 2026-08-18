# CHP-MOOK-RUNTIME-01 — Runtime de participante V4 (implementación + validación visual)

Fecha: 2026-08-18 · Rama: `chp/mook-contract-00` · Estado: **GREEN** · Sin deploy (local only)

## A. Contexto

Cuarta unidad del frente MOOK/Experiencias, sobre el contrato V4 (`CHP_ADR_MOOK.md` §16,
`CHP_MOOK_V4_REALIGN_01.md`) y la congelación de UX (`CHP_MOOK_PRODUCT_UX_01.md`).
Implementa el runtime de participante conforme a la UX congelada, con gate de
validación visual obligatorio. No toca Studio, Review ni piloto de campo.

## B. Objetivo

Que un lector recorra una Experiencia publicada de punta a punta desde Biblioteca:
destacada → landing → ruta por módulos con nodo actual expandido → producción →
cierre → reanudación, con estados siempre textuales y accesibles.

## C. Alcance y no-alcance

- SÍ: superficie de participante (Biblioteca → Experiencias, landing, ruta, cierre),
  únicas adiciones backend autorizadas por la unidad (campos `imageUrl` /
  `durationLabel` / `audience` en Experience + `myRun` en listado/detalle).
- NO: Studio (STUDIO-01), cola de revisión en Aula Viva (REVIEW-01), deploy,
  cambios de autenticación, entidades nuevas.

## D. Cambios backend (mínimos y localizados)

- `server/lib/experienceStore.js`:
  - `createExperience` acepta `imageUrl`/`durationLabel`/`audience` (opcionales).
  - `listPublished` expone esos campos + `nodeTypes` + `hasProduction`.
  - NUEVO `listPublishedFor(doc, userId)`: listado con `myRun` (runId, status,
    progress, moduleStates derivados) — resumen, jamás estado persistido nuevo.
  - NUEVO `experienceDetail(doc, experienceId, userId)`: landing completa
    (objetivos, módulos, tipos, producción, myRun) **sin crear run**; lanza
    `NOT_PUBLISHED` si no corresponde.
- `server/server.js` (bloque CHP-MOOK):
  - `GET /api/experiences` ahora responde `listPublishedFor(doc, req.user.id)`.
  - NUEVO `GET /api/experiences/:id` (landing; `requireUserAuth`; no crea run).
  - Sin canales de identidad nuevos: actor = `req.user.id` en todas las rutas.

## E. Cambios frontend

- `pages/Experiencias.tsx` — reescrito para el flujo V4:
  landing (auto-entra a ruta solo si `myRun.status === 'active'`), `NodeShell`
  (breadcrumb «Experiencia · Módulo», consigna, tarjeta de recurso con mensaje de
  bloqueo por preflight, acciones por tipo, estados de evidencia/revisión, aria),
  `NodeRow` compacto, `ProgressBar` con `role=progressbar`, secciones por módulo
  con chips Completado/En curso/Por iniciar, pantalla de cierre (resumen por
  módulo, estado de producción, CTAs), auto-scroll al nodo actual. La vista
  `/experiencias` sin id queda como listado técnico + pestaña Revisión (interina
  hasta REVIEW-01).
- `pages/Biblioteca.tsx` — pestaña Experiencias V4: destacada con imagen,
  duración, barra de progreso `myRun`, chips de módulos y CTA
  Iniciar/Continuar/Ver recorrido según estado.
- `services/dataService.ts` — `getExperienceDetail` nuevo; resto de métodos MOOK
  ya existentes, todos `credentials:'include'`.
- `scripts/mook/seedPilotExperience.mjs` — piloto con `imageUrl`/`durationLabel`/
  `audience` y flag `--book` para dev local (catálogo local no tiene el libro prod).

## F. Tests

`npm run test:mook` — 31/31 GREEN:
- `experienceStore.test.mjs` 15 (contrato base intacto)
- `mookV4Realign.test.mjs` 11 (V4 intacto)
- `mookRuntime01.test.mjs` 5 (NUEVO): campos V4 + `myRun=null` sin run; `myRun`
  con progress/moduleStates + aislamiento entre usuarios; `experienceDetail` no
  crea run; reanudación (nodo current = primer requerido incompleto); completed
  reflejado en listado y detalle.

Gates: typecheck baseline sin regresiones (14 = baseline); `vite build` GREEN;
`node --check server/server.js` OK.

## G. Entorno local de validación (workaround Windows)

El frontend es cookie-only (DEPLOY-C) y `secretFile.js` es POSIX fail-closed
(sin `O_NOFOLLOW`/`getuid` ⇒ `READ_FAILED`): **compat es imposible en Windows**,
y Docker Desktop no estaba disponible. Solución sin tocar el repo:

- Backend en modo OFF en `:3010` con padrón fixture sintético local
  (`data-critical/usuarios_colegios_oro.json`, generado por script de scratchpad;
  ignorado por git — regla explícita en `.gitignore`).
- Micro-proxy de scratchpad en `:3000` (target hardcodeado de `vite.config.ts`)
  que inyecta `x-user-id: user-tono` — reproduce el contrato dev histórico
  (OFF + header). Cero contraseñas, cero secretos impresos, solo `127.0.0.1`.
- 3 interacciones Leo sintéticas en `data/leo_interactions_db.json` (dev-local)
  para poder superar el nodo LEO sin consumir IA.

Todo el entorno (backend, proxy, vite) fue apagado al cierre de la unidad.

## H. Validación visual (sección Y) — evidencia

Las 9 superficies mandatadas, verificadas en Chrome contra el entorno local:

1. **Biblioteca → Experiencias**: pestaña visible junto a Libros; catálogo intacto.
2. **Destacada**: título, descripción, «2–3 sesiones de ~25 min · 2 módulos ·
   5 pasos»; sin run CTA «Iniciar ruta →»; con run completado barra 4/4 + chips
   «Leer y conversar — Completado» / «Pensar y producir — Completado» + CTA
   «Ver recorrido →».
3. **Landing**: «Qué propone», audiencia «Secundaria (12–16)», duración, chips de
   tipos (Lectura/Conversación con Leo/Actividad/Producción), aviso de producción
   revisada por mediador, resumen de módulos, CTA; **no crea run**.
4. **Ruta con varios módulos**: 2 módulos con chips de estado; nodos futuros con
   candado + «Bloqueado».
5. **Nodo actual (NodeShell)**: breadcrumb, consigna, tarjeta del libro con
   portada, «Estás aquí», acciones por tipo.
6. **Parcialmente completado**: 1/4 y 2/4 con barra; módulo 1 pasa Por iniciar →
   En curso → Completado; nodos completados colapsan con check.
7. **Producción**: consigna 150–300 palabras, criterio de revisión visible,
   contador de palabras, envío OK.
8. **Cierre**: «Experiencia completada», resumen por módulo, «Tu producción:
   Pendiente de revisión por tu mediador», CTAs Volver a Biblioteca / Revisar
   recorrido (toggle a Ocultar recorrido); recorrido 4/4 visible bajo el cierre;
   el nodo opcional de cierre sigue accesible tras completar.
9. **Mobile (390px)**: bottom-nav, chips desplazables, destacada/landing/cierre
   apilados sin overflow horizontal. (La ventana no aceptó resize programático;
   se validó con iframe same-origin de 390px — media queries reales.)

Estados de error textuales y persistentes (no toasts) verificados:
- LEO sin conversación: «el nodo LEO exige ≥3 intercambios (lleva 0)».
- Actividad incompleta: «responde las 3 preguntas».

## I. Hallazgos y correcciones durante el gate

- **Corregido** (`pages/Experiencias.tsx`): el CTA de la landing con run
  completado decía «Continuar experiencia»; ahora distingue `completed` →
  «Ver recorrido». Revalidado en carga limpia.
- **No-bug**: header «0/4 completados» con «5 pasos» — el denominador cuenta solo
  requeridos (el nodo de cierre del piloto es `required:false`). Contrato de
  dominio correcto; conviene vigilar la comprensión en piloto real.
- **Nit aceptado**: CTA «Abrir conversación con leo» con «leo» en minúscula.
- **Dev-only**: la imagen hero del seed apunta a la portada del libro de prod
  (inexistente en local) — el gradiente cubre el hueco; en prod el asset existe.

## J. Riesgos y deuda

- La pestaña «Revisión» técnica en `/experiencias` es interina; REVIEW-01 la
  traslada a Aula Viva.
- Emisión de eventos experience sigue dormant (`EXPERIENCE_EVENTS_BACKBONE_ENABLED` off).
- En OFF local, los eventos de instrumentación caen en el guard session-only
  (esperado; sin efecto en prod).

## K. Gate AB — veredicto

Los 18 criterios del gate se satisfacen: flujo completo sin conocimiento previo,
estados textuales, sin creación de run en landing, reanudación derivada, módulos
con estado derivado, producción con criterio visible, cierre con estado de
revisión, accesibilidad básica (aria-label en progreso/módulos/acciones), mobile
sin overflow, backend solo con las adiciones autorizadas, actor único
`req.user.id`, suites 31/31, typecheck baseline, build GREEN, sin deploy.

**Veredicto: GREEN.**

## L. Suficiencia del handoff para CHP-MOOK-STUDIO-01

El handoff congelado en `CHP_MOOK_PRODUCT_UX_01.md` **sigue siendo suficiente**.
Runtime no reveló ningún dato estrictamente necesario nuevo. Único matiz
informativo (no bloqueante): `myRun.status`/`moduleStates` ya viajan en
listado/detalle, por lo que Studio no necesita endpoint adicional para
previsualizar estados; y el denominador de progreso cuenta solo nodos
requeridos, cosa que Studio debe mostrar al autor al marcar `required:false`.

## M. Limpieza

Backend OFF (:3010), proxy dev (:3000) y vite (:5173) detenidos; puertos
verificados libres. Pestaña de navegador cerrada. Fixtures dev locales
(`usuarios_colegios_oro.json` sintético, interacciones Leo, `mook_db.json`)
permanecen fuera de git por reglas de `.gitignore`.

## N. Próximo paso

DETENER. Siguiente unidad bajo instrucción explícita: CHP-MOOK-STUDIO-01 →
REVIEW-01 → PILOT-01.
