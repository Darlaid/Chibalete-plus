# CHP-IDDB-M1-A-SESSION-IDENTITY-DEPLOY-C — Frontend cookie-only + inicio de drenaje legacy

**Veredicto:** `GREEN — M1-A DEPLOY C COOKIE-ONLY FRONTEND LIVE AND LEGACY BROWSER DRAIN OBSERVATION STARTED`

```
M1_A_DEPLOY_C_GREEN=true
COOKIE_ONLY_FRONTEND_LIVE=true
LEGACY_DRAIN_OBSERVATION_RUNNING=true
LEGACY_DRAIN_STARTED_AT=2026-08-16T17:52:47Z
ACTUAL_BROWSER_X_USER_ID_HEADER=false
```

- Fecha: 2026-08-16 (~17:52–18:00Z). Backend sin cambio (ambas APIs `0ff76b6` COMPAT).

## 1. Baseline

api_1 y api_2 en `0ff76b6` COMPAT/json, healthy, restarts=0. Frontend legacy `chibalete/front:hf4a-r2-coherence-82fba6e` (`9141cfb4`). Gates previos: `M1_A_DEPLOY_B2_GREEN`, `CROSS_INSTANCE_SESSION_GREEN`, `LOGIN_PRODUCTION_SMOKE_PENDING=false`, `M1_A_DEPLOY_C_GATE_OPEN=true`.

## 2. Fuente y guard (FASE 2)

Worktree git aislado (detached, limpio) en **`0ff76b6`**. `browserNoXUserIdGuard` 2/2 GREEN → `PRODUCT_BROWSER_X_USER_ID_EMITTERS=0` (127 archivos de producto). Sin M1-B/M2.

## 3. Build (FASE 3)

| | |
|---|---|
| `FRONTEND_SOURCE_SHA` | `0ff76b6` |
| `OLD_FRONTEND_IMAGE` | `chibalete/front:hf4a-r2-coherence-82fba6e` (`9141cfb4`) |
| `NEW_FRONTEND_IMAGE` | `chibalete/front:m1a-0ff76b6` (`2d7535965868`) |
| `NEW_BUNDLE` | `index-BFUxw-JX.js` |

Sin secretos en el bundle (los 2 matches de `GEMINI_API` son el nombre de la env var `VITE_GEMINI_API_KEY` en mensajes de debug, sin valor; sin literales `sk-`/`AIza`). Imagen de API sin cambio.

## 4. Baseline del contador legacy (FASE 4)

`LEGACY_BROWSER_COUNTER_AT_DEPLOY_C_START = 11` (api_1=2, api_2=9), métrica monotónica `chibalete_auth_session_legacy_x_user_id_total{source_class="browser"}`.

## 5–6. Deploy y bundle servido (FASES 5–6)

Promoción de imagen front en el override + recreate **solo** de `chibalete_front` (APIs no tocadas, `SESSION_AUTH_MODE`/`IDENTITY_READ` sin cambio, edge sin cambio — proxya por nombre). Front healthy, restarts=0. **Bundle servido = `index-BFUxw-JX.js`** (reachable 200); bundle legacy `index-C_Ph9658.js` → **404** (sin caché). `DEPLOY_C_AT = 2026-08-16T17:52:47Z` (inicio de la ventana de drenaje).

## 7–9. Smoke real de navegador (FASES 7–9)

Vía navegador real (claude-in-chrome) contra el sitio productivo, con interceptor `fetch`/`XHR` para capturar cabeceras. El **login exitoso lo tecleó el operador** (por regla de seguridad el asistente no introduce contraseñas en campos).

- **Login exitoso** → home de lector renderizado ("Hola, Nicolas", navegación completa, tareas, "Nuevos títulos"); subject `user-1781223323090`.
- `GET /api/auth/me` **cookie-only → 200**, id == subject.
- ruta normal cookie-only `GET /api/groups` → **200**.
- **23 requests autenticadas capturadas, `x-user-id` en 0 de ellas** (login POST + content/users/access/progress/groups/schools/configs).
- `chp_session` **no visible a JS** (HttpOnly); **no existe clave `chibalete_user_id`** en localStorage (mecanismo legacy retirado).
- **Smoke funcional:** login + navegación de lector sin regresión por el retiro de x-user-id.
- **Logout** por el botón "Cerrar Sesión" → `POST /api/auth/logout` (xuid=false) → **200**; misma cookie post-logout → `/api/auth/me` **401 revoked**.

## 8. Prueba cookie-only consolidada (FASE 8)

`ACTUAL_BROWSER_X_USER_ID_HEADER=false`, sostenido por: guard estático (0 emisores) + bundle servido = esa fuente + 23 requests reales todas sin x-user-id + sin `chibalete_user_id` en storage + cookie HttpOnly. No se apoya solo en el guard estático.

## 10–11. No interferencia de API y salud

Ambas APIs con StartedAt sin cambio (`16:45:14Z` / `15:58:04Z`), restarts=0, `0ff76b6` COMPAT/json, healthy — **sin recreate de API**. Front `m1a-0ff76b6` healthy, restarts=0. `edge_5xx` desde Deploy C = **0**, errores de sesión=0, sin regresión auth.

## 12. Inicio del drenaje legacy (FASE 12)

`LEGACY_DRAIN_STARTED_AT = 2026-08-16T17:52:47Z`. Contador legacy **antes=11, después del smoke cookie-only=11 → 0 incrementos legacy atribuibles** al nuevo frontend (las 23 requests autenticadas no tocaron el contador). La métrica futura es el **delta/rate** de `auth_session_legacy_x_user_id_total{browser}` desde `DEPLOY_C_AT` (nunca "total==0"). El cierre requiere `NEW_BROWSER_LEGACY_REQUESTS=0` en una ventana ≥24h; el tráfico de clientes viejos/caché durante la propagación puede existir y se medirá en la unidad de cierre, no se oculta.

## Invariantes de identidad

Cuenta de smoke `user-1781223323090`: `credentialVersion` 0→0, hash `8d075d985a78dd10…` **byte-idéntico**, status active. `lastLoginAt` se actualizó por el login real (efecto esperado, no campo de autoridad). Journal `APPLIED 100740→100987 (+247)` = un resync de `lastLoginAt`; `PENDING=0 FAILED=0`. Padrón 647=247+400, memberships 227. `CANONICAL_IDENTITY_AUTHORITY_MUTATIONS=0`. `sessions.db` mutó (login minteó + logout revocó) — esperado.

## 13. Rollback

Quitar el bloque `front` del override (vuelve a `chibalete/front:hf4a-r2-coherence-82fba6e`) + recreate solo de front. Ambas APIs permanecen COMPAT; **sin rollback del backend M1-A**. Copia en `/root/chp-m1-a-deploy-c-01/override.pre-c.yml`.

## Siguiente paso (NO ejecutar automáticamente)

**NO ENFORCE ahora.** Esperar la ventana de drenaje. Siguiente unidad: `CHP-IDDB-M1-A-SESSION-IDENTITY-LEGACY-DRAIN-CLOSE-01` — evaluar `NEW_BROWSER_LEGACY_REQUESTS=0` durante ≥24h antes de permitir `api_2` ENFORCE.
