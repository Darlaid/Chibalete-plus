# CHP-LEO-MEDIATOR-CIS-SCOPE-01A — Alcance canónico (CIS) en las rutas de mediación de Leo

**Fecha:** 2026-09-10 · **Rama:** `chp/mook-contract-00` · **Baseline:** `b1efa9bb0e3388878c2db94e6ae656abc2653047` (cierra la brecha COMP-03 de `docs/ops/CHP_PRIVACY_SECURITY_AI_EVIDENCE_01A.md`)

| Campo | Valor |
|---|---|
| Veredicto | **GREEN-LEO-MEDIATOR-CIS-SCOPE-LOCAL-AND-PUBLISHED** |
| Despliegue | **Ninguno.** Producción sigue en `ped01d-bef0afe`; M1 en drain. |
| Cambio | Un guard local que reutiliza el CIS existente; sin sistemas, flags, tablas ni dependencias nuevas. |

## 1. Rutas cubiertas (inventario completo de Leo para mediadores)

| Ruta | Antes | Ahora | Propietario del recurso |
|---|---|---|---|
| `GET /api/leo/mediator/student/:userId` | `requireAuth` (cualquier sesión activa) | `requireAuth` + `requireLeoMediatorScope(req, res, userId)` | `:userId` = estudiante cuyo resumen se proyecta (`getMediatorStudentSummary`) |
| `GET /api/leo/mediator/student/:userId/content/:contentId` | `requireAuth` | `requireAuth` + guard | `:userId` (historial por contenido) |
| `GET /api/leo/activation/:userId` | `requireAuth`; comentario prometía «estudiantes para sí mismos», sin hacerlo cumplir | `requireAuth` + guard con `allowSelf: true` | `:userId` (outputs de activación) |

Las demás rutas `/api/leo/*` (`ask`, `memory`, `chat`, `recap`) son superficies del lector con `requireUserAuth` y no se tocaron; `ingest` es administrativa (`requireAuth` no-GET = autoridad de máquina) y tampoco.

## 2. Cadena de autoridad

1. **Identidad**: `requireAuth` (GET) exige admin-secret o usuario activo del padrón canónico; en compat/enforce la resuelve la sesión firmada y deja `req.auth` (`server/server.js` ~`:495-505`). Usuario inexistente o inactivo → 401 antes del guard.
2. **Principal del guard**: `req.auth?.userId ?? req.user?.id ?? x-user-id` (el header solo como claim legacy, igual que `server/aulaViva/scopeAccess.mjs`).
3. **Decisión**: `evaluateScopeAccess(callerId, 'user', studentId)` → `server/identity/cis.mjs` `authorizeScope`: admin por política `platform_admin_full_institutional_read`; mediador solo si el estudiante es miembro de un grupo `ACTIVE_REAL` que media, dentro de su `organizationId`; `self` solo se acepta en activación (`allowSelf`); default-deny.
4. **Máquina**: `isAdminRequest(req)` (admin-secret file-only, gate canónico existente) conserva el acceso.
5. **Taxonomía**: `allow` → continúa; `unauthenticated` → 401 `identity_not_established`; `unavailable` → 503 `identity_unavailable`; `forbidden` o `self` no permitido → 403 `scope_access_denied` con `scope_type`/`scope_id`.

Nada de `body`, `query`, `params` o cabeceras distintas de la identidad influye en rol, grupo u organización.

## 3. Allowlist exacta

- `server/server.js` — import de `evaluateScopeAccess`, función `requireLeoMediatorScope`, tres handlers convertidos en `async` con la llamada al guard antes de leer datos. 32 inserciones, 8 supresiones.
- `server/__test__/leoMediatorScope.test.mjs` — único test nuevo (servidor real hermético, 29 comprobaciones).
- Este documento.

Sin cambios en frontend, stores, schemas, eventos, materializador, proveedores, prompts, `scopeAccess.mjs`, `cis.mjs`, `package.json`, workflows ni configuración.

## 4. Matriz aplicada (verificada con el servidor real y fixtures sintéticos)

| Actor | Resultado observado |
|---|---|
| Sin identidad | 401 en las tres rutas |
| Usuario inexistente o inactivo (`MEDX` deshabilitado aunque listado como mediador) | 401 |
| Lector (`P1`) sobre sí mismo | 403 en `mediator/*`; 200 en `activation` (contrato propio conservado) |
| Lector sobre otro estudiante | 403 ×3 |
| Mediador autorizado (`MED1` → `P1`) | 200 ×3 con `{success, summary|history|outputs}` |
| Mediador sobre sí mismo en ruta de mediación | 403 |
| Mediador sin membership (`MED2`) | 403 ×3 |
| Mediador de otra institución (`MED3` → `P1`) | 403 ×3; sobre su propio miembro (`P2`) 200 ×3 |
| Administrador global (`ADM`) | 200 ×3 sobre cualquier estudiante |
| Identidad privilegiada legacy (header en modo `off`) | mismo gate canónico: el rol lo resuelve el CIS desde el padrón, no el header |
| Máquina (admin-secret) | conserva el acceso vigente (POSIX-only; no ejecutable en Windows, cubierto por las suites de identidad en CI) |

## 5. Protección frente a datos falsificados

`?role=administrador&rol=…&groupId=G1&organizationId=org-a&colegio=…&userId=ADM&reviewerId=ADM` y cabeceras `x-role`, `x-group-id`, `x-organization-id`, `x-colegio` no alteran la decisión: `MED2` y `P1` siguen en 403. Solo `:userId` identifica el recurso; la autorización proviene del padrón, memberships y `organizationId` canónicos.

## 6. Escrituras y eventos al denegar

Las tres rutas son de lectura; los servicios que invocan (`leoMediatorViewService`, `leoActivationService`) no escriben ni emiten. El test verifica que, tras todas las denegaciones y lecturas, el directorio de datos temporal es lógicamente idéntico (hash) y `events.db` no gana filas; la respuesta de denegación no contiene `summary`, `history` ni `outputs`. El actor efectivo es la identidad autenticada.

## 7. Pruebas

| Suite | Resultado |
|---|---|
| `server/__test__/leoMediatorScope.test.mjs` (nuevo, servidor real hermético, `SESSION_AUTH_MODE=off`) | 29/29 |
| `leoBackboneEmitter` 60/60 · `leoPedagogicalSignals` 70/70 | verde |
| `cisScopeAccess` 69/69 · `organizationScope` · `sessionIdentity` 42/42 · `eventsWriteAuth` · `mookReviewIdentity01a` 10/10 (capa POSIX omitida) · `aulaVivaInstitutional` 44/44 · `pedagogyAccess01dB` | verde |
| `npm run test:mook` · `npm run build` · `npm run typecheck:baseline` · `npm run lint:evidence` · `git diff --check` | verde |

`node --check server/server.js` sin errores. Fixtures con correos `@fixture.invalid`, sin PII real ni texto de menores.

## 8. Cero efectos productivos

Sin SSH, Docker, HTTP productivo, deploy ni flags. `data/`, `data-critical/`, uploads, untracked y stashes intactos y sin abrir.

## 9. Deudas expresamente no tocadas

Fallback de acceso `open` en producción (COMP-01), logging del cuerpo de eventos (COMP-02), avisos de IA y privacidad (COMP-04/05), previews verbatim de Leo (COMP-06), Gemini en navegador, gamificación por token del modelo, retención, M1/LU/MOOK/FilBo/backups/CI y el resto de P2 del inventario. El comentario histórico «D7 should introduce a requireMediatorAuth» queda satisfecho por este guard sin crear un middleware de rol paralelo.
