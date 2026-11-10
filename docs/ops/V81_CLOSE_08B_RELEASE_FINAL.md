# V8.1-CLOSE-08B: release definitiva y procedimiento de instalación inerte

**Fecha:** 2026-11-10.
- **Commit:** `eb3f1bf` = `origin/chp/epub-mainfile-r1-release`. CI remota **3/3 en verde** (identity-preflight, security, content-rmw).
- **Producción:** `unifiedxp-13b8045`, con XP apagado.
- **Alcance de esta unidad:** sin despliegue, sin claves ni registros productivos, sin autorizaciones reales ni ficticias en producción y sin tocar datos ni respaldos.

## 1. Imágenes definitivas

| Imagen | ID | SHA-256 del artefacto |
|---|---|---|
| `chibalete/api:v81-eb3f1bf` (`linux/amd64`) | `sha256:61a7c60a49319447081d1ecae69de5e66ef7f0fab7f0af3d23d53073dfd04be7` | `ed55253649817113de67fc833e576caec9ca9274ccf4d380a5a8ffe2241d84ce` |
| `chibalete/front:v81-eb3f1bf` (`linux/amd64`) | `sha256:167955096b70fccdb97287d76a9f593a40dff15735783274bfbc4a81da7fa4f1` | `79c534f73ae3a1a87b885efaa47b3f1f4408a664bb15a227aedc5b1b4b78b1ca` |

- **Ubicación:** `D:\chp-artifacts\v81-eb3f1bf\`, fuera de Git. Contiene `MANIFEST.md` (reproducción, configuración del manifiesto y bytes), `SHA256SUMS`, `evidence/` y `lab/`.
- **Contexto de build:** `git -c core.autocrlf=false archive eb3f1bf`. Solo un archivo contiene CR: `server/__test__/resetRequestNoTokenDisclosure.test.mjs`, que ya está con fin de línea mixto en el índice. Es un test y no afecta al runtime.
- **Front:** el código no cambia desde `dd16a8a` y el árbol servido es idéntico al de `v81-dd16a8a`. Se reconstruye para que la pareja quede trazable al mismo commit.
- **Obsoletas:** `v81-dd16a8a` y `v81-325b8fc`.

## 2. Pruebas y seguridad

**Integridad de la API:** 51/0.
- Sin secretos y sin `data/`, `data-critical/`, uploads ni `scripts/`.
- Sin variables de gamificación, A2, documentos ni secretos en el entorno de la imagen.

**Seguridad:**
- **Trivy 0.69.3** (HIGH/CRITICAL, `--ignore-unfixed`, `.trivyignore`): API **0** y front **0**.
- **gitleaks 8.21.2** sobre el árbol de `eb3f1bf`: sin hallazgos.

**O8 sobre la imagen**, modo inerte: OK, 0 FAIL y 0 WARN. No hay clave, registro de exclusiones ni ledger.

**Suites sobre el código de la imagen** (`--network none`, pruebas montadas en solo lectura): **24/24 en verde.**

| Área | Suite | Resultado |
|---|---|---|
| A2 | `a2Registry` | 34 |
| Aceptación | `acceptanceDecisions` / `acceptInviteDecisionsHttp` | 42 / 31 |
| Contratación | `contractingLinkingHttp` | 28 |
| Compromiso 005 | `mediatorValidityHttp` | 14 |
| Alcance | `authzSubjectScope` | 45 |
| Aula Viva | `groupAnalyticsSummary` | 107 |
| Exportaciones | `exportSubmissionsHttp` | 83 ¹ |
| MOOK | `mookReviewIdentity01a` / `mookReviewReplicaAuthz` / `experienceStore` / `mookSource` | 30 / 14 / 22 esc. / 48 |
| Supresión y restauración | `suppressionRestoreHttp` / `rightsLifecycle` / `exclusion` | 16 / 27 / 60 |
| XP | `xpA1Eligibility` / `workRecognition` / `studentProgressHttp` / `myProgress` / `historyDayBogota` / `platformIntegration` | 23 / 120 / 49 / 71 / 9 / 58 |
| Rectificación | `xpRectification` | 44 |
| O8 | `o8Check` | 27 |

¹ `exportSubmissionsHttp` exige Python como lector ZIP independiente. Se ejecutó en una derivada de laboratorio (`chp-lab/api-py`), que es la misma imagen más `python3`. Esa derivada no es un artefacto.

**Laboratorios sobre la imagen:**
- **A2 con dos réplicas** (CLOSE-03, actualizado a G-07): **44/0**. Cubre clave, carga C.1, custodia, revocación sin reinicio, pérdida, restauración y corrupción. Además:
  - sin C005, el mediador no ve a ningún lector, aunque el lector tenga A2 = Sí;
  - el C005 se anota con `decision_operator`, con acuse sin ids;
  - XP apagado: el progreso individual responde 404 y no existe `gamification.db`.
- **Tokens de invitación:** 9/0.
- **Restauración en cuarentena** (§4): **19/0**.

**Compatibilidad API ↔ front:**
- El bundle usa `GET /api/acceptance/documents` y `POST /api/accept-invite`.
- Envía todos los campos que valida `acceptance.mjs`: `terms`, `termsVersion`, `dataNoticeVersion`, `actingAs`, `adultDeclared`, `A0`, `A1`, `A2`, `mediatorCommitment` y `mediatorVersion`.
- Las versiones `001@1.0`, `002@1.0`, `004@1.0` y `005@1.0` coinciden.
- Estructural `ActivarCuentaDecisions`: 26/0.
- La API nueva **requiere** este front: con el actual, toda activación respondería 422.

## 3. Procedimiento productivo (preparado, NO ejecutado)

Orden obligatorio. Cada paso tiene su propio gate. Si un gate falla, no se pasa al siguiente.

### P1. Documentos aprobados y enlaces HTTPS
- **Dirección declara** 001, 002, 004 y 005 como aprobados, cada uno en su versión exacta y con un enlace `https:` público y estable.
- **Formato:** `CHP_ACCEPTANCE_DOCUMENTS='{"001":{"version":"001@1.0","url":"https://…"},"002":{…},"004":{…},"005":{…}}'`.
- Va en el override de **ambas** réplicas.
- **Gate:** `GET /api/acceptance/documents` sin pendientes, en las dos réplicas.

### P2. Clave y registros, con custodia
1. Generar la clave de sujeto (procedimiento F2 de CLOSE-03):
   - dentro de un contenedor efímero de la imagen nueva, con `umask 377`;
   - nunca impresa;
   - destino `secrets/gamification_subject_key`: `0400`, root, 96 bytes.
   - Se hace una copia sellada de la clave bajo la custodia de Dirección.
2. Directorio del **registro de decisiones** (`CHP_A2_REGISTRY`):
   - montado rw en las dos réplicas;
   - fuera de `data/`, `data-critical/` y de los respaldos;
   - archivo vacío.
3. Directorio del **registro de exclusiones** (`GAMIFICATION_EXCLUSION_REGISTRY`):
   - distinto del de decisiones y del de `gamification.db`;
   - fuera de los respaldos;
   - archivo vacío.
   - Sin él no se puede ejecutar ninguna supresión ni conciliar ninguna restauración (§4).
4. **Gate:** `a2_verify` da `{"ok":true,"readers":0}`; O8 sigue en modo inerte; existe una copia custodiada con SHA-256.

### P3. Carga de autorizaciones reales
- **Fuente:** solo fichas C.1 verificadas por VER: A1/A2 por lector y C005 por mediador (`ops/a2/decision_operator.mjs`, por stdin).
- **Qué no se anota:** las pendientes ni las «No aplica». No existe ningún valor por defecto.
- **Copia custodiada:** se actualiza después de cada lote.
- **Gate:**
  - recuento por tipo y estado igual al de C.1;
  - todos los mediadores activos tienen C005, o su cierre está aceptado por escrito.

### P4. Verificación del registro en ambas réplicas
- Con la imagen nueva en un contenedor efímero que monta lo mismo que cada réplica: `a2_verify` da el mismo recuento y el mismo SHA-256 en los dos montajes.
- **Gate:** coincidencia exacta con la copia custodiada.

### P5. Despliegue controlado (`deployment_guide.md`)
1. `docker load` con `sha256sum -c` y comprobación del ID de §1.
2. Copia del override y etiquetas `rollback-pre-v81` de las imágenes actuales.
3. **API:**
   - `api_1`: drain, recreate, health y logs en un paso propio (sin `[A2] clave no disponible`), rejoin;
   - después `api_2`, igual. Nunca las dos a la vez.
4. **Front:** en su propia ventana, inmediatamente después de la API. Hasta que el front cambie, las activaciones fallan (422).
5. XP: sin `GAMIFICATION_ENABLED` ni `XP_EARNING_ENABLED`.

### P6. Pruebas posteriores
- **Lectura:** biblioteca, los cuatro visores y el progreso propio, con una cuenta lectora real o de servicio.
- **Activación:** una invitación de servicio, decisiones completas y aceptación, que deja un registro T/A0/A1/A2 anotado.
- **Mediación:**
  - status, Aula Viva, exportación y revisión MOOK de un lector con A2 y mediador con C005 ⇒ 200;
  - sin A2 o sin C005 ⇒ 403.
- **Contratos:** `POST /api/users` crea la cuenta invitada sin A1/C005 efectivas; el `PUT` de invitada a activa responde 409.
- **Rollback en seco:** existen la copia del override y las etiquetas `rollback-pre-v81`.

### P7. XP apagado
- O8 en las dos réplicas: `mode: inerte`, 0 FAIL.
- Progreso individual 404 y sin `gamification.db`.

### Rollback
- Restaurar la copia del override y recrear `api_1` → `api_2` con `unifiedxp-13b8045` (API `c3361ee0…`, front `26a0a3f4…`), igual de progresivo.
- **No se restaura ningún dato.** El registro de decisiones, el de exclusiones y la clave quedan donde están: son append-only y las imágenes anteriores los ignoran.
- **Efecto en las cuentas:** las invitadas creadas en la ventana se podrían activar sin decisiones con la imagen anterior. Se regularizan después con C.1.

### Efecto de cada condición faltante sobre los usuarios actuales

| Falta | Efecto con la imagen nueva |
|---|---|
| P1: documentos sin declarar | Ninguna invitación ni compra B2C se puede activar (503). Las cuentas activas leen y entran como hoy |
| P2: sin clave o sin registro de decisiones | Fallo cerrado: activación 503. Mediadores: status, exportación y revisión MOOK 503, y Aula Viva sin detalle individual (incluido el administrador). Las altas quedan invitadas. La lectura propia no cambia |
| P2: sin registro de exclusiones | No se puede ejecutar ninguna supresión ni conciliar ninguna restauración. El resto no cambia mientras XP siga apagado |
| P3: lector sin A2 | Sus mediadores no lo ven individualmente: status 403, fuera de Aula Viva, exportación 403 y producciones MOOK no revisables. Queda solo el agregado, y con pocos visibles el agregado se limita a ellos |
| P3: mediador sin C005 | Pierde **todo** el detalle individual de todos sus lectores, aunque tengan A2 (G-07) |
| P3: lector sin A1 | No es elegible para XP. Sin efecto mientras XP siga apagado |
| P3: cuentas nuevas por administración sin A1/C005 | Quedan invitadas hasta que las active su titular o se regularicen |
| Front sin desplegar | Toda activación responde 422 |
| Emisor Woo sin `termsAcceptance` | La compra se aprovisiona igual (el campo es opcional); la T se anota en la activación |

## 4. Recuperación: aislamiento obligatorio

**Hallazgo:** el login solo comprueba `accountStatus`. Un padrón restaurado trae a las personas suprimidas como activas: **pueden iniciar sesión** hasta que AT las desactive. El laboratorio lo reproduce con un login 200. Ningún mediador las ve, porque la A2 revocada vive en un registro que no se restaura. Aun así, la cuenta podría volver a generar datos.

**Condición obligatoria:** toda restauración se hace en **cuarentena**, nunca sobre los stores vivos:
1. `restic restore` a un directorio aislado, sin réplica que lo sirva y sin tráfico del edge.
2. Conciliar contra los registros independientes **vigentes** (exclusiones y decisiones):
   - `suppression_operator` en modo `{"reconcileAfterRestore":true,"holds":…}`, con las conservaciones de G.1;
   - `/disable` de cada cuenta listada, en una instancia de cuarentena sin red pública;
   - las revocaciones (A1, A2 y C005) rigen solas, porque se leen del registro en cada petición.
3. **Puerta de promoción**, solo lectura, con fallo cerrado. Se abre únicamente si:
   - `accountsToRestrictAfterRestore` devuelve 0;
   - quedan 0 recorridos, producciones (salvo `legalHold`) y entregas de personas con tombstone;
   - los dos registros son verificables.
4. Solo con la puerta abierta se promueven los archivos a los stores vivos y se reabre el edge.

**Laboratorio sobre la imagen** (`lab/restore_quarantine.lab.mjs`): 19/0.
- La puerta está cerrada antes de conciliar y sigue cerrada tras el operador hasta el `/disable`.
- Con el registro de exclusiones ilegible, el operador falla sin escribir y la puerta no abre.
- Una conciliación repetida no encuentra nada.
- Después de promover: login 401 y status distinto de 200; el texto privado no vuelve a los archivos; los demás lectores siguen sin cambios.

**Sin restaurar datos reales.**

## 5. Conservación: decisiones pendientes (sin `forget`, respaldos intactos)

1. **Plazos:**
   - ciclo C11 propuesto en 7/4/6, es decir, una persona suprimida desaparece de los respaldos en ≤ 6 meses + 7 días;
   - C03 +90 d; C04 +2 años ⚖; C05 relación + 12 meses; C06 12 meses; C07 30 d / 2 años ⚖; C08 30 d ⚖; C10 90 d / 12 meses; C12 2 años ⚖; C01 10 años.

   Pendiente: validación jurídica y aprobación de Dirección.
2. **Fuentes remanentes** que la supresión no trata: `events*.db`, `progress*`, `leo_*`, `user_audit_log.json` (contiene correos), `access_db.json` (reglas de usuario) e `identity.db`.

   Dirección decide, para cada una, si se elimina, se seudonimiza o se conserva hasta su plazo. Mientras tanto **no se declara anonimización**.
3. **Retención del proveedor** (copias de Hostinger, 006 P10): Dirección la confirma con el proveedor y se incorpora como fila de C11.
4. **Autorizar el cambio del runner** (solo `forget --dry-run` con `--tag <tipo> --group-by host`) y la simulación de 4 semanas. Ese paso es una unidad propia.
