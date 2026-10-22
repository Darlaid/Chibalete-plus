# CHP-EDITORIAL-ROYALTIES-2026-01 — F3-A2 · Ingesta y atribución de eventos económicos

**Fecha:** 2026-10-22 · **Base:** F2-B en producción (`ffc563b`, evidencia `7b1299e`) · **Plan:** `PLAN_GENERAL_V1_1.md` §3.1, §4 y unidad 6 · **Decisiones:** `DECISIONES_F0C.md` (P3–P8, P12, §3)
**Modo:** implementación local, pruebas y CI. **Sin despliegue.** Flag `ECONOMIC_INGEST_MODE` apagado por defecto.
**Veredicto:** GREEN local.

## 1. Auditoría del pipeline existente

| Pieza | Hallazgo | Consecuencia para F3-A2 |
|---|---|---|
| `POST /api/v1/events` (`server.js`) | Lotes de hasta 50 eventos; `requireEventsWriteAuth` exige sesión firmada en compat y enforce; dedup por `event_id UNIQUE` (`INSERT OR IGNORE`) | Se reutiliza el endpoint, el guard y la deduplicación. No hay un segundo sistema de analítica |
| Validación del backbone (`eventsService.js`) | `EVENT_NAME_RX` exige `{modo}.{acción}` y `VALID_MODES` no incluye `epub` | `econ_tick` no pasa por esa validación: tiene la suya propia |
| Cutover canónico (`readingCanonical.mjs`) | `<modo>.session_start` se guarda como `reading_started`, con un payload que el registry v2 reconstruye campo a campo; EPUB no tiene sesión nativa | La atribución no puede ir en `session_start`: el servidor la registra con el primer `econ_tick` |
| Consumidores de `events` | Más de 10 lectores cuentan todas las filas, agrupan por modo o tienen topes de filas (100k, 200k, 20k). Con ~240 ticks por hora de lectura, los topes **descartarían los eventos reales más recientes** | **Decisión del responsable:** tabla propia `econ_events` en el mismo `events.db`, invisible a esos lectores |
| Rotación de archivo (`archiveRotation.mjs`) | Mueve y expira solo la tabla `events`, por `server_ts` y watermark | `econ_events` no rota ni expira, así que la evidencia económica se conserva |
| Respaldo (`stores.py`) | `events.db` se copia entero con la API de backup de SQLite | La nueva tabla queda respaldada sin cambiar el runner |
| Identidad | `authenticate` devuelve `authMethod: 'session'`; una cookie con un `x-user-id` distinto devuelve 401 (`subject_mismatch`) | El usuario sale de `req.auth`, nunca del cuerpo |
| Acceso y atribución | `decideContentAccess` (autoridad única) y `resolveCommercialAttribution` (F2-B: primero la regla pagada, después usuario, grupo y organización, después el id) | Se reutilizan sin cambios |
| Motor F3-A1 | Necesita `econ_tick` y `*.session_start` con `econAccess`, y exige `clockSkewToleranceMs` y `maxIngestDelayMs` | El lector entrega filas con esa forma y los parámetros de reloj confirmados |

## 2. Implementación

**Archivos:**
- `server/royalties/econEvents.mjs` (nuevo);
- `server/server.js` (helper `ingestEconTicks` y una rama en `/api/v1/events`);
- `server/eventsService.js` (expone la conexión compartida con `getEventsDb()`);
- dos suites de prueba y `package.json` (`test:royalties`).

**No cambian:** visores, frontend, `session_heartbeat`, progreso, estadísticas, el motor F3-A1, las reglas productivas, `royalties.db` y los derechos.

**Flujo con `ECONOMIC_INGEST_MODE=on`:**
1. Los `econ_tick` del lote se separan; el resto del lote sigue exactamente el camino de siempre.
2. **Identidad:** solo se acepta una sesión firmada (`authMethod: 'session'`). Un `userId` distinto en el cuerpo se rechaza (`user_mismatch`).
3. **Normalización** (`normalizeEconTick`):
   - comprueba el eventId ULID, el modo de V1 (`pdf`, `text`, `immersive`, `a11y`, `album`, `epub`), el `contentId` y el `sessionId` (sin `legacy-`) y un `clientTs` entero;
   - aplica los límites de reloj;
   - comprueba que `windowMs` esté entre 0 (excluido) y 2 min, las señales humanas y el audio: velocidad entre 0,25 y 4, y un avance del medio que no supere la ventana a esa velocidad;
   - **el payload se reconstruye campo a campo**, así que lo desconocido se descarta.
4. **Obra:** debe existir en el catálogo, y `decideContentAccess` debe permitir el acceso **en ese instante**.
5. **Persistencia** (`recordEconTicks`), en una transacción `IMMEDIATE` que serializa las réplicas sobre el mismo archivo:
   - la sesión técnica queda ligada a una obra y un modo (`session_mismatch` si no coinciden);
   - límite de 12 ticks por usuario y minuto;
   - deduplicación por `event_id` y por (usuario, sesión, evento, `client_ts`).
6. **Atribución:** con el primer tick de cada sesión, el servidor escribe `econ.session_start`, con un **id determinista** derivado de usuario, obra y sesión, y `econAccess = { ruleId, commercialClass, eligible, reason, candidateRuleIds, resolvedAt }`.
   - Se resuelve con F2-B en el instante del servidor y no se recalcula después, así que **no hay reclasificación retroactiva**.
   - El id determinista garantiza **una sola regla por sesión**, aunque dos réplicas reciban ticks a la vez.

**Tabla `econ_events`:**
- Columnas: `event_id` único, `event` ∈ {`econ_tick`, `econ.session_start`}, `mode`, `user_id`, `content_id`, `session_id`, `client_ts`, `server_ts`, `payload_json` y `created_at`.
- Triggers que **bloquean UPDATE y DELETE**.
- Se crea en el primer uso: **con el flag apagado no se crea** (comprobado).

**Actividad frente a conclusión:** `econ_tick` es la actividad declarada, ya acotada por el servidor. `econ.session_start` es el hecho de atribución. La elegibilidad (episodios y Q) solo la concluye `computeEconomicEpisodes`, bajo demanda.

**Lectura para el motor:**
- `readEconRows(db, {fromServerTs, toServerTs, userId, contentId})` devuelve las filas con la forma que espera el motor.
- `excludedUsersFromRows` deriva los usuarios excluidos de la atribución registrada (`USER_EXCLUDED`).
- `engineClockContext()` entrega al motor los mismos límites de reloj que usa la ingesta.

**Exclusiones (P7):**
- administradores y cuentas `_loadtest_marker`, a través de la lógica de F2-B;
- cuentas internas desde `ROYALTIES_INTERNAL_USER_IDS`, vacía hasta que exista la lista de negocio;
- **los mediadores no se excluyen por su rol**.

## 3. Parámetros técnicos

| Parámetro | Valor | Origen |
|---|---|---|
| Tolerancia de reloj (`clockSkewToleranceMs`) | 120 s | Confirmado por el responsable (F3-A2) |
| Retraso máximo de ingesta (`maxIngestDelayMs`) | 10 min | Confirmado por el responsable (F3-A2) |
| Cierre de la última ventana | Tick final parcial (`windowMs` < 15 s); el motor solo acredita franjas completas | Confirmado por el responsable (F3-A2) |
| Momento de la atribución | Primer `econ_tick` de la sesión | Confirmado por el responsable (F3-A2) |
| Almacén | `econ_events` en `events.db`, append-only, sin rotación ni expiración automática | Confirmado por el responsable (F3-A2) |
| Ventana máxima por tick | 2 min (los navegadores espacian los temporizadores con la pestaña oculta; el motor recorta cada ventana al tick anterior) | Técnico, F3-A2 |
| Frecuencia máxima | 12 ticks por usuario y minuto (≈ 3 sesiones simultáneas) | Técnico, F3-A2 |
| Suelo de la sesión | Inicio de la primera ventana, limitado al retraso máximo | Técnico, F3-A2 |
| Ventana de fusión, tope diario, umbral de 45 s, franjas de 15 s, pausa de 120 s, tope de escucha de 20 min, avance equivalente desactivado, desempate entre obras | Sin cambios | `rs-2026-01-v1` (F3-A1) |

## 4. Pruebas

| Suite | Entorno | Resultado |
|---|---|---|
| `econEvents` (unitaria, almacén, motor y rotación) | Windows y Linux | **62 ✓, 0 ✗** |
| `econIngestHttp` (servidor real, `enforce`, dos réplicas con el flag encendido y una con el flag apagado) | Linux | **23 ✓, 0 ✗** |
| `test:royalties` completo (F1-A, F2-A, F2-B y F3-A1 incluidos) | Linux (`node:20-bookworm`, `npm ci` sobre `git archive`) | verde |
| `test:identity`, `test:b2c`, `test:memberships`, `test:content-rmw`, `typecheck:baseline` | Linux | verde |
| `test:analytics` | Linux | 26 de 28 en verde. Dos fallas **preexistentes, idénticas en `7b1299e`**: `analyticsCanon` necesita `scripts/events-archive.mjs`, que no está versionado, y `AulaVivaGroupAnalytics` exige el hash de `StudentStatusPanel.tsx`. F3-A2 no toca `pages/` ni `components/` |

**CI de GitHub (`c650b5e`):**
- `identity-preflight`, que incluye `test:royalties` con las dos suites nuevas, salió en verde en el intento 2.
- El intento 1 falló en `retireSyntheticCohort.test.mjs`: el servidor de la prueba arrancó, pero `/api/health` no respondió en 60 s.
- En Linux, esa prueba pasa 4 de 4 veces con este árbol y también con la baseline; se trata como una intermitencia del runner.
- `content-rmw`, image-integrity y gitleaks-head salieron en verde.
- Los 5 jobs de `security` fallan igual que antes de F1-A.

**Cobertura de los 19 casos pedidos:**

| # | Caso | Dónde |
|---|---|---|
| 1 | Lector válido | HTTP [1] |
| 2 | Anónimo | HTTP [2] |
| 3 | Suplantación | HTTP [3] y unitaria [1] |
| 4 | Obra inexistente o inaccesible | HTTP [4] |
| 5 | Duplicados y fuera de orden | [2], HTTP [5] |
| 6 | Tiempo manipulado o excesivo | [1] (ventana, reloj, audio) y [3] (frecuencia) |
| 7 | Visual y audio atendido | [6] |
| 8 | Pausas y cierre | [6] |
| 9 | Cambio de modo | [7] (1 episodio, sin duplicar minutos) |
| 10 | Concurrencia entre obras | [7] |
| 11 | Regla pagada sintética | [5] y HTTP [1] |
| 12 | Regla gratuita, sin clasificar o piloto | [5] |
| 13 | Reglas simultáneas | [2] y [4] (réplicas) |
| 14 | Cuenta interna | [5] (y administrador y sintética) |
| 15 | Sin efecto retroactivo | [8] |
| 16 | `events.db` | [2], HTTP [1] y [7] |
| 17 | Archivo de eventos | [9] |
| 18 | Regresión de autenticación, catálogo, accesos y lectores | HTTP [7] y suites Linux |
| 19 | Compatibilidad con F1-A, F2-A, F2-B y F3-A1 | `test:royalties` |

## 5. Compatibilidad

- **F2-B:** se usa la misma `resolveCommercialAttribution`. Las 22 reglas productivas no se tocan; mientras sigan `unclassified`, ningún episodio real será pagado. Las reglas pagadas solo existen en los temporales de prueba.
- **F3-A1:** el motor no cambia. `econ.session_start` cumple su contrato (`*.session_start` con `econAccess` y el mismo modo que los ticks), y sus dos tolerancias obligatorias vienen de `engineClockContext()`.
- **F2-A:** `decideContentAccess` incluye el gate de derechos (que sigue en `off`), y la elegibilidad de la obra se pasa al motor (`eligibleContentIds`) en F3-B.
- **Réplicas:** las dos API comparten `events.db`. La transacción `IMMEDIATE`, el `busy_timeout` existente y los ids deterministas evitan dobles atribuciones; probado con dos conexiones y dos servidores reales.

## 6. Riesgos y deudas

1. **La actividad la declara el cliente.** El servidor acota el tiempo al reloj real: límites de reloj, ventana máxima, avance del audio y recorte al tick anterior en el motor. Aun así, un cliente modificado puede fingir presencia dentro del tiempo real transcurrido. La mitigación son las anomalías de P12 en F3-B. No es una prueba de lectura humana.
2. **Primer tick fuera de orden:** si llega antes un tick posterior, el suelo de la sesión queda más tarde y la ventana anterior se pierde (efecto conservador).
3. **Coste:** cada petición con ticks evalúa `decideContentAccess` una vez por obra. F3-A3 debería agrupar ticks (por ejemplo, envíos cada 30–60 s) y medir el rendimiento con carga.
4. **Retención de `econ_events`:** crece sin rotación (unas 240 filas por hora de lectura). Hay que fijar su política de conservación y de tamaño del respaldo antes de F6. No se borra nada automáticamente.
5. **P7:** la lista de cuentas internas sigue pendiente; `ROYALTIES_INTERNAL_USER_IDS` está vacía.
6. **LU/Android, MOOK, podcast y vídeo:** se rechazan (`mode_not_included`), en coherencia con P10.
7. **Mediadores sin regla:** su acceso no viene de una regla, así que quedan `NO_COVERING_RULE` y no son elegibles (criterio F2-B).
8. **Desviación del plan §3.1** («un nombre de evento en `events`»): la tabla propia la aprobó el responsable para no alterar métricas. Mismo archivo y mismo respaldo; sin base nueva.
9. **Encendido en producción:** sin F3-A3 nadie emite `econ_tick`, así que el despliegue de F3-A2 debe hacerse con el flag apagado.
10. **Deuda ajena:** las dos fallas preexistentes de `test:analytics` (§4).
