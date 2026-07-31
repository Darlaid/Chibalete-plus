# Deuda — CHP-SEC-AUTHZ-AUTHENTICATED-GETS-01

**Registrada:** 2026-07-31, durante `CHP-STATS-LEGACY-PERF-OBS-01A-R2`.
**Estado:** abierta. **No ejecutar todavía.**

---

## Hallazgo

`requireAdminAccess` y `requireAuth` desvían **todos los `GET`** a
`allowAuthenticatedGetOrReject`, que autoriza a cualquier principal autenticado.
En consecuencia, **ninguna ruta `GET` del sistema es admin-only**: una cuenta de
lector activa puede leerlas todas.

Verificado con dobles sintéticos sobre la factoría real (`server/lib/adminAuth.js`):

| Petición | Resultado |
|---|---|
| `GET` sin cabeceras | 401 |
| `GET` con `x-user-id` de lector | **200** |
| `GET` con `x-user-id` de mediador | **200** |
| `POST` con `x-user-id` de lector | 401 |

**No es un defecto introducido.** Es la política que dejó el fix P0 de 2026-05
(hallazgo S1 crítico): cerró el bypass **anónimo** —antes, `if (req.method ===
'GET') return next()` dejaba pasar cualquier GET sin credencial— y conservó
deliberadamente el acceso autenticado sin rol para no romper el preflight
`GET /api/content/:id/access` que usa todo visor. `server.js` lo documenta y
registra el residual: *«el IDOR de lectura entre usuarios autenticados sigue»*.

## Alcance

**16 rutas `GET`** con `requireAdminAccess` o `requireAuth`, entre ellas:

```
/api/users
/api/schools
/api/groups
/api/groups/:groupId/candidates
/api/groups/:groupId/members
/api/access/by-user/:userId
/api/system/metrics
/api/admin/membership/validate
```

Algunas devuelven datos institucionales y de estudiantes.

## Qué debe hacer la unidad futura

1. **Inventariar las 16 rutas** con su contenido real y su sensibilidad.
2. **Mapear consumidores del frontend** ruta por ruta: cuáles necesita una
   sesión de lector y cuáles no debería haber llamado nunca.
3. **Clasificar** en pública autenticada / institucional / administrativa.
4. **Introducir un middleware estricto** para la clase administrativa que exija
   admin secret o rol `administrador` **también en GET**.
5. **Migrar a sesiones firmadas** y retirar `x-user-id` como portador de
   identidad, que es el problema de fondo: es una cabecera controlada por el
   cliente.
6. **Plan de compatibilidad y rollout** con canary, porque endurecer
   indiscriminadamente rompería los visores.

## Mitigación ya aplicada

`CHP-STATS-LEGACY-PERF-OBS-01A-R2` **no amplió** ninguna ruta existente. Creó
`GET /api/admin/system/metrics/request-context` con un middleware nuevo y
estrecho (`requireOperationalAdminSecret`) que solo acepta el ADMIN_SECRET
file-only. Es el patrón a replicar para superficies operacionales nuevas mientras
esta deuda siga abierta.

## Por qué no se ejecuta ahora

Tocar `allowAuthenticatedGetOrReject` afecta a 16 rutas y al frontend en
producción. Merece su propia unidad, con inventario, canary y rollback — no un
cambio incidental dentro de una unidad de observabilidad.
