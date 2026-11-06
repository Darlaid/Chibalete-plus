# V8 — Procedimiento operativo de activación general de XP

**Fecha:** 2026-11-06. **Unidad:** V8-ACTIVATION-READINESS-01. **Estado:** `V8_ACTIVATION_READY_DOC`. Es un procedimiento preparado, **no** una autorización.

**Este documento no activa nada, no aprueba PRIV-6 y no elige una base jurídica.** Ordena la activación general de XP (sin lista de participantes: B1 está descartado como requisito de producto) y la contrasta con el código y la producción reales. Las decisiones jurídicas ya están descritas en [V7 decisiones](GAMIFICACION_V7_DECISIONES_ACTIVACION_PILOTO_V1.md) (D1–D9, L1–L5, N1); aquí no se repiten.

**Fuentes:**
- [PRIV-6 revisión](GAMIFICACION_PRIV_06_REVISION_JURIDICA_V1.md) (checklist C-1…C-12) y [aviso propuesto](GAMIFICACION_PRIV_06_AVISO_PROPUESTA_V1.md).
- [PRIV-C7 retiro](GAMIFICACION_PRIV_C7_RETIRO_EXCLUSION_V1.md) (P1–P4 y runbook §5).
- [A7-A12-V3](GAMIFICACION_A7_A12_APROBACION_V3.md) (reglas 30/20/50 y procedimiento del acta).
- [Despliegue inerte V8](../ops/V8_INTEGRATION_02B_R1_DEPLOY_EVIDENCE.md) y `deployment_guide.md` (rollout por réplica).

---

## 0. Estado verificado (lectura, 2026-11-06 ~21:20Z)

| Elemento | Estado real |
|---|---|
| Rama | `chp/epub-mainfile-r1-release` = `3877108` (local = remoto) |
| API | `chibalete/api:v8inert-0665c16` = `020d90e3…` ×2, healthy |
| Front | `chibalete/front:v8inert-0d2ef7b` = `a7fd0ccf…`, healthy |
| Flags | 0 variables `GAMIFICATION_*`/`XP_*`/`PM_*` en las dos réplicas |
| `mook_review` | En `XP_LOCKED_SOURCES` y `PM_LOCKED_SOURCES` en las dos réplicas (`policy.mjs:35-36`) |
| Clave de sujeto | Ausente (`/app/secrets` solo tiene `admin_secret`, `b2c_provisioning_secret` y `session_signing_key`) |
| Registro de exclusiones | Sin ruta, sin volumen |
| `gamification.db` | Ausente. Sin ledger y sin reglas |
| G4 en proceso | `readMyProgress` → `{status:404}`; `readGroupRecognition` → `null`; `startMookReconciler` → `null` (en las dos réplicas) |
| MOOK | `exp-1793925477270-j1onug` en `draft`, versión en `draft`, 0 recorridos, 0 entregas |
| Datos | Stores y 3524 uploads idénticos al preflight del despliegue inerte |

**Hoy ninguna réplica puede conceder XP.** Para hacerlo harían falta las seis condiciones a la vez, y no se cumple ninguna:

1. Flags en el entorno del proceso (solo cambian con un recreate).
2. `mook_review` fuera de la constante (solo cambia con una release).
3. Clave de sujeto.
4. Registro de exclusiones legible.
5. Reglas vigentes.
6. Una experiencia con nodos PRODUCTION publicada después del corte.

## 1. Contratos de activación verificados en el código

| # | Contrato | Comportamiento real | Referencia |
|---|---|---|---|
| 1 | Flags | `GAMIFICATION_ENABLED` gobierna todo. `XP_EARNING_ENABLED` depende de él (`1`/`true`). `PM_EARNING_ENABLED` es independiente y debe seguir sin definir. Se leen de `process.env`, así que **cambiar una flag exige recrear el contenedor** | `db.mjs:36-55` |
| 1b | Visibilidad de «Mi progreso» | Sin `GAMIFICATION_ENABLED` → 404. Con él pero sin XP → `{enabled:false}`. Con los dos → contrato completo. Si la base aún no existe o falla → 503. El front muestra el enlace (Perfil propio y Experiencias) **solo** si la respuesta es `ok`: con XP activo, **todos los lectores ven el enlace en su perfil**, tengan XP o no | `mookSource.mjs:130-150`; `server.js:2670-2694`; `hooks/useMyProgressAvailable.ts:15-27`; `pages/Perfil.tsx:324` |
| 2 | `mook_review` | Bloqueado por una constante de código. Ninguna regla ni flag lo levanta: `validateRules` rechaza XP de una fuente bloqueada (`XP_SOURCE_LOCKED`). Cinco tests fijan el bloqueo y tendrán que actualizarse en la release de desbloqueo | `policy.mjs:36,81`; `server/gamification/__test__/`: `workRecognition.test.mjs:326`, `xpPilotEmission.test.mjs:272`, `subjectReconcile.test.mjs:144`; `server/__test__/`: `mookLearnerUx03b.test.mjs:149`, `mookStudioWorkRef.test.mjs:186` |
| 3 | Reglas 30/20/50 | `createRuleSet` es append-only, prospectivo (`effectiveFrom ≥ now`, `RETROACTIVE_RULES`) e idempotente por `ruleVersion` + SHA-256. `recognition` exige `approvalRef`, XP de lectura y reflexión > 0, techo > 0 y PM = 0. **Además** valida `schema: 1`, `facts` y `caps` (`pmPerDay`, `pmPerWeek`, obligatorios). Sin reglas vigentes, el reconocimiento falla con `NO_ACTIVE_RULES` | `ledger.mjs:105-110,160-186,236-237`; `recognition.mjs:205-215`; `policy.mjs:92-97` |
| 3b | Mecanismo de instalación | **No hay script ni endpoint.** La única vía es la función de librería `createRuleSet` ejecutada dentro del contenedor (como en los tests). No se crea un script nuevo: el comando va en el paso F4 | `xpPilotEmission.test.mjs:50,81` (forma usada en pruebas) |
| 4 | Clave de sujeto | Archivo fijo `/app/secrets/gamification_subject_key`, mínimo 32 caracteres. `readSecretFile` exige modo `0400`, mismo uid/gid que el proceso y sin enlaces simbólicos. Se carga **una vez**, al arrancar el reconciliador (solo con `GAMIFICATION_ENABLED`): debe existir **antes** del recreate que encienda la flag. No hay rotación: rotarla invalida los tombstones | `subjectKey.mjs:15-34`; `lib/secretFile.js:28,111-132`; `mookSource.mjs:463-469` |
| 5 | Registro de exclusiones | Ruta en `GAMIFICATION_EXCLUSION_REGISTRY`, sin valor por defecto, en un directorio **distinto** del de la base (`EXCLUSION_REGISTRY_NOT_INDEPENDENT`). Archivo ausente, alterado o desalineado con `gm_erasures` ⇒ ninguna ingesta. Un archivo vacío es válido. **No está en el inventario de respaldos, a propósito**: necesita copia separada (P2) | `exclusions.mjs:9-60`; PRIV-C7 §5.1 |
| 6 | Base y respaldos | Ruta por defecto `data-critical/gamification.db` (el volumen ya montado). `structured-backup` la incluye como `CANON`, opcional: hoy registra `absent_optional` y la copiará cuando exista | `db.mjs:24,58`; `ops/backup/.../stores.py:93` |
| 7 | `GAMIFICATION_MOOK_SINCE` | ISO 8601, obligatorio. Sin él, el reconciliador no arranca y no hay candidatos. Solo cuentan aprobaciones y experiencias **posteriores** al corte | `mookSource.mjs:40-56,463-466` |
| 8 | Publicación posterior al corte | Requisito de PRIV-6 C-12. El código no lo impone: lo garantiza el orden de los pasos. Una experiencia publicada se lista a todos los usuarios autenticados | PRIV-6 §6; V7 §3.1 |
| 9 | Reconciliadores | Un barrido por vez entre réplicas (lock con renovación), intervalo de 15 min por defecto (`GAMIFICATION_RECONCILE_INTERVAL_MS`, mínimo 60 s) y primer barrido a los 60 s. Los ganchos (`onMookEvidenceReviewed`, `onMookRunUpdated`) reconocen al aprobar. Todo es idempotente por hecho: probado con dos réplicas reales y con cuatro reconciliadores concurrentes | `mookSource.mjs:33-38,218-240`; `server.js:2657,3178,12979`; `platformIntegration`/`platformScale` (CI y despliegue inerte) |

## 2. Matriz GO / NO-GO

GO exige **todas** las filas en GO, con su evidencia archivada. Una sola fila en NO-GO detiene la activación.

### 2.1 Gate jurídico (lo decide Legal y Dirección, nunca Ingeniería)

| # | Criterio verificable | GO si… | NO-GO si… | Evidencia exigida |
|---|---|---|---|---|
| J1 | PRIV-6 aprobado formalmente | Hay un acta con autoridad, fecha y alcance, que cubre la activación **general** | No hay acta, o solo cubre un piloto limitado | Acta versionada en `docs/gamificacion/aprobaciones/` |
| J2 | Modelo de participación general habilitado (D1) | Legal valida por escrito información y oposición para todos los lectores elegibles | **Legal exige autorización individual previa.** Hoy no hay mecanismo que la haga cumplir sin exclusiones irreversibles (V7 §3.2). **NO-GO hasta que exista ese mecanismo** | Dictamen escrito de D1 |
| J3 | Avisos comunicados (C-3, C-4, C-11, D7) | Aviso B aprobado y sin marcas, entregado a **todas** las familias con acceso a obras con PRODUCTION, y aviso C a los mediadores, **antes** del corte | Falta cobertura de algún grupo con acceso | Constancia del colegio o canal de D7, con fecha anterior al corte |
| J4 | Roles, retiro y custodia (D3, D9, L5, P2, P4) | Hay un canal de solicitudes, un responsable de retiros con plazo, un custodio del registro de solicitudes y un custodio de la copia del registro de exclusiones | Falta cualquiera | Designaciones por cargo (sin datos personales) |
| J5 | Retención y respaldos (D4, D5, L1, L2, L3) | Hay decisiones escritas sobre la conservación del ledger, las copias, el borrado frente a la desvinculación, el tombstone y la irreversibilidad | Alguna exige borrado, plazo o reincorporación: código nuevo (B2–B4), NO-GO hasta esa unidad | Acta de decisiones |
| J6 | Derechos de menores (D2, D6, D8) | Papel del colegio documentado, DPIA aceptada y redacción de derechos y plazos aprobada | Falta cualquiera | Documentos firmados |
| J7 | Riesgo residual T3 (PRIV-C7 §6) | Dirección acepta por escrito que una restauración conjunta de base y registro desde copias antiguas puede perder exclusiones, con la mitigación de custodia separada | No se acepta | Aceptación escrita |
| J8 | Orden de activación | Dirección emite una orden explícita y separada de las aprobaciones (A7-A12-V3 §2) | No hay orden | Orden escrita con fecha |

### 2.2 Gate operativo

| # | Criterio | GO si… | Evidencia |
|---|---|---|---|
| O1 | Acta de reglas | `APROBACION-<approvalRef>.md` fusionado, con el SHA-256 del bloque JSON de A7-A12-V3 §1, `ruleVersion`, entrada en vigor y los **topes `caps`** confirmados (ver §6, H1) | Commit del acta |
| O2 | Release de desbloqueo | Imagen con `mook_review` fuera de `XP_LOCKED_SOURCES`, CI 3/3 verde, Trivy 0 HIGH/CRITICAL y laboratorio con XP activo idéntico al de V8 | Evidencia de la unidad de release |
| O3 | Clave de sujeto | El archivo existe en las dos réplicas con modo `0400` y su copia de custodia está confirmada | Comprobación de modo y existencia, sin leer el valor; acuse del custodio |
| O4 | Registro | Volumen propio, distinto de `data/` y `data-critical/`, montado rw en las dos réplicas, con archivo vacío y copia separada configurada | Montajes con `node scripts/security/safeOperationalEvidence.mjs container-summary <réplica>` (nunca el entorno completo), `wc -l` = 0, acuse del custodio |
| O5 | Respaldo | Último `structured-backup` correcto con menos de 24 h; ninguno en curso durante la ventana | `journalctl` del servicio |
| O6 | Producción sana | Cuatro contenedores healthy, 0 5xx en la última hora, disco > 20 GB | Preflight del runbook de despliegue |
| O7 | Contenido elegible | Solo existen las experiencias con PRODUCTION que se van a publicar, y ninguna se ha publicado antes del corte | Lectura de `mook_db.json` |
| O8 | Alarmas D41 | Hay umbrales y responsable para las aprobaciones anómalas (A7-A12-V3 §4.8) | Documento de alarmas |

**Estado actual:** J1–J8 en NO-GO (ninguna decisión tomada) y O1–O4 y O8 en NO-GO. O5–O7 se cumplirían hoy.

## 3. Secuencia de activación

Cada fase se inicia **solo** con la anterior en GO y con una orden propia. **R** = requiere recreate (rolling por réplica, con drain); **S** = sin interrupción. **Rev** = reversible; **Irrev** = irreversible.

| Fase | Paso | Tipo | Reversibilidad |
|---|---|---|---|
| F0 | Gate jurídico y operativo O1, O5–O8 | — | — |
| F1 | Release de desbloqueo, desplegada **sin flags** | R (rolling) | Rev (imagen) |
| F2 | Clave de sujeto y registro de exclusiones | S (host) + R (montaje) | Clave: Rev hasta su primer uso, Irrev después. Registro: Rev mientras esté vacío |
| F3 | Encendido de G4 sin XP, con corte fijado | R | Rev (flags) |
| F4 | Instalación de las reglas aprobadas | S | Irrev (append-only) |
| F5 | Encendido de XP | R | Rev (flag) |
| F6 | Publicación de las experiencias elegibles | S | Irrev en sus efectos (se lista a todos) |
| F7 | Comprobaciones de reconocimiento y progreso | S | — |
| F8 | Observación y primer respaldo con la base | S | — |

### F0 — Verificaciones previas y respaldo

1. Comprobar J1–J8 y O1, O5–O8 con su evidencia. Si falta alguna, **STOP**.
2. Preflight del runbook (`deployment_guide.md`): contenedores, override, montajes, disco y edge.
3. Huellas de stores (`fp.sh` del despliegue inerte) y confirmación del último respaldo correcto.
4. Preparar el rollback: tags `rollback-pre-<unidad>` y copia del override.

### F1 — Release mínima para desbloquear `mook_review` (unidad técnica propia)

1. Commit con un único cambio funcional: quitar `'mook_review'` de `XP_LOCKED_SOURCES` (`policy.mjs:36`). `PM_LOCKED_SOURCES` no se toca, y `reading_completion` y `offline_validation` siguen bloqueadas.
2. Actualizar **solo** los cinco tests que fijan el bloqueo (§1, fila 2) para que fijen el nuevo estado: `mook_review` libre para XP, todavía bloqueada para PM.
3. CI 3/3, Trivy, integridad y laboratorio con XP activo (30/20/50, k ≥ 5, dos reconciliadores) **con la constante real**, sin el arnés de pruebas.
4. Despliegue rolling, **sin flags**.
   - Gate: las seis condiciones de §0 siguen sin cumplirse, salvo la 2.
   - `readMyProgress` → 404.

*Reinicio:* sí, rolling. *Rollback:* imagen anterior (`v8inert-0665c16`), sin datos.

### F2 — Custodia: clave y registro

**Clave (S):**
1. Generarla en el host con un generador criptográfico, sin pasar el valor por argv ni por el historial (stdin o dentro del proceso).
2. Escribirla en `/var/www/chibalete/secrets/gamification_subject_key`, propietario root:root (el proceso de la API corre como root) y modo `0400`.
3. Copia segura al custodio (P3) **antes** del recreate de F3.
4. **Evidencia:** existencia, modo, longitud ≥ 32 y SHA-256 del archivo guardado por el custodio. Nunca el valor.

**Registro (S):**
1. Crear un directorio propio en el host fuera de `data/` y `data-critical/` (por ejemplo `/var/www/chibalete/gamification-registry/`) con un archivo vacío.
2. Configurar el destino de la copia separada (P2).

**Montaje (R, se aplica en F3):** añadir en el override, en las **dos** réplicas, el volumen rw del registro y `GAMIFICATION_EXCLUSION_REGISTRY=<ruta en el contenedor>`.

*Reversibilidad:* mientras no haya hechos ni exclusiones, la clave y el registro pueden retirarse. Desde el primer hecho o exclusión, la clave **no** se puede cambiar.

### F3 — Encender G4 sin XP, con el corte fijado (R)

1. Override de las dos réplicas:
   - `GAMIFICATION_ENABLED=1` y `GAMIFICATION_MOOK_SINCE=<T0 ISO 8601>`.
   - El montaje y la variable del registro.
   - `XP_EARNING_ENABLED` y `PM_EARNING_ENABLED` **sin definir**.
2. T0 debe ser anterior a la publicación de F6 y posterior a la entrega de avisos (J3).
3. Rolling por réplica: drain, recreate, gate en un paso propio, rejoin. Primero `api_1`; `api_2` solo con `api_1` en GREEN.

**Gate por réplica:**
- Arranque sin `SUBJECT_KEY_UNAVAILABLE` ni `EXCLUSION_REGISTRY_*` en el log.
- `readMyProgress` → `{enabled:false}`, así que el front no muestra el enlace.
- El primer barrido (unos 60 s) crea `data-critical/gamification.db` con WAL y no registra hechos, porque no hay entregas posteriores a T0.
- 0 5xx.

Durante el rolling, una réplica responde 404 y la otra `{enabled:false}`. No hay emisión posible: XP sigue apagado y no hay experiencia publicada.

### F4 — Instalar las reglas aprobadas (S)

1. Ejecutar **dentro de `api_1`**, con un proceso puntual de node, `createRuleSet(getGamificationDb(), { ruleVersion, createdBy, effectiveFrom, rules })` con los valores literales del acta (O1):
   - `rules = { schema: 1, facts: {}, caps: { pmPerDay: <acta>, pmPerWeek: <acta> }, recognition: <bloque A7-A12-V3 §1 con approvalRef del acta> }`.
   - `effectiveFrom` ≥ ahora y ≤ la publicación de F6.
2. **Evidencia:**
   - `getActiveRuleSet` devuelve el `ruleVersion` del acta.
   - El `rules_sha256` de `gm_rule_sets` queda anotado junto al SHA del acta.
   - Una repetición devuelve `created:false`, que demuestra la idempotencia.
3. **STOP** ante `INVALID_RULES`, `RECOGNITION_RULE_CONFLICT`, `RETROACTIVE_RULES` o `IDEMPOTENCY_CONFLICT`. No se corrige a mano: se vuelve al acta.

*Irreversible:* el conjunto queda registrado. Solo puede sustituirlo una versión posterior, con un acta nueva (D48).

### F5 — Encender XP (R)

1. Añadir `XP_EARNING_ENABLED=1` en las dos réplicas. `PM_EARNING_ENABLED` sigue sin definir.
2. Rolling igual que en F3.

**Gate por réplica:**
- `readMyProgress` del operador → contrato completo con 0 XP.
- Aula Viva: el agregado aparece como no disponible o con conteo nulo por debajo de k = 5.
- Sin hechos nuevos en el ledger.
- 0 5xx.

Desde aquí, **todos** los lectores ven «Mi progreso» en su perfil (§1, fila 1b).

### F6 — Publicar las experiencias elegibles (S)

1. Publicar desde Studio (`POST /api/experiences/versions/:vid/publish`, solo administración) **después** de T0 y de F5.
2. **Evidencia:** `publishedAt` > T0, con la versión y la obra declarada correctas.

### F7 — Comprobaciones de reconocimiento y progreso (S)

1. Primera aprobación real de un mediador:
   - Hecho en el ledger en segundos (gancho).
   - 30 XP por la primera evidencia y 20 por la segunda de la misma obra, con un techo de 50.
   - El lector ve su historial.
2. Siguiente barrido del reconciliador: 0 hechos nuevos para lo ya reconocido. Es la prueba de idempotencia.
3. Aula Viva: sin conteo por debajo de 5 lectores.
4. Logs: 0 `NO_ACTIVE_RULES`, `SUBJECT_KEY_UNAVAILABLE` y `EXCLUSION_REGISTRY_*`.

**STOP** si aparece XP para una fuente distinta de `mook_review`/`mook_experience`, PM distinto de 0 o un total incoherente con el historial.

### F8 — Observación y respaldo (S)

1. El siguiente `structured-backup` registra `gamification.db` como presente.
2. Copia del registro a su destino separado.
3. Observación de 24 h con las alarmas D41.

## 4. Condiciones de STOP

Se detiene la fase y no se avanza si ocurre cualquiera de estas cosas:

1. Falta una decisión o evidencia de §2.
2. **Legal exige autorización previa (J2).**
3. Un log muestra `SUBJECT_KEY_UNAVAILABLE`, `EXCLUSION_REGISTRY_UNAVAILABLE`, `EXCLUSION_REGISTRY_STALE`, `EXCLUSION_REGISTRY_NOT_INDEPENDENT`, `NO_ACTIVE_RULES` o `GAMIFICATION_DB_UNAVAILABLE`.
4. Las réplicas difieren en imagen o entorno más allá de lo previsto (`ARCHIVE_ROTATION_ENABLED` solo en `api_1`).
5. Hay un 5xx nuevo, un reinicio inesperado o un error de nivel 50+.
6. XP fuera de 30/20/50, PM distinto de 0 o una concesión anterior a T0.
7. La experiencia se publicó antes de T0.
8. Se necesitaría generar una clave nueva cuando ya existen hechos o exclusiones (P3: prohibido rotar).
9. Hay diferencias en los stores ajenas a la gamificación.

## 5. Suspensión de XP y rollback

**Ninguna vía borra datos.** El ledger, el registro y la clave se conservan.

| Nivel | Acción | Tipo | Efecto |
|---|---|---|---|
| S0 | Archivar la experiencia en Studio (`POST /api/experiences/:id/archive`) | S | Frena la entrada de recorridos nuevos. Las entregas pendientes **pueden seguir aprobándose y concediendo XP**. Hay que verificar en laboratorio el efecto exacto sobre los recorridos abiertos antes de usarla como freno |
| S1 | Quitar `XP_EARNING_ENABLED` en las dos réplicas | R | Se detienen todas las concesiones nuevas. «Mi progreso» → `{enabled:false}` y el enlace desaparece. G4 sigue encendido |
| S2 | Quitar también `GAMIFICATION_ENABLED` | R | `/api/me/progress` → 404, sin reconciliador ni ganchos |
| S3 | Rollback de imagen a la release anterior al desbloqueo (`v8inert-0665c16`) | R | `mook_review` vuelve a estar bloqueado por código, aunque las flags sigan definidas |

**Advertencia al reanudar:** el reconciliador reconoce todas las aprobaciones posteriores a `GAMIFICATION_MOOK_SINCE`. Si se suspende y luego se reanuda con el mismo corte, **concederá XP por lo aprobado durante la pausa**. Para evitarlo, reanudar con un corte nuevo, que es una decisión de Dirección y Legal.

El rollback de imágenes sigue el procedimiento validado:
1. Restaurar la copia del override, o cambiar las líneas de imagen.
2. Por cada réplica: drain, recreate, gate y rejoin.
3. El front, en su propia ventana.

Nunca se restauran datos en un rollback de código. Restaurar `gamification.db` es una decisión aparte, con reaplicación de exclusiones (`replayExclusions`) y contraste con el registro de solicitudes (PRIV-C7 §5.6).

## 6. Hallazgos de la validación

| # | Hallazgo | Consecuencia |
|---|---|---|
| H1 | El acta A7-A12-V3 fija `recognition`, pero no los `caps` (`pmPerDay`, `pmPerWeek`), que son **obligatorios** en `createRuleSet`. Las pruebas usan `0/0`, coherente con «PM = 0», pero eso es una inferencia | El acta (O1) debe fijarlos de forma explícita. No se rellenan en ingeniería |
| H2 | No existe ningún mecanismo de instalación de reglas aparte de la función de librería | F4 se ejecuta con un proceso puntual dentro del contenedor. No hace falta crear un script |
| H3 | La clave se lee una sola vez al arrancar el reconciliador | Debe existir antes del recreate de F3. Añadirla después exige otro recreate |
| H4 | El registro ausente bloquea toda ingesta, y un archivo vacío es válido | El archivo vacío debe crearse antes de F3 |
| H5 | Con XP activo, el enlace a «Mi progreso» aparece en el perfil de **todos** los lectores | Debe constar en el aviso y en la comunicación a los mediadores (J3) |
| H6 | Si la base no está viva, «Mi progreso» responde 503 | F3 crea la base antes de F5, de modo que esa ventana nunca es visible |
| H7 | La reanudación tras una suspensión es retroactiva hasta el corte | §5. Decisión humana al reanudar |
| H8 | La activación es general: puede ganar XP cualquier lector con acceso explícito a una obra con PRODUCTION publicada y una aprobación de un mediador de sus grupos | Los avisos deben llegar a todas las familias de esos grupos (J3), no a una cohorte |

## 7. Pendientes que requieren aprobación humana

1. **Legal:** J1, J2 (D1), J5 (L1, L2) y J6 (D6, D8).
2. **Legal y Dirección:** J3 (contenido y cobertura), J5 (D4, D5, L3) y J6 (D2).
3. **Dirección:**
   - J4 (D3, D9, L5, custodios de P2, P3 y P4).
   - J7 (riesgo T3) y J8 (orden de activación).
   - El acta de reglas O1: `approvalRef`, `ruleVersion`, entrada en vigor y `caps`.
   - El valor de T0.
   - La decisión sobre el corte si alguna vez se reanuda tras una suspensión.
4. **Pedagogía:** criterio de `minPalabras` y revisión disponible en las cohortes (A7-A12-V3 §4.7).
5. **Operación:** alarmas D41 (O8).

## 8. Próximas unidades (cada una con su orden)

| Unidad | Alcance | Condición |
|---|---|---|
| **V8-ACTIVATE-PREP-01** | F1, la release de desbloqueo con laboratorio, desplegada sin flags. F2 queda preparada pero no se ejecuta sin los custodios | J1–J8 en GO, o al menos una orden expresa de Dirección para preparar la release sin activar |
| **V8-ACTIVATE-01** | F2 a F8 | Todo §2 en GO y la orden de activación (J8) |

Si J2 = autorización previa, ninguna de las dos aplica. Haría falta primero una unidad de diseño del mecanismo de autorización (equivalente a la B1 descartada), con decisión de producto propia.
