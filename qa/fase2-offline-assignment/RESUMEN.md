# Fase 2 — Backend Offline Assignment · QA y resumen técnico

**Fecha:** 2026-05-26
**Estado:** ✅ PASS — listo para Fase 3 (frontend Chibalete+).

## Archivos modificados / creados

| Archivo | Cambio |
|---|---|
| `server/offlineAssignmentService.js` | **Nuevo** · SQLite + WAL, schema con `PRIMARY KEY user_id` (enforcement de unicidad). API: `getAssignment`, `upsertAssignment`, `deleteAssignment`, `getAssignmentCount`, `closeOfflineAssignmentDb`. |
| `server/schemas/offline.schema.js` | **Nuevo** · Zod schema `assignBookSchema` para validar body del POST. |
| `server/server.js` | **Modificado** · imports de offlineAssignmentService + assignBookSchema (línea ~104); 3 endpoints `/api/offline/assignment` (líneas 2509–2656) entre los handlers de progress y SUBFASE 2.1. |
| `data/offline_assignments.db` | **Generado en runtime** · SQLite WAL, vacío al boot, se crea automáticamente. |

## Modelo de datos

```sql
CREATE TABLE offline_book_assignments (
    user_id         TEXT PRIMARY KEY,          -- enforcement de "1 usuario = 1 libro"
    content_id      TEXT NOT NULL,
    content_version INTEGER NOT NULL DEFAULT 1,
    assigned_at     TEXT NOT NULL,
    updated_at      TEXT NOT NULL
);
CREATE INDEX idx_offline_content_id ON offline_book_assignments(content_id);
```

- WAL mode + busy_timeout=5000 (mismo perfil que `progressService.js`, multi-instancia friendly).
- UPSERT atómico con `ON CONFLICT(user_id) DO UPDATE`.
  - Si `content_id` cambia → `content_version + 1`, `assigned_at = now`.
  - Si `content_id` igual → preserva `version` y `assigned_at`, solo avanza `updated_at` (idempotencia).

## Contrato final de los 3 endpoints

Auth: **todos** requieren `x-user-id` header (middleware `requireUserAuth` → usuario existe + `accountStatus === 'active'`). Sin header → 401. Header inválido o cuenta inactiva → 403.

Aislamiento: cada endpoint opera **solo** sobre el `userId` de la sesión. **No** es posible consultar / asignar / borrar el assignment de otro usuario por estos endpoints.

### `GET /api/offline/assignment`

Respuesta cuando hay assignment:
```json
{
  "contentId":  "content-1765893250573",
  "version":    1,
  "assignedAt": "2026-05-26T21:24:39.970Z",
  "updatedAt":  "2026-05-26T21:24:39.970Z",
  "book": {
    "id":            "content-1765893250573",
    "title":         "Lectores en Red",
    "author":        "d",
    "coverUrl":      "/uploads/content-1765893250573/el_vampiro___cubierta-….jpg",
    "summary":       null,
    "authorBio":     null,
    "textoPlanoUrl": "/uploads/content-1765893250573/the_vampyre__esp-….txt"
  },
  "progress": null
}
```
Cuando no hay assignment:
```json
{ "assignment": null }
```

`progress` se hidrata desde `progressService.getProgressItem(userId, contentId)` cuando existe; estructura `{ percentage, updatedAt, isCompleted, canonicalProgress }`.

### `POST /api/offline/assignment`

Body: `{ "contentId": "<id>" }` (validado por Zod, `.strip()` descarta extras).

Respuesta exitosa: misma forma que GET con assignment.

Códigos:
| Caso | Status | Body |
|---|---|---|
| Asignación nueva o reemplazo OK | 200 | assignment completo |
| Body inválido (sin `contentId`) | 400 | `{ error:"Solicitud inválida", details:[...] }` |
| `contentId` no existe | 404 | `{ error:"Contenido no encontrado.", reason:"content_not_found" }` |
| Sin acceso al contenido (scope engine / restricted mode) | 403 | `{ error:"Sin acceso al contenido.", reason:"..." }` |
| Sin sesión | 401 | `{ error:"Auth requerida: x-user-id missing" }` |
| Usuario inválido / inactivo | 403 | `{ error:"Acceso denegado: …" }` |

Acceso evaluado en `evaluateOfflineAccess()`:
1. Si `roles` incluye `'administrador'` → permitido.
2. `canUserAccessContent(...)` del scope engine ya inicializado en `server.js:3300`.
3. Si scope dice `allowed=true` → permitido.
4. Si `legacyFallback=true` (modo `open`, sin reglas restrictivas) → permitido.
5. Caso contrario → 403.

### `DELETE /api/offline/assignment`

Idempotente. Siempre 200.
- Si había assignment: `{ "assignment": null, "removed": true }`
- Si no había: `{ "assignment": null, "removed": false }`

## Auditoría

Logs `[ACCESS]` (mismo canal que `accessService`):

| Evento | Cuándo |
|---|---|
| `assignment_get` | GET (incluye `present=true|false`). También POST sobre mismo libro (idempotente). |
| `assignment_created` | POST sin assignment previo. |
| `assignment_replaced` | POST sobre assignment de otro libro distinto. |
| `assignment_deleted` | DELETE (incluye `removed=true|false`). |
| `assignment_denied_access` | POST con 403 (incluye `reason`). |
| `assignment_invalid_content` | POST con 404. |

## Tests ejecutados (10/10)

Server arrancado con `PORT=3000 node server/server.js`. Tests contra `http://localhost:3000`.

| # | Caso | Resultado |
|---|---|---|
| 1 | Usuario sin assignment → GET devuelve `{"assignment":null}` | ✅ |
| 2 | POST libro válido → assignment con version=1, metadata book completa, progress=null | ✅ |
| 3 | POST otro libro → version=2, nuevo assignedAt, metadata nueva (reemplazo limpio) | ✅ |
| 4 | POST mismo libro → version preservada en 2, `assignedAt` PRESERVADO, solo `updatedAt` avanza (idempotente) | ✅ |
| 5 | POST sin acceso → 403 (validado con `ACCESS_FALLBACK_MODE=restricted` + lector `user-tono` sin scope rules) | ✅ |
| 6 | POST contentId inexistente → 404 con `reason:content_not_found` | ✅ |
| 7 | DELETE con assignment → 200 `{removed:true}`; GET subsiguiente devuelve `null` | ✅ |
| 8 | DELETE sin assignment → 200 `{removed:false}` (idempotente, sin error) | ✅ |
| 9 | A (admin-super-1) y B (user-tono) asignan libros distintos → cada GET aislado; SQLite muestra **2 filas, 0 duplicados** | ✅ |
| 10 | Ningún `fetch('/api/content')` en los endpoints; uso `readJSON(DB_FILE)` directo (mismo patrón que `/api/content/:id/access`) | ✅ |

Extras:
- Sin `x-user-id` → 401 ✅
- `x-user-id` con id inexistente → 403 ✅
- Body vacío `{}` → 400 con detalles Zod ✅
- Admin con `ACCESS_FALLBACK_MODE=restricted` → SIGUE pasando vía `admin_role` bypass ✅

## Cómo reproducir (PowerShell / curl)

Arranque del server local:
```powershell
cd "D:\001 - app - Chibalete+"
$env:PORT="3000"
$env:ACCESS_FALLBACK_MODE="open"
node server/server.js
```

```bash
# 1. GET sin assignment
curl -H "x-user-id: admin-super-1" http://localhost:3000/api/offline/assignment

# 2. Asignar libro
curl -X POST -H "x-user-id: admin-super-1" -H "Content-Type: application/json" \
     -d '{"contentId":"content-1765893250573"}' \
     http://localhost:3000/api/offline/assignment

# 3. Reemplazar libro
curl -X POST -H "x-user-id: admin-super-1" -H "Content-Type: application/json" \
     -d '{"contentId":"content-1772817449967"}' \
     http://localhost:3000/api/offline/assignment

# 4. Eliminar assignment
curl -X DELETE -H "x-user-id: admin-super-1" http://localhost:3000/api/offline/assignment
```

PowerShell equivalente del POST:
```powershell
Invoke-RestMethod -Uri http://localhost:3000/api/offline/assignment `
  -Method POST `
  -Headers @{ "x-user-id" = "admin-super-1" } `
  -ContentType "application/json" `
  -Body (@{ contentId = "content-1765893250573" } | ConvertTo-Json)
```

## Riesgos detectados

| ID | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R-1 | Si Chibalete+ corre con `ACCESS_FALLBACK_MODE=open` (default), **cualquier lector autenticado** puede asignar **cualquier** libro del catálogo. La regla de acceso "real" depende del scope engine. | Media | Para producción, considerar `ACCESS_FALLBACK_MODE=restricted` o asegurar que `access_db.json` tiene reglas activas por organización/grupo. Hoy esto refleja exactamente el comportamiento de `/api/content/:id/access`, por consistencia. |
| R-2 | El endpoint no expone version monotónica global del catálogo; `version` se incrementa solo cuando cambia el `content_id` para ese usuario. LU debe usar `version` como cache-buster para detectar "cambió mi libro" entre polls. | Baja | Documentado en contrato. LU compara `version` local vs nueva. |
| R-3 | `progress` devuelto en GET se lee desde `progressService` cada vez (sin cache). Si el usuario lee mucho offline, el progress queda desactualizado hasta la próxima sync de LU. | Baja | Fase 3+ implementará sync LU → backend. Hoy es snapshot. |
| R-4 | `coverUrl`, `textoPlanoUrl` son rutas relativas (`/uploads/...`). LU debe componer URL absoluta. | Baja | Mismo contrato que `/api/content`. Documentado. |
| R-5 | Si el `contentId` asignado se elimina del catálogo después, `book` viene `null` pero el assignment sigue. | Baja | LU debe manejar el caso `book == null` → tratar como "stale" y posiblemente disparar DELETE. Documentar en spec de LU. |

## Compatibilidad

- ❌ **No** se modificó ningún endpoint existente.
- ❌ **No** se cambió ningún contrato de lectura.
- ❌ **No** se tocó frontend.
- ❌ **No** se hizo deploy.
- ✅ Sintaxis check: `node --check` pasa en los 3 archivos nuevos/modificados.
- ✅ Server arranca limpio en local; `[offlineAssignmentService] SQLite path: ...` aparece en startup.

## Para Fase 3 queda listo

- Endpoints estables y documentados → Chibalete+ frontend puede cablear el botón "Disponible sin conexión" a `POST /api/offline/assignment`.
- Chibalete LU puede empezar a consumir `GET /api/offline/assignment` para descubrir el libro asignado, comparando `version` para detectar cambios.
- La regla "1 usuario = 1 libro offline" queda enforced **a nivel schema**, no a nivel código frontend.

## Pendiente fuera de esta fase

- Endpoint adicional `GET /api/offline/assignment?ifVersionGreaterThan=N` (poll eficiente con 304). Hoy LU debe hacer GET completo y comparar. Acordamos diferirlo a una iteración futura — no bloquea Fase 3.
- Sync de progreso LU → backend (Fase 4 según roadmap).
- Limpieza de `offlineTextCache` localStorage en Chibalete+ (Fase 3).
- UX del botón "Disponible sin conexión" (confirmación de reemplazo, banner offline) (Fase 3).

## Evidencia

- `server-open-mode.log` — log del server durante tests 1–4, 6–9 (fallback open).
- `server-restricted-mode.log` — log del server durante test 5 (fallback restricted, valida 403).
- En ambos se ven líneas `[ACCESS] [OFFLINE] assignment_*` confirmando auditoría.
