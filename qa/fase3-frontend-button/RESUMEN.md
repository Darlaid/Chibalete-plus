# Fase 3 — Botón real "Disponible sin conexión" · QA y resumen técnico

**Fecha:** 2026-05-26
**Estado:** ✅ PASS — listo para Fase 4 (Chibalete LU consume el assignment).

## Archivos modificados / nuevos

| Archivo | Tipo | Notas |
|---|---|---|
| `utils/offlineAssignmentClient.ts` | **Nuevo** | Cliente HTTP: `getOfflineAssignment`, `assignOfflineBook`, `deleteOfflineAssignment`, helper `isActiveAssignment`. Errores tipados (`OfflineAssignmentError` con `reason` discriminada). Usa `dataService.getSessionUserId()` y `dataService.apiUrl` para reusar auth existente. |
| `pages/PaginaDetalleLibro.tsx` | **Modificado** | Reemplazada lógica `offlineTextCache`/`saveOfflineText` por client backend. Nuevos estados UI: `idle`/`loading`/`assigned_current`/`assigned_other`/`error`/`unauthenticated`. Confirmación `window.confirm` antes de reemplazar libro previo. Copy reorientado a "Chibalete LU". |
| `components/ContentCard.tsx` | **Modificado (neutralización)** | Badge "Disponible sin conexión" desactivado (`{false && ...}` con comentario explicando el porqué). El badge antiguo leía de `OfflineContext` (IndexedDB local, hasta 3 PDFs) — sistema paralelo desincronizado del assignment backend. `useOffline()` se mantiene importado/llamado para no romper `Biblioteca.tsx`. |

## Lo NO tocado (preservado por seguridad)

| Archivo | Razón |
|---|---|
| `utils/offlineTextCache.ts` | Sigue usado por `VisorTexto.tsx` como cache de lectura web (network failure → leer del último libro cacheado). No es fuente de verdad del assignment. |
| `context/OfflineContext.tsx`, `services/offlineService.ts` | IndexedDB de PDFs, `DOWNLOAD_LIMIT=3`. Consumido por `Biblioteca.tsx` (lectura `downloadedContent`) y `ContentCard.tsx` (vía `isDownloaded`). El `downloadBook` no se invoca desde UI activa hoy. **Deuda planificada para limpieza completa en Fase 4/5** — eliminar implicaría tocar Biblioteca y validar todos los flujos. |
| `pages/VisorTexto.tsx` | `saveOfflineText`/`getOfflineText` siguen como fallback offline de lectura web. No es verdad del assignment. |
| Modos inmersivo/guiado/accesible/pdf/álbum | Sin cambios. |
| Sesión, login, permisos, catálogo | Sin cambios. |

## Contrato del cliente

```typescript
import {
  getOfflineAssignment,        // GET /api/offline/assignment
  assignOfflineBook,           // POST /api/offline/assignment {contentId}
  deleteOfflineAssignment,     // DELETE /api/offline/assignment
  isActiveAssignment,          // type guard sobre la respuesta de GET
  OfflineAssignmentError,      // Error tipado
  type OfflineAssignment,      // {contentId, version, assignedAt, book, progress, ...}
} from '../utils/offlineAssignmentClient';
```

`OfflineAssignmentError.reason` mapea status HTTP a:
- `unauthenticated` (401)
- `forbidden_user` (403 cuenta inactiva/no encontrada)
- `forbidden_content` (403 sin acceso al libro)
- `content_not_found` (404)
- `invalid_body` (400)
- `network` (sin red / fetch threw)
- `server` (5xx)
- `unknown` (otro)

## Estados visuales del botón

| Estado | UI |
|---|---|
| `loading` | "Asignando…" + spinner |
| `assigned_current` | "Asignado para Chibalete LU" (chip verde + ✓) |
| `assigned_other` | "Reemplazar libro de Chibalete LU" (botón ámbar). Click → `window.confirm` con título del libro previo + título nuevo. |
| `unauthenticated` | "Iniciá sesión para enviar a Chibalete LU" (chip neutral) |
| `error` | "Reintentar" + mensaje breve (rojo, accionable) |
| `idle` | "Preparar para Chibalete LU" (botón neutral + 📱) |

Copy reorientado para evitar confusión "offline web" vs "offline LU": **el botón ya no dice "Disponible sin conexión"**, dice "Preparar para Chibalete LU" / "Asignado para Chibalete LU".

## Mapa de lógica offline encontrada (audit Fase 3)

| Componente | Antes (estado real) | Después de Fase 3 |
|---|---|---|
| Botón en `PaginaDetalleLibro` | escribía a `localStorage['chibalete_offline_texto']` vía `saveOfflineText` | hace `POST /api/offline/assignment`; NO escribe localStorage |
| Badge en `ContentCard` | leía de `OfflineContext.isDownloaded` (IndexedDB) — sistema paralelo, nunca encendido en UI activa | **desactivado** (deuda planificada para Fase 4) |
| `OfflineContext` + `offlineService` | IndexedDB, `DOWNLOAD_LIMIT=3` para PDFs | sin cambios, sin uso activo (código muerto encapsulado) |
| `offlineTextCache` | localStorage con 1 entrada de texto, usado por VisorTexto como cache de lectura | sin cambios — no es fuente de verdad del assignment |
| `VisorTexto` lectura offline | lee `getOfflineText(contentId, lang)` si red falla | sin cambios (cache de lectura web, no compromete invariante de 1 libro) |

## Pruebas ejecutadas (13/13 ✅)

Script: `qa/fase3-frontend-button/sim-frontend-flow.mjs`
Ejecuta exactamente las mismas llamadas que el cliente del navegador (mismo body, mismos headers, mismo endpoint).

| # | Caso | Resultado |
|---|---|---|
| 1 | Usuario sin assignment → GET → `{"assignment": null}` (estado `idle`) | ✅ |
| 2 | Click "Preparar para Chibalete LU" → POST BOOK_1 → version=1, book metadata completa | ✅ |
| 3 | Recargar página → GET refleja assignment real (estado `assigned_current`) | ✅ |
| 4 | Reemplazo (BOOK_2) → version++ a 2, nuevo assignedAt | ✅ |
| 5 | Mismo libro (idempotencia) → version PRESERVADA en 2 | ✅ |
| 6 | contentId inexistente → 404 con `reason=content_not_found` (mapeado a `error`) | ✅ |
| 7 | Body inválido (sin contentId) → 400 con detalles Zod (mapeado a `invalid_body`) | ✅ |
| 8 | Sin x-user-id → 401 (mapeado a `unauthenticated`) | ✅ |
| 9 | Aislamiento A/B → GET A devuelve BOOK_1, GET B devuelve BOOK_2 | ✅ (2 checks) |
| 10 | DELETE idempotente: `removed=true` la 1ra, `removed=false` la 2da, GET → null | ✅ (3 checks) |

Adicionalmente:
- **TypeScript:** `tsc --noEmit` reporta **0 errores en mis archivos** (`offlineAssignmentClient.ts`, `PaginaDetalleLibro.tsx`, `ContentCard.tsx`). Los 38 errores TS pre-existentes en `_prod_snapshot_`, `AulaViva.tsx`, `dataService.ts` etc. **no son regresión** de esta fase.
- **No-localStorage assertion:** `handleAssignToLU` no llama `saveOfflineText`, no escribe a `localStorage` ni a IndexedDB. Solo invoca `assignOfflineBook(content.id)` que hace `fetch(POST)`.
- **No-download assertion:** El bundle ya no hace `fetch(content.texto_plano_url)` en el handler del botón. El texto del libro NO se descarga en Chibalete+ cuando se asigna a LU.

## Criterios de aceptación

| Criterio | Estado |
|---|---|
| El botón ya no guarda offline en frontend web | ✅ |
| El botón asigna un único libro mediante backend | ✅ (POST atómico) |
| El estado visual se basa en GET /api/offline/assignment | ✅ |
| El reemplazo de libro está confirmado por el usuario | ✅ (`window.confirm` con título previo) |
| No hay dependencia de localStorage como verdad | ✅ (`offlineTextCache` solo cache de lectura web) |
| Chibalete+ queda listo para que LU consuma el assignment | ✅ |

## Riesgos

| ID | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R-1 | `OfflineContext` con `DOWNLOAD_LIMIT=3` sigue vivo (sin uso activo). Si un futuro dev cablea `downloadBook` desde algún botón, reintroduce el sistema paralelo. | Media | Documentado en código (`ContentCard.tsx`) + en este RESUMEN. Limpieza completa = Fase 4. |
| R-2 | `Biblioteca.tsx` consume `useOffline().downloadedContent` y `ContentCard` consume `isDownloaded`. Si IndexedDB tiene datos viejos en clientes existentes, lecturas siguen retornando arrays no vacíos. El badge en `ContentCard` está desactivado, pero `Biblioteca` podría todavía mostrar una sección "descargados" basada en datos huérfanos. | Baja | Verificar `Biblioteca.tsx`: si renderiza una sección de "descargados" desde `downloadedContent`, considerar deprecarlo en Fase 4. |
| R-3 | `window.confirm` es un dialog síncrono nativo, no integrado con el design system. UX funcional pero no premium. | Baja | Aceptado para esta fase (sin alcance UI). Refactorizar a modal Tailwind en pulido futuro. |
| R-4 | Si el navegador del usuario se desincroniza con el backend (por ejemplo, otro dispositivo asignó algo), el estado del botón puede mostrar `idle` hasta el próximo mount/refetch. No hay polling/WebSocket. | Baja | Aceptado. LU consultará GET en su lifecycle. Para Chibalete+ basta con refetch en el mount del componente. |
| R-5 | Sin un AssignmentProvider global, cada `PaginaDetalleLibro` hace su propio GET. Si un usuario navega entre libros, son varios GETs. No es costoso (un solo registro). | Baja | Aceptado. Optimización tipo `useAssignmentQuery` con SWR/React Query queda para Fase 4 si se observa carga real. |

## Compatibilidad

- ✅ Modos inmersivo / guiado / accesible / PDF / álbum: sin cambios.
- ✅ Login / sesión / permisos: sin cambios.
- ✅ Lectura web (VisorTexto): sin cambios (cache `offlineTextCache` preservado como fallback).
- ✅ Catálogo / biblioteca: sin cambios funcionales (solo neutralización de badge).
- ✅ Comunidad / reviews: sin cambios.

## Pendiente fuera de esta fase (Fase 4+)

1. **Eliminar `OfflineContext` y `offlineService`** (limpieza definitiva del sistema paralelo IndexedDB de 3 PDFs). Requiere también refactor de `Biblioteca.tsx`.
2. **AssignmentProvider global** para badge "asignado a Chibalete LU" en `ContentCard` y para evitar GET redundante por navegación.
3. **Modal de confirmación** con design system, en lugar de `window.confirm`.
4. **Indicador permanente** ("Tu libro asignado a Chibalete LU: …") en la home del usuario.
5. **Chibalete LU consume `GET /api/offline/assignment`** y descarga el `textoPlanoUrl` (Fase 4).

## Cómo probar localmente

1. Levantar backend: `cd "D:\001 - app - Chibalete+" && $env:PORT="3000"; node server/server.js`.
2. Levantar frontend dev: `npm run dev` (asume firebase config válida o stub).
3. Login con usuario válido.
4. Navegar a la página de un libro que tenga `texto_plano_url`.
5. Probar los 10 casos del brief manualmente.
6. Verificar en DevTools → Network: `POST /api/offline/assignment` sin previo `fetch` a `texto_plano_url`.
7. Verificar en DevTools → Application → localStorage: no se crea/actualiza `chibalete_offline_texto` al tocar el botón.

Alternativa sin abrir navegador: ejecutar `node qa/fase3-frontend-button/sim-frontend-flow.mjs` con backend arriba. Replica el flujo del cliente y reporta 13/13.

## Evidencia

- `sim-frontend-flow.mjs` — simulación end-to-end del cliente frontend contra backend real.
- `server-during-tests.log` — log del backend durante los tests.

## Recomendación

✅ **PASS** — La fase 3 cumple los criterios de aceptación.

**Antes de pasar a Fase 4**, recomiendo:
- Validar manualmente en navegador real con un usuario real (login + click + reload + reemplazo). El test programático cubre el contrato HTTP, pero no la animación del botón ni el flujo de `window.confirm`.
- Decidir si en Fase 4 se eliminan `OfflineContext`/`offlineService` (recomendado para cerrar la deuda), o si se preservan como red de seguridad hasta validar producción.

La regla central **"1 usuario = 1 libro offline"** queda enforced a nivel schema SQLite del backend; el frontend ya no la duplica ni la contradice.
