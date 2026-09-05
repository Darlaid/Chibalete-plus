# CHP-ACCESS-EXTERNADO-ADMIN-MEMBERSHIPS-01C — Mediadores de Externado y limpieza del administrador

Veredicto: `GREEN-EXTERNADO-ADMIN-MEMBERSHIPS-VERIFIED-AND-PUBLISHED`.
Fecha de ejecución: 2026-09-05 (UTC).
Alcance: `mediatorIds` de dos grupos. No toca lectores, roles globales, estados,
credenciales, contenidos, pedagogía, reglas de acceso, código ni contenedores.

---

## 1. Baseline

```text
Rama:  chp/mook-contract-00
HEAD:  1ee5b00b156a0d8fc1d0530b918060dec9029207
Local == remoto · worktree tracked limpio · los mismos 3 untracked
```

Continuidad verificada con el estado que dejó `CHP-ACCESS-FILBO-CONSOLIDATE-01B-R1`:
se comparó el hash SHA-256 de cada uno de los 647 usuarios y 20 grupos contra el
estado esperado de aquella unidad. Resultado: **0 divergencias**, es decir, ninguna
mutación concurrente entre ambas unidades.

## 2. Preflight

| Objeto | Estado previo |
|---|---|
| `user-1776618688276` | `mediador`, `active`, `school-externado`, 0 memberships |
| `user-1776913437558` | `mediador`, `active`, `school-externado`, 0 memberships |
| `user-1774362611303` | único administrador global, `active`, mediador solo en Nuevo Bosque |
| Nuevo Bosque `group-1776199165029` | 80 lectores, 11 mediadores (10 canónicos + administrador) |
| Villas `group-1776199266164` | 80 lectores, 10 mediadores |

Dos detalles decisivos del preflight:

- El administrador ocupaba `mediatorIds[0]` de Nuevo Bosque, y el `teacherId` de ese
  grupo era `user-1774362610313`, una referencia ausente del padrón.
- En Villas, `teacherId` ya coincidía con `mediatorIds[0]`, de modo que añadir los
  dos mediadores al final de la lista lo deja sin cambio.

Servicios sanos y sin mutación concurrente.

## 3. Vía canónica elegida

`PUT /api/groups/:id` con `{"mediatorIds": [...]}` es el único endpoint que
administra mediadores: añadir, quitar y mover miembros operan sobre
`studentIds`/`memberIds`, no sobre `mediatorIds`.

Se simuló sobre copia en memoria antes de escribir. Puntos verificados:

- El delta de miembros es 0, así que `applyGroupMembersChange` no se activa y el
  store de usuarios **no se reescribe**: los `groupIds` de las tres cuentas quedan
  intactos.
- El guard de extinción de *fallback* no aplica: ambos grupos tienen miembros
  explícitos.
- La relación interinstitucional (cuentas de `school-externado` mediando en dos
  instituciones distintas) fue autorizada expresamente para esta unidad. Este
  endpoint no aplica el *gate* cross-school, y no se modificó ningún
  `organizationId` para sortear control alguno.

Un solo `PUT` por grupo, construido con datos frescos leídos justo antes y con
aserciones previas sobre el estado esperado.

## 4. Diff autorizado y observado

| Objeto | Antes | Después |
|---|---|---|
| Nuevo Bosque `mediatorIds` | 11 (admin + 10 canónicos) | 12 (10 canónicos + 2 Externado) |
| Nuevo Bosque `teacherId` | `user-1774362610313` (colgante) | `user-1779493121246-081` |
| Villas `mediatorIds` | 10 | 12 |
| Villas `teacherId` | `user-1779493121246-171` | sin cambio |
| Usuarios | — | 0 registros modificados |

Hashes de los stores:

| Store | Antes | Después |
|---|---|---|
| `data/groups_db.json` | `3a5518c3…6785` | `dce5d47a…5372` |
| `data-critical/usuarios_colegios_oro.json` | `27291223…1d04` | `27291223…1d04` (sin cambio) |
| `data/schools_db.json` | `a0301221…db27` | `a0301221…db27` (sin cambio) |

La normalización del `teacherId` de Nuevo Bosque cumple las cuatro condiciones
autorizadas: el valor final es uno de los 10 mediadores canónicos preexistentes,
es `mediatorIds[0]` tras retirar al administrador, no es una cuenta de Externado y
el orden relativo de los 10 canónicos se conserva.

## 5. Operaciones ejecutadas

| Orden | Endpoint | Efecto | Resultado |
|---|---|---|---|
| 1 | `PUT /api/groups/group-1776199165029` | +2 mediadores Externado, −administrador | 200 |
| 2 | `PUT /api/groups/group-1776199266164` | +2 mediadores Externado | 200 |

Autoridad de máquina mediante el secreto administrativo *file-only*, leído en
memoria: nunca se imprimió ni viajó por la línea de comandos. Tras cada grupo se
comparó el registro completo contra el estado simulado.

## 6. Rollback

Preparado antes de escribir y **no utilizado**. Manifiesto mínimo sin PII ni
credenciales: `mediatorIds` y `teacherId` previos de ambos grupos, memberships
previas de las tres cuentas en el espejo y hashes previos de los stores. La
restauración sería por el mismo endpoint, en orden inverso.

Asimetría declarada y autorizada: el `teacherId` colgante de Nuevo Bosque no se
restaura. Apuntaba a una cuenta inexistente y `normalizeGroup` lo recalcula desde
`mediatorIds` en toda escritura.

## 7. Validación

```text
cambiados vs ANTES: users=0  groups=2
divergencias vs ESPERADO: users=0  groups=0
VEREDICTO_HASHES: EXACTO

Nuevo Bosque:  80 lectores · 12 mediadores · teacherId canónico
Villas:        80 lectores · 12 mediadores · teacherId sin cambio
Externado:     cada cuenta con 2 memberships mediator, 0 como lectora
Administrador: 0 memberships · rol administrador · active
groupIds de las tres cuentas: [] (intactos)
Operaciones pendientes: 0
```

Espejo SQLite (`identity.db`, apertura `mode=ro`): ambos grupos con 12 memberships
`mediator` y 80 `member`, todas `active`; cada cuenta de Externado con sus dos
memberships de mediador; el administrador sin ninguna. FilBo permanece en
1 mediador y 61 miembros, exactamente como lo dejó la unidad anterior.

Smoke administrativo, solo códigos y conteos:

```text
GET /api/content   -> 200  n=108
GET /api/users     -> 200  n=647
GET /api/groups    -> 200  n=20
GET /api/schools   -> 200  n=4
GET /api/content/:id/access (admin) -> 200 allowed=true
```

Servicios: los cuatro contenedores de Chibalete+ *healthy*, APIs con 9 días de
uptime y sin reinicios.

## 8. Cero efectos fuera de alcance

Los únicos registros modificados son los dos grupos del diff. Cero usuarios
tocados, y por tanto intactos los roles globales, estados de cuenta, nombres,
colegios, credenciales y `organizationId`. Los 160 lectores de ambos grupos siguen
siendo los mismos. Nombres, instituciones y tipos de grupo sin cambio. FilBo,
las dos cuentas FilBo sin grupo, contenidos, pedagogía, reglas de acceso y
`ACCESS_FALLBACK_MODE` no se tocaron. Siguen 20 grupos y 647 usuarios.

## 9. Deuda registrada, no corregida

- `PEDAGOGY-PROTECTION-PENDING`: el filtro de material pedagógico vive solo en el
  frontend y `/uploads/` se sirve sin sesión.
- Asimetría de *gates*: `PUT /api/groups/:id` no aplica la validación cross-school
  que sí aplican añadir, quitar y mover miembros. En esta unidad esa ausencia fue
  la vía autorizada, pero sigue siendo una asimetría del contrato.
- El corte de FilBo del 16 de septiembre continúa preparado y sin ejecutar.
