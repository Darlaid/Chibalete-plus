# GAMIFICACION — Doctrina V1 (formalización de GAMIFICACION-DOCTRINA-01)

**Unidad:** GAMIFICACION-G1-01 · **Fecha:** 2026-10-29 · **Baseline de código:** `f4836d1` (G0 en producción, `GREEN_PROD`).
**Fuente:** `docs/gamificacion/GAMIFICACION_DOCTRINA_01_FUENTE_APROBADA.md` (sha256 `1625f60c…b5a7d`), contrastada con `GAMIFICACION_AUDIT_01.md` y con el código.
**Naturaleza:** documento de especificación. No autoriza implementación ni despliegue.

Documentos hermanos: [`GAMIFICACION_CONTRATOS_V1.md`](GAMIFICACION_CONTRATOS_V1.md) (contratos funcionales) y [`GAMIFICACION_IMPLEMENTACION_V1.md`](GAMIFICACION_IMPLEMENTACION_V1.md) (secuencia).

---

## 1. Alcance de la aprobación

La fuente registra que la dirección expresó **conformidad con la orientación general y con las decisiones recomendadas**. **No son 54 votos individuales diligenciados.** De ahí salen tres reglas de lectura para este documento:

1. **Recomendación única.** Cuando la fuente recomienda una sola opción (p. ej. D02 = B), esa opción se registra como aprobada.
2. **Recomendación con alternativas.** Cuando la fuente recomienda dos opciones (p. ej. D05 = «B/D»), solo queda aprobado lo que ambas tienen en común, que en general son las opciones descartadas. **La elección entre las alternativas queda ABIERTA** y se registra en §6. G1 no la resuelve.
3. **Cifras y fechas.** Toda cifra (PM, precios, topes, vigencias) y toda fecha del roadmap son **experimentales**. La fuente lo dice expresamente: «no como tarifa aprobada», «pilotar, no aprobar todavía», «no un compromiso de fechas».

### Clasificación

| Clase | Significado | Efecto en la implementación |
|---|---|---|
| **FIXED** | Principio o regla aprobada | Se implementa como invariante y se prueba. Cambiarla exige revisar la doctrina (D48 y D50) |
| **CONFIGURABLE** | Parámetro que requiere calibración | Vive en una configuración versionada (`ruleVersion`), nunca escrita en el código, y tiene valor por defecto conservador |
| **GATED** | Capacidad condicionada a derechos, privacidad, familia, regalías, presupuesto o integración externa | Detrás de su flag, en OFF, hasta que se cierre la condición nombrada |

Una decisión puede tener **componentes** de más de una clase. Por ejemplo, D19 fija el techo del 15 % (FIXED), pero su activación depende de Woo y de la autorización adulta (GATED). La matriz da la clase principal y los componentes.

---

## 2. Principios no negociables (FIXED)

| ID | Principio | Invariante verificable |
|---|---|---|
| P1 | El progreso lector no se gasta | XP y logros no tienen operación de débito; el XP es monotónico |
| P2 | Los PM no se generan en el cliente ni por el texto de una IA | Ningún endpoint de cliente acepta un monto. Ningún texto de modelo produce un movimiento (G0 ya neutraliza `[AWARD_POINTS]`) |
| P3 | Toda emisión y todo canje tiene evidencia, idempotencia y trazabilidad | Cada movimiento lleva `source`, `sourceEventId`, `ruleVersion` y actor, con unicidad por fuente+evento |
| P4 | Nunca se premia la velocidad, la repetición artificial ni el tiempo de pantalla por sí mismos | La evidencia de grado D (§3) nunca emite XP ni PM |
| P5 | Por defecto no hay rankings públicos individuales de menores | No existe ninguna vista que ordene individuos sin opt-in autorizado |
| P6 | Regalías y gamificación comparten evidencia cuando sea útil, pero nunca el mismo libro | Almacén separado. La gamificación no escribe en `royalties.db`, `econ_events` ni `access_db` como movimiento económico |
| P7 | Ninguna recompensa se anuncia antes de poder entregarse | El catálogo visible se filtra por flags y disponibilidad real. Continúa la regla de G0 |

Complementos FIXED del texto doctrinal:
- **Gamificación con fallo seguro.** Si el motor, el ledger o WooCommerce fallan, siguen funcionando la biblioteca, la lectura, el progreso canónico y MOOK.
- **Sin borrados como rollback.** El rollback económico se hace siempre con movimientos compensatorios, nunca editando el ledger.
- **Evidencia en cuatro grados** (§3).
- **Separación de conceptos.** XP, nivel, logros, racha y PM son conceptos distintos, y «nivel» nunca vuelve a usarse para la duración de una sesión.

---

## 3. Grados de evidencia (FIXED) y su estado real en el código

| Grado | Definición doctrinal | ¿XP? | ¿PM? | Fuente real hoy | Brecha detectada en G1 |
|---|---|---|---|---|---|
| **A**, verificada fuerte | Obra terminada según el progreso canónico; evidencia MOOK aprobada por una persona | Sí | Sí, con límites | MOOK: `reviewEvidence` (`server/lib/experienceStore.js:507`), con revisor tomado de la sesión y decisión `aprobado` \| `con_comentarios` | **La finalización de lectura no está verificada en el servidor.** `POST /api/progress/:userId/:contentId/complete` (`server/server.js:5195`) marca `isCompleted=true` y 100 % porque lo declara el cliente, sin contrastarlo con la actividad registrada. Hasta que exista un validador de finalización (G4), la lectura terminada **no puede tratarse como grado A** |
| **B**, verificada estructural | Hitos reales de lectura, experiencia completada, actividad de Leo respaldada por un evento estructurado | Sí | Sí, con menor peso | Eventos canónicos de lectura (`readingCanonical.mjs`) y MOOK `experience_completed` | Los emisores MOOK y Leo al backbone están detrás de `EXPERIENCE_EVENTS_BACKBONE_ENABLED` y `LEO_EVENTS_BACKBONE_ENABLED`, apagados por defecto; `events.db` rota a los 90 días |
| **C**, probabilística | Oralidad automática, inferencia de comprensión, interacción con IA | Tal vez | No inicialmente | `OralityModal` (Levenshtein en el cliente), señales de Leo | Calculadas en el cliente o inferidas, así que no son evidencia emisora |
| **D**, superficial | Abrir pantallas, audio activo, clics, rachas rápidas, tiempo de sesión | **No** | **No** | `RewardEngine` (XP por bloque con multiplicador de 30 s) y `block_complete` | Debe retirarse o reformularse (G4B) |

---

## 4. Matriz de las 54 decisiones

Prioridades de la fuente: P0 bloquea la arquitectura o el cumplimiento, P1 bloquea el piloto, P2 se cierra durante el piloto. En la columna «Rec.», «ABIERTA» indica que la fuente recomienda alternativas y G1 no elige.

### 4.1 Estrategia y progresión

| ID | Decisión | Rec. fuente | Clase | Componentes / condición | Notas de contraste con el código |
|---|---|---|---|---|---|
| D01 | Objetivo primario | D, mixto, con aprendizaje y hábito por encima del uso bruto | **FIXED** | Pesos del cuadro: CONFIGURABLE | Cada KPI de uso necesita un KPI educativo espejo (D41) |
| D02 | XP | B, permanente | **FIXED** | — | Hoy el XP vive en el `localStorage` del inmersivo (`RewardEngine`); no es reutilizable como fuente de verdad |
| D03 | PM | C, híbrido comercial **gradual** | **FIXED** (dirección) | La parte comercial es GATED (D19, D23 y D35) | Se empieza por recompensas digitales (D42) |
| D04 | Nivel | C, híbrido XP + competencias | **FIXED** | Umbrales y competencias: CONFIGURABLE | No se puede subir de nivel solo repitiendo eventos fáciles. Hoy conviven tres «niveles» incompatibles (auditoría §F.7) |
| D05 | Racha | **ABIERTA: B semanal flexible o D meta personal** | **FIXED** (excluye la racha diaria rígida A) | Elegir B o D. Parámetros: CONFIGURABLE | No penaliza fines de semana ni ausencias; permite recuperarse. `racha_dias` está sin uso |
| D06 | Ranking de alumnos | **ABIERTA: C cooperativo o D ninguno** | **FIXED** (excluye el global A y el de aula B) | C sería opt-in para mediadores y GATED por privacidad | El detalle doctrinal dice «C, opt-in, nunca global infantil» |
| D07 | Q/R/S | **ABIERTA: B elegibilidad o D parcial (Q/R sí, S nunca para PM)** | **GATED** | Significado contractual, Finanzas + Editorial + Datos; activación de la ingesta económica | **Hallazgo:** Q y R se calculan **por obra, sin identificadores de lectores** (`server/royalties/economicEpisodes.mjs:413`), bajo demanda y solo con `ECONOMIC_INGEST_MODE=on` (hoy OFF; `econ_events` vacía). No sirven como elegibilidad individual. La única pieza reutilizable sería el criterio de **episodio cualificado** a nivel de usuario, y aun así compartiendo lógica, no el libro |
| D08 | Lectura finalizada da PM | C, rendimiento decreciente | **FIXED** | Curva y ventanas: CONFIGURABLE. Bloqueo técnico: validador de finalización (§3) | El detalle doctrinal dice «C/D» para la repetición de obra (ver §5) |
| D09 | MOOK aprobado da PM | A, sí | **FIXED** | Monto: CONFIGURABLE | **Pendiente:** decidir si `con_comentarios` cuenta como aprobado (§6) |
| D10 | Leo da PM | C, nunca al inicio; después B, evento validado | **FIXED** (C) | La transición a B es GATED (métricas de evidencia de Leo y madurez) | G0 ya elimina el token. El modelo nunca decide la cantidad |
| D11 | Oralidad da PM | **ABIERTA: D feedback o C logro** | **FIXED** (excluye A, PM directos) | C sería GATED por la validación de precisión entre variedades dialectales y discapacidad | Hoy el puntaje se calcula en el cliente: no es evidencia |
| D12 | Actividades offline | C, valida el docente | **FIXED** | El QR firmado («quizá») es una mejora posterior no aprobada | Sin fotos obligatorias |
| D13 | Límite de PM | D, diario + semanal | **FIXED** | Valores: CONFIGURABLE | Lo hace cumplir el servidor dentro de la transacción |
| D14 | Tope semanal del piloto | B, 200 (entre 120, 200 y 300) | **CONFIGURABLE** | Lo fija la simulación (Finanzas + Producto) | «Candidata principal», no una cifra aprobada |

### 4.2 Recompensas y comercio

| ID | Decisión | Rec. fuente | Clase | Componentes / condición | Notas |
|---|---|---|---|---|---|
| D15 | Avatares | D, mixto (gratis, PM y logros) | **FIXED** | Licencias de los activos: GATED | No exponen la foto real ni la identidad |
| D16 | Fondos | B, solo perfil (inicial) | **FIXED** | Licencias: GATED | El activo solo es accesible para su propietario |
| D17 | Contenido como premio | **ABIERTA: B temporal o D cortesía** | **GATED** | Contratos editoriales y derechos (D51), regalías (D52) | El acceso se concede con una regla de `access_db`, no desde la UI |
| D18 | Salas | **ABIERTA: A cosmética o B contenido** | **FIXED** (excluye C, funcionales) | B sería GATED por derechos | El servidor aplica el acceso |
| D19 | Cupones | D, escalonados 5/10/15 % | **FIXED** (techo: **nunca más del 15 %**) | Activación: GATED (D23, D35 y presupuesto) | Los niveles concretos son CONFIGURABLES dentro del techo |
| D20 | Precio del cupón del 5 % | B, 800 PM (piloto) | **CONFIGURABLE** | — | «Pilotar, no aprobar todavía» |
| D21 | Precio del cupón del 10 % | B, 1600 PM (piloto) | **CONFIGURABLE** | — | Ídem |
| D22 | Precio del cupón del 15 % | B, 2600 PM (piloto) | **CONFIGURABLE** | — | Ídem |
| D23 | Emisión en Woo | B, API al canjear, con fallback A (pregenerados) | **GATED** | Credenciales `wc/v3`, SLA de Woo, idempotencia local + Woo | **Hoy solo existe lectura pública `wc/store/v1`** con origen fijo (`server/lib/wooCatalog.mjs:28`); no hay credenciales ni escritura |
| D24 | Vigencia del cupón | B, 30 días | **CONFIGURABLE** | Fecha visible antes de canjear: FIXED | — |

### 4.3 Persistencia y transacciones

| ID | Decisión | Rec. fuente | Clase | Notas de contraste |
|---|---|---|---|---|
| D25 | Fuente de verdad | B, servidor | **FIXED** | — |
| D26 | Saldo | C, ledger + snapshot | **FIXED** | El snapshot se puede derivar y reconstruir desde el ledger |
| D27 | Ledger | B, append-only | **FIXED** | Patrón existente: triggers `RAISE(ABORT)` en `econ_events` y en `rights_versions` |
| D28 | Idempotencia | C, `source` + `eventId` | **FIXED** | Patrón existente: `event_id UNIQUE` + `INSERT OR IGNORE` (`server/eventsService.js`) |
| D29 | Canje | B, reserva → Woo → confirmación | **FIXED** | Un fallo de Woo no pierde PM |
| D30 | Reversos | B, compensación | **FIXED** | No hay «set balance» |

### 4.4 Experiencia, roles y privacidad

| ID | Decisión | Rec. fuente | Clase | Componentes / condición | Notas |
|---|---|---|---|---|---|
| D31 | Perfil | C, completo y progresivo | **FIXED** | — | Hoy el Perfil sigue mostrando «Puntos de Magia» (riesgo residual de G0) |
| D32 | Historial | C, movimientos explicados | **FIXED** | Copy: CONFIGURABLE | Motivo, fecha, fuente y estado |
| D33 | Notificaciones | C, configurables | **FIXED** | — | Con movimiento reducido; no bloquean la lectura |
| D34 | Privacidad del perfil del menor | C privado + D opt-in excepcional | **FIXED** (privado por defecto) | El opt-in es GATED (consentimiento autorizado) | — |
| D35 | Comercio de menores | C, autorización de un adulto | **GATED** | Identidad del adulto, consentimiento auditable y revocable | **Hallazgo:** no existe un vínculo verificable entre un adulto y un menor. `mediatorKind='parent'` existe (`server/server.js:5437`), pero no se asocia a ningún alumno. `fecha_nacimiento` es opcional |
| D36 | Docente | B, valida evidencia | **FIXED** | — | No puede fabricar saldo |
| D37 | Coordinador | C, KPIs + misiones | **FIXED** | — | `mediatorKind='coordinator'` existe. Sin detalle personal innecesario |
| D38 | Misiones del colegio | D, mixtas | **FIXED** | Catálogo: CONFIGURABLE | Sin premios económicos personales a funcionarios |
| D39 | Privacidad base | C, alta para todos | **FIXED** | DPIA/PIA: GATED (DPO/Legal) | Coherente con la imposibilidad de segmentar por edad de forma fiable |
| D40 | Accesibilidad | C, WCAG 2.2 AA + AAA selectivo | **FIXED** | Selección de criterios AAA: CONFIGURABLE | Se conserva el comportamiento de movimiento reducido existente (`RewardToasts`, confeti del álbum) |
| D41 | KPI principal | D, cuadro balanceado | **FIXED** | Umbrales y alarmas: CONFIGURABLE | Seis capas: pedagógica, motivacional, económica, integridad, equidad e institucional |
| D42 | Piloto | B, digital primero | **FIXED** | Cohortes, duración y tamaño: CONFIGURABLE | Al grupo de comparación no se le niega funcionalidad pedagógica |

### 4.5 Legado, gobernanza y derechos

| ID | Decisión | Rec. fuente | Clase | Componentes / condición | Notas |
|---|---|---|---|---|---|
| D43 | Trivia | C, eliminar | **FIXED** | Condición: rutas sin tráfico relevante (G4B.1) | G0 la dejó inerte |
| D44 | Niveles inmersivos | B, sesión configurable | **FIXED** | Duración y UX: CONFIGURABLE (G4B.4) | El valor por defecto de 40 s sigue en `LEVELS` |
| D45 | Código muerto de PM | C, eliminar tras la migración | **FIXED** | Condición: ningún consumidor (G4B.2 y G4B.3) | — |
| D46 | Presupuesto de PM | D, bolsa mensual + techo por usuario | **FIXED** (estructura) | Montos: CONFIGURABLE. Aprobación: Finanzas (GATED para lo comercial) | — |
| D47 | Caducidad de PM | A, nunca, durante el piloto | **CONFIGURABLE** | La política posterior al piloto queda pendiente (Legal + Finanzas) | Pasivo acumulado |
| D48 | Cambios de reglas | B, prospectivos | **FIXED** | — | `ruleVersion` por movimiento |
| D49 | Kill switch | C, global + por módulo | **FIXED** | — | Flags de §7 |
| D50 | Owner de la doctrina | D, comité + owner ejecutivo | **FIXED** | Nombres: pendientes (§6) | RACI por aprobar |
| D51 | Derechos del contenido-premio | **ABIERTA: B nuevo permiso o C solo contenido propio** | **GATED** | Contratos editoriales. B implica ampliar `RIGHTS_PERMISSIONS` (esquema de regalías) | Los permisos actuales (`server/royalties/rightsStore.mjs:23`) no incluyen un permiso de premio. `promo_fragments` no equivale a uno |
| D52 | Regalías del contenido-premio | C, por `commercialClass` / acuerdo | **GATED** | Acuerdos editoriales | Hoy, una regla con clase `courtesy` o `promo_authorized` nunca es económica (`commercialClass.mjs`). Si un acuerdo exige otra cosa, se decide caso a caso, no desde la gamificación |
| D53 | Datos históricos locales | B, ignorar (salvo evidencia fiable) | **FIXED** | — | No se migran los saldos de `localStorage` ni el XP del inmersivo |
| D54 | Solicitudes antiguas | C, informar y cerrar | **FIXED** | El texto del aviso queda por definir (UX/Legal) | Las solicitudes viven en `localStorage` de equipos posiblemente compartidos |

### 4.6 Recuento

| Clase principal | Decisiones | Total |
|---|---|---|
| **FIXED** | D01–D06, D08–D13, D15, D16, D18, D19, D25–D34, D36–D46, D48–D50, D53, D54 | **42** |
| **CONFIGURABLE** | D14, D20, D21, D22, D24, D47 | **6** |
| **GATED** | D07, D17, D23, D35, D51, D52 | **6** |
| **Total** | | **54** |

**Alternativas ABIERTAS** (FIXED solo en lo que excluyen): D05, D06, D11, D18. En D07, D17 y D51 la alternativa abierta se suma a la condición GATED.

---

## 5. Decisiones complementarias de las tablas de detalle

Las tablas de detalle de la fuente contienen recomendaciones que no tienen fila en D01–D54. Se registran porque también son doctrina aceptada:

| ID | Tema | Recomendación | Clase |
|---|---|---|---|
| DC-01 | Logros | D: combinación que privilegia la diversidad y el dominio; cada logro con su evidencia definida | FIXED (catálogo CONFIGURABLE) |
| DC-02 | Dificultad | B+C: atributo de la obra + adaptativa, separada del nivel personal | FIXED; los metadatos editoriales son una dependencia |
| DC-03 | Anomalías | B + límites automáticos: revisión, sin sanción sin trazabilidad | FIXED |
| DC-04 | Saldo insuficiente | C: frontend y backend, con el backend autoritativo | FIXED |
| DC-05 | API | B: endpoints de dominio con contratos versionados | FIXED |
| DC-06 | Versionado de reglas | B: `ruleVersion` por movimiento | FIXED (= D48) |
| DC-07 | Tienda | B: pestañas, sin confundir precio real con PM | FIXED |
| DC-08 | Rol de familia | C: consentimiento + comercio cuando aplique | GATED (= D35) |
| DC-09 | Soporte | Ticket con auditoría | FIXED (SLA CONFIGURABLE) |
| DC-10 | Orden del catálogo | Cosméticos → contenido → cupones | FIXED |
| DC-11 | Presupuesto | Peor caso modelado antes de abrir canjes comerciales | FIXED |

### Tensiones internas registradas (no resueltas por G1)

1. **Repetición de obra.** D08 recomienda «C» y la tabla de detalle dice «C/D» (rendimiento decreciente o ventana). Se trata como C con la ventana como parámetro CONFIGURABLE; la confirmación queda en §6.
2. **Ranking.** La tabla de detalle dice «C, opt-in» y D06 dice «C/D». D06 manda: queda ABIERTA.
3. **Evidencia A de lectura.** La doctrina presupone que el «progreso canónico» verifica la finalización y el código no lo hace (§3). No es una contradicción doctrinal: es una **condición técnica** registrada en G4.
4. **D07 frente a la realidad de Q/R/S.** B y D presuponen métricas por usuario que no existen (§4.1). Con el código actual, D07 se comporta en la práctica como **C (no usar)** hasta que exista un contrato formal de significado.

---

## 6. Decisiones pendientes y responsables

| # | Pendiente | Origen | Responsable (según la fuente) | Bloquea |
|---|---|---|---|---|
| 1 | Racha: B o D | D05 | Pedagogía | G4 (racha) |
| 2 | Ranking: C cooperativo o D ninguno | D06 | Pedagogía + Privacidad | G7 (vistas de aula) |
| 3 | Q/R/S: B o D, y contrato de significado | D07 | Finanzas + Editorial + Datos | Nada del núcleo (se puede operar sin Q/R/S) |
| 4 | Oralidad: feedback o logro | D11 | Pedagogía + Accesibilidad | G4 (logros de oralidad) |
| 5 | Contenido-premio: temporal o cortesía | D17 | Editorial + Legal | G5-B |
| 6 | Salas: cosméticas o contenido | D18 | Producto | G5 (salas) |
| 7 | Derechos del contenido-premio: nuevo permiso o solo contenido propio | D51 | Editorial + Legal | G5-B |
| 8 | Si MOOK `con_comentarios` cuenta como aprobado | D09 (hallazgo G1) | Pedagogía | G4 (fuente MOOK) |
| 9 | Owner ejecutivo y RACI del comité | D50 | Dirección | Cambios de reglas (D48) y apertura del piloto |
| 10 | DPIA/PIA de gamificación | D39 | DPO/Legal | G7 (piloto) y cualquier opt-in público |
| 11 | Mecanismo de identidad y consentimiento del adulto | D35 | Legal + Producto | G6 (cupones) |
| 12 | Presupuesto: bolsa mensual y techo por usuario | D46 | Finanzas | Canjes comerciales (G6) |
| 13 | Credenciales y SLA de WooCommerce (`wc/v3`) | D23 | Backend + Ecommerce | G6 |
| 14 | Calibración de topes y precios (simulación) | D14, D20–D22 | Finanzas + Producto | Apertura de canjes |
| 15 | Política de caducidad después del piloto | D47 | Legal + Finanzas | Fin del piloto |
| 16 | Texto del aviso de cierre de solicitudes antiguas | D54 | UX + Legal | G4B.2 |

---

## 7. Interruptores (FIXED como estructura; los nombres son una propuesta)

| Flag | OFF significa | Por defecto |
|---|---|---|
| `GAMIFICATION_ENABLED` | Todo oculto; la lectura es normal | OFF |
| `PM_EARNING_ENABLED` | Se muestran saldos e historial, pero no se emite | OFF |
| `PM_REDEMPTION_ENABLED` | Se puede ganar pero no canjear; la UI explica que no está disponible | OFF |
| `COMMERCIAL_REWARDS_ENABLED` | Cosméticos y contenido sí; cupones no | OFF |
| `WOO_COUPONS_ENABLED` | No se inicia ningún débito definitivo para cupones | OFF |
| `SCHOOL_MISSIONS_ENABLED` | Sin capa institucional, sin efecto sobre los alumnos | OFF |

Convención del repositorio: si la variable de entorno falta o es desconocida, vale OFF (igual que `ECONOMIC_INGEST_MODE` y los flags de `server/lib/flags.js`).

---

## 8. Valores experimentales de referencia (CONFIGURABLE, no aprobados)

Se conservan como **punto de partida de la simulación**. No son tarifas.

- **Tope semanal ordinario:** 120 (conservador), **200** (candidato) o 300 (amplio).
- **Precios de partida en PM:**

| Recompensa | Bajo | Base | Alto |
|---|---|---|---|
| Avatar común | 60 | 100 | 150 |
| Fondo de perfil | 80 | 150 | 220 |
| Avatar especial | 150 | 250 | 350 |
| Cuento o capítulo promocional | 250 | 400 | 600 |
| Sala temática | 350 | 600 | 900 |
| Cupón 5 % | 600 | 800 | 1000 |
| Cupón 10 % | 1200 | 1600 | 2000 |
| Cupón 15 % | 2000 | 2600 | 3200 |

- **Vigencia del cupón:** 30 días (candidato).
- **Criterio de inflación:** si un alumno promedio puede comprar el descuento máximo cada pocas semanas, la moneda está inflada.
- **Roadmap de la fuente** (nov-2026 a abr-2027): es una secuenciación, **no un compromiso de fechas**.
