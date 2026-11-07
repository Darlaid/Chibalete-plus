# V8-ACTIVATION-GATE-01 — Reglas XP formalizadas y gate de activación

> **Matriz sustituida** por [V8 — Cierre operativo del gate](GAMIFICACION_V8_GATE_CIERRE_OPERATIVO.md) (V8-GATE-CLOSE-02). Este documento se conserva como registro.

**Fecha:** 2026-11-07. **Veredicto:** `YELLOW`. El acta de reglas (O1) está registrada y validada contra el código; la activación (F2–F8) **sigue bloqueada** por el gate jurídico, que no puede cerrarse en ingeniería.

**Este documento no activa nada, no aprueba PRIV-6, no elige una base jurídica ni concluye sobre el cumplimiento normativo.** Contrasta lo que existe en el repositorio y en producción con lo que exige el [procedimiento de activación](GAMIFICACION_V8_ACTIVACION_OPERATIVA_V1.md) (J1–J8, O1–O8). Las decisiones pendientes ya están formuladas en [V7](GAMIFICACION_V7_DECISIONES_ACTIVACION_PILOTO_V1.md) (D1–D9, L1–L5, N1); aquí no se reformulan.

## 0. Base verificada (2026-11-07, ~15:30Z)

| Elemento | Estado |
|---|---|
| Rama | `origin/chp/epub-mainfile-r1-release` = `9414f53` (evidencia del despliegue, solo docs) sobre `13b8045` |
| API | `chibalete/api:unifiedxp-13b8045` = `c3361ee0…` ×2, healthy, RestartCount 0 |
| Front | `chibalete/front:unifiedxp-13b8045` = `26a0a3f4…`, healthy |
| Gamificación | 0 variables `GAMIFICATION_*`/`XP_*`/`PM_*`; sin `gamification.db`, sin clave, sin registro; consulta individual → 404 |
| MOOK | «La tortuga…» en borrador, 0 recorridos, 0 entregas (huella de 15:13Z, [evidencia](../ops/V8_UNIFIED_XP_02_DEPLOY_EVIDENCE.md)) |

## 1. Decisiones de Dirección ya adoptadas (no se vuelven a preguntar)

| Decisión | Registro |
|---|---|
| XP como única escala; PM y gamificación heredada retirados | V8-UNIFIED-XP-01 (`d3eb3d6`), desplegado |
| Activación general, sin lista de participantes (B1 descartado como requisito de producto) | [Procedimiento V8](GAMIFICACION_V8_ACTIVACION_OPERATIVA_V1.md), encabezado |
| Consulta individual del mediador limitada a sus propios estudiantes | V8-UNIFIED-XP-01 (`447dc73`), desplegado inerte |
| Reglas: 10 + 20 = 30, +20, techo 50 por obra y ciclo, sin XP por clics, tiempo ni lectura terminada; Semilla y Brote | **Acta O1** [`DIR-XP-O1-20261107`](aprobaciones/APROBACION-DIR-XP-O1-20261107.md) |

Una decisión de Dirección **no** cierra por sí sola una condición jurídica (J1–J7).

## 2. Acta O1 y contrato XP

- Archivo: `docs/gamificacion/aprobaciones/APROBACION-DIR-XP-O1-20261107.md`. `approvalRef` `DIR-XP-O1-20261107`, emitido por Dirección; alcance: modelo de reglas, no activación.
- `ruleVersion` `a7a12-v3-xp-o1`. Bloque `rules` literal para F4: `{"schema":1,"facts":{},"recognition":{…}}`, SHA-256 `95613ec318be14c820deece4cde62055e69549d66053490b11f91434afd89878` (= el `rules_sha256` que guardará `gm_rule_sets`).
- La entrada en vigor la fija F4 (`effectiveFrom` entre la instalación y la publicación de F6). No se instaló ninguna regla.

## 3. Validaciones

| Validación | Resultado |
|---|---|
| `node docs/gamificacion/aprobaciones/verificar_o1.mjs` (código real, base temporal sintética, sin clave ni datos) | **40 ✓, 0 ✗** |
| — el bloque del acta es parseable, sin campos de PM, con el SHA declarado | ✓ |
| — `createRuleSet` lo acepta, es idempotente, `rules_sha256` = SHA del acta, `getActiveRuleSet` lo devuelve | ✓ |
| — variantes con `caps`, `amounts.pm` o `reread.pmFactors` ⇒ `PM_RETIRED`; pago por `facts` rechazado; retroactiva ⇒ `RETROACTIVE_RULES`; mismo id con otro contenido ⇒ `IDEMPOTENCY_CONFLICT` | ✓ |
| — 30 → +20 → 0 (techo 50); relectura 0; otra obra 30; sin `pm` en ninguna salida; «con comentarios», autorrevisión y XP apagado ⇒ 0 | ✓ |
| — recorrido MOOK, lectura terminada, validación presencial y revisión por `facts` ⇒ 0 XP; tiempo, velocidad, clics, bloque inmersivo y porcentaje del cliente ⇒ excluidos | ✓ |
| — solo Semilla y Brote (0 ⇒ Semilla; 30 y 1 obra ⇒ Brote; 50 ⇒ Brote) | ✓ |
| Laboratorio con la imagen productiva (V8-UNIFIED-XP-02): regla solo XP, 30/+20/50, progreso individual, dos reconciliadores | 44/0 (`on`), 44/0 (`hist`), 34/0 (`off`), 35/0 (inerte) |
| Ratchet de evidencias | ver §8 |

## 4. Documentación jurídica y de privacidad existente

Inventario del repositorio y del bundle productivo. **No hay en el proyecto una política integral de privacidad, términos de uso, ni convenio o contrato de encargo con colegios** (la propia revisión PRIV-6, R3, lo registra como «no documentado»). Lo publicado es el aviso breve de Leo (COMP-05), presente en el bundle de producción.

| Tema | Cobertura comprobada (publicada) | Documentación interna | Ausencia documental | Requiere valoración jurídica |
|---|---|---|---|---|
| 1. Registro de actividad y progreso pedagógico | Parcial: aviso de Leo, «Chibalete+ registra señales generales para acompañar tu lectura» (`Chatbot.tsx`, texto aprobado por Dirección, COMP-05). Se refiere al acompañamiento de Leo | Aviso PRIV-6 §3 (propuesta); política de retención de eventos (`CHP_MOOK_EVENTS_EVIDENCE_RETENTION_POLICY_01`, aprobada, no ejecutada) | No hay texto publicado que describa el registro de progreso y de entregas en general | Si el aviso de Leo basta para el progreso pedagógico o se necesita información específica (D1, D8) |
| 2. Reconocimientos XP | Ninguna | Aviso PRIV-6 partes A/B/C (**propuesta**, no aprobada, sin superficie en la app) | Total en lo publicado | Contenido del aviso y base (D1, C-3) |
| 3. Consulta individual por mediadores | Parcial: «Tu mediador puede consultar indicadores de acompañamiento, no la conversación completa» (aviso de Leo) | Aviso PRIV-6 actualizado hoy con el alcance real (XP, nivel, obras y logros de sus propios estudiantes), marcado [LEGAL] | No hay texto publicado sobre la consulta individual del reconocimiento | Si la consulta individual es compatible con la base que elija Legal y cómo se informa (R12 en **REVISAR**) |
| 4. Conservación del historial y respaldos | Ninguna | PRIV-6: el ledger no caduca; las copias no se depuran (marcas [LEGAL]/[PENDIENTE]); retención de eventos aprobada pero no ejecutada | Total en lo publicado | D4, D5, L1, L2 |
| 5. Derechos y exclusión | Solo «Consultas sobre privacidad: contacto@chibaleteeditores.com» en el aviso de Leo, que no está validado como canal formal de derechos | Runbook de retiro probado en laboratorio (PRIV-C7, 60/60); exclusión irreversible | No hay texto publicado sobre acceso, rectificación, supresión u oposición ni sobre plazos | D3, D8, D9, L3, L4 |

**Corrección aplicada en esta unidad (sin efecto jurídico):** el aviso propuesto y la revisión PRIV-6 afirmaban que el mediador no ve puntos ni niveles individuales. Desde V8-UNIFIED-XP-01 eso ya no es cierto. Se actualizaron los hechos (aviso §A, §B-5 y §C; revisión §1-5b, §2, R12 y §7), se marcaron para Legal y siguen como **propuesta**. Se retiró la marca [PENDIENTE] de los valores, ahora fijados por O1.

## 5. Matriz

GREEN = satisfecha y comprobada. YELLOW = falta una actuación concreta, sin decisión abierta. RED = impide activar mientras no se resuelva una decisión o aprobación.

### 5.1 Gate jurídico

| # | Estado | Evidencia | Qué falta exactamente |
|---|---|---|---|
| J1 PRIV-6 aprobado | **RED** | `aprobaciones/` solo contiene el acta O1; PRIV-6 está en `PRIV6_READY_FOR_REVIEW` | Acta de aprobación de PRIV-6 con autoridad, fecha y alcance **general** |
| J2 Modelo de participación (D1, N1) | **RED** | Dirección decidió activación general sin lista; **no** hay dictamen de Legal sobre la base | Dictamen escrito de D1. Si Legal exige autorización previa: STOP y unidad B1 antes de F2 |
| J3 Avisos comunicados (C-3, C-4, C-11, D7) | **RED** | Aviso en propuesta con marcas [LEGAL]; sin canal de entrega decidido; ninguna constancia de entrega | Aviso B aprobado sin marcas; partes A y C revisadas; D7 decidido; constancia de entrega a todas las familias con acceso, anterior a T0 |
| J4 Roles, retiro y custodia (D3, D9, L5, P2, P4) | **RED** | Ninguna designación registrada | Canal formal y verificación de representación (D3); responsable de retiros y plazo (D9); custodios del registro de solicitudes y de la copia del registro de exclusiones (L5, P2, P4) |
| J5 Retención y respaldos (D4, D5, L1–L3) | **RED** | Sin decisiones escritas | Acta con D4, D5, L1, L2 y L3. Si alguna exige borrado, plazo o reincorporación: unidad de código propia antes de F2 |
| J6 Derechos de menores (D2, D6, D8) | **RED** | Papel del colegio no documentado (R3); DPIA no aceptada; redacción de derechos pendiente | Instrumento firmado del papel del colegio; aceptación de PRIV-6 + Evidencia G4 como DPIA o documento que Legal exija; redacción de derechos y plazos |
| J7 Riesgo residual T3 | **YELLOW** | Riesgo descrito en PRIV-C7 §6; sin aceptación | Aceptación escrita de Dirección (no requiere Legal según el procedimiento) |
| J8 Orden de activación | **RED** | No emitida; el acta O1 la excluye expresamente | Orden explícita y separada de Dirección, solo con J1–J7 cerrados |

### 5.2 Gate operativo

| # | Estado | Evidencia | Qué falta |
|---|---|---|---|
| O1 Acta de reglas | **GREEN** | Acta `DIR-XP-O1-20261107` versionada; bloque solo XP; SHA `95613ec3…`; `verificar_o1.mjs` 40/0 | — |
| O2 Release de desbloqueo | **GREEN** | `mook_review` solo por reconocimiento desde F1; producción en `unifiedxp-13b8045`, CI 3/3, Trivy 0, laboratorio 44/0 | — |
| O3 Clave de sujeto | **YELLOW** | No existe (correcto hasta F2) | Generarla en F2 con su custodio designado (depende de J4) |
| O4 Registro de exclusiones | **YELLOW** | Sin volumen ni archivo (correcto hasta F2) | Volumen propio, archivo vacío y copia separada en F2, con custodio (depende de J4) |
| O5 Respaldo | **GREEN** | `structured-backup` 12:01Z `result=ok`, snapshot `31d0105e` | Volver a comprobar < 24 h en F0 |
| O6 Producción sana | **GREEN** | Cuatro contenedores healthy, 0 5xx, 57 GB libres (V8-UNIFIED-XP-02) | Repetir en F0 |
| O7 Contenido elegible | **GREEN** | Una experiencia, en borrador, 0 recorridos y 0 entregas; nada publicado antes de un corte inexistente | Repetir la lectura de `mook_db.json` en F0 |
| O8 Alarmas D41 | **YELLOW** | No hay documento de umbrales ni responsable | Documento de alarmas (aprobaciones anómalas, A7-A12-V3 §4.8) con responsable |
| (A7-A12-V3 §4.7) Criterio pedagógico | **YELLOW** | `minPalabras` 40/30 en la ficha 03A; sin acta de Pedagogía | Criterio de Pedagogía sobre `minPalabras` y revisión disponible en las cohortes |

## 6. Qué falta para ejecutar F2–F8

1. **Legal:** D1 (y con Dirección N1), D2, D6, D8, L1, L2 y aprobación de PRIV-6 → J1, J2, J5, J6.
2. **Legal y Dirección:** aviso B final y su redacción sobre la consulta individual (R12), D3, D4, D5, L3 → J3, J4, J5.
3. **Dirección:** D7 (canal y momento del aviso) y constancia de entrega; D9 y L5 (responsables y custodios); aceptación de T3 (J7); valor de T0; orden de activación (J8).
4. **Pedagogía:** criterio de `minPalabras` y revisión disponible.
5. **Operación:** documento de alarmas D41 (O8).
6. **Ingeniería, solo con lo anterior en GREEN:** F2 (clave y registro con custodios), F3–F8 según el procedimiento. Si D1 exige autorización previa o L1/L3/D4 exigen borrado, reincorporación o plazo, primero la unidad de código correspondiente.

## 7. Siguiente ejecución mínima

Cerrar el gate jurídico (J1–J6) con Legal y Dirección, en este orden: **D1 y N1**, después D2/D6/D8, D3/D9/L5 y D4/D5/L1–L3, el aviso final y D7 con su constancia. Con eso, Dirección acepta T3 y emite la orden (J8), y la unidad **V8-ACTIVATE-01** ejecuta F2–F8.

## 8. Evidencia

- Acta: `docs/gamificacion/aprobaciones/APROBACION-DIR-XP-O1-20261107.md`.
- Verificación: `docs/gamificacion/aprobaciones/verificar_o1.mjs` (40/0).
- Correcciones PRIV-6: aviso propuesto y revisión jurídica (hechos sobre el mediador, sin cambiar su estado).
- Producción y laboratorio: [V8-UNIFIED-XP-02](../ops/V8_UNIFIED_XP_02_DEPLOY_EVIDENCE.md).
- Ratchet de evidencias sin violaciones antes del commit.
