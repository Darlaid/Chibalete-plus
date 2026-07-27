# Fuente canónica de usuarios y contrato de grupos

**Unidades:** CHP-ID-CANON-01A + **01B** · **Estado:** READY FOR PRODUCTION
PREFLIGHT — NO DESPLEGADO

---

## 1. Decisión canónica

`data-critical/usuarios_colegios_oro.json` es la **única fuente de verdad** de
usuarios para autenticación, administración, creación y edición, roles,
permisos, scopes, Aula Viva, instituciones, memberships y asignaciones.

`data/users_db.json` queda clasificado como:

> **LEGACY_NON_CANONICAL — DO NOT DELETE — DO NOT WRITE — DO NOT READ AT
> RUNTIME — DO NOT USE AS DEVELOPMENT SEED**

Se conserva intacto por trazabilidad y respaldo, y **no tiene ningún uso
runtime admisible**. 01B retiró la última autorización que le quedaba (seed de
desarrollo local): apuntarle `USERS_DB` ahora **aborta el arranque en cualquier
modo**. Tampoco se admite una tercera fuente persistente.

### Por qué

Auditoría read-only en producción (2026-07-27, contenedor `chibalete_api_1`):

| Padrón | Registros | ids únicos | `accountStatus` | `lastLoginAt` |
|---|---|---|---|---|
| `usuarios_colegios_oro.json` (canónico) | 646 | 646 | 646 `active` | 68 |
| `data/users_db.json` (legacy) | 496 | 494 (**2 duplicados**) | 484 sin valor | **0** — el campo no existe en su schema |

Solapamiento legacy↔canónico: **1 id** y **3 emails**. 490 registros legacy no
existen en el canónico ni por id ni por email, y **ninguno** tiene señal de
login. Es un padrón obsoleto y casi disjunto, no un subconjunto.

### Riesgo de cutover: ninguno

Ningún login se resuelve contra el legacy: `server.js` autentica contra
`config.USERS_DB`, que en producción apunta al canónico. Las 490 identidades
legacy-only nunca pudieron entrar. El único consumidor que leía el legacy era
`scopeAccess.mjs`, y su efecto era **denegar** scope a mediadores reales del
canónico. Corregirlo solo restituye acceso legítimo; no lo retira a nadie.

---

## 2. Resolución de la fuente — la ruta canónica no es overrideable

`server/config.js` es el **único** resolver, y aplica la regla en **import-time**
(`assertCanonicalUsersDb`), de modo que ninguna ruta del runtime puede saltárselo
por olvido. No hay fallback en ningún modo.

| Modo (`NODE_ENV`) | Ruta admitida | Cualquier otra ruta |
|---|---|---|
| `production` | exactamente `/app/data-critical/usuarios_colegios_oro.json` | **aborta el arranque** |
| `development` | exclusivamente `data-critical/usuarios_colegios_oro.json` del repo | **aborta el arranque** |
| `test` | sólo un fixture dentro de un directorio temporal (`fs.mkdtemp`) | **aborta el arranque** |

En modo test, además, un `USERS_DB` heredado del `.env` de la máquina se
**neutraliza**: la suite no puede depender del entorno de quien la ejecuta. La
fuente se inyecta explícitamente por el test.

`config.js` carga `.env` en import-time (antes lo hacía `server.js` **después**
de resolver, así que un `USERS_DB` puesto en `.env` quedaba inerte). La env var
real del container sigue ganando sobre `.env`.

Exports: `USERS_DB`, `USERS_DB_CANONICAL_DEFAULT`, `CONTAINER_CANONICAL_USERS_DB`,
`USERS_DB_LEGACY_NON_CANONICAL` (solo deprecación/tests), `resolveUsersDb(env)`,
`assertCanonicalUsersDb(env)`, `resolveRuntimeMode(env)`,
`isLegacyNonCanonicalUsersDb(path)`, `CanonicalSourceError`.

Ningún archivo de runtime menciona `users_db.json` — verificado por
`server/__test__/identityCanonicalSource.test.js` §C.

### Consecuencia operativa para desarrollo local

Para levantar el backend en local hace falta un padrón en
`data-critical/usuarios_colegios_oro.json`. Ya **no** vale apuntar `USERS_DB` al
padrón legacy ni a un tercer archivo: el proceso aborta con un mensaje que
nombra la causa. Usa una copia saneada del canónico.

## 2.b Aislamiento de los stores reales en la suite

- `scripts/test-real-store-guard.mjs` — módulo de precarga (`node --import`) que
  lanza **antes de tocar el disco** ante cualquier escritura dentro de `data/`,
  `data-critical/` o `public/uploads/`. Las lecturas siguen permitidas.
- `scripts/verify-test-store-isolation.mjs` — toma un snapshot sha256+mtime de
  esos directorios, corre las suites con el guard activo y falla si algo cambió.
  `npm run test:store-isolation`.
- `server/__test__/helpers/testMode.mjs` — fija `NODE_ENV=test` y redirige los
  stores SQLite a un temporal por proceso. Debe ser el **primer import** del test.

`aulaVivaInstitutional.test.js` sobrescribía y restauraba `data/users_db.json` y
`data/groups_db.json` reales desde un backup en memoria; ese hack existía porque
`scopeAccess` leía un path hardcodeado. Ya no: inyecta sus fixtures por
`USERS_DB`/`GROUPS_DB` hacia un `mkdtemp`.

---

## 3. Contrato de grupos

### Antes

El formulario de `/admin/usuarios` solo mostraba el selector de grupo a
mediadores y administradores. Para un estudiante ofrecía **"Curso / Grado" como
texto libre**, así que el `POST /api/users` salía sin `groupIds` y el backend
tenía que inferir el grupo desde el nombre de la institución. En un colegio con
más de un grupo eso devolvía `400 AMBIGUOUS_GROUP`, que la UI mostraba como un
`alert()` con el código crudo. **Ésa era la causa exacta del error reportado.**

### Ahora

La autoridad es el **`groupId` estable**. `curso` sigue existiendo como etiqueta
descriptiva del perfil, pero no decide membresía.

**Frontend** (`pages/AdminUsuarios.tsx`)

- El selector de grupo se muestra también para estudiantes, y es obligatorio.
- El botón de guardar queda deshabilitado mientras no haya grupo elegido.
- Nunca infiere el grupo desde el texto de curso.
- Los errores se muestran inline y traducidos, sin `alert()` ni códigos crudos.

**Backend** (`POST /api/users`, `POST /api/invite-user`)

| Situación | Respuesta |
|---|---|
| `groupIds` explícito y válido | crea |
| Payload legacy, **una** coincidencia por institución | resuelve (compat documentada) |
| Payload legacy, **varias** coincidencias | `409 AMBIGUOUS_GROUP` + `choices[]` |
| `groupId` inexistente | `400 GROUP_NOT_FOUND` |
| `groupId` de otra institución | `400 GROUP_SCHOOL_MISMATCH` |
| Lector sin grupo resoluble | `400 GROUP_REQUIRED` |

- **Nunca** se selecciona el primer resultado arbitrariamente.
- `choices[]` expone solo `{id, name, grade, type}` — sin PII.
- La validación de `groupIds` ocurre **dentro del lock, antes de escribir**: un
  payload inválido no deja usuario a medias ni lector huérfano. El orden de
  escritura sigue siendo grupos → usuarios, de modo que un fallo de I/O aborta
  la creación completa.

**Mediadores y administradores conservan el contrato actual**: el grupo es
opcional y su semántica de asignación no cambia en esta unidad.

---

## 3.b Shadow comparison read-only en producción (01B, 2026-07-27)

Comparación de decisiones de autorización institucional entre el runtime actual
(scopeAccess sobre el padrón legacy) y el propuesto (CIS sobre el canónico),
con el **mismo** store de grupos, de modo que la única variable es el padrón.

`scripts/shadow-scope-compare.mjs`; la réplica del CIS que usa está probada
equivalente al `cis.mjs` real en 5.376 decisiones sobre fixtures sintéticas
(`scripts/__test__/shadowScopeEquivalence.test.mjs`).

| | |
|---|---|
| Callers evaluados | 1.139 (unión de ambos padrones) |
| Decisiones evaluadas | 26.741 |
| Idénticas | 23.860 |
| deny → allow | 2.388 — **todas** `EXPECTED_RESTORE_LEGITIMATE_ACCESS` |
| allow → deny | 493 — **todas** `EXPECTED_REMOVE_INCORRECT_ACCESS` |
| `REVIEW_UNEXPLAINED` | **0** |
| `HIGH_RISK_ACCESS_EXPANSION` | **0** |
| `HIGH_RISK_ACCESS_LOSS` | **0** |

**Por qué el gate actual deniega casi todo:** el `scopeAccess` desplegado lee
`user.role` **singular**, y ese campo **no existe en ningún registro** del padrón
legacy. `isAdmin`/`isMediator` devuelven `false` para todos; sumado a que 645 de
646 identidades canónicas no están en el legacy, hoy se deniega hasta el propio
perfil del usuario. De ahí los 2.388 `deny→allow`: no son ampliación de
privilegio, son restitución de acceso que el bug quitaba.

**Los 493 `allow→deny`** son el scope `self` de las identidades que existen sólo
en el legacy. No pierden nada real: el login desplegado resuelve contra
`config.USERS_DB` (el canónico), así que **no pueden autenticarse**; su único
"acceso" actual sería presentando un `x-user-id` no verificado. Retirarlo cierra
una superficie de suplantación. El argumento es estructural, no de actividad: no
se apoya en `lastLoginAt`.

**Limitación declarada:** los 20 grupos productivos tienen **0 `schoolId`**, así
que el scope `school` no es resoluble para nadie en **ninguno** de los dos
modelos y esta comparación no pudo ejercitarlo. Es una brecha de datos
preexistente, ajena a este cambio, y debe cubrirse antes de confiar en el
aislamiento por institución.

## 3.c Auditoría del contrato de grupos sobre el padrón canónico

623 lectores / 22 mediadores / 1 administrador; 20 grupos en 15 instituciones
(13 mono-grupo, 2 multi-grupo).

- **Integridad referencial limpia:** 0 `groupIds` inexistentes, 0 `groupIds` de
  otra institución.
- Lectores por `groupIds`: 402 con cero, 221 con uno, 0 con varios.
- De los 402 sin grupo, **400 son usuarios sintéticos** `_loadtest_marker` cuya
  institución no tiene ningún grupo.
- **Sólo 2 lectores reales** quedan sin grupo, y su institución sí tiene grupos:
  el administrador los resuelve eligiendo en el formulario, que es justamente el
  resultado buscado (hoy están huérfanos en Aula Viva).
- **0 casos legítimos bloqueados** por el contrato nuevo.
- Mediadores y administradores no requieren grupo: contrato preservado.

## 4. Deuda abierta

- **CHP-ID-01 no está desplegado.** En producción, `scopeAccess.mjs` todavía
  hardcodea el padrón legacy (verificado read-only el 2026-07-27). El aislamiento
  institucional sigue roto en prod hasta su GREEN DEPLOY.
- **Preflight obligatorio — `docker-compose.prod.yml` del repo está
  desincronizado:** declara `USERS_DB: /data-critical/usuarios_colegios_oro.json`
  (sin `/app`), mientras el compose realmente desplegado
  (`/opt/chibaleteplus/docker-compose.yml`) toma la variable de su `env_file` con
  el valor correcto `/app/data-critical/usuarios_colegios_oro.json`. Con la regla
  de 01B, desplegar desde el archivo del repo **abortaría el arranque**. Hay que
  corregirlo antes de cualquier recreación de contenedores.
- **Los 20 grupos productivos no tienen `schoolId`**, así que el scope `school`
  no autoriza a nadie en ningún modelo. Brecha de datos preexistente que hay que
  cerrar antes de confiar en el aislamiento institucional.
- **`scripts/seed-local-admin.mjs` sigue apuntando por defecto al padrón
  legacy** y lo escribe. Ya no sirve para nada (el runtime no lo lee) y
  contradice `DO NOT WRITE`: debe repuntarse al canónico o retirarse. Queda
  fuera del alcance de 01B por la restricción de diff.
- **`PUT /api/users/:id` no valida pertenencia institucional** de los `groupIds`
  (sí rechaza los inexistentes). El formulario ya no puede enviar uno ajeno,
  pero la validación de servidor correspondiente queda pendiente.
- Los 2 ids duplicados dentro del legacy no se tocan: el archivo no se modifica.
- La migración a `identity.db` queda fuera de alcance; esta unidad no la habilita
  ni la bloquea.
