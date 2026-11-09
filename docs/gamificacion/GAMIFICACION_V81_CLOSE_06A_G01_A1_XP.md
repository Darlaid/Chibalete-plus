# V8.1-CLOSE-06A: G-01, ningún XP sin A1 vigente y verificada

**Fecha:** 2026-11-09.
- **CLOSE-05:** publicado (`9080959..f4cccab`) con CI 3/3 en verde.
- **G-01:** `f95306b`, en local y sin push.
- Sin despliegue y con XP apagado.

## 1. Punto de control

La puerta está en la escritura común del ledger, `server/gamification/ledger.mjs`:

- `recordWorkRecognition`: revisión MOOK, que hoy es la única fuente que emite.
- `recordFact`: el resto de fuentes.

Por ahí pasan el barrido, el gancho de revisión, la reconciliación y cualquier fuente futura. La comprobación se hace **después** de la puerta de exclusiones y **antes** de abrir la transacción.

**Condiciones para emitir** (`a1Gate`, `server/privacy/a2Registry.mjs`):
1. Lector real, activo, no sintético y no excluido. Lo comprobaban ya `resolveUser`, la puerta de exclusiones y la recomprobación en la transacción.
2. **A1** concedida, vigente hoy y verificada:
   - `verified`: GVA/VER sobre la ficha C.1, que es el caso del representante de un menor.
   - `self_authenticated`: el titular adulto en la plataforma.
   - Además, la fecha del acto debe ser **anterior o igual** al día del hecho. Una autorización posterior no habilita aprobaciones anteriores, como en D48.
3. Reglas O1 vigentes y revisión aprobada válida, con `decideRecognition` y el techo 30/20/50. Sin cambios.

**Cuándo no se emite:** A1 ausente, pendiente (representante sin verificar), denegada, revocada, vencida, o un registro que no se puede verificar.
- Resultado: **ningún XP nuevo**, sin fila y con la clave del hecho libre.
- Motivo devuelto: `a1_not_effective` en revisión y `rejected_not_eligible` en hechos.

**Lo que no cambia:**
- A2 no sustituye a A1.
- Las puertas A2 siguen igual.
- El XP histórico y la consulta propia del lector no se tocan.

**Lote:** el barrido MOOK y la reconciliación leen la puerta una vez por lote y la releen tras cada cesión, como la de exclusiones. Sin puerta inyectada, el ledger lee el registro: si falta, no emite.

## 2. Pruebas

**`xpA1Eligibility` (23/0), con la puerta real:**
- Adulto: 30 → 50 → 50.
- Representación pendiente da 0 y verificada da 30.
- A1 No, pendiente, sin decisión o solo A2 dan 0.
- Revocada: no suma XP nuevo y conserva el histórico y la consulta propia.
- **Dos procesos** barriendo a la vez: un solo asiento. Los reintentos no duplican.
- Rectificación: 50 → 30 sin restauración.
- `recordFact`: sin A1 no hay fila; con A1, la misión emite.
- Sin retroactividad.
- Registro alterado: 0 XP; recuperado: hay XP.
- XP apagado.

**Suites del motor que no tratan A1:** un hook de carga **solo de pruebas** (`server/__test__/helpers/a1TestHooks.mjs`, registrado por `testMode.mjs` y heredado por los subprocesos) concede A1 salvo con `CHP_TEST_A1=real`. El código de producción no contiene ninguna excepción. `o8Check` siembra A1 real.

## 3. Contrato B2C y altas administrativas (determinación; no se modifica WooCommerce)

| Vía | Qué ocurre hoy | Cambio mínimo |
|---|---|---|
| `POST /api/b2c/provision` (Woo → Chibalete+) | La carga útil lleva `orderId`, `productId`, `plan`, `source`, `email`, `fullName`, `activationAt`, `idempotencyKey`, `dryRun`, **sin constancia de la aceptación del checkout**. Una cuenta nueva queda `invited` y pasa por la activación (CLOSE-05) | Que Woo añada `termsVersion` y `termsAcceptedAt` del pedido. El servidor anotaría una línea `T` (002) con el medio del checkout y la referencia `woo:<source>:order:<id>`. Exige un medio nuevo en el registro y el cambio en Woo |
| Compra con una cuenta **ya activa** (`userOp: none`, `reusedAccount`) | No pasa por la activación: el pedido nuevo no deja T | La misma línea T desde la carga útil del pedido |
| `POST /api/users` con contraseña | Crea cuentas **activas** sin decisiones | Crear como `invited` (vía `/api/invite-user`), o regularizar con el operador. Con G-01 no ganan XP ni abren A2 |
| `PUT /api/users/:id` (contraseña o estado) | Puede activar una invitada sin pasar por la activación | Igual que el anterior |
| `scripts/rebuild-school-users-from-csv.mjs` | Importa cuentas activas | Regularización con C.1 y el operador. No inventa decisiones |

Con G-01 y CLOSE-02, una cuenta que esquiva la activación queda **sin XP y sin consulta institucional individual**. Sigue pudiendo leer (A1 todavía no condiciona el acceso a la lectura en esas vías): hay que cerrar esas vías o regularizar las cuentas antes de la activación general.

## 4. Pendientes reales para cerrar V8.1

1. **Evidencia:** fichas C.1 verificadas (A1/A2) de los lectores existentes y designaciones (CLOSE-04).
2. **Versiones:** aprobación y publicación de las versiones 002/004/005, con su enlace en la activación.
3. **Aprovisionamiento:** registro y clave en producción (CLOSE-03), **antes** de desplegar CLOSE-05: sin registro, las activaciones responden 503.
4. **Woo:** la línea T del checkout y de las cuentas reutilizadas (§3).
5. **Altas administrativas:** cerrarlas o regularizarlas (§3).
6. **C005** de los mediadores existentes, si Dirección lo exige para la consulta individual.
7. **Imagen candidata** del commit final con CI en verde, y después F2–F8 con su gate jurídico.
