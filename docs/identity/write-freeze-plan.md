# Plan de write freeze para el apply del manifiesto

**Unidad:** CHP-ID-METRICS-DEPLOY-01A-R1 · **Estado:** DISEÑADO — **NO ACTIVADO**

---

## 1. Por qué hace falta

El intento anterior de despliegue se detuvo por `MANIFEST HASH DRIFT`: entre la
generación del manifiesto y el apply, producción registró un alta legítima de
usuario. El migrador hizo lo correcto —abortar—, pero el problema se repetirá:
mientras el sistema esté vivo, **cualquier escritura invalida los hashes**.

Medido sobre el propio historial de backups: el padrón de usuarios cambió de
contenido **tres veces en un mismo día** manteniendo el tamaño constante
(`969a66b3` → `6ce8449b` → `33377e4a`). La causa del cambio a tamaño constante
es `lastLoginAt`: un ISO-8601 siempre ocupa 24 caracteres, así que **un simple
login basta para romper el hash sin alterar el tamaño del archivo**.

Conclusión operativa: no basta con «aplicar rápido». Hace falta una ventana en
la que **nadie pueda escribir** los tres stores.

---

## 2. Qué escribe cada store

| Store | Escritores |
|---|---|
| `usuarios_colegios_oro.json` | `POST /api/auth/login` (**`lastLoginAt`**, y auto-upgrade de hash), `POST /api/users`, `PUT /api/users/:id`, `DELETE /api/users/:id`, `POST /api/invite-user`, `POST /api/auth/reset-request`, `POST /api/auth/reset-confirm`, `assignUserToGroup` / `removeUserFromGroup` / `syncGroupMembership`, `scripts/seed-local-admin.mjs` |
| `groups_db.json` | `POST /api/groups`, `PUT /api/groups/:id`, `DELETE /api/groups/:id`, endpoints de membresía, la mitad «grupos» de `POST /api/users` y `PUT /api/users/:id`, `syncGroupMembership` |
| `schools_db.json` | `POST /api/schools`, `PUT /api/schools/:id`, renombrado de colegio |

**El login es el escritor más peligroso**: no es una operación administrativa,
puede ocurrir en cualquier momento y nadie lo asocia mentalmente con «escribir
el padrón».

---

## 3. Opción preferida — freeze reversible en el edge

Bloquear en `chibalete_edge` (nginx) **solo** las rutas que escriben, devolviendo
`503` con `Retry-After`, y dejando pasar todo lo demás (lectura de contenido,
progreso, visores). Los estudiantes que ya están leyendo no se enteran.

```nginx
# /opt/chibaleteplus/edge/conf.d/freeze.conf  — incluir y recargar; borrar y recargar para revertir
location = /api/auth/login            { return 503; add_header Retry-After 300 always; }
location = /api/auth/reset-request    { return 503; add_header Retry-After 300 always; }
location = /api/auth/reset-confirm    { return 503; add_header Retry-After 300 always; }
location = /api/invite-user           { return 503; add_header Retry-After 300 always; }
location ~ ^/api/users(/.*)?$         { limit_except GET { deny all; } }
location ~ ^/api/groups(/.*)?$        { limit_except GET { deny all; } }
location ~ ^/api/schools(/.*)?$       { limit_except GET { deny all; } }
```

- **Reversible**: `rm freeze.conf && nginx -s reload`. Sin recrear contenedores.
- **Verificable**: `POST /api/users` → 403/503 y `GET /api/users` → 200.
- **Acotado**: solo escritura de identidad; la lectura sigue viva.

⚠️ Hay que confirmar antes que ninguna ruta de escritura vive fuera de esos
prefijos. La lista de §2 es el criterio; si aparece una ruta nueva, el freeze la
deja pasar y **el drift vuelve**.

## 4. Alternativa — pausa breve de ambas API

Si el edge no puede filtrar con garantía:

```
docker pause chibalete_api_1 chibalete_api_2
# hash final → apply → verificación inmediata
docker unpause chibalete_api_1 chibalete_api_2
```

`pause` (no `stop`) congela los procesos sin cerrar conexiones ni perder estado,
y descarta cualquier escritura porque no hay ejecución. Coste: indisponibilidad
total durante la ventana. Es el plan B, no el preferido.

---

## 5. Secuencia de la ventana

1. Backup estructurado manual → snapshot verificado.
2. Copia byte a byte de los tres JSON a una ruta exclusiva de la unidad.
3. **Activar freeze** y verificarlo (una escritura de prueba debe ser rechazada).
4. **Hash final** de los tres stores.
5. Si difiere del manifiesto → **regenerar el manifiesto dentro de la ventana**
   (ya no puede haber drift concurrente) o abortar.
6. `--apply` una sola vez.
7. Verificar invariantes y hashes nuevos.
8. Segunda ejecución → `0 cambios / IDEMPOTENT`.
9. **Desactivar freeze** y verificar que las escrituras vuelven.
10. Recién entonces, desplegar código.

**Duración objetivo: menos de 5 minutos.** El apply toca 4 registros en 3
archivos pequeños; lo que domina es la verificación.

---

## 6. Qué NO debe hacer el freeze

- **No debilitar los hashes.** La tentación de «ignorar `lastLoginAt` al
  comparar» convertiría el guard en decorativo: si se ignora un campo, se ignora
  también un cambio real en ese campo.
- **No ignorar cambios concurrentes.** Si el hash difiere con el freeze activo,
  algo escribió que no debía: es una anomalía que investigar, no un reintento.
- **No dejarse activo.** El freeze bloquea el login: olvidarlo equivale a una
  caída silenciosa. Debe tener responsable y hora de expiración.

## 7. Rollback del freeze

Borrar `freeze.conf` y recargar nginx (o `docker unpause`). No requiere
coordinación con el estado del apply: son independientes. Si el apply falló, el
rollback de datos es la restauración byte a byte del paso 2.

---

## 8. Verificación posterior

Tras desactivar el freeze, confirmar que vuelve a funcionar lo que se bloqueó:
un login válido responde 200 y `lastLoginAt` se actualiza. Un freeze que no se
levanta del todo es peor que no haberlo puesto.
