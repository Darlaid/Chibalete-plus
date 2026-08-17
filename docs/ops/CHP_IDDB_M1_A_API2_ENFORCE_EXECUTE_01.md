# CHP-IDDB-M1-A-API2-ENFORCE-EXECUTE-01

Activación canary de `SESSION_AUTH_MODE=enforce` en `api_2` (Session Identity / IDDB M1-A),
con `api_1` permaneciendo en `compat`. Autorizada explícitamente por el usuario tras
`LEGACY-DRAIN-CLOSE-01` (GO, `91f6ce6`) y `API2-ENFORCE-PREFLIGHT-01` (READY, `0a25407`).

- Ejecutada: 2026-08-17T22:47:14Z (T0) → 2026-08-17T22:59:32Z (fin observación), UTC
- Host: `srv1179443`, usuario `root`, compose `/opt/chibaleteplus/`
- Evidencia cruda: `/root/chp-m1-a-api2-enforce-execute-01/`

---

## A. Veredicto

**ENFORCE-ACTIVE-GREEN.** Confianza: **alta**. **Rollback NO usado.**

`api_2` quedó en enforce con firma verificada por probe diferencial, `api_1`/front/edge
intactos byte a byte, cero errores, cero 5xx, cero usuarios afectados, autoridad canónica
sin mutación. Todos los gates A–K pasaron a la primera.

## B. Gates T0 (todos PASS antes de editar)

| Gate | Verificación | Resultado | Evidencia |
|---|---|---|---|
| A | 4 contenedores healthy, mismos IDs/StartedAt/ImageID que el preflight, restarts=0 | PASS | `ABC-t0-*.txt` |
| B | legacy api_1=2 / api_2=9, delta 0 desde preflight; `METRICS_ENABLED=1` ambas; `up`=1 ambas; logs desde preflight 0 WARN/ERROR/session; edge 0 líneas 0 5xx | PASS | ídem |
| C | journal APPLIED=101234/NOOP=251/PENDING=0/FAILED=0; padrón sha `645a8148cf76…`, 647 usuarios, cv=0×647; sessions.db 7/6 sin cambios | PASS | ídem |
| — | Precondición probe: `lt-user-001` existe con `accountStatus=disabled` | PASS | ídem |

## C. Backup (Gate D PASS)

- Ruta: `/root/chp-m1-a-api2-enforce-execute-01/override.pre-api2-enforce-20260817T224803Z.yml`
- sha256: `7579228ba873c30f5f9710f58d9405eb7318131ad812ec48b87c68c656975b56`
  (verificado byte-idéntico al override vivo pre-cambio con `cmp`)
- También respaldados: `compose.config.pre.filtered.txt` (config efectiva pre, filtrada a
  líneas de servicio/imagen/`SESSION_AUTH_MODE`/`METRICS_ENABLED` — el dump completo con
  entorno NO se persiste), `inspect.api_1.pre.json`, `inspect.api_2.pre.json`,
  métricas/logs T0, copias identity/sessions db.
- Override editado post-cambio: sha256 `da827674737295e6…`.

## D. Diff aplicado (Gate E PASS)

```diff
86c86
<       SESSION_AUTH_MODE: "compat"
---
>       SESSION_AUTH_MODE: "enforce"
```

- Exactamente 1 línea, dentro del bloque `api_2` (edición contextual por bloque de
  servicio, validada con conteo de líneas cambiadas == 2 antes de aplicar).
- 0 cambios en `api_1`, front, edge, datos. Comillas conservadas (trampa YAML).
- Gate F (config efectiva pre-recreate): validación de la config resuelta del compose,
  filtrada a las líneas no-secretas → `api_1: compat` (línea 21), `api_2: enforce`
  (línea 100); diff pre/post de la config resuelta = solo esa línea.

## E. Recreate (Gate G PASS)

- Comando: `cd /opt/chibaleteplus && docker compose up -d --no-deps api_2`
- Container api_2: `8adaf4f0bb59` → `c2c97e3fbdd7`
- StartedAt: `2026-08-16T15:58:04Z` → `2026-08-17T22:48:55Z`
- ImageID: `sha256:f2935d0f1209…` (sin cambio — misma imagen `chibalete/api:0ff76b6`)
- healthy en ~15s, restarts=0, 0 errores de arranque (banner completo normal,
  identity-db migrations already=3, shadow-compare armed)
- `api_1` (`a7fc56524aec`), front (`685fdf0ca59e`), edge (`84453f116969`): IDs y
  StartedAt **sin cambio**.

## F. Config efectiva (Gate H PASS)

| Campo | api_1 | api_2 |
|---|---|---|
| `SESSION_AUTH_MODE` | **compat** | **enforce** |
| `METRICS_ENABLED` | 1 | 1 |
| `SESSION_LEGACY_ALLOW` | ausente | ausente |
| startedAt | sin cambio ✅ | nuevo (22:48:55Z) ✅ |

## G. Smoke post-enforce (Gate J PASS)

| Prueba | Resultado |
|---|---|
| `/api/health` directo api_1 / api_2 | 200 / 200 (instance `a7fc…` / `c2c9…`) |
| Edge → 12 hits `/api/health` | **6× api_1 + 6× api_2** — RR intacto tras recreate |
| `/api/auth/me` sin sesión vía edge | 401 `{"error":"No autorizado"}` — diseño cookie-only |
| Ruta pública `/api/runtime-config` vía edge | 200 |
| Prometheus target api_2 post-recreate | `up=1` |
| Logs api_1/api_2 desde recreate | 0 WARN/ERROR/FATAL, 0 líneas `[SESSION]` |
| Edge desde recreate | 0×5xx |
| Journal | PENDING=0 / FAILED=0 (sin cambio) |

## H. Métricas post-enforce y probe diferencial (Gate I PASS)

**Probe no contaminante** (solo api_2, interno): `GET /api/groups` con
`x-user-id: lt-user-001` (sintético deshabilitado), sin cookie →
`401 {"error":"No autorizado: se requiere sesión activa"}` +
`failure{session_required}` 0→1. **Firma exacta de enforce** (en compat habría dado
`failure{disabled}`); denegación previa al lookup; **la serie legacy de api_2 ni siquiera
se inicializó** (contadores lazy) → 0 contaminación. No se probeó api_1 con usuario activo
(habría sumado al contador de drenaje).

**Nuevo baseline documentado:**
```text
api_1 legacy counter: 2   (histórico, intacto — NO se resetea)
api_2 legacy counter: 0   (reset por recreate: los contadores prom son in-process;
                           el reset NO es reducción semántica del uso legacy)
api_2 failure{session_required}: 2
  = 1 probe interno + 1 smoke propio /api/auth/me sin sesión vía edge
    (único 401 del edge en la ventana, enrutado a api_2; el no_identity de
    api_1 no se movió — atribución completa, 0 requests de terceros denegadas)
scrape: up=1 ambas instancias; errores session identity: 0
```

## I. Logs y DLQ

- api_1: 0 WARN/ERROR desde recreate; series byte-idénticas (legacy=2, mismatch=0).
- api_2: 0 WARN/ERROR; solo `session_required=2` (atribuidos arriba).
- edge: 15 líneas desde recreate — 13×200 (smoke health/público) + 1×301 (bot) +
  1×401 (smoke propio). 0×5xx.
- journal: APPLIED=101234 / NOOP=251 / PENDING=0 / FAILED=0 — **sin cambio en toda la
  ejecución**. Padrón byte-idéntico (sha `645a8148cf76…`), cv=0×647.

## J. Observación corta

- Duración: ~10,6 min (22:48:55Z recreate → 22:59:32Z cierre).
- Hallazgos: ninguno. Restarts: 0 en los 4 contenedores. 5xx: 0. Warnings/errors: 0.
- Sin usuarios afectados: 0 logins, 0 sesiones nuevas, 0 denegaciones a terceros
  (ventana nocturna sin tráfico real — ver riesgos).

## K. Rollback

**NO usado.** Preparado y verificado disponible: restaurar
`override.pre-api2-enforce-20260817T224803Z.yml` (sha verificado) sobre el override vivo +
`docker compose up -d --no-deps api_2`.

## L. Riesgos residuales

1. **Asimetría deliberada api_2=enforce / api_1=compat** (esperada — es el canary): un
   emisor legacy real seguiría funcionando ~50% de las veces (cuando el RR lo mande a
   api_1) y fallaría con `session_required` en api_2. Vigilar AMBOS: `legacy` en api_1 y
   `session_required` no atribuible en api_2.
2. **Tráfico real aún limitado**: la activación ocurrió en noche de domingo; el enforce
   todavía no ha sido ejercitado por tráfico escolar. La ventana de observación posterior
   (lunes lectivo) es la validación real.
3. **Health commit stale**: `/api/health` sigue reportando `2945fa8` por el bind mount
   `.deploy-info` congelado (ambas instancias; cosmético — runtime real `0ff76b6` por
   ImageID/GIT_SHA).
4. **Contador api_2 reseteado por recreate**: baseline post-enforce = api_1:2 / api_2:0.
   No interpretar el reset como drenaje adicional.
5. **Puntos ciegos del contador legacy** (heredados): `source_class` hardcodeado; cookie
   válida + header coincidente no cuenta. En enforce el gap se auto-observa: legacy sin
   cookie aflora como `session_required`.
6. **Capa de sesión sin logs**: la vigilancia es por métricas (`session_required`,
   `signing_key_unavailable`, `session_store_unavailable`) + edge.

## M. Recomendación

- **Mantener api_2 en ENFORCE bajo observación.**
- Programar checkpoint de observación (~2h y luego tras tráfico escolar de lunes):
  `session_required` de api_2 debe crecer SOLO por causas atribuibles; `legacy` de api_1
  debe seguir en 2; cualquier spike no atribuible → rollback por config (§K).
- **NO pasar api_1 a ENFORCE todavía** — requiere su propia unidad tras observación
  suficiente con tráfico real.

## N. Siguiente prompt sugerido

`CHP-IDDB-M1-A-API2-ENFORCE-OBSERVE-02H-01`

## O. Confirmación final

api_2 quedó en ENFORCE. api_1 permaneció en compat. No se tocaron frontend, edge/nginx, datos, uploads ni migraciones.
