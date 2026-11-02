# G4-UX-01 — Niveles, logros y progreso visible: contrato funcional

**Fecha:** 2026-11-02. **Base:** `8754a82` (G4-PERF `GREEN_CI_PERF_PILOT`). **Producción:** `secdeps-0a606c0`, XP y PM desactivados.
**Estado:** decisiones UX-1 a UX-7 incorporadas por la orden G4-UX-U0 (2026-11-02), según las recomendaciones de este documento. Ver el apartado final. Sin código de niveles, logros, endpoints, migraciones ni tablas.

Convención de este documento:

- **[APROBADO]** — decisión ya tomada por Dirección o por la doctrina.
- **[PROPUESTA]** — requiere aprobación editorial o pedagógica.
- **[HALLAZGO]** — hecho comprobado en el código.

---

## 0. Decisiones de partida

| | Decisión | Fuente |
|---|---|---|
| [APROBADO] | Primera evidencia MOOK aprobada de una obra: 30 XP (lectura 10 + reflexión 20). Segunda: 20. Tercera y siguientes: 0 | A7-A12-V3 §1 |
| [APROBADO] | Techo de 50 XP por obra y ciclo; ciclo único; sin relecturas remuneradas; `XP_RUTA = 0`; PM = 0 | A7-A12-V3 §1 |
| [APROBADO] | Sin XP por clics, permanencia, lectura pasiva ni IA sin revisión | A3, R-XP §5.3 |
| [APROBADO] | Nivel único y monotónico, `XP ≥ T_n ∧ obras ≥ k_n ∧ reflexiones ≥ r_n`; los dos primeros tramos con `r_n = 0`; sin dificultad, formato, edad ni curso | A8; `recognition.mjs:validateLevels` |
| [APROBADO] | Logros cualitativos: reconocen, no pagan. No dan XP ni PM | Reconocimiento lector §5.5 |
| [APROBADO] | Privado por defecto. Sin rankings de menores. El docente no ve XP individual por defecto | P5, D34, D06; Contratos §8 |
| [APROBADO] | PM y canjes fuera de esta unidad | Encargo |
| [APROBADO] | **Niveles y logros no generan XP.** Se derivan del ledger; nunca escriben en `gm_xp_entries` | Encargo; este diseño lo garantiza por construcción (§E.2) |

---

## A. Inventario de componentes existentes

### A.1 Backend (motor)

| Pieza | Estado | Uso en G4-UX |
|---|---|---|
| `ledger.getXp(db, userId)` | Existe. Suma los `award` no anulados | **XP total** (fuente única) |
| `gm_work_cycles` (`subject_ref`, `work_key`, `act`, `xp`) | Existe, append-only | Obras distintas (`act='reading'`), reflexiones (`act='reflection'`), XP por obra |
| `deriveWorkKey(subject, contentId)` | Existe. `work_key` es un HMAC por sujeto | Progreso por obra: el servidor recalcula la clave de las obras del propio lector. **La tabla no permite saber qué obra es sin la clave del sujeto** (privacidad por diseño) |
| `deriveSourceKey(subject, 'mook_review', …, evidenceId)` | Existe | Estado exacto de una evidencia: hecho registrado y su decisión |
| `recognition.deriveLevel(stats, levels)` | Existe, puro y probado | Nivel actual y lo que falta para el siguiente (`next.missing`) |
| `recognition.evaluateAchievements(stats, …)` | Existe, puro. Catálogo `ACHIEVEMENT_RULES_V1` con métricas `works`, `reflections`, `rereadWorks`, `routes`, `validated` | Logros |
| `gm_achievements` | Existe en el esquema; **nadie escribe en ella** | No hace falta en V1 (§E.2) |
| `getBalance` / `listMovements` (PM) | Existen | **No se usan.** PM fuera de alcance |
| Rutas HTTP de gamificación | **No existen.** `ledgerCore` [11] exige que `server.js` importe del motor solo `mookSource.mjs` y que el motor no registre rutas | Toda lectura pasa por una función exportada desde `mookSource.mjs`; la ruta vive en `server.js` |
| Anulación de XP (`kind='void'`) | `getXp` la descuenta, pero **ningún módulo la escribe** | Derivar al leer es coherente hoy (§E.2) |

### A.2 Frontend

| Pieza | Estado | Implicación |
|---|---|---|
| Ruta «Mi progreso» | **No existe** | Se crea |
| `engines/RewardEngine.ts` | **Vivo.** XP, racha y «nivel» cada 50 XP en el `localStorage` del inmersivo; toasts; alimenta `TranceEngine`, eventos de analítica (`streak_break`) y el promedio `avgPeakStreak` de `DashboardMediador` | **Conflicto directo:** un segundo XP y un segundo «nivel» sin ledger. Debe retirarse o renombrarse antes de mostrar el XP real (§G, U0) |
| `Perfil.tsx:295-297` | Muestra «Nivel» (`nivel_lectura`, estático) en un perfil **visible a otros** (`/perfil/:id`, con seguidores) y «Puntos de Magia» (`user.puntos`, inerte) al dueño | **Riesgo de privacidad y coherencia:** el nivel real nunca debe ir aquí. Retirar ambos (§G, U0) |
| `Home.tsx:382` | «¡No pierdas la racha!», sin datos de racha (D05 abierta) | Retirar el texto (§G, U0) |
| `VisorInmersivo` `LEVELS` («Nivel 1: Novato») | Duración de sesión | D44: no llamarlo «nivel». Renombrar a «sesión corta/media/larga» (§G, U0) |
| `/trivia`, `/tienda`, `/admin/recompensas` | Inertes tras G0 | Fuera de alcance |
| `pages/Experiencias.tsx` | Estados de entrega: enviado, ajustes solicitados, reenviado, revisado («Aprobada» / «Con comentarios») | **Fuente del estado pedagógico.** Mi progreso enlaza aquí; no duplica el detalle |
| `ProgressBar` (aula-viva), `PixelProgressBar`, `EmptyState`, pestañas de `review/`, `useReducedMotion`, `A11yReadingSettings` (OpenDyslexic, alto contraste), `A11ySkipLinks` | Existen | Reutilizables |
| `OutcomeDistributionBars` (agregados, «NO ranking») | Existe | Patrón para la vista del mediador |
| Llamadas a `/api/gamification*` | Ninguna | — |

---

## B. Modelo de niveles y umbrales [PROPUESTA]

### B.1 Escala

- Una obra aporta **30 XP** (una evidencia aprobada) o **50 XP** (dos).
- En el piloto, todo XP viene de la reflexión MOOK aprobada: cada obra reconocida tiene al menos una reflexión.
- Por tanto, `reflexiones − obras` = número de obras **profundizadas** (con segunda evidencia).
- `r_n` mide profundidad, no volumen. No exige un formato.

### B.2 Tabla

Nombres: una serie natural (semilla → árbol). No alude a edad, curso ni capacidad y funciona sin género gramatical. **Requiere aprobación editorial.**

| # | Nivel | XP (`T_n`) | Obras (`k_n`) | Reflexiones (`r_n`) | Equivalente aproximado |
|---|---|---|---|---|---|
| 1 | Semilla | 0 | 0 | 0 | Punto de partida (todos) |
| 2 | Brote | 30 | 1 | 0 | 1 obra |
| 3 | Raíz | 120 | 3 | 3 | 3 obras profundizadas o 4 con una evidencia |
| 4 | Tallo | 250 | 6 | 8 | 6 obras (4 profundizadas) a 9 con una evidencia |
| 5 | Rama | 450 | 10 | 14 | 10 a 15 obras |
| 6 | Árbol | 700 | 15 | 22 | 15 a 24 obras |

Propiedades verificables con `validateLevels`:

- Umbrales no decrecientes.
- Tramos 1 y 2 con `r_n = 0` (A8).
- Repetir una obra no sube de nivel: la tercera evidencia da 0 XP y no cuenta como obra nueva.

### B.3 Condiciones

- **[HALLAZGO] Techo real del piloto:** el nivel alcanzable está limitado por cuántas obras tienen una experiencia MOOK con producción declarada (`PRODUCTION.resourceRef`). Producción tiene hoy 0 evidencias y muy pocas experiencias.
- **Calibración:** fijar `T_n` y `k_n` de los tramos 3–6 **después** de contar ese catálogo por cohorte. Si hay menos de 3 obras elegibles, publicar solo los tramos 1–2 y mostrar «Pronto habrá más caminos» en lugar de un nivel inalcanzable.
- **Configuración:** los tramos viven en la regla activa (`gm_rule_sets`, junto a `recognition`) como `levels: [{ id, xp, works, reflections }]`. Un cambio de umbrales es una versión nueva de regla con aprobación (D48). No hay tabla nueva.
- **Monotonía:** como no existe escritura de anulaciones de XP, el nivel derivado no puede bajar. Si en el futuro se anula XP (fraude probado), hará falta persistir el piso (`floorIndex`). Eso es una unidad aparte (§E.2).

---

## C. Catálogo inicial de logros [PROPUESTA]

Criterios:

- Cada logro tiene una condición calculable con datos que ya existen en el ledger.
- Ninguno mide tiempo, velocidad, rachas ni comparación.
- Ninguno da XP.

| id | Nombre propuesto | Condición | Métrica | Alcanzable en piloto | Cambio técnico |
|---|---|---|---|---|---|
| `primera-obra` | Primera obra | `works ≥ 1` | existente | Sí | Ninguno (ya está en `ACHIEVEMENT_RULES_V1`) |
| `lector-reflexivo` | Lector reflexivo | `reflections ≥ 5` | existente | Sí | Solo configurar el umbral (`atLeast: null` hoy) |
| `tres-obras` | Tres mundos | `works ≥ 3` | existente | Sí, según catálogo | Añadir la regla al catálogo |
| `mirada-profunda` | Mirada profunda | Una obra con dos reflexiones aprobadas | **nueva:** `deepWorks` (obras con `act='reflection'` × 2) | Sí | Añadir la métrica a `summarizeRecognition` y `ACHIEVEMENT_METRICS` (función pura y prueba) |

Logros de V1 que **no** se muestran en el piloto por ser inalcanzables:

- «Volver a una obra»: sin ciclo 2.
- «Ruta recorrida»: `XP_RUTA = 0`, no deja fila.
- «Lectura compartida»: depende de G7.
- «Exploración» y «Varios formatos»: faltan metadatos del catálogo.

Regla de producto: **no mostrar logros bloqueados que el lector no puede conseguir**, para evitar frustración y presión.

Textos de logro (borrador, para revisión editorial): se describe lo que hizo la persona, nunca puntos.

- Primera obra: «Compartiste lo que pensaste de tu primera obra».
- Mirada profunda: «Volviste a pensar en una obra y escribiste algo nuevo».

---

## D. Especificación de pantallas

### D.1 Ubicación

- **Ruta privada `/mi-progreso`** (solo la persona autenticada; sin `:id`).
- **Entradas:**
  - un acceso «Mi progreso» en `Perfil` **solo para el propio perfil**;
  - un enlace desde `Experiencias` tras una entrega aprobada.
- **Nunca en `/perfil/:id` visible a terceros.** El nivel no es un dato social.
- **Lector (alumno):** pantalla completa.
- **Mediador:** no tiene Mi progreso de alumnos (§D.6).

### D.2 Estructura de la pantalla del lector (de arriba abajo)

**1. Tarjeta de nivel**
- Contenido: nombre del nivel, icono decorativo (`aria-hidden`) y XP total: «120 XP».
- **Barra de avance** hacia el siguiente nivel, con texto siempre visible: «Te faltan 40 XP y 1 obra para llegar a Tallo».
- Si falta solo profundidad: «Vuelve a pensar en una obra que ya leíste».
- La barra muestra **solo el XP**. Los demás requisitos van como lista corta con marca (✓ / pendiente), no como porcentajes.
- En el último nivel: «¡Llegaste a Árbol!», sin barra.

**2. Mis obras** (lista; una tarjeta por obra con actividad MOOK propia)
- Título de la obra.
- Estado (tabla D.3).
- Avance «30 de 50 XP» con dos marcas: «1.ª reflexión ✓ · 2.ª reflexión».
- Enlace «Ver mi entrega» → `Experiencias`.

**3. Mis logros**
- Solo los obtenidos, cada uno con su frase y la fecha (día).
- Debajo, como máximo **uno** «siguiente posible», solo si es alcanzable.

**4. Qué cuenta y qué no** (bloque plegable, lenguaje simple)
- «Ganas XP cuando tu mediador aprueba lo que escribiste sobre una obra. Leer, abrir páginas o usar a Leo no da XP».
- Responde a la pregunta del niño sin prometer premios.

**Nunca aparecen:** Puntos de Magia, canjes, rachas, tiempo leído, comparación con otros ni «puesto».

### D.3 Estados de una obra

| Estado | Condición (servidor) | Texto (borrador) | XP mostrado |
|---|---|---|---|
| Sin actividad | Obra sin experiencia MOOK con producción declarada | (no aparece en la lista) | — |
| Empezada | Run sin entrega | «Empezaste esta experiencia» | 0 de 50 |
| En revisión | Evidencia `SUBMITTED`/`RESUBMITTED` | «Tu mediador está revisando lo que escribiste» | sin cambio |
| Con ajustes pedidos | `REVISION_REQUESTED` | «Tu mediador te dejó una sugerencia» | sin cambio |
| Reconocimiento en camino | Evidencia aprobada sin hecho registrado aún (hasta un barrido, 15 min) | «¡Aprobada! Tus XP aparecerán en unos minutos» | sin cambio |
| Reconocida | Hecho `awarded`; actos en `gm_work_cycles` | «Reconocida» | 30 de 50 |
| Completa | Dos reflexiones reconocidas | «¡Obra completa!» | 50 de 50 |
| Aprobada sin XP | Hecho con decisión distinta de `awarded`, evidencia anterior al corte o tercera evidencia | «Aprobada. Esta entrega cuenta para tu aprendizaje, pero no suma XP» | sin cambio |

**Regla de privacidad:** el motivo concreto (`rejected_*`, exclusión, retirada legal) **no se muestra al menor**. Una exclusión es invisible: la persona excluida no ve la sección (§F).

### D.4 Estados globales

- **Cero XP:**
  - nivel Semilla, barra vacía, sin tono de fracaso;
  - texto: «Tu camino empieza aquí. Cuando escribas sobre una obra y tu mediador lo apruebe, verás crecer tu semilla»;
  - un botón «Ver experiencias».
- **Sin actividades elegibles** (la cohorte no tiene experiencias con obra declarada): «Todavía no hay experiencias que sumen XP para ti. Puedes seguir leyendo en la Biblioteca». Sin barra.
- **Gamificación apagada** (sin flag): la ruta no existe y no hay enlaces.
- **Error de lectura:** «No pudimos cargar tu progreso. Tu avance está guardado». Nunca mostrar 0 XP por un error.

### D.5 Accesibilidad e infancia (7–11 años)

- **Teclado:** orden lógico, foco visible y ninguna acción solo por gesto. La lista de obras es una lista semántica (`ul`/`li`) con enlaces reales.
- **Lector de pantalla:**
  - la barra es `role="progressbar"` con `aria-valuenow`/`aria-valuemax` y `aria-valuetext="120 de 160 XP para Tallo"`;
  - los iconos son decorativos;
  - el logro nuevo se anuncia una vez con `aria-live="polite"`.
- **Contraste:**
  - AA como mínimo (4,5:1 en texto);
  - el estado nunca se comunica solo por color (texto + icono);
  - compatible con alto contraste y OpenDyslexic (`A11yReadingSettings`).
- **Movimiento:** la celebración de un logro o nivel nuevo es estática si `useReducedMotion`; sin confeti obligatorio ni sonido automático.
- **Lenguaje:**
  - frases cortas, segunda persona, sin jerga («XP» se explica una vez en «Qué cuenta»);
  - sin urgencia («no pierdas», «solo hoy») ni comparación;
  - números en cifras.
- **Móvil:**
  - una columna con la tarjeta de nivel arriba;
  - objetivos táctiles ≥ 44 px;
  - sin scroll horizontal (no reutilizar las filas horizontales de Home aquí).
- **Equipos compartidos:** nada se guarda en `localStorage` (Contratos §10). Todo viene del servidor al abrir.

### D.6 Vista del mediador (sobria)

**[APROBADO]** El docente no ve XP, nivel ni logros individuales (Contratos §8).

**[PROPUESTA]** Bloque «Reconocimiento en el grupo» dentro de Aula Viva del grupo que media, solo con **agregados** y el patrón de `OutcomeDistributionBars`:

- entregas pendientes de su revisión (accionable: enlace a `ProduccionesTab`);
- número de estudiantes con al menos una obra reconocida;
- obras del grupo con experiencia que suma XP (y las que no, para que sepa dónde crear actividad).

**Supresión:** con menos de 5 estudiantes en el grupo, mostrar «Datos insuficientes» para evitar reidentificación.

**Sin:** lista ordenada, nombres junto a XP, niveles por alumno ni promedios de XP.

**Coordinador:** nada en esta unidad (KPIs institucionales, G7).

---

## E. Contratos técnicos mínimos

### E.1 Separación de conceptos

| Concepto | Qué es | Dónde vive | Quién lo escribe | Visible al lector |
|---|---|---|---|---|
| Evidencia pedagógica | Lo que escribió y la revisión | `mook_db.json` (`evidence.review`) | Lector y mediador | Sí (Experiencias) |
| XP otorgado | Reconocimiento de evidencia aprobada | `gm_xp_entries` + `gm_work_cycles` | Solo el motor (ganchos y reconciliador) | Sí, total y por obra |
| Nivel derivado | Función pura de XP, obras y reflexiones | **No se guarda**; se calcula al leer con los tramos de la regla activa | Nadie | Sí |
| Logro obtenido | Función pura de las mismas métricas | **No se guarda en V1**; se calcula al leer | Nadie | Sí, solo los obtenidos |
| Puntos de Magia | Moneda, inactiva | `gm_pm_*` (vacías) | Nadie hoy | **No** |

### E.2 Por qué no hace falta tabla ni escritura nueva

- Nivel y logros dependen solo de XP, obras y reflexiones, que ya están en el ledger.
- Sin escritura de anulaciones, esas métricas solo crecen: el resultado derivado es estable y monotónico.
- Calcular al leer garantiza por construcción que **nivel y logros no generan XP** y que no hay un segundo origen de verdad.
- **Persistencia diferida (unidad futura, solo si se aprueba):**
  - escribir `gm_achievements` (ya existe) en la misma transacción que `recordWorkRecognition` cuando:
    - (a) exista anulación de XP, para conservar lo ya concedido (Contratos §5: anulación prospectiva), o
    - (b) se necesite la fecha exacta de obtención;
  - hasta entonces, la fecha mostrada es el día del hecho que cruzó el umbral (`occurred_at`, ya truncado a día).

### E.3 Lectura propia: un único endpoint

**[PROPUESTA]** `GET /api/me/progress`. Sin `userId` en la ruta: el sujeto es la sesión, de modo que no hay IDOR posible.

- **Autenticación:** la habitual del lector (`requireUserAuth`).
- **Si `GAMIFICATION_ENABLED` está apagado:** `404`.
- **Si `XP_EARNING_ENABLED` está apagado:** `{ enabled: false }` y la UI no muestra la sección.
- **Persona excluida o sin sujeto:** respuesta de cero XP idéntica a la de alguien nuevo. **No se revela** la exclusión.
- **Implementación:**
  - `server.js` define la ruta y pasa lectores inyectados (`readMook`, `workRefOf`);
  - el cálculo es una función de solo lectura exportada desde `mookSource.mjs` (o desde un módulo nuevo **si** se amplía la guarda `ledgerCore` [11], que hoy solo permite importar `mookSource.mjs`; preferible no ampliarla);
  - abre la base en solo lectura y sin transacción de escritura;
  - para las obras, calcula `deriveWorkKey` de las obras con evidencia propia en `mook_db` y consulta `gm_work_cycles`;
  - para los estados, usa `deriveSourceKey` por evidencia.

Respuesta:

```json
{
  "enabled": true,
  "xp": 120,
  "level": { "id": "raiz", "index": 2,
             "next": { "id": "tallo", "xpTarget": 250, "missing": { "xp": 130, "works": 3, "reflections": 5 } } },
  "works": [
    { "contentId": "c-123", "title": "…", "xp": 30, "ceiling": 50,
      "reflections": 1, "state": "recognized", "experienceId": "exp-…" }
  ],
  "achievements": [ { "id": "primera-obra", "day": "2026-11-20" } ],
  "nextAchievement": { "id": "mirada-profunda" },
  "ruleVersion": "…"
}
```

- `state` ∈ `started | in_review | revision_requested | pending_recognition | recognized | complete | approved_no_xp`.
- Sin motivos de rechazo, sin `subject_ref`, sin PM, sin datos de otras personas.

### E.4 Agregado del mediador

**[PROPUESTA]** Sin endpoint nuevo si es posible.

- **Primera opción:** añadir los tres contadores de §D.6 a `GET /api/groups/:id/analytics-summary` o al diagnóstico de grupo existente, con el mismo `requireReviewScope` y la supresión de grupos menores de 5.
- **Si ninguno admite el campo sin romper su contrato:** un `GET /api/groups/:id/recognition-summary` de solo agregados.

### E.5 Lo que no se construye

- Ninguna migración ni tabla.
- Ningún endpoint de escritura.
- Nada en el cliente que calcule XP o nivel.
- Ningún uso de `RewardEngine` como fuente.
- Ninguna PM.

---

## F. Riesgos de accesibilidad y privacidad

| Riesgo | Mitigación |
|---|---|
| Nivel visible a terceros en `/perfil/:id` (hoy ya muestra `nivel_lectura`) | Ruta privada; retirar «Nivel» y «Puntos de Magia» de Perfil (U0) |
| Dos XP y dos «niveles» contradictorios (RewardEngine local frente a ledger) | Retirar el XP y el nivel de RewardEngine antes de mostrar el real; `avgPeakStreak` fuera del panel del mediador (U0) |
| Presión o ansiedad (logros bloqueados imposibles, urgencia, «racha») | Solo logros obtenidos y uno alcanzable; sin rachas; retirar «¡No pierdas la racha!» |
| Comparación entre niños | Sin rankings ni XP individual al docente; agregados con supresión < 5 |
| Revelar exclusión o retirada legal | Respuesta indistinguible de cero XP; sin motivos al menor |
| Inferir uso de modo accesible o formato | El nivel y los logros nunca dependen del visor ni del formato (A8) |
| Equidad: cohortes sin experiencias con obra no pueden avanzar | Estado «sin actividades elegibles»; calibrar los tramos por catálogo (§B.3) |
| Retraso de reconocimiento (hasta 15 min) leído como pérdida | Estado «Reconocimiento en camino» |
| Dispositivo compartido | Nada en `localStorage`; datos solo del servidor |
| Lector de pantalla y teclado | §D.5; añadir caso a `a11y-reader` / a11y lab cuando exista la UI |
| DPIA, aviso y supresión transversal (externas) | Siguen siendo obligación del responsable (A7-A12-V3 §4); esta UI no las resuelve. Mostrar XP a menores requiere el aviso de privacidad vigente |

---

## G. Plan de implementación en unidades pequeñas

Cada unidad se cierra con CI verde. Ninguna enciende flags ni activa XP.

| Unidad | Alcance | Depende de |
|---|---|---|
| **U0 — Limpieza de legados** | Perfil sin «Nivel»/«Puntos de Magia»; Home sin «racha»; `LEVELS` renombrados (D44); RewardEngine sin XP ni nivel visibles (conserva solo lo que necesita `TranceEngine`); sin `avgPeakStreak` en el panel del mediador. Prueba estructural tipo G0 | Aprobación de este documento |
| **U1 — Núcleo puro** | Tramos de nivel en la regla (`levels`, validados con `validateLevels`); métrica `deepWorks`; catálogo de logros del piloto; función de solo lectura `readProgress(db, userId, deps)` con pruebas de equivalencia contra el ledger, de exclusión invisible y de «no escribe» | Aprobación de §B y §C |
| **U2 — Endpoint propio** | `GET /api/me/progress` en `server.js` vía `mookSource.mjs`; pruebas de autorización (sin IDOR), flag apagado, persona excluida y datos sintéticos | U1 |
| **U3 — Pantalla Mi progreso** | Ruta privada, tarjeta de nivel, obras, logros, «Qué cuenta», estados §D.3–D.4; accesibilidad §D.5; sin `localStorage` | U2 y textos editoriales |
| **U4 — Agregado del mediador** | Contadores de §D.6 con supresión < 5, sin individuos | U1; decisión §E.4 |
| **U5 — Activación** | Fuera de G4-UX: acta, `approvalRef`, retirada del bloqueo de `mook_review`, `XP_EARNING_ENABLED` (A7-A12-V3 §4) | Orden expresa de Dirección |

---

## Decisiones (incorporadas por la orden G4-UX-U0, 2026-11-02)

La orden de Dirección G4-UX-U0 pide incorporar UX-1 a UX-7. Se registran tal como las recomendaba este documento. Acta formal y `approvalRef` pendientes, como en A7-A12-V3 §3.

| # | Decisión | Estado |
|---|---|---|
| UX-1 | Estructura de niveles de §B.2 | **Aprobada** |
| | Semilla (0/0/0) y Brote (30/1/0) | **Definitivos** |
| | Raíz (120/3/3), Tallo (250/6/8), Rama (450/10/14) y Árbol (700/15/22) | **Provisionales**: se calibran tras contar las obras con experiencia MOOK y producción declarada por cohorte (§B.3). Hasta entonces no se publican si son inalcanzables |
| | Nombres de nivel | **Provisionales**: revisión editorial (UX-7) |
| UX-2 | Catálogo de §C: Primera obra, Lector reflexivo (umbral 5), Tres mundos y Mirada profunda (métrica `deepWorks`) | **Aprobado.** El umbral 5 es **provisional** y se revisa con los datos del piloto |
| UX-3 | Ruta privada `/mi-progreso`; nivel y PM fuera de Perfil | **Aprobada.** Retirada de Perfil en U0; la ruta, en U3 |
| UX-4 | XP, nivel y racha fuera de RewardEngine | **Aprobada.** Se ejecuta en U0 |
| UX-5 | Agregados del mediador con supresión de grupos < 5 | **Aprobada** (U4) |
| UX-6 | Nivel y logros derivados al leer, sin persistir en V1 | **Aprobada** (U1) |
| UX-7 | Textos infantiles de estados, niveles y logros | **Provisionales**: borradores de §C y §D.3–D.4 hasta revisión editorial |

**No autorizado:** U1 a U4 sin una orden propia; U5 (activación de XP); PM; despliegue.
