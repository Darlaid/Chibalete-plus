# GAMIFICACION — Contratos funcionales V1

**Unidad:** GAMIFICACION-G1-01 · **Fecha:** 2026-10-29 · **Baseline:** `f4836d1`.
**Depende de:** [`GAMIFICACION_DOCTRINA_V1.md`](GAMIFICACION_DOCTRINA_V1.md). Los identificadores `Dxx`, `DC-xx` y `Px` remiten a ese documento.
**Naturaleza:** contratos **funcionales** (qué y con qué garantías). Los contratos técnicos —esquema SQL, firmas y payloads— son el entregable de G2. Ningún nombre de tabla o endpoint de aquí está aprobado como definitivo.

En cada sección se separa:
- **EXISTE** — está en el repositorio en `f4836d1`, con su referencia.
- **CONSTRUIR** — no existe; lo construye la unidad indicada.

---

## 1. XP, nivel lector, logros, racha y Puntos de Magia

| Concepto | Qué es | Puede bajar | Se gasta | Transferible | Fuente | Persistencia |
|---|---|---|---|---|---|---|
| **XP** | Progreso lector permanente (D02, P1) | **No** (es monotónico; una corrección se registra como evento de anulación de la fuente y no resta XP visible, ver §5.6) | No | No | Evidencia de grado A o B | Servidor |
| **Nivel lector** | Trayectoria legible y única (D04). Combina XP con **requisitos de competencia** (variedad, MOOK, dificultad, DC-02) | No | No | No | Se deriva del XP y de los logros | Se deriva y se cachea |
| **Logro** | Hito cualitativo con una evidencia definida (DC-01) | No (se puede anular por fraude probado mediante un registro de anulación, nunca borrándolo) | No | No | Regla de logro sobre la evidencia | Servidor |
| **Racha** | Continuidad flexible (D05: semanal o meta personal, ABIERTA) | Se reinicia sin castigo y permite recuperarse | No | No | Actividad de grado A o B por período | Se deriva |
| **Puntos de Magia (PM)** | Moneda gastable, escasa y con presupuesto (D03) | **Sí**, por canje o por compensación | Sí | No | **Solo** emisión del servidor desde evidencia admitida (§3) | Ledger append-only + snapshot (D26 y D27) |

**Reglas comunes**
- «Nivel» no vuelve a usarse para la duración de una sesión (D44).
- Ninguno de estos conceptos lo escribe el cliente (P2).

**EXISTE (legado, no reutilizable como fuente de verdad)**
- `RewardEngine` (XP, racha y nivel en el `localStorage` del inmersivo).
- `LEVELS` (duración de sesión).
- `nivel_lectura` (estático, «Novato»).
- `racha_dias` (sin uso).
- `libros_leidos` (en memoria).
- `user.puntos` (en memoria; desde G0 no lo modifica nada).

**CONSTRUIR:** los cinco conceptos en el servidor (G3 y G4).

---

## 2. Fuentes de evidencia

| Fuente | Hecho admitido | Grado | Quién lo produce | EXISTE | CONSTRUIR |
|---|---|---|---|---|---|
| **Lectura canónica: finalización** | Obra terminada | **A, cuando esté validada; hasta entonces B como máximo** | Servidor | `POST /api/progress/:u/:c/complete` (`server.js:5195`) | **Validador de finalización** (G4): contrastar con la actividad registrada (sesiones canónicas en `events.db`, tiempo activo mínimo y avance plausible) antes de admitirla. Hoy la marca `isCompleted` la decide el cliente |
| **Lectura canónica: hitos** | Hitos reales de avance | B | Servidor | Eventos `reading_*` canónicos (`server/analytics/readingCanonical.mjs`), `progress.db` | Definir qué hitos cuentan; capturar en el servidor una referencia estable, porque `events.db` rota a los 90 días |
| **MOOK: evidencia revisada** | Evidencia con revisión humana `REVIEWED` | A | Revisor humano, con su identidad tomada de la sesión | `reviewEvidence` (`server/lib/experienceStore.js:507`), `POST /api/experiences/review/:evidenceId` (`server.js:3039`) con `requireReviewScope` | Gancho en el servidor después de `mutateMook`. Decidir si `con_comentarios` cuenta (Doctrina §6-8) |
| **MOOK: experiencia completada** | Experiencia terminada | B | Servidor | `experience_completed` (`server/experienceBackboneEmitter.mjs:64`, flag OFF) | Gancho propio; no depender del flag del backbone |
| **Leo** | — (D10 = C: **no emite al inicio**) | C | — | G0: `server/leoAwardTokens.js` elimina `[AWARD_POINTS]`; eventos `leo_*` con flag OFF | Más adelante, un evento estructurado validado (D10-B, GATED) |
| **Actividad offline** | Actividad validada por el docente (D12) | B | Mediador con alcance sobre el grupo | Alcance de mediador (`server/identity/cis.mjs`) | Flujo de validación del docente (G7) |
| **Oralidad** | — (feedback o logro, D11 ABIERTA) | C | — | `OralityModal` (cliente) | Nada que emita PM |
| **Inmersivo: bloques y rachas de 30 s** | — | **D** | — | `RewardEngine`, `block_complete` | Retirar o reformular (G4B.4) |

**Regla de autoridad (FIXED)**
- Las fuentes **no** llegan por HTTP desde el navegador.
- La API es un monolito Express con dos réplicas sobre los mismos archivos, así que la ingesta se implementa como **llamada interna en proceso** desde el punto donde el servidor ya validó el hecho (después de `reviewEvidence` o del validador de finalización).
- El `POST /api/gamification/events/ingest` que propone la doctrina se sustituye por esa función interna. Si algún día hiciera falta HTTP, solo se admitiría con autenticación de servicio, nunca con la sesión de usuario. Decisión para G2.

---

## 3. Matriz de elegibilidad

| Evidencia | XP | Logro | PM | Condiciones |
|---|---|---|---|---|
| Obra terminada **validada** (A) | Sí | Sí | **Sí, decreciente** (D08) | Primera vez: valor pleno. Relecturas: rendimiento decreciente y ventana CONFIGURABLE. Cuenta para los topes diario y semanal (D13) |
| Obra marcada como terminada **sin validar** | No (hasta G4) | No | **No** | — |
| MOOK aprobado (A) | Sí | Sí | **Sí** (D09) | Una vez por evidencia (`evidenceId`); con topes |
| MOOK, experiencia completada (B) | Sí | Sí | Sí, con menor peso | Una vez por (usuario, versión de experiencia) |
| Hitos de lectura (B) | Sí | Posible | Sí, con menor peso, o no | Lo decide el catálogo de reglas (CONFIGURABLE) |
| Actividad offline validada por el docente (B) | Sí | Sí | Sí, con tope propio | Validador con alcance; nunca un monto libre |
| Leo (C) | No | Posible, solo de feedback | **No** | D10 |
| Oralidad (C) | No | Solo si D11 = C | **No** | D11 |
| Grado D | **No** | **No** | **No** | P4 |
| Q/R/S | **No** | No | **No** | D07 GATED; ver Doctrina §5-4 |
| Acciones del mediador o coordinador | No para sí mismos | Institucional | **No personal** (D38) | Solo misiones institucionales |

---

## 4. Ledger: modelo conceptual e idempotencia

### 4.1 Entidades conceptuales (CONSTRUIR en G3)

- **Movimiento PM**, append-only. Campos:
  - `movementId`, `userId`;
  - `kind` ∈ {`earn`, `reserve`, `reserve_release`, `redeem_confirm`, `compensation`, `adjustment`};
  - `amount`, con signo;
  - `source` ∈ {`reading`, `mook`, `offline`, `mission`, `redemption`, `admin`};
  - `sourceEventId`, `ruleVersion`, `reasonCode`;
  - `actorId` (el sistema, o la persona en un ajuste), `relatedMovementId`;
  - `createdAt` (reloj del servidor).
- **Snapshot de saldo**, por usuario: `available`, `reserved`, `lifetimeEarned` y `lastMovementId`. Siempre se puede reconstruir desde los movimientos (D26).
- **Asiento de XP y logros**, append-only y separado de los PM: `xpEntryId`, `userId`, `source`, `sourceEventId`, `xp ≥ 0`, `ruleVersion`, y `achievementId` cuando aplique.
- **Contadores de límites** por usuario, día y semana, y por fuente. Se derivan del ledger o se materializan en la misma transacción.
- **Conjunto de reglas versionado** (`ruleVersion`): montos, topes y curvas. Es la configuración CONFIGURABLE con historial. Los cambios son prospectivos (D48).

### 4.2 Invariantes (FIXED)

| # | Invariante | Prueba (nombres de la fuente) |
|---|---|---|
| I1 | `UNIQUE(source, sourceEventId, kind)`: el mismo hecho nunca acredita dos veces | `idempotency.test.mjs` (100 reintentos dan 1 movimiento) |
| I2 | El snapshot es igual a la suma de los movimientos, siempre | `ledgerInvariant.test.mjs` + prueba de propiedades |
| I3 | Sin `UPDATE` ni `DELETE` sobre los movimientos | Triggers `RAISE(ABORT)`, el mismo patrón que `econ_events` y `rights_versions` |
| I4 | `available ≥ 0` después de cada transacción; la reserva y el débito ocurren dentro de una transacción `IMMEDIATE` | `redemptionConcurrency.test.mjs` (20 canjes concurrentes con saldo para uno) |
| I5 | Ningún endpoint de cliente acepta un monto positivo arbitrario | `sourceAuthority.test.mjs` |
| I6 | Cada movimiento conserva su `ruleVersion` | Auditoría reproducible |

### 4.3 Viabilidad con la arquitectura actual (EXISTE)

- `better-sqlite3` en modo WAL ya se comparte entre `api_1` y `api_2` sobre el mismo archivo con bind mount. Lo hacen `progress.db`, `events.db`, `royalties.db` e `identity.db`.
- Las transacciones `db.transaction(...).immediate()` ya se usan en `server/royalties/closesStore.mjs:209`. `BEGIN IMMEDIATE` serializa a los escritores de las dos réplicas, que es lo que necesitan I1 e I4.
- Las migraciones versionadas con UP/DOWN ya existen (`server/db/migrate.js`, `server/royalties/migrations/`).
- **Conclusión:** no hace falta otra base de datos, un microservicio ni otra infraestructura.
- **Recomendación para la ADR de G2:** un módulo `server/gamification/` con su **propio archivo SQLite** (por ejemplo `data-critical/gamification.db`), el mismo motor y patrón que `royalties.db`. Así queda separado de regalías (P6) y de la rotación de 90 días de `events.db`, y tiene respaldo y retención propios.
- **Dependencia:** añadir el archivo al respaldo estructurado antes de activar cualquier emisión.

---

## 5. Emisión, límites, reservas, canjes y compensaciones

### 5.1 Emisión (G3 y G4)

1. Una fuente validada (§2) llama a `award(sourceEvent)` dentro del proceso.
2. Se resuelven las reglas vigentes (`ruleVersion`) y la elegibilidad (§3).
3. Se aplican los topes (§5.2). Si se excede, se registra el **intento recortado**: se acredita lo que cabe y nada más, y se deja una marca de auditoría.
4. Se inserta el movimiento con idempotencia y se actualiza el snapshot **en la misma transacción**.
5. Si el ledger falla, la fuente **no** falla. La lectura y MOOK continúan, y el hecho queda pendiente para reconciliarse con el mismo `sourceEventId`, lo que es seguro por I1.

Con `PM_EARNING_ENABLED=false` no se emite. Si después la emisión se activa sobre hechos ocurridos con el flag OFF, se aplica la regla prospectiva (D48).

### 5.2 Límites (D13, D14 y D46)

- **Topes:** diario por fuente, diario global y semanal global. Los valores son CONFIGURABLES; el candidato del piloto es 200 por semana.
- **Presupuesto:** bolsa mensual global más techo por usuario. Si la bolsa se agota, la emisión de PM se detiene y el XP continúa.
- **Frontera de tiempo:** se usa el reloj del servidor y la zona horaria de la institución (América/Bogotá). Si la definición de día se aparta de esa, la decisión queda para G2.

### 5.3 Canje (D29)

1. `POST` canje con `Idempotency-Key`.
2. Transacción `IMMEDIATE`: se valida el saldo y se escribe `reserve` (−amount en `available`, +amount en `reserved`).
3. Se entrega la recompensa:
   - **digital:** en una transacción local que concede el activo;
   - **contenido:** regla de acceso (§7);
   - **cupón:** llamada a Woo (§6).
4. Si la entrega va bien, se escribe `redeem_confirm` y la recompensa queda concedida.
5. Si falla, se escribe `reserve_release` y los PM quedan intactos. Ningún canje deja saldo debitado sin recompensa o sin compensación.
6. Las reservas huérfanas (por ejemplo, un reinicio a mitad de un canje) las cierra un reconciliador idempotente: las libera, o las confirma si la entrega consta.
7. El frontend también comprueba el saldo, pero solo para la UX (DC-04).

### 5.4 Compensaciones y ajustes (D30)

- Toda corrección es un movimiento `compensation` o `adjustment` con `reasonCode`, actor y `relatedMovementId`. **Nunca existe «set balance».**
- Los ajustes manuales solo los hace el administrador, con motivo obligatorio y auditados. El docente **no** puede hacerlos (D36).
- Saldo temporalmente negativo por compensación (riesgo citado en la fuente): se permite solo en `compensation`, nunca en un canje. Bloquea nuevos canjes hasta que se recupere.

### 5.5 Anomalías (DC-03)

- Hay límites automáticos (los topes) y señales para revisión: picos por fuente o usuario, y finalizaciones improbables.
- Una señal **no** sanciona sin trazabilidad. La acción es revisar, y en su caso compensar con un motivo.

### 5.6 XP ante el fraude

- El XP no se resta (D02). Si se prueba que una evidencia era inválida, se registra una **anulación** del asiento de origen.
- La anulación excluye esa evidencia del cálculo de nivel y logros desde ese momento (prospectivo). El historial se conserva.
- La pantalla correspondiente queda definida en G4 con UX.

---

## 6. Recompensas digitales, contenido exclusivo y cupones WooCommerce

| Tipo | Orden (DC-10) | Entrega | Gate | EXISTE | CONSTRUIR |
|---|---|---|---|---|---|
| Avatares (D15), fondos (D16), salas cosméticas (D18-A) | 1.º | Concesión local en el ledger de activos del usuario; no se puede descargar (D16-B) | Licencias de los activos | Piezas de UI (`PixelBadge`) | Catálogo de activos y concesión (G5-A) |
| Contenido-premio (D17), salas de contenido (D18-B) | 2.º | Regla de `access_db` con alcance de usuario, temporal o de cortesía, y clase comercial **no económica** | D17, D51 y D52 | Motor de acceso por capas, `accessStartsAt`/`accessEndsAt`, `commercialClass` | Puente de concesión (G5-B) |
| Cupones 5/10/15 % (D19) | 3.º | Woo `wc/v3`: cupón de **uso único** | D23, D35, D46 y `WOO_COUPONS_ENABLED` | Solo catálogo público `wc/store/v1` (`server/lib/wooCatalog.mjs`) | Cliente de escritura Woo con credenciales de servidor (G6) |

### Política de cupón (FIXED salvo donde se indica)

- `discount_type=percent`, `amount ∈ {5, 10, 15}`. **Más del 15 % se rechaza en el servidor y además se verifica contra Woo.** Los escalones son CONFIGURABLES dentro del techo.
- `usage_limit=1`, `usage_limit_per_user=1` e `individual_use=true`.
- `date_expires`: 30 días (CONFIGURABLE), visible **antes** de confirmar el canje.
- Restricciones de producto o categoría, y exclusión de artículos rebajados: CONFIGURABLES por Comercial.
- Idempotencia de doble capa:
  1. la clave del canje en el ledger;
  2. un identificador derivado del canje en metadatos o en el código del cupón, de modo que un reintento consulta antes de crear.
- Fallback a códigos pregenerados (D23-A): pool en servidor, asignación dentro de la transacción de reserva.
- Antes de crear cualquier cupón se exige la **autorización de un adulto** (D35, GATED).

---

## 7. Separación entre gamificación, derechos de acceso y regalías

| Regla (FIXED) | Mecanismo | Prueba |
|---|---|---|
| La gamificación nunca escribe en `royalties.db`, `econ_events`, `closes` ni `adjustments` de regalías | Módulo y archivo SQLite propios; sin importar los stores de regalías | `royaltyIsolation.test.mjs`: estructural (imports) y de comportamiento (la huella de `royalties.db` y `econ_events` no cambia después de una secuencia de emisión y canje) |
| El contenido-premio entra por el **motor de acceso**, no por la UI | Regla de `access_db` creada por el servidor, con alcance de usuario y ventana temporal | `rewardAccessRights.test.mjs` |
| Una regla de premio lleva una clase comercial **no económica** (`courtesy` o `promo_authorized`; la elección depende de D52) | `commercialClass.mjs`: solo `paid_b2c` y `paid_institutional` son económicas | La regla de premio nunca aparece como atribución económica |
| Un premio solo desbloquea una obra cuyos derechos lo permitan | D51 abierta. Hoy no hay ningún permiso de premio en `RIGHTS_PERMISSIONS` (`rightsStore.mjs:23`) | Si D51 = B, la ampliación es un cambio en el esquema de regalías que necesita su propia unidad con autorización |
| La gamificación puede **leer** evidencia compartida, pero nunca convierte Q/R/S en saldo | D07 | Ninguna fórmula económica controla un saldo |
| La lectura no depende del motor | La lectura, el progreso, MOOK y el acceso no importan `server/gamification/`; los ganchos son *fire-and-forget* con captura de errores | Prueba con el motor que lanza error: la lectura y la revisión MOOK responden igual |

---

## 8. Roles y permisos

Roles reales: `administrador`, `mediador` (con `mediatorKind` ∈ {`teacher`, `librarian`, `coordinator`, `parent`}) y `lector`.

| Capacidad | Lector (alumno) | Familia o acudiente | Docente / bibliotecario | Coordinador | Administrador |
|---|---|---|---|---|---|
| Ver su XP, nivel, logros, saldo e historial | Propio | De su menor vinculado (**GATED**) | No individual por defecto | No | Soporte, con auditoría |
| Canjear lo digital | Sí, con topes | — | — | — | — |
| Canjear lo comercial (cupón) | **Solo con autorización de un adulto** (D35) | Autoriza (**GATED**) | — | — | — |
| Validar evidencia (MOOK, offline) | — | — | Sí, dentro de su alcance (D36) | Sí, dentro de su alcance | Sí |
| Conceder PM o fijar saldo | **No** | **No** | **No** | **No** | Solo compensación o ajuste con motivo (D30) |
| Ver detalle personal de alumnos | — | — | Lo pedagógico de su grupo, como hoy | **No**: KPIs agregados (D37) | Sí, con auditoría |
| Misiones institucionales | — | — | Participa | Gestiona (D37-C) | Configura |
| Ranking o exposición pública | Nunca por defecto (P5 y D34) | — | Cooperativo opt-in solo si D06 = C | — | — |

**EXISTE**
- RBAC de mediador por alcance (`server/identity/cis.mjs`, `requireReviewScope`).
- Sesión firmada.
- Alcance de organización y grupo.

**CONSTRUIR**
- **Vínculo verificable adulto ↔ menor** con consentimiento auditable y revocable. `mediatorKind='parent'` existe, pero no se asocia a ningún alumno, así que no sirve como autorización (D35, GATED, Legal).
- Matriz RBAC de gamificación y `rbac.test.mjs` (G3 y G7).

---

## 9. Misiones institucionales y métricas de colegios

- **Misiones** (D38, mixtas): configurar la biblioteca, formar mediadores, activar grupos, hacer la primera experiencia MOOK, alcanzar cobertura de lectura, revisar evidencias, celebrar una actividad comunitaria y completar la evaluación de adopción.
- Cada misión se apoya en **evidencia institucional** que el servidor ya tiene:
  - grupos y membresías (`groups_db`, identidad);
  - revisiones MOOK;
  - métricas de Aula Viva e insights.
- **Sin PM personales para funcionarios.** La recompensa institucional es un mapa de madurez, badges de institución y desbloqueos de acompañamiento.
- **KPIs institucionales** (D41, capa institucional): activación docente, grupos activos, misiones completadas, retención del colegio y la alarma de «uso concentrado en un solo profesor».
- **EXISTE:** Aula Viva histórica y operacional, `insights.db` y rollups (agregados con alcance). **CONSTRUIR:** catálogo de misiones y su evaluación (G7).
- **G4B.5:** se sustituyen las métricas escolares simuladas por métricas reales.

---

## 10. Privacidad, accesibilidad, antifraude, flags y funcionamiento degradado

### Privacidad (D34 y D39, FIXED; DPIA GATED)

- Privacidad alta para todos por defecto. Perfil privado. Sin rankings individuales.
- **Minimización:** el ledger guarda identificadores y códigos de motivo, **nunca texto libre del menor** ni contenido de Leo.
- **Retención:** la del ledger se decide aparte de la rotación de 90 días de `events.db`, en la DPIA.
- **Logs:** sin `nombre_usuario` ni PII, siguiendo el patrón de `server/lib/logPrivacy.js`. Esto corrige lo que hacía el antiguo `addPoints`.
- **Equipos compartidos:** nada de la gamificación se persiste en `localStorage` salvo preferencias de UI (D54 cierra el legado).

### Accesibilidad (D40)

- WCAG 2.2 AA más criterios AAA seleccionados.
- Mensajes de estado anunciables (`role="status"`), sin depender de la animación, movimiento reducido y teclado completo.
- Se reutiliza el comportamiento de `RewardToasts` (atenuación, máximo 2 simultáneos y movimiento reducido).
- Prueba: `test:a11y:gamification`.

### Antifraude

- Las garantías de I1–I6 (§4).
- Topes (§5.2) y señales con revisión (§5.5).
- Ninguna fuente de grado D emite.
- Leo y oralidad no emiten.
- El validador de finalización (§2) es un requisito para emitir por lectura terminada.

### Flags y funcionamiento degradado

Los seis flags de la Doctrina §7 están en OFF por defecto y se leen por llamada.

| Componente caído | Comportamiento |
|---|---|
| Motor o ledger | La lectura, el progreso, MOOK y la biblioteca funcionan igual. La UI de gamificación muestra «no disponible»; los hechos se reconcilian después (I1) |
| WooCommerce | No se inicia ningún débito definitivo; las reservas se liberan |
| Revisión MOOK | Sin emisión MOOK; nada más cambia |

**Kill switch (D49):** global (`GAMIFICATION_ENABLED`) y por módulo. Detiene la emisión y el canje sin detener la lectura.

---

## 11. Resumen: qué existe y qué hay que construir

| Pieza | EXISTE en `f4836d1` | CONSTRUIR |
|---|---|---|
| Persistencia transaccional compartida entre réplicas | Sí (better-sqlite3, WAL, `IMMEDIATE`) | Archivo y módulo de gamificación |
| Append-only e idempotencia | Patrones probados en `econ_events`, `rights_versions` y `events` | Aplicarlos al ledger |
| Migraciones | `server/db/migrate.js` y migraciones de regalías | `server/gamification/migrations/0001_*` (G3, con autorización) |
| Flags con OFF por defecto | `server/lib/flags.js` y la convención de modos | Seis flags |
| Evidencia MOOK revisada | Sí | Gancho de emisión |
| Finalización de lectura validada | **No** (la declara el cliente) | Validador (G4) |
| Leo sin puntos | Sí (G0) | — |
| Motor de acceso con ventanas temporales y clase comercial | Sí | Puente de concesión de premios |
| Permiso editorial de premio | **No** | Según D51 (GATED) |
| WooCommerce de escritura | **No** (solo `store/v1` de lectura) | Cliente `wc/v3` (G6, GATED) |
| Familia vinculada a un menor | **No** (`parent` sin vínculo) | Vínculo y consentimiento (GATED) |
| RBAC de mediadores y coordinadores | Sí | Matriz de gamificación |
| Agregados institucionales | Sí (Aula Viva, insights) | Misiones |
| Feedback accesible | Sí (`RewardToasts`, confeti con movimiento reducido) | Integrarlo en la UI nueva |
