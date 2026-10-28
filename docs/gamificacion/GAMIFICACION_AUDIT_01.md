# GAMIFICACION-AUDIT-01 — Auditoría integral de gamificación y Puntos de Magia

**Fecha:** 2026-10-28 · **Baseline:** `aef5edc` (rama `chp/epub-mainfile-r1-release`, sincronizada con `origin`, contiene `origin/main` `7767c4f`; CI `security` y `content-rmw` en verde).
**Modalidad:** solo lectura de código. Cero cambios, cero escrituras, sin crear usuarios, eventos, saldos ni canjes.
**Límite de evidencia:** no se pudo leer el padrón de producción (consulta bloqueada por los permisos de la sesión). Todo lo que sigue se apoya en el código; en §F.6 se indica qué verificación de producción queda pendiente.

## A. Resumen ejecutivo
Chibalete+ **no tiene un sistema de gamificación en el servidor**. Hay mecanismos sueltos en el cliente, sin conexión entre sí:

1. **Puntos de Magia**:
   - Moneda que solo existe en la memoria de la pestaña (`user.puntos`). No se guarda en ninguna parte: `saveState('users')` sale sin escribir y el servidor no conoce el campo.
   - Se gana con Trivia (+1 por acierto, sin límite) y con Leo (token `[AWARD_POINTS:n]` sin tope real).
   - Se «gasta» en la Tienda (500 → «7 % OFF», 1000 → «25 % OFF») y en Trivia (arte digital simulado).
   - **El canje nunca produce un beneficio:** la solicitud queda en el `localStorage` del alumno, el administrador no la ve desde otro equipo y ningún código genera cupones.
   - WooCommerce solo se usa en lectura (catálogo).
2. **XP / racha / nivel del Modo Inmersivo** (RewardEngine). Es el mecanismo más elaborado:
   - funciona en una ruta productiva;
   - su estado vive solo en el `localStorage` del navegador;
   - envía al servidor solo telemetría (`level_up`, `streak_break`, `block_complete`).
3. **Señales sueltas:**
   - `libros_leidos` sube en memoria y se pierde al recargar;
   - `nivel_lectura` queda fijo en «Novato» desde el alta;
   - `racha_dias` está declarado y no se usa;
   - el confeti del álbum es solo visual;
   - la oralidad da un puntaje Levenshtein guardado en `localStorage`.
4. **No existen** logros, insignias ni medallas. MOOK guarda el progreso en el servidor, pero no da ninguna recompensa.

## B. Inventario con evidencia técnica
| # | Mecanismo | Código | Pantalla / ruta | Disparador | Reglas | API / persistencia | Antiduplicación | Estado |
|---|---|---|---|---|---|---|---|---|
| 1 | Saldo Puntos de Magia | `types/index.ts:38` `puntos?`; `services/dataService.ts:1960` `addPuntos`, :3467 `addPoints` | Perfil (`Perfil.tsx:297`), Tienda (:233), Trivia (:23) | Llamadas de Trivia, Chatbot, Tienda | Suma o resta sobre el objeto en memoria | **Ninguna**: `saveState('users')` hace `return` (:1010-1013); `this.users` se reemplaza con `GET /api/users`; el servidor no tiene el campo | Ninguna | **SIMULADO** (efímero) |
| 2 | Puntos por Trivia | `pages/Trivia.tsx:56` | `/trivia` (Navbar, todos los usuarios) | Respuesta correcta a una pregunta generada por IA | +1 por acierto; validación en el cliente | Saldo efímero (#1) | Sin límite ni enfriamiento | **FUNCIONAL PARCIAL** |
| 3 | Puntos por Leo | `server/leoOrchestrator.js:804-808` (prompt); `components/Chatbot.tsx:28-31`, :388-395 | Chatbot montado en `Layout.tsx:38` (todas las rutas protegidas), Bitácora, VisorAlbum | El modelo escribe `[AWARD_POINTS: n]` | «Máximo 5» solo en el texto del prompt; el cliente acepta cualquier `n > 0` | Saldo efímero; el servidor no filtra el token (`_TOKEN_REGEX` en `leoEvidenceService.js:54` está definido y no se usa) | Ninguna | **FUNCIONAL PARCIAL** (sin control) |
| 4 | Canje en Tienda (500 / 1000) | `pages/Tienda.tsx:18-31`, :204-216, :247-248; `dataService.redeemCoupon` :3479 | `/tienda` (todos los usuarios) | Botón «Canjear» | Resta los puntos y crea una entrada de diario `reward_request` («Pendiente de código») | `localStorage chibalete_journalEntries`; sin endpoint | `id = req-${Date.now()}`; ninguna | **SIMULADO** |
| 5 | Aprobación de canjes | `pages/AdminRecompensas.tsx:23-27`, :84-86; `dataService.processRewardRequest` :3036-3052 | `/admin/recompensas` (admin) | Aprobar o rechazar | Aprobar solo cambia el estado (el aviso «cupón generado» es falso). Rechazar devuelve los puntos buscando `Costo: N`, texto que `redeemCoupon` nunca escribe | localStorage del navegador del administrador | — | **SIMULADO / roto** |
| 6 | Arte digital en Trivia | `Trivia.tsx:11-15` (`MOCK_REWARDS`, imágenes picsum, 500 c/u), :62-76 | `/trivia` | «Canjear» | Resta los puntos; «Se ha guardado en tu perfil» es falso | Nada | — | **SIMULADO** |
| 7 | Productos con precio en puntos | `pages/AdminProductos.tsx:17,64,164-171`; `types` `precio_descuento_puntos`; `storeOrders` | `/admin/productos` (admin) | Formulario | Precio en puntos que nadie consume | `localStorage` (`dataService.ts:284-285`) | — | **INACTIVO** |
| 8 | «Costo (Puntos)» de contenido | `SubirContenido.tsx:3413`; `Biblioteca.tsx:517-519` | Editor de contenidos | — | Solo se muestra | — | — | **INACTIVO** |
| 9 | Catálogo WooCommerce | `server/lib/wooCatalog.mjs:62` (`wc/store/v1/products`); `server.js:11924-11933` `GET /api/store/catalog` | `/tienda` | Carga de la página | Lectura de la categoría `libros`; compra en el sitio externo | Caché por réplica; **sin escritura** de pedidos ni cupones (no hay `wc/v3`) | — | **PRODUCTIVO** (catálogo); sin relación con los puntos |
| 10 | XP / racha / nivel inmersivo | `engines/RewardEngine.ts:39-47` (10 XP base; multiplicador 1,0/1,5/1,75/2,0; ventana 30 s), :236-258, :109 y :286 (localStorage); `BlockEngine.ts`; `hooks/useRewardFeedback.ts`; `components/RewardToasts.tsx` | `/leer/inmersivo/:id` (`VisorInmersivo.tsx:168-170, 440, 3135`) | Bloque completado | Nivel con umbral `25·(n−1)·n` XP, sin tope | `localStorage chibalete_rewards_<userId>`; telemetría `block_complete`/`streak_break`/`level_up` → `POST /api/analytics/events` (`server.js:10477`), que solo la registra | Ninguna (todo bloque suma) | **FUNCIONAL PARCIAL** |
| 11 | Modo trance | `engines/TranceEngine.ts` | Visor inmersivo | Racha ≥ 3 continua | Desvanece los controles (hasta 0,92 en 45 s) | — | — | **FUNCIONAL** (efecto visual, no recompensa) |
| 12 | `LEVELS` del visor inmersivo | `VisorInmersivo.tsx:60-66`, :148 | Visor inmersivo | — | 5 niveles por duración (Novato → Leyenda); `setCurrentLevel` nunca se llama | — | — | **SIMULADO** (fijo en 1) |
| 13 | `immersive_level` | `types:39`; `dataService.updateImmersiveLevel` :1978 | — | Ningún llamador | — | No persiste; el servidor no tiene el campo | — | **INACTIVO** |
| 14 | `nivel_lectura` | Alta con 'Novato' (`server.js:5612`, `b2cProvisioning.mjs:157`, `dataService.ts:1222`); un script CSV escribe `1` | Perfil (:295); campo público | Solo el alta | Nunca progresa | Padrón | — | **SIMULADO** (estático) |
| 15 | `libros_leidos` | `dataService.ts:2713-2722` (+1 al 100 %, deduplicado con `libros_terminados`) | Perfil (:292), estadísticas | Progreso al 100 % | +1 por libro | Solo en memoria; el servidor lo inicia en 0 y no lo actualiza | Sí (`libros_terminados.includes`), pero efímera | **FUNCIONAL PARCIAL** |
| 16 | Racha diaria | `types:43` `racha_dias` (sin uso); texto fijo `Home.tsx:399` «¡No pierdas la racha!» | Home | — | — | — | — | **SOLO PLANIFICADO** / texto simulado |
| 17 | Oralidad | `components/OralityModal.tsx` (BETA; Levenshtein 0-100; >90 verde, ≥70 amarillo) | Visor de texto | Lectura en voz alta | Puntaje sin recompensa | `localStorage` (`dataService.ts:924`) | — | **FUNCIONAL PARCIAL** |
| 18 | Confeti del álbum | `VisorAlbum.tsx:1466` (acierto, 100 partículas), :1531 (fin, 140) | `/ver/album/:id` | Acierto o fin de ruta | Respeta movimiento reducido | Nada | — | **FUNCIONAL** (solo visual) |
| 19 | MOOK / Experiencias | `server.js:2874-2897` `…/nodes/:nodeId/complete` (`mutateMook`) | `/experiencias` | Nodo completado | Progreso y «Completado» | **Servidor** (store MOOK) + eventos backbone | Del servidor | **PRODUCTIVO** (progreso); **sin gamificación** |
| 20 | Logros / insignias / medallas | — (la palabra «logros» solo aparece en un texto de Perfil :427) | — | — | — | — | — | **NO EXISTE** |

## C. Mapa de conexiones
```
                    ┌────────────── SERVIDOR ───────────────┐
 Lectura (progreso) ─────────────► progress_db  (canónico)
 MOOK (nodos) ───────────────────► mook store + eventos backbone
 RewardEngine ── telemetría ─────► /api/analytics/events (solo registro)
 Leo (prompt) ── «[AWARD_POINTS:n]» en la respuesta (sin filtrar) ──┐
 WooCommerce ◄── GET catálogo (solo lectura) ── /tienda            │
                    └───────────────────────────────────────┘      │
                    ┌────────────── NAVEGADOR ──────────────┐      │
 Chatbot ◄──────────────────────────────────────────────────────────┘
   └─► addPoints ─┐
 Trivia ─► +1 ────┼─► user.puntos (memoria; se pierde al recargar)
                  └─► Tienda/Trivia: resta ─► reward_request (localStorage) ─► AdminRecompensas (solo mismo navegador) ─► ∅ (sin cupón)
 Progreso 100 % ─► libros_leidos (memoria)
 BlockEngine ─► RewardEngine (XP/racha/nivel, localStorage) ─► Toasts / Trance
 Oralidad ─► puntaje (localStorage)        Álbum ─► confeti
                    └───────────────────────────────────────┘
```
- **Implementadas:**
  - Trivia → puntos;
  - Leo (token) → puntos;
  - puntos → solicitud de canje;
  - BlockEngine → RewardEngine → toasts, trance y telemetría;
  - progreso → `libros_leidos` en memoria.
- **No implementadas (solo sugeridas por textos o campos):**
  - puntos ↔ niveles, logros o insignias;
  - XP inmersivo → puntos, `immersive_level` o `nivel_lectura`;
  - MOOK, oralidad o comprensión → puntos;
  - racha de Home ↔ `racha_dias` ↔ racha de RewardEngine;
  - canje → cupón de WooCommerce;
  - arte digital → perfil.
- **Respuesta a §4 del encargo:**
  - **Los puntos son una moneda independiente**: no participan en ninguna progresión ni dependen de métricas de lectura o comprensión.
  - **Con Leo:** se conectan solo por el token.
  - **Con MOOK:** ninguna conexión.
  - **Datos y servicios:** no comparten datos ni servicios con otros mecanismos.

## D. Circuito actual de obtención y gasto
| Eslabón | Dónde ocurre | Dónde se rompe |
|---|---|---|
| Actividad | Trivia (acierto); conversación con Leo | La lectura real, MOOK, la oralidad y el modo inmersivo **no** dan puntos |
| Evento | Ninguno en el servidor; llamada directa a `dataService` | No hay evento de dominio ni registro en el servidor |
| Validación | Ninguna: el tope de Leo solo está en el prompt; Trivia se corrige en el cliente | Generación ilimitada y manipulable |
| Puntos otorgados | `user.puntos` en memoria | — |
| Saldo | Memoria de la pestaña | **Se pierde al recargar** (`saveState('users')` no escribe; `GET /api/users` lo reemplaza) |
| Tienda | `/tienda`: tarjetas fijas 500 → 7 % y 1000 → 25 %, sin relación con WooCommerce | El bono no está ligado a ningún producto ni a ningún cupón |
| Canje | `redeemCoupon`: resta y crea `reward_request` en el `localStorage` del alumno | La solicitud **no sale del navegador del alumno** |
| Beneficio efectivo | — | **No existe**: aprobar no genera un código; rechazar no devuelve los puntos (busca `Costo:`, que nunca se escribe); WooCommerce no recibe nada |

**Bonos de 500 y 1000:** son constantes de interfaz (`Tienda.tsx:247-248`). No existe ningún cupón de WooCommerce, ni API de cupones (`wc/v3`), ni código de descuento generado, ni mecanismo para usarlos en la «tienda física».

## E. Clasificación
- **PRODUCTIVO:** catálogo WooCommerce de solo lectura (#9); progreso MOOK, sin gamificación (#19).
- **FUNCIONAL PARCIAL:** XP, racha y nivel inmersivo (#10, en localStorage); Trivia (#2); puntos de Leo (#3); `libros_leidos` (#15); oralidad (#17).
- **FUNCIONAL, solo visual:** trance (#11); confeti del álbum (#18).
- **SIMULADO:** saldo de puntos (#1); canje en Tienda (#4); aprobación de canjes (#5); arte digital (#6); `LEVELS` (#12); `nivel_lectura` (#14); texto de racha (#16).
- **INACTIVO:** productos con precio en puntos y `storeOrders` (#7); costo en puntos de contenido (#8); `immersive_level` (#13); VisorInmersivoV2/ImmersiveRuntime (solo en desarrollo).
- **SOLO PLANIFICADO / NO EXISTE:** `racha_dias`; logros, insignias y medallas (#20); confeti de Trivia (comentario en :58).

## F. Riesgos y contradicciones
1. **Generación ilimitada.**
   - Un alumno puede pedirle a Leo que escriba `[AWARD_POINTS: 99999]`: el servidor no filtra el token y el cliente no lo limita (`Chatbot.tsx:28-31`).
   - Trivia suma +1 sin límite.
   - Impacto actual acotado, porque el saldo no persiste ni da beneficios; **sería crítico si se conectara a algo real**.
2. **Manipulación desde el frontend.** Todo el saldo y todas las comprobaciones (`redeemCoupon` :3483, `canjearRecompensa` :1970) están en el cliente; desde DevTools se pueden alterar.
3. **Inconsistencias de saldo.**
   - El saldo se pierde al recargar.
   - El objeto de `AuthContext` tras el login puede diferir del de `dataService.users`, así que el saldo mostrado puede quedar desfasado.
   - Escritura accidental: el renombrado de colegio hace `PUT /api/users/:id` con objetos completos de memoria (`dataService.ts:1366-1375`) y el servidor fusiona campos (`server.js:6079`), por lo que podría guardar el `puntos` que tenga en memoria el navegador del administrador.
4. **Canjes repetidos:** el saldo se restaura al recargar mientras la solicitud queda guardada, así que **el mismo saldo puede canjearse una y otra vez**. No hay idempotencia ni registro en el servidor.
5. **Promesas no cumplidas a menores.**
   - «El administrador… te enviará el código» (`Tienda.tsx:213`), «cupón generado» (`AdminRecompensas.tsx:27`) y «Se ha guardado en tu perfil» (`Trivia.tsx:71`) son falsos.
   - Hay un incentivo económico (7 %/25 % en la tienda física) dirigido a lectores menores que nunca se materializa.
6. **Datos de menores.**
   - Las solicitudes de canje (userId + texto) quedan en el `localStorage` de equipos que pueden ser compartidos en el colegio.
   - `addPoints` escribe `nombre_usuario` en la consola (`dataService.ts:3474`).
   - El prompt de Leo premia el «entusiasmo genuino» sin dejar rastro auditable.
   - **Pendiente:** verificar en producción, con autorización, si algún registro del padrón tiene `puntos`, `racha_dias` o `immersive_level` (solo recuento), y si se usan `/tienda` y `/trivia` (logs del edge).
7. **Incentivos pedagógicos contraproducentes.**
   - Se premian la velocidad (XP por bloque con multiplicador de racha de 30 s) y el acierto en trivia generada por IA, no la comprensión.
   - Los puntos de Leo dependen del criterio del modelo.
   - Existen dos «niveles» que no comparten escala (XP sin tope frente a 5 niveles por duración), además de `nivel_lectura` estático.
8. **Dependencias incompletas.** Tienda ↔ cupones, AdminProductos ↔ pedidos, arte digital ↔ perfil, `immersive_level` ↔ servidor: todas incompletas.

## G. Componentes reutilizables
- **RewardEngine + BlockEngine + RewardToasts + useRewardFeedback:** motor de XP, racha y nivel con feedback accesible (toasts con atenuación, límite de 2 simultáneos y movimiento reducido). Puede reutilizarse si el estado pasa a calcularse en el servidor.
- **Telemetría existente:** `level_up`, `streak_break` y `block_complete` en `eventContract.mjs`, y el backbone de MOOK (`experience_completed`). Sirven como eventos fuente para un futuro libro de movimientos en el servidor.
- **Progreso canónico** (`progress_db` y nuevos endpoints de progreso) y **MOOK** (`mutateMook`): fuentes fiables, ya en el servidor, para validar actividad.
- **Catálogo WooCommerce de solo lectura:** base para vincular beneficios con productos reales.
- **Puntaje de oralidad** (Levenshtein) y **confeti con movimiento reducido** (VisorAlbum): piezas de feedback reutilizables.
- **UI:** `PixelBadge`, `PixelProgressBar` y las tarjetas de canje de la Tienda.

## H. Deudas priorizadas
| Prioridad | Deuda |
|---|---|
| **P0** | Promesas de beneficio a menores que nunca se cumplen (Tienda, aprobación de canjes, arte digital). Decidir si se ocultan o se rotulan mientras no exista el circuito real |
| **P0** | Token de Leo sin control: el prompt otorga puntos, el servidor no filtra y el cliente no limita |
| **P1** | Saldo sin persistencia ni libro de movimientos en el servidor; canjes repetibles; devolución rota (`Costo:`) |
| **P1** | Solicitudes de canje en `localStorage` (datos de menores en equipos compartidos; invisibles para el administrador) |
| **P2** | Riesgo de escritura accidental de `puntos` vía `PUT /api/users/:id` con objetos completos |
| **P2** | `nivel_lectura` estático, `LEVELS` fijo, `immersive_level` sin uso, `racha_dias` sin uso: campos que aparentan una progresión inexistente |
| **P2** | RewardEngine solo en el navegador (se pierde al cambiar de dispositivo); `libros_leidos` efímero |
| **P3** | Código muerto: AdminProductos / `storeOrders` / `precio_descuento_puntos` / `unlockCost`; `console.log` con `nombre_usuario` |

## I. Recomendaciones de alcance (sin diseño de implementación)
1. **Antes de diseñar,** decidir la doctrina: si los puntos son una moneda canjeable con valor económico (requiere un libro de movimientos en el servidor, antifraude, consentimiento y un marco para menores) o un reconocimiento pedagógico sin valor monetario.
2. **Mientras tanto,** valorar una medida de contención limitada a la interfaz: retirar o rotular «próximamente» los canjes y mensajes que prometen beneficios, y desactivar `[AWARD_POINTS]` en el prompt de Leo. Requiere su propia unidad y autorización.
3. **Fuente de verdad:** cualquier sistema futuro debe calcularse en el servidor a partir de eventos ya existentes (progreso canónico, MOOK, telemetría inmersiva), nunca a partir del cliente ni del texto del modelo.
4. **Unificar** los conceptos de nivel y racha (XP inmersivo, `LEVELS`, `nivel_lectura`, `racha_dias`) en un solo modelo, o retirarlos.
5. **Relación con WooCommerce:** si habrá beneficios comerciales, definir antes la relación contractual y técnica (cupones de un solo uso emitidos por el servidor); hoy no existe ningún enlace.
6. **Datos de menores:** incluir la gamificación en la evaluación de privacidad (minimización, retención y equipos compartidos) antes de cualquier rediseño.

STOP: diagnóstico entregado; sin implementación.
