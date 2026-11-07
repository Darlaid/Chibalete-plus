# V8 — Cierre operativo del gate de activación

**Fecha:** 2026-11-07. **Unidad:** V8-GATE-CLOSE-02. **Veredicto:** `YELLOW`. Lo operativo y técnico está cerrado y probado. La activación (F2–F8) depende de condiciones jurídicas **no verificadas** (§4) y de la orden de activación (J8).

**Este documento no activa nada, no aprueba PRIV-6 ni el aviso, no elige una base jurídica y no valora la validez del tratamiento.** Sustituye la matriz de [V8-ACTIVATION-GATE-01](GAMIFICACION_V8_ACTIVATION_GATE_01.md) §5. El procedimiento F0–F8 sigue siendo el de [activación operativa](GAMIFICACION_V8_ACTIVACION_OPERATIVA_V1.md); no se reescribe.

## 0. Estado verificado (2026-11-07, ~15:45Z)

| Elemento | Estado |
|---|---|
| Rama | `origin/chp/epub-mainfile-r1-release` = `83fdcd2` (publicado en esta unidad tras ratchet y verificación del acta) |
| Producción | API `unifiedxp-13b8045` ×2 (`c3361ee0…`) y front (`26a0a3f4…`), healthy, RestartCount 0 |
| Gamificación | 0 variables de flags, 0 archivos de gamificación, sin clave, sin registro, sin base |
| MOOK | «La tortuga…» en borrador, 0 recorridos, 0 entregas (`fp.sh`, `/root/chp-unifiedxp/stores-gate02.txt`) |

## 1. Decisiones de Dirección cerradas

| Decisión | Efecto en el gate | Registro |
|---|---|---|
| Gamificación **general**, no piloto restringido | Cierra N1. Las flags globales son el modelo de producto; **B1 no es requisito de producto** | Esta unidad; procedimiento V8 (encabezado) |
| XP como única escala acumulable; PM eliminado | — | V8-UNIFIED-XP-01, en producción |
| Reglas O1 con `approvalRef` | Cierra O1 | [Acta `DIR-XP-O1-20261107`](aprobaciones/APROBACION-DIR-XP-O1-20261107.md), `verificar_o1.mjs` 40/0 |
| Mediadores: progreso individual de los estudiantes de sus grupos | Producto cerrado; su información a las familias sigue en §4 | V8-UNIFIED-XP-01, desplegado inerte |
| **Administración** gestiona las solicitudes de derechos y de exclusión | Cierra D9 (responsable operativo) | Esta unidad |
| **Dirección** custodia la clave de sujeto, el registro de exclusiones y sus copias | Cierra L5 y los custodios de P2, P3 y P4 | Esta unidad |
| Sin mínimo universal de palabras: cada actividad define sus requisitos | Cierra el criterio pedagógico de A7-A12-V3 §4.7 | Esta unidad (la ficha 03A ya fija 40–150 y 30–120) |
| Sin autoservicio de retiro ni interfaces nuevas | El retiro lo ejecuta Administración con el runbook PRIV-C7 §5 | Esta unidad |

**Mecanismos de exclusión y protección que se conservan:** retiro e irreversibilidad (PRIV-C7), registro de exclusiones con MAC y reaplicación tras restaurar, fallo cerrado sin clave o sin registro, seudonimización, agregados con k ≥ 5, 404 idéntico fuera de la cohorte del mediador.

## 2. Condiciones técnicas y operativas satisfechas

| # | Condición | Estado | Evidencia |
|---|---|---|---|
| O1 | Acta de reglas | GREEN | Acta versionada, bloque literal, SHA `95613ec3…9878`, 40/0 |
| O2 | Release | GREEN | `unifiedxp-13b8045` en producción; CI 3/3; Trivy 0; laboratorio 44/0 (`on`, `hist`), 34/0 (`off`), 35/0 (inerte) |
| O5 | Respaldo | GREEN (re-verificar en F0) | `structured-backup` 2026-11-07 12:01Z `result=ok` |
| O6 | Producción sana | GREEN (re-verificar en F0) | Ver §0 |
| O7 | Contenido elegible | GREEN (re-verificar en F0) | Una experiencia, en borrador, sin recorridos |
| O8 | Monitoreo y alarmas D41 | **GREEN** | §6; comprobador `ops/gamification/o8-check.mjs`, laboratorio 24/0 |
| — | Criterio pedagógico de palabras | GREEN | Decisión de Dirección (§1) |
| O3 | Clave de sujeto | Preparada, **se crea en F2** | Custodio: Dirección. No se crea en esta unidad |
| O4 | Registro de exclusiones | Preparado, **se crea en F2** | Custodio: Dirección; copia separada (P2) |

## 3. Documentación: lo comprobado y lo que falta contrastar

| Clase | Documento | Situación |
|---|---|---|
| 1. Comprobado y vigente | Aviso de Leo para menores (COMP-05), texto aprobado por Dirección | Publicado: está en el bundle productivo (`registra señales generales`, `Consultas sobre privacidad`) |
| 1. Comprobado y vigente | Política de retención de eventos MOOK (`docs/ops/CHP_MOOK_EVENTS_EVIDENCE_RETENTION_POLICY_01.md`) | Aprobada como decisión ejecutiva; no ejecutada |
| 1. Comprobado y vigente | Acta O1; runbook de retiro PRIV-C7 §5 | Versionados; el runbook, probado 60/60 en laboratorio |
| 2. No está en el repositorio; existencia externa **no verificada** | Política de privacidad o de tratamiento de datos de Chibalete+ / Chibalete Editores | Ausencia de evidencia en el repositorio, no prueba de inexistencia |
| 2. Ídem | Términos y condiciones de la plataforma y de las suscripciones | Ídem |
| 2. Ídem | Contratos o convenios con colegios (papel de cada parte en el tratamiento) | Ídem; PRIV-6 R3 lo registra como «no documentado» |
| 2. Ídem | Comunicaciones o autorizaciones de familias gestionadas por los colegios | Ídem |
| 2. Ídem | Cualquier evaluación de impacto o dictamen previo | Ídem |
| 3. Cobertura pendiente de comprobar | Los cinco temas (actividad y progreso, XP, consulta individual del mediador, conservación y respaldos, derechos y exclusión) | Ver §4: solo se puede valorar contrastando los documentos de la clase 2 |
| 4. Modificación concreta | Aviso PRIV-6 (propuesta) | Hecha: alcance individual del mediador (`83fdcd2`); en esta unidad, Administración como gestora de solicitudes y retiro, sin autoservicio, y la política general como «no verificada». **Sigue siendo propuesta** |
| 4. Modificación concreta | Aviso final para familias y mediadores | Pendiente de texto aprobado (§4, L-C) |

## 4. Condiciones jurídicas no verificadas (sin duplicaciones)

Cada una agrupa las referencias anteriores. Ninguna se da por cumplida por una decisión de Dirección.

| # | Condición | Agrupa | Quién | Estado |
|---|---|---|---|---|
| L-A | Base y forma de información para tratar datos de menores en la gamificación general (incluida la consulta individual del mediador) | D1, R12, J2 | Legal | **No verificada** |
| L-B | Papel del colegio y su instrumento | D2, R3, J6 | Legal + Dirección | **No verificada**; requiere los contratos de la clase 2 |
| L-C | Aviso final aprobado (lector, familias, mediadores), con derechos y plazos, y su medio de entrega con constancia anterior a T0 | C-3, C-4, C-11, D7, D8, J3 | Legal (texto), Dirección (medio y constancia) | **No verificada** |
| L-D | Conservación del ledger y de las copias; desvincular frente a borrar; tombstone; irreversibilidad | D4, D5, L1, L2, L3, J5 | Legal + Dirección | **No verificada** |
| L-E | Aprobación de PRIV-6 y suficiencia como evaluación de impacto | J1, D6 | Legal | **No verificada** |
| L-F | Medio formal del canal de solicitudes y verificación de la representación (el responsable ya es Administración) | D3, J4 | Legal + Dirección | **No verificada** |
| L-G | Aceptación del riesgo T3 (restauración conjunta de base y registro) | J7 | Dirección | Pendiente (acto de Dirección) |
| L-H | Orden de activación | J8 | Dirección | Pendiente; solo con L-A…L-G cerradas |

**Consecuencias técnicas posibles, solo si Legal las determina** (no son requisitos de producto): autorización previa individual (L-A) exigiría una lista de participantes antes de F2; borrado, plazo o reincorporación (L-D) exigirían su unidad de código. Hasta que Legal se pronuncie, ninguna se implementa.

## 5. Checklist F2–F8

Cada fase empieza solo con la anterior en GREEN y con su orden. Detalle de comandos y gates: [procedimiento](GAMIFICACION_V8_ACTIVACION_OPERATIVA_V1.md) §3.

**F0 — previo**
- [ ] L-A…L-G cerradas con documento versionado en `docs/gamificacion/aprobaciones/` y orden J8 (L-H).
- [ ] Constancia de entrega de avisos (L-C) con fecha anterior al T0 que fije Dirección.
- [ ] Preflight: cuatro contenedores healthy, 0 5xx en 1 h, disco > 20 GB, `structured-backup` correcto < 24 h, O7 (una experiencia en borrador, 0 recorridos).
- [ ] `o8-check.mjs` en ambas réplicas: `mode: inerte`, `OK`.
- [ ] Rollback preparado (tags `rollback-pre-<unidad>`, copia del override).

**F2 — custodia (Dirección)**
- [ ] Clave generada sin argv ni historial, `0400` root, en `/var/www/chibalete/secrets/gamification_subject_key`; copia entregada a Dirección; evidencia: existencia, modo, longitud ≥ 32, nunca el valor.
- [ ] Directorio propio del registro fuera de `data/` y `data-critical/`, archivo vacío; destino de la copia separada (P2) bajo custodia de Dirección.

**F3 — G4 sin XP**
- [ ] Override: `GAMIFICATION_ENABLED=1`, `GAMIFICATION_MOOK_SINCE=<T0>`, volumen y `GAMIFICATION_EXCLUSION_REGISTRY`; sin `XP_EARNING_ENABLED`, sin `PM_EARNING_ENABLED`.
- [ ] Rolling por réplica con gate en paso propio.
- [ ] `o8-check.mjs`: `mode: g4_sin_xp`; clave `loadable`; registro alineado; base creada y viva; 0 hechos.

**F4 — reglas**
- [ ] `createRuleSet` con el bloque literal del acta O1 y `ruleVersion` `a7a12-v3-xp-o1`; repetición `created:false`.
- [ ] `o8-check.mjs` con `O8_EXPECT_RULE_VERSION=a7a12-v3-xp-o1` y `O8_EXPECT_RULES_SHA=95613ec318be14c820deece4cde62055e69549d66053490b11f91434afd89878`: `rules` OK.

**F5 — XP**
- [ ] `XP_EARNING_ENABLED=1` en las dos réplicas, rolling.
- [ ] `o8-check.mjs`: `mode: xp`, todo OK; «Mi progreso» del operador con 0 XP; consulta individual 200 solo para el mediador del grupo.

**F6 — publicación**
- [ ] Publicar desde Studio **después** de T0 y de F5; `publishedAt` > T0.

**F7 — comprobación**
- [ ] Primera aprobación real: 30; segunda: +20; techo 50; historial visible.
- [ ] Siguiente barrido: 0 hechos nuevos para lo reconocido. `o8-check.mjs` OK.

**F8 — observación**
- [ ] Monitoreo de §6 durante 24 h y con la frecuencia indicada; primer `structured-backup` con `gamification.db` presente; copia del registro realizada.

## 6. Monitoreo O8

Reutiliza lo que ya existe: estado de los contenedores y `/api/health/ready`, los registros `[gamification] <CÓDIGO>` del motor, el registro de acceso HTTP, el diario de `structured-backup` y un comprobador nuevo de **solo lectura**, `ops/gamification/o8-check.mjs`. Este último se ejecuta por stdin dentro de cada réplica (`docker exec -i chibalete_api_N node --input-type=module - < ops/gamification/o8-check.mjs`), no necesita imagen nueva, no escribe, no crea la base ni sus `-wal`/`-shm`, no lee el valor de la clave y solo imprime estados y recuentos. No se despliega ningún servicio ni alerta automática.

**Frecuencia:** en cada gate de F3–F7; cada hora las primeras 24 h tras F5; diario durante dos semanas; después, semanal y tras cada despliegue o restauración.

**Responsables:** Operación técnica (quien opera los despliegues) ejecuta y revisa; Dirección decide la reanudación tras cualquier suspensión; Administración atiende solicitudes y retiros.

| Señal | Mecanismo | Umbral | Acción |
|---|---|---|---|
| Salud de las réplicas | Estado del contenedor (healthy, RestartCount, con el `gate.sh` del despliegue) y `/api/health/ready` | Una réplica no healthy > 5 min o un reinicio inesperado | Revisar; si coincide con errores de gamificación, S1 |
| Reconciliación | Logs `[gamification] reconciliación MOOK abortada: <CÓDIGO>` e `intake desistió: <CÓDIGO>` | 1 en una hora: revisar. El mismo código en 3 barridos seguidos (≈ 45 min): S1 | Clasificar el código; S1 si persiste |
| Duplicaciones rechazadas | `o8-check`: `facts_entries` (`factsWithSeveralEntries`, `duplicateFactKeys`, `orphanEntries`, `factsWithoutEntry`) | Cualquier valor > 0 | **S1 inmediato**; no restaurar; informar a Dirección |
| Clave de sujeto | Log `clave de sujeto no disponible`; `o8-check` `subject_key` | Cualquier aparición con G4 encendido | El sistema falla cerrado (no emite). Revisar en el día; sin rotar la clave (P3) |
| Registro de exclusiones | Logs `EXCLUSION_REGISTRY_*`, `EXCLUSION_REPLAY_REQUIRED`; `o8-check` `registry_alignment` | `STALE` o `REPLAY_REQUIRED`: cualquiera. `UNAVAILABLE`: más de un barrido | `STALE`/`REPLAY`: **S2**, contraste con las solicitudes (PRIV-C7 §5.6) y `replayExclusions` solo con Dirección. `UNAVAILABLE`: revisar el volumen |
| Integridad del ledger | `o8-check`: `ledger_integrity`, `pm_absent`, `work_caps`, `cutoff`, `rules` | Cualquier FAIL | **S1 inmediato** (S2 si `quick_check` falla); no escribir a mano |
| Consultas de progreso | Logs `progreso no disponible`, `progreso individual no disponible`, `reconocimiento de grupo no disponible`; 503 en esas rutas | > 5 en 15 min, o persistente 1 h | Revisar base viva y registro; no requiere suspensión si no hay emisión errónea |
| Aprobaciones anómalas (D41) | `o8-check` `anomalies_d41` (máximos agregados, sin ids) | Más de 40 aprobaciones de un mediador en un día o más de 100 XP de un lector en un día ⇒ WARN | Operación lo comunica a Dirección; Dirección decide si archiva la experiencia (S0) o suspende (S1) |
| Respaldos | `journalctl -u structured-backup.service` (`result=`, snapshot) | Sin `result=ok` en 24 h; tras F3, `gamification.db` debe figurar presente | No avanzar de fase; > 48 h: informar a Dirección |
| Copia del registro (P2) | Bitácora de custodia de Dirección | Sin copia tras cada exclusión o semanal | Dirección la realiza |

**Suspensión de XP** (procedimiento §5): S0 archivar la experiencia; S1 quitar `XP_EARNING_ENABLED` (rolling); S2 quitar también `GAMIFICATION_ENABLED`; S3 volver a una imagen anterior. Operación técnica puede aplicar S1 o S2 de inmediato ante los umbrales marcados y lo comunica a Dirección en el día. **Reanudar** exige decisión de Dirección y, salvo que acepte reconocer lo aprobado durante la pausa, un corte nuevo. Ninguna suspensión borra datos.

**Evidencia de laboratorio** (`ops/gamification/__tests__/o8Check.test.mjs`, dentro de la imagen `unifiedxp-13b8045`, datos sintéticos): **24 ✓, 0 ✗**. Cubre inerte sin crear archivos; base viva con hechos reales (30/20/techo/30, reintento 0) ⇒ OK; D41 OK y WARN por umbral; regla distinta del acta ⇒ FAIL; PM, fuente ajena, hecho sin asiento, actos por encima de su importe, techo superado, desajuste ciclo/asiento y hecho anterior al corte ⇒ FAIL con su contador; exclusión sin línea en el registro ⇒ `EXCLUSION_REGISTRY_STALE`; registro en el directorio de la base ⇒ FAIL; clave ausente o con modo 0644 ⇒ FAIL; base sin escritor vivo ⇒ WARN sin crear `-wal`/`-shm`; la salida no contiene ids, claves ni rutas.

**Producción:** el comprobador no se ejecutó contra producción en esta unidad (la lectura fue bloqueada por la política de permisos de la sesión). El estado inerte está comprobado por el gate de V8-UNIFIED-XP-02 y la huella `fp.sh` de esta unidad. La primera ejecución productiva corresponde a F0.

## 7. Siguiente

1. Contrastar con Legal los documentos de §3, clase 2, y cerrar L-A…L-F.
2. Dirección: L-G y, con todo lo anterior cerrado, la orden L-H con T0.
3. Con eso, la unidad **V8-ACTIVATE-01** ejecuta §5.
