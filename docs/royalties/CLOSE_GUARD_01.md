# CHP-EDITORIAL-ROYALTIES-2026-01 — V1.4 / CLOSE-GUARD-01 · Impedir cierres de meses incompletos

**Estado:** ver §F · **Fecha:** 2026-10-27 · **Baseline:** `0a45061` · **Origen:** riesgo G.1 y condición J.4 de `U6_F6A_SINT.md`
Sin cambios en Q, R, S, alfa, bolsas ni D1–D5. Sin migraciones, despliegue, ingesta ni enforcement.

## A. Baseline

- HEAD = remoto = `0a45061`, árbol limpio; CI 10/10 en `7157200`.
- **Punto único de autorización:** `closeMonth` (`server/royalties/closesStore.mjs`), que atiende los cierres técnicos y los oficiales. El servidor lo llama desde dos sitios:
  - `POST /api/admin/royalties/closes` (cierre técnico);
  - `buildRoyaltyReport`, solo con `simulate: true`, que no escribe.

## B. Guarda implementada

- **`assertPeriodEnded(month, now)`:** usa `monthBounds` (America/Bogota, UTC−5, la misma función de U2) y rechaza si `now` es anterior al primer instante del mes siguiente en Bogotá.
  - Error **409 `period_not_ended`** con este mensaje: «El mes AAAA-MM aún no ha terminado (hora de Colombia). Podrá cerrarse a partir del AAAA-MM-01 a las 00:00 (America/Bogota).»
- **En `closeMonth`:** se aplica a **todo cierre persistente**, técnico u oficial, sin excepción por rol, y **antes de abrir la transacción**. Un rechazo no escribe nada: ni cierre, ni rule_set, ni movimientos.
- **Sin cambios para el mes abierto:** `simulate: true` no pasa por la guarda, así que la consulta, la simulación y las exportaciones provisionales siguen disponibles.
- **Reloj:** `now` es el reloj del servidor. El endpoint no lee `now`, `force` ni ningún otro parámetro del navegador para esto (probado). No se añade ningún reloj sobrescribible en el código productivo; las pruebas controlan el reloj llamando al store.
- **Sin dependencias nuevas.**

## C. Pruebas de calendario y API

**`closesStore.test.mjs` 85/0** (+15), con reloj controlado:

| Caso | Resultado |
|---|---|
| Mes en curso (15/04): cierre técnico | Rechazado `period_not_ended`, con mensaje y fecha de apertura |
| Mes en curso: cierre oficial con autorización | Rechazado igual |
| Rechazo sin escrituras | Conteos de `closes`, `period_inputs`, `rule_sets` y `adjustments` idénticos |
| Simulación del mes abierto | Permitida, sin escrituras |
| 30/04 23:59:59.999 en Bogotá (`2027-05-01T04:59:59.999Z`) | Rechazado |
| Medianoche UTC del 01/05 (30/04 19:00 en Bogotá) | Rechazado |
| 01/05 00:00 en Bogotá (`05:00Z`) | **Permitido**, con el mismo hash que la simulación hecha con el mes abierto |
| Cierre duplicado | `close_exists` |
| Cambio de año: 2027-12 a las 23:59:59.999 del 31/12 en Bogotá y en el año nuevo UTC | Rechazado |
| Cambio de año: 01/01/2028 00:00 en Bogotá | Permitido |
| Reloj inválido | `invalid_clock` |
| Cierres históricos | Íntegros y con el mismo hash |

**`royaltyReportsHttp.test.mjs` 64/0** (+5): `server.js` real y aislado, invocado por API.
- **Mes en curso según el reloj real del servidor:**
  - INS 201 y simulación PROVISIONAL;
  - cierre → **409 `period_not_ended`** con mensaje;
  - un `now` del futuro y `force: true` en el cuerpo **no lo saltan**;
  - el rechazo no escribe nada;
  - la exportación provisional responde 200.
- Los fixtures de U5 pasaron de 2026 a 2025, meses siempre cerrados, para que la prueba no dependa de la fecha en que se ejecute. Todas las comprobaciones previas siguen en verde: cierre técnico con el hash de la simulación, 409 por duplicado, trimestre e informes.

## D. Regresiones y CI

- `test:royalties` completo: rc = 0 (`periodPreview` 61, `royaltiesPreviewHttp` 22, `settlement` 87, `closes` 85, `royaltyReportsHttp` 64 y las demás).
- `typecheck:baseline` sin regresiones; `server.js` con sintaxis válida.
- U6 no se repitió: no hay regresión demostrada, y el comportamiento de los meses terminados es idéntico (mismo hash que la simulación).
- CI: ver §E.

## E. Commit

Ver `SEGUIMIENTO_PLAN_V1_1.md` (fila CG1).

## F. Veredicto

Ver `SEGUIMIENTO_PLAN_V1_1.md` (fila CG1).

**Nota para el despliegue:** cumple la condición J.4 de U6. La guarda usa el fin exacto del mes. Una lectura enviada en los últimos minutos del mes y recibida tras el corte con retraso de ingesta (máx. `maxIngestDelayMs`) podría quedar fuera si se cierra en el primer minuto del mes siguiente. Recomendación operativa: cerrar a partir del día 1 con margen (el plan prevé la conciliación en 15 días hábiles).
