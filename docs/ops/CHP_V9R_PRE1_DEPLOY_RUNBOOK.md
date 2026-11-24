# CHP V9-R · PRE-1 — Preparación productiva y runbook de DEP-1

Estado: **preparado, NO ejecutado.** PRE-1 solo leyó producción; no desplegó, no activó ni modificó nada.
Fecha de las mediciones: 2026-11-24. Evidencia: `D:\chp-artifacts\v9r-rc1\evidence\pre1-*` y `pre1\`.

Candidata: imágenes `chibalete/api:v9r-a3c16e6` y `chibalete/front:v9r-a3c16e6` (construidas de APP `a3c16e6`), conector WEB `6dc8aed`, LU 0.10.0 (`41d17bf`). Los commits de APP posteriores a `a3c16e6` solo cambian documentación, excepciones de seguridad y guiones de `ops/`: no tocan `server/`, `utils/`, `engines/`, el front ni las dependencias, y **no requieren reconstruir las imágenes**.

## 1. Producción hoy (inventario de solo lectura)

| Capa | Estado |
|---|---|
| API | `chibalete/api:secsess-642820d` ×2 (`sha256:4949cd62…`), sanas |
| Front | `chibalete/front:unifiedxp-13b8045` (`sha256:26a0a3f4…`) |
| Conector WEB | `inc/chplus-b2c.php` md5 `43b64e45…` (anterior). Es el **único** archivo del tema que difiere de `6dc8aed` (88 archivos comparados) |
| LU distribuida | 0.9.2 (`/uploads/chibalete-lu-0.9.2.apk`, SHA-256 `4c7e29e6…`), `lu_config.json` la anuncia |
| Disco | 55 GB libres de 106 GB |
| Secretos | `admin_secret`, `b2c_provisioning_secret`, `session_signing_key`. **Falta `gamification_subject_key`** |
| Configuración V9 ausente | `CHP_A2_REGISTRY`, `GAMIFICATION_EXCLUSION_REGISTRY`, `CHP_ACCEPTANCE_DOCUMENTS`, `AULA_VIVA_CONTEXT_LEDGER_ENABLED` |
| Motores | `AULA_VIVA_SCHEDULER_ENABLED=1` e `INSIGHTS_MATERIALIZER_ENABLED=1` en las dos réplicas (el almacén derivado se está calculando) |

### Persistencia

| Almacén | En el respaldo | Nota para V9 |
|---|---|---|
| `events.db`, `events.archive.db`, `progress.db`, `offline_assignments.db`, `royalties.db`, `identity.db` | Sí | Sin cambios de esquema, salvo `identity.db`: la candidata añade la tabla `group_members` y su índice al arrancar |
| `insights.db` | Sí (hoy clasificada «reconstruible») | Con el registro de procedencia encendido añade `pedagogical_context_intervals`, `pedagogical_context_meta` y `reading_session_receipts`: evidencia original, no regenerable. El ejecutor de respaldo de la candidata ya la clasifica `CANON` (paso 3.2) |
| 23 almacenes JSON (padrón, grupos, reglas de acceso, contenido, Leo, MOOK…) | Sí | Sin cambio de forma |
| `sessions.db`, `secrets/` | No, por diseño | Sesiones: se regeneran. Secretos: custodia propia |
| Registro de decisiones y de exclusiones, clave de sujeto | No, por diseño | **Nuevos en V9.** Fuera de `data/`, `data-critical/` y los respaldos; copia custodiada por Dirección tras cada lote |
| `public/uploads` (5,8 GB) | Sí (`uploads-backup`, diario) | No se toca |

Respaldo estructurado cada 6 h (último: 2026-11-24 18:01 UTC, 32 almacenes, `ok`); verificación semanal correcta.

## 2. Qué quedó demostrado

1. **El respaldo se restaura.** Snapshot `7fe1456f` restaurado en cuarentena (`/var/backups/chibalete-backup/restore-rehearsals/V9R-PRE1-20261124T225520Z`): 32 de 32 almacenes con la misma huella que el manifiesto, `integrity_check=ok` en las 7 bases, JSON legibles. Ningún servicio arrancado.
2. **La candidata arranca sobre los esquemas reales.** No se cargó la imagen candidata en el servidor. De la copia restaurada se extrajeron solo esquemas y recuentos; en local, la imagen candidata arrancó sin red sobre bases vacías con esos esquemas y almacenes JSON sintéticos de la misma forma:
   - con la configuración que producción tiene hoy: arranque limpio, 0 errores, lectores, administración y LU funcionan; **mediación responde 503** (sin registro de decisiones);
   - con registros vacíos, clave de sujeto, documentos y registro de procedencia: mediación 403 en lo individual, tablero agregado 200;
   - tras cargar C005 y A1/A2 con `ops/a2/decision_operator.mjs` **sin reiniciar**: mediación 200;
   - de vuelta a la configuración anterior sobre los mismos datos: arranque limpio (las tablas añadidas no estorban).
3. **Las migraciones son solo aditivas** (tablas e índices nuevos; nada cambiado ni retirado). Un rollback de código no necesita restaurar datos.
4. **Las dos versiones de API conviven y el rollback funciona.** En local, `secsess-642820d` y la candidata corrieron a la vez sobre los mismos almacenes (esquema de producción, datos sintéticos): las dos leyeron y escribieron el progreso de la otra sin errores; retirada la candidata, la versión actual siguió funcionando sobre los datos que la candidata había tocado.

No demostrado: arranque de la candidata sobre los **datos** reales (solo sobre sus esquemas). Se comprueba en el paso 4.3, con una réplica drenada.

## 3. Condiciones de entrada a DEP-1

### 3.1 Decisiones que solo puede tomar Dirección

| # | Decisión | Por qué bloquea | Estado |
|---|---|---|---|
| D1 | Aprobar y publicar en HTTPS los documentos 001, 002, 004 y 005 en su versión `@1.0` | Sin `CHP_ACCEPTANCE_DOCUMENTS` ninguna cuenta se activa (503). 001 sigue «borrador», sin fecha de aprobación; 002 sin fecha de aprobación; 004 exige el 001 aprobado; ninguno está publicado. Si se aprueba otra versión hay que reconstruir las imágenes | Pendiente |
| D2 | Fichas C.1 verificadas: C005 de los mediadores y A1/A2 de los lectores, o aceptación escrita del cierre | Hoy 25 mediadores ven el seguimiento de 3 cursos reales (80, 80 y 64 lectores). Con V9 y sin esas decisiones, **Aula Viva se cierra para todos ellos** (503 sin registro; 403 sin C005/A2) | Pendiente |
| D3 | Ratificar el plazo de 12 meses / 365 días (§5) | Ningún documento lo recoge. Mientras tanto la poda queda apagada y los dispositivos aplican el plazo técnico | Pendiente |
| D4 | Productos #345 y #346 | Están **publicados y son comprables** por enlace directo (ocultos del catálogo, 0 ventas), con el conector anterior y el aprovisionamiento activo. Decidir si pasan a borrador hasta la activación comercial | Pendiente |
| D5 | Constantes `CHIBALETE_B2C_TERMS_VERSION` y `CHIBALETE_B2C_TERMS_URL` en la tienda | Sin ellas el conector nuevo no deja contratar la suscripción | Dependen de D1 |

### 3.2 Preparativos técnicos (se ejecutan en DEP-1, antes de la ventana)

1. Respaldo estructurado y de uploads manuales; anotar sus identificadores.
2. Ejecutor de respaldo: copiar `ops/backup/CHP-BACKUP-01B/runners/chibalete_backup/stores.py` de la candidata (única diferencia: `insights.db` pasa a `CANON`, no reconstruible). Rollback: restaurar el archivo anterior.
3. Clave de sujeto (procedimiento F2 de `V81_CLOSE_08B_RELEASE_FINAL.md` §3-P2): contenedor efímero de la imagen nueva, `umask 377`, nunca impresa, `secrets/gamification_subject_key` `0400` root. Copia sellada para Dirección. **No se rota jamás.**
4. Directorios `/var/www/chibalete/registry/decisions` y `/var/www/chibalete/registry/exclusions` (root, `0700`), cada uno con su archivo vacío (`decisions.log`, `exclusions.log`). **Los archivos deben existir antes de arrancar**: sin ellos la puerta cierra.
5. Override nuevo (copia fechada del actual primero), en las **dos** réplicas:
   ```yaml
   image: chibalete/api:v9r-a3c16e6
   environment:
     CHP_A2_REGISTRY: /app/registry/decisions/decisions.log
     GAMIFICATION_EXCLUSION_REGISTRY: /app/registry/exclusions/exclusions.log
     CHP_ACCEPTANCE_DOCUMENTS: '{"001":{"version":"001@1.0","url":"https://…"},"002":{…},"004":{…},"005":{…}}'
   volumes:
     - { type: bind, source: /var/www/chibalete/registry/decisions,  target: /app/registry/decisions,  bind: { create_host_path: false } }
     - { type: bind, source: /var/www/chibalete/registry/exclusions, target: /app/registry/exclusions, bind: { create_host_path: false } }
   ```
   `AULA_VIVA_CONTEXT_LEDGER_ENABLED` **no** se añade aquí (paso 4.7). XP, poda y retención no se tocan.
6. Carga de decisiones (D2): una línea JSON por decisión, por stdin, en un contenedor efímero sin red de la imagen nueva con `ops/a2/` montado en solo lectura; todas o ninguna. Después `a2_verify.mjs` e `inventory.mjs`; copia custodiada.

## 4. Secuencia de DEP-1

Cada paso tiene su comprobación. Si falla, **STOP** y rollback del paso; nunca se pasa al siguiente.

| Paso | Operación | Comprobación | Rollback |
|---|---|---|---|
| 4.0 | Confirmar D1–D5, respaldos (3.2-1) y sumas de los artefactos (`sha256sum -c SHA256SUMS`) | Sumas correctas; respaldo `ok` | — |
| 4.1 | Transferir y cargar las dos imágenes; etiquetar `rollback-pre-v9r` las actuales | ID de imagen = `MANIFEST.md` | `docker rmi` de las nuevas |
| 4.2 | Preparativos 3.2-2 a 3.2-6 | `a2_verify` con los recuentos de C.1; mismo SHA-256 del registro en los dos montajes | Retirar clave y directorios (no hay datos aún) |
| 4.3 | Drenar `api_2` en el edge, recrearla con la imagen y el override nuevos | En un paso propio: `healthy`, `/api/health` con `version=v9r-a3c16e6`, 0 errores en el registro, `/api/health/analytics` correcto, `/api/acceptance/documents` sin pendientes | Línea `image:` y bloque nuevo fuera; recrear `api_2` con la imagen anterior |
| 4.4 | Reincorporar `api_2`; observar | Inicio de sesión, lectura, tablero de un mediador con C005 y de la administración | Igual que 4.3 |
| 4.5 | Lo mismo con `api_1`, en otro paso | Igual que 4.3 y 4.4, en `api_1` | Igual, para `api_1` |
| 4.6 | Front, en su propia ventana: imagen `v9r-a3c16e6`, recrear `front`, recargar el edge | Carga de la aplicación, activación de una cuenta de prueba, panel institucional | Imagen `unifiedxp-13b8045` |
| 4.7 | Registro de procedencia: `AULA_VIVA_CONTEXT_LEDGER_ENABLED: "1"` en las dos réplicas, una a una | `/api/health/analytics` → `checks.context_ledger.enabled: true`, intervalos de línea base; la poda sigue `enabled: false` | Quitar la variable (las tablas quedan; no estorban) |
| 4.8 | Conector WEB: copia del archivo actual; instalar `inc/chplus-b2c.php` de `6dc8aed`; definir las constantes de D5 | md5 `aae19b14…`; `php -l`; `wp chplus-b2c pending`; WP-Cron con el evento `chplus_b2c_sync_pending` | Restaurar el archivo (md5 `43b64e45…`, `web-connector-rollback-1897e32.tar.gz`) |
| 4.9 | Compra real controlada (una, autorizada) y su activación; luego su reembolso | Cuenta invitada, activación con fechas, 12 meses desde la activación, calendario de Mi biblioteca; el reembolso cierra el acceso | Procedimientos de `CHP_V9_BII_B2C_OPERATING_PROCEDURES.md` |
| 4.10 | LU 0.10.0: subir el APK con nombre versionado; copia de `lu_config.json`; apuntar `version` y `apkUrl` | SHA-256 del APK servido = `55d996cb…`; `/api/lu/version`; actualización en un dispositivo real desde 0.9.2 con una cuenta de prueba | Restaurar `lu_config.json` (0.9.2 sigue en `/uploads`) |

**STOP inmediato** si: una réplica no queda `healthy`; aparecen errores de esquema en el registro; `/api/acceptance/documents` deja documentos pendientes; un mediador con C005 no ve su curso; la otra réplica muestra errores mientras conviven las dos versiones; el respaldo siguiente no termina `ok`.

**Orden del rollback completo:** LU → conector → front → API (réplica a réplica) → override. Nunca se restauran datos en un rollback de código. El conector nuevo no puede quedar sobre la API anterior.

WP-Cron: `DISABLE_WP_CRON` no está definido y no hay cron del sistema; el seguimiento diario depende de las visitas a la tienda. Alternativa controlada: `wp chplus-b2c sync` a mano o por cron del alojamiento.

## 5. Privacidad y conservación

- **Plazos.** Servidor: constancias de sesión y membresías cerradas, 12 meses de calendario (`contextLedger`, poda apagada con doble bandera). Web: lo pendiente de una cuenta ausente del navegador, 365 días. LU: lo pendiente de una cuenta que no es la activa, 365 días **desde el último guardado de cada sesión**; lo de la cuenta activa no caduca. Ningún documento jurídico recoge hoy estos plazos (D3).
- **Supresión.** Eliminar la cuenta (`DELETE /api/users/:id`) y ejecutar `ops/a2/suppression_operator.mjs`. El dispositivo recibe la señal (`account_removed` o la consulta desde otra cuenta) y borra lo suyo. El 004 dice «no se promete borrado remoto de dispositivos sin capacidad verificada»: la capacidad existe desde LU 0.10.0, con el límite de que alguien debe iniciar sesión en el dispositivo.
- **Menores, GVA/AT, representación, mayoría de edad y revocaciones:** `CHP_V9_BII_B2C_OPERATING_PROCEDURES.md` y `POST /api/users/:id/representation`; sin cambios en PRE-1.
- **Cuenta personal existente.** Hay 1 cuenta B2C en producción. Con el registro activo, su acceso depende de sus decisiones (T/A1): anotarlas en D2 o confirmar que es de prueba.

## 6. Datos derivados

Medido sobre la copia restaurada (solo recuentos):

- 672 cuentas (251 activas), 21 grupos, 25 mediadores, 627 lectores en grupos.
- **1** cuenta personal B2C (29 eventos, 1 perfil y sus señales en `insights.db`). **Ningún** lector de colegio con obras propias.
- `insights.db`: 52 perfiles, 1 248 señales, 33 agregados de cohorte. **0** filas en historial de riesgo, recomendaciones e impacto de intervenciones: no hay historiales acumulativos que conservar ni que purgar.
- Telemetría: 2 620 eventos heredados (lejos del tope de 50 000); 165 de LU, ninguno con constancia de recepción (V9 no los acredita y lo declara).

**Decisión: no hace falta reconstruir el almacén derivado.** Ningún indicador institucional está mezclado con lectura personal (la única cuenta personal no pertenece a ningún curso) y V9 no sirve sus filas a la administración ni a la mediación. Tras el despliegue el materializador deja de alimentarlas. Si Dirección quiere retirarlas, son regenerables: borrar por `user_id` en `user_reading_profiles` y `signal_snapshots` con el respaldo del día como reversión. No se ejecuta sin orden.

### Configuración institucional que V9 hará visible

- **7 cursos sin obras asociadas** (la administración verá ceros con su aviso): `group-historical-grupo-101`, `group-chiba1`, `group-chiba2`, `group-chiba3`, `group-1775601733887`, `lt-test-group-v2` (400 miembros de prueba de carga) y `group-1781223321376` (3 lectores, sin mediador).
- 14 grupos sin mediador (10 son grupos de 1 a 3 lectores con obras); 4 con mediadores que ya no tienen cuenta; 6 sin `organizationId`; `group-chiba1` con 3 miembros sin cuenta.
- 421 cuentas deshabilitadas (prueba de carga).

Nada de esto impide desplegar; son datos que la institución puede corregir cuando quiera.

## 7. Seguridad

- OSV: retiradas las 5 excepciones vencidas; el escáner pasa sin ninguna (575 paquetes).
- Trivy: retiradas 3 excepciones que ya no encuentran nada; queda `AVD-DS-0002` (contenedores como root), riesgo aceptado, revisión 2027-02-28.
- Repositorio público de APP: sin secretos (gitleaks, historial incluido, en CI). Contiene la IP del servidor en 36 documentos (dato público por DNS; el acceso SSH es solo por clave).
- LU: APK 0.10.0 firmado con el certificado de la línea distribuida (`7cd34ce8…5f66`); instalado sobre la 0.9.2 distribuida y arrancado dos veces sin red, sin cierres. La conservación de datos al actualizar se probó con variantes de laboratorio (RC-1), no con el APK firmado: se cierra en el paso 4.10.

## 8. Guiones de PRE-1

`ops/preflight/v9r/`: `restore-verify.py` (verifica un ensayo de restauración contra su manifiesto), `shape-export.py` (esquemas y recuentos, sin valores) y `prod-analysis.py` (recuentos de configuración institucional y de lectura personal). Solo lectura; se ejecutan sobre una copia en cuarentena, nunca sobre los almacenes vivos.
