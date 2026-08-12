# CHP-IDDB-02C-A — equivalencia de lectura JSON vs SQLite (sin autoridad SQLite)

Unidad de **solo comparación**: ninguna lectura productiva cambió. `IDENTITY_READ=json`
en ambas API durante toda la unidad y al terminar.

## Inventario de superficies de lectura (Fase 1)

Toda lectura de identidad del runtime pasa por uno de estos caminos:

### Cubiertos por el facade (`identityReadFacade` intercepta el seam `readJSON`)

| Fuente | Call sites | Ejemplos |
|---|---|---|
| `readJSON(USERS_DB)` | 33 | **`POST /api/auth/login`**, `requireAdminAccess` (RBAC, thunk `readUsers`), `requireAuth`, `GET /api/users`, CRUD de usuarios, endpoints de miembros, **`mutateUsers` (read-modify-write)** |
| `readJSON(GROUPS_DB)` | 23 | `GET/PUT/DELETE /api/groups*`, miembros, `GET /api/content/:id/access` (scope de grupo), **`mutateGroups` (RMW)** |
| `readJSON(ACCESS_DB)` | 1 | motor de accesos E6 (`mutateAccessRules` incluido) |
| `cis.mjs readIdentityArray` | users+groups | **autorización de `/api/v2/metrics`** (organizationScope) — también pasa por el facade |

### Bypasses directos (NO cambian con `IDENTITY_READ`)

| Módulo | Lee | Clasificación |
|---|---|---|
| `readJSON(SCHOOLS_DB)` (3 sites) | instituciones | **INTENTIONAL** — el facade no tiene dominio `institutions` |
| `server/metrics/metricsProvider.mjs` | users+groups+schools (fs directo) | **LEGACY** — motor de métricas legacy |
| `server/services/aulaVivaAuditEmitter.mjs` | groups (fs directo) | **LEGACY** — lookup defensivo |
| `server/services/cohortBuilder.mjs` | groups (fs directo) | **LEGACY** |
| `server/leoICDLIBridge.js` | users+groups (fs directo) | **LEGACY** |
| `server/groupMembershipService.js` | users+groups (fs propio) | superficie de ESCRITURA, bloqueada bajo dual-write |

Ninguno de los bypasses es de seguridad crítica que "debiera" migrar junto al
facade: los tres primeros son telemetría/consulta, y el RBAC/authz sí pasa por
el facade (adminAuth y CIS).

## Scope real de `IDENTITY_READ` (Fase 2)

- `sqlite` **solo** actúa junto a `IDENTITY_READ_DOMAINS` (csv; default vacío ⇒ nada).
- Gates: flag global → dominio → `shadow_audit` ok → lectura sin excepción; ante
  cualquier duda cae a JSON con métrica de fallback. Dirección fail-safe = JSON.
- **`ok=1` de `shadow_audit` significa «el espejado no falló», no «los conteos
  coinciden»** (registra `json_count=647` vs `sqlite_count=247` con `ok=1`).
  No protege de la divergencia semántica de cardinalidad.
- ¿Login depende del switch? **SÍ** (dominio `users`). ¿RBAC? **SÍ** (mismo seam).

## Los tres hallazgos que bloquean un futuro read canary (Fase Y)

1. **RMW sobre el mismo seam — riesgo de pérdida de datos.**
   `mutateUsers`/`mutateGroups`/`mutateAccessRules` leen con `readJSON` y
   escriben el resultado. Con cutover activo, la primera mutación leería el
   conjunto SQLite (247 usuarios **sin contraseñas** / 4 grupos) y **lo
   escribiría de vuelta al JSON canónico**: 647→247 usuarios con credenciales
   destruidas, 20→4 grupos. Ningún canary de lectura puede activarse sin
   separar antes los sitios read-only de los read-modify-write.

2. **El dominio `users` arrastra el login.** `POST /api/auth/login` usa el
   mismo seam; el `raw_json` espejado excluye `password`/`passwordHash` POR
   DISEÑO (`credential_excluded=1`). Cutover de `users` ⇒ todo login falla
   (cerrado, no abierto — pero roto). La frontera **es separable por dominio**:
   `groups`/`access` no tocan el login; `users` exige primero un carve-out del
   camino de autenticación.

3. **Entidades excluidas con uso productivo real.** Los 400 sintéticos tienen
   contraseña y hoy pueden autenticarse; los 16 grupos legacy se sirven y
   mutan por los endpoints (`group-historical-grupo-101` se usó como canary);
   la única regla de `access` (`lt-access-v2`) concede contenido al grupo
   sintético y `access_rules` en SQLite está **vacía** (dominio aún no
   espejado — solo se espeja al escribir).

**Dirección de todas las diferencias: SQLite ⊆ JSON.** Ningún camino concede
más acceso bajo SQLite (0 `UNEXPECTED_IN_SQLITE` en users/groups/memberships);
los flips posibles son siempre hacia denegar/no-encontrar.

## Contrato de equivalencia (Fase 3) y resultados

Herramienta: `scripts/identity/compareReadEquivalence.mjs` (read-only,
fail-closed, sin PII; fence de consistencia con doble captura de hashes).
El dominio elegible se deriva con `projectCanonical` — la misma definición que
usa el reconciliador.

Sobre producción (T+0, fence estable):

| Sección | Casos | MATCH | Esperadas | Inesperadas |
|---|---|---|---|---|
| users (campo a campo, sin credenciales) | 247 | 247 | 0 | **0** |
| exclusión sintética comprobada | 400 | — | 400 | **0** |
| invariantes de tombstones | 11 | — | 11 | **0** |
| institutions | 4 | 4 | 0 | **0** |
| groups canónicos (raw + columnas) | 4 | 4 | 0 | **0** |
| clasificación de grupos excluidos | 16 | — | 16 | **0** |
| memberships (ambos sentidos) | 227 | 227 | 0 | **0** |
| read shapes (`byId`, `byEmail`, `membersOf`, `ofUser`, `groupsOf`, aliases×258, tombstones×11) | 1001 | 1001 | 0 | **0** |
| casos negativos | 9 | 7 | 2 | **0** |
| **Total** | **1919** | **1490** | **429** | **0** |

## Performance (Fase 15, sandbox con datos reales)

| Operación | JSON caliente | SQLite | Nota |
|---|---|---|---|
| user byId | 11 µs | 60 µs p50 / 242 µs p99 | array en RAM vs índice |
| user byEmail | 15 µs | 39 µs | |
| group byId | 0,8 µs | 50 µs | 20 elementos en RAM |
| memberships of user | 9 µs | 69 µs | |
| **listado completo (frío)** | 2 769 µs | **1 212 µs** | SQLite 2,3× más rápido |
| members of group | 6 µs | 181 µs | |

Sin regresión catastrófica ni timeouts: todo lookup SQLite queda bajo 0,5 ms
p99. El array caliente gana en punto-a-punto porque ya está parseado en RAM.

## Qué NO se hizo

Sin cambio de flags, sin imagen nueva, sin deploy, sin `--apply`, sin
tocar auth/roles/memberships/grupos/instituciones, sin servir SQLite a nadie.
