# V8.1-PROD-01B: cierre de H-1, protección individual en Aula Viva

**Fecha:** 2026-11-10.
- **Decisión de Dirección DIR-V81-07:** todo seguimiento individual institucional exige A2 vigente del lector, C005 vigente del mediador y pertenencia autorizada al grupo. Es una decisión de gestión; no es evidencia de ninguna A2 ni de ningún C005.
- **Sin despliegue, sin XP y sin imágenes nuevas.** No se han tocado datos reales, registros, claves, documentos 001–006 ni WooCommerce.

## 1. Control aplicado (el mismo que en status, exportaciones, MOOK y progreso XP)

Se usa `individualAccessChecker` (`server/aulaViva/scopeAccess.mjs`), que aplica la misma regla que `requireSubjectScope({ a2: true })` en `server.js`:
1. El CIS decide la pertenencia, como hasta ahora.
2. Si concede el sujeto por la relación de mediación (`mediator_of_member_group`), se exige además `a2Gate(…, { mediatorId })`, con el **mismo registro** (`CHP_A2_REGISTRY`): A2 efectiva del lector y C005 efectivo y vigente del mediador.
3. Sin A2 o sin C005, la respuesta es el **mismo 403** que fuera de alcance (`scope_access_denied`), sin revelar si el lector pertenece a otro grupo y sin datos.
4. Registro no verificable ⇒ 503 `individual_access_unavailable` (fallo cerrado).
5. Lo propio (`self`) y la administración de plataforma no cambian.
6. No concede nada nuevo: solo restringe lo que el CIS ya permitía.

El registro se lee una sola vez por petición, también en los listados.

## 2. Cobertura

| # | Operación (PROD-01 H-1) | Rutas | Tratamiento |
|---|---|---|---|
| 1 | Cronología individual | `GET /api/aula-viva/students/:id/timeline` y `/students/:id/signals/:signalId/timeline` | `requireScopeAccess('user')` aplica A2/C005 |
| 2 | Vector de rasgos | `/students/:id/feature-vector` | Ídem |
| 3 | Historial de riesgo | `/students/:id/risk-history` | Ídem |
| 4 | Miembros identificables de cohorte | `/institutional/cohorts/:id/members` | Se excluye a los no autorizados; `members_count` = visibles |
| 5 | Colas de seguimiento | `/students-needing-attention` y `/institutional/outcomes/follow-up-queue` | Solo lectores con A2/C005. En la cola institucional, el ámbito `all` es una política de agregados, no de personas |
| 6 | Perfil individual | `/institutional/profile/:userId` | `requireScope('user')` aplica A2/C005 |

**El mismo control, por coherencia con DIR-V81-07,** cubre también las demás operaciones individuales de los dos routers:
- recomendaciones de un lector (`/recommendations/scope/user/:id`), ack y dismiss;
- creación de intervenciones (`POST /interventions`);
- `outcomes` y `learnings` con ámbito `user`.

**Los agregados conservan el umbral de PROD-01:** ≥ 5 lectores y sin inferencias por diferencia.

## 3. Pruebas

**`aulaVivaIndividualA2` (nueva, en `test:v81`):** 30/0, estable en dos ejecuciones. Usa `server.js` real con dos réplicas, el CIS real y el registro real con datos sintéticos.
- **A2 del lector:** Sí ⇒ 200 en las seis operaciones; No, Pendiente y Revocada ⇒ 403 en las seis.
- **No revela pertenencia:** la denegación por A2 es idéntica a la de un lector de otro grupo y no contiene datos.
- **C005 del mediador:** vencido, revocado o ausente ⇒ 403 aunque haya A2.
- **Asignación:** un mediador no asignado ⇒ 403; su propio lector ⇒ 200.
- **Lo propio y la administración:** sin cambios.
- **Listados mixtos** (cola de atención, cola de seguimiento, miembros): solo r-yes; el recuento no incluye a los excluidos; la administración ve a los cinco.
- **Revocación entre réplicas:** la revocación de A2 y de C005 rige de inmediato en las dos réplicas, sin reiniciar, también en los listados.
- **Registro alterado:** 503 en individuales y en listados, nunca una lista parcial; la administración no depende del registro. Al restaurarlo vuelve la decisión vigente.
- **Logs:** sin correos ni contenido.

**Cohortes de 1, 4, 5 y más lectores:** `cohortDisclosure`, 34/0 (PROD-01).

**Suites existentes:** `aulaVivaOperationalAuthz` 112, `aulaVivaOperational` 65 y `aulaVivaInstitutional` 55. Sus siembras conceden ahora A2/C005 sintéticos con `testA2` (`grantA2`/`grantC005`), como el resto desde CLOSE-01. Sin esas concesiones, el control respondía con el fallo cerrado esperado (503).

## 4. Seguridad de la imagen del front (CI de `25d4b52`)

El job `trivy-image (front)` falló por **dos HIGH nuevas** en `libxslt` 1.1.43-r3 de la base `nginx:1.30-alpine`: CVE-2026-87636 y CVE-2026-9947. La corrección está en 1.1.43-r4, en el repositorio de Alpine 3.24. **No es una regresión del código:** la candidata `v81-aed7f99` daba 0 a primera hora del día.

**Corrección (SEC-FRONT-LIBXSLT-01):** piso `libxslt>=1.1.43-r4` en el mismo `apk add` de `Dockerfile.front`, con el patrón ya documentado (brotli, curl, libexpat). Si el repositorio no ofrece esa versión, el build falla.

## 5. Para reconstruir la release

- El commit que publique esta unidad, con su CI 3/3, es la base de las imágenes nuevas.
- **`v81-aed7f99` sigue obsoleta**, por el umbral de cohortes, H-1 y `libxslt`.
- **Las dos imágenes cambian:** el front, por la base, y la API, por el código.
