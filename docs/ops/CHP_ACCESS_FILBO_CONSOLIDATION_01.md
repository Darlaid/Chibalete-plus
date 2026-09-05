# CHP-ACCESS-FILBO-CONSOLIDATE-01B-R1 — Consolidación canónica de FilBo

Veredicto: `GREEN-FILBO-R1-CONSOLIDATED-CUTOFF-PREPARED`.
Fecha de ejecución: 2026-09-05 (UTC).
Alcance: memberships y alineación institucional de la cohorte FilBo. No toca
contenidos, entitlements, pedagogía, código, Compose ni contenedores.

---

## 1. Baseline

```text
Rama:  chp/mook-contract-00
HEAD:  e1d8949e209f1e83aff3942314cfb9b498b3da42
Local == remoto · ahead/behind 0/0
Worktree: los mismos 3 untracked preexistentes
```

Producción: `chibalete_api_1` y `chibalete_api_2` sobre la imagen `api:e70c0f1`,
ambos *healthy* con 9 días de uptime, sin deploy concurrente.
Modos efectivos leídos en ambas réplicas: `IDENTITY_READ=json`,
`IDENTITY_DUAL_WRITE=1`, `IDENTITY_SQLITE_ENABLED=1`, `SESSION_AUTH_MODE=compat`,
`ACCESS_FALLBACK_MODE=open`.

## 2. Decisiones humanas autorizadas

Esta revisión R1 existe porque `01B` se detuvo con
`STOP-FILBO-API-HAS-UNAUTHORIZED-SIDE-EFFECTS`. Se autorizaron exactamente dos
variaciones adicionales, ambas necesarias y ambas verificadas:

1. **`teacherId` del grupo destino: `null` → `user-1785170474112`.**
   `normalizeGroup` sincroniza `teacherId = mediatorIds[0]` en toda escritura
   canónica sobre un grupo con mediadores. Es inevitable y determinista.
2. **`organizationId` de los 17 lectores legacy: ausente → `school-1777176810244`.**
   Sin ella, el *gate* cross-school de la API rechazaba 17 de los 24 traslados
   con `cross_school_assignment` y rollback de lote completo. El campo `colegio`
   de esas cuentas se conserva intacto por decisión explícita.

## 3. Diff previo y final

Hashes de los stores canónicos:

| Store | Antes | Después |
|---|---|---|
| `data-critical/usuarios_colegios_oro.json` | `4b00f2fb…2e80` | `27291223…1d04` |
| `data/groups_db.json` | `c938f6ea…2d9b` | `3a5518c3…6785` |
| `data/schools_db.json` | `a0301221…db27` | `a0301221…db27` (sin cambio) |

Diff autorizado y observado:

| Objeto | Antes | Después |
|---|---|---|
| Grupo destino `group-1777177383528` | 38 personas, `teacherId` nulo | 61 lectores + 1 mediador, `teacherId` = mediador |
| 11 grupos fuente | 24 lectores repartidos | presentes, 0 memberships |
| 17 lectores legacy | sin `organizationId` | `school-1777176810244`, `colegio` intacto |
| 24 lectores trasladados | `groupIds` = grupo fuente | `groupIds` = `[destino]` |
| Mediador `user-1785170474112` | lector + mediador | solo mediador |

## 4. Operación ejecutada

Tres bloques, en orden, contra `chibalete_api_1` por su IP interna, con
autoridad de máquina (`x-admin-secret`, *file-only*; el secreto se leyó en
memoria y nunca se imprimió ni se pasó por la línea de comandos).

| Bloque | Endpoint canónico | n | Resultado |
|---|---|---|---|
| A | `PUT /api/users/:id` con `{"organizationId": …}` | 17 | 17 × 200 |
| B | `POST /api/groups/group-1777177383528/members/move` | 11 | 11 × 200, `moved`=24, `failed`=0 |
| C | `DELETE /api/groups/group-1777177383528/members/:mediador` | 1 | 200, `removed`=true |

No se usó `PUT /api/groups/:id`, que omite el *gate* cross-school. Los 24
traslados pasaron por el endpoint que sí lo aplica, y lo aprobaron tras la
alineación institucional del bloque A.

Tras el bloque A se verificó el estado intermedio: exactamente 17 usuarios
modificados y 0 grupos.

## 5. Rollback

Preparado antes de escribir y **no utilizado**. Manifiesto mínimo sin PII ni
credenciales: `organizationId` previo de los 17, `groupIds` previo de los 24,
memberships previas de los 12 grupos, representación previa del mediador,
`teacherId` previo del destino y hashes previos de los stores. La restauración
sería por las mismas APIs canónicas, en orden inverso: reponer el doble rol,
devolver cada lector a su grupo fuente, retirar el `organizationId` de los 17.

Asimetría declarada: `teacherId` **no** es reversible a `null` por vía
canónica, porque `normalizeGroup` lo recalcula desde `mediatorIds` en cada
escritura. Es exactamente la variación que la decisión humana autorizó con
carácter permanente, y su valor coincide con el mediador que ya existía antes
de esta unidad.

## 6. Validación

Método de prueba: se calculó el hash SHA-256 de cada registro de los dos stores
(647 usuarios y 20 grupos) antes de la ejecución, y el hash esperado de cada
registro tras simular las tres operaciones en memoria. Terminada la ejecución
se recalcularon los hashes reales.

```text
cambiados vs ANTES:                users=25   groups=12
divergencias vs ESPERADO-DESPUÉS:  users=0    groups=0
VEREDICTO_HASHES: EXACTO
```

Estado final comprobado sobre el JSON activo:

```text
Destino:  62 personas · 61 member · 1 mediator · 0 doble rol
          teacherId = user-1785170474112 · todos existen · todos active
Fuentes:  11 grupos presentes · 0 members · 0 mediators
Legacy:   17 con organizationId canónico · 17 con colegio intacto
Traslado: 61 cuentas con groupIds == [destino]
          (el mediador queda con groupIds vacío, igual que el administrador
           global: su vínculo es mediatorIds, no la lista inversa)
Totales:  20 grupos · 647 usuarios · 0 desactivados
Operaciones pendientes: 0
```

SQLite de corroboración (`identity.db`, apertura `mode=ro`, con WAL presente):
el destino refleja 61 memberships `member` y 1 `mediator`, todas `active`;
`curso005` queda sin memberships; los 10 grupos legacy siguen fuera del espejo,
como antes de esta unidad; el mediador conserva una única membership de rol
`mediator`. JSON activo y espejo son coherentes.

Servicios: los cuatro contenedores de Chibalete+ siguen *healthy* y sin
reinicios; las APIs conservan sus 9 días de uptime.

## 7. Cero efectos fuera de alcance

Verificado registro a registro:

- Nuevo Bosque `group-1776199165029`: 80 miembros, 11 mediadores, `teacherId`
  colgante intacto, byte-idéntico.
- Villas de Aranjuez `group-1776199266164`: 80 miembros, 10 mediadores,
  byte-idéntico.
- Las dos cuentas FilBo sin grupo (`user-1777214026863`, `user-1778175346157`):
  sin cambios.
- Administrador global y las dos cuentas de Externado: sin cambios.
- Ningún grupo eliminado ni renombrado; ningún rol global, estado de cuenta,
  credencial, regla de acceso ni contenido modificado.
- `schools_db.json` sin cambios.

Los únicos registros tocados son los 25 usuarios y los 12 grupos que el diff
autorizado enumera.

## 8. Manifiesto de vencimiento

`docs/ops/CHP_ACCESS_FILBO_CUTOFF_20260916.json` — preparado, **no ejecutado y
no programado**.

```text
group_id:           group-1777177383528
institution_id:     school-1777176810244
cutoff_local:       2026-09-16T00:00:00-05:00
cutoff_utc:         2026-09-16T05:00:00Z
expected_users:     62   (61 readers + 1 mediator)
action:             accountStatus=disabled
sha256 (62 cuentas ordenadas):
ff19b8d4b17a01d92493cbbd8333391f04ae45def3693f3b6df54469c39d4d86
```

Excluye deliberadamente las dos cuentas FilBo sin grupo. El hash se calculó
sobre el estado real ya consolidado y coincide con el que había predicho la
simulación previa.

`accountStatus=disabled` sigue siendo la única barrera efectiva mientras
`ACCESS_FALLBACK_MODE=open`: una ventana temporal de grupo o una regla vencida
devolverían al usuario al camino de acceso abierto por defecto.

## 9. Deuda registrada, no corregida

- `PEDAGOGY-PROTECTION-PENDING`: el filtro de material pedagógico vive solo en
  el frontend, y `/uploads/` se sirve sin sesión.
- Asimetría de *gates*: `PUT /api/groups/:id` no aplica la validación
  cross-school que sí aplican añadir, quitar y mover miembros.
- `teacherId` colgante de Nuevo Bosque (`user-1774362610313`, ausente del
  padrón), fuera del alcance de esta unidad.
