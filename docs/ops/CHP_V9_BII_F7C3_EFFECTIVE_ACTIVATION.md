# CHP V9 · Bloque II · F7-C3 — Activación efectiva de suscripciones B2C

Estado: implementado y probado en laboratorio. **Sin desplegar.** Los productos #345 y #346 siguen sin activarse en producción.

## Contrato

Los doce meses de una suscripción individual empiezan cuando el acceso existe de verdad, no cuando la tienda cobra.

| Situación de la cuenta al llegar el pedido pagado | Regla del pedido | Inicio de los 12 meses |
|---|---|---|
| Cuenta nueva o todavía invitada (adulto o menor representado) | **pendiente**: `b2c.pendingActivation`, `expiresAt: 0`, sin fecha de inicio. El motor de accesos no la aplica. | El instante en que la cuenta se activa en `/api/accept-invite` |
| Cuenta ya activa, con términos vigentes en el registro | activa desde su creación | El instante en que el servidor concede la regla |
| Cuenta activa sin términos, representación sin verificar, documentos sin aprobar | no se crea regla (422 / 503, como antes) | No empieza |

- La fecha que envía la tienda (`activationAt` del cuerpo) se guarda como `b2c.requestedAt`. Es informativa: no fija ni acorta la vigencia.
- `b2c.activationAt` es el inicio real; `b2c.activationBasis` dice por qué empezó (`account_activated` o `rule_granted`).
- Vencimiento: mismo día doce meses después, 23:59:59.999 de Bogotá (`computeExpiresAt`, sin cambios).
- Idempotencia: la regla sigue siendo una por pedido (`access-b2c-<origen>-order-<id>`). Reintentos, avisos duplicados y reenvíos no crean otra regla ni mueven fechas. Una regla iniciada no se reinicia.
- Una regla pendiente cuenta como suscripción en curso: otra compra para la misma cuenta responde `conflict_active_subscription`.
- Cancelación o reembolso antes de activar: la regla queda revocada (`revokedBeforeActivation`) y activar la cuenta después no la inicia.
- No hay renovación automática. Vencida la regla, solo un pedido nuevo da otros doce meses.
- Red de seguridad: si una cuenta activa conserva una regla pendiente (por ejemplo, fallo entre activar la cuenta e iniciar la regla), se inicia en el siguiente reenvío del pedido o cuando el propio lector consulta sus accesos (`GET /api/access/by-user/:id`). No se tocó el inicio de sesión.

## Respuesta de `/api/b2c/provision`

Campos nuevos o con significado ajustado:

- `accessState`: `pending_activation` | `active` | `expired` | `revoked`.
- `activationAt` y `expiresAt`: `null` mientras el acceso está pendiente.
- `requestedAt`: la fecha que envió la tienda.

`status` (`activated` / `already_activated`) no cambia de significado para la tienda: «la compra quedó registrada en la plataforma».

## Lo que no cambia

- Menores: la cuenta representada solo se activa con la declaración del representante y las autorizaciones A0 y A1 en el mismo acto. Nada se infiere del pago. El menor no figura como contratante.
- El comprador B2C no entra en ningún grupo ni organización; su acceso es una regla de alcance `user`.
- Beneficios de cada plan: la lista digital es la misma para #345 y #346; el calendario de seis envíos de Mi biblioteca lo lleva la tienda con su propia fecha.

## Orden de despliegue (cuando se autorice)

1. API con este contrato.
2. Conector de la tienda (repositorio WEB) que entiende `accessState`.

El conector nuevo funciona con la API anterior (la ausencia de `accessState` conserva el comportamiento previo). El conector anterior con la API nueva mostraría una fecha de vencimiento vacía en los pedidos pendientes; por eso el orden, y por eso conviene que la venta siga en pausa entre ambos pasos.

Las reglas B2C creadas antes de este contrato no se recalculan: conservan sus fechas.

## Decisiones abiertas (no resueltas aquí)

- **Plazo máximo para activar.** Un pedido pagado cuya cuenta nunca se activa queda pendiente indefinidamente. Los términos aprobados no fijan un límite y no se inventó uno.
- **Mi biblioteca, envíos físicos.** El calendario de envíos arranca con la fecha de la tienda aunque el acceso digital todavía no haya empezado. Alinearlo o no es una decisión comercial.
- **Textos al comprador.** Los correos de la tienda dicen ahora que los doce meses empiezan al activar la cuenta. Conviene confirmar que la redacción coincide con los términos 002.

## Pruebas

- `server/__test__/b2cEffectiveActivation.unit.test.mjs` — lógica pura, en `test:v81` (CI).
- `server/__test__/b2cEffectiveActivation.integration.test.mjs` — servidor real, dos réplicas, doce escenarios; contenedor desechable (`test:b2c`).
- `server/__test__/b2cProvisioning.integration.test.mjs` — adaptada: el vencimiento se simula sobre la regla, ya no con una fecha de tienda antigua.
- WEB: `docs/web-reorg/tests/v9-effective-activation.test.php` y el arnés `docs/web-reorg/tests/p2-e2e/run-e2e.sh` (conector real contra el servidor real).
