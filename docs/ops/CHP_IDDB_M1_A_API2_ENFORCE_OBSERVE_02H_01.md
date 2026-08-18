# CHP-IDDB-M1-A-API2-ENFORCE-OBSERVE-02H-01

Observación de 2h del canary `api_2 ENFORCE` (Session Identity / IDDB M1-A), con `api_1`
en compat. Fase read-only (único efecto: 1 probe diferencial atribuido, validado como
no contaminante en EXECUTE-01).

- Evidencia cruda: `/root/chp-m1-a-api2-enforce-observe-02h-01/`
- Referencias: EXECUTE-01 `e334edf` (`chp/m1-a-api2-enforce-execute-01`), backup rollback
  `override.pre-api2-enforce-20260817T224803Z.yml` sha `7579228b…` (verificado disponible)

---

## A. Veredicto

**CANARY-GREEN (parcial — tráfico insuficiente).** Confianza: **alta en estabilidad,
insuficiente en población**. **Rollback NO usado.**

En 2h02m de enforce: cero `session_required` no atribuibles, cero incrementos legacy,
cero errores, cero 5xx, cero restarts, journal/padrón congelados y enforce re-verificado
activo al cierre. PERO el tráfico real fue **cero** (madrugada: sin logins, sin sesiones,
sin requests `/api/` de terceros), así que este GREEN valida estabilidad e inocuidad,
**no** valida el canary contra población real — esa validación queda explícitamente
pendiente del tráfico escolar (regla 17: no se asume GREEN por bajo tráfico; por eso el
GREEN es parcial y con repetición obligatoria).

## B. Ventana observada

| Campo | Valor |
|---|---|
| enforce_started_at_utc | 2026-08-17T22:48:55Z |
| observe_started_at_utc | 2026-08-17T23:45:20Z (checkpoint parcial a ~56 min) |
| observe_ended_at_utc | 2026-08-18T00:51:24Z |
| Duración desde enforce | **2h 02m** (ventana mínima cumplida) |
| Contexto de tráfico | madrugada de lunes UTC (noche de domingo local), fin de fin de semana |
| Requests `/api/` externas | 14 — TODAS del smoke propio de EXECUTE-01 (hora 22); horas 23 y 00: **0** |
| Logins / sesiones reales | 0 / 0 (sessions.db sin filas nuevas) |
| traffic_sufficiency | **insufficient** |

## C. Estado de contenedores (inicio y fin de ventana idénticos)

| Contenedor | Modo | ImageID | ContainerID | StartedAt | Restarts | Health |
|---|---|---|---|---|---|---|
| `chibalete_api_1` | **compat** | `f2935d0f1209…` | `a7fc56524aec` | 2026-08-16T16:45:14Z | 0 | healthy |
| `chibalete_api_2` | **enforce** | `f2935d0f1209…` | `c2c97e3fbdd7` | 2026-08-17T22:48:55Z | 0 | healthy |
| `chibalete_front` | — | `2d7535965868…` | `685fdf0ca59e` | 2026-08-16T17:52:34Z | 0 | healthy |
| `chibalete_edge` | — | `582c496ccf79…` | `84453f116969` | 2026-08-11T01:33:31Z | 0 | healthy |

`frontend_untouched=true`; `METRICS_ENABLED=1` ambas; `SESSION_LEGACY_ALLOW` ausente.

## D. Métricas (desde enforce hasta cierre)

```yaml
api_1:
  legacy_counter_current: 2
  legacy_delta_since_enforce: 0          # serie prom plana, 13 muestras unique=['2']
  session_required: 0
  auth_failures: sin cambio alguno (revoked=2, disabled=1, no_identity=21 — congeladas)
  5xx: 0
  up_samples: 62/62 (0 down)
api_2:
  legacy_counter_current: 0              # serie ni inicializada en el proceso nuevo
  legacy_delta_since_enforce: 0
  session_required: 2 → 3
  session_required_attributed: 3/3
    # 1 = probe interno EXECUTE-01 (22:50)
    # 2 = smoke propio /api/auth/me vía edge (22:50:32, único 401 del edge)
    # 3 = probe de re-verificación de esta fase (00:51:25Z, atribuido en el momento)
  session_required_unattributed: 0       # serie prom plana en 2 durante TODA la ventana
                                         # (12 muestras, paso 600s, unique=['2'])
  subject_mismatch: 0
  5xx: 0
  up_samples: 62/62 (0 down)
```

Nota: prom conserva 1 muestra residual `legacy=9` de api_2 justo en el borde de la ventana
— es el último scrape del proceso VIEJO pre-recreate, no un valor del proceso enforce.

## E. Logs (desde enforce)

```yaml
api_1: { lines: 370, warnings: 0, errors: 0, legacy_mentions: 0, fallback: 0, 500: 0, restarts: 0 }
api_2: { lines: 405, warnings: 0, errors: 0, legacy_mentions: 0, fallback: 0,
         session_required_en_logs: 0 (la capa no loggea; observado por métrica), 500: 0, restarts: 0 }
edge:  { lines: 16, 5xx: 0, dist: 13×200 + 2×301(bots) + 1×401,
         401_detail: "GET /api/auth/me 22:50:32Z" = smoke propio de EXECUTE-01,
         api_1_hits/api_2_hits: sin tráfico real que repartir (solo smoke 6/6 en EXECUTE-01) }
```

## F. Impacto en usuarios reales

- Logins reales: 0. Sesiones reales: 0 (sessions.db 7/6, sin filas nuevas). Rutas
  protegidas de terceros: 0 requests. 401/403 inesperados: 0. Patrones de retry o de
  fallo intermitente 50/50: no observables (sin población).
- `real_user_impact:` **none / insufficient_traffic** — no hubo usuario alguno que
  pudiera resultar bloqueado, lo que es evidencia de inocuidad pero NO de compatibilidad
  poblacional.

## G. DB / journal / DLQ

```text
canonical_users: 647 · credentialVersion: {0: 647} · padrón sha 645a8148cf76… (byte-idéntico)
shadow_applied: 101234 · shadow_noop: 251 · shadow_pending: 0 · shadow_failed: 0
dlq_related: 0 · sessions_new_rows: 0 · identity_db/sessions_db: legibles, ok
```

## H. Smoke read-only

- Probado: métricas por instancia y por rango prom; health implícito (docker healthy,
  `up` 62/62); probe diferencial `lt-user-001` → `401 "se requiere sesión activa"` +
  `session_required` 2→3 (atribuido, no contaminante, serie legacy intacta).
- No probado: login real (sin credencial disponible; no se inventa), rutas con sesión.

## I. Rollback

**NO usado.** Backup re-verificado disponible al inicio de la ventana
(`override.pre-api2-enforce-20260817T224803Z.yml`, sha `7579228b…`).

## J. Riesgos residuales

1. **api_2 enforce / api_1 compat** (asimetría del canary): un emisor legacy real
   funcionaría ~50% y fallaría en api_2 — vigilar ambos contadores sigue siendo la regla.
2. **Tráfico cero en la ventana**: la validación poblacional está íntegramente pendiente;
   este GREEN no la sustituye.
3. **Necesidad de observar tráfico escolar real** (primer bloque lectivo de lunes) —
   es el verdadero test del canary.
4. **Contador api_2 reseteado por recreate** (baseline 0; el 9 residual en prom es del
   proceso viejo).
5. **Puntos ciegos del contador legacy** (hardcode `browser`; cookie+header coincidente
   no cuenta) — en enforce afloran como `session_required`.
6. **Health commit stale** (`2945fa8` por `.deploy-info` congelado) — sigue aplicando,
   cosmético.

## K. Recomendación

**CANARY-GREEN con tráfico insuficiente:**
- Mantener `api_2` en ENFORCE.
- **Repetir la observación tras el primer bloque de tráfico escolar** (lunes lectivo),
  con foco en: `session_required` de api_2 no atribuible (stop condition → rollback),
  `legacy` de api_1 (si crece: emisores legacy reales aún vivos → evaluar), logins/
  sesiones reales atravesando api_2 con éxito.
- **No pasar `api_1` a ENFORCE.**

## L. Siguiente prompt sugerido

`CHP-IDDB-M1-A-API2-ENFORCE-OBSERVE-SCHOOL-TRAFFIC-01`

## M. Confirmación final

api_2 permanece en ENFORCE. api_1 permanece en compat. No se tocaron frontend, edge/nginx, datos, uploads ni migraciones.
