# Fuente canónica de usuarios y contrato de grupos

**Unidad:** CHP-ID-CANON-01A · **Estado:** GREEN LOCAL — NO DESPLEGADO

---

## 1. Decisión canónica

`data-critical/usuarios_colegios_oro.json` es la **única fuente de verdad** de
usuarios para autenticación, administración, creación y edición, roles,
permisos, scopes, Aula Viva, instituciones, memberships y asignaciones.

`data/users_db.json` queda clasificado como:

> **LEGACY_NON_CANONICAL — DO NOT DELETE — DO NOT WRITE — DO NOT READ AT RUNTIME**

Se conserva intacto por trazabilidad y respaldo. Su único uso admisible es
**seed de desarrollo local**, y solo si el desarrollador lo pide explícitamente
vía `USERS_DB`.

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

## 2. Resolución de la fuente

`server/config.js` es el **único** resolver:

```
USERS_DB (env)  →  si no está, data-critical/usuarios_colegios_oro.json
```

- **Cero fallback** al legacy. Si el archivo resuelto no existe, `server.js`
  aborta con un mensaje explícito en vez de degradar a otro padrón.
- `config.js` carga `.env` en import-time (antes lo hacía `server.js` **después**
  de resolver, así que un `USERS_DB` puesto en `.env` quedaba inerte). La env var
  real del container sigue ganando sobre `.env`.
- Si `USERS_DB` resuelve al padrón legacy: aviso ruidoso al arrancar en dev, y
  **fallo duro** con `NODE_ENV=production`.

Constantes exportadas: `USERS_DB`, `USERS_DB_CANONICAL_DEFAULT`,
`USERS_DB_LEGACY_NON_CANONICAL` (solo deprecación/tests), `resolveUsersDb(env)`,
`isLegacyNonCanonicalUsersDb(path)`.

Ningún otro archivo de runtime menciona `users_db.json` — verificado por
`server/__test__/identityCanonicalSource.test.js` §C.

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

## 4. Deuda abierta

- **CHP-ID-01 no está desplegado.** En producción, `scopeAccess.mjs` todavía
  hardcodea el padrón legacy (verificado read-only el 2026-07-27). El aislamiento
  institucional sigue roto en prod hasta su GREEN DEPLOY.
- Los 2 ids duplicados dentro del legacy no se tocan: el archivo no se modifica.
- La migración a `identity.db` queda fuera de alcance; esta unidad no la habilita
  ni la bloquea.
