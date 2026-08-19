# CHP-MOOK-STUDIO-01 — Studio de autoría de Experiencias (local, sin deploy)

Fecha: 2026-08-19. Tipo: implementación frontend/product del Studio MVP sobre el modelo, APIs, runtime y UX ya existentes (contrato `docs/adr/CHP_ADR_MOOK.md` §17; UX congelada `docs/product/CHP_MOOK_PRODUCT_UX_01.md` §C1–C13). Cero cambios productivos; cero migraciones; los seis eventos siguen dormant.

---

## A. Veredicto

**GREEN-MOOK-STUDIO** — Studio funcional de extremo a extremo en local: crear → información → ruta (módulos/nodos, 6 tipos) → guardar borrador → previsualizar sin contaminar → publicar (inmutable) → nueva versión → archivar (no destructivo). 43/43 tests MOOK, typecheck baseline exacto, build GREEN, QA visual desktop + móvil 390px.

## B. Funcionalidad construida

- **Entrada (C1/C2):** cuarta acción «Crear / editar Experiencia» en el chooser de `Subir`; home del Studio con tabla (título · estado Borrador/Publicada/Archivada con texto · versión · última edición · Editar/Previsualizar/Archivar) + «Nueva Experiencia». Sin administración paralela, sin navbar nuevo.
- **Información (C4):** título* · descripción · objetivo (viaja con la versión) · ilustración (URL) · duración · audiencia. Validación por campo (`aria-invalid`/`aria-describedby`/`role=alert`), estados Guardando…/Guardado ✓/Cambios sin guardar (`aria-live`), prevención de pérdida = `beforeunload` + confirmación inline al salir con cambios (patrón mínimo; sin autosave, conforme UX).
- **Ruta (C5/C6/C10):** módulos → nodos embebidos; añadir/editar/eliminar-con-confirmación-inline/reordenar con botones `↑/↓` accesibles (aria-labels; drag no implementado — el UX lo declara opcional y los botones son la alternativa obligatoria y suficiente). Editores mínimos por tipo con los enums reales `READING|VIDEO|AUDIO|LEO|ACTIVITY|PRODUCTION`, requisito de terminación mostrado por tipo, requerido/opcional.
- **Bandeja de recursos (C7/C8):** modal sobre `getContenidos` (catálogo canónico único, síncrono), búsqueda por título + filtro por tipo, chip «Para Experiencias» (`standalone:false`), estado Listo/No disponible, selección = SOLO `contentId` (cero copia de metadata), foco inicial + Escape + retorno de foco. «Crear contenido» salta al flujo `new` de Subir conservando el borrador (el Studio queda montado oculto).
- **Checkbox C9 en Subir:** «Contenido para una Experiencia» (default desmarcado, helper visible, `aria-describedby`) → persiste `standalone:false`; chip en el gestor. La palabra `standalone` no aparece en UI.
- **Leo (ADR §17.6):** editor con objetivo/semilla/mínimo de intercambios/lectura asociada opcional + **aviso de IA** en la configuración; el MISMO aviso quedó cableado en el `NodeShell` del runtime (visible en runtime real y en preview) — **cierra el pendiente de PILOT-01 declarado en el closure**.
- **Vista previa (C11):** el Runtime REAL (`NodeShell`/`NodeRow`/`ProgressBar` exportados de `pages/Experiencias.tsx`) con prop `preview` que anula mutaciones; banner fijo `role=status` «▲ Vista previa — nada de lo que hagas aquí se guarda» + navegación de paso ◄ n/m ►. Ruta virtual computada en el cliente desde el borrador. **Verificado por red: 0 requests a `/api/experiences` al pulsar acciones de completitud/envío**; el aviso local sustituye la acción. Sin segundo renderer.
- **Lifecycle (C12, colapso MVP §17.3):** publicar con confirmación (texto congelado C12) → publicada INMUTABLE (ruta en solo-lectura con banner + «Crear nueva versión»); nueva versión = copia editable v+1 (draft); archivar con confirmación explícita del no-borrado. `IN_REVIEW`/`APPROVED` NO se simularon (sin backend, conforme al mandato).
- **C13:** guard server-side en `DELETE /api/content/:id` — 409 con lista `usedBy` si una versión PUBLICADA referencia el contenido; el cliente propaga el mensaje con la lista («ver dónde se usa» mínimo).

## C. Backend aditivo (el mínimo que el listado/edición de autoría exigía)

- `experienceStore.js`: `updateExperience` (información general; archivada no se edita), `archiveExperience` (no destructivo: versiones/runs/evidencia intactos, runs activos terminan; sin unarchive), `adminListExperiences`, `adminExperienceDetail`; guards `EXPERIENCE_ARCHIVED` en `createDraftVersion`/`publishVersion`.
- Rutas: `GET /api/experiences/admin/list` y `GET /api/experiences/admin/:id` (patrón del review-queue: `requireUserAuth` + **rol administrador explícito** — los borradores no son legibles por cualquier sesión; registradas ANTES de `/:id`); `PUT /api/experiences/:id` y `POST /api/experiences/:id/archive` (`requireAdminAccess` canónico). Nueva versión desde publicada usa el `POST /:id/versions` EXISTENTE (copia client-side).
- `mookErrStatus`: +`EXPERIENCE_ARCHIVED`/`ALREADY_ARCHIVED` → 409.

Decisión documentada: la **información general** de la Experiencia (título/descr/imagen/duración/audiencia) es editable también en estado publicada — la inmutabilidad contractual (§4/§17.3) cubre `objectives+modules` de la VERSIÓN, no los metadatos descriptivos de la entidad.

## D. Archivos

| Archivo | Cambio |
|---|---|
| `components/studio/ExperienceStudio.tsx` | **nuevo** — Studio completo (home, tabs, editor de ruta, ContentPicker, preview, publicación) |
| `pages/SubirContenido.tsx` | 4ª acción del chooser; Studio montado fuera del `<form>` (Enter no dispara el submit del ecosistema) y persistente tras abrirse (C8); submit/Materiales ocultos en modo experiencia; checkbox C9 + chip en manage; mensaje C13 en eliminar |
| `pages/Experiencias.tsx` | exporta `NodeShell/NodeRow/ProgressBar/NODE_ICON/NODE_TYPE_LABEL`; prop `preview` (mutaciones anuladas); aviso de IA en nodo LEO |
| `server/lib/experienceStore.js` | funciones aditivas de autoría (arriba) |
| `server/server.js` | 4 rutas de autoría + guard C13 en DELETE content |
| `services/dataService.ts` | 8 métodos `*Studio*` (cookie-only) + propagación del 409 C13 |
| `types/index.ts` | `Content.standalone?: boolean` |
| `server/__test__/mookStudio01.test.mjs` | **nuevo** — 12 tests |
| `package.json` | `test:mook` incluye la suite nueva |

## E. Tests y build

- `npm run test:mook` = **43/43** (15 experienceStore + 11 V4 + 5 runtime + **12 studio**): creación+edición info, seis tipos, referencia sin duplicación, reorden persistido, validaciones por tipo, publicada inmutable (y info editable), v2 desde publicada con **pin de run intacto**, archivo no destructivo (run activo termina; sin re-publicar), vistas admin sin crear runs, estructurales (bundles legacy intactos, guards de rol y orden de rutas, C13 presente).
- `test:library` 17/17 y `test:metric-contract` GREEN (vecindad tocada por server.js).
- `typecheck:baseline` = sin regresiones (current == baseline). `npm run build` GREEN.

## F. QA visual local (workaround RUNTIME-01)

Compat local imposible (secretFile POSIX) → backend `PORT=3010` en modo off (**con `USERS_DB` apuntando explícitamente al fixture `data-critical/usuarios_colegios_oro.json` — el `.env` local apunta al padrón legacy y el guard canónico aborta**) + micro-proxy scratchpad `:3000→:3010` inyectando `x-user-id: admin-super-1` + Vite 5173. Cero datos productivos; la experiencia de QA quedó archivada y el store local es gitignored.

Validado con Chrome real: 4ª tarjeta y checkbox C9 con helper · home del Studio (tabla, estados, acciones) · validación con error por campo y foco · información completa por teclado (Tab entre campos) · módulo+nodos de los tipos READING/LEO/ACTIVITY/PRODUCTION creados por UI (VIDEO/AUDIO cubiertos por editor+tests; sin pieza de video en el catálogo dev) · picker con búsqueda/selección/chip · reorden ↑/↓ (subir y bajar, orden persistido al guardar) · eliminar con confirmación inline (Sí/No) · guardar → «Guardado ✓» + «borrador v1 en edición» · **preview con banner, paso 1/4→2/4, aviso de IA en LEO, candados, y 0 mutaciones de red** · publicación con confirmación C12 → Publicada v1 inmutable (ruta solo-lectura) · «Crear nueva versión (copia editable v2)» → v2 draft editable con v1 intacta y visible al participante (`GET /api/experiences` la proyecta) · archivo con confirmación → desaparece del descubrimiento, autoría conserva `pub v1 + draft v2` · «Paquetes (legacy)» intacta con sus bundles y misma URL · **móvil 390px** (iframe same-origin): home usable (tabla scrollea en su contenedor), editor de ruta plenamente operable con ↑/↓, tabs con wrap, sin scroll horizontal de página.

Accesibilidad probada (exactamente esto, sin declarar WCAG completa): flujo por teclado en Información y foco visible; labels reales en todos los campos del Studio (incl. preguntas como `<label>`); errores asociados y anunciados; confirmaciones como botones con nombre; `↑/↓` con aria-label por elemento; estados siempre con texto; `role=progressbar` reutilizado; banner de preview `role=status`; modal del picker con foco inicial, Escape y retorno de foco. **No probado:** lectores de pantalla reales, contraste medido, zoom 200%, focus-trap estricto del modal (el foco puede salir con Tab — anotado como pulido).

## G. Límites y gates

- Revisión (`REVIEW-01`), asignación institucional, contenidos del piloto: NO implementados (fuera de alcance).
- `IN_REVIEW`/`APPROVED` sin backend → no simulados; llegan cuando autor ≠ aprobador.
- Transcripción VIDEO/AUDIO: campo + aviso «Pendiente»; la publicación del piloto exige transcripción (gate PILOT-01, no forzado aquí porque esta unidad no crea contenidos).
- Retorno C8 completo (reabrir selector con la pieza nueva arriba tras publicar) simplificado: el borrador se conserva (montaje persistente) y el catálogo se relee al reabrir el picker; el salto de vuelta es manual.
- Upload de ilustración de la Experiencia: por URL (sin uploader UGC nuevo).
- Eventos dormant intactos (`EXPERIENCE_EVENTS_BACKBONE_ENABLED` OFF); anti-spoofing duro sigue gateado por M1-A enforce.

## H. Rollback local

`git revert` del commit de esta unidad (un solo commit, aditivo). Los stores de datos no cambian de esquema: las funciones nuevas no alteran documentos existentes (archivo añade `status/archivedAt`; nada se borra). El Studio desaparece del chooser al revertir; runtime y legacy quedan como antes.

## I. Próximo paso

`CHP-MOOK-REVIEW-01` (pestaña Producciones en Aula Viva, D1–D4), bajo orden explícita.
