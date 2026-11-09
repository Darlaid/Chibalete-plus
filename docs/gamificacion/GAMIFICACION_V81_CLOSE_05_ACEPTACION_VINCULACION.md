# V8.1-CLOSE-05: aceptación integrada y habilitación verificable de A1/A2

**Fecha:** 2026-11-09. **Decisión aplicada:** DIR-V81-01. Sin despliegue y con XP apagado. Código en local (`d186457`, `b3eb5bf`), sin push.

## 1. Flujos identificados

| Flujo | Dónde ocurre | Punto de vinculación en Chibalete+ |
|---|---|---|
| Compra B2C (términos y oferta) | **WooCommerce**, aplicación independiente. Llama a `POST /api/b2c/provision` (HMAC) y recibe un enlace de activación | Activación de la cuenta |
| Alta institucional | Administración: `POST /api/invite-user` y reenvío | Activación de la cuenta |
| Activación | `pages/ActivarCuenta.tsx` → `POST /api/accept-invite` | **Punto único** |
| Asignación de mediador | Administración: `mediatorIds` del grupo | Activación de la cuenta del mediador |
| Alta directa con contraseña (`POST /api/users`) e importaciones | Administración | No pasa por la activación: **no registra decisiones**, que quedan pendientes |
| Acuerdo institucional 003 | Fuera de la plataforma: firma o mensaje de datos | Anotación del operador (C003) |

Se implementó la activación. El checkout no se duplicó: su integración contractual queda pendiente (§5).

## 2. Decisiones y evidencia

**Registro:** el de A2 (`server/privacy/a2Registry.mjs`). Es el mismo archivo append-only con MAC por línea y fuera de los respaldos; ahora guarda también las demás decisiones de DIR-V81-01.

| Campo | Contenido |
|---|---|
| Tipo | `T` (002 y oferta), `A0`, `A1`, `A2` (004), `C003` (acuerdo institucional), `C005` (compromiso del mediador) |
| Estado | `granted`, `denied`, `revoked`. Sin línea: pendiente |
| Versión | `002@1.0`, `004@1.0`, `005@1.0`, `003@…`. Fuente única: `utils/acceptanceDocuments.mjs` |
| Fecha | Día del acto según la evidencia (nunca futuro ni por defecto) y día de la anotación |
| Medio | `in_app`, `paper`, `electronic_signature`, `verifiable_message`, `admin_record` |
| Aceptante y calidad | El sujeto es la cuenta (o la organización en C003), con HMAC. La calidad es `titular`, `legal_representative`, `institution` o `mediator` |
| Verificación | `self_authenticated` (titular o mediador en la plataforma), `verified` (GVA/VER sobre la ficha C.1), `unverified` (lo que declara un representante) |
| Alcance | Tipo de decisión, más la vigencia opcional |
| Referencia verificable | `ACT-<uuid>` en la plataforma, enlazada a la línea `[ACCEPTANCE]` del log de la réplica, o `AUT-…`/`CONV-…`/`SOL-…` del trámite |

**Una decisión es efectiva** solo si está concedida, vigente y verificada (o autenticada por el propio titular). Lo que declara un representante no habilita nada hasta que GVA lo verifique (006 P03: «el pago o el parentesco no acreditan representación»).

## 3. Activación (`POST /api/accept-invite`)

1. **Primero, lo de siempre:** token, longitud y política de contraseña. Los códigos no cambian.
2. **Plan** (`server/privacy/acceptance.mjs`, función pura). Nada viene marcado y lo ausente falta:

| Perfil | Exige | Se registra |
|---|---|---|
| Titular adulto, sin institución (B2C) | T, declaración de mayoría de edad, A1 | T y A1 `self_authenticated`. A2 no aplica |
| Lector institucional | Lo anterior más A2 Sí/No («no aplica» no vale) | Más A2 |
| Representante legal de un menor | T, A0, A1 (y A2 si es institucional) | Todo `legal_representative`, `unverified` |
| Mediador | T, declaración de mayoría de edad, C005 | T y C005 `self_authenticated` |
| Administrador | T y declaración de mayoría de edad | T |

**Rechazos:**
- A1 = No: `422 A1_DENIED`. La cuenta no se activa (004 A1).
- A0 = No: `A0_DENIED`.
- Versión distinta de la vigente: `VERSION_MISMATCH`.
- A2 en una cuenta sin institución: `A2_NOT_APPLICABLE`.
- Lo que falta: `422 DECISIONS_REQUIRED` con la lista `required`.

3. **Escritura:** primero las líneas en el registro, en una sola escritura con `fsync` y todas o ninguna. Después se activa la cuenta.
   - Si el registro no se puede verificar: `503 ACCEPTANCE_REGISTRY_UNAVAILABLE`, sin activar. La evidencia no se aplaza.
   - Repetir: el token ya está consumido, así que no se escribe ninguna línea nueva.
4. **Pantalla:** la misma `ActivarCuenta` añade un bloque «Tus decisiones» con radios y casillas sin valor inicial. A1 y A2 van por separado y se aclara que A2 es independiente de A1. A0 solo aparece para el representante y C005 solo cuando el servidor lo pide.

## 4. Usuarios existentes (regularización única)

- **Nada se concede automáticamente:** una cuenta activa sin líneas tiene A1 y A2 pendientes. Sus funciones propias siguen (lectura, status propio, «Mi progreso»). La consulta institucional sigue cerrada sin A2, como ya ocurría desde CLOSE-02.
- **Evidencia previa comprobable:** el procedimiento es el de CLOSE-04 (C.1 + VER). AT la anota con `ops/a2/decision_operator.mjs` (stdin, todo o nada), que exige fecha del acto, medio, versión, calidad, verificación y referencia **de la propia evidencia**. No admite `in_app` ni fechas futuras.
- **Lo que falta:** se solicita con los documentos vigentes (004, 005, 003), y GVA lleva la relación por grupo.
- **Cobertura:** `ops/a2/inventory.mjs` informa solo de recuentos de A1/A2 por estado: pendiente, `granted_unverified`, efectiva, denegada, revocada.
- **Historia:** el registro es append-only; no se modifica ni se borra ninguna decisión. No hay lista de participantes ni piloto.

## 5. Diferencias indispensables antes de producción

1. **Aprovisionar el registro antes de desplegar este código.** Sin registro, **toda activación**, incluidas las de compras B2C, responde 503. Es el mismo gate de CLOSE-03, que aquí también afecta a las altas.
2. **Versiones aprobadas:** Dirección aprueba y publica las versiones de 002, 004 y 005 que figuran en `utils/acceptanceDocuments.mjs`. El 001 sigue en borrador. La pantalla debe enlazar los textos publicados; hoy solo muestra título y versión.
3. **WooCommerce:** la aceptación de términos y oferta en el checkout queda fuera del registro. Integración pendiente: que `/api/b2c/provision` reciba la versión aceptada, la fecha y la referencia del pedido, y anote T con su medio. Mientras tanto, T se registra en la activación.
4. **Altas directas** (`POST /api/users` con contraseña, importaciones): o pasan por invitación, o se regularizan con el operador.
5. **A1 y XP:** A1 se exige al activar, pero la elegibilidad de XP todavía no comprueba A1 efectiva (G-01). Hay que hacerlo antes de encender XP.
6. **C005 de mediadores existentes:** se registra al activar. La consulta individual del mediador aún no lo exige; se regulariza con el operador o lo decide Dirección.
7. **Nueva imagen candidata:** `v81-325b8fc` ya no corresponde. Hay que construir desde el commit final con CI verde.

## 6. Pruebas

| Suite | Resultado | Cubre |
|---|---|---|
| `acceptanceDecisions` | 42/0 | T frente a A1; representante sin verificar; A1 Sí/No/pendiente; A2 Sí/No/pendiente/revocada; versiones; fecha del acto; evidencia previa; C003/C005; nada premarcado |
| `acceptInviteDecisionsHttp` | 31/0 | `server.js` real con **dos réplicas**; 422, 503, 409; titular, institucional, representante (cerrado hasta verificar y luego abierto en ambas), mediador, cuenta antigua, lectura, XP apagado, MOOK |
| `ActivarCuentaDecisions.structural` | 19/0 | Pantalla sin premarcados y con las versiones de la fuente única |
| `a2Registry` | 34/0 | Compatibilidad CLOSE-01..03 |
| Suites de activación (B2C, restablecimiento, credenciales) | — | Actualizadas para enviar decisiones explícitas de titular adulto. La mediadora reactivada necesita el 005: sin él, 422 |

**Validación Linux local** (sin push): contenedor `node:20-bookworm` con el usuario no root `node`, sobre `git archive` del commit. Se ejecutaron los pasos de `identity-preflight` en el mismo orden.

- **Todos en verde:** identidad, sesiones, restablecimiento, credenciales (83/0, con el caso 005), contraseña propia, membresías, métricas, regalías, aislamiento de stores, typecheck, MOOK, exportaciones (83/0), G0, núcleo de gamificación (`platformIntegration` 58/0, `studentProgressHttp` 49/0, `xpRectification` 44/0), `test:v81` (incluye O8 27/0) y build.
- **B2C:** la integración corrió en un contenedor desechable con `CHP_B2C_TEST_SECRET_SANDBOX=1`: 55/0, incluida la activación de la cuenta del comprador.
- **Fallos del primer pase:** quedaron explicados y corregidos.
  - La reactivación de la mediadora era una regla nueva y la prueba se actualizó.
  - Una comprobación de auditoría con regex dependía del azar y ahora compara valores exactos.
  - Un caso de identidad fallaba solo porque el repositorio estaba bajo `/tmp`.
  - Un servidor tardó en arrancar por carga; se repitió con 49/0.

**Fallos preexistentes ajenos** (solo en Windows):
- `useReducedMotion.structural` (front sin cambios desde la base).
- `identityCanonicalSource` (archivo local de la máquina).
- `identityTwoProcessConcurrency`, que es sensible al tiempo con carga: pasa 3/3 aislado.
