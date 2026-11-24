# CHP V9 · Bloque III · F5-DP2 — Aislamiento de indicadores derivados

Estado: implementado y probado en laboratorio. **Sin desplegar.** Solo APP. Cierra el «límite conocido» de `CHP_V9_BIII_F5DP_PRIVACY_SCOPE.md`.

## Qué pasaba

Un lector de colegio que además lee obras compradas por su cuenta tenía indicadores derivados calculados con **toda** su actividad. El mediador ya recibía los del contexto de su curso (F7-C2). La administración (rol con sesión y autoridad de máquina) no:

| Indicador | Qué incorporaba | Causa |
|---|---|---|
| Estado del estudiante (`/api/students/:id/status`) | Libros iniciados y completados, porcentaje, última lectura | Sumaba todo el progreso del lector |
| Estado, lector sin obras del colegio | «Con contenido habilitado» si tenía una compra (también ante el mediador) | El acceso contaba la compra propia |
| Métricas del estudiante (`/api/metrics/student/:id`, máquina) | Sesiones, tiempo, obras, embudos; y los de una cuenta personal | Sin ámbito de obras |
| Aula Viva: línea de tiempo, perfil, señales, riesgo, vector, recomendaciones, impacto, cola de atención | Tiempo, continuidad, diversidad, compromiso, riesgo | El almacén derivado se calcula con todos los eventos del lector |
| Almacén derivado y series (materializador, series, impacto, cohorte de modalidad) | Perfiles y señales de lectores mixtos y de cuentas personales; sesiones globales | Los motores leían eventos sin clasificar |

Leo, los tableros de curso y de colegio y el resumen del grupo ya estaban acotados (F5-DP, 65E-B).

## Contrato

- **Titular**: su progreso, su biblioteca y sus métricas, completos. No cambia.
- **Mediación**: el contexto de sus cursos, como antes. Único cambio: la compra propia de un lector no altera su estado de acceso.
- **Administración** (rol y máquina): lectura institucional, es decir, todo menos la lectura personal. Una cuenta personal sigue cerrada, ahora también en `/api/metrics/student`.
- **Lectura personal**: la de una cuenta personal y la de las obras que un lector de colegio tiene solo por una compra propia. Un único clasificador, el de F5-DP (`personalReadingBoundary`). Una compra vencida o reembolsada sigue siendo personal (la regla no se borra).
- Sin evidencia institucional: `no_activity` / `insufficient`, con su aviso. Nunca un perfil ni un riesgo en cero.
- A2, C005, membresías, asignaciones y fórmulas: sin cambios.

## Cómo

1. **En la fuente.** `server/privacy/personalReading.mjs` recibe el clasificador de `server.js`. Los motores que leen eventos crudos lo aplican antes de calcular: materializador (incremental y reconstrucción), series, impacto de intervenciones, cohorte de modalidad y métricas v2. Una fila personal avanza la marca de agua y no despierta ningún cálculo: el almacén queda como si esa lectura no hubiera ocurrido. Si el clasificador falla para una cuenta, sus filas no entran.
2. **Al consultar.** Para un lector con obras personales, la administración no recibe las filas guardadas (pudieron calcularse antes de esta corrección): recibe los mismos indicadores calculados con las funciones de Aula Viva (`buildContextualView`) sobre sus eventos institucionales. Un lector sin compras conserva el almacén tal cual.
3. `status` y `metrics/student` filtran con el mismo clasificador.
4. La administración puede atender las recomendaciones de esa vista institucional; las guardadas de lectores sin compras, como antes.
5. Ante quien media, un curso sin obras se informa como tal («el curso no tiene obras asociadas») tenga o no el lector una compra; antes ese estado solo aparecía cuando la compra contaba como acceso.

## Cifras (laboratorio, lector mixto frente a su gemelo sin compras)

| Indicador, ante la administración | Antes | Ahora | Gemelo |
|---|---|---|---|
| Estado: obras / completadas / porcentaje | 4 / 1 / 61 % | 2 / 0 / 30 % | 2 / 0 / 30 % |
| Tiempo efectivo de lectura (28 días) | 234 min | 39 min | 39 min |
| Continuidad semanal | 1,00 | 0,57 | 0,57 |
| Diversidad lectora | 4 | 2 | 2 |
| Compromiso | 1,00 | 0,61 | 0,61 |
| Riesgo de abandono | 0,00 | 0,13 | 0,13 |
| Lecturas iniciadas (embudo, máquina) | 7 | 3 | 3 |
| Sesiones iniciadas en series globales | 26 | 18 | — |
| Lector sin obras del colegio, con una compra | «activo con avance» | «sin contenido habilitado» | igual |

El titular conserva 4 obras, 61 % y 7 lecturas iniciadas.

## Presentación

`ClubExterno`: un club sin obras asociadas mostraba bajo «Lecturas del club» toda la biblioteca del lector. Ahora muestra «No hay lecturas asignadas aún».

## Pruebas

`server/__test__/derivedPrivacyHttp.test.mjs` — servidor real, dos réplicas, sesiones reales, dos instituciones, motores con su planificador real; en `test:v81` (CI). `derivedIndicatorsHttp` y `pedagogicalScopeHttp` actualizan las afirmaciones del contrato anterior. Validado en Chrome: cola de atención, línea de tiempo y recomendaciones de la administración, y la página del club.

## Operación

- **Reconstruir el almacén derivado** tras el despliegue donde los motores estén encendidos (`rebuildInsights`): perfiles, señales y agregados de cohorte guardados antes de esta versión pueden incluir lectura personal. Las rutas individuales de la administración no dependen de ello; los agregados guardados, sí.
- Los historiales que solo crecen (riesgo, resultados de intervención, series ya escritas) no se reescriben con la reconstrucción.
- `/api/v2/metrics/*` aplica el mismo filtro. Su autoridad es la sesión más `x-user-id` igual al de la sesión; con ella quedó probado por HTTP real en V9R RC-1 (`derivedPrivacyHttp` [11], ver `CHP_V9R_RC1_CANDIDATE.md`).
- Las métricas globales de plataforma (`/api/metrics/backbone`, embudos, insights) siguen midiendo toda la plataforma: no son indicadores institucionales ni identifican a nadie.
