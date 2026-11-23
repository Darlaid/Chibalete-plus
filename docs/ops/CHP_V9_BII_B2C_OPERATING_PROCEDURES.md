# CHP V9 · Bloque II · BII-CLOSE-1 — Procedimientos operativos B2C para GVA y AT

Estado: implementado y probado en laboratorio. **Sin desplegar.** Completa `CHP_V9_BII_F7C3_EFFECTIVE_ACTIVATION.md` y `CHP_V9_BII_F7C4_MINOR_AUTHORIZATION.md`.

Siglas: **GVA** verifica (evidencia y decisión); **AT** ejecuta en la plataforma. Ningún paso de este documento usa una herramienta que no exista.

## 0. Herramientas

| Herramienta | Quién | Para qué |
|---|---|---|
| `ops/a2/decision_operator.mjs` (stdin, en contenedor efímero sin red; ver `V81_PROD_01_DECISIONES_DOCUMENTOS.md` §3) | AT, con la ficha verificada por GVA | Anotar decisiones verificadas: `granted`, `denied`, `revoked` |
| `POST /api/users/:id/reinvite` (también en Administración → Usuarios) | AT | Devolver una cuenta a «invitada» y obtener un enlace nuevo |
| `POST /api/users/:id/disable` (también en Administración → Usuarios) | AT | Desactivar una cuenta (no borra nada) |
| `POST /api/users/:id/representation` (solo API, autoridad de administración; **no tiene botón** en la pantalla) | AT | Cambio de representante y mayoría de edad |
| Tienda: `wp chplus-b2c pending` · `wp chplus-b2c sync [pedido]` · `wp chplus-b2c status <pedido>` · acción «reenviar» del pedido | AT | Seguimiento de pedidos sin activar, fechas y enlaces |

Una línea para `decision_operator` (una por decisión, todas o ninguna):

```json
{"subjectId":"<id de la cuenta>","kind":"A1","status":"revoked","actDay":"AAAA-MM-DD","version":"004@1.0","medium":"paper","capacity":"legal_representative","verification":"verified","requestRef":"<referencia opaca del trámite>","validUntil":null}
```

`kind`: `T` (002, versión `002@1.0`), `A0`, `A1`, `A3`, `A5` (004). `medium`: `paper`, `electronic_signature`, `verifiable_message` o `admin_record`. `actDay` es la fecha del acto según la evidencia, nunca futura.

## 1. Estados de una autorización y qué permite cada uno

| Estado en el registro | Cómo se llega | Cuenta y lectura | Leo (A3) / voz (A5) | Recompra para esa cuenta | XP (apagado) |
|---|---|---|---|---|---|
| Pendiente (sin línea) | Pagar, invitar, usar la plataforma | No: la cuenta no se activa sin A1 expresa | No | — | No |
| Declarado, sin verificar | El representante lo decide al activar la cuenta del menor | **Sí** | **No** | Revisión manual (422) | No |
| Efectivo | Titular adulto en su propia cuenta, o GVA verifica lo declarado | Sí | Sí, si esa decisión es «sí» | Sí | Según A1 |
| Negado | GVA anota el resultado negativo, o el representante dijo «no» | **No** (403) | No | Revisión manual (422) | No |
| Revocado | Trámite por los canales del 001 §13, anotado por AT | **No** (403) | No | Revisión manual (422) | No |

Nada se infiere y nada se transfiere entre cuentas: cada lector tiene sus propias líneas.

## 2. Verificación de la representación

1. GVA recibe la evidencia que el 004 Parte III y el protocolo 006 C.1 ya prevén. No se piden documentos adicionales.
2. **Resultado positivo.** AT anota, para esa cuenta, `T`, `A0`, `A1` y las opcionales que el representante haya decidido con «sí», todas `granted` / `verified`. Efecto inmediato en las dos réplicas, sin reinicio.
3. **Resultado negativo o verificación imposible.** AT anota `A0` y `A1` como `denied` / `verified`, con la referencia del trámite. Efecto: la cuenta deja de abrir contenido; no se borra nada. Después:
   - AT desactiva la cuenta (`/disable`).
   - El pedido lo decide Dirección con el contratante (reembolso, o nueva verificación). La plataforma no cancela ni reembolsa por sí sola.
4. **Sin resultado todavía.** La cuenta sigue leyendo con lo declarado; Leo, voz y recompras siguen cerrados. No hay plazo automático (ver §9, decisión D1).

## 3. Revocación

1. La solicita el titular o su representante por los canales del 001 §13. GVA comprueba quién la pide.
2. AT anota `revoked` / `verified` para cada finalidad retirada.
   - `A3` o `A5`: se cierra solo ese tratamiento. La lectura no cambia.
   - `A1`: la cuenta personal deja de abrir contenido. Cuenta, suscripción, fechas e historial se conservan. Si además se pide supresión, es otro trámite (`ops/a2/suppression_operator.mjs`).
3. Tras revocar `A1`, AT desactiva la cuenta (`/disable`) para cerrar también la sesión.
4. El bloqueo continúa aunque: el lector vuelva a entrar, la tienda reenvíe el pedido, llegue una compra nueva (queda en revisión manual), o el registro falle (§6).

## 4. Restablecimiento autorizado

Solo con una nueva autorización expresa. Dos caminos:

- **Por evidencia:** GVA recibe la nueva autorización y AT anota `A1` `granted` / `verified`. Si la cuenta estaba desactivada, AT la reinvita.
- **En la plataforma:** AT reinvita la cuenta (`/reinvite`) y entrega el enlace al representante por el canal verificado. Quien lo usa vuelve a decidir A0 y A1; queda «declarado» y GVA lo verifica de nuevo.

Reinvitar no restablece nada por sí solo. La suscripción no se alarga ni se reinicia.

## 5. Cambio de representante

1. GVA verifica el trámite (quién deja de representar y quién representa ahora) y le da una referencia.
2. AT anota `revoked` / `verified` para `A0`, `A1` y las opcionales vigentes de esa cuenta. La cuenta deja de abrir contenido.
3. AT llama a `POST /api/users/<id>/representation` con `{"action":"change_contact","email":"<correo del nuevo representante>","requestRef":"<referencia>"}`.
   - Si alguna autorización sigue en pie responde `409 AUTHORIZATIONS_NOT_WITHDRAWN` y no cambia nada.
   - Con éxito: la cuenta queda invitada, sin contraseña y con las sesiones cerradas; el contacto es el nuevo; del anterior solo quedan las referencias de lo que declaró y del trámite. La respuesta trae un enlace nuevo.
4. AT entrega el enlace al nuevo representante por el canal verificado. Al usarlo declara su calidad y decide A0 y A1 (y las opcionales que quiera). Las del anterior no pasan.
5. GVA verifica la nueva representación (§2).

El contacto anterior deja de poder pedir enlaces de esa cuenta por la tienda (la plataforma responde 409). El usuario `lec-…` del lector, su suscripción, sus fechas y su progreso no cambian.

## 6. Registro de autorizaciones no disponible

| Situación | Efecto |
|---|---|
| El registro deja de poder verificarse en una réplica que ya lo había leído | Rige la última lectura verificada: quien estaba revocado sigue bloqueado; quien estaba vigente sigue leyendo. Leo, voz, activaciones, compras para cuentas activas y cambios de representante se cierran (503) |
| Una réplica arranca sin poder verificarlo | Las cuentas personales B2C no abren contenido (503 `AUTHORIZATION_REGISTRY_UNAVAILABLE`, temporal). Las institucionales no dependen de esta comprobación |
| Se repara | Todo vuelve solo a su estado. No hay que reiniciar |

Qué hace AT: tratarlo como incidente del registro (clave, montaje, integridad). No hay ningún paso que «reabra» accesos mientras tanto.

## 7. Mayoría de edad

1. La pide el propio lector al cumplir la mayoría de edad, o su representante. GVA lo verifica con la evidencia ya prevista para acreditar identidad y le da una referencia.
2. AT anota `revoked` / `verified` para `A0`, `A1` y las opcionales vigentes.
3. AT llama a `POST /api/users/<id>/representation` con `{"action":"majority","email":"<correo propio del lector>","requestRef":"<referencia>"}`.
   - La cuenta pasa a tener ese correo, deja de ser representada y queda invitada. Es la **misma** cuenta: suscripción, fechas y progreso intactos.
   - `409 EMAIL_IN_USE` si el correo ya es de otra cuenta.
4. AT entrega el enlace al lector. Al activarla acepta él mismo los términos 002 y autoriza A1 como titular; las opcionales las decide él. Nada de lo que autorizó su representante pasa a ser suyo.

## 8. Pedidos pagados sin activar, fechas y Mi biblioteca

- Un pedido pagado cuya cuenta no se activa queda **pendiente**: no consume vigencia y no se extingue. No hay plazo que lo cancele.
- **Seguimiento:** la tienda consulta a diario los pedidos pendientes (tarea programada) y AT puede verlos con `wp chplus-b2c pending` (número, plan, días de espera). La consulta no cambia nada en la plataforma y no invalida el enlace del comprador.
- **Invitación sin usar:** el enlace dura 48 horas. El comprador pide uno nuevo desde su correo o su pedido; AT puede reenviarlo desde el pedido. Un pedido pendiente siempre admite enlace nuevo.
- **Fechas (002 §3.4):**
  - quien activa las ve en pantalla al terminar («empieza hoy… termina el…»);
  - el contratante recibe un correo con inicio y terminación cuando la tienda conoce la activación (una vez por pedido; si el correo falla se reintenta en la siguiente consulta);
  - si la cuenta ya estaba activa al comprar, la bienvenida ya lleva la fecha de terminación.
- **Mi biblioteca (002 §3.5):** el calendario de seis envíos se crea cuando el acceso empieza: el primero en la fecha de la activación efectiva y los siguientes cada dos meses (meses 2, 4, 6, 8 y 10). Mientras la cuenta no se active no hay envíos programados. Un calendario ya creado no se rehace. `wp chplus-b2c mibib_due` lista los próximos.
- **Cancelación o reembolso:** antes de activar, el acceso queda revocado y nunca hubo calendario; después, se detienen los envíos pendientes y el acceso termina.
- **Revisión manual:** un pedido en revisión no se reintenta solo y no tiene acceso; lo resuelve AT con Dirección.

## 9. Decisiones que siguen siendo de Dirección o jurídica

| # | Decisión | Estado actual, sin ella |
|---|---|---|
| D1 | Plazo para que GVA verifique una representación declarada, y consecuencia de no verificar | Sin plazo: la cuenta lee con lo declarado; lo opcional sigue cerrado |
| D2 | Plazo máximo para activar un pedido pagado | Sin plazo: queda pendiente y con sus derechos |
| D3 | Si `A1` revocada debe desactivar la cuenta automáticamente | El contenido se bloquea solo; desactivar es el paso 3 de §3 |
| D4 | Qué evidencia basta para el cambio de representante y para la mayoría de edad | La que GVA ya usa para verificar representación e identidad (006) |

Ninguna impide operar: cada una tiene un comportamiento definido y conservador.
