# CHP-IDDB-M1-A-API2-ENFORCE-ROLLBACK-ANALYSIS-01

Análisis post-rollback del canary `api_2 ENFORCE` (2026-08-17 22:48Z → 2026-08-18 03:12Z)
y ruta de remediación. Fase read-only (solo produce documentación).

- Ejecutada: 2026-08-18T03:22:40Z (verificación) + análisis de evidencia previa
- Evidencia: `/root/chp-m1-a-observe-school-01/` (incidente), `/root/chp-m1-a-rollback-analysis-01/`
  (verificación post-rollback), reportes `550247c`/`e334edf`/`7129afe`

---

## A. Veredicto

**Causa raíz (confianza alta):** el canary funcionó correctamente; lo que falló fue el
**censo de poblaciones legacy**. Existe un cliente nativo Android de Chibalete+ (okhttp)
que autentica exclusivamente por `x-user-id` y no persiste la cookie de sesión; la ventana
de drenaje de 24h no lo vio porque cayó en fin de semana sin tráfico y porque la
observabilidad no segmenta por tipo de cliente (label `browser` hardcodeado). Al llegar el
primer usuario real, el round-robin partió su tráfico Android 50/50 y `api_2` enforce
denegó sus escrituras — stop condition correcta, rollback limpio.

Frase ejecutiva: *el enforcement hizo su trabajo y el rollback también; el drenaje midió
"navegador" cuando la pregunta era "todos los clientes".*

## B. Estado post-rollback (verificado 2026-08-18T03:22:40Z)

```text
api_1_mode: compat        api_1_health: healthy   restarts: 0 (id a7fc56524aec, intacta desde 08-16)
api_2_mode: compat        api_2_health: healthy   restarts: 0 (id 9351be57d54c, rollback 03:12:47Z)
frontend_health: healthy (intacto)   edge_health: healthy (intacto)
override vivo sha = 7579228b… (byte-idéntico al backup pre-enforce) ✓
post_rollback_5xx: 0      post_rollback_errors: 0 (api_1 0/0, api_2 0/0, edge 4×200)
rollback_backup conservado ✓   estado enforce preservado (override.enforce-state-preserved.yml) ✓
okhttp post-rollback: sin tráfico aún (el dispositivo volverá a funcionar 100% en compat)
```

**Producción está COMPAT/COMPAT** — el análisis procede.

## C. Línea de tiempo del canary (UTC, 2026-08-17/18)

| Hora | Instancia | Evento | Interpretación |
|---|---|---|---|
| 22:48:55 | api_2 | recreate a enforce (`c2c97e3fbdd7`) | canary activo |
| 22:50 | api_2 | probe lt-user-001 + smoke propio → session_required=2 | atribuidos |
| 00:52 | mixta | ráfaga Firefox pre-login sin cookie (auth/me, users, schools, groups, content → 401) | idéntico en compat (`no_identity`/`session_required` solo re-etiqueta) |
| 00:53:05 | api_1 | **login real Firefox 200** (user-1781223321961), cookie emitida | cookie-path OK |
| 00:53–00:59 | ambas | navegación real: 18×progress sync 200, leo/memory 200, schools 200 — **incluye api_2 enforce vía cookie** | sesión browser perfecta en enforce |
| 00:53–00:55 | ambas | 13×503 `POST /api/tts` | incidente TTS (créditos OpenAI), ajeno a sesión |
| 00:52–00:59 | ambas | 53×401 `POST /api/v1/events` (+7 playback +3 analytics) de usuario LOGUEADO | gap events cookie-auth (pre-existente desde DEPLOY-C) |
| 01:11:42 | **ambas** | **okhttp (app Android): sync→401(api_2) / offline-assignment→200(api_1, legacy 2→3) / sync-retry→401(api_2)** | **patrón 50/50 mismo segundo — cliente legacy vivo** |
| 01:15:38, 01:18:58 | — | re-logins desde app (200) y `offline/assignment→401` inmediato en api_2 | okhttp descarta Set-Cookie; la app no puede auto-remediarse |
| 03:07–03:11 | — | forense y atribución (esta cadena de fases) | 2 stop conditions confirmadas |
| 03:12:45–47 | api_2 | **rollback**: restore byte-idéntico + recreate (`9351be57d54c`) compat healthy | pre-autorizado, antes del bloque escolar |
| 03:13–03:22 | — | verificación: probe da `failure{disabled}` (firma compat), vecinos intactos, 0 errores | rollback GREEN |

## D. Clientes observados

| client_type | User-Agent | auth | cookie | x-user-id | rutas | compat | enforce | riesgo | migración |
|---|---|---|---|---|---|---|---|---|---|
| browser | Firefox/153 Win | **cookie de sesión** | sí (HttpOnly) | no | login, auth/me, progress sync, leo, schools, TTS | OK | **OK** | bajo | no (ya migrado en DEPLOY-C) |
| **mobile (app Android)** | okhttp/4.12.0 | **x-user-id legacy** | recibe Set-Cookie pero **no la persiste/reenvía** | sí | login, `GET/POST offline/assignment`, progress sync | OK (por api_1) | **401 (bloqueada)** | **alto** | **SÍ — bloqueante** |
| automation propia | curl (host VPS) | ninguna (health/público) | — | — | health, runtime-config | OK | OK | — | no |
| bot | OAI-SearchBot etc. | — | — | — | /, robots, wp-scans | 301/400 | igual | — | no |

## E. Causa raíz técnica

1. La app Android autentica con `x-user-id` autoafirmado (el modelo pre-M1-A). Su login
   contra `/api/auth/login` funciona (200) y el server emite `Set-Cookie`, pero okhttp
   **sin CookieJar descarta la cookie** → cada request posterior va solo con header.
2. Sus rutas críticas (`/api/offline/assignment` → `requireUserAuth`, progress sync →
   `requireProgressOwner`) SÍ son session-aware: en compat aceptan el header legacy; en
   enforce exigen cookie → 401 `session_required`.
3. El edge reparte round-robin → 50/50: el mismo cliente alterna éxito (api_1 compat) y
   fallo (api_2 enforce) — degradación intermitente, la peor UX posible.
4. El retiro de emisores x-user-id de REHEARSAL-R1 cubrió el **frontend web** (46 sitios,
   guard estático de 127 archivos). La app Android es **otro codebase** (no está en este
   repo) y nunca entró en ese inventario.
5. El drenaje validó delta=0 sobre la población que SÍ tocó el sistema en la ventana —
   que no incluyó ni un solo request de la app (su primera aparición en el edge log
   retenido es 2026-08-18T01:11:42Z).

## F. Fallas de observabilidad (por qué el drenaje no la detectó)

```text
drain_failed_to_detect_android_because: población ausente de la muestra (fin de semana sin
  tráfico) + métrica incapaz de distinguirla aunque hubiera aparecido
observability_gap: el contador legacy tiene label source_class HARDCODEADO a 'browser' —
  cualquier cliente (app, script, integración) se cuenta igual; no hay clasificación por
  User-Agent ni por ruta; la capa de sesión no emite logs (sin atribución)
metric_gap: no existe métrica por (client_type, route_group, cookie_present,
  header_present, mode, result); cookie+header coincidente NO cuenta (punto ciego)
traffic_gap: ventana 100% en fin de semana; sin mínimo de tráfico/usuarios como gate duro
classification_gap: sin criterio "mobile/offline endpoints" — /api/offline/* es el
  marcador natural de la población nativa y nadie lo vigilaba
new_required_drain_criteria: ver §K (segmentado por cliente, con mínimos de población)
```

No fue solo bajo tráfico: aunque la app hubiera aparecido durante el drenaje, el contador
la habría sumado como "browser" sin forma de distinguirla, y con cookie+header coincidente
ni siquiera habría contado.

## G. Opciones de remediación

**Opción 1 — Migrar la app Android a cookie/sesión real.**
CookieJar persistente en okhttp (p.ej. `JavaNetCookieJar`/PersistentCookieJar), conservar
`Set-Cookie` del login, reenviar cookie en todas las requests, retirar el header. Requiere:
acceso al codebase Android, build, distribución (¿cómo se instala en los colegios? ¿MDM,
APK manual, Play?), y ventana de convivencia (apps viejas instaladas siguen legacy hasta
actualizarse — la migración NO es instantánea).
→ **Correcta a largo plazo. Complejidad media. Riesgo bajo. Tiempo: semanas (release+adopción). ES la solución.**

**Opción 2 — `SESSION_LEGACY_ALLOW` acotado temporal.**
La env ya existe en el diseño M1-A (allowlist en enforce). Acotarla NO por User-Agent
(falsificable, y hoy el mecanismo no filtra por ruta/UA — habría que implementarlo):
tal cual existe es un boquete genérico que reabre x-user-id en enforce → pierde casi todo
el valor del enforcement. Solo aceptable como transición si se implementa con: allowlist
POR RUTA (`/api/offline/*`, progress sync), telemetría por uso, expiración dura y criterio
de retiro = adopción de la app nueva.
→ **Aceptable como puente SOLO en versión por-ruta con expiración. Complejidad media (hay que construir el filtro). Riesgo medio-alto. Prolonga la deuda.**

**Opción 3 — Bridge backend session-aware para la app actual.**
En login exitoso la app ya recibe Set-Cookie; el bridge convertiría el header legacy en
sesión server-side… pero sin cookie persistida en el cliente no hay dónde anclar la sesión
(cada request llegaría sin sid). Un "bridge" real equivale a re-aceptar el header — es la
Opción 2 con otro nombre — o a tokens por header (rediseño mayor contra el modelo cookie
congelado en M1-A R1).
→ **Descartada: no aporta sobre la 2 y arriesga el modelo de sesión.**

**Recomendación: Opción 1 como camino (audit → migración → adopción), evaluando la
Opción 2 por-ruta SOLO si la adopción de la app nueva resulta lenta y el negocio necesita
enforce antes.** Primer paso imprescindible: `ANDROID-COOKIE-SESSION-AUDIT-01` (¿qué app
es, qué versión, cuántos dispositivos, quién la distribuye, dónde está el código?).

## H. Deuda CHP-M1A-EVENTS-COOKIE-AUTH-GAP-01 (confirmada en código `0ff76b6`)

- Rutas: `POST /api/v1/events` (server.js:9199), `POST /api/playback-events` (:9116),
  `POST /api/analytics/events` (:7500). Ninguna corre middleware de sesión; usan
  `reqUserId(req)` = `req.auth?.userId ?? req.user?.id ?? req.headers['x-user-id']`
  (server.js:2469) y `req.auth` nunca se puebla ahí.
- **Efecto 1 (pérdida de datos, desde DEPLOY-C):** navegador cookie-only logueado → 401
  `x-user-id required` → **cero eventos de lectura del navegador llegan a events.db**
  (histórico edge 68×401 vs 25×200; 53×401 en 27 min de un usuario cuyo progreso
  sincronizaba 200). **STATS BLOQUEADO confirmado** — el materializador y los informes
  canónicos no tendrán datos de navegador.
- **Efecto 2 (seguridad):** al caer al header crudo sin pasar por el modo, esas rutas de
  ESCRITURA aceptarían `x-user-id` falsificado **incluso bajo enforce total** — bypass de
  enforcement en la atribución de events.db.
- Relación con `chp/stats-ingest-01b`: el `canonicalIngest` dormido ya resuelve esto
  (actor desde `req.auth`, ACTOR_MISMATCH, contexto verificado) — activarlo es el fix
  estructural; el fix mínimo alternativo es envolver las 3 rutas con el resolvedor de
  sesión (mismo patrón que `/api/content/:id/access` en R1) manteniendo compat.
- **Debe resolverse antes de cualquier nuevo ENFORCE** (si no, enforce deja un agujero de
  spoofing en las rutas de eventos) y desbloquea la agenda STATS. Pruebas: cookie-only
  200 + atribución correcta, spoof → 401/ACTOR_MISMATCH, legacy compat temporal según se
  decida, no-regresión de dual-write.
- Fase propuesta: **CHP-M1A-EVENTS-COOKIE-AUTH-GAP-01** (offline primero, CI, deploy
  como unidad propia).

## I. Deuda TTS (colateral, NO relacionada con enforce)

`POST /api/tts` → 13×503: OpenAI **sin créditos** ("You have no credits remaining"),
breaker abierto (HF4B), y fallback Gemini fallando por dos vías ("Model tried to generate
text…" = prompt/modelo mal avenidos, y "No audio data in Gemini response"). Impacto:
audio on-demand caído para usuarios reales. Acciones: recargar créditos OpenAI (operador)
y revisar el fallback Gemini TTS. Fase propuesta: **CHP-TTS-ONDEMAND-CREDITS-FALLBACK-01**.
No se tocó nada en esta fase.

## J. Nueva observabilidad requerida (diseño, NO implementada)

Métricas (prom) mínimas antes de reintentar enforce:

```text
session_auth_attempt_total{mode, instance, client_type, route_group, cookie_present, x_user_id_present, result}
session_legacy_usage_total{instance, client_type, route_group, user_agent_family}
session_enforce_rejection_total{instance, client_type, route_group, reason}
session_cookie_missing_total{client_type, route_group}
```

- `client_type` derivado server-side del User-Agent (browser / mobile-okhttp / automation
  / unknown) — clasificación best-effort, no seguridad.
- `route_group`: auth / progress / offline / events / content / admin / other (el grupo
  `offline` es el marcador de la población nativa).
- Caso `cookie_present=1 ∧ x_user_id_present=1` contado EXPLÍCITO (hoy invisible).
- Log estructurado por cada aceptación legacy y cada rechazo enforce (hoy la capa de
  sesión no emite ninguno): timestamp, ruta, client_type, uid — sin PII extra.
- Cardinalidad controlada (valores enumerados, jamás UA crudo como label).

## K. Nuevo criterio de drenaje (matriz)

| criterion | required_threshold | evidence_source | GO | NO-GO |
|---|---|---|---|---|
| Ventana | ≥48h cubriendo ≥2 días hábiles con horario escolar | prom + edge | cumplida | fin de semana/only-nights |
| Tráfico real | ≥N requests /api de terceros (fijar N con datos de un lunes, p.ej. ≥2.000) y ≥M usuarios únicos (≥20) | edge + sessions.db | cumplido | por debajo |
| Población móvil | ≥1 sesión de client_type=mobile observada Y su legacy=0, O población móvil declarada inexistente tras el audit Android | métricas segmentadas | cumplido | app sin migrar emite legacy |
| Rutas offline | `route_group=offline` con legacy=0 en toda la ventana | métricas segmentadas | 0 | >0 |
| Legacy por segmento | delta=0 en CADA client_type y route_group (no solo total) | métricas segmentadas | 0 en todos | >0 en cualquiera |
| Doble credencial | `cookie ∧ header` → tendencia a 0 (emisores duales retirados) | métrica nueva | ↓ a 0 | estable >0 |
| session_required no atribuible | 0 (en shadow/canary previo) | métricas + logs estructurados | 0 | >0 |
| Patrón 50/50 | 0 clientes con éxito/fallo alternado entre instancias | edge + logs | 0 | ≥1 |
| Events cookie-auth | GAP-01 resuelto: 0×401 de eventos para cookie-only | edge + tests | resuelto | pendiente |
| Observabilidad | métricas segmentadas §J desplegadas y scrapeadas | /metrics | vivas | ausentes |
| Rollback | backup verificado + runbook | workspace | listo | ausente |

## L. Plan de fases recomendado (orden y dependencias)

1. **CHP-M1A-EVENTS-COOKIE-AUTH-GAP-01** — reparar events/playback/analytics
   (session-aware o canonicalIngest). Sin dependencias; desbloquea STATS; cierra además
   el bypass de spoofing. ← **primera**
2. **CHP-IDDB-M1-A-ANDROID-COOKIE-SESSION-AUDIT-01** — descubrir la app (codebase,
   versión, población, distribución, endpoints, login) y decidir Opción 1 vs 1+2.
   Sin dependencias; puede correr en paralelo con (1).
3. **CHP-IDDB-M1-A-LEGACY-OBSERVABILITY-SEGMENTED-01** — métricas/logs §J
   (depende de nada; conviene antes de (5)).
4. **CHP-IDDB-M1-A-ANDROID-SESSION-MIGRATION-01** — implementar CookieJar + release +
   plan de adopción (depende de 2).
5. **CHP-IDDB-M1-A-DRAIN-REDO-WEEKDAY-TRAFFIC-01** — drenaje segmentado con matriz §K
   (depende de 1, 3 y de la adopción suficiente de 4).
6. **CHP-IDDB-M1-A-API2-ENFORCE-RETRY-PREFLIGHT-01** — solo con (5) GREEN.
7. **CHP-IDDB-M1-A-API2-ENFORCE-RETRY-EXECUTE-01** — nuevo canary controlado.

## M. Decisión sobre ENFORCE

- **ENFORCE queda BLOQUEADO.**
- No intentar `api_2 ENFORCE` de nuevo hasta resolver o aislar la app Android legacy
  (fases 1–5 del plan).
- No intentar `api_1 ENFORCE`.
- **Producción debe permanecer COMPAT/COMPAT** (estado conocido-bueno de DEPLOY-C, hoy
  verificado). Compat NO es el destino final: es el puente mientras se ejecuta el plan —
  la regla 19 (no tapar la causa raíz con compat indefinido) queda encodada en el plan L.

## N. Siguiente prompt sugerido

**`CHP-M1A-EVENTS-COOKIE-AUTH-GAP-01`** — justificación: es la única pieza sin
dependencias que (a) detiene una pérdida de datos ACTIVA (todos los eventos de navegador
se descartan desde DEPLOY-C, cada día que pasa se pierden datos irrecuperables),
(b) desbloquea toda la agenda STATS (ingest → materializer → informes), y (c) cierra un
bypass de seguridad que invalidaría cualquier enforce futuro. El audit Android
(`CHP-IDDB-M1-A-ANDROID-COOKIE-SESSION-AUDIT-01`) puede prepararse en paralelo, pero
depende de información del operador (dónde vive ese codebase) que aún no está en el repo.

## O. Confirmación final

Esta fase fue read-only. Producción permanece COMPAT/COMPAT. No se activó ENFORCE, no se modificaron flags, variables, contenedores, datos ni configuración productiva.
