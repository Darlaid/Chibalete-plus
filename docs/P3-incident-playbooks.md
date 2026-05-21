# P3-H — Incident & Recovery Playbooks (Chibalete+)

Operación real. Cada playbook: **señal → diagnóstico → acción → verificación →
rollback**. Acciones = comandos concretos. Default de toda acción dudosa:
**degradar, no colapsar** (V1/JSON siguen siendo el suelo seguro).

## Principios de degradación controlada
- `/api/health` (liveness) NUNCA se toca: nginx/docker no deben matar el container por readiness.
- Todo flag a OFF + restart = comportamiento P0 conocido y estable.
- Identidad: JSON es source-of-truth hasta el cutover; SQLite es shadow → desactivable sin pérdida.
- Runtime: V1 es el suelo; V2 se apaga con killswitch sin redeploy.

---

## drift-explosion  (alert: ImmersiveDriftExplosion)
**Diag:** Jaeger/logs `VISUAL_*`; ¿`runtime=v2` domina el drift?
**Acción:** si v2 → `IMMERSIVE_V2_COHORT_PCT=0` (o `IMMERSIVE_V2_KILLSWITCH=1`) en env del compose + `docker compose up -d api` (staggered). V1 absorbe 100%.
**Verif:** `chibalete_immersive_drift_total` cae < 0.5/s en 10m; cohorte v2 = 0 en `/api/health/ready`.
**Rollback:** ninguno (es el rollback).

## runtime-crash-spike  (alert: RuntimeCrashSpike, critical)
**Acción inmediata:** `IMMERSIVE_V2_KILLSWITCH=1` (1 env, restart staggered). Capturar `__pbDiag()` + GlitchTip issue + traza Jaeger del crash.
**Verif:** `chibalete_runtime_crash_total{source=v2}` plano 15m; usuarios en V1.

## shadow-inconsistency  (alert: ShadowInconsistency, critical)
**Diag:** `sqlite3 data-critical/identity.db "SELECT * FROM shadow_audit ORDER BY id DESC LIMIT 20"` → ¿qué dominio, json_count vs sqlite_count?
**Acción:** **NO hacer cutover de lectura** (`IDENTITY_READ` queda en `json`). Mantener `IDENTITY_DUAL_WRITE=1` para seguir auditando, o ponerlo OFF si el espejo causa ruido (JSON intacto). Investigar el write divergente vía pino request-id.
**Recovery drill:** re-sync forzado = cualquier write del dominio re-sincroniza full (diseño P1). Si DB corrupta: borrar `identity.db*`, restart con `IDENTITY_SQLITE_ENABLED=1` → migra limpio, el primer write re-pobla.
**Cutover-readiness (criterio P3-E):** promover `IDENTITY_READ=sqlite` SOLO si: `shadow_consistency_ok==1` sostenido ≥7 días, 0 alertas ShadowInconsistency, `integrity_check=ok`, drill de restart probado, snapshot JSON respaldado.

## sqlite-busy-spike  (alert: SqliteBusySpike)
**Diag:** contención dual-api. `busy_timeout=5000` ya absorbe; spike sostenido = lock largo.
**Acción:** confirmar WAL (`PRAGMA journal_mode` debe = `wal` vía `/api/health/ready`); si degradado, `IDENTITY_DUAL_WRITE=0` (vuelve a JSON puro, sin contención SQLite). No subir busy_timeout a ciegas.

## restart-loop  (alert: RestartLoop, critical)
**Diag:** `docker logs chibalete_api_1 --tail 200` (pino JSON) → causa de exit. Casi siempre: env faltante, .env, o dep nativa.
**Acción:** si post-deploy → rollback de imagen (ver deploy-rollback). Si env → corregir compose env + `up -d`.

## api-instance-down  (alert: ApiInstanceDown)
**Estado:** dual-api degradado a 1 (nginx upstream sigue sirviendo). NO es outage.
**Acción:** recrear la instancia caída: `docker compose up -d --force-recreate chibalete_api_X`; verificar `/api/health` de ESA instancia (campo `instance`).

## auth-failure-spike  (alert: AuthFailureSpike)
**Diag:** ¿IPs/userIds concentrados (fuerza bruta) o despliegue rompió login? `loginLimiter` ya activo.
**Acción:** si ataque → endurecer `loginLimiter.max` (env/redeploy) o bloquear IP en nginx. Si bug → deploy-rollback.

## deploy-rollback  (genérico)
**Backend (sin cambio package.json):** swap bind-mount `server/` al tag anterior + restart staggered.
**Backend (con deps, como P0/P2):** `docker tag`/recreate al **tag de imagen anterior** (siempre conservar N-1) + recreate api_1→verificar→api_2.
**Frontend:** recreate `chibalete_front` con imagen anterior + `docker exec chibalete_edge nginx -s reload`.
**Flags:** primer reflejo de cualquier rollback runtime = poner flags P1/P2/P3 a OFF (estado P0 estable garantizado).

## observability-recovery
Jaeger/Prometheus son overlay aislado: si saturan o caen, **no afectan la app** (OTel exporter falla → degrada a sin-tracing por diseño; `/metrics` 404 si off). Acción: `docker compose -f ...observability.yml restart`; o quitar el `-f` y `OTEL_ENABLED=0`/`METRICS_ENABLED=0` → app intacta.

## sw-incident (offline foundation)
SW solo activo si `SW_ENABLED=1`. Si sirve assets stale/rotos: en cliente `unregisterSW()` (utils/registerSW.ts) o `VITE_SW_ENABLED=0` en próximo build. SW nunca cachea `/api/*` (datos siempre frescos).

---

## V2 canary expansion rules (P3-F)
Promover cohorte SOLO si, sostenido 48h por escalón: `runtime_crash_total{v2}` ≈ 0, drift(v2) ≤ drift(v1)·1.2, `visual_audio_delta_ms{v2}` p95 < 40ms, 0 alertas critical de runtime. Escalones: 1% → 5% → 25% → 50% → 100%. Regla de **auto-rollback**: alerta `RuntimeCrashSpike` o `ImmersiveDriftExplosion` con `runtime=v2` → killswitch (manual o cron de scripts/v2-rollback.sh). V1 jamás se apaga ni se quita el fallback en P3.
