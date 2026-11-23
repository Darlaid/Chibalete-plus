# CHP V9 · Bloque III · F5-D — Autorizaciones y asignaciones institucionales

Estado: verificado y corregido en laboratorio. **Sin desplegar.** Solo APP.

## Tres cosas distintas

| Capa | Qué responde | Dónde vive | Quién la cambia |
|---|---|---|---|
| Alcance institucional (CIS) | ¿Esta persona pertenece a esta institución, media este grupo, es miembro de este grupo? | Padrón y grupos (`organizationId`, `mediatorIds`, `memberIds`) | Solo administración |
| Autorización pedagógica | ¿Puede verse el seguimiento individual de este lector (A2)? ¿Este mediador tiene su compromiso vigente (C005)? | Registro de decisiones (solo-añadir, autenticado) | GVA/AT con evidencia; el lector o su representante al activar |
| Permisos de operación | ¿Puede dar altas, bajas, traslados, designar mediadores, ver métricas globales? | Rol `administrador` con sesión, o autoridad de máquina | Solo administración |

Las autorizaciones familiares B2C (A0, A1 de una cuenta personal) no intervienen aquí: una compra no crea alcance institucional y la lectura personal no entra en ninguna vista institucional.

## Matriz

| Quién | Nómina de su grupo | Seguimiento individual | Agregados del grupo | Otra institución u otro curso | Asignaciones |
|---|---|---|---|---|---|
| Mediador del grupo, C005 vigente | Sí | Solo lectores con A2 vigente, y solo de las obras del grupo | Sí | No | No |
| Mediador del grupo, sin C005 | No (retenida y declarada) | No | No | No | No |
| Mediador sustituido o dado de baja | No, de inmediato | No | No | No | No |
| Lector | Perfil público de su institución | Solo el suyo | No | No | Solo unirse a un club abierto de su institución |
| Lector personal (B2C) | Nada institucional | Solo el suyo | No | No | No |
| Administración (sesión) | Sí | Sí (ver «Observaciones») | Sin desglose por lector en tablero e informe | Todas | Sí |
| Registro no verificable | No | No | No | No | — |

## Defectos reproducidos y corregidos

1. **Resumen del grupo tras un traslado o una baja.** El resumen analítico (`/api/groups/:id/analytics-summary`) se conserva hasta 5 minutos por réplica con su nómina dentro. Un lector trasladado seguía apareciendo, con su fila y en los agregados, ante el mediador del curso anterior. Ahora quién está en el grupo se decide en cada petición, fuera de lo conservado.
2. **Auditoría de asignaciones sin autor.** Veinte registros de auditoría (altas, bajas, traslados, cambios de grupo y de cuenta) tomaban el autor de la cabecera `x-user-id`. Con sesiones el navegador no la envía: el registro quedaba con `actor: null`; y quien la enviara podía atribuirse a otra cuenta. Ahora el autor es la sesión o, sin ella, la autoridad de máquina (`admin-secret`).
3. **Designación de mediadores sin constancia.** Cambiar los mediadores de un grupo (`PUT /api/groups/:id`) y crear un grupo no dejaban registro. Ahora quedan `group.mediators_change` (quiénes entran y salen) y `group.create`.

## Verificado sin cambios

- Curso no asignado, otra institución y lector personal: ninguna de 80 rutas entrega un lector, su lectura ni una nota; tampoco se puede escribir seguimiento.
- C005 revocado con la sesión abierta y las cachés calientes: efecto inmediato en las dos réplicas; al restituirlo, vuelve sin reiniciar.
- A2 revocada: se retiran las 18 rutas individuales de ese lector y su fila en tablero, informe y resumen. Sigue en la nómina. Queda visible qué obras tiene asignadas por el colegio (asignación, no seguimiento).
- Cambio de curso: el mediador nuevo no recibe la lectura de la obra del curso anterior ni las notas del mediador anterior.
- Sustitución de mediador: efecto inmediato. Baja (cuenta desactivada): la sesión abierta deja de servir.
- Lectores: no abren obras de otra institución ni de otro curso; no pueden unirse a grupos ajenos.
- Registro corrupto: ninguna ruta entrega lectores; los lectores del colegio siguen leyendo.
- Concurrencia y revalidación: ninguna petición iniciada después de una revocación entrega datos; `If-None-Match` nunca responde «304 sin cambios».
- Lectura personal: no aparece en ninguna ruta del mediador ni mueve las cifras del curso.

## Operación con las herramientas actuales

| Operación | Herramienta | Evidencia |
|---|---|---|
| Alta o baja de un lector en un grupo | Administración → Grupos; `POST`/`DELETE /api/groups/:id/members` | Auditoría `membership.assign` / `membership.remove`, con autor |
| Traslado dentro de la institución | `POST /api/groups/:destino/members/move` | `membership.move`, con autor |
| Traslado entre instituciones | No existe como operación única (`422 cross_school_assignment`): baja en una, alta en la otra | Las dos anotaciones anteriores. El historial no acompaña al lector |
| Designar, sustituir o retirar mediadores | `PUT /api/groups/:id` con `mediatorIds` | `group.mediators_change`, con autor |
| Compromiso del mediador (C005) y A2 | `ops/a2/decision_operator.mjs` | Línea del registro: fecha, medio, calidad, referencia |
| Baja de un mediador o de una cuenta | Administración → Usuarios → desactivar | `disable_user`, con autor; cierra sus sesiones |
| Suspensión o terminación del servicio de una institución | Desactivar sus cuentas y retirar las reglas de acceso de sus grupos | No hay una operación única «suspender institución» |
| Cobertura de decisiones | `ops/a2/decision_coverage.mjs` (solo lectura, agregada) | Recuentos |

## Qué debe estar configurado en producción

No se intervino. Debe existir antes de operar:

- Registro de decisiones (`CHP_A2_REGISTRY`) y clave de sujeto, montados en las dos réplicas, fuera de `data/` y de los respaldos.
- C005 anotado para cada mediador activo y A2 para cada lector con seguimiento, desde fichas verificadas. Sin ellos el sistema retiene: no es un fallo.
- Cada grupo con sus `mediatorIds` y con una regla de acceso de ámbito `group` que nombre sus obras. Sin regla, el mediador no ve actividad por obra.
- `SESSION_AUTH_MODE=enforce` y una imagen que incluya el registro de decisiones. En la revisión de solo lectura del 2026-11-14 producción estaba en `enforce` y su imagen de entonces no traía el registro; no se reverificó en esta unidad.
- Auditoría de usuarios (`USER_AUDIT_DB`) en almacenamiento persistente.

## Observaciones que requieren decisión

| # | Observación | Estado actual |
|---|---|---|
| O1 | La administración de plataforma, con sesión, consulta el seguimiento individual de cualquier lector, incluida la lectura personal de una cuenta B2C | Es el alcance histórico del rol. No queda registro de cada consulta |
| O2 | Un lector recibe el perfil público (nombre) de todos los lectores de su institución y la composición de sus grupos, no solo de su curso | Contrato previo, sin cambio |
| O3 | Las respuestas con datos de lectores no llevan `Cache-Control` (solo `ETag`); el resumen del grupo sí lleva `no-store`. El edge no cachea `/api` | Se revalidan siempre; no se reprodujo ninguna exposición |
| O4 | No existe «suspender institución» ni «trasladar entre instituciones» como operación única | Se hace por pasos, todos auditados |

## Pruebas

`server/__test__/institutionalAccessHttp.test.mjs` — servidor real, dos réplicas, sesiones reales; dos instituciones, tres cursos, dos clubes; en `test:v81` (CI).
