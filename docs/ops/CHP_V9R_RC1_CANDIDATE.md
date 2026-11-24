# CHP V9-R · RC-1 — Integración final y candidata

Estado: candidata construida y probada en laboratorio. **Sin desplegar ni distribuir.** Producción no se tocó.

Repositorios de la candidata: APP (este), WEB `6dc8aed` (sin cambios) y Lector Único 0.10.0 (versionCode 13).

## Qué se cerró en RC-1

### Supresión remota en Lector Único

Antes, eliminar una cuenta no daba ninguna señal al dispositivo: su sesión recibía el 401 genérico, LU pedía volver a entrar y conservaba todo (libro, progreso y lectura pendiente).

- **Cuenta activa.** Una sesión firmada, vigente y no revocada cuyo titular ya no está en el padrón recibe `401` con `code: "account_removed"` (`requireUserAuth`, `requireProgressOwner` y la escritura de eventos). Solo puede presentarla quien inició sesión como esa cuenta. Cualquier otro rechazo conserva el cuerpo de siempre. El inicio de sesión de una cuenta eliminada sigue respondiendo «Credenciales inválidas».
- **Cuentas que cerraron sesión en el dispositivo.** `POST /api/lu/accounts/removed` (`{ ids: [...] }`, máximo 25, con sesión, límite de ritmo): devuelve `{ removed }`, los identificadores enviados que no están en el padrón. Si el padrón no se puede leer responde 503: nunca afirma una baja por un error.
- LU 0.10.0 aplica ambas señales (ver `qa/chibalete-lu-v0.10.0-rc1/RESUMEN.md` en su repositorio).

Alcance: «eliminada» es «fuera del padrón» (`DELETE /api/users/:id`), paso previo obligatorio de la supresión del titular (`ops/a2/suppression_operator.mjs`). La consulta permite a una cuenta con sesión saber si un identificador que ya conoce sigue existiendo; no devuelve ningún otro dato.

### Métricas v2 (`/api/v2/metrics/*`)

- Autoridad válida: sesión firmada **más** `x-user-id` igual al de la sesión. Sin esa cabecera, con la de otra cuenta, sin sesión o con el secreto de máquina: 401. Ningún cliente del producto las llama.
- Corrección: `GET /api/v2/metrics/organizations` entregaba a cualquier cuenta con sesión las poblaciones y lo no atribuido de **toda la plataforma**, aunque no viera ninguna organización. Ahora solo a la administración de plataforma (`populations` y `unattributed` son `null` para los demás).
- Son métricas institucionales: la lectura personal no cuenta para nadie (F5-DP2). El titular conserva sus datos completos en sus rutas propias.
- Pruebas por HTTP real con sesiones, dos réplicas y la cuenta mixta de F5-DP2 (`derivedPrivacyHttp` [11]). Sin el filtro de lectura personal, la prueba falla (8 sesiones frente a 4).

### Pruebas B2C obligatorias

`npm run test:b2c` es un paso propio del job `identity-preflight`. Sus cuatro suites unitarias salieron de `test:v81` para no ejecutarse dos veces. Las cinco de integración y `b2cEntitlement.unit` no corrían en CI; las de integración además se omiten con código 0 si falta su permiso de entorno desechable (`CHP_B2C_TEST_SECRET_SANDBOX=1`): el paso lo concede en el ejecutor y trata cualquier omisión como fallo.

## Compatibilidad y orden de despliegue

| Combinación | Resultado |
|---|---|
| APP nueva + LU 0.9.2 | Sin cambios para LU (ignora `code`; no llama a la consulta). |
| APP anterior + LU 0.10.0 | Funciona como hoy: la consulta responde 404 y LU no borra nada; no hay supresión remota hasta desplegar APP. |
| APP nueva + conector WEB `6dc8aed` | E2E tienda → app en verde (201 comprobaciones). |
| APP nueva + conector WEB productivo anterior | Contrato de aprovisionamiento sin cambios en RC-1. |

Orden: **API** (réplica por réplica) → **front** (en su ventana) → **conector WEB** → **LU 0.10.0** (distribución). LU puede distribuirse antes o después de APP sin romper nada; la supresión remota empieza a operar cuando ambas están.

## Seguridad

- `osv-scanner.toml`: sus cinco excepciones tienen `ignoreUntil` vencido (agosto–octubre de 2026) y ya no suprimen nada; el escáner pasa sin ellas. No hay excepciones OSV en vigor.
- `.trivyignore`: cuatro entradas sin caducidad automática (exportador Prometheus de OTel, propagador Jaeger, contenedores sin `USER`, aviso RSC de react-router). Riesgos aceptados con su motivo en el archivo; revisarlos es tarea de PRE-1.

## PRE-1 — obligaciones exclusivamente productivas, jurídicas y operativas

1. Ratificación jurídica de los 12 meses (registro de procedencia, colas web y lo pendiente en LU).
2. Encender el registro de procedencia y decidir su poda (banderas apagadas).
3. Preflight de solo lectura en producción (`ops/preflight/bloque1-readonly.mjs`): cursos sin obras asociadas y alcance de la telemetría rodante.
4. Reconstruir el almacén derivado donde los motores de Aula Viva estén encendidos (F5-DP2) y decidir sobre los historiales que solo crecen.
5. Rutas de los registros de exclusión y de decisiones en el override productivo (`GAMIFICATION_EXCLUSION_REGISTRY`, `CHP_A2_REGISTRY`).
6. WP-Cron activo en la tienda; activación de #345/#346 según su procedimiento; decisiones comerciales abiertas de BII-CLOSE-1.
7. Custodia del código de LU en un remoto autorizado; distribución del APK 0.10.0 (URL con versión + `lu_config.json`), con arranque de la compilación de publicación en un dispositivo y actualización desde 0.9.2 con el APK firmado.
8. Revisión de los riesgos aceptados de `.trivyignore` y retiro de las excepciones OSV vencidas.
9. Respaldo previo, etiquetas `rollback-pre-<slug>` y ventanas separadas de API y front (`deployment_guide.md`).
