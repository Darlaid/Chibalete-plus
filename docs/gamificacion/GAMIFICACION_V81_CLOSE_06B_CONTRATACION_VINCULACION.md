# V8.1-CLOSE-06B: cierre de contratación y vinculación

**Fecha:** 2026-11-09.
- **G-01:** publicado (`f4cccab..0f37df6`) con CI 3/3 en verde.
- **Esta unidad:** en local, sin push. Sin despliegue y con XP apagado.
- **Registro:** el mismo de decisiones (CLOSE-05). No hay otro sistema.

## 1. WooCommerce: aceptación contractual

**Lo que hay en este repositorio:** el lado receptor (`POST /api/b2c/provision`, firmado con HMAC por un secreto file-only y con ventana de 300 s). El emisor, el plugin o webhook de la tienda, **no está aquí**: WooCommerce **no se ha modificado**.

**Implementado en el receptor** (`server/b2c/b2cProvisioning.mjs`, `server/server.js`):

1. **Campo opcional en el cuerpo firmado:** `"termsAcceptance": { "version": "002@1.0", "acceptedAt": <ms epoch> }`. Al ir dentro del cuerpo con HMAC, no se acepta un metadato sin verificar.
   - Una versión distinta de la que exige el código, o una fecha futura: `400 invalid_terms_acceptance`.
   - Sin el campo: el comportamiento es el de siempre.
2. **Registro:** con el campo presente (y sin `dryRun`), se anota **solo T** (002) para la cuenta del comprador.
   - Medio `checkout`, calidad `titular`, verificación `verified` (integración autenticada).
   - Fecha del acto: la de la aceptación. Referencia: `WOO:<source>:order:<orderId>`.
   - Vale también para una **cuenta reutilizada** (ya activa).
   - Si el registro no está disponible: `503 acceptance_registry_unavailable`; la tienda reintenta y las fases son idempotentes.
   - La respuesta añade `termsRecorded`.
3. **Activación:** si la cuenta ya tiene T vigente de la versión actual, la activación no la vuelve a pedir ni a anotar.
   - **A1 y A2 se siguen decidiendo en la activación**, por el titular o por el representante.
   - La aceptación del comprador no concede A0, A1 ni A2.

**Contrato que falta en WooCommerce (dependencia exacta):**
- Casilla de aceptación de los términos **sin marcar**, con enlace a la versión publicada (002@1.0).
- Guardar en el pedido el instante de la aceptación (`acceptedAt`, en milisegundos) y la versión.
- Incluir `termsAcceptance` en el cuerpo de `/api/b2c/provision`, en compras nuevas y con cuentas existentes, antes de firmar.
- Si la versión publicada cambia, Dirección actualiza `utils/acceptanceDocuments.mjs` y la configuración (§3) en la misma ventana.

## 2. Altas administrativas

| Vía | Antes | Ahora |
|---|---|---|
| `POST /api/users`, incluida la importación CSV del panel, que usa esta misma ruta | Lector o mediador **activo** con contraseña | **Invitado**, con `activationUrl` en la respuesta, salvo **regularización**: el registro ya tiene la decisión efectiva (A1 verificada del lector, C005 del mediador), anotada por AT con `ops/a2/decision_operator.mjs` a partir de la ficha C.1. Registro no verificable: invitado. Administración de plataforma: sin cambio |
| `PUT /api/users/:id` | Podía activar una invitada | De invitada a activa sin decisión efectiva: `409 DECISIONS_REQUIRED`. Con la regularización: 200 |
| `scripts/rebuild-school-users-from-csv.mjs` | Herramienta local de un solo uso (mayo de 2026). Escribe cuentas activas directamente en el padrón | **No está versionada** (`.gitignore`: `/scripts/*`), así que no se puede entregar ni revisar un cambio. Dependencia operativa: no usarla para altas nuevas. La importación soportada es la del panel (`POST /api/users`), que ya aplica la regla |

**Compatibilidad:**
- Las cuentas existentes no cambian: ni su estado ni su historial, y no se inventan decisiones.
- Reactivar una cuenta **desactivada** sigue funcionando como antes.
- Editar datos de una cuenta antigua no cambia nada.
- La pantalla de administración no cambia. El enlace sale en la respuesta de alta o con «Reinvitar».

**Efecto operativo:** las altas de lectores y mediadores por el panel o por CSV ya no quedan operativas de inmediato. Se habilitan por activación con decisiones, o por regularización con C.1.

## 3. Documentos y pantalla

- **Aprobación por configuración:** Dirección declara los documentos aprobados y publicados en `CHP_ACCEPTANCE_DOCUMENTS`, con el formato `{"001": {"version": "001@1.0", "url": "https://…"}, "002": …, "004": …, "005": …}`.
  - Un documento cuenta como aprobado solo con la versión exigida por el código y un enlace https.
  - **Esta unidad no aprueba ni publica nada.**
- **Endpoint público:** `GET /api/acceptance/documents` devuelve la versión, el título, el enlace y si está aprobado.
- **Activación:** sin los documentos aplicables aprobados (001 y 002 siempre; 004 para el lector, 005 para el mediador), `503 DOCUMENTS_NOT_APPROVED` y la cuenta sigue invitada.
- **`ActivarCuenta`:**
  - Muestra enlaces funcionales solo a los documentos aprobados y el aviso «pendiente de aprobación por Dirección» en los demás. Un borrador nunca se presenta como aprobado.
  - El botón sigue desactivado sin 001 y 002 aprobados.
  - Términos y autorizaciones van separados, sin casillas premarcadas, y las decisiones se registran (CLOSE-05).

## 4. Pruebas

| Suite | Resultado |
|---|---|
| `contractingLinkingHttp` | **28/0**. Documentos ausentes o inválidos; alta de lector, mediador y administrador; regularización; registro caído; duplicado; PUT (409, regularizado, reactivación, cuenta antigua); activación del invitado y de la mediadora; reintentos; contrato T de la compra; la compra no concede A1/A2 |
| `b2cProvisioning.integration` (Linux, contenedor desechable) | Nueva sección `[9b]`: compra nueva con T, activación sin repetir T, cuenta reutilizada, versión inválida, `dry-run`, cuerpo alterado (401), reintento de la tienda |
| `ActivarCuentaDecisions.structural` | 26/0, con enlaces, aviso de pendiente y botón desactivado |

## 5. G-04 a G-08 (estado; no se reabre su análisis)

| Brecha | Estado |
|---|---|
| G-04: respaldos sin ciclo máximo (COMP-07) | Pendiente: configuración y procedimiento de respaldos, fuera de la gamificación |
| G-05: la baja de cuenta no desvincula; la restauración del padrón puede reactivar | Pendiente: procedimiento |
| G-06: exclusión irreversible frente a 001 §14.7 | Pendiente: documental o jurídico |
| G-07: asignación de mediador sin vigencia; H.1-04 | Pendiente: procedimiento y prueba |
| G-08: suficiencia de la desvinculación como anonimización | Pendiente: jurídico y prueba VER |
