# CHP-AULA-VIVA-CANONICAL-PRINCIPAL-01A — Principal canónico en los routers de Aula Viva

**Veredicto:** `GREEN-AULA-VIVA-CANONICAL-PRINCIPAL-LOCAL-AND-PUBLISHED`
**Alcance:** local. Publicado en `origin/chp/mook-contract-00`. **NO desplegado.**
**Fecha:** 2026-09-14.

Cierra la **única brecha arquitectónica** que identificó
`docs/ops/CHP_M2_M5_ARCHITECTURE_CLOSURE_AUDIT_01.md` (`d54a827`).

---

## 1. Baseline

```text
Rama: chp/mook-contract-00
HEAD: d54a82737d7c308382a157b45df5f768e8709fc4
Local == remoto (git ls-remote, sin fetch)
Tracked limpio · 3 stashes y 5 untracked preexistentes, sin abrir
```

## 2. Los seis sitios

Inventario cerrado y revalidado contra HEAD antes de editar. No apareció ninguna
séptima lectura productiva dentro de estos dos routers.

| # | Archivo | Línea (antes) | Uso del principal |
|---|---|---|---|
| 1 | `institutionalRouter.mjs` | 65 | `requireScope()` → `evaluateScopeAccess` de los 12 endpoints institucionales |
| 2 | `operationalRouter.mjs` | 148 | `emitTeacherViewedStudent({ callerId })` en el timeline |
| 3 | `operationalRouter.mjs` | 190 | `acknowledgeRecommendation({ by })` — ack |
| 4 | `operationalRouter.mjs` | 214 | `acknowledgeRecommendation({ by })` — dismiss |
| 5 | `operationalRouter.mjs` | 239 | `teacherId` de `POST /interventions` |
| 6 | `operationalRouter.mjs` | 292 | `emitMediatorReviewedCohort({ callerId })` |

## 3. Cadena de autoridad

Los **29 handlers** de ambos routers están montados detrás de `requireUserAuth`,
inyectado desde `server.js`. Ese middleware resuelve la identidad así:

- **Con emisión de sesión activa** — `sessionAuth.authenticate(req)` valida la
  sesión firmada, rechaza `subject_mismatch` con 401, comprueba que la cuenta
  esté activa y puebla `req.auth` **y** `req.user`.
- **Sin emisión de sesión (`off`)** — resuelve con `reqUserId(req)`, verifica que
  el usuario exista y esté activo, y puebla `req.user`.

En **ambos** caminos el handler solo se ejecuta con `req.user` ya poblado. No
aplicó `STOP-AULA-VIVA-ROUTE-AUTHORITY-INCOMPLETE`.

El principal efectivo en los seis sitios es, literalmente, la expresión que ya
estaba demostrada en `server/aulaViva/scopeAccess.mjs:67`, en
`server/server.js:3268` (`reqUserId`) y en las rutas de mediación de Leo
(`server.js:7868`, `25d0a76`):

```js
req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id']
```

El tercer término es la **compatibilidad legacy ya validada**: después de
`requireUserAuth` nunca se alcanza con un valor sin verificar, porque `req.user`
siempre está presente. Se conserva para que la precedencia sea idéntica en todo
el producto y no nazca una variante.

## 4. Allowlist

| Archivo | Cambio |
|---|---|
| `server/aulaViva/institutionalRouter.mjs` | sitio 1 + nota de contrato |
| `server/aulaViva/operationalRouter.mjs` | sitios 2–6 + nota de contrato |
| `server/__test__/aulaVivaInstitutional.test.js` | sección `[CANON]`, 11 aserciones |
| `server/__test__/aulaVivaOperational.test.js` | sección `[CANON]`, 13 aserciones |
| `docs/ops/CHP_AULA_VIVA_CANONICAL_PRINCIPAL_01A.md` | este documento |

**`scopeAccess.mjs` no se tocó**: ya tenía la precedencia correcta. No se creó
test nuevo, helper, middleware ni capa. No se modificaron endpoints, parámetros,
respuestas, payloads, códigos HTTP ni políticas CIS.

## 5. Invariante implementado

Un único invariante en los seis sitios, sin excepción por ruta, rol, grupo,
institución ni cabecera. Al terminar, **ninguno de los dos routers toma una
decisión de identidad leyendo una cabecera**: toda aparición de
`req.headers['x-user-id']` está dentro de la precedencia canónica, y el test lo
fija comparando conteos sobre el código sin comentarios.

## 6. Matriz de identidad y alcance

Verificada con un stub que emula `requireUserAuth` en modo sesión firmada.

| Caso | Resultado |
|---|---|
| Sesión firmada **sin** `x-user-id` | el router resuelve el alcance con normalidad |
| Sesión + cabecera coincidente | mismo status y **respuesta idéntica** byte a byte |
| Sesión + cabecera divergente | **401 `subject_mismatch`** — la cabecera no sustituye a la sesión |
| Mediador de otra institución | denegado por CIS |
| Principal con sesión pero desconocido en el padrón | denegado (default-deny) |
| Administrador con sesión | alcance global vigente |
| Timeline con principal reconocido y sin cabecera alguna | **200** |
| Compat legacy sin sesión | idéntica al comportamiento previo |

## 7. Protección contra falsificación

La prueba fuerte no es el status: es el **actor persistido**. Con una sesión de
`med_sesion` y una cabecera `x-user-id: IMPOSTOR` deliberadamente falsa:

- `pedagogical_recommendations.acknowledged_by` = **`med_sesion`** (ack y dismiss);
- `pedagogical_interventions.teacher_id` = **`med_sesion`**;
- `IMPOSTOR` **no** aparece en ninguna de las dos tablas;
- un `teacherId: 'IMPOSTOR_BODY'` inyectado en el cuerpo tampoco sustituye al
  principal;
- `query` y parámetros falsificados no alteran el alcance.

## 8. Hermeticidad

Los dos tests ya resolvían todos sus stores a un `mkdtemp`
(`EVENTS_SQLITE_PATH`, `INSIGHTS_SQLITE_PATH`, `USERS_DB`, `GROUPS_DB`,
`SCHOOLS_DB`) antes de importar los módulos, y el operacional afirma
explícitamente que los handles apuntan al temporal. Las secciones nuevas usan esa
misma infraestructura: cero fixtures fuera del temporal, cero apertura de stores
reales, sin servidor productivo y sin Chrome.

## 9. Pruebas

| Gate | Resultado |
|---|---|
| `aulaVivaInstitutional` (con `[CANON]`) | **55/55 ✓** |
| `aulaVivaOperational` (con `[CANON]`) | **64/64 ✓** |
| `cisScopeAccess` | **69/69 ✓** |
| `organizationScope` | **36/36 ✓** |
| `sessionIdentity` | **42/42 ✓** |
| `sessionIdentityIntegration` | SKIP documentado (POSIX-only) |
| `LongitudinalStudentTimeline.structural` | **71/71 ✓** |
| `npm run build` | **✓ built in 51s** |
| `npm run typecheck:baseline` | **✅ sin regresiones** |
| `npm run lint:evidence` | **OK — 871 archivos, 0 violaciones** |
| `git diff --check` | limpio |

Las suites preexistentes pasan **sin modificar sus casos**: su stub de auth no
puebla `req.auth` ni `req.user`, así que ejercitan la rama de compatibilidad
legacy y demuestran que no hubo regresión.

CI no se modificó.

## 10. Cero producción

Sin deploy, SSH, Docker, flags ni activación. No se abrió ningún store real. Solo
cuatro archivos de código y prueba, más este documento.

## 11. Estado arquitectónico

```text
M2–M5_ARCHITECTURE: COMPLETE
```

Se cierra la brecha señalada por `d54a827`. Esto **no** significa que M2–M5 estén
operativamente cerrados: siguen pendientes los despliegues, las activaciones de
flags, la purga histórica autorizada, COMP-05 como decisión humana, la
dependencia de campo de M1 y el **evidence pack reproducible**.

## 12. Único siguiente paso

Validación del evidence pack de release. **No queda arquitectura general
pendiente**; el trabajo siguiente es de validación, no de construcción.
