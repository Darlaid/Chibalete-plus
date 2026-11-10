# V8.1-CLOSE-10A: release candidata definitiva para el despliegue inerte

**Fecha:** 2026-11-10.
- **Commit:** `aed7f99` = `origin/chp/epub-mainfile-r1-release`. CI remota **3/3 en verde** (identity-preflight, security, content-rmw).
- **Producción:** `unifiedxp-13b8045`, con XP apagado.
- **Sin despliegue.** No se ha activado XP, no se ha restaurado ni compactado nada y no se han tocado `data/`, `data-critical/`, uploads, recursos editoriales ni respaldos. **Esta unidad no cambia código.**

## 1. Imágenes

| Imagen | ID | Config del manifiesto | SHA-256 del `tar.gz` | Bytes |
|---|---|---|---|---|
| `chibalete/api:v81-aed7f99` (`linux/amd64`) | `sha256:f4cb08b7db20580237c7c06402c6eddb47de806ab424e1c69513928ab1aa0236` | `sha256:8ec72be1733be01ed641d187536719b89301677ec543feb90adb539ecbb695ba` | `c6b7bdc360056e3af7c341a9b9b35cd7b5fe6d4ed9e5dd7ec9f2e097d66f9cf6` | 152 018 051 |
| `chibalete/front:v81-aed7f99` (`linux/amd64`) | `sha256:af156001a581190c8367a167074d7e508b3ab9620e01447ff1675a2ff569b000` | `sha256:6346de1cdb11a13f4c1802ea1606d993ac90f597b2f867d9282418ec87f2f917` | `c983ccffb14655c1809e0481361d5abb80f18dd8291cdd944db36cb914765083` | 28 664 286 |

- **Ubicación:** `D:\chp-artifacts\v81-aed7f99\`, fuera de Git. Contiene `MANIFEST.md`, `SHA256SUMS`, `evidence/` y `lab/`.
- **Obsoletas:** `v81-eb3f1bf`, `v81-dd16a8a` y `v81-325b8fc`.
- **Front:** el árbol servido es idéntico al de `v81-eb3f1bf`. El código del front no cambió.
- **Desplegar juntas:** la API nueva exige las decisiones de `ActivarCuenta`; con el front actual, la activación respondería 422. La API va primero y el front, en su propia ventana.

## 2. Verificación

**Contexto de build:** `git -c core.autocrlf=false archive aed7f99`. Solo un archivo contiene CR: `server/__test__/resetRequestNoTokenDisclosure.test.mjs`, que ya figura con fin de línea mixto en el índice. Es un test y no afecta al runtime.

**Seguridad:**
- **Integridad de la API:** 51/0. Sin secretos y sin `data/`, `data-critical/`, uploads, `scripts/` ni `.env`. `/app/secrets` vacío. Sin variables de gamificación, A2, documentos ni secretos en el entorno de la imagen.
- **Trivy 0.69.3** (HIGH/CRITICAL, `--ignore-unfixed`, `.trivyignore`): API **0** y front **0**.
- **gitleaks 8.21.2** sobre el árbol de `aed7f99`: sin hallazgos.

**Suites del servidor sobre el código de la imagen** (`--network none`, pruebas montadas en solo lectura): **70/70 en verde.** Son todas las de `test:v81`, `test:gamification-core`, `test:mook`, `test:exports`, `test:b2c`, credenciales, sesión, `auth-reset` y `self-password`, más `leoMemoryOwnership`.
- **Pruebas que necesitan algo fuera de la imagen:**
  - 11 suites MOOK combinan comprobaciones estructurales del código del front, así que se montaron `pages/`, `components/`, `hooks/`, `services/`, `context/` y `types/` en solo lectura;
  - `exportSubmissionsHttp` (83) y `ledgerBackupRestore` (17) necesitan Python y se ejecutaron en la derivada `chp-lab/api-py:aed7f99`, que es la imagen más `python3` y no es un artefacto.

| Área | Suites y resultado |
|---|---|
| Aceptación y activación | `acceptanceDecisions` 42, `acceptInviteDecisionsHttp` 31, `contractingLinkingHttp` 28 |
| A1, A2 y 005 | `a2Registry` 34, `mediatorValidityHttp` 14, `xpA1Eligibility` 23, `groupAnalyticsSummary` 107 |
| B2C, reintentos y supresión | `b2cProvisioning.unit` 42; `b2cProvisioning.integration` 77, con reenvío firmado tras la supresión (409), pedido nuevo legítimo y reembolso |
| Supresión, Leo, `insights` y cuarentena | `suppressionResidualHttp` 67: seis fuentes más `insights.db`, Leo con dos escritores concurrentes, compactación separada (`busy`, espacio, interrupción), dos réplicas y cuarentena. `suppressionRestoreHttp` 18, `rightsLifecycle` 27, `leoMemoryOwnership` 72 |
| XP 30/20/50 y rectificación | `workRecognition` 120, `xpPilotEmission` 71, `xpRectification` 44, `recognition`, `platformIntegration` 58 |
| MOOK | `mookReviewIdentity01a` 30, `mookReviewReplicaAuthz` 14, `mookStudioWorkRef` 73 y el resto de `test:mook` |
| O8 | `o8Check` 27 |

**Laboratorios sobre la imagen:**
- **A2 con dos réplicas:** 44/0. Cubre clave, carga C.1, C005, custodia, revocación sin reinicio, pérdida, restauración y corrupción.
- **Tokens de invitación:** 9/0.
- **Operador real de supresión y restauración en cuarentena:** 22/0.
  - Con la cuenta aún en el padrón responde `ACCOUNT_STILL_PRESENT`.
  - En cuarentena hay que eliminar la cuenta; desactivarla no basta.
  - La puerta solo se abre con 0 pendientes, y nunca si un registro no se puede verificar.
  - Se ejecuta `{"compact":true}` antes de promover.
  - Tras promover no se reabre ninguna cuenta.
- **O8 inerte:** OK, 0 fallos y 0 avisos. No existe `gamification.db` en la imagen.

**Compatibilidad API ↔ front:**
- El bundle usa `GET /api/acceptance/documents` y `POST /api/accept-invite`.
- Envía todos los campos que valida `acceptance.mjs`.
- Las versiones `001`, `002`, `004` y `005` `@1.0` coinciden con `utils/acceptanceDocuments.mjs` de la imagen.
- Estructural `ActivarCuentaDecisions`: 26/0.

## 3. Gate de instalación

Ningún requisito se declara cumplido sin evidencia. **«Sin evidencia»** significa que no hay ningún documento, registro ni lectura de producción que lo demuestre en esta unidad.

### 3.1 Indispensables para desplegar en modo inerte

| # | Condición comprobable | Cómo se comprueba | Estado |
|---|---|---|---|
| I1 | 001, 002, 004 y 005 aprobados en su versión exacta (`@1.0`), con URL `https:` estables | Acta de Dirección; `GET /api/acceptance/documents` sin pendientes en las dos réplicas | **Sin evidencia** |
| I2 | Clave de sujeto generada (F2), `0400`, con copia sellada bajo custodia | Evidencia F2 y acta de custodia; O8 `subject_key present:true` | **Sin evidencia** |
| I3 | Registro de decisiones (`CHP_A2_REGISTRY`) y registro de exclusiones (`GAMIFICATION_EXCLUSION_REGISTRY`) en directorios distintos, montados rw en las dos réplicas, fuera de los respaldos y con copia custodiada | Override; `a2_verify` y SHA-256 iguales en los dos montajes | **Sin evidencia** |
| I4 | Fichas C.1 verificadas por VER: A1/A2 por lector y C005 por mediador activo, o la aceptación escrita de Dirección del cierre del detalle individual | Recuentos por tipo y estado iguales a C.1 | **Sin evidencia** |
| I5 | Decisión sobre el efecto en los usuarios actuales (§3.3) | Acta de Dirección | **Sin evidencia** |
| I6 | Procedimiento de restauración en cuarentena y compactación separada asumido por AT (CLOSE-09A §4, 09B §4) | Procedimiento firmado | Documentado y probado en laboratorio. **Sin aceptación operativa** |
| I7 | Plan de rollback | Copia del override y etiquetas `rollback-pre-v81` | Preparado (§5). Se ejecuta en la ventana |

### 3.2 Necesarias para activar XP (no para el despliegue inerte)

| # | Condición | Estado |
|---|---|---|
| X1 | Gate jurídico de las fases F2–F8 (J1–J8) y acta O1 vigente | **Sin evidencia** (J1–J6/J8 en RED desde V8-ACTIVATION-GATE-01) |
| X2 | A1 efectiva por lector: sin ella, el ledger no emite (G-01) | **Sin evidencia** |
| X3 | Validación jurídica de las conservaciones: auditoría seudonimizada (C07), eventos de mediadores (C10), regla B2C con el número de pedido (C01/C03), fila de baja de `identity.db` (C03) | **Pendiente** |
| X4 | Criterio para agregados pequeños de `insights.db`: tamaño mínimo de cohorte por debajo del cual no se muestra el agregado | **Sin decidir.** No existe en el código |
| X5 | G-04, política de respaldos: ciclo 7/4/6, retención del proveedor y autorización de `forget --dry-run` | **Propuesta sin aprobar.** Sin `forget` |
| X6 | Emisor de WooCommerce | **Sin evidencia** (§3.4) |

### 3.3 Efecto sobre los usuarios actuales con la imagen nueva

| Si falta | Efecto |
|---|---|
| I1 | Ninguna invitación ni compra B2C se puede activar (503). Las cuentas activas entran y leen como hoy |
| I2/I3 | Fallo cerrado. Activación 503. Mediadores: status, exportación y revisión MOOK 503, y Aula Viva sin detalle individual. Las altas quedan invitadas. Sin el registro de exclusiones no se puede suprimir ni conciliar una restauración |
| I4: A2 de un lector | Sus mediadores no lo ven individualmente; solo el agregado |
| I4: C005 de un mediador | Pierde **todo** el detalle individual de sus lectores |
| Front sin desplegar | Toda activación responde 422 |

### 3.4 Estado de WooCommerce

**El emisor no está en el repositorio:** el envío de `termsAcceptance` y la gestión de las respuestas no se pueden verificar desde aquí. El contrato de la API **no cambia** para la tienda:
- `termsAcceptance` sigue siendo opcional;
- los reintentos de una cuenta viva siguen dando `already_activated`;
- un reenvío de un pedido cuya cuenta fue suprimida o eliminada responde `409 account_not_available`, el mismo código que ya recibe para una cuenta deshabilitada.

**Por comprobar con el responsable de la tienda:** que un 409 no se reintente en bucle y que no se muestre al comprador como un error de pago.

### 3.5 Conservación y restauración

- Toda restauración se hace en **cuarentena**:
  1. conciliación;
  2. `DELETE` de las cuentas suprimidas que reaparezcan y `/disable` de las que tengan A1 revocada;
  3. segunda pasada;
  4. compactación;
  5. puerta con 0 pendientes y 0 cambios.

  Solo entonces se promueve.
- **Sin restauraciones reales, sin compactaciones y sin cambios en los respaldos en esta unidad.**

## 5. Rollback

- **Imágenes:** `chibalete/api:unifiedxp-13b8045` (`sha256:c3361ee004a0d00fa36a1d79ffec25a57c27329f01cf584169c33b10caf04d5e`) y `chibalete/front:unifiedxp-13b8045` (`sha256:26a0a3f4cb9a0007fd593b846c0e68c07a4169f51760d0dcbff52ef005c665f0`). Son las de producción y siguen disponibles.
- **Procedimiento:** restaurar la copia del override y recrear `api_1` → `api_2` con las imágenes anteriores, de forma igual de progresiva, y después el front.
- **No se restaura ningún dato.** La clave y los dos registros quedan donde están: son append-only y las imágenes anteriores no los leen.
- **Efecto en las cuentas:** las invitadas creadas durante la ventana podrían activarse sin decisiones con la imagen anterior; se regularizan después con C.1. Con la imagen anterior, un reenvío B2C de un pedido cuya cuenta fue eliminada vuelve a crear una cuenta invitada (el defecto de antes de 09B).

## 6. Próxima acción ejecutable

Dirección entrega I1 (actas de 001, 002, 004 y 005 `@1.0` con URL HTTPS) e I4 (fichas C.1 verificadas). Con eso, AT ejecuta en una ventana P2–P7 de CLOSE-08B, con las imágenes de §1 y el gate §3.1.
