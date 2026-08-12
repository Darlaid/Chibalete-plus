# CHP-IDDB-READ-RMW-SEAM-01 — Aislamiento de lecturas de mutación del seam conmutable

**Unidad:** CHP-IDDB-READ-RMW-SEAM-01
**Base:** `dab22bd` (02C-A, tooling de equivalencia de lectura)
**Naturaleza:** fix de runtime + tests. Los flags productivos NO cambian
(`IDENTITY_READ=json`, `IDENTITY_READ_DOMAINS` vacío).

## El riesgo (hallazgo de 02C-A, GAP-5)

`readJSON` en `server/server.js` es el seam conmutable de lectura: con
`IDENTITY_READ=sqlite` + dominio en `IDENTITY_READ_DOMAINS`, sirve el espejo
SQLite en lugar del JSON. El espejo es un **subconjunto deliberado** del JSON
canónico: 247 de 647 usuarios (sin los 400 sintéticos), **sin credenciales**
(`sanitizeUser`), 4 de 20 grupos (sin los 16 legacy) y `access_rules` vacía.

Toda mutación del sistema es read-modify-write sobre el store completo:
lee el array, lo modifica y **reescribe el archivo entero**. Si la lectura
base viniera del seam con SQLite activo, la primera mutación persistiría el
subconjunto sobre el canónico:

- `users`: 647 → 247, **cero contraseñas** (todo login destruido);
- `groups`: 20 → 4 (los 16 legacy servidos por endpoints, borrados);
- `access`: reglas existentes → borradas (espejo vacío).

**Reproducido pre-fix en sandbox** (server real + fixtures 647/247, flags
simulados): `PUT /api/users/:id` → 200 y el store físico quedó en 247
usuarios, 0 credenciales, 0 sintéticos. Equivalente con groups (20 → 4).

## El contrato

- **READ PATH** (respuestas): puede servirse de JSON o SQLite según
  `IDENTITY_READ`/`IDENTITY_READ_DOMAINS`. Sin cambios.
- **MUTATION BASE READ**: SIEMPRE el JSON canónico FÍSICO, vía
  `readCanonicalStoreForMutation(file)`:
  - no consulta `IDENTITY_READ` ni `IDENTITY_READ_DOMAINS`;
  - no usa `identityReadFacade` ni la caché in-memory;
  - **fail-closed**: canónico ausente / vacío / no parseable / no-array →
    la mutación FALLA. Sin fallback SQLite, sin crear store vacío, sin
    continuar con subconjunto.

## Cambios

1. `server/server.js`
   - Nuevo `readCanonicalStoreForMutation(file)` (lectura física fail-closed).
   - Rewire de las **26 lecturas base de mutación** inventariadas:
     los 3 helpers (`mutateUsers`, `mutateGroups`, `mutateAccessRules`) y los
     15 handlers RMW inline (login incluido: su lectura alimenta los writes de
     auto-upgrade de hash y `lastLoginAt`, así que es base de mutación; con
     flags actuales el comportamiento es byte-idéntico porque USERS_DB no se
     cachea y el default es JSON).
   - `writeJSON`/`writeJSONAsync` invocan `assertWritableIdentityPayload`
     (guard de regresión, ver abajo) antes de persistir.
   - Los stores de server.js resuelven bajo `CHP_DATA_DIR` (default `data/`
     del repo, byte-idéntico) y `DB_FILE`/`SCHOOLS_DB`/`ACCESS_DB`/
     `USER_AUDIT_DB` admiten además override individual (`CONTENT_DB`/
     `SCHOOLS_DB`/`ACCESS_DB`/`USER_AUDIT_DB`) — mismo precedente que
     `USERS_DB`/`GROUPS_DB` en `config.js`; producción no define ninguna.
     Lo exige el harness que bootea el server real 100% hermético contra
     stores temporales (el boot auto-crea varios stores auxiliares); la
     suite verifica la hermeticidad con un snapshot de `data/`.
2. `server/db/identityReadFacade.js`
   - Todo array servido desde SQLite queda marcado con el Symbol no enumerable
     `IDENTITY_SQLITE_SERVED` (invisible para `JSON.stringify`/`res.json`).
   - `assertWritableIdentityPayload(file, data, paths)`: lanza
     `IDENTITY_MUTATION_SQLITE_GUARD` si el payload a persistir en un store de
     identidad es un array servido desde SQLite. Con `IDENTITY_READ=json` la
     marca no existe nunca → no-op.

## Sitios NO tocados (clasificación del inventario)

- Lecturas de solo-respuesta (GET, auth de sesión, RBAC, exports, CIS):
  siguen en el seam conmutable — es exactamente su propósito.
- `mutateSchools`/`mutateSections`/`mutateLeoMemory`/etc.: sus stores no son
  dominios del facade (el seam nunca los sirve desde SQLite) — sin cambio.
- `server/groupMembershipService.js`: lee físico (`readJsonAtomic`) y su
  escritura ya está bloqueada bajo dual-write — SAFE, solo scripts.

## Evidencia (suite `identityMutationCanonicalRead.test.mjs`, en `test:identity`)

Con el server REAL booteado y `IDENTITY_READ=sqlite` +
`IDENTITY_READ_DOMAINS=users,groups,access` sobre fixtures 647/247 y 20/4:

- read path sigue conmutable: `GET /api/users` sirve 247 (espejo);
- `PUT /api/users/:id` → 647→647, **las 647 credenciales sobreviven**, los
  400 sintéticos sobreviven; un usuario SOLO-JSON es mutable (base = JSON);
- login → 200 con credencial JSON (el espejo sin credenciales no es la base)
  y su write RMW (`lastLoginAt`) no trunca;
- `PUT /api/groups/:id` → 20→20, los 16 legacy sobreviven;
- access: el facade serviría `[]` (hazard real), el guard rehúsa persistirlo
  y la base canónica conserva las reglas;
- fail-closed: canónico corrupto o ausente → mutación falla, el store no se
  reemplaza ni se crea;
- guard unitario + anclas estructurales (los mutators protegidos no pueden
  volver al seam sin romper la suite).

## Deudas que esta unidad NO resuelve (siguen abiertas, ver 02C-A)

GAP-1 sintéticos autenticables solo-JSON · GAP-2 login/credenciales fuera del
espejo · GAP-3 16 grupos legacy servidos por endpoints · GAP-4 `access_rules`
sin backfill · rate limiter distribuido · `shadowTelemetry().pending`.

Un canary de lectura SQLite sigue BLOQUEADO por esos gaps según el dominio.
La siguiente unidad es CHP-IDDB-02C-B (comparación runtime invisible, JSON
como respuesta oficial), cuyo diseño debe incorporarlos.
