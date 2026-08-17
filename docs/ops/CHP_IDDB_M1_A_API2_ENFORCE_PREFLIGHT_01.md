# CHP-IDDB-M1-A-API2-ENFORCE-PREFLIGHT-01

Preflight **read-only** para una fase futura de `api_2 ENFORCE` (Session Identity / IDDB M1-A).
Esta fase NO activa enforcement, NO modifica configuración, NO toca contenedores. Diseña el
cambio, el rollback, el smoke y los gates; revalida T0 tras el GO de
`LEGACY-DRAIN-CLOSE-01` (doc `91f6ce6`, rama `chp/m1-a-drain-close-01`, **pushed**).

- Ejecutada: 2026-08-17T22:35:07Z → 2026-08-17T22:35:45Z (UTC)
- Host: `srv1179443`, usuario `root`, compose `/opt/chibaleteplus/`
- Evidencia cruda: `/root/chp-m1-a-api2-enforce-preflight-01/`
- Estado git local: repo principal en `chp/stats-event-contract-01` (`9fbe7e0`, limpio);
  worktree auxiliar con las ramas de docs M1-A; rama `chp/m1-a-drain-close-01` (`91f6ce6`)
  existe y está publicada en origin; reporte y evidencia previos verificados presentes.

---

## A. Veredicto

**READY-FOR-ENFORCE-PREFLIGHT.** Confianza: **alta**.

T0 revalidado con delta legacy = 0 (contadores byte-idénticos a los del cierre del drenaje),
logs limpios desde el cierre, journal/DLQ en cero, ambas APIs saludables y sin drift, y existe
una forma segura, mínima y reversible de aplicar ENFORCE solo a `api_2` (una línea del bloque
`environment` de `api_2` en el override + recreate solo de ese servicio).

La ejecución queda condicionada a los gates de la sección I, incluida **autorización explícita
del usuario y ventana aprobada**.

## B. Estado T0 (2026-08-17T22:35:07Z)

```text
t0_evaluated_at_utc:        2026-08-17T22:35:07Z
api_1_legacy_counter:       2   (baseline cierre: 2)
api_2_legacy_counter:       9   (baseline cierre: 9)
delta_since_drain_close:    0
metrics_enabled_api_1:      1
metrics_enabled_api_2:      1
prometheus_samples_available: yes (job chibalete-api, scrape 30s, ambos targets up)
up_samples_api_1:           16/16 up, 0 down (desde cierre drain, paso 300s)
up_samples_api_2:           16/16 up, 0 down
```

| Métrica (`chibalete_…`) | api_1 | api_2 | Delta vs cierre | Resultado |
|---|---|---|---|---|
| `auth_session_legacy_x_user_id_total{browser}` | 2 | 9 | **0** | ✅ |
| `auth_session_subject_mismatch_total` | 0 | 2 | 0 | ✅ |
| `auth_session_failure_total{signing_key_unavailable}` | 0 | 0 | 0 | ✅ |
| `auth_session_failure_total{session_store_unavailable}` | 0 | 0 | 0 | ✅ |
| `auth_session_failure_total{expired\|cv_mismatch\|csrf_*\|session_required}` | 0 | 0 | 0 | ✅ |
| `auth_session_failure_total{revoked}` / `{disabled}` / `{no_identity}` | 2/1/21 | 2/4/36 | 0 | ✅ (idénticos al cierre) |
| `auth_session_success_total{session}` | 2 | 2 | 0 | ✅ |
| `auth_session_revoked_total{logout}` | 2 | 4 | 0 | ✅ |

Serie Prometheus del contador legacy desde el cierre: 6 muestras/instancia (paso 900s),
valor único `2` y `9`. Cero tráfico legacy nuevo.

## C. Logs desde el cierre del drain (2026-08-17T21:20:00Z → 22:35Z)

```yaml
api_1:
  lines: 231 (21:20:07Z → 22:35:37Z, continuo)
  warnings: 0
  errors: 0
  legacy_mentions: 0
  fallback_mentions: 0
  auth_401_relevant: 0
  auth_403_relevant: 0
  http_500: 0
  restarts: 0
api_2:
  lines: 229 (21:20:23Z → 22:35:23Z, continuo)
  warnings: 0
  errors: 0
  legacy_mentions: 0
  fallback_mentions: 0
  auth_401_relevant: 0
  auth_403_relevant: 0
  http_500: 0
  restarts: 0
edge:
  lines: 3 (todas 200; 0×4xx, 0×5xx)
```

Ventana muy tranquila (madrugada UTC, fin de semana): sin tráfico legacy, sin errores,
sin restarts, observabilidad continua.

## D. DB / journal / DLQ (consultas sobre COPIAS read-only en el workspace)

```text
canonical_users:                 647 (usuarios_colegios_oro.json,
                                 sha256 645a8148cf76… — byte-idéntico al cierre)
credential_version_distribution: {0: 647}  (cero bumps)
shadow_applied:                  101234
shadow_noop:                     251
shadow_pending:                  0
shadow_failed:                   0
dlq_related:                     0
sessions_db_readable:            yes (7 filas / 6 revocadas, 0 emitidas desde el cierre)
identity_db_readable:            yes
```

## E. Estado de contenedores

| Contenedor | ImageID | StartedAt (UTC) | Restarts | Health | Observaciones |
|---|---|---|---|---|---|
| `chibalete_api_1` | `f2935d0f1209…` | 2026-08-16T16:45:14Z | 0 | healthy | compat, METRICS_ENABLED=1 |
| `chibalete_api_2` | `f2935d0f1209…` (idéntico) | 2026-08-16T15:58:04Z | 0 | healthy | compat, METRICS_ENABLED=1 |
| `chibalete_front` | `2d7535965868…` | 2026-08-16T17:52:34Z | 0 | healthy | cookie-only, intacto desde C |
| `chibalete_edge` | `582c496ccf79…` | 2026-08-11T01:33:31Z | 0 | healthy | intacto |

Sin drift: mismas imágenes, mismos StartedAt que en el cierre, `SESSION_LEGACY_ALLOW`
ausente en ambas, sin cambios productivos no documentados (override vivo = estado DEPLOY-C).

## F. Plan futuro de api_2 ENFORCE — **NO EJECUTADO EN ESTA FASE**

El override vivo (`/opt/chibaleteplus/docker-compose.override.yml`, mtime = DEPLOY-C) declara
`SESSION_AUTH_MODE: "compat"` en bloques `environment` **separados** para `api_1` y `api_2`
→ el aislamiento por instancia es natural del archivo.

1. **Backup previo** (obligatorio):
   ```bash
   # NO EJECUTADO EN ESTA FASE
   cp /opt/chibaleteplus/docker-compose.override.yml \
      /root/chp-m1-a-deploy-d-01/override.pre-d.yml
   ```
2. **Cambio exacto** (archivo: `docker-compose.override.yml`; SOLO el bloque `api_2`):
   - línea `SESSION_AUTH_MODE: "compat"` del servicio `api_2` → `SESSION_AUTH_MODE: "enforce"`
   - **QUOTED** (trampa YAML conocida: `off` sin comillas ≡ booleano; se conserva el patrón
     de comillas en todos los valores de este flag).
   - `api_1` y `front` NO se tocan. No se toca `.env` compartido ni el compose principal.
   - NO se añade `SESSION_LEGACY_ALLOW` (enforce puro: sin cookie → 401 `session_required`).
3. **Aplicación** (recrea SOLO api_2; compose además solo recrea servicios con config
   cambiada, `--no-deps` lo hace explícito):
   ```bash
   # NO EJECUTADO EN ESTA FASE
   cd /opt/chibaleteplus && docker compose up -d --no-deps api_2
   ```
4. **Verificación de que SOLO api_2 quedó en ENFORCE**:
   - env por `docker inspect --format` en ambas: `api_2=enforce`, `api_1=compat`;
   - `StartedAt` de `api_1`, `front` y `edge` **sin cambio**; solo `api_2` con StartedAt nuevo;
   - **probe limpio que distingue modo sin contaminar el contador legacy ni usar usuarios
     reales**: request sin cookie con `x-user-id: lt-user-001` (sintético deshabilitado)
     directo a cada instancia → en compat responde 401 con `failure{disabled}++`; en enforce
     responde 401 con `failure{session_required}++` (la denegación ocurre ANTES del lookup).
     Ese probe NUNCA incrementa `legacy_x_user_id_total` (la decisión legacy de un usuario
     deshabilitado no cuenta como aceptada). Ejecutarlo solo contra `api_2`; en `api_1`
     basta el env + StartedAt intacto (un probe con usuario activo en compat SÍ sumaría al
     contador legacy y ensuciaría la métrica de drenaje).
   - contador legacy api_2 se resetea a 0 con el recreate (in-process): **el nuevo baseline
     post-enforce es api_1=2 / api_2=0** — documentarlo en el manifest de la ejecución.

Distinción de tipos de cambio: 1 archivo (override), 0 cambios de compose principal,
1 env var de 1 servicio, 1 recreate (`api_2`), health + smoke §H, rollback §G.

## G. Rollback futuro — **NO EJECUTADO EN ESTA FASE**

```bash
# NO EJECUTADO EN ESTA FASE
cp /root/chp-m1-a-deploy-d-01/override.pre-d.yml \
   /opt/chibaleteplus/docker-compose.override.yml
cd /opt/chibaleteplus && docker compose up -d --no-deps api_2
```

- Variable que vuelve: `SESSION_AUTH_MODE` de `api_2` → `"compat"` (misma imagen, sin
  rebuild, sin tocar datos ni migraciones — rollback por config puro, mismo patrón B1/B2).
- Verificación post-rollback: env `api_2=compat` por inspect; probe `lt-user-001` vuelve a
  producir `failure{disabled}` (no `session_required`); health/ready 200; `api_1` con
  StartedAt intacto (nunca cambió).
- Preservación de logs/evidencia: antes del rollback, `docker logs --timestamps` de api_2
  a fichero en el workspace de la ejecución; los contadores previos quedan en Prometheus
  (retención del server) aunque el recreate resetee el proceso.
- Criterio cumplido: rollback claro, rápido (<1 min), sin datos ni migraciones.

## H. Smoke futuro post-enforce (read-only, fase de ejecución) — lista ordenada

1. `GET /api/health` y `/api/health/ready` directos en `api_2` (docker exec) → 200/ready.
2. Ídem en `api_1` → sin cambio.
3. `GET /api/health` vía edge (Host real contra 127.0.0.1 — trampa DNS del host) ×N hasta
   ver responder ambas instancias → routing RR intacto.
4. `/metrics` api_2: aparece `failure{session_required}` SOLO por el probe controlado;
   `legacy_x_user_id_total` api_2 = 0 y NO crece; api_1 legacy = 2 y NO crece.
5. Probe de modo (§F.4) contra api_2: `lt-user-001` sin cookie → 401 `session_required`.
6. Login natural + `/api/auth/me` cookie-only contra api_2 SOLO si el operador provee
   credencial pre-verificada offline (1 bcrypt, regla conocida: jamás adivinar; el asistente
   NO teclea contraseñas); en su defecto, esperar el primer login natural y observar
   `success{session}`/sessions.db.
7. Rutas read-only autenticadas (groups, progress del propio usuario) vía cookie si hay
   sesión del punto 6; comparar respuesta api_1 (compat) vs api_2 (enforce) — equivalentes.
8. Edge logs ventana de observación: 0×5xx, 401 solo atribuibles (bootstrap sin sesión).
9. Journal `shadow_operations`: PENDING=0/FAILED=0; padrón cv sin bumps.
10. Confirmar reversibilidad disponible (backup §G presente) y rollback NO usado.

Prohibido en el smoke: crear usuarios, modificar datos, invalidar sesiones reales,
smoke destructivo.

## I. Gates y stop conditions para la ejecución

**Gates previos (todos obligatorios):**
- delta legacy = 0 re-verificado en el T0 de la ejecución (api_1=2/api_2=9 o valores
  re-baselineados documentados);
- `METRICS_ENABLED=1` en ambas; ambas healthy; restarts=0 desde este preflight;
- logs sin errores session identity desde este preflight;
- journal PENDING=0/FAILED=0; DLQ 0; cv sin bumps inesperados;
- backup `override.pre-d.yml` creado; rollback §G listo;
- **ventana de ejecución aprobada y autorización explícita del usuario** (no auto);
- M1-B ausente del runtime (sin `TENANT_AUTHZ_MODE`) o coherente con su propio gate
  (`M1_B_ENFORCE_REQUIRES_M1_A_ENFORCE` es del deploy de M1-B, no bloquea este).

**Gates posteriores:** api_2 health OK y reporta enforce (env + probe §F.4); api_1 sigue
compat con StartedAt intacto; delta legacy no aumenta (api_1=2 fijo, api_2=0 fijo);
0 errores session identity; 0×5xx; DLQ/journal 0; smoke §H OK; edge sin anomalías;
rollback no usado.

**Stop conditions (rollback inmediato §G):** cualquier fallback legacy nuevo; cualquier
error crítico de sesión (`signing_key_unavailable`/`session_store_unavailable`/spike de
`session_required` no atribuible al probe = usuarios reales bloqueados); restart no esperado;
`api_1`/frontend/edge afectados; 5xx relevante; usuarios afectados; métricas no disponibles.

## J. Riesgos residuales

- **Tráfico bajo** (medio): la ventana de drenaje y el intervalo hasta T0 cayeron en fin de
  semana; la población de clientes ejercitada es pequeña. El gate previo de la ejecución
  re-verifica delta=0 en su propio T0 (idealmente tras tráfico escolar de lunes), y el
  primer `session_required` no atribuible al probe es stop condition inmediata.
- **Health commit stale** (bajo): `/api/health` reporta `2945fa8` por el bind mount
  congelado `release/2945fa8/.deploy-info` en ambas instancias; el runtime real es `0ff76b6`
  (ImageID + GIT_SHA). Cosmético; la verificación de la ejecución usa ImageID/env, no health.
- **Puntos ciegos del contador legacy** (medio, heredado): `source_class="browser"`
  hardcodeado (no discrimina origen) y una request con cookie válida + `x-user-id`
  coincidente no incrementa el contador. En enforce el punto se vuelve observable:
  cualquier emisor legacy sin cookie aflorará como `session_required`.
- **Observabilidad de sesión solo por métricas** (bajo): la capa de sesión no emite logs;
  un incremento futuro no es atribuible a cliente/IP/UA. Aceptado; los contadores
  por-reason + edge log compensan para el smoke.
- **Reset del contador de api_2 al recrear** (operativo): el baseline post-enforce pasa a
  api_1=2/api_2=0 y debe quedar documentado en el manifest de la ejecución para no
  malinterpretar deltas.

## K. Pendientes antes del prompt de ejecución

- ~~Publicar rama `chp/m1-a-drain-close-01`~~ — **RESUELTO** en esta fase (`91f6ce6` pushed).
- Worktree auxiliar local en el scratchpad de sesión (`wt-drain-close`) — inocuo; limpiar
  con `git worktree remove` cuando se desee (no bloquea).
- **Aprobación explícita del usuario + ventana de ejecución** (idealmente con tráfico
  escolar reciente que refuerce el delta=0).
- Crear workspace `/root/chp-m1-a-deploy-d-01/` y backup `override.pre-d.yml` como primer
  paso de la ejecución.
- Opcional recomendado: credencial de smoke provista por el operador y pre-verificada
  offline (1 bcrypt) para el punto 6 del smoke.

## L. Siguiente prompt sugerido

`CHP-IDDB-M1-A-API2-ENFORCE-EXECUTE-01`

## M. Confirmación final

Esta fase fue read-only. No se activó ENFORCE, no se modificaron flags, variables, contenedores, datos ni configuración productiva.
