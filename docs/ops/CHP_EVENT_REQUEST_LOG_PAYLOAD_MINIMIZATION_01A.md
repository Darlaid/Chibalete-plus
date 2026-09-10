# CHP-EVENT-REQUEST-LOG-PAYLOAD-MINIMIZATION-01A — La ruta de eventos ya no registra el cuerpo de la solicitud

**Fecha:** 2026-09-10 · **Rama:** `chp/mook-contract-00` · **Baseline:** `25d0a769b32d4cc57afdfd990f07f389ef281e0d` (cierra la brecha COMP-02 de `docs/ops/CHP_PRIVACY_SECURITY_AI_EVIDENCE_01A.md`)

| Campo | Valor |
|---|---|
| Veredicto | **GREEN-EVENT-REQUEST-LOG-PAYLOAD-MINIMIZED-LOCAL-AND-PUBLISHED** |
| Despliegue | **Ninguno.** Producción sigue en `ped01d-bef0afe`; M1 en drain. |
| Cambio | 6 inserciones / 3 supresiones en un solo handler; sin logger, middleware ni sanitizador nuevos. |

## 1. Ruta y logging encontrados

- Ruta: `POST /api/events` (`server/server.js`, handler tras `requireEventsWriteAuth`), consumida por el runtime inmersivo para eventos de aviso (`manifest_fail`, `tts_fail`, `blob_invalid`, …) y dual-escrita al backbone (`dualWriteSingleEventToBackbone` → `validateBackboneEvent` → `insertBackboneEvent`).
- Log responsable: `` log(`[EVENT] ${event} user=${userId} ts=… ${JSON.stringify(rest)}`) `` — serializaba el cuerpo completo restante (payload, ids, texto libre, claves desconocidas) en `stdout` mediante el `log()` de proceso (`console.log`).
- Otros logs de la ruta: `[EVENTS_V1] dual-write event: accepted=… dedup=…` (contadores fijos), `rejected (${reason})` (reason de validación o `e.message`) y `error: ${e.message}`.
- Logger HTTP general: `pino-http` (`server/lib/logger.js`) ya registra `id`, `method`, `url`, `statusCode` y el `userId` del header por request, sin body → el log explícito era redundante.
- Contrato de la ruta: identidad por `reqUserId` (400 sin identidad en modo `off`), `event` obligatorio (400), respuesta `{ ok: true }` recovery-first aunque la validación canónica rechace, deduplicación por `event_id`.

## 2. Allowlist exacta

- `server/server.js` — únicamente el handler de `POST /api/events`.
- `server/__test__/eventsRequestLogMinimization.test.mjs` — único test nuevo (los existentes no capturan la salida del proceso).
- Este documento.

Sin cambios en registry, schemas, `events.db`, `analyticsShadow`, emisores, materializador, retención, frontend, `package.json`, workflows ni configuración.

## 3. Datos retirados del log

Toda serialización de `req.body`/`rest` (payload, texto libre, `userId`/`reviewerId`/`eventId` del cuerpo, `sessionId`, correos, tokens, claves desconocidas, valores inválidos) y toda interpolación de `reason`/`e.message` en la ruta.

## 4. Señal operacional conservada

Solo campos fijos generados por el servidor: `[EVENTS_V1] dual-write event: accepted=<0|1> dedup=<0|1>`, `rejected=1`, `error=1`. Método, ruta, estado y request id siguen en el access-log HTTP.

## 5. Contratos preservados (verificados con servidor real hermético)

| Caso | Respuesta | Persistencia |
|---|---|---|
| Evento válido | 200 `{ok:true}` | 1 fila: `event_id` del cuerpo, `immersive.manifest_fail`, `user_id` del header, `session_id` del cuerpo, `payload_json` con las claves recibidas y `_source: 'legacy'` |
| Duplicado (mismo `eventId`) | 200 `{ok:true}` | deduplicado (sin fila nueva) |
| Inválido (payload > 4 KB) | 200 `{ok:true}` recovery-first | no insertado (validación canónica intacta); el marcador saneado de payload inválido pertenece a `/api/analytics/events` y no aplica a esta ruta |
| Sin identidad | 400 | — |
| `event` no string | 400 `{error}` | — |

Autenticación, autorización, códigos, cuerpos de respuesta, validación, inserción y deduplicación sin cambios.

## 6. Pruebas con sentinelas

Sentinelas sintéticos distintos para correo, token, sesión, texto pedagógico, clave desconocida, valor inválido e identificadores de usuario y evento (en el cuerpo). Ninguno aparece en `stdout` ni `stderr` del proceso tras el arranque; `[EVENT]` no aparece; los rechazos no reproducen valores; las líneas `[EVENTS_V1]` contienen exclusivamente los contadores fijos; el access-log conserva `method`, `url` y `statusCode`. Estructural: la ruta no contiene `JSON.stringify(rest|req.body)` ni `${dualResult.reason}`/`${e.message}`. Resultado: 33/33.

Regresiones: `eventsWriteAuth`, `eventsRoutesSessionGuard`, `eventsService` 37/37, `analyticsCanon` 60/60, `legacyAnalyticsDropGuard`, `npm run build`, `npm run typecheck:baseline`, `npm run lint:evidence`, `git diff --check`: verdes. `npm run test:mook` no se ejecutó porque el cambio no toca código compartido con los emisores MOOK.

## 7. Cero producción

Sin subagentes ni procesos en segundo plano; sin SSH, Docker, HTTP productivo, deploy ni flags. `data/`, `data-critical/`, uploads, untracked y stashes intactos.

## 8. Deudas no tocadas

- `POST /api/analytics/events` registra en `WARN` los dos ids implicados en un mismatch de `userId` (`server.js` ~`:8378`) y `Analytics: usuario desconocido` con id — identificadores, no payload; fuera de esta unidad.
- El access-log HTTP general registra `userId` del header por request (sistema global de logging, no auditado aquí).
- Rotación y retención de logs no versionadas (COMP-11), fallback `open` productivo (COMP-01), previews de Leo (COMP-06), avisos de IA/privacidad (COMP-04/05) y el resto del inventario.
