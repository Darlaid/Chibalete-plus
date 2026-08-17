# CHP-IDDB-M1-A-SESSION-IDENTITY-LEGACY-DRAIN-CLOSE-01

Evaluación de cierre de la ventana de drenaje legacy de 24h (Session Identity / IDDB M1-A)
antes de permitir preparar `api_2 ENFORCE`. Fase de evaluación **read-only**: no activa
enforcement, no modifica configuración, no toca contenedores.

- Ejecutada: 2026-08-17T21:20:32Z → 2026-08-17T21:24:45Z (UTC)
- Host: `srv1179443` (VPS producción), usuario `root`, compose `/opt/chibaleteplus/`
- Evidencia cruda: `/root/chp-m1-a-drain-close-01/` (preflight, métricas, series Prometheus,
  logs de ventana por contenedor, copias de sessions.db/identity.db, smoke)
- Baseline de referencia: manifest `/root/chp-m1-a-deploy-c-01/M1-A-DEPLOY-C-01.json` +
  doc `M1_A_SESSION_IDENTITY_DEPLOY_C.md` (`e26b7fb`)

---

## A. Veredicto

**GO.**

La ventana de drenaje de 24h está completa (27,5h) con observabilidad continua demostrada y
**cero incrementos del contador legacy en ambas instancias**; no hay evidencia de fallback
legacy, errores de sesión, DLQ ni divergencia `api_1`/`api_2`.

- Nivel de confianza: **alto** (con un matiz de volumen de tráfico, ver sección H —
  riesgo medio, mitigado porque el contador sigue corriendo y el preflight de enforce
  debe re-verificar delta=0 en su propio T0).
- Razón principal: `chibalete_auth_session_legacy_x_user_id_total{source_class="browser"}`
  permaneció **plano** durante toda la ventana (api_1=2, api_2=9, idénticos al baseline 11
  de DEPLOY-C), verificado con serie histórica de Prometheus (55 muestras/instancia,
  paso 30 min, un único valor por serie) — no solo con dos puntos.

`GO` habilita únicamente **preparar** `CHP-IDDB-M1-A-API2-ENFORCE-PREFLIGHT-01`.
**NO activa ENFORCE.**

## B. Ventana evaluada

```text
legacy_drain_started_at_utc:        2026-08-16T17:52:47Z
legacy_drain_expected_close_at_utc: 2026-08-17T17:52:47Z
evaluated_at_utc:                   2026-08-17T21:20:56Z
elapsed_hours:                      27.47
window_status:                      COMPLETE
evidence_for_start:                 LEGACY_DRAIN_STARTED_AT en manifest
                                    /root/chp-m1-a-deploy-c-01/M1-A-DEPLOY-C-01.json
                                    (FASE12_LEGACY_DRAIN, counter_baseline=11,
                                    por_instancia api_1=2/api_2=9) + doc DEPLOY-C e26b7fb;
                                    coincide con StartedAt del contenedor front
                                    (2026-08-16T17:52:34Z).
```

## C. Estado de contenedores (docker inspect --format, read-only)

| Contenedor | Imagen | ImageID | StartedAt (UTC) | Restarts | Health |
|---|---|---|---|---|---|
| `chibalete_api_1` | `chibalete/api:0ff76b6` | `f2935d0f1209…` | 2026-08-16T16:45:14Z | 0 | healthy |
| `chibalete_api_2` | `chibalete/api:0ff76b6` | `f2935d0f1209…` (idéntico) | 2026-08-16T15:58:04Z | 0 | healthy |
| `chibalete_front` | `chibalete/front:m1a-0ff76b6` | `2d7535965868…` | 2026-08-16T17:52:34Z | 0 | healthy |
| `chibalete_edge` | `nginx:alpine` | `582c496ccf79…` | 2026-08-11T01:33:31Z | 0 | healthy |

Observaciones:
- StartedAt de ambas APIs **idéntico a B1/B2** y `RestartCount=0` → los contadores
  prom in-process NO se resetearon en la ventana → el delta contra el baseline 11 es válido.
- Env no-secreta verificada en AMBAS APIs: `SESSION_AUTH_MODE=compat` (sin enforce
  accidental), **`METRICS_ENABLED=1`** (la métrica de drenaje estuvo activa — guard
  anti-falso-GREEN), `SESSIONS_DB=/app/sessions/sessions.db`, `GIT_SHA=0ff76b69…`,
  `SESSION_LEGACY_ALLOW` ausente. Mounts idénticos entre instancias (solo difiere el orden).
- `/api/health` reporta `commit=2945fa8` en ambas por el bind mount congelado
  `release/2945fa8/.deploy-info` (precedencia .deploy-info > env). Idéntico en ambas
  instancias → NO es divergencia; el runtime real es `0ff76b6` (ImageID + GIT_SHA).
  Deuda cosmética preexistente de trazabilidad de health, no bloqueante.

## D. Logs Session Identity (ventana + margen: desde 2026-08-16T17:00:00Z)

### api_1
```text
log_window:            2026-08-16T17:00:07Z → 2026-08-17T21:22:37Z (continuo)
log_continuity:        OK — actividad cada hora (178–235 líneas/h, sin huecos)
restart_gaps:          0 (0 banners de arranque, RestartCount=0)
total_lines_reviewed:  5215
legacy_fallback_hits:  0 (contador plano en 2)
identity_warnings:     1 WARN 17:55:49Z "GET progress/user denied … requester=none" (benigno)
identity_errors:       0 (0 líneas [SESSION], 0 "Session rejected", 0 ERROR/FATAL)
```

### api_2
```text
log_window:            2026-08-16T17:00:23Z → 2026-08-17T21:22:23Z (continuo)
log_continuity:        OK — actividad cada hora (178–234 líneas/h, sin huecos)
restart_gaps:          0
total_lines_reviewed:  5220
legacy_fallback_hits:  0 (contador plano en 9)
identity_warnings:     3 WARN 18:07–18:17Z del día 16 "GET progress denied … requester=none"
identity_errors:       0 (0 líneas [SESSION], 0 "Session rejected", 0 ERROR/FATAL)
```

Los 4 WARN (todos en los primeros 25 min de ventana, ninguno después de 18:17Z del día 16)
son GETs de progreso **sin identidad alguna** (`requester=none` — ni cookie ni x-user-id):
pestañas post-logout/caché de los usuarios del smoke de DEPLOY-C y de un usuario natural.
Corresponden exactamente a los 4 `403 /api/progress/*` del edge y al contador
`failure{no_identity}`. **No son tráfico legacy** (un x-user-id válido habría sido aceptado
en compat e incrementado el contador legacy — no ocurrió).

### Contadores de sesión (fuente autoritativa del drenaje — la capa de sesión no emite logs)

| Serie (`chibalete_…`) | api_1 (baseline→ahora) | api_2 (baseline→ahora) | Delta ventana |
|---|---|---|---|
| `auth_session_legacy_x_user_id_total{browser}` | 2 → **2** | 9 → **9** | **0** ✅ |
| `auth_session_subject_mismatch_total` | 0 → 0 | 2 → 2 | 0 ✅ |
| `auth_session_failure_total{signing_key_unavailable}` | — → 0 | — → 0 | 0 ✅ (sin fail-closed infra) |
| `auth_session_failure_total{session_store_unavailable}` | — → 0 | — → 0 | 0 ✅ |
| `auth_session_failure_total{expired\|credential_version_mismatch\|csrf_*}` | 0 | 0 | 0 ✅ |
| `auth_session_failure_total{revoked}` | 2 | 2 | post-logout esperados (smokes) |
| `auth_session_failure_total{no_identity}` | 21 | 36 | anónimos/post-logout, atribuidos |
| `auth_session_failure_total{disabled}` | 1 | 4 | smokes B (lt-user-001 sintético) |
| `auth_session_success_total{session}` | 2 | 2 | logins reales vía endpoint ✅ |
| `auth_session_revoked_total{logout}` | 2 | 4 | logouts smoke + naturales ✅ |

**Serie histórica Prometheus** (job `chibalete-api`, scrape 30s, targets
`chibalete_api_1:3000`/`chibalete_api_2:3000` ambos `health=up`):
`query_range` del contador legacy desde 2026-08-16T17:52:47Z, paso 1800s →
**55 muestras por instancia, valor único `2` (api_1) y `9` (api_2) en toda la ventana**.
Continuidad de scrape: `up{job="chibalete-api"}` = 109 muestras up / **0 down** por instancia.
Evidencia: `/root/chp-m1-a-drain-close-01/legacy_counter_range.json`.

## E. Eventos / DLQ

```text
events_source_available:    yes (Prometheus + contadores por instancia + journal identidad)
dlq_source_available:       yes (tabla shadow_operations en identity.db — el "DLQ" del stack)
auth_session_events_count:  ver tabla §D (todos atribuidos; 0 inesperados)
identity_error_events_count: 0
dlq_related_count:          0  (shadow_operations: APPLIED=101234, NOOP_ALREADY_APPLIED=251,
                               PENDING=0, FAILED=0 — consulta sobre COPIA read-only)
comparison_previous_window: mismatch/legacy idénticos a los valores de cierre de B2/DEPLOY-C
evidence_gap:               ninguno bloqueante
```

Autoridad canónica intacta: padrón `usuarios_colegios_oro.json` = **647 usuarios,
`credentialVersion=0` en los 647** (cero bumps → cero revocaciones forzadas/disable/reset
en la ventana); sha256 `645a8148cf76…` registrado en evidencia.
`sessions.db` (copia): 7 filas totales — 3 smokes B1/B2 (emisión server-side, revocadas al
instante), login-smoke 17:35Z, smoke navegador DEPLOY-C 18:06Z (logout 18:08Z), y 2 logins
naturales de `user-1774362611303` (17:31Z con logout 17:58Z; 18:17Z vivo hasta expiración
natural a las 12h). Cero anomalías; cero sesiones legítimas cortadas.

## F. Smoke read-only

| Prueba | Método | Resultado |
|---|---|---|
| `/api/health` api_1 y api_2 directo | docker exec + wget interno | 200 ambas, `status:ok`, uptime cuadra con StartedAt |
| `/api/health/ready` api_1 y api_2 | docker exec + wget interno | `ready` ambas: mounts ok, `identity_sqlite ok` (wal, integrity ok, `shadow_consistency ok`), disco ok |
| `/api/health` y `/ready` vía edge | curl a 127.0.0.1 con Host real (trampa DNS del host conocida) | 200; el edge alternó instancias (respondieron ambas) → routing RR vivo |
| Smoke autenticado | — | **NO ejecutado**: no existe token/credencial segura disponible (la del login-smoke fue destruida) y las reglas 18–19 prohíben crear sesiones/usuarios |

Limitación declarada: sin smoke autenticado. Compensada con evidencia natural positiva:
2 logins reales vía endpoint dentro del ciclo (contador `success{session}` + filas de
sessions.db), sesión natural viva que completó su ciclo, y logouts reales revocando.

## G. Comparación api_1 vs api_2

```text
api_1_api_2_equivalence:               EQUIVALENTES — mismo ImageID, misma env no-secreta,
                                       mismos mounts, ambas compat, ambas healthy/ready,
                                       0 restarts, 0 ERROR, 0 5xx en ambas
traffic_sufficiency_api_2:             SÍ — api_2 sirvió MÁS tráfico de aplicación que api_1
                                       (177 vs 135 requests no-health desde su arranque),
                                       cubriendo las rutas sensibles a sesión (auth/me,
                                       login, logout, groups, progress, content)
api_2_clean_enough_for_enforce_preflight: SÍ
divergences:                           ninguna relevante
explanation:                           los conteos extra de api_2 en failure{disabled} (4) y
                                       4xx de login provienen de los smokes B1/B2 PRE-drenaje
                                       (lt-user-001 sintético deshabilitado + 3 contraseñas
                                       no coincidentes documentadas en B1); el mismatch=2 es
                                       el residuo conocido de B2. Todos previos a la ventana
                                       y documentados.
```

Edge en la ventana: 719 líneas, distribución 415×200 / 79×304 / 64×401 / 53×404 / 43×301 /
14×400 / 12×403 / 1×499 / 1×405 / **0×5xx**. Los 401 = bootstrap `/api/auth/me` sin sesión
(diseño cookie-only), eventos analytics anónimos, listados sin identidad y **un único** login
fallido; los 403 = 4 progress `requester=none` (§D) + 8 `/assets/` de bots. Ruido de
escáneres (wp-admin) presente y descartado.

## H. Riesgos residuales

**Críticos:** ninguno.

**Altos:** ninguno.

**Medios:**
1. **Volumen de tráfico real bajo en la ventana** (fin de semana): ~272 requests `/api/` en
   el edge, 2 logins naturales, horas valle sin actividad. El delta=0 es sólido pero la
   población de clientes ejercitada es pequeña. Mitigación: el contador sigue corriendo;
   `API2-ENFORCE-PREFLIGHT-01` **debe re-verificar delta=0 en su propio T0** (a esa altura
   la ventana efectiva será mayor e incluirá tráfico escolar de lunes).
2. **Puntos ciegos del contador legacy** (heredados del diseño, ya documentados):
   `source_class="browser"` está hardcodeado (no discrimina origen real) y una request con
   cookie válida + x-user-id coincidente NO incrementa el contador. Mitigación existente:
   guard estático 0-emisores (127 archivos) + interceptor runtime de DEPLOY-C con 0 headers
   en 23 requests.

**Bajos:**
3. Capa de sesión sin logs propios → un incremento legacy futuro no es atribuible
   (cliente/IP/UA). Aceptado para esta fase; la telemetría prom es la fuente.
4. `/api/health` reporta commit `2945fa8` por `.deploy-info` congelado (cosmético,
   idéntico en ambas instancias).
5. `METRICS_ENABLED=1` en producción está en tensión con la recomendación de la auditoría
   pre-deploy (mitigación GHSA OTel). Documentado; no se cambia en esta fase (el flag
   `otel:false` está confirmado en `/ready`).
6. En COMPAT cada login real mintea cookie → `sessions.db` acumula filas naturales
   (esperado, BACKUP_REQUIRED=false).

## I. Recomendación

**Permitir preparar CHP-IDDB-M1-A-API2-ENFORCE-PREFLIGHT-01. No activar ENFORCE en esta fase.**

Condiciones que el preflight debe incluir (derivadas de esta evaluación):
- Re-leer el contador legacy en su T0 y exigir que siga en api_1=2 / api_2=9 (delta=0
  acumulado desde DEPLOY-C).
- Verificar de nuevo `SESSION_AUTH_MODE`, `METRICS_ENABLED=1`, StartedAt/RestartCount
  (validez del delta) y el guard `M1_B_ENFORCE_REQUIRES_M1_A_ENFORCE` en su contexto.
- Plan de rollback por config (compat←enforce) ya conocido de las fases B.

## J. Siguiente prompt sugerido

`CHP-IDDB-M1-A-API2-ENFORCE-PREFLIGHT-01`

## K. Confirmación final

Esta fase fue read-only. No se modificaron flags, variables, contenedores, datos ni configuración productiva.
