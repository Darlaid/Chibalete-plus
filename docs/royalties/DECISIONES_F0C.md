# CHP-EDITORIAL-ROYALTIES-2026-01 — Decisiones F0-C

**Estado:** CONGELADO en F0-C (2026-10-21).
**Plan:** [`PLAN_GENERAL_V1_1.md`](./PLAN_GENERAL_V1_1.md). Este documento es la **fuente única** de las decisiones P1–P15 y del `rule_set` inicial. Si el plan y este documento difieren en un valor, prevalece este documento y la diferencia se corrige como defecto.

**Estados:**

| Estado | Significado |
|---|---|
| **APROBADO** | Regla sustentada por la Doctrina, el Convenio o la arquitectura acordada. |
| **PROVISIONAL** | Parámetro técnico inicial. Requiere validación con pruebas y periodos sombra antes de volverse oficial. |
| **PENDIENTE NEGOCIO** | Requiere evidencia o aprobación humana. **No se presume.** |

> **Advertencia contractual.** La Guía de revisión jurídica advierte que la fecha de la Doctrina citada en el Convenio es inconsistente. Debe corregirse **antes de firmar**. No se pudo verificar en el repositorio, porque los documentos primarios no están versionados aquí (ver §5).

---

## 1. Matriz P1–P15

| ID | Decisión | Valor inicial | Fundamento | Estado | Unidad o gate responsable |
|---|---|---|---|---|---|
| **P1** | Minutos esperados de la obra (denominador de R) | **Prosa:** palabras ÷ 200 palabras por minuto. **Álbum, poesía, cómic y otros formatos:** duración editorial documentada y aprobada por obra. Un solo denominador por obra, independiente del modo. | Doctrina (200 ppm); contrato de medición de F0-B | **APROBADO** (regla). **PENDIENTE NEGOCIO:** la duración de cada obra no prosa, y el recuento de palabras de las 5 obras que solo están en PDF, que no tienen texto plano. | Se registra en F2-A. Sin dato válido, se bloquea el cierre oficial **de esa obra** en F4-B. |
| **P2** | Normalización de R | `r = min(1, minutos_activos / minutos_esperados)`; R = mediana de r sobre los episodios cualificados del mes | Doctrina, según Plan V1.0 §3.4 | **APROBADO** | F3-A1, F3-B |
| **P3** | Tope de escucha sin presencia | 20 min sin nueva señal humana. **Al alcanzarse, se detiene la acreditación económica, no la reproducción.** La acreditación se reanuda con la siguiente señal. Sin verificaciones invasivas. | Antifraude y accesibilidad (F0-B) | **PROVISIONAL**. No es una regla contractual aprobada. | F3-A1 (pruebas de escucha prolongada y de accesibilidad), F3-A3, revisión en F6-B |
| **P4** | Avance equivalente como alternativa a los 45 s | **Desactivado** (`equivalentProgress: off`) | La equivalencia entre formatos no está demostrada (F0-B) | **PROVISIONAL**. **PENDIENTE NEGOCIO:** confirmar que es compatible con el contrato. | Confirmación obligatoria **antes de la liquidación oficial** (gate F6-B) |
| **P5** | Simultaneidad entre obras distintas | **Principio:** una franja se atribuye a una sola obra, sin doble conteo. **Criterio inicial:** la obra con la señal humana más reciente; si empatan, no se atribuye a ninguna. | Contrato de medición (F0-B) | **APROBADO** (principio) / **PROVISIONAL** (criterio de desempate) | F3-A1 (T4, T18), F3-B |
| **P6** | Zona horaria del día y del corte contractual | `America/Bogota` | Plan V1.0 §5.6 (corte en hora de Colombia) | **APROBADO** | F3-A1, F4-B |
| **P7** | Usuarios internos y mediadores | Se excluyen el QA, el tráfico sintético (`_loadtest_marker`, reglas `lt-*`) y la actividad administrativa de prueba. **Los mediadores no se excluyen por su rol**: su elegibilidad depende de la autenticidad de la lectura, del acceso económico y de las reglas antifraude. | Doctrina (exclusión de tráfico de prueba); F0-B (73 de 75 sesiones nativas son de administración) | **APROBADO** (regla). **PENDIENTE NEGOCIO:** qué cuentas concretas son internas o de QA. | F3-B (motivo de exclusión auditable) |
| **P8** | Acceso pagado concurrente con uno gratuito | El episodio es pagado si, **al iniciarse**, una regla de clase pagada cubría la obra, según la atribución registrada por el servidor en `session_start`. Sin esa evidencia, no es pagado. | Doctrina (exclusión de lecturas gratuitas) | **PROVISIONAL** (criterio de precedencia). La evidencia obligatoria está **APROBADA**. | F3-A2 (atribución), F3-B |
| **P9** | Clasificación comercial de las 22 reglas | Taxonomía: `paid_b2c`, `paid_institutional`, `pilot`, `courtesy`, `promo_authorized`, `internal`, `template` y `unclassified`. **Sin aprobación, una regla es `unclassified`, que no es elegible.** Los grupos institucionales **no se presumen pagados**. | F0-B §B.4 (las 2 reglas B2C de producción están revocadas; 0 accesos pagados activos) | **PENDIENTE NEGOCIO**, regla por regla | F2-B aplica el mecanismo y la clase `unclassified` sin bloquearse; las clases aprobadas son obligatorias antes de F6-B |
| **P10** | LU/Android, MOOK, podcast y vídeo | Fuera de la liquidación automática de V1. **No se amplían ni se presumen permisos.** | Cobertura técnica nula o insuficiente (F0-A, F0-B) | **APROBADO** | F2-A (sujetos a P15), F3-B |
| **P11** | INS | Carga manual por periodo en `period_inputs`, con referencia a sus soportes y a las deducciones admitidas | Plan V1.0 §5.1; sin integración contable en V1 | **APROBADO** (mecanismo). **PENDIENTE NEGOCIO:** los valores de cada periodo. | F4-A (fixtures); valores reales en F6-B |
| **P12** | Anomalías | Se **señalan** y quedan auditables. Ninguna se excluye automáticamente de forma arbitraria: un administrador puede excluirla con un motivo que queda en el snapshot del cierre. Umbrales iniciales: más de 6 episodios por usuario y día, o más de 3 dispositivos simultáneos. | Antifraude conservador | **PROVISIONAL** | F3-B (señalización), F4-B (decisión registrada), revisión en F6-B |
| **P13** | Validación antes de la causación oficial | Fixtures, una cohorte QA controlada y **dos periodos naturales en sombra** | Doctrina (dos meses en sombra) | **APROBADO** | F6-A, F6-B (G10) |
| **P14** | Formatos de los estados | CSV endurecido y página HTML imprimible (el PDF se obtiene imprimiéndola). Sin dependencia XLSX. | Arquitectura acordada (F0-C §2) | **APROBADO** | F5-B |
| **P15** | Cumplimiento de derechos | Una función no autorizada **no queda disponible para los lectores**. El servidor deniega de forma efectiva los usos sin licencia (Leo, TTS, offline, modos de lectura y demás capacidades sujetas a licencia), reutilizando los puntos de autorización existentes. Excluir una lectura de las regalías no sustituye a esa denegación. | Corrección obligatoria de F0-C; Convenio (no explotar sin autorización) | **APROBADO** | **F2-A** (G2) |

### 1.1 Requisito P15 para F2-A

- **Alcance de la denegación:** solo las obras con régimen de derechos activo, es decir, con una versión vigente en `rights_versions`. Las obras sin versión de derechos mantienen su comportamiento actual, pero **no son económicamente elegibles**. Una obra de un titular externo no se publica para lectores sin una versión de derechos que lo autorice.
- **Puntos de autorización candidatos a reutilizar.** Su inventario completo se hace en la auditoría de impacto de F2-A:
  - `decideContentAccess` / `GET /api/content/:id/access` (`server.js:2803-3058`);
  - el patrón de guardia por capacidad `b2cEntitlementGuard` (`server.js:733`, ya aplicado a Experiencias);
  - la autorización de `/uploads` (`UPLOADS_AUTHZ_MODE=strict`);
  - las rutas de Leo;
  - la generación TTS;
  - `/api/offline/assignment` (`server.js:4790`).
- **Gate de F2-A:**
  1. auditoría de impacto sobre los 109 contenidos actuales (0 cambios para obras sin régimen de derechos);
  2. clasificación de derechos de las obras afectadas;
  3. prueba de regresión del acceso actual;
  4. denegación verificada por capacidad;
  5. autorización explícita antes de desplegar.
- **F0-C no modifica visores ni el servidor.**

---

## 2. Cambios de V1.0 a la V1.1 definitiva

| Tema | V1.0 | V1.1 definitiva |
|---|---|---|
| Almacenes | Uno por dominio, con respaldo en varias fases | Un solo `royalties.db` con 6 tablas (`publishers`, `rights_versions`, `rule_sets`, `period_inputs`, `closes`, `adjustments`), creado y respaldado en F1-A |
| Titulares y sellos | Entidades separadas | Un único `publishers` con `kind`; el sello es un atributo |
| `publisherId` | Editorial y beneficiario a la vez, sin distinguir | Editorial responsable; **los beneficiarios están en la matriz de derechos** |
| Métricas | Agregado mensual persistido | Cálculo bajo demanda; solo se persiste el snapshot del cierre |
| Cálculo y cierre | Jobs y elección de líder | Cierre manual; `UNIQUE(periodo)` |
| Parámetros | Repartidos por el documento | `rule_sets` versionado; esta matriz es la fuente única |
| Medición por modo | Instrumentación propia en cada modo | Hook compartido `useEconomicTick` y motor `computeEconomicEpisodes` |
| Backfill (F1-C) | Unidad propia | Eliminado: asociación individual en F1-A |
| Elegibilidad (F2-C) | Unidad propia | Integrada en F2-A |
| **Cumplimiento de permisos (P15)** | Solo exclusión de regalías, bloqueo diferido | **Denegación efectiva en el servidor, en F2-A** |
| Despliegue (F3-A4) | Unidad propia | Es el gate de F3-A3 |
| F4 | A, B y C | A (liquidación pura) y B (cierre inmutable con movimientos) |
| **Pagos** | «Marca manual de pagado» sin precisar dónde | **Movimiento en `adjustments` con `closeId`; el cierre nunca se modifica** |
| F5 | A, B y C (PDF y XLSX) | A (panel) y B (CSV y HTML imprimible) |
| F6 | A, B y C | A (cohorte QA) y B (dos periodos sombra y decisión) |
| P3 | Tope de 20 min en evaluación | Provisional; **detiene la acreditación, no la reproducción** |
| P7 | Excluir mediadores | No se excluyen por rol |
| F2-B y P9 | Implícitamente bloqueado por la clasificación | Mecanismo con la clase `unclassified`; P9 bloquea solo la elegibilidad real, antes de F6-B |
| Unidades | 19 | **14** |

---

## 3. `rule_set` inicial (`rs-2026-01-v1`)

Se insertará en `rule_sets` en F1-A, que crea `royalties.db`, o cuando la primera unidad lo necesite. **Ningún valor de negocio pendiente se inventa**: los pendientes quedan en `null` y bloquean lo que corresponda.

| Clave | Valor | Estado | Fuente |
|---|---|---|---|
| `brdShareOfIns` | 0,25 | APROBADO | Doctrina |
| `bgpShareOfBrd` | 0,30 | APROBADO | Doctrina |
| `blcShareOfBrd` | 0,70 | APROBADO | Doctrina |
| `blcFallbackToBgp` | `true` (si Σ S = 0) | APROBADO | Doctrina |
| `scoreFormula` | `sqrt(Q) * (0.40 + 0.60 * R)` | APROBADO | Doctrina |
| `retentionCap` | 1,0 | APROBADO | P2 |
| `retentionAggregate` | `median_qualified_episodes` | APROBADO | P2 |
| `qualifyingActiveSeconds` | 45 | APROBADO | Doctrina |
| `equivalentProgress` | `off` | PROVISIONAL | P4 |
| `maxQualifiedEpisodesPerUserWorkDay` | 3 | APROBADO | Doctrina |
| `resumeMergeMinutes` | 30 | APROBADO | Doctrina |
| `pauseExclusionSeconds` | 120 | APROBADO | Doctrina |
| `slotSeconds` | 15 | PROVISIONAL | Contrato F0-B |
| `listeningPresenceCapMinutes` | 20 | PROVISIONAL | P3 |
| `crossWorkTieBreak` | `latest_human_signal_else_none` | PROVISIONAL | P5 |
| `proseWordsPerMinute` | 200 | APROBADO | Doctrina (P1) |
| `timezone` | `America/Bogota` | APROBADO | P6 |
| `includedModes` | `pdf, text, immersive, a11y, album, epub` | APROBADO | P10 |
| `anomalyMaxEpisodesPerUserDay` | 6 | PROVISIONAL | P12 |
| `anomalyMaxConcurrentDevices` | 3 | PROVISIONAL | P12 |
| `payoutThresholdCop` | 50000 | APROBADO | Convenio, según Plan V1.0 §5.6 |
| `rounding` | `cop_integer_largest_remainder` | APROBADO | Arquitectura (conciliación exacta) |
| `insValue` / `deductions` | `null`: van en `period_inputs` por periodo | PENDIENTE NEGOCIO | P11 |
| `commercialClassAssignments` | Ninguna: todas las reglas son `unclassified` | PENDIENTE NEGOCIO | P9 |
| `expectedMinutes` (obras no prosa) | Ninguno: se registran en `rights_versions` | PENDIENTE NEGOCIO | P1 |

Cambiar cualquier valor crea una versión nueva de `rule_set`. Una versión nunca se aplica a periodos ya cerrados.

---

## 4. Bloqueos reales

| Bloqueo | Tipo | Qué bloquea | Qué no bloquea |
|---|---|---|---|
| P9: clasificación de las 22 reglas | Negocio | La elegibilidad económica real, antes de F6-B | F2-B, F3-A1, F3-A2 y F3-A3 |
| P11: INS por periodo | Negocio | Los cierres reales de F6-B | F4-A y F4-B, que se prueban con fixtures |
| P1: duraciones no prosa y palabras de las 5 obras solo PDF | Negocio | El cierre oficial de esas obras | Todo lo demás |
| P4: compatibilidad contractual del avance equivalente | Jurídico | La liquidación oficial | F3–F6-B en sombra |
| P7: lista de cuentas internas | Negocio | La exclusión exacta en F3-B y F6 | F3-A1 y F3-A2 |
| Fecha inconsistente de la Doctrina en el Convenio | Jurídico | La firma de Convenios | El desarrollo |
| **0 accesos pagados activos en producción** (F0-B) | Negocio | Que F6-B produzca resultados económicos reales distintos de cero | El software y las pruebas. Los eventos gratuitos **no** se convierten en derechos. |

**Ninguna decisión pendiente bloquea F3-A1.**

---

## 5. Validación documental de F0-C

| Validación | Resultado |
|---|---|
| Porcentajes 25/30/70: 30 + 70 = 100 % de la BRD; una sola BRD | Coherente con el Plan V1.0 §5.2 y con F0-A §E |
| Fórmulas de r, R, S, presencia, MontoObra y Variable/Total | Idénticas en el plan §4 y §6 y en el `rule_set` §3 |
| Plazos: corte, 15 días hábiles, trimestre y pago a 30 días; umbral de 50.000 COP | Idénticos al Plan V1.0 §5.6 |
| Permisos | P15 corregido: denegación efectiva en F2-A |
| Coherencia entre los dos documentos | Las 14 unidades, las 6 tablas, G1–G10 y P1–P15 aparecen en ambos sin contradicciones |
| Una unidad, un resultado, un gate | Comprobado (plan §7) |
| G1–G10 asignados | Todos tienen al menos una unidad (plan §7) |
| Exclusiones de alcance | ERP, contabilidad, portal externo y pagos automáticos siguen excluidos |
| **Cotejo con los documentos contractuales primarios** | **PARCIAL.** La Doctrina v1.0, el Convenio marco y la Guía jurídica no están en el repositorio. Se cotejó contra sus citas en el Plan V1.0. **Hay que cotejarlos con los originales antes de F4-A**, que codifica las fórmulas económicas. No bloquea F3-A1. |

**Contradicciones con F0-A/F0-B, resueltas en esta versión:**

1. F0-A dejaba `workId` como condicional. **Cerrado:** sin `workId`.
2. F0-B proponía usar la elección de líder (`withLeader`) para los snapshots. **Sustituido** por el cierre manual.
3. F0-B proponía excluir a los mediadores. **Corregido** (P7).
4. V1.1 preliminar mantenía la propuesta de F0-B para P15: alerta y bloqueo diferido. **Corregido:** denegación efectiva en F2-A.
5. V1.1 preliminar decía que habría «4 despliegues». **Corregido:** se despliega cada unidad productiva por separado (plan §7.1).
6. F0-B apoyaba R en el progreso. **Corregido:** R = tiempo activo ÷ minutos esperados.
7. F0-B exigía visibilidad para la escucha. **Corregido:** la vía de escucha no exige visibilidad.
