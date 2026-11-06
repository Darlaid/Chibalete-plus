# PRIV-6 — Paquete para revisión jurídica del reconocimiento XP con menores

**Fecha:** 2026-11-06. **Estado:** `PRIV6_READY_FOR_REVIEW`. **No es una aprobación de PRIV-6 ni una declaración de cumplimiento jurídico.**

**Alcance:** el primer piloto: experiencia `exp-1793925477270-j1onug`, versión borrador `expv-1793925477472-portnp`, obra `content-1775766806680`, cohorte de un grupo «Grado 005».

**Base:** código de `f11fecd` (producción: `chibalete/api:ratelimit-f11fecd` ×2; front `uxfix-b18f6f0`). Gamificación sin flags, sin `gamification.db` y sin clave de sujeto; `mook_review` en `XP_LOCKED_SOURCES`.

**Método:** solo código y documentación del repositorio. No se leyeron datos de estudiantes.

**Construye sobre** estos documentos y no los repite:
- [Evidencia de privacidad G4 V1](GAMIFICACION_G4_EVIDENCIA_PRIVACIDAD_V1.md): del 2026-10-30, anterior a PRIV-01B…01E. Este documento actualiza su §2.
- [Modelo PRIV-01](GAMIFICACION_PRIV_01_MODELO_V1.md) y su [implementación](GAMIFICACION_PRIV_01_IMPLEMENTACION_V1.md).
- [PRIV-01D supresión](GAMIFICACION_PRIV_01D_SUPRESION.md).
- [Ficha del piloto 03A](GAMIFICACION_G4_PILOT_03A_FICHA.md).
- `docs/ops/CHP_PRIVACY_SECURITY_AI_EVIDENCE_01A.md` (COMP-01…09).
- `docs/ops/CHP_MOOK_EVENTS_EVIDENCE_RETENTION_POLICY_01.md`.
- `docs/ops/CHP_LEO_MINOR_PRIVACY_NOTICE_01A.md`.

**Propuesta de aviso:** [GAMIFICACION_PRIV_06_AVISO_PROPUESTA_V1.md](GAMIFICACION_PRIV_06_AVISO_PROPUESTA_V1.md).

---

## 1. Tratamiento identificado

«Implementado» = existe en el código desplegado, aunque esté inerte. «Previsto» = solo en documentos o decisiones.

| # | Pregunta | Respuesta | Estado | Evidencia |
|---|---|---|---|---|
| 1 | Qué datos personales trata MOOK **hoy** (sin XP) | Por lector: recorridos (`userId`, estado por nodo y fechas); entregas con el **texto** de cada producción y todas sus versiones; respuestas de las actividades; decisión, comentario y revisor; un snapshot del acceso a la obra (`workAccess`) | Implementado, en uso | `experienceStore.js` `startRun` y `submitEvidence` (`payload.text`/`answers`, `versions[]`, `workAccess`) |
| 2 | Qué datos **añade** XP | Por evidencia aprobada después del corte: un hecho con fuente, tipo, decisión, día de ocurrencia y de registro, versión de regla y `features_json` **vacío**. Además: entradas de XP, el ciclo por obra (`work_key`, ciclo, acto, xp) y logros. Nada de texto, respuestas, modo de lectura ni tiempos | Implementado e inerte | `ledger.mjs` `FEATURE_ALLOWLIST.mook_review = []` (línea 46) y `dayStart(occurredAt)`; migraciones `0001`–`0003` |
| 3 | Seudonimización del lector | Sujeto **aleatorio** (`subject_ref`), no derivado de `user_id`. La única tabla con `user_id` es `gm_subjects`, que es borrable. La clave de la obra (`work_key`) y la de idempotencia son HMAC por sujeto con una clave de servidor. El mediador entra igual (`actor_ref`). Es **seudonimización, no anonimización** | Implementado; **la clave no existe en producción** | `0002_subject_model.sql`; `subjects.mjs`; `subjectKey.mjs` (`/app/secrets/gamification_subject_key`, sin valor por defecto) |
| 4 | Qué conserva el ledger | Tablas `gm_` append-only con triggers que impiden `UPDATE`/`DELETE`. Solo `gm_subjects` es mutable. Nada caduca | Implementado | `0001_ledger.sql`, `0003_work_cycle_acts.sql` |
| 5a | Qué ve el lector | `GET /api/me/progress`: el sujeto es **siempre la sesión**. Muestra XP total, nivel (`semilla`/`brote`), logros, y por obra: título, estado, XP y techo. Sin rankings ni rachas. Sin flags responde 404 | Implementado (404 hoy) | `server.js:2670`; `progress.mjs` `readWorkProgress`; `pages/MiProgreso.tsx:11` |
| 5b | Qué ve el mediador | Las entregas para revisar, **como hoy** (texto incluido). En Aula Viva solo `studentsWithRecognizedWork`, suprimido con **menos de 5** (`GROUP_MIN_SIZE`). Sin nombres, XP, niveles ni exclusiones. Aviso «No es una calificación» al revisar | Implementado | `progress.mjs:333-355`; `server.js` `groupRecognitionBlock`; `GroupRecognitionBlock.tsx:7`; `ProduccionesTab.tsx:317` |
| 5c | Qué ve la administración | **No hay pantalla** de XP por persona. El acceso al ledger es técnico (servidor) | Implementado (ausencia) | Sin rutas `gamification` aparte de las dos anteriores en `server.js` |
| 6 | Exclusiones | `excludeUser` genera un tombstone HMAC sin id y lo escribe primero en el **registro independiente**, fuera de copias. Después, en una transacción, anota `gm_erasures`, extingue el saldo de PM y borra la fila de `gm_subjects`. La puerta `exclusionGate` bloquea toda ingesta si el registro falta, está alterado o desalineado. Una persona excluida no recibe hechos nuevos, ni como lectora ni como revisora (`rejected_excluded_user`, sin fila), y su vista muestra cero | Implementado; **sin llamador de producto ni procedimiento**; registro **sin configurar** (`GAMIFICATION_EXCLUSION_REGISTRY`) | `erasure.mjs`; `exclusions.mjs`; `ledger.mjs` (bloque `recordFact`); `progress.mjs:89` |
| 7a | Revocación del acceso a la obra | El acceso se congela en la primera entrega (`workAccess`). Solo cuenta un acceso explícito (`SCOPE_TITLE`, `SCOPE_COLLECTION`, `GROUP_CATALOG`, `GROUP_ALL`). Lo ya reconocido no se revierte; una obra **retirada legalmente** deja de reconocerse | Implementado | `progress.mjs:185` `workAccessCounts`; `mookSource.mjs` `readRights` |
| 7b | Solicitud de eliminación o retiro | Ruta técnica: `excludeUser`. **No hay interfaz ni script.** Se ejecutaría a mano en el contenedor | Implementado parcialmente | `erasure.mjs:41`; sin llamadores (`grep excludeUser`) |
| 7c | Baja de la cuenta | `DELETE /api/users/:id` **no** llama a la exclusión: la fila de `gm_subjects` seguiría vinculada (COMP-08) | Brecha previa | `CHP_PRIVACY_SECURITY_AI_EVIDENCE_01A` COMP-08 |
| 7d | Rectificación | El esquema admite anulaciones (`kind='void'`) y las lecturas las respetan. **Ninguna función las escribe** | Solo esquema | `0001_ledger.sql` `gm_xp_entries`; `ledger.mjs:465` |
| 8 | Respaldos | `gamification.db` está en `structured-backup` como store opcional. El registro de exclusiones está **fuera** de las copias a propósito: tras restaurar, `replayExclusions` reaplica las exclusiones antes de cualquier ingesta. **`forget`/`prune` están prohibidos por construcción**: todo snapshot se conserva indefinidamente (COMP-07) | Implementado | `stores.py:93`; `mookSource.mjs:367`; `restic.py:4,56-82` |
| — | Textos MOOK | Política aprobada: relación + 12 meses. **No ejecutada:** no hay vía de borrado y las versiones son perpetuas | Brecha previa, no creada por XP | `RETENTION_POLICY_01` §5.2 y su tabla de estado |

**Lo que XP no hace:**
- No condiciona el acceso.
- No califica.
- No genera canjes: PM está bloqueado por código en `mook_review`, `mook_experience`, `mission`, `reading_completion` y `offline_validation` (`policy.mjs` `PM_LOCKED_SOURCES`).
- No persiste ritmo, tiempo ni modo de lectura: `reading_completion` está bloqueada y su `verdict` solo existiría si se desbloquea.
- No expone datos individuales al mediador.

## 2. Controles ya implementados

1. **Minimización:** ningún texto ni respuesta en el ledger; `features` vacío para MOOK; fechas a nivel de día; sin modo de lectura.
2. **Seudonimización por indirección:** el vínculo se puede borrar y las claves derivadas no se recalculan sin la sal del sujeto ni la clave de servidor.
3. **Fallo cerrado:** sin clave, sin registro de exclusiones o con un registro alterado, no se registra nada y la vista responde «no disponible», nunca 0 XP.
4. **Exclusión que sobrevive a una restauración:** el registro está fuera de las copias y se reaplica antes de la ingesta.
5. **Sin retroactividad:** nada anterior a `GAMIFICATION_MOOK_SINCE` cuenta.
6. **Revisión humana obligatoria:** solo «aprobado» suma; la autorrevisión se rechaza; se excluyen las cuentas inactivas y sintéticas.
7. **Agregados con umbral:** el mediador ve recuentos con un mínimo de 5 y sin rankings.
8. **Retirada legal de obras:** bloquea el reconocimiento.

## 3. Lo que el aviso no puede prometer hoy

- **Que una eliminación alcance las copias de seguridad** (COMP-07: `forget`/`prune` no se ejecutan).
- **Un plazo de conservación del ledger:** no hay ninguno decidido y el ledger no caduca.
- **Que el retiro se atienda por una vía formal:** no existe procedimiento operativo ni canal formal de derechos.
- **Que la baja de la cuenta desvincule el reconocimiento** (COMP-08).
- **La rectificación** de un XP mal concedido: no implementada.

## 4. Matriz de requisitos

Clase: **OBL** = obligatorio antes de activar XP · **OK** = satisfecho · **DIF** = diferible sin comprometer la privacidad del piloto.

| # | Requisito | Estado real | Evidencia | Pendiente | Responsable | Clase |
|---|---|---|---|---|---|---|
| R1 | Aviso aprobado para lectores, familias y mediadores | Propuesta redactada | Aviso V1 | Texto final y marcas [LEGAL] | Legal + Dirección | **OBL** |
| R2 | Base del tratamiento de datos de menores y forma de autorización u oposición del representante | No definida | Doctrina D35; Evidencia G4 §2 | Decisión jurídica (§5, D1) | Legal | **OBL** |
| R3 | Papel del colegio (responsable, corresponsable o encargado) y convenio | No documentado en el repositorio | — | Decisión y documento (§5, D2) | Legal + Dirección | **OBL** |
| R4 | Canal formal de derechos y verificación de representación | Solo buzón público, no validado | `CHP_LEO_MINOR_PRIVACY_NOTICE_01A` §1 | Definir canal y verificación (§5, D3) | Dirección + Legal | **OBL** |
| R5 | Retiro y oposición ejecutables | Función implementada; registro y clave sin configurar; **sin procedimiento** | `erasure.mjs`, `exclusions.mjs` | Runbook de operador con la función existente, probado en laboratorio, sin código nuevo (checklist C-7) | Ops | **OBL** |
| R6 | Desvinculación ante la baja de cuenta | Brecha COMP-08 | §1, 7c | Durante el piloto: el runbook de R5 se ejecuta también en cada baja de un participante (C-8). La cascada automática queda diferida | Ops (piloto) / Backend (cascada) | **OBL** (procedimiento) / DIF (código) |
| R7 | Plazo de conservación del ledger y qué se comunica sobre las copias | Sin plazo; copias indefinidas | §1, 4 y 8; COMP-07 | Decidir plazo o declarar que no lo hay; aceptar o ejecutar la retención de copias (§5, D4 y D5) | Legal + Dirección (+ Ops si se ejecuta) | **OBL** (decisión) |
| R8 | Valoración de impacto (DPIA, N2) | No existe como documento aprobado | Evidencia G4 §2 y §9 | Legal decide si este paquete y la Evidencia G4 bastan como DPIA del piloto o exige otra (§5, D6) | Legal | **OBL** |
| R9 | Canal y momento de entrega del aviso | Sin superficie en la app | §2 del aviso | Decisión (§5, D7). Si va dentro de la app, requiere una unidad de frontend propia | Dirección | **OBL** (entrega) / DIF (en la app) |
| R10 | Seudonimización del sujeto | Indirección aleatoria y HMAC | §1, 3 | Crear la clave (fuera de PRIV-6) | — | **OK** (diseño) |
| R11 | Minimización de los hechos | `features` vacío, día, sin modo | §1, 2 | — | — | **OK** |
| R12 | Visibilidad del mediador agregada (k ≥ 5) | Implementada | §1, 5b | — | — | **OK** |
| R13 | XP no califica ni condiciona; revisión humana | Implementado | §1, 5b; §2 | Decirlo en el aviso (ya está) | — | **OK** |
| R14 | Exclusión resistente a una restauración | Implementada | §1, 6 y 8 | Configurar el registro (C-6) | Ops | **OK** (diseño) |
| R15 | Acceso del titular a su información | Vista propia en la app; sin exportación formal | §1, 5a | Exportación bajo solicitud por operador, si Legal la exige | Ops | **DIF** |
| R16 | Rectificación de un XP | Solo esquema | §1, 7d | Unidad propia si Legal la exige antes de activar | Backend | **DIF**, salvo que Legal diga otra cosa |
| R17 | Retención de textos MOOK (relación + 12 meses) | Aprobada, no ejecutada | COMP-07; política §5.2 | No depende de XP: existe hoy sin gamificación | Dirección + Ops | **DIF** para XP (brecha previa) |
| R18 | Fin de la relación escolar como disparador de plazos | No existe la fecha | Evidencia G4 §4.5 | Definición funcional | Producto + Legal | **DIF** |

No se añaden controles nuevos por precaución. R5 y R6 usan funciones existentes; R9 en la app y R16 quedan diferidos.

## 5. Decisiones pendientes

**Para Legal:**
- **D1.** Base del tratamiento para menores: ¿autorización previa del representante (*opt-in*) o información con oposición (*opt-out*)?
  - Hoy, con las flags activas, todo lector con acceso explícito participaría por defecto.
  - Si se exige *opt-in*, el piloto necesita una lista de autorizados y el resto se excluye antes de activar con R5. Es operativo y no requiere código.
- **D6.** ¿Este paquete, junto con la Evidencia G4 V1, constituye la DPIA del piloto, o se exige otro documento?
- **D8.** Redacción de los derechos (§8 del aviso B) y plazos de respuesta.

**Para Legal y Dirección:**
- **D2.** Papel del colegio de la cohorte «Grado 005» y el instrumento que lo documenta.
- **D3.** Canal formal de solicitudes (¿el buzón `contacto@chibaleteeditores.com` o uno nuevo?) y cómo se verifica que quien escribe representa al menor (¿vía colegio?).
- **D4.** Plazo de conservación del ledger, o declaración expresa de que no lo hay durante el piloto.
- **D5.** Copias de seguridad. Elegir una:
  - (a) Activar sabiendo que no se depuran y decirlo en el aviso.
  - (b) Ejecutar antes la retención aprobada (7/4/6), en una unidad de Ops propia.

**Para Dirección:**
- **D7.** Canal y momento de entrega del aviso: impreso o por correo vía colegio antes de activar (sin código), o dentro de la app (unidad de frontend).
- **D9.** Responsable operativo de ejecutar retiros y bajas (R5 y R6), y el plazo interno de atención.

## 6. Checklist de aprobación y activación

**Aprobación (sin tocar producción):**
- [ ] C-1 Legal resuelve D1, D2, D6 y D8.
- [ ] C-2 Dirección y Legal resuelven D3, D4, D5, D7 y D9.
- [ ] C-3 Aviso B completado sin marcas [LEGAL]/[DIRECCIÓN] y aprobado por escrito (autoridad y fecha, como en COMP-05).
- [ ] C-4 Partes A y C revisadas por Dirección. Se eliminan las marcas [PENDIENTE] que dejen de aplicar.

**Preparación técnica (cada paso con su propia orden):**
- [ ] C-5 Clave de sujeto creada como secreto de archivo (custodia y respaldo separado).
- [ ] C-6 Registro de exclusiones configurado (`GAMIFICATION_EXCLUSION_REGISTRY`) fuera del directorio de la base y fuera de las copias.
- [ ] C-7 Runbook de retiro con `excludeUser`, probado en laboratorio con datos sintéticos: acuse sin datos personales, vista a cero y revisión pedagógica intacta.
- [ ] C-8 Runbook de baja: cada baja de un participante del piloto ejecuta C-7.
- [ ] C-9 Si D1 = *opt-in*: excluir con C-7 a quienes no autoricen, **antes** de fijar el corte.
- [ ] C-10 Si D5 = (b): retención de copias ejecutada y verificada.

**Comunicación:**
- [ ] C-11 Aviso B entregado a las familias por el canal de D7, y aviso C a los mediadores, antes de activar.

**Activación (fuera de PRIV-6, ver ficha 03A §6):**
- [ ] C-12 Desbloquear `mook_review`, aprobar el conjunto de reglas, fijar `GAMIFICATION_MOOK_SINCE` y, **después**, publicar la versión.

## 7. Validación del aviso frente al sistema

| Afirmación del aviso | Comportamiento real | Estado |
|---|---|---|
| Puntos solo con la aprobación del mediador | `mookApprovedReviewCandidates` filtra «aprobado» | ✅ |
| «No son una nota» / no cambian el acceso | Ningún consumidor de XP fuera de `/me/progress` y del recuento de grupo | ✅ |
| Se guarda la aprobación, la fecha y el libro; el texto no se copia | `FEATURE_ALLOWLIST.mook_review = []`; `work_key`; `dayStart` | ✅ |
| Fechas solo con el día | `dayStart(occurredAt)` | ✅ |
| El texto sigue en la experiencia | `submitEvidence` guarda `payload.text` en MOOK | ✅ |
| Solo el lector ve sus puntos | `/me/progress` usa siempre la sesión | ✅ |
| El mediador ve recuentos con un mínimo de 5, sin nombres ni puntos | `readGroupRecognitionCounts`, `GROUP_MIN_SIZE = 5` | ✅ |
| Sin rankings ni comparaciones | `MiProgreso.tsx`, `GroupRecognitionBlock.tsx` | ✅ |
| Sin pantalla administrativa de puntos | Sin rutas | ✅ |
| Código aleatorio en lugar del identificador | `ensureSubject`: `randomBytes` | ✅ (con clave instalada) |
| Clave de obra distinta por lector | `deriveWorkKey` | ✅ |
| Seudonimizado, no anónimo | Lo dice el código (`subjects.mjs`) | ✅ |
| El retiro borra la relación y la vista queda a cero | `excludeUser`, `readProgressStats` | ✅ función / ⏳ procedimiento (C-7) |
| Tras el retiro, lectura y revisión siguen igual | La exclusión solo afecta a `gm_`; MOOK no la consulta | ✅ |
| «Pueden decirlo cuando quieran» | Sin canal ni procedimiento | ⏳ [PENDIENTE] (D3, C-7) |
| Las copias no se depuran | `restic.py`: `forget`/`prune` prohibidos | ✅ (declarado como límite) |
| La baja de la cuenta no retira por sí sola | COMP-08 | ✅ (declarado) / ⏳ C-8 |
| Ninguna sanción automática; no puedes aprobar tu propia entrega | `rejected_self_review` | ✅ |
| Valores 10 / 20 / 50 | Ficha 03A; reglas sin aprobar ni cargar | ⏳ [PENDIENTE] |
| Sin premios ni canjes | `PM_LOCKED_SOURCES` cubre todas las fuentes: sin PM no hay canje | ✅ |
| No hay XP por terminar la ruta ni por la actividad de comprensión | La actividad no es fuente. `mook_experience` **no** está bloqueada para XP: su valor 0 depende de las reglas aprobadas (`XP_RUTA = 0`, ficha 03A §4) | ⏳ (reglas, C-12) |

**Resultado:** ninguna afirmación contradice el código. Lo que aún no ocurre está marcado [PENDIENTE] o [LEGAL]/[DIRECCIÓN].
