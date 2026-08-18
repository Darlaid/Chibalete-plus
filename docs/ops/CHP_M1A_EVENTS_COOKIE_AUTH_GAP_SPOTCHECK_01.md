# CHP-M1A-EVENTS-COOKIE-AUTH-GAP-SPOTCHECK-01

Fecha: 2026-08-18 (13:00–13:25Z). Tipo: spot-check productivo read-only + **una** acción real de lectura en la interfaz.
Objetivo: demostrar con evidencia que un evento legítimo del navegador, autenticado exclusivamente por la cookie de sesión canónica, es aceptado y persistido en `events.db` sin depender de `x-user-id`.

---

## A. Veredicto

**GREEN** — evento cookie-only demostrado de extremo a extremo.

- Confianza: **ALTA** (correlación por `eventId` exacto request → fila en `events.db`, más confirmación en log de edge y en el interceptor del navegador).
- Producción modificada: **no** (sin deploy, sin build, sin recreate, sin cambios de código/flags/compose/nginx/datos).
- Rollback usado: no aplica.

## B. Baseline productivo (Fase A)

| Ítem | Valor |
|---|---|
| Rama / HEAD | `chp/m1a-lu-analytics-401-loop-mitigation-01` / `7538306`, sincronizada con origin, working tree limpio |
| Ref productiva | `chp/backup-capacity-01b` = `8ed4e5e` |
| Imagen API | `chibalete/api:8ed4e5e` (imageID `8c99e8f4f191`) en **ambas** instancias |
| api_1 | `2799ef82e66a`, healthy, **restarts=0**, StartedAt 12:47:06Z |
| api_2 | `05754597c416`, healthy, **restarts=0**, StartedAt 12:44:02Z |
| Modos | `SESSION_AUTH_MODE=compat` en ambas · `METRICS_ENABLED=1` · `SESSION_LEGACY_ALLOW` ausente |
| Frontend | `chibalete/front:m1a-0ff76b6`, StartedAt 2026-08-16T17:52:34Z (intacto) |
| Edge | `nginx:alpine`, StartedAt 2026-08-11T01:33:31Z (intacto) |

Sin drift material respecto del baseline esperado → se continúa.

## C. Evento observado

**Fase B (evidencia natural): NO existía.** El último evento previo en `events.db` era del **2026-08-15T21:16:29Z**; filas desde DEPLOY-C (16/Ago 17:52Z) = **0**, y desde el fix events-gap (18/Ago 04:47Z) = **0**. La única sesión de navegador de la mañana (12:06Z) hizo `GET /api/auth/me` 200 y navegación administrativa, pero **no abrió ningún visor**, así que no emitió eventos de lectura. Los `POST /api/v1/events` visibles hoy en el edge son de **00:58–00:59Z, todos 401 — anteriores al fix** (la pérdida que el fix vino a detener).

**Fase C (acción mínima real):** existía una sesión de navegador ya autenticada de forma legítima (verificado sin teclear credenciales: `/api/auth/me` → 200, sin `chibalete_user_id` en localStorage, cookie no visible a JS). Acción ejecutada: **abrir un título ya en curso en Modo Guiado (`/leer/texto/…`), dejarlo abierto ~87 s y cerrarlo**. Ninguna otra acción; no se tocó "Reemplazar libro de Chibalete LU" ni configuración alguna.

Sesión de lectura resultante (identificadores truncados; sin PII):

| id | evento | elapsed_ms | progress | server_ts | event_id |
|---|---|---|---|---|---|
| 19530 | `text.session_start` | 0 | 0.0 | 13:15:39.096Z | `01M0AG6MVSSJST9GPQV69V8KY5` |
| 19531 | `text.session_heartbeat` | 14633 | 0.06 | 13:15:49.083Z | `01M0AG73513QA3S3JEMRMGGWJT` |
| 19532 | `text.session_heartbeat` | 44633 | 0.06 | 13:16:19.087Z | `01M0AG80EHR39MRT2KX82TW76Q` |
| 19534 | `text.session_end` | 87471 | 0.06 | 13:17:01.977Z | `01M0AG9A973Y4D63SPS3CHJ58B` |

`mode=text`, `schema_version=1`, `user#=27309a94354d`, `session#=8d778babec53`, `payload._source="native"`.

## D. Correlación HTTP → `events.db`

Cadena inequívoca para el evento canónico:

1. **Navegador** (interceptor `fetch`): `POST /api/v1/events` → **200**, `x-user-id` **ausente**; cuerpo con `eventId=01M0AG6MVSSJST9GPQV69V8KY5`, `event=text.session_start`.
2. **Edge** (13:15:39Z): `"POST /api/v1/events HTTP/2.0" 200 54`, referer del propio dominio.
3. **`events.db`**: `select … where event_id='01M0AG6MVSSJST9GPQV69V8KY5'` → **exactamente 1 fila** (id 19530), `server_ts` 13:15:39.096Z (coincide con el timestamp del edge al segundo).

**Sin duplicación por retry**: `select event_id, count(1) … group by 1 having count>1` sobre la sesión → **ninguno**; cada uno de los 4 `eventId` aparece 1 sola vez.

Conteos: `events.db` 19.496 (baseline previo, sin cambios desde 15/Ago) → **19.502** al cierre. Las 6 filas nuevas desde el fix se desglosan así:

- **4 filas `_source:"native"`** = canal canónico `/api/v1/events` (la sesión de la tabla anterior).
- **2 filas `_source:"legacy"`** = dual-write del canal `POST /api/analytics/events` (`session_start` id 19533 y `session_end` id 19535, con `sessionId` propios). También cookie-only y **200** en el edge, atribuidas al mismo usuario. No son duplicados por retry (distinto `event_id`, distinto `session_id`, distinto canal); es el comportamiento pre-existente de dos canales paralelos del navegador. Se documenta como límite para STATS, no se corrige aquí.

## E. Autenticación demostrada

- **6 POSTs a rutas de eventos en la sesión, todos 200 y todos con `x-user-id` ausente** (`anyHeaderOnEvents = 0` en el interceptor). Ningún 401/403/5xx en el camino de eventos.
- La identidad no pudo venir del header: con la imagen desplegada, `requireEventsWriteAuth` **rechaza `authMethod !== 'session'`** en compat (probado en vivo hoy: header-only → 401 en las 4 rutas). Un 200 en esa ruta implica necesariamente identidad derivada de la sesión firmada.
- `POST /api/progress/.../sync` → 200 sin header, y `POST /api/analytics/events` → 200 sin header (la mitigación 202-drop **no** interceptó al navegador legítimo porque llevaba cookie).
- Métricas post-acción, idénticas en ambas instancias y **totalmente atribuidas a los probes del deploy anterior**: `legacy_analytics_accept_drop=1`, `subject_mismatch=1`, `disabled=3`, `no_identity=1`, `revoked=1`. **`session_required_event_write` = 0** y la serie `legacy_x_user_id` **no se inicializó** → la acción del navegador no consumió ningún camino legacy.
- **`mode='lu'` desde la mitigación (12:44Z) = 0 filas** → los `202-drop` de LU **no** aparecen falsamente persistidos ni atribuidos.

### Consultas read-only utilizadas

```sql
-- esquema y volumen
select name, sql from sqlite_master where type in ('table','index');
select count(1) from events;
-- ventana desde el deploy (epoch-ms; server_ts NO es ISO)
select count(1) from events where server_ts >= 1787028420000;
-- correlación exacta
select id, event_id, schema_version, event, mode, user_id, content_id,
       session_id, client_ts, server_ts, elapsed_ms, progress_fraction, created_at
  from events where event_id = ?;
-- duplicación por retry
select event_id, count(1) n from events where session_id = ? group by 1 having n > 1;
-- contaminación por 202-drop
select count(1) from events where mode = 'lu' and server_ts >= 1787057040000;
```

Todas ejecutadas con `sqlite3.connect('file:…/events.db?mode=ro', uri=True)` sobre el archivo productivo, sin escribir, sin copiar, sin borrar. Evidencia en `/root/chp-m1a-events-spotcheck-01/`.

## F. Salud y regresiones

| Chequeo | Resultado |
|---|---|
| Health api_1 / api_2 | `ok` ambas, healthy |
| RestartCount | **0 / 0** — sin incremento (StartedAt sin cambios) |
| 5xx en edge (ventana) | **0** |
| Statuses `/api` en la ventana | 46×304, 15×200, 2×403 |
| Errores en logs API desde 13:10Z | 0 / 0 |
| Frontend / edge | StartedAt intactos, sin recreate |
| LU | sin tráfico okhttp en la ventana; mitigación 202-drop intacta y sin persistencia |

## G. Documento y commit/push

Documento: este archivo. Commit exclusivamente documental sobre la rama vigente (no divergida), sin arrastrar archivos ajenos.

## H. Límites y riesgos restantes

1. **Un solo usuario y un solo título**: se demostró el camino cookie-only para una sesión de Modo Guiado; no se ejercitaron Inmersivo/PDF/Álbum ni el visor accesible.
2. **Dos canales paralelos**: el navegador escribe el mismo ciclo de sesión por `/api/v1/events` (`_source:native`) y por `/api/analytics/events` (`_source:legacy`) con `sessionId` distintos. No es duplicación por retry, pero **STATS deberá deduplicar o elegir canal** al materializar.
3. **Hallazgo secundario (diagnóstico, no corregido en esta unidad)**: `GET /api/offline/assignment` fue la **única** request del navegador que envió `x-user-id` (200, con cookie válida presente, por lo que la autoridad siguió siendo la sesión y no incrementó el contador legacy). Contradice el invariante "0 emisores en el navegador" del guard estático; conviene revisarlo antes del drenaje segmentado, ya que un emisor vivo puede enturbiar la medición por segmento.
4. **Hallazgo secundario**: `GET /api/progress/item/:userId/:contentId` respondió **403** al propio dueño durante la apertura del visor (2×403 en la ventana). No bloqueó la lectura ni la sincronización (`POST …/sync` → 200), pero merece revisión aparte.
5. No se verificó materialización en `insights.db` (fuera de alcance, unidad posterior).
6. La acción se ejecutó desde una cuenta administradora, no desde un lector escolar; el camino de autenticación es el mismo, pero la evidencia de población real sigue siendo pendiente de tráfico natural.
7. ENFORCE sigue bloqueado por la app Android (sin CookieJar); esta unidad no lo altera.

## I. Próximo paso

**CHP-IDDB-M1-A-ANDROID-SESSION-MIGRATION-01** (único siguiente autorizado).

---

Esta unidad fue un spot-check. Producción permanece COMPAT/COMPAT en `chibalete/api:8ed4e5e`. No se activó ENFORCE, no se modificó código, imágenes, contenedores, flags, frontend, edge/nginx, datos ni uploads; la única escritura fue la que produjo la propia acción legítima de lectura en la aplicación.
