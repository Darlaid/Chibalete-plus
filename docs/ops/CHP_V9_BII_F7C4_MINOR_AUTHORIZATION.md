# CHP V9 · Bloque II · F7-C4 — Representación y autorizaciones de lectores menores (B2C)

Estado: implementado y probado en laboratorio. **Sin desplegar.** Conserva F7-C3 (`CHP_V9_BII_F7C3_EFFECTIVE_ACTIVATION.md`).

## Roles

| Rol | Qué es en el sistema | Qué puede y qué no |
|---|---|---|
| Comprador o contratante | El pedido de la tienda (correo de facturación). Si además lee, una cuenta con ese correo | Acepta los términos 002 en la compra (T, calidad `titular`, medio `checkout`). Pagar no lo acredita como representante de nadie |
| Lector adulto | Cuenta con correo propio | Activa su cuenta como «titular mayor de edad»: T (si no la dio en la compra) y A1, autenticadas por él mismo |
| Lector menor | Cuenta **representada**: usuario `lec-…`, sin correo, con `representedBy.email` (contacto del adulto del pedido) | No contrata, no acepta términos y no autoriza nada por sí mismo. Entra con su usuario y lee |
| Representante legal | No tiene cuenta propia por serlo. Actúa en la activación de la cuenta del menor, con el enlace enviado al contacto del pedido | Declara su calidad y decide A0 y A1 (obligatorias) y A3, A5 (opcionales). Queda `unverified` hasta que GVA lo verifique |

## Qué cambia en F7-C4

1. **La cuenta de un menor solo la activa su representante legal.** Antes, quien tuviera el enlace podía elegir «titular mayor de edad» y la cuenta del menor quedaba con términos y A1 a nombre del propio menor, como si fuera un adulto, y efectivas sin verificación. Ahora `POST /api/accept-invite` responde `422 REPRESENTATIVE_REQUIRED` y no anota nada.
2. **Constancia del vínculo.** Al activarse, la cuenta representada guarda `representedBy.declaration = { ref, day }`. `ref` es la referencia (`ACT-…`) de las decisiones que el representante anotó en el registro. Une contacto del pedido, enlace de un solo uso, declaración y registro sin pedir ningún dato nuevo. Nunca sale del servidor.
3. **Una autorización retirada surte efecto sola.** Si el registro de decisiones tiene la A1 de una cuenta personal B2C como `revoked` o `denied`, la cuenta no abre ningún contenido (`403 AUTHORIZATION_WITHDRAWN`), en las dos réplicas y sin reinicio. No se borra nada: cuenta, suscripción, fechas e historial se conservan. Declarada sin verificar o pendiente **no** cuenta como retirada.
4. **Una compra nueva no reabre lo retirado** (001 §11.5). Un pedido nuevo para una cuenta con A1 retirada responde `422 authorization_withdrawn` y la tienda lo deja en revisión manual. Solo una nueva autorización expresa y verificada restablece el acceso.

## Lo que ya existía y se verificó

- El pago no anota decisiones del menor; la aceptación del checkout no se admite para una cuenta de menor (`400 terms_acceptance_not_applicable`).
- Nada viene marcado. Sin A0 o sin A1, o con cualquiera en «no», la cuenta no se activa y no se escribe nada.
- Cada decisión lleva versión del documento, día, medio, calidad de quien decide y estado de verificación; el registro es de solo-añadir, autenticado y sin identificadores en claro.
- Un segundo menor del mismo contratante tiene su cuenta, su activación y sus decisiones. La verificación de uno no sirve para el otro.
- A3 y A5 son opcionales y separadas: si no se deciden quedan pendientes; declaradas por un representante no surten efecto hasta la verificación de GVA.
- La compra no crea vínculo institucional. A2 no existe sin institución; C005 no cambia.
- Revocar es un trámite por los canales del 001 §13: lo anota GVA/AT con `ops/a2/decision_operator.mjs` (decisión verificada, con su evidencia). No hay revocación de autoservicio en la app.

## Límites conocidos

- La puerta del punto 3 actúa al abrir contenido. No cierra la sesión ni desactiva la cuenta: eso sigue siendo `POST /api/users/:id/disable` por AT. Si el registro no es verificable no se concluye una retirada (la lectura no pasa a depender de la disponibilidad del registro).
- La puerta se limita a cuentas personales B2C. Las cuentas institucionales siguen su procedimiento (GVA y la institución).
- No se puede cambiar el contacto del adulto de una cuenta representada (`representedBy.email` es un campo del servidor). El cambio de representante o el cierre del vínculo requiere un procedimiento de GVA que hoy no está implementado.

## Decisiones pendientes de Dirección o jurídica

1. **Cambio de representante o de contacto** de una cuenta de menor: qué evidencia se exige y quién lo ejecuta.
2. **Mayoría de edad del lector**: cómo pasa una cuenta representada a ser de su titular.
3. **Efecto de la A1 retirada sobre la sesión**: hoy bloquea el contenido; desactivar la cuenta sigue siendo un paso de AT. Decidir si debe ser automático.
4. **Comunicación de fechas** (002 §3.4): la tienda no conoce el día de activación; falta definir quién informa al contratante el inicio y el fin reales.
5. **Plazo de verificación de GVA** para una representación declarada, y qué ocurre si no se verifica.

## Pruebas

- `server/__test__/b2cMinorAuthorization.unit.test.mjs` — lógica pura, en `test:v81` (CI).
- `server/__test__/b2cMinorAuthorization.integration.test.mjs` — servidor real, dos réplicas, dos familias y dos instituciones; contenedor desechable (`test:b2c`).
- WEB: bloque `[F7-C4]` del arnés `docs/web-reorg/tests/p2-e2e/run-e2e.sh` (conector real contra el servidor real).
